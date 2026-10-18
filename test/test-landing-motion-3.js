/* test-landing-motion-3.js — landing motion, part 3: the contact split-screen,
   the footer constellation, the cursor-follow card tilt and the upgraded card
   reveals.
   Same failure modes as test-p1.js and test-landing-motion.js police: content
   hidden when it should not be, motion played to someone who asked for none,
   anything but transform and opacity moving. This part adds NO exception —
   stroke-dashoffset stays confined to the part-2 step icons — and this file
   pins that.
   Run:  node test/test-landing-motion-3.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var css = read('css/styles.css');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ------------------------------------------------------------- the CSS ---- */
var start = css.indexOf('LANDING MOTION, PART 3');
var mid = css.indexOf('LANDING MOTION, PART 2');
var end = css.indexOf('PRIORITY 1 — PREMIUM MOTION');
var block = (start > -1 && mid > start && end > mid) ? css.slice(start, mid) : '';
var bare = block.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '');
var keyframes = bare.match(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g) || [];
var rules = bare.replace(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g, '');
var guardOpen = rules.indexOf('@media (prefers-reduced-motion: no-preference){');
var guarded = guardOpen > -1 ? rules.slice(guardOpen) : '';
var unguarded = guardOpen > -1 ? rules.slice(0, guardOpen) : rules;

head('the rules the effects were written under');
ok('the part-3 block exists, ahead of part 2 and of the Priority 1 section', block.length > 1500);
ok('every animation / will-change / transition is inside the reduced-motion guard',
   !/animation\s*:|animation-name\s*:|will-change\s*:|transition\s*:/.test(unguarded),
   (unguarded.match(/animation\s*:|will-change\s*:|transition\s*:/g) || []).join(','));
ok('the guard is the "no-preference" form, so no motion is the default', guardOpen > -1);

var hiders = (guarded.match(/[^{}]+\{[^{}]*opacity:\s*0[;}][^{}]*\}/g) || []);
ok('something is hidden ready to be revealed', hiders.length > 0);
ok('every rule that hides content is gated behind html.anim-on',
   hiders.every(function (r) { return r.indexOf('html.anim-on') > -1; }),
   hiders.filter(function (r) { return r.indexOf('html.anim-on') < 0; }).join(' | '));
ok('nothing outside the guard hides content (a static page shows everything; the only display:none is the wide/narrow picture swap)',
   !/opacity:\s*0[;}]/.test(unguarded) && !/visibility:\s*hidden/.test(unguarded) &&
   ((unguarded.match(/[^{}]*\{[^{}]*display:\s*none[^{}]*\}/g) || []).every(function (r) { return /\.lp-const\.cn-[nw]\{/.test(r); })));
ok('the logo is never mentioned in this block',
   bare.indexOf('.bm') < 0 && bare.indexOf('.lp-brand') < 0 && bare.indexOf('goc-mark') < 0);

/* No new property may animate. */
var props = {};
keyframes.forEach(function (k) {
  var name = (k.match(/@keyframes\s+(\w+)/) || [])[1];
  k.replace(/\{([^{}]*)\}/g, function (m, decls) {
    decls.split(';').forEach(function (d) {
      var p = d.split(':')[0].trim(); if (!p) return;
      (props[name] = props[name] || []).indexOf(p) < 0 && props[name].push(p);
    });
    return m;
  });
});
var names = Object.keys(props);
ok('there are keyframes to police', names.length >= 8, names.join(','));
ok('every keyframe animates only transform and opacity',
   names.every(function (n) { return props[n].every(function (p) { return p === 'transform' || p === 'opacity'; }); }),
   names.filter(function (n) { return props[n].some(function (p) { return p !== 'transform' && p !== 'opacity'; }); }).join(','));
ok('stroke-dashoffset is not used anywhere in part 3 (the one exception belongs to part 2)',
   bare.indexOf('stroke-dashoffset') < 0 && bare.indexOf('stroke-dasharray') < 0);
ok('nothing in part 3 transitions anything but transform and opacity',
   (guarded.match(/transition\s*:[^;}]*/g) || []).every(function (t) { return /^transition\s*:\s*(transform|opacity)\b/.test(t); }),
   (guarded.match(/transition\s*:[^;}]*/g) || []).join(' | '));
ok('every animation names a keyframe that exists',
   (guarded.match(/animation(?:-name)?\s*:\s*([A-Za-z]\w*)/g) || []).every(function (a) {
     return names.indexOf(a.replace(/animation(?:-name)?\s*:\s*/, '')) > -1;
   }));

head('the contact card works without any motion');
ok('the card is one clipped, rounded box holding both halves',
   /#landing \.lp-contact\{[^}]*border-radius:26px[^}]*overflow:hidden/.test(bare));
ok('the details panel is ink, with the two aurora blobs as its own pseudo-elements',
   /\.lp-cinfo\{[^}]*background:[^}]*var\(--ink\)/.test(bare) && /\.lp-cinfo::before/.test(bare) && /\.lp-cinfo::after/.test(bare));
ok('the blobs sit behind the rows (z-index -1 inside an isolated panel)',
   /\.lp-cinfo\{[^}]*isolation:isolate/.test(bare) && /\.lp-cinfo::before,\.lp-cinfo::after\{[^}]*z-index:-1/.test(bare));
ok('the blobs are soft gradients, not a blur filter (a filter repaints on every frame)',
   !/filter\s*:|backdrop-filter/.test(bare));
ok('the text on the dark panel is light (white values, a light label)',
   /\.lp-cinfo \.lp-crow \.cv\{color:#fff\}/.test(bare) && /\.lp-cinfo \.lp-crow \.cl\{color:#b8c0cd\}/.test(bare));
ok('a focused field has a visible ring even with no motion',
   /\.lp-cform input:focus,\.lp-cform textarea:focus\{box-shadow:/.test(bare));
ok('the send button has a keyboard focus ring', /\.lp-cform button:focus-visible\{outline:/.test(bare));
ok('an idle ripple is a dot of no size, so a stray one can never show',
   /\.cf-rip\{[^}]*transform:translate\(-50%,-50%\) scale\(0\)/.test(bare));
ok('the aurora only loops while its card is on screen (.live), and brightens when a field is focused (.engaged)',
   /\.lp-contact\.live \.lp-cinfo::before\{animation:auroraA/.test(guarded) &&
   /\.lp-contact\.live \.lp-cinfo::after\{animation:auroraB/.test(guarded) &&
   /\.lp-contact\.engaged \.lp-cinfo::before/.test(guarded));
ok('the magnetic pull is transform only, from --mx / --my',
   /\.lp-cform \.cf-in\{transform:translate\(var\(--mx,0px\),var\(--my,0px\)\)/.test(guarded));

head('the footer works without any motion');
ok('the footer keeps its own height (it is a flex item that clips, so it must not shrink)',
   /\.lp-foot\{[^}]*overflow:hidden[^}]*flex-shrink:0/.test(bare));
ok('the columns and text sit above the constellation',
   /\.lp-foot>\.fb,\.lp-foot>\.lp-qcols,\.lp-foot>p\{position:relative;z-index:1\}/.test(bare) && /\.lp-const\{[^}]*z-index:0[^}]*pointer-events:none/.test(bare));
ok('lines keep a 1px stroke however the picture is scaled', /\.lp-const line\{[^}]*vector-effect:non-scaling-stroke/.test(bare));
ok('lines draw by scaling from their first star (transform), gated on the footer being revealed',
   /html\.anim-on \.lp-foot\.rv \.lp-const line\{animation:cnLine/.test(guarded) &&
   /html\.anim-on \.lp-const line\{[^}]*transform:scale\(0\)[^}]*transform-origin:var\(--ox/.test(guarded));
ok('the stars twinkle only while the footer is on screen (.live)',
   /html\.anim-on \.lp-foot\.rv\.live \.lp-const \.st\{[^}]*cnTwinkle/.test(guarded));

head('the ecosystem cards: dealt in, then tilted');
ok('the rest pose lives in --rot and --lift, and the tilt in --tx and --ty, composed in one transform',
   /\.lp-feat\{--rot:-1\.6deg;--lift:0px;--tx:0deg;--ty:0deg;\s*transform:perspective\(900px\) rotateX\(var\(--tx\)\) rotateY\(var\(--ty\)\) rotate\(var\(--rot\)\) translateY\(var\(--lift\)\)/.test(guarded));
ok('the reveal ends on the element\'s own style (fill-mode backwards), so it can never flatten the deck again',
   /\.lp-grid\.rv \.lp-feat\{opacity:1;animation:featDeal[^;}]*backwards\}/.test(guarded) &&
   /\.lp-grid\.rv \.lp-feat \.fi\{animation:featIcon[^;}]*backwards\}/.test(guarded) &&
   /\.lp-subj\.rv \.sj\{opacity:1;animation:sjDeal[^;}]*backwards\}/.test(guarded));
ok('the hover pose only applies where there is a real hover',
   /@media \(hover:hover\) and \(pointer:fine\)\{\s*html\.anim-on #landing #lpFeatures \.lp-feat:hover\{--rot:0deg;--lift:-3px\}/.test(guarded));
ok('the desktop rest poses match the stylesheet\'s own (-1.4deg/-6px, 1.2deg/6px, -.8deg/-3px)',
   /--rot:-1\.4deg;--lift:-6px/.test(guarded) && /--rot:1\.2deg;--lift:6px/.test(guarded) && /--rot:-\.8deg;--lift:-3px/.test(guarded));
ok('the featDeal keyframe lists the same functions in from and to, so it interpolates as a transform list',
   (function () {
     var k = keyframes.filter(function (x) { return /@keyframes featDeal/.test(x); })[0] || '';
     var fns = k.match(/transform:([^;}]*)/g) || [];
     if (fns.length !== 2) return false;
     var f = fns.map(function (t) { return (t.match(/[a-zA-Z]+(?=\()/g) || []).filter(function (n) { return n !== 'var' && n !== 'calc'; }).join(','); });
     return f[0] === f[1];
   })());

/* ------------------------------------------------------------- the markup -- */
var raw = read('index.html');
var html = raw
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

head('the markup');
ok('each of the three fields is a label plus a .cf-in wrapper holding the real control',
   doc.querySelectorAll('.cf-field').length === 3 && doc.querySelectorAll('.cf-in').length === 3 &&
   !!doc.querySelector('.cf-in #cName') && !!doc.querySelector('.cf-in #cEmail') && !!doc.querySelector('.cf-in #cMsg'));
ok('every label still points at its control',
   ['cName', 'cEmail', 'cMsg'].every(function (id) { return new RegExp('<label for="' + id + '">').test(html); }));
ok('the form still submits through sendContact and keeps its status line',
   /onsubmit="sendContact\(\);return false"/.test(html) && !!doc.getElementById('cStatus') && !!doc.getElementById('cSendBtn'));
ok('the send button has no children of its own (sendContact resets its text)',
   /<button type="submit" id="cSendBtn">Send message<\/button>/.test(html));
var pics = doc.querySelectorAll('.lp-const');
ok('there are two constellation pictures, a phone shape and a wide one', pics.length === 2 && doc.querySelectorAll('.cn-n').length === 1 && doc.querySelectorAll('.cn-w').length === 1);
ok('both are hidden from screen readers and cannot take focus',
   (html.match(/<svg class="lp-const [^"]*" aria-hidden="true" focusable="false"/g) || []).length === 2);
ok('each picture has lines that carry their own origin and delay, and stars that carry a delay and a pace',
   pics.every(function (s) {
     var m = s.outerHTML;
     return (m.match(/<line [^>]*--ox:[\d.]+px;--oy:[\d.]+px;--d:[\d.]+s/g) || []).length >= 15 &&
            (m.match(/<circle class="st" [^>]*--d:[\d.]+s;--tw:[\d.]+s/g) || []).length >= 15;
   }));
ok('the picture sits first in the footer, ahead of the text',
   /<footer class="lp-foot">\s*<svg class="lp-const cn-n"/.test(html));
ok('the footer\'s words and links are unchanged',
   ['Building Purpose-Driven Independent Scholars.', 'Updates &amp; News', 'UTME Bootcamp', 'Privacy Policy', 'Email us']
     .every(function (t) { return html.indexOf(t) > -1; }));

/* ------------------------------------------------------------- the script -- */
var vars = new Map();
function instrument(el) {
  var store = {};
  vars.set(el, store);
  el.style = { setProperty: function (k, v) { store[k] = v; } };
  return el;
}
function V(el, k) { return vars.get(el)[k]; }
function has(el, c) { return (el.className || '').split(/\s+/).indexOf(c) > -1; }

var timers = [];
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 1280, innerHeight: 900,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function () { return 0; },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent
};
var observed = [], ioCallback = null;
function FakeIO(cb) { ioCallback = cb; }
FakeIO.prototype.observe = function (el) { observed.push(el); };
FakeIO.prototype.unobserve = function () {};
sandbox.IntersectionObserver = FakeIO;
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});
function run(expr) { return vm.runInContext(expr, ctx); }

head('the cursor-follow tilt');
var card = instrument(doc.querySelector('#lpFeatures .lp-feat'));
var rect = { left: 100, top: 100, width: 300, height: 200 };
run('animOn = true');
run('tiltSet').call;
vm.runInContext('globalThis.__t = { tiltSet: tiltSet, tiltClear: tiltClear, magnetSet: magnetSet, magnetClear: magnetClear, rippleAt: rippleAt }', ctx);
var T = sandbox.__t;
T.tiltSet(card, 250, 200, rect);
ok('a pointer dead centre gives no tilt', V(card, '--ty') === '0deg' && V(card, '--tx') === '0deg', V(card, '--ty') + ' / ' + V(card, '--tx'));
ok('...but the card is marked as being tilted, so it follows quickly', has(card, 'is-tilting'));
T.tiltSet(card, 400, 100, rect);
ok('at the top right corner it is at its limits: 6deg one way, 5deg the other',
   V(card, '--ty') === '6deg' && V(card, '--tx') === '5deg', V(card, '--ty') + ' / ' + V(card, '--tx'));
T.tiltSet(card, 100, 300, rect);
ok('at the bottom left corner the signs flip', V(card, '--ty') === '-6deg' && V(card, '--tx') === '-5deg', V(card, '--ty') + ' / ' + V(card, '--tx'));
T.tiltSet(card, 9999, -9999, rect);
ok('a pointer far outside the card is clamped to the same limits', V(card, '--ty') === '6deg' && V(card, '--tx') === '5deg');
T.tiltClear(card);
ok('leaving the card puts it back to flat and hands it back to the slow ease',
   V(card, '--ty') === '0deg' && V(card, '--tx') === '0deg' && !has(card, 'is-tilting'));
var before = JSON.stringify(vars.get(card));
T.tiltSet(card, 200, 200, { left: 0, top: 0, width: 0, height: 0 });
ok('an unmeasured card (no layout) is left alone', JSON.stringify(vars.get(card)) === before);

head('the magnetic pull');
var field = instrument(doc.querySelector('.cf-in'));
var frect = { left: 0, top: 0, width: 400, height: 44 };
T.magnetSet(field, 200, 22, frect);
ok('a pointer at the middle of a field does not move it', V(field, '--mx') === '0px' && V(field, '--my') === '0px');
T.magnetSet(field, 400, 44, frect);
ok('at the far corner it leans 4px across and 3px down, and no further', V(field, '--mx') === '4px' && V(field, '--my') === '3px', V(field, '--mx') + ' / ' + V(field, '--my'));
T.magnetSet(field, -900, -900, frect);
ok('a pointer far off leans it the other way, still capped', V(field, '--mx') === '-4px' && V(field, '--my') === '-3px');
T.magnetClear(field);
ok('leaving puts it back', V(field, '--mx') === '0px' && V(field, '--my') === '0px');

head('the send-button ripple');
var btn = doc.getElementById('cSendBtn');
btn.getBoundingClientRect = function () { return { left: 50, top: 300, width: 400, height: 48 }; };
btn.querySelectorAll = function (s) { return this.children.filter(function (c) { return (c.className || '') === 'cf-rip'; }); };
var made = [];
btn.removeChild = function (c) { this.children = this.children.filter(function (x) { return x !== c; }); c.parentNode = null; };
btn.appendChild = function (c) { c.parentNode = this; this.children.push(c); made.push(c); return c; };
var r1 = T.rippleAt(btn, 90, 320);
ok('a press makes one ripple span on the button', !!r1 && r1.className === 'cf-rip' && btn.children.indexOf(r1) > -1);
ok('...which is hidden from screen readers', r1.getAttribute('aria-hidden') === 'true');
ok('...and starts where the pointer went down (40px across, 20px down)',
   r1.style.left === '40px' && r1.style.top === '20px', r1.style.left + ' / ' + r1.style.top);
var expectD = Math.ceil(2 * Math.sqrt(360 * 360 + 28 * 28));
ok('...and is big enough to cover the button from the farthest corner', r1.style.width === expectD + 'px' && r1.style.height === expectD + 'px', r1.style.width);
var r2 = T.rippleAt(btn);
ok('a key press (no coordinates) ripples from the middle', r2.style.left === '200px' && r2.style.top === '24px', r2.style.left + ' / ' + r2.style.top);
T.rippleAt(btn, 60, 310); T.rippleAt(btn, 70, 310);
var r5 = T.rippleAt(btn, 80, 310);
ok('no more than four at once, so a fast tapper cannot pile them up', r5 === null && btn.children.filter(function (c) { return c.className === 'cf-rip'; }).length === 4);
timers.filter(function (t) { return t.ms === 900; }).forEach(function (t) { t.fn(); });
ok('each one removes itself if its animation never finishes',
   btn.children.filter(function (c) { return c.className === 'cf-rip'; }).length === 0);
btn.disabled = true;
ok('a disabled button makes none', T.rippleAt(btn, 60, 310) === null);
btn.disabled = false;
run('animOn = false');
ok('with animation off (reduced motion, or no observer) there is no ripple', T.rippleAt(btn, 60, 310) === null);
run('animOn = true');
btn.getBoundingClientRect = function () { return { left: 0, top: 0, width: 0, height: 0 }; };
ok('a button with no layout makes none', T.rippleAt(btn, 5, 5) === null);

head('the looping decoration is only on while it is on screen');
observed.length = 0;
run('fx.io = null; fxInit()');
var live = observed.filter(function (e) { return has(e, 'lp-contact') || has(e, 'lp-foot'); });
ok('the contact card and the footer are both observed', live.length === 2, String(live.length));
var contact = doc.querySelector('.lp-contact'), foot = doc.querySelector('.lp-foot');
ioCallback([{ target: contact, isIntersecting: true }, { target: foot, isIntersecting: true }]);
ok('scrolled into view they are marked live', has(contact, 'live') && has(foot, 'live'));
ioCallback([{ target: contact, isIntersecting: false }]);
ok('scrolled out of view the marker comes off again (so the loop stops)', !has(contact, 'live') && has(foot, 'live'));
observed.length = 0;
run('fxInit()');
ok('calling it again does not observe twice', observed.length === 0);

head('with animation off, nothing starts');
run('animOn = false; fx.io = null; fx.bound = false');
observed.length = 0;
run('fxInit()');
ok('fxInit does nothing when animOn is false', observed.length === 0 && run('fx.bound') === false);
run('animOn = true');

head('the wiring');
var app = read('js/app.js');
ok('the landing screen starts these behaviours when it is shown',
   /if\(id === 'landing' && typeof fxInit === 'function'\) fxInit\(\);/.test(app));
ok('the footer is revealed once, like the other sections', /'\.lp-foot'\]/.test(app));
ok('the pointer handlers ignore a finger (mouse and pen only)',
   /function fxFine\(e\)\{[\s\S]*?t === 'mouse' \|\| t === 'pen'/.test(app));
ok('the tilt caches the card\'s box once per hover, so the tilt cannot move the box under the pointer',
   /fx\.cardRect = card && card\.getBoundingClientRect/.test(app));
ok('a scroll clears any cached box',
   /addEventListener\('scroll', function\(\)\{\s*if\(fx\.card\)/.test(app));
ok('sendContact still writes the button\'s text directly (nothing else in the button to lose)',
   /btn\.textContent='Sending…'/.test(app) && /btn\.textContent='Send message'/.test(app));
ok('the service-worker cache was bumped again for this release',
   (function () { var n = +((read('sw.js').match(/const CACHE = 'goc-v(\d+)'/) || [])[1]); return n >= 37; })());

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
