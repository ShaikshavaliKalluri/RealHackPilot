import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth';

interface Props {
  error?: string | null;
}

export function LoginPage({ error }: Props) {
  const { instance, inProgress } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch((e) => {
      console.error('Login redirect failed', e);
    });
  };

  const busy = inProgress !== 'none';

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-ink-800/80 border border-slate-700/40 rounded-2xl shadow-2xl shadow-black/40 p-8">
        {/* Logo / branding */}
        <div className="mb-7">
          <div className="text-xs tracking-[0.25em] font-bold text-lime-400 uppercase mb-2">
            RealHack Pilot
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Organizer <span className="text-lime-300">Dashboard</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            RealHack 2026 · June 18–19 · RealPage Internal Hackathon
          </p>
        </div>

        {/* What's inside */}
        <div className="mb-7 space-y-2 text-sm text-slate-300">
          <div className="flex items-start gap-2">
            <span className="text-lime-400 mt-0.5">›</span>
            <span>Registration screening, AI scoring, judge leaderboard</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-lime-400 mt-0.5">›</span>
            <span>Comms — emails, Teams channels, broadcasts</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-lime-400 mt-0.5">›</span>
            <span>Analytics, chatbot, drill-downs</span>
          </div>
        </div>

        {/* Sign-in button */}
        <button
          onClick={handleLogin}
          disabled={busy}
          className="w-full bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition shadow-md"
        >
          {/* Microsoft 4-square logo */}
          <svg className="w-5 h-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
            <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
            <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
            <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          <span>{busy ? 'Signing in…' : 'Sign in with Microsoft'}</span>
        </button>

        {error && (
          <div className="mt-4 bg-rose-500/10 border border-rose-500/40 rounded-lg p-3 text-xs text-rose-300">
            <strong>Sign-in failed:</strong> {error}
          </div>
        )}

        {/* Access policy footer */}
        <div className="mt-6 pt-5 border-t border-slate-700/40 text-xs text-slate-500 leading-relaxed">
          Access is restricted to members of the{' '}
          <code className="text-slate-300">AGAa-RealHack-Pilot-Users</code>{' '}
          security group. If you can't sign in, your account needs to be added to that group.
        </div>
      </div>
    </div>
  );
}
