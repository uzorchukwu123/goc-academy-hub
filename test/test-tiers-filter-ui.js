/* test-tiers-filter-ui.js — Phase 3B, slice 3: the Students list can be narrowed by access (Any / GOC /
   Open), together with the status filter; each cohort card can move its whole cohort (making GOC goes
   straight through, restricting asks first); the offline driver and wording agree with the server.
   node test/test-tiers-filter-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var els = { admStuTierTabs: { innerHTML: '' }, admCredList: { innerHTML: '' } };
var calls = [], toasts = [], confirms = [], answer = true, reloaded = 0, repainted = 0, failNext = null;
var sandbox = {
  GOC: { core: core, api: { setCohortTier: function (id, t) { calls.push([id, t]); return failNext ? Promise.reject(new Error(failNext)) : Promise.resolve(sandbox._reply); } } },
  document: { getElementById: function (id) { return els[id] || null; } },
  studentsData: [], admStuFilter: 'all', admTierFilter: 'any', revealed: {}, admCohortsCache: [{ cohortId: 'C1', name: 'SS3 Morning' }],
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  initials: function (n) { return String(n).split(' ').map(function (p) { return p[0]; }).join(''); },
  confirm: function (m) { confirms.push(m); return answer; }, toast: function (m) { toasts.push(m); },
  loadStudents: function () { reloaded++; return Promise.resolve(); }, admRenderCohorts: function () { repainted++; },
  _reply: null, Promise: Promise, String: String
};
var ctx = vm.createContext(sandbox);
vm.runInContext(['admCredHTML', 'admStuSetTier', 'admStuTierTabsHTML', 'admSetCohortTier'].map(grab).join('\n'), ctx);
function stu(id, tier, extra) { return Object.assign({ id: id, name: 'Student ' + id, last: 'Today', tag: 'g', tl: 'Active', active: true, xp: 1, level: 1, performance: 1, tier: tier }, extra || {}); }
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };
function names(h) { return (h.match(/GOC-S-\d+/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }); }

(async function () {
  console.log('\nthe access filter');
  sandbox.studentsData = [stu('GOC-S-001', 'goc'), stu('GOC-S-002', 'open'), stu('GOC-S-003', 'goc', { active: false, tl: 'Closed', tag: 'r' }), stu('GOC-S-004')];
  ok('the default shows everyone', names(sandbox.admCredHTML()).length === 4);
  var tabs = sandbox.admStuTierTabsHTML();
  ok('the tabs count GOC and Open, and a student with no tier counts as Open', /Any access/.test(tabs) && /GOC \(2\)/.test(tabs) && /Open \(2\)/.test(tabs), tabs);
  ok('Any access is the one marked on', /class="on" onclick="admStuSetTier\('any'\)"/.test(tabs));
  sandbox.admStuSetTier('goc');
  ok('GOC shows only GOC accounts (both, including the deactivated one)', names(els.admCredList.innerHTML).join() === 'GOC-S-001,GOC-S-003', els.admCredList.innerHTML.length);
  ok('  and the GOC tab is now the one marked on', /class="on" onclick="admStuSetTier\('goc'\)"/.test(els.admStuTierTabs.innerHTML));
  sandbox.admStuSetTier('open');
  ok('Open shows the open ones, including one with no tier stored', names(els.admCredList.innerHTML).join() === 'GOC-S-002,GOC-S-004');
  sandbox.admStuFilter = 'active'; sandbox.admStuSetTier('goc');
  ok('it combines with the status filter: Active + GOC leaves only the open-for-use GOC account', names(els.admCredList.innerHTML).join() === 'GOC-S-001');
  sandbox.admStuFilter = 'closed'; sandbox.admStuSetTier('open');
  ok('Deactivated + Open finds nothing and says exactly that', /No deactivated Open accounts\./.test(els.admCredList.innerHTML), els.admCredList.innerHTML);
  sandbox.admStuFilter = 'all'; sandbox.admStuSetTier('goc'); sandbox.studentsData = [stu('GOC-S-002', 'open')];
  ok('with only Open students, the GOC filter says "No GOC accounts"', /No GOC accounts\./.test(sandbox.admCredHTML()));
  sandbox.admStuSetTier('platinum');
  ok('an unknown value falls back to everyone', sandbox.admTierFilter === 'any');

  console.log('\nthe cohort buttons');
  sandbox.studentsData = [stu('GOC-S-001', 'goc', { cohort: 'C1' }), stu('GOC-S-002', 'open', { cohort: 'C1' }), stu('GOC-S-003', 'open', { cohort: 'C1' }), stu('GOC-S-004', 'open')];
  var cardSrc = grab('admRenderCohorts');
  ok('each cohort card with students offers Make all GOC and Restrict all to Open', /Make all GOC/.test(cardSrc) && /Restrict all to Open/.test(cardSrc) && /count > 0/.test(cardSrc));

  console.log('\nMake all GOC: no confirm');
  sandbox._reply = { changed: 2, unchanged: 1, failed: [] };
  sandbox.admSetCohortTier('C1', 'goc'); await tick(); await tick(); await tick();
  ok('the server is asked straight away, with no confirm', calls.length === 1 && calls[0][0] === 'C1' && calls[0][1] === 'goc' && confirms.length === 0);
  ok('the toast says how many moved and how many already were', /SS3 Morning: 2 students moved to GOC, 1 already was\./.test(toasts[0] || ''), toasts[0]);
  ok('the roster reloads and the cohort cards repaint', reloaded === 1 && repainted === 1);

  console.log('\nRestrict all to Open: confirm first, counting only the GOC ones');
  calls.length = 0; toasts.length = 0; confirms.length = 0; reloaded = 0; repainted = 0; answer = false;
  sandbox.admSetCohortTier('C1', 'open'); await tick();
  ok('the confirm names the cohort, the one GOC student, and the permanent loss',
     confirms.length === 1 && /1 GOC student in SS3 Morning/.test(confirms[0]) && /cannot be undone/.test(confirms[0]), confirms[0]);
  ok('cancelling asks the server nothing', calls.length === 0 && reloaded === 0);
  answer = true; sandbox._reply = { changed: 1, unchanged: 2, failed: [] };
  sandbox.admSetCohortTier('C1', 'open'); await tick(); await tick(); await tick();
  ok('confirming restricts', calls.length === 1 && calls[0][1] === 'open' && /1 student moved to Open/.test(toasts[0] || ''), toasts[0]);

  console.log('\nnothing to do, and refusals');
  calls.length = 0; toasts.length = 0; confirms.length = 0;
  sandbox.studentsData = [stu('GOC-S-001', 'open', { cohort: 'C1' })];
  sandbox.admSetCohortTier('C1', 'open'); await tick();
  ok('a cohort that is already all Open: no confirm, no request, a plain message', calls.length === 0 && confirms.length === 0 && /Everyone in SS3 Morning is already Open\./.test(toasts[0] || ''), toasts[0]);
  failNext = 'The access tier could not be saved.'; toasts.length = 0; reloaded = 0;
  sandbox.admSetCohortTier('C1', 'goc'); await tick(); await tick(); await tick();
  ok('a server refusal is shown, nothing claims success', toasts.length === 1 && /could not be saved/.test(toasts[0]) && reloaded === 0, toasts[0]);
  failNext = null;

  console.log('\nwording and the offline driver');
  ok('some failed: the message says how many and to try again', /2 could not be changed/.test(core.cohortTierMessage('X', 'goc', { changed: 1, unchanged: 0, failed: ['a', 'b'] })));
  ok('one student reads in the singular', /1 student moved to GOC\./.test(core.cohortTierMessage('X', 'goc', { changed: 1, unchanged: 0, failed: [] })));
  var fsx = require('fs');
  var sb = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' }, setTimeout: function () { return 0; }, clearTimeout: function () {},
    Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var c2 = vm.createContext(sb); vm.runInContext('window = this; self = this;', c2);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fsx.readFileSync(path.join(APP, f), 'utf8'), c2, { filename: f }); });
  var mock = vm.runInContext('GOC.api._drivers.mock', c2);
  var rej = function (p) { return p.then(function () { return null; }, function (e) { return e.message; }); };
  ok('offline: signed out is refused', !!(await rej(mock.setCohortTier('C1', 'goc'))));
  await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027');
  ok('offline: a typo is refused with the server\'s words', /Open or GOC/.test(await rej(mock.setCohortTier('C1', 'platinum')) || ''));
  ok('offline: a valid request says it needs a server, never pretends', /server connection/.test(await rej(mock.setCohortTier('C1', 'goc')) || ''));
  ok('GOC.api forwards it to both drivers', /setCohortTier/.test(fsx.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8').split('setCohortTier').length > 3 ? 'setCohortTier' : ''));

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})();
