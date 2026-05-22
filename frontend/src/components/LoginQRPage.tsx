import { QRCodeSVG } from 'qrcode.react';

/**
 * Printable QR-code login page.
 *
 * Designed to be opened by an organizer, printed on a single A4/Letter sheet,
 * and posted in the judging room. Judges point their phone camera at the QR,
 * tap the link, and land on the RealHack portal — Azure AD SSO takes over from
 * there so only RealPage employees can actually sign in.
 */
const PORTAL_URL = 'https://realhack.realpage.com';

export function LoginQRPage() {
  const handlePrint = () => window.print();

  return (
    <div className="space-y-5">
      {/* Screen-only controls (hidden when printed via .no-print) */}
      <div className="no-print bg-ink-800/60 border border-slate-700/40 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-slate-100">Printable judge login QR</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Print this page and post it in the judging room. Judges scan the QR
            with their phone camera to open the portal, then sign in with their
            RealPage Azure AD account.
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="bg-sky-400 hover:bg-sky-300 text-ink-950 font-bold px-4 py-2 rounded-lg text-sm transition"
        >
          🖨 Print
        </button>
      </div>

      {/* The actual printable sheet — kept clean and centered so a one-off print looks good */}
      <div className="printable-sheet bg-white text-ink-950 rounded-xl shadow-xl p-10 flex flex-col items-center text-center max-w-2xl mx-auto">
        <img src="/realhack-logo.png" alt="RealHack 2026" className="h-16 mb-2" />
        <div className="text-xs uppercase tracking-[0.3em] text-slate-500 font-bold mb-1">RealHack 2026</div>
        <h1 className="text-3xl font-extrabold text-ink-950 mb-1">Judges Portal</h1>
        <p className="text-base text-slate-600 mb-6 max-w-md">
          Scan this code with your phone camera to open the scoring portal.
        </p>

        <div className="bg-white border-4 border-ink-950 rounded-xl p-4 inline-block mb-5">
          <QRCodeSVG
            value={PORTAL_URL}
            size={320}
            level="H"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>

        <div className="space-y-2 text-slate-700 text-sm max-w-md">
          <p className="font-semibold text-ink-950 text-base">{PORTAL_URL}</p>
          <ol className="text-left space-y-1.5 mt-4 text-slate-700">
            <li><span className="font-bold text-ink-950">1.</span> Open your phone's camera</li>
            <li><span className="font-bold text-ink-950">2.</span> Point it at this QR code</li>
            <li><span className="font-bold text-ink-950">3.</span> Tap the link that appears</li>
            <li><span className="font-bold text-ink-950">4.</span> Sign in with your RealPage account</li>
          </ol>
          <p className="text-xs text-slate-500 mt-5 italic">
            Only RealPage employees can sign in — Azure AD SSO takes care of authentication.
          </p>
        </div>
      </div>

      {/* Print-specific CSS — hide everything else on the page when printing this view */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .printable-sheet { box-shadow: none !important; max-width: 100% !important; }
          /* Hide the rest of the app shell (header, nav) when printing */
          header, nav, footer { display: none !important; }
        }
      `}</style>
    </div>
  );
}
