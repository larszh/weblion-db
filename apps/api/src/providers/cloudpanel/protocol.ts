import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { WEBSITE_TYPES } from '@weblion/shared';
import { AppError, ProviderError, badRequest } from '../../lib/errors';
import type {
  RemoteWebsite,
  WireError,
  WireErrorCode,
  WireInfo,
  WireOp,
  WireOps,
  WireRequest,
  WireSite,
} from '../types';
import type { ExecResult } from './ssh';

export type { WireOp };

export const PROVIDER = 'CloudPanel';

/** Version of the wire protocol this console speaks (the agent's "v" and info.protocol). */
export const WIRE_PROTOCOL = 1;

/**
 * How long the console waits for each operation. A little longer than the agent's own limit
 * (20 s for reads, 300 s for create, ...), so the agent's "timeout" answer arrives first.
 */
export const OP_TIMEOUT_MS: Record<WireOp, number> = {
  info: 30_000,
  list: 60_000,
  get: 30_000,
  unmanaged: 30_000,
  create: 330_000,
  delete: 200_000,
  password: 30_000,
  'db-add': 90_000,
  'db-delete': 90_000,
  'db-password': 30_000,
  cert: 200_000,
  adopt: 30_000,
  forget: 30_000,
};

export const WIRE_ERROR_CODES = [
  'invalid',
  'exists',
  'not_found',
  'not_managed',
  'protected',
  'adopt_disabled',
  'busy',
  'version',
  'clpctl_failed',
  'timeout',
  'internal',
] as const satisfies readonly WireErrorCode[];

/** Messages and outputs are cut to this length after redaction. */
const MAX_TEXT = 2000;
/** Secrets shorter than this are not searched for (they would match ordinary text). */
const MIN_SECRET_LENGTH = 4;
const MASK = '•••';

// ---------------------------------------------------------------------------
// Answer schemas. Unknown fields are stripped, never rejected: a newer agent may add some.
// Fields an older agent may leave out default to null or an empty list.

const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => z.string().max(max).nullable().default(null);
const byteCount = z.number().nonnegative().nullable().default(null);
/** Addresses of one family; anything else the agent reports is dropped. */
const addresses = (family: 4 | 6) =>
  z
    .array(text(64))
    .max(64)
    .default([])
    .transform((list) => list.filter((ip) => isIP(ip) === family));

const wireCertificateSchema = z.object({
  type: optionalText(64),
  letsEncrypt: z.boolean().nullable().default(null),
  expiresAt: optionalText(64),
});

const wireDatabaseSchema = z.object({
  name: text(64),
  users: z.array(text(64)).max(100).default([]),
  sizeBytes: byteCount,
});

const wireUsageSchema = z.object({
  diskBytes: byteCount,
  databaseBytes: byteCount,
  measuredAt: optionalText(64),
});

export const wireSiteSchema: z.ZodType<WireSite> = z.object({
  domain: z.string().min(1).max(253),
  type: z.enum(WEBSITE_TYPES),
  siteUser: z.string().min(1).max(64),
  homeDirectory: text(4096),
  webRoot: optionalText(4096),
  application: optionalText(100),
  phpVersion: optionalText(16),
  nodejsVersion: optionalText(16),
  appPort: z.number().int().min(1).max(65535).nullable().default(null),
  createdAt: optionalText(64),
  certificate: wireCertificateSchema.nullable().default(null),
  databases: z.array(wireDatabaseSchema).max(1000).default([]),
  usage: wireUsageSchema.nullable().default(null),
});

export const wireInfoSchema: z.ZodType<WireInfo> = z.object({
  agentVersion: text(64),
  protocol: z.number().int(),
  cloudpanelVersion: optionalText(100),
  hostname: text(253),
  os: optionalText(200),
  ipv4: addresses(4),
  ipv6: addresses(6),
  phpVersions: z.array(text(16)).max(64).default([]),
  templates: z
    .array(z.object({ name: text(100), rootDirectory: optionalText(4096) }))
    .max(500)
    .default([]),
  nodejsVersions: z.array(text(16)).max(64).default([]),
  nodejsEnabled: z.boolean().default(false),
  allowRemoteAdopt: z.boolean().default(false),
  protectedDomains: z.array(text(253)).max(1000).default([]),
  counts: z.object({
    sites: z.number().int().nonnegative(),
    managed: z.number().int().nonnegative(),
    unmanaged: z.number().int().nonnegative(),
  }),
  cliVersion: optionalText(200),
});

export const wireUnmanagedSchema: z.ZodType<WireOps['unmanaged']['data']> = z.object({
  sites: z
    .array(
      z.object({
        domain: z.string().min(1).max(253),
        type: z.enum(WEBSITE_TYPES),
        siteUser: z.string().min(1).max(64),
        protected: z.boolean(),
      }),
    )
    .max(10_000),
  allowRemoteAdopt: z.boolean(),
});

export const wireErrorSchema: z.ZodType<WireError> = z.object({
  // A code a newer agent invents is still an error, just not one the console knows.
  code: z.enum(WIRE_ERROR_CODES).catch('internal'),
  message: z.string().max(4000),
  field: z.string().max(100).optional(),
  rolledBack: z.boolean().optional(),
  output: z.string().max(4000).optional(),
});

export const answerSchema = z.discriminatedUnion('ok', [
  z.object({ v: z.literal(WIRE_PROTOCOL), ok: z.literal(true), data: z.unknown() }),
  z.object({ v: z.literal(WIRE_PROTOCOL), ok: z.literal(false), error: wireErrorSchema }),
]);

const warningsSchema = z.array(text(4000)).max(100).default([]);
const empty = z.object({}).transform(() => ({}) as Record<string, never>);
const siteAnswer = z.object({ site: wireSiteSchema });

/** The data of a successful answer, per operation. */
export const DATA_SCHEMAS: { [Op in WireOp]: z.ZodType<WireOps[Op]['data']> } = {
  info: wireInfoSchema,
  list: z.object({ sites: z.array(wireSiteSchema).max(10_000) }),
  get: siteAnswer,
  unmanaged: wireUnmanagedSchema,
  create: z.object({ site: wireSiteSchema, warnings: warningsSchema }),
  delete: z.object({ warnings: warningsSchema }),
  password: empty,
  'db-add': siteAnswer,
  'db-delete': siteAnswer,
  'db-password': empty,
  cert: siteAnswer,
  adopt: siteAnswer,
  forget: empty,
};

// ---------------------------------------------------------------------------
// Requests and answers

/** Fields without a value (undefined, null) are left out of a request. */
function compact(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * One JSON line for the agent's stdin. Passwords only ever go into `secrets`, which is left out
 * when the operation sends none.
 */
export function buildRequest<Op extends WireOp>(
  op: Op,
  args: WireOps[Op]['args'],
  secrets?: WireOps[Op]['secrets'] | Record<string, string | undefined>,
  requestId: string = randomUUID(),
): string {
  const request: WireRequest<Op> = {
    v: WIRE_PROTOCOL,
    op,
    requestId,
    args: compact(args as Record<string, unknown>) as WireOps[Op]['args'],
  };
  const values = compact((secrets ?? {}) as Record<string, unknown>);
  if (Object.keys(values).length > 0) request.secrets = values as WireOps[Op]['secrets'];
  return JSON.stringify(request);
}

/**
 * Text with every secret of the request replaced, plus what CloudPanel itself is known to print
 * with passwords in it (useradd's `openssl passwd -6 '...'`, MySQL's `IDENTIFIED BY '...'`,
 * clpctl's `--...Password=...` options), cut to 2000 characters.
 */
export function redactSecrets(value: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = value;
  // Longest first, so a secret that contains another one disappears completely.
  const list = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const secret of list) out = out.split(secret).join(MASK);
  out = out
    .replace(/passwd -6 '[^']*'/g, `passwd -6 '${MASK}'`)
    .replace(/IDENTIFIED BY '[^']*'/gi, `IDENTIFIED BY '${MASK}'`)
    .replace(/--(\w*[Pp]assword)=\S*/g, `--$1=${MASK}`);
  return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT) : out;
}

/** The last non-empty line of stdout as JSON, or undefined (the agent prints exactly one line). */
function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) return undefined;
  try {
    return JSON.parse(last) as unknown;
  } catch {
    return undefined;
  }
}

/** First line of stderr, redacted and short, for messages. */
function diagnostic(stderr: string, secrets: readonly string[]): string | null {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
  return line ? redactSecrets(line, secrets).slice(0, 300) : null;
}

/** The console error for an answer with ok: false (table of section 7.2). */
export function wireError(error: WireError, secrets: readonly string[] = []): AppError {
  const message = redactSecrets(error.message, secrets);
  switch (error.code) {
    case 'invalid':
      return badRequest(message, error.field ? [{ path: error.field, message }] : []);
    case 'exists':
      return new AppError(409, 'exists', message, { field: error.field ?? null });
    case 'not_found':
      return new ProviderError(PROVIDER, message, 404);
    case 'not_managed':
    case 'protected':
    case 'adopt_disabled':
      return new AppError(409, error.code, message);
    case 'busy':
      return new AppError(503, 'busy', message);
    case 'version':
      return new AppError(422, 'unsupported', message);
    case 'clpctl_failed':
    case 'timeout':
    case 'internal': {
      const details: { rolledBack?: boolean; output?: string } = {};
      if (error.rolledBack !== undefined) details.rolledBack = error.rolledBack;
      if (error.output !== undefined) details.output = redactSecrets(error.output, secrets);
      return new ProviderError(
        PROVIDER,
        message,
        undefined,
        Object.keys(details).length > 0 ? details : undefined,
      );
    }
  }
}

/**
 * The data of the agent's answer, or the error it stands for. The exit code must be 0 (ok) or
 * 1 (not ok) and the last stdout line one JSON answer that agrees with it; everything else is a
 * transport problem (section 7.3). Every text is redacted with the request's secrets.
 */
export function parseAnswer(
  result: ExecResult,
  secrets: readonly string[] = [],
  host = 'the server',
): unknown {
  const { code } = result;
  if (code === 127) {
    // sudo found no such command: nothing ran on the server.
    throw new ProviderError(PROVIDER, `weblion-clp is not installed on ${host}`, undefined, {
      rolledBack: true,
    });
  }
  if (code === null) {
    const how = result.signal ? ` (${result.signal})` : '';
    throw new ProviderError(
      PROVIDER,
      `The connection to ${host} ended before the agent answered${how}. ` +
        'The server may still finish the operation; the next sync shows the result.',
    );
  }
  const stderr = diagnostic(result.stderr, secrets);
  if (code !== 0 && code !== 1) {
    throw new ProviderError(
      PROVIDER,
      `The agent on ${host} failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`,
    );
  }
  const json = lastJsonLine(result.stdout);
  if (json === undefined && code === 1) {
    throw new ProviderError(
      PROVIDER,
      `The agent did not answer (${stderr ?? 'no output'}). Is weblion-clp installed and the sudoers file in place?`,
    );
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success || parsed.data.ok !== (code === 0)) {
    throw new ProviderError(
      PROVIDER,
      `Invalid answer from the agent on ${host} (protocol mismatch: update weblion-clp)`,
    );
  }
  if (!parsed.data.ok) throw wireError(parsed.data.error, secrets);
  return parsed.data.data;
}

/** The data of an answer checked against the operation's schema. */
export function parseData<Op extends WireOp>(
  op: Op,
  data: unknown,
  host = 'the server',
): WireOps[Op]['data'] {
  const parsed = DATA_SCHEMAS[op].safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    throw new ProviderError(
      PROVIDER,
      `Invalid answer from the agent on ${host} to "${op}"${where} (protocol mismatch: update weblion-clp)`,
    );
  }
  return parsed.data;
}

/** A site of the wire protocol as the adapter contract carries it. */
export function toRemoteWebsite(site: WireSite): RemoteWebsite {
  return {
    domain: site.domain,
    facts: {
      type: site.type,
      siteUser: site.siteUser,
      homeDirectory: site.homeDirectory,
      webRoot: site.webRoot,
      application: site.application,
      phpVersion: site.phpVersion,
      nodejsVersion: site.nodejsVersion,
      appPort: site.appPort,
      certificate: site.certificate
        ? {
            type: site.certificate.type,
            letsEncrypt: site.certificate.letsEncrypt,
            expiresAt: site.certificate.expiresAt,
          }
        : null,
      databases: site.databases.length,
      diskBytes: site.usage?.diskBytes ?? null,
      databaseBytes: site.usage?.databaseBytes ?? null,
      usageMeasuredAt: site.usage?.measuredAt ?? null,
      createdAt: site.createdAt,
    },
    databases: site.databases.map((db) => ({ name: db.name, users: [...db.users], sizeBytes: db.sizeBytes })),
  };
}
