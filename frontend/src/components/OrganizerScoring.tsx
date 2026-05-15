import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge, RubricAxis, LeaderboardData } from '../types';
import { fetchRubric, fetchJudges, createJudge, submitJudgeScore, fetchLeaderboard, fetchJudgeScores } from '../api';

interface Props {
  teams: Team[];
}

type Tab = 'leaderboard' | 'manual';

export function OrganizerScoring({ teams }: Props) {
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
              {[1, 2, 3].map((r) => (
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
          <button onClick={() => reloadLeaderboard()} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-ink-900 border border-slate-700/40 text-slate-200 hover:border-lime-500/40 transition">
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-3 text-sm">{err}</div>}

      {tab === 'leaderboard' && leaderboard && (
        <Leaderboard
          data={leaderboard}
          expandedTeamId={expandedTeamId}
          onToggleExpand={(id) => setExpandedTeamId(expandedTeamId === id ? null : id)}
        />
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

const AXIS_LABELS: Record<string, string> = {
  problem_clarity: 'Problem',
  solution_viability: 'Viability',
  industry_readiness: 'Readiness',
  roi: 'ROI',
  novelty: 'Novelty',
};

function Leaderboard({ data, expandedTeamId, onToggleExpand }: LeaderboardProps) {
  const rowsWithScores = data.rows.filter((r) => r.judge_count > 0);
  const rowsZero = data.rows.filter((r) => r.judge_count === 0);

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
        <h3 className="font-bold">Round {data.round} leaderboard</h3>
        <span className="text-xs text-slate-400">
          {rowsWithScores.length} scored · {rowsZero.length} pending
        </span>
      </div>

      {rowsWithScores.length === 0 && (
        <div className="p-10 text-center text-slate-400">
          No scores submitted for Round {data.round} yet.
        </div>
      )}

      <div className="divide-y divide-slate-700/40">
        {rowsWithScores.map((row, idx) => {
          const expanded = expandedTeamId === row.team_id;
          return (
            <div key={row.team_id}>
              <button
                onClick={() => onToggleExpand(row.team_id)}
                className="w-full text-left px-5 py-3 hover:bg-ink-800/80 transition flex items-center gap-4"
              >
                <span className="text-xl font-extrabold text-slate-500 tabular-nums w-10 shrink-0">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{row.team_name}</div>
                  <div className="text-xs text-slate-400">
                    {row.judge_count} judge{row.judge_count === 1 ? '' : 's'} · avg {row.avg_score}/50
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {Object.entries(AXIS_LABELS).map(([key, label]) => (
                    <div key={key} className="text-center" title={label}>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
                      <div className="text-sm font-bold text-slate-200">{(row.per_axis_avg[key] ?? 0).toFixed(1)}</div>
                    </div>
                  ))}
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-xs uppercase tracking-wider text-slate-400">Total</div>
                  <div className="text-2xl font-extrabold text-lime-300">{row.total_sum}</div>
                </div>
              </button>

              {expanded && (
                <div className="px-5 py-4 bg-ink-900/40 border-t border-slate-700/40 space-y-2">
                  {row.comments.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No comments from judges this round.</p>
                  ) : (
                    row.comments.map((c, i) => (
                      <div key={i} className="bg-ink-800/50 rounded px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wider text-slate-400">{c.judge_name}</div>
                        <p className="text-slate-200 mt-0.5 whitespace-pre-wrap">{c.comment}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rowsZero.length > 0 && (
        <details className="border-t border-slate-700/40">
          <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white">
            {rowsZero.length} team{rowsZero.length === 1 ? '' : 's'} not yet scored in Round {data.round}
          </summary>
          <ul className="px-5 pb-3 text-sm text-slate-400 space-y-1">
            {rowsZero.map((r) => <li key={r.team_id}>· {r.team_name}</li>)}
          </ul>
        </details>
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
