# Deploying VolunTag

The hosting provider is not chosen yet. This file lists what any host needs.
All addresses below are placeholders.

## What the app is made of

- **Backend:** a FastAPI app in `backend/` served by uvicorn. It stores data in
  a SQLite file (`voluntag.db`), keeps uploaded files in an `uploads/` folder,
  and runs three AI models on the CPU: BLIP (image captions), CLIP (image
  categories) and MiniLM (text matching).
- **Frontend:** a React single-page app in `frontend/`. `npm run build` turns
  it into static files that any static host can serve.

## Environment variables

Backend (all optional, the defaults match a local laptop setup; see
`backend/.env.example`):

| Variable | What it does |
| --- | --- |
| `DATA_DIR` | Folder for everything the app writes: `voluntag.db`, `uploads/`, `admin_secret.json`. Point it at a persistent disk outside the repository. |
| `ALLOWED_ORIGINS` | Comma-separated frontend addresses allowed to call the API, e.g. `https://app.example.com`. |
| `SEED_DEMO_DATA` | `true` (default) adds demo volunteers and NGOs to empty tables. Use `false` in production. |
| `HF_HUB_OFFLINE` | `1` (default) uses only models already downloaded. Set `0` once to download them. |
| `HF_HOME` | Where the model cache lives. Point it at a persistent disk. |

Frontend:

| Variable | What it does |
| --- | --- |
| `REACT_APP_API_BASE` | Backend address, no trailing slash, e.g. `https://api.example.com`. It is baked in when you run `npm run build`, so rebuild after changing it. |

## Start command

Run from the `backend/` folder:

```
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
```

Do not add `--reload` on a server.

## Health check

`GET /health` returns `{"status": "ok"}`. It needs no login and does not touch
the database or the models, so it only shows that the server process is up.

## First run

1. **Models.** Either copy an existing model cache into `HF_HOME`, or start once
   with `HF_HUB_OFFLINE=0` so the models download. Models load the first time
   a feature needs them, not at startup. After they are cached, go back to
   `HF_HUB_OFFLINE=1`.
2. **Admin password.** Run `python create_admin_password.py` once from
   `backend/`, with the **same `DATA_DIR`** as the server. It prints the
   password once. Store it in a password manager.
3. **Old databases only.** If you bring an older database that still has
   plain-text passwords, stop the backend and then run, from `backend/`:
   `python migrate_hash_passwords.py path/to/voluntag.db` (dry run, counts only),
   then the same command with `--apply`. A fresh database does not need this.

## Resources

- About **3 GB of RAM** for the three models plus the app.
- A **persistent disk** for `DATA_DIR` (database and uploads) and for `HF_HOME`
  (model cache). Without it, every restart or redeploy loses all data.

## Rules for any host

- **HTTPS on both sides.** If the frontend is served over https, the backend
  must be https too, or browsers block the calls.
- **One worker only.** SQLite does not handle several writer processes well,
  and the admin login lockout is kept in memory, so each worker would have
  its own counter.
- **Never upload or deploy any `.db`, `.bak` or `.backup` file.** The local
  backups in `backend/` may hold plain-text passwords. Leave them out when
  you copy files or build an image, and start the server with an empty
  `DATA_DIR` or a migrated database.
- **SPA rewrite on the frontend host.** Send every path that is not a real
  file to `index.html`, so reloading a page does not return a 404.

## Python packages

- `backend/requirements.txt` was frozen on macOS. On the host, check that every
  pinned version installs on Linux before going live.
- The default `torch` package includes GPU support and is very large. The app
  only uses the CPU, so installing the CPU-only build of the same version (from
  PyTorch's CPU package index) is much smaller and faster to deploy.

## Repository history

- The repository is public.
- Earlier commits contain old test-only database files and dummy uploads.
- Never commit a real database, a database backup, an uploads folder or a
  secrets file (`.env`, `admin_secret.json`). `.gitignore` covers these, but
  check `git status` before every commit.
- If real data is ever committed, rewrite the history or move to a fresh
  repository before continuing. Deleting the file in a new commit is not enough.
