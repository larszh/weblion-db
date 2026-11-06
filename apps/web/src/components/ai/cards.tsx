import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AdminOrgAiDto, Locale, OrgAiDto, OrgDto, ResellerCustomerAiDto } from '@weblion/shared';
import { useI18n, type TFunction } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import {
  useAdminOrgAi,
  useOrgAi,
  useOrgAiDecline,
  useResellerCustomerAi,
  useSetAdminOrgAi,
  useSetResellerCustomerAi,
} from '@/lib/api/ai';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import { Badge, Card, CardBody, CardHeader, ErrorState, LoadingBlock } from '@/components/ui/primitives';
import { AiErrorBox, NoticeDialog, usdFromMicros } from './bits';

/**
 * The three switch cards (ai 12.4, 5.5): the organization's own card (decline or allow), the staff card on
 * the admin customer page and the reseller's card on its customer page. All three show whatever the
 * platform state is (plan O27). AI is opt-in per customer (plan O34): switching a customer on asks for the
 * confirmation that the customer agreed, and sends consentConfirmed.
 */

type CardDto = Pick<OrgAiDto, 'enabled' | 'switch' | 'reseller' | 'declined' | 'platform'>;

/** Never switched on: off and nobody switched it off (the default of every organization, plan O34). */
export const neverEnabled = (dto: Pick<OrgAiDto, 'switch'>) => !dto.switch.enabled && dto.switch.by === null;

/** The reason lines of the organization's own card, most binding first. */
export function orgAiLines(dto: CardDto, t: TFunction, locale: Locale): string[] {
  const lines: string[] = [];
  if (!dto.platform.available) lines.push(t('ai.org.platformOff'));
  if (dto.declined) {
    lines.push(
      t('ai.org.declined', {
        date: formatDate(dto.declined.at, locale, false),
        name: dto.declined.by?.name ?? '–',
      }),
    );
  }
  if (neverEnabled(dto)) lines.push(t('ai.org.notEnabled'));
  else if (!dto.switch.enabled && dto.switch.by === 'platform') lines.push(t('ai.org.offByPlatform'));
  const resellerOff = dto.switch.by === 'reseller' || (dto.reseller !== null && !dto.reseller.enabled);
  if (resellerOff && dto.reseller) lines.push(t('ai.org.offByReseller', { name: dto.reseller.name }));
  return lines;
}

/** The state lines of the staff card. */
export function adminAiLines(dto: CardDto, t: TFunction, locale: Locale): string[] {
  const lines: string[] = [];
  if (!dto.platform.available) lines.push(t('admin.ai.card.platformOff'));
  if (dto.reseller && !dto.reseller.enabled)
    lines.push(t('admin.ai.card.reseller', { name: dto.reseller.name }));
  if (dto.declined)
    lines.push(t('admin.ai.card.declined', { date: formatDate(dto.declined.at, locale, false) }));
  return lines;
}

/** The reseller's switch: locked when weblion switched the customer off or the reseller's own AI is off. */
export function resellerAiState(dto: CardDto): { lockedByPlatform: boolean; ownOff: boolean } {
  return {
    lockedByPlatform: !dto.switch.enabled && dto.switch.by === 'platform',
    ownOff: dto.reseller !== null && !dto.reseller.enabled,
  };
}

/**
 * The badge of a card: the organization's own state, except that a switched-on organization reads "Noch nicht
 * aktiv" while the platform is off, so the badge never contradicts the line below it (ai.org.platformOff).
 */
export function StateBadge({ dto }: { dto: Pick<CardDto, 'enabled' | 'platform'> }) {
  const { t } = useI18n();
  if (!dto.enabled) return <Badge tone="neutral">{t('ai.org.state.off')}</Badge>;
  if (!dto.platform.available) return <Badge tone="neutral">{t('ai.org.state.notActive')}</Badge>;
  return <Badge tone="success">{t('ai.org.state.on')}</Badge>;
}

function Lines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm text-muted">
      {lines.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

/**
 * Switching a customer on (plan O34): the person confirms that the customer agreed (contract or AVV
 * addendum). The action stays disabled until the box is ticked; the server refuses without it as well.
 */
export function ConsentDialog({
  open,
  onOpenChange,
  name,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const change = (next: boolean) => {
    if (!next) setChecked(false);
    onOpenChange(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title={t('admin.ai.card.consentTitle', { name })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => change(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!checked} loading={pending} onClick={onConfirm}>
            {t('admin.ai.card.consentAction')}
          </Button>
        </>
      }
    >
      <ConsentBody checked={checked} onCheckedChange={setChecked} error={error} />
    </Dialog>
  );
}

/** The dialog's body on its own, so a static render test sees it (the dialog renders into a portal). */
export function ConsentBody({
  checked,
  onCheckedChange,
  error,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: unknown;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-text">{t('admin.ai.card.consentText')}</p>
      <label className="flex items-start gap-2.5 text-text">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <span>{t('admin.ai.card.consentCheck')}</span>
      </label>
      {!!error && <AiErrorBox error={error} />}
    </div>
  );
}

/** The organization's own card (organization settings, whenever ai:settings). Works while suspended. */
export function OrgAiCard({ org }: { org: Pick<OrgDto, 'id'> }) {
  const { t, locale } = useI18n();
  const ai = useOrgAi(org.id);
  const decline = useOrgAiDecline(org.id);
  const [confirm, setConfirm] = useState<'decline' | 'allow' | null>(null);
  const [notice, setNotice] = useState(false);
  const declined = !!ai.data?.declined;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-primary-text" aria-hidden />
            {t('ai.org.title')}
          </span>
        }
        description={t('ai.org.description')}
        actions={ai.data ? <StateBadge dto={ai.data} /> : undefined}
      />
      {ai.isPending ? (
        <LoadingBlock rows={2} />
      ) : ai.isError ? (
        <CardBody>
          <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
        </CardBody>
      ) : (
        <CardBody className="space-y-4">
          <Lines lines={orgAiLines(ai.data, t, locale)} />
          <p className="text-sm text-text">
            {t('ai.org.usage', { count: ai.data.usage.requests })}
            {ai.data.usage.staffRequests > 0 && (
              <span className="text-muted">
                {' · '}
                {t('ai.org.usageStaff', { count: ai.data.usage.staffRequests })}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={declined ? 'secondary' : 'danger-soft'}
              onClick={() => setConfirm(declined ? 'allow' : 'decline')}
            >
              {declined ? t('ai.org.allow') : t('ai.org.decline')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNotice(true)}>
              {t('ai.org.notice')}
            </Button>
          </div>
        </CardBody>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'allow' ? t('ai.org.allowConfirm.title') : t('ai.org.declineConfirm.title')}
        description={confirm === 'allow' ? t('ai.org.allowConfirm.text') : t('ai.org.declineConfirm.text')}
        confirmLabel={
          confirm === 'allow' ? t('ai.org.allowConfirm.action') : t('ai.org.declineConfirm.action')
        }
        danger={confirm === 'decline'}
        loading={decline.isPending}
        onConfirm={() => decline.mutate(confirm === 'decline', { onSuccess: () => setConfirm(null) })}
      />
      <NoticeDialog open={notice} onOpenChange={setNotice} />
    </Card>
  );
}

/** The staff card on the admin customer page: the platform switch of one customer, usage with costs. */
export function AdminAiCard({
  orgId,
  orgName,
  canWrite,
}: {
  orgId: string;
  orgName: string;
  canWrite: boolean;
}) {
  const { t, locale } = useI18n();
  const ai = useAdminOrgAi(orgId);
  const [consent, setConsent] = useState(false);
  const set = useSetAdminOrgAi(orgId, () => setConsent(false));
  const data: AdminOrgAiDto | undefined = ai.data;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-primary-text" aria-hidden />
            {t('admin.ai.card.title')}
          </span>
        }
        actions={data ? <StateBadge dto={data} /> : undefined}
      />
      {ai.isPending ? (
        <LoadingBlock rows={2} />
      ) : ai.isError ? (
        <CardBody>
          <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
        </CardBody>
      ) : (
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text">{t('admin.ai.card.switch')}</span>
            <Switch
              checked={ai.data.switch.enabled}
              disabled={!canWrite || set.isPending}
              label={t('admin.ai.card.switch')}
              onCheckedChange={(on) => (on ? setConsent(true) : set.mutate({ enabled: false }))}
            />
          </div>
          <Lines lines={adminAiLines(ai.data, t, locale)} />
          <p className="text-sm text-text">
            {t('admin.ai.card.usage', {
              count: ai.data.usage.requests,
              cost: usdFromMicros(ai.data.usageCostMicros),
            })}
            {ai.data.usage.staffRequests > 0 && (
              <span className="text-muted">
                {' · '}
                {t('admin.ai.card.usageStaff', { count: ai.data.usage.staffRequests })}
              </span>
            )}
          </p>
          {!consent && !!set.error && <AiErrorBox error={set.error} />}
        </CardBody>
      )}
      <ConsentDialog
        open={consent}
        onOpenChange={(open) => {
          setConsent(open);
          if (!open) set.reset();
        }}
        name={orgName}
        pending={set.isPending}
        error={set.error}
        onConfirm={() => set.mutate({ enabled: true, consentConfirmed: true })}
      />
    </Card>
  );
}

/** The reseller's card on its customer page: counts only, never costs (plan decision 21). */
export function ResellerAiCard({
  resellerId,
  customerId,
  customerName,
  canWrite,
}: {
  resellerId: string;
  customerId: string;
  customerName: string;
  canWrite: boolean;
}) {
  const { t, locale } = useI18n();
  const ai = useResellerCustomerAi(resellerId, customerId);
  const [consent, setConsent] = useState(false);
  const set = useSetResellerCustomerAi(resellerId, customerId, () => setConsent(false));
  const data: ResellerCustomerAiDto | undefined = ai.data;
  const state = data ? resellerAiState(data) : null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-primary-text" aria-hidden />
            {t('ai.reseller.title')}
          </span>
        }
        actions={data ? <StateBadge dto={data} /> : undefined}
      />
      {ai.isPending ? (
        <LoadingBlock rows={2} />
      ) : ai.isError ? (
        <CardBody>
          <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
        </CardBody>
      ) : (
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text">{t('ai.reseller.switch')}</span>
            <Switch
              checked={ai.data.switch.enabled}
              // Switching on is impossible while weblion locked the customer or the reseller's own AI is off.
              disabled={
                !canWrite ||
                set.isPending ||
                (!ai.data.switch.enabled && (state!.lockedByPlatform || state!.ownOff))
              }
              label={t('ai.reseller.switch')}
              onCheckedChange={(on) => (on ? setConsent(true) : set.mutate({ enabled: false }))}
            />
          </div>
          <ul className="space-y-1.5 text-sm text-muted">
            {state!.lockedByPlatform && <li>{t('ai.reseller.lockedByPlatform')}</li>}
            {state!.ownOff && <li>{t('ai.reseller.ownOff')}</li>}
            {ai.data.declined && (
              <li>{t('ai.reseller.declined', { date: formatDate(ai.data.declined.at, locale, false) })}</li>
            )}
          </ul>
          <p className="text-sm text-text">{t('ai.reseller.usage', { count: ai.data.usage.requests })}</p>
          {!consent && !!set.error && <AiErrorBox error={set.error} />}
        </CardBody>
      )}
      <ConsentDialog
        open={consent}
        onOpenChange={(open) => {
          setConsent(open);
          if (!open) set.reset();
        }}
        name={customerName}
        pending={set.isPending}
        error={set.error}
        onConfirm={() => set.mutate({ enabled: true, consentConfirmed: true })}
      />
    </Card>
  );
}
