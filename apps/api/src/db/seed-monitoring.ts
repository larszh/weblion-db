import type { Database } from './client';

/**
 * Demo data for monitoring: monitors of the demo connection assigned to Muster AG and Bäckerei
 * Huber (one of Muster AG's as a console monitor), the "monitoring" module for Muster AG only
 * (Alpen Hosting and Bäckerei Huber keep the modules the reseller seed gave them, like the cloud
 * seed), allowances for Muster AG and Alpen Hosting and Muster AG's status page link. Runs the
 * monitor sync once when the connection has no monitor rows yet. Idempotent. Called from seedDemo
 * after the hosting and cloud seeds. Placeholder until the seed is implemented.
 */
export async function seedMonitoringDemo(_db: Database, _log: string[]): Promise<void> {}
