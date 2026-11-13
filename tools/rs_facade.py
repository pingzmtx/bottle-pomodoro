# -*- coding: utf-8 -*-
"""四门面像素基线补录：商店 / 海报。

背景：已产出 计时器 / 年度热力图 的像素基线，
      但「商店」「海报」两个门面只有 JSON 快照、缺像素图（§十四遗留项）。
本工具补齐这两块，使四门面都有 PNG 基线。

用法:
  python3 tools/rs_facade.py            # 明暗双主题 × 3 场景
  python3 tools/rs_facade.py --light    # 仅浅色
产物: docs/archive/视觉基线/<scene>_<theme>_shop.png / _poster.png
"""
import os, sys, json, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rs_capture as RC


def capture_facades(js, shot, shot_el, out_dir, tag):
    """商店 + 海报 两个门面截图。返回结果摘要。"""
    res = {}

    def _clear_overlays():
        js("""(function(){
            var ec=document.getElementById('jyEnableCard'); if(ec&&ec.parentNode) ec.parentNode.removeChild(ec);
            var ov=document.querySelectorAll('.jy-ov'); for(var j=0;j<ov.length;j++){ if(ov[j]&&ov[j].parentNode) ov[j].parentNode.removeChild(ov[j]); }
            var jc=document.getElementById('jyCard'); if(jc) jc.classList.remove('jy-open');
            var tc=document.getElementById('toastContainer'); if(tc){ tc.innerHTML=''; tc.style.display='none'; }
            return 1; })()""")

    # ---------- 门面 3：商店（World Tree Shop）----------
    # 打开前先渲染，避免空壳；openTreeShop() 内部会 renderTreeShop() + showModal()
    r1 = js("""(function(){
        try{
            if(typeof openTreeShop === 'function'){ openTreeShop(); return 'ok'; }
            if(typeof renderTreeShop === 'function'){ renderTreeShop(); showModal('treeShopModal'); return 'ok-render'; }
            return 'no-fn';
        }catch(e){ return 'EX:'+e.message; }
    })()""")
    time.sleep(1.0)
    _clear_overlays(); time.sleep(0.3)
    # 商店是弹窗：先整页（含遮罩背景），再截弹窗本体
    ok_shop_el = shot_el(os.path.join(out_dir, tag + "_shop.png"), "#treeShopModal")
    res["shop"] = {"open": r1, "modal": ok_shop_el,
                   "tabs": js("document.querySelectorAll('#treeShopModal .shop-tab').length"),
                   "items": js("(document.getElementById('shopItemList')||{}).children ? document.getElementById('shopItemList').children.length : -1")}
    # 关商店，避免遮挡后续
    js("""(function(){ try{ if(typeof closeModal==='function') closeModal('treeShopModal');
        var m=document.getElementById('treeShopModal'); if(m){ m.classList.remove('show'); } }catch(e){} return 1; })()""")
    time.sleep(0.5)

    # ---------- 门面 4：海报（Poster Canvas）----------
    # 钉死随机引用（每日格言），保证基线可复现
    js("""(function(){
        if(window.POSTER_QUOTES && window.POSTER_QUOTES.length>1){ window.POSTER_QUOTES=[window.POSTER_QUOTES[0]]; }
        return 1; })()""")
    ptypes = {}
    for pt in ['all', 'seg', 'rank', 'streak', 'today', 'tree', 'bio', 'sprint', 'plan', 'wellness']:
        ptypes[pt] = js("""(function(){
            try{
                if(typeof setPosterType === 'function'){ setPosterType(%r); }
                else { window._posterType = %r; if(typeof drawPoster==='function') drawPoster(); }
                var c=document.getElementById('posterCanvas');
                return c ? (c.toDataURL('image/jpeg',0.7).length) : -1;
            }catch(e){ return 'EX:'+e.message; }
        })()""" % (pt, pt))
    # 回到默认类型并截图
    js("(function(){ try{ setPosterType('all'); }catch(e){} return 1; })()")
    time.sleep(0.8)
    # 海报在 #sharePosterModal 内（非 posterModal —— 命名易踩坑，实测确认）
    js("""(function(){
        var m=document.getElementById('sharePosterModal');
        if(m){ m.classList.add('show'); if(m.style) m.style.display='flex'; }
        return 1; })()""")
    time.sleep(1.0)
    _clear_overlays(); time.sleep(0.3)
    ok_poster_canvas = shot_el(os.path.join(out_dir, tag + "_poster.png"), "#posterCanvas")
    if not ok_poster_canvas:
        ok_poster_canvas = shot_el(os.path.join(out_dir, tag + "_poster.png"), "#sharePosterModal")
    res["poster"] = {"canvas_types": ptypes, "shot": ok_poster_canvas}
    # 关海报弹窗
    js("""(function(){ var m=document.getElementById('sharePosterModal');
        if(m){ m.classList.remove('show'); if(m.style) m.style.display='none'; } return 1; })()""")
    time.sleep(0.4)
    return res


def main():
    dark = "--dark" in sys.argv
    light_only = "--light" in sys.argv
    dark_only = "--dark" in sys.argv and "--light" not in sys.argv
    out_dir = os.path.join(RC._ROOT, "docs", "archive", "视觉基线")
    os.makedirs(out_dir, exist_ok=True)

    scenes = ["empty", "normal", "heavy"]
    for sc in scenes:
        for dk in ([True] if dark_only else ([False] if light_only else [False, True])):
            tag = sc + ("_dark" if dk else "_light")
            ws, js, shot, proc, shot_el = RC.launch()
            try:
                for _ in range(30):
                    if js("!!(window.appData && appData.settings)"):
                        break
                    time.sleep(0.5)
                time.sleep(1.6)
                js(RC.SCEN)
                js("window.__rsScen('%s'); 1" % sc)
                js("""(function(){ try{ if (window.__jy) { localStorage.removeItem('tomato_journey_v1'); delete appData.journey; window.__jy.ensure(); } } catch(e){} if(window.invalidateStatsCache) invalidateStatsCache(); return 1; })()""")
                time.sleep(0.6)
                # 关掉所有浮层（复用 rs_capture 的思路）
                # 实测踩坑：__jy.ensure() 会异步挂出「成长之旅当前是关闭的」#jyEnableCard
                #   （class=jy-ov），它会**盖住商店与海报**，不清则截图全是这张卡。
                js("""(function(){
                    var ovs=document.querySelectorAll('.jy-open'); for(var k=0;k<ovs.length;k++) ovs[k].classList.remove('jy-open');
                    var jc=document.getElementById('jyCard'); if(jc) jc.classList.remove('jy-open');
                    /* 关键：移除成长之旅开关卡与其遮罩（不是隐藏，是移除，避免残留盖住裁剪） */
                    var ec=document.getElementById('jyEnableCard'); if(ec&&ec.parentNode) ec.parentNode.removeChild(ec);
                    var lk=document.getElementById('jyLock'); if(lk&&lk.parentNode) lk.parentNode.removeChild(lk);
                    var ov2=document.querySelectorAll('.jy-ov'); for(var j=0;j<ov2.length;j++){ if(ov2[j]&&ov2[j].parentNode) ov2[j].parentNode.removeChild(ov2[j]); }
                    var fg=document.getElementById('firstGuide'); if(fg) fg.style.display='none';
                    var tc=document.getElementById('toastContainer'); if(tc){ tc.innerHTML=''; tc.style.display='none'; }
                    try{ if(typeof skipGuide==='function') skipGuide(); }catch(e){}
                    return 1; })()""")
                time.sleep(0.4)
                if dk:
                    js("document.body.classList.add('dark-mode'); 1")
                    time.sleep(0.5)
                # 钉死经济数据（商店可见性/价格与星数相关）
                js("""(function(){ try{
                    appData.tree = appData.tree || {};
                    appData.tree.coins = 880; appData.tree.points = 260; appData.tree.peakPoints = 260;
                    if(appData.rankSystem) appData.rankSystem.stars = 47;
                    if(window.invalidateStatsCache) invalidateStatsCache();
                }catch(e){} return 1; })()""")
                time.sleep(0.4)
                # 预渲染
                js("""(function(){ var e=[];
                    try{ if(typeof renderTreeSection==='function') renderTreeSection(); }catch(x){e.push('tree');}
                    try{ if(typeof renderStats==='function') renderStats(); }catch(x){e.push('stats');}
                    return e.join('|')||'ok'; })()""")
                time.sleep(1.0)
                switch = ("" if dk else "switchView('timer'); switchView('stats');")
                js(switch + "1")
                time.sleep(0.6)
                if not dk:
                    js("(function(){ try{ renderStats(); }catch(e){} return 1; })()")
                    time.sleep(1.0)
                r = capture_facades(js, shot, shot_el, out_dir, tag)
                print("captured:", tag, "|", json.dumps(r, ensure_ascii=False)[:300])
            finally:
                ws.close()
                proc.kill()


if __name__ == "__main__":
    main()
