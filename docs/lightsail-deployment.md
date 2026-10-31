# Production deployment on AWS Lightsail

This is an **initial invite-only pilot**: one Ubuntu server running the API and web UI behind
Caddy (automatic, publicly trusted HTTPS). Sign-up is off by default because email verification
and password reset do not exist yet; the bootstrap administrator account is configured in
`production.env`.

Limits to accept for this stage: a single server (updates and failures cause brief downtime),
SQLite storage on that server, and backups you schedule yourself.

## Costs

Lightsail plans are billed monthly once any free trial ends. Static IPs are free only while attached
to an instance; snapshots and transfer above the plan allowance are billed. Check the Lightsail
pricing page and your Billing console; do not assume the deployment is free.

## 1. Server and network

- Region: closest to your users (e.g. `ap-south-1`). Blueprint: **Ubuntu 24.04**. Plan: 2 GB RAM recommended.
- Launch script: [`infra/lightsail/launch-script.sh`](../infra/lightsail/launch-script.sh)
  (Docker, Compose, unattended security updates, swap, `/srv/techprep/releases`).
- Attach a **static IP**.
- Firewall (IPv4 and IPv6): TCP 80 and 443 from anywhere; UDP 443 optional (HTTP/3);
  TCP 22 **only from your own IP**. Never open 8000.

## 2. Hostname

Any public DNS name works. Free options:

- **DuckDNS**: create a subdomain at duckdns.org and set its IPv4 address to the static IP.
- **sslip.io**: `<ip-with-dashes>.sslip.io` (e.g. `13-200-1-2.sslip.io`) resolves to that IP
  with no account. Fine for a pilot; use a domain you own for a real launch.

Changing the hostname later requires a new desktop build, because installers embed the server address.

## 3. Configure and deploy

On the server (as `ubuntu`, in a copy of this repository, e.g. `/srv/techprep/app`):

```bash
cd infra/lightsail
printf 'TECHPREP_HOST=%s\n' your.host.name > .env
cp production.env.example production.env && chmod 600 production.env
# Edit production.env: APP_PUBLIC_URL=https://your.host.name, AUTH_SECRET, APP_PASSWORD, OPENAI_API_KEY.
./deploy.sh
```

`deploy.sh` validates settings without printing them, builds the image, starts the stack, waits for
the API health check, then confirms `https://<host>/health`. The API also refuses to start with
missing or weak production settings. Re-run `./deploy.sh` after pulling updates.

Hardening in place: only Caddy publishes ports; the API runs as a non-root, read-only container
with all capabilities dropped; it trusts forwarded client addresses only from Caddy's fixed
private address; login/sign-up attempts and AI requests are rate-limited in the database;
provider errors are not shown to users; the private LAN CA download is disabled.

## 4. Windows installer

Production downloads are served only when `/srv/techprep/releases` contains **both**
`TechPrep-Setup.exe` and a matching `desktop-release.json` (`signed: true`, correct size, SHA-256,
and `serverUrl` equal to `APP_PUBLIC_URL`). Otherwise users see "not available yet".
Create them with `npm --prefix desktop run release:win` on Windows (or the
*Windows signed release* workflow), which refuses to publish unless Authenticode verification
passes — see [desktop packaging](desktop-capture-protection.md#production-signed-release).

```bash
scp TechPrep-Setup.exe desktop-release.json ubuntu@<host>:/tmp/
ssh ubuntu@<host> 'sudo install -m 644 /tmp/TechPrep-Setup.exe /srv/techprep/releases/ && \
  sudo install -m 644 /tmp/desktop-release.json /srv/techprep/releases/'
```

Copy the installer first and the manifest last.

## 5. macOS installer

Production downloads are served only when `/srv/techprep/releases` contains **both**
`TechPrep.dmg` and a matching `desktop-release-mac.json` (correct size, SHA-256, and `serverUrl`
equal to `APP_PUBLIC_URL`). Otherwise users see "not available yet". Create them with
`npm --prefix desktop run release:mac` **on macOS**, which refuses to publish unless the app and
`.dmg` are Developer ID-signed, pass Gatekeeper, and are notarized by Apple (manifest
`signed: true`, `notarized: true`) — see
[macOS production signed release](desktop-capture-protection.md#macos-production-signed-release).
This is a direct-download release; it does not involve any App Store Connect upload or review.

If you cannot yet pay for an Apple Developer Program account, run
`npm --prefix desktop run release:mac:unsigned` instead (no Apple credentials needed); it publishes
the same two files with `signed: false, notarized: false` so the server still verifies and serves
it honestly — see
[free-tier release: unsigned](desktop-capture-protection.md#free-tier-release-unsigned-no-apple-developer-program-account).
Users will see a one-time Gatekeeper warning they must bypass manually.

```bash
scp TechPrep.dmg desktop-release-mac.json ubuntu@<host>:/tmp/
ssh ubuntu@<host> 'sudo install -m 644 /tmp/TechPrep.dmg /srv/techprep/releases/ && \
  sudo install -m 644 /tmp/desktop-release-mac.json /srv/techprep/releases/'
```

Copy the installer first and the manifest last. It lives in the same `/srv/techprep/releases`
directory as the Windows installer; the server verifies each platform's file/manifest pair
independently.

## 6. Backups and restore

```bash
infra/lightsail/backup.sh                       # -> /var/backups/techprep/users-<UTC time>.db, keeps 14
sudo crontab -e   # e.g.: 15 3 * * * /srv/techprep/app/infra/lightsail/backup.sh >/dev/null
```

Backups use SQLite's online backup API with an integrity check, so the service keeps running.
Copy them off the server periodically, and enable Lightsail automatic snapshots as a second layer.
`production.env` is not in backups; keep its secrets in a password manager.

Restore (brief downtime):

```bash
cd infra/lightsail
restore_dir=$(sudo mktemp -d)
sudo install -o 10001 -m 600 /var/backups/techprep/users-<UTC time>.db "$restore_dir/users.db"
docker compose stop api
docker compose run --rm --no-deps -v "$restore_dir:/restore:ro" api \
  python -c "import shutil; shutil.copyfile('/restore/users.db', '/data/users.db')"
docker compose start api
sudo rm -r -- "$restore_dir"
```

## Before a wider public launch

Email verification and password reset, a domain you own, error monitoring/alerting, managed
database or off-server backups, and a reviewed privacy policy/terms for audio and resume data.
