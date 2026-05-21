import { useMsal } from '@azure/msal-react';
import { useMemo } from 'react';
import { loginRequest } from '../auth';

interface Props {
  error?: string | null;
}

const EVENT_DATE = new Date('2026-06-18T00:00:00');

export function LoginPage({ error }: Props) {
  const { instance, inProgress } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch((e) => {
      console.error('Login redirect failed', e);
    });
  };

  const busy = inProgress !== 'none';

  const daysUntil = useMemo(() => {
    const ms = EVENT_DATE.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, []);

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-ink-950">
      {/* Left: hero panel */}
      <div className="relative flex items-center justify-center p-8 lg:p-12 overflow-hidden bg-gradient-to-br from-sky-950 via-ink-950 to-ink-900">
        {/* Decorative glows */}
        <div className="absolute -top-40 -left-40 w-[28rem] h-[28rem] bg-sky-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-20 w-[24rem] h-[24rem] bg-lime-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-xl w-full">
          {/* Typographic logo (replaces wordmark image) */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/40">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <polygon points="8,5 8,19 19,12" />
              </svg>
            </div>
            <div className="text-2xl font-extrabold tracking-tight">
              RealHack <span className="text-sky-400">&apos;26</span>
            </div>
          </div>

          {/* Hero headline */}
          <h1 className="text-5xl lg:text-6xl font-black tracking-tighter leading-[1.05] mb-6">
            Build bold.<br />
            <span className="bg-gradient-to-r from-sky-300 via-lime-300 to-amber-300 bg-clip-text text-transparent">
              Ship fast.
            </span>
          </h1>

          <p className="text-base lg:text-lg text-slate-300 leading-relaxed mb-8 max-w-md">
            The organizer command center for RealPage&apos;s internal hackathon — registration, AI screening, judging, and comms in one place.
          </p>

          {/* Countdown badge */}
          <div className="inline-flex items-center gap-2.5 bg-ink-900/60 border border-sky-500/30 rounded-full px-4 py-2 mb-8 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400" />
            </span>
            <span className="text-sm font-semibold text-slate-200">
              {daysUntil > 0 ? `T-${daysUntil} days` : 'Live now'} · June 18–19, 2026
            </span>
          </div>

          {/* Feature chips */}
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 bg-sky-500/10 border border-sky-500/30 text-sky-200 rounded-full text-xs font-medium">
              AI Screening
            </span>
            <span className="px-3 py-1 bg-lime-500/10 border border-lime-500/30 text-lime-200 rounded-full text-xs font-medium">
              Judge Leaderboard
            </span>
            <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-full text-xs font-medium">
              Teams Channels
            </span>
            <span className="px-3 py-1 bg-violet-500/10 border border-violet-500/30 text-violet-200 rounded-full text-xs font-medium">
              Analytics &amp; Chatbot
            </span>
          </div>
        </div>
      </div>

      {/* Right: sign-in panel */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2 tracking-tight">Welcome back</h2>
            <p className="text-sm text-slate-400">
              Sign in with your RealPage Microsoft account to continue.
            </p>
          </div>

          <button
            onClick={handleLogin}
            disabled={busy}
            className="w-full bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition shadow-lg shadow-black/30 border border-slate-200 group"
          >
            <svg className="w-5 h-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            <span>{busy ? 'Signing in…' : 'Continue with Microsoft'}</span>
            {!busy && (
              <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 -ml-1 transition" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
          </button>

          {error && (
            <div className="mt-4 bg-rose-500/10 border border-rose-500/40 rounded-lg p-3 text-xs text-rose-300">
              <strong>Sign-in failed:</strong> {error}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-slate-800/80 text-xs text-slate-500 leading-relaxed">
            <p>
              Need access? Email{' '}
              <a href="mailto:RealHack@realpage.com" className="text-sky-400 hover:text-sky-300 font-medium">
                RealHack@realpage.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
