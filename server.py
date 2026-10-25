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
import shutil
import sqlite3
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
# Point ROLEAK_DATA_DIR at a persistent disk/volume in production so the
# database and uploads survive redeploys.
DATA = Path(os.environ.get("ROLEAK_DATA_DIR") or (ROOT / "data")).resolve()
UPLOADS = DATA / "uploads"
THUMBS = DATA / "thumbs"
DB_PATH = DATA / "roleak.db"

HOST = os.environ.get("ROLEAK_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT") or os.environ.get("ROLEAK_PORT", "8765"))
ADMIN_USERNAME = os.environ.get("ROLEAK_ADMIN_USERNAME", "Scratch_Catalouge")
SESSION_DAYS = 30
MAX_UPLOAD_BYTES = int(os.environ.get("ROLEAK_MAX_UPLOAD_MB", "200")) * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024

VIDEO_TYPES = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}
THUMB_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif"}
CT_TO_VIDEO_EXT = {v: k for k, v in VIDEO_TYPES.items()}
CT_TO_THUMB_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif"}

# Only these file types are ever served as static site files.
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
    ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2",
}

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{2,32}$")

DATA.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(exist_ok=True)
THUMBS.mkdir(exist_ok=True)


def is_admin_name(name: str | None) -> bool:
    return bool(name) and name.lower() == ADMIN_USERNAME.lower()


def data_path(rel: str | None) -> Path | None:
    """Resolve a stored relative path inside DATA (never outside it)."""
    if not rel:
        return None
    if rel.startswith("data/"):  # legacy rows
        rel = rel[5:]
    fp = (DATA / rel).resolve()
    if fp != DATA and DATA not in fp.parents:
        return None
    return fp


_rate_lock = threading.Lock()
_rate_hits: dict[str, list[float]] = {}
_view_seen: dict[tuple[str, str], float] = {}


def rate_limited(key: str, limit: int, window: float) -> bool:
    """True if `key` already made `limit` hits within `window` seconds (and records this hit otherwise)."""
    t = time.time()
    with _rate_lock:
        hits = [h for h in _rate_hits.get(key, []) if t - h < window]
        if len(hits) >= limit:
            _rate_hits[key] = hits
            return True
        hits.append(t)
        _rate_hits[key] = hits
        if len(_rate_hits) > 5000:  # keep memory bounded
            for k in [k for k, v in _rate_hits.items() if not v or t - v[-1] > 3600]:
                _rate_hits.pop(k, None)
    return False


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
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_JSON_BYTES:
            return b""
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
        self.send_header("X-Content-Type-Options", "nosniff")
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

    def _client_ip(self) -> str:
        # Behind a proxy (Render etc.) the rightmost X-Forwarded-For entry is the one the proxy added.
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            return fwd.split(",")[-1].strip()
        return self.client_address[0]

    def _is_https(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

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
        secure = "; Secure" if self._is_https() else ""
        return {
            "Set-Cookie": (
                f"roleak_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"
            )
        }

    def _clear_session_cookie(self):
        return {"Set-Cookie": "roleak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"}

    # ---- routing ----

    def do_OPTIONS(self):
        # Site and API are same-origin, so no CORS headers are sent.
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PUT, DELETE, OPTIONS")
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
            except Exception:
                traceback.print_exc()
                self._error(500, "Server error")
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
        # Client-side routes all load the single-page app
        if path in ("/watch", "/login", "/register", "/upload", "/chat") or path.startswith("/watch/"):
            path = "/index.html"

        rel = path.lstrip("/")
        parts = rel.split("/")
        if ".." in parts or any(p.startswith(".") for p in parts) or "\\" in rel:
            return self._error(404, "Not found")

        suffix = Path(rel).suffix.lower()
        if not suffix:
            file_path = ROOT / "index.html"  # SPA fallback for extensionless routes
            suffix = ".html"
        else:
            file_path = (ROOT / rel).resolve()
            # Never serve anything from the data dir, the server code, the DB, etc.
            if (
                ROOT not in file_path.parents
                or DATA == file_path or DATA in file_path.parents
                or suffix not in STATIC_TYPES
                or not file_path.is_file()
            ):
                return self._error(404, "Not found")

        self._send(200, file_path.read_bytes(), STATIC_TYPES.get(suffix, "application/octet-stream"))

    def _serve_media(self, path: str, folder: Path, kind: str):
        # /media/videos/<id> or /media/thumbs/<id>
        parts = path.strip("/").split("/")
        if len(parts) < 3:
            return self._error(404, "Not found")
        vid = parts[2]
        with db() as conn:
            row = conn.execute(
                "SELECT username, is_hidden, video_path, thumb_path FROM videos WHERE id = ?", (vid,)
            ).fetchone()
        if not row:
            return self._error(404, "Not found")
        if row["is_hidden"]:
            user = self._current_user()
            if not user or not (user["username"] == row["username"] or is_admin_name(user["username"])):
                return self._error(404, "Not found")
        rel = row["video_path"] if kind == "videos" else row["thumb_path"]
        if not rel:
            if kind == "thumbs":
                fp = ROOT / "DefaultThumbnail.png"
                if fp.is_file():
                    return self._send(200, fp.read_bytes(), "image/png")
            return self._error(404, "Not found")
        fp = data_path(rel)
        if not fp or not fp.is_file():
            return self._error(404, "File missing")
        table = VIDEO_TYPES if kind == "videos" else THUMB_TYPES
        ctype = table.get(fp.suffix.lower())
        if not ctype:
            return self._error(404, "Not found")
        self._send_file_ranged(fp, ctype)

    def _send_file_ranged(self, fp: Path, ctype: str):
        """Stream a file with HTTP Range support (needed for seeking / Safari / iOS)."""
        size = fp.stat().st_size
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:  # suffix range: last N bytes
                    start = max(size - int(m.group(2)), 0)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(fp, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client closed the connection (normal when seeking)

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
        if rate_limited("reg:" + self._client_ip(), 5, 3600):
            return self._error(429, "Too many sign-ups from this address. Try again later.")
        if not USERNAME_RE.match(username):
            return self._error(400, "Username must be 2-32 characters: letters, numbers, _ . -")
        if len(password) < 6:
            return self._error(400, "Password must be at least 6 characters")
        if len(password) > 128:
            return self._error(400, "Password too long")
        avatar = f"https://api.dicebear.com/7.x/identicon/svg?seed={quote(username)}"
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
            {"username": username, "avatarUrl": avatar, "token": token, "isAdmin": is_admin_name(username)},
            self._set_session_cookie(token, SESSION_DAYS * 86400),
        )

    def _api_login(self):
        body = self._json_body()
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if rate_limited("login:" + self._client_ip(), 10, 300):
            return self._error(429, "Too many login attempts. Wait a few minutes and try again.")
        if len(password) > 128:
            return self._error(401, "Invalid username or password")
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
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
                "isAdmin": is_admin_name(row["username"]),
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
                    "isAdmin": is_admin_name(user["username"]),
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
            is_admin = user and is_admin_name(user["username"])
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
        if row["is_hidden"]:
            user = self._current_user()
            if not user or not (user["username"] == row["username"] or is_admin_name(user["username"])):
                return self._error(404, "Video not found")
        return self._json(200, {"video": video_public(row)})

    def _api_view_video(self, vid: str):
        key = (self._client_ip(), vid)
        t = now()
        with _rate_lock:
            seen = _view_seen.get(key)
            counted = seen is not None and t - seen < 3600
            if not counted:
                _view_seen[key] = t
                if len(_view_seen) > 20000:
                    for k in [k for k, v in _view_seen.items() if t - v > 3600]:
                        _view_seen.pop(k, None)
        with db() as conn:
            if counted:
                row = conn.execute("SELECT * FROM videos WHERE id = ?", (vid,)).fetchone()
                if not row:
                    return self._error(404, "Video not found")
                return self._json(200, {"video": video_public(row)})
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
        try:
            declared = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            declared = 0
        if declared > MAX_UPLOAD_BYTES + 5 * 1024 * 1024:
            self.close_connection = True
            return self._error(413, f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
        if rate_limited("upload:" + user["username"].lower(), 20, 3600):
            self.close_connection = True
            return self._error(429, "Upload limit reached. Try again later.")

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(declared),
            },
        )

        title = (form.getvalue("title") or "").strip()[:200] or "Untitled"
        description = (form.getvalue("description") or "").strip()[:5000]
        video_item = form["video"] if "video" in form else None
        thumb_item = form["thumbnail"] if "thumbnail" in form else None

        if video_item is None or not getattr(video_item, "file", None):
            return self._error(400, "Video file required")

        video_name = safe_filename(getattr(video_item, "filename", None) or "video.mp4")
        ext = Path(video_name).suffix.lower()
        if ext not in VIDEO_TYPES:
            ext = CT_TO_VIDEO_EXT.get((getattr(video_item, "type", "") or "").split(";")[0].strip().lower(), "")
        if ext not in VIDEO_TYPES:
            return self._error(400, "Unsupported video type (use mp4, webm or mov)")

        vid = new_id("v_")
        video_rel = f"uploads/{vid}{ext}"
        video_abs = DATA / video_rel
        with open(video_abs, "wb") as f:
            shutil.copyfileobj(video_item.file, f, 1024 * 1024)
        if video_abs.stat().st_size > MAX_UPLOAD_BYTES:
            video_abs.unlink(missing_ok=True)
            return self._error(413, f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")

        thumb_rel = None
        if thumb_item is not None and getattr(thumb_item, "file", None):
            t_name = safe_filename(getattr(thumb_item, "filename", None) or "thumb.png")
            t_ext = Path(t_name).suffix.lower()
            if t_ext not in THUMB_TYPES:
                t_ext = CT_TO_THUMB_EXT.get((getattr(thumb_item, "type", "") or "").split(";")[0].strip().lower(), "")
            if t_ext in THUMB_TYPES:
                thumb_rel = f"thumbs/{vid}{t_ext}"
                with open(DATA / thumb_rel, "wb") as f:
                    shutil.copyfileobj(thumb_item.file, f, 1024 * 1024)
                if (DATA / thumb_rel).stat().st_size > 5 * 1024 * 1024:
                    (DATA / thumb_rel).unlink(missing_ok=True)
                    thumb_rel = None

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
            if row["username"] != user["username"] and not is_admin_name(user["username"]):
                return self._error(403, "Not allowed")
            title = str(body.get("title", row["title"]))[:200]
            description = str(body.get("description", row["description"]))[:5000]
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
            if row["username"] != user["username"] and not is_admin_name(user["username"]):
                return self._error(403, "Not allowed")
            for rel in (row["video_path"], row["thumb_path"]):
                fp = data_path(rel)
                if fp:
                    try:
                        fp.unlink(missing_ok=True)
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
        if rate_limited("chat:" + user["username"].lower(), 20, 60):
            return self._error(429, "Slow down a little.")
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
        if not is_admin_name(user["username"]):
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
