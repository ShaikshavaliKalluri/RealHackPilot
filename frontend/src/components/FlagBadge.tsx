interface Props {
  flag: string;
}

const toneFor = (flag: string): string => {
  if (flag.startsWith('duplicate_participant')) return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  if (flag.startsWith('mentor_overloaded')) return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (flag.startsWith('low_quality')) return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  if (flag.startsWith('bad_location')) return 'bg-sky-500/15 text-sky-300 border-sky-500/40';
  if (flag.startsWith('bad_tshirt')) return 'bg-violet-500/15 text-violet-300 border-violet-500/40';
  if (flag.startsWith('team_too_')) return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
};

const labelFor = (flag: string): string => {
  const [kind, detail] = flag.split(':');
  switch (kind) {
    case 'low_quality': return `Low detail: ${detail}`;
    case 'duplicate_participant': return `Duplicate: ${detail}`;
    case 'mentor_overloaded': return `Mentor overloaded (${detail})`;
    case 'bad_location': return `Bad location: ${detail}`;
    case 'bad_tshirt': return `Bad t-shirt: ${detail}`;
    case 'team_too_small': return `Team too small (${detail})`;
    case 'team_too_large': return `Team too large (${detail})`;
    case 'missing_mentor': return 'Missing mentor';
    default: return flag;
  }
};

export function FlagBadge({ flag }: Props) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border ${toneFor(flag)} mr-1.5 mb-1`}>
      {labelFor(flag)}
    </span>
  );
}
