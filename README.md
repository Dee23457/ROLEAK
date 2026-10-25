# ROLEAK

LiveLeak-style video site that works **outside Websim**, with real **login/register accounts**.

## Features
- Register / Login (stored on device via localStorage)
- Upload videos (IndexedDB blob storage)
- Comments, likes, chat (local collections)
- Classic LiveLeak-inspired UI
- Admin username: `Scratch_Catalouge` (register with that name)

## Run locally
```bash
# From this folder
python3 -m http.server 8765
# Open http://localhost:8765
```

Or enable **GitHub Pages** (Settings → Pages → Deploy from branch `main` / root).

## Notes
- Accounts and videos stay in **this browser** (not shared across devices).
- Large videos use browser storage quotas; keep uploads reasonable.
- Not affiliated with LiveLeak.
