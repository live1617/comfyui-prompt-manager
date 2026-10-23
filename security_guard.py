# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 comfyui-prompt-manager contributors
"""局域网写保护: 别的设备只能看, 不能改。

ComfyUI 用 ``--listen`` 启动时, 同一网络里的其他设备也能打开页面。对它们来说:

- **读** — 列表 / 搜索 / 提示词内容 / output 里的图, 一律放行;
- **写** — 保存、改名、删除、移动、分类增删改序、去重、导入、图库移入回收站,
  只接受运行 ComfyUI 这台机器发出的请求;
- **敏感读** — 整包导出 (export)、本机目录浏览 (dirs)、带自定义路径的图库读,
  同样只允许本机: 它们会暴露这台机器的目录结构, 或一次性打包全部数据。

判定只看来源 IP: 回环地址 + 本机所有网卡地址都算「本机」。**不校验 Host,
也不看代理头** —— 否则用局域网 IP 打开自己的 ComfyUI 时会被锁在门外。这是
刻意的取舍: 保住可用性, 放弃 DNS rebinding 那一层额外防护 (对本地小工具够了)。

新增写接口时不用改这里: 非 GET 默认就是只允许本机 (默认拒绝),
只有显式加进 ``READ_POSTS`` 的只读接口才会放开。
"""

import ipaddress
import socket
import time

from aiohttp import web

PREFIX = "/prompt_manager/"

# 以 POST 形式发出的只读请求: 局域网也能调用 (它们不写任何东西)
READ_POSTS = frozenset(
    {
        "/prompt_manager/load",
    }
)

# 会泄露本机信息的 GET: 只允许本机
LOCAL_GETS = frozenset(
    {
        "/prompt_manager/export",  # 一次导出全部提示词
        "/prompt_manager/dirs",  # 浏览本机目录树
    }
)

# 这些 GET 只要带了自定义路径参数, 就会去读任意本地目录 -> 只允许本机
PATH_QUERY_ROUTES = frozenset(
    {
        "/prompt_manager/gallery",
        "/prompt_manager/thumb",
        "/prompt_manager/meta",
        "/prompt_manager/workflow",
    }
)
PATH_QUERY_KEYS = ("path", "paths")

READ_METHODS = ("GET", "HEAD", "OPTIONS")

MESSAGE = (
    "只能在运行 ComfyUI 的电脑上修改提示词库; 其他设备只能浏览。"
    " Only the computer running ComfyUI can change the prompt library."
)

# 本机地址缓存 (主机名解析每次请求都做太浪费, 但 DHCP 换地址后也得能跟上)
_ADDR_CACHE = {"at": 0.0, "addrs": frozenset()}
_ADDR_TTL = 60.0


def _own_addresses():
    """本机所有网卡地址 (含回环)。解析失败时至少返回回环地址。"""
    now = time.monotonic()
    if _ADDR_CACHE["addrs"] and now - _ADDR_CACHE["at"] < _ADDR_TTL:
        return _ADDR_CACHE["addrs"]
    addrs = {"127.0.0.1", "::1"}
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            addrs.add(str(ip))
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            addrs.add(str(info[4][0]))
    except Exception:
        pass
    addrs = frozenset(a.lower() for a in addrs if a)
    _ADDR_CACHE.update(at=now, addrs=addrs)
    return addrs


def _norm_address(raw):
    """统一地址写法: 小写, 去掉 IPv6 里 IPv4 映射前缀 (::ffff:127.0.0.1)"""
    raw = str(raw or "").strip().lower()
    if raw.startswith("::ffff:") and "." in raw:
        raw = raw[7:]
    return raw


def is_local(request):
    """请求是否来自运行 ComfyUI 这台机器"""
    remote = _norm_address(getattr(request, "remote", ""))
    if not remote:
        return False
    try:
        if ipaddress.ip_address(remote).is_loopback:
            return True
    except ValueError:
        return False
    return remote in _own_addresses()


def _has_custom_path(query):
    if not query or not hasattr(query, "__contains__"):
        return False
    for key in PATH_QUERY_KEYS:
        try:
            if key in query and str(query.get(key) or "").strip():
                return True
        except Exception:
            continue
    return False


def needs_local(method, path, query=None):
    """这个请求是否必须来自本机"""
    if not path.startswith(PREFIX):
        return False
    if method.upper() in READ_METHODS:
        if path in LOCAL_GETS:
            return True
        # 带自定义目录参数的读请求会碰到任意本地路径, 同样收紧
        return path in PATH_QUERY_ROUTES and _has_custom_path(query)
    return path not in READ_POSTS


def refusal():
    return web.json_response(
        {
            "ok": False,
            "success": False,
            "error": "local_only",
            "code": "local_only",
            "message": MESSAGE,
        },
        status=403,
    )


async def local_only_middleware(request, handler):
    if needs_local(
        request.method, request.path, getattr(request, "query", None)
    ) and not is_local(request):
        return refusal()
    return await handler(request)


# aiohttp 靠这个版本标记区分「新式中间件」和「老式工厂函数」。手动打上,
# 不依赖 web.middleware 装饰器 (测试环境用的是假 aiohttp, 不一定提供它)。
try:
    local_only_middleware = web.middleware(local_only_middleware)
except Exception:
    pass
try:
    local_only_middleware.__middleware_version__ = 1
except Exception:
    pass


def install(app):
    """挂到 aiohttp Application 上。

    已挂过 / app 没有 middlewares / 已冻结时都安全返回 False, 不抛异常。
    """
    try:
        middlewares = getattr(app, "middlewares", None)
        if middlewares is None:
            return False
        name = getattr(local_only_middleware, "__name__", "local_only_middleware")
        for mw in middlewares:
            if getattr(mw, "__name__", "") == name:
                return False
        middlewares.append(local_only_middleware)
        return True
    except Exception:
        return False
