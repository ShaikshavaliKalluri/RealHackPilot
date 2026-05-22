import { useEffect, useMemo, useState } from 'react';
import type { Team, RubricAxis, JudgeScoreRecord } from '../types';
import {
  fetchRubric,
  fetchMyAssignedTeams,
  fetchTeamsForJudge,
  fetchJudgeScores,
  submitJudgeScore,
  deleteJudgeScore,
  type UserProfile,
} from '../api';
import { UserBadge } from './UserBadge';

interface Props {
  judgeId: number;
  judgeName: string;
  user: UserProfile | null;
  // Preview mode: organizer is viewing AS this judge (read-only banner shown).
  // When preview is set, teams are fetched via /api/judges/{id}/teams instead of /me/teams.
  preview?: { onExit: () => void } | null;
}

export function JudgeDashboard({ judgeId, judgeName, user, preview }: Props) {
  const [round, setRound] = useState<number>(1);
  const [teams, setTeams] = useState<Team[]>([]);
  const [axes, setAxes] = useState<RubricAxis[]>([]);
  const [submittedScores, setSubmittedScores] = useState<JudgeScoreRecord[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchRubric().then((r) => setAxes(r.axes)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const teamsPromise = preview ? fetchTeamsForJudge(judgeId, round) : fetchMyAssignedTeams(round);
    Promise.all([teamsPromise, fetchJudgeScores({ judge_id: judgeId, round })])
      .then(([t, s]) => {
        setTeams(t);
        setSubmittedScores(s);
      })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [judgeId, round, preview]);

  const scoredTeamIds = useMemo(() => new Set(submittedScores.map((s) => s.team_id)), [submittedScores]);
  const activeTeam = teams.find((t) => t.id === activeTeamId) || null;
  const existingForActive = activeTeamId ? submittedScores.find((s) => s.team_id === activeTeamId) : undefined;

  const reloadScores = async () => {
    const list = await fetchJudgeScores({ judge_id: judgeId, round });
    setSubmittedScores(list);
  };

  return (
    <div className="min-h-screen">
      {preview && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 px-4 py-2.5">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 flex-wrap text-amber-100">
            <div className="text-sm">
              <span className="font-bold">Preview mode</span> — viewing the judge dashboard as <span className="font-bold">{judgeName}</span>.
            </div>
            <button
              onClick={preview.onExit}
              className="text-xs px-3 py-1.5 rounded font-semibold bg-amber-400 hover:bg-amber-300 text-ink-950 transition"
            >
              Exit preview
            </button>
          </div>
        </div>
      )}
      {/* Top bar — sticky on mobile so judges can always see round + identity */}
      <header className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <img src="/realhack-logo.png" alt="RealHack 2026" className="h-9" />
          {user && <UserBadge user={user} />}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* Judge greeting + round picker */}
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Welcome</div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100">{judgeName}</h1>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-400">Round {round}</div>
              <div className="text-base font-bold text-sky-300">
                {scoredTeamIds.size} <span className="text-slate-500 font-normal">/ {teams.length} scored</span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
            {[1, 2, 3].map((r) => (
              <button
                key={r}
                onClick={() => { setRound(r); setActiveTeamId(null); }}
                className={`flex-1 px-3 py-1.5 rounded text-sm font-semibold transition ${round === r ? 'bg-sky-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
              >
                Round {r}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
            {err}
          </div>
        )}

        {/* Active scorecard view */}
        {activeTeam && (
          <Scorecard
            team={activeTeam}
            round={round}
            axes={axes}
            judgeId={judgeId}
            existing={existingForActive}
            onBack={() => setActiveTeamId(null)}
            onSubmitted={async () => { await reloadScores(); setActiveTeamId(null); }}
          />
        )}

        {/* Team list */}
        {!activeTeam && (
          <div>
            {loading ? (
              <div className="text-slate-400 text-sm text-center py-8">Loading your assigned teams…</div>
            ) : teams.length === 0 ? (
              <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-8 text-center">
                <h3 className="font-bold text-slate-100 mb-2">No teams assigned to you for Round {round} yet</h3>
                <p className="text-sm text-slate-400">The organizers will assign teams to you shortly. Check back closer to the event.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teams.map((t) => {
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
                        <h4 className="font-bold text-base truncate text-slate-100">{t.name}</h4>
                        {scored && (
                          <span className="text-xs px-2 py-0.5 rounded bg-lime-500/20 text-lime-300 border border-lime-500/40 shrink-0">
                            ✓ Scored
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 truncate">
                        Mentor: {t.mentor_name || '—'} · {t.members.length} member{t.members.length === 1 ? '' : 's'}
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
            )}
          </div>
        )}
      </main>
    </div>
  );
}


// ===== Inline Scorecard — mobile-first =====

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
    setScores((prev) => {
      const next = { ...prev };
      for (const a of axes) if (!(a.key in next)) next[a.key] = existing?.scores?.[a.key] ?? 0;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes.length]);

  const total = axes.reduce((s, a) => s + (scores[a.key] || 0), 0);
  const maxTotal = axes.length * 10;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await submitJudgeScore({ judge_id: judgeId, team_id: team.id, round, scores, comment: comment.trim() || null });
      await onSubmitted();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetScore = async () => {
    if (!existing) return;
    if (!confirm(`Reset your score for "${team.name}" in Round ${round}?`)) return;
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
    <div className="bg-ink-800/60 border border-sky-500/40 rounded-xl p-4 sm:p-5 space-y-4">
      <div>
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-white mb-2">← Back to team list</button>
        <h3 className="text-xl sm:text-2xl font-extrabold text-slate-100">{team.name}</h3>
        <p className="text-xs text-slate-400 mt-1">
          Mentor: {team.mentor_name || '—'} · {team.members.length} member{team.members.length === 1 ? '' : 's'} · Round {round}
        </p>
        {existing && (
          <span className="inline-block mt-2 text-xs px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">
            Editing existing score · {existing.total}/{maxTotal}
          </span>
        )}
      </div>

      {team.ai_scores?.summary && (
        <div className="bg-sky-500/5 border border-sky-500/30 rounded-lg p-3 sm:p-4">
          <h4 className="text-xs uppercase tracking-wider text-sky-300 font-bold mb-2">Quick brief</h4>
          <p className="text-sm text-slate-100 leading-relaxed">{team.ai_scores.summary}</p>
        </div>
      )}

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

      {/* Rubric — mobile-friendly: label on its own line, slider below, big number on right */}
      <div className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-400">Scorecard · each axis out of 10</h4>
        {axes.map((a) => {
          const v = scores[a.key] || 0;
          return (
            <div key={a.key} className="bg-ink-900/50 rounded px-3 py-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-slate-100">{a.label}</label>
                <div className="text-2xl font-extrabold text-sky-300 w-10 text-right">{v}</div>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={v}
                onChange={(e) => setScores({ ...scores, [a.key]: parseInt(e.target.value) })}
                className="w-full accent-sky-400"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 px-0.5">
                {[0, 2, 4, 6, 8, 10].map((mark) => (
                  <span key={mark} className={v >= mark ? 'text-sky-300' : ''}>{mark}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

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

      <div className="pt-3 border-t border-slate-700/40 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-slate-400">Your total</span>
          <div className="text-3xl font-extrabold text-sky-300">
            {total}<span className="text-base text-slate-500">/{maxTotal}</span>
          </div>
        </div>
        {err && <div className="text-sm text-rose-300">{err}</div>}
        <div className="flex gap-2 flex-wrap">
          {existing && (
            <button
              onClick={resetScore}
              disabled={busy}
              className="text-xs px-3 py-2 rounded font-semibold bg-ink-900 border border-rose-500/30 hover:border-rose-500/60 text-rose-300 transition"
            >
              Reset score
            </button>
          )}
          <button
            onClick={onBack}
            className="flex-1 sm:flex-none px-4 py-2 rounded text-sm font-semibold bg-ink-900 border border-slate-700/40 hover:border-slate-500 text-slate-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 sm:flex-none bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-5 py-2 rounded text-sm transition"
          >
            {busy ? 'Submitting…' : existing ? 'Update score' : 'Submit score'}
          </button>
        </div>
      </div>
    </div>
  );
}
