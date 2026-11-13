#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍅 番茄专注 · 核心回归集（M0 监护仪）
=====================================
用法:
    python3 run_smoke.py            # 跑全部用例
    python3 run_smoke.py --only C01 # 只跑单个用例
    python3 run_smoke.py --html /path/to/index.html   # 显式指定被测产物
    SMOKE_APP=/path/to/index.html python3 run_smoke.py # 或环境变量指定

    # 本机起不了无头 chromium 时（Android PRoot 等），把断言接到真机浏览器上跑
    # ⚠️ 「起不起得来」先测再说：chromium --version + /dev/shm 可写性 + 跑一条看退出码
    #    （完整 Linux / Docker 容器能直接跑，别绕桥；判据见 AGENTS §2.8-12）
    python3 run_smoke.py --via browser --port 8790
    （先把（内置）浏览器导航到 http://127.0.0.1:8790/ ，它会自动接入）

原理: 无头 Chromium + CDP。每条用例都是「造状态 → 操作 → 断言」。
任何后续改动(模块/重构/新功能)之后跑一遍, 全绿才允许合入。

  --via browser 时不起 chromium，改为「沙箱起 HTTP 桥 + 真机浏览器当执行器」，
  传输细节见 smoke_bridge.py；用例代码一个字不改，js() 语义保持一致。

依赖: chromium / python3 + websocket-client
      （--via browser 只用标准库，不需要 chromium / websocket-client）
"""
import sys, os, json, time, subprocess, tempfile, random, socket, urllib.request, signal
try:
    import websocket
except ImportError:
    # 环境不具备 ≠ 代码坏了：与「没装 chromium」同样按 exit 3 报，让 verify 记 SKIP。
    # 原来这里是裸 import，缺库时直接 ImportError + traceback + 退出码 1，
    # 在汇总里长得跟"用例失败"一模一样（P1-9）。
    print("○ 缺少 websocket-client（pip install websocket-client）—— smoke 需要它驱动 CDP")
    raise SystemExit(3)


APP_FILE = None


def _serve_if_multi(url):
    """多产物在 file:// 下会被浏览器当成「每个文件一个源」：<link> 加载没问题，
    但 `link.sheet.cssRules` 读取会抛 SecurityError —— C01「样式表已加载」因此假红。
    统一起本地静态服务（实现见 _app_path.serve_multi，别再造第二套）。
    单文件产物没有 assets/ 目录，原样返回，行为不变。"""
    global APP_FILE
    if url.startswith("file://") and APP_FILE is None:
        APP_FILE = os.path.abspath(url[len("file://"):])
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _app_path import serve_multi          # 延迟导入：run_smoke 可被当模块引用，别在导入期起服务
    return serve_multi(url)


def _resolve_app():
    """被测产物路径不再硬编码 /workspace。
    优先级：--html 参数 > SMOKE_APP 环境变量 > 自动探测（public/index.html / index.html）。
    2026-10-22 起 public/ 是唯一发布物，自动探测优先它。"""
    if "--html" in sys.argv:
        i = sys.argv.index("--html")
        if i + 1 < len(sys.argv):
            raw = sys.argv[i + 1]
            # URL 直接透传：以前这里一律 abspath，导致 --html http://... 被拼成
            # 一个不存在的本地路径、再静默回落到项目内 index.html —— 多产物明明没跑，
            # 结果却报「全部通过」。这是假绿，必须当场报错而不是回退。
            if raw.startswith(("http://", "https://", "file://")):
                return _serve_if_multi(raw)
            p = os.path.abspath(raw)
            if not os.path.exists(p):
                print("✗ --html 指定的产物不存在：" + p)
                sys.exit(2)
            return _serve_if_multi("file://" + p)
    env = os.environ.get("SMOKE_APP")
    if env:
        u = env if (env.startswith("file://") or env.startswith("http")) else "file://" + os.path.abspath(env)
        return _serve_if_multi(u)
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (os.path.join(here, "..", "public", "index.html"), os.path.join(here, "..", "index.html")):
        if os.path.exists(cand):
            return _serve_if_multi("file://" + os.path.abspath(cand))
    print("✗ 找不到产物：public/index.html。先跑 python3 tools/build.py")
    sys.exit(2)


def _has(flag):
    """裸开关必须这么判：_arg 对「最后一个参数」返回 default(None)=假，会把 --new-only 当没写。"""
    return flag in sys.argv

def _arg(flag, default=None):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


APP = _resolve_app()
VIEW_W, VIEW_H = 500, 1000
PORT = random.randint(9400, 9800)
PROFILE = tempfile.mkdtemp(prefix="smoke_")
CHROMIUM = os.environ.get("CHROMIUM", "chromium")

# 真机浏览器传输。桥用固定端口——它必须能被「人/agent」提前知道去导航。
BRIDGE_PORT = 8790
VIA_BROWSER = (_arg("--via") == "browser") or os.environ.get("SMOKE_VIA") == "browser"
BRIDGE = None

PASS = FAIL = 0
FAILURES = []
UNVERIFIED = []
CURRENT_CASE = ""   # 当前正在跑的用例名，用于给失败项打标签

# ---------- 已知失败基线 ----------
# 为什么要这个：全量回归集里躺着几条「历史遗留、与本次改动无关」的失败。
# 每次改完都全跑一遍，看到 FAIL 4 无法判断「是我改坏的」还是「本来就烂」——
# 只能靠 git stash 取基线逐条比对（费时且靠记性）。把基线落成文件后，
# 输出直接分成「已知失败（不算回归）/ 新增失败（★必须处理）」两栏。
# 基线只该记录**已知的、有归属的**失败；修好了就 --update-baseline 收缩它。
BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smoke_baseline.json")

def _load_baseline():
    try:
        with open(BASELINE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"failures": []}

def _save_baseline(items):
    with open(BASELINE_PATH, "w", encoding="utf-8") as f:
        json.dump({"note": "已知失败基线：这些是历史遗留、已定位归属的失败。"
                           "修好后请 python3 tools/run_smoke.py --update-baseline 收缩。",
                   "updated": time.strftime("%Y-%m-%d %H:%M"),
                   "failures": sorted(items)}, f, ensure_ascii=False, indent=2)
_CASE_JS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests")

# 用例公共契约（阈值 / 环境清单 / 测量原语）。每条用例前面自动拼上，
# 用例里直接用全局 TC，**不许各自再写一份颜色解析或对比度函数**。
# 见 tools/tests/_contract.js 开头的说明：断言只量"性质"，不抄"实现现值"。
_CONTRACT_PATH = os.path.join(_CASE_JS_DIR, "_contract.js")


def _case_js(name):
    """读 tools/tests/<name> 里的页面侧断言体（同一份文件也能在浏览器直跑，便于本地复核）。

    ★ 前面自动拼上 _contract.js：所有用例共享同一套 TC（阈值/主题清单/测量原语）。
      这是"改实现不该让一堆断言变红"的结构性保证 —— 详见 _contract.js 顶部的说明。
    """
    with open(os.path.join(_CASE_JS_DIR, name), encoding="utf-8") as f:
        body = f.read()
    with open(_CONTRACT_PATH, encoding="utf-8") as f:
        contract = f.read()
    return contract + "\n;\n" + body


_cases = []            # (用例名, 函数, tier, [owner...])
def case(name, tier="feature", owner=""):
    """注册一条用例。

    tier  core    = 兜底层：任何改动都可能踩到，默认总是跑（启动/渲染/小屏/数据兼容/计时安全…）
          feature = 功能层：只在改动命中它的 owner 模块时才跑
    owner 归属模块前缀（空格分隔），与改动文件路径做**子串**匹配。
          归属写在用例自己头上，所以「加了用例忘了登记」这类漏永远不会发生
          —— 这正是过去每加一个功能就只能跑全量的原因（见 tools/affected_cases.py 头注）。
    """
    def deco(fn):
        _cases.append((name, fn, tier, owner.split())); return fn
    return deco

# ---------- chromium / cdp ----------
# EXIT_NO_BROWSER：本机不具备无头浏览器（未装 / 沙箱起不来）。
# 与「测试失败」区分开——它不代表代码坏了，verify.py 会把它记为 SKIP 而非 FAIL。
EXIT_NO_BROWSER = 3

def wait_port(port, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def _kill(proc):
    """整组回收 chromium——它常起子进程，只 kill 父进程会留下孤儿拖住 shell。"""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(os.getpgid(proc.pid), sig)
        except Exception:
            try: proc.kill()
            except Exception: pass
        try:
            proc.wait(timeout=5); return
        except Exception:
            continue


def _probe_chromium():
    """启动前预检：把「装了但起不来」和「没装」在 10 秒内区分开并给出可执行的话。
    背景：本项目的自动化回归（smoke / e2e）需要真无头浏览器。某些沙箱（如 Android 上的
    PRoot 容器）里 chromium 二进制能装上、却因内核限制（socket directory / inotify）起不来。
    不预检的话，Popen 出去的浏览器进程会赖着不走，把整条链挂到超时——比直接报错更难查。"""
    try:
        subprocess.run([CHROMIUM, "--version"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10, check=True)
    except FileNotFoundError:
        print("✗ chromium 未安装 —— smoke/e2e 需要无头浏览器。\n"
              "  装：apt install chromium ／ brew install chromium ／ apk add chromium\n"
              "  或设 CHROMIUM=/path/to/chrome 指向别的浏览器")
        raise SystemExit(EXIT_NO_BROWSER)
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        print("✗ chromium --version 异常（进程可能被内核杀掉）—— 本机跑不了 smoke/e2e。\n"
              "  常见原因：某些沙箱（Android PRoot）里 /dev/shm 建不了、SwANGLE/Vulkan 初始化失败。\n"
              "  ⚠️ 先别急着认这个结论——跑一遍「浏览器能力三连自检」再定性（AGENTS §2.8-12）：\n"
              "     chromium --version ／ touch /dev/shm/_probe && rm -f /dev/shm/_probe ／\n"
              "     python3 tools/run_smoke.py --only C01; echo $?\n"
              "  确认真的起不来，才改用真机桥：python3 tools/run_smoke.py --via browser")
        raise SystemExit(EXIT_NO_BROWSER)


def launch():
    _probe_chromium()
    proc = subprocess.Popen([CHROMIUM, "--headless=new", "--disable-gpu", "--no-sandbox",
                      f"--user-data-dir={PROFILE}",
                      f"--window-size={VIEW_W},{VIEW_H}", "--hide-scrollbars",
                      f"--remote-debugging-port={PORT}", APP],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)  # 独立会话：失败时可整组回收，不拖住父进程
    if not wait_port(PORT):
        _kill(proc)
        print("✗ chromium 起不来（启动后等不到 CDP 端口）—— 本机跑不了 smoke/e2e。\n"
              "  常见原因：沙箱限制（PRoot 的 /dev/shm、socket directory、inotify）——与代码改动无关。\n"
              "  ⚠️ 若你确认本机本该能跑，先按 AGENTS §2.8-12 跑三连自检（别把上次机器的结论当本机结论）。")
        raise SystemExit(EXIT_NO_BROWSER)
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
    mid = [0]; errors = []
    def send(m, p=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("method") == "Runtime.exceptionThrown":
                try: errors.append(str(r["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:200])
                except Exception: pass
            if r.get("id") == mid[0]:
                return r
    def js(expr):
        r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if "exceptionDetails" in r["result"]:
            return "EXC:" + r["result"]["exceptionDetails"].get("text", "")
        return r["result"]["result"].get("value")
    send("Runtime.enable")
    time.sleep(1.6)
    return ws, js, errors


def _app_path():
    """把 APP（可能是 file:// URL）还原成本地文件路径——桥要读它的副本。"""
    a = APP
    if a.startswith("file://"):
        a = a[len("file://"):]
    return a


def launch_bridge():
    """不起 chromium，改为「沙箱起 HTTP 桥 + 真机浏览器当执行器」。

    为什么不用 chromium：某些沙箱（Android PRoot）里二进制装得上、进程起不来
    （/dev/shm 建不了、SwANGLE/Vulkan 初始化失败），整段 smoke 只能 SKIP——
    它偏偏是唯一能抓「点击/渲染/状态」回归的一段。桥把执行权交给真机浏览器。
    """
    global BRIDGE
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from smoke_bridge import BridgeServer
    port = int(_arg("--port", str(BRIDGE_PORT)))
    wait = float(_arg("--client-wait", "300"))
    BRIDGE = BridgeServer(_app_path(), port=port, w=VIEW_W, h=VIEW_H)
    BRIDGE.start()
    print("🔌 桥已监听 http://127.0.0.1:%d/" % port)
    print("   → 请把浏览器导航到该地址（页面会自动接入，不需要登录）", flush=True)
    print("   等待浏览器接入（最多 %d 秒）…" % int(wait), flush=True)
    if not BRIDGE.wait_attach(timeout=wait):
        print("✗ 等超时：浏览器一直没接入 —— 拿不到被测页面，smoke 无法进行。")
        print("  （确认浏览器已经打开 http://127.0.0.1:%d/ ，且没有被别的页面顶掉）" % port)
        BRIDGE.stop()
        raise SystemExit(EXIT_NO_BROWSER)
    print("   ✓ 浏览器已接入，开始执行用例", flush=True)
    # 无头 chromium 每轮 --user-data-dir=tempfile.mkdtemp()——全新存储。
    # 真机浏览器是**持久源**，上轮跑完的数据会留下（localStorage + IndexedDB），
    # 于是 C02「新用户旅程开启」这类断言会把应用当成老用户而假失败。
    # 走 /reset 页清除（必须趁应用还没起来删库，否则 deleteDatabase 被连接阻塞）。
    if not BRIDGE.reset_storage():
        print("   ⚠️ 存储重置后没等到应用就绪，C02 一类断言可能失败", flush=True)
    else:
        print("   ✓ 存储已清空（等价全新 profile）", flush=True)
    # 真机浏览器里，页面一旦不是前台（visibilityState=hidden），定时器会被节流：
    # 实测 setTimeout(350ms) 实际 708ms 才触发（约 2 倍）。用例里的等待是墙钟秒数，
    # 不补偿就会出现「卡片还没弹/还没结算」的假失败（C03 就这么栽的）。
    # 这里按实测系数放大等待；页面回到前台时自动不放大。
    time.sleep(1.6)          # 与被测页初始化对齐
    return None, BRIDGE.eval, BRIDGE.errors


# 后台节流的实测补偿系数（350ms→708ms）。
VIS_DILATE = 2.2
_sleep_raw = time.sleep
if VIA_BROWSER:
    def _sleep(t):
        try:
            if BRIDGE is not None and BRIDGE.vis == "hidden":
                t = t * VIS_DILATE
        except Exception:
            pass
        _sleep_raw(t)
    time.sleep = _sleep
    print("   ℹ️ 页面处于后台时会按 %.1fx 放大等待（定时器节流补偿）" % VIS_DILATE, flush=True)


ws, js, JS_ERRORS = None, None, []
# M3 专用：直接发 CDP 命令（用独立 id 空间，避免与内部 js() 冲突）
_cdp_mid = [50000]
def cdp(m, p=None):
    # 真机浏览器没有 CDP：视口切换改由外壳页的 iframe 尺寸承担（见 smoke_bridge.py）。
    if VIA_BROWSER:
        if m == "Emulation.setDeviceMetricsOverride" and BRIDGE is not None:
            return BRIDGE.set_viewport(int((p or {}).get("width", VIEW_W)),
                                       int((p or {}).get("height", VIEW_H)))
        return None
    _cdp_mid[0] += 1
    _id = _cdp_mid[0]
    ws.send(json.dumps({"id": _id, "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == _id:
            return r
def check(cond, msg):
    global PASS, FAIL
    # ★ 假绿通道（P2-17）：js() 在页面抛异常时返回字符串 "EXC:..."，而字符串是 truthy ——
    #   `check(js("xxx"))` 这种裸真值断言在页面已经崩了的情况下反而**通过**。
    #   这里在唯一的收口处拦掉：凡是异常字符串一律判失败，并把异常摘要带进失败项。
    #   比逐个改调用点可靠 —— 以后新写的裸真值断言自动受保护。
    if isinstance(cond, str) and cond.startswith("EXC:"):
        FAIL += 1
        FAILURES.append(_tag(msg + " :: 页面侧异常 " + cond[4:140]))
        print("   ✗", msg, "-> 页面侧异常", cond[4:120])
        return False
    if cond: PASS += 1
    else:
        FAIL += 1; FAILURES.append(_tag(msg)); print("   ✗", msg)
    return cond

def _tag(msg):
    """失败项一律带「用例名 :: 断言」前缀。
    为什么：断言文案会在多个用例里重复（如「②被修好」），只存文案无法定位、
    也无法与基线精确比对。带用例名才是唯一键。"""
    return f"{CURRENT_CASE} :: {msg}" if CURRENT_CASE else msg

def wait_until(expr, timeout=8.0, interval=0.25):
    """轮询直到 expr 返回「有效值」，返回最后一次取值。

    为什么需要它：①真机浏览器里页面处于后台时定时器被节流（实测约 2 倍），
    「等固定秒数再断言」会在内容还没出现时就判失败——等的应该是**条件**，
    不是「大概过够时间了」。②`location.reload()` 之后旧文档可能把命令取走却
    来不及作答（桥只保证送达），单发一次取值必然偶发失败——重试天然化解。
    补偿系数（VIS_DILATE）只是兜底，不该当唯一手段。
    """
    end = time.time() + timeout
    val = None
    while True:
        val = js(expr)
        if val and not (isinstance(val, str) and val.startswith("EXC:")):
            return val
        if time.time() >= end:
            return val
        time.sleep(interval)

def unverified(msg):
    """记一条「本环境量不准 → 不下结论」的项。

    与 FAIL（代码坏了）和 PASS（验过了）都不同：它表示这一条**没验成**，
    必须在汇总里显形。绝不能悄悄算成通过——那正是 之前的病。
    """
    UNVERIFIED.append(msg)
    print("   ⚠️ 未验证:", msg)

# ================= 工具 =================
def read_ui_fold_raw():
    """折叠偏好已收编主存储 appData.uiPrefs.foldPrefs（原独立键 tomato_ui_fold_v1 已删）。
    从主存储 payload 读出 foldPrefs 的 JSON 文本，供持久化断言。

    ★ 必须先精确命中 STORAGE_KEY 再退前缀匹配（2026-10-21 修）：
      主存储旁边还有 tomato_focus_v3_stamp（写入戳，payload 是 {id,t}，没有 d 字段）
      和 tomato_focus_v3_auto_backup。旧写法「取第一个 tomato_focus* 键」依赖
      Object.keys(localStorage) 的遍历顺序 —— 那个顺序**没有任何规范保证**
      （实测：两个键时 stamp 在前，四个键时又像字典序），于是这条断言在某些机器上
      读到写入戳、JSON.parse(undefined) 抛错、一路 catch 成 '{}'，红得莫名其妙。
      前缀兜底只用来兼容改过 key 名的分支，且显式排除 _stamp/_auto_backup。"""
    return js(
        "(function(){"
        "function pick(){"
        " if(localStorage.getItem('tomato_focus_v3')!=null) return 'tomato_focus_v3';"
        " var ks=Object.keys(localStorage);"
        " for(var i=0;i<ks.length;i++){var k=ks[i];"
        "  if(k.indexOf('tomato_focus')!==0) continue;"
        "  if(k.indexOf('_stamp')>=0||k.indexOf('_auto_backup')>=0) continue;"
        "  return k;}"
        " return null;}"
        "var k=pick();if(!k)return '{}';"
        "try{var o=JSON.parse(localStorage.getItem(k));var d=JSON.parse(o.d);"
        "return (d&&d.uiPrefs&&d.uiPrefs.foldPrefs)?JSON.stringify(d.uiPrefs.foldPrefs):'{}';}"
        "catch(e){return '{}';}})()"
    )
def rec(days_ago=0, pomos=1, rtype="full", nid=None, hours=None, note=None):
    d = time.time() * 1000 - days_ago * 86400000
    if hours is not None:
        from datetime import datetime, timedelta
        now = datetime.now().replace(minute=0, second=0, microsecond=0)
        t = now - timedelta(days=days_ago, hours=(now.hour - hours) % 24)
        d = t.timestamp() * 1000
    return {"id": nid or int(d), "type": rtype, "startTime": int(d),
            "pomos": pomos, "effectiveSeconds": 1500 * pomos, "note": note}


# 找出把文档撑宽的元素：右边界超出可视宽、且沿途祖先没有裁掉它（overflowX 不裁）。
# 只报最外层的那几个，避免把它们的子元素全列出来。
OVERFLOW_PROBE = (
    "(function(){var W=document.documentElement.clientWidth;var out=[];"
    "var all=document.querySelectorAll('body *');"
    "for(var i=0;i<all.length;i++){var e=all[i];var r=e.getBoundingClientRect();"
    "if(r.right<=W+1||r.width===0)continue;"
    "var p=e.parentElement,clipped=false;"
    "while(p&&p!==document.body){var ox=getComputedStyle(p).overflowX;"
    "if(ox==='auto'||ox==='scroll'||ox==='hidden'){clipped=true;break;}p=p.parentElement;}"
    "if(clipped)continue;"
    "var cls=(typeof e.className==='string'&&e.className)?('.'+e.className.split(' ')[0]):'';"
    "var chain=[],p2=e.parentElement,n2=0;"
    "while(p2&&n2<3){chain.push(p2.tagName.toLowerCase()+(p2.id?('#'+p2.id):'')"
    "+((typeof p2.className==='string'&&p2.className)?('.'+p2.className.split(' ')[0]):''));"
    "p2=p2.parentElement;n2++;}"
    "var txt=(e.textContent||'').replace(/\\s+/g,' ').slice(0,16);"
    "var es=getComputedStyle(e);"
    "out.push(e.tagName.toLowerCase()+(e.id?('#'+e.id):'')+cls+'@'+Math.round(r.right)"
    "+'[W='+Math.round(r.width)+' L='+Math.round(r.left)+' cssW='+es.width+' minw='+es.minWidth"
    "+' maxw='+es.maxWidth+' flex='+es.flex+' fs='+es.fontSize+' gap='+es.gap+']'"
    "+' <'+chain.join('<')+'>'+' \\''+txt+'\\'');"
    "if(out.length>=3)break;}"
    "return out.join(' | ')||'(未定位)';})()"
)

# ================= 用例 =================
@case("C01 启动基础", tier="core", owner="01a 01b_engine_data 01e_engine_ui 01g_engine_init 0B_hash路由 0D_store通知")
def c01():
    check(js("typeof appData!=='undefined'&&!!appData.settings"), "appData 就绪")
    check(js("typeof window.__jy!=='undefined'"), "旅程模块注入")
    check(js("typeof window.__enhYearDayMap==='function'"), "增强缓存钩子在")
    for v in ["timer", "plan", "stats", "log", "settings"]:
        js(f"switchView('{v}')"); time.sleep(0.12)
    check(js("document.querySelector('.view.active').id") == "view-settings", "5 视图可切换")
    check(js("!!document.getElementById('themeGroup')"), "主题组注入")
    # 从「元素在」升级为「样式表真的加载成功」：空 style / 404 的 link 都不该算通过。
    # 内联 <style> 与外链 <link> 都有 .sheet，所以单文件与多产物共用这一条。
    check(js("var e=document.getElementById('jyvx-css'); !!(e&&e.sheet&&e.sheet.cssRules.length>0)"),
          "视觉 CSS 注入（样式表已加载）")

@case("C02 新用户旅程开启+闸口", tier="feature", owner="01a 01b_engine_data 01d_engine_features 01e_engine_ui 05_journey")
def c02():
    js("localStorage.clear();location.reload()"); time.sleep(2.6)
    check(js("appData.journey&&appData.journey.enabled===true") is True, "新用户旅程开启")
    bar = js("var b=document.getElementById('jyBar'); b?b.innerText:'<无>'")
    check("解锁" in str(bar), "计时页提示条存在")
    check(js("window.__jy.unlocked('tree')") is False, "初始树锁定")
    check(js("window.__jy.unlocked('coin')") is False, "初始金币锁定")
    js("(function(){var t=appData.tree;t.points=5;try{addTreePoints(2);}catch(e){}return t.points;})()")
    check(js("appData.tree.points") == 5, "未解锁时树推进被闸口拦截")
    js("switchView('stats')"); time.sleep(0.4)
    check(js("(function(){var n=document.querySelector('.stats-nav-item[data-tab=tree]');return !!n&&n.textContent.indexOf('🔒')>=0;})()") is True, "统计 tab 树有🔒")

@case("C03 结算跨档解锁", tier="feature", owner="04_enh573 05_journey 01d2 01d3_engine_tree_shop 01d5_engine_stats")
def c03():
    js("""(function(){
      appData.records=[];appData.journey.seen=[];appData.journey.pending=[];
      var now=Date.now();
      for(var i=0;i<3;i++)appData.records.push({id:i+1,type:'full',startTime:now-i*1000,pomos:1,effectiveSeconds:1500});
      window.__jy.ensure();window.__jy.afterSettle();return 1;})()""")
    time.sleep(1.5)
    check(js("window.__jy.unlocked('tree')") is True, "3🍅后树解锁")
    check(js("window.__jy.unlocked('rank')") is True, "3🍅后段位解锁")
    check(js("window.__jy.unlocked('coin')") is False, "金币仍未解锁")
    nm = wait_until(
        "(document.getElementById('jyCardName')||{}).textContent||''", timeout=8, interval=0.3)
    check("段位" in str(nm), f"跨档弹最高档卡(段位): {nm}")

@case("C04 老用户默认放行", tier="feature", owner="04_enh573 05_journey 01b_engine_data 07_uiFold")
def c04():
    # JKEY 独立键已删，不再需要 removeItem
    js("""(function(){
      var R=[];for(var i=0;i<80;i++)R.push({id:i+1,type:'full',startTime:Date.now()-86400000*i,pomos:1,effectiveSeconds:1500});
      appData.records=R;delete appData.journey;window.__jy.ensure();return 1;})()""")
    time.sleep(0.4)
    check(js("appData.journey.enabled") is False, "有数据老用户旅程默认关")
    check(js("window.__jy.unlocked('tree')") is True, "老用户全放行")
    check(js("(function(){var b=document.getElementById('jyBar');return !b||getComputedStyle(b).display==='none';})()") is True, "提示条隐藏")

@case("C05 极简模式隐藏", tier="core", owner="01e_engine_ui 01e4_ui_ux 07_uiFold 0E_theme template.html")
def c05():
    js("document.body.classList.add('minimal-mode')")
    for el in ["timerRankStrip", "timerGhostBox", "timerBadge"]:
        d = js(f"(function(){{var e=document.getElementById('{el}');return e?getComputedStyle(e).display:'N/A';}})()")
        check(d == "none", f"极简下 {el} 隐藏(={d})")
    js("document.body.classList.remove('minimal-mode')")

@case("C06 金币锁期拦截", tier="feature", owner="01d_engine_features 05_journey 01d3_engine_tree_shop")
def c06():
    js("""(function(){
      appData.journey={enabled:true,seen:['tree','rank','coin'],pending:[],achieveSince:null,startTs:Date.now(),legacy:false};
      appData.records=[];var now=Date.now();
      for(var i=0;i<1;i++)appData.records.push({id:i+1,type:'full',startTime:now-i*1000,pomos:1,effectiveSeconds:1500});
      appData.journey.seen=['tree'];appData.tree.coins=7;
      try{claimMustDoReward();}catch(e){} return appData.tree.coins;})()""")
    time.sleep(0.3)
    check(js("appData.tree.coins") == 7, "金币锁期领取被拦(coins 不变)")
    check(js("window.__jy.unlocked('coin')") is False, "coin 仍锁(需5🍅)")

@case("C09 统计折叠不泄漏+年度图完整", tier="feature", owner="01e_engine_ui 01d5_engine_stats 05_journey 04_enh573 template.html")
def c09():
    js("""(function(){var y=new Date().getFullYear();appData.records=[];
      for(var i=0;i<100;i++){var d=new Date(y,0,1+i*3.5);if(d.getFullYear()>y)break;
        appData.records.push({id:i+1,type:'full',startTime:d.getTime(),pomos:1,effectiveSeconds:1500});}
      switchView('stats');return 1;})()""")
    # 等「条件」而不是等「秒数」：页面在后台时定时器被节流（约 2.2x），固定 sleep 会在
    # 图表还没渲染时就断言 → 假失败（本用例曾因此偶发红过两次）。
    wait_until("!!document.getElementById('statsDataView')", timeout=10)
    js("if(window.jyToggleMore&&window.__jyMore&&!window.__jyMore.opened)jyToggleMore()")
    # 年度图是 requestIdleCallback 里懒绘的（见 01e7 renderStats 末尾）：**页面在后台/被
    # 视作隐藏时，idle 回调可能整个不排期**，这时等再久也等不到格子 —— 实测同一份产物
    # 一会儿 0.6s 通过、一会儿 10s 超时红（本用例因此偶发红过几次）。
    # 所以：先等它自己画（正常路径，验证的是真渲染），等不到再显式调一次真渲染函数兜底，
    # 断言仍然落在真实 DOM 输出上（不是恒真）。
    _year_cols = "(function(){var b=document.getElementById('yearHeatmapContainer');"\
                 "return (b&&b.children[2]&&b.children[2].children)?b.children[2].children.length:0;})()"
    wait_until("(" + _year_cols + ") >= 52", timeout=6)
    if not (int(js(_year_cols) or 0) >= 52):
        # 注意 js() 是「直接求值表达式」，顶层 return 会 SyntaxError 而整句不执行（兜底成了摆设）
        js("(function(){try{renderYearHeatmap();return 1;}catch(e){return 'EXC:'+e;}})()")
        wait_until("(" + _year_cols + ") >= 52", timeout=6)
    leak = js("(function(){var h=document.getElementById('statsDataView');if(!h)return -1;var ids=Array.prototype.slice.call(h.children).map(function(e){return e.id;});return ['moodBox','weekCompareBox','yearHeatmapBox','heatmapBox'].filter(function(id){return ids.indexOf(id)>=0;}).length;})()")
    check(leak == 0, "折叠收起态图表无泄漏到数据区(须查直接子级)")
    cols = js("""(function(){var b=document.getElementById('yearHeatmapContainer');if(!b)return 0;
      return (b.children[2]&&b.children[2].children)?b.children[2].children.length:0;})()""")
    check(int(cols or 0) >= 52, f"年度图全年列数({cols})")
    check("12月" in str(js("(function(){var b=document.getElementById('yearHeatmapContainer');return b?b.children[1].textContent:'';})()")), "月份行含 1-12 月")
    check(js("!document.getElementById('enhHeat52Box')") is True, "52周重复图已停用")

@case("C10 段位历史面板", tier="feature", owner="01e6_ui_rank 01e_engine_ui template.html")
def c10():
    js("""(function(){
      appData.rankSystem.history={seasons:[{startDate:'2026-01-01',maxStars:12,maxRankName:'黄金'}]};
      appData.rankSystem.rankFeedback=[{msg:'x',time:'2026-01-01 10:00'}];
      try{showHistoryPanel();}catch(e){} return 1;})()""")
    time.sleep(0.4)
    check(js("document.querySelectorAll('#historyModal .history-section h4').length") == 3, "缺 endDate 也能打开段位历史(3区)")
    js("""(function(){appData.rankSystem.rankFeedback=[];for(var i=0;i<10;i++)
      appData.rankSystem.rankFeedback.push({msg:'反馈'+i,time:'2026-09-0'+(i+1)});
      showHistoryPanel();return 1;})()""")
    time.sleep(0.4)
    check("已收起" in str(js("document.getElementById('historyBody').textContent")), "反馈>8 显示折叠尾注")
    js("try{closeModal('historyModal');}catch(e){}")

@case("C11 补记时长校验", tier="feature", owner="00_pure_core 01e_engine_ui")
def c11():
    js("switchView('log')"); time.sleep(0.3)
    js("""(function(){var b=appData.records.length;
      document.getElementById('addRecordDuration').value='5';document.getElementById('addRecordType').value='full';
      try{saveAddRecord();}catch(e){} return appData.records.length===b;})()""")
    check(js("(function(){var b=appData.records.length;document.getElementById('addRecordDuration').value='5';document.getElementById('addRecordType').value='full';try{saveAddRecord();}catch(e){}return appData.records.length===b;})()") is True, "补记 full/5min 被拦")

@case("C12 时间回拨安全", tier="core", owner="00_pure_core 01c_engine_timer 01g_engine_init")
def c12():
    js("""(function(){try{_lastActiveDay='2099-12-31';onDayRolled();}catch(e){}
      return _lastActiveDay;})()""")
    check(js("_lastActiveDay") == js("getTodayStr()"), "回拨后日期标记拉回今天")

@case("C13 标题单一写入", tier="feature", owner="01e_engine_ui 03_enh572")
def c13():
    js("""(function(){timerState={mode:'focus',running:true,remaining:1499};
      try{updateTitle();}catch(e){} return document.title;})()""")
    t1 = js("document.title")
    time.sleep(1.2)
    t2 = js("document.title")
    check("专注" in str(t1) and "专注" in str(t2) and bool(t1) and bool(t2), f"专注标题稳定({t1})")

# ================= M1 专项用例 =================
@case("C14 M1轮询门控·后台休眠", tier="core", owner="01g_engine_init 03_enh572")
def c14():
    check(js("typeof window.__ivGov==='object'") is True, "__ivGov 存在")
    n = js("window.__ivGov._dbg().length")
    check(int(n or 0) >= 4, f"门控任务已注册({n}≥4)")
    # 前置：本用例断言的是「可见时」的行为，而真机浏览器标签可能在后台
    # （document.hidden=true 时定时器全部休眠是**正确**行为，不是回归）。
    # 所以先把可见性显式置为可见并派发 visibilitychange，让断言针对确定的初始态；
    # 后文再自己隐藏/恢复，验证休眠与唤醒。
    js("(function(){try{Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});}catch(e){}document.dispatchEvent(new Event('visibilitychange'));return 1;})()")
    time.sleep(0.3)
    ok = js("(function(){var ts=window.__ivGov._dbg();return ts.every(function(t){return t.h!==null;});})()")
    check(ok is True, "可见时门控定时器全部在跑")
    js("(function(){try{Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});}catch(e){}document.dispatchEvent(new Event('visibilitychange'));return 1;})()")
    time.sleep(0.25)
    sus = js("(function(){var ts=window.__ivGov._dbg();return ts.filter(function(t){return t.h!==null;}).length;})()")
    check(sus == 0, f"页面隐藏后门控定时器全部休眠(bad={sus})")
    js("(function(){try{Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});}catch(e){}document.dispatchEvent(new Event('visibilitychange'));return 1;})()")
    time.sleep(0.25)
    res = js("(function(){var ts=window.__ivGov._dbg();return ts.filter(function(t){return t.h===null;}).length;})()")
    check(res == 0, f"回前台后门控定时器全部恢复(bad={res})")

@case("C15 M1错误监控捕获", tier="feature", owner="06_errRep 01g_engine_init")
def c15():
    check(js("typeof window.__errRep==='object'") is True, "__errRep 存在")
    js("(function(){try{__errRep.clear();}catch(e){}return 1;})()")
    js("(function(){var e=new ErrorEvent('error',{message:'M1_合成错误',error:new Error('M1_合成错误')});window.dispatchEvent(e);return 1;})()")
    time.sleep(0.2)
    cnt = js("__errRep.list().length")
    check(int(cnt or 0) >= 1, f"window error 事件被捕获({cnt})")
    has = js("(function(){var l=__errRep.list();return l.some(function(x){return x.src==='window'&&x.msg.indexOf('M1_合成错误')>=0;});})()")
    check(has is True, "错误内容与来源被记录")
    js("(function(){var e=new Event('unhandledrejection');e.reason={message:'M1_promise'};window.dispatchEvent(e);return 1;})()")
    time.sleep(0.2)
    hasP = js("(function(){var l=__errRep.list();return l.some(function(x){return x.src==='promise';});})()")
    check(hasP is True, "unhandledrejection 被捕获")
    vis = js("(function(){var b=document.getElementById('m1ErrBadge');return !!b&&getComputedStyle(b).display!=='none';})()")
    check(vis is True, "错误角标出现")
    js("(function(){try{__errRep.clear();}catch(e){}return 1;})()")

@case("C16 M1数据迁移链", tier="core", owner="01b_engine_data")
def c16():
    # 版本号不写死：迁移链的语义是「旧档 → 当前版本」，而当前版本会随发版变
    # （DATA_VERSION 3.8→3.9 之后，本用例的前身写死 3.8，于是
    #  在其后一直红着——只因本机永远 SKIP 而无人知道。改成跟着 DATA_VERSION 走。）
    cur = js("(typeof DATA_VERSION!=='undefined')?DATA_VERSION:''")
    check(bool(cur), f"取到当前数据版本号({cur})")
    r1 = js("(function(){var d=Object.assign(createDefaultAppData(),{version:'3.7',records:[]});delete d.__migration;var r=window.__dataMig.run(d,'3.7','load');return JSON.stringify({a:r.applied.length,m:!!d.__migration,from:r.from,to:r.to});})()")
    try:
        j1 = json.loads(r1) if isinstance(r1, str) else {}
    except Exception:
        j1 = {}
    check(j1.get("a", 0) >= 1 and j1.get("from") == "3.7" and j1.get("to") == cur,
          f"旧版3.7→当前版({cur}) 迁移执行({r1})")
    r2 = js("(function(){var d=Object.assign(createDefaultAppData(),{version:'" + str(cur) +
            "',records:[]});delete d.__migration;var r=window.__dataMig.run(d,'" + str(cur) +
            "','load');return r.applied.length;})()")
    check(r2 == 0, "同版本不重复迁移")
    # 真实载入链路：写入 version=3.7 旧档到双源 → 再调 loadData()（与 init 同一条解析路径）
    # 应盖章到当前版本且审计记录 from=3.7（不用 location.reload，避免 beforeunload 落盘干扰测试态）
    js("(function(){var d=Object.assign(createDefaultAppData(),{settings:Object.assign({},defaultSettings),records:[{id:1,type:'full',startTime:Date.now()-3600000,pomos:1,effectiveSeconds:1500}],version:'3.7'});var payload=JSON.stringify({t:Date.now()+1000,d:JSON.stringify(d)});localStorage.setItem('tomato_focus_v3',payload);if(window.idbWrite){try{idbWrite(payload);}catch(e){}}return 1;})()")
    time.sleep(0.5)
    js("try{loadData();}catch(e){}")
    time.sleep(1.2)
    v = js("appData.version")
    check(v == cur, f"载入后版本盖章为 {cur}({v})")
    frm = js("(function(){var m=appData.__migration;if(!m||!m.runs||!m.runs.length)return null;return m.runs[0].from;})()")
    check(frm == '3.7', f"迁移审计记录 from=3.7({frm})")

@case("C17 M1备份校验器", tier="core", owner="01b_engine_data")
def c17():
    good = js("(function(){var b=createDefaultAppData();b.settings=Object.assign({},defaultSettings);b.version=appData.version||'3.9';var v=validateBackup(b);return JSON.stringify([v.ok,v.warns.length]);})()")
    check('[true,0]' == str(good), f"合法备份通过无警告({good})")
    bad = js("(function(){var v=validateBackup({records:[{type:'full'}]});return JSON.stringify([v.ok,v.reason]);})()")
    check('[false' in str(bad) and 'settings' in str(bad), f"缺 settings 被拒且给出原因({bad})")
    wrn = js("(function(){var b=createDefaultAppData();b.settings=Object.assign({},defaultSettings);delete b.tree;delete b.version;delete b.dataVersion;var v=validateBackup(b);return v.ok+'|'+v.warns.length;})()")
    check(str(wrn).startswith('true|'), f"缺 tree/version 给兼容警告({wrn})")
    # exportSchema 版本校验——当前 schema=1 放行 / 更高 schema 拒收并提示升级
    cur = js("(function(){var b=createDefaultAppData();b.settings=Object.assign({},defaultSettings);b.version=appData.version||'3.9';b.exportSchema=1;var v=validateBackup(b);return JSON.stringify([v.ok,v.warns.length]);})()")
    check('[true,0]' == str(cur), f"exportSchema=当前版本通过({cur})")
    fut = js("(function(){var b=createDefaultAppData();b.settings=Object.assign({},defaultSettings);b.exportSchema=99;var v=validateBackup(b);return JSON.stringify([v.ok,String(v.reason)]);})()")
    check('[false' in str(fut) and 'schema' in str(fut), f"exportSchema=更高版本被拒并提示({fut})")

@case("C18 M1标签注入转义", tier="core", owner="01e_engine_ui 01g_engine_init")
def c18():
    js("switchView('plan')"); time.sleep(0.3)
    js("(function(){window.__xss=0;appData.usedTags=['<img src=x onerror=\"window.__xss=1\">','学习'];(typeof renderUsedTagsRow==='function')&&renderUsedTagsRow();return 1;})()")
    time.sleep(0.2)
    imgs = js("(function(){var c=document.getElementById('addTodoUsedTags');return c?c.querySelectorAll('img').length:-1;})()")
    check(int(imgs or 0) == 0, "恶意标签未被执行(无 img 节点)")
    xss = js("window.__xss")
    check(int(xss or 0) == 0, "onerror 未触发")
    txt = js("(function(){var c=document.getElementById('addTodoUsedTags');return c?c.textContent:'';})()")
    check('<img' in str(txt), "恶意标签以纯文本显示(转义生效)")
    js("(function(){appData.usedTags=[];try{renderUsedTagsRow();}catch(e){}return 1;})()")

# ================= M3 体验专项用例 =================
@case("C19 小屏无横向溢出", tier="core", owner="01e_engine_ui template.html 09_a11y")
def c19():
    cdp("Emulation.setDeviceMetricsOverride", {"width": 320, "height": 900, "deviceScaleFactor": 1, "mobile": False})
    time.sleep(0.6)
    # 环境哨兵：内置浏览器会把字体整体放大（实测 html font-size 23.2px = 1.45×）。
    # 应用 CSS 的字号全是 px，于是文字宽度跟着涨 45%，按 px 量的宽度断言不再可比。
    # 这是**环境差异**，不是应用缺陷——所以缩放下的失败只记「未验证」，不下结论；
    # 而缩放下的**通过**是更强结论（更挤都放得下），照记 PASS。
    zoom = 1.0
    try:
        fs = js("parseFloat(getComputedStyle(document.documentElement).fontSize)||16")
        zoom = float(fs) / 16.0
    except Exception:
        zoom = 1.0
    bad = []
    for v in ["timer", "plan", "log", "stats", "settings"]:
        js(f"switchView('{v}')"); time.sleep(0.22)
        sw = js("document.documentElement.scrollWidth")
        iw = js("window.innerWidth")
        try:
            if int(sw or 0) > int(iw or 0) + 1:
                # 报出真正撑宽页面的元素（排除被 overflow 祖先裁掉的），
                # 否则只知道「328>320」，还得再手工查一轮。
                who = js(OVERFLOW_PROBE)
                bad.append(f"{v}({sw}>{iw} ← {who})")
        except Exception:
            pass
    if bad and zoom > 1.05:
        unverified("320px 五视图无横向溢出：本环境浏览器字体缩放 %.2fx（html %s），"
                   "px 宽度断言不可比，需在真机 Via / 无头 chromium 复测。实测溢出 %s"
                   % (zoom, js("getComputedStyle(document.documentElement).fontSize"),
                      ";".join(bad)))
    else:
        check(not bad, f"320px 五视图均无横向溢出({';'.join(bad) if bad else 'ok'})")
    cdp("Emulation.setDeviceMetricsOverride", {"width": 500, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
    time.sleep(0.5)
    js("switchView('timer')"); time.sleep(0.2)

@case("C20 M3公告不挡手", tier="feature", owner="01e_engine_ui 07_uiFold template.html")
def c20():
    # 若公告元素不存在（旅程模块未注入时）手工补一个同结构的用于验证 CSS/交互
    js("""(function(){
      if(document.getElementById('jyAnn'))return 1;
      var a=document.createElement('div');a.className='jy-ov jy-nb';a.id='jyAnn';
      a.innerHTML='<div class="jy-card"><button class="jy-btn" id="jyAnnSkip">跳过</button></div>';
      document.body.appendChild(a);return 1;})()""")
    js("(function(){var o=document.getElementById('jyAnn');o.classList.add('jy-open');return 1;})()")
    time.sleep(0.2)
    pe = js("(function(){var o=document.getElementById('jyAnn');return o?getComputedStyle(o).pointerEvents:'';})()")
    check(pe == "none", f"公告背景点击可穿透(pointerEvents={pe})")
    # 公告开着时，计时页精力/心情格子仍可点选（此前被遮罩拦截导致"选不了"）
    v6 = js("(function(){var c=document.querySelector('#startEnergyPicker .grid-cell[data-val=\"6\"]');if(c)c.click();return getGridValue('startEnergyPicker');})()")
    check(v6 == 6, f"公告打开时精力格子可点选(v={v6})")
    v8 = js("(function(){var c=document.querySelector('#startMoodPicker .grid-cell[data-val=\"8\"]');if(c)c.click();return getGridValue('startMoodPicker');})()")
    check(v8 == 8, f"公告打开时心情格子可点选(v={v8})")
    # 卡片按钮仍可用（点"跳过"关闭）
    js("(function(){var b=document.getElementById('jyAnnSkip');if(b)b.click();return 1;})()")
    time.sleep(0.15)
    closed = js("(function(){var o=document.getElementById('jyAnn');return !!o&&!o.classList.contains('jy-open');})()")
    check(closed is True, "公告卡片按钮可正常关闭")
    js("(function(){var o=document.getElementById('jyAnn');if(o){o.classList.remove('jy-open');}return 1;})()")

@case("C21 选填区折叠记忆+极简联动", tier="feature", owner="01e_engine_ui 01e4_ui_ux 07_uiFold 0E_theme template.html")
def c21():
    # 全新用户态：清存储重载
    js("localStorage.clear();location.reload()"); time.sleep(2.8)
    check(js("typeof window.__uiFold!=='undefined'") is True, "折叠模块注入")
    st = js("window.__uiFold.state()")
    # 契约变更：计时页「当前状态」（选填、偏复盘）改为**首进默认收起**；
    #   「任务难度」决定计时档位属高频 → 保持默认展开。
    check(isinstance(st, dict) and st.get("timer_state") is True and st.get("timer_diff") is False,
          "计时页：当前状态默认收起 / 任务难度默认展开")
    # 真实点击「任务难度」标题 → 收起
    js("""(function(){
      var ss=document.querySelectorAll('#view-timer .current-todo-section > .state-section');
      var t=null;for(var i=0;i<ss.length;i++){var c=ss[i].children[0];if(c&&(c.textContent||'').indexOf('任务难度')>=0){t=c;break;}}
      if(t)t.click();return 1;})()""")
    time.sleep(0.2)
    st = js("window.__uiFold.state()")
    check(isinstance(st, dict) and st.get("timer_diff") is True, "点标题可收起任务难度")
    raw = read_ui_fold_raw() or "{}"
    check('"timer_diff":false' in raw.replace(' ', ''), "折叠偏好已持久化")
    # 重载 → 手动收起状态恢复
    js("location.reload()"); time.sleep(2.8)
    st = js("window.__uiFold.state()")
    check(isinstance(st, dict) and st.get("timer_diff") is True and st.get("timer_state") is True,
          "重载后手动收起仍保持(记忆)")
    # 极简开启（真实开关）→ 两选填区默认收起
    js("""(function(){var ck=document.getElementById('setMinimalMode');if(ck)ck.checked=true;
      if(typeof toggleMinimalMode==='function')toggleMinimalMode();return 1;})()""")
    time.sleep(0.3)
    st = js("window.__uiFold.state()")
    check(isinstance(st, dict) and st.get("timer_state") is True and st.get("timer_diff") is True,
          "极简模式两选填区默认收起")
    check(js("document.body.classList.contains('minimal-mode')") is True, "body.minimal-mode 生效")
    # 极简下可临时展开某块（仅会话）
    js("window.__uiFold.toggle('timer_state')"); time.sleep(0.2)
    st = js("window.__uiFold.state()")
    check(isinstance(st, dict) and st.get("timer_state") is False, "极简下可临时展开当前状态")
    # 关极简 → 恢复手动偏好（任务难度仍收、当前状态回到默认开）
    js("""(function(){var ck=document.getElementById('setMinimalMode');if(ck)ck.checked=false;
      if(typeof toggleMinimalMode==='function')toggleMinimalMode();return 1;})()""")
    time.sleep(0.3)
    st = js("window.__uiFold.state()")
    # timer_state 无手动偏好 → 关闭极简后回到**首进默认收起**（原契约是"默认展开"）
    check(isinstance(st, dict) and st.get("timer_diff") is True and st.get("timer_state") is True,
          "关闭极简→恢复手动记忆状态")
    # 清理现场
    js("""(function{ /* 折叠偏好已入主存储，不再清理旧独立键 */
      var ck=document.getElementById('setMinimalMode');if(ck)ck.checked=false;
      if(typeof toggleMinimalMode==='function')toggleMinimalMode();return 1;})()""")

@case("C22 组件注册表 registerComponent", tier="core", owner="08_component_registry 01e_engine_ui 01e4_ui_ux 07_uiFold")
def c22():
    js("localStorage.clear();location.reload()"); time.sleep(2.8)
    check(js("typeof window.registerComponent==='function'") is True, "注册表已注入")
    # 注册一个演示组件：自带样式 + 挂载 + 极简隐藏 + 折叠记忆
    nm = js("""(function(){
      var h=window.registerComponent({
        name:'demo_reg_test',
        styleText:'.demo-reg-test{border:2px dashed #888;border-radius:10px;padding:10px;margin:10px 0;font-size:13px;color:var(--text-light);}',
        host:function(){return document.getElementById('view-settings');},
        mount:function(hst){
          var box=document.createElement('div');box.className='demo-reg-test';box.id='demoRegBox';
          var t=document.createElement('div');t.className='state-section-title';t.textContent='🧪 注册表演示';
          box.appendChild(t);
          var body=document.createElement('div');body.id='demoRegBody';body.textContent='一行注册拉起的组件。';
          box.appendChild(body);
          hst.appendChild(box);return box;
        },
        minimalHide:true,
        foldBox:{key:'demo_reg_fold',title:'#demoRegBox .state-section-title'}
      });
      return h?h.name:null;})()""")
    check(nm == "demo_reg_test", "registerComponent 一行注册成功")
    time.sleep(0.3)
    check(js("!!document.getElementById('demoRegBox')") is True, "mount 已插入宿主")
    check(js("(window.__comp.list()||[]).indexOf('demo_reg_test')>=0") is True, "注册表可查询到组件")
    check(js("document.getElementById('__compCss')!==null") is True, "框架统一样式节点存在")
    cssTxt = js("document.getElementById('__compCss')?document.getElementById('__compCss').textContent:''") or ""
    check(".demo-reg-test" in cssTxt, "组件自带样式已自动注入")
    st0 = js("window.__uiFold.state()")
    check(isinstance(st0, dict) and st0.get("demo_reg_fold") is False, "注册表折叠块默认展开")
    # 折叠记忆：点标题收起 → 正文隐藏 → 偏好记录
    js("(function(){var t=document.querySelector('#demoRegBox .state-section-title');if(t)t.click();return 1;})()")
    time.sleep(0.25)
    st = js("window.__uiFold.state()")
    check(isinstance(st, dict) and st.get("demo_reg_fold") is True, "折叠块可点标题收起")
    check(js("(function(){var b=document.getElementById('demoRegBody');return b?getComputedStyle(b).display:'';})()") == "none",
          "折叠后正文隐藏(display none)")
    # 极简隐藏联动：框架规则生效
    js("document.body.classList.add('minimal-mode')")
    time.sleep(0.35)
    check(js("(function(){var b=document.getElementById('demoRegBox');return b?getComputedStyle(b).display:'';})()") == "none",
          "极简模式自动隐藏组件(minimalHide)")
    js("document.body.classList.remove('minimal-mode')")
    time.sleep(0.25)
    check(js("(function(){var b=document.getElementById('demoRegBox');return b?getComputedStyle(b).display:'';})()") == "block",
          "退出极简后组件恢复显示")
    # 卸载：DOM/样式/折叠登记/偏好 全清
    js("window.__comp.deregister('demo_reg_test')")
    time.sleep(0.25)
    check(js("!document.getElementById('demoRegBox')") is True, "卸载后 DOM 已移除")
    cssTxt2 = js("document.getElementById('__compCss')?document.getElementById('__compCss').textContent:''") or ""
    check(".demo-reg-test" not in cssTxt2, "卸载后组件样式已移除")
    raw = read_ui_fold_raw() or "{}"
    check('"demo_reg_fold"' not in raw, "卸载后折叠偏好已清理")
    # 现场还原
    js("""(function{ /* 折叠偏好已入主存储，不再清理旧独立键 */
      var ck=document.getElementById('setMinimalMode');if(ck)ck.checked=false;
      if(typeof toggleMinimalMode==='function')toggleMinimalMode();return 1;})()""")

@case("C21b 默认态收敛：手动偏好不被默认值吞掉", tier="feature", owner="01e_engine_ui 01e4_ui_ux 07_uiFold 0E_theme template.html")
def c21b():
    """守护 的核心不变量。
    背景（曾踩坑）：首版 defaultClosed 把"系统默认值"直接写进用户偏好 pref，
    导致下次启动误判"用户已选择收起"，**用户手动展开的偏好被默认值吞掉**
    （现象：展开 → 刷新 → 又变回收起）。修正后 defaultClosed 只登记标记、绝不落盘。
    本用例锁死该行为，防止回归。"""
    js("localStorage.clear();location.reload()"); time.sleep(2.8)
    # 1) 首访：timer_state 默认收起（无手动偏好）
    # 所有「重载后再取值」一律走 wait_until：旧文档可能把命令取走却来不及作答
    # （桥只保证送达），单发一次必然偶发失败——这是传输层的竞态，不是应用行为。
    _st = "(function(){try{return (typeof window.__uiFold!=='undefined')&&window.__uiFold&&window.__uiFold.state();}catch(e){return null;}})()"
    st = wait_until(_st, timeout=12)
    check(isinstance(st, dict) and st.get("timer_state") is True, "首访：当前状态默认收起")
    pref0 = wait_until("(function(){try{return JSON.stringify(window.__uiFold._pref());}catch(e){return '';}})()", timeout=8)
    check("timer_state" not in str(pref0), "首访：默认收起**不写入**用户偏好(pref 无 timer_state)")
    # 2) 用户手动展开（真实 toggle）
    js("window.__uiFold.toggle('timer_state')"); time.sleep(0.4)
    st = wait_until(_st, timeout=8)
    check(isinstance(st, dict) and st.get("timer_state") is False, "手动展开当前状态")
    # 3) 重载 → 必须保持"已展开"（不得被默认收起吞掉）
    js("location.reload()"); time.sleep(2.8)
    st = wait_until(_st, timeout=12)
    check(isinstance(st, dict) and st.get("timer_state") is False,
          "★重载后仍保持手动展开（默认值未吞用户偏好）")
    # 4) 再手动收起 → 重载仍保持收起
    js("window.__uiFold.toggle('timer_state')"); time.sleep(0.4)
    js("location.reload()"); time.sleep(2.8)
    st = wait_until(_st, timeout=12)
    check(isinstance(st, dict) and st.get("timer_state") is True, "再收起后重载仍保持收起")
    js("localStorage.clear();location.reload()"); time.sleep(2.0)


@case("C23 纯函数 Node 单测", tier="core", owner="00_pure_core 01d6_engine_util")
def c23():
    import subprocess as _sp
    base = os.path.dirname(os.path.abspath(__file__))
    try:
        r = _sp.run(["node", os.path.join(base, "tests", "unit_pure.js")],
                    capture_output=True, text=True, timeout=90)
        out = (r.stdout or "") + (r.stderr or "")
        check(r.returncode == 0, f"node 纯函数单测退出码 0(rc={r.returncode})")
        # 不写死通过数（用例会随 00_pure_core 扩充），只要求全过且无失败
        import re as _re
        _m = _re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
        check(bool(_m) and int(_m.group(1)) >= 21 and _m.group(2) == "0",
              f"纯函数单测全绿(实际 {(_m.group(1) if _m else '?')}/{(_m.group(1) if _m else '?')})")
        # 浏览器侧同源：00_pure_core 的全局函数可用且与引擎内使用一致
        v = js("(function(){return (typeof getDateStr==='function')&&(typeof getPomos==='function')&&(typeof window.__pure!=='undefined');})()")
        check(v is True, "浏览器侧 00_pure_core 全局可用(__pure 已挂)")
        v2 = js("getDateStr(new Date(2026,8,4,13,30))")
        check(v2 == "2026-09-04", f"浏览器 getDateStr 与 Node 同实现(v={v2})")
    except Exception as e:
        check(False, "node 单测运行异常: " + str(e))

@case("C24 倒数日：勾选上计划页 + 导出导入往返", tier="feature", owner="00_pure_core 01b_engine_data 01e_engine_ui")
def c24():
    """两条约定，固化成断言：
    ① 计划页不该被倒数日塞满 —— 由玩家勾选决定谁上；**没勾的谁也不上**（原先是自动
       顶上「最近 1 条」，会让人以为「没勾的也被加进去了」、且新加一个就把
       原来那行换掉，故改为：不勾 = 一条不显示，只留进入口）；
    ② 新增的 pinned / note 字段必须能跟着导出备份走，老备份导入要能补齐。"""
    base = "(function(){appData.countdowns=[];for(var i=0;i<12;i++){appData.countdowns.push({id:1000+i,icon:'📌',title:'事项'+i,date:getDateStr(new Date(Date.now()+(i+1)*86400000)),note:i===3?'带身份证':'',pinned:0});}renderCountdowns();renderPlanCountdowns();return appData.countdowns.length;})()"
    check(js(base) == 12, "种 12 个倒数日")
    # ① 一个都不勾 → 计划页一个条目都不显示（不能自动顶上最近那条），只留一行进入口
    txt1 = str(js("(document.getElementById('planCountdownList')||{}).textContent||''"))
    check("事项0" not in txt1 and "事项5" not in txt1,
          f"全不勾时计划页不显示任何条目({txt1})")
    check("全部 12 个" in txt1, f"全不勾时有「全部 12 个 ▸」进入口({txt1})")
    # ①b 那个入口必须真的能跳到倒数日 —— 「倒数日」整块已移入**计划页**的子标签，
    #     入口走 switchPlanTab('countdown')。三样缺一不可：视图仍停在 view-timer、
    #     计划页子标签切到「倒数日」、planCountdownView 真的变成 block
    #     （点了没反应 = 入口形同虚设，报过的就是这个）
    js("var _e=document.querySelector('#planCountdownList > div[onclick],#planCountdownList > div[data-act]');if(_e)_e.click();")
    jumps = js("(function(){var cv=document.getElementById('planCountdownView');"
               "return JSON.stringify({v:(document.querySelector('.view.active')||{}).id,"
               "t:(document.querySelector('#view-plan .log-tab.active')||{}).textContent,"
               "cd:cv?getComputedStyle(cv).display:'none'});})()")
    check('view-timer' in str(jumps) and "倒数日" in str(jumps) and '"cd":"block"' in str(jumps),
          f"计划页入口能真正跳到倒数日页({jumps})")
    js("switchView('plan')")
    # ② 勾选 2 个 → 计划页只出这 2 个（数量由玩家控制，不再截断），没勾的一律不出现
    js("toggleCountdownPin(1003)"); js("toggleCountdownPin(1007)")
    txt2 = str(js("(document.getElementById('planCountdownList')||{}).textContent||''"))
    check("事项3" in txt2 and "事项7" in txt2,
          f"勾选 2 个后计划页显示这 2 个({txt2})")
    check("事项0" not in txt2 and "事项5" not in txt2,
          f"勾选后没勾的仍然不出现({txt2})")
    # ②b 复盘区同规则：没勾时不顶上最近一条（否则「没添加的也自己出现在复盘里」）
    js("appData.countdowns.forEach(function(c){c.pinned=0;});switchView('log');switchLogTab('diary');renderDiary()")
    dh = str(js("(function(){var dd=document.getElementById('diaryCountdownDropdown');return dd?dd.parentElement.firstElementChild.textContent:'';})()"))
    check("全部 12 个" in dh, f"复盘区没勾时不顶最近一条，只留展开入口({dh})")
    js("appData.countdowns[3].pinned=1;renderDiary()")
    dh2 = str(js("(function(){var dd=document.getElementById('diaryCountdownDropdown');return dd?dd.parentElement.firstElementChild.textContent:'';})()"))
    check("事项3" in dh2, f"复盘区勾了就显示那一条({dh2})")
    js("switchView('plan');renderPlanCountdowns()")
    # ③ 排序：切「按添加」应让最后添加的 id 最大者排最前
    js("setCountdownSort('added')")
    first = js("(document.querySelector('#countdownList .countdown-title')||{}).textContent||''")
    check(first == "事项11", f"按添加时间排序：最后一次添加的排最前(实际 {first})")
    js("setCountdownSort('date')")
    first2 = js("(document.querySelector('#countdownList .countdown-title')||{}).textContent||''")
    check(first2 == "事项0", f"按日期排序：最近日期排最前(实际 {first2})")
    # ④ 导出必须带新字段（导出是通用遍历，这里锁住它别被将来「挑字段」的改动破坏）
    exp = js("(function(){var bk={};Object.keys(appData).forEach(function(k){bk[k]=appData[k];});return JSON.stringify(bk.countdowns[3]);})()")
    check('"note":"带身份证"' in str(exp) and '"pinned"' in str(exp),
          f"导出 JSON 含 note 与 pinned({exp})")
    # ⑤ 往返：导出 → 清空 → 走真实导入路径，字段必须一字不差
    rt = js(
        "(function(){var bk={};Object.keys(appData).forEach(function(k){bk[k]=appData[k];});"
        "var s=JSON.stringify(bk);appData.countdowns=[];applyBackupData(JSON.parse(s),'test');"
        "var c=appData.countdowns.filter(function(x){return x.id===1003;})[0]||{};"
        "return JSON.stringify({n:c.note,p:c.pinned,cnt:appData.countdowns.length});})()")
    check('"n":"带身份证"' in str(rt) and '"p":1' in str(rt),
          f"导出导入往返：note/pinned 一字不差({rt})")
    # ⑥ 老备份（没有 pinned/note）导入要补齐，不能变 undefined
    old = js(
        "(function(){applyBackupData({version:'3.8',records:[],settings:{},countdowns:[{id:55,icon:'📌',title:'老数据',date:'2026-12-01'}]},'test');"
        "var c=appData.countdowns[0]||{};return JSON.stringify({n:c.note,p:c.pinned,id:c.id});})()")
    check('"n":""' in str(old) and '"p":0' in str(old),
          f"老备份导入：note/pinned 自动补默认值({old})")
    js("appData.countdowns=[];renderCountdowns();renderPlanCountdowns();")

@case("C25 设置默认值默认关 + 迁移只补缺、不覆盖用户选择", tier="core", owner="01b_engine_data 0A_默认态收敛 01g_engine_init")
def c25():
    """两个开关的默认值与 v2 迁移契约（2026-10-22 修订）。

    **契约变了，测试跟着变**：语音播报的默认值已由 false 改为 true
    （「这功能的全部价值就在不用看屏幕也知道进程，默认关等于没做」）。
    autoNext 仍是 false —— 它被错写成 true 会在无人值守时跑完一个番茄并落假记录。

    两者在迁移里**不再同等对待**，因为数据风险不对等：autoNext 有、voice 没有。

    四条：
    ① 全新存档：autoNext=false、voice=true、enhUIv=3，UI 渲染与之一致；
    ② v2 老存档 {autoNext:true, voice:true} → 只修正 autoNext，voice 保持 true；
    ③ v2 老存档 {autoNext:false, voice:true} → 一个字不改；
    ④ 已是 v3 的存档显式打开 → 永不再被翻回去。"""
    probe = (
        "(function(){try{if(typeof appData==='undefined'||!appData)return '';"
        "var s=appData.enhSettings||{};"
        "var a=document.getElementById('enhAutoNext'),v=document.getElementById('enhVoice');"
        "return JSON.stringify({a:s.autoNext,v:s.voice,iv:s.enhUIv,"
        "ui:a?!!a.checked:null,uiv:v?!!v.checked:null});"
        "}catch(e){return '';}})()")

    def boot_with(enh, label):
        """把设置写进存档 → 重载 → 走真实启动路径后取回实际状态。"""
        js("(function(){appData.enhSettings=%s;saveDataNow();return 1;})()" % enh)
        js("location.reload()")
        time.sleep(2.6)
        return str(wait_until(probe, timeout=12))

    # ① 全新用户（清空存储后重载）
    js("localStorage.clear();location.reload()")
    time.sleep(2.6)
    fs = str(wait_until(probe, timeout=12))
    check('"a":false' in fs, f"新装默认：自动开始下一轮 = 关({fs})")
    check('"v":true' in fs, f"新装默认：语音播报 = 开（新契约）({fs})")
    check('"iv":3' in fs, f"新装直接盖到 v3，不会再走修正({fs})")
    if '"ui":null' in fs:
        unverified("C25 设置开关渲染：settings 组未在启动时注入，未取到 #enhAutoNext")
    else:
        check('"ui":false' in fs, f"新装默认：设置里该开关渲染为关({fs})")
        check('"uiv":true' in fs, f"新装默认：语音开关渲染为开（新契约）({fs})")

    # ② v2 存档、两个值都是坏迁移写进去的原样 → 回声修正
    r2 = boot_with("{autoNext:true,voice:true,enhUIv:2}", "v2 未动过")
    check('"a":false' in r2 and '"v":true' in r2,
          f"v2 存档：只修正 autoNext，voice 不再翻转({r2})")
    check('"iv":3' in r2, f"修正后版本升到 v3，不会再跑({r2})")

    # ③ v2 存档但用户动过其中一个 → 指纹破了，一个字不许改
    r3 = boot_with("{autoNext:false,voice:true,enhUIv:2}", "v2 动过 voice")
    check('"a":false' in r3 and '"v":true' in r3,
          f"用户动过其一时原样保留，不做修正({r3})")

    # ④ v3 存档显式打开 → 永不再被翻回
    r4 = boot_with("{autoNext:true,voice:true,enhUIv:3}", "v3 显式开")
    check('"a":true' in r4 and '"v":true' in r4,
          f"已是 v3 的存档显式开启被尊重，不再被翻回({r4})")

    # 收尾：还原成干净新存档
    js("localStorage.clear();location.reload()")
    time.sleep(2.4)

@case("C110 存储适配层：写戳必须同步落盘，TFStorage 不得缓冲", tier="feature", owner="01b1_storage 01b_engine_data")
def c110():
    """数据安全回查（2026-10-22）。

    `_guardStaleWrite()` 靠 `WRITE_STAMP_KEY` 判断「另一个窗口是不是比我先写过」。
    这个判断的前提是：**读到的必须是存储里的真实值**。一旦适配层做了任何缓冲/延迟，
    守卫就会读到旧戳 → 防覆盖机制失效 → 复现 2026-10-20 那次丢数据。
    这条用例直接验证「写进去之后，同一个 tick 从 localStorage 原样读得到」。
    """
    r = js(
        "(function(){try{"
        "var K='tomato_focus_v3', SK=K+'_stamp', T=Date.now();"
        "TFStorage.write(SK, JSON.stringify({id:'probe',t:T}));"
        "var raw=localStorage.getItem(SK);"
        "var o=null; try{o=JSON.parse(raw||'null');}catch(e){}"
        "return JSON.stringify({raw:raw!==null, same:TFStorage.read(SK)===raw,"
        " t:(o&&o.t)||0, expect:T, mode:TFStorage.mode});"
        "}catch(e){return 'EXC:'+e.message;}})()")
    check('"raw":true' in str(r), f"写戳已落盘({r})")
    check('"same":true' in str(r), f"经适配层读回与直读一致，无缓冲({r})")
    check('"mode":"local"' in str(r), f"适配层处于本地直通模式({r})")
    for m in __import__("re").finditer(r'"t":(\d+),"expect":(\d+)', str(r)):
        t, exp = int(m.group(1)), int(m.group(2))
        check(t == exp, f"写戳时间等于刚写入值（{t} vs {exp}）")
    js("(function(){try{localStorage.removeItem('tomato_focus_v3_stamp');}catch(e){}return 1;})()")

@case("C26 点「结束」必进休息 + 自由专注可填任务名/备注/状态", tier="feature", owner="01b_engine_data 01c_engine_timer 01e_engine_ui 01e8_ui_misc 01g_engine_init 02_enh571 0E_theme 01f_engine_immersive")
def c26():
    """两条约定：
    ① 「选 10 分钟档位，专注结束了不提示休息，也没有休息时间」—— 复现发现
       `01d_engine_features.js` 进休息的条件是 `if (type !== 'incomplete')`：
       结算选「未完成」就一声不响回到待机（无弹窗、无提示，界面上看不到这条规则）。
       「只要点击结束，就直接进休息，本来休息也能跳过」。
    ② 「自由专注为什么不能像番茄那样输入任务名字记录」—— 原先 `applyTimerModeUI()`
       把整个 `.current-todo-section` 藏掉（没地方填），`finishFreeWithSecs()` 又把
       taskName 写死成 '自由专注'、note 写死、心情精力写死 null（填了也没用）。
       现改为只藏番茄专属控件，输入区保留并真实落库。

    六条：①未完成 → 进短休 ②半个 → 进短休（回归保护）③自由模式保留任务名/备注/状态/选择计划、
    藏「任务难度/时长建议」④自由 ≥25 分钟落库带真实名/备注/状态
    ⑤自由 <25 分钟 history 也带任务名 ⑥切回番茄控件复原。"""
    js("switchView('timer')")
    # ① 手动结束、结算选「未完成」→ 必须进短休
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}"
       "appData.settings.immersiveFocus=false;startPomodoroCore();"
       "timerState.startTime=Date.now()-180*1000;timerState.effectiveSeconds=180;finishPomodoro();return 1;})()")
    t1 = js("(document.getElementById('finishType')||{}).value")
    check(t1 == "incomplete", f"跑 3 分钟时结算默认「未完成」({t1})")
    js("confirmFinish()")
    BRK = "(timerState&&(timerState.mode==='shortBreak'||timerState.mode==='longBreak'))?timerState.mode:''"
    m1 = str(wait_until(BRK, timeout=6))
    check(m1 in ("shortBreak", "longBreak"),
          f"选「未完成」也进休息（原先静默回待机）(mode={m1})")
    btn = str(js("(document.getElementById('btnInterrupt')||{}).textContent||''"))
    check("跳过休息" in btn, f"休息可跳过，所以不该有隐藏门槛({btn})")
    # ② 回归：半个🍅 仍然进休息
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}startPomodoroCore();"
       "timerState.startTime=Date.now()-480*1000;timerState.effectiveSeconds=480;finishPomodoro();return 1;})()")
    js("confirmFinish()")
    m2 = str(wait_until(BRK, timeout=6))
    check(m2 in ("shortBreak", "longBreak"), f"结算「半个🍅」照样进休息(mode={m2})")
    # ③ 自由专注：输入区保留，番茄专属控件藏起来
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('stopwatch');setFreeType('stopwatch');return 1;})()")
    vis = str(js(
        "(function(){var g=function(id){var e=document.getElementById(id);return e?getComputedStyle(e).display:'no-el';};"
        "return JSON.stringify({inp:g('currentTodoInput'),note:g('currentTodoNote'),"
        "en:g('startEnergyPicker'),sel:g('currentTodoSelect'),dif:g('difficultySection')});})()"))
    check('"inp":"none"' not in vis and '"inp":"no-el"' not in vis,
          f"自由专注保留任务名输入框({vis})")
    check('"note":"none"' not in vis and '"note":"no-el"' not in vis,
          f"自由专注保留备注输入框({vis})")
    # 2026-10-18 起产品决定：自由专注**保留**「选择计划」，这笔账才能挂到计划上
    # （原先连它一起藏，导致正计时选不了任务、日程画不出实际块）。C26 的旧期望是在那之前写的。
    check('"sel":"none"' not in vis and '"sel":"no-el"' not in vis,
          f"自由专注保留「选择计划」（2026-10-18 起）({vis})")
    check('"dif":"none"' in vis, f"自由专注藏掉番茄专属的「任务难度」({vis})")
    # ④ 自由专注 ≥25 分钟 → 落库用真实任务名/备注/状态
    n0 = js("appData.records.length")
    js("(function(){document.getElementById('currentTodoInput').value='背英语单词';"
       "document.getElementById('currentTodoNote').value='第 3 单元';"
       "setGridValue('startEnergyPicker',7);setGridValue('startMoodPicker',8);"
       "toggleFreeTimer();timerState.startTime=Date.now()-30*60*1000;finishFreeTimer();confirmFinish();return 1;})()")
    rec = str(js("(function(){var r=appData.records[appData.records.length-1];"
                 "return JSON.stringify({n:appData.records.length,t:r.taskName,note:r.note,se:r.startEnergy,sm:r.startMood});})()"))
    check(js("appData.records.length") == n0 + 1, "自由专注满 25 分钟仍计入正式记录")
    check('"t":"背英语单词"' in rec, f"记录里不再写死「自由专注」，用用户填的名字({rec})")
    check('"note":"第 3 单元"' in rec, f"备注按用户填的落库({rec})")
    check('"se":7' in rec and '"sm":8' in rec, f"开始时的精力/心情一并记录({rec})")
    # ⑤ 自由专注 <25 分钟 → history 也带任务名（原先这里什么名字都没有）
    js("(function(){document.getElementById('currentTodoInput').value='整理错题';"
       "document.getElementById('currentTodoNote').value='';"
       "toggleFreeTimer();timerState.startTime=Date.now()-12*60*1000;finishFreeTimer();confirmFinish();return 1;})()")
    h = str(js("(function(){var x=appData.freeFocus.history[appData.freeFocus.history.length-1];"
               "return JSON.stringify({t:x.taskName,m:x.mins});})()"))
    check('"t":"整理错题"' in h, f"不足 25 分钟的时段也留下任务名({h})")
    # ⑥ 切回番茄：藏起来的控件要复原（'pomodoro' 才是番茄，其它值是自由专注）
    js("switchTimerMode('pomodoro')")
    vis2 = str(js(
        "(function(){var g=function(id){var e=document.getElementById(id);return e?getComputedStyle(e).display:'no-el';};"
        "return JSON.stringify({inp:g('currentTodoInput'),sel:g('currentTodoSelect'),dif:g('difficultySection')});})()"))
    check('"sel":"none"' not in vis2 and '"dif":"none"' not in vis2,
          f"切回番茄时钟后「选择计划/任务难度」复原({vis2})")
    # 收尾：清掉本轮造的记录，别污染后面的用例
    js("(function(){appData.records=appData.records.slice(0,%d);"
       "document.getElementById('currentTodoInput').value='';"
       "document.getElementById('currentTodoNote').value='';"
       "if(timerState.mode!=='idle'){resetToIdle();}saveData();return 1;})()" % n0)

@case("C27 正计时/流式结束也进休息 + 休息时长分级（长休封顶 20）", tier="feature", owner="01c_engine_timer 01d2 01e_engine_ui 01e8_ui_misc 01g_engine_init 02_enh571")
def c27():
    """正计时结束、流式计时结束也应该有休息：
    不同的时间长度应该有不同的休息时间吧」，并定口径：「实际专注 ≥5 分钟才进」
    「最多休息 20 分钟」。

    原先 `finishFreeWithSecs()` 里一次 startBreak 都没有 —— 正计时和流式「结束并结算」
    都静默回待机（与番茄选「未完成」同类）。
    分级表 `getBreakByDuration()` 本来就存在，但长休 30/40 超过上限 → 封顶 20。

    七条：①分级表逐档正确且长休 ≤20 ②10 分钟档短休=3 分 ③正计时 30 分钟结束 → 进短休 5 分
    ④正计时 2 分钟结束 → 不进休息（门槛）⑤流式 50 分钟结束 → 进短休 10 分
    ⑥长休时长也封顶 ⑦切成番茄仍按番茄档位算（回归）。"""
    js("switchView('timer')")
    # ① getBreakByDuration 分级表（直接查表，不依赖计时）
    tbl = str(js(
        "(function(){var save=timerState.totalDuration,out=[];"
        "[10,25,50,90].forEach(function(m){timerState.totalDuration=m*60;"
        "out.push(m+':'+getBreakByDuration(false)+'/'+getBreakByDuration(true));});"
        "timerState.totalDuration=save;return out.join(' ');})()"))
    check(tbl == "10:3/10 25:5/20 50:10/20 90:15/20", f"休息分级表逐档正确且长休封顶 20({tbl})")
    # ② 10 分钟档 短休应为 3 分钟
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}timerState.totalDuration=600;return 1;})()")
    check(js("getBreakByDuration(false)") == 3, "10 分钟档配 3 分钟短休")
    BRK = "(timerState&&(timerState.mode==='shortBreak'||timerState.mode==='longBreak'))?timerState.mode:''"
    # ③ 正计时 30 分钟结束 → 进短休 5 分钟（30 落 16-35 档）
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('stopwatch');"
       "setFreeType('stopwatch');toggleFreeTimer();"
       "timerState.startTime=Date.now()-30*60*1000;finishFreeTimer();confirmFinish();return 1;})()")
    m3 = str(wait_until(BRK, timeout=6))
    time.sleep(1.0)   # ★ 同上：等过兜底那一刀，验证休息时长不被改短
    b3 = js("Math.round((timerState.totalDuration||0)/60)")
    check(m3 == "shortBreak", f"正计时结束后进休息（原先静默回待机）(mode={m3})")
    check(b3 == 5, f"正计时 30 分钟 → 短休 5 分钟（按实际专注时长分级）(={b3})")
    # ④ 门槛：正计时 2 分钟结束 → 不进休息
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('stopwatch');"
       "setFreeType('stopwatch');toggleFreeTimer();"
       "timerState.startTime=Date.now()-120*1000;finishFreeTimer();confirmFinish();return 1;})()")
    m4 = str(js("timerState.mode"))
    check(m4 not in ("shortBreak", "longBreak"), f"不足 5 分钟不进休息，避免误点也弹({m4})")
    # ⑤ 流式 50 分钟结束 → 进短休 10 分钟（50 落 36-65 档）
    d5 = js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('flowtime');"
       "setFreeType('flowtime');toggleFreeTimer();"
       "timerState.startTime=Date.now()-50*60*1000;finishFreeTimer();"
       "var _pf=timerState.pendingFinish;_pf=_pf?(_pf.source+':'+_pf.secs):'null';"
       "var _sel=(document.getElementById('finishType')||{}).value;"
       "confirmFinish();return _pf+'|sel='+_sel;})()")
    m5 = str(wait_until(BRK, timeout=6))
    time.sleep(1.0)   # ★ 等过 01d 的 300ms 兜底休息兜一圈，防止「先读到正确值、随后被改短」漏检
    b5 = js("Math.round((timerState.totalDuration||0)/60)")
    check(m5 == "shortBreak", f"流式「结束并结算」也进休息(mode={m5} {d5})")
    check(b5 == 10, f"流式 50 分钟 → 短休 10 分钟、且不被兜底改短(={b5} {d5})")
    # ⑥ 长休封顶：无论多长都不超过 20
    cap = js("(function(){var save=timerState.totalDuration,mx=0;"
             "[5,10,25,50,90,180].forEach(function(m){timerState.totalDuration=m*60;"
             "mx=Math.max(mx,getBreakByDuration(true));});timerState.totalDuration=save;return mx;})()")
    check(cap <= 20, f"长休一律不超过 20 分钟（实测最大 {cap}）")
    # ⑦ 收尾：回番茄模式，别影响后面用例
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('pomodoro');return 1;})()")

@case("C28 微休息对自由专注同样适用（原先只认番茄）", tier="feature", owner="01c_engine_timer 01e_engine_ui 01g_engine_init 02_enh571")
def c28():
    """微休息对自由专注同样适用。

    原先三处把自由专注挡在外面：
      ① `scheduleNextMicroBreak()` 守卫 `mode !== 'focus'` → 自由专注从不排程
      ② `checkMicroBreak()` 同一守卫 → 即使排了也不检查
      ③ tick 的两个自由分支直接 `return`，走不到末尾的 `checkMicroBreak()`
    另有一处隐性坑：`intervalMs > timerState.remaining*1000` 只对倒计时类成立，
    正计时的 remaining 是「已跑秒数」，照抄会一启动就归零、永远不排。

    七条：①正计时启动即有排程 ②拨到过去后 tick 能弹出微休息 ③跳过会重新排程
    ④流式剩余不足一次间隔时不排（该守卫保留）⑤流式剩余充足时排
    ⑥待机/休息态不排（回归）⑦番茄照旧能排（回归）。"""
    js("switchView('timer')")
    js("(function(){appData.settings.microBreak=true;appData.settings.microMode='fixed';"
       "appData.settings.microInterval=5;appData.settings.microDuration=20;return 1;})()")
    # ① 正计时启动 → 有排程（原先恒为 0）
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('stopwatch');"
       "setFreeType('stopwatch');toggleFreeTimer();return 1;})()")
    check(js("timerState.mode") == 'free', "已进入自由专注（正计时）")
    n1 = js("(timerState.microNextAt||0) > Date.now()")
    check(n1 is True, "正计时启动后排了微休息（原先 mode!=='focus' 直接被挡）")
    # ② 拨到过去 → tick 检查后弹出微休息
    # 注意：wait_until 的表达式在「还没满足」时必须返回**假值**（'' 而不是 'n'），
    # 否则它把 'n' 当作有效值立刻返回，等于没等（本用例第一版就是这么错的）。
    js("(function(){timerState.microNextAt=Date.now()-1000;return 1;})()")
    up = str(wait_until("timerState.microActive===true?'y':''", timeout=8))
    check(up == "y", "正计时中途会弹出微休息浮层")
    # ③ 跳过 → 收掉浮层并重新排程
    js("skipMicroBreak()")
    check(js("timerState.microActive") is False, "跳过微休息后浮层收掉")
    js("(function(){timerState.microNextAt=Date.now()-1000;return 1;})()")
    wait_until("timerState.microActive===true?'y':''", timeout=8)
    js("skipMicroBreak()")
    check(js("(timerState.microNextAt||0) > Date.now()"), "跳过之后会排下一次微休息")
    # ④ 流式：剩余不足一次间隔 → 不排（守卫保留）
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('flowtime');"
       "setFreeType('flowtime');setFlowDuration(10);toggleFreeTimer();"
       "timerState.remaining=180;scheduleNextMicroBreak();return 1;})()")
    check(js("(timerState.microNextAt||0)") == 0, "流式剩余 3 分钟、间隔 5 分钟 → 不排（打扰不到）")
    # ⑤ 流式：剩余充足 → 排
    js("(function(){timerState.microBreakForce=1;timerState.totalDuration=3600;"
       "timerState.endAt=Date.now()+3600*1000;timerState.remaining=3600;scheduleNextMicroBreak();return 1;})()")
    check(js("(timerState.microNextAt||0) > Date.now()"), "流式剩余充足时正常排程")
    # ⑥ 待机态不排（回归）
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}scheduleNextMicroBreak();return 1;})()")
    check(js("(timerState.microNextAt||0)") == 0, "待机时不排微休息")
    # ⑦ 番茄照旧（回归）
    js("(function(){switchTimerMode('pomodoro');startPomodoroCore();"
       "timerState.totalDuration=1500;timerState.remaining=1500;scheduleNextMicroBreak();return 1;})()")
    check(js("(timerState.microNextAt||0) > Date.now()"), "番茄模式排程不受影响（回归）")
    # 收尾
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}switchTimerMode('pomodoro');return 1;})()")

def _remind_day(h, m):
    """C29 专用：把「今天 h:m」变成一个时间戳，让用例的时间推进与墙上钟脱钩。
    用例里所有合成时刻都从它派生，往后推 10/20 分钟绝不会跨到第二天
    （跑在 23:50 之后，从「现在」往后推就跨了午夜 → 假失败）。"""
    return js("(function(){var d=new Date();d.setHours(%d,%d,0,0);return d.getTime();})()" % (h, m))


@case("C29 提醒：没点「知道了」就每分钟重催，点掉才停", tier="feature", owner="00_pure_core 01b_engine_data 01c_engine_timer 01e_engine_ui 01eK_ui_remind 01g_engine_init")
def c29():
    """「计划里的设置」的提醒要像闹钟一样催到点掉（不是只响一次）。

    定点提醒与任务提醒共用同一条「确认队列」（remindEnqueue / remindAckCurrent）：
      到点 → 弹窗；没点「知道了」→ 每满 1 分钟再响一次（弹窗被关掉就重新弹）；
      点掉 → 记确认，当天不再催。旧存档的 remindDone=true / todo.reminded=true 一律当已确认。
    九条：①定点到点就弹 ②不满 1 分钟不重催 ③满 1 分钟自己弹回来 ④点掉后当天不再催
          ⑤任务到点进队并弹窗 ⑥不满 1 分钟不重催 ⑦满 1 分钟重催 ⑧勾掉任务自动撤出队列 ⑨收尾清干净。"""
    js("(function(){if(timerState.mode!=='idle'){resetToIdle();}return 1;})()")
    # ⓿ 加载期证据（★ 专门补一个盲点）：本用例余下部分会把两个真实心跳暂停后**手工驱动**
    #    扫描，所以它**测不到**「01eK 末尾那处顶层调用 `startRemindWatcher();` 有没有生效」。
    #    而 `startRemindWatcher()` 在加载时会立即调一次 `remindCheckTime()`，
    #    后者无条件写 `_remindWatchDay = 今天`（见 01eK_ui_remind.js 实现）——
    #    于是这个值等于今天，就证明拆分后「定义先于调用」仍然成立。
    check(js("_remindWatchDay") == js("getTodayStr()"),
          "加载期 startRemindWatcher 的立即扫描已生效（_remindWatchDay = 今天）")
    # 暂停两个真实时间心跳（定点 5s / 任务 30s），它们会和下面的合成时间打架
    js("(function(){window.__remindWatchPaused=true;return 1;})()")
    # 固定合成基准「今天 12:00」；提醒时间也用 12:00（原来取「现在」，跑在 23:50 后会跨午夜）
    js("(function(){appData.enhSettings.reminds=[{id:9001,t:'12:00',label:'喝水',on:true,repeat:'daily'}];"
       "appData.enhSettings.remindDone={};_remindQueue=[];saveData();return 1;})()")
    t0 = _remind_day(12, 0)
    # ① 到点 → 弹窗
    js("remindCheckTime(new Date(%d))" % t0)
    check(js("remindModalVisible()") is True, "定点提醒到点就弹出弹窗")
    check("喝水" in str(js("document.getElementById('remindModalMsg').textContent")), "弹窗里是那条提醒的内容")
    # ② 关掉弹窗后不满 1 分钟再扫 → 不该重催
    js("closeModal('remindModal')")
    js("remindCheckTime(new Date(%d))" % (t0 + 30000))
    check(js("remindModalVisible()") is False, "不到 1 分钟不重催（弹窗没自己弹回来）")
    # ③ 满 1 分钟再扫 → 自己弹回来
    js("remindCheckTime(new Date(%d))" % (t0 + 61000))
    check(js("remindModalVisible()") is True, "满 1 分钟会重催（弹窗自己弹回来）")
    # ④ 点「知道了」→ 记确认，之后当天不再催
    js("remindAckCurrent()")
    check(js("remindModalVisible()") is False, "点「知道了」后弹窗关掉")
    check(js("appData.enhSettings.remindDone[getTodayStr()][9001]") == "ok", "确认后 remindDone 写 ok")
    js("remindCheckTime(new Date(%d))" % (t0 + 300000))
    check(js("remindModalVisible()") is False, "确认过的不再催（当天有效但不重复催）")
    # ④b 稍后提醒：点「稍后」→ 先安静一会儿，到点自己回来；再点一次还能继续延
    js("(function(){appData.enhSettings.reminds=[{id:9002,t:'12:00',label:'站起来',on:true,repeat:'daily'}];"
       "appData.enhSettings.remindDone={};_remindSnoozeUntil={};_remindQueue=[];saveData();return 1;})()")
    t2 = _remind_day(12, 0)
    js("remindCheckTime(new Date(%d))" % t2)
    check(js("remindModalVisible()") is True, "稍后提醒：先正常弹出")
    check(js("!!document.getElementById('remindSnoozeBtn')") is True, "弹窗里有「稍后」按钮")
    js("document.getElementById('remindSnoozeBtn').click()")  # 真实点击，不是直接调函数
    check(js("remindModalVisible()") is False, "点「稍后」后弹窗立刻关掉")
    check(js("_remindQueue.length") == 0, "点「稍后」后退出确认队列（先不催）")
    # 真按钮走的是墙上钟（remindSnoozeCurrent() 无参 → Date.now()），而本用例的扫描用合成时间 12:00。
    # 两者错开时，「稍后期内安静」测的是「现在几点」而不是逻辑（午夜前后跑会假失败）。
    # → 按合成时间把这个窗口重新落一次；按钮本身那条链路由上面两条断言（关弹窗 + 退出队列）负责。
    js("_remindSnoozeUntil['point:9002'] = %d" % (t2 + 10 * 60000))
    js("remindCheckTime(new Date(%d))" % (t2 + 61000))
    check(js("remindModalVisible()") is False, "稍后期间不催（1 分钟后也没弹）")
    js("remindCheckTime(new Date(%d))" % (t2 + 9 * 60000))
    check(js("remindModalVisible()") is False, "稍后 9 分钟时还安静")
    js("remindCheckTime(new Date(%d))" % (t2 + 10 * 60000 + 5000))
    check(js("remindModalVisible()") is True, "稍后到点（10 分钟）自己弹回来")
    js("remindSnoozeCurrent(10, new Date(%d))" % (t2 + 10 * 60000 + 5000))
    js("remindCheckTime(new Date(%d))" % (t2 + 19 * 60000))
    check(js("remindModalVisible()") is False, "再点一次「稍后」还能继续延（19 分钟时仍安静）")
    js("remindCheckTime(new Date(%d))" % (t2 + 20 * 60000 + 10000))
    check(js("remindModalVisible()") is True, "第二次稍后到点又弹回来")
    js("remindAckCurrent()")
    check(js("appData.enhSettings.remindDone[getTodayStr()][9002]") == "ok", "稍后过再点「知道了」照样记确认")
    js("remindCheckTime(new Date(%d))" % (t2 + 40 * 60000))
    check(js("remindModalVisible()") is False, "稍后+确认之后彻底安静")
    # ④c 跨午夜回归：23:57 点「稍后 10 分钟」→ 目标落在第二天 00:07。
    #     旧实现 mn < tm 直接整条跳过 → 这条提醒被静默吞掉，要等第二天 23:57 才再响。
    tm = _remind_day(23, 57)
    js("(function(){appData.enhSettings.reminds=[{id:9003,t:'23:57',label:'吃药',on:true,repeat:'daily'}];"
       "appData.enhSettings.remindDone={};_remindSnoozeUntil={};_remindQueue=[];saveData();return 1;})()")
    js("remindCheckTime(new Date(%d))" % tm)
    check(js("remindModalVisible()") is True, "跨午夜：23:57 到点先正常弹出")
    js("remindSnoozeCurrent(10, new Date(%d))" % tm)
    js("remindCheckTime(new Date(%d))" % (tm + 9 * 60000))  # 次日 00:06
    check(js("remindModalVisible()") is False, "跨午夜：稍后期内安静（次日 00:06）")
    js("remindCheckTime(new Date(%d))" % (tm + 10 * 60000 + 30000))  # 次日 00:07:30
    check(js("remindModalVisible()") is True, "跨午夜：稍后到点仍会弹回来（不被午夜吞掉）")
    js("remindAckCurrent()")
    check(js("appData.enhSettings.remindDone[getTodayStr()][9003]") == "ok", "跨午夜：确认照样落库")
    # 反向：没点过「稍后」的口径不变 —— 跨午夜后不续催，等第二天那个点（当天有效）
    js("(function(){appData.enhSettings.reminds=[{id:9004,t:'23:57',label:'喝水',on:true,repeat:'daily'}];"
       "appData.enhSettings.remindDone={};_remindSnoozeUntil={};_remindQueue=[];saveData();return 1;})()")
    js("remindCheckTime(new Date(%d))" % tm)
    js("closeModal('remindModal')")
    js("remindCheckTime(new Date(%d))" % (tm + 11 * 60000))  # 次日 00:08
    check(js("remindModalVisible()") is False, "跨午夜：没点「稍后」的不续催（当天有效口径未变）")

    # ⑤ 任务提醒：到点进队并弹窗（remindAt = 合成的 11:59，即基准 12:00 的 1 分钟前）
    js("(function(){_remindQueue=[];"
       "appData.todos=[{id:9101,title:'数学卷子',done:false,detail:'',tag:'',deadline:null,"
       "remindAt:getTodayStr()+' 11:59',remindLast:0,reminded:false,"
       "subs:[],pomodoros:null,actualPomodoros:0,timeSpent:0}];"
       "saveData();return 1;})()")
    t1 = _remind_day(12, 0)
    js("checkTodoReminders(new Date(%d))" % t1)
    check(js("_remindQueue.some(function(x){return x.key==='todo:9101';})") is True, "任务到点会进确认队列")
    check(js("remindModalVisible()") is True, "任务提醒也会弹窗")
    # ⑥ 不满 1 分钟不重催
    js("closeModal('remindModal')")
    js("checkTodoReminders(new Date(%d))" % (t1 + 30000))
    check(js("remindModalVisible()") is False, "任务提醒不到 1 分钟不重催")
    # ⑦ 满 1 分钟重催
    js("checkTodoReminders(new Date(%d))" % (t1 + 61000))
    check(js("remindModalVisible()") is True, "任务提醒满 1 分钟重催")
    # ⑦b 任务提醒同样能「稍后」
    js("remindSnoozeCurrent(10, new Date(%d))" % (t1 + 61000))
    check(js("_remindQueue.length") == 0, "任务提醒也能「稍后」（退出队列）")
    js("checkTodoReminders(new Date(%d))" % (t1 + 62000))
    check(js("remindModalVisible()") is False, "任务稍后期间不催")
    js("checkTodoReminders(new Date(%d))" % (t1 + 11 * 60000 + 5000))
    check(js("remindModalVisible()") is True, "任务稍后到点自己弹回来")
    # ⑧ 勾掉任务 → 自动撤出队列、不再催
    js("(function(){appData.todos[0].done=true;saveData();return 1;})()")
    js("checkTodoReminders(new Date(%d))" % (t1 + 62000))
    check(js("_remindQueue.some(function(x){return x.key==='todo:9101';})") is False, "勾掉任务后从队列撤掉")
    check(js("remindModalVisible()") is False, "撤掉后弹窗关掉")
    # ⑨ 收尾：别把测试数据留在这台浏览器里；并恢复真实时间心跳
    js("(function(){appData.todos=[];appData.enhSettings.reminds=[];appData.enhSettings.remindDone={};"
       "_remindSnoozeUntil={};_remindQueue=[];closeModal('remindModal');saveData();"
       "window.__remindWatchPaused=false;return 1;})()")
    check(js("_remindQueue.length") == 0, "收尾：确认队列清干净")


@case("C30 四个显示类 bug 回归：备注 / 连续天数 / 树任务金币 / 必做任务名", tier="feature", owner="00_pure_core 01b_engine_data 01d_engine_features 01d3_engine_tree_shop 01e5_ui_tree 01e8_ui_misc 01e_engine_ui 0E_theme template.html")
def c30():
    """四条显示类回归，共同点是「数据是对的，显示不对」。

    ① 日志补填/改了备注，列表不刷新 —— `renderLogs` 脏检查签名只含条数与首尾 id
    ② 树「第二天还没做就显示断了、补完番茄也不回来」—— `snapshotStreakHistory`
       只按当天日期生成一次（当天锁死），且「昨天做过、今天还没做」数成 0
    ③ 树每日任务里**没完成的**那几条看不到金币数额 —— 只在已领奖时渲染
    ④ 计时页选任务，明日必做只剩一个 📌 没有名字 —— 读 `it.text`，实际存的是 `it.title`

    四条都先「复现 → 修 → 反向验证」过；本用例是它们的机器回归网。"""
    import json as _json
    js("(function(){window.__c30bk=JSON.stringify({r:appData.records,t:appData.tree,m:appData.mustDos});return 1;})()")
    out = js(r"""
    (function(){
      var res=[]; function ck(c,n){res.push([!!c,n]);}
      function D(h,m){var d=new Date();d.setHours(h,m,0,0);return d.getTime();}
      /* ① 明日必做任务名要显示出来（原先只剩一个 📌） */
      var tmr=getMustDoTomorrowStr();
      appData.mustDos=appData.mustDos||{};
      appData.mustDos[tmr]=[{id:501,title:'数学卷子',est:2,done:false}];
      refreshTodoSelect();
      var txt=Array.prototype.map.call(document.getElementById('currentTodoSelect').options,
                                       function(o){return o.text;}).join('|');
      ck(txt.indexOf('数学卷子')>=0,'计时页下拉显示明日必做任务名');
      /* ② 补填备注后日志列表要立刻刷新（原先脏检查签名不含备注 → 跳过重绘） */
      switchView('log');
      var now=Date.now();
      appData.records=[{id:8001,type:'full',startTime:now,duration:25,task:'A',note:''}];
      _logSig=''; renderLogs();
      appData.records[0].note='补的备注'; saveData(); renderLogs();
      ck(document.getElementById('logList').textContent.indexOf('补的备注')>=0,'补填备注后日志立刻刷新');
      switchView('timer');
      /* ③ 连续天数：昨天做过、今天还没做 = 1 天（不算断）；当天补完番茄要跟着涨 */
      appData.records=[{id:7001,type:'full',startTime:D(9,0)-86400000,duration:25,task:'昨天',note:''}];
      appData.tree.streakHistory=[]; appData.tree.streakProtectedDates=[];
      appData.tree.inventory=appData.tree.inventory||{}; appData.tree.inventory.streakProtect=0;
      appData.tree.waterStreak=0;
      snapshotStreakHistory();
      var h=appData.tree.streakHistory[appData.tree.streakHistory.length-1];
      ck(h && h.streak===1,'昨天做过、今天还没做 → 连续 1 天（不算断）');
      appData.records.push({id:7002,type:'full',startTime:D(9,0),duration:25,task:'今天',note:''});
      snapshotStreakHistory();
      var h2=appData.tree.streakHistory[appData.tree.streakHistory.length-1];
      ck(h2 && h2.streak===2,'当天补完番茄 → 连续天数跟着涨');
      /* ④ 树每日任务每条都要带金币数额（未完成的也要显示） */
      appData.records=[{id:7003,type:'full',startTime:D(9,0),duration:25,task:'t',note:''}];
      appData.tree.lastWaterDate=getTodayStr(); appData.tree.dailyTasks=null;
      checkTreeDailyTasks(); renderTreeGrowthMeta();
      var sp=document.querySelectorAll('.tree-task'), all=true;
      for(var i=0;i<sp.length;i++){ if(sp[i].outerHTML.indexOf('🪙')<0) all=false; }
      ck(sp.length>=3 && all,'树每日任务每条都显示金币数额（含未完成）');
      return JSON.stringify(res);
    })()
    """)
    for ok, name in _json.loads(out):
        check(ok, name)
    js("(function(){var b=JSON.parse(window.__c30bk);appData.records=b.r;appData.tree=b.t;"
       "appData.mustDos=b.m;saveData();_logSig='';delete window.__c30bk;return 1;})()")


@case("C31 「仅记录」：只记时间，不算番茄、不进专注统计、不自动进休息", tier="feature", owner="00_pure_core 01b_engine_data 01c_engine_timer 01d5_engine_stats 01e8_ui_misc 01e_engine_ui 01g_engine_init")
def c31():
    """补记非专注事项（例：去配眼镜）时的新类型。

    以前只能选「未完成」，而「未完成」会进专注效率的分母，把效率拉低。
    本用例是这条口径的机器回归网：
      ① calcPomos('log') 必须为 0，老三种折算不变
      ② 结算弹窗选「仅记录」→ 落库 type='log'/pomos=0，今日番茄/分钟/三档计数零漂移，
         段位三档不变、不发金币、不自动进休息
      ③ 补记弹窗选「仅记录」同样零漂移，且保留真实时长（日志要显示时段）
      ④ 日志列表渲染出「仅记录」标签；三个入口（补记/结算/筛选）都有该选项
    """
    import json as _json

    js(
        "(function(){window.__c31bk=JSON.stringify({r:appData.records,rd:appData.round,"
        "t:appData.tree});return 1;})()"
    )
    out = js(
        "(function(){"
        "var res=[],r2=[],i;function ck(c,n){res.push([!!c,n]);}"
        "function tb(){var x=getStatsCache().tb;return [x.full,x.half,x.incomplete,x.pomos,x.minutes];}"
        "var g0=appData.tree.coins;"
        "try{"
        "ck(calcPomos(3600,'log')===0,'calcPomos(仅记录)=0 个番茄');"
        "ck(isLogRecord({type:'log'})===true&&isLogRecord({type:'full'})===false,'isLogRecord 只认 type=log');"
        "ck(calcPomos(3600,'incomplete')===0&&calcPomos(3600,'half')===0.5&&calcPomos(3600,'full')>=1,"
        "'老三种折算番茄不变（未完成 0 / 半个 0.5 / 完整 1）');"
        "if(timerState.mode!=='idle'){resetToIdle();}"
        "appData.settings.immersiveFocus=false;startPomodoroCore();"
        "timerState.startTime=Date.now()-1800*1000;timerState.effectiveSeconds=1800;finishPomodoro();"
        # 本轮计数只有 getRoundStats() 一个口径（records 现算）；appData.round 现在只存 startTs
        "var _rs0=getRoundStats();var rdf=_rs0.full,rdh=_rs0.half,rdi=_rs0.incomplete;"
        "var sel=document.getElementById('finishType');"
        "ck(!!sel.querySelector('option[value=\\\"log\\\"]'),'结算弹窗有「仅记录」选项');"
        "sel.value='log';onFinishTypeChange();"
        "ck((document.getElementById('finishTypeHint').textContent||'').indexOf('仅记录')>=0,"
        "'选「仅记录」时提示改成大白话');"
        "ck((document.getElementById('finishInfo').textContent||'').indexOf('不计入')>=0,"
        "'选「仅记录」时折算说明被替换');"
        "var b1=tb();confirmFinish();"
        "var r1=appData.records[appData.records.length-1];"
        "ck(r1.type==='log','结算落库 type=log');"
        "ck(r1.pomos===0,'结算落库 pomos=0');"
        "ck(r1.effectiveSeconds>0,'「仅记录」保留真实时长（日志时间线要显示时段）');"
        "ck(JSON.stringify(tb())===JSON.stringify(b1),'结算后今日番茄/分钟/三档计数零漂移');"
        "var _rs1=getRoundStats();ck(_rs1.full===rdf&&_rs1.half===rdh&&_rs1.incomplete===rdi,"
        "'本轮连击三档计数不变');"
        "ck(appData.tree.coins===g0,'不发金币');"
        "/* 反向对照：同样流程选「未完成」→ 本轮连击 incomplete 必须 +1（证明计数网还在） */"
        "if(timerState.mode!=='idle'){resetToIdle();}"
        "startPomodoroCore();"
        "timerState.startTime=Date.now()-1200*1000;timerState.effectiveSeconds=1200;finishPomodoro();"
        "var ird=getRoundStats().incomplete;"
        "sel=document.getElementById('finishType');sel.value='incomplete';onFinishTypeChange();confirmFinish();"
        "ck(getRoundStats().incomplete===ird+1,'反向对照：选「未完成」时本轮连击 incomplete +1');"
        "ck(appData.records[appData.records.length-1].type==='incomplete','反向对照：未完成仍落 type=incomplete');"
        "var b2=tb();openAddRecordModal();"
        "document.getElementById('addRecordTask').value='配眼镜';"
        "document.getElementById('addRecordType').value='log';"
        "document.getElementById('addRecordDuration').value='60';saveAddRecord();"
        "var r3=appData.records[appData.records.length-1];"
        "ck(r3.type==='log'&&r3.pomos===0,'补记「仅记录」落库 type=log / pomos=0');"
        "ck(r3.effectiveSeconds===3600,'补记「仅记录」保留 60 分钟时长');"
        "ck(JSON.stringify(tb())===JSON.stringify(b2),'补记后今日统计零漂移');"
        "ck(!!document.querySelector('#addRecordType option[value=\\\"log\\\"]'),'补记弹窗有「仅记录」选项');"
        "ck(!!document.querySelector('#logTypeFilter option[value=\\\"log\\\"]'),'日志筛选有「仅记录」选项');"
        "switchView('log');_logSig='';renderLogs();"
        "ck(document.querySelectorAll('.tag-log').length>=2,'日志列表渲染出「仅记录」标签');"
        "ck((document.getElementById('logList').textContent||'').indexOf('配眼镜')>=0,'日志列表能看到这条记录');"
        "/* CSV 导出的「类型」列必须是中文（否则外部读表的人看到 log 不知道是啥） */"
        "ck(typeLabel('log')==='仅记录'&&typeLabel('full')==='完整'&&typeLabel('incomplete')==='未完成',"
        "'CSV 类型列用中文标签');"
        "/* CSV 表格三处共用（唯一定义处 recordsCsvTable）。这里必须验「运行期真能调到」："
        "   00_pure_core 在槽 8，而调用它的 03/05 在槽 2/4 —— 声明更晚，只有运行期才安全。 */"
        "ck(typeof recordsCsvTable==='function','CSV 表格纯函数运行期可调用（跨槽晚加载）');"
        "ck(recordsCsvTable([]).head.length===23,'CSV 表头 23 列');"
        "ck(recordsCsvTable([{startTime:0,type:'full',planTitle:'甲计划',quad:'q1'}"
        "]).lines[1].indexOf('甲计划')>=0,'CSV 行带计划关联快照');"
        "/* 导入放宽：老版本遇到新类型的备份不该直接卡死 */"
        "(function(){var pl=JSON.parse(JSON.stringify(appData));"
        "pl.records=pl.records.concat([{id:'x',taskName:'未来类型',type:'someFutureType',pomos:3,"
        "effectiveSeconds:1200,startTime:Date.now()-9000000,endTime:Date.now()-8000000,interruptions:0}]);"
        "var v=validateBackup(pl);"
        "ck(v.ok===true,'未知记录类型放行（不再拒绝导入）');"
        "ck((v.warns||[]).some(function(w){return w.indexOf('不认识')>=0;}),'并对未知类型给出警告');"
        "var p3=JSON.parse(JSON.stringify(appData));p3.records='not-an-array';"
        "ck(validateBackup(p3).ok===false,'真正的坏数据（records 非数组）仍被拦住');})();"
        "}catch(e31){res.push([false,'⚠️ 用例抛异常：'+(e31&&e31.message?e31.message:e31)]);}"
        "finally{/* 断言抛异常也要还原，别把测试记录 saveData 进用户数据 */"
        "var b31=JSON.parse(window.__c31bk);appData.records=b31.r;appData.round=b31.rd;"
        "appData.tree=b31.t;saveData();_logSig='';}"
        "switchView('timer');return JSON.stringify(res);})()"
    )
    for ok, name in _json.loads(out):
        check(ok, name)
    # 「仅记录」结算后不自动进休息：**单独重放一次**再断言。
    # （同批里紧接着还有「未完成」结算，它按规矩会在 +300ms 兜底进休息；
    #   沿用那批状态判断「仅记录」会被它误伤 —— 那是竞态，不是被测行为。）
    time.sleep(0.6)  # 先让上一批「未完成」结算留下的 300ms 兜底定时器落地（它会把状态推成休息），
                     # 再由重放的 resetToIdle 清干净 —— 否则那个陈旧定时器会插进重放中间，断言不可复现。
    js(
        "(function(){if(timerState.mode!=='idle'){resetToIdle();}"
        "appData.settings.immersiveFocus=false;startPomodoroCore();"
        "timerState.startTime=Date.now()-1200*1000;timerState.effectiveSeconds=1200;finishPomodoro();"
        "var s=document.getElementById('finishType');s.value='log';onFinishTypeChange();confirmFinish();"
        "return 1;})()"
    )
    time.sleep(0.8)  # 等过 01d 的 300ms 兜底窗口
    check(
        js("timerState.mode!=='shortBreak'&&timerState.mode!=='longBreak'"),
        "「仅记录」结算后不自动进休息",
    )
    js(
        "(function(){var b=JSON.parse(window.__c31bk);appData.records=b.r;appData.round=b.rd;"
        "appData.tree=b.t;saveData();_logSig='';renderLogs();delete window.__c31bk;return 1;})()"
    )



@case("C32 日志类型可编辑 / 短时可选仅记录 / 结算卡片门槛 / 日志合并", tier="feature", owner="01b_engine_data 01c_engine_timer 01d_engine_features 01e8_ui_misc 01e_engine_ui 01g_engine_init 07_uiFold")
def c32():
    """四项体验修正的机器回归：
    ① 编辑日志能改类型（只改记录与统计口径，已发奖励不追溯）
    ② 结束计时不足 5 分钟也能选「仅记录」（默认仍是未完成，完整/半个禁用）
    ③ 结算卡片只有 ≥2 条消息才弹，1 条改走普通小提示
    ④ 日志「同任务同类型、前后相接」合并成一行显示，起止重复的并入；数据一条不动
    全程注入自造记录，页面侧用 try/finally 还原 appData 并落盘，不留痕。
    这里的还原是第二道保险：页面异常/超时导致 finally 没跑完时兜底（幂等）。
    """
    res = js(_case_js("c32_log_merge.js"))
    for name, okv in json.loads(res):
        check(okv, name)
    js(
        "(function(){if(!window.__c32bk)return 1;appData.records=window.__c32bk.r;"
        "appData.round=window.__c32bk.rd;appData.tree=window.__c32bk.t;"
        "saveData();_logSig='';renderLogs();return 1;})()"
    )

@case("C33 轮次目标 + 计划/日历联动（日历翻页 / 今天高亮 / 仅记录打点）", tier="feature", owner="01d2_engine_rank_bot 01eC_ui_todo 01eD_ui_log")
def c33():
    """★ 2026-10-21 首次注册：这个文件一直在 tools/tests/ 里躺着，但**从没有对应的
    @case 包装**——100 条注册用例里查无 C33，等于零覆盖。测试文件写得再细，
    没接进 runner 就是一段没人执行的注释。
    顺带修掉它内部的时间炸弹：at() 原来写死 new Date(2026, 9, 8)，
    日历也钉死在 2026-10，跨月后「今天那格」永远找不到（见 c33 文件头注释）。
    现在日期全部相对今天推导，什么时候跑都成立。"""
    res = json.loads(js(_case_js("c33_round_goal_todo.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C34 自由专注快照：开始即落盘 + 切走/暂停补落（番茄钟一直有，它原来两个都没有）", tier="feature", owner="01b_engine_data 01c_engine_timer 01e_engine_ui 01g_engine_init")
def c34():
    """自由专注：计时中切走/刷新后计时全丢（番茄钟不受影响）。

    根因（实测坐实）：`toggleFreeTimer()` 的**开始分支不落快照**，快照只由 tick 里
    每 15s 一次的「心跳」写；切走时系统冻结的恰恰是 JS 定时器 → 心跳没跑 →
    磁盘里从来没写过 free 快照 → WebView 被回收后无快照可恢复 = 计时全丢。
    番茄钟 `startPomodoroCore()` 一开头就落盘，所以它一直好好的。
    （更早一层 `mode!=='focus'` 的同源过滤已在 1927dfd 修掉。）
    """
    res = js(_case_js("c34_free_snapshot.js"))
    for name, okv in json.loads(res):
        check(okv, name)


@case("C35 计划列表空状态不残留", tier="feature", owner="01e_engine_ui template.html")
def c35():
    """计划页：添加计划后「还没有计划任务」的空状态不消失。

    根因：计划的列表渲染有两条路径（空 → 整段 innerHTML 塞空状态；非空 → 行级复用），
    `renderTodosRows()` 只认带 data-id 的节点，空状态 div 没有 data-id →
    从「空」变「有计划」时它既不在索引里、也不在删除循环里，永远删不掉，
    于是「还没有计划任务」一直挂在计划下面。

    修法：`renderTodosRows()` 应用行之前，先清掉列表里所有**没有 data-id 的遗留子节点**。
    对照实测：HEAD 版本加完计划后 emptyLeft=true / children=2；修复后 false / 1。
    """
    res = js(_case_js("c35_todo_empty_state.js"))
    for name, okv in json.loads(res):
        check(okv, name)

@case("C36 计时页子任务卡随关联计划出现/恢复", tier="feature", owner="01b_engine_data 01c_engine_timer 01e_engine_ui 0E_theme")
def c36():
    """计时界面：子任务卡有时显示、有时不显示。

    根因（两条，都是「谁负责重画」的缺失）：
    1. 子任务卡只由 `startPomodoroCore()` 里的 `renderTimerSubs()` 画一次 ——
       切回计时页（switchView）、刷新/切走回来恢复（restoreTimerSnapshot）
       都不重画，DOM 一旦没了就永远不再出现；
    2. 手动输入任务名（没走下拉选择）开始专注时不解析计划 → 关联为空 → 卡片永远不显示。
       这就是「有时显示有时不显示」：只有「从下拉选计划」这一路会显示。

    修法：① switchView 进计时页 + restoreTimerSnapshot 之后各补一次 renderTimerSubs()；
          ② startPomodoroCore 在没选中计划时按任务名匹配未完成且有子任务的计划（只补空关联，
             不覆盖用户手填备注 / 预估番茄）。
    对照实测（真机浏览器）：修复前 reload 后 box.display=none / hasSub=false；修复后 block / true。
    """
    res = json.loads(js(_case_js("c36_linked_todo_card.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C37 树复活/重种后能浇水（禁用状态单向写）", tier="feature", owner="00_pure_core 01b_engine_data 01d2 01d3_engine_tree_shop 01e5_ui_tree 01e8_ui_misc 01e_engine_ui")
def c37():
    """树木：复活之后浇水按钮仍然点不动。

    根因：`renderTreeSection()` 里浇水按钮的状态只**单向**写 ——
    枯死分支 `wb.disabled = true;`，活着分支只改文字、样式，从不复位 disabled。
    同一次会话中「枯死 → 复活」后按钮仍然点不动（刷新才恢复）；
    复活石（useItem）和免费重种（replantTree）两条路都会中招。

    修法：活着分支补 `wb.disabled = false;`。
    """
    res = json.loads(js(_case_js("c37_tree_water_revive.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C39 专注中不弹提醒（定点/任务都只轻提示，专注结束补弹）", tier="feature", owner="01b_engine_data 01c_engine_timer 01e_engine_ui 01g_engine_init")
def c39():
    """计时中（含重开 App 恢复的那次）不应该弹任务提醒窗。

    根因：专注静音只在**定点提醒**里写了一份，任务提醒（01g checkTodoReminders）
    没有 → 计时中原样弹确认窗。修法是把判定收进公共件 remindEnqueue（单一出处）。
    """
    res = json.loads(js(_case_js("c39_todo_remind_focus_mute.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C40 自由专注也算专注 + 番茄暂停/打断态恢复（重开不自跑、不自动结算）", tier="feature", owner="01b_engine_data 01c_engine_timer 01e_engine_ui 01g_engine_init 0E_theme")
def c40():
    """自由专注计时中仍然弹任务提醒；重开 App 后恢复计时也弹。

    根因①：remindFocusRunning 只认 mode==='focus'，而自由专注是 'free' → 计时中照弹提醒窗。
    根因②：focus 快照里没有 paused 字段，打断只把 running=false、endAt 不动 →
           切走/退出落一份「没有暂停语义」的快照，重开就 running:true 续跑或直接结算成整颗番茄。
    根因③：restoreFreeSnapshot 没还原 timerMode → 恢复后按钮接成番茄钟的 toggleTimer，点不动。
    """
    res = json.loads(js(_case_js("c40_focus_mute_pause_restore.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C43 打断分析按 日/月/年/累计 分区间（不再是全历史总账）", tier="feature", owner="01d5_engine_stats 01e7_ui_stats 01e8_ui_misc")
def c43():
    """打断分析：原来印的是全历史累计，和旁边的「近7天/近8周」不是一个口径。

    根因：buildTaskIntStats 的打断段遍历 appData.records 无任何时间窗，renderInterruptAnalysis
         直接把「累计打断 N 次」印出来，而它旁边全是「近7天/近8周」的图 → 语义对不上。
    修法：新增 buildInterruptStats(fromMs,toMs) + interruptRangeOf(scope,offset)，
         卡片头加 日/月/年/累计 四档 + ◀区间▶；SC 旧口径不动（底部评价仍说整体历史）。
    """
    res = json.loads(js(_case_js("c43_interrupt_range.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C44 习惯页展示备注（列表行不再吞掉 h.note）", tier="feature", owner="01e_engine_ui 01e7_ui_stats template.html")
def c44():
    """习惯页：列表行不显示备注。

    根因：备注的读写一直是对的（详情弹窗往返 OK），但 renderHabits() 的列表行
         只渲染 名字 + 连续天数，从建库起就没印过 h.note → 填了也看不见。
    修法：`.habit-info` 里、`.habit-streak` 之后补一行 `.habit-note`（同 .todo-detail-preview 款）。
    """
    res = json.loads(js(_case_js("c44_habit_note.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C45 计划「重复周期」（不用每天手动加一条）", tier="feature", owner="00_pure_core 01b_engine_data 01d_engine_features 01e_engine_ui")
def c45():
    """计划：新增「重复周期」，不用每天手动加一条。

    设计：task.repeat = { mode, weekdays[], dom, interval, anchor, last, next }
    - 规则运算全在 00_pure_core.js（纯函数，边界在 unit_pure.js）；
    - 「到期复位」不是复制新任务，而是同一条任务按规则回到未完成，
      闸门 = repeat.next（next > today 什么都不做 → 一天跑几十次也只复位一次）；
    - 短月收口：选了 31 号，2 月落到当月最后一天，而不是整月跳过；
    - interval 用 anchor 锚定，"每 2 天"从设定那天起算，不是从今天起算。
    本用例打运行时：新增弹窗落盘 / 行内徽标 / 到点复位（含幂等与子任务）/ 每日清理不误删 /
    编辑面板读写 / 默认「不重复」不写字段 / 行签名不含会自己走的 last·next。
    """
    res = json.loads(js(_case_js("c45_todo_repeat.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C42 日志页「记录时长」与「专注时长」两条账分开", tier="feature", owner="00_pure_core 01c_engine_timer 01e_engine_ui")
def c42():
    """日志页：「记录时长」和「专注时长」两条账分开。

    口径：记录时长 = recordSeconds 合计（**含「仅记录」**）；专注时长 = pomosToMinutes(Σ getPomos)。
    """
    res = json.loads(js(_case_js("c42_log_durations.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

# C41（任务完成度「计划 vs 实际」板块）已随板块移除而删除（2026-11-07）：
# 用户认为"预计 vs 实际"读不出行动价值，连它上面的「📋 任务」跳转一起卸掉。
# 取数端 buildTaskCompareRows / buildTaskIntStats 仍保留（其它分析在用）。

@case("C46 计划排序（提醒时间/预计结束/四象限）+ 四象限分类", tier="feature", owner="00_pure_core 01b_engine_data 01d_engine_features 01e_engine_ui")
def c46():
    """计划排序：去掉「按名字」，新增 提醒时间 / 预计结束 / 四象限，方向可正可倒。

    关键口径：没填该字段的任务**永远垫底**，不随方向翻转（否则倒序时空值会顶到最前）；
    同一字段再点一次才翻方向，换字段回到该字段的默认方向（TODO_SORT_DEF_DIR）；
    四象限是 4 个固定档 + 未分类，未知值一律当未分类（不留脏数据）。
    同时打：行内选象限即时落盘、行上徽标、新增弹窗选象限落盘。
    """
    res = json.loads(js(_case_js("c46_todo_sort_quad.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C47 专注记录与计划关联（子任务/标签/象限/预计vs实际）", tier="feature", owner="00_pure_core 01b_engine_data 01c_engine_timer 01d_engine_features 01e8_ui_misc 01e_engine_ui 01g_engine_init")
def c47():
    """需求：计划和专注记录关联度不高 —— 记录里存了计划快照，日志行却没显示出来。

    这条账要两边都打：①写入侧 保存专注记录时把 计划id/标签/象限/子任务/预计·实际🍅 一起快照；
    ②渲染侧 日志行把「└ 子任务 · 标签」和象限徽标显示出来；没有关联的记录不显示这一行。
    """
    res = json.loads(js(_case_js("c47_log_todo_link.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C48 日志页「回顾」按钮 + 艾宾浩斯遗忘曲线排期", tier="feature", owner="00_pure_core 01b_engine_data 01e_engine_ui")
def c48():
    """需求：日志页「筛选 / 补记」旁要有「回顾」，按艾宾浩斯曲线挑出今天该回顾的日期。

    口径：记录次日起第一次回顾，之后 1→2→4→7→15→30→60 天；
    自评「遗忘」回炉到第 0 级（明天重来）、「熟练」进一级、「记牢」跳一级；
    毕业（超过最后一级）不再排期；已回顾过的日期不重复出现在今日待回顾里。
    """
    res = json.loads(js(_case_js("c48_log_review_ebbinghaus.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C49 习惯升级（连续/近30天达标、详情、归档分区、每周N次折算）", tier="feature", owner="00_pure_core 01b_engine_data 08_component_registry 01e_engine_ui 07_uiFold")
def c49():
    """习惯功能对齐「小日常」一类的习惯 App：信息分层 + 达标率按频次折算 + 归档分区。

    关键口径：列表行只留「当前连续 + 近30天达标」，历史最长/成长点/段位进详情弹窗；
    「每周 N 次」的习惯，窗口应打次数 = 窗口天数 × N/7（不是按天全勤），达标率封顶 100%。
    """
    res = json.loads(js(_case_js("c49_habit_upgrade.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C50 左右滑动切视图（中段能切 / 靠边让给浏览器 / 设置可关）", tier="feature", owner="01e4_ui_ux 01b_engine_data 01e_engine_ui 0B_hash路由 template.html")
def c50():
    """左右滑既触发浏览器前进/后退，又触发应用切页面，两个手势打架。

    收口方式：① 应用滑动手势的左右排除带 24px → 34px（浏览器自带边缘手势带
    约 20~30px，24px 太窄会两边同时响应）；② 新增 settings.swipeNav 开关，
    关掉后本手势整体退出；③ 写 hash 优先 replaceState（location.hash 赋值会
    往历史栈塞记录，切页一次 +1，浏览器「返回」就变成在应用内来回切页）。

    本用例锁住 ①② 的可自动验证部分：命中范围（中段切 / 靠边不切 / 竖滑不切 /
    位移不足不切）+ 开关（关掉后不切、且 switchView 不受牵连、重开即恢复）。
    """
    res = json.loads(js(_case_js("c50_swipe_nav.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C51 字号大小=只放大可读性不改布局（--fs-user / 系统字号归一 / 各档不溢出）", tier="feature", owner="template.html 01e_engine_ui 00_pure_core 01e4_ui_ux")
def c51():
    """「这个放大功能这么诡异」「不像界面放大，像手机浏览器双指放大那种强硬的放大」
    「现在也不能左右滑切换页面了」。

    旧实现只把 --fs-* 字号令牌乘一个倍率 —— 字变大了，width/height/padding 一分不改，
    于是字把卡片、胶囊、导航撑破 → 折行/裁切/横向溢出（观感就是"浏览器强行放大"），
    撑出的横向溢出还会把左右滑翻页的手势吃掉。

    改成整页 zoom（浏览器原生「整页缩放」的等价做法）+ --fs-boost 归一系统字号。
    本用例把两件事都钉住：
      ① 字号令牌不再随档位变（防止有人把"只放大字"的老路加回来）；
      ② zoom 必须连盒子一起放大（导航项高度 1.5 档 ≈ 1 档的 1.5 倍）；
      ③ 1/1.15/1.3/1.5 四档逐档实测无横向溢出、头部品牌行不压快捷按钮。
    """
    res = json.loads(js(_case_js("c51_font_scale.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C52 日程网格常驻计划列表上方 + 默认收起/展开按钮文案联动 + 每件事一个颜色（列表与网格同色源、计划块不透明带竖排标题）", tier="feature", owner="01eA_ui_timeblock 01e_engine_ui template.html")
def c52():
    """「就别单独成一个列表成块了，就把这个放到那个计划的上方下面有计划就行了，
    不要单独成页了」「每个任务应该自动给它分配一个颜色」「这文字和那个都快糊在一起了」。

    ① 网格默认收起：常驻铺开会把下面的计划列表推走一整屏，而天天要看的是列表；
    ② 同一个色源：折叠条色条 = 计划条目左边框 = 网格块，对不上号的颜色只是装饰；
    ③ 不糊：计划块底色必须不透明（半透明会把格线透上来叠成褐色），
       同一钟点撞车的两件事并排分槽而不是原地叠着。
    """
    res = json.loads(js(_case_js("c52_tb_fold_color.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C53 补记 ↔ 计划关联（写入快照 / 显式下拉 / 两处共用同一个计划归属构件 / 详情事后改挂）", tier="feature", owner="01e_engine_ui 01eD_ui_log 00_pure_core template.html")
def c53():
    """（附截图）：「完成计划和这个日志，这个都不，长得都不一样，样式也不一样，
    根本就不感觉就是生加进去的，根本就没有关联」。

    根因两条：
      ① 补记只写 expectedPomodoros/actualPomodoros，**连 todoId 都不写**，
         找计划又只有「任务名精确匹配」一条路 —— 名字差一个字就静默失联；
      ② 日志卡的计划名有个「记录名 == 计划名 就不画」的去重规则，
         效果恰好相反：关联最紧的记录反而最看不出关联。

    本用例锁住三层：落盘（四种组合）→ 显示（两处共用 .plan-chip）→ 详情（事后改挂/摘除）。
    """
    res = json.loads(js(_case_js("c53_add_record_plan_link.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C54 成就分层与梯度（tier 四档 / guide 只放「第一次」/ 早起鸟·夜猫子 连续3天）", tier="feature", owner="01b_engine_data 01e8_ui_misc 01e7_ui_stats")
def c54():
    """「我就完成了几天，我就解锁了十几个成就，感觉成就系统需要升级」。

    根因不是数字太小，而是 8 个「第一次做某事」的成就与「连续 100 天」同权展示。
    两轮收口：① 分层（只动展示）② 梯度（早起鸟/夜猫子 >=1 → >=连续3天，并脱离 guide）。

    本用例把**分层数量**也钉住（6/19/28/16）：数字一变就必须同步改用例 ——
    「机器门禁」比「人记得」可靠，防止以后有人悄悄往 guide 里塞需要坚持的成就。
    """
    res = json.loads(js(_case_js("c54_achievement_tier.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C55 备忘「自我对话」（注入/发送/引用回复/删除/清空文案）", tier="feature", owner="01e9_ui_memo 00_pure_core 0C_确认弹窗 template.html")
def c55():
    """备忘要能表达「自己跟自己对话」的来回。

    本项目没有后端，不引入 AI；可迁移的只有交互形态：
      · 引用回复（replyTo 父指针）—— 让用户能**回应自己**（A→B→A 来回自然形成）
    对话感由「我 / 对面」双侧气泡 + 引用回复共同构成。

    ⚠️ 备忘模块此前**一条用例都没有**，本用例同时补上这个覆盖缺口。
    """
    res = json.loads(js(_case_js("c55_memo_self_talk.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C56 日程网格：两次点击新建计划（说明行 / 起点高亮 / 预填起止 / 同格取消 / 不写数据）", tier="feature", owner="00_pure_core 01eA_ui_timeblock 01eC_ui_todo 01eM_ui_tbcreate")
def c56():
    """网格上点起始格、再点结束格 → 打开「新增计划」并预填起止；点同一格两次 = 取消。

    锁三件事：
      · 说明是**一行默认折叠的文字**（复用设置页组件），不是常驻提示框；
      · 预填要落到用户点的那两格上（起点精确；🍅由时长反推，因为番茄时长里夹着休息）；
      · 点两格**不写数据** —— 只有用户在弹窗里点保存才落盘。
    说明行由 01eM 包装 renderTimeBlockGrid 后同步补插，用例在渲染后立刻断言，
    不依赖异步回调（同时锁住"补插别改成异步"）。
    """
    res = json.loads(js(_case_js("c56_tb_create.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C57 森林面板：接管重绘（SVG 树 / 网格 / 按月年视图 / 配色与归位 / 地貌随里程碑变化）", tier="feature", owner="00_pure_core 01e5_ui_tree 01eN_ui_forest template.html")
def c57():
    """森林面板此前**一条用例都没有**，这版重绘把它锁住。

    四条：① 接管生效（旧的一列列表情结构不再出现，换成 .fs-grid/.fs-day/.fs-tree）
          ② 网格口径（格子数 = 窗口天数且**含空白日**，今天带 is-today）
          ③ 窗口档位（切 30 天后格子数变 30，且写回 uiPrefs 后重渲染仍生效）
          ④ 老数据兜底（记录里没有 levels 字段时也要能画出树）
    断言全部落在**渲染出来的 DOM** 上，不读内部变量 —— 内部对得上但画不出来，
    是重绘类改动最典型的假绿。
    """
    res = json.loads(js(_case_js("c57_forest_panel.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C58 分段控件：.seg-btn 基础态 + 传记来源筛选", tier="feature", owner="template.html 01e7_ui_stats.js")
def c58():
    """这组控件原先只写了选中态，未选中的按钮落回浏览器默认（灰底 + outset 凸起 + 直角），
    与选中态的主色胶囊不是一套语言 —— 也就是"看着丑"的实现层原因。

    用 computedStyle 把"边框 0 / 背景透明 / 胶囊圆角"钉住（不同浏览器默认样式不同，只靠肉眼不算数）；
    同时验功能没坏（切筛选真的过滤）与设置页那份自带内联的不受影响。"""
    res = json.loads(js(_case_js("c58_seg_control.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C59 传记条目布局：竖排一列（日期与标题不再左右并排）", tier="feature", owner="template.html 01e7_ui_stats.js")
def c59():
    """原先每条是「标题左 / 日期+操作右」两端分居，形似两栏；改为竖排：日期+操作在顶行、标题独占整宽、正文一行。

    用几何断言（标题宽度 / 条目宽度、日期是否在标题上方）而不是"看着像不像"。"""
    res = json.loads(js(_case_js("c59_bio_item_layout.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C60 抽奖派生化 + 记录↔奖励对账（补记→删除不再白嫖 / 租期不续期 / 礼包只发一次）", tier="feature", owner="00_pure_core 01b_engine_data 01d3_engine_tree_shop 01d_engine_features 01e5_ui_tree 01e8_ui_misc")
def c60():
    """「我怀疑种树里面的那个金币抽奖是坏的，比如说我每次导入数据，它就可以让我重新抽奖」。

    实测查出两条路径：①「补记一条 → 删掉」把当场发的抽奖次数与树积分留账上（6 轮刷出 35🪙，
    记录数恒为 0）；② 导入旧备份 = 时间机器，限时装饰每次导入都按 now 重算 7 天。
    修法：次数改为由 records 派生（删记录即回落）、删除/改类型按差值回滚树积分、
    租期宽限加一次性守卫、礼包金币收敛为单一入账点（顺带修掉签到/成就的双倍发放）。"""
    res = json.loads(js(_case_js("c60_lottery_ledger.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C61 森林长线：树龄时间轴 + 年轮长尾 + 长线成就（十几年都有的可盼）", tier="feature", owner="00_pure_core 01b2_achievements 01d3_engine_tree_shop 01d_engine_features 01e5_ui_tree template.html")
def c61():
    """「我想它就是做一个长线的，因为用户可能要用好几年甚至十几年，你要保证长线上让它有意思，
    别让成就那么快得到」。

    体检结果：主成长线 1.4 年走完、3.7 年后只剩「永恒树心 N 重」一个纯数字 —— 断档的不是阈值，
    而是缺第二条轴。补三样：树龄（陪伴天数，强度再低也不缩水）、年轮补长尾、长线成就。"""
    res = json.loads(js(_case_js("c61_forest_longline.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C62 封树成林：林地收藏 + 封树时的数据安全（称号/金币/图鉴不受影响）", tier="feature", owner="00_pure_core 01b2_achievements 01b_engine_data 01d3_engine_tree_shop 01d_engine_features 01e5_ui_tree template.html")
def c62():
    """「我想它就是做一个长线的……甚至十几年都有可能」。

    积分线 3.7 年走完后只剩「第 N 重」这种纯数字；补一条收藏线：养到「永恒树心」可封树成林，
    当前树种从零开始新的一代。用例重点在**封树别清错东西**与**旧积分不会复活**。"""
    res = json.loads(js(_case_js("c62_seal_tree.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C63 森林长线收口：年度回顾 + 树龄陪伴装饰 + 林地小树林", tier="feature", owner="00_pure_core 01d3_engine_tree_shop 01e5_ui_tree template.html")
def c63():
    """长线三件收口：① 每满周年的「年度回顾」结账（只由 records 现算）；② 树周围随树龄出现陪伴物件；
    ③ 林地每封一代画一棵树（年轮越多越壮），文字列表照旧。"""
    res = json.loads(js(_case_js("c63_forest_annual.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C64 交接清单收口：回顾毕业原因分组 / 已排期可点开 / doneAt 签名 / 只看番茄入口", tier="feature", owner="00_pure_core 01eC_ui_todo 01eD_ui_log template.html")
def c64():
    """来自交接文档 §八 已知遗留 与 §11.4 回顾机制复查的 4 条待办，一次做完并钉住。"""
    res = json.loads(js(_case_js("c64_handover_closeout.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C65 连续天数口径（今天无记录不从 0 算）+ 台账 ⏳ 项核实结论", tier="feature", owner="00_pure_core 05_journey_渐进解锁 01b_engine_data template.html")
def c65():
    """核接力文档 §11.5 台账时发现：v9 P1-①「连续天数口径不统一」属实且**一直没修** ——
    `05_journey` 从今天起算，上午打开 App 显示「连续 0 天」（哪怕昨天已连续 30 天）。
    本用例把修正后的口径钉住，并记录台账里几条 ⏳ 的核实结论。"""
    res = json.loads(js(_case_js("c65_journey_streak.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C66 可读性：日记/复盘 17px + 今日反馈默认展开 + 日程说明行收进折叠体", tier="feature", owner="01eM_ui_tbcreate 01e_engine_ui template.html")
def c66():
    """用户 2026-10-13 反馈三处：「日记字太小，看个日记都费劲」「今日反馈不要默认折叠」
    「那行展开说明还在那显示」（根因：说明行被插在标题行与折叠体之间，折叠时它单独留在外面）。"""
    res = json.loads(js(_case_js("c66_readability.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C67 备忘录双向气泡 / 日程结束时间以点选为准 / 每日进步 emoji / 日志卡关联去重", tier="feature", owner="01e9_ui_memo 01eC_ui_todo 01e7_ui_stats 01eD_ui_log 01eM_ui_tbcreate template.html")
def c67():
    """用户 2026-10-13 一批反馈：备忘要"微信式对话"（左右气泡、可切身份）、
    日程排计划的结束时间被自动推算顶掉且改不了、每日进步 emoji 错位、
    日志卡里计划名重复出现、子任务 chip 太小。"""
    res = json.loads(js(_case_js("c67_readability_and_memo.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C68 结算时刻=倒计时归零（不是点结算那一刻）/ 删记录连带裁掉计划实际时段", tier="feature", owner="01c_engine_timer 01d_engine_features 01eA_ui_timeblock")
def c68():
    """需求 2026-10-16 实测：素描 10:30~12:00 做三个番茄，第三个 12:14 就自然完成，
    结算窗没写、13:46 重开 App 才点的结算 —— 结果记录结束时间写成 13:46。
    并且从日志删掉那条记录后，日程里的色块还在（色块还从 todo.actualSegs 画）。"""
    res = json.loads(js(_case_js("c68_settle_time_and_seg_delete.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C69 总览日记字段表（感恩/新字段兜底）+ 总览年切换 + 传记筛选升级", tier="feature", owner="00_pure_core 01e_engine_ui 01e7_ui_stats template.html")
def c69():
    """需求 2026-10-17 四连问：「日记新增的感恩在总览看不到」「总览为什么只能切月，日志记录里
    不是做过年切换吗，复用一下不行吗」「点那个年我才知道能切年，太不明显」「传记筛选很一般」。

    根因分别是一、总览把字段清单手写在渲染函数里（加一个字段就静默丢一块内容）；
    二、总览的日历是另一套实现；三、标题只是 cursor:pointer 的纯文字；
    四、搜索框每敲一个字整块重建（焦点/光标丢）、排序依据与方向挤在一个按钮、
    月份下拉扁平看不出年份、条件只能加不能清。"""
    res = json.loads(js(_case_js("c69_diary_overview_bio_filter.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C70 「名字不是身份」：读路径只认 todoId，名字只在启动迁移用一次（实测：新同名计划吃掉了几天前的段与搁置天数）", tier="core", owner="00_pure_core 01d_engine_features 01eC_ui_todo 01eA_ui_timeblock")
def c70_name_is_not_identity():
    """病根：三处代码都拿**任务名**当身份，且不限日期、不查唯一 ——
    tbTodoSegList 读时按标题认领 / 卡片渲染没传日期 / 搁置按标题全库反查 /
    savePomodoroRecord 写时取第一个同名计划。
    修法：身份优先 todoId；按标题只作老数据兜底，且必须「当天 + 全库同名唯一」。
    A 跨天不认领　B 当天同名仍认领　C 同名多条谁都不认　D 写时解析只认唯一　E 搁置只看自己的账"""
    res = json.loads(js(_case_js("c70_name_is_not_identity.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C72 专注记录页十年可用：整月浏览 + 日历带条数 + 年份快跳 + 多词/按年份搜索", tier="feature", owner="01eD_ui_log template.html")
def c72_log_range_query():
    """需求原话：「我主要是想要更方便吧，就是以后用了10年、十几年，现在这个就不支持查询吧」
    「我之前那个日历功能怎么没加上呀」。
    原来时间筛选只有一个原生 date 框（只能选某一天），日历只有"有没有记录"的红点，
    年份只能靠「上年」一年年点。改成：范围可整月/某天、日历标条数、有记录的年份平铺、
    关键词空格分隔按 AND 且认日期。"""
    res = json.loads(js(_case_js("c72_log_range_query.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C73 迟到结算：段落收在倒计时归零那一刻（不是点结算那一刻），计划卡/日程/记录同一套数字", tier="core", owner="01c_engine_timer 01d_engine_features 01g_engine_init")
def c73_seg_end_clamp():
    """需求 2026-10-17 第二次报：「我计时了但没结算，过了一会才想起来结算，
    专注记录显示 43 分，实际上计划页是 6:01，日程表上显示也是错的」。
    上一轮 C68 只修了记录自己的 endTime；段落（计划卡/日程取数的那份）一直取 Date.now()，
    两条路径各说各话。本轮：收段钉在归零时刻 + 落库收口 + 一次性迁移改正历史。"""
    res = json.loads(js(_case_js("c73_seg_end_clamp.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C74 时长与区间解耦：块长/卡片分数读记录权威时长 effectiveSeconds，不再 Σ(e-s)", tier="core", owner="00_pure_core 01eA_ui_timeblock 01eC_ui_todo")
def c74_seg_length_decoupled():
    """需求 2026-10-17 对照 super-productivity 后指出：「它的时长永远不从区间反算，
    区间歪了时长一点不受影响」。我们这边计划卡 Σ(e-s)、日程块用区间差 ——
    结算晚了区间被裁歪，25 分钟当场变成 43 分钟。
    本轮：区间只决定「画在哪儿」，长度一律读 records[].effectiveSeconds（缺则区间）。
    ①单段 ②同记录多段按占比 ③不同记录互不牵连 ④进行中段不动 ⑤纯函数
    ⑥出参兜底 ⑦⑧自由块 ⑨计划卡同一口径"""
    res = json.loads(js(_case_js("c74_seg_length_decoupled.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C71 段落索引加速：Map<todoId,段[]> 与直扫逐项相同（待办页 536ms→13ms 的正确性证明）", tier="core", owner="01d_engine_features 00_pure_core")
def c71_seg_index():
    """性能改造不能改语义。用随机数据把「索引取数」与「暴力全表扫」逐项对拍：
    A 无日期筛 / B 有日期筛 / C 空记录与空计划 / D 二次读取命中缓存且结果不变 /
    E 新增记录立即生效（不读陈旧缓存）/ F 就地改 segs 后失效生效 /
    G 整体替换 records（导入）后自动重建 / H 跨 todoId 不串账"""
    res = json.loads(js(_case_js("c71_seg_index.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C75 计划被删/被清排期后，日程表那天的预计块仍在（排期快照 todoSchedLog）", tier="feature", owner="00_pure_core 01d_engine_features 01eA_ui_timeblock 01eC_ui_todo")
def c75_sched_snapshot_history():
    """需求 2026-10-17 报：「完成的任务第二天自动删除之后，预计的日程块就不显示了，
    很多天前完成的任务只能看到实际完成的时间」。
    根因：预计块从 appData.todos 现算，而一次性计划勾完成后次日会被 checkNewDay 删掉。
    修法：计划离开活动列表前冻结排期快照（todoSchedLog），渲染时补位。
    A 活对象优先 / B 勾完成冻结 / C 次日删除后预计块仍在 / D 反证会消失 /
    E 取消勾选撤快照 / F 清排期后仍可画 / G 无排期不写快照"""
    res = json.loads(js(_case_js("c75_sched_snapshot_history.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C76 连续打卡起算点：今天还没完成整番茄时从昨天数（海报/统计页不再显示 0 天）", tier="feature", owner="01d5_engine_stats 01e7_ui_stats 01e2_ui_poster 01d_engine_features")
def c76_streak_today_fallback():
    """需求 2026-10-17 报：「这两天都有番茄，海报显示 0 天」。
    根因：calcStreakStats 从今天起算，今天没有整番茄就 break → 海报 0；
    统计页另有一份同样的循环；而树快照与 05_journey 早就修过这条边界。
    修法：今天无整番茄（且未保护）→ 游标退到昨天；统计页/海报只留一份实现。
    A 今天无整番茄=1 / B 今天有=2 / C 昨天断=0 / D 半个不算 / E 今天有昨天断=1 /
    F 同源防回流"""
    res = json.loads(js(_case_js("c76_streak_today_fallback.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C77 多段排期：同一条计划的「主段 + 另排时段」（渲染/交互/校验/日切/快照）", tier="feature", owner="00_pure_core 01d_engine_features 01eA_ui_timeblock 01eC_ui_todo 01eM_ui_tbcreate")
def c77_multi_block():
    """需求 2026-10-18：「早上 7 点到 8 点排一段，下午 3 点到 4 点还想排一段，
    还完不成，明天在日程表上再写一个」。
    数据模型：remindAt/estEnd 仍是主段（唯一真相），新增可选 t.extraBlocks 只装额外段。
    A 渲染 / B 实际段只画一次 / C 选段模式 / D 写入期校验 / E 日切与快照 /
    F 反证（过滤额外段后 A 组变红）/ H 未排期卡入口与 JSON 往返"""
    res = json.loads(js(_case_js("c77_multi_block.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C78 计划的「完成」不该让它从列表里消失（未来/过期/未排期三种落点）", tier="feature", owner="01eA_ui_timeblock 01eC_ui_todo")
def c78_done_keeps_in_list():
    """需求 2026-10-18：「我今天不小心点了一下，完成了那个网上图文问诊的任务，
    然后他突然那个任务就从我的列表上消失了？怎么回事」
    根因：tbTodoSplitForDate 的 carry/future 两分支带 !t.done，排在明天的计划
    勾完成后三组都不收 → 列表凭空消失，连取消勾选的入口都没有。
    A 基线 / B 完成后仍在列表（核心）/ C 可撤销 / D 过期计划 / E 未排期计划 /
    F 完成不影响网格排期 / G 反证（注回 !t.done 则变红）"""
    res = json.loads(js(_case_js("c78_done_keeps_in_list.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C79 专注记录的子步骤快照按记录结束时刻截断（之后勾的不倒灌）", tier="feature", owner="01d_engine_features 01eD_ui_log 00_pure_core")
def c79_subs_snapshot_cutoff():
    """需求 2026-10-18：「我希望这个记录相当于是一个快照的形态，它不能实时更新我完成的
    子计划。比如今天下午几点几点，它只显示我那时完成了多少；后面再完成了别的子计划，
    那它要在别的日志显示，而不是这里同步更新」。
    根因：savePomodoroRecord 里 snapshotPlanSubs(lt) 不看时间，取的是落库那一刻的勾选
    状态 —— 结算窗拖到晚上才确认、或 App 被杀次日恢复结算，都会把之后完成的步骤算进来。
    修法：子任务勾选写 doneAt，快照按 cutoff（这条记录自己的结束时刻）过滤。
    A cutoff 边界 / B 快照冻结 / C 老数据无 doneAt / D 两个勾选入口 /
    E 补记与改挂计划 / F 反证（旧口径与 A6 冲突）"""
    res = json.loads(js(_case_js("c79_subs_snapshot_cutoff.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C80 自由专注填的任务名/备注在结算时不许丢（输入框被清空也认会话）", tier="feature", owner="01c_engine_timer 01d_engine_features")
def c80_free_name_keep():
    res = json.loads(js(_case_js("c80_free_name_keep.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C81 日程网格「计划外」灰块的对比度（深/浅主题都要看得清）", tier="feature", owner="01eA_ui_timeblock template.html")
def c81_unplanned_contrast():
    res = json.loads(js(_case_js("c81_unplanned_contrast.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C82 传记按番茄数计 + 切后台不丢刚敲的字", tier="feature", owner="01e7_ui_stats.js 01d_engine_features.js 01g_engine_init.js")
def c82_bio_count_and_diary_flush():
    res = json.loads(js(_case_js("c82_bio_count_and_diary_flush.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C83 日程块字幕：跨行的块不许只剩 1~3 个字", tier="feature", owner="01eA_ui_timeblock.js")
def c83_tb_label_flow():
    res = json.loads(js(_case_js("c83_tb_label_flow.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C84 自由专注回到待命按正计时画（不许留番茄钟 25:00 与「暂停」按钮）", tier="feature", owner="01c_engine_timer.js")
def c84_free_idle_paint():
    res = json.loads(js(_case_js("c84_free_idle_paint.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C85 同一个「专注时长」不许两个数（日记页要跟日志页同口径）", tier="feature", owner="01e7_ui_stats.js 01eD_ui_log.js")
def c85_focus_duration_one_source():
    res = json.loads(js(_case_js("c85_focus_duration_one_source.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C105 四象限小标四个字色一致且都压得住（不许两个白字两个黑字）", tier="feature", owner="template.html")
def c105_quad_chip_one_ink():
    res = json.loads(js(_case_js("c105_quad_chip_one_ink.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C106 重复计划的排期只能落在规则命中的日子（每周日不许出现在周三）", tier="feature", owner="00_pure_core.js 01d_engine_features.js 01eC_ui_todo.js")
def c106_repeat_block_on_rule_day():
    res = json.loads(js(_case_js("c106_repeat_block_on_rule_day.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C107 眼睛顺手收起今天不轮到的周期任务（开关要有回话）", tier="feature", owner="01eC_ui_todo.js template.html")
def c107_eye_hides_offcycle_repeat():
    res = json.loads(js(_case_js("c107_eye_hides_offcycle_repeat.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C109 专注中陪伴语音：该说时说话，不该说时闭嘴", tier="feature", owner="02_enh571_自律增强.js")
def c109_companion_voice():
    """需求 2026-10-22：语音播报升级成会鼓励、会问「还在专注吗」。
    真正的难点全在「什么时候不该念」：一按开始就来一句像在催；后台念不出还会排队补念；
    结尾 90 秒撞上「准备收尾」；同一番茄反复念同一句。
    A 默认值 / B 间隔未满 / C 满间隔且桶正确 / D 不重复 / E 结尾 90 秒 / F 两个开关 / G 只念一次 / H 换番茄"""
    res = json.loads(js(_case_js("c109_companion_voice.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C108 设置页每个开关都要有回话（开启/关闭各播一条）", tier="feature", owner="01e_engine_ui.js template.html")
def c108_switch_toast_receipt():
    res = json.loads(js(_case_js("c108_switch_toast_receipt.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C86 重复计划跨天后昨天的预计块不许消失（要与一次性同口径）", tier="feature", owner="01d_engine_features.js 01eA_ui_timeblock.js")
def c86_repeat_hist_block():
    res = json.loads(js(_case_js("c86_repeat_hist_block.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C87 计划页：去掉「排序」标签 + 眼睛开关（隐藏今天已完成）", tier="feature", owner="01eC_ui_todo 01d_engine_features 01g_engine_init")
def c87_hide_done():
    """需求 2026-10-19：删掉「排序」二字，在上/下箭头旁加一只眼睛（睁眼/闭眼），
    用来隐藏今天已勾选完成的任务。
    A 标签 / B 入口 / C 隐藏与恢复 + 落盘 / D 全完成时的空态 / E 反证"""
    res = json.loads(js(_case_js("c87_hide_done.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C88 折叠态显示另排时段 + 逾期小标 + 排期块不污染备注", tier="feature", owner="01eC_ui_todo 00_pure_core")
def c88_note_sched_view():
    """需求 2026-10-19：折叠起来也要看见另排时段（这是他截图给老师的依据）。
    A 折叠态（含「另排」行）/ B 排期块出现条件与去重 / C 不污染 detail / D 备注与排期两块内容"""
    res = json.loads(js(_case_js("c88_note_sched_view.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C90 子任务进度与批量勾选", tier="feature", owner="01eC_ui_todo 00_pure_core")
def c90_subs_progress():
    """A 进度与 doneAt / B 脏项 / C 父完成隐藏按钮 / D 空清单 / E 直接调用也生效"""
    res = json.loads(js(_case_js("c90_subs_progress.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C91 「按计划时间」排序：段过了就按下一段排（多段计划）", tier="feature", owner="00_pure_core 01d_engine_features")
def c91_sort_next_block():
    """需求 2026-10-19：「如果时间过了，那就按下一段的那个排序」。
    A 锚点（早于/段中/段后/全过/空档）/ B 排序结果随时间推进 / C 单段与旧字段不回归 /
    D 反证（退回"永远第一段"则 B 组变红）"""
    res = json.loads(js(_case_js("c91_sort_next_block.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C92 新增计划弹窗「预计🍅」快捷档（选而不是填）", tier="feature", owner="01eC_ui_todo.js")
def c92_add_pomo_quick():
    """需求 2026-10-19：「预计番茄是可以选的，而不是给填呀，我可以有快捷方式选」。
    A 档位与编辑面板共用同一数组 / B 点 chip 写值+高亮 / C 手敲跟随、非档位值不硬凑 /
    D 清空 = null / E 走 confirmAddTodo 真落盘"""
    res = json.loads(js(_case_js("c92_add_pomo_quick.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C93 排期显示的日期精度：卡片到日、展开/设置/弹窗到年月日", tier="feature", owner="01eC_ui_todo.js 00_pure_core.js")
def c93_sched_date_precision():
    """需求 2026-10-19：「计划那展示不显示年月日；但你展开或者设置里、添加那里，要精确到年月日，
    因为不同的隔天排期这都不一样」。
    A 折叠卡只写日（当天不写日期）/ B 展开态写完整年月日+段只写时分 / C 设置面板 chip 带年月日 /
    D 弹窗 chip 带年月日 / E 跨天段的日期归属正确（不再把明天那段冒领成今天）"""
    res = json.loads(js(_case_js("c93_sched_date_precision.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C94 「下次重复时，子任务」三档：全部回到未完成 / 只清已完成 / 整条清空", tier="feature", owner="01eC_ui_todo.js 01d_engine_features.js 00_pure_core.js")
def c94_subs_mode_three():
    """需求 2026-10-19：「我本来想的是三个：一个整条清空重新列、一个清除已完成的只保留未完成的、
    还有一个所有全部回到未完成」。A reset / B clearDone / C clear 三档行为与归一。"""
    res = json.loads(js(_case_js("c94_subs_mode_three.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C95 只做过、没排过的计划也要在日程表上画出实际块", tier="feature", owner="01eA_ui_timeblock.js")
def c95_act_only_row():
    """需求 2026-10-19：「晚上完成的半个番茄背单词，为什么日程表上不显示」。
    没有排期就没有块、也就没有行 —— 实际段无处安放，整条记录在网格上消失。"""
    res = json.loads(js(_case_js("c95_act_only_row.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C96 重复计划可以只改某一天的排期（按天覆盖）", tier="feature", owner="00_pure_core.js 01d_engine_features.js 01eC_ui_todo.js")
def c96_dayplan_override():
    """需求 2026-10-19：「我的周期任务排期不一定固定，但现在改一次就天天都变；
    还担心改了以后前面几天也跟着变」。
    A 覆盖只影响那一天（整组替换模板）/ B 块挂在正确日期 / C 历史快照不受影响 /
    D 校验与恢复模板 / E 日切清理 / F 排序锚点 / G 反证（停掉覆盖分支必红）。"""
    res = json.loads(js(_case_js("c96_dayplan_override.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C97 重复计划的排期不写死某一天", tier="feature", owner="00_pure_core.js 01eC_ui_todo.js")
def c97_repeat_sched_no_date():
    """需求 2026-10-19：「既然重复的，刨开那个单日那个排期，为什么它还会精确到日呢？
    这会让人产生误解吧」。
    重复模板段的日期是平移算出来的 → 不写日期、改写规则文案；
    按天覆盖/一次性/历史快照的日期是真的 → 照旧写完整年月日。
    A 来源标记 / B 展开态不写日期 / C 覆盖那天标「仅这天」 / D 一次性与快照保留精度 /
    E 编辑面板 chip / F 反证前提。"""
    res = json.loads(js(_case_js("c97_repeat_sched_no_date.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C98 自由专注快照不复活 + 冷启动回到上次那页", tier="feature", owner="01c_engine_timer.js 01e_engine_ui.js 01g_engine_init.js")
def c98_free_snapshot_stale():
    """需求 2026-10-20：「选着选择计划突然变成计时界面，说我在计时洗漱，
    可我早就结束、还在日志里把记录删了，数据好像回滚了一样」。
    ① 结束弹窗开着时计时仍在跑 → 页面被回收后快照复活成「正在计时」；
    ② 地址栏 hash 不写 → 重载必然回到计时页。
    A 陈旧快照丢弃 / B 正常快照照常恢复（反证）/ C 待结算态重弹结算窗不跑 /
    D 过期待结算作废 / E 点结束即记账 / F 冷启动回到上次那页且 hash 优先。"""
    res = json.loads(js(_case_js("c98_free_snapshot_stale.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C99 「单日」可以在日程表上点两格指定", tier="feature", owner="01eM_ui_tbcreate.js 01eC_ui_todo.js")
def c99_dayplan_pick_block():
    """需求 2026-10-20：「单日是不是也可以选择那个块」「现在今日的怎么只能靠输入呀」。
    设置面板「单日」行加「在日程表选」→ 选段模式（_arm.mode='dayplan'）→ 点两格 =
    那一天整组换成这段（不是追加），点完自动退出。
    A 入口与横幅 / B 点两格只改那一天 / C 再选一次仍是替换 / D 自动退出 / E 面板按钮。"""
    res = json.loads(js(_case_js("c99_dayplan_pick_block.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C100 旧窗口不许覆盖新数据（守卫 3）", tier="feature", owner="01b_engine_data.js 01d_engine_features.js")
def c100_stale_instance_overwrite():
    """需求 2026-10-20：「昨天完成的英语今天变未完成，日志也删了」「数学排期也没了」。
    三次导出对比：今早那份逐字节等于昨晚 20:02 那份 → 一个从 20:02 起没重载过的窗口
    早上醒来跑日切，把 22:57 的数据整份盖掉。
    修法：写盘前比对写入戳，别的窗口写得更新 → 本次写盘作废 + 重载。
    A 挡下旧窗口的写盘 / B 自己的与更旧的戳不挡 / C 写盘后戳归自己 / D 判据 / E 反证前提。"""
    res = json.loads(js(_case_js("c100_stale_instance_overwrite.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C101 每段排期各自到点提醒", tier="feature", owner="00_pure_core.js 01g_engine_init.js")
def c101_remind_per_block():
    """需求 2026-10-20：「不同的排期应该有不同的提醒吧」「提醒想默认排期开始前」。
    原来只认 t.remindAt 一个时刻 + t.reminded 一个布尔：排了 8:20 和 9:20 两段，
    只有第一段会响。改成每段一 key 一确认位。
    A 摊平每段 / B 确认位各管各的 / C 旧 reminded 只对第一段生效 / D 当天日期闸 / E 端到端。"""
    res = json.loads(js(_case_js("c101_remind_per_block.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C103 跨天计划在计划页怎么标（昨天的/明天的/重复不命中）", tier="feature", owner="01eC_ui_todo.js template.html")
def c103_plan_cross_day_labels():
    """需求 2026-10-20：「排期到了第二天计划页还显示吗？单日的会不会混淆」。
    实测：昨天没做完的进「之前没完成的」、明天的进「之后的安排」、重复计划按设计恒在
    今日计划组（够得着才能改规则）。真混淆的是**标题行 ⏰ 只写时分**——昨天/明天/未命中
    的重复计划今天都不会响，却长得像「今天 9:00 要提醒」。改法：非今天的提醒带日期并
    淡化，未命中的重复计划补一行「🔄 每周三 · 今天不做」。"""
    res = json.loads(js(_case_js("c103_plan_cross_day_labels.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C104 「✅ N 段 · 共 X 分」按天算，不跨天累计", tier="feature", owner="01d_engine_features.js 01eC_ui_todo.js")
def c104_actual_segs_per_day():
    """问题 2026-10-20：「周期性任务那个 ✅ 4 段 · 共 100 分，第二天会重新计算吗」。
    会的 —— 段数与分钟都按**查看的那一天**从记录里算（tbTodoSegList / tbTodoFocusMs
    带 dateStr），不复用计划身上的 actualPomodoros / timeSpent（那两个是「本轮」累计，
    日切复位清零）。两种口径并存，这条用例就是防止哪天被接到一起。
    A 取数按天 / B 卡片字面输出 / D 复位清累计但不动记录 / E 日切整条路径与幂等。"""
    res = json.loads(js(_case_js("c104_actual_segs_per_day.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C102 番茄结束的备注不写回计划备注", tier="feature", owner="01d_engine_features.js 01c_engine_timer.js")
def c102_finish_note_not_plan():
    """需求 2026-10-20：「番茄结束的备注为什么把计划的备注也改了」「周期性的任务每天都用
    番茄，岂不是会把备注改得乱七八糟」。结算时本会把结束备注写回计划 detail，重复计划
    每做一次就被上一轮的感受覆盖；留空还会把计划说明清空。
    A 一次性计划 / B 重复计划连做两次 / C 留空不清空 / D 计时页备注框的共通入口没被误伤。"""
    res = json.loads(js(_case_js("c102_finish_note_not_plan.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C111 内联事件清零：所有交互走 data-* 委托（模块化前置）", tier="feature", owner="template.html 00_delegate")
def c108_no_inline_handlers():
    """内联 on*="..." 在全局作用域求值，是上 ES 模块的唯一硬阻塞。
    本用例守两件事：① 五个视图都渲染过之后，DOM 里内联处理器必须为 0
    （模板已静态改写；脚本拼接的由 00_delegate 的兼容层在插入后接管）；
    ② 委托真的能派发 —— 直接点一个 data-act 元素，看状态变化。
    失败含义：有人新写了 onclick，或兼容层被改坏（解析不了会原样保留）。"""
    for v in ("timer", "plan", "log", "stats", "settings"):
        js(f"switchView('{v}')"); time.sleep(0.12)
    js("switchView('timer')"); time.sleep(0.12)
    # 兼容层是 MutationObserver：渲染后它在微任务里接管，紧贴着读可能读到"刚插入还没接管"，
    # 所以这里轮询 2 秒（等它收敛），而不是要求"第一毫秒就是 0"。
    left = None
    for _ in range(20):
        left = js("document.querySelectorAll('[onclick],[onchange],[oninput],[onkeydown],[onfocus],[onblur]').length")
        if left == 0:
            break
        time.sleep(0.1)
    check(left == 0, f"渲染 5 视图后内联处理器为 0（实测 {left}）")
    total = js("document.querySelectorAll('[data-act]').length")
    check(isinstance(total, int) and total > 50, f"声明式事件已成规模（data-act {total} 个）")
    # 反证：委托链真的执行 —— 打开「回顾」弹窗再关掉
    opened = js("(function(){var hit=false;var orig=window.openReviewModal;window.openReviewModal=function(){hit=true;if(orig)return orig.apply(this,arguments);};var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='openReviewModal')b=bs[i];}if(!b){window.openReviewModal=orig;return 'no-btn';}b.click();window.openReviewModal=orig;return hit;})()")
    check(opened is True, "点 data-act 按钮真的调到了处理函数（委托生效）")
    js("(function(){var m=document.getElementById('reviewModal');if(m)m.classList.remove('active');})()")


@case("C112 数据契约：uid / updatedAt / 删除墓碑（接后端前置）", tier="feature", owner="01b_engine_data")
def c112_data_contract():
    """接后端前必须有的三样东西，缺一样同步就会出事：

    ① 每条记录有**全局唯一 uid** —— 否则多端同时创建会撞车，两条不同记录被当成同一条；
    ② 每条记录有 **updatedAt** —— 否则编辑三个月前的记录时，时间戳还停在三个月前，
       同步判定「服务端更新」把用户刚改的内容覆盖掉；
    ③ 删除留**墓碑** —— 否则服务端只看到「这边少一条」，下次拉取把已删记录复活。

    外加两条幂等：重复迁移 uid 不变、重复删同一 uid 墓碑不膨胀。
    这三条不做，加再多「接口层」也是假的架构预留。
    """
    js("localStorage.clear();location.reload()"); time.sleep(2.8)

    # ---- A1/A2 老数据迁移：无 uid 的记录补确定性 uid，updatedAt 退回自身时间 ----
    got = js("""(function(){
      appData.records.push({id: 987654321, type:'log', startTime: 1700000000000,
                            endTime: 1700000600000, effectiveSeconds: 600});
      migrateDataContract();
      var r = appData.records[appData.records.length-1];
      var u1 = String(r.uid || ''), t1 = r.updatedAt;
      migrateDataContract();                    /* 再跑一次：必须一个字节都不变 */
      return {u1:u1, u2:String(r.uid || ''), t1:t1, t2:r.updatedAt};
    })()""")
    check(isinstance(got, dict) and str(got.get("u1", "")).startswith("rec_987654321"),
          f"老记录迁移出确定性 uid（{got.get('u1') if isinstance(got, dict) else got}）")
    check(isinstance(got, dict) and got.get("u1") == got.get("u2") and got.get("t1") == got.get("t2"),
          "迁移幂等：再跑一次 uid / updatedAt 都不变（否则每次加载都会被当成新记录）")
    check(isinstance(got, dict) and got.get("t1") == 1700000600000,
          "老记录 updatedAt 退回自身的结束时刻（不是 0，也不是「现在」）")

    # ---- A2b 同 id 的两条记录，迁移后 uid 必须不同 ----
    # id 本身不保证唯一（补记用 Date.now()+rand(1000)，同毫秒有 1/1000 概率撞）。
    # 撞了之后两条不同记录在合并时会被当成同一条 —— 丢数据且无任何报错。
    got = js("""(function(){
      appData.records.push({id: 888, type:'log', startTime:1, endTime:2, effectiveSeconds:60});
      appData.records.push({id: 888, type:'log', startTime:3, endTime:4, effectiveSeconds:60, taskName:'另一条'});
      migrateDataContract();
      var us = appData.records.filter(function(r){ return String(r.id)==='888'; }).map(function(r){ return r.uid; });
      return {n:us.length, uniq: us[0]!==us[1], u1:us[0], u2:us[1]};
    })()""")
    check(isinstance(got, dict) and got.get("n") == 2 and got.get("uniq") is True,
          f"同 id 的两条记录 uid 不撞（{got}）")
    check(isinstance(got, dict) and str(got.get("u1", "")).startswith("rec_888"),
          "去重后第一条仍保留原名（幂等：重复迁移不会继续加序号）")

    # ---- A3 删除留墓碑：走真实 deleteRecord，记录消失 + 墓碑出现 ----
    js("""(function(){
      window.__rsBak = window.rsConfirm;
      window.rsConfirm = function(){ return Promise.resolve(true); };   /* 自动点「删除」 */
      deleteRecord(987654321);
      return 1;
    })()""")
    time.sleep(0.5)
    got = js("""(function(){
      var left = appData.records.filter(function(r){ return String(r.id)==='987654321'; }).length;
      var t = (appData.tombstones||[]).filter(function(x){ return String(x.uid).indexOf('987654321')>=0; });
      return {left:left, n:t.length, kind:t[0]&&t[0].kind, at:(t[0]&&t[0].deletedAt)||0};
    })()""")
    check(isinstance(got, dict) and got.get("left") == 0, "删除后记录真的从列表消失（墓碑不挡业务）")
    check(isinstance(got, dict) and got.get("n") == 1 and got.get("kind") == "record",
          f"删除留下一条 record 墓碑（{got}）")
    check(isinstance(got, dict) and (got.get("at") or 0) > 0, "墓碑带 deletedAt（同步靠它判先后）")

    # ---- A4 墓碑幂等：同一 uid 删两次只留一条 ----
    got = js("""(function(){
      var b = appData.tombstones.length;
      tombstone('rec_dup_probe','record');
      tombstone('rec_dup_probe','record');
      return {b:b, a:appData.tombstones.length,
              n:appData.tombstones.filter(function(x){return x.uid==='rec_dup_probe';}).length};
    })()""")
    check(isinstance(got, dict) and got.get("a") == got.get("b") + 1 and got.get("n") == 1,
          "同一 uid 重复删只留一条墓碑（导入同一份备份不会把文件撑爆）")

    # ---- A5 新记录真的带 uid / updatedAt（防回流）----
    # 为什么查构建产物而不是页面里的函数：savePomodoroRecord 被 __replaceX 包过一层，
    # String(window.savePomodoroRecord) 拿到的是包装函数，函数体里当然没有建记录的代码。
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _eng = ""
    try:
        _eng = open(os.path.join(_root, "public", "assets", "engine.js"), encoding="utf-8").read()
    except OSError:
        pass
    check("newUid(" in _eng and "uid:" in _eng,
          "结算建记录时写入 uid（防回流：有人删掉 newUid 这条就红）")
    check("updatedAt:" in _eng and "touchRecord(" in _eng,
          "记录写入 / 编辑都带 updatedAt")

    # ---- A6 导入合并：墓碑取并集，本机删过的凭证不会因恢复备份而丢 ----
    got = js("""(function(){
      var bk = JSON.parse(JSON.stringify(appData));
      bk.tombstones = [{uid:'rec_from_backup', kind:'record', deletedAt: 111}];
      var hadLocal = (appData.tombstones||[]).length;
      normalizeBackupData(bk);
      var hasBackup = (appData.tombstones||[]).filter(function(t){return t.uid==='rec_from_backup';}).length;
      var hasLocal = (appData.tombstones||[]).filter(function(t){return t.uid==='rec_dup_probe';}).length;
      return {hadLocal:hadLocal, hasBackup:hasBackup, hasLocal:hasLocal};
    })()""")
    check(isinstance(got, dict) and got.get("hasBackup") == 1, "导入时带上备份里的墓碑")
    check(isinstance(got, dict) and got.get("hasLocal") == 1,
          "导入后本机墓碑仍在（取并集，不是覆盖）")

    # 用完清干净，别把墓碑留给后面用例
    js("localStorage.clear();location.reload()"); time.sleep(2.4)


@case("C113 离线同步：变更队列 + 合并规则（后端未接，链路先跑通）", tier="feature", owner="01b3_sync")
def c113_sync_outbox():
    """后端还没写，但「离线改了东西怎么不丢」这件事现在就能测。

    守四条不变量：
      ① 编辑/删除**自动入队**（业务代码不用记着调用）；
      ② 同一记录反复改只留一条（自动保存 5 秒一次，不合并会推一堆中间态）；
      ③ push 失败时队列**不清空**（服务端没确认 ≠ 已送达）；
      ④ 拉回来的远端数据按「墓碑优先 → updatedAt 大的赢」合并，旧值不许覆盖新值。

    为什么值得现在测：这四条错了，表现是「用户改的东西过一会儿自己变回去」，
    在真机上极难复现，而它们全是客户端的纯逻辑。
    """
    # ⚠️ 只 clear + reload 清不干净：reload 的 beforeunload 会把**内存里的 appData**
    #    再写回 localStorage，上一个用例的 records / outbox / tombstones 又回来了。
    #    C113 要「数」队列长度，所以清空必须发生在 reload **之后**（新文档里）。
    js("localStorage.clear();location.reload()"); time.sleep(2.8)
    js("""(function(){
      appData.records = []; appData.todos = []; appData.habits = [];
      appData.memos = []; appData.countdowns = [];
      appData.tombstones = []; appData.outbox = [];
      saveData();
      return 1;})()"""); time.sleep(0.2)

    got = js("JSON.stringify({outbox:(appData.outbox||[]).length, records:(appData.records||[]).length})")
    import json as _j0
    _g0 = _j0.loads(got) if isinstance(got, str) else {}
    check(_g0.get("outbox") == 0 and _g0.get("records") == 0,
          f"用例前置：全新用户态（队列 {_g0.get('outbox')} / 记录 {_g0.get('records')}）")

    js("""(function(){
      appData.records.push({id: 111, uid:'rec_local_1', updatedAt: 1000, type:'log',
                            startTime:1, endTime:2, effectiveSeconds:60});
      return 1;})()""")

    # ---- A0 推送内容覆盖全部集合（曾经只推 records/todos，其余静默丢）----
    got = js("""(function(){
      appData.habits.push({id: 5, uid:'habit_p', updatedAt:1, name:'看书'});
      touchRecord(appData.habits[0]);
      appData.memos.push({id:'mp', uid:'memo_p', updatedAt:1, text:'备忘一条', ts:1});
      touchRecord(appData.memos[0]);
      appData.countdowns.push({id: 6, uid:'cd_p', updatedAt:1, title:'生日'});
      touchRecord(appData.countdowns[0]);
      /* 子任务是嵌套的：改子任务 → 必须把**父计划**整份推上去 */
      appData.todos.push({id: 7, uid:'todo_p', updatedAt:1, title:'父计划',
                          subs:[{id:71, uid:'sub_p', updatedAt:1, title:'第一步', done:false}]});
      touchRecord(appData.todos[0].subs[0]);
      var pl = syncPayload();
      var r = {h:(pl.habits||[]).length, m:(pl.memos||[]).length,
               cd:(pl.countdowns||[]).length,
               t:(pl.todos||[]).length,
               subAsTodo: (pl.todos||[]).some(function(t){ return t.uid==='todo_p'; }),
               keys: Object.keys(pl).sort().join(',')};
      /* 清干净，后面几条要用「只有一条在队列」的前提 */
      appData.outbox = []; appData.habits = []; appData.memos = [];
      appData.countdowns = []; appData.todos = [];
      return r;
    })()""")
    check(isinstance(got, dict) and got.get("h") == 1, f"habit 变更带数据上推（{got}）")
    check(isinstance(got, dict) and got.get("m") == 1, "备忘变更带数据上推")
    check(isinstance(got, dict) and got.get("cd") == 1, "倒计时变更带数据上推")
    check(isinstance(got, dict) and got.get("subAsTodo") is True,
          "改子任务时推的是父计划整份快照（否则服务端拿到 uid 却没有数据）")

    # ---- A1 编辑自动入队 ----
    got = js("""(function(){
      var r = appData.records.filter(function(x){return x.uid==='rec_local_1';})[0];
      touchRecord(r);
      return {n: appData.outbox.length,
              uid: appData.outbox[0] && appData.outbox[0].uid,
              op: appData.outbox[0] && appData.outbox[0].op,
              kind: appData.outbox[0] && appData.outbox[0].kind};
    })()""")
    check(isinstance(got, dict) and got.get("n") == 1 and got.get("uid") == "rec_local_1" and got.get("op") == "upsert",
          f"编辑记录自动入队（{got}）")
    check(isinstance(got, dict) and got.get("kind") == "rec", "入队时按 uid 前缀推断出正确 kind")

    # ---- A2 同一条反复改只留一条（合并，不膨胀）----
    got = js("""(function(){
      var r = appData.records.filter(function(x){return x.uid==='rec_local_1';})[0];
      touchRecord(r); touchRecord(r); touchRecord(r);
      return {n: appData.outbox.length,
              same: appData.outbox.filter(function(c){return c.uid==='rec_local_1';}).length};
    })()""")
    check(isinstance(got, dict) and got.get("n") == 1 and got.get("same") == 1,
          f"同一记录连改 4 次仍只占 1 条队列（{got}）")

    # ---- A3 删除入队为 delete，并覆盖同 uid 的 upsert ----
    got = js("""(function(){
      tombstone('rec_local_1','record');
      var c = appData.outbox.filter(function(x){return x.uid==='rec_local_1';});
      return {n:c.length, op:c[0]&&c[0].op};
    })()""")
    check(isinstance(got, dict) and got.get("n") == 1 and got.get("op") == "delete",
          f"删除入队为 delete，且覆盖同 uid 的 upsert（{got}）")

    # ---- A4 push 成功 → 只清 ack 过的，队列归零 ----
    js("""(function(){
      window.__pushed = null;
      setSyncAdapter({
        name:'mock', enabled:true,
        push: function(p){
          window.__pushed = {n:(p.changes||[]).length, uids:(p.changes||[]).map(function(c){return c.uid;})};
          return Promise.resolve({ack:(p.changes||[]).map(function(c){return c.uid;}), cursor:'c1'});
        },
        pull: function(){ return Promise.resolve({records:[], todos:[], tombstones:[], cursor:'c1'}); }
      });
      return 1;})()""")
    js("(function(){ window.__syncRes=null; syncNow().then(function(r){window.__syncRes=r;}); return 1;})()")
    time.sleep(0.6)
    got = js("""JSON.stringify({pushed: window.__pushed, left: appData.outbox.length,
                                res: window.__syncRes && window.__syncRes.acked})""")
    import json as _json
    _g = _json.loads(got) if isinstance(got, str) else {}
    check(_g.get("pushed", {}).get("n") == 1, f"推送带上队列里的变更（{_g.get('pushed')}）")
    check(_g.get("left") == 0, "服务端 ack 后队列清空（不留已送达的）")
    # 出队必须落盘：只在内存里清 → 重启后已送达的变更又回队列，越滚越大、每次重推
    js("location.reload()"); time.sleep(2.6)
    left_after = js("(appData.outbox||[]).length")
    check(left_after == 0, f"出队已落盘：重启后队列仍为空（实测 {left_after}）")
    js("""(function(){
      setSyncAdapter({ name:'mock', enabled:true,
        push: function(p){ return Promise.resolve({ack:(p.changes||[]).map(function(c){return c.uid;}), cursor:'c1'}); },
        pull: function(){ return Promise.resolve({records:[], todos:[], tombstones:[], cursor:'c1'}); } });
      return 1;})()""")

    # ---- A5 push 失败 → 队列保留（不丢变更）----
    js("""(function(){
      /* 用一条新记录：rec_local_1 在 A4 的合并里已被墓碑删掉了（那正是 A6 要验证的行为），
         这里不能依赖它还在。 */
      appData.records.push({id: 444, uid:'rec_fail_1', updatedAt: 1, type:'log',
                            startTime:1, endTime:2, effectiveSeconds:60});
      var r = appData.records.filter(function(x){return x.uid==='rec_fail_1';})[0];
      touchRecord(r);
      setSyncAdapter({ name:'mock-fail', enabled:true,
        push: function(){ return Promise.reject(new Error('network down')); },
        pull: function(){ return Promise.resolve({records:[],todos:[],tombstones:[],cursor:'c1'}); } });
      return 1;})()""")
    js("(function(){ window.__failRes=null; syncNow().then(function(r){window.__failRes=r;}); return 1;})()")
    time.sleep(0.6)
    got = js("""JSON.stringify({left: appData.outbox.length, err: !!(window.__failRes && window.__failRes.error)})""")
    _g = _json.loads(got) if isinstance(got, str) else {}
    check(_g.get("left") == 1, f"push 失败队列不清空（实测剩 {_g.get('left')} 条）")
    check(_g.get("err") is True, "push 失败被捕获成结果对象，不抛到调用方")

    # ---- A6 拉取合并：墓碑优先 + 远端更新的赢 + 旧的不许覆盖新的 ----
    got = js("""(function(){
      /* 本地：rec_local_1(updatedAt 现在) / rec_keep(updatedAt 900) / rec_old(updatedAt 100) */
      appData.records.push({id: 222, uid:'rec_keep', updatedAt:900, type:'log', startTime:1, endTime:2, effectiveSeconds:60, taskName:'KEEP'});
      appData.records.push({id: 333, uid:'rec_old', updatedAt:100, type:'log', startTime:1, endTime:2, effectiveSeconds:60, taskName:'OLD'});
      setSyncAdapter({ name:'mock-pull', enabled:true,
        push: function(p){ return Promise.resolve({ack:(p.changes||[]).map(function(c){return c.uid;}), cursor:'c2'}); },
        pull: function(){ return Promise.resolve({
          records: [
            {uid:'rec_new',  updatedAt:500, type:'log', taskName:'NEW'},     /* 本地没有 → 新增 */
            {uid:'rec_keep', updatedAt:800, type:'log', taskName:'SBAD'},    /* 远端更旧 → 不许覆盖 */
            {uid:'rec_old',  updatedAt:200, type:'log', taskName:'UPD'}      /* 远端更新 → 覆盖 */
          ],
          todos: [],
          tombstones: [{uid:'rec_local_1', kind:'record', deletedAt: Date.now()+1000}],  /* 另一端删了 */
          cursor:'c2' });
        } });
      window.__pullRes = null;
      syncNow().then(function(r){ window.__pullRes = r; });
      return 1;})()""")
    time.sleep(0.7)
    got = js("""(function(){
      var f = function(u){ return appData.records.filter(function(x){return x.uid===u;})[0]; };
      return {added: f('rec_new') && f('rec_new').taskName,
              keep: f('rec_keep') && f('rec_keep').taskName,
              upd: f('rec_old') && f('rec_old').taskName,
              deleted: !f('rec_local_1')};
    })()""")
    check(isinstance(got, dict) and got.get("added") == "NEW", "远端新记录并进来")
    check(isinstance(got, dict) and got.get("keep") == "KEEP",
          f"远端更旧的不覆盖本地（实测 {got.get('keep') if isinstance(got, dict) else got}）")
    check(isinstance(got, dict) and got.get("upd") == "UPD", "远端更新的覆盖本地")
    check(isinstance(got, dict) and got.get("deleted") is True, "远端墓碑把本地那条删掉（不复活）")

    # 收尾：恢复 noop 适配器并清空存储，别影响后面的用例
    js("""(function(){
      setSyncAdapter({ name:'noop', enabled:false,
        push: function(){ return Promise.resolve({ack:[],cursor:null}); },
        pull: function(c){ return Promise.resolve({records:[],todos:[],tombstones:[],cursor:c}); } });
      return 1;})()""")
    js("localStorage.clear();location.reload()"); time.sleep(2.4)


@case("C114 双设备时序：墓碑优先 / 乱序到达 / 离线积累（协议行为基准）", tier="feature", owner="01b3_sync")
def c114_dual_device():
    """两台设备 + 一个内存服务端，跑真实的并发时序。

    为什么函数级单测不够：`mergeRemoteRecords` 单独测只回答「给定两批数据怎么合」，
    而线上事故来自**顺序**——A 先改、B 后删、A 又改，这三步按不同顺序到达服务端，
    结果完全不同。本用例把这三种顺序都钉死，作为将来服务端实现的**行为基准**：
    如果服务端的 SQL 合并规则与这里不一致，两端就会永久分叉。

    三个场景：
      S1 A改 → B删 → A再改     → 最终必须**删除**（墓碑优先于更新，即使更新的时间更晚）
      S2 A改、B改（B更晚）      → 两端都是 B 的值（记录级 LWW）
      S3 B的旧变更晚到服务端    → 不许覆盖 A 的新值（乱序不做「最后到达者赢」）
      S4 B断网改 5 次只推最后   → 服务端拿到最终值，不是中间态
    """
    js("localStorage.clear();location.reload()"); time.sleep(2.8)

    raw = js("""(function(){
      /* ---- 极简双设备 + 内存服务端；合并规则复用 00_pure_core 的同一套函数 ---- */
      function dev(name){ return { name:name, records:[], todos:[], tombstones:[] }; }
      function srv(){ return { recs:{}, tombs:[], ops:0 }; }

      /* 编辑：写记录（含 uid/updatedAt）。已在墓碑里的拒绝写回 —— 与 syncNow 的语义一致 */
      /* 就地更新（不是造新对象）：造新对象而不替换数组元素，等于「编辑丢了」，
         这正是真实代码里 touchRecord 要就地改的原因。 */
      function edit(d, uid, patch, at){
        for (var i=0;i<d.records.length;i++){
          if (d.records[i].uid===uid){
            Object.assign(d.records[i], patch, { updatedAt: at });
            return d.records[i];
          }
        }
        var rec = Object.assign({ uid:uid, updatedAt:at }, patch);
        d.records.push(rec);
        return rec;
      }
      function del(d, uid, at){
        d.records = d.records.filter(function(r){ return r.uid!==uid; });
        d.tombstones = mergeTombstoneLists(d.tombstones, [{uid:uid, kind:'record', deletedAt:at}], 2000);
      }
      /* 服务端接收：墓碑优先 → LWW。返回被接受的 uid 数 */
      function srvPush(S, d){
        var accepted = 0;
        S.tombs = mergeTombstoneLists(S.tombs, d.tombstones, 2000);
        var tombOf = {};
        S.tombs.forEach(function(t){ tombOf[t.uid]=1; });
        d.tombstones.forEach(function(t){ delete S.recs[t.uid]; });   /* 删除即刻生效 */
        d.records.forEach(function(r){
          if (!r || !r.uid) return;
          if (tombOf[r.uid]) return;                                  /* 删过的不再接受 */
          var cur = S.recs[r.uid];
          if (!cur || (Number(r.updatedAt)||0) > (Number(cur.updatedAt)||0)) { S.recs[r.uid]=r; accepted++; }
        });
        S.ops++;
        return accepted;
      }
      /* 设备拉取：拿全量 + 墓碑，按纯函数合并 */
      function devPull(d, S){
        var batch = { records: Object.keys(S.recs).map(function(k){ return S.recs[k]; }),
                      todos: [], tombstones: S.tombs };
        var tombs = mergeTombstoneLists(d.tombstones, batch.tombstones, 2000);
        var m = mergeRemoteRecords(d.records, batch.records, tombs);
        d.tombstones = tombs;
        d.records = m.list;
        return m;
      }
      function pick(d, uid){
        for (var i=0;i<d.records.length;i++) if (d.records[i].uid===uid) return d.records[i];
        return null;
      }

      var A = dev('A'), B = dev('B'), S = srv();
      var out = {};

      /* ===== S1：A改 → B删 → A再改（A 的编辑时间更晚，但必须被墓碑压住） ===== */
      edit(A,'rec_x',{ taskName:'v1' }, 100);
      srvPush(S, A); devPull(B, S);                       /* X 到 B */
      del(B,'rec_x', 200); srvPush(S, B);                 /* B 删 X */
      edit(A,'rec_x',{ taskName:'v2-late' }, 300);        /* A 在删除之后又改了 */
      srvPush(S, A);                                      /* 服务端：删过的，拒收 */
      devPull(A, S); devPull(B, S);
      out.s1 = { a: !!pick(A,'rec_x'), b: !!pick(B,'rec_x'),
                 srv: !!S.recs['rec_x'], tomb: S.tombs.some(function(t){return t.uid==='rec_x';}) };

      /* ===== S2：A改、B改（B 更晚）→ 两端都是 B 的值 ===== */
      edit(A,'rec_y',{ taskName:'from-A' }, 1000); srvPush(S,A); devPull(B,S);
      edit(A,'rec_y',{ taskName:'A-newer' }, 1100);
      edit(B,'rec_y',{ taskName:'B-newest' }, 1200);
      srvPush(S, A); srvPush(S, B);
      devPull(A, S); devPull(B, S);
      out.s2 = { a: pick(A,'rec_y') && pick(A,'rec_y').taskName,
                 b: pick(B,'rec_y') && pick(B,'rec_y').taskName };

      /* ===== S3：B 的旧变更「晚到」服务端 → 不许覆盖 A 的新值 ===== */
      edit(A,'rec_z',{ taskName:'A-fresh' }, 2000); srvPush(S,A);
      var stale = { uid:'rec_z', updatedAt:1900, taskName:'B-stale' };
      S.recs['rec_z'] = S.recs['rec_z'];                 /* 服务端当前是 A-fresh */
      var before = S.recs['rec_z'].taskName;
      /* 直接模拟「一个旧包晚到」：走同一套 srvPush，但只带这一条 */
      var tmp = dev('tmp'); tmp.records.push(stale); srvPush(S, tmp);
      devPull(A, S); devPull(B, S);
      out.s3 = { serverBefore: before, serverAfter: S.recs['rec_z'].taskName,
                 a: pick(A,'rec_z') && pick(A,'rec_z').taskName };

      /* ===== S4：B 断网改 5 次，只推最后一次 ===== */
      var lastAt = 0;
      for (var i=1;i<=5;i++){
        lastAt = 3000 + i*10;
        edit(B,'rec_w',{ taskName:'offline-'+i }, lastAt);
      }
      srvPush(S, B);                                      /* 联网后一次推 */
      devPull(A, S);
      out.s4 = { srv: S.recs['rec_w'] && S.recs['rec_w'].taskName,
                 a: pick(A,'rec_w') && pick(A,'rec_w').taskName,
                 at: S.recs['rec_w'] && S.recs['rec_w'].updatedAt };

      return out;
    })()""")

    import json as _json
    # js() 带 returnByValue：对象直接回 Python dict；异常时是 "EXC:..." 字符串
    if isinstance(raw, dict):
        r = raw
    elif isinstance(raw, str) and not raw.startswith("EXC:"):
        r = _json.loads(raw)
    else:
        r = {"_err": raw}

    s1 = r.get("s1", {})
    check(s1.get("a") is False and s1.get("b") is False,
          f"S1 墓碑优先：A 在删除后又改，两端仍然都没有这条（{s1}）")
    check(s1.get("srv") is False, "S1 服务端也不保留（删过的不再接受更新）")
    check(s1.get("tomb") is True, "S1 墓碑还在（删除凭证不能因为后续更新被清掉）")

    s2 = r.get("s2", {})
    check(s2.get("a") == "B-newest" and s2.get("b") == "B-newest",
          f"S2 记录级 LWW：更晚的改赢，两端一致（{s2}）")

    s3 = r.get("s3", {})
    check(s3.get("serverAfter") == "A-fresh",
          f"S3 乱序到达不覆盖新值（服务端仍是 {s3.get('serverAfter')}）")
    check(s3.get("a") == "A-fresh", "S3 拉下来后本地也不是旧值")

    s4 = r.get("s4", {})
    check(s4.get("srv") == "offline-5", f"S4 离线 5 次只推最终值（服务端 {s4.get('srv')}）")
    check(s4.get("a") == "offline-5", "S4 另一端拿到的也是最终值，不是中间态")
    check(s4.get("at") == 3050, "S4 保留最后一次的 updatedAt（不是首次的）")

    js("localStorage.clear();location.reload()"); time.sleep(2.4)


@case("C115 合并层的恶意输入：uid 为 __proto__ / 同 uid 重复（原型键不能打穿字典）", tier="feature", owner="00_pure_core 01b3_sync")
def c115_proto_keys():
    """uid 是**外部输入**（服务端响应、别人给的备份 JSON），必须当作不可信处理。

    用普通 `{}` 当字典时，`uid = "__proto__"` 会命中 Object.prototype 那条链：
      · `tombOf["__proto__"]` 永远 !== undefined → 记录被判「已删除」，静默丢弃；
      · `byUid["__proto__"]` 拿到 **Object.prototype 本身** → 被当成一条记录塞进结果；
      · `mergeTombstoneLists` 读 `.deletedAt` 直接 TypeError → 整次同步失败。
    项目里 deepSanitize 早就在防原型污染，合并层不能成为新的缺口。

    另一条：本地若出现两条同 uid（迁移去重前的窄窗口、或导入两份数据），
    合并必须只输出一条 —— 否则**同一个对象引用**在列表里出现两次，
    界面上同一条记录显示两遍，改一处两处都变。
    """
    raw = js("""(function(){
      var out = {};

      /* A 无墓碑：__proto__ 记录要能正常进来，而且不能是 Object.prototype */
      var m1 = mergeRemoteRecords([], [{uid:'__proto__', v:'x', updatedAt:5}], []);
      out.a = { n:m1.list.length, isProto: m1.list[0] === Object.prototype,
                uid: m1.list[0] && m1.list[0].uid };

      /* B 有墓碑：正确判删（不是被字典穿透误判） */
      var m2 = mergeRemoteRecords([], [{uid:'__proto__', v:'x', updatedAt:5}],
                                  [{uid:'__proto__', deletedAt:9}]);
      out.b = { n:m2.list.length, skipped:m2.skipped };

      /* C 墓碑并集：不许抛 */
      out.c = (function(){
        try {
          var r = mergeTombstoneLists([{uid:'__proto__', deletedAt:1}],
                                      [{uid:'a', deletedAt:2}], 2000);
          return { ok:true, n:r.length, uids:r.map(function(x){return x.uid;}).sort().join(',') };
        } catch (e) { return { ok:false, err:String(e && e.message) }; }
      })();

      /* D 本地两条同 uid → 只输出一条 */
      var m3 = mergeRemoteRecords([{uid:'rec_dup', v:1, updatedAt:10},
                                   {uid:'rec_dup', v:2, updatedAt:10}], [], []);
      out.d = { n:m3.list.length, sameRef: m3.list.length>1 && m3.list[0]===m3.list[1] };

      /* E 出队：ack 里给 __proto__ 不许误伤别的条目 */
      appData.outbox = [
        {uid:'__proto__', kind:'record', op:'upsert', at:1},
        {uid:'rec_keep_me', kind:'record', op:'upsert', at:2}
      ];
      outboxAck(['__proto__']);
      out.e = { left: appData.outbox.length,
                stillThere: appData.outbox.some(function(c){return c.uid==='rec_keep_me';}) };
      appData.outbox = [];
      return out;
    })()""")

    r = raw if isinstance(raw, dict) else {}

    a = r.get("a", {})
    check(a.get("n") == 1 and a.get("isProto") is False,
          f"A uid=__proto__ 的记录能正常进列表，且不是 Object.prototype（{a}）")
    b = r.get("b", {})
    check(b.get("n") == 0 and b.get("skipped") == 1,
          f"B 墓碑里的 __proto__ 被正确判删（{b}）")
    c = r.get("c", {})
    check(c.get("ok") is True and c.get("n") == 2,
          f"C 墓碑并集遇 __proto__ 不抛异常（{c}）")
    d = r.get("d", {})
    check(d.get("n") == 1, f"D 本地两条同 uid 合并后只留一条（{d}）")
    e = r.get("e", {})
    check(e.get("stillThere") is True,
          f"E 出队只清 ack 里的那条，别的不受 __proto__ 影响（{e}）")

    js("appData.outbox = []")


# ================= main =================
def _guard_stale():
    """产物陈旧门禁：src/ 比产物新 → 先重建，别拿旧产物跑回归。

    为什么需要：run_smoke 不重建产物（verify.py 的 build 段才重建），
    改了 src/ 直接跑 smoke 会「测的是空气」，报出与代码无关的假失败。
    （产物没重建时，C29 会报「稍后还能继续延」假失败。）
    --no-rebuild 可关掉自动重建，此时陈旧会直接报错退出。
    2026-10-22：产物改为 public/index.html；APP 可能已被换成 http://，所以用 APP_FILE 判。
    """
    html = APP_FILE
    if not html:
        return                                   # 远端/桥模式不判
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isdir(os.path.join(root, "src")) or not os.path.exists(html):
        return                                   # 不是本项目产物，放过
    try:
        if os.path.commonpath([os.path.abspath(html), root]) != root:
            return                               # 包外的自包含产物，没有 src 对照
    except ValueError:
        return
    newest, newest_f = os.path.getmtime(html), html
    for dp, _dn, fn in os.walk(os.path.join(root, "src")):
        for name in fn:
            p = os.path.join(dp, name)
            try:
                t = os.path.getmtime(p)
            except OSError:
                continue
            if t > newest:
                newest, newest_f = t, p
    if newest_f == html:
        return                                   # 产物最新，放行
    rel = os.path.relpath(newest_f, root)
    if "--no-rebuild" in sys.argv:
        print(f"✗ 产物陈旧：{rel} 比 {os.path.relpath(html, root)} 新 —— 先跑 python3 tools/build.py")
        sys.exit(2)
    print(f"⚠️  产物陈旧（{rel} 比 {os.path.relpath(html, root)} 新）→ 自动重建后再测")
    r = subprocess.run([sys.executable, os.path.join(root, "tools", "build.py")],
                       cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        print(r.stdout.decode("utf-8", "replace")[-800:])
        print("✗ 重建失败，中止")
        sys.exit(2)
    print("✓ 产物已重建\n")

def _select_for_argv():
    """按命令行挑用例。三种模式（互斥，优先级 only > affected > tier）：

    --only C32,C37   子串多选（老用法）
    --affected       兜底(core) ∪ 本次改动相关(feature) —— **日常默认动作**
    --tier core      只要兜底层（最快，改一行代码时用）
    都不给           全量（发版/大改前才用；verify.py --e2e 走这条）
    """
    only = _arg("--only")
    if only:
        keys = [k.strip().lower() for k in only.split(",") if k.strip()]
        return [c for c in _cases if any(k in c[0].lower() for k in keys)], "only"
    if _has("--affected"):
        return _select_affected(), "affected"
    if _arg("--tier"):
        want = [t.strip() for t in _arg("--tier").split(",") if t.strip()]
        return [c for c in _cases if c[2] in want], "tier"
    return list(_cases), "all"


def _select_affected():
    """core ∪ 改动相关 feature。改动文件来自 `git diff --name-only HEAD`（可用 --changed 覆盖）。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import affected_cases as AC
    except Exception as e:                                    # 拿不到就退回全量，不静默少跑
        print(f"⚠️  affected_cases 不可用（{e}）→ 退回全量")
        return list(_cases)
    ch = [x for x in (_arg("--changed") or "").split(",") if x.strip()]
    files = ch or AC.changed([])
    meta = [(n, t, o) for n, _f, t, o in _cases]
    names, full, reason = AC.select(files, meta)
    if full:
        print(f"⚠️  {reason} → 全量")
        return list(_cases)
    print(f"   改动文件: {', '.join(files) if files else '(git 无改动)'} → {reason}")
    return [c for c in _cases if c[0] in names]


@case("C116 周挑战「本周单日完成 8 个番茄」：做 1 个不能算完成", tier="feature", owner="01d_engine_features.js")
def c116_weekly_challenge_goal():
    """用户报：「本周单日完成这个 8 个番茄，我今天就完成了一个番茄，然后它就显示我这个
    任务完成了」。

    根因：池里 day8 的 goal 写成 1（本意是「1 天达标」），进度口径却是 ctx.day8 =
    本周**最高单日**番茄数 → 1 >= 1 当场判完成，还顺手发了 2 ⭐。
    守四条：① 存档里的 goal:1 旧条目要就地校正成 8；② 1 个番茄 = 1/8 未完成、不发星；
    ③ 单日真做满 8 个才完成，且重复结算不重复发星；④ 反证 —— 手动把 goal 改回 1，
    同一份数据立刻判完成（证明结论靠的是 goal 而不是别的分支）。"""
    res = json.loads(js(_case_js("c110_weekly_challenge_goal.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C117 正计时记录：区间必须与专注时长自洽", tier="feature", owner="01d_engine_features.js")
def c117_flowtime_record_span():
    """用户报：「我明明专注了 31 分钟，但是它显示 9:40 到 9:49，这不才 10 分钟吗？
    那个日志都是错的」。

    根因：正计时每次暂停→继续都把 startTime 重设成「此刻」，而 effectiveSeconds 是
    累计专注时长，两个数不是同一个量 —— 21:17 开始、中途暂停过的那次专注，落库只剩
    21:40~21:49（8 分钟），日志写 8 分钟、结算说 31 分钟。
    守五条：落库按「结束 − 累计时长」写；幂等；老数据迁移拉正且幂等；
    正常番茄不误伤；日程块不越过记录结束时刻。"""
    res = json.loads(js(_case_js("c111_flowtime_record_span.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C118 习惯『节奏』：按规则打卡 + 今天不用做的收起来 + 弹窗新建/编辑", tier="feature", owner="01eB_ui_habit.js 00_pure_core.js")
def c118_habit_rhythm():
    """需求 2026-10-30：「有的习惯吧，就它就不是天天打卡的」「我这个不是今天需要打卡的…
    它应该支持隐藏这种习惯」「添加习惯跟添加计划一样，点加号弹窗让我选」。
    A 老习惯（无 repeat）逐项不变 / B 规则不命中就收进「今天不用做（N）」且不判断链 /
    C 眼睛层藏了给回执、可放回 / D 弹窗新建编辑（uid/createdAt/growthPoints 不被写坏、
    改规则不动历史打卡）/ E 迁移幂等（无 repeat 的老习惯跑两遍还是原样）。"""
    res = json.loads(js(_case_js("c118_habit_rhythm.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C119 习惯↔目标：关联双向一致（目标里选的习惯，习惯详情看得见）", tier="feature", owner="01eB_ui_habit.js 01eE_ui_lifegoal.js 00b_goal_progress.js")
def c119_habit_goal_link():
    """缺陷 2026-10-30：「在目标里关联了习惯，习惯那里显示没有关联」。
    根因：目标页只写 goal.habitId，习惯详情只读 habit.lifeGoalId，两边互不相干。
    A 目标侧保存 → 两个字段同时落 / B 习惯详情 chips 显示选中 / C 勾选取消不误伤另一个目标 /
    D 删习惯清目标引用 / E 老存档只写一边时领域统计仍认到。"""
    res = json.loads(js(_case_js("c119_habit_goal_link.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C120 习惯：眼睛只是藏卡、统计口径和没打卡一样 + 每周 N 次的配额判定", tier="feature", owner="00_pure_core.js 01eB_ui_habit.js 01b_engine_data.js")
def c120_habit_skip_quota():
    """第二轮升级（对齐 习惯项目调研.md §4①②）：
    ① 跳过日 —— 以前点眼睛只是藏起来、不写历史，「每周一三五」的习惯周三跳过，
       连续数照样断（说了没做到）。现在记 habitSkips，连续数跨过去、分母扣掉。
    ② 每周 N 次 —— 以前 freqPerWeek 只进分母不进判定，详情里「节奏：每天」与
       「每周 3 次」同屏矛盾。现在它进判定：本周打满就不再出现。
    A 跳过 / B 配额 / C 一致性与脏数据 / D 老口径回归。"""
    res = json.loads(js(_case_js("c120_habit_skip_quota.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C121 眼睛收起的退出路径 + 跨入口连续数一致", tier="feature", owner="00_pure_core.js 01eB_ui_habit.js 01b_engine_data.js 01d_engine_features.js")
def c121_habit_skip_exit():
    """2026-10-30 自查修复的回归钉子。六个修复点各一组：
    A 跳过→补卡必须算数 / B 打卡后不给「跳过」入口 / C 列表与成就的连续数同口径 /
    D 无应做日不写「达标 0%」 / E 删习惯清跳过日 / F 跳过期 400 天上限。"""
    res = json.loads(js(_case_js("c121_habit_skip_exit.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C122 月历「‹ ›」翻月翻年：导入绑定只读 → 点了没反应（2026-10-30 回归）", tier="feature", owner="01e_engine_ui.js 01b_engine_data.js")
def c122_calendar_switch():
    """用户报「日程这里点击切换有问题」+ 控制台 Assignment to constant variable。
    calendarYear / calendarMonth 在产物里是 ESM 导入绑定（只读），`calendarYear++` 必抛。
    断言走真点按钮，并覆盖跨年进位/退位、翻年、跳月、12 次取模。"""
    res = json.loads(js(_case_js("c122_calendar_switch.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C124 习惯三件事：计划页 dock / 子计划是纯清单 / 习惯与分类排序", tier="feature", owner="01eB_ui_habit.js 00_pure_core.js 01g_engine_init.js 01b_engine_data.js")
def c124_habit_dock_subs_sort():
    """用户三条诉求（2026-11-04）：
    A 计划页底部默认折叠的「今日习惯」dock —— 一屏看见计划 + 习惯，勾选与习惯页同一份账；
    B 习惯可以拆成「子计划」并排期到某天 —— 子计划不改打卡口径；
    C 习惯手动排序 / 分类排序 —— 分类内拖拽改顺序，拖进别的文件夹就换分类。"""
    res = json.loads(js(_case_js("c124_habit_dock_subs_sort.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C125 习惯自己的排期：长在习惯卡上，日程表里一格都没有（2026-11-04）", tier="feature", owner="01eB_ui_habit.js 01eA_ui_timeblock.js 00_pure_core.js")
def c125_habit_blocks_on_grid():
    """用户两句原话，方向只有一个：「我原先怎么给每个计划排日期你不知道吗？」
    「为什么在日程表上放一堆习惯？」。

    习惯能自己排（h.timeBlocks 规则时段），但入口照抄计划卡 —— 编辑弹窗「排期（几点做）」
    里 .tf-chips 列已排的段 + .add-block-row 两个 type=time 框 + 「＋ 加这一段」。
    ★ 日程表里**一格习惯都不许出现**：没有绿块、没有图例、没有清单条、没有选段模式。
    语义边界：不改 repeat、不动打卡口径、不写 todo.blocks。"""
    res = json.loads(js(_case_js("c125_habit_blocks_on_grid.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C123 回顾「每天最多回顾 N 天」：额度制，回顾完不再补位", tier="feature", owner="01eD_ui_log.js 01e_engine_ui.js")
def c123_review_max_days():
    """需求 2026-11-03：「这个回顾，能不能让用户自己设置最多看多少天的条数」。

    原来待回顾列表一次把 due 全铺完，断更两三周回来铺几十张卡，滚不到底。
    现在上限落盘在 settings.reviewMaxDays（缺省 10，0 = 不限），超出折在「再看 N 天」。
    守六条：缺省 10 / 标题仍报总数 / 逐屏展开且铺完就停 / 设置立刻生效 /
    **只影响显示** —— 被折起的天仍在 dueReviewDates 里，自评与排期照旧 / 落盘与非法值回退。"""
    res = json.loads(js(_case_js("c123_review_max_days.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)


@case("C126 统计「‹ ›」翻年翻月：参数是数字，年份不能被拼成 2026-1-1（2026-11-05）", tier="feature", owner="01e7_ui_stats.js 01d5_engine_stats.js")
def c126_year_shift_no_concat():
    """用户截图：「年度专注统计 2026-1-1-1111-1年」。

    模板按钮写 data-act-args='["-1"]'，委托原样把字符串交给函数，
    而实现是 `_yrY + d` —— 数字 + 字符串 = 拼接，越点越长，yearStats 全 0。
    monStatShift 同病（10 + "-1" → "10-1"）。
    两道防线：模板参数改 JSON 数字；函数内 parseInt 兜底；脏值能自愈回今年。"""
    res = json.loads(js(_case_js("c126_year_shift_no_concat.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C127 习惯子计划是清单：没勾就一直留着，没有到期日（2026-11-06）", tier="feature", owner="00_pure_core.js 01eB_ui_habit.js")
def c127_habit_sub_overdue():
    """用户：「第二天不是我设置了第二天回到未完成吗？但是我第二天怎么不显示呀」。

    带排期的一次性子计划原来只在排期那天出现，第二天即使没做完也直接消失，
    被误认为「次日回到未完成」没生效。现在排期已过且没做完的继续留在列表里（逾期），
    当天或之后勾完才收起。"""
    res = json.loads(js(_case_js("c127_habit_sub_overdue.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C128 日程表某天点＋新建：记计划日期，不加提醒也不排期（2026-11-06）", tier="feature", owner="01eC_ui_todo.js 00_pure_core.js")
def c128_add_on_anchor_date():
    """用户：「我想在周日完成一个任务，我就直接将我的日程表摁那个周日，
    然后我直接点那个加号，就可以排在那一天」。

    原来新建只写 remindAt、blocks 是空数组，todoBlocksOf 见到数组就直接返回 →
    网格画不出块、列表归进「📌 未排期」。现在填了开始时间又没画段时，
    自动生成一段真排期；什么都没填的仍然进「未排期」。"""
    res = json.loads(js(_case_js("c128_add_on_anchor_date.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C129 日程表切换日期：列表跟着切，提示条出现，回到今天能点（2026-11-06）", tier="feature", owner="01eA_ui_timeblock.js 01eC_ui_todo.js")
def c129_switch_date_refresh():
    """用户：「为什么我点击别的那天，它不会显示正在看别天的那个计划？
    非得我添加完一个计划它才显示。然后我点那个回到今天，还点不动」。

    tbPickDate / tbGoToday / tbShiftWeek 原来只重画网格，不重画列表 ——
    列表和「正在看 X 的计划」提示条都停在原处，直到新建一条计划才被动刷新。
    """
    res = json.loads(js(_case_js("c129_switch_date_refresh.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C130 只勾子计划也要进日志「今天完成」（2026-11-06）", tier="feature", owner="01eC_ui_todo.js 01eD_ui_log.js 01e_engine_ui.js")
def c130_sub_partial_log():
    """用户：「我没把整个计划打勾，只完成一个子计划，它应该也记录呀」。
    另外：番茄结算进休息后就勾不了子计划 → 结算弹窗补一张子计划清单，
    补勾的步骤落库时不被「结束时刻截断」误判成没完成。"""
    res = json.loads(js(_case_js("c130_sub_partial_log.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

@case("C131 计划页累计番茄：千分位精确数、不换万、任何量级不裁切（2026-11-07）", tier="feature", owner="01eC_ui_todo.js 00_pure_core.js")
def c131_plan_pomo_total():
    """用户：「计划页最下面放 累计番茄数量 174+8=182，8 是今天；未来可能几千到万，
    不能超过框」。

    第一版按「≥1 万换万单位」做，12338 个番茄时渲染成 `1.23万 + 8 = 1.23万`，
    加号两边相等 —— 用户最在意的"今天涨了多少"反而没了。改成千分位精确显示，
    再按位数降字号（fs-xl…fs-xs），一万级 / 百万级都放得下且不裁切。"""
    res = json.loads(js(_case_js("c131_plan_pomo_total.js")))
    for _r in res:
        name, okv = _r[0], _r[1]
        check(okv, name)

def main():
    global ws, js, JS_ERRORS, PROFILE, PORT, CURRENT_CASE
    _guard_stale()
    sel, mode = _select_for_argv()
    print(f"🍅 番茄专注回归集  |  目标: {APP}\n")
    if VIA_BROWSER:
        print("   传输: 真机浏览器桥（--via browser）\n")
    if not sel:
        print("没有匹配用例（--only 支持子串，如 --only C37，逗号可多选）"); sys.exit(2)
    if mode != "all":
        tag = {"only": "只跑", "affected": "按改动选跑（core ∪ 相关）", "tier": "只跑分层"}[mode]
        print(f"   {tag} {len(sel)}/{len(_cases)} 条: " + ", ".join(c[0].split()[0] for c in sel) + "\n")
    if _has("--list"):                     # 只看选了什么，不起浏览器（用于核对筛选逻辑）
        sys.exit(0)
    # 统一一个浏览器会话顺序执行（每用例自行重置所需状态）
    if VIA_BROWSER:
        ws, js, JS_ERRORS = launch_bridge()
    else:
        ws, js, JS_ERRORS = launch()
    for name, fn, _tier, _owner in sel:
        CURRENT_CASE = name
        # 页面就绪门禁：上一条用例可能刚 reload，新文档还在加载。此时 appData 还是
        # createDefaultAppData() 的初始值，用例改的会被随后的 loadData **整份替换**——
        # 表现成「只有全量跑才偶发红」（C60 就这样红过一次，单跑永远正常）。
        # __bootDone 是主引擎 init 完成 = loadData 已把 appData 装载到位的标志。
        # 最多等 4 秒；等不到就继续（不把工具卡死，真出问题会在用例里暴露）。
        for _ in range(40):
            try:
                if js("!!window.__bootDone") is True:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        # 用例间的结算卫生：上一条如果记录了一个番茄却没等结算窗口自己 flush（测试跑得比
        # 3.5s 的 deadline 快），_settleCollecting 会一直挂着，后续所有 showToast 都被吞进
        # _settleMsgs → 表现成「只有全量跑才红」的顺序泄漏。这里在每条用例开始前收口。
        try:
            js("(function(){try{if(!window._settleCollecting)return 1;"
               "window._settleMsgs=[];"
               "if(typeof flushSettleSummary==='function')flushSettleSummary();"
               "return window._settleCollecting?0:1;}catch(e){return 1;}})()")
            # 备忘身份也归位：模块级 _memSide 会跨用例存活，上一条切到「对面」就带出来了
            js("(function(){try{if(typeof memoSetSide==='function')memoSetSide('me');"
               "return 1;}catch(e){return 1;}})()")
            # 模块级 UI 状态归位（2026-11-09）：_habitOffOpen / _habitEditId 不在 appData 里，
            # 换数据清不掉 → 上一批展开的折叠区让下一批多渲一个 body，表现成「单跑绿、混批红」。
            # 顺手把写盘守卫戳清掉：C100 会把 STAMP 留成"别的窗口"，之后每条用例的
            # saveDataNow() 都被当成过期写盘挡掉（C123 G6 就这么红的）。
            js("(function(){try{if(typeof window.__habitUiReset==='function')window.__habitUiReset();"
               "try{localStorage.removeItem('tomato_focus_v3_stamp');}catch(e2){}"
               "return 1;}catch(e){return 1;}})()")
        except Exception:
            pass
        t0 = time.time()
        before = (PASS, FAIL)
        print(f"▶ {name}")
        try:
            fn()
        except Exception as e:
            check(False, f"用例异常 {e}")
        if os.environ.get("SMOKE_DEBUG_SETTLE"):
            try:
                _st = js("!!window._settleCollecting")
                if str(_st).lower() in ("true", "1"):
                    print(f"   ⚠ 结算未 flush：{name} 结束时 _settleCollecting=true")
            except Exception:
                pass
        print(f"   ({time.time()-t0:.1f}s  +{PASS-before[0]}p)\n")
    # 汇总
    print("=" * 46)
    print(f"JS 运行时异常: {len(JS_ERRORS)}")
    for e in JS_ERRORS[:5]:
        print("   !", e[:140])
    print(f"断言: PASS {PASS}  FAIL {FAIL}")
    _st = getattr(BRIDGE, "st", None)
    if _st is not None and getattr(_st, "rejects", 0):
        print(f"⚠️ 有 {_st.rejects} 次「第二个桥页面」接入被拒 —— 请只保留一个桥页面，"
              f"否则任务会被多页瓜分、结果不可信")
    base = set(_load_baseline().get("failures", []))
    known = [f for f in FAILURES if f in base]
    new = [f for f in FAILURES if f not in base]
    if FAILURES:
        print(f"        已知失败 {len(known)}（与基线一致，不算回归）/ ★新增失败 {len(new)}")
    if new:
        print("\n★ 新增失败（这次改动引入的，必须处理）:")
        for f in new: print("  ✗", f)
    if known:
        print("\n已知遗留失败（历史同批，与本次改动无关）:")
        for f in known: print("  ·", f.split(" :: ", 1)[-1])
    if not FAILURES and base:
        print(f"\n基线里 {len(base)} 条已知失败这次全过了 —— 跑 --update-baseline 收缩基线。")
    if _has("--update-baseline"):
        _save_baseline(FAILURES)
        print(f"\n已写入基线 {BASELINE_PATH}（{len(FAILURES)} 条）")
    if UNVERIFIED:
        print(f"\n未验证 {len(UNVERIFIED)} 项（环境不支持，不下结论）:")
        for u in UNVERIFIED: print("  ⚠️", u)
    try:
        ws.close()
    except Exception:
        pass
    if VIA_BROWSER:
        if BRIDGE is not None:
            BRIDGE.stop()
    else:
        subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], capture_output=True)
    if _has("--update-baseline"):
        sys.exit(0)
    if _has("--new-only"):
        # 快速回归自查用：只关心「有没有被我改坏」，已知遗留失败放行
        sys.exit(1 if new or JS_ERRORS else 0)
    # ★ 未验证项也要反映在退出码上（P2-18）：原来看似"全绿"，其实有 UNVERIFIED
    #   （环境不支持、没下结论的项）被静默吞掉，与 verify.py 的三态承诺不一致。
    sys.exit(1 if (FAIL or JS_ERRORS or UNVERIFIED) else 0)

if __name__ == "__main__":
    main()
