#!/usr/bin/env bash
# RealHack Pilot — first-time server setup
#
# Target: Rocky Linux 9 (also works on RHEL 9 / Alma 9)
# Run as: sudo bash setup.sh
#
# Idempotent: safe to re-run; will skip work that's already done.
#
# Before running:
#   1. Clone the repo to /opt/realhack-pilot/app
#   2. Copy deploy/.env.production.template to /opt/realhack-pilot/.env.production
#      and fill in the real secrets (OpenAI, Anthropic, Azure secret, Postgres password)
#   3. chmod 600 the .env.production after filling it
set -euo pipefail

APP_USER="realhack"
APP_HOME="/opt/realhack-pilot"
APP_DIR="${APP_HOME}/app"
ENV_FILE="${APP_HOME}/.env.production"
PYTHON_BIN="python3.11"   # Rocky 9 default is 3.9; we need 3.10+

DB_NAME="realhack_pilot"
DB_USER="realhack"

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
log()  { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m[!] %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m[X] %s\033[0m\n" "$*" >&2; exit 1; }

require_root() {
    [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run as root (sudo bash setup.sh)"
}

# ------------------------------------------------------------------
# 0. Sanity
# ------------------------------------------------------------------
require_root

log "Checking required source location"
[[ -d "${APP_DIR}/backend" && -d "${APP_DIR}/frontend" ]] \
    || die "Expected the repo cloned at ${APP_DIR} (with backend/ and frontend/). \
Clone first:  git clone https://github.com/ShaikshavaliKalluri/RealHackPilot.git ${APP_DIR}"

[[ -f "${ENV_FILE}" ]] \
    || die "Expected ${ENV_FILE}. Copy deploy/.env.production.template and fill in secrets first."

# ------------------------------------------------------------------
# 1. Install Python 3.11 (Rocky 9 default is 3.9; our code needs 3.10+)
# ------------------------------------------------------------------
log "Installing Python 3.11 if missing"
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
    dnf install -y python3.11 python3.11-pip python3.11-devel
fi

"${PYTHON_BIN}" --version

# ------------------------------------------------------------------
# 2. App user + directories
# ------------------------------------------------------------------
log "Creating service user '${APP_USER}'"
if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${APP_HOME}" --shell /sbin/nologin "${APP_USER}"
fi

mkdir -p "${APP_HOME}" /var/log/realhack-pilot
chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}" /var/log/realhack-pilot
chmod 600 "${ENV_FILE}"
chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"

# ------------------------------------------------------------------
# 3. Backend: venv + deps
# ------------------------------------------------------------------
log "Building Python venv + installing backend deps"
sudo -u "${APP_USER}" bash <<EOF
set -euo pipefail
cd "${APP_DIR}/backend"
if [[ ! -d .venv ]]; then
    ${PYTHON_BIN} -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip --quiet
.venv/bin/python -m pip install -r requirements.txt --quiet
EOF

# ------------------------------------------------------------------
# 4. Frontend: install + build
# ------------------------------------------------------------------
log "Building frontend (Vite)"
sudo -u "${APP_USER}" bash <<EOF
set -euo pipefail
cd "${APP_DIR}/frontend"
npm ci --silent
npm run build
EOF

[[ -d "${APP_DIR}/frontend/dist" ]] || die "Frontend build did not produce dist/"

# ------------------------------------------------------------------
# 5. PostgreSQL: ensure service + create db/user if missing
# ------------------------------------------------------------------
log "Configuring PostgreSQL"

# Start postgres if it isn't running (some images leave it disabled)
if ! systemctl is-active --quiet postgresql; then
    # Some Rocky 9 setups use postgresql-16 instead of plain postgresql
    if systemctl list-unit-files | grep -q '^postgresql-16.service'; then
        systemctl enable --now postgresql-16
    else
        systemctl enable --now postgresql
    fi
fi

# Pull DB password from the .env file (the user fills it in before running this script)
DB_PASSWORD="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | sed -E 's|^DATABASE_URL=postgresql\+psycopg2://[^:]+:([^@]+)@.*|\1|')"
if [[ -z "${DB_PASSWORD}" || "${DB_PASSWORD}" == "CHANGE_ME" ]]; then
    die "Set a real password in ${ENV_FILE} DATABASE_URL before running setup.sh"
fi

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
        ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec

GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

# ------------------------------------------------------------------
# 6. systemd service
# ------------------------------------------------------------------
log "Installing systemd unit"
install -m 0644 "${APP_DIR}/deploy/realhack-pilot.service" /etc/systemd/system/realhack-pilot.service
systemctl daemon-reload
systemctl enable realhack-pilot
systemctl restart realhack-pilot

# ------------------------------------------------------------------
# 7. nginx
# ------------------------------------------------------------------
log "Installing nginx config"
install -m 0644 "${APP_DIR}/deploy/realhack-pilot.nginx.conf" /etc/nginx/conf.d/realhack-pilot.conf

# Allow nginx to read static files from /opt (SELinux is enforcing on Rocky by default)
if command -v restorecon >/dev/null 2>&1; then
    semanage fcontext -a -t httpd_sys_content_t "${APP_DIR}/frontend/dist(/.*)?" 2>/dev/null || true
    restorecon -R "${APP_DIR}/frontend/dist" || true
fi
if command -v setsebool >/dev/null 2>&1; then
    # Allow nginx to connect to the backend on a local port
    setsebool -P httpd_can_network_connect 1 || true
fi

# Validate config before touching the running nginx. If `nginx -t` fails, exit
# rather than reload — the running config (which serves Pulse) stays intact.
nginx -t
systemctl enable nginx
# reload, not restart: this box also hosts Pulse on the same nginx process.
# `reload` re-reads config without dropping in-flight Pulse connections.
systemctl reload nginx

# ------------------------------------------------------------------
# 8. Firewall (firewalld is default on Rocky)
# ------------------------------------------------------------------
if systemctl is-active --quiet firewalld; then
    log "Opening firewall for HTTP"
    firewall-cmd --permanent --add-service=http >/dev/null
    firewall-cmd --reload >/dev/null
fi

# ------------------------------------------------------------------
# 9. Smoke test
# ------------------------------------------------------------------
log "Smoke testing"
sleep 3
if curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    echo "  [OK] backend healthy"
else
    warn "backend not responding on 127.0.0.1:8000 — check: journalctl -u realhack-pilot -n 50"
fi

if curl -fsS -o /dev/null -w "  [OK] nginx returned %{http_code}\n" "http://127.0.0.1/"; then
    :
else
    warn "nginx not responding on :80 — check: systemctl status nginx ; journalctl -u nginx -n 50"
fi

log "Done."
echo
echo "Service:    systemctl status realhack-pilot"
echo "Logs:       journalctl -u realhack-pilot -f"
echo "Nginx:     /var/log/nginx/realhack-pilot.{access,error}.log"
echo "Open in a browser:  http://<server-ip>/"
echo
echo "To redeploy after a code change:  sudo bash ${APP_DIR}/deploy/update.sh"
