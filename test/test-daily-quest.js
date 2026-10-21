/* test-daily-quest.js — Phase 2, daily quest slice 1: pure core logic.
   node test/test-daily-quest.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name); } }

function row(subject, topic, given, isCorrect) { return { subject: subject, topic: topic, given: given, isCorrect: isCorrect }; }
function rows(n, subject, topic, correct) { var out = []; for (var i = 0; i < n; i++) out.push(row(subject, topic, 0, i < correct)); return out; }
function at(stamp, hour) { var p = stamp.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), hour || 12).getTime(); }

var T = '2026-10-10', Y = '2026-10-09';

/* weakestTopicFromRuns */
var hist = [
  { ts: at(Y), review: rows(5, 'Physics', 'Motion', 1).concat(rows(5, 'Physics', 'Waves', 4), rows(5, 'Chemistry', 'Acids', 5)) }
];
var w = core.weakestTopicFromRuns(hist);
ok('picks the lowest-percent topic', w && w.subject === 'Physics' && w.topic === 'Motion' && w.percent === 20);
ok('no history gives null', core.weakestTopicFromRuns([]) === null && core.weakestTopicFromRuns(null) === null);
ok('a topic below the evidence minimum is ignored', core.weakestTopicFromRuns([{ review: rows(2, 'Physics', 'Motion', 0) }]) === null);
ok('skipped questions are not evidence', core.weakestTopicFromRuns([{ review: [row('Physics', 'Motion', null, false), row('Physics', 'Motion', null, false), row('Physics', 'Motion', null, false)] }]) === null);
ok('rows with no subject or topic are ignored', core.weakestTopicFromRuns([{ review: rows(5, '', 'Motion', 0).concat(rows(5, 'Physics', '', 0)) }]) === null);
var tie = core.weakestTopicFromRuns([{ review: rows(4, 'Biology', 'Cells', 2).concat(rows(6, 'Biology', 'Genetics', 3)) }]);
ok('a tie goes to the topic with more evidence', tie && tie.topic === 'Genetics');
ok('same topic name in two subjects stays separate', (function () {
  var x = core.weakestTopicFromRuns([{ review: rows(3, 'Physics', 'Energy', 3).concat(rows(3, 'Chemistry', 'Energy', 0)) }]);
  return x && x.subject === 'Chemistry';
})());
ok('bad input is safe', core.weakestTopicFromRuns([null, {}, { review: [null] }]) === null);

/* Stored review rows may carry no subject of their own: the run's subject is used. */
var bare = [{ subject: 'Physics', ts: at(Y), review: [1, 2, 3].map(function () { return { topic: 'Motion', given: 0, isCorrect: false }; }) }];
var wb = core.weakestTopicFromRuns(bare);
ok('falls back to the run subject when a row has none', wb && wb.subject === 'Physics' && wb.topic === 'Motion');
var qb = core.dailyQuest(bare.concat([{ subject: 'Physics', ts: at(T), review: [{ topic: 'Motion', given: 1, isCorrect: true }] }]), T);
ok('quest progress uses the run subject too', qb.subject === 'Physics' && qb.answered === 1);

/* dailyQuest */
var q = core.dailyQuest(hist, T);
ok('quest targets the weakest topic from earlier days', q.kind === 'weak' && q.subject === 'Physics' && q.topic === 'Motion' && q.target === 10 && q.answered === 0 && q.remaining === 10 && !q.done && q.day === T);

var withToday = hist.concat([{ ts: at(T), review: rows(4, 'Physics', 'Motion', 0).concat(rows(3, 'Chemistry', 'Acids', 3), [row('Physics', 'Motion', null, false)]) }]);
q = core.dailyQuest(withToday, T);
ok('only answered questions in the quest topic count', q.answered === 4 && q.remaining === 6 && !q.done);

var shifting = hist.concat([{ ts: at(T), review: rows(10, 'Physics', 'Motion', 10) }]);
q = core.dailyQuest(shifting, T);
ok("today's work cannot change which topic is the quest", q.topic === 'Motion' && q.answered === 10);
ok('ten answered completes it', q.done && q.remaining === 0);

q = core.dailyQuest(hist.concat([{ ts: at(T), review: rows(14, 'Physics', 'Motion', 7) }]), T);
ok('going past the target stays done, remaining never negative', q.done && q.remaining === 0 && q.answered === 14);

q = core.dailyQuest([], T);
ok('no history falls back to a plain goal', q.kind === 'any' && q.subject === null && q.topic === null && q.target === 10 && q.answered === 0);
q = core.dailyQuest([{ ts: at(T), review: rows(6, 'Biology', 'Cells', 3) }], T);
ok('plain goal counts any answered question today', q.kind === 'any' && q.answered === 6 && q.remaining === 4);

q = core.dailyQuest(hist, '2026-10-11');
ok("yesterday's answers do not count toward a new day", q.answered === 0 && q.topic === 'Motion');
q = core.dailyQuest([{ ts: at('2026-10-12'), review: rows(5, 'Physics', 'Motion', 0) }], T);
ok('runs dated after the given day are ignored', q.kind === 'any' && q.answered === 0);
q = core.dailyQuest(null, T);
ok('bad input is safe', q.kind === 'any' && q.answered === 0 && core.dailyQuest([null, {}], T).answered === 0);
ok('defaults to today without an explicit stamp', core.dailyQuest([]).day === core.dayStamp());

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
