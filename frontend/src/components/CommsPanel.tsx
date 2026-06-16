import { useEffect, useState } from 'react';
import type { Team } from '../types';
import {
  commsMode,
  createTeamsChannels,
  postChannelWelcomeAll,
  postChannelQrAll,
  fetchWelcomedTeamIds,
  fetchQrPostedTeamIds,
  adoptOrphanChannels,
  checkWelcomeMentions,
  importRepoUrlsFromXlsx,
  postChannelRepoReadyAll,
  fetchRepoReadyPostedTeamIds,
  type MentionsCheckResult,
  type RepoUrlImportResult,
  type PostRepoReadyBulkResult,
} from '../api';

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
  const [qrBusy, setQrBusy] = useState(false);
  const [qrResult, setQrResult] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrPostedIds, setQrPostedIds] = useState<Set<number>>(new Set());

  // Repo-ready announcement flow: upload DevOps xlsx -> bulk-post.
  const [repoFile, setRepoFile] = useState<File | null>(null);
  const [repoImportBusy, setRepoImportBusy] = useState(false);
  const [repoImportResult, setRepoImportResult] = useState<RepoUrlImportResult | null>(null);
  const [repoImportError, setRepoImportError] = useState<string | null>(null);
  const [repoPostBusy, setRepoPostBusy] = useState(false);
  const [repoPostResult, setRepoPostResult] = useState<PostRepoReadyBulkResult | null>(null);
  const [repoPostError, setRepoPostError] = useState<string | null>(null);
  const [repoPostedIds, setRepoPostedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    commsMode().then((r) => setMode(r.mode)).catch(() => {});
    fetchWelcomedTeamIds()
      .then((ids) => setWelcomedIds(new Set(ids)))
      .catch(() => setWelcomedIds(new Set()));
    fetchQrPostedTeamIds()
      .then((ids) => setQrPostedIds(new Set(ids)))
      .catch(() => setQrPostedIds(new Set()));
    fetchRepoReadyPostedTeamIds()
      .then((ids) => setRepoPostedIds(new Set(ids)))
      .catch(() => setRepoPostedIds(new Set()));
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
  // Same shape as pending-welcome but for the QR-code message — drives the
  // bulk QR button label so it shows 'remaining' not always 95.
  const teamsPendingQr = teamsWithChannel.filter((t) => !qrPostedIds.has(t.id));
  // Repo-ready bulk-post pending = has a channel + has repo_url + not already messaged.
  const teamsWithRepo = teamsWithChannel.filter((t) => !!(t.repo_url || '').trim());
  const teamsPendingRepoReady = teamsWithRepo.filter((t) => !repoPostedIds.has(t.id));
  const teamsWithChannelMissingRepo = teamsWithChannel.filter((t) => !(t.repo_url || '').trim());
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

  const handlePostQrAll = async () => {
    const confirmText =
      `Post the QR-code message to every team's channel?\n\n` +
      `Each team gets a personalized message with their own QR code (encodes the team's /team/<id> URL) embedded inline. Teams already posted are skipped.\n\n` +
      `Takes ~3-4 min for ~${teamsWithChannel.length} channels (QR generation + Graph post per team).`;
    if (!confirm(confirmText)) return;
    setQrBusy(true);
    setQrError(null);
    setQrResult(null);
    try {
      const r = await postChannelQrAll();
      const parts: string[] = [];
      parts.push(`QR posted to ${r.posted_count} channel${r.posted_count === 1 ? '' : 's'}`);
      if (r.skipped_already_posted_count > 0) parts.push(`${r.skipped_already_posted_count} already posted`);
      if (r.skipped_no_real_channel_count > 0) parts.push(`${r.skipped_no_real_channel_count} mock/sandbox skipped`);
      if (r.failed_count > 0) parts.push(`${r.failed_count} failed`);
      setQrResult(parts.join(' · '));
      if (r.failed.length > 0) {
        const head = r.failed.slice(0, 3).map((f) => `${f.team_name}: ${f.error}`).join(' | ');
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} more)` : '';
        setQrError(`Failures: ${head}${more}`);
      }
      // Refresh the qr-posted cache so the bulk button label updates.
      try {
        const ids = await fetchQrPostedTeamIds();
        setQrPostedIds(new Set(ids));
      } catch {
        // non-fatal; refresh on next mount
      }
    } catch (e: any) {
      setQrError(e.message ?? String(e));
    } finally {
      setQrBusy(false);
    }
  };

  // === Repo-ready handlers ===
  const handleImportRepoUrls = async () => {
    if (!repoFile) return;
    setRepoImportBusy(true);
    setRepoImportError(null);
    setRepoImportResult(null);
    try {
      const r = await importRepoUrlsFromXlsx(repoFile);
      setRepoImportResult(r);
      // Refresh the parent teams list so the new repo_urls show up everywhere.
      onReload();
    } catch (e: any) {
      setRepoImportError(e.message ?? String(e));
    } finally {
      setRepoImportBusy(false);
    }
  };

  const handlePostRepoReadyAll = async (force: boolean) => {
    const target = force ? teamsWithRepo.length : teamsPendingRepoReady.length;
    if (target === 0) return;
    const confirmText = force
      ? `RE-POST the 'GitHub repo is ready' announcement to all ${teamsWithRepo.length} team channels with a repo_url on file?\n\n` +
        `This BYPASSES the 'already posted' check -- every team will get the message again, even those who already received it. Use this only when the template text itself has changed.\n\n` +
        `Takes ~${Math.ceil(target * 0.7 / 60)} min. Keep this tab open.`
      : `Post the 'GitHub repo is ready' announcement to ${target} pending team channel${target === 1 ? '' : 's'}?\n\n` +
        `Teams without a repo URL on file (run the xlsx import first) and teams already posted are skipped automatically.\n\n` +
        `Takes ~${Math.ceil(target * 0.7 / 60)} min. Keep this tab open.`;
    if (!confirm(confirmText)) return;
    setRepoPostBusy(true);
    setRepoPostError(null);
    setRepoPostResult(null);
    try {
      const r = await postChannelRepoReadyAll(force);
      setRepoPostResult(r);
      if (r.failed.length > 0) {
        const head = r.failed.slice(0, 3).map((f) => `${f.team_name}: ${f.error}`).join(' | ');
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} more)` : '';
        setRepoPostError(`Failures: ${head}${more}`);
      }
      try {
        const ids = await fetchRepoReadyPostedTeamIds();
        setRepoPostedIds(new Set(ids));
      } catch {
        // non-fatal; refresh on next mount
      }
    } catch (e: any) {
      setRepoPostError(e.message ?? String(e));
    } finally {
      setRepoPostBusy(false);
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

      {/* Bulk: post QR code message to every channel */}
      {teamsWithChannel.length > 0 && (
        <div className="bg-ink-900/50 rounded-lg p-4 mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-300">
              Post the <strong className="text-slate-100">team QR-code</strong> message in every team's channel.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Each team gets a personalized message with their own QR code (links to <code className="text-slate-300">/team/&lt;id&gt;</code>) inlined as an image. Teams already messaged are skipped. ~3-4 min.
            </p>
          </div>
          <button
            disabled={qrBusy || teamsPendingQr.length === 0}
            onClick={handlePostQrAll}
            className="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
          >
            {qrBusy
              ? 'Posting…'
              : teamsPendingQr.length === 0
                ? `✓ QR posted to all ${teamsWithChannel.length}`
                : `📱 Post QR to ${teamsPendingQr.length} pending channel${teamsPendingQr.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {qrResult && <div className="text-sm text-lime-300 mt-3">✓ {qrResult}</div>}
      {qrError && <div className="text-sm text-rose-300 mt-3">⚠ {qrError}</div>}

      {/* ===== GitHub repo-ready announcement ===== */}
      {teamsWithChannel.length > 0 && (
        <div className="bg-ink-900/50 rounded-lg p-4 mt-3">
          <p className="text-sm text-slate-300 font-semibold mb-1">
            📦 GitHub repo-ready announcement
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Two-step. <strong>1)</strong> Upload the DevOps xlsx — backend matches by Team Name and stores each <code className="text-slate-300">repo_url</code>. <strong>2)</strong> Post the announcement to every channel with a repo URL on file.
          </p>

          {/* Step 1: Upload xlsx */}
          <div className="bg-ink-800/50 rounded p-3 mb-3">
            <p className="text-xs font-semibold text-slate-300 mb-2">Step 1 · Import DevOps xlsx → team.repo_url</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  setRepoFile(e.target.files?.[0] ?? null);
                  setRepoImportResult(null);
                  setRepoImportError(null);
                }}
                className="text-xs text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-slate-700 file:text-slate-100 file:cursor-pointer file:font-semibold hover:file:bg-slate-600"
              />
              <button
                onClick={handleImportRepoUrls}
                disabled={!repoFile || repoImportBusy}
                className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-3 py-1.5 rounded text-xs transition"
              >
                {repoImportBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
            {repoImportResult && (
              <div className="mt-2 text-xs text-slate-300">
                ✓ Updated <span className="text-lime-300 font-semibold">{repoImportResult.updated_count}</span> ·
                Unchanged {repoImportResult.unchanged_count} ·
                Not found <span className="text-rose-300">{repoImportResult.not_found_count}</span> ·
                No URL <span className="text-amber-300">{repoImportResult.no_repo_url_count}</span>
                {repoImportResult.not_found.length > 0 && (
                  <div className="mt-1 text-rose-300/90">
                    Names not matched: {repoImportResult.not_found.slice(0, 5).join(', ')}
                    {repoImportResult.not_found.length > 5 && ` (+${repoImportResult.not_found.length - 5} more)`}
                  </div>
                )}
                {repoImportResult.no_repo_url.length > 0 && (
                  <div className="mt-1 text-amber-300/90">
                    Teams with blank URL: {repoImportResult.no_repo_url.slice(0, 5).join(', ')}
                    {repoImportResult.no_repo_url.length > 5 && ` (+${repoImportResult.no_repo_url.length - 5} more)`}
                  </div>
                )}
              </div>
            )}
            {repoImportError && <div className="mt-2 text-xs text-rose-300">⚠ {repoImportError}</div>}
          </div>

          {/* Step 2: Bulk post */}
          <div className="bg-ink-800/50 rounded p-3">
            <p className="text-xs font-semibold text-slate-300 mb-2">Step 2 · Post the announcement to every channel</p>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-xs text-slate-400 flex-1 min-w-0">
                <span className="text-lime-300 font-semibold">{teamsWithRepo.length}</span> team{teamsWithRepo.length === 1 ? '' : 's'} have a repo URL.
                {teamsWithChannelMissingRepo.length > 0 && (
                  <span className="text-amber-300">
                    {' '}· {teamsWithChannelMissingRepo.length} channel{teamsWithChannelMissingRepo.length === 1 ? '' : 's'} still missing a URL — re-run step 1.
                  </span>
                )}
                {teamsPendingRepoReady.length === 0 && teamsWithRepo.length > 0 && (
                  <span className="text-slate-500"> · Already posted to all of them.</span>
                )}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  disabled={repoPostBusy || teamsPendingRepoReady.length === 0}
                  onClick={() => handlePostRepoReadyAll(false)}
                  className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
                >
                  {repoPostBusy
                    ? 'Posting…'
                    : teamsPendingRepoReady.length === 0
                      ? `✓ Posted to all ${teamsWithRepo.length}`
                      : `📦 Post to ${teamsPendingRepoReady.length} pending channel${teamsPendingRepoReady.length === 1 ? '' : 's'}`}
                </button>
                {teamsWithRepo.length > 0 && (
                  <button
                    disabled={repoPostBusy}
                    onClick={() => handlePostRepoReadyAll(true)}
                    className="border border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-40 text-amber-300 font-semibold px-3 py-2 rounded text-xs transition"
                    title="Re-post to every team with a repo URL, even ones already messaged. Use when the template text has changed."
                  >
                    🔁 Re-post (force)
                  </button>
                )}
              </div>
            </div>
            {repoPostResult && (
              <div className="mt-2 text-xs text-lime-300">
                ✓ Posted to {repoPostResult.posted_count} channel{repoPostResult.posted_count === 1 ? '' : 's'}
                {repoPostResult.skipped_already_posted_count > 0 && ` · ${repoPostResult.skipped_already_posted_count} already posted`}
                {repoPostResult.skipped_no_repo_url_count > 0 && ` · ${repoPostResult.skipped_no_repo_url_count} no repo URL`}
                {repoPostResult.skipped_no_real_channel_count > 0 && ` · ${repoPostResult.skipped_no_real_channel_count} mock channel`}
                {repoPostResult.failed_count > 0 && (
                  <span className="text-rose-300"> · {repoPostResult.failed_count} failed</span>
                )}
              </div>
            )}
            {repoPostError && <div className="mt-2 text-xs text-rose-300">⚠ {repoPostError}</div>}
          </div>
        </div>
      )}

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
