# RealHack Pilot

> Loaded automatically by Claude Code when you open a session in this repo.
> Read it as "things to know before changing anything."

## What this is

Internal ops platform for **RealHack 2026** (RealPage's internal hackathon, June 18-19, 2026).
**In production** at <https://realhack.realpage.com>. Used daily by 5 organizers + 23 judges.

Handles the full lifecycle: registration import (MS Forms Excel) → AI screening → panel
judging → branded email comms → real Microsoft Teams channel creation → swag distribution
→ analytics & exports.

Repo: <https://github.com/ShaikshavaliKalluri/RealHackPilot>

## Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | React 18 + Vite + TypeScript + Tailwind | Built to `frontend/dist`, served by nginx |
| Backend | FastAPI + SQLAlchemy + Postgres | `backend/app/`, run as systemd unit `realhack-pilot` |
| Auth | MSAL.js + Azure AD | Entra app `4c55dc04-7f4b-4765-8ae5-bc69f52ab98e` |
| Email | Graph `/sendMail` as `RealHack@realpage.com` | Shaik has Send-As granted; real send is wired |
| Teams channels | Graph `/teams/{id}/channels` POST | Per-team button on Dashboard. Naming: `"2026 {team_name}"` |
| AI | OpenAI gpt-4o / gpt-4o-mini | Screening + chatbot. Anthropic fallback in `llm.py` |
| DB | Postgres on `rcapaydbpgr001:5432` | `realhack_pilot` (prod) + `realhack_pilot_sandbox` (Test Mode) |
| Deploy target | Rocky Linux VM `rcapaywwaiw002` | Public access via Akamai → `realhack.realpage.com` |

## Status: LIVE PRODUCTION

This serves real organizers TODAY. Every change should:
1. Be tested in **Test Mode** (the sandbox DB) first — see `.claude/skills/test-mode.md`
2. Be type-checked: `cd frontend && npx tsc -b`
3. Ship via the standard deploy script — see `.claude/skills/deploy.md`

## Local development

```powershell
# Backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
# Docs: http://localhost:8000/docs

# Frontend
cd frontend
npm run dev      # http://localhost:5173

# Type-check before commit
cd frontend; npx tsc -b
```

## Deploy

```bash
ssh skalluri@rcapaywwaiw002
sudo rm -rf /opt/realhack-pilot/app/frontend/dist
sudo bash /opt/realhack-pilot/app/deploy/update.sh
```

Pulls latest from GitHub → installs deps → rebuilds frontend → restarts systemd unit + nginx.

## Key conventions

### Tournament — two rounds, not three
The hackathon runs **2 rounds**. Round 2 IS the finals — `OrganizerScoring` crowns
finalists directly from the R2 leaderboard. `[1, 2]` everywhere, not `[1, 2, 3]`.

### Finalists are flexible
The Crown Finalists modal lets organizers pick top 3 / 5 / 7 / 10 — not locked to a podium.
`Team.final_position` holds any rank (1..N).

### Panel-based judging
Round assignments use **Panels** (`panels`, `panel_teams`, `panel_judges` tables) — a panel
groups N teams with M judges. Each judge in a panel scores every team in the panel.
The legacy `judge_assignments` table is kept for backwards compat but unused.

### Test Mode (sandbox DB)
Super-admin only (gated to `shaikshavali.kalluri@realpage.com`). Toggling sends
`x-sandbox: true` on every request; `get_db` routes the session to
`realhack_pilot_sandbox`. Use this for ANY destructive flow (advancing teams, crowning,
bulk emails, channel creation, manual data edits). Refresh from prod on demand via the
in-app button.

### Protected accounts
Three emails can never be deleted or downgraded from organizer (enforced client + server):
- `shaikshavali.kalluri@realpage.com` (super-admin only — also the only one with Test Mode + Preview-as-judge)
- `bhaskar.jaddu@realpage.com`
- `suneel.nallu@realpage.com`

### Editions
`HACK_YEAR='2026'` lives in `frontend/src/components/Analytics.tsx`. Bump for 2027 — all
exports + section titles update automatically.

### Re-uploads TRUNCATE — preserve manual additions
Uploading a fresh MS Forms Excel wipes `teams + members`. Before re-uploading, hit
**Download current Excel** in the Dashboard to grab a MS-Forms-compatible snapshot that
includes manually-added teams. Edit then re-upload — no data loss.

### Migrations live in `lightweight_migrate`
Adding a column? Update `models.py` AND add an `ALTER TABLE` to
`backend/app/db.py::lightweight_migrate`. Startup runs it against **both** prod and
sandbox engines, so a missed migration = 500 in Test Mode only.

### Email templates use `str.replace`, not `str.format`
The HTML email shell has inline CSS with `{margin:0;...}` which trips `str.format`.
`emails.py::render::fill` does per-token `str.replace` for that reason. Don't change it back.

## Repo layout

```
backend/
├── app/
│   ├── main.py            # FastAPI routes + startup
│   ├── config.py          # pydantic-settings, env-driven (.env file)
│   ├── db.py              # engines, sessions, lightweight_migrate (BOTH prod + sandbox)
│   ├── auth.py            # MSAL ID-token validation
│   ├── models.py          # ORM — Team, Member, Judge, Panel, JudgeScore, SwagPickup, ...
│   ├── schemas.py         # Pydantic request/response shapes
│   ├── importer.py        # MS Forms .xlsx → Team/Member rows
│   ├── screener.py        # completeness % + flags
│   ├── ai_screen.py       # OpenAI scoring (bg thread)
│   ├── emails.py          # branded HTML email templates
│   ├── comms.py           # real Teams channel creation via Graph
│   └── judging.py         # panels + scoring
├── provision_team_channels.py   # CLI fallback for bulk channel creation
├── send_emails.py               # CLI fallback for bulk email
├── verify_graph_auth.py         # quick Graph auth sanity-check
└── requirements.txt

frontend/
├── src/
│   ├── App.tsx            # role router (organizer / judge / super-admin / unregistered)
│   ├── auth.ts            # MSAL config + token helpers
│   ├── api.ts             # authFetch + 60+ typed API helpers
│   ├── graphSend.ts       # direct Graph email send from browser
│   └── components/
│       ├── TeamCard.tsx         # team card with Create Channel + Send mail + Edit
│       ├── JudgeDashboard.tsx   # mobile-first judge view (replaces old JudgeMode)
│       ├── JudgesPanel.tsx      # panels CRUD, distribute, move teams/judges, print sheet
│       ├── SwagPanel.tsx        # event-day swag pickup tracker
│       ├── EmailComposer.tsx    # bulk welcome/channel-ready via Graph /sendMail
│       ├── Analytics.tsx        # all charts + CSV exports (includes round-results)
│       ├── CreateTeamModal.tsx  # manually add a team
│       ├── LoginQRPage.tsx      # printable login QR for judging room
│       └── ...

deploy/
├── realhack-pilot.nginx.conf
├── realhack-pilot.service
└── update.sh
```

## Skills available in this repo

Under `.claude/skills/` — invoke from Claude Code with `/skill <name>`:

- **deploy** — push, deploy, verify
- **test-mode** — work safely in the sandbox DB
- **run-screener** — re-run completeness + flags after data changes
- **add-endpoint** — add a new FastAPI endpoint following project conventions

## Common pitfalls

- **Forgetting to clear `dist/` before rebuilding** → frontend changes don't ship.
  `sudo rm -rf /opt/realhack-pilot/app/frontend/dist && sudo bash .../update.sh`.
- **Browser cache holding the old JS bundle** → use incognito or Ctrl+Shift+R.
- **Adding a column without `lightweight_migrate`** → sandbox 500s. Always add the ALTER.
- **Hook order in `App.tsx`** → all React hooks MUST run before the auth-gate early returns,
  otherwise React #310 ("rendered more hooks than during previous render").
- **Sending the access token to the backend** → backend validates `aud=client_id` so only
  the ID token works. `authFetch` already uses the right one.
- **`f"...{var}..."` inside HTML email content** → safe because we use `str.replace`,
  not `str.format`. If you ever switch back to `.format()`, you'll need to `{{` escape
  every CSS brace.

## Domain context

- **Currently in the system:** 95 teams, ~510 unique people, 28 judges/organizers, 0 panels yet (to be created).
- **Mentor for Team "Deep Thinkers" (now "RealVibes"):** Shaikshavali Kalluri.
- **Sister project:** [RealVibes](https://github.com/ShaikshavaliKalluri/RealVibes) — the 2026 RealHack submission by Team RealVibes. Multi-event umbrella platform that RealHack Pilot will eventually be absorbed into.
