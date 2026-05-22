import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge } from '../types';
import {
  fetchJudges,
  createJudge,
  updateJudge,
  deleteJudge,
  PROTECTED_JUDGE_EMAILS,
  fetchPanels,
  createPanel,
  renamePanel,
  deletePanel,
  setPanelTeams,
  setPanelJudges,
  type Panel,
} from '../api';

interface Props {
  teams: Team[];
}

export function JudgesPanel({ teams }: Props) {
  // ===== Judges directory =====
  const [judges, setJudges] = useState<Judge[]>([]);
  const [judgesLoading, setJudgesLoading] = useState(false);

  // Add-judge form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'judge' | 'organizer'>('judge');
  const [adding, setAdding] = useState(false);

  // ===== Panels =====
  const [round, setRound] = useState<number>(1);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [editingPanelId, setEditingPanelId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<'teams' | 'judges'>('teams');
  const [editTeamIds, setEditTeamIds] = useState<Set<number>>(new Set());
  const [editJudgeIds, setEditJudgeIds] = useState<Set<number>>(new Set());
  const [editSearch, setEditSearch] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [err, setErr] = useState<string | null>(null);

  // Random-distribute wizard state
  const [distributeOpen, setDistributeOpen] = useState(false);

  const reloadJudges = async () => {
    setJudgesLoading(true);
    try {
      setJudges(await fetchJudges());
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setJudgesLoading(false);
    }
  };

  const reloadPanels = async () => {
    setPanelsLoading(true);
    try {
      setPanels(await fetchPanels(round));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setPanelsLoading(false);
    }
  };

  useEffect(() => { reloadJudges(); }, []);
  useEffect(() => { reloadPanels(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [round]);

  const handleAddJudge = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setAdding(true); setErr(null);
    try {
      await createJudge(newName.trim(), newEmail.trim().toLowerCase(), newRole);
      setNewName(''); setNewEmail(''); setNewRole('judge');
      await reloadJudges();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setAdding(false);
    }
  };

  const isProtected = (email: string | null | undefined): boolean =>
    PROTECTED_JUDGE_EMAILS.has((email || '').trim().toLowerCase());

  const handleToggleRole = async (j: Judge) => {
    setErr(null);
    const nextRole = j.role === 'organizer' ? 'judge' : 'organizer';
    try {
      await updateJudge(j.id, { role: nextRole });
      await reloadJudges();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const handleRenameJudge = async (j: Judge) => {
    const next = prompt('Rename', j.name);
    if (!next || next.trim() === j.name) return;
    setErr(null);
    try {
      await updateJudge(j.id, { name: next.trim() });
      await reloadJudges();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const handleDeleteJudge = async (j: Judge) => {
    if (!confirm(`Remove ${j.name} from the app? Their submitted scores stay; only the user entry is deleted.`)) return;
    setErr(null);
    try {
      await deleteJudge(j.id);
      await reloadJudges();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const handleCreatePanel = async () => {
    setErr(null);
    const name = `Panel ${panels.length + 1}`;
    try {
      await createPanel(name, round);
      await reloadPanels();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const handleDeletePanel = async (panelId: number, name: string) => {
    if (!confirm(`Delete ${name}? This unassigns its teams and judges (no scores are touched).`)) return;
    try {
      await deletePanel(panelId);
      if (editingPanelId === panelId) setEditingPanelId(null);
      await reloadPanels();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const handleRenamePanel = async (panelId: number, currentName: string) => {
    const next = prompt('Rename panel', currentName);
    if (!next || next.trim() === currentName) return;
    try {
      await renamePanel(panelId, next.trim());
      await reloadPanels();
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  };

  const openEditor = (panel: Panel, mode: 'teams' | 'judges') => {
    setEditingPanelId(panel.id);
    setEditMode(mode);
    setEditTeamIds(new Set(panel.team_ids));
    setEditJudgeIds(new Set(panel.judge_ids));
    setEditSearch('');
  };

  const handleSaveEdit = async () => {
    if (editingPanelId === null) return;
    setSavingEdit(true); setErr(null);
    try {
      if (editMode === 'teams') {
        await setPanelTeams(editingPanelId, Array.from(editTeamIds));
      } else {
        await setPanelJudges(editingPanelId, Array.from(editJudgeIds));
      }
      await reloadPanels();
      setEditingPanelId(null);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const judgeMap = useMemo(() => new Map(judges.map((j) => [j.id, j])), [judges]);
  const judgesOnly = useMemo(() => judges.filter((j) => j.role === 'judge'), [judges]);

  const editingPanel = panels.find((p) => p.id === editingPanelId) || null;

  const filteredTeamsForEdit = useMemo(() => {
    const q = editSearch.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.mentor_name && t.mentor_name.toLowerCase().includes(q)) ||
      (t.idea && t.idea.toLowerCase().includes(q)),
    );
  }, [teams, editSearch]);

  const filteredJudgesForEdit = useMemo(() => {
    const q = editSearch.trim().toLowerCase();
    if (!q) return judgesOnly;
    return judgesOnly.filter((j) =>
      j.name.toLowerCase().includes(q) ||
      (j.email && j.email.toLowerCase().includes(q)),
    );
  }, [judgesOnly, editSearch]);

  return (
    <div className="space-y-6">
      {/* ===== Add judge ===== */}
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
        <h3 className="font-bold text-slate-100 mb-3">Add judge or organizer</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="md:col-span-4 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500/60"
          />
          <input
            placeholder="email@realpage.com"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="md:col-span-4 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500/60"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as 'judge' | 'organizer')}
            className="md:col-span-2 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500/60"
          >
            <option value="judge">Judge</option>
            <option value="organizer">Organizer</option>
          </select>
          <button
            onClick={handleAddJudge}
            disabled={adding || !newName.trim() || !newEmail.trim()}
            className="md:col-span-2 bg-rose-400 hover:bg-rose-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Email must match the user's Azure AD account (e.g. <code>first.last@realpage.com</code>).
        </p>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
          {err}
        </div>
      )}

      {/* ===== Judges directory ===== */}
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
        <h3 className="font-bold text-slate-100 mb-3">
          Judges &amp; organizers
          <span className="ml-2 text-slate-500 font-normal text-sm">({judges.length})</span>
        </h3>
        {judgesLoading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : judges.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Nobody added yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {judges.map((j) => {
              const protectedAcct = isProtected(j.email);
              return (
                <div key={j.id} className="bg-ink-900/40 border border-slate-700/40 rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100 truncate flex items-center gap-1.5">
                        {j.name}
                        {protectedAcct && (
                          <span title="Protected account — cannot be deleted or downgraded">
                            <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 1l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H3v-4l-3-3 3-3V4h4l3-3z M9 13h2v-2H9v2zM9 9h2V5H9v4z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 truncate">{j.email || '—'}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                      j.role === 'organizer'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                    }`}>
                      {j.role}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => handleRenameJudge(j)}
                      className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleToggleRole(j)}
                      disabled={protectedAcct && j.role === 'organizer'}
                      title={protectedAcct ? 'Protected — must remain organizer' : `Switch to ${j.role === 'organizer' ? 'judge' : 'organizer'}`}
                      className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      Make {j.role === 'organizer' ? 'judge' : 'organizer'}
                    </button>
                    {!protectedAcct && (
                      <button
                        onClick={() => handleDeleteJudge(j)}
                        className="text-[11px] px-2 py-0.5 rounded border border-rose-500/30 hover:border-rose-500/60 text-rose-300 transition"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Panels for this round ===== */}
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-bold text-slate-100">Panels</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Group teams + judges together. Every judge in a panel sees every team in the panel.
            </p>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
              {[1, 2].map((r) => (
                <button
                  key={r}
                  onClick={() => { setRound(r); setEditingPanelId(null); }}
                  className={`px-3 py-1 rounded text-sm font-semibold transition ${round === r ? 'bg-rose-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
                >
                  Round {r}
                </button>
              ))}
            </div>
            <button
              onClick={() => setDistributeOpen(true)}
              className="bg-sky-400 hover:bg-sky-300 text-ink-950 font-bold px-3 py-1.5 rounded text-sm transition"
              title="Randomly split teams across panels"
            >
              🎲 Distribute teams
            </button>
            <button
              onClick={handleCreatePanel}
              className="bg-rose-400 hover:bg-rose-300 text-ink-950 font-bold px-3 py-1.5 rounded text-sm transition"
            >
              + Add panel
            </button>
          </div>
        </div>

        {panelsLoading ? (
          <div className="text-slate-400 text-sm">Loading panels…</div>
        ) : panels.length === 0 ? (
          <div className="bg-ink-900/40 border border-dashed border-slate-700/40 rounded-lg p-6 text-center">
            <p className="text-sm text-slate-400">No panels for Round {round} yet. Click <span className="text-rose-300">+ Add panel</span> to create one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {panels.map((p) => (
              <div
                key={p.id}
                className={`rounded-lg border p-4 ${editingPanelId === p.id ? 'border-rose-500/60 bg-rose-500/5' : 'border-slate-700/40 bg-ink-900/40'}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-100">{p.name}</h4>
                      <button
                        onClick={() => handleRenamePanel(p.id, p.name)}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        rename
                      </button>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {p.team_ids.length} team{p.team_ids.length === 1 ? '' : 's'} · {p.judge_ids.length} judge{p.judge_ids.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => openEditor(p, 'teams')}
                      className={`text-xs px-2.5 py-1 rounded border transition ${editingPanelId === p.id && editMode === 'teams' ? 'bg-rose-500/20 border-rose-500/60 text-rose-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      Edit teams
                    </button>
                    <button
                      onClick={() => openEditor(p, 'judges')}
                      className={`text-xs px-2.5 py-1 rounded border transition ${editingPanelId === p.id && editMode === 'judges' ? 'bg-rose-500/20 border-rose-500/60 text-rose-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      Edit judges
                    </button>
                    <button
                      onClick={() => handleDeletePanel(p.id, p.name)}
                      className="text-xs px-2.5 py-1 rounded border border-rose-500/30 hover:border-rose-500/60 text-rose-300 hover:text-rose-200 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Quick summary of who's in this panel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="uppercase tracking-wider text-slate-500 font-semibold mb-1">Teams</div>
                    {p.team_ids.length === 0 ? (
                      <div className="text-slate-500 italic">None yet</div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.team_ids.slice(0, 8).map((tid) => (
                          <span key={tid} className="px-2 py-0.5 rounded bg-ink-800 border border-slate-700/40 text-slate-300">
                            {teamMap.get(tid)?.name || `Team #${tid}`}
                          </span>
                        ))}
                        {p.team_ids.length > 8 && (
                          <span className="text-slate-500">+{p.team_ids.length - 8} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="uppercase tracking-wider text-slate-500 font-semibold mb-1">Judges</div>
                    {p.judge_ids.length === 0 ? (
                      <div className="text-slate-500 italic">None yet</div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.judge_ids.map((jid) => (
                          <span key={jid} className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-sky-300">
                            {judgeMap.get(jid)?.name || `Judge #${jid}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline editor */}
                {editingPanelId === p.id && (
                  <div className="mt-4 pt-4 border-t border-slate-700/40">
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                      <h5 className="text-sm font-semibold text-slate-100">
                        {editMode === 'teams' ? 'Pick teams for this panel' : 'Pick judges for this panel'}
                      </h5>
                      <div className="flex gap-2 items-center flex-wrap">
                        <input
                          placeholder={editMode === 'teams' ? 'Search teams…' : 'Search judges…'}
                          value={editSearch}
                          onChange={(e) => setEditSearch(e.target.value)}
                          className="w-44 bg-ink-900 border border-slate-700/40 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-rose-500/60"
                        />
                        {editMode === 'teams' && (
                          <>
                            <button
                              onClick={() => setEditTeamIds(new Set(filteredTeamsForEdit.map((t) => t.id)))}
                              className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                            >
                              All{editSearch ? ' (filtered)' : ''}
                            </button>
                            <button
                              onClick={() => setEditTeamIds(new Set())}
                              className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                            >
                              Clear
                            </button>
                          </>
                        )}
                        {editMode === 'judges' && (
                          <button
                            onClick={() => setEditJudgeIds(new Set())}
                            className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          onClick={handleSaveEdit}
                          disabled={savingEdit}
                          className="bg-rose-400 hover:bg-rose-300 disabled:opacity-40 text-ink-950 font-bold px-3 py-1.5 rounded text-xs transition"
                        >
                          {savingEdit ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingPanelId(null)}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
                      {editMode === 'teams' ? (
                        filteredTeamsForEdit.map((t) => {
                          const checked = editTeamIds.has(t.id);
                          return (
                            <label
                              key={t.id}
                              className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                                checked
                                  ? 'bg-rose-500/10 border-rose-500/50'
                                  : 'bg-ink-900/40 border-slate-700/40 hover:border-slate-500'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setEditTeamIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id);
                                    else next.add(t.id);
                                    return next;
                                  });
                                }}
                                className="mt-0.5 accent-rose-400"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-100 truncate">{t.name}</div>
                                <div className="text-xs text-slate-400 truncate">Mentor: {t.mentor_name || '—'}</div>
                              </div>
                            </label>
                          );
                        })
                      ) : (
                        filteredJudgesForEdit.map((j) => {
                          const checked = editJudgeIds.has(j.id);
                          return (
                            <label
                              key={j.id}
                              className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                                checked
                                  ? 'bg-sky-500/10 border-sky-500/50'
                                  : 'bg-ink-900/40 border-slate-700/40 hover:border-slate-500'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setEditJudgeIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(j.id)) next.delete(j.id);
                                    else next.add(j.id);
                                    return next;
                                  });
                                }}
                                className="mt-0.5 accent-sky-400"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-100 truncate">{j.name}</div>
                                <div className="text-xs text-slate-400 truncate">{j.email || '—'}</div>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <p className="text-xs text-slate-500 mt-3">
                      {editMode === 'teams'
                        ? `${editTeamIds.size} of ${teams.length} teams selected`
                        : `${editJudgeIds.size} of ${judgesOnly.length} judges selected`}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {editingPanel && (
          <p className="text-xs text-slate-500 mt-3">
            Editing {editingPanel.name} · changes save when you click Save.
          </p>
        )}
      </div>

      {distributeOpen && (
        <DistributeTeamsModal
          round={round}
          teams={teams}
          existingPanels={panels}
          onClose={() => setDistributeOpen(false)}
          onSaved={async () => { setDistributeOpen(false); await reloadPanels(); }}
        />
      )}
    </div>
  );
}


// ===== Random-distribute teams across panels =====

interface DistributeProps {
  round: number;
  teams: Team[];
  existingPanels: Panel[];
  onClose: () => void;
  onSaved: () => void;
}

interface PanelTarget {
  // For existing panels we keep their id; new panels get id=null and we create them.
  id: number | null;
  name: string;
  size: number;  // requested team count
}

function DistributeTeamsModal({ round, teams, existingPanels, onClose, onSaved }: DistributeProps) {
  // Default suggestion: 2 panels if none exist yet, otherwise reuse existing ones.
  const initial = useMemo<PanelTarget[]>(() => {
    if (existingPanels.length > 0) {
      // Pre-fill sizes from current team counts to make 'rebalance' easy.
      return existingPanels.map((p) => ({ id: p.id, name: p.name, size: p.team_ids.length || 0 }));
    }
    const half = Math.ceil(teams.length / 2);
    return [
      { id: null, name: 'Panel 1', size: half },
      { id: null, name: 'Panel 2', size: teams.length - half },
    ];
  }, [existingPanels, teams.length]);

  const [targets, setTargets] = useState<PanelTarget[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalAssigned = targets.reduce((s, t) => s + (Number.isFinite(t.size) ? Math.max(0, t.size) : 0), 0);
  const overflow = totalAssigned > teams.length;

  const updateTarget = (i: number, patch: Partial<PanelTarget>) => {
    setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const addPanel = () => {
    setTargets((prev) => [...prev, { id: null, name: `Panel ${prev.length + 1}`, size: 0 }]);
  };

  const removePanel = (i: number) => {
    setTargets((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleDistribute = async () => {
    setErr(null);
    if (overflow) {
      setErr(`Total exceeds team count (${totalAssigned} requested, only ${teams.length} teams available)`);
      return;
    }
    if (!confirm(`Randomly distribute ${totalAssigned} teams across ${targets.length} panels for Round ${round}? Existing team assignments for these panels will be replaced.`)) return;
    setBusy(true);
    try {
      // Fisher-Yates shuffle for an unbiased random partition.
      const shuffled = [...teams];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let cursor = 0;
      for (const target of targets) {
        const teamSlice = shuffled.slice(cursor, cursor + Math.max(0, target.size));
        cursor += Math.max(0, target.size);
        const teamIds = teamSlice.map((t) => t.id);
        let panelId = target.id;
        if (panelId === null) {
          const created = await createPanel(target.name, round);
          panelId = created.id;
        }
        await setPanelTeams(panelId, teamIds);
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-ink-800 border border-sky-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
        <div className="bg-gradient-to-br from-sky-500/25 to-emerald-500/15 p-4 border-b border-sky-500/40">
          <h3 className="font-bold text-sky-200">🎲 Distribute teams randomly</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            Round {round} · {teams.length} teams available · split across the panels below. No team will be in more than one panel.
          </p>
        </div>
        <div className="p-5 space-y-3">
          {targets.map((t, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                value={t.name}
                onChange={(e) => updateTarget(i, { name: e.target.value })}
                placeholder="Panel name"
                className="flex-1 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500/60"
              />
              <input
                type="number"
                min={0}
                value={t.size}
                onChange={(e) => updateTarget(i, { size: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                className="w-20 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm text-center focus:outline-none focus:border-sky-500/60"
              />
              <span className="text-xs text-slate-500 w-12">teams</span>
              <button
                onClick={() => removePanel(i)}
                disabled={targets.length <= 1}
                className="text-slate-500 hover:text-rose-300 disabled:opacity-30 text-lg leading-none"
                title="Remove panel"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addPanel}
            className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
          >
            + Add another panel
          </button>

          <div className={`text-xs px-3 py-2 rounded ${overflow ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300' : 'bg-ink-900/50 text-slate-400'}`}>
            Assigning <span className="text-slate-100 font-bold">{totalAssigned}</span> of {teams.length} teams.
            {!overflow && totalAssigned < teams.length && (
              <span className="text-slate-500"> · {teams.length - totalAssigned} team{teams.length - totalAssigned === 1 ? '' : 's'} won't be assigned</span>
            )}
            {overflow && <span> · too many — reduce sizes.</span>}
          </div>
          {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-2 text-xs">{err}</div>}
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-2">
            Cancel
          </button>
          <button
            onClick={handleDistribute}
            disabled={busy || overflow || totalAssigned === 0}
            className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
          >
            {busy ? 'Distributing…' : '🎲 Distribute'}
          </button>
        </div>
      </div>
    </div>
  );
}
