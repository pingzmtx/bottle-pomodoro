/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 引擎预置段：文件头 __ivGov/__dataMig 由全项目共用；被依赖≈95。
 * 红线：勿在本文件外再造第二份同名轮询 / 迁移实现。 */
/* ============================================================
 * 【M1 预置】__ivGov 后台轮询门控器（性能 → 9）
 * 职责：把「常驻 UI 刷新型轮询」与「时序保活型轮询」分开治理——
 *   - __ivGov.add(fn, ms)：页面 document.hidden 时把定时器完全休眠（clearInterval，
 *     后台零唤醒），回到可见时自动恢复原周期。仅限「无人 clearInterval、纯 UI 刷新」的轮询。
 *   - __ivGov.skip(fn, ms)：定时器保活、但 hidden 时不执行回调（留给时序型轮询以后用）。
 * 内置异常上报：回调抛错自动转交 __errRep（文件尾 M1 模块），终结「静默失效」。
 * 函数索引（TOC）：vis/wrap/add/skip/verNum/curVer/run
 * ============================================================ */
window.__ivGov = (function () {
  let tasks = [];
  function vis() {
    let h = document.hidden;
    for (let i = 0; i < tasks.length; i++) {
      let t = tasks[i];
      if (h) {
        if (t.h !== null) {
          clearInterval(t.h);
          t.h = null;
        }
      } else if (t.h === null) {
        t.h = setInterval(t.fn, t.ms);
      }
    }
  }
  function wrap(fn) {
    return function () {
      try {
        fn();
      } catch (err) {
        if (window.__errRep) window.__errRep.push(err, 'iv');
      }
    };
  }
  /* 注册即对齐当前可见性：页面本来就在后台（后台标签里加载 / 恢复会话）时不建定时器，
     等回到前台由 vis() 统一拉起 —— 否则「后台零唤醒」在这条路径上就不成立了。
     于是恒有不变式：h !== null ⇔ 该任务此刻在跑。 */
  function add(fn, ms) {
    let t = { fn: wrap(fn), ms: ms, h: null };
    tasks.push(t);
    if (!document.hidden) t.h = setInterval(t.fn, ms);
    return t;
  }
  function skip(fn, ms) {
    return setInterval(function () {
      if (!document.hidden) {
        try {
          fn();
        } catch (err) {
          if (window.__errRep) window.__errRep.push(err, 'iv');
        }
      }
    }, ms);
  }
  if (document.addEventListener)
    document.addEventListener('visibilitychange', function () {
      try {
        vis();
      } catch (e) { if (window.__silent) window.__silent(e, '01a:skip'); }
    });
  return {
    add: add,
    skip: skip,
    _dbg: function () {
      return tasks;
    },
    _vis: vis
  };
})();

/* ============================================================
 * 【预置】__dataMig 版本化数据迁移链
 * 必须与 __ivGov 一起放在最早执行处：loadData / 导入 / 恢复自动备份三条路统一
 * 调用 __dataMig.run(app, fromVer, scene)。迁移逻辑收拢在 STEPS 登记表，
 * 字段级 if(typeof…) 兜底保留为最终防线；每次执行写 appData.__migration 审计。
 * 新增结构迁移：STEPS 登记一行 + DATA_VERSION 同步 +1，再删对应内联兜底。
 * ★ 版本号口径：**DATA_VERSION 是「数据结构版本」，与产品版本号无关**。
 *   产品版本号统一用「源码改动日期」（形如 2026.10.12，见 build.py 写入产物首行 + 设置页页脚 #buildVer）。
 *   数据结构已趋于稳定，DATA_VERSION 冻结在 '3.9'，不再随每次发布 +1；日后真有结构变更才动它。
 * ============================================================ */
window.__dataMig = (function () {
  let STEPS = [
    /* 例：{v:'3.9',name:'…',run:function(d){…幂等…}} */
    {
      v: '3.8',
      name: '版本字段收口与迁移审计（升级 3.7→3.8）',
      run: function (d) {
        if (d && !d.version && d.dataVersion) d.version = d.dataVersion;
        if (d && (!d.__migration || typeof d.__migration !== 'object'))
          d.__migration = { firstAt: new Date().toISOString(), runs: [] };
      }
    },
    {
      v: '3.9',
      name: '口径变更：完整🍅 = 至少 1 个；不足 25 分钟默认「半个🍅」',
      /* 这是**口径**变更，不是结构迁移 —— 新记录怎么记完全由 01c 完成弹窗与
         calcPomos 决定，本步**刻意不回溯历史数据**（故 run 为空）。
         为什么不动历史：老代码 ≥15 分钟就默认把时段标成「完整🍅」，但折算被 floor
         成 0.5。按新口径，不足 25 分钟的默认应是「半个🍅」(0.5)，所以**不该自动抬到 1**；
         而「要不要按它当时标的『完整🍅』把历史那批补成 1」属于产品决策，尚未确定。
         定了以后另加一步（只上调、幂等，内联阈值不引用后置槽位常量）。 */
      run: function () {}
    }
  ];
  function verNum(v) {
    let p = String(v == null ? '0' : v).split('.');
    return (Number(p[0]) || 0) * 1000 + (Number(p[1]) || 0);
  }
  function curVer() {
    try {
      return typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '3.9';
    } catch (e) {
      return '3.9';
    }
  }
  function run(app, fromVer, scene) {
    let cur = curVer(),
      curN = verNum(cur),
      fromN = verNum(fromVer),
      applied = [];
    if (app && typeof app === 'object') {
      for (let i = 0; i < STEPS.length; i++) {
        let s = STEPS[i],
          sv = verNum(s.v);
        if (sv > fromN && sv <= curN) {
          try {
            s.run(app);
            applied.push({ v: s.v, name: s.name });
          } catch (e) {
            try {
              console.error('[dataMig] 步骤失败 ' + s.v, e);
              if (window.__errRep) window.__errRep.push(e, 'dataMig');
            } catch (e2) { if (window.__silent) window.__silent(e2, '01a:run'); }
          }
        }
      }
      try {
        if (!app.__migration || typeof app.__migration !== 'object')
          app.__migration = { firstAt: new Date().toISOString(), runs: [] };
        app.__migration.last = {
          at: new Date().toISOString(),
          scene: scene || '',
          from: String(fromVer || '0'),
          to: cur
        };
        if (applied.length) {
          app.__migration.runs.push({
            at: app.__migration.last.at,
            scene: app.__migration.last.scene,
            from: app.__migration.last.from,
            to: cur,
            applied: applied
          });
          if (app.__migration.runs.length > 20) app.__migration.runs.shift();
        }
      } catch (e) { if (window.__silent) window.__silent(e, '01a:run'); }
    }
    if (applied.length) {
      try {
        if (window.console)
          console.info(
            '[dataMig] ' +
              fromVer +
              ' → ' +
              cur +
              ' 应用迁移：' +
              applied
                .map(function (x) {
                  return x.v;
                })
                .join(',')
          );
      } catch (e) { if (window.__silent) window.__silent(e, '01a:run'); }
    }
    return { from: String(fromVer || '0'), to: cur, applied: applied };
  }
  return { run: run, steps: STEPS, current: curVer, _verNum: verNum };
})();
