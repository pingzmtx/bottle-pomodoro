#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FileExchange / Bridge 导出状态机的时序模型测试。

⚠️ 方法与边界（必须先读）：
   无真机、无模拟器（无 KVM），无法在 JVM/ART 上跑真实 FileExchange.kt。
   本文件把 FileExchange.kt 的**分支逻辑逐行搬成 Python 模型**（每个函数标注对应行号），
   用它把「乱序/重复/超发」的时序跑一遍，观察：
     · 每个 begin / chunk / end / abort 的 cmdId 是否都**恰好**收到一次应答（不漏、不重）
     · 每个 ValueCallback<Array<Uri>> 是否被**恰好**调用一次（WebView 双回调会抛 IllegalStateException）
     · 导出会话是否出现「两个并存」「串号」「半截文件残留」

   模型只能证明"按代码字面逻辑会发生什么"，不能证明线程时序。凡是依赖真实线程/系统
   Intent 的部分，报告里单列为「只能真机验」。

对应源码：app/src/main/java/im/bottle/focus/FileExchange.kt（行号为该文件）
"""
import sys

# ---------------------------------------------------------------- 模型

E_STATE_CONFLICT = "E_STATE_CONFLICT"
E_INTERNAL = "E_INTERNAL"
E_BAD_PAYLOAD = "E_BAD_PAYLOAD"
MAX_CHUNK_CHARS = 400_000   # Bridge.kt:314
MAX_SESSION_ID = 64         # Bridge.kt:320


class Callback:
    """ValueCallback<Array<Uri>>：记录被调用次数与被交付的值。"""

    def __init__(self, name):
        self.name = name
        self.calls = []

    def onReceiveValue(self, value):
        if len(self.calls) >= 1:
            # 真实 WebView 这里会抛 IllegalStateException
            raise AssertionError("DOUBLE CALLBACK: %s 被调用第 %d 次" % (self.name, len(self.calls) + 1))
        self.calls.append(value)


class ExportSession:
    _seq = 0

    def __init__(self, uri, name):
        ExportSession._seq += 1
        self.id = "x%d-%s" % (ExportSession._seq, "t")
        self.uri = uri
        self.name = name
        self.bytes = 0
        self.closed = False
        self.deleted = False
        self.write_fail = False


class FileExchangeModel:
    def __init__(self):
        self.pendingChooser = None      # FileExchange.kt:52
        self.pendingExport = None       # :55  (id, name, proxy)
        self.session = None             # :58
        self.replies = []               # [(id, kind, payload)]
        self.toasts = []
        self.sys_queue = []             # 模拟 startActivityForResult 已拉起的系统对话框
        self.writer = []                # 模拟单线程 FIFO 写盘队列
        self.log = []

    # ---- 应答出口（BridgeReply）----
    def _ok(self, cid, payload):
        self.replies.append((cid, "ok", payload))

    def _err(self, cid, code):
        self.replies.append((cid, "err", code))

    def reply_count(self, cid):
        return sum(1 for r in self.replies if r[0] == cid)

    # ---- 导入 ----
    def onShowFileChooser(self, cb, throw=None):
        """:64-102"""
        if cb is None:
            return False
        self.cancelPendingChooser("superseded")      # :76
        self.pendingChooser = cb                     # :89
        if throw in ("ActivityNotFound", "Other"):   # :93 catch (e: Exception) —— 已放宽
            self.pendingChooser = None
            cb.onReceiveValue(None)
            self.toasts.append("导入失败：无法打开文件选择器")
            return True
        self.sys_queue.append(("IMPORT", None))      # :91
        return True

    def deliverImport(self, resultCode, data=None, uri=None):
        """onActivityResult(REQ_IMPORT) → deliverImport :111-134"""
        cb = self.pendingChooser
        self.pendingChooser = None
        if cb is None:
            self.log.append("import result without pending callback")
            return
        uris = None
        if resultCode == "OK":
            uris = [uri] if uri else None
        cb.onReceiveValue(uris)                      # :132

    def cancelPendingChooser(self, reason):
        """":321-330"""
        cb = self.pendingChooser
        if cb is None:
            return
        self.pendingChooser = None
        cb.onReceiveValue(None)                      # :326

    def release(self):
        """:314-319"""
        self.cancelPendingChooser("release")
        self.pendingExport = None
        self.abortCurrent("release")

    # ---- 导出 ----
    def beginExport(self, cid, name, mime="application/json", throw=None):
        """:144-193 —— 双闸门版"""
        # 闸门一：上一个 begin 未应答 → 直接拒，不拉第二个 Intent
        in_flight = self.pendingExport
        if in_flight is not None:                    # :150-157
            self.toasts.append("上一次导出还没结束")
            self._err(cid, E_STATE_CONFLICT)
            return

        # 闸门二：上一笔已进写盘阶段，它那条 begin 早已应答过 → 只作废会话，不补应答
        if self.session is not None:                 # :159-166
            self.log.append("begin supersedes in-progress session")
            self.abortCurrent("superseded")

        safe_mime = mime or "application/json"       # :173 空 mime 兜底
        self.pendingExport = (cid, name, safe_mime)  # :175
        if throw in ("ActivityNotFound", "Other"):   # :181-187 catch (e: Exception)
            self.pendingExport = None
            self.toasts.append("导出失败：无法打开保存对话框")
            self._err(cid, E_INTERNAL)
            return
        self.sys_queue.append(("EXPORT", cid))       # :179

    def onExportPicked(self, resultCode, uri=None, open_fail=False):
        """onActivityResult(REQ_EXPORT) → onExportPicked :176-222"""
        p = self.pendingExport
        self.pendingExport = None
        if p is None:
            self.log.append("export result without pending begin")
            return
        cid, name, _mime = p
        if resultCode != "OK" or uri is None:        # :185
            self.toasts.append("已取消保存，备份未写入")
            self._ok(cid, {"saved": False, "cancelled": True})   # :190
            return
        if open_fail:                                # :198-208
            self.toasts.append("导出失败：无法写入所选位置")
            self._err(cid, E_INTERNAL)
            return
        s = ExportSession(uri, name)                 # :211
        self.session = s
        self._ok(cid, {"saved": True, "cancelled": False, "sessionId": s.id, "name": name})  # :212

    def writeChunk(self, cid, sid, text):
        """:225-242"""
        s = self.session
        if s is None or s.id != sid:                 # :227
            self._err(cid, E_STATE_CONFLICT)
            return
        self.writer.append(("chunk", cid, s, text))

    def endExport(self, cid, sid):
        """:245-275"""
        s = self.session
        if s is None or s.id != sid:                 # :247
            self._err(cid, E_STATE_CONFLICT)
            return
        self.session = None                          # :252 ← 先置空，再排队
        self.writer.append(("end", cid, s, None))

    def abortExport(self, cid, sid):
        """:278-292"""
        s = self.session
        if s is None or s.id != sid:                 # :280
            self._ok(cid, {"aborted": True})         # :282 幂等
            return
        self.session = None                          # :285
        self.writer.append(("abort", cid, s, None))

    def abortCurrent(self, reason):
        """:332-340"""
        s = self.session
        if s is None:
            return
        self.session = None
        self.writer.append(("abortCurrent", None, s, None))

    # ---- 写盘线程（FIFO）----
    def drain(self):
        while self.writer:
            kind, cid, s, text = self.writer.pop(0)
            if kind == "chunk":
                if s.write_fail:
                    self.abortCurrent("write failed")
                    self._err(cid, E_INTERNAL)       # :239
                else:
                    s.bytes += len(text.encode("utf-8"))
                    self._ok(cid, {"bytes": s.bytes})   # :235
            elif kind == "end":
                if s.closed:
                    self._err(cid, E_INTERNAL)
                else:
                    s.closed = True
                    self._ok(cid, {"saved": True, "name": s.name, "bytes": s.bytes, "uri": s.uri})
            elif kind == "abort":
                s.closed = True
                s.deleted = True
                self._ok(cid, {"aborted": True})     # :290
            elif kind == "abortCurrent":
                s.closed = True
                s.deleted = True


# ---------------------------------------------------------------- 断言框架

class Case:
    def __init__(self, name):
        self.name = name
        self.fails = []

    def eq(self, what, got, want):
        if got != want:
            self.fails.append("%s：期望 %r，实际 %r" % (what, want, got))

    def true(self, what, cond, detail=""):
        if not cond:
            self.fails.append("%s 不成立 %s" % (what, detail))


def scenario(name, fn):
    c = Case(name)
    try:
        fn(c)
    except AssertionError as e:
        c.fails.append(str(e))
    except RuntimeError as e:
        c.fails.append("异常逃逸：%s" % e)
    status = "PASS" if not c.fails else "FAIL"
    color = "\033[32m" if not c.fails else "\033[31m"
    print("  %s%s\033[0m %-46s %s" % (color, status, name,
                                      "" if not c.fails else c.fails[0]))
    for extra in c.fails[1:]:
        print("        └─ %s" % extra)
    return not c.fails


# ---------------------------------------------------------------- 场景

def s1_import_cancel_ok(c):
    m = FileExchangeModel()
    cb = Callback("cb1")
    m.onShowFileChooser(cb)
    m.deliverImport("CANCELED")
    c.eq("回调次数", len(cb.calls), 1)
    c.eq("交付值", cb.calls[0], None)
    c.eq("pendingChooser 已清", m.pendingChooser, None)


def s2_import_pick_ok(c):
    m = FileExchangeModel()
    cb = Callback("cb1")
    m.onShowFileChooser(cb)
    m.deliverImport("OK", uri="content://doc/1")
    c.eq("回调次数", len(cb.calls), 1)
    c.eq("交付值", cb.calls[0], ["content://doc/1"])


def s3_import_double_tap(c):
    """连点两次导入：cb1 被 supersede，cb2 拿结果；每个只被调一次。"""
    m = FileExchangeModel()
    cb1, cb2 = Callback("cb1"), Callback("cb2")
    m.onShowFileChooser(cb1)
    m.onShowFileChooser(cb2)          # 第二次进来先 cancel 旧的
    c.eq("cb1 被调用次数", len(cb1.calls), 1)
    c.eq("cb1 得到 null", cb1.calls[0], None)
    c.eq("此时已拉起几个系统对话框", len(m.sys_queue), 2)   # ★ 两个都拉起了
    m.deliverImport("OK", uri="content://doc/2")
    c.eq("cb2 被调用次数", len(cb2.calls), 1)
    m.deliverImport("OK", uri="content://doc/1")            # 第一个对话框后返回
    c.eq("cb2 仍只被调用一次", len(cb2.calls), 1)
    c.eq("cb1 仍只被调用一次", len(cb1.calls), 1)


def s4_import_release_then_result(c):
    """导入中销毁：release 回调 null，之后 result 到达不该再回调。"""
    m = FileExchangeModel()
    cb = Callback("cb1")
    m.onShowFileChooser(cb)
    m.release()
    c.eq("release 后回调次数", len(cb.calls), 1)
    m.deliverImport("OK", uri="content://doc/1")
    c.eq("result 到达后仍为 1", len(cb.calls), 1)


def s5_import_throw_other(c):
    """startActivityForResult 抛非 ActivityNotFound：回调被漏掉（不崩则挂住）。"""
    m = FileExchangeModel()
    cb = Callback("cb1")
    try:
        m.onShowFileChooser(cb, throw="Other")
    except RuntimeError:
        pass
    c.eq("回调次数（期望 1 = 已被应答）", len(cb.calls), 1)
    c.eq("pendingChooser 应已清空", m.pendingChooser is None, True)


def s6_export_happy(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    c.eq("begin 应答数", m.reply_count("b1"), 1)
    sid = m.session.id
    m.writeChunk("c1", sid, "x" * 10)
    m.writeChunk("c2", sid, "y" * 10)
    m.drain()
    c.eq("c1 应答数", m.reply_count("c1"), 1)
    c.eq("c2 应答数", m.reply_count("c2"), 1)
    m.endExport("e1", sid)
    m.drain()
    c.eq("end 应答数", m.reply_count("e1"), 1)
    c.eq("end 返回 saved", [r for r in m.replies if r[0] == "e1"][0][2]["saved"], True)
    c.eq("字节数", [r for r in m.replies if r[0] == "e1"][0][2]["bytes"], 20)


def s7_export_cancel(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("CANCELED")
    c.eq("begin 应答数", m.reply_count("b1"), 1)
    c.eq("cancelled", [r for r in m.replies if r[0] == "b1"][0][2]["cancelled"], True)
    c.eq("有用户可见提示", "已取消保存，备份未写入" in m.toasts, True)
    c.eq("未建会话", m.session, None)


def s8_export_double_begin(c):
    """连点两次导出：闸门一必须直接拒掉第二次，只拉起一个保存框。"""
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.beginExport("b2", "b.json")            # 闸门一：pendingExport 还在 → 拒
    c.eq("拉起的保存对话框数（应为 1）", len(m.sys_queue), 1)
    c.eq("b2 应答数", m.reply_count("b2"), 1)
    b2 = [r for r in m.replies if r[0] == "b2"][0]
    c.eq("b2 是错误应答", b2[1], "err")
    c.eq("b2 错误码", b2[2], E_STATE_CONFLICT)
    c.eq("有用户可见提示", "上一次导出还没结束" in m.toasts, True)
    # 用户的第一个对话框仍然有效，选完之后 b1 恰好一次 ok
    m.onExportPicked("OK", uri="content://d/1")
    c.eq("b1 应答数", m.reply_count("b1"), 1)
    c.eq("b1 拿到 sessionId", bool([r for r in m.replies if r[0] == "b1"][0][2].get("sessionId")), True)


def s9_chunk_before_begin_returns(c):
    """begin 还挂在系统框时，chunk 先到（网页超发/伪造）。"""
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.writeChunk("c1", "x1-t", "data")
    c.eq("chunk 应答数", m.reply_count("c1"), 1)
    c.eq("错误码", [r for r in m.replies if r[0] == "c1"][0][2], E_STATE_CONFLICT)


def s10_end_before_begin_returns(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.endExport("e1", "x1-t")
    c.eq("end 应答数", m.reply_count("e1"), 1)
    c.eq("错误码", [r for r in m.replies if r[0] == "e1"][0][2], E_STATE_CONFLICT)


def s11_abort_idempotent(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    sid = m.session.id
    m.abortExport("a1", sid)
    m.drain()
    c.eq("首次 abort", m.reply_count("a1"), 1)
    c.eq("文件被删", [r for r in m.replies if r[0] == "a1"][0][2]["aborted"], True)
    m.abortExport("a2", sid)                 # 第二次同 sid
    c.eq("二次 abort 也 ok", m.reply_count("a2"), 1)
    c.eq("二次 abort 返回 aborted", [r for r in m.replies if r[0] == "a2"][0][2]["aborted"], True)


def s12_forged_session(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    m.writeChunk("c1", "forged-id", "data")
    c.eq("伪造 sid 被拒", [r for r in m.replies if r[0] == "c1"][0][2], E_STATE_CONFLICT)
    m.endExport("e1", "forged-id")
    c.eq("伪造 sid 的 end 被拒", [r for r in m.replies if r[0] == "e1"][0][2], E_STATE_CONFLICT)
    c.eq("真会话未受影响", m.session is not None, True)


def s13_chunk_after_end(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    sid = m.session.id
    m.endExport("e1", sid)
    m.writeChunk("c1", sid, "late")
    m.drain()
    c.eq("end 已 saved", [r for r in m.replies if r[0] == "e1"][0][2].get("saved"), True)
    c.eq("迟到的 chunk 被拒", [r for r in m.replies if r[0] == "c1"][0][2], E_STATE_CONFLICT)


def s14_write_fail(c):
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    sid = m.session.id
    s = m.session
    s.write_fail = True
    m.writeChunk("c1", sid, "data")
    m.drain()
    c.eq("写失败回 E_INTERNAL", [r for r in m.replies if r[0] == "c1"][0][2], E_INTERNAL)
    c.eq("会话已清", m.session, None)
    c.eq("半截文件被删", s.deleted, True)


def s15_begin_throw_other(c):
    """beginExport 遇到非 ActivityNotFound：pendingExport 残留且无应答。"""
    m = FileExchangeModel()
    try:
        m.beginExport("b1", "a.json", throw="Other")
    except RuntimeError:
        pass
    c.eq("begin 应答数（期望 1）", m.reply_count("b1"), 1)
    c.eq("pendingExport 应已清空", m.pendingExport is None, True)


def s16_gate2_session_in_progress(c):
    """闸门二：上一笔已进写盘阶段，新 begin 作废旧会话且**不给旧 id 补应答**。"""
    m = FileExchangeModel()
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    sid1 = m.session.id
    m.writeChunk("c1", sid1, "hello")
    m.drain()
    c.eq("b1 已应答一次", m.reply_count("b1"), 1)

    m.beginExport("b2", "b.json")            # 闸门二
    c.eq("拉起的保存对话框数", len(m.sys_queue), 2)
    c.eq("b1 应答数（必须仍为 1，不许补发）", m.reply_count("b1"), 1)
    c.eq("旧会话已作废", m.session, None)

    m.onExportPicked("OK", uri="content://d/2")
    c.eq("b2 应答数", m.reply_count("b2"), 1)
    c.eq("新会话 uri", m.session.uri if m.session else None, "content://d/2")


def s17_q1_full_timeline(c):
    """Q1 关键时序：b1 已应答 + 开始新导出 + 旧会话被 abort，
    断言每个 cmdId 恰好一个应答（不泄漏、不双回包）。"""
    m = FileExchangeModel()
    # ① b1 选好位置，拿到会话 S1
    m.beginExport("b1", "a.json")
    m.onExportPicked("OK", uri="content://d/1")
    sid1 = m.session.id
    # ② 旧流程发了几块
    m.writeChunk("c1", sid1, "aaa")
    m.writeChunk("c2", sid1, "bbb")
    m.drain()
    # ③ 用户又点导出 → 闸门二：S1 被 abort，b2 开新会话
    m.beginExport("b2", "b.json")
    m.drain()                                 # 让 abort 任务落地
    # ④ 旧流程仍在飞：它最后那块 ack 之后会发 end
    m.writeChunk("c3", sid1, "ccc")           # S1 已没了 → 冲突
    m.endExport("e1", sid1)                   # 同上
    m.drain()
    # ⑤ 新对话框选完，新流程走完
    m.onExportPicked("OK", uri="content://d/2")
    sid2 = m.session.id
    m.writeChunk("c4", sid2, "ddd")
    m.endExport("e2", sid2)
    m.drain()

    # —— 断言：每个 cmdId 恰好一个应答 ——
    ids = ["b1", "b2", "c1", "c2", "c3", "e1", "c4", "e2"]
    counts = {i: m.reply_count(i) for i in ids}
    c.eq("各 cmdId 应答数", counts, {i: 1 for i in ids})
    c.eq("b1 拿到 sessionId", bool([r for r in m.replies if r[0] == "b1"][0][2].get("sessionId")), True)
    c.eq("b2 也拿到 sessionId", bool([r for r in m.replies if r[0] == "b2"][0][2].get("sessionId")), True)
    c.eq("c3 被拒", [r for r in m.replies if r[0] == "c3"][0][2], E_STATE_CONFLICT)
    c.eq("e1 被拒", [r for r in m.replies if r[0] == "e1"][0][2], E_STATE_CONFLICT)
    c.eq("e2 落盘成功", [r for r in m.replies if r[0] == "e2"][0][2].get("saved"), True)
    c.eq("无 cmdId 漏应答", [i for i in ids if m.reply_count(i) == 0], [])
    c.eq("无 cmdId 双应答", [i for i in ids if m.reply_count(i) > 1], [])


def main():
    scenarios = [
        ("S1  导入：用户取消 → 回调 null 一次", s1_import_cancel_ok),
        ("S2  导入：选中文件 → 回调 content:// 一次", s2_import_pick_ok),
        ("S3  导入：连点两次 → 无双回调", s3_import_double_tap),
        ("S4  导入：销毁后 result 到达 → 不再回调", s4_import_release_then_result),
        ("S5  导入：startActivity 抛异常 → 仍回调 null", s5_import_throw_other),
        ("S6  导出：begin→chunk×2→end 全应答", s6_export_happy),
        ("S7  导出：用户取消 → 明确回包+提示", s7_export_cancel),
        ("S8  导出：连点两次 → 闸门一只拉一个框", s8_export_double_begin),
        ("S9  begin 未返回时 chunk 到达", s9_chunk_before_begin_returns),
        ("S10 begin 未返回时 end 到达", s10_end_before_begin_returns),
        ("S11 abort 幂等", s11_abort_idempotent),
        ("S12 伪造 sessionId 被拒", s12_forged_session),
        ("S13 end 之后迟到 chunk 被拒", s13_chunk_after_end),
        ("S14 写盘失败 → 回错 + 删半截", s14_write_fail),
        ("S15 begin 抛异常 → 回错并清状态", s15_begin_throw_other),
        ("S16 闸门二：会话进行中再 begin → 旧 id 不补应答", s16_gate2_session_in_progress),
        ("S17 Q1 全时序：每个 cmdId 恰好一个应答", s17_q1_full_timeline),
    ]
    print("导出/导入状态机时序模型（对照 FileExchange.kt 行号，非真机执行）\n")
    ok = 0
    for name, fn in scenarios:
        if scenario(name, fn):
            ok += 1
    total = len(scenarios)
    print("\n===== 结果：%d 通过 · %d 失败 =====" % (ok, total - ok))
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
