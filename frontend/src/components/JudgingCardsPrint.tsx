import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

/**
 * Bulk-print page: 8 judging cards per A4 page. Each card has a QR code
 * pointing to /team/<id>, plus the team name, mentor, and a 1-line idea
 * snippet. Organizers open this page, hit Ctrl+P (or Cmd+P), choose
 * "Save as PDF" (or print directly), then cut along the borders and
 * distribute one card per team.
 *
 * Lives at /judging-cards. Auth-required (only organizers need this).
 */

interface PublicTeamSummary {
  id: number;
  name: string;
  mentor_name: string | null;
  idea_short: string | null;
}

export function JudgingCardsPrint() {
  const [teams, setTeams] = useState<PublicTeamSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/public/teams')
      .then(async (r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then((t) => setTeams(t as PublicTeamSummary[]))
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading teams…</div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-rose-500 p-8 text-center">{error}</div>;
  }

  return (
    <div className="bg-white min-h-screen text-slate-900">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden border-b border-slate-200 px-6 py-3 sticky top-0 bg-white z-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-bold text-slate-900">Judging cards · {teams.length} teams</h1>
          <p className="text-xs text-slate-500">
            8 cards per page · Ctrl/Cmd + P to print or save as PDF · cut along the borders
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-[#0a4f99] hover:bg-[#093d75] text-white font-bold px-4 py-2 rounded text-sm transition"
        >
          🖨️ Print
        </button>
      </div>

      {/* Print stylesheet: 8 cards per A4, 2 cols × 4 rows */}
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          html, body { background: white !important; }
          .no-print { display: none !important; }
        }
        .cards-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-auto-rows: 64mm;
          gap: 0;
        }
        .card {
          border: 1px dashed #cbd5e1;
          padding: 6mm 5mm;
          display: flex;
          gap: 5mm;
          break-inside: avoid;
          page-break-inside: avoid;
          align-items: flex-start;
        }
        @media print {
          .card { border: 1px dashed #94a3b8; }
        }
      `}</style>

      <div className="px-2 py-4">
        <div className="cards-grid">
          {teams.map((t) => (
            <div className="card" key={t.id}>
              <div className="shrink-0">
                <QRCodeCanvas
                  value={`${origin}/team/${t.id}`}
                  size={120}
                  bgColor="#ffffff"
                  fgColor="#0a4f99"
                  level="M"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-widest font-semibold text-[#0a4f99]">
                  RealHack 2026
                </div>
                <div className="text-base font-extrabold text-slate-900 leading-tight mt-0.5 break-words">
                  {t.name}
                </div>
                {t.mentor_name && (
                  <div className="text-[11px] text-slate-600 mt-1 truncate">
                    Mentor: <span className="font-semibold text-slate-800">{t.mentor_name}</span>
                  </div>
                )}
                {t.idea_short && (
                  <div className="text-[10px] text-slate-500 mt-1 leading-snug line-clamp-3">
                    {t.idea_short}
                  </div>
                )}
                <div className="text-[9px] text-slate-400 mt-2">
                  Scan QR for details · Team #{t.id}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
