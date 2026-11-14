/* test-onboarding-console.js — Stage 7: Founder/Manager console tours.

   Proves:
     1. each role's tour is generated from the very sections
        GOC.core.consoleSectionsFor() allows that role — the Founder
        tours everything, and no manager's tour contains a section
        outside their role (tutors/managers/access included);
     2. a console journey really navigates: go('admin') then admOpen()
        per section, spotlighting the opened panel;
     3. persistence is per manager, and the wiring (header Tour button,
        first-entry hook, admOpen's own guard) is intact.
   Run:  node test/test-onboarding-console.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var mod = require(path.join(APP, 'js', 'onboarding.js'));
var core = require(path.join(APP, 'js', 'goc-core.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 170) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var ROLES = [
  ['GOC-A-001', 'founder'],
  ['GOC-A-002', 'academic-director'],
  ['GOC-A-101', 'finance'],
  ['GOC-A-102', 'publicity'],
  ['GOC-A-103', 'student-affairs']
];

head('tours are generated from each role\u2019s real permissions');
ROLES.forEach(function (r) {
  var allowed = core.consoleSectionsFor(r[0], r[1]);
  var steps = mod.consoleSteps(allowed);
  var toured = steps.filter(function (s) { return s.adm; }).map(function (s) { return s.adm; });
  ok(r[1] + ': tour covers exactly its ' + allowed.length + ' allowed sections, in console order',
    toured.join(',') === mod.CONSOLE_ORDER.filter(function (s) { return allowed.indexOf(s) >= 0; }).join(','),
    toured.join(','));
  ok(r[1] + ': every toured section exists in the copy map with friendly copy',
    toured.every(function (s) { return mod.CONSOLE_COPY[s] && mod.CONSOLE_COPY[s][1].length > 30; }));
});
var founderSteps = mod.consoleSteps(core.consoleSectionsFor('GOC-A-001', 'founder'));
ok('the Founder tours all sections including Tutors, Managers and Access',
  ['tutors', 'managers', 'access', 'cohorts'].every(function (s) {
    return founderSteps.some(function (x) { return x.adm === s; });
  }));
[['academic-director', ['tutors', 'managers', 'access']], ['finance', ['questions', 'tutors', 'theorymark']], ['publicity', ['questions', 'theorymark', 'access']], ['student-affairs', ['questions', 'tutors', 'managers']]].forEach(function (pair) {
  var steps = mod.consoleSteps(core.consoleSectionsFor('GOC-A-200', pair[0]));
  ok(pair[0] + ': restricted sections are never in the tour (' + pair[1].join(', ') + ')',
    pair[1].every(function (s) { return !steps.some(function (x) { return x.adm === s; }); }),
    steps.filter(function (x) { return x.adm; }).map(function (x) { return x.adm; }).join(','));
});
ok('every section step opens its section and targets the opened panel', founderSteps.filter(function (s) { return s.adm; }).every(function (s) {
  return s.go === 'admin' && s.target === 'admSheetBody';
}));
ok('the tour opens and closes on the role-filtered tile menu', founderSteps[0].target === 'admTileNav'
  && founderSteps[founderSteps.length - 1].target === 'admTileNav');

head('a console journey really navigates');
function fakeEl() {
  var el = { children: [], style: {}, textContent: '', className: '', disabled: false, _vis: false, parentNode: null };
  el.appendChild = function (c) { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = function (c) { el.children = el.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
  el.addEventListener = function () {}; el.removeEventListener = function () {};
  el.setAttribute = function () {}; el.focus = function () {};
  el.getBoundingClientRect = function () { return el._vis ? { left: 10, top: 10, width: 300, height: 200, bottom: 210 } : { left: 0, top: 0, width: 0, height: 0, bottom: 0 }; };
  return el;
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

(async function () {
  var store = {};
  var navLog = [];
  var els = { admTileNav: fakeEl(), admSheetBody: fakeEl() };
  els.admTileNav._vis = true;
  var body = fakeEl();
  var env = {
    document: { body: body, getElementById: function (id) { return els[id] || null; }, createElement: function () { return fakeEl(); }, addEventListener: function () {}, removeEventListener: function () {} },
    storage: { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = String(v); } },
    getElementById: function (id) { return els[id] || null; },
    isVisible: function (el) { return !!el && el._vis; },
    go: function (id) { navLog.push('go:' + id); },
    call: function (name, arg) { navLog.push(name + ':' + arg); els.admSheetBody._vis = true; },
    viewportWidth: function () { return 1440; }, viewportHeight: function () { return 900; }
  };
  var tour = mod.create(env);
  var allowed = core.consoleSectionsFor('GOC-A-002', 'academic-director');
  tour.register('console', tour.consoleSteps(allowed));
  await tour.start('console', { userId: 'GOC-A-002' });
  var guard = 0;
  while (tour.current() && tour.current().index < tour.steps('console').length && guard++ < 40) { await tour.next(); await tick(3); }
  var opens = navLog.filter(function (n) { return n.indexOf('admOpen:') === 0; }).map(function (n) { return n.slice(8); });
  ok('each section was really opened, in tour order', opens.join(',') === allowed.filter(function (s) { return mod.CONSOLE_ORDER.indexOf(s) >= 0; }).sort(function (a, b) { return mod.CONSOLE_ORDER.indexOf(a) - mod.CONSOLE_ORDER.indexOf(b); }).join(','), opens.join(','));
  ok('no restricted section was opened for the Academic Director', opens.indexOf('tutors') < 0 && opens.indexOf('managers') < 0 && opens.indexOf('access') < 0);
  await tour.next();
  ok('completion persists per manager', tour.state('console', 'GOC-A-002').status === 'done'
    && (await tour.maybeAutoStart('console', 'GOC-A-002')) === false);
  ok('another manager is a fresh tour, not the Director\u2019s', (await tour.maybeAutoStart('console', 'GOC-A-101')) === true);
  await tour.exit();

  head('wiring and guards');
  ok('the console header carries the Tour replay button', /onclick="tourConsoleStart\(\)"/.test(index));
  ok('tour generation reads the same permission rule as the menu', /consoleSectionsFor\(admMe\.id, admMe\.roleKey\)/.test(app) && /register\('console', window\.GOCOnboarding\.consoleSteps\(allowed\)\)/.test(app));
  ok('first console entry offers the tour once per manager', /tourConsoleAuto\(\)/.test(app) && /maybeAutoStart\('console', admMe\.id\)/.test(app));
  ok('admOpen still refuses sections outside the role', /consoleSectionAllowed\(section, admMe\.id, admMe\.roleKey\)/.test(app));
  ok('the tour never calls a mutating console action', founderSteps.every(function (s) {
    return !/admSave|admDelete|admRemove|admCreate|fetch|GOC\.api/.test(JSON.stringify(s));
  }));

  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'onboarding (console): all checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL  journey error: ' + (e && e.stack || e)); process.exit(1); });
