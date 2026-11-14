/* test-public-preview-shell.js — the anonymous Try GOC journey runs in the
   public shell, never the authenticated student shell.

   Loads the real page and the real js/app.js into minidom, then walks the same
   functions the homepage button calls: demoOpen() -> cbtOpenDemo() ->
   demoResult(). It also proves the authenticated dashboard is restored
   afterwards, so the two experiences stay separate.

   Run:  node test/test-public-preview-shell.js  */
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
  navigator: { userAgent: 'node' }, innerWidth: 430, innerHeight: 924,
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
  vm.runInContext(read(f), ctx, { filename: f });
});
function run(expr) { return vm.runInContext(expr, ctx); }
function id(x) { return doc.getElementById(x); }
function shown(x) { var e = id(x); return !!e && e.classList.contains('active'); }
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }
function text(x) { var e = id(x); return e ? e.textContent : ''; }
function style(x, p) { var e = id(x); return e && e.style ? e.style[p] : ''; }
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var QUESTIONS = [1, 2, 3, 4, 5].map(function (n) {
  return { id: 'demo-' + n, n: n, subject: n % 2 ? 'Use of English' : 'Physics',
    topic: 'Preview topic ' + n, text: 'Preview question ' + n, options: ['A', 'B', 'C', 'D'] };
});
var RIGHT = [0, 1, 2, 3, 0];

head('the homepage entry opens the public preview, not the dashboard');
ok('the Try GOC section carries the live button',
  /id="lpTry"[\s\S]*?onclick="demoOpen\(\)"[\s\S]*?Try a free practice session/.test(read('index.html')));
run('demoOpen()');
ok('the preview screen is active', shown('demo'));
ok('the student dashboard is not active', !shown('home') && !shown('study') && !shown('profile'));
ok('the phone is in its public, full-bleed layout', id('phone').classList.contains('is-login'));
ok('the authenticated tab bar/sidebar is not displayed', style('tabbar', 'display') === 'none', style('tabbar', 'display'));
ok('the preview header names the public experience and offers Home',
  /Try G\.O\.C — Free Practice Preview/.test(markup('demo')) && /Back to homepage/.test(markup('demo')));

head('session state cannot turn the preview into a student shell');
run('ss.on = true; ss.expiresAt = Date.now() - 1000; demoOpen();');
ok('an expired student session still opens the anonymous preview', shown('demo')
  && id('phone').classList.contains('is-login') && style('tabbar', 'display') === 'none');
ok('an expired session is not redirected to the dashboard', !shown('home') && !shown('login-v2'));
run('ss.on = true; ss.expiresAt = Date.now() + 60000; demoOpen();');
ok('a valid student session also opens the anonymous preview', shown('demo')
  && id('phone').classList.contains('is-login') && style('tabbar', 'display') === 'none');
ok('a valid session does not leak the dashboard on the preview', !shown('home') && !shown('study'));
run('ss.on = false; ss.expiresAt = 0;');

head('the shared CBT runner keeps the public shell and real controls');
run('cbtOpenDemo(' + JSON.stringify({ token: 'token-1', questions: QUESTIONS, durationSec: 600 }) + ')');
ok('the CBT runner is active', shown('cbt'));
ok('the public shell survives the run', id('phone').classList.contains('is-login') && style('tabbar', 'display') === 'none');
ok('the title says this is the free preview', /Free practice/.test(text('cbtTitle')), text('cbtTitle'));
ok('the designated five questions are loaded', run('cbtN') === 5 && markup('cbtOpts').length > 0);
ok('the timer starts at ten minutes', text('cbtTime') === '10:00', text('cbtTime'));
run('cbtAns[0] = 1; renderCBTQ();');
ok('an answer can be selected', run('cbtAns[0]') === 1 && /sel|picked|on/.test(markup('cbtOpts')));
run('cbtCur = 2; renderCBTQ(); buildCBTNav();');
ok('navigation moves to another question', /Preview question 3/.test(markup('cbtQ')), markup('cbtQ').slice(0, 80));

head('the result keeps the public shell and offers full access');
var review = QUESTIONS.map(function (q, i) {
  return { n: i + 1, subject: q.subject, topic: q.topic, text: q.text, options: q.options,
    answer: RIGHT[i], given: i === 0 ? 1 : null, isCorrect: false,
    explanation: 'Preview explanation ' + (i + 1) };
});
run('demoResult(' + JSON.stringify({ score: 0, total: 5, percent: 0, review: review }) + ', 120)');
ok('the shared result screen is active', shown('studyRes'));
ok('the public shell survives the result', id('phone').classList.contains('is-login') && style('tabbar', 'display') === 'none');
ok('the signup guidance is visible', id('srDemoCta') && id('srDemoCta').hidden === false);
ok('the result says the preview was not recorded', /free preview/.test(text('srSub')) && /never recorded/i.test(text('srStats')),
  text('srSub'));

head('leaving the preview restores the authenticated shell');
run('srDone()');
ok('Done returns to the public homepage', shown('landing') && id('phone').classList.contains('is-login'));
run('go("home")');
ok('a real hub screen restores the student shell', !id('phone').classList.contains('is-login')
  && style('tabbar', 'display') === 'flex', style('tabbar', 'display'));
ok('the dashboard content itself is still present and active', shown('home') && !!id('dashHello'));
ok('the session guard still protects authenticated screens after the preview',
  /if\(openScreens\.indexOf\(id\) < 0 && !demoSurface && ssExpired\(\)\)/.test(read('js/app.js')));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
