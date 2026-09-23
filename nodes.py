import os
import sys
import importlib.util

try:
    from . import db
except ImportError:
    _PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
    _KEY = "prompt_manager_db"
    if _KEY in sys.modules:
        db = sys.modules[_KEY]
    else:
        _spec = importlib.util.spec_from_file_location(
            _KEY, os.path.join(_PLUGIN_DIR, "db.py")
        )
        db = importlib.util.module_from_spec(_spec)
        sys.modules[_KEY] = db
        _spec.loader.exec_module(db)

class PromptManagerNode:

    @classmethod
    def INPUT_TYPES(cls):
        names = ["-- 选择提示词 --"] + db.list_names()
        return {
            "required": {
                "prompt_text": (
                    "STRING",
                    {"default": "", "multiline": True, "placeholder": "prompt_text"},
                ),
                "save_name_input": ("STRING", {"default": ""}),
                "prompt_selector": (names,),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "run"
    CATEGORY = "prompt"

    def run(self, prompt_text: str, save_name_input: str = "", prompt_selector: str = ""):
        return (prompt_text,)
