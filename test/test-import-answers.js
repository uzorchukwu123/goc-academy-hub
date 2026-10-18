/* test-import-answers.js — Phase 3E.C slice 1: an imported objective question keeps the
   answer its author meant, so the correct option and the explanation agree.
   Pure core logic only.   node test/test-import-answers.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c, extra) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }

var HEAD = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active\n';
/* one objective row; opts is five cells (blank allowed), ans is the answer cell */
function row(opts, ans, text) {
  return 'Mathematics,objective,Algebra,"' + (text || 'Pick one.') + ' Which option is correct here?",' + opts.join(',') + ',' + ans + ',,,medium,"Because."' + ',yes\n';
}
function run(csv) { return core.importCSV('questions', HEAD + csv, null, [], []); }
function one(opts, ans, text) { var r = run(row(opts, ans, text)); return { rec: r.records[0], err: r.errors[0] && r.errors[0].error, r: r }; }

/* letters: plain, lowercase, every position */
['A', 'B', 'C', 'D'].forEach(function (L, i) {
  var o = one(['red', 'green', 'blue', 'amber', ''], L, 'Colour ' + L);
  ok('letter ' + L + ' points at option ' + (i + 1), o.rec && o.rec.answer === i);
});
ok('lowercase letter is read', one(['red', 'green', 'blue', 'amber', ''], 'c', 'q lower').rec.answer === 2);

/* a blank middle option no longer shifts the letter */
var gap = one(['red', '', 'blue', 'amber', ''], 'C', 'gap C');
ok('blank optionB: answer C is still "blue"', gap.rec && gap.rec.options[gap.rec.answer] === 'blue', JSON.stringify(gap.rec && gap.rec.options) + ' ' + (gap.rec && gap.rec.answer));
var gapD = one(['red', '', 'blue', 'amber', ''], 'D', 'gap D');
ok('blank optionB: answer D is still "amber"', gapD.rec && gapD.rec.options[gapD.rec.answer] === 'amber');
var gapB = one(['red', '', 'blue', 'amber', ''], 'B', 'gap B');
ok('answer naming an empty cell is refused with a reason', !gapB.rec && /empty/.test(gapB.err || ''), gapB.err);

/* numbers: the value-versus-position clash is refused, not guessed */
var clash = one(['2', '4', '6', '8', ''], '4', 'clash');
ok('answer 4 beside options 2,4,6,8 is refused', !clash.rec && /could mean/.test(clash.err || ''), clash.err);
ok('the refusal tells the author to use a letter', /letter/.test(clash.err || ''));
var same = one(['1', '2', '3', '4', ''], '2', 'same');
ok('answer 2 beside options 1,2,3,4 means the same either way', same.rec && same.rec.answer === 1);
var big = one(['10', '20', '30', '40', ''], '20', 'big');
ok('answer 20 beside 10,20,30,40 is the text', big.rec && big.rec.answer === 1);
var pos = one(['10', '20', '30', '40', ''], '3', 'pos');
ok('answer 3 beside 10,20,30,40 is option 3', pos.rec && pos.rec.answer === 2);
var posGap = one(['red', '', 'blue', 'amber', ''], '3', 'pos gap');
ok('column number 3 with a blank optionB is still "blue"', posGap.rec && posGap.rec.options[posGap.rec.answer] === 'blue');

/* text answers */
var txt = one(['Paris', 'Rome', 'Oslo', 'Bern', ''], 'oslo', 'text');
ok('answer written as the option text, any case', txt.rec && txt.rec.answer === 2);
var dup = one(['same', 'same', 'other', 'third', ''], 'same', 'dup');
ok('two options with the answer wording are refused', !dup.rec && /same wording/.test(dup.err || ''), dup.err);
var dupL = one(['same', 'same', 'other', 'third', ''], 'B', 'dup letter');
ok('...but a letter settles it', dupL.rec && dupL.rec.answer === 1);
var letterText = one(['Paris', 'A', 'Oslo', 'Bern', ''], 'A', 'letter text');
ok('option worded "A" beside answer A is refused as unclear', !letterText.rec && /could mean/.test(letterText.err || ''), letterText.err);
var small = one(['u', 'v', 'a', 's', ''], 'A', 'small letters');
ok('options u,v,a,s with answer A is the letter A (option u)', small.rec && small.rec.answer === 0, small.err);
var small2 = one(['u', 'v', 'a', 's', ''], 'C', 'small letters 2');
ok('options u,v,a,s with answer C is option 3', small2.rec && small2.rec.answer === 2, small2.err);
var none = one(['Paris', 'Rome', 'Oslo', 'Bern', ''], 'Madrid', 'none');
ok('an answer matching nothing is refused with a reason', !none.rec && /matches none/.test(none.err || ''), none.err);
var blank = one(['Paris', 'Rome', 'Oslo', 'Bern', ''], '', 'blank');
ok('a blank answer is still refused as before', !blank.rec && /correct answer/.test(blank.err || ''), blank.err);

/* the answer and the explanation stay on the same row, and options keep file order */
var o = one(['Paris', 'Rome', 'Oslo', 'Bern', ''], 'C', 'order');
ok('options keep the order of the file', o.rec.options.join('|') === 'Paris|Rome|Oslo|Bern');
ok('the explanation stays with its question', o.rec.explanation === 'Because.');

/* one bad row does not stop the rest of the file */
var mixed = run(row(['2', '4', '6', '8', ''], '4', 'bad one') + row(['red', 'green', 'blue', 'amber', ''], 'B', 'good one'));
ok('a refused row is reported and the next row still imports', mixed.records.length === 1 && mixed.errors.length === 1 && mixed.errors[0].error.indexOf('— skipped.') > -1);

/* theory rows use the answer column as the reference answer: untouched */
var th = core.importCSV('questions', HEAD + 'Physics,theory,Motion,"State the law.",,,,,,"Force equals mass times acceleration",,10,medium,"Why.",yes\n', null, [], []);
ok('a theory row is not affected', th.records.length === 1 && th.errors.length === 0, JSON.stringify(th.errors));

/* the shipped template still imports cleanly */
var t = core.importCSV('questions', core.csvTemplate('questions'), null, [], []);
ok('the template file still imports without errors', t.errors.length === 0 && t.records.length >= 2, JSON.stringify(t.errors));

console.log(fails ? '\n' + fails + ' FAILED' : '\nimport answers: all passed');
process.exit(fails ? 1 : 0);
