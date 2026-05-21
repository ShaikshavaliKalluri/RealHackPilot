import { useEffect, useRef, useState } from 'react';
import { useMsal } from '@azure/msal-react';

export interface UserProfile {
  name: string;
  email: string;
  job_title: string | null;
  department: string | null;
  initials: string;
}

interface Props {
  user: UserProfile;
}

export function UserBadge({ user }: Props) {
  const { instance } = useMsal();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    // Pass `account` so Microsoft skips its "Pick an account to sign out of"
    // picker and sends the user straight back to our login page.
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
    instance.logoutRedirect({
      account,
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
