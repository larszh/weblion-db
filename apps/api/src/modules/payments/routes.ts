import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';

/** Online payments (Stripe Checkout incl. TWINT) and the Stripe webhook. */
export async function paymentRoutes(_app: FastifyInstance, _ctx: AppContext) {}
