/* test-migration-sessions.js — durable sessions + credential compatibility.
   ---------------------------------------------------------------------------
   Offline. No Appwrite project is contacted; the Appwrite-backed store is
   exercised against a stub Databases client so its failure modes are proven.

   The credential test is the critical one: existing staff, tutor and Free
   Tutorial passwords must keep working. Hashes are produced here by an
   INDEPENDENT implementation of the format documented in server/server.js:1543
   and server/lib/free2027.js:350, then verified by the Function's shim. */
'use strict';
const crypto = require('crypto');
const passwords = require('../functions/goc-api/src/lib/passwords.js');
const tokens = require('../functions/goc-api/src/lib/tokens.js');
const sessions = require('../functions/goc-api/src/services/sessions.js');
const { ConfigurationError } = require('../functions/goc-api/src/middleware/errors.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS [' + name + ']'); }
  else { fail++; console.log('FAIL [' + name + ']' + (detail ? ' — ' + detail : '')); }
}

/* Independent reproduction of the EXISTING on-disk format. */
function legacyHash(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + key;
}

(async function () {
  console.log('— existing credential compatibility —');
  const legacy = legacyHash('Correct-Horse-7');
  check('a hash written by the existing server verifies', passwords.verify('Correct-Horse-7', legacy));
  check('a wrong password is rejected', !passwords.verify('wrong', legacy));
  check('the shim writes the same scrypt$salt$key format', /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(passwords.hash('x')));
  check('the shim output verifies against itself', passwords.verify('round-trip', passwords.hash('round-trip')));
  check('salts differ between hashes of the same password', passwords.hash('same') !== passwords.hash('same'));
  check('an empty hash is rejected, not thrown', passwords.verify('x', '') === false);
  check('a null hash is rejected, not thrown', passwords.verify('x', null) === false);
  check('a bcrypt hash is rejected (never silently accepted)', passwords.verify('x', '$2b$10$abcdef') === false);
  check('a truncated scrypt hash is rejected', passwords.verify('x', 'scrypt$abcd') === false);
  check('a non-hex key is rejected safely', passwords.verify('x', 'scrypt$salt$ZZZZ') === false);
  check('an empty salt is rejected', passwords.verify('x', 'scrypt$$abcd') === false);

  console.log('\n— token handling —');
  const t = tokens.generate();
  check('token keeps the existing 24-byte hex shape', /^[0-9a-f]{48}$/.test(t));
  check('tokens are unique', tokens.generate() !== tokens.generate());
  check('digest is sha256 hex', /^[0-9a-f]{64}$/.test(tokens.digest(t)));
  check('document id respects Appwrite 36-char limit', tokens.documentId(t).length === 36);
  check('document id is derived from the digest', tokens.documentId(t) === tokens.digest(t).slice(0, 36));
  check('digest comparison accepts the same token', tokens.digestsEqual(tokens.digest(t), tokens.digest(t)));
  check('digest comparison rejects a different token', !tokens.digestsEqual(tokens.digest(t), tokens.digest(tokens.generate())));
  check('digest comparison rejects unequal lengths', !tokens.digestsEqual('ab', 'abcd'));

  console.log('\n— durable session lifecycle —');
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const store = sessions.createMemorySessionStore({ now: () => clock });
  const made = await store.create({
    identitySystem: 'local-staff', accountId: 'GOC-A-001', name: 'Founder',
    role: 'admin', roleKey: 'founder', title: 'Founder', subjects: [], sessionMinutes: 30
  });
  check('create returns a raw token to the caller', /^[0-9a-f]{48}$/.test(made.token));

  let s = await store.get(made.token);
  check('a fresh session resolves', !!s);
  check('role and roleKey survive the round trip', s.role === 'admin' && s.roleKey === 'founder');
  check('identity system is recorded', s.identitySystem === 'local-staff');
  check('title survives (Founder gate depends on it)', s.title === 'Founder');
  check('a new session is not unlocked', s.unlocked === false);

  await store.setUnlocked(made.token, true);
  s = await store.get(made.token);
  check('unlock is durable', s.unlocked === true);

  clock += 29 * 60000;
  check('session still valid before expiry', !!(await store.get(made.token)));
  clock += 2 * 60000;
  check('session expires exactly at its lifetime', (await store.get(made.token)) === null);

  const revoked = await store.create({ identitySystem: 'local-tutor', accountId: 'GOC-T-001', role: 'tutor', sessionMinutes: 60 });
  check('revoke reports success', await store.revoke(revoked.token) === true);
  check('a revoked session no longer resolves', (await store.get(revoked.token)) === null);
  check('revoking an unknown token is a safe no-op', await store.revoke('deadbeef') === false);
  check('an unknown token never resolves', (await store.get('deadbeef')) === null);
  check('an empty token never resolves', (await store.get('')) === null);

  console.log('\n— bulk revocation (password change / deactivation) —');
  const a1 = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-009', role: 'admin', sessionMinutes: 60 });
  const a2 = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-009', role: 'admin', sessionMinutes: 60 });
  const other = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-010', role: 'admin', sessionMinutes: 60 });
  const killed = await store.revokeAccount('GOC-A-009', 'local-staff');
  check('all sessions for the account are revoked', killed.length === 2, String(killed.length));
  check('first session is dead', (await store.get(a1.token)) === null);
  check('second session is dead', (await store.get(a2.token)) === null);
  check('a different account is untouched', !!(await store.get(other.token)));

  console.log('\n— identity isolation at the store level —');
  const freeOnly = sessions.createMemorySessionStore({ identitySystem: 'free2027', now: () => clock });
  const f = await freeOnly.create({ identitySystem: 'free2027', accountId: 'F-1', role: 'participant', sessionMinutes: 60 });
  const st = await freeOnly.create({ identitySystem: 'local-staff', accountId: 'GOC-A-001', role: 'admin', sessionMinutes: 60 });
  check('a scoped store resolves its own identity', !!(await freeOnly.get(f.token)));
  check('a scoped store refuses another identity system', (await freeOnly.get(st.token)) === null);
  check('all four identity systems are declared',
    sessions.IDENTITY_SYSTEMS.join(',') === 'appwrite-auth,local-staff,local-tutor,free2027');
  let threw = false;
  try { await store.create({ identitySystem: 'made-up', accountId: 'x', role: 'admin' }); }
  catch (e) { threw = true; }
  check('an unknown identity system is refused at creation', threw);

  console.log('\n— raw tokens are never persisted —');
  const serialized = sessions._serialize({
    tokenHash: tokens.digest(made.token), identitySystem: 'local-staff', accountId: 'GOC-A-001',
    role: 'admin', subjects: ['Maths'], createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(), sessionMinutes: 30
  });
  check('the stored document contains no raw token field', !('token' in serialized));
  check('the stored document does not contain the raw token value',
    !JSON.stringify(serialized).includes(made.token));
  check('subjects are stored as an opaque JSON string', serialized.subjectsJson === '["Maths"]');

  console.log('\n— Appwrite store fails closed —');
  const missingDatabases = {
    createDocument: async () => { const e = new Error('not found'); e.code = 404; throw e; },
    getDocument: async () => { const e = new Error('not found'); e.code = 404; throw e; }
  };
  const aw = sessions.createAppwriteSessionStore({
    databases: missingDatabases, databaseId: 'goc_academy', collectionId: 'sessions'
  });
  let cfgErr = null;
  try { await aw.create({ identitySystem: 'local-staff', accountId: 'x', role: 'admin', sessionMinutes: 5 }); }
  catch (e) { cfgErr = e; }
  check('a missing sessions collection raises ConfigurationError', cfgErr instanceof ConfigurationError);
  check('the error names the collection an operator must apply',
    cfgErr && /sessions/.test(cfgErr.message) && /schema\/sessions\.json/.test(cfgErr.message));
  check('the store never silently falls back to memory', aw.kind === 'appwrite');
  let noClient = null;
  try { sessions.createAppwriteSessionStore({ databaseId: 'd', collectionId: 'c' }); }
  catch (e) { noClient = e; }
  check('no Databases client is a configuration error, not a crash', noClient instanceof ConfigurationError);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('SUITE ERROR', e && e.stack || e); process.exit(1); });
