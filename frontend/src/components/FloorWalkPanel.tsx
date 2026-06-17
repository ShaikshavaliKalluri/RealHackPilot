import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge } from '../types';
import {
  fetchJudges,
  fetchVisitsByTeam,
  fetchVisitsStats,
  markVisit,
  unmarkVisit,
  updateVisitNotes,
  type JudgeVisit,
  type JudgeVisitsStats,
} from '../api';

/**
 * Floor walk tracker. Organizers stand at each team's desk during the
 * Round 1 walk and tap to mark which judges have stopped by, optionally
 * with a comment captured from the judge. Designed for mobile-first use.
 *
 * Audit-log semantic: each call to /api/visits inserts a new row. The same
 * judge visiting a team on Day 1 AND Day 2 produces TWO rows, so the
 * timeline of when each visit happened is preserved. The on-screen chip
 * groups visits per (judge, team) for compact display -- expand the team
 * row to see the per-visit timeline.
 *
 * Workflow at the desk:
 *   1. Search / scroll to the team.
 *   2. Tap "+ Add visit" -> picker overlay opens.
 *   3. Tap a judge name -> the row expands inline with a "Comments (optional)"
 *      textarea + "Mark visit" button. Hitting Mark inserts the row.
 *   4. Repeat for the next judge -- modal stays open for a flurry.
 *   5. On the team card, each unique judge appears as a chip with a visit
 *      count badge if visited more than once. Click the chip to expand the
 *      audit log: list of visits with timestamp, comment, and per-visit ✏ /
 *      × controls.
 *
 * All endpoints are organizer-only at the API.
 */

interface Props {
  teams: Team[];
}

interface GroupedVisits {
  judge_id: number;
  judge_name: string | null;
  visits: JudgeVisit[]; // sorted by visited_at ascending
}

function groupByJudge(visits: JudgeVisit[]): GroupedVisits[] {
  const m = new Map<number, GroupedVisits>();
  for (const v of visits) {
    let g = m.get(v.judge_id);
    if (!g) {
      g = { judge_id: v.judge_id, judge_name: v.judge_name, visits: [] };
      m.set(v.judge_id, g);
    }
    g.visits.push(v);
  }
  for (const g of m.values()) {
    g.visits.sort((a, b) => (a.visited_at < b.visited_at ? -1 : 1));
    if (!g.judge_name) g.judge_name = g.visits[0]?.judge_name ?? null;
  }
  return Array.from(m.values()).sort((a, b) =>
    (a.judge_name ?? '').localeCompare(b.judge_name ?? ''),
  );
}

export function FloorWalkPanel({ teams }: Props) {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [visitsByTeam, setVisitsByTeam] = useState<Record<number, JudgeVisit[]>>({});
  const [stats, setStats] = useState<JudgeVisitsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Per-action busy keys -- keyed on visit_id for unmark/edit, or
  // 'pick:<teamid>:<judgeid>' for in-flight picker marks.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  // Picker modal state.
  const [pickerForTeam, setPickerForTeam] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelectedJudge, setPickerSelectedJudge] = useState<number | null>(null);
  const [pickerComment, setPickerComment] = useState('');
  // Which team's audit log is currently expanded inline (one at a time
  // to keep mobile scroll manageable).
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);
  // Which visit row is currently being edited (notes).
  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

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

  // Distinct-judge count per team -- this is the "how many judges visited"
  // number the organizer cares about (Day 1 + Day 2 by the same judge = 1).
  const distinctJudgeCount = (teamId: number): number => {
    const visits = visitsByTeam[teamId] ?? [];
    return new Set(visits.map((v) => v.judge_id)).size;
  };

  // Sort: 0-distinct-judge teams first (need attention), then descending by
  // distinct-judge count, then alphabetical by team name.
  const sortedTeams = useMemo(() => {
    return teams.slice().sort((a, b) => {
      const da = distinctJudgeCount(a.id);
      const db = distinctJudgeCount(b.id);
      if (da !== db) {
        if (da === 0 && db > 0) return -1;
        if (db === 0 && da > 0) return 1;
        return db - da;
      }
      return a.name.localeCompare(b.name);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, visitsByTeam]);

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedTeams;
    return sortedTeams.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.mentor_name ?? '').toLowerCase().includes(q),
    );
  }, [sortedTeams, search]);

  const handleMark = async (teamId: number, judgeId: number, comment: string | null) => {
    const key = `pick:${teamId}:${judgeId}`;
    setBusyKeys((s) => new Set(s).add(key));
    setErr(null);
    // Optimistic: insert a temp visit row so the chip count updates instantly.
    const tempVisit: JudgeVisit = {
      id: -Date.now(),
      team_id: teamId,
      judge_id: judgeId,
      judge_name: judgesById.get(judgeId)?.name ?? null,
      visited_at: new Date().toISOString(),
      marked_by_email: null,
      notes: comment,
    };
    setVisitsByTeam((prev) => ({
      ...prev,
      [teamId]: [...(prev[teamId] ?? []), tempVisit],
    }));
    try {
      const saved = await markVisit(teamId, judgeId, comment);
      setVisitsByTeam((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).map((v) => (v.id === tempVisit.id ? saved : v)),
      }));
      fetchVisitsStats().then(setStats).catch(() => {});
    } catch (e: any) {
      // Roll back the optimistic row.
      setVisitsByTeam((prev) => ({
        ...prev,
        [teamId]: (prev[teamId] ?? []).filter((v) => v.id !== tempVisit.id),
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

  const handleUnmarkVisit = async (visit: JudgeVisit) => {
    const key = `del:${visit.id}`;
    setBusyKeys((s) => new Set(s).add(key));
    setErr(null);
    const prevList = visitsByTeam[visit.team_id] ?? [];
    setVisitsByTeam((prev) => ({
      ...prev,
      [visit.team_id]: (prev[visit.team_id] ?? []).filter((v) => v.id !== visit.id),
    }));
    try {
      await unmarkVisit(visit.id);
      fetchVisitsStats().then(setStats).catch(() => {});
    } catch (e: any) {
      setVisitsByTeam((prev) => ({ ...prev, [visit.team_id]: prevList }));
      setErr(e.message || String(e));
    } finally {
      setBusyKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSaveNotes = async (visit: JudgeVisit) => {
    const key = `edit:${visit.id}`;
    setBusyKeys((s) => new Set(s).add(key));
    setErr(null);
    const draft = notesDraft;
    // Optimistic update -- swap the local notes in immediately.
    setVisitsByTeam((prev) => ({
      ...prev,
      [visit.team_id]: (prev[visit.team_id] ?? []).map((v) =>
        v.id === visit.id ? { ...v, notes: draft.trim() || null } : v,
      ),
    }));
    setEditingVisitId(null);
    setNotesDraft('');
    try {
      await updateVisitNotes(visit.id, draft);
    } catch (e: any) {
      // Reload the team's visits from server on failure.
      setErr(e.message || String(e));
      fetchVisitsByTeam().then((r) => setVisitsByTeam(r.by_team)).catch(() => {});
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
  const pickerFilteredJudges = (() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return judges;
    return judges.filter((j) =>
      j.name.toLowerCase().includes(q) ||
      (j.email ?? '').toLowerCase().includes(q),
    );
  })();
  const pickerVisitCountByJudge = pickerForTeam != null
    ? (() => {
        const m = new Map<number, number>();
        for (const v of (visitsByTeam[pickerForTeam] ?? [])) {
          m.set(v.judge_id, (m.get(v.judge_id) ?? 0) + 1);
        }
        return m;
      })()
    : new Map<number, number>();

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
          <Tile label="Total visit events" value={stats.total_visits} tone="text-sky-300" />
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

      {/* Team list */}
      <div className="space-y-2">
        {filteredTeams.map((t) => {
          const visits = visitsByTeam[t.id] ?? [];
          const grouped = groupByJudge(visits);
          const distinctCount = grouped.length;
          const totalEvents = visits.length;
          const isExpanded = expandedTeam === t.id;
          return (
            <div
              key={t.id}
              className={`rounded-xl border p-3 sm:p-4 ${
                distinctCount === 0
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-ink-800/60 border-slate-700/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-100 text-base">{t.name}</h4>
                    <span className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
                      distinctCount === 0
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                        : 'border-lime-500/40 bg-lime-500/15 text-lime-200'
                    }`}>
                      {distinctCount} judge{distinctCount === 1 ? '' : 's'}
                      {totalEvents > distinctCount && (
                        <span className="text-lime-300/80 ml-1">· {totalEvents} events</span>
                      )}
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
                    setPickerSelectedJudge(null);
                    setPickerComment('');
                  }}
                  className="bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
                >
                  + Add visit
                </button>
              </div>
              {/* Judge chips. Click to expand audit-log section below. */}
              {grouped.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {grouped.map((g) => {
                    const hasNotes = g.visits.some((v) => (v.notes ?? '').trim().length > 0);
                    return (
                      <button
                        key={g.judge_id}
                        onClick={() => setExpandedTeam(isExpanded ? null : t.id)}
                        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition ${
                          isExpanded
                            ? 'border-lime-500/60 bg-lime-500/20 text-lime-100'
                            : 'border-lime-500/40 bg-lime-500/10 text-lime-200 hover:border-lime-500/60'
                        }`}
                        title="Click to view / edit visit timeline + notes"
                      >
                        <span className="font-semibold">{g.judge_name ?? `Judge #${g.judge_id}`}</span>
                        {g.visits.length > 1 && (
                          <span className="text-lime-300/90 font-bold">×{g.visits.length}</span>
                        )}
                        {hasNotes && <span title="Has notes">💬</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Audit-log expansion: per-judge timeline with notes + edit + remove */}
              {isExpanded && grouped.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-3">
                  {grouped.map((g) => (
                    <div key={g.judge_id} className="space-y-1.5">
                      <div className="text-xs font-bold text-slate-200">
                        {g.judge_name ?? `Judge #${g.judge_id}`}
                        <span className="text-slate-500 font-normal ml-2">
                          {g.visits.length} visit{g.visits.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {g.visits.map((v) => {
                        const editing = editingVisitId === v.id;
                        const busyDel = busyKeys.has(`del:${v.id}`);
                        const busyEdit = busyKeys.has(`edit:${v.id}`);
                        return (
                          <div key={v.id} className="bg-ink-900/40 rounded-lg p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="text-slate-400">
                                {v.visited_at ? new Date(v.visited_at).toLocaleString() : ''}
                                {v.marked_by_email && (
                                  <span className="text-slate-600"> · by {v.marked_by_email}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                {!editing && (
                                  <button
                                    onClick={() => {
                                      setEditingVisitId(v.id);
                                      setNotesDraft(v.notes ?? '');
                                    }}
                                    className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                                  >
                                    {v.notes ? 'Edit' : '+ Add note'}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleUnmarkVisit(v)}
                                  disabled={busyDel}
                                  className="text-[11px] px-2 py-0.5 rounded border border-rose-500/30 hover:border-rose-500/60 text-rose-300 disabled:opacity-40 transition"
                                  title="Remove this visit from the audit log"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            {editing ? (
                              <div className="space-y-1.5">
                                <textarea
                                  value={notesDraft}
                                  onChange={(e) => setNotesDraft(e.target.value)}
                                  placeholder="Judge's comment, observation, feedback…"
                                  rows={2}
                                  autoFocus
                                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-lime-500/60"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleSaveNotes(v)}
                                    disabled={busyEdit}
                                    className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-3 py-1 rounded text-[11px] transition"
                                  >
                                    {busyEdit ? 'Saving…' : 'Save note'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingVisitId(null);
                                      setNotesDraft('');
                                    }}
                                    className="text-[11px] text-slate-400 hover:text-white px-2 py-1"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : v.notes ? (
                              <div className="text-slate-300 italic">{v.notes}</div>
                            ) : (
                              <div className="text-slate-600 italic">No note.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <button
                    onClick={() => setExpandedTeam(null)}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Collapse
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filteredTeams.length === 0 && (
          <p className="text-slate-400 text-sm italic">No teams match "{search}".</p>
        )}
      </div>

      {/* ===== Add-visit picker modal ===== */}
      {pickerForTeam != null && pickerTeam && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPickerForTeam(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-ink-800 border border-lime-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="bg-gradient-to-br from-lime-500/20 to-emerald-500/10 p-4 border-b border-lime-500/40">
              <h3 className="font-bold text-lime-200">Add visit — {pickerTeam.name}</h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Tap a judge, optionally add a comment, then tap "Mark visit". Each tap inserts a new
                row in the audit log -- a judge visiting on Day 2 is a separate entry from Day 1.
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
                  const selected = pickerSelectedJudge === j.id;
                  const visitCount = pickerVisitCountByJudge.get(j.id) ?? 0;
                  return (
                    <div key={j.id}>
                      <button
                        onClick={() => {
                          if (selected) {
                            setPickerSelectedJudge(null);
                            setPickerComment('');
                          } else {
                            setPickerSelectedJudge(j.id);
                            // Don't clobber a typed comment when swapping judges --
                            // organizer may have started typing before tapping.
                          }
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded transition flex items-center justify-between gap-2 ${
                          selected
                            ? 'bg-lime-500/15 border-2 border-lime-500/70 text-lime-100'
                            : 'bg-ink-900/40 border-2 border-transparent text-slate-200 hover:bg-lime-500/5'
                        }`}
                      >
                        <span>
                          <span className="font-semibold">{j.name}</span>
                          {j.email && <span className="text-slate-500 ml-2 text-xs">{j.email}</span>}
                        </span>
                        {visitCount > 0 && (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-lime-500/40 bg-lime-500/10 text-lime-300 font-semibold">
                            {visitCount} prior visit{visitCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </button>
                      {/* Expand inline below the selected judge: comment + Mark */}
                      {selected && (
                        <div className="mt-2 mb-2 p-3 bg-ink-900/60 border border-lime-500/40 rounded-lg space-y-2">
                          <label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                            Comments (optional)
                          </label>
                          <textarea
                            value={pickerComment}
                            onChange={(e) => setPickerComment(e.target.value)}
                            placeholder={`What did ${j.name.split(' ')[0]} say? Observations, feedback, follow-ups…`}
                            rows={3}
                            className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                          />
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => {
                                const c = pickerComment.trim();
                                const judgeId = j.id;
                                handleMark(pickerForTeam, judgeId, c || null);
                                // Reset selection + comment so next judge can be marked quickly.
                                setPickerSelectedJudge(null);
                                setPickerComment('');
                              }}
                              disabled={busyKeys.has(`pick:${pickerForTeam}:${j.id}`)}
                              className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
                            >
                              Mark visit
                            </button>
                            <button
                              onClick={() => {
                                setPickerSelectedJudge(null);
                                setPickerComment('');
                              }}
                              className="text-sm text-slate-400 hover:text-white px-3 py-2"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
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
