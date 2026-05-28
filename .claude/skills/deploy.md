---
name: deploy
description: Push to GitHub then deploy to realhack.realpage.com (rebuilds frontend, restarts backend)
---

# Deploy RealHack Pilot

Use this skill whenever you've made code changes that need to go live.

## Pre-flight

1. **Type-check the frontend** if you touched any `.tsx` / `.ts` file:
   ```powershell
   cd "C:\Sha\projects\RealHack Copilot\RealHackPilot\frontend"
   npx tsc -b
   ```
   Fail-fast: don't push if this errors.

2. **Test in Test Mode** if the change touches data/destructive flows.
   See `.claude/skills/test-mode.md`.

## Commit + push

```powershell
cd "C:\Sha\projects\RealHack Copilot\RealHackPilot"
git status                # confirm what's staged
git add <files>           # stage explicitly — never `git add -A` (risk of leaking .env)
git commit -m "$(cat <<'EOF'
Short summary line

Multi-line body explaining the WHY (not the what — the diff shows that).
Reference the issue/conversation that prompted this change.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

## Deploy on the server

```bash
ssh skalluri@rcapaywwaiw002

# Clear dist if frontend changed (otherwise rebuild may be skipped or
# fail with permission errors from earlier sudo rebuild)
sudo rm -rf /opt/realhack-pilot/app/frontend/dist

# Pull + install deps + build + restart
sudo bash /opt/realhack-pilot/app/deploy/update.sh

# Verify the new commit is checked out
cd /opt/realhack-pilot/app && git log --oneline -3
```

## Verify

1. Hard refresh in the browser: **Ctrl+Shift+R** (cached bundles are the #1 reason "the
   fix didn't ship").
2. Or open in **Incognito** to bypass cache entirely.
3. Confirm the change is visible.

## If something breaks

```bash
# Check backend logs
sudo journalctl -u realhack-pilot -n 50 --no-pager

# Roll back to previous commit
cd /opt/realhack-pilot/app
git log --oneline -5     # find the commit before the bad one
git reset --hard <good-sha>
sudo rm -rf /opt/realhack-pilot/app/frontend/dist
sudo bash /opt/realhack-pilot/app/deploy/update.sh
```
