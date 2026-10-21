/* test-tutors-stats.js — Phase 3C slice 5, part 3: the per-question and per-topic counters and the
   ranking rules (no server, no screen).   node test/test-tutors-stats.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function row(id, topic, given, correct, extra) {
  var r = { questionId: id, topic: topic, subject: 'Chemistry', kind: 'objective', given: given, isCorrect: correct };
  for (var k in (extra || {})) r[k] = extra[k];
  return r;
}

console.log('\nrecording answers');
var stats = {};
core.recordAnswerStats(stats, 'Chemistry', [row('Q1', 'Acids', 1, true), row('Q1', 'Acids', 2, false), row('Q2', 'Salts', 0, false)]);
ok('each answer adds to its question and its topic', stats.Chemistry.q.Q1.n === 2 && stats.Chemistry.q.Q1.c === 1 && stats.Chemistry.t.Acids.n === 2 && stats.Chemistry.t.Salts.c === 0, JSON.stringify(stats));
ok('it changes the object it is given and returns it', core.recordAnswerStats(stats, 'Chemistry', []) === stats);
ok('an unanswered row is not counted', (function () {
  var s = core.recordAnswerStats({}, 'Chemistry', [row('Q1', 'Acids', null, false), row('Q1', 'Acids', '', false)]);
  return !Object.keys(s).length;
})());
ok('a theory row (no verdict yet) is not counted', (function () {
  var s = core.recordAnswerStats({}, 'Chemistry', [row('Q9', 'Acids', 'an essay', null, { kind: 'theory' })]);
  return !Object.keys(s).length;
})());
ok('a row with its own subject is filed under it; none falls back to the subject given', (function () {
  var s = core.recordAnswerStats({}, 'Chemistry', [row('P1', 'Waves', 1, true, { subject: 'Physics' }), { questionId: 'C1', topic: 'Acids', given: 1, isCorrect: true }]);
  return s.Physics.q.P1.n === 1 && s.Chemistry.q.C1.n === 1;
})());
ok('a missing topic still counts the question', (function () {
  var s = core.recordAnswerStats({}, 'Chemistry', [{ questionId: 'C1', given: 1, isCorrect: true }]);
  return s.Chemistry.q.C1.n === 1 && Object.keys(s.Chemistry.t).length === 0;
})());
ok('nothing but counts is stored: no ID, name or time', (function () {
  var s = JSON.stringify(core.recordAnswerStats({}, 'Chemistry', [row('Q1', 'Acids', 1, true, { scholarId: 'GOC-S-001', studentName: 'Ada' })]));
  return !/GOC-S|Ada|ts|time/i.test(s.replace(/Acids|Chemistry/g, ''));
})());
ok('hostile keys cannot poison the counters', (function () {
  var s = core.recordAnswerStats({}, 'Chemistry', [row('__proto__', '__proto__', 1, true), row('constructor', 'prototype', 1, true), row('Q1', 'Ok', 1, true)]);
  return ({}).n === undefined && Object.keys(s.Chemistry.q).join() === 'Q1' && Object.keys(s.Chemistry.t).join() === 'Ok';
})());
ok('damaged stored counters are repaired, not fatal', (function () {
  var s = core.recordAnswerStats({ Chemistry: { q: 5, t: null } }, 'Chemistry', [row('Q1', 'Acids', 1, true)]);
  return s.Chemistry.q.Q1.n === 1 && s.Chemistry.t.Acids.c === 1;
})());
ok('junk rows and a missing list do not crash', (function () {
  core.recordAnswerStats({}, 'Chemistry', [null, 3, {}, 'x']); core.recordAnswerStats(null, 'Chemistry', null); return true;
})());

console.log('\nweak topics');
function topics(map) { var t = {}; Object.keys(map).forEach(function (k) { t[k] = { n: map[k][0], c: map[k][1] }; }); return { t: t, q: {} }; }
var wt = core.rankWeakTopics(topics({ Acids: [20, 5], Salts: [10, 9], Gases: [30, 15], Rare: [9, 0], Tied1: [10, 5], Tied2: [40, 20] }));
ok('lowest percent right comes first', wt.items[0].topic === 'Acids' && wt.items[0].percent === 25, JSON.stringify(wt.items));
ok('a topic under 10 answers is not ranked, even at 0%', wt.items.every(function (x) { return x.topic !== 'Rare'; }));
ok('the hidden count says how many were left out', wt.hidden === 1 && wt.minAnswers === 10);
ok('exactly 10 answers is ranked', wt.items.some(function (x) { return x.topic === 'Salts'; }));
ok('a tie goes to the topic with more answers, then the name', (function () {
  var o = wt.items.map(function (x) { return x.topic; });
  return o.indexOf('Tied2') < o.indexOf('Gases') && o.indexOf('Gases') < o.indexOf('Salts') && o.indexOf('Tied2') < o.indexOf('Tied1');
})());
ok('only the weakest five are shown by default', core.rankWeakTopics(topics({ A: [10, 1], B: [10, 2], C: [10, 3], D: [10, 4], E: [10, 5], F: [10, 6], G: [10, 7] })).items.length === 5);
ok('a limit can be given, and zero shows none', core.rankWeakTopics(topics({ A: [10, 1], B: [10, 2] }), 1).items.length === 1 && core.rankWeakTopics(topics({ A: [10, 1] }), 0).items.length === 0);
ok('impossible counters are skipped (more right than given)', core.rankWeakTopics(topics({ Bad: [10, 11], Good: [10, 5] })).items.length === 1);
ok('no counters at all is an empty list, not an error', core.rankWeakTopics(null).items.length === 0 && core.rankWeakTopics({}).hidden === 0);
ok('each item is only a topic and counts', Object.keys(wt.items[0]).sort().join() === 'answers,correct,percent,topic');

console.log('\nhardest questions');
var bank = [
  { id: 'Q1', subject: 'Chemistry', kind: 'objective', section: 'objective', topic: 'Acids', text: 'What is pH 7?' },
  { id: 'Q2', subject: 'Chemistry', kind: 'objective', section: 'practice', topic: 'Salts', text: 'A'.repeat(300) },
  { id: 'Q3', subject: 'Chemistry', kind: 'objective', section: 'objective', topic: 'Gases', text: 'Q3 text', active: false },
  { id: 'Q4', subject: 'Chemistry', kind: 'objective', section: 'objective', topic: 'Gases', text: 'Q4 text', status: 'pending' },
  { id: 'P1', subject: 'Physics', kind: 'objective', section: 'objective', topic: 'Waves', text: 'Physics one' },
  { id: 'Q5', subject: 'Chemistry', kind: 'objective', section: 'objective', topic: 'Acids', text: 'Q5 text' },
  { id: 'Q6', subject: 'Chemistry', kind: 'objective', section: 'objective', topic: 'Acids', text: 'Q6 text', status: 'live' },
  { id: 'T1', subject: 'Chemistry', kind: 'theory', section: 'theory', topic: 'Acids', text: 'An essay' }
];
var qs = { q: { Q1: { n: 12, c: 3 }, Q2: { n: 10, c: 2 }, Q3: { n: 50, c: 0 }, Q4: { n: 50, c: 0 }, P1: { n: 50, c: 0 }, GONE: { n: 50, c: 0 }, Q5: { n: 9, c: 0 }, Q6: { n: 20, c: 3 }, T1: { n: 50, c: 0 } }, t: {} };
var hq = core.rankHardestQuestions(qs, 'Chemistry', bank);
var ids = hq.items.map(function (x) { return x.id; });
ok('the ones most often missed come first', ids.join() === 'Q6,Q2,Q1', ids.join());
ok('a switched-off, pending, deleted, theory or other-subject question never appears', ['Q3', 'Q4', 'GONE', 'T1', 'P1'].every(function (id) { return ids.indexOf(id) < 0; }));
ok('a question under 10 answers is not ranked but is counted as hidden', ids.indexOf('Q5') < 0 && hq.hidden === 1, hq.hidden);
ok('a question with no status counts as live, one marked live too', ids.indexOf('Q1') > -1 && ids.indexOf('Q6') > -1);
ok('long text is shortened', (function () { var t = hq.items.filter(function (x) { return x.id === 'Q2'; })[0].text; return t.length === 240 && /\.\.\.$/.test(t); })());
ok('each item carries the question, topic, section and counts only', Object.keys(hq.items[2]).sort().join() === 'answers,correct,id,percent,section,text,topic');
ok('at most ten are shown', (function () {
  var b = [], q = { q: {}, t: {} };
  for (var i = 0; i < 15; i++) { b.push({ id: 'X' + i, subject: 'Chemistry', kind: 'objective', text: 't' }); q.q['X' + i] = { n: 10 + i, c: 1 }; }
  return core.rankHardestQuestions(q, 'Chemistry', b).items.length === 10;
})());
ok('an empty bank or no counters is an empty list', core.rankHardestQuestions(qs, 'Chemistry', []).items.length === 0 && core.rankHardestQuestions(null, 'Chemistry', bank).items.length === 0);
ok('nothing passed in is changed', (function () {
  var a = JSON.stringify([qs, bank, stats]); core.rankHardestQuestions(qs, 'Chemistry', bank); core.rankWeakTopics(qs); return a === JSON.stringify([qs, bank, stats]);
})());

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
