import { describe, expect, it } from 'vitest';
import { decodeBackupCode, encodeBackupCode } from './backupCode';
import { generateCredentials } from './credentials';

describe('backup code', () => {
  it('round-trips device credentials', () => {
    for (let i = 0; i < 25; i++) {
      const credentials = generateCredentials();
      const code = encodeBackupCode(credentials);
      expect(code).toMatch(/^BT1[0-9A-Z]-([0-9A-Z]{4}-)+[0-9A-Z]{1,4}$/);
      expect(decodeBackupCode(code)).toEqual({ ok: true, credentials });
    }
  });

  it('forgives spaces, lower case and handwriting look-alikes', () => {
    const credentials = generateCredentials();
    const code = encodeBackupCode(credentials).replace(/-/g, ' ').toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o');
    expect(decodeBackupCode(code)).toEqual({ ok: true, credentials });
  });

  it('catches a single mistyped character', () => {
    const code = encodeBackupCode(generateCredentials());
    const index = code.length - 10;
    const swapped = code.slice(0, index) + (code[index] === 'A' ? 'B' : 'A') + code.slice(index + 1);
    const result = decodeBackupCode(swapped);
    expect(result.ok).toBe(false);
  });

  it('explains when the text is not a backup code at all', () => {
    expect(decodeBackupCode('hello there')).toMatchObject({ ok: false, reason: expect.stringContaining('BT1') });
  });
});
