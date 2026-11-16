import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} n
 * @param {number} r
 * @param {number} p
 * @returns {Promise<Buffer>}
 */
const scryptAsync = promisify(scrypt);

const derive = async (password, salt, n, r, p) => {
  const key = await scryptAsync(String(password), salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
  return /** @type {Buffer} */ (key);
};

export function generatePassword() {
  return randomBytes(15).toString('base64url');
}

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** @param {unknown} value */
export function isPasswordHash(value) {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(value || ''));
}

/**
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
