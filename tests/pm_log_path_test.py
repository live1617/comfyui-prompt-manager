# 错误日志位置解析 / 旧日志迁移 / 大小轮转 的隔离测试
# 把真实 log.py 复制进临时目录再加载, 使 PLUGIN_DIR 指向临时目录,
# 从而模拟「user 目录可用 / 环境变量覆盖 / user 目录不可用 / 从旧版升级」四种场景。
# 用法: python pm_log_path_test.py
import contextlib
import importlib.util
import os
import shutil
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_LOG = os.path.join(ROOT, "log.py")
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


def _fake_folder_paths(user):
    fm = types.ModuleType("folder_paths")
    fm.get_user_directory = lambda: user
    sys.modules["folder_paths"] = fm


def load_mod(plugin_dir, filename, fake_user=None, env_name=None, env_value=None):
    """从 plugin_dir 加载一份 log.py / db.py, 返回 (模块, 控制台输出)"""
    shutil.copy2(SRC_LOG if filename == "log.py" else SRC_DB, os.path.join(plugin_dir, filename))
    old_env = os.environ.get(env_name) if env_name else None
    if fake_user:
        _fake_folder_paths(fake_user)
    else:
        sys.modules.pop("folder_paths", None)
    if env_name:
        if env_value is None:
            os.environ.pop(env_name, None)
        else:
            os.environ[env_name] = env_value
    try:
        _n[0] += 1
        spec = importlib.util.spec_from_file_location(
            f"_pm_{filename.replace('.', '_')}_under_test_{_n[0]}",
            os.path.join(plugin_dir, filename),
        )
        mod = importlib.util.module_from_spec(spec)
        cap = _Capture()
        with contextlib.redirect_stdout(cap):
            spec.loader.exec_module(mod)
        return mod, cap.text
    finally:
        if env_name:
            if old_env is None:
                os.environ.pop(env_name, None)
            else:
                os.environ[env_name] = old_env


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def size(path):
    return os.path.getsize(path) if os.path.isfile(path) else -1


def new_dirs(prefix):
    tmp = tempfile.mkdtemp(prefix=prefix)
    plugin = os.path.join(tmp, "custom_nodes", "comfyui-prompt-manager")
    user = os.path.join(tmp, "user", "default")
    os.makedirs(plugin)
    os.makedirs(user)
    return plugin, user


print("=== 场景 1: user 目录可用 (默认位置) ===")
plugin, user = new_dirs("pm_logpath_new_")
mod, out = load_mod(plugin, "log.py", fake_user=user)
expect = os.path.join(user, "comfyui-prompt-manager", "prompt_manager_error.log")
check(mod.LOG_PATH == expect, f"日志落在 user 目录下\n         {mod.LOG_PATH}")
check(os.path.isdir(os.path.dirname(expect)), "自动创建了子目录")
check(not os.path.exists(expect), "尚未真正建日志文件")
check(out.strip() == "", "没有旧日志时不打印迁移信息")
check(mod.LEGACY_LOG_PATH == os.path.join(plugin, "prompt_manager_error.log"), "旧位置已知 (插件目录)")

print()
print("=== 场景 2: 环境变量 PM_LOG_PATH 优先级最高 ===")
plugin, user = new_dirs("pm_logpath_env_")
custom = os.path.join(os.path.dirname(plugin), "my_logs", "pm.log")
mod, out = load_mod(plugin, "log.py", fake_user=user, env_name="PM_LOG_PATH", env_value=custom)
check(mod.LOG_PATH == os.path.abspath(custom), f"环境变量生效\n         {mod.LOG_PATH}")
check(os.path.isdir(os.path.dirname(os.path.abspath(custom))), "环境变量指定的目录会自动创建")

print()
print("=== 场景 3: user 目录不可用 → 回退插件目录 ===")
tmp = tempfile.mkdtemp(prefix="pm_logpath_fallback_")
plugin3 = os.path.join(tmp, "custom_nodes", "comfyui-prompt-manager")
os.makedirs(plugin3)
mod, out = load_mod(plugin3, "log.py", fake_user=None)
check(
    mod.LOG_PATH == os.path.join(plugin3, "prompt_manager_error.log"),
    f"回退到插件目录 (旧行为)\n         {mod.LOG_PATH}",
)
check(out.strip() == "", "回退场景下不做迁移, 也不打印提示")

print()
print("=== 场景 4: 与 db.py 的位置规则保持一致 ===")
plugin, user = new_dirs("pm_logpath_db_")
log_mod, _ = load_mod(plugin, "log.py", fake_user=user)
db_mod, _ = load_mod(plugin, "db.py", fake_user=user)
check(
    os.path.dirname(log_mod.LOG_PATH) == os.path.dirname(db_mod.DB_PATH),
    f"日志与数据库同目录\n         log={log_mod.LOG_PATH}\n         db ={db_mod.DB_PATH}",
)
check(log_mod.user_data_dir() == db_mod._user_data_dir(), "两边解析出的 user 目录相同")

print()
print("=== 场景 5: 从旧版升级 (插件目录里已有旧日志) ===")
plugin5, user5 = new_dirs("pm_logpath_mig_")
legacy = os.path.join(plugin5, "prompt_manager_error.log")
with open(legacy, "w", encoding="utf-8") as f:
    f.write("SHFileOperationW 返回 2 但文件已移走\n旧日志第二行\n")
mod5, out5 = load_mod(plugin5, "log.py", fake_user=user5)
new_path = os.path.join(user5, "comfyui-prompt-manager", "prompt_manager_error.log")
check(mod5.LOG_PATH == new_path, "迁移后使用 user 目录位置")
check(os.path.isfile(new_path), "新位置生成了日志文件")
check("旧日志第二行" in read(new_path), "旧日志内容已并入新文件")
check(not os.path.isfile(legacy), "插件目录里的旧日志已改名 (不再占用原名)")
check(os.path.isfile(legacy + ".migrated"), "旧日志以 .migrated 保留")
check("[PromptManager]" in out5 and "迁移" in out5, f"打印了迁移提示\n         {out5.strip()[:60]}")

# 模拟第二次启动: 不允许重复追加旧内容
before = size(new_path)
mod5b, out5b = load_mod(plugin5, "log.py", fake_user=user5)
check(size(new_path) == before, "重启后不会重复追加旧日志内容")
check(out5b.strip() == "", "重启后不再打印迁移提示 (旧文件已改名)")

print()
print("=== 场景 6: 超过上限自动轮转 (只保留一份 .1) ===")
plugin6, user6 = new_dirs("pm_logpath_rot_")
mod6, _ = load_mod(plugin6, "log.py", fake_user=user6)
p = mod6.LOG_PATH
for i in range(5):
    mod6.log_error(f"第 {i} 行" * 20, max_bytes=200)
check(os.path.isfile(p), "主日志文件存在")
check(os.path.isfile(p + ".1"), "超限后生成了 .1 备份")
check(size(p) < 200, f"轮转后主文件重新计数 (当前 {size(p)} 字节)")
check(size(p + ".1") >= 200, f".1 里保留了轮转前的内容 ({size(p + '.1')} 字节)")
mod6.log_error("再写一行", max_bytes=1)
check(size(p + ".1") < 200 + 200, "第二次轮转覆盖了旧的 .1 (不是无限堆积)")
check(
    len([f for f in os.listdir(os.path.dirname(p)) if f.startswith("prompt_manager_error.log")]) == 2,
    "日志目录里只有主文件 + 一份 .1",
)

print()
print("=== 场景 7: 写入失败必须静默 (不能影响主流程) ===")
plugin7, user7 = new_dirs("pm_logpath_fail_")
mod7, _ = load_mod(plugin7, "log.py", fake_user=user7)
bad = os.path.join(plugin7, "no_such_drive", "\0invalid", "x.log")
try:
    mod7.log_error("这条写不进去", log_path=bad)
    ok = True
except Exception as e:  # noqa: BLE001
    ok = False
    print("        异常:", e)
check(ok, "非法路径下不抛异常")

print()
print("=== 场景 8: 目录被手工删掉后能自愈 ===")
plugin8, user8 = new_dirs("pm_logpath_heal_")
mod8, _ = load_mod(plugin8, "log.py", fake_user=user8)
p8 = mod8.LOG_PATH
shutil.rmtree(os.path.dirname(p8))
check(not os.path.isdir(os.path.dirname(p8)), "先删掉日志目录")
mod8.log_error("目录重建测试")
check(os.path.isfile(p8), "log_error 自动重建目录并写入")

print()
print("=" * 60)
print(f"共 {PASSED + FAILED} 项, 失败 {FAILED}")
sys.exit(1 if FAILED else 0)
