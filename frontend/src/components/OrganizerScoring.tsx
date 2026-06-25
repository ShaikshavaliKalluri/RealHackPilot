import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge, RubricAxis, LeaderboardData, LeaderboardRow } from '../types';
import { fetchRubric, fetchJudges, createJudge, submitJudgeScore, fetchLeaderboard, fetchJudgeScores, advanceTeams, resetRoundAdvancements, setWinners } from '../api';

interface Props {
  teams: Team[];
  onReload?: () => void;
}

type Tab = 'leaderboard' | 'manual';

export function OrganizerScoring({ teams, onReload }: Props) {
  const [tab, setTab] = useState<Tab>('leaderboard');
  const [round, setRound] = useState<number>(1);
  const [axes, setAxes] = useState<RubricAxis[]>([]);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);

  const reloadLeaderboard = async (r = round) => {
    setBusy(true);
    setErr(null);
    try {
      const lb = await fetchLeaderboard(r);
      setLeaderboard(lb);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetchRubric().then((r) => setAxes(r.axes)).catch((e) => setErr(e.message));
    fetchJudges().then(setJudges).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    // Clear stale data first so the UI doesn't briefly show the previous
    // round's leaderboard while the new fetch is in flight. The Leaderboard
    // component below renders `null` if `leaderboard === null`, giving a
    // clean transition.
    setLeaderboard(null);
    reloadLeaderboard(round);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  return (
    <div className="space-y-5">
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
          <button
            onClick={() => setTab('leaderboard')}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition ${tab === 'leaderboard' ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition ${tab === 'manual' ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
          >
            Manual entry
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400">Round</div>
            <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1 mt-1">
              {[1, 2].map((r) => (
                <button
                  key={r}
                  onClick={() => setRound(r)}
                  className={`px-3 py-1 rounded text-sm font-semibold transition ${round === r ? 'bg-sky-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
                >
                  R{r}
                </button>
              ))}
            </div>
          </div>
          <a
            href={`/scorecards?round=${round}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-amber-500/40 hover:text-amber-300 transition"
            title="Open the printable paper-fallback scorecards for this round (one sheet per panel, panel + team names pre-filled)"
          >
            🖨️ Print (pre-filled)
          </a>
          <a
            href={`/scorecards?blank=true&rows=24`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-amber-500/40 hover:text-amber-300 transition"
            title="Open the printable scorecard with blank panel + team fields for manual fill-in"
          >
            🖨️ Print (blank)
          </a>
          <button onClick={() => reloadLeaderboard()} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-lime-500/40 transition">
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-3 text-sm">{err}</div>}

      {tab === 'leaderboard' && leaderboard && (
        <>
          <AdvancementPanel
            round={round}
            leaderboard={leaderboard}
            teams={teams}
            onAdvanced={() => { onReload?.(); reloadLeaderboard(); }}
          />
          <Leaderboard
            data={leaderboard}
            expandedTeamId={expandedTeamId}
            onToggleExpand={(id) => setExpandedTeamId(expandedTeamId === id ? null : id)}
          />
        </>
      )}

      {tab === 'manual' && (
        <ManualEntry
          teams={teams}
          judges={judges}
          axes={axes}
          round={round}
          onRefreshJudges={() => fetchJudges().then(setJudges).catch(() => {})}
          onSaved={() => reloadLeaderboard()}
        />
      )}
    </div>
  );
}


// ===== Leaderboard subcomponent =====

interface LeaderboardProps {
  data: LeaderboardData;
  expandedTeamId: number | null;
  onToggleExpand: (teamId: number) => void;
}

// Short labels for the leaderboard column headers -- iterated in declaration
// order so the columns line up consistently with the backend rubric order.
// Use a tuple (not a Record) so old legacy keys can still be looked up in
// LEGACY_AXIS_LABELS for any back-compat displays without polluting the
// active-rubric iteration.
const ACTIVE_AXIS_COLUMNS: [string, string][] = [
  ['solution_design', 'Design'],
  ['mvp',             'MVP'],
  ['presentation',    'Demo'],
];
const AXIS_LABELS: Record<string, string> = {
  ...Object.fromEntries(ACTIVE_AXIS_COLUMNS),
  // Legacy keys -- looked up by label only; not iterated.
  problem_clarity: 'Problem',
  solution_viability: 'Viability',
  industry_readiness: 'Readiness',
  roi: 'ROI',
  novelty: 'Novelty',
};

// Format helpers: backend stores avg_score and per-judge weighted totals on
// a 0-100 scale (axis 0-10 * weight % / 10). Organizer prefers a 0-10
// display ("6.967/10" reads cleaner than "69.667/100"), so we divide all
// weighted numbers by 10 at render time.
function fmt10(v: number, decimals = 3): string {
  return (v / 10).toFixed(decimals);
}

interface LeaderboardSectionProps {
  panelTitle: string;
  rows: LeaderboardRow[];
  expandedTeamId: number | null;
  onToggleExpand: (id: number) => void;
}

function LeaderboardSection({ panelTitle, rows, expandedTeamId, onToggleExpand }: LeaderboardSectionProps) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between bg-ink-900/40">
        <h3 className="font-bold text-slate-100">{panelTitle}</h3>
        <span className="text-xs text-slate-400">{rows.length} team{rows.length === 1 ? '' : 's'} scored</span>
      </div>
      <div className="divide-y divide-slate-700/40">
        {rows.map((row, idx) => {
          const expanded = expandedTeamId === row.team_id;
          return (
            <div key={row.team_id}>
              <button
                onClick={() => onToggleExpand(row.team_id)}
                className="w-full text-left px-5 py-3 hover:bg-ink-800/80 transition flex items-center gap-4"
              >
                <span className="text-xl font-extrabold text-slate-500 tabular-nums w-10 shrink-0">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate flex items-center gap-2">
                    {row.team_name}
                    <span className="text-[10px] text-slate-500">
                      {expanded ? '▴ click to collapse' : '▾ click for per-judge breakdown'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {row.judge_count} judge{row.judge_count === 1 ? '' : 's'} scored
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {ACTIVE_AXIS_COLUMNS.map(([key, label]) => (
                    <div key={key} className="text-center" title={`Average ${label} score across all judges (axis is 0-10)`}>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
                      <div className="text-sm font-bold text-slate-200">{(row.per_axis_avg[key] ?? 0).toFixed(3)}</div>
                    </div>
                  ))}
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Avg score</div>
                  <div className="text-2xl font-extrabold text-lime-300">
                    {fmt10(row.avg_score)}
                    <span className="text-base text-slate-500 font-normal">/10</span>
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="px-5 py-4 bg-ink-900/40 border-t border-slate-700/40 space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-400 mb-2 font-semibold">
                      Per-judge scoring (weighted breakdown)
                    </div>
                    {row.per_judge.length === 0 ? (
                      <p className="text-sm text-slate-500 italic">No judge submissions yet.</p>
                    ) : (
                      <div className="space-y-2.5">
                        {row.per_judge.map((pj) => (
                          <div key={pj.judge_id} className="bg-ink-800/60 border border-slate-700/40 rounded-lg p-3">
                            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                              <div className="font-semibold text-slate-100 text-sm">{pj.judge_name}</div>
                              <div className="text-right">
                                <span className="text-[10px] uppercase tracking-wider text-slate-500">Weighted total</span>
                                <span className="ml-2 text-lg font-extrabold text-lime-300">
                                  {fmt10(pj.weighted_total, 1)}<span className="text-xs text-slate-500 font-normal">/10</span>
                                </span>
                              </div>
                            </div>
                            {/* Math row: raw * weight% = contribution (all
                                displayed on the 0-10 scale to match the
                                top-line total). */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                              {pj.axis_breakdown.map((a) => (
                                <div key={a.key} className="bg-ink-900/50 rounded px-2.5 py-2">
                                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                                    {AXIS_LABELS[a.key] ?? a.key}
                                  </div>
                                  <div className="text-slate-200 font-mono">
                                    <span className="text-sky-300 font-bold">{a.raw}</span>
                                    <span className="text-slate-500"> × {a.weight_pct}% = </span>
                                    <span className="text-lime-300 font-bold">{fmt10(a.contribution, 1)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {pj.comment && (
                              <div className="mt-2 pt-2 border-t border-slate-700/40">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Comment</div>
                                <p className="text-sm text-slate-300 italic whitespace-pre-wrap">{pj.comment}</p>
                              </div>
                            )}
                            {(pj.submitted_at || pj.entered_by_email) && (
                              <div className="mt-2 text-[10px] text-slate-500">
                                {pj.submitted_at && <>Submitted {new Date(pj.submitted_at).toLocaleString()}</>}
                                {pj.entered_by_email && <span> · entered by {pj.entered_by_email}</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-lime-500/5 border border-lime-500/30 rounded-lg p-3">
                    <div className="text-xs uppercase tracking-wider text-lime-300/90 mb-2 font-semibold">
                      Team average (this is what the panel leaderboard ranks on)
                    </div>
                    <div className="text-xs text-slate-300 font-mono">
                      {row.per_judge.map((pj, i) => (
                        <span key={pj.judge_id}>
                          {i > 0 && <span className="text-slate-600"> + </span>}
                          <span className="text-lime-300">{fmt10(pj.weighted_total, 1)}</span>
                        </span>
                      ))}
                      <span className="text-slate-500"> ÷ {row.judge_count} = </span>
                      <span className="text-lime-300 font-bold text-base">{fmt10(row.avg_score)}</span>
                      <span className="text-slate-500">/10</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({ data, expandedTeamId, onToggleExpand }: LeaderboardProps) {
  const rowsWithScores = data.rows.filter((r) => r.judge_count > 0);
  const rowsZero = data.rows.filter((r) => r.judge_count === 0);

  // Group scored rows by panel so each panel ranks independently. Panel
  // calibration drift (one panel's '8' is another's '10') makes a flat
  // cross-panel ranking unfair -- splitting lets organizers advance the
  // top teams from each panel separately.
  const byPanel = new Map<number, { name: string; rows: LeaderboardRow[] }>();
  const unassigned: LeaderboardRow[] = [];
  for (const r of rowsWithScores) {
    if (r.panel_id == null) {
      unassigned.push(r);
      continue;
    }
    const existing = byPanel.get(r.panel_id);
    if (existing) {
      existing.rows.push(r);
    } else {
      byPanel.set(r.panel_id, { name: r.panel_name || `Panel ${r.panel_id}`, rows: [r] });
    }
  }
  // Stable order by panel_id ascending.
  const panelGroups = Array.from(byPanel.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([panelId, group]) => ({ panelId, ...group }));

  return (
    <div className="space-y-4">
      <div className="px-1 flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-slate-100">Round {data.round} leaderboard</h3>
        <span className="text-xs text-slate-400">
          {rowsWithScores.length} scored · {rowsZero.length} pending · split by panel
        </span>
      </div>

      {rowsWithScores.length === 0 && (
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-10 text-center text-slate-400">
          No scores submitted for Round {data.round} yet.
        </div>
      )}

      {/* Side-by-side panel layout on screens >= xl (1280px+). Stack on
          smaller widths where two columns would crush the per-axis
          numbers + the expand affordance. Each panel card stretches to
          fill its grid cell so the heights match visually. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {panelGroups.map((g) => (
          <LeaderboardSection
            key={g.panelId}
            panelTitle={`${g.name} — Round ${data.round}`}
            rows={g.rows}
            expandedTeamId={expandedTeamId}
            onToggleExpand={onToggleExpand}
          />
        ))}

        {unassigned.length > 0 && (
          <LeaderboardSection
            panelTitle="Not assigned to a panel"
            rows={unassigned}
            expandedTeamId={expandedTeamId}
            onToggleExpand={onToggleExpand}
          />
        )}
      </div>

      {rowsZero.length > 0 && (
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl overflow-hidden">
          <details className="border-slate-700/40">
            <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white">
              {rowsZero.length} team{rowsZero.length === 1 ? '' : 's'} not yet scored in Round {data.round}
            </summary>
            <ul className="px-5 pb-3 text-sm text-slate-400 space-y-1">
              {rowsZero.map((r) => <li key={r.team_id}>· {r.team_name}{r.panel_name && <span className="text-slate-600"> ({r.panel_name})</span>}</li>)}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}


// ===== Manual entry subcomponent =====

interface ManualEntryProps {
  teams: Team[];
  judges: Judge[];
  axes: RubricAxis[];
  round: number;
  onRefreshJudges: () => void;
  onSaved: () => void;
}

function ManualEntry({ teams, judges, axes, round, onRefreshJudges, onSaved }: ManualEntryProps) {
  const [judgeId, setJudgeId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [showAddJudge, setShowAddJudge] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Reset scores when team changes — and pre-fill if a record exists
  useEffect(() => {
    if (!teamId || !judgeId) {
      setScores({});
      setComment('');
      return;
    }
    fetchJudgeScores({ round, judge_id: Number(judgeId), team_id: Number(teamId) })
      .then((list) => {
        if (list.length > 0) {
          setScores(list[0].scores);
          setComment(list[0].comment ?? '');
          setMsg(`This judge already submitted for this team in R${round} — you can update by saving again.`);
        } else {
          const init: Record<string, number> = {};
          for (const a of axes) init[a.key] = 0;
          setScores(init);
          setComment('');
          setMsg(null);
        }
      })
      .catch(() => {});
  }, [teamId, judgeId, round, axes]);

  // Simple sum -- weights are applied only on the leaderboard, not in the
  // per-judge form (avoids confusing organizers entering scores on behalf).
  const total = useMemo(() => axes.reduce((s, a) => s + (scores[a.key] || 0), 0), [axes, scores]);
  const maxTotal = axes.length * 10;

  const submit = async () => {
    if (!judgeId || !teamId) { setErr('Pick a judge and a team first.'); return; }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await submitJudgeScore({
        judge_id: Number(judgeId),
        team_id: Number(teamId),
        round,
        scores,
        comment: comment.trim() || null,
        entered_by_email: 'organizer@realpage.com',
      });
      setMsg(`Saved — ${judges.find((j) => j.id === judgeId)?.name}'s scores for ${teams.find((t) => t.id === teamId)?.name} (R${round})`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const addNewJudge = async () => {
    if (!newName.trim()) { setErr('Judge name required'); return; }
    try {
      const j = await createJudge(newName.trim(), newEmail.trim() || null);
      onRefreshJudges();
      setJudgeId(j.id);
      setShowAddJudge(false);
      setNewName('');
      setNewEmail('');
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  };

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5 space-y-5">
      <div>
        <h3 className="font-bold">Manual score entry · Round {round}</h3>
        <p className="text-sm text-slate-400">
          Enter scores on behalf of a judge from a printout. Marked as organizer-entered for audit.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-slate-400">Judge</label>
          <div className="flex gap-2 mt-1">
            <select
              value={judgeId}
              onChange={(e) => setJudgeId(e.target.value ? Number(e.target.value) : '')}
              className="flex-1 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm"
            >
              <option value="">— select judge —</option>
              {judges.map((j) => <option key={j.id} value={j.id}>{j.name}{j.email ? ` (${j.email})` : ''}</option>)}
            </select>
            <button onClick={() => setShowAddJudge(!showAddJudge)} className="text-xs px-3 py-2 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-lime-500/40 transition">
              + Add
            </button>
          </div>
          {showAddJudge && (
            <div className="mt-2 bg-ink-900 border border-slate-700/40 rounded p-3 space-y-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Judge name"
                className="w-full bg-ink-950 border border-slate-700/40 rounded px-2 py-1 text-sm"
              />
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email (optional)"
                className="w-full bg-ink-950 border border-slate-700/40 rounded px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
                <button onClick={addNewJudge} className="text-xs px-3 py-1 rounded bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold transition">Save</button>
                <button onClick={() => setShowAddJudge(false)} className="text-xs px-3 py-1 rounded text-slate-400 hover:text-white">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-slate-400">Team</label>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
            className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm mt-1"
          >
            <option value="">— select team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {msg && <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded p-2 text-sm">{msg}</div>}

      {judgeId && teamId && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-400">Scorecard · each axis out of 10</h4>
          {axes.map((a) => {
            const v = scores[a.key] || 0;
            return (
              <div key={a.key} className="grid grid-cols-12 gap-3 items-center bg-ink-900/50 rounded px-3 py-2">
                <label className="col-span-4 text-sm font-semibold text-slate-100">{a.label}</label>
                <div className="col-span-7">
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={v}
                    onChange={(e) => setScores({ ...scores, [a.key]: parseInt(e.target.value) })}
                    className="w-full accent-sky-400"
                  />
                </div>
                <div className="col-span-1 text-center text-xl font-extrabold text-sky-300">{v}</div>
              </div>
            );
          })}

          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Comment (optional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="From the printout — any notes the judge wrote"
              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-700/40">
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-400">Total</span>
              <div className="text-2xl font-extrabold text-sky-300">{total}<span className="text-base text-slate-500">/{maxTotal}</span></div>
            </div>
            {err && <div className="text-sm text-rose-300">{err}</div>}
            <button onClick={submit} disabled={busy} className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-5 py-2 rounded text-sm transition">
              {busy ? 'Saving…' : 'Save scores'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ===== Tournament advancement subcomponent =====
//
// Per-round panel that ranks the leaderboard, lets the organizer select
// which teams advance, and writes the new advanced_to_round to the DB.
// For Round 2 (the final round), instead of "advance", the panel offers
// a Crown Winners flow that sets final_position = 1/2/3 on the picked teams.

interface AdvancementPanelProps {
  round: number;
  leaderboard: LeaderboardData;
  teams: Team[];
  onAdvanced: () => void;
}

// Round 1: advance ~20 to Round 2. Round 2 is the final — winners (1st/2nd/3rd)
// are crowned directly from Round 2 leaderboard rather than advancing further.
const DEFAULT_ADVANCE_COUNT: Record<number, number> = { 1: 20, 2: 3 };

function AdvancementPanel({ round, leaderboard, teams, onAdvanced }: AdvancementPanelProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [winnerOpen, setWinnerOpen] = useState(false);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // Pre-select the top N teams by score on every round/leaderboard change
  const rankedRows = useMemo(
    () => leaderboard.rows.filter((r) => r.judge_count > 0),
    [leaderboard]
  );

  useEffect(() => {
    const defaultN = DEFAULT_ADVANCE_COUNT[round] ?? 0;
    setSelected(new Set(rankedRows.slice(0, defaultN).map((r) => r.team_id)));
  }, [round, rankedRows]);

  const alreadyAdvancedCount = useMemo(() => {
    const next = round + 1;
    return teams.filter((t) => (t.advanced_to_round ?? 1) >= next).length;
  }, [teams, round]);

  const toggle = (teamId: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const handleAdvance = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await advanceTeams(round, Array.from(selected));
      onAdvanced();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!confirm(`Reset advancement past Round ${round}? Any teams currently advanced beyond Round ${round} will be moved back.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await resetRoundAdvancements(round);
      onAdvanced();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Round 2 (final) → Winners flow
  if (round === 2) {
    return (
      <>
        <div className="bg-gradient-to-br from-amber-500/15 to-rose-500/10 border border-amber-500/40 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-bold text-amber-200">🏆 Crown the Finalists</h3>
            <p className="text-xs text-slate-300 mt-0.5">After Round 2 finishes, pick the top finalists (3, 5, 7, or 10) from the leaderboard.</p>
          </div>
          <button
            onClick={() => setWinnerOpen(true)}
            disabled={rankedRows.length === 0}
            className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg transition"
          >
            Crown Finalists…
          </button>
        </div>
        {winnerOpen && (
          <CrownWinnersModal
            rows={rankedRows}
            onClose={() => setWinnerOpen(false)}
            onSaved={() => { setWinnerOpen(false); onAdvanced(); }}
          />
        )}
      </>
    );
  }

  // Round 1 → standard advancement flow (advance to Round 2, which is the final)
  const nextRound = round + 1;
  const nextRoundLabel = nextRound === 2 ? 'Round 2 (Final)' : `Round ${nextRound}`;

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-slate-100">
            Advance teams to {nextRoundLabel}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Pick the teams that move on from Round {round}.
            {alreadyAdvancedCount > 0 && (
              <span className="text-lime-300"> · {alreadyAdvancedCount} already advanced</span>
            )}
            {rankedRows.length === 0 && (
              <span className="text-amber-300"> · no scores submitted yet</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alreadyAdvancedCount > 0 && (
            <button
              onClick={handleReset}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-300 hover:border-rose-500/40 hover:text-rose-300 transition"
            >
              Undo advancement
            </button>
          )}
          <button
            onClick={handleAdvance}
            disabled={busy || selected.size === 0}
            className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
          >
            {busy ? 'Advancing…' : `Advance ${selected.size} team${selected.size === 1 ? '' : 's'} to ${nextRoundLabel}`}
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-2 text-xs">{err}</div>}

      {rankedRows.length > 0 && (() => {
        // Group ranked rows by panel so organizers see Panel 1 and Panel 2
        // rankings independently and pick top teams from each. Mirrors the
        // panel split on the main leaderboard.
        const groups = new Map<number, { name: string; rows: LeaderboardRow[] }>();
        const unassigned: LeaderboardRow[] = [];
        for (const r of rankedRows) {
          if (r.panel_id == null) { unassigned.push(r); continue; }
          const g = groups.get(r.panel_id);
          if (g) g.rows.push(r);
          else groups.set(r.panel_id, { name: r.panel_name || `Panel ${r.panel_id}`, rows: [r] });
        }
        const groupList: { panelId: number | null; name: string; rows: LeaderboardRow[] }[] =
          Array.from(groups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([panelId, g]) => ({ panelId, ...g }));
        if (unassigned.length > 0) {
          groupList.push({ panelId: null, name: 'Not assigned to a panel', rows: unassigned });
        }

        return (
          <div className="border-t border-slate-700/40 pt-3 grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {groupList.map((g) => (
              <div key={g.panelId ?? 'unassigned'}>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 px-1">
                  {g.name} <span className="text-slate-600 font-normal">· {g.rows.length} team{g.rows.length === 1 ? '' : 's'}</span>
                </div>
                <div className="max-h-72 overflow-y-auto pr-1 space-y-1">
                  {g.rows.map((row, idx) => {
                    const team = teamById.get(row.team_id);
                    const alreadyAdvanced = team && (team.advanced_to_round ?? 1) >= nextRound;
                    const checked = selected.has(row.team_id);
                    return (
                      <label
                        key={row.team_id}
                        className={`flex items-center gap-3 px-3 py-1.5 rounded cursor-pointer transition ${
                          checked ? 'bg-sky-500/10 border border-sky-500/40' : 'bg-ink-900/40 border border-transparent hover:bg-ink-900/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(row.team_id)}
                          className="w-4 h-4 accent-sky-400"
                        />
                        <span className="text-sm font-bold text-slate-500 w-7 tabular-nums shrink-0">#{idx + 1}</span>
                        <span className="flex-1 text-sm text-slate-100 truncate">{row.team_name}</span>
                        {alreadyAdvanced && (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-lime-500/15 text-lime-300 border border-lime-500/40">
                            ✓ Advanced
                          </span>
                        )}
                        <span className="text-sm font-bold text-lime-300 tabular-nums w-16 text-right shrink-0">
                          {fmt10(row.avg_score)}<span className="text-[10px] text-slate-500">/10</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}


// ===== Crown Winners modal =====

interface CrownWinnersModalProps {
  rows: LeaderboardData['rows'];
  onClose: () => void;
  onSaved: () => void;
}

function CrownWinnersModal({ rows, onClose, onSaved }: CrownWinnersModalProps) {
  // How many finalists to crown. Defaults to 5 — RealHack 2026 picks vary
  // (top 3, top 5, top 7, top 10) so we make this configurable up front.
  const [count, setCount] = useState<number>(Math.min(5, rows.length || 5));
  // selections[i] = team_id (or '') for rank i+1
  const [selections, setSelections] = useState<(number | '')[]>(
    () => rows.slice(0, 5).map((r) => r.team_id),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep selections array length in sync with count, preserving prior picks.
  const ensureLen = (n: number) => {
    setSelections((prev) => {
      const next = [...prev];
      while (next.length < n) {
        const i = next.length;
        next.push(rows[i]?.team_id ?? '');
      }
      next.length = n;
      return next;
    });
  };

  const setRank = (rank: number, value: number | '') => {
    setSelections((prev) => {
      const next = [...prev];
      next[rank - 1] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      const positions: Record<string, number> = {};
      selections.forEach((teamId, idx) => {
        if (teamId) positions[String(idx + 1)] = Number(teamId);
      });
      await setWinners(positions);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear all finalist positions?')) return;
    setBusy(true);
    setErr(null);
    try {
      await setWinners({});
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-ink-800 border border-amber-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
        <div className="bg-gradient-to-br from-amber-500/25 to-rose-500/15 p-4 border-b border-amber-500/40">
          <h3 className="font-bold text-amber-200">🏆 Crown the Finalists</h3>
          <p className="text-xs text-slate-300 mt-0.5">Pick how many finalists you want (3 / 5 / 7 / 10) — dropdowns pre-fill from the leaderboard.</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">How many finalists?</label>
            <div className="mt-1 flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
              {[3, 5, 7, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => { setCount(n); ensureLen(n); }}
                  className={`flex-1 px-3 py-1.5 rounded text-sm font-semibold transition ${count === n ? 'bg-amber-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
                >
                  Top {n}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-2">
            {Array.from({ length: count }, (_, i) => i + 1).map((rank) => (
              <div key={rank}>
                <label className="text-xs uppercase tracking-wider text-slate-400">Rank #{rank}</label>
                <select
                  value={selections[rank - 1] ?? ''}
                  onChange={(e) => setRank(rank, e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-amber-500/60"
                >
                  <option value="">— Not set —</option>
                  {rows.map((r) => (
                    <option key={r.team_id} value={r.team_id}>
                      {r.team_name} ({fmt10(r.avg_score)}/10)
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-2 text-xs">{err}</div>}
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-2 flex-wrap">
          <button onClick={handleClear} disabled={busy} className="text-xs text-slate-400 hover:text-rose-300">
            Clear all positions
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-2">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
            >
              {busy ? 'Saving…' : 'Save finalists'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// We reference Team here via teamById; silences unused-import lint if Team
// wasn't otherwise read.
type _TeamRef = Team;
const _teamRef: _TeamRef | null = null;
void _teamRef;
