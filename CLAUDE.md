# RealHack Pilot

## What This Repo Is

Internal ops platform for **RealHack 2026** (RealPage's internal hackathon, June 18–19, 2026). FastAPI + SQLAlchemy backend with a React 18 + TypeScript + Vite frontend, backed by PostgreSQL. Handles team registration ingest from MS Forms, AI screening, judge scoring, tournament progression, Teams channel provisioning, and bulk email via Microsoft Graph.

Repo: github.com/ShaikshavaliKalluri/RealHackPilot (public).

## Commands

```powershell
# --- Backend (FastAPI) ---
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
# API docs: http://localhost:8000/docs

# --- Frontend (Vite) ---
cd frontend
npm run dev   # http://localhost:5173

# --- Deploy to prod (rcapaywwaiw002) ---
ssh rcapaywwaiw002
sudo bash /opt/realhack-pilot/app/deploy/update.sh

# --- Bulk email (Graph /sendMail, OAuth code flow) ---
cd backend
python send_emails.py --template confirm_registration --dry-run
python send_emails.py --template confirm_registration --cc-organizer

# --- Channel provisioning (per-team Teams channels) ---
python provision_team_channels.py --dry-run

# --- One-off: verify Graph auth works for current user ---
python verify_graph_auth.py
```

## Structure

- `backend/app/main.py` — FastAPI app, all `/api/*` routes, JWT middleware
- `backend/app/auth.py` — PyJWT validator (Entra JWKS, validates `aud=client_id`)
- `backend/app/models.py` — SQLAlchemy models. `Team.advanced_to_round` (1→4) drives tournament progression; `Team.final_position` (1/2/3) drives podium
- `backend/app/db.py` — Session + `lightweight_migrate()` (idempotent column/FK adds on startup)
- `backend/app/screener.py` — Rules-based screening flags (duplicates, bad emails, team-name-is-member, etc.)
- `backend/app/ai_screener.py` — LLM scoring (OpenAI primary, Anthropic fallback); runs in background thread
- `backend/app/emails.py` — Template renderer; every template has both plaintext + `body_html`
- `backend/app/chat.py` — Organizer Q&A bot (passes JSON team context to LLM)
- `backend/app/comms.py` — Graph wrapper for `/users/<shared>/sendMail` (Send-As) → `/me/sendMail` fallback
- `backend/send_emails.py`, `provision_team_channels.py` — CLI tools using OAuth code flow with localhost loopback (RFC 8252)
- `frontend/src/App.tsx` — Auth gate (`useIsAuthenticated`), mode router (`dashboard | judge | scoring | comms | analytics`)
- `frontend/src/auth.ts` — MSAL config; `getAccessToken()` returns the **ID token**, not the access token
- `frontend/src/api.ts` — `authFetch()` wrapper that auto-retries on 401 with `forceRefresh`
- `deploy/update.sh` — Pull, install deps, build frontend, restart systemd unit
- `docs/DEMO_GUIDE.md` — Organizer walkthrough (share with Aarthi/Sandeep)

## Code Conventions

- **Frontend auth**: always send the ID token in `Authorization: Bearer ...`. The backend validates `aud == AZURE_CLIENT_ID`, so access tokens (which have Graph as audience) will 401.
- **Token refresh**: `acquireTokenSilent` does NOT always refresh ID tokens. Use `ssoSilent` (hidden iframe) when forcing refresh. `authFetch` already does this on 401.
- **All `/api/*` routes require auth**. Exempt list lives in `main.py` middleware (`/api/health`, `/docs`, `/openapi.json`).
- **Hook order**: ALL React hooks must run before the auth-gate early-returns in `App.tsx` — moving them after causes React #310 ("rendered more hooks than during previous render").
- **DB migrations**: prefer adding to `lightweight_migrate()` in `db.py` over standalone migration scripts. It runs on every app start, uses `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`, and is idempotent. Postgres-specific DDL is fenced behind a dialect check.
- **FK strategy**: `members.team_id` and `judge_score_records.{team_id,judge_id}` use `ON DELETE CASCADE` so re-uploading the MS Forms export is safe. `comm_log.team_id` uses `ON DELETE SET NULL` to preserve the audit trail.
- **LLM calls**: always go through `llm.py` (handles OpenAI → Anthropic fallback). `gpt-4o` for screening, `gpt-4o-mini` for the chatbot.
- **Long-running endpoints** (AI screening, channel provisioning) must run in a background thread + expose a `/status` polling endpoint. Sync endpoints time out at the nginx layer (~60s).
- **Email body**: always set both `body` (plaintext) and `body_html` in templates. `send_emails.py` prefers HTML when available. `_html_wrap()` in `emails.py` wraps content with the branded header/footer (#0078d4 blue).
- **Never commit `.env`**. `AZURE_CLIENT_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` live there.

## Domain Context

- **Rounds**: R1 (quick test) → R2 (presentation) → R3 (finals) → Winners. Teams advance via `Team.advanced_to_round` (default 1; bumps to 2/3/4). JudgeMode filters teams with `advanced_to_round >= currentRound`. Only the top 20 of R1 advance to R2 (default), top 10 of R2 to R3, top 3 of R3 to Winners.
- **Winners**: `Team.final_position` 1/2/3 (gold/silver/bronze) drives the `WinnersBanner` on the Dashboard.
- **Send-As mailbox**: `RealHack@realpage.com` is a shared mailbox. When `GRAPH_MAIL_FROM` is set in `.env`, sends use `/users/<shared>/sendMail` (requires Send-As permission granted to the signed-in user). When blank, falls back to `/me/sendMail` (sends from the signed-in user personally). Send-As permission was 403 as of 2026-05-21 — workaround is keep `GRAPH_MAIL_FROM` blank.
- **Auth gate**: Entra app reg `4c55dc04-7f4b-4765-8ae5-bc69f52ab98e` has Assignment Required = Yes, and only the `AGAa-RealHack-Pilot-Users` security group is assigned. The group membership check is enforced at sign-in by Entra, not by our backend.
- **Postgres**: lives on `rcapaydbpgr001:5432`, separate VM from the app server `rcapaywwaiw002`. App connects as the `postgres` user (trust auth from the app server). No password in `.env` for that reason.
- **MS Forms ingest**: every re-upload of the Excel export does an upsert keyed by `(team_name, lead_email)`. Cascade FKs let us safely re-import without orphaned member/score rows.
- **AI screening flags**: `team_name_is_member` (compact-whitespace comparison), `bad_email` / `bad_mentor_email` (only malformed or non-realpage-domain — `no_first_last_separator` was dropped after PPendekanti@RealPage.com false-positive).
