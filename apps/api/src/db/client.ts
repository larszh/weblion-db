import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(databaseUrl: string): { db: Database; pool: pg.Pool } {
  // A request that waits this long for a connection fails instead of queueing forever.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };

/** A transaction handle, for helpers that must run inside `db.transaction`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the database or a transaction. Helpers that work in both accept this. */
export type DbOrTx = Database | Tx;
