#!/usr/bin/env bash
# Consistent SQLite backup of the user database. Usage: infra/lightsail/backup.sh [backup-dir] [keep-count]
set -euo pipefail
cd "$(dirname "$0")"

destination="${1:-/var/backups/techprep}"
keep="${2:-14}"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || { echo "keep-count must be a positive integer" >&2; exit 1; }

name="users-$(date -u +%Y%m%dT%H%M%SZ).db"
install -d -m 700 "$destination"

# SQLite's online backup API produces a consistent copy while the API keeps running.
docker compose exec -T api python - "$name" <<'PY'
import sqlite3, sys
source = sqlite3.connect("/data/users.db")
target = sqlite3.connect(f"/data/{sys.argv[1]}")
with target:
    source.backup(target)
check = target.execute("PRAGMA integrity_check").fetchone()[0]
target.close(); source.close()
if check != "ok":
    raise SystemExit(f"integrity check failed: {check}")
PY

container="$(docker compose ps -q api)"
docker cp "$container:/data/$name" "$destination/$name"
docker compose exec -T api python -c "import os, sys; os.remove('/data/' + sys.argv[1])" "$name"
chmod 600 "$destination/$name"
echo "Backup written: $destination/$name"

# Retention only touches files this script created.
mapfile -t old < <(find "$destination" -maxdepth 1 -type f -name 'users-*.db' -printf '%f\n' | sort -r | tail -n +"$((keep + 1))")
for file in "${old[@]}"; do
  rm -f -- "$destination/$file"
done
