import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { organizations } from '../src/db/schema';
import { parseSse } from './claude-mock';
import { Client, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let anna: Client;
let musterId: string;

beforeAll(async () => {
  t = await createTestApp();
  anna = new Client(t.app);
  await anna.login('anna@muster.example');
  const muster = await t.db.query.organizations.findFirst({ where: eq(organizations.slug, 'muster-ag') });
  musterId = muster!.id;
});
afterAll(() => t.close());

describe('explore', () => {
  it('chat', async () => {
    const res = await anna.post(`/orgs/${musterId}/ai/chat`, {
      messages: [{ role: 'user', text: 'Wie viele Server habe ich?', page: { path: '/o/muster-ag', title: null } }],
      locale: 'de',
    });
    console.log(res.statusCode, res.headers['content-type']);
    console.log(JSON.stringify(parseSse(res.body), null, 1).slice(0, 3000));
    const res2 = await anna.post(`/orgs/${musterId}/ai/chat`, {
      messages: [{ role: 'user', text: 'Ist DMARC für meine E-Mail eingerichtet?', page: null }],
      locale: 'de',
    });
    console.log(JSON.stringify(parseSse(res2.body), null, 1).slice(0, 4000));
    expect(res.statusCode).toBe(200);
  });
});
