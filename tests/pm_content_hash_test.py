# content_hash 列 / 索引 / 老库补算 / 导入判重的隔离测试
# 用法: python pm_content_hash_test.py
import contextlib
import glob
import hashlib
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


TMP_ROOT = tempfile.mkdtemp(prefix="pm_hash_")
_n = [0]


def fresh(dbfile):
    """加载一份全新的 db 模块, DB_PATH 指向 dbfile"""
    _n[0] += 1
    plugin = os.path.join(TMP_ROOT, "p%d" % _n[0])
    os.makedirs(plugin, exist_ok=True)
    shutil.copy2(SRC_DB, os.path.join(plugin, "db.py"))
    sys.modules.pop("folder_paths", None)
    os.environ["PM_DB_PATH"] = dbfile
    os.environ["PM_BACKUP"] = "0"
    spec = importlib.util.spec_from_file_location(
        "_pm_hash_%d" % _n[0], os.path.join(plugin, "db.py")
    )
    mod = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(_Capture()):
        spec.loader.exec_module(mod)
    return mod


def sha1_of(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def row(dbfile, name):
    c = sqlite3.connect(dbfile)
    c.row_factory = sqlite3.Row
    try:
        return dict(c.execute("SELECT * FROM prompts WHERE name = ?", (name,)).fetchone())
    finally:
        c.close()


def cols_of(dbfile):
    c = sqlite3.connect(dbfile)
    try:
        return [r[1] for r in c.execute("PRAGMA table_info(prompts)")]
    finally:
        c.close()


def indexes_of(dbfile):
    c = sqlite3.connect(dbfile)
    try:
        return [r[1] for r in c.execute("PRAGMA index_list(prompts)")]
    finally:
        c.close()


def _all_hashed(dbfile):
    c = sqlite3.connect(dbfile)
    try:
        n = c.execute(
            "SELECT COUNT(*) FROM prompts WHERE content_hash IS NULL"
        ).fetchone()[0]
        return n == 0
    finally:
        c.close()


def _count_text(dbfile, text):
    c = sqlite3.connect(dbfile)
    try:
        return c.execute(
            "SELECT COUNT(*) FROM prompts WHERE text = ?", (text,)
        ).fetchone()[0]
    finally:
        c.close()


print("\n[1] 新库: 保存时写入 content_hash")
d1 = os.path.join(TMP_ROOT, "s1.db")
m1 = fresh(d1)
m1.save_prompt("a", "a cute cat")
m1.save_prompt("b", "a dog")
r_a = row(d1, "a")
r_b = row(d1, "b")
check("content_hash" in cols_of(d1), "content_hash 列存在")
check(r_a["content_hash"] == sha1_of("a cute cat"), "哈希值 = sha1(内容)")
check(r_a["content_hash"] != r_b["content_hash"], "不同内容哈希不同")
check("idx_prompts_content_hash" in indexes_of(d1), "索引已建立")

print("\n[2] 归一化: 换行符 / 首尾空白不影响哈希")
d2 = os.path.join(TMP_ROOT, "s2.db")
m2 = fresh(d2)
m2.save_prompt("lf", "line1\nline2")
m2.save_prompt("crlf", "line1\r\nline2")
m2.save_prompt("pad", "  line1\nline2  ")
h = row(d2, "lf")["content_hash"]
check(row(d2, "crlf")["content_hash"] == h, "CRLF 与 LF 同哈希")
check(row(d2, "pad")["content_hash"] == h, "首尾空白同哈希")
check(h == m2._content_hash("line1\r\nline2 "), "哈希与模块内算法一致")

print("\n[3] 空内容不参与判重")
check(m2._content_hash("") == "" and m2._content_hash("   ") == "", "空文本哈希为空串")

print("\n[4] 覆盖保存后哈希跟着更新")
d4 = os.path.join(TMP_ROOT, "s4.db")
m4 = fresh(d4)
m4.save_prompt("x", "old text")
h_old = row(d4, "x")["content_hash"]
m4.save_prompt("x", "new text")
h_new = row(d4, "x")["content_hash"]
check(h_old != h_new and h_new == sha1_of("new text"), "覆盖后哈希变化")

print("\n[5] 老库升级: 无 content_hash 列的历史行自动补算")
d5 = os.path.join(TMP_ROOT, "s5.db")
c = sqlite3.connect(d5)
c.execute(
    """
    CREATE TABLE prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        category TEXT NOT NULL DEFAULT '默认'
    )
    """
)
c.execute("INSERT INTO prompts(name, text) VALUES('legacy1', 'old prompt')")
c.execute("INSERT INTO prompts(name, text) VALUES('legacy2', 'old prompt')")
c.commit()
c.close()
check("content_hash" not in cols_of(d5), "升级前没有 content_hash 列")
m5 = fresh(d5)
m5.get_conn().close()  # 触发迁移
check("content_hash" in cols_of(d5), "升级后列已补上")
check("idx_prompts_content_hash" in indexes_of(d5), "升级后索引已建立")
check(row(d5, "legacy1")["content_hash"] == sha1_of("old prompt"), "历史行已补算哈希")
check(
    row(d5, "legacy2")["content_hash"] == m5._content_hash("old prompt"),
    "补算结果与新写入一致",
)
check(_all_hashed(d5), "没有遗留 NULL 哈希")

print("\n[6] 升级后判重仍然正确 (补算的哈希参与比较)")
m5.save_prompt("newer", "old prompt")
res = m5.import_data([{"name": "dupcheck", "text": "old prompt"}])
check(res["skipped_content"] == 1 and res["imported"] == 0, "导入时按内容判重命中老数据")

print("\n[7] 导入: 文件内自重复 / 与库中已有内容重复")
d7 = os.path.join(TMP_ROOT, "s7.db")
m7 = fresh(d7)
m7.save_prompt("first", "shared body")
r7 = m7.import_data(
    [
        {"name": "second", "text": "shared body"},
        {"name": "third", "text": "shared body"},
        {"name": "fourth", "text": "unique body"},
    ]
)
check(r7["skipped_content"] == 2, "内容重复的两条被跳过")
check(r7["imported"] == 1, "新内容正常导入")
check(_count_text(d7, "shared body") == 1, "库中只剩一条 shared body")
check(row(d7, "fourth")["content_hash"] == sha1_of("unique body"), "导入的条目也带哈希")

print("\n[8] 备份开关: PM_BACKUP=0 时不产生 .bak")
check(glob.glob(d7 + ".*.bak") == [], "未产生 .bak 文件")

print()
print("结果: %d 项通过, %d 项失败" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
