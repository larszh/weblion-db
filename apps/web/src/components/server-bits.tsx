import type { ProviderType, ServerKind, ServerSpecs, ServerStatus } from '@weblion/shared';
import { Box, Server as ServerIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMemoryMb } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/i18n/de';

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

/** Small inline flags. Emoji flags do not render on Windows, so these are drawn. */
export function Flag({ country, className }: { country: string; className?: string }) {
  const c = country.toUpperCase();
  const base = cn(
    'inline-block h-3 w-[18px] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10',
    className,
  );
  if (c === 'CH') {
    return (
      <svg viewBox="0 0 32 32" className={cn(base, 'h-3.5 w-3.5')} role="img" aria-label="Schweiz">
        <rect width="32" height="32" fill="#da291c" />
        <rect x="13" y="6" width="6" height="20" fill="#fff" />
        <rect x="6" y="13" width="20" height="6" fill="#fff" />
      </svg>
    );
  }
  if (c === 'DE') {
    return (
      <svg viewBox="0 0 5 3" className={base} role="img" aria-label="Deutschland">
        <rect width="5" height="1" y="0" fill="#000" />
        <rect width="5" height="1" y="1" fill="#dd0000" />
        <rect width="5" height="1" y="2" fill="#ffce00" />
      </svg>
    );
  }
  if (c === 'AT') {
    return (
      <svg viewBox="0 0 3 3" className={base} role="img" aria-label="Österreich">
        <rect width="3" height="3" fill="#ed2939" />
        <rect width="3" height="1" y="1" fill="#fff" />
      </svg>
    );
  }
  if (c === 'NL') {
    return (
      <svg viewBox="0 0 3 3" className={base} role="img" aria-label="Niederlande">
        <rect width="3" height="1" fill="#ae1c28" />
        <rect width="3" height="1" y="1" fill="#fff" />
        <rect width="3" height="1" y="2" fill="#21468b" />
      </svg>
    );
  }
  // Hetzner Cloud locations outside the DACH region.
  if (c === 'FI') {
    return (
      <svg viewBox="0 0 18 11" className={base} role="img" aria-label="Finnland">
        <rect width="18" height="11" fill="#fff" />
        <rect x="5" width="3" height="11" fill="#002f6c" />
        <rect y="4" width="18" height="3" fill="#002f6c" />
      </svg>
    );
  }
  if (c === 'US') {
    return (
      <svg viewBox="0 0 19 10" className={base} role="img" aria-label="USA">
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
      <svg viewBox="0 0 3 2" className={base} role="img" aria-label="Singapur">
        <rect width="3" height="1" fill="#ef3340" />
        <rect width="3" height="1" y="1" fill="#fff" />
      </svg>
    );
  }
  return <span className="rounded bg-surface-3 px-1 text-[10px] font-semibold text-muted">{c}</span>;
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
  demo: 'Demo',
};

/**
 * Registrars (Joker.com) and DNS providers (Cloudflare) only have domains, Nextcloud and
 * Mailcow only accounts and mail domains, CloudPanel only websites: keep them out of server
 * pickers and filters.
 */
export const providerHasServers = (type: ProviderType): boolean =>
  type !== 'joker' &&
  type !== 'nextcloud' &&
  type !== 'cloudflare' &&
  type !== 'mailcow' &&
  type !== 'cloudpanel';

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
