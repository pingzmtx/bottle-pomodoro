# -*- coding: utf-8 -*-
"""P2 renderStats 渲染基线采集器。
用法: python3 rs_capture.py <scene|all> <out_dir> [--dark]

产物路径解析（修复硬编码）：
  优先级 --html 参数 > RS_APP 环境变量 > 项目内 index.html > /workspace/index.html
  历史问题：本工具曾硬编码 file:///workspace/index.html，
  在项目不在 /workspace 的环境下会静默读到不存在/过期产物 —— 属"假绿"隐患。
"""
import json, os, sys, time, subprocess, tempfile, random, urllib.request, websocket, base64

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)


def _resolve_app():
    # 2026-10-22：统一走 _app_path（--html / RS_APP / 默认 public/index.html；
    # 多产物自动转同源 http，否则 file:// 下读不了 cssRules）。
    sys.path.insert(0, _HERE)
    from _app_path import resolve as _r
    return _r()


APP = _resolve_app()

def launch():
    PORT = random.randint(9400, 9800)
    PROFILE = tempfile.mkdtemp(prefix="rsc_")
    proc = subprocess.Popen(
        ["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={PROFILE}", "--window-size=500,1200",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         f"--remote-debugging-port={PORT}", APP],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
    mid = [0]
    def send(m, p=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid[0]:
                return r
    def js(x):
        r = send("Runtime.evaluate", {"expression": x, "returnByValue": True})
        if "exceptionDetails" in r["result"]:
            return "EXC:" + str(r["result"]["exceptionDetails"].get("exception", {}).get("description", ""))[:200]
        return r["result"]["result"].get("value")
    def shot(path):
        r = send("Page.captureScreenshot", {"format": "png"})
        data = (r.get("result") or {}).get("data")
        if data:
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
            return True
        return False

    def shot_el(path, sel):
        """精确截图某元素。
        为什么不用整页滚动：本应用是固定视口 + 内部滚动区，
        `window.scrollY` 恒为 0，`scrollIntoView` 无效 →
        原先的 _heat.png 与整页图逐字节相同（基线形同虚设）。
        改用 CDP clip 依元素 getBoundingClientRect 裁切，稳定且与滚动无关。
        注意：clip 依赖**视口坐标**，元素超出视口时须先把页面滚到它（本项目
        内部滚动容器为 #view-stats 的祖先），故此处用 el.scrollIntoView 后
        重新取 rect —— 对内部滚动容器同样有效。
        """
        js("(function(){var el=document.querySelector(%r); try{ el && el.scrollIntoView({block:'center'}); }catch(e){} return 1;})()" % sel)
        time.sleep(0.35)
        # 目标必须真正进入视口才能被 clip 截到（否则算出负高度 → 跳过/空图）。
        # 本应用为固定视口 + 内部滚动区，scrollIntoView 常无效，
        #   故用 CDP Input.synthesizeScrollGesture 合成滚动手势；
        #   yDistance 为负 = 内容上移（向下滚），故元素在下方时传负值。
        for _ in range(10):
            _need = js("""(function(){
                var el=document.querySelector(%r); if(!el) return null;
                var r=el.getBoundingClientRect(); var vh=window.innerHeight;
                if (r.top >= 0 && r.bottom <= vh) return 0;   // 已完整可见
                return r.top - vh / 2;                        // >0 在下方；<0 在上方
            })()""" % sel)
            if _need is None or _need == 0 or abs(_need) < 10:
                break
            _dy = int(-max(-600, min(600, _need)))
            send("Input.synthesizeScrollGesture", {
                "x": 240, "y": 500, "yDistance": _dy, "speed": 4000,
            })
            time.sleep(0.5)
        time.sleep(0.25)
        # 关键：clip 使用**文档坐标**（= 视口坐标 + scrollY），
        #   而 getBoundingClientRect 返回的是视口坐标。
        #   滚动后若直接用 rect.top 会被当成文档 y → 裁到空白（本批实测踩过）。
        box = js("""(function(){
            var el=document.querySelector(%r);
            if(!el) return null;
            var r=el.getBoundingClientRect();
            return [r.left, r.top + window.scrollY, r.width, r.height];
        })()""" % sel)
        if not box or not isinstance(box, list):
            return False
        l, t, w, h = box
        if w <= 1 or h <= 1:
            return False
        # clip 需落在文档范围内
        _docW = js("document.documentElement.scrollWidth")
        _docH = js("document.documentElement.scrollHeight")
        x0, y0 = max(0, l), max(0, t)
        x1, y1 = min(_docW, l + w), min(_docH, t + h)
        if x1 - x0 <= 1 or y1 - y0 <= 1:
            return False
        r = send("Page.captureScreenshot", {
            "format": "png",
            "clip": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "scale": 1},
        })
        data = (r.get("result") or {}).get("data")
        if data:
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
            return True
        return False

    send("Page.enable")
    send("Runtime.enable")
    return ws, js, shot, proc, shot_el

SCEN = r"""
window.__rsScen = function(s) {
  var now = Date.now(); var dayMs = 86400000;
  function treeSet(o){ var T = appData.tree || {}; for (var k in o) T[k] = o[k]; appData.tree = T; }
  function rankSet(o){ var R = appData.rankSystem || {}; for (var k in o) R[k] = o[k]; appData.rankSystem = R; }
  if (!appData.habits) appData.habits = [];
  if (!appData.habitLogs) appData.habitLogs = {};
  if (!appData.signIn) appData.signIn = {};
  if (!appData.weeklyBadges) appData.weeklyBadges = {};
  if (!appData.immersiveFocus) appData.immersiveFocus = {};
  if (!appData.diaries) appData.diaries = {};
  appData.records = [];
  appData.todos = [];
  if (s === 'empty') {
    treeSet({ points: 0, peakPoints: 0, totalFruitsHarvested: 0, unlockedSpecies: ['tomato'], fruitAlbum: [], dewBadges: 0, waterStreak: 0 });
    rankSet({ stars: 0, history: {}, rankFeedback: [], dailyTask: null });
  } else {
    var R = [];
    var days = s === 'normal' ? 9 : 45;
    for (var d = 0; d < days; d++) {
      var cnt = s === 'heavy' ? (d <= 7 ? 14 : (d % 3 === 0 ? 5 : 2)) : (d === 0 ? 3 : 1);
      for (var k = 0; k < cnt; k++) {
        var dd = new Date(now - d * dayMs);
        var hh = (k * 5 + d) % 24;
        dd.setHours(hh, (k * 11) % 60, 0, 0);
        var isHalf = (d <= 1 && k === 1) || (d > 7 && d % 4 === 0 && k === 0);
        var isInc = d > 7 && d % 5 === 0 && k === 0;
        var sec = isHalf ? 600 : (isInc ? 180 : (d % 6 === 0 ? 3000 : 1500));
        var its = [];
        if (s === 'heavy' && d > 7 && k === 0) its = [{ reason: '电话', startTime: 0, endTime: 60000, duration: 60 }, { reason: '喝水', startTime: 1, endTime: 20000, duration: 20 }];
        R.push({ id: R.length + 1, type: isHalf ? 'half' : (isInc ? 'incomplete' : 'full'), taskName: '任务' + ((d + k) % 3), note: '', startTime: dd.getTime(), endTime: dd.getTime() + sec * 1000, effectiveSeconds: sec, pomos: isHalf ? 0.5 : (isInc ? 0 : 1), difficulty: 'medium', interruptions: its, totalInterruptSeconds: 0, energy: (k + 1) % 5 || 5, mood: (k + 2) % 5 || 5 });
      }
    }
    appData.records = R;
    treeSet({ points: s === 'heavy' ? 2600 : 60, peakPoints: s === 'heavy' ? 2600 : 60, totalFruitsHarvested: s === 'heavy' ? 90 : 3, unlockedSpecies: s === 'heavy' ? ['tomato', 'cherry', 'apple', 'pear', 'peach'] : ['tomato', 'cherry'], fruitAlbum: s === 'heavy' ? Array(12).fill(1) : [], dewBadges: s === 'heavy' ? 8 : 1, waterStreak: s === 'heavy' ? 45 : 5 });
    if (s === 'heavy') { appData.habits = [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }, { id: 'h5' }]; }
    else { appData.habits = [{ id: 'h1' }]; }
    var hl = {};
    for (var hi = 0; hi < appData.habits.length; hi++) { var a2 = []; var lim = s === 'heavy' ? 40 : 12; for (var hd = 0; hd < lim; hd++) { a2.push(getDateStr(new Date(now - hd * dayMs))); } hl['h' + (hi + 1)] = a2; }
    appData.habitLogs = hl;
    appData.signIn = { totalDays: s === 'heavy' ? 300 : 12 };
    if (s === 'heavy') { var cu = {}; for (var bi = 0; bi < 22; bi++) cu['b' + bi] = 1; appData.weeklyBadges = { cumulative: cu }; }
    else { appData.weeklyBadges = { cumulative: { a: 1, b: 1 } }; }
    rankSet({ stars: s === 'heavy' ? 500 : 45, history: { maxStarsCareer: s === 'heavy' ? 1200 : 60 }, rankFeedback: [], dailyTask: null });
    var D = {};
    var nd = s === 'heavy' ? 32 : 3;
    for (var di = 0; di < nd; di++) { D[getDateStr(new Date(now - di * dayMs))] = { feedback: { sleepQuality: (di % 8) + 1, mentalState: (di % 7) + 2 } }; }
    appData.diaries = D;
    appData.immersiveFocus = { unlockedAchievements: s === 'heavy' ? ['adv_space', 'adv_office', 'adv_xianxia', 'adv_detective', 'adv_chase', 'adv_random'] : ['adv_space'] };
  }
  return appData.records.length;
}
1
"""

IDS = ["statsTotal", "statFull", "statHalf", "statFocus", "statInterrupt", "statEnergy", "statPleasure",
       "trendChart", "trendLegend", "heatmapContainer", "moodChart", "moodSummary",
       "weekSpentCount", "weekAvailCount", "achievementList", "yearHeatmapMeta",
       # renderYearHeatmap 年度热力图容器（格子区 + 折叠分析区静态件）
       "yearHeatmapContainer", "yearAnaBody", "yearAnaArrow", "yearHeatHelpArrow",
       # 今日分析懒加载容器
       "todayAnalysisBody",
       # renderStatsExtras 扩展分析区容器
       "statEfficiency", "statAvgDur", "weekCompare", "durChart", "week8Chart", "focusRankBox",
       "qualityChart", "taskChart", "taskSummary", "interruptBox", "rankTrendBox",
       # renderTreeSection 树界面容器
       "treeTitleBadge", "treeCoins", "treeLotteryCount", "treeLotteryBtn", "mysteryTaskList",
       "treeScene", "treePropLayer", "treeSeasonBadge", "treeSeasonHint", "treeSpeciesBar",
       "treeVisual", "treeAuraLayer", "treeDecorLayer", "treeMood", "treeStageName",
       "treeSpeciesName", "treeNameBadge", "treeCompanionToggle", "treeCompanionLabel",
       "treeEternalStars", "treeWaterBtn", "treeDewCount", "treeDailyTasks", "treeProgress",
       "treeProgressFill", "treeDeadActions", "treeFruitDisplay", "treeAlbumGrid",
       "treeAlbumProgress", "treeAlbumFill", "treeAlbumTip", "treeMilestoneList",
       # renderTreeShop 商店 8 区块容器（treeShopModal 内）
       "shopDecoList", "shopSceneList", "shopBalance", "shopWeekBalance", "shopItemList",
       "shopAuraList", "shopWeatherList", "shopPropList", "shopFunList",
       # renderTeamSystem 组队容器（含其收尾调用的 renderTeamHistory）
       "teamStarBadge", "teamContent", "teamHistoryList"]

def capture(js, poster=False):
    snap = {}
    for i in IDS:
        snap[i] = js("(function(){var e=document.getElementById('%s'); return e? e.innerHTML : '<NOEL>';})()" % i)
    snap["_statsInnerText"] = js("(function(){var v=document.getElementById('view-stats'); return v?v.innerText.slice(0,6000):'<NO>';})()")
    if poster:
        # 先补齐 树/商店/组队 渲染（容器 DOM 常驻，display 不影响 innerHTML 写入）
        js("""(function(){ var errs=[]; try{ if(typeof renderTreeSection==='function') renderTreeSection(); }catch(e){errs.push('tree:'+e.message);} try{ if(typeof renderTreeShop==='function') renderTreeShop(); }catch(e){errs.push('shop:'+e.message);} try{ if(typeof renderTeamSystem==='function') renderTeamSystem(); }catch(e){errs.push('team:'+e.message);} try{ if(typeof renderTodayAnalysis==='function') renderTodayAnalysis(); }catch(e){errs.push('today:'+e.message);} return errs.join('|')||'ok'; })()""")
        time.sleep(0.5)
        snap2 = {}
        for i in IDS:
            snap2[i] = js("(function(){var e=document.getElementById('%s'); return e? e.innerHTML : '<NOEL>';})()" % i)
        snap = dict(snap)
        snap.update({("tree_shop_team_" + k): v for k, v in snap2.items()})
        # drawPoster：钉死随机引用（海报每日格言），对每个海报类型 toDataURL 快照
        js("""(function(){ if(window.POSTER_QUOTES && window.POSTER_QUOTES.length>1){ window.POSTER_QUOTES = [window.POSTER_QUOTES[0]]; } if(window._posterType){} return 1; })()""")
        for ptype in ['all', 'seg', 'rank', 'streak', 'today', 'tree', 'bio', 'sprint', 'plan', 'wellness']:
            snap['poster_' + ptype] = js(
                "(function(){ try{ window._posterType = %r; drawPoster(); var c=document.getElementById('posterCanvas'); return c? c.toDataURL('image/jpeg',0.7):'<NOC>'; }catch(e){ return 'EX:'+e.message; } })()" % ptype)
    return snap

def main():
    scenes_arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/rs_shot"
    dark = "--dark" in sys.argv
    os.makedirs(out_dir, exist_ok=True)
    scenes = ["empty", "normal", "heavy"] if scenes_arg == "all" else [scenes_arg]
    for sc in scenes:
        ws, js, shot, proc, shot_el = launch()
        try:
            for _ in range(30):
                if js("!!(window.appData && appData.settings)"):
                    break
                time.sleep(0.5)
            time.sleep(1.6)  # 等异步 loadData 完成，避免覆盖注入
            js(SCEN)
            js("window.__rsScen('%s'); 1" % sc)
            # 旅程放行：按老用户数据关掉渐进解锁，避免树/段位/成就区域被 隐藏
            js("""(function(){ try{ if (window.__jy) { localStorage.removeItem('tomato_journey_v1'); delete appData.journey; window.__jy.ensure(); } } catch(e){} if(window.invalidateStatsCache) invalidateStatsCache(); return 1; })()""")
            time.sleep(0.6)
            js("switchView('stats'); 1")
            time.sleep(0.5)
            rr = js("(function(){ try { renderStats(); return 'ok'; } catch(e){ return 'EX:'+e.message; } })()")
            time.sleep(1.8)  # 等 idle 年热力
            # 关闭旅程**浮层**（公告/介绍卡/遮罩），避免遮挡统计区与动画噪声。
            # 血泪修正：这段隐藏曾把折叠区一起干掉 ——
            #   ① `id.indexOf('jy')===0` 会命中 __jyMore.holder（id 以 jy 开头）；
            #   ② 更隐蔽的是 `cls.indexOf('journey')>=0`，它会命中折叠区**内部**带 journey 类的元素。
            #   而 __jyMore.holder 本身设计上就是 display:none 的中转站（05 文件 1150 行），
            #   待折叠元素在"展开前"正躺在里面 → 被连带隐藏后，jyToggleMore 把它们搬进 body 也仍不可见。
            #   结果：热力图等 15 个分析块永远 0×0，"视觉基线"实为空拍。
            # 修正：显式跳过 __jyMore 的 holder/body 及其任意深度后代（用 contains 双向判定）。
            js("""(function(){
                var M = window.__jyMore || null;
                var protectedRoots = [];
                if (M) { if (M.holder) protectedRoots.push(M.holder); if (M.body) protectedRoots.push(M.body); }
                function isProtected(el){
                    for (var i=0;i<protectedRoots.length;i++){
                        var p = protectedRoots[i];
                        if (p && (p === el || p.contains(el) || (el.contains && el.contains(p)))) return true;
                    }
                    return false;
                }
                var all=document.querySelectorAll('body *');
                for(var i=0;i<all.length;i++){
                    var el=all[i]; var id=el.id||'';
                    var cls=(typeof el.className==='string')?el.className:'';
                    if(id.indexOf('jy')===0||cls.indexOf('jy-')>=0||cls.indexOf('journey')>=0){
                        if(isProtected(el)) continue;
                        if(el.style) el.style.display='none';
                    }
                }
                return 1;
            })()""")
            time.sleep(0.3)
            if dark:
                js("document.body.classList.add('dark-mode'); 1")
                time.sleep(0.3)
                js("switchView('timer'); switchView('stats'); 1")
                time.sleep(0.4)
                rr2 = js("(function(){ try { renderStats(); return 'ok'; } catch(e){ return 'EX:'+e.message; } })()")
                time.sleep(1.8)
                # 同上游修正 —— 保护 __jyMore 折叠区不被误隐藏（详见上方注释）
                js("""(function(){
                    var M = window.__jyMore || null;
                    var protectedRoots = [];
                    if (M) { if (M.holder) protectedRoots.push(M.holder); if (M.body) protectedRoots.push(M.body); }
                    function isProtected(el){
                        for (var i=0;i<protectedRoots.length;i++){
                            var p = protectedRoots[i];
                            if (p && (p === el || p.contains(el) || (el.contains && el.contains(p)))) return true;
                        }
                        return false;
                    }
                    var all=document.querySelectorAll('body *');
                    for(var i=0;i<all.length;i++){
                        var el=all[i]; var id=el.id||'';
                        var cls=(typeof el.className==='string')?el.className:'';
                        if(id.indexOf('jy')===0||cls.indexOf('jy-')>=0||cls.indexOf('journey')>=0){
                            if(isProtected(el)) continue;
                            if(el.style) el.style.display='none';
                        }
                    }
                    return 1;
                })()""")
                time.sleep(0.3)
            # 固定 stars（测试基建：页面的自动结算/加星会随时间漂移，两产物对比须钉死同一输入）
            js("(function(){ try{ if(appData.rankSystem) appData.rankSystem.stars = 47; }catch(e){} if(window.invalidateStatsCache) invalidateStatsCache(); return 1;})()")
            js("switchView('timer'); switchView('stats'); renderStats(); 1")
            time.sleep(0.9)
            snap = capture(js, poster=(not dark))
            tag = sc + ("_dark" if dark else "_light")
            with open(os.path.join(out_dir, tag + ".json"), "w", encoding="utf-8") as f:
                json.dump(snap, f, ensure_ascii=False)
            # 展开统计页折叠区（关键修正）
            # 事实：05_journey_渐进解锁 的 reapFoldByIds() 会把 15 个分析图表块
            #   （heatmapBox / yearHeatmapBox / yearlyStatWrap …）统一收进 __jyMore 折叠区，
            #   因此这些容器默认 0×0 是**产品设计而非缺陷**。
            #   原 rs_capture 只隐藏 jy-* 浮层、从未展开折叠区 →
            #   热力图区块永远不在画面内，历史"热力图基线"实为空拍。
            js("""(function(){
                try{
                    var M = window.__jyMore;
                    if (M && M.opened === false && typeof jyToggleMore === 'function') { jyToggleMore(); }
                }catch(e){}
                return 1;
            })()""")
            time.sleep(1.0)
            # 折叠区展开后，热力格子等重活由 _idleLater(requestIdleCallback, timeout 2000) 调度，
            #   无头下空闲回调可能迟迟不触发 → 截出纯色空图（色数=1，实测过）。
            #   显式同步调用渲染入口，确保内容落盘后再截。
            js("""(function(){
                var errs=[];
                try{ if(typeof renderYearHeatmap==='function') renderYearHeatmap(); }catch(e){errs.push('yh:'+e.message);}
                try{ if(typeof renderStats==='function') renderStats(); }catch(e){errs.push('st:'+e.message);}
                return errs.join('|')||'ok';
            })()""")
            time.sleep(1.2)
            # 关闭数据注入触发的即时弹窗，避免遮挡统计区污染基线
            #   （实测：注入 heavy 数据会触发"系统奖励/段位晋升"礼物弹窗盖住热力图）
            js("""(function(){
                var ids=['giftOverlay','chestOverlay','rankUpModal','finishModal','gachaModal',
                         'immersiveCard','noiseModal','quickPanel','coinExchangeModal','treeShopModal',
                         'posterModal','sharePosterModal','logCalendarModal','countdownModal'];
                for(var i=0;i<ids.length;i++){
                    var el=document.getElementById(ids[i]);
                    if(el){ el.classList.remove('show'); if(el.style) el.style.display='none'; }
                }
                try{ if(typeof closeGift==='function') closeGift(); }catch(e){}
                try{ if(typeof closeChest==='function') closeChest(); }catch(e){}
                return 1;
            })()""")
            time.sleep(0.5)
            # 年热力图区局部截图（改 CDP clip 精确截元素）
            # 历史缺陷：原用 scrollIntoView + sleep，但应用为固定视口 + 内部滚动区，
            #   window.scrollY 恒为 0 → 截出来与整页图逐字节相同，基线形同虚设。
            for _sel, _suf in (("#yearHeatmapBox", "_heat"),
                               ("#view-stats", "_stats")):
                _ok = shot_el(os.path.join(out_dir, tag + _suf + ".png"), _sel)
                if not _ok:
                    print("   [warn] 元素截图跳过:", _sel)
            shot(os.path.join(out_dir, tag + ".png"))  # 整页（视口）
            print("captured:", tag, "| records:", js("appData.records.length"),
                  "| render:", rr, "| statsTotal:", js("document.getElementById('statsTotal').textContent"),
                  "| trend:", len(js("document.getElementById('trendChart').innerHTML")))
        finally:
            ws.close()
            proc.kill()

if __name__ == "__main__":
    main()
