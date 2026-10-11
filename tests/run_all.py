# -*- coding: utf-8 -*-
"""一键跑齐 comfyui-prompt-manager 的全部测试

    python tests/run_all.py

本机与 CI 用同一入口, 任一测试失败就退出码 1。
缺依赖的测试项会跳过并打印原因 (不会因为环境差异误判为失败)。
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Windows 的 stdout 默认跟系统区域走 (英文环境是 cp1252), 而各测试脚本里满是中文和 ✅,
# 直接 print 会抛 UnicodeEncodeError。把自己和子进程都钉成 UTF-8。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CHILD_ENV = dict(os.environ)
# 必须强制覆盖: 外部若已有 PYTHONIOENCODING=cp1252 (英文 Windows 的默认区域) 子进程仍会崩,
# 测试输出的编码要确定, 不能跟着环境飘
CHILD_ENV["PYTHONIOENCODING"] = "utf-8"

PY = sys.executable
# Windows 上 node 装完叫 node.exe, which("node") 有时找不到
NODE = shutil.which("node") or shutil.which("node.exe")

PY_TESTS = [
    ("版本号一致性", "check_version.py", None),
    ("错误日志路径 / 迁移 / 轮转", "pm_log_path_test.py", None),
    ("数据库路径解析", "pm_db_path_test.py", None),
    ("数据库 WAL / 完整性巡检", "pm_db_wal_test.py", None),
    ("数据库自动备份", "pm_db_backup_test.py", None),
    ("内容指纹 content_hash", "pm_content_hash_test.py", None),
    ("列表分页 / 查重分组", "pm_paging_test.py", None),
    ("后端路由 / 回收站", "pm_backend_trash_test.py", None),
    ("元数据提取 (需 pillow)", "pm_meta_workflow_test.py", "PIL"),
]

JS_TESTS = [
    ("前端模块体检 (import/export 对账)", "pm_modules_check.js"),
    ("前端 vm 桩测试", "pm_vm_test.js"),
    ("浮层关闭行为", "pm_mini_blank_test.js"),
]


def run(name, cmd, cwd=HERE):
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=300, env=CHILD_ENV)
    except subprocess.TimeoutExpired:
        print(f"\n[超时] {name}")
        return False
    out = p.stdout.decode("utf-8", "replace")
    tail = out.strip().splitlines()[-1] if out.strip() else ""
    dt = time.time() - t0
    ok = p.returncode == 0
    print(f"\n{'=' * 60}\n{'✅' if ok else '❌'} {name}  ({dt:.1f}s)   {tail}")
    if not ok:
        # 失败时把完整输出打出来, 便于直接在日志里定位
        print(out[-4000:])
    return ok


def main():
    results = []
    print(f"测试根目录: {HERE}")

    for name, script, need in PY_TESTS:
        if need and importlib.util.find_spec(need) is None:
            print(f"\n{'=' * 60}\n⏭  跳过 {name} (缺少依赖 {need})")
            continue
        results.append((name, run(name, [PY, script])))

    if NODE is None:
        print(f"\n{'=' * 60}\n⏭  跳过前端测试 (未找到 node)")
    else:
        for name, script in JS_TESTS:
            results.append((name, run(name, [NODE, script])))

    print(f"\n{'=' * 60}")
    bad = [n for n, ok in results if not ok]
    for n, ok in results:
        print(f"  {'通过' if ok else '失败'}  {n}")
    print(f"\n共 {len(results)} 组, 失败 {len(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
