import { useEffect, useState } from 'react';
import type { Team } from '../types';
import { commsMode, createTeamsChannels } from '../api';

interface Props {
  teams: Team[];
  onReload: () => void;
}

export function CommsPanel({ teams, onReload }: Props) {
  const [mode, setMode] = useState<string>('mock');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commsMode().then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  const teamsWithoutChannel = teams.filter((t) => !t.has_teams_channel);
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
    </div>
  );
}
