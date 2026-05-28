---
name: test-mode
description: Work safely in the sandbox DB — every action stays out of prod
---

# Test Mode (sandbox database)

Use this skill BEFORE doing anything destructive to production: bulk emails,
advancing teams, crowning finalists, channel creation experiments, data edits.

## Who can use it

Only the super-admin (`shaikshavali.kalluri@realpage.com`). The toggle is hidden
for everyone else.

## How to enable

1. Open <https://realhack.realpage.com>
2. Click your avatar (top right)
3. Scroll to **🧪 Test Mode** in the dropdown → flip the switch
4. Page reloads. You'll see an amber **TEST MODE** banner at the top.

## What it does

- Every API call from your browser sends `x-sandbox: true`
- Backend's `get_db` dependency routes that session to `realhack_pilot_sandbox`
  instead of `realhack_pilot`
- Production data is never read or written from a Test-Mode session
- Real Microsoft Graph calls (Teams channels, email send) short-circuit to mock
  in sandbox so you don't accidentally create real channels / send real mail

## First time setup — refresh sandbox from prod

Sandbox starts empty. To populate it:
1. With Test Mode ON, click your avatar again
2. Under the Test Mode section, click **Refresh from prod**
3. Confirm — backend wipes sandbox + copies every row from prod (teams,
   members, judges, panels, scores, comm_log) preserving PKs
4. Wait for the success message — should report row counts per table

Re-run this anytime you want a fresh snapshot.

## When you're done

Click the avatar → toggle Test Mode OFF (or click the "Exit Test Mode" button
in the banner). Page reloads. You're back on prod.

## Useful Python on the server when debugging

```bash
ssh skalluri@rcapaywwaiw002
cd /opt/realhack-pilot/app/backend

# Connect to the sandbox DB directly
/opt/realhack-pilot/app/backend/.venv/bin/python3.11 - <<'EOF'
from app.db import SandboxSessionLocal, sandbox_engine
from app.models import Team, Judge, Panel
db = SandboxSessionLocal()
print(f"Teams: {db.query(Team).count()}")
print(f"Judges: {db.query(Judge).count()}")
print(f"Panels: {db.query(Panel).count()}")
db.close()
EOF
```

## Common gotcha — sandbox missing columns

If you've just added a column to a model, the sandbox DB might not have it
(`Base.metadata.create_all` doesn't ALTER existing tables). The fix: add the
ALTER to `backend/app/db.py::lightweight_migrate`. Restart the backend — startup
runs the migration against both prod AND sandbox engines.
