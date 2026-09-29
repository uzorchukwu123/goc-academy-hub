/* test-p2.js — Priority 2: the Updates & News filter row.
   Two faults were fixed: the chip row slid underneath the sticky nav and got
   cut in half, and the chips past the right edge were unreachable with nothing
   to signal it. This suite locks in the markup and the behaviour those fixes
   depend on, so a later edit cannot quietly undo either. Run:
       node test/test-p2.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var rawHtml = read('index.html');
var css = read('css/styles.css');
var appSrc = read('js/app.js');

var html = rawHtml
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var resizeHandlers = 0;
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 390, innerHeight: 844,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function (t) { if (t === 'resize') resizeHandlers++; },
  removeEventListener: function () {},
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
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }

/* ---------------------------------------------------------------- markup ---- */
head('the markup the sticky fix depends on');

var wrap = id('upFilterWrap');
var row = id('upFilters');
ok('the sticky wrapper exists', !!wrap);
ok('the scrolling chip row still exists under its old id', !!row);
ok('the chip row is inside the wrapper, not a sibling of it',
  !!wrap && (wrap.innerHTML || '').indexOf('up-filters') > -1);
ok('all five filters are present',
  !!row && row.querySelectorAll('.up-chip').length === 5,
  row ? 'found ' + row.querySelectorAll('.up-chip').length : 'no row');
ok('exactly one chip starts active',
  !!row && row.querySelectorAll('.up-chip.on').length === 1);

/* Scholarship and News were the two being lost off the right edge — if either
   is ever dropped from the markup the bug report no longer makes sense. */
var chipHtml = wrap ? wrap.innerHTML : '';
ok('Scholarship is one of the filters', chipHtml.indexOf('Scholarship') > -1);
ok('News is one of the filters', chipHtml.indexOf('News') > -1);

/* ------------------------------------------------------------------- css ---- */
head('the stylesheet rules that keep the row clear of the nav');

ok('the wrapper is sticky', /\.up-filterwrap\{[^}]*position:sticky/.test(css));
ok('its offset comes from the measured nav height, with a fallback',
  /\.up-filterwrap\{[^}]*top:var\(--goc-navh,\s*\d+px\)/.test(css));

var wz = (css.match(/\.up-filterwrap\{[^}]*z-index:(\d+)/) || [])[1];
var nz = (css.match(/\.lp-nav\{[^}]*z-index:(\d+)/) || [])[1];
ok('the row sits below the nav in stacking order, so the nav always wins',
  !!wz && !!nz && Number(wz) < Number(nz), 'row ' + wz + ' vs nav ' + nz);

ok('the row itself no longer carries the sticky background',
  !/\.up-filters\{[^}]*position:sticky/.test(css));
ok('the row still scrolls horizontally', /\.up-filters\{[^}]*overflow-x:auto/.test(css));
ok('the fade overlay is declared', /\.up-filterwrap::after\{/.test(css));
ok('the fade never swallows a tap', /\.up-filterwrap::after\{[^}]*pointer-events:none/.test(css));
ok('the fade is off until the up-more class is set',
  /\.up-filterwrap::after\{[^}]*opacity:0/.test(css) &&
  /\.up-filterwrap\.up-more::after\{[^}]*opacity:1/.test(css));
ok('the active chip is emphasised beyond colour alone',
  /\.up-chip\.on\{[^}]*box-shadow/.test(css));

/* -------------------------------------------------------------- filtering --- */
head('filtering still does its job');

function cards() { return doc.querySelectorAll('#upList .up-card'); }
function shown() {
  var c = cards(), n = 0;
  for (var i = 0; i < c.length; i++) if (c[i].style.display !== 'none') n++;
  return n;
}
var list = id('upList');
list.innerHTML =
  '<article class="up-card" data-cat="admission"></article>' +
  '<article class="up-card" data-cat="utme"></article>' +
  '<article class="up-card" data-cat="utme"></article>' +
  '<article class="up-card" data-cat="scholarship"></article>' +
  '<article class="up-card" data-cat="news"></article>';

var chips = row.querySelectorAll('.up-chip');
function chipFor(f) {
  for (var i = 0; i < chips.length; i++) if (chips[i].getAttribute('data-f') === f) return chips[i];
  return null;
}
function pick(f) { sandbox.__c = chipFor(f); run('filterUpdates(' + JSON.stringify(f) + ', __c)'); }

ok('five cards are staged', cards().length === 5);

pick('utme');
ok('choosing UTME leaves only the two UTME cards', shown() === 2, 'showing ' + shown());
ok('the chosen chip becomes the active one', chipFor('utme').className.indexOf('on') > -1);
ok('the previously active chip is cleared', chipFor('all').className.indexOf('on') < 0);
ok('only one chip is ever active', row.querySelectorAll('.up-chip.on').length === 1);

/* The two filters that were unreachable must actually work once reached. */
pick('scholarship');
ok('Scholarship filters to its single card', shown() === 1, 'showing ' + shown());
pick('news');
ok('News filters to its single card', shown() === 1, 'showing ' + shown());

pick('all');
ok('All brings every card back', shown() === 5, 'showing ' + shown());
ok('the active filter is remembered for re-renders', run('upActiveFilter') === 'all');

/* renderUpdates repaints the list, and must respect the filter in force. */
run('updatesData = [{cat:"utme",date:"Aug 20, 2026",title:"T1",body:"B1"},' +
    '{cat:"news",date:"Aug 19, 2026",title:"T2",body:"B2"}]');
pick('utme');
run('renderUpdates()');
ok('a repaint keeps the chosen filter applied, not reset to All',
  shown() === 1, 'showing ' + shown());

/* ------------------------------------------------------------- resilience --- */
head('the new helpers are safe wherever they run');

/* minidom reports no layout metrics at all, which is the same position the real
   browser is in on a first paint. Neither helper may throw there, and neither
   may claim there is more row to reach when it cannot possibly know. */
var threw = null;
try { run('upFadeSync(); upStickTop();'); } catch (e) { threw = e.message; }
ok('neither helper throws without layout metrics', threw === null, threw);
ok('no fade is asserted when nothing has been measured',
  (id('upFilterWrap').className || '').indexOf('up-more') < 0);

resizeHandlers = 0;
run('upFiltersInit(); upFiltersInit(); upFiltersInit();');
ok('listeners are wired once however many times the page is opened',
  resizeHandlers === 1, 'wired ' + resizeHandlers + ' times');

ok('opening the Updates screen is what triggers the measurement',
  /id === 'updates'[\s\S]{0,120}upFiltersInit/.test(appSrc));

/* The browser files are not transpiled, so this suite's own subject must stay
   ES5 like the rest of app.js. */
var newCode = (appSrc.match(/function upStickTop[\s\S]*?function upFiltersInit[\s\S]*?\n\}/) || [''])[0];
ok('the new code is ES5 — no arrows, let, const or template literals',
  !/=>|\blet\s|\bconst\s|`/.test(newCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));

/* ------------------------------------------------------------------------- */
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
