/* test-jamb-score.js — Phase 3, JAMB-style score out of 400: the pure rule
   (core.jambScore) and the screens that show it.   node test/test-jamb-score.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* A marked paper: rows[subject] = [correct, asked]. Unanswered rows are wrong (isCorrect false). */
function paper(spec, status) {
  var answers = [], id = 0;
  Object.keys(spec).forEach(function (sub) {
    for (var i = 0; i < spec[sub][1]; i++) answers.push({ questionId: ++id, topic: 'T', subject: sub, kind: 'objective',
      given: i < spec[sub][0] ? 0 : null, isCorrect: i < spec[sub][0], markAwarded: i < spec[sub][0] ? 1 : 0, maxMark: 1 });
  });
  return { section: 'jamb', status: status || 'marked', answers: answers };
}
var FULL = { 'Use of English': [45, 60], 'Physics': [30, 40], 'Chemistry': [20, 40], 'Mathematics': [40, 40] };

head('the rule');
var js = core.jambScore(paper(FULL));
ok('four subjects each out of 100, scaled proportionally', js && js.subjects.map(function (s) { return s.score; }).join() === '75,75,50,100', JSON.stringify(js));
ok('the total is the sum, out of 400', js.total === 300 && js.max === 400);
ok('subjects come in the academy order, English first', js.subjects[0].subject === 'Use of English' && js.subjects.length === 4);
ok('it carries correct and asked per subject', js.subjects[0].correct === 45 && js.subjects[0].asked === 60);
ok('it is always labelled an estimate', js.estimate === true);
var odd = core.jambScore(paper({ 'Use of English': [20, 60], 'Physics': [1, 3], 'Chemistry': [0, 40], 'Mathematics': [40, 40] }));
ok('scores round to whole marks (1/3 -> 33)', odd.subjects[1].score === 33 && odd.subjects[2].score === 0, JSON.stringify(odd.subjects));
var blank = paper({ 'Use of English': [0, 60], 'Physics': [0, 40], 'Chemistry': [0, 40], 'Mathematics': [0, 40] });
ok('an empty paper scores 0 / 400, not null', core.jambScore(blank).total === 0);
var blankFill = paper({ 'Use of English': [30, 60], 'Physics': [20, 40], 'Chemistry': [20, 40], 'Mathematics': [20, 40] });
ok('unanswered counts as wrong (30 right of 60 asked = 50, not 100)', core.jambScore(blankFill).subjects[0].score === 50);

head('refused, never inflated');
ok('a paper with only three subjects is refused', core.jambScore(paper({ 'Use of English': [30, 60], 'Physics': [20, 40], 'Chemistry': [20, 40] })) === null);
ok('five subjects is refused', core.jambScore(paper({ 'Use of English': [30, 60], 'Physics': [20, 40], 'Chemistry': [20, 40], 'Mathematics': [20, 40], 'Biology': [20, 40] })) === null);
ok('four subjects without English is refused', core.jambScore(paper({ 'Physics': [1, 2], 'Chemistry': [1, 2], 'Mathematics': [1, 2], 'Biology': [1, 2] })) === null);
ok('an unmarked paper is refused', core.jambScore(paper(FULL, 'awaiting-marking')) === null);
var old = paper(FULL); old.answers.forEach(function (r) { delete r.subject; });
ok('an older attempt whose rows name no subject is refused', core.jambScore(old) === null);
var th = paper(FULL); th.answers[0].kind = 'theory';
ok('a paper with a theory row is refused', core.jambScore(th) === null);
ok('null, empty and junk are refused', core.jambScore(null) === null && core.jambScore({}) === null && core.jambScore({ status: 'marked', answers: [] }) === null);

head('marking records the subject on every answer row');
var qs = [{ id: 1, subject: 'Physics', topic: 'a', kind: 'objective', answer: 0 }, { id: 2, subject: 'Use of English', topic: 'b', kind: 'objective', answer: 1 }];
var m = core.markAttempt(qs, { 1: 0 });
ok('objective rows carry the subject', m.answers[0].subject === 'Physics' && m.answers[1].subject === 'Use of English');
ok('and the unanswered one is not correct', m.answers[1].isCorrect === false);

head('the student result screen');
function grab(name) {
  var i = app.indexOf('function ' + name + '('), depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
}
function fakeEl() { var el = { children: [], innerHTML: '', className: '', appendChild: function (c) { el.children.push(c); return c; } }; return el; }
var hosts = { wtrStats: fakeEl() };
var sb = { document: { getElementById: function (id) { return hosts[id] || null; }, createElement: fakeEl },
  esc: function (x) { return String(x); }, mmss: function () { return '10:00'; }, String: String, Math: Math, Number: Number };
var ctx = vm.createContext(sb);
vm.runInContext(grab('wtPaintStats'), ctx);
function stats(r) { hosts.wtrStats.children = []; sb.wtPaintStats(r, r.status === 'marked', Math.round(r.percent || 0));
  return hosts.wtrStats.children.map(function (c) { return c.innerHTML; }).join('|'); }
var base = { total: 180, answered: 150, unanswered: 30, correct: 135, wrong: 15, score: 135, maxScore: 180, percent: 75, status: 'marked', timeUsedSec: 600 };
var withJ = stats(Object.assign({ section: 'jamb', jambScore: js }, base));
ok('a JAMB-oriented result shows "300 / 400"', /JAMB-style score<\/span><b>300 \/ 400/.test(withJ), withJ.slice(0, 400));
ok('and the four subject scores out of 100', /Use of English<\/span><b>75 \/ 100/.test(withJ) && /Mathematics<\/span><b>100 \/ 100/.test(withJ));
ok('and says it is an estimate, not a prediction', /not a prediction/.test(withJ));
ok('the percentage is still there', /Percentage<\/span><b>75%/.test(withJ));
var plain = stats(Object.assign({ section: 'objective' }, base));
ok('an Objective result keeps its current display, no /400', !/\/ 400|JAMB-style/.test(plain));
var noJ = stats(Object.assign({ section: 'jamb' }, base));
ok('a JAMB-oriented result that could not be scored shows no figure', !/\/ 400/.test(noJ));

head('the console');
sb.SUBJECT_META = {}; sb.admPeriodLabel = function () { return 'Test'; }; sb.wtSectionLabel = function (s) { return s; };
sb.wtWhen = function () { return 'today'; }; sb.admCompletion = function () { return 'Completed'; };
vm.runInContext(grab('jambScoreText') + '\n' + grab('admRRowHTML'), ctx);
var rowJ = sb.admRRowHTML(Object.assign({ id: 'A1', scholarId: 'GOC-1', studentName: 'Ada', section: 'jamb', subject: 'All subjects', jambScore: js }, base));
ok('the console row leads with "300 / 400"', /300 \/ 400 · 135\/180 · 75%/.test(rowJ), rowJ);
var rowO = sb.admRRowHTML(Object.assign({ id: 'A2', scholarId: 'GOC-1', studentName: 'Ada', section: 'objective', subject: 'All subjects' }, base));
ok('an Objective row is unchanged', !/400/.test(rowO) && /135\/180 · 75%/.test(rowO));
ok('the one-line text lists each subject', /Use of English 75 · Physics 75 · Chemistry 50 · Mathematics 100/.test(sb.jambScoreText(js, true)));
ok('no score gives no text', sb.jambScoreText(null) === '');

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
