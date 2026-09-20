/* test-p1.js — Priority 1: premium motion.
   Animation is the one area where a mistake makes content unreadable rather
   than merely ugly, so this suite is mostly about the failure modes: what
   happens with no IntersectionObserver, with reduced motion asked for, and
   when a reveal never fires. It also holds the rules the effects were written
   under — transform and opacity only, and the logo never animated.
   Run:  node test/test-p1.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var css = read('css/styles.css');
var appSrc = read('js/app.js');

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

/* A stand-in observer: records what was observed, and fires only when the test
   says so, which is the whole point — a real one fires on real scrolling. */
var observed = [], unobserved = [], fire = null;
function FakeIO(cb, opts) {
  this.cb = cb; this.opts = opts;
  fire = function (els) {
    cb(els.map(function (e) { return { isIntersecting: true, target: e }; }));
  };
}
FakeIO.prototype.observe = function (el) { observed.push(el); };
FakeIO.prototype.unobserve = function (el) { unobserved.push(el); };

var reducedMotion = false;
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function (q) {
    return { matches: /reduce/.test(q) ? reducedMotion : false, addListener: function () {} };
  },
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
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function run(expr) { return vm.runInContext(expr, ctx); }
function rootClasses() { return doc.documentElement.className || ''; }
function hasAnimOn() { return rootClasses().indexOf('anim-on') > -1; }

/* The Priority 1 stylesheet block, isolated so the assertions below cannot
   accidentally pass on some unrelated rule elsewhere in the file. */
var block = (css.match(/PRIORITY 1 — PREMIUM MOTION[\s\S]*$/) || [''])[0];
/* Two derived views of that block. `bare` has the comments removed, because the
   header comment names the logo selectors in order to say they are absent — a
   search for them must not find the sentence promising they are not there.
   `rules` also has the @keyframes removed: a keyframe's from{opacity:0} is
   where an animation starts, not a rule that hides standing content. */
var bare = block.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '');
var rules = bare.replace(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g, '');

/* --------------------------------------------------------- the CSS rules ---- */
head('the rules the effects were written under');
ok('the Priority 1 block exists in the stylesheet', block.length > 400);

/* Rule 1: transform and opacity only. Anything else costs a layout pass and
   can shove text that is already on screen. */
var newKeyframes = block.match(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g) || [];
ok('the new keyframes are declared', newKeyframes.length >= 4, String(newKeyframes.length));
var animatedProps = [];
newKeyframes.join('\n').replace(/\{([^{}]*)\}/g, function (m, decls) {
  decls.split(';').forEach(function (d) {
    var p = d.split(':')[0].trim();
    if (p && animatedProps.indexOf(p) < 0) animatedProps.push(p);
  });
  return m;
});
ok('every animated property is transform or opacity — nothing that reflows',
   animatedProps.every(function (p) { return p === 'transform' || p === 'opacity'; }),
   animatedProps.join(', '));
['width', 'height', 'margin', 'padding', 'top', 'left', 'letter-spacing', 'font-size']
  .forEach(function (p) {
    ok('no keyframe animates ' + p,
       newKeyframes.join('\n').indexOf(p + ':') < 0);
  });

/* Rule 4: the student's own accessibility setting wins. */
var motionGuards = block.match(/@media \(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g) || [];
var guarded = motionGuards.join('\n');
ok('the effects sit inside a prefers-reduced-motion guard', motionGuards.length > 0 && guarded.length > 300);
ok('every animation: declaration is inside that guard',
   (block.match(/animation:/g) || []).length === (guarded.match(/animation:/g) || []).length,
   (block.match(/animation:/g) || []).length + ' total vs ' + (guarded.match(/animation:/g) || []).length + ' guarded');

/* Rule 2: nothing may be hidden unless the code that reveals it is running. */
var hiders = rules.match(/^[^\n{]*\{[^}]*opacity:0[^}]*\}/gm) || [];
ok('something is hidden ready to be revealed', hiders.length > 0);
ok('every rule that hides content is gated behind html.anim-on',
   hiders.every(function (r) { return r.indexOf('html.anim-on') > -1; }),
   hiders.filter(function (r) { return r.indexOf('html.anim-on') < 0; }).join(' | '));

/* Rule: the logo is never animated. Only the wordmark text beside it moves. */
ok('the wordmark span is what animates', /\.lp-brand \.bt\{animation:/.test(block.replace(/\s+/g, ' ').replace(/ \{/g, '{')) ||
   /\.bt\{animation:markIn/.test(block.replace(/\s+/g, '')));
ok('the logo tile .bm is never an animation target',
   !/\.bm[^\{]*\{[^}]*animation\s*:/.test(bare));
ok('.lp-brand is never itself an animation target',
   !/\.lp-brand\s*\{[^}]*animation/.test(bare));
ok('the mark symbol is never referenced', bare.indexOf('goc-mark') < 0);

/* ------------------------------------------------- refusing to animate ----- */
head('when motion is not wanted, nothing is hidden');

delete sandbox.IntersectionObserver;
reducedMotion = false;
ok('with no IntersectionObserver the page does not opt in', run('animWanted()') === false);
run('animInit()');
ok('and html.anim-on is never added, so nothing is hidden', !hasAnimOn());

sandbox.IntersectionObserver = FakeIO;
reducedMotion = true;
ok('with reduced motion asked for, the page does not opt in', run('animWanted()') === false);
run('animInit()');
ok('again nothing is hidden', !hasAnimOn());
ok('and no section was observed', observed.length === 0);

/* animSweep must be harmless when the machinery was never switched on. */
var threw = null;
try { run('animSweep()'); } catch (e) { threw = e.message; }
ok('sweeping before anything is switched on does nothing and does not throw',
   threw === null && !hasAnimOn(), threw);

/* ------------------------------------------------------ revealing on scroll - */
head('revealing sections as they are reached');
reducedMotion = false;
ok('with both a capable browser and no objection, the page opts in',
   run('animWanted()') === true);
run('animInit()');
ok('html.anim-on is added, which is what arms the reveal', hasAnimOn());
ok('the feature grid is watched', observed.length >= 1);
ok('the observer was given a threshold, not left on the default',
   run('animObserver.opts && animObserver.opts.threshold > 0'));

/* minidom reports no geometry, so the sweep treats every section as reached —
   which is exactly the behaviour wanted when geometry is unavailable: reveal,
   never hide. */
var grid = doc.querySelector('#lpFeatures .lp-grid');
ok('the feature grid exists to be revealed', !!grid);
ok('a section is revealed rather than left hidden when geometry is unknown',
   grid.classList.contains('rv'));

/* And when the observer does fire, the reveal happens and is not repeated. */
var subj = doc.querySelector('#lpSubjects .lp-subj');
if (subj) subj.classList.toggle('rv', false);
unobserved.length = 0;
sandbox.__subj = subj;
run('animObserver.cb([{ isIntersecting: true, target: __subj }])');
ok('an intersecting section is revealed', subj.classList.contains('rv'));
ok('and is then left alone — a reveal happens once', unobserved.indexOf(subj) > -1);

run('animInit()');
ok('initialising twice does not re-arm anything', hasAnimOn());
ok('html.anim-on appears only once on the element',
   (rootClasses().match(/anim-on/g) || []).length === 1, rootClasses());

/* ------------------------------------------- the hand-off into the app ----- */
head('Priorities 1.2 and 1.3 — the hand-off into the app');
ok('the richer entrance is armed in the login\'s resolved branch only',
   /GOC\.api\.login\(raw, pw\)[\s\S]{0,400}?animEnter\(\)/.test(appSrc));
ok('it is not armed in the login\'s failure branch',
   !/catch\(function\(err\)\{[\s\S]{0,200}?animEnter\(\)/.test(appSrc));
ok('it is armed in the sign-up\'s resolved branch',
   /createStudent\([\s\S]{0,300}?\.then\(function\(r2\)\{[\s\S]{0,400}?animEnter\('id'\)/.test(appSrc));
ok('nothing in the hand-off puts a timer between the student and the app',
   !/animEnter[\s\S]{0,80}setTimeout/.test(appSrc));

run('go("landing")');
var home = doc.getElementById('home');
run('animEnter(); go("home");');
ok('the screen arrived at is marked for the richer entrance',
   home.classList.contains('enter-rich'));
run('go("timetable"); go("home");');
ok('an ordinary tab change afterwards does not repeat it',
   !home.classList.contains('enter-rich'));
run('go("home");');
ok('and it stays off until it is armed again', !home.classList.contains('enter-rich'));
ok('arming it twice still only decorates one arrival', (function () {
  run('animEnter(); go("home"); go("timetable");');
  return !home.classList.contains('enter-rich') &&
         !doc.getElementById('timetable').classList.contains('enter-rich');
})());

/* -------------------------------------------- 1.1 the connecting threads --- */
head('1.1: the three parts are visibly connected');
var feats = doc.querySelectorAll('#lpFeatures .lp-grid .lp-feat');
var threads = doc.querySelectorAll('#lpFeatures .lp-thread');
ok('there are still exactly three cards', feats.length === 3, String(feats.length));
ok('two of them carry a thread — the gaps between three cards',
   threads.length === 2, String(threads.length));
ok('the last card does not, so no thread points at nothing',
   feats.length === 3 && feats[2].querySelectorAll('.lp-thread').length === 0);
ok('each thread is hidden from screen readers, being decoration',
   threads.length === 2 && threads[0].getAttribute('aria-hidden') === 'true' &&
                           threads[1].getAttribute('aria-hidden') === 'true');
ok('the connector is an inline svg path, not an image or a canvas',
   threads.length === 2 && threads[0].querySelectorAll('svg path').length === 2);
ok('one path per orientation: a vertical one for the stack, a horizontal one for the row',
   threads.length === 2 && threads[0].querySelectorAll('.lt-v').length === 1 &&
                           threads[0].querySelectorAll('.lt-h').length === 1);
ok('the stroke does not thicken when the box is stretched',
   /vector-effect="non-scaling-stroke"/.test(read('index.html')));
ok('each thread carries a particle to send along it',
   threads.length === 2 && threads[0].querySelectorAll('.lt-dot').length === 1);

head('1.1: it is a still diagram when nothing animates');
ok('the thread box is positioned outside the motion block, so it exists without scripts',
   /#lpFeatures \.lp-thread\{position:absolute/.test(css.replace(/PRIORITY 1 — PREMIUM MOTION[\s\S]*$/, '')));
ok('the path is visible by default rather than revealed',
   /#lpFeatures \.lp-thread \.lt-svg\{[^}]*opacity:\.\d/.test(css));
ok('the card is the positioning parent, so no geometry is measured in JS',
   /#lpFeatures \.lp-grid \.lp-feat\{position:relative\}/.test(css));
ok('the thread is out of flow, so drawing it cannot reflow the row',
   !/#lpFeatures \.lp-thread\{[^}]*position:(static|relative)/.test(css));
ok('the row orientation is a media query, not a second element',
   /#landing #lpFeatures \.lp-thread\{left:100%/.test(css));

head('1.1: the motion obeys the section rules');
ok('the thread is scaled along its own axis, never drawn with stroke-dashoffset',
   !/stroke-dashoffset/.test(bare));
ok('drawing the thread is gated on html.anim-on like everything else',
   /html\.anim-on #lpFeatures \.lp-grid\.rv \.lp-thread\{animation:threadDraw/.test(rules));
ok('the particle loops rather than firing once, which is what "continuous flow" means',
   /\.lt-dot\{animation:dotFlow [^}]*infinite\}/.test(rules));
ok('both draw keyframes animate transform only',
   /@keyframes threadDraw\{from\{transform:scaleY\(0\)\}to\{transform:scaleY\(1\)\}\}/.test(css) &&
   /@keyframes threadDrawH\{from\{transform:scaleX\(0\)\}to\{transform:scaleX\(1\)\}\}/.test(css));
ok('both flow keyframes animate transform and opacity only',
   ['dotFlow', 'dotFlowH'].every(function (n) {
     var kf = (css.match(new RegExp('@keyframes ' + n + '\\{[^@]*?\\}\\s*\\}')) || [''])[0];
     return kf && !/(width|height|margin|padding|top|left|right|bottom|font-size|letter-spacing)\s*:/.test(kf);
   }));
ok('the thread waits for the card it leaves to land, rather than racing it',
   /\.lp-thread\{animation:threadDraw [^}]*\s\.\d+s both\}/.test(rules));

/* -------------------------------------------- 1.2 / 1.3 the sequences ------ */
head('1.2 / 1.3: the arrival is staged, and still nothing waits on it');
ok('the blocks of the incoming screen arrive in reading order',
   [2, 3, 4].every(function (n) {
     return new RegExp('\\.enter-rich>\\*:nth-child\\(' + n + '\\)\\{animation-delay:').test(rules);
   }));
ok('a long screen has no slow bottom — everything past the fourth block shares one delay',
   /\.enter-rich>\*:nth-child\(n\+5\)\{animation-delay:/.test(rules));
ok('the whole cascade is under half a second, so it reads as one arrival',
   (function () {
     var ds = (rules.match(/\.enter-rich>\*[^{]*\{animation-delay:([\d.]+)s\}/g) || [])
       .map(function (s) { return parseFloat(s.match(/([\d.]+)s/)[1]); });
     return ds.length > 0 && Math.max.apply(null, ds) <= 0.5;
   })());
ok('1.3 reveals the Scholar ID last, and only on the sign-up arrival',
   /\.enter-rich\.enter-id #idStrip\{animation:idLand/.test(rules));
ok('that reveal is transform and opacity only',
   /@keyframes idLand\{from\{opacity:0;transform:scale\([\d.]+\)\}to\{opacity:1;transform:none\}\}/.test(css));
ok('sign-up asks for the ID variant of the hand-off',
   /animEnter\('id'\)/.test(appSrc));
ok('and login asks for the plain one, so an ordinary login does not re-announce the ID',
   /animEnter\(\);/.test(appSrc) && !/animEnter\('id'\)[\s\S]*function login/.test(appSrc));
ok('signupSubmit still creates the account before it navigates',
   appSrc.indexOf('GOC.api.createStudent(') < appSrc.indexOf("animEnter('id')"));
ok('applyIdentity still runs before the dashboard is shown',
   (function () {
     var b = appSrc.slice(appSrc.indexOf("animEnter('id')"));
     return b.indexOf('applyIdentity(r2.session)') > -1 &&
            b.indexOf('applyIdentity(r2.session)') < b.indexOf("go('home')");
   })());
ok('go() clears enter-id as well as enter-rich, so the reveal cannot repeat',
   /classList\.remove\('enter-id'\)/.test(appSrc));
ok('no credential is ever written into a label by the hand-off',
   !/enter-(rich|id)[\s\S]{0,200}(password|token)/i.test(appSrc));

/* The whole point of not delaying navigation: a successful login must land on
   the dashboard, animation or no animation.
   There is no seeded demo roster any more (Priority: "the roll is closed to
   strangers"), so a real student is registered through the same public
   sign-up path a scholar would use, and the driver hands back the Scholar ID
   it actually assigned — nothing here is hard-coded. */
run('role = null;');
var LOGIN_PW = 'amara2027!';
var LOGIN_SID;
run('GOC.api.createStudent')({
  signupCode: 'GOC-2027', name: 'Amara Obi', password: LOGIN_PW,
  goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics']
}).then(function (r) {
  LOGIN_SID = r.student.id;
  return run('GOC.api.login')(LOGIN_SID, LOGIN_PW);
}).then(function () {
  run('login = login;');
  var pw = doc.getElementById('loginPw'), idf = doc.getElementById('loginId');
  idf.value = LOGIN_SID; pw.value = LOGIN_PW;
  return run('login()');
}).then(function () {
  ok('a real login still lands on the dashboard', doc.getElementById('home').classList.contains('active'));
  ok('and that arrival is the one decorated',
     doc.getElementById('home').classList.contains('enter-rich'));
  ok('a login is not given the Scholar ID reveal — that belongs to sign-up',
     !doc.getElementById('home').classList.contains('enter-id'));

  head('a refused login animates nothing');
  doc.getElementById('loginPw').value = 'wrong-on-purpose';
  doc.getElementById('loginId').value = LOGIN_SID;
  run('go("login-v2");');
  return run('login()');
}).then(function () {
  ok('the login screen is still the one on show',
     doc.getElementById('login-v2').classList.contains('active'));
  ok('no screen was decorated for an arrival that did not happen',
     doc.querySelectorAll('.enter-rich').length === 0);

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}, function (e) {
  console.log('  FAIL  the login flow rejected outward: ' + e.message);
  console.log('\n' + passes + ' passed, ' + (fails + 1) + ' failed');
  process.exit(1);
});
