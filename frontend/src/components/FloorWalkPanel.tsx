import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge } from '../types';
import {
  fetchJudges,
  fetchVisitsByTeam,
  fetchVisitsStats,
  markVisit,
  unmarkVisit,
  type JudgeVisit,
  type JudgeVisitsStats,
} from '../api';

/**
 * Floor walk tracker. Organizers stand at each team's desk during the
 * Round 1 walk and tap to mark which judges have stopped by. Designed
 * for mobile-first use -- big touch targets, minimal nav, optimistic
 * updates so a slow Graph call doesn't block the next tap.
 *
 * Per-team workflow:
 *   1. Search / scroll to the team you're standing at.
 *   2. Card shows N judges visited + a chip per judge already marked.
 *   3. Tap 'Add visit' -> picker overlay with searchable judge list.
 *   4. Tap a judge name -> they're added; the picker stays open so a
 *      flurry of arrivals can all be marked in seconds.
 *   5. Tap an existing judge chip's × to undo a mistaken mark.
 *
 * All endpoints are organizer-only at the API; this panel is also
 * hidden from the nav for non-organizers.
 */

interface Props {
  teams: Team[];
}

export function FloorWalkPanel({ teams }: Props) {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [visitsByTeam, setVisitsByTeam] = useState<Record<number, JudgeVisit[]>>({});
  const [stats, setStats] = useState<JudgeVisitsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Per-team busy set so multiple tap interactions can be in-flight at
  // once without flickering a single global spinner. Keyed by 'teamid:judgeid'.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  // Picker overlay state: when set, opens the 'add visit' modal for that team.
  const [pickerForTeam, setPickerForTeam] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [js, vbt, st] = await Promise.all([
        fetchJudges(),
        fetchVisitsByTeam(),
        fetchVisitsStats(),
      ]);
      setJudges(js);
      setVisitsByTeam(vbt.by_team);
      setStats(st);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const judgesById = useMemo(() => {
    const m = new Map<number, Judge>();
    for (const j of judges) m.set(j.id, j);
    return m;
  }, [judges]);

  // Sort: teams that have NO visits yet first (organizer's attention),
  // then by visit count descending, then alphabetical.
  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => {
      const va = visitsByTeam[a.id]?.length ?? 0;
      const vb = visitsByTeam[b.id]?.length ?? 0;
      if (va !== vb) {
        // 0-visit teams first, then descending by visits
        if (va === 0 && vb > 0) return -1;
        if (vb === 0 && va > 0) return 1;
        return vb - va;
      }
      return a.name.localeCompare(b.name);
    });
  }, [teams, visitsByTeam]);

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedTeams;
    return sortedTeams.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.mentor_name ?? '').toLowerCase().includes(q),
    );
  }, [sortedTeams, search]);

  const handleMark = async (teamId: number, judgeId: number) => {
    const key = `${teamId}:${judgeId}`;
    setBusyKeys((s) => new Set(s).add(key));
    setErr(null);
    // Optimistic update -- add the visit locally so the chip appears
    // instantly, then reconcile with the server response.
    const tempVisit: JudgeVisit = {
      id: -Date.now(),
      team_id: teamId,
      judge_id: judgeId,
      judge_name: judgesById.get(judgeId)?.name ?? null,
      visited_at: new Date().toISOString(),
      marked_by_email: null,
    };
    setVisitsByTeam((prev) => ({
      ...prev,
      [teamId]: [...(prev[teamId] ?? []).filter((v) => v.judge_id !== judgeId), tempVisit],
    }));
    try {
      const saved = await markVisit(teamId, judgeId);
      // Replace the optimistic row with the server-confirmed one.
      setVisitsByTeam((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).map((v) => (v.judge_id === judgeId ? saved : v)),
      }));
      // Refresh stats lazily -- don't block the next tap on this.
      fetchVisitsStats().then(setStats).catch(() => {});
    } catch (e: any) {
      // Roll back the optimistic update on failure.
      setVisitsByTeam((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).filter((v) => v.judge_id !== judgeId),
      }));
      setErr(e.message || String(e));
    } finally {
      setBusyKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  const handleUnmark = async (teamId: number, judgeId: number) => {
    const key = `${teamId}:${judgeId}`;
    setBusyKeys((s) => new Set(s).add(key));
    setErr(null);
    const prevList = visitsByTeam[teamId] ?? [];
    setVisitsByTeam((prev) => ({
      ...prev,
      [teamId]: (prev[teamId] ?? []).filter((v) => v.judge_id !== judgeId),
    }));
    try {
      await unmarkVisit(teamId, judgeId);
      fetchVisitsStats().then(setStats).catch(() => {});
    } catch (e: any) {
      setVisitsByTeam((prev) => ({ ...prev, [teamId]: prevList }));
      setErr(e.message || String(e));
    } finally {
      setBusyKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  if (loading && Object.keys(visitsByTeam).length === 0) {
    return <div className="text-slate-400 text-sm">Loading floor-walk data…</div>;
  }

  const pickerTeam = pickerForTeam != null ? teams.find((t) => t.id === pickerForTeam) ?? null : null;
  const pickerVisitedIds = pickerForTeam != null
    ? new Set((visitsByTeam[pickerForTeam] ?? []).map((v) => v.judge_id))
    : new Set<number>();
  const pickerFilteredJudges = (() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return judges;
    return judges.filter((j) =>
      j.name.toLowerCase().includes(q) ||
      (j.email ?? '').toLowerCase().includes(q),
    );
  })();

  return (
    <div className="space-y-4">
      {/* Stats tiles */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Teams" value={stats.total_teams} />
          <Tile
            label="Visited (≥1 judge)"
            value={stats.teams_with_any_visit}
            tone="text-lime-300"
          />
          <Tile
            label="No visits yet"
            value={stats.teams_with_zero_visits}
            tone={stats.teams_with_zero_visits > 0 ? 'text-amber-300' : 'text-slate-300'}
          />
          <Tile label="Total visits logged" value={stats.total_visits} tone="text-sky-300" />
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search team or mentor name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-ink-900 border border-slate-700/40 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-lime-500/60"
      />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-3 text-sm text-rose-200">
          ⚠ {err}
        </div>
      )}

      {/* Team list -- 0-visit first, then descending by count */}
      <div className="space-y-2">
        {filteredTeams.map((t) => {
          const visits = visitsByTeam[t.id] ?? [];
          const count = visits.length;
          return (
            <div
              key={t.id}
              className={`rounded-xl border p-3 sm:p-4 ${
                count === 0
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-ink-800/60 border-slate-700/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-100 text-base">{t.name}</h4>
                    <span className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
                      count === 0
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                        : 'border-lime-500/40 bg-lime-500/15 text-lime-200'
                    }`}>
                      {count} visit{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  {t.mentor_name && (
                    <div className="text-xs text-slate-500 mt-0.5">Mentor: {t.mentor_name}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setPickerForTeam(t.id);
                    setPickerSearch('');
                  }}
                  className="bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
                >
                  + Add visit
                </button>
              </div>
              {/* Existing visits as chips. × removes. */}
              {visits.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {visits.map((v) => {
                    const key = `${v.team_id}:${v.judge_id}`;
                    const busy = busyKeys.has(key);
                    return (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-lime-500/40 bg-lime-500/10 text-lime-200"
                        title={`Marked ${v.visited_at ? new Date(v.visited_at).toLocaleString() : ''}${v.marked_by_email ? ` by ${v.marked_by_email}` : ''}`}
                      >
                        <span className="font-semibold">{v.judge_name ?? `Judge #${v.judge_id}`}</span>
                        <button
                          onClick={() => handleUnmark(v.team_id, v.judge_id)}
                          disabled={busy}
                          className="text-slate-400 hover:text-rose-300 disabled:opacity-40 -mr-0.5"
                          title="Remove this visit"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {filteredTeams.length === 0 && (
          <p className="text-slate-400 text-sm italic">No teams match "{search}".</p>
        )}
      </div>

      {/* Add-visit picker modal */}
      {pickerForTeam != null && pickerTeam && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPickerForTeam(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-ink-800 border border-lime-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="bg-gradient-to-br from-lime-500/20 to-emerald-500/10 p-4 border-b border-lime-500/40">
              <h3 className="font-bold text-lime-200">Add visit — {pickerTeam.name}</h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Tap a judge name to mark them as visited. Already-marked judges show ✓.
              </p>
            </div>
            <div className="p-3 border-b border-slate-700/40">
              <input
                type="text"
                placeholder="Search judges…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                autoFocus
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {pickerFilteredJudges.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No judges match.</p>
              ) : (
                pickerFilteredJudges.map((j) => {
                  const already = pickerVisitedIds.has(j.id);
                  const key = `${pickerForTeam}:${j.id}`;
                  const busy = busyKeys.has(key);
                  return (
                    <button
                      key={j.id}
                      onClick={() => {
                        if (already || busy) return;
                        handleMark(pickerForTeam, j.id);
                      }}
                      disabled={already || busy}
                      className={`w-full text-left px-3 py-2.5 rounded transition flex items-center justify-between gap-2 ${
                        already
                          ? 'bg-lime-500/15 border border-lime-500/40 text-lime-200 cursor-not-allowed'
                          : 'bg-ink-900/40 border border-slate-700/40 text-slate-200 hover:border-lime-500/60 hover:bg-lime-500/5'
                      }`}
                    >
                      <span>
                        <span className="font-semibold">{j.name}</span>
                        {j.email && <span className="text-slate-500 ml-2 text-xs">{j.email}</span>}
                      </span>
                      {already && <span className="text-lime-400 font-bold">✓ Visited</span>}
                      {busy && <span className="text-slate-400 text-xs">Saving…</span>}
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-3 border-t border-slate-700/40 text-right">
              <button
                onClick={() => setPickerForTeam(null)}
                className="text-sm text-slate-300 hover:text-white px-3 py-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'text-slate-100' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-ink-900/60 rounded-xl p-3 sm:p-4 flex flex-col gap-1">
      <div className={`text-xl sm:text-2xl font-extrabold ${tone}`}>{value}</div>
      <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}
