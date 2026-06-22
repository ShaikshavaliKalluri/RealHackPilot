import { useEffect, useMemo, useState } from 'react';
import { fetchPanels, fetchTeams, fetchJudges, type Panel } from '../api';
import type { Team, Judge } from '../types';

/**
 * Printable paper-fallback scorecards for judges. One sheet per panel
 * showing every team's row with blank score boxes for Solution Design,
 * MVP, Presentation -- so if the app is down on judging day, organizers
 * can hand judges paper to score and key the numbers in later.
 *
 * Lives at /scorecards?round=1 (or round=2). Renders the full document;
 * organizers Ctrl+P / Cmd+P to print or save as PDF.
 *
 * Layout per panel:
 *   - Title: "Panel N — Round X"
 *   - Header strip: judge name (blank field), date, page #
 *   - Rubric reference (small text describing each axis)
 *   - Team table: # | Team Name | Design /10 | MVP /10 | Demo /10 | Total /30 | Comment
 *   - page-break-after between panels so each panel prints on its own page
 */

interface Props {
  round?: number;
}

function getRoundFromUrl(): number {
  if (typeof window === 'undefined') return 1;
  const r = new URLSearchParams(window.location.search).get('round');
  const n = r ? parseInt(r, 10) : 1;
  return n >= 1 && n <= 2 ? n : 1;
}

function getBlankFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get('blank');
  return v === 'true' || v === '1';
}

function getBlankCountFromUrl(): number {
  if (typeof window === 'undefined') return 24;
  const v = new URLSearchParams(window.location.search).get('rows');
  const n = v ? parseInt(v, 10) : 24;
  return n > 0 && n <= 100 ? n : 24;
}

export function PrintableScorecards({ round: roundProp }: Props = {}) {
  const round = roundProp ?? getRoundFromUrl();
  const blankMode = getBlankFromUrl();
  const blankRowCount = getBlankCountFromUrl();
  const [panels, setPanels] = useState<Panel[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPanels(round), fetchTeams(), fetchJudges()])
      .then(([p, t, j]) => {
        setPanels(p);
        setTeams(t);
        setJudges(j);
      })
      .catch((e: any) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [round]);

  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const judgesById = useMemo(() => new Map(judges.map((j) => [j.id, j])), [judges]);

  if (loading && !blankMode) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading panels…</div>;
  }
  if (error && !blankMode) {
    return <div className="min-h-screen flex items-center justify-center text-rose-500 p-8 text-center">{error}</div>;
  }
  if (!blankMode && panels.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 p-8 text-center">
        No panels found for Round {round}. Create panels on the People tab first.
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen text-slate-900 scorecards-root">
      {/* Print styles */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 12mm 12mm 12mm;
          }
          .no-print { display: none !important; }
          .panel-sheet { page-break-after: always; }
          .panel-sheet:last-child { page-break-after: auto; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .scorecards-root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .score-box {
          display: inline-block;
          width: 28px;
          height: 28px;
          border: 1.5px solid #94a3b8;
          border-radius: 4px;
          vertical-align: middle;
        }
        .comment-line {
          border-bottom: 1px solid #cbd5e1;
          height: 14px;
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print border-b border-slate-200 px-6 py-3 sticky top-0 bg-white z-10 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-bold text-slate-900">
            Paper-fallback scorecards · {blankMode ? 'Blank' : `Round ${round}`}
            {!blankMode && ` · ${panels.length} panel${panels.length === 1 ? '' : 's'}`}
          </h1>
          <p className="text-xs text-slate-500">
            Ctrl/Cmd + P to print or save as PDF · each panel on its own page · pass to judges as a fallback if the app is down
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Blank / Pre-filled toggle */}
          <div className="flex items-center bg-slate-100 rounded-md border border-slate-300 overflow-hidden">
            <a
              href={`/scorecards?round=${round}`}
              className={`text-xs px-3 py-1.5 font-semibold transition ${
                !blankMode ? 'bg-[#0a4f99] text-white' : 'text-slate-700 hover:bg-slate-200'
              }`}
              title="Pre-fill panel + team names from the system"
            >
              Pre-filled
            </a>
            <a
              href={`/scorecards?blank=true&rows=${blankRowCount}`}
              className={`text-xs px-3 py-1.5 font-semibold transition ${
                blankMode ? 'bg-[#0a4f99] text-white' : 'text-slate-700 hover:bg-slate-200'
              }`}
              title="Print with blank fields for organizer to fill in manually"
            >
              Blank
            </a>
          </div>
          {/* Round picker -- only meaningful in pre-filled mode */}
          {!blankMode && (
            <>
              {[1, 2].map((r) => (
                <a
                  key={r}
                  href={`/scorecards?round=${r}`}
                  className={`text-xs px-3 py-1.5 rounded font-semibold border transition ${
                    r === round
                      ? 'bg-[#0a4f99] text-white border-[#0a4f99]'
                      : 'bg-white text-[#0a4f99] border-[#0a4f99] hover:bg-[#0a4f99]/10'
                  }`}
                >
                  Round {r}
                </a>
              ))}
            </>
          )}
          {/* Row count picker -- only in blank mode */}
          {blankMode && (
            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              <span className="text-slate-500">Rows:</span>
              {[12, 24, 36, 48].map((n) => (
                <a
                  key={n}
                  href={`/scorecards?blank=true&rows=${n}`}
                  className={`px-2 py-1 rounded font-semibold border transition ${
                    n === blankRowCount
                      ? 'bg-[#0a4f99] text-white border-[#0a4f99]'
                      : 'bg-white text-[#0a4f99] border-[#0a4f99] hover:bg-[#0a4f99]/10'
                  }`}
                >
                  {n}
                </a>
              ))}
            </div>
          )}
          <button
            onClick={() => window.print()}
            className="bg-[#0a4f99] hover:bg-[#093d75] text-white font-bold px-4 py-2 rounded text-sm transition"
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {/* Blank mode -- a single fill-in-the-blank sheet with N rows for
          manual entry of panel + team names. */}
      {blankMode && (
        <div className="px-6 py-4 max-w-[210mm] mx-auto">
          <div className="panel-sheet mb-8">
            <div className="border-b-2 border-[#0a4f99] pb-2 mb-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl font-extrabold text-[#0a4f99]">
                  RealHack 2026 — Paper Scorecard
                </h2>
                <div className="text-xs text-slate-600 font-semibold uppercase tracking-wider">
                  Blank Template
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-1">
                Fill in panel and team names by hand. {blankRowCount} rows.
              </div>
            </div>

            {/* Identity strip: Panel + Judge + Date + Signature -- all blank */}
            <div className="grid grid-cols-4 gap-3 text-xs mb-3 pb-2 border-b border-slate-300">
              <div>
                <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Panel</div>
                <div className="border-b border-slate-400 h-5 mt-0.5"></div>
              </div>
              <div>
                <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Judge Name</div>
                <div className="border-b border-slate-400 h-5 mt-0.5"></div>
              </div>
              <div>
                <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Date</div>
                <div className="border-b border-slate-400 h-5 mt-0.5"></div>
              </div>
              <div>
                <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Signature</div>
                <div className="border-b border-slate-400 h-5 mt-0.5"></div>
              </div>
            </div>

            <div className="bg-slate-100 rounded p-2 mb-3 text-[10px] text-slate-700 leading-snug">
              <span className="font-bold">Score each axis 0–10.</span>
              <span className="ml-2"><span className="font-bold">Design (30%)</span>: scalable, adaptable, useful for future needs · matches problem statement.</span>
              <span className="ml-2"><span className="font-bold">MVP (30%)</span>: deployable / adaptable for end users.</span>
              <span className="ml-2"><span className="font-bold">Demo (40%)</span>: presentation effectiveness · business value to RealPage.</span>
            </div>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#0a4f99] text-white">
                  <th className="px-1 py-1.5 text-left w-7 border border-[#0a4f99]">#</th>
                  <th className="px-2 py-1.5 text-left border border-[#0a4f99]">Team Name (write in)</th>
                  <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">Design /10</th>
                  <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">MVP /10</th>
                  <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">Demo /10</th>
                  <th className="px-2 py-1.5 text-left border border-[#0a4f99]">Comment</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: blankRowCount }).map((_, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-1 py-2 border border-slate-400 text-center text-slate-500">{i + 1}</td>
                    <td className="px-2 py-2 border border-slate-400">
                      <div className="comment-line"></div>
                    </td>
                    <td className="px-1 py-2 border border-slate-400 text-center"><span className="score-box"></span></td>
                    <td className="px-1 py-2 border border-slate-400 text-center"><span className="score-box"></span></td>
                    <td className="px-1 py-2 border border-slate-400 text-center"><span className="score-box"></span></td>
                    <td className="px-2 py-2 border border-slate-400">
                      <div className="comment-line mb-1"></div>
                      <div className="comment-line"></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-[9px] text-slate-500 mt-2">
              Hand this sheet to RealHack organizers once scoring is complete. Scores will be keyed into the system from this paper.
            </div>
          </div>
        </div>
      )}

      {/* Pre-filled mode -- one sheet per panel with the team rows
          populated from the database. */}
      {!blankMode && (
      <div className="px-6 py-4 max-w-[210mm] mx-auto">
        {panels.map((panel) => {
          const panelTeams = panel.team_ids
            .map((id) => teamsById.get(id))
            .filter((t): t is Team => !!t)
            .sort((a, b) => a.name.localeCompare(b.name));
          const panelJudges = panel.judge_ids
            .map((id) => judgesById.get(id))
            .filter((j): j is Judge => !!j);
          return (
            <div key={panel.id} className="panel-sheet mb-12">
              {/* Header */}
              <div className="border-b-2 border-[#0a4f99] pb-2 mb-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-2xl font-extrabold text-[#0a4f99]">
                    RealHack 2026 — {panel.name}
                  </h2>
                  <div className="text-xs text-slate-600 font-semibold uppercase tracking-wider">
                    Round {round} · Paper Scorecard
                  </div>
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {panelTeams.length} team{panelTeams.length === 1 ? '' : 's'}
                  {panelJudges.length > 0 && (
                    <> · {panelJudges.length} judge{panelJudges.length === 1 ? '' : 's'}: {panelJudges.map((j) => j.name).join(', ')}</>
                  )}
                </div>
              </div>

              {/* Judge identity strip */}
              <div className="grid grid-cols-3 gap-3 text-xs mb-3 pb-2 border-b border-slate-300">
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Judge Name</div>
                  <div className="border-b border-slate-400 h-5 mt-0.5"></div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Date</div>
                  <div className="border-b border-slate-400 h-5 mt-0.5"></div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Signature</div>
                  <div className="border-b border-slate-400 h-5 mt-0.5"></div>
                </div>
              </div>

              {/* Rubric reference */}
              <div className="bg-slate-100 rounded p-2 mb-3 text-[10px] text-slate-700 leading-snug">
                <span className="font-bold">Score each axis 0–10.</span>
                <span className="ml-2">
                  <span className="font-bold">Design (30%)</span>: scalable, adaptable, useful for future needs · matches problem statement.
                </span>
                <span className="ml-2">
                  <span className="font-bold">MVP (30%)</span>: deployable / adaptable for end users.
                </span>
                <span className="ml-2">
                  <span className="font-bold">Demo (40%)</span>: presentation effectiveness · business value to RealPage.
                </span>
              </div>

              {/* Team rows */}
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0a4f99] text-white">
                    <th className="px-1 py-1.5 text-left w-7 border border-[#0a4f99]">#</th>
                    <th className="px-2 py-1.5 text-left border border-[#0a4f99]">Team</th>
                    <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">Design /10</th>
                    <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">MVP /10</th>
                    <th className="px-1 py-1.5 w-14 border border-[#0a4f99]">Demo /10</th>
                    <th className="px-2 py-1.5 text-left border border-[#0a4f99]">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {panelTeams.map((t, i) => (
                    <tr key={t.id} className="align-top">
                      <td className="px-1 py-2 border border-slate-400 text-center text-slate-500">{i + 1}</td>
                      <td className="px-2 py-2 border border-slate-400 font-bold text-slate-900">
                        {t.name}
                        {t.mentor_name && (
                          <div className="text-[9px] text-slate-500 font-normal">Mentor: {t.mentor_name}</div>
                        )}
                      </td>
                      <td className="px-1 py-2 border border-slate-400 text-center">
                        <span className="score-box"></span>
                      </td>
                      <td className="px-1 py-2 border border-slate-400 text-center">
                        <span className="score-box"></span>
                      </td>
                      <td className="px-1 py-2 border border-slate-400 text-center">
                        <span className="score-box"></span>
                      </td>
                      <td className="px-2 py-2 border border-slate-400">
                        <div className="comment-line mb-1"></div>
                        <div className="comment-line"></div>
                      </td>
                    </tr>
                  ))}
                  {panelTeams.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-3 border border-slate-400 text-center text-slate-500 italic">
                        No teams assigned to this panel yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Footer note */}
              <div className="text-[9px] text-slate-500 mt-2">
                Hand this sheet to RealHack organizers once scoring is complete. Scores will be keyed into the system from this paper.
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
