/* test-past-years.js — Phase 3, past questions by year, slice 1: the year on a
   question and the pure rules for listing and serving it.
   node test/test-past-years.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('cleanQuestionYear');
ok('blank, null and undefined mean "not a past question"', [undefined, null, '', '  '].every(function (v) { return core.cleanQuestionYear(v).year === null && !core.cleanQuestionYear(v).error; }));
ok('a four-digit year is kept as a number', core.cleanQuestionYear('2019').year === 2019 && core.cleanQuestionYear(2005).year === 2005);
ok('surrounding spaces are tolerated', core.cleanQuestionYear(' 2011 ').year === 2011);
ok('the first UTME year and the ceiling are accepted', core.cleanQuestionYear(1978).year === 1978 && core.cleanQuestionYear(2100).year === 2100);
['1977', '2101', '19', '20199', 'abc', '2019.5', '-2019', '0'].forEach(function (v) {
  ok('"' + v + '" is refused with a message', !!core.cleanQuestionYear(v).error && core.cleanQuestionYear(v).year === undefined);
});

head('validateQuestion carries the year');
function q(extra) {
  return Object.assign({ subject: 'Physics', section: 'practice', topic: 'Motion', text: 'What is the SI unit of force?',
    options: ['Joule', 'Newton', 'Watt'], answer: 1 }, extra || {});
}
ok('a question without a year stores year: null', core.validateQuestion(q()).rec.year === null);
ok('a question with a year stores it', core.validateQuestion(q({ year: '2018' })).rec.year === 2018);
ok('a bad year is an error, not a silent drop', /four digits/.test(core.validateQuestion(q({ year: '18' })).error || ''));
ok('an out-of-range year is an error', /between 1978 and 2100/.test(core.validateQuestion(q({ year: 1901 })).error || ''));
var merged = core.validateQuestion(Object.assign({}, core.validateQuestion(q({ year: 2018 })).rec, { year: '' }));
ok('editing a question and blanking the year clears it', merged.rec && merged.rec.year === null);
var th = core.validateQuestion({ subject: 'Physics', section: 'theory', text: 'Explain the idea of inertia fully.', expected: 'A body stays at rest or in uniform motion unless acted on.', maxMark: 5, year: 2015 });
ok('a theory question never keeps a year', th.rec && th.rec.year === null && !core.isPastQuestion(th.rec));
ok('a JAMB-oriented question never keeps a year, and a bad one is not an error there',
   core.validateQuestion(q({ section: 'jamb', year: 2018 })).rec.year === null && !core.validateQuestion(q({ section: 'jamb', year: 'abc' })).error);
ok('an Objective question never keeps a year either', core.validateQuestion(q({ section: 'objective', year: 2018 })).rec.year === null);

head('which questions count as past questions');
function rec(id, o) { return Object.assign({ id: id, subject: 'Physics', kind: 'objective', section: 'practice', active: true, year: 2018 }, o || {}); }
ok('live, objective and dated: yes', core.isPastQuestion(rec(1)));
ok('no year: no', !core.isPastQuestion(rec(2, { year: null })) && !core.isPastQuestion(rec(3, { year: undefined })));
ok('switched off: no', !core.isPastQuestion(rec(4, { active: false })));
ok('theory: no', !core.isPastQuestion(rec(5, { kind: 'theory' })));
ok('junk: no', !core.isPastQuestion(null) && !core.isPastQuestion({}));
ok('only the Practice section counts (Objective and JAMB-oriented never do)', core.isPastQuestion(rec(6, { section: 'practice' })) && ['objective', 'jamb'].every(function (s) { return !core.isPastQuestion(rec(6, { section: s })); }));

head('pastYears and pastQuestions');
var bank = [
  rec(1, { year: 2018 }), rec(2, { year: 2018 }), rec(3, { year: 2019 }), rec(4, { year: 2015 }),
  rec(5, { year: 2018, active: false }), rec(6, { year: null }), rec(7, { year: 2018, kind: 'theory' }),
  rec(8, { subject: 'Chemistry', year: 2018 }), rec(9, { subject: 'Chemistry', year: 2012 })
];
ok('years are listed newest first with live counts', JSON.stringify(core.pastYears(bank, 'Physics')) === '[{"year":2019,"count":1},{"year":2018,"count":2},{"year":2015,"count":1}]', JSON.stringify(core.pastYears(bank, 'Physics')));
ok('each subject has its own years', JSON.stringify(core.pastYears(bank, 'Chemistry')) === '[{"year":2018,"count":1},{"year":2012,"count":1}]');
ok('a subject with none gives an empty list', core.pastYears(bank, 'Biology').length === 0 && core.pastYears(null, 'Physics').length === 0);
ok('one year returns only that subject and year, live and objective, in bank order', core.pastQuestions(bank, 'Physics', 2018).map(function (x) { return x.id; }).join() === '1,2');
ok('the year may be passed as text', core.pastQuestions(bank, 'Physics', '2019').length === 1);
ok('a year with nothing returns an empty list', core.pastQuestions(bank, 'Physics', 1999).length === 0);

head('cleanYearList and multi-year pools');
ok('a list of years is cleaned, de-duplicated and sorted newest first', JSON.stringify(core.cleanYearList([2018, '2019', 2018]).years) === '[2019,2018]');
ok('a single year or blank is accepted', core.cleanYearList(2018).years.join() === '2018' && core.cleanYearList('').years.length === 0 && core.cleanYearList(undefined).years.length === 0);
ok('one bad year refuses the list', /four digits/.test(core.cleanYearList([2018, 'x']).error || ''));
var mb = [rec(1, { year: 2018 }), rec(2, { year: 2019 }), rec(3, { year: 2020 }), rec(4, { year: null })];
ok('studyPool takes several years', core.studyPool(mb, 'Physics', null, [2018, 2020]).map(function (x) { return x.id; }).join() === '1,3');

head('forPractice carries the year');
var fp = core.forPractice(rec(1, { text: 'x?', options: ['a', 'b'], answer: 0 }), 0);
ok('a dated practice question is served with its year', fp.year === 2018);
ok('an undated one, or a non-practice one, carries none',
   core.forPractice(rec(2, { year: null, options: ['a', 'b'], answer: 0 }), 0).year === undefined &&
   core.forPractice(rec(3, { section: 'jamb', options: ['a', 'b'], answer: 0 }), 0).year === undefined);

head('studyPool and studyYears narrow Practice by topic and year');
var pb = [
  rec(1, { topic: 'Motion', year: 2018 }), rec(2, { topic: 'Heat', year: 2018 }), rec(3, { topic: 'Motion', year: 2019 }),
  rec(4, { topic: 'Motion', year: null }), rec(5, { topic: 'Motion', year: 2018, section: 'jamb' }), rec(6, { topic: 'Heat', year: 2018, active: false })
];
function ids(a) { return a.map(function (x) { return x.id; }).join(); }
ok('no narrowing: every live objective question in the subject', ids(core.studyPool(pb, 'Physics', null)) === '1,2,3,4,5');
ok('topics narrow it', ids(core.studyPool(pb, 'Physics', ['Motion'])) === '1,3,4,5');
ok('a year narrows to that Practice paper only', ids(core.studyPool(pb, 'Physics', null, 2018)) === '1,2');
ok('topic and year together', ids(core.studyPool(pb, 'Physics', ['Motion'], 2018)) === '1');
ok('studyYears lists newest first with a per-topic split',
   JSON.stringify(core.studyYears(pb, 'Physics')) === '[{"year":2019,"count":1,"topics":{"Motion":1}},{"year":2018,"count":2,"topics":{"Motion":1,"Heat":1}}]',
   JSON.stringify(core.studyYears(pb, 'Physics')));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
