#!/usr/bin/env bash
# RealHack Pilot — redeploy after a code change
# Run as: sudo bash /opt/realhack-pilot/app/deploy/update.sh
set -euo pipefail

APP_USER="realhack"
APP_DIR="/opt/realhack-pilot/app"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run as root."; exit 1; }

log "Pulling latest"
sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only

log "Updating backend deps"
sudo -u "${APP_USER}" bash -c "cd '${APP_DIR}/backend' && .venv/bin/python -m pip install -r requirements.txt --quiet"

log "Rebuilding frontend"
sudo -u "${APP_USER}" bash -c "cd '${APP_DIR}/frontend' && npm ci --silent && npm run build"

log "Restarting backend service"
systemctl restart realhack-pilot

log "Reloading nginx"
nginx -t && systemctl reload nginx

sleep 2
if curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    echo "  [OK] backend healthy"
else
    echo "  [!] backend not responding — check: journalctl -u realhack-pilot -n 50"
fi

log "Done."
