# ROLEAK

LiveLeak-style video site with **real server**, shared accounts, and video storage.

## Run the server

```bash
cd roleak
python3 server.py
```

Open **http://127.0.0.1:8765**

### What you get
- **Accounts** — register / login (SQLite, cookie sessions)
- **Shared videos** — uploads stored on disk, visible to everyone
- **Chat** — messages stored on the server
- **Comments & likes** — per video (API ready)
- **Admin** — register as `Scratch_Catalouge`

Data lives in `./data/` (`roleak.db`, `uploads/`, `thumbs/`).

### API (for reference)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Log in |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user |
| GET | `/api/videos` | List videos |
| POST | `/api/videos` | Upload (multipart) |
| GET/PUT/DELETE | `/api/videos/:id` | Get / update / delete |
| GET/POST | `/api/chat` | List / send messages |

Without the server, the site falls back to browser-only (localStorage) mode.
