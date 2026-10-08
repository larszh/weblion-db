import { Agent } from 'undici';
import WebSocket from 'ws';
import { ProviderError } from '../../lib/errors';
import { httpRequest, isRecord, str } from '../http';
import type { ProxmoxConfig } from '../types';
import { taskSucceeded } from './parse';

const PROVIDER = 'Proxmox';

/** Thin typed wrapper around the Proxmox VE REST API (api2/json) using an API token. */
export class ProxmoxClient {
  readonly apiBase: string;
  private readonly authHeader: string;
  private readonly dispatcher: Agent;

  constructor(private readonly config: ProxmoxConfig) {
    const origin = config.baseUrl.replace(/\/+$/, '').replace(/\/api2\/json$/, '');
    this.apiBase = `${origin}/api2/json`;
    this.authHeader = `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`;
    this.dispatcher = new Agent({
      connect: {
        rejectUnauthorized: config.verifyTls,
        ...(config.caCert ? { ca: config.caCert } : {}),
      },
      keepAliveTimeout: 10_000,
    });
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.raw(method, path, params);
    if (res.status >= 400) {
      throw new ProviderError(
        PROVIDER,
        describeError(res.status, res.statusText, res.body),
        res.status,
        res.body,
      );
    }
    return (isRecord(res.body) ? res.body.data : res.body) as T;
  }

  async raw(method: string, path: string, params?: Record<string, unknown>) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${this.apiBase}${cleanPath}`;
    let form: Record<string, unknown> | undefined;
    if (params && Object.keys(params).length > 0) {
      if (method === 'GET' || method === 'DELETE') {
        const query = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null)
            query.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
        }
        url += `${url.includes('?') ? '&' : '?'}${query.toString()}`;
      } else {
        form = params;
      }
    }
    return httpRequest(PROVIDER, {
      method,
      url,
      headers: { Authorization: this.authHeader },
      form,
      dispatcher: this.dispatcher,
      timeoutMs: 30_000,
    });
  }

  get<T = unknown>(path: string, params?: Record<string, unknown>) {
    return this.request<T>('GET', path, params);
  }
  post<T = unknown>(path: string, params?: Record<string, unknown>) {
    return this.request<T>('POST', path, params);
  }
  put<T = unknown>(path: string, params?: Record<string, unknown>) {
    return this.request<T>('PUT', path, params);
  }
  delete<T = unknown>(path: string, params?: Record<string, unknown>) {
    return this.request<T>('DELETE', path, params);
  }

  /** Opens a websocket to the API (used for the VNC console bridge). */
  openWebSocket(path: string, query: Record<string, string>): Promise<WebSocket> {
    const url = new URL(`${this.apiBase.replace(/^http/, 'ws')}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const ws = new WebSocket(url, ['binary'], {
      headers: { Authorization: this.authHeader },
      rejectUnauthorized: this.config.verifyTls,
      ...(this.config.caCert ? { ca: this.config.caCert } : {}),
      handshakeTimeout: 15_000,
    });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', (err) =>
        reject(new ProviderError(PROVIDER, `console websocket failed: ${err.message}`)),
      );
      ws.once('unexpected-response', (_req, res) =>
        reject(
          new ProviderError(
            PROVIDER,
            `console websocket rejected: HTTP ${res.statusCode} ${res.statusMessage ?? ''}`,
          ),
        ),
      );
    });
  }

  /**
   * Polls a task (UPID) until it finishes. Returns the exit status ("OK" or "WARNINGS: <n>",
   * which Proxmox counts as success) and throws with the error for anything else.
   */
  async waitForTask(upid: string, timeoutMs = 10 * 60_000): Promise<string> {
    const node = nodeFromUpid(upid);
    if (!node) throw new ProviderError(PROVIDER, `invalid task id ${upid}`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.get<{ status: string; exitstatus?: string }>(
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      );
      if (status.status === 'stopped') {
        const exit = status.exitstatus ?? null;
        if (!taskSucceeded(exit)) throw new ProviderError(PROVIDER, `task failed: ${exit}`);
        return exit ?? 'OK';
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new ProviderError(PROVIDER, `task ${upid} did not finish in time`);
  }

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}

export function nodeFromUpid(upid: string): string | null {
  // UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:
  const parts = upid.split(':');
  return parts[0] === 'UPID' && parts[1] ? parts[1] : null;
}

function describeError(status: number, statusText: string, body: unknown): string {
  if (status === 401) return 'API token rejected (401). Check PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET.';
  if (status === 403) {
    return `permission denied (403). If the token uses privilege separation it needs its own ACLs. ${statusText}`;
  }
  if (isRecord(body) && isRecord(body.errors)) {
    const fields = Object.entries(body.errors)
      .map(([k, v]) => `${k}: ${str(v) ?? ''}`)
      .join('; ');
    return `${statusText || `HTTP ${status}`} (${fields})`;
  }
  if (isRecord(body) && str(body.message)) return str(body.message)!;
  // Proxmox reports most errors in the HTTP reason phrase.
  return statusText || `HTTP ${status}`;
}
