interface Props {
  flag: string;
}

const toneFor = (flag: string): string => {
  if (flag.startsWith('duplicate_participant')) return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  if (flag.startsWith('mentor_overloaded')) return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (flag.startsWith('low_quality')) return 'bg-orange-500/15 text-orange-300 border-orange-500/40';
  if (flag.startsWith('missing_location')) return 'bg-sky-500/15 text-sky-300 border-sky-500/40';
  if (flag.startsWith('bad_location')) return 'bg-sky-500/15 text-sky-300 border-sky-500/40';
  if (flag.startsWith('missing_address')) return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  if (flag.startsWith('bad_tshirt')) return 'bg-violet-500/15 text-violet-300 border-violet-500/40';
  if (flag.startsWith('team_too_')) return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  if (flag.startsWith('team_name_is_member')) return 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40';
  if (flag.startsWith('bad_email') || flag.startsWith('bad_mentor_email')) return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
};

// Friendly text for the email-issue subcodes
const emailReason = (sub: string): string => {
  switch (sub) {
    case 'malformed': return 'malformed';
    case 'non_realpage_domain': return 'non-RealPage domain';
    case 'no_first_last_separator': return 'no first.last separator';
    case 'too_many_dots': return 'too many dots';
    default: return sub;
  }
};

const labelFor = (flag: string): string => {
  // Some flag kinds use 3 segments (kind:subcode:detail) — handle them first.
  const parts = flag.split(':');
  const kind = parts[0];

  if (kind === 'bad_email' && parts.length >= 3) {
    return `Bad email (${emailReason(parts[1])}): ${parts.slice(2).join(':')}`;
  }
  if (kind === 'bad_mentor_email' && parts.length >= 3) {
    return `Bad mentor email (${emailReason(parts[1])}): ${parts.slice(2).join(':')}`;
  }

  const detail = parts.slice(1).join(':');
  switch (kind) {
    case 'low_quality': return `Low detail: ${detail}`;
    case 'duplicate_participant': return `Duplicate: ${detail}`;
    case 'mentor_overloaded': return `Mentor overloaded (${detail})`;
    case 'missing_location': return `Missing location: ${detail}`;
    case 'bad_location': return `Bad location: ${detail}`;
    case 'missing_address': return `Missing shipping address: ${detail}`;
    case 'bad_tshirt': return `Bad t-shirt: ${detail}`;
    case 'team_too_small': return `Team too small (${detail})`;
    case 'team_too_large': return `Team too large (${detail})`;
    case 'missing_mentor': return 'Missing mentor';
    case 'team_name_is_member': return `Team name matches a member: ${detail}`;
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
