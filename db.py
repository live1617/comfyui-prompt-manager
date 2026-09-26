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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
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
            cur = conn.execute(
                "INSERT OR IGNORE INTO pm_categories(name) VALUES(?)", (cat,)
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def list_categories() -> list:
    with _lock:
        conn = get_conn()
        try:
            counts = {
                r["category"]: r["count"]
                for r in conn.execute(
                    "SELECT category, COUNT(*) AS count FROM prompts GROUP BY category"
                ).fetchall()
            }
            names = set(counts) | {
                r["name"] for r in conn.execute("SELECT name FROM pm_categories").fetchall()
            }
            names.discard("")
            ordered = sorted(
                names,
                key=lambda n: (0 if n == DEFAULT_CATEGORY else 1, n),
            )
            return [{"name": n, "count": counts.get(n, 0)} for n in ordered]
        finally:
            conn.close()

def list_items(preview_len: int = 160) -> list:
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute(
                """
                SELECT name,
                       category,
                       substr(text, 1, ?) AS preview,
                       length(text)       AS text_len,
                       updated_at
                FROM prompts
                ORDER BY category, name
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
