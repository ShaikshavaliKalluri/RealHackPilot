import { useEffect, useMemo, useState } from 'react';
import {
  fetchSwagPeople,
  markSwagCollected,
  unmarkSwagCollected,
  fetchSwagExtras,
  importSwagExtrasFromXlsx,
  deleteSwagExtra,
  type SwagPerson,
  type SwagExtra,
  type SwagExtraImportResult,
} from '../api';

type StatusFilter = 'all' | 'pending' | 'collected';
type CountryFilter = string; // 'all' | 'India' | 'US' | …
type CategoryFilter = string; // 'all' | 'Member' | 'Mentor' | 'Judge' | 'Organiser' | …

// CSV escape: wrap in double quotes when the value contains a comma, quote,
// or newline; double-up any internal quotes per RFC 4180.
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportFilteredToCsv(rows: SwagPerson[], country: string, category: string, status: string): void {
  const headers = [
    'Name', 'Email', 'Category', 'Country', 'T-shirt Size',
    'Role(s)', 'Team(s)',
    'Status', 'Collected At (UTC)',
    'Picked Up By (Name)', 'Picked Up By (Email)',
    'Marked By (Organizer)',
    'Notes',
  ];

  const lines: string[] = [headers.join(',')];
  for (const p of rows) {
    lines.push([
      csvCell(p.name),
      csvCell(p.email),
      csvCell(p.category),
      csvCell(p.country),
      csvCell(p.tshirt_size),
      csvCell(p.roles.join('; ')),
      csvCell(p.teams.join('; ')),
      csvCell(p.collected ? 'Collected' : 'Pending'),
      csvCell(p.collected_at),
      csvCell(p.picked_up_by_name),
      csvCell(p.picked_up_by_email),
      csvCell(p.collected_by_email),
      csvCell(p.notes),
    ].join(','));
  }

  // UTF-8 BOM so Excel opens em-dashes, accents, etc. without garbling them.
  const csvContent = '﻿' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filterTag = [
    country !== 'all' ? country.toLowerCase() : '',
    category !== 'all' ? category.toLowerCase() : '',
    status !== 'all' ? status : '',
  ].filter(Boolean).join('_') || 'all';
  const filename = `realhack-swag_${filterTag}_${ts}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * T-shirt / swag pickup tab.
 *
 * Built for event day: an organizer stands at the pickup desk with their phone,
 * the participant gives a name or email, organizer searches, taps one button.
 * Multiple organizers can work the desk concurrently — each tap goes straight
 * to the API, no shared Excel, no merge conflicts.
 *
 * Country filter: in-person pickup is India-only at the event venue;
 * other-country people get their t-shirts shipped via mail. Filter lets the
 * pickup-desk organizer focus on India + lets the shipping desk see the
 * non-India list separately.
 *
 * Collect-on-behalf-of: when someone (e.g. a teammate) shows their ID and
 * signs for an absent person, the organizer captures who-physically-picked-up
 * before confirming. Audit-logged separately from which organizer marked it.
 */
interface Props {
  /** 'organizer' (default) shows full controls -- search, mark, undo, CSV
   *  export, full filter row. 'staff' is the volunteer-desk view used when
   *  a non-organizer signs in: hides the Undo button (only organizers can
   *  reverse a mark) and the CSV export (volunteers don't need to take a
   *  copy off-platform). Everything else stays so the desk flow is the
   *  same UX for everyone. */
  mode?: 'organizer' | 'staff';
}

export function SwagPanel({ mode = 'organizer' }: Props = {}) {
  const isStaffMode = mode === 'staff';
  const [people, setPeople] = useState<SwagPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [country, setCountry] = useState<CountryFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Pickup-by modal state
  const [pickupModal, setPickupModal] = useState<SwagPerson | null>(null);
  const [byName, setByName] = useState('');
  const [byEmail, setByEmail] = useState('');

  // Manage-extras admin state (organizer-only). Hidden in staff mode.
  const [showExtrasAdmin, setShowExtrasAdmin] = useState(false);
  const [extras, setExtras] = useState<SwagExtra[]>([]);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [extrasFile, setExtrasFile] = useState<File | null>(null);
  const [extrasUploadBusy, setExtrasUploadBusy] = useState(false);
  const [extrasUploadResult, setExtrasUploadResult] = useState<SwagExtraImportResult | null>(null);
  const [extrasUploadError, setExtrasUploadError] = useState<string | null>(null);

  const reloadExtras = async () => {
    setExtrasLoading(true);
    try {
      setExtras(await fetchSwagExtras());
    } catch {
      setExtras([]);
    } finally {
      setExtrasLoading(false);
    }
  };

  const handleExtrasUpload = async () => {
    if (!extrasFile) return;
    setExtrasUploadBusy(true);
    setExtrasUploadError(null);
    setExtrasUploadResult(null);
    try {
      const r = await importSwagExtrasFromXlsx(extrasFile);
      setExtrasUploadResult(r);
      setExtrasFile(null);
      // Reload both the extras admin list AND the main pickup roster so the
      // new people appear in the searchable list immediately.
      await Promise.all([reloadExtras(), reload()]);
    } catch (e: any) {
      setExtrasUploadError(e.message ?? String(e));
    } finally {
      setExtrasUploadBusy(false);
    }
  };

  const handleDeleteExtra = async (x: SwagExtra) => {
    if (!confirm(`Remove ${x.name} (${x.email}) from the swag-extras list? They'll no longer appear on the pickup roster (re-upload to add back).`)) return;
    try {
      await deleteSwagExtra(x.id);
      await Promise.all([reloadExtras(), reload()]);
    } catch (e: any) {
      setExtrasUploadError(e.message ?? String(e));
    }
  };

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
  // Lazy-load the extras list only when the organizer opens the admin panel.
  useEffect(() => {
    if (showExtrasAdmin && extras.length === 0 && !extrasLoading) {
      reloadExtras();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExtrasAdmin]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const openPickupModal = (p: SwagPerson) => {
    setPickupModal(p);
    setByName('');
    setByEmail('');
  };

  const closePickupModal = () => {
    setPickupModal(null);
    setByName('');
    setByEmail('');
  };

  const submitPickup = async (mode: 'self' | 'on-behalf') => {
    if (!pickupModal) return;
    if (mode === 'on-behalf' && !byName.trim() && !byEmail.trim()) {
      setErr('Enter at least a name or email of the person collecting on behalf');
      return;
    }
    const p = pickupModal;
    closePickupModal();
    setBusyEmail(p.email);
    setErr(null);
    try {
      const updated = await markSwagCollected(p.email, {
        pickedUpByName: mode === 'on-behalf' ? byName.trim() || null : null,
        pickedUpByEmail: mode === 'on-behalf' ? byEmail.trim().toLowerCase() || null : null,
      });
      setPeople((prev) => prev.map((x) => (x.email === p.email ? updated : x)));
      setToast(
        mode === 'on-behalf'
          ? `✓ Collected on behalf — ${p.name}`
          : `✓ Collected — ${p.name}`,
      );
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

  // Distinct countries present in the roster (used to populate the country pills)
  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const p of people) if (p.country) set.add(p.country);
    return Array.from(set).sort();
  }, [people]);

  // Distinct categories present in the roster (used to populate the category
  // pills). Sort with Member + Mentor first (most common at the desk),
  // everyone else alphabetical after, so the pill row reads predictably.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of people) if (p.category) set.add(p.category);
    const arr = Array.from(set);
    const PRIORITY = ['Member', 'Mentor'];
    arr.sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
    return arr;
  }, [people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = people;
    if (status === 'pending') list = list.filter((p) => !p.collected);
    if (status === 'collected') list = list.filter((p) => p.collected);
    if (country !== 'all') list = list.filter((p) => (p.country ?? 'Unknown') === country);
    if (category !== 'all') list = list.filter((p) => (p.category ?? 'Member') === category);
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.includes(q) ||
        p.teams.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [people, search, status, country, category]);

  const stats = useMemo(() => {
    const total = people.length;
    const collected = people.filter((p) => p.collected).length;
    return { total, collected, pending: total - collected };
  }, [people]);

  const pct = stats.total > 0 ? Math.round((stats.collected / stats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ===== Manage extras (organizer-only) =====
          Lets organizers add non-team people (judges, organisers, support,
          leadership, HR) to the swag pickup roster via xlsx upload. Hidden
          in staff mode -- REWS volunteers shouldn't see this. */}
      {!isStaffMode && (
        <div className="bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 sm:p-5">
          <button
            onClick={() => setShowExtrasAdmin(!showExtrasAdmin)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <div>
              <h3 className="font-bold text-slate-100 text-sm">
                📋 Manage swag extras (non-team people)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Judges, organisers, support, leadership, HR — anyone at the event who isn't on a team but still gets a t-shirt.
              </p>
            </div>
            <svg
              className={`w-4 h-4 text-slate-400 transition-transform ${showExtrasAdmin ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showExtrasAdmin && (
            <div className="mt-4 space-y-4">
              {/* Upload xlsx */}
              <div className="bg-ink-900/50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-300 mb-2">
                  Bulk upload from Excel
                </p>
                <p className="text-[11px] text-slate-500 mb-2">
                  Required columns (case-insensitive, any order): <code>Name</code>,
                  <code> Email</code>, <code> Category</code>.
                  Optional: <code>T-shirt Size</code>, <code> Country</code>.
                  Emails already on the team-member / mentor list are skipped automatically.
                  Re-uploading the same file updates existing rows (no duplicates).
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      setExtrasFile(e.target.files?.[0] ?? null);
                      setExtrasUploadResult(null);
                      setExtrasUploadError(null);
                    }}
                    className="text-xs text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-slate-700 file:text-slate-100 file:cursor-pointer file:font-semibold hover:file:bg-slate-600"
                  />
                  <button
                    onClick={handleExtrasUpload}
                    disabled={!extrasFile || extrasUploadBusy}
                    className="bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-ink-950 font-bold px-3 py-1.5 rounded text-xs transition"
                  >
                    {extrasUploadBusy ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
                {extrasUploadResult && (
                  <div className="mt-2 text-xs text-slate-300">
                    ✓ Created <span className="text-lime-300 font-semibold">{extrasUploadResult.created_count}</span>
                    {' · '}Updated {extrasUploadResult.updated_count}
                    {' · '}Skipped (already on team roster) <span className="text-amber-300">{extrasUploadResult.skipped_existing_roster_count}</span>
                    {extrasUploadResult.failed.length > 0 && (
                      <div className="text-rose-300/90 mt-1">
                        ⚠ {extrasUploadResult.failed.length} rows failed:{' '}
                        {extrasUploadResult.failed.slice(0, 3).map((f) => `${f.email}: ${f.error}`).join(' | ')}
                        {extrasUploadResult.failed.length > 3 && ` (+${extrasUploadResult.failed.length - 3} more)`}
                      </div>
                    )}
                    {Object.keys(extrasUploadResult.by_category).length > 0 && (
                      <div className="mt-1 flex gap-1.5 flex-wrap">
                        {Object.entries(extrasUploadResult.by_category).sort().map(([cat, n]) => (
                          <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-800/40 text-slate-300">
                            {cat}: <strong>{n}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {extrasUploadError && (
                  <div className="mt-2 text-xs text-rose-300">⚠ {extrasUploadError}</div>
                )}
              </div>

              {/* Current extras list with delete buttons */}
              <div className="bg-ink-900/50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-300 mb-2">
                  Currently in the swag-extras list
                  <span className="text-slate-500 font-normal ml-1">({extras.length})</span>
                </p>
                {extrasLoading ? (
                  <p className="text-xs text-slate-500">Loading…</p>
                ) : extras.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Nobody added yet. Upload an Excel file above to populate.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-72 overflow-y-auto">
                    {extras.map((x) => (
                      <div
                        key={x.id}
                        className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border border-slate-700/40 hover:border-slate-600 bg-ink-900/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-slate-200 font-semibold truncate">{x.name}</div>
                          <div className="text-slate-500 text-[11px] truncate">
                            {x.email}
                            {x.tshirt_size && <span className="text-violet-300 ml-1.5">{x.tshirt_size}</span>}
                            {x.country && <span className="text-slate-600 ml-1.5">· {x.country}</span>}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-800/60 text-slate-300 font-semibold uppercase tracking-wider">
                          {x.category}
                        </span>
                        <button
                          onClick={() => handleDeleteExtra(x)}
                          className="text-[11px] px-2 py-0.5 rounded border border-rose-500/30 hover:border-rose-500/60 text-rose-300 transition"
                          title="Remove from the swag-extras list"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sticky header — counter + progress + search + filters */}
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
                Swag kits collected · {stats.pending} pending
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
          {/* Search */}
          <input
            type="text"
            placeholder="Search by name, email, or team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="w-full bg-ink-900 border border-slate-700/40 rounded-lg px-4 py-3 text-base focus:outline-none focus:border-lime-500/60 mb-2.5"
          />
          {/* Country filter pills */}
          {countries.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2.5">
              <button
                onClick={() => setCountry('all')}
                className={`text-xs px-3 py-1.5 rounded-full font-semibold transition border ${
                  country === 'all'
                    ? 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                    : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
                }`}
              >
                All countries ({people.length})
              </button>
              {countries.map((c) => {
                const count = people.filter((p) => (p.country ?? 'Unknown') === c).length;
                const isIndia = c.toLowerCase() === 'india';
                return (
                  <button
                    key={c}
                    onClick={() => setCountry(c)}
                    className={`text-xs px-3 py-1.5 rounded-full font-semibold transition border ${
                      country === c
                        ? isIndia
                          ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                          : 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                        : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>
          )}
          {/* Category filter pills — Member / Mentor / Judge / Organiser /
              Support / Leadership / HR. Combines additively with the country
              filter (e.g. India + Judge = India-based judges only). */}
          {categories.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2.5">
              <button
                onClick={() => setCategory('all')}
                className={`text-xs px-3 py-1.5 rounded-full font-semibold transition border ${
                  category === 'all'
                    ? 'bg-violet-500/20 border-violet-500/60 text-violet-200'
                    : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
                }`}
              >
                All categories ({people.length})
              </button>
              {categories.map((c) => {
                const count = people.filter((p) => (p.category ?? 'Member') === c).length;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`text-xs px-3 py-1.5 rounded-full font-semibold transition border ${
                      category === c
                        ? 'bg-violet-500/20 border-violet-500/60 text-violet-200'
                        : 'bg-ink-900/40 border-slate-700/40 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>
          )}
          {/* Status filter pills */}
          <div className="flex gap-1 bg-ink-900/60 border border-slate-700/40 rounded-lg p-1">
            {(['all', 'pending', 'collected'] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStatus(f)}
                className={`flex-1 px-3 py-2 rounded text-sm font-semibold capitalize transition ${
                  status === f ? 'bg-lime-400 text-ink-950' : 'text-slate-300 hover:text-white'
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
          <div className="text-xs text-slate-500 mt-2 flex items-center justify-between gap-3 flex-wrap">
            <div>
              Showing {filtered.length} of {people.length}
              {country !== 'all' && <span className="text-slate-600"> · {country}</span>}
              {category !== 'all' && <span className="text-slate-600"> · {category}</span>}
            </div>
            {!isStaffMode && (
              <button
                onClick={() => exportFilteredToCsv(filtered, country, category, status)}
                disabled={filtered.length === 0}
                className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-300 transition disabled:opacity-40 flex items-center gap-1.5 font-semibold"
                title="Download the current filtered list as a CSV (opens directly in Excel)"
              >
                📥 Export to Excel ({filtered.length})
              </button>
            )}
          </div>
          {country !== 'all' && country.toLowerCase() !== 'india' && (
            <div className="text-xs text-amber-300/90 mt-1.5 italic">
              📦 Note — {country} participants typically receive swag kits via mail. Confirm shipping address on file before marking.
            </div>
          )}
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
            const roleLabel = p.category || 'Member';
            const isIndia = (p.country || '').toLowerCase() === 'india';
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
                      {p.country && (
                        <span className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${
                          isIndia
                            ? 'bg-amber-500/15 text-amber-200 border-amber-500/40'
                            : 'bg-sky-500/15 text-sky-200 border-sky-500/40'
                        }`}>
                          {p.country}
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
                        {p.picked_up_by_name && (
                          <div className="text-amber-300/90 mt-0.5">
                            📋 Picked up by <strong>{p.picked_up_by_name}</strong>
                            {p.picked_up_by_email && <span className="text-slate-500"> · {p.picked_up_by_email}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {p.collected ? (
                      isStaffMode ? (
                        <span
                          className="text-xs px-3 py-2 rounded border border-lime-500/30 bg-lime-500/5 text-lime-300/80 font-semibold"
                          title="To reverse this, ask an organizer."
                        >
                          ✓ Done
                        </span>
                      ) : (
                        <button
                          onClick={() => handleUnmark(p)}
                          disabled={isBusy}
                          className="text-xs px-3 py-2 rounded border border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10 text-rose-300 disabled:opacity-40 transition"
                        >
                          Undo
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => openPickupModal(p)}
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

      {/* Pickup-by modal */}
      {pickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closePickupModal}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-ink-800 border border-lime-500/40 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
          >
            <div className="bg-gradient-to-br from-lime-500/20 to-emerald-500/10 p-4 border-b border-lime-500/40">
              <h3 className="font-bold text-lime-200">Confirm pickup — {pickupModal.name}</h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Size {pickupModal.tshirt_size || '—'}
                {pickupModal.country && <> · {pickupModal.country}</>}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-300">Who is physically picking up this swag kit?</p>

              {/* Self option — big primary button */}
              <button
                onClick={() => submitPickup('self')}
                className="w-full bg-lime-400 hover:bg-lime-300 text-ink-950 font-bold px-4 py-3 rounded-lg text-base transition"
              >
                {pickupModal.name.split(' ')[0]} is picking up themselves
              </button>

              <div className="text-center text-xs text-slate-500 uppercase tracking-wider">— or —</div>

              {/* Collect-on-behalf inputs */}
              <div className="space-y-2">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Someone else collecting on behalf</p>
                <input
                  type="text"
                  placeholder="Their name (ID check)"
                  value={byName}
                  onChange={(e) => setByName(e.target.value)}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-lime-500/60"
                />
                <input
                  type="email"
                  placeholder="Their RealPage email"
                  value={byEmail}
                  onChange={(e) => setByEmail(e.target.value)}
                  className="w-full bg-ink-900 border border-slate-700/40 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-lime-500/60"
                />
                <button
                  onClick={() => submitPickup('on-behalf')}
                  disabled={!byName.trim() && !byEmail.trim()}
                  className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 font-bold px-4 py-2.5 rounded-lg text-sm transition"
                >
                  Mark collected on behalf
                </button>
              </div>
            </div>
            <div className="px-5 pb-5 text-right">
              <button onClick={closePickupModal} className="text-sm text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
