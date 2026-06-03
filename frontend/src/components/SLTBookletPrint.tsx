import { useEffect, useState } from 'react';

/**
 * Printable handout for SLT to read all 95 teams' ideas in one document.
 *
 * Last year SLT asked organizers for "list of all teams and their ideas
 * handy" -- which meant a stack of printouts. This page renders it all
 * cleanly: alphabetical, 3 teams per A4 page, team name + mentor +
 * idea + business value. Save-as-PDF or print directly.
 *
 * Lives at /slt-booklet. Public (no auth) -- reads from /api/public/teams
 * which already exposes idea + business value via _public_team_dict.
 */

interface PublicTeamFull {
  id: number;
  name: string;
  mentor_name: string | null;
  idea: string | null;
  business_value: string | null;
}

interface PublicTeamSummary {
  id: number;
  name: string;
  mentor_name: string | null;
  idea_short: string | null;
}

export function SLTBookletPrint() {
  const [teams, setTeams] = useState<PublicTeamFull[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Step 1: get the list of all team ids + names.
        const listResp = await fetch('/api/public/teams');
        if (!listResp.ok) throw new Error(`list failed: ${listResp.status}`);
        const list: PublicTeamSummary[] = await listResp.json();

        // Step 2: fetch each team's full detail (so we get idea + business_value).
        // ~95 small parallel requests; backend is read-only and snappy.
        const details = await Promise.all(
          list.map(async (t) => {
            const r = await fetch(`/api/public/teams/${t.id}`);
            if (!r.ok) return null;
            return (await r.json()) as PublicTeamFull;
          }),
        );
        if (cancelled) return;
        const filled = details.filter((t): t is PublicTeamFull => t !== null);
        // Alphabetical by team name (case-insensitive, trimmed)
        filled.sort((a, b) => a.name.trim().toLowerCase().localeCompare(b.name.trim().toLowerCase()));
        setTeams(filled);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading {95} teams…</div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-rose-500 p-8 text-center">{error}</div>;
  }

  return (
    <div className="bg-white min-h-screen text-slate-900">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden border-b border-slate-200 px-6 py-3 sticky top-0 bg-white z-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-bold text-slate-900">SLT booklet · {teams.length} teams</h1>
          <p className="text-xs text-slate-500">
            Alphabetical · 3 teams per page · Ctrl/Cmd + P to print or save as PDF
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-[#0a4f99] hover:bg-[#093d75] text-white font-bold px-4 py-2 rounded text-sm transition"
        >
          🖨️ Print
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print {
          html, body { background: white !important; }
          .no-print { display: none !important; }
        }
        .team-block {
          padding: 6mm 2mm 6mm 2mm;
          border-bottom: 1px solid #e2e8f0;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .team-block:nth-child(3n) {
          page-break-after: always;
          break-after: page;
        }
        @media print {
          .team-block { border-bottom: 1px solid #cbd5e1; }
        }
      `}</style>

      {/* Cover page */}
      <div className="max-w-3xl mx-auto px-6 pt-12 pb-8 text-center break-after-page">
        <div className="text-xs uppercase tracking-widest font-bold text-[#0a4f99] mb-2">
          RealHack 2026 · June 18-19
        </div>
        <h1 className="text-4xl font-extrabold text-slate-900 mb-3">All Teams &amp; Ideas</h1>
        <p className="text-sm text-slate-500 mb-6">SLT handout · {teams.length} teams · alphabetical</p>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          One brief per team — name, mentor, what they're solving, and why it matters.
          Scan the QR on any team's desk for the full detail page.
        </p>
      </div>

      {/* Team blocks */}
      <div className="max-w-3xl mx-auto px-6">
        {teams.map((t, i) => (
          <div className="team-block" key={t.id}>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                {String(i + 1).padStart(2, '0')}. {t.name}
              </h2>
              {t.mentor_name && (
                <span className="text-xs text-slate-500 shrink-0">
                  Mentor: <span className="font-semibold text-slate-700">{t.mentor_name}</span>
                </span>
              )}
            </div>

            {t.idea ? (
              <div className="mb-2">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#0a4f99] mb-1">
                  Idea / problem statement
                </div>
                <p className="text-sm text-slate-800 leading-snug whitespace-pre-wrap">{t.idea}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">Idea not provided</p>
            )}

            {t.business_value && (
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-[#0a4f99] mb-1 mt-2">
                  Business value
                </div>
                <p className="text-sm text-slate-700 leading-snug whitespace-pre-wrap">{t.business_value}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
