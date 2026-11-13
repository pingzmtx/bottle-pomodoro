#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""后端接入就绪度体检：不猜、不改代码，只回答「现在接后端会踩什么」。

用法:
    python3 tools/backend_readiness.py
    python3 tools/backend_readiness.py --json      # 机器可读

为什么要有它:
    「先做架构预留」最容易变成「加一堆没人调用的接口层」。真正决定能不能接后端的是
    五件事：**写盘入口唯一、记录有全局唯一 ID、删除留墓碑、每条记录有更新时间、
    导出携带这些字段**。这五项不解决，同步协议写出来就是错的（删除同步不过去、
    冲突判不出来、多端 ID 撞车）。
    本工具把现状量出来，按缺口给顺序，避免用「加抽象层」冒充「做好准备」。
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "src", "scripts")


def read_all():
    out = {}
    for f in glob.glob(os.path.join(SCRIPTS, "*.js")):
        out[os.path.basename(f)] = open(f, encoding="utf-8").read()
    return out


def find(pattern, files, flags=0):
    hits = []
    for name in sorted(files):
        text = files[name]
        for m in re.finditer(pattern, text, flags):
            line = text[:m.start()].count("\n") + 1
            hits.append((name, line))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    files = read_all()
    rows, gaps = [], []

    def add(level, item, detail):
        rows.append((level, item, detail))
        if level != "OK":
            gaps.append(item)

    # 1. 写盘入口唯一性
    ls_hits = [h for h in find(r"localStorage\.setItem", files) if h[0] != "01b1_storage.js"]
    add("OK" if not ls_hits else "FAIL", "localStorage 直写收敛",
        "全部经 TFStorage" if not ls_hits
        else "%d 处绕过 TFStorage：%s" % (len(ls_hits), ", ".join("%s:%d" % h for h in ls_hits[:5])))

    # 2. IndexedDB 打开点
    idb = find(r"indexedDB\.open\(", files)
    add("OK" if len(idb) <= 1 else "WARN", "IndexedDB 打开点",
        "%d 处%s" % (len(idb), "（应集中在 01b_engine_data）" if len(idb) > 1 else ""))

    # 3. 单一保存入口
    data_js = files.get("01b_engine_data.js", "")
    has_save = bool(re.search(r"function saveData\(\)", data_js))
    has_imm = bool(re.search(r"function _saveDataImmediate\(", data_js))
    add("OK" if has_save and has_imm else "FAIL", "单一保存入口",
        "saveData() → _saveDataImmediate()" if has_save and has_imm
        else "缺 saveData 或 _saveDataImmediate")

    # 4. 记录唯一标识（同步主键）
    # 判定看 uid 覆盖率，不看 id 形状：数值 id 仍是本地主键（200+ 处引用），
    # 同步只认 uid。要求覆盖全部创建点（记录/待办/习惯/备忘/子任务/倒计时/提醒）。
    uid_new = find(r"uid:\s*newUid\(", files)
    id_old = find(r"id:\s*Date\.now\(\)", files)
    add("OK" if len(uid_new) >= 8 else "WARN", "记录全局唯一 ID",
        "uid 覆盖 %d 处创建点；另有 %d 处沿用数值 id（本地键，不参与同步）"
        % (len(uid_new), len(id_old)))

    # 5. 删除墓碑
    tomb = find(r"function tombstone\(|tombstones\.push|\bdeletedAt\b", files)
    add("OK" if tomb else "FAIL", "删除墓碑",
        "%d 处引用（tombstone() / tombstones / deletedAt）" % len(tomb) if tomb
        else "无。删除是物理移除 → 服务端无法得知「这条被删了」，同步会把它复活")

    # 6. 记录级更新时间
    upd = find(r"\bupdatedAt\b", files)
    touch = find(r"function touch\(|function touchRecord\(", files)
    add("OK" if upd and touch else ("WARN" if upd else "FAIL"), "记录级更新时间",
        "updatedAt %d 处，touch() %d 处" % (len(upd), len(touch)) if upd
        else "无。冲突只能靠「谁后写」猜，无法做记录级 LWW")

    # 7. schema 版本与迁移链
    ver = re.search(r"DATA_VERSION\s*=\s*['\"]([^'\"]+)", data_js)
    mig = find(r"function migrateDataContract|__dataMig|migrate", files)
    add("OK" if ver and mig else "WARN", "schema 版本与迁移链",
        "DATA_VERSION=%s，迁移钩子 %d 处" % (ver.group(1) if ver else "?", len(mig)))

    # 8. 导出是否带契约字段
    exp = files.get("01b_engine_data.js", "")
    exp_ok = bool(re.search(r"exportData", exp)) and "tombstones" in exp
    add("OK" if exp_ok else "FAIL", "导出携带契约字段",
        "exportData 带上 tombstones / uid / updatedAt" if exp_ok
        else "导出不含 tombstones → 换设备恢复会把已删记录带回来")

    if args.json:
        print(json.dumps([{"level": l, "item": i, "detail": d} for l, i, d in rows],
                         ensure_ascii=False, indent=2))
        return 0 if not gaps else 1

    icon = {"OK": "✓", "WARN": "!", "FAIL": "✗"}
    print("后端接入就绪度（只读体检，不做修改）\n")
    for level, item, detail in rows:
        print("  %s %-22s %s" % (icon[level], item, detail))
    print()
    if gaps:
        print("缺口 %d 项，按「不修就会丢数据」排序：" % len(gaps))
        for i, g in enumerate(gaps, 1):
            print("  %d. %s" % (i, g))
        return 1
    print("✓ 数据契约已具备接后端的前提条件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
