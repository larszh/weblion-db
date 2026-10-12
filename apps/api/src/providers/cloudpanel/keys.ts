import { createHash } from 'node:crypto';
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

/** A fresh, unencrypted ed25519 key pair in OpenSSH format. */
export function generateCloudPanelKeyPair(comment = CLOUDPANEL_KEY_COMMENT): {
  privateKey: string;
  publicKey: string;
} {
  const pair = ssh2.utils.generateKeyPairSync('ed25519', { comment });
  return { privateKey: pair.private, publicKey: pair.public };
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
