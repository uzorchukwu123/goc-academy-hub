/* test-p78.js — Priority 7 (closing a student account without losing its
   record) and Priority 8 (only the Founder may change management credentials),
   driven through the real console inside minidom, then checked again at the API
   so the guarantees do not depend on the buttons being absent.
   Run:  node test/test-p78.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }
function count(x, sel) { var e = id(x); return e ? e.querySelectorAll(sel).length : -1; }
function set(x, v) { var e = id(x); if (e) e.value = v; return !!e; }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 10) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }
function refused(call) { return call().then(function () { return '(allowed!)'; }, function (e) { return e.message; }); }

var FOUNDER = 'GOC-A-001', FPW = 'founder2027';
var DIRECTOR = 'GOC-A-002', DPW = 'acaddir2027';
var PASS = '2027';
var SUBJECTS = ['Use of English', 'Physics', 'Chemistry', 'Biology'];

/* There is no seeded demo roster any more (the app starts with zero
   students), so the roster the console pages through below is built here,
   through the same public sign-up path a real scholar uses, and the driver
   hands back the Scholar ID it actually assigned — nothing is hard-coded. */
function registerStudent(name, pw) {
  return api('createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME 2027', subjects: SUBJECTS
  }).then(function (r) { return r.student.id; });
}

var MPW = 'bello#88';
var SPW = 'nwosu2026';
var MINE, SID; /* assigned once the real students below are registered */

async function main() {
  /* Ten real students, registered the way real scholars register — enough
     for the roster the console pages through in section 7 to show a genuine
     "everyone" count. The first two are the ones with something further to
     do below; the rest are just company on the roster. */
  var ROSTER_NAMES = [
    'Tunde Bello', 'Ada Chukwu', 'Chiamaka Obi', 'Yusuf Bala', 'Ifeoma Nnaji',
    'Segun Adeyemi', 'Blessing Eze', 'Musa Garba', 'Funmilayo Ojo', 'Emeka Okoro'
  ];
  var ROSTER_PW = [
    MPW, SPW, 'okoro#77', 'bala-pass1', 'nnaji2026',
    'adeyemi99', 'blessing7x', 'garba-pw2', 'ojo12345', 'okoro88pw'
  ];
  var rosterIds = [];
  for (var ri = 0; ri < ROSTER_NAMES.length; ri++) {
    rosterIds.push(await registerStudent(ROSTER_NAMES[ri], ROSTER_PW[ri]));
  }
  MINE = rosterIds[0];
  SID = rosterIds[1];

  /* Two students with something on the record, so there is history to
     preserve when one of them is closed and reopened below. */
  head('two students build up a record first');
  await api('login')(MINE, MPW);
  var paper = await api('startTest')({ period: 'weekly', section: 'objective', subject: 'Physics' });
  var picks = {};
  paper.questions.forEach(function (q) { picks[q.id] = 0; });
  var sat = await api('submitTest')({ attemptId: paper.attemptId, responses: picks, secondsUsed: 240 });
  ok('the paper is on the record', !!sat.id, sat.id);
  var before = await api('myProfile')();
  var beforeXp = before.xp, beforePerf = before.performance;
  var beforeCount = (await api('myResults')()).attempts.length;
  ok('and the account carries XP', beforeXp > 0, beforeXp);
  ok('with a performance figure', typeof beforePerf === 'number', beforePerf);

  /* SID also needs a sitting of its own, so that closing its account below
     has real XP and a real result to preserve, not zeroes. */
  await api('login')(SID, SPW);
  var sidPaper = await api('startTest')({ period: 'weekly', section: 'objective', subject: 'Physics' });
  var sidPicks = {};
  sidPaper.questions.forEach(function (q) { sidPicks[q.id] = 0; });
  await api('submitTest')({ attemptId: sidPaper.attemptId, responses: sidPicks, secondsUsed: 200 });

  head('the console opens for management');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  await run('loadStudents')();
  await run('loadStaff')();
  await flush();

  head('7 — the roster shows who is open and who is closed');
  run('admOpen')('students');
  await flush();
  ['admStuTabs', 'admCredList', 'admStuNote'].forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  var everyone = count('admCredList', '.ad-cred');
  ok('every scholar has a card', everyone === 10, everyone);
  ok('none is closed to begin with', count('admCredList', '.ad-cred.off') === 0);
  ok('each card offers a way to close the account',
     markup('admCredList').split('admSetActive').length - 1 === everyone,
     markup('admCredList').split('admSetActive').length - 1);
  ok('the three filters are offered', count('admStuTabs', 'button') === 3, count('admStuTabs', 'button'));
  ok('the tabs count the roster', text('admStuTabs').indexOf('Everyone (10)') > -1, text('admStuTabs'));
  ok('and start with none deactivated', text('admStuTabs').indexOf('Deactivated (0)') > -1, text('admStuTabs'));
  ok('the note explains that nothing is deleted',
     text('admStuNote').indexOf('preserved') > -1, text('admStuNote'));

  head('7 — closing an account from the console');
  run('admSetActive')(SID, false);
  await flush();
  ok('the console says access was withdrawn, not data', text('toast').indexOf('every result and XP kept on file') > -1, text('toast'));
  ok('the card now reads as closed', count('admCredList', '.ad-cred.off') === 1, count('admCredList', '.ad-cred.off'));
  ok('and is tagged Deactivated', markup('admCredList').indexOf('Deactivated') > -1);
  ok('the tab count follows', text('admStuTabs').indexOf('Deactivated (1)') > -1, text('admStuTabs'));
  ok('the note now names the closed account', text('admStuNote').indexOf('1 account deactivated') > -1, text('admStuNote'));
  run('admStuSetFilter')('closed');
  await flush();
  ok('the deactivated filter shows only that one', count('admCredList', '.ad-cred') === 1, count('admCredList', '.ad-cred'));
  ok('it is the right one', markup('admCredList').indexOf(SID) > -1);
  run('admStuSetFilter')('active');
  await flush();
  ok('the active filter shows the other nine', count('admCredList', '.ad-cred') === 9, count('admCredList', '.ad-cred'));
  ok('and none of them is the closed account', markup('admCredList').indexOf(SID) < 0);
  run('admStuSetFilter')('all');
  await flush();
  ok('the closed account is still on the roster', count('admCredList', '.ad-cred') === 10, count('admCredList', '.ad-cred'));

  head('7 — a closed account cannot get in');
  var shut = await refused(function () { return api('login')(SID, SPW); });
  ok('the login is refused', shut.indexOf('deactivated') > -1, shut);
  ok('and the student is told their records are safe', shut.indexOf('records are safe') > -1, shut);
  var right = await refused(function () { return api('login')(SID, 'wrong-password'); });
  ok('a wrong password on a closed account gives away nothing at all',
     right === 'That ID and password do not match.', right);

  head('7 — nothing of the record is lost');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  var roster = await api('listStudents')();
  var closed = roster.filter(function (s) { return s.id === SID; })[0];
  ok('the Scholar ID is still on the roster', !!closed, SID);
  ok('flagged inactive so management can spot it', closed.active === false, closed.active);
  ok('with its XP intact', closed.xp > 0, closed.xp);
  ok('and its subject combination intact', closed.subjects.length === 4, closed.subjects.length);
  var theirs = await api('listResults')({ scholarId: SID });
  ok('its sittings are still in the record', theirs.results.length > 0, theirs.results.length);
  ok('still filed under the same Scholar ID',
     theirs.results.every(function (r) { return r.scholarId === SID; }));

  head('7 — reopening restores the account as it was');
  run('admSetActive')(SID, true);
  await flush();
  ok('the console confirms the record came back', text('toast').indexOf('record intact') > -1, text('toast'));
  ok('no card reads as closed any more', count('admCredList', '.ad-cred.off') === 0, count('admCredList', '.ad-cred.off'));
  var back = await api('login')(SID, SPW);
  ok('the student can sign in again', back.id === SID, back.id);
  var backProf = await api('myProfile')();
  ok('with the same XP', backProf.xp === closed.xp, backProf.xp + ' vs ' + closed.xp);
  ok('and the same performance', backProf.performance === closed.performance,
     backProf.performance + ' vs ' + closed.performance);
  ok('and the same results still on file',
     (await api('myResults')()).attempts.length === theirs.results.length,
     (await api('myResults')()).attempts.length + ' vs ' + theirs.results.length);

  head('7 — a student cannot close or reopen an account');
  await api('login')(MINE, MPW);
  var mineNow = await api('myProfile')();
  ok('their own record survived all of that', mineNow.xp === beforeXp, mineNow.xp + ' vs ' + beforeXp);
  ok('and so did their results', (await api('myResults')()).attempts.length === beforeCount,
     (await api('myResults')()).attempts.length + ' vs ' + beforeCount);
  var noClose = await refused(function () { return api('setStudentActive')(SID, false); });
  ok('a student cannot deactivate anyone', noClose.indexOf('Management accounts only') > -1, noClose);
  var noSelf = await refused(function () { return api('setStudentActive')(MINE, true); });
  ok('not even their own account', noSelf.indexOf('Management accounts only') > -1, noSelf);
  head('8 — the Founder sees real credential controls');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  await run('loadStaff')();
  run('admOpen')('access');
  await flush();
  ok('#admAccess exists', !!id('admAccess'));
  ok('the panel knows the Founder is signed in', text('admAccess').indexOf('Founder') > -1, text('admAccess'));
  ok('and says credentials may be changed', text('admAccess').indexOf('Yes — Founder') > -1);
  ['admPwWho', 'admPwNew', 'admPwNew2', 'admPcNew', 'admPcNew2']
    .forEach(function (x) { ok('#' + x + ' is offered', !!id(x)); });
  ok('the demo passcode button is gone', markup('admPanel').indexOf('Passcode change — demo') < 0);
  ok('every staff account can be picked', count('admPwWho', 'option') === 2, count('admPwWho', 'option'));
  ok('the new password box is a password field', id('admPwNew').getAttribute('type') === 'password',
     id('admPwNew').getAttribute('type'));
  ok('so is the confirmation', id('admPwNew2').getAttribute('type') === 'password');
  ok('and both passcode boxes too',
     id('admPcNew').getAttribute('type') === 'password' && id('admPcNew2').getAttribute('type') === 'password');
  ok('the current passcode is shown only as dots, four of them',
     markup('admAccess').indexOf('<code>••••</code>') > -1, markup('admAccess'));
  ok('the passcode itself is nowhere on the page', markup('admPanel').indexOf(PASS) < 0);
  ok('nor is any management password', markup('admPanel').indexOf(FPW) < 0 && markup('admPanel').indexOf(DPW) < 0);

  head('8 — a weak management password is refused');
  set('admPwWho', DIRECTOR); set('admPwNew', 'short1'); set('admPwNew2', 'short1');
  run('admPwSave')();
  await flush();
  ok('under 8 characters is refused', text('toast').indexOf('at least 8 characters') > -1, text('toast'));
  ok('the typed password is wiped from the form even so', id('admPwNew').value === '', id('admPwNew').value);
  set('admPwNew', 'allletters'); set('admPwNew2', 'allletters');
  run('admPwSave')();
  await flush();
  ok('letters with no digits is refused', text('toast').indexOf('letters and numbers') > -1, text('toast'));
  set('admPwNew', 'goodpass22'); set('admPwNew2', 'goodpass23');
  run('admPwSave')();
  await flush();
  ok('a mistyped confirmation is caught before anything is sent',
     text('toast').indexOf('do not match') > -1, text('toast'));
  ok('and nothing was changed', (await refused(function () { return api('login')(DIRECTOR, 'goodpass22'); }))
     .indexOf('do not match') > -1);

  head('8 — the Founder changes a management password');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  run('admOpen')('access');
  await flush();
  set('admPwWho', DIRECTOR); set('admPwNew', 'newdir2027'); set('admPwNew2', 'newdir2027');
  run('admPwSave')();
  await flush();
  ok('the change is confirmed', text('toast').indexOf('Password updated for ' + DIRECTOR) > -1, text('toast'));
  ok('and the confirmation carries no password', text('toast').indexOf('newdir2027') < 0, text('toast'));
  ok('both boxes are emptied', id('admPwNew').value === '' && id('admPwNew2').value === '');
  var newLogin = await api('login')(DIRECTOR, 'newdir2027');
  ok('the Academic Director signs in with the new password', newLogin.id === DIRECTOR, newLogin.id);
  var oldPw = await refused(function () { return api('login')(DIRECTOR, DPW); });
  ok('the old password no longer works', oldPw.indexOf('do not match') > -1, oldPw);

  head('8 — an Academic Director is not offered the controls, and is refused anyway');
  await api('login')(DIRECTOR, 'newdir2027');
  await api('unlockConsole')(PASS);
  await run('loadStaff')();
  run('admOpen')('access');
  await flush();
  ok('the panel says only the Founder may change credentials',
     text('admAccess').indexOf('No — Founder only') > -1, text('admAccess'));
  ok('no password form is rendered', !id('admPwNew') && !id('admPwNew2'));
  ok('no passcode form either', !id('admPcNew') && !id('admPcNew2'));
  ok('and the reason is spelled out', text('admAccess').indexOf('checked on the server') > -1);
  var byDir = await refused(function () { return api('setStaffPassword')(FOUNDER, 'takeover99'); });
  ok('a hand-made request to change the Founder\'s password is refused',
     byDir.indexOf('Only the Founder can change management credentials') > -1, byDir);
  var pcDir = await refused(function () { return api('setConsolePasscode')('9999'); });
  ok('so is a hand-made passcode change', pcDir.indexOf('Only the Founder') > -1, pcDir);
  ok('the Founder\'s password is untouched', (await api('login')(FOUNDER, FPW)).id === FOUNDER);
  await api('unlockConsole')(PASS);
  ok('and the passcode still works', (await api('staffAccess')()).isFounder === true);

  head('8 — a student is nowhere near any of this');
  await api('login')(MINE, MPW);
  var studentShutOut = [
    ['read the access panel', function () { return api('staffAccess')(); }],
    ['change a management password', function () { return api('setStaffPassword')(FOUNDER, 'student99'); }],
    ['change the firewall passcode', function () { return api('setConsolePasscode')('1234'); }],
    ['unlock the console', function () { return api('unlockConsole')(PASS); }]
  ];
  for (var i = 0; i < studentShutOut.length; i++) {
    var m = await refused(studentShutOut[i][1]);
    ok('a student cannot ' + studentShutOut[i][0], m.indexOf('Management accounts only') > -1, m);
  }

  head('8 — the Founder changes the firewall passcode');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  run('admOpen')('access');
  await flush();
  set('admPcNew', '12ab'); set('admPcNew2', '12ab');
  run('admPcSave')();
  await flush();
  ok('a non-numeric passcode is refused', text('toast').indexOf('4 to 8 digits') > -1, text('toast'));
  set('admPcNew', '123'); set('admPcNew2', '123');
  run('admPcSave')();
  await flush();
  ok('three digits is refused', text('toast').indexOf('4 to 8 digits') > -1, text('toast'));
  set('admPcNew', '135790'); set('admPcNew2', '135791');
  run('admPcSave')();
  await flush();
  ok('a mistyped confirmation is caught', text('toast').indexOf('do not match') > -1, text('toast'));
  set('admPcNew', '135790'); set('admPcNew2', '135790');
  run('admPcSave')();
  await flush();
  ok('a good passcode is accepted', text('toast').indexOf('6 digits') > -1, text('toast'));
  ok('the new passcode is not echoed back', text('toast').indexOf('135790') < 0, text('toast'));
  ok('nor written into the panel', markup('admPanel').indexOf('135790') < 0);
  ok('the panel now shows six dots', markup('admAccess').indexOf('<code>••••••</code>') > -1, markup('admAccess'));
  ok('both boxes are emptied', id('admPcNew').value === '' && id('admPcNew2').value === '');

  head('8 — the old passcode is dead');
  await api('login')(FOUNDER, FPW);
  var stale = await refused(function () { return api('unlockConsole')(PASS); });
  ok('the previous passcode no longer unlocks the console', stale.indexOf('asscode') > -1, stale);
  var unlocked = await api('unlockConsole')('135790');
  ok('the new one does', unlocked === true || !!unlocked, unlocked);
  head('8 — the create-account firewall is in the console');
  run('admOpen')('access');
  await flush();
  var RULES = run('GOC.api.rules');
  var DEFCODE = RULES.normalizeSignupCode(RULES.SIGNUP_CODE_DEFAULT);
  ok('the panel names the firewall', text('admAccess').indexOf('Create-account firewall') > -1, text('admAccess'));
  ['admScNew', 'admScNew2'].forEach(function (x) { ok('#' + x + ' is offered', !!id(x)); });
  ok('the code is shown only as dots, one per character',
     markup('admAccess').indexOf('<code>' + new Array(DEFCODE.length + 1).join('•') + '</code>') > -1,
     markup('admAccess'));
  ok('the code itself is nowhere in the console', markup('admPanel').indexOf(DEFCODE) < 0);
  ok('and the panel warns that it is still the code the Hub shipped with',
     text('admAccess').indexOf('still the access code the Hub was published with') > -1, text('admAccess'));
  ok('it says the code has never been changed', text('admAccess').indexOf('Never —') > -1, text('admAccess'));

  head('8 — the Founder rotates the create-account code');
  set('admScNew', 'AB'); set('admScNew2', 'AB');
  run('admScSave')();
  await flush();
  ok('a code below the bound is refused', text('toast').indexOf('at least 4') > -1, text('toast'));
  set('admScNew', 'GOC*CODE'); set('admScNew2', 'GOC*CODE');
  run('admScSave')();
  await flush();
  ok('punctuation is refused', text('toast').indexOf('letters, numbers and dashes') > -1, text('toast'));
  set('admScNew', 'INTAKE-9'); set('admScNew2', 'INTAKE-8');
  run('admScSave')();
  await flush();
  ok('a mistyped confirmation is caught before anything is sent',
     text('toast').indexOf('do not match') > -1, text('toast'));
  /* Lower case in one box, padded capitals in the other: the confirmation is
     compared after the same normalising the sign-up form uses, so a scholar
     copying the code off a printed slip is not tripped up by it either. */
  set('admScNew', 'intake-9'); set('admScNew2', '  INTAKE-9  ');
  run('admScSave')();
  await flush();
  ok('a good code is accepted however it was typed', text('toast').indexOf('7 characters') > -1, text('toast'));
  ok('the new code is not echoed back', text('toast').indexOf('INTAKE-9') < 0, text('toast'));
  ok('nor written into the panel', markup('admPanel').indexOf('INTAKE-9') < 0);
  ok('both boxes are emptied', id('admScNew').value === '' && id('admScNew2').value === '');
  ok('the panel drops the shipped-default warning',
     text('admAccess').indexOf('still the access code the Hub was published with') < 0, text('admAccess'));
  ok('and records who changed it', /by GOC-A-001/.test(text('admAccess')), text('admAccess'));

  head('8 — a stranger cannot open an account');
  var strangers = [
    ['with no code at all', {}, 'Enter the academy access code'],
    ['with a code that is too short', { signupCode: 'AB' }, 'at least 4'],
    ['with punctuation in the code', { signupCode: 'GOC*CODE' }, 'letters, numbers and dashes'],
    ['with the code the Hub shipped with, now rotated', { signupCode: DEFCODE }, 'not correct'],
    ['with a guess', { signupCode: 'LET-ME-IN' }, 'not correct']
  ];
  for (var k = 0; k < strangers.length; k++) {
    var body = Object.assign({ name: 'Stranger Danger', password: 'secret123',
                               goal: 'JAMB / UTME 2027',
                               subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] },
                             strangers[k][1]);
    var m = await refused((function (b) { return function () { return api('createStudent')(b); }; }(body)));
    ok('sign-up ' + strangers[k][0] + ' is refused', m.indexOf(strangers[k][2]) > -1, m);
  }
  /* The firewall answers before every other rule, so somebody without the code
     cannot use the sign-up form to learn which examinations the academy runs. */
  var probe = await refused(function () {
    return api('createStudent')({ signupCode: 'LET-ME-IN', name: 'X', password: '1',
                                  goal: 'WAEC', subjects: [] });
  });
  ok('and it answers before every other rule', probe.indexOf('not correct') > -1 &&
     probe.indexOf('UTME') < 0, probe);

  head('8 — the Academic Director may rotate the code too');
  await api('login')(DIRECTOR, 'newdir2027');
  await api('unlockConsole')('135790');
  await run('loadStaff')();
  run('admOpen')('access');
  await flush();
  ok('she is still not the Founder', text('admAccess').indexOf('No — Founder only') > -1, text('admAccess'));
  ok('no management password form is drawn for her', !id('admPwNew') && !id('admPcNew'));
  ok('but the create-account firewall is', !!id('admScNew') && !!id('admScNew2'));
  ok('and the panel says why she has that one and not the others',
     text('admAccess').indexOf('create-account code above') > -1, text('admAccess'));
  set('admScNew', 'SECOND-INTAKE'); set('admScNew2', 'SECOND-INTAKE');
  run('admScSave')();
  await flush();
  ok('she can change it', text('toast').indexOf('12 characters') > -1, text('toast'));
  ok('and the change is recorded against her', /by GOC-A-002/.test(text('admAccess')), text('admAccess'));
  var deadNine = await refused(function () {
    return api('createStudent')({ signupCode: 'INTAKE-9', name: 'Too Late',
                                  password: 'secret123', goal: 'JAMB / UTME 2027',
                                  subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] });
  });
  ok('the code the Founder set stops working the moment she changes it',
     deadNine.indexOf('not correct') > -1, deadNine);

  head('8 — a student cannot open the roll to their friends');
  await api('login')(MINE, MPW);
  var scStu = await refused(function () { return api('setSignupCode')('FRIENDS-4'); });
  ok('a student cannot change the create-account code',
     scStu.indexOf('Management accounts only') > -1, scStu);
  await api('login')(FOUNDER, FPW);
  var scLocked = await refused(function () { return api('setSignupCode')('LOCKED-99'); });
  ok('nor can management before passing the console firewall',
     scLocked.indexOf('access passcode first') > -1, scLocked);

  head('8 — an admitted scholar walks in with the code that is in force');
  var joined = await api('createStudent')({ signupCode: '  second-intake  ',
    name: 'Ngozi Firewall', password: 'letmein9',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] });
  ok('the account is created', /^GOC-S-\d+$/.test((joined.student || {}).id || ''), (joined.student || {}).id);
  ok('capitals and stray spaces in the code did not stop her',
     (joined.session || {}).id === joined.student.id, JSON.stringify(joined.session || {}));
  ok('and nothing about the code came back with it',
     JSON.stringify(joined).toUpperCase().indexOf('SECONDINTAKE') < 0 &&
     JSON.stringify(joined).indexOf('SECOND-INTAKE') < 0 && JSON.stringify(joined).indexOf('signupCode') < 0,
     JSON.stringify(joined).slice(0, 200));
  /* PLACEHOLDER-P78 */
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}
main();
