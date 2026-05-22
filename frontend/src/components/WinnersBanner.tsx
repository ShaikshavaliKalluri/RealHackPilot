import type { Team } from '../types';

interface Props {
  teams: Team[];
  onJumpToTeam: (teamId: number) => void;
}

/**
 * Top-of-dashboard banner that celebrates the crowned winners.
 *
 * Reads `final_position` (1/2/3) off each team. Renders nothing if no
 * winners are set yet — i.e. quiet until the organizer crowns them
 * via the Scoring tab → Round 2 → Crown Winners modal.
 */
export function WinnersBanner({ teams, onJumpToTeam }: Props) {
  const winners = teams
    .filter((t) => t.final_position !== null && t.final_position !== undefined)
    .sort((a, b) => (a.final_position ?? 99) - (b.final_position ?? 99));

  if (winners.length === 0) return null;

  const medal = (pos: number | null | undefined) => {
    if (pos === 1) return { emoji: '🥇', label: '#1', tone: 'from-amber-400/30 to-yellow-500/15 border-amber-400/60 text-amber-200' };
    if (pos === 2) return { emoji: '🥈', label: '#2', tone: 'from-slate-300/20 to-slate-400/10 border-slate-300/40 text-slate-100' };
    if (pos === 3) return { emoji: '🥉', label: '#3', tone: 'from-orange-500/20 to-rose-500/10 border-orange-500/40 text-orange-200' };
    return { emoji: '🏆', label: `#${pos ?? '?'}`, tone: 'from-amber-400/20 to-rose-500/10 border-amber-400/40 text-amber-200' };
  };

  return (
    <section className="mb-6">
      <div className="bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent border border-amber-500/30 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🏆</span>
          <div>
            <h2 className="text-xl font-extrabold text-amber-200">RealHack 2026 — Finalists</h2>
            <p className="text-xs text-slate-400">Top finalists crowned by the organizing panel after Round 2.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {winners.map((t) => {
            const m = medal(t.final_position);
            return (
              <button
                key={t.id}
                onClick={() => onJumpToTeam(t.id)}
                className={`text-left bg-gradient-to-br ${m.tone} border rounded-xl p-4 hover:scale-[1.02] transition`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{m.emoji}</span>
                  <span className="text-xs uppercase tracking-wider font-semibold">{m.label}</span>
                </div>
                <div className="font-extrabold text-lg text-slate-100 truncate">{t.name}</div>
                {t.mentor_name && (
                  <div className="text-xs text-slate-300 mt-1 truncate">Mentor: {t.mentor_name}</div>
                )}
                <div className="text-xs text-slate-400 mt-0.5">
                  {t.members.length} member{t.members.length === 1 ? '' : 's'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
