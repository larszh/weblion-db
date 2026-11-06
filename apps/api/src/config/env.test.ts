import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { fastifyTrustProxy, loadEnv, parseTrustProxy, type TrustProxy } from './env';

const base = {
  DATABASE_URL: 'postgres://weblion:weblion@localhost:5432/weblion_test',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

/** The client IP that Fastify reports for one request, with the trustProxy the app would use. */
async function clientIp(setting: TrustProxy, remoteAddress: string, forwardedFor?: string): Promise<string> {
  const app = Fastify({ trustProxy: fastifyTrustProxy(setting) });
  app.get('/', async (req) => ({ ip: req.ip }));
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return (res.json() as { ip: string }).ip;
  } finally {
    await app.close();
  }
}

describe('TRUST_PROXY', () => {
  it('trusts only loopback when unset or empty', () => {
    expect(loadEnv(base).TRUST_PROXY).toEqual(['loopback']);
    expect(loadEnv({ ...base, TRUST_PROXY: '' }).TRUST_PROXY).toEqual(['loopback']);
    expect(loadEnv({ ...base, TRUST_PROXY: '  ' }).TRUST_PROXY).toEqual(['loopback']);
  });

  it('keeps true and false of existing installations', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
    expect(parseTrustProxy('yes')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('off')).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });

  it('reads a whole number as hops and 0 as no proxy', () => {
    expect(loadEnv({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('reads a list of addresses, ranges and names', () => {
    expect(loadEnv({ ...base, TRUST_PROXY: '10.0.0.0/8,127.0.0.1' }).TRUST_PROXY).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(parseTrustProxy(' Loopback , uniquelocal,fd00::/8, 192.168.0.0/255.255.0.0 ')).toEqual([
      'loopback',
      'uniquelocal',
      'fd00::/8',
      '192.168.0.0/255.255.0.0',
    ]);
  });

  it('refuses values Fastify could not use', () => {
    for (const value of [
      'localhost',
      '10.0.0.0/33',
      '::1/129',
      '10.0.0.1/8/8',
      'fd00::/255.0.0.0',
      ',',
      '-1',
      '1.5',
    ]) {
      expect(() => loadEnv({ ...base, TRUST_PROXY: value }), value).toThrow(/TRUST_PROXY/);
    }
  });

  it('refuses the ranges proxy-addr refuses and accepts the ones it builds', () => {
    // A range of 0 and a netmask with gaps: Fastify throws a bare TypeError for them when it is built.
    for (const value of [
      '0.0.0.0/0',
      '::/0',
      '10.0.0.0/0.0.0.0',
      '10.0.0.0/255.0.255.0',
      '10.0.0.0/0.0.0.1',
    ]) {
      expect(() => loadEnv({ ...base, TRUST_PROXY: value }), value).toThrow(/TRUST_PROXY/);
      expect(() => Fastify({ trustProxy: [value] }), value).toThrow(/invalid range/);
    }
    for (const value of [
      '10.0.0.0/1',
      '10.0.0.0/32',
      '::/1',
      '::1/128',
      '10.0.0.0/128.0.0.0',
      '10.0.0.0/255.255.255.0',
      '10.0.0.0/255.255.255.255',
    ]) {
      const setting = loadEnv({ ...base, TRUST_PROXY: value }).TRUST_PROXY;
      expect(setting, value).toEqual([value]);
      expect(() => Fastify({ trustProxy: fastifyTrustProxy(setting) }), value).not.toThrow();
    }
  });

  it('believes X-Forwarded-For by default only from loopback', async () => {
    const setting = loadEnv(base).TRUST_PROXY;
    expect(await clientIp(setting, '203.0.113.9', '198.51.100.7')).toBe('203.0.113.9');
    expect(await clientIp(setting, '127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
    expect(await clientIp(setting, '::1', '198.51.100.7')).toBe('198.51.100.7');
    // A forged entry in front of the one the local proxy appended stays ignored.
    expect(await clientIp(setting, '127.0.0.1', '6.6.6.6, 198.51.100.7')).toBe('198.51.100.7');
  });

  it('passes lists, true, false and hop counts to Fastify with their meaning', async () => {
    expect(await clientIp(['10.0.0.0/8'], '10.1.2.3', '198.51.100.7')).toBe('198.51.100.7');
    expect(await clientIp(['10.0.0.0/8'], '127.0.0.1', '198.51.100.7')).toBe('127.0.0.1');
    expect(await clientIp(true, '203.0.113.9', '6.6.6.6, 198.51.100.7')).toBe('6.6.6.6');
    expect(await clientIp(false, '127.0.0.1', '198.51.100.7')).toBe('127.0.0.1');
    // Fastify itself ignores a number; the trust function counts the hops from the socket.
    expect(await clientIp(1, '10.1.2.3', '6.6.6.6, 198.51.100.7')).toBe('198.51.100.7');
    expect(await clientIp(2, '10.1.2.3', '6.6.6.6, 198.51.100.7')).toBe('6.6.6.6');
  });
});
