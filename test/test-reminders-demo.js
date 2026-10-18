/* test-reminders-demo.js — Phase 2, Reminders (demo driver): getReminders /
   setReminders on the offline driver follow the same rules and messages as
   GET/POST /api/me/reminders. Loads the real js/goc-core.js and js/api.js.
   node test/test-reminders-demo.js  */
'use strict';
var activeStudent = require('./active-student.js');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var sandbox = {
  console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
var core = vm.runInContext('GOC.core', ctx);
var api = vm.runInContext('GOC.api', ctx);
var drivers = vm.runInContext('GOC.api._drivers', ctx);
var mock = drivers.mock;
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }

console.log('\nDemo driver: study reminders');
ok('GOC.api forwards both calls', typeof api.getReminders === 'function' && typeof api.setReminders === 'function');
ok('both drivers have both', typeof mock.getReminders === 'function' && typeof drivers.http.getReminders === 'function' &&
  typeof mock.setReminders === 'function' && typeof drivers.http.setReminders === 'function');

rejects(mock.getReminders()).then(function (m) {
  ok('signed out: refused', /log in/i.test(m || ''), m);
  return rejects(mock.setReminders({ email: false }));
}).then(function (m) {
  ok('signed out: cannot change either', /log in/i.test(m || ''), m);
  var code = 'GOC2027';
  return activeStudent.demo(mock, { signupCode: code, name: 'Ada Test', password: 'secret123', email: 'ada@example.com',
    phone: '08000000009', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
}).then(function () {
  return mock.getReminders();
}).then(function (r) {
  var v = r.reminders;
  ok('opted in by default: email on, SMS off', v.email === true && v.sms === false, JSON.stringify(v));
  ok('knows the address and number', v.hasEmail === true && v.hasPhone === true);
  ok('nothing is delivered in demo mode, and it says so', v.deliverable.email === false && v.deliverable.sms === false);
  return rejects(mock.setReminders({}));
}).then(function (m) {
  ok('an empty change is refused with the server\'s words', m === 'Say which reminders to change.', m);
  return rejects(mock.setReminders({ email: 'no' }));
}).then(function (m) {
  ok('a non-boolean is refused with the server\'s words', m === 'Reminders can only be switched on or off.', m);
  return mock.setReminders({ email: false });
}).then(function (r) {
  ok('switching off works', r.ok === true && r.reminders.email === false && r.reminders.sms === false, JSON.stringify(r));
  return mock.getReminders();
}).then(function (r) {
  ok('and it is remembered', r.reminders.email === false);
  return mock.setReminders({ email: true, sms: true });
}).then(function (r) {
  ok('both at once', r.reminders.email === true && r.reminders.sms === true);
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
