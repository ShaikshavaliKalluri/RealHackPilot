# RealHack Pilot

Ops platform for **RealHack 2026** — registration command center, AI screening, email & Teams automation, and an AI Judge Assistant for panelists.

> Working name. Original draft was "RealHack Co-Pilot" — renamed to avoid Microsoft trademark.

## Status

Phase 1 in progress: **Registration Command Center + AI Screening (rules + LLM)**.

## Layout

```
.
├── pre_demo.html      # Pre-demo deck
├── backend/                  # FastAPI service
│   ├── app/
│   │   ├── main.py           # FastAPI app + routes
│   │   ├── db.py             # SQLite session
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── importer.py       # MS Forms Excel → DB
│   │   └── screener.py       # Rules-based screening (LLM hook ready)
│   ├── requirements.txt
│   └── .env.example
└── frontend/                 # React + Vite dashboard
    ├── src/
    ├── package.json
    └── vite.config.ts
```

## Run locally

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Dashboard: http://localhost:5173

## First demo path

1. Start backend and frontend.
2. Open the dashboard.
3. Click **Upload registrations** and select the MS Forms Excel export.
4. The dashboard renders one card per team with completeness, duplicate-participant flags, and mentor-load flags.
5. Filter by flag, location, or completeness.

## Roadmap

- **M1** Registration Command Center — *current*
- **M2** AI Screening & Validation — LLM layer on top of rules
- **M3** Email & Teams automation (Graph API)
- **M4** AI Judge Assistant — repo + slide ingestion, rubric-based pre-scoring
