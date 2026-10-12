import { createHash, generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { describe, expect, it } from 'vitest';
import {
  HOST_KEY_FINGERPRINT_PATTERN,
  generateCloudPanelKeyPair,
  hostKeyFingerprint,
  publicKeyLine,
} from '../src/providers/cloudpanel/keys';

describe('CloudPanel keys', () => {
  it('generates an unencrypted ed25519 pair whose public line matches the private key', () => {
    const pair = generateCloudPanelKeyPair();
    expect(pair.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ weblion-console$/);
    expect(publicKeyLine(pair.privateKey)).toBe(pair.publicKey);
    // Pasted keys come with other line endings and surrounding blanks.
    expect(publicKeyLine(`  ${pair.privateKey.replace(/\n/g, '\r\n')}  `)).toBe(pair.publicKey);
  });

  it('refuses public keys, encrypted keys, other key types and garbage', () => {
    const pair = generateCloudPanelKeyPair();
    expect(publicKeyLine(pair.publicKey)).toBeNull();
    const encrypted = ssh2.utils.generateKeyPairSync('ed25519', {
      passphrase: 'secret',
      cipher: 'aes256-ctr',
      rounds: 16,
    });
    expect(publicKeyLine(encrypted.private)).toBeNull();
    const rsa = ssh2.utils.generateKeyPairSync('rsa', { bits: 2048 });
    expect(publicKeyLine(rsa.private)).toBeNull();
    // ssh2 reads ed25519 keys in OpenSSH format only.
    const pkcs8 = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    expect(publicKeyLine(String(pkcs8))).toBeNull();
    expect(publicKeyLine('')).toBeNull();
    expect(publicKeyLine('not a key')).toBeNull();
    // A well-formed OpenSSH key file that holds no key at all.
    const str = (s: string) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(s.length);
      return Buffer.concat([len, Buffer.from(s)]);
    };
    const empty = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      str('none'),
      str('none'),
      str(''),
      Buffer.alloc(4),
    ]).toString('base64');
    expect(
      publicKeyLine(`-----BEGIN OPENSSH PRIVATE KEY-----\n${empty}\n-----END OPENSSH PRIVATE KEY-----\n`),
    ).toBeNull();
  });

  it('prints host key fingerprints like ssh-keygen -lf', () => {
    const pair = generateCloudPanelKeyPair();
    const blob = Buffer.from(pair.publicKey.split(' ')[1]!, 'base64');
    const fingerprint = hostKeyFingerprint(blob);
    expect(fingerprint).toMatch(HOST_KEY_FINGERPRINT_PATTERN);
    expect(fingerprint).toBe(`SHA256:${createHash('sha256').update(blob).digest('base64').slice(0, 43)}`);
    expect(fingerprint.endsWith('=')).toBe(false);
    expect(HOST_KEY_FINGERPRINT_PATTERN.test('SHA256:short')).toBe(false);
    expect(HOST_KEY_FINGERPRINT_PATTERN.test(`MD5:${'a'.repeat(43)}`)).toBe(false);
  });
});
