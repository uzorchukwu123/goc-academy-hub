/* test-migration-gateway.js — Appwrite Functions API gateway.
   ---------------------------------------------------------------------------
   Runs entirely offline: no Appwrite project, no credentials, no production
   data. The gateway is exercised through createHandler with injected deps.

   Covers the compatibility and security properties that matter before any
   protected route is ported:
     • every inventoried route is accounted for (implemented or explicit 501)
     • 404/405 wording matches the OneBit server exactly
     • authorisation runs before the migration-gap check
     • identity systems cannot satisfy each other's tiers
     • CORS allow-list, body cap, JSON validation, error sanitisation */
'use strict';
const path = require('path');
const gateway = require('../functions/goc-api/src/index.js');
const config = require('../functions/goc-api/src/config.js');
const inventory = require('../functions/goc-api/route-inventory.json');
const { createMemorySessionStore } = require('../functions/goc-api/src/services/sessions.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS [' + name + ']'); }
  else { fail++; console.log('FAIL [' + name + ']' + (detail ? ' — ' + detail : '')); }
}

const coreStub = {
  adminMayUse: function (id, roleKey, cap) { return roleKey === 'founder'; },
  activeMode: function (fed, on) { return on ? (fed.mode || 'original') : 'original'; }
};

function makeApp(overrides) {
  const cfg = config.load({
    APPWRITE_ENDPOINT: 'https://example.invalid/v1',
    APPWRITE_PROJECT_ID: 'test-project',
    APPWRITE_API_KEY: 'test-key-not-a-real-secret',
    GOC_ALLOWED_ORIGINS: 'https://site.appwrite.network'
  });
  return gateway.createHandler(Object.assign({
    cfg, core: coreStub, sessions: createMemorySessionStore({}),
    readState: async () => ({ settings: { consolePasscodeLength: 6 }, free2027: { enabled: true, mode: 'free' } }),
    log: function () {}
  }, overrides || {}));
}

(async function () {
  const app = makeApp();

  /* ---------------------------------------------------------- route accounting */
  console.log('\n— route accounting —');
  check('inventory is the verified 251-route table', inventory.total === 251, String(inventory.total));
  check('router compiles every inventoried route', app.router.total === inventory.total);
  const coverage = app.router.coverage();
  check('coverage report accounts for every route', coverage.length === inventory.total);
  check('every route has an explicit status',
    coverage.every(r => r.status === 'implemented' || r.status === 'not-started'));
  check('health is implemented', coverage.some(r => r.path === '/api/health' && r.status === 'implemented'));
  check('all 32 capabilities are carried into the inventory', inventory.capabilities.length === 32);
  check('all 9 auth tiers are carried into the inventory', Object.keys(inventory.counts.byAuthTier).length === 9);
  /* Families the original plan omitted must still be present. */
  ['/api/rounds', '/api/challenges', '/api/managers', '/api/staff', '/api/audit', '/api/notices',
   '/api/flags', '/api/alerts', '/api/topics', '/api/objective', '/api/jamb', '/api/league',
   '/api/import', '/api/question-images', '/api/updates', '/api/affirmations', '/api/unsubscribe',
   '/api/settings'].forEach(function (fam) {
    /* Family keys are stored without a leading slash (e.g. "api/rounds"). */
    const key = fam.replace(/^\//, '');
    check('family retained: ' + fam,
      Object.prototype.hasOwnProperty.call(inventory.counts.byFamily, key) &&
      inventory.counts.byFamily[key] > 0);
  });

  /* ------------------------------------------------------------ contract parity */
  console.log('\n— contract parity —');
  let r = await app.handle({ method: 'GET', path: '/api/health' });
  check('health returns 200', r.status === 200);
  check('health keeps service identity', r.body && r.body.service === 'goc-academy-hub');
  check('health keeps version 1', r.body && r.body.version === 1);
  check('health keeps passcodeLength from state', r.body && r.body.passcodeLength === 6);
  check('health keeps free2027.on for the frontend mode switch', r.body && r.body.free2027.on === true);
  check('health reports the Function storage model honestly',
    r.body && r.body.free2027.storage === 'appwrite-storage');
  check('authenticated responses are never publicly cacheable',
    r.headers['cache-control'] === 'no-store');

  r = await app.handle({ method: 'GET', path: '/api/does-not-exist' });
  check('unknown path is 404 with the server wording',
    r.status === 404 && r.body.error === 'No such endpoint.', JSON.stringify(r.body));

  r = await app.handle({ method: 'DELETE', path: '/api/health' });
  check('wrong method is 405 with the server wording',
    r.status === 405 && r.body.error === 'Wrong method for that endpoint.', JSON.stringify(r.body));

  /* ------------------------------------------------- migration gap is explicit */
  console.log('\n— unported routes —');
  r = await app.handle({ method: 'GET', path: '/api/updates' });
  check('an unported PUBLIC route returns 501, not a silent 404', r.status === 501, String(r.status));
  check('the 501 names the route so the gap is auditable',
    /not yet migrated/.test(r.body.error) && /\/api\/updates/.test(r.body.error));

  r = await app.handle({ method: 'GET', path: '/api/admin/overview' });
  check('an unported PROTECTED route demands auth before revealing the gap',
    r.status === 401, String(r.status));

  /* ---------------------------------------------------------- identity isolation */
  console.log('\n— identity boundaries —');
  const store = createMemorySessionStore({});
  const freeSess = await store.create({ identitySystem: 'free2027', accountId: 'F-1', role: 'participant', sessionMinutes: 60 });
  const staffSess = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-001', role: 'admin', roleKey: 'founder', title: 'Founder', unlocked: true, sessionMinutes: 60 });
  const studentSess = await store.create({ identitySystem: 'appwrite-auth', accountId: 'GOC-S-001', role: 'student', sessionMinutes: 60 });
  const iso = makeApp({ sessions: store });

  r = await iso.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer ' + freeSess.token } });
  check('a Free Tutorial token cannot open a console route', r.status === 401, String(r.status));
  r = await iso.handle({ method: 'GET', path: '/api/free2027/me', headers: { authorization: 'Bearer ' + staffSess.token } });
  check('a staff token cannot open a Free Tutorial participant route', r.status === 401, String(r.status));
  r = await iso.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer ' + studentSess.token } });
  check('a student token cannot open a console route', r.status === 401, String(r.status));
  r = await iso.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer ' + staffSess.token } });
  check('an authorised founder reaches the handler (501 = ported gap, not auth failure)',
    r.status === 501, String(r.status));

  const locked = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-002', role: 'admin', roleKey: 'academic-director', title: 'Academic Director', unlocked: false, sessionMinutes: 60 });
  r = await iso.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer ' + locked.token } });
  check('an unlocked-passcode requirement is enforced',
    r.status === 403 && /passcode/.test(r.body.error), JSON.stringify(r.body));

  const acaddir = await store.create({ identitySystem: 'local-staff', accountId: 'GOC-A-003', role: 'admin', roleKey: 'academic-director', title: 'Academic Director', unlocked: true, sessionMinutes: 60 });
  r = await iso.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer ' + acaddir.token } });
  check('capability map is consulted (Academic Director refused by the stub map)',
    r.status === 403 && /role does not include/.test(r.body.error), JSON.stringify(r.body));

  /* ------------------------------------------------------------------- hardening */
  console.log('\n— hardening —');
  r = await app.handle({ method: 'OPTIONS', path: '/api/health', headers: { origin: 'https://site.appwrite.network' } });
  check('preflight from an approved origin is 204', r.status === 204);
  check('preflight echoes the approved origin',
    r.headers['access-control-allow-origin'] === 'https://site.appwrite.network');

  r = await app.handle({ method: 'GET', path: '/api/health', headers: { origin: 'https://evil.example' } });
  check('an unapproved origin is refused', r.status === 403, String(r.status));
  check('an unapproved origin gets no allow-origin header', !r.headers['access-control-allow-origin']);

  r = await app.handle({ method: 'GET', path: '/api/health', headers: { origin: 'https://attacker.example' } });
  check('CORS never falls back to a wildcard', r.headers['access-control-allow-origin'] !== '*');

  const small = makeApp({ cfg: Object.assign({}, config.load({}), { maxBodyBytes: 32, allowedOrigins: [] }) });
  r = await small.handle({ method: 'POST', path: '/api/auth/login', bodyRaw: JSON.stringify({ pad: 'x'.repeat(200) }) });
  check('oversized body is refused with 413', r.status === 413, String(r.status));

  r = await small.handle({ method: 'POST', path: '/api/auth/login', bodyRaw: '{not json' });
  check('malformed JSON is refused with 400', r.status === 400, String(r.status));

  const boom = makeApp({ readState: async () => { throw new Error('secret-connection-string-leak'); } });
  r = await boom.handle({ method: 'GET', path: '/api/health' });
  check('an internal failure is a 500', r.status === 500);
  check('an internal failure never echoes the exception text',
    !/secret-connection-string-leak/.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  const noCfg = makeApp({ cfg: config.load({}), sessions: null });
  r = await noCfg.handle({ method: 'GET', path: '/api/admin/overview', headers: { authorization: 'Bearer abc' } });
  check('a missing session store fails closed', r.status === 503, String(r.status));
  check('the configuration failure names no secret value',
    !/test-key-not-a-real-secret/.test(JSON.stringify(r.body)));

  console.log('\n— configuration hygiene —');
  const described = config.describe(config.load({
    APPWRITE_ENDPOINT: 'https://example.invalid/v1', APPWRITE_PROJECT_ID: 'p', APPWRITE_API_KEY: 'super-secret-key'
  }));
  check('describe() never includes the API key', !/super-secret-key/.test(JSON.stringify(described)));
  check('defaults reuse the existing database id', config.load({}).databaseId === 'goc_academy');
  check('defaults reuse the existing bucket id', config.load({}).bucketId === 'goc-data');
  check('defaults reuse the existing backup file id', config.load({}).backupFileId === 'academy-data-json');
  check('job ownership defaults to OneBit so jobs cannot double-send',
    config.load({}).jobOwner === 'onebit');
  check('missing credentials are reported by name',
    config.load({}).missingRequired.join(',') === 'APPWRITE_ENDPOINT,APPWRITE_PROJECT_ID,APPWRITE_API_KEY');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('SUITE ERROR', e && e.stack || e);
  process.exit(1);
});
