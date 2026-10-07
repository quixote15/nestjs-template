import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** `scrypt$<salt>$<hash>` in base64: a random salt per password, so equal passwords hash differently. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Compares in constant time, so response times don't give the hash away. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const given = await scryptAsync(
    password,
    Buffer.from(salt, 'base64'),
    expected.length,
  );
  return timingSafeEqual(given, expected);
}
