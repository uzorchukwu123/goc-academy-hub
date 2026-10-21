/* test-managers-rules.js - Roles slice (c), step 1: the pure rules for issuing managers.
   Nothing stores or serves a manager yet. Pins the owner's decisions of 14 Oct 2026.
   node test/test-managers-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var good = { name: 'Ada Obi', role: 'finance', password: 'starter-pass', passcode: '4821' };

head('manager IDs');
ok('the first manager is GOC-A-003', core.nextManagerId(['GOC-A-001', 'GOC-A-002'], null) === 'GOC-A-003');
ok('with managers 003 and 004 the next is 005', core.nextManagerId(['GOC-A-001', 'GOC-A-002', 'GOC-A-003', 'GOC-A-004']) === 'GOC-A-005');
ok('a deleted ID is never issued again (the high-water mark holds it)', core.nextManagerId(['GOC-A-001', 'GOC-A-002', 'GOC-A-003'], 'GOC-A-005') === 'GOC-A-006');
ok('a damaged high-water mark is ignored', core.nextManagerId(['GOC-A-001', 'GOC-A-002'], 'nonsense') === 'GOC-A-003' && core.nextManagerId(['GOC-A-001', 'GOC-A-002'], undefined) === 'GOC-A-003');
ok('bad input still gives the first manager ID', core.nextManagerId(null, null) === 'GOC-A-003');

head('creating a manager');
var r = core.validateManager(good);
ok('a good record is accepted', !!r.rec && !r.error, JSON.stringify(r));
ok('the role is kept as a key with its full title', r.rec.role === 'finance' && r.rec.title === 'Finance & Administration Manager');
ok('the typed password is only a starting one: the manager must change it', r.rec.mustChangePassword === true);
ok('the name is tidied', core.validateManager(Object.assign({}, good, { name: '  Ada   Obi ' })).rec.name === 'Ada Obi');
ok('a full title works for the role, any case', core.validateManager(Object.assign({}, good, { role: 'publicity & communications manager' })).rec.role === 'publicity');
ok('all four manager roles can be issued', ['academic-director', 'finance', 'publicity', 'student-affairs'].every(function (k) { return !!core.validateManager(Object.assign({}, good, { role: k })).rec; }));

head('what is refused');
ok('the Founder role cannot be issued', !!core.validateManager(Object.assign({}, good, { role: 'founder' })).error && !!core.validateManager(Object.assign({}, good, { role: 'Founder' })).error);
ok('an unknown or empty role is refused', !!core.validateManager(Object.assign({}, good, { role: 'chairman' })).error && !!core.validateManager(Object.assign({}, good, { role: '' })).error && !!core.validateManager(Object.assign({}, good, { role: null })).error);
ok('a missing or one-letter name is refused', !!core.validateManager(Object.assign({}, good, { name: '' })).error && !!core.validateManager(Object.assign({}, good, { name: 'A' })).error);
ok('a name over 80 letters is refused', !!core.validateManager(Object.assign({}, good, { name: new Array(82).join('a') })).error);
ok('a short or missing password is refused when creating', !!core.validateManager(Object.assign({}, good, { password: 'short' })).error && !!core.validateManager(Object.assign({}, good, { password: '' })).error);
ok('a password over 200 characters is refused', !!core.validateManager(Object.assign({}, good, { password: new Array(202).join('a') })).error);
ok('the passcode must be 4 to 8 digits', ['', '123', '123456789', 'abcd', '12 34', '12.34', null].every(function (pc) { return !!core.validateManager(Object.assign({}, good, { passcode: pc })).error; }));
ok('4 and 8 digits are accepted', !!core.validateManager(Object.assign({}, good, { passcode: '0042' })).rec && !!core.validateManager(Object.assign({}, good, { passcode: '12345678' })).rec);
ok('nothing at all is refused', !!core.validateManager(null).error && !!core.validateManager({}).error);

head('editing a manager (blank means keep)');
var e = core.validateManager({ name: 'Ada Obi', role: 'publicity' }, { creating: false });
ok('an edit with no password or passcode is accepted', !!e.rec && e.rec.password === '' && e.rec.passcode === '');
ok('an edit that keeps the password does not force a change', e.rec.mustChangePassword === undefined);
ok('a new password on an edit forces a change again', core.validateManager({ name: 'Ada Obi', role: 'publicity', password: 'another-pass' }, { creating: false }).rec.mustChangePassword === true);
ok('a bad new password or passcode on an edit is still refused', !!core.validateManager({ name: 'Ada Obi', role: 'publicity', password: 'x' }, { creating: false }).error && !!core.validateManager({ name: 'Ada Obi', role: 'publicity', passcode: '12' }, { creating: false }).error);
ok('an edit cannot turn a manager into the Founder', !!core.validateManager({ name: 'Ada Obi', role: 'founder' }, { creating: false }).error);

head('what the panel may see');
var pm = core.publicManager({ id: 'GOC-A-003', name: 'Ada Obi', title: 'Finance & Administration Manager', pwHash: 'h', passcodeHash: 'p', password: 'x', passcode: '1234', mustChangePassword: true });
ok('the public view has the ID, name, role, title and status', pm.id === 'GOC-A-003' && pm.name === 'Ada Obi' && pm.role === 'finance' && pm.title === 'Finance & Administration Manager' && pm.active === true && pm.mustChangePassword === true, JSON.stringify(pm));
ok('no hash, password or passcode ever appears in it', JSON.stringify(pm).indexOf('"h"') < 0 && !('pwHash' in pm) && !('passcodeHash' in pm) && !('password' in pm) && !('passcode' in pm));
ok('a deactivated manager reads as inactive', core.publicManager({ id: 'GOC-A-004', name: 'B', role: 'publicity', active: false }).active === false);
ok('a nothing record gives a safe empty view', core.publicManager(null).id === '' && core.publicManager(null).role === null);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
