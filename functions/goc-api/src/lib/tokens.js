/* tokens.js — bearer token generation and at-rest hashing.
   ---------------------------------------------------------------------------
   The OneBit server issues 24 random bytes hex (server/server.js:1567) and keeps
   the raw token as the key of an in-process Map. A Function cannot keep process
   memory, so the token is persisted — but NEVER in raw form:

     • the browser keeps the raw token (unchanged contract: Bearer <token>)
     • the database keeps only sha256(token)
     • the document ID is a 36-char prefix of that digest, so a lookup is a
       direct getDocument rather than a query, and Appwrite's 36-char document
       ID limit is respected.

   A database leak therefore does not yield usable session tokens. The full
   digest is still compared on read, so the truncated ID is only an index. */
'use strict';
const crypto = require('crypto');

const TOKEN_BYTES = 24;
const DOC_ID_LEN = 36;

function generate() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function digest(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function documentId(token) {
  return digest(token).slice(0, DOC_ID_LEN);
}

/* Constant-time compare of two hex digests of equal length. */
function digestsEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { generate, digest, documentId, digestsEqual, TOKEN_BYTES, DOC_ID_LEN };
