import type { Capability, PowerAction } from '@weblion/shared';
import { ProviderError, badRequest, conflict } from '../../lib/errors';
import type {
  CloudAccountInput,
  CloudAccountPatch,
  InfraOverview,
  NextcloudConfig,
  ProviderAdapter,
  RawResponse,
  RemoteCloudAccount,
  RemoteServer,
  ServerRef,
} from '../types';
import {
  NextcloudClient,
  PROVIDER,
  ocsStatus,
  type Form,
  type NextcloudClientOptions,
  type Query,
} from './client';
import {
  DEFAULT_GROUP_PREFIX,
  assertDisplayName,
  assertEmail,
  assertGroupId,
  assertQuota,
  assertUserId,
  nextcloudLanguage,
  parseCloudUser,
  parseIdList,
  parseUsersDetails,
  parseVersion,
  redactPasswords,
} from './parse';

/** Users per page of /cloud/users/details. Every user costs Nextcloud a storage lookup. */
const PAGE_SIZE = 100;
/** 1000 pages of 100 users, far beyond the instance sizes the panel manages. Stops runaway loops. */
const MAX_PAGES = 1000;

/** Nextcloud answers these OCS codes without a message (v2 maps 998 to 404). */
const USER_CODES: Record<number, string> = { 404: 'User does not exist', 998: 'User does not exist' };
const EDIT_CODES: Record<number, string> = {
  ...USER_CODES,
  101: 'Invalid value',
  112: 'The user backend does not support setting passwords',
  113: 'This field cannot be edited',
};
const STATE_CODES: Record<number, string> = {
  ...USER_CODES,
  101: 'Unknown user, or the account the panel signs in with',
};
const DELETE_CODES: Record<number, string> = {
  ...USER_CODES,
  101: 'The user could not be deleted (the account the panel signs in with cannot delete itself)',
};
const WELCOME_CODES: Record<number, string> = {
  ...USER_CODES,
  101: 'Email address not available',
  102: 'Sending email failed',
};
const GROUP_CODES: Record<number, string> = {
  101: 'Invalid group name',
  102: 'Group exists',
  103: 'Not supported by the group backend',
};
/** OCS status of addUser and addGroup for "already exists". */
const ALREADY_EXISTS = 102;

/** Path of a user below /ocs/v2.php. The id is checked and encoded ("@" included). */
function userPath(externalId: string, suffix = ''): string {
  return `/cloud/users/${encodeURIComponent(assertUserId(externalId))}${suffix}`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.upstreamStatus === 404;
}

/** Explorer body values as form fields: arrays stay arrays, objects become JSON. */
function toFormValues(body: Record<string, unknown>): Form {
  const form: Form = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value))
      form[key] = value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    else if (typeof value === 'object') form[key] = JSON.stringify(value);
    else form[key] = value as string | number | boolean;
  }
  return form;
}

/**
 * Nextcloud (cloud storage): users of one instance, managed with an admin account through
 * the OCS provisioning API. No servers. Users are addressed by their user id (= login name,
 * e.g. "anna@muster-ag"); every customer's users are in the group "<prefix><org slug>".
 */
export class NextcloudAdapter implements ProviderAdapter {
  readonly type = 'nextcloud' as const;
  private readonly client: NextcloudClient;
  private readonly groupPrefix: string;

  constructor(config: NextcloudConfig, options: NextcloudClientOptions = {}) {
    this.client = new NextcloudClient(config, options);
    this.groupPrefix = config.groupPrefix?.trim() || DEFAULT_GROUP_PREFIX;
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
    throw new ProviderError(PROVIDER, `Nextcloud has no servers (${ref.externalId})`, 404);
  }

  /** Reachable, app password accepted, and the account may manage users. */
  async testConnection(): Promise<Record<string, unknown>> {
    const [version, me] = await Promise.all([
      this.version(),
      this.client.ocs('GET', '/cloud/user', { action: 'read the signed in user' }),
    ]);
    const user = parseCloudUser(me);
    if (!user) throw new ProviderError(PROVIDER, 'the current user (GET /cloud/user) came back empty');
    if (!user.groups.includes('admin')) {
      throw new ProviderError(
        PROVIDER,
        `the account "${user.externalId}" is not a Nextcloud admin (member of the "admin" group), ` +
          'which managing users requires',
        403,
      );
    }
    const users = await this.userIds();
    return { version: version.string, user: user.externalId, users: users.length };
  }

  async overview(): Promise<InfraOverview> {
    const [version, users, groups] = await Promise.all([this.version(), this.userIds(), this.panelGroups()]);
    return {
      version: version.string,
      nodes: [],
      storages: [],
      facts: [
        { label: 'Version', value: [version.string, version.edition].filter(Boolean).join(' ') || '–' },
        { label: 'Users', value: String(users.length) },
        { label: `Groups ${this.groupPrefix}*`, value: String(groups.length) },
        { label: 'Login', value: this.cloudLoginUrl() },
      ],
    };
  }

  private async version() {
    return parseVersion(await this.client.ocs('GET', '/cloud/capabilities', { action: 'read capabilities' }));
  }

  /** Every user id of the instance. Cheap: no storage lookup per user. */
  private async userIds(): Promise<string[]> {
    return parseIdList(await this.client.ocs('GET', '/cloud/users', { action: 'list users' }), 'users');
  }

  /** The per-organization groups (search matches anywhere in the id, so filter by prefix). */
  private async panelGroups(): Promise<string[]> {
    const data = await this.client.ocs('GET', '/cloud/groups', {
      query: { search: this.groupPrefix },
      action: 'list groups',
    });
    return parseIdList(data, 'groups').filter((g) => g.startsWith(this.groupPrefix));
  }

  // ---------------------------------------------------------------------------
  // Cloud accounts

  /** Every user with quota and usage, in pages of PAGE_SIZE. */
  async listCloudAccounts(): Promise<RemoteCloudAccount[]> {
    const byId = new Map<string, RemoteCloudAccount>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.client.ocs('GET', '/cloud/users/details', {
        query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        action: 'list users',
      });
      const { users, count } = parseUsersDetails(data);
      // A user created between two pages shifts the offsets; the map drops the duplicate.
      for (const user of users) byId.set(user.externalId, user);
      if (count < PAGE_SIZE) break;
    }
    return [...byId.values()];
  }

  async getCloudAccount(externalId: string): Promise<RemoteCloudAccount> {
    const data = await this.client.ocs('GET', userPath(externalId), {
      action: `read user ${externalId}`,
      codes: USER_CODES,
    });
    const user = parseCloudUser(data, externalId);
    if (!user)
      throw new ProviderError(PROVIDER, `read user ${externalId} failed: no user data in the answer`);
    return user;
  }

  /**
   * Creates the user in its groups (missing groups are created first). Without a password
   * Nextcloud mails the user a link to set one, so an e-mail address is required then.
   * Nextcloud sets quota and language after it created the user; when such a step fails,
   * the half-created user is removed again so a retry does not run into "already exists".
   * Once the user is created, a failed read-back does not fail the creation.
   */
  async createCloudAccount(input: CloudAccountInput): Promise<RemoteCloudAccount> {
    const username = assertUserId(input.username);
    const quota = assertQuota(input.quotaBytes);
    const email = assertEmail(input.email);
    const displayName = assertDisplayName(input.displayName);
    const password = input.password ?? '';
    if (!password && !email) {
      throw badRequest('An e-mail address is required when Nextcloud is to send the invitation');
    }
    const groups = [...new Set(input.groups)].map(assertGroupId);

    if (await this.userExists(username)) throw conflict(`The Nextcloud user "${username}" already exists`);
    for (const group of groups) await this.ensureGroup(group);

    const form: Form = {
      userid: username,
      password: password || undefined,
      displayName: displayName ?? undefined,
      email: email || undefined,
      groups,
      quota: String(quota),
      language: nextcloudLanguage(input.language) ?? undefined,
    };
    try {
      await this.client.ocs('POST', '/cloud/users', {
        form,
        action: `create user ${username}`,
        secrets: [password],
      });
    } catch (err) {
      if (ocsStatus(err) === ALREADY_EXISTS) {
        throw conflict(`The Nextcloud user "${username}" already exists`);
      }
      await this.removeHalfCreated(username);
      throw err;
    }
    try {
      return await this.getCloudAccount(username);
    } catch {
      // The user exists now: failing here would leave it behind, invited and unmanaged. The
      // panel stores what was asked for instead; the next sync reads the user's real values.
      return {
        externalId: username,
        displayName,
        email: email || null,
        quotaBytes: quota,
        usedBytes: 0,
        enabled: true,
        lastLoginAt: null,
        groups,
      };
    }
  }

  /** Changes field by field (Nextcloud edits one key per request). Everything is checked first. */
  async updateCloudAccount(externalId: string, patch: CloudAccountPatch): Promise<void> {
    const path = userPath(externalId);
    const edits: { key: string; value: string }[] = [];
    if (patch.displayName !== undefined) {
      // Nextcloud ignores an empty display name; its default is the user id.
      edits.push({ key: 'displayname', value: assertDisplayName(patch.displayName) ?? externalId });
    }
    if (patch.email !== undefined) edits.push({ key: 'email', value: assertEmail(patch.email) });
    if (patch.quotaBytes !== undefined)
      edits.push({ key: 'quota', value: String(assertQuota(patch.quotaBytes)) });

    for (const edit of edits) {
      await this.client.ocs('PUT', path, {
        form: edit,
        action: `change ${edit.key} of ${externalId}`,
        codes: EDIT_CODES,
      });
    }
    if (patch.enabled !== undefined) {
      const action = patch.enabled ? 'enable' : 'disable';
      await this.client.ocs('PUT', `${path}/${action}`, {
        action: `${action} ${externalId}`,
        codes: STATE_CODES,
      });
    }
  }

  async setCloudAccountPassword(externalId: string, password: string): Promise<void> {
    if (!password) throw badRequest('The password must not be empty');
    await this.client.ocs('PUT', userPath(externalId), {
      form: { key: 'password', value: password },
      action: `set the password of ${externalId}`,
      codes: EDIT_CODES,
      secrets: [password],
    });
  }

  async deleteCloudAccount(externalId: string): Promise<void> {
    await this.client.ocs('DELETE', userPath(externalId), {
      action: `delete user ${externalId}`,
      codes: DELETE_CODES,
    });
  }

  /** Nextcloud's welcome mail again; with a pending invitation it carries a new set-password link. */
  async resendCloudInvite(externalId: string): Promise<void> {
    await this.client.ocs('POST', userPath(externalId, '/welcome'), {
      action: `send the welcome mail to ${externalId}`,
      codes: WELCOME_CODES,
    });
  }

  cloudLoginUrl(): string {
    return this.client.baseUrl;
  }

  private async userExists(externalId: string): Promise<boolean> {
    try {
      await this.client.ocs('GET', userPath(externalId), {
        action: `read user ${externalId}`,
        codes: USER_CODES,
      });
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** Creates the group unless it exists. Another request creating it meanwhile is fine. */
  private async ensureGroup(group: string): Promise<void> {
    const data = await this.client.ocs('GET', '/cloud/groups', {
      query: { search: group },
      action: `look up group ${group}`,
    });
    if (parseIdList(data, 'groups').includes(group)) return;
    try {
      await this.client.ocs('POST', '/cloud/groups', {
        form: { groupid: group },
        action: `create group ${group}`,
        codes: GROUP_CODES,
      });
    } catch (err) {
      if (ocsStatus(err) !== ALREADY_EXISTS) throw err;
    }
  }

  /** Best effort: the error of the creation is what the caller needs to see. */
  private async removeHalfCreated(username: string): Promise<void> {
    try {
      if (await this.userExists(username)) {
        await this.client.ocs('DELETE', userPath(username), {
          action: `remove half-created user ${username}`,
        });
      }
    } catch {
      // The user shows up as unmanaged at the instance and can be deleted or imported there.
    }
  }

  // ---------------------------------------------------------------------------
  // API explorer

  /**
   * OCS paths only, e.g. "/ocs/v2.php/cloud/users?search=anna" (the base URL may be included).
   * GET and DELETE send the body as query, POST and PUT as form. Password values in the
   * answer are blanked out.
   */
  async rawRequest(method: string, path: string, body?: Record<string, unknown>): Promise<RawResponse> {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(upper)) throw badRequest('Unsupported method');
    let clean = path.trim();
    if (clean.startsWith(this.client.baseUrl)) clean = clean.slice(this.client.baseUrl.length);
    if (!clean.startsWith('/')) clean = `/${clean}`;
    const q = clean.indexOf('?');
    const pathname = q >= 0 ? clean.slice(0, q) : clean;
    if (!/^\/ocs\/v[12]\.php\/[^?#]+$/.test(pathname)) {
      throw badRequest('Only OCS paths are allowed, e.g. /ocs/v2.php/cloud/users');
    }
    // The credentials go to the instance only: no dot segments (also encoded), no host switch.
    if (/\/\/|\.\.|\\|%2e|%2f|%5c|#/i.test(pathname)) throw badRequest('Invalid path');
    if (/\/core\/(get)?apppassword/i.test(pathname)) {
      throw badRequest('The app password of the panel cannot be managed through the explorer');
    }

    const query: Query = {};
    for (const [key, value] of new URLSearchParams(q >= 0 ? clean.slice(q + 1) : '')) query[key] = value;
    const asQuery = upper === 'GET' || upper === 'DELETE';
    if (body && asQuery) {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        query[key] = typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean);
      }
    }
    const form = body && !asQuery ? toFormValues(body) : undefined;
    const secrets = Object.entries(body ?? {})
      .filter(([key]) => /passw(or)?d|secret|token|value/i.test(key))
      .map(([, value]) => (typeof value === 'string' ? value : null));
    const res = await this.client.raw(upper, pathname, { query, form, secrets });
    return { status: res.status, data: redactPasswords(res.body) };
  }
}
