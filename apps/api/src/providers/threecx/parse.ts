import type {
  PhoneEdition,
  PhoneRingGroup,
  PhoneRingStrategy,
  PhoneSystemInfo,
  PhoneTrunk,
  PhoneTrunkDirection,
  PhoneUser,
} from '@weblion/shared';
import { ProviderError, badRequest, conflict, phoneUserLimit } from '../../lib/errors';
import { isRecord, num, str } from '../http';
import type { PhoneUserInput, PhoneUserPatch } from '../types';

/** Prefix of every ProviderError message of the 3CX adapter. */
export const PROVIDER = '3CX';

// Explicit selects: without them the XAPI answers SIP passwords, the web client password, the
// voicemail PIN (users) and the license key (system status). Properties of the 20.0.10 spec.
export const SYSTEM_STATUS_SELECT = [
  'FQDN',
  'Version',
  'Activated',
  'LicenseActive',
  'ExpirationDate',
  'MaintenanceExpiresAt',
  'MaxSimCalls',
  'MaxUserExtensions',
  'UserExtensions',
  'ExtensionsTotal',
  'ExtensionsRegistered',
  'TrunksTotal',
  'TrunksRegistered',
  'CallsActive',
  'HasNotRunningServices',
  'ProductCode',
].join(',');
export const USER_SELECT = [
  'Id',
  'Number',
  'FirstName',
  'LastName',
  'DisplayName',
  'EmailAddress',
  'Mobile',
  'OutboundCallerID',
  'Language',
  'Enabled',
  'IsRegistered',
  'PrimaryGroupId',
  'Tags',
].join(',');
/** Role of the user per group (nested options, UNVERIFIED for 3CX: the users list falls back). */
export const USER_EXPAND = 'Groups($select=GroupId;$expand=Rights($select=RoleName))';
export const RING_GROUP_SELECT = 'Id,Number,Name,RingStrategy,RingTime';
export const TRUNK_SELECT =
  'Id,Number,Gateway,IsOnline,Direction,ExternalNumber,SimultaneousCalls,DidNumbers,ConfigurationIssue';
/** Role names that administer the PBX (UNVERIFIED identifiers, see design 1.10). */
export const ADMIN_ROLES = ['system_owners', 'system_admins'];
/** User tags of non-human users (spec Pbx.UserTag). */
export const SYSTEM_TAGS = ['FaxServer', 'WakeUp', 'Principal', 'AI'];

const MAX_INT32 = 2_147_483_647;

/** The OData error of an XAPI answer ({ error: { code, message, target, details } }). */
export interface ODataError {
  code: string | null;
  message: string | null;
  target: string | null;
  details: { code: string | null; message: string | null; target: string | null }[];
}

/** Details of a ProviderError the client raises for a failed XAPI request. */
export interface XapiErrorDetails {
  odata: ODataError | null;
}

export function parseODataError(body: unknown): ODataError | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const error = body.error;
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  return {
    code: str(error.code),
    message: str(error.message),
    target: str(error.target),
    details: details.map((d) => ({ code: str(d.code), message: str(d.message), target: str(d.target) })),
  };
}

/** The OData error a client ProviderError carries, else null. */
export function odataOf(err: unknown): ODataError | null {
  if (!(err instanceof ProviderError) || !isRecord(err.details)) return null;
  const odata = (err.details as Partial<XapiErrorDetails>).odata;
  return odata ?? null;
}

/** WARNINGS.* codes anywhere in the error (code, message, details). */
export function warningCodes(error: ODataError | null): string[] {
  if (!error) return [];
  const texts = [error.code, error.message, ...error.details.flatMap((d) => [d.code, d.message])];
  const codes = new Set<string>();
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/WARNINGS\.[A-Z0-9_.]*[A-Z0-9_]/g)) codes.add(match[0]);
  }
  return [...codes];
}

/** Targets (property names) the error names, main target first. */
function targets(error: ODataError | null): string[] {
  if (!error) return [];
  return [error.target, ...error.details.map((d) => d.target)].filter((t): t is string => t !== null);
}

/** "<message> (<target>: <detail message>; ...)" without action and status. */
export function odataSummary(error: ODataError): string | null {
  // 3CX messages may span lines ("Number:\nWARNINGS.XAPI.DUPLICATE"): one line in errors.
  const line = (text: string | null) => text?.replace(/\s+/g, ' ').trim() || null;
  const parts: string[] = [];
  for (const d of error.details) {
    const text = line(d.message) ?? line(d.code);
    if (text) parts.push(d.target ? `${d.target}: ${text}` : text);
  }
  const head = line(error.message) ?? line(error.code) ?? parts.shift() ?? null;
  if (!head) return null;
  return parts.length ? `${head} (${parts.join('; ')})` : head;
}

/**
 * "<action> failed: <odata message>[ (<target>: <detail>; ...)] (HTTP <status>)" plus a hint for
 * statuses that have a usual cause. `collection`: the request listed an entity set.
 */
export function describeError(
  status: number,
  body: unknown,
  action: string | undefined,
  options: { collection?: boolean } = {},
): string {
  const odata = parseODataError(body);
  let message = odata ? odataSummary(odata) : null;
  if (!message && typeof body === 'string') {
    const text = body.trim();
    if (text && !text.startsWith('<')) message = text.slice(0, 200);
  }
  if (!message && status === 429) message = 'too many requests';
  if (!message) message = 'no XAPI answer, check the address';

  let out = `${action ? `${action} failed` : 'request failed'}: ${message} (HTTP ${status})`;
  if (status === 403) {
    out +=
      '. The API client needs the System Admin role in the default group (3CX Admin > Integrations > API); ' +
      'the XAPI needs an Enterprise license';
  } else if (status === 404 && options.collection) {
    out += '. The PBX does not know this path, check that it runs 3CX V20';
  } else if (status === 429) {
    out += '. The phone system throttles requests, try again later';
  } else if (status === 503) {
    out += '. The phone system is starting or updating';
  } else if (status >= 300 && status < 400) {
    out += '. The PBX redirects, check the address (https, port)';
  }
  return out;
}

/** ISO string, or null for missing, invalid or before 1900 ("0001-01-01T00:00:00+00:00"). */
export function isoDate(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  if (date.getUTCFullYear() < 1900) return null;
  return date.toISOString();
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function edition(license: unknown): PhoneEdition | null {
  if (!isRecord(license)) return null;
  if (license.IsEnterprise === true) return 'enterprise';
  if (license.IsProfessional === true) return 'professional';
  // UNVERIFIED: neither flag is taken as Standard.
  return 'standard';
}

/**
 * Facts from SystemStatus and Defs/Pbx.GetSystemParameters() (either may be partial). Never
 * reads the license key, the reseller name or IP addresses.
 */
export function parseSystemInfo(status: unknown, params: unknown, baseUrl: string): PhoneSystemInfo {
  const s = record(status);
  const p = record(params);
  const license = isRecord(p.License) ? p.License : null;
  const maxUserExtensions = num(s.MaxUserExtensions);
  const enl = num(p.ENL);
  return {
    fqdn: str(s.FQDN) ?? str(p.FQDN),
    version: str(s.Version) ?? str(p.Version),
    edition: edition(license),
    productCode: str(s.ProductCode) ?? str(license?.ProductCode),
    activated: bool(s.Activated),
    licenseActive: bool(s.LicenseActive),
    licenseExpiresAt: isoDate(s.ExpirationDate),
    maintenanceExpiresAt: isoDate(s.MaintenanceExpiresAt),
    maxSimCalls: num(s.MaxSimCalls) ?? num(license?.MaxSimCalls),
    activeCalls: num(s.CallsActive),
    users: num(s.UserExtensions),
    maxUsers:
      license?.IsExtensionLimitEnforcementEnabled === true &&
      maxUserExtensions !== null &&
      maxUserExtensions > 0
        ? maxUserExtensions
        : null,
    extensionsTotal: num(s.ExtensionsTotal),
    extensionsRegistered: num(s.ExtensionsRegistered),
    trunksTotal: num(s.TrunksTotal),
    trunksRegistered: num(s.TrunksRegistered),
    servicesDown: bool(s.HasNotRunningServices),
    numberLength: enl !== null && Number.isInteger(enl) && enl >= 2 && enl <= 10 ? enl : null,
    // UNVERIFIED path: the tutorial calls /webclient/api/..., so /webclient/ exists on the PBX.
    webClientUrl: `${baseUrl.replace(/\/+$/, '')}/webclient/`,
  };
}

/** The role of the user's primary group, else of its first group (3CX Rights.RoleName). */
function roleOf(raw: Record<string, unknown>): string | null {
  const groups = Array.isArray(raw.Groups) ? raw.Groups.filter(isRecord) : [];
  const primary = num(raw.PrimaryGroupId);
  const group = (primary !== null ? groups.find((g) => num(g.GroupId) === primary) : undefined) ?? groups[0];
  return group && isRecord(group.Rights) ? str(group.Rights.RoleName) : null;
}

/** A user with the safe fields only. null when Id or Number is missing. */
export function parseUser(raw: unknown): PhoneUser | null {
  if (!isRecord(raw)) return null;
  const id = num(raw.Id);
  const number = str(raw.Number);
  if (id === null || number === null) return null;
  const firstName = str(raw.FirstName);
  const lastName = str(raw.LastName);
  const role = roleOf(raw);
  const tags = Array.isArray(raw.Tags) ? raw.Tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    id: String(id),
    number,
    firstName,
    lastName,
    displayName: str(raw.DisplayName) ?? ([firstName, lastName].filter(Boolean).join(' ') || null),
    email: str(raw.EmailAddress)?.toLowerCase() ?? null,
    mobile: str(raw.Mobile),
    outboundCallerId: str(raw.OutboundCallerID),
    language: str(raw.Language)?.toLowerCase() ?? null,
    enabled: bool(raw.Enabled),
    registered: bool(raw.IsRegistered),
    role,
    admin: role !== null && ADMIN_ROLES.includes(role),
    system: tags.some((t) => SYSTEM_TAGS.includes(t)) || raw.AIAgent === true,
  };
}

const STRATEGIES: Record<string, PhoneRingStrategy> = { Hunt: 'hunt', RingAll: 'ring_all', Paging: 'paging' };

export function parseRingGroup(raw: unknown): PhoneRingGroup | null {
  if (!isRecord(raw)) return null;
  const id = num(raw.Id);
  const number = str(raw.Number);
  if (id === null || number === null) return null;
  const strategy = str(raw.RingStrategy);
  const members: PhoneRingGroup['members'] = [];
  for (const m of Array.isArray(raw.Members) ? raw.Members.filter(isRecord) : []) {
    const memberNumber = str(m.Number);
    if (memberNumber !== null) members.push({ number: memberNumber, name: str(m.Name) });
  }
  return {
    id: String(id),
    number,
    name: str(raw.Name),
    strategy: (strategy && STRATEGIES[strategy]) || null,
    ringTimeSeconds: num(raw.RingTime),
    members,
  };
}

const DIRECTIONS: Record<string, PhoneTrunkDirection> = {
  Inbound: 'inbound',
  Outbound: 'outbound',
  Both: 'both',
  None: 'none',
};

/** A trunk without its credentials (AuthID, AuthPassword are never read). */
export function parseTrunk(raw: unknown): PhoneTrunk | null {
  if (!isRecord(raw)) return null;
  const id = num(raw.Id);
  const number = str(raw.Number);
  if (id === null || number === null) return null;
  const gateway = record(raw.Gateway);
  const direction = str(raw.Direction);
  return {
    id: String(id),
    number,
    name: str(gateway.Name),
    host: str(gateway.Host),
    online: bool(raw.IsOnline),
    direction: (direction && DIRECTIONS[direction]) || null,
    externalNumber: str(raw.ExternalNumber),
    simultaneousCalls: num(raw.SimultaneousCalls),
    didCount: Array.isArray(raw.DidNumbers) ? raw.DidNumbers.length : 0,
    configurationIssue: str(raw.ConfigurationIssue),
  };
}

/** The 3CX JSON for POST /Users: only set fields. */
export function userCreatePayload(input: PhoneUserInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.number) payload.Number = input.number;
  payload.FirstName = input.firstName;
  if (input.lastName !== null && input.lastName !== undefined) payload.LastName = input.lastName;
  payload.EmailAddress = input.email;
  if (input.mobile !== null && input.mobile !== undefined) payload.Mobile = input.mobile;
  if (input.outboundCallerId !== null && input.outboundCallerId !== undefined) {
    payload.OutboundCallerID = input.outboundCallerId;
  }
  if (input.language !== null && input.language !== undefined) payload.Language = input.language;
  return payload;
}

const PATCH_KEYS: Record<keyof PhoneUserPatch, string> = {
  firstName: 'FirstName',
  lastName: 'LastName',
  email: 'EmailAddress',
  mobile: 'Mobile',
  outboundCallerId: 'OutboundCallerID',
  language: 'Language',
};

/**
 * The 3CX JSON for PATCH /Users(id): only the keys present in `patch`. null clears (sent as
 * null, not "": 3CX knows WARNINGS.XAPI.CAN_NOT_BE_EMPTY_STRING; that null clears is UNVERIFIED).
 */
export function userPatchPayload(patch: PhoneUserPatch): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(PATCH_KEYS) as [keyof PhoneUserPatch, string][]) {
    if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
    payload[property] = patch[key];
  }
  return payload;
}

/** OData string literal: quotes doubled, wrapped in quotes. */
export function odataString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** 3CX ids are int32: "^[0-9]{1,10}$" and <= 2147483647, else ProviderError 404. */
export function assertXapiId(id: string, what: string): number {
  if (typeof id !== 'string' || !/^[0-9]{1,10}$/.test(id) || Number(id) > MAX_INT32) {
    throw new ProviderError(PROVIDER, `${what} ${String(id).slice(0, 64)} not found`, 404);
  }
  return Number(id);
}

/**
 * Keys whose values never leave the panel: SIP credentials (AuthID, AuthPassword objects as a
 * whole), web client and desk phone passwords, the voicemail PIN, the license key, one-time
 * tickets, provisioning links, API tokens and client secrets.
 */
const SECRET_KEY =
  /pass(word)?|secret|token|ticket|licen[cs]e_?key|private_?key|^vmpin$|^pin$|auth_?id|prov(isioning)?_?link|rps_?key/i;

/** Blanks secret values anywhere in a body (explorer answers). */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T;
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) && v !== null && v !== '' ? '[redacted]' : redactSecrets(v);
  }
  return out as T;
}

/** What a failed write was about, for the error mapping. */
export interface WriteContext {
  /** "phone user 42", "ring group 7": used for "<what> not found". */
  what: string;
  /** Extension number the write was about, if any. */
  number?: string | null;
  /** POST /Users: a duplicate on any property means the number. */
  creating?: boolean;
}

const DUPLICATE = ['WARNINGS.XAPI.ALREADY_IN_USE', 'WARNINGS.XAPI.DUPLICATE'];
const LIMIT = ['WARNINGS.LIMIT_REACHED', 'WARNINGS.NO_MORE_NUMBERS_AVAILABLE'];
const REFUSED = ['WARNINGS.XAPI.CANNOT_CLEAR_OWN_EXTENSION', 'WARNINGS.XAPI.FORBIDDEN_CHANGE'];
const INVALID = [
  'WARNINGS.XAPI.OUT_OF_THE_RANGE',
  'WARNINGS.XAPI.REQUIRED',
  'WARNINGS.XAPI.CAN_NOT_BE_EMPTY_STRING',
  'WARNINGS.LENGTH_NOT_MORE_50_CHARS',
  'WARNINGS.LENGTH_NOT_MORE_255_CHARS',
  'WARNINGS.INVALID',
];

/**
 * Maps a failed XAPI write to the contract's errors: a taken number 409, the license limit 409
 * phone_user_limit, refused deletions 409, unknown ids 404, validation 400. Everything else
 * (network, sign-in, 5xx) is returned unchanged. Best effort: where 3CX puts its WARNINGS.*
 * codes is UNVERIFIED, so all of code, message and details are searched.
 */
export function mapWriteError(err: unknown, context: WriteContext): unknown {
  if (!(err instanceof ProviderError) || err.upstreamStatus === undefined) return err;
  const status = err.upstreamStatus;
  const odata = odataOf(err);
  const warnings = warningCodes(odata);
  const has = (codes: string[]) => warnings.some((w) => codes.includes(w));
  const named = targets(odata);
  const message = (odata && odataSummary(odata)) ?? `HTTP ${status}`;
  const onNumber = named.some((t) => t.toLowerCase() === 'number');

  // OData services answer duplicates with 409 as well.
  const duplicate = has(DUPLICATE) || (status === 409 && warnings.length === 0);
  if (duplicate && (onNumber || context.creating)) {
    if (context.number)
      return conflict(`The extension number ${context.number} is in use at the phone system`);
    if (onNumber) return conflict('The extension number is in use at the phone system');
    return conflict(`${PROVIDER}: ${message}`);
  }
  if (has(LIMIT)) return phoneUserLimit('The license of this phone system allows no more users');
  if (warnings.some((w) => w.endsWith('CANNOT_BE_DELETED')) || has(REFUSED) || status === 409) {
    return conflict(`${PROVIDER}: ${message}`);
  }
  // A NOT_FOUND that names another property (a member number) is a validation error below.
  const otherTarget = named.some((t) => t.toLowerCase() !== 'id');
  if (status === 404 || (has(['WARNINGS.XAPI.NOT_FOUND']) && !otherTarget)) {
    return new ProviderError(PROVIDER, `${context.what} not found`, 404);
  }
  if (has(INVALID) || status === 400) {
    return badRequest(`${PROVIDER}: ${message}`, {
      target: named[0] ?? null,
      code: warnings[0] ?? odata?.code ?? null,
    });
  }
  return err;
}

/** Throws the mapped error of a failed write. */
export function throwWriteError(err: unknown, context: WriteContext): never {
  throw mapWriteError(err, context);
}
