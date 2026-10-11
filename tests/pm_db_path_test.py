# 数据库路径解析 (含升级自动迁移) 的隔离测试
# 把真实 db.py 复制进临时目录再加载, 使 PLUGIN_DIR 指向临时目录,
# 从而模拟「全新安装 / 旧版升级 / user 目录不可用 / 环境变量覆盖」四种场景。
# 用法: python pm_db_path_test.py
import contextlib
import importlib.util
import os
import shutil
import sqlite3
import sys
import tempfile
import types

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


def load_db(plugin_dir, fake_user=None, env=None):
    """从 plugin_dir 加载一份 db.py, 返回 (模块, 控制台输出)"""
    shutil.copy2(SRC_DB, os.path.join(plugin_dir, "db.py"))
    old_env = os.environ.get("PM_DB_PATH")
    had_fake = "folder_paths" in sys.modules

    if fake_user:
        fm = types.ModuleType("folder_paths")
        fm.get_user_directory = lambda: fake_user
        sys.modules["folder_paths"] = fm
    else:
        sys.modules.pop("folder_paths", None)

    if env is not None:
        os.environ["PM_DB_PATH"] = env
    else:
        os.environ.pop("PM_DB_PATH", None)

    try:
        _n[0] += 1
        spec = importlib.util.spec_from_file_location(
            f"_pm_db_under_test_{_n[0]}", os.path.join(plugin_dir, "db.py")
        )
        mod = importlib.util.module_from_spec(spec)
        cap = _Capture()
        with contextlib.redirect_stdout(cap):
            spec.loader.exec_module(mod)
        return mod, cap.text
    finally:
        if old_env is None:
            os.environ.pop("PM_DB_PATH", None)
        else:
            os.environ["PM_DB_PATH"] = old_env
        if had_fake:
            pass  # 本脚本里 folder_paths 始终是注入的假模块, 无需还原


def make_legacy_db(path, rows):
    """造一个旧版样式的数据库 (插件目录里)"""
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE prompts (id INTEGER PRIMARY KEY, name TEXT, text TEXT)")
    conn.executemany("INSERT INTO prompts(name, text) VALUES(?, ?)", rows)
    conn.commit()
    rows_n = conn.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
    conn.close()
    return rows_n


print("=== 场景 1: 全新安装 (user 目录可用, 无旧库) ===")
tmp = tempfile.mkdtemp(prefix="pm_dbpath_new_")
plugin = os.path.join(tmp, "custom_nodes", "comfyui-prompt-manager")
user = os.path.join(tmp, "user", "default")
os.makedirs(plugin)
os.makedirs(user)
mod, log = load_db(plugin, fake_user=user)
expect = os.path.join(user, "comfyui-prompt-manager", "prompt_manager.db")
check(mod.DB_PATH == expect, f"数据库路径落在 user 目录下\n         {mod.DB_PATH}")
check(os.path.isdir(os.path.dirname(expect)), "自动创建了子目录")
check(not os.path.exists(expect), "尚未真正建库 (不在 import 时就连接数据库)")
check(log.strip() == "", "无旧库时不打印迁移信息")

print()
print("=== 场景 2: 旧版升级 (插件目录里有旧库) ===")
tmp2 = tempfile.mkdtemp(prefix="pm_dbpath_mig_")
plugin2 = os.path.join(tmp2, "custom_nodes", "comfyui-prompt-manager")
user2 = os.path.join(tmp2, "user", "default")
os.makedirs(plugin2)
os.makedirs(user2)
legacy = os.path.join(plugin2, "prompt_manager.db")
make_legacy_db(legacy, [("prompt_0001", "一只猫, 高质量"), ("prompt_0002", "赛博朋克城市")])
check(mod.LEGACY_DB_PATH != mod.DB_PATH, "迁移后不再使用插件目录路径")
mod2, log2 = load_db(plugin2, fake_user=user2)
new_db = os.path.join(user2, "comfyui-prompt-manager", "prompt_manager.db")
check(mod2.DB_PATH == new_db, f"数据库路径指向新位置\n         {mod2.DB_PATH}")
check(os.path.isfile(new_db), "旧库已自动迁移到新位置")
check(os.path.isfile(legacy), "插件目录里的旧库保留未删 (天然备份)")
if os.path.isfile(new_db):
    conn = sqlite3.connect(new_db)
    n = conn.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
    row = conn.execute("SELECT text FROM prompts WHERE name='prompt_0001'").fetchone()[0]
    conn.close()
    check(n == 2, f"新库条目数一致 ({n}/2)")
    check(row == "一只猫, 高质量", "新库内容一致")
check("已迁移到" in log2, "控制台输出了迁移提示")

print()
print("=== 场景 3: user 目录不可用 ===")
tmp3 = tempfile.mkdtemp(prefix="pm_dbpath_fb_")
plugin3 = os.path.join(tmp3, "custom_nodes", "comfyui-prompt-manager")
os.makedirs(plugin3)
# 不注入 folder_paths, 且往上两级没有 user/default → 两条路都走不通
mod3, _ = load_db(plugin3, fake_user=None)
check(mod3.DB_PATH == mod3.LEGACY_DB_PATH, f"回退到插件目录 (旧行为)\n         {mod3.DB_PATH}")

print()
print("=== 场景 4: folder_paths 抛异常但有 user/default ===")
tmp4 = tempfile.mkdtemp(prefix="pm_dbpath_userdf_")
plugin4 = os.path.join(tmp4, "ComfyUI", "custom_nodes", "comfyui-prompt-manager")
user4 = os.path.join(tmp4, "ComfyUI", "user", "default")
os.makedirs(plugin4)
os.makedirs(user4)
mod4, _ = load_db(plugin4, fake_user=None)  # folder_paths 未注入 → import 失败
expect4 = os.path.join(user4, "comfyui-prompt-manager", "prompt_manager.db")
check(mod4.DB_PATH == expect4, f"按插件位置推算出 user/default\n         {mod4.DB_PATH}")

print()
print("=== 场景 5: 环境变量 PM_DB_PATH 优先 ===")
tmp5 = tempfile.mkdtemp(prefix="pm_dbpath_env_")
plugin5 = os.path.join(tmp5, "custom_nodes", "comfyui-prompt-manager")
user5 = os.path.join(tmp5, "user", "default")
os.makedirs(plugin5)
os.makedirs(user5)
custom = os.path.join(tmp5, "my_data", "pm.db")
mod5, _ = load_db(plugin5, fake_user=user5, env=custom)
check(mod5.DB_PATH == os.path.abspath(custom), f"环境变量指定的路径优先\n         {mod5.DB_PATH}")

print()
print(f"结果: {PASSED} 项通过, {FAILED} 项失败")
sys.exit(1 if FAILED else 0)
