# 数据库自动备份的隔离测试
# 覆盖: 建库前不备份 / 快照是「写之前」的状态 / 节流 / 数量轮转 /
#       环境变量关闭 / 各类写操作都触发 / 快照本身是有效 sqlite
# 用法: python pm_db_backup_test.py
import contextlib
import glob
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
_cnt = [0]
TMP_ROOT = tempfile.mkdtemp(prefix="pm_backup_")


def fresh(dbfile, extra_env=None):
    """加载一份全新的 db 模块, DB_PATH 指向 dbfile"""
    _cnt[0] += 1
    plugin = os.path.join(TMP_ROOT, "p%d" % _cnt[0], "custom_nodes", "pm")
    os.makedirs(plugin, exist_ok=True)
    shutil.copy2(SRC_DB, os.path.join(plugin, "db.py"))
    sys.modules.pop("folder_paths", None)
    os.environ["PM_DB_PATH"] = dbfile
    os.environ.pop("PM_BACKUP", None)
    if extra_env:
        for k, v in extra_env.items():
            os.environ[k] = v
    _n[0] += 1
    spec = importlib.util.spec_from_file_location(
        "_pm_bk_%d" % _n[0], os.path.join(plugin, "db.py")
    )
    mod = importlib.util.module_from_spec(spec)
    cap = _Capture()
    with contextlib.redirect_stdout(cap):
        spec.loader.exec_module(mod)
    return mod


def baks(dbfile):
    return sorted(glob.glob(dbfile + ".*.bak"))


def names_in(dbfile):
    if not os.path.isfile(dbfile):
        return []
    c = sqlite3.connect(dbfile)
    try:
        return [r[0] for r in c.execute("SELECT name FROM prompts ORDER BY name")]
    finally:
        c.close()


print("=== 场景 1: 库还不存在时不产生快照 ===")
d1 = os.path.join(TMP_ROOT, "s1.db")
m1 = fresh(d1)
m1.save_prompt("prompt_0001", "第一条")
check(len(baks(d1)) == 0, "首次保存(建库)不留快照, 实际 %d 份" % len(baks(d1)))
check(os.path.isfile(d1), "主库已建立")

print()
print("=== 场景 2: 快照是「写操作之前」的状态 (核心价值) ===")
d2 = os.path.join(TMP_ROOT, "s2.db")
m2 = fresh(d2)
m2.save_prompt("old_1", "宝贵的第一版")
check(names_in(d2) == ["old_1"], "库里有 old_1")
m2._backup_last_ts = 0  # 跳过节流, 强制备份
m2.save_prompt("old_1", "被覆盖后的新版本")  # 同名覆盖, 高危操作
snaps = baks(d2)
check(len(snaps) == 1, "覆盖保存前留了 1 份快照, 实际 %d 份" % len(snaps))
check(names_in(d2) == ["old_1"], "覆盖后主库仍只有一条")
if snaps:
    c = sqlite3.connect(snaps[0])
    bak_text = c.execute("SELECT text FROM prompts WHERE name='old_1'").fetchone()[0]
    c.close()
    check(bak_text == "宝贵的第一版", "快照里保留的是覆盖前的内容")

print()
print("=== 场景 3: 节流 (60 秒内不重复备份) ===")
d3 = os.path.join(TMP_ROOT, "s3.db")
m3 = fresh(d3)
m3.save_prompt("a", "1")
m3._backup_last_ts = 0
m3.save_prompt("b", "2")
after_first = len(baks(d3))
m3.save_prompt("c", "3")  # 紧接着再写, 应被节流
m3.save_prompt("d", "4")
check(len(baks(d3)) == after_first, "短时间连续写不刷屏: 仍为 %d 份" % len(baks(d3)))
m3._backup_last_ts = 0
m3.save_prompt("e", "5")
check(len(baks(d3)) == after_first + 1, "间隔够了再来一份: %d 份" % len(baks(d3)))

print()
print("=== 场景 4: 数量轮转, 只留最近 N 份 ===")
d4 = os.path.join(TMP_ROOT, "s4.db")
m4 = fresh(d4)
m4.BACKUP_KEEP = 3
for i in range(6):
    m4._backup_last_ts = 0
    m4.save_prompt("p%d" % i, str(i))
got = baks(d4)
check(len(got) == 3, "超过上限自动清理, 剩 %d 份" % len(got))
if len(got) == 3:
    # 剩下的应该是最新的 3 份: 内容里的条目数应当递增到最新状态
    counts = []
    for f in got:
        c = sqlite3.connect(f)
        counts.append(c.execute("SELECT COUNT(*) FROM prompts").fetchone()[0])
        c.close()
    check(counts == sorted(counts), "保留的是按时间排序的最近几份")
    check(counts[-1] >= 4, "最新的快照已包含大部分条目 (%s)" % counts)

print()
print("=== 场景 5: PM_BACKUP=0 可关闭 ===")
d5 = os.path.join(TMP_ROOT, "s5.db")
m5 = fresh(d5, extra_env={"PM_BACKUP": "0"})
m5.save_prompt("x", "1")
for i in range(3):
    m5._backup_last_ts = 0
    m5.save_prompt("x%d" % i, str(i))
check(len(baks(d5)) == 0, "关闭后不产生任何快照")
check(names_in(d5) != [], "关闭备份不影响正常读写")

print()
print("=== 场景 6: 各类写操作都会触发快照 ===")
d6 = os.path.join(TMP_ROOT, "s6.db")
m6 = fresh(d6)
m6.save_prompt("alpha", "内容 A")
m6.save_prompt("beta", "内容 B")
cases = [
    ("保存", lambda: m6.save_prompt("gamma", "内容 C")),
    ("改名", lambda: m6.rename_prompt("gamma", "gamma2")),
    ("移动分类", lambda: m6.move_prompt("beta", "人物")),
    ("删除单条", lambda: m6.delete_prompt("alpha")),
    ("批量删除", lambda: m6.delete_prompts(["gamma2"])),
    ("新建分类", lambda: m6.add_category("风景")),
    ("导入", lambda: m6.import_data([{"name": "imp1", "text": "导入的内容"}])),
]
ok = True
for label, fn in cases:
    n0 = len(baks(d6))
    m6._backup_last_ts = 0
    try:
        fn()
    except Exception as e:
        check(False, "%s 抛异常: %s" % (label, e))
        ok = False
        continue
    n1 = len(baks(d6))
    if n1 != n0 + 1:
        check(False, "%s 未触发快照 (%d -> %d)" % (label, n0, n1))
        ok = False
if ok:
    check(True, "7 类写操作各触发一次快照, 共 %d 份" % len(baks(d6)))

print()
print("=== 场景 7: 快照是有效可用的 sqlite 文件 ===")
snaps = baks(d6)
if snaps:
    c = sqlite3.connect(snaps[-1])
    c.execute("PRAGMA integrity_check").fetchone()[0]
    integrity = c.execute("PRAGMA integrity_check").fetchone()[0]
    tbl = c.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
    ).fetchone()[0]
    c.close()
    check(integrity == "ok", "快照通过 integrity_check")
    check(tbl >= 2, "快照含完整表结构 (%d 张表)" % tbl)
    check(snaps[-1].endswith(".bak"), "快照文件名后缀为 .bak")
    check(".bak" in snaps[-1] and not snaps[-1].endswith("db"), "不会与主库混淆")

print()
print("结果: %d 项通过, %d 项失败" % (PASSED, FAILED))
sys.exit(1 if FAILED else 0)
