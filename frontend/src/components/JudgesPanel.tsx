import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge } from '../types';
import {
  fetchJudges,
  createJudge,
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
            {judges.map((j) => (
              <div key={j.id} className="bg-ink-900/40 border border-slate-700/40 rounded-lg p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100 truncate">{j.name}</div>
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
            ))}
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
              {[1, 2, 3].map((r) => (
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
    </div>
  );
}
