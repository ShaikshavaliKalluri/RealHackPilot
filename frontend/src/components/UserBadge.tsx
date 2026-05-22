import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { fetchJudges } from '../api';
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
}

export function UserBadge({ user, onPreviewAsJudge }: Props) {
  const { instance } = useMsal();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [judgePickerOpen, setJudgePickerOpen] = useState(false);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [judgesLoading, setJudgesLoading] = useState(false);

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
