import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOCALES } from '@weblion/shared';
import type { AppContext } from '../../context';
import { requireSession } from '../../auth/access';
import { parse } from '../../lib/validation';
import { loadOrg } from '../orgs/routes';
import { aiRequestGate } from './gates';

/**
 * POST /orgs/:orgId/ai/chat (ai 9.1): one turn of the assistant as server-sent events. Every gate runs before the
 * stream opens, so refusals are plain JSON errors: session (the tool layer replays the session cookie, API tokens
 * get 403), body, organization (404), availability (404), the AI gate (organization state and ai:use; staff:
 * platform:ai:use and the customer's state), then the reservation in the turn itself (429).
 */

export const USER_TEXT_MAX = 4_000;
/** An assistant answer can be long (review #20). */
export const ASSISTANT_TEXT_MAX = 16_000;
export const HISTORY_MAX = 40;

const pageRef = z.object({
  path: z
    .string()
    .max(300)
    .regex(/^\/(o|admin)(\/[^\s]*)?$/),
  title: z.string().max(200).nullable(),
});

/**
 * The history as the browser's buildHistory() sends it (ai 9.2, 12.1): first and last message from the person,
 * roles alternating, the page only on user messages. The server does not trim; it accepts exactly that shape.
 */
export const chatBody = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          text: z.string().trim().min(1),
          page: pageRef.nullable().optional(),
        }),
      )
      .min(1)
      .max(HISTORY_MAX),
    locale: z.enum(LOCALES),
  })
  .superRefine((body, issue) => {
    const messages = body.messages;
    if (messages[0]?.role !== 'user')
      issue.addIssue({ code: 'custom', path: ['messages', 0], message: 'must be a user message' });
    if (messages.at(-1)?.role !== 'user') {
      issue.addIssue({
        code: 'custom',
        path: ['messages', messages.length - 1],
        message: 'must be a user message',
      });
    }
    messages.forEach((m, i) => {
      if (i > 0 && messages[i - 1]!.role === m.role) {
        issue.addIssue({ code: 'custom', path: ['messages', i], message: 'roles must alternate' });
      }
      const max = m.role === 'user' ? USER_TEXT_MAX : ASSISTANT_TEXT_MAX;
      if (m.text.length > max)
        issue.addIssue({
          code: 'custom',
          path: ['messages', i, 'text'],
          message: `at most ${max} characters`,
        });
      if (m.role === 'assistant' && m.page) {
        issue.addIssue({ code: 'custom', path: ['messages', i, 'page'], message: 'only on user messages' });
      }
    });
  });

const orgParams = z.object({ orgId: z.uuid() });

export async function aiChatRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/orgs/:orgId/ai/chat', async (req, reply) => {
    requireSession(req);
    const body = parse(chatBody, req.body);
    const { orgId } = parse(orgParams, req.params);
    const org = await loadOrg(ctx, req, orgId);
    await ctx.ai.assertFeature('assistant');
    const gate = await aiRequestGate(ctx, req, org);
    await ctx.ai.chat(req, reply, { org, gate, body });
    // The reply was hijacked by the SSE writer (or an error was thrown before).
    return reply;
  });
}
