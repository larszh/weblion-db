import type { MailPasswordPolicy, MailRateLimit } from '@weblion/shared';
import type { DkimKey } from '../types';

/**
 * Simulated Mailcow for the demo provider: mail domains, mailboxes, aliases and DKIM keys,
 * kept in memory per connection like the other demo data. Placeholder until the simulation
 * is implemented: the names below are the contract the demo adapter and the tests use.
 */

export const DEMO_MAIL_HOST = 'mail.demo.weblion.one';
/** Like Mailcow's example values: 8 characters, letters, upper and lower case. */
export const DEMO_MAIL_POLICY: MailPasswordPolicy = {
  minLength: 8,
  letters: true,
  mixedCase: true,
  digits: false,
  specialChars: false,
};

export interface DemoMailbox {
  localPart: string;
  name: string | null;
  /** MiB, 0 = unlimited (only seeded, the panel never creates one). */
  quotaMb: number;
  usedBytes: number;
  messages: number;
  /** Mailcow's values: 1 active, 2 login disabled (still receives), 0 inactive. */
  active: 0 | 1 | 2;
  lastLoginAt: string | null;
  createdAt: string;
  modifiedAt: string | null;
  /** Kept only to mimic Mailcow (and for tests); never returned. */
  password: string;
}

export interface DemoAlias {
  id: number;
  /** "team@muster-ag.ch", or "@muster-ag.ch" for the catch-all. */
  address: string;
  /** Lower-case targets, or exactly one of null@localhost, spam@localhost, ham@localhost. */
  goto: string[];
  active: boolean;
  createdAt: string;
  modifiedAt: string | null;
}

export interface DemoMailDomain {
  /** ASCII name, the map key. */
  name: string;
  displayName: string;
  description: string | null;
  active: boolean;
  relay: boolean;
  maxMailboxes: number;
  maxAliases: number;
  quotaMb: number;
  defaultMailboxQuotaMb: number;
  maxMailboxQuotaMb: number;
  rateLimit: MailRateLimit | null;
  /** Key: local part. */
  mailboxes: Map<string, DemoMailbox>;
  /** Key: alias id. Mailbox self aliases are not kept (Mailcow does not list them either). */
  aliases: Map<number, DemoAlias>;
  createdAt: string;
  modifiedAt: string | null;
}

export interface DemoMailState {
  /** Key: ASCII name. */
  domains: Map<string, DemoMailDomain>;
  /** Key: ASCII name. Outlives a deleted domain, like Mailcow's Redis keys. */
  dkim: Map<string, DkimKey>;
  nextAliasId: number;
  policy: MailPasswordPolicy;
}

/** The state of one demo connection. */
export function demoMailState(_connectionId: string): DemoMailState {
  return { domains: new Map(), dkim: new Map(), nextAliasId: 100, policy: { ...DEMO_MAIL_POLICY } };
}

/** Test helper: forget all simulated mail state. */
export function resetDemoMail(): void {}
