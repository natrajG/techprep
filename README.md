# TechPrep

TechPrep — AI-powered technical interview assistant with an affordable deployment approach.

## Stack

- **Backend API:** FastAPI (REST)
- **Admin + Auth:** Django
- **AI Orchestration Service:** Flask
- **Frontend:** React
- **Database:** PostgreSQL
- **Cloud targets:** AWS / Azure
- **CI/CD:** GitHub Actions starter workflow

## Repository Layout

```text
techprep/
  services/
    api-fastapi/      REST API for interview sessions, candidates, reports
    admin-django/     Admin portal and enterprise auth integration
    ai-flask/         LLM prompts, scoring, feedback generation service
  frontend/
    react-web/        Recruiter and candidate UI
  infra/
    docker-compose.yml
    env.example
  docs/
    architecture.md
  .github/workflows/
    ci.yml
```

## Quick Start

1. Copy env file:
   - `cp infra/env.example .env`
2. Start local database:
   - `docker compose -f infra/docker-compose.yml up -d postgres`
3. Run services independently (recommended for development):
   - FastAPI: `cd services/api-fastapi && uvicorn app.main:app --reload --port 8000`
   - Flask AI: `cd services/ai-flask && python app/main.py`
   - React: `cd frontend/react-web && npm install && npm run dev`
4. Bootstrap Django app:
   - `cd services/admin-django && python -m venv .venv && source .venv/bin/activate`
   - `pip install django djangorestframework psycopg2-binary`
   - `django-admin startproject admin_portal .`

## TechPrep Live Assistant

### Browser design system

The public site and signed-in workspace use the scoped **Editorial Workspace** theme in
`frontend/react-web/src/design-system.css`: ink surfaces, warm-white text, violet actions,
shared spacing, and responsive layouts. `main.jsx` adds `tp-browser` only outside Electron,
so these rules do not change the transparent desktop HUD. Shared SVG icons live in `Icon.jsx`;
supporting descriptions use 15–16px text and workspace field hints use an explicit 14px
size, without enlarging headings or relying on the browser's smaller `<small>` default.
`Dialog.jsx` provides modal focus containment, Escape/backdrop dismissal, scroll locking,
and focus restoration, including nested confirmations.

`BrandMark.jsx` shares the rounded lowercase `ia` mark in dark violet (`#5f46bf`)
across the browser brand surfaces, with the same SVG used as the favicon. The product
name remains TechPrep. A subtle violet glow extends behind the logo and TechPrep wordmark, and the dashboard header
omits the workspace tagline. Clicking the dashboard logo returns to the top of the page.
Navigation and wordmarks use locally hosted Manrope; its OFL
license is distributed in `public/fonts/OFL-Manrope.txt`. Page headings and body fonts
are unchanged. The public navigation collapses at tablet widths to avoid crowding.

After sign-in, an amber (`rgb(251, 191, 36)`) desktop-requirement notice appears above
quick actions, with direct subscription and desktop-download entry points. Existing
subscribers see plan management; exhausted call credits show renewal. The notice
reuses the existing pricing dialog without changing automatic web plan prompts,
payment checks, desktop functionality, or entitlements.
Subscription buttons use a dark fill and muted amber text rather than a bright
yellow block; the stronger amber is reserved for the notice heading and accents.

The landing page leads with the interview HUD, an interactive illustrative desktop preview,
and dedicated visual cards for ATS Resume Builder, Mock Interviews, and Resume-Based Job Search.
Preview mode buttons switch between live answers, resume context, and capture protection;
these are demonstrations, not a live interview session. Capture-protection limitations and
the distinction between free ATS scoring and the paid resume unlock are stated explicitly.

The dashboard follows resume → job search → desktop preparation. Billing stays in the
account menu, and interview history loads only after **Full View**. ATS scoring is free;
the full resume rebuild and PDF/DOCX downloads remain a separate ₹10 unlock for 24 hours.
Plan prices and call allowances are still loaded from the API.

Roles: **Lead Python Developer** and **Python Full Stack Developer**.

1. Backend (Python 3.10+): put `OPENAI_API_KEY=sk-...` in `.env` at the repo root
   (optional: `OPENAI_BASE_URL`, `LLM_MODEL` for cheaper OpenAI-compatible providers), then
   `./run.sh api` — creates `.venv` with `/usr/bin/python3` on first run and loads `.env`.
2. Run `./run.sh` from the repo root. It starts the backend, the Vite dev server (http://localhost:5173) and
   the transparent always-on-top overlay window, which shows the dev server and reloads when you change the UI.
   Close the overlay (✕) or press Ctrl+C to stop everything.
   Other modes: `./run.sh api`, `./run.sh web` (browser only), `./run.sh overlay` (overlay only, needs api + web running).
   In a plain browser tab, the "Always on top" panel is a Picture-in-Picture window, which the browser closes with the tab.
   **Login:** set `APP_USERNAME`, `APP_PASSWORD` (and `AUTH_SECRET`, so sessions survive backend restarts) in `.env`.
   The UI shows a sign-in page first; in the desktop app, a login window opens first and the overlay opens only after
   a successful sign-in (the ⎋ button signs out and returns to the login window). The API endpoints require the
   login token; sessions last 12 hours (`AUTH_TOKEN_TTL_HOURS`). The `.env` account always works.
   People can also create accounts from the sign-in page (stored with scrypt-hashed passwords in
   `services/api-fastapi/data/users.db`); set `ALLOW_SIGNUP=false` to disable sign-up.
3. Paste your resume and the job description once (saved in localStorage).
4. Click **Listen to meeting tab**, choose the meeting tab, and tick **Share tab audio**.
   Audio is transcribed in standalone chunks; a short speech pause finishes the current chunk.
5. After a short pause in speech, TechPrep automatically answers the newly transcribed question.
   Once listening starts, the toolbar and transcript strip collapse into the answer card,
   giving answers more room. **Stop** remains visible; **Show controls** restores the toolbar,
   transcript, history, and settings without stopping capture. Stopping restores the normal layout.
   The question field and **Answer** button stay above the independently scrolling answers.
   The desktop HUD uses translucent black panels and neutral controls, without a logo;
   recording and warning indicators retain their status colors.
   Click **Answer** (or press Enter) to submit a typed question or captured speech.
   It picks out the latest interviewer question and streams back an answer.
   Non-code answers display as bullets, not numbers: usually 2-4 short points within 60 words,
   without extra explanation unless explicitly requested.
   Acknowledgements (including known account-name parts, such as "Alex, thanks"), meeting
   logistics, and incomplete questions do not replace the answer currently on screen.
   The API classifies captured speech before generating an answer; typed questions still use
   the manual Answer flow. Names are matched from the account username, not guessed from technical words.
   Programming requests return just the code by default; ask "explain it" afterward for a concise explanation.
   The overlay keeps the last two Q&A turns in memory for follow-ups, without persisting them or resending the full conversation.

   On Windows, **Listen** captures only system audio playing through the default output device;
   select the same speaker or headphones in Teams or Google Meet. It does not record the
   microphone or fall back to it if system capture fails. Electron starts a display capture for
   loopback audio but does not upload video. The app warns when no shared audio is detected,
   and transcription receives technical vocabulary hints, including Django. The desktop overlay
   is hidden from the Windows taskbar (the sign-in window remains visible there). The pointer
   stays a normal arrow over overlay controls, including popup buttons; hover-name tooltips
   are suppressed in the desktop HUD and its dialogs without removing accessible labels.

API: `POST /api/v1/transcribe` (multipart `audio`), `POST /api/v1/answer` (SSE stream), `POST /api/v1/evaluate` (practice scoring).
The monthly plan defaults to 30 one-hour calls within 30 days. A call window begins on the first
AI or audio request and subsequent requests within that hour use the same call; the hourly
plan includes one call window (90 minutes by default). An administrator signed in with
`APP_USERNAME` can edit plan prices, monthly call allowance, hourly call duration, and monthly
plan duration in the account profile or web dashboard. Changes apply only to newly created
orders; existing orders and subscriptions retain their purchased terms. Previously purchased
unlimited monthly subscriptions remain unlimited. The account profile shows remaining calls and provider-reported
AI input/output token usage since tracking began. Audio transcription is not included in the
token count, and tokens have no separate quota. Production requires `ENFORCE_SUBSCRIPTIONS=true`
and always enforces an active subscription (including the one-time free trial) for paid AI endpoints;
existing plans also respect their call limits.
Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on the API server and enable automatic payment
capture in Razorpay. All accounts pay via Razorpay Checkout; the API confirms the signed
payment is captured in INR for the full order amount before activating the purchased plan
or unlocking a rebuilt resume download. A user-entered UTR cannot verify a payment.
Only the bootstrap administrator can grant free subscriptions. The legacy `testuser_win`
username is reserved and its payment bypass has been removed.
The public privacy policy is available at `/privacy/` without signing in; deploy the latest
web build before using its URL in a Store listing.

### Production HTTPS deployment

In production, TechPrep is deployed with automatic publicly-trusted TLS via Caddy (see `infra/lightsail/Caddyfile`).
No local certificate authorities or manual certificate imports are required.

### Desktop app (floating, transparent, stays open without a browser)

**Production:** see [Lightsail deployment](docs/lightsail-deployment.md) for the public HTTPS
server and [signed Windows releases](docs/desktop-capture-protection.md#production-signed-release)
and [signed, notarized macOS releases](docs/desktop-capture-protection.md#macos-production-signed-release).
No Mac is required to build the macOS release: the **macOS signed release** GitHub Actions
workflow builds it on a hosted runner — see
[building without owning a Mac](docs/desktop-capture-protection.md#building-without-owning-a-mac).
Can't yet afford the $99/year Apple Developer Program fee? Use the free, unsigned
**macOS unsigned (free-tier) release** workflow instead (no Apple credentials needed) — see
[free-tier release: unsigned](docs/desktop-capture-protection.md#free-tier-release-unsigned-no-apple-developer-program-account).
Users of that build see a one-time Gatekeeper warning they must manually bypass; it is not a hard
block. For Microsoft Store distribution without a code-signing certificate, use the
[Windows AppX package](docs/desktop-capture-protection.md#microsoft-store-package-appx).
Production installers point to the public server, need no certificate import, and are served only
when a verified release manifest matches. Desktop builds need Node.js 22 (`nvm install`).

**Download after login:** for local LAN testing, sign in in your browser, click
**Download Windows app** or **Download Mac app**, and run `TechPrep-Setup.exe` or open
`TechPrep.dmg`. In production, the Mac download always serves the current `.dmg` directly from
the website once published (no app store, no upload or review process) — signed/notarized once
an Apple Developer Program account is set up, or unsigned (with in-app bypass instructions) until
then; the Windows download instead offers Store installation once the Store release is published,
and shows a coming-soon message until then. Sign in again in the installed desktop app.
The LAN installers connect to the server configured at build time; no Python or
environment-variable setup is needed on the client. Keep the server running.
The browser's floating window cannot hide itself from screen sharing; the Windows
desktop app provides system-audio loopback and a best-effort capture-protection toggle.

```bash
cd frontend/react-web && npm install && npm run build   # once, and after UI changes
cd ../../desktop && npm install && npm start
```

- Starts the backend automatically (or reuses one already running on port 8000) and closes it on exit.
- Header: **📌 On top** toggle, **👁 opacity** slider, minimize/close; drag the window by its title bar.
- The overlay has no taskbar/Dock entry (stealth). If you minimize it, press **Ctrl+Shift+T**
  (**Cmd+Shift+T** on macOS) to restore it — don't relaunch the app, since only one desktop session
  per account stays signed in and a second launch just brings the existing window back to front.
- **Listen to system audio** records what plays through your speakers (Linux: PulseAudio monitor of
  the default output; Windows: system loopback). A missing Linux monitor is reported rather than
  falling back to the microphone.
- **Hide from screen capture (best effort)** toggles native capture protection on Windows/macOS.
  It defaults to off on first use, saves your preference locally, and restores it before showing the overlay.
  The status distinguishes a successful API request, disabled, unsupported, and failed requests. It is not a guarantee:
  some capture methods bypass protection, including macOS ScreenCaptureKit-based capture.
  Confirm the result in your sharing preview before relying on it.
- Linux does not support this protection; the toggle is disabled there. Share only the intended
  application window or browser tab instead of the entire screen to keep the overlay out of the share.
- The desktop uses a dark translucent panel with compact controls; browser styling is unchanged.
- Windows/macOS and packaged apps use a separately started Python backend, which serves the built web UI.
  Linux source development retains automatic backend startup.
- See [desktop capture protection and packaging](docs/desktop-capture-protection.md) for platform limits,
  build/run commands, signing requirements, and the manual capture verification matrix.

## Resume-based Job Search (Web Dashboard)

The web dashboard now includes a **Resume-Based Job Search** section that:

- infers default role and skills from your saved resume (editable before searching),
- queries **Jooble** (provider list is configurable),
- normalizes results into TechPrep's own database tables,
- caches results per user/query for 24 hours.

API endpoints:

- `POST /api/v1/jobs/suggest` — infer role/location/skills from resume text
- `POST /api/v1/jobs/search` — search normalized jobs with provider health status

Environment variables for `services/api-fastapi`:

- `JOOBLE_API_KEY`
- `JOOBLE_COUNTRY_DOMAIN` (optional, for example `jooble.org` or `uk.jooble.org`)
- `JOB_SEARCH_PROVIDERS` (default `jooble`; use `all` or comma-separated values like `jooble,usajobs`)
- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (only when Adzuna is enabled)
- `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT` (only when USAJOBS is enabled)

Notes:

- Provider failures are isolated; available sources still return results.
- Applications complete on external job sites. TechPrep supports **select-all + open selected applications** in one click, but it does not auto-submit multi-site forms.

## Next Build Items

- Add JWT/OAuth2 between React and FastAPI
- Connect FastAPI -> Flask AI service for scoring and answer evaluation
- Add async job queue for transcript processing
- Add Terraform for AWS/Azure deployment
