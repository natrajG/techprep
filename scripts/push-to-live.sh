#!/usr/bin/env bash
# Push changes to live production server (AWS Lightsail) in one step.
# Usage: ./scripts/push-to-live.sh [--skip-build] [--skip-git]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${TECHPREP_SSH_KEY:-$HOME/.ssh/techprep-lightsail}"
INSTANCE_NAME="${TECHPREP_INSTANCE:-techprep-prod}"
INSTANCE_IP="${TECHPREP_IP:-13.201.213.33}"
REMOTE_USER="ubuntu"
REMOTE_APP_DIR="/srv/techprep/app"

export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$HOME/.local/bin:$PATH"

echo "==> [1/5] Ensuring firewall access to Lightsail..."
if command -v aws >/dev/null 2>&1; then
  MY_IP="$(curl -fsS https://ifconfig.me 2>/dev/null || curl -fsS https://api.ipify.org 2>/dev/null || true)"
  if [ -n "$MY_IP" ]; then
    aws lightsail open-instance-public-ports \
      --instance-name "$INSTANCE_NAME" \
      --port-info fromPort=22,toPort=22,protocol=tcp,cidrs="${MY_IP}/32" \
      >/dev/null 2>&1 || true
  fi
fi

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> [2/5] Building frontend bundle..."
  npm --prefix "$REPO_DIR/frontend/react-web" run build --silent
else
  echo "==> [2/5] Skipping local frontend build..."
fi

echo "==> [3/5] Syncing code to live server..."
rsync -az \
  -e "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -i $SSH_KEY" \
  --exclude "/.env" \
  --exclude "/.certs/" \
  --exclude ".git" \
  --exclude ".idea" \
  --exclude "*.db" \
  --exclude "*.db-*" \
  --exclude "services/api-fastapi/data" \
  --exclude "infra/lightsail/.env" \
  --exclude "infra/lightsail/production.env" \
  --exclude "node_modules" \
  --exclude "*/node_modules" \
  --exclude "*/*/node_modules" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude ".venv" \
  "$REPO_DIR/" \
  "${REMOTE_USER}@${INSTANCE_IP}:${REMOTE_APP_DIR}/"

echo "==> [4/5] Running backup and deployment on server..."
ssh -o BatchMode=yes -i "$SSH_KEY" "${REMOTE_USER}@${INSTANCE_IP}" \
  "sudo -n bash ${REMOTE_APP_DIR}/infra/lightsail/backup.sh >/dev/null 2>&1 || true; bash ${REMOTE_APP_DIR}/infra/lightsail/deploy.sh"

echo "==> [5/5] Checking Git remote push..."
if [[ "${1:-}" != "--skip-git" && "${2:-}" != "--skip-git" ]]; then
  if git -C "$REPO_DIR" push origin main 2>&1; then
    echo "Pushed commits to origin main."
  else
    echo "Notice: Git remote push skipped (provide or configure your GitHub SSH key/PAT to push to GitHub)."
  fi
fi

echo "==> Done! TechPrep is live at https://13-201-213-33.sslip.io/"
