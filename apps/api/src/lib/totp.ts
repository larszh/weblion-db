import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

const ISSUER = 'weblion.one';

function totp(secretBase32: string, label: string) {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export async function totpSetupPayload(secretBase32: string, email: string) {
  const uri = totp(secretBase32, email).toString();
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { secret: secretBase32, uri, qr };
}

/** Accepts the current code and one period of clock drift in either direction. */
export function verifyTotp(secretBase32: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  return totp(secretBase32, 'verify').validate({ token: cleaned, window: 1 }) !== null;
}
