/* test-mistakes.js — Phase 2 first slice: core.mistakesFromRuns.
   node test/test-mistakes.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name); } }
function row(id, given, isCorrect) {
  return { id: id, subject: 'Physics', topic: 'Motion', text: 'Q' + id, options: ['a', 'b'], answer: 0, given: given, isCorrect: isCorrect, explanation: '' };
}
var runs = [
  { ts: 2, review: [row(1, 1, false), row(2, null, false), row(3, 0, true)] },
  { ts: 1, review: [row(1, 1, false), row(4, 1, false)] }
];
var m = core.mistakesFromRuns(runs);
ok('keeps wrong answers only, skips skipped and correct', m.length === 2);
ok('duplicate across runs appears once, newest first', m[0].id === 1 && m[0].ts === 2 && m[1].id === 4);
ok('cap is respected', core.mistakesFromRuns(runs, 1).length === 1);
ok('empty and bad input are safe', core.mistakesFromRuns(null).length === 0 && core.mistakesFromRuns([null, {}]).length === 0);

/* Slice 6: Web Test attempts */
function arow(qid, kind, given, isCorrect) {
  return { questionId: qid, kind: kind, topic: 'Waves', text: 'W' + qid, options: ['a', 'b'], answer: 0, given: given, isCorrect: isCorrect, explanation: 'e' };
}
var attempts = [
  { status: 'marked', subject: 'Physics', submittedAt: 5, review: [arow(10, 'objective', 1, false), arow(11, 'objective', 0, true), arow(12, 'objective', null, false), arow(13, 'theory', 'text', null)] },
  { status: 'awaiting-marking', subject: 'Physics', submittedAt: 6, review: [arow(14, 'objective', 1, false)] }
];
var am = core.mistakesFromAttempts(attempts);
ok('attempts: only wrong objective answers in marked papers', am.length === 1 && am[0].id === 10 && am[0].subject === 'Physics' && am[0].ts === 5);
ok('attempts: bad input is safe', core.mistakesFromAttempts(null).length === 0 && core.mistakesFromAttempts([null, {}]).length === 0);
var merged = core.mergeMistakes([m, am]);
ok('merge: newest first across sources', merged.length === 3 && merged[0].id === 10 && merged[1].id === 1 && merged[2].id === 4);
var dup = core.mergeMistakes([m, core.mistakesFromAttempts([{ status: 'marked', subject: 'Physics', submittedAt: 9, review: [arow(1, 'objective', 1, false)] }])]);
ok('merge: same question once, newest sighting wins', dup.filter(function (x) { return x.id === 1; }).length === 1 && dup[0].ts === 9);
ok('merge: cap and empty input', core.mergeMistakes([m, am], 2).length === 2 && core.mergeMistakes(null).length === 0);
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
