/* test-free2027-admin-results.js — the 2027 Free Tutorial results navigation.
 *
 * ROOT CAUSE THIS PINS: loadResults() used to auto-open the first activity
 * whenever any paper had been submitted, so the "← All results" button (which
 * calls f27AdmTab('results')) bounced the administrator straight back into that
 * one competition and the complete listing could never be reached. The listing
 * must always render, must contain BOTH kinds, and each category must show only
 * its own records.
 *
 * node test/test-free2027-admin-results.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var src = fs.readFileSync(path.join(APP, 'js', 'free2027-admin.js'), 'utf8');
var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));

var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 260) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function El(id) {
  this.id = id;
  this.innerHTML = '';
  this.textContent = '';
  this.hidden = false;
  this.classList = { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } };
}
El.prototype.insertAdjacentHTML = function (w, h) { this.innerHTML += h; };
El.prototype.querySelectorAll = function () { return []; };
El.prototype.getAttribute = function () { return null; };
El.prototype.setAttribute = function () {};
El.prototype.focus = function () {};

var ACTIVITIES = [
  { id: 'F27-Q1', title: 'UTME Cup One', kind: 'competition', attempts: 3 },
  { id: 'F27-Q2', title: 'Week 1 Assessment', kind: 'weekly', attempts: 2 },
  { id: 'F27-Q3', title: 'UTME Cup Two', kind: 'competition', attempts: 1 },
  { id: 'F27-Q4', title: 'Week 2 Assessment', kind: 'weekly', attempts: 4 },
  { id: 'F27-Q5', title: 'Never Sat', kind: 'weekly', attempts: 0 }
];

function makeWorld() {
  var els = {
    admTileNav: new El('admTileNav'), admSheetBody: new El('admSheetBody'),
    admSheetBack: new El('admSheetBack'), admSheet: new El('admSheet'),
    admSheetTitle: new El('admSheetTitle'), f27ModeBody: new El('f27ModeBody'),
    f27AdmBody: new El('f27AdmBody'), f27AdmTabs: new El('f27AdmTabs')
  };
  var calls = [];
  var world = {
    console: console, mode: 'free2027', calls: calls,
    document: {
      readyState: 'complete',
      getElementById: function (id) { return els[id] || null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    admMe: { id: 'GOC-A-001', roleKey: 'founder' },
    toast: function () {}, confirm: function () { return true; },
    Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Math: Math, JSON: JSON,
    GOC: {
      free2027: rules,
      free: {
        adminActivities: function () {
          calls.push(['adminActivities']);
          return Promise.resolve({ activities: ACTIVITIES.map(function (a) { return Object.assign({}, a); }) });
        },
        activityResults: function (id) {
          calls.push(['activityResults', id]);
          var a = ACTIVITIES.filter(function (x) { return x.id === id; })[0];
          if (!a) return Promise.reject({ message: 'not found' });
          return Promise.resolve({
            activity: { id: a.id, title: a.title, kind: a.kind, leaderboard: { approved: false, published: false }, publicNow: false },
            rows: [{ name: 'Ada Obi', participantId: 'GOC-F-001', course: 'Law', score: 300, maxScore: 400,
              timeUsedSec: 1200, submittedAt: 1700000000000, rank: 1, attemptId: 'F27-A1-abc', autoSubmitted: false }]
          });
        },
        attemptDetail: function (id) {
          calls.push(['attemptDetail', id]);
          return Promise.resolve({
            attempt: { id: id, activityId: 'F27-Q1', responses: { 'CQ-001': 1 }, score: 300, maxScore: 400,
              timeUsedSec: 1200, submittedAt: 1700000000000, autoSubmitted: false },
            participant: { name: 'Ada Obi', id: 'GOC-F-001' },
            activity: { title: 'UTME Cup One' }
          });
        }
      }
    }
  };
  world.admMenuApply = function () { els.admTileNav.innerHTML = ''; };
  world.admOpen = function (s) { els.admSheetBody.innerHTML = '<div>original: ' + s + '</div>'; };
  world.window = world;
  world.els = els;
  return world;
}
function boot(w) {
  var ctx = vm.createContext(w);
  vm.runInContext('var window = this; var global = this;', ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
function settle() { return new Promise(function (r) { setTimeout(r, 30); }); }
function html(w) { return w.els.f27AdmBody.innerHTML; }
function openIds(h) {
  var out = [], m, re = /f27AdmResults\('([^']+)'\)/g;
  while ((m = re.exec(h))) out.push(m[1]);
  return out;
}

(async function () {
  var w = makeWorld();
  boot(w);

  head('The results tab opens the COMPLETE listing, not one activity');
  w.f27AdmTab('results');
  await settle();
  ok('the listing is rendered instead of an activity detail', /Open results/.test(html(w)), html(w).slice(0, 200));
  ok('no single activity was auto-opened', w.calls.filter(function (c) { return c[0] === 'activityResults'; }).length === 0,
    JSON.stringify(w.calls));
  ok('both competitions are listed', openIds(html(w)).indexOf('F27-Q1') > -1 && openIds(html(w)).indexOf('F27-Q3') > -1,
    JSON.stringify(openIds(html(w))));
  ok('both weekly assessments are listed too', openIds(html(w)).indexOf('F27-Q2') > -1 && openIds(html(w)).indexOf('F27-Q4') > -1,
    JSON.stringify(openIds(html(w))));
  ok('an activity nobody has sat is not offered', openIds(html(w)).indexOf('F27-Q5') < 0);
  ok('each row is labelled with its kind', /Competition/.test(html(w)) && /Weekly/.test(html(w)));

  head('Opening a competition and pressing "All results" returns to the listing');
  w.f27AdmResults('F27-Q1');
  await settle();
  ok('the competition detail opens', /UTME Cup One/.test(html(w)) && /All results/.test(html(w)), html(w).slice(0, 200));
  ok('the detail still offers the Paper action', /f27AdmAttempt\('F27-A1-abc'\)/.test(html(w)));
  ok('the back button targets the results tab', /f27AdmTab\('results'\)/.test(html(w)));
  /* This is the exact reported bug: the button calls f27AdmTab('results'). */
  w.f27AdmTab('results');
  await settle();
  ok('pressing All results returns to the complete listing', /Open results/.test(html(w)) &&
    openIds(html(w)).length === 4, html(w).slice(0, 220));
  ok('and does not bounce back into the competition', !/Submitted papers/.test(html(w)), html(w).slice(0, 200));
  ok('weekly results are reachable from that listing', openIds(html(w)).indexOf('F27-Q2') > -1);

  head('Moving between the two categories shows the correct records');
  w.f27AdmResultsKind('competition');
  await settle();
  ok('the competition category shows only competitions',
    openIds(html(w)).join(',') === 'F27-Q1,F27-Q3', JSON.stringify(openIds(html(w))));
  w.f27AdmResultsKind('weekly');
  await settle();
  ok('the weekly category shows only weekly assessments',
    openIds(html(w)).join(',') === 'F27-Q2,F27-Q4', JSON.stringify(openIds(html(w))));
  ok('the selected category is marked as pressed', /aria-pressed="true"/.test(html(w)));
  w.f27AdmResultsKind('all');
  await settle();
  ok('All results restores both kinds', openIds(html(w)).length === 4, JSON.stringify(openIds(html(w))));
  w.f27AdmResultsKind('nonsense');
  await settle();
  ok('an unknown category falls back to the complete listing', openIds(html(w)).length === 4);

  head('A weekly result opens independently and returns the same way');
  w.f27AdmResults('F27-Q2');
  await settle();
  ok('the weekly detail opens', /Week 1 Assessment/.test(html(w)), html(w).slice(0, 160));
  ok('a weekly assessment still has no public board controls',
    !/Approve board/.test(html(w)) && /no public board/.test(html(w)), html(w).slice(0, 200));
  w.f27AdmTab('results');
  await settle();
  ok('All results works from a weekly result too', openIds(html(w)).length === 4);

  head('Result details and Paper viewing are unchanged');
  w.f27AdmResults('F27-Q3');
  await settle();
  ok('a competition still offers the board controls it had',
    /Approve board/.test(html(w)) && /Publish board/.test(html(w)) && /Unpublish/.test(html(w)));
  ok('the submitted row and its rank are still shown', /GOC-F-001/.test(html(w)) && /#1/.test(html(w)));
  w.f27AdmAttempt('F27-A1-abc');
  await settle();
  ok('the Paper view still opens', /Ada Obi/.test(html(w)) && /300 \/ 400/.test(html(w)), html(w).slice(0, 200));
  ok('and offers a way back to that activity results page', /f27AdmResults\('F27-Q1'\)/.test(html(w)));
  ok('the stored answers are still displayed', /CQ-001/.test(html(w)));

  head('Nothing in the navigation writes to a submitted record');
  ok('only read endpoints were called',
    w.calls.every(function (c) { return ['adminActivities', 'activityResults', 'attemptDetail'].indexOf(c[0]) > -1; }),
    JSON.stringify(w.calls.map(function (c) { return c[0]; })));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});