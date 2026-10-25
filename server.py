#!/usr/bin/env python3
"""
ROLEAK server — accounts, shared videos, multi-page API.
Uses only the Python standard library (sqlite3 + http.server).

Run:
  python3 server.py
  → http://127.0.0.1:8765
"""

from __future__ import annotations

import cgi
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
THUMBS = DATA / "thumbs"
DB_PATH = DATA / "roleak.db"

HOST = os.environ.get("ROLEAK_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT") or os.environ.get("ROLEAK_PORT", "8765"))
ADMIN_USERNAME = "Scratch_Catalouge"
SESSION_DAYS = 30

DATA.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)
THUMBS.mkdir(exist_ok=True)


# ───────────────────────────── database ─────────────────────────────

def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                avatar_url TEXT,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                username TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                video_path TEXT NOT NULL,
                thumb_path TEXT,
                views INTEGER DEFAULT 0,
                is_hidden INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                username TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS likes (
                video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at REAL NOT NULL,
                PRIMARY KEY (video_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                username TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """
        )


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return secrets.compare_digest(hash_password(password, salt), stored)


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


# ───────────────────────────── helpers ─────────────────────────────

def json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def now() -> float:
    return time.time()


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def safe_filename(name: str) -> str:
    name = os.path.basename(name or "file")
    name = re.sub(r"[^\w.\-]+", "_", name)
    return name[:120] or "file"


def video_public(row: sqlite3.Row | dict, base: str = "") -> dict:
    d = dict(row) if not isinstance(row, dict) else row
    vid = d["id"]
    thumb = d.get("thumb_path")
    return {
        "id": vid,
        "title": d["title"],
        "description": d.get("description") or "",
        "username": d["username"],
        "views": d.get("views") or 0,
        "isHidden": bool(d.get("is_hidden")),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(d["created_at"])),
        "videoUrl": f"/media/videos/{vid}",
        "thumbnailUrl": f"/media/thumbs/{vid}" if thumb else "/DefaultThumbnail.png",
    }


# ───────────────────────────── handler ─────────────────────────────

class RoleakHandler(BaseHTTPRequestHandler):
    server_version = "ROLEAK/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    # ---- low-level IO ----

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _json_body(self) -> dict:
        raw = self._read_body()
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _send(self, code: int, body: bytes, content_type: str, extra_headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj, extra_headers: dict | None = None):
        self._send(code, json_bytes(obj), "application/json; charset=utf-8", extra_headers)

    def _error(self, code: int, message: str):
        self._json(code, {"error": message})

    def _cookie_token(self) -> str | None:
        cookie = self.headers.get("Cookie") or ""
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("roleak_session="):
                return part.split("=", 1)[1].strip()
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return None

    def _current_user(self) -> dict | None:
        token = self._cookie_token()
        if not token:
            return None
        with db() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.username, u.avatar_url
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ?
                """,
                (token, now()),
            ).fetchone()
        return row_to_dict(row)

    def _require_user(self) -> dict | None:
        user = self._current_user()
        if not user:
            self._error(401, "Login required")
            return None
        return user

    def _set_session_cookie(self, token: str, max_age: int):
        return {
            "Set-Cookie": (
                f"roleak_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
            )
        }

    def _clear_session_cookie(self):
        return {"Set-Cookie": "roleak_session=; Path=/; Max-Age=0"}

    # ---- routing ----

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_HEAD(self):
        self._dispatch("GET")

    def _dispatch(self, method: str):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        # API
        if path.startswith("/api/"):
            try:
                self._api(method, path, qs)
            except Exception as e:
                print("API error:", e)
                self._error(500, str(e))
            return

        # Media
        if path.startswith("/media/videos/"):
            return self._serve_media(path, UPLOADS, "videos")
        if path.startswith("/media/thumbs/"):
            return self._serve_media(path, THUMBS, "thumbs")

        # Static / pages
        self._serve_static(path)

    # ---- static files & pages ----

    def _serve_static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        # Simple multi-page routes
        page_map = {
            "/watch": "/index.html",
            "/login": "/index.html",
            "/register": "/index.html",
            "/upload": "/index.html",
            "/chat": "/index.html",
        }
        if path in page_map:
            path = page_map[path]
        if path.startswith("/watch/"):
            path = "/index.html"

        # Prevent path traversal
        rel = path.lstrip("/")
        if ".." in rel or rel.startswith("/"):
            return self._error(400, "Bad path")

        file_path = (ROOT / rel).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.is_file():
            # SPA fallback
            file_path = ROOT / "index.html"
            if not file_path.is_file():
                return self._error(404, "Not found")

        ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        if file_path.suffix == ".js":
            ctype = "text/javascript; charset=utf-8"
        elif file_path.suffix == ".css":
            ctype = "text/css; charset=utf-8"
        elif file_path.suffix == ".html":
            ctype = "text/html; charset=utf-8"

        data = file_path.read_bytes()
        self._send(200, data, ctype)

    def _serve_media(self, path: str, folder: Path, kind: str):
        # /media/videos/<id> or /media/thumbs/<id>
        parts = path.strip("/").split("/")
        if len(parts) < 3:
            return self._error(404, "Not found")
        vid = parts[2]
        with db() as conn:
            row = conn.execute("SELECT video_path, thumb_path FROM videos WHERE id = ?", (vid,)).fetchone()
        if not row:
            return self._error(404, "Not found")
        rel = row["video_path"] if kind == "videos" else row["thumb_path"]
        if not rel:
            if kind == "thumbs":
                fp = ROOT / "DefaultThumbnail.png"
                if fp.is_file():
                    data = fp.read_bytes()
                    return self._send(200, data, "image/png")
            return self._error(404, "Not found")
        fp = ROOT / rel
        if not fp.is_file():
            return self._error(404, "File missing")
        ctype = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
        data = fp.read_bytes()
        self._send(200, data, ctype, {"Accept-Ranges": "bytes"})

    # ---- API ----

    def _api(self, method: str, path: str, qs: dict):
        if path == "/api/health" and method == "GET":
            return self._json(200, {"ok": True, "service": "roleak"})

        if path == "/api/register" and method == "POST":
            return self._api_register()
        if path == "/api/login" and method == "POST":
            return self._api_login()
        if path == "/api/logout" and method == "POST":
            return self._api_logout()
        if path == "/api/me" and method == "GET":
            return self._api_me()

        if path == "/api/videos" and method == "GET":
            return self._api_list_videos(qs)
        if path == "/api/videos" and method == "POST":
            return self._api_upload_video()

        m = re.match(r"^/api/videos/([^/]+)$", path)
        if m and method == "GET":
            return self._api_get_video(m.group(1))
        if m and method == "PUT":
            return self._api_update_video(m.group(1))
        if m and method == "DELETE":
            return self._api_delete_video(m.group(1))

        m = re.match(r"^/api/videos/([^/]+)/view$", path)
        if m and method == "POST":
            return self._api_view_video(m.group(1))

        m = re.match(r"^/api/videos/([^/]+)/comments$", path)
        if m and method == "GET":
            return self._api_list_comments(m.group(1))
        if m and method == "POST":
            return self._api_add_comment(m.group(1))

        m = re.match(r"^/api/videos/([^/]+)/like$", path)
        if m and method == "POST":
            return self._api_toggle_like(m.group(1))

        if path == "/api/chat" and method == "GET":
            return self._api_list_chat()
        if path == "/api/chat" and method == "POST":
            return self._api_post_chat()
        m = re.match(r"^/api/chat/([^/]+)$", path)
        if m and method == "DELETE":
            return self._api_delete_chat(m.group(1))

        return self._error(404, f"Unknown API route: {path}")

    # ---- auth APIs ----

    def _api_register(self):
        body = self._json_body()
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if len(username) < 2:
            return self._error(400, "Username must be at least 2 characters")
        if len(password) < 3:
            return self._error(400, "Password must be at least 3 characters")
        avatar = f"https://api.dicebear.com/7.x/identicon/svg?seed={username}"
        try:
            with db() as conn:
                cur = conn.execute(
                    "INSERT INTO users (username, password_hash, avatar_url, created_at) VALUES (?,?,?,?)",
                    (username, hash_password(password), avatar, now()),
                )
                user_id = cur.lastrowid
                token = secrets.token_urlsafe(32)
                conn.execute(
                    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
                    (token, user_id, now() + SESSION_DAYS * 86400),
                )
        except sqlite3.IntegrityError:
            return self._error(409, "Username already taken")
        return self._json(
            201,
            {"username": username, "avatarUrl": avatar, "token": token, "isAdmin": username == ADMIN_USERNAME},
            self._set_session_cookie(token, SESSION_DAYS * 86400),
        )

    def _api_login(self):
        body = self._json_body()
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        with db() as conn:
            row = conn.execute(
                "SELECT id, username, password_hash, avatar_url FROM users WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                return self._error(401, "Invalid username or password")
            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
                (token, row["id"], now() + SESSION_DAYS * 86400),
            )
        return self._json(
            200,
            {
                "username": row["username"],
                "avatarUrl": row["avatar_url"],
                "token": token,
                "isAdmin": row["username"] == ADMIN_USERNAME,
            },
            self._set_session_cookie(token, SESSION_DAYS * 86400),
        )

    def _api_logout(self):
        token = self._cookie_token()
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return self._json(200, {"ok": True}, self._clear_session_cookie())

    def _api_me(self):
        user = self._current_user()
        if not user:
            return self._json(200, {"user": None})
        return self._json(
            200,
            {
                "user": {
                    "username": user["username"],
                    "avatarUrl": user["avatar_url"],
                    "isAdmin": user["username"] == ADMIN_USERNAME,
                }
            },
        )

    # ---- videos ----

    def _api_list_videos(self, qs: dict):
        q = (qs.get("q") or [""])[0].strip().lower()
        user = self._current_user()
        with db() as conn:
            rows = conn.execute(
                "SELECT * FROM videos ORDER BY created_at DESC"
            ).fetchall()
        out = []
        for r in rows:
            hidden = bool(r["is_hidden"])
            is_owner = user and user["username"] == r["username"]
            is_admin = user and user["username"] == ADMIN_USERNAME
            if hidden and not is_owner and not is_admin:
                continue
            item = video_public(r)
            if q and q not in (item["title"] + item["description"] + item["username"]).lower():
                continue
            out.append(item)
        return self._json(200, {"videos": out})

    def _api_get_video(self, vid: str):
        with db() as conn:
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
        if not row:
            return self._error(404, "Video not found")
        return self._json(200, {"video": video_public(row)})

    def _api_view_video(self, vid: str):
        with db() as conn:
            conn.execute("UPDATE videos SET views = views + 1 WHERE id = ?", (vid,))
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
        if not row:
            return self._error(404, "Video not found")
        return self._json(200, {"video": video_public(row)})

    def _api_upload_video(self):
        user = self._require_user()
        if not user:
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self._error(400, "Expected multipart/form-data")

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )

        title = (form.getvalue("title") or "").strip() or "Untitled"
        description = (form.getvalue("description") or "").strip()
        video_item = form["video"] if "video" in form else None
        thumb_item = form["thumbnail"] if "thumbnail" in form else None

        if video_item is None or not getattr(video_item, "file", None):
            return self._error(400, "Video file required")

        vid = new_id("v_")
        video_name = safe_filename(getattr(video_item, "filename", None) or "video.mp4")
        video_rel = f"data/uploads/{vid}_{video_name}"
        video_abs = ROOT / video_rel
        with open(video_abs, "wb") as f:
            f.write(video_item.file.read())

        thumb_rel = None
        if thumb_item is not None and getattr(thumb_item, "file", None):
            thumb_name = safe_filename(getattr(thumb_item, "filename", None) or "thumb.png")
            thumb_rel = f"data/thumbs/{vid}_{thumb_name}"
            with open(ROOT / thumb_rel, "wb") as f:
                f.write(thumb_item.file.read())

        with db() as conn:
            conn.execute(
                """
                INSERT INTO videos
                (id, user_id, username, title, description, video_path, thumb_path, views, is_hidden, created_at)
                VALUES (?,?,?,?,?,?,?,0,0,?)
                """,
                (vid, user["id"], user["username"], title, description, video_rel, thumb_rel, now()),
            )
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()

        return self._json(201, {"video": video_public(row)})

    def _api_update_video(self, vid: str):
        user = self._require_user()
        if not user:
            return
        body = self._json_body()
        with db() as conn:
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
            if not row:
                return self._error(404, "Video not found")
            if row["username"] != user["username"] and user["username"] != ADMIN_USERNAME:
                return self._error(403, "Not allowed")
            title = body.get("title", row["title"])
            description = body.get("description", row["description"])
            is_hidden = row["is_hidden"]
            if "isHidden" in body:
                is_hidden = 1 if body["isHidden"] else 0
            conn.execute(
                "UPDATE videos SET title=?, description=?, is_hidden=? WHERE id=?",
                (title, description, is_hidden, vid),
            )
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
        return self._json(200, {"video": video_public(row)})

    def _api_delete_video(self, vid: str):
        user = self._require_user()
        if not user:
            return
        with db() as conn:
            row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
            if not row:
                return self._error(404, "Video not found")
            if row["username"] != user["username"] and user["username"] != ADMIN_USERNAME:
                return self._error(403, "Not allowed")
            for rel in (row["video_path"], row["thumb_path"]):
                if rel:
                    try:
                        (ROOT / rel).unlink(missing_ok=True)
                    except Exception:
                        pass
            conn.execute("DELETE FROM videos WHERE id = ?", (vid,))
        return self._json(200, {"ok": True})

    # ---- comments / likes ----

    def _api_list_comments(self, vid: str):
        with db() as conn:
            rows = conn.execute(
                "SELECT * FROM comments WHERE video_id = ? ORDER BY created_at ASC",
                (vid,),
            ).fetchall()
        comments = [
            {
                "id": r["id"],
                "username": r["username"],
                "text": r["text"],
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r["created_at"])),
            }
            for r in rows
        ]
        return self._json(200, {"comments": comments})

    def _api_add_comment(self, vid: str):
        user = self._require_user()
        if not user:
            return
        body = self._json_body()
        text = (body.get("text") or "").strip()
        if not text:
            return self._error(400, "Empty comment")
        if len(text) > 1000:
            return self._error(400, "Comment too long")
        cid = new_id("c_")
        with db() as conn:
            if not conn.execute("SELECT 1 FROM videos WHERE id = ?", (vid,)).fetchone():
                return self._error(404, "Video not found")
            conn.execute(
                "INSERT INTO comments (id, video_id, user_id, username, text, created_at) VALUES (?,?,?,?,?,?)",
                (cid, vid, user["id"], user["username"], text, now()),
            )
        return self._json(
            201,
            {
                "comment": {
                    "id": cid,
                    "username": user["username"],
                    "text": text,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now())),
                }
            },
        )

    def _api_toggle_like(self, vid: str):
        user = self._require_user()
        if not user:
            return
        with db() as conn:
            if not conn.execute("SELECT 1 FROM videos WHERE id = ?", (vid,)).fetchone():
                return self._error(404, "Video not found")
            existing = conn.execute(
                "SELECT 1 FROM likes WHERE video_id = ? AND user_id = ?",
                (vid, user["id"]),
            ).fetchone()
            if existing:
                conn.execute(
                    "DELETE FROM likes WHERE video_id = ? AND user_id = ?",
                    (vid, user["id"]),
                )
                liked = False
            else:
                conn.execute(
                    "INSERT INTO likes (video_id, user_id, created_at) VALUES (?,?,?)",
                    (vid, user["id"], now()),
                )
                liked = True
            count = conn.execute(
                "SELECT COUNT(*) AS c FROM likes WHERE video_id = ?", (vid,)
            ).fetchone()["c"]
        return self._json(200, {"liked": liked, "count": count})

    # ---- chat ----

    def _api_list_chat(self):
        with db() as conn:
            rows = conn.execute(
                "SELECT * FROM messages ORDER BY created_at ASC LIMIT 200"
            ).fetchall()
        messages = [
            {
                "id": r["id"],
                "username": r["username"],
                "text": r["text"],
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r["created_at"])),
            }
            for r in rows
        ]
        return self._json(200, {"messages": messages})

    def _api_post_chat(self):
        user = self._require_user()
        if not user:
            return
        body = self._json_body()
        text = (body.get("text") or "").strip()
        if not text:
            return self._error(400, "Empty message")
        if len(text) > 500:
            return self._error(400, "Message too long")
        mid = new_id("m_")
        with db() as conn:
            conn.execute(
                "INSERT INTO messages (id, user_id, username, text, created_at) VALUES (?,?,?,?,?)",
                (mid, user["id"], user["username"], text, now()),
            )
        return self._json(
            201,
            {
                "message": {
                    "id": mid,
                    "username": user["username"],
                    "text": text,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now())),
                }
            },
        )

    def _api_delete_chat(self, mid: str):
        user = self._require_user()
        if not user:
            return
        if user["username"] != ADMIN_USERNAME:
            return self._error(403, "Admin only")
        with db() as conn:
            conn.execute("DELETE FROM messages WHERE id = ?", (mid,))
        return self._json(200, {"ok": True})


def main():
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), RoleakHandler)
    print(f"ROLEAK server running at http://127.0.0.1:{PORT}")
    print("  Accounts, shared videos, chat — data in ./data/")
    print("  Press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.server_close()


if __name__ == "__main__":
    main()
