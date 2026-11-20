/* legacy-attempts.js — test fixture helper (clean sweep, Phase 2, 18 Nov 2026).

   The Web Test's Objective and Theory sittings were retired: the server now
   refuses to open a new one (POST /api/me/tests/start answers 410). Features
   that remain — theory marking by tutors and the console, Results, the league,
   tutor analytics, results export, persistence across a restart — still read
   the Objective/Theory attempts students made BEFORE the retirement.

   A suite that needs such a historical record writes one into its own sandbox
   data.json with this helper. The record is built with the same core rules the
   server's old submit path used (core.eligible / core.objectivePaper to choose
   the questions, core.markAttempt to mark them, core.xpForAttempt for XP,
   core.recordAnswerStats for the per-question counters), so the record the
   remaining features read is the shape they have always read.

   Local-file sandboxes only (the server's readData() reads data.json on every
   request, so a record written here is visible to the very next call). It never
   touches Appwrite, and it is never loaded by the application itself. */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var core = require(path.join(__dirname, '..', 'js', 'goc-core.js'));

function readDb(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeDb(file, db) { fs.writeFileSync(file, JSON.stringify(db, null, 2)); }

/* The questions a historical paper of this kind was drawn from. */
function poolFor(db, student, section, subject) {
  var bank = core.servablePool(db.questions || [], db.passages || []);
  if (section === 'objective') {
    return core.objectivePaper(bank, (student.subjects || []).slice(), (db.settings || {}).objectiveCounts);
  }
  return core.eligible(bank, { section: section, subject: subject });
}

/* sit(dataFile, scholarId, { section, subject, answer, timeUsedSec })
     section  'theory' | 'objective'
     subject  the theory subject (ignored for objective, which is the whole combination)
     answer   function (question, index) -> the response for that question
              (an option index for objective, text for theory). Default: no answer.
   Returns { attemptId/id, scholarId, section, subject, status, percent, score, maxScore,
   correct, total, xpAwarded, timeUsedSec, questions },
   where questions are what the student saw (answers stripped, core.forStudent). */
function sit(dataFile, scholarId, opts) {
  opts = opts || {};
  var section = opts.section;
  if (section !== 'theory' && section !== 'objective') throw new Error('legacy-attempts: section must be theory or objective');
  var db = readDb(dataFile);
  var student = (db.students || []).find(function (x) { return x.id === scholarId; });
  if (!student) throw new Error('legacy-attempts: no student ' + scholarId + ' in ' + dataFile);
  var subject = section === 'objective' ? core.OBJECTIVE_SUBJECT : String(opts.subject || '');
  var pool = poolFor(db, student, section, subject);
  if (!pool.length) throw new Error('legacy-attempts: no ' + section + ' questions for ' + subject);

  var responses = {};
  if (typeof opts.answer === 'function') {
    pool.forEach(function (q, i) { var r = opts.answer(q, i); if (r !== undefined) responses[q.id] = r; });
  }
  var marked = core.markAttempt(pool, responses);
  db.settings = db.settings || {};
  db.settings.attemptSeq = (db.settings.attemptSeq || 0) + 1;
  var started = Date.now() - 60000;
  var used = Math.max(0, Number(opts.timeUsedSec) || 60);
  var rec = {
    id: 'A' + db.settings.attemptSeq + '-' + crypto.randomBytes(4).toString('hex'),
    scholarId: student.id, studentName: student.name,
    period: core.PERIOD, section: section, subject: subject,
    roundId: core.attemptRound({ section: section, subject: subject }),
    questionIds: pool.map(function (q) { return q.id; }),
    startedAt: started, submittedAt: started + used * 1000,
    timeUsedSec: used, durationSec: section === 'objective' ? 60 * 60 : 0,
    total: marked.total, answered: marked.answered, unanswered: marked.unanswered,
    correct: marked.correct, wrong: marked.wrong,
    score: marked.score, maxScore: marked.maxScore,
    percent: marked.percent, status: marked.status,
    answers: marked.answers, xpAwarded: 0
  };
  var gain = rec.status === 'marked' ? core.xpForAttempt(rec.percent) : 10;
  rec.xpAwarded = gain;
  student.xp = (student.xp || 0) + gain;
  if (!db.answerStats || typeof db.answerStats !== 'object') db.answerStats = {};
  core.recordAnswerStats(db.answerStats, subject, marked.answers);
  db.attempts = db.attempts || [];
  db.attempts.push(rec);
  writeDb(dataFile, db);
  return {
    attemptId: rec.id, id: rec.id, scholarId: rec.scholarId,
    section: section, subject: subject, status: rec.status,
    percent: rec.percent, score: rec.score, maxScore: rec.maxScore,
    correct: rec.correct, total: rec.total, xpAwarded: rec.xpAwarded,
    timeUsedSec: rec.timeUsedSec,
    questions: pool.map(core.forStudent)
  };
}

module.exports = { sit: sit };
