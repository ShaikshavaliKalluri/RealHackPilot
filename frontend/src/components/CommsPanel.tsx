import { useEffect, useState } from 'react';
import type { Team } from '../types';
import { commsMode, createTeamsChannels, postChannelWelcomeAll, fetchWelcomedTeamIds, adoptOrphanChannels, checkWelcomeMentions, type MentionsCheckResult } from '../api';

interface Props {
  teams: Team[];
  onReload: () => void;
}

export function CommsPanel({ teams, onReload }: Props) {
  const [mode, setMode] = useState<string>('mock');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeResult, setWelcomeResult] = useState<string | null>(null);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  // Team IDs that already received the welcome message (from comm log).
  // Used to compute the "remaining" count + visually flag what bulk-welcome
  // will skip.
  const [welcomedIds, setWelcomedIds] = useState<Set<number>>(new Set());
  const [showMissingList, setShowMissingList] = useState(false);
  const [showWelcomePending, setShowWelcomePending] = useState(false);
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [adoptResult, setAdoptResult] = useState<string | null>(null);
  const [mentionsBusy, setMentionsBusy] = useState(false);
  const [mentionsResult, setMentionsResult] = useState<MentionsCheckResult | null>(null);
  const [mentionsError, setMentionsError] = useState<string | null>(null);

  useEffect(() => {
    commsMode().then((r) => setMode(r.mode)).catch(() => {});
    fetchWelcomedTeamIds()
      .then((ids) => setWelcomedIds(new Set(ids)))
      .catch(() => setWelcomedIds(new Set()));
  }, []);

  const teamsWithoutChannel = teams
    .filter((t) => !t.has_teams_channel)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const teamsWithChannel = teams.filter((t) => t.has_teams_channel);
  // Teams that have a channel but haven't received the welcome message yet.
  // Used both for the bulk-welcome button count + the inline pending list.
  const teamsPendingWelcome = teamsWithChannel
    .filter((t) => !welcomedIds.has(t.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  // The 'Simulation mode' badge was added when the only channel-create path
  // was the mock-only bulk endpoint. The per-team 'Create Teams channel'
  // button (delegated Graph) always hits real Graph, so once any real
  // channel exists the simulation badge is misleading. Suppress it whenever
  // we can see real (non-mock prefix) channels in the DB.
  const hasRealChannel = teamsWithChannel.some(
    (t) => t.teams_channel_id != null && !String(t.teams_channel_id).match(/^(sandbox|mock|dryrun)-/i),
  );
  const isMock = mode === 'mock' && !hasRealChannel;

  const handleCreateChannels = async () => {
    if (teamsWithoutChannel.length === 0) return;
    const confirmText =
      `Create standard Microsoft Teams channels for ${teamsWithoutChannel.length} team${teamsWithoutChannel.length === 1 ? '' : 's'}?\n\n` +
      `Standard channels are visible to everyone in the parent RealHack Team (including judges + IT).\n` +
      `Takes ~${Math.ceil(teamsWithoutChannel.length * 1.5 / 60)} min — keep this tab open.`;
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await createTeamsChannels(teamsWithoutChannel.map((t) => t.id), null);
      const parts: string[] = [];
      parts.push(`Created ${r.created_count} channel${r.created_count === 1 ? '' : 's'}`);
      if (r.already_existing_count > 0) parts.push(`${r.already_existing_count} already existed`);
      if (r.failed_count > 0) parts.push(`${r.failed_count} failed`);
      setResult(parts.join(' · '));
      if (r.failed.length > 0) {
        const head = r.failed.slice(0, 3).map((f) => `${f.team_name}: ${f.error}`).join(' | ');
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} more)` : '';
        setError(`Failures: ${head}${more}`);
      }
      onReload();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAdoptOrphans = async () => {
    const confirmText =
      `Scan the parent RealHack Team for orphan channels?\n\n` +
      `This finds Teams channels that already exist in Microsoft Teams but aren't tracked in our DB, ` +
      `and adopts them (links the existing channel id to the matching team). No channels are created or deleted.`;
    if (!confirm(confirmText)) return;
    setAdoptBusy(true);
    setAdoptResult(null);
    setError(null);
    try {
      const r = await adoptOrphanChannels();
      const parts: string[] = [];
      parts.push(`Adopted ${r.adopted_count} channel${r.adopted_count === 1 ? '' : 's'}`);
      if (r.not_found_count > 0) parts.push(`${r.not_found_count} not found in Teams`);
      parts.push(`(parent team has ${r.parent_team_channel_count} channels total)`);
      setAdoptResult(parts.join(' · '));
      onReload();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setAdoptBusy(false);
    }
  };

  const handleCheckMentions = async () => {
    setMentionsBusy(true);
    setMentionsError(null);
    setMentionsResult(null);
    try {
      const r = await checkWelcomeMentions();
      setMentionsResult(r);
    } catch (e: any) {
      setMentionsError(e.message ?? String(e));
    } finally {
      setMentionsBusy(false);
    }
  };

  const handlePostWelcomeAll = async () => {
    const total = teamsWithChannel.length;
    if (total === 0) return;
    const confirmText =
      `Post the RealHack 2026 welcome message to all ${total} team channels?\n\n` +
      `Teams that already received a welcome will be skipped automatically.\n` +
      `This will take ~${Math.ceil(total * 1.5 / 60)} min — keep this tab open.`;
    if (!confirm(confirmText)) return;
    setWelcomeBusy(true);
    setWelcomeError(null);
    setWelcomeResult(null);
    try {
      const r = await postChannelWelcomeAll();
      const parts: string[] = [];
      parts.push(`Posted to ${r.posted_count} channel${r.posted_count === 1 ? '' : 's'}`);
      if (r.skipped_already_posted_count > 0) parts.push(`${r.skipped_already_posted_count} already posted (skipped)`);
      if (r.skipped_no_real_channel_count > 0) parts.push(`${r.skipped_no_real_channel_count} mock/sandbox (skipped)`);
      if (r.failed_count > 0) parts.push(`${r.failed_count} failed`);
      setWelcomeResult(parts.join(' · '));
      if (r.failed.length > 0) {
        // Surface the first few failure reasons inline for quick triage
        const head = r.failed.slice(0, 3).map((f) => `${f.team_name}: ${f.error}`).join(' | ');
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} more)` : '';
        setWelcomeError(`Failures: ${head}${more}`);
      }
      // Refresh the welcomed-ids cache so the pending count updates.
      try {
        const ids = await fetchWelcomedTeamIds();
        setWelcomedIds(new Set(ids));
      } catch {
        // non-fatal; refresh on next mount
      }
    } catch (e: any) {
      setWelcomeError(e.message ?? String(e));
    } finally {
      setWelcomeBusy(false);
    }
  };

  return (
    <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold">Teams channels</h3>
          <p className="text-sm text-slate-400">
            Create one Microsoft Teams channel per team (members &amp; mentor auto-added).
          </p>
        </div>
        {isMock && (
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 font-semibold" title="Today, channel creation is simulated. Real Teams channels will be created once IT approves the Microsoft Teams integration.">
            ⚠ Simulation mode · no real Teams channels created yet
          </span>
        )}
      </div>

      <div className="bg-ink-900/50 rounded-lg p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-300">
            <span className="text-lime-300 font-bold">{teams.length - teamsWithoutChannel.length}</span>
            <span className="text-slate-500"> / {teams.length}</span> teams already have channels.
          </p>
          {teamsWithoutChannel.length > 0 && (
            <>
              <button
                onClick={() => setShowMissingList((v) => !v)}
                className="text-xs text-slate-400 hover:text-amber-300 mt-1 transition underline-offset-2 hover:underline"
              >
                {teamsWithoutChannel.length} team{teamsWithoutChannel.length === 1 ? '' : 's'} still missing a channel{' '}
                <span className="text-slate-500">{showMissingList ? '▾ hide' : '▸ show names'}</span>
              </button>
              {showMissingList && (
                <ul className="text-xs text-slate-300 mt-2 ml-2 space-y-0.5 list-disc list-inside max-h-40 overflow-y-auto">
                  {teamsWithoutChannel.map((t) => (
                    <li key={t.id}>{t.name}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={adoptBusy || teamsWithoutChannel.length === 0}
            onClick={handleAdoptOrphans}
            className="text-xs px-3 py-2 rounded border border-slate-600 hover:border-amber-400 hover:bg-amber-500/10 text-slate-200 disabled:opacity-40 transition font-semibold"
            title="Scan the parent Team for channels that already exist in Microsoft Teams but aren't tracked in our DB, and link them up. Run this first if 'Create' is failing with 'Channel name already existed'."
          >
            {adoptBusy ? 'Scanning…' : '🔍 Discover & adopt orphans'}
          </button>
          <button
            disabled={busy || teamsWithoutChannel.length === 0}
            onClick={handleCreateChannels}
            className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
          >
            {busy ? 'Creating…' : teamsWithoutChannel.length === 0 ? 'All channels created' : `Create ${teamsWithoutChannel.length} missing channel${teamsWithoutChannel.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {result && <div className="text-sm text-lime-300 mt-3">✓ {result}</div>}
      {adoptResult && <div className="text-sm text-amber-300 mt-3">🔍 {adoptResult}</div>}
      {error && <div className="text-sm text-rose-300 mt-3">⚠ {error}</div>}

      {/* Bulk: post welcome message to every channel */}
      {teamsWithChannel.length > 0 && (
        <div className="bg-ink-900/50 rounded-lg p-4 mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-300">
              Post the <strong className="text-slate-100">RealHack 2026 welcome</strong> message in every team's channel.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Mentor + members get @mentioned.{' '}
              <span className="text-lime-300">{welcomedIds.size}</span> of {teamsWithChannel.length} channels already messaged.{' '}
              {teamsPendingWelcome.length > 0 ? (
                <>
                  <span className="text-amber-300 font-semibold">{teamsPendingWelcome.length}</span> pending.
                </>
              ) : (
                <span className="text-emerald-300">All caught up.</span>
              )}
            </p>
            {teamsPendingWelcome.length > 0 && (
              <>
                <button
                  onClick={() => setShowWelcomePending((v) => !v)}
                  className="text-xs text-slate-400 hover:text-amber-300 mt-1 transition underline-offset-2 hover:underline"
                >
                  {showWelcomePending ? '▾ hide pending list' : '▸ show pending team names'}
                </button>
                {showWelcomePending && (
                  <ul className="text-xs text-slate-300 mt-2 ml-2 space-y-0.5 list-disc list-inside max-h-40 overflow-y-auto">
                    {teamsPendingWelcome.map((t) => (
                      <li key={t.id}>{t.name}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <button
            disabled={welcomeBusy || teamsPendingWelcome.length === 0}
            onClick={handlePostWelcomeAll}
            className="bg-violet-400 hover:bg-violet-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
          >
            {welcomeBusy
              ? 'Posting…'
              : teamsPendingWelcome.length === 0
                ? '✓ All channels messaged'
                : `💬 Post welcome to ${teamsPendingWelcome.length} pending channel${teamsPendingWelcome.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {welcomeResult && <div className="text-sm text-lime-300 mt-3">✓ {welcomeResult}</div>}
      {welcomeError && <div className="text-sm text-rose-300 mt-3">⚠ {welcomeError}</div>}

      {/* Diagnostic: who isn't resolvable in AAD (=> didn't get @mentioned + can't see channel) */}
      <div className="bg-ink-900/50 rounded-lg p-4 mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-300">
            <strong className="text-slate-100">Check @mention coverage</strong> — scan every team and find members
            whose email doesn't resolve in Azure AD.
          </p>
          <p className="text-xs text-slate-400 mt-1">
            These are the same people that were silently skipped from the welcome @mention list AND can't see
            their team's channel (since channels inherit parent-Team membership and they can't be added). Takes
            ~10-15 seconds.
          </p>
        </div>
        <button
          disabled={mentionsBusy}
          onClick={handleCheckMentions}
          className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
        >
          {mentionsBusy ? 'Scanning…' : '🔎 Check @mention coverage'}
        </button>
      </div>

      {mentionsError && <div className="text-sm text-rose-300 mt-3">⚠ {mentionsError}</div>}

      {mentionsResult && (
        <div className="mt-3 bg-ink-900/50 rounded-lg p-4">
          <p className="text-sm text-slate-200 mb-3">
            Scanned <span className="text-lime-300 font-bold">{mentionsResult.total_unique_emails}</span> unique emails
            across <span className="text-lime-300 font-bold">{mentionsResult.total_teams}</span> teams.{' '}
            <span className="text-emerald-300">{mentionsResult.resolved_count} resolved</span>.{' '}
            {mentionsResult.unresolved_email_count > 0 ? (
              <span className="text-amber-300">{mentionsResult.unresolved_email_count} could not be resolved</span>
            ) : (
              <span className="text-emerald-300">All resolved — everyone got @mentioned.</span>
            )}
          </p>
          {mentionsResult.teams_with_issues.length > 0 ? (
            <details open className="text-xs">
              <summary className="cursor-pointer text-slate-300 font-semibold mb-2">
                Affected teams ({mentionsResult.teams_with_issues_count}) — these people would not have received the welcome ping or auto-channel access
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-ink-900/80 text-amber-200">
                      <th className="px-3 py-2 text-left border border-slate-700/60">Team</th>
                      <th className="px-3 py-2 text-left border border-slate-700/60">Role</th>
                      <th className="px-3 py-2 text-left border border-slate-700/60">Name</th>
                      <th className="px-3 py-2 text-left border border-slate-700/60">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mentionsResult.teams_with_issues.flatMap((t) =>
                      t.unresolved.map((p, i) => (
                        <tr key={`${t.team_id}-${i}`} className="hover:bg-ink-900/60">
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-200">
                            {i === 0 ? t.team_name : <span className="text-slate-500 italic">↳</span>}
                          </td>
                          <td className="px-3 py-1.5 border border-slate-700/60">
                            <span className={p.role === 'mentor' ? 'text-amber-300' : 'text-slate-400'}>
                              {p.role}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-slate-200">{p.name}</td>
                          <td className="px-3 py-1.5 border border-slate-700/60 text-rose-300 font-mono">{p.email}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
