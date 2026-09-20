/* test-landing-motion.js — landing motion, part 2: the "How it works" film strip
   and the stage pull-quote.
   These are the same failure modes test-p1.js polices for the first set of
   effects — content hidden when it should not be, motion played to someone who
   asked for none — plus the one deliberate exception (the step icons draw
   themselves with stroke-dashoffset) which is pinned here so it cannot spread.
   Run:  node test/test-landing-motion.js  */
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
var start = css.indexOf('LANDING MOTION, PART 2');
var end = css.indexOf('PRIORITY 1 — PREMIUM MOTION');
var block = (start > -1 && end > start) ? css.slice(start, end) : '';
var bare = block.replace(/^[\s\S]*?\*\//, '').replace(/\/\*[\s\S]*?\*\//g, '');
var keyframes = bare.match(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g) || [];
var rules = bare.replace(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g, '');
var guardOpen = rules.indexOf('@media (prefers-reduced-motion: no-preference){');
var guarded = guardOpen > -1 ? rules.slice(guardOpen) : '';
var unguarded = guardOpen > -1 ? rules.slice(0, guardOpen) : rules;

head('the rules the effects were written under');
ok('the part-2 block exists and sits ahead of the Priority 1 section', block.length > 800);
ok('every animation / will-change / transition is inside the reduced-motion guard',
   !/animation\s*:|animation-name\s*:|will-change\s*:|transition\s*:/.test(unguarded),
   (unguarded.match(/animation\s*:|will-change\s*:|transition\s*:/g) || []).join(','));
ok('the guard is the "no-preference" form, so no motion is the default',
   guardOpen > -1);

var hiders = (guarded.match(/[^{}]+\{[^{}]*opacity:\s*0[;}][^{}]*\}/g) || []);
ok('something is hidden ready to be revealed', hiders.length > 0);
ok('every rule that hides content is gated behind html.anim-on',
   hiders.every(function (r) { return r.indexOf('html.anim-on') > -1; }),
   hiders.filter(function (r) { return r.indexOf('html.anim-on') < 0; }).join(' | '));
/* The stage's wash is the one thing that starts at opacity 0 outside the guard:
   it is an empty overlay, so 0 means "no wash", not "content hidden". */
ok('nothing outside the guard hides content with opacity:0 (a static page shows everything)',
   !/opacity:\s*0[;}]/.test(unguarded.replace(/\.lp-stage::before\{[^}]*\}/, '')));

ok('the logo is never mentioned in this block',
   bare.indexOf('.bm') < 0 && bare.indexOf('.lp-brand') < 0 && bare.indexOf('goc-mark') < 0);

/* Movement driven by scroll may only touch transform and opacity. */
var scrollDriven = (rules.match(/[^;{}]*var\(--(?:o|c|qo|qc|p)[,)][^;{}]*/g) || []);
ok('the scroll variables are used', scrollDriven.length >= 8, String(scrollDriven.length));
ok('every declaration that reads a scroll variable is transform or opacity',
   scrollDriven.every(function (d) { return /^\s*(transform|opacity)\s*:/.test(d.trim().replace(/^[^:]*\{/, '')); }),
   scrollDriven.filter(function (d) { return !/^\s*(transform|opacity)\s*:/.test(d.trim().replace(/^[^:]*\{/, '')); }).join(' | '));

/* The one exception, and its boundary. */
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
var nonTO = Object.keys(props).filter(function (n) {
  return props[n].some(function (p) { return p !== 'transform' && p !== 'opacity'; });
});
ok('exactly one keyframe animates anything but transform/opacity, and it is hwDraw',
   nonTO.length === 1 && nonTO[0] === 'hwDraw' && props.hwDraw.join() === 'stroke-dashoffset', nonTO.join(','));
var drawUses = guarded.match(/[^{}]*\{[^{}]*hwDraw[^{}]*\}/g) || [];
ok('hwDraw is used only on the step-icon paths',
   drawUses.length > 0 && drawUses.every(function (r) { return /\.hw-ico path/.test(r); }), drawUses.join(' | '));
ok('stroke-dashoffset appears only on .hw-ico paths',
   (rules.match(/[^{}]*\{[^{}]*stroke-dashoffset[^{}]*\}/g) || []).every(function (r) { return /\.hw-ico path/.test(r); }));
ok('a hidden icon uses a dash pattern that leaves no round-cap dot',
   /\.hw-ico path\{stroke-dasharray:1 2;stroke-dashoffset:1\}/.test(guarded));
ok('the icon only draws when the strip is revealed AND the slide is centred',
   /html\.anim-on \.hw\.rv \.hw-slide\.on \.hw-ico path\{animation:hwDraw/.test(guarded));

head('the film strip works without any script');
ok('the strip snaps with CSS scroll-snap', /\.hw-strip\{[^}]*scroll-snap-type:x mandatory/.test(bare));
ok('every slide is a snap point that cannot be skipped',
   /\.hw-slide\{[^}]*scroll-snap-align:center[^}]*scroll-snap-stop:always/.test(bare));
ok('the slide clips its tilted panel, so it adds no scrollable width',
   /\.hw-slide\{[^}]*overflow:hidden/.test(bare));

/* ------------------------------------------------------------- the markup -- */
var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

head('the markup');
var slides = doc.querySelectorAll('.hw-slide');
var nodes = doc.querySelectorAll('.hw-node');
ok('there are four slides and four rail dots', slides.length === 4 && nodes.length === 4,
   slides.length + ' / ' + nodes.length);
ok('the strip is a labelled, keyboard-reachable region',
   /id="hwStrip" role="region" tabindex="0" aria-label="[^"]+"/.test(read('index.html')));
ok('each rail dot says which step it goes to',
   nodes.every(function (n, i) { return n.getAttribute('aria-label') === 'Go to step ' + (i + 1); }));
ok('the four step titles are unchanged',
   ['Learn the concept', 'Practise without pressure', 'Test under exam conditions', 'Target your weak topics']
     .every(function (t) { return html.indexOf(t) > -1; }));
ok('the huge numerals and the icons are hidden from screen readers',
   (html.match(/class="hw-num" aria-hidden="true"/g) || []).length === 4 &&
   (html.match(/class="hw-ico"[^>]*aria-hidden="true"/g) || []).length === 4);
ok('every icon path carries pathLength=1, so one dash pattern fits them all',
   (html.match(/class="hw-ico"[^>]*>[\s\S]*?<\/svg>/g) || []).every(function (svg) {
     var ps = svg.match(/<path\b[^>]*>/g) || [];
     return ps.length > 0 && ps.every(function (p) { return /pathLength="1"/.test(p); });
   }));
ok('the drawer link to "How it works" still has its target', !!doc.getElementById('lpHow'));
ok('the quote keeps its words and its attribution',
   html.indexOf('We don\'t simply prepare students to pass exams.') > -1 &&
   html.indexOf('The G.O.C Academy promise') > -1);
ok('the stage has the giant mark (decorative), the tilt wrapper and the attribution',
   !!doc.querySelector('#lpStage .lq-mark') && !!doc.querySelector('#lpStage .qw') && !!doc.querySelector('#lpStage .who') &&
   /class="lq-mark" aria-hidden="true"/.test(html));

/* ------------------------------------------------------------- the script -- */
var vars = new Map();
function instrument(el) {
  var store = {};
  vars.set(el, store);
  el.style = { setProperty: function (k, v) { store[k] = v; } };
  return el;
}
/* minidom has no removeAttribute; a real DOM does, and filmSync uses it. */
nodes.forEach(function (n) { n.removeAttribute = function (k) { delete n.attributes[k]; }; });
var strip = instrument(doc.getElementById('hwStrip'));
var wrap = instrument(doc.getElementById('hw'));
slides.forEach(instrument);
var stage = instrument(doc.getElementById('lpStage'));
var landing = doc.getElementById('landing');
function V(el, k) { return vars.get(el)[k]; }

var reducedMotion = false, hasIO = true;
function FakeIO(cb) { this.cb = cb; }
FakeIO.prototype.observe = function () {}; FakeIO.prototype.unobserve = function () {};
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function (q) { return { matches: /reduce/.test(q) ? reducedMotion : false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function () { return 0; },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent
};
Object.defineProperty(sandbox, 'IntersectionObserver', { get: function () { return hasIO ? FakeIO : undefined; } });
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});
function run(expr) { return vm.runInContext(expr, ctx); }
function has(el, c) { return (el.className || '').split(/\s+/).indexOf(c) > -1; }

head('the strip measures itself');
var threw = false;
try { run('filmInit()'); } catch (e) { threw = true; }
ok('with no layout at all (width 0) it does not throw', !threw);
ok('...and slide one is the one that is on', has(slides[0], 'on') && !has(slides[1], 'on'));

strip.clientWidth = 430; strip.scrollWidth = 1720; strip.scrollLeft = 0;
run('filmSync()');
ok('at rest on step one the rail is empty', V(wrap, '--p') === '0.0000', V(wrap, '--p'));
ok('step one\'s dot is filled and current, step two\'s is not',
   has(nodes[0], 'done') && has(nodes[0], 'cur') && !has(nodes[1], 'done'));
ok('the centred slide has --c 1 and --o 0', V(slides[0], '--c') === '1.000' && V(slides[0], '--o') === '0.000');
ok('the slide to its right is off to the right (--o 1, --c 0)',
   V(slides[1], '--o') === '1.000' && V(slides[1], '--c') === '0.000');

strip.scrollLeft = 215;
run('filmSync()');
ok('half way between one and two, both are half centred',
   V(slides[0], '--c') === '0.500' && V(slides[1], '--c') === '0.500', V(slides[0], '--c') + ' / ' + V(slides[1], '--c'));
ok('the progress is a third of the way along the strip', V(wrap, '--p') === '0.1667', V(wrap, '--p'));
ok('a slide is not "on" until it is at least 55% centred', !has(slides[1], 'on'));

strip.scrollLeft = 860;
run('filmSync()');
ok('on step three the progress is two thirds', V(wrap, '--p') === '0.6667', V(wrap, '--p'));
ok('step three is on, current, and its dot is filled; step four is not',
   has(slides[2], 'on') && has(nodes[2], 'cur') && has(nodes[2], 'done') && !has(nodes[3], 'done'));
ok('the earlier dots stay filled behind it', has(nodes[0], 'done') && has(nodes[1], 'done'));
ok('only the current dot is marked aria-current',
   nodes[2].getAttribute('aria-current') === 'step' && nodes[0].getAttribute('aria-current') === null);

strip.scrollLeft = 1290;
run('filmSync()');
ok('on the last step the rail is exactly full, whatever scrollWidth says', V(wrap, '--p') === '1.0000', V(wrap, '--p'));
ok('a slide stays on once it has been reached (the icon is drawn once, not re-hidden)',
   has(slides[0], 'on') && has(slides[2], 'on') && has(slides[3], 'on'));

head('the stage measures itself');
landing.clientHeight = 900;
function place(topOfStage) {
  stage.getBoundingClientRect = function () { return { top: topOfStage, height: 300 }; };
  landing.getBoundingClientRect = function () { return { top: 0, height: 900 }; };
}
run('animOn = true');
place(300);   /* centre at 450 = the middle of a 900 high viewport */
run('stageSync()');
ok('centred: the wash is fully on and there is no tilt', V(stage, '--qc') === '1.000' && V(stage, '--qo') === '0.000',
   V(stage, '--qc') + ' / ' + V(stage, '--qo'));
place(1500);  /* well below the fold */
run('stageSync()');
ok('below the fold: no wash, and the quote leans back (--qo positive)',
   V(stage, '--qc') === '0.000' && Number(V(stage, '--qo')) > 0, V(stage, '--qc') + ' / ' + V(stage, '--qo'));
place(-600);  /* scrolled well past */
run('stageSync()');
ok('scrolled past: no wash, and the tilt has flipped (--qo negative)',
   V(stage, '--qc') === '0.000' && Number(V(stage, '--qo')) < 0);
place(500);
run('stageSync()');
var mid = Number(V(stage, '--qc'));
ok('in between, the wash is partial and eased', mid > 0 && mid < 1, String(mid));

head('reduced motion, and no observer');
run('animOn = false');
Object.keys(vars.get(stage)).forEach(function (k) { delete vars.get(stage)[k]; });
place(300);
run('stageSync()');
ok('with animation off the stage variables are never written', Object.keys(vars.get(stage)).length === 0);
strip.scrollLeft = 430;
run('filmSync()');
ok('...but the strip\'s own progress still follows the student\'s scrolling',
   V(wrap, '--p') === '0.3333' && has(nodes[1], 'cur'), V(wrap, '--p'));
ok('a dot click scrolls without animation when motion is reduced',
   /behavior:\s*filmReduced\(\)\s*\?\s*'auto'\s*:\s*'smooth'/.test(read('js/app.js')));

head('the wiring');
var app = read('js/app.js');
ok('the strip and the stage are added to the sections that get revealed',
   /'#lpHow \.hw'/.test(app) && /'#lpStage'/.test(app));
ok('the landing screen starts the film strip when it is shown',
   /if\(id === 'landing' && typeof filmInit === 'function'\) filmInit\(\);/.test(app));
ok('the service-worker cache was bumped so returning students get the new files',
   !/goc-v35/.test(read('sw.js')));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
