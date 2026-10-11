# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 comfyui-prompt-manager contributors
import os
import sys
import json
import re
import asyncio
import importlib.util
import threading
import traceback

from aiohttp import web

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))

__version__ = "1.4.63"

def _load_local(module_key: str, filename: str):
    if module_key in sys.modules:
        return sys.modules[module_key]
    path = os.path.join(PLUGIN_DIR, filename)
    spec = importlib.util.spec_from_file_location(module_key, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_key] = mod
    spec.loader.exec_module(mod)
    return mod

try:
    from . import db
except ImportError:
    db = _load_local("prompt_manager_db", "db.py")

try:
    from . import log as pm_log
except ImportError:
    pm_log = _load_local("prompt_manager_log", "log.py")

NODE_CLASS_MAPPINGS = {}

NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

# 错误日志位置: 与数据库同一套规则 (user 目录), 不放在插件安装目录里
# (更新插件常是「删旧文件夹解压新版」, 放安装目录里会被一起删掉)
LOG_PATH = pm_log.LOG_PATH

def _pm_int(request, key, default=0, lo=0, hi=100000):
    """取 URL 里的整数参数, 非法/越界一律回落到 default (不抛异常)"""
    raw = request.query.get(key)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        v = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _pm_str(request, key):
    v = request.query.get(key)
    return (v or "").strip() if isinstance(v, str) else ""


def _log_error(text: str):
    """写错误日志 (控制台 + 文件); 超上限自动轮转, 任何失败都静默 — 见 log.py"""
    pm_log.log_error(text, log_path=LOG_PATH)

try:
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.post("/prompt_manager/save")
    async def save_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        text = data.get("text") or ""
        category = (data.get("category") or "").strip() or db.DEFAULT_CATEGORY
        if not name:
            return web.json_response(
                {"error": "保存名称不能为空, 请先填写 save_name_input"}, status=400
            )
        db.save_prompt(name, text, category)
        return web.json_response(
            {
                "ok": True,
                "name": name,
                "category": category,
                "names": db.list_names(),
                "categories": db.list_categories(),
            }
        )

    @routes.post("/prompt_manager/load")
    async def load_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response(
                {"error": "缺少提示词名称"}, status=400
            )
        text = db.load_prompt(name)
        if text is None:
            return web.json_response({"error": f"提示词 '{name}' 不存在"}, status=404)
        return web.json_response({"ok": True, "name": name, "text": text})

    @routes.post("/prompt_manager/rename")
    async def rename_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or data.get("old_name") or "").strip()
        new_name = (data.get("new_name") or "").strip()
        if not name:
            return web.json_response({"error": "缺少提示词名称"}, status=400)
        if not new_name:
            return web.json_response({"error": "新名称不能为空"}, status=400)
        if not db.rename_prompt(name, new_name):
            return web.json_response(
                {"error": f"改名失败: '{new_name}' 已存在或 '{name}' 不存在"}, status=400
            )
        return web.json_response({"ok": True, "name": new_name, "names": db.list_names()})

    @routes.post("/prompt_manager/delete")
    async def delete_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response(
                {"error": "缺少提示词名称"}, status=400
            )
        if not db.delete_prompt(name):
            return web.json_response({"error": f"提示词 '{name}' 不存在"}, status=404)
        return web.json_response(
            {
                "ok": True,
                "name": name,
                "names": db.list_names(),
                "categories": db.list_categories(),
            }
        )

    @routes.post("/prompt_manager/move")
    async def move_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        category = (data.get("category") or "").strip() or db.DEFAULT_CATEGORY
        if not name:
            return web.json_response({"error": "缺少提示词名称"}, status=400)
        if not db.move_prompt(name, category):
            return web.json_response({"error": f"提示词 '{name}' 不存在"}, status=404)
        return web.json_response(
            {
                "ok": True,
                "name": name,
                "category": category,
                "categories": db.list_categories(),
            }
        )

    @routes.post("/prompt_manager/categories/delete")
    async def delete_category_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        mode = (data.get("mode") or "keep").strip()
        if not name:
            return web.json_response({"error": "分类名称不能为空"}, status=400)
        result = db.delete_category(name, mode == "delete_all")
        return web.json_response(
            {"ok": True, "name": name, "mode": mode, **result, "categories": db.list_categories()}
        )

    @routes.get("/prompt_manager/duplicates")
    async def duplicates_handler(request):
        # 分页参数可选: 不传就是取全部 (旧行为)
        q = _pm_str(request, "q") or None
        limit = _pm_int(request, "limit", 0)
        offset = _pm_int(request, "offset", 0)
        groups = db.find_duplicates(q=q, limit=limit, offset=offset)
        total = db.count_duplicate_groups(q=q)
        return web.json_response(
            {
                "ok": True,
                "groups": groups,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": bool(limit > 0 and offset + len(groups) < total),
            }
        )

    @routes.post("/prompt_manager/dedupe")
    async def dedupe_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        names = data.get("names") or []
        if not isinstance(names, list):
            return web.json_response({"error": "names 必须是数组"}, status=400)
        deleted = db.delete_prompts(names)
        return web.json_response(
            {
                "ok": True,
                "deleted": deleted,
                "names": db.list_names(),
                "categories": db.list_categories(),
            }
        )

    @routes.get("/prompt_manager/list")
    async def list_handler(request):
        return web.json_response({"ok": True, "names": db.list_names()})

    @routes.get("/prompt_manager/categories")
    async def categories_handler(request):
        return web.json_response({"ok": True, "categories": db.list_categories()})

    @routes.post("/prompt_manager/categories")
    async def add_category_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response({"error": "分类名称不能为空"}, status=400)
        db.add_category(name)
        return web.json_response({"ok": True, "categories": db.list_categories()})

    @routes.post("/prompt_manager/categories/rename")
    async def rename_category_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        old = (data.get("old_name") or data.get("old") or "").strip()
        new = (data.get("new_name") or data.get("new") or "").strip()
        if not old or not new:
            return web.json_response({"error": "分类名称不能为空"}, status=400)
        db.rename_category(old, new)
        return web.json_response({"ok": True, "categories": db.list_categories()})

    @routes.post("/prompt_manager/categories/order")
    async def order_categories_handler(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        names = data.get("names") or []
        if not isinstance(names, list):
            return web.json_response({"error": "names 必须是数组"}, status=400)
        db.set_category_order(names)
        return web.json_response({"ok": True, "categories": db.list_categories()})

    @routes.get("/prompt_manager/all")
    async def all_handler(request):
        # q=关键字 / category=分类 / offset+limit=分页 (都不传就是取全部, 旧行为)
        q = _pm_str(request, "q") or None
        category = _pm_str(request, "category") or None
        limit = _pm_int(request, "limit", 0)
        offset = _pm_int(request, "offset", 0)
        total = db.count_items(category=category, q=q)
        items = db.list_items(category=category, q=q, limit=limit, offset=offset)
        return web.json_response(
            {
                "ok": True,
                "items": items,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": bool(limit > 0 and offset + len(items) < total),
            }
        )

    @routes.get("/prompt_manager/version")
    async def version_handler(request):
        return web.json_response({"ok": True, "version": __version__})

    @routes.get("/prompt_manager/health")
    async def health_handler(request):
        """自检: 库路径/大小/journal 模式/备份份数 + 完整性检查结果

        完整性检查放线程里跑, 免得库大时卡住事件循环。
        """
        loop = asyncio.get_event_loop()
        ok, detail = await loop.run_in_executor(None, db.check_integrity)
        info = await loop.run_in_executor(None, db.db_health)
        info["integrity_ok"] = ok
        info["integrity_detail"] = detail
        return web.json_response({"ok": True, "health": info})

    IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")

    # 图库列表快照: 10 秒内重复请求直接复用, 只有显式 refresh=1 才真正重新扫盘
    GALLERY_SNAPSHOT_SECONDS = 10
    _gallery_snapshot = {"key": None, "expires": 0, "images": []}
    _gallery_snapshot_lock = threading.Lock()

    def _gallery_collect(root: str, order: str, kind: str):
        from urllib.parse import quote

        items = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            sub = os.path.relpath(dirpath, root)
            sub = "" if sub in (".", "") else sub.replace("\\", "/")
            for fn in filenames:
                if not fn.lower().endswith(IMAGE_EXTS):
                    continue
                full = os.path.join(dirpath, fn)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                items.append(
                    {
                        "name": fn,
                        "subfolder": sub,
                        "type": kind,
                        # 自定义目录时前端要靠它把路径原样传回 thumb / meta / trash
                        "root": root if kind == "custom" else "",
                        "mtime": int(st.st_mtime),
                        "size": int(st.st_size),
                        "url": "/view?filename=%s&subfolder=%s&type=%s"
                        % (quote(fn), quote(sub), kind),
                    }
                )
        if order == "name":
            items.sort(key=lambda x: (x["name"].lower(), x["subfolder"]))
        else:
            items.sort(key=lambda x: (-x["mtime"], x["name"].lower()))
        return items

    def _gallery_images(sources, order: str, refresh: bool):
        """带快照缓存的目录扫描 (避免每次打开图库都全盘 walk)。
        sources: [(realpath, kind)] 列表 — output / input / 多个自定义文件夹可任意组合"""
        import time as _time

        sources = [(os.path.realpath(r), k) for r, k in sources]
        key = (tuple(sources), order)
        with _gallery_snapshot_lock:
            snap = _gallery_snapshot
            now = _time.monotonic()
            if not refresh and snap["key"] == key and now < snap["expires"]:
                return list(snap["images"])
            images = []
            for root, kind in sources:
                images.extend(_gallery_collect(root, order, kind))
            if order == "name":
                images.sort(key=lambda x: (x["name"].lower(), x["subfolder"]))
            else:
                images.sort(key=lambda x: (-x["mtime"], x["name"].lower()))
            snap.update(key=key, images=images, expires=now + GALLERY_SNAPSHOT_SECONDS)
            return list(images)

    def _comfy_dir(kind: str) -> str:
        """取 ComfyUI 的 output / input 目录"""
        try:
            import folder_paths

            if kind == "input":
                return folder_paths.get_input_directory()
            return folder_paths.get_output_directory()
        except Exception:
            # 拿不到 folder_paths (单元测试 / 非标准目录结构) 时按插件位置回退
            base = os.path.dirname(os.path.dirname(PLUGIN_DIR))
            return os.path.join(base, kind)

    def _root_for(kind: str, custom: str = ""):
        """解析图库根目录:
        output / input → ComfyUI 对应目录;
        custom → 用户指定的任意文件夹 (绝对路径, 必须存在)
        """
        kind = (kind or "output").strip().lower()
        if kind in ("output", "input"):
            return os.path.realpath(_comfy_dir(kind)), kind
        if kind != "custom":
            kind = "output"
            return os.path.realpath(_comfy_dir(kind)), kind
        p = os.path.normpath(os.path.abspath(os.path.expanduser((custom or "").strip())))
        return os.path.realpath(p), "custom"

    def _gallery_scan(
        kinds, limit: int, order: str, refresh: bool = False, customs=None
    ):
        """多来源扫描: kinds=[output/input 可多选] + customs=[自定义目录列表], 任意组合"""
        sources = []
        for k in kinds or []:
            if k in ("output", "input"):
                rp = os.path.realpath(_comfy_dir(k))
                if (rp, k) not in sources:
                    sources.append((rp, k))
        missing = []
        for p in customs or []:
            p = (p or "").strip()
            if not p:
                continue
            rp = os.path.realpath(
                os.path.normpath(os.path.abspath(os.path.expanduser(p)))
            )
            if os.path.isdir(rp):
                if (rp, "custom") not in sources:
                    sources.append((rp, "custom"))
            else:
                missing.append(rp)
        if not sources:
            msg = "没有可用的目录"
            if missing:
                msg += " (目录不存在: " + ", ".join(missing) + ")"
            return {
                "ok": False,
                "error": msg,
                "dir": "custom",
                "root": "",
                "roots": [],
                "total": 0,
                "count": 0,
                "truncated": False,
                "images": [],
            }
        items = _gallery_images(sources, order, refresh)
        total = len(items)
        truncated = False
        if limit and total > limit:
            items = items[:limit]
            truncated = True
        kind_names = [k for _, k in sources]
        return {
            "ok": True,
            "dir": "+".join(kind_names),
            "root": sources[0][0] if len(sources) == 1 else "",
            "roots": [rp for rp, _ in sources],
            "total": total,
            "count": len(items),
            "truncated": truncated,
            "images": items,
        }

    @routes.get("/prompt_manager/gallery")
    async def gallery_handler(request):
        import json as _json

        # dirs=JSON数组 (output/input 可多选), 兼容旧的单值 dir=
        # 注意: dirs 参数存在但为空数组时表示用户不勾内置目录, 不回退 legacy
        kinds = []
        raw_dirs = (request.query.get("dirs") or "").strip()
        have_dirs_param = bool(raw_dirs)
        if raw_dirs:
            try:
                parsed = _json.loads(raw_dirs)
                if isinstance(parsed, list):
                    kinds = [d for d in parsed if d in ("output", "input")]
            except Exception:
                kinds = []
        if not have_dirs_param:
            legacy = (request.query.get("dir") or "output").strip().lower()
            if legacy in ("output", "input"):
                kinds = [legacy]
            elif legacy != "custom":
                kinds = ["output"]
        # 自定义目录: paths=JSON数组, 兼容旧的单个 path=
        customs = []
        raw_paths = (request.query.get("paths") or "").strip()
        if raw_paths:
            try:
                parsed = _json.loads(raw_paths)
                if isinstance(parsed, list):
                    customs = [str(p) for p in parsed]
            except Exception:
                customs = []
        if not customs:
            single = (request.query.get("path") or "").strip()
            if single:
                customs = [single]
        if not kinds and not customs:
            return web.json_response({"error": "缺少目录参数 (dirs/paths)"}, status=400)
        order = (request.query.get("order") or "time").strip().lower()
        if order not in ("time", "name"):
            order = "time"
        try:
            limit = int(request.query.get("limit") or 0)
        except (TypeError, ValueError):
            limit = 0
        if limit < 0:
            limit = 0
        refresh = (request.query.get("refresh") or "").strip().lower() in ("1", "true", "yes")
        # os.walk 放线程池, 不阻塞 ComfyUI 的事件循环
        try:
            data = await asyncio.to_thread(
                _gallery_scan, kinds, limit, order, refresh, customs
            )
        except AttributeError:  # 老版本 Python 没有 asyncio.to_thread
            data = _gallery_scan(kinds, limit, order, refresh, customs)
        return web.json_response(data)

    @routes.get("/prompt_manager/dirs")
    async def dirs_handler(request):
        """浏览本机目录 (给"自定义路径"选择器用): path 为空时返回盘符列表"""
        raw = (request.query.get("path") or "").strip()
        try:
            with_dot = request.query.get("hidden") in ("1", "true", "yes")
            if not raw:
                return web.json_response(_list_roots())
            root = os.path.normpath(os.path.abspath(os.path.expanduser(raw)))
            if not os.path.isdir(root):
                return web.json_response({"error": "目录不存在"}, status=404)
            entries = []
            with os.scandir(root) as it:
                for e in it:
                    try:
                        if not e.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    if not with_dot and e.name.startswith("."):
                        continue
                    entries.append({"name": e.name, "path": e.path})
            entries.sort(key=lambda x: x["name"].lower())
            parent = os.path.dirname(root)
            same_as_parent = os.path.dirname(root.rstrip("\\/")) == "" or parent == root
            return web.json_response(
                {
                    "ok": True,
                    "path": root,
                    "parent": None if same_as_parent else parent,
                    "dirs": entries,
                }
            )
        except PermissionError:
            return web.json_response({"error": "没有访问权限"}, status=403)
        except OSError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    def _list_roots():
        """Windows 返回可用盘符, 其它系统返回 /"""
        import string

        drives = []
        if os.name == "nt":
            for letter in string.ascii_uppercase:
                d = f"{letter}:\\"
                if os.path.isdir(d):
                    drives.append({"name": f"{letter}:", "path": d})
        if not drives:
            drives = [{"name": "/", "path": "/"}]
        return {"ok": True, "path": "", "parent": None, "dirs": drives}

    # ---- 图库缩略图: 生成一次落盘缓存, 之后直接读文件 + 浏览器 immutable 缓存 ----
    THUMB_EDGE = 320
    THUMB_STATIC_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
    THUMB_CACHE_LIMIT = 256 * 1024 * 1024
    _thumb_slots = threading.BoundedSemaphore(3)
    _thumb_cleanup_lock = threading.Lock()
    _thumb_last_cleanup = 0.0
    _thumb_created = 0

    def _thumb_cache_dir():
        import tempfile

        try:
            import folder_paths

            base = folder_paths.get_temp_directory()
        except Exception:
            base = None
        if not isinstance(base, (str, os.PathLike)):
            base = tempfile.gettempdir()
        cache_dir = os.path.join(base, "prompt_manager", "thumbs")
        os.makedirs(cache_dir, exist_ok=True)
        return cache_dir

    def _prune_thumb_cache(cache_dir, created=False):
        import time as _time

        global _thumb_last_cleanup, _thumb_created
        with _thumb_cleanup_lock:
            if created:
                _thumb_created += 1
            now = _time.monotonic()
            if now - _thumb_last_cleanup < 3600 and _thumb_created < 128:
                return
            _thumb_last_cleanup = now
            _thumb_created = 0
            entries = []
            total = 0
            try:
                with os.scandir(cache_dir) as it:
                    for entry in it:
                        if not entry.is_file() or not entry.name.endswith(".webp"):
                            continue
                        try:
                            st = entry.stat()
                        except OSError:
                            continue
                        total += st.st_size
                        entries.append((st.st_mtime_ns, st.st_size, entry.path))
            except OSError:
                return
            if total <= THUMB_CACHE_LIMIT:
                return
            target = int(THUMB_CACHE_LIMIT * 0.8)
            for _, size, path in sorted(entries):
                try:
                    os.remove(path)
                    total -= size
                except OSError:
                    pass
                if total <= target:
                    break

    def _thumb_cache_path(source_path: str):
        """缩略图缓存文件路径 — key 规则与 _build_thumb 完全一致 (便于删除时清缓存)"""
        import hashlib

        try:
            st = os.stat(source_path)
        except OSError:
            return None
        try:
            key = "\0".join(
                (
                    os.path.realpath(source_path),
                    str(st.st_size),
                    str(st.st_mtime_ns),
                    str(THUMB_EDGE),
                )
            )
            digest = hashlib.sha256(key.encode("utf-8", errors="surrogatepass")).hexdigest()
            return os.path.join(_thumb_cache_dir(), digest + ".webp")
        except OSError:
            return None

    def _build_thumb(source_path: str):
        """返回缓存的 320px WebP 缩略图路径; 任何异常/动图/小图都回退到原图"""
        try:
            from PIL import Image, ImageOps

            cached = _thumb_cache_path(source_path)
            if not cached:
                return source_path
            if os.path.isfile(cached):
                try:
                    os.utime(cached, None)
                except OSError:
                    pass
                _prune_thumb_cache(cache_dir)
                return cached

            with _thumb_slots:
                with Image.open(source_path) as img:
                    if getattr(img, "is_animated", False):
                        return source_path
                    img = ImageOps.exif_transpose(img)
                    if max(img.size) <= THUMB_EDGE:
                        return source_path
                    resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
                    img.thumbnail((THUMB_EDGE, THUMB_EDGE), resampling)
                    if img.mode not in ("RGB", "RGBA"):
                        img = img.convert("RGBA" if "transparency" in img.info else "RGB")
                    tmp = "%s.%d.tmp" % (cached, os.getpid())
                    try:
                        img.save(tmp, format="WEBP", quality=80, method=4)
                        os.replace(tmp, cached)
                    finally:
                        if os.path.exists(tmp):
                            try:
                                os.remove(tmp)
                            except OSError:
                                pass
            _prune_thumb_cache(cache_dir, created=True)
            return cached
        except Exception:
            return source_path

    @routes.get("/prompt_manager/thumb")
    async def thumb_handler(request):
        kind = (request.query.get("type") or "output").strip().lower()
        if kind not in ("output", "input", "custom"):
            kind = "output"
        custom = (request.query.get("path") or "").strip()
        full = (request.query.get("full") or "").strip().lower() in ("1", "true", "yes")
        filename = (request.query.get("filename") or "").strip()
        subfolder = (request.query.get("subfolder") or "").strip()
        if not filename:
            return web.json_response({"error": "缺少 filename"}, status=400)
        root, kind = _root_for(kind, custom)
        if not os.path.isdir(root):
            return web.json_response({"error": "目录不存在"}, status=404)
        target = os.path.normpath(os.path.join(root, subfolder))
        # 防目录穿越
        if os.path.commonpath([root, target]) != root:
            return web.json_response({"error": "非法路径"}, status=400)
        path = os.path.normpath(os.path.join(target, os.path.basename(filename)))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return web.json_response({"error": "文件不存在"}, status=404)

        ext = os.path.splitext(path)[1].lower()
        content_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
        }
        ctype = content_types.get(ext, "application/octet-stream")
        served = path
        # full=1: 直接返回原图 (自定义目录的大图查看走这条路)
        if not full and ext in THUMB_STATIC_EXTS:
            try:
                served = await asyncio.to_thread(_build_thumb, path)
            except AttributeError:
                served = _build_thumb(path)
            if served != path:
                ctype = "image/webp"
        headers = {"Content-Type": ctype}
        if request.query.get("t"):
            # 带 t= 的 URL 内容不会变, 让浏览器永久缓存, 二次打开零请求
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return web.FileResponse(served, headers=headers)

    # ---- 图库删除: 移入系统回收站 (Windows 回收站 / Linux 垃圾桶) ----
    def _send_to_trash(path: str) -> bool:
        """把文件移入回收站; 成功 True, 失败 False (绝不直接 os.remove 硬删除)"""
        full = os.path.abspath(path)

        # 1) send2trash: 跨平台的标准回收站实现 (Windows 走真正的回收站 API)
        try:
            from send2trash import send2trash  # type: ignore

            send2trash(full)
            return True
        except ImportError:
            pass  # 没装 send2trash, 走下面的原生方案
        except Exception:
            _log_error(f"send2trash 失败: {traceback.format_exc()}")
            # 少数环境下 API 报错但文件其实已经进了回收站
            if not os.path.exists(full):
                return True

        # 2) Windows: SHFileOperationW + FOF_ALLOWUNDO (进回收站, 可还原)
        if os.name == "nt":
            try:
                import ctypes
                from ctypes import wintypes

                class SHFILEOPSTRUCTW(ctypes.Structure):
                    _fields_ = [
                        ("hwnd", wintypes.HWND),
                        ("wFunc", wintypes.UINT),
                        ("pFrom", wintypes.LPCWSTR),
                        ("pTo", wintypes.LPCWSTR),
                        ("fFlags", ctypes.c_uint16),
                        ("fAnyOperationsAborted", wintypes.BOOL),
                        ("hNameMappings", ctypes.c_void_p),
                        ("lpszProgressTitle", wintypes.LPCWSTR),
                    ]

                FO_DELETE = 3
                FOF_ALLOWUNDO = 0x0040  # 进回收站, 可还原
                FOF_NOCONFIRMATION = 0x0010
                FOF_NOERRORUI = 0x0400
                FOF_SILENT = 0x0004
                op = SHFILEOPSTRUCTW()
                op.wFunc = FO_DELETE
                op.pFrom = full + "\0\0"  # 双 \0 结尾的路径列表
                op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT
                res = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
                if res == 0 and not op.fAnyOperationsAborted:
                    return True
                # 少数环境返回非 0 但文件确实已被移走 —— 视为成功, 同时留一条诊断日志
                if not os.path.exists(full):
                    _log_error(f"SHFileOperationW 返回 {res} 但文件已移走, 按成功处理: {full}")
                    return True
                _log_error(f"SHFileOperationW 失败 res={res}: {full}")
                return False
            except Exception:
                _log_error(f"回收站删除失败: {traceback.format_exc()}")
                return False

        # 3) 非 Windows: XDG 垃圾桶 (同样不是硬删除)
        try:
            trash_dir = os.path.join(
                os.path.expanduser("~"), ".local", "share", "Trash", "files"
            )
            os.makedirs(trash_dir, exist_ok=True)
            dest = os.path.join(trash_dir, os.path.basename(full))
            n = 1
            while os.path.exists(dest):
                stem, ext = os.path.splitext(os.path.basename(full))
                dest = os.path.join(trash_dir, f"{stem} ({n}){ext}")
                n += 1
            os.replace(full, dest)
            return True
        except Exception:
            _log_error(f"回收站删除失败: {traceback.format_exc()}")
            return False

    @routes.post("/prompt_manager/trash")
    async def trash_handler(request):
        """把 output / input 里的图片移入系统回收站"""
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        kind = (data.get("type") or "output").strip().lower()
        if kind not in ("output", "input", "custom"):
            kind = "output"
        custom = (data.get("path") or "").strip()
        filename = (data.get("filename") or "").strip()
        subfolder = (data.get("subfolder") or "").strip()
        if not filename:
            return web.json_response({"error": "缺少 filename"}, status=400)
        root, kind = _root_for(kind, custom)
        target = os.path.normpath(os.path.join(root, subfolder))
        # 防目录穿越
        if os.path.commonpath([root, target]) != root:
            return web.json_response({"error": "非法路径"}, status=400)
        path = os.path.normpath(os.path.join(target, os.path.basename(filename)))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return web.json_response({"error": "文件不存在"}, status=404)

        name = os.path.basename(path)
        # 缩略图只是派生缓存, 不必进回收站, 直接清掉
        try:
            cached = _thumb_cache_path(path)
            if cached and os.path.isfile(cached):
                os.remove(cached)
        except OSError:
            pass

        try:
            ok = await asyncio.to_thread(_send_to_trash, path)
        except AttributeError:  # 老版本 Python 没有 asyncio.to_thread
            ok = _send_to_trash(path)
        if not ok:
            return web.json_response({"error": "移入回收站失败"}, status=500)

        # 列表快照立即失效, 下次拉取图库会重新扫盘 (否则刷新后图片还在)
        with _gallery_snapshot_lock:
            _gallery_snapshot["key"] = None
        return web.json_response({"ok": True, "name": name})

    # ---- 图库元数据: 读图片里嵌入的提示词 (ComfyUI prompt / A1111 parameters) ----
    def _workflow_blocks(wf) -> list:
        """UI workflow (graph 格式) 兜底提取提示词, 返回 [{label, text}]

        prompt JSON 里文本字段是链接时 (MuyeText / PrimitiveString 等自定义
        文本节点), 字面文本只存在 workflow 节点的 widgets_values 里。
        """
        out = []
        if not isinstance(wf, dict):
            return out
        nodes = [n for n in (wf.get("nodes") or []) if isinstance(n, dict)]
        if not nodes:
            return out
        by_id = {}
        for n in nodes:
            by_id[n.get("id")] = n
        link_src = {}
        for l in wf.get("links") or []:
            if isinstance(l, (list, tuple)) and len(l) >= 4:
                try:
                    link_src[l[0]] = l[1]
                except (TypeError, ValueError):
                    pass

        def node_widget_text(n):
            """文本编码类节点上 widgets_values 里的字面文本 (强信号)"""
            t = str(n.get("type", "")).lower()
            if not ("clip" in t and "encode" in t) and "textencode" not in t:
                return None
            wv = n.get("widgets_values")
            if not isinstance(wv, list):
                return None
            for v in wv:
                if isinstance(v, str) and v.strip():
                    return v
            return None

        def node_weak_text(n):
            """兜底: 任意文本类节点里较长且带空格的字面文本 (排除工具节点)"""
            t = str(n.get("type", "")).lower()
            if "text" not in t and "prompt" not in t and "string" not in t:
                return None
            if any(
                k in t
                for k in ("concat", "combine", "switch", "index", "replace",
                          "trim", "length", "join", "count", "stack")
            ):
                return None
            wv = n.get("widgets_values")
            if not isinstance(wv, list):
                return None
            for v in wv:
                if isinstance(v, str) and len(v.strip()) >= 20 and " " in v:
                    return v
            return None

        # 采样器正/负向输入的源节点 (用于给文本标注 正向/反向)
        sampler_pos, sampler_neg = [], []
        for n in nodes:
            t = str(n.get("type", "")).lower()
            if "sampler" not in t and "ksample" not in t:
                continue
            for inp in n.get("inputs") or []:
                if not isinstance(inp, dict):
                    continue
                lid = inp.get("link")
                src = link_src.get(lid) if isinstance(lid, int) else None
                if src is None:
                    continue
                if inp.get("name") == "positive":
                    sampler_pos.append(src)
                elif inp.get("name") == "negative":
                    sampler_neg.append(src)

        def chain_texts(start_ids, getter):
            """从源节点向上游找文本 widget (找到即停, 不再穿过它)"""
            texts = []
            seen = set()
            queue = list(start_ids)
            while queue and len(texts) < 4:
                nid = queue.pop(0)
                if nid in seen:
                    continue
                seen.add(nid)
                n = by_id.get(nid)
                if not isinstance(n, dict):
                    continue
                t = getter(n)
                if t:
                    if t not in texts:
                        texts.append(t)
                    continue  # 该节点自身有文本, 不再向上游找
                for inp in n.get("inputs") or []:
                    if not isinstance(inp, dict):
                        continue
                    lid = inp.get("link")
                    src = link_src.get(lid) if isinstance(lid, int) else None
                    if src is not None:
                        queue.append(src)
            return texts

        pos_texts = chain_texts(sampler_pos, node_widget_text)
        neg_texts = chain_texts(sampler_neg, node_widget_text)

        seen = set()
        for n in nodes:
            t = node_widget_text(n)
            if not t:
                continue
            if t in seen:
                continue
            seen.add(t)
            if t in pos_texts:
                label = "正向提示词"
            elif t in neg_texts:
                label = "反向提示词"
            else:
                label = "提示词"
            out.append({"label": label, "text": t})

        # 没有 CLIPTextEncode 类 widget 时, 放宽到任意文本类节点
        if not out:
            seen2 = set()
            for n in nodes:
                t = node_weak_text(n)
                if t and t not in seen2:
                    seen2.add(t)
                    label = "提示词"
                    if t in pos_texts:
                        label = "正向提示词"
                    elif t in neg_texts:
                        label = "反向提示词"
                    out.append({"label": label, "text": t})
        return out

    def _extract_prompt_blocks(info: dict) -> list:
        """从 PNG/JPEG 文本块提取提示词, 返回 [{label, text}]"""
        blocks = []

        # A1111 / SD WebUI 格式: "parameters" 文本
        params = info.get("parameters")
        if isinstance(params, str) and params.strip():
            pos = params.strip()
            neg = ""
            idx = params.find("\nNegative prompt:")
            if idx >= 0:
                pos = params[:idx].strip()
                rest = params[idx + len("\nNegative prompt:"):].strip()
                neg = rest.split("\n")[0].strip()  # 之后是 Steps/CFG 等参数行
            if pos:
                blocks.append({"label": "正向提示词", "text": pos})
            if neg:
                blocks.append({"label": "反向提示词", "text": neg})
            return blocks

        # ComfyUI 格式: "prompt" 是 API JSON
        raw = info.get("prompt")
        if isinstance(raw, str) and raw.strip():
            try:
                data = json.loads(raw)
            except Exception:
                data = None
            if isinstance(data, dict):
                # 通过采样器节点的 positive/negative 链接判断正/反向
                pos_ids, neg_ids = set(), set()
                for node in data.values():
                    if not isinstance(node, dict):
                        continue
                    ct = str(node.get("class_type", "")).lower()
                    inputs = node.get("inputs")
                    if not isinstance(inputs, dict):
                        continue
                    if "sampler" in ct or "ksample" in ct:
                        for key, ids in (("positive", pos_ids), ("negative", neg_ids)):
                            v = inputs.get(key)
                            if isinstance(v, list) and v and isinstance(v[0], str):
                                ids.add(v[0])

                seen = set()
                for nid, node in data.items():
                    if not isinstance(node, dict):
                        continue
                    ct = str(node.get("class_type", "")).lower()
                    inputs = node.get("inputs")
                    if not isinstance(inputs, dict):
                        continue
                    t = inputs.get("text")
                    if not isinstance(t, str) or not t.strip():
                        continue
                    is_encode = ("clip" in ct and "encode" in ct) or "text" in ct
                    if not is_encode:
                        continue
                    if nid in pos_ids:
                        label = "正向提示词"
                    elif nid in neg_ids:
                        label = "反向提示词"
                    else:
                        label = "提示词"
                    key = (label, t)
                    if key in seen:
                        continue
                    seen.add(key)
                    blocks.append({"label": label, "text": t})

        # 兜底: prompt JSON 里文本字段是链接 (MuyeText / PrimitiveString 等
        # 自定义文本节点) 时, 字面文本只存在 UI workflow 的 widgets_values 里
        wf_raw = info.get("workflow")
        wf_data = None
        if isinstance(wf_raw, str) and wf_raw.strip():
            try:
                wf_data = json.loads(wf_raw)
            except Exception:
                wf_data = None
        elif isinstance(wf_raw, dict):
            wf_data = wf_raw
        if isinstance(wf_data, dict):
            have = {b["text"] for b in blocks}
            for b in _workflow_blocks(wf_data):
                if b["text"] not in have:
                    have.add(b["text"])
                    blocks.append(b)
        return blocks

    # ---- 生成参数: 种子/步数/CFG/降噪/采样/调度 (供大图查看器底部参数区) ----
    def _extract_gen_params(info: dict) -> list:
        """从 A1111 parameters 或 ComfyUI prompt JSON 提取生成参数, 返回 [{label, value}]"""
        # A1111 / SD WebUI: parameters 末尾 "Steps: 20, Sampler: Euler a, Seed: 1, ..." 行
        params = info.get("parameters")
        if isinstance(params, str) and params.strip():
            m = re.search(
                r"Steps:\s*(\d+)", params
            )
            if m:
                pairs = {}
                for k, v in re.findall(
                    r"([A-Za-z ][A-Za-z0-9 _]*):\s*([^,]+?)(?:,\s*|\s*$)",
                    params[m.start():],
                    re.M,
                ):
                    pairs[k.strip().lower()] = v.strip()
                out = []
                mapping = [
                    ("seed", "种子 (seed)", ("seed",)),
                    ("steps", "步数", ("steps",)),
                    ("cfg", "CFG 引导系数", ("cfg scale", "cfg")),
                    ("denoise", "降噪", ("denoising strength", "denoise")),
                    ("sampler", "采样", ("sampler", "sampler name")),
                    ("scheduler", "调度", ("schedule type", "scheduler")),
                ]
                for key, label, names in mapping:
                    for n in names:
                        if n in pairs and pairs[n]:
                            # key 是机器可读的字段名, 供「套用参数到画布」认 widget
                            out.append({"key": key, "label": label, "value": pairs[n]})
                            break
                return out
            return []

        # ComfyUI: prompt API JSON 里找 KSampler 类节点
        raw = info.get("prompt")
        if isinstance(raw, str) and raw.strip():
            try:
                data = json.loads(raw)
            except Exception:
                return []
            if not isinstance(data, dict):
                return []
            ks = None
            for node in data.values():
                if not isinstance(node, dict):
                    continue
                inputs = node.get("inputs")
                if not isinstance(inputs, dict):
                    continue
                ct = str(node.get("class_type", "")).lower()
                if ("sampler" in ct or "ksample" in ct) and "steps" in inputs:
                    ks = inputs
                    break
            if not ks:
                return []

            def _num(key):
                v = ks.get(key)
                if isinstance(v, (int, float)):
                    return str(v)
                if isinstance(v, list) and v and isinstance(v[0], (int, float)):
                    return str(v[0])  # 控制值接的是输入桩
                return ""

            def _txt(key):
                v = ks.get(key)
                return str(v).strip() if isinstance(v, str) else ""

            out = []
            seed = _num("seed") or _num("noise_seed")
            if seed:
                out.append({"key": "seed", "label": "种子 (seed)", "value": seed})
            if _num("steps"):
                out.append({"key": "steps", "label": "步数", "value": _num("steps")})
            if _num("cfg"):
                out.append({"key": "cfg", "label": "CFG 引导系数", "value": _num("cfg")})
            if _num("denoise"):
                out.append({"key": "denoise", "label": "降噪", "value": _num("denoise")})
            if _txt("sampler_name"):
                out.append({"key": "sampler", "label": "采样", "value": _txt("sampler_name")})
            if _txt("scheduler"):
                out.append({"key": "scheduler", "label": "调度", "value": _txt("scheduler")})
            return out
        return []

    def _image_meta(path: str) -> dict:
        result = {
            "ok": True,
            "format": None,
            "width": None,
            "height": None,
            "prompts": [],
            "params": [],
            "has_workflow": False,
        }
        try:
            from PIL import Image

            with Image.open(path) as img:
                result["width"], result["height"] = img.size
                result["format"] = (img.format or "").upper()
                info = {}
                text = getattr(img, "text", None)
                if isinstance(text, dict):
                    info.update(text)  # PNG tEXt/iTXt
                extra = img.info or {}
                for k, v in extra.items():
                    info.setdefault(k, v)
                result["has_workflow"] = bool(info.get("workflow"))
                result["prompts"] = _extract_prompt_blocks(info)
                result["params"] = _extract_gen_params(info)
        except Exception:
            pass
        return result

    def _image_workflow(path: str) -> dict:
        """取图片内嵌的工作流 (UI graph 格式), 供「载入此图工作流」回填画布"""
        result = {"ok": True, "has_workflow": False, "workflow": None}
        try:
            from PIL import Image

            with Image.open(path) as img:
                info = {}
                text = getattr(img, "text", None)
                if isinstance(text, dict):
                    info.update(text)
                for k, v in (img.info or {}).items():
                    info.setdefault(k, v)
                raw = info.get("workflow")
                if isinstance(raw, str) and raw.strip():
                    result["workflow"] = json.loads(raw)
                elif isinstance(raw, dict):
                    result["workflow"] = raw
        except Exception as e:
            result["error"] = str(e)
        result["has_workflow"] = bool(result.get("workflow"))
        return result

    @routes.get("/prompt_manager/workflow")
    async def workflow_handler(request):
        kind = (request.query.get("type") or "output").strip().lower()
        if kind not in ("output", "input", "custom"):
            kind = "output"
        custom = (request.query.get("path") or "").strip()
        filename = (request.query.get("filename") or "").strip()
        subfolder = (request.query.get("subfolder") or "").strip()
        if not filename:
            return web.json_response({"error": "缺少 filename"}, status=400)
        root, kind = _root_for(kind, custom)
        target = os.path.normpath(os.path.join(root, subfolder))
        if os.path.commonpath([root, target]) != root:
            return web.json_response({"error": "非法路径"}, status=400)
        path = os.path.normpath(os.path.join(target, os.path.basename(filename)))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return web.json_response({"error": "文件不存在"}, status=404)
        try:
            data = await asyncio.to_thread(_image_workflow, path)
        except AttributeError:
            data = _image_workflow(path)
        return web.json_response(data)

    @routes.get("/prompt_manager/meta")
    async def meta_handler(request):
        kind = (request.query.get("type") or "output").strip().lower()
        if kind not in ("output", "input", "custom"):
            kind = "output"
        custom = (request.query.get("path") or "").strip()
        filename = (request.query.get("filename") or "").strip()
        subfolder = (request.query.get("subfolder") or "").strip()
        if not filename:
            return web.json_response({"error": "缺少 filename"}, status=400)
        root, kind = _root_for(kind, custom)
        target = os.path.normpath(os.path.join(root, subfolder))
        if os.path.commonpath([root, target]) != root:
            return web.json_response({"error": "非法路径"}, status=400)
        path = os.path.normpath(os.path.join(target, os.path.basename(filename)))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return web.json_response({"error": "文件不存在"}, status=404)
        try:
            data = await asyncio.to_thread(_image_meta, path)
        except AttributeError:
            data = _image_meta(path)
        return web.json_response(data)

    @routes.get("/prompt_manager/export")
    async def export_handler(request):
        payload = db.export_all()
        return web.Response(
            body=json.dumps(payload, ensure_ascii=False, indent=2),
            content_type="application/json",
            headers={
                "Content-Disposition": 'attachment; filename="prompt_manager_export.json"'
            },
        )

    @routes.post("/prompt_manager/import")
    async def import_handler(request):
        raw_overwrite = ""
        if "application/json" in (request.content_type or "").lower():
            # 改名后的条目用 JSON 直接提交, 不再包一层文件
            try:
                data = await request.json()
            except Exception:
                return web.json_response({"error": "导入请求 JSON 解析失败"}, status=400)
            if isinstance(data, dict):
                prompts = data.get("prompts")
                raw_overwrite = data.get("overwrite")
            else:
                prompts = data
        else:
            try:
                post = await request.post()
            except Exception:
                return web.json_response({"error": "导入请求解析失败"}, status=400)
            file = post.get("file")
            if file is None or not hasattr(file, "file"):
                return web.json_response({"error": "未收到导入文件"}, status=400)
            try:
                content = file.file.read().decode("utf-8-sig")
                data = json.loads(content)
            except Exception:
                return web.json_response(
                    {"error": "导入文件不是有效的 UTF-8 JSON"}, status=400
                )
            prompts = data.get("prompts") if isinstance(data, dict) else data
            raw_overwrite = post.get("overwrite")
        if not isinstance(prompts, list):
            return web.json_response(
                {"error": "JSON 格式不正确, 需要 {prompts: [{name, text}]} 结构"},
                status=400,
            )
        # 导入策略: 纯增加 —— 与库里同名的提示词一律跳过, 不覆盖已有内容。
        # (请求里带 overwrite=1/true 时才走覆盖, 前端默认不传)
        # 同名但内容不同的条目不导入, 返回 conflicts 让前端提示改名后再提交。
        overwrite = str(raw_overwrite or "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        )
        result = db.import_data(prompts, overwrite=overwrite)
        return web.json_response({"ok": True, "names": db.list_names(), **result})

    print(
        f"[PromptManager] 加载成功 v{__version__} (无需添加节点)"
        f" | 数据库: {db.DB_PATH}"
    )

    def _pm_health_probe():
        """后台跑一次数据库自检: 损坏就写错误日志 + 控制台明确提示 (不阻塞启动)"""
        ok, detail = db.check_integrity()
        if ok:
            print(f"[PromptManager] 数据库自检通过 | {db.DB_PATH}")
            return
        _log_error(
            "数据库完整性检查未通过: {}\n"
            "  文件: {}\n"
            "  可从同目录的 *.bak 备份里挑一份改名成 prompt_manager.db 覆盖回去 (详见 README)".format(
                detail, db.DB_PATH
            )
        )
        print(
            "[PromptManager] 数据库自检未通过! 详见错误日志; "
            "可用同目录 .bak 备份恢复"
        )

    # 延迟几秒再跑: 别跟 ComfyUI 启动时的磁盘 IO 抢
    try:
        _t = threading.Timer(8.0, _pm_health_probe)
        _t.daemon = True  # 守护线程, 不阻止进程退出
        _t.start()
    except Exception:
        pass

except Exception:
    _log_error("路由注册失败:\n" + traceback.format_exc())

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
    "__version__",
]
