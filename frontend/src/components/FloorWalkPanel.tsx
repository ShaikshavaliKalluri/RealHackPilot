import { useEffect, useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { Team } from '../types';
import {
  fetchVisitsByTeam,
  fetchVisitsStats,
  markVisit,
  unmarkVisit,
  updateVisitNotes,
  type JudgeVisit,
  type JudgeVisitsStats,
} from '../api';

/**
 * Floor walk tracker — group-walk version. The judges walk in groups,
 * each escorted by ONE organizer who's responsible for one floor. So
 * the workflow is:
 *
 *   1. Organizer picks their floor (5th / 9th / 10th) from the filter
 *      pills -- the team list narrows to just that floor.
 *   2. They walk team-to-team with the judge group.
 *   3. At each team's desk: tap '+ Add visit' -> a small modal pops
 *      open with just an optional comments textarea + 'Mark visit'.
 *      No judge picker -- whoever's in the group at the time is
 *      implicit. The audit log records the organizer's email + the
 *      timestamp.
 *   4. Same team can be visited again later (Day 2 or by a different
 *      group on Day 1) -- each tap appends a new audit-log row.
 *
 * Click an existing visit-count chip to expand the audit log: every
 * visit shown with timestamp, organizer, and the comment. Per-visit
 * Edit + × controls.
 *
 * Per-floor stats at the top: how many teams sit on each floor and
 * how many have been visited at least once. Helps the floor leads
 * see coverage at a glance.
 */

interface Props {
  teams: Team[];
}

const FLOORS = ['5th', '9th', '10th'] as const;
type FloorFilter = 'all' | typeof FLOORS[number] | 'unset';

export function FloorWalkPanel({ teams }: Props) {
  const [visitsByTeam, setVisitsByTeam] = useState<Record<number, JudgeVisit[]>>({});
  const [stats, setStats] = useState<JudgeVisitsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [floor, setFloor] = useState<FloorFilter>('all');

  // Per-action busy keys.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  // Add-visit modal state.
  const [modalForTeam, setModalForTeam] = useState<number | null>(null);
  const [modalComment, setModalComment] = useState('');
  const [modalBusy, setModalBusy] = useState(false);

  // Audit log expansion (one team at a time).
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);

  // Per-visit notes editing.
  const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  // When set, opens a modal showing a large QR for that team -- judges
  // standing in front of the organizer's phone scan from the bigger QR.
  const [zoomQrForTeam, setZoomQrForTeam] = useState<number | null>(null);

  // Public origin for the QR URL. Falls back to current host so this works
  // in test/preview environments without env-var configuration.
  const publicOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [vbt, st] = await Promise.all([fetchVisitsByTeam(), fetchVisitsStats()]);
      setVisitsByTeam(vbt.by_team);
      setStats(st);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Per-floor totals + visited counts. A team has been "visited" if it has
  // at least one row in judge_visits, regardless of whether a judge was
  // tagged on that row.
  const perFloorCounts = useMemo(() => {
    const counts: Record<string, { total: number; visited: number }> = {};
    for (const f of [...FLOORS, 'unset']) counts[f] = { total: 0, visited: 0 };
    for (const t of teams) {
      const key = t.seat_floor ?? 'unset';
      const bucket = counts[key] ?? counts['unset'];
      bucket.total += 1;
      if ((visitsByTeam[t.id]?.length ?? 0) > 0) bucket.visited += 1;
    }
    return counts;
  }, [teams, visitsByTeam]);

  // Sort: unvisited first (organizer's attention), then descending by visit
  // count, then alphabetical. Filter by floor + search.
  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = teams.slice();
    if (floor !== 'all') {
      list = list.filter((t) => (t.seat_floor ?? 'unset') === floor);
    }
    if (q) {
      list = list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        (t.mentor_name ?? '').toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const va = visitsByTeam[a.id]?.length ?? 0;
      const vb = visitsByTeam[b.id]?.length ?? 0;
      if (va !== vb) {
        if (va === 0 && vb > 0) return -1;
        if (vb === 0 && va > 0) return 1;
        return vb - va;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [teams, visitsByTeam, search, floor]);

  const openAddVisit = (teamId: number) => {
    setModalForTeam(teamId);
    setModalComment('');
    setErr(null);
  };

  const handleSubmitAddVisit = async () => {
    if (modalForTeam == null) return;
    setModalBusy(true);
    setErr(null);
    const comment = modalComment.trim() || null;
    // Optimistic: insert a temp row so the chip count updates instantly.
    const tempVisit: JudgeVisit = {
      id: -Date.now(),
      team_id: modalForTeam,
      judge_id: null,
      judge_name: null,
      visited_at: new Date().toISOString(),
      marked_by_email: null,
      notes: comment,
    };
    setVisitsByTeam((prev) => ({
      ...prev,
      [modalForTeam]: [...(prev[modalForTeam] ?? []), tempVisit],
    }));
    try {
      const saved = await markVisit(modalForTeam, null, comment);
      setVisitsByTeam((prev) => ({
        ...prev,
        [modalForTeam]: (prev[modalForTeam] ?? []).map((v) => (v.id === tempVisit.id ? saved : v)),
      }));
      fetchVisitsStats().then(setStats).catch(() => {});
      setModalForTeam(null);
      setModalComment('');
    } catch (e: any) {
      setVisitsByTeam((prev) => ({
        ...prev,
        [modalForTeam]: (prev[modalForTeam] ?? []).filter((v) => v.id !== tempVisit.id),
      }));
      setErr(e.message || String(e));
    } finally {
      setModalBusy(false);
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

  const modalTeam = modalForTeam != null ? teams.find((t) => t.id === modalForTeam) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Date banner — judging is on June 24-25, distinct from the coding
          event which ran on June 18-19. Surfaces here so organizers landing
          on the tab during the gap days see the relevant dates immediately. */}
      <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 font-bold">
          Judging
        </span>
        <span className="text-emerald-100 font-semibold">June 24-25, 2026</span>
        <span className="text-slate-400">· Floor walk by judge groups · One organizer per floor</span>
      </div>

      {/* Per-floor coverage tiles -- one tile per floor showing
          'visited / total' so floor leads can see their progress at a glance. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FLOORS.map((f) => {
          const c = perFloorCounts[f] ?? { total: 0, visited: 0 };
          const pct = c.total > 0 ? Math.round((c.visited / c.total) * 100) : 0;
          return (
            <button
              key={f}
              onClick={() => setFloor(floor === f ? 'all' : f)}
              className={`text-left bg-ink-900/60 rounded-xl p-3 sm:p-4 border-2 transition ${
                floor === f
                  ? 'border-lime-500/70 bg-lime-500/10'
                  : 'border-transparent hover:border-slate-700'
              }`}
            >
              <div className="text-xl sm:text-2xl font-extrabold text-slate-100">
                {c.visited}<span className="text-slate-500 text-base font-normal"> / {c.total}</span>
              </div>
              <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400">
                {f} floor · {pct}% visited
              </div>
            </button>
          );
        })}
        {/* Unset bucket only shows if any teams lack a seat_floor */}
        {perFloorCounts['unset']?.total > 0 && (
          <button
            onClick={() => setFloor(floor === 'unset' ? 'all' : 'unset')}
            className={`text-left bg-ink-900/60 rounded-xl p-3 sm:p-4 border-2 transition ${
              floor === 'unset'
                ? 'border-amber-500/70 bg-amber-500/10'
                : 'border-transparent hover:border-slate-700'
            }`}
          >
            <div className="text-xl sm:text-2xl font-extrabold text-amber-300">
              {perFloorCounts['unset'].visited}<span className="text-slate-500 text-base font-normal"> / {perFloorCounts['unset'].total}</span>
            </div>
            <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400">
              Floor not set
            </div>
          </button>
        )}
      </div>

      {/* Active filter pill row + clear */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">Floor:</span>
        <button
          onClick={() => setFloor('all')}
          className={`px-2.5 py-1 rounded-full font-semibold transition border ${
            floor === 'all'
              ? 'bg-sky-500/20 border-sky-500/60 text-sky-200'
              : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
          }`}
        >
          All ({teams.length})
        </button>
        {FLOORS.map((f) => (
          <button
            key={f}
            onClick={() => setFloor(f)}
            className={`px-2.5 py-1 rounded-full font-semibold transition border ${
              floor === f
                ? 'bg-lime-500/20 border-lime-500/60 text-lime-200'
                : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            {f} ({perFloorCounts[f]?.total ?? 0})
          </button>
        ))}
        {perFloorCounts['unset']?.total > 0 && (
          <button
            onClick={() => setFloor('unset')}
            className={`px-2.5 py-1 rounded-full font-semibold transition border ${
              floor === 'unset'
                ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
            }`}
          >
            Unset ({perFloorCounts['unset'].total})
          </button>
        )}
      </div>

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

      {/* Overall stats sub-line */}
      {stats && (
        <div className="text-xs text-slate-500">
          Showing {filteredTeams.length} of {teams.length} teams · {stats.teams_with_any_visit} visited overall · {stats.total_visits} total visit events logged
        </div>
      )}

      {/* Team list */}
      <div className="space-y-2">
        {filteredTeams.map((t) => {
          const visits = (visitsByTeam[t.id] ?? []).slice().sort((a, b) =>
            (a.visited_at < b.visited_at ? 1 : -1), // newest first
          );
          const count = visits.length;
          const isExpanded = expandedTeam === t.id;
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
                    {t.seat_floor && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-700/40 text-slate-300 border border-slate-600/50">
                        {t.seat_floor} floor
                        {t.seat_desk && <span> · {t.seat_desk}</span>}
                      </span>
                    )}
                    <button
                      onClick={() => setExpandedTeam(isExpanded ? null : t.id)}
                      className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition ${
                        count === 0
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                          : 'border-lime-500/40 bg-lime-500/15 text-lime-200 hover:bg-lime-500/25'
                      }`}
                    >
                      {count} visit{count === 1 ? '' : 's'} {count > 0 && (isExpanded ? '▴' : '▾')}
                    </button>
                  </div>
                  {t.mentor_name && (
                    <div className="text-xs text-slate-500 mt-0.5">Mentor: {t.mentor_name}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Inline QR -- judges scan to land on /team/<id>.
                      Tap to enlarge for easier scanning. */}
                  <button
                    onClick={() => setZoomQrForTeam(t.id)}
                    className="bg-white p-1.5 rounded-md hover:ring-2 hover:ring-lime-400 transition"
                    title="Tap to enlarge — judges can scan to open the team page"
                  >
                    <QRCodeCanvas
                      value={`${publicOrigin}/team/${t.id}`}
                      size={72}
                      bgColor="#ffffff"
                      fgColor="#0a4f99"
                      level="M"
                    />
                  </button>
                  <button
                    onClick={() => openAddVisit(t.id)}
                    className="bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
                  >
                    + Add visit
                  </button>
                </div>
              </div>

              {/* Audit log -- newest first, with edit / remove + comments */}
              {isExpanded && count > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-1.5">
                  {visits.map((v) => {
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
                            {v.judge_name && (
                              <span className="text-lime-300"> · {v.judge_name}</span>
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
                              placeholder="Judges' comment, observation, feedback…"
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
                  <button
                    onClick={() => setExpandedTeam(null)}
                    className="text-xs text-slate-500 hover:text-slate-300 pt-1"
                  >
                    Collapse
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filteredTeams.length === 0 && (
          <p className="text-slate-400 text-sm italic">No teams match the current filters.</p>
        )}
      </div>

      {/* QR zoom modal — big QR for judges to scan from the organizer's screen */}
      {zoomQrForTeam != null && (() => {
        const t = teams.find((x) => x.id === zoomQrForTeam);
        if (!t) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setZoomQrForTeam(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full text-center"
            >
              <div className="text-2xl font-extrabold text-[#0a4f99] mb-1">{t.name}</div>
              {t.seat_floor && (
                <div className="text-sm text-slate-600 mb-4">
                  {t.seat_floor} floor{t.seat_desk && <> · Desk {t.seat_desk}</>}
                </div>
              )}
              <div className="flex justify-center mb-4">
                <QRCodeCanvas
                  value={`${publicOrigin}/team/${t.id}`}
                  size={280}
                  bgColor="#ffffff"
                  fgColor="#0a4f99"
                  level="M"
                  includeMargin
                />
              </div>
              <div className="text-xs text-slate-500 break-all mb-4">
                {publicOrigin}/team/{t.id}
              </div>
              <button
                onClick={() => setZoomQrForTeam(null)}
                className="bg-[#0a4f99] hover:bg-[#0a4f99]/90 text-white font-bold px-5 py-2 rounded-lg text-sm transition"
              >
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* Add-visit modal -- simple comment + Mark */}
      {modalForTeam != null && modalTeam && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setModalForTeam(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-ink-800 border border-lime-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
          >
            <div className="bg-gradient-to-br from-lime-500/20 to-emerald-500/10 p-4 border-b border-lime-500/40">
              <h3 className="font-bold text-lime-200">Add visit — {modalTeam.name}</h3>
              {modalTeam.seat_floor && (
                <p className="text-xs text-slate-300 mt-0.5">
                  {modalTeam.seat_floor} floor
                  {modalTeam.seat_desk && <> · Desk {modalTeam.seat_desk}</>}
                </p>
              )}
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                Comments (optional)
              </label>
              <textarea
                value={modalComment}
                onChange={(e) => setModalComment(e.target.value)}
                placeholder="What did the judges say? Feedback, observations, follow-ups…"
                rows={4}
                autoFocus
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSubmitAddVisit}
                  disabled={modalBusy}
                  className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2.5 rounded-lg text-sm transition"
                >
                  {modalBusy ? 'Saving…' : 'Mark visit'}
                </button>
                <button
                  onClick={() => setModalForTeam(null)}
                  className="text-sm text-slate-400 hover:text-white px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
