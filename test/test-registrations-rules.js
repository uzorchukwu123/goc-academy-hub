/* test-registrations-rules.js — Stage B: the pure registration rules in core.
   node test/test-registrations-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var NOW = Date.UTC(2026, 10, 5, 10, 0, 0);

head('code normalisation');
ok('a canonical code passes through', core.cleanRegistrationCode('GOC-REG-AB3DEF-GH4JKM') === 'GOC-REG-AB3DEF-GH4JKM');
ok('lowercase, spaces and missing dashes are tidied', core.cleanRegistrationCode(' goc reg ab3def gh4jkm ') === 'GOC-REG-AB3DEF-GH4JKM');
ok('ambiguous characters (0, O, 1, I) are not codes', core.cleanRegistrationCode('GOC-REG-AB3DE0-GH4JKM') === null && core.cleanRegistrationCode('GOC-REG-IB3DEF-GH4JKM') === null);
ok('wrong shapes are refused, not crashes', core.cleanRegistrationCode('GOC-REG-ABC') === null && core.cleanRegistrationCode('') === null && core.cleanRegistrationCode(null) === null && core.cleanRegistrationCode(42) === null);
ok('another product\'s code is not a registration code', core.cleanRegistrationCode('GOC2027') === null);

head('code status and the uses ledger');
function code(over) {
  return Object.assign({ id: 'REGCODE-X', label: 'L', hint: 'WXYZ', maxUses: 2, uses: [], expiresAt: null, revokedAt: null, createdBy: 'GOC-A-003', createdAt: '2026-11-01T00:00:00.000Z' }, over || {});
}
ok('a fresh code is active', core.registrationCodeStatus(code(), NOW) === 'active');
ok('held uses count towards the limit', core.registrationCodeStatus(code({ maxUses: 1, uses: [{ applicationId: 'A', state: 'held' }] }), NOW) === 'exhausted');
ok('finalised uses count forever', core.registrationCodeStatus(code({ maxUses: 1, uses: [{ applicationId: 'A', state: 'finalised' }] }), NOW) === 'exhausted');
ok('released uses free the seat', core.registrationCodeStatus(code({ maxUses: 1, uses: [{ applicationId: 'A', state: 'released' }] }), NOW) === 'active');
ok('revoked beats everything', core.registrationCodeStatus(code({ revokedAt: '2026-11-02T00:00:00.000Z', uses: [{ applicationId: 'A', state: 'released' }] }), NOW) === 'revoked');
ok('a past expiry is expired', core.registrationCodeStatus(code({ expiresAt: '2026-11-04T00:00:00.000Z' }), NOW) === 'expired');
ok('a future expiry is fine', core.registrationCodeStatus(code({ expiresAt: '2026-12-01T00:00:00.000Z' }), NOW) === 'active');
ok('counts separate held, finalised and released', (function () { var c = core.registrationCodeCounts(code({ uses: [{ state: 'held' }, { state: 'finalised' }, { state: 'released' }, { state: 'held' }] })); return c.held === 2 && c.finalised === 1 && c.released === 1 && c.used === 3; })());
var pub = core.publicRegistrationCode(code({ uses: [{ applicationId: 'A', state: 'held' }] }), NOW);
ok('the public view carries a hint and counts, never a hash', pub.hint === 'WXYZ' && pub.held === 1 && pub.status === 'active' && !('hash' in pub) && JSON.stringify(pub).indexOf('REGCODE-X') > -1);

head('application validation');
function form(over) {
  return Object.assign({ name: 'Adaeze Applicant', email: 'Adaeze@Example.com', phone: '0803 333 4444', password: 'applicant-secret-1', goal: 'JAMB / UTME 2027', subjects: COMBO, privacyConsent: { accepted: true } }, over || {});
}
var good = core.validateRegistrationApplication(form());
ok('a good form is accepted and tidied', !!good.rec && good.rec.email === 'adaeze@example.com' && good.rec.phone === '08033334444' && good.rec.subjects.length === 4, JSON.stringify(good));
ok('the record never contains the password itself', !('password' in good.rec) && !('pwHash' in good.rec));
ok('consent is required', !!core.validateRegistrationApplication(form({ privacyConsent: null })).error && !!core.validateRegistrationApplication(form({ privacyConsent: { accepted: false } })).error);
ok('a short name is refused', !!core.validateRegistrationApplication(form({ name: 'A' })).error);
ok('a bad email is refused', !!core.validateRegistrationApplication(form({ email: 'not-an-email' })).error);
ok('a bad phone is refused', !!core.validateRegistrationApplication(form({ phone: '123' })).error);
ok('a short password is refused', !!core.validateRegistrationApplication(form({ password: 'short' })).error);
ok('a non-UTME goal is refused', !!core.validateRegistrationApplication(form({ goal: 'WAEC' })).error);
ok('a wrong combination is refused', !!core.validateRegistrationApplication(form({ subjects: ['Use of English'] })).error);
ok('nothing at all is an error, not a crash', !!core.validateRegistrationApplication(null).error);

head('duplicate email rules');
var apps = [{ email: 'adaeze@example.com', status: 'pending' }];
ok('a pending application blocks a duplicate', /already awaiting review/.test(core.registrationEmailBlock(apps, [], 'ADAEZE@example.com') || ''));
ok('an approved application points at sign-in', /already has a G\.O\.C account/.test(core.registrationEmailBlock([{ email: 'a@x.ng', status: 'approved' }], [], 'a@x.ng') || ''));
ok('a rejected application does not block', core.registrationEmailBlock([{ email: 'a@x.ng', status: 'rejected' }], [], 'a@x.ng') === null);
ok('an existing student email points at sign-in', /already has a G\.O\.C account/.test(core.registrationEmailBlock([], [{ email: 's@x.ng' }], 's@x.ng') || ''));
ok('a fresh email is free', core.registrationEmailBlock(apps, [], 'new@x.ng') === null);

head('the console view of an application');
var full = { id: 'REGAPP-0001', status: 'pending', name: 'A', email: 'a@x.ng', phone: '0801', goal: 'JAMB / UTME 2027', subjects: COMBO, createdAt: '2026-11-05T09:00:00.000Z', codeId: 'REGCODE-X', codeLabel: 'Lagos', pwHash: 'scrypt$secret', setup: { tokenHash: 'deadbeef', delivery: 'sent', expiresAt: '2026-11-08T00:00:00.000Z', usedAt: null }, history: [{ at: 't', by: null, action: 'submitted', detail: 'Application received' }] };
var view = core.publicRegistrationApplication(full);
ok('pwHash and the token hash never leave the server', !('pwHash' in view) && JSON.stringify(view).indexOf('scrypt$secret') === -1 && JSON.stringify(view).indexOf('deadbeef') === -1, JSON.stringify(view));
ok('delivery state and history do show', view.setupDelivery === 'sent' && view.history.length === 1 && view.codeLabel === 'Lagos');

head('counts, capability and audit rules');
var counts = core.registrationCounts([{ status: 'pending' }, { status: 'pending' }, { status: 'provisioning-failed' }, { status: 'approved' }, { status: 'rejected' }], [code(), code({ revokedAt: 'x' })], NOW);
ok('overview counts add up', counts.pending === 2 && counts.provisioningFailed === 1 && counts.approved === 1 && counts.rejected === 1 && counts.activeCodes === 1, JSON.stringify(counts));
ok('Finance holds registrations.codes; no other manager role does', core.roleCan('finance', 'registrations.codes') && !core.roleCan('student-affairs', 'registrations.codes') && !core.roleCan('academic-director', 'registrations.codes') && !core.roleCan('publicity', 'registrations.codes'));
ok('application review stays with students.approve (Finance)', core.roleCan('finance', 'students.approve') && !core.roleCan('student-affairs', 'students.approve'));
ok('the four decisions are audited actions', ['registration-approve', 'registration-reject'].indexOf(core.auditActionFor('POST', '/api/registrations/applications/REGAPP-0001/approve', {}).action) > -1 && core.auditActionFor('POST', '/api/registrations/codes', {}).action === 'registration-code-create' && core.auditActionFor('POST', '/api/registrations/codes/REGCODE-X/revoke', {}).action === 'registration-code-revoke');
ok('the setup token lives 72 hours', core.SETUP_TOKEN_TTL_MS === 72 * 60 * 60 * 1000);

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
