import { useEffect, useState } from 'react';

/**
 * Public, no-auth team detail page rendered when judges scan a printed QR
 * code at a team's desk during the floor-walk on judging day. The page
 * reads from /api/public/teams/<id> which exposes only the judge-relevant
 * fields (no emails, no internal screening flags).
 *
 * Routed in main.tsx based on window.location.pathname starting with
 * /team/, bypassing the MSAL provider entirely so the URL works without
 * sign-in.
 */

interface PublicTeam {
  id: number;
  name: string;
  mentor_name: string | null;
  idea: string | null;
  tools: string | null;
  approach: string | null;
  viability: string | null;
  business_value: string | null;
  members: { name: string; location: string | null }[];
  ai_summary: string | null;
  ai_overall_score: number | null;
  ai_overall_headline: string | null;
  seat_floor: string | null;
  seat_desk: string | null;
  seat_landmark: string | null;
  seat_updated_at: string | null;
  seat_updated_by: string | null;
}

const SEAT_FLOORS = ['5th', '9th', '10th'] as const;

function teamIdFromPath(): number | null {
  const m = window.location.pathname.match(/^\/team\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

export function PublicTeamPage() {
  const teamId = teamIdFromPath();
  const [team, setTeam] = useState<PublicTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Seat-info edit state. Form is expanded by default if seat info hasn't
  // been filled in yet, collapsed once someone has submitted it.
  const [seatFloor, setSeatFloor] = useState<string>('');
  const [seatDesk, setSeatDesk] = useState<string>('');
  const [seatLandmark, setSeatLandmark] = useState<string>('');
  const [submittedBy, setSubmittedBy] = useState<string>('');
  const [submittedByOther, setSubmittedByOther] = useState<string>('');
  const [seatBusy, setSeatBusy] = useState(false);
  const [seatMsg, setSeatMsg] = useState<string | null>(null);
  const [seatEditing, setSeatEditing] = useState(false);

  useEffect(() => {
    if (team) {
      setSeatFloor(team.seat_floor || '');
      setSeatDesk(team.seat_desk || '');
      setSeatLandmark(team.seat_landmark || '');
      setSeatEditing(!team.seat_floor || !team.seat_desk);
      setSubmittedBy('');
      setSubmittedByOther('');
    }
  }, [team]);

  const handleSubmitSeat = async () => {
    if (!seatFloor || !seatDesk.trim()) {
      setSeatMsg('Floor and desk number are required.');
      return;
    }
    // Resolve who's submitting -- either a picked roster name, or the
    // free-text fallback when 'Someone else' was chosen.
    let resolvedSubmitter = '';
    if (submittedBy === '__other__') {
      resolvedSubmitter = submittedByOther.trim();
    } else if (submittedBy) {
      resolvedSubmitter = submittedBy.trim();
    }
    if (!resolvedSubmitter) {
      setSeatMsg('Please tell us who is submitting (so organizers know who to follow up with).');
      return;
    }
    setSeatBusy(true);
    setSeatMsg(null);
    try {
      const r = await fetch(`/api/public/teams/${teamId}/seat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floor: seatFloor,
          desk: seatDesk.trim(),
          landmark: seatLandmark.trim() || null,
          submitted_by: resolvedSubmitter,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Save failed (${r.status}): ${txt.slice(0, 200)}`);
      }
      const updated = await r.json();
      setTeam((prev) => prev ? { ...prev, ...updated } : prev);
      setSeatMsg('✓ Saved. Judges will see this on their booklet.');
      setSeatEditing(false);
    } catch (e: any) {
      setSeatMsg(`✗ ${e.message ?? String(e)}`);
    } finally {
      setSeatBusy(false);
    }
  };

  useEffect(() => {
    if (teamId == null) {
      setError('Bad URL.');
      setLoading(false);
      return;
    }
    fetch(`/api/public/teams/${teamId}`)
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Couldn't load team (${r.status}): ${t.slice(0, 200)}`);
        }
        return r.json();
      })
      .then((t) => setTeam(t as PublicTeam))
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [teamId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500 text-sm">
        Loading team…
      </div>
    );
  }
  if (error || !team) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center text-slate-700">
        <div className="text-5xl mb-3">🤔</div>
        <h1 className="text-lg font-bold mb-2">Team not found</h1>
        <p className="text-sm text-slate-500 max-w-md">{error || 'No team with that id.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Brand strip */}
      <div className="bg-[#0a4f99] text-white px-4 py-3 text-center">
        <div className="text-xs uppercase tracking-widest font-semibold opacity-90">
          RealHack 2026 · Judging walk
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Team name + mentor */}
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-slate-900 leading-tight break-words">
            {team.name}
          </h1>
          {team.mentor_name && (
            <p className="text-sm text-slate-600 mt-1">
              Mentor: <span className="font-semibold text-slate-800">{team.mentor_name}</span>
            </p>
          )}
        </div>

        {/* Floor-walk seating — self-service. Anyone with the QR can edit. */}
        <div className={`mb-4 rounded-lg border-2 ${team.seat_floor && team.seat_desk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'} p-4`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="text-xs uppercase tracking-wider font-bold text-slate-700">
              📍 Floor-walk seat
            </div>
            {team.seat_floor && team.seat_desk && !seatEditing && (
              <button
                onClick={() => setSeatEditing(true)}
                className="text-xs text-[#0a4f99] hover:underline font-semibold"
              >
                Update
              </button>
            )}
          </div>
          {seatEditing ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Tell judges where to find you during the floor walk. Any team member or your mentor can fill this in.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Floor *</label>
                <select
                  value={seatFloor}
                  onChange={(e) => setSeatFloor(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#0a4f99]"
                >
                  <option value="">Select floor…</option>
                  {SEAT_FLOORS.map((f) => (
                    <option key={f} value={f}>{f} floor</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Desk number *</label>
                <input
                  type="text"
                  value={seatDesk}
                  onChange={(e) => setSeatDesk(e.target.value)}
                  placeholder="e.g. A-12, Pod 5, Desk 24"
                  maxLength={64}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#0a4f99]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Landmark <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={seatLandmark}
                  onChange={(e) => setSeatLandmark(e.target.value)}
                  placeholder="e.g. Near cafeteria, by the elevator, conference room side"
                  maxLength={500}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#0a4f99]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Submitted by *
                </label>
                <select
                  value={submittedBy}
                  onChange={(e) => setSubmittedBy(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#0a4f99]"
                >
                  <option value="">Pick your name…</option>
                  {team.mentor_name && (
                    <option value={team.mentor_name}>{team.mentor_name} (mentor)</option>
                  )}
                  {team.members.map((m, i) => (
                    <option key={i} value={m.name}>{m.name}</option>
                  ))}
                  <option value="__other__">Someone else…</option>
                </select>
                {submittedBy === '__other__' && (
                  <input
                    type="text"
                    value={submittedByOther}
                    onChange={(e) => setSubmittedByOther(e.target.value)}
                    placeholder="Your full name"
                    maxLength={255}
                    className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#0a4f99]"
                  />
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSubmitSeat}
                  disabled={seatBusy || !seatFloor || !seatDesk.trim()}
                  className="bg-[#0a4f99] hover:bg-[#0a4f99]/90 disabled:opacity-40 text-white font-bold px-4 py-2 rounded text-sm transition"
                >
                  {seatBusy ? 'Saving…' : 'Save seat info'}
                </button>
                {team.seat_floor && (
                  <button
                    onClick={() => {
                      setSeatFloor(team.seat_floor || '');
                      setSeatDesk(team.seat_desk || '');
                      setSeatLandmark(team.seat_landmark || '');
                      setSeatEditing(false);
                      setSeatMsg(null);
                    }}
                    className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {seatMsg && (
                <p className={`text-xs ${seatMsg.startsWith('✓') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {seatMsg}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-800">
              <div>
                <span className="font-semibold">{team.seat_floor} floor</span>
                {team.seat_desk && <span> · Desk <span className="font-semibold">{team.seat_desk}</span></span>}
              </div>
              {team.seat_landmark && (
                <div className="text-slate-600 mt-1">📌 {team.seat_landmark}</div>
              )}
              {team.seat_updated_by && (
                <div className="text-xs text-slate-500 mt-1.5">
                  Updated by {team.seat_updated_by}
                  {team.seat_updated_at && (
                    <span> · {new Date(team.seat_updated_at).toLocaleString()}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI summary, if present. Score intentionally NOT shown -- judges
            should form their own opinion before seeing any AI rating. */}
        {team.ai_summary && (
          <Section label="Summary" tone="blue">
            <p className="italic">{team.ai_summary}</p>
          </Section>
        )}

        {/* Idea / problem statement — the main thing judges read */}
        <Section label="Idea / problem statement">
          {team.idea ? <p>{team.idea}</p> : <p className="text-slate-400 italic">Not provided</p>}
        </Section>

        {/* Approach */}
        {team.approach && (
          <Section label="Approach">
            <p>{team.approach}</p>
          </Section>
        )}

        {/* Tools / tech stack */}
        {team.tools && (
          <Section label="Tech stack">
            <p>{team.tools}</p>
          </Section>
        )}

        {/* Viability + business value (collapsed-by-default-feel pair) */}
        {team.viability && (
          <Section label="Viability">
            <p>{team.viability}</p>
          </Section>
        )}
        {team.business_value && (
          <Section label="Business value">
            <p>{team.business_value}</p>
          </Section>
        )}

        {/* Members */}
        <Section label={`Members (${team.members.length})`}>
          {team.members.length === 0 ? (
            <p className="text-slate-400 italic">No members listed.</p>
          ) : (
            <ul className="space-y-1">
              {team.members.map((m, i) => (
                <li key={i} className="text-slate-800">
                  <span className="font-medium">{m.name}</span>
                  {m.location && (
                    <span className="text-slate-500 text-xs ml-2">· {m.location}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="text-center text-xs text-slate-400 mt-10">
          Team #{team.id} · realhack.realpage.com
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'blue';
  children: React.ReactNode;
}) {
  const borderClass = tone === 'blue' ? 'border-[#0a4f99]/40 bg-[#0a4f99]/5' : 'border-slate-200 bg-white';
  return (
    <div className={`mb-3 rounded-lg border ${borderClass} p-4`}>
      <div className="text-xs uppercase tracking-wider font-bold text-[#0a4f99] mb-1.5">
        {label}
      </div>
      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}
