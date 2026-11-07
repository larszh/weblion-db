import { describe, expect, it } from 'vitest';
import { todayZurich } from './billing';

describe('todayZurich', () => {
  it("is the Zurich calendar day whatever the process's time zone", () => {
    const tz = process.env.TZ;
    try {
      for (const zone of ['Asia/Singapore', 'America/New_York', 'UTC']) {
        process.env.TZ = zone;
        // 23:30 in Zurich on 30 November (winter time, UTC+1).
        expect(todayZurich(new Date('2026-11-30T22:30:00Z'))).toBe('2026-11-30');
        // 00:30 on 1 December in Zurich.
        expect(todayZurich(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01');
        // Summer time (UTC+2): 00:30 on 1 July.
        expect(todayZurich(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});
