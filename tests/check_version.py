# -*- coding: utf-8 -*-
"""版本号一致性校验

插件的版本号散落在 6 个地方, 漏改一处就会出现「界面显示 A 版 / 注册表是 B 版」的错乱。
本脚本把它们全部读出来比对, 不一致就退出码 1 (供 CI 拦截)。

检查点:
  1. __init__.py        __version__ = "x.y.z"          (视为基准)
  2. web/ 下任一 js     const PM_VERSION = "x.y.z"      (前端拆分后不再固定在入口文件)
  3. pyproject.toml         version = "x.y.z"
  4. README.md 顶部徽章      version-x.y.z-blue
  5. CHANGELOG.md 最新一行   | x.y.z | 日期 | ...   (版本历史 v1.4.63 起挪到单独文件)
  6. tests/pm_vm_test.js     assert(PM_VERSION === "x.y.z")

用法:
  python tests/check_version.py            # 只校验
  python tests/check_version.py 1.4.50     # 额外确认当前就是 1.4.50
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER_RE = r"\d+\.\d+\.\d+"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fp:
        return fp.read()


def find(pattern, text, flags=0):
    m = re.search(pattern, text, flags)
    return m.group(1) if m else None


def find_in_web(pattern):
    """在 web/ 下所有 js 里找同一个模式; 返回 (匹配值, 来自哪个文件)"""
    web = os.path.join(ROOT, "web")
    got = None
    where = None
    for name in sorted(os.listdir(web)):
        if not name.endswith(".js"):
            continue
        text = read(os.path.join("web", name))
        for m in re.finditer(pattern, text, flags=0):
            v = m.group(1)
            if got is not None and v != got:
                return (None, f"{where} 与 {name} 里的版本号不一致 ({got} / {v})")
            got, where = v, name
    return (got, where)


def main():
    init = read("__init__.py")
    js_ver, js_file = find_in_web(r'PM_VERSION\s*=\s*["\'](' + VER_RE + r')["\']')
    toml = read("pyproject.toml")
    readme = read("README.md")
    changelog = read("CHANGELOG.md")
    vmtest = read(os.path.join("tests", "pm_vm_test.js"))

    base = find(r'__version__\s*=\s*["\'](' + VER_RE + r')["\']', init)

    checks = [
        ("__init__.py __version__", base),
        (f"web/{js_file} PM_VERSION" if js_file else "web/*.js PM_VERSION", js_ver),
        ("pyproject.toml version",
         find(r'^version\s*=\s*["\'](' + VER_RE + r')["\']', toml, re.M)),
        ("README 顶部徽章",
         find(r"badge/version-(" + VER_RE + r")-blue", readme)),
        ("CHANGELOG 最新条目",
         find(r"^\|\s*(" + VER_RE + r")\s*\|", changelog, re.M)),
        ("tests/pm_vm_test.js 断言",
         find(r'PM_VERSION\s*===\s*["\'](' + VER_RE + r')["\']', vmtest)),
    ]

    if base is None:
        print("FAIL 读不到基准版本号: __init__.py 里没有 __version__")
        return 1

    ok = True
    print(f"基准版本号: {base}  (来自 __init__.py)")
    print("-" * 52)
    for name, got in checks:
        good = got == base
        ok = ok and good
        print(f"  {'OK  ' if good else 'FAIL'} {name:<32} {got if got else '(未找到)'}")

    # 可选: 命令行指定期望版本 (CI 里可以传 git tag)
    want = sys.argv[1] if len(sys.argv) > 1 else None
    if want:
        good = base == want
        ok = ok and good
        print("-" * 52)
        print(f"  {'OK  ' if good else 'FAIL'} {'期望版本':<32} {want}")

    print("-" * 52)
    if ok:
        print(f"版本号一致: {base}")
        return 0
    print("版本号不一致, 请同步后再提交")
    return 1


if __name__ == "__main__":
    sys.exit(main())
