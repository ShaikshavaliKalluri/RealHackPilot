# RealHack Pilot — Deployment Guide

Target server: **`rcapaywwaiw002`** (Rocky Linux 9, 16 GB / 150 GB, static internal IP)

VMware infra (for any sibling server requests like the dedicated DB box):
- vCenter: `rp1vcdev`
- Cluster: `rp1_devapp_linux1`
- Datastore: `DevApp_CentOS1_PSTORE01_71`

---

## What this deploys

```
                ┌────────────────────────────────────────────┐
   http://<IP>/ │  rcapaywwaiw002                            │
                │                                             │
                │  [nginx :80]                                │
                │      ├── /        → /opt/.../dist (static)  │
                │      ├── /api/*   → 127.0.0.1:8000          │
                │      └── /health  → 127.0.0.1:8000/api/...  │
                │                                             │
                │  [uvicorn :8000]  (systemd service)         │
                │      └── connects to                        │
                │                                             │
                │  [Postgres :5432] (local, swap to dedicated │
                │                    DB host when provisioned)│
                └────────────────────────────────────────────┘
```

Frontend served as static files (Vite build). Backend is a `realhack-pilot.service` systemd unit running uvicorn under a dedicated `realhack` user. Postgres uses the pre-installed Postgres 16 on the same host today.

**HTTP only for now.** Real Entra-mode sign-in (and any real Graph operations triggered from the dashboard UI) requires HTTPS — see "Phase 2: HTTPS + Real Auth" at the bottom.

---

## First-time deployment (~10 minutes)

Run all of this on the server as a user with sudo.

### 1. Clone the repo into the expected location

```bash
sudo mkdir -p /opt/realhack-pilot
sudo chown $USER /opt/realhack-pilot
git clone https://github.com/ShaikshavaliKalluri/RealHackPilot.git /opt/realhack-pilot/app
```

### 2. Configure secrets

```bash
sudo cp /opt/realhack-pilot/app/deploy/.env.production.template /opt/realhack-pilot/.env.production
sudo nano /opt/realhack-pilot/.env.production
```

Fill in:
- `DATABASE_URL` — pick a strong Postgres password (replace `CHANGE_ME`)
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`
- `AZURE_CLIENT_SECRET`
- Leave `GRAPH_MODE=mock` for now (flip to `graph` once HTTPS + MSAL are in)
- Update `CORS_ORIGINS` to include the server's IP, e.g. `http://10.20.30.40`

Lock down the file:
```bash
sudo chmod 600 /opt/realhack-pilot/.env.production
```

### 3. Run the setup script

```bash
sudo bash /opt/realhack-pilot/app/deploy/setup.sh
```

This will:
- Install Python 3.11 if not present (Rocky 9 default is 3.9; we need 3.10+)
- Create the `realhack` system user
- Build the Python venv + install backend deps
- Build the frontend (Vite production build)
- Create the Postgres database + user (using the password from your `.env`)
- Install + start the `realhack-pilot.service` systemd unit
- Install the nginx config
- Configure SELinux contexts + firewall rules
- Run a smoke test

End state: `http://<server-ip>/` serves the dashboard.

### 4. Verify

```bash
# backend health
curl http://127.0.0.1:8000/api/health

# nginx-fronted health (same response, via :80)
curl http://127.0.0.1/health

# logs
journalctl -u realhack-pilot -f

# from your laptop:
# open http://<server-ip>/  in a browser
```

### 5. Upload some data

The dashboard is empty until you upload an MS Forms registration Excel. Either:
- Use the dashboard's "Upload registrations" button (web UI)
- Or `scp` an `.xlsx` file to the server and `curl -X POST -F "file=@..." http://127.0.0.1:8000/api/upload`

---

## Redeploy after a code change

```bash
sudo bash /opt/realhack-pilot/app/deploy/update.sh
```

This pulls the latest from GitHub, rebuilds frontend, restarts the backend service, reloads nginx, and runs a health check.

---

## Operations

| What | How |
|---|---|
| Start backend | `sudo systemctl start realhack-pilot` |
| Stop backend | `sudo systemctl stop realhack-pilot` |
| Restart backend | `sudo systemctl restart realhack-pilot` |
| Status | `sudo systemctl status realhack-pilot` |
| Live logs | `sudo journalctl -u realhack-pilot -f` |
| Last 200 log lines | `sudo journalctl -u realhack-pilot -n 200` |
| Nginx reload (e.g. after config change) | `sudo nginx -t && sudo systemctl reload nginx` |
| Nginx access log | `sudo tail -f /var/log/nginx/realhack-pilot.access.log` |
| Nginx errors | `sudo tail -f /var/log/nginx/realhack-pilot.error.log` |
| DB dump (manual backup) | `sudo -u postgres pg_dump realhack_pilot > /var/backups/realhack-pilot-$(date +%F).sql` |

---

## Provisioning Teams channels (one-shot, after IT clears your app-assignment)

The CLI works directly on the server. Once IT confirms you're a member of the security group + the group is assigned to the Enterprise App:

```bash
sudo -u realhack bash
cd /opt/realhack-pilot/app/backend
./.venv/bin/python provision_team_channels.py --dry-run
# review the plan
./.venv/bin/python provision_team_channels.py
```

The script uses device-code auth (sign in via `microsoft.com/device` with the code it prints). Provisions all 48 private channels inside the parent Microsoft Team named in `GRAPH_PARENT_TEAM_ID`, adds members and mentor, and logs to the dashboard's audit log.

---

## Migrate to dedicated DB server (when provisioned)

When the new DB host is ready:

1. Create the DB + user on the new host (same SQL the setup.sh runs)
2. Migrate data:
   ```bash
   sudo -u postgres pg_dump realhack_pilot | PGPASSWORD=<new-pw> psql -h <new-db-host> -U realhack realhack_pilot
   ```
3. Update `/opt/realhack-pilot/.env.production` — change `DATABASE_URL` to point at the new host
4. `sudo systemctl restart realhack-pilot`
5. Verify with `curl http://127.0.0.1:8000/api/stats` — should return the same team counts

---

## Phase 2: HTTPS + Real Entra Auth (future)

Once you decide to enable real Entra sign-in from the dashboard (vs. CLI-only provisioning):

1. **Get a cert.** Either:
   - Request an internal CA cert for `rcapaywwaiw002.realpage.com` (preferred)
   - Generate self-signed (`openssl req -x509 -newkey rsa:4096 -nodes -days 365 -keyout key.pem -out cert.pem -subj "/CN=rcapaywwaiw002"`)
2. Add an `https` server block to the nginx config (use existing `listen 80` block as a template; add `listen 443 ssl` with cert paths)
3. In Entra Admin Center → App Registrations → RealHack Pilot → Authentication → add the HTTPS URL as an SPA redirect URI
4. Wire MSAL.js into the frontend (~45 min of code)
5. Flip `GRAPH_MODE=mock` → `GRAPH_MODE=graph` in `.env.production`
6. Restart: `sudo systemctl restart realhack-pilot`

Result: dashboard sign-in is silent (corporate SSO), real Graph operations work from the UI, audit log shows `sent` instead of `mocked`.

---

## Troubleshooting

### Backend won't start

```bash
sudo journalctl -u realhack-pilot -n 100 --no-pager
```

Common causes:
- `DATABASE_URL` password doesn't match Postgres user's actual password → re-run the `CREATE/ALTER ROLE` step from setup.sh
- `.env.production` has Windows line endings (CRLF) → `sudo dos2unix /opt/realhack-pilot/.env.production`
- Python 3.11 missing → `sudo dnf install python3.11 python3.11-devel`

### Frontend shows "Network Error" / 502 from nginx

Backend is down or unreachable:
```bash
curl http://127.0.0.1:8000/api/health
sudo systemctl status realhack-pilot
```

### Static files 403 (SELinux)

```bash
sudo restorecon -R /opt/realhack-pilot/app/frontend/dist
sudo setsebool -P httpd_can_network_connect 1
```

### Port 80 already in use

Some other service is bound:
```bash
sudo ss -tlnp | grep :80
```
Stop the offending process, then `sudo systemctl restart nginx`.

---

## File map on the server

```
/opt/realhack-pilot/
├── .env.production            # secrets, chmod 600, owned by realhack
└── app/                       # the cloned git repo
    ├── backend/
    │   ├── .venv/             # python 3.11 venv
    │   └── app/ …
    ├── frontend/
    │   └── dist/              # built static files (nginx serves these)
    └── deploy/
        ├── setup.sh
        ├── update.sh
        ├── realhack-pilot.service
        ├── realhack-pilot.nginx.conf
        ├── .env.production.template
        └── README.md          # this file

/etc/systemd/system/realhack-pilot.service   # symlinked / copied from deploy/
/etc/nginx/conf.d/realhack-pilot.conf        # symlinked / copied from deploy/
/var/log/nginx/realhack-pilot.{access,error}.log
journalctl -u realhack-pilot                 # backend logs
```
