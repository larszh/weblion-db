import { describe, expect, it } from 'vitest';
import {
  expectedMediaPolicy,
  isMediaAccountCode,
  isMediaAccountName,
  mediaAccessExceeds,
  mediaActivityDay,
  mediaPasswordIssues,
  mediaPolicyDrift,
  mediaUsername,
  normalizeMediaId,
  type MediaAccess,
} from './media';

const FILME = '847f61bc736e6f8ef0f5542f43496822';
const SERIEN = 'd91225786a8ac15d78c0c1ea46a12d75';
const KINDER = '9f0ef2e22ac1ffae415e6ddd9696b76d';

/** A reseller's access; tests change single fields. */
const access = (patch: Partial<MediaAccess> = {}): MediaAccess => ({
  libraryIds: [FILME, SERIEN],
  maxStreams: 3,
  downloads: true,
  remoteBitrateMbit: 20,
  ...patch,
});

describe('login names', () => {
  it('accepts lower-case names with single dashes', () => {
    for (const name of ['anna', 'kids2', 'anna-maria', 'a', 'x'.repeat(20)]) {
      expect(isMediaAccountName(name)).toBe(true);
    }
  });

  it('refuses upper case, dashes at the ends, double dashes, other characters and lengths', () => {
    for (const name of [
      'Anna',
      '-anna',
      'anna-',
      'an--na',
      'a_b',
      'x'.repeat(21),
      '',
      'änna',
      'anna kemaro',
    ]) {
      expect(isMediaAccountName(name)).toBe(false);
    }
  });

  it('checks account codes', () => {
    expect(isMediaAccountCode('kemaro')).toBe(true);
    expect(isMediaAccountCode('abc')).toBe(true);
    expect(isMediaAccountCode('ab')).toBe(false);
    expect(isMediaAccountCode('kemaro1')).toBe(false);
    expect(isMediaAccountCode('a'.repeat(13))).toBe(false);
    expect(isMediaAccountCode('Kemaro')).toBe(false);
  });

  it('joins name and code with a dash', () => {
    expect(mediaUsername('anna', 'kemaro')).toBe('anna-kemaro');
    expect(mediaUsername('anna-maria', 'kemaro')).toBe('anna-maria-kemaro');
  });
});

describe('mediaPasswordIssues', () => {
  it('checks the length in characters', () => {
    expect(mediaPasswordIssues('a'.repeat(9))).toEqual(['length']);
    expect(mediaPasswordIssues('a'.repeat(10))).toEqual([]);
    expect(mediaPasswordIssues('a'.repeat(128))).toEqual([]);
    expect(mediaPasswordIssues('a'.repeat(129))).toEqual(['tooLong']);
    expect(mediaPasswordIssues('äöüäöüäöüä')).toEqual([]);
  });

  it('refuses control characters and spaces at the ends', () => {
    expect(mediaPasswordIssues(' abcdefghijk')).toEqual(['characters']);
    expect(mediaPasswordIssues('abcdefghijk ')).toEqual(['characters']);
    expect(mediaPasswordIssues('abcde\tfghijk')).toEqual(['characters']);
    expect(mediaPasswordIssues('abcde\u0007fghijk')).toEqual(['characters']);
    expect(mediaPasswordIssues('abcde fghijk')).toEqual([]);
  });
});

describe('normalizeMediaId', () => {
  it('keeps the N form and lower-cases', () => {
    expect(normalizeMediaId(FILME)).toBe(FILME);
    expect(normalizeMediaId(FILME.toUpperCase())).toBe(FILME);
    expect(normalizeMediaId(` ${FILME} `)).toBe(FILME);
  });

  it('removes the dashes of the D form', () => {
    expect(normalizeMediaId('847F61BC-736E-6F8E-F0F5-542F43496822')).toBe(FILME);
  });

  it('refuses braces, wrong lengths and other characters', () => {
    expect(normalizeMediaId('{847f61bc-736e-6f8e-f0f5-542f43496822}')).toBeNull();
    expect(normalizeMediaId(FILME.slice(1))).toBeNull();
    expect(normalizeMediaId(`${FILME}0`)).toBeNull();
    expect(normalizeMediaId(FILME.replace('8', 'g'))).toBeNull();
    expect(normalizeMediaId('')).toBeNull();
  });
});

describe('mediaAccessExceeds', () => {
  it('is empty within the parent', () => {
    expect(
      mediaAccessExceeds(
        access({ libraryIds: [FILME], maxStreams: 2, downloads: false, remoteBitrateMbit: 8 }),
        access(),
      ),
    ).toEqual([]);
    expect(mediaAccessExceeds(access(), access())).toEqual([]);
  });

  it('reports each conflict alone', () => {
    expect(mediaAccessExceeds(access({ libraryIds: [FILME, KINDER] }), access())).toEqual(['libraries']);
    expect(mediaAccessExceeds(access({ maxStreams: 4 }), access())).toEqual(['streams']);
    expect(mediaAccessExceeds(access(), access({ downloads: false }))).toEqual(['downloads']);
    expect(mediaAccessExceeds(access({ remoteBitrateMbit: 25 }), access())).toEqual(['bitrate']);
  });

  it('treats a missing bitrate limit as unlimited', () => {
    const parent = access({ remoteBitrateMbit: null });
    expect(mediaAccessExceeds(access({ remoteBitrateMbit: null }), parent)).toEqual([]);
    expect(mediaAccessExceeds(access({ remoteBitrateMbit: 1000 }), parent)).toEqual([]);
    expect(mediaAccessExceeds(access({ remoteBitrateMbit: null }), access())).toEqual(['bitrate']);
  });
});

describe('expectedMediaPolicy', () => {
  it('derives the policy from the access', () => {
    const policy = expectedMediaPolicy(
      access({ libraryIds: [SERIEN, FILME.toUpperCase(), FILME], remoteBitrateMbit: 8, downloads: false }),
    );
    expect(policy).toEqual({
      administrator: false,
      hidden: true,
      remoteAccess: true,
      allLibraries: false,
      libraryIds: [FILME, SERIEN],
      maxSessions: 3,
      downloads: false,
      conversion: false,
      remoteBitrateBps: 8_000_000,
      contentDeletion: false,
      remoteControlOthers: false,
      sharedDeviceControl: false,
      liveTv: false,
      metadataManagement: false,
      publicSharing: false,
      channels: false,
      syncPlay: 'None',
    });
  });

  it('leaves the bitrate to the server without a limit', () => {
    expect(expectedMediaPolicy(access({ remoteBitrateMbit: null })).remoteBitrateBps).toBe(0);
  });
});

describe('mediaPolicyDrift', () => {
  const expected = expectedMediaPolicy(access());

  it('is empty for the same policy, also with libraries in another order and case', () => {
    expect(mediaPolicyDrift(expected, expected)).toEqual([]);
    expect(mediaPolicyDrift({ ...expected, libraryIds: [SERIEN.toUpperCase(), FILME] }, expected)).toEqual(
      [],
    );
  });

  it('reports each changed field once, in field order', () => {
    expect(mediaPolicyDrift({ ...expected, maxSessions: 4 }, expected)).toEqual(['maxSessions']);
    expect(
      mediaPolicyDrift(
        { ...expected, syncPlay: 'JoinGroups', allLibraries: true, libraryIds: [FILME] },
        expected,
      ),
    ).toEqual(['allLibraries', 'libraryIds', 'syncPlay']);
  });
});

describe('mediaActivityDay', () => {
  it('gives the calendar day in Zurich', () => {
    expect(mediaActivityDay('2026-10-11T22:30:00Z')).toBe('2026-10-12');
    expect(mediaActivityDay('2026-10-11T21:30:00Z')).toBe('2026-10-11');
    expect(mediaActivityDay('2026-01-15T23:30:00.000Z')).toBe('2026-01-16');
  });

  it('gives null for nothing or garbage', () => {
    expect(mediaActivityDay(null)).toBeNull();
    expect(mediaActivityDay(undefined)).toBeNull();
    expect(mediaActivityDay('')).toBeNull();
    expect(mediaActivityDay('yesterday')).toBeNull();
  });
});
