# ROLEAK

LiveLeak-style video site with a real Python server: shared accounts, videos, and chat.

## Run locally

```bash
cd roleak
python3 server.py
```

Open http://127.0.0.1:8765

## Deploy on Render (free)

1. Push this repo to GitHub (already: `Dee23457/ROLEAK`).
2. Go to [https://render.com](https://render.com) → Sign up with GitHub.
3. **New → Web Service** → select `ROLEAK`.
4. Settings:
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python server.py`
   - **Instance:** Free
5. Create Web Service → wait for deploy.
6. Open the URL Render gives you (e.g. `https://roleak-xxxx.onrender.com`).

### Environment variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `PYTHON_VERSION` | (see `.python-version`) | Keep on 3.12.x — `server.py` uses the `cgi` module, removed in 3.13 |
| `ROLEAK_DATA_DIR` | `./data` | Where the database + uploads live. Point at a persistent disk/volume in production |
| `ROLEAK_MAX_UPLOAD_MB` | `200` | Server-side upload cap |
| `ROLEAK_ADMIN_USERNAME` | `Scratch_Catalouge` | Admin account name (case-insensitive) |

**Right after the first deploy, register the admin account yourself** — whoever registers the admin username first becomes admin.

### Notes
- Free tier spins down after idle; first load can take ~30s.
- Uploaded files on the free disk can be wiped when the service redeploys. Fine for demos; for permanent storage use paid disk or object storage later.
- Admin username: `Scratch_Catalouge`

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Log in |
| GET | `/api/videos` | List videos |
| POST | `/api/videos` | Upload (multipart) |
| GET/POST | `/api/chat` | Chat messages |
