import crypto from 'node:crypto';
import os from 'node:os';
import { promisify } from 'node:util';
import { Semaphore } from '../utils/semaphore.js';

// Password hashing with scrypt from Node's built-in crypto module.
//
// Why not bcryptjs (what we used first): it is pure JavaScript, so every hash ran ON the event loop
// for ~340 ms. Measured: 2 logins/sec per instance, and while logins were running every other request
// waited up to 3.3 s. scrypt here runs on libuv's thread pool, so the event loop stays free.
// (No accounts existed before the switch, so there are no old bcrypt hashes to support.)
//
// Parameters follow the OWASP Password Storage Cheat Sheet scrypt option N=2^14, r=8, p=5
// (16 MiB per hash). Stored as: scrypt$N$r$p$salt$hash so parameters can be raised later
// without breaking existing passwords.

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

// Hashing threads compete with the event loop for CPU. Leave one core for the event loop
// (on a 1-2 vCPU container that means one hash at a time) and never more than 4, because Node's
// thread pool has 4 threads shared with DNS lookups and file access. This also bounds memory
// (16 MiB per hash). Extra logins wait briefly; a huge burst gets a fast 503 instead of piling up.
const HASH_CONCURRENCY = Math.min(4, Math.max(1, os.availableParallelism() - 1));
const hashLimiter = new Semaphore({ name: 'password-hash', max: HASH_CONCURRENCY, maxQueue: 200, queueTimeoutMs: 10_000 });

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await hashLimiter.run(() => scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM }));
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;

  const [scheme, N, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await hashLimiter.run(() =>
    scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    }),
  );
  // Constant-time comparison so the response time does not reveal how many bytes matched.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function needsRehash(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return true;
  const [, N, r, p] = stored.split('$');
  return Number(N) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

// Used when the email does not exist, so "no such user" takes as long as "wrong password".
// Otherwise response timing would reveal which emails have accounts.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('saathi-timing-safety-placeholder');
  await verifyPassword(password, dummyHash);
  return false;
}
