/* test-passages-driver.js — Phase 3, comprehension passages, slice 2: the offline
   (demo) driver behind GOC.api behaves like server.js's /api/passages.
   node test/test-passages-driver.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var sandbox = {
  console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var A = vm.runInContext('GOC.api', ctx);
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function refused(p) { return p.then(function () { return null; }, function (e) { return e.message || 'refused'; }); }

var TEXT = 'The river had risen overnight, and by morning the whole village stood at its edge, watching the water carry away the old footbridge.';
function Q(pid, extra) {
  return Object.assign({ subject: 'Use of English', section: 'objective', topic: 'Comprehension', text: 'What did the villagers watch being carried away?',
    options: ['The old footbridge', 'A boat', 'A market'], answer: 0, passageId: pid }, extra || {});
}

(async function () {
  await A.login('GOC-A-001', 'founder2027');
  await A.unlockConsole('2027');

  head('the demo driver keeps passages');
  var p = await A.createPassage({ subject: 'Use of English', title: 'The Flood', text: TEXT });
  ok('a passage is created live with an id', p.id > 0 && p.active === true);
  ok('a bad passage is refused with its reason', /title|short/i.test(await refused(A.createPassage({ subject: 'Use of English', title: 'x', text: 'short' })) || ''));
  var q = await A.createQuestion(Q(p.id));
  ok('a question linked to it keeps the link', q.passageId === p.id);
  ok('a link to a missing passage is refused', /no longer exists/.test(await refused(A.createQuestion(Q(9999))) || ''));
  ok('a link across subjects is refused', /belongs to Use of English/.test(await refused(A.createQuestion(Q(p.id, { subject: 'Biology', topic: 'Cells' }))) || ''));
  ok('updating a question to a missing passage is refused', /no longer exists/.test(await refused(A.updateQuestion(q.id, { passageId: 9999 })) || ''));
  var lst = await A.listPassages({ subject: 'Use of English' });
  ok('the list carries how many questions use each passage', lst.passages.filter(function (x) { return x.id === p.id; })[0].questions === 1);
  ok('an active-only list leaves out a held-back passage',
     (await A.setPassageActive(p.id, false)).active === false && (await A.listPassages({ activeOnly: true })).passages.length === 0);
  await A.setPassageActive(p.id, true);

  head('subject, deletion and import protections');
  ok('the subject of a passage in use cannot change', /cannot change/.test(await refused(A.updatePassage(p.id, { subject: 'Biology' })) || ''));
  ok('its title can be edited', (await A.updatePassage(p.id, { title: 'The Great Flood' })).title === 'The Great Flood');
  ok('a live passage must be held back first', /Hold this passage back/.test(await refused(A.deletePassage(p.id)) || ''));
  await A.setPassageActive(p.id, false);
  ok('a passage still in use cannot be deleted even when held back', /still use this passage/.test(await refused(A.deletePassage(p.id)) || ''));
  var csv = A.rules.CSV_QUESTION_HEADER + '\n'
    + 'Use of English,objective,Comprehension,"Who stood at the river edge?",Villagers,A farmer,A king,,,A,,,easy,,yes,,' + p.id + '\n'
    + 'Use of English,objective,Comprehension,"What season was the flood in?",Rainy,Dry,Cold,,,A,,,easy,,yes,,9999\n';
  var imp = await A.importQuestions(csv, null, 'p.csv');
  ok('a CSV row naming a missing passage is skipped, the real one imported', imp.added === 1 && imp.skipped === 1, JSON.stringify(imp).slice(0, 160));
  await A.setQuestionActive(q.id, false); await A.deleteQuestion(q.id);
  await A.setQuestionActive(imp.ids[0], false); await A.deleteQuestion(imp.ids[0]);
  ok('once unused, the held-back passage is deleted', (await A.deletePassage(p.id)).deleted === p.id);
  ok('deleting it again is harmless', (await A.deletePassage(p.id)).alreadyGone === true);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
