import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/** Finds the drizzle folder both from source (src/db) and from the bundle (dist). */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
    resolve(process.cwd(), 'drizzle'),
  ];
  const found = candidates.find((dir) => existsSync(resolve(dir, 'meta/_journal.json')));
  if (!found) throw new Error(`Could not find migrations folder, looked in: ${candidates.join(', ')}`);
  return found;
}

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
