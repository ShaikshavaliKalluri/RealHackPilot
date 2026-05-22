interface Props {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warn' | 'danger';
  onClick?: () => void;
  active?: boolean;
}

const toneClass = {
  default: 'text-slate-100',
  success: 'text-lime-300',
  warn: 'text-amber-400',
  danger: 'text-rose-400',
};

export function StatCard({ label, value, tone = 'default', onClick, active = false }: Props) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`bg-ink-800/60 border rounded-xl p-3 sm:p-4 lg:p-5 transition ${
        clickable ? 'cursor-pointer hover:border-lime-500/40 select-none' : ''
      } ${active ? 'border-lime-500/60 ring-1 ring-lime-500/20' : 'border-slate-700/40'}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className={`text-2xl sm:text-3xl font-extrabold ${toneClass[tone]}`}>{value}</div>
          <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-400 mt-1 leading-tight">{label}</div>
        </div>
        {clickable && (
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${active ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
    </div>
  );
}
