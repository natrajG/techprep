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
   Audio is transcribed in 6-second chunks.
5. Click **Answer** (or press Enter). It picks out the latest interviewer question, or uses one you typed, and streams back an answer.
   Programming requests return just the code by default; ask "explain it" afterward for a concise explanation.
   The overlay keeps the last two Q&A turns in memory for follow-ups, without persisting them or resending the full conversation.

   On Windows, **Listen** defaults to system audio plus microphone. Change the source to
   **Microphone only** or **System audio** under Quick Settings or the profile's Stealth & HUD
   settings while stopped. Microphone-only avoids screen capture; system audio (including the
   default combined mode) requires a brief Electron screen-capture start, which may still affect
   the cursor on some Windows setups. Failed system capture no longer silently switches to the
   microphone. Transcription receives technical vocabulary hints, including Django, to improve
   recognition of short interview clips.

API: `POST /api/v1/transcribe` (multipart `audio`), `POST /api/v1/answer` (SSE stream), `POST /api/v1/evaluate` (practice scoring).
The monthly plan defaults to 30 one-hour calls within 30 days. A call window begins on the first
AI or audio request and subsequent requests within that hour use the same call; the hourly
plan includes one call window (60 minutes by default). An administrator signed in with
`APP_USERNAME` can edit plan prices, monthly call allowance, hourly call duration, and monthly
plan duration in the account profile or web dashboard. Changes apply only to newly created
orders; existing orders and subscriptions retain their purchased terms. Previously purchased
unlimited monthly subscriptions remain unlimited. The account profile shows remaining calls and provider-reported
AI input/output token usage since tracking began. Audio transcription is not included in the
token count, and tokens have no separate quota. Set `ENFORCE_SUBSCRIPTIONS=true` to require
an active paid plan for AI endpoints; existing paid plans always respect their call limits.
The public privacy policy is available at `/privacy/` without signing in; deploy the latest
web build before using its URL in a Store listing.

### HTTPS on your local network (free certificate)

Use the host computer's Wi-Fi/Ethernet IP address, not `localhost`, on other devices.
For example, if its LAN IP is `192.168.1.20`:

```bash
bash infra/setup-https.sh 192.168.1.20
./run.sh lan
```

Open **https://192.168.1.20:5173/** from another device on the same network
(or **https://localhost:5173/** on the host). This mode starts the API and HTTPS web server
without the desktop overlay. Ctrl+C stops both. The normal `./run.sh` desktop mode remains HTTP.

**Trust the certificate first:** securely copy only `.certs/ca.crt` to each client,
including the host if you use its browser, and install it as a trusted certificate authority:

- Windows: import into **Trusted Root Certification Authorities** for the current user.
- macOS: import into Keychain Access and set **Always Trust** for SSL.
- Ubuntu/Debian: copy to `/usr/local/share/ca-certificates/techprep-local.crt`, then run
  `sudo update-ca-certificates`. If your browser uses its own certificate store, also import
  the certificate under its certificate settings / Authorities (including Firefox when needed).

Restart the browser after trusting it. Merely bypassing a certificate warning is not a substitute
for trust; browser audio/screen-capture features need a trusted secure context.
This is a private local CA, not a publicly trusted certificate or an internet deployment.
**Never share `.certs/ca-key.pem` or `.certs/server-key.pem`.** The `.certs/` directory is git-ignored.
To remove trust later, remove the imported TechPrep Local CA from the device/browser certificate store.

The server certificate lasts one year. Rerun the setup command and restart `./run.sh lan`
to renew it or after the host's IP changes; the existing CA is reused, so client trust stays valid.
You can supply multiple IP addresses to the setup command.
Allow inbound TCP **5173** only from your trusted LAN if a firewall blocks access.
Do not forward this development server through your router to the internet.
The backend binds to loopback in LAN mode; login, uploads, and streamed answers use the
same HTTPS origin through Vite's proxy, so port 8000 need not be exposed.
Leave `VITE_API_URL` unset for this setup; an explicit override must point to an HTTPS API.
HTTP and HTTPS have separate browser storage, so sign in again and re-enter locally saved
resume/job details when switching.

### Desktop app (floating, transparent, stays open without a browser)

**Production:** see [Lightsail deployment](docs/lightsail-deployment.md) for the public HTTPS
server and [signed Windows releases](docs/desktop-capture-protection.md#production-signed-release).
For Microsoft Store distribution without a code-signing certificate, use the
[Windows AppX package](docs/desktop-capture-protection.md#microsoft-store-package-appx).
Production installers point to the public server, need no certificate import, and are served only
when a verified signed-release manifest matches. Desktop builds need Node.js 22 (`nvm install`).

**Download after login:** for local LAN testing, sign in in your browser, click
**Download Windows app**, and run `TechPrep-Setup.exe`. In production, the website
instead offers Store installation once the Store release is published; until then
it shows a coming-soon message. Sign in again in the installed desktop app.
The Windows LAN installer connects to the server configured at build time; no Python or
environment-variable setup is needed on the client. Keep the server running.
For local HTTPS, trust the server's CA certificate in Windows first; the download panel
includes a certificate download and instructions (LAN mode only). Browser login is not transferred to the app.
The installer and public CA certificate download endpoints require a valid login.
Installers are not served from Vite's public directory.

**Windows client with the LAN server:** use the desktop executable, trust `.certs/ca.crt`
in Windows, and set `APP_URL=https://<LAN-IP>:5173/` before launching it. No Python backend
is needed on that Windows client. See the
[Windows LAN setup](docs/desktop-capture-protection.md#connect-the-windows-app-to-the-existing-lan-https-server).
The browser's floating window cannot hide itself from screen sharing; the Windows
desktop app provides system-audio loopback and a best-effort capture-protection toggle.

```bash
cd frontend/react-web && npm install && npm run build   # once, and after UI changes
cd ../../desktop && npm install && npm start
```

- Starts the backend automatically (or reuses one already running on port 8000) and closes it on exit.
- Header: **📌 On top** toggle, **👁 opacity** slider, minimize/close; drag the window by its title bar.
- **Listen to system audio** records what plays through your speakers (Linux: PulseAudio monitor of
  the default output; Windows: system loopback). Use `AUDIO_SOURCE=mic npm start` for the microphone.
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

## Next Build Items

- Add JWT/OAuth2 between React and FastAPI
- Connect FastAPI -> Flask AI service for scoring and answer evaluation
- Add async job queue for transcript processing
- Add Terraform for AWS/Azure deployment
