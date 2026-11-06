import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';

/** POST /orgs/:orgId/ai/chat as server-sent events (ai 9). Empty in the foundation; U3 implements. */
export async function aiChatRoutes(_app: FastifyInstance, _ctx: AppContext): Promise<void> {}
