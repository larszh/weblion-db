import { describe, expect, it } from 'vitest';
import { DNS_TTL_AUTO, type DnsRecord } from '@weblion/shared';
import {
  DEFAULT_TTL,
  TTL_OPTIONS_AUTO,
  defaultTtl,
  formTtl,
  formatRemaining,
  isProxiable,
  newRecordInput,
  recordPatch,
  sameNameservers,
  type RecordForm,
  type RecordFormOptions,
} from './dns-format';

const cloudflare: RecordFormOptions = { withTtl: true, ttlAuto: true, withProxy: true };
const registrar: RecordFormOptions = { withTtl: true, ttlAuto: false, withProxy: false };

const form = (patch: Partial<RecordForm> = {}): RecordForm => ({
  type: 'A',
  name: '@',
  data: '185.101.20.11',
  ttl: DNS_TTL_AUTO,
  proxied: false,
  ...patch,
});

const record = (patch: Partial<DnsRecord> = {}): DnsRecord => ({
  id: 'd0000000000000000000000000000001',
  type: 'A',
  name: '@',
  data: '185.101.20.11',
  ttl: DNS_TTL_AUTO,
  proxied: true,
  proxiable: true,
  comment: null,
  ...patch,
});

describe('TTL choices', () => {
  it('offers automatic first, then 60 s to one day', () => {
    expect(TTL_OPTIONS_AUTO[0]).toBe(DNS_TTL_AUTO);
    expect(TTL_OPTIONS_AUTO.slice(1).every((ttl) => ttl >= 60 && ttl <= 86_400)).toBe(true);
    expect([...TTL_OPTIONS_AUTO]).toEqual([...TTL_OPTIONS_AUTO].sort((a, b) => a - b));
  });

  it('defaults to automatic only where the provider has it', () => {
    expect(defaultTtl(cloudflare)).toBe(DNS_TTL_AUTO);
    expect(defaultTtl(registrar)).toBe(DEFAULT_TTL);
  });
});

describe('isProxiable', () => {
  it('accepts A, AAAA and CNAME in any case, nothing else', () => {
    expect(['A', 'AAAA', 'CNAME', 'cname'].every(isProxiable)).toBe(true);
    expect(['MX', 'TXT', 'SRV', 'CAA', 'NS', 'ALIAS', 'HTTPS', ''].some(isProxiable)).toBe(false);
  });
});

describe('newRecordInput', () => {
  it('sends the proxy flag and forces the automatic TTL for proxied records', () => {
    expect(newRecordInput(form({ ttl: 3600, proxied: true }), cloudflare)).toEqual({
      type: 'A',
      name: '@',
      data: '185.101.20.11',
      ttl: DNS_TTL_AUTO,
      proxied: true,
    });
    expect(newRecordInput(form({ ttl: 3600 }), cloudflare)).toMatchObject({ ttl: 3600, proxied: false });
  });

  it('never sends proxied for types a proxy cannot carry', () => {
    const input = newRecordInput(
      form({ type: 'MX', data: '10 mail.example.ch', ttl: 300, proxied: true }),
      cloudflare,
    );
    expect(input).not.toHaveProperty('proxied');
    expect(input.ttl).toBe(300);
  });

  it('leaves the proxy out at providers without one', () => {
    const input = newRecordInput(form({ ttl: 3600, proxied: true }), registrar);
    expect(input).toEqual({ type: 'A', name: '@', data: '185.101.20.11', ttl: 3600 });
    expect(newRecordInput(form(), { ...registrar, withTtl: false })).not.toHaveProperty('ttl');
  });
});

describe('recordPatch', () => {
  it('is empty when nothing changed', () => {
    expect(recordPatch(record(), form({ proxied: true }), cloudflare)).toEqual({});
    expect(recordPatch(record({ name: '' }), form({ proxied: true }), cloudflare)).toEqual({});
  });

  it('sends proxied alone when only the proxy changed', () => {
    expect(recordPatch(record(), form({ proxied: false }), cloudflare)).toEqual({ proxied: false });
    expect(recordPatch(record({ proxied: false }), form({ proxied: true }), cloudflare)).toEqual({
      proxied: true,
    });
  });

  it('turns the proxy on with the automatic TTL', () => {
    const current = record({ proxied: false, ttl: 3600 });
    expect(recordPatch(current, form({ ttl: 3600, proxied: true }), cloudflare)).toEqual({
      proxied: true,
      ttl: DNS_TTL_AUTO,
    });
  });

  it('turns the proxy off when the type changes to one a proxy cannot carry', () => {
    const patch = recordPatch(record(), form({ type: 'TXT', data: 'hello', proxied: true }), cloudflare);
    expect(patch).toEqual({ type: 'TXT', data: 'hello', proxied: false });
  });

  it('keeps an unknown TTL and the proxy untouched at registrars', () => {
    const current = record({ proxied: undefined, proxiable: undefined, ttl: null });
    expect(recordPatch(current, form({ ttl: DEFAULT_TTL, proxied: true }), registrar)).toEqual({});
    expect(recordPatch(current, form({ ttl: 300 }), registrar)).toEqual({ ttl: 300 });
  });

  it('only sends the changed name and data', () => {
    expect(recordPatch(record(), form({ name: 'www', proxied: true }), cloudflare)).toEqual({ name: 'www' });
    expect(recordPatch(record(), form({ data: '185.101.20.12', proxied: true }), cloudflare)).toEqual({
      data: '185.101.20.12',
    });
  });

  it('shows the automatic TTL in the form while proxied', () => {
    expect(formTtl(form({ ttl: 3600, proxied: true }), cloudflare)).toBe(DNS_TTL_AUTO);
    expect(formTtl(form({ type: 'MX', ttl: 3600, proxied: true }), cloudflare)).toBe(3600);
  });
});

describe('sameNameservers', () => {
  it('ignores order, case and trailing dots', () => {
    expect(
      sameNameservers(
        ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
        ['BOB.ns.cloudflare.com.', 'ana.ns.cloudflare.com'],
      ),
    ).toBe(true);
  });

  it('needs the same set and at least one entry', () => {
    expect(
      sameNameservers(['ana.ns.cloudflare.com'], ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com']),
    ).toBe(false);
    expect(
      sameNameservers(
        ['a.ns.joker.com', 'b.ns.joker.com'],
        ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      ),
    ).toBe(false);
    expect(sameNameservers([], [])).toBe(false);
  });
});

describe('formatRemaining', () => {
  it('rounds up to whole minutes and never shows 0 while on', () => {
    expect(formatRemaining(1)).toBe('1 min');
    expect(formatRemaining(59)).toBe('1 min');
    expect(formatRemaining(60)).toBe('1 min');
    expect(formatRemaining(61)).toBe('2 min');
  });

  it('shows hours and minutes for longer times', () => {
    expect(formatRemaining(10_800)).toBe('3 h');
    expect(formatRemaining(10_799)).toBe('3 h');
    expect(formatRemaining(8_101)).toBe('2 h 16 min');
    expect(formatRemaining(3_600)).toBe('1 h');
  });

  it('is empty when nothing remains', () => {
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-120)).toBeNull();
    expect(formatRemaining(null)).toBeNull();
    expect(formatRemaining(Number.NaN)).toBeNull();
  });
});
