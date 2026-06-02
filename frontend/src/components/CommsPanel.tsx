import { useEffect, useState } from 'react';
import type { Team } from '../types';
import { commsMode, createTeamsChannels, postChannelWelcomeAll } from '../api';

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

  useEffect(() => {
    commsMode().then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  const teamsWithoutChannel = teams.filter((t) => !t.has_teams_channel);
  const teamsWithChannel = teams.filter((t) => t.has_teams_channel);
  const isMock = mode === 'mock';

  const handleCreateChannels = async () => {
    if (teamsWithoutChannel.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await createTeamsChannels(teamsWithoutChannel.map((t) => t.id), 'organizer@realpage.com');
      setResult(`Created ${r.created.length} channel${r.created.length === 1 ? '' : 's'} · mode=${r.mode}`);
      onReload();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
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

      <div className="bg-ink-900/50 rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-slate-300">
            <span className="text-lime-300 font-bold">{teams.length - teamsWithoutChannel.length}</span>
            <span className="text-slate-500"> / {teams.length}</span> teams already have channels.
          </p>
          {teamsWithoutChannel.length > 0 && (
            <p className="text-xs text-slate-400 mt-1">{teamsWithoutChannel.length} team{teamsWithoutChannel.length === 1 ? '' : 's'} still missing a channel.</p>
          )}
        </div>
        <button
          disabled={busy || teamsWithoutChannel.length === 0}
          onClick={handleCreateChannels}
          className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
        >
          {busy ? 'Creating…' : teamsWithoutChannel.length === 0 ? 'All channels created' : `Create ${teamsWithoutChannel.length} missing channel${teamsWithoutChannel.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {result && <div className="text-sm text-lime-300 mt-3">✓ {result}</div>}
      {error && <div className="text-sm text-rose-300 mt-3">⚠ {error}</div>}

      {/* Bulk: post welcome message to every channel */}
      {teamsWithChannel.length > 0 && (
        <div className="bg-ink-900/50 rounded-lg p-4 mt-3 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm text-slate-300">
              Post the <strong className="text-slate-100">RealHack 2026 welcome</strong> message in every team's channel.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Mentor + members get @mentioned. Teams already messaged are skipped. ~2-3 min for {teamsWithChannel.length} teams.
            </p>
          </div>
          <button
            disabled={welcomeBusy}
            onClick={handlePostWelcomeAll}
            className="bg-violet-400 hover:bg-violet-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2 rounded text-sm transition"
          >
            {welcomeBusy ? 'Posting…' : `💬 Post welcome to ${teamsWithChannel.length} channel${teamsWithChannel.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {welcomeResult && <div className="text-sm text-lime-300 mt-3">✓ {welcomeResult}</div>}
      {welcomeError && <div className="text-sm text-rose-300 mt-3">⚠ {welcomeError}</div>}
    </div>
  );
}
