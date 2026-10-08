import { useState, type ReactNode } from 'react';
import {
  BookOpen,
  CreditCard,
  Mail,
  MailCheck,
  Plug,
  Receipt,
  RefreshCw,
  Send,
  Trash2,
  Unplug,
} from 'lucide-react';
import type { IntegrationsDto, MailLogDto, MailSettingsDto, Permission } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { formatDate, formatRelative } from '@/lib/format';
import { useMe } from '@/lib/queries';
import {
  useDeleteMailSettings,
  useIntegrations,
  useMailLog,
  useMailSettings,
  useSaveMailSettings,
  useTestMail,
  useZohoSyncPending,
  useZohoTest,
  type MailResult,
} from '@/lib/api/admin';
import type { TranslationKey } from '@/i18n/de';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  Mono,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BillingSettingsForm } from '@/pages/billing/settings-form';
import { TabBar, useTabParam } from '@/pages/reseller/bits';

/** Environment variables per integration, shown so admins know what to put into .env. */
const SMTP_ENV = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'SMTP_REPLY_TO',
];
const STRIPE_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PAYMENT_METHODS'];
const ZOHO_ENV = [
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_ORGANIZATION_ID',
  'ZOHO_ACCOUNTS_URL',
  'ZOHO_API_URL',
  'ZOHO_TAX_IDS',
];
/** Stripe events the webhook handles. */
const STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
];
const MAIL_TEMPLATES = [
  'invitation',
  'invoice',
  'invoice_reminder',
  'payment_received',
  'credit_booked',
  'test',
] as const;
const MAIL_STATUSES: MailLogDto['status'][] = ['sent', 'failed', 'skipped'];

function usePlatformCan() {
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  return (permission: Permission) => perms.includes(permission);
}

function EnvList({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((n) => (
        <Mono key={n} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11.5px]">
          {n}
        </Mono>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: MailSettingsDto['source'] }) {
  const { t } = useI18n();
  if (source === 'env') return <Badge tone="info">{t('admin.mail.source.env')}</Badge>;
  if (source === 'ui') return <Badge tone="success">{t('admin.mail.source.ui')}</Badge>;
  return <Badge tone="warning">{t('admin.mail.source.none')}</Badge>;
}

function MailStatusBadge({ status }: { status: MailLogDto['status'] }) {
  const { t } = useI18n();
  const tone = status === 'sent' ? 'success' : status === 'failed' ? 'danger' : 'neutral';
  return <Badge tone={tone}>{t(`admin.mail.status.${status}`)}</Badge>;
}

/** Outcome of a test mail, shown under the button. */
function MailResultNotice({ result, to }: { result: MailResult; to: string }) {
  const { t } = useI18n();
  if (result.status === 'sent') {
    return (
      <Notice tone="success" icon={<MailCheck className="size-4" />}>
        {t('admin.mail.testSent', { to })}
      </Notice>
    );
  }
  if (result.status === 'failed') {
    return (
      <Notice tone="danger" title={t('admin.mail.testFailed')}>
        <span className="break-words">{result.error}</span>
      </Notice>
    );
  }
  return <Notice tone="warning">{t('admin.mail.testSkipped')}</Notice>;
}

// --- E-Mail ------------------------------------------------------------------------

function MailSettingsCard({ settings }: { settings: MailSettingsDto }) {
  const { t } = useI18n();
  const readOnly = settings.source === 'env';
  const [host, setHost] = useState(settings.host ?? '');
  const [port, setPort] = useState(String(settings.port || 587));
  const [secure, setSecure] = useState(settings.secure);
  const [user, setUser] = useState(settings.user ?? '');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [from, setFrom] = useState(settings.from ?? '');
  const [replyTo, setReplyTo] = useState(settings.replyTo ?? '');
  const [removing, setRemoving] = useState(false);
  const save = useSaveMailSettings(t('admin.mail.saved'));
  const remove = useDeleteMailSettings(t('admin.mail.removed'), () => setRemoving(false));

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535;
  const valid = host.trim().length > 0 && portValid && from.trim().length > 0;

  // The usual ports follow the TLS mode unless someone entered a custom one.
  const toggleSecure = (on: boolean) => {
    setSecure(on);
    if (on && port === '587') setPort('465');
    if (!on && port === '465') setPort('587');
  };

  const submit = () =>
    save.mutate({
      host: host.trim(),
      port: portNumber,
      secure,
      user: user.trim() || null,
      // Omitted keeps the stored password, "" removes it.
      password: clearPassword ? '' : password ? password : undefined,
      from: from.trim(),
      replyTo: replyTo.trim() || null,
    });

  return (
    <Card>
      <CardHeader
        title={t('admin.mail.title')}
        description={t('admin.mail.text')}
        actions={<SourceBadge source={settings.source} />}
      />
      <CardBody className="space-y-4">
        {readOnly ? (
          <Notice tone="info" title={t('admin.mail.envTitle')}>
            <p className="mb-2">{t('admin.mail.envText')}</p>
            <EnvList names={SMTP_ENV} />
          </Notice>
        ) : settings.source === 'none' ? (
          <Notice tone="warning">{t('admin.mail.noneText')}</Notice>
        ) : null}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !readOnly) submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label={t('admin.mail.host')} htmlFor="smtp-host">
              <Input
                id="smtp-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.example.ch"
                disabled={readOnly}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('admin.mail.port')}
              htmlFor="smtp-port"
              error={port && !portValid ? t('admin.mail.portInvalid') : undefined}
            >
              <Input
                id="smtp-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                disabled={readOnly}
              />
            </Field>
          </div>
          <label className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{t('admin.mail.secure')}</span>
              <span className="block text-xs text-muted">{t('admin.mail.secureHint')}</span>
            </span>
            <Switch
              checked={secure}
              onCheckedChange={toggleSecure}
              disabled={readOnly}
              label={t('admin.mail.secure')}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.mail.user')} hint={t('common.optional')} htmlFor="smtp-user">
              <Input
                id="smtp-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                disabled={readOnly}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('admin.mail.password')}
              hint={
                readOnly
                  ? settings.passwordSet
                    ? t('admin.mail.passwordSet')
                    : t('admin.mail.passwordNotSet')
                  : settings.passwordSet
                    ? t('admin.mail.passwordKeepHint')
                    : t('common.optional')
              }
              htmlFor="smtp-password"
            >
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={settings.passwordSet ? t('admin.mail.passwordKeep') : ''}
                disabled={readOnly || clearPassword}
                autoComplete="new-password"
              />
            </Field>
          </div>
          {settings.passwordSet && !readOnly && (
            <label className="-mt-1 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={clearPassword}
                onChange={(e) => {
                  setClearPassword(e.target.checked);
                  if (e.target.checked) setPassword('');
                }}
              />
              {t('admin.mail.passwordClear')}
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.mail.from')} hint={t('admin.mail.fromHint')} htmlFor="smtp-from">
              <Input
                id="smtp-from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="weblion.one <noreply@weblion.one>"
                disabled={readOnly}
                spellCheck={false}
              />
            </Field>
            <Field label={t('admin.mail.replyTo')} hint={t('common.optional')} htmlFor="smtp-reply">
              <Input
                id="smtp-reply"
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="support@weblion.one"
                disabled={readOnly}
                spellCheck={false}
              />
            </Field>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>
                {t('common.save')}
              </Button>
              {settings.source === 'ui' && (
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => setRemoving(true)}
                >
                  {t('admin.mail.remove')}
                </Button>
              )}
            </div>
          )}
        </form>
      </CardBody>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('admin.mail.removeTitle')}
        description={t('admin.mail.removeText')}
        confirmLabel={t('admin.mail.remove')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function TestMailCard({ configured }: { configured: boolean }) {
  const { t } = useI18n();
  const me = useMe();
  const [to, setTo] = useState(me.data?.user.email ?? '');
  const [result, setResult] = useState<{ to: string; result: MailResult } | null>(null);
  const test = useTestMail();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  return (
    <Card>
      <CardHeader title={t('admin.mail.test')} description={t('admin.mail.testText')} />
      <CardBody>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const recipient = to.trim();
            test.mutate(recipient, { onSuccess: (r) => setResult({ to: recipient, result: r }) });
          }}
        >
          <Field label={t('admin.mail.testTo')} htmlFor="test-to">
            <Input id="test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button
            type="submit"
            icon={<Send className="size-4" />}
            disabled={!valid}
            loading={test.isPending}
            className="w-full justify-center sm:w-auto"
          >
            {t('admin.mail.testSend')}
          </Button>
          {!configured && !result && (
            <p className="text-xs text-muted">{t('admin.mail.testNotConfigured')}</p>
          )}
          {result && <MailResultNotice result={result.result} to={result.to} />}
        </form>
      </CardBody>
    </Card>
  );
}

function templateLabel(t: (key: TranslationKey) => string, template: string | null): string {
  if (!template) return '–';
  return (MAIL_TEMPLATES as readonly string[]).includes(template)
    ? t(`admin.mail.template.${template as (typeof MAIL_TEMPLATES)[number]}`)
    : template;
}

function MailLogCard() {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<MailLogDto['status'] | ''>('');
  const log = useMailLog({ page, status: status || undefined });
  const totalPages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.perPage)) : 1;
  return (
    <Card>
      <CardHeader
        title={t('admin.mail.log')}
        description={t('admin.mail.logText')}
        actions={
          <Select
            className="h-8 w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as MailLogDto['status'] | '');
              setPage(1);
            }}
            aria-label={t('orgSettings.status')}
          >
            <option value="">{t('admin.mail.allStatuses')}</option>
            {MAIL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.mail.status.${s}`)}
              </option>
            ))}
          </Select>
        }
      />
      {log.isError ? (
        <div className="p-5">
          <ErrorState error={log.error} onRetry={() => void log.refetch()} />
        </div>
      ) : log.isPending ? (
        <LoadingBlock rows={4} />
      ) : log.data.items.length === 0 ? (
        <EmptyState
          className="py-10"
          icon={<Mail className="size-6" />}
          title={status ? t('admin.noMatch') : t('admin.mail.logEmpty')}
        />
      ) : (
        <div className={cn(log.isFetching && 'opacity-60')}>
          <Table>
            <THead>
              <tr>
                <TH>{t('admin.mail.col.time')}</TH>
                <TH>{t('admin.mail.col.to')}</TH>
                <TH>{t('admin.mail.col.subject')}</TH>
                <TH>{t('orgSettings.status')}</TH>
              </tr>
            </THead>
            <TBody>
              {log.data.items.map((m) => (
                <TR key={m.id}>
                  <TD className="whitespace-nowrap text-muted" title={formatDate(m.createdAt, locale)}>
                    {formatRelative(m.createdAt, locale)}
                  </TD>
                  <TD>
                    <span className="block max-w-[220px] truncate" title={m.to}>
                      {m.to}
                    </span>
                    {m.org && <span className="block text-xs text-muted">{m.org.name}</span>}
                  </TD>
                  <TD>
                    <span className="block max-w-[320px] truncate" title={m.subject}>
                      {m.subject}
                    </span>
                    <span className="block text-xs text-muted">{templateLabel(t, m.template)}</span>
                  </TD>
                  <TD>
                    <MailStatusBadge status={m.status} />
                    {m.error && (
                      <span
                        className="mt-0.5 block max-w-[260px] truncate text-xs text-danger"
                        title={m.error}
                      >
                        {m.error}
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {log.data && log.data.total > log.data.perPage && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
          <span className="text-muted">
            {t('admin.mail.count', { n: log.data.total })} · {t('common.pageOf', { page, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('common.prev')}
            </Button>
            <Button size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MailTab() {
  const settings = useMailSettings();
  if (settings.isPending) return <LoadingBlock rows={6} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Keyed so the form takes over the saved values after a save or delete. */}
        <MailSettingsCard key={JSON.stringify(settings.data)} settings={settings.data} />
        <div className="space-y-6">
          <TestMailCard configured={settings.data.source !== 'none'} />
        </div>
      </div>
      <MailLogCard />
    </div>
  );
}

// --- Integrations ------------------------------------------------------------------

function IntegrationCard({
  icon,
  title,
  description,
  configured,
  children,
  footer,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  configured: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text [&>svg]:size-[18px]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-text">{title}</h3>
            <Badge tone={configured ? 'success' : 'neutral'}>
              {configured ? t('admin.int.configured') : t('admin.int.notConfigured')}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      <CardBody className="flex-1 space-y-4">{children}</CardBody>
      {footer && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">{footer}</div>
      )}
    </Card>
  );
}

function EnvSection({ names, hint }: { names: string[]; hint?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{t('admin.int.env')}</p>
      <EnvList names={names} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function YesNo({ value, yes, no, warn }: { value: boolean; yes: string; no: string; warn?: boolean }) {
  return value ? (
    <Badge tone="success">{yes}</Badge>
  ) : (
    <Badge tone={warn ? 'warning' : 'neutral'}>{no}</Badge>
  );
}

function SmtpIntegration({ mail, onOpen }: { mail: IntegrationsDto['mail']; onOpen?: () => void }) {
  const { t } = useI18n();
  return (
    <IntegrationCard
      icon={<Mail />}
      title={t('admin.int.smtp')}
      description={t('admin.int.smtpText')}
      configured={mail.configured}
      footer={
        onOpen && (
          <Button size="sm" onClick={onOpen}>
            {t('admin.int.smtpOpen')}
          </Button>
        )
      }
    >
      <KeyValue items={[{ label: t('admin.int.source'), value: <SourceBadge source={mail.source} /> }]} />
      <EnvSection names={SMTP_ENV} hint={t('admin.int.smtpEnvHint')} />
    </IntegrationCard>
  );
}

function StripeIntegration({ stripe }: { stripe: IntegrationsDto['stripe'] }) {
  const { t } = useI18n();
  // The console and the API share one origin (APP_URL), so this is the public webhook address.
  const webhookUrl = `${window.location.origin}/api/v1/payments/stripe/webhook`;
  return (
    <IntegrationCard
      icon={<CreditCard />}
      title="Stripe"
      description={t('admin.int.stripeText')}
      configured={stripe.configured}
    >
      <KeyValue
        items={[
          {
            label: t('admin.int.mode'),
            value: stripe.mode ? (
              <Badge tone={stripe.mode === 'live' ? 'success' : 'warning'}>
                {t(`admin.int.mode.${stripe.mode}`)}
              </Badge>
            ) : (
              <span className="text-subtle">–</span>
            ),
          },
          {
            label: t('admin.int.webhook'),
            value: (
              <YesNo
                value={stripe.webhookConfigured}
                yes={t('admin.int.webhookSet')}
                no={t('admin.int.webhookMissing')}
                warn={stripe.configured}
              />
            ),
          },
          {
            label: 'TWINT',
            value: <YesNo value={stripe.twint} yes={t('admin.int.active')} no={t('admin.int.inactive')} />,
          },
        ]}
      />
      {stripe.configured && !stripe.webhookConfigured && (
        <Notice tone="warning">{t('admin.int.webhookWarning')}</Notice>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{t('admin.int.webhookUrl')}</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Mono className="min-w-0 flex-1 truncate">{webhookUrl}</Mono>
          <CopyButton value={webhookUrl} />
        </div>
        <p className="text-xs text-muted">{t('admin.int.webhookHint')}</p>
        <div className="flex flex-wrap gap-1.5">
          {STRIPE_EVENTS.map((e) => (
            <Mono key={e} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted">
              {e}
            </Mono>
          ))}
        </div>
      </div>
      <EnvSection names={STRIPE_ENV} hint={t('admin.int.stripeEnvHint')} />
    </IntegrationCard>
  );
}

function ZohoIntegration({ zoho }: { zoho: IntegrationsDto['zoho'] }) {
  const { t, locale } = useI18n();
  const can = usePlatformCan();
  const test = useZohoTest();
  const sync = useZohoSyncPending((r) => t('admin.int.zohoSynced', { synced: r.synced, failed: r.failed }));
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    organizationName?: string;
    error?: string;
  } | null>(null);
  return (
    <IntegrationCard
      icon={<BookOpen />}
      title="Zoho Books"
      description={t('admin.int.zohoText')}
      configured={zoho.configured}
      footer={
        <>
          {can('platform:settings') && (
            <Button
              size="sm"
              icon={<Plug className="size-4" />}
              disabled={!zoho.configured}
              loading={test.isPending}
              onClick={() => test.mutate(undefined, { onSuccess: setTestResult })}
            >
              {t('admin.int.zohoTest')}
            </Button>
          )}
          {can('platform:billing:write') && (
            <Button
              size="sm"
              icon={<RefreshCw className="size-4" />}
              disabled={!zoho.configured}
              loading={sync.isPending}
              onClick={() => sync.mutate(undefined)}
            >
              {t('admin.int.zohoSync')}
            </Button>
          )}
        </>
      }
    >
      <KeyValue
        items={[
          {
            label: t('admin.int.zohoOrg'),
            value: zoho.organizationId ? (
              <Mono>{zoho.organizationId}</Mono>
            ) : (
              <span className="text-subtle">–</span>
            ),
          },
          {
            label: t('admin.int.lastSync'),
            value: zoho.lastSyncAt ? (
              <span title={formatDate(zoho.lastSyncAt, locale)}>
                {formatRelative(zoho.lastSyncAt, locale)}
              </span>
            ) : (
              <span className="text-subtle">{t('admin.int.never')}</span>
            ),
          },
        ]}
      />
      {zoho.lastError && (
        <Notice tone="danger" icon={<Unplug className="size-4" />} title={t('admin.int.lastError')}>
          <span className="break-words">{zoho.lastError}</span>
        </Notice>
      )}
      {testResult &&
        (testResult.ok ? (
          <Notice tone="success" icon={<Plug className="size-4" />}>
            {testResult.organizationName
              ? t('admin.int.zohoOk', { name: testResult.organizationName })
              : t('admin.int.zohoOkPlain')}
          </Notice>
        ) : (
          <Notice tone="danger" title={t('admin.int.zohoFailed')}>
            <span className="break-words">{testResult.error}</span>
          </Notice>
        ))}
      <EnvSection names={ZOHO_ENV} hint={t('admin.int.zohoEnvHint')} />
    </IntegrationCard>
  );
}

function IntegrationsTab({ onOpenMail }: { onOpenMail?: () => void }) {
  const { t } = useI18n();
  const integrations = useIntegrations();
  if (integrations.isPending) return <LoadingBlock rows={6} />;
  if (integrations.isError) {
    return <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />;
  }
  const data = integrations.data;
  return (
    <div className="space-y-6">
      <Notice tone="info">{t('admin.int.intro')}</Notice>
      <div className="grid items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <SmtpIntegration mail={data.mail} onOpen={onOpenMail} />
        <StripeIntegration stripe={data.stripe} />
        <ZohoIntegration zoho={data.zoho} />
      </div>
    </div>
  );
}

export function AdminSettingsPage() {
  const { t } = useI18n();
  const can = usePlatformCan();
  const tabs = [
    {
      value: 'mail' as const,
      label: t('admin.settings.tab.mail'),
      icon: <Mail />,
      show: can('platform:settings'),
    },
    {
      value: 'billing' as const,
      label: t('admin.settings.tab.billing'),
      icon: <Receipt />,
      show: can('platform:settings') || can('platform:billing:read'),
    },
    { value: 'integrations' as const, label: t('admin.settings.tab.integrations'), icon: <Plug /> },
  ];
  const [tab, setTab] = useTabParam(tabs);
  return (
    <>
      <PageHeader title={t('nav.admin.settings')} description={t('admin.settings.subtitle')} />
      <TabBar label={t('nav.admin.settings')} tabs={tabs} current={tab} onChange={setTab} />
      {tab === 'mail' ? (
        <MailTab />
      ) : tab === 'billing' ? (
        <BillingSettingsForm />
      ) : (
        <IntegrationsTab onOpenMail={can('platform:settings') ? () => setTab('mail') : undefined} />
      )}
    </>
  );
}
