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
| `APP_ENV` / `ENABLE_DOCS` | `APP_ENV=production` turns `/docs`, `/redoc` and `/openapi.json` off (unless `ENABLE_DOCS=true`). |
| `TRUST_PROXY_HEADERS` | `true` only behind a proxy you control that sets `X-Forwarded-For`; rate limits then use that address. |
| `MAX_REQUEST_BYTES`, `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES`, `MAX_IMAGE_PIXELS`, `AI_IMAGE_MAX_SIDE` | Upload limits (40 MB per request, 10 MB per photo, 5 MB per document, 25 megapixels; photos are shrunk to 1024 px before the AI models). |
| `REPORT_LIMIT_PER_HOUR`, `VOLUNTEER_SIGNUP_LIMIT_PER_HOUR`, `NGO_SIGNUP_LIMIT_PER_HOUR`, `CONTACT_LIMIT_*` | Rate limits (see "Limits" below). |
| `MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM` | Outgoing mail (see "Mail"). |
| `FRONTEND_BASE_URL` | Public https address of the frontend; password reset links point here. |
| `PASSWORD_RESET_MINUTES` | How long a reset link works (default 30). |
| `CONTACT_SEND_EMAIL` | `false` (default): contact-form messages are only stored and read in the admin console (`/admin` → "Contact messages"). `true`: each one is also mailed to `CONTACT_INBOX`. |
| `CONTACT_INBOX` | Where contact-form messages are mailed when `CONTACT_SEND_EMAIL=true`. Placeholder `contact@voluntag.example` until a real inbox exists. |
| `IP_HASH_SALT` | Secret for hashing contact-form IP addresses. Set a long random value. |
| `REPORT_MISMATCH_MODE`, `REPORT_MISMATCH_CLIP_MIN` | The photo/description check on reports (see below). Keep `log`. |
| `MATCH_USE_RATINGS`, `MATCH_RATING_MIN_COUNT`, `MATCH_RATING_MAX_BONUS`, `MATCH_V2`, `MATCH_PUBLIC_ROW_LIMIT` | Matching options (see "Matching"). |

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
  and every rate limit (logins, admin login, reports, registrations,
  password reset, contact form) is kept in memory, so each worker would have
  its own counters and the limits would multiply.
- **Never upload or deploy any `.db`, `.bak` or `.backup` file.** The local
  backups in `backend/` may hold plain-text passwords. Leave them out when
  you copy files or build an image, and start the server with an empty
  `DATA_DIR` or a migrated database.
- **SPA rewrite on the frontend host.** Send every path that is not a real
  file to `index.html`, so reloading a page does not return a 404.

## Single-page app rewrites

The frontend is a single-page app. Pages such as `/news` or
`/volunteer/dashboard` are not real files, so the frontend host must send every
path that is not a real file to `index.html` (with status 200, not a redirect).
Without this, reloading a page or opening a link directly returns a 404.

- **Netlify, Cloudflare Pages and similar hosts:** `frontend/public/_redirects`
  is copied into the build and already contains `/* /index.html 200`.
- **Vercel:** it ignores `_redirects`. A `vercel.json` next to the frontend
  would need this (not created yet, because the host is not chosen):

  ```json
  {"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}
  ```

- **Admin console:** it lives at `/admin` and is part of the same app, so
  `/admin` needs the same rewrite. There is no link to it from the public site;
  open the address directly.

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

## Database

- Startup migrations run on every start and are safe to repeat: they add
  missing columns (including `contact_messages.read_at` and
  `contact_messages.archived_at`, both nullable, so no row is rewritten),
  tables (`password_reset_tokens`, `contact_messages`) and indexes, lowercase stored emails and add a unique index on `lower(email)`
  for volunteers and NGOs. If any email would have to change, the database is
  first copied to `voluntag.db.bak-before-email-normalise-<time>` next to it.
  If two accounts would collide once lowercased, that table is skipped and a
  warning is logged; fix the rows by hand and restart.
- SQLite runs with `foreign_keys=ON`, `journal_mode=WAL` and a 5 second busy
  timeout. WAL adds `voluntag.db-wal` and `voluntag.db-shm` next to the
  database: back up with `sqlite3 voluntag.db ".backup 'backup.db'"` (not a
  plain file copy while the server runs). These files are git-ignored.
- Suggested nightly job: the `.backup` command above to a second disk.

## Mail

- Local: run Mailpit (`docker run -d --name voluntag-mailpit -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`).
  The defaults (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`) already point at it
  and every message shows up at http://127.0.0.1:8025. Nothing leaves the machine.
- Hosted: set `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_STARTTLS=true`,
  `SMTP_USERNAME`, `SMTP_PASSWORD`, a `MAIL_FROM` on your own domain, and add
  SPF and DKIM (and DMARC) records for that domain, or mail lands in spam.
- Mail is sent after the HTTP answer. If the mail server is down, the answer
  does not change: password reset still says "If an account exists...", and
  contact messages are kept in `contact_messages` (`mail_sent = 0`).

## Contact messages

- Every valid message from the Contact page is stored in `contact_messages`
  first (name, email, optional subject and role, message, time, a salted hash
  of the sender's IP). The honeypot, duplicate check and rate limits apply
  before that.
- Read them in the admin console: `/admin` → "Contact messages". The nav item
  shows the unread count. You can search (name, email, subject, message),
  filter (Inbox = unread + read, Unread, Read, Archived, All), mark a message
  read or unread, archive or unarchive it, copy the sender's address, or open
  a reply in your own mail program. Nothing can be deleted from the console.
  Every state change is written to the audit log (filter "Contact").
- Message text is shown as plain text only (never as HTML).
- Mail is off by default (`CONTACT_SEND_EMAIL=false`), so nothing depends on
  an SMTP server. With `CONTACT_SEND_EMAIL=true` each message is also mailed
  to `CONTACT_INBOX` (Reply-To = the visitor) after it is stored; a mail
  failure never loses the stored message. There is no auto-reply to the
  visitor.
- Replies are written by hand from your own mailbox; the site does not send
  them.
- Password reset: links work once, for `PASSWORD_RESET_MINUTES`, and a new
  request cancels older links. A successful reset logs the account out
  everywhere. Only a hash of each link is stored.

## Limits

| What | Limit | Over the limit |
| --- | --- | --- |
| `POST /report-issue` | 5 per hour per volunteer | 429 |
| `POST /add-volunteer` | 10 per hour per IP | 429 |
| `POST /add-ngo` | 5 per hour per IP | 429 |
| `POST /contact` | 3 per hour per IP, 3 per day per email | 429 |
| `POST /forgot-password` | 3 per hour per account, 10 per hour per IP | same 200, nothing sent |
| `POST /reset-password(/verify)` | 10 per 10 minutes per IP | 429 |
| Request body | 40 MB | 413 |
| One photo / one document | 10 MB / 5 MB, real image or PDF/DOC/DOCX content | 413 / 400 |

Behind a proxy, set `TRUST_PROXY_HEADERS=true` or every visitor shares the
proxy's address (and its limits).

## Report a problem: photo / description check

`POST /report-issue` compares each photo with the description using CLIP
(`"a photo of {description}"`, cut to CLIP's 77 tokens). The models already
used for the report are reused, so a normal report costs no extra model.

- `REPORT_MISMATCH_MODE=enforce`: when every photo scores below
  `REPORT_MISMATCH_CLIP_MIN`, the report is refused with
  `422 {"code": "image_description_mismatch", "message": ...}` and nothing is
  stored (no issue row, uploaded files deleted).
- `log` (**default**): the report is accepted and a mismatch is logged as a
  warning. `off`: the check is not computed.

**Limits of the check (measured, not guessed).** Calibration used the 13
photos in the database (5 issue photos and 8 NGO "before" photos, each with
the description of its own issue) and 130 cross-pairs with other issues'
descriptions (`tools/report_calibration/calibrate.py`, run on a copy):

| | n | min | median | max |
| --- | --- | --- | --- | --- |
| matching pairs | 13 | 0.150 | 0.208 | 0.329 |
| other descriptions | 130 | 0.113 | 0.208 | 0.342 |

The two groups overlap almost completely (AUC 0.56; a fixed bank of
reference prompts and the BLIP-caption comparison did no better, AUC
0.55-0.59), and even a blank or noise image scores 0.14-0.22. At the shipped
threshold 0.14 no genuine photo would be refused, but almost no mismatch
would be caught (99 % of cross-pairs pass). At 0.20, 23 % of genuine photos
would be refused. So the check stays in `log` mode. Re-run the calibration
when more real reports exist before switching to `enforce`.

## Matching

- `GET /match` (the public demo) returns no names, emails or locations: rows
  are labelled "Volunteer 1", "Volunteer 2"... and capped at
  `MATCH_PUBLIC_ROW_LIMIT` (24, max 50). `GET /ngos` needs a login.
- Every match has an explanation (keywords matched, same city, rating bonus).
- Ratings bonus (`MATCH_USE_RATINGS`, on): only a volunteer with at least
  `MATCH_RATING_MIN_COUNT` (3) rated, attended events gets a bonus of at most
  5 % of the score. Today no volunteer qualifies, so scores are unchanged.
- `MATCH_V2` (off): hybrid scoring that shows events to volunteers without a
  category keyword hit. On the self-made evaluation (`tools/match_eval`) it
  lowered NDCG@5 from 0.95 to 0.89, so it is not used by default.
