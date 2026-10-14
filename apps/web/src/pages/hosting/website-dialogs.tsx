import { useId, useState, type ReactNode } from 'react';
import { Link2, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import {
  PHP_VERSION_PATTERN,
  SITE_USER_PATTERN,
  WEBSITE_TEMPLATE_PATTERN,
  isReservedSiteUser,
  suggestSiteUser,
  websiteDomainAscii,
  type CreatableWebsiteType,
  type WebsiteAllowanceDto,
  type WebsiteCreateRequest,
  type WebsiteCreatedDto,
  type WebsiteCredentialsDto,
  type WebsiteDatabaseDto,
  type WebsiteDatabaseSecretDto,
  type WebsiteServerOptions,
  type WebspaceDetailDto,
  type WebspaceDto,
} from '@weblion/shared';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import {
  useCreateWebsite,
  useCreateWebsiteDatabase,
  useDeleteWebsite,
  useDeleteWebsiteDatabase,
  useForgetWebsite,
  useIssueCertificate,
  useResetWebsiteDatabasePassword,
  useResetWebsitePassword,
  useWebsiteDnsCheck,
} from '@/lib/api/websites';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, KeyValue, LoadingBlock, Mono, Notice, Select } from '@/components/ui/primitives';
import {
  CopyValue,
  DnsCheckTable,
  asciiDomain,
  ExpectedDnsTable,
  WebsitePasswordChoice,
  allowanceRoom,
  databaseNamePreview,
  defaultDatabaseSuffix,
  deleteConfirmValue,
  dnsBlocker,
  errorField,
  foreignDnsAnswers,
  outcomeUnknown,
  passwordReady,
  sftpUrl,
  sshCommand,
  templateWantsDatabase,
  useWebsiteError,
  type DatabaseNameIssue,
  type PasswordMode,
} from './website-bits';

/**
 * Dialogs of the website pages: create (customers and staff share the form), credentials
 * shown once, new passwords, databases, the certificate with its DNS check, delete, forget.
 *
 * Every dialog that receives a password keeps it in its own state until the user confirms
 * having saved it; it cannot be closed while a request runs, so an answer is never lost.
 */

// --- Credentials shown once -------------------------------------------------------------

export interface ShownCredentials {
  /** SFTP/SSH login (creation, new site user password). */
  access: WebsiteCredentialsDto | null;
  database: WebsiteDatabaseSecretDto | null;
  /** Non-fatal notes of the server, e.g. a database that could not be created. */
  warnings: string[];
}

export const shownFromCreated = (r: WebsiteCreatedDto): ShownCredentials => ({
  access: r.access,
  database: r.database,
  warnings: r.warnings,
});

function SecretValue({ value }: { value: string | null }) {
  const { t } = useI18n();
  if (value === null) return <span className="text-muted">{t('websites.creds.passwordChosen')}</span>;
  return <CopyValue value={value} className="font-semibold" />;
}

/** SFTP/SSH and database access with copy buttons: host, port, user, password. */
export function CredentialsPanel({ shown }: { shown: ShownCredentials }) {
  const { t } = useI18n();
  const { access, database } = shown;
  return (
    <div className="space-y-5">
      {shown.warnings.map((w, i) => (
        <Notice key={i} tone="warning">
          {w}
        </Notice>
      ))}
      {access && (
        <section>
          <h4 className="text-sm font-semibold text-text">{t('websites.creds.sftp')}</h4>
          <KeyValue
            items={[
              { label: t('websites.access.host'), value: <CopyValue value={access.host} /> },
              { label: t('websites.access.port'), value: <CopyValue value={String(access.port)} /> },
              { label: t('websites.access.username'), value: <CopyValue value={access.username} /> },
              { label: t('websites.creds.password'), value: <SecretValue value={access.password} /> },
            ]}
          />
          <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-muted">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link2 className="size-3.5 shrink-0" aria-hidden />
              <span>{t('websites.creds.sftpLink')}</span>
              <a
                href={sftpUrl(access.username, access.host, access.port)}
                className="font-mono text-[12.5px] break-all text-primary-text hover:underline"
              >
                {sftpUrl(access.username, access.host, access.port)}
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Terminal className="size-3.5 shrink-0" aria-hidden />
              <span>{t('websites.creds.sshLine')}</span>
              <CopyValue value={sshCommand(access.username, access.host, access.port)} />
            </div>
          </div>
        </section>
      )}
      {database && (
        <section>
          <h4 className="text-sm font-semibold text-text">{t('websites.creds.database')}</h4>
          <KeyValue
            items={[
              { label: t('websites.db.name'), value: <CopyValue value={database.database.name} /> },
              {
                label: t('websites.db.user'),
                value: <CopyValue value={database.database.userName ?? database.database.name} />,
              },
              { label: t('websites.creds.password'), value: <SecretValue value={database.password} /> },
              { label: t('websites.access.host'), value: <CopyValue value={database.database.host} /> },
              {
                label: t('websites.access.port'),
                value: <CopyValue value={String(database.database.port)} />,
              },
            ]}
          />
        </section>
      )}
      <Notice tone="warning">{t('websites.creds.onceText')}</Notice>
    </div>
  );
}

/** Footer of a credentials view: "saved" checkbox, then close. */
export function CredentialsFooter({
  saved,
  onSaved,
  onClose,
}: {
  saved: boolean;
  onSaved: (saved: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={saved}
          onChange={(e) => onSaved(e.target.checked)}
        />
        {t('websites.creds.saved')}
      </label>
      <Button variant="primary" disabled={!saved} onClick={onClose}>
        {t('common.close')}
      </Button>
    </>
  );
}

/**
 * Credentials in a dialog that only closes once the user ticked "saved" (outside clicks,
 * Escape and the X do nothing before). Closing drops them: the console keeps no copy.
 */
export function CredentialsDialog({
  shown,
  onClose,
  title,
}: {
  shown: ShownCredentials | null;
  onClose: () => void;
  title?: ReactNode;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const close = () => {
    setSaved(false);
    onClose();
  };
  return (
    <Dialog
      open={!!shown}
      onOpenChange={(o) => !o && saved && close()}
      title={title ?? t('websites.creds.title')}
      description={t('websites.creds.text')}
      size="lg"
      footer={<CredentialsFooter saved={saved} onSaved={setSaved} onClose={close} />}
    >
      {shown && <CredentialsPanel shown={shown} />}
    </Dialog>
  );
}

// --- Create ------------------------------------------------------------------------------

/** What the create form offers. Customers get the server's options, staff free fields. */
export interface WebsiteFormChoices {
  types: readonly CreatableWebsiteType[];
  phpVersions: string[];
  defaultPhpVersion: string | null;
  /** Fixed list (customers), or null: any template of the server, typed (staff). */
  templates: string[] | null;
  /** Suggestions for the typed template (staff). */
  templateSuggestions?: string[];
  nodejsVersions: string[];
  /** What the allowance still has room for; null when it does not apply (staff). */
  room: { sites: number; databases: number } | null;
}

/** Choices for a customer: server facts filtered by the instance config and the allowance. */
export const customerChoices = (
  options: WebsiteServerOptions,
  allowance: WebsiteAllowanceDto,
): WebsiteFormChoices => ({
  types: options.types,
  phpVersions: options.phpVersions,
  defaultPhpVersion: options.defaultPhpVersion,
  templates: options.templates.map((tpl) => tpl.name),
  nodejsVersions: options.nodejsVersions,
  room: allowanceRoom(allowance),
});

/** Form fields the API names in its errors. */
type FormField =
  'domain' | 'type' | 'template' | 'phpVersion' | 'nodejsVersion' | 'siteUser' | 'database' | 'password';

const FORM_FIELDS: readonly FormField[] = [
  'domain',
  'type',
  'template',
  'phpVersion',
  'nodejsVersion',
  'siteUser',
  'database',
  'password',
];

/** The form field an API error belongs to, or null for a general error. */
export function formFieldOf(err: unknown): FormField | null {
  const field = errorField(err);
  return FORM_FIELDS.find((f) => f === field) ?? null;
}

const DB_ISSUE_KEY = {
  siteUser: 'websites.db.needsSiteUser',
  empty: 'websites.db.suffixEmpty',
  suffix: 'websites.db.suffixInvalid',
  length: 'websites.db.nameTooLong',
} as const satisfies Record<DatabaseNameIssue, string>;

const defaultTemplate = (choices: WebsiteFormChoices) =>
  choices.templates === null
    ? 'Generic'
    : (choices.templates.find((name) => name === 'Generic') ?? choices.templates[0] ?? '');

/**
 * State of the create form. Site user, database switch and suffix follow the domain and the
 * template until the user changes them.
 */
export function useWebsiteForm(choices: WebsiteFormChoices) {
  const { t } = useI18n();
  const [domain, setDomain] = useState('');
  const [typeChoice, setType] = useState<CreatableWebsiteType>(choices.types[0] ?? 'php');
  const [templateChoice, setTemplate] = useState(() => defaultTemplate(choices));
  const [phpChoice, setPhpVersion] = useState(choices.defaultPhpVersion ?? choices.phpVersions[0] ?? '');
  const [nodejsChoice, setNodejsVersion] = useState('');
  const [siteUserOverride, setSiteUser] = useState<string | null>(null);
  const [databaseOverride, setDatabase] = useState<boolean | null>(null);
  const [suffixOverride, setSuffix] = useState<string | null>(null);
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');

  // Staff can switch the instance: a choice the new one does not offer falls back to its default.
  const type = choices.types.includes(typeChoice) ? typeChoice : (choices.types[0] ?? 'php');
  const template =
    choices.templates === null || choices.templates.includes(templateChoice)
      ? templateChoice
      : defaultTemplate(choices);
  const phpVersion =
    choices.phpVersions.length === 0 || choices.phpVersions.includes(phpChoice)
      ? phpChoice
      : (choices.defaultPhpVersion ?? choices.phpVersions[0] ?? '');
  const nodejsVersion = choices.nodejsVersions.includes(nodejsChoice)
    ? nodejsChoice
    : choices.nodejsVersions.includes('22')
      ? '22'
      : (choices.nodejsVersions[0] ?? '');
  const ascii = websiteDomainAscii(domain);
  const siteUser = siteUserOverride ?? (ascii ? suggestSiteUser(ascii) : '');
  const effectiveTemplate = type === 'php' ? template.trim() : null;
  const databaseRoom = choices.room === null || choices.room.databases > 0;
  const database = databaseRoom && (databaseOverride ?? templateWantsDatabase(effectiveTemplate));
  const suffix = suffixOverride ?? defaultDatabaseSuffix(effectiveTemplate);
  const preview = databaseNamePreview(siteUser, suffix);

  const errors: Partial<Record<FormField, string>> = {};
  if (domain.trim() && !ascii) errors.domain = t('websites.create.domainInvalid');
  if (siteUser && !SITE_USER_PATTERN.test(siteUser)) errors.siteUser = t('websites.create.siteUserInvalid');
  else if (siteUser && isReservedSiteUser(siteUser)) errors.siteUser = t('websites.create.siteUserReserved');
  if (type === 'php' && choices.templates === null && !WEBSITE_TEMPLATE_PATTERN.test(template.trim())) {
    errors.template = t('websites.create.templateInvalid');
  }
  if (type === 'php' && phpVersion && !PHP_VERSION_PATTERN.test(phpVersion)) {
    errors.phpVersion = t('websites.create.phpInvalid');
  }
  if (database && preview.issue && preview.issue !== 'siteUser')
    errors.database = t(DB_ISSUE_KEY[preview.issue]);

  const complete =
    !!ascii &&
    !!siteUser &&
    choices.types.includes(type) &&
    (type !== 'php' || !!template.trim()) &&
    (type !== 'nodejs' || !!nodejsVersion) &&
    (!database || !!preview.name) &&
    passwordReady(passwordMode, password) &&
    (choices.room === null || choices.room.sites > 0);

  const request: WebsiteCreateRequest | null =
    complete && Object.keys(errors).length === 0 && ascii
      ? {
          domain: ascii,
          type,
          ...(type === 'php' ? { template: template.trim(), ...(phpVersion ? { phpVersion } : {}) } : {}),
          ...(type === 'nodejs' ? { nodejsVersion } : {}),
          siteUser,
          ...(passwordMode === 'choose' ? { password } : {}),
          database: database ? { suffix } : null,
        }
      : null;

  return {
    values: { domain, ascii, type, template, phpVersion, nodejsVersion, siteUser, database, suffix, preview },
    set: {
      domain: setDomain,
      type: setType,
      template: setTemplate,
      phpVersion: setPhpVersion,
      nodejsVersion: setNodejsVersion,
      siteUser: (value: string) => setSiteUser(value.trim().toLowerCase()),
      database: (value: boolean) => setDatabase(value),
      suffix: (value: string) => setSuffix(value.trim().toLowerCase()),
    },
    password: { mode: passwordMode, setMode: setPasswordMode, value: password, setValue: setPassword },
    databaseRoom,
    errors,
    request,
  };
}

export type WebsiteForm = ReturnType<typeof useWebsiteForm>;

/** Radio cards for the site type, only the allowed ones. */
function TypeChoice({
  value,
  onChange,
  types,
  disabled,
}: {
  value: CreatableWebsiteType;
  onChange: (type: CreatableWebsiteType) => void;
  types: readonly CreatableWebsiteType[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-[13px] font-medium text-text">{t('websites.create.type')}</legend>
      <div className={cn('grid gap-2', types.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {types.map((type) => (
          <label
            key={type}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
              value === type
                ? 'border-brand-blue bg-primary-soft text-primary-text'
                : 'border-border-strong text-text hover:bg-surface-3',
            )}
          >
            <input
              type="radio"
              name={`${id}-type`}
              className="mt-1 size-4 accent-[var(--primary)]"
              checked={value === type}
              onChange={() => onChange(type)}
            />
            <span className="min-w-0">
              <span className="block font-medium">{t(`websites.create.type.${type}`)}</span>
              <span className={cn('mt-0.5 block text-xs', value === type ? 'opacity-90' : 'text-muted')}>
                {t(`websites.create.type.${type}Text`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The fields of the create form (domain, type, application, site user, database, password). */
export function WebsiteFormFields({
  form,
  choices,
  serverError,
  disabled,
}: {
  form: WebsiteForm;
  choices: WebsiteFormChoices;
  /** The last error of the API: shown under its field, or above the form. */
  serverError: unknown;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const toError = useWebsiteError();
  const { values: v, set, errors } = form;
  const serverField = serverError ? formFieldOf(serverError) : null;
  const fieldError = (field: FormField) =>
    errors[field] ?? (serverField === field ? toError(serverError) : undefined);
  const wordpress = v.type === 'php' && templateWantsDatabase(v.template);

  return (
    <div className="space-y-5">
      <Field
        label={t('websites.create.domain')}
        htmlFor={`${id}-domain`}
        error={fieldError('domain')}
        hint={
          v.ascii && v.ascii !== v.domain.trim().toLowerCase()
            ? t('websites.create.domainAscii', { ascii: v.ascii })
            : t('websites.create.domainHint')
        }
      >
        <Input
          id={`${id}-domain`}
          value={v.domain}
          onChange={(e) => set.domain(e.target.value)}
          placeholder="shop.beispiel.ch"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={disabled}
        />
      </Field>

      {choices.types.length > 1 ? (
        <TypeChoice value={v.type} onChange={set.type} types={choices.types} disabled={disabled} />
      ) : (
        <p className="text-sm text-muted">
          {t('websites.create.onlyType', { type: t(`websites.create.type.${v.type}`) })}
        </p>
      )}
      {serverField === 'type' && <p className="-mt-3 text-xs text-danger">{toError(serverError)}</p>}

      {v.type === 'php' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('websites.create.application')}
            htmlFor={`${id}-template`}
            error={fieldError('template')}
            hint={wordpress ? t('websites.create.wordpressHint') : t('websites.create.applicationHint')}
          >
            {choices.templates === null ? (
              <>
                <Input
                  id={`${id}-template`}
                  value={v.template}
                  onChange={(e) => set.template(e.target.value)}
                  list={`${id}-templates`}
                  maxLength={41}
                  disabled={disabled}
                />
                <datalist id={`${id}-templates`}>
                  {(choices.templateSuggestions ?? []).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            ) : (
              <Select
                id={`${id}-template`}
                value={v.template}
                onChange={(e) => set.template(e.target.value)}
                disabled={disabled}
              >
                {choices.templates.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('websites.create.phpVersion')}
            htmlFor={`${id}-php`}
            error={fieldError('phpVersion')}
            hint={choices.templates === null ? t('websites.create.phpStaffHint') : undefined}
          >
            <Select
              id={`${id}-php`}
              value={v.phpVersion}
              onChange={(e) => set.phpVersion(e.target.value)}
              disabled={disabled}
            >
              {choices.phpVersions.map((version) => (
                <option key={version} value={version}>
                  PHP {version}
                  {version === choices.defaultPhpVersion ? ` (${t('websites.create.recommended')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {v.type === 'nodejs' && (
        <Field
          label={t('websites.create.nodejsVersion')}
          htmlFor={`${id}-node`}
          error={fieldError('nodejsVersion')}
          hint={t('websites.create.nodejsHint')}
        >
          <Select
            id={`${id}-node`}
            value={v.nodejsVersion}
            onChange={(e) => set.nodejsVersion(e.target.value)}
            disabled={disabled}
          >
            {choices.nodejsVersions.map((version) => (
              <option key={version} value={version}>
                Node.js {version}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label={t('websites.create.siteUser')}
        htmlFor={`${id}-user`}
        error={fieldError('siteUser')}
        hint={t('websites.create.siteUserHint')}
      >
        <Input
          id={`${id}-user`}
          value={v.siteUser}
          onChange={(e) => set.siteUser(e.target.value)}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          disabled={disabled}
        />
      </Field>

      <div className="space-y-3 rounded-lg border border-border px-3 py-3">
        <label
          className={cn(
            'flex items-start gap-3 text-sm',
            form.databaseRoom ? 'cursor-pointer' : 'cursor-not-allowed text-muted',
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--primary)]"
            checked={v.database}
            disabled={disabled || !form.databaseRoom}
            onChange={(e) => set.database(e.target.checked)}
          />
          <span>
            <span className="block font-medium text-text">{t('websites.create.database')}</span>
            <span className="block text-xs text-muted">
              {form.databaseRoom ? t('websites.create.databaseHint') : t('websites.create.databaseNoRoom')}
            </span>
          </span>
        </label>
        {v.database && (
          <Field
            label={t('websites.db.suffix')}
            htmlFor={`${id}-suffix`}
            error={fieldError('database')}
            hint={
              v.preview.name ? (
                <>
                  {t('websites.db.preview')} <Mono className="text-text">{v.preview.name}</Mono>
                </>
              ) : (
                t('websites.db.suffixHint')
              )
            }
          >
            <DatabaseSuffixInput
              id={`${id}-suffix`}
              prefix={v.preview.prefix}
              value={v.suffix}
              onChange={set.suffix}
              disabled={disabled}
            />
          </Field>
        )}
      </div>

      <WebsitePasswordChoice
        mode={form.password.mode}
        onMode={form.password.setMode}
        password={form.password.value}
        onPassword={form.password.setValue}
        label={t('websites.create.password')}
      />
      {serverField === 'password' && <p className="-mt-3 text-xs text-danger">{toError(serverError)}</p>}
    </div>
  );
}

/** "shop_mueller_" fixed, the suffix typed after it. */
function DatabaseSuffixInput({
  id,
  prefix,
  value,
  onChange,
  disabled,
}: {
  id: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-9 w-full items-center overflow-hidden rounded-lg border border-border-strong bg-surface focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
      <span className="flex h-full items-center border-r border-border bg-surface-2 px-2.5 font-mono text-[12.5px] text-muted">
        {prefix}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={15}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-text outline-none disabled:opacity-60"
      />
    </div>
  );
}

/** The error of a create or change that has no field: in the dialog, with the "may exist" case. */
export function DialogError({ error, unknownHint }: { error: unknown; unknownHint?: string }) {
  const { t } = useI18n();
  const toError = useWebsiteError();
  if (!error) return null;
  if (outcomeUnknown(error)) {
    return (
      <Notice tone="warning" title={t('websites.errors.unknownOutcome')}>
        <span className="block break-words">{toError(error)}</span>
        {unknownHint && <span className="mt-1 block">{unknownHint}</span>}
      </Notice>
    );
  }
  return (
    <Notice tone="danger">
      <span className="block break-words">{toError(error)}</span>
    </Notice>
  );
}

/**
 * The error of the last submit, as long as the form still holds what was sent: an edit hides
 * it. An unknown outcome stays, the server may have done it and sending again would not help.
 */
export function useSubmitError(error: unknown) {
  const [sent, setSent] = useState<string | null>(null);
  return {
    sent: (value: unknown) => setSent(JSON.stringify(value)),
    errorFor: (value: unknown) =>
      error && (outcomeUnknown(error) || JSON.stringify(value) === sent) ? error : null,
  };
}

/** "After creating: 4 of 5 websites, 5 of 10 databases". */
function AllowanceAfter({ allowance, database }: { allowance: WebsiteAllowanceDto; database: boolean }) {
  const { t, locale } = useI18n();
  const n = (value: number) => formatNumber(value, locale);
  return (
    <p className="text-xs text-muted">
      {t('websites.create.after', {
        sites: n(allowance.sites + 1),
        maxSites: n(allowance.maxSites),
        databases: n(allowance.databases + (database ? 1 : 0)),
        maxDatabases: n(allowance.maxDatabases),
      })}
    </p>
  );
}

/** Text while the server works: creating takes up to a few minutes. */
export function CreatingNotice() {
  const { t } = useI18n();
  return (
    <Notice tone="info" icon={<RefreshCw className="size-4 animate-spin" />}>
      {t('websites.create.pending')}
    </Notice>
  );
}

/** A customer creates a website on the instance of its allowance. */
export function CreateWebsiteDialog({
  orgId,
  allowance,
  options,
  onClose,
}: {
  orgId: string;
  allowance: WebsiteAllowanceDto;
  options: WebsiteServerOptions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [choices] = useState(() => customerChoices(options, allowance));
  const form = useWebsiteForm(choices);
  const [shown, setShown] = useState<ShownCredentials | null>(null);
  const [saved, setSaved] = useState(false);
  const create = useCreateWebsite(orgId, {
    success: (r) => t('websites.create.done', { domain: r.website.name }),
    onSuccess: (r) => setShown(shownFromCreated(r)),
    error: false,
  });
  const submitted = useSubmitError(create.error);
  const serverError = submitted.errorFor(form.request);
  const generalError = serverError && !formFieldOf(serverError) ? serverError : null;

  if (shown) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && saved && onClose()}
        title={t('websites.creds.title')}
        description={t('websites.creds.text')}
        size="lg"
        footer={<CredentialsFooter saved={saved} onSaved={setSaved} onClose={onClose} />}
      >
        <CredentialsPanel shown={shown} />
      </Dialog>
    );
  }

  const submit = () => {
    if (!form.request || create.isPending || outcomeUnknown(create.error)) return;
    submitted.sent(form.request);
    create.mutate(form.request);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title={t('websites.create.title')}
      description={t('websites.create.text')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!form.request || outcomeUnknown(create.error)}
            loading={create.isPending}
            onClick={submit}
          >
            {t('websites.create.submit')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <WebsiteFormFields
          form={form}
          choices={choices}
          serverError={serverError}
          disabled={create.isPending}
        />
        <AllowanceAfter allowance={allowance} database={form.values.database} />
        {create.isPending ? (
          <CreatingNotice />
        ) : (
          <DialogError error={generalError} unknownHint={t('websites.create.unknownHint')} />
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// --- Passwords ---------------------------------------------------------------------------

/** Confirm step of a new password: own or generated, with what happens to the old one. */
function NewPasswordForm({
  title,
  description,
  children,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  pending: boolean;
  error: unknown;
  onSubmit: (password: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const ready = passwordReady(mode, password);
  const submit = () => ready && !pending && onSubmit(mode === 'choose' ? password : null);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!ready} loading={pending} onClick={submit}>
            {t('websites.password.submit')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {children}
        <WebsitePasswordChoice mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        <DialogError error={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** New password of the site user (SFTP/SSH). Running processes and sessions keep running. */
export function SitePasswordDialog({
  website,
  onClose,
}: {
  website: WebspaceDetailDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState<ShownCredentials | null>(null);
  const reset = useResetWebsitePassword(website.id, {
    success: t('websites.access.passwordDone'),
    onSuccess: (access) => setShown({ access, database: null, warnings: [] }),
    error: false,
  });
  if (shown) {
    return <CredentialsDialog shown={shown} onClose={onClose} title={t('websites.creds.newPassword')} />;
  }
  return (
    <NewPasswordForm
      title={t('websites.access.passwordTitle', { user: website.site?.siteUser ?? website.name })}
      description={t('websites.access.passwordText')}
      pending={reset.isPending}
      error={reset.error}
      onSubmit={(password) => reset.mutate(password ? { password } : {})}
      onClose={onClose}
    />
  );
}

/** New password of a database user. */
export function DatabasePasswordDialog({
  website,
  database,
  onClose,
}: {
  website: WebspaceDetailDto;
  database: WebsiteDatabaseDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState<ShownCredentials | null>(null);
  const reset = useResetWebsiteDatabasePassword(website.id, database.id, {
    success: t('websites.db.passwordDone', { name: database.name }),
    onSuccess: (secret) => setShown({ access: null, database: secret, warnings: [] }),
    error: false,
  });
  if (shown) {
    return <CredentialsDialog shown={shown} onClose={onClose} title={t('websites.creds.newPassword')} />;
  }
  return (
    <NewPasswordForm
      title={t('websites.db.passwordTitle', { name: database.name })}
      description={t('websites.db.passwordText')}
      pending={reset.isPending}
      error={reset.error}
      onSubmit={(password) => reset.mutate(password ? { password } : {})}
      onClose={onClose}
    />
  );
}

// --- Databases ---------------------------------------------------------------------------

/** A database with its user ("<prefix>_<suffix>"), password shown once. */
export function CreateDatabaseDialog({
  website,
  onClose,
}: {
  website: WebspaceDetailDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const toError = useWebsiteError();
  const siteUser = website.site?.siteUser ?? '';
  const [suffix, setSuffix] = useState(() =>
    website.databases.length === 0 ? defaultDatabaseSuffix(website.site?.application) : '',
  );
  const [mode, setMode] = useState<PasswordMode>('generate');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState<ShownCredentials | null>(null);
  const create = useCreateWebsiteDatabase(website.id, {
    success: (r) => t('websites.db.created', { name: r.database.name }),
    onSuccess: (secret) => setShown({ access: null, database: secret, warnings: [] }),
    error: false,
  });
  const preview = databaseNamePreview(siteUser, suffix);
  const taken = !!preview.name && website.databases.some((d) => d.name === preview.name);
  const localError =
    preview.issue && preview.issue !== 'empty'
      ? t(DB_ISSUE_KEY[preview.issue])
      : taken
        ? t('websites.db.taken')
        : null;
  const serverField = create.error ? errorField(create.error) : null;
  const suffixServerError =
    create.error && (serverField === 'suffix' || serverField === 'database' || serverField === 'name')
      ? toError(create.error)
      : null;
  const ready = !!preview.name && !taken && passwordReady(mode, password);

  if (shown) {
    return <CredentialsDialog shown={shown} onClose={onClose} title={t('websites.db.createdTitle')} />;
  }
  const submit = () => {
    if (!ready || create.isPending || outcomeUnknown(create.error)) return;
    create.mutate({ suffix, ...(mode === 'choose' ? { password } : {}) });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title={t('websites.db.createTitle')}
      description={t('websites.db.createText')}
      footer={
        <>
          <Button variant="ghost" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ready || outcomeUnknown(create.error)}
            loading={create.isPending}
            onClick={submit}
          >
            {t('websites.db.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('websites.db.suffix')}
          htmlFor={`${id}-suffix`}
          error={localError ?? suffixServerError}
          hint={
            preview.name ? (
              <>
                {t('websites.db.preview')} <Mono className="text-text">{preview.name}</Mono>
              </>
            ) : (
              t('websites.db.suffixHint')
            )
          }
        >
          <DatabaseSuffixInput
            id={`${id}-suffix`}
            prefix={preview.prefix}
            value={suffix}
            onChange={(value) => setSuffix(value.trim().toLowerCase())}
            disabled={create.isPending}
          />
        </Field>
        <p className="text-xs text-muted">{t('websites.db.userHint')}</p>
        <WebsitePasswordChoice mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        <DialogError
          error={suffixServerError ? null : create.error}
          unknownHint={t('websites.db.unknownHint')}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Deletes a database and its user after typing its name. */
export function DeleteDatabaseDialog({
  website,
  database,
  onClose,
}: {
  website: WebspaceDetailDto;
  database: WebsiteDatabaseDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteWebsiteDatabase(website.id, {
    success: t('websites.db.deleted', { name: database.name }),
    onSuccess: onClose,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !remove.isPending && onClose()}
      title={t('websites.db.deleteTitle', { name: database.name })}
      description={t('websites.db.deleteText')}
      confirmLabel={t('websites.db.delete')}
      confirmText={database.name}
      loading={remove.isPending}
      onConfirm={() => remove.mutate(database)}
    />
  );
}

// --- Certificate -------------------------------------------------------------------------

/**
 * Let's Encrypt for the domain and its www counterpart. The DNS check runs first: with both
 * names on the server the certificate is issued, otherwise the dialog explains what to fix
 * and offers to try anyway (behind a CDN the check cannot see the server).
 */
export function CertificateDialog({ website, onClose }: { website: WebspaceDetailDto; onClose: () => void }) {
  const { t } = useI18n();
  const toError = useWebsiteError();
  const dns = useWebsiteDnsCheck(website.id, true);
  const issue = useIssueCertificate(website.id, {
    success: t('websites.ssl.issued', { domain: website.name }),
    onSuccess: onClose,
    error: false,
  });
  const check = dns.data;
  const blocker = check ? dnsBlocker(check) : null;
  const foreign = check ? foreignDnsAnswers(check) : [];
  const busy = issue.isPending;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('websites.ssl.dialogTitle', { domain: website.name })}
      description={t('websites.ssl.dialogText')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {check?.ready ? (
            <Button
              variant="primary"
              icon={<ShieldCheck className="size-4" />}
              loading={busy}
              onClick={() => issue.mutate({ force: false })}
            >
              {t('websites.ssl.issue')}
            </Button>
          ) : (
            <Button
              variant="outline"
              loading={busy}
              disabled={dns.isPending}
              onClick={() => issue.mutate({ force: true })}
            >
              {t('websites.ssl.force')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {dns.isPending ? (
          <LoadingBlock rows={2} />
        ) : dns.isError ? (
          <Notice tone="warning" title={t('websites.dns.checkFailed')}>
            <span className="block break-words">{toError(dns.error)}</span>
          </Notice>
        ) : check ? (
          <>
            <div className="overflow-hidden rounded-lg border border-border">
              <DnsCheckTable check={check} />
            </div>
            {check.ready ? (
              <Notice tone="success">{t('websites.ssl.ready')}</Notice>
            ) : (
              <Notice tone="warning" title={t('websites.ssl.notReady')}>
                {t(`websites.dns.blocker.${blocker ?? 'missing'}`)}
                {foreign.length > 0 && (
                  <span className="mt-1 block">{t('websites.dns.foreign', { ips: foreign.join(', ') })}</span>
                )}
              </Notice>
            )}
            {!check.ready && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-text">{t('websites.dns.needed')}</p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <ExpectedDnsTable check={check} onlyMissing />
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="size-3.5" />}
                loading={dns.isFetching}
                disabled={busy}
                onClick={() => void dns.refetch()}
              >
                {t('websites.dns.recheck')}
              </Button>
            </div>
          </>
        ) : null}
        <p className="text-xs text-muted">{t('websites.ssl.renewal')}</p>
        {busy ? (
          <Notice tone="info" icon={<RefreshCw className="size-4 animate-spin" />}>
            {t('websites.ssl.pending')}
          </Notice>
        ) : (
          <DialogError error={issue.error} />
        )}
      </div>
    </Dialog>
  );
}

// --- Delete and forget -------------------------------------------------------------------

/** Deletes the website after typing its domain, listing everything that is lost. */
export function DeleteWebsiteDialog({
  website,
  onClose,
  onDeleted,
}: {
  website: WebspaceDetailDto;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [typed, setTyped] = useState('');
  const remove = useDeleteWebsite(website.id, website.org?.id ?? null, {
    success: t('websites.delete.done', { domain: website.name }),
    onSuccess: (result) => {
      onDeleted();
      // Leftovers the server cleaned up or could not: worth knowing, not an error.
      if (result.warnings.length > 0) {
        toast.warning(t('websites.delete.warnings'), { description: result.warnings.join(' ') });
      }
    },
    error: false,
  });
  const confirm = deleteConfirmValue(typed, website.name);
  const home = website.site?.homeDirectory ?? (website.site ? `/home/${website.site.siteUser}` : null);
  const lost = [
    home ? t('websites.delete.lostFiles', { home }) : t('websites.delete.lostFilesPlain'),
    website.databases.length > 0
      ? t('websites.delete.lostDatabases', { names: website.databases.map((d) => d.name).join(', ') })
      : t('websites.delete.lostNoDatabases'),
    t('websites.delete.lostBackups'),
    t('websites.delete.lostCron'),
    website.site ? t('websites.delete.lostUser', { user: website.site.siteUser }) : null,
  ].filter((x): x is string => !!x);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !remove.isPending && onClose()}
      title={t('websites.delete.title', { domain: website.name })}
      description={t('websites.delete.text')}
      footer={
        <>
          <Button variant="ghost" disabled={remove.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!confirm}
            loading={remove.isPending}
            onClick={() => confirm && remove.mutate({ confirm })}
          >
            {t('websites.delete.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-text">
          {lost.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Field label={t('websites.delete.confirm')} htmlFor={`${id}-confirm`} hint={website.name}>
          <Input
            id={`${id}-confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={remove.isPending}
          />
        </Field>
        {remove.isPending ? (
          <Notice tone="info" icon={<RefreshCw className="size-4 animate-spin" />}>
            {t('websites.delete.pending')}
          </Notice>
        ) : (
          <DialogError error={remove.error} />
        )}
      </div>
    </Dialog>
  );
}

/** Drops an unassigned or missing website from the console; the site stays on the server. */
export function ForgetWebsiteDialog({
  website,
  onClose,
  onDone,
}: {
  website: WebspaceDto;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const forget = useForgetWebsite({
    success: t('websites.admin.forgotten', { domain: website.name }),
    onSuccess: () => {
      onClose();
      onDone?.();
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !forget.isPending && onClose()}
      title={t('websites.admin.forgetTitle', { domain: website.name })}
      description={t('websites.admin.forgetText', { instance: website.provider.name })}
      confirmLabel={t('websites.admin.forget')}
      loading={forget.isPending}
      onConfirm={() => forget.mutate(website)}
    >
      <p className="text-sm text-muted">{t('websites.admin.forgetAdopt')}</p>
      <CopyValue value={`sudo weblion-clp adopt ${asciiDomain(website.name)}`} />
    </ConfirmDialog>
  );
}
