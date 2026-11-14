/* test-tour-highlight.js — Part Four: the tour spotlights the step's real
   element, at its real on-screen box, and keeps the card on screen whether
   the target is high or low. Runs the real engine against fake DOM elements
   whose getBoundingClientRect is controlled.
   Run:  node test/test-tour-highlight.js  */
'use strict';
var path = require('path');
var fs = require('fs');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var mod = require(path.join(APP, 'js', 'onboarding.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function el(rect) {
  var e = { children: [], style: {}, textContent: '', className: '', disabled: false, _vis: true, attrs: {}, _rect: rect };
  e.appendChild = function (c) { e.children.push(c); c.parentNode = e; return c; };
  e.removeChild = function (c) { e.children = e.children.filter(function (x) { return x !== c; }); return c; };
  e.addEventListener = function () {}; e.removeEventListener = function () {};
  e.setAttribute = function (k, v) { e.attrs[k] = v; }; e.focus = function () {};
  e.scrollIntoView = function () {};
  e.getBoundingClientRect = function () { return e._rect; };
  return e;
}
function world(targetRect, vw, vh) {
  var store = {};
  var storage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } };
  var body = el({ left: 0, top: 0, width: 390, height: 844, bottom: 844 });
  var byId = { tourTarget: el(targetRect) };
  var env = {
    document: { body: body, createElement: el, getElementById: function (id) { return byId[id] || null; }, addEventListener: function () {}, removeEventListener: function () {} },
    storage: storage, getElementById: function (id) { return byId[id] || null; },
    isVisible: function (e) { return !!e && e._vis; }, go: function () {},
    viewportWidth: function () { return vw; }, viewportHeight: function () { return vh; }
  };
  return { env: env, body: body, byId: byId, store: store };
}
function cardOf(w) { var o = w.body.children[w.body.children.length - 1]; return o ? { overlay: o, ring: o.children[0], card: o.children[1] } : {}; }
function tick() { return new Promise(function (r) { setTimeout(r, 15); }); }

(async function () {
  head('high target: ring surrounds it and the card sits below');
  var w = world({ left: 37, top: 250, width: 180, height: 44, bottom: 294 }, 390, 844);
  var tour = mod.create(w.env);
  tour.register('student', [{ go: 'home', target: 'tourTarget', title: 'Profile', body: 'Your account.' }]);
  await tour.start('student', { userId: 'GOC-S-1' });
  var c = cardOf(w);
  ok('an overlay, a ring and a card were built', !!c.overlay && !!c.ring && !!c.card);
  ok('the ring is displayed over the exact target', c.ring.style.display === 'block'
    && c.ring.style.left === '29px' && c.ring.style.top === '242px'
    && c.ring.style.width === '196px' && c.ring.style.height === '60px',
    JSON.stringify(c.ring.style));
  var top = parseInt(c.card.style.top, 10), left = parseInt(c.card.style.left, 10), width = parseInt(c.card.style.width, 10);
  ok('the card is below the ring, not over it', top >= 294 + 8, top);
  ok('the card is inside the viewport horizontally', left >= 12 && left + width <= 390 - 12, left + '+' + width);
  ok('the card names the step', c.card.children[2].textContent === 'Profile');
  ok('the target is still the step target', tour.current().step.target === 'tourTarget');
  await tour.next();   // completion
  ok('completion hides the ring', c.ring.style.display === 'none');
  await tour.exit();

  head('low target: the card flips above and stays on screen');
  var w2 = world({ left: 16, top: 760, width: 358, height: 60, bottom: 820 }, 390, 844);
  var t2 = mod.create(w2.env);
  t2.register('student', [{ go: 'home', target: 'tourTarget', title: 'Low', body: 'Near the fold.' }]);
  await t2.start('student', { userId: 'GOC-S-2' });
  var c2 = cardOf(w2);
  var top2 = parseInt(c2.card.style.top, 10);
  ok('the ring still surrounds the low target', c2.ring.style.top === '752px' && c2.ring.style.height === '76px',
    JSON.stringify(c2.ring.style));
  ok('the card flips above the target', top2 >= 12 && top2 + 260 <= 760, top2);
  ok('and remains inside the viewport width', parseInt(c2.card.style.left, 10) >= 12
    && parseInt(c2.card.style.left, 10) + parseInt(c2.card.style.width, 10) <= 378,
    c2.card.style.left + '+' + c2.card.style.width);
  await t2.exit();

  head('a target that never appears is never spotlighted');
  var w3 = world({ left: 0, top: 0, width: 0, height: 0, bottom: 0 }, 390, 844);
  w3.byId.tourTarget._vis = false;
  var t3 = mod.create(w3.env);
  t3.register('student', [{ go: 'home', target: 'tourTarget', title: 'Hidden', body: 'Should skip.' }]);
  await t3.start('student', { userId: 'GOC-S-3' });
  ok('the engine skipped the hidden target', t3.current() && t3.current().skipped.indexOf('tourTarget') > -1);
  await t3.exit();

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
