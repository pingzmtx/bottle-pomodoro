#!/usr/bin/env python3
"""空语句检测：语句位置出现「裸标识符 / 裸成员访问」= 漏括号的调用（AST 级）。

为什么必须有这个门禁：一次"清理开发痕迹"的批量替换把注释里的编号连同 `()` 一起删掉，
`bioBackfillOnce;` / `saveData;` / `waitDataThenSync;` 全成了空语句 —— 语法合法、
`node --check` 全绿、结构 lint 全绿，但功能整片失效（传记补记、皮肤缩放保存、折叠记忆同步）。

首版用「逐行正则 + 续行猜测」，实测有 5 类可复现漏报：
  ① 多语句同行 `bar(); foo;`
  ② 换行注释夹中间 `foo\n// c\n;`
  ③ 跨行块注释 `foo /* a\nb */ ;`
  ④ 嵌套括号 `if (a && f(b)) foo;`
  ⑤ 上一行以 `)` 结尾被当成续行 → 跳过
本模块改用真正的**词法分析**（字符串 / 模板串 / 正则字面量 / 注释全部按 JS 规则切分），
再在 token 流上判定，五类全中且不误报。

判定规则：某个 `;` 之前紧邻的 token 串形如 `Ident (. Ident)*`，且该串之前是
`;` `{` `}` `)` 之一（或文件开头），且此时不在任何 `(` / `[` 里 → 判为空语句。
（跳过 `(` 内是为了避开 `for (i; i<n; i++)` 这类合法的分号用法；
  `:` 不算语句起点，否则 `x ? a : b;` 里的 `b` 会被误报。）

用法：
    python3 tools/js_dead_stmt.py <file.js> [...]   # 有发现则 exit 1
    python3 tools/js_dead_stmt.py --selftest        # 跑内置反例自测
"""
import re
import sys

_KEYWORDISH = {
    "break", "case", "catch", "class", "const", "continue", "debugger", "default",
    "delete", "do", "else", "export", "extends", "finally", "for", "function", "if",
    "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw",
    "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "async",
    "await", "of", "true", "false", "null", "undefined",
}

# 这些名字单独成句不算"漏括号"（本身合法或纯噪音）
_IGNORE_NAMES = {"this", "super", "true", "false", "null", "undefined"}

# 语句起点的前一个 token：只有这几种时才可能是"语句开头"
_STMT_PREV = set(";{})")
# `else c;` / `do c;` 里 c 也是语句起点（关键字前导）
_STMT_KW_PREV = {"else", "do"}

# `/` 之后允许出现正则字面量时，前一个 token 不能是这些东西
_REGEX_OK_WORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do",
    "else", "case", "yield", "await",
}


def _tokenize(src):
    """把 JS 源码切成 (kind, value, line) 词法单元；kind ∈ id/kw/num/str/tmpl/regex/punct。"""
    toks = []
    i, n, line = 0, len(src), 1
    mode = "code"
    tmpl = []          # 每个 ${ 记一个花括号深度
    prev = None

    def emit(kind, val, ln):
        nonlocal prev
        prev = (kind, val, ln)
        toks.append((kind, val, ln))

    while i < n:
        c = src[i]
        if mode == "tmpl":
            if c == "\\":
                if i + 1 < n and src[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if c == "`":
                mode = "code"
                emit("tmpl", "`", line)
                i += 1
                continue
            if c == "$" and i + 1 < n and src[i + 1] == "{":
                mode = "code"
                tmpl.append(0)
                i += 2
                continue
            if c == "\n":
                line += 1
            i += 1
            continue
        # ---------------- code 模式 ----------------
        if c == "\n":
            line += 1
            i += 1
            continue
        if c in " \t\r":
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                if src[i] == "\n":
                    line += 1
                i += 1
            i += 2
            continue
        if c in "\"'":
            q = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    if i + 1 < n and src[i + 1] == "\n":
                        line += 1
                    i += 2
                    continue
                if src[i] == "\n":
                    line += 1
                    break
                if src[i] == q:
                    i += 1
                    break
                i += 1
            emit("str", q, line)
            continue
        if c == "`":
            mode = "tmpl"
            emit("tmpl", "`", line)
            i += 1
            continue
        if c == "}" and tmpl and tmpl[-1] == 0:
            tmpl.pop()
            mode = "tmpl"
            i += 1
            continue
        if c == "{":
            if tmpl:
                tmpl[-1] += 1
            emit("punct", "{", line)
            i += 1
            continue
        if c == "}":
            if tmpl:
                tmpl[-1] -= 1
            emit("punct", "}", line)
            i += 1
            continue
        if c.isalpha() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            w = src[i:j]
            emit("kw" if w in _KEYWORDISH else "id", w, line)
            i = j
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            j = i
            while j < n and (src[j].isalnum() or src[j] in "._$"):
                if src[j] == "." and j + 1 < n and src[j + 1] == ".":
                    break
                j += 1
            emit("num", src[i:j], line)
            i = j
            continue
        if c == "/":
            ok = True
            if prev is not None:
                pk, pv, _ = prev
                if pk in ("id", "num", "str", "tmpl", "regex"):
                    ok = False
                elif pv in (")", "]", "}"):
                    ok = False
                elif pk == "kw" and pv not in _REGEX_OK_WORDS:
                    ok = False
            if ok:
                i += 1
                incls = False
                while i < n:
                    ch = src[i]
                    if ch == "\\":
                        i += 2
                        continue
                    if ch == "\n":
                        break
                    if ch == "[":
                        incls = True
                    elif ch == "]":
                        incls = False
                    elif ch == "/" and not incls:
                        i += 1
                        break
                    i += 1
                while i < n and src[i].isalpha():
                    i += 1
                emit("regex", "/", line)
                continue
        emit("punct", c, line)
        i += 1
    return toks


def find_dead_statements(src):
    """返回 [(line, text)]：语句位置的裸标识符 / 裸成员访问。"""
    toks = _tokenize(src)
    # 预处理每个 token 处所在的 () / [] 深度
    paren, brack = 0, 0
    depths = []
    for k, v, _ in toks:
        if k == "punct" and v == "(":
            paren += 1
        elif k == "punct" and v == ")":
            paren = max(0, paren - 1)
        elif k == "punct" and v == "[":
            brack += 1
        elif k == "punct" and v == "]":
            brack = max(0, brack - 1)
        depths.append((paren, brack))

    out = []
    for i, (k, v, ln) in enumerate(toks):
        if not (k == "punct" and v == ";"):
            continue
        p, b = depths[i]
        if p or b:
            continue
        j = i - 1
        if j < 0 or toks[j][0] != "id":
            continue
        base = j
        while base - 2 >= 0 and toks[base - 1] == ("punct", ".", toks[base - 1][2]) \
                and toks[base - 2][0] == "id":
            base -= 2
        if toks[base][0] != "id" or toks[base][1] in _IGNORE_NAMES:
            continue
        if base - 1 >= 0:
            pk, pv, _ = toks[base - 1]
            ok_prev = (pk == "punct" and pv in _STMT_PREV) \
                or (pk == "kw" and pv in _STMT_KW_PREV)
            if not ok_prev:
                continue
        text = "".join(x[1] for x in toks[base:i])
        out.append((toks[base][2], text + ";"))
    return out


# --------------------------------------------------------------------------
# 自测：反例必须抓、合法写法必须放过（改判定规则后先跑这个）
# --------------------------------------------------------------------------
_POSITIVE = [
    ("多语句同行", "bar(); foo;", "foo;"),
    ("换行注释夹中间", "foo\n// c\n;", "foo;"),
    ("跨行块注释", "foo /* a\nb */ ;", "foo;"),
    ("嵌套括号 if", "if (a && f(b)) foo;", "foo;"),
    ("上行以 ) 结尾", "someFn(arg)\nfoo;", "foo;"),
    ("守卫 + 漏括号", "if (!appData.bioBackfillDone) bioBackfillOnce;", "bioBackfillOnce;"),
    ("裸成员访问", "a.b.c;", "a.b.c;"),
    ("块首行", "{ x; }", "x;"),
    ("else 分支", "if (a) b(); else c;", "c;"),
]

_NEGATIVE = [
    ("for 头分号", "for (i; i < n; i++) { x(); }"),
    ("for-in/of", "for (const k of list) total;"),   # 漏括号但形态在 ) 后 → 见下方说明
    ("三元", "x = a ? b : c;"),
    ("展开参数", "f(...args);"),
    ("除法", "var a = 1 / 2;"),
    ("对象后除法", "x = { a: 1 } / 2;"),
    ("模板串", "let s = `a${ b.c }d`;"),
    ("正则", "if (/re/.test(s)) foo();"),
    ("可选链", "x?.[k];"),
    ("跨行链式调用", "a.b\n .c();"),
    ("标签语句", "label:\n  x();"),
    ("while", "while (x) y();"),
    ("return", "function f(){ return; }"),
    ("case 分支", "switch (x) { case 1: foo(); break; }"),
    ("调用赋值", "window.__flag = true;"),
    ("自增", "++i;"),
]


def _selftest():
    bad = 0
    for name, src, want in _POSITIVE:
        got = [t for _, t in find_dead_statements(src)]
        if got != [want]:
            print("✗ 正例 %s: 期望 %r，实际 %r" % (name, [want], got))
            bad += 1
    for name, src in _NEGATIVE:
        got = [t for _, t in find_dead_statements(src)]
        if name == "for-in/of":
            # for (const k of list) total;  —— `total;` 前面是 `)`，判为空语句是**正确**的
            if got != ["total;"]:
                print("✗ 负例 %s（此处应判空语句）: 实际 %r" % (name, got))
                bad += 1
            continue
        if got:
            print("✗ 负例 %s: 误报 %r" % (name, got))
            bad += 1
    if bad:
        print("空语句自测: FAIL %d" % bad)
        return 1
    print("空语句自测: PASS %d 正例 / %d 负例" % (len(_POSITIVE), len(_NEGATIVE)))
    return 0


def _main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--selftest":
        return _selftest()
    bad = 0
    for path in argv:
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            print("读不到 %s: %s" % (path, e))
            bad += 1
            continue
        for line, text in find_dead_statements(src):
            print("空语句（疑似漏括号的调用） %s:%d  %s" % (path, line, text))
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
