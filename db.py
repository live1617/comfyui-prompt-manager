# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 comfyui-prompt-manager contributors
import os
import sqlite3
import threading
from datetime import datetime

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(PLUGIN_DIR, "prompt_manager.db")

DEFAULT_CATEGORY = "默认"

_lock = threading.Lock()

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prompts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT UNIQUE NOT NULL,
            text       TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pm_categories (
            name       TEXT UNIQUE NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cat_cols = [r["name"] for r in conn.execute("PRAGMA table_info(pm_categories)").fetchall()]
    if "sort_order" not in cat_cols:
        conn.execute("ALTER TABLE pm_categories ADD COLUMN sort_order INTEGER DEFAULT 0")
        conn.commit()
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(prompts)").fetchall()]
    if "category" not in cols:
        conn.execute(
            "ALTER TABLE prompts ADD COLUMN category TEXT NOT NULL DEFAULT '{}'".format(
                DEFAULT_CATEGORY.replace("'", "''")
            )
        )
        conn.execute("UPDATE prompts SET category = ? WHERE category IS NULL OR category = ''", (DEFAULT_CATEGORY,))
        conn.commit()
    return conn

def normalize_category(category) -> str:
    c = (category or "").strip() if isinstance(category, str) else ""
    return c or DEFAULT_CATEGORY

def save_prompt(name: str, text: str, category: str = None) -> None:
    cat = normalize_category(category)
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                INSERT INTO prompts(name, text, category) VALUES(?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    text = excluded.text,
                    category = excluded.category,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (name, text, cat),
            )
            conn.commit()
        finally:
            conn.close()

def load_prompt(name: str):
    with _lock:
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT text FROM prompts WHERE name = ?", (name,)
            ).fetchone()
            return row["text"] if row else None
        finally:
            conn.close()

def rename_prompt(name: str, new_name: str) -> bool:
    new = (new_name or "").strip()
    if not new:
        return False
    with _lock:
        conn = get_conn()
        try:
            exists = conn.execute(
                "SELECT 1 FROM prompts WHERE name = ?", (new,)
            ).fetchone()
            if exists:
                return False
            cur = conn.execute(
                "UPDATE prompts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
                (new, name),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def delete_prompt(name: str) -> bool:
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute("DELETE FROM prompts WHERE name = ?", (name,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def find_duplicates(preview_len: int = 120) -> list:
    """按内容查重, 返回内容完全相同的提示词组。

    内容比较用 _norm_text 归一化 (统一换行符 + 去首尾空白)。
    名称由数据库 UNIQUE 约束保证不重复 (保存/导入时都不允许重名), 因此不做同名检查。
    """
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute(
                """
                SELECT name,
                       category,
                       text,
                       length(text) AS text_len,
                       updated_at
                FROM prompts
                """
            ).fetchall()
        finally:
            conn.close()

    groups = {}
    for r in rows:
        body = _norm_text(r["text"])
        if not body:
            continue
        groups.setdefault(body, []).append(
            {
                "name": r["name"],
                "category": r["category"] or DEFAULT_CATEGORY,
                "text_len": r["text_len"],
                "updated_at": r["updated_at"] or "",
            }
        )

    result = []
    for body, items in groups.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: x["name"])
        result.append(
            {
                "preview": body[:preview_len],
                "text_len": items[0]["text_len"],
                "count": len(items),
                "items": items,
            }
        )
    result.sort(key=lambda g: (-g["count"], g["preview"]))
    return result


def delete_prompts(names: list) -> int:
    clean = [n for n in (names or []) if isinstance(n, str) and n.strip()]
    if not clean:
        return 0
    with _lock:
        conn = get_conn()
        try:
            marks = ",".join("?" * len(clean))
            cur = conn.execute(
                f"DELETE FROM prompts WHERE name IN ({marks})", clean
            )
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


def move_prompt(name: str, category: str) -> bool:
    cat = normalize_category(category)
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(
                "UPDATE prompts SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
                (cat, name),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def list_names(category: str = None) -> list:
    with _lock:
        conn = get_conn()
        try:
            if category:
                rows = conn.execute(
                    "SELECT name FROM prompts WHERE category = ? ORDER BY name",
                    (normalize_category(category),),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT name FROM prompts ORDER BY name"
                ).fetchall()
            return [r["name"] for r in rows]
        finally:
            conn.close()

def add_category(name: str) -> bool:
    cat = normalize_category(name)
    if cat == DEFAULT_CATEGORY:
        return False
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            cur = conn.execute(
                "INSERT OR IGNORE INTO pm_categories(name, sort_order) VALUES(?, ?)",
                (cat, _next_order(conn)),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def _next_order(conn) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM pm_categories"
    ).fetchone()
    return (row["m"] if row else 0) + 1

def _ensure_category_rows(conn) -> None:
    nxt = _next_order(conn)
    rows = conn.execute("SELECT DISTINCT category FROM prompts").fetchall()
    for r in rows:
        cat = normalize_category(r["category"])
        cur = conn.execute(
            "INSERT OR IGNORE INTO pm_categories(name, sort_order) VALUES(?, ?)",
            (cat, nxt),
        )
        if cur.rowcount:
            nxt += 1

def rename_category(old: str, new: str) -> bool:
    o = normalize_category(old)
    n = normalize_category(new)
    if o == n:
        return False
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            conflict = conn.execute(
                "SELECT 1 FROM pm_categories WHERE name = ?", (n,)
            ).fetchone()
            conn.execute("UPDATE prompts SET category = ? WHERE category = ?", (n, o))
            if conflict:
                conn.execute("DELETE FROM pm_categories WHERE name = ?", (o,))
            else:
                conn.execute(
                    "UPDATE pm_categories SET name = ? WHERE name = ?", (n, o)
                )
            conn.commit()
            return True
        finally:
            conn.close()

def delete_category(name: str, delete_prompts: bool = False) -> dict:
    cat = normalize_category(name)
    result = {"deleted": 0, "moved": 0}
    with _lock:
        conn = get_conn()
        try:
            if delete_prompts:
                cur = conn.execute("DELETE FROM prompts WHERE category = ?", (cat,))
                result["deleted"] = cur.rowcount
            else:
                cur = conn.execute(
                    "UPDATE prompts SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?",
                    (DEFAULT_CATEGORY, cat),
                )
                result["moved"] = cur.rowcount
                conn.execute(
                    "INSERT OR IGNORE INTO pm_categories(name, sort_order) VALUES(?, ?)",
                    (DEFAULT_CATEGORY, _next_order(conn)),
                )
            conn.execute("DELETE FROM pm_categories WHERE name = ?", (cat,))
            conn.commit()
            return result
        finally:
            conn.close()

def set_category_order(names: list) -> None:
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            for i, n in enumerate(names or []):
                cat = normalize_category(n)
                cur = conn.execute(
                    "UPDATE pm_categories SET sort_order = ? WHERE name = ?", (i, cat)
                )
                if not cur.rowcount:
                    conn.execute(
                        "INSERT OR IGNORE INTO pm_categories(name, sort_order) VALUES(?, ?)",
                        (cat, i),
                    )
            conn.commit()
        finally:
            conn.close()

def list_categories() -> list:
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            rows = conn.execute(
                """
                SELECT c.name AS name,
                       (SELECT COUNT(*) FROM prompts p WHERE p.category = c.name) AS count,
                       c.sort_order AS sort_order
                FROM pm_categories c
                ORDER BY c.sort_order, c.name
                """
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

def list_items(preview_len: int = 160) -> list:
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            rows = conn.execute(
                """
                SELECT name,
                       category,
                       substr(text, 1, ?) AS preview,
                       length(text)       AS text_len,
                       updated_at
                FROM prompts
                ORDER BY (
                           SELECT COALESCE(c.sort_order, 999999)
                           FROM pm_categories c
                           WHERE c.name = prompts.category
                       ),
                       category,
                       name
                """,
                (preview_len,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

def export_all() -> dict:
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute(
                "SELECT name, text, category, created_at, updated_at FROM prompts ORDER BY category, name"
            ).fetchall()
            return {
                "version": 2,
                "exported_at": datetime.now().isoformat(),
                "prompts": [dict(r) for r in rows],
            }
        finally:
            conn.close()

def _norm_text(text) -> str:
    """内容判重用的归一化: 统一换行符 + 去首尾空白 (与排重复的 trim 语义一致)"""
    return (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _suggest_import_name(base: str, taken: set) -> str:
    """冲突改名建议: 原名后加 (2) / (3) ... 直到不与已有名字撞车"""
    i = 2
    while True:
        cand = "{} ({})".format(base, i)
        if cand not in taken:
            return cand
        i += 1


def import_data(
    prompts: list,
    overwrite: bool = False,
    dedupe_by_content: bool = True,
    preview_len: int = 120,
) -> dict:
    """导入提示词。

    默认策略 = 纯增加:
      - 名称为空            → 跳过 (无效条目)
      - 库里已有同名且内容相同 → 跳过 (真重复)
      - 库里已有同名但内容不同 → 冲突: 不导入, 返回到 conflicts 里让前端提示改名
      - 内容已存在 (归一化后与库中任一条完全相同) → 跳过
      - 文件内部自重复      → 只入第一条
      - 其余                → 新增
    overwrite=True 时不按名称跳过, 同名会被覆盖更新 (内容判重仍然生效)。
    """
    imported = 0
    skipped_empty = 0     # 名称为空
    skipped_name = 0      # 与库中同名且内容相同
    skipped_content = 0   # 内容已存在 (库里或文件内)
    conflicts = []        # 同名但内容不同: 需改名后再导入
    with _lock:
        conn = get_conn()
        try:
            stored = {}       # 库中 name -> 原文
            body_set = set()
            for r in conn.execute("SELECT name, text FROM prompts"):
                stored[r["name"]] = r["text"] or ""
                body = _norm_text(r["text"])
                if body:
                    body_set.add(body)

            taken = set(stored.keys())

            for item in prompts:
                name = (item.get("name") or "").strip()
                text = item.get("text") or ""
                if not name:
                    skipped_empty += 1
                    continue
                body = _norm_text(text)

                if name in taken and name in stored:
                    if overwrite:
                        pass  # 覆盖模式: 直接走下面的 upsert
                    elif body == _norm_text(stored[name]):
                        # 同名同内容 → 真重复, 跳过
                        skipped_name += 1
                        continue
                    else:
                        # 同名但内容不同 → 交给用户改名
                        suggested = _suggest_import_name(name, taken)
                        taken.add(suggested)
                        conflicts.append(
                            {
                                "name": name,
                                "suggested": suggested,
                                "text": text,
                                "category": normalize_category(item.get("category")),
                                "existing_preview": _norm_text(stored[name])[:preview_len],
                                "incoming_preview": body[:preview_len],
                            }
                        )
                        continue
                elif dedupe_by_content and body and body in body_set:
                    # 名字不同但内容完全一样 → 视为重复, 跳过
                    skipped_content += 1
                    continue

                conn.execute(
                    """
                    INSERT INTO prompts(name, text, category) VALUES(?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        text = excluded.text,
                        category = excluded.category,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (name, text, normalize_category(item.get("category"))),
                )
                taken.add(name)
                stored[name] = text
                if body:
                    body_set.add(body)
                imported += 1
            conn.commit()
        finally:
            conn.close()
    return {
        "imported": imported,
        "skipped": skipped_empty + skipped_name + skipped_content,
        "skipped_empty": skipped_empty,
        "skipped_name": skipped_name,
        "skipped_content": skipped_content,
        "conflicted": len(conflicts),
        "conflicts": conflicts,
    }
