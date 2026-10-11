# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 comfyui-prompt-manager contributors
"""错误日志: 位置解析 + 写入 + 大小上限轮转

位置规则与 db.py 完全一致 —— 都不放在插件安装目录里。
原因: 更新插件最常见的做法是「删掉旧文件夹、解压新版」, 放在安装目录里的东西会被一起删掉。

规则 (优先级从高到低):
  1. 环境变量 PM_LOG_PATH (便于自定义位置与单元测试)
  2. <ComfyUI user 目录>/comfyui-prompt-manager/prompt_manager_error.log
  3. 都不可用 → 退回插件目录 (旧行为), 保证插件不会因为日志而挂

写日志永远不能影响主流程: 任何异常一律吞掉。
"""
import os

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))

LOG_FILENAME = "prompt_manager_error.log"
LOG_SUBDIR = "comfyui-prompt-manager"  # 与 db.py 的 DB_SUBDIR 保持一致
LOG_MAX_BYTES = 1024 * 1024  # 超过 1MB 就轮转, 只保留一份 .1

LEGACY_LOG_PATH = os.path.join(PLUGIN_DIR, LOG_FILENAME)


def user_data_dir():
    """取 ComfyUI 的 user 数据目录; 取不到返回 None

    与 db.py 的 _user_data_dir 同款实现 (两处都要用, 故各留一份;
    tests/pm_log_path_test.py 会断言两者在同一环境下结果一致)。
    """
    try:
        import folder_paths

        p = folder_paths.get_user_directory()
        if p and os.path.isdir(p):
            return p
    except Exception:
        pass
    # 回退: 插件在 ComfyUI/custom_nodes/<本插件>, 往上两级是 ComfyUI 根目录
    try:
        base = os.path.dirname(os.path.dirname(PLUGIN_DIR))
        p = os.path.join(base, "user", "default")
        if os.path.isdir(p):
            return p
    except Exception:
        pass
    return None


def resolve_log_path() -> str:
    env = (os.environ.get("PM_LOG_PATH") or "").strip()
    if env:
        path = os.path.abspath(env)
        try:
            d = os.path.dirname(path)
            if d:
                os.makedirs(d, exist_ok=True)
        except Exception:
            pass
        return path
    try:
        base = user_data_dir()
        if base:
            target_dir = os.path.join(base, LOG_SUBDIR)
            os.makedirs(target_dir, exist_ok=True)
            return os.path.join(target_dir, LOG_FILENAME)
    except Exception:
        pass
    return LEGACY_LOG_PATH


def migrate_legacy(log_path: str) -> str:
    """把插件目录里的旧日志并入新位置; 返回给用户看的提示 (无事可做返回 "")

    旧文件改名成 .migrated 而不是删除: 内容已并入新文件, 保留原件以防万一,
    同时避免每次启动重复追加。
    """
    try:
        if os.path.abspath(log_path) == os.path.abspath(LEGACY_LOG_PATH):
            return ""
        if not os.path.isfile(LEGACY_LOG_PATH):
            return ""
        with open(LEGACY_LOG_PATH, "r", encoding="utf-8", errors="replace") as src:
            content = src.read()
        if content:
            with open(log_path, "a", encoding="utf-8") as dst:
                dst.write(content)
        os.replace(LEGACY_LOG_PATH, LEGACY_LOG_PATH + ".migrated")
        return (
            f"错误日志已迁移到 {log_path}\n"
            f"[PromptManager] 插件目录里的旧日志已改名为 {LOG_FILENAME}.migrated, 确认无误后可手工删除"
        )
    except Exception:
        return ""


def rotate_if_needed(log_path: str, max_bytes: int = LOG_MAX_BYTES) -> bool:
    """超过上限就把当前文件改名成 .1 (只保留一份备份); 是否发生了轮转"""
    try:
        if not os.path.isfile(log_path):
            return False
        if os.path.getsize(log_path) < max_bytes:
            return False
        bak = log_path + ".1"
        try:
            if os.path.exists(bak):
                os.remove(bak)
            os.replace(log_path, bak)
        except Exception:
            pass
        return True
    except Exception:
        return False


def log_error(
    text: str,
    log_path: str = None,
    to_console: bool = True,
    max_bytes: int = None,
) -> None:
    """写一行错误日志: 控制台 + 文件 (文件写失败静默)

    max_bytes 只给测试用 (默认取模块级 LOG_MAX_BYTES, 1MB)。
    """
    if to_console:
        print(f"[PromptManager] {text}")
    path = log_path or LOG_PATH
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)  # 目录可能被用户手工删掉
    except Exception:
        pass
    rotate_if_needed(path, max_bytes if max_bytes else LOG_MAX_BYTES)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass


LOG_PATH = resolve_log_path()

_MIGRATE_HINT = migrate_legacy(LOG_PATH)
if _MIGRATE_HINT:
    print(f"[PromptManager] {_MIGRATE_HINT}")
