import type { ProviderType, ServerKind, ServerSpecs, ServerStatus } from '@weblion/shared';
import { Box, Server as ServerIcon } from 'lucide-react';
import { intlLocale, type Locale } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatMemoryMb } from '@/lib/format';
import { useOptionalLocale, useT } from '@/lib/i18n';
import type { TranslationKey } from '@weblion/shared';

const STATUS_STYLE: Record<ServerStatus, { dot: string; text: string; pulse?: boolean }> = {
  running: { dot: 'bg-success', text: 'text-success' },
  stopped: { dot: 'bg-subtle', text: 'text-muted' },
  paused: { dot: 'bg-warning', text: 'text-warning' },
  starting: { dot: 'bg-warning', text: 'text-warning', pulse: true },
  stopping: { dot: 'bg-warning', text: 'text-warning', pulse: true },
  rebooting: { dot: 'bg-warning', text: 'text-warning', pulse: true },
  installing: { dot: 'bg-brand-blue', text: 'text-primary-text', pulse: true },
  backup: { dot: 'bg-brand-blue', text: 'text-primary-text', pulse: true },
  restoring: { dot: 'bg-brand-blue', text: 'text-primary-text', pulse: true },
  migrating: { dot: 'bg-brand-blue', text: 'text-primary-text', pulse: true },
  locked: { dot: 'bg-warning', text: 'text-warning' },
  missing: { dot: 'bg-danger', text: 'text-danger' },
  error: { dot: 'bg-danger', text: 'text-danger' },
  unknown: { dot: 'bg-border-strong', text: 'text-subtle' },
};

export function StatusDot({ status, className }: { status: ServerStatus; className?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        s.dot,
        s.pulse && 'animate-status',
        className,
      )}
      aria-hidden
    />
  );
}

export function StatusLabel({ status, className }: { status: ServerStatus; className?: string }) {
  const t = useT();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium', s.text, className)}>
      <StatusDot status={status} />
      {t(`status.${status}` as TranslationKey)}
    </span>
  );
}

const regionNames = new Map<string, Intl.DisplayNames | null>();

/** The name of a country in the UI language ("Frankreich", "France", "Francia"), the code when unknown. */
export function regionName(country: string, locale: Locale): string {
  const tag = intlLocale(locale);
  if (!regionNames.has(tag)) {
    try {
      regionNames.set(tag, new Intl.DisplayNames([tag], { type: 'region' }));
    } catch {
      regionNames.set(tag, null);
    }
  }
  try {
    return regionNames.get(tag)?.of(country) ?? country;
  } catch {
    return country;
  }
}

/**
 * Small inline flags. Emoji flags do not render on Windows, so these are drawn. country: ISO 3166-1 alpha-2.
 * decorative: the language or country name is written next to the flag (pickers, column headers), so the
 * flag is hidden from screen readers (aria-hidden, no role, no label). Otherwise the label is the country's
 * name in the UI language (English outside the provider).
 */
export function Flag({
  country,
  className,
  decorative = false,
}: {
  country: string;
  className?: string;
  decorative?: boolean;
}) {
  const c = country.toUpperCase();
  const base = cn(
    'inline-block h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10',
    className,
  );
  const locale = useOptionalLocale() ?? 'en';
  const a11y = () =>
    decorative
      ? { 'aria-hidden': true as const }
      : { role: 'img' as const, 'aria-label': regionName(c, locale) };
  if (c === 'CH') {
    return (
      <svg viewBox="0 0 32 32" className={cn(base, 'h-3.5 w-3.5')} {...a11y()}>
        <rect width="32" height="32" fill="#da291c" />
        <rect x="13" y="6" width="6" height="20" fill="#fff" />
        <rect x="6" y="13" width="20" height="6" fill="#fff" />
      </svg>
    );
  }
  // Striped flags fill the 3:2 box like the others (preserveAspectRatio none stretches the stripes only).
  if (c === 'DE') {
    return (
      <svg viewBox="0 0 5 3" preserveAspectRatio="none" className={base} {...a11y()}>
        <rect width="5" height="1" y="0" fill="#000" />
        <rect width="5" height="1" y="1" fill="#dd0000" />
        <rect width="5" height="1" y="2" fill="#ffce00" />
      </svg>
    );
  }
  if (c === 'AT') {
    return (
      <svg viewBox="0 0 3 3" preserveAspectRatio="none" className={base} {...a11y()}>
        <rect width="3" height="3" fill="#ed2939" />
        <rect width="3" height="1" y="1" fill="#fff" />
      </svg>
    );
  }
  if (c === 'NL') {
    return (
      <svg viewBox="0 0 3 3" preserveAspectRatio="none" className={base} {...a11y()}>
        <rect width="3" height="1" fill="#ae1c28" />
        <rect width="3" height="1" y="1" fill="#fff" />
        <rect width="3" height="1" y="2" fill="#21468b" />
      </svg>
    );
  }
  // The flags of the languages French, Italian and English (en-GB formats, so the British flag).
  if (c === 'FR') {
    return (
      <svg viewBox="0 0 3 2" className={base} {...a11y()}>
        <rect width="1" height="2" fill="#002654" />
        <rect width="1" height="2" x="1" fill="#fff" />
        <rect width="1" height="2" x="2" fill="#ce1126" />
      </svg>
    );
  }
  if (c === 'IT') {
    return (
      <svg viewBox="0 0 3 2" className={base} {...a11y()}>
        <rect width="1" height="2" fill="#009246" />
        <rect width="1" height="2" x="1" fill="#fff" />
        <rect width="1" height="2" x="2" fill="#ce2b37" />
      </svg>
    );
  }
  if (c === 'GB') {
    // Simplified for 18 x 12 px: the red saltire is not offset. slice fills the 3:2 box like the others.
    return (
      <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" className={base} {...a11y()}>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#c8102e" strokeWidth="2" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
      </svg>
    );
  }
  // Hetzner Cloud locations outside the DACH region.
  if (c === 'FI') {
    return (
      <svg viewBox="0 0 18 11" className={base} {...a11y()}>
        <rect width="18" height="11" fill="#fff" />
        <rect x="5" width="3" height="11" fill="#002f6c" />
        <rect y="4" width="18" height="3" fill="#002f6c" />
      </svg>
    );
  }
  if (c === 'US') {
    return (
      <svg viewBox="0 0 19 10" className={base} {...a11y()}>
        <rect width="19" height="10" fill="#fff" />
        {[0, 2, 4, 6, 8].map((y) => (
          <rect key={y} y={y} width="19" height="1" fill="#b22234" />
        ))}
        <rect width="8" height="5" fill="#3c3b6e" />
      </svg>
    );
  }
  if (c === 'SG') {
    return (
      <svg viewBox="0 0 3 2" className={base} {...a11y()}>
        <rect width="3" height="1" fill="#ef3340" />
        <rect width="3" height="1" y="1" fill="#fff" />
      </svg>
    );
  }
  return (
    <span
      className="rounded bg-surface-3 px-1 text-[10px] font-semibold text-muted"
      aria-hidden={decorative || undefined}
    >
      {c}
    </span>
  );
}

const PROVIDER_STYLE: Record<ProviderType, string> = {
  fire24: 'bg-[#fff1e6] text-[#c2410c] dark:bg-[#3a2212] dark:text-[#fdba74]',
  proxmox: 'bg-[#fff4e5] text-[#b45309] dark:bg-[#33270f] dark:text-[#fcd34d]',
  hetzner: 'bg-[#fdecec] text-[#c81e1e] dark:bg-[#3a1515] dark:text-[#fca5a5]',
  joker: 'bg-[#eaf2fb] text-[#2f6aa3] dark:bg-[#132536] dark:text-[#93c5fd]',
  nextcloud: 'bg-[#e8f3fc] text-[#0068b4] dark:bg-[#10283b] dark:text-[#7cc4fa]',
  cloudflare: 'bg-[#fef1e6] text-[#c2500a] dark:bg-[#3a2410] dark:text-[#fdba74]',
  mailcow: 'bg-[#eef5ea] text-[#3f7d2b] dark:bg-[#18291a] dark:text-[#9fd58a]',
  cloudpanel: 'bg-[#e8f1fd] text-[#1d5fbf] dark:bg-[#132339] dark:text-[#93c0f5]',
  threecx: 'bg-[#e9f7ef] text-[#1f7a43] dark:bg-[#12301f] dark:text-[#86efac]',
  jellyfin: 'bg-[#f3ecfd] text-[#7a3fd0] dark:bg-[#271a3d] dark:text-[#c4a5f7]',
  uptimekuma: 'bg-[#e8f7ee] text-[#167a3d] dark:bg-[#10301d] dark:text-[#7ee2a8]',
  demo: 'bg-info-soft text-[#0a8d90] dark:text-brand-teal',
};

const PROVIDER_LABEL: Record<ProviderType, string> = {
  fire24: '24fire',
  proxmox: 'Proxmox',
  hetzner: 'Hetzner',
  joker: 'Joker',
  nextcloud: 'Nextcloud',
  cloudflare: 'Cloudflare',
  mailcow: 'Mailcow',
  cloudpanel: 'CloudPanel',
  threecx: '3CX',
  jellyfin: 'Jellyfin',
  uptimekuma: 'Uptime Kuma',
  demo: 'Demo',
};

/**
 * Registrars (Joker.com) and DNS providers (Cloudflare) only have domains, Nextcloud and
 * Mailcow only accounts and mail domains, CloudPanel only websites, 3CX only a phone system,
 * Jellyfin only streaming accounts, Uptime Kuma only monitors: keep them out of server pickers
 * and filters.
 */
export const providerHasServers = (type: ProviderType): boolean =>
  type !== 'joker' &&
  type !== 'nextcloud' &&
  type !== 'cloudflare' &&
  type !== 'mailcow' &&
  type !== 'cloudpanel' &&
  type !== 'threecx' &&
  type !== 'jellyfin' &&
  type !== 'uptimekuma';

export function ProviderBadge({
  type,
  name,
  className,
}: {
  type: ProviderType;
  name?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
        PROVIDER_STYLE[type],
        className,
      )}
      title={name}
    >
      {PROVIDER_LABEL[type]}
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: ServerKind; className?: string }) {
  const Icon = kind === 'container' ? Box : ServerIcon;
  return <Icon className={cn('size-4 text-muted', className)} aria-hidden />;
}

export function SpecsLine({ specs, className }: { specs: ServerSpecs; className?: string }) {
  const t = useT();
  const parts = [
    specs.cores ? `${specs.cores} vCPU` : null,
    specs.memoryMb ? `${formatMemoryMb(specs.memoryMb)} RAM` : null,
    specs.diskGb ? `${Math.round(specs.diskGb)} GB ${t('server.disk')}` : null,
  ].filter(Boolean);
  return <span className={cn('text-sm text-muted tabular', className)}>{parts.join(' · ') || '–'}</span>;
}

export function LabelChips({
  labels,
  max = 4,
  className,
}: {
  labels: Record<string, string>;
  max?: number;
  className?: string;
}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {entries.slice(0, max).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted"
        >
          {k}
          {v && <span className="text-subtle">={v}</span>}
        </span>
      ))}
      {entries.length > max && <span className="text-[11px] text-subtle">+{entries.length - max}</span>}
    </div>
  );
}
