# -*- coding: utf-8 -*-
"""一键发版: 改版本号(六处) → 校验 → 跑测试 → (可选) 打包

用法:
    python tests/bump_version.py 1.4.62
    python tests/bump_version.py 1.4.62 --note "修好子图里的工具条"
    python tests/bump_version.py 1.4.62 --note "..." --pack
    python tests/bump_version.py 1.4.62 --dry            # 只看会改哪些地方, 不落盘

六处:
    1. __init__.py            __version__ = "x.y.z"            (基准)
    2. web/ 下任一 js         const PM_VERSION = "x.y.z"
    3. pyproject.toml         version = "x.y.z"
    4. README.md 顶部徽章      version-x.y.z-blue
    5. CHANGELOG.md           **新增一行** | x.y.z | <今天> | <--note>
    6. tests/pm_vm_test.js    PM_VERSION === "x.y.z"

任何一步失败(校验不通过 / 测试挂掉)都会把六处**全部回滚**到改之前的状态。
--pack 的产物落在仓库上一级; 想额外归档到别处, 用 --archive 或环境变量 PM_ARCHIVE_DIR。
"""
import datetime
import glob
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VER_RE = r"\d+\.\d+\.\d+"

# 子进程会直接往 stdout 写, 自己的 print 改成行缓冲, 免得两种输出交错难读
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fp:
        return fp.read()


def write(rel, text):
    with open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="\n") as fp:
        fp.write(text)


def current_version():
    m = re.search(r'__version__\s*=\s*["\'](' + VER_RE + r')["\']', read("__init__.py"))
    if not m:
        raise SystemExit("读不到当前版本: __init__.py 里没有 __version__")
    return m.group(1)


def js_file_with_version():
    """PM_VERSION 在哪个 js 里 (前端拆分后不固定在入口)"""
    web = os.path.join(ROOT, "web")
    for name in sorted(os.listdir(web)):
        if not name.endswith(".js"):
            continue
        if re.search(r'PM_VERSION\s*=\s*["\']' + VER_RE + r'["\']', read(os.path.join("web", name))):
            return os.path.join("web", name)
    raise SystemExit("web/ 下找不到 PM_VERSION")


def build_changes(old, new, note):
    """返回 [(相对路径, 新内容)]; 不改的文件不出现"""
    changes = []
    today = datetime.date.today().isoformat()

    # 1. __init__.py
    t = read("__init__.py")
    t2 = re.sub(r'(__version__\s*=\s*["\'])' + VER_RE + r'(["\'])', r"\g<1>" + new + r"\g<2>", t, count=1)
    changes.append(("__init__.py", t2))

    # 2. web/*.js 的 PM_VERSION
    js = js_file_with_version()
    t = read(js)
    t2 = re.sub(r'(PM_VERSION\s*=\s*["\'])' + VER_RE + r'(["\'])', r"\g<1>" + new + r"\g<2>", t, count=1)
    changes.append((js, t2))

    # 3. pyproject.toml
    t = read("pyproject.toml")
    t2 = re.sub(r'(^version\s*=\s*["\'])' + VER_RE + r'(["\'])', r"\g<1>" + new + r"\g<2>", t, count=1, flags=re.M)
    changes.append(("pyproject.toml", t2))

    # 4. README: 顶部徽章
    t = read("README.md")
    t2 = re.sub(r"(badge/version-)" + VER_RE + r"(-blue)", r"\g<1>" + new + r"\g<2>", t, count=1)
    changes.append(("README.md", t2))

    # 5. CHANGELOG: 新增一行 (版本历史 v1.4.63 起挪到单独文件)
    t = read("CHANGELOG.md")
    lines = t.split("\n")
    idx = None
    for i, line in enumerate(lines):
        if re.match(r"^\|\s*" + VER_RE + r"\s*\|", line):
            idx = i
            break
    if idx is None:
        raise SystemExit("CHANGELOG.md 里找不到版本表格 (形如 | 1.4.62 | 日期 | ...)")
    # 表格里不能出现裸竖线
    safe_note = (note or "（待补充）").replace("|", "\\|")
    lines.insert(idx, "| {} | {} | {} |".format(new, today, safe_note))
    changes.append(("CHANGELOG.md", "\n".join(lines)))

    # 6. tests/pm_vm_test.js
    t = read(os.path.join("tests", "pm_vm_test.js"))
    t2 = re.sub(
        r'(PM_VERSION\s*===\s*["\'])' + VER_RE + r'(["\'])',
        r"\g<1>" + new + r"\g<2>",
        t,
        count=1,
    )
    changes.append((os.path.join("tests", "pm_vm_test.js"), t2))
    return changes


def run(cmd, label):
    print(f"\n--- {label} ---")
    p = subprocess.run(cmd, cwd=ROOT, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    return p.returncode == 0


def pack(ver, archive):
    files = []
    for rel in (".gitignore", "LICENSE", "README.md", "CHANGELOG.md", "DEVELOPMENT.md", "pyproject.toml", "__init__.py", "db.py", "log.py", "security_guard.py"):
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            files.append(p)
    for sub, pat in (("web", "*.js"), ("tests", "*.py"), ("tests", "*.js"), (os.path.join(".github", "workflows"), "*.yml")):
        files += sorted(glob.glob(os.path.join(ROOT, sub, pat)))

    out = os.path.join(os.path.dirname(ROOT), f"comfyui-prompt-manager-v{ver}.zip")
    tmp = out + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            rel = os.path.relpath(p, ROOT).replace(os.sep, "/")
            z.write(p, "comfyui-prompt-manager/" + rel)
    os.replace(tmp, out)
    print(f"\n打包 {len(files)} 个文件 -> {out}  ({os.path.getsize(out)} 字节)")
    if archive and os.path.isdir(archive):
        dst = os.path.join(archive, os.path.basename(out))
        shutil.copy2(out, dst)
        print("归档 ->", dst)
    elif archive:
        print(f"(归档目录不存在, 跳过: {archive})")
    return out


def main():
    args = [a for a in sys.argv[1:]]
    dry = "--dry" in args
    skip_tests = "--skip-tests" in args
    do_pack = "--pack" in args
    note = None
    archive = ""
    rest = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--note":
            i += 1
            note = args[i] if i < len(args) else None
        elif a == "--archive":
            i += 1
            archive = args[i] if i < len(args) else ""
        elif a.startswith("--"):
            pass
        else:
            rest.append(a)
        i += 1

    if not rest:
        print(__doc__)
        return 2
    new = rest[0]
    if not re.fullmatch(VER_RE, new):
        print(f"版本号格式不对: {new} (要 x.y.z)")
        return 2

    old = current_version()
    if new == old:
        print(f"新版本号与当前相同 ({old}), 无需改动")
        return 2

    print(f"版本号: {old} -> {new}" + ("   [dry-run]" if dry else ""))
    changes = build_changes(old, new, note)
    for rel, _ in changes:
        print("  改", rel)

    if dry:
        print("\n[dry-run] 未写入任何文件。")
        return 0

    originals = {rel: read(rel) for rel, _ in changes}
    try:
        for rel, text in changes:
            write(rel, text)

        if not run([sys.executable, os.path.join("tests", "check_version.py")], "版本号一致性"):
            raise RuntimeError("版本号校验未通过")

        if not skip_tests:
            if not run([sys.executable, os.path.join("tests", "run_all.py")], "全套测试"):
                raise RuntimeError("测试未通过")
        else:
            print("\n(已跳过全套测试)")
    except Exception as e:
        print(f"\n!! {e} —— 正在回滚")
        for rel, text in originals.items():
            write(rel, text)
        print("已全部回滚, 仓库保持原样")
        return 1

    print(f"\n✅ 版本号 {old} -> {new} 完成")
    if do_pack:
        pack(new, archive or os.environ.get("PM_ARCHIVE_DIR", ""))
    else:
        print("提示: 加 --pack 可以顺手打包; 别忘了同步到生效目录")
    return 0


if __name__ == "__main__":
    sys.exit(main())
