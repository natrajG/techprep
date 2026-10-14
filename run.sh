#!/usr/bin/env bash
# Usage: ./run.sh [all|api|web|overlay|lan]
#   all (default): backend (port ${PORT:-8000}) + React dev server (http://localhost:5173) + the transparent,
#                  always-on-top overlay window showing the dev server. Closing the overlay or Ctrl+C stops everything.
#   api: backend only (used by the desktop app).  web: dev server only.  overlay: overlay window only.
#   lan: loopback-only backend + HTTPS dev server, without the desktop overlay.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
API_PORT="${PORT:-8000}"
WEB_URL="http://localhost:5173/"
mode="${1:-all}"
curl_tls=()
if [ "$mode" = "lan" ]; then
  for file in ca.crt server.pem server-key.pem; do
    if [ ! -f "$ROOT/.certs/$file" ]; then
      echo "Missing HTTPS certificates. Run: bash infra/setup-https.sh <LAN-IP>" >&2
      exit 1
    fi
  done
  export TECHPREP_HTTPS=1
  WEB_URL="https://localhost:5173/"
  curl_tls=(--cacert "$ROOT/.certs/ca.crt")
fi

load_node() {
  # Non-interactive shells don't load nvm; without it the (broken) system npm is used.
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    set +u; . "$NVM_DIR/nvm.sh"
    # Electron 44 needs Node 22 (see .nvmrc); install it with: nvm install
    nvm use --silent "$(cat "$ROOT/.nvmrc")" >/dev/null || echo "Node $(cat "$ROOT/.nvmrc") is missing; run 'nvm install' in $ROOT" >&2
    set -u
  fi
}

run_api() {
  cd "$ROOT/services/api-fastapi"
  if [ ! -x .venv/bin/python ]; then
    /usr/bin/python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
  fi
  # .env is the source of truth and overrides stale shell exports (e.g. an old OPENAI_API_KEY).
  if [ -f "$ROOT/.env" ]; then
    set -a; . "$ROOT/.env"; set +a
  fi
  local host=0.0.0.0
  [ "$mode" != "lan" ] || host=127.0.0.1
  exec .venv/bin/python -m uvicorn app.main:app --host "$host" --port "$API_PORT"
}

run_web() {
  load_node
  cd "$ROOT/frontend/react-web"
  [ -d node_modules ] || npm install
  PORT="$API_PORT" exec npm run dev
}

run_overlay() {
  load_node
  cd "$ROOT/desktop"
  [ -d node_modules ] || npm install
  APP_URL="${APP_URL:-$WEB_URL}" PORT="$API_PORT" exec npm start
}

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 120); do
    curl "${curl_tls[@]}" -sf --max-time 2 -o /dev/null "$url" && return 0
    sleep 0.5
  done
  echo "$name did not start ($url)" >&2
  return 1
}

case "$mode" in
  api) run_api ;;
  web) run_web ;;
  overlay) run_overlay ;;
  all|lan) ;;
  *) echo "Usage: $0 [all|api|web|overlay|lan]" >&2; exit 1 ;;
esac

pids=()
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

for url in "http://127.0.0.1:$API_PORT/" "$WEB_URL"; do
  if curl "${curl_tls[@]}" -s --max-time 2 -o /dev/null "$url"; then
    echo "$url is already in use (TechPrep already running?). Stop it first, or use './run.sh overlay'." >&2
    exit 1
  fi
done

(run_api) &
pids+=($!)
(run_web) &
pids+=($!)

wait_for "http://127.0.0.1:$API_PORT/health" "API"
wait_for "$WEB_URL" "Vite dev server"
if [ "$mode" = "lan" ]; then
  echo "Web: $WEB_URL or https://<LAN-IP>:5173/ | API proxied securely through the web server"
else
  echo "API: http://localhost:$API_PORT  |  Web: $WEB_URL  |  opening overlay window…"
  (run_overlay) &
  pids+=($!)
fi

# Exit (and stop the rest) as soon as any process dies, e.g. when the overlay window is closed.
wait -n
