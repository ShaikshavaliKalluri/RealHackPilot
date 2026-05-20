import { useMemo } from 'react';
import type { Team, DashboardStats } from '../types';

interface Props {
  teams: Team[];
  stats: DashboardStats;
  onJumpToTeam: (teamId: number) => void;
}

// ---- Reusable horizontal bar ----
function HBar({
  label, count, total, color = 'bg-lime-500/60',
}: { label: string; count: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-slate-300 text-right truncate capitalize">{label}</div>
      <div className="flex-1 bg-ink-900 rounded-full h-4 overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 text-right text-xs text-slate-400">
        {count} <span className="text-slate-600">({pct}%)</span>
      </div>
    </div>
  );
}

// ---- Section wrapper ----
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
      <h3 className="font-bold text-slate-100 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ---- Stat tile ----
function Tile({ label, value, tone = 'text-slate-100' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-ink-900/60 rounded-xl p-4 flex flex-col gap-1">
      <div className={`text-2xl font-extrabold ${tone}`}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

export function Analytics({ teams, stats, onJumpToTeam }: Props) {
  const derived = useMemo(() => {
    // Location distribution
    const locCounts: Record<string, number> = {};
    let locationTotal = 0;
    for (const t of teams) {
      for (const m of t.members) {
        const loc = (m.location || 'unknown').trim().toLowerCase() || 'unknown';
        locCounts[loc] = (locCounts[loc] || 0) + 1;
        locationTotal++;
      }
    }
    const locations = Object.entries(locCounts).sort((a, b) => b[1] - a[1]);

    // Completeness buckets
    const compBuckets = [
      { label: '80–100%', min: 0.8, max: 1.01, color: 'bg-lime-500/60' },
      { label: '60–80%',  min: 0.6, max: 0.8,  color: 'bg-yellow-500/60' },
      { label: '40–60%',  min: 0.4, max: 0.6,  color: 'bg-orange-500/60' },
      { label: '20–40%',  min: 0.2, max: 0.4,  color: 'bg-red-500/60' },
      { label: '0–20%',   min: 0,   max: 0.2,  color: 'bg-rose-600/60' },
    ].map((b) => ({
      ...b,
      count: teams.filter((t) => t.completeness_score >= b.min && t.completeness_score < b.max).length,
    }));

    // AI overall score distribution (1–5)
    const aiScoreBuckets: { label: string; count: number }[] = [5, 4, 3, 2, 1].map((s) => ({
      label: `★ ${s}`,
      count: teams.filter((t) => {
        const score = (t.ai_scores?.overall as any)?.score;
        return score !== null && score !== undefined && Math.round(Number(score)) === s;
      }).length,
    }));
    const aiScreened = teams.filter((t) => (t.ai_scores?.overall as any)?.score != null).length;

    // AI axis averages
    const axisKeys: [string, string][] = [
      ['genuineness', 'Genuineness'],
      ['solution_clarity', 'Solution clarity'],
      ['business_value', 'Business value'],
      ['novelty', 'Novelty'],
    ];
    const axisAvgs = axisKeys.map(([key, label]) => {
      const scores = teams
        .map((t) => {
          const v = (t.ai_scores?.[key] as any)?.score;
          return v != null ? Number(v) : null;
        })
        .filter((v): v is number => v !== null);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      return { label, avg: +avg.toFixed(2), count: scores.length, max: 5 };
    });

    // Team size distribution
    const sizeCounts: Record<string, number> = {};
    for (const t of teams) {
      const key = `${t.members.length} member${t.members.length === 1 ? '' : 's'}`;
      sizeCounts[key] = (sizeCounts[key] || 0) + 1;
    }
    const teamSizes = Object.entries(sizeCounts).sort((a, b) => {
      const aNum = parseInt(a[0]);
      const bNum = parseInt(b[0]);
      return bNum - aNum;
    });

    // Flag type breakdown
    const flagTypeCounts: Record<string, number> = {};
    for (const t of teams) {
      for (const f of t.flags || []) {
        const kind = f.split(':')[0];
        flagTypeCounts[kind] = (flagTypeCounts[kind] || 0) + 1;
      }
    }
    const flagTypes = Object.entries(flagTypeCounts).sort((a, b) => b[1] - a[1]);

    // Top 10 teams by AI score
    const top10 = [...teams]
      .filter((t) => (t.ai_scores?.overall as any)?.score != null)
      .sort((a, b) => {
        const aScore = (a.ai_scores?.overall as any)?.score ?? 0;
        const bScore = (b.ai_scores?.overall as any)?.score ?? 0;
        return Number(bScore) - Number(aScore);
      })
      .slice(0, 10);

    // T-shirt sizes
    const tshirtSizes = Object.entries(stats.tshirt_sizes || {}).sort((a, b) => b[1] - a[1]);
    const tshirtTotal = tshirtSizes.reduce((s, [, c]) => s + c, 0);

    return {
      locations, locationTotal,
      compBuckets,
      aiScoreBuckets, aiScreened,
      axisAvgs,
      teamSizes,
      flagTypes,
      top10,
      tshirtSizes, tshirtTotal,
    };
  }, [teams, stats]);

  const totalMembers = useMemo(() => {
    const seen = new Set<string>();
    for (const t of teams) for (const m of t.members) if (m.name) seen.add(m.name.toLowerCase());
    return seen.size;
  }, [teams]);

  const uniqueMentors = useMemo(() => {
    const s = new Set<string>();
    for (const t of teams) if (t.mentor_name) s.add(t.mentor_name.toLowerCase());
    return s.size;
  }, [teams]);

  const completeCount = teams.filter((t) => t.completeness_score >= 0.8).length;
  const completePct = teams.length ? Math.round((completeCount / teams.length) * 100) : 0;
  const aiPct = teams.length ? Math.round((derived.aiScreened / teams.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Overview tiles */}
      <Section title="Participation overview">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Tile label="Teams" value={teams.length} />
          <Tile label="Members" value={totalMembers} />
          <Tile label="Mentors" value={uniqueMentors} />
          <Tile label="Complete" value={`${completeCount} (${completePct}%)`} tone="text-lime-300" />
          <Tile label="AI screened" value={`${derived.aiScreened} (${aiPct}%)`} tone="text-sky-300" />
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Location distribution */}
        <Section title="Location distribution">
          {derived.locations.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No location data available.</p>
          ) : (
            <div className="space-y-2.5">
              {derived.locations.map(([loc, count]) => (
                <HBar
                  key={loc}
                  label={loc === 'us' ? 'United States' : loc === 'india' ? 'India' : loc === 'philippines' ? 'Philippines' : loc}
                  count={count}
                  total={derived.locationTotal}
                  color={
                    loc === 'india' ? 'bg-amber-500/60'
                    : loc === 'us' ? 'bg-sky-500/60'
                    : loc === 'philippines' ? 'bg-violet-500/60'
                    : 'bg-slate-500/60'
                  }
                />
              ))}
              <div className="text-xs text-slate-500 mt-1 text-right">{derived.locationTotal} total responses</div>
            </div>
          )}
        </Section>

        {/* Completeness distribution */}
        <Section title="Submission completeness">
          <div className="space-y-2.5">
            {derived.compBuckets.map((b) => (
              <HBar key={b.label} label={b.label} count={b.count} total={teams.length} color={b.color} />
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {completeCount} of {teams.length} teams have ≥ 80% completeness
          </div>
        </Section>

        {/* AI score distribution */}
        <Section title="AI screening — overall score distribution">
          {derived.aiScreened === 0 ? (
            <p className="text-sm text-slate-400 italic">No AI scores yet — run AI screening first.</p>
          ) : (
            <>
              <div className="space-y-2.5 mb-4">
                {derived.aiScoreBuckets.map((b) => (
                  <HBar
                    key={b.label}
                    label={b.label}
                    count={b.count}
                    total={derived.aiScreened}
                    color={b.label.startsWith('★ 5') || b.label.startsWith('★ 4') ? 'bg-lime-500/60' : b.label.startsWith('★ 3') ? 'bg-yellow-500/60' : 'bg-rose-500/60'}
                  />
                ))}
              </div>
              <div className="border-t border-slate-700/30 pt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-400 mb-2">Axis averages</div>
                {derived.axisAvgs.map((a) => (
                  <div key={a.label} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-slate-300 text-right">{a.label}</div>
                    <div className="flex-1 bg-ink-900 rounded-full h-3 overflow-hidden">
                      <div className="h-full bg-sky-500/50 rounded-full" style={{ width: `${(a.avg / a.max) * 100}%` }} />
                    </div>
                    <div className="w-16 text-xs text-slate-400 text-right">{a.avg} / 5</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>

        {/* Team size distribution */}
        <Section title="Team size distribution">
          <div className="space-y-2.5">
            {derived.teamSizes.map(([label, count]) => (
              <HBar key={label} label={label} count={count} total={teams.length} color="bg-sky-500/60" />
            ))}
          </div>
        </Section>

        {/* Flag breakdown */}
        {derived.flagTypes.length > 0 && (
          <Section title="Flag type breakdown">
            <div className="space-y-2.5">
              {derived.flagTypes.map(([kind, count]) => (
                <HBar
                  key={kind}
                  label={kind.replace(/_/g, ' ')}
                  count={count}
                  total={teams.length}
                  color="bg-amber-500/60"
                />
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-2">{stats.flagged_teams} teams have at least one flag</div>
          </Section>
        )}

        {/* T-shirt size breakdown */}
        {derived.tshirtSizes.length > 0 && (
          <Section title="T-shirt sizes (for swag procurement)">
            <div className="space-y-2.5">
              {derived.tshirtSizes.map(([size, count]) => (
                <HBar key={size} label={size.toUpperCase()} count={count} total={derived.tshirtTotal} color="bg-violet-500/60" />
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-2">{derived.tshirtTotal} total size responses</div>
          </Section>
        )}
      </div>

      {/* Top 10 teams by AI score */}
      {derived.top10.length > 0 && (
        <Section title="Top 10 teams by AI overall score">
          <div className="space-y-1.5">
            {derived.top10.map((t, idx) => {
              const score = (t.ai_scores?.overall as any)?.score;
              const headline = (t.ai_scores?.overall as any)?.headline || '';
              return (
                <button
                  key={t.id}
                  onClick={() => onJumpToTeam(t.id)}
                  className="w-full text-left flex items-center gap-3 bg-ink-900/60 hover:bg-lime-500/10 border border-transparent hover:border-lime-500/40 rounded-lg px-3 py-2 transition"
                >
                  <div className={`text-lg font-extrabold w-7 shrink-0 ${idx < 3 ? 'text-lime-300' : 'text-slate-500'}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-100 truncate">{t.name}</div>
                    {headline && <div className="text-xs text-slate-400 truncate">{headline}</div>}
                  </div>
                  <div className="shrink-0 text-xl font-extrabold text-lime-300">
                    {score}/5
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-xs text-slate-500 mt-2">Click a team to jump to its card on the Dashboard tab.</div>
        </Section>
      )}
    </div>
  );
}
