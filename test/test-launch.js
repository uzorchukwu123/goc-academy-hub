/* test-launch.js — the things that must be true of the shipped page itself,
   regardless of which driver is running behind it. These are not feature tests:
   they are the checks that a convenience left in during development has not
   travelled to launch with the build. Each one has cost somebody, somewhere, a
   real incident.  Run:  node test/test-launch.js  */
'use strict';
var fs = require('fs');
var path = require('path');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html');
var appSrc = read('js/app.js');
var apiSrc = read('js/api.js');
var srvSrc = read('server/server.js');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ------------------------------------------------ nothing pre-filled ------- */
head('the login screen arrives empty');
var idField = (html.match(/<input[^>]*id="loginId"[^>]*>/) || [''])[0];
var pwField = (html.match(/<input[^>]*id="loginPw"[^>]*>/) || [''])[0];
ok('the Scholar ID field exists', idField.length > 0);
ok('the password field exists', pwField.length > 0);
ok('the Scholar ID field is not pre-filled',
   !/value="[^"]+"/.test(idField), idField);
ok('the password field is not pre-filled',
   !/value="[^"]+"/.test(pwField), pwField);
ok('the ID field still shows the format as a placeholder, so the student knows the shape',
   /placeholder="GOC-S-/.test(idField));

/* ------------------------------------------------ no credentials on show --- */
head('no credential is printed anywhere on the page');
/* The passwords the demo roster is seeded with. If any of them is written into
   the page, anyone who opens the app can sign in as the Founder. */
['amara2027!', 'founder2027', 'acaddir2027', 'bola2027!', 'chidi2027!']
  .forEach(function (pw) {
    ok('the page does not contain ' + pw, html.indexOf(pw) < 0);
  });
ok('the login hint no longer lists demo accounts',
   !/<b>Demo:<\/b>/.test(html));
ok('the console passcode is not printed on the gate',
   !/passcode[^<]{0,20}<b>\s*\d/i.test(html), (html.match(/.{0,40}passcode.{0,40}/i) || [''])[0]);
ok('the gate still says what the gate is for',
   /gate-hint/.test(html) && /single-device/.test(html));

/* There is no demo student roster any more — this is a live deployment, not
   a prototype. Neither driver should hard-code a named demo student or its
   password anywhere. */
ok('no demo student roster is hard-coded in the demo driver',
   !/amara2027|bello#88|nwosu2026/.test(apiSrc));
ok('no demo password is hard-coded in the app layer',
   !/amara2027|founder2027|acaddir2027/.test(appSrc));
ok('the two console passwords can be set from the environment before first run',
   /GOC_FOUNDER_PW/.test(srvSrc) && /GOC_ACADDIR_PW/.test(srvSrc));
ok('and seeding with the published default warns out loud',
   /seeding management with a published demo password/.test(srvSrc));
ok('the console passcode is overridable too',
   /GOC_PASSCODE/.test(srvSrc));

/* ------------------------------------------------ the examination gate ----- */
head('an account cannot be written without an examination');
ok('the server requires the examination rather than merely validating it',
   /core\.requireExam\(body\.goal\)/.test(srvSrc));
ok('the demo driver requires it too, so both drivers agree',
   /core\.requireExam\(/.test(apiSrc));
ok('neither data layer still uses the lenient form on a request',
   !/validateExam\(body\.goal\)/.test(srvSrc) &&
   !/validateExam\(data && data\.goal\)/.test(apiSrc));
ok('the sign-up screen keeps the lenient form, so a half-filled form is not scolded',
   /validateExam\(sel\.value\)/.test(appSrc));

/* ------------------------------------------------ open sign-up -------------- */
/* Phase 3B slice 5: the academy access code is gone. Anyone may register (as Open); what stops
   one person minting accounts is a per-address limit on successful sign-ups. */
head('sign-up is open, and slowed per address instead of gated by a code');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var DEFCODE = 'GOC2027';
function leaks(src) { return src.indexOf(DEFCODE) > -1; }
var srvPost = srvSrc.slice(srvSrc.indexOf('POST\', path: /^\\/api\\/students$/'));
srvPost = srvPost.slice(0, srvPost.indexOf('okJson'));
var apiPost = apiSrc.slice(apiSrc.indexOf('createStudent: function (data)'));
apiPost = apiPost.slice(0, 900);

ok('the sign-up form has no access-code field', html.indexOf('id="signCode"') < 0 && html.indexOf('signup-gate') < 0);
ok('the tagline no longer tells people to have a code ready', !/access code/i.test(html.slice(html.indexOf('id="signup"'), html.indexOf('id="home"'))));
ok('the screen no longer checks or sends a code', appSrc.indexOf('validateSignupCode') < 0 && !/signupCode/.test(appSrc.slice(appSrc.indexOf('function signupSubmit'), appSrc.indexOf('SUBJECT PERSONALIZATION'))));
ok('the server no longer checks a code', !/validateSignupCode|signupCodeMatches|signupCodeStored|signupCodeHash/.test(srvSrc));
ok('the demo driver no longer checks a code', !/validateSignupCode|SIGNUP_CODE\b/.test(apiPost) && apiSrc.indexOf('setSignupCode') < 0);
ok('the old code route is gone, the limits route is at the console tier',
   srvSrc.indexOf('signup-code') < 0 && /path: \/\^\\\/api\\\/settings\\\/signup-limits\$\/, need: 'console'/.test(srvSrc));
ok('the demo driver agrees on that tier', /setSignupLimits: function \(body\) \{\s*var e = requireUnlocked\(\);/.test(apiSrc));
ok('the console screen draws the limits control before the Founder-only cut-off, so the Director sees it',
   appSrc.indexOf('admSignupLimitsHTML(d)') < appSrc.indexOf('if(!d.isFounder){') && appSrc.indexOf('admSlSave') > 0);
ok('the server checks the per-address limit before any other work, and records only successful sign-ups',
   srvPost.indexOf('signupBlocked(ip, lim)') > -1 && srvPost.indexOf('signupBlocked') < srvPost.indexOf('clean(body.name') &&
   srvPost.indexOf('noteSignup(ip)') > srvPost.indexOf('writeData(db)'));
ok('a refusal carries Retry-After', /setHeader\('Retry-After'/.test(srvPost));
ok('every self-made account is stored as Open', /tier: 'open'/.test(srvPost));
ok('the published code appears nowhere on the page or in the app layer', !leaks(html) && !leaks(appSrc));
ok('the neither GOC_SIGNUP_CODE nor the code is needed to seed a fresh install', !/GOC_SIGNUP_CODE/.test(srvSrc));

/* ------------------------------------------------ the standing rules ------- */
head('the constraints the whole build is written under');
/* Two confirmed, deliberate storage exceptions:
   - js/api.js mirrors a student's session token into sessionStorage (never
     localStorage) so a refresh doesn't log them out — see Task 6.
   - js/app.js keeps a per-scholar practice/CBT review history in localStorage
     so a student can reopen an unassessed run after logging out and coming
     back (these runs are never filed on the server). Keyed by Scholar ID.
   localStorage stays banned in api.js/core/pwa; sessionStorage stays banned in
   every file but api.js. */
['js/app.js', 'js/api.js', 'js/goc-core.js', 'js/pwa.js'].forEach(function (f) {
  var src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  var localStorageAllowed = (f === 'js/app.js');
  ok(f + ' uses ' + (localStorageAllowed ? 'localStorage only for the per-scholar practice review history' : 'no localStorage'),
     localStorageAllowed ? /localStorage/.test(src) : !/localStorage/.test(src));
  var sessionStorageAllowed = (f === 'js/api.js');
  ok(f + ' uses ' + (sessionStorageAllowed ? 'sessionStorage only for the student refresh-token mirror' : 'no sessionStorage'),
     sessionStorageAllowed ? /sessionStorage/.test(src) : !/sessionStorage/.test(src));
});
/* This checks resources the page itself fetches (script/link/img/iframe) —
   not outbound navigation links. An <a href="https://wa.me/..."> WhatsApp
   contact button, for example, loads nothing; the browser only follows it
   when the visitor clicks it, same as any mailto:/tel: link already on the
   page. Matching bare href="https://..." would flag that legitimate link
   too, so the check is scoped to tags that actually load content. */
ok('index.html loads no script/style/image/frame from another origin',
   (html.match(/<(script|link|img|iframe)\b[^>]*\s(src|href)="https?:\/\/[^"]+"/g) || []).length === 0,
   (html.match(/<(script|link|img|iframe)\b[^>]*\s(src|href)="https?:\/\/[^"]+"/g) || []).join(' '));
ok('the logo symbol is still defined once and referenced, not redrawn',
   (html.match(/<symbol[^>]*id="goc-mark"/g) || []).length === 1);

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
