# -*- coding: utf-8 -*-
# 局域网写保护 (security_guard.py) 的隔离测试
#
# 用假的 aiohttp.web 加载, 不需要真装 aiohttp。故意不提供 web.middleware,
# 顺带验证模块能自己打上 __middleware_version__ 标记。
# 用法: python pm_security_test.py
import asyncio
import importlib.util
import os
import re
import sys
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, "security_guard.py")
INIT = os.path.join(ROOT, "__init__.py")

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


# ---- 假 aiohttp.web ----
class _Resp:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status


fake_web = types.ModuleType("aiohttp.web")
fake_web.json_response = lambda payload, status=200: _Resp(payload, status)
# 注意: 故意不提供 web.middleware
fake_aiohttp = types.ModuleType("aiohttp")
fake_aiohttp.web = fake_web
sys.modules["aiohttp"] = fake_aiohttp
sys.modules["aiohttp.web"] = fake_web

spec = importlib.util.spec_from_file_location("pm_security_guard", GUARD)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class _Req:
    def __init__(self, path, method="POST", remote="127.0.0.1", query=None):
        self.path = path
        self.method = method
        self.remote = remote
        self.query = query or {}
        self.headers = {}


def req(path, method="POST", remote="127.0.0.1", query=None):
    return _Req(path, method, remote, query)


# ---- [1] 路由清单: 写操作默认拒绝 ----
print("\n[1] 路由清单 / 写操作默认拒绝")
_src = open(INIT, encoding="utf-8").read()
POST_ROUTES = re.findall(r'@routes\.post\("([^"]+)"\)', _src)
GET_ROUTES = re.findall(r'@routes\.get\("([^"]+)"\)', _src)

check(len(POST_ROUTES) >= 10, f"解析出 {len(POST_ROUTES)} 个 POST 路由")
check(len(GET_ROUTES) >= 10, f"解析出 {len(GET_ROUTES)} 个 GET 路由")
check(
    set(guard.READ_POSTS) <= set(POST_ROUTES),
    "READ_POSTS 里的路径都真实存在",
)
check(
    set(guard.LOCAL_GETS) <= set(GET_ROUTES),
    "LOCAL_GETS 里的路径都真实存在",
)
check(
    set(guard.PATH_QUERY_ROUTES) <= set(GET_ROUTES),
    "PATH_QUERY_ROUTES 里的路径都真实存在",
)

# 只读 POST 白名单必须显式维护: 新增写接口不允许偷偷塞进来
check(
    guard.READ_POSTS == frozenset({"/prompt_manager/load"}),
    "只读 POST 白名单只有 load",
)

_leak = [p for p in POST_ROUTES if p not in guard.READ_POSTS and not guard.needs_local("POST", p)]
check(not _leak, "所有 POST 写接口都要求本机" + (f" (漏: {_leak})" if _leak else ""))
_bad_read = [p for p in POST_ROUTES if p in guard.READ_POSTS and guard.needs_local("POST", p)]
check(not _bad_read, "白名单里的只读 POST 确实放行" + (f" (错: {_bad_read})" if _bad_read else ""))
_bad_get = [p for p in guard.LOCAL_GETS if not guard.needs_local("GET", p)]
check(not _bad_get, "敏感 GET 都要求本机" + (f" (漏: {_bad_get})" if _bad_get else ""))

# ---- [2] needs_local 明确用例 ----
print("\n[2] 是否需要本机")
_cases = [
    ("POST", "/prompt_manager/save", None, True),
    ("POST", "/prompt_manager/rename", None, True),
    ("POST", "/prompt_manager/delete", None, True),
    ("POST", "/prompt_manager/move", None, True),
    ("POST", "/prompt_manager/trash", None, True),
    ("POST", "/prompt_manager/import", None, True),
    ("POST", "/prompt_manager/dedupe", None, True),
    ("POST", "/prompt_manager/categories", None, True),
    ("POST", "/prompt_manager/categories/delete", None, True),
    ("POST", "/prompt_manager/categories/rename", None, True),
    ("POST", "/prompt_manager/categories/order", None, True),
    ("POST", "/prompt_manager/load", None, False),
    ("GET", "/prompt_manager/list", None, False),
    ("GET", "/prompt_manager/all", None, False),
    ("GET", "/prompt_manager/categories", None, False),
    ("GET", "/prompt_manager/duplicates", None, False),
    ("GET", "/prompt_manager/version", None, False),
    ("GET", "/prompt_manager/health", None, False),
    ("GET", "/prompt_manager/access", None, False),
    ("GET", "/prompt_manager/thumb", None, False),
    ("GET", "/prompt_manager/export", None, True),
    ("GET", "/prompt_manager/dirs", None, True),
    ("HEAD", "/prompt_manager/export", None, True),
    ("OPTIONS", "/prompt_manager/list", None, False),
    ("GET", "/some/other/route", None, False),
    ("POST", "/some/other/route", None, False),
]
for _m, _p, _q, _want in _cases:
    check(
        guard.needs_local(_m, _p, _q) is _want,
        f"{_m:7s} {_p:42s} -> {'本机' if _want else '放行'}",
    )

# ---- [3] 自定义路径的读请求 ----
print("\n[3] 自定义路径读请求收紧")
check(
    not guard.needs_local("GET", "/prompt_manager/gallery", {"dirs": '["output"]'}),
    "内置 output 图库允许远程看",
)
check(
    guard.needs_local("GET", "/prompt_manager/gallery", {"paths": '["D:/pics"]'}),
    "带 paths 的图库只允许本机",
)
check(
    guard.needs_local("GET", "/prompt_manager/gallery", {"path": "D:/pics"}),
    "带旧式 path 的图库只允许本机",
)
check(
    guard.needs_local("GET", "/prompt_manager/thumb", {"type": "custom", "path": "D:/pics"}),
    "带自定义路径的缩略图只允许本机",
)
check(
    not guard.needs_local("GET", "/prompt_manager/thumb", {"type": "output"}),
    "内置缩略图允许远程",
)
check(
    not guard.needs_local("GET", "/prompt_manager/gallery", {"path": "   "}),
    "空 path 不触发收紧",
)

# ---- [4] 本机判定 ----
print("\n[4] 本机判定")
check(guard.is_local(req("/x", remote="127.0.0.1")), "127.0.0.1 是本机")
check(guard.is_local(req("/x", remote="127.0.0.5")), "127.0.0.5 也是回环")
check(guard.is_local(req("/x", remote="::1")), "::1 是本机")
check(guard.is_local(req("/x", remote="::ffff:127.0.0.1")), "IPv4 映射写法认得出")
check(not guard.is_local(req("/x", remote="203.0.113.9")), "公网地址不是本机")
check(not guard.is_local(req("/x", remote="")), "空 remote 不是本机")
check(not guard.is_local(req("/x", remote="localhost")), "主机名不当 IP 用")

# 模拟本机网卡地址: 用局域网 IP 打开自己的 ComfyUI 时不能自锁
guard._ADDR_CACHE["addrs"] = frozenset({"127.0.0.1", "::1", "192.168.1.23"})
guard._ADDR_CACHE["at"] = time.monotonic()
check(
    guard.is_local(req("/x", remote="192.168.1.23")),
    "本机网卡地址算本机 (局域网 IP 打开不自锁)",
)
check(
    not guard.is_local(req("/x", remote="192.168.1.24")),
    "同网段其他机器仍算远程",
)
guard._ADDR_CACHE["addrs"] = frozenset()
guard._ADDR_CACHE["at"] = 0.0
check("127.0.0.1" in guard._own_addresses(), "_own_addresses 至少含 127.0.0.1")

# ---- [5] 中间件实际拦截 ----
print("\n[5] 中间件实际拦截")


async def _call(method, path, remote, query=None):
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return _Resp({"ok": True}, 200)

    resp = await guard.local_only_middleware(req(path, method, remote, query), handler)
    return resp, calls["n"]


def call(*a, **kw):
    return asyncio.run(_call(*a, **kw))


resp, n = call("POST", "/prompt_manager/save", "203.0.113.9")
check(
    resp.status == 403 and resp.payload.get("code") == "local_only" and n == 0,
    "远程写: 403, 处理函数不执行",
)
resp, n = call("POST", "/prompt_manager/save", "127.0.0.1")
check(resp.status == 200 and n == 1, "本机写: 放行")
resp, n = call("GET", "/prompt_manager/list", "203.0.113.9")
check(resp.status == 200 and n == 1, "远程读列表: 放行")
resp, n = call("GET", "/prompt_manager/export", "203.0.113.9")
check(resp.status == 403 and n == 0, "远程整包导出: 403")
resp, n = call("GET", "/prompt_manager/gallery", "203.0.113.9", {"paths": '["D:/pics"]'})
check(resp.status == 403 and n == 0, "远程读自定义目录图库: 403")
resp, n = call("POST", "/prompt_manager/load", "203.0.113.9")
check(resp.status == 200 and n == 1, "远程读提示词 (POST 只读): 放行")
resp, n = call("GET", "/other/route", "203.0.113.9")
check(resp.status == 200 and n == 1, "非本插件路由: 完全不受影响")
resp, n = call("GET", "/prompt_manager/access", "203.0.113.9")
check(resp.status == 200 and n == 1, "access 自述接口本身可远程读")

# ---- [6] 挂载 ----
print("\n[6] 挂载")
app = types.SimpleNamespace(middlewares=[])
check(guard.install(app) is True, "首次挂载成功")
check(len(app.middlewares) == 1, "列表里 1 个中间件")
check(
    guard.install(app) is False and len(app.middlewares) == 1,
    "重复挂载不会挂两次",
)
check(guard.install(types.SimpleNamespace()) is False, "无 middlewares 属性的 app 不崩")
check(guard.install(None) is False, "None 不崩")


class _Frozen:
    @property
    def middlewares(self):
        raise RuntimeError("app is frozen")


check(guard.install(_Frozen()) is False, "app 已冻结时安全返回 False")
check(
    getattr(guard.local_only_middleware, "__middleware_version__", None) == 1,
    "中间件带 aiohttp 新式标记",
)

print(f"\n{'=' * 50}\n通过 {PASSED}, 失败 {FAILED}")
sys.exit(1 if FAILED else 0)
