import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../../auth/sessions';
import { redactText } from './redact';

/**
 * The read layer of the AI tools and features (ai 8.1). Tools never query customer tables: they call an allowlist
 * of existing GET routes in process with app.inject, as the person who asked, so every permission, module and
 * suspension check of those routes applies unchanged. Paths are built from fixed templates with the run's
 * organization and validated UUIDs; the model never supplies a path. Only GET, so nothing can be written.
 *
 * Isolation (plan O26, review #1): a resource read by id is accepted only when its body names the run's
 * organization (`org.id`); `org: null` and a missing `org` fail closed. Sub-paths (DNS records, metrics, ...)
 * answer without an `org` field, so they are read only below a parent verified earlier in the same run. Every
 * refusal is `not_found`, the same answer as for an id that does not exist.
 */

export type OwnedKind = 'server' | 'domain' | 'website' | 'mail_domain' | 'monitor';

const PARENT_PATH: Record<OwnedKind, string> = {
  server: '/servers/',
  domain: '/domains/',
  website: '/webspaces/',
  mail_domain: '/mail/domains/',
  monitor: '/monitors/',
};

/** Sub-paths that may be read after owned() verified the parent (ai 8.1 table). */
export const SUB_PATHS = {
  server: ['metrics', 'activity', 'tasks', 'monitoring', 'traffic'],
  domain: ['dns'],
  website: ['dns-check'],
  mail_domain: ['dns'],
  monitor: ['history'],
} as const satisfies Record<OwnedKind, readonly string[]>;
export type SubPath = { [K in OwnedKind]: (typeof SUB_PATHS)[K][number] };

/** List and overview routes of the current organization, /orgs/:orgId/<sub>. */
export const ORG_SUB_PATHS = [
  '',
  'servers',
  'domains',
  'webspaces',
  'mail/domains',
  'monitoring',
  'cloud',
  'phone-systems',
  'media',
  'billing/summary',
  'invoices',
  'audit',
] as const;
export type OrgSubPath = (typeof ORG_SUB_PATHS)[number];

/** Every route template the reader can call, for the route existence test (ai 15.2). */
export const READER_ROUTES: string[] = [
  ...ORG_SUB_PATHS.map((s) => (s ? `/orgs/:orgId/${s}` : '/orgs/:orgId')),
  ...(Object.keys(PARENT_PATH) as OwnedKind[]).flatMap((kind) => [
    `${PARENT_PATH[kind]}:id`,
    ...SUB_PATHS[kind].map((sub) => `${PARENT_PATH[kind]}:id/${sub}`),
  ]),
];

export type ReadError =
  'not_found' | 'forbidden' | 'unsupported' | 'provider_error' | 'rate_limited' | 'live_limit';
export type ReadResult<T> =
  { ok: true; body: T; path: string } | { ok: false; error: ReadError; message?: string };

/** A body that names the organization it belongs to (ServerDto, DomainDto, WebspaceDto, MailDomainDto, MonitorDto). */
interface OrgOwned {
  org?: { id?: unknown } | null;
}

const uuid = z.uuid();
const PROVIDER_MESSAGE_MAX = 300;

/** The strict test of plan O26: the body names exactly this organization. `org: null` fails. */
export function assertSameOrg(body: unknown, orgId: string): boolean {
  const org = (body as OrgOwned | null)?.org;
  return !!org && typeof org === 'object' && org.id === orgId;
}

export interface ReaderOptions {
  /** Called before every read of a live route (a provider is asked); false refuses it with live_limit. */
  liveGuard?: () => boolean;
}

/** Routes that ask a provider live (ai 8.2 "Live"), counted against the live-read limits by features. */
function isLive(path: string): boolean {
  return (
    /^\/(domains|webspaces|mail\/domains|monitors)\/[^/]+$/.test(path) ||
    /^\/(domains\/[^/]+\/dns|webspaces\/[^/]+\/dns-check|mail\/domains\/[^/]+\/dns|monitors\/[^/]+\/history)$/.test(
      path,
    ) ||
    /^\/servers\/[^/]+\/(metrics|monitoring|traffic)$/.test(path) ||
    /^\/orgs\/[^/]+\/media$/.test(path)
  );
}

export class ConsoleReader {
  private readonly verified = new Set<string>();
  private live = 0;

  constructor(
    private readonly app: FastifyInstance,
    private readonly req: FastifyRequest,
    readonly orgId: string,
    private readonly signal: AbortSignal,
    private readonly options: ReaderOptions = {},
  ) {}

  /** Live reads made through this reader. */
  get liveCalls(): number {
    return this.live;
  }

  /** A list or overview route of the current organization: /orgs/${orgId}/... only. */
  orgGet<T>(sub: OrgSubPath, query?: Record<string, string>): Promise<ReadResult<T>> {
    if (!(ORG_SUB_PATHS as readonly string[]).includes(sub))
      return Promise.resolve({ ok: false, error: 'not_found' });
    return this.get<T>(`/orgs/${this.orgId}${sub ? `/${sub}` : ''}`, query);
  }

  /** Loads a resource by id and fails closed unless it belongs to the current organization. */
  async owned<T = unknown>(kind: OwnedKind, id: string): Promise<ReadResult<T>> {
    if (!uuid.safeParse(id).success) return { ok: false, error: 'not_found' };
    const result = await this.get<T>(`${PARENT_PATH[kind]}${id}`);
    if (!result.ok) return result;
    if (!assertSameOrg(result.body, this.orgId)) return { ok: false, error: 'not_found' };
    this.verified.add(`${kind}:${id}`);
    return result;
  }

  /** A sub-path of a resource verified by owned() earlier in the same run; anything else is not_found. */
  async sub<T = unknown, K extends OwnedKind = OwnedKind>(
    kind: K,
    id: string,
    sub: SubPath[K],
    query?: Record<string, string>,
  ): Promise<ReadResult<T>> {
    if (!this.verified.has(`${kind}:${id}`)) return { ok: false, error: 'not_found' };
    if (!(SUB_PATHS[kind] as readonly string[]).includes(sub)) return { ok: false, error: 'not_found' };
    return this.get<T>(`${PARENT_PATH[kind]}${id}/${sub}`, query);
  }

  /** Whether owned() verified this resource in this run. */
  isVerified(kind: OwnedKind, id: string): boolean {
    return this.verified.has(`${kind}:${id}`);
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<ReadResult<T>> {
    if (this.signal.aborted) return { ok: false, error: 'provider_error' };
    if (isLive(path)) {
      if (this.options.liveGuard && !this.options.liveGuard()) return { ok: false, error: 'live_limit' };
      this.live++;
    }
    const cookie = this.req.cookies[SESSION_COOKIE];
    const res = await this.app.inject({
      method: 'GET',
      url: `/api/v1${path}`,
      query,
      remoteAddress: this.req.ip,
      headers: {
        ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
        ...(this.req.headers['user-agent'] ? { 'user-agent': this.req.headers['user-agent'] } : {}),
        accept: 'application/json',
      },
    });
    if (res.statusCode === 200) {
      try {
        return { ok: true, body: res.json() as T, path };
      } catch {
        return { ok: false, error: 'provider_error' };
      }
    }
    if (res.statusCode === 404) return { ok: false, error: 'not_found' };
    if (res.statusCode === 403 || res.statusCode === 401) return { ok: false, error: 'forbidden' };
    if (res.statusCode === 429) return { ok: false, error: 'rate_limited' };
    let body: { error?: { code?: unknown; message?: unknown } } | null = null;
    try {
      body = res.json();
    } catch {
      body = null;
    }
    if (res.statusCode === 422 && body?.error?.code === 'unsupported')
      return { ok: false, error: 'unsupported' };
    if (
      res.statusCode >= 500 &&
      typeof body?.error?.message === 'string' &&
      body.error.code === 'provider_error'
    ) {
      // The provider's text is third-party data: redacted and short.
      return {
        ok: false,
        error: 'provider_error',
        message: redactText(body.error.message).slice(0, PROVIDER_MESSAGE_MAX),
      };
    }
    return { ok: false, error: 'provider_error' };
  }
}
