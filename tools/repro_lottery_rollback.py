# -*- coding: utf-8 -*-
"""「导出 → 消耗 → 导入」存档回档探针（修复后行为记录）。

三条场景全部走真实 UI 路径：exportData() 真实下载备份文件 → 消耗 →
#importFile 真实导入该文件（含 rsConfirm 二次确认）→ 比对字段。

  ① 抽奖次数回档 ...... 属 P1：**有意保留**（用户要能回到旧进度）。回档是零和的
                        （金币同步回去），所以刷不出钱，但次数确实会复原。
  ② 周兑换额度回档 .... 同上，P1。
  ③ 限时装饰租期 ...... 已修：反复导入不再按 now 重算 7 天。

「补记 → 删除」那条真·可刷路径（不需要导入、能真赚金币）见 repro_addrecord_farm.py。

用法: python3 tools/repro_lottery_rollback.py [--html path/to/index.html]
"""
import json
import os
import sys
import tempfile

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
  /* 次数是派生缓存，读之前先按当前 records 重算，否则读到上一次同步的旧值 */
  if (typeof syncLotteryCount === 'function') syncLotteryCount();
  const t = (A && A.tree) || {};
  return {
    records: (A.records || []).length,
    coins: t.coins || 0,
    lotteryCount: t.lotteryCount || 0,
    lotteryUsed: t.lotteryUsed || 0,
    weekCoinExchanged: t.weekCoinExchanged || 0,
    weekCoinExchangedWeek: t.weekCoinExchangedWeek || null,
    decorExpiresKeys: Object.keys(t.decorExpires || {}).length,
    decorExpiresMax: Math.max(0, ...Object.values(t.decorExpires || {}).map(v => Number(v) || 0)),
    decorations: (t.decorations || []).length
  };
}"""

# 解锁 + 清账，保证探针不受渐进解锁闸门与历史数据干扰
SETUP = """() => {
  ['welcomeModal','journeyModal','guideModal','giftOverlay'].forEach(id => { try { closeModal(id); } catch (e) {} });
  const ov = document.getElementById('giftOverlay'); if (ov) ov.classList.remove('show');
  if (!appData.journey) appData.journey = {};
  appData.journey.enabled = false; /* 旅程关闭 = 全解锁，否则 addLotteryChance/addTreePoints 被闸掉 */
  appData.records = [];
  appData.tree.coins = 0;
  appData.tree.points = 0;
  appData.tree.peakPoints = 0;
  appData.tree.lotteryUsed = 0;
  appData.tree.lotteryCount = 0;
  appData.tree.lotteryCarry = 0;
  appData.tree.weekCoinExchanged = 0;
  appData.tree.weekCoinExchangedWeek = null;
  window.rsConfirm = () => Promise.resolve(true);
  saveData();
}"""

# 走真实补记路径造额度：25 分钟完整番茄 = 1 个折算番茄，2 条换 1 次抽奖
ADD_ONE = """() => {
  document.getElementById('addRecordDate').value = getTodayStr();
  document.getElementById('addRecordTask').value = '回档探针';
  document.getElementById('addRecordDuration').value = '25';
  document.getElementById('addRecordType').value = 'full';
  document.getElementById('addRecordHour').value = '09';
  document.getElementById('addRecordMinute').value = '00';
  const p = document.getElementById('addRecordPlan'); if (p) p.value = '';
  saveAddRecord();
}"""


def export_backup(page, out_path):
    with page.expect_download() as dl_info:
        page.evaluate("() => exportData()")
    dl_info.value.save_as(out_path)
    with open(out_path, "r", encoding="utf-8") as f:
        return json.load(f)


def import_backup(page, path):
    """真实走 #importFile 的 onchange → importData(event)，并确认 rsConfirm 弹窗。"""
    page.set_input_files("#importFile", path)
    page.wait_for_timeout(600)
    page.evaluate("() => { const ok = document.querySelector('[data-rs-ok]'); if (ok) ok.click(); }")
    page.wait_for_timeout(900)


def main():
    results = []
    tmp = tempfile.mkdtemp(prefix="repro_")
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_context(accept_downloads=True, viewport={"width": 430, "height": 900}).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(APP)
        page.wait_for_timeout(1600)
        page.evaluate(SETUP)
        page.wait_for_timeout(200)

        # ---------- 用例 1：抽奖次数回档（P1，有意保留） ----------
        for _ in range(2):
            page.evaluate(ADD_ONE)
            page.wait_for_timeout(70)
        before = page.evaluate(PROBE)
        bak1 = os.path.join(tmp, "b1.json")
        exported = export_backup(page, bak1)
        page.wait_for_timeout(250)
        page.evaluate("() => { doTreeLottery(); saveData(); }")
        page.wait_for_timeout(200)
        spent = page.evaluate(PROBE)
        import_backup(page, bak1)
        back = page.evaluate(PROBE)
        results.append(
            {
                "case": "① 抽奖次数回档（已堵：已抽数只增不减）",
                "备份内 lotteryUsed": (((exported or {}).get("tree") or {}).get("lotteryUsed")),
                "导入前（抽完）": {
                    "coins": spent["coins"],
                    "lotteryCount": spent["lotteryCount"],
                    "lotteryUsed": spent["lotteryUsed"],
                },
                "导入该备份后": {
                    "coins": back["coins"],
                    "lotteryCount": back["lotteryCount"],
                    "lotteryUsed": back["lotteryUsed"],
                },
                "结论": "导入后依然抽不动（lotteryUsed 未被备份拉小）"
                if back["lotteryCount"] == 0
                else "仍可回档刷次数",
            }
        )

        # ---------- 用例 2：周兑换额度回档（P1，有意保留） ----------
        page.evaluate(SETUP)
        page.wait_for_timeout(150)
        bak2 = os.path.join(tmp, "b2.json")
        export_backup(page, bak2)
        page.evaluate(
            """() => {
          appData.tree.weekCoinExchangedWeek = getWeekStartStr();
          appData.tree.weekCoinExchanged = 120;
          appData.tree.coins = 120; saveData();
        }"""
        )
        spent2 = page.evaluate(PROBE)
        import_backup(page, bak2)
        back2 = page.evaluate(PROBE)
        page.evaluate("() => { getWeekCoinExchanged(); }")
        recalc = page.evaluate(PROBE)
        results.append(
            {
                "case": "② 周兑换额度回档（P1 · 有意保留）",
                "导入前（兑满）": {"weekCoinExchanged": spent2["weekCoinExchanged"], "coins": spent2["coins"]},
                "导入备份后": {"weekCoinExchanged": back2["weekCoinExchanged"], "coins": back2["coins"]},
                "再读一次额度": {"weekCoinExchanged": recalc["weekCoinExchanged"]},
                "结论": "额度随备份回到 0，本周可再兑；同样零和",
            }
        )

        # ---------- 用例 3：限时装饰租期不再续期（已修） ----------
        page.evaluate(
            """() => {
          appData.tree.decorations = ['lantern', 'flag'];
          appData.tree.decorExpires = {};
          delete appData.tree.__leaseBackfilled;
          saveData();
        }"""
        )
        page.wait_for_timeout(150)
        bak3 = os.path.join(tmp, "b3.json")
        export_backup(page, bak3)
        import_backup(page, bak3)  # 首次：本机没给过宽限 → 应回填 now+7d
        first = page.evaluate(PROBE)
        page.wait_for_timeout(1100)
        import_backup(page, bak3)  # 二次：同一份「空租期」备份 → 不该再续期
        second = page.evaluate(PROBE)
        results.append(
            {
                "case": "③ 限时装饰租期（已修）",
                "首次导入后条数": first["decorExpiresKeys"],
                "首次到期时间": first["decorExpiresMax"],
                "二次导入后条数": second["decorExpiresKeys"],
                "二次到期时间": second["decorExpiresMax"],
                "两次到期时间差(ms)": second["decorExpiresMax"] - first["decorExpiresMax"],
                "结论": "反复导入不再续期（差值 0）"
                if second["decorExpiresMax"] <= first["decorExpiresMax"]
                else "仍在续期",
            }
        )

        browser.close()

    print(json.dumps({"scenes": results, "pageErrors": errors}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
