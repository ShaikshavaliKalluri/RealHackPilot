import { useMemo, useState } from 'react';
import type { Team } from '../types';

type Mode = 'duplicates' | 'mentors' | 'complete' | 'incomplete' | 'flagged' | 'all_mentors' | 'all_participants';

interface Props {
  mode: Mode;
  teams: Team[];
  onJumpToTeam: (teamId: number) => void;
  onClose: () => void;
}

interface DuplicateRow {
  name: string;
  teams: { id: number; name: string }[];
}

interface MentorRow {
  name: string;
  count: number;
  teams: { id: number; name: string }[];
}

interface TeamRow {
  id: number;
  name: string;
  mentor: string | null;
  memberCount: number;
  completeness: number;
  flags: string[];
}

function computeDuplicates(teams: Team[]): DuplicateRow[] {
  const map = new Map<string, { display: string; teamIds: Set<number>; teamNames: Map<number, string> }>();
  for (const t of teams) {
    for (const m of t.members) {
      if (!m.name) continue;
      const key = m.name.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { display: m.name.trim(), teamIds: new Set(), teamNames: new Map() });
      }
      const entry = map.get(key)!;
      entry.teamIds.add(t.id);
      entry.teamNames.set(t.id, t.name);
    }
  }
  const rows: DuplicateRow[] = [];
  for (const { display, teamIds, teamNames } of map.values()) {
    if (teamIds.size > 1) {
      rows.push({
        name: display,
        teams: Array.from(teamIds).map((id) => ({ id, name: teamNames.get(id) || '' })),
      });
    }
  }
  rows.sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));
  return rows;
}

function computeOverloadedMentors(teams: Team[]): MentorRow[] {
  const map = new Map<string, { display: string; teams: { id: number; name: string }[] }>();
  for (const t of teams) {
    if (!t.mentor_name) continue;
    const key = t.mentor_name.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, { display: t.mentor_name.trim(), teams: [] });
    }
    map.get(key)!.teams.push({ id: t.id, name: t.name });
  }
  const rows: MentorRow[] = [];
  for (const { display, teams: ts } of map.values()) {
    if (ts.length > 2) {
      rows.push({ name: display, count: ts.length, teams: ts });
    }
  }
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows;
}

function toTeamRow(t: Team): TeamRow {
  return {
    id: t.id,
    name: t.name,
    mentor: t.mentor_name,
    memberCount: t.members.length,
    completeness: t.completeness_score,
    flags: t.flags || [],
  };
}

function computeComplete(teams: Team[]): TeamRow[] {
  // Complete now means just "completeness_score >= 0.8" (regardless of flags).
  // Complete + Incomplete partition the total cleanly; Flagged is orthogonal.
  return teams
    .filter((t) => t.completeness_score >= 0.8)
    .map(toTeamRow)
    .sort((a, b) => b.completeness - a.completeness || a.name.localeCompare(b.name));
}

function computeIncomplete(teams: Team[]): TeamRow[] {
  // Just the score-based inverse of Complete. Sorted worst-first so the most
  // problematic submissions surface at the top of the drill-down.
  return teams
    .filter((t) => t.completeness_score < 0.8)
    .map(toTeamRow)
    .sort((a, b) => a.completeness - b.completeness || a.name.localeCompare(b.name));
}

function computeFlagged(teams: Team[]): TeamRow[] {
  return teams
    .filter((t) => t.flags && t.flags.length > 0)
    .map(toTeamRow)
    .sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
}

// Field-level reasons extracted from flags + completeness — used by the
// Incomplete drill-down so the user sees exactly what's missing per team.
const FIELD_LABELS: Record<string, string> = {
  idea: 'Idea',
  tools: 'Tech stack',
  approach: 'Approach',
  viability: 'Viability',
  business_value: 'Business value',
};

function missingFieldsFromFlags(flags: string[]): string[] {
  const missing: string[] = [];
  for (const f of flags) {
    if (f.startsWith('low_quality:')) {
      const field = f.split(':')[1];
      const label = FIELD_LABELS[field] || field;
      if (!missing.includes(label)) missing.push(label);
    }
  }
  return missing;
}

interface PersonRow {
  name: string;
  count: number;  // number of distinct teams
  teams: { id: number; name: string }[];
}

function computeAllMentors(teams: Team[]): PersonRow[] {
  const map = new Map<string, { display: string; teams: Map<number, string> }>();
  for (const t of teams) {
    if (!t.mentor_name) continue;
    const key = t.mentor_name.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { display: t.mentor_name.trim(), teams: new Map() });
    map.get(key)!.teams.set(t.id, t.name);
  }
  const rows: PersonRow[] = Array.from(map.values()).map(({ display, teams: ts }) => ({
    name: display,
    count: ts.size,
    teams: Array.from(ts.entries()).map(([id, name]) => ({ id, name })),
  }));
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows;
}

function computeAllParticipants(teams: Team[]): PersonRow[] {
  const map = new Map<string, { display: string; teams: Map<number, string> }>();
  for (const t of teams) {
    for (const m of t.members) {
      if (!m.name) continue;
      const key = m.name.trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, { display: m.name.trim(), teams: new Map() });
      map.get(key)!.teams.set(t.id, t.name);
    }
  }
  const rows: PersonRow[] = Array.from(map.values()).map(({ display, teams: ts }) => ({
    name: display,
    count: ts.size,
    teams: Array.from(ts.entries()).map(([id, name]) => ({ id, name })),
  }));
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows;
}

const TITLES: Record<Mode, string> = {
  duplicates: 'Participants on multiple teams',
  mentors: 'Mentors with more than 2 teams',
  complete: 'Teams with complete, clean submissions',
  incomplete: 'Teams that need follow-up',
  flagged: 'Teams with flags',
  all_mentors: 'All mentors (unique)',
  all_participants: 'All participants (unique)',
};

const TONES: Record<Mode, string> = {
  duplicates: 'text-rose-300',
  mentors: 'text-amber-300',
  complete: 'text-lime-300',
  incomplete: 'text-orange-300',
  flagged: 'text-amber-300',
  all_mentors: 'text-sky-300',
  all_participants: 'text-sky-300',
};

const flagSummary = (flags: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of flags) {
    const kind = f.split(':')[0];
    if (!seen.has(kind)) {
      seen.add(kind);
      out.push(kind);
    }
  }
  return out;
};

const labelForFlagKind = (kind: string): string => {
  switch (kind) {
    case 'low_quality': return 'Low detail';
    case 'duplicate_participant': return 'Duplicate member';
    case 'mentor_overloaded': return 'Mentor overloaded';
    case 'bad_location': return 'Bad location';
    case 'bad_tshirt': return 'Bad t-shirt';
    case 'team_too_small': return 'Team too small';
    case 'team_too_large': return 'Team too large';
    case 'missing_mentor': return 'Missing mentor';
    default: return kind;
  }
};

export function DrillDownPanel({ mode, teams, onJumpToTeam, onClose }: Props) {
  const [search, setSearch] = useState('');

  const dups = useMemo(() => (mode === 'duplicates' ? computeDuplicates(teams) : []), [mode, teams]);
  const ments = useMemo(() => (mode === 'mentors' ? computeOverloadedMentors(teams) : []), [mode, teams]);
  const complete = useMemo(() => (mode === 'complete' ? computeComplete(teams) : []), [mode, teams]);
  const incomplete = useMemo(() => (mode === 'incomplete' ? computeIncomplete(teams) : []), [mode, teams]);
  const flagged = useMemo(() => (mode === 'flagged' ? computeFlagged(teams) : []), [mode, teams]);
  const allMentors = useMemo(() => (mode === 'all_mentors' ? computeAllMentors(teams) : []), [mode, teams]);
  const allParticipants = useMemo(() => (mode === 'all_participants' ? computeAllParticipants(teams) : []), [mode, teams]);

  const peopleRows = mode === 'all_mentors' ? allMentors : mode === 'all_participants' ? allParticipants : [];
  const filteredPeople = useMemo(() => {
    if (!search.trim()) return peopleRows;
    const q = search.trim().toLowerCase();
    return peopleRows.filter((p) => p.name.toLowerCase().includes(q) || p.teams.some((t) => t.name.toLowerCase().includes(q)));
  }, [peopleRows, search]);

  const total =
    mode === 'duplicates' ? dups.length
    : mode === 'mentors' ? ments.length
    : mode === 'complete' ? complete.length
    : mode === 'incomplete' ? incomplete.length
    : mode === 'flagged' ? flagged.length
    : mode === 'all_mentors' ? allMentors.length
    : allParticipants.length;

  return (
    <div className="bg-ink-800/80 border border-slate-700/40 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-bold ${TONES[mode]}`}>
          {TITLES[mode]} <span className="text-slate-500 font-normal">({total})</span>
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">
          Close ✕
        </button>
      </div>

      {total === 0 && <p className="text-sm text-slate-400 italic">None found.</p>}

      {total > 0 && mode === 'duplicates' && (
        <div className="space-y-2">
          {dups.map((row, idx) => (
            <div key={idx} className="bg-ink-900/50 rounded px-3 py-2 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-slate-100">{row.name}</div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {row.teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onJumpToTeam(t.id)}
                    className="text-xs bg-ink-800 hover:bg-lime-500/20 border border-slate-700/40 hover:border-lime-500/50 px-2 py-0.5 rounded transition text-slate-200"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && mode === 'mentors' && (
        <div className="space-y-2">
          {ments.map((row, idx) => (
            <div key={idx} className="bg-ink-900/50 rounded px-3 py-2 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold text-slate-100">
                  {row.name}
                  <span className="ml-2 text-xs font-normal text-amber-400">{row.count} teams</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {row.teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onJumpToTeam(t.id)}
                    className="text-xs bg-ink-800 hover:bg-lime-500/20 border border-slate-700/40 hover:border-lime-500/50 px-2 py-0.5 rounded transition text-slate-200"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (mode === 'complete' || mode === 'flagged' || mode === 'incomplete') && (
        <div className="space-y-2">
          {(mode === 'complete' ? complete : mode === 'incomplete' ? incomplete : flagged).map((row) => {
            const missingFields = mode === 'incomplete' ? missingFieldsFromFlags(row.flags) : [];
            const otherFlags = mode === 'incomplete'
              ? flagSummary(row.flags).filter((k) => k !== 'low_quality')
              : flagSummary(row.flags);
            return (
              <button
                key={row.id}
                onClick={() => onJumpToTeam(row.id)}
                className="w-full text-left bg-ink-900/50 hover:bg-lime-500/10 border border-transparent hover:border-lime-500/40 rounded px-3 py-2 flex items-center justify-between gap-3 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-100 truncate">{row.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    Mentor: {row.mentor || '—'} · {row.memberCount} member{row.memberCount === 1 ? '' : 's'}
                  </div>
                  {mode === 'incomplete' && (missingFields.length > 0 || otherFlags.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {missingFields.map((f, i) => (
                        <span key={`f${i}`} className="text-xs bg-orange-500/15 border border-orange-500/40 text-orange-300 px-1.5 py-0.5 rounded">
                          Missing: {f}
                        </span>
                      ))}
                      {otherFlags.slice(0, 3).map((k, i) => (
                        <span key={`o${i}`} className="text-xs bg-ink-800 border border-amber-500/30 text-amber-300 px-1.5 py-0.5 rounded">
                          {labelForFlagKind(k)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {mode === 'flagged' ? (
                  <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                    {flagSummary(row.flags).slice(0, 4).map((k, i) => (
                      <span key={i} className="text-xs bg-ink-800 border border-amber-500/30 text-amber-300 px-1.5 py-0.5 rounded">
                        {labelForFlagKind(k)}
                      </span>
                    ))}
                    {flagSummary(row.flags).length > 4 && (
                      <span className="text-xs text-slate-400">+{flagSummary(row.flags).length - 4}</span>
                    )}
                  </div>
                ) : (
                  <div className={`text-lg font-extrabold shrink-0 ${
                    mode === 'incomplete' ? (row.completeness < 0.4 ? 'text-rose-300' : 'text-orange-300') : 'text-lime-300'
                  }`}>
                    {Math.round(row.completeness * 100)}%
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {total > 0 && (mode === 'all_mentors' || mode === 'all_participants') && (
        <>
          <input
            type="text"
            placeholder={`Search ${mode === 'all_mentors' ? 'mentors' : 'participants'} or teams…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-sky-500/60"
          />
          <p className="text-xs text-slate-500 mb-2">
            {filteredPeople.length} of {total} shown · click a team chip to jump
          </p>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {filteredPeople.map((row, idx) => (
              <div key={idx} className="bg-ink-900/50 rounded px-3 py-2 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">
                    {row.name}
                    {row.count > 1 && (
                      <span className="ml-2 text-xs font-normal text-amber-400">on {row.count} teams</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end max-w-[70%]">
                  {row.teams.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onJumpToTeam(t.id)}
                      className="text-xs bg-ink-800 hover:bg-sky-500/20 border border-slate-700/40 hover:border-sky-500/50 px-2 py-0.5 rounded transition text-slate-200"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
