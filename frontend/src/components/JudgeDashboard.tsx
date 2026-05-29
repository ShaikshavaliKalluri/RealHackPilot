import { useEffect, useMemo, useState } from 'react';
import type { Team, RubricAxis, JudgeScoreRecord } from '../types';
import {
  fetchRubric,
  fetchMyAssignedTeams,
  fetchTeamsForJudge,
  fetchMyAvailableRounds,
  fetchRoundsForJudge,
  fetchJudgeScores,
  submitJudgeScore,
  deleteJudgeScore,
  type UserProfile,
} from '../api';
import { UserBadge } from './UserBadge';
import { TeamCard } from './TeamCard';
import { ChatPanel } from './ChatPanel';

interface Props {
  judgeId: number;
  judgeName: string;
  user: UserProfile | null;
  // Preview mode: organizer is viewing AS this judge (banner shown).
  // When set, teams are fetched via /api/judges/{id}/teams instead of /me/teams.
  preview?: { onExit: () => void } | null;
}

type Filter = 'all' | 'scored' | 'pending';

export function JudgeDashboard({ judgeId, judgeName, user, preview }: Props) {
  const [round, setRound] = useState<number>(1);
  const [availableRounds, setAvailableRounds] = useState<number[]>([1]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [axes, setAxes] = useState<RubricAxis[]>([]);
  const [submittedScores, setSubmittedScores] = useState<JudgeScoreRecord[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchRubric().then((r) => setAxes(r.axes)).catch(() => {});
  }, []);

  // Fetch the rounds the judge actually has panels for. Round 2 stays hidden
  // until the organizer creates a Round 2 panel containing this judge + teams.
  useEffect(() => {
    const p = preview ? fetchRoundsForJudge(judgeId) : fetchMyAvailableRounds();
    p.then((rounds) => {
      const list = rounds.length > 0 ? rounds : [1];
      setAvailableRounds(list);
      // If the currently-selected round isn't in the list, snap back to the first available one
      if (!list.includes(round)) setRound(list[0]);
    }).catch(() => setAvailableRounds([1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgeId, preview]);

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

  const filteredTeams = useMemo(() => {
    let list = teams;
    if (filter === 'scored') list = list.filter((t) => scoredTeamIds.has(t.id));
    if (filter === 'pending') list = list.filter((t) => !scoredTeamIds.has(t.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.mentor_name && t.mentor_name.toLowerCase().includes(q)) ||
          (t.idea && t.idea.toLowerCase().includes(q)) ||
          t.members.some((m) => m.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [teams, filter, search, scoredTeamIds]);

  return (
    <div className="min-h-screen">
      {preview && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap text-amber-100">
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

      {/* Active scorecard view — full screen overlay */}
      {activeTeam ? (
        <div className="p-4 sm:p-8 max-w-3xl mx-auto">
          <Scorecard
            team={activeTeam}
            round={round}
            axes={axes}
            judgeId={judgeId}
            existing={existingForActive}
            onBack={() => setActiveTeamId(null)}
            onSubmitted={async () => { await reloadScores(); setActiveTeamId(null); }}
          />
        </div>
      ) : (
        <div className="p-4 sm:p-8 max-w-7xl mx-auto">
          <header className="mb-6 pb-5 border-b border-slate-800/60">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <img src="/realhack-logo.png" alt="RealHack 2026" className="h-12 sm:h-14 -ml-1" />
              {user && <UserBadge user={user} />}
            </div>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Judge <span className="text-sky-300">Scorecard</span>
                </h1>
                <p className="text-slate-400 mt-2 text-sm">
                  Welcome <span className="text-slate-200 font-semibold">{judgeName}</span>. Pick a team to score against the rubric. Each judge submits once per team per round.
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-slate-400">Round {round}</div>
                <div className="text-lg font-bold text-sky-300">
                  {scoredTeamIds.size}
                  <span className="text-slate-500 font-normal text-sm"> / {teams.length} scored</span>
                </div>
              </div>
            </div>
          </header>

          {err && (
            <div className="mb-5 bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
              {err}
            </div>
          )}

          {/* Round + Filter + Search controls */}
          <section className="flex flex-wrap gap-3 items-center mb-5">
            {availableRounds.length > 1 ? (
              <div className="flex gap-1 bg-ink-900/40 border border-slate-800/60 rounded-lg p-1">
                {availableRounds.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setRound(r); setActiveTeamId(null); }}
                    className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition border ${round === r ? 'bg-sky-500/15 text-sky-200 border-sky-500/30' : 'text-slate-400 hover:text-white border-transparent hover:bg-ink-800/60'}`}
                  >
                    Round {r}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Round {availableRounds[0] ?? 1}
                <span className="ml-1.5 text-slate-600">· Round 2 unlocks once organizers create a panel for it</span>
              </div>
            )}
            <div className="flex gap-1 bg-ink-800/60 border border-slate-700/40 rounded-lg p-1">
              {(['all', 'pending', 'scored'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded text-sm font-semibold capitalize transition ${
                    filter === f ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[240px]">
              <input
                type="text"
                placeholder="Search team, member, mentor, or idea…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-ink-800/60 border border-slate-700/40 rounded-lg px-4 py-2 pr-9 text-sm focus:outline-none focus:border-lime-500/60"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700/60 transition text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
            <span className="text-sm text-slate-400">
              {filteredTeams.length} of {teams.length}
            </span>
          </section>

          {loading ? (
            <div className="text-slate-400">Loading your assigned teams…</div>
          ) : teams.length === 0 ? (
            <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-10 text-center text-slate-400">
              <h3 className="font-bold text-slate-100 mb-2">No teams assigned to you for Round {round} yet</h3>
              <p className="text-sm">The organizers will assign teams to you shortly. Check back closer to the event.</p>
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-10 text-center text-slate-400">
              <p className="text-sm">No teams match the current filter.</p>
            </div>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              {filteredTeams.map((t) => {
                const scored = scoredTeamIds.has(t.id);
                return (
                  <div key={t.id} className={`relative rounded-xl ${scored ? 'ring-2 ring-lime-500/50' : ''}`}>
                    {scored && (
                      <span className="absolute -top-2 -left-2 z-10 text-[10px] px-2 py-0.5 rounded-full bg-lime-500 text-ink-950 border-2 border-ink-950 font-bold uppercase tracking-wider shadow-lg shadow-lime-500/40">
                        ✓ Scored
                      </span>
                    )}
                    <TeamCard
                      team={t}
                      expanded={false}
                      onToggle={() => setActiveTeamId(t.id)}
                    />
                  </div>
                );
              })}
            </section>
          )}

          {/* Chatbot — same one organizers have, scoped to the judge's assigned teams */}
          <ChatPanel
            teams={teams}
            onJumpToTeam={(id) => setActiveTeamId(id)}
          />
        </div>
      )}
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
