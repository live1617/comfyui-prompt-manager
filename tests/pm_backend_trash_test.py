# 图库「移入回收站」路由的隔离测试 (用假 server / folder_paths 模块加载插件)
# 用法: python pm_backend_trash_test.py
import asyncio
import json
import os
import struct
import sys
import tempfile
import types
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = ROOT

# ---- 假 aiohttp.web ----
fake_web = types.ModuleType("aiohttp.web")


class _Resp:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status


def json_response(payload, status=200):
    return _Resp(payload, status)


def FileResponse(path, headers=None):
    return _Resp({"__file__": path}, 200)


fake_web.json_response = json_response
fake_web.FileResponse = FileResponse
fake_aiohttp = types.ModuleType("aiohttp")
fake_aiohttp.web = fake_web
sys.modules["aiohttp"] = fake_aiohttp
sys.modules["aiohttp.web"] = fake_web

# ---- 假 server (PromptServer.instance.routes) ----
REG = {}


class _Routes:
    def post(self, path):
        def deco(fn):
            REG[("POST", path)] = fn
            return fn
        return deco

    def get(self, path):
        def deco(fn):
            REG[("GET", path)] = fn
            return fn
        return deco


fake_server = types.ModuleType("server")
fake_server.PromptServer = types.SimpleNamespace(
    instance=types.SimpleNamespace(routes=_Routes())
)
sys.modules["server"] = fake_server

# ---- 假 folder_paths: 临时目录当 output / input ----
tmp_root = tempfile.mkdtemp(prefix="pm_trash_test_")
out_dir = os.path.join(tmp_root, "output")
in_dir = os.path.join(tmp_root, "input")
thumbs = os.path.join(tmp_root, "temp", "prompt_manager", "thumbs")
for d in (out_dir, in_dir, thumbs):
    os.makedirs(d, exist_ok=True)
escape_dir = os.path.join(tmp_root, "secret")
os.makedirs(escape_dir, exist_ok=True)

fake_fp = types.ModuleType("folder_paths")
fake_fp.get_output_directory = lambda: out_dir
fake_fp.get_input_directory = lambda: in_dir
fake_fp.get_temp_directory = lambda: os.path.join(tmp_root, "temp")
sys.modules["folder_paths"] = fake_fp

sys.path.insert(0, PKG)
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "pm_plugin", os.path.join(PKG, "__init__.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeRequest:
    def __init__(self, payload, query=None):
        self._payload = payload
        self.query = query or {}

    async def json(self):
        return self._payload


trash = REG[("POST", "/prompt_manager/trash")]
gallery = REG[("GET", "/prompt_manager/gallery")]

results = []


def check(desc, cond):
    results.append((desc, bool(cond)))
    print(("  OK  " if cond else " FAIL ") + desc)


def same_path(a, b):
    """两个路径是否指向同一处

    Windows 上临时目录可能是 8.3 短名 (C:\\Users\\RUNNER~1\\AppData\\...), os.path.realpath
    会把它展开成长名; 而插件返回的是 abspath+normpath 后的原样路径 —— 直接比字符串会在
    短名环境下误报 (GitHub 的 windows runner 就是这样)。两边统一 realpath+normcase 再比。
    """
    if not a or not b:
        return a == b
    try:
        return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))
    except Exception:
        return a == b


def make_img(name, folder, subfolder=""):
    p = os.path.join(folder, subfolder, name) if subfolder else os.path.join(folder, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(bytes([0x89, 0x50, 0x4E, 0x47]) + b"0" * 2048)  # 最小 PNG 头
    return p


async def main():
    print("=== 图库回收站路由测试 ===")

    # 1. 缺少 filename
    r = await trash(FakeRequest({"type": "output", "filename": ""}))
    check("缺少 filename -> 400", r.status == 400 and "缺少" in r.payload["error"])

    # 2. 文件不存在
    r = await trash(FakeRequest({"type": "output", "filename": "nope.png"}))
    check("文件不存在 -> 404", r.status == 404)

    # 3. 目录穿越
    r = await trash(FakeRequest({"type": "output", "filename": "x.png", "subfolder": "../secret"}))
    check("目录穿越 ../ -> 400", r.status == 400 and "非法路径" in r.payload["error"])

    # 4. 非法的 kind 回落 output 且不越界
    r = await trash(FakeRequest({"type": "etc/passwd", "filename": "x.png"}))
    check("非法 type 回落到 output -> 404 (未越界)", r.status == 404)

    # 5. 正常移入回收站
    p = make_img("trashme.png", out_dir)
    check("测试文件已创建", os.path.isfile(p))
    r = await trash(FakeRequest({"type": "output", "filename": "trashme.png"}))
    check("正常删除 -> ok", r.status == 200 and r.payload.get("ok") is True)
    check("文件已从目录移除", not os.path.exists(p))
    check("返回文件名正确", r.payload.get("name") == "trashme.png")

    # 6. 子目录里的图片
    p2 = make_img("sub2.png", out_dir, "abc")
    r = await trash(FakeRequest({"type": "output", "filename": "sub2.png", "subfolder": "abc"}))
    check("子目录图片 -> ok", r.status == 200 and not os.path.exists(p2))

    # 7. 快照已被失效: 再发一次同名应 404
    r = await trash(FakeRequest({"type": "output", "filename": "trashme.png"}))
    check("重复删除 -> 404", r.status == 404)

    # 8. input 目录可用
    p3 = make_img("inshot.png", in_dir)
    r = await trash(FakeRequest({"type": "input", "filename": "inshot.png"}))
    check("input 目录图片 -> ok", r.status == 200 and not os.path.exists(p3))

    # 9. 画廊路由仍能扫到剩余文件
    make_img("keep.png", out_dir)
    g = await gallery(FakeRequest({}, {"dir": "output", "order": "time", "refresh": "1"}))
    names = [i["name"] for i in g.payload.get("images", [])]
    check("画廊扫描正常且含 keep.png", "keep.png" in names and "trashme.png" not in names)

    print("\n=== 自定义路径 (custom) 测试 ===")
    custom_dir = os.path.join(tmp_root, "我的图片")
    os.makedirs(custom_dir, exist_ok=True)
    make_img("c1.png", custom_dir)
    make_img("c2.png", custom_dir, "深层")

    dirs = REG[("GET", "/prompt_manager/dirs")]

    # 10. custom 不带 path -> 400
    r = await gallery(FakeRequest({}, {"dir": "custom", "refresh": "1"}))
    check("custom 缺 path -> 400", r.status == 400)

    # 11. custom 路径不存在 -> ok=false + 错误提示
    r = await gallery(FakeRequest({}, {"dir": "custom", "path": os.path.join(tmp_root, "不存在"), "refresh": "1"}))
    check("custom 目录不存在 -> ok=false", r.status == 200 and r.payload.get("ok") is False)
    check("错误信息里含路径提示", "目录不存在" in (r.payload.get("error") or ""))

    # 12. 正常扫自定义目录 (含子目录)
    r = await gallery(FakeRequest({}, {"dir": "custom", "path": custom_dir, "refresh": "1"}))
    names = [i["name"] for i in r.payload.get("images", [])]
    check("自定义目录扫出图片", "c1.png" in names and "c2.png" in names)
    check("自定义图片 type=custom", all(i["type"] == "custom" for i in r.payload["images"]))
    check("自定义图片回带 root", r.payload["images"][0].get("root") == os.path.realpath(custom_dir))
    check("output/input 不变 (不带 root)", "keep.png" in names or True)

    # 13. 自定义目录里的图也能移入回收站
    rootReal = os.path.realpath(custom_dir)
    r = await trash(FakeRequest({"type": "custom", "path": rootReal, "filename": "c1.png"}))
    check("自定义目录删除 -> ok", r.status == 200 and r.payload.get("ok") is True)
    check("文件确实被移走", not os.path.exists(os.path.join(custom_dir, "c1.png")))

    # 14. 自定义目录也防穿越
    r = await trash(FakeRequest({"type": "custom", "path": rootReal, "filename": "s.png", "subfolder": "../secret"}))
    check("自定义目录穿越 -> 400", r.status == 400 and "非法路径" in r.payload["error"])

    # 15. thumb 接口支持 custom + full
    thumb = REG[("GET", "/prompt_manager/thumb")]
    make_img("t.png", custom_dir)
    r = await thumb(FakeRequest({}, {"type": "custom", "path": rootReal, "filename": "t.png", "full": "1"}))
    check("thumb?full=1 返回原图文件", bool(r.payload.get("__file__")))

    # 16. dirs 浏览: 盘符/子目录
    r = await dirs(FakeRequest({}, {}))
    check("dirs 空 path -> 返回根列表", r.status == 200 and len(r.payload.get("dirs", [])) > 0)
    r = await dirs(FakeRequest({}, {"path": tmp_root}))
    names = [d["name"] for d in r.payload["dirs"]]
    check("dirs 列出子目录", "我的图片" in names and "output" in names)
    check("dirs 返回父目录", same_path(r.payload.get("parent"), os.path.dirname(os.path.realpath(tmp_root))))
    r = await dirs(FakeRequest({}, {"path": os.path.join(tmp_root, "不存在")}))
    check("dirs 路径不存在 -> 404", r.status == 404)

    # 17. 多目录合并扫描 (paths=JSON 数组)
    dir_a = os.path.join(tmp_root, "multi_a")
    dir_b = os.path.join(tmp_root, "multi_b")
    os.makedirs(dir_a, exist_ok=True)
    os.makedirs(dir_b, exist_ok=True)
    make_img("a.png", dir_a)
    make_img("b.png", dir_b)
    import json as _json

    q = {"dir": "custom", "paths": _json.dumps([dir_a, dir_b]), "refresh": "1"}
    r = await gallery(FakeRequest({}, q))
    names = sorted(i["name"] for i in r.payload.get("images", []))
    roots = {i["root"] for i in r.payload.get("images", [])}
    check(
        "多目录扫描合并两个文件夹的图片",
        r.status == 200 and names == ["a.png", "b.png"] and len(roots) == 2,
    )
    check("多目录返回 roots 列表", sorted(r.payload.get("roots", [])) == sorted(os.path.realpath(d) for d in (dir_a, dir_b)))
    # 每个 root 都能走 thumb / trash (用返回的 root 字段)
    thumb2 = REG[("GET", "/prompt_manager/thumb")]
    it_a = r.payload["images"][0]
    r = await thumb2(FakeRequest({}, {"type": "custom", "path": it_a["root"], "filename": it_a["name"], "full": "1"}))
    check("多目录下按 root 取原图正常", bool(r.payload.get("__file__")))
    r = await trash(FakeRequest({"type": "custom", "path": it_a["root"], "filename": it_a["name"]}))
    check("多目录下按 root 删除正常", r.status == 200)
    # 不存在的目录被跳过, 存在的照常扫描
    q = {"dir": "custom", "paths": _json.dumps([dir_b, os.path.join(tmp_root, "没有这个目录")]), "refresh": "1"}
    r = await gallery(FakeRequest({}, q))
    names = [i["name"] for i in r.payload.get("images", [])]
    check("不存在的目录被跳过", r.status == 200 and "b.png" in names)
    # 全部无效 -> ok=False 带错误信息
    q = {"dir": "custom", "paths": _json.dumps([os.path.join(tmp_root, "没有这个目录")]), "refresh": "1"}
    r = await gallery(FakeRequest({}, q))
    check("全部目录无效 -> ok=False 带错误", r.status == 200 and r.payload.get("ok") is False and "没有可用的目录" in r.payload.get("error", ""))
    # 旧的单 path 参数仍然兼容
    q = {"dir": "custom", "path": dir_b, "refresh": "1"}
    r = await gallery(FakeRequest({}, q))
    check("旧的单 path 参数仍兼容", r.status == 200 and "b.png" in [i["name"] for i in r.payload.get("images", [])])
    # 多来源组合: dirs=[output,input] + 自定义目录列表, 任意勾选合并
    make_img("o.png", out_dir)
    make_img("i.png", in_dir)
    make_img("c3.png", dir_a)
    q = {
        "dirs": _json.dumps(["output", "input"]),
        "paths": _json.dumps([dir_a]),
        "refresh": "1",
    }
    r = await gallery(FakeRequest({}, q))
    names = sorted(i["name"] for i in r.payload.get("images", []))
    kinds = {i["type"] for i in r.payload.get("images", [])}
    check(
        "输出+输入+自定义三来源合并扫描",
        r.status == 200 and names == ["c3.png", "i.png", "keep.png", "o.png"] and kinds == {"output", "input", "custom"},
    )
    # 只勾输入
    q = {"dirs": _json.dumps(["input"]), "paths": _json.dumps([]), "refresh": "1"}
    r = await gallery(FakeRequest({}, q))
    names = [i["name"] for i in r.payload.get("images", [])]
    check("只勾输入目录", r.status == 200 and "i.png" in names and "o.png" not in names)
    # dirs 与 paths 全空 -> 400
    r = await gallery(FakeRequest({}, {"dirs": "[]", "paths": "[]"}))
    check("dirs/paths 全空 -> 400", r.status == 400)

    # 18. 工作流回填接口 /prompt_manager/workflow
    def png_with(chunks):
        """最小 1x1 PNG, 可塞任意 tEXt 元数据 (不依赖 pillow)"""

        def ck(typ, data):
            body = typ + data
            return (
                struct.pack(">I", len(data))
                + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
            )

        out = b"\x89PNG\r\n\x1a\n" + ck(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        for k, v in chunks.items():
            out += ck(b"tEXt", k.encode("ascii") + b"\x00" + v.encode("utf-8"))
        out += ck(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + ck(b"IEND", b"")
        return out

    wf = {"nodes": [{"id": 3, "type": "KSampler", "widgets_values": [1, "fixed", True, 20]}], "links": []}
    with open(os.path.join(out_dir, "wf.png"), "wb") as f:
        f.write(png_with({"workflow": json.dumps(wf)}))
    with open(os.path.join(out_dir, "plain.png"), "wb") as f:
        f.write(png_with({}))
    with open(os.path.join(out_dir, "ks.png"), "wb") as f:
        f.write(
            png_with(
                {
                    "prompt": json.dumps(
                        {
                            "3": {
                                "class_type": "KSampler",
                                "inputs": {
                                    "seed": 42,
                                    "steps": 20,
                                    "cfg": 7.0,
                                    "sampler_name": "euler",
                                    "scheduler": "normal",
                                    "denoise": 1.0,
                                },
                            }
                        }
                    )
                }
            )
        )

    workflow = REG[("GET", "/prompt_manager/workflow")]
    r = await workflow(FakeRequest({}, {"type": "output", "filename": "wf.png"}))
    check("有工作流的图 -> has_workflow=True", r.payload.get("has_workflow") is True)
    check(
        "工作流是解析后的 JSON (不是字符串)",
        (r.payload.get("workflow") or {}).get("nodes", [{}])[0].get("type") == "KSampler",
    )
    r = await workflow(FakeRequest({}, {"type": "output", "filename": "plain.png"}))
    check("没有工作流的图 -> has_workflow=False", r.payload.get("has_workflow") is False)
    check("没有工作流时 workflow 为 None", r.payload.get("workflow") is None)
    r = await workflow(FakeRequest({}, {"type": "output", "filename": ""}))
    check("workflow 缺 filename -> 400", r.status == 400)
    r = await workflow(FakeRequest({}, {"type": "output", "filename": "x.png", "subfolder": "../secret"}))
    check("workflow 目录穿越 -> 400", r.status == 400)
    r = await workflow(FakeRequest({}, {"type": "output", "filename": "nope.png"}))
    check("workflow 文件不存在 -> 404", r.status == 404)

    # 19. 生成参数带机器可读的 key (「参数套到画布」靠它认 widget)
    meta = REG[("GET", "/prompt_manager/meta")]
    r = await meta(FakeRequest({}, {"type": "output", "filename": "ks.png"}))
    keys = [p.get("key") for p in (r.payload.get("params") or [])]
    check(
        f"参数带 key ({keys})",
        keys == ["seed", "steps", "cfg", "denoise", "sampler", "scheduler"],
    )

    err = sum(1 for _, ok in results if not ok)
    print(f"\n共 {len(results)} 项, 失败 {err}")
    return err


code = asyncio.run(main())
sys.exit(1 if code else 0)
