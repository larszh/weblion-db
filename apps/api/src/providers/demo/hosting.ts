import type {
  DnsRecord,
  DnsRecordInput,
  DomainInfo,
  WebspaceCredentials,
  WebspaceInfo,
} from '@weblion/shared';
import { notFound } from '../../lib/errors';
import type { DnsRecordPatch, RemoteDomain, RemoteWebspace } from '../types';

/**
 * Simulated domains and web spaces for the demo provider. Deterministic, kept in memory
 * per connection like the demo servers, so DNS edits survive adapter re-creation.
 */

interface DemoDomain {
  externalId: string;
  info: DomainInfo;
  authcode: string;
  records: DnsRecord[];
}

interface DemoWebspace {
  externalId: string;
  info: WebspaceInfo;
  password: string;
}

export interface DemoHostingState {
  domains: Map<string, DemoDomain>;
  webspaces: Map<string, DemoWebspace>;
  nextRecordId: number;
}

const STATE = new Map<string, DemoHostingState>();

const NAMESERVERS = ['ns1.fireapi.de', 'ns2.fireapi.de'];
const PANEL_URL = 'https://plesk.demo.weblion.one:8443';

type RecordSeed = [type: string, name: string, data: string];

const DOMAINS: { name: string; created: string; autoRenew: boolean; records: RecordSeed[] }[] = [
  {
    name: 'muster-ag.ch',
    created: '2019-04-02',
    autoRenew: true,
    records: [
      ['A', '@', '185.101.20.10'],
      ['AAAA', '@', '2a0e:3e9::10'],
      ['A', 'www', '185.101.20.10'],
      ['A', 'mail', '185.101.20.25'],
      ['MX', '@', '10 mail.muster-ag.ch'],
      ['TXT', '@', 'v=spf1 mx a:mail.muster-ag.ch -all'],
      ['TXT', '_dmarc', 'v=DMARC1; p=quarantine; rua=mailto:dmarc@muster-ag.ch'],
      ['CNAME', 'autodiscover', 'autodiscover.outlook.com'],
      ['CAA', '@', '0 issue "letsencrypt.org"'],
    ],
  },
  {
    name: 'muster-shop.ch',
    created: '2022-11-15',
    autoRenew: true,
    records: [
      ['A', '@', '185.101.20.11'],
      ['CNAME', 'www', 'muster-shop.ch'],
      ['MX', '@', '10 mail.muster-ag.ch'],
      ['TXT', '@', 'google-site-verification=Xq3v9cWm2LkR8tYp0zNdA7sHbEu4FjGi1oQ6KeTr5yU'],
    ],
  },
  {
    name: 'baeckerei-huber.ch',
    created: '2017-06-21',
    autoRenew: false,
    records: [
      ['A', '@', '45.84.196.164'],
      ['A', 'www', '45.84.196.164'],
      ['MX', '@', '10 mx.baeckerei-huber.ch'],
      ['A', 'mx', '45.84.196.164'],
      ['TXT', '@', 'v=spf1 a mx -all'],
    ],
  },
  {
    name: 'alpenblick-hotel.ch',
    created: '2020-02-03',
    autoRenew: true,
    records: [
      ['A', '@', '185.104.33.40'],
      ['AAAA', '@', '2a0e:3ec::40'],
      ['CNAME', 'www', 'alpenblick-hotel.ch'],
      ['MX', '@', '10 alpenblickhotel-ch.mail.protection.outlook.com'],
      ['TXT', '@', 'v=spf1 include:spf.protection.outlook.com -all'],
      ['SRV', '_sip._tls', '100 1 443 sipdir.online.lync.com'],
    ],
  },
];

const WEBSPACES: {
  product: string;
  username: string;
  email: string;
  created: string;
  resources: WebspaceInfo['resources'];
}[] = [
  {
    product: 'Plesk-Medium',
    username: 'musterag',
    email: 'it@muster.example',
    created: '2021-09-01',
    resources: {
      domains: 5,
      subdomains: 20,
      emails: 25,
      databases: 10,
      storageMb: 25 * 1024,
      trafficGb: null,
      memoryLimitMb: 256,
      ipAddress: '45.84.196.164',
    },
  },
  {
    product: 'Plesk-Small',
    username: 'huber',
    email: 'info@baeckerei-huber.example',
    created: '2023-03-05',
    resources: {
      domains: 1,
      subdomains: 5,
      emails: 3,
      databases: 3,
      storageMb: 5 * 1024,
      trafficGb: 500,
      memoryLimitMb: 128,
      ipAddress: '45.84.196.164',
    },
  },
  {
    product: 'Plesk-Large',
    username: 'alpenblick',
    email: 'web@alpenblick-hotel.example',
    created: '2020-02-03',
    resources: {
      domains: 10,
      subdomains: 50,
      emails: 100,
      databases: 25,
      storageMb: 75 * 1024,
      trafficGb: null,
      memoryLimitMb: 512,
      ipAddress: '45.84.196.170',
    },
  },
];

/** Next anniversary of `created` after today, at midnight UTC. */
function nextRenewal(created: string, now = new Date()): string {
  const [, month, day] = created.split('-').map(Number) as [number, number, number];
  let date = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));
  if (date <= now) date = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
  return date.toISOString();
}

function generate(): DemoHostingState {
  const state: DemoHostingState = { domains: new Map(), webspaces: new Map(), nextRecordId: 7_498_384 };
  DOMAINS.forEach((d, i) => {
    const externalId = `demo-dom-${i + 1}`;
    state.domains.set(externalId, {
      externalId,
      info: {
        name: d.name,
        status: 'OK',
        terminated: false,
        nameservers: [...NAMESERVERS],
        handle: `WLDEMO${i + 1}`,
        createdAt: `${d.created}T09:30:00.000Z`,
        expiresAt: nextRenewal(d.created),
        autoRenew: d.autoRenew,
      },
      authcode: `Wl${i + 1}+Demo-${d.name.slice(0, 4).toUpperCase()}#7q`,
      records: d.records.map(([type, name, data]) => ({
        id: String(state.nextRecordId++),
        type,
        name,
        data,
        ttl: 300,
      })),
    });
  });
  WEBSPACES.forEach((w, i) => {
    const externalId = `demo-web-${i + 1}`;
    state.webspaces.set(externalId, {
      externalId,
      info: {
        name: `${w.product} (${w.username})`,
        resources: { ...w.resources },
        panelUrl: PANEL_URL,
        username: w.username,
        email: w.email,
        expiresAt: nextRenewal(w.created),
      },
      password: `demo-${w.username}-Pl3sk!`,
    });
  });
  return state;
}

export function demoHostingState(connectionId: string): DemoHostingState {
  let state = STATE.get(connectionId);
  if (!state) {
    state = generate();
    STATE.set(connectionId, state);
  }
  return state;
}

export function resetDemoHosting() {
  STATE.clear();
}

export class DemoHosting {
  constructor(private readonly state: DemoHostingState) {}

  private domain(externalId: string): DemoDomain {
    const domain = this.state.domains.get(externalId);
    if (!domain) throw notFound('Demo domain');
    return domain;
  }

  private webspace(externalId: string): DemoWebspace {
    const webspace = this.state.webspaces.get(externalId);
    if (!webspace) throw notFound('Demo web space');
    return webspace;
  }

  listDomains(): RemoteDomain[] {
    return [...this.state.domains.values()].map((d) => ({
      externalId: d.externalId,
      name: d.info.name,
      status: d.info.status,
      info: structuredClone(d.info),
      meta: {},
    }));
  }

  getDomain(externalId: string): DomainInfo {
    return structuredClone(this.domain(externalId).info);
  }

  getDomainAuthcode(externalId: string): string | null {
    return this.domain(externalId).authcode;
  }

  listDnsRecords(externalId: string): DnsRecord[] {
    return this.domain(externalId).records.map((r) => ({ ...r }));
  }

  addDnsRecord(externalId: string, input: DnsRecordInput): DnsRecord {
    const record: DnsRecord = { id: String(this.state.nextRecordId++), ...input, ttl: 300 };
    this.domain(externalId).records.push(record);
    return { ...record };
  }

  updateDnsRecord(externalId: string, recordId: string, patch: DnsRecordPatch): DnsRecord {
    const record = this.domain(externalId).records.find((r) => r.id === recordId);
    if (!record) throw notFound('DNS record');
    if (patch.type !== undefined) record.type = patch.type;
    if (patch.name !== undefined) record.name = patch.name;
    if (patch.data !== undefined) record.data = patch.data;
    return { ...record };
  }

  deleteDnsRecord(externalId: string, recordId: string): void {
    const domain = this.domain(externalId);
    const before = domain.records.length;
    domain.records = domain.records.filter((r) => r.id !== recordId);
    if (domain.records.length === before) throw notFound('DNS record');
  }

  listWebspaces(): RemoteWebspace[] {
    return [...this.state.webspaces.values()].map((w) => ({
      externalId: w.externalId,
      name: w.info.name,
      info: structuredClone(w.info),
      meta: {},
    }));
  }

  getWebspace(externalId: string): WebspaceInfo {
    return structuredClone(this.webspace(externalId).info);
  }

  getWebspaceCredentials(externalId: string): WebspaceCredentials {
    const w = this.webspace(externalId);
    return {
      panelUrl: w.info.panelUrl,
      username: w.info.username,
      password: w.password,
      email: w.info.email,
    };
  }
}
