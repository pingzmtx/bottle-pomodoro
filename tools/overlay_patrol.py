# -*- coding: utf-8 -*-
"""浮层时序巡检：模拟真实操作序列，检查「跨界面浮层残留」。

背景：已修的两个同源 bug ——
  #3  新手引导浮层盖在「习惯」页上（用户以为跳错页）
  #13 全局公告盖在全屏专注上（用户以为全屏没显示）
都是「浮层弹出后未随界面变化收起」。本探针穷举「切界面 + 触发弹窗」的组合，
检查是否有浮层在不该出现时仍可见。

用法: python3 tools/overlay_patrol.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rest_probe as R

# 所有会盖住界面的浮层
OVERLAYS = [
    "firstGuide", "jyAnn", "jyAnn2", "jyCard",
    "immersionMode", "immersiveCardModal", "countdownOverlay",
    "rankUpModal", "finishModal", "careModal", "microBreakModal",
    "addTodoModal", "treeShopModal", "quickPanel", "sharePosterModal",
    "diaryModal", "habitModal", "celebrationLayer", "subRankUp",
]

CHECK = """
(function(){
  var out = {};
  var ids = %s;
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                  parseFloat(cs.opacity || '1') > 0.01 && r.width > 0 && r.height > 0;
    if (visible) out[id] = {display: cs.display, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height)};
  });
  out.__view = (function(){
    var vs = document.querySelectorAll('.view');
    for (var i=0;i<vs.length;i++){ if (getComputedStyle(vs[i]).display !== 'none') return vs[i].id; }
    return '?';
  })();
  return out;
})()
""" % json.dumps(OVERLAYS)


def visible(send, js):
    r = js(CHECK)
    if not isinstance(r, dict):
        return {}, "?"
    view = r.pop("__view", "?")
    return r, view


def main():
    print("=" * 74)
    print("浮层时序巡检：跨界面浮层残留检测")
    print("=" * 74)
    proc, ws, send, js, errs = R.launch(500, 900)

    issues = []

    # 场景 1：启动后立即切换各界面，看有无引导/公告跟着跑
    print("\n【场景 1】启动后切换界面（引导/公告是否跨页残留）")
    for view in ["timer", "plan", "log", "stats", "settings"]:
        js("(function(){try{switchView('%s')}catch(e){}})()" % view)
        time.sleep(0.7)
        ov, cur = visible(send, js)
        # firstGuide 本就属于计时页（讲番茄钟用法），在 timer 上是正确的，不算残留
        noisy = {k: v for k, v in ov.items()
                 if k in ("jyAnn", "jyAnn2", "jyCard")
                 or (k == "firstGuide" and cur != "view-timer")}
        if noisy:
            msg = "切到 %s 后仍有浮层: %s" % (cur, list(noisy.keys()))
            issues.append(msg)
            print("  !! " + msg)
        else:
            print("  ✓ %s 无残留浮层" % cur)

    # 场景 2：开始专注 → 进全屏，各浮层是否让路
    print("\n【场景 2】进入全屏专注后，打断性浮层是否让路")
    js("(function(){try{switchView('timer');startPomodoroCore();}catch(e){}})()")
    time.sleep(0.6)
    js("(function(){try{toggleImmersion()}catch(e){}})()")
    for t in range(4):
        time.sleep(1.0)
        ov, cur = visible(send, js)
        bad = {k: v for k, v in ov.items()
               if k in ("jyAnn", "jyAnn2", "jyCard", "firstGuide", "quickPanel", "careModal")}
        if bad:
            msg = "全屏专注 t=%ds 仍被 %s 盖住" % (t + 1, list(bad.keys()))
            issues.append(msg)
            print("  !! " + msg)
        else:
            print("  ✓ t=%ds 全屏专注干净（当前 %s）" % (t + 1, cur))

    # 场景 3：各弹窗开关幂等（开一次关一次，不留残影）
    print("\n【场景 3】弹窗开关幂等性")
    pairs = [
        ("addTodoModal", "openAddTodoModal()", "closeModal('addTodoModal')"),
        ("treeShopModal", "openTreeShop()", "closeModal('treeShopModal')"),
        ("quickPanel", "toggleQuickPanel()", "closeQuickPanel()"),
    ]
    for oid, openx, closex in pairs:
        js("(function(){try{%s}catch(e){}})()" % openx)
        time.sleep(0.5)
        ov1, _ = visible(send, js)
        js("(function(){try{%s}catch(e){}})()" % closex)
        time.sleep(0.5)
        ov2, _ = visible(send, js)
        left = oid in ov2
        if left:
            msg = "%s 关闭后仍可见" % oid
            issues.append(msg)
            print("  !! " + msg)
        else:
            print("  ✓ %s 开→关正常" % oid)

    print("\n" + "=" * 74)
    print("问题数: %d" % len(issues))
    for m in issues:
        print("  -", m)
    if errs:
        print("\n运行期异常:")
        for e in errs[:10]:
            print("  ", e[:180])
    print("=" * 74)
    ws.close(); proc.terminate()
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
