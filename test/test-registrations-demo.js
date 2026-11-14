/* test-registrations-demo.js — Stage B in the offline demo driver: the same
   lifecycle as the server (code -> application -> approval -> setup -> access),
   with the setup token read through the test-only hook the way the emailed
   link would carry it.
   node test/test-registrations-demo.js */
'use strict';
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var sandbox = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Math: Math, JSON: JSON, Date: Date, Promise: Promise };
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var mock = vm.runInContext('GOC.api._drivers', ctx).mock;
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
async function errOf(p) { try { var r = await p; return (r && r.error) ? r : null; } catch (e) { return e; } }
function form(code, email) {
  return { code: code, name: 'Demo Applicant', email: email, phone: '08033334444', password: 'demo-secret-1', goal: 'JAMB / UTME 2027', subjects: COMBO, privacyConsent: { accepted: true } };
}

(async function () {
  head('the demo mirrors the lifecycle');
  ok('no code validates before any exists', (await mock.validateRegistrationCode({ code: 'GOC-REG-AB3DEF-GH4JKM' })).ok === false);
  ok('submission without a code is refused', !!(await errOf(mock.submitRegistration(form('', 'demo@example.com')))));
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var created = await mock.createRegistrationCode({ label: 'Demo cohort', maxUses: 1 });
  ok('the founder creates a code, shown once', /^GOC-REG-[A-Z2-9]{6}-[A-Z2-9]{6}$/.test(created.code || '') && created.registrationCode.hint === created.code.slice(-4), JSON.stringify(created).slice(0, 200));
  var CODE = created.code;
  var listing = await mock.listRegistrationCodes();
  ok('the listing never shows the full code', JSON.stringify(listing).indexOf(CODE) === -1 && listing.codes[0].status === 'active');
  await mock.logout();

  var sub = await mock.submitRegistration(form(CODE, 'demo@example.com'));
  ok('a valid code submits an application', sub.received === true, JSON.stringify(sub));
  ok('the applicant cannot sign in — there is no account', !!(await errOf(mock.login('GOC-S-001', 'demo-secret-1'))));
  var roster0 = await (async function () { await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027'); var r = await mock.listStudents(); await mock.logout(); return r; })();
  ok('no student exists yet', Array.isArray(roster0) && roster0.length === 0);
  ok('the exhausted single-use code refuses a second application', !!(await errOf(mock.submitRegistration(form(CODE, 'second@example.com')))));

  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var apps = await mock.listRegistrationApplications();
  ok('the console lists the pending application with counts', apps.applications.length === 1 && apps.counts.pending === 1 && apps.applications[0].scholarId === null, JSON.stringify(apps).slice(0, 200));
  ok('no secrets in the console view', !/pwHash|token|scrypt/.test(JSON.stringify(apps)));
  var appId = apps.applications[0].id;
  ok('rejection needs a reason', !!(await errOf(mock.rejectRegistrationApplication(appId, ''))));
  var rejected = await mock.rejectRegistrationApplication(appId, 'Not eligible');
  ok('rejection releases the seat: the code validates again', rejected.application.status === 'rejected' && (await mock.validateRegistrationCode({ code: CODE })).ok === true);
  await mock.logout();

  var sub2 = await mock.submitRegistration(form(CODE, 'demo@example.com'));
  ok('the rejected applicant may apply again', sub2.received === true);
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var apps2 = await mock.listRegistrationApplications();
  var app2 = apps2.applications.filter(function (a) { return a.status === 'pending'; })[0];
  var approved = await mock.approveRegistrationApplication(app2.id);
  ok('approval assigns the Scholar ID only now', !!approved.application && /^GOC-S-/.test(approved.application.scholarId || '') && approved.application.status === 'approved', JSON.stringify(approved).slice(0, 220));
  ok('delivery is honestly not-configured in the demo (it sends no email)', approved.setupDelivery === 'not-configured');
  ok('a duplicate approve is refused', !!(await errOf(mock.approveRegistrationApplication(app2.id))));
  var students = await mock.listStudents();
  ok('exactly one active student exists', students.length === 1 && students[0].id === approved.application.scholarId && students[0].active === true);
  var scholarId = approved.application.scholarId;
  await mock.logout();

  ok('sign-in is blocked until password setup', /Set your password/.test(String(((await errOf(mock.login(scholarId, 'demo-secret-1'))) || {}).message || '')));
  var token = mock._setupTokenFor(app2.id);
  ok('the test hook yields the setup token (stripped from production builds)', !!token);
  ok('setup completes with the chosen password', (await mock.completePasswordSetup({ token: token, password: 'demo-secret-1' })).ok === true);
  ok('the token cannot be reused', !!(await errOf(mock.completePasswordSetup({ token: token, password: 'demo-secret-1' }))));
  var login = await mock.login(scholarId, 'demo-secret-1');
  ok('the student signs in after setup', !!login && !login.error && login.role === 'student', JSON.stringify(login).slice(0, 160));

  head('revocation blocks a waiting approval in the demo too');
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var c2 = await mock.createRegistrationCode({ label: 'Short-lived', maxUses: 5 });
  var list2 = await mock.listRegistrationCodes();
  var code2Id = list2.codes.filter(function (c) { return c.label === 'Short-lived'; })[0].id;
  await mock.logout();
  await mock.submitRegistration(form(c2.code, 'late@example.com'));
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  await mock.revokeRegistrationCode(code2Id);
  var apps3 = await mock.listRegistrationApplications();
  var appLate = apps3.applications.filter(function (a) { return a.email === 'late@example.com'; })[0];
  var blocked = await errOf(mock.approveRegistrationApplication(appLate.id));
  var after = (await mock.listRegistrationApplications()).applications.filter(function (a) { return a.id === appLate.id; })[0];
  ok('approval is blocked into provisioning-failed', !!blocked && after.status === 'provisioning-failed' && after.provisionStep === 'validate-code', JSON.stringify(after).slice(0, 200));
  ok('no student was created by the blocked approval', (await mock.listStudents()).length === 1);
  await mock.logout();

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
