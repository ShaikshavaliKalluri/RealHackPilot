import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { fetchTeams, fetchStats, runAIScreen, aiScreenStatus, aiScreenOne, llmHealth, fetchMe, exportCsv, exportDevOpsRepos, fetchMyRole, isSandboxMode, setSandboxMode, type LLMHealth, type AIScreenStatus, type UserProfile, type UserRole } from './api';
import { JudgeDashboard } from './components/JudgeDashboard';
import { JudgesPanel } from './components/JudgesPanel';
import { LoginQRPage } from './components/LoginQRPage';
import { SwagPanel } from './components/SwagPanel';
import { CreateTeamModal } from './components/CreateTeamModal';
import type { Team, DashboardStats } from './types';
import { StatCard } from './components/StatCard';
import { TeamCard } from './components/TeamCard';
import { UploadCard } from './components/UploadCard';
import { DrillDownPanel } from './components/DrillDownPanel';
import { EmailComposer } from './components/EmailComposer';
import { OrganizerScoring } from './components/OrganizerScoring';
import { CommsPanel } from './components/CommsPanel';
import { BroadcastPanel } from './components/BroadcastPanel';
import { ChatPanel } from './components/ChatPanel';
import { Analytics } from './components/Analytics';
import { LoginPage } from './components/LoginPage';
import { UserBadge } from './components/UserBadge';
import { WinnersBanner } from './components/WinnersBanner';

type Filter = 'all' | 'flagged' | 'complete' | 'incomplete';
type StatsPanel = 'duplicates' | 'mentors' | 'complete' | 'incomplete' | 'flagged' | 'all_mentors' | 'all_participants' | 'unique_people' | null;
type Mode = 'dashboard' | 'judge' | 'scoring' | 'comms' | 'analytics' | 'judges' | 'qr' | 'swag';

export default function App() {
  // ---- Auth (MSAL) ----
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  // Organizer-only: lets them preview the dashboard AS a specific judge to verify assignments.
  const [previewJudge, setPreviewJudge] = useState<{ id: number; name: string } | null>(null);
  // Mobile hamburger menu state — on screens narrower than `lg` the nav tabs
  // collapse into a dropdown rather than overflow horizontally.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() => {
    // Pick up any error stashed by main.tsx during MSAL bootstrap
    // (e.g. AADSTS50105 when Entra blocks a user not in the security group).
    try {
      const stashed = sessionStorage.getItem('msal:bootstrap_error');
      if (stashed) {
        sessionStorage.removeItem('msal:bootstrap_error');
        return stashed;
      }
    } catch {
      // sessionStorage unavailable — ignore
    }
    return null;
  });

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
    fetchMyRole()
      .then(setRole)
      .catch((e) => console.error('Role lookup failed:', e));
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
          (t.idea && t.idea.toLowerCase().includes(q)) ||
          t.members.some((m) => m.name.toLowerCase().includes(q)),
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

  // Wait for role lookup before routing — prevents flicker between organizer
  // and judge views while /api/me/role is loading.
  if (role === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  // Judges get the focused mobile-friendly view — no organizer tabs.
  if (role.role === 'judge' && role.judge_id) {
    return <JudgeDashboard judgeId={role.judge_id} judgeName={role.name || 'Judge'} user={user} />;
  }

  // Organizers can preview the judge dashboard AS a specific judge.
  if (role.role === 'organizer' && previewJudge) {
    return (
      <JudgeDashboard
        judgeId={previewJudge.id}
        judgeName={previewJudge.name}
        user={user}
        preview={{ onExit: () => setPreviewJudge(null) }}
      />
    );
  }

  // Users authenticated by Azure AD but not registered in our Judge table.
  if (role.role === 'none') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md bg-ink-800/60 border border-slate-700/40 rounded-xl p-6 text-center">
          <img src="/realhack-logo.png" alt="RealHack 2026" className="h-12 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-100 mb-2">Not registered for this app</h2>
          <p className="text-sm text-slate-400 mb-4">
            You're signed in as <span className="text-slate-200">{role.email || role.name}</span>, but you're not on the judge or organizer list yet. Please contact the RealHack organizers if this looks wrong.
          </p>
        </div>
      </div>
    );
  }

  // Tab definitions — single source of truth for both desktop horizontal nav
  // and the mobile hamburger dropdown. Order = display order.
  const TABS: { key: Mode; label: string; tone: string; title?: string }[] = [
    { key: 'dashboard', label: 'Dashboard', tone: 'bg-lime-500/15 text-lime-200 border-lime-500/30' },
    { key: 'scoring', label: 'Scoring', tone: 'bg-amber-500/15 text-amber-200 border-amber-500/30' },
    { key: 'comms', label: 'Comms', tone: 'bg-violet-500/15 text-violet-200 border-violet-500/30' },
    { key: 'analytics', label: 'Analytics', tone: 'bg-teal-500/15 text-teal-200 border-teal-500/30' },
    { key: 'judges', label: 'Judges', tone: 'bg-rose-500/15 text-rose-200 border-rose-500/30' },
    { key: 'swag', label: 'Swag', tone: 'bg-lime-500/15 text-lime-200 border-lime-500/30', title: 'Swag kit pickup tracker — search participants and mark collected' },
    { key: 'qr', label: 'Login QR', tone: 'bg-sky-500/15 text-sky-200 border-sky-500/30', title: 'Printable QR code for judges to scan and log in' },
  ];

  const sandboxOn = isSandboxMode();

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {sandboxOn && (
        <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8 mb-4 sm:mb-6 lg:mb-8 bg-amber-500/15 border-b-2 border-amber-400/60 px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 flex-wrap text-amber-100">
          <div className="text-sm">
            <span className="font-bold">🧪 TEST MODE</span>
            <span className="ml-2 text-amber-200/80">— reading/writing the sandbox database. Production data is safe.</span>
          </div>
          <button
            onClick={() => setSandboxMode(false)}
            className="text-xs px-3 py-1 rounded font-semibold bg-amber-400 hover:bg-amber-300 text-ink-950 transition"
          >
            Exit Test Mode
          </button>
        </div>
      )}
      <header className="mb-5 sm:mb-6 pb-4 sm:pb-5 border-b border-slate-800/60">
        <div className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          {/* Brand: official RealHack wordmark — smaller on mobile */}
          <img
            src="/realhack-logo.png"
            alt="RealHack 2026"
            className="h-10 sm:h-12 lg:h-14 -ml-1 shrink-0"
          />

          {/* Desktop controls (lg and up) */}
          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <nav className="flex gap-1 bg-ink-900/40 border border-slate-800/60 rounded-lg p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setMode(t.key)}
                  title={t.title}
                  className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition border ${
                    mode === t.key ? t.tone : 'text-slate-400 hover:text-white border-transparent hover:bg-ink-800/60'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            {user && (
              <UserBadge
                user={user}
                onPreviewAsJudge={
                  // Super-admin only — Preview-as-judge is a dev/QA tool, not a
                  // routine organizer feature. Locked to Shaik's email.
                  (user.email || '').trim().toLowerCase() === 'shaikshavali.kalluri@realpage.com'
                    ? (id, name) => setPreviewJudge({ id, name })
                    : undefined
                }
                showSandboxControls={
                  (user.email || '').trim().toLowerCase() === 'shaikshavali.kalluri@realpage.com'
                }
              />
            )}
          </div>

          {/* Mobile controls (below lg): hamburger + user avatar only */}
          <div className="flex lg:hidden items-center gap-2 shrink-0">
            {user && (
              <UserBadge
                user={user}
                onPreviewAsJudge={
                  (user.email || '').trim().toLowerCase() === 'shaikshavali.kalluri@realpage.com'
                    ? (id, name) => setPreviewJudge({ id, name })
                    : undefined
                }
                showSandboxControls={
                  (user.email || '').trim().toLowerCase() === 'shaikshavali.kalluri@realpage.com'
                }
              />
            )}
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Open menu"
              className="bg-ink-800/60 hover:bg-ink-800 border border-slate-700/40 rounded-lg p-2 transition"
            >
              <svg className="w-5 h-5 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu (only when open + below lg) */}
        {mobileMenuOpen && (
          <nav className="lg:hidden bg-ink-900/60 border border-slate-700/40 rounded-xl p-2 mb-4 space-y-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setMode(t.key); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition border ${
                  mode === t.key ? t.tone : 'text-slate-300 hover:text-white border-transparent hover:bg-ink-800/60'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          {mode === 'dashboard' && <>Registration <span className="text-lime-300">Command Center</span></>}
          {mode === 'scoring' && <>Scoring <span className="text-amber-300">&amp; Leaderboard</span></>}
          {mode === 'comms' && <>Teams <span className="text-violet-300">Channels &amp; Broadcast</span></>}
          {mode === 'analytics' && <>Analytics <span className="text-teal-300">&amp; Reporting</span></>}
          {mode === 'judges' && <>Judges <span className="text-rose-300">&amp; Assignments</span></>}
          {mode === 'qr' && <>Login <span className="text-sky-300">QR</span></>}
          {mode === 'swag' && <>Swag <span className="text-lime-300">Pickup</span></>}
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          {mode === 'dashboard' && 'Upload the latest MS Forms export. Teams get scored on completeness, screened for duplicates and rule violations, and surfaced in one place.'}
          {mode === 'scoring' && 'Live leaderboard aggregating judge scores per round, plus manual entry for organizers to log scores on behalf of a judge.'}
          {mode === 'comms' && 'Create per-team Microsoft Teams channels and broadcast announcements to every team at once.'}
          {mode === 'analytics' && 'Location heat map, completeness distribution, AI score breakdown, top teams, flag analysis, and swag procurement summary.'}
          {mode === 'judges' && 'Add judges, mark organizers, and assign which teams each judge sees on their mobile dashboard per round.'}
          {mode === 'qr' && 'Printable QR code for the judging room — judges scan with their phone camera and sign in via Azure AD.'}
          {mode === 'swag' && 'Event-day swag kit pickup tracker. Search by name or email, tap to mark collected. Multiple organizers can use this simultaneously from their phones — no more shared Excel.'}
        </p>
      </header>

      {mode === 'dashboard' && (
      <>
      <WinnersBanner teams={teams} onJumpToTeam={jumpToTeam} />

      <section className="mb-6 flex gap-3 items-stretch flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <UploadCard onUploaded={reload} />
        </div>
        <button
          onClick={() => setCreateTeamOpen(true)}
          className="bg-ink-800/60 hover:bg-ink-800 border border-slate-700/40 hover:border-lime-500/40 rounded-xl p-5 transition flex items-center gap-3 min-w-[200px]"
          title="Manually add a team that didn't come through the MS Forms import"
        >
          <div className="w-10 h-10 rounded-full bg-lime-500/15 border border-lime-500/40 flex items-center justify-center text-lime-300 text-xl font-bold shrink-0">+</div>
          <div className="text-left">
            <div className="font-bold text-slate-100">Add team manually</div>
            <div className="text-xs text-slate-400 mt-0.5">For late registrations</div>
          </div>
        </button>
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
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 sm:gap-3 lg:gap-4 mb-6">
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
            label="Unique people"
            value={stats.total_unique_people}
            onClick={() => setStatsPanel(statsPanel === 'unique_people' ? null : 'unique_people')}
            active={statsPanel === 'unique_people'}
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
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="Search team, member, mentor, or idea…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-ink-800/60 border border-slate-700/40 rounded-lg px-4 py-2 pr-9 text-sm focus:outline-none focus:border-lime-500/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700/60 transition text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
        <span className="text-sm text-slate-400">
          {filteredTeams.length} of {teams.length}
        </span>
        <button
          onClick={() => exportCsv().catch((e) => alert(`Export failed: ${e.message ?? e}`))}
          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-300 transition flex items-center gap-1.5"
          title="Download every team's full record (mentor, members, scores, idea, etc.) as a CSV"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
          </svg>
          Export to Excel
        </button>
        <button
          onClick={() => exportDevOpsRepos().catch((e) => alert(`Export failed: ${e.message ?? e}`))}
          className="text-xs px-3 py-1.5 rounded-lg border border-sky-500/40 hover:bg-sky-500/10 text-sky-300 transition flex items-center gap-1.5"
          title="Hand-off sheet for DevOps to create GitHub repos. One row per person, team name merged, Gitrepo url column blank for them to fill."
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          DevOps repo list
        </button>
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

      {mode === 'judges' && <JudgesPanel teams={teams} />}

      {mode === 'qr' && <LoginQRPage />}

      {mode === 'swag' && <SwagPanel />}

      <EmailComposer
        open={composerOpen}
        teams={teams}
        userEmail={user?.email}
        onClose={() => setComposerOpen(false)}
      />

      {createTeamOpen && (
        <CreateTeamModal
          onClose={() => setCreateTeamOpen(false)}
          onCreated={async () => { setCreateTeamOpen(false); await reload(); }}
        />
      )}

      <ChatPanel teams={teams} onJumpToTeam={jumpToTeam} />
    </div>
  );
}
