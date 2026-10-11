# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 comfyui-prompt-manager contributors
import contextlib
import glob
import hashlib
import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
LEGACY_DB_PATH = os.path.join(PLUGIN_DIR, "prompt_manager.db")
DB_SUBDIR = "comfyui-prompt-manager"

DEFAULT_CATEGORY = "默认"

_lock = threading.Lock()


def _user_data_dir():
    """取 ComfyUI 的 user 数据目录; 取不到返回 None"""
    try:
        import folder_paths

        p = folder_paths.get_user_directory()
        if p and os.path.isdir(p):
            return p
    except Exception:
        pass
    # 回退: 插件在 ComfyUI/custom_nodes/<本插件>, 往上两级是 ComfyUI 根目录
    try:
        base = os.path.dirname(os.path.dirname(PLUGIN_DIR))
        p = os.path.join(base, "user", "default")
        if os.path.isdir(p):
            return p
    except Exception:
        pass
    return None


def _migrate_copy(src: str, dst: str) -> None:
    """把旧库搬到新位置

    走 WAL 的库, 最近的写入可能还在 src-wal 里没合并进主文件, 直接 copy2 会丢数据,
    所以那种情况改用 sqlite3 的 backup API (拿到的是一致快照, 连带 -wal 内容)。
    非 WAL 库 (旧版本建的都属此类) 用 copy2 最省事。
    """
    if os.path.isfile(src + "-wal"):
        s = sqlite3.connect(src)
        try:
            d = sqlite3.connect(dst)
            try:
                with d:
                    s.backup(d)
            finally:
                d.close()
        finally:
            s.close()
    else:
        shutil.copy2(src, dst)


def _resolve_db_path() -> str:
    """
    数据库放在 ComfyUI 的 user 目录下, 不放在插件安装目录里。

    原因: 更新插件最常见的做法是「删掉旧文件夹、解压新版」, 数据库放在
    安装目录里会被一起删掉, 积攒的提示词无法找回。

    规则:
      1. user 目录可用 → <user>/comfyui-prompt-manager/prompt_manager.db
      2. 目标不存在但插件目录里有旧库 → 自动复制迁移, 旧库保留当备份
      3. user 目录不可用 → 退回插件目录 (旧行为), 保证插件不会挂

    环境变量 PM_DB_PATH 优先级最高, 便于自定义位置与单元测试。
    """
    env = (os.environ.get("PM_DB_PATH") or "").strip()
    if env:
        return os.path.abspath(env)
    try:
        base = _user_data_dir()
        if base:
            target_dir = os.path.join(base, DB_SUBDIR)
            os.makedirs(target_dir, exist_ok=True)
            target = os.path.join(target_dir, "prompt_manager.db")
            if not os.path.exists(target) and os.path.isfile(LEGACY_DB_PATH):
                try:
                    _migrate_copy(LEGACY_DB_PATH, target)
                    print(
                        f"[PromptManager] 数据库已迁移到 {target}\n"
                        f"[PromptManager] 插件目录里的旧库保留未删, 确认无误后可手工删除"
                    )
                except Exception as e:
                    print(f"[PromptManager] 迁移数据库失败, 沿用旧位置: {e}")
                    return LEGACY_DB_PATH
            return target
    except Exception:
        pass
    return LEGACY_DB_PATH


DB_PATH = _resolve_db_path()

# ---- 连接参数 ----
# WAL 让「读」不再阻塞「写」: 列表翻页 / 查重这类查询与保存写入可以并行, 不用互相等锁。
# journal_mode 是写进库文件本身的, 设一次就长期有效; 但每次连接仍旧设一遍, 免得
# 用到别人留下的非 WAL 库 (例如手工换过一个旧库进来)。
# 代价: 库文件旁边会多出 -wal / -shm 两个附属文件(正常关闭会自动合并回去), 因此
# 「直接复制 .db 就算备份」的做法在 WAL 下不再可靠 —— README 已注明要带附属文件。
DB_BUSY_TIMEOUT_MS = 5000


def _apply_pragmas(conn) -> None:
    """每次连接都套一遍连接参数; 任何一条失败都不影响使用, 故整体吞异常"""
    for sql in (
        "PRAGMA journal_mode=WAL",
        "PRAGMA synchronous=NORMAL",  # WAL 下 NORMAL 已足够安全, 比 FULL 快很多
        "PRAGMA busy_timeout={}".format(DB_BUSY_TIMEOUT_MS),
        "PRAGMA temp_store=MEMORY",
    ):
        try:
            conn.execute(sql)
        except Exception:
            pass


# ---- 自动备份 ----
# 提示词的保存是覆盖式的, 导出 JSON 又几乎没人会定期去做。这里在每次写操作
# 「之前」自动给数据库留一份快照, 万一覆盖/删错可以回到上一步。
BACKUP_KEEP = 10           # 最多保留几份 (每份约等于一个 db 的大小)
BACKUP_MIN_INTERVAL = 60   # 两次快照的最小间隔(秒), 免得连点保存刷出一堆文件
_backup_last_ts = 0.0


def _backup_enabled() -> bool:
    return (os.environ.get("PM_BACKUP") or "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def snapshot_db() -> str:
    """
    给当前数据库留一份**写操作之前**的一致性快照, 返回快照路径(失败返回空串)。

    用 sqlite3 自带的 backup API 而不是复制文件: 拿到的是事务一致状态, 也避开
    Windows 上「打开中的 sqlite 文件不能改名/删除」的坑。
    备份是尽力而为的附属功能 —— 任何失败都静默吞掉, 绝不影响主流程。
    """
    global _backup_last_ts
    if not _backup_enabled():
        return ""
    now = time.time()
    if _backup_last_ts and now - _backup_last_ts < BACKUP_MIN_INTERVAL:
        return ""
    if not os.path.isfile(DB_PATH):
        return ""  # 还没建过库 (首次保存), 没什么可备份
    try:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = f"{DB_PATH}.{stamp}.bak"
        n = 1
        while os.path.exists(target):  # 同一秒内连来两次, 加序号避免互相覆盖
            n += 1
            target = f"{DB_PATH}.{stamp}_{n}.bak"
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(target)
        try:
            with dst:
                src.backup(dst)
        finally:
            src.close()
            dst.close()
        _backup_last_ts = now
        _prune_backups()
        return target
    except Exception:
        return ""


def _prune_backups() -> None:
    """只保留最近 BACKUP_KEEP 份快照 (文件名带时间戳, 字典序 = 时间序)"""
    try:
        files = sorted(glob.glob(f"{DB_PATH}.*.bak"))
        for old in files[: max(0, len(files) - BACKUP_KEEP)]:
            try:
                os.remove(old)
            except OSError:
                pass
    except Exception:
        pass


@contextlib.contextmanager
def _write():
    """所有写操作的统一入口: 进入锁之后、真正动手之前, 先给库留一份快照"""
    with _lock:
        snapshot_db()
        yield


# ---- 完整性巡检 ----
def check_integrity(full: bool = False):
    """检查数据库文件是否损坏, 返回 (ok: bool, detail: str)

    默认 quick_check —— 比 integrity_check 快得多, 能抓出绝大多数损坏;
    库很小, 这点开销可以忽略。只读打开, 不会影响正在进行的读写。
    """
    if not os.path.isfile(DB_PATH):
        return True, "尚未建库"
    try:
        conn = sqlite3.connect(DB_PATH, timeout=DB_BUSY_TIMEOUT_MS / 1000.0)
        try:
            sql = "PRAGMA integrity_check" if full else "PRAGMA quick_check"
            rows = conn.execute(sql).fetchall()
        finally:
            conn.close()
    except Exception as e:
        return False, "{}: {}".format(type(e).__name__, e)
    text = "; ".join(str(r[0]) for r in rows) if rows else ""
    return text.strip().lower() == "ok", text


def db_health() -> dict:
    """自检信息 (给 /prompt_manager/health 与排查用)"""
    info = {
        "path": DB_PATH,
        "exists": os.path.isfile(DB_PATH),
        "size": 0,
        "journal_mode": "",
        "backups": 0,
    }
    try:
        info["backups"] = len(glob.glob("{}.*.bak".format(DB_PATH)))
        if info["exists"]:
            info["size"] = os.path.getsize(DB_PATH)
            # WAL 模式下未合并进主文件的数据在这里
            for suffix in ("-wal", "-shm"):
                p = DB_PATH + suffix
                if os.path.isfile(p):
                    info["size_wal_" + suffix.strip("-")] = os.path.getsize(p)
        conn = sqlite3.connect(DB_PATH, timeout=DB_BUSY_TIMEOUT_MS / 1000.0)
        try:
            info["journal_mode"] = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
    except Exception as e:
        info["error"] = "{}: {}".format(type(e).__name__, e)
    return info


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=DB_BUSY_TIMEOUT_MS / 1000.0)
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn)
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
    _ensure_content_hash(conn, cols)
    return conn


def _ensure_content_hash(conn, cols=None) -> None:
    """content_hash 列 + 索引, 缺内容的历史行补算一次。

    有了这一列, 「内容是否重复」可以走索引比较 (WHERE content_hash = ?),
    不必每次把整个表的 text 读进内存再逐条归一化。
    """
    if cols is None:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(prompts)").fetchall()]
    if "content_hash" not in cols:
        conn.execute("ALTER TABLE prompts ADD COLUMN content_hash TEXT")
        conn.commit()
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_prompts_content_hash ON prompts(content_hash)"
    )
    _backfill_content_hash(conn)


_hash_backfilled = False


def _backfill_content_hash(conn) -> None:
    """老库升级: 给没有哈希的行补上 (每个进程只做一次)"""
    global _hash_backfilled
    if _hash_backfilled:
        return
    try:
        rows = conn.execute(
            "SELECT id, text FROM prompts WHERE content_hash IS NULL"
        ).fetchall()
        for r in rows:
            conn.execute(
                "UPDATE prompts SET content_hash = ? WHERE id = ?",
                (_content_hash(r["text"]), r["id"]),
            )
        if rows:
            conn.commit()
    except Exception:
        pass
    _hash_backfilled = True

def normalize_category(category) -> str:
    c = (category or "").strip() if isinstance(category, str) else ""
    return c or DEFAULT_CATEGORY

def save_prompt(name: str, text: str, category: str = None) -> None:
    cat = normalize_category(category)
    with _write():
        conn = get_conn()
        try:
            conn.execute(
                """
                INSERT INTO prompts(name, text, category, content_hash) VALUES(?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    text = excluded.text,
                    category = excluded.category,
                    content_hash = excluded.content_hash,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (name, text, cat, _content_hash(text)),
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
    with _write():
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
    with _write():
        conn = get_conn()
        try:
            cur = conn.execute("DELETE FROM prompts WHERE name = ?", (name,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

def _search_clause(q):
    """关键字搜索条件: 名称或正文包含该关键字。

    SQLite 的 LIKE 对 ASCII 本身就不区分大小写; 中文不受影响。
    % 和 _ 是 LIKE 的通配符, 用户输入里的这两个字符先剔掉, 免得变成通配符。
    """
    kw = (q or "").strip().replace("%", "").replace("_", "")
    if not kw:
        return "", []
    like = "%" + kw + "%"
    return " AND (name LIKE ? OR text LIKE ?)", [like, like]


def _page_sql(limit, offset):
    """LIMIT / OFFSET 子句; limit <= 0 表示不限 (返回全部)"""
    if not limit or limit <= 0:
        return "", []
    return " LIMIT ? OFFSET ?", [int(limit), max(0, int(offset or 0))]


def find_duplicates(preview_len: int = 120, q=None, limit: int = 0, offset: int = 0) -> list:
    """按内容查重, 返回内容完全相同的提示词组。

    走 content_hash 索引在 SQL 里分组 (不再把整表读进内存逐条归一化):
      先按哈希筛出「重复的组」, 只把当前页这几组的具体条目取出来。
    limit<=0 表示不限; q 是可选关键字, 先按关键字过滤再分组。
    """
    with _lock:
        conn = get_conn()
        try:
            where, wargs = _search_clause(q)
            group_rows = conn.execute(
                """
                SELECT content_hash AS h, COUNT(*) AS c, MIN(name) AS first_name
                FROM prompts
                WHERE content_hash IS NOT NULL AND content_hash <> ''{}
                GROUP BY content_hash
                HAVING COUNT(*) > 1
                ORDER BY c DESC, first_name
                """.format(where),
                wargs,
            ).fetchall()
            page_sql, page_args = _page_sql(limit, offset)
            if page_sql:
                group_rows = conn.execute(
                    """
                    SELECT content_hash AS h, COUNT(*) AS c, MIN(name) AS first_name
                    FROM prompts
                    WHERE content_hash IS NOT NULL AND content_hash <> ''{}
                    GROUP BY content_hash
                    HAVING COUNT(*) > 1
                    ORDER BY c DESC, first_name{}
                    """.format(where, page_sql),
                    wargs + page_args,
                ).fetchall()

            result = []
            for g in group_rows:
                rows = conn.execute(
                    """
                    SELECT name, category, text, length(text) AS text_len, updated_at
                    FROM prompts
                    WHERE content_hash = ?
                    ORDER BY name
                    """,
                    (g["h"],),
                ).fetchall()
                if len(rows) < 2:
                    continue
                items = [
                    {
                        "name": r["name"],
                        "category": r["category"] or DEFAULT_CATEGORY,
                        "text_len": r["text_len"],
                        "updated_at": r["updated_at"] or "",
                    }
                    for r in rows
                ]
                result.append(
                    {
                        "preview": _norm_text(rows[0]["text"])[:preview_len],
                        "text_len": items[0]["text_len"],
                        "count": len(items),
                        "items": items,
                    }
                )
            return result
        finally:
            conn.close()


def count_duplicate_groups(q=None) -> int:
    """内容重复的「组」有多少个 (配合 find_duplicates 的 limit/offset 分页)"""
    with _lock:
        conn = get_conn()
        try:
            where, wargs = _search_clause(q)
            row = conn.execute(
                """
                SELECT COUNT(*) AS n FROM (
                    SELECT content_hash
                    FROM prompts
                    WHERE content_hash IS NOT NULL AND content_hash <> ''{}
                    GROUP BY content_hash
                    HAVING COUNT(*) > 1
                )
                """.format(where),
                wargs,
            ).fetchone()
            return row["n"] if row else 0
        finally:
            conn.close()


def delete_prompts(names: list) -> int:
    clean = [n for n in (names or []) if isinstance(n, str) and n.strip()]
    if not clean:
        return 0
    with _write():
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
    with _write():
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
    with _write():
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
    with _write():
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
    with _write():
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
    with _write():
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

def list_items(
    preview_len: int = 160,
    category: str = None,
    q: str = None,
    limit: int = 0,
    offset: int = 0,
) -> list:
    """提示词列表 (可按分类 / 关键字过滤, 可分页)。

    limit<=0 表示不限 (默认, 与旧行为一致); offset 从 0 开始。
    """
    with _lock:
        conn = get_conn()
        try:
            _ensure_category_rows(conn)
            where, wargs = _search_clause(q)
            params = [preview_len] + wargs
            if category:
                where += " AND category = ?"
                wargs = wargs + [normalize_category(category)]
                params = [preview_len] + wargs
            page_sql, page_args = _page_sql(limit, offset)
            rows = conn.execute(
                """
                SELECT name,
                       category,
                       substr(text, 1, ?) AS preview,
                       length(text)       AS text_len,
                       updated_at
                FROM prompts
                WHERE 1 = 1{}
                ORDER BY (
                           SELECT COALESCE(c.sort_order, 999999)
                           FROM pm_categories c
                           WHERE c.name = prompts.category
                       ),
                       category,
                       name{}
                """.format(where, page_sql),
                params + page_args,
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def count_items(category: str = None, q: str = None) -> int:
    """列表总数 (与 list_items 的过滤条件保持一致, 供前端分页用)"""
    with _lock:
        conn = get_conn()
        try:
            where, wargs = _search_clause(q)
            params = list(wargs)
            if category:
                where += " AND category = ?"
                params = wargs + [normalize_category(category)]
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM prompts WHERE 1 = 1{}".format(where),
                params,
            ).fetchone()
            return row["n"] if row else 0
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


def _content_hash(text) -> str:
    """内容指纹: 归一化文本的 sha1 (空内容返回空串, 空内容不参与判重)"""
    body = _norm_text(text)
    if not body:
        return ""
    return hashlib.sha1(body.encode("utf-8")).hexdigest()


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
    with _write():
        conn = get_conn()
        try:
            stored = {}       # 库中 name -> 原文
            for r in conn.execute("SELECT name, text FROM prompts"):
                stored[r["name"]] = r["text"] or ""

            def body_exists(body) -> bool:
                """内容是否已存在: 走 content_hash 索引, 不用把全表读进内存"""
                if not body:
                    return False
                return (
                    conn.execute(
                        "SELECT 1 FROM prompts WHERE content_hash = ? LIMIT 1",
                        (_content_hash(body),),
                    ).fetchone()
                    is not None
                )

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
                elif dedupe_by_content and body_exists(body):
                    # 名字不同但内容完全一样 → 视为重复, 跳过
                    skipped_content += 1
                    continue

                conn.execute(
                    """
                    INSERT INTO prompts(name, text, category, content_hash) VALUES(?, ?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET
                        text = excluded.text,
                        category = excluded.category,
                        content_hash = excluded.content_hash,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        name,
                        text,
                        normalize_category(item.get("category")),
                        _content_hash(text),
                    ),
                )
                taken.add(name)
                stored[name] = text
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
