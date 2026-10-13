# -*- coding: utf-8 -*-
# schema 版本与有序迁移 (PRAGMA user_version) 的隔离测试
#
# 每次都用 importlib 把 db.py 当成**全新模块**加载 (模块级的「本进程已迁过」标记
# 因此天然隔离), DB_PATH 指向临时库, 不碰真实数据。
# 用法: python pm_schema_test.py
import contextlib
import importlib.util
import os
import shutil
import sqlite3
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DB = os.path.join(ROOT, "db.py")

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


class _Capture:
    def __init__(self):
        self.text = ""

    def write(self, s):
        self.text += s

    def flush(self):
        pass


_n = [0]


def fresh(dbfile):
    """加载一份全新的 db 模块, DB_PATH 指向 dbfile"""
    _n[0] += 1
    plugin = os.path.join(TMP_ROOT, "p%d" % _n[0])
    os.makedirs(plugin, exist_ok=True)
    shutil.copy2(SRC_DB, os.path.join(plugin, "db.py"))
    os.environ["PM_DB_PATH"] = dbfile
    os.environ["PM_BACKUP"] = "0"  # 快照与本测试无关, 关掉免得刷出一堆 .bak
    spec = importlib.util.spec_from_file_location(
        "_pm_schema_%d" % _n[0], os.path.join(plugin, "db.py")
    )
    mod = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(_Capture()):
        spec.loader.exec_module(mod)
    return mod


def cols_of(dbfile, table="prompts"):
    c = sqlite3.connect(dbfile)
    try:
        return {r[1] for r in c.execute("PRAGMA table_info(%s)" % table)}
    finally:
        c.close()


def tables_of(dbfile):
    c = sqlite3.connect(dbfile)
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


def user_version_of(dbfile):
    c = sqlite3.connect(dbfile)
    try:
        return int(c.execute("PRAGMA user_version").fetchone()[0])
    finally:
        c.close()


def make_legacy(dbfile, rows=("legacy1", "legacy2")):
    """造一个 v1.4.34 之前的老库: prompts 没有 category / content_hash,
    pm_categories 没有 sort_order"""
    c = sqlite3.connect(dbfile)
    c.execute(
        """
        CREATE TABLE prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    c.execute(
        """
        CREATE TABLE pm_categories (
            name TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for name in rows:
        c.execute("INSERT INTO prompts(name, text) VALUES(?, ?)", (name, "old prompt"))
    c.commit()
    c.close()


TMP_ROOT = tempfile.mkdtemp(prefix="pm_schema_")

print("=== 场景 1: 全新库 —— 一次建到位, 并盖上版本号 ===")
d1 = os.path.join(TMP_ROOT, "s1.db")
m1 = fresh(d1)
check(user_version_of(d1) == 0, "建库前 user_version = 0")
c1 = m1.get_conn()
check(user_version_of(d1) == m1.SCHEMA_VERSION, f"get_conn 后 user_version = {m1.SCHEMA_VERSION}")
check(
    {"category", "content_hash"} <= cols_of(d1),
    "prompts 含 category / content_hash",
)
check("sort_order" in cols_of(d1, "pm_categories"), "pm_categories 含 sort_order")
c1.close()
check(m1.schema_version() == m1.SCHEMA_VERSION, "schema_version() 读到最新版本号")
m1.save_prompt("a", "hello")
check(m1.load_prompt("a") == "hello", "迁移后读写正常")
check(m1.list_categories() is not None, "分类接口可用")

print()
print("=== 场景 2: 历史库 —— 补齐三列, 老数据一行的都不丢 ===")
d2 = os.path.join(TMP_ROOT, "s2.db")
make_legacy(d2)
check("category" not in cols_of(d2) and "content_hash" not in cols_of(d2), "升级前缺两列")
check("sort_order" not in cols_of(d2, "pm_categories"), "升级前 pm_categories 缺 sort_order")
m2 = fresh(d2)
m2.get_conn().close()  # 触发迁移
check(user_version_of(d2) == m2.SCHEMA_VERSION, "升级后版本号已写入")
check({"category", "content_hash"} <= cols_of(d2), "升级后列已补上")
check("sort_order" in cols_of(d2, "pm_categories"), "升级后 sort_order 已补上")
check(sorted(m2.list_names()) == ["legacy1", "legacy2"], "老数据完好")
check(m2.load_prompt("legacy1") == "old prompt", "老内容可读")
check(
    m2.list_items()[0]["category"] == m2.DEFAULT_CATEGORY,
    "补出来的 category 有默认值",
)
c = sqlite3.connect(d2)
n_null = c.execute("SELECT COUNT(*) FROM prompts WHERE content_hash IS NULL").fetchone()[0]
idx = {r[1] for r in c.execute("PRAGMA index_list(prompts)")}
c.close()
check(n_null == 0, "老行哈希已补算 (无 NULL)")
check("idx_prompts_content_hash" in idx, "哈希索引已建立")

print()
print("=== 场景 3: 已是最新 —— 不重复跑迁移 ===")
m3 = fresh(d2)
calls = []
m3._MIGRATIONS = [(1, lambda conn: calls.append(1))]
conn3 = m3.get_conn()
check(not calls, "结构已是最新, 迁移函数一次都没跑")
check(not m3._needs_migration(conn3), "_needs_migration 返回 False")
conn3.close()
# 同一进程内第二次连接连探测都省了
m3._MIGRATIONS = [(1, lambda conn: calls.append(1))]
m3.get_conn().close()
check(not calls, "本进程已确认过, 后续连接直接跳过")

print()
print("=== 场景 4: 迁移失败要整体回滚 —— 不留半截结构 ===")
d4 = os.path.join(TMP_ROOT, "s4.db")
m4 = fresh(d4)


def boom(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS prompts (id INTEGER)")  # 先干点活
    raise RuntimeError("迁移炸了")


m4._MIGRATIONS = [(1, boom)]
try:
    m4.get_conn().close()
    check(False, "迁移失败应当抛异常")
except Exception as e:
    check(True, f"迁移失败向上抛出 ({type(e).__name__})")
check(user_version_of(d4) == 0, "版本号没被写成最新 (事务整体回滚)")
check("prompts" not in tables_of(d4), "半截的表没有被留下")

print()
print("=== 场景 5: 版本号被别的东西占用, 但结构不全 —— 强制补齐 ===")
d5 = os.path.join(TMP_ROOT, "s5.db")
make_legacy(d5)
c = sqlite3.connect(d5)
c.execute("PRAGMA user_version = 99")
c.close()
check(user_version_of(d5) == 99, "user_version 被设成 99 (比目标大)")
m5 = fresh(d5)
m5.get_conn().close()
check({"category", "content_hash"} <= cols_of(d5), "仍然补齐了缺失的列")
check(user_version_of(d5) == m5.SCHEMA_VERSION, "版本号被拉回目标值")

print()
print("=== 场景 6: 版本号对但表没了 —— 重建 ===")
d6 = os.path.join(TMP_ROOT, "s6.db")
m6 = fresh(d6)
m6.save_prompt("keep", "keep me")
check(user_version_of(d6) == m6.SCHEMA_VERSION, "先建好一个正常的库")
m6b = fresh(d6)
c = sqlite3.connect(d6)
c.execute("DROP TABLE prompts")
c.commit()
c.close()
check("prompts" not in tables_of(d6), "prompts 表被删掉")
m6b.get_conn().close()
check("prompts" in tables_of(d6), "连接时自动重建")

print()
print("=== 场景 7: 自检信息里带上 schema 版本 ===")
h = m1.db_health()
check(h.get("schema_version") == m1.SCHEMA_VERSION, f"db_health 返回 schema_version ({h.get('schema_version')})")
check(h.get("schema_target") == m1.SCHEMA_VERSION, "db_health 返回目标版本号")
check(h.get("schema_ok") is True, "db_health 标记结构已是最新")

print()
print("=" * 60)
print(f"共 {PASSED + FAILED} 项, 失败 {FAILED}")
sys.exit(1 if FAILED else 0)
