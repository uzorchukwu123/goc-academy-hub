/* test-free2027-admin.js — the console side of the 2027 Free Tutorial Edition:
   the three separate functions must all be visible in the running Management
   Console for the right roles.

   ROOT CAUSE THIS PINS: the tile injection used to bail out at DOMContentLoaded
   because nobody is signed in yet at that moment (admMe is empty), so the
   wrappers around admOpen/admMenuApply were never installed and the Free
   Tutorial entry never appeared. The wrappers must be installed unconditionally
   and the role checked at paint/click time, when admMe is populated.

   node test/test-free2027-admin.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var src = fs.readFileSync(path.join(APP, 'js', 'free2027-admin.js'), 'utf8');
var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 220) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

function El(id) {
  this.id = id;
  this.innerHTML = '';
  this.textContent = '';
  this.scrollTop = 0;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
}
El.prototype.insertAdjacentHTML = function (w, h) { this.innerHTML += h; };
El.prototype.querySelectorAll = function () { return []; };

function makeWorld() {
  var els = {
    admTileNav: new El('admTileNav'),
    admSheetBody: new El('admSheetBody'),
    admSheetBack: new El('admSheetBack'),
    admSheet: new El('admSheet'),
    admSheetTitle: new El('admSheetTitle'),
    f27ModeBody: new El('f27ModeBody'),
    f27AdmBody: new El('f27AdmBody')
  };
  var toasts = [];
  var world = {
    console: console,
    document: {
      readyState: 'complete',
      getElementById: function (id) { return els[id] || null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    admMe: { id: '', roleKey: null },
    toast: function (m) { toasts.push(m); },
    confirm: function () { return true; },
    Promise: Promise,
    GOC: {
      free2027: rules,
      free: {
        adminOverview: function () {
          return Promise.resolve({
            enabled: true, mode: 'free2027', courses: ['Law'], session: { id: 'F27-S1', label: 'S1', participants: 0, verified: 0, activities: 0, published: 0, submitted: 0, lessons: 0, audit: 0 },
            otpDelivery: { available: true }, archives: 0, otp: { length: 6, ttlMin: 15 }, topN: 10
          });
        },
        setMode: function () { return Promise.resolve({ mode: 'original', label: 'Original Mode', enabled: true }); }
      }
    }
  };
  /* the console's own two functions, as js/app.js defines them */
  world.admMenuApply = function () {
    els.admTileNav.innerHTML = ['overview', 'students', 'questions'].map(function (k) {
      return '<button class="adm-tile" data-section="' + k + '" onclick="admOpen(\'' + k + '\')"><span class="at-label">' + k + '</span></button>';
    }).join('');
  };
  world.admOpen = function (section) {
    els.admSheetBody.innerHTML = '<div>original section: ' + section + '</div>';
    els.admSheetTitle.textContent = section;
  };
  world.window = world;
  world.els = els;
  world.toasts = toasts;
  return world;
}

function boot(w) {
  var ctx = vm.createContext(w);
  vm.runInContext('var window = this; var global = this;', ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

head('the wrappers are installed even when nobody is signed in yet');
var w = makeWorld();
boot(w);
ok('admOpen was wrapped at load time (before any sign-in)', typeof w.admOpen === 'function' && w.admOpen.__f27 === true);
ok('admMenuApply was wrapped at load time', typeof w.admMenuApply === 'function' && w.admMenuApply.__f27 === true);
w.admMenuApply();
ok('with nobody signed in, no edition tile is shown', w.els.admTileNav.innerHTML.indexOf('data-section="free2027"') < 0 && w.els.admTileNav.innerHTML.indexOf('data-section="websitemode"') < 0);
ok('the original console sections are still all there', ['overview', 'students', 'questions'].every(function (k) { return w.els.admTileNav.innerHTML.indexOf('data-section="' + k + '"') > -1; }));

head('after sign-in the menu repaint adds the tiles for the right role');
w.admMe = { id: 'GOC-A-002', roleKey: 'academic-director' };
w.admMenuApply();
ok('the Academic Director sees 2027 Free Tutorial Management', w.els.admTileNav.innerHTML.indexOf('data-section="free2027"') > -1, w.els.admTileNav.innerHTML.slice(-200));
ok('but NOT Website Mode Control (Founder only)', w.els.admTileNav.innerHTML.indexOf('data-section="websitemode"') < 0);
w.admMe = { id: 'GOC-A-001', roleKey: 'founder' };
w.admMenuApply();
ok('the Founder sees 2027 Free Tutorial Management', w.els.admTileNav.innerHTML.indexOf('data-section="free2027"') > -1);
ok('AND the separate Website Mode Control', w.els.admTileNav.innerHTML.indexOf('data-section="websitemode"') > -1);
ok('a repaint does not duplicate the tiles', (w.els.admTileNav.innerHTML.match(/data-section="free2027"/g) || []).length === 1 && (w.els.admTileNav.innerHTML.match(/data-section="websitemode"/g) || []).length === 1);

head('opening the functions');
w.admOpen('free2027');
ok('the Free Tutorial tile opens the programme panel', /2027 Free Tutorial Management/.test(w.els.admSheetBody.innerHTML) && w.els.admSheetTitle.textContent === '2027 Free Tutorial Management', w.els.admSheetTitle.textContent);
w.admOpen('websitemode');
ok('the Website Mode Control tile opens its own separate panel', /Website Mode Control/.test(w.els.admSheetBody.innerHTML) && w.els.admSheetTitle.textContent === 'Website Mode Control', w.els.admSheetTitle.textContent);
w.admOpen('students');
ok('the original sections still open through the wrapper', /original section: students/.test(w.els.admSheetBody.innerHTML));
w.admMe = { id: 'GOC-A-002', roleKey: 'academic-director' };
var before = w.els.admSheetBody.innerHTML;
w.admOpen('websitemode');
ok('the Academic Director is refused Website Mode Control', w.els.admSheetBody.innerHTML === before && w.toasts.some(function (t) { return /Founder only/.test(t); }), w.toasts.join('|'));
w.admOpen('free2027');
ok('but still gets Free Tutorial Management', /2027 Free Tutorial Management/.test(w.els.admSheetBody.innerHTML));

setTimeout(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}, 300);
