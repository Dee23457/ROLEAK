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
