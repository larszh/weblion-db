import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { randomToken } from '../../lib/crypto';
import type { ConsoleSession } from '../../providers/types';

type VncSession = Extract<ConsoleSession, { type: 'vnc' }>;

interface Ticket {
  serverId: string;
  userId: string;
  session: VncSession;
  expiresAt: number;
}

/** One-time, short lived tickets that bind a console websocket to a user and a server. */
export class ConsoleTickets {
  private readonly tickets = new Map<string, Ticket>();

  issue(serverId: string, userId: string, session: VncSession): string {
    this.sweep();
    const ticket = randomToken(24);
    this.tickets.set(ticket, { serverId, userId, session, expiresAt: Date.now() + 60_000 });
    return ticket;
  }

  consume(ticket: string, serverId: string): Ticket | null {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.serverId !== serverId || entry.expiresAt < Date.now()) return null;
    return entry;
  }

  private sweep() {
    const now = Date.now();
    for (const [key, value] of this.tickets) if (value.expiresAt < now) this.tickets.delete(key);
  }
}

/**
 * Websocket bridge between the browser's noVNC client and the provider console.
 * The browser never talks to Proxmox directly and never sees the API token.
 */
export async function consoleRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/servers/:id/console/ws', { websocket: true }, (socket: WebSocket, req) => {
    const params = z.object({ id: z.uuid() }).safeParse(req.params);
    const query = z.object({ ticket: z.string().min(10) }).safeParse(req.query);
    const entry =
      params.success && query.success ? ctx.consoleTickets.consume(query.data.ticket, params.data.id) : null;
    if (!entry) {
      socket.close(4401, 'invalid or expired console ticket');
      return;
    }

    const pending: (Buffer | ArrayBuffer | Buffer[])[] = [];
    let upstream: WebSocket | null = null;
    let closed = false;

    const closeAll = (code = 1000, reason = '') => {
      if (closed) return;
      closed = true;
      try {
        socket.close(code, reason);
      } catch {
        /* already closed */
      }
      try {
        upstream?.close();
      } catch {
        /* already closed */
      }
    };

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (upstream && upstream.readyState === upstream.OPEN) upstream.send(data);
      else pending.push(data);
    });
    socket.on('close', () => closeAll());
    socket.on('error', () => closeAll());

    entry.session
      .connect()
      .then((ws) => {
        if (closed) {
          ws.close();
          return;
        }
        upstream = ws;
        for (const chunk of pending.splice(0)) ws.send(chunk);
        ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          if (socket.readyState === socket.OPEN) socket.send(data, { binary: isBinary });
        });
        ws.on('close', () => closeAll());
        ws.on('error', () => closeAll(1011, 'upstream error'));
        req.log.info({ serverId: entry.serverId, userId: entry.userId }, 'console session opened');
      })
      .catch((err: Error) => {
        req.log.warn({ err }, 'console upstream failed');
        closeAll(1011, err.message.slice(0, 120));
      });
  });
}
