import { createHash, createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import ssh2 from 'ssh2';
import { describe, expect, it } from 'vitest';
import {
  HOST_KEY_FINGERPRINT_PATTERN,
  generateCloudPanelKeyPair,
  hostKeyFingerprint,
  openSshKeyPair,
  publicKeyLine,
} from '../src/providers/cloudpanel/keys';

/** The ed25519 key of a 32-byte seed (PKCS#8 DER: a fixed prefix, then the seed). */
function keyOfSeed(seed: Buffer): KeyObject {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** The raw 32-byte public key inside an authorized_keys line. */
function rawPublicKey(line: string): Buffer {
  const blob = Buffer.from(line.split(' ')[1]!, 'base64');
  expect(blob.length).toBe(51);
  return blob.subarray(19);
}

describe('CloudPanel keys', () => {
  it('generates an unencrypted ed25519 pair whose public line matches the private key', () => {
    const pair = generateCloudPanelKeyPair();
    expect(pair.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ weblion-console$/);
    expect(publicKeyLine(pair.privateKey)).toBe(pair.publicKey);
    // Pasted keys come with other line endings and surrounding blanks.
    expect(publicKeyLine(`  ${pair.privateKey.replace(/\n/g, '\r\n')}  `)).toBe(pair.publicKey);
  });

  it('keeps a public key that starts with a zero byte (one key in 256)', () => {
    // ssh2's own keygen dropped that byte and wrote a key nothing could read.
    let key: KeyObject | null = null;
    for (let i = 0; i < 10_000 && !key; i++) {
      const candidate = keyOfSeed(createHash('sha256').update(`seed ${i}`).digest());
      if (Buffer.from(candidate.export({ format: 'jwk' }).x!, 'base64url')[0] === 0) key = candidate;
    }
    expect(key).not.toBeNull();
    const pair = openSshKeyPair(key!);
    expect(rawPublicKey(pair.publicKey)[0]).toBe(0);
    expect(pair.publicKey).toMatch(
      /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} weblion-console$/,
    );
    expect(publicKeyLine(pair.privateKey)).toBe(pair.publicKey);
    const parsed = ssh2.utils.parseKey(pair.privateKey);
    if (!parsed || parsed instanceof Error) throw new Error('the key does not parse');
    const signature = parsed.sign(Buffer.from('weblion'));
    expect(parsed.verify(Buffer.from('weblion'), signature)).toBe(true);
  });

  it('generates keys that always parse', () => {
    for (let i = 0; i < 2000; i++) {
      const pair = generateCloudPanelKeyPair();
      expect(publicKeyLine(pair.privateKey)).toBe(pair.publicKey);
      expect(rawPublicKey(pair.publicKey).length).toBe(32);
    }
    expect(generateCloudPanelKeyPair('host').publicKey.endsWith(' host')).toBe(true);
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
