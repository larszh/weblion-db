import { timingSafeEqual } from 'node:crypto';
// ssh2 is CommonJS without named exports Node can see: always the default import.
import ssh2 from 'ssh2';
import type { Client as SshClient, ClientChannel, ConnectConfig } from 'ssh2';
import { AppError, ProviderError } from '../../lib/errors';
import type { CloudPanelConfig } from '../types';
import { hostKeyFingerprint } from './keys';
import { PROVIDER } from './protocol';

/** Largest answer the console reads from the agent. */
export const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
/** Largest diagnostic the console reads from the agent's stderr. */
export const MAX_STDERR_BYTES = 64 * 1024;

const IDLE_MS = 60_000;
const READY_TIMEOUT_MS = 15_000;
const KEEPALIVE_MS = 15_000;
const KEEPALIVE_COUNT_MAX = 3;
/** The server's ForceCommand ignores what the client asks to run; this only names it in sshd's log. */
const COMMAND = 'weblion-clp';
/** Socket errors worth naming by their code alone. */
const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** null when the channel closed without an exit status (killed, dropped). */
  code: number | null;
  signal: string | null;
}

/** Runs the server's forced command once with `input` on stdin. Transport problems reject with ProviderError. */
export interface SshTransport {
  exec(input: string, timeoutMs: number): Promise<ExecResult>;
  close(): void;
}

export interface Ssh2TransportOptions {
  /** Close the connection after this long without an exec. Default 60 s. */
  idleMs?: number;
  /** Limit for TCP connect, key exchange and login. Default 15 s. */
  readyTimeoutMs?: number;
}

/** Constant-time comparison of two strings (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

type SshError = Error & { level?: string; code?: unknown };

/**
 * A failure before the request reached the agent (no connection, wrong host key, login refused,
 * channel refused). Nothing happened on the server, so it carries `rolledBack: true` like a
 * create the agent rolled back: callers drop what they reserved instead of waiting for a sync.
 */
function notSent(message: string): ProviderError {
  return new ProviderError(PROVIDER, message, undefined, { rolledBack: true });
}

/**
 * SSH to one CloudPanel server with the ssh2 package: key login only, the server's ed25519 host
 * key pinned by its SHA-256 fingerprint (no trust on first use), one exec channel per operation
 * with the request on stdin. One connection, opened on the first exec, closed after `idleMs`
 * without an exec and opened again when needed. Never logs or returns what went to stdin.
 */
export class Ssh2Transport implements SshTransport {
  private client: SshClient | null = null;
  private connecting: Promise<SshClient> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private active = 0;
  /** Fingerprint the server offered in the last handshake, null before one. */
  private lastHostKey: string | null = null;
  private readonly idleMs: number;
  private readonly readyTimeoutMs: number;

  constructor(
    private readonly config: CloudPanelConfig,
    options: Ssh2TransportOptions = {},
  ) {
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  }

  async exec(input: string, timeoutMs: number): Promise<ExecResult> {
    this.clearIdle();
    this.active++;
    try {
      const client = await this.connect();
      return await this.run(client, input, timeoutMs);
    } finally {
      this.active--;
      this.armIdle();
    }
  }

  /** Ends the connection. The next exec connects again. */
  close(): void {
    this.clearIdle();
    const client = this.client;
    this.client = null;
    client?.end();
    // A login in progress is ended as soon as it is done.
    this.connecting?.then((c) => c.end()).catch(() => undefined);
  }

  private connect(): Promise<SshClient> {
    if (this.client) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;

    const client = new ssh2.Client();
    const pending = new Promise<SshClient>((resolve, reject) => {
      let ready = false;
      this.lastHostKey = null;
      client.once('ready', () => {
        ready = true;
        this.client = client;
        resolve(client);
      });
      // Always listening: an unhandled "error" event would end the process.
      client.on('error', (err: SshError) => {
        if (!ready) {
          reject(this.connectError(err));
          client.end();
        }
        this.forget(client);
      });
      client.on('end', () => this.forget(client));
      client.on('close', () => {
        if (!ready) {
          reject(notSent(`SSH connection to ${this.where()} failed: the server closed it before the login`));
        }
        this.forget(client);
      });
      try {
        client.connect(this.connectConfig());
      } catch (err) {
        // ssh2 checks the private key before it connects; its messages never contain the key.
        const message = err instanceof Error ? err.message : String(err);
        reject(notSent(`The private key of this connection cannot be used: ${message}`));
      }
    });
    this.connecting = pending;
    const done = () => {
      if (this.connecting === pending) this.connecting = null;
    };
    pending.then(done, done);
    return pending;
  }

  private connectConfig(): ConnectConfig {
    const pinned = this.config.hostKeySha256.trim();
    return {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      privateKey: this.config.privateKey,
      readyTimeout: this.readyTimeoutMs,
      keepaliveInterval: KEEPALIVE_MS,
      keepaliveCountMax: KEEPALIVE_COUNT_MAX,
      tryKeyboard: false,
      algorithms: { serverHostKey: ['ssh-ed25519'] },
      // Called during the key exchange, before any authentication is sent.
      hostVerifier: (key: Buffer) => {
        const got = hostKeyFingerprint(key);
        this.lastHostKey = got;
        return safeEqual(got, pinned);
      },
    };
  }

  /** The connect failure as the operator should read it. The request never reached the server. */
  private connectError(err: SshError): ProviderError {
    const pinned = this.config.hostKeySha256.trim();
    if (this.lastHostKey !== null && !safeEqual(this.lastHostKey, pinned)) {
      return notSent(
        `The SSH host key of ${this.config.host} does not match the pinned fingerprint (got ${this.lastHostKey}). ` +
          'If the server was reinstalled, check the new key and update the connection.',
      );
    }
    if (err.level === 'client-authentication') {
      return notSent(
        `SSH login as ${this.config.username} was refused. Is the console's public key in ` +
          "/var/lib/weblion-agent/.ssh/authorized_keys with the console's IP in from=?",
      );
    }
    if (err.level === 'client-timeout') {
      return notSent(
        `SSH connection to ${this.where()} failed: no login within ${Math.round(this.readyTimeoutMs / 1000)} s`,
      );
    }
    if (typeof err.code === 'string' && CONNECT_CODES.has(err.code)) {
      return notSent(`SSH connection to ${this.where()} failed: ${err.code}`);
    }
    if (/host key/i.test(err.message)) {
      return notSent(
        `SSH connection to ${this.where()} failed: the server offers no ed25519 host key (${err.message})`,
      );
    }
    return notSent(`SSH connection to ${this.where()} failed: ${err.message}`);
  }

  private run(client: SshClient, input: string, timeoutMs: number): Promise<ExecResult> {
    const host = this.config.host;
    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false;
      let channel: ClientChannel | null = null;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new AppError(
              504,
              'timeout',
              `No answer from ${host} within ${Math.ceil(timeoutMs / 1000)} s. ` +
                'The server may still finish the operation; the next sync shows the result.',
            ),
          ),
        );
        // The agent keeps running and finishes what it started.
        channel?.close();
      }, timeoutMs);
      const tooLarge = () => {
        settle(() =>
          reject(
            new ProviderError(
              PROVIDER,
              `Invalid answer from the agent on ${host}: the answer is too large ` +
                `(over ${MAX_STDOUT_BYTES / 1024 / 1024} MiB, or ${MAX_STDERR_BYTES / 1024} KiB on stderr)`,
            ),
          ),
        );
        channel?.destroy();
      };

      try {
        client.exec(COMMAND, { pty: false }, (err, stream) => {
          if (err) {
            // The server refused the channel: the agent never started.
            settle(() => reject(notSent(`SSH exec on ${host} failed: ${err.message}`)));
            return;
          }
          if (settled) {
            stream.close();
            return;
          }
          channel = stream;
          const out: Buffer[] = [];
          const errOut: Buffer[] = [];
          let outBytes = 0;
          let errBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            if (settled) return;
            outBytes += chunk.length;
            if (outBytes > MAX_STDOUT_BYTES) tooLarge();
            else out.push(chunk);
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            if (settled) return;
            errBytes += chunk.length;
            if (errBytes > MAX_STDERR_BYTES) tooLarge();
            else errOut.push(chunk);
          });
          stream.on('error', (e: Error) => {
            settle(() => reject(new ProviderError(PROVIDER, `SSH channel to ${host} failed: ${e.message}`)));
          });
          // ssh2 passes the exit status, or null and the signal; nothing when the channel dropped.
          stream.on('close', (code?: number | null, signal?: string) => {
            settle(() =>
              resolve({
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(errOut).toString('utf8'),
                code: typeof code === 'number' ? code : null,
                signal: typeof signal === 'string' ? signal : null,
              }),
            );
          });
          // One line on stdin, then EOF: the agent reads until the end of its input.
          stream.end(`${input}\n`);
        });
      } catch (err) {
        // exec throws when the connection went away between login and now.
        const message = err instanceof Error ? err.message : String(err);
        settle(() => reject(notSent(`SSH exec on ${host} failed: ${message}`)));
      }
    });
  }

  private forget(client: SshClient) {
    if (this.client === client) {
      this.client = null;
      this.clearIdle();
    }
  }

  private armIdle() {
    if (this.active > 0 || !this.client) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.active > 0 || !this.client) return;
      const client = this.client;
      this.client = null;
      client.end();
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private where(): string {
    return `${this.config.host}:${this.config.port}`;
  }
}
