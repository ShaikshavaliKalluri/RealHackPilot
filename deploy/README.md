# RealHack Pilot — Deployment Guide

Target server: **`rcapaywwaiw002`** (Rocky Linux 9, 16 GB / 150 GB, static internal IP)

VMware infra (for any sibling server requests like the dedicated DB box):
- vCenter: `rp1vcdev`
- Cluster: `rp1_devapp_linux1`
- Datastore: `DevApp_CentOS1_PSTORE01_71`

---

## What this deploys

```
   http://realhack.realpage.com/
                │
                ▼
   ┌────────────────────────────────────────┐         ┌──────────────────────┐
   │  rcapaywwaiw002 (app host, Rocky 8)    │         │  rcapaydbpgr001      │
   │                                         │  TCP    │  (DB VM, Postgres 14)│
   │  [nginx :80]                            │ :5432   │                      │
   │     ├── / (Host: realhack.realpage…)    │────────▶│  realhack_pilot DB   │
   │     │     → /opt/.../frontend/dist      │         │  postgres user       │
   │     ├── /api/* → 127.0.0.1:8000         │         │  (trust auth by IP)  │
   │     └── /health → 127.0.0.1:8000/api… │         └──────────────────────┘
   │                                         │
   │  [uvicorn :8000]  (systemd service,     │
   │                    user=realhack)       │
   │                                         │
   │  (shares nginx with Pulse — Pulse keeps │
   │   default_server + its own hostnames)   │
   └────────────────────────────────────────┘
```

Frontend served as static files (Vite build). Backend is a `realhack-pilot.service` systemd unit running uvicorn under a dedicated `realhack` user. Postgres runs on a separate VM (`rcapaydbpgr001`, Postgres 14) reached over the network on port 5432 — no Postgres installed on the app host.

**HTTP only for now.** Real Entra-mode sign-in (and any real Graph operations triggered from the dashboard UI) requires HTTPS — see "Phase 2: HTTPS + Real Auth" at the bottom.

**DB auth note (Phase 2 hardening).** Today we connect as the `postgres` superuser with no password — the DB box's `pg_hba.conf` trusts the app server's IP. This is convenient but means an app-server compromise yields DB root. Before broader hackathon traffic, create a dedicated `realhack` role with a password scoped to just `realhack_pilot` and update `DATABASE_URL` accordingly.

---

## Pre-flight: this box also runs Pulse

`rcapaywwaiw002` already hosts Pulse (internal AI engineering platform) on the same nginx and systemd. Coexistence is handled, but a few things must be true before `setup.sh`:

1. **DNS A record `realhack.realpage.com` → same IP as `pulse.realpage.com`** (already in place — verify with `nslookup realhack.realpage.com`). Our nginx config only catches traffic for this hostname; Pulse keeps `default_server` and continues owning `rcapaywwaiw002.realpage.com` + `pulse.realpage.com`.
2. **Remote Postgres on `rcapaydbpgr001` must be reachable** with the `realhack_pilot` database already created. Verify with `psql -h rcapaydbpgr001 -U postgres -d realhack_pilot -c '\\l'` from the app server. `setup.sh` does not create the database — that's a one-time manual step (`psql -h rcapaydbpgr001 -U postgres -d postgres -c "CREATE DATABASE realhack_pilot;"`).

The setup script `reload`s nginx instead of restarting it, so Pulse's in-flight connections aren't dropped. Our systemd unit is capped at `MemoryMax=2G` to leave headroom for Pulse on the 16GB box. Our service runs as a dedicated `realhack` user so it can never write into `/opt/pulse`.

**If DNS is delayed and you need to test today:** edit `realhack-pilot.nginx.conf` — change `listen 80;` to `listen 8080;` and `server_name realhack.realpage.com;` to `server_name _;`. Open the firewall with `sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload`. URL becomes `http://rcapaywwaiw002.realpage.com:8080/`. Swap back the moment DNS lands.

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
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`
- `AZURE_CLIENT_SECRET`
- Leave `GRAPH_MODE=mock` for now (flip to `graph` once HTTPS + MSAL are in)
- `DATABASE_URL` and `CORS_ORIGINS` are pre-filled in the template — leave as-is unless the DB host or app hostname changes

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
| DB dump (manual backup) | `pg_dump -h rcapaydbpgr001 -U postgres realhack_pilot > /var/backups/realhack-pilot-$(date +%F).sql` |

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

## Phase 2 DB hardening: dedicated role + password

Today the app connects to `rcapaydbpgr001` as the `postgres` superuser via `pg_hba.conf` trust auth on the app server's IP. Before broader hackathon traffic, swap to a least-privilege setup:

1. On `rcapaydbpgr001` (or via psql from the app server as `postgres`):
   ```sql
   CREATE ROLE realhack LOGIN PASSWORD '<strong-pw>';
   ALTER DATABASE realhack_pilot OWNER TO realhack;
   GRANT ALL PRIVILEGES ON DATABASE realhack_pilot TO realhack;
   ```
2. Ask whoever owns `rcapaydbpgr001`'s `pg_hba.conf` to add (and reload):
   ```
   host realhack_pilot realhack <app-server-IP>/32 scram-sha-256
   ```
   …and ideally tighten the existing app-server trust line so only specific accounts get in passwordlessly.
3. Update `/opt/realhack-pilot/.env.production`:
   ```
   DATABASE_URL=postgresql+psycopg2://realhack:<strong-pw>@rcapaydbpgr001:5432/realhack_pilot
   ```
4. `sudo systemctl restart realhack-pilot`
5. Verify with `curl http://127.0.0.1:8000/api/stats` — should return the same team counts.

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
- Remote DB unreachable → `psql -h rcapaydbpgr001 -U postgres -d realhack_pilot -c 'SELECT 1;'` from the app server. If it fails, check the network path and the DB box's `pg_hba.conf`.
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
