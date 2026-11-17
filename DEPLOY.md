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
| `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_COUNT` | Where the client address for rate limits comes from (see "Behind a proxy"). Defaults `false` and `0`: the connection address, `X-Forwarded-For` ignored. |
| `RATE_LIMIT_DB_PATH` | The SQLite file that holds every rate-limit counter (default `DATA_DIR/ratelimits.db`). |
| `LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_SECONDS`, `LOGIN_LOCKOUT_SECONDS`, `LOGIN_IP_MAX_FAILURES`, `LOGIN_IP_WINDOW_SECONDS`, `LOGIN_ACCOUNT_MAX_FAILURES_PER_HOUR` | Login lockout (see "Limits"). |
| `EMAIL_VERIFICATION_REQUIRED`, `EMAIL_VERIFICATION_HOURS`, `VERIFY_LIMIT_PER_IP_PER_10_MIN`, `RESEND_LIMIT_*`, `REGISTER_NOTICE_LIMIT_PER_DAY` | Email confirmation at signup (see "Email verification"). |
| `MAX_REQUEST_BYTES`, `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES`, `MAX_IMAGE_PIXELS`, `AI_IMAGE_MAX_SIDE` | Upload limits (40 MB per request, 10 MB per photo, 5 MB per document, 25 megapixels; photos are shrunk to 1024 px before the AI models). |
| `REPORT_LIMIT_PER_HOUR`, `VOLUNTEER_SIGNUP_LIMIT_PER_HOUR`, `NGO_SIGNUP_LIMIT_PER_HOUR`, `CONTACT_LIMIT_*` | Rate limits (see "Limits" below). |
| `MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM` | Outgoing mail (see "Mail"). |
| `FRONTEND_BASE_URL` | Public https address of the frontend; password reset and email confirmation links point here. |
| `PASSWORD_RESET_MINUTES` | How long a reset link works (default 30). |
| `CONTACT_SEND_EMAIL` | `false` (default): contact-form messages are only stored and read in the admin console (`/admin` → "Contact messages"). `true`: each one is also mailed to `CONTACT_INBOX`. |
| `CONTACT_INBOX` | Where contact-form messages are mailed when `CONTACT_SEND_EMAIL=true`. Placeholder `contact@voluntag.example` until a real inbox exists. |
| `IP_HASH_SALT` | Secret for hashing contact-form IP addresses. Set a long random value. |
| `REPORT_MISMATCH_MODE`, `REPORT_MISMATCH_CLIP_MIN` | The photo/description check on reports (see below). Keep `log`. |
| `MATCH_USE_RATINGS`, `MATCH_RATING_MIN_COUNT`, `MATCH_RATING_MAX_BONUS`, `MATCH_V2`, `MATCH_PUBLIC_ROW_LIMIT` | Matching options (see "Matching"). |
| `CHANGE_PASSWORD_LIMIT_PER_HOUR`, `EMAIL_CHANGE_LIMIT_PER_HOUR`, `DATA_EXPORT_LIMIT_PER_HOUR`, `DEACTIVATE_LIMIT_PER_HOUR`, `ACCOUNT_ACTION_LIMIT_PER_IP_PER_HOUR` | Limits for the Settings actions that need the password (see "Account settings"). |
| `EMAIL_CHANGE_HOURS` | How long a "confirm your new email address" link works (default 24). |
| `SESSION_TOUCH_SECONDS` | A login's "last used" time is written at most once per this many seconds (default 60), so busy dashboards do not write on every request. |

Frontend:

| Variable | What it does |
| --- | --- |
| `REACT_APP_API_BASE` | Backend address, no trailing slash, e.g. `https://api.example.com`. It is baked in when you run `npm run build`, so rebuild after changing it. |

## Start command

Run from the `backend/` folder:

```
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --no-proxy-headers
```

Do not add `--reload` on a server. `--no-proxy-headers` stops uvicorn from
rewriting the client address from `X-Forwarded-For` on its own (by default
it trusts any request from 127.0.0.1), so only `TRUST_PROXY_HEADERS` and
`TRUSTED_PROXY_COUNT` decide (see "Behind a proxy").

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
- **One worker only.** SQLite does not handle several writer processes
  well, each worker would load its own copy of the AI models (about 3 GB),
  and the admin console's lockout is still kept in memory per process. The
  other rate limits (volunteer/NGO logins, registrations, email
  verification, password reset, contact form, reports) are stored in
  `ratelimits.db` (see "Limits"), so they survive a restart and would be
  shared correctly if a second process were ever added.
- **Never upload or deploy any `.db`, `.bak` or `.backup` file.** The local
  backups in `backend/` may hold plain-text passwords. Leave them out when
  you copy files or build an image, and start the server with an empty
  `DATA_DIR` or a migrated database.
- **Keep database backups outside the project folder** (for example in a
  `voluntag-backups/` folder next to the repository, or on another disk).
  `.gitignore` and `backend/.gitignore` ignore `*.db`, `*.bak*`,
  `*.backup*`, `*.sqlite*` and the `-wal`/`-shm` files, but a backup inside
  the repository can still end up in an image, a zip or a copy of the folder.
  The startup migration's own safety copies (`voluntag.db.bak-before-*`) are
  written next to the database, so move them out after checking them.
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

## Security headers and CSP

**Backend.** Every API response carries `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a
`Permissions-Policy` that turns every powerful feature off, and
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
(left off `/docs` and `/redoc`, which are off in production anyway).
`Strict-Transport-Security` is added only when the request arrived over
https (directly, or via a trusted proxy's `X-Forwarded-Proto`).

**Frontend.** `frontend/public/_headers` is copied into the build and sets
the same headers plus a Content-Security-Policy for the app:

| Directive | Allows | Why |
| --- | --- | --- |
| `script-src 'self'` | the built bundles only | `frontend/.env.production` sets `INLINE_RUNTIME_CHUNK=false`, so `build/index.html` has no inline script |
| `style-src 'self' https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com` | Google Fonts | DM Sans and DM Serif Display |
| `img-src 'self' data: blob: <API>` | CSS icons, photo previews, protected photos | `data:` icons in CSS, `blob:` for previews and photos fetched with the login token |
| `connect-src 'self' <API>` | the API | |
| `frame-src blob:` | PDF previews in the admin console | checked in Chrome: PDFs still render |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` | nothing else | |

`Permissions-Policy` keeps `geolocation=(self)` because chat can share a
location; camera, microphone, payment and the rest are off.

**Before deploying, replace `https://api.example.com`** in the CSP line of
`frontend/public/_headers` (it appears twice) with the real backend address,
exactly as in `REACT_APP_API_BASE`. If it is left as is, the browser blocks
every API call.

- **Netlify, Cloudflare Pages:** `_headers` is used as it is.
- **Vercel** ignores `_headers`. Put the same rules in `vercel.json` next to
  the rewrite above:

  ```json
  {
    "rewrites": [{"source": "/(.*)", "destination": "/index.html"}],
    "headers": [{
      "source": "/(.*)",
      "headers": [
        {"key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://api.example.com; connect-src 'self' https://api.example.com; frame-src blob:; media-src 'self' blob:; worker-src 'none'; object-src 'none'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"},
        {"key": "X-Content-Type-Options", "value": "nosniff"},
        {"key": "X-Frame-Options", "value": "DENY"},
        {"key": "Referrer-Policy", "value": "no-referrer"},
        {"key": "Permissions-Policy", "value": "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()"},
        {"key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains"}
      ]
    }]
  }
  ```

- Check after deploying: open the site and the browser console; a CSP
  problem shows up as "Refused to ..." messages.

## Sessions and XSS

The login token stays in `sessionStorage` (it is sent as a Bearer header,
not a cookie). **Decision:** moving it to an `HttpOnly` cookie would hide it
from scripts, but it would also need CSRF protection on every write and a
same-site API domain, which is a bigger change than this project needs now.
The trade-off is that any script injected into the page could read the
token, so the defence is to keep injected scripts out:

- the CSP above (no inline or third-party scripts);
- React text rendering only: no `dangerouslySetInnerHTML`, `innerHTML` or
  `document.write` anywhere;
- every link built from data (an NGO website, a chat location, a member's
  link) goes through `frontend/src/safeUrl.js`, which only lets `http(s)`
  (and, for files, `blob:`) addresses through, so a `javascript:` link
  cannot be stored and clicked;
- `backend/tests/test_frontend_sinks.py` scans `frontend/src` and fails if a
  new raw-HTML sink, `window.open`, location change or unreviewed `href` /
  `src` expression appears;
- the token expires after 12 hours, ends on logout, and every session of an
  account ends after a password reset (a password or email change in
  Settings ends every other session; Settings can also log out every other
  session on demand).

## Email verification

- New volunteer and NGO accounts must open the link mailed to them before
  they can log in (`EMAIL_VERIFICATION_REQUIRED=true`, the default). The
  link (`{FRONTEND_BASE_URL}/verify-email?token=...`) works once, for
  `EMAIL_VERIFICATION_HOURS` (24); asking for a new one makes the older ones
  expire. Only a hash of each link is stored (`email_verification_tokens`).
- Logging in with the right password before confirming gives
  `403 {"code": "email_not_verified"}`; a wrong password still gives the
  normal 401, so the answer never shows which emails exist.
- Registration answers exactly the same (status, body, password hashing,
  file checks) whether or not the email is already registered. When it is,
  that address gets a short "someone tried to register with your address"
  mail with a password reset link (or, if that account is still not
  confirmed, a fresh confirmation link), at most
  `REGISTER_NOTICE_LIMIT_PER_DAY` per address. A taken organisation or
  volunteer NAME is still reported, because it says nothing about any email.
- A completed password reset also confirms the email (the link reached it).
- Accounts that existed before this change were marked confirmed by the
  startup migration (a new `email_verified` column with default 1; no row is
  rewritten).
- **Demo mode without mail:** `EMAIL_VERIFICATION_REQUIRED=false` creates
  new accounts already confirmed and keeps the old
  `400 "Email ... is already registered"` answer. **Known trade-off:** that
  answer tells anyone which emails have accounts. Accounts created while the
  setting was `true` and never confirmed still cannot log in; they can use
  "Send a new link" or reset their password.

## Account settings

Volunteers and NGOs have a Settings tab in their dashboard
(`?tab=settings`, sections Profile, Security, Email, Your data, Account).
Every Settings request works on the account behind the login token; there
is no email or id in the address, so nobody can reach another account.

- **Profile.** Volunteers edit name, phone, age, gender, designation,
  city, skills, availability, experience, a short bio and the causes they
  care about, with the same rules as registration. A skills change
  re-encodes that volunteer's matching vector at once, so their event list
  and the NGOs' matches change straight away. NGOs edit their mission
  (motto), category, city, address, phone and website (http/https only).
  The organisation name, legal structure, year founded and documents are
  read-only (the admin approved them), and editing never changes the
  approval status. A category change asks for confirmation, because it
  changes which volunteers see the NGO's events.
- **Security.** Change password (current password required, same rules
  as registration, must differ from the current one). This device stays
  logged in; every other session ends and a notice is mailed. "Where
  you're logged in" lists the account's sessions with a short device label
  ("Chrome on macOS", made from the User-Agent at login; the raw header is
  not stored) and can log out every other session.
- **Email.** A link is mailed to the NEW address; the address changes only
  when it is opened (once, within `EMAIL_CHANGE_HOURS`). The answer is the
  same whether or not the address is taken; a taken address gets no link.
  After the change, the old address gets a short notice, every other
  session ends, and the account's messages and reports move to the new
  address. Only a hash of each link is stored (`email_change_tokens`).
- **Your data.** After the password, a JSON file with the account's own
  profile, sign-ups and ratings received (volunteers), events with
  sign-up counts (NGOs), reports or submitted solutions, and the messages
  the user sent. Never passwords, tokens, matching vectors or other
  people's private details.
- **Account (deactivate).** Password plus typing `DEACTIVATE`. Soft only:
  `deactivated_at` is set and nothing is deleted. Login is refused
  (`403 account_inactive`, only after a correct password), every session
  ends, no reset link is sent, NGOs cannot start new messages to it, and
  the account leaves matching, event lists, the NGO list, the public
  `/match` demo and the `/stats` counts. An NGO with upcoming events (not
  completed, not cancelled) must cancel them first. In the admin console
  the volunteer and NGO tables show a "Deactivated" badge, and the detail
  page has **Reactivate** (written to the audit log as
  `reactivate_volunteer` / `reactivate_ngo`).

## Behind a proxy

Rate limits need the real client address. One helper (`client_ip()` in
`backend/rate_limit.py`) is used by every limiter:

- `TRUST_PROXY_HEADERS=false` (default): the address of whatever opened the
  connection. `X-Forwarded-For` is ignored, so a client cannot pick its own
  address. Behind a proxy this means every visitor shares the proxy's
  address and limits.
- `TRUST_PROXY_HEADERS=true` and `TRUSTED_PROXY_COUNT=N`: each of your N
  proxies appends the address it received the request from, so the client is
  the entry N places from the **right** of `X-Forwarded-For`. Anything
  further left was written by the client and is never used. Examples: a
  platform load balancer only, `N=1`; a load balancer plus your own nginx,
  `N=2`. If the header has fewer than N entries, the connection address is
  used. `N=0` with `true` is treated as 1 and logged as a warning.
- Only turn this on when the app cannot be reached except through those
  proxies, and start uvicorn with `--no-proxy-headers` (see "Start command").

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
- An audit of the existing history (November 2026) found a committed database
  backup with real accounts and plain-text passwords. It is kept outside the
  repository; the owner decides between making the repository private and
  rewriting the history, and the exposed passwords must be changed either way.
- Test files use a test-only password defined once in
  `backend/tests/conftest.py`; older commits still contain the previous
  throwaway test password.

## Database

- Startup migrations run on every start (before the demo seed) and are safe
  to repeat: they add missing columns (including `contact_messages.read_at`
  and `contact_messages.archived_at`, both nullable, and
  `volunteers.email_verified` / `ngos.email_verified`, `NOT NULL DEFAULT 1`
  so every existing account counts as confirmed; no row is rewritten;
  and, for Settings, the nullable `volunteers.bio`,
  `volunteers.cause_interests`, `volunteers.deactivated_at`, `ngos.address`,
  `ngos.deactivated_at` and `user_sessions.device_label`, so every existing
  account stays active),
  tables (`password_reset_tokens`, `contact_messages`,
  `email_verification_tokens`, `email_change_tokens`) and indexes, lowercase stored emails and add a unique index on `lower(email)`
  for volunteers and NGOs. If any email would have to change, the database is
  first copied to `voluntag.db.bak-before-email-normalise-<time>` next to it.
  If two accounts would collide once lowercased, that table is skipped and a
  warning is logged; fix the rows by hand and restart.
- SQLite runs with `foreign_keys=ON`, `journal_mode=WAL` and a 5 second busy
  timeout. WAL adds `voluntag.db-wal` and `voluntag.db-shm` next to the
  database: back up with `sqlite3 voluntag.db ".backup 'backup.db'"` (not a
  plain file copy while the server runs). These files are git-ignored.
- Suggested nightly job: the `.backup` command above to a second disk
  (outside the project folder).
- `ratelimits.db` (next to `voluntag.db` unless `RATE_LIMIT_DB_PATH` says
  otherwise) holds only rate-limit counters and lockouts, with emails and IP
  addresses stored as salted hashes. It needs no backup; deleting it while
  the server is stopped clears every limit.

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
| `POST /volunteer-login`, `POST /ngo-login` | 5 wrong passwords per 15 minutes per (account, IP) → that pair locked 5 minutes; 30 failures per 15 minutes per IP; 50 failures per hour per account from anywhere | 429 "Too many failed logins. Try again in N minutes." (same text for unknown emails) |
| `POST /add-volunteer` | 10 per hour per IP | 429 |
| `POST /add-ngo` | 5 per hour per IP | 429 |
| "Someone tried to register" notice | 3 per day per address | not sent (same answer) |
| `POST /verify-email` | 20 per 10 minutes per IP | 429 |
| `POST /resend-verification` | 3 per hour per account, 10 per hour per IP | same 200, nothing sent / 429 |
| `POST /contact` | 3 per hour per IP, 3 per day per email | 429 |
| `POST /forgot-password` | 3 per hour per account, 10 per hour per IP | same 200, nothing sent |
| `POST /reset-password(/verify)` | 10 per 10 minutes per IP | 429 |
| `POST /account/password` | 5 per hour per account | 429 |
| `POST /account/email` | 3 per hour per account | 429 |
| `POST /account/export`, `POST /account/deactivate` | 5 per hour per account | 429 |
| All four above together | 30 per hour per IP | 429 |
| `POST /confirm-email-change` | 20 per 10 minutes per IP | 429 |
| Request body | 40 MB | 413 |
| One photo / one document | 10 MB / 5 MB, real image or PDF/DOC/DOCX content | 413 / 400 |

All of these are stored in `ratelimits.db`, so a restart does not reset
them and every process sees the same counts. The admin console's own
lockout (5 wrong admin passwords → 5 minutes) is separate and still in
memory. Behind a proxy, see "Behind a proxy", or every visitor shares the
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
