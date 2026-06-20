import { useEffect, useMemo, useState } from 'react';
import type { Judge, RubricAxis, Team, JudgeScoreRecord } from '../types';
import { fetchRubric, judgeLogin, submitJudgeScore, fetchJudgeScores, deleteJudgeScore, type UserProfile } from '../api';

interface Props {
  teams: Team[];
  user: UserProfile;
}

const JUDGE_KEY = 'realhack_pilot_judge';

function persistJudge(j: Judge | null) {
  if (j) localStorage.setItem(JUDGE_KEY, JSON.stringify(j));
  else localStorage.removeItem(JUDGE_KEY);
}
function loadJudge(): Judge | null {
  const raw = localStorage.getItem(JUDGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function JudgeMode({ teams, user }: Props) {
  const [judge, setJudge] = useState<Judge | null>(() => loadJudge());
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const [round, setRound] = useState<number>(1);
  const [axes, setAxes] = useState<RubricAxis[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);

  const [submittedScores, setSubmittedScores] = useState<JudgeScoreRecord[]>([]);

  useEffect(() => {
    fetchRubric().then((r) => setAxes(r.axes)).catch(() => {});
  }, []);

  // Auto-create the Judge record from the SSO profile — no separate sign-in
  // needed now that the dashboard is gated by Entra SSO. We still keep the
  // Judge entity for the score-attribution + leaderboard pipeline.
  useEffect(() => {
    if (judge) return; // already signed in via cached localStorage
    if (!user?.name || !user?.email) return;
    judgeLogin(user.name, user.email)
      .then((j) => {
        setJudge(j);
        persistJudge(j);
      })
      .catch((e: any) => setLoginErr(e.message ?? String(e)));
  }, [user, judge]);

  useEffect(() => {
    if (!judge) { setSubmittedScores([]); return; }
    fetchJudgeScores({ judge_id: judge.id, round })
      .then(setSubmittedScores)
      .catch(() => setSubmittedScores([]));
  }, [judge, round]);

  const scoredTeamIds = useMemo(() => new Set(submittedScores.map((s) => s.team_id)), [submittedScores]);

  // ===== Waiting for SSO auto-login (or showing an error) =====
  if (!judge) {
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-8 text-center">
          {loginErr ? (
            <>
              <h2 className="text-2xl font-extrabold text-rose-300">Couldn't set up judge profile</h2>
              <p className="text-sm text-slate-400 mt-2">{loginErr}</p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-extrabold">Preparing your scorecard…</h2>
              <p className="text-sm text-slate-400 mt-2">
                Signed in as <span className="text-slate-200">{user?.name}</span>
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const activeTeam = teams.find((t) => t.id === activeTeamId) || null;
  const existingScoreForActive = activeTeamId ? submittedScores.find((s) => s.team_id === activeTeamId) : undefined;

  return (
    <div className="space-y-5">
      {/* Round selector + progress (identity + sign-out live in the global UserBadge) */}
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Round</div>
          <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1 mt-1">
            {[1, 2].map((r) => (
              <button
                key={r}
                onClick={() => { setRound(r); setActiveTeamId(null); }}
                className={`px-3 py-1 rounded text-sm font-semibold transition ${round === r ? 'bg-sky-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
              >
                R{r}
              </button>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-400">Progress · Round {round}</div>
          <div className="font-bold text-lg">{scoredTeamIds.size} <span className="text-slate-500 font-normal text-base">/ {teams.length} teams scored</span></div>
        </div>
      </div>

      {/* Team list — round-aware: only show teams that advanced to (at least) this round */}
      {!activeTeam && (() => {
        const eligibleTeams = teams.filter((t) => (t.advanced_to_round ?? 1) >= round);
        return (
        <div>
          <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-2">
            Teams to score · Round {round}
            <span className="ml-2 text-slate-500 normal-case font-normal">
              ({eligibleTeams.length} eligible)
            </span>
          </h3>
          {round > 1 && eligibleTeams.length === 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm text-amber-200 mb-3">
              No teams have been advanced to Round {round} yet. Ask the organizer to pick advancing teams from the Scoring tab.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {eligibleTeams.map((t) => {
              const scored = scoredTeamIds.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTeamId(t.id)}
                  className={`text-left rounded-xl border p-4 transition ${
                    scored
                      ? 'bg-lime-500/10 border-lime-500/40 hover:bg-lime-500/15'
                      : 'bg-ink-800/60 border-slate-700/40 hover:border-sky-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold truncate">{t.name}</h4>
                    {scored && <span className="text-xs px-2 py-0.5 rounded bg-lime-500/20 text-lime-300 border border-lime-500/40 shrink-0">✓ Scored</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {t.members.length} member{t.members.length === 1 ? '' : 's'} · Mentor: {t.mentor_name || '—'}
                  </p>
                  {t.ai_scores?.summary ? (
                    <p className="text-xs text-slate-300 mt-2 line-clamp-3 italic">{t.ai_scores.summary}</p>
                  ) : t.idea ? (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">{t.idea}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
          {teams.length === 0 && (
            <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-10 text-center text-slate-400">
              No teams loaded yet. Ask the organizer to upload the registration export.
            </div>
          )}
        </div>
        );
      })()}

      {/* Active scorecard */}
      {activeTeam && (
        <Scorecard
          team={activeTeam}
          round={round}
          axes={axes}
          judgeId={judge.id}
          existing={existingScoreForActive}
          onBack={() => setActiveTeamId(null)}
          onSubmitted={async () => {
            const list = await fetchJudgeScores({ judge_id: judge.id, round });
            setSubmittedScores(list);
            setActiveTeamId(null);
          }}
        />
      )}
    </div>
  );
}


// ===== Scorecard subcomponent =====

interface ScorecardProps {
  team: Team;
  round: number;
  axes: RubricAxis[];
  judgeId: number;
  existing?: JudgeScoreRecord;
  onSubmitted: () => void | Promise<void>;
  onBack: () => void;
}

function Scorecard({ team, round, axes, judgeId, existing, onSubmitted, onBack }: ScorecardProps) {
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const a of axes) init[a.key] = existing?.scores?.[a.key] ?? 0;
    return init;
  });
  const [comment, setComment] = useState<string>(existing?.comment || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Hydrate when axes load after mount
    setScores((prev) => {
      const next = { ...prev };
      for (const a of axes) {
        if (!(a.key in next)) next[a.key] = existing?.scores?.[a.key] ?? 0;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes.length]);

  // Simple sum -- weights are applied only on the leaderboard, not in the
  // per-judge form (avoids confusing judges with internal weighting math).
  const total = axes.reduce((s, a) => s + (scores[a.key] || 0), 0);
  const maxTotal = axes.length * 10;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await submitJudgeScore({
        judge_id: judgeId,
        team_id: team.id,
        round,
        scores,
        comment: comment.trim() || null,
      });
      await onSubmitted();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetScore = async () => {
    if (!existing) return;
    if (!confirm(`Reset your score for "${team.name}" in Round ${round}? This will remove the score entirely — the team will show as unscored.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteJudgeScore(judgeId, team.id, round);
      await onSubmitted();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-ink-800/60 border border-sky-500/40 rounded-xl p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-white mb-2">← Back to team list</button>
          <h3 className="text-2xl font-extrabold">{team.name}</h3>
          <p className="text-xs text-slate-400 mt-1">
            Mentor: {team.mentor_name || '—'} · {team.members.length} member{team.members.length === 1 ? '' : 's'} · Round {round}
          </p>
        </div>
        {existing && (
          <span className="text-xs px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">
            Editing existing score · {existing.total}/{maxTotal}
          </span>
        )}
      </div>

      {/* Quick brief — neutral AI summary so the judge can grasp the team in 30 seconds.
          NO scores or evaluations shown — just a recap of the team's own submission. */}
      {team.ai_scores?.summary && (
        <div className="bg-sky-500/5 border border-sky-500/30 rounded-lg p-4">
          <h4 className="text-xs uppercase tracking-wider text-sky-300 font-bold mb-2">Quick brief</h4>
          <p className="text-sm text-slate-100 leading-relaxed">{team.ai_scores.summary}</p>
        </div>
      )}

      {/* Full submission details (collapsed by default) — for when the judge wants to dig deeper. */}
      <details className="bg-ink-900/50 rounded p-3 text-sm">
        <summary className="cursor-pointer text-slate-300 font-semibold">Full submission details</summary>
        <div className="mt-3 space-y-2 text-slate-300">
          {team.idea && <div><span className="text-xs uppercase tracking-wider text-slate-500">Idea:</span> {team.idea}</div>}
          {team.tools && <div><span className="text-xs uppercase tracking-wider text-slate-500">Tech stack:</span> {team.tools}</div>}
          {team.approach && <div><span className="text-xs uppercase tracking-wider text-slate-500">Approach:</span> {team.approach}</div>}
          {team.viability && <div><span className="text-xs uppercase tracking-wider text-slate-500">Viability:</span> {team.viability}</div>}
          {team.business_value && <div><span className="text-xs uppercase tracking-wider text-slate-500">Business value:</span> {team.business_value}</div>}
        </div>
      </details>

      {/* Rubric scores */}
      <div className="space-y-2">
        <h4 className="text-xs uppercase tracking-wider text-slate-400">Scorecard · each axis out of 10</h4>
        {axes.map((a) => {
          const v = scores[a.key] || 0;
          return (
            <div key={a.key} className="grid grid-cols-12 gap-3 items-center bg-ink-900/50 rounded px-3 py-2">
              <label className="col-span-4 text-sm font-semibold text-slate-100">{a.label}</label>
              <div className="col-span-7 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={v}
                  onChange={(e) => setScores({ ...scores, [a.key]: parseInt(e.target.value) })}
                  className="flex-1 accent-sky-400"
                />
                <div className="flex gap-0.5">
                  {[0, 2, 4, 6, 8, 10].map((mark) => (
                    <span key={mark} className={`text-[10px] w-4 text-center ${v >= mark ? 'text-sky-300' : 'text-slate-600'}`}>{mark}</span>
                  ))}
                </div>
              </div>
              <div className="col-span-1 text-center text-2xl font-extrabold text-sky-300">{v}</div>
            </div>
          );
        })}
      </div>

      {/* Comment */}
      <div>
        <label className="text-xs uppercase tracking-wider text-slate-400">Overall comment (optional)</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="What stood out, what would you want to see more of, any concerns..."
          className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-sky-500/60"
        />
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-slate-700/40 gap-3 flex-wrap">
        <div>
          <span className="text-xs uppercase tracking-wider text-slate-400">Your total</span>
          <div className="text-3xl font-extrabold text-sky-300">{total}<span className="text-base text-slate-500">/{maxTotal}</span></div>
        </div>
        {err && <div className="text-sm text-rose-300">{err}</div>}
        <div className="flex gap-2 items-center flex-wrap">
          {existing && (
            <button
              onClick={resetScore}
              disabled={busy}
              className="text-xs px-3 py-2 rounded font-semibold bg-ink-900 border border-rose-500/30 hover:border-rose-500/60 text-rose-300 hover:text-rose-200 transition"
              title="Delete this score entirely — team becomes unscored again"
            >
              Reset score
            </button>
          )}
          <button onClick={onBack} className="px-4 py-2 rounded text-sm font-semibold bg-ink-900 border border-slate-700/40 hover:border-slate-500 text-slate-200 transition">Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-5 py-2 rounded text-sm transition">
            {busy ? 'Submitting…' : existing ? 'Update score' : 'Submit score'}
          </button>
        </div>
      </div>
    </div>
  );
}
