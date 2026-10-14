import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { THREECX_SYSTEM_ID, ThreeCxAdapter } from '../src/providers/threecx/adapter';
import {
  ThreeCxClient,
  retryAfterMs,
  tokenLifetimeMs,
  type ThreeCxClientOptions,
} from '../src/providers/threecx/client';
import {
  RING_GROUP_SELECT,
  SYSTEM_STATUS_SELECT,
  TRUNK_SELECT,
  USER_EXPAND,
  USER_SELECT,
  assertXapiId,
  describeError,
  isoDate,
  mapWriteError,
  odataString,
  parseODataError,
  parseRingGroup,
  parseSystemInfo,
  parseTrunk,
  parseUser,
  redactSecrets,
  userCreatePayload,
  userPatchPayload,
  warningCodes,
} from '../src/providers/threecx/parse';
import type { PhoneUserInput, ThreeCxConfig } from '../src/providers/types';
import { CLIENT_ID, CLIENT_SECRET, MockPbx, SECRETS, startXapiMock, type XapiMock } from './threecx-mock';

let pbx: MockPbx;
let mock: XapiMock;
let clock: number;
const now = () => clock;

beforeEach(async () => {
  pbx = new MockPbx();
  mock = await startXapiMock(pbx);
  clock = Date.UTC(2026, 9, 14, 8, 0, 0);
});

afterEach(async () => {
  await mock.close();
});

function config(over: Partial<ThreeCxConfig> = {}): ThreeCxConfig {
  return { baseUrl: mock.url, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, ...over };
}

function adapter(options: ThreeCxClientOptions = {}, over: Partial<ThreeCxConfig> = {}) {
  return new ThreeCxAdapter(config(over), { now, ...options });
}

function client(options: ThreeCxClientOptions = {}, over: Partial<ThreeCxConfig> = {}) {
  return new ThreeCxClient(config(over), { now, ...options });
}

async function caught(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected a rejection');
}

function odata(status: number, message: string, details: { message: string; target?: string }[] = []) {
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

/** Requests of one path (decoded), in order. */
const calls = (method: string, path: string) =>
  mock.requests.filter((r) => r.method === method && r.path === `/xapi/v1${path}`);

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/AuthPassword|AccessPassword|VMPIN|LicenseKey/);
}

const INPUT: PhoneUserInput = {
  number: '105',
  firstName: 'Carla',
  lastName: 'Rossi',
  email: 'carla@muster.example',
  mobile: '+41791234567',
  outboundCallerId: null,
  language: 'de',
};

// ---------------------------------------------------------------------------

describe('3CX parsing', () => {
  const STATUS = {
    FQDN: 'muster.3cx.ch',
    Version: '20.0.10.1479',
    Activated: true,
    LicenseActive: true,
    ExpirationDate: '2027-01-31T00:00:00+01:00',
    MaintenanceExpiresAt: '0001-01-01T00:00:00.0000000+00:00',
    MaxSimCalls: 16,
    MaxUserExtensions: 20,
    UserExtensions: 7,
    ExtensionsTotal: 9,
    ExtensionsRegistered: 5,
    TrunksTotal: 2,
    TrunksRegistered: 1,
    CallsActive: 3,
    HasNotRunningServices: false,
    ProductCode: '3CXPSENT16',
    LicenseKey: 'LIC-KEY-1234-5678-ABCD',
    ResellerName: 'weblion GmbH',
  };

  it('reads system status and parameters into PhoneSystemInfo', () => {
    const info = parseSystemInfo(
      STATUS,
      { ENL: 3, License: { IsEnterprise: true, IsExtensionLimitEnforcementEnabled: false } },
      'https://muster.3cx.ch/',
    );
    expect(info).toEqual({
      fqdn: 'muster.3cx.ch',
      version: '20.0.10.1479',
      edition: 'enterprise',
      productCode: '3CXPSENT16',
      activated: true,
      licenseActive: true,
      licenseExpiresAt: '2027-01-30T23:00:00.000Z',
      maintenanceExpiresAt: null,
      maxSimCalls: 16,
      activeCalls: 3,
      users: 7,
      maxUsers: null,
      extensionsTotal: 9,
      extensionsRegistered: 5,
      trunksTotal: 2,
      trunksRegistered: 1,
      servicesDown: false,
      numberLength: 3,
      webClientUrl: 'https://muster.3cx.ch/webclient/',
    });
    expect(JSON.stringify(info)).not.toContain('LIC-KEY');
    expect(JSON.stringify(info)).not.toContain('weblion GmbH');
  });

  it('takes the user limit only when the license enforces it', () => {
    const enforced = { License: { IsExtensionLimitEnforcementEnabled: true } };
    expect(parseSystemInfo(STATUS, enforced, 'https://x').maxUsers).toBe(20);
    expect(parseSystemInfo({ ...STATUS, MaxUserExtensions: 0 }, enforced, 'https://x').maxUsers).toBeNull();
    expect(parseSystemInfo(STATUS, { License: {} }, 'https://x').maxUsers).toBeNull();
  });

  it('tells the editions apart', () => {
    const edition = (License: unknown) => parseSystemInfo({}, { License }, 'https://x').edition;
    expect(edition({ IsEnterprise: true, IsProfessional: true })).toBe('enterprise');
    expect(edition({ IsEnterprise: false, IsProfessional: true })).toBe('professional');
    expect(edition({ IsEnterprise: false, IsProfessional: false })).toBe('standard');
    expect(edition(undefined)).toBeNull();
  });

  it('accepts number lengths of 2 to 10 only and falls back to the parameters', () => {
    const length = (ENL: unknown) => parseSystemInfo({}, { ENL }, 'https://x').numberLength;
    expect(length(2)).toBe(2);
    expect(length(10)).toBe(10);
    expect(length(1)).toBeNull();
    expect(length(11)).toBeNull();
    expect(length(3.5)).toBeNull();
    expect(length(null)).toBeNull();

    const info = parseSystemInfo(
      {},
      { FQDN: 'p.3cx.ch', Version: '20.0.9', License: { MaxSimCalls: 8, ProductCode: 'PRO8' } },
      'https://p.3cx.ch',
    );
    expect(info).toMatchObject({ fqdn: 'p.3cx.ch', version: '20.0.9', maxSimCalls: 8, productCode: 'PRO8' });
    expect(info.activated).toBeNull();
    expect(info.users).toBeNull();
  });

  it('treats sentinel and invalid dates as not set', () => {
    expect(isoDate('0001-01-01T00:00:00.0000000+00:00')).toBeNull();
    expect(isoDate('1899-12-31T00:00:00Z')).toBeNull();
    expect(isoDate('soon')).toBeNull();
    expect(isoDate(null)).toBeNull();
    expect(isoDate('2026-12-01T12:00:00+01:00')).toBe('2026-12-01T11:00:00.000Z');
  });

  it('parses users with role, admin and system flags', () => {
    const raw = {
      Id: 7,
      Number: '101',
      FirstName: 'Ben',
      LastName: 'Beispiel',
      EmailAddress: 'Ben@Muster.Example',
      Mobile: '+41791234567',
      OutboundCallerID: '+41441234500',
      Language: 'DE',
      Enabled: true,
      IsRegistered: false,
      PrimaryGroupId: 1,
      Tags: [],
      Groups: [
        { GroupId: 2, Rights: { RoleName: 'users' } },
        { GroupId: 1, Rights: { RoleName: 'system_admins' } },
      ],
      AuthPassword: 'sip-auth-pass-5678',
      AccessPassword: 'web-client-pass-1234',
      VMPIN: '4711',
    };
    const user = parseUser(raw);
    expect(user).toEqual({
      id: '7',
      number: '101',
      firstName: 'Ben',
      lastName: 'Beispiel',
      displayName: 'Ben Beispiel',
      email: 'ben@muster.example',
      mobile: '+41791234567',
      outboundCallerId: '+41441234500',
      language: 'de',
      enabled: true,
      registered: false,
      role: 'system_admins',
      admin: true,
      system: false,
    });
    expectNoSecrets(user);

    // Without the primary group: the first group's role. admin follows every group.
    expect(parseUser({ ...raw, PrimaryGroupId: 9 })).toMatchObject({ role: 'users', admin: true });
    // An admin role in a group other than the primary one still makes an administrator.
    const secondary = parseUser({
      ...raw,
      PrimaryGroupId: 3,
      Groups: [
        { GroupId: 3, Rights: { RoleName: 'users' } },
        { GroupId: 1, Rights: { RoleName: 'system_owners' } },
      ],
    });
    expect(secondary).toMatchObject({ role: 'users', admin: true });
    expect(
      parseUser({ ...raw, Groups: [{ GroupId: 1, Rights: { RoleName: 'users' } }, { GroupId: 2 }] }),
    ).toMatchObject({ role: 'users', admin: false });
    expect(parseUser({ ...raw, Groups: undefined })).toMatchObject({ role: null, admin: false });
    expect(parseUser({ ...raw, DisplayName: 'Empfang' })?.displayName).toBe('Empfang');
    expect(parseUser({ ...raw, FirstName: null, LastName: null })?.displayName).toBeNull();
    expect(parseUser({ ...raw, Tags: ['FaxServer'] })?.system).toBe(true);
    expect(parseUser({ ...raw, Tags: ['WeakPass'] })?.system).toBe(false);
    expect(parseUser({ ...raw, AIAgent: true })?.system).toBe(true);
    expect(parseUser({ ...raw, Id: undefined })).toBeNull();
    expect(parseUser({ ...raw, Number: '' })).toBeNull();
    expect(parseUser('nope')).toBeNull();
  });

  it('parses ring groups and trunks without credentials', () => {
    const group = parseRingGroup({
      Id: 3,
      Number: '800',
      Name: 'Zentrale',
      RingStrategy: 'RingAll',
      RingTime: 20,
      Members: [
        { Id: 1, Number: '104', Name: 'Empfang', Tags: [] },
        { Id: 2, Name: 'no number' },
        { Id: 3, Number: '100', Name: null, Tags: [] },
      ],
    });
    expect(group).toEqual({
      id: '3',
      number: '800',
      name: 'Zentrale',
      strategy: 'ring_all',
      ringTimeSeconds: 20,
      members: [
        { number: '104', name: 'Empfang' },
        { number: '100', name: null },
      ],
    });
    const strategy = (RingStrategy: unknown) =>
      parseRingGroup({ Id: 1, Number: '1', RingStrategy })?.strategy;
    expect(strategy('Hunt')).toBe('hunt');
    expect(strategy('Paging')).toBe('paging');
    expect(strategy('Random')).toBeNull();
    expect(parseRingGroup({ Id: 1, Number: '1' })?.members).toEqual([]);

    const trunk = parseTrunk({
      Id: 900,
      Number: '10000',
      Gateway: { Name: 'Swisscom SIP', Host: 'sip.swisscom.ch', Port: 5060 },
      IsOnline: true,
      Direction: 'Both',
      ExternalNumber: '+41441234500',
      SimultaneousCalls: 8,
      DidNumbers: ['+41441234500', '+41441234501'],
      ConfigurationIssue: '',
      AuthID: 'trunk-auth-id-2468',
      AuthPassword: { Concealed: true, Value: 'trunk-sip-pass-7890' },
    });
    expect(trunk).toEqual({
      id: '900',
      number: '10000',
      name: 'Swisscom SIP',
      host: 'sip.swisscom.ch',
      online: true,
      direction: 'both',
      externalNumber: '+41441234500',
      simultaneousCalls: 8,
      didCount: 2,
      configurationIssue: null,
    });
    expectNoSecrets(trunk);
    expect(parseTrunk({ Id: 1, Number: '1', Direction: 'Sideways' })).toMatchObject({
      direction: null,
      name: null,
      didCount: 0,
    });
    expect(parseTrunk({ Id: 1, Number: '1', Direction: 'Inbound' })?.direction).toBe('inbound');
  });

  it('builds create and patch payloads with only the given keys', () => {
    expect(userCreatePayload(INPUT)).toEqual({
      Number: '105',
      FirstName: 'Carla',
      LastName: 'Rossi',
      EmailAddress: 'carla@muster.example',
      Mobile: '+41791234567',
      Language: 'de',
    });
    expect(
      userCreatePayload({
        firstName: 'Empfang',
        lastName: null,
        email: 'empfang@muster.example',
        mobile: null,
        outboundCallerId: null,
        language: null,
      }),
    ).toEqual({ FirstName: 'Empfang', EmailAddress: 'empfang@muster.example' });

    expect(userPatchPayload({ lastName: null, language: 'fr', outboundCallerId: '+41441234500' })).toEqual({
      LastName: null,
      Language: 'fr',
      OutboundCallerID: '+41441234500',
    });
    expect(userPatchPayload({ email: 'neu@muster.example', firstName: 'Anna' })).toEqual({
      EmailAddress: 'neu@muster.example',
      FirstName: 'Anna',
    });
    expect(userPatchPayload({})).toEqual({});
    expect(userPatchPayload({ firstName: undefined })).toEqual({});
  });

  it('quotes OData strings and rejects ids that are no int32', () => {
    expect(odataString("O'Brien")).toBe("'O''Brien'");
    expect(odataString('101')).toBe("'101'");
    expect(assertXapiId('42', 'phone user')).toBe(42);
    expect(assertXapiId('2147483647', 'phone user')).toBe(2147483647);
    for (const bad of ['2147483648', '-1', '1.5', 'abc', '', '12345678901', '1)', "1'"]) {
      expect(() => assertXapiId(bad, 'phone user')).toThrow(ProviderError);
    }
    try {
      assertXapiId('x', 'ring group');
    } catch (err) {
      expect((err as ProviderError).statusCode).toBe(404);
      expect((err as ProviderError).message).toBe('3CX: ring group x not found');
    }
  });

  it('redacts secrets at any depth', () => {
    const redacted = redactSecrets({
      value: [
        {
          Id: 1,
          FirstName: 'Anna',
          AccessPassword: 'web-client-pass-1234',
          DeskphonePassword: 'desk-phone-pass-3456',
          VMPIN: '4711',
          AuthID: 'sip-auth-id-9012',
          AuthPassword: { Concealed: true, Value: 'sip-auth-pass-5678' },
          Phones: [
            { MacAddress: '000b82123456', ProvisioningLinkExt: 'https://pbx.example/provisioning/abcdef' },
          ],
          PinProtected: true,
        },
      ],
      LicenseKey: 'LIC-KEY-1234-5678-ABCD',
      Ticket: { Ticket: 'one-time' },
      ClientSecret: 'x',
      Empty: '',
    });
    expectNoSecrets(JSON.stringify(redacted).replace(/"[A-Za-z]*(Password|PIN|Key)":/g, '"x":'));
    expect(redacted).toEqual({
      value: [
        {
          Id: 1,
          FirstName: 'Anna',
          AccessPassword: '[redacted]',
          DeskphonePassword: '[redacted]',
          VMPIN: '[redacted]',
          AuthID: '[redacted]',
          AuthPassword: '[redacted]',
          Phones: [{ MacAddress: '000b82123456', ProvisioningLinkExt: '[redacted]' }],
          PinProtected: true,
        },
      ],
      LicenseKey: '[redacted]',
      Ticket: '[redacted]',
      ClientSecret: '[redacted]',
      Empty: '',
    });
  });

  it('finds WARNINGS codes in message, code and details and describes errors', () => {
    const body = {
      error: {
        code: 'WARNINGS.XAPI.INVALID_LICENSE_TYPE',
        message: 'Number:\nWARNINGS.XAPI.ALREADY_IN_USE.',
        target: null,
        details: [
          { code: '', message: 'WARNINGS.LENGTH_NOT_MORE_50_CHARS', target: 'FirstName' },
          { code: 'x', message: 'WARNINGS.XAPI.REQUIRED', target: 'EmailAddress' },
        ],
      },
    };
    const error = parseODataError(body);
    expect(warningCodes(error).sort()).toEqual([
      'WARNINGS.LENGTH_NOT_MORE_50_CHARS',
      'WARNINGS.XAPI.ALREADY_IN_USE',
      'WARNINGS.XAPI.INVALID_LICENSE_TYPE',
      'WARNINGS.XAPI.REQUIRED',
    ]);
    expect(warningCodes(null)).toEqual([]);
    expect(describeError(400, body, 'create user 105')).toBe(
      'create user 105 failed: Number: WARNINGS.XAPI.ALREADY_IN_USE. ' +
        '(FirstName: WARNINGS.LENGTH_NOT_MORE_50_CHARS; EmailAddress: WARNINGS.XAPI.REQUIRED) (HTTP 400)',
    );
    expect(describeError(502, '<html><body>Bad Gateway</body></html>', 'list users')).toBe(
      'list users failed: no XAPI answer, check the address (HTTP 502)',
    );
    expect(describeError(500, 'Internal error in the PBX', undefined)).toBe(
      'request failed: Internal error in the PBX (HTTP 500)',
    );
    expect(describeError(403, '', 'list users')).toContain('System Admin role in the default group');
    expect(describeError(403, '', 'list users')).toContain('Enterprise license');
    expect(describeError(503, '', 'list users')).toContain('starting or updating');
    expect(describeError(404, '', 'list users', { collection: true })).toContain('runs 3CX V20');
    expect(describeError(404, '', 'read user 4')).not.toContain('V20');
  });

  it('maps write errors to the contract errors', () => {
    const fail = (status: number, message: string, details: { message: string; target?: string }[] = []) => {
      const answer = odata(status, message, details);
      return new ProviderError('3CX', describeError(status, answer.body, 'x'), status, {
        odata: parseODataError(answer.body),
      });
    };
    const duplicate = fail(400, 'Number:\nWARNINGS.XAPI.DUPLICATE', [
      { message: 'WARNINGS.XAPI.DUPLICATE', target: 'Number' },
    ]);
    expect(mapWriteError(duplicate, { what: 'phone user', number: '101' })).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: 'The extension number 101 is in use at the phone system',
    });
    const limit = fail(400, 'WARNINGS.LIMIT_REACHED');
    expect(mapWriteError(limit, { what: 'phone user', creating: true })).toMatchObject({
      statusCode: 409,
      code: 'phone_user_limit',
    });
    const fax = fail(400, 'WARNINGS.FAX_SERVER_CANNOT_BE_DELETED');
    expect(mapWriteError(fax, { what: 'phone user 3' })).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: '3CX: WARNINGS.FAX_SERVER_CANNOT_BE_DELETED',
    });
    const own = fail(400, 'WARNINGS.XAPI.CANNOT_CLEAR_OWN_EXTENSION');
    expect(mapWriteError(own, { what: 'phone user 3' })).toMatchObject({ statusCode: 409 });
    const gone = fail(404, 'WARNINGS.XAPI.NOT_FOUND');
    const mappedGone = mapWriteError(gone, { what: 'phone user 9' }) as ProviderError;
    expect(mappedGone).toBeInstanceOf(ProviderError);
    expect(mappedGone.statusCode).toBe(404);
    expect(mappedGone.message).toBe('3CX: phone user 9 not found');
    const member = fail(400, 'Members:\nWARNINGS.XAPI.NOT_FOUND', [
      { message: 'WARNINGS.XAPI.NOT_FOUND', target: 'Members' },
    ]);
    expect(mapWriteError(member, { what: 'ring group 800' })).toMatchObject({
      statusCode: 400,
      code: 'bad_request',
      details: { target: 'Members', code: 'WARNINGS.XAPI.NOT_FOUND' },
    });
    const invalid = fail(400, 'Language:\nWARNINGS.XAPI.OUT_OF_THE_RANGE', [
      { message: 'WARNINGS.XAPI.OUT_OF_THE_RANGE', target: 'Language' },
    ]);
    expect(mapWriteError(invalid, { what: 'phone user 3' })).toMatchObject({
      statusCode: 400,
      message: '3CX: Language: WARNINGS.XAPI.OUT_OF_THE_RANGE (Language: WARNINGS.XAPI.OUT_OF_THE_RANGE)',
      details: { target: 'Language', code: 'WARNINGS.XAPI.OUT_OF_THE_RANGE' },
    });
    const plain409 = fail(409, 'Conflict');
    expect(mapWriteError(plain409, { what: 'phone user', number: '105', creating: true })).toMatchObject({
      statusCode: 409,
      message: 'The extension number 105 is in use at the phone system',
    });
    expect(mapWriteError(plain409, { what: 'phone user 3' })).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: '3CX: Conflict',
    });
    const broken = fail(500, 'boom');
    expect(mapWriteError(broken, { what: 'phone user 3' })).toBe(broken);
    const network = new ProviderError('3CX', 'request failed: ECONNREFUSED');
    expect(mapWriteError(network, { what: 'phone user 3' })).toBe(network);
  });
});

// ---------------------------------------------------------------------------

describe('3CX client', () => {
  it('signs in with multipart client credentials at /connect/token and sends a bearer token', async () => {
    const c = client();
    const status = await c.request<Record<string, unknown>>('GET', '/SystemStatus', {
      query: { $select: 'FQDN,Version' },
    });
    expect(status).toMatchObject({ FQDN: 'muster.3cx.ch', Version: '20.0.10.1479' });
    expect(status).not.toHaveProperty('LicenseKey');

    const [token, api] = mock.requests;
    expect(token!.method).toBe('POST');
    expect(token!.path).toBe('/connect/token');
    expect(token!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(token!.form).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    });
    expect(api!.path).toBe('/xapi/v1/SystemStatus');
    expect(api!.query.get('$select')).toBe('FQDN,Version');
    expect(api!.headers.authorization).toBe(`Bearer ${pbx.currentToken}`);
    expect(api!.headers.accept).toBe('application/json');
    expect(mock.requests.some((r) => r.path.startsWith('/xapi/v1/connect'))).toBe(false);
  });

  it('reuses the token until 60 s before it expires', async () => {
    const c = client();
    await c.request('GET', '/SystemStatus');
    clock += 3539_000;
    await c.request('GET', '/SystemStatus');
    expect(mock.tokenRequests()).toHaveLength(1);
    clock += 1_000;
    await c.request('GET', '/SystemStatus');
    expect(mock.tokenRequests()).toHaveLength(2);
    expect(mock.api().at(-1)!.headers.authorization).toBe(`Bearer ${pbx.currentToken}`);

    expect(tokenLifetimeMs(3600)).toBe(3540_000);
    expect(tokenLifetimeMs(100)).toBe(50_000);
    expect(tokenLifetimeMs(null)).toBe(300_000);
    expect(tokenLifetimeMs('later')).toBe(300_000);
  });

  it('shares one token request between parallel calls', async () => {
    const c = client();
    await Promise.all(Array.from({ length: 10 }, () => c.request('GET', '/SystemStatus')));
    expect(mock.tokenRequests()).toHaveLength(1);
    expect(mock.api()).toHaveLength(10);
  });

  it('gets a new token once on a 401 and repeats the request', async () => {
    const c = client();
    await c.request('GET', '/SystemStatus');
    pbx.issueToken(); // another program signs in with the same API client
    const status = await c.request<Record<string, unknown>>('GET', '/SystemStatus', {
      query: { $select: 'FQDN' },
    });
    expect(status.FQDN).toBe('muster.3cx.ch');
    expect(mock.tokenRequests()).toHaveLength(2);
    expect(mock.api()).toHaveLength(3);

    pbx.override = (req) => (req.path.startsWith('/xapi/') ? { status: 401, text: '' } : undefined);
    const err = await caught(c.request('GET', '/Users', { action: 'list users' }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(502);
    expect((err as ProviderError).upstreamStatus).toBe(401);
    expect(err.message).toBe(
      '3CX: list users failed: the PBX refused the access token twice. Another program may use the same ' +
        'API client (3CX allows one valid token per client), or the client was removed',
    );
    expect(mock.tokenRequests()).toHaveLength(3);
    expect(mock.api()).toHaveLength(5);
  });

  it('renews a refused token only once when several requests used it', async () => {
    const c = client();
    await c.request('GET', '/SystemStatus');
    const old = pbx.currentToken!;
    pbx.issueToken(); // another program takes the token
    // The trunk request with the old token is answered (401) after the renewal is done.
    pbx.delayFor = (req) =>
      req.path === '/xapi/v1/Trunks' && req.headers.authorization === `Bearer ${old}` ? 80 : 0;
    await Promise.all([c.request('GET', '/SystemStatus'), c.request('GET', '/Trunks')]);
    expect(mock.tokenRequests()).toHaveLength(2);
    const trunks = calls('GET', '/Trunks');
    expect(trunks).toHaveLength(2);
    expect(trunks[1]!.headers.authorization).toBe(`Bearer ${pbx.currentToken}`);
  });

  it('refuses a success answer that is no JSON', async () => {
    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus'
        ? { status: 200, text: '<!doctype html><title>3CX</title>' }
        : undefined;
    const err = await caught(adapter().getPhoneSystem(THREECX_SYSTEM_ID));
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe(
      '3CX: read the system status failed: the PBX answered without JSON. Check the address and that the ' +
        'XAPI is available (3CX Enterprise license, "XAPI Access Enabled" for the API client)',
    );
    pbx.override = (req) => (req.path === '/xapi/v1/SystemStatus' ? { body: [1, 2] } : undefined);
    const odd = await caught(adapter().getPhoneSystem(THREECX_SYSTEM_ID));
    expect(odd.message).toBe('3CX: read the system status failed: unexpected answer for /SystemStatus');
  });

  it('fails fast for 60 s after a refused sign-in, then tries again', async () => {
    const c = client({}, { clientSecret: 'not-the-right-secret' });
    const first = await caught(c.request('GET', '/SystemStatus'));
    expect(first.message).toBe(
      '3CX: sign-in at the phone system failed: The specified client credentials are invalid. Check the ' +
        'client ID and API key (3CX Admin > Integrations > API) and that "XAPI Access Enabled" is on',
    );
    // Not an XAPI answer: no upstreamStatus, the token endpoint's status in details.
    expect((first as ProviderError).upstreamStatus).toBeUndefined();
    expect(first.details).toEqual({ signInStatus: 400 });
    expect(first.statusCode).toBe(502);

    const second = await caught(c.request('GET', '/SystemStatus'));
    expect(second.message).toContain('(failed recently, next attempt in 60 s)');
    clock += 59_000;
    const third = await caught(c.request('GET', '/SystemStatus'));
    expect(third.message).toContain('next attempt in 1 s');
    expect(mock.tokenRequests()).toHaveLength(1);
    expect(mock.api()).toHaveLength(0);

    clock += 1_000;
    await caught(c.request('GET', '/SystemStatus'));
    expect(mock.tokenRequests()).toHaveLength(2);
  });

  it('does not keep network failures and server errors of the sign-in', async () => {
    let failures = 1;
    pbx.override = (req) =>
      req.path === '/connect/token' && failures-- > 0
        ? { status: 503, text: 'Service Unavailable' }
        : undefined;
    const c = client();
    const err = await caught(c.request('GET', '/SystemStatus'));
    expect(err.message).toContain('sign-in at the phone system failed: HTTP 503');
    await c.request('GET', '/SystemStatus');
    expect(mock.tokenRequests()).toHaveLength(2);

    const closed = new ThreeCxClient({ ...config(), baseUrl: 'http://127.0.0.1:1' }, { now });
    const network = await caught(closed.request('GET', '/SystemStatus'));
    expect(network.message).toMatch(/^3CX: sign-in at the phone system failed: /);
    const again = await caught(closed.request('GET', '/SystemStatus'));
    expect(again.message).not.toContain('failed recently');
  });

  it('never leaks the client secret or the token in errors, even when the PBX echoes them', async () => {
    pbx.override = (req) =>
      req.path === '/connect/token'
        ? {
            status: 401,
            body: { error: 'invalid_client', error_description: `unknown secret ${req.form?.client_secret}` },
          }
        : undefined;
    const signIn = await caught(client().request('GET', '/SystemStatus'));
    expect(signIn.message).toContain('unknown secret [redacted]');
    expect(signIn.message).not.toContain(CLIENT_SECRET);

    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus'
        ? odata(400, `bad header ${req.headers.authorization} for ${CLIENT_SECRET}`, [
            { message: `token ${String(req.headers.authorization).slice(7)}`, target: 'Authorization' },
          ])
        : undefined;
    const c = client();
    const err = await caught(c.request('GET', '/SystemStatus'));
    const token = pbx.currentToken!;
    expect(err.message).toContain('bad header Bearer [redacted] for [redacted]');
    expect(err.message).not.toContain(token);
    expect(err.message).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(err.details)).not.toContain(token);
    expect(JSON.stringify(err.details)).not.toContain(CLIENT_SECRET);

    const raw = await c.raw('GET', '/SystemStatus');
    expect(JSON.stringify(raw.body)).not.toContain(token);
    expect(JSON.stringify(raw.body)).not.toContain(CLIENT_SECRET);
  });

  it('does not follow redirects', async () => {
    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus'
        ? { status: 302, headers: { location: `${mock.url}/stolen` }, text: '' }
        : undefined;
    const err = await caught(client().request('GET', '/SystemStatus', { action: 'read the system status' }));
    expect(err.message).toContain('read the system status failed');
    expect(err.message).toContain('The PBX redirects, check the address (https, port)');
    expect(mock.requests.some((r) => r.path === '/stolen')).toBe(false);

    pbx.override = (req) =>
      req.path === '/connect/token'
        ? { status: 307, headers: { location: `${mock.url}/stolen-token` }, text: '' }
        : undefined;
    const signIn = await caught(client().request('GET', '/SystemStatus'));
    expect(signIn.message).toContain('the PBX redirects, check the address (https, port)');
    expect(mock.requests.some((r) => r.path === '/stolen-token')).toBe(false);
  });

  it('retries a 429 with a short Retry-After once and fails on a long one', async () => {
    let throttled = 1;
    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus' && throttled-- > 0
        ? { status: 429, headers: { 'retry-after': '1' }, text: '' }
        : undefined;
    const c = client();
    const started = Date.now();
    await c.request('GET', '/SystemStatus');
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(calls('GET', '/SystemStatus')).toHaveLength(2);

    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus'
        ? { status: 429, headers: { 'retry-after': '30' }, text: '' }
        : undefined;
    const err = await caught(c.request('GET', '/SystemStatus', { action: 'read the system status' }));
    expect(err.message).toContain('The phone system throttles requests, try again later');
    expect(calls('GET', '/SystemStatus')).toHaveLength(3);

    expect(retryAfterMs('2', 0)).toBe(2000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null, 0)).toBeNull();
    expect(retryAfterMs('soon', 0)).toBeNull();
  });

  it('keeps at most 4 requests in flight', async () => {
    const c = client();
    await c.request('GET', '/SystemStatus');
    pbx.peak = 0;
    pbx.delayMs = 40;
    await Promise.all(Array.from({ length: 10 }, () => c.request('GET', '/SystemStatus')));
    expect(pbx.peak).toBe(4);
  });

  it('pages with $top=100, $skip and $count=true until @odata.count', async () => {
    for (let n = 103; n < 330; n++) pbx.addUser({ Number: String(n) });
    const c = client();
    const users = await c.list('/Users', { $select: 'Id,Number', $orderby: 'Number' }, 'list users');
    expect(users).toHaveLength(230);
    expect(new Set(users.map((u) => u.Id)).size).toBe(230);
    expect(
      calls('GET', '/Users').map((r) => [r.query.get('$top'), r.query.get('$skip'), r.query.get('$count')]),
    ).toEqual([
      ['100', '0', 'true'],
      ['100', '100', 'true'],
      ['100', '200', 'true'],
    ]);
    expect(calls('GET', '/Users')[0]!.query.get('$orderby')).toBe('Number');
  });

  it('stops on an empty page without a count and keeps going when the PBX caps pages', async () => {
    for (let n = 103; n < 330; n++) pbx.addUser({ Number: String(n) });
    pbx.omitCount = true;
    const users = await client().list('/Users', { $select: 'Id' }, 'list users');
    expect(users).toHaveLength(230);
    expect(calls('GET', '/Users').map((r) => r.query.get('$skip'))).toEqual(['0', '100', '200', '230']);

    mock.requests.length = 0;
    pbx.omitCount = false;
    pbx.pageCap = 40;
    const capped = await client().list('/Users', { $select: 'Id' }, 'list users');
    expect(new Set(capped.map((u) => u.Id)).size).toBe(230);
    expect(calls('GET', '/Users')).toHaveLength(6);
  });

  it('fails when the PBX ignores $skip or answers something else', async () => {
    for (let n = 103; n < 210; n++) pbx.addUser({ Number: String(n) });
    pbx.ignoreSkip = true;
    const err = await caught(client().list('/Users', { $select: 'Id' }, 'list users'));
    expect(err.message).toBe('3CX: list users failed: the PBX ignores $skip (/Users)');

    pbx.ignoreSkip = false;
    pbx.override = (req) => (req.path === '/xapi/v1/Users' ? { body: { hello: 'world' } } : undefined);
    const odd = await caught(client().list('/Users', { $select: 'Id' }, 'list users'));
    expect(odd.message).toBe('3CX: list users failed: unexpected answer for /Users');
  });

  it('maps 403 to the role hint, 503 to the update hint and unknown collections to the V20 hint', async () => {
    pbx.override = (req) => (req.path === '/xapi/v1/Users' ? odata(403, 'Access denied') : undefined);
    const forbidden = await caught(client().list('/Users', {}, 'list users'));
    expect(forbidden.message).toBe(
      '3CX: list users failed: Access denied (HTTP 403). The API client needs the System Admin role in the ' +
        'default group (3CX Admin > Integrations > API); the XAPI needs an Enterprise license',
    );
    expect(forbidden.statusCode).toBe(502);

    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus' ? { status: 503, text: '<html>Updating</html>' } : undefined;
    const updating = await caught(
      client().request('GET', '/SystemStatus', { action: 'read the system status' }),
    );
    expect(updating.message).toBe(
      '3CX: read the system status failed: no XAPI answer, check the address (HTTP 503). ' +
        'The phone system is starting or updating',
    );

    pbx.override = null;
    const unknown = await caught(client().list('/Departments', {}, 'list departments'));
    expect(unknown.statusCode).toBe(404);
    expect(unknown.message).toContain('check that it runs 3CX V20');
  });
});

// ---------------------------------------------------------------------------

describe('3CX adapter', () => {
  it('tests the connection with 6 requests', async () => {
    expect(await adapter().testConnection()).toEqual({
      version: '20.0.10.1479',
      fqdn: 'muster.3cx.ch',
      edition: 'enterprise',
      users: 3,
      numberLength: 3,
      licenseActive: true,
    });
    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /connect/token',
      'GET /xapi/v1/Defs/Pbx.GetSystemParameters()',
      'GET /xapi/v1/SystemStatus',
      'GET /xapi/v1/Users',
      'GET /xapi/v1/RingGroups',
      'GET /xapi/v1/Trunks',
    ]);
    expect(calls('GET', '/SystemStatus')[0]!.query.get('$select')).toBe(
      'FQDN,Version,UserExtensions,TrunksTotal,LicenseActive',
    );
  });

  it('never takes a failed sign-in for an XAPI answer', async () => {
    const signInFailed = /^3CX: sign-in at the phone system failed: .*Check the client ID and API key/;
    // A wrong secret (OAuth answers 400 invalid_client) is no invalid user.
    const wrong = adapter({}, { clientSecret: 'not-the-right-secret' });
    const create = await caught(wrong.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: undefined }));
    expect(create.statusCode).toBe(502);
    expect(create.code).toBe('provider_error');
    expect(create.message).toMatch(signInFailed);
    const remove = await caught(wrong.deletePhoneUser(THREECX_SYSTEM_ID, '2'));
    expect(remove.statusCode).toBe(502);
    expect(remove.message).toMatch(signInFailed);
    expect(mock.api()).toHaveLength(0);

    // A token endpoint that answers 404 (wrong address) is no unknown user or ring group.
    pbx.override = (req) => (req.path === '/connect/token' ? { status: 404, text: 'Not Found' } : undefined);
    const user = await caught(adapter().getPhoneUser(THREECX_SYSTEM_ID, '2'));
    expect(user.statusCode).toBe(502);
    expect(user.message).toMatch(signInFailed);
    expect(user.message).toContain('HTTP 404');
    const group = await caught(adapter().addPhoneRingGroupMember(THREECX_SYSTEM_ID, '1', '101'));
    expect(group.statusCode).toBe(502);
    expect(group.message).toMatch(signInFailed);
    // The number lookup does not read the failure as a free number (system parameters cached,
    // the token expired).
    pbx.override = null;
    pbx.expiresIn = 100;
    const cached = adapter();
    await cached.getPhoneSystem(THREECX_SYSTEM_ID);
    clock += 60_000;
    pbx.override = (req) => (req.path === '/connect/token' ? { status: 404, text: 'Not Found' } : undefined);
    const taken = await caught(cached.createPhoneUser(THREECX_SYSTEM_ID, INPUT));
    expect(taken.statusCode).toBe(502);
    expect(taken.message).toMatch(signInFailed);
    expect(calls('POST', '/Users')).toHaveLength(0);

    // A 403 of the token endpoint is no missing role.
    pbx.override = (req) => (req.path === '/connect/token' ? { status: 403, text: '' } : undefined);
    const test = await caught(adapter().testConnection());
    expect(test.statusCode).toBe(502);
    expect(test.message).toMatch(signInFailed);
    expect(test.message).not.toContain('may not read');
  });

  it('names the area a probe may not read', async () => {
    pbx.override = (req) => (req.path === '/xapi/v1/RingGroups' ? odata(403, 'Forbidden') : undefined);
    const err = await caught(adapter().testConnection());
    expect(err.message).toBe(
      '3CX: the API client may not read ring groups: give it the System Admin role in the default group ' +
        '(3CX Admin > Integrations > API); the XAPI needs an Enterprise license',
    );
    pbx.override = (req) => (req.path === '/xapi/v1/Trunks' ? odata(403, 'Forbidden') : undefined);
    expect((await caught(adapter().testConnection())).message).toContain('may not read trunks');
    pbx.override = (req) => (req.path === '/xapi/v1/Users' ? odata(403, 'Forbidden') : undefined);
    expect((await caught(adapter().testConnection())).message).toContain('may not read users');
  });

  it('has no servers and refuses unknown phone system ids', async () => {
    const a = adapter();
    expect(a.capabilities()).toEqual([]);
    expect(a.powerActions()).toEqual([]);
    expect(await a.listServers()).toEqual([]);
    const server = await caught(a.getServer({ externalId: 'x', kind: 'vm', node: null, meta: {} }));
    expect(server.statusCode).toBe(404);

    const unknown = [
      a.getPhoneSystem('demo-pbx-zh'),
      a.listPhoneUsers('nope'),
      a.getPhoneUser('nope', '1'),
      a.nextPhoneNumber('nope'),
      a.createPhoneUser('nope', INPUT),
      a.updatePhoneUser('nope', '1', {}),
      a.deletePhoneUser('nope', '1'),
      a.sendPhoneWelcome('nope', '1'),
      a.listPhoneRingGroups('nope'),
      a.addPhoneRingGroupMember('nope', '800', '100'),
      a.removePhoneRingGroupMember('nope', '800', '100'),
      a.listPhoneTrunks('nope'),
    ];
    for (const call of unknown) {
      const err = await caught(call);
      expect(err.statusCode).toBe(404);
      expect(err.message).toMatch(/^3CX: unknown phone system "/);
    }
    expect(mock.requests).toHaveLength(0);
  });

  it('reads the phone system with the exact $select and caches it 30 s', async () => {
    const a = adapter();
    const [system] = await a.listPhoneSystems();
    expect(system).toMatchObject({ externalId: THREECX_SYSTEM_ID, name: 'muster.3cx.ch' });
    expect(system!.info).toMatchObject({
      version: '20.0.10.1479',
      edition: 'enterprise',
      users: 3,
      maxUsers: null,
      activeCalls: 3,
      maxSimCalls: 16,
      numberLength: 3,
      trunksTotal: 2,
      trunksRegistered: 1,
      licenseExpiresAt: '2027-01-30T23:00:00.000Z',
      maintenanceExpiresAt: null,
      webClientUrl: `${mock.url}/webclient/`,
    });
    expectNoSecrets(system);
    const select = calls('GET', '/SystemStatus')[0]!.query.get('$select')!;
    expect(select).toBe(SYSTEM_STATUS_SELECT);
    expect(select).not.toContain('LicenseKey');

    await a.getPhoneSystem(THREECX_SYSTEM_ID);
    clock += 29_000;
    await a.getPhoneSystem(THREECX_SYSTEM_ID);
    expect(calls('GET', '/SystemStatus')).toHaveLength(1);
    clock += 1_000;
    await a.getPhoneSystem(THREECX_SYSTEM_ID);
    expect(calls('GET', '/SystemStatus')).toHaveLength(2);
    expect(calls('GET', '/Defs/Pbx.GetSystemParameters()')).toHaveLength(1);
    clock += 10 * 60_000;
    await a.getPhoneSystem(THREECX_SYSTEM_ID);
    expect(calls('GET', '/Defs/Pbx.GetSystemParameters()')).toHaveLength(2);
  });

  it('names the phone system after the address when the PBX reports no FQDN', async () => {
    pbx.override = (req) =>
      req.path === '/xapi/v1/SystemStatus' ? { body: { Version: '20.0.10.1479' } } : undefined;
    const original = pbx.handle;
    const withoutFqdn = (req: Parameters<typeof original>[0]) => {
      const answer = original(req);
      if (req.path === '/xapi/v1/Defs/Pbx.GetSystemParameters()' && answer?.body) {
        const { FQDN: _fqdn, ...rest } = answer.body as Record<string, unknown>;
        return { ...answer, body: rest };
      }
      return answer;
    };
    pbx.handle = withoutFqdn;
    const system = await adapter().getPhoneSystem(THREECX_SYSTEM_ID);
    expect(system.name).toBe('127.0.0.1');
  });

  it('summarizes the phone system for the provider page', async () => {
    const overview = await adapter().overview();
    expect(overview.version).toBe('20.0.10.1479');
    expect(overview.facts).toEqual([
      { label: 'Version', value: '20.0.10.1479' },
      { label: 'FQDN', value: 'muster.3cx.ch' },
      { label: 'Edition', value: 'enterprise, 3CXPSENT16' },
      { label: 'License valid until', value: '2027-01-31' },
      { label: 'Maintenance until', value: '–' },
      { label: 'Simultaneous calls', value: '3 / 16' },
      { label: 'Users', value: '3' },
      { label: 'Extensions registered', value: '0 / 4' },
      { label: 'Trunks registered', value: '1 / 2' },
      { label: 'Number length', value: '3' },
      { label: 'Web client', value: `${mock.url}/webclient/` },
    ]);
  });

  it('lists users in pages with $select, $expand and $orderby', async () => {
    pbx.users.get(2)!.groups = [
      { GroupId: 5, RoleName: 'users' },
      { GroupId: 1, RoleName: 'group_owners' },
    ];
    pbx.addUser({ Number: '099', FirstName: 'KI', AIAgent: true, Tags: ['AI'] });
    const users = await adapter().listPhoneUsers(THREECX_SYSTEM_ID);
    expect(users.map((u) => [u.number, u.role, u.admin, u.system])).toEqual([
      ['099', 'users', false, true],
      ['100', 'system_owners', true, false],
      ['101', 'group_owners', false, false],
      ['102', 'users', false, true],
    ]);
    expect(users[2]).toMatchObject({ email: 'ben@muster.example', displayName: 'Ben Beispiel' });
    expectNoSecrets(users);

    const [request] = calls('GET', '/Users');
    expect(request!.query.get('$select')).toBe(USER_SELECT);
    expect(request!.query.get('$expand')).toBe(USER_EXPAND);
    expect(request!.query.get('$orderby')).toBe('Number');
    expect(request!.query.get('$top')).toBe('100');
    expect(request!.query.get('$skip')).toBe('0');
    expect(request!.query.get('$count')).toBe('true');
    expect(request!.url).toContain('%24select=Id%2CNumber');
  });

  it('falls back to no $expand after a 400 and remembers it', async () => {
    pbx.rejectExpand = true;
    const a = adapter();
    const users = await a.listPhoneUsers(THREECX_SYSTEM_ID);
    expect(users).toHaveLength(3);
    expect(users.every((u) => u.role === null && u.admin === false)).toBe(true);
    expect(calls('GET', '/Users').map((r) => r.query.get('$expand'))).toEqual([USER_EXPAND, null]);

    const anna = await a.getPhoneUser(THREECX_SYSTEM_ID, '1');
    expect(anna.role).toBeNull();
    expect(calls('GET', '/Users(1)')[0]!.query.has('$expand')).toBe(false);
    clock += 20_000;
    await a.listPhoneUsers(THREECX_SYSTEM_ID);
    expect(calls('GET', '/Users').map((r) => r.query.get('$expand'))).toEqual([USER_EXPAND, null, null]);

    // Other 400s are not taken for a refused $expand.
    pbx.rejectExpand = false;
    pbx.override = (req) => (req.path === '/xapi/v1/Users' ? odata(400, 'Invalid $top') : undefined);
    const b = adapter();
    expect((await caught(b.listPhoneUsers(THREECX_SYSTEM_ID))).statusCode).toBe(502);
  });

  it('caches the user list 20 s and clears it after create, update and delete', async () => {
    const a = adapter();
    const list = () => a.listPhoneUsers(THREECX_SYSTEM_ID);
    await list();
    clock += 19_000;
    await list();
    expect(calls('GET', '/Users')).toHaveLength(1);
    clock += 1_000;
    await list();
    expect(calls('GET', '/Users')).toHaveLength(2);

    await a.createPhoneUser(THREECX_SYSTEM_ID, INPUT);
    expect((await list()).map((u) => u.number)).toContain('105');
    expect(calls('GET', '/Users')).toHaveLength(3);

    await a.updatePhoneUser(THREECX_SYSTEM_ID, '4', { firstName: 'Carla Maria' });
    expect((await list()).find((u) => u.number === '105')?.firstName).toBe('Carla Maria');
    expect(calls('GET', '/Users')).toHaveLength(4);

    await a.deletePhoneUser(THREECX_SYSTEM_ID, '4');
    expect((await list()).map((u) => u.number)).not.toContain('105');
    expect(calls('GET', '/Users')).toHaveLength(5);
  });

  it('proposes the next free number', async () => {
    expect(await adapter().nextPhoneNumber(THREECX_SYSTEM_ID)).toBe('103');
    pbx.override = (req) =>
      req.path === '/xapi/v1/Users/Pbx.GetFirstAvailableExtensionNumber()'
        ? { body: { Number: null } }
        : undefined;
    expect(await adapter().nextPhoneNumber(THREECX_SYSTEM_ID)).toBeNull();
  });

  it('creates a user with the payload of the input and reads it back', async () => {
    const user = await adapter().createPhoneUser(THREECX_SYSTEM_ID, INPUT);
    expect(user).toEqual({
      id: '4',
      number: '105',
      firstName: 'Carla',
      lastName: 'Rossi',
      displayName: 'Carla Rossi',
      email: 'carla@muster.example',
      mobile: '+41791234567',
      outboundCallerId: null,
      language: 'de',
      enabled: true,
      registered: false,
      role: 'users',
      admin: false,
      system: false,
    });
    expectNoSecrets(user);

    const check = calls('GET', "/Users(Number='105')");
    expect(check).toHaveLength(1);
    expect(check[0]!.query.get('$select')).toBe('Id');
    const [post] = calls('POST', '/Users');
    expect(post!.contentType).toBe('application/json');
    expect(post!.body).toEqual({
      Number: '105',
      FirstName: 'Carla',
      LastName: 'Rossi',
      EmailAddress: 'carla@muster.example',
      Mobile: '+41791234567',
      Language: 'de',
    });
    expect(calls('GET', '/Users(4)')).toHaveLength(1);
  });

  it('checks the number length against ENL before sending', async () => {
    const a = adapter();
    const long = await caught(a.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '1001' }));
    expect(long).toMatchObject({ statusCode: 400, code: 'bad_request' });
    expect(long.message).toBe('The extension number must have 3 digits');
    const letters = await caught(a.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '10a' }));
    expect(letters.statusCode).toBe(400);
    pbx.enl = 0;
    const b = adapter();
    const short = await caught(b.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '1' }));
    expect(short.message).toBe('The extension number must have 2 to 10 digits');
    expect(await b.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '4711' })).toMatchObject({
      number: '4711',
    });
    expect(calls('POST', '/Users')).toHaveLength(1);
  });

  it('answers 409 for a taken number, from the pre-check and from the PBX', async () => {
    const a = adapter();
    const taken = await caught(a.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '101' }));
    expect(taken).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: 'The extension number 101 is in use at the phone system',
    });
    expect(calls('POST', '/Users')).toHaveLength(0);

    // 800 is a ring group: the pre-check only looks at users, the PBX refuses.
    const ringGroup = await caught(a.createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, number: '800' }));
    expect(ringGroup).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: 'The extension number 800 is in use at the phone system',
    });
    expect(calls('POST', '/Users')).toHaveLength(1);
  });

  it('maps the license limit to 409 phone_user_limit', async () => {
    pbx.maxUsers = 3;
    const err = await caught(adapter().createPhoneUser(THREECX_SYSTEM_ID, INPUT));
    expect(err).toMatchObject({
      statusCode: 409,
      code: 'phone_user_limit',
      message: 'The license of this phone system allows no more users',
    });
  });

  it('passes the PBX validation errors on as 400', async () => {
    const err = await caught(
      adapter().createPhoneUser(THREECX_SYSTEM_ID, { ...INPUT, firstName: 'A'.repeat(51) }),
    );
    expect(err).toMatchObject({
      statusCode: 400,
      code: 'bad_request',
      details: { target: 'FirstName', code: 'WARNINGS.LENGTH_NOT_MORE_50_CHARS' },
    });
    expect(err.message).toMatch(/^3CX: FirstName: WARNINGS.LENGTH_NOT_MORE_50_CHARS/);
  });

  it('creates a user without number and returns the number the PBX picked', async () => {
    const { number: _number, ...input } = INPUT;
    const user = await adapter().createPhoneUser(THREECX_SYSTEM_ID, input);
    expect(user.number).toBe('103');
    const [post] = calls('POST', '/Users');
    expect(post!.body).not.toHaveProperty('Number');
    expect(mock.requests.some((r) => r.path.includes('Number='))).toBe(false);
  });

  it('returns a user built from the input when only the read-back fails', async () => {
    pbx.override = (req) =>
      req.method === 'GET' && req.path === '/xapi/v1/Users(4)' ? odata(500, 'Internal error') : undefined;
    const user = await adapter().createPhoneUser(THREECX_SYSTEM_ID, {
      ...INPUT,
      email: 'Carla@Muster.example',
    });
    expect(user).toEqual({
      id: '4',
      number: '105',
      firstName: 'Carla',
      lastName: 'Rossi',
      displayName: 'Carla Rossi',
      email: 'carla@muster.example',
      mobile: '+41791234567',
      outboundCallerId: null,
      language: 'de',
      enabled: null,
      registered: null,
      role: null,
      admin: false,
      system: false,
    });
    expectNoSecrets(user);
  });

  it('updates only the changed fields and reads the user back', async () => {
    const a = adapter();
    const user = await a.updatePhoneUser(THREECX_SYSTEM_ID, '2', {
      lastName: null,
      mobile: '+41790000000',
      language: 'fr',
    });
    expect(user).toMatchObject({ id: '2', lastName: null, mobile: '+41790000000', language: 'fr' });
    const [patch] = calls('PATCH', '/Users(2)');
    expect(patch!.body).toEqual({ LastName: null, Mobile: '+41790000000', Language: 'fr' });
    expect(patch!.contentType).toBe('application/json');

    await a.updatePhoneUser(THREECX_SYSTEM_ID, '2', {});
    expect(calls('PATCH', '/Users(2)')).toHaveLength(1);
    expect(calls('GET', '/Users(2)')).toHaveLength(2);

    const missing = await caught(a.updatePhoneUser(THREECX_SYSTEM_ID, '99', { firstName: 'X' }));
    expect(missing).toMatchObject({ statusCode: 404, message: '3CX: phone user 99 not found' });
    const read = await caught(a.getPhoneUser(THREECX_SYSTEM_ID, '99'));
    expect(read).toMatchObject({ statusCode: 404, message: '3CX: phone user 99 not found' });
    const bad = await caught(a.updatePhoneUser(THREECX_SYSTEM_ID, '1)/x', { firstName: 'X' }));
    expect(bad.statusCode).toBe(404);
    expect(mock.requests.some((r) => r.path.includes('1)/x'))).toBe(false);
  });

  it('deletes a user and maps 404 and refused deletions', async () => {
    const a = adapter();
    expect((await a.listPhoneRingGroups(THREECX_SYSTEM_ID))[0]!.members).toHaveLength(2);
    await a.deletePhoneUser(THREECX_SYSTEM_ID, '2');
    expect(pbx.users.has(2)).toBe(false);
    // The PBX drops the extension from its ring groups: the cached list is not served again.
    expect((await a.listPhoneRingGroups(THREECX_SYSTEM_ID))[0]!.members.map((m) => m.number)).toEqual([
      '100',
    ]);
    expect(calls('DELETE', '/Users(2)')).toHaveLength(1);

    const missing = await caught(a.deletePhoneUser(THREECX_SYSTEM_ID, '2'));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing).toMatchObject({ statusCode: 404, message: '3CX: phone user 2 not found' });

    const fax = await caught(a.deletePhoneUser(THREECX_SYSTEM_ID, '3'));
    expect(fax).toMatchObject({
      statusCode: 409,
      code: 'conflict',
      message: '3CX: WARNINGS.FAX_SERVER_CANNOT_BE_DELETED (Id: WARNINGS.FAX_SERVER_CANNOT_BE_DELETED)',
    });
  });

  it('sends the welcome e-mail with POST and no body', async () => {
    const a = adapter();
    await a.sendPhoneWelcome(THREECX_SYSTEM_ID, '2');
    expect(pbx.users.get(2)!.welcomeMails).toBe(1);
    const [post] = calls('POST', '/Users(2)/Pbx.SendWelcomeEmail');
    expect(post!.raw).toBe('');
    expect(post!.contentType).toBeNull();

    const noMail = await caught(a.sendPhoneWelcome(THREECX_SYSTEM_ID, '3'));
    expect(noMail).toMatchObject({ statusCode: 400, message: 'This user has no e-mail address' });
    expect(calls('POST', '/Users(3)/Pbx.SendWelcomeEmail')).toHaveLength(0);

    const missing = await caught(a.sendPhoneWelcome(THREECX_SYSTEM_ID, '42'));
    expect(missing.statusCode).toBe(404);
  });

  it('lists ring groups with members in ring order', async () => {
    const groups = await adapter().listPhoneRingGroups(THREECX_SYSTEM_ID);
    expect(groups).toEqual([
      {
        id: '800',
        number: '800',
        name: 'Zentrale',
        strategy: 'ring_all',
        ringTimeSeconds: 20,
        members: [
          { number: '100', name: 'Anna Muster' },
          { number: '101', name: 'Ben Beispiel' },
        ],
      },
    ]);
    const [request] = calls('GET', '/RingGroups');
    expect(request!.query.get('$select')).toBe(RING_GROUP_SELECT);
    expect(request!.query.get('$expand')).toBe('Members');
    expect(request!.query.get('$orderby')).toBe('Number');
  });

  it('adds and removes ring group members with the full list in order', async () => {
    pbx.addUser({ Number: '103', FirstName: 'Daniel', LastName: 'Keller' });
    const a = adapter();
    const added = await a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '103');
    expect(added.members.map((m) => m.number)).toEqual(['100', '101', '103']);
    expect(calls('PATCH', '/RingGroups(800)')[0]!.body).toEqual({
      Members: [{ Number: '100' }, { Number: '101' }, { Number: '103' }],
    });
    expect(calls('GET', '/RingGroups(800)')[0]!.query.get('$select')).toBe(RING_GROUP_SELECT);

    const again = await a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '101');
    expect(again.members.map((m) => m.number)).toEqual(['100', '101', '103']);
    expect(calls('PATCH', '/RingGroups(800)')).toHaveLength(1);

    const removed = await a.removePhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '100');
    expect(removed.members.map((m) => m.number)).toEqual(['101', '103']);
    expect(calls('PATCH', '/RingGroups(800)')[1]!.body).toEqual({
      Members: [{ Number: '101' }, { Number: '103' }],
    });

    const notMember = await caught(a.removePhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '100'));
    expect(notMember).toMatchObject({
      statusCode: 404,
      code: 'not_found',
      message: 'Ring group member not found',
    });
    expect(calls('PATCH', '/RingGroups(800)')).toHaveLength(2);

    const unknownGroup = await caught(a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '801', '100'));
    expect(unknownGroup).toMatchObject({ statusCode: 404, message: '3CX: ring group 801 not found' });
    const unknownUser = await caught(a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '555'));
    expect(unknownUser).toMatchObject({ statusCode: 400, code: 'bad_request' });
    const letters = await caught(a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '10a'));
    expect(letters.statusCode).toBe(400);
  });

  it('serializes parallel member changes of one ring group', async () => {
    pbx.addUser({ Number: '103' });
    pbx.addUser({ Number: '104' });
    pbx.delayMs = 20;
    const a = adapter();
    await Promise.all([
      a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '103'),
      a.addPhoneRingGroupMember(THREECX_SYSTEM_ID, '800', '104'),
    ]);
    expect(pbx.ringGroups.get(800)!.members).toEqual(['100', '101', '103', '104']);
    const groups = await a.listPhoneRingGroups(THREECX_SYSTEM_ID);
    expect(groups[0]!.members.map((m) => m.number)).toEqual(['100', '101', '103', '104']);
  });

  it('lists trunks read only and without credentials', async () => {
    const a = adapter();
    const trunks = await a.listPhoneTrunks(THREECX_SYSTEM_ID);
    expect(trunks).toEqual([
      {
        id: '900',
        number: '10000',
        name: 'Swisscom SIP',
        host: 'sip.swisscom.ch',
        online: true,
        direction: 'both',
        externalNumber: '+41441234500',
        simultaneousCalls: 8,
        didCount: 3,
        configurationIssue: null,
      },
      {
        id: '901',
        number: '10001',
        name: 'Peoplefone',
        host: 'sips.peoplefone.ch',
        online: false,
        direction: 'outbound',
        externalNumber: null,
        simultaneousCalls: 4,
        didCount: 0,
        configurationIssue: 'Registration failed: 403 Forbidden',
      },
    ]);
    expectNoSecrets(trunks);
    expect(calls('GET', '/Trunks')[0]!.query.get('$select')).toBe(TRUNK_SELECT);
    clock += 59_000;
    await a.listPhoneTrunks(THREECX_SYSTEM_ID);
    expect(calls('GET', '/Trunks')).toHaveLength(1);
    expect(mock.requests.every((r) => r.method === 'GET' || r.path === '/connect/token')).toBe(true);
  });

  it('never selects or returns secret fields', async () => {
    const a = adapter();
    await a.getPhoneSystem(THREECX_SYSTEM_ID);
    const users = await a.listPhoneUsers(THREECX_SYSTEM_ID);
    const user = await a.getPhoneUser(THREECX_SYSTEM_ID, '1');
    const created = await a.createPhoneUser(THREECX_SYSTEM_ID, INPUT);
    const groups = await a.listPhoneRingGroups(THREECX_SYSTEM_ID);
    const trunks = await a.listPhoneTrunks(THREECX_SYSTEM_ID);
    expectNoSecrets([users, user, created, groups, trunks]);
    for (const r of mock.api()) {
      expect(r.query.get('$select') ?? '').not.toMatch(/Password|PIN|AuthID|LicenseKey|Phones/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('3CX API explorer', () => {
  it('strips the base URL and /xapi/v1 and sends query for GET and JSON for PATCH', async () => {
    const a = adapter();
    const status = await a.rawRequest('GET', `${mock.url}/xapi/v1/SystemStatus?$select=FQDN,Version`);
    expect(status).toEqual({
      status: 200,
      data: {
        '@odata.context': '/xapi/v1/$metadata#SystemStatus',
        FQDN: 'muster.3cx.ch',
        Version: '20.0.10.1479',
      },
    });
    expect(calls('GET', '/SystemStatus')[0]!.query.get('$select')).toBe('FQDN,Version');

    await a.rawRequest('GET', '/Users', { $top: 1, $select: ['Id', 'Number'], $count: true });
    const [list] = calls('GET', '/Users');
    expect(list!.query.get('$top')).toBe('1');
    expect(list!.query.get('$select')).toBe('Id,Number');
    expect(list!.query.get('$count')).toBe('true');
    expect(list!.raw).toBe('');

    const patched = await a.rawRequest('PATCH', '/xapi/v1/Users(1)', { FirstName: 'Anna-Maria' });
    expect(patched).toEqual({ status: 204, data: null });
    const [patch] = calls('PATCH', '/Users(1)');
    expect(patch!.body).toEqual({ FirstName: 'Anna-Maria' });
    expect(patch!.contentType).toBe('application/json');
    expect(pbx.users.get(1)!.FirstName).toBe('Anna-Maria');

    const byNumber = await a.rawRequest('GET', "/Users(Number='101')?$select=Id,Number");
    expect(byNumber.data).toMatchObject({ Id: 2, Number: '101' });

    const failed = await a.rawRequest('DELETE', '/Users(3)');
    expect(failed.status).toBe(400);
  });

  it('redacts secrets in answers', async () => {
    const a = adapter();
    const users = await a.rawRequest('GET', '/Users');
    expect(users.status).toBe(200);
    expectNoSecrets(JSON.stringify(users.data).replace(/"[A-Za-z]*(Password|PIN|Key)":/g, '"x":'));
    const first = (users.data as { value: Record<string, unknown>[] }).value[0]!;
    expect(first).toMatchObject({
      Number: '100',
      AccessPassword: '[redacted]',
      AuthPassword: '[redacted]',
      AuthID: '[redacted]',
      DeskphonePassword: '[redacted]',
      VMPIN: '[redacted]',
      Phones: [
        {
          MacAddress: '000b82123456',
          ProvisioningLinkExt: '[redacted]',
          ProvisioningLinkLocal: '[redacted]',
        },
      ],
    });
    const status = await a.rawRequest('GET', '/SystemStatus');
    expect((status.data as Record<string, unknown>).LicenseKey).toBe('[redacted]');
    const trunks = await a.rawRequest('GET', '/Trunks');
    expect((trunks.data as { value: Record<string, unknown>[] }).value[0]!.AuthPassword).toBe('[redacted]');
  });

  it('refuses PUT, path tricks, the token endpoint and changes of the API client', async () => {
    const a = adapter();
    const refused: [string, string, string][] = [
      ['PUT', '/Users(1)', '3CX updates use PATCH'],
      ['GET', '/Users/../../connect/token', 'Invalid path'],
      ['GET', '/xapi/v1/../connect/token', 'Only XAPI paths'],
      ['GET', '/Users/%2e%2e/%2E%2E/connect/token', 'Invalid path'],
      ['GET', '/Users%2fx', 'Invalid path'],
      ['GET', '/Users\\x', 'Invalid path'],
      ['GET', '/Users@evil.example', 'Invalid path'],
      ['GET', '/Users#x', 'Invalid path'],
      ['GET', '//evil.example/Users', 'Only XAPI paths'],
      ['GET', 'Users', 'Only XAPI paths'],
      ['POST', '/connect/token', 'token endpoint'],
      ['GET', `${mock.url}/connect/token`, 'token endpoint'],
      ['GET', '/SystemStatus/Pbx.APIToken()', 'API client of the panel'],
      ['POST', '/ServicePrincipals(1)/Pbx.GenerateAppToken', 'API client of the panel'],
      ['POST', '/ServicePrincipals', 'API client of the panel'],
      ['PATCH', '/ServicePrincipals(1)', 'API client of the panel'],
      ['DELETE', '/ServicePrincipals(1)', 'API client of the panel'],
    ];
    for (const [method, path, message] of refused) {
      const err = await caught(a.rawRequest(method, path));
      expect(err.statusCode, `${method} ${path}`).toBe(400);
      expect(err.message, `${method} ${path}`).toContain(message);
    }
    expect(mock.requests).toHaveLength(0);

    // Reading the service principals is allowed (answers are redacted).
    const read = await a.rawRequest('GET', '/ServicePrincipals');
    expect(read.status).toBe(404);
  });
});
