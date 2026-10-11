# 列表分页 / 关键字筛选 / 查重走 SQL 分组 的隔离测试
# 分两部分: 1) 直接测 db.py 的函数  2) 用假 server 测 /all 与 /duplicates 的查询参数
# 用法: python pm_paging_test.py
import asyncio
import contextlib
import importlib.util
import os
import shutil
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DB = os.path.join(ROOT, "db.py")
PKG = ROOT

# ---------- 假 aiohttp.web / server / folder_paths (加载 __init__.py 用) ----------
fake_web = types.ModuleType("aiohttp.web")


class _Resp:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status


fake_web.json_response = lambda payload, status=200: _Resp(payload, status)
fake_web.FileResponse = lambda path, headers=None: _Resp({"__file__": path}, 200)
fake_aiohttp = types.ModuleType("aiohttp")
fake_aiohttp.web = fake_web
sys.modules["aiohttp"] = fake_aiohttp
sys.modules["aiohttp.web"] = fake_web

REG = {}


class _Routes:
    def post(self, path):
        def deco(fn):
            REG[("POST", path)] = fn
            return fn
        return deco

    def get(self, path):
        def deco(fn):
            REG[("GET", path)] = fn
            return fn
        return deco


fake_server = types.ModuleType("server")
fake_server.PromptServer = types.SimpleNamespace(
    instance=types.SimpleNamespace(routes=_Routes())
)
sys.modules["server"] = fake_server

TMP_ROOT = tempfile.mkdtemp(prefix="pm_paging_")
fake_fp = types.ModuleType("folder_paths")
fake_fp.get_output_directory = lambda: os.path.join(TMP_ROOT, "output")
fake_fp.get_input_directory = lambda: os.path.join(TMP_ROOT, "input")
fake_fp.get_temp_directory = lambda: os.path.join(TMP_ROOT, "temp")
fake_fp.get_user_directory = lambda: os.path.join(TMP_ROOT, "user")
sys.modules["folder_paths"] = fake_fp

DB_FILE = os.path.join(TMP_ROOT, "data", "pm.db")
os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
os.environ["PM_DB_PATH"] = DB_FILE
os.environ["PM_BACKUP"] = "0"

# ---------- db 模块 ----------
_db_n = [0]


def load_db():
    _db_n[0] += 1
    plugin = os.path.join(TMP_ROOT, "dbmod%d" % _db_n[0])
    os.makedirs(plugin, exist_ok=True)
    shutil.copy2(SRC_DB, os.path.join(plugin, "db.py"))
    spec = importlib.util.spec_from_file_location(
        "_pm_paging_db_%d" % _db_n[0], os.path.join(plugin, "db.py")
    )
    mod = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(open(os.devnull, "w")):
        spec.loader.exec_module(mod)
    return mod


PASSED = 0
FAILED = 0


def check(cond, msg):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  ok   {msg}")
    else:
        FAILED += 1
        print(f"  FAIL {msg}")


db = load_db()

print("\n[1] 准备数据: 9 条, A/B 两分类, 内容 0/1/2 各有重复")
for i in range(1, 8):
    db.save_prompt("n%02d" % i, "内容 %d" % (i % 3), category="A" if i % 2 else "B")
db.save_prompt("cat only", "cat content", category="A")
db.save_prompt("empty one", "", category="B")
check(db.count_items() == 9, "共 9 条 (%d)" % db.count_items())

print("\n[2] 默认取全部 (旧行为)")
items = db.list_items()
order_all = [i["name"] for i in items]
check(len(items) == 9, "不带参数返回全部 9 条")
# 排序是「分类序 → 分类名 → 名称」, 不是全局按名称
cats_seen = []
for it in items:
    if not cats_seen or cats_seen[-1] != it["category"]:
        cats_seen.append(it["category"])
check(len(cats_seen) == len(set(cats_seen)), "同一分类聚在一起 (不交错)")
check(
    all(
        [x["name"] for x in items if x["category"] == c]
        == sorted([x["name"] for x in items if x["category"] == c])
        for c in set(cats_seen)
    ),
    "分类内按名称升序",
)

print("\n[3] 分类筛选")
cat_a = db.list_items(category="A")
cat_b = db.list_items(category="B")
check(len(cat_a) == 5 and len(cat_b) == 4, "A 分类 5 条 / B 分类 4 条")
check(all(i["category"] == "A" for i in cat_a), "A 分类筛选只返回 A")
check(all(i["category"] == "B" for i in cat_b), "B 分类筛选只返回 B")
check(db.count_items(category="A") == 5, "count_items 与 list_items 口径一致")

print("\n[4] 关键字筛选 (名称 / 正文)")
check(len(db.list_items(q="n0")) == 7, "按名称关键字命中 7 条")
check(db.count_items(q="n0") == 7, "关键字计数一致")
check(len(db.list_items(q="cat")) == 1, "按正文关键字命中 1 条")
check(len(db.list_items(q="不存在的关键字")) == 0, "无命中返回空")
check(len(db.list_items(q="%")) == 9, "通配符 % 被剔除, 不会变成全匹配")
check(len(db.list_items(q="_")) == 9, "通配符 _ 被剔除, 不会变成全匹配")
check(len(db.list_items(q="N01")) == 1, "关键字大小写不敏感")

print("\n[5] 分页")
p1 = db.list_items(limit=4, offset=0)
p2 = db.list_items(limit=4, offset=4)
p3 = db.list_items(limit=4, offset=8)
check(len(p1) == 4 and len(p2) == 4 and len(p3) == 1, "每页 4 条, 最后一页 1 条")
check(
    [i["name"] for i in p1] + [i["name"] for i in p2] + [i["name"] for i in p3] == order_all,
    "分页拼起来等于完整列表 (顺序一致)",
)
check(db.list_items(limit=3, offset=100) == [], "越界 offset 返回空")
check(len(db.list_items(category="A", limit=2, offset=0)) == 2, "分类 + 分页可叠加")
check(len(db.list_items(q="n0", limit=2, offset=0)) == 2, "关键字 + 分页可叠加")

print("\n[6] 查重: 走 content_hash 分组")
groups = db.find_duplicates()
check(len(groups) == 3, "内容 0/1/2 各一组, 共 3 组 (%d)" % len(groups))
check(groups[0]["count"] == 3, "最多的那组 3 条 (按条数降序)")
check(
    sorted(i["name"] for i in groups[0]["items"]) == ["n01", "n04", "n07"],
    "组内条目: %s" % ",".join(i["name"] for i in groups[0]["items"]),
)
check(all("category" in i for i in groups[0]["items"]), "组内条目带分类")
check(groups[0]["preview"].startswith("内容"), "预览取内容开头")
check(all(g["count"] >= 2 for g in groups), "单条的不算重复")
check(db.count_duplicate_groups() == 3, "重复组计数一致")

# 归一化: 换行/空白不同也算同一内容
db.save_prompt("norm1", "same body")
db.save_prompt("norm2", "same body\r\n")
db.save_prompt("norm3", "  same body  ")
g2 = [g for g in db.find_duplicates() if g["preview"].strip() == "same body"]
check(len(g2) == 1 and g2[0]["count"] == 3, "换行/首尾空白视为同一内容")
check(db.count_duplicate_groups() == 4, "此时共 4 组重复")

print("\n[7] 查重分页与关键字")
check(len(db.find_duplicates(limit=2, offset=0)) == 2, "limit=2 只取两组")
check(len(db.find_duplicates(limit=2, offset=2)) == 2, "offset=2 取后两组")
check(len(db.find_duplicates(limit=2, offset=9)) == 0, "越界返回空")
check(db.count_duplicate_groups() == 4, "总数仍是 4 组")
dup_q = db.find_duplicates(q="same body")
check(len(dup_q) == 1 and dup_q[0]["count"] == 3, "关键字过滤后再分组")
check(db.count_duplicate_groups(q="same body") == 1, "关键字下的组数一致")

print("\n[8] 空内容不参与查重")
db.save_prompt("e1", "")
db.save_prompt("e2", "   ")
check(db.count_duplicate_groups() == 4, "空内容不会被归为重复组 (仍是 4 组)")

print("\n[9] 接口层: /prompt_manager/all 的查询参数")
sys.path.insert(0, PKG)
spec = importlib.util.spec_from_file_location("pm_plugin", os.path.join(PKG, "__init__.py"))
plugin_mod = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(open(os.devnull, "w")):
    spec.loader.exec_module(plugin_mod)

all_handler = REG[("GET", "/prompt_manager/all")]
dup_handler = REG[("GET", "/prompt_manager/duplicates")]


class FakeRequest:
    def __init__(self, query=None):
        self.query = query or {}


async def call(fn, query):
    return await fn(FakeRequest(query))


res = asyncio.run(call(all_handler, {}))
check(res.payload["ok"] is True and len(res.payload["items"]) == 14, "不带参数返回全部 14 条")
check(res.payload["total"] == 14, "total 字段正确 (%s)" % res.payload["total"])
check(res.payload["has_more"] is False, "不带 limit 时 has_more=False")

res = asyncio.run(call(all_handler, {"limit": "5", "offset": "0"}))
check(len(res.payload["items"]) == 5, "limit=5 生效")
check(res.payload["has_more"] is True, "还有下一页时 has_more=True")
check(res.payload["offset"] == 0 and res.payload["limit"] == 5, "回显 offset/limit")

res = asyncio.run(call(all_handler, {"limit": "5", "offset": "10"}))
check(len(res.payload["items"]) == 4, "最后一页取剩余 4 条")
check(res.payload["has_more"] is False, "最后一页 has_more=False")

res = asyncio.run(call(all_handler, {"q": "same body"}))
check(len(res.payload["items"]) == 3, "q 参数过滤 (3 条)")
res = asyncio.run(call(all_handler, {"category": "A"}))
check(len(res.payload["items"]) == res.payload["total"], "category 参数过滤")

res = asyncio.run(call(all_handler, {"limit": "abc"}))
check(len(res.payload["items"]) == 14, "非法 limit 回落为不限")
res = asyncio.run(call(all_handler, {"offset": "-5"}))
check(res.payload["offset"] == 0, "负 offset 夹到 0")
res = asyncio.run(call(all_handler, {"limit": "99999999"}))
check(res.payload["limit"] == 100000, "超大 limit 有上限, 不会被打爆")

print("\n[10] 接口层: /prompt_manager/duplicates 的查询参数")
res = asyncio.run(call(dup_handler, {}))
check(res.payload["ok"] is True and res.payload["total"] == 4, "total = 重复组数 4")
check(len(res.payload["groups"]) == 4, "默认返回全部组")
res = asyncio.run(call(dup_handler, {"limit": "1", "offset": "0"}))
check(len(res.payload["groups"]) == 1 and res.payload["has_more"] is True, "分页生效")
res = asyncio.run(call(dup_handler, {"limit": "1", "offset": "9"}))
check(len(res.payload["groups"]) == 0 and res.payload["has_more"] is False, "越界页为空")

print("\n[11] /prompt_manager/version (README 里写了但之前没实现)")
ver = REG.get(("GET", "/prompt_manager/version"))
check(ver is not None, "版本路由已注册")
if ver:
    r = asyncio.run(call(ver, {}))
    check(r.payload.get("ok") is True, "version 返回 ok")
    check(
        r.payload.get("version") == plugin_mod.__version__,
        "version 与 __version__ 一致 (%s)" % r.payload.get("version"),
    )

print("\n[12] /prompt_manager/health (数据库自检接口)")
health = REG.get(("GET", "/prompt_manager/health"))
check(health is not None, "health 路由已注册")
if health:
    r = asyncio.run(call(health, {}))
    check(r.payload.get("ok") is True, "health 返回 ok")
    info = r.payload.get("health") or {}
    check(
        os.path.abspath(str(info.get("path", ""))) == os.path.abspath(DB_FILE),
        "带库路径 (%s)" % info.get("path"),
    )
    check(info.get("integrity_ok") is True, "完整性检查通过 (%s)" % info.get("integrity_detail"))
    check(str(info.get("journal_mode", "")).lower() == "wal", "journal_mode = wal")
    check(int(info.get("size", 0)) > 0, "带文件大小 (%s 字节)" % info.get("size"))
    check("backups" in info, "带备份份数")

print()
print("结果: %d 项通过, %d 项失败" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
