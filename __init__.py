import os
import sys
import json
import importlib.util
import traceback

from aiohttp import web

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))

__version__ = "1.1.1"

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

NODE_CLASS_MAPPINGS = {}

NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

LOG_PATH = os.path.join(PLUGIN_DIR, "prompt_manager_error.log")

def _log_error(text: str):
    print(f"[PromptManager] {text}")
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass

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
        if not name:
            return web.json_response(
                {"error": "保存名称不能为空, 请先填写 save_name_input"}, status=400
            )
        db.save_prompt(name, text)
        return web.json_response({"ok": True, "name": name, "names": db.list_names()})

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
        return web.json_response({"ok": True, "name": name, "names": db.list_names()})

    @routes.get("/prompt_manager/list")
    async def list_handler(request):
        return web.json_response({"ok": True, "names": db.list_names()})

    @routes.get("/prompt_manager/all")
    async def all_handler(request):
        return web.json_response({"ok": True, "items": db.list_items()})

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
        if not isinstance(prompts, list):
            return web.json_response(
                {"error": "JSON 格式不正确, 需要 {prompts: [{name, text}]} 结构"},
                status=400,
            )
        result = db.import_data(prompts, overwrite=True)
        return web.json_response({"ok": True, "names": db.list_names(), **result})

    print(
        f"[PromptManager] 加载成功 v{__version__} (无需添加节点)"
        f" | 数据库: {db.DB_PATH}"
    )

except Exception:
    _log_error("路由注册失败:\n" + traceback.format_exc())

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
    "__version__",
]
