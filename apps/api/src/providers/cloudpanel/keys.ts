import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
// ssh2 is CommonJS without named exports Node can see: always the default import.
import ssh2 from 'ssh2';

/**
 * SSH key material of CloudPanel connections. The console logs in to each server with one
 * ed25519 key (stored encrypted in the connection config) and pins the server's ed25519 host key
 * by its SHA-256 fingerprint, as `ssh-keygen -lf` prints it.
 */

/** Comment of every public key the console shows, so operators recognize it in authorized_keys. */
export const CLOUDPANEL_KEY_COMMENT = 'weblion-console';

/** "SHA256:" and 43 characters of unpadded base64 (ssh-keygen -lf). */
export const HOST_KEY_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

/** An SSH wire string: its length as uint32, then the bytes. */
function sshString(value: Buffer | string): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/**
 * An ed25519 private key of node:crypto as an unencrypted OpenSSH key file, with its
 * authorized_keys line. Built here, not with ssh2's generateKeyPairSync: ssh2 1.17.0 drops a
 * leading zero byte of the public key, so about one key in 256 came out malformed.
 */
export function openSshKeyPair(
  key: KeyObject,
  comment = CLOUDPANEL_KEY_COMMENT,
): {
  privateKey: string;
  publicKey: string;
} {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.crv !== 'Ed25519' || !jwk.d || !jwk.x) throw new Error('Not an ed25519 private key');
  const seed = Buffer.from(jwk.d, 'base64url');
  const pub = Buffer.from(jwk.x, 'base64url');
  const type = sshString('ssh-ed25519');
  const publicBlob = Buffer.concat([type, sshString(pub)]);
  const check = randomBytes(4);
  const secret = Buffer.concat([
    check,
    check,
    type,
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString(comment),
  ]);
  // Padding 1, 2, 3, ... up to the cipher's block size (8 without encryption).
  const padding = Buffer.from(Array.from({ length: (8 - (secret.length % 8)) % 8 }, (_, i) => i + 1));
  const keys = Buffer.alloc(4);
  keys.writeUInt32BE(1);
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString('none'),
    sshString('none'),
    sshString(''),
    keys,
    sshString(publicBlob),
    sshString(Buffer.concat([secret, padding])),
  ]);
  const lines = body.toString('base64').match(/.{1,70}/g) ?? [];
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${publicBlob.toString('base64')} ${comment}`,
  };
}

/** A fresh, unencrypted ed25519 key pair in OpenSSH format. */
export function generateCloudPanelKeyPair(comment = CLOUDPANEL_KEY_COMMENT): {
  privateKey: string;
  publicKey: string;
} {
  return openSshKeyPair(generateKeyPairSync('ed25519').privateKey, comment);
}

/**
 * The authorized_keys line of a private key ("ssh-ed25519 <base64> weblion-console"), or null
 * when the text is no unencrypted ed25519 private key (encrypted keys, other types, public keys).
 */
export function publicKeyLine(privateKey: string): string | null {
  let parsed: ReturnType<typeof ssh2.utils.parseKey>;
  try {
    parsed = ssh2.utils.parseKey(privateKey);
  } catch {
    return null;
  }
  // A key file without keys parses to undefined.
  if (!parsed || parsed instanceof Error) return null;
  if (parsed.type !== 'ssh-ed25519' || !parsed.isPrivateKey()) return null;
  return `ssh-ed25519 ${parsed.getPublicSSH().toString('base64')} ${CLOUDPANEL_KEY_COMMENT}`;
}

/** Fingerprint of a host key blob as the SSH handshake delivers it: "SHA256:<base64 without '='>". */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}
