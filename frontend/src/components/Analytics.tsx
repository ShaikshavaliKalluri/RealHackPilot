import { useMemo, useState } from 'react';
import type { Team, DashboardStats } from '../types';
import { backfillMentorLocations } from '../api';

interface Props {
  teams: Team[];
  stats: DashboardStats;
  onJumpToTeam: (teamId: number) => void;
}

// Pretty-print the location field used internally (lowercase enum-ish) for
// the CSV exports and chart labels. Our data doesn't have separate city/
// country fields — location IS the country — so the exports populate
// "Country" with the same value and leave "Address" empty.
function prettyLocation(loc: string | null | undefined): string {
  const v = (loc ?? '').trim();
  if (!v) return 'Unknown';
  const lower = v.toLowerCase();
  if (lower === 'us') return 'United States';
  if (lower === 'uk') return 'United Kingdom';
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Quote a CSV cell per RFC 4180.
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Trigger a client-side CSV download. Excel opens .csv natively; users
// can Save-As .xlsx inside Excel if they want a real workbook. We prefix
// with a UTF-8 BOM so Excel renders non-ASCII names correctly.
function downloadCsv(
  filename: string,
  header: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
// `relative` is needed so ExportButton (absolutely-positioned top-right)
// anchors to the section box and not the viewport.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
      <h3 className="font-bold text-slate-100 mb-4 pr-32">{title}</h3>
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

// ---- Small "Export to Excel" link rendered top-right of a Section ----
function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-4 right-4 text-[11px] px-2.5 py-1 rounded-md border border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-300 transition flex items-center gap-1"
      title="Download as a .csv (opens in Excel)"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
      </svg>
      {label}
    </button>
  );
}

// ---- Location bar list reused by the mentor + member charts ----
function LocationBars({
  entries, total, emptyLabel,
}: { entries: [string, number][]; total: number; emptyLabel: string }) {
  if (entries.length === 0) return <p className="text-sm text-slate-400 italic">{emptyLabel}</p>;
  return (
    <div className="space-y-2.5">
      {entries.map(([loc, count]) => (
        <HBar
          key={loc}
          label={loc === 'us' ? 'United States' : loc === 'india' ? 'India' : loc === 'philippines' ? 'Philippines' : loc === 'unknown' ? 'Unknown' : loc}
          count={count}
          total={total}
          color={
            loc === 'india' ? 'bg-amber-500/60'
            : loc === 'us' ? 'bg-sky-500/60'
            : loc === 'philippines' ? 'bg-violet-500/60'
            : loc === 'unknown' ? 'bg-slate-600/40'
            : 'bg-emerald-500/60'
          }
        />
      ))}
      <div className="text-xs text-slate-500 mt-1 text-right">{total} total</div>
    </div>
  );
}

export function Analytics({ teams, stats, onJumpToTeam, onReload }: Props & { onReload?: () => void }) {
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const handleBackfill = async () => {
    setBackfillBusy(true);
    setBackfillMsg(null);
    try {
      const r = await backfillMentorLocations();
      const parts = [];
      if ((r.member_locations_set ?? 0) > 0) parts.push(`${r.member_locations_set} member location${r.member_locations_set === 1 ? '' : 's'}`);
      if ((r.mentor_addresses_set ?? 0) > 0) parts.push(`${r.mentor_addresses_set} mentor address${r.mentor_addresses_set === 1 ? '' : 'es'}`);
      if ((r.member_addresses_set ?? 0) > 0) parts.push(`${r.member_addresses_set} member address${r.member_addresses_set === 1 ? '' : 'es'}`);
      setBackfillMsg(parts.length ? `Recovered: ${parts.join(', ')}.` : 'Nothing new to recover.');
      if (onReload) onReload();
    } catch (e: unknown) {
      setBackfillMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackfillBusy(false);
    }
  };
  // One-shot backfill: pull mentor_location / mentor_tshirt_size from each
  // team's stored `raw` JSON for teams imported before those columns were
  // captured. Reloads the parent on success so the chart re-renders.
  const derived = useMemo(() => {
    // ===== Dual-role detection =====
    // First pass: build an email -> first matching member row, used as the
    // fallback for mentor location when the mentor record has no location
    // of its own (legacy registrations from before the field existed).
    const memberByEmail = new Map<string, { name: string; location: string | null; tshirt: string | null }>();
    for (const t of teams) {
      for (const m of t.members) {
        if (m.email) {
          const k = m.email.toLowerCase();
          if (!memberByEmail.has(k)) {
            memberByEmail.set(k, { name: m.name, location: m.location, tshirt: m.tshirt_size });
          }
        }
      }
    }
    const mentorEmails = new Set<string>();
    for (const t of teams) {
      if (t.mentor_email) mentorEmails.add(t.mentor_email.trim().toLowerCase());
    }
    // Dual-role: an email that appears both as a team member AND as somebody's
    // mentor somewhere. Flagged on the charts and tagged in the CSV exports.
    const dualRoleEmails = new Set<string>();
    for (const [memberEmail] of memberByEmail) {
      if (mentorEmails.has(memberEmail)) dualRoleEmails.add(memberEmail);
    }

    // ===== Team member location distribution (deduped by email) =====
    const memberSeen = new Set<string>();
    const memberLocCounts: Record<string, number> = {};
    const memberCsvRows: (string | number | null | undefined)[][] = [];
    for (const t of teams) {
      for (const m of t.members) {
        const key = (m.email || `${t.id}:${m.name}`).toLowerCase();
        if (memberSeen.has(key)) continue;
        memberSeen.add(key);
        const locLower = (m.location || 'unknown').trim().toLowerCase() || 'unknown';
        memberLocCounts[locLower] = (memberLocCounts[locLower] || 0) + 1;
        const dual = m.email && dualRoleEmails.has(m.email.toLowerCase());
        memberCsvRows.push([
          t.name,
          m.name,
          m.email ?? '',
          prettyLocation(m.location),
          m.address ?? '',
          prettyLocation(m.location),
          m.tshirt_size ?? '',
          dual ? 'Yes (also a mentor)' : '',
        ]);
      }
    }
    const memberLocations = Object.entries(memberLocCounts).sort((a, b) => b[1] - a[1]);
    const memberLocationTotal = Object.values(memberLocCounts).reduce((s, c) => s + c, 0);

    // ===== Mentor location distribution (deduped by mentor email) =====
    // Prefer the mentor's own mentor_location field; fall back to looking
    // them up in the member roster by email (in case they happen to also be
    // on a team — common for senior engineers).
    const mentorSeen = new Set<string>();
    const mentorLocCounts: Record<string, number> = {};
    const mentorCsvRows: (string | number | null | undefined)[][] = [];
    for (const t of teams) {
      const key = (t.mentor_email || t.mentor_name || '').trim().toLowerCase();
      if (!key) continue;
      if (mentorSeen.has(key)) continue;
      mentorSeen.add(key);
      const matched = t.mentor_email ? memberByEmail.get(t.mentor_email.toLowerCase()) : undefined;
      const mentorLoc = t.mentor_location || matched?.location || null;
      const locLower = (mentorLoc || 'unknown').trim().toLowerCase() || 'unknown';
      mentorLocCounts[locLower] = (mentorLocCounts[locLower] || 0) + 1;
      const dual = t.mentor_email && memberByEmail.has(t.mentor_email.toLowerCase());
      mentorCsvRows.push([
        t.name,
        t.mentor_name ?? '',
        t.mentor_email ?? '',
        prettyLocation(mentorLoc),
        t.mentor_address ?? '',
        prettyLocation(mentorLoc),
        t.mentor_tshirt_size ?? '',
        dual ? 'Yes (also on a team)' : '',
      ]);
    }
    const mentorLocations = Object.entries(mentorLocCounts).sort((a, b) => b[1] - a[1]);
    const mentorLocationTotal = Object.values(mentorLocCounts).reduce((s, c) => s + c, 0);

    // ===== T-shirt sizing — dedupe by email, members + mentors, everyone
    //       included (people who didn't fill in a size get "No response").
    //       Chart counts are computed here too so they match the CSV exactly.
    const SHIPPING_LOCS = new Set(['us', 'united states', 'philippines']);
    const isShipping = (loc: string | null | undefined) =>
      SHIPPING_LOCS.has((loc ?? '').trim().toLowerCase());

    const tshirtCsvRows: (string | number | null | undefined)[][] = [];
    const tshirtSeen = new Set<string>();
    const tshirtSizeMap: Record<string, number> = {};
    let tshirtNoResponse = 0;
    let missingAddressCount = 0;
    const missingAddressSeen = new Set<string>();
    for (const t of teams) {
      for (const m of t.members) {
        const key = (m.email || `${t.id}:${m.name}`).toLowerCase();
        if (tshirtSeen.has(key)) continue;
        tshirtSeen.add(key);
        if (!m.tshirt_size) {
          tshirtNoResponse++;
        } else {
          tshirtSizeMap[m.tshirt_size] = (tshirtSizeMap[m.tshirt_size] || 0) + 1;
        }
        const needsAddr = isShipping(m.location);
        const missingAddr = needsAddr && !(m.address && m.address.trim());
        if (missingAddr && !missingAddressSeen.has(key)) {
          missingAddressSeen.add(key);
          missingAddressCount++;
        }
        tshirtCsvRows.push([
          t.name,
          m.name,
          m.email ?? '',
          prettyLocation(m.location),
          m.address ?? '',
          prettyLocation(m.location),
          m.tshirt_size || 'No response',
          'Member',
          missingAddr ? 'Yes' : '',
        ]);
      }
      const mentorKey = (t.mentor_email || t.mentor_name || '').trim().toLowerCase();
      if (mentorKey && !tshirtSeen.has(mentorKey)) {
        tshirtSeen.add(mentorKey);
        if (!t.mentor_tshirt_size) {
          tshirtNoResponse++;
        } else {
          tshirtSizeMap[t.mentor_tshirt_size] = (tshirtSizeMap[t.mentor_tshirt_size] || 0) + 1;
        }
        const mentorNeedsAddr = isShipping(t.mentor_location);
        const mentorMissingAddr = mentorNeedsAddr && !(t.mentor_address && t.mentor_address.trim());
        if (mentorMissingAddr && !missingAddressSeen.has(mentorKey)) {
          missingAddressSeen.add(mentorKey);
          missingAddressCount++;
        }
        tshirtCsvRows.push([
          t.name,
          t.mentor_name ?? '',
          t.mentor_email ?? '',
          prettyLocation(t.mentor_location),
          t.mentor_address ?? '',
          prettyLocation(t.mentor_location),
          t.mentor_tshirt_size || 'No response',
          'Mentor',
          mentorMissingAddr ? 'Yes' : '',
        ]);
      }
    }
    const tshirtSizesFromData = Object.entries(tshirtSizeMap).sort((a, b) => b[1] - a[1]);
    const tshirtTotalFromData = Object.values(tshirtSizeMap).reduce((s, c) => s + c, 0);

    // Keep `locations`/`locationTotal` referencing the member view for any
    // legacy chart that still uses it (we're removing the inline chart below
    // and replacing with the new top-row layout).
    const locations = memberLocations;
    const locationTotal = memberLocationTotal;

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
          const v = (t.ai_scores as any)?.[key]?.score;
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

    // Top 10 teams by AI score; tiebreak by sum of axis scores
    const AXIS_KEYS = ['genuineness', 'solution_clarity', 'business_value', 'novelty'] as const;
    const axisSum = (t: Team) =>
      AXIS_KEYS.reduce((s, k) => s + (Number((t.ai_scores as any)?.[k]?.score) || 0), 0);
    const top10 = [...teams]
      .filter((t) => (t.ai_scores?.overall as any)?.score != null)
      .sort((a, b) => {
        const diff = Number((b.ai_scores?.overall as any)?.score ?? 0) - Number((a.ai_scores?.overall as any)?.score ?? 0);
        return diff !== 0 ? diff : axisSum(b) - axisSum(a);
      })
      .slice(0, 10);

    // T-shirt sizes
    const tshirtSizes = Object.entries(stats.tshirt_sizes || {}).sort((a, b) => b[1] - a[1]);
    const tshirtTotal = tshirtSizes.reduce((s, [, c]) => s + c, 0);

    return {
      locations, locationTotal,
      memberLocations, memberLocationTotal, memberCsvRows,
      mentorLocations, mentorLocationTotal, mentorCsvRows,
      tshirtCsvRows, tshirtNoResponse, missingAddressCount,
      tshirtSizesFromData, tshirtTotalFromData,
      dualRoleEmails,
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

      {/* === Top row: mentor / member locations + tshirt sizing — with Excel exports === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section title="Mentor location distribution">
          <ExportButton
            label="Export to Excel"
            onClick={() => downloadCsv(
              'realhack-2026_mentor-locations.csv',
              ['Team Name', 'Mentor Name', 'Mentor Email', 'Location', 'Address', 'Country', 'T-shirt Size', 'Dual-Role'],
              derived.mentorCsvRows,
            )}
          />
          <LocationBars
            entries={derived.mentorLocations}
            total={derived.mentorLocationTotal}
            emptyLabel="No mentor data."
          />
          {derived.dualRoleEmails.size > 0 && (
            <div className="text-[11px] text-amber-300 mt-2">
              ⚠ {derived.dualRoleEmails.size} mentor{derived.dualRoleEmails.size === 1 ? '' : 's'} also listed as a team member.
            </div>
          )}
        </Section>

        <Section title="Team member location distribution">
          <ExportButton
            label="Export to Excel"
            onClick={() => downloadCsv(
              'realhack-2026_team-member-locations.csv',
              ['Team Name', 'Team Member Name', 'Member Email', 'Location', 'Address', 'Country', 'T-shirt Size', 'Dual-Role'],
              derived.memberCsvRows,
            )}
          />
          <LocationBars
            entries={derived.memberLocations}
            total={derived.memberLocationTotal}
            emptyLabel="No member location data available."
          />
          {derived.dualRoleEmails.size > 0 && (
            <div className="text-[11px] text-amber-300 mt-2">
              ⚠ {derived.dualRoleEmails.size} member{derived.dualRoleEmails.size === 1 ? '' : 's'} also listed as a mentor on another team.
            </div>
          )}
        </Section>

        <Section title="T-shirt sizes (for swag procurement)">
          <ExportButton
            label="Export to Excel"
            onClick={() => downloadCsv(
              'realhack-2026_tshirt-sizes.csv',
              ['Team Name', 'Name', 'Email', 'Location', 'Address', 'Country', 'T-shirt Size', 'Role', 'Missing Address (US/PH)'],
              derived.tshirtCsvRows,
            )}
          />
          {derived.tshirtSizesFromData.length === 0 && derived.tshirtNoResponse === 0 ? (
            <p className="text-sm text-slate-400 italic">No size data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {derived.tshirtSizesFromData.map(([size, count]) => (
                <HBar key={size} label={size.toUpperCase()} count={count} total={derived.tshirtTotalFromData + derived.tshirtNoResponse} color="bg-violet-500/60" />
              ))}
              {derived.tshirtNoResponse > 0 && (
                <HBar key="no-response" label="No response" count={derived.tshirtNoResponse} total={derived.tshirtTotalFromData + derived.tshirtNoResponse} color="bg-slate-600/40" />
              )}
              <div className="text-xs text-slate-500 mt-1 text-right">
                {derived.tshirtTotalFromData + derived.tshirtNoResponse} total · {derived.tshirtNoResponse} no response
              </div>
              {derived.missingAddressCount > 0 && (
                <div className="text-[11px] text-amber-300 mt-1.5">
                  ⚠ {derived.missingAddressCount} US/Philippines participant{derived.missingAddressCount === 1 ? '' : 's'} missing shipping address — check &quot;Export to Excel&quot; for details.
                </div>
              )}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-slate-700/30 flex flex-col gap-1">
            <button
              onClick={handleBackfill}
              disabled={backfillBusy}
              className="self-start text-[11px] px-2.5 py-1 rounded-md border border-sky-500/40 hover:bg-sky-500/10 text-sky-300 disabled:opacity-50 transition"
              title="Recover mailing addresses from the original form data for existing teams"
            >
              {backfillBusy ? 'Recovering…' : 'Recover addresses from form data'}
            </button>
            {backfillMsg && <div className="text-[11px] text-slate-400">{backfillMsg}</div>}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
