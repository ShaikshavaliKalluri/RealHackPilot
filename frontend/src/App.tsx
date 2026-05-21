import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { fetchTeams, fetchStats, runAIScreen, aiScreenStatus, aiScreenOne, llmHealth, fetchMe, type LLMHealth, type AIScreenStatus, type UserProfile } from './api';
import type { Team, DashboardStats } from './types';
import { StatCard } from './components/StatCard';
import { TeamCard } from './components/TeamCard';
import { UploadCard } from './components/UploadCard';
import { DrillDownPanel } from './components/DrillDownPanel';
import { EmailComposer } from './components/EmailComposer';
import { JudgeMode } from './components/JudgeMode';
import { OrganizerScoring } from './components/OrganizerScoring';
import { CommsPanel } from './components/CommsPanel';
import { BroadcastPanel } from './components/BroadcastPanel';
import { ChatPanel } from './components/ChatPanel';
import { Analytics } from './components/Analytics';
import { LoginPage } from './components/LoginPage';
import { UserBadge } from './components/UserBadge';
import { WinnersBanner } from './components/WinnersBanner';

type Filter = 'all' | 'flagged' | 'complete' | 'incomplete';
type StatsPanel = 'duplicates' | 'mentors' | 'complete' | 'incomplete' | 'flagged' | 'all_mentors' | 'all_participants' | null;
type Mode = 'dashboard' | 'judge' | 'scoring' | 'comms' | 'analytics';

export default function App() {
  // ---- Auth (MSAL) ----
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // ---- Dashboard state ----
  const [teams, setTeams] = useState<Team[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);
  const [statsPanel, setStatsPanel] = useState<StatsPanel>(null);
  const teamRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [llm, setLlm] = useState<LLMHealth | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('dashboard');

  const reload = async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([fetchTeams(), fetchStats()]);
      setTeams(t);
      setStats(s);
    } finally {
      setLoading(false);
    }
  };

  // Auth gate: once authenticated, fetch profile + dashboard data
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMe()
      .then(setUser)
      .catch((e) => setAuthError(e.message || 'Failed to load profile'));
    reload().catch((e) => console.error(e));
    llmHealth().then(setLlm).catch((e) => console.error(e));
  }, [isAuthenticated]);

  const handleRunAIScreen = async (force = false) => {
    setAiBusy(true);
    setAiSummary('Starting AI screening...');
    try {
      const initial = await runAIScreen(force);
      // Poll until the background job is done. Backend returns scored/failed
      // as it processes each team, so we can show running progress.
      let last: AIScreenStatus = initial;
      const summarize = (s: AIScreenStatus, label: string) => {
        const providerLabel = Object.entries(s.providers).map(([p, c]) => `${p}×${c}`).join(', ');
        const provBit = providerLabel ? ` · via ${providerLabel}` : '';
        const failBit = s.failed ? ` · ${s.failed} failed` : '';
        return `${label}: ${s.scored} / ${s.total} team${s.total === 1 ? '' : 's'} scored${failBit}${provBit}`;
      };
      setAiSummary(summarize(last, 'AI screening'));
      while (last.status === 'running') {
        await new Promise((r) => setTimeout(r, 2500));
        last = await aiScreenStatus();
        setAiSummary(summarize(last, 'AI screening'));
      }
      if (last.status === 'error') {
        setAiSummary(`AI screening error: ${last.error ?? '(unknown)'}`);
      } else {
        setAiSummary(summarize(last, 'AI screening complete'));
      }
      await reload();
    } catch (e: any) {
      setAiSummary(`Error: ${e.message ?? String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const handleRescoreTeam = async (teamId: number) => {
    try {
      await aiScreenOne(teamId);
      await reload();
    } catch (e: any) {
      console.error(e);
      setAiSummary(`Rescore failed: ${e.message ?? String(e)}`);
    }
  };

  const filteredTeams = useMemo(() => {
    let list = teams;
    // Complete + Incomplete partition the total by completeness_score (>= 0.8).
    // Flagged is orthogonal — a team can be Complete AND Flagged (filled out
    // well but has, say, a duplicate member or mentor overloaded).
    if (filter === 'flagged') list = list.filter((t) => t.flags && t.flags.length > 0);
    if (filter === 'complete') list = list.filter((t) => t.completeness_score >= 0.8);
    if (filter === 'incomplete') list = list.filter((t) => t.completeness_score < 0.8);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.mentor_name && t.mentor_name.toLowerCase().includes(q)) ||
          (t.idea && t.idea.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [teams, filter, search]);

  const jumpToTeam = (teamId: number) => {
    // ensure team is in the visible filter set
    setFilter('all');
    setSearch('');
    setExpandedTeamId(teamId);
    setStatsPanel(null);
    setTimeout(() => {
      const node = teamRefs.current.get(teamId);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  // ---- Auth gate (placed AFTER all hooks so hook order stays stable
  // across renders — React requires hooks to be called in the same
  // order every render, hence no early returns before this point) ----
  if (inProgress !== 'none' && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) {
    return <LoginPage error={authError} />;
  }

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <img
            src="/realhack-logo.png"
            alt="RealHack 2026"
            className="h-10 mb-3"
          />
          <h1 className="text-4xl font-extrabold mt-1 tracking-tight">
            {mode === 'dashboard' && <>Registration <span className="text-lime-300">Command Center</span></>}
            {mode === 'judge' && <>Judge <span className="text-sky-300">Scorecard</span></>}
            {mode === 'scoring' && <>Scoring <span className="text-amber-300">&amp; Leaderboard</span></>}
            {mode === 'comms' && <>Teams <span className="text-violet-300">Channels &amp; Broadcast</span></>}
            {mode === 'analytics' && <>Analytics <span className="text-teal-300">&amp; Reporting</span></>}
          </h1>
          <p className="text-slate-400 mt-2 text-sm max-w-3xl">
            {mode === 'dashboard' && 'Upload the latest MS Forms export. Teams get scored on completeness, screened for duplicates and rule violations, and surfaced in one place.'}
            {mode === 'judge' && 'Sign in, pick a round, score each team against the rubric. Each judge can submit once per team per round.'}
            {mode === 'scoring' && 'Live leaderboard aggregating judge scores per round, plus manual entry for organizers to log scores on behalf of a judge.'}
            {mode === 'comms' && 'Create per-team Microsoft Teams channels and broadcast announcements to every team at once.'}
            {mode === 'analytics' && 'Location heat map, completeness distribution, AI score breakdown, top teams, flag analysis, and swag procurement summary.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/api/export.csv"
            className="bg-ink-800 hover:bg-ink-800/70 border border-slate-700/40 text-slate-200 font-semibold px-3 py-2 rounded-lg text-sm transition whitespace-nowrap"
            title="Download teams + scores as CSV (opens in Excel)"
          >
            Export CSV
          </a>
          <div className="flex gap-1 bg-ink-800/60 border border-slate-700/40 rounded-lg p-1">
            <button
              onClick={() => setMode('dashboard')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${mode === 'dashboard' ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setMode('judge')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${mode === 'judge' ? 'bg-sky-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            >
              Judge mode
            </button>
            <button
              onClick={() => setMode('scoring')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${mode === 'scoring' ? 'bg-amber-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            >
              Scoring
            </button>
            <button
              onClick={() => setMode('comms')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${mode === 'comms' ? 'bg-violet-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            >
              Comms
            </button>
            <button
              onClick={() => setMode('analytics')}
              className={`px-4 py-2 rounded text-sm font-semibold transition ${mode === 'analytics' ? 'bg-teal-400 text-ink-950' : 'text-slate-300 hover:text-white'}`}
            >
              Analytics
            </button>
          </div>
          {user && <UserBadge user={user} />}
        </div>
      </header>

      {mode === 'dashboard' && (
      <>
      <WinnersBanner teams={teams} onJumpToTeam={jumpToTeam} />

      <section className="mb-6">
        <UploadCard onUploaded={reload} />
      </section>

      <section className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h3 className="font-bold">AI screening</h3>
              <p className="text-sm text-slate-400">
                Score every submission on genuineness, solution clarity, business value &amp; novelty.
                {llm && (
                  <span className="ml-1 text-xs text-slate-500">
                    · provider: <span className="text-lime-300">{llm.active_provider}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={aiBusy || teams.length === 0}
              onClick={() => handleRunAIScreen(false)}
              className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
            >
              {aiBusy ? 'Screening…' : 'Run AI Screen'}
            </button>
            <button
              disabled={aiBusy || teams.length === 0}
              onClick={() => handleRunAIScreen(true)}
              className="bg-ink-900 hover:bg-ink-900/70 disabled:opacity-40 border border-slate-700/40 text-slate-200 font-semibold px-3 py-2 rounded-lg text-sm transition"
              title="Re-run AI screening on all teams (overwrites existing scores)"
            >
              Force rescore all
            </button>
          </div>
          {aiSummary && <p className="text-xs text-lime-300 mt-2">{aiSummary}</p>}
        </div>

        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
          <div className="mb-2">
            <h3 className="font-bold">Email &amp; comms</h3>
            <p className="text-sm text-slate-400">
              Compose fix-it, welcome, mentor-confirm or final-call mails — personalized per team, opened in Outlook.
            </p>
          </div>
          <button
            disabled={teams.length === 0}
            onClick={() => setComposerOpen(true)}
            className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
          >
            Compose email
          </button>
        </div>
      </section>


      {stats && (() => {
        const uniqueMentors = new Set<string>();
        for (const t of teams) {
          if (t.mentor_name && t.mentor_name.trim()) uniqueMentors.add(t.mentor_name.trim().toLowerCase());
        }
        const uniqueMembers = new Set<string>();
        for (const t of teams) {
          for (const m of t.members) {
            if (m.name && m.name.trim()) uniqueMembers.add(m.name.trim().toLowerCase());
          }
        }
        // Complete + Incomplete now partition by completeness alone, so they
        // sum to total_teams. Flagged is orthogonal and overlaps with both.
        // Computed in the frontend because stats.complete_teams from the API
        // still uses the old (score AND no-flags) definition.
        const completeCount = teams.filter((t) => t.completeness_score >= 0.8).length;
        const incompleteCount = teams.length - completeCount;
        return (
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
          <StatCard label="Teams" value={stats.total_teams} />
          <StatCard
            label="Mentors"
            value={uniqueMentors.size}
            onClick={() => setStatsPanel(statsPanel === 'all_mentors' ? null : 'all_mentors')}
            active={statsPanel === 'all_mentors'}
          />
          <StatCard
            label="Members"
            value={uniqueMembers.size}
            onClick={() => setStatsPanel(statsPanel === 'all_participants' ? null : 'all_participants')}
            active={statsPanel === 'all_participants'}
          />
          <StatCard
            label="Complete"
            value={completeCount}
            tone="success"
            onClick={() => setStatsPanel(statsPanel === 'complete' ? null : 'complete')}
            active={statsPanel === 'complete'}
          />
          <StatCard
            label="Incomplete"
            value={incompleteCount}
            tone="warn"
            onClick={() => setStatsPanel(statsPanel === 'incomplete' ? null : 'incomplete')}
            active={statsPanel === 'incomplete'}
          />
          <StatCard
            label="Flagged"
            value={stats.flagged_teams}
            tone="warn"
            onClick={() => setStatsPanel(statsPanel === 'flagged' ? null : 'flagged')}
            active={statsPanel === 'flagged'}
          />
          <StatCard
            label="Duplicate participants"
            value={stats.duplicate_participants}
            tone="danger"
            onClick={() => setStatsPanel(statsPanel === 'duplicates' ? null : 'duplicates')}
            active={statsPanel === 'duplicates'}
          />
          <StatCard
            label="Overloaded mentors"
            value={stats.multi_team_mentors}
            tone="danger"
            onClick={() => setStatsPanel(statsPanel === 'mentors' ? null : 'mentors')}
            active={statsPanel === 'mentors'}
          />
        </section>
        );
      })()}

      {statsPanel && (
        <DrillDownPanel
          mode={statsPanel}
          teams={teams}
          onJumpToTeam={jumpToTeam}
          onClose={() => setStatsPanel(null)}
        />
      )}

      <section className="flex flex-wrap gap-3 items-center mb-5">
        <div className="flex gap-1 bg-ink-800/60 border border-slate-700/40 rounded-lg p-1">
          {(['all', 'flagged', 'complete', 'incomplete'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-sm font-semibold capitalize transition ${
                filter === f ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search team, mentor, or idea…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[240px] bg-ink-800/60 border border-slate-700/40 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-lime-500/60"
        />
        <span className="text-sm text-slate-400">
          {filteredTeams.length} of {teams.length}
        </span>
      </section>

      {loading && teams.length === 0 ? (
        <div className="text-slate-400">Loading…</div>
      ) : teams.length === 0 ? (
        <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-10 text-center text-slate-400">
          No teams yet. Upload an MS Forms Excel export above to populate the dashboard.
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {filteredTeams.map((t) => (
            <div
              key={t.id}
              ref={(el) => {
                teamRefs.current.set(t.id, el);
              }}
              className={expandedTeamId === t.id ? 'lg:col-span-3 md:col-span-2' : ''}
            >
              <TeamCard
                team={t}
                expanded={expandedTeamId === t.id}
                onToggle={() => setExpandedTeamId(expandedTeamId === t.id ? null : t.id)}
                onRescore={() => handleRescoreTeam(t.id)}
                onReload={reload}
              />
            </div>
          ))}
        </section>
      )}
      </>
      )}

      {mode === 'judge' && user && <JudgeMode teams={teams} user={user} />}

      {mode === 'scoring' && <OrganizerScoring teams={teams} onReload={reload} />}

      {mode === 'analytics' && stats && (
        <Analytics teams={teams} stats={stats} onJumpToTeam={(id) => { setMode('dashboard'); setTimeout(() => jumpToTeam(id), 50); }} />
      )}

      {mode === 'comms' && (
        <div className="space-y-6">
          <CommsPanel teams={teams} onReload={reload} />
          <BroadcastPanel teams={teams} onReload={reload} />
        </div>
      )}

      <EmailComposer
        open={composerOpen}
        teams={teams}
        userEmail={user?.email}
        onClose={() => setComposerOpen(false)}
      />

      <ChatPanel teams={teams} onJumpToTeam={jumpToTeam} />
    </div>
  );
}
