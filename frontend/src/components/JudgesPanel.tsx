import { useEffect, useMemo, useState } from 'react';
import type { Team, Judge } from '../types';
import {
  fetchJudges,
  createJudge,
  fetchJudgeAssignments,
  setJudgeAssignments,
} from '../api';

interface Props {
  teams: Team[];
}

export function JudgesPanel({ teams }: Props) {
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add-judge form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'judge' | 'organizer'>('judge');
  const [adding, setAdding] = useState(false);

  // Assignment editor
  const [editingJudgeId, setEditingJudgeId] = useState<number | null>(null);
  const [round, setRound] = useState<number>(1);
  const [assignedTeamIds, setAssignedTeamIds] = useState<Set<number>>(new Set());
  const [savedTeamIds, setSavedTeamIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [savingAssign, setSavingAssign] = useState(false);

  const reloadJudges = async () => {
    setLoading(true);
    try {
      const list = await fetchJudges();
      setJudges(list);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reloadJudges(); }, []);

  useEffect(() => {
    if (editingJudgeId === null) return;
    fetchJudgeAssignments(editingJudgeId, round)
      .then((rows) => {
        const ids = new Set(rows.map((r) => r.team_id));
        setAssignedTeamIds(ids);
        setSavedTeamIds(new Set(ids));
      })
      .catch((e) => setErr(e.message || String(e)));
  }, [editingJudgeId, round]);

  const handleAddJudge = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setAdding(true);
    setErr(null);
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

  const handleSaveAssignments = async () => {
    if (editingJudgeId === null) return;
    setSavingAssign(true);
    setErr(null);
    try {
      await setJudgeAssignments(editingJudgeId, round, Array.from(assignedTeamIds));
      setSavedTeamIds(new Set(assignedTeamIds));
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingAssign(false);
    }
  };

  const toggleTeam = (teamId: number) => {
    setAssignedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const dirty = useMemo(() => {
    if (assignedTeamIds.size !== savedTeamIds.size) return true;
    for (const id of assignedTeamIds) if (!savedTeamIds.has(id)) return true;
    return false;
  }, [assignedTeamIds, savedTeamIds]);

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.mentor_name && t.mentor_name.toLowerCase().includes(q)) ||
        (t.idea && t.idea.toLowerCase().includes(q)),
    );
  }, [teams, search]);

  const editingJudge = judges.find((j) => j.id === editingJudgeId) || null;

  return (
    <div className="space-y-6">
      {/* Add judge */}
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
          Email must match the user's Azure AD account (e.g. <code>first.last@realpage.com</code>). The role determines what they see when they log in.
        </p>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
          {err}
        </div>
      )}

      {/* Judges list */}
      <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
        <h3 className="font-bold text-slate-100 mb-3">
          Judges &amp; organizers
          <span className="ml-2 text-slate-500 font-normal text-sm">({judges.length})</span>
        </h3>
        {loading ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : judges.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Nobody added yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {judges.map((j) => (
              <div
                key={j.id}
                className={`rounded-lg border p-3 ${editingJudgeId === j.id ? 'border-rose-500/60 bg-rose-500/5' : 'border-slate-700/40 bg-ink-900/40'}`}
              >
                <div className="flex items-start justify-between gap-2">
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
                {j.role === 'judge' && (
                  <button
                    onClick={() => setEditingJudgeId(editingJudgeId === j.id ? null : j.id)}
                    className="mt-2 text-xs px-2.5 py-1 rounded border border-rose-500/40 hover:bg-rose-500/10 text-rose-300 transition"
                  >
                    {editingJudgeId === j.id ? 'Close assignments' : 'Assign teams'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignment editor */}
      {editingJudge && (
        <div className="bg-ink-800/60 border border-rose-500/40 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h3 className="font-bold text-slate-100">
                Assign teams to <span className="text-rose-300">{editingJudge.name}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">Pick the teams this judge will see in Round {round}.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1 bg-ink-900 border border-slate-700/40 rounded-lg p-1">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRound(r)}
                    className={`px-3 py-1 rounded text-sm font-semibold transition ${round === r ? 'bg-rose-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
                  >
                    R{r}
                  </button>
                ))}
              </div>
              <button
                onClick={handleSaveAssignments}
                disabled={savingAssign || !dirty}
                className="bg-rose-400 hover:bg-rose-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
              >
                {savingAssign ? 'Saving…' : dirty ? `Save (${assignedTeamIds.size})` : 'Saved'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <input
              placeholder="Search teams…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-rose-500/60"
            />
            <button
              onClick={() => setAssignedTeamIds(new Set(filteredTeams.map((t) => t.id)))}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
            >
              Select all{search ? ' (filtered)' : ''}
            </button>
            <button
              onClick={() => setAssignedTeamIds(new Set())}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 transition"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[480px] overflow-y-auto pr-1">
            {filteredTeams.map((t) => {
              const checked = assignedTeamIds.has(t.id);
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
                    onChange={() => toggleTeam(t.id)}
                    className="mt-0.5 accent-rose-400"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 truncate">{t.name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      Mentor: {t.mentor_name || '—'}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <p className="text-xs text-slate-500 mt-3">
            {assignedTeamIds.size} of {teams.length} teams selected · {dirty ? 'unsaved changes' : 'saved'}
          </p>
        </div>
      )}
    </div>
  );
}
