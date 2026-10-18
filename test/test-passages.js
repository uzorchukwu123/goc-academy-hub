/* test-passages.js — Phase 3, comprehension passages, slice 1: the passage record
   and the pure rules for linking questions to it.
   node test/test-passages.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var TEXT = 'The river had risen overnight, and by morning the whole village stood at its edge, watching the water carry away the old footbridge.';
function P(extra) { return Object.assign({ subject: 'Use of English', title: 'The Flood', text: TEXT }, extra || {}); }

head('validatePassage');
var good = core.validatePassage(P());
ok('a complete passage is accepted and live by default', good.rec && good.rec.active === true && good.rec.title === 'The Flood');
ok('the text is trimmed and Windows line breaks are normalised', core.validatePassage(P({ text: '  ' + TEXT + '\r\nSecond line.  ' })).rec.text.indexOf('\r') === -1);
ok('it can be saved switched off', core.validatePassage(P({ active: false })).rec.active === false);
ok('the id is carried through for an edit', core.validatePassage(P({ id: 7 })).rec.id === 7);
ok('a subject outside the academy is refused', !!core.validatePassage(P({ subject: 'Latin' })).error);
ok('a missing title is refused', /title/i.test(core.validatePassage(P({ title: ' ' })).error || ''));
ok('a title with stray spacing is tidied', core.validatePassage(P({ title: '  The   Flood ' })).rec.title === 'The Flood');
ok('an over-long title is refused', /under 120/.test(core.validatePassage(P({ title: new Array(130).join('a') })).error || ''));
ok('a passage too short to set questions on is refused', /too short/.test(core.validatePassage(P({ text: 'Too short.' })).error || ''));
ok('a passage over the ceiling is refused', /too long/.test(core.validatePassage(P({ text: new Array(8100).join('a') })).error || ''));
ok('nothing at all is refused, not thrown', !!core.validatePassage(null).error && !!core.validatePassage(undefined).error);

head('cleanPassageId');
ok('blank, null and undefined mean "no passage"', [undefined, null, '', '  '].every(function (v) { return core.cleanPassageId(v).passageId === null && !core.cleanPassageId(v).error; }));
ok('a number or numeric text is kept as a number', core.cleanPassageId(12).passageId === 12 && core.cleanPassageId(' 3 ').passageId === 3);
['0', '-1', 'abc', '1.5', '12345678901'].forEach(function (v) {
  ok('"' + v + '" is refused with a message', !!core.cleanPassageId(v).error);
});

head('validateQuestion carries the passage link');
function q(extra) {
  return Object.assign({ subject: 'Use of English', section: 'objective', topic: 'Comprehension', text: 'What did the villagers watch?',
    options: ['The footbridge being swept away', 'A parade', 'A market'], answer: 0 }, extra || {});
}
ok('a question with no passage stores passageId: null', core.validateQuestion(q()).rec.passageId === null);
ok('an objective question keeps its passage link', core.validateQuestion(q({ passageId: '4' })).rec.passageId === 4);
ok('a JAMB-oriented question may use a passage', core.validateQuestion(q({ section: 'jamb', passageId: 4 })).rec.passageId === 4);
ok('a practice question may use a passage', core.validateQuestion(q({ section: 'practice', passageId: 4 })).rec.passageId === 4);
ok('a bad link is an error, not a silent drop', /chosen from the list/.test(core.validateQuestion(q({ passageId: 'x' })).error || ''));
ok('editing a question and blanking the link clears it',
   core.validateQuestion(Object.assign({}, core.validateQuestion(q({ passageId: 4 })).rec, { passageId: '' })).rec.passageId === null);
var th = core.validateQuestion({ subject: 'Physics', section: 'theory', text: 'Explain the idea of inertia fully.', expected: 'A body stays at rest unless acted on.', maxMark: 5, passageId: 4 });
ok('a theory question never keeps a passage, and a bad link is not an error there', th.rec && th.rec.passageId === null);

head('passageServable');
var passages = [
  { id: 1, subject: 'Use of English', active: true }, { id: 2, subject: 'Use of English', active: false }, { id: 3, subject: 'Biology', active: true }
];
function rq(id, pid, o) { return Object.assign({ id: id, subject: 'Use of English', passageId: pid }, o || {}); }
ok('a question with no passage is always servable', core.passageServable(rq(1, null), passages) && core.passageServable(rq(2, undefined), []));
ok('a live passage in the same subject is servable', core.passageServable(rq(3, 1), passages));
ok('a switched-off passage holds its questions back', !core.passageServable(rq(4, 2), passages));
ok('a missing passage holds its questions back', !core.passageServable(rq(5, 99), passages));
ok('a passage from another subject holds them back', !core.passageServable(rq(6, 3), passages));
ok('no passages at all holds a linked question back', !core.passageServable(rq(7, 1), null));

head('groupByPassage');
var list = [rq(1, null), rq(2, 1), rq(3, null), rq(4, 5), rq(5, 1), rq(6, 5), rq(7, 1)];
ok('questions on one passage are brought together at its first appearance',
   core.groupByPassage(list).map(function (x) { return x.id; }).join() === '1,2,5,7,3,4,6');
ok('questions with no passage keep their order', core.groupByPassage([rq(1, null), rq(2, null), rq(3, null)]).map(function (x) { return x.id; }).join() === '1,2,3');
ok('an empty or missing list is an empty list', core.groupByPassage([]).length === 0 && core.groupByPassage(null).length === 0);
ok('the original list is not reordered', list.map(function (x) { return x.id; }).join() === '1,2,3,4,5,6,7');

head('attachPassages');
var full = [
  { id: 1, subject: 'Use of English', active: true, title: 'The Flood', text: TEXT },
  { id: 2, subject: 'Use of English', active: false, title: 'Gone', text: TEXT }
];
var att = core.attachPassages([rq(1, 1), rq(2, 2), rq(3, null), rq(4, 9)], full);
ok('a question carries its live passage title and text', att[0].passage && att[0].passage.title === 'The Flood' && att[0].passage.text === TEXT);
ok('only the id, title and text travel', JSON.stringify(Object.keys(att[0].passage).sort()) === '["id","text","title"]');
ok('a switched-off, absent or unneeded passage attaches nothing', !att[1].passage && !att[2].passage && !att[3].passage);
ok('the stored question is not changed', rq(1, 1).passage === undefined && att[0] !== undefined);

head('passageLinkError');
var pl = [{ id: 1, subject: 'Use of English' }];
ok('no link is no error', core.passageLinkError({ subject: 'Use of English', passageId: null }, pl) === null);
ok('a real passage in the same subject is fine', core.passageLinkError({ subject: 'Use of English', passageId: 1 }, pl) === null);
ok('a missing passage is named', /no longer exists/.test(core.passageLinkError({ subject: 'Use of English', passageId: 5 }, pl)));
ok('a passage from another subject is named', /belongs to Use of English, not Biology/.test(core.passageLinkError({ subject: 'Biology', passageId: 1 }, pl)));

head('importCSV and passages');
var HDR = core.CSV_QUESTION_HEADER;
ok('the header ends with the optional passageId column', /,year,passageId$/.test(HDR), HDR);
var row = function (pid) { return 'Use of English,objective,Comprehension,"Who stood at the river edge?",Villagers,A farmer,A king,,,A,,,easy,,yes,,' + pid + '\n'; };
var withP = core.importCSV('questions', HDR + '\n' + row(1), null, [], pl);
ok('a row naming a real passage imports with the link', withP.records.length === 1 && withP.records[0].passageId === 1, JSON.stringify(withP.errors));
var ghost = core.importCSV('questions', HDR + '\n' + row(9), null, [], pl);
ok('a row naming a missing passage is reported by line and skipped', ghost.records.length === 0 && ghost.errors.length === 1 && /no longer exists/.test(ghost.errors[0].error), JSON.stringify(ghost.errors));
var none = core.importCSV('questions', HDR + '\n' + row(''), null, [], pl);
ok('a row with no passage imports as before', none.records.length === 1 && none.records[0].passageId === null);

head('passageUsage');
var use = core.passageUsage([rq(1, 1), rq(2, 1), rq(3, 2), rq(4, 1, { active: false }), rq(5, null)]);
ok('live questions are counted per passage; off and unlinked ones are not', use[1] === 2 && use[2] === 1 && use[3] === undefined, JSON.stringify(use));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
