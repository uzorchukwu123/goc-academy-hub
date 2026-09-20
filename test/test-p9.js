/* test-p9.js — Priority 9: the student session threshold, the warning the
   student is given before it runs out, and the automatic logout at zero.

   The clock is driven by hand. The harness stubs setInterval, so nothing ticks
   on its own: the tests set the expiry the watcher is working from and then call
   ssTick()/ssPoll() directly. That is deliberate — it lets a two-hour session be
   examined at 05:00 remaining and at 00:00 without waiting for either.
   Run:  node test/test-p9.js  */
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
function shown(x) { var e = id(x); return !!e && e.style.display !== 'none'; }
function on(x) { var e = id(x); return !!e && e.classList.contains('active'); }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 10) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }
function rules() { return run('GOC.api.rules'); }
function refused(call) { return call().then(function () { return '(allowed!)'; }, function (e) { return e.message; }); }
/* Puts the watcher a chosen number of seconds from the end, without waiting. */
function leaveSeconds(s) {
  run('ss').expiresAt = Date.now() + s * 1000 + 400;
}

/* There is no seeded demo roster any more (Priority: "the roll is closed to
   strangers"), so the student this suite watches is registered through the
   same public sign-up path a scholar would use, and the driver hands back
   the Scholar ID it actually assigned — nothing here is hard-coded. */
async function registerStudent(name, pw) {
  var r = await run('GOC.api.createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics']
  });
  return r.student.id;
}

var FOUNDER = 'GOC-A-001', FPW = 'founder2027';
var PASS = '2027';
var SID, SPW = 'bello#88';

async function main() {
  head('9 — the policy is clamped in one place, for every driver');
  var R = rules();
  ok('the rulebook publishes the session bounds', !!(R && R.SESSION_BOUNDS), R && R.SESSION_BOUNDS);
  ok('a session of 120 minutes is accepted as it stands', R.clampSessionMinutes(120) === 120, R.clampSessionMinutes(120));
  ok('one minute is lifted to the 15-minute floor', R.clampSessionMinutes(1) === 15, R.clampSessionMinutes(1));
  ok('a week is brought down to the 480-minute ceiling', R.clampSessionMinutes(10080) === 480, R.clampSessionMinutes(10080));
  ok('nonsense falls back to the default', R.clampSessionMinutes('soon') === R.SESSION_DEFAULT, R.clampSessionMinutes('soon'));
  ok('a fractional value is rounded', R.clampSessionMinutes(90.4) === 90, R.clampSessionMinutes(90.4));
  ok('five minutes of warning stands on a two-hour session', R.clampWarnMinutes(5, 120) === 5, R.clampWarnMinutes(5, 120));
  ok('a warning is never shorter than a minute', R.clampWarnMinutes(0, 120) === R.WARN_DEFAULT, R.clampWarnMinutes(0, 120));
  ok('nor longer than thirty', R.clampWarnMinutes(90, 480) === 30, R.clampWarnMinutes(90, 480));
  ok('and never as long as the session it warns about',
     R.clampWarnMinutes(30, 15) === 14, R.clampWarnMinutes(30, 15));
  ok('on the shortest session the warning still fits', R.clampWarnMinutes(20, 15) < 15, R.clampWarnMinutes(20, 15));

  head('9 — the countdown reads the way the specification asks');
  ok('299 seconds reads 04:59', R.fmtCountdown(299) === '04:59', R.fmtCountdown(299));
  ok('300 seconds reads 05:00', R.fmtCountdown(300) === '05:00', R.fmtCountdown(300));
  ok('9 seconds keeps both pairs of digits', R.fmtCountdown(9) === '00:09', R.fmtCountdown(9));
  ok('zero reads 00:00', R.fmtCountdown(0) === '00:00', R.fmtCountdown(0));
  ok('past time never shows a minus sign', R.fmtCountdown(-40) === '00:00', R.fmtCountdown(-40));
  ok('an hour reads 60:00', R.fmtCountdown(3600) === '60:00', R.fmtCountdown(3600));
  head('9 — what the session reports about itself');
  var out = await api('sessionInfo')();
  ok('with nobody signed in there is no session', out.active === false, JSON.stringify(out));
  ok('and no time left to report', out.expiresInSec === 0, out.expiresInSec);
  SID = await registerStudent('Tunde Bello', SPW);
  await api('login')(SID, SPW);
  var live = await api('sessionInfo')();
  ok('after logging in the session is live', live.active === true, JSON.stringify(live));
  ok('it names the scholar it belongs to', live.id === SID, live.id);
  ok('it carries the academy session length', live.sessionMinutes === 120, live.sessionMinutes);
  ok('and the warning lead time', live.sessionWarnMinutes === 5, live.sessionWarnMinutes);
  ok('the lead time is given in seconds too, so the page need not clamp it',
     live.warnInSec === 300, live.warnInSec);
  ok('the remaining time matches the session length',
     live.expiresInSec > 7100 && live.expiresInSec <= 7200, live.expiresInSec);
  ok('an absolute expiry is given, not just a duration', live.expiresAt > Date.now(), live.expiresAt);

  head('9 — a student cannot lengthen their own session');
  var noSess = await refused(function () { return api('setSessionMinutes')(480); });
  ok('setting the session length is refused', noSess.indexOf('Management') > -1, noSess);
  var noWarn = await refused(function () { return api('setSessionWarnMinutes')(1); });
  ok('so is setting the warning', noWarn.indexOf('Management') > -1, noWarn);
  var still = await api('sessionInfo')();
  ok('and the policy has not moved', still.sessionMinutes === 120, still.sessionMinutes);
  head('9 — management finds the setting in the console');
  await api('login')(FOUNDER, FPW);
  run('role = "admin"');
  await api('unlockConsole')(PASS);
  run('admOpen')('window');
  await flush();
  ok('the daily study window is still there', markup('admPanel').indexOf('Daily study window') > -1);
  ok('and the session card sits beside it', markup('admPanel').indexOf('Student session time') > -1);
  ['admSess', 'admSessVal', 'admWarnVal', 'admWarnStep', 'admSessNote'].forEach(function (x) {
    ok('#' + x + ' exists', !!id(x));
  });
  ok('the session length is shown', text('admSessVal') === '120 min', text('admSessVal'));
  ok('the warning is shown', text('admWarnVal') === '5 min', text('admWarnVal'));
  ok('both steppers carry a number, not a bare label',
     text('admSessVal').indexOf('min') > -1 && text('admWarnStep').indexOf('min') > -1,
     text('admWarnStep'));
  ok('the note explains what a student will experience',
     text('admSessNote').indexOf('120') > -1 && text('admSessNote').indexOf('countdown') > -1,
     text('admSessNote'));
  ok('the card says the expiry is enforced on the server',
     markup('admPanel').indexOf('Enforced on the server') > -1);
  ok('it does not offer a way to see any password', markup('admPanel').indexOf('assword') < 0);

  head('9 — the steppers move the policy');
  run('admSetSession')(15);
  await flush();
  ok('the session lengthens by a quarter of an hour', text('admSessVal') === '135 min', text('admSessVal'));
  ok('and the console says so', text('toast').indexOf('135 minutes') > -1, text('toast'));
  run('admSetWarn')(1);
  await flush();
  ok('the warning lengthens by a minute', text('admWarnVal') === '6 min', text('admWarnVal'));
  ok('with the second stepper following it', text('admWarnStep') === '6 min', text('admWarnStep'));
  ok('the note is rewritten to match',
     text('admSessNote').indexOf('135') > -1 && text('admSessNote').indexOf('6 minutes') > -1,
     text('admSessNote'));
  head('9 — an out-of-range value is brought back inside the bounds');
  var big = await api('setSessionMinutes')(9999);
  ok('nobody can be signed in for a week', big.sessionMinutes === 480, big.sessionMinutes);
  var wide = await api('setSessionWarnMinutes')(120);
  ok('the warning is capped at half an hour', wide.sessionWarnMinutes === 30, wide.sessionWarnMinutes);
  var tiny = await api('setSessionMinutes')(2);
  ok('a two-minute session is lifted to fifteen', tiny.sessionMinutes === 15, tiny.sessionMinutes);
  ok('and shortening the session shortens the warning with it, in the same breath',
     tiny.sessionWarnMinutes === 14, tiny.sessionWarnMinutes);
  var back = await api('setSessionMinutes')(120);
  ok('a session can be lengthened again', back.sessionMinutes === 120, back.sessionMinutes);
  var reset = await api('setSessionWarnMinutes')(5);
  ok('the policy can be put back', reset.sessionMinutes === 120 && reset.sessionWarnMinutes === 5,
     JSON.stringify(reset));
  run('admOpen')('window');
  await flush();
  ok('and the console redraws at the restored figures',
     text('admSessVal') === '120 min' && text('admWarnVal') === '5 min',
     text('admSessVal') + ' / ' + text('admWarnVal'));
  head('9 — the student is watched from the moment they log in');
  run('role = "student"');
  await api('login')(SID, SPW);
  run('ssStart')();
  await flush();
  var w = run('ss');
  ok('the watcher is running', w.on === true, w.on);
  ok('it has the expiry the session reported', w.expiresAt > Date.now() + 7000000, w.expiresAt);
  ok('and the academy warning lead time, in seconds', w.warnSec === 300, w.warnSec);
  ok('nothing is shown two hours out', !shown('ssBar'));
  ok('and no screen has had to make room for it',
     !doc.body.classList.contains('session-warning'), doc.body.className);

  head('9 — nothing appears before the warning window');
  leaveSeconds(400);
  run('ssTick')();
  ok('at 06:40 remaining the bar stays down', !shown('ssBar'));

  head('9 — the notification, once the window is entered');
  leaveSeconds(299);
  run('ssTick')();
  ok('the bar is showing', shown('ssBar'), (id('ssBar') || {}).style);
  ok('it carries the wording the specification asks for',
     text('ssBar').indexOf('Your session is about to expire.') > -1 &&
     text('ssBar').indexOf('You will be automatically logged out soon.') > -1, text('ssBar'));
  ok('the countdown reads exactly "Automatic logout in 04:59"',
     text('ssCount') === 'Automatic logout in 04:59', text('ssCount'));
  ok('and the body pushes every screen down so nothing is covered',
     doc.body.classList.contains('session-warning'), doc.body.className);
  ok('it is announced to a screen reader', id('ssBar').getAttribute('aria-live') === 'polite');
  ok('the student is still signed in', run('ss').on === true);

  head('9 — the countdown keeps counting');
  leaveSeconds(61);
  run('ssTick')();
  ok('at a minute out it reads 01:01', text('ssCount') === 'Automatic logout in 01:01', text('ssCount'));
  leaveSeconds(9);
  run('ssTick')();
  ok('at nine seconds it reads 00:09', text('ssCount') === 'Automatic logout in 00:09', text('ssCount'));
  head('9 — at zero the session ends and the student is told why');
  leaveSeconds(-2);
  run('ssTick')();
  await flush();
  ok('the watcher has stopped', run('ss').on === false, run('ss').on);
  ok('the warning bar is taken down with it', !shown('ssBar'));
  ok('and no screen is left padded for it', !doc.body.classList.contains('session-warning'));
  ok('the login screen is what is showing', on('login-v2'), 'login-v2');
  ok('the dashboard is not', !on('home'));
  ok('the toast says the session ended', text('toast').indexOf('Session ended') > -1, text('toast'));
  ok('a notice explains the sign-out', shown('loginNotice'));
  ok('it says the session was reached, not that anything went wrong',
     text('loginNotice').indexOf('session time was reached') > -1, text('loginNotice'));
  ok('and that submitted work is safe against the Scholar ID',
     text('loginNotice').indexOf('Scholar ID') > -1, text('loginNotice'));
  ok('nothing about an unsubmitted paper, because none was open',
     text('loginNotice').indexOf('not submitted') < 0, text('loginNotice'));
  var afterOut = await api('sessionInfo')();
  ok('the driver agrees there is no session left', afterOut.active === false, JSON.stringify(afterOut));

  head('9 — logging back in clears the notice');
  await api('login')(SID, SPW);
  run('go')('login-v2');
  ok('the explanation is not still sitting there on the next visit', !shown('loginNotice'));
  head('9 — a paper still open when the clock runs out is reported, not lost quietly');
  run('ssStart')();
  await flush();
  run('wtPaper = { attemptId: "unsent-paper" }');
  leaveSeconds(-2);
  run('ssTick')();
  await flush();
  ok('the notice still confirms what was submitted is safe',
     text('loginNotice').indexOf('Scholar ID') > -1, text('loginNotice'));
  ok('and says plainly that the open paper was not recorded',
     text('loginNotice').indexOf('was not submitted') > -1, text('loginNotice'));
  ok('so the student knows to sit it again',
     text('loginNotice').indexOf('sit it again') > -1, text('loginNotice'));

  head('9 — a dropped connection is not a logout');
  await api('login')(SID, SPW);
  run('ssStart')();
  await flush();
  var expiryBefore = run('ss').expiresAt;
  run('GOC.api.__si = GOC.api.sessionInfo;' +
      'GOC.api.sessionInfo = function(){ return Promise.reject(new Error("offline")); };');
  run('ssPoll')();
  await flush();
  ok('the failure is counted', run('ss').netFail === 1, run('ss').netFail);
  ok('but the student stays signed in', run('ss').on === true);
  ok('and the countdown keeps running from the last expiry the server gave',
     run('ss').expiresAt === expiryBefore, run('ss').expiresAt + ' vs ' + expiryBefore);
  run('ssPoll')();
  await flush();
  ok('a second failure still does not sign anyone out',
     run('ss').netFail === 2 && run('ss').on === true, run('ss').netFail);
  run('GOC.api.sessionInfo = GOC.api.__si; delete GOC.api.__si;');
  run('ssPoll')();
  await flush();
  ok('and when the connection returns the counter is forgiven', run('ss').netFail === 0, run('ss').netFail);
  head('9 — an expired tab cannot be clicked back into the dashboard');
  leaveSeconds(-2);
  run('go')('home');
  await flush();
  ok('asking for the dashboard ends the session instead', run('ss').on === false, run('ss').on);
  ok('the dashboard is not shown even as an empty shell', !on('home'));
  ok('the login screen is', on('login-v2'));
  ok('and the student is told why', shown('loginNotice'));
  ['study', 'league', 'profile', 'webtest'].forEach(function (s) {
    ok('#' + s + ' is not reachable either', !on(s));
  });

  head('9 — the public screens stay open to an expired student');
  run('go')('updates');
  ok('Update & News still opens', on('updates'));
  run('go')('signup');
  ok('so does Create Account', on('signup'));
  run('go')('login-v2');
  ok('and the login screen itself', on('login-v2'));

  head('9 — the guard never fires before anyone has logged in');
  run('ssStop')();
  ok('a fresh page has no watcher running', run('ss').on === false);
  ok('and nothing is treated as expired', run('ssExpired')() === false, run('ssExpired')());
  run('go')('landing');
  ok('the landing screen opens normally', on('landing'));

  head('9 — staff keep their own session and never see the student bar');
  await api('login')(FOUNDER, FPW);
  run('role = "admin"');
  run('ssStart')();
  await flush();
  ok('no student watcher is started for staff', run('ss').on === false, run('ss').on);
  ok('and no warning bar is shown to them', !shown('ssBar'));
  var staffSess = await api('sessionInfo')();
  ok('a staff session is longer than a student one', staffSess.expiresInSec > 7200, staffSess.expiresInSec);
  run('role = "student"');
  head('9 — the policy is readable, the secrets are not');
  var cfg = await api('getSettings')();
  ok('the app can read the session length it must display', cfg.sessionMinutes === 120, cfg.sessionMinutes);
  ok('and the warning lead time', cfg.sessionWarnMinutes === 5, cfg.sessionWarnMinutes);
  ok('the daily study window is untouched by all of this', cfg.dailyLimitMin > 0, cfg.dailyLimitMin);
  ok('no passcode is handed out with the settings',
     JSON.stringify(cfg).indexOf('2027') < 0, JSON.stringify(cfg));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}
main();
