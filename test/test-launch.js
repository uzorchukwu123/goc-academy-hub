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

/* ------------------------------------------------ the sign-up firewall ----- */
head('the roll is closed to strangers');
var core = require(path.join(APP, 'js', 'goc-core.js'));
/* Both ways of writing the shipped code: as the rulebook spells it, and as it
   reads once the separators come out. A screen that leaked either has leaked it. */
var DEFCODE = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var DEFCODES = [String(core.SIGNUP_CODE_DEFAULT), DEFCODE];
function leaks(src) {
  for (var i = 0; i < DEFCODES.length; i++) if (src.indexOf(DEFCODES[i]) > -1) return DEFCODES[i];
  return '';
}
var codeField = (html.match(/<input[^>]*id="signCode"[^>]*>/) || [''])[0];

ok('the sign-up form asks for the academy access code', codeField.length > 0);
ok('the access code field is not pre-filled', !/value="[^"]+"/.test(codeField), codeField);
/* The whole point of the firewall is defeated if the page that it guards prints
   the code on itself — which an earlier draft of this screen did, in a
   placeholder, on the reasoning that it showed the candidate the shape. */
ok('the access code field does not give the code away in its placeholder',
   !leaks(codeField), codeField);
ok('the shipped access code appears nowhere on the page, in either form',
   !leaks(html), leaks(html));
ok('nor anywhere in the app layer', !leaks(appSrc), leaks(appSrc));
ok('it lives in the rulebook, which is the one place it belongs',
   read('js/goc-core.js').indexOf(String(core.SIGNUP_CODE_DEFAULT)) > -1);
ok('the code is the first thing the form asks for, before any personal detail',
   html.indexOf('id="signCode"') < html.indexOf('id="signName"'));

ok('the screen checks the code before it submits anything',
   appSrc.indexOf('validateSignupCode(code)') > -1 &&
   appSrc.indexOf('validateSignupCode(code)') < appSrc.indexOf('GOC.api.createStudent('));
ok('and the code travels with the registration',
   /createStudent\(\{signupCode:code/.test(appSrc));

/* Both data layers must decide this, and decide it first: a stranger who does
   not hold the code should be turned away before the academy's other rules —
   which examinations it prepares for, how many subjects, what they may be —
   are explained to them by a sequence of error messages. */
var srvPost = srvSrc.slice(srvSrc.indexOf('POST\', path: /^\\/api\\/students$/'));
srvPost = srvPost.slice(0, srvPost.indexOf('okJson'));
ok('the server refuses a registration without the code',
   srvPost.indexOf('core.validateSignupCode(body.signupCode)') > -1);
ok('and it asks for the code before it reads the name or the examination',
   srvPost.indexOf('validateSignupCode') < srvPost.indexOf('clean(body.name') &&
   srvPost.indexOf('validateSignupCode') < srvPost.indexOf('requireExam'));
ok('the server compares the code against a hash, never a stored code',
   /signupCodeMatches\(db, body\.signupCode\)/.test(srvPost) &&
   /verifyPassword\(core\.normalizeSignupCode\(raw\), stored\)/.test(srvSrc) &&
   /signupCodeHash = hashPassword\(/.test(srvSrc));
/* The older form is tried only as a fallback, and only against the same hash, so
   an upgraded roster keeps working without a second code ever being stored. */
ok('the older form of the code is a fallback, not a second stored secret',
   /core\.legacySignupCode\(raw\)/.test(srvSrc) &&
   srvSrc.indexOf('legacySignupCode') > srvSrc.indexOf('function signupCodeMatches'),
   String(srvSrc.indexOf('legacySignupCode')));
var apiPost = apiSrc.slice(apiSrc.indexOf('createStudent: function (data)'));
apiPost = apiPost.slice(0, 900);
ok('the demo driver refuses one too, and asks first',
   apiPost.indexOf('core.validateSignupCode(data && data.signupCode)') > -1 &&
   apiPost.indexOf('validateSignupCode') < apiPost.indexOf('core.requireExam('));

/* The academy asked that the Academic Director be able to rotate the code as
   well as the Founder — she is the one who hands it to a new intake — so this
   route sits at the console tier deliberately, and a future tidy-up that
   "corrects" it to the founder tier would quietly take the ability away. */
ok('both console accounts may rotate the code, not the Founder alone',
   /path: \/\^\\\/api\\\/settings\\\/signup-code\$\/, need: 'console'/.test(srvSrc));
ok('the demo driver agrees on that tier',
   /setSignupCode: function \(newCode\) \{\s*var e = requireUnlocked\(\);/.test(apiSrc));
ok('the console screen draws the control before the Founder-only cut-off, so she sees it',
   appSrc.indexOf('admSignupCodeHTML(d)') < appSrc.indexOf('if(!d.isFounder){'));

ok('the code can be set from the environment before the first run',
   /GOC_SIGNUP_CODE/.test(srvSrc));
ok('and seeding the published default warns out loud',
   /published default/.test(srvSrc) || /change it from\s*\n?\s*the console/.test(srvSrc));
/* Length and history are all a client may learn. */
ok('neither data layer ever returns the code itself',
   !/signupCodeHash:\s*db\.settings\.signupCodeHash/.test(srvSrc) &&
   /signupCodeLength: Number\(db\.settings\.signupCodeLength\)/.test(srvSrc) &&
   !/code: SIGNUP_CODE/.test(apiSrc));

/* ------------------------------------------------ the standing rules ------- */
head('the constraints the whole build is written under');
/* js/api.js is the one confirmed exception: a student's session token is
   mirrored into sessionStorage (never localStorage) purely so a refresh
   doesn't log them out — see Task 6. localStorage stays banned everywhere,
   sessionStorage stays banned in every other file. */
['js/app.js', 'js/api.js', 'js/goc-core.js', 'js/pwa.js'].forEach(function (f) {
  var src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok(f + ' uses no localStorage', !/localStorage/.test(src));
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
