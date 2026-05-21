# RealHack Pilot — Demo Guide for Organizers

A walkthrough of every workflow in the dashboard, ordered the way the
event lifecycle plays out: registration → screening → comms → channels →
judging → winners.

**Live URL:** `https://realhack.realpage.com/` (RealPage corp network or VPN required)
**Backend:** `rcapaywwaiw002` (Rocky Linux 8) · **Database:** `rcapaydbpgr001` (Postgres 14)
**Access:** restricted to members of the `AGAa-RealHack-Pilot-Users` security group.

---

## 0. Prerequisites (one-time)

Before any organizer can use the app:

- [ ] User's account is added to the `AGAa-RealHack-Pilot-Users` security group in Entra
- [ ] User has corporate VPN (GlobalProtect) installed if they want to access from mobile / off-site
- [ ] User can reach `https://realhack.realpage.com/` from a browser (corp WiFi or VPN)

---

## 1. Sign-in (SSO)

- [ ] Visit `https://realhack.realpage.com/`
- [ ] Landing page shows the RealHack logo + "Sign in with Microsoft" button
- [ ] Click the button → redirected to Microsoft sign-in
- [ ] Pick / sign in with `@realpage.com` account → MFA / passkey if prompted
- [ ] Lands on the dashboard with name + initials in top-right
- [ ] Click name → dropdown shows email, sign-out button

**What to point out:**
- Group-based access — anyone not in the AD group is rejected at Microsoft, never reaches our server
- "Need access?" footer on login page tells unauthorized users where to ask

---

## 2. Dashboard — Registration Command Center

This is the default landing tab.

### Upload registrations

- [ ] Click **Choose file** in the "Upload registrations" card
- [ ] Pick the MS Forms Excel export (`.xlsx`)
- [ ] Wait ~5 seconds — backend parses the file, creates Team + Member records, runs rule-based screening
- [ ] Stat cards populate: Teams / Mentors / Members / Complete / Incomplete / Flagged / Duplicate participants / Overloaded mentors
- [ ] Team cards appear below with completeness %, mentor, members, idea snippet, AI score (when run)

**What to point out:**
- Default behavior is **replace** — each upload wipes existing teams and re-imports. Excel is the source of truth.
- After re-upload, judge scores and comm log entries survive (we use SET NULL cascade on `comm_log.team_id` to preserve audit trail).

### Stat cards (clickable for drill-down)

- [ ] Click **Complete** → see all 80%+ scored teams
- [ ] Click **Incomplete** → see teams under 80% with "Missing: Idea / Tech stack / …" pills per team
- [ ] Click **Flagged** → see teams with any flag (duplicate member, mentor overloaded, bad email, team name = member name, etc.)
- [ ] Click **Duplicate participants** → list of people on multiple teams
- [ ] Click **Mentors** / **Members** → cross-team people index

### Filters + search

- [ ] Filter buttons: All / Flagged / Complete / Incomplete (different definitions from the stat cards — see below)
- [ ] Search: filter the team list by team name / mentor / idea text

**Semantic clarification:**
- **Complete card / filter:** completeness_score ≥ 0.8 (regardless of flags)
- **Incomplete card / filter:** completeness_score < 0.8
- **Flagged card:** has at least one flag (orthogonal — can overlap with either)

### Team cards

- [ ] Click any team card → expands inline with full submission details + AI screening reasons per axis
- [ ] AI screening output: 4-axis scores (genuineness, solution clarity, business value, novelty) + overall + headline

---

## 3. AI screening (LLM-powered)

- [ ] Click **Run AI Screen** → runs LLM evaluation on every team that doesn't have a score yet
- [ ] Click **Force rescore all** → re-runs even already-scored teams (in case rubric/prompt changed)
- [ ] Progress shown live: "AI screening: 23 / 91 teams scored…"
- [ ] Total runtime: ~5-10 minutes for 91 teams (one LLM call per team)
- [ ] Provider used: OpenAI (gpt-4o) by default; falls back to Anthropic if OpenAI is down

**What to point out:**
- Async background job — the API call returns in ~1 second, the work continues server-side
- Progress is durable in the DB; if you close the browser and reopen, the leaderboard reflects scored-so-far

---

## 4. Chatbot — "Ask the bot"

Floating green button bottom-right. Internal Q&A over the team dataset.

Try these:
- [ ] "Which 5 teams have the weakest ideas?"
- [ ] "Are there any teams with similar or overlapping ideas? Group them."
- [ ] "Draft a fix-it email for the 3 most incomplete teams."
- [ ] "Which teams are doing AI-related projects?"
- [ ] "Summarize common themes across business-value answers."

**What to point out:**
- Bot has every team's idea + tools + business value + AI scores in its context
- Replies mention teams by name; clickable team chips jump to that team's card
- Powered by the same LLM stack as AI screening (OpenAI/Anthropic with fallback)

---

## 5. Analytics tab

Reporting view (no editing).

- [ ] **Participation overview** tiles — total teams, members, mentors, complete %, AI screened %
- [ ] **Location heat map** — India / US / Philippines split with bars + percentages
- [ ] **Completeness distribution** — 5 buckets (0-20% / 20-40% / 40-60% / 60-80% / 80-100%)
- [ ] **AI score distribution** — overall histogram (★1 to ★5) + per-axis averages
- [ ] **Team size distribution** — 3 / 4 / 5 / 6 member teams
- [ ] **Flag type breakdown** — which flag kinds are most common
- [ ] **T-shirt sizes** — counts by size (for swag procurement)
- [ ] **Top 10 teams by AI score** — clickable, jumps to team card

---

## 6. Email & comms

### Compose email (dashboard)

- [ ] On the Dashboard tab, click **Compose email**
- [ ] **Step 1** — pick a template (Welcome, Fix-it, Mentor confirm, Final call, Channel ready, Individual participation)
- [ ] **Step 2** — recipients panel:
  - **Send to me only (test mode)** checkbox — emails go to your own address for previewing
  - **To override** — comma-separated emails to redirect all sends
  - **CC** + **BCC** — organizing committee, audit mailbox, etc.
  - Quick filter (All / Flagged / Incomplete / Complete) for the candidate pool
  - **Select all / Select none** plus search box
  - Default: nothing selected — opt-in to recipients
- [ ] **Step 3** — preview:
  - Per-team rendered subject + body (editable! — change either for that one team)
  - "Open in Outlook" or "Copy" buttons per team
  - "Open all in Outlook" / "Copy all" for the whole batch

**Limitation worth noting:**
- The dashboard composer opens Outlook via `mailto:` which is **plain-text only** (Windows limitation)
- For HTML-formatted emails matching the polished sample, use the CLI (next section)

### Real sends via CLI (`send_emails.py`)

For polished HTML-formatted bulk sends, run from a laptop with VPN:

```powershell
cd "C:\path\to\RealHackPilot\backend"
.\.venv\Scripts\python.exe send_emails.py --template welcome --dry-run            # preview all 91
.\.venv\Scripts\python.exe send_emails.py --template welcome                       # send for real
.\.venv\Scripts\python.exe send_emails.py --template welcome --only "Team A,Team B"  # subset
.\.venv\Scripts\python.exe send_emails.py --template welcome --cc-organizer        # CC yourself
```

**Auth:** browser sign-in once (OAuth code + localhost loopback). Token valid ~1 hour.
**Pacing:** 1.5s between sends — 91 teams takes ~75s.

**From address:** `RealHack@realpage.com` if Send-As is granted; otherwise the signed-in user's email.

---

## 7. Microsoft Teams channels

The CLI creates one private channel per registered team inside a parent Microsoft Team.

```powershell
.\.venv\Scripts\python.exe provision_team_channels.py --dry-run                       # preview
.\.venv\Scripts\python.exe provision_team_channels.py                                 # create for real
.\.venv\Scripts\python.exe provision_team_channels.py --only "Team A"                 # subset
```

- Channel name format: `2026 Team - {Team name}`
- Members added: mentor (as owner) + all team members
- Idempotent: teams that already have a `teams_channel_id` are skipped

After provisioning, the dashboard's team cards show "✓ Teams channel ready" badges.

---

## 8. Judge mode

For judges scoring teams during the event.

- [ ] Sign in (same SSO flow)
- [ ] Click **Judge mode** tab — dashboard auto-creates a Judge record from your SSO profile (no second sign-in)
- [ ] Pick **Round** (R1 / R2 / R3)
- [ ] Click a team card → 5-axis scorecard opens (Problem clarity / Solution viability / Industry readiness / ROI / Novelty, each 1-10)
- [ ] Drag sliders, add optional comment, click **Submit score**
- [ ] Team turns green on the grid ("✓ Scored")

### Reset / unscore

- [ ] Click an already-scored team → scorecard opens with existing values
- [ ] **Reset score** button (rose) at the bottom → confirms and deletes
- [ ] Team flips back to unscored, drops out of the leaderboard

### Round filtering

- **R1:** all 91 teams visible
- **R2:** only teams advanced past R1 (set by organizer in Scoring tab)
- **R3:** only teams advanced past R2

---

## 9. Scoring tab

Organizer view of the live leaderboard + tournament progression.

### Leaderboard

- [ ] Click **Scoring** tab → leaderboard for current round
- [ ] Each row: rank, team name, judge count, per-axis averages, total
- [ ] Click row to expand → all judges' comments

### Tournament advancement (R1 → R2 → R3 → Winners)

Above the leaderboard:

- [ ] **Round 1 → 2:** "Advance N teams to Round 2" panel with checkboxes (top 20 pre-selected)
- [ ] Click **Advance N teams to Round 2** — those teams' `advanced_to_round` jumps to 2
- [ ] Switch to **R2** → leaderboard now shows only the advanced teams once they're scored
- [ ] Same flow R2 → R3 (top 10 pre-selected)
- [ ] **Round 3:** instead of "Advance," the panel shows a gold **"Crown Winners…"** button
- [ ] Click it → modal with 1st / 2nd / 3rd dropdowns prefilled from top 3
- [ ] Adjust if needed, click **Save winners** → `final_position` set
- [ ] Dashboard tab now shows a gold/silver/bronze **Winners banner** at the top

### Undo

- [ ] Each advancement panel has an **Undo advancement** button that resets `advanced_to_round` back to the current round number for everyone

### Manual entry

- [ ] Switch from "Leaderboard" sub-tab to **"Manual entry"**
- [ ] For organizer-on-behalf-of-judge entries (e.g., judge dictated scores, couldn't sign in, etc.)
- [ ] Pick judge / team / round → enter scores → save

---

## 10. Comms tab

For Microsoft Teams broadcasts + per-team messages.

- [ ] **Channel provisioning** panel — alternative to CLI, lets you create channels from the dashboard (mock mode today)
- [ ] **Broadcast** panel — send a message to all 91 Teams channels at once (e.g., "Round 2 starts in 10 minutes")

---

## 11. Export

- [ ] **Export CSV** button (top-right header) → downloads `realhack-teams-YYYY-MM-DD.csv` with every team + scores + flags
- [ ] Use for offline review, sharing with leadership, archival

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| LoginPage instead of dashboard | Your account isn't in the AD group, or your session expired |
| "Signature has expired" 401 | Sign out + sign back in (token refresh failed) |
| Compose email opens Outlook but text is plain | mailto: limitation — use the CLI for HTML formatting |
| Team list empty after re-upload | Check the Excel column headers — must match the MS Forms export schema |
| AI screen returns 504 | Should not happen post-fix; if it does, restart the backend service |
| Teams channel creation 403 | Check that you're a member of the parent Microsoft Team |

---

## What's not yet in the dashboard (June 2026)

- **Mobile-friendly UI** — works on phones but cramped; designed for desktop
- **Real Graph operations from the dashboard UI** — currently in mock mode (`GRAPH_MODE=mock`); real sends go through the CLI
- **Public access for judges without VPN** — pending IT decision on exposing the judge-scoring endpoint externally
- **HTML email templates with embedded logo** — coming soon (CID-attached inline image via Graph)

---

## Day-of-event runbook (recommended order)

1. **Week before:** upload latest Excel, run AI screen, draft welcome email
2. **3 days before:** run `provision_team_channels.py` for all teams
3. **2 days before:** send Welcome email (via CLI) + Mentor-confirm email
4. **1 day before:** send any Fix-it follow-ups to incomplete submissions
5. **Day of, morning:** broadcast "Welcome to RealHack 2026!" to all Teams channels
6. **After Round 1:** review leaderboard, click "Advance N teams to Round 2"
7. **After Round 2:** review, click "Advance N teams to Round 3 (Final)"
8. **After Round 3:** click "Crown Winners…", pick 1st/2nd/3rd, save → Winners banner lights up
9. **Post-event:** Export CSV, archive, retrospective
