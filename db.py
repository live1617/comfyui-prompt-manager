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

def import_data(prompts: list, overwrite: bool = True) -> dict:
    imported, skipped = 0, 0
    with _lock:
        conn = get_conn()
        try:
            for item in prompts:
                name = (item.get("name") or "").strip()
                text = item.get("text") or ""
                if not name:
                    skipped += 1
                    continue
                exists = conn.execute(
                    "SELECT 1 FROM prompts WHERE name = ?", (name,)
                ).fetchone()
                if exists and not overwrite:
                    skipped += 1
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
                imported += 1
            conn.commit()
        finally:
            conn.close()
    return {"imported": imported, "skipped": skipped}
