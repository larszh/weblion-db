import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// A small 3CX V20 PBX behind its XAPI (OData v4 below /xapi/v1) and OAuth2 token endpoint.
// Shapes follow the official swagger.yaml (x-pbx-version 20.0.10.1479) and the 3CX XAPI
// tutorial: multipart client credentials at /connect/token, one valid token per client (a new
// token invalidates the previous one), $select/$expand/$orderby/$top/$skip/$count, collections
// as { "@odata.count", value }, errors as { error: { code, message, target, details } } with
// WARNINGS.* codes in details[].message and the property in target.

export const CLIENT_ID = 'weblion';
export const CLIENT_SECRET = 'Qm7xZ2pLk9vRt4Wn8YbC3dFg';

/** Values of the secret fields the mock carries, so tests can prove they never leak. */
export const SECRETS = [
  'web-client-pass-1234',
  'sip-auth-pass-5678',
  'sip-auth-id-9012',
  'desk-phone-pass-3456',
  '4711',
  'https://pbx.example/provisioning/abcdef',
  'LIC-KEY-1234-5678-ABCD',
  'trunk-sip-pass-7890',
  'trunk-auth-id-2468',
];

export interface XapiRecorded {
  method: string;
  /** Percent-decoded path, e.g. /xapi/v1/Users(Number='101'). */
  path: string;
  /** Request target as sent (path and query). */
  url: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  contentType: string | null;
  /** Raw body text. */
  raw: string;
  /** JSON body of API calls, undefined without one. */
  body: unknown;
  /** Multipart fields of /connect/token. */
  form: Record<string, string> | null;
}

export type XapiAnswer =
  { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | undefined;

export interface MockUser {
  Id: number;
  Number: string;
  FirstName: string | null;
  LastName: string | null;
  DisplayName: string | null;
  EmailAddress: string | null;
  Mobile: string | null;
  OutboundCallerID: string | null;
  Language: string | null;
  Enabled: boolean;
  IsRegistered: boolean;
  PrimaryGroupId: number;
  Tags: string[];
  AIAgent: boolean;
  /** Group memberships with the role per group (Groups($expand=Rights)). */
  groups: { GroupId: number; RoleName: string }[];
  welcomeMails: number;
}

export interface MockRingGroup {
  Id: number;
  Number: string;
  Name: string;
  RingStrategy: 'Hunt' | 'RingAll' | 'Paging';
  RingTime: number;
  /** Extension numbers in ring order. */
  members: string[];
}

const XAPI = '/xapi/v1';

const USER_PROPS = [
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
  'AIAgent',
  'AccessPassword',
  'AuthID',
  'AuthPassword',
  'DeskphonePassword',
  'VMPIN',
  'Phones',
  'SIPID',
];
const RING_GROUP_PROPS = ['Id', 'Number', 'Name', 'RingStrategy', 'RingTime', 'IsRegistered', 'Members'];
const TRUNK_PROPS = [
  'Id',
  'Number',
  'Gateway',
  'IsOnline',
  'Direction',
  'ExternalNumber',
  'SimultaneousCalls',
  'DidNumbers',
  'ConfigurationIssue',
  'AuthID',
  'AuthPassword',
];
const SYSTEM_STATUS = {
  FQDN: 'muster.3cx.ch',
  Version: '20.0.10.1479',
  Activated: true,
  LicenseActive: true,
  ExpirationDate: '2027-01-31T00:00:00+01:00',
  MaintenanceExpiresAt: '0001-01-01T00:00:00.0000000+00:00',
  MaxSimCalls: 16,
  MaxUserExtensions: 0,
  UserExtensions: 0,
  ExtensionsTotal: 0,
  ExtensionsRegistered: 0,
  TrunksTotal: 2,
  TrunksRegistered: 1,
  CallsActive: 3,
  HasNotRunningServices: false,
  ProductCode: '3CXPSENT16',
  LicenseKey: 'LIC-KEY-1234-5678-ABCD',
  ResellerName: 'weblion GmbH',
  Ip: '203.0.113.20',
  AutoUpdateEnabled: true,
};

function odataError(status: number, message: string, details: { message: string; target?: string }[] = []) {
  return {
    status,
    body: {
      error: {
        code: '',
        message,
        target: null,
        details: details.map((d) => ({ code: '', message: d.message, target: d.target ?? null })),
      },
    },
  };
}

/** OData's answer for a $select with an unknown property. */
function unknownProperty(name: string, type: string) {
  return odataError(
    400,
    `The query specified in the URI is not valid. Could not find a property named '${name}' on type '${type}'.`,
  );
}

function pick(entity: Record<string, unknown>, select: string | null, props: string[], type: string) {
  if (!select) return { value: entity };
  const out: Record<string, unknown> = {};
  for (const name of select.split(',').map((s) => s.trim())) {
    if (!props.includes(name)) return { error: unknownProperty(name, type) };
    if (name in entity) out[name] = entity[name];
  }
  return { value: out };
}

export class MockPbx {
  enl = 3;
  expiresIn: number | string | null = 3600;
  /** Enforced user limit (License.IsExtensionLimitEnforcementEnabled), null = none. */
  maxUsers: number | null = null;
  /** The nested $expand of Groups is refused with 400 (older builds). */
  rejectExpand = false;
  /** The server answers every page from the start. */
  ignoreSkip = false;
  /** Collections answer without @odata.count. */
  omitCount = false;
  /** Largest page the server answers, whatever $top asks for. */
  pageCap: number | null = null;
  /** Delay before answering (per request with delayFor), and the peak of requests in progress. */
  delayMs = 0;
  delayFor: ((req: XapiRecorded) => number) | null = null;
  active = 0;
  peak = 0;
  /** Answers for single requests: return one to short-circuit (runs before authentication). */
  override: ((req: XapiRecorded) => XapiAnswer) | null = null;

  users = new Map<number, MockUser>();
  ringGroups = new Map<number, MockRingGroup>();
  trunks: Record<string, unknown>[] = [];
  tokens = 0;
  currentToken: string | null = null;
  private nextId = 1;

  constructor() {
    this.addUser({ Number: '100', FirstName: 'Anna', LastName: 'Muster', role: 'system_owners' });
    this.addUser({
      Number: '101',
      FirstName: 'Ben',
      LastName: 'Beispiel',
      EmailAddress: 'Ben@Muster.example',
    });
    this.addUser({
      Number: '102',
      FirstName: 'Fax',
      LastName: null,
      Tags: ['FaxServer'],
      EmailAddress: null,
    });
    this.ringGroups.set(800, {
      Id: 800,
      Number: '800',
      Name: 'Zentrale',
      RingStrategy: 'RingAll',
      RingTime: 20,
      members: ['100', '101'],
    });
    this.trunks.push(
      {
        Id: 900,
        Number: '10000',
        Gateway: { Name: 'Swisscom SIP', Host: 'sip.swisscom.ch', Port: 5060, Internal: false },
        IsOnline: true,
        Direction: 'Both',
        ExternalNumber: '+41441234500',
        SimultaneousCalls: 8,
        DidNumbers: ['+41441234500', '+41441234501', '+41441234502'],
        ConfigurationIssue: '',
        AuthID: 'trunk-auth-id-2468',
        AuthPassword: { Concealed: true, Value: 'trunk-sip-pass-7890' },
      },
      {
        Id: 901,
        Number: '10001',
        Gateway: { Name: 'Peoplefone', Host: 'sips.peoplefone.ch' },
        IsOnline: false,
        Direction: 'Outbound',
        ExternalNumber: null,
        SimultaneousCalls: 4,
        DidNumbers: [],
        ConfigurationIssue: 'Registration failed: 403 Forbidden',
        AuthID: 'trunk-auth-id-2468',
        AuthPassword: { Concealed: true, Value: 'trunk-sip-pass-7890' },
      },
    );
  }

  addUser(u: Partial<MockUser> & { Number: string; role?: string }): MockUser {
    const id = u.Id ?? this.nextId++;
    const user: MockUser = {
      Id: id,
      FirstName: null,
      LastName: null,
      DisplayName: null,
      EmailAddress: `user${id}@muster.example`,
      Mobile: null,
      OutboundCallerID: null,
      Language: null,
      Enabled: true,
      IsRegistered: false,
      PrimaryGroupId: 1,
      Tags: [],
      AIAgent: false,
      groups: [{ GroupId: 1, RoleName: u.role ?? 'users' }],
      welcomeMails: 0,
      ...u,
    };
    this.users.set(id, user);
    return user;
  }

  /** Every DN number in use: users, ring groups, trunks. */
  numbers(): Set<string> {
    return new Set([
      ...[...this.users.values()].map((u) => u.Number),
      ...[...this.ringGroups.values()].map((g) => g.Number),
      ...this.trunks.map((t) => String(t.Number)),
    ]);
  }

  /** Issues a token like /connect/token does; the previous one stops working. */
  issueToken(): string {
    this.tokens++;
    this.currentToken = `xapi-token-${this.tokens}-${'x'.repeat(16)}`;
    return this.currentToken;
  }

  userEntity(u: MockUser, expandGroups: boolean): Record<string, unknown> {
    const entity: Record<string, unknown> = {
      Id: u.Id,
      Number: u.Number,
      FirstName: u.FirstName,
      LastName: u.LastName,
      DisplayName: u.DisplayName,
      EmailAddress: u.EmailAddress,
      Mobile: u.Mobile,
      OutboundCallerID: u.OutboundCallerID,
      Language: u.Language,
      Enabled: u.Enabled,
      IsRegistered: u.IsRegistered,
      PrimaryGroupId: u.PrimaryGroupId,
      Tags: u.Tags,
      AIAgent: u.AIAgent,
      AccessPassword: 'web-client-pass-1234',
      AuthID: 'sip-auth-id-9012',
      AuthPassword: 'sip-auth-pass-5678',
      DeskphonePassword: 'desk-phone-pass-3456',
      VMPIN: '4711',
      SIPID: '',
      Phones: [
        {
          MacAddress: '000b82123456',
          ProvisioningLinkExt: 'https://pbx.example/provisioning/abcdef',
          ProvisioningLinkLocal: 'https://pbx.example/provisioning/abcdef',
        },
      ],
    };
    if (expandGroups) {
      entity.Groups = u.groups.map((g) => ({ GroupId: g.GroupId, Rights: { RoleName: g.RoleName } }));
    }
    return entity;
  }

  ringGroupEntity(g: MockRingGroup): Record<string, unknown> {
    return {
      Id: g.Id,
      Number: g.Number,
      Name: g.Name,
      RingStrategy: g.RingStrategy,
      RingTime: g.RingTime,
      IsRegistered: true,
      Members: g.members.map((number, i) => {
        const user = [...this.users.values()].find((u) => u.Number === number);
        return {
          Id: 5000 + i,
          Number: number,
          Name: user ? [user.FirstName, user.LastName].filter(Boolean).join(' ') : null,
          Tags: [],
        };
      }),
    };
  }

  handle = (req: XapiRecorded): XapiAnswer => {
    const answer = this.override?.(req);
    if (answer) return answer;

    if (req.path === '/connect/token') return this.token(req);
    if (!req.path.startsWith(`${XAPI}/`)) return { status: 404, text: '' };
    if (!this.currentToken || req.headers.authorization !== `Bearer ${this.currentToken}`) {
      return { status: 401, text: '', headers: { 'www-authenticate': 'Bearer error="invalid_token"' } };
    }
    const path = req.path.slice(XAPI.length);
    const select = req.query.get('$select');

    if (req.method === 'GET' && path === '/SystemStatus') {
      const users = this.users.size;
      const status = {
        ...SYSTEM_STATUS,
        MaxUserExtensions: this.maxUsers ?? 0,
        UserExtensions: users,
        ExtensionsTotal: users + this.ringGroups.size,
        ExtensionsRegistered: [...this.users.values()].filter((u) => u.IsRegistered).length,
      };
      const picked = pick(status, select, Object.keys(status), 'Pbx.SystemStatus');
      return (
        picked.error ?? { body: { '@odata.context': `${XAPI}/$metadata#SystemStatus`, ...picked.value } }
      );
    }
    if (req.method === 'GET' && path === '/Defs/Pbx.GetSystemParameters()') {
      return {
        body: {
          '@odata.context': `${XAPI}/$metadata#Pbx.SystemParameters`,
          FQDN: 'muster.3cx.ch',
          Version: '20.0.10.1479',
          ENL: this.enl,
          ENLRange: { From: 100, To: 999 },
          GlobalLanguage: 'de',
          IsMulticompanyMode: false,
          License: {
            CountryCode: 'CH',
            IsEnterprise: true,
            IsProfessional: false,
            IsExtensionLimitEnforcementEnabled: this.maxUsers !== null,
            MaxSimCalls: 16,
            ProductCode: '3CXPSENT16',
          },
        },
      };
    }

    // Users
    if (req.method === 'GET' && path === '/Users/Pbx.GetFirstAvailableExtensionNumber()') {
      const taken = this.numbers();
      const start = 10 ** (this.enl - 1);
      for (let n = start; n < start * 10; n++) {
        if (!taken.has(String(n))) {
          return {
            body: { '@odata.context': `${XAPI}/$metadata#Pbx.FirstAvailableNumber`, Number: String(n) },
          };
        }
      }
      return { body: { Number: null } };
    }
    if (req.method === 'GET' && path === '/Users') {
      const expand = this.expandGroups(req);
      if (expand === 'refused') return this.expandRefused();
      const users = [...this.users.values()].sort((a, b) => (a.Number < b.Number ? -1 : 1));
      return this.collection(
        req,
        users.map((u) => this.userEntity(u, expand)),
        USER_PROPS,
        'Pbx.User',
      );
    }
    if (req.method === 'POST' && path === '/Users') return this.createUser(req);

    const byNumber = /^\/Users\(Number='((?:[^']|'')*)'\)$/.exec(path);
    if (req.method === 'GET' && byNumber) {
      const number = byNumber[1]!.replaceAll("''", "'");
      const user = [...this.users.values()].find((u) => u.Number === number);
      if (!user) return odataError(404, 'WARNINGS.XAPI.NOT_FOUND');
      return this.entity(this.userEntity(user, false), select, USER_PROPS, 'Pbx.User');
    }
    const welcome = /^\/Users\((\d+)\)\/Pbx\.SendWelcomeEmail$/.exec(path);
    if (req.method === 'POST' && welcome) {
      const user = this.users.get(Number(welcome[1]));
      if (!user) return odataError(404, 'WARNINGS.XAPI.NOT_FOUND');
      if (!user.EmailAddress) {
        return odataError(400, 'EmailAddress:\nWARNINGS.XAPI.REQUIRED', [
          { message: 'WARNINGS.XAPI.REQUIRED', target: 'EmailAddress' },
        ]);
      }
      user.welcomeMails++;
      return { status: 204 };
    }
    const userId = /^\/Users\((\d+)\)$/.exec(path);
    if (userId) {
      const user = this.users.get(Number(userId[1]));
      if (!user) return odataError(404, 'WARNINGS.XAPI.NOT_FOUND');
      if (req.method === 'GET') {
        const expand = this.expandGroups(req);
        if (expand === 'refused') return this.expandRefused();
        return this.entity(this.userEntity(user, expand), select, USER_PROPS, 'Pbx.User');
      }
      if (req.method === 'PATCH') return this.patchUser(user, req.body);
      if (req.method === 'DELETE') {
        if (user.Tags.includes('FaxServer')) {
          return odataError(400, 'WARNINGS.FAX_SERVER_CANNOT_BE_DELETED', [
            { message: 'WARNINGS.FAX_SERVER_CANNOT_BE_DELETED', target: 'Id' },
          ]);
        }
        this.users.delete(user.Id);
        for (const g of this.ringGroups.values()) g.members = g.members.filter((m) => m !== user.Number);
        return { status: 204 };
      }
    }

    // Ring groups
    if (req.method === 'GET' && path === '/RingGroups') {
      const groups = [...this.ringGroups.values()].sort((a, b) => (a.Number < b.Number ? -1 : 1));
      return this.collection(
        req,
        groups.map((g) => this.withoutMembers(req, this.ringGroupEntity(g))),
        RING_GROUP_PROPS,
        'Pbx.RingGroup',
      );
    }
    const groupId = /^\/RingGroups\((\d+)\)$/.exec(path);
    if (groupId) {
      const group = this.ringGroups.get(Number(groupId[1]));
      if (!group) return odataError(404, 'WARNINGS.XAPI.NOT_FOUND');
      if (req.method === 'GET') {
        return this.entity(
          this.withoutMembers(req, this.ringGroupEntity(group)),
          select,
          RING_GROUP_PROPS,
          'Pbx.RingGroup',
        );
      }
      if (req.method === 'PATCH') {
        const body = req.body as { Members?: { Number?: string }[] };
        if (Array.isArray(body?.Members)) {
          const numbers = body.Members.map((m) => String(m.Number ?? ''));
          const users = new Set([...this.users.values()].map((u) => u.Number));
          const unknown = numbers.find((n) => !users.has(n));
          if (unknown !== undefined) {
            return odataError(400, 'Members:\nWARNINGS.XAPI.NOT_FOUND', [
              { message: 'WARNINGS.XAPI.NOT_FOUND', target: 'Members' },
            ]);
          }
          group.members = numbers;
        }
        return { status: 204 };
      }
    }

    // Trunks
    if (req.method === 'GET' && path === '/Trunks') {
      return this.collection(req, [...this.trunks], TRUNK_PROPS, 'Pbx.Trunk');
    }
    return odataError(404, `No HTTP resource was found that matches the request URI '${req.path}'.`);
  };

  private token(req: XapiRecorded): XapiAnswer {
    if (req.method !== 'POST' || !req.contentType?.startsWith('multipart/form-data')) {
      return {
        status: 400,
        body: { error: 'invalid_request', error_description: 'The request is malformed.' },
      };
    }
    const form = req.form ?? {};
    if (form.grant_type !== 'client_credentials') {
      return { status: 400, body: { error: 'unsupported_grant_type' } };
    }
    if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) {
      return {
        status: 400,
        body: { error: 'invalid_client', error_description: 'The specified client credentials are invalid.' },
      };
    }
    const token = this.issueToken();
    return {
      body: {
        token_type: 'Bearer',
        expires_in: this.expiresIn,
        access_token: token,
        refresh_token: `refresh-${this.tokens}`,
      },
    };
  }

  private expandGroups(req: XapiRecorded): boolean | 'refused' {
    const expand = req.query.get('$expand');
    if (!expand) return false;
    if (!expand.startsWith('Groups')) return 'refused';
    return this.rejectExpand ? 'refused' : true;
  }

  private expandRefused(): XapiAnswer {
    return odataError(
      400,
      "The query specified in the URI is not valid. Property 'Rights' on type 'Pbx.UserGroup' is not a navigation property or complex property. Only navigation properties can be expanded.",
    );
  }

  /** Members is a navigation property: only with $expand=Members. */
  private withoutMembers(req: XapiRecorded, entity: Record<string, unknown>): Record<string, unknown> {
    if (req.query.get('$expand') === 'Members') return entity;
    const { Members: _members, ...rest } = entity;
    return rest;
  }

  private entity(
    entity: Record<string, unknown>,
    select: string | null,
    props: string[],
    type: string,
  ): XapiAnswer {
    const groups = entity.Groups;
    const picked = pick(entity, select, props, type);
    if (picked.error) return picked.error;
    const value = picked.value;
    if (groups !== undefined) value.Groups = groups;
    if (entity.Members !== undefined && select) value.Members = entity.Members;
    return { body: { '@odata.context': `${XAPI}/$metadata#${type}/$entity`, ...value } };
  }

  private collection(
    req: XapiRecorded,
    entities: Record<string, unknown>[],
    props: string[],
    type: string,
  ): XapiAnswer {
    const select = req.query.get('$select');
    if (req.query.has('$orderby') && req.query.get('$orderby') !== 'Number') {
      return unknownProperty(req.query.get('$orderby')!, type);
    }
    const top = Number(req.query.get('$top') ?? entities.length);
    const skip = this.ignoreSkip ? 0 : Number(req.query.get('$skip') ?? 0);
    const size = this.pageCap !== null ? Math.min(top, this.pageCap) : top;
    const value: Record<string, unknown>[] = [];
    for (const entity of entities.slice(skip, skip + size)) {
      const groups = entity.Groups;
      const members = entity.Members;
      const picked = pick(entity, select, props, type);
      if (picked.error) return picked.error;
      if (groups !== undefined) picked.value.Groups = groups;
      if (members !== undefined && select) picked.value.Members = members;
      value.push(picked.value);
    }
    const body: Record<string, unknown> = { '@odata.context': `${XAPI}/$metadata#${type}` };
    if (req.query.get('$count') === 'true' && !this.omitCount) body['@odata.count'] = entities.length;
    body.value = value;
    return { body };
  }

  private createUser(req: XapiRecorded): XapiAnswer {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (this.maxUsers !== null && this.users.size >= this.maxUsers) {
      return odataError(400, 'WARNINGS.LIMIT_REACHED', [
        { message: 'WARNINGS.LIMIT_REACHED', target: 'Number' },
      ]);
    }
    const first = typeof body.FirstName === 'string' ? body.FirstName : null;
    if (first && first.length > 50) {
      return odataError(400, 'FirstName:\nWARNINGS.LENGTH_NOT_MORE_50_CHARS', [
        { message: 'WARNINGS.LENGTH_NOT_MORE_50_CHARS', target: 'FirstName' },
      ]);
    }
    let number = typeof body.Number === 'string' ? body.Number : null;
    if (number !== null && this.numbers().has(number)) {
      return odataError(400, 'Number:\nWARNINGS.XAPI.ALREADY_IN_USE', [
        { message: 'WARNINGS.XAPI.ALREADY_IN_USE', target: 'Number' },
      ]);
    }
    if (number === null) {
      const taken = this.numbers();
      const start = 10 ** (this.enl - 1);
      for (let n = start; n < start * 10 && number === null; n++)
        if (!taken.has(String(n))) number = String(n);
    }
    const user = this.addUser({
      Number: number!,
      FirstName: first,
      LastName: typeof body.LastName === 'string' ? body.LastName : null,
      EmailAddress: typeof body.EmailAddress === 'string' ? body.EmailAddress : null,
      Mobile: typeof body.Mobile === 'string' ? body.Mobile : null,
      OutboundCallerID: typeof body.OutboundCallerID === 'string' ? body.OutboundCallerID : null,
      Language: typeof body.Language === 'string' ? body.Language : null,
    });
    // Like the real XAPI the 201 answer carries the whole entity, generated credentials included.
    return {
      status: 201,
      body: { '@odata.context': `${XAPI}/$metadata#Users/$entity`, ...this.userEntity(user, false) },
    };
  }

  private patchUser(user: MockUser, raw: unknown): XapiAnswer {
    const body = (raw ?? {}) as Record<string, unknown>;
    if ('Number' in body && body.Number !== user.Number) {
      return odataError(400, 'Number:\nWARNINGS.XAPI.FORBIDDEN_CHANGE', [
        { message: 'WARNINGS.XAPI.FORBIDDEN_CHANGE', target: 'Number' },
      ]);
    }
    for (const [key, value] of Object.entries(body)) {
      if (!USER_PROPS.includes(key)) return unknownProperty(key, 'Pbx.User');
      if (value === '') {
        return odataError(400, `${key}:\nWARNINGS.XAPI.CAN_NOT_BE_EMPTY_STRING`, [
          { message: 'WARNINGS.XAPI.CAN_NOT_BE_EMPTY_STRING', target: key },
        ]);
      }
      (user as unknown as Record<string, unknown>)[key] = value;
    }
    return { status: 204 };
  }
}

/** Starts the mock PBX on a free port. */
export async function startXapiMock(pbx: MockPbx) {
  const requests: XapiRecorded[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('latin1');
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const contentType = req.headers['content-type'] ?? null;
        let form: Record<string, string> | null = null;
        let body: unknown;
        if (contentType?.startsWith('multipart/form-data')) {
          const data = await new Request(url, {
            method: 'POST',
            headers: { 'content-type': contentType },
            body: Buffer.from(raw, 'latin1'),
          }).formData();
          form = {};
          for (const [key, value] of data.entries()) form[key] = String(value);
        } else if (raw) {
          try {
            body = JSON.parse(Buffer.from(raw, 'latin1').toString('utf8'));
          } catch {
            body = raw;
          }
        }
        const recorded: XapiRecorded = {
          method: req.method ?? 'GET',
          path: decodeURIComponent(url.pathname),
          url: req.url ?? '/',
          query: url.searchParams,
          headers: req.headers,
          contentType,
          raw,
          body,
          form,
        };
        requests.push(recorded);
        pbx.active++;
        pbx.peak = Math.max(pbx.peak, pbx.active);
        const delay = pbx.delayFor?.(recorded) ?? pbx.delayMs;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        pbx.active--;
        const answer = pbx.handle(recorded) ?? { status: 404, text: '' };
        res.statusCode = answer.status ?? 200;
        for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
        if (answer.text !== undefined) {
          res.end(answer.text);
        } else if (answer.body === undefined) {
          res.end();
        } else {
          res.setHeader('content-type', 'application/json; odata.metadata=minimal');
          res.end(JSON.stringify(answer.body));
        }
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Requests to the XAPI only (no token requests). */
    api: () => requests.filter((r) => r.path.startsWith(XAPI)),
    tokenRequests: () => requests.filter((r) => r.path === '/connect/token'),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type XapiMock = Awaited<ReturnType<typeof startXapiMock>>;
