import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { fetchJudges, isSandboxMode, setSandboxMode, refreshSandbox, fetchSandboxStatus } from '../api';
import type { Judge } from '../types';

export interface UserProfile {
  name: string;
  email: string;
  job_title: string | null;
  department: string | null;
  initials: string;
}

interface Props {
  user: UserProfile;
  // When set, organizers can pick a judge to preview as. Called with judge_id + name on selection.
  onPreviewAsJudge?: (judgeId: number, judgeName: string) => void;
  // When true, expose Test Mode controls (super-admin only).
  showSandboxControls?: boolean;
}

export function UserBadge({ user, onPreviewAsJudge, showSandboxControls }: Props) {
  const { instance } = useMsal();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [judgePickerOpen, setJudgePickerOpen] = useState(false);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [judgesLoading, setJudgesLoading] = useState(false);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxMsg, setSandboxMsg] = useState<string | null>(null);
  const sandboxOn = isSandboxMode();

  const handleToggleSandbox = () => {
    if (sandboxOn) {
      setSandboxMode(false); // reloads
      return;
    }
    if (!confirm(
      "Turn Test Mode on?\n\n" +
      "All actions will read/write the sandbox database (a copy of prod). " +
      "Production data won't be touched. The page will reload."
    )) return;
    setSandboxMode(true); // reloads
  };

  const handleRefreshSandbox = async () => {
    if (!confirm("Wipe the sandbox database and reload it with a fresh copy of current prod data?")) return;
    setSandboxBusy(true);
    setSandboxMsg(null);
    try {
      const result = await refreshSandbox();
      const totals = Object.entries(result.rows_copied)
        .map(([t, n]) => `${t}: ${n}`)
        .join(' · ');
      setSandboxMsg(`Refreshed ✓  ${totals}`);
    } catch (e: any) {
      setSandboxMsg(`Failed: ${e.message ?? String(e)}`);
    } finally {
      setSandboxBusy(false);
    }
  };

  const handleSandboxStatus = async () => {
    setSandboxBusy(true);
    setSandboxMsg(null);
    try {
      const result = await fetchSandboxStatus();
      if (!result.configured) setSandboxMsg(result.message ?? 'Sandbox not configured');
      else {
        const totals = Object.entries(result.counts ?? {})
          .map(([t, n]) => `${t}: ${n}`)
          .join(' · ');
        setSandboxMsg(`Sandbox rows — ${totals}`);
      }
    } catch (e: any) {
      setSandboxMsg(`Failed: ${e.message ?? String(e)}`);
    } finally {
      setSandboxBusy(false);
    }
  };

  const openJudgePicker = async () => {
    setJudgePickerOpen(true);
    if (judges.length === 0) {
      setJudgesLoading(true);
      try {
        const list = await fetchJudges();
        setJudges(list.filter((j) => j.role === 'judge'));
      } catch (e) {
        console.error('Failed to load judges:', e);
      } finally {
        setJudgesLoading(false);
      }
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    // Microsoft only skips its "Pick an account to sign out of" picker when
    // we pass a hint — `account` alone isn't enough. We pass both `logoutHint`
    // (string form, used as the OIDC `logout_hint` query param) and `account`
    // (which MSAL uses internally), preferring the `login_hint` ID-token claim
    // when present and falling back to the account's UPN/username.
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
    const claims = account?.idTokenClaims as { login_hint?: string } | undefined;
    const logoutHint = claims?.login_hint ?? account?.username;
    instance.logoutRedirect({
      account,
      logoutHint,
      postLogoutRedirectUri: window.location.origin,
    }).catch((e) => {
      console.error('Logout failed', e);
    });
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 bg-ink-800/60 hover:bg-ink-800 border border-slate-700/40 hover:border-slate-600 rounded-lg pl-1.5 pr-3 py-1.5 transition"
        title={user.email}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-lime-400 to-emerald-500 flex items-center justify-center text-xs font-bold text-ink-950 shrink-0">
          {user.initials}
        </div>
        <div className="text-left min-w-0">
          <div className="text-sm font-semibold text-slate-100 truncate max-w-[180px]">{user.name}</div>
          {user.job_title && (
            <div className="text-[10px] text-slate-400 truncate max-w-[180px] leading-tight">{user.job_title}</div>
          )}
        </div>
        <svg className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-ink-800 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
          {/* Profile section */}
          <div className="p-4 border-b border-slate-700/40">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-lime-400 to-emerald-500 flex items-center justify-center text-lg font-bold text-ink-950 shrink-0">
                {user.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-100 truncate">{user.name}</div>
                <div className="text-xs text-slate-400 truncate">{user.email}</div>
              </div>
            </div>
            {(user.job_title || user.department) && (
              <div className="mt-3 space-y-1.5 text-xs">
                {user.job_title && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold w-20 shrink-0 pt-0.5">Title</span>
                    <span className="text-slate-200">{user.job_title}</span>
                  </div>
                )}
                {user.department && (
                  <div className="flex items-start gap-2">
                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold w-20 shrink-0 pt-0.5">Dept</span>
                    <span className="text-slate-200">{user.department}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview-as-judge (organizers only) */}
          {onPreviewAsJudge && (
            <>
              {!judgePickerOpen ? (
                <button
                  onClick={openJudgePicker}
                  className="w-full px-4 py-3 text-left text-sm text-slate-200 hover:bg-sky-500/10 hover:text-sky-300 transition flex items-center gap-2 border-b border-slate-700/40"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Preview as judge…
                </button>
              ) : (
                <div className="border-b border-slate-700/40">
                  <div className="px-4 py-2 flex items-center justify-between bg-ink-900/50">
                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Pick a judge to preview</span>
                    <button
                      onClick={() => setJudgePickerOpen(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {judgesLoading ? (
                      <div className="px-4 py-3 text-sm text-slate-400">Loading…</div>
                    ) : judges.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-400 italic">No judges added yet. Go to the Judges tab.</div>
                    ) : (
                      judges.map((j) => (
                        <button
                          key={j.id}
                          onClick={() => {
                            onPreviewAsJudge(j.id, j.name);
                            setJudgePickerOpen(false);
                            setOpen(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-sky-500/10 hover:text-sky-300 transition border-t border-slate-800/40 first:border-t-0"
                        >
                          <div className="font-semibold truncate">{j.name}</div>
                          {j.email && <div className="text-xs text-slate-500 truncate">{j.email}</div>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Test Mode (super-admin only) */}
          {showSandboxControls && (
            <div className="border-b border-slate-700/40 bg-ink-900/30">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  <span className="text-sm font-semibold text-slate-100">Test Mode</span>
                </div>
                <button
                  onClick={handleToggleSandbox}
                  className={`relative inline-flex items-center h-6 w-11 rounded-full transition ${sandboxOn ? 'bg-amber-400' : 'bg-slate-600'}`}
                  aria-label="Toggle Test Mode"
                >
                  <span className={`inline-block w-5 h-5 transform bg-white rounded-full transition-transform ${sandboxOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <p className="px-4 pb-2 text-[11px] text-slate-400 leading-snug">
                {sandboxOn
                  ? 'Reading/writing sandbox DB. Production data is safe.'
                  : 'Toggle on to read/write the sandbox DB instead of prod. Page reloads.'}
              </p>
              {sandboxOn && (
                <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={handleRefreshSandbox}
                    disabled={sandboxBusy}
                    className="text-[11px] px-2 py-1 rounded border border-amber-500/40 hover:bg-amber-500/10 text-amber-200 disabled:opacity-40 transition"
                  >
                    {sandboxBusy ? 'Working…' : 'Refresh from prod'}
                  </button>
                  <button
                    onClick={handleSandboxStatus}
                    disabled={sandboxBusy}
                    className="text-[11px] px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-300 disabled:opacity-40 transition"
                  >
                    Sandbox status
                  </button>
                </div>
              )}
              {sandboxMsg && (
                <div className="px-4 pb-3 text-[11px] text-slate-300 break-words">{sandboxMsg}</div>
              )}
            </div>
          )}

          {/* Actions */}
          <button
            onClick={handleLogout}
            className="w-full px-4 py-3 text-left text-sm text-slate-200 hover:bg-rose-500/10 hover:text-rose-300 transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
