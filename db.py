import os
import sqlite3
import threading
from datetime import datetime

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(PLUGIN_DIR, "prompt_manager.db")

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
    return conn

def save_prompt(name: str, text: str) -> None:
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                INSERT INTO prompts(name, text) VALUES(?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    text = excluded.text,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (name, text),
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

def list_names() -> list:
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute(
                "SELECT name FROM prompts ORDER BY name"
            ).fetchall()
            return [r["name"] for r in rows]
        finally:
            conn.close()

def list_items(preview_len: int = 160) -> list:
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute(
                """
                SELECT name,
                       substr(text, 1, ?) AS preview,
                       length(text)       AS text_len,
                       updated_at
                FROM prompts
                ORDER BY name
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
                "SELECT name, text, created_at, updated_at FROM prompts ORDER BY name"
            ).fetchall()
            return {
                "version": 1,
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
                    INSERT INTO prompts(name, text) VALUES(?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        text = excluded.text,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (name, text),
                )
                imported += 1
            conn.commit()
        finally:
            conn.close()
    return {"imported": imported, "skipped": skipped}
