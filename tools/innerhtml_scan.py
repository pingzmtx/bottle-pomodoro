# -*- coding: utf-8 -*-
"""innerHTML 注入扫描清单（纯静态 · v2 多行追踪版）。

目标：在不改动任何行为的前提下，产出一份**可复核**的清单，回答三个问题：
  ① 全仓有多少处 innerHTML / insertAdjacentHTML / outerHTML / document.write？
  ② 其中哪些在模板串里做了 `${...}` / `+ expr +` 拼接（即"动态注入"）？
  ③ 这些拼接里，哪些表达式的**数据来源**可追溯到用户输入
     （taskName / note / diary / 自定义名称 …），且**没有**经过 esc/escapeHtml？

v2 强化（缘起：H1/剧本 3 处真实注入 v1 全漏）：
  A. 多行构建追踪：`let h='...'; h += 用户源; el.innerHTML = h` 模式，
     v1 行级扫描完全不可见（267 注入点只认出 13 动态，漏检≈95%）。
  B. 用户源词表补全：name/reason/text/icon/snippet（v1 缺，剧本 t.k/ch.title/ev.text 因此漏报）。
  C. 转义判定收紧：v1「同行出现 escapeHtml( 整行豁免」过宽；
     v2 逐表达式判定（表达式被转义函数包裹才算），同行豁免仅作降级依据。
  D. audit 死代码复活：新增未登记的高危点 = 真 FAIL（此前 errors 恒空、--audit 永不失败）。

判定策略（宁漏勿误，避免变成没人看的噪音）：
  - 动态拼接：模板串含 ${ 或 "+ 变量 +" 形态
  - 用户源：拼进去的裸表达式中，变量名匹配用户可控正则
  - 已转义：表达式外层包裹 escapeHtml( / esc( / _esc( / encodeURIComponent(
  - 输出分级：高（用户源且未转义）/ 中（含 .map( 生成 HTML 片段 或 同行有转义）/ 低（其余动态拼接）

用法: python3 tools/innerhtml_scan.py [--json out.json] [--audit] [--write-baseline]
"""
import os, re, sys, json

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SRC = os.path.join(_ROOT, "src", "scripts")

# 注入型 API
API_RE = re.compile(r"\.(innerHTML|outerHTML)\s*(\+?=)|insertAdjacentHTML\s*\(|document\.write\s*\(")

# 用户可控数据源变量名（保守：命中才提请复核，不代表一定可利用）
# v2 增补：name/reason/text/icon/snippet（剧本/礼物/标签等真实漏报来源）
USER_SRC = re.compile(
    r"\b(taskName|taskText|todoText|todo\.text|t\.text|note|diary|diaryText|"
    r"habitName|goalName|planName|roomName|sceneName|customName|userName|nickName|"
    r"title|keyword|searchKey|inputValue|rawText|content|desc|remark|feedback|"
    r"name|reason|text|icon|snippet)\b"
)

# 转义函数
ESC = re.compile(r"\b(escapeHtml|esc|_esc|escName|encodeURIComponent|String\.raw)\s*\(")

# innerHTML = 单一变量 右侧捕获（多行追踪入口）
ASSIGN_VAR_RE = re.compile(r"\.(?:innerHTML|outerHTML)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$")
# 构建变量初始化：let/const/var X = '...' / `...`（RHS 含 HTML 特征才标记）
VAR_INIT_RE = re.compile(r"^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['\"`].*)$")
# 构建变量累加：X += ...
VAR_APPEND_RE = re.compile(r"^\s*([A-Za-z_$][\w$]*)\s*\+=\s*(.+)$")
# HTML 特征（判定某变量是否"HTML 构建变量"）
HTML_FEAT = re.compile(r"<\s*(div|span|section|p|b|i|em|strong|button|input|textarea|select|img|table|tr|td|ul|li|h[1-6])\b|class=|style=|id=")


def _extract_exprs(line):
    """从一行里提取注入表达式（${...} / +expr+ / '+expr 形态）。"""
    exprs = re.findall(r"\$\{([^}]*)\}", line)
    exprs += re.findall(r"\+\s*([A-Za-z_$][\w$.\[\]'\"()]*)\s*\+", line)
    exprs += re.findall(r"['\"`]\s*\+\s*([A-Za-z_$][\w$.\[\]'\"()]*)", line)
    return exprs


def _is_dynamic(line):
    return ("${" in line) or re.search(r"\+\s*[A-Za-z_$][\w$.\[\]'\"()]*\s*\+", line) \
        or re.search(r"['\"`]\s*\+\s*[A-Za-z_$][\w$.]*", line)


def _classify_exprs(exprs, context_line):
    """逐表达式判定：(hit_user未转义[], hit_escaped[])。
    v2：表达式自身被 ESC 包裹才算转义；context_line 仅供调用方做降级参考。"""
    hit_user, hit_esc = [], []
    for e in exprs:
        e = e.strip()
        if not e:
            continue
        if ESC.search(e):
            hit_esc.append(e)
            continue
        if USER_SRC.search(e):
            hit_user.append(e)
    return hit_user, hit_esc


def scan():
    findings = []
    stats = {"files": 0, "api_sites": 0, "dynamic": 0, "user_src": 0, "escaped": 0, "multiline": 0}
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".js"):
            continue
        path = os.path.join(SRC, fn)
        with open(path, encoding="utf-8") as f:
            lines = f.read().split("\n")
        stats["files"] += 1

        # ── 第〇遍：函数边界切段（v2.1：作用域隔离）──
        # 不同函数里的同名局部变量（如 showGift/openGift 都叫 html）必须隔离追踪，
        # 否则 A 函数的未转义拼接行会误挂到 B 函数的 innerHTML 赋值上（实测 3032/1313 误报）。
        # 近似规则：缩进 ≤2 的 function 声明为段边界（顶层 + IIFE 内层）。
        FUNC_RE = re.compile(r"^\s{0,2}(?:async\s+)?function\s+[A-Za-z_$]")
        bounds = [i for i, line in enumerate(lines, 1) if FUNC_RE.match(line)]

        def _seg_of(ln):
            seg = 0
            for b in bounds:
                if b <= ln:
                    seg = b
                else:
                    break
            return seg

        # ── 第一遍：识别 HTML 构建变量（多行追踪的数据基础）──
        # builders[(seg, var)] = init行号；append_lines[(seg, var)] = [拼接行...]
        builders = {}
        append_lines = {}
        for i, line in enumerate(lines, 1):
            m = VAR_INIT_RE.match(line)
            if m and HTML_FEAT.search(m.group(2)):
                builders[(_seg_of(i), m.group(1))] = i
            m2 = VAR_APPEND_RE.match(line)
            if m2 and (_seg_of(i), m2.group(1)) in builders:
                append_lines.setdefault((_seg_of(i), m2.group(1)), []).append((i, line))

        # ── 第二遍：注入 API 行 ──
        for ln, line in enumerate(lines, 1):
            if not API_RE.search(line):
                continue
            stats["api_sites"] += 1

            # (a) 多行路径：innerHTML = 构建变量（同函数段内回溯，v2.1 作用域隔离）
            mv = ASSIGN_VAR_RE.search(line.strip())
            _key = (_seg_of(ln), mv.group(1)) if mv else None
            if mv and _key in builders:
                var = mv.group(1)
                seg_lines = [(builders[_key], lines[builders[_key] - 1])] + append_lines.get(_key, [])
                all_exprs, seg_user, seg_esc = [], [], []
                for _ln, _tx in seg_lines:
                    ex = _extract_exprs(_tx)
                    all_exprs.extend(ex)
                    u, s = _classify_exprs(ex, _tx)
                    seg_user.extend(u)
                    seg_esc.extend(s)
                stats["multiline"] += 1
                if all_exprs:
                    stats["dynamic"] += 1
                if seg_esc:
                    stats["escaped"] += 1
                if seg_user:
                    stats["user_src"] += 1
                    findings.append({
                        "file": fn, "line": ln, "level": "高",
                        "exprs": seg_user[:6],
                        "code": line.strip()[:120] + "  ⟵多行构建变量 " + var,
                        "via": "multiline",
                    })
                elif all_exprs:
                    findings.append({
                        "file": fn, "line": ln, "level": "低",
                        "exprs": all_exprs[:4],
                        "code": line.strip()[:120] + "  ⟵多行构建变量 " + var,
                        "via": "multiline",
                    })
                continue

            # (b) 行级路径（v1 原逻辑，转义判定收紧为逐表达式）
            if not _is_dynamic(line):
                continue
            stats["dynamic"] += 1
            exprs = _extract_exprs(line)
            hit_user, hit_esc = _classify_exprs(exprs, line)
            if hit_esc:
                stats["escaped"] += 1
            if hit_user:
                stats["user_src"] += 1
                findings.append({
                    "file": fn, "line": ln, "level": "高",
                    "exprs": hit_user,
                    "code": line.strip()[:180],
                    "via": "line",
                })
            else:
                findings.append({
                    "file": fn, "line": ln, "level": "低",
                    "exprs": exprs[:4],
                    "code": line.strip()[:180],
                    "via": "line",
                })
    return stats, findings


def audit():
    """供 build.py --lint 调用的审计入口。

    返回 (errors, warnings, report)。
    ——为什么不是"高=错误"：
      本项目的「高」全部来自**启发式关键词匹配**（如 title.icon/name），
      实测（01e5:1509 getTreeTitle 返回的是硬编码常量 TREE_TITLES）为误报。
      直接拿启发式当门禁 = 必然制造噪音 → lint 会被绕过。
      故门禁只认**可证明**的两条硬规则：
        ① 用户输入值直接进入 innerHTML 且**无任何转义**（逃逸链完整可追）
        ② 新增的注入点未登记在基线（INNERHTML_BASELINE），强制人工确认
      其余一律降为告警，明细可查。

    v2 变更：硬规则②从 warnings 升级为 errors（真 FAIL）——
      v1 的 errors 列表恒为空、--audit 永不失败（死代码），等于没有门禁。
    v2.1 基线粒度升级：文件级 → (文件 + 表达式签名) 级——
      v1 整文件入基线即永久豁免（01e5 先例：新真问题也会被放过）。
      签名 = (file, 排序后的表达式集合)，不含行号（行号随编辑漂移）。
      命中点签名在基线内 → 豁免；新签名 → errors（阻断 lint）。
      消除方式：修复转义后重跑，或人工复核无误后 --write-baseline 登记。
    """
    stats, findings = scan()
    errors, warnings = [], []

    baseline = _load_baseline()
    # 基线两代判定：v2（含 signatures）只认签名；v1（仅 files）走文件级兼容
    base_sigs = set(tuple(s) for s in baseline.get("signatures", []))
    is_v2 = "signatures" in baseline
    base_files = set(baseline.get("files", [])) if not is_v2 else set()

    def _sig(f):
        return (f["file"],) + tuple(sorted({e.strip() for e in f["exprs"]}))

    highs = [f for f in findings if f["level"] == "高"]
    for f in highs[:10]:
        msg = (f"{f['file']}:{f['line']} 疑似未转义用户源注入"
               f"（{f.get('via', 'line')}）：{', '.join(f['exprs'][:2])}")
        if _sig(f) in base_sigs:
            continue  # 签名级豁免（已人工复核登记）
        if not is_v2 and f["file"] in base_files:
            warnings.append(msg + "（v1 文件级基线豁免，建议 --write-baseline 升级签名级）")
        else:
            errors.append(msg + "（未登记基线：修复转义或复核后 --write-baseline）")

    report = {
        "api_sites": stats["api_sites"],
        "dynamic": stats["dynamic"],
        "escaped": stats["escaped"],
        "user_src": stats["user_src"],
        "multiline": stats.get("multiline", 0),
        "high": len(highs),
        "low": len([f for f in findings if f["level"] == "低"]),
    }
    return errors, warnings, report


BASELINE_PATH = os.path.join(_ROOT, "src", "innerhtml_baseline.json")


def _load_baseline():
    if os.path.exists(BASELINE_PATH):
        try:
            with open(BASELINE_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def write_baseline():
    """把当前「高」清单固化为签名级基线（需人工复核后再执行）。
    v2.1：签名 = (file, 排序表达式集合)，不含行号——行号漂移不再触发误报，
    且不再整文件豁免（新真问题在已登记文件里也会被拦）。"""
    stats, findings = scan()
    highs = [f for f in findings if f["level"] == "高"]
    sigs = sorted({(f["file"],) + tuple(sorted({e.strip() for e in f["exprs"]})) for f in highs})
    data = {
        "_note": "innerHTML 注入基线 v2：签名级（file+表达式集合）。勿手改，用 --write-baseline 重建。",
        "files": sorted({f["file"] for f in highs}),
        "signatures": [list(s) for s in sigs],
        "detail": [{"file": f["file"], "line": f["line"], "exprs": f["exprs"]}
                   for f in highs],
    }
    with open(BASELINE_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"已写出基线：{BASELINE_PATH}（{len(data['files'])} 个文件 / {len(sigs)} 个签名）")


def main():
    if "--write-baseline" in sys.argv:
        write_baseline()
        return 0
    if "--audit" in sys.argv:
        errs, warns, rep = audit()
        print(f"注入扫描：注入点 {rep['api_sites']} / 动态 {rep['dynamic']}"
              f"（多行 {rep.get('multiline', 0)}）/ 高 {rep['high']} / 低 {rep['low']}")
        for w in warns:
            print("⚠", w)
        for e in errs:
            print("✗", e)
        return 1 if errs else 0

    stats, findings = scan()
    high = [f for f in findings if f["level"] == "高"]
    low = [f for f in findings if f["level"] == "低"]
    # 同一行既有用户源又有转义 → 降级为"中"
    for f in list(high):
        if ESC.search(f["code"]):
            f["level"] = "中"
    high = [f for f in findings if f["level"] == "高"]
    mid = [f for f in findings if f["level"] == "中"]

    print("=" * 62)
    print("innerHTML 注入扫描清单（v2 多行追踪版）")
    print("=" * 62)
    print(f"扫描文件      : {stats['files']}")
    print(f"注入型 API 点 : {stats['api_sites']}")
    print(f"  动态拼接    : {stats['dynamic']}（其中多行构建 {stats.get('multiline', 0)}）")
    print(f"  含转义      : {stats['escaped']}")
    print(f"  命中用户源  : {stats['user_src']}")
    print()
    print(f"【高】用户源 + 未转义 : {len(high)} 处")
    print(f"【中】用户源 + 同行有转义 : {len(mid)} 处")
    print(f"【低】其他动态拼接 : {len(low)} 处")
    print()
    if high:
        print("── 需人工复核（高）──")
        for f in high[:40]:
            print(f"  {f['file']}:{f['line']}  ← {', '.join(f['exprs'][:3])}")
            print(f"      {f['code'][:150]}")
    else:
        print("✅ 未发现「用户源 + 未转义」的直接注入点。")

    if "--json" in sys.argv:
        i = sys.argv.index("--json")
        out = sys.argv[i + 1] if i + 1 < len(sys.argv) else "/tmp/innerhtml.json"
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"stats": stats, "high": high, "mid": mid, "low": low},
                      fh, ensure_ascii=False, indent=1)
        print(f"\nJSON: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
