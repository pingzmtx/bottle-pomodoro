#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 GitHub Git Data API 推送（绕开被阻断的 github.com:443，只走 api.github.com）。

什么时候用它：`git push` 报 `Failed to connect to github.com port 443`，但
`curl https://api.github.com/` 是 200 —— 说明是 github.com 这个域名被阻断，
不是没网。此时 git 协议走不通，但 REST API 通。

用法：
    python3 tools/push_api.py "提交信息"
    POMO_TOKEN_FILE=/path/to/token python3 tools/push_api.py "提交信息"

它按 public/ 的当前内容整体覆盖远端发布路径：本地有、远端没有的会建，本地没有、
远端有的会删（LICENSE / README.md / CNAME 等非发布文件保留）。

另：`git push` 被强杀后本地 .git/refs/remotes/origin/main.lock 会残留，
下次 push 报 "cannot lock ref" —— 先 `find .git -name '*.lock' -delete`。
"""
import base64, json, os, sys, urllib.request, urllib.error

OWNER, REPO, BRANCH = "pingzmtx", "bottle-pomodoro", "main"
PUB = "/var/minis/mounts/Documents/瓶子专注/public"
TOK = open(os.environ.get("POMO_TOKEN_FILE", "/var/minis/shared/pomo/.ghtok")).read().strip()
API = "https://api.github.com"


def call(path, method="GET", body=None):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + TOK)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "minis-push")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        print("HTTP %s %s: %s" % (e.code, path, e.read().decode()[:300]))
        raise


# 1. 当前 head
ref = call("/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
base_sha = ref["object"]["sha"]
print("base commit:", base_sha[:12])

# 2. 本地要发布的所有文件（相对 public/）
want = []
for root, _, files in os.walk(PUB):
    for f in files:
        full = os.path.join(root, f)
        rel = os.path.relpath(full, PUB).replace(os.sep, "/")
        want.append(rel)
want.sort()
print("本地文件 %d 个" % len(want))

# 3. 远端现有树里的发布相关路径（用于找出要删的）
remote_tree = call("/repos/%s/%s/git/trees/%s?recursive=1" % (OWNER, REPO, base_sha))
remote_paths = set()
for e in remote_tree.get("tree", []):
    if e["type"] == "blob":
        remote_paths.add(e["path"])
strip = {"LICENSE", "README.md", ".gitignore", "CNAME", ".nojekyll"}
ours_remote = {p for p in remote_paths if p not in strip}
print("远端发布文件 %d 个" % len(ours_remote))

# 4. 建 blob（只上传内容有变化的；为简单起见全部上传，文件都很小）
tree_entries = []
for rel in want:
    full = os.path.join(PUB, rel)
    raw = open(full, "rb").read()
    blob = call("/repos/%s/%s/git/blobs" % (OWNER, REPO), "POST", {
        "content": base64.b64encode(raw).decode(),
        "encoding": "base64",
    })
    tree_entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("  blob %-34s %7d B" % (rel, len(raw)))

# 5. 要删除的：远端有、本地没有
deleted = sorted(ours_remote - set(want))
for rel in deleted:
    tree_entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": None})
    print("  DEL  %s" % rel)

# 6. 建树（以上一版 tree 为底，只覆盖/删除发布相关路径）
base_tree_sha = call("/repos/%s/%s/git/commits/%s" % (OWNER, REPO, base_sha))["tree"]["sha"]
tree = call("/repos/%s/%s/git/trees" % (OWNER, REPO), "POST", {
    "base_tree": base_tree_sha,
    "tree": tree_entries,
})
print("tree:", tree["sha"][:12])

# 7. 建提交
msg = sys.argv[1] if len(sys.argv) > 1 else "update"
commit = call("/repos/%s/%s/git/commits" % (OWNER, REPO), "POST", {
    "message": msg,
    "tree": tree["sha"],
    "parents": [base_sha],
})
print("commit:", commit["sha"][:12])

# 8. 移动分支
call("/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH), "PATCH", {"sha": commit["sha"]})
print("✓ ref updated ->", commit["sha"])
