/* Mixed Objective and marked Theory dashboard regressions. */
'use strict';
const assert = require('assert');
const core = require('../js/goc-core');
const now = Date.now();
const students = [{ id: 'S1', name: 'Ada', subjects: ['Physics'], createdAt: new Date(now - 10 * 86400000).toISOString() }];
const objective = { id: 'O1', scholarId: 'S1', subject: 'All subjects', section: 'objective', status: 'marked', percent: 100, submittedAt: now, answers: [
  { questionId: 'P1', subject: 'Physics', topic: 'Motion', kind: 'objective', given: 1, markAwarded: 1, maxMark: 1 },
  { questionId: 'P2', subject: 'Physics', topic: 'Motion', kind: 'objective', given: null, markAwarded: 0, maxMark: 1 },
  { questionId: 'C1', subject: 'Chemistry', topic: 'Secret', kind: 'objective', given: 1, markAwarded: 1, maxMark: 1 }
] };
const theory = { id: 'T1', scholarId: 'S1', subject: 'Physics', section: 'theory', status: 'marked', percent: 25, submittedAt: now, answers: [
  { questionId: 'TQ', subject: 'Physics', topic: 'Forces', kind: 'theory', given: 'Answer', markAwarded: 1, maxMark: 4 }
] };
const retired = Object.assign({}, objective, { id: 'old', section: 'jamb', subject: 'Physics', percent: 0 });
const pending = Object.assign({}, theory, { id: 'pending', status: 'awaiting-marking' });
const attempts = [objective, theory, retired, pending];
let snapshot = core.tutorSnapshot('Physics', students, {}, attempts, now);
assert.strictEqual(snapshot.tests.papers, 2); assert.strictEqual(snapshot.tests.average, 37.5);
assert.strictEqual(core.tutorActivity('Physics', students, {}, attempts, now).total.tests, 3);
let risk = core.tutorAtRisk('Physics', students, {}, attempts, now);
assert.deepStrictEqual(risk[0].reasons, ['low-average']);
assert.strictEqual(core.tutorTopPerformers('Physics', students, {}, [objective]).tests.items[0].average, 50);
let detail = core.tutorStudentDetail('Physics', students[0], [], attempts, now);
assert.strictEqual(detail.tests.average, 37.5);
assert.deepStrictEqual(detail.weakTopics.items.map(x => [x.topic, x.percent]), [['Forces', 25], ['Motion', 100]]);
assert(!JSON.stringify(detail).includes('Secret'));
const damaged = Object.assign({}, objective, { answers: objective.answers.concat([{ kind: 'objective', maxMark: 1, markAwarded: 1 }]) });
assert.strictEqual(core.tutorTopPerformers('Physics', students, {}, [damaged]).tests.items.length, 0);
assert.strictEqual(core.tutorSnapshot('Physics', students, {}, [damaged], now).active, 1);
const missing = Object.assign({}, objective, { answers: [] });
assert.strictEqual(core.tutorSnapshot('Physics', students, {}, [missing], now).tests.papers, 0);
const counters = { q: { P1: { n: 1, c: 1 } }, t: { Motion: { n: 1, c: 1 } } };
const before = JSON.stringify(counters);
const aggregate = core.tutorTheoryStats('Physics', counters, students, attempts);
assert.strictEqual(JSON.stringify(counters), before);
assert.deepStrictEqual(aggregate.t.Forces, { n: 1, c: 0.25 });
assert.strictEqual(core.rankWeakTopics(aggregate).items[0].percent, 25);
const bank = [{ id: 'P1', subject: 'Physics', kind: 'objective', text: 'P' }, { id: 'TQ', subject: 'Physics', section: 'theory', kind: 'theory', text: 'T' }];
assert.strictEqual(core.rankHardestQuestions(aggregate, 'Physics', bank).items[0].percent, 25);
assert.deepStrictEqual(core.tutorTheoryStats('Chemistry', {}, students, attempts), { q: {}, t: {} });
assert.strictEqual(core.tutorTopPerformers('Physics', students, { S1: [{ subject: 'Physics', review: [{ subject: 'Physics', given: 0, isCorrect: false }] }] }, []).practice.items[0].answers, 1);
console.log('Live tutor dashboard regressions passed.');
