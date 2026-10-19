/* test-passage-run.js — Phase 3, comprehension passages, slice 3: a run keeps a
   passage and its questions together and lands on the cap, as the real UTME does.
   node test/test-passage-run.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var nextId = 1;
function solo(n, topic) { var a = []; for (var i = 0; i < n; i++) a.push({ id: nextId++, subject: 'Use of English', topic: topic || 'Lexis', passageId: null }); return a; }
function grp(pid, n) { var a = []; for (var i = 0; i < n; i++) a.push({ id: nextId++, subject: 'Use of English', topic: 'Comprehension', passageId: pid }); return a; }
function seeded(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function whole(picked, pid, size) { var m = picked.filter(function (q) { return q.passageId === pid; }); return m.length === 0 || m.length === size; }
function contiguous(picked, pid) {
  var at = []; picked.forEach(function (q, i) { if (q.passageId === pid) at.push(i); });
  return at.length < 2 || at[at.length - 1] - at[0] === at.length - 1;
}

head('cap of 10, one 5-question passage, plenty of standalone');
var bank = grp(1, 5).concat(solo(30));
var allExact = true, allWhole = true, allIn = true;
for (var s = 1; s <= 40; s++) {
  var p = core.pickStudy(bank, 10, seeded(s));
  if (p.length !== 10) allExact = false;
  if (!whole(p, 1, 5) || !contiguous(p, 1)) allWhole = false;
  if (new Set(p.map(function (q) { return q.id; })).size !== p.length) allIn = false;
}
ok('every run is exactly 10', allExact);
ok('the passage is never split and sits as one block', allWhole);
ok('no question appears twice', allIn);
var always = true; for (s = 1; s <= 40; s++) if (!core.pickStudy(bank, 10, seeded(s)).some(function (q) { return q.passageId === 1; })) always = false;
ok('a passage that fits is always placed first, as in the real paper', always);
var b1 = grp(1, 5).concat(grp(2, 5)).concat(solo(30)), seenP = {};
for (s = 1; s <= 40; s++) core.pickStudy(b1, 5, seeded(s)).forEach(function (q) { if (q.passageId) seenP[q.passageId] = true; });
ok('with two passages and room for one, either can be the one used', seenP[1] && seenP[2]);

head('a passage that would overshoot is skipped, not split');
var b2 = grp(1, 7).concat(solo(20));
var skipped = true;
for (s = 1; s <= 20; s++) { var q2 = core.pickStudy(b2, 5, seeded(s)); if (q2.length !== 5 || q2.some(function (q) { return q.passageId; })) skipped = false; }
ok('cap 5, passage of 7, standalone available: exactly 5, no passage', skipped);

head('cap 10 with passages of 4 and 7 and standalone to fill');
var b3 = grp(1, 4).concat(grp(2, 7)).concat(solo(15));
var exact3 = true, whole3 = true;
for (s = 1; s <= 40; s++) { var q3 = core.pickStudy(b3, 10, seeded(s)); if (q3.length !== 10) exact3 = false; if (!whole(q3, 1, 4) || !whole(q3, 2, 7)) whole3 = false; }
ok('always exactly 10', exact3);
ok('both passages always arrive whole or not at all', whole3);

head('fallback when there is no standalone left');
var b4 = grp(1, 4).concat(grp(2, 7));
var q4 = core.pickStudy(b4, 10, seeded(3));
ok('cap 10 from passages of 4 and 7: the 4 goes in, the 7 would overshoot by 1 and is taken whole',
   q4.length === 11 && whole(q4, 1, 4) && whole(q4, 2, 7), String(q4.length));
var b5 = grp(1, 12);
var q5 = core.pickStudy(b5.concat(solo(2)), 4, seeded(1));
ok('a gap too big to overshoot is left short, never filled by splitting or a huge passage', q5.length === 2 && q5.every(function (q) { return !q.passageId; }), String(q5.length));
ok('a pool of only one large passage still serves it rather than nothing', core.pickStudy(b5, 5, seeded(1)).length === 12);

head('nothing changes without passages');
var plain = solo(12);
ok('no linked questions: same exact count as before', core.pickStudy(plain, 7, seeded(2)).length === 7);
ok('asking for more than exist returns the lot', core.pickStudy(bank, 99, seeded(2)).length === bank.length);

head('objectivePaper keeps the exact paper size');
var ob = grp(1, 6).concat(solo(80)).map(function (q) { q.active = true; q.kind = 'objective'; q.section = 'objective'; return q; });
var paper = core.objectivePaper(ob, ['Use of English'], null, seeded(9));
ok('English paper is the full 60 with the passage whole', paper.length === 60 && whole(paper, 1, 6) && contiguous(paper, 1), String(paper.length));

head('practice: a passage is fresh or stale as a whole');
var pb = grp(1, 4).concat(solo(10));
var recent = [pb[0].id];   // one question of the passage was served recently
var all = true;
for (s = 1; s <= 20; s++) {
  var pp = core.pickPractice(pb, 6, recent, seeded(s));
  if (pp.some(function (q) { return q.passageId === 1; })) all = false;
}
ok('with enough fresh standalone, a recently-seen passage waits entirely', all);

head('fresh-first jamb draw treats a passage as one unit');
var jb = grp(1, 3).concat(grp(2, 3)).concat(solo(10)).map(function (q) { q.active = true; q.kind = 'objective'; q.section = 'jamb'; return q; });
var seen = {}; seen[jb[0].id] = 1;
var jp = core.jambPaper(jb, ['Use of English'], { 'Use of English': 8 }, seeded(4), seen);
ok('exactly the 8 asked for, passages whole', jp.length === 8 && whole(jp, 1, 3) && whole(jp, 2, 3), String(jp.length));
ok('the passage with a seen question is not drawn while fresher ones fill the paper', !jp.some(function (q) { return q.passageId === 1; }));

head('servablePool and the passage riding with the question');
var passages = [{ id: 1, subject: 'Use of English', active: true, title: 'T', text: 'x' }];
var sp = core.servablePool([{ id: 1, subject: 'Use of English', passageId: 1 }, { id: 2, subject: 'Use of English', passageId: 9 }, { id: 3, subject: 'Use of English', passageId: null }], passages);
ok('questions with a missing passage are held out', sp.map(function (q) { return q.id; }).join() === '1,3');
var shown = core.attachPassages([{ id: 1, subject: 'Use of English', kind: 'objective', options: ['a', 'b'], passageId: 1, answer: 0 }], passages).map(core.forStudent)[0];
ok('the student copy carries the passage and still no answer', shown.passage && shown.passage.title === 'T' && shown.answer === undefined);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
