import { domainToUnicode } from 'node:url';
import {
  MAIL_DKIM_KEY_SIZES,
  isMailLocalPart,
  mailClientSettings,
  mailLimitsIssue,
  type Capability,
  type MailAliasDto,
  type MailAliasSpecial,
  type MailClientSettings,
  type MailPasswordPolicy,
  type MailboxDto,
  type MailboxState,
  type PowerAction,
} from '@weblion/shared';
import { AppError, ProviderError, badRequest, conflict } from '../../lib/errors';
import { isRecord, str } from '../http';
import type {
  DkimKey,
  InfraOverview,
  MailAliasInput,
  MailAliasPatch,
  MailDomainInput,
  MailDomainLimitsInput,
  MailDomainPatch,
  MailboxInput,
  MailboxPatch,
  MailcowConfig,
  ProviderAdapter,
  RawResponse,
  RemoteMailDomain,
  RemoteServer,
  ServerRef,
} from '../types';
import { MailcowClient, PROVIDER, SOGO_RESTART_TIMEOUT_MS, type MailcowClientOptions } from './client';
import {
  asList,
  assertAddress,
  assertAliasId,
  assertDomain,
  assertLimits,
  assertMib,
  assertTargets,
  bytesFromMib,
  isEmptyObject,
  mibFromBytes,
  parseAlias,
  parseDkim,
  parseDomain,
  parseMailbox,
  parsePasswordPolicy,
  parseVmail,
  parseWriteResult,
  redactMailcow,
  secretValues,
} from './parse';

const DOMAIN_TTL_MS = 15_000;
const LIST_TTL_MS = 10_000;
const DKIM_TTL_MS = 300_000;
const STATIC_TTL_MS = 600_000;

/** Local parts that are safe as a path segment; others are looked up in the domain's list. */
const PATH_LOCAL_PART = /^[a-z0-9._-]+$/;
const DKIM_SELECTOR = /^[a-z0-9][a-z0-9._-]{0,62}$/;
/** Mailcow keeps mailbox names up to 255 characters and strips "<" and ">". */
const MAX_NAME_LENGTH = 255;

const STATE_VALUES: Record<MailboxState, string> = { active: '1', login_disabled: '2', inactive: '0' };
/** The edit/alias flag that keeps a special target (null@localhost and the like). */
const SPECIAL_FLAGS: Record<MailAliasSpecial, string> = {
  discard: 'goto_null',
  spam: 'goto_spam',
  ham: 'goto_ham',
};

/**
 * Reads of the last seconds, keyed "<kind>:<ascii domain>" (or "policy", "version"). Mailcow
 * computes every list item with several queries, so pages that read a domain, its mailboxes and
 * aliases right after each other ask once. Failed loads are not kept; every write forgets the
 * keys of its domain.
 */
class ReadCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < ttlMs) return (hit.value as Promise<T>).then((v) => structuredClone(v));
    if (this.entries.size >= 500) this.prune(now);
    const value = load();
    const entry = { at: now, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    // Callers get copies, so nobody changes what the next caller reads.
    return value.then((v) => structuredClone(v));
  }

  /** Forgets one key, so the next read asks Mailcow. */
  delete(key: string) {
    this.entries.delete(key);
  }

  /** Forgets everything read for one domain (keys end with ":<domain>"). */
  forget(domain: string) {
    for (const key of this.entries.keys()) if (key.endsWith(`:${domain}`)) this.entries.delete(key);
  }

  /** Forgets one kind for every domain, e.g. "aliases" after a mailbox left aliases of other domains. */
  forgetKind(kind: string) {
    for (const key of this.entries.keys()) if (key.startsWith(`${kind}:`)) this.entries.delete(key);
  }

  /** Drops what no TTL would serve anymore (the longest is STATIC_TTL_MS). */
  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= STATIC_TTL_MS) this.entries.delete(key);
    }
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.upstreamStatus === 404;
}

/** "anna@kunde.ch" split, lower-cased, with an ASCII domain. Mailboxes have no catch-all form. */
function splitMailbox(address: string): { localPart: string; domain: string; address: string } {
  const value = typeof address === 'string' ? address.trim().toLowerCase() : '';
  const at = value.lastIndexOf('@');
  const localPart = at > 0 ? value.slice(0, at) : '';
  if (!localPart || localPart.length > 64 || /[\s,;"<>\\/]/.test(localPart)) {
    throw badRequest(`Invalid mailbox address "${value.slice(0, 80)}"`);
  }
  const domain = assertDomain(value.slice(at + 1));
  return { localPart, domain, address: `${localPart}@${domain}` };
}

/** Domain part of an alias address ("team@kunde.ch" or "@kunde.ch"). */
function aliasDomainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

function assertMailboxName(name: string): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) {
    throw badRequest('The name of a mailbox cannot be removed at Mailcow, only replaced');
  }
  if (value.length > MAX_NAME_LENGTH || /[<>]/.test(value)) {
    throw badRequest(`The name may have at most ${MAX_NAME_LENGTH} characters, without < and >`);
  }
  return value;
}

function assertDkimOptions(options: { selector: string; keySize: number }): void {
  if (typeof options.selector !== 'string' || !DKIM_SELECTOR.test(options.selector)) {
    throw badRequest('Invalid DKIM selector: a-z, 0-9, ".", "_" and "-", starting with a letter or digit');
  }
  if (!(MAIL_DKIM_KEY_SIZES as readonly number[]).includes(options.keySize)) {
    throw badRequest(`The DKIM key size must be one of ${MAIL_DKIM_KEY_SIZES.join(', ')} bits`);
  }
}

function limitsInMib(domain: RemoteMailDomain): MailDomainLimitsInput {
  const limits = domain.info.limits;
  return {
    maxMailboxes: limits.maxMailboxes,
    maxAliases: limits.maxAliases,
    quotaMb: mibFromBytes(limits.quotaBytes),
    defaultMailboxQuotaMb: mibFromBytes(limits.defaultMailboxQuotaBytes),
    maxMailboxQuotaMb: mibFromBytes(limits.maxMailboxQuotaBytes),
    rateLimit: limits.rateLimit,
  };
}

/** Mailcow takes numbers and booleans as strings ("1"/"0"), like its OpenAPI examples. */
const flag = (value: boolean) => (value ? '1' : '0');

/**
 * Mailcow (e-mail): mail domains, mailboxes, aliases and DKIM keys of one mailcow-dockerized
 * instance, managed with a read-write API key. No servers. Domains are addressed by their
 * ASCII name, mailboxes by address, aliases by Mailcow's numeric id. Sizes are sent in MiB and
 * read in bytes.
 */
export class MailcowAdapter implements ProviderAdapter {
  readonly type = 'mailcow' as const;
  private readonly client: MailcowClient;
  private readonly mailHost: string;
  private readonly reads = new ReadCache();

  constructor(config: MailcowConfig, options: MailcowClientOptions = {}) {
    this.client = new MailcowClient(config, options);
    this.mailHost = config.mailHost?.trim().toLowerCase() || hostOf(this.client.baseUrl);
  }

  capabilities(): Capability[] {
    return [];
  }

  powerActions(): PowerAction[] {
    return [];
  }

  async listServers(): Promise<RemoteServer[]> {
    return [];
  }

  async getServer(ref: ServerRef): Promise<RemoteServer> {
    throw new ProviderError(PROVIDER, `Mailcow has no servers (${ref.externalId})`, 404);
  }

  /**
   * Reachable, key accepted, and the key may write. The write probe changes nothing: a rate
   * limit edit without items loops over no domain and touches neither Redis nor SOGo (a domain
   * edit would rebuild SOGo's view even without items). A read-only key gets 403 before that.
   */
  async testConnection(): Promise<Record<string, unknown>> {
    const [version, domains] = await Promise.all([this.readVersion(), this.listMailDomains()]);
    try {
      await this.client.write(
        '/api/v1/edit/rl-domain',
        { items: [], attr: { rl_value: '0', rl_frame: 'h' } },
        { action: 'check write access' },
      );
    } catch (err) {
      if (err instanceof ProviderError && err.upstreamStatus === 403) {
        throw new ProviderError(
          PROVIDER,
          'the API key is read-only; the console needs the read-write key',
          403,
        );
      }
      throw err;
    }
    return { version, domains: domains.length, mailHost: this.mailHost, readWrite: true };
  }

  async overview(): Promise<InfraOverview> {
    const [version, domains, vmail] = await Promise.all([
      this.reads.get('version', STATIC_TTL_MS, () => this.readVersion()),
      this.listMailDomains(),
      // Disk usage is a nice to have: older versions or a missing df answer must not hide the rest.
      this.client
        .get('/api/v1/get/status/vmail', 'read storage usage')
        .then(parseVmail)
        .catch(() => null),
    ]);
    const facts = [
      { label: 'Version', value: version ?? '–' },
      { label: 'Mail domains', value: String(domains.length) },
      {
        label: 'Mailboxes',
        value: String(domains.reduce((sum, d) => sum + d.info.usage.mailboxes, 0)),
      },
    ];
    if (vmail && (vmail.used || vmail.total)) {
      const percent = vmail.percent ? ` (${vmail.percent})` : '';
      facts.push({ label: 'Storage', value: `${vmail.used ?? '–'} / ${vmail.total ?? '–'}${percent}` });
    }
    const settings = this.mailClientSettings();
    facts.push({ label: 'Mail server', value: settings.mailHost });
    facts.push({ label: 'Webmail', value: settings.webmailUrl });
    return { version, nodes: [], storages: [], facts };
  }

  private async readVersion(): Promise<string | null> {
    const body = await this.client.get('/api/v1/get/status/version', 'read the version');
    return isRecord(body) ? str(body.version) : null;
  }

  // ---------------------------------------------------------------------------
  // Mail domains

  /** Every domain of the instance, one request (the sync). Never cached. */
  async listMailDomains(): Promise<RemoteMailDomain[]> {
    const body = await this.client.get('/api/v1/get/domain/all', 'list mail domains');
    return asList(body)
      .map(parseDomain)
      .filter((d): d is RemoteMailDomain => d !== null)
      .sort((a, b) => a.externalId.localeCompare(b.externalId));
  }

  async getMailDomain(domain: string): Promise<RemoteMailDomain> {
    const name = assertDomain(domain);
    return this.reads.get(`domain:${name}`, DOMAIN_TTL_MS, async () => {
      const body = await this.client.get(`/api/v1/get/domain/${name}`, `read mail domain ${name}`);
      const parsed = parseDomain(body);
      if (!parsed || parsed.externalId !== name) {
        throw new ProviderError(PROVIDER, `mail domain ${name} not found`, 404);
      }
      return parsed;
    });
  }

  /** The domain as Mailcow has it now: writes decide on live values, not on the last 15 s. */
  private liveDomain(name: string): Promise<RemoteMailDomain> {
    this.reads.delete(`domain:${name}`);
    return this.getMailDomain(name);
  }

  /**
   * Creates the domain with every limit, relay flag and DKIM field, so Mailcow's editable
   * "Default" template never decides anything (a left out rate limit would come from there).
   * With restartSogo Mailcow restarts SOGo and waits for it. Once the domain exists, a failed
   * read-back does not fail the creation; the next sync corrects the values.
   */
  async createMailDomain(input: MailDomainInput): Promise<{ domain: RemoteMailDomain; warnings: string[] }> {
    const name = assertDomain(input.domain);
    assertLimits(input.limits);
    assertDkimOptions(input.dkim);
    const description = input.description?.trim() || name;
    const { limits } = input;

    try {
      await this.liveDomain(name);
      throw conflict(`The mail domain ${name} exists at Mailcow already`);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    let warnings: string[];
    try {
      ({ warnings } = await this.client.write(
        '/api/v1/add/domain',
        {
          domain: name,
          description,
          active: '1',
          mailboxes: String(limits.maxMailboxes),
          aliases: String(limits.maxAliases),
          quota: String(limits.quotaMb),
          defquota: String(limits.defaultMailboxQuotaMb),
          maxquota: String(limits.maxMailboxQuotaMb),
          backupmx: '0',
          relay_all_recipients: '0',
          relay_unknown_only: '0',
          // "0" sets no rate limit; left out, Mailcow would take the template's.
          rl_value: limits.rateLimit ? String(limits.rateLimit.value) : '0',
          rl_frame: limits.rateLimit?.frame ?? 'h',
          key_size: String(input.dkim.keySize),
          dkim_selector: input.dkim.selector,
          restart_sogo: flag(input.restartSogo),
        },
        {
          action: `create mail domain ${name}`,
          timeoutMs: input.restartSogo ? SOGO_RESTART_TIMEOUT_MS : undefined,
        },
      ));
    } finally {
      this.reads.forget(name);
    }

    try {
      return { domain: await this.getMailDomain(name), warnings };
    } catch {
      return {
        domain: {
          externalId: name,
          info: {
            name,
            displayName: domainToUnicode(name) || name,
            description,
            active: true,
            relay: false,
            limits: {
              maxMailboxes: limits.maxMailboxes,
              maxAliases: limits.maxAliases,
              quotaBytes: bytesFromMib(limits.quotaMb),
              defaultMailboxQuotaBytes: bytesFromMib(limits.defaultMailboxQuotaMb),
              maxMailboxQuotaBytes: bytesFromMib(limits.maxMailboxQuotaMb),
              rateLimit: limits.rateLimit,
            },
            usage: { mailboxes: 0, aliases: 0, allocatedBytes: 0, usedBytes: 0, messages: 0 },
            createdAt: new Date().toISOString(),
            modifiedAt: null,
          },
        },
        warnings,
      };
    }
  }

  /**
   * Sends only what changed to edit/domain (each mailbox() write makes Mailcow rebuild SOGo's
   * view), then the rate limit to edit/rl-domain (edit/domain ignores rl_value). Everything is
   * checked before the first request.
   */
  async updateMailDomain(domain: string, patch: MailDomainPatch): Promise<void> {
    const name = assertDomain(domain);
    const current = await this.liveDomain(name);
    const now = limitsInMib(current);
    const { active, ...limitPatch } = patch;
    assertLimits(limitPatch);
    const issue = mailLimitsIssue({
      quotaMb: patch.quotaMb ?? now.quotaMb,
      defaultMailboxQuotaMb: patch.defaultMailboxQuotaMb ?? now.defaultMailboxQuotaMb,
      maxMailboxQuotaMb: patch.maxMailboxQuotaMb ?? now.maxMailboxQuotaMb,
    });
    if (issue) throw badRequest(issue);

    const attr: Record<string, string> = {};
    if (patch.maxMailboxes !== undefined && patch.maxMailboxes !== now.maxMailboxes) {
      attr.mailboxes = String(patch.maxMailboxes);
    }
    if (patch.maxAliases !== undefined && patch.maxAliases !== now.maxAliases) {
      attr.aliases = String(patch.maxAliases);
    }
    if (patch.quotaMb !== undefined && patch.quotaMb !== now.quotaMb) attr.quota = String(patch.quotaMb);
    if (
      patch.defaultMailboxQuotaMb !== undefined &&
      patch.defaultMailboxQuotaMb !== now.defaultMailboxQuotaMb
    ) {
      attr.defquota = String(patch.defaultMailboxQuotaMb);
    }
    if (patch.maxMailboxQuotaMb !== undefined && patch.maxMailboxQuotaMb !== now.maxMailboxQuotaMb) {
      attr.maxquota = String(patch.maxMailboxQuotaMb);
    }
    if (active !== undefined && active !== current.info.active) attr.active = flag(active);

    let limitsSaved = false;
    try {
      if (Object.keys(attr).length > 0) {
        await this.client.write(
          '/api/v1/edit/domain',
          { items: [name], attr },
          { action: `change mail domain ${name}` },
        );
        limitsSaved = true;
      }
      if (patch.rateLimit !== undefined) {
        try {
          await this.client.write(
            '/api/v1/edit/rl-domain',
            {
              items: [name],
              // Removing still needs a valid frame: Mailcow checks it before the value.
              attr: {
                rl_value: patch.rateLimit ? String(patch.rateLimit.value) : '0',
                rl_frame: patch.rateLimit?.frame ?? 'h',
              },
            },
            { action: `change the rate limit of ${name}` },
          );
        } catch (err) {
          if (limitsSaved && err instanceof AppError) err.message += '. The other limits were saved';
          throw err;
        }
      }
    } finally {
      this.reads.forget(name);
    }
  }

  /**
   * Mailcow refuses to delete a domain while it has mailboxes, so that is checked first.
   * Aliases go with the domain, the mail to Mailcow's garbage folder. The DKIM key stays.
   */
  async deleteMailDomain(domain: string): Promise<{ warnings: string[] }> {
    const name = assertDomain(domain);
    const current = await this.liveDomain(name);
    const left = current.info.usage.mailboxes;
    if (left > 0) throw conflict(`Mailcow only deletes empty domains: ${left} mailboxes left`);
    try {
      const { warnings } = await this.client.write('/api/v1/delete/domain', [name], {
        action: `delete mail domain ${name}`,
      });
      return { warnings };
    } finally {
      this.reads.forget(name);
    }
  }

  // ---------------------------------------------------------------------------
  // Mailboxes

  async listMailboxes(domain: string): Promise<MailboxDto[]> {
    const name = assertDomain(domain);
    return this.reads.get(`mailboxes:${name}`, LIST_TTL_MS, async () => {
      const body = await this.client.get(`/api/v1/get/mailbox/all/${name}`, `list mailboxes of ${name}`);
      return asList(body)
        .map(parseMailbox)
        .filter((m): m is MailboxDto => m !== null && aliasDomainOf(m.address) === name)
        .sort((a, b) => a.address.localeCompare(b.address));
    });
  }

  /** Local parts that do not fit a path segment are looked up in the domain's list instead. */
  async getMailbox(address: string): Promise<MailboxDto> {
    const { localPart, domain, address: full } = splitMailbox(address);
    let mailbox: MailboxDto | undefined;
    if (PATH_LOCAL_PART.test(localPart)) {
      const body = await this.client.get(`/api/v1/get/mailbox/${full}`, `read mailbox ${full}`);
      mailbox = parseMailbox(body) ?? undefined;
    } else {
      mailbox = (await this.listMailboxes(domain)).find((m) => m.address === full);
    }
    if (!mailbox || mailbox.address !== full) {
      throw new ProviderError(PROVIDER, `mailbox ${full} not found`, 404);
    }
    return mailbox;
  }

  /** A mailbox with its raw record, uncached; looked up like getMailbox. */
  private async mailboxRecord(
    address: string,
  ): Promise<{ mailbox: MailboxDto; raw: Record<string, unknown> }> {
    const { localPart, domain, address: full } = splitMailbox(address);
    const records = PATH_LOCAL_PART.test(localPart)
      ? asList([await this.client.get(`/api/v1/get/mailbox/${full}`, `read mailbox ${full}`)])
      : asList(await this.client.get(`/api/v1/get/mailbox/all/${domain}`, `list mailboxes of ${domain}`));
    for (const raw of records) {
      const mailbox = parseMailbox(raw);
      if (mailbox?.address === full) return { mailbox, raw };
    }
    throw new ProviderError(PROVIDER, `mailbox ${full} not found`, 404);
  }

  /**
   * Creates a mailbox with the given password (Mailcow has no invitation). force_pw_update is
   * always "0": with 1 the mailbox could only log in to Mailcow's UI until the password is
   * changed, which breaks IMAP setups. Once created, a failed read-back does not fail it.
   */
  async createMailbox(input: MailboxInput): Promise<MailboxDto> {
    const domain = assertDomain(input.domain);
    const localPart = typeof input.localPart === 'string' ? input.localPart.trim().toLowerCase() : '';
    if (!isMailLocalPart(localPart)) {
      throw badRequest(
        `Invalid mailbox name "${localPart.slice(0, 80)}": a-z, 0-9, dot, dash and underscore, ` +
          'a letter or digit at both ends',
      );
    }
    const quotaMb = assertMib(input.quotaMb, 'The mailbox size');
    const name =
      typeof input.name === 'string' && input.name.trim() !== '' ? assertMailboxName(input.name) : '';
    const password = input.password;
    if (typeof password !== 'string' || password === '') throw badRequest('A password is required');
    const address = `${localPart}@${domain}`;

    try {
      await this.client.write(
        '/api/v1/add/mailbox',
        {
          local_part: localPart,
          domain,
          name,
          quota: String(quotaMb),
          password,
          password2: password,
          active: '1',
          force_pw_update: '0',
          authsource: 'mailcow',
        },
        { action: `create mailbox ${address}`, secrets: [password] },
      );
    } finally {
      this.reads.forget(domain);
    }

    try {
      return await this.getMailbox(address);
    } catch {
      return {
        address,
        localPart,
        name: name || null,
        state: 'active',
        quotaBytes: bytesFromMib(quotaMb),
        usedBytes: 0,
        messages: 0,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
        modifiedAt: null,
      };
    }
  }

  /** A missing mailbox would answer "access denied" at Mailcow, so it is read first (404). */
  async updateMailbox(address: string, patch: MailboxPatch): Promise<void> {
    const attr: Record<string, string> = {};
    // Mailcow keeps the old name for an empty one: refused instead of silently ignored.
    if (patch.name !== undefined) attr.name = assertMailboxName(patch.name);
    if (patch.quotaMb !== undefined) attr.quota = String(assertMib(patch.quotaMb, 'The mailbox size'));
    if (patch.state !== undefined) {
      const value = STATE_VALUES[patch.state];
      if (value === undefined) throw badRequest(`Unknown mailbox state "${String(patch.state)}"`);
      attr.active = value;
    }
    const current = await this.getMailbox(address);
    if (Object.keys(attr).length === 0) return;
    const domain = aliasDomainOf(current.address);
    try {
      await this.client.write(
        '/api/v1/edit/mailbox',
        { items: [current.address], attr },
        { action: `change mailbox ${current.address}` },
      );
    } finally {
      this.reads.forget(domain);
    }
  }

  /**
   * Alone in its request: a password that fails Mailcow's policy cancels every other change of
   * the same edit. An empty password would be ignored silently, so it is refused. So is a
   * mailbox that signs in through Keycloak, LDAP or OIDC (authsource): Mailcow changes only
   * passwords of its own mailboxes, yet reports success for the others.
   */
  async setMailboxPassword(address: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password === '') throw badRequest('The password must not be empty');
    const { mailbox: current, raw } = await this.mailboxRecord(address);
    const authSource = str(raw.authsource)?.toLowerCase();
    if (authSource && authSource !== 'mailcow') {
      throw conflict(
        `${current.address} signs in through ${authSource}, its password is managed there, not at Mailcow`,
      );
    }
    try {
      await this.client.write(
        '/api/v1/edit/mailbox',
        { items: [current.address], attr: { password, password2: password } },
        { action: `set the password of ${current.address}`, secrets: [password] },
      );
    } finally {
      this.reads.forget(aliasDomainOf(current.address));
    }
  }

  /**
   * Mailcow also deletes aliases whose only target was the mailbox and removes it from the
   * others, in any domain of the instance, so every cached alias list and domain count is
   * forgotten.
   */
  async deleteMailbox(address: string): Promise<void> {
    const current = await this.getMailbox(address);
    try {
      await this.client.write('/api/v1/delete/mailbox', [current.address], {
        action: `delete mailbox ${current.address}`,
      });
    } finally {
      this.reads.forget(aliasDomainOf(current.address));
      this.reads.forgetKind('aliases');
      this.reads.forgetKind('domain');
    }
  }

  // ---------------------------------------------------------------------------
  // Aliases

  async listMailAliases(domain: string): Promise<MailAliasDto[]> {
    const name = assertDomain(domain);
    return this.reads.get(`aliases:${name}`, LIST_TTL_MS, async () => {
      const body = await this.client.get(`/api/v1/get/alias/all/${name}`, `list aliases of ${name}`);
      return asList(body)
        .map(parseAlias)
        .filter((a): a is MailAliasDto => a !== null && aliasDomainOf(a.address) === name)
        .sort((a, b) =>
          a.catchAll !== b.catchAll ? (a.catchAll ? 1 : -1) : a.address.localeCompare(b.address),
        );
    });
  }

  async getMailAlias(id: string): Promise<MailAliasDto> {
    const aliasId = assertAliasId(id);
    const body = await this.client.get(`/api/v1/get/alias/${aliasId}`, `read alias ${aliasId}`);
    const alias = parseAlias(body);
    if (!alias) throw new ProviderError(PROVIDER, `alias ${aliasId} not found`, 404);
    return alias;
  }

  /**
   * Every target is checked first: Mailcow drops an invalid target, saves the alias with the
   * rest and reports both. Left out, active, sogo_visible and sender_allowed would be 0.
   */
  async createMailAlias(input: MailAliasInput): Promise<MailAliasDto> {
    const { localPart, domain } = assertAddress(input.address);
    const address = `${localPart}@${domain}`;
    const targets = assertTargets(input.targets, address);
    const active = input.active !== false;

    let id: string | undefined;
    try {
      const { entries } = await this.client.write(
        '/api/v1/add/alias',
        {
          address,
          goto: targets.join(','),
          active: flag(active),
          sogo_visible: '1',
          sender_allowed: '1',
        },
        { action: `create alias ${address}` },
      );
      // ["alias_added", "<address>", "<new id>"]
      id = parseWriteResult(entries, 200).successes.find((s) => s.key === 'alias_added')?.args[1];
    } finally {
      this.reads.forget(domain);
    }
    if (!id || !/^\d{1,10}$/.test(id)) {
      throw new ProviderError(PROVIDER, `create alias ${address} failed: Mailcow did not create the alias`);
    }

    try {
      return await this.getMailAlias(id);
    } catch {
      return {
        id,
        address,
        catchAll: localPart === '',
        targets,
        special: null,
        active,
        createdAt: new Date().toISOString(),
        modifiedAt: null,
      };
    }
  }

  /**
   * Without goto, Mailcow checks the stored targets again and drops its own null@localhost
   * (spam@, ham@) as invalid, saving nothing: a special alias keeps its target by its flag.
   */
  async updateMailAlias(id: string, patch: MailAliasPatch): Promise<void> {
    const current = await this.getMailAlias(id);
    const attr: Record<string, string> = {};
    if (patch.targets !== undefined) attr.goto = assertTargets(patch.targets, current.address).join(',');
    if (patch.active !== undefined) attr.active = flag(patch.active);
    if (Object.keys(attr).length === 0) return;
    if (attr.goto === undefined && current.special) attr[SPECIAL_FLAGS[current.special]] = '1';
    try {
      await this.client.write(
        '/api/v1/edit/alias',
        { items: [current.id], attr },
        { action: `change alias ${current.address}` },
      );
    } finally {
      this.reads.forget(aliasDomainOf(current.address));
    }
  }

  async deleteMailAlias(id: string): Promise<void> {
    const current = await this.getMailAlias(id);
    try {
      await this.client.write('/api/v1/delete/alias', [current.id], {
        action: `delete alias ${current.address}`,
      });
    } finally {
      this.reads.forget(aliasDomainOf(current.address));
    }
  }

  // ---------------------------------------------------------------------------
  // DKIM, password policy, client settings

  async getDkim(domain: string): Promise<DkimKey | null> {
    const name = assertDomain(domain);
    return this.reads.get(`dkim:${name}`, DKIM_TTL_MS, async () =>
      parseDkim(await this.client.get(`/api/v1/get/dkim/${name}`, `read the DKIM key of ${name}`)),
    );
  }

  /** Mailcow answers "invalid" for an existing key as for invalid input, so the key is read first. */
  async createDkim(domain: string, options: { selector: string; keySize: number }): Promise<DkimKey> {
    const name = assertDomain(domain);
    assertDkimOptions(options);
    this.reads.delete(`dkim:${name}`);
    if (await this.getDkim(name)) throw conflict('A DKIM key exists already');
    try {
      await this.client.write(
        '/api/v1/add/dkim',
        { domains: name, dkim_selector: options.selector, key_size: String(options.keySize) },
        { action: `create a DKIM key for ${name}` },
      );
    } finally {
      this.reads.forget(name);
    }
    const key = await this.getDkim(name);
    if (!key)
      throw new ProviderError(PROVIDER, `the DKIM key of ${name} could not be read after creating it`);
    return key;
  }

  async deleteDkim(domain: string): Promise<void> {
    const name = assertDomain(domain);
    try {
      await this.client.write('/api/v1/delete/dkim', [name], { action: `delete the DKIM key of ${name}` });
    } finally {
      this.reads.forget(name);
    }
  }

  /** 404 when the instance has no policy endpoint (older versions); callers fall back to the panel's rules. */
  async mailPasswordPolicy(): Promise<MailPasswordPolicy> {
    return this.reads.get('policy', STATIC_TTL_MS, async () => {
      let body: unknown;
      try {
        body = await this.client.get('/api/v1/get/passwordpolicy', 'read the password policy');
      } catch (err) {
        if (isNotFound(err)) throw new ProviderError(PROVIDER, 'password policy not available', 404);
        throw err;
      }
      if (!isRecord(body) || isEmptyObject(body)) {
        throw new ProviderError(PROVIDER, 'password policy not available', 404);
      }
      return parsePasswordPolicy(body);
    });
  }

  mailClientSettings(): MailClientSettings {
    return mailClientSettings(this.mailHost);
  }

  // ---------------------------------------------------------------------------
  // API explorer

  /**
   * Paths below /api/v1/get|add|edit|delete/ only (the base URL may be included); GET for get,
   * POST for the rest. A delete takes { "items": [...] } and sends the bare array, as Mailcow
   * reads it. Secret values in the answer (passwords, private keys) are blanked out.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    if (!clean.startsWith('/')) clean = `/${clean}`;
    // The key goes to the instance only: no dot segments (also encoded), no host switch.
    if (/\/\/|\.\.|\\|%2e|%2f|%5c|#/i.test(clean)) throw badRequest('Invalid path');
    const q = clean.indexOf('?');
    const pathname = q >= 0 ? clean.slice(0, q) : clean;
    const match = /^\/api\/v1\/(get|add|edit|delete)\/[A-Za-z0-9._@,/-]+$/.exec(pathname);
    if (!match) {
      throw badRequest('Only Mailcow API paths are allowed, e.g. /api/v1/get/domain/all');
    }
    const action = match[1];
    if ((action === 'get') !== (upper === 'GET') || (upper !== 'GET' && upper !== 'POST')) {
      throw badRequest('Mailcow takes GET for /api/v1/get/... and POST for add, edit and delete');
    }

    let send: unknown;
    if (action === 'delete') {
      if (!Array.isArray(body?.items)) {
        throw badRequest('A delete needs the items as { "items": [...] }; Mailcow receives the array itself');
      }
      send = body.items;
    } else if (action !== 'get') {
      send = body ?? {};
    }
    const secrets = secretValues(send);
    const res = await this.client.raw(upper as 'GET' | 'POST', clean, send, secrets);
    return { status: res.status, data: this.client.scrubValue(redactMailcow(res.body), secrets) };
  }
}

/** Host name of the base URL, the default mail host. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return (
      baseUrl
        .replace(/^[a-z]+:\/\//i, '')
        .split(/[/:?#]/)[0]
        ?.toLowerCase() ?? ''
    );
  }
}
