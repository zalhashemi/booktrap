import { DeviceCredentialsSchema, type DeviceCredentials } from '@booktrap/shared';

/**
 * Backup code (brief §3): a human-readable encoding of this browser's device credentials.
 * Entering it on another browser restores access to the same shelf. It is the key itself,
 * so it is shown only on request and never sent anywhere except back to BookTrap.
 *
 * Format: "BT1" + Crockford base32 of (16-byte device id + 32-byte secret) + 2 check characters,
 * grouped in fours. Crockford's alphabet has no I, L, O or U, so it survives handwriting.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'BT1';

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string, byteLength: number): Uint8Array | null {
  const bytes = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit === -1) return null;
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      if (index < byteLength) bytes[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return index === byteLength ? bytes : null;
}

/** Two base32 characters of FNV-1a over the payload: catches typos and swapped characters. */
function checksum(payload: string): string {
  let hash = 0x811c9dc5;
  for (const char of payload) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ALPHABET[hash & 31]! + ALPHABET[(hash >>> 5) & 31]!;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function base64urlToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeBackupCode(credentials: DeviceCredentials): string {
  const payload = toBase32(new Uint8Array([...uuidToBytes(credentials.deviceId), ...base64urlToBytes(credentials.deviceSecret)]));
  const full = `${PREFIX}${payload}${checksum(payload)}`;
  return full.match(/.{1,4}/g)!.join('-');
}

export type DecodeResult = { ok: true; credentials: DeviceCredentials } | { ok: false; reason: string };

export function decodeBackupCode(input: string): DecodeResult {
  // Forgive spacing, dashes, case and the usual handwriting confusions.
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (!cleaned.startsWith(PREFIX)) return { ok: false, reason: 'That doesn’t look like a BookTrap backup code. It starts with BT1.' };
  const body = cleaned.slice(PREFIX.length);
  const payload = body.slice(0, -2);
  if (body.length < 10 || checksum(payload) !== body.slice(-2)) {
    return { ok: false, reason: 'The code has a typo somewhere. Check it against your saved copy.' };
  }
  const bytes = fromBase32(payload, 48);
  if (!bytes) return { ok: false, reason: 'The code has a typo somewhere. Check it against your saved copy.' };
  const parsed = DeviceCredentialsSchema.safeParse({
    deviceId: bytesToUuid(bytes.slice(0, 16)),
    deviceSecret: bytesToBase64url(bytes.slice(16)),
  });
  return parsed.success ? { ok: true, credentials: parsed.data } : { ok: false, reason: 'This backup code isn’t valid.' };
}
