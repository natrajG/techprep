#!/usr/bin/env bash
# Build and (re)start TechPrep on the server. Run from any directory: infra/lightsail/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "deploy: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is not installed."
[ -f .env ] || fail "Missing infra/lightsail/.env (TECHPREP_HOST=your.public.hostname)."
[ -f production.env ] || fail "Missing infra/lightsail/production.env (copy production.env.example)."

# Read settings as data; never source or print these files.
setting() { sed -n "s/^$1=//p" "$2" | tail -n 1; }
host="$(setting TECHPREP_HOST .env)"
[[ "$host" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || fail "TECHPREP_HOST must be a lower-case public DNS hostname."

[ "$(stat -c %a production.env)" = 600 ] || fail "Run: chmod 600 infra/lightsail/production.env"
if grep -q REPLACE production.env; then fail "production.env still contains REPLACE placeholders."; fi
for key in APP_PUBLIC_URL AUTH_SECRET OPENAI_API_KEY; do
  [ -n "$(setting "$key" production.env)" ] || fail "$key is empty in production.env."
done
[ "$(setting APP_PUBLIC_URL production.env)" = "https://$host" ] || fail "APP_PUBLIC_URL must be https://$host"

releases="$(setting TECHPREP_RELEASES_DIR .env)"
releases="${releases:-/srv/techprep/releases}"
[ -d "$releases" ] || fail "Create the release directory: sudo install -d -m 755 $releases"

docker compose build --pull api
docker compose up -d --remove-orphans

echo "Waiting for the API to become healthy..."
for _ in $(seq 1 60); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || true)"
  [ "$state" = healthy ] && break
  [ "$state" = unhealthy ] && { docker compose logs --tail 40 api; fail "API is unhealthy."; }
  sleep 2
done
[ "$state" = healthy ] || { docker compose logs --tail 40 api; fail "API did not become healthy."; }

echo "Checking public HTTPS (the first certificate can take a minute after DNS points here)..."
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$host/health" >/dev/null; then
    echo "TechPrep is live at https://$host/"
    exit 0
  fi
  sleep 5
done
docker compose logs --tail 40 caddy
fail "https://$host/ is not reachable yet. Check that DNS points to this server and ports 80/443 are open."
