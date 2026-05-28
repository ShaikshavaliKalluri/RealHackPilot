---
name: run-screener
description: Re-run the rules screener after data edits so completeness % and flags reflect current state
---

# Run the screener

The screener recomputes `Team.completeness_score` and `Team.flags` for every team based on
the rules in `backend/app/screener.py`. Run it whenever you've changed team / member data
outside the UI (manual SQL, backfill scripts, etc.).

## On the server (prod)

```bash
ssh skalluri@rcapaywwaiw002
cd /opt/realhack-pilot/app/backend

/opt/realhack-pilot/app/backend/.venv/bin/python3.11 - <<'EOF'
from app.db import SessionLocal
from app import screener

db = SessionLocal()
result = screener.screen_all(db)
db.commit()
print(result)
db.close()
EOF
```

`result` will look like:
```python
{
    "teams_scanned": 95,
    "flags_set": 4,
    ...
}
```

## In Test Mode (sandbox)

Use `SandboxSessionLocal`:

```python
from app.db import SandboxSessionLocal
from app import screener
db = SandboxSessionLocal()
result = screener.screen_all(db)
db.commit()
print(result)
db.close()
```

## When to run it

- After importing an MS Forms Excel (the upload endpoint already runs it — you only need
  to re-run manually if you edit data outside the upload path)
- After backfilling addresses / locations / member data
- After fixing a bug in `screener.py` itself (so existing teams pick up the new rule)

## What the screener does

- Computes `completeness_score` as `% of populated critical fields`
- Sets flags: `low_quality:<field>`, `team_too_small`, `team_too_large`, `missing_mentor`,
  `team_name_is_member`, `bad_email:<reason>`, `bad_mentor_email:<reason>`,
  `missing_location:<name>`, `bad_location:<name>`, `missing_address:<name>`,
  `bad_tshirt:<name>`, `duplicate_participant:<name>`, `mentor_overloaded:<n>_teams`

See `screener.py` for the full rule set.
