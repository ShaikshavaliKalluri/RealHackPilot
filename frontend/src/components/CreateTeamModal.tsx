import { useState } from 'react';
import { createTeam, type NewMemberPayload } from '../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const KNOWN_LOCATIONS = ['US', 'India', 'Philippines', 'UK', 'Canada', 'Romania', 'Mexico'];
const TSHIRT_OPTIONS = ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

interface MemberDraft extends NewMemberPayload {
  // Client-side row id so React keys stay stable when rows are added/removed.
  _key: number;
}

/**
 * Manual team-creation modal. Used when a team needs to be added outside
 * the MS Forms import flow — late registrations, replacements, special cases.
 *
 * Fields mirror the TeamEditModal layout exactly so organizers see the same
 * shape they're used to. Differences from edit-mode:
 *   - Team name is required (the only mandatory field).
 *   - Members are added/removed in-modal; nothing persists until Save.
 *   - On submit the backend POSTs the whole payload in one transaction and
 *     re-runs the screener so completeness + flags are populated immediately.
 */
export function CreateTeamModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [mentorName, setMentorName] = useState('');
  const [mentorEmail, setMentorEmail] = useState('');
  const [mentorLocation, setMentorLocation] = useState('');
  const [mentorTshirt, setMentorTshirt] = useState('');
  const [mentorAddress, setMentorAddress] = useState('');
  const [idea, setIdea] = useState('');
  const [tools, setTools] = useState('');
  const [approach, setApproach] = useState('');
  const [viability, setViability] = useState('');
  const [businessValue, setBusinessValue] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [reason, setReason] = useState('');

  const [members, setMembers] = useState<MemberDraft[]>([{ _key: 0, name: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addMemberRow = () => {
    setMembers((prev) => [...prev, { _key: Date.now() + Math.random(), name: '' }]);
  };
  const removeMemberRow = (key: number) => {
    setMembers((prev) => prev.filter((m) => m._key !== key));
  };
  const updateMember = (key: number, patch: Partial<MemberDraft>) => {
    setMembers((prev) => prev.map((m) => (m._key === key ? { ...m, ...patch } : m)));
  };

  const handleSubmit = async () => {
    setErr(null);
    if (!name.trim()) {
      setErr('Team name is required.');
      return;
    }
    setBusy(true);
    try {
      await createTeam({
        name: name.trim(),
        mentor_name: mentorName.trim() || null,
        mentor_email: mentorEmail.trim() || null,
        mentor_location: mentorLocation.trim() || null,
        mentor_tshirt_size: mentorTshirt.trim() || null,
        mentor_address: mentorAddress.trim() || null,
        idea: idea.trim() || null,
        tools: tools.trim() || null,
        approach: approach.trim() || null,
        viability: viability.trim() || null,
        business_value: businessValue.trim() || null,
        repo_url: repoUrl.trim() || null,
        edit_reason: reason.trim() || null,
        members: members
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            email: m.email?.trim() || null,
            location: m.location?.trim() || null,
            tshirt_size: m.tshirt_size?.trim() || null,
            address: m.address?.trim() || null,
          })),
      });
      onCreated();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl my-6 bg-ink-800 border border-lime-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
      >
        <div className="bg-gradient-to-br from-lime-500/20 to-emerald-500/10 p-4 border-b border-lime-500/40 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-lime-200 text-lg">Add a new team</h3>
            <p className="text-xs text-slate-300 mt-0.5">Manually create a team that didn't come through the MS Forms import.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Close ✕</button>
        </div>

        <div className="p-5 space-y-6 max-h-[75vh] overflow-y-auto">

          {/* ===== Team basics ===== */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Team</h4>
            <div>
              <label className="text-xs text-slate-400">Team name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. AgenTicket"
                autoFocus
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
          </section>

          {/* ===== Mentor ===== */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Mentor</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Name</label>
                <input
                  value={mentorName}
                  onChange={(e) => setMentorName(e.target.value)}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Email</label>
                <input
                  type="email"
                  value={mentorEmail}
                  onChange={(e) => setMentorEmail(e.target.value)}
                  placeholder="first.last@realpage.com"
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Location</label>
                <select
                  value={KNOWN_LOCATIONS.includes(mentorLocation) ? mentorLocation : (mentorLocation ? '__other__' : '')}
                  onChange={(e) => {
                    if (e.target.value === '__other__') setMentorLocation('Other');
                    else setMentorLocation(e.target.value);
                  }}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
                >
                  <option value="">— Not set —</option>
                  {KNOWN_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                  <option value="__other__">Other…</option>
                </select>
                {mentorLocation && !KNOWN_LOCATIONS.includes(mentorLocation) && (
                  <input
                    value={mentorLocation === 'Other' ? '' : mentorLocation}
                    onChange={(e) => setMentorLocation(e.target.value)}
                    placeholder="Country"
                    className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
                  />
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400">T-shirt size</label>
                <select
                  value={mentorTshirt}
                  onChange={(e) => setMentorTshirt(e.target.value)}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
                >
                  {TSHIRT_OPTIONS.map((s) => <option key={s} value={s}>{s || '— Not set —'}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400">Mailing address (US/PH only)</label>
              <textarea
                value={mentorAddress}
                onChange={(e) => setMentorAddress(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
          </section>

          {/* ===== Members ===== */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Members ({members.length})</h4>
              <button
                onClick={addMemberRow}
                className="text-xs px-2.5 py-1 rounded border border-lime-500/40 hover:bg-lime-500/10 text-lime-300 transition"
              >
                + Add member
              </button>
            </div>
            <div className="space-y-3">
              {members.map((m, idx) => (
                <div key={m._key} className="bg-ink-900/40 border border-slate-700/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500 font-semibold">Member {idx + 1}</span>
                    {members.length > 1 && (
                      <button
                        onClick={() => removeMemberRow(m._key)}
                        className="text-xs text-rose-300 hover:text-rose-200"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      placeholder="Name"
                      value={m.name}
                      onChange={(e) => updateMember(m._key, { name: e.target.value })}
                      className="bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                    />
                    <input
                      type="email"
                      placeholder="email@realpage.com"
                      value={m.email ?? ''}
                      onChange={(e) => updateMember(m._key, { email: e.target.value })}
                      className="bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                    />
                    <select
                      value={KNOWN_LOCATIONS.includes(m.location ?? '') ? m.location ?? '' : (m.location ? '__other__' : '')}
                      onChange={(e) => {
                        if (e.target.value === '__other__') updateMember(m._key, { location: 'Other' });
                        else updateMember(m._key, { location: e.target.value });
                      }}
                      className="bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                    >
                      <option value="">— Location —</option>
                      {KNOWN_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                      <option value="__other__">Other…</option>
                    </select>
                    {m.location && !KNOWN_LOCATIONS.includes(m.location) && (
                      <input
                        placeholder="Country"
                        value={m.location === 'Other' ? '' : m.location}
                        onChange={(e) => updateMember(m._key, { location: e.target.value })}
                        className="bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                      />
                    )}
                    <select
                      value={m.tshirt_size ?? ''}
                      onChange={(e) => updateMember(m._key, { tshirt_size: e.target.value })}
                      className="bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                    >
                      {TSHIRT_OPTIONS.map((s) => <option key={s} value={s}>{s || '— T-shirt —'}</option>)}
                    </select>
                    <input
                      placeholder="Address (US/PH only)"
                      value={m.address ?? ''}
                      onChange={(e) => updateMember(m._key, { address: e.target.value })}
                      className="md:col-span-2 bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-lime-500/60"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ===== Idea + submission fields ===== */}
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Submission</h4>
            <div>
              <label className="text-xs text-slate-400">Idea / problem statement</label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Tech stack / tools</label>
              <textarea
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Approach</label>
              <textarea
                value={approach}
                onChange={(e) => setApproach(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Viability</label>
              <textarea
                value={viability}
                onChange={(e) => setViability(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Business value</label>
              <textarea
                value={businessValue}
                onChange={(e) => setBusinessValue(e.target.value)}
                rows={2}
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Repo URL (optional)</label>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/…"
                className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
              />
            </div>
          </section>

          {/* ===== Why ===== */}
          <section>
            <label className="text-xs text-slate-400">Reason for adding (audit log)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Late registration · Email request from team"
              className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 mt-1 text-sm focus:outline-none focus:border-lime-500/60"
            />
          </section>

          {err && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded p-3 text-sm">{err}</div>}
        </div>

        <div className="px-5 py-4 border-t border-slate-700/40 flex items-center justify-end gap-2 bg-ink-900/30">
          <button onClick={onClose} className="text-sm text-slate-300 hover:text-white px-3 py-2">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !name.trim()}
            className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-5 py-2 rounded-lg text-sm transition"
          >
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </div>
    </div>
  );
}
