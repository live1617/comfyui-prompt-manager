# 数据库 WAL 模式 / 连接参数 / 完整性巡检 / WAL 下的备份与迁移 的隔离测试
# 直接用 PM_DB_PATH 指向临时库来加载真实的 db.py (db.py 只依赖标准库, 无需假模块)。
# 用法: python pm_db_wal_test.py
import contextlib
import importlib.util
import os
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


def load_db(path):
    """让 db.py 的 DB_PATH 指向 path 并加载它"""
    old = os.environ.get("PM_DB_PATH")
    os.environ["PM_DB_PATH"] = path
    try:
        _n[0] += 1
        spec = importlib.util.spec_from_file_location(f"_pm_db_wal_{_n[0]}", SRC_DB)
        mod = importlib.util.module_from_spec(spec)
        with contextlib.redirect_stdout(_Capture()):
            spec.loader.exec_module(mod)
        return mod
    finally:
        if old is None:
            os.environ.pop("PM_DB_PATH", None)
        else:
            os.environ["PM_DB_PATH"] = old


def pragma(conn, name):
    return conn.execute(f"PRAGMA {name}").fetchone()[0]


TMP = tempfile.mkdtemp(prefix="pm_db_wal_")

print("=== 场景 1: 全新库的连接参数 ===")
new_db = os.path.join(TMP, "new.db")
mod = load_db(new_db)
conn = mod.get_conn()
check(str(pragma(conn, "journal_mode")).lower() == "wal", "journal_mode = WAL")
check(int(pragma(conn, "busy_timeout")) == mod.DB_BUSY_TIMEOUT_MS, f"busy_timeout = {mod.DB_BUSY_TIMEOUT_MS}")
check(int(pragma(conn, "synchronous")) == 1, "synchronous = NORMAL (1)")
check(str(pragma(conn, "temp_store")).lower() in ("2", "memory"), "temp_store = MEMORY")
conn.close()
check(os.path.isfile(new_db), "库文件已创建")

print()
print("=== 场景 2: 老库 (非 WAL) 首次打开自动切到 WAL 且数据保留 ===")
legacy = os.path.join(TMP, "legacy.db")
c = sqlite3.connect(legacy)
c.execute("PRAGMA journal_mode=DELETE")
c.execute(
    """CREATE TABLE prompts (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT UNIQUE NOT NULL, text TEXT NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"""
)
c.execute("INSERT INTO prompts(name, text) VALUES('老词', 'OLD TEXT')")
c.commit()
c.close()
check(
    sqlite3.connect(legacy).execute("PRAGMA journal_mode").fetchone()[0].lower() == "delete",
    "老库原本不是 WAL",
)
mod2 = load_db(legacy)
conn2 = mod2.get_conn()
check(str(pragma(conn2, "journal_mode")).lower() == "wal", "打开后自动切成 WAL")
conn2.close()
check("老词" in mod2.list_names(), "老库数据完好")
check(mod2.load_prompt("老词") == "OLD TEXT", "老库内容可读")

print()
print("=== 场景 3: WAL 下读写往返正常 ===")
db3 = os.path.join(TMP, "rw.db")
mod3 = load_db(db3)
mod3.save_prompt("新词", "NEW TEXT", "测试分类")
check(mod3.load_prompt("新词") == "NEW TEXT", "写入后能读回")
check("新词" in mod3.list_names(), "list_names 能看到")
items = mod3.list_items()
check(any(i["name"] == "新词" for i in items), "list_items 能看到")

print()
print("=== 场景 4: WAL 模式下自动备份依然拿到完整内容 ===")
mod3._backup_last_ts = 0.0  # 绕开 60 秒节流, 让下一次写真的产生快照
mod3.save_prompt("第二个词", "SECOND", "测试分类")
import glob as _glob

baks = sorted(_glob.glob(db3 + ".*.bak"))
check(len(baks) >= 1, f"产生了快照文件 ({len(baks)} 份)")
if baks:
    bconn = sqlite3.connect(baks[-1])
    try:
        names = [r[0] for r in bconn.execute("SELECT name FROM prompts")]
        mode = bconn.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        bconn.close()
    check("新词" in names, "快照里含写操作之前的内容 (新词)")
    check("第二个词" not in names, "快照不含本次写入 (确实是写前状态)")
    check(mode.lower() != "", f"快照可正常打开 (journal_mode={mode})")

print()
print("=== 场景 5: 完整性巡检 ===")
ok, detail = mod3.check_integrity()
check(ok is True and detail.strip().lower() == "ok", f"quick_check 通过 ({detail})")
ok_full, detail_full = mod3.check_integrity(full=True)
check(ok_full is True, f"integrity_check 也通过 ({detail_full[:40]})")

bad = os.path.join(TMP, "not_a_db.db")
with open(bad, "wb") as f:
    f.write(b"this is definitely not a sqlite database file" * 100)
mod_bad = load_db(bad)
ok_bad, detail_bad = mod_bad.check_integrity()
check(ok_bad is False, f"损坏文件被识别出来 ({detail_bad[:46]})")
h_bad = mod_bad.db_health()
check("error" in h_bad, "db_health 记录了错误")

print()
print("=== 场景 6: db_health 自检信息 ===")
h = mod3.db_health()
check(h["path"] == db3, "返回库路径")
check(h["exists"] is True and h["size"] > 0, f"返回文件大小 ({h['size']} 字节)")
check(str(h["journal_mode"]).lower() == "wal", "返回 journal_mode")
check(h["backups"] >= 1, f"返回备份份数 ({h['backups']})")

print()
print("=== 场景 7: 迁移旧库时 -wal 里未合并的数据不能丢 ===")
src = os.path.join(TMP, "wal_src.db")
c = sqlite3.connect(src)
c.execute("PRAGMA journal_mode=WAL")
c.execute("CREATE TABLE prompts(id INTEGER PRIMARY KEY, name TEXT, text TEXT)")
c.execute("INSERT INTO prompts(name, text) VALUES('w', 'WAL 里还没合并的数据')")
c.commit()
check(os.path.isfile(src + "-wal"), "源库带有 -wal 附属文件 (数据尚未合并)")
dst = os.path.join(TMP, "wal_dst.db")
mod3._migrate_copy(src, dst)
c.close()
n = sqlite3.connect(dst).execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
row = sqlite3.connect(dst).execute("SELECT text FROM prompts").fetchone()
check(n == 1 and row and "WAL 里还没合并" in row[0], "迁移后数据完整 (用 backup API 而非复制文件)")

plain = os.path.join(TMP, "plain.db")
c = sqlite3.connect(plain)
c.execute("CREATE TABLE t(x)")
c.execute("INSERT INTO t VALUES(42)")
c.commit()
c.close()
dst2 = os.path.join(TMP, "plain_dst.db")
mod3._migrate_copy(plain, dst2)
v = sqlite3.connect(dst2).execute("SELECT x FROM t").fetchone()[0]
check(v == 42, "普通库 (无 -wal) 走文件复制, 内容正确")

print()
print("=" * 60)
print(f"共 {PASSED + FAILED} 项, 失败 {FAILED}")
sys.exit(1 if FAILED else 0)
