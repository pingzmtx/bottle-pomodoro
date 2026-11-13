# -*- coding: utf-8 -*-
"""复现：补记记录 → 删除记录 → 奖励不回滚 → 可无限刷。

不涉及导入导出，纯 UI 路径：
  补记一条 25 分钟完整🍅（saveAddRecord）会发 抽奖次数（addLotteryChance）
  与 树积分（addTreePoints）；而 deleteRecord 只从 records 里移除该条，
  不回收已发的次数/积分。于是「补记 → 删除」循环即可无限白嫖。

对比组：同一条记录不删除时，奖励只发一次。

用法: python3 tools/repro_addrecord_farm.py [--html path/to/index.html]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)


def _resolve_app():
    sys.path.insert(0, _HERE)
    from _app_path import resolve as _r
    return _r()


APP = _resolve_app()

PROBE = """() => {
  const A = (typeof appData !== 'undefined') ? appData : window.appData;
  /* 次数是派生缓存，读之前先按当前 records 重算，否则读到的是上一次同步的旧值 */
  if (typeof syncLotteryCount === 'function') syncLotteryCount();
  const t = (A && A.tree) || {};
  return { records: (A.records || []).length, points: t.points || 0,
           coins: t.coins || 0, lotteryCount: t.lotteryCount || 0,
           lotteryCarry: t.lotteryCarry || 0 };
}"""

# 补记一条 25 分钟完整番茄（走真实 saveAddRecord，从 DOM 取值）
ADD_ONE = """() => {
  document.getElementById('addRecordDate').value = getTodayStr();
  document.getElementById('addRecordTask').value = '刷分验证';
  document.getElementById('addRecordDuration').value = '25';
  document.getElementById('addRecordType').value = 'full';
  document.getElementById('addRecordHour').value = '09';
  document.getElementById('addRecordMinute').value = '00';
  const plan = document.getElementById('addRecordPlan');
  if (plan) plan.value = '';
  saveAddRecord();
}"""

RESET = """() => {
  appData.records = [];
  appData.tree.coins = 0; appData.tree.points = 0;
  appData.tree.lotteryCount = 0; appData.tree.lotteryCarry = 0;
  appData.tree.lotteryUsed = 0;
  /* 渐进解锁会闸掉 addLotteryChance / addTreePoints（未解锁直接 return）。
     旅程关闭 = 全解锁，这里模拟「已经玩到解锁之后」的正常玩家。 */
  if (!appData.journey) appData.journey = {};
  appData.journey.enabled = false;
  window.rsConfirm = () => Promise.resolve(true);  /* 删除确认直接放行，跑无人值守 */
  saveData();
}"""


def main():
    rounds = 6
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 430, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP)
        page.wait_for_timeout(1600)
        page.evaluate(
            """() => { ['welcomeModal','journeyModal','guideModal'].forEach(id => { try { closeModal(id); } catch (e) {} }); }"""
        )

        # ---- 对照组：补记后不删除 ----
        page.evaluate(RESET)
        page.wait_for_timeout(150)
        keep = []
        for _ in range(rounds):
            page.evaluate(ADD_ONE)
            page.wait_for_timeout(60)
            keep.append(page.evaluate(PROBE))
        after_keep = page.evaluate(PROBE)

        # ---- 实验组：补记后立刻删除 ----
        page.evaluate(RESET)
        page.wait_for_timeout(150)
        farm = []
        for _ in range(rounds):
            page.evaluate(ADD_ONE)
            page.wait_for_timeout(60)
            page.evaluate(
                """() => {
              const id = appData.records[appData.records.length - 1].id;
              deleteRecord(id);   /* rsConfirm 已被 stub 成直接确认 */
            }"""
            )
            page.wait_for_timeout(120)
            farm.append(page.evaluate(PROBE))
        after_farm = page.evaluate(PROBE)

        # ---- 闭环组：白嫖抽奖次数 → 抽成金币（金币不会回滚） ----
        page.evaluate(RESET)
        page.wait_for_timeout(150)
        cashout = []
        for _ in range(rounds):
            # 补记 2 条再删掉 = 白给 1 次抽奖机会（LOT_PER_DRAW = 2）
            for _k in range(2):
                page.evaluate(ADD_ONE)
                page.wait_for_timeout(50)
                page.evaluate(
                    """() => {
                  const id = appData.records[appData.records.length - 1].id;
                  deleteRecord(id);
                }"""
                )
                page.wait_for_timeout(90)
            got = page.evaluate(
                """() => {
              const before = appData.tree.coins || 0;
              const cnt = appData.tree.lotteryCount || 0;
              if (cnt > 0) doTreeLottery();
              saveData();
              return { 抽奖次数: cnt, 抽前金币: before, 抽后金币: appData.tree.coins || 0 };
            }"""
            )
            cashout.append(got)
        after_cash = page.evaluate(PROBE)

        browser.close()

    print(
        json.dumps(
            {
                "rounds": rounds,
                "对照组_补记保留": {
                    "逐步": keep,
                    "终值": after_keep,
                },
                "实验组_补记后删除": {
                    "逐步": farm,
                    "终值": after_farm,
                },
                "闭环组_白嫖次数抽成金币": {
                    "逐步": cashout,
                    "终值": after_cash,
                },
                "结论": (
                    "删除不回滚奖励：记录清零但抽奖次数/树积分留在账上；"
                    "再把白嫖到的次数抽成金币，金币单调净增（不回滚）"
                    if after_farm["records"] == 0
                    and after_farm["lotteryCount"] > 0
                    and after_cash["coins"] > 0
                    else "未复现"
                ),
                "pageErrors": errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
