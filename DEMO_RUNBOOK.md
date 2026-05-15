# RealHack Pilot — Demo Runbook

> Audience: organizing team. ~10–15 minutes.
> Goal: Walk through M1 → M2 → M3 → M4 with the 2024 dataset as the live demo data.

---

## 0 — Pre-demo checklist (run 5 min before the call)

```powershell
# Terminal 1 — Backend
cd C:\Users\skalluri\realhack-2026-copilot\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
# Wait for: "Application startup complete."

# Terminal 2 — Frontend
cd C:\Users\skalluri\realhack-2026-copilot\frontend
npm run dev
# Wait for: "Local:  http://localhost:5173/"
```

Then in a browser:

1. Go to **http://127.0.0.1:8000/api/llm/health** — confirm OpenAI shows `"working": true`.
2. Go to **http://localhost:5173** — confirm the dashboard loads.
3. If the DB already has teams from earlier testing → ✅ ready.
   If not, upload `C:\Users\skalluri\Downloads\SHORTHACK 2024 - As of June 1st2024 1.xlsx` to repopulate.

**Backup if OpenAI hits a limit:** Change `LLM_PROVIDER=openai` to `LLM_PROVIDER=anthropic` in `backend\.env`, restart the backend. Claude takes over automatically.

---

## 1 — Open with the deck (2 min)

Open `pre_demo.html` in browser (full screen). Walk slides 1–4 quickly:
- **Slide 1:** What is RealHack Pilot.
- **Slide 2:** Scale (100–150 teams, 500–900 participants).
- **Slide 3:** Pain points from the organizing team.
- **Slide 4:** Four modules.

Then skip to **Slide 14** to set up the live walkthrough: *"Let me show you the working build."*

---

## 2 — M1: Registration Command Center (3 min)

Open **http://localhost:5173**.

**Talking points while clicking:**
- *"One screen — every team, mentor, member."*
- 7 stat cards at the top: Teams, Mentors (unique), Members (unique), Complete, Flagged, Duplicate participants, Overloaded mentors. Click any one to drill down.
- Click **Mentors** → see the unique mentor list with their teams. Search to find one.
- Click **Members** → same for unique participants (deduplicated — the Duplicate participants stat handles those).
- Click **Export CSV** → show that it exports the same shape they use today (Excel-compatible).
- Click any team card → show inline expansion (members, mentor, full idea, all flags).
- Click the **Duplicate participants** stat → show the drill-down. Click any team chip → it auto-scrolls and expands.
- Click the **Overloaded mentors** stat → mentors with >2 teams.
- Click **Flagged** → every team with the flag types as chips.

Money line: *"Today this takes hours in Excel. Here it's one click per question."*

---

## 3 — M2: AI Screening (2 min)

Still on the dashboard.

- Click **Run AI Screen**. *"Each team gets four scores from GPT-4o-mini in real time: genuineness, solution clarity, business value, novelty. Plus a one-line reason each."*
- Wait ~60–90 seconds for 58 teams. Show the toolbar updating: *"AI-screened 58 teams via openai×58"*.
- Click a high-score team and a low-score team → show how the scores + reasoning differ.
- Point at the inline AI badge on each card next to the completeness %.

Money line: *"Panelists no longer screen submissions one by one — AI does the first pass with cited reasons."*

---

## 4 — M3: Email Composer (2 min)

- Click **Compose email**. Drawer opens.
- Pick template **Fix-it — incomplete submission**.
- It auto-filters to incomplete teams. *"Targeted, not blasted."*
- Show the recipient list with checkboxes. Click **Render 21 emails** (or whatever the count is).
- Expand any preview → show the mail-merge filled in: team name, mentor name, first names, the actual missing fields listed.
- Click **Open in Outlook** on one → it opens the user's mail client with everything pre-filled.

Money line: *"21 personalized fix-it mails ready to send, in 30 seconds — instead of 21 manually written messages."*

Caveat to say out loud: *"For the production version, we'd send these directly via Microsoft Graph API once IT approves the app registration. For today this opens in Outlook, which is the safer demo mode."*

Close the drawer.

---

## 5 — M4: Live Panel Scoring (4 min — the marquee moment)

This is the live judging workflow: multi-judge, three rounds (progressive shortlist), score-once-per-team-per-round, with organizer manual-entry fallback.

> **Important framing for the org:** judges DO NOT see AI scores. Only organizers see AI screening (M2). This avoids anchoring bias on the panel.

### 5a — Judge view (from the panelist's perspective)

Click **Judge mode** in the top-right header.

- You'll see a "Sign in with Microsoft" screen. *"This is mocked for the demo — real Azure AD SSO is the IT-gated piece on the asks slide. Production swap is a one-day task."*
- Enter your name and email → click **Sign in**.
- Top bar shows: signed-in judge, round selector (R1 / R2 / R3), progress counter (X / 48).
- Pick a team card → opens the scorecard.
- Show the rubric: **5 criteria × /10 each** — Problem clarity, Solution viability, Industry readiness, ROI/Business value, Novelty.
- Walk the sliders. Total updates live (out of 50).
- Add a comment.
- Click **Submit score** → the team gets the green "✓ Scored" badge in the list.
- Try clicking the same team again → it opens in "Editing existing score" mode (one record per judge per team per round, but you CAN update if you change your mind).
- Switch rounds (R1 → R2) → progress resets to 0/48 for that round, same teams reappear ready to score.

Money line: *"Each judge sees only the submission and the rubric. The AI's view is for organizers, never for the panel."*

### 5b — Organizer view: Leaderboard + Manual entry

Click **Scoring** in the header.

**Leaderboard tab** (default):
- Round selector at the top. Click R1 → see real-time aggregated standings.
- Each row: rank, team name, judge count, per-axis averages, total sum.
- Click any row to expand → see every judge's comment (audit trail).
- Footer shows how many teams are still un-scored for this round.

Money line: *"Round 1 closes — instantly shortlist by total. Round 2 panel scores only those teams. By round 3 you're focused on the top 10."*

**Manual entry tab**:
- *"What if a judge can't enter scores from their phone, or they handed in a printed sheet?"*
- Pick a judge from the dropdown (or click + Add to register a new one inline).
- Pick a team.
- Fill the same scorecard.
- The entry is logged as **organizer-entered** for audit — the leaderboard still credits the judge.

Money line: *"Three escape hatches: judges enter live, judges enter later, or organizers enter on their behalf. No score gets lost."*

---

## 6 — Close & next steps (1 min)

Back to the deck → **Slide 12 (Asks)**:
- Latest MS Forms export when registration closes May 19.
- Sponsor an Azure AD app registration → unlocks real mail send + Teams channel creation.
- One panelist as design partner for the Judge UI before June 18.

Wrap line: *"Phase 1 is shippable today. By event week we have full mail automation. AI Judge live during demos."*

---

## If something breaks during the demo

| Symptom | Fast recovery |
|---|---|
| Dashboard shows "Loading…" forever | Backend died. Restart `uvicorn` in terminal 1. |
| AI Screen / AI Judge spins, then errors | OpenAI rate limit. In `.env` change `LLM_PROVIDER=anthropic`, restart backend. Claude takes over. |
| Email composer shows "no email on file" | Expected for the 2024 sample (form didn't capture member emails that year). The 2026 form does capture them — explain & move on. |
| `npm run dev` complains port in use | Vite picks the next free port automatically — read the actual URL it prints. |
| Browser caching stale UI | Hard refresh: **Ctrl+Shift+R**. |

---

## What to be honest about if asked

- **Auth**: mock "Sign in with Microsoft" for the judge login is a captured form, not real Azure AD. Production = MSAL once IT issues an app registration. Same long-pole already on the asks slide.
- **AI vs judges**: AI scores (M2) are organizer-only on purpose — judges should not be anchored. The panel rubric (M4) is human-only scoring.
- **Mail send**: today uses `mailto:` (Outlook). Real Graph API send is on the dependency list.
- **Teams channel creation**: same — Graph dependency. Demoed conceptually only.
- **Round transitions**: progressive shortlist (R1 all teams → R2 ~25 → R3 top 10) is enforced organizationally, not by the tool yet. Tool just stores scores per round; organizer decides who's invited back.
- **2024 data quirks**: that year's form didn't capture member emails or Approach properly. 2026 form already fixes both — verified.
- **Storage**: SQLite for dev. Postgres for prod (one-line config change).
- **Trademark**: name is *RealHack Pilot* (not Co-Pilot — avoids MS trademark). Final name TBD.

---

## File map (in case you need to point at code)

- Backend logic: `backend/app/`
  - `main.py` — FastAPI routes
  - `importer.py` — header-aware Excel parser
  - `screener.py` — rules-based flags
  - `ai_screener.py` — LLM screening (M2, organizer-only)
  - `emails.py` — templates + mail-merge (M3)
  - `judging.py` — multi-judge live panel scoring (new M4)
  - `judge.py` — older AI-rubric pre-scoring (organizer-only, optional)
  - `github.py` — repo fetcher (used by older AI judge only)
  - `llm.py` — multi-provider dispatcher (OpenAI → Anthropic → mock)
- Frontend: `frontend/src/`
  - `App.tsx` — main shell + mode toggle (Dashboard / Judge / Scoring)
  - `components/`
    - `TeamCard.tsx` — dashboard team card (organizer view, AI screens shown)
    - `EmailComposer.tsx` — M3 composer drawer
    - `DrillDownPanel.tsx` — stat-card drill-downs (mentors, members, dupes, etc.)
    - `JudgeMode.tsx` — judge login + team list + scorecard (M4 judge view, NO AI signals)
    - `OrganizerScoring.tsx` — leaderboard + manual entry (M4 organizer view)

---

Good luck. Lead with the screen, not the slides — the demo is the pitch.
