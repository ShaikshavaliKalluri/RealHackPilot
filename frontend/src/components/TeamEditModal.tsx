import { useState } from 'react';
import type { Team, Member } from '../types';
import { updateTeam, addTeamMember, updateMember, deleteMember, type TeamEditPatch } from '../api';

interface Props {
  team: Team;
  onClose: () => void;
  onSaved: () => void;
}

// A member row as edited locally — keep both the original (for diff detection)
// and the working copy. New members have id < 0 (client-side temp id) until
// they're persisted.
interface MemberDraft {
  id: number;
  name: string;
  email: string;
  location: string;
  tshirt_size: string;
  // Tracking
  isNew: boolean;
  isDeleted: boolean;
  original: Member | null;
}

const LOCATION_OPTIONS = ['', 'US', 'India', 'Philippines'];
const TSHIRT_OPTIONS = ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

function asDraft(m: Member): MemberDraft {
  return {
    id: m.id,
    name: m.name,
    email: m.email ?? '',
    location: m.location ?? '',
    tshirt_size: m.tshirt_size ?? '',
    isNew: false,
    isDeleted: false,
    original: m,
  };
}

function blankDraft(tempId: number): MemberDraft {
  return {
    id: tempId,
    name: '',
    email: '',
    location: '',
    tshirt_size: '',
    isNew: true,
    isDeleted: false,
    original: null,
  };
}

export function TeamEditModal({ team, onClose, onSaved }: Props) {
  // Team field drafts
  const [name, setName] = useState(team.name);
  const [mentorName, setMentorName] = useState(team.mentor_name ?? '');
  const [mentorEmail, setMentorEmail] = useState(team.mentor_email ?? '');
  const [idea, setIdea] = useState(team.idea ?? '');
  const [tools, setTools] = useState(team.tools ?? '');
  const [approach, setApproach] = useState(team.approach ?? '');
  const [viability, setViability] = useState(team.viability ?? '');
  const [businessValue, setBusinessValue] = useState(team.business_value ?? '');
  const [repoUrl, setRepoUrl] = useState(team.repo_url ?? '');

  const [members, setMembers] = useState<MemberDraft[]>(() => team.members.map(asDraft));
  const [nextTempId, setNextTempId] = useState(-1);

  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    setMembers((rows) => [...rows, blankDraft(nextTempId)]);
    setNextTempId((n) => n - 1);
  };

  const updateRow = (id: number, patch: Partial<MemberDraft>) => {
    setMembers((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: number) => {
    setMembers((rows) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return rows;
      if (row.isNew) {
        // Never persisted — drop entirely
        return rows.filter((r) => r.id !== id);
      }
      return rows.map((r) => (r.id === id ? { ...r, isDeleted: true } : r));
    });
  };

  const undoRemove = (id: number) => {
    updateRow(id, { isDeleted: false });
  };

  const buildTeamPatch = (): TeamEditPatch | null => {
    const patch: TeamEditPatch = {};
    const normalise = (s: string) => s.trim();
    const trimmedName = normalise(name);
    if (!trimmedName) {
      setError('Team name is required.');
      return null;
    }
    if (trimmedName !== team.name) patch.name = trimmedName;
    const pairs: [keyof TeamEditPatch, string, string | null][] = [
      ['mentor_name', mentorName, team.mentor_name],
      ['mentor_email', mentorEmail, team.mentor_email],
      ['idea', idea, team.idea],
      ['tools', tools, team.tools],
      ['approach', approach, team.approach],
      ['viability', viability, team.viability],
      ['business_value', businessValue, team.business_value],
      ['repo_url', repoUrl, team.repo_url],
    ];
    for (const [field, draft, original] of pairs) {
      const next = normalise(draft);
      const originalNorm = original ?? '';
      if (next !== originalNorm) {
        (patch as Record<string, string | null>)[field] = next || null;
      }
    }
    if (reason.trim()) patch.edit_reason = reason.trim();
    return patch;
  };

  const memberChanged = (d: MemberDraft) => {
    if (!d.original) return false;
    return (
      d.name.trim() !== d.original.name ||
      (d.email.trim() || null) !== (d.original.email ?? null) ||
      (d.location.trim() || null) !== (d.original.location ?? null) ||
      (d.tshirt_size.trim() || null) !== (d.original.tshirt_size ?? null)
    );
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      // 1) Team patch (only fields that changed)
      const patch = buildTeamPatch();
      if (patch === null) {
        setSaving(false);
        return;
      }
      const hasTeamChanges = Object.keys(patch).some((k) => k !== 'edit_reason');
      if (hasTeamChanges) {
        await updateTeam(team.id, patch);
      }

      // 2) Member ops — perform in order: deletes, updates, adds
      const reasonPayload = reason.trim() ? { edit_reason: reason.trim() } : {};

      for (const d of members) {
        if (d.isDeleted && !d.isNew) {
          await deleteMember(d.id);
        }
      }
      for (const d of members) {
        if (!d.isDeleted && !d.isNew && memberChanged(d)) {
          await updateMember(d.id, {
            name: d.name.trim(),
            email: d.email.trim() || null,
            location: d.location.trim() || null,
            tshirt_size: d.tshirt_size.trim() || null,
            ...reasonPayload,
          });
        }
      }
      for (const d of members) {
        if (d.isNew && !d.isDeleted) {
          const trimmedName = d.name.trim();
          if (!trimmedName) continue;
          await addTeamMember(team.id, {
            name: trimmedName,
            email: d.email.trim() || null,
            location: d.location.trim() || null,
            tshirt_size: d.tshirt_size.trim() || null,
            ...reasonPayload,
          });
        }
      }

      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-ink-900 border border-slate-700/60 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Edit team</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Changes are written to the team's communication audit log with your name.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Team identity */}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2 font-semibold">Team</h3>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Team name *">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Repository URL">
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="input"
                />
              </Field>
            </div>
          </section>

          {/* Mentor */}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2 font-semibold">Mentor</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Mentor name">
                <input
                  value={mentorName}
                  onChange={(e) => setMentorName(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Mentor email">
                <input
                  type="email"
                  value={mentorEmail}
                  onChange={(e) => setMentorEmail(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
          </section>

          {/* Idea + tech */}
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2 font-semibold">Idea &amp; approach</h3>
            <div className="space-y-3">
              <Field label="Idea / Problem statement">
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={4}
                  className="input"
                />
              </Field>
              <Field label="Tech stack / tools">
                <textarea
                  value={tools}
                  onChange={(e) => setTools(e.target.value)}
                  rows={2}
                  className="input"
                />
              </Field>
              <Field label="Approach">
                <textarea
                  value={approach}
                  onChange={(e) => setApproach(e.target.value)}
                  rows={3}
                  className="input"
                />
              </Field>
              <Field label="Viability">
                <textarea
                  value={viability}
                  onChange={(e) => setViability(e.target.value)}
                  rows={2}
                  className="input"
                />
              </Field>
              <Field label="Business value">
                <textarea
                  value={businessValue}
                  onChange={(e) => setBusinessValue(e.target.value)}
                  rows={2}
                  className="input"
                />
              </Field>
            </div>
          </section>

          {/* Members */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Members ({members.filter((m) => !m.isDeleted).length})
              </h3>
              <button
                onClick={addRow}
                className="text-xs px-3 py-1 rounded border border-lime-500/40 hover:bg-lime-500/10 text-lime-300 transition"
              >
                + Add member
              </button>
            </div>
            <div className="space-y-2">
              {members.length === 0 && (
                <p className="text-sm text-slate-500 italic">No members yet — click "Add member".</p>
              )}
              {members.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_110px_90px_auto] gap-2 items-center ${
                    m.isDeleted ? 'bg-rose-500/5 border-rose-500/30 opacity-60' : 'bg-ink-800/60 border-slate-700/40'
                  }`}
                >
                  <input
                    value={m.name}
                    onChange={(e) => updateRow(m.id, { name: e.target.value })}
                    placeholder="Name"
                    disabled={m.isDeleted}
                    className="input-sm"
                  />
                  <input
                    value={m.email}
                    onChange={(e) => updateRow(m.id, { email: e.target.value })}
                    placeholder="email@realpage.com"
                    type="email"
                    disabled={m.isDeleted}
                    className="input-sm"
                  />
                  <select
                    value={m.location}
                    onChange={(e) => updateRow(m.id, { location: e.target.value })}
                    disabled={m.isDeleted}
                    className="input-sm"
                  >
                    {LOCATION_OPTIONS.map((l) => (
                      <option key={l || 'blank'} value={l}>
                        {l || '—'}
                      </option>
                    ))}
                  </select>
                  <select
                    value={m.tshirt_size}
                    onChange={(e) => updateRow(m.id, { tshirt_size: e.target.value })}
                    disabled={m.isDeleted}
                    className="input-sm"
                  >
                    {TSHIRT_OPTIONS.map((s) => (
                      <option key={s || 'blank'} value={s}>
                        {s || '—'}
                      </option>
                    ))}
                  </select>
                  {m.isDeleted ? (
                    <button
                      onClick={() => undoRemove(m.id)}
                      className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-ink-700 text-slate-200"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => removeRow(m.id)}
                      className="text-xs px-2 py-1 rounded border border-rose-500/40 hover:bg-rose-500/10 text-rose-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Audit reason */}
          <section>
            <Field label="Reason for change (optional, written to audit log)">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. team requested mentor swap; approved by Bhaskar"
                className="input"
              />
            </Field>
          </section>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded-lg p-3 text-sm text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-ink-900/80 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-slate-700/40 text-slate-300 hover:bg-ink-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-lime-400 hover:bg-lime-300 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-semibold transition"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Inline styles for repeated input classes — Tailwind doesn't compose these well otherwise */}
      <style>{`
        .input {
          width: 100%;
          background: rgb(15 23 42 / 0.6);
          border: 1px solid rgb(51 65 85 / 0.5);
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          color: rgb(241 245 249);
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus { border-color: rgb(132 204 22 / 0.6); }
        .input-sm {
          width: 100%;
          background: rgb(15 23 42 / 0.5);
          border: 1px solid rgb(51 65 85 / 0.4);
          border-radius: 0.375rem;
          padding: 0.35rem 0.6rem;
          color: rgb(241 245 249);
          font-size: 0.8125rem;
          outline: none;
        }
        .input-sm:focus { border-color: rgb(132 204 22 / 0.6); }
        .input-sm:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1 font-medium">{label}</span>
      {children}
    </label>
  );
}
