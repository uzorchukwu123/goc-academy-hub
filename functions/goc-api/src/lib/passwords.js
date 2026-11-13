/* passwords.js — compatibility shim for the EXISTING credential format.
   ---------------------------------------------------------------------------
   The OneBit server (server/server.js:1543) and the Free Tutorial edition
   (server/lib/free2027.js:350) both store:

       scrypt$<salt-hex>$<key-hex>        key = scryptSync(plain, salt, 64)

   Those hashes CANNOT be imported into Appwrite Auth, and existing accounts
   must keep working without a password reset. So the Function verifies them
   with the identical algorithm rather than inventing a new one.

   This module deliberately does not "improve" the scheme: same KDF, same key
   length, same salt encoding, same constant-time comparison. Any drift here
   would lock existing staff, tutors and Free Tutorial participants out.

   Original G.O.C students authenticated against Appwrite Auth are NOT handled
   here — they keep using Appwrite's own session/password verification. */
'use strict';
const crypto = require('crypto');

const KEY_BYTES = 64;
const SALT_BYTES = 16;

function hash(plain) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const key = crypto.scryptSync(String(plain), salt, KEY_BYTES).toString('hex');
  return 'scrypt$' + salt + '$' + key;
}

/* Returns false for any malformed/legacy/absent hash instead of throwing, so a
   bad record can never turn into a 500 that leaks internals. Mirrors the Free
   Tutorial edition's try/catch behaviour. */
function verify(plain, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  if (!parts[1] || !parts[2]) return false;
  try {
    const key = crypto.scryptSync(String(plain), parts[1], KEY_BYTES);
    const want = Buffer.from(parts[2], 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch (e) {
    return false;
  }
}

module.exports = { hash, verify, KEY_BYTES, SALT_BYTES };
