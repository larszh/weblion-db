import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// A small Jellyfin (10.11, with switches for 10.10 and master behaviour), built after the
// server source of v10.11.11: AuthorizationContext (token sources, legacy switch),
// UserController (users, policy, password, delete), LibraryStructureController,
// SessionController, ApiKeyController, QuickConnectController. PascalCase JSON, ids as 32 hex
// without dashes, dates with 7 fractional digits and Z, null properties left out. Errors in
// the shapes of the design (1.4): 401 empty, ProblemDetails for NotFound(), JSON strings for
// NotFound("...") and StatusCode(403, "..."), text/plain "Error processing request." for
// exceptions, ValidationProblemDetails for bodies that fail validation.

export const MOCK_API_KEY = 'a3f1c2d4e5b6a7980f1e2d3c4b5a6978';
export const AUTH_PROVIDER = 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider';
export const RESET_PROVIDER = 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider';
export const MOCK_SERVER_ID = '8dd0047ed7d2f177ef00ca66157d6768';
/** The AccessToken GET /Auth/Keys answers, to prove the explorer never asks for it. */
export const MOCK_LISTED_KEY = 'f00dfeedf00dfeedf00dfeedf00dfeed';
/** The title the active session plays, to prove it never leaves the adapter. */
export const MOCK_PLAYING_TITLE = 'Der Bergdoktor S01E01';
const OPAQUE = 'Error processing request.';

export interface MockJellyfinUser {
  id: string;
  name: string;
  password: string | null;
  /** Full PascalCase policy. */
  policy: Record<string, unknown>;
  lastLoginDate?: string;
  lastActivityDate?: string;
  /** Signed-in devices, set to 0 by token revocation. */
  devices: number;
}

export interface MockJellyfinLibrary {
  ItemId: string | null;
  Name: string;
  CollectionType?: string;
}

export interface MockJellyfinOptions {
  apiKey?: string;
  /** e.g. '/jellyfin'; requests outside it get 302 to it. */
  basePath?: string;
  version?: string;
  startupWizardCompleted?: boolean;
  /** true (10.11 default): X-Emby-Token, X-MediaBrowser-Token, api_key and "Emby" work too. */
  legacyAuthorization?: boolean;
  quickConnect?: boolean;
  libraries?: MockJellyfinLibrary[];
  users?: MockJellyfinUser[];
  /** Per request, for the concurrency tests. */
  delayMs?: number;
}

export interface MockJellyfinRequest {
  method: string;
  /** Full path as received (with the base path). */
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** Parsed JSON, the text when it was not JSON, undefined without a body. */
  body: unknown;
}

export interface MockJellyfinAnswer {
  status?: number;
  /** Sent as application/json. */
  json?: unknown;
  /** Sent as text/plain (or `contentType`). */
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface MockJellyfinState {
  users: Map<string, MockJellyfinUser>;
  libraries: MockJellyfinLibrary[];
  sessions: Record<string, unknown>[];
  version: string;
  startupWizardCompleted: boolean;
  quickConnect: boolean;
  delayMs: number;
  /** Most requests handled at the same time so far. */
  maxInFlight: number;
  /** Answers instead of the routes when it returns something (failures, odd answers). */
  override?: (req: MockJellyfinRequest) => MockJellyfinAnswer | undefined;
}

export interface JellyfinMock {
  /** Includes the base path. */
  url: string;
  /** Without the base path. */
  origin: string;
  requests: MockJellyfinRequest[];
  state: MockJellyfinState;
  close(): Promise<void>;
}

/** The policy POST /Users/New gives a new user in 10.11 (UserEntityExtensions.AddDefaultPermissions). */
export function defaultPolicy(): Record<string, unknown> {
  return {
    IsAdministrator: false,
    IsHidden: true,
    EnableCollectionManagement: false,
    EnableSubtitleManagement: false,
    EnableLyricManagement: false,
    IsDisabled: false,
    BlockedTags: [],
    AllowedTags: [],
    EnableUserPreferenceAccess: true,
    AccessSchedules: [],
    BlockUnratedItems: [],
    EnableRemoteControlOfOtherUsers: false,
    EnableSharedDeviceControl: true,
    EnableRemoteAccess: true,
    EnableLiveTvManagement: false,
    EnableLiveTvAccess: true,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    ForceRemoteSourceTranscoding: false,
    EnableContentDeletion: false,
    EnableContentDeletionFromFolders: [],
    EnableContentDownloading: true,
    EnableSyncTranscoding: true,
    EnableMediaConversion: true,
    EnabledDevices: [],
    EnableAllDevices: true,
    EnabledChannels: [],
    EnableAllChannels: true,
    EnabledFolders: [],
    EnableAllFolders: true,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
    MaxActiveSessions: 0,
    EnablePublicSharing: true,
    BlockedMediaFolders: [],
    BlockedChannels: [],
    RemoteClientBitrateLimit: 0,
    AuthenticationProviderId: AUTH_PROVIDER,
    PasswordResetProviderId: RESET_PROVIDER,
    SyncPlayAccess: 'CreateAndJoinGroups',
  };
}

/**
 * What a UserPolicy deserialized from a request body holds for keys it does not carry: the
 * C# defaults of the UserPolicy constructor (not the new-user permissions above).
 */
function constructorDefaults(): Record<string, unknown> {
  return {
    ...defaultPolicy(),
    EnableLiveTvManagement: true,
    MaxParentalRating: null,
    AuthenticationProviderId: null,
    PasswordResetProviderId: null,
  };
}

/** Jellyfin 10.11 ValidUsernameRegex (.NET \w is Unicode). */
const VALID_NAME = /^(?!\s)[\p{L}\p{Mn}\p{Nd}\p{Pc} '._@+-]+(?<!\s)$/u;
const GUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function guidOf(value: string): string | null {
  return GUID.test(value) ? value.replace(/-/g, '').toLowerCase() : null;
}

/** A Jellyfin user id like Guid.NewGuid().ToString("N"). */
export function newJellyfinId(): string {
  return randomUUID().replace(/-/g, '');
}

/** "2026-10-11T08:15:30.1234567Z" as JsonDateTimeConverter writes it. */
export function jellyfinDate(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, '.$10000Z');
}

/** A user for the mock; the policy starts as Jellyfin gives it to new users. */
export function mockUser(
  name: string,
  options: Partial<Omit<MockJellyfinUser, 'policy'>> & { policy?: Record<string, unknown> } = {},
): MockJellyfinUser {
  return {
    id: options.id ?? newJellyfinId(),
    name,
    password: options.password === undefined ? 'secret-password' : options.password,
    policy: { ...defaultPolicy(), ...options.policy },
    lastLoginDate: options.lastLoginDate,
    lastActivityDate: options.lastActivityDate,
    devices: options.devices ?? 0,
  };
}

/** WebUtility.UrlDecode: "+" is a space, broken escapes stay as they are. */
function urlDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** GetParts of AuthorizationContext: key=value pairs, keys case-sensitive, values URL-decoded. */
function authParts(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  let escaped = false;
  let start = 0;
  let key = '';
  let i = 0;
  for (; i < header.length; i++) {
    const c = header[i];
    if (c === '"' || c === ',') {
      escaped = !escaped === (c === '"');
      if (c === ',' && !escaped) {
        if (start < i) {
          result[key] = urlDecode(
            header
              .slice(start, i)
              .trim()
              .replace(/^"+|"+$/g, ''),
          );
          key = '';
        }
        start = i + 1;
      }
    } else if (!escaped && c === '=') {
      key = header.slice(start, i).trim();
      start = i + 1;
    }
  }
  if (start < i)
    result[key] = urlDecode(
      header
        .slice(start, i)
        .trim()
        .replace(/^"+|"+$/g, ''),
    );
  return result;
}

function headerOf(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The token as AuthorizationContext finds it, in its order. */
function tokenOf(req: MockJellyfinRequest, legacy: boolean): string {
  let auth = headerOf(req.headers, 'authorization');
  if (!auth && legacy) auth = headerOf(req.headers, 'x-emby-authorization');
  let token = '';
  const space = auth.indexOf(' ');
  if (space > 0) {
    const scheme = auth.slice(0, space).toLowerCase();
    if (scheme === 'mediabrowser' || (legacy && scheme === 'emby')) {
      token = authParts(auth.slice(space + 1)).Token ?? '';
    }
  }
  if (!token && legacy) token = headerOf(req.headers, 'x-emby-token');
  if (!token && legacy) token = headerOf(req.headers, 'x-mediabrowser-token');
  if (!token) token = req.query.get('ApiKey') ?? '';
  if (!token && legacy) token = req.query.get('api_key') ?? '';
  return token;
}

const json = (value: unknown, status = 200): MockJellyfinAnswer => ({ status, json: value });
const opaque = (status: number): MockJellyfinAnswer => ({ status, text: OPAQUE });
/** return NotFound() / BadRequest(): ProblemDetails (design 1.4, UNVERIFIED shape). */
const problem = (status: number, title: string): MockJellyfinAnswer => ({
  status,
  json: {
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
    title,
    status,
    traceId: '00-abc-def-00',
  },
  contentType: 'application/problem+json; charset=utf-8',
});
const validation = (field: string, message: string): MockJellyfinAnswer => ({
  status: 400,
  json: {
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
    title: 'One or more validation errors occurred.',
    status: 400,
    errors: { [field]: [message] },
    traceId: '00-abc-def-00',
  },
  contentType: 'application/problem+json; charset=utf-8',
});

/** A UserDto as GetUserDto writes it (no PrimaryImageTag, null dates left out). */
function userDto(user: MockJellyfinUser): Record<string, unknown> {
  const dto: Record<string, unknown> = {
    Name: user.name,
    ServerId: MOCK_SERVER_ID,
    Id: user.id,
    HasPassword: user.password !== null,
    HasConfiguredPassword: user.password !== null,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: '',
      DisplayMissingEpisodes: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: true,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
    },
    Policy: structuredClone(user.policy),
  };
  if (user.lastLoginDate) dto.LastLoginDate = user.lastLoginDate;
  if (user.lastActivityDate) dto.LastActivityDate = user.lastActivityDate;
  return dto;
}

const isAdmin = (user: MockJellyfinUser) => user.policy.IsAdministrator === true;
const isDisabled = (user: MockJellyfinUser) => user.policy.IsDisabled === true;

export async function startJellyfinMock(options: MockJellyfinOptions = {}): Promise<JellyfinMock> {
  const apiKey = options.apiKey ?? MOCK_API_KEY;
  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const legacy = options.legacyAuthorization ?? true;
  const requests: MockJellyfinRequest[] = [];
  const admin = mockUser('admin', {
    id: '84bb1f65fce351e5962eb84c1645fa51',
    policy: { IsAdministrator: true, IsHidden: false, EnableLiveTvManagement: true },
    lastLoginDate: '2026-10-10T19:02:11.4870000Z',
    lastActivityDate: '2026-10-11T21:14:00.0000000Z',
    devices: 2,
  });
  const state: MockJellyfinState = {
    users: new Map((options.users ?? [admin]).map((u) => [u.id, u])),
    libraries: options.libraries ?? [
      { ItemId: 'f137a2dd21bbc1b99aa5c0f6bf02a805', Name: 'Filme', CollectionType: 'movies' },
      { ItemId: 'a656b907eb3a73532e40e44b968d0225', Name: 'Serien', CollectionType: 'tvshows' },
      { ItemId: '7e64e319657a9516ec78490da03edccb', Name: 'Musik', CollectionType: 'music' },
    ],
    sessions: [
      {
        PlayState: { CanSeek: true, IsPaused: false, IsMuted: false, RepeatMode: 'RepeatNone' },
        RemoteEndPoint: '203.0.113.7',
        Id: 'b9d1a8f6c2e34d0f8a7b6c5d4e3f2a1b',
        UserId: '3bc712a422452aa61a2816cf217e3788',
        UserName: 'anna-kemaro',
        Client: 'Jellyfin Android TV',
        DeviceName: 'Wohnzimmer TV',
        LastActivityDate: '2026-10-11T20:01:12.1234567Z',
        NowPlayingItem: { Name: MOCK_PLAYING_TITLE, Id: '1c5d9e0f3a4b5c6d7e8f9a0b1c2d3e4f', Type: 'Episode' },
        IsActive: true,
      },
      {
        RemoteEndPoint: '198.51.100.23',
        Id: 'c0e2b9a7d3f45e1a9b8c7d6e5f4a3b2c',
        UserId: '83b3b30ddff2dd3634a43687053b9fe9',
        UserName: 'wohnzimmer-kemaro',
        Client: 'Jellyfin Web',
        DeviceName: 'Firefox',
        LastActivityDate: '2026-10-11T20:03:40.0000000Z',
        IsActive: true,
      },
      {
        // A device that has not signed in: Guid.Empty as UserId.
        RemoteEndPoint: '192.0.2.44',
        Id: 'd1f3c0b8e4a56f2b0c9d8e7f6a5b4c3d',
        UserId: '00000000000000000000000000000000',
        Client: 'Jellyfin iOS',
        DeviceName: 'iPhone',
        LastActivityDate: '2026-10-11T20:04:00.0000000Z',
        IsActive: true,
      },
    ],
    version: options.version ?? '10.11.11',
    startupWizardCompleted: options.startupWizardCompleted ?? true,
    quickConnect: options.quickConnect ?? true,
    delayMs: options.delayMs ?? 0,
    maxInFlight: 0,
  };

  const findByName = (name: string) =>
    [...state.users.values()].find((u) => u.name.toUpperCase() === name.toUpperCase());

  function route(req: MockJellyfinRequest, path: string): MockJellyfinAnswer {
    const p = path.toLowerCase();
    const method = req.method;

    // Anonymous endpoints.
    if (method === 'GET' && p === '/system/info/public') {
      return json({
        LocalAddress: 'http://10.0.0.5:8096',
        ServerName: 'weblion Media',
        Version: state.version,
        ProductName: 'Jellyfin Server',
        OperatingSystem: '',
        Id: MOCK_SERVER_ID,
        StartupWizardCompleted: state.startupWizardCompleted,
      });
    }
    if (method === 'GET' && p === '/quickconnect/enabled') return json(state.quickConnect);
    if (method === 'POST' && p === '/users/authenticatebyname') {
      return json({ AccessToken: 'device-token-0123456789abcdef', ServerId: MOCK_SERVER_ID });
    }

    // Everything else needs a token (API keys are administrators).
    if (tokenOf(req, legacy) !== apiKey) return { status: 401 };

    if (method === 'GET' && p === '/system/info') {
      return json({
        LocalAddress: 'http://10.0.0.5:8096',
        ServerName: 'weblion Media',
        Version: state.version,
        ProductName: 'Jellyfin Server',
        OperatingSystem: '',
        Id: MOCK_SERVER_ID,
        StartupWizardCompleted: state.startupWizardCompleted,
        OperatingSystemDisplayName: 'Linux',
        HasPendingRestart: false,
        IsShuttingDown: false,
        SupportsLibraryMonitor: true,
        WebSocketPortNumber: 8096,
        CompletedInstallations: [],
        CanSelfRestart: true,
        CanLaunchWebBrowser: false,
        ProgramDataPath: '/config',
        WebPath: '/jellyfin/jellyfin-web',
        CachePath: '/cache',
        LogPath: '/config/log',
        TranscodingTempPath: '/cache/transcodes',
        CastReceiverApplications: [],
        HasUpdateAvailable: false,
        EncoderLocation: 'System',
        SystemArchitecture: 'X64',
      });
    }
    if (method === 'GET' && p === '/users') {
      const users = [...state.users.values()].sort((a, b) => a.name.localeCompare(b.name));
      return json(users.map(userDto));
    }
    if (method === 'GET' && p === '/library/virtualfolders') {
      return json(
        state.libraries.map((l) => {
          const info: Record<string, unknown> = {
            Name: l.Name,
            Locations: [`/media/${l.Name.toLowerCase()}`],
            LibraryOptions: { Enabled: true, EnableRealtimeMonitor: true, PathInfos: [] },
            RefreshStatus: 'Idle',
          };
          if (l.CollectionType) info.CollectionType = l.CollectionType;
          if (l.ItemId) info.ItemId = l.ItemId;
          return info;
        }),
      );
    }
    if (method === 'GET' && p === '/sessions') return json(structuredClone(state.sessions));
    if (method === 'GET' && p === '/auth/keys') {
      return json({
        Items: [
          {
            Id: 1,
            AccessToken: MOCK_LISTED_KEY,
            AppName: 'weblion.one',
            DateCreated: '2026-09-01T10:00:00.0000000Z',
          },
        ],
        TotalRecordCount: 1,
        StartIndex: 0,
      });
    }
    if (method === 'POST' && p === '/users/new') return createUser(req);
    if (method === 'POST' && p === '/users/password') return changePassword(req, req.query.get('userId'));

    const userRoute = /^\/users\/([^/]+)(\/policy|\/password)?$/.exec(p);
    if (userRoute) {
      const id = guidOf(userRoute[1]!);
      // Route binding of a Guid parameter.
      if (!id) return validation('userId', `The value '${userRoute[1]}' is not valid.`);
      const user = state.users.get(id);
      const sub = userRoute[2];
      if (!sub && method === 'GET') return user ? json(userDto(user)) : json('User not found', 404);
      if (!sub && method === 'DELETE') {
        if (!user) return problem(404, 'Not Found');
        if (isAdmin(user) && [...state.users.values()].filter(isAdmin).length === 1) return opaque(400);
        user.devices = 0;
        state.users.delete(id);
        return { status: 204 };
      }
      if (sub === '/policy' && method === 'POST') return updatePolicy(req, id);
      if (sub === '/password' && method === 'POST') return changePassword(req, id);
    }
    return { status: 404 };
  }

  function createUser(req: MockJellyfinRequest): MockJellyfinAnswer {
    const body = req.body as Record<string, unknown> | undefined;
    const name = typeof body?.Name === 'string' ? body.Name : null;
    if (!name) return validation('Name', 'The Name field is required.');
    // ThrowIfInvalidUsername and the duplicate check throw ArgumentException: 400, no reason.
    if (!VALID_NAME.test(name) || findByName(name)) return opaque(400);
    const user: MockJellyfinUser = {
      id: newJellyfinId(),
      name,
      // ChangePassword runs only with a Password; an empty one stores none.
      password: typeof body?.Password === 'string' && body.Password !== '' ? body.Password : null,
      policy: defaultPolicy(),
      devices: 0,
    };
    state.users.set(user.id, user);
    return json(userDto(user));
  }

  function updatePolicy(req: MockJellyfinRequest, id: string): MockJellyfinAnswer {
    const user = state.users.get(id);
    if (!user) return problem(404, 'Not Found');
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return validation('newPolicy', 'The newPolicy field is required.');
    }
    const next = { ...constructorDefaults(), ...(body as Record<string, unknown>) };
    if (typeof next.AuthenticationProviderId !== 'string' || !next.AuthenticationProviderId) {
      return validation('AuthenticationProviderId', 'The AuthenticationProviderId field is required.');
    }
    if (typeof next.PasswordResetProviderId !== 'string' || !next.PasswordResetProviderId) {
      return validation('PasswordResetProviderId', 'The PasswordResetProviderId field is required.');
    }
    if (
      next.IsAdministrator !== true &&
      isAdmin(user) &&
      [...state.users.values()].filter(isAdmin).length === 1
    ) {
      return json('There must be at least one user in the system with administrative access.', 403);
    }
    if (next.IsDisabled === true && isAdmin(user)) return json('Administrators cannot be disabled.', 403);
    if (next.IsDisabled === true && !isDisabled(user)) {
      if ([...state.users.values()].filter((u) => !isDisabled(u)).length === 1) {
        return json('There must be at least one enabled user in the system.', 403);
      }
      user.devices = 0;
    }
    // UpdatePolicyAsync: -1 means none, 0 means 3; the blocked lists are never set from the body.
    const attempts = Number(next.LoginAttemptsBeforeLockout);
    next.LoginAttemptsBeforeLockout = attempts === 0 ? 3 : Number.isFinite(attempts) ? attempts : -1;
    next.BlockedMediaFolders = user.policy.BlockedMediaFolders ?? [];
    next.BlockedChannels = user.policy.BlockedChannels ?? [];
    user.policy = next;
    return { status: 204 };
  }

  function changePassword(req: MockJellyfinRequest, rawId: string | null): MockJellyfinAnswer {
    // Without userId the caller's own id is used; an API key has none (Guid.Empty): exception.
    if (!rawId) return opaque(400);
    const id = guidOf(rawId);
    if (!id) return validation('userId', `The value '${rawId}' is not valid.`);
    const user = state.users.get(id);
    if (!user) return problem(404, 'Not Found');
    const body = (req.body ?? {}) as Record<string, unknown>;
    // An API key is an administrator without a user: no current password is checked.
    if (body.ResetPassword === true) {
      user.password = null;
      return { status: 204 };
    }
    const next = typeof body.NewPw === 'string' ? body.NewPw : '';
    if (next === '' && isAdmin(user)) return opaque(400);
    user.password = next === '' ? null : next;
    user.devices = 0;
    return { status: 204 };
  }

  let inFlight = 0;
  function send(res: ServerResponse, answer: MockJellyfinAnswer) {
    res.statusCode = answer.status ?? 200;
    for (const [key, value] of Object.entries(answer.headers ?? {})) res.setHeader(key, value);
    if (answer.text !== undefined) {
      res.setHeader('content-type', answer.contentType ?? 'text/plain');
      res.end(answer.text);
    } else if (answer.json !== undefined) {
      res.setHeader('content-type', answer.contentType ?? 'application/json; charset=utf-8');
      res.end(JSON.stringify(answer.json));
    } else {
      res.end();
    }
  }

  const server = createServer((req, res) => {
    inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let body: unknown = raw || undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Keep the text.
      }
      const recorded: MockJellyfinRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      let answer: MockJellyfinAnswer;
      const inside =
        !basePath ||
        url.pathname === basePath ||
        url.pathname.toLowerCase().startsWith(`${basePath.toLowerCase()}/`);
      if (!inside) {
        // UseBaseUrlRedirection: requests outside the base path are sent into it.
        answer = { status: 302, headers: { location: `${basePath}${url.pathname}${url.search}` } };
      } else {
        answer = state.override?.(recorded) ?? route(recorded, url.pathname.slice(basePath.length) || '/');
      }
      setTimeout(() => {
        inFlight--;
        send(res, answer);
      }, state.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}${basePath}`,
    origin,
    requests,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
