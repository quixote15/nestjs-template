import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');

    expect(stored).not.toContain('correct horse battery');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('correct horse batterz', stored)).resolves.toBe(
      false,
    );
  });

  it('salts each hash, so equal passwords hash differently', async () => {
    expect(await hashPassword('same password')).not.toEqual(
      await hashPassword('same password'),
    );
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
  });
});
