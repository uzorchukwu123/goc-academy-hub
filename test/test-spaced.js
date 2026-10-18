/* test-spaced.js — Phase 2, spaced repetition slice 1: the pure core logic.
   node test/test-spaced.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name); } }
var DAY = 86400000, NOW = 1000 * DAY;
function m(key, ts) { return { key: key, id: 1, text: 'Q' + key, options: ['a', 'b'], answer: 0, given: 1, ts: ts }; }

console.log('\nSchedule');
ok('intervals are 1, 3, 7, 14, 30 days', core.SR_INTERVALS_DAYS.join() === '1,3,7,14,30');
var e = core.srAfterAnswer(null, true, NOW);
ok('first correct review: box 1, due in 3 days', e.box === 1 && e.due === NOW + 3 * DAY && !e.mastered && e.last === NOW);
e = core.srAfterAnswer(e, true, NOW);
ok('correct again: box 2, 7 days', e.box === 2 && e.due === NOW + 7 * DAY);
e = core.srAfterAnswer(e, true, NOW);
ok('box 3, 14 days', e.box === 3 && e.due === NOW + 14 * DAY);
e = core.srAfterAnswer(e, true, NOW);
ok('box 4, 30 days', e.box === 4 && e.due === NOW + 30 * DAY && !e.mastered);
e = core.srAfterAnswer(e, true, NOW);
ok('correct at the top box retires it', e.mastered === true && e.due === null);
var w = core.srAfterAnswer({ box: 3, due: 5, last: 5 }, false, NOW);
ok('wrong goes back to box 0, due in 1 day', w.box === 0 && w.due === NOW + DAY && !w.mastered);
ok('wrong on a fresh mistake: box 0', core.srAfterAnswer(null, false, NOW).box === 0);
ok('junk entry is safe', core.srAfterAnswer({ box: 'x' }, true, NOW).box === 1 && core.srAfterAnswer({ box: 99 }, true, NOW).mastered === true);

console.log('\nWhen is a mistake due');
ok('fresh mistake is due 1 day after it was made', core.srDueAt(m('a', NOW - DAY), {}) === NOW && core.srDueAt(m('a', NOW), null) === NOW + DAY);
var st = { a: { box: 1, due: NOW + 3 * DAY, last: NOW, mastered: false } };
ok('reviewed mistake uses its stored due date', core.srDueAt(m('a', NOW - 5 * DAY), st) === NOW + 3 * DAY);
ok('mastered mistake has no due date', core.srDueAt(m('a', 1), { a: { box: 4, due: null, last: NOW, mastered: true } }) === null);
ok('a mistake made again after the last review starts over', core.srDueAt(m('a', NOW + 1), st) === NOW + 1 + DAY);

console.log('\nQueue');
var list = [m('old', NOW - 10 * DAY), m('new', NOW - 2 * DAY), m('today', NOW), m('done', NOW - 40 * DAY), m('later', NOW - 20 * DAY)];
var state = {
  done: { box: 4, due: null, last: NOW - DAY, mastered: true },
  later: { box: 2, due: NOW + 5 * DAY, last: NOW - DAY, mastered: false }
};
var q = core.srQueue(list, state, NOW);
ok('due ones come most overdue first', q.due.map(function (x) { return x.key; }).join() === 'old,new');
ok('counts: 2 due, 2 upcoming, 1 mastered', q.dueCount === 2 && q.upcoming === 2 && q.mastered === 1);
ok('next due is the soonest future date', q.nextDue === NOW + DAY);
ok('rows keep the question and carry box and dueAt', q.due[0].text === 'Qold' && q.due[0].box === 0 && q.due[0].dueAt === NOW - 9 * DAY);
var many = []; for (var i = 0; i < 25; i++) many.push(m('k' + i, NOW - 5 * DAY));
var qm = core.srQueue(many, {}, NOW);
ok('a session is capped at ' + core.SR_SESSION_CAP + ' but dueCount is the true total', qm.due.length === core.SR_SESSION_CAP && qm.dueCount === 25);
ok('explicit cap works', core.srQueue(many, {}, NOW, 3).due.length === 3);
var empty = core.srQueue(null, null, NOW);
ok('empty and junk input are safe', empty.dueCount === 0 && empty.due.length === 0 && empty.nextDue === null && core.srQueue([null, {}], {}, NOW).dueCount === 0);

console.log('\nStoring');
var s1 = core.srStore({}, 'a', { box: 1, due: 1, last: 1 });
var s2 = core.srStore(s1, 'b', { box: 0, due: 2, last: 2 });
ok('store returns a new object and leaves the old one alone', s1.b === undefined && s2.a && s2.b && s1 !== s2);
var big = {}; for (var j = 0; j < core.SR_STATE_CAP; j++) big['k' + j] = { box: 0, due: 1, last: 100 + j };
var capped = core.srStore(big, 'fresh', { box: 0, due: 1, last: 9999 });
ok('state is capped, keeping the most recently reviewed', Object.keys(capped).length === core.SR_STATE_CAP && capped.fresh && !capped.k0 && capped['k' + (core.SR_STATE_CAP - 1)]);
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
