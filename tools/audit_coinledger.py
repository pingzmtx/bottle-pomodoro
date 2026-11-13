# -*- coding: utf-8 -*-
"""
· 金币账本（余额 + 流水）全链路审计
==================================================================
为什么存在这个工具（而不是并进 verify.py）：
  它要起无头浏览器、走真实点击路径，约 40 秒，与 tools/audit_timeblock.py /
  verify_csv_export.py 同定位：**改动金币链路（01d3 的 coinEarn/coinSpend/coinUndo、
  01e5 的明细面板、以及任何发放金币的调用点）后手动跑**，不占日常提交链。
  静态那半（余额只许经入口变动、流水类型必须登记）已由
  tools/check_coin_single_source.py 挂在 verify.py 里，本工具补「运行期才看得见」的那半。

测什么：
  L 段（账本语义）：期初结转 / 空账本不写结转 / 入账 / 出账 / 余额不足不记账 /
    撤销（收入回退、支出退回）/ 重复撤销被拒 / 期初结转不可撤 /
    已花掉的收入撤不回 / 超上限压实成结转条且账目仍平 / 对账 diff ≡ 0
  U 段（UI 与真实路径）：明细面板可开、行数与账本一致、撤销按钮点了真生效、
    面板上「对账修正」只在真的对不上时出现、系统奖励弹窗（showGift）入账类型正确

用法：python3 tools/audit_coinledger.py        （file:// 直开，不建 HTTP 服务）
出口：全部 ✓ = 通过（退出码 0）；任何 ✗ 进末尾汇总（退出码 1）。
==================================================================
"""

import json
import sys

from playwright.sync_api import sync_playwright

# 路径不再硬编码（P1-8）：--html > SMOKE_APP/APP/RS_APP > 项目内 index.html。
# 原来的写死路径换个目录就读到不存在的文件（或更糟：旧产物），而审计照样"通过"。
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _app_path import resolve as _resolve_app
APP = _resolve_app()
RESULTS = []


def ok(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('✓' if cond else '✗') + ' ' + name + (('  → ' + str(detail)) if (detail and not cond) else ''))


def boot(page):
    """干净启动：清掉账本与余额，但保留其它默认数据。"""
    page.add_init_script("window.__remindWatchPaused = true")
    page.goto(APP)
    page.wait_for_function("typeof appData !== 'undefined' && typeof coinEarn === 'function'", timeout=20000)
    page.wait_for_timeout(600)
    page.evaluate("""(() => {
      appData.tree.coins = 0;
      appData.tree.coinLog = [];
      saveData();
    })()""")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 430, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        boot(pg)

        # ============ L1 期初结转 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = 300; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          const log = coinLedgerInit();
          return { n: log.length, type: log[0] && log[0].type, amt: log[0] && log[0].amount,
                   after: log[0] && log[0].after, chk: coinLedgerCheck() };
        })()""")
        ok('L1-① 老存档（有余额无流水）→ 补一笔期初结转', r['n'] == 1 and r['type'] == 'opening', r)
        ok('L1-② 期初结转金额 = 当时余额、running balance 对', r['amt'] == 300 and r['after'] == 300, r)
        ok('L1-③ 结转后账目平（diff=0）', r['chk']['diff'] == 0, r['chk'])

        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          const log = coinLedgerInit();
          return { n: log.length, chk: coinLedgerCheck() };
        })()""")
        ok('L1-④ 余额 0 且无流水 → 不写结转条（Σ=0=余额）', r['n'] == 0 and r['chk']['diff'] == 0, r)

        # ============ L2 入账 / 出账 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          const t = coinEarn(120, 'duration', '专注 86 分钟时长奖励', { recordId: 42 });
          return { tx: t, coins: appData.tree.coins, chk: coinLedgerCheck() };
        })()""")
        ok('L2-① coinEarn 记账：amount/after/meta 齐、余额 +120',
           r['tx']['amount'] == 120 and r['tx']['after'] == 120 and r['tx']['meta']['recordId'] == 42
           and r['coins'] == 120, r)
        ok('L2-② 入账后账目平', r['chk']['diff'] == 0, r['chk'])

        r = pg.evaluate("""(() => {
          const t = coinSpend(50, 'shop', '装饰：「小夜灯」7 天');
          return { ok: t, coins: appData.tree.coins, last: appData.tree.coinLog.slice(-1)[0],
                   chk: coinLedgerCheck() };
        })()""")
        ok('L2-③ coinSpend 记账：支出记负额、余额 -50',
           r['ok'] is True and r['coins'] == 70 and r['last']['amount'] == -50 and r['last']['after'] == 70, r)
        ok('L2-④ 出账后账目平', r['chk']['diff'] == 0, r['chk'])

        r = pg.evaluate("""(() => {
          const n0 = appData.tree.coinLog.length;
          const bad = coinSpend(99999, 'shop', '买不起的东西');
          return { bad: bad, coins: appData.tree.coins, logGrew: appData.tree.coinLog.length - n0,
                   chk: coinLedgerCheck() };
        })()""")
        ok('L2-⑤ 余额不足：返回 false、余额不变、不落流水',
           r['bad'] is False and r['coins'] == 70 and r['logGrew'] == 0 and r['chk']['diff'] == 0, r)

        r = pg.evaluate("""(() => {
          const n0 = appData.tree.coinLog.length;
          const zero = coinEarn(0, 'gift', '零元奖励');
          const neg = coinEarn(-5, 'gift', '负数奖励');
          return { zero: zero, neg: neg, logGrew: appData.tree.coinLog.length - n0, coins: appData.tree.coins };
        })()""")
        ok('L2-⑥ 入账 n<=0 直接忽略（不造 0 元流水）',
           r['zero'] is None and r['neg'] is None and r['logGrew'] == 0 and r['coins'] == 70, r)

        # ============ L3 撤销 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinEarn(200, 'gift', '奖励 A');
          const income = appData.tree.coinLog.filter(t => t.type === 'gift')[0];
          const okDone = coinUndo(income.id);
          const log = appData.tree.coinLog;
          return { okDone: okDone, coins: appData.tree.coins, chk: coinLedgerCheck(),
                   stillThere: log.filter(t => t.id === income.id).length,
                   tail: log[log.length - 1] };
        })()""")
        ok('L3-① 撤销一笔收入：余额回退、原条目仍在（写反向流水而非删除）',
           r['okDone'] is True and r['coins'] == 0 and r['stillThere'] == 1, r)
        ok('L3-② 反向流水：type=undo、金额取反、undoOf 指向原条',
           r['tail']['type'] == 'undo' and r['tail']['amount'] == -200 and r['tail']['undoOf'] != '', r['tail'])
        ok('L3-③ 撤销后账目仍平', r['chk']['diff'] == 0, r['chk'])

        r = pg.evaluate("""(() => {
          const log = appData.tree.coinLog;
          const income = log.filter(t => t.type === 'gift')[0];
          const twice = coinUndo(income.id);
          const undoRow = log.filter(t => t.type === 'undo')[0];
          const undoItself = coinUndo(undoRow.id);
          return { twice: twice, undoItself: undoItself, chk: coinLedgerCheck() };
        })()""")
        ok('L3-④ 同一笔不能撤两次', r['twice'] is False, r)
        ok('L3-⑤ 撤销流水自身不可再撤', r['undoItself'] is False, r)

        r = pg.evaluate("""(() => {
          appData.tree.coins = 500; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinLedgerInit();                     /* 老存档：补期初结转 */
          const opening = appData.tree.coinLog.filter(t => t.type === 'opening')[0];
          return { has: !!opening, undo: opening ? coinUndo(opening.id) : null,
                   chk: coinLedgerCheck(), first: appData.tree.coinLog[0].type };
        })()""")
        ok('L3-⑥ 期初结转排在最前且不可撤（撤了账就散了）',
           r['has'] is True and r['undo'] is False and r['first'] == 'opening' and r['chk']['diff'] == 0, r)

        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinEarn(100, 'gift', '奖励 B');
          coinSpend(30, 'shop', '花掉一部分');
          const spend = appData.tree.coinLog.filter(t => t.type === 'shop')[0];
          const back = coinUndo(spend.id);   /* 撤销支出 = 退回金币 */
          return { back: back, coins: appData.tree.coins, chk: coinLedgerCheck() };
        })()""")
        ok('L3-⑦ 撤销一笔支出 → 金币退回（余额 70→100）',
           r['back'] is True and r['coins'] == 100 and r['chk']['diff'] == 0, r)

        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinEarn(100, 'gift', '奖励 C');
          coinSpend(100, 'shop', '全花光');
          const income = appData.tree.coinLog.filter(t => t.type === 'gift')[0];
          const cannot = coinUndo(income.id);  /* 钱已花掉，收不回来 */
          return { cannot: cannot, coins: appData.tree.coins, chk: coinLedgerCheck() };
        })()""")
        ok('L3-⑧ 已花掉的收入撤不回（余额不够收回）→ 拒绝且账仍平',
           r['cannot'] is False and r['coins'] == 0 and r['chk']['diff'] == 0, r)

        # ============ L4 超上限压实 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          for (let i = 0; i < 700; i++) coinEarn(1, 'gift', '批量奖励 ' + i);
          const log = appData.tree.coinLog;
          const opening = log.filter(t => t.type === 'opening');
          return { len: log.length, max: COIN_LOG_MAX, hasOpen: opening.length,
                   openReason: opening[0] ? opening[0].reason : '',
                   openAmt: opening[0] ? opening[0].amount : null,
                   coins: appData.tree.coins, chk: coinLedgerCheck() };
        })()""")
        ok('L4-① 700 笔入账后账本被压实到上限', r['len'] == r['max'], r)
        ok('L4-② 被裁的旧笔合并成「结转」条（不是直接丢）',
           r['hasOpen'] == 1 and '结转' in r['openReason'], r)
        ok('L4-③ 压实后仍平账：Σ流水 == 余额 700（丢旧笔必对不上）',
           r['chk']['diff'] == 0 and r['coins'] == 700, r['chk'])

        # ============ L5 对账修正 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = appData.tree.coins + 77;   /* 人为造差额（模拟导入脏数据） */
          const before = coinLedgerCheck();
          const fixed = coinLedgerRebalance();
          return { before: before, after: fixed, tail: appData.tree.coinLog.slice(-1)[0] };
        })()""")
        ok('L5-① 人为造差额 → 对账能报出来',
           r['before']['diff'] == 77, r['before'])
        ok('L5-② 「对账修正」补一条 migrate 流水把账对平',
           r['after']['diff'] == 0 and r['tail']['type'] == 'migrate' and r['tail']['amount'] == 77, r)

        # ============ U 段：面板与真实路径 ============
        r = pg.evaluate("""(() => {
          appData.tree.coins = 500; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinEarn(150, 'duration', '专注 86 分钟时长奖励');
          coinEarn(25, 'mustdo', '今日必做 3 件事全部完成');
          coinSpend(350, 'prop', '道具卡：连续浇水保护卡');
          switchView('stats');
          openCoinLedger();
          const modal = document.getElementById('coinLedgerModal');
          const rows = Array.from(document.querySelectorAll('#coinLedgerList .coin-ledger-row'));
          const sum = document.getElementById('coinLedgerSummary');
          return { shown: getComputedStyle(modal).display !== 'none',
                   rowCount: rows.length, logCount: appData.tree.coinLog.length,
                   sumText: sum ? sum.textContent : '',
                   firstText: rows[0] ? rows[0].textContent.trim() : '',
                   undoBtns: document.querySelectorAll('#coinLedgerList .coin-ledger-undo').length,
                   hasFixBtn: sum ? /对账修正/.test(sum.textContent) : false,
                   entryBtn: !!document.getElementById('coinLedgerBtn') };
        })()""")
        ok('U1-① 明细面板能打开、入口按钮在', r['shown'] is True and r['entryBtn'] is True, r)
        ok('U1-② 行数与账本一致（4 笔：结转+3）', r['rowCount'] == r['logCount'] == 4, r)
        ok('U1-③ 摘要显示当前余额与笔数', '325' in r['sumText'] and '4' in r['sumText'], r['sumText'])
        ok('U1-④ 最新一笔显示在最上（含金额与余额）',
           '道具卡' in r['firstText'] and '-350' in r['firstText'], r['firstText'])
        ok('U1-⑤ 可撤销的行有撤销按钮，期初结转那条没有（4 行里 3 个）',
           r['undoBtns'] == 3, r['undoBtns'])
        ok('U1-⑥ 账目正常时**不**显示「对账修正」（不给用户添乱）',
           r['hasFixBtn'] is False, r)

        # 真点面板上的「撤销」按钮
        pg.click('#coinLedgerList .coin-ledger-row .coin-ledger-undo >> nth=0')
        pg.wait_for_timeout(400)
        r = pg.evaluate("""(() => {
          const rows = Array.from(document.querySelectorAll('#coinLedgerList .coin-ledger-row'));
          return { coins: appData.tree.coins, rows: rows.length,
                   firstText: rows[0] ? rows[0].textContent.trim() : '',
                   chk: coinLedgerCheck() };
        })()""")
        ok('U2-① 点面板「撤销」真生效：余额回退（325→675，退回 350）',
           r['coins'] == 675 and r['chk']['diff'] == 0, r)
        ok('U2-② 列表多出一条「撤销回滚」行且置顶',
           r['rows'] == 5 and '撤销' in r['firstText'], r)

        # 真实发放路径：showGift（系统奖励弹窗）必须走账本。
        # 注意 05_journey 会**包装** window.showGift：金币玩法未解锁时直接拦掉（不发币）。
        # 所以这里必须把两种态都测到 —— 只测「解锁后能发」会漏掉门禁；只测「未解锁」会漏掉入账。
        r = pg.evaluate("""(() => {
          closeModal('coinLedgerModal');
          if (appData.journey) appData.journey.enabled = true;   /* 未解锁态 */
          appData.tree.coins = 0; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          coinLedgerInit();
          const n0 = appData.tree.coinLog.length;
          showGift('测试：未解锁时不该发', 30);
          return { coins: appData.tree.coins, grew: appData.tree.coinLog.length - n0,
                   chk: coinLedgerCheck() };
        })()""")
        ok('U3-① 金币玩法未解锁 → showGift 被门禁拦（不发币、不记账、账仍平）',
           r['coins'] == 0 and r['grew'] == 0 and r['chk']['diff'] == 0, r)

        r = pg.evaluate("""(() => {
          if (appData.journey) appData.journey.enabled = false;  /* 解锁 */
          if (typeof _giftItems !== 'undefined') _giftItems.length = 0;
          const n0 = appData.tree.coinLog.length;
          showGift('🎁 成就奖励：测试用「🏅」', 30);
          const tail = appData.tree.coinLog.slice(-1)[0];
          return { grew: appData.tree.coinLog.length - n0, tail: tail,
                   coins: appData.tree.coins, chk: coinLedgerCheck() };
        })()""")
        ok('U3-② 系统奖励弹窗（showGift）入账走账本、type=gift',
           r['grew'] == 1 and r['tail']['type'] == 'gift' and r['tail']['amount'] == 30, r)
        ok('U3-③ showGift 入账后余额 +30 且账平',
           r['coins'] == 30 and r['chk']['diff'] == 0, r)

        # 真实消费路径：商店买道具（走 coinSpend）
        r = pg.evaluate("""(() => {
          appData.tree.coins = 3000; appData.tree.coinLog = []; delete appData.tree.coinLogInit;
          saveData();
          if (typeof buyItem === 'function') buyItem('waterProtect');
          const tail = appData.tree.coinLog.slice(-1)[0];
          return { tail: tail, coins: appData.tree.coins, chk: coinLedgerCheck(),
                   inv: (appData.tree.inventory || {}).waterProtect || 0 };
        })()""")
        ok('U3-④ 商店买道具走 coinSpend、类型=道具卡',
           r['tail'] and r['tail']['type'] == 'prop' and r['tail']['amount'] < 0 and r['inv'] >= 1, r)
        ok('U3-⑤ 购买后账目仍平', r['chk']['diff'] == 0, r['chk'])

        ok('U9 全程零 JS 异常', not errs, errs)
        b.close()

    print()
    bad = [x for x in RESULTS if not x[1]]
    print('金币账本审计：%d 通过 / %d 失败（共 %d 条）' % (len(RESULTS) - len(bad), len(bad), len(RESULTS)))
    for name, _, detail in bad:
        print('  ✗ ' + name + ('  → ' + str(detail)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
