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
}

function teamIdFromPath(): number | null {
  const m = window.location.pathname.match(/^\/team\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}

export function PublicTeamPage() {
  const teamId = teamIdFromPath();
  const [team, setTeam] = useState<PublicTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
