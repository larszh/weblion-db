import { describe, expect, it } from 'vitest';
import {
  DNS_RECORD_TYPES,
  type DnsRecord,
  type MailDnsRecordDto,
  type MailDnsRecordKey,
} from '@weblion/shared';
import {
  MAIL_DMARC_VALUE,
  MAIL_SPF_VALUE,
  evaluateMailRecords,
  expectedMailRecords,
  type MailZoneCheck,
} from '../src/modules/mail/dns';
import type { DkimKey } from '../src/providers/types';

const DOMAIN = 'kunde.ch';
const HOST = 'mail.weblion.one';
const PUBKEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx1y2z3AbCdEfGh';
const DKIM: DkimKey = {
  selector: 'dkim',
  publicKey: PUBKEY,
  keyLength: '2048',
  txt: `v=DKIM1;k=rsa;t=s;s=email;p=${PUBKEY}`,
};
const ZONE: MailZoneCheck = { writable: true, canEdit: true, types: [...DNS_RECORD_TYPES] };

let nextId = 1;
const rec = (type: string, name: string, data: string): DnsRecord => ({
  id: String(nextId++),
  type,
  name,
  data,
  ttl: 3600,
});

function evaluate(
  records: DnsRecord[] | null,
  options: { dkim?: DkimKey | null; zone?: MailZoneCheck | null } = {},
): Record<MailDnsRecordKey, MailDnsRecordDto> {
  const dkim = options.dkim === undefined ? DKIM : options.dkim;
  const zone = options.zone === undefined ? ZONE : options.zone;
  const result = evaluateMailRecords(DOMAIN, HOST, expectedMailRecords(DOMAIN, HOST, dkim), records, zone);
  return Object.fromEntries(result.map((r) => [r.key, r])) as Record<MailDnsRecordKey, MailDnsRecordDto>;
}

/** A zone with everything Mailcow needs. */
const complete = () => [
  rec('MX', '@', `10 ${HOST}`),
  rec('TXT', '@', MAIL_SPF_VALUE),
  rec('TXT', 'dkim._domainkey', DKIM.txt),
  rec('TXT', '_dmarc', MAIL_DMARC_VALUE),
  rec('CNAME', 'autodiscover', HOST),
  rec('CNAME', 'autoconfig', HOST),
  rec('SRV', '_autodiscover._tcp', `0 1 443 ${HOST}`),
];

describe('expected records', () => {
  it('lists the seven records with relative names and generic values', () => {
    expect(expectedMailRecords(DOMAIN, HOST, DKIM)).toEqual([
      { key: 'mx', type: 'MX', name: '@', data: `10 ${HOST}`, required: true },
      { key: 'spf', type: 'TXT', name: '@', data: 'v=spf1 mx ~all', required: true },
      { key: 'dkim', type: 'TXT', name: 'dkim._domainkey', data: DKIM.txt, required: true },
      { key: 'dmarc', type: 'TXT', name: '_dmarc', data: 'v=DMARC1; p=none', required: false },
      { key: 'autodiscover', type: 'CNAME', name: 'autodiscover', data: HOST, required: false },
      { key: 'autoconfig', type: 'CNAME', name: 'autoconfig', data: HOST, required: false },
      {
        key: 'autodiscover_srv',
        type: 'SRV',
        name: '_autodiscover._tcp',
        data: `0 1 443 ${HOST}`,
        required: false,
      },
    ]);
  });

  it('uses the key selector, and an empty DKIM value without a key', () => {
    const custom = expectedMailRecords(DOMAIN, HOST, { ...DKIM, selector: 's2026' });
    expect(custom.find((r) => r.key === 'dkim')).toMatchObject({ name: 's2026._domainkey', data: DKIM.txt });
    const none = expectedMailRecords(DOMAIN, HOST, null);
    expect(none.find((r) => r.key === 'dkim')).toMatchObject({ name: 'dkim._domainkey', data: '' });
  });
});

describe('evaluating a zone', () => {
  it('finds a complete zone ok, with FQDNs and the found values', () => {
    const result = evaluate(complete());
    for (const record of Object.values(result)) {
      expect(record, record.key).toMatchObject({ status: 'ok', hint: null, addable: false });
    }
    expect(result.mx).toMatchObject({ fqdn: DOMAIN, found: [`10 ${HOST}`], required: true });
    expect(result.autodiscover_srv.fqdn).toBe(`_autodiscover._tcp.${DOMAIN}`);
    expect(result.dmarc.required).toBe(false);
  });

  it('marks everything missing and addable in an empty zone, DKIM included', () => {
    const result = evaluate([rec('A', '@', '192.0.2.1')]);
    for (const record of Object.values(result)) {
      expect(record, record.key).toMatchObject({ status: 'missing', hint: null, found: [], addable: true });
    }
  });

  it('accepts names given as "", "@" and fully qualified, with and without the dot', () => {
    const result = evaluate([
      rec('MX', '', `10 ${HOST}.`),
      rec('TXT', 'KUNDE.CH.', MAIL_SPF_VALUE),
      rec('TXT', `dkim._domainkey.${DOMAIN}`, DKIM.txt),
      rec('TXT', `_dmarc.${DOMAIN}.`, MAIL_DMARC_VALUE),
      rec('CNAME', 'Autodiscover', `${HOST.toUpperCase()}.`),
      rec('CNAME', `autoconfig.${DOMAIN}`, HOST),
      rec('SRV', '_autodiscover._tcp', `10 5 443 ${HOST}.`),
    ]);
    expect(Object.values(result).map((r) => r.status)).toEqual(Array(7).fill('ok'));
    expect(evaluate([rec('MX', '@', `10 ${HOST}`)]).mx.status).toBe('ok');
  });

  it('compares TXT values without quotes and with collapsed spaces', () => {
    const half = Math.floor(DKIM.txt.length / 2);
    const result = evaluate([
      rec('MX', '@', `10 ${HOST}`),
      rec('TXT', '@', '"v=spf1   mx ~all"'),
      // Split into two strings like a 255 character zone file chunking.
      rec('TXT', 'dkim._domainkey', `"${DKIM.txt.slice(0, half)}" "${DKIM.txt.slice(half)}"`),
      rec('TXT', '_dmarc', '"v=DMARC1;  p=reject;  rua=mailto:dmarc@kunde.ch"'),
    ]);
    expect(result.spf.status).toBe('ok');
    expect(result.dkim.status).toBe('ok');
    expect(result.dmarc.status).toBe('ok');
    // Mailcow's own spacing ("v=DKIM1; k=rsa; ... p=...") matches as well.
    const spaced = `v=DKIM1; k=rsa; t=s; s=email; p=${PUBKEY.slice(0, 20)} ${PUBKEY.slice(20)}`;
    expect(evaluate([rec('TXT', 'dkim._domainkey', spaced)]).dkim.status).toBe('ok');
  });

  it('mx: conflict for other mail servers, missing without MX', () => {
    const other = evaluate([rec('MX', '@', '10 mx.other.example'), rec('MX', '@', '20 mx2.other.example')]);
    expect(other.mx).toMatchObject({
      status: 'conflict',
      hint: 'other_mx',
      found: ['10 mx.other.example', '20 mx2.other.example'],
      addable: false,
    });
    // An MX elsewhere in the zone is no MX of the domain.
    expect(evaluate([rec('MX', 'shop', `10 ${HOST}`)]).mx.status).toBe('missing');
    expect(evaluate([rec('MX', '@', `10 ${HOST}`), rec('MX', '@', '20 backup.example')]).mx).toMatchObject({
      status: 'ok',
      found: [`10 ${HOST}`],
    });
  });

  it('spf: ok with a:, include: or mx while the MX is ok; conflicts otherwise', () => {
    const withMx = (spf: string) => evaluate([rec('MX', '@', `10 ${HOST}`), rec('TXT', '@', spf)]).spf;
    const withoutMx = (spf: string) =>
      evaluate([rec('MX', '@', '10 mx.other.example'), rec('TXT', '@', spf)]).spf;
    expect(withMx('v=spf1 mx -all').status).toBe('ok');
    expect(withMx('v=spf1 +mx ~all').status).toBe('ok');
    // "mx" only counts while the MX points to the mail server.
    expect(withoutMx('v=spf1 mx -all')).toMatchObject({ status: 'conflict', hint: 'other_spf' });
    expect(withoutMx(`v=spf1 a:${HOST} -all`).status).toBe('ok');
    expect(withoutMx(`v=spf1 include:${HOST} ~all`).status).toBe('ok');
    expect(withMx('v=spf1 include:spf.protection.outlook.com -all')).toMatchObject({
      status: 'conflict',
      hint: 'other_spf',
      found: ['v=spf1 include:spf.protection.outlook.com -all'],
    });
    const several = evaluate([rec('TXT', '@', 'v=spf1 mx -all'), rec('TXT', '@', 'v=spf1 a -all')]).spf;
    expect(several).toMatchObject({ status: 'conflict', hint: 'several_spf' });
    expect(several.found).toHaveLength(2);
    // Other TXT records at the apex are no SPF record.
    expect(evaluate([rec('TXT', '@', 'google-site-verification=abc')]).spf).toMatchObject({
      status: 'missing',
      found: [],
      addable: true,
    });
  });

  it('dkim: conflict for another key, missing without record or without a key at Mailcow', () => {
    const other = evaluate([rec('TXT', 'dkim._domainkey', 'v=DKIM1; k=rsa; p=MIIBotherkey')]).dkim;
    expect(other).toMatchObject({
      status: 'conflict',
      hint: 'other_dkim_key',
      found: ['v=DKIM1; k=rsa; p=MIIBotherkey'],
    });
    expect(evaluate([rec('TXT', 'dkim._domainkey', 'just a note')]).dkim.status).toBe('missing');

    const noKey = evaluate([rec('TXT', 'dkim._domainkey', 'v=DKIM1; p=MIIBold')], { dkim: null }).dkim;
    expect(noKey).toMatchObject({
      status: 'missing',
      hint: 'no_dkim_key',
      data: '',
      found: ['v=DKIM1; p=MIIBold'],
      addable: false,
    });
    expect(evaluate([], { dkim: null }).dkim).toMatchObject({
      status: 'missing',
      hint: 'no_dkim_key',
      addable: false,
    });
  });

  it('dmarc: any policy is ok, several conflict, other TXT records do not count', () => {
    expect(
      evaluate([rec('TXT', '_dmarc', 'v=DMARC1; p=quarantine; rua=mailto:x@kunde.ch')]).dmarc.status,
    ).toBe('ok');
    expect(
      evaluate([rec('TXT', '_dmarc', 'v=DMARC1; p=none'), rec('TXT', '_dmarc', 'v=DMARC1; p=reject')]).dmarc,
    ).toMatchObject({ status: 'conflict', hint: 'several_dmarc' });
    expect(evaluate([rec('TXT', '_dmarc', 'something else')]).dmarc.status).toBe('missing');
  });

  it('autodiscover and autoconfig: other targets and other records conflict', () => {
    const result = evaluate([
      rec('CNAME', 'autodiscover', 'autodiscover.outlook.com'),
      rec('A', 'autoconfig', '192.0.2.10'),
    ]);
    expect(result.autodiscover).toMatchObject({
      status: 'conflict',
      hint: 'other_target',
      found: ['autodiscover.outlook.com'],
    });
    expect(result.autoconfig).toMatchObject({
      status: 'conflict',
      hint: 'name_in_use',
      found: ['192.0.2.10'],
    });
  });

  it('autodiscover SRV: needs port 443 and the mail host', () => {
    expect(evaluate([rec('SRV', '_autodiscover._tcp', `0 1 443 ${HOST}`)]).autodiscover_srv.status).toBe(
      'ok',
    );
    expect(evaluate([rec('SRV', '_autodiscover._tcp', `0 1 8443 ${HOST}`)]).autodiscover_srv).toMatchObject({
      status: 'conflict',
      hint: 'other_target',
    });
    expect(
      evaluate([rec('SRV', '_autodiscover._tcp', '0 1 443 autodiscover.outlook.com')]).autodiscover_srv.hint,
    ).toBe('other_target');
    // Records of other types at that name are not SRV records.
    expect(evaluate([rec('TXT', '_autodiscover._tcp', 'x')]).autodiscover_srv.status).toBe('missing');
  });

  it('reports every status unknown without records, and nothing addable', () => {
    const result = evaluate(null);
    for (const record of Object.values(result)) {
      expect(record, record.key).toMatchObject({ status: 'unknown', found: [], addable: false });
    }
    expect(evaluate(null, { dkim: null, zone: null }).dkim.hint).toBe('no_dkim_key');
    expect(evaluate(null, { zone: null }).mx.hint).toBeNull();
  });

  it('flags types the provider does not take', () => {
    const zone = { ...ZONE, types: ZONE.types.filter((t) => t !== 'SRV') };
    const result = evaluate([], { zone });
    expect(result.autodiscover_srv).toMatchObject({
      status: 'missing',
      hint: 'type_not_supported',
      addable: false,
    });
    expect(result.mx).toMatchObject({ hint: null, addable: true });
  });

  it('adds nothing without permission, a writable zone or a zone at all', () => {
    for (const zone of [{ ...ZONE, canEdit: false }, { ...ZONE, writable: false }, null]) {
      const result = evaluate([], { zone });
      for (const record of Object.values(result)) {
        expect(record.status).toBe('missing');
        expect(record.addable, `${record.key} ${JSON.stringify(zone)}`).toBe(false);
      }
    }
    // Without a zone nothing is known about the types either.
    expect(evaluate([], { zone: null }).autodiscover_srv.hint).toBeNull();
  });
});
