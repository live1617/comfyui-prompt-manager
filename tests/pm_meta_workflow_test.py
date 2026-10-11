# -*- coding: utf-8 -*-
"""验证 _extract_prompt_blocks: Krea2 问题图 + 普通 ComfyUI 图 + A1111 格式回归"""
import ast, json, textwrap, sys, io, os

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "__init__.py")
src = open(SRC, encoding="utf-8").read()
tree = ast.parse(src)
ns = {"json": json, "re": __import__("re")}
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name in ("_workflow_blocks", "_extract_prompt_blocks"):
        code = textwrap.dedent(ast.get_source_segment(src, node))
        exec(compile(code, "<test>", "exec"), ns)
f = ns["_extract_prompt_blocks"]

from PIL import Image
from PIL.PngImagePlugin import PngInfo

def info_of(path):
    img = Image.open(path)
    info = dict(getattr(img, "text", None) or {})
    for k, v in (img.info or {}).items():
        info.setdefault(k, v)
    img.close()
    return info

# ---- 1. 问题图片: Krea2 (文本在 workflow 的 widgets_values 里) ----
# 本机专属样本, 文件不存在时跳过 (CI 上没有这张图)
p1 = os.environ.get(
    "PM_SAMPLE_KREA",
    r"D:\Program Files\Leopard-cat-meow-ComfyUI-v5\ComfyUI\output\Krea2-2ST-20261007213934_00001_.png",
)
if not os.path.exists(p1):
    print("跳过 Krea2 样本 (文件不存在)")
else:
    b1 = f(info_of(p1))
    print(f"Krea2 图片: {len(b1)} 块")
    for b in b1:
        print(f"  [{b['label']}] {b['text'][:90]}...")
    assert any("whimsical" in b["text"] for b in b1), "没提取到媒体浏览器显示的那段!"

# ---- 2. 普通 ComfyUI 图回归: 合成一张 prompt JSON 有字面 text 的 PNG ----
prompt_json = json.dumps({
    "3": {"class_type": "KSampler", "inputs": {
        "seed": 42, "steps": 20, "cfg": 7.0, "sampler_name": "euler",
        "scheduler": "normal", "denoise": 1.0,
        "positive": ["6", 0], "negative": ["7", 0]}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cute cat, masterpiece"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "lowres, bad hands"}},
})
buf = io.BytesIO()
Image.new("RGB", (64, 64), "white").save(buf, "PNG")
buf.seek(0)
img = Image.open(buf)
meta = PngInfo()
meta.add_text("prompt", prompt_json)
meta.add_text("workflow", json.dumps({"nodes": [], "links": []}))
out2 = os.path.join(os.path.dirname(__file__), "_pm_meta_test.png")
img.save(out2, "PNG", pnginfo=meta)
img.close()
b2 = f(info_of(out2))
print(f"\n普通 ComfyUI 图: {len(b2)} 块")
for b in b2:
    print(f"  [{b['label']}] {b['text'][:60]}")
assert any(b["label"] == "正向提示词" and b["text"] == "a cute cat, masterpiece" for b in b2), "普通图正向丢失"
assert any(b["label"] == "反向提示词" and b["text"] == "lowres, bad hands" for b in b2), "普通图反向丢失"
os.remove(out2)

# ---- 3. A1111 parameters 回归 ----
b3 = f({"parameters": "masterpiece, best quality\nNegative prompt: lowres\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123"})
labels = [b["label"] for b in b3]
assert "正向提示词" in labels and "反向提示词" in labels, "A1111 回归失败"

# ---- 4. 空输入不炸 ----
assert f({}) == [] and f({"prompt": "not json"}) == [] and f({"workflow": "bad"}) == []

print("\n全部通过")
