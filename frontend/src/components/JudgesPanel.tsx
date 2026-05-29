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
  downloadPanelInvite,
  fetchPanelInviteMeta,
  type Panel,
  type PanelInviteMeta,
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
  // Move-teams modal state (source panel)
  const [movingFromPanelId, setMovingFromPanelId] = useState<number | null>(null);
  // Move-judges modal state (source panel) — supports copy (keep in both) too
  const [movingJudgesFromPanelId, setMovingJudgesFromPanelId] = useState<number | null>(null);
  // Print-sheet modal state
  const [printingPanelId, setPrintingPanelId] = useState<number | null>(null);
  // Outlook-invite prep modal state — single workspace where the organizer
  // copies subject / body / attendee lists to paste into a manually-opened
  // Outlook new-meeting compose dialog.
  const [inviteMeta, setInviteMeta] = useState<
    | { meta: PanelInviteMeta; panelName: string; day: 1 | 2 }
    | null
  >(null);

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

  const handleOpenInviteWorkspace = async (panel: Panel, day: 1 | 2) => {
    try {
      const meta = await fetchPanelInviteMeta(panel.id, day);
      setInviteMeta({ meta, panelName: panel.name, day });
    } catch (e: any) {
      alert(`Day ${day} invite failed: ${e?.message ?? e}`);
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

  // Teams eligible for the currently-selected round. R1 includes every team
  // that registered; R2 only includes the teams the organizer advanced
  // (advanced_to_round >= 2). This pool feeds the panel team picker and the
  // 'Distribute teams' modal so judges never get assigned a team that wasn't
  // supposed to be in the round.
  const eligibleTeamsForRound = useMemo(
    () => teams.filter((t) => (t.advanced_to_round ?? 1) >= round),
    [teams, round],
  );

  const filteredTeamsForEdit = useMemo(() => {
    const q = editSearch.trim().toLowerCase();
    const base = eligibleTeamsForRound;
    if (!q) return base;
    return base.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.mentor_name && t.mentor_name.toLowerCase().includes(q)) ||
      (t.idea && t.idea.toLowerCase().includes(q)),
    );
  }, [eligibleTeamsForRound, editSearch]);

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
                    {p.team_ids.length > 0 && panels.length > 1 && (
                      <button
                        onClick={() => setMovingFromPanelId(p.id)}
                        className="text-xs px-2.5 py-1 rounded border border-sky-500/30 hover:border-sky-500/60 hover:bg-sky-500/10 text-sky-300 transition"
                        title="Move teams from this panel to another panel in the same round"
                      >
                        ↔ Move teams
                      </button>
                    )}
                    {(p.team_ids.length > 0 || p.judge_ids.length > 0) && (
                      <button
                        onClick={() => setPrintingPanelId(p.id)}
                        className="text-xs px-2.5 py-1 rounded border border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-300 transition"
                        title="Print a sheet showing judges + assigned teams"
                      >
                        🖨 Print sheet
                      </button>
                    )}
                    {p.team_ids.length > 0 && (
                      <>
                        <button
                          onClick={() => handleOpenInviteWorkspace(p, 1)}
                          className="text-xs px-2.5 py-1 rounded border border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/10 text-amber-300 transition"
                          title="Open the Day 1 (June 18) invite workspace — copy subject, body, and attendee lists to paste into a new Outlook meeting"
                        >
                          📅 Day 1 invite
                        </button>
                        <button
                          onClick={() => handleOpenInviteWorkspace(p, 2)}
                          className="text-xs px-2.5 py-1 rounded border border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/10 text-amber-300 transition"
                          title="Open the Day 2 (June 19) invite workspace — copy subject, body, and attendee lists to paste into a new Outlook meeting"
                        >
                          📅 Day 2 invite
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => openEditor(p, 'judges')}
                      className={`text-xs px-2.5 py-1 rounded border transition ${editingPanelId === p.id && editMode === 'judges' ? 'bg-rose-500/20 border-rose-500/60 text-rose-200' : 'border-slate-600 hover:border-slate-400 text-slate-300'}`}
                    >
                      Edit judges
                    </button>
                    {p.judge_ids.length > 0 && panels.length > 1 && (
                      <button
                        onClick={() => setMovingJudgesFromPanelId(p.id)}
                        className="text-xs px-2.5 py-1 rounded border border-sky-500/30 hover:border-sky-500/60 hover:bg-sky-500/10 text-sky-300 transition"
                        title="Move or copy judges to another panel in the same round"
                      >
                        ↔ Move/copy judges
                      </button>
                    )}
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
                        ? `${editTeamIds.size} of ${eligibleTeamsForRound.length} eligible team${eligibleTeamsForRound.length === 1 ? '' : 's'} selected${round > 1 ? ` (Round ${round}: advancers only)` : ''}`
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
          teams={eligibleTeamsForRound}
          existingPanels={panels}
          onClose={() => setDistributeOpen(false)}
          onSaved={async () => { setDistributeOpen(false); await reloadPanels(); }}
        />
      )}

      {movingFromPanelId !== null && (
        <MoveTeamsModal
          sourcePanel={panels.find((p) => p.id === movingFromPanelId)!}
          siblingPanels={panels.filter((p) => p.id !== movingFromPanelId)}
          teams={teams}
          onClose={() => setMovingFromPanelId(null)}
          onSaved={async () => { setMovingFromPanelId(null); await reloadPanels(); }}
        />
      )}

      {movingJudgesFromPanelId !== null && (
        <MoveJudgesModal
          sourcePanel={panels.find((p) => p.id === movingJudgesFromPanelId)!}
          siblingPanels={panels.filter((p) => p.id !== movingJudgesFromPanelId)}
          judges={judges}
          onClose={() => setMovingJudgesFromPanelId(null)}
          onSaved={async () => { setMovingJudgesFromPanelId(null); await reloadPanels(); }}
        />
      )}

      {printingPanelId !== null && (
        <PrintPanelSheet
          panel={panels.find((p) => p.id === printingPanelId)!}
          teams={teams}
          judges={judges}
          onClose={() => setPrintingPanelId(null)}
        />
      )}

      {inviteMeta !== null && (
        <InvitePrepModal
          panelName={inviteMeta.panelName}
          day={inviteMeta.day}
          meta={inviteMeta.meta}
          onClose={() => setInviteMeta(null)}
        />
      )}
    </div>
  );
}


// ===== Outlook-invite prep workspace =====
//
// Single workspace where the organizer copies every piece of the invite
// (subject, body as rich HTML, required-attendee list, organizer CC list)
// to paste into a manually-opened Outlook new-meeting compose dialog.
// No auto-open of Outlook — the organizer drives the Outlook side; this
// modal just hands them what they need with one-click copy.

interface InvitePrepModalProps {
  panelName: string;
  day: 1 | 2;
  meta: PanelInviteMeta;
  onClose: () => void;
}

type CopyTarget = 'subject' | 'body' | 'required' | 'optional';

async function copyRichTextOrPlain(html: string, plainFallback: string): Promise<boolean> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainFallback], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // fall through
    }
  }
  await navigator.clipboard.writeText(plainFallback);
  return false;
}

function InvitePrepModal({ panelName, day, meta, onClose }: InvitePrepModalProps) {
  const [lastCopied, setLastCopied] = useState<CopyTarget | null>(null);

  const flashCopied = (target: CopyTarget) => {
    setLastCopied(target);
    window.setTimeout(() => {
      setLastCopied((cur) => (cur === target ? null : cur));
    }, 2200);
  };

  const copyPlain = async (target: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(target);
    } catch (e: any) {
      alert(`Copy failed: ${e?.message ?? e}. Select the value below and Ctrl+C manually.`);
    }
  };

  const copyBody = async () => {
    try {
      await copyRichTextOrPlain(meta.body_html, meta.body);
      flashCopied('body');
    } catch (e: any) {
      alert(`Copy failed: ${e?.message ?? e}. Open the HTML preview below and copy manually.`);
    }
  };

  const dayLabel = day === 1 ? 'June 18' : 'June 19';
  const copyLabel = (target: CopyTarget, defaultText: string) =>
    lastCopied === target ? '✓ Copied' : defaultText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl bg-ink-800 border border-amber-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-gradient-to-br from-amber-500/25 to-orange-500/15 p-4 border-b border-amber-500/40 flex items-start justify-between">
          <div>
            <h3 className="font-bold text-amber-200 text-base">📅 {panelName} — Day {day} invite workspace</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              {dayLabel}, 2026 · 9:00 AM – 5:00 PM IST · {meta.team_count} team{meta.team_count === 1 ? '' : 's'} ·
              Lunch 13:00 – 14:00 · 15-min slots
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto text-sm text-slate-200 space-y-4">
          {/* Steps */}
          <div className="bg-ink-900/60 border border-slate-700/60 rounded-lg p-3">
            <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wide mb-2">How to use this</h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300 text-sm">
              <li>Open Outlook → <strong className="text-slate-100">New meeting</strong></li>
              <li>Copy each piece below with the buttons → paste into the matching Outlook field</li>
              <li>Set the time: <strong className="text-slate-100">{dayLabel}, 2026 · 9:00 AM – 5:00 PM (IST)</strong></li>
              <li>Toggle <strong className="text-slate-100">Teams meeting</strong> on</li>
              <li>Review attendees + body, then <strong className="text-slate-100">Send</strong></li>
            </ol>
          </div>

          {/* Subject */}
          <div className="bg-ink-900/60 border border-slate-700/60 rounded-lg p-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <h4 className="text-sm font-semibold text-slate-100">Subject</h4>
              <button
                onClick={() => copyPlain('subject', meta.subject)}
                className={`text-xs px-2.5 py-1 rounded border transition ${lastCopied === 'subject' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-amber-500/40 hover:border-amber-500/70 text-amber-200'}`}
              >
                {copyLabel('subject', '📋 Copy')}
              </button>
            </div>
            <p className="text-slate-300 text-sm break-words font-mono">{meta.subject}</p>
          </div>

          {/* Body */}
          <div className="bg-ink-900/60 border border-slate-700/60 rounded-lg p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">Body (branded HTML)</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Paste into Outlook's meeting-body field — Outlook will keep the formatting (greeting, guidelines, table).
                </p>
              </div>
              <button
                onClick={copyBody}
                className={`text-xs px-2.5 py-1 rounded border transition ${lastCopied === 'body' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-amber-500/40 hover:border-amber-500/70 text-amber-200'}`}
              >
                {copyLabel('body', '📋 Copy body')}
              </button>
            </div>
            <div
              className="bg-white text-slate-900 rounded p-3 max-h-72 overflow-y-auto text-sm"
              dangerouslySetInnerHTML={{ __html: meta.body_html }}
            />
          </div>

          {/* Attendee groups */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-ink-900/60 border border-slate-700/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-100">Required ({meta.required_emails.length})</h4>
                <button
                  onClick={() => copyPlain('required', meta.required_emails.join('; '))}
                  className={`text-xs px-2.5 py-1 rounded border transition ${lastCopied === 'required' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-amber-500/40 hover:border-amber-500/70 text-amber-200'}`}
                >
                  {copyLabel('required', '📋 Copy')}
                </button>
              </div>
              <p className="text-xs text-slate-400">Team members + mentors (judges informed separately)</p>
            </div>

            <div className="bg-ink-900/60 border border-slate-700/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-100">Optional ({meta.optional_emails.length})</h4>
                <button
                  onClick={() => copyPlain('optional', meta.optional_emails.join('; '))}
                  className={`text-xs px-2.5 py-1 rounded border transition ${lastCopied === 'optional' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-amber-500/40 hover:border-amber-500/70 text-amber-200'}`}
                >
                  {copyLabel('optional', '📋 Copy')}
                </button>
              </div>
              <p className="text-xs text-slate-400 break-words">{meta.optional_emails.join(', ')}</p>
            </div>
          </div>

          {/* Tabular schedule preview */}
          <details className="bg-ink-900/40 border border-slate-700/40 rounded-lg p-3" open>
            <summary className="cursor-pointer text-xs font-bold text-slate-300 uppercase tracking-wide hover:text-slate-100">
              Schedule preview ({meta.schedule.length} teams · {meta.schedule.filter((r) => r.is_us).length} US-affiliated 🇺🇸)
            </summary>
            <p className="text-xs text-slate-400 mt-2 mb-2 leading-relaxed">
              <strong className="text-slate-300">Sort order:</strong> US-affiliated teams (US mentor or US member) go first to land in
              morning slots — 9–12 IST overlaps late-evening US time, which is more humane than 14–17 IST.
              Within each group, teams are alphabetical. Hover the 🇺🇸 badge to see why a team was flagged US.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-ink-900/80 text-amber-200">
                    <th className="px-3 py-2 text-left border border-slate-700/60">Team Name</th>
                    <th className="px-3 py-2 text-left border border-slate-700/60">Panel</th>
                    <th className="px-3 py-2 text-left border border-slate-700/60">Slot</th>
                    <th className="px-3 py-2 text-right border border-slate-700/60">Time</th>
                    <th className="px-3 py-2 text-left border border-slate-700/60">Mentor</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.schedule.map((row, i) => {
                    const isLunchTransition =
                      i > 0 &&
                      meta.schedule[i - 1].time < '13:00' &&
                      row.time >= '13:30';
                    return (
                      <>
                        {isLunchTransition && (
                          <tr key={`break-${i}`}>
                            <td colSpan={5} className="px-3 py-2 text-center font-bold text-sky-300 bg-sky-500/10 border border-slate-700/60">
                              BREAK
                            </td>
                          </tr>
                        )}
                        <tr key={`row-${i}`} className={`hover:bg-ink-900/60 ${row.is_us ? 'bg-amber-500/5' : ''}`}>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-100 font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              {row.team}
                              {row.is_us && (
                                <span
                                  title={row.us_reason || 'US-affiliated'}
                                  className="cursor-help text-amber-300"
                                >
                                  🇺🇸
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-300">{row.panel}</td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-300">{row.slot}</td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-300 text-right font-mono">{row.time}</td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-400">{row.mentor || '—'}</td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="p-3 border-t border-slate-700/60 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-200 transition"
          >
            Done
          </button>
        </div>
      </div>
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
            Round {round} · {teams.length} eligible team{teams.length === 1 ? '' : 's'}
            {round > 1 ? ' (advancers only)' : ' available'} · split across the panels below. No team will be in more than one panel.
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
            Assigning <span className="text-slate-100 font-bold">{totalAssigned}</span> of {teams.length} eligible team{teams.length === 1 ? '' : 's'}
            {round > 1 && <span className="text-slate-500"> (advancers from Round {round - 1})</span>}.
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


// ===== Move teams between panels =====

interface MoveTeamsProps {
  sourcePanel: Panel;
  siblingPanels: Panel[];
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
}

function MoveTeamsModal({ sourcePanel, siblingPanels, teams, onClose, onSaved }: MoveTeamsProps) {
  const [selectedTeams, setSelectedTeams] = useState<Set<number>>(new Set());
  const [destPanelId, setDestPanelId] = useState<number | ''>(siblingPanels[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const sourceTeams = sourcePanel.team_ids
    .map((id) => teamById.get(id))
    .filter((t): t is Team => !!t)
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggleTeam = (id: number) => {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMove = async () => {
    setErr(null);
    if (!destPanelId) {
      setErr('Pick a destination panel');
      return;
    }
    if (selectedTeams.size === 0) {
      setErr('Pick at least one team to move');
      return;
    }
    const dest = siblingPanels.find((p) => p.id === destPanelId);
    if (!dest) return;
    if (!confirm(
      `Move ${selectedTeams.size} team${selectedTeams.size === 1 ? '' : 's'} from "${sourcePanel.name}" to "${dest.name}"?`,
    )) return;
    setBusy(true);
    try {
      const movingIds = Array.from(selectedTeams);
      const sourceAfter = sourcePanel.team_ids.filter((id) => !selectedTeams.has(id));
      // Dedupe destination — if a team somehow exists already, set() handles it.
      const destAfter = Array.from(new Set([...dest.team_ids, ...movingIds]));
      await setPanelTeams(sourcePanel.id, sourceAfter);
      await setPanelTeams(dest.id, destAfter);
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
          <h3 className="font-bold text-sky-200">↔ Move teams</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            From <span className="font-bold text-slate-100">{sourcePanel.name}</span> · pick teams to move and the destination panel.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Move to</label>
            <select
              value={destPanelId}
              onChange={(e) => setDestPanelId(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-sky-500/60"
            >
              {siblingPanels.length === 0 && <option value="">— No other panels —</option>}
              {siblingPanels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.team_ids.length} teams)
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-slate-400">
                Teams in {sourcePanel.name} ({sourceTeams.length})
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedTeams(new Set(sourceTeams.map((t) => t.id)))}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                >
                  All
                </button>
                <button
                  onClick={() => setSelectedTeams(new Set())}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[40vh] overflow-y-auto pr-1 space-y-1.5">
              {sourceTeams.map((t) => {
                const checked = selectedTeams.has(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition ${
                      checked
                        ? 'bg-sky-500/10 border-sky-500/50'
                        : 'bg-ink-900/40 border-slate-700/40 hover:border-slate-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTeam(t.id)}
                      className="accent-sky-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-100 truncate">{t.name}</div>
                      <div className="text-xs text-slate-400 truncate">Mentor: {t.mentor_name || '—'}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-2 text-xs">{err}</div>}
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {selectedTeams.size} of {sourceTeams.length} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-2">
              Cancel
            </button>
            <button
              onClick={handleMove}
              disabled={busy || selectedTeams.size === 0 || !destPanelId}
              className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
            >
              {busy ? 'Moving…' : `↔ Move ${selectedTeams.size || ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ===== Move (or copy) judges between panels =====

interface MoveJudgesProps {
  sourcePanel: Panel;
  siblingPanels: Panel[];
  judges: Judge[];
  onClose: () => void;
  onSaved: () => void;
}

function MoveJudgesModal({ sourcePanel, siblingPanels, judges, onClose, onSaved }: MoveJudgesProps) {
  const [selectedJudges, setSelectedJudges] = useState<Set<number>>(new Set());
  const [destPanelId, setDestPanelId] = useState<number | ''>(siblingPanels[0]?.id ?? '');
  // When true, leave the judge in the source panel — effectively a copy/share.
  const [keepInSource, setKeepInSource] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const judgeById = useMemo(() => new Map(judges.map((j) => [j.id, j])), [judges]);
  const sourceJudges = sourcePanel.judge_ids
    .map((id) => judgeById.get(id))
    .filter((j): j is Judge => !!j)
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggleJudge = (id: number) => {
    setSelectedJudges((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    setErr(null);
    if (!destPanelId) {
      setErr('Pick a destination panel');
      return;
    }
    if (selectedJudges.size === 0) {
      setErr('Pick at least one judge');
      return;
    }
    const dest = siblingPanels.find((p) => p.id === destPanelId);
    if (!dest) return;
    const verb = keepInSource ? 'Copy' : 'Move';
    if (!confirm(
      `${verb} ${selectedJudges.size} judge${selectedJudges.size === 1 ? '' : 's'} ` +
      `from "${sourcePanel.name}" to "${dest.name}"?` +
      (keepInSource ? ` (Will remain in "${sourcePanel.name}" as well.)` : ''),
    )) return;
    setBusy(true);
    try {
      const movingIds = Array.from(selectedJudges);
      const destAfter = Array.from(new Set([...dest.judge_ids, ...movingIds]));
      await setPanelJudges(dest.id, destAfter);
      if (!keepInSource) {
        const sourceAfter = sourcePanel.judge_ids.filter((id) => !selectedJudges.has(id));
        await setPanelJudges(sourcePanel.id, sourceAfter);
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
          <h3 className="font-bold text-sky-200">↔ Move or copy judges</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            From <span className="font-bold text-slate-100">{sourcePanel.name}</span> · choose destination + whether to also keep them in this panel.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Destination panel</label>
            <select
              value={destPanelId}
              onChange={(e) => setDestPanelId(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-sky-500/60"
            >
              {siblingPanels.length === 0 && <option value="">— No other panels —</option>}
              {siblingPanels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.judge_ids.length} judges)
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 bg-ink-900/40 border border-slate-700/40 rounded-lg p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={keepInSource}
              onChange={(e) => setKeepInSource(e.target.checked)}
              className="mt-0.5 accent-sky-400"
            />
            <div>
              <div className="text-sm font-semibold text-slate-100">Keep them in "{sourcePanel.name}" too</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Selected judges will end up in <strong>both</strong> panels (a copy, not a move). Useful when a senior judge oversees multiple panels.
              </div>
            </div>
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-slate-400">
                Judges in {sourcePanel.name} ({sourceJudges.length})
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedJudges(new Set(sourceJudges.map((j) => j.id)))}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                >
                  All
                </button>
                <button
                  onClick={() => setSelectedJudges(new Set())}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[35vh] overflow-y-auto pr-1 space-y-1.5">
              {sourceJudges.map((j) => {
                const checked = selectedJudges.has(j.id);
                return (
                  <label
                    key={j.id}
                    className={`flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition ${
                      checked
                        ? 'bg-sky-500/10 border-sky-500/50'
                        : 'bg-ink-900/40 border-slate-700/40 hover:border-slate-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleJudge(j.id)}
                      className="accent-sky-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-100 truncate">{j.name}</div>
                      <div className="text-xs text-slate-400 truncate">{j.email || '—'}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-2 text-xs">{err}</div>}
        </div>
        <div className="px-5 pb-5 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {selectedJudges.size} of {sourceJudges.length} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-2">
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={busy || selectedJudges.size === 0 || !destPanelId}
              className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
            >
              {busy ? 'Saving…' : keepInSource ? `Copy ${selectedJudges.size || ''}` : `Move ${selectedJudges.size || ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ===== Print panel sheet =====

interface PrintSheetProps {
  panel: Panel;
  teams: Team[];
  judges: Judge[];
  onClose: () => void;
}

function PrintPanelSheet({ panel, teams, judges, onClose }: PrintSheetProps) {
  const panelTeams = useMemo(() => {
    const map = new Map(teams.map((t) => [t.id, t]));
    return panel.team_ids
      .map((id) => map.get(id))
      .filter((t): t is Team => !!t)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [panel, teams]);
  const panelJudges = useMemo(() => {
    const map = new Map(judges.map((j) => [j.id, j]));
    return panel.judge_ids
      .map((id) => map.get(id))
      .filter((j): j is Judge => !!j)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [panel, judges]);

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl my-6 bg-ink-800 border border-emerald-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
        {/* Toolbar (hidden when printing) */}
        <div className="no-print bg-ink-900/60 p-3 flex items-center justify-between gap-3 border-b border-slate-700/40">
          <div className="text-xs text-slate-400">
            Preview of <span className="text-slate-200 font-semibold">{panel.name}</span> · Round {panel.round}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-1.5">
              Close
            </button>
            <button
              onClick={handlePrint}
              className="bg-emerald-400 hover:bg-emerald-300 text-ink-950 font-bold px-4 py-1.5 rounded-lg text-sm transition"
            >
              🖨 Print
            </button>
          </div>
        </div>

        {/* Printable sheet — white background so it prints cleanly on default settings */}
        <div className="printable-sheet bg-white text-ink-950 p-10">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-5 pb-4 border-b-2 border-ink-950">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-slate-500 font-bold">RealHack 2026</div>
              <h1 className="text-3xl font-extrabold text-ink-950 mt-1">{panel.name}</h1>
              <p className="text-sm text-slate-600 mt-0.5">Round {panel.round} · Judging Sheet</p>
            </div>
            <img src="/realhack-logo.png" alt="RealHack 2026" className="h-12" />
          </div>

          {/* Judges */}
          <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">
              Judges ({panelJudges.length})
            </h2>
            {panelJudges.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No judges assigned yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {panelJudges.map((j) => (
                  <div key={j.id} className="border border-ink-950/20 rounded-lg p-3 bg-slate-50">
                    <div className="font-bold text-ink-950">{j.name}</div>
                    {j.email && <div className="text-xs text-slate-600 mt-0.5">{j.email}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Teams roster */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2">
              Teams to score ({panelTeams.length})
            </h2>
            {panelTeams.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No teams assigned yet.</p>
            ) : (
              <div className="space-y-3">
                {panelTeams.map((t, idx) => (
                  <div key={t.id} className="border border-ink-950/20 rounded-lg p-3 bg-white break-inside-avoid">
                    <div className="flex items-baseline gap-3 mb-1.5">
                      <span className="text-slate-400 font-bold text-sm w-6 text-right">{idx + 1}.</span>
                      <h3 className="font-extrabold text-ink-950 text-lg">{t.name}</h3>
                    </div>
                    <div className="pl-9 space-y-1 text-sm">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Mentor:</span>
                        <span className="ml-2 text-ink-950 font-semibold">{t.mentor_name || '—'}</span>
                        {t.mentor_email && <span className="ml-2 text-xs text-slate-500">({t.mentor_email})</span>}
                      </div>
                      <div>
                        <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">
                          Members ({t.members.length}):
                        </span>
                        {t.members.length === 0 ? (
                          <span className="ml-2 text-slate-500 italic">none listed</span>
                        ) : (
                          <ul className="ml-6 mt-0.5 list-disc text-slate-800">
                            {t.members.map((m) => (
                              <li key={m.id}>
                                {m.name}
                                {m.email && <span className="text-slate-500 text-xs ml-1.5">{m.email}</span>}
                                {m.location && <span className="text-slate-500 text-xs ml-1.5">· {m.location}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {t.idea && (
                        <div>
                          <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">Idea:</span>
                          <span className="ml-2 text-slate-800">{t.idea}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-8 pt-4 border-t border-ink-950/30 text-xs text-slate-500 text-center italic">
            Generated from realhack.realpage.com · RealHack 2026 — for the {panel.name} judging panel.
          </div>
        </div>
      </div>

      {/* Print-only CSS — hide everything except the printable sheet */}
      <style>{`
        @media print {
          @page { margin: 0.4in; }
          body { background: white !important; }
          body * { visibility: hidden !important; }
          .printable-sheet,
          .printable-sheet * { visibility: visible !important; }
          .printable-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0 !important;
          }
          .break-inside-avoid { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
