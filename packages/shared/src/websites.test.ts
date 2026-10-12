import { describe, expect, it } from 'vitest';
import {
  SITE_USER_PATTERN,
  WEBSITE_PASSWORD_PATTERN,
  isReservedSiteUser,
  suggestSiteUser,
  websiteDatabaseName,
  websiteDatabasePrefix,
  websiteDomainAscii,
  websitePasswordIssues,
  wwwCounterpart,
} from './websites';

describe('websiteDomainAscii', () => {
  it('converts unicode names to punycode', () => {
    expect(websiteDomainAscii('Müller.CH')).toBe('xn--mller-kva.ch');
    expect(websiteDomainAscii('www.Shop.ch')).toBe('www.shop.ch');
  });

  it('rejects IPs, single labels, spaces and paths', () => {
    for (const value of ['1.2.3.4', 'localhost', 'a b.ch', 'shop.ch/x', '']) {
      expect(websiteDomainAscii(value), value).toBeNull();
    }
  });
});

describe('suggestSiteUser', () => {
  it('drops www and turns dots into dashes', () => {
    expect(suggestSiteUser('www.mueller-shop.ch')).toBe('mueller-shop-ch');
    expect(suggestSiteUser('xn--mller-kva.ch')).toBe('xn-mller-kva-ch');
  });

  it('starts with a letter', () => {
    expect(suggestSiteUser('123.ch')).toBe('w123-ch');
  });

  it('cuts long domains to 24 characters without a trailing dash', () => {
    const domain = 'abcdefghijklmnopqrstuvw.example-shops.ch';
    expect(domain).toHaveLength(40);
    const user = suggestSiteUser(domain);
    expect(user).toBe('abcdefghijklmnopqrstuvw');
    expect(user.length).toBeLessThanOrEqual(24);
  });

  it('always gives a valid site user', () => {
    const domains = [
      'a.ch',
      'q.de',
      '1.ch',
      'www.a.io',
      'shop.mueller.ch',
      'www.shop.mueller.ch',
      'xn--mller-kva.ch',
      'www.xn--bcher-kva.example',
      '9-lives.com',
      'a-b.c-d.ch',
      'www.www.ch',
      'my--double.ch',
      'abcdefghijklmnopqrstuvw.example-shops.ch',
      'a1b2c3d4e5f6g7h8i9j0k1l2m3n4.ch',
      'sub.domain.of.something.example',
      '0.0.0.ch',
      'x.xn--p1ai',
      'baeckerei-huber.example',
      'www.muster-ag.example',
      'api.muster-ag.example',
      'legacy.kunde.example',
      'a-------------------------b.ch',
      'z.museum',
      'www.1.ch',
      'test.example.ch',
      'very-long-name-with-many-dashes-in-it.ch',
      '123456789012345678901234567890.ch',
      'w.ch',
      'ww.ch',
      'www.ch',
    ];
    expect(domains).toHaveLength(30);
    for (const domain of domains) {
      const user = suggestSiteUser(domain);
      expect(SITE_USER_PATTERN.test(user), `${domain} -> ${user}`).toBe(true);
    }
  });
});

describe('website databases', () => {
  it('derives the prefix from the site user', () => {
    expect(websiteDatabasePrefix('shop-mueller-ch')).toBe('shop_mueller_ch');
  });

  it('builds full names of at most 32 characters', () => {
    expect(websiteDatabaseName('shop-mueller-ch', 'wp')).toBe('shop_mueller_ch_wp');
    const long = websiteDatabaseName('a-very-long-site-user-name', 'wordpress_db');
    expect(long).toBe('a_very_long_site_wordpress_db');
    expect(long!.length).toBeLessThanOrEqual(32);
  });

  it('refuses bad suffixes', () => {
    expect(websiteDatabaseName('shop-mueller-ch', 'a'.repeat(16))).toBeNull();
    expect(websiteDatabaseName('shop-mueller-ch', '_wp')).toBeNull();
    expect(websiteDatabaseName('shop-mueller-ch', 'WP')).toBeNull();
  });
});

describe('site users and passwords', () => {
  it('reserves system users and everything starting with weblion', () => {
    expect(isReservedSiteUser('weblion-cp')).toBe(true);
    expect(isReservedSiteUser('weblion-agent')).toBe(true);
    expect(isReservedSiteUser('root')).toBe(true);
    expect(isReservedSiteUser('clp')).toBe(true);
    expect(isReservedSiteUser('shop-mueller-ch')).toBe(false);
  });

  it('accepts passwords without shell characters', () => {
    expect(websitePasswordIssues('Xq7vT2mKc9RwLp4s')).toEqual([]);
    expect(websitePasswordIssues('Sommer-2026!Kunde')).toEqual([]);
    expect(WEBSITE_PASSWORD_PATTERN.test('Sommer-2026!Kunde')).toBe(true);
  });

  it('reports characters and length', () => {
    expect(websitePasswordIssues('Sommer2026$Kunde')).toEqual(['characters']);
    expect(websitePasswordIssues("Sommer2026'Kunde")).toEqual(['characters']);
    expect(websitePasswordIssues('Sommer 2026 Kunde')).toEqual(['characters']);
    expect(websitePasswordIssues('Abcdefgh123')).toEqual(['length']);
    expect(websitePasswordIssues('a$b')).toEqual(['length', 'characters']);
    expect(WEBSITE_PASSWORD_PATTERN.test('Sommer2026$Kunde')).toBe(false);
  });
});

describe('wwwCounterpart', () => {
  it('adds or removes www', () => {
    expect(wwwCounterpart('shop.ch')).toBe('www.shop.ch');
    expect(wwwCounterpart('www.shop.ch')).toBe('shop.ch');
  });
});
