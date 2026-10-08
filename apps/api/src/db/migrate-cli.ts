import { loadEnv } from '../config/env';
import { createDb } from './client';
import { runMigrations } from './migrate';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
await runMigrations(db);
await pool.end();
console.log('migrations applied');
