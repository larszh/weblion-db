import type { AddressInfo } from 'node:net';
import ssh2 from 'ssh2';
import type { Connection, ParsedKey, ServerChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, ProviderError } from '../src/lib/errors';
import { CloudPanelAdapter } from '../src/providers/cloudpanel/adapter';
import { generateCloudPanelKeyPair, hostKeyFingerprint } from '../src/providers/cloudpanel/keys';
import { MAX_STDOUT_BYTES, Ssh2Transport } from '../src/providers/cloudpanel/ssh';
import type { CloudPanelConfig } from '../src/providers/types';

// ---------------------------------------------------------------------------
// A real ssh2 server in this process on 127.0.0.1: public key login for one user, exec answers
// like the forced command on a CloudPanel server (reads stdin to its end, writes one line).

interface Exec {
  command: string;
  input: string;
  stdinClosed: boolean;
}

interface ServerAnswer {
  stdout: string | Buffer;
  stderr?: string;
  code: number;
}

interface FakeServer {
  port: number;
  /** Connections accepted, auth attempts seen, connections closed again. */
  connections: number;
  authAttempts: number;
  closed: number;
  execs: Exec[];
  stop(): Promise<void>;
}

const servers: FakeServer[] = [];
const transports: Ssh2Transport[] = [];

afterEach(async () => {
  for (const transport of transports.splice(0)) transport.close();
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

async function startServer(options: {
  hostKey: string;
  clientPublicKey: string;
  /** null: never answer. */
  answer?: (input: string) => ServerAnswer | null;
}): Promise<FakeServer> {
  const allowed = ssh2.utils.parseKey(options.clientPublicKey) as ParsedKey;
  const answer: (input: string) => ServerAnswer | null =
    options.answer ?? (() => ({ stdout: '{"v":1,"ok":true,"data":{}}\n', code: 0 }));
  const open = new Set<Connection>();
  const state = { connections: 0, authAttempts: 0, closed: 0, execs: [] as Exec[] };

  const server = new ssh2.Server({ hostKeys: [options.hostKey] }, (client) => {
    state.connections++;
    open.add(client);
    client.on('error', () => undefined);
    client.on('close', () => {
      state.closed++;
      open.delete(client);
    });
    client.on('authentication', (ctx) => {
      state.authAttempts++;
      if (ctx.method !== 'publickey' || ctx.username !== 'weblion-agent') return ctx.reject(['publickey']);
      if (ctx.key.algo !== allowed.type || !ctx.key.data.equals(allowed.getPublicSSH())) {
        return ctx.reject(['publickey']);
      }
      if (ctx.signature && !allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo)) {
        return ctx.reject(['publickey']);
      }
      ctx.accept();
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on(
          'exec',
          (acceptExec: () => ServerChannel, _reject: () => void, info: { command: string }) => {
            const stream = acceptExec();
            const exec: Exec = { command: info.command, input: '', stdinClosed: false };
            state.execs.push(exec);
            stream.on('error', () => undefined);
            stream.on('data', (chunk: Buffer) => (exec.input += chunk.toString('utf8')));
            stream.on('end', () => {
              exec.stdinClosed = true;
              const result = answer(exec.input);
              if (!result) return;
              if (result.stderr) stream.stderr.write(result.stderr);
              stream.write(result.stdout);
              stream.exit(result.code);
              stream.end();
            });
          },
        );
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeServer = {
    port,
    get connections() {
      return state.connections;
    },
    get authAttempts() {
      return state.authAttempts;
    },
    get closed() {
      return state.closed;
    },
    execs: state.execs,
    stop: async () => {
      for (const client of open) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  servers.push(fake);
  return fake;
}

function fingerprintOf(privateKey: string): string {
  return hostKeyFingerprint((ssh2.utils.parseKey(privateKey) as ParsedKey).getPublicSSH());
}

const HOST = generateCloudPanelKeyPair('host');
const CLIENT = generateCloudPanelKeyPair();

function transportFor(
  server: FakeServer,
  config: Partial<CloudPanelConfig> = {},
  options: { idleMs?: number; readyTimeoutMs?: number } = {},
) {
  const transport = new Ssh2Transport(
    {
      host: '127.0.0.1',
      port: server.port,
      username: 'weblion-agent',
      privateKey: CLIENT.privateKey,
      hostKeySha256: fingerprintOf(HOST.privateKey),
      ...config,
    },
    options,
  );
  transports.push(transport);
  return transport;
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected a rejection');
}

const LINE = '{"v":1,"op":"info","requestId":"6f0c1c6e-2a51-4a51-9c55-3cdd1f1e0f3a","args":{}}';

describe('SSH transport against an ssh2 server', () => {
  it('runs one exec with the request on stdin when the host key matches', async () => {
    const server = await startServer({
      hostKey: HOST.privateKey,
      clientPublicKey: CLIENT.publicKey,
      answer: (input) => ({
        stdout: `${JSON.stringify({ v: 1, ok: true, data: { echo: input.trim() } })}\n`,
        stderr: 'note\n',
        code: 0,
      }),
    });
    const transport = transportFor(server);
    const result = await transport.exec(LINE, 5_000);
    expect(result).toEqual({
      stdout: `${JSON.stringify({ v: 1, ok: true, data: { echo: LINE } })}\n`,
      stderr: 'note\n',
      code: 0,
      signal: null,
    });
    expect(server.execs).toEqual([{ command: 'weblion-clp', input: `${LINE}\n`, stdinClosed: true }]);
    // The connection is kept for the next operation.
    await transport.exec(LINE, 5_000);
    expect(server.execs).toHaveLength(2);
    expect(server.connections).toBe(1);
  });

  it('reports exit codes other than 0', async () => {
    const server = await startServer({
      hostKey: HOST.privateKey,
      clientPublicKey: CLIENT.publicKey,
      answer: () => ({ stdout: '', stderr: 'sudo: a password is required\n', code: 1 }),
    });
    const result = await transportFor(server).exec(LINE, 5_000);
    expect(result).toMatchObject({ stdout: '', stderr: 'sudo: a password is required\n', code: 1 });
  });

  it('refuses a server whose host key is not the pinned one, before logging in', async () => {
    const server = await startServer({ hostKey: HOST.privateKey, clientPublicKey: CLIENT.publicKey });
    const other = generateCloudPanelKeyPair('other');
    const transport = transportFor(server, { hostKeySha256: fingerprintOf(other.privateKey) });
    const err = await failure(transport.exec(LINE, 5_000));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe(
      `CloudPanel: The SSH host key of 127.0.0.1 does not match the pinned fingerprint (got ${fingerprintOf(HOST.privateKey)}). ` +
        'If the server was reinstalled, check the new key and update the connection.',
    );
    // Nothing reached the server: callers may drop what they reserved.
    expect(err.details).toEqual({ rolledBack: true });
    expect(server.authAttempts).toBe(0);
    expect(server.execs).toHaveLength(0);
  });

  it('refuses a server that offers no ed25519 host key', async () => {
    const rsa = ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 });
    const server = await startServer({ hostKey: rsa.private, clientPublicKey: CLIENT.publicKey });
    // Even with the RSA key's own fingerprint pinned: only ed25519 host keys are negotiated.
    const transport = transportFor(server, { hostKeySha256: fingerprintOf(rsa.private) });
    const err = await failure(transport.exec(LINE, 5_000));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(
      new RegExp(
        `^CloudPanel: SSH connection to 127\\.0\\.0\\.1:${server.port} failed: the server offers no ed25519 host key`,
      ),
    );
    expect(server.authAttempts).toBe(0);
    expect(server.execs).toHaveLength(0);
  });

  it('explains a refused login', async () => {
    const server = await startServer({ hostKey: HOST.privateKey, clientPublicKey: CLIENT.publicKey });
    const stranger = generateCloudPanelKeyPair();
    const err = await failure(transportFor(server, { privateKey: stranger.privateKey }).exec(LINE, 5_000));
    expect(err.message).toBe(
      "CloudPanel: SSH login as weblion-agent was refused. Is the console's public key in " +
        "/var/lib/weblion-agent/.ssh/authorized_keys with the console's IP in from=?",
    );
    expect(err.details).toEqual({ rolledBack: true });
    expect(server.authAttempts).toBeGreaterThan(0);
    expect(server.execs).toHaveLength(0);
  });

  it('names a refused TCP connection', async () => {
    const server = await startServer({ hostKey: HOST.privateKey, clientPublicKey: CLIENT.publicKey });
    const port = server.port;
    await server.stop();
    servers.splice(servers.indexOf(server), 1);
    const err = await failure(transportFor({ ...server, port }).exec(LINE, 5_000));
    expect(err.message).toBe(`CloudPanel: SSH connection to 127.0.0.1:${port} failed: ECONNREFUSED`);
    expect(err.details).toEqual({ rolledBack: true });
  });

  it('closes an idle connection and opens a new one for the next exec', async () => {
    const server = await startServer({ hostKey: HOST.privateKey, clientPublicKey: CLIENT.publicKey });
    const transport = transportFor(server, {}, { idleMs: 100 });
    await transport.exec(LINE, 5_000);
    expect(server.connections).toBe(1);
    await vi.waitFor(() => expect(server.closed).toBe(1), { timeout: 3_000, interval: 20 });
    await transport.exec(LINE, 5_000);
    expect(server.connections).toBe(2);
    expect(server.execs).toHaveLength(2);
  });

  it('gives up on an answer over 4 MiB and keeps the connection usable', async () => {
    let big = true;
    const server = await startServer({
      hostKey: HOST.privateKey,
      clientPublicKey: CLIENT.publicKey,
      answer: () => {
        if (!big) return { stdout: '{"v":1,"ok":true,"data":{}}\n', code: 0 };
        big = false;
        return { stdout: Buffer.alloc(MAX_STDOUT_BYTES + 512 * 1024, 'x'), code: 0 };
      },
    });
    const transport = transportFor(server);
    const err = await failure(transport.exec(LINE, 10_000));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('the answer is too large');
    const next = await transport.exec(LINE, 5_000);
    expect(next).toMatchObject({ stdout: '{"v":1,"ok":true,"data":{}}\n', code: 0 });
    expect(server.connections).toBe(1);
  });

  it('carries the adapter end to end with the transport it builds itself', async () => {
    const info = {
      agentVersion: '1.0.0',
      protocol: 1,
      cloudpanelVersion: '2.5.4-3+clp-noble',
      hostname: 'web1',
      os: null,
      ipv4: ['203.0.113.10'],
      ipv6: [],
      phpVersions: ['8.4'],
      templates: [],
      nodejsVersions: [],
      nodejsEnabled: false,
      allowRemoteAdopt: false,
      protectedDomains: [],
      counts: { sites: 0, managed: 0, unmanaged: 0 },
      cliVersion: null,
    };
    const server = await startServer({
      hostKey: HOST.privateKey,
      clientPublicKey: CLIENT.publicKey,
      answer: () => ({ stdout: `${JSON.stringify({ v: 1, ok: true, data: info })}\n`, code: 0 }),
    });
    const adapter = new CloudPanelAdapter(
      {
        host: '127.0.0.1',
        port: server.port,
        username: 'weblion-agent',
        privateKey: CLIENT.privateKey,
        hostKeySha256: fingerprintOf(HOST.privateKey),
      },
      { log: { warn: vi.fn() } },
    );
    expect(await adapter.testConnection()).toMatchObject({ hostname: 'web1', publicKey: CLIENT.publicKey });
    const request = JSON.parse(server.execs[0]!.input) as Record<string, unknown>;
    expect(request).toMatchObject({ v: 1, op: 'info', args: {} });
    expect(request).not.toHaveProperty('secrets');
  });

  it('stops waiting after the operation timeout', async () => {
    const server = await startServer({
      hostKey: HOST.privateKey,
      clientPublicKey: CLIENT.publicKey,
      answer: (input) =>
        input.includes('"op":"info"') ? null : { stdout: '{"v":1,"ok":true,"data":{}}\n', code: 0 },
    });
    const transport = transportFor(server);
    const err = await failure(transport.exec(LINE, 300));
    expect([err.statusCode, err.code]).toEqual([504, 'timeout']);
    // Sent, outcome unknown: no rolledBack.
    expect(err.details).toBeUndefined();
    expect(err.message).toBe(
      'No answer from 127.0.0.1 within 1 s. The server may still finish the operation; the next sync shows the result.',
    );
    // The connection stays usable for the next operation.
    const next = await transport.exec(LINE.replace('"info"', '"list"'), 5_000);
    expect(next.code).toBe(0);
  });
});
