import { describe, expect, it } from 'vitest';
import { mailDnsApplyOutcome } from './dns-apply';

describe('mailDnsApplyOutcome', () => {
  it('calls it added only when records were added and none failed', () => {
    expect(mailDnsApplyOutcome({ added: ['mx', 'spf'], failed: [] })).toBe('added');
    expect(mailDnsApplyOutcome({ added: ['mx'], failed: [{ key: 'spf', error: 'zone locked' }] })).toBe(
      'partial',
    );
    // Every write refused (zone error, missing permission): nothing is in the zone.
    expect(
      mailDnsApplyOutcome({
        added: [],
        failed: [
          { key: 'mx', error: 'zone locked' },
          { key: 'spf', error: 'zone locked' },
        ],
      }),
    ).toBe('failed');
    // Everything skipped.
    expect(mailDnsApplyOutcome({ added: [], failed: [] })).toBe('nothing');
  });
});
