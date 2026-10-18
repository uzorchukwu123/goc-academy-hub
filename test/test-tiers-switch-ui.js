/* test-tiers-switch-ui.js — Phase 3B, slice 3: each student row in Console -> Students shows the
   access badge, the who-and-when note, and the right button (Make GOC student / Restrict to Open);
   making GOC goes straight through, restricting asks first.   node test/test-tiers-switch-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}

var calls = [], toasts = [], confirms = [], answer = true, reloaded = 0, failNext = null;
var sandbox = {
  GOC: { core: core, api: { setStudentTier: function (id, t) {
    calls.push([id, t]);
    return failNext ? Promise.reject(new Error(failNext)) : Promise.resolve({ id: id, tier: t });
  } } },
  studentsData: [], admStuFilter: 'all', admTierFilter: 'any', revealed: {}, admCohortsCache: [],
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  initials: function (n) { return String(n).split(' ').map(function (p) { return p[0]; }).join(''); },
  confirm: function (m) { confirms.push(m); return answer; },
  toast: function (m) { toasts.push(m); },
  loadStudents: function () { reloaded++; return Promise.resolve(); },
  Promise: Promise, String: String, Date: Date
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('admCredHTML') + '\n' + grab('admSetTier'), ctx);

function row(o) {
  return Object.assign({ id: 'GOC-S-001', name: 'Ada Eze', last: 'Today', tag: 'g', tl: 'Active', active: true, xp: 10, level: 1, performance: 50 }, o);
}
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };

(async function () {
  console.log('\nrow for an Open student');
  sandbox.studentsData = [row({ tier: 'open' })];
  var h = sandbox.admCredHTML();
  ok('shows an Open badge', /class="ad-tier open">Open</.test(h), h.slice(0, 300));
  ok('offers Make GOC student, not Restrict', /admSetTier\('GOC-S-001','goc'\)">Make GOC student</.test(h) && !/Restrict to Open/.test(h));
  ok('no note when nothing has been recorded', !/ad-tiernote/.test(h));

  console.log('\nrow for a GOC student, with a record of the change');
  sandbox.studentsData = [row({ tier: 'goc', tierChangedBy: 'Itsemeh Victorian', tierChangedAt: '2026-10-08T13:05:00.000Z' })];
  h = sandbox.admCredHTML();
  ok('shows a GOC badge', /class="ad-tier goc">GOC student</.test(h));
  ok('offers Restrict to Open, not Make GOC', /admSetTier\('GOC-S-001','open'\)">Restrict to Open</.test(h) && !/Make GOC student/.test(h));
  ok('shows who changed it and when (Nigeria time)', /ad-tiernote">Changed by Itsemeh Victorian/.test(h) && /14:05/.test(h), h.slice(h.indexOf('ad-tiernote') - 5, h.indexOf('ad-tiernote') + 120));
  sandbox.studentsData = [row({ tier: 'goc', tierChangedBy: '<b>x</b>', tierChangedAt: '2026-10-08T13:05:00.000Z' })];
  ok('a name is escaped, never injected', !/<b>x<\/b>/.test(sandbox.admCredHTML()));
  sandbox.studentsData = [row({})];
  ok('a student with no tier sent reads as Open (fail closed)', /ad-tier open/.test(sandbox.admCredHTML()));
  sandbox.studentsData = [row({ tier: 'open', active: false, tl: 'Closed', tag: 'r' })];
  ok('a deactivated account can still be switched', /Make GOC student/.test(sandbox.admCredHTML()));

  console.log('\nMake GOC: no confirm');
  sandbox.studentsData = [row({ tier: 'open' })];
  calls.length = 0; toasts.length = 0; confirms.length = 0; reloaded = 0;
  sandbox.admSetTier('GOC-S-001', 'goc'); await tick(); await tick();
  ok('the server is asked straight away, with no confirm', calls.length === 1 && calls[0][0] === 'GOC-S-001' && calls[0][1] === 'goc' && confirms.length === 0);
  ok('the list reloads and a toast says so', reloaded === 1 && /GOC-S-001 is now a GOC student/.test(toasts[0] || ''), toasts[0]);

  console.log('\nRestrict to Open: confirm first');
  sandbox.studentsData = [row({ tier: 'goc' })];
  calls.length = 0; toasts.length = 0; confirms.length = 0; reloaded = 0; answer = false;
  sandbox.admSetTier('GOC-S-001', 'open'); await tick();
  ok('the confirm names the student and the permanent loss', confirms.length === 1 && /Ada Eze \(GOC-S-001\)/.test(confirms[0]) && /cannot be undone/.test(confirms[0]), confirms[0]);
  ok('cancelling asks the server nothing and reloads nothing', calls.length === 0 && reloaded === 0 && toasts.length === 0);
  answer = true;
  sandbox.admSetTier('GOC-S-001', 'open'); await tick(); await tick();
  ok('confirming restricts', calls.length === 1 && calls[0][1] === 'open' && reloaded === 1 && /now Open/.test(toasts[0] || ''), toasts[0]);

  console.log('\na refusal is shown, not hidden');
  failNext = 'The access tier could not be saved.'; toasts.length = 0; reloaded = 0;
  sandbox.admSetTier('GOC-S-001', 'goc'); await tick(); await tick();
  ok('the server\'s message reaches the toast and nothing claims success', toasts.length === 1 && /could not be saved/.test(toasts[0]) && reloaded === 0, toasts[0]);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})();
