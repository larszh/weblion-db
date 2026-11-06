import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';
import type {
  AiDnsProposalDto,
  AiFeature,
  AiResultMeta,
  AiStatusDto,
  MeDto,
  OrgDto,
  Permission,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { qk } from '@/lib/queries';
import { useOptionalOrg } from '@/lib/org-context';
import { aiErrorText, aiFeatureOn, useAiStatus } from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, CopyButton, KeyValue, Mono, Notice } from '@/components/ui/primitives';
import { AiText } from './ai-text';

/** Small shared pieces of the AI module in the web: badges, the footnote, proposals, the access check. */

// --- Access ------------------------------------------------------------------------

/**
 * The signed-in person from the query cache, without fetching: the AI pieces render inside pages that
 * RequireAuth already loaded, and the provider also sits on the login page, where no request may start.
 */
export function useCachedMe(): MeDto | undefined {
  return useQuery({ queryKey: qk.me, queryFn: () => api.get<MeDto>('/auth/me'), enabled: false }).data;
}

export type AiArea = 'org' | 'admin';

/**
 * Whether a feature button may show (ai 12.5, plan 4.2): AI available with the feature switched on, and in
 * an organization ai:use (staff inside a customer also platform:ai:use), in the admin area platform:ai:use.
 * The feature's own permission (audit:read, server:metrics, ...) is the caller's. The API decides anyway.
 */
export function aiAllowed(input: {
  status: AiStatusDto | undefined;
  feature: AiFeature;
  area: AiArea;
  org: Pick<OrgDto, 'permissions' | 'access'> | null;
  platformPermissions: readonly Permission[];
}): boolean {
  if (!aiFeatureOn(input.status, input.feature)) return false;
  const staffAi = input.platformPermissions.includes('platform:ai:use');
  if (input.area === 'admin') return staffAi;
  if (!input.org || !input.org.permissions.includes('ai:use')) return false;
  return input.org.access !== 'staff' || staffAi;
}

/** aiAllowed for the current page: the organization in context, or the admin area. */
export function useAiAllowed(feature: AiFeature, area: AiArea = 'org'): boolean {
  const org = useOptionalOrg();
  const me = useCachedMe();
  const status = useAiStatus(!!me && (area === 'admin' || !!org));
  return aiAllowed({
    status: status.data,
    feature,
    area,
    org: org?.org ?? null,
    platformPermissions: me?.platformPermissions ?? [],
  });
}

// --- Labels ------------------------------------------------------------------------

const MODEL_NAMES: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

/** "Claude Opus 5.5" for the ids of AI_MODELS; any other id (a fallback model) as it is. */
export function modelLabel(model: string): string {
  return MODEL_NAMES[model] ?? model;
}

/** USD with two decimals from micro-USD, as the KI page and the staff card show costs. */
export function usdFromMicros(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

// --- Badges, footnote, notice --------------------------------------------------------

/** The demo badge with its hint as title (a plain title, so it also renders outside the tooltip provider). */
export function DemoBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge tone="warning" className={className} title={t('ai.demoHint')}>
      {t('ai.demoBadge')}
    </Badge>
  );
}

/** The data notice (ai 13.10) in a dialog; its text is the translation key ai.notice.text. */
export function NoticeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('ai.notice.title')} size="lg">
      <AiText text={t('ai.notice.text')} />
    </Dialog>
  );
}

/**
 * Under every AI result (ai 11.3): the footnote, a link to the data notice and, in demo mode, the badge.
 * With `meta` also the model that answered.
 */
export function AiFootnote({ meta, className }: { meta?: AiResultMeta | null; className?: string }) {
  const t = useT();
  const [notice, setNotice] = useState(false);
  const served = meta && meta.servedModel && meta.servedModel !== meta.model ? meta.servedModel : null;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted', className)}>
      {meta?.demo && <DemoBadge />}
      <span className="min-w-0">{t('ai.footnote')}</span>
      <button
        type="button"
        className="font-medium text-primary-text underline underline-offset-2"
        onClick={() => setNotice(true)}
      >
        {t('ai.notice.open')}
      </button>
      {meta && (
        <span className="text-subtle">
          {t('ai.assistant.model', { model: modelLabel(served ?? meta.model) })}
        </span>
      )}
      <NoticeDialog open={notice} onOpenChange={setNotice} />
    </div>
  );
}

/** The error of an AI request in its dialog (no "Mit KI erklären": the AI never explains its own errors). */
export function AiErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 break-words">{aiErrorText(t, error)}</div>
      {onRetry && (
        <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={onRetry}>
          {t('ai.assistant.retry')}
        </button>
      )}
    </div>
  );
}

// --- DNS proposals -----------------------------------------------------------------

export function ProposalBadge({ verified }: { verified: boolean }) {
  const t = useT();
  return verified ? (
    <Badge tone="success">
      <ShieldCheck className="size-3" aria-hidden />
      {t('ai.proposal.verified')}
    </Badge>
  ) : (
    <Badge tone="warning">
      <AlertTriangle className="size-3" aria-hidden />
      {t('ai.proposal.unverified')}
    </Badge>
  );
}

/** The extra confirmation before an unverified proposal opens the form (plan decision 23). */
export function UnverifiedConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <div
      role="alertdialog"
      aria-label={t('ai.proposal.unverifiedConfirm.title')}
      className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-3 text-sm"
    >
      <p className="font-semibold text-warning">{t('ai.proposal.unverifiedConfirm.title')}</p>
      <p className="mt-1 text-text">{t('ai.proposal.unverifiedConfirm.text')}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant="danger" onClick={onConfirm}>
          {t('ai.proposal.unverifiedConfirm.action')}
        </Button>
      </div>
    </div>
  );
}

const fqdn = (name: string, zone: string) => (name === '@' || name === '' ? zone : `${name}.${zone}`);

/**
 * One DNS proposal of the assistant or the DNS check (ai 8.4, 12.3). "Vorschlag übernehmen" opens the
 * normal record form pre-filled; an unverified value asks first. A textOnly proposal can only be copied.
 * `confirming` can be controlled (the assistant keeps it in its state), else the card keeps it itself.
 */
export function ProposalCard({
  proposal,
  onApply,
  confirming: controlled,
  onConfirmingChange,
}: {
  proposal: AiDnsProposalDto;
  onApply?: (proposal: AiDnsProposalDto) => void;
  confirming?: boolean;
  onConfirmingChange?: (confirming: boolean) => void;
}) {
  const t = useT();
  const [own, setOwn] = useState(false);
  const confirming = controlled ?? own;
  const setConfirming = (value: boolean) => {
    if (onConfirmingChange) onConfirmingChange(value);
    else setOwn(value);
  };
  const apply = () => onApply?.(proposal);
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text">
          {proposal.action === 'change' ? t('ai.proposal.change') : t('ai.proposal.add')}
        </span>
        <Badge tone="primary" className="font-mono">
          {proposal.type}
        </Badge>
        <ProposalBadge verified={proposal.verified} />
      </div>
      {!proposal.verified && <p className="mt-2 text-xs text-warning">{t('ai.proposal.unverifiedHint')}</p>}
      <KeyValue
        className="mt-2"
        items={[
          {
            label: t('hosting.dns.name'),
            value: <Mono className="break-all">{fqdn(proposal.name, proposal.zone)}</Mono>,
          },
          {
            label: t('hosting.dns.data'),
            value: (
              <span className="flex items-start gap-1">
                <Mono className="min-w-0 break-all text-text">{proposal.data}</Mono>
                <CopyButton value={proposal.data} label={t('ai.proposal.copy')} className="-mt-0.5" />
              </span>
            ),
          },
          ...(proposal.ttl !== null ? [{ label: t('hosting.dns.ttl'), value: String(proposal.ttl) }] : []),
          { label: t('ai.proposal.reason'), value: <AiText text={proposal.reason} /> },
        ]}
      />
      {proposal.textOnly || !proposal.domainId || !onApply ? (
        <Notice tone="info" className="mt-2">
          {t('ai.proposal.textOnly')}
        </Notice>
      ) : confirming ? (
        <UnverifiedConfirm
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            apply();
          }}
        />
      ) : (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => (proposal.verified ? apply() : setConfirming(true))}
          >
            {t('ai.proposal.apply')}
          </Button>
        </div>
      )}
    </div>
  );
}
