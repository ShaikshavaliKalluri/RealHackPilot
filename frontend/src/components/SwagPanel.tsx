import { useEffect, useMemo, useState } from 'react';
import {
  fetchSwagPeople,
  markSwagCollected,
  unmarkSwagCollected,
  type SwagPerson,
} from '../api';

type Filter = 'all' | 'pending' | 'collected';

/**
 * T-shirt / swag pickup tab.
 *
 * Built for event day: an organizer stands at the pickup desk with their phone,
 * the participant gives a name or email, organizer searches, taps one button.
 * Multiple organizers can work the desk concurrently — each tap goes straight
 * to the API, no shared Excel, no merge conflicts.
 *
 * Design intentionally mobile-first: big tap targets, single column on phone,
 * sticky search bar so scrolling the list doesn't push search off-screen.
 */
export function SwagPanel() {
  const [people, setPeople] = useState<SwagPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      setPeople(await fetchSwagPeople());
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const handleMark = async (p: SwagPerson) => {
    setBusyEmail(p.email);
    setErr(null);
    try {
      const updated = await markSwagCollected(p.email);
      setPeople((prev) => prev.map((x) => (x.email === p.email ? updated : x)));
      setToast(`✓ Collected — ${p.name}`);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusyEmail(null);
    }
  };

  const handleUnmark = async (p: SwagPerson) => {
    if (!confirm(`Undo collection for ${p.name}? Use only if marked by mistake.`)) return;
    setBusyEmail(p.email);
    setErr(null);
    try {
      const updated = await unmarkSwagCollected(p.email);
      setPeople((prev) => prev.map((x) => (x.email === p.email ? updated : x)));
      setToast(`Undone — ${p.name}`);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusyEmail(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = people;
    if (filter === 'pending') list = list.filter((p) => !p.collected);
    if (filter === 'collected') list = list.filter((p) => p.collected);
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.includes(q) ||
        p.teams.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [people, search, filter]);

  const stats = useMemo(() => {
    const total = people.length;
    const collected = people.filter((p) => p.collected).length;
    return { total, collected, pending: total - collected };
  }, [people]);

  const pct = stats.total > 0 ? Math.round((stats.collected / stats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Sticky header — counter + progress + search + filter */}
      <div className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-2 pb-3 border-b border-slate-800/60">
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 sm:p-5">
          {/* Counter row */}
          <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-lime-300">
                {stats.collected}
                <span className="text-slate-500 text-xl sm:text-2xl font-normal"> / {stats.total}</span>
              </div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mt-0.5">
                T-shirts collected · {stats.pending} pending
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl sm:text-3xl font-extrabold text-lime-300">{pct}%</div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Distributed</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-ink-900 rounded-full h-2 overflow-hidden mb-4">
            <div
              className="h-full bg-lime-500/70 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* Search + filter */}
          <input
            type="text"
            placeholder="Search by name, email, or team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="w-full bg-ink-900 border border-slate-700/40 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-lime-500/60 mb-2.5"
          />
          <div className="flex gap-1 bg-ink-900/60 border border-slate-700/40 rounded-lg p-1">
            {(['all', 'pending', 'collected'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 px-3 py-2 rounded text-sm font-semibold capitalize transition ${
                  filter === f ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {f}{f !== 'all' && (
                  <span className="ml-1 opacity-70">
                    ({f === 'pending' ? stats.pending : stats.collected})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Showing {filtered.length} of {people.length}
          </div>
        </div>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl p-4 text-sm text-rose-200">
          {err}
        </div>
      )}

      {/* People list */}
      {loading ? (
        <div className="text-slate-400 text-sm text-center py-8">Loading roster…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-ink-800/40 border border-dashed border-slate-700/40 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-400">
            {search ? `No one matches "${search}".` : 'No one matches the current filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const isBusy = busyEmail === p.email;
            const teamLine = p.teams.length === 0
              ? '—'
              : p.teams.length === 1
                ? p.teams[0]
                : `${p.teams[0]} +${p.teams.length - 1}`;
            const roleLabel = p.roles.some((r) => r.startsWith('mentor:')) ? 'Mentor' : 'Member';
            return (
              <div
                key={p.email}
                className={`rounded-xl border p-3 sm:p-4 transition ${
                  p.collected
                    ? 'bg-lime-500/5 border-lime-500/40'
                    : 'bg-ink-800/60 border-slate-700/40 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-100 text-base sm:text-lg">{p.name}</h4>
                      {p.tshirt_size && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-200 border border-violet-500/40 font-bold uppercase tracking-wider">
                          Size {p.tshirt_size}
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/30 text-slate-300 border border-slate-600/40 font-semibold uppercase tracking-wider">
                        {roleLabel}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">{p.email}</div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{teamLine}</div>
                    {p.collected && p.collected_at && (
                      <div className="text-[11px] text-lime-300/80 mt-1.5">
                        ✓ Collected {new Date(p.collected_at).toLocaleString()}
                        {p.collected_by_email && (
                          <span className="text-slate-500"> by {p.collected_by_email}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {p.collected ? (
                      <button
                        onClick={() => handleUnmark(p)}
                        disabled={isBusy}
                        className="text-xs px-3 py-2 rounded border border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10 text-rose-300 disabled:opacity-40 transition"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => handleMark(p)}
                        disabled={isBusy}
                        className="bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-ink-950 font-bold px-4 py-2.5 rounded-lg text-sm transition"
                      >
                        {isBusy ? 'Saving…' : '✓ Mark collected'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast — confirmation popup at bottom of screen */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-lime-400 text-ink-950 px-5 py-3 rounded-lg shadow-lg shadow-lime-500/30 font-bold text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
