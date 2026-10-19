/* ============================================================================
   G.O.C Academy Hub — shared domain core
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS
   The app has two data drivers (demo/mock in js/api.js, and the real server in
   server/server.js). Marking a test, calculating overall academic performance
   and ranking the Scholar League must give the SAME answer in both, or a
   student's league position would change depending on how the page was opened.
   So the seed question bank and every piece of domain arithmetic live here,
   once, and both drivers use it.

   It loads in the browser (attaches to window.GOC.core) and in Node
   (module.exports), so there is one source of truth and no duplicated maths.

   This file holds NO credentials and NO student data. It is pure rules + seed
   question content, both of which are safe for the browser to read.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.GOC = root.GOC || {}; root.GOC.core = api; }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ------------------------------------------------------------- constants */

  /* The five JAMB/UTME papers this academy teaches. Use of English is the
     compulsory paper; the other four are the sciences a candidate picks from.
     Do not change this list without confirming with the academy. */
  var ENGLISH = 'Use of English';
  var SCIENCES = ['Physics', 'Chemistry', 'Biology', 'Mathematics'];
  var ALL_SUBJECTS = [ENGLISH].concat(SCIENCES);

  /* The only examination this academy registers students for. */
  var EXAM = 'JAMB / UTME';

  /* One test, not a weekly one and a monthly one. The academy publishes a single
     paper per session, so `period` survives only as a stored field on records
     written before this change: every value — 'weekly', 'monthly', 'any', a
     blank — reads as the one test. Nothing filters on it any more. */
  var PERIOD = 'test';
  var PERIODS = [PERIOD];
  var PERIOD_LABEL = 'Test';
  var LEGACY_PERIODS = ['weekly', 'monthly', 'any'];
  function normalizePeriod() { return PERIOD; }
  function periodLabel() { return PERIOD_LABEL; }
  /* 'practice' is a fourth, deliberately separate section: it is never drawn
     into a Web Test paper (eligible() below only ever asks for 'theory',
     'objective' or 'jamb' by name), so a question filed here reaches only the
     student's Practice screen and nowhere graded. */
  var SECTIONS = ['theory', 'objective', 'jamb', 'practice'];

  /* Mathematics is taught and examined here, but not as a written paper. A
     mathematics answer is working — fractions, roots, a diagram — and a text box
     cannot carry it honestly, so the academy examines mathematics through the
     objective sitting only. Every other subject offers both.
     This is a rule in the data layer, not a filter on a screen: `eligible`
     refuses to serve a mathematics theory question at all, so no catalogue can
     list the paper, no sitting can contain the question, and the console cannot
     publish one. Removing a subject from this list is all it takes to give it a
     written paper back. */
  var NO_THEORY = ['Mathematics'];
  function theoryAllowed(subject) { return NO_THEORY.indexOf(String(subject)) === -1; }
  /* The subjects that offer a written paper — out of a student's combination when
     one is given, otherwise out of the whole curriculum. */
  function theorySubjects(list) {
    return (list && list.length ? list : ALL_SUBJECTS).filter(theoryAllowed);
  }
  var THEORY_SUBJECTS = theorySubjects(null);
  /* One sentence, written once, so the server, the demo driver and the console
     all refuse in the same words. */
  function noTheoryMessage(subject) {
    return String(subject) + ' is examined in the objective sitting only — it has no written paper.';
  }

  /* XP per level. 1,240 XP -> level 8, matching the academy's existing scale. */
  var XP_PER_LEVEL = 160;
  var STREAK_FREEZE_COST_XP = 100;
  var STREAK_FREEZE_MAX = 2;

  /* Default weighting for overall academic performance (Priority 11).
     Configurable through settings.perfWeights rather than hard-coded at the
     call sites. Weights are normalised over the sections a student has
     actually been assessed in, so an unattempted section never drags a
     score down. */
  var DEFAULT_WEIGHTS = { objective: 40, theory: 30, jamb: 30 };

  /* How long each test session runs, in seconds, per section. Theory is 0 on
     purpose: a written paper is not a race, so it is sat without a clock and the
     time is only recorded, never enforced. The objective figure here is a
     fallback — the real one is settings.objectiveMinutes, set in the console. */
  var DURATION = { objective: 7200, theory: 0, jamb: 1800 };

  /* --------------------------------------------- the objective sitting (UTME)
     The real thing is one sitting, not four. A candidate answers 180 questions
     in one go: 60 Use of English and 40 in each of their three science papers.
     So the Objective session is built from the student's whole combination in
     that shape, and the ceiling per paper is the real ceiling. Management may
     serve fewer — a 10-question English section is a legitimate practice
     sitting — but never more, because more would not be the exam. */
  var OBJECTIVE_CEILING = { english: 60, science: 40 };
  var OBJECTIVE_SUBJECT = 'All subjects';
  var OBJ_MIN_DEFAULT = 120, OBJ_MIN_FLOOR = 5, OBJ_MIN_CEIL = 300;

  function objectiveCeiling(subject) {
    return subject === ENGLISH ? OBJECTIVE_CEILING.english : OBJECTIVE_CEILING.science;
  }
  /* What management has asked for in this paper, held between nothing and the
     real ceiling. An absent or unreadable setting means the full paper. */
  function objectiveCount(subject, caps) {
    var ceil = objectiveCeiling(subject);
    if (!caps || caps[subject] === undefined || caps[subject] === null || caps[subject] === '') return ceil;
    var v = Math.round(Number(caps[subject]));
    if (!isFinite(v)) return ceil;
    return Math.max(0, Math.min(ceil, v));
  }
  /* Only a missing or unreadable clock falls back to the default. Zero and below
     are values under the floor, not absent settings, so stepping the console down
     lands on five minutes instead of leaping back up to two hours. */
  function clampObjectiveMinutes(v) {
    if (v === undefined || v === null || v === '') return OBJ_MIN_DEFAULT;
    var n = Math.round(Number(v));
    if (!isFinite(n)) return OBJ_MIN_DEFAULT;
    return Math.max(OBJ_MIN_FLOOR, Math.min(OBJ_MIN_CEIL, n));
  }
  /* The academy speaks in hours: a UTME sitting is "two hours", never "120
     minutes". Minutes stay the stored unit — one integer, no rounding drift —
     and these two turn it into the language the console and the student read.
     `hoursLabel` names a length; `hmsClock` counts one down. */
  function hoursLabel(min) {
    var m = Math.max(0, Math.round(Number(min) || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + ' minute' + (r === 1 ? '' : 's');
    var out = h + ' hour' + (h === 1 ? '' : 's');
    return r ? out + ' ' + r + ' min' : out;
  }
  /* Hours are shown as soon as the paper has one, so a two-hour sitting reads
     2:00:00 rather than 120:00 — and a short paper still reads MM:SS. */
  function hmsClock(sec) {
    var t = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  /* The console steps the clock in half hours, so the stored minutes must land
     on a half hour too — except at the bounds, which are the academy's. */
  function stepObjectiveMinutes(min, deltaMinutes) {
    var from = clampObjectiveMinutes(min);
    var to = from + Math.round(Number(deltaMinutes) || 0);
    return clampObjectiveMinutes(to <= 0 ? OBJ_MIN_FLOOR : to);
  }
  /* English first, then the sciences in the academy's own order, so two students
     with the same combination always meet their papers in the same sequence. */
  function orderedCombination(subjects) {
    var have = (subjects || []).slice(), out = [], i;
    if (have.indexOf(ENGLISH) > -1) out.push(ENGLISH);
    for (i = 0; i < SCIENCES.length; i++) {
      if (have.indexOf(SCIENCES[i]) > -1) out.push(SCIENCES[i]);
    }
    return out;
  }
  /* What the sitting would look like right now: one row per paper, what is asked
     for and what the bank can actually supply. The console shows this so a gap
     is visible before a student meets it, and the student's hub shows the total. */
  function objectiveBlueprint(bank, subjects, caps) {
    return orderedCombination(subjects).map(function (sub) {
      var pool = eligible(bank, { section: 'objective', subject: sub });
      var want = objectiveCount(sub, caps);
      return { subject: sub, ceiling: objectiveCeiling(sub), want: want,
               available: pool.length, serving: Math.min(want, pool.length) };
    });
  }
  function objectiveTotal(rows) {
    var n = 0, i;
    for (i = 0; i < (rows || []).length; i++) n += rows[i].serving;
    return n;
  }
  /* The paper itself, in blueprint order: every question of one paper together,
     then the next, the way a candidate meets them. Within a paper the draw is
     spread across topics rather than taken in bank order. */
  function objectivePaper(bank, subjects, caps, rnd) {
    var out = [];
    orderedCombination(subjects).forEach(function (sub) {
      var pool = eligible(bank, { section: 'objective', subject: sub });
      var want = Math.min(objectiveCount(sub, caps), pool.length);
      if (want > 0) out = out.concat(pickStudy(pool, want, rnd));
    });
    return out;
  }

  /* --------------------------------------------- the JAMB-oriented sitting
     A JAMB-oriented paper is an objective paper in the same exam shape (60 Use
     of English + 40 per science, one running clock over the whole combination),
     but it draws on its own, exclusive pool: eligible({section:'jamb'}) returns
     ONLY questions tagged 'jamb' — never the general 'objective' pool. This is
     deliberate: a student who has already met a question in the Web Test
     (Objective sitting) must never meet it again here, or a repeat would read
     as a hint rather than a fresh JAMB-style item. The academy imports its own
     dedicated jamb-tagged bank for this sitting. It has its own clock and
     per-paper counts, configured independently of the Objective sitting
     (jambMinutes / jambCounts) so the academy can run a longer, fuller JAMB
     rehearsal without changing the Objective practice session. The ceilings
     are the real exam ceilings, the same as objective. */
  var JAMB_MIN_DEFAULT = 120, JAMB_MIN_FLOOR = 5, JAMB_MIN_CEIL = 300;
  function jambCeiling(subject) { return objectiveCeiling(subject); }
  function jambCount(subject, caps) { return objectiveCount(subject, caps); }
  function clampJambMinutes(v) {
    if (v === undefined || v === null || v === '') return JAMB_MIN_DEFAULT;
    var n = Math.round(Number(v));
    if (!isFinite(n)) return JAMB_MIN_DEFAULT;
    return Math.max(JAMB_MIN_FLOOR, Math.min(JAMB_MIN_CEIL, n));
  }
  function stepJambMinutes(min, deltaMinutes) {
    var from = clampJambMinutes(min);
    var to = from + Math.round(Number(deltaMinutes) || 0);
    return clampJambMinutes(to <= 0 ? JAMB_MIN_FLOOR : to);
  }
  function jambBlueprint(bank, subjects, caps) {
    return orderedCombination(subjects).map(function (sub) {
      var pool = eligible(bank, { section: 'jamb', subject: sub });
      var want = jambCount(sub, caps);
      return { subject: sub, ceiling: jambCeiling(sub), want: want,
               available: pool.length, serving: Math.min(want, pool.length) };
    });
  }
  /* FRESH QUESTIONS FIRST. The JAMB-oriented sitting may be sat again, so a
     repeat must not simply hand back the paper the student has just seen.
     `seen` maps a question id to how many of the student's earlier JAMB-oriented
     attempts carried it (see jambSeenCounts). Within each subject the draw takes
     questions the student has never met first; only when fewer unseen ones are
     left than the paper needs does it top up, from the questions met the fewest
     times (least-seen first), so repeats are as small as the bank allows. The
     chosen set is then re-spread across topics, as a first sitting would be.
     With no `seen` (a first sitting, or an old caller) it is the plain draw. */
  function freshFirstPick(pool, count, seen, rnd) {
    if (!seen) return pickStudy(pool, count, rnd);
    var tiers = {}, keys = [], groupSeen = {};
    /* A passage is met as a whole: it takes the highest count among its
       questions, so it is drawn only when its whole set is as fresh as the tier. */
    (pool || []).forEach(function (r) {
      if (r.passageId) groupSeen[String(r.passageId)] = Math.max(groupSeen[String(r.passageId)] || 0, Number(seen[r.id]) || 0);
    });
    (pool || []).forEach(function (r) {
      var n = r.passageId ? groupSeen[String(r.passageId)] : (Number(seen[r.id]) || 0);
      if (!tiers[n]) { tiers[n] = []; keys.push(n); }
      tiers[n].push(r);
    });
    keys.sort(function (a, b) { return a - b; });
    var chosen = [];
    for (var i = 0; i < keys.length && chosen.length < count; i++) {
      chosen = chosen.concat(pickStudy(tiers[keys[i]], count - chosen.length, rnd));
    }
    return pickStudy(chosen, chosen.length, rnd);
  }
  function jambSeenCounts(attempts) {
    var out = {};
    (Array.isArray(attempts) ? attempts : []).forEach(function (a) {
      if (!a || a.section !== 'jamb' || !Array.isArray(a.questionIds)) return;
      a.questionIds.forEach(function (id) { out[id] = (out[id] || 0) + 1; });
    });
    return out;
  }
  function jambPaper(bank, subjects, caps, rnd, seen) {
    var out = [];
    orderedCombination(subjects).forEach(function (sub) {
      var pool = eligible(bank, { section: 'jamb', subject: sub });
      var want = Math.min(jambCount(sub, caps), pool.length);
      if (want > 0) out = out.concat(freshFirstPick(pool, want, seen, rnd));
    });
    return out;
  }

  /* ---------------------------------------- when the JAMB-oriented sitting opens
     (Phase 3, slice 1 — pure rule.) A thin bank would give a student a
     handful of questions for a full rehearsal — and, since the sitting can now
     be repeated, the same handful every time (jambPaper draws unseen questions
     first, but can only do that if the bank is deeper than one paper). It is therefore held back until EVERY subject in the
     student's combination has at least `min` questions in the jamb pool — a
     partial paper (English but no Physics, say) is never offered either.
     `min` is the academy's depth bar: default 20, never above 40 (the smallest
     real ceiling, so the bar can always be met) and never below 1. */
  var JAMB_READY_DEFAULT = 20, JAMB_READY_FLOOR = 1, JAMB_READY_CEIL = 40;
  function clampJambReadyMin(v) {
    if (v === undefined || v === null || v === '') return JAMB_READY_DEFAULT;
    var n = Math.round(Number(v));
    if (!isFinite(n)) return JAMB_READY_DEFAULT;
    return Math.max(JAMB_READY_FLOOR, Math.min(JAMB_READY_CEIL, n));
  }
  /* Per-subject depth against the bar, in sitting order. `need` is how many more
     the academy must add; `short` names the subjects still under the bar. A
     combination with no subjects is never ready. */
  function jambReadiness(bank, subjects, min) {
    var bar = clampJambReadyMin(min);
    var rows = jambBlueprint(bank, subjects, null).map(function (r) {
      var have = r.available;
      return { subject: r.subject, available: have, need: Math.max(0, bar - have), ok: have >= bar };
    });
    var short = rows.filter(function (r) { return !r.ok; }).map(function (r) { return r.subject; });
    return { min: bar, ready: rows.length > 0 && short.length === 0, subjects: rows, short: short };
  }
  function jambOffered(bank, subjects, min) { return jambReadiness(bank, subjects, min).ready; }

  /* ---------------------------------------- JAMB-style score out of 400
     (Phase 3, slice 1 — pure rule.) A marked JAMB-oriented paper is also shown
     the way the real UTME reports: each of the four subjects out of 100, the
     total out of 400. Each subject is scaled proportionally — correct ÷ asked
     × 100, rounded to a whole mark — and a question left blank counts as asked
     and wrong, never skipped. The paper must carry exactly four subjects,
     English among them, and every answer row must name its subject; anything
     else (a partial combination, an unmarked paper, an older attempt stored
     before rows named their subject) returns null rather than an inflated or
     guessed figure. JAMB's own normalisation is not published, so this is a
     practice indicator, never a prediction (`estimate` is always true). */
  var JAMB_SUBJECT_MAX = 100, JAMB_TOTAL_MAX = 400;
  function jambScore(marked) {
    if (!marked || marked.status !== 'marked' || !Array.isArray(marked.answers) || !marked.answers.length) return null;
    var by = {}, names = [], i, r;
    for (i = 0; i < marked.answers.length; i++) {
      r = marked.answers[i];
      if (!r || r.kind !== 'objective' || !r.subject) return null;
      if (!by[r.subject]) { by[r.subject] = { subject: r.subject, correct: 0, asked: 0 }; names.push(r.subject); }
      by[r.subject].asked++;
      if (r.isCorrect === true) by[r.subject].correct++;
    }
    if (names.length !== 4 || names.indexOf(ENGLISH) < 0) return null;
    var rows = orderedCombination(names).map(function (n) {
      var b = by[n];
      b.score = Math.round(b.correct / b.asked * JAMB_SUBJECT_MAX);
      return b;
    });
    if (rows.length !== 4) return null;
    var total = rows.reduce(function (t, b) { return t + b.score; }, 0);
    return { subjects: rows, total: total, max: JAMB_TOTAL_MAX, estimate: true };
  }

  /* ---------------------------------------- Web Test sit rules
     (Phase 3, sit-rules slice 1 — pure rule.) A student who has submitted a
     THEORY or OBJECTIVE session can never sit that session again. The
     JAMB-oriented session is the only one that may be sat repeatedly, as a
     rehearsal. `attempts` is the student's own earlier submitted attempts for
     this sitting (the caller has already narrowed to the same subject where a
     section has several); any entry that carries a different `section` is
     ignored, so a mixed list is safe. Anything that is not a known Web Test
     section (including 'practice') is refused rather than guessed at.

     ROUNDS (Phase 3E.B): the academy opens a new "round" each time it publishes
     a fresh Web Test for a section+subject. The one-sit rule counts only
     attempts in the CURRENT round, so finishing one round never blocks the
     next. `round` is the current round number (a positive integer); omitted or
     falsy means round 1. An attempt with no `roundId` counts as round 1, so
     every result sat before rounds existed stays as the first round and nothing
     changes for a section whose round has never been advanced.
     Returns { allowed, repeatable, count, reason } — `reason` is '' when
     allowed, else 'unknown' | 'done'. */
  var WEB_TEST_SECTIONS = ['theory', 'objective', 'jamb'];
  var REPEATABLE_SECTIONS = ['jamb'];
  function attemptRound(a) {
    var r = a && a.roundId;
    r = Math.floor(Number(r));
    return r > 0 ? r : 1;
  }
  function canSit(section, attempts, round) {
    var sec = String(section || '');
    if (WEB_TEST_SECTIONS.indexOf(sec) < 0) return { allowed: false, repeatable: false, count: 0, reason: 'unknown' };
    var cur = Math.floor(Number(round));
    if (!(cur > 0)) cur = 1;
    var count = 0;
    (Array.isArray(attempts) ? attempts : []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      if (a.section !== undefined && a.section !== null && a.section !== sec) return;
      if (attemptRound(a) !== cur) return;
      count++;
    });
    var repeatable = REPEATABLE_SECTIONS.indexOf(sec) > -1;
    var allowed = repeatable || count === 0;
    return { allowed: allowed, repeatable: repeatable, count: count, reason: allowed ? '' : 'done' };
  }

  /* ------------------------------------------------------- seed question bank
     Shape of a question record (also the shape the Admin Console creates):

       id          number, assigned by the store
       subject     one of ALL_SUBJECTS
       topic       free text, used for the weak-topic breakdown
       kind        'objective' | 'theory'
       section     'objective' | 'theory' | 'jamb' | 'practice'
                   'objective' MCQs are eligible for BOTH the Objective test and
                   the JAMB-oriented test; mark a question 'jamb' to keep it
                   exclusive to the JAMB-oriented paper. 'practice' is separate
                   again: eligible() (below) only ever asks the bank for
                   'theory', 'objective' or 'jamb' by name when building a Web
                   Test paper, so a 'practice' question is never drawn into any
                   Web Test session — it only ever reaches the student's
                   Practice screen (studyPool() doesn't filter on section at
                   all, so it draws every active objective-kind question,
                   'practice' included).
       period      always 'test' — the academy runs one test, not a weekly
                   and a monthly one. Kept so records written before that
                   change still read cleanly.
       text        the question
       options     objective only — array of choices
       answer      objective only — index of the correct choice (never sent to a student)
       expected    theory only — reference answer shown to the marker
       maxMark     theory only — maximum mark available
       difficulty  'easy' | 'medium' | 'hard'
       explanation shown in review after marking
       active      inactive questions are never served to a student
  */

  var bankSeq = 0;

  function q(subject, topic, section, period, text, options, answer, explanation, difficulty) {
    return {
      id: ++bankSeq, subject: subject, topic: topic, kind: 'objective',
      section: section, period: period, text: text, options: options,
      answer: answer, expected: '', maxMark: 1,
      difficulty: difficulty || 'medium', explanation: explanation || '', active: true
    };
  }

  function th(subject, topic, period, text, expected, maxMark) {
    return {
      id: ++bankSeq, subject: subject, topic: topic, kind: 'theory',
      section: 'theory', period: period, text: text, options: [],
      answer: null, expected: expected, maxMark: maxMark || 10,
      difficulty: 'medium', explanation: '', active: true
    };
  }

  var QUESTIONS = [
    /* ---------------------------------------------------- Use of English */
    q(ENGLISH, 'Lexis & Structure', 'objective', 'test', 'Choose the option nearest in meaning to the word in capital letters: The chairman’s remarks were TERSE.', ['Lengthy', 'Brief and to the point', 'Rude', 'Unclear'], 1, '“Terse” means brief and abrupt — saying much in few words.', 'easy'),
    q(ENGLISH, 'Antonyms', 'objective', 'test', 'Choose the option opposite in meaning to the word in capital letters: The policy had a DETRIMENTAL effect on trade.', ['Harmful', 'Lasting', 'Beneficial', 'Sudden'], 2, '“Detrimental” means harmful, so its opposite is “beneficial”.', 'easy'),
    q(ENGLISH, 'Tenses', 'objective', 'test', 'Complete the sentence: If he ______ earlier, he would have caught the bus.', ['leaves', 'has left', 'had left', 'left'], 2, 'Third conditional: “if + past perfect” pairs with “would have + past participle”.', 'medium'),
    q(ENGLISH, 'Oral Forms', 'objective', 'test', 'Choose the word whose underlined vowel sound is different from the others.', ['bead', 'seat', 'bread', 'heat'], 2, '“Bread” has the short /e/ sound; the others use the long /iː/ sound.', 'medium'),
    q(ENGLISH, 'Concord', 'objective', 'test', 'Choose the correct option: Each of the students ______ a copy of the syllabus.', ['have', 'has', 'are having', 'have had'], 1, '“Each” is singular, so it takes the singular verb “has”.', 'easy'),
    q(ENGLISH, 'Idioms & Phrasal Verbs', 'objective', 'test', 'In the sentence “The meeting was called off”, the expression “called off” means the meeting was', ['postponed indefinitely', 'cancelled', 'rescheduled', 'shortened'], 1, 'To “call off” something is to cancel it.', 'easy'),
    q(ENGLISH, 'Concord', 'jamb', 'test', 'Choose the option that best completes the sentence: The manager insisted that every worker ______ present at the briefing.', ['is', 'was', 'be', 'will be'], 2, 'After “insist that” the subjunctive is used, so the base form “be” is correct.', 'hard'),
    th(ENGLISH, 'Letter Writing', 'test', 'In not more than 60 words, explain the difference between a formal and an informal letter, and give one situation in which each is appropriate.', 'A formal letter uses an impersonal, respectful tone, avoids contractions and slang, and carries both the writer’s and the recipient’s addresses with a formal salutation and closing — appropriate for official matters such as a job application. An informal letter is personal and conversational, allows contractions, and carries only the writer’s address — appropriate for writing to a friend or relative.', 10),
    th(ENGLISH, 'Essay Writing', 'test', 'Write a topic sentence for a paragraph arguing that reading widely improves writing, then give two supporting points.', 'A suitable topic sentence states the claim clearly, e.g. “Wide reading is the surest way to become a better writer.” Supporting points may include: exposure to varied sentence patterns and vocabulary that the writer then reuses; and familiarity with how ideas are organised and paragraphs are linked, which improves the writer’s own structure. Award marks for a clear topic sentence (4) and two relevant, developed points (3 each).', 10),

    /* ---------------------------------------------------------- Mathematics */
    q('Mathematics', 'Indices', 'objective', 'test', 'Simplify $(2^3 \\times 2^5) \\div 2^4$.', ['$2^2$', '$2^3$', '$2^4$', '$2^6$'], 2, 'Add the indices when multiplying and subtract when dividing: $3 + 5 - 4 = 4$, so the answer is $2^4$.', 'easy'),
    q('Mathematics', 'Linear Equations', 'objective', 'test', 'If $3x - 7 = 11$, find $x$.', ['4', '5', '6', '18'], 2, '$3x = 11 + 7 = 18$, so $x = 6$.', 'easy'),
    q('Mathematics', 'Plane Geometry', 'objective', 'test', 'Find the sum of the interior angles of a hexagon.', ['$540^\\circ$', '$620^\\circ$', '$720^\\circ$', '$900^\\circ$'], 2, 'The sum of the interior angles is $(n - 2) \\times 180^\\circ$, so for a hexagon $(6 - 2) \\times 180^\\circ = 720^\\circ$.', 'medium'),
    q('Mathematics', 'Statistics', 'objective', 'test', 'The mean of 4, 7, $x$ and 10 is 8. Find $x$.', ['9', '10', '11', '12'], 2, 'The total must be $4 \\times 8 = 32$. Since $4 + 7 + 10 = 21$, $x = 32 - 21 = 11$.', 'medium'),
    q('Mathematics', 'Coordinate Geometry', 'objective', 'test', 'Find the gradient of the straight line joining the points $(1, 2)$ and $(4, 11)$.', ['2', '3', '4', '9'], 1, 'Gradient $= \\frac{11 - 2}{4 - 1} = \\frac{9}{3} = 3$.', 'medium'),
    q('Mathematics', 'Logarithms', 'objective', 'test', 'Evaluate $\\log_{10} 8 + \\log_{10} 125$.', ['2', '3', '5', '10'], 1, '$\\log 8 + \\log 125 = \\log(8 \\times 125) = \\log 1000 = 3$.', 'medium'),
    q('Mathematics', 'Sequences & Series', 'jamb', 'test', 'The 3rd term of an arithmetic progression is 11 and the 7th term is 27. Find the common difference.', ['3', '4', '5', '6'], 1, 'Four steps separate the 3rd and 7th terms, so $4d = 27 - 11 = 16$ and $d = 4$.', 'hard'),
    /* No written mathematics paper — see NO_THEORY. Mathematics is examined here
       through the objective sitting, so this bank carries no theory question for
       it and `eligible` would refuse to serve one anyway. */

    /* -------------------------------------------------------------- Physics */
    q('Physics', 'Electricity', 'objective', 'test', 'The SI unit of electric charge is the', ['ampere', 'volt', 'coulomb', 'ohm'], 2, 'Charge is measured in coulombs; the ampere measures current, the volt potential difference and the ohm resistance.', 'easy'),
    q('Physics', 'Motion', 'objective', 'test', 'A body starts from rest and accelerates uniformly at $4\\ \\text{m/s}^2$ for 5 seconds. Find its final velocity.', ['9 m/s', '20 m/s', '25 m/s', '40 m/s'], 1, '$v = u + at = 0 + (4 \\times 5) = 20\\ \\text{m/s}$.', 'easy'),
    q('Physics', 'Scalars & Vectors', 'objective', 'test', 'Which of the following is a vector quantity?', ['Mass', 'Energy', 'Momentum', 'Temperature'], 2, 'Momentum has both magnitude and direction; the others are scalars.', 'easy'),
    q('Physics', 'Heat Energy', 'objective', 'test', 'Convert 27 °C to kelvin.', ['246 K', '273 K', '300 K', '327 K'], 2, 'K = °C + 273, so 27 + 273 = 300 K.', 'easy'),
    q('Physics', 'Waves', 'objective', 'test', 'A wave has a frequency of 50 Hz and a wavelength of 4 m. Calculate its speed.', ['12.5 m/s', '46 m/s', '54 m/s', '200 m/s'], 3, '$v = f\\lambda = 50 \\times 4 = 200\\ \\text{m/s}$.', 'medium'),
    q('Physics', 'Electromagnetism', 'objective', 'test', 'A transformer has 200 turns in the primary coil and 1,000 in the secondary. If the primary voltage is 40 V, the secondary voltage is', ['8 V', '80 V', '160 V', '200 V'], 3, '$\\frac{V_s}{V_p} = \\frac{N_s}{N_p} = 5$, so $V_s = 40 \\times 5 = 200\\ \\text{V}$.', 'medium'),
    q('Physics', 'Machines', 'jamb', 'test', 'A machine with a velocity ratio of 5 has an efficiency of 80%. Find its mechanical advantage.', ['3', '4', '6.25', '40'], 1, 'Efficiency $= \\frac{MA}{VR}$, so $MA = 0.8 \\times 5 = 4$.', 'hard'),
    th('Physics', 'Current Electricity', 'test', 'State Ohm’s law and explain one condition under which it does not hold.', 'Ohm’s law: the current flowing through a metallic conductor is directly proportional to the potential difference across its ends, provided temperature and other physical conditions remain constant. It fails when the temperature of the conductor changes appreciably, and it does not apply to non-ohmic devices such as filament lamps, semiconductor diodes, gases and electrolytes. Award marks for a correct statement including the constant-conditions proviso (6) and one valid limitation (4).', 10),
    th('Physics', 'Projectiles', 'test', 'A stone is thrown vertically upwards with a velocity of 20 m/s. Taking $g = 10\\ \\text{m/s}^2$, calculate the maximum height reached and the total time of flight.', 'At maximum height the final velocity is zero, so $h = \\frac{u^2}{2g} = \\frac{400}{20} = 20\\ \\text{m}$. Time to reach the top $= \\frac{u}{g} = \\frac{20}{10} = 2\\ \\text{s}$, and since the motion is symmetrical the total time of flight is 4 s. Award marks for the height with working (5) and the total time (5).', 10),

    /* ------------------------------------------------------------ Chemistry */
    q('Chemistry', 'Organic Chemistry', 'objective', 'test', 'The general molecular formula of alkanes is', ['$C_nH_{2n}$', '$C_nH_{2n+2}$', '$C_nH_{2n-2}$', '$C_nH_n$'], 1, 'Alkanes are saturated hydrocarbons with the general formula $C_nH_{2n+2}$.', 'easy'),
    q('Chemistry', 'States of Matter', 'objective', 'test', 'Which of the following is an example of a physical change?', ['Rusting of iron', 'Burning of paper', 'Melting of ice', 'Souring of milk'], 2, 'Melting is reversible and forms no new substance, so it is a physical change.', 'easy'),
    q('Chemistry', 'Mole Concept', 'objective', 'test', 'How many moles are present in 44 g of carbon(IV) oxide? [C = 12, O = 16]', ['0.5', '1.0', '1.5', '2.0'], 1, 'The molar mass of $CO_2$ is $12 + 32 = 44$ g/mol, so $n = \\frac{44}{44} = 1$ mole.', 'medium'),
    q('Chemistry', 'Electrolysis', 'objective', 'test', 'During electrolysis, oxidation takes place at the', ['cathode', 'anode', 'electrolyte', 'salt bridge'], 1, 'Anions migrate to the anode and lose electrons, so oxidation occurs there.', 'medium'),
    q('Chemistry', 'Acids, Bases & Salts', 'objective', 'test', 'A solution with a pH of 3 is', ['strongly basic', 'weakly basic', 'neutral', 'acidic'], 3, 'A pH below 7 is acidic; pH 3 indicates a fairly strong acid.', 'easy'),
    q('Chemistry', 'Tests for Gases', 'objective', 'test', 'Which gas turns lime water milky?', ['Hydrogen', 'Oxygen', 'Carbon(IV) oxide', 'Ammonia'], 2, 'Carbon(IV) oxide forms insoluble calcium trioxocarbonate(IV) with lime water, giving the milky appearance.', 'easy'),
    q('Chemistry', 'Redox Reactions', 'jamb', 'test', 'What is the oxidation number of manganese in $KMnO_4$?', ['+2', '+4', '+6', '+7'], 3, 'Potassium is $+1$ and each oxygen is $-2$, giving $1 + x - 8 = 0$, so $x = +7$.', 'hard'),
    th('Chemistry', 'Electrolysis', 'test', 'Define electrolysis and state two industrial applications of it.', 'Electrolysis is the decomposition of an electrolyte by the passage of an electric current through it in the molten or aqueous state. Industrial applications include: electroplating of metals; the extraction of reactive metals such as aluminium and sodium from their molten ores; the refining or purification of copper; and the manufacture of chlorine and sodium hydroxide from brine. Award marks for the definition (4) and two valid applications (3 each).', 10),
    th('Chemistry', 'Organic Chemistry', 'test', 'Explain, with an equation, why alkanes undergo substitution rather than addition reactions with chlorine.', 'Alkanes are saturated: every carbon atom is joined by single covalent bonds and already holds the maximum number of hydrogen atoms, so there is no double or triple bond for a reagent to add across. Chlorine therefore replaces a hydrogen atom instead. In the presence of sunlight: $CH_4 + Cl_2 \\to CH_3Cl + HCl$. Award marks for the explanation based on saturation (6) and a correct balanced equation (4).', 10),

    /* -------------------------------------------------------------- Biology */
    q('Biology', 'Cell Biology', 'objective', 'test', 'The basic structural and functional unit of life is the', ['tissue', 'cell', 'organ', 'organism'], 1, 'All living things are built from cells, which are the smallest units able to carry out life processes.', 'easy'),
    q('Biology', 'Plant Nutrition', 'objective', 'test', 'Which organelle is the site of photosynthesis?', ['Mitochondrion', 'Ribosome', 'Chloroplast', 'Nucleus'], 2, 'Chloroplasts contain chlorophyll, which traps the light energy used in photosynthesis.', 'easy'),
    q('Biology', 'Transport System', 'objective', 'test', 'The blood vessel that carries oxygenated blood from the lungs to the heart is the', ['pulmonary artery', 'pulmonary vein', 'aorta', 'vena cava'], 1, 'The pulmonary vein is the exception among veins: it carries oxygenated blood, from the lungs to the left atrium.', 'medium'),
    q('Biology', 'Genetics', 'objective', 'test', 'In humans, the sex chromosomes of a normal male are', ['XX', 'XY', 'YY', 'XO'], 1, 'Males carry one X and one Y chromosome; females carry two X chromosomes.', 'easy'),
    q('Biology', 'Excretion', 'objective', 'test', 'Which of the following is an excretory organ in mammals?', ['Liver', 'Kidney', 'Pancreas', 'Spleen'], 1, 'The kidneys remove urea, excess water and salts from the blood as urine.', 'easy'),
    q('Biology', 'Ecology', 'objective', 'test', 'Organisms that manufacture their own food from simple inorganic substances are called', ['consumers', 'decomposers', 'producers', 'parasites'], 2, 'Producers, mainly green plants, are autotrophic and form the first trophic level.', 'easy'),
    q('Biology', 'Genetics', 'jamb', 'test', 'A cross between two heterozygous tall pea plants (Tt × Tt) gives a phenotypic ratio of', ['1 : 1', '2 : 1', '3 : 1', '9 : 3 : 3 : 1'], 2, 'The offspring are TT, Tt, Tt and tt — three tall to one short, a 3 : 1 phenotypic ratio.', 'hard'),
    th('Biology', 'Plant Nutrition', 'test', 'Define photosynthesis and write the balanced overall equation for the process.', 'Photosynthesis is the process by which green plants use light energy trapped by chlorophyll to convert carbon dioxide and water into carbohydrate, releasing oxygen as a by-product. Overall equation: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂, in the presence of light and chlorophyll. Award marks for a definition mentioning light energy, chlorophyll and the raw materials (6) and a correctly balanced equation (4).', 10),
    th('Biology', 'Transport System', 'test', 'State three differences between arteries and veins.', 'Any three of the following: arteries carry blood away from the heart while veins carry blood towards it; arteries carry oxygenated blood (except the pulmonary artery) while veins carry deoxygenated blood (except the pulmonary vein); arteries have thick muscular elastic walls and a narrow lumen while veins have thin walls and a wide lumen; veins contain valves to prevent backflow while arteries do not; blood in arteries is under high pressure and flows in spurts, whereas blood in veins is under low pressure and flows smoothly. Award 3 marks per valid, clearly stated difference.', 9)

  ];

  /* --------------------------------------------------- subject combination
     Priority 5. A UTME candidate sits four papers: Use of English, which is
     compulsory, plus exactly three of the four sciences this academy teaches.
     Both drivers call this, so an invalid combination cannot be saved by
     bypassing the browser. */

  function validateSubjects(list) {
    var picked = [], seen = {}, i, s;
    for (i = 0; i < (list || []).length; i++) {
      s = String(list[i] || '').trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      picked.push(s);
    }
    for (i = 0; i < picked.length; i++) {
      if (ALL_SUBJECTS.indexOf(picked[i]) === -1) {
        return { ok: false, error: picked[i] + ' is not one of the subjects this academy offers.' };
      }
    }
    if (picked.indexOf(ENGLISH) === -1) {
      return { ok: false, error: 'Use of English is compulsory for UTME — add it to your combination.' };
    }
    var sciences = picked.filter(function (x) { return x !== ENGLISH; });
    if (sciences.length < 3) {
      return { ok: false, error: 'Choose exactly three science subjects — you have selected ' + sciences.length + '.' };
    }
    if (sciences.length > 3) {
      return { ok: false, error: 'UTME allows only three subjects besides Use of English — remove ' + (sciences.length - 3) + '.' };
    }
    /* Keep a stable order: English first, then the sciences in academy order. */
    var ordered = [ENGLISH].concat(SCIENCES.filter(function (x) { return sciences.indexOf(x) !== -1; }));
    return { ok: true, subjects: ordered };
  }

  /* ---- Sign-ups per address (Phase 3B slice 5) ----------------------------------------
     Sign-up is open: there is no access code. What slows down one person making many Open
     accounts is a limit on SUCCESSFUL sign-ups from one address, in an hour and in a day.
     The defaults suit one family or one phone; management can raise them in the console
     for a school or a shared phone network (many students, one address). */
  var SIGNUP_HOUR_MS = 60 * 60 * 1000, SIGNUP_DAY_MS = 24 * SIGNUP_HOUR_MS;
  var SIGNUP_LIMIT_DEFAULTS = { perHour: 5, perDay: 20 };
  var SIGNUP_LIMIT_MAX = 1000;
  function wholeIn(v, lo, hi) {
    var n = Number(v);
    return (typeof v !== 'boolean' && v !== '' && v != null && isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi) ? n : null;
  }
  /* What is in force, from the stored settings (a missing or damaged value reads as the default). */
  function signupLimits(settings) {
    var h = wholeIn(settings && settings.signupPerHour, 1, SIGNUP_LIMIT_MAX);
    var d = wholeIn(settings && settings.signupPerDay, 1, SIGNUP_LIMIT_MAX);
    h = h == null ? SIGNUP_LIMIT_DEFAULTS.perHour : h;
    d = d == null ? SIGNUP_LIMIT_DEFAULTS.perDay : d;
    if (d < h) d = h;          /* a day can never allow fewer than an hour */
    return { perHour: h, perDay: d };
  }
  /* The console's input: { perHour, perDay } as typed. Returns { perHour, perDay } or { error }. */
  function validateSignupLimits(body) {
    var h = wholeIn(body && body.perHour, 1, SIGNUP_LIMIT_MAX);
    var d = wholeIn(body && body.perDay, 1, SIGNUP_LIMIT_MAX);
    if (h == null) return { error: 'Sign-ups per hour must be a whole number from 1 to ' + SIGNUP_LIMIT_MAX + '.' };
    if (d == null) return { error: 'Sign-ups per day must be a whole number from 1 to ' + SIGNUP_LIMIT_MAX + '.' };
    if (d < h) return { error: 'Sign-ups per day cannot be fewer than sign-ups per hour.' };
    return { perHour: h, perDay: d };
  }
  /* times: ms timestamps of this address's earlier successful sign-ups. Returns null when another
     sign-up is allowed, else { retryAfter: seconds, window: 'hour' | 'day' }. */
  function signupWait(times, now, lim) {
    var inHour = [], inDay = [];
    (times || []).forEach(function (t) {
      var age = now - t;
      if (age < SIGNUP_DAY_MS) inDay.push(t);
      if (age < SIGNUP_HOUR_MS) inHour.push(t);
    });
    var wait = 0, win = null;
    if (inHour.length >= lim.perHour) {
      inHour.sort(function (a, b) { return a - b; });
      /* the slot frees when the (count - limit + 1)th oldest one leaves the window */
      wait = inHour[inHour.length - lim.perHour] + SIGNUP_HOUR_MS - now; win = 'hour';
    }
    if (inDay.length >= lim.perDay) {
      inDay.sort(function (a, b) { return a - b; });
      var w2 = inDay[inDay.length - lim.perDay] + SIGNUP_DAY_MS - now;
      if (w2 > wait) { wait = w2; win = 'day'; }
    }
    if (!win) return null;
    return { retryAfter: Math.max(1, Math.ceil(wait / 1000)), window: win };
  }
  function signupLimitMessage(retryAfter, win) {
    var secs = Math.max(1, Number(retryAfter) || 1);
    var when = secs < 90 ? 'a minute' : secs < 5400 ? Math.round(secs / 60) + ' minutes'
             : secs < 129600 ? Math.round(secs / 3600) + ' hours' : 'a day';
    return 'Too many accounts have been created from this connection ' +
           (win === 'day' ? 'today' : 'in the last hour') + '. Try again in about ' + when +
           '. If you are at a school or sharing a network, ask the academy.';
  }

  /* Priority: UTME only. Any other examination is refused with an explanation
     rather than silently accepted.
     "Post-UTME" contains the letters UTME, so a substring test on its own would
     wave a screening examination straight through. Name what the academy does
     not run first, then require the goal to actually say JAMB or UTME. */
  var OTHER_EXAMS = /post[\s-]*(utme|jamb|ume)|screening|waec|wassce|neco|nabteb|ssce|gce|ijmb|jupeb|a[\s-]*level|olevel|o[\s-]*level|cambridge|ielts|toefl|sat\b/i;
  function validateExam(goal) {
    var g = String(goal || '').trim();
    if (!g) return { ok: true, exam: EXAM };
    if (!OTHER_EXAMS.test(g) && /utme|jamb/i.test(g)) return { ok: true, exam: EXAM };
    return {
      ok: false,
      error: 'G.O.C Academy Hub currently prepares students for the JAMB/UTME examination only. ' +
             'Registration for ' + g + ' is not available — please select JAMB / UTME to continue.'
    };
  }

  /* Same rule, but for a request rather than a half-filled form. validateExam
     lets a blank goal through on purpose: the sign-up screen calls it on every
     keystroke and an empty select must not shout at a student who has not
     chosen yet. A request arriving at the data layer is different — by then the
     examination is a stored field, and accepting a blank one means writing an
     account whose goal nobody ever stated. Both drivers call this instead. */
  function requireExam(goal) {
    if (!String(goal == null ? '' : goal).trim()) {
      return { ok: false, error: 'Select the examination you are preparing for — JAMB / UTME.' };
    }
    return validateExam(goal);
  }

  /* -------------------------------------------------- question validation
     Priority 4.1/4.2. Used by both drivers so a malformed question cannot be
     stored by calling the API directly. Returns { rec } or { error }. */

  /* ---------------------------------------- past questions by year
     (Phase 3, past-questions slice 1 — pure rules.) A question may carry the
     year of the examination it came from. The year is optional: blank means
     "not a past question". When given it must be a whole four-digit year from
     1978 (the first UTME) to 2100; anything else is an error to be shown, not
     silently dropped, so a typo cannot hide a question from its year. */
  var PAST_YEAR_MIN = 1978, PAST_YEAR_MAX = 2100;
  function cleanQuestionYear(v) {
    if (v === undefined || v === null || String(v).trim() === '') return { year: null };
    var s = String(v).trim();
    if (!/^\d{4}$/.test(s)) return { error: 'The year must be four digits, for example 2019.' };
    var n = Number(s);
    if (n < PAST_YEAR_MIN || n > PAST_YEAR_MAX) {
      return { error: 'The year must be between ' + PAST_YEAR_MIN + ' and ' + PAST_YEAR_MAX + '.' };
    }
    return { year: n };
  }
  /* The years a student ticked: one year or a list, each validated like a
     typed year. Blank or empty means "no narrowing". Duplicates collapse. */
  function cleanYearList(v) {
    var raw = Array.isArray(v) ? v : ((v === undefined || v === null || String(v).trim() === '') ? [] : [v]);
    var out = [], i, c;
    for (i = 0; i < raw.length; i++) {
      c = cleanQuestionYear(raw[i]);
      if (c.error) return { error: c.error };
      if (c.year !== null && out.indexOf(c.year) === -1) out.push(c.year);
    }
    out.sort(function (a, b) { return b - a; });
    return { years: out };
  }
  /* A past question is served as study material: live, objective, dated, and
     filed under Practice. The year belongs to the Practice section only — the
     Objective and JAMB-oriented sittings never carry or use one. */
  function isPastQuestion(q) {
    return !!q && q.active !== false && q.kind === 'objective' && q.section === 'practice' && Number(q.year) > 0;
  }
  /* The years a subject has past questions for, newest first, with how many. */
  function pastYears(bank, subject) {
    var by = {}, out = [];
    (bank || []).forEach(function (q) {
      if (!isPastQuestion(q) || q.subject !== subject) return;
      by[q.year] = (by[q.year] || 0) + 1;
    });
    Object.keys(by).forEach(function (y) { out.push({ year: Number(y), count: by[y] }); });
    out.sort(function (a, b) { return b.year - a.year; });
    return out;
  }
  /* One subject, one year, in bank order — the order the paper was set in. */
  function pastQuestions(bank, subject, year) {
    var y = Number(year);
    return (bank || []).filter(function (q) { return isPastQuestion(q) && q.subject === subject && Number(q.year) === y; });
  }

  /* ------------------------------------------- comprehension passages
     (Phase 3, comprehension slice 1 — pure rules.) A passage is a reading text
     of its own, written once and shared by several questions. A question points
     at it with an optional `passageId`; the passage is shown above the questions
     that use it. Only an objective question may use one (a theory answer is
     marked by a person and has no use for it). Whether the passage really exists
     is for the data layer to check, because only it holds the passages. */
  var PASSAGE_TITLE_MAX = 120, PASSAGE_TEXT_MIN = 60, PASSAGE_TEXT_MAX = 8000;
  function validatePassage(d) {
    var r = d || {};
    var subject = String(r.subject || '').trim();
    var title = String(r.title || '').replace(/\s+/g, ' ').trim();
    var text = String(r.text || '').replace(/\r\n?/g, '\n').trim();
    if (ALL_SUBJECTS.indexOf(subject) === -1) return { error: 'Choose one of the academy’s subjects.' };
    if (title.length < 3) return { error: 'Give the passage a title.' };
    if (title.length > PASSAGE_TITLE_MAX) return { error: 'Keep the passage title under ' + PASSAGE_TITLE_MAX + ' characters.' };
    if (text.length < PASSAGE_TEXT_MIN) return { error: 'The passage is too short to set questions on — write at least a paragraph.' };
    if (text.length > PASSAGE_TEXT_MAX) return { error: 'The passage is too long — keep it under ' + PASSAGE_TEXT_MAX + ' characters.' };
    return {
      rec: {
        id: r.id, subject: subject, title: title, text: text,
        active: r.active === undefined ? true : !!r.active
      }
    };
  }
  /* Blank means "this question has no passage". Otherwise a positive whole
     number; anything else is an error to be shown, never silently dropped. */
  function cleanPassageId(v) {
    if (v === undefined || v === null || String(v).trim() === '') return { passageId: null };
    var s = String(v).trim();
    if (!/^\d{1,9}$/.test(s) || Number(s) < 1) return { error: 'The passage must be chosen from the list.' };
    return { passageId: Number(s) };
  }
  /* The data layer's check that a question's passage really exists and is in
     the same subject. Null means the link is fine (or there is none). */
  function passageLinkError(rec, passages) {
    if (!rec || !rec.passageId) return null;
    var found = null;
    (passages || []).forEach(function (p) { if (Number(p.id) === Number(rec.passageId)) found = p; });
    if (!found) return 'That passage no longer exists.';
    if (found.subject !== rec.subject) return 'That passage belongs to ' + found.subject + ', not ' + rec.subject + '.';
    return null;
  }
  /* A question may be served only if it needs no passage, or its passage is
     there, live and in the same subject. A question whose passage has been
     switched off or deleted is held back rather than shown with no text. */
  function passageServable(q, passages) {
    if (!q || q.passageId === undefined || q.passageId === null) return true;
    var found = null;
    (passages || []).forEach(function (p) { if (Number(p.id) === Number(q.passageId)) found = p; });
    return !!found && found.active !== false && found.subject === q.subject;
  }
  /* The bank with every question whose passage cannot be shown taken out, so a
     run, a blueprint or a depth count never promises a question it cannot serve. */
  function servablePool(list, passages) {
    return (list || []).filter(function (q) { return questionIsLive(q) && passageServable(q, passages); });
  }
  /* Questions that share a passage stay together, in the order the passage's
     first question appeared; questions with no passage keep their place. This
     is what lets a run show the passage once above its questions. */
  function groupByPassage(list) {
    var out = [], at = {};
    (list || []).forEach(function (q) {
      var pid = q && q.passageId ? String(q.passageId) : '';
      if (!pid) { out.push(q); return; }
      if (at[pid] === undefined) { at[pid] = out.length; out.push({ __group: [q] }); }
      else out[at[pid]].__group.push(q);
    });
    var flat = [];
    out.forEach(function (x) { if (x && x.__group) x.__group.forEach(function (q) { flat.push(q); }); else flat.push(x); });
    return flat;
  }
  /* The same questions, each carrying its passage's title and text (a copy —
     the stored question is never changed). Questions without a passage, or whose
     passage is not live, are returned as they are. */
  function attachPassages(list, passages) {
    var by = {};
    (passages || []).forEach(function (p) { if (p && p.active !== false) by[String(p.id)] = p; });
    return (list || []).map(function (q) {
      var p = q && q.passageId ? by[String(q.passageId)] : null;
      if (!p || p.subject !== q.subject) return q;
      var c = {}; Object.keys(q).forEach(function (k) { c[k] = q[k]; });
      c.passage = { id: p.id, title: p.title, text: p.text };
      return c;
    });
  }
  /* How many live questions use each passage — so the console can say which
     passages are still unused before one is deleted. */
  function passageUsage(bank) {
    var by = {};
    (bank || []).forEach(function (q) {
      if (!q || q.active === false || !q.passageId) return;
      by[q.passageId] = (by[q.passageId] || 0) + 1;
    });
    return by;
  }

  /* ---------------------------------------------------------- question images
     A question may carry one picture — a circuit, a cell, a graph. The picture
     itself is a stored file (the data layer keeps it); the question holds only
     its id (`imageId`) and a plain-words description (`imageAlt`) that a screen
     reader speaks and that shows if the picture cannot load. A description is
     required whenever there is a picture, so no diagram ever reaches a student
     who cannot see it without a way to follow it. Only formats every phone
     draws safely are accepted — never SVG, which can carry script. */
  var IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  var IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  var IMAGE_ALT_MIN = 5, IMAGE_ALT_MAX = 300;
  /* Blank means "this question has no picture". Otherwise an id the upload
     step issued (QIMG- and 8–40 letters or digits); anything else is an error
     to be shown, never silently dropped. */
  function cleanImageId(v) {
    if (v === undefined || v === null || String(v).trim() === '') return { imageId: null };
    var s = String(v).trim();
    if (!/^QIMG-[A-Za-z0-9]{8,40}$/.test(s)) return { error: 'The picture must be one uploaded through the console.' };
    return { imageId: s };
  }
  /* The description is tidied (one line, single spaces) and, when a picture is
     attached, must say something. With no picture it is simply empty. */
  function cleanImageAlt(alt, hasImage) {
    var a = String(alt == null ? '' : alt).replace(/\s+/g, ' ').trim();
    if (!hasImage) return { imageAlt: '' };
    if (a.length < IMAGE_ALT_MIN) return { error: 'Describe the picture in words, for students who cannot see it.' };
    if (a.length > IMAGE_ALT_MAX) return { error: 'Keep the picture description under ' + IMAGE_ALT_MAX + ' characters.' };
    return { imageAlt: a };
  }
  /* The gate for an upload, judged from the file's declared type, name and
     size before a single byte is stored. The type must be one of the four and
     must agree with the file's extension, so a renamed document is refused. */
  function validateImageUpload(f) {
    var r = f || {};
    var type = String(r.type || '').toLowerCase().trim();
    var size = Number(r.size);
    var ext = IMAGE_TYPES[type];
    if (!ext) return { error: 'Use a PNG, JPG, GIF or WebP picture.' };
    if (!isFinite(size) || size <= 0) return { error: 'That picture is empty.' };
    if (size > IMAGE_MAX_BYTES) return { error: 'The picture is too large — keep it under ' + Math.round(IMAGE_MAX_BYTES / 1048576) + ' MB.' };
    var m = /\.([A-Za-z0-9]+)$/.exec(String(r.name || ''));
    if (m) {
      var e = m[1].toLowerCase(); if (e === 'jpeg') e = 'jpg';
      if (e !== ext) return { error: 'The file name does not match a ' + ext.toUpperCase() + ' picture.' };
    }
    return { ok: { type: type, ext: ext, size: size } };
  }

  function validateQuestion(d) {
    var r = d || {};
    var subject = String(r.subject || '').trim();
    var section = String(r.section || '').trim();
    var kind = section === 'theory' ? 'theory' : 'objective';
    var text = String(r.text || '').trim();
    if (ALL_SUBJECTS.indexOf(subject) === -1) return { error: 'Choose one of the academy’s subjects.' };
    if (SECTIONS.indexOf(section) === -1) return { error: 'Choose a section: theory, objective, JAMB-oriented or practice-only.' };
    if (section === 'theory' && !theoryAllowed(subject)) return { error: noTheoryMessage(subject) };
    if (text.length < 8) return { error: 'Write the full question text.' };
    /* The year is a Practice-only field: any other section stores none, so a
       year can never ride along on a JAMB-oriented or Objective question. */
    var yr = section === 'practice' ? cleanQuestionYear(r.year) : { year: null };
    if (yr.error) return { error: yr.error };
    var pa = kind === 'objective' ? cleanPassageId(r.passageId) : { passageId: null };
    if (pa.error) return { error: pa.error };
    /* A picture may go with any kind of question (a theory diagram as much as
       an objective one); the description travels with it. */
    var im = cleanImageId(r.imageId);
    if (im.error) return { error: im.error };
    var al = cleanImageAlt(r.imageAlt, !!im.imageId);
    if (al.error) return { error: al.error };
    var rec = {
      id: r.id, subject: subject, topic: String(r.topic || 'General').trim(),
      kind: kind, section: section, period: PERIOD, text: text,
      difficulty: QUESTION_DIFFICULTIES.indexOf(String(r.difficulty)) === -1 ? 'medium' : String(r.difficulty),
      explanation: String(r.explanation || '').trim(),
      year: yr.year,
      passageId: pa.passageId,
      imageId: im.imageId,
      imageAlt: al.imageAlt,
      active: r.active === undefined ? true : !!r.active
    };
    if (kind === 'objective') {
      var opts = (r.options || []).map(function (o) { return String(o == null ? '' : o).trim(); })
                                  .filter(function (o) { return o.length > 0; });
      if (opts.length < 2) return { error: 'An objective question needs at least two options.' };
      if (opts.length > 5) return { error: 'An objective question can have at most five options.' };
      var ans = Number(r.answer);
      if (isNaN(ans) || ans < 0 || ans >= opts.length) return { error: 'Mark which option is the correct answer.' };
      rec.options = opts; rec.answer = ans; rec.expected = ''; rec.maxMark = 1;
    } else {
      var exp = String(r.expected || '').trim();
      var mm = Number(r.maxMark);
      if (exp.length < 8) return { error: 'Add the expected/reference answer the marker will compare against.' };
      if (isNaN(mm) || mm < 1 || mm > 100) return { error: 'Set a maximum mark between 1 and 100.' };
      rec.options = []; rec.answer = null; rec.expected = exp; rec.maxMark = Math.round(mm);
    }
    return { rec: rec };
  }

  /* Notes the pilot starts with, so Reading mode is not empty on day one. They
     are foundational on purpose and are meant to be replaced and extended by the
     academy through the console, which is why they live in the same shape as an
     imported note rather than being hard-coded into a screen. */
  var noteSeq = 0;
  function nt(subject, topic, title, body) {
    return { id: ++noteSeq, subject: subject, topic: topic, title: title, body: body, minutes: Math.max(1, Math.round(body.split(/\s+/).length / 180)), active: true };
  }
  var NOTES = [
    nt(ENGLISH, 'Concord', 'Subject–Verb Agreement',
      'A verb must agree with its subject in number: a singular subject takes a singular verb, and a plural subject takes a plural verb. The difficulty is finding the real subject, because words often sit between it and the verb.\n\n' +
      'In "the box of pencils is on the table", the subject is "box", not "pencils" — the phrase "of pencils" does not change the number.\n\n' +
      'Subjects joined by "and" are plural, but subjects joined by "or", "either...or" or "neither...nor" agree with the part nearest the verb. Words like everyone, each, nobody and somebody are singular, however plural they feel.\n\n' +
      'Exam tip: read past the words between the subject and the verb before you choose.'),
    nt(ENGLISH, 'Lexis & Structure', 'Reading for the Nearest Meaning',
      'Lexis questions ask for the option nearest in meaning to a word as it is used in the sentence, not its dictionary meaning in general. The sentence is the evidence.\n\n' +
      'Work in three steps. First read the whole sentence and decide whether the word is positive, negative or neutral. Second, eliminate the options that carry the wrong feeling. Third, test the remaining options by substituting each one into the sentence.\n\n' +
      'Exam tip: an option that is a synonym in some other context is the commonest trap. Substitution catches it.'),
    nt('Mathematics', 'Quadratic Equations', 'Quadratic Equations',
      'A quadratic equation has the form $ax^2 + bx + c = 0$, where $a$ is not zero. You can solve it by factorising, by completing the square, or with the quadratic formula, which always works:\n\n' +
      '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n' +
      'The part under the root, $b^2 - 4ac$, is the discriminant. If it is positive there are two distinct real roots; if it is zero the roots are equal; if it is negative there are no real roots.\n\n' +
      'Exam tip: try factorising first. It is faster than the formula when the numbers are small, and most examination questions are built to factorise.'),
    nt('Mathematics', 'Indices', 'The Laws of Indices',
      'Indices are a shorthand for repeated multiplication, and every rule follows from that. Multiplying powers of the same base adds the indices, $a^m \\times a^n = a^{m+n}$; dividing subtracts them, $a^m \\div a^n = a^{m-n}$; raising a power to a power multiplies them, $(a^m)^n = a^{mn}$.\n\n' +
      'Two special cases are worth memorising because they are tested constantly. Any non-zero number to the power zero is 1, so $a^0 = 1$. A negative index means a reciprocal, so $2^{-3} = \\frac{1}{8}$. A fractional index is a root: $8^{\\frac{1}{3}} = 2$.\n\n' +
      'Exam tip: write every number in the question to the same base before you start. Most index questions collapse in one line once you do.'),
    nt('Physics', 'Motion', 'Acceleration',
      'Acceleration is the rate of change of velocity with time. It is a vector, so it has both a size and a direction: an object slowing down is still accelerating, just in the direction opposite to its motion.\n\n' +
      'For uniform acceleration, $a = \\frac{v - u}{t}$, where $u$ is the initial velocity, $v$ the final velocity and $t$ the time taken. The SI unit is the metre per second squared, $\\text{m/s}^2$.\n\n' +
      'On a velocity-time graph, the acceleration is the gradient of the line and the area under the line is the distance travelled.\n\n' +
      'Exam tip: check the units before you calculate. A velocity given in km/h must be divided by 3.6 to become m/s.'),
    nt('Physics', 'Electricity', 'Ohm’s Law',
      'Ohm’s law states that the current through a conductor is directly proportional to the potential difference across it, provided the temperature stays constant. In symbols, $V = IR$.\n\n' +
      'In a series circuit the current is the same everywhere and the resistances add, $R = R_1 + R_2$. In a parallel circuit the potential difference is the same across each branch, and the reciprocals of the resistances add: $\\frac{1}{R} = \\frac{1}{R_1} + \\frac{1}{R_2}$.\n\n' +
      'Exam tip: redraw the circuit before you calculate. Most mistakes in this topic are mistakes about which components are in series and which are in parallel, not about arithmetic.'),
    nt('Chemistry', 'Organic Chemistry', 'Alkanes',
      'Alkanes are saturated hydrocarbons: they contain only carbon and hydrogen joined by single covalent bonds. Because every carbon carries as many hydrogen atoms as possible, they are described as saturated.\n\n' +
      'Their general formula is $C_nH_{2n+2}$, which lets you work out any member. When $n = 1$ you get methane, $CH_4$; when $n = 2$ you get ethane, $C_2H_6$; when $n = 3$, propane, $C_3H_8$.\n\n' +
      'Alkanes are generally unreactive, but they burn in air and undergo substitution reactions with halogens in the presence of sunlight.\n\n' +
      'Exam tip: memorise the first four names in order — methane, ethane, propane, butane.'),
    nt('Chemistry', 'Mole Concept', 'Moles and the Avogadro Constant',
      'A mole is an amount of substance containing as many particles as there are atoms in 12 g of carbon-12: $6.02 \\times 10^{23}$ particles, the Avogadro constant.\n\n' +
      'Three relationships do most of the work. Number of moles equals mass divided by molar mass, $n = \\frac{m}{M}$. Number of moles equals number of particles divided by the Avogadro constant, $n = \\frac{N}{N_A}$. For a gas at s.t.p., number of moles equals volume divided by $22.4\\ \\text{dm}^3$.\n\n' +
      'Exam tip: write down which of the three you have been given before choosing a formula. Nearly every mole calculation is one of these three, or two of them joined by a balanced equation.'),
    nt('Biology', 'Cell Biology', 'The Cell as a Unit of Life',
      'The cell is the basic structural and functional unit of all living things. Plant and animal cells share a nucleus, cytoplasm and a cell membrane, but a plant cell also has a cellulose cell wall, chloroplasts and a large central vacuole.\n\n' +
      'The nucleus holds the chromosomes and controls the activities of the cell. The mitochondrion releases energy from food in respiration, which is why hard-working cells such as muscle and liver cells contain very many of them.\n\n' +
      'Exam tip: questions often turn on a single difference. Chloroplasts and a cellulose wall are plant only; centrioles are animal only.'),
    nt('Biology', 'Plant Nutrition', 'Photosynthesis',
      'Photosynthesis is the process by which green plants make glucose from carbon dioxide and water using light energy trapped by chlorophyll, releasing oxygen as a by-product.\n\n' +
      'It happens in two stages. The light stage splits water and stores energy; the dark stage uses that energy to fix carbon dioxide into sugar. The rate is limited by whichever factor is in shortest supply — light intensity, carbon dioxide concentration or temperature.\n\n' +
      'Exam tip: a graph in this topic is almost always about a limiting factor. Look for where the curve levels off and ask what has run short.')
  ];

  /* -------------------------------------------------- reading-mode notes
     A note is what the student reads in Reading mode. It is deliberately a
     separate record from a question: management writes or imports notes per
     subject and topic, and a student picks a subject, then a topic, then reads.
     Body is plain text — paragraphs separated by a blank line — because notes
     arrive by CSV or by typing and unfiltered HTML from a spreadsheet has no
     business being written into the page. */

  function validateNote(d) {
    var r = d || {};
    var subject = String(r.subject || '').trim();
    var topic = String(r.topic || '').trim();
    var title = String(r.title || '').trim();
    var body = String(r.body || '').replace(/\r\n/g, '\n').trim();
    if (ALL_SUBJECTS.indexOf(subject) === -1) return { error: 'Choose one of the academy’s subjects.' };
    if (topic.length < 2) return { error: 'Give the note a topic — that is what the student picks.' };
    if (title.length < 3) return { error: 'Give the note a title.' };
    if (body.length < 40) return { error: 'The note is too short to read — write at least a paragraph.' };
    return {
      rec: {
        id: r.id, subject: subject, topic: topic, title: title, body: body,
        minutes: Math.max(1, Math.min(120, Math.round(Number(r.minutes) || Math.max(1, Math.round(body.split(/\s+/).length / 180))))),
        active: r.active === undefined ? true : !!r.active
      }
    };
  }

  /* ------------------------------------------------------ CSV import
     Typing a question bank one question at a time is the slowest part of
     running the academy, so management may paste or open a spreadsheet
     instead. The parsing lives here, next to the validators, because the
     browser and the server must accept and refuse exactly the same file.

     Nothing is trusted: every row goes through validateQuestion or
     validateNote, the same gate a typed record passes. A bad row is reported
     by its line number and skipped — a file is never half-refused. */

  var CSV_MAX_ROWS = 500;
  var CSV_QUESTION_HEADER =
    'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active,year,passageId';
  var CSV_NOTE_HEADER = 'subject,topic,title,body,minutes,active';
  /* The difficulty values the importer and every typed question accept. Kept in
     one place so the tutor question-writing kit (4.D) cannot drift from it. */
  var QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'];

  /* --------------------------------------------- tutor question-writing kit (4.D)
     A ready-made set of instructions a tutor pastes into their own AI (Claude,
     ChatGPT…) together with their material; the AI returns CSV in exactly the
     Hub's import format, which the tutor pastes into the existing import box. No
     AI runs in the Hub. The column list and the difficulty values are taken from
     the SAME constants the importer reads (CSV_QUESTION_HEADER,
     QUESTION_DIFFICULTIES), so the kit can never drift from what import accepts
     — test/test-tutor-kit.js fails if it ever does. */
  function tutorKitColumns() {
    var cols = CSV_QUESTION_HEADER.split(',');
    var end = cols.indexOf('explanation');
    return end === -1 ? cols : cols.slice(0, end + 1);
  }
  function tutorKitInstructions(opts) {
    var o = opts || {};
    var subject = String(o.subject || '').trim() || 'this subject';
    var topics = String(o.topics || '').trim();
    var header = tutorKitColumns().join(',');
    var diffs = QUESTION_DIFFICULTIES.join(', ');
    var isMaths = /^math/i.test(subject);
    var L = [];
    L.push('Act as an expert JAMB examiner and question-setter for ' + subject + ', with');
    L.push('many years of experience writing UTME papers. You are helping a tutor at');
    L.push('G.O.C Academy write practice questions.');
    L.push('');
    L.push('Match the current JAMB UTME ' + subject + ' syllabus and the real JAMB style');
    L.push('closely: the wording, the level, the way a question is framed, and the');
    L.push('topics a candidate is expected to know. Do not go beyond the syllabus.');
    L.push('');
    L.push('I will give you material: notes, a textbook page, a past paper, or photos');
    L.push('of pages.');
    L.push('- If it is a past paper, you may use its questions as they are. Copy the');
    L.push('  wording exactly, and work out each answer yourself if none is given.');
    L.push('- If it is notes or a textbook, write new questions based on it. Do not');
    L.push("  copy the textbook's own sentences.");
    L.push('');
    L.push('Question quality rules:');
    L.push('- Exactly one option is clearly correct. The others are clearly wrong');
    L.push('  to a student who knows the topic.');
    L.push('- Base each wrong option on a common student mistake or misconception.');
    L.push('- Keep the options similar in length and wording, so the right answer');
    L.push('  does not stand out.');
    L.push('');
    L.push('Before you reply, silently check every question: work out the answer');
    L.push('yourself, confirm it matches the marked answer, and fix any error. Do not');
    L.push('mention this check in your reply.');
    L.push('');
    L.push('Reply with CSV only, inside one code block, no commentary. The first line');
    L.push('must be exactly:');
    L.push('');
    L.push(header);
    L.push('');
    L.push('Rules for every row:');
    L.push('- subject: always ' + subject);
    L.push('- section: objective (the general bank), jamb (a separate JAMB-style bank;');
    L.push('  never put the same question in both) or theory. Ask me which if I have');
    L.push('  not said.' + (isMaths ? ' ' + subject + ' has no theory paper, so never write theory rows.' : ''));
    L.push('- topic: spell and capitalise it the same way on every row');
    L.push('- text: the question');
    L.push('- difficulty: ' + diffs);
    L.push('- explanation: one or two sentences saying why the answer is right');
    L.push('- Put any field containing a comma in double quotes. Write a double quote');
    L.push('  inside a field as two double quotes. One question per row.');
    L.push('');
    L.push('Objective and jamb rows: fill optionA to optionD (optionE may be blank),');
    L.push('set answer to a single letter, leave expected and maxMark blank.');
    L.push('Theory rows: leave the options and answer blank, put a model answer in');
    L.push('expected, and a whole-number mark in maxMark.');
    L.push('');
    L.push('Topics to set questions from: ' + (topics || '(none given yet)'));
    if (topics) {
      L.push('Use only these topics. If there is more than one, spread the questions');
      L.push('across them.');
    } else {
      L.push('I have not named a topic yet — ask me for the topic or topics before you');
      L.push('write anything.');
    }
    L.push('Also ask how many questions I want and the difficulty, if I have not said.');
    return L.join('\n');
  }
  /* Three example rows for the downloadable template, in the kit's column order. */
  function tutorKitTemplate() {
    var header = tutorKitColumns().join(',');
    var rows = [
      'Chemistry,objective,Acids and bases,"What is the pH of a neutral solution at 25 degrees C?",5,7,9,14,,B,,,easy,A neutral solution has equal H+ and OH- so its pH is 7.',
      'Chemistry,jamb,Stoichiometry,"How many moles are in 44 g of CO2 (molar mass 44 g/mol)?",0.5,1,2,4,,B,,,medium,Moles = mass / molar mass = 44/44 = 1 mol.',
      'Chemistry,theory,Organic chemistry,"State and explain Markovnikov\'s rule with one example.",,,,,,,"Markovnikov: the H adds to the carbon with more H already; e.g. HBr + propene gives 2-bromopropane.",5,hard,Looks for the rule plus a correct worked example.'
    ];
    return header + '\n' + rows.join('\n');
  }


  /* A real CSV reader: quoted fields, doubled quotes, commas and line breaks
     inside a cell. A note body is a paragraph or two, so line breaks inside a
     quoted cell are the normal case here, not the exotic one. */
  function parseCSV(text) {
    var src = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var rows = [], row = [], cell = '', quoted = false, i, ch;
    for (i = 0; i < src.length; i++) {
      ch = src.charAt(i);
      if (quoted) {
        if (ch === '"' && src.charAt(i + 1) === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; }
        else { cell += ch; }
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === ',') { row.push(cell); cell = ''; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    row.push(cell); rows.push(row);
    while (rows.length && blankRow(rows[rows.length - 1])) rows.pop();
    return rows;
  }
  function blankRow(r) {
    return (r || []).every(function (c) { return String(c == null ? '' : c).trim() === ''; });
  }
  /* Headings are matched loosely — 'Max Mark', 'max_mark' and 'maxmark' are one
     column, because a spreadsheet exported by a person is not a schema. */
  function csvKey(h) { return String(h == null ? '' : h).trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function csvRows(text) {
    var grid = parseCSV(text);
    if (!grid.length || blankRow(grid[0])) return { error: 'That file is empty — the first line must name the columns.' };
    var header = grid[0].map(csvKey);
    var rows = [], r, c, o;
    for (r = 1; r < grid.length; r++) {
      if (blankRow(grid[r])) continue;
      o = { line: r + 1 };
      for (c = 0; c < header.length; c++) {
        if (header[c]) o[header[c]] = String(grid[r][c] == null ? '' : grid[r][c]).trim();
      }
      rows.push(o);
    }
    return { header: header, rows: rows };
  }

  function csvFlag(v, dflt) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return dflt;
    return ['no', 'false', '0', 'n', 'off', 'draft', 'held', 'inactive', 'hidden'].indexOf(s) === -1;
  }
  /* The eight option cells exactly as laid out in the file, blanks kept, so
     a letter can be read against the column the author meant. */
  function csvOptionCols(row) {
    var out = [], letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], i, v;
    for (i = 0; i < letters.length; i++) {
      v = row['option' + letters[i]];
      if (v === undefined) v = row['opt' + letters[i]];
      if (v === undefined) v = row['option' + (i + 1)];
      if (v === undefined) v = row['choice' + letters[i]];
      out.push(v === undefined ? '' : String(v).trim());
    }
    return out;
  }
  function csvOptions(row) {
    return csvOptionCols(row).filter(function (o) { return o; });
  }
  /* Which option is correct. The answer may be a letter (A-H, read against
     the original option column), a column number from 1, or the text of the
     correct option. Never guessed: when the readings disagree (an answer of
     4 beside options 2, 4, 6, 8 is both "option 4" and the value 4), or two
     options share the same wording, or nothing matches, the row is refused
     with a reason. Returns { index } (position among the non-blank options)
     or { error }. */
  function csvResolveAnswer(v, cols) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return { index: -1 };
    var at = [], i;                       /* column -> position among non-blank options */
    for (i = 0; i < cols.length; i++) at.push(cols[i] ? at.filter(function (x) { return x !== -1; }).length : -1);
    var positional = null, label = '';
    var up = s.toUpperCase();
    var col = -1;
    if (up.length === 1 && up >= 'A' && up <= 'H') { col = up.charCodeAt(0) - 65; label = 'Option ' + up; }
    else if (/^[1-8]$/.test(s)) { col = Number(s) - 1; label = 'Option ' + s; }
    if (col > -1) {
      if (at[col] === -1) return { error: label + ' is named as the answer, but that option cell is empty.' };
      positional = at[col];
    }
    var hits = [];
    /* A one-letter answer is read as a letter unless an option is worded with
       that very letter, in the same case (options u, v, a, s beside answer A
       is the letter A, not the option "a"). */
    var letterAns = col > -1 && up.length === 1 && /[A-Za-z]/.test(s);
    cols.forEach(function (o, c) {
      if (o && (letterAns ? o === s : o.toLowerCase() === s.toLowerCase())) hits.push(at[c]);
    });
    if (hits.length > 1) {
      if (positional !== null && hits.indexOf(positional) > -1) return { index: positional };
      return { error: 'Two options have the same wording as the answer "' + s + '" — give the answer as a letter.' };
    }
    if (hits.length === 1) {
      if (positional !== null && positional !== hits[0]) {
        return { error: 'The answer "' + s + '" could mean ' + label + ' or the option worded "' + s + '" — give the answer as a letter.' };
      }
      return { index: hits[0] };
    }
    if (positional !== null) return { index: positional };
    return { error: 'The answer "' + s + '" matches none of the options — give it as a letter, A to ' + String.fromCharCode(64 + Math.max(2, cols.filter(function (o) { return o; }).length)) + '.' };
  }
  function csvSection(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();

    /* Normalize canonical values and common CSV-friendly aliases.
       Unknown sections stay invalid; never silently convert them to
       objective because that could publish a question into the wrong bank. */
    if (s === 'obj') s = 'objective';
    if (s === 'thy' || s === 'essay' || s === 'written') s = 'theory';
    if (s === 'jamb-oriented' || s === 'jamb oriented' || s === 'jamboriented') s = 'jamb';
    if (s === 'prac' || s === 'practiceonly' || s === 'practice-only' || s === 'practice only') s = 'practice';

    if (SECTIONS.indexOf(s) === -1) return '';
    return s;
  }
  function csvQuestion(row) {
    var r = row || {};
    var cols = csvOptionCols(r);
    var opts = csvOptions(r);
    var text = r.text !== undefined ? r.text : (r.question !== undefined ? r.question : '');
    var subject = r.subject || '';
    var explanation = r.explanation || r.why || '';
    var expected = r.expected || r.reference || r.answer || '';
    /* Bare, un-delimited LaTeX (no $ ... $ around it) only gets auto-formatted
       for Physics — that is where the academy's raw pastes from a solutions
       manual or Word's equation editor turn up; see autoFormatBareLatex just
       above renderMath. Every other subject's text passes through exactly as
       typed, the same as before this existed. */
    /* Read the answer from the raw cells, before any reformatting below. */
    var rawAnswer = r.answer !== undefined ? r.answer : r.correct;
    var resolved = opts.length ? csvResolveAnswer(rawAnswer, cols) : { index: -1 };
    if (String(subject).trim().toLowerCase() === 'physics') {
      text = autoFormatBareLatex(text);
      explanation = autoFormatBareLatex(explanation);
      expected = autoFormatBareLatex(expected);
      opts = opts.map(autoFormatBareLatex);
    }
    return {
      subject: subject, section: csvSection(r.section || r.session),
      topic: r.topic || 'General', text: text, options: opts,
      answer: resolved.index === undefined ? -1 : resolved.index,
      answerError: resolved.error || '',
      expected: expected,
      maxMark: r.maxmark !== undefined ? r.maxmark : r.marks,
      difficulty: String(r.difficulty || 'medium').trim().toLowerCase(),
      explanation: explanation,
      active: csvFlag(r.active, true),
      year: r.year,    // Practice rows only — validateQuestion drops it for any other section
      passageId: r.passageid !== undefined ? r.passageid : r.passage   // an objective row's passage, by id
    };
  }
  function csvNote(row) {
    var r = row || {};
    var body = r.body !== undefined ? r.body : (r.note !== undefined ? r.note : (r.content || ''));
    return {
      subject: r.subject || '', topic: r.topic || '',
      title: autoFormatBareLatex(r.title || r.heading || ''),
      /* A spreadsheet cell usually carries the paragraph break as the two
         characters \n rather than a real line break. Both are accepted. */
      body: autoFormatBareLatex(String(body).replace(/\\n/g, '\n')),
      minutes: r.minutes !== undefined ? r.minutes : r.mins,
      active: csvFlag(r.active, true)
    };
  }

  /* A short, deterministic fingerprint of a CSV file's raw text — used only to
     recognise "this exact file was already imported" (see logImport in
     server.js and the offline driver's mirror of it). Not cryptographic: it
     only has to agree with itself across the server and the browser mock, the
     same way every other piece of shared arithmetic in this file does. FNV-1a
     over the untouched text, so trailing-whitespace or line-ending changes
     that would actually change what gets published also change the hash. */
  function csvFingerprint(text) {
    var s = String(text == null ? '' : text);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* target (questions only, optional): { subject, section, stampSection } the
     admin chose on the import screen before picking a file.

     existing (optional): the records already published for this kind (the
     server's db.questions/db.notes, or the offline mock's own arrays), used
     only for duplicate detection — see dupKey below. Omitted, duplicate
     detection still runs within the file itself, just with nothing to check
     it against from before this run.

     Two modes, chosen by stampSection:
       - reject (stampSection falsy, the original and still the default):
         subject and section are each checked independently, and a row whose
         own subject/section (read from the CSV the same way csvQuestion
         always has) doesn't match whichever of the two was chosen is refused
         and reported by line number rather than imported under the file's
         own claim — "reject", not "stamp", was the behaviour picked in
         REMAINING-TASKS-AFTER-TASK-5-CSV-TARGET.txt, on the reasoning that
         silently overwriting what a row says is easier to miss than a
         refusal called out by line number. Choosing only a section (subject
         left on "Any") is how every subject's rows already filed under that
         section get imported in one run, rather than one subject at a time.
       - stamp (stampSection true, section required, subject optional): this
         is how the same question set gets imported once for the Web Test and
         again for Practice without hand-editing the file's section column
         for every row — every row that is kept (all of them, or only the
         rows matching an optionally-chosen subject) has its section
         overwritten to the one chosen here, whatever the file said. Subject
         is never stamped, only rejected when given, since a mixed-subject
         file importing into one target subject would otherwise mislabel a
         question's actual subject.
     Omitted (or notes) means unchanged, file-decides-everything behaviour, so
     every caller that predates the subject/section pickers keeps working
     exactly as before. */
  /* What a replacement writes over an existing question: everything the file
     states, but never the id, the picture, or whether the question is live -
     a file has no say in those. */
  function replacementPatch(rec) {
    var out = {}, k;
    for (k in rec) {
      if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
      if (k === 'id' || k === 'imageId' || k === 'imageAlt' || k === 'active') continue;
      out[k] = rec[k];
    }
    return out;
  }
  /* One row of the import preview: the question as it WILL be saved (options in
     file order, the option the answer resolved to) plus plain-words flags for
     anything the author should look at before pressing Import. A flag never
     blocks the import; a row that cannot be read at all is reported as an error
     instead and never reaches here. */
  function previewRow(row, draft, rec) {
    var flags = [];
    if (rec.kind === 'objective' || (rec.options && rec.options.length)) {
      var cols = csvOptionCols(row), seenBlank = false, gap = false;
      cols.forEach(function (o) { if (!o) seenBlank = true; else if (seenBlank) gap = true; });
      if (gap) flags.push('An option cell is empty between filled ones — the options were closed up, so check the marked answer.');
      var raw = String(row.answer !== undefined ? row.answer : (row.correct !== undefined ? row.correct : '')).trim();
      if (raw && !/^[A-Ha-h]$/.test(raw)) {
        flags.push('The answer was written as "' + raw + '", not a letter — it was read as option ' + String.fromCharCode(65 + rec.answer) + '.');
      }
      if (!String(rec.explanation || '').trim()) flags.push('No explanation.');
    }
    return {
      line: row.line, subject: rec.subject, section: rec.section, topic: rec.topic, text: rec.text,
      options: (rec.options || []).slice(), answer: rec.answer, explanation: rec.explanation || '', flags: flags
    };
  }
  /* Phase 3E.C slice 4 - "Check what is in the bank". A list of the newest objective questions with the marked
     answer beside the explanation, so a question whose answer was read wrongly by an old import can be found and
     fixed. Pure: it reads the bank it is given and changes nothing. Newest first by id (a console import has no
     timestamp). A row is flagged only on evidence in the question itself:
       - no explanation (nothing to compare the answer with);
       - the explanation names the value of ANOTHER option (a whole number or word) but not the marked answer;
       - the same wording appears on two options (the answer could be either);
       - the marked answer points at no option.
     A flag means "have a look", never "wrong". Theory, practice-less and switched-off rows are still listed. */
  function answerCheckTokens(t) {
    return String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9.\-\s]/g, ' ').split(/\s+/)
      .map(function (w) { return w.replace(/^[.\-]+|[.\-]+$/g, ''); }).filter(Boolean);
  }
  function answerCheckHas(expl, optText) {
    var e = ' ' + answerCheckTokens(expl).join(' ') + ' ', o = answerCheckTokens(optText).join(' ');
    return !!o && e.indexOf(' ' + o + ' ') >= 0;
  }
  function answerCheckFlags(q) {
    var flags = [], opts = (q.options || []).map(function (o) { return String(o == null ? '' : o); });
    var ans = q.answer;
    if (typeof ans !== 'number' || ans < 0 || ans >= opts.length || ans !== Math.floor(ans)) {
      return ['The marked answer does not point at any option.'];
    }
    var seen = {}, dup = false;
    opts.forEach(function (o) { var k = o.trim().toLowerCase(); if (k) { if (seen[k]) dup = true; seen[k] = true; } });
    if (dup) flags.push('Two options have the same wording, so the marked answer could be either.');
    var expl = String(q.explanation == null ? '' : q.explanation).trim();
    if (!expl) { flags.push('No explanation to check the answer against.'); return flags; }
    if (!answerCheckHas(expl, opts[ans])) {
      var other = [];
      opts.forEach(function (o, i) { if (i !== ans && o.trim() && !dup && answerCheckHas(expl, o)) other.push(String.fromCharCode(65 + i)); });
      if (other.length) flags.push('The explanation mentions option ' + other.join(', ') + ' but not the marked answer (' + String.fromCharCode(65 + ans) + ').');
    }
    return flags;
  }
  function answerCheckList(bank, opts) {
    opts = opts || {};
    var limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit)) || 20));
    var rows = (bank || []).filter(function (q) {
      if (!q || q.kind === 'theory' || q.section === 'theory' || q.section === 'practice') return false;
      if (!Array.isArray(q.options) || !q.options.length) return false;
      return !opts.subject || q.subject === opts.subject;
    }).sort(function (a, b) { return Number(b.id) - Number(a.id) || String(b.id).localeCompare(String(a.id)); });
    var total = rows.length;
    var out = rows.slice(0, limit).map(function (q) {
      var flags = answerCheckFlags(q);
      return { id: q.id, subject: q.subject, section: q.section, topic: q.topic || '', text: q.text || '', options: q.options.slice(),
               answer: q.answer, explanation: q.explanation || '', active: q.active !== false, flags: flags };
    });
    var onlyFlagged = !!opts.flaggedOnly;
    var shown = onlyFlagged ? out.filter(function (r) { return r.flags.length; }) : out;
    return { total: total, checked: out.length, flagged: out.filter(function (r) { return r.flags.length; }).length, rows: shown };
  }

  function importCSV(kind, text, target, existing, passages, opts) {
    var notesFile = String(kind) === 'notes';
    var parsed = csvRows(text);
    if (parsed.error) return { error: parsed.error };
    if (!parsed.rows.length) return { error: 'That file names its columns but holds no rows.' };
    if (parsed.rows.length > CSV_MAX_ROWS) {
      return { error: 'Import at most ' + CSV_MAX_ROWS + ' rows at a time — this file holds ' + parsed.rows.length + '.' };
    }
    var need = notesFile ? ['subject', 'topic', 'title', 'body'] : ['subject', 'text'];
    var missing = need.filter(function (c) { return parsed.header.indexOf(c) === -1; });
    if (missing.length) {
      return { error: 'The file is missing a column: ' + missing.join(', ') + '. Expected ' +
                      (notesFile ? CSV_NOTE_HEADER : CSV_QUESTION_HEADER) + '.' };
    }
    var tSubject = null, tSection = null, stamp = false;
    if (!notesFile && target && target.stampSection) {
      if (!target.section) return { error: 'Choose a section to import into: theory, objective, JAMB-oriented or practice-only.' };
      tSection = csvSection(target.section);
      if (SECTIONS.indexOf(tSection) === -1) return { error: 'Choose a section to import into: theory, objective, JAMB-oriented or practice-only.' };
      stamp = true;
      if (target.subject) {
        tSubject = String(target.subject).trim();
        if (ALL_SUBJECTS.indexOf(tSubject) === -1) return { error: 'Choose one of the academy’s subjects to import into.' };
      }
    } else if (!notesFile && target && (target.subject || target.section)) {
      /* Non-stamp mode, on purpose independent per field: a subject on its own
         restricts every row to that subject regardless of section, a section
         on its own restricts every row to that section regardless of
         subject (this is "all subjects into a section" — the CSV import
         screen's "Any subject" option paired with a specific section), and
         both together restrict to that exact pairing. Previously this branch
         demanded both be chosen together, which silently refused the
         subject-left-on-"Any" case with "Choose one of the academy's
         subjects to import into" even though the screen's own note says
         picking just a section is a supported way to import a file. */
      if (target.subject) {
        tSubject = String(target.subject).trim();
        if (ALL_SUBJECTS.indexOf(tSubject) === -1) return { error: 'Choose one of the academy’s subjects to import into.' };
      }
      if (target.section) {
        tSection = csvSection(target.section);
        if (SECTIONS.indexOf(tSection) === -1) return { error: 'Choose a section to import into: theory, objective, JAMB-oriented or practice-only.' };
      }
    }
    /* Duplicate detection, questions and notes alike: a row is a duplicate
       when it matches either a record already published (existing, passed by
       the caller — the server's own bank, or the offline mock's) or an
       earlier row in this very file, so a file that repeats itself doesn't
       publish the same record twice in one run either. A duplicate is
       reported and skipped exactly like any other row that fails a check —
       the rows around it that are genuinely unique still import normally.
       Matching is on subject + topic/section + the question text or note
       title, case- and whitespace-insensitive, never on the generated id, so
       the same wording pasted twice (or re-pasted after the id changed) is
       still caught. Section is part of a question's key on purpose: the same
       question stamped once into objective and again into practice (see
       "stamp" above) is a deliberate, legitimate reuse, not a duplicate. */
    function dupNorm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
    /* A note's key is its body, not its title: two notes can legitimately share
       a subject/topic/title — a starter note and a later, better-written
       replacement on the very same topic, say — and are only truly the same
       note when what the student actually reads is the same. */
    function dupKey(rec) {
      return notesFile
        ? dupNorm(rec.subject) + '|' + dupNorm(rec.topic) + '|' + dupNorm(rec.body)
        : dupNorm(rec.subject) + '|' + dupNorm(rec.section) + '|' + dupNorm(rec.text);
    }
    var seenExisting = {}, existingRec = {};
    (existing || []).forEach(function (rec) {
      var k = dupKey(rec);
      if (!seenExisting[k]) existingRec[k] = rec;          /* the first match is the one replaced */
      seenExisting[k] = true;
    });
    var seenInFile = {};
    var records = [], errors = [], replacements = [];
    var wantPreview = !!(opts && opts.preview), preview = [];
    /* Replace mode (questions only): a row matching a question already in the bank
       corrects THAT question in place - same id, so bookmarks and past papers still
       point at it - instead of being skipped as a duplicate. */
    var wantReplace = !!(opts && opts.replace) && !notesFile;
    parsed.rows.forEach(function (row) {
      var draft = notesFile ? csvNote(row) : csvQuestion(row);
      if (stamp) {
        if (tSubject !== null) {
          var stampRowSubject = String(draft.subject || '').trim();
          if (stampRowSubject.toLowerCase() !== tSubject.toLowerCase()) {
            errors.push({ line: row.line, error: 'Row is filed under ' + (stampRowSubject || 'no subject') +
                          ', not the chosen ' + tSubject + ' — skipped.' });
            return;
          }
        }
        draft.section = tSection;
      } else if (tSubject !== null || tSection !== null) {
        var rowSubject = String(draft.subject || '').trim();
        var subjOk = tSubject === null || rowSubject.toLowerCase() === tSubject.toLowerCase();
        var secOk = tSection === null || draft.section === tSection;
        if (!subjOk || !secOk) {
          errors.push({ line: row.line, error: 'Row is ' + (rowSubject || 'no subject') + ' / ' + (draft.section || 'no section') +
                        ', not the chosen ' + (tSubject !== null ? tSubject : 'any subject') + ' / ' +
                        (tSection !== null ? tSection : 'any section') + ' — skipped.' });
          return;
        }
      }
      if (!notesFile && draft.answerError) { errors.push({ line: row.line, error: draft.answerError.replace(/\.$/, '') + ' — skipped.' }); return; }
      var v = notesFile ? validateNote(draft) : validateQuestion(draft);
      if (v.error) { errors.push({ line: row.line, error: v.error }); return; }
      /* A row naming a passage is only accepted when the caller supplied the
         passages and that one exists in the row's subject. */
      if (!notesFile && v.rec.passageId && !wantPreview) {
        var pl = passageLinkError(v.rec, passages);
        if (pl) { errors.push({ line: row.line, error: pl + ' — skipped.' }); return; }
      }
      var key = dupKey(v.rec);
      if (wantReplace && seenExisting[key]) {
        if (seenInFile[key]) {
          errors.push({ line: row.line, error: 'Skipped as a duplicate — this file already carries the same question on line ' + seenInFile[key] + '.' });
          return;
        }
        seenInFile[key] = row.line;
        var target0 = existingRec[key];
        replacements.push({ id: target0.id, line: row.line, patch: replacementPatch(v.rec) });
        if (wantPreview) {
          var pr = previewRow(row, draft, v.rec);
          pr.replaces = target0.id;
          pr.flags.unshift('Replaces the question already in the bank (id ' + target0.id + ') — its options, answer and explanation will be overwritten.');
          preview.push(pr);
        }
        return;
      }
      if (seenExisting[key]) {
        errors.push({ line: row.line, error: 'Skipped as a duplicate — an identical ' + (notesFile ? 'note' : 'question') + ' is already in the bank.' });
        return;
      }
      if (seenInFile[key]) {
        errors.push({ line: row.line, error: 'Skipped as a duplicate — this file already carries the same ' +
                      (notesFile ? 'note' : 'question') + ' on line ' + seenInFile[key] + '.' });
        return;
      }
      seenInFile[key] = row.line;
      records.push(v.rec);
      if (wantPreview && !notesFile) preview.push(previewRow(row, draft, v.rec));
    });
    var out = { records: records, errors: errors, read: parsed.rows.length };
    if (wantReplace) out.replacements = replacements;
    if (wantPreview) out.preview = preview;
    return out;
  }

  /* Offered in the console so management starts from a file that works. */
  function csvTemplate(kind) {
    if (String(kind) === 'notes') {
      return CSV_NOTE_HEADER + '\n' +
        'Physics,Motion,"Acceleration","Acceleration is the rate of change of velocity with time.\\n\\nIt is a vector: a negative value means the body is slowing down.",2,yes\n';
    }
    return CSV_QUESTION_HEADER + '\n' +
      'Physics,objective,Motion,"A body accelerates uniformly from rest. Which graph fits?","A straight line through the origin","A horizontal line","A curve of decreasing slope","A vertical line",,A,,,easy,"Uniform acceleration means velocity rises in equal steps.",yes\n' +
      'Physics,theory,Motion,"State Newton\'s second law and define the newton.",,,,,,,"Force equals mass times acceleration; one newton accelerates one kilogram at one metre per second squared.",10,medium,"Both halves must be stated to earn full marks.",yes\n' +
      'Physics,practice,Motion,"A car speeds up steadily from 10 m/s to 30 m/s in 4 s. What is its acceleration?","2.5 m/s^2","5 m/s^2","8 m/s^2","40 m/s^2",,B,,,easy,"a = (v-u)/t = (30-10)/4 = 5 m/s^2. This one is filed as practice, so it is never drawn into the Web Test.",yes,2019\n';
  }

  /* ---------------------------------------------------- daily study window
     Real usage tracking, not a display prop: the page sends a heartbeat roughly
     once a minute while a student is signed in and looking at the app, and the
     server is the only thing that ever adds to the running total — exactly the
     same "server holds the clock, the page only asks" split already used for
     the session-length countdown. clampStudyPingSeconds is the guard that keeps
     a heartbeat from ever being trusted for more than a little over its own
     interval, so a tampered or replayed ping can't inflate the total. */
  var STUDY_PING_INTERVAL_SEC = 60;
  var STUDY_PING_MAX_SEC = 90;   // tolerates one missed beat, no more
  function clampStudyPingSeconds(sec) {
    var v = Math.round(Number(sec) || 0);
    if (v < 0) v = 0;
    return Math.min(v, STUDY_PING_MAX_SEC);
  }
  /* One place that turns "the limit" and "seconds used so far today" into
     everything a screen needs to draw the ring and decide whether to gate a
     Start button — shared so the server's enforcement and the client's display
     can never quietly disagree about what "used up" means. bonusMin is any
     guardian-granted extra time for today (see EXTRA_TIME_GRANT_MIN below) —
     optional and defaulting to zero, so every existing caller that doesn't
     know about grants keeps behaving exactly as before. */
  function studyWindowStatus(limitMin, usedSec, bonusMin) {
    var limit = Math.max(0, Math.round(Number(limitMin) || 0));
    var bonus = Math.max(0, Math.round(Number(bonusMin) || 0));
    var used = Math.max(0, Math.round(Number(usedSec) || 0));
    if (!limit) {
      // No window has been configured — nothing to cap against, so nothing is
      // ever exhausted rather than treating an unset limit as a zero-minute one.
      return { dailyLimitMin: 0, usedSec: used, usedMin: Math.floor(used / 60),
               leftSec: null, leftMin: null, exhausted: false, bonusMin: bonus };
    }
    var limitSec = (limit + bonus) * 60;
    var leftSec = Math.max(0, limitSec - used);
    return {
      dailyLimitMin: limit, usedSec: used, usedMin: Math.floor(used / 60),
      leftSec: leftSec, leftMin: Math.ceil(leftSec / 60),
      exhausted: leftSec <= 0, bonusMin: bonus
    };
  }

  /* -------------------------------------------- guardian "add time" grants
     The old wind-down overlay had an "Add 15 min (guardian PIN)" button that
     did nothing real — see DAILY-STUDY-WINDOW-STATUS.txt. This is the actual
     feature: a single academy-wide PIN (set by management in Settings, never
     shown to students) lets whoever holds it grant a fixed, capped amount of
     extra time on top of today's window. Fixed size and a daily cap keep this
     from ever becoming a way to lift the window indefinitely — it is a relief
     valve for one closely-supervised paper, not a second daily allowance. */
  var EXTRA_TIME_GRANT_MIN = 15;
  var EXTRA_TIME_MAX_GRANTS_PER_DAY = 2;

  /* A PIN is only ever compared, never displayed back, so the only shape rule
     that matters is "plausible enough to be a PIN": 4 to 8 digits. Anything
     else (blank, letters, absurdly long) is rejected before it is ever stored
     or compared, the same way a passcode is validated elsewhere in this app. */
  function normalizeGuardianPin(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return (/^[0-9]{4,8}$/.test(s)) ? s : null;
  }
  function guardianPinMatches(stored, attempt) {
    var a = normalizeGuardianPin(stored);
    var b = normalizeGuardianPin(attempt);
    return !!a && !!b && a === b;
  }

  /* -------------------------------------------------- self-directed study
     The student chooses subject, topics, how many questions and — in CBT mode —
     how long. These helpers are shared so the browser, the mock driver and the
     server all agree on what is a legal choice and which questions answer it. */

  var STUDY_MODES = ['cbt', 'practice'];
  var STUDY_MAX = 60;
  var STUDY_MIN_MINUTES = 5;
  var STUDY_MAX_MINUTES = 180;

  function clampStudyCount(n, available) {
    var v = Math.round(Number(n) || 0);
    var cap = Math.min(STUDY_MAX, Math.max(1, Number(available) || 1));
    if (v < 1) v = 1;
    return Math.min(v, cap);
  }
  function clampStudyMinutes(m) {
    var v = Math.round(Number(m) || 0);
    if (v < STUDY_MIN_MINUTES) return STUDY_MIN_MINUTES;
    if (v > STUDY_MAX_MINUTES) return STUDY_MAX_MINUTES;
    return v;
  }
  /* Every objective question a student could be asked in self-study: active,
     in this subject, and answerable without a marker. Theory needs a human, so
     it stays in the Web Test where a marker sees it. */
  function studyPool(bank, subject, topics, year) {
    var want = (topics || []).map(function (t) { return String(t).trim(); })
                             .filter(function (t) { return t.length > 0; });
    var ys = Array.isArray(year) ? year : (Number(year) > 0 ? [year] : []);
    ys = ys.map(Number).filter(function (n) { return n > 0; });
    return (bank || []).filter(function (r) {
      if (!r.active || r.kind !== 'objective' || r.section !== 'practice') return false;
      if (subject && r.subject !== subject) return false;
      if (want.length && want.indexOf(String(r.topic)) === -1) return false;
      /* Years narrow Practice to those papers' questions only. */
      if (ys.length && !(r.section === 'practice' && ys.indexOf(Number(r.year)) !== -1)) return false;
      return true;
    });
  }
  /* Older clients may still send this sentinel for "every subject I sit,
     pooled into one run." Practice is now single-subject only (item 2): the
     server and the mock driver both refuse it outright rather than pooling
     across subjects, so the constant survives only to recognise and reject
     it. */
  var PRACTICE_ALL_SUBJECTS = 'All my subjects';
  /* The topics available in a subject, with how many questions each holds, so
     the picker can grey out a topic rather than let a student choose an empty
     one and then be refused. */
  function studyTopics(bank, subject) {
    var seen = {}, out = [];
    studyPool(bank, subject, null).forEach(function (r) {
      var t = String(r.topic || 'General');
      if (seen[t] === undefined) { seen[t] = out.length; out.push({ topic: t, questions: 0 }); }
      out[seen[t]].questions++;
    });
    return out.sort(function (a, b) { return a.topic < b.topic ? -1 : (a.topic > b.topic ? 1 : 0); });
  }
  /* The years Practice can be narrowed to for a subject, newest first. Each
     carries its live count and a per-topic split, so the set-up screen can
     work out how many questions "these topics in that year" really holds. */
  function studyYears(bank, subject) {
    var by = {}, out = [];
    (bank || []).forEach(function (q) {
      if (!isPastQuestion(q) || q.subject !== subject) return;
      var y = Number(q.year), t = String(q.topic || 'General');
      if (!by[y]) by[y] = { year: y, count: 0, topics: {} };
      by[y].count++;
      by[y].topics[t] = (by[y].topics[t] || 0) + 1;
    });
    Object.keys(by).forEach(function (y) { out.push(by[y]); });
    out.sort(function (a, b) { return b.year - a.year; });
    return out;
  }
  /* ---------------------------------------------------- EDITING THE TOPICS
     A topic is not a record of its own: it is a label carried by every question
     and every note that belongs to it. So renaming one has to move every row
     that carries it, or the student's picker and the question bank stop agreeing
     about what exists. Renaming onto a name already in use is a merge, and that
     is deliberate — it is how a Chemistry bank with both "Acids & Bases" and
     "Acids and Bases" gets tidied without retyping either. */
  function topicName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function validateTopic(name) {
    var t = topicName(name);
    if (t.length < 2) return { error: 'A topic needs a name of at least two characters.' };
    if (t.length > 60) return { error: 'Keep a topic name under 60 characters.' };
    return { topic: t };
  }
  /* What topics exist in a subject, and how much sits behind each one, so the
     console can show that renaming "Electrolysis" moves 12 questions and 2 notes
     before anyone commits to it. */
  function topicInventory(bank, notes, subject, declared) {
    var seen = {}, out = [], i;
    function slot(sub, t) {
      var key = sub + '\u0000' + t;
      if (seen[key] === undefined) {
        seen[key] = out.length;
        out.push({ subject: sub, topic: t, questions: 0, liveQuestions: 0, notes: 0, liveNotes: 0 });
      }
      return out[seen[key]];
    }
    /* A topic management has declared but nothing carries yet. It is listed with
       every count at zero, which is the honest reading: the label exists, and
       there is nothing behind it until a question or a note is filed under it. */
    for (i = 0; i < (declared || []).length; i++) {
      var d = declared[i];
      if (!d || (subject && d.subject !== subject)) continue;
      var dt = topicName(d.topic);
      if (dt) slot(d.subject, dt);
    }
    for (i = 0; i < (bank || []).length; i++) {
      var q = bank[i];
      if (!q || (subject && q.subject !== subject)) continue;
      var qs = slot(q.subject, topicName(q.topic) || 'General');
      qs.questions++; if (q.active !== false) qs.liveQuestions++;
    }
    for (i = 0; i < (notes || []).length; i++) {
      var n = notes[i];
      if (!n || (subject && n.subject !== subject)) continue;
      var ns = slot(n.subject, topicName(n.topic) || 'General');
      ns.notes++; if (n.active !== false) ns.liveNotes++;
    }
    return out.sort(function (a, b) {
      if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
      return a.topic < b.topic ? -1 : (a.topic > b.topic ? 1 : 0);
    });
  }
  /* Declare a topic before anything carries it, so management can lay out a
     syllabus first and file questions and notes under it afterwards. The list is
     the academy's own; a label that a question already carries is not added
     twice, because the inventory is one list, not two. */
  function addTopicTo(declared, bank, notes, subject, name) {
    var v = validateTopic(name);
    if (v.error) return { error: v.error };
    if (!subject) return { error: 'Say which subject the topic belongs to.' };
    var held = topicInventory(bank, notes, subject, declared);
    for (var i = 0; i < held.length; i++) {
      if (held[i].topic.toLowerCase() === v.topic.toLowerCase()) {
        return { error: v.topic + ' is already a topic in ' + subject + '.' };
      }
    }
    declared.push({ subject: subject, topic: v.topic });
    return { topic: v.topic };
  }
  /* Relabel in place and report how many rows moved, so a caller can refuse a
     rename that would touch nothing rather than silently claim success. */
  function renameTopicIn(rows, subject, from, to) {
    var f = topicName(from), t = topicName(to), n = 0, i;
    for (i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (!r || r.subject !== subject) continue;
      if ((topicName(r.topic) || 'General') !== f) continue;
      r.topic = t; n++;
    }
    return n;
  }

  /* Draw `count` questions, spread across the chosen topics rather than taken in
     bank order, so a five-question run over three topics touches all three.
     `rnd` is injectable: the server passes a real random, a test passes a stub. */
  function pickStudy(pool, count, rnd) {
    var random = typeof rnd === 'function' ? rnd : Math.random;
    var rows = pool || [], linked = false, i;
    for (i = 0; i < rows.length; i++) { if (rows[i] && rows[i].passageId) { linked = true; break; } }
    return linked ? pickWithPassages(rows, count, random) : pickLoose(rows, count, random);
  }
  /* Passage-aware draw, modelled on the real UTME paper: a comprehension
     passage is never split from its questions, and the total is the cap.
       1. Whole passages go in first, in random order, each only if all of its
          questions still fit under the cap.
       2. The rest is filled with standalone questions, spread across topics.
       3. Only if the cap still cannot be met (no standalone left and every
          remaining passage is bigger than the gap) is ONE more passage taken
          whole, and only when it overshoots by a little — at most 20% of the
          cap, never fewer than 2. If nothing else was picked at all, the
          smallest passage is served so a run is never empty.
       4. A passage is never cut to hit the number.
     Passages sit as blocks among the standalone questions, at random places. */
  function pickWithPassages(pool, count, random) {
    if (typeof random !== 'function') random = Math.random;
    var solo = [], groups = {}, ids = [], cap = Math.max(0, Math.floor(Number(count) || 0));
    (pool || []).forEach(function (r) {
      var pid = r && r.passageId ? String(r.passageId) : '';
      if (!pid) { solo.push(r); return; }
      if (!groups[pid]) { groups[pid] = []; ids.push(pid); }
      groups[pid].push(r);
    });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1)), t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    }
    var left = cap, blocks = [], used = {};
    ids.forEach(function (pid) {
      if (groups[pid].length <= left) { blocks.push(groups[pid]); used[pid] = true; left -= groups[pid].length; }
    });
    var fill = left > 0 ? pickLoose(solo, Math.min(left, solo.length), random) : [];
    left -= fill.length;
    if (left > 0) {
      var rest = ids.filter(function (pid) { return !used[pid]; })
                    .sort(function (a, b) { return groups[a].length - groups[b].length; });
      if (rest.length) {
        var smallest = groups[rest[0]], over = smallest.length - left;
        if (!blocks.length && !fill.length) blocks.push(smallest);
        else if (over <= Math.max(2, Math.ceil(cap * 0.2))) blocks.push(smallest);
      }
    }
    var slots = {};
    blocks.forEach(function (b) {
      var at = Math.floor(random() * (fill.length + 1));
      (slots[at] = slots[at] || []).push(b);
    });
    var out = [];
    for (var k = 0; k <= fill.length; k++) {
      (slots[k] || []).forEach(function (b) { out = out.concat(b); });
      if (k < fill.length) out.push(fill[k]);
    }
    return out;
  }
  function pickLoose(pool, count, random) {
    var byTopic = {}, order = [];
    (pool || []).forEach(function (r) {
      var t = String(r.topic || 'General');
      if (!byTopic[t]) { byTopic[t] = []; order.push(t); }
      byTopic[t].push(r);
    });
    order.forEach(function (t) {
      /* Fisher–Yates within the topic, so two runs over the same topic are not
         the same paper in the same order. */
      var a = byTopic[t];
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      }
    });
    var picked = [], i = 0, more = true;
    while (more && picked.length < count) {
      more = false;
      for (var k = 0; k < order.length && picked.length < count; k++) {
        var row = byTopic[order[k]][i];
        if (row) { picked.push(row); more = true; }
      }
      i++;
    }
    return picked;
  }
  /* A practice resit should feel like a fresh set, not the same paper again —
     so the pool is split into "not recently served" and "recently served"
     before the ordinary spread-across-topics draw in pickStudy() runs. The
     fresh half is drawn from first; the recent half is only touched once the
     fresh half cannot fill the run, which is exactly the case where the bank
     is too small to avoid repeats at all. `recentIds` is whatever the caller
     remembers serving last — this function does not track anything itself,
     so two callers with different memories of "recent" naturally get
     different fresh/stale splits. */
  function pickPractice(pool, count, recentIds, rnd) {
    var recent = {};
    (recentIds || []).forEach(function (id) { recent[String(id)] = true; });
    var fresh = [], stale = [], staleGroup = {};
    /* A passage is fresh or stale as a whole: if any one of its questions was
       served recently, the passage waits with all of them. */
    (pool || []).forEach(function (r) {
      if (r.passageId && recent[String(r.id)]) staleGroup[String(r.passageId)] = true;
    });
    (pool || []).forEach(function (r) {
      var old = recent[String(r.id)] || (r.passageId && staleGroup[String(r.passageId)]);
      (old ? stale : fresh).push(r);
    });
    var picked = pickStudy(fresh, Math.min(count, fresh.length), rnd);
    if (picked.length < count) {
      picked = picked.concat(pickStudy(stale, count - picked.length, rnd));
    }
    return picked;
  }
  /* Practice marks each answer the moment it is chosen, so a practice question
     must travel with its answer and explanation. That is a deliberate exception
     and it is why practice is not assessed and earns no score on record: it is
     study material, not an examination. The CBT and Web Test paths keep using
     forStudent(), which strips both. */
  /* ---- Bookmarks (Phase 1, part 2) ------------------------------------------
     A student can save a question to revisit. The saved copy is a snapshot —
     the question, its options, the right answer and the explanation as they
     were — so a bookmark still reads properly if staff later edit or delete
     the question in the bank. Shared by the server and the demo driver so both
     validate and key a bookmark identically. */
  var BOOKMARK_CAP = 200;
  function bookmarkKey(b) {
    if (b && b.id != null && b.id !== '' && Number.isFinite(Number(b.id))) return 'q' + Number(b.id);
    var src = String((b && b.subject) || '') + '|' + String((b && b.text) || '');
    var h = 5381;
    for (var i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
    return 't' + h.toString(36);
  }
  function sanitizeBookmark(body) {
    if (!body || typeof body !== 'object') return null;
    var str = function (v, n) { return (v == null ? '' : String(v)).slice(0, n || 400); };
    var text = str(body.text, 2000).trim();
    var options = Array.isArray(body.options) ? body.options.slice(0, 6).map(function (o) { return str(o, 500); }) : [];
    if (!text || options.length < 2) return null;
    var ans = Number(body.answer);
    var out = {
      id: body.id != null && body.id !== '' && Number.isFinite(Number(body.id)) ? Number(body.id) : null,
      subject: str(body.subject, 60), topic: str(body.topic, 120),
      text: text, options: options,
      answer: body.answer != null && Number.isInteger(ans) && ans >= 0 && ans < options.length ? ans : null,
      explanation: str(body.explanation, 2000)
    };
    out.key = bookmarkKey(out);
    return out;
  }

  /* ---- Mistakes review (Phase 2, first slice) ------------------------------
     Pure and storage-free: given practice runs (newest first, as the server
     returns them) it lists the questions the student answered wrongly, once
     each, newest mistake first. A question skipped (given == null) is not a
     mistake; one that is wrong in several runs appears once. Each row keeps
     the snapshot fields a bookmark keeps, so a later screen can redo it. */
  function mistakesFromRuns(runs, cap) {
    var seen = {}, out = [], limit = Math.max(1, Number(cap) || 100);
    for (var i = 0; i < (runs || []).length && out.length < limit; i++) {
      var rev = (runs[i] && runs[i].review) || [];
      for (var j = 0; j < rev.length && out.length < limit; j++) {
        var q = rev[j];
        if (!q || q.isCorrect || q.given == null) continue;
        var key = bookmarkKey(q);
        if (seen[key]) continue;
        seen[key] = true;
        out.push({
          key: key, id: q.id != null ? q.id : null, subject: q.subject || '', topic: q.topic || '',
          text: q.text || '', options: q.options || [], answer: q.answer, given: q.given,
          explanation: q.explanation || '', ts: runs[i].ts || null
        });
      }
    }
    return out;
  }

  /* Mistakes review, slice 6: Web Test attempts. Takes the student's own
     attempt summaries (the shape summariseOwn returns, each with a review) and
     lists objective questions answered wrongly in a MARKED paper — an unmarked
     paper has no answers to show, a theory row has no right/wrong, and a
     skipped question is not a mistake. Same row shape as mistakesFromRuns, with
     ts taken from submittedAt, so the two lists can be merged. */
  function mistakesFromAttempts(attempts, cap) {
    var seen = {}, out = [], limit = Math.max(1, Number(cap) || 100);
    for (var i = 0; i < (attempts || []).length && out.length < limit; i++) {
      var a = attempts[i];
      if (!a || a.status !== 'marked') continue;
      var rev = a.review || [];
      for (var j = 0; j < rev.length && out.length < limit; j++) {
        var q = rev[j];
        if (!q || q.kind !== 'objective' || q.isCorrect !== false || q.given == null || q.given === '') continue;
        var row = {
          id: q.questionId != null ? q.questionId : null, subject: a.subject || '', topic: q.topic || '',
          text: q.text || '', options: q.options || [], answer: q.answer, given: Number(q.given),
          explanation: q.explanation || '', ts: a.submittedAt || null
        };
        row.key = bookmarkKey(row);
        if (seen[row.key]) continue;
        seen[row.key] = true;
        out.push(row);
      }
    }
    return out;
  }

  /* Merge several mistake lists into one: newest first, each question once (the
     newest sighting wins), capped. */
  function mergeMistakes(lists, cap) {
    var all = [], seen = {}, out = [], limit = Math.max(1, Number(cap) || 100);
    (lists || []).forEach(function (l) { (l || []).forEach(function (m) { all.push(m); }); });
    all.sort(function (x, y) { return (Number(y.ts) || 0) - (Number(x.ts) || 0); });
    for (var i = 0; i < all.length && out.length < limit; i++) {
      if (seen[all[i].key]) continue;
      seen[all[i].key] = true;
      out.push(all[i]);
    }
    return out;
  }

  /* Comprehension passages on the review screens (Phase 3, slice 4 part 4).
     A mistake row is a snapshot with no passage of its own, so the passage is
     looked up when the list is read: a row whose question (matched by id) still
     links to a LIVE passage of the same subject gets a copy of
     { id, title, text } as `passage`. Anything else is returned unchanged — a
     row with no id, a question since deleted or unlinked, a passage held back or
     removed. The stored rows are never changed, the row's key is untouched, and
     no answer is ever added. */
  function attachPassagesToMistakes(mistakes, bank, passages) {
    var qById = {}, pById = {};
    (bank || []).forEach(function (q) { if (q && q.id != null) qById[String(q.id)] = q; });
    (passages || []).forEach(function (p) { if (p && p.active !== false) pById[String(p.id)] = p; });
    return (mistakes || []).map(function (m) {
      if (!m || m.id == null) return m;
      var q = qById[String(m.id)];
      var p = q && q.passageId ? pById[String(q.passageId)] : null;
      if (!p || p.subject !== (q.subject || m.subject)) return m;
      var c = Object.assign({}, m);
      c.passage = { id: p.id, title: p.title, text: p.text };
      return c;
    });
  }

  /* A mistake row is a snapshot with no picture of its own, so — like the
     passage — it is looked up when the list is read: a row whose question
     (matched by id) still carries a picture gets a copy of { id, alt }. Rows
     with no id, or whose question has no picture or is gone, are left as they
     were; stored rows are never changed. */
  function attachImagesToMistakes(mistakes, bank) {
    var qById = {};
    (bank || []).forEach(function (q) { if (q && q.id != null) qById[String(q.id)] = q; });
    return (mistakes || []).map(function (m) {
      if (!m || m.id == null) return m;
      var q = qById[String(m.id)];
      if (!q || !q.imageId) return m;
      var c = Object.assign({}, m);
      c.image = { id: q.imageId, alt: q.imageAlt || '' };
      return c;
    });
  }

  /* ---- Spaced repetition (Phase 2) -----------------------------------------
     A Leitner schedule over the mistakes list. A question the student got wrong
     waits SR_INTERVALS_DAYS[0] day, then comes back for review; answered right
     it moves up one box and waits longer (1, 3, 7, 14, 30 days), answered wrong
     it drops back to box 0. Right at the top box retires it ("mastered").
     Pure and storage-free: `state` is a plain { key: { box, due, last,
     mastered } } map the caller keeps. A mistake made again AFTER the last
     review (its ts is newer than the entry's `last`) starts over, so a fresh
     wrong answer is never hidden by an old good streak. A review is study — it
     records nothing in the academic record and earns no XP. */
  var SR_INTERVALS_DAYS = [1, 3, 7, 14, 30];
  var SR_SESSION_CAP = 10;
  var SR_STATE_CAP = 300;
  var SR_DAY_MS = 86400000;

  function srEntryFor(m, state) {
    var e = state && m ? state[m.key] : null;
    if (!e || typeof e !== 'object') return null;
    if ((Number(m.ts) || 0) > (Number(e.last) || 0)) return null;
    return e;
  }

  /* When this mistake is next due (ms), or null once it is mastered. */
  function srDueAt(m, state) {
    var e = srEntryFor(m, state);
    if (!e) return (Number(m.ts) || 0) + SR_INTERVALS_DAYS[0] * SR_DAY_MS;
    if (e.mastered) return null;
    return Number(e.due) || 0;
  }

  /* The entry that follows an answer. `prev` may be null (a fresh mistake sits
     in box 0). Right moves up a box — or retires it from the top; wrong goes
     back to box 0 and waits the first interval again. */
  function srAfterAnswer(prev, correct, now) {
    var t = Number(now) || Date.now();
    var box = prev && Number(prev.box) >= 0 ? Math.min(SR_INTERVALS_DAYS.length - 1, Math.floor(Number(prev.box))) : 0;
    if (!correct) return { box: 0, due: t + SR_INTERVALS_DAYS[0] * SR_DAY_MS, last: t, mastered: false };
    if (box + 1 >= SR_INTERVALS_DAYS.length) return { box: box, due: null, last: t, mastered: true };
    return { box: box + 1, due: t + SR_INTERVALS_DAYS[box + 1] * SR_DAY_MS, last: t, mastered: false };
  }

  /* What the student sees: the questions due now (most overdue first, at most
     `cap`, default SR_SESSION_CAP), how many are due in all, how many wait for
     later, when the next one comes due, and how many are mastered. */
  function srQueue(mistakes, state, now, cap) {
    var t = Number(now) || Date.now(), limit = Math.max(1, Number(cap) || SR_SESSION_CAP);
    var due = [], upcoming = 0, mastered = 0, nextDue = null;
    (mistakes || []).forEach(function (m) {
      if (!m || !m.key) return;
      var at = srDueAt(m, state);
      if (at === null) { mastered++; return; }
      if (at <= t) { due.push({ m: m, at: at }); return; }
      upcoming++;
      if (nextDue === null || at < nextDue) nextDue = at;
    });
    due.sort(function (a, b) { return a.at - b.at; });
    return {
      due: due.slice(0, limit).map(function (x) {
        var e = srEntryFor(x.m, state);
        return Object.assign({}, x.m, { box: e ? Number(e.box) || 0 : 0, dueAt: x.at });
      }),
      dueCount: due.length, upcoming: upcoming, mastered: mastered, nextDue: nextDue
    };
  }

  /* Returns a NEW state with `entry` stored under `key`, keeping only the
     SR_STATE_CAP most recently reviewed entries so one student cannot grow the
     data file without bound. */
  function srStore(state, key, entry) {
    var next = {}, k;
    for (k in (state || {})) if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
    next[String(key)] = entry;
    var keys = Object.keys(next);
    if (keys.length > SR_STATE_CAP) {
      keys.sort(function (a, b) { return (Number(next[b].last) || 0) - (Number(next[a].last) || 0); });
      keys.slice(SR_STATE_CAP).forEach(function (d) { delete next[d]; });
    }
    return next;
  }

  function forPractice(r, index) {
    var out = forStudent(r, index);
    out.answer = r.answer;
    out.explanation = r.explanation || '';
    /* A past-paper year, only for Practice questions that carry one. */
    if (r.section === 'practice' && Number(r.year) > 0) out.year = Number(r.year);
    return out;
  }

  /* ------------------------------------------------------------ XP & levels
     XP, streaks and levels are the only earnings in this academy — there are
     no in-app coins. */

  function levelFor(xp) {
    return Math.max(1, Math.floor((Number(xp) || 0) / XP_PER_LEVEL) + 1);
  }
  function xpIntoLevel(xp) { return (Number(xp) || 0) % XP_PER_LEVEL; }
  function xpPerLevel() { return XP_PER_LEVEL; }

  /* ------------------------------------------------------- building a test */

  function eligible(bank, filter) {
    var section = String((filter && filter.section) || 'objective');
    var subject = String((filter && filter.subject) || '');
    return (bank || []).filter(function (r) {
      if (!r.active) return false;
      if (subject && r.subject !== subject) return false;
      /* No written paper in mathematics — see NO_THEORY. Held here rather than at
         the call sites, so even a question published before this rule existed can
         never be served, counted or listed. */
      if (section === 'theory' && !theoryAllowed(r.subject)) return false;
      /* There is one test, so a question is never held out of it by its period.
         A record written when the academy ran weekly and monthly papers is
         served exactly like one written today. */
      /* A JAMB-oriented paper is shaped like an objective paper, but its pool
         is exclusive to questions tagged 'jamb' — never the general objective
         pool — so a student never meets the same question in both sittings. */
      if (section === 'jamb') return r.section === 'jamb';
      return r.section === section;
    });
  }

  /* Everything a student is allowed to see. The correct answer, the reference
     answer and the explanation are deliberately absent: a student client never
     receives them, so a student cannot read the answers out of the network
     response or change what they are marked against. */
  function forStudent(r, index) {
    var out = {
      n: index + 1,
      id: r.id,
      subject: r.subject,
      topic: r.topic,
      kind: r.kind,
      text: r.text,
      options: r.kind === 'objective' ? (r.options || []).slice() : [],
      maxMark: r.kind === 'theory' ? r.maxMark : 1
    };
    if (r.passage) out.passage = { id: r.passage.id, title: r.passage.title, text: r.passage.text };
    /* The picture is part of the question, not of the answer, so a student
       gets its id and description (and only when there is a picture). */
    if (r.imageId) out.image = { id: r.imageId, alt: r.imageAlt || '' };
    return out;
  }

  /* A section's own clock. 0 means the paper is sat without one — that is a real
     answer, not a missing value, so it must survive the lookup. */
  function durationFor(section) {
    return typeof DURATION[section] === 'number' ? DURATION[section] : 900;
  }

  /* ---------------------------------------------------------------- marking
     Priority 4.5: objective sections are marked automatically by comparing the
     student's response with the configured correct answer. The comparison runs
     here, which both drivers call server-side (or driver-side in demo mode) —
     never in the student's own screen code. */

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  function markAttempt(questions, responses) {
    var res = responses || {};
    var rows = [], correct = 0, wrong = 0, answered = 0, maxScore = 0, i, r, given, isCorrect;
    for (i = 0; i < questions.length; i++) {
      r = questions[i];
      given = res[r.id];
      if (r.kind === 'objective') {
        maxScore += 1;
        isCorrect = (given !== undefined && given !== null && given !== '' && Number(given) === Number(r.answer));
        if (given !== undefined && given !== null && given !== '') { answered++; isCorrect ? correct++ : wrong++; }
        rows.push({
          questionId: r.id, topic: r.topic, subject: r.subject, kind: 'objective',
          given: (given === undefined || given === '') ? null : Number(given),
          isCorrect: !!isCorrect, markAwarded: isCorrect ? 1 : 0, maxMark: 1
        });
      } else {
        maxScore += Number(r.maxMark) || 0;
        var text = (given === undefined || given === null) ? '' : String(given).trim();
        if (text) answered++;
        rows.push({
          questionId: r.id, topic: r.topic, subject: r.subject, kind: 'theory',
          given: text, isCorrect: null, markAwarded: null, maxMark: Number(r.maxMark) || 0
        });
      }
    }
    var anyTheory = rows.some(function (x) { return x.kind === 'theory'; });
    var out = {
      answers: rows, total: questions.length, answered: answered,
      unanswered: questions.length - answered, correct: correct, wrong: wrong,
      maxScore: maxScore
    };
    if (anyTheory) {
      /* A theory paper is never given a final score automatically — an
         administrator marks it by hand first. */
      out.status = 'awaiting-marking';
      out.score = null;
      out.percent = null;
    } else {
      out.status = 'marked';
      out.score = correct;
      out.percent = maxScore ? round1((correct / maxScore) * 100) : 0;
    }
    return out;
  }

  /* Priority 4.4 — an administrator awards each theory mark by hand, then the
     system totals it. `marks` maps questionId -> mark awarded. */
  function applyTheoryMarks(attempt, marks) {
    var m = marks || {}, total = 0, max = 0, i, a, v;
    for (i = 0; i < attempt.answers.length; i++) {
      a = attempt.answers[i];
      max += Number(a.maxMark) || 0;
      if (a.kind === 'theory') {
        v = m[a.questionId];
        if (v === undefined || v === null || v === '') { v = a.markAwarded; }
        /* An answer nobody has marked stays unmarked. A blank box is not a zero,
           so a paper only becomes 'marked' once an administrator has awarded a
           mark for every written answer on it. */
        if (v === undefined || v === null || v === '') {
          a.markAwarded = null;
        } else {
          v = Number(v);
          if (isNaN(v) || v < 0) v = 0;
          if (v > a.maxMark) v = a.maxMark;
          a.markAwarded = v;
        }
      }
      total += Number(a.markAwarded) || 0;
    }
    var unmarked = attempt.answers.some(function (x) { return x.kind === 'theory' && (x.markAwarded === null || x.markAwarded === undefined); });
    attempt.maxScore = max;
    /* Half-marked is not marked: the paper keeps no score at all until every
       written answer has been given one, exactly as it was when it arrived. */
    attempt.score = unmarked ? null : round1(total);
    attempt.percent = unmarked ? null : (max ? round1((total / max) * 100) : 0);
    attempt.status = unmarked ? 'awaiting-marking' : 'marked';
    return attempt;
  }

  /* XP earned by finishing a test: a flat reward for completing it plus half a
     point per percentage point scored. Streaks and levels follow from XP. */
  function xpForAttempt(percent) {
    return 10 + Math.round((Number(percent) || 0) * 0.5);
  }

  /* XP earned by a practice run. Practice is unassessed — it never touches the
     academic record — but it is real work, so it is rewarded: one point for
     every question the student actually answered, plus two more for each one
     they got right. Effort alone earns something; accuracy earns more.

     A daily ceiling stops the league being climbed by grinding twenty easy
     runs, which is the same reason performance outranks XP in the standings. */
  var PRACTICE_XP_PER_ANSWER = 1;
  var PRACTICE_XP_PER_CORRECT = 2;
  var PRACTICE_XP_DAILY_CAP = 120;

  function xpForPractice(answered, correct) {
    var a = Math.max(0, Math.round(Number(answered) || 0));
    var c = Math.min(a, Math.max(0, Math.round(Number(correct) || 0)));
    return a * PRACTICE_XP_PER_ANSWER + c * PRACTICE_XP_PER_CORRECT;
  }
  /* What is left of today's allowance, so the caller can tell the student
     plainly rather than silently awarding nothing. */
  function practiceXpRemaining(earnedToday) {
    return Math.max(0, PRACTICE_XP_DAILY_CAP - Math.max(0, Number(earnedToday) || 0));
  }
  /* The stamp a day's allowance is counted against, in the academy's own terms:
     one calendar day, not a rolling 24 hours. */
  function dayStamp(when) {
    var d = when ? new Date(when) : new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  /* The calendar day immediately before a given dayStamp, in the same
     'YYYY-MM-DD' shape — used to test whether a streak's last-counted day
     was yesterday (continues) or older (broken). */
  function dayBefore(stamp) {
    var parts = String(stamp || '').split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() - 1);
    return dayStamp(d);
  }
  /* One calendar-day streak, counted the same way whether the server or the
     demo driver is asking: a student's first bit of real activity in a day
     either continues yesterday's streak, starts a fresh one after a gap, or
     — if today was already counted — leaves it untouched, so opening three
     papers in one afternoon can never count as three days. `prevDay` is the
     dayStamp last counted (or null/undefined for a student with no streak
     yet); `today` defaults to the current day but takes an explicit stamp
     for testing. Returns the new {streak, day} to persist. */
  function streakAfterActivity(prevStreak, prevDay, today, freezes) {
    var t = today || dayStamp();
    var streak = Math.max(0, Number(prevStreak) || 0);
    var held = Math.max(0, Math.min(STREAK_FREEZE_MAX, Math.floor(Number(freezes) || 0)));
    if (prevDay === t) return { streak: Math.max(streak, 1), day: t, freezes: held, frozen: false };
    if (prevDay && prevDay === dayBefore(t)) return { streak: streak + 1, day: t, freezes: held, frozen: false };
    /* Streak freeze (Phase 2): exactly one missed day (yesterday) is bridged by
       spending one freeze. The streak carries on as if the day was kept; the
       missed day itself is not counted. Longer gaps are never bridged. */
    if (held > 0 && streak > 0 && prevDay && prevDay === dayBefore(dayBefore(t))) {
      return { streak: streak + 1, day: t, freezes: held - 1, frozen: true };
    }
    return { streak: 1, day: t, freezes: held, frozen: false };
  }

  /* Buying a streak freeze with XP. Pure: returns the new {xp, freezes} or a
     reason it was refused. XP is spent, not level progress lost to a negative
     balance, so the student must hold the full cost; at most STREAK_FREEZE_MAX
     can be held. */
  function buyStreakFreeze(xp, freezes) {
    var have = Math.max(0, Number(xp) || 0), held = Math.max(0, Math.floor(Number(freezes) || 0));
    if (held >= STREAK_FREEZE_MAX) return { ok: false, reason: 'max', xp: have, freezes: held };
    if (have < STREAK_FREEZE_COST_XP) return { ok: false, reason: 'xp', xp: have, freezes: held };
    return { ok: true, xp: have - STREAK_FREEZE_COST_XP, freezes: held + 1 };
  }

  /* ---- Daily quest (Phase 2, Daily goal & quests, slice 1: pure logic) ------
     "Answer 10 questions in your weakest topic today." Pure and storage-free:
     it takes practice runs (the shape mistakesFromRuns reads — each with a ts
     and a review of {subject, topic, given, isCorrect}) and returns today's
     quest and how far along it is.

     The weakest topic is chosen from runs BEFORE today, so it cannot shift
     under the student while they work on it. A topic needs at least
     DAILY_QUEST_MIN_ANSWERED answered questions before it counts as evidence.
     With no such history the quest falls back to a plain daily goal: the same
     target, any topic. Skipped questions (given == null) never count, either
     as evidence or as progress. */
  var DAILY_QUEST_TARGET = 10;
  var DAILY_QUEST_MIN_ANSWERED = 3;

  function weakestTopicFromRuns(runs, minAnswered) {
    var min = Math.max(1, Number(minAnswered) || DAILY_QUEST_MIN_ANSWERED);
    var map = {}, order = [], i, j, q, k;
    for (i = 0; i < (runs || []).length; i++) {
      var rev = (runs[i] && runs[i].review) || [];
      for (j = 0; j < rev.length; j++) {
        q = rev[j];
        if (!q || q.given == null) continue;
        /* A stored review row may not carry its own subject; the run does. */
        var sub = q.subject || runs[i].subject || '';
        if (!sub || !q.topic) continue;
        k = sub + '\u0001' + q.topic;
        if (!map[k]) { map[k] = { subject: sub, topic: q.topic, answered: 0, correct: 0 }; order.push(k); }
        map[k].answered++;
        if (q.isCorrect) map[k].correct++;
      }
    }
    var best = null, pc;
    for (i = 0; i < order.length; i++) {
      var t = map[order[i]];
      if (t.answered < min) continue;
      pc = (t.correct / t.answered) * 100;
      /* Lowest percent wins; on a tie the topic with more evidence does. */
      if (!best || pc < best.percent || (pc === best.percent && t.answered > best.answered)) {
        best = { subject: t.subject, topic: t.topic, answered: t.answered, correct: t.correct, percent: round1(pc) };
      }
    }
    return best;
  }

  function dailyQuest(runs, today) {
    var t = today || dayStamp();
    var history = [], todays = [], i, j;
    for (i = 0; i < (runs || []).length; i++) {
      var r = runs[i];
      if (!r) continue;
      if (r.ts && dayStamp(r.ts) === t) todays.push(r);
      else if (!r.ts || dayStamp(r.ts) < t) history.push(r);
    }
    var weak = weakestTopicFromRuns(history);
    var answered = 0;
    for (i = 0; i < todays.length; i++) {
      var rev = todays[i].review || [];
      for (j = 0; j < rev.length; j++) {
        var q = rev[j];
        if (!q || q.given == null) continue;
        if (weak && ((q.subject || todays[i].subject || '') !== weak.subject || q.topic !== weak.topic)) continue;
        answered++;
      }
    }
    return {
      day: t, kind: weak ? 'weak' : 'any',
      subject: weak ? weak.subject : null, topic: weak ? weak.topic : null,
      target: DAILY_QUEST_TARGET, answered: answered,
      remaining: Math.max(0, DAILY_QUEST_TARGET - answered),
      done: answered >= DAILY_QUEST_TARGET
    };
  }

  /* ---- Daily quest reward (Phase 2, Daily goal & quests, slice 5) -----------
     Finishing the day's quest earns QUEST_XP_REWARD, once per calendar day.
     The reward is practice XP in every sense: it comes out of the same daily
     allowance (PRACTICE_XP_DAILY_CAP) as run XP, so the quest can never lift a
     student past the ceiling. `claimedDay` is the day stamp the student last
     collected on; `earnedToday` is the practice XP already counted today
     INCLUDING the run being submitted. Pure: the caller stores the claim.

     Returns { claim, award, day }. claim is true when today's quest is done and
     not yet collected — the day is then spent even if the allowance was already
     full (award 0), so a later run cannot collect it again. */
  var QUEST_XP_REWARD = 20;

  function questReward(quest, claimedDay, earnedToday) {
    if (!quest || !quest.done || !quest.day) return { claim: false, award: 0, day: null };
    if (claimedDay === quest.day) return { claim: false, award: 0, day: quest.day };
    return {
      claim: true,
      award: Math.min(QUEST_XP_REWARD, practiceXpRemaining(earnedToday)),
      day: quest.day
    };
  }

  /* ---- Weekly quest (Phase 2, Daily goal & quests, weekly slice 1: pure logic)
     The weekly way to earn a streak freeze. A calendar week runs Monday to
     Sunday. Either of two things completes it, whichever comes first:
       - WEEKLY_QUEST_DAYS daily quests finished in the week, or
       - WEEKLY_QUEST_QUESTIONS questions answered in practice in the week.
     Finishing it earns WEEKLY_QUEST_FREEZES streak freeze(s), once per week.

     Everything here is pure and storage-free. The progress is a small record
     the server keeps on the student, {week, days, questions, claimed}, where
     `week` is the Monday it belongs to. A record from an earlier week is simply
     read as empty, so nothing has to be reset by a cron job or a midnight
     sweep. The counters are kept rather than recomputed from the stored
     practice runs because those are capped (30 runs) and a busy week could
     outgrow them. */
  var WEEKLY_QUEST_DAYS = 5;
  var WEEKLY_QUEST_QUESTIONS = 100;
  var WEEKLY_QUEST_FREEZES = 1;
  var WEEKLY_COUNT_CEILING = 100000;   /* a stored counter can never run away */

  /* The Monday of the calendar week holding `stamp` ('YYYY-MM-DD', or none for
     today). A Sunday belongs to the week that began six days before it. */
  function weekStart(stamp) {
    var t = stamp || dayStamp();
    var p = String(t).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return weekStart(dayStamp());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayStamp(d);
  }
  /* The Sunday that closes that week. */
  function weekEnd(stamp) {
    var p = weekStart(stamp).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + 6);
    return dayStamp(d);
  }

  function weekCount(v) {
    var n = Math.floor(Number(v) || 0);
    return Math.max(0, Math.min(WEEKLY_COUNT_CEILING, n));
  }
  /* A stored record, made safe and aligned to the week `today` falls in. An
     older week (or nothing, or garbage) reads as an empty current week. */
  function cleanWeekQuest(state, today) {
    var wk = weekStart(today);
    if (!state || typeof state !== 'object' || state.week !== wk) {
      return { week: wk, days: 0, questions: 0, claimed: false };
    }
    return { week: wk, days: weekCount(state.days), questions: weekCount(state.questions), claimed: state.claimed === true };
  }

  /* The quest as the student sees it. `done` is true once either target is met;
     `claimed` once its freeze has been paid. */
  function weeklyQuest(state, today) {
    var s = cleanWeekQuest(state, today);
    var byDays = s.days >= WEEKLY_QUEST_DAYS, byQuestions = s.questions >= WEEKLY_QUEST_QUESTIONS;
    return {
      week: s.week, endsOn: weekEnd(s.week),
      days: s.days, questions: s.questions,
      targetDays: WEEKLY_QUEST_DAYS, targetQuestions: WEEKLY_QUEST_QUESTIONS,
      remainingDays: Math.max(0, WEEKLY_QUEST_DAYS - s.days),
      remainingQuestions: Math.max(0, WEEKLY_QUEST_QUESTIONS - s.questions),
      done: byDays || byQuestions, byDays: byDays, byQuestions: byQuestions,
      claimed: s.claimed, reward: WEEKLY_QUEST_FREEZES
    };
  }

  /* Folds one finished practice run into the week. `answered` is how many
     questions the run answered (as the server marked them); `dailyClaimed` is
     true when this run is the one that completed and collected today's daily
     quest, which happens at most once a day, so each such day counts once. */
  function weeklyQuestAfterRun(state, today, run) {
    var s = cleanWeekQuest(state, today);
    var answered = weekCount(run && run.answered);
    s.questions = weekCount(s.questions + answered);
    if (run && run.dailyClaimed) s.days = weekCount(s.days + 1);
    return s;
  }

  /* Should the week's freeze be paid now? `freezes` is how many the student
     holds right now (after any freeze this same run just spent on a bridged
     day). A finished, unpaid quest pays WEEKLY_QUEST_FREEZES, trimmed so the
     student never holds more than STREAK_FREEZE_MAX.

     When the student is already at the cap the quest is NOT spent: it stays
     finished-but-unpaid and is paid by the next practice run that finds room,
     so a freeze is never thrown away. `blocked` is 'max' in that case.
     Returns { claim, award, freezes, blocked }; `freezes` is the new count. */
  function weeklyReward(quest, freezes) {
    var held = Math.max(0, Math.min(STREAK_FREEZE_MAX, Math.floor(Number(freezes) || 0)));
    if (!quest || !quest.done || quest.claimed) return { claim: false, award: 0, freezes: held, blocked: null };
    var room = STREAK_FREEZE_MAX - held;
    if (room <= 0) return { claim: false, award: 0, freezes: held, blocked: 'max' };
    var award = Math.min(WEEKLY_QUEST_FREEZES, room);
    return { claim: true, award: award, freezes: held + award, blocked: null };
  }
  /* The record once its freeze has been paid. */
  function weeklyQuestClaimed(state, today) {
    var s = cleanWeekQuest(state, today);
    s.claimed = true;
    return s;
  }

  /* ----------------------------------------------- team challenges (Phase 4.C)
     A cohort works towards a shared goal — a team total of practice questions
     answered — over one calendar week (Monday to Sunday, like the weekly quest).
     Finishing it earns every member one streak freeze, once, never above the
     cap. One student cannot carry the team: each member's contribution is capped
     at CHALLENGE_PER_STUDENT_CAP, and the existing 120-XP daily practice
     allowance is untouched (a challenge counts answered questions, not XP).
     Open and GOC students both take part (owner decision, 10 Oct 2026).

     Pure and storage-free. The server keeps the challenge ({id, cohortId, title,
     goal, week, active, ...}) and, per member, a small progress record
     {challengeId, week, contributed, claimed}. A record for an earlier week or a
     different challenge reads as empty. */
  var CHALLENGE_PER_STUDENT_CAP = 200;      /* most one member may add to the team total */
  var CHALLENGE_FREEZE_REWARD = 1;          /* streak freezes paid to each member on completion */
  var CHALLENGE_GOAL_MIN = 10, CHALLENGE_GOAL_MAX = 100000;
  var CHALLENGE_TITLE_MIN = 3, CHALLENGE_TITLE_MAX = 80;

  /* What the console posts: { cohortId, title, goal, week? }. The week defaults
     to the current one; a given 'YYYY-MM-DD' is snapped to its Monday. */
  function validateChallenge(d, today) {
    var r = d || {};
    var cohortId = String(r.cohortId == null ? '' : r.cohortId).trim();
    var title = String(r.title || '').replace(/\s+/g, ' ').trim();
    var goal = Math.floor(Number(r.goal));
    if (!cohortId) return { error: 'Choose a cohort for the challenge.' };
    if (title.length < CHALLENGE_TITLE_MIN || title.length > CHALLENGE_TITLE_MAX) {
      return { error: 'Give the challenge a title of ' + CHALLENGE_TITLE_MIN + ' to ' + CHALLENGE_TITLE_MAX + ' characters.' };
    }
    if (!(goal >= CHALLENGE_GOAL_MIN && goal <= CHALLENGE_GOAL_MAX)) {
      return { error: 'The team goal must be between ' + CHALLENGE_GOAL_MIN + ' and ' + CHALLENGE_GOAL_MAX + ' questions.' };
    }
    var week = weekStart(r.week || today || dayStamp());
    return { rec: { cohortId: cohortId, title: title, goal: goal, week: week, endsOn: weekEnd(week), active: true } };
  }

  function challengeCount(v) { var n = Math.floor(Number(v) || 0); return Math.max(0, Math.min(CHALLENGE_GOAL_MAX, n)); }

  /* A member's stored progress, made safe and aligned to the challenge. A record
     for another challenge or an older week reads as empty. */
  function cleanChallengeState(state, challenge) {
    var cid = challenge && challenge.id, wk = challenge && challenge.week;
    if (!state || typeof state !== 'object' || String(state.challengeId) !== String(cid) || state.week !== wk) {
      return { challengeId: cid, week: wk, contributed: 0, claimed: false };
    }
    return { challengeId: cid, week: wk, contributed: challengeCount(state.contributed), claimed: state.claimed === true };
  }

  /* Fold one finished practice run into a member's contribution, capped per
     student. `run.answered` is how many questions the run answered. Returns the
     new state; the amount that actually counted is `added` on it. */
  function challengeAfterRun(state, challenge, run, today) {
    var s = cleanChallengeState(state, challenge);
    if (!challenge || !challenge.active) { s.added = 0; return s; }
    if (weekStart(today) !== challenge.week) { s.added = 0; return s; }   /* only during the challenge week */
    var answered = challengeCount(run && run.answered);
    var next = Math.min(CHALLENGE_PER_STUDENT_CAP, s.contributed + answered);
    s.added = next - s.contributed;
    s.contributed = next;
    return s;
  }

  /* The team total from the members' contributions (each already capped). */
  function challengeTeamTotal(contributions) {
    var t = 0, i;
    for (i = 0; i < (contributions || []).length; i++) t += challengeCount(contributions[i]);
    return t;
  }
  function challengeDone(teamTotal, goal) { return challengeCount(teamTotal) >= Math.floor(Number(goal) || 0); }

  /* Should this member's freeze be paid now? Same cap-and-carry rule as the
     weekly quest: paid once when the team goal is met, never above
     STREAK_FREEZE_MAX; if the member is at the cap it stays unpaid (blocked
     'max') and the next run that finds room pays it. */
  function challengeReward(challenge, teamTotal, state, freezes) {
    var held = Math.max(0, Math.min(STREAK_FREEZE_MAX, Math.floor(Number(freezes) || 0)));
    var s = cleanChallengeState(state, challenge);
    if (!challenge || !challenge.active || !challengeDone(teamTotal, challenge.goal) || s.claimed) {
      return { claim: false, award: 0, freezes: held, blocked: null };
    }
    var room = STREAK_FREEZE_MAX - held;
    if (room <= 0) return { claim: false, award: 0, freezes: held, blocked: 'max' };
    var award = Math.min(CHALLENGE_FREEZE_REWARD, room);
    return { claim: true, award: award, freezes: held + award, blocked: null };
  }
  function challengeClaimed(state, challenge) {
    var s = cleanChallengeState(state, challenge);
    s.claimed = true;
    return s;
  }

  /* What a member sees: the goal, the team total, their own share, days left,
     and whether it is done / their freeze claimed. */
  function challengeForStudent(challenge, teamTotal, state, today) {
    if (!challenge || !challenge.active) return null;
    var s = cleanChallengeState(state, challenge);
    var total = challengeCount(teamTotal);
    var td = dayStamp(today ? new Date(today) : undefined);
    var end = challenge.endsOn || weekEnd(challenge.week);
    var daysLeft = Math.max(0, Math.round((Date.parse(end + 'T00:00:00') - Date.parse(td + 'T00:00:00')) / 86400000));
    return {
      id: challenge.id, cohortId: challenge.cohortId, title: challenge.title,
      goal: challenge.goal, teamTotal: total, myShare: s.contributed,
      perStudentCap: CHALLENGE_PER_STUDENT_CAP,
      week: challenge.week, endsOn: end, daysLeft: daysLeft,
      remaining: Math.max(0, challenge.goal - total),
      done: challengeDone(total, challenge.goal), claimed: s.claimed, reward: CHALLENGE_FREEZE_REWARD
    };
  }

  /* Strong / developing / weak, the same classification the results screen has
     always used, now driven by real answers instead of fixed demo rows. */
  function topicBreakdown(answers) {
    var map = {}, out = [], i, a, k;
    for (i = 0; i < (answers || []).length; i++) {
      a = answers[i];
      k = a.topic || 'General';
      if (!map[k]) map[k] = { topic: k, got: 0, max: 0 };
      map[k].got += Number(a.markAwarded) || 0;
      map[k].max += Number(a.maxMark) || 0;
    }
    for (k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      var pc = map[k].max ? (map[k].got / map[k].max) * 100 : 0;
      out.push({ topic: k, percent: round1(pc), band: pc >= 75 ? 'strong' : pc >= 50 ? 'developing' : 'weak' });
    }
    out.sort(function (x, y) { return x.percent - y.percent; });
    return out;
  }

  /* -------------------------------------------- overall academic performance
     Priority 11. One calculation, used by the results screen, the profile, the
     Admin Console and the Scholar League, so those four can never disagree.

     Method: average the percentage scored in each assessment section
     (objective, theory, JAMB-oriented), then combine those section averages
     using the configurable weights in settings.perfWeights. Weights are
     normalised across only the sections a student has actually been marked in,
     so a student who has not yet sat a theory paper is not penalised for it. */

  function computePerformance(attempts, weights) {
    var w = weights || DEFAULT_WEIGHTS;
    var bySection = {}, bySubject = {}, marked = 0, i, a, key;
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || a.status !== 'marked' || typeof a.percent !== 'number') continue;
      marked++;
      key = a.section === 'jamb' ? 'jamb' : (a.section === 'theory' ? 'theory' : 'objective');
      if (!bySection[key]) bySection[key] = { sum: 0, n: 0 };
      bySection[key].sum += a.percent; bySection[key].n++;
      if (!bySubject[a.subject]) bySubject[a.subject] = { sum: 0, n: 0 };
      bySubject[a.subject].sum += a.percent; bySubject[a.subject].n++;
    }
    var sectionAvg = {}, wsum = 0, acc = 0, k;
    for (k in bySection) {
      if (!Object.prototype.hasOwnProperty.call(bySection, k)) continue;
      sectionAvg[k] = round1(bySection[k].sum / bySection[k].n);
      var ww = Number(w[k]) || 0;
      wsum += ww; acc += sectionAvg[k] * ww;
    }
    var subjectAvg = {};
    for (k in bySubject) {
      if (!Object.prototype.hasOwnProperty.call(bySubject, k)) continue;
      subjectAvg[k] = round1(bySubject[k].sum / bySubject[k].n);
    }
    return {
      overall: wsum ? round1(acc / wsum) : 0,
      hasData: marked > 0,
      markedAttempts: marked,
      bySection: sectionAvg,
      bySubject: subjectAvg,
      weights: { objective: Number(w.objective) || 0, theory: Number(w.theory) || 0, jamb: Number(w.jamb) || 0 }
    };
  }

  /* ------------------------------------------------------------ the league
     Priorities 10 and 12. Academic performance is the primary criterion and XP
     is only the tie-breaker, so a student who has collected a great deal of XP
     but performs poorly ranks BELOW a student with less XP and stronger
     results. Name is a final tie-break purely to keep the order stable. */

  function rankLeague(rows) {
    var list = (rows || []).slice();
    list.sort(function (a, b) {
      var pa = Number(a.performance) || 0, pb = Number(b.performance) || 0;
      if (pb !== pa) return pb - pa;                       /* performance first */
      var xa = Number(a.xp) || 0, xb = Number(b.xp) || 0;
      if (xb !== xa) return xb - xa;                       /* then XP */
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    for (var i = 0; i < list.length; i++) { list[i].rank = i + 1; }
    return list;
  }

  /* League tier from rank, kept as it reads on the existing league screen.
     Rank 1 is Diamond in a league of any size. Without that line the tiers are
     pure percentiles, and a percentile is meaningless when there is almost
     nobody to be a percentile of: in a league of one, 1/1 falls past every
     threshold and the academy's only scholar is shown "Bronze League". The
     pilot cohort starts small, so this is the normal case at launch, not an
     edge case. */
  function leagueName(rank, size) {
    if (!size) return 'Bronze League';
    if (rank <= 1) return 'Diamond League';
    var frac = rank / size;
    if (frac <= 0.2) return 'Diamond League';
    if (frac <= 0.4) return 'Gold League';
    if (frac <= 0.7) return 'Silver League';
    return 'Bronze League';
  }

  /* ------------------------------------------------- the session policy (P9)
     How long a student may stay signed in, and how long before the end they
     are warned, are academy settings that management types in. Both bounds
     live here so the browser, the demo driver and the Node server clamp an
     out-of-range value identically — and so the warning can never be set to a
     span longer than the session it is warning about. */

  var SESSION_MIN = 15, SESSION_MAX = 480;      /* minutes a student may stay */
  var WARN_MIN = 1, WARN_MAX = 30;              /* minutes of notice before the end */
  var SESSION_DEFAULT = 120, WARN_DEFAULT = 5;

  function clampSessionMinutes(v) {
    var n = Math.round(Number(v));
    if (!n || isNaN(n)) n = SESSION_DEFAULT;
    return Math.max(SESSION_MIN, Math.min(SESSION_MAX, n));
  }

  /* The warning must fit inside the session: on a 15-minute session a
     10-minute warning would be showing before the student had finished
     logging in. */
  function clampWarnMinutes(v, sessionMinutes) {
    var n = Math.round(Number(v));
    if (!n || isNaN(n)) n = WARN_DEFAULT;
    var ceiling = Math.min(WARN_MAX, Math.max(WARN_MIN, clampSessionMinutes(sessionMinutes) - 1));
    return Math.max(WARN_MIN, Math.min(ceiling, n));
  }

  /* Seconds to the mm:ss the specification asks for — 'Automatic logout in
     04:59'. Negative time reads as 00:00 rather than as a minus sign. */
  function fmtCountdown(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* -------------------------------------------------------- MATHEMATICS (P11)
     A Nigerian mathematics or physics paper is full of fractions, roots,
     indices and Greek letters, and a question typed as
     "x = (-b +- sqrt(b^2-4ac))/2a" is measurably harder to read than the same
     thing set properly. So management may write mathematics in LaTeX — the
     notation every textbook and past paper is typeset in — and the Hub sets it
     for the student, in the question, the options, the explanation and the
     reading-mode notes alike.

     It understands a subset on purpose. A full TeX engine is most of a megabyte
     over the wire, and this Hub loads nothing from another origin so that it
     works in a hall with no internet: the choice was between a subset that
     always works offline and no mathematics at all. The subset is the part that
     actually turns up in UTME, WAEC and NECO papers.

     Two rules hold throughout. Everything is escaped before a single command is
     looked at, so a question imported from a spreadsheet can no more inject
     markup here than anywhere else in the Hub. And anything unrecognised is
     shown as the author typed it rather than swallowed — a visible fault gets
     reported and fixed; a silent one is marked wrong by a student who never
     saw the question. */

  function mathEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* The symbols an examination paper uses. Written as escapes rather than as
     literal characters so that this file survives being opened, saved and
     e-mailed by an editor that is not certain about its encoding. */
  var MATH_SYM = {
    times: '×', div: '÷', cdot: '⋅', pm: '±', mp: '∓',
    ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
    le: '≤', leq: '≤', ge: '≥', geq: '≥',
    ne: '≠', neq: '≠', ll: '≪', gg: '≫',
    approx: '≈', simeq: '≃', sim: '∼', cong: '≅',
    equiv: '≡', propto: '∝',
    infty: '∞', partial: '∂', nabla: '∇', prime: '′',
    degree: '°', angle: '∠', triangle: '△', square: '□',
    perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
    to: '→', rightarrow: '→', longrightarrow: '⟶',
    leftarrow: '←', leftrightarrow: '↔', mapsto: '↦',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    implies: '⇒', iff: '⇔', rightleftharpoons: '⇌',
    'in': '∈', notin: '∉', ni: '∋',
    subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
    cup: '∪', cap: '∩', setminus: '∖',
    emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', neg: '¬', lnot: '¬',
    land: '∧', lor: '∨', oplus: '⊕', otimes: '⊗',
    ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮',
    ddots: '⋱', mid: '∣', backslash: '\\',
    aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ',
    naira: '₦', pounds: '£', euro: '€',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
    epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
    phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ',
    omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
    Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
  };

  /* Function names are set upright — sin x, not s·i·n·x — and the ones that
     carry a limit underneath them in a displayed formula are marked as such. */
  var MATH_FN = ['sin', 'cos', 'tan', 'cosec', 'csc', 'sec', 'cot',
    'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
    'log', 'ln', 'lg', 'exp', 'det', 'dim', 'deg', 'gcd', 'lcm',
    'arg', 'Pr', 'sgn', 'mod', 'bmod', 'pmod'];
  var MATH_BIGFN = { lim: 'lim', limsup: 'lim sup', liminf: 'lim inf',
                     max: 'max', min: 'min', sup: 'sup', inf: 'inf' };
  var MATH_BIG = { sum: '∑', prod: '∏', coprod: '∐',
                   'int': '∫', iint: '∬', iiint: '∭',
                   oint: '∮', bigcup: '⋃', bigcap: '⋂' };
  var MATH_ACC = { bar: 'over', overline: 'over', underline: 'under',
                   overrightarrow: '→', vec: '→',
                   hat: 'ˆ', widehat: 'ˆ', tilde: '˜',
                   widetilde: '˜', dot: '˙', ddot: '¨',
                   check: 'ˇ', acute: '´', grave: 'ˋ' };
  var MATH_FENCE = { '(': '(', ')': ')', '[': '[', ']': ']', '|': '|',
                     '.': '', '/': '/', '\\': '\\',
                     lbrace: '{', rbrace: '}', langle: '⟨',
                     rangle: '⟩', lfloor: '⌊', rfloor: '⌋',
                     lceil: '⌈', rceil: '⌉',
                     vert: '|', Vert: '‖', lvert: '|', rvert: '|' };
  var MATH_UPRIGHT = { text: 1, mathrm: 1, mbox: 1, operatorname: 1, mathsf: 1 };
  var MATH_STRUCT = ['frac', 'dfrac', 'tfrac', 'cfrac', 'sqrt', 'binom', 'choose',
    'left', 'right', 'begin', 'end', 'mathbf', 'mathit', 'boldsymbol',
    'displaystyle', 'textstyle', 'limits', 'nolimits', 'quad', 'qquad',
    'space', 'phantom', 'middle', 'over'];
  var MATH_ENV = { matrix: '', pmatrix: '()', bmatrix: '[]', Bmatrix: '{}',
                   vmatrix: '||', Vmatrix: '‖‖', cases: '{' , array: '' };

  /* Which side of an atom wants air. A minus that opens an expression is a
     sign, not a subtraction, so the joiner decides this by position. */
  var TEX_BIN = '+-*×÷±∓⋅∗∘∙⊕⊗∖∧∨∪∩';
  var TEX_REL = '=<>≤≥≠≈≡∝≃≅∼≪≫→←↔⇒⇐⇔↦∈∉∋⊂⊃⊆⊇∴∵⊥∥∣⟶⇌';

  function texKnows(name) {
    return !!(MATH_SYM[name] || MATH_BIG[name] || MATH_BIGFN[name] ||
      MATH_ACC[name] || MATH_FENCE[name] || MATH_UPRIGHT[name] ||
      MATH_ENV[name] || MATH_FN.indexOf(name) > -1 ||
      MATH_STRUCT.indexOf(name) > -1);
  }

  /* One pass over the source, turning it into tokens. Whitespace is kept as a
     token of its own but ignored by the parser, as it is in real TeX: the
     spacing a reader sees is decided by what each symbol is, not by how many
     spaces the author happened to type. It is kept rather than dropped only so
     that \text{as far as} can put the spaces back. */
  function texTokens(src) {
    var s = String(src == null ? '' : src), out = [], i = 0, n = s.length, m;
    while (i < n) {
      var c = s.charAt(i);
      if (c === '\\') {
        if (s.charAt(i + 1) === '\\') { out.push({ t: 'row' }); i += 2; continue; }
        m = /^[A-Za-z]+/.exec(s.slice(i + 1));
        if (m) { out.push({ t: 'cmd', v: m[0] }); i += 1 + m[0].length; continue; }
        var nx = s.charAt(i + 1);
        if (nx === '') { out.push({ t: 'chr', v: '\\', lit: true }); i += 1; continue; }
        if (nx === ' ' || nx === ',' || nx === ':' || nx === ';') { out.push({ t: 'sp' }); i += 2; continue; }
        if (nx === '!') { i += 2; continue; }
        out.push({ t: 'chr', v: nx, lit: true }); i += 2; continue;
      }
      if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') { out.push({ t: c }); i++; continue; }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { out.push({ t: 'ws' }); i++; continue; }
      out.push({ t: 'chr', v: c }); i++;
    }
    return out;
  }

  /* An atom is a piece of rendered HTML plus what kind of thing it is, so that
     a following ^ or _ attaches to the atom it belongs to and the joiner can
     space operators correctly. */
  function texAtomOf(html, cls) { return { html: html, cls: cls || 'ord' }; }

  function texClassOfChar(ch) {
    if (TEX_BIN.indexOf(ch) > -1) return 'bin';
    if (TEX_REL.indexOf(ch) > -1) return 'rel';
    if (ch === ',' || ch === ';') return 'pun';
    if (ch === '(' || ch === '[') return 'open';
    if (ch === ')' || ch === ']') return 'close';
    return 'ord';
  }

  /* Letters are the variables of the expression and are set in italic, the way
     every syllabus and past paper sets them; digits and punctuation are not. */
  function texChar(ch) {
    if (/[A-Za-z]/.test(ch)) return texAtomOf('<i>' + mathEscape(ch) + '</i>', 'ord');
    return texAtomOf(mathEscape(ch), texClassOfChar(ch));
  }

  function texWrap(cls, inner) { return '<span class="' + cls + '">' + inner + '</span>'; }

  function texSkipWs(tk, i) {
    while (i < tk.length && (tk[i].t === 'ws')) i++;
    return i;
  }

  /* A run of atoms, stopping wherever the caller says. Every structure in the
     subset — a group, a fraction's numerator, a matrix cell — is one of these. */
  function texList(tk, i, stopFn, display) {
    var atoms = [], guard = 0;
    i = texSkipWs(tk, i);
    while (i < tk.length && !stopFn(tk[i]) && guard++ < 6000) {
      var r = texAtom(tk, i, display);
      i = r.i;
      if (!r.atom) { i = texSkipWs(tk, i); continue; }
      /* ^ and _ bind to the atom just built, in either order and at most once
         each: x_1^2 and x^2_1 are the same thing on the page. */
      var sup = null, sub = null, g2 = 0, k = texSkipWs(tk, i);
      while (k < tk.length && (tk[k].t === '^' || tk[k].t === '_') && g2++ < 4) {
        var which = tk[k].t;
        var arg = texArg(tk, k + 1, display);
        i = arg.i;
        if (which === '^') sup = arg.html; else sub = arg.html;
        k = texSkipWs(tk, i);
      }
      if (sup !== null || sub !== null) r.atom = texScript(r.atom, sup, sub, display);
      atoms.push(r.atom);
      i = texSkipWs(tk, i);
    }
    return { atoms: atoms, i: i };
  }

  /* One argument: a braced group, or the single atom that follows. \frac12 is
     one half, as it is in TeX, because that is what a hurried author types. */
  function texArg(tk, i, display) {
    i = texSkipWs(tk, i);
    if (i >= tk.length) return { html: '', i: i };
    if (tk[i].t === '{') {
      var r = texList(tk, i + 1, function (x) { return x.t === '}'; }, display);
      return { html: texJoin(r.atoms), i: r.i < tk.length ? r.i + 1 : r.i };
    }
    var a = texAtom(tk, i, display);
    return { html: a.atom ? a.atom.html : '', i: a.i };
  }

  /* The source text of a braced group, spaces and all — what \text{} needs. */
  function texRawGroup(tk, i) {
    i = texSkipWs(tk, i);
    var out = '';
    if (i < tk.length && tk[i].t === '{') {
      var depth = 1, guard = 0;
      i++;
      while (i < tk.length && guard++ < 3000) {
        var t = tk[i];
        if (t.t === '{') { depth++; out += '{'; i++; continue; }
        if (t.t === '}') { depth--; i++; if (!depth) break; out += '}'; continue; }
        if (t.t === 'chr') { out += t.v; i++; continue; }
        if (t.t === 'cmd') { out += (MATH_SYM[t.v] || ''); i++; continue; }
        if (t.t === 'ws' || t.t === 'sp' || t.t === 'row') { out += ' '; i++; continue; }
        out += t.t; i++;
      }
      return { text: out, i: i };
    }
    if (i < tk.length && tk[i].t === 'chr') return { text: tk[i].v, i: i + 1 };
    return { text: '', i: i };
  }

  /* A displayed sum or limit carries its bounds above and below the sign, the
     way a printed paper sets it. Inline it keeps them beside, so that the line
     height of a paragraph does not jump around a formula. */
  function texScript(atom, sup, sub, display) {
    if (atom.cls === 'big' && display) {
      return texAtomOf(texWrap('m-big',
        (sup !== null ? texWrap('m-lim', sup) : '') + atom.html +
        (sub !== null ? texWrap('m-lim', sub) : '')), 'ord');
    }
    var cls = atom.cls === 'big' ? 'ord' : atom.cls;
    if (sup !== null && sub !== null) {
      return texAtomOf(atom.html + texWrap('m-ss',
        texWrap('m-u', sup) + texWrap('m-l', sub)), cls);
    }
    if (sup !== null) return texAtomOf(atom.html + texWrap('m-sup', sup), cls);
    return texAtomOf(atom.html + texWrap('m-sub', sub), cls);
  }

  /* Spacing is a property of what a symbol is, not of what was typed. A minus
     with nothing to its left is a sign, not a subtraction, so it gets no air. */
  function texJoin(atoms) {
    var out = '', i, prev = null;
    for (i = 0; i < atoms.length; i++) {
      var a = atoms[i], h = a.html;
      if (a.cls === 'bin') {
        var lead = !prev || prev.cls === 'bin' || prev.cls === 'rel' ||
                   prev.cls === 'open' || prev.cls === 'pun';
        h = texWrap(lead ? 'm-sgn' : 'm-bin', h);
      } else if (a.cls === 'rel') h = texWrap('m-rel', h);
      else if (a.cls === 'pun') h = texWrap('m-pun', h);
      out += h;
      prev = a;
    }
    return out;
  }

  /* Which delimiter \left and \right were given. An unrecognised one is left
     alone rather than eaten, so \left. reads as the invisible fence it is. */
  function texDelim(tk, i) {
    i = texSkipWs(tk, i);
    if (i >= tk.length) return { ch: '', i: i };
    var t = tk[i];
    if (t.t === 'cmd' && MATH_FENCE[t.v] !== undefined) return { ch: MATH_FENCE[t.v], i: i + 1 };
    if (t.t === 'chr' && MATH_FENCE[t.v] !== undefined) return { ch: MATH_FENCE[t.v], i: i + 1 };
    return { ch: '', i: i };
  }

  /* A fence only needs stretching when there is something tall inside it. There
     is no way to measure text here, so the decision is made from what the body
     turned out to contain. */
  function texTall(inner) {
    return /m-frac|m-sqrt|m-ss|m-big|m-grid/.test(inner) ? ' m-tall' : '';
  }
  function texFenceHTML(ch, tall, scale) {
    if (!ch) return '';
    var st = scale ? ' style="transform:scaleY(' + scale + ')"' : '';
    return '<span class="m-fence' + tall + '"' + st + '>' + mathEscape(ch) + '</span>';
  }

  function texAtom(tk, i, display) {
    var t = tk[i];
    if (!t) return { atom: null, i: i + 1 };
    if (t.t === 'ws') return { atom: null, i: i + 1 };
    if (t.t === 'sp') return { atom: texAtomOf(texWrap('m-sp', ''), 'ord'), i: i + 1 };
    /* A row break or a cell divider outside a matrix, or a closer with nothing
       open, is a slip in the typing. Ignore it rather than derail the line. */
    if (t.t === 'row' || t.t === '&' || t.t === '}') return { atom: null, i: i + 1 };
    if (t.t === '^' || t.t === '_') {
      var e = texArg(tk, i + 1, display);
      return { atom: texScript(texAtomOf('', 'ord'),
        t.t === '^' ? e.html : null, t.t === '_' ? e.html : null, display), i: e.i };
    }
    if (t.t === '{') {
      var g = texList(tk, i + 1, function (x) { return x.t === '}'; }, display);
      return { atom: texAtomOf(texJoin(g.atoms), 'ord'), i: g.i < tk.length ? g.i + 1 : g.i };
    }
    if (t.t === 'chr') {
      return { atom: t.lit ? texAtomOf(mathEscape(t.v), texClassOfChar(t.v)) : texChar(t.v), i: i + 1 };
    }
    return texCommand(tk, i, display);
  }

  function texCommand(tk, i, display) {
    var name = tk[i].v, j = i + 1, a1, a2, body;

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      a1 = texArg(tk, j, display); a2 = texArg(tk, a1.i, display);
      return { atom: texAtomOf(texWrap('m-frac',
        texWrap('m-num', a1.html) + texWrap('m-den', a2.html)), 'ord'), i: a2.i };
    }
    /* n-choose-r turns up in every permutations question. It is a fraction with
       no rule, inside brackets that have to grow with it. */
    if (name === 'binom' || name === 'choose') {
      a1 = texArg(tk, j, display); a2 = texArg(tk, a1.i, display);
      body = texWrap('m-frac m-nobar', texWrap('m-num', a1.html) + texWrap('m-den', a2.html));
      return { atom: texAtomOf(texFenceHTML('(', ' m-tall', '1.7') + body +
        texFenceHTML(')', ' m-tall', '1.7'), 'ord'), i: a2.i };
    }
    if (name === 'sqrt') {
      var idx = '', k = texSkipWs(tk, j);
      if (k < tk.length && tk[k].t === 'chr' && tk[k].v === '[') {
        var ix = texList(tk, k + 1, function (x) { return x.t === 'chr' && x.v === ']'; }, display);
        idx = texJoin(ix.atoms);
        k = ix.i < tk.length ? ix.i + 1 : ix.i;
      }
      a1 = texArg(tk, k, display);
      return { atom: texAtomOf(texWrap('m-sqrt',
        (idx ? texWrap('m-idx', idx) : '') + texWrap('m-rad', '√') +
        texWrap('m-rbody', a1.html)), 'ord'), i: a1.i };
    }
    /* Words inside a formula are words: upright, and with their spaces kept. */
    if (MATH_UPRIGHT[name]) {
      var rg = texRawGroup(tk, j);
      return { atom: texAtomOf(texWrap('m-txt', mathEscape(rg.text)), 'ord'), i: rg.i };
    }
    if (MATH_ACC[name]) {
      a1 = texArg(tk, j, display);
      var mark = MATH_ACC[name];
      if (mark === 'over') return { atom: texAtomOf(texWrap('m-ov', a1.html), 'ord'), i: a1.i };
      if (mark === 'under') return { atom: texAtomOf(texWrap('m-un', a1.html), 'ord'), i: a1.i };
      return { atom: texAtomOf(texWrap('m-acc',
        texWrap('m-accm', mathEscape(mark)) + a1.html), 'ord'), i: a1.i };
    }
    if (MATH_BIG[name]) return { atom: texAtomOf(texWrap('m-bigop', MATH_BIG[name]), 'big'), i: j };
    if (MATH_BIGFN[name]) return { atom: texAtomOf(texWrap('m-fn', MATH_BIGFN[name]), 'big'), i: j };
    if (MATH_FN.indexOf(name) > -1) {
      /* \bmod is a binary operator that happens to be spelled with letters. */
      if (name === 'bmod') return { atom: texAtomOf(texWrap('m-fn', 'mod'), 'bin'), i: j };
      return { atom: texAtomOf(texWrap('m-fn', name), 'fn'), i: j };
    }
    if (MATH_SYM[name]) {
      var ch = MATH_SYM[name];
      return { atom: texAtomOf(mathEscape(ch), texClassOfChar(ch)), i: j };
    }
    return texCommand2(tk, i, name, j, display);
  }

  /* The rest of the subset: fences, environments, the styling commands, and
     whatever the Hub does not know. Split out only to keep each function short
     enough to read in one screen. */
  function texCommand2(tk, i, name, j, display) {
    var a1, inner, body, k;

    if (name === 'left') {
      var d1 = texDelim(tk, j);
      body = texList(tk, d1.i, function (x) { return x.t === 'cmd' && x.v === 'right'; }, display);
      inner = texJoin(body.atoms);
      k = body.i;
      var close = '';
      if (k < tk.length && tk[k].t === 'cmd' && tk[k].v === 'right') {
        var d2 = texDelim(tk, k + 1); close = d2.ch; k = d2.i;
      }
      var tall = texTall(inner);
      return { atom: texAtomOf(texFenceHTML(d1.ch, tall, tall ? '1.6' : '') + inner +
        texFenceHTML(close, tall, tall ? '1.6' : ''), 'ord'), i: k };
    }
    if (name === 'right') return { atom: null, i: texDelim(tk, j).i };

    /* Determinants and 2x2 matrices are a UTME staple, so the matrix
       environments are worth their small cost. A cell is an ordinary list; the
       fences grow with the number of rows, since that much can be counted. */
    if (name === 'begin') {
      var er = texRawGroup(tk, j), env = er.text.replace(/[*\s]/g, '');
      var fences = MATH_ENV[env] === undefined ? '' : MATH_ENV[env];
      var rows = [], cells = [], guard = 0;
      k = er.i;
      var stop = function (x) {
        return (x.t === 'cmd' && x.v === 'end') || x.t === 'row' || x.t === '&';
      };
      while (k < tk.length && guard++ < 400) {
        var cell = texList(tk, k, stop, display);
        cells.push(texJoin(cell.atoms));
        k = cell.i;
        if (k >= tk.length) break;
        if (tk[k].t === '&') { k++; continue; }
        if (tk[k].t === 'row') { rows.push(cells); cells = []; k++; continue; }
        break;
      }
      rows.push(cells);
      if (k < tk.length && tk[k].t === 'cmd' && tk[k].v === 'end') k = texRawGroup(tk, k + 1).i;
      var grid = '', ri, ci, rowh;
      for (ri = 0; ri < rows.length; ri++) {
        if (!rows[ri].length) continue;
        rowh = '';
        for (ci = 0; ci < rows[ri].length; ci++) rowh += texWrap('m-cell', rows[ri][ci]);
        grid += texWrap('m-row', rowh);
      }
      var scale = Math.min(3, 1 + 0.55 * Math.max(0, rows.length - 1)).toFixed(2);
      return { atom: texAtomOf(
        texFenceHTML(fences.charAt(0), ' m-tall', scale) + texWrap('m-grid', grid) +
        texFenceHTML(fences.charAt(1), ' m-tall', scale), 'ord'), i: k };
    }
    if (name === 'end') return { atom: null, i: texRawGroup(tk, j).i };

    if (name === 'mathbf' || name === 'boldsymbol') {
      a1 = texArg(tk, j, display);
      return { atom: texAtomOf(texWrap('m-bf', a1.html), 'ord'), i: a1.i };
    }
    if (name === 'mathit') {
      a1 = texArg(tk, j, display);
      return { atom: texAtomOf(texWrap('m-it', a1.html), 'ord'), i: a1.i };
    }
    if (name === 'phantom') {
      a1 = texArg(tk, j, display);
      return { atom: texAtomOf(texWrap('m-ph', a1.html), 'ord'), i: a1.i };
    }
    if (name === 'quad') return { atom: texAtomOf(texWrap('m-sp m-wide', ''), 'ord'), i: j };
    if (name === 'qquad') return { atom: texAtomOf(texWrap('m-sp m-wider', ''), 'ord'), i: j };
    /* Instructions about style, not about content: nothing to draw. */
    if (MATH_STRUCT.indexOf(name) > -1) return { atom: null, i: j };
    if (MATH_FENCE[name] !== undefined) {
      return { atom: texAtomOf(mathEscape(MATH_FENCE[name]), 'ord'), i: j };
    }
    /* Not one of ours. Show it as the author typed it: a fault that can be seen
       gets reported and fixed, and the console says so before it ever ships. */
    return { atom: texAtomOf(texWrap('m-raw', mathEscape('\\' + name)), 'ord'), i: j };
  }

  function renderTex(src, display) {
    var r = texList(texTokens(src), 0, function () { return false; }, !!display);
    return '<span class="mth' + (display ? ' mth-d' : '') + '">' + texJoin(r.atoms) + '</span>';
  }

  /* Nothing in a question is worth a blank screen. If a formula defeats the
     renderer the source is shown instead, so the student sees something and the
     academy can see what to fix. */
  function renderTexSafe(src, display) {
    try {
      return renderTex(src, display);
    } catch (e) {
      return '<code class="m-raw">' + mathEscape((display ? '$$' : '$') + src + (display ? '$$' : '$')) + '</code>';
    }
  }

  /* Is what sits between two lone dollars actually mathematics? This decides a
     real question the academy will meet in its first week: "A shirt costs $5,000
     and a bag costs $7,500" holds two dollar signs, not a formula, and reading
     them as a formula would eat the sentence. TeX's own convention settles it —
     a formula is written tight against its dollars ($x+1$, never $ x+1 $) — and
     a price is not, because the word after it needs its space. So: no space
     immediately inside either dollar, nothing longer than a sentence, and either
     a sign of mathematics in it or something too short to be prose. */
  var MATH_SIGNAL = /[\\^_{}=+<>*\/]|[-–]\s*\d|\d\s*[-–]|[×÷±≤≥≠≈]/;
  var MATH_STRONG = /[\\^_{}]/;
  function looksLikeMath(inner) {
    if (!inner || inner.length > 320) return false;
    if (/\n\s*\n/.test(inner)) return false;
    if (/^\s|\s$/.test(inner)) {
      /* Typed loosely, as $ x + 1 $. Accept it on ordinary evidence, but not when
         an operator dangles at either end — "Compare $10 + $15" leaves a trailing
         plus, and is two prices with a sum written between them, not a formula —
         and not when there is enough of it to be a sentence. */
      var t = inner.replace(/^\s+|\s+$/g, '');
      if (!MATH_SIGNAL.test(t)) return false;
      if (/^[+\-*\/=<>]|[+\-*\/=<>]$/.test(t)) return false;
      return t.indexOf('\\') > -1 || t.split(/\s+/).length <= 6;
    }
    if (MATH_SIGNAL.test(inner)) return true;
    /* Tight dollars with no operator inside them: a coordinate pair, a chemical
       formula, a single letter, a quantity with its unit. Nothing here has to be
       recognised as mathematics — the author put the dollars there. It is enough
       that it is too short to be the middle of a sentence, and the prose case
       this guard exists for cannot reach this line: a price is followed by a
       word, which leaves a space inside one of the two dollars. */
    return inner.length <= 40 && inner.split(/\s+/).length <= 5;
  }

  /* Splitting prose from mathematics. Four openings are understood, because
     authors copy from four kinds of source: $…$ and $$…$$ from a textbook or a
     colleague, \(…\) and \[…\] from a document exported by Word or LaTeX. */
  function mathSpans(text) {
    var s = String(text == null ? '' : text), out = [], i = 0, buf = '', e;
    function flushBuf() { if (buf) { out.push({ math: false, src: buf }); buf = ''; } }
    /* The closing delimiter is looked for with an escaped character stepped over,
       so that a dollar the author escaped cannot cut their own formula short:
       "The mark-up is $\$5 \times 3$" is one formula holding a dollar sign, not a
       formula ending at the second character. */
    function closeAt(from, delim) {
      var j = from;
      while (j < s.length) {
        if (s.charAt(j) === '\\') { j += 2; continue; }
        if (s.substr(j, delim.length) === delim) return j;
        j++;
      }
      return -1;
    }
    while (i < s.length) {
      var two = s.substr(i, 2);
      if (two === '$$') {
        e = closeAt(i + 2, '$$');
        if (e > -1) { flushBuf(); out.push({ math: true, display: true, src: s.slice(i + 2, e) }); i = e + 2; continue; }
      }
      if (two === '\\(') {
        e = s.indexOf('\\)', i + 2);
        if (e > -1) { flushBuf(); out.push({ math: true, display: false, src: s.slice(i + 2, e) }); i = e + 2; continue; }
      }
      if (two === '\\[') {
        e = s.indexOf('\\]', i + 2);
        if (e > -1) { flushBuf(); out.push({ math: true, display: true, src: s.slice(i + 2, e) }); i = e + 2; continue; }
      }
      if (two === '\\$') { buf += '$'; i += 2; continue; }
      if (s.charAt(i) === '$') {
        e = closeAt(i + 1, '$');
        if (e > i && looksLikeMath(s.slice(i + 1, e))) {
          flushBuf(); out.push({ math: true, display: false, src: s.slice(i + 1, e) }); i = e + 1; continue;
        }
      }
      buf += s.charAt(i); i++;
    }
    flushBuf();
    return out;
  }

  /* The one function every screen calls. Prose is escaped, mathematics is set,
     and a question with no mathematics in it comes back exactly as escaping
     alone would have left it — so nothing about the ordinary case changes. */
  function renderMath(text, opts) {
    var o = opts || {}, parts, out = '', i, esc;
    /* opts.bare: the text may carry LaTeX with no dollar signs around it (a note
       pasted from Word's equation editor or a solutions manual). Wrap those
       stretches first, exactly as the Physics CSV import does. */
    if (o.bare) text = autoFormatBareLatex(text);
    parts = mathSpans(text);
    for (i = 0; i < parts.length; i++) {
      if (parts[i].math) out += renderTexSafe(parts[i].src, parts[i].display);
      else {
        esc = mathEscape(parts[i].src);
        out += o.breaks ? esc.replace(/\n/g, '<br>') : esc;
      }
    }
    return out;
  }

  /* PHYSICS CSV IMPORT — bare LaTeX auto-formatting.
     A row pasted from a solutions manual or Word's own equation editor often
     carries a formula with no $ ... $ around it — "v^2=u^2+2as", not
     "$v^2=u^2+2as$" — so mathSpans just above never recognises it as
     mathematics and it reaches the student as raw carets and underscores,
     instead of the normal, typeset formula every other question gets. This
     looks for a stretch of text that can only be a formula — a backslash
     command such as \frac or \Delta, or a short token carrying a genuine ^
     or _ superscript/subscript — optionally continued through =, +, -, *, /
     into further short variable-or-number terms — and wraps the whole
     stretch in $ ... $, so it is set exactly as if the author had typed the
     dollar signs themselves.

     Deliberately narrow, on purpose: every trigger (a literal backslash, or
     a letter glued to a caret/underscore) is something ordinary English
     prose never produces on its own, and every extension term is capped at
     a handful of characters, so a real dash or equals sign sitting inside a
     sentence — "10-15 minutes", "the answer is B" — can never be swallowed
     into a formula alongside it. Text already inside a recognised $...$,
     \(...\) or \[...\] pair is left exactly as it was — this only rewrites
     the prose around such pairs, never their contents. */
  var LATEX_TERM_SRC = '(?:\\\\[A-Za-z]+(?:\\s*[\\^_]\\s*(?:\\{[^{}]{1,24}\\}|[A-Za-z0-9+\\-]{1,6}))*(?:\\s*\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*|\\d+(?:\\.\\d+)?(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)*|[A-Za-z]{1,3}(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)*)';
  var LATEX_TRIGGER_SRC = '(?:\\\\[A-Za-z]+(?:\\s*[\\^_]\\s*(?:\\{[^{}]{1,24}\\}|[A-Za-z0-9+\\-]{1,6}))*(?:\\s*\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\})*|\\b[A-Za-z0-9]{1,4}(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)+)';
  var LATEX_CLUSTER = new RegExp('(?:\\b[A-Za-z]{1,2}\\s*[=<>≤≥≠≈]\\s*)?' + LATEX_TRIGGER_SRC +
    '(?:(?:\\s*[=+\\-*/±×÷≤≥≠≈]\\s*|(?=[A-Za-z0-9\\\\]))' + LATEX_TERM_SRC + ')*', 'g');
  function autoFormatBareLatex(text) {
    var s = String(text == null ? '' : text);
    if (!s || (s.indexOf('\\') === -1 && s.indexOf('^') === -1 && s.indexOf('_') === -1)) return s;
    var parts = mathSpans(s), out = '', i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].math) {
        out += (parts[i].display ? '$$' : '$') + parts[i].src + (parts[i].display ? '$$' : '$');
        continue;
      }
      out += parts[i].src.replace(LATEX_CLUSTER, function (m) {
        /* The trigger already requires a backslash or a real ^ / _, but a
           run made only of the loop's own extension (no trigger at all)
           cannot occur given how the pattern is built — this check is kept
           anyway so the function can never wrap plain prose by accident if
           the pattern above is ever changed. */
        return (/\\[A-Za-z]|[A-Za-z0-9][\^_]/.test(m)) ? '\u0001' + m + '\u0002' : m;
      }).replace(/\u0002 \u0001/g, ' ').replace(/\u0001/g, '$').replace(/\u0002/g, '$');
    }
    return out;
  }

  function hasMath(text, opts) {
    if (opts && opts.bare) text = autoFormatBareLatex(text);
    var p = mathSpans(text), i;
    for (i = 0; i < p.length; i++) if (p[i].math) return true;
    return false;
  }

  /* A readable one-line version for the places that can hold no markup at all —
     a browser tab title, a screen-reader label, a row exported back to CSV.
     The brace-eating rules run as one loop to a fixed point, because a fraction
     whose numerator holds a root holds braces of its own, and unwinding fractions
     first would leave that fraction unmatched and its \frac showing. */
  function texPlain(src) {
    var s = String(src == null ? '' : src), guard = 0, before;
    /* Brackets are put round a part of a fraction, a power or an index only when
       it needs them. A single number or letter does not, and "10^23" reads better
       than "10^(23)"; anything longer does, or "1/2a" would be read as half of a. */
    function part(x) {
      var t = String(x).replace(/^\s+|\s+$/g, '');
      return /^[A-Za-z0-9]$|^\d+(\.\d+)?$/.test(t) ? t : '(' + t + ')';
    }
    /* The row break goes first, or the letter opening the next row would be
       read as part of a command name: a row break then c, never a command.
       A raised ring is how TeX writes a degree, and a one-line reading has no
       "raised", so 180^\circ becomes 180° rather than 180^∘. */
    s = s.replace(/\\\\/g, '; ').replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°');
    do {
      before = s;
      s = s.replace(/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
          function (all, a, b) { return part(a) + '/' + part(b); })
        .replace(/\\sqrt\s*\[([^\][{}]*)\]\s*\{([^{}]*)\}/g, '$1√($2)')
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
        .replace(/\\(?:binom|choose)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, 'C($1, $2)')
        .replace(/\\(?:text|mathrm|mbox|operatorname|mathsf|mathbf|mathit|boldsymbol|overline|bar|hat|vec|widehat|widetilde|tilde|underline|overrightarrow|phantom)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, ' ')
        .replace(/\^\s*\{([^{}]*)\}/g, function (all, a) { return '^' + part(a); })
        .replace(/_\s*\{([^{}]*)\}/g, function (all, a) { return '_' + part(a); });
    } while (s !== before && guard++ < 24);
    s = s.replace(/\\(?:left|right|displaystyle|textstyle|limits|nolimits|middle|quad|qquad|space)\b/g, ' ')
      /* An escaped character stands for itself; a thin space is just a space. */
      .replace(/\\([%$&#])/g, '$1')
      .replace(/\\[,;:!\s]/g, ' ')
      .replace(/\\([A-Za-z]+)/g, function (all, nm) {
        if (MATH_SYM[nm]) return MATH_SYM[nm];
        if (MATH_BIG[nm]) return MATH_BIG[nm];
        if (MATH_BIGFN[nm]) return MATH_BIGFN[nm];
        if (MATH_FENCE[nm] !== undefined) return MATH_FENCE[nm];
        return nm;
      })
      .replace(/&/g, ' ')
      .replace(/[{}]/g, '').replace(/\s+/g, ' ');
    return s.trim();
  }

  function mathPlain(text) {
    var parts = mathSpans(text), out = '', i;
    for (i = 0; i < parts.length; i++) out += parts[i].math ? texPlain(parts[i].src) : parts[i].src;
    return out;
  }

  /* What the console tells an author before a question is saved. These are
     warnings, never refusals: a single $ is a legitimate dollar sign, and a
     command the Hub has not met still shows the student something. The author
     sees the rendered question beside this list and decides. */
  function mathIssues(text) {
    var s = String(text == null ? '' : text), out = [], seen = {};
    function say(m) { if (!seen[m]) { seen[m] = 1; out.push(m); } }
    var spans = mathSpans(s), i, j, k;

    /* A $ left in the prose is only worth mentioning if what follows it was
       plainly meant to be a formula. Warning on every one of them would put a
       red mark beside every economics question that quotes a price. */
    for (i = 0; i < spans.length; i++) {
      if (spans[i].math) continue;
      var at = spans[i].src.indexOf('$');
      while (at > -1) {
        if (MATH_STRONG.test(spans[i].src.substr(at + 1, 24))) {
          say('A $ opens a formula that is never closed: ' +
              spans[i].src.substr(at, 32).replace(/\n[\s\S]*$/, '') +
              ' — add the closing $, or write \\$ if a dollar sign is meant.');
          break;
        }
        at = spans[i].src.indexOf('$', at + 1);
      }
    }
    if ((s.match(/\$\$/g) || []).length % 2) {
      say('There is a $$ with no partner, so a formula meant to stand on its own line will not.');
    }

    for (i = 0; i < spans.length; i++) {
      if (!spans[i].math) continue;
      var src = spans[i].src, depth = 0;
      for (j = 0; j < src.length; j++) {
        var c = src.charAt(j);
        if (src.charAt(j - 1) === '\\') continue;
        if (c === '{') depth++;
        if (c === '}') depth--;
        if (depth < 0) break;
      }
      if (depth !== 0) say('A formula has unbalanced { } braces: ' + src.slice(0, 48));
      /* Rather than guess at the shape of a broken fraction with a pattern, the
         formula is put through the plain-text reduction, which unwinds every
         well-formed one. Whatever is still standing afterwards was malformed. */
      var reduced = texPlain(src);
      if (/frac/.test(reduced)) {
        say('\\frac needs both of its parts, written as \\frac{top}{bottom}.');
      }
      if (/sqrt/.test(reduced)) {
        say('\\sqrt needs something to take the root of, written as \\sqrt{x} — or \\sqrt[3]{x} for a cube root.');
      }
      if (/binom|choose/.test(reduced)) {
        say('\\binom needs both of its parts, written as \\binom{n}{r}.');
      }
      if (/\\(?:text|mathrm|mathbf|overline|vec|hat)\b(?!\s*\{)/.test(src)) {
        say('\\text, \\mathrm, \\overline, \\vec and the like need braces around what they apply to, as \\text{mass}.');
      }
      if (/\\left\b|\\right\b/.test(src) &&
          (src.match(/\\left\b/g) || []).length !== (src.match(/\\right\b/g) || []).length) {
        say('Every \\left needs a matching \\right, each one followed by its bracket.');
      }
      if (/\\begin\b|\\end\b/.test(src) &&
          (src.match(/\\begin\b/g) || []).length !== (src.match(/\\end\b/g) || []).length) {
        say('Every \\begin{...} needs a matching \\end{...}.');
      }
      /* A layout name the Hub does not set is laid out as a bare grid with no
         brackets round it, which is not obviously wrong to look at — so it is
         named here, where the author is looking. */
      var envs = src.match(/\\begin\s*\{([^{}]*)\}/g) || [];
      for (k = 0; k < envs.length; k++) {
        var en = envs[k].replace(/^\\begin\s*\{/, '').replace(/\}$/, '');
        if (MATH_ENV[en] === undefined) {
          say('\\begin{' + en + '} is not one of the layouts the Hub sets, so it will be set ' +
              'as a plain grid with no brackets. Use pmatrix for round brackets, bmatrix for ' +
              'square ones, vmatrix for a determinant, or cases.');
        }
      }
      var cmds = src.replace(/\\\\/g, ' ').match(/\\[A-Za-z]+/g) || [];
      for (k = 0; k < cmds.length; k++) {
        var nm = cmds[k].slice(1);
        if (!texKnows(nm)) {
          say('\\' + nm + ' is not one of the commands the Hub sets. It will be shown to the student ' +
              'exactly as typed, so change it or spell it differently.');
        }
      }
    }
    return out;
  }

  /* The cheat sheet the console shows beside the editor, rendered by the very
     renderer it is describing — so it can never document something the Hub does
     not actually do. */
  var MATH_HELP = [
    { tex: '$\\frac{3}{4}$', note: 'a fraction' },
    { tex: '$x^2 + y^{10}$', note: 'powers' },
    { tex: '$H_2O$, $a_{n+1}$', note: 'indices' },
    { tex: '$\\sqrt{25}$, $\\sqrt[3]{8}$', note: 'roots' },
    { tex: '$3 \\times 4 \\div 2$', note: 'operators' },
    { tex: '$\\pi r^2$, $30^\\circ$', note: 'symbols and degrees' },
    { tex: '$\\theta \\le 90$', note: 'Greek and comparisons' },
    { tex: '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$', note: 'a formula on its own line' },
    { tex: '$\\text{Mass} = 6.02 \\times 10^{23}$', note: 'words inside a formula' }
  ];

  /* --------------------------------------------------------------- exports */

  /* ---- Study reminders (Phase 2, Reminders slice 1: pure logic) -------------
     Decides WHO should get WHICH reminder right now, and nothing else: no
     mail, no clock, no storage. The caller passes in everything it knows (the
     student, their opt-out choices, what was already sent, today's stamp and
     hour) and gets back a plan, so the same rules can be tested to the day.

     Three kinds, sent together in at most ONE message per student per day:
       streak  — the streak ends tonight: they practised yesterday, not today
                 (a held freeze is mentioned, since it would cover one day).
       weekly  — Sunday's digest of the weekly quest.
       review  — spaced-repetition questions are due; at most every
                 REMINDER_REVIEW_GAP_DAYS days so it never becomes a daily nag.
     Reminders are ON by default (email); a student opts out on Profile or from
     the link in any message. SMS stays off until a provider is configured AND
     the student turns it on. Nothing is sent outside the evening window, to a
     deactivated student, or to one with no activity for REMINDER_DORMANT_DAYS. */
  var REMINDER_KINDS = ['streak', 'weekly', 'review'];   /* also the priority order */
  var REMINDER_START_HOUR = 17;                           /* first hour a message may go */
  var REMINDER_END_HOUR = 21;                             /* none from this hour on */
  var REMINDER_REVIEW_GAP_DAYS = 2;
  var REMINDER_DORMANT_DAYS = 30;

  /* Stored choices, made safe. Missing or garbage = the defaults. */
  function cleanReminderPrefs(p) {
    return { email: !(p && p.email === false), sms: !!(p && p.sms === true) };
  }
  function reminderEmailOk(e) {
    var s = String(e == null ? '' : e).trim();
    return s.length <= 160 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);
  }
  function reminderPhoneOk(p) {
    var d = String(p == null ? '' : p).replace(/[\s\-().]/g, '');
    return /^\+?\d{8,15}$/.test(d);
  }
  /* The channels this student can be reached on: an address that looks real
     and has not been switched off, and (only when asked for) a phone number. */
  function reminderChannels(student, prefs) {
    var pr = cleanReminderPrefs(prefs), out = [];
    if (!student) return out;
    if (pr.email && reminderEmailOk(student.email)) out.push('email');
    if (pr.sms && reminderPhoneOk(student.phone)) out.push('sms');
    return out;
  }
  function daysBetweenStamps(a, b) {
    var pa = String(a || '').split('-'), pb = String(b || '').split('-');
    var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  /* input: { student: {active, email, phone, streak, streakDay, streakFreezes},
              prefs, sent: {streak, weekly, review}, today, hour,
              dueCount, weekQuest, startHour, endHour }
              (weekQuest = the stored {week,days,...}; the two hours default to
              REMINDER_START_HOUR / REMINDER_END_HOUR and exist so an owner can move the window)
     returns { send, kinds, channels, today, streak, freezes, dueCount, weekly } */
  function reminderPlan(input) {
    var inp = input || {}, stu = inp.student || null;
    var today = inp.today || dayStamp();
    var none = { send: false, kinds: [], channels: [], today: today };
    if (!stu || stu.active === false) return none;
    var channels = reminderChannels(stu, inp.prefs);
    if (!channels.length) return none;
    var hour = Number(inp.hour);
    var from = inp.startHour != null ? Number(inp.startHour) : REMINDER_START_HOUR;
    var to = inp.endHour != null ? Number(inp.endHour) : REMINDER_END_HOUR;
    if (!(hour >= from && hour < to)) return none;

    var sent = inp.sent && typeof inp.sent === 'object' ? inp.sent : {};
    var wk = weeklyQuest(inp.weekQuest, today);
    /* Dormant: no streak activity for a month and nothing done this week. */
    var idle = stu.streakDay ? daysBetweenStamps(stu.streakDay, today) : null;
    var activeThisWeek = wk.days > 0 || wk.questions > 0;
    if (!activeThisWeek && (idle === null || idle > REMINDER_DORMANT_DAYS)) return none;

    var kinds = [];
    var streak = Math.max(0, Number(stu.streak) || 0);
    if (streak >= 1 && stu.streakDay === dayBefore(today) && sent.streak !== today) kinds.push('streak');
    if (weekEnd(today) === today && sent.weekly !== weekStart(today)) kinds.push('weekly');
    var due = Math.max(0, Math.floor(Number(inp.dueCount) || 0));
    var gap = sent.review ? daysBetweenStamps(sent.review, today) : null;
    if (due > 0 && (gap === null || gap >= REMINDER_REVIEW_GAP_DAYS)) kinds.push('review');
    if (!kinds.length) return none;
    return {
      send: true, kinds: kinds, channels: channels, today: today,
      streak: streak, freezes: Math.max(0, Math.floor(Number(stu.streakFreezes) || 0)),
      dueCount: due, weekly: wk
    };
  }

  /* ------------------------------------------------------- ACCESS TIERS
     Phase 3B slice 1. Every account is either OPEN (anyone who signs up) or
     GOC (a student the academy has added). Only the console can move someone
     between the two. These are the pure rules: what each tier may use and how
     much. The server enforces them in its routes; the screens only explain
     them. Every number lives in TIER_LIMITS, so tuning is one place.

     Fail closed: a missing, misspelt or unknown tier reads as OPEN, and an
     unknown feature is refused for everyone. A limit of null means "no
     tier limit" (the existing caps, such as the 120 XP daily practice
     allowance, still apply on top). */
  var TIERS = ['open', 'goc'];
  var DEFAULT_TIER = 'open';

  var TIER_LIMITS = {
    open: {
      practicePerDay: null,      // practice is open to everyone: no daily cap
      practiceRunMax: null,      // ... and no cap on a run
      notesPerSubject: 3,        // the first few notes of each subject
      reviewsPerDay: 10,         // spaced-repetition answers per day
      bookmarks: 20,
      practiceHistory: 30,       // same as GOC: practice history is not trimmed
      pastYears: 'all'           // every year of past questions
    },
    goc: {
      practicePerDay: null,
      practiceRunMax: null,
      notesPerSubject: null,
      reviewsPerDay: null,
      bookmarks: null,           // GOC: no limit on saved questions (owner, 8 Oct 2026)
      practiceHistory: null,     // ... nor on how many practice runs are kept (only age, below)
      pastYears: 'all'
    }
  };

  /* Yes/no features. Anything not listed is refused (fail closed). */
  var TIER_FEATURES = {
    open: {
      practice: true, mistakes: true, notes: true,
      pastQuestions: true, resourceDownload: true, news: true, reminders: true,
      league: true, bookmarks: true, spacedReview: true,
      jambMock: true, webTestObjective: false, webTestTheory: false,
      resourceView: false, videos: false, classRecordings: false, liveClassJoin: false,
      streakFreezes: false, fullRecord: false, classNotices: false, askTutor: false
    },
    goc: {
      practice: true, mistakes: true, notes: true,
      pastQuestions: true, resourceDownload: true, news: true, reminders: true,
      league: true, bookmarks: true, spacedReview: true,
      jambMock: true, webTestObjective: true, webTestTheory: true,
      resourceView: true, videos: true, classRecordings: true, liveClassJoin: true,
      streakFreezes: true, fullRecord: true, classNotices: true, askTutor: true
    }
  };

  /* Anything that is not exactly 'goc' (any capitalisation, stray spaces) is
     OPEN. A student can never be GOC by accident. */
  function cleanTier(t) {
    return typeof t === 'string' && t.trim().toLowerCase() === 'goc' ? 'goc' : 'open';
  }

  /* The tier a console user picks when adding a student. Left out (or blank) it is
     GOC, the Phase 3B default for a student the academy enrols; only 'goc' or 'open'
     (any capitalisation, stray spaces) are accepted, so a typo is refused rather than
     quietly turning into either one. */
  function newStudentTier(t) {
    if (t === undefined || t === null || (typeof t === 'string' && t.trim() === '')) return { ok: true, tier: 'goc' };
    var v = typeof t === 'string' ? t.trim().toLowerCase() : '';
    if (v === 'goc' || v === 'open') return { ok: true, tier: v };
    return { ok: false, error: 'Choose Open or GOC for the new student.' };
  }

  /* Moving a student that already exists between tiers (Console -> Students). Unlike
     newStudentTier there is no default: the target must be named, so a missing or
     misspelt value is refused rather than quietly becoming either tier. */
  function parseTierChange(t) {
    var v = typeof t === 'string' ? t.trim().toLowerCase() : '';
    if (v === 'goc' || v === 'open') return { ok: true, tier: v };
    return { ok: false, error: 'Choose Open or GOC.' };
  }

  /* What the console asks before restricting a GOC student to Open. Making someone GOC
     needs no confirm (it only adds access); this one takes things away and part of it
     cannot be undone, so it says exactly what. The numbers come from the Open column
     of TIER_LIMITS, so tuning the table keeps this wording true. */
  function restrictWarning(who) {
    var lim = TIER_LIMITS.open, lost = [], gone = [];
    lost.push('Objective and Theory Web Tests, live classes, lesson videos and class replays');
    if (lim.notesPerSubject != null) lost.push('notes beyond the first ' + lim.notesPerSubject + ' of each subject');
    if (lim.reviewsPerDay != null) lost.push('spaced reviews beyond ' + lim.reviewsPerDay + ' a day');
    if (lim.bookmarks != null) gone.push('saved questions beyond the newest ' + lim.bookmarks);
    if (lim.practiceHistory != null) gone.push('practice history beyond the newest ' + lim.practiceHistory + ' runs');
    var text = 'Restrict ' + who + ' to Open?\n\nAccess changes straight away. They lose ' + lost.join(', ') + '.';
    if (gone.length) text += '\n\nThis cannot be undone: ' + gone.join(' and ') + ' will be deleted, and moving them back to GOC does not restore it.';
    return text;
  }

  /* The toast after a whole cohort is moved. `r` is the server's reply ({ changed, unchanged, failed }). */
  function cohortTierMessage(name, tier, r) {
    r = r || {};
    var label = cleanTier(tier) === 'goc' ? 'GOC' : 'Open';
    var changed = Number(r.changed) || 0, same = Number(r.unchanged) || 0;
    var failed = Array.isArray(r.failed) ? r.failed.length : 0;
    var out;
    if (!changed && !failed) out = 'Everyone in ' + name + ' is already ' + label + '.';
    else {
      out = name + ': ' + changed + ' student' + (changed === 1 ? '' : 's') + ' moved to ' + label;
      if (same) out += ', ' + same + ' already ' + (same === 1 ? 'was' : 'were');
      out += '.';
    }
    if (failed) out += ' ' + failed + ' could not be changed \u2014 try again.';
    return out;
  }

  /* The line shown under a student's access: who changed it and when, with the time as
     it reads in Nigeria (the academy's clock). Nothing recorded, nothing shown. */
  function tierChangeNote(by, at) {
    var t = Date.parse(at);
    if (!by || !(t > 0)) return '';
    var when;
    try {
      when = new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short',
        year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { when = new Date(t).toISOString(); }
    return 'Changed by ' + by + ' \u00b7 ' + when;
  }

  /* Practice runs are kept without a count limit for GOC, but not forever: a run
     older than this many days is dropped, so the data file cannot grow without end. */
  var PRACTICE_MAX_AGE_DAYS = 365;
  function dropOldRuns(runs, now) {
    var cutoff = (Number(now) || Date.now()) - PRACTICE_MAX_AGE_DAYS * 86400000;
    return (Array.isArray(runs) ? runs : []).filter(function (r) {
      var t = Number(r && r.ts);
      return !(t > 0) || t >= cutoff;       // a run with no usable time is kept, not guessed at
    });
  }
  /* The first `cap` items of a list; a cap of null means all of it. */
  function capList(list, cap) {
    var l = Array.isArray(list) ? list : [];
    return cap == null ? l.slice() : l.slice(0, cap);
  }

  /* A fresh copy, so no caller can change the table by editing what it got. */
  function tierLimits(tier) {
    var src = TIER_LIMITS[cleanTier(tier)], out = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    return out;
  }

  /* Every yes/no feature for a tier, as a fresh copy (for GET /api/me and the
     screens, so they never guess). */
  function tierFeatures(tier) {
    var src = TIER_FEATURES[cleanTier(tier)], out = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    return out;
  }

  function canUse(feature, tier) {
    var f = TIER_FEATURES[cleanTier(tier)];
    return Object.prototype.hasOwnProperty.call(f, feature) && f[feature] === true;
  }

  /* How much of a counted allowance is left. `limit` null means unlimited. */
  function allowanceOf(limit, used) {
    var u = Math.max(0, Math.floor(Number(used) || 0));
    if (limit == null) return { limit: null, used: u, remaining: null, unlimited: true, allowed: true };
    var left = Math.max(0, limit - u);
    return { limit: limit, used: u, remaining: left, unlimited: false, allowed: left > 0 };
  }

  /* Practice questions left today. `used` is how many the student has answered
     since midnight Africa/Lagos (see lagosDay). */
  function dailyAllowance(used, tier) {
    return allowanceOf(tierLimits(tier).practicePerDay, used);
  }
  /* Spaced-repetition answers left today. */
  function reviewAllowance(used, tier) {
    return allowanceOf(tierLimits(tier).reviewsPerDay, used);
  }
  /* How many questions a practice run may hold: what was asked, held to the
     tier's run size and to whatever is left of today's allowance. 0 means the
     day's allowance is spent. */
  function capPracticeRun(requested, usedToday, tier) {
    var want = Math.max(0, Math.floor(Number(requested) || 0));
    var runMax = tierLimits(tier).practiceRunMax;
    var left = dailyAllowance(usedToday, tier).remaining;
    if (runMax != null) want = Math.min(want, runMax);
    if (left != null) want = Math.min(want, left);
    return want;
  }
  /* What an Open student is told when the day's allowance is spent. One
     wording, shared by the server and the demo driver: come back tomorrow, and
     how to join. */
  function dailyLimitMessage(limit) {
    return "You've used today's " + (limit == null ? '' : limit + ' ') + 'free practice questions. They come back at midnight (Nigeria time). ' +
      'To practise without a daily limit, ask the academy about joining as a GOC student.';
  }
  /* What an Open student is told when today's spaced reviews are used up. */
  function reviewLimitMessage(limit) {
    return "You've done today's " + (limit == null ? '' : limit + ' ') + 'free spaced reviews. They come back at midnight (Nigeria time). ' +
      'To review without a daily limit, ask the academy about joining as a GOC student.';
  }
  /* What an Open student is told when their saved questions are full. */
  function bookmarkLimitMessage(limit) {
    return 'You have saved ' + limit + ' questions, the most an Open account can keep. ' +
      'Remove one to save another, or ask the academy about joining as a GOC student.';
  }
  /* A note an Open student may see in the list but not read: the title and
     where it sits stay, the body is gone (it never leaves the server). */
  function lockedNote(n) {
    return { id: n.id, title: n.title, subject: n.subject, topic: n.topic,
             minutes: n.minutes, body: '', locked: true };
  }
  /* Which yes/no feature gates each Web Test section. Anything not listed is
     refused (fail closed), like canUse itself. */
  var WEB_TEST_FEATURE = { objective: 'webTestObjective', theory: 'webTestTheory', jamb: 'jambMock' };
  function webTestAllowed(section, tier) {
    var f = WEB_TEST_FEATURE[section];
    return !!f && canUse(f, tier);
  }
  /* What an Open student is told when they try to sit a Web Test. */
  function webTestLockMessage(section) {
    var what = section === 'jamb' ? 'The JAMB-oriented mock' :
               section === 'theory' ? 'Theory Web Tests' : 'Objective Web Tests';
    return what + ' are for GOC students. Ask the academy about joining to sit them. ' +
      'You can keep practising with the free practice questions.';
  }
  /* What an Open student is told when they try to open a resource in the app
     (they may still download it). */
  var RESOURCE_VIEW_LOCK_MESSAGE = 'Opening files in the app is for GOC students. Tap the download icon to save this file instead, or ask the academy about joining.';
  /* Videos: a recording of a live class (type 'live') is the classRecordings
     feature, every other video is a lesson (the videos feature). Fails closed. */
  function videoFeature(type) { return type === 'live' ? 'classRecordings' : 'videos'; }
  function videoAllowed(type, tier) { return canUse(videoFeature(type), tier); }
  function videoLockMessage(type) {
    return (type === 'live' ? 'Live class replays' : 'Lesson videos') +
      ' are for GOC students. Ask the academy about joining to watch them.';
  }
  /* Open students get no live classes: not the timetable entries, not the Zoom link. */
  var LIVE_JOIN_LOCK_MESSAGE = 'Live classes are for GOC students. Ask the academy about joining.';
  /* Past questions by year (Phase 3B, slice 2): an Open student may pick only
     the NEWEST year a subject holds; GOC may pick any. `years` is the list
     studyYears returns (objects with a `year`). Selecting a year is what is
     limited; ordinary mixed practice with no year ticked is not. */
  function tierStudyYears(years, tier) {
    var list = (years || []).slice().sort(function (a, b) { return Number(b.year) - Number(a.year); });
    if (tierLimits(tier).pastYears !== 'latest') return list;
    return list.slice(0, 1);
  }
  /* The ticked years an Open student may not pick: held by the subject but not
     its newest. A year the subject does not hold is not "locked" (the normal
     "no questions published" answer covers it). */
  function lockedPastYears(requested, years, tier) {
    var allowed = tierStudyYears(years, tier).map(function (y) { return Number(y.year); });
    var held = (years || []).map(function (y) { return Number(y.year); });
    return (requested || []).map(Number).filter(function (y) {
      return held.indexOf(y) !== -1 && allowed.indexOf(y) === -1;
    });
  }
  function pastYearLockMessage(latest) {
    return 'Open accounts can practise the latest past-paper year' + (latest ? ' (' + latest + ')' : '') +
      ' only. Older years are for GOC students. Ask the academy about joining.';
  }
  var NOTE_LOCK_MESSAGE = 'That note is for GOC students. Ask the academy about joining to read every note.';
  /* Notes an Open user may read per subject (null = all). */
  function noteVisible(indexInSubject, tier) {
    var n = tierLimits(tier).notesPerSubject;
    return n == null || (Number(indexInSubject) >= 0 && Number(indexInSubject) < n);
  }

  /* The calendar day in Nigeria (UTC+1, no daylight saving), as YYYY-MM-DD.
     Daily allowances reset at midnight there, whatever time zone the server
     happens to run in. */
  function lagosDay(when) {
    var ms = when == null ? Date.now() : (when instanceof Date ? when.getTime() : Number(when));
    if (!isFinite(ms)) ms = Date.now();
    var d = new Date(ms + 3600000);
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /* ------------------------------------------------------------ tutors
     Phase 3C slice 1. Pure rules only: nothing here stores or serves anything.
     A tutor teaches one or more subjects, and every tutor route (slice 2) must
     scope by tutorCan / scopeToSubjects, so a Chemistry tutor can never read or
     write Physics. Tutor IDs look like GOC-T-001. */
  var TUTOR_PASSWORD_MIN = 8;          /* same floor the server applies to staff */
  var TUTOR_ID_RE = /^GOC-T-\d{3,}$/;
  var TUTOR_SECRET_FIELDS = ['password', 'passwordHash', 'hash', 'salt', 'pw', 'secret'];

  function cleanTutorId(id) {
    return String(id == null ? '' : id).trim().toUpperCase();
  }
  function validTutorId(id) {
    return TUTOR_ID_RE.test(cleanTutorId(id));
  }
  /* The next free tutor ID from the IDs already issued (gaps are not reused). */
  function nextTutorId(existing) {
    var max = 0, i, m;
    for (i = 0; i < (existing || []).length; i++) {
      m = TUTOR_ID_RE.test(cleanTutorId(existing[i])) ? parseInt(cleanTutorId(existing[i]).slice(6), 10) : 0;
      if (m > max) max = m;
    }
    var n = max + 1;
    return 'GOC-T-' + (n < 10 ? '00' + n : n < 100 ? '0' + n : String(n));
  }

  /* Create or edit a tutor. d = { name, subjects, id?, password? }.
     opts.needPassword (default true) is false when editing without a reset.
     Returns { rec } or { error } (the validators' usual shape). */
  function validateTutor(d, opts) {
    var r = d || {}, o = opts || {};
    var name = String(r.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2) return { error: 'Give the tutor a name.' };
    if (name.length > 80) return { error: 'The tutor’s name is too long (80 letters at most).' };

    var raw = Array.isArray(r.subjects) ? r.subjects : (r.subject ? [r.subject] : []);
    var subjects = [], seen = {}, i, sj;
    for (i = 0; i < raw.length; i++) {
      sj = String(raw[i] || '').trim();
      if (!sj || seen[sj]) continue;
      if (ALL_SUBJECTS.indexOf(sj) === -1) return { error: sj + ' is not one of the academy’s subjects.' };
      seen[sj] = true;
      subjects.push(sj);
    }
    if (!subjects.length) return { error: 'Choose at least one subject for the tutor to teach.' };
    /* keep the academy's own order so the switcher never jumps about */
    subjects.sort(function (a, b) { return ALL_SUBJECTS.indexOf(a) - ALL_SUBJECTS.indexOf(b); });

    var id = r.id == null || String(r.id).trim() === '' ? '' : cleanTutorId(r.id);
    if (id && !TUTOR_ID_RE.test(id)) return { error: 'A tutor ID looks like GOC-T-001.' };

    var needPw = o.needPassword === undefined ? true : !!o.needPassword;
    var pw = r.password == null ? '' : String(r.password);
    if (needPw || pw) {
      if (pw.length < TUTOR_PASSWORD_MIN) return { error: 'Choose a starting password of at least ' + TUTOR_PASSWORD_MIN + ' characters.' };
      if (pw.length > 200) return { error: 'That password is too long.' };
    }
    return { rec: { id: id, name: name, subjects: subjects, password: pw } };
  }

  /* May this tutor act on this subject? A switched-off tutor can do nothing. */
  function tutorCan(tutor, subject) {
    if (!tutor || tutor.active === false || !Array.isArray(tutor.subjects)) return false;
    return tutor.subjects.indexOf(String(subject == null ? '' : subject).trim()) > -1;
  }

  /* Keep only the items in the given subjects (default field: `subject`). Never
     mutates; an unknown or empty scope returns nothing (fail closed). */
  function scopeToSubjects(items, subjects, field) {
    var key = field || 'subject', ok = {}, out = [], i;
    if (!Array.isArray(items) || !Array.isArray(subjects)) return out;
    for (i = 0; i < subjects.length; i++) ok[subjects[i]] = true;
    for (i = 0; i < items.length; i++) {
      if (items[i] && ok[items[i][key]] === true) out.push(items[i]);
    }
    return out;
  }

  /* The dashboard is always for ONE subject. Given what the tutor asked for,
     return the subject to show ({ subject }) or an error. Nothing asked for
     means the tutor's first subject. */
  function tutorSubjectFor(tutor, requested) {
    if (!tutor || tutor.active === false || !Array.isArray(tutor.subjects) || !tutor.subjects.length) {
      return { error: 'This tutor account has no subjects.' };
    }
    var want = String(requested == null ? '' : requested).trim();
    if (!want) return { subject: tutor.subjects[0] };
    if (!tutorCan(tutor, want)) return { error: 'You do not teach ' + want + '.' };
    return { subject: want };
  }

  /* What may leave the server about a tutor: never a password, hash or salt. */
  function tutorPublic(tutor) {
    var out = {}, k;
    if (!tutor) return out;
    for (k in tutor) {
      if (Object.prototype.hasOwnProperty.call(tutor, k) && TUTOR_SECRET_FIELDS.indexOf(k) === -1) out[k] = tutor[k];
    }
    if (Array.isArray(out.subjects)) out.subjects = out.subjects.slice();
    return out;
  }

  /* ------------------------------------------------------- tutor question approval
     Phase 3C slice 6, part 1: the approval rules as pure functions. Nothing is stored or
     served here; the routes (part 2) and the console queue (part 3) feed these.
     - A question has a status: 'live' (what every student sees), 'pending' (Awaiting
       approval) or 'returned' (sent back with the admin's reason). A question with NO
       status is live, so nothing that exists today disappears.
     - Everything a tutor types or imports is saved pending, stamped with the tutor, the
       tutor's name, the time and (for an import) a batch id. Students never see it.
     - Only management reviews. A tutor never approves, and nobody approves their own.
     - A tutor may edit only their OWN question in their OWN subject; editing sends it back
       to pending, whatever it was. Admin-added questions are not a tutor's to edit.
     - Owner decision (8 Oct 2026): tutor THEORY MARKS need no approval, so none of this
       touches marking. */
  var QUESTION_STATUSES = ['live', 'pending', 'returned'];
  var RETURN_REASON_MIN = 3, RETURN_REASON_MAX = 300;

  function questionStatus(q) {
    var st = q && q.status ? String(q.status) : 'live';
    return QUESTION_STATUSES.indexOf(st) > -1 ? st : 'pending'; /* an unknown status fails closed */
  }
  function questionIsLive(q) { return !!q && questionStatus(q) === 'live'; }
  /* Only live questions may reach a student. Never mutates. */
  function liveQuestions(list) { return (list || []).filter(questionIsLive); }

  function stampNow(now) {
    var d = now === undefined || now === null ? new Date() : new Date(now);
    return isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  }
  function copyRec(r) { var c = {}, k; for (k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k]; return c; }
  var REVIEW_FIELDS = ['reviewedBy', 'reviewedAt', 'returnReason'];

  /* A validated question from a tutor, ready to store: pending and stamped. Returns
     { rec } or { error }. o.batch is an import's batch id (blank for a typed question). */
  function stampTutorQuestion(rec, tutor, o, now) {
    if (!rec || typeof rec !== 'object') return { error: 'There is no question to save.' };
    if (!tutor || tutor.active === false) return { error: 'This tutor account is switched off.' };
    if (!tutorCan(tutor, rec.subject)) return { error: 'You do not teach ' + String(rec.subject || 'that subject') + '.' };
    var out = copyRec(rec);
    REVIEW_FIELDS.forEach(function (k) { delete out[k]; });
    out.status = 'pending';
    out.addedBy = String(tutor.id || '');
    out.addedByName = String(tutor.name || '');
    out.addedAt = stampNow(now);
    var batch = o && o.batch ? String(o.batch).trim().slice(0, 40) : '';
    if (batch) out.batch = batch; else delete out.batch;
    return { rec: out };
  }

  /* May this tutor change this stored question? Their own, in their own subject, only. */
  function tutorOwnsQuestion(tutor, q) {
    return !!q && !!tutor && tutor.active !== false && !!tutor.id && q.addedBy === tutor.id && tutorCan(tutor, q.subject);
  }

  /* A tutor edits their own question: `changes` is a validated record. The result is the
     stored question with the changes, back to pending, review marks cleared, author and
     first-added time kept. A change of subject must still be one of the tutor's. */
  function tutorEditQuestion(tutor, q, changes, now) {
    if (!tutorOwnsQuestion(tutor, q)) return { error: 'You can only change questions you added, in your own subjects.' };
    if (!changes || typeof changes !== 'object') return { error: 'There is nothing to change.' };
    if (changes.subject !== undefined && !tutorCan(tutor, changes.subject)) {
      return { error: 'You do not teach ' + String(changes.subject) + '.' };
    }
    var out = copyRec(changes), keep = ['id', 'addedBy', 'addedByName', 'addedAt', 'batch'];
    REVIEW_FIELDS.forEach(function (k) { delete out[k]; });
    keep.forEach(function (k) { if (q[k] !== undefined) out[k] = q[k]; else delete out[k]; });
    out.status = 'pending';
    out.editedAt = stampNow(now);
    return { rec: out };
  }

  /* Management approves or returns a PENDING question. reviewer = { id, name, role }.
     decision 'approve' | 'return'; a return needs a reason of 3-300 characters.
     "Edit then approve" is: apply the admin's validated edit to the question, then approve it. */
  function reviewQuestion(q, decision, reviewer, reason, now) {
    if (!reviewer || reviewer.role === 'tutor' || !reviewer.name) return { error: 'Only the academy’s management can review questions.' };
    if (!q || questionStatus(q) !== 'pending') return { error: 'Only a question awaiting approval can be reviewed.' };
    if (q.addedBy && reviewer.id && q.addedBy === reviewer.id) return { error: 'Nobody can approve their own question.' };
    var out = copyRec(q), why = String(reason == null ? '' : reason).trim();
    if (decision === 'approve') {
      out.status = 'live';
      delete out.returnReason;
    } else if (decision === 'return') {
      if (why.length < RETURN_REASON_MIN) return { error: 'Say why the question is being returned (at least ' + RETURN_REASON_MIN + ' characters).' };
      if (why.length > RETURN_REASON_MAX) return { error: 'Keep the reason under ' + RETURN_REASON_MAX + ' characters.' };
      out.status = 'returned';
      out.returnReason = why;
    } else {
      return { error: 'Choose approve or return.' };
    }
    out.reviewedBy = String(reviewer.name);
    out.reviewedAt = stampNow(now);
    return { rec: out };
  }

  /* Approve every pending question from one import in one go. Returns the questions to
     store ({ recs }) and how many were left alone. The batch id must be given. */
  function approveBatch(list, batch, reviewer, now) {
    var id = String(batch == null ? '' : batch).trim();
    if (!id) return { error: 'Say which import to approve.' };
    var recs = [], skipped = 0, i, r;
    for (i = 0; i < (list || []).length; i++) {
      if (!list[i] || list[i].batch !== id) continue;
      r = reviewQuestion(list[i], 'approve', reviewer, '', now);
      if (r.error) {
        if (!/Only the academy/.test(r.error)) { skipped++; continue; }
        return { error: r.error };
      }
      recs.push(r.rec);
    }
    return { recs: recs, skipped: skipped };
  }

  /* A tutor's own questions (any status), newest first, for their dashboard. */
  function tutorQuestions(list, tutor) {
    var mine = (list || []).filter(function (q) { return tutorOwnsQuestion(tutor, q); });
    return mine.sort(function (a, b) { return String(b.addedAt || '').localeCompare(String(a.addedAt || '')); });
  }

  /* The console's Awaiting approval list: pending questions, every subject, oldest first
     so nothing waits for ever. Optional subject filter. */
  function approvalQueue(list, subject) {
    var want = subject ? String(subject) : '';
    var out = (list || []).filter(function (q) { return q && questionStatus(q) === 'pending' && (!want || q.subject === want); });
    return out.sort(function (a, b) { return String(a.addedAt || '').localeCompare(String(b.addedAt || '')); });
  }
  function pendingCount(list) {
    return (list || []).reduce(function (n, q) { return n + (q && questionStatus(q) === 'pending' ? 1 : 0); }, 0);
  }
  /* The newest time a tutor added a question to this subject, or '' (for Subjects & tutors). */
  function lastTutorUpload(list, subject) {
    var best = '';
    (list || []).forEach(function (q) {
      if (q && q.subject === subject && q.addedAt && String(q.addedAt) > best) best = String(q.addedAt);
    });
    return best;
  }

  /* ------------------------------------------------------------ tutor notes (slice 6.5)
     Owner decision (8 Oct 2026): a tutor's note goes live at once, with no approval. It is
     stamped with the tutor and the time so the console can show who wrote it. A tutor changes
     only their OWN notes, in their OWN subjects; notes the admin wrote are not theirs. */
  var NOTE_STAMP_KEYS = ['addedBy', 'addedByName', 'addedAt', 'editedAt'];

  function tutorOwnsNote(tutor, n) {
    return !!n && !!tutor && tutor.active !== false && !!tutor.id && n.addedBy === tutor.id && tutorCan(tutor, n.subject);
  }
  /* A validated note from a tutor, ready to store: stamped, and live unless the tutor held it back. */
  function stampTutorNote(rec, tutor, now) {
    if (!rec || typeof rec !== 'object') return { error: 'There is no note to save.' };
    if (!tutor || tutor.active === false) return { error: 'This tutor account is switched off.' };
    if (!tutorCan(tutor, rec.subject)) return { error: 'You do not teach ' + String(rec.subject || 'that subject') + '.' };
    var out = copyRec(rec);
    out.addedBy = String(tutor.id || '');
    out.addedByName = String(tutor.name || '');
    out.addedAt = stampNow(now);
    delete out.editedAt;
    return { rec: out };
  }
  /* `changes` is a validated record. The author and first-added time are kept; any forged stamp is dropped. */
  function tutorEditNote(tutor, n, changes, now) {
    if (!tutorOwnsNote(tutor, n)) return { error: 'You can only change notes you wrote, in your own subjects.' };
    if (!changes || typeof changes !== 'object') return { error: 'There is nothing to change.' };
    if (changes.subject !== undefined && !tutorCan(tutor, changes.subject)) return { error: 'You do not teach ' + String(changes.subject) + '.' };
    var out = copyRec(changes);
    NOTE_STAMP_KEYS.forEach(function (k) { delete out[k]; });
    ['addedBy', 'addedByName', 'addedAt'].forEach(function (k) { if (n[k] !== undefined) out[k] = n[k]; });
    out.id = n.id;
    out.editedAt = stampNow(now);
    return { rec: out };
  }
  /* ------------------------------------------------------- tutor theory marking and admin alerts
     Phase 3C slice 6, part 6: a tutor marks theory scripts in their own subjects. There is no
     approval (owner decision, 8 Oct 2026): a mark counts when it is saved. The admin is told
     instead, by an alert on the console home, raised only when a save leaves the script fully
     marked. Any script in the tutor's subject may be marked or re-marked. */
  var ALERT_KEEP_SEEN = 100;

  /* May this tutor mark this attempt? Theory papers only, and only in a subject they teach. */
  function tutorMayMarkScript(tutor, attempt) {
    if (!tutor || tutor.active === false) return { error: 'This tutor account is switched off.' };
    if (!attempt || typeof attempt !== 'object') return { error: 'That script no longer exists.' };
    if (attempt.section !== 'theory') return { error: 'Only theory scripts are marked by hand.' };
    if (!tutorCan(tutor, attempt.subject)) return { error: 'You do not teach ' + String(attempt.subject || 'that subject') + '.' };
    return { ok: true };
  }

  /* A theory script as a tutor sees it: the written answers only, with the mark so far. */
  function tutorScriptSummary(a) {
    var theory = (a.answers || []).filter(function (r) { return r.kind === 'theory'; });
    var marked = theory.filter(function (r) { return r.markAwarded !== null && r.markAwarded !== undefined; }).length;
    return {
      id: a.id, scholarId: a.scholarId, subject: a.subject, period: a.period,
      submittedAt: a.submittedAt, status: a.status, score: a.score, maxScore: a.maxScore, percent: a.percent,
      written: theory.length, marked: marked
    };
  }

  /* The alert for one save that left a script fully marked. `wasMarked` is whether it already was. */
  function makeMarkAlert(tutor, attempt, wasMarked, now) {
    return {
      kind: 'tutor-mark',
      tutorId: String(tutor.id || ''), tutorName: String(tutor.name || ''),
      subject: String(attempt.subject || ''),
      attemptId: String(attempt.id), scholarId: String(attempt.scholarId || ''), studentName: String(attempt.studentName || ''),
      score: attempt.score, maxScore: attempt.maxScore, percent: attempt.percent,
      changed: !!wasMarked,
      at: stampNow(now),
      seen: false
    };
  }

  /* Adds an alert. A second save on a script whose alert is still unseen updates that alert in
     place (same id, newest time and mark) instead of stacking another. Old seen alerts are
     trimmed; unseen ones are never dropped. Returns a new list. */
  function addAlert(list, alert) {
    var out = (list || []).map(copyRec), i, rec = copyRec(alert);
    for (i = 0; i < out.length; i++) {
      if (rec.kind === 'tutor-mark' && !out[i].seen && out[i].kind === rec.kind && out[i].attemptId === rec.attemptId) {
        rec.id = out[i].id; out[i] = rec; return trimAlerts(out);
      }
    }
    out.push(rec);
    return trimAlerts(out);
  }
  function trimAlerts(list) {
    var seen = list.filter(function (a) { return a.seen; }).sort(function (x, y) { return String(y.seenAt || '').localeCompare(String(x.seenAt || '')); });
    var drop = seen.slice(ALERT_KEEP_SEEN);
    return list.filter(function (a) { return drop.indexOf(a) === -1; });
  }
  /* What the console home shows: unseen alerts, newest first. */
  function unseenAlerts(list) {
    return (list || []).filter(function (a) { return !a.seen; }).map(copyRec)
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }
  /* The admin taps Seen. Seen twice is fine. */
  function markAlertSeen(list, id, by, now) {
    var out = (list || []).map(copyRec), i;
    for (i = 0; i < out.length; i++) {
      if (String(out[i].id) === String(id)) {
        if (!out[i].seen) { out[i].seen = true; out[i].seenBy = String(by || ''); out[i].seenAt = stampNow(now); }
        return { list: out, alert: out[i] };
      }
    }
    return { error: 'That alert no longer exists.' };
  }

  /* A tutor's own notes (any state), newest first. */
  function tutorNotes(list, tutor) {
    var mine = (list || []).filter(function (n) { return tutorOwnsNote(tutor, n); });
    return mine.sort(function (a, b) { return String(b.addedAt || '').localeCompare(String(a.addedAt || '')); });
  }
  /* What a student is sent: the note without its author stamp (a tutor's ID and name are not theirs to see). */
  function publicNote(n) {
    var out = copyRec(n);
    NOTE_STAMP_KEYS.forEach(function (k) { delete out[k]; });
    return out;
  }
  /* The console edits a note: the author stamp survives, so it never goes missing by accident. */
  function keepNoteStamp(cur, rec) {
    var out = copyRec(rec);
    NOTE_STAMP_KEYS.forEach(function (k) { if (cur && cur[k] !== undefined) out[k] = cur[k]; else delete out[k]; });
    return out;
  }

  /* ------------------------------------------------------------ class notices (Phase 3C slice 7)
     A tutor posts a short notice for ONE of their subjects. Owner decisions (8 Oct 2026):
     only GOC students taking that subject see it; it stays until the tutor removes it (no expiry,
     no pin); it is live at once; the admin is alerted when a notice is NEW, and an edit is quiet.
     A notice's subject is fixed when it is posted, so an edit can never act as a quiet new post. */
  var NOTICE_TITLE_MIN = 3, NOTICE_TITLE_MAX = 80, NOTICE_BODY_MIN = 10, NOTICE_BODY_MAX = 1000;
  var NOTICE_STAMP_KEYS = ['addedBy', 'addedByName', 'addedAt', 'editedAt'];

  function validateNotice(d) {
    var r = d || {};
    var subject = String(r.subject || '').trim();
    var title = String(r.title || '').replace(/\s+/g, ' ').trim();
    var body = String(r.body || '').replace(/\r\n?/g, '\n').trim();
    if (ALL_SUBJECTS.indexOf(subject) === -1) return { error: 'Choose one of the academy’s subjects.' };
    if (title.length < NOTICE_TITLE_MIN) return { error: 'Give the notice a title of at least ' + NOTICE_TITLE_MIN + ' characters.' };
    if (title.length > NOTICE_TITLE_MAX) return { error: 'Keep the title to ' + NOTICE_TITLE_MAX + ' characters or fewer.' };
    if (body.length < NOTICE_BODY_MIN) return { error: 'Write the notice itself (at least ' + NOTICE_BODY_MIN + ' characters).' };
    if (body.length > NOTICE_BODY_MAX) return { error: 'Keep the notice to ' + NOTICE_BODY_MAX + ' characters or fewer.' };
    return { rec: { id: r.id, subject: subject, title: title, body: body } };
  }

  function tutorOwnsNotice(tutor, n) {
    return !!n && !!tutor && tutor.active !== false && !!tutor.id && n.addedBy === tutor.id && tutorCan(tutor, n.subject);
  }
  /* A validated notice from a tutor, ready to store: stamped, live at once. */
  function stampTutorNotice(rec, tutor, now) {
    if (!rec || typeof rec !== 'object') return { error: 'There is no notice to post.' };
    if (!tutor || tutor.active === false) return { error: 'This tutor account is switched off.' };
    if (!tutorCan(tutor, rec.subject)) return { error: 'You do not teach ' + String(rec.subject || 'that subject') + '.' };
    var out = copyRec(rec);
    out.addedBy = String(tutor.id || '');
    out.addedByName = String(tutor.name || '');
    out.addedAt = stampNow(now);
    delete out.editedAt;
    return { rec: out };
  }
  /* `changes` is a validated record. Author, subject and first-posted time are kept; forged stamps are dropped. */
  function tutorEditNotice(tutor, n, changes, now) {
    if (!tutorOwnsNotice(tutor, n)) return { error: 'You can only change notices you posted, in your own subjects.' };
    if (!changes || typeof changes !== 'object') return { error: 'There is nothing to change.' };
    if (changes.subject !== undefined && changes.subject !== n.subject) return { error: 'A notice stays in the subject it was posted to. Remove it and post a new one instead.' };
    var out = copyRec(changes);
    NOTICE_STAMP_KEYS.forEach(function (k) { delete out[k]; });
    ['addedBy', 'addedByName', 'addedAt'].forEach(function (k) { if (n[k] !== undefined) out[k] = n[k]; });
    out.id = n.id;
    out.subject = n.subject;
    out.editedAt = stampNow(now);
    return { rec: out };
  }
  /* A tutor's own notices, newest first. */
  function tutorNotices(list, tutor) {
    return (list || []).filter(function (n) { return tutorOwnsNotice(tutor, n); })
      .sort(function (a, b) { return String(b.addedAt || '').localeCompare(String(a.addedAt || '')); });
  }
  /* What a student is sent: no tutor ID or name, only "<Subject> tutor", and when it was posted. */
  function publicNotice(n) {
    return {
      id: n.id, subject: n.subject, title: n.title, body: n.body,
      from: String(n.subject) + ' tutor', at: n.addedAt || '', edited: !!n.editedAt
    };
  }
  /* The notices ONE student may read: GOC only (fails closed for anything else), and only for a subject
     the student takes. Newest first. */
  function noticesForStudent(list, student) {
    if (!student || !canUse('classNotices', cleanTier(student.tier))) return [];
    var mine = Array.isArray(student.subjects) ? student.subjects : [];
    return (list || []).filter(function (n) { return n && mine.indexOf(n.subject) !== -1; })
      .sort(function (a, b) { return String(b.addedAt || '').localeCompare(String(a.addedAt || '')); })
      .map(publicNotice);
  }
  /* The alert for a NEW notice. Edits raise none. */
  function makeNoticeAlert(tutor, notice, now) {
    return {
      kind: 'class-notice',
      tutorId: String(tutor.id || ''), tutorName: String(tutor.name || ''),
      subject: String(notice.subject || ''), noticeId: notice.id, title: String(notice.title || ''),
      at: stampNow(now), seen: false
    };
  }
  /* A notice was removed: any alert still waiting for it is kept (the admin should still know it was posted)
     but is flagged `gone`, so the card does not offer to open something that no longer exists. */
  function flagNoticeGone(list, noticeId) {
    return (list || []).map(function (a) {
      var c = copyRec(a);
      if (c.kind === 'class-notice' && String(c.noticeId) === String(noticeId)) c.gone = true;
      return c;
    });
  }

  /* ------------------------------------------------------------ ask a tutor (Phase 4.A, slice 1)
     A student flags a question they are stuck on or think is wrong. The flag goes to the tutor(s) who
     teach that question's subject and to the console. Pure rules only: nothing here stores or serves
     anything. Defaults taken from the roadmap's recommendations, each one a constant or one line below:
     GOC students only (like class notices); a tutor's reply is private to the student who asked; a
     student sees replies on Home only (no email yet). The SUBJECT always comes from the stored
     question, never from what the student sends. One WAITING flag per student per question; once it
     is answered the student may ask again. A student may raise FLAG_DAILY_CAP flags a Nigeria day. */
  var FLAG_REASONS = [
    { id: 'wrong-answer', label: 'The marked answer looks wrong' },
    { id: 'unclear', label: 'The question or explanation is unclear' },
    { id: 'typo', label: 'There is a typo or a mistake in the wording' },
    { id: 'other', label: 'Something else' }
  ];
  var FLAG_STATUSES = ['open', 'answered', 'closed'];
  var FLAG_NOTE_MAX = 300, FLAG_OTHER_NOTE_MIN = 5, FLAG_REPLY_MIN = 2, FLAG_REPLY_MAX = 1000, FLAG_DAILY_CAP = 10;
  var FLAG_QUESTION_SNAPSHOT_MAX = 300;

  function flagReasonLabel(id) {
    var i;
    for (i = 0; i < FLAG_REASONS.length; i++) if (FLAG_REASONS[i].id === id) return FLAG_REASONS[i].label;
    return '';
  }
  function flagStatus(f) {
    var s = f && typeof f.status === 'string' ? f.status : '';
    return FLAG_STATUSES.indexOf(s) === -1 ? 'closed' : s;          // an unknown status fails closed
  }

  /* What a student posts: { questionId, reason, note }. Anything else (subject, author, status) is ignored here. */
  function validateFlag(d) {
    var r = d || {};
    var qid = r.questionId === undefined || r.questionId === null ? '' : String(r.questionId).trim();
    var reason = String(r.reason || '').trim();
    var note = String(r.note || '').replace(/\r\n?/g, '\n').trim();
    if (!qid) return { error: 'Choose the question you are asking about.' };
    if (!flagReasonLabel(reason)) return { error: 'Choose what is wrong: ' + FLAG_REASONS.map(function (x) { return x.label; }).join(', ') + '.' };
    if (note.length > FLAG_NOTE_MAX) return { error: 'Keep your note to ' + FLAG_NOTE_MAX + ' characters or fewer.' };
    if (reason === 'other' && note.length < FLAG_OTHER_NOTE_MIN) return { error: 'Tell the tutor what the problem is (at least ' + FLAG_OTHER_NOTE_MIN + ' characters).' };
    return { rec: { questionId: qid, reason: reason, note: note } };
  }

  /* May this student raise another flag now? `list` is every stored flag. */
  function canFlag(list, studentId, questionId, now) {
    var sid = String(studentId || ''), qid = String(questionId == null ? '' : questionId);
    var today = lagosDay(now), used = 0, i, f;
    for (i = 0; i < (list || []).length; i++) {
      f = list[i];
      if (!f || String(f.studentId) !== sid) continue;
      if (String(f.questionId) === qid && flagStatus(f) === 'open') {
        return { allowed: false, reason: 'duplicate', message: 'You have already asked about this question. A tutor will reply here.' };
      }
      if (lagosDay(Date.parse(f.createdAt)) === today) used++;
    }
    if (used >= FLAG_DAILY_CAP) {
      return { allowed: false, reason: 'daily', message: 'You can ask about up to ' + FLAG_DAILY_CAP + ' questions a day. Try again after midnight.' };
    }
    return { allowed: true, reason: '', message: '' };
  }

  /* A validated flag, ready to store: GOC and active students only; the question must be live and switched on;
     the subject, the question's wording (a snapshot, so the tutor sees what the student saw) and the student's
     name come from the records, never from the request. */
  function stampFlag(rec, question, student, now) {
    if (!rec || typeof rec !== 'object') return { error: 'There is nothing to send.' };
    var v = validateFlag(rec);
    if (v.error) return v;
    if (!student || student.active === false || !canUse('askTutor', cleanTier(student.tier))) {
      return { error: 'Asking a tutor is for GOC students. Ask the academy about joining.' };
    }
    if (!question || !questionIsLive(question) || question.active === false || String(question.id) !== v.rec.questionId) {
      return { error: 'That question is not available.' };
    }
    if (ALL_SUBJECTS.indexOf(question.subject) === -1) return { error: 'That question is not available.' };
    var out = copyRec(v.rec);
    out.studentId = String(student.id || '');
    out.studentName = String(student.name || '');
    out.subject = question.subject;
    out.questionText = String(question.text || question.q || '').replace(/\s+/g, ' ').trim().slice(0, FLAG_QUESTION_SNAPSHOT_MAX);
    out.status = 'open';
    out.createdAt = stampNow(now);
    return { rec: out };
  }

  /* Who receives a flag: every switched-on tutor who teaches the subject, and the console always.
     Tutors come back as { id, name } only. */
  function flagRecipients(subject, tutors) {
    var list = (tutors || []).filter(function (t) { return tutorCan(t, subject); })
      .map(function (t) { return { id: String(t.id || ''), name: String(t.name || '') }; });
    return { tutors: list, console: true };
  }

  /* `actor` is { role: 'tutor', tutor } or { role: 'console', name }. A tutor acts only on their own subjects;
     the console on any. Nobody else (a student, a missing actor) can. */
  function flagActorCan(actor, flag) {
    if (!actor || !flag) return false;
    if (actor.role === 'console') return true;
    if (actor.role === 'tutor') return tutorCan(actor.tutor, flag.subject);
    return false;
  }
  function flagActorName(actor) {
    if (actor.role === 'tutor') return String((actor.tutor && actor.tutor.name) || '');
    return String(actor.name || '').trim() || 'The academy';
  }
  function flagActorId(actor) {
    return actor.role === 'tutor' ? String((actor.tutor && actor.tutor.id) || '') : 'console';
  }

  /* The reply. Allowed while the flag is not closed; a second reply replaces the first (the flag stays answered). */
  function answerFlag(flag, actor, text, now) {
    if (!flag || typeof flag !== 'object') return { error: 'That question was not found.' };
    if (!flagActorCan(actor, flag)) return { error: 'You can only reply to questions in your own subjects.' };
    if (flagStatus(flag) === 'closed') return { error: 'This question is closed.' };
    var body = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (body.length < FLAG_REPLY_MIN) return { error: 'Write your reply (at least ' + FLAG_REPLY_MIN + ' characters).' };
    if (body.length > FLAG_REPLY_MAX) return { error: 'Keep the reply to ' + FLAG_REPLY_MAX + ' characters or fewer.' };
    var out = copyRec(flag);
    out.status = 'answered';
    out.reply = { text: body, byId: flagActorId(actor), byName: flagActorName(actor), role: actor.role, at: stampNow(now) };
    return { rec: out };
  }

  /* Close a flag. Closing twice is harmless: the second call returns the flag as it was, with `noop`. */
  function closeFlag(flag, actor, now) {
    if (!flag || typeof flag !== 'object') return { error: 'That question was not found.' };
    if (!flagActorCan(actor, flag)) return { error: 'You can only close questions in your own subjects.' };
    if (flagStatus(flag) === 'closed') return { rec: copyRec(flag), noop: true };
    var out = copyRec(flag);
    out.status = 'closed';
    out.closedAt = stampNow(now);
    out.closedBy = flagActorId(actor);
    return { rec: out };
  }

  /* What a student is sent: their own words, the question, the status and the reply, from "<Subject> tutor" or
     "G.O.C Academy". Never a tutor or staff ID or name, and never another student. */
  function publicFlag(f) {
    var reply = null;
    if (f.reply && typeof f.reply === 'object') {
      reply = { text: f.reply.text, from: f.reply.role === 'tutor' ? String(f.subject) + ' tutor' : 'G.O.C Academy', at: f.reply.at || '' };
    }
    return {
      id: f.id, questionId: f.questionId, subject: f.subject, questionText: f.questionText || '',
      reason: f.reason, reasonLabel: flagReasonLabel(f.reason), note: f.note || '',
      status: flagStatus(f), createdAt: f.createdAt || '', reply: reply
    };
  }
  function flagNewestFirst(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || (Number(String(b.id || '').replace(/\D/g, '')) || 0) - (Number(String(a.id || '').replace(/\D/g, '')) || 0);
  }
  /* The flags ONE student may read: their own only, and only while they are GOC (fails closed). Newest first. */
  function flagsForStudent(list, student) {
    if (!student || !student.id || !canUse('askTutor', cleanTier(student.tier))) return [];
    return (list || []).filter(function (f) { return f && String(f.studentId) === String(student.id); })
      .sort(flagNewestFirst).map(publicFlag);
  }
  /* What a tutor or the console sees of a flag: the student's name and Scholar ID (as on the at-risk list), never a hash. */
  function staffFlag(f) {
    var p = publicFlag(f);
    p.studentId = f.studentId; p.studentName = f.studentName || '';
    if (f.reply) { p.reply.byName = f.reply.byName || ''; }
    p.closedAt = f.closedAt || '';
    return p;
  }
  function filterFlags(items, opts) {
    var o = opts || {}, status = o.status ? String(o.status) : '';
    return items.filter(function (f) {
      if (o.subject && f.subject !== o.subject) return false;
      if (status && flagStatus(f) !== status) return false;
      return true;
    }).sort(flagNewestFirst).map(staffFlag);
  }
  /* A tutor's flags: only subjects they teach (a switched-off tutor sees nothing). opts: { subject, status }. */
  function flagsForTutor(list, tutor, opts) {
    var mine = (list || []).filter(function (f) { return f && tutorCan(tutor, f.subject); });
    if (opts && opts.subject && !tutorCan(tutor, opts.subject)) return [];
    return filterFlags(mine, opts);
  }
  /* Every flag, for the console. opts: { subject, status }. */
  function flagsForConsole(list, opts) {
    return filterFlags((list || []).filter(function (f) { return !!f; }), opts);
  }
  function flagCounts(list) {
    var c = { open: 0, answered: 0, closed: 0 };
    (list || []).forEach(function (f) { if (f) c[flagStatus(f)]++; });
    return c;
  }
  /* The console-home alert for a NEW flag. A reply raises none. */
  function makeFlagAlert(flag, now) {
    return {
      kind: 'question-flag',
      flagId: flag.id, subject: String(flag.subject || ''),
      studentId: String(flag.studentId || ''), studentName: String(flag.studentName || ''),
      questionId: String(flag.questionId || ''), reason: String(flag.reason || ''),
      at: stampNow(now), seen: false
    };
  }

  /* ------------------------------------------------------------ targeted broadcast (Phase 4, slice 1)
     The console sends a message to GOC students. Owner answers (8 Oct 2026): a student gets it as a
     NOTICE CARD plus a REMINDER (the email reminder system; push does not exist yet), and the audience is
     either ALL GOC students or ONE SUBJECT's GOC students. Open students are never reached (they have no
     class notices either), and no cohort or "everyone" target exists. The card stays until removed. */
  var BROADCAST_TITLE_MIN = 3, BROADCAST_TITLE_MAX = 80, BROADCAST_BODY_MIN = 10, BROADCAST_BODY_MAX = 1000;
  var BROADCAST_AUDIENCES = ['goc', 'subject'];

  /* A stored or posted audience, made safe: { kind: 'goc' } or { kind: 'subject', subject }; anything else is null. */
  function cleanAudience(a) {
    if (!a || typeof a !== 'object') return null;
    var kind = String(a.kind || '').trim().toLowerCase();
    if (kind === 'goc') return { kind: 'goc' };
    if (kind === 'subject') {
      var sub = String(a.subject || '').trim();
      return ALL_SUBJECTS.indexOf(sub) === -1 ? null : { kind: 'subject', subject: sub };
    }
    return null;
  }
  function audienceLabel(a) {
    var c = cleanAudience(a);
    if (!c) return '';
    return c.kind === 'goc' ? 'All GOC students' : c.subject + ' students';
  }
  /* Does this student belong to the audience? GOC only (a missing or odd tier reads as Open), never a deactivated
     student, and a subject audience needs the subject in the student's combination. Fails closed. */
  function audienceHas(audience, student) {
    var a = cleanAudience(audience);
    if (!a || !student || student.active === false) return false;
    if (!canUse('classNotices', cleanTier(student.tier))) return false;
    if (a.kind === 'goc') return true;
    return Array.isArray(student.subjects) && student.subjects.indexOf(a.subject) !== -1;
  }

  function validateBroadcast(d) {
    var r = d || {};
    var audience = cleanAudience(r.audience);
    var title = String(r.title || '').replace(/\s+/g, ' ').trim();
    var body = String(r.body || '').replace(/\r\n?/g, '\n').trim();
    if (!audience) return { error: 'Choose who it goes to: all GOC students, or one subject’s students.' };
    if (title.length < BROADCAST_TITLE_MIN) return { error: 'Give the message a title of at least ' + BROADCAST_TITLE_MIN + ' characters.' };
    if (title.length > BROADCAST_TITLE_MAX) return { error: 'Keep the title to ' + BROADCAST_TITLE_MAX + ' characters or fewer.' };
    if (body.length < BROADCAST_BODY_MIN) return { error: 'Write the message itself (at least ' + BROADCAST_BODY_MIN + ' characters).' };
    if (body.length > BROADCAST_BODY_MAX) return { error: 'Keep the message to ' + BROADCAST_BODY_MAX + ' characters or fewer.' };
    /* The reminder is on unless the sender clearly turns it off. */
    return { rec: { id: r.id, audience: audience, title: title, body: body, remind: r.remind !== false } };
  }
  /* A validated broadcast from a console session, stamped and ready to store. `sender` is the staff member's name. */
  function stampBroadcast(rec, sender, now) {
    if (!rec || typeof rec !== 'object') return { error: 'There is no message to send.' };
    var v = validateBroadcast(rec);
    if (v.error) return v;
    var out = copyRec(v.rec);
    out.sentBy = String(sender || '').trim() || 'The academy';
    out.sentAt = stampNow(now);
    return { rec: out };
  }
  /* What a student is sent: no staff name, only "G.O.C Academy", and when it was sent. */
  function publicBroadcast(b) {
    return { id: b.id, title: b.title, body: b.body, from: 'G.O.C Academy', at: b.sentAt || '' };
  }
  /* The broadcasts ONE student may read: only those whose audience includes them, newest first. */
  function broadcastsForStudent(list, student) {
    return (list || []).filter(function (b) { return b && audienceHas(b.audience, student); })
      .sort(function (a, b) { return String(b.sentAt || '').localeCompare(String(a.sentAt || '')) || (Number(b.id) || 0) - (Number(a.id) || 0); })
      .map(publicBroadcast);
  }
  /* The students a broadcast reaches, for a count before sending and for the reminder step. */
  function broadcastRecipients(audience, students) {
    return (students || []).filter(function (s) { return audienceHas(audience, s); });
  }

  /* Broadcast reminder email (Phase 4, slice 6). A broadcast with the reminder ticked is also emailed, once per
     student, to those it reaches who have a usable address and have not switched email reminders off. It is
     sent by the same hourly sweep as study reminders (so never in the small hours) and only while the
     broadcast is fresh: after BROADCAST_MAIL_DAYS it is never emailed, so a late catch-up or a student who
     becomes GOC next week does not get old news in their inbox (the card on Home still shows it).
     `sentMap` is { studentId: 'YYYY-MM-DD' } of who was already emailed; `fails` is { studentId: n }. */
  var BROADCAST_MAIL_DAYS = 2;
  var BROADCAST_MAIL_MAX_FAILS = 3;
  function broadcastMailPlan(b, student, prefs, sentMap, fails, now) {
    var no = function (why) { return { send: false, reason: why }; };
    if (!b || typeof b !== 'object' || !student || !student.id) return no('input');
    if (b.remind === false) return no('no-reminder');
    if (!audienceHas(b.audience, student)) return no('audience');
    var t = new Date(b.sentAt).getTime(), at = Number(now);
    if (!isFinite(at) || at <= 0) at = Date.now();
    if (!isFinite(t)) return no('no-date');
    if (at - t > BROADCAST_MAIL_DAYS * 86400000) return no('too-old');
    if (at < t) return no('not-yet');
    if (sentMap && sentMap[student.id]) return no('already-sent');
    if (fails && Number(fails[student.id]) >= BROADCAST_MAIL_MAX_FAILS) return no('gave-up');
    if (!cleanReminderPrefs(prefs).email) return no('email-off');
    if (!reminderEmailOk(student.email)) return no('no-address');
    return { send: true, reason: 'ok' };
  }

  /* ------------------------------------------------------------ tutor snapshot
     Phase 3C slice 5, part 1: the numbers on a tutor's snapshot cards, as pure rules.
     Nothing is read or served here; the route (part 2) feeds these functions.
     - "Their students" are GOC students taking the subject; Open students are only counted.
     - Active = practised the subject, or submitted a test in it, in the last 7 days.
     - Practice average: percent of answered questions in that subject that were right,
       over the runs the server still holds (old runs age out, so this is "recent", not "ever").
     - Test average: mean percent over MARKED papers in the subject (theory awaiting marking
       is left out; a score is never guessed).
     - Small sample: an average resting on fewer than 10 answers, or 3 papers, is still
       shown but flagged, so a tutor does not read much into it.
     No name, ID, email or phone ever enters or leaves: the result is only counts and averages. */
  var ANALYTICS_ACTIVE_DAYS = 7;
  var ANALYTICS_MIN_ANSWERS = 10;
  var ANALYTICS_MIN_PAPERS = 3;

  function tutorSnapshot(subject, students, runsByStudent, attempts, now) {
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    var cutoff = at - ANALYTICS_ACTIVE_DAYS * 86400000;
    var runsOf = runsByStudent || {};
    var goc = {}, out = {
      subject: subject, gocStudents: 0, openStudents: 0, active: 0, activeDays: ANALYTICS_ACTIVE_DAYS,
      practice: { answers: 0, correct: 0, average: null, small: true },
      tests: { papers: 0, average: null, small: true }
    };
    var activeIds = {}, i, j, st, runs, run, rows, row, a, pct, sum = 0;
    for (i = 0; i < (students || []).length; i++) {
      st = students[i];
      if (!st || !st.id || !Array.isArray(st.subjects) || st.subjects.indexOf(subject) < 0) continue;
      if (st.active === false) continue;
      if (cleanTier(st.tier) === 'goc') { goc[st.id] = true; out.gocStudents++; }
      else out.openStudents++;
    }
    Object.keys(goc).forEach(function (id) {
      runs = runsOf[id] || [];
      for (i = 0; i < runs.length; i++) {
        run = runs[i];
        if (!run) continue;
        rows = run.review || [];
        var touched = false;
        for (j = 0; j < rows.length; j++) {
          row = rows[j];
          if (!row || row.given == null) continue;
          if ((row.subject || run.subject || '') !== subject) continue;
          out.practice.answers++;
          if (row.isCorrect) out.practice.correct++;
          touched = true;
        }
        if (touched && Number(run.ts) >= cutoff) activeIds[id] = true;
      }
    });
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || !goc[a.scholarId] || a.subject !== subject) continue;
      if (a.status === 'draft' || a.status === 'open') continue;
      if (Number(a.submittedAt) >= cutoff) activeIds[a.scholarId] = true;
      if (a.status === 'marked' && isFinite(Number(a.percent)) && a.percent !== null && a.percent !== '') {
        pct = Number(a.percent);
        out.tests.papers++; sum += pct;
      }
    }
    out.active = Object.keys(activeIds).length;
    if (out.practice.answers) out.practice.average = round1((out.practice.correct / out.practice.answers) * 100);
    out.practice.small = out.practice.answers < ANALYTICS_MIN_ANSWERS;
    if (out.tests.papers) out.tests.average = round1(sum / out.tests.papers);
    out.tests.small = out.tests.papers < ANALYTICS_MIN_PAPERS;
    return out;
  }


  /* ------------------------------------------------------------ tutor activity chart
     Phase 3C slice 5, part 5: one bar group per day for the last 7 days (today included).
     Per day: students active, practice answers given, tests submitted. Same class as the
     snapshot (GOC students taking the subject, not deactivated). Counts only; no name or ID
     leaves. Days are cut on Nigerian time (UTC+1) so a late-evening session lands on the day
     the student lived it. Practice rows come from the runs the server still holds. */
  var ANALYTICS_DAY_OFFSET_MS = 3600000;

  function tutorActivity(subject, students, runsByStudent, attempts, now) {
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    var DAY = 86400000, n = ANALYTICS_ACTIVE_DAYS;
    var todayIdx = Math.floor((at + ANALYTICS_DAY_OFFSET_MS) / DAY);
    var days = [], seen = [], i, j, k, id, st, runs, run, rows, row, a, idx, d;
    for (i = 0; i < n; i++) {
      d = new Date((todayIdx - (n - 1 - i)) * DAY);
      days.push({ day: d.toISOString().slice(0, 10), active: 0, answers: 0, tests: 0 });
      seen.push({});
    }
    var goc = {}, runsOf = runsByStudent || {};
    for (i = 0; i < (students || []).length; i++) {
      st = students[i];
      if (!st || !st.id || !Array.isArray(st.subjects) || st.subjects.indexOf(subject) < 0) continue;
      if (st.active === false || cleanTier(st.tier) !== 'goc') continue;
      goc[st.id] = true;
    }
    function slot(ts) {
      var t = Number(ts); if (!isFinite(t) || t <= 0) return -1;
      idx = Math.floor((t + ANALYTICS_DAY_OFFSET_MS) / DAY) - (todayIdx - (n - 1));
      return (idx >= 0 && idx < n) ? idx : -1;
    }
    Object.keys(goc).forEach(function (sid) {
      runs = runsOf[sid] || [];
      for (j = 0; j < runs.length; j++) {
        run = runs[j]; if (!run) continue;
        k = slot(run.ts); if (k < 0) continue;
        rows = run.review || [];
        for (var r = 0; r < rows.length; r++) {
          row = rows[r];
          if (!row || row.given == null || (row.subject || run.subject || '') !== subject) continue;
          days[k].answers++; seen[k][sid] = true;
        }
      }
    });
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || !goc[a.scholarId] || a.subject !== subject) continue;
      if (a.status === 'draft' || a.status === 'open') continue;
      k = slot(a.submittedAt); if (k < 0) continue;
      days[k].tests++; seen[k][a.scholarId] = true;
    }
    var total = { answers: 0, tests: 0 };
    days.forEach(function (x, q) {
      x.active = Object.keys(seen[q]).length;
      total.answers += x.answers; total.tests += x.tests;
    });
    return { subject: subject, days: days, total: total, gocStudents: Object.keys(goc).length };
  }

  /* ------------------------------------------------------------ tutor at-risk list (rule)
     Phase 3C, the at-risk list, first half: WHO is at risk. Ordering comes in the second half.
     Owner's decisions, 8 Oct 2026:
     - At risk = no activity in the subject for 7 days, OR a Web Test average under 40%.
     - The average uses Web Tests only (marked papers in the subject; practice is left out, theory
       awaiting marking is left out, a score is never guessed). A student with no marked paper has no
       average, so can only be flagged for inactivity.
     - Activity = practice answered in the subject or a submitted test in it (same as the snapshot).
     - A student who has never done anything in the subject is flagged only once 7 days have passed
       since they joined, and is shown as "never started". An unreadable join date is not flagged.
     - Same class as the other tutor cards: GOC students taking the subject, not deactivated.
     Each row carries what the tutor may see on this card: name, Scholar ID, days inactive and last
     score (plus the average, paper count and reasons). No email, phone or other subject's data. */
  var ATRISK_INACTIVE_DAYS = 7;
  var ATRISK_LOW_AVERAGE = 40;

  function tutorAtRisk(subject, students, runsByStudent, attempts, now) {
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    var DAY = 86400000, runsOf = runsByStudent || {};
    var info = {}, ids = [], i, j, st, runs, run, rows, row, a, t, pct;
    for (i = 0; i < (students || []).length; i++) {
      st = students[i];
      if (!st || !st.id || !Array.isArray(st.subjects) || st.subjects.indexOf(subject) < 0) continue;
      if (st.active === false || cleanTier(st.tier) !== 'goc' || info[st.id]) continue;
      info[st.id] = { st: st, last: 0, sum: 0, papers: 0, lastScore: null, lastScoreAt: 0 };
      ids.push(st.id);
    }
    ids.forEach(function (id) {
      runs = runsOf[id] || [];
      for (j = 0; j < runs.length; j++) {
        run = runs[j]; if (!run) continue;
        t = Number(run.ts); if (!isFinite(t) || t <= 0) continue;
        rows = run.review || [];
        for (var r = 0; r < rows.length; r++) {
          row = rows[r];
          if (!row || row.given == null || (row.subject || run.subject || '') !== subject) continue;
          if (t > info[id].last) info[id].last = t;
          break;
        }
      }
    });
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || !info[a.scholarId] || a.subject !== subject) continue;
      if (a.status === 'draft' || a.status === 'open') continue;
      t = Number(a.submittedAt);
      if (isFinite(t) && t > 0 && t > info[a.scholarId].last) info[a.scholarId].last = t;
      if (a.status === 'marked' && a.percent !== null && a.percent !== '' && isFinite(Number(a.percent))) {
        pct = Number(a.percent);
        info[a.scholarId].sum += pct; info[a.scholarId].papers++;
        if (isFinite(t) && t >= info[a.scholarId].lastScoreAt) { info[a.scholarId].lastScore = pct; info[a.scholarId].lastScoreAt = t; }
      }
    }
    var out = [];
    ids.forEach(function (id) {
      var x = info[id], reasons = [], daysInactive = null, never = false, avg = null, joined;
      if (x.last > 0) {
        daysInactive = Math.max(0, Math.floor((at - x.last) / DAY));
        if (daysInactive >= ATRISK_INACTIVE_DAYS) reasons.push('inactive');
      } else {
        joined = Date.parse(x.st.createdAt);
        if (isFinite(joined) && at - joined >= ATRISK_INACTIVE_DAYS * DAY) { never = true; reasons.push('never-started'); }
      }
      if (x.papers) {
        avg = round1(x.sum / x.papers);
        if (avg < ATRISK_LOW_AVERAGE) reasons.push('low-average');
      }
      if (!reasons.length) return;
      out.push({
        id: String(x.st.id), name: String(x.st.name || ''),
        daysInactive: daysInactive, never: never,
        lastScore: x.lastScore === null ? null : round1(x.lastScore),
        average: avg, papers: x.papers, reasons: reasons
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ tutor at-risk list (order)
     Second half: the tutor switches between two orders. Returns a new list, never changes the input.
     'inactive' (the default, also for an unknown mode): never started first (nothing done at all),
        then most days inactive first; ties go to the lower average, then name.
     'score': lowest average first (the number the 40% rule uses); students with no marked paper
        have no average and come last; ties go to the more inactive, then name.
     The last tie-break is the Scholar ID so the order never shuffles between refreshes. */
  function sortAtRisk(rows, mode) {
    var list = (rows || []).filter(function (r) { return r && r.id; }).slice();
    function num(v, fallback) { return v === null || v === undefined || !isFinite(Number(v)) ? fallback : Number(v); }
    function days(r) { return r.never ? Infinity : num(r.daysInactive, -1); }
    function byName(a, b) {
      var x = String(a.name || '').toLowerCase(), y = String(b.name || '').toLowerCase();
      return x < y ? -1 : x > y ? 1 : (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    }
    function cmp(a, b) { return a === b ? 0 : (a < b ? -1 : 1); }
    if (mode === 'score') {
      list.sort(function (a, b) {
        return cmp(num(a.average, Infinity), num(b.average, Infinity)) || cmp(days(b), days(a)) || byName(a, b);
      });
    } else {
      list.sort(function (a, b) {
        return cmp(days(b), days(a)) || cmp(num(a.average, Infinity), num(b.average, Infinity)) || byName(a, b);
      });
    }
    return list;
  }

  /* ------------------------------------------------------------ tutor top performers (rule)
     Phase 3C, top performers, slice 1: WHO tops the class. Owner's decisions, 9 Oct 2026:
     - TWO lists, never blended: Web Tests (average of marked papers in the subject) and Practice (percent right
       over answered questions in the subject). Theory awaiting marking, drafts and open papers are left out.
     - A student needs 2 marked papers (tests list) or 20 answers (practice list) before they can be ranked.
       Someone with some evidence but under the floor is counted in `hidden`, never ranked.
     - Highest first. Ties: more evidence first (papers / answers), then name, then Scholar ID, so the order
       never shuffles. Every ranked student is returned; the screen shows ten and offers Show all.
     - Same class as the other tutor cards: GOC students taking the subject, not deactivated, each once.
     Rows carry name, Scholar ID and the figures only. No email, phone or other subject's data. The caller
     passes runs already trimmed with dropOldRuns, as for the snapshot. */
  var TOP_MIN_PAPERS = 2;
  var TOP_MIN_ANSWERS = 20;

  function tutorTopPerformers(subject, students, runsByStudent, attempts) {
    var runsOf = runsByStudent || {}, info = {}, ids = [], i, j, r, st, runs, run, rows, row, a, pct;
    for (i = 0; i < (students || []).length; i++) {
      st = students[i];
      if (!st || !st.id || !Array.isArray(st.subjects) || st.subjects.indexOf(subject) < 0) continue;
      if (st.active === false || cleanTier(st.tier) !== 'goc' || info[st.id]) continue;
      info[st.id] = { st: st, sum: 0, papers: 0, answers: 0, correct: 0 };
      ids.push(st.id);
    }
    ids.forEach(function (id) {
      runs = runsOf[id] || [];
      for (j = 0; j < runs.length; j++) {
        run = runs[j]; if (!run) continue;
        rows = run.review || [];
        for (r = 0; r < rows.length; r++) {
          row = rows[r];
          if (!row || row.given == null || (row.subject || run.subject || '') !== subject) continue;
          info[id].answers++;
          if (row.isCorrect === true) info[id].correct++;
        }
      }
    });
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || !info[a.scholarId] || a.subject !== subject || a.status !== 'marked') continue;
      if (a.percent === null || a.percent === undefined || a.percent === '' || !isFinite(Number(a.percent))) continue;
      pct = Number(a.percent);
      info[a.scholarId].sum += pct; info[a.scholarId].papers++;
    }
    function byName(x, y) {
      var n = String(x.name || '').toLowerCase(), m = String(y.name || '').toLowerCase();
      return n < m ? -1 : n > m ? 1 : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    }
    var tests = [], practice = [], hiddenT = 0, hiddenP = 0;
    ids.forEach(function (id) {
      var x = info[id], name = String(x.st.name || '');
      if (x.papers >= TOP_MIN_PAPERS) tests.push({ id: String(id), name: name, average: round1(x.sum / x.papers), papers: x.papers });
      else if (x.papers > 0) hiddenT++;
      if (x.answers >= TOP_MIN_ANSWERS) practice.push({ id: String(id), name: name, percent: round1(x.correct / x.answers * 100), answers: x.answers, correct: x.correct });
      else if (x.answers > 0) hiddenP++;
    });
    tests.sort(function (x, y) { return (y.average - x.average) || (y.papers - x.papers) || byName(x, y); });
    practice.sort(function (x, y) { return (y.percent - x.percent) || (y.answers - x.answers) || byName(x, y); });
    return {
      tests: { items: tests, hidden: hiddenT, minPapers: TOP_MIN_PAPERS },
      practice: { items: practice, hidden: hiddenP, minAnswers: TOP_MIN_ANSWERS }
    };
  }

  /* ------------------------------------------------------------ tutor student detail + audit log (rules)
     Phase 3C, student detail page, slice 1: WHAT a tutor may open and what the page holds. Owner's decisions, 9 Oct 2026:
     - A tutor may open any GOC student who took their subject (the subject is in the student's own list), even if the
       account has since been switched off. An Open student, or one who never took the subject, is not openable.
     - The page holds name, Scholar ID and, for the OPEN SUBJECT ONLY: test scores, practice
       figures, the last ten attempts and the student's weakest topics. Nothing from another subject, never a password hash.
     - Weak topics are this student's own practice answers in the subject; a topic needs 3+ answers to be listed (thinner ones are
       counted in `hidden`, never ranked); weakest five, lowest percent first, ties to more answers then topic name.
     - Every successful open is written to the audit log (who, which student, which subject, when) and kept one year.
       A tutor reads only their own entries; management reads all. */
  var STUDENT_RECENT = 10;
  var STUDENT_TOPIC_MIN = 3;
  var STUDENT_TOPICS_SHOWN = 5;
  var AUDIT_KEEP_DAYS = 365;

  function tutorMayOpenStudent(subject, student) {
    if (!student || !student.id || !subject) return false;
    if (cleanTier(student.tier) !== 'goc') return false;
    return Array.isArray(student.subjects) && student.subjects.indexOf(subject) > -1;
  }

  function tutorStudentDetail(subject, student, runs, attempts, now) {
    if (!tutorMayOpenStudent(subject, student)) return null;
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    var DAY = 86400000, id = String(student.id), recent = [], topics = {}, last = 0;
    var answers = 0, correct = 0, sum = 0, papers = 0, lastScore = null, lastScoreAt = 0, i, j, run, rows, row, a, t, pct;
    function num(v) { return v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v); }
    for (i = 0; i < (runs || []).length; i++) {
      run = runs[i]; if (!run) continue;
      t = Number(run.ts); if (!isFinite(t) || t <= 0) t = 0;
      rows = run.review || [];
      var n = 0, c = 0;
      for (j = 0; j < rows.length; j++) {
        row = rows[j];
        if (!row || row.given == null || (row.subject || run.subject || '') !== subject) continue;
        n++; if (row.isCorrect === true) c++;
        var tp = String(row.topic || '').trim();
        if (tp) { topics[tp] = topics[tp] || { n: 0, c: 0 }; topics[tp].n++; if (row.isCorrect === true) topics[tp].c++; }
      }
      if (!n) continue;
      answers += n; correct += c;
      if (t > last) last = t;
      recent.push({ kind: 'practice', at: t, answers: n, correct: c, percent: round1(c / n * 100) });
    }
    for (i = 0; i < (attempts || []).length; i++) {
      a = attempts[i];
      if (!a || String(a.scholarId) !== id || a.subject !== subject) continue;
      if (a.status === 'draft' || a.status === 'open') continue;
      t = Number(a.submittedAt); if (!isFinite(t) || t <= 0) t = 0;
      if (t > last) last = t;
      pct = a.status === 'marked' ? num(a.percent) : null;
      if (pct !== null) { sum += pct; papers++; if (t >= lastScoreAt) { lastScore = pct; lastScoreAt = t; } }
      recent.push({ kind: 'test', at: t, section: String(a.section || ''), status: String(a.status || ''), percent: pct === null ? null : round1(pct),
        score: num(a.score), maxScore: num(a.maxScore) });
    }
    recent.sort(function (x, y) { return (y.at - x.at) || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0); });
    var list = [], hidden = 0;
    Object.keys(topics).forEach(function (k) {
      var x = topics[k];
      if (x.n >= STUDENT_TOPIC_MIN) list.push({ topic: k, answers: x.n, correct: x.c, percent: round1(x.c / x.n * 100) });
      else hidden++;
    });
    list.sort(function (x, y) { return (x.percent - y.percent) || (y.answers - x.answers) || (x.topic < y.topic ? -1 : x.topic > y.topic ? 1 : 0); });
    return {
      id: id, name: String(student.name || ''),
      active: student.active !== false, subject: subject,
      lastActiveAt: last || null, daysInactive: last ? Math.max(0, Math.floor((at - last) / DAY)) : null,
      tests: { papers: papers, average: papers ? round1(sum / papers) : null, lastScore: lastScore === null ? null : round1(lastScore) },
      practice: { answers: answers, correct: correct, percent: answers ? round1(correct / answers * 100) : null },
      recent: recent.slice(0, STUDENT_RECENT),
      weakTopics: { items: list.slice(0, STUDENT_TOPICS_SHOWN), hidden: hidden, minAnswers: STUDENT_TOPIC_MIN }
    };
  }

  /* Email and phone are NOT part of the page: they come only when the tutor taps Show contact, as a request of their own that is
     logged as its own entry ('contact-view'). Same openable rule as the page. */
  function tutorStudentContact(subject, student) {
    if (!tutorMayOpenStudent(subject, student)) return null;
    return { id: String(student.id), name: String(student.name || ''), email: String(student.email || ''), phone: String(student.phone || '') };
  }

  /* The audit log. An entry is stamped by the server; nothing a tutor sends can set any part of it.
     kind: 'tutor-view' (opened the page, the default) or 'contact-view' (showed email and phone). */
  function makeTutorViewEntry(tutor, student, subject, now, kind) {
    if (!tutor || !tutor.id || !student || !student.id || !subject) return null;
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    return { kind: kind === 'contact-view' ? 'contact-view' : 'tutor-view', tutorId: String(tutor.id), tutorName: String(tutor.name || ''), studentId: String(student.id),
      studentName: String(student.name || ''), subject: String(subject), at: at };
  }
  /* Adds an entry and drops anything older than a year. Returns a new list; the input is never changed. */
  function addTutorView(list, entry, now) {
    var at = Number(now); if (!isFinite(at) || at <= 0) at = Date.now();
    var cutoff = at - AUDIT_KEEP_DAYS * 86400000;
    var out = (Array.isArray(list) ? list : []).filter(function (e) { return e && Number(e.at) >= cutoff; });
    if (entry) out.push(entry);
    return out;
  }
  function newestFirst(a, b) { return (b.at - a.at) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0); }
  /* A tutor's own views, newest first. Another tutor's entries never come back, whatever is asked. */
  function tutorOwnViews(list, tutorId) {
    return (Array.isArray(list) ? list : []).filter(function (e) { return e && e.tutorId === String(tutorId); }).sort(newestFirst);
  }
  /* Management's view: every entry, newest first, optionally narrowed to one tutor, one student, one kind
     ('tutor-view' = opened the page, 'contact-view' = showed contact) and/or a date range. from/to are
     Nigeria calendar days (YYYY-MM-DD), both included; a malformed day is ignored, and a range given the
     wrong way round is swapped rather than returning nothing. */
  function validDayStr(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    var t = new Date(d + 'T00:00:00Z');
    return (isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d) ? d : '';
  }
  function auditViews(list, filter) {
    var f = filter || {}, tid = f.tutorId ? String(f.tutorId) : '', sid = f.studentId ? String(f.studentId) : '';
    var kind = (f.kind === 'tutor-view' || f.kind === 'contact-view') ? f.kind : '';
    var from = validDayStr(f.from), to = validDayStr(f.to);
    if (from && to && from > to) { var sw = from; from = to; to = sw; }
    return (Array.isArray(list) ? list : []).filter(function (e) {
      if (!e || typeof e !== 'object' || (tid && e.tutorId !== tid) || (sid && e.studentId !== sid)) return false;
      if (kind && (e.kind === 'contact-view' ? 'contact-view' : 'tutor-view') !== kind) return false;
      if (from || to) {
        var day = lagosDay(Number(e.at));
        if ((from && day < from) || (to && day > to)) return false;
      }
      return true;
    }).sort(newestFirst);
  }
  function auditKindLabel(e) { return e && e.kind === 'contact-view' ? 'Showed contact' : 'Opened page'; }
  /* CSV of audit entries as given (the caller has already filtered). Times are Nigeria time. No email, phone or
     hash is ever in an entry, so none can be in the file. A cell that starts with = + - @ is prefixed with a
     quote so a spreadsheet never runs it as a formula. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function auditCsv(rows) {
    var cell = csvCell;
    var lines = [['Entry', 'Date (Nigeria)', 'Time (Nigeria)', 'Tutor ID', 'Tutor', 'Scholar ID', 'Student', 'Subject', 'Action'].join(',')];
    (Array.isArray(rows) ? rows : []).forEach(function (e) {
      if (!e) return;
      var at = Number(e.at), t = new Date((isFinite(at) ? at : 0) + 3600000).toISOString();
      lines.push([e.id, t.slice(0, 10), t.slice(11, 16), e.tutorId, e.tutorName, e.studentId, e.studentName, e.subject, auditKindLabel(e)].map(cell).join(','));
    });
    return lines.join('\r\n');
  }


  /* ------------------------------------------------------------ results export
     Phase 4.B, slices 1-2 (pure rules + CSV). The console exports MARKED results for a stretch of Nigeria days.
     A "term" is just a pair of days: the console may type any From/To, and the three Nigerian school terms are
     offered as defaults (First 1 Sep-31 Dec, Second 1 Jan-31 Mar, Third 1 Apr-31 Aug of a school year that starts
     in September). Rows: marked papers only; a theory paper still awaiting marking is left out and only COUNTED,
     never guessed; one row per sitting (a JAMB-oriented rehearsal sat twice is two rows). JAMB-oriented rows carry
     the four subject scores (each out of 100) and the total out of 400. No email, phone or hash is ever in a row. */
  var EXPORT_TERM_NAMES = { '1': 'First term', '2': 'Second term', '3': 'Third term' };
  var EXPORT_SECTIONS = ['theory', 'objective', 'jamb'];
  /* The school year a Nigeria day falls in, named by the year it starts (Sep 2026 to Aug 2027 -> 2026). */
  function schoolYearStart(day) {
    var d = validDayStr(day) || lagosDay();
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    return m >= 9 ? y : y - 1;
  }
  function defaultTerms(startYear) {
    var y = Math.floor(Number(startYear));
    if (!isFinite(y) || y < 2000 || y > 2100) return [];
    return [
      { term: '1', name: EXPORT_TERM_NAMES['1'], from: y + '-09-01', to: y + '-12-31' },
      { term: '2', name: EXPORT_TERM_NAMES['2'], from: (y + 1) + '-01-01', to: (y + 1) + '-03-31' },
      { term: '3', name: EXPORT_TERM_NAMES['3'], from: (y + 1) + '-04-01', to: (y + 1) + '-08-31' }
    ];
  }
  /* spec = { from, to } (any two days the console typed) or { term: '1'|'2'|'3', year }. Typed days win. A range given
     the wrong way round is swapped. Returns { from, to, label } or { error }. */
  function termRange(spec) {
    var sp = spec || {};
    var hasFrom = sp.from != null && String(sp.from) !== '', hasTo = sp.to != null && String(sp.to) !== '';
    if (hasFrom || hasTo) {
      var f = validDayStr(String(sp.from || '')), t = validDayStr(String(sp.to || ''));
      if (!hasFrom || !hasTo) return { error: 'Choose both a From and a To date.' };
      if (!f || !t) return { error: 'Choose valid dates.' };
      if (f > t) { var sw = f; f = t; t = sw; }
      return { from: f, to: t, label: f + ' to ' + t };
    }
    var term = String(sp.term == null ? '' : sp.term);
    var hit = defaultTerms(sp.year).filter(function (x) { return x.term === term; })[0];
    if (!hit) return { error: 'Choose a term and a school year, or two dates.' };
    var y = Math.floor(Number(sp.year));
    return { from: hit.from, to: hit.to, label: hit.name + ' ' + y + '/' + String((y + 1) % 100).padStart(2, '0') };
  }
  /* attempts: the stored attempts. opts: { from, to (Nigeria days, both included), subject, section, cohort,
     students: [{ id, cohort }], cohortNames: { cohortId: name } }. Returns { rows, awaiting } - awaiting is how many theory papers in the same
     range/filters are still waiting for marking (left out, but the screen says so). */
  function resultsExportRows(attempts, opts) {
    var o = opts || {};
    var from = validDayStr(o.from), to = validDayStr(o.to);
    var cohortOf = {};
    (Array.isArray(o.students) ? o.students : []).forEach(function (s) { if (s && s.id) cohortOf[String(s.id)] = s.cohort ? String(s.cohort) : ''; });
    var rows = [], awaiting = 0;
    (Array.isArray(attempts) ? attempts : []).forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      if (EXPORT_SECTIONS.indexOf(a.section) < 0) return;
      var day = lagosDay(Number(a.submittedAt));
      if ((from && day < from) || (to && day > to)) return;
      if (o.subject && a.subject !== o.subject) return;
      if (o.section && a.section !== o.section) return;
      var coh = cohortOf[String(a.scholarId)] || '';
      if (o.cohort && coh !== String(o.cohort)) return;
      if (a.status === 'awaiting-marking') { awaiting++; return; }
      if (a.status !== 'marked') return;
      var js = a.section === 'jamb' ? jambScore(a) : null;
      rows.push({
        id: a.id, scholarId: a.scholarId, studentName: a.studentName || '', cohort: coh, cohortName: coh ? String((o.cohortNames && o.cohortNames[coh]) || '') : '',
        subject: a.subject || '', section: a.section, period: a.period || '',
        submittedAt: Number(a.submittedAt), score: a.score, maxScore: a.maxScore, percent: a.percent,
        jamb: js ? { subjects: js.subjects.map(function (b) { return { subject: b.subject, score: b.score }; }), total: js.total, max: js.max } : null
      });
    });
    rows.sort(function (x, y) {
      return (String(x.scholarId) < String(y.scholarId) ? -1 : String(x.scholarId) > String(y.scholarId) ? 1 : 0) ||
             (x.submittedAt - y.submittedAt) || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0);
    });
    return { rows: rows, awaiting: awaiting };
  }
  var EXPORT_SECTION_LABELS = { theory: 'Theory', objective: 'Objective', jamb: 'JAMB-oriented' };
  function resultsCsv(rows) {
    var head = ['Scholar ID', 'Student', 'Cohort', 'Subject', 'Session', 'Period', 'Date (Nigeria)', 'Time (Nigeria)', 'Score', 'Out of', 'Percent'];
    for (var i = 1; i <= 4; i++) head.push('JAMB subject ' + i, 'JAMB score ' + i + ' (out of 100)');
    head.push('JAMB total', 'JAMB out of');
    var lines = [head.join(',')];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r) return;
      var at = Number(r.submittedAt), t = new Date((isFinite(at) ? at : 0) + 3600000).toISOString();
      var line = [r.scholarId, r.studentName, r.cohortName || r.cohort, r.subject, EXPORT_SECTION_LABELS[r.section] || r.section, r.period,
                  t.slice(0, 10), t.slice(11, 16), r.score, r.maxScore, r.percent];
      for (var k = 0; k < 4; k++) {
        var b = r.jamb && r.jamb.subjects && r.jamb.subjects[k];
        line.push(b ? b.subject : '', b ? b.score : '');
      }
      line.push(r.jamb ? r.jamb.total : '', r.jamb ? r.jamb.max : '');
      lines.push(line.map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }


  /* ------------------------------------------------------------ results export: the PDF page model
     Phase 4.B, step 5. A pure description of the pages (A4 landscape, points, y measured from the TOP): text, rules and
     shaded stripes with their final positions, so it can be tested without drawing anything. server/pdf-writer.js turns
     a model into the file. One table per subject (all JAMB-oriented papers share one table that shows the four subject
     scores and the total out of 400); the column heads repeat on every page; every page has a footer with its number.
     meta = { label, from, to, awaiting, generatedOn, filters: { cohortName, subject, section } }. */
  var PDF_PAGE = { w: 842, h: 595, margin: 36 };
  var PDF_ROW_H = 15, PDF_SIZE = 9;
  /* Helvetica widths per 1000 em for the printable ASCII range; anything else is estimated at 556. */
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  function pdfTextWidth(text, size, bold) {
    var s = String(text == null ? '' : text), w = 0, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); w += (c >= 32 && c <= 126) ? HELV[c - 32] : 556; }
    return w / 1000 * size * (bold ? 1.07 : 1);
  }
  /* The text, shortened with "..." so it fits `width` points (it never runs into the next column). */
  function pdfFit(text, width, size, bold) {
    var s = String(text == null ? '' : text).replace(/[\r\n\t]+/g, ' ');
    if (pdfTextWidth(s, size, bold) <= width) return s;
    while (s.length > 1 && pdfTextWidth(s + '...', size, bold) > width) s = s.slice(0, -1);
    return s.replace(/\s+$/, '') + '...';
  }
  var PDF_SHORT = { 'Use of English': 'Eng', 'Physics': 'Phy', 'Chemistry': 'Chem', 'Biology': 'Bio', 'Mathematics': 'Maths' };
  var PDF_PAPER_COLS = [
    { h: 'Scholar ID', w: 78 }, { h: 'Student', w: 196 }, { h: 'Cohort', w: 150 }, { h: 'Session', w: 80 }, { h: 'Date', w: 76 },
    { h: 'Score', w: 44, r: true }, { h: 'Out of', w: 44, r: true }, { h: 'Percent', w: 52, r: true }];
  var PDF_JAMB_COLS = [
    { h: 'Scholar ID', w: 78 }, { h: 'Student', w: 170 }, { h: 'Cohort', w: 120 }, { h: 'Date', w: 76 },
    { h: 'Subject 1', w: 62, r: true }, { h: 'Subject 2', w: 62, r: true }, { h: 'Subject 3', w: 62, r: true }, { h: 'Subject 4', w: 62, r: true },
    { h: 'Total /400', w: 60, r: true }];
  function pdfDay(at) { var n = Number(at); return new Date((isFinite(n) ? n : 0) + 3600000).toISOString().slice(0, 10); }
  function pdfCells(r, jamb) {
    if (jamb) {
      var sc = (r.jamb && r.jamb.subjects) || [], cells = [r.scholarId, r.studentName, r.cohortName || r.cohort || '', pdfDay(r.submittedAt)], k;
      for (k = 0; k < 4; k++) cells.push(sc[k] ? (PDF_SHORT[sc[k].subject] || String(sc[k].subject).slice(0, 5)) + ' ' + sc[k].score : '');
      cells.push(r.jamb ? String(r.jamb.total) : '');
      return cells;
    }
    return [r.scholarId, r.studentName, r.cohortName || r.cohort || '', EXPORT_SECTION_LABELS[r.section] || r.section, pdfDay(r.submittedAt),
            String(r.score), String(r.maxScore), String(r.percent) + '%'];
  }
  function resultsPdfModel(rows, meta) {
    var m = meta || {}, P = PDF_PAGE, list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    var left = P.margin, right = P.w - P.margin, topY = P.margin, footY = P.h - P.margin, limit = footY - 18;
    var pages = [], page = null, y = 0;
    function newPage() {
      page = { number: pages.length + 1, items: [] }; pages.push(page);
      if (pages.length === 1) {
        page.items.push({ kind: 'text', x: left, y: topY + 14, size: 16, bold: true, text: 'GOC Academy - Results' });
        page.items.push({ kind: 'text', x: left, y: topY + 32, size: 11, bold: true, text: String(m.label || ((m.from || '') + ' to ' + (m.to || ''))) + '   (' + (m.from || '') + ' to ' + (m.to || '') + ', Nigeria time)' });
        var f = m.filters || {}, fl = [];
        if (f.cohortName) fl.push('Cohort: ' + f.cohortName);
        if (f.subject) fl.push('Subject: ' + f.subject);
        if (f.section) fl.push('Session: ' + (EXPORT_SECTION_LABELS[f.section] || f.section));
        var lines = [(list.length + ' marked result' + (list.length === 1 ? '' : 's')) + (fl.length ? '   |   ' + fl.join('   |   ') : '   |   All cohorts, subjects and sessions')];
        if (Number(m.awaiting) > 0) lines.push(m.awaiting + ' theory paper' + (Number(m.awaiting) === 1 ? '' : 's') + ' still awaiting marking ' + (Number(m.awaiting) === 1 ? 'is' : 'are') + ' not included.');
        if (m.generatedOn) lines.push('Prepared on ' + m.generatedOn);
        lines.forEach(function (t, i) { page.items.push({ kind: 'text', x: left, y: topY + 48 + i * 13, size: 9, bold: false, text: t }); });
        y = topY + 48 + lines.length * 13 + 12;
      } else {
        page.items.push({ kind: 'text', x: left, y: topY + 9, size: 8, bold: false, text: 'GOC Academy - Results - ' + String(m.label || '') });
        y = topY + 24;
      }
    }
    function colHead(cols) {
      var x = left;
      cols.forEach(function (c) {
        var tx = c.r ? x + c.w - 4 - pdfTextWidth(c.h, PDF_SIZE, true) : x + 2;
        page.items.push({ kind: 'text', x: tx, y: y + 10, size: PDF_SIZE, bold: true, text: c.h });
        x += c.w;
      });
      page.items.push({ kind: 'rule', x1: left, y1: y + PDF_ROW_H, x2: left + cols.reduce(function (t, c) { return t + c.w; }, 0), y2: y + PDF_ROW_H });
      y += PDF_ROW_H + 2;
    }
    function heading(text) { page.items.push({ kind: 'text', x: left, y: y + 11, size: 11, bold: true, text: text }); y += 20; }
    if (!list.length) {
      newPage();
      page.items.push({ kind: 'text', x: left, y: y + 12, size: 11, bold: false, text: 'No marked results match these choices.' });
    } else {
      var groups = {}, order = [];
      list.forEach(function (r) {
        var key = r.section === 'jamb' ? 'JAMB-oriented' : (r.subject || 'Other');
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
      });
      order.sort(function (a, b) { return a === 'JAMB-oriented' ? (b === 'JAMB-oriented' ? 0 : 1) : b === 'JAMB-oriented' ? -1 : (a < b ? -1 : a > b ? 1 : 0); });
      newPage();
      order.forEach(function (key) {
        var jamb = key === 'JAMB-oriented', cols = jamb ? PDF_JAMB_COLS : PDF_PAPER_COLS, rs = groups[key], i = 0, first = true;
        while (i < rs.length) {
          if (y + 20 + PDF_ROW_H + 2 + PDF_ROW_H > limit) newPage();
          heading(key + ' (' + rs.length + ')' + (first ? '' : ' - continued'));
          first = false;
          colHead(cols);
          while (i < rs.length && y + PDF_ROW_H <= limit) {
            var cells = pdfCells(rs[i], jamb), x = left;
            if (i % 2 === 1) page.items.push({ kind: 'rect', x: left, y: y, w: cols.reduce(function (t, c) { return t + c.w; }, 0), h: PDF_ROW_H });
            cells.forEach(function (t, k) {
              var c = cols[k], txt = pdfFit(t, c.w - 6, PDF_SIZE, false);
              page.items.push({ kind: 'text', x: c.r ? x + c.w - 4 - pdfTextWidth(txt, PDF_SIZE, false) : x + 2, y: y + 10.5, size: PDF_SIZE, bold: false, text: txt });
              x += c.w;
            });
            y += PDF_ROW_H; i++;
          }
          if (i < rs.length) newPage(); else y += 10;
        }
      });
    }
    pages.forEach(function (pg) {
      pg.items.push({ kind: 'text', x: left, y: footY, size: 8, bold: false, text: 'GOC Academy - times are Nigeria time' });
      var t = 'Page ' + pg.number + ' of ' + pages.length;
      pg.items.push({ kind: 'text', x: right - pdfTextWidth(t, 8, false), y: footY, size: 8, bold: false, text: t });
    });
    return { page: { w: P.w, h: P.h }, title: 'GOC Academy - Results - ' + String(m.label || ''), generatedOn: m.generatedOn || '', pages: pages };
  }

  /* ------------------------------------------------------------ tutor answer counters
     Phase 3C slice 5, part 3: per-question and per-topic counters, kept as answers are
     marked, because practice history is capped and cannot be rebuilt into statistics.
     Shape (stored as db.answerStats):
       { "<Subject>": { q: { "<questionId>": { n, c } }, t: { "<topic>": { n, c } } } }
     n = answers given, c = answers right. Counts only: no student ID, name or time is kept,
     so a counter can never point back at a person. Only GOC students' answers are counted
     (the caller decides), matching who the snapshot counts. Unanswered rows and theory rows
     (no right/wrong yet) are never counted. Ranking lists need 10+ answers (the owner's
     choice); anything thinner is not ranked, only counted so the screen can say so. */
  var ANALYTICS_WEAK_TOPICS = 5;
  var ANALYTICS_HARDEST_QUESTIONS = 10;
  var ANALYTICS_BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  function statKeyOk(k) {
    return typeof k === 'string' && k !== '' && k.length <= 200 && !ANALYTICS_BAD_KEYS[k];
  }
  function ownBucket(map, key) {
    if (!Object.prototype.hasOwnProperty.call(map, key) || !map[key] || typeof map[key] !== 'object') map[key] = { n: 0, c: 0 };
    return map[key];
  }

  /* Add marked rows (the `answers` of core.markAttempt, or a stored review) to the counters.
     Changes `stats` in place and returns it; `rows` and everything else are left alone.
     A row counts only when it is an objective answer that was given and has a true/false
     verdict. The subject is the row's own, falling back to `subject`. */
  function recordAnswerStats(stats, subject, rows) {
    var st = stats && typeof stats === 'object' ? stats : {}, i, r, sj, b, key;
    for (i = 0; i < (rows || []).length; i++) {
      r = rows[i];
      if (!r || r.given == null || r.given === '' || typeof r.isCorrect !== 'boolean') continue;
      if (r.kind && r.kind !== 'objective') continue;
      sj = String(r.subject || subject || '');
      if (!statKeyOk(sj)) continue;
      if (!Object.prototype.hasOwnProperty.call(st, sj) || !st[sj] || typeof st[sj] !== 'object') st[sj] = { q: {}, t: {} };
      b = st[sj];
      if (!b.q || typeof b.q !== 'object') b.q = {};
      if (!b.t || typeof b.t !== 'object') b.t = {};
      key = r.questionId == null ? '' : String(r.questionId);
      if (statKeyOk(key)) { var qb = ownBucket(b.q, key); qb.n++; if (r.isCorrect) qb.c++; }
      key = r.topic == null ? '' : String(r.topic).trim();
      if (statKeyOk(key)) { var tb = ownBucket(b.t, key); tb.n++; if (r.isCorrect) tb.c++; }
    }
    return st;
  }

  function statPercent(n, c) { return n ? round1((c / n) * 100) : null; }

  /* The weakest topics for one subject: lowest percent right first (more answers wins a tie,
     then the topic name), at least ANALYTICS_MIN_ANSWERS answers, at most `limit` shown.
     `hidden` is how many topics have answers but fewer than that, so the screen can say
     "N more topics need more answers". Counts and percentages only. */
  function rankWeakTopics(subjectStats, limit) {
    var t = subjectStats && subjectStats.t && typeof subjectStats.t === 'object' ? subjectStats.t : {};
    var cap = limit == null ? ANALYTICS_WEAK_TOPICS : Math.max(0, Math.floor(Number(limit) || 0));
    var list = [], hidden = 0;
    Object.keys(t).forEach(function (k) {
      var n = Math.floor(Number(t[k] && t[k].n) || 0), c = Math.floor(Number(t[k] && t[k].c) || 0);
      if (n <= 0 || c < 0 || c > n) return;
      if (n < ANALYTICS_MIN_ANSWERS) { hidden++; return; }
      list.push({ topic: k, answers: n, correct: c, percent: statPercent(n, c) });
    });
    list.sort(function (a, b) {
      return a.percent - b.percent || b.answers - a.answers || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0);
    });
    return { items: list.slice(0, cap), hidden: hidden, minAnswers: ANALYTICS_MIN_ANSWERS };
  }

  /* The hardest questions for one subject: the ones students most often get wrong.
     Needs the bank to say what each question is, and only live objective questions of THIS
     subject can appear (a deleted, switched-off, pending or other-subject question is dropped
     whatever its counter says, so nothing leaks across subjects). Same ordering and the same
     10-answer floor as topics. The text is shortened to 240 characters. */
  function rankHardestQuestions(subjectStats, subject, bank, limit) {
    var q = subjectStats && subjectStats.q && typeof subjectStats.q === 'object' ? subjectStats.q : {};
    var cap = limit == null ? ANALYTICS_HARDEST_QUESTIONS : Math.max(0, Math.floor(Number(limit) || 0));
    var byId = {}, i, b, list = [], hidden = 0;
    for (i = 0; i < (bank || []).length; i++) {
      b = bank[i];
      if (!b || b.subject !== subject || (b.status && b.status !== 'live') || b.active === false) continue;
      if (b.kind && b.kind !== 'objective') continue;
      byId[b.id] = b;
    }
    Object.keys(q).forEach(function (id) {
      var n = Math.floor(Number(q[id] && q[id].n) || 0), c = Math.floor(Number(q[id] && q[id].c) || 0);
      if (n <= 0 || c < 0 || c > n || !Object.prototype.hasOwnProperty.call(byId, id)) return;
      if (n < ANALYTICS_MIN_ANSWERS) { hidden++; return; }
      var row = byId[id], text = String(row.text == null ? (row.question == null ? '' : row.question) : row.text);
      if (text.length > 240) text = text.slice(0, 237) + '...';
      list.push({ id: id, text: text, topic: row.topic || '', section: row.section || '', answers: n, correct: c, percent: statPercent(n, c) });
    });
    list.sort(function (a, b) {
      return a.percent - b.percent || b.answers - a.answers || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    return { items: list.slice(0, cap), hidden: hidden, minAnswers: ANALYTICS_MIN_ANSWERS };
  }

  /* The console's "Subjects & tutors" view (slice 3): for each subject, how deep the
     bank is, so an empty or thin paper stands out. Counts only live questions
     (a question with no status counts as live, so nothing existing disappears).
     Minimums are what a paper needs to feel like a paper, not the UTME ceilings. */
  var SUBJECT_DEPTH_MIN = { objective: 20, theory: 5, jamb: 20, practice: 20, notes: 3 };

  function depthStatus(have, need) {
    return have <= 0 ? 'empty' : (have < need ? 'thin' : 'ok');
  }
  function subjectDepth(questions, notes) {
    var out = [], i, q, n, row, byName = {};
    ALL_SUBJECTS.forEach(function (sj) {
      row = { subject: sj, objective: 0, theory: 0, jamb: 0, practice: 0, notes: 0 };
      byName[sj] = row; out.push(row);
    });
    for (i = 0; i < (questions || []).length; i++) {
      q = questions[i];
      if (!q || !byName[q.subject]) continue;
      if (q.status && q.status !== 'live') continue;
      if (byName[q.subject][q.section] !== undefined && q.section !== 'notes') byName[q.subject][q.section] += 1;
    }
    for (i = 0; i < (notes || []).length; i++) {
      n = notes[i];
      if (n && byName[n.subject] && n.active !== false) byName[n.subject].notes += 1;
    }
    out.forEach(function (r) {
      var flags = {}, weak = [];
      ['objective', 'theory', 'jamb', 'practice', 'notes'].forEach(function (k) {
        if (k === 'theory' && !theoryAllowed(r.subject)) { flags[k] = 'na'; return; }
        flags[k] = depthStatus(r[k], SUBJECT_DEPTH_MIN[k]);
        if (flags[k] !== 'ok') weak.push(k);
      });
      r.status = flags; r.weak = weak;
    });
    return out;
  }

  /* ------------------------------------------------------- admin roles (plan) */

  /* The five administrative roles (owner decision, 10-11 Oct 2026).
     Pure rules only: nothing in the app calls these yet, so no one's access changes.
     The server guard, the Managers panel and the menu filter are later slices.
     Rule of the map: the Founder holds EVERY capability; each other role holds only
     the capabilities that list it below. A capability nobody lists is Founder-only.
     Anything unknown (a mistyped role or capability) is refused, never allowed. */
  var ROLE_FOUNDER = 'founder';
  var ADMIN_ROLES = [
    { key: 'founder', title: 'Founder & Executive Director', aliases: ['Founder'] },
    { key: 'academic-director', title: 'Academic Director', aliases: [] },
    { key: 'finance', title: 'Finance & Administration Manager', aliases: [] },
    { key: 'publicity', title: 'Publicity & Communications Manager', aliases: [] },
    { key: 'student-affairs', title: 'Student Affairs & Operations Coordinator', aliases: [] }
  ];
  var AD = 'academic-director', FIN = 'finance', PUB = 'publicity', SA = 'student-affairs';

  /* capability -> the non-Founder roles that hold it ([] = Founder only). */
  var ROLE_CAPS = {
    /* Founder only */
    'cohort.create': [],
    'tutors.accounts': [],
    'tutors.assign': [],
    'tutors.audit': [],
    'managers.accounts': [],
    'managers.passcode': [],
    'firewall.manage': [],
    'scholarship.approve': [],
    'termreport.signoff': [],
    'overview.all': [],
    /* Finance & Administration */
    'students.approve': [FIN],
    'students.add': [FIN],
    'students.tier': [FIN],
    'students.deactivate': [FIN],
    'payments.view': [FIN],
    /* Academic Director */
    'questions.manage': [AD],
    'approvals.review': [AD],
    'courses.manage': [AD],
    'theory.mark': [AD],
    'mastery.view': [AD],
    'assignments.oversee': [AD],
    'assignments.remove': [AD],
    'classes.schedule': [AD],
    'resources.publish': [AD],
    'sittings.configure': [AD],
    /* Publicity & Communications */
    'analytics.site': [PUB],
    'aitip.edit': [PUB],
    'whatsapp.links': [PUB],
    'landing.text': [PUB],
    /* Student Affairs & Operations */
    'students.passwords': [SA],
    'cohort.manage': [SA],
    'cohort.limits': [SA],
    'reportcards.generate': [SA],
    'termreport.produce': [SA],
    'activeness.view': [SA],
    'attention.view': [SA],
    'studypairs.moderate': [SA],
    'attendance.view': [SA],
    'scholarship.decide': [SA],
    'scholarship.export': [SA],
    'scholarship.delete': [SA],
    /* shared by more than one role */
    'results.view': [AD, SA],
    'results.export': [AD, SA],
    'classsummary.view': [AD, SA],
    'leaderboard.manage': [AD, SA],
    'broadcast.send': [PUB, SA],
    'contact.handle': [PUB, SA],
    'notices.manage': [AD, PUB],
    'homepage.edit': [PUB, AD],
    'signup.limits': [SA],
    /* roles slice (c), 14 Oct 2026: a GOC student's request for more daily study time is granted by Student Affairs */
    'studytime.grant': [SA],
    'scholarship.view': [AD, SA],
    'managerlog.view': [AD],
    'overview.own': [AD, FIN, PUB, SA],
    /* added in roles slice (b), step 12 */
    'roster.view': [AD, FIN, PUB, SA],
    'challenges.manage': [AD],
    /* step 13: Founder-only on purpose (role-filtered alerts and a scoped overview come in later slices) */
    'alerts.all': [],
    'system.migrate': []
  };

  function adminRoleKey(role) {
    var s = String(role == null ? '' : role).trim().toLowerCase();
    for (var i = 0; i < ADMIN_ROLES.length; i++) {
      var r = ADMIN_ROLES[i];
      if (s === r.key || s === r.title.toLowerCase()) return r.key;
      for (var j = 0; j < r.aliases.length; j++) if (s === r.aliases[j].toLowerCase()) return r.key;
    }
    return null;
  }
  function adminRoleTitle(role) {
    var k = adminRoleKey(role);
    for (var i = 0; i < ADMIN_ROLES.length; i++) if (ADMIN_ROLES[i].key === k) return ADMIN_ROLES[i].title;
    return null;
  }
  function allCapabilities() { return Object.keys(ROLE_CAPS).sort(); }
  function roleCan(role, cap) {
    var k = adminRoleKey(role);
    if (!k || !Object.prototype.hasOwnProperty.call(ROLE_CAPS, cap)) return false;
    return k === ROLE_FOUNDER || ROLE_CAPS[cap].indexOf(k) > -1;
  }
  /* Roles slice (b), step 2: may this management account use a console route?
     The two seeded accounts (GOC-A-001 Founder, GOC-A-002 Academic Director) keep full access,
     as the owner decided; only managers issued later (GOC-A-003 up) are held to the capability map.
     A route with no capability, a mistyped one, or a missing role is refused for them, never allowed. */
  var FULL_ACCESS_IDS = ['GOC-A-001', 'GOC-A-002'];
  function adminMayUse(id, role, cap) {
    if (FULL_ACCESS_IDS.indexOf(id) > -1) return true;
    if (typeof cap !== 'string' || !cap) return false;
    return roleCan(role, cap);
  }
  /* Roles slice (c), step 6: who sees which console alert. Owner decision (14 Oct 2026): the Founder
     plus the role that matches the alert. The owner of each kind is read from the capability map
     (so changing who holds a capability moves the alert with it): a marked theory script goes to
     whoever may mark theory, a class notice to whoever manages notices, a student's question flag
     to whoever manages the question bank, an assignment to whoever oversees assignments, and a
     contact message to whoever handles contact. A kind with no entry here is Founder-only (fail
     closed). The two seeded accounts keep full access, as everywhere else. */
  var ALERT_CAPS = {
    'tutor-mark': 'theory.mark',
    'class-notice': 'notices.manage',
    'question-flag': 'questions.manage',
    'assignment': 'assignments.oversee',
    'contact-message': 'contact.handle'
  };
  function alertCapability(kind) {
    return Object.prototype.hasOwnProperty.call(ALERT_CAPS, kind) ? ALERT_CAPS[kind] : null;
  }
  function alertVisibleTo(alert, id, role) {
    if (FULL_ACCESS_IDS.indexOf(id) > -1) return true;
    var k = adminRoleKey(role);
    if (!k) return false;
    if (k === ROLE_FOUNDER) return true;
    var cap = alertCapability(alert && alert.kind);
    return cap ? roleCan(k, cap) : false;
  }
  function alertsFor(list, id, role) {
    return (Array.isArray(list) ? list : []).filter(function (a) { return alertVisibleTo(a, id, role); });
  }

  /* Roles slice (d) follow-up, 16 Oct 2026: the console Overview figures, scoped by role.
     Until now the route was Founder-only (overview.all), so a manager's four tiles showed dashes.
     Each figure now needs a capability the role already holds, read from the same map, so no new
     owner decision is hidden in here: the student count needs roster.view, "active today" needs
     activeness.view, the average mock score needs results.view, and lessons published needs
     resources.publish. The Founder and the two seeded accounts see all four; a missing or mistyped
     role sees none (fail closed). A figure a role may not see is left OUT of the reply, not zeroed,
     so the page shows a dash rather than a false number. Counts only: no name, ID or score row. */
  var OVERVIEW_FIGURE_CAPS = {
    studentsTotal: 'roster.view',
    activeToday: 'activeness.view',
    avgScorePercent: 'results.view',
    lessonsPublished: 'resources.publish'
  };
  function overviewFiguresAllowed(id, role) {
    return Object.keys(OVERVIEW_FIGURE_CAPS).filter(function (k) {
      return adminMayUse(id, role, OVERVIEW_FIGURE_CAPS[k]);
    });
  }
  function overviewFor(id, role, figures) {
    var out = {}, src = figures || {};
    overviewFiguresAllowed(id, role).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    });
    return out;
  }


  /* Roles slice (d): which console menu entries a management account sees. Each section lists the
     capabilities that open it; the account sees the section when it holds ANY of them. The list is
     read from the same capability map the server guard uses, so the menu can never offer something
     the server would refuse for every route in it. This only tidies the menu: the server guard is
     still the real gate. The two seeded accounts see everything; a section nobody listed, a
     mistyped one, or a missing role is hidden (fail closed). */
  var CONSOLE_SECTIONS = {
    overview: ['overview.own'],
    students: ['roster.view'],
    cohorts: ['cohort.manage', 'cohort.create'],
    questions: ['questions.manage'],
    notes: ['questions.manage'],
    passages: ['questions.manage'],
    'import': ['questions.manage'],
    videos: ['resources.publish'],
    resources: ['resources.publish'],
    classes: ['classes.schedule'],
    broadcast: ['broadcast.send'],
    homepage: ['homepage.edit'],
    affirmations: ['homepage.edit'],
    results: ['results.view'],
    theorymark: ['theory.mark'],
    league: ['challenges.manage'],
    objective: ['sittings.configure'],
    jamb: ['sittings.configure'],
    window: ['sittings.configure'],
    tutors: ['tutors.accounts'],
    managers: ['managers.accounts'],
    approvals: ['approvals.review'],
    flags: ['approvals.review'],
    challenges: ['challenges.manage'],
    access: ['managers.accounts'],
    siteanalytics: ['analytics.site'],
  };
  function consoleSectionAllowed(section, id, role) {
    if (!Object.prototype.hasOwnProperty.call(CONSOLE_SECTIONS, section)) return false;
    if (FULL_ACCESS_IDS.indexOf(id) > -1) return true;
    return roleCanAny(role, CONSOLE_SECTIONS[section]);
  }
  function consoleSectionsFor(id, role) {
    return Object.keys(CONSOLE_SECTIONS).filter(function (k) { return consoleSectionAllowed(k, id, role); });
  }
  function allConsoleSections() { return Object.keys(CONSOLE_SECTIONS); }

  /* Roles slice (c), step 7: the manager-action log. Owner decisions (14 Oct 2026): only sensitive
     actions are recorded (passwords, access tiers, switching accounts off or on, approvals, and
     deletions); the Founder reads every entry and each manager reads only their own; the newest
     1,000 are kept. Entries are worked out here from the request's method and path, so the same
     table can never drift from what the server logs. Nothing typed into the request is stored
     except the access tier and the on/off choice; a password or passcode never reaches the log. */
  var MANAGER_LOG_KEEP = 1000;
  var ID = '([A-Za-z0-9._-]+)';
  var AUDIT_RULES = [
    ['PUT',    new RegExp('^/api/students/' + ID + '/active$'),        'student-active',         'Switched a student account on or off', 'active'],
    ['POST',   new RegExp('^/api/students/' + ID + '/approve$'),       'student-approve',        'Approved a sign-up', null],
    ['DELETE', new RegExp('^/api/students/' + ID + '/approve$'),       'student-reject',         'Rejected a sign-up (record deleted)', null],
    ['POST',   new RegExp('^/api/students/' + ID + '/reset$'),         'student-password-reset', 'Reset a student password', null],
    ['PUT',    new RegExp('^/api/students/' + ID + '/tier$'),          'student-tier',           'Changed a student access tier', 'tier'],
    ['PUT',    new RegExp('^/api/admin/cohorts/' + ID + '/tier$'),     'cohort-tier',            'Changed the access tier of a whole cohort', 'tier'],
    ['DELETE', new RegExp('^/api/admin/cohorts/' + ID + '$'),          'cohort-delete',          'Deleted a cohort', null],
    ['PUT',    new RegExp('^/api/tutors/' + ID + '/password$'),        'tutor-password-reset',   'Reset a tutor password', null],
    ['PUT',    new RegExp('^/api/tutors/' + ID + '/active$'),          'tutor-active',           'Switched a tutor account on or off', 'active'],
    ['PUT',    new RegExp('^/api/managers/' + ID + '/password$'),      'manager-password-reset', 'Reset a manager password', null],
    ['PUT',    new RegExp('^/api/managers/' + ID + '/active$'),        'manager-active',         'Switched a manager account on or off', 'active'],
    ['DELETE', new RegExp('^/api/managers/' + ID + '$'),               'manager-delete',         'Deleted a manager account', null],
    ['PUT',    new RegExp('^/api/staff/' + ID + '/password$'),         'staff-password-change',  'Changed a management password', null],
    ['PUT',    /^\/api\/settings\/passcode$/,                          'passcode-change',        'Changed the console passcode', null],
    ['POST',   /^\/api\/auth\/password$/,                              'own-password-change',    'Changed their own password', null],
    ['POST',   new RegExp('^/api/approvals/' + ID + '/approve$'),      'content-approve',        'Approved tutor content', null],
    ['POST',   new RegExp('^/api/approvals/' + ID + '/return$'),       'content-return',         'Returned tutor content', null],
    ['POST',   /^\/api\/approvals\/batch\/approve$/,                   'content-approve-batch',  'Approved a batch of tutor content', null],
    ['DELETE', /^\/api\/questions\/bulk$/,                             'question-delete-bulk',   'Deleted questions in bulk', null],
    ['DELETE', new RegExp('^/api/questions/' + ID + '$'),              'question-delete',        'Deleted a question', null],
    ['DELETE', /^\/api\/notes\/bulk$/,                                 'note-delete-bulk',       'Deleted notes in bulk', null],
    ['DELETE', new RegExp('^/api/notes/' + ID + '$'),                  'note-delete',            'Deleted a note', null],
    ['DELETE', new RegExp('^/api/passages/' + ID + '$'),               'passage-delete',         'Deleted a comprehension passage', null],
    ['DELETE', new RegExp('^/api/updates/' + ID + '$'),                'update-delete',          'Deleted a news update', null],
    ['DELETE', new RegExp('^/api/notices/' + ID + '$'),                'notice-delete',          'Removed a class notice', null],
    ['DELETE', new RegExp('^/api/broadcasts/' + ID + '$'),             'broadcast-delete',       'Removed a broadcast', null],
    ['DELETE', new RegExp('^/api/admin/resources/' + ID + '$'),        'resource-delete',        'Deleted a resource', null],
    ['DELETE', new RegExp('^/api/admin/videos/' + ID + '$'),           'video-delete',           'Deleted a video', null],
    ['DELETE', new RegExp('^/api/admin/classes/' + ID + '$'),          'class-delete',           'Deleted a live class', null]
  ];
  /* Is this request one the log records? Returns { action, label, target, detail } or null.
     `detail` is only ever the access tier ('goc' or 'open') or the on/off choice (true or false). */
  function auditActionFor(method, urlPath, body) {
    var m = String(method || '').toUpperCase(), p = String(urlPath || '').split('?')[0];
    for (var i = 0; i < AUDIT_RULES.length; i++) {
      var r = AUDIT_RULES[i];
      if (r[0] !== m) continue;
      var hit = r[1].exec(p);
      if (!hit) continue;
      var detail = null, b = body && typeof body === 'object' ? body : {};
      if (r[4] === 'active' && typeof b.active === 'boolean') detail = b.active;
      if (r[4] === 'tier') {
        var t = String(b.tier == null ? '' : b.tier).trim().toLowerCase();
        if (t === 'goc' || t === 'open') detail = t;
      }
      return { action: r[2], label: r[3], target: hit[1] ? String(hit[1]) : '', detail: detail };
    }
    return null;
  }
  /* One stored entry. `actor` is { id, name, roleKey } from the signed-in session, never the request. */
  function stampManagerAction(actor, spec, seq, now) {
    var a = actor || {};
    return {
      id: Number(seq) || 0,
      at: stampNow(now),
      by: String(a.id || ''), byName: String(a.name || ''), role: adminRoleKey(a.roleKey) || null,
      action: spec.action, label: spec.label,
      target: spec.target || (spec.action === 'own-password-change' ? String(a.id || '') : ''),
      detail: spec.detail === undefined ? null : spec.detail
    };
  }
  /* Append and keep only the newest MANAGER_LOG_KEEP. Never mutates the list passed in. */
  function addManagerAction(list, entry) {
    var out = (Array.isArray(list) ? list : []).concat([entry]);
    return out.length > MANAGER_LOG_KEEP ? out.slice(out.length - MANAGER_LOG_KEEP) : out;
  }
  /* What one reader may see, newest first. The Founder and the two seeded accounts read every entry;
     any other manager reads only the entries they made themselves, and cannot widen that with a filter.
     opts: by (Founder/seeded only), action, from, to (ISO times), limit (default 200, at most 1000). */
  function managerLogFor(list, id, role, opts) {
    var o = opts || {}, k = adminRoleKey(role);
    var all = FULL_ACCESS_IDS.indexOf(id) > -1 || k === ROLE_FOUNDER;
    var limit = Math.max(1, Math.min(MANAGER_LOG_KEEP, Math.floor(Number(o.limit)) || 200));
    var rows = (Array.isArray(list) ? list : []).filter(function (e) {
      if (!all && e.by !== id) return false;
      if (all && o.by && e.by !== String(o.by).toUpperCase()) return false;
      if (o.action && e.action !== o.action) return false;
      if (o.from && String(e.at) < String(o.from)) return false;
      if (o.to && String(e.at) > String(o.to)) return false;
      return true;
    });
    rows.sort(function (a, b) { return b.id - a.id; });
    return rows.slice(0, limit).map(function (e) { return JSON.parse(JSON.stringify(e)); });
  }

  function roleCanAny(role, caps) {
    return Array.isArray(caps) && caps.some(function (c) { return roleCan(role, c); });
  }
  function capabilitiesOf(role) {
    return allCapabilities().filter(function (c) { return roleCan(role, c); });
  }
  function rolesWithCapability(cap) {
    return ADMIN_ROLES.map(function (r) { return r.key; }).filter(function (k) { return roleCan(k, cap); });
  }
  /* The four roles the Founder can issue IDs for in the Managers panel. */
  function managerRoles() {
    return ADMIN_ROLES.filter(function (r) { return r.key !== ROLE_FOUNDER && r.key !== 'academic-director'; }).map(function (r) { return { key: r.key, title: r.title }; });
  }
  /* Next management ID: GOC-A-001 and 002 exist; managers start at 003. Gaps are never refilled. */
  function nextAdminId(existingIds) {
    var top = 2;
    (Array.isArray(existingIds) ? existingIds : []).forEach(function (id) {
      var m = /^GOC-A-(\d{3,})$/.exec(String(id));
      if (m && Number(m[1]) > top) top = Number(m[1]);
    });
    var n = String(top + 1);
    while (n.length < 3) n = '0' + n;
    return 'GOC-A-' + n;
  }

  /* ---------------------------------------------------- managers panel (rules) */

  /* Roles slice (c), step 1. Pure rules only: nothing stores or serves a manager yet.
     Owner decisions (14 Oct 2026): the Founder types the first password and the manager must
     change it at first login; each manager has their own console passcode, set by the Founder
     only; the Founder may deactivate or delete a manager, and a used ID is never issued again. */
  var MANAGER_PASSWORD_MIN = 8;
  var MANAGER_PASSCODE_RE = /^\d{4,8}$/;

  /* The next manager ID. A deleted manager leaves no record, so the server keeps a high-water
     mark (the highest ID ever issued) and this never goes below it: GOC-A-001 and 002 are
     the seeded accounts, so the first manager is GOC-A-003. */
  function nextManagerId(existingIds, highWater) {
    var ids = Array.isArray(existingIds) ? existingIds.slice() : [];
    if (highWater) ids.push(highWater);
    return nextAdminId(ids);
  }

  /* Check what the Founder typed for a manager. Creating needs a password and a passcode;
     editing may leave either blank (blank = keep). Only the four non-Founder roles can be issued,
     by key or by full title. Returns { error } or { rec } where rec carries the typed secrets
     for the server to hash; it is never stored or sent back as it stands. */
  function validateManager(d, opts) {
    var r = d || {}, o = opts || {};
    var name = String(r.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2) return { error: 'Give the manager a name.' };
    if (name.length > 80) return { error: 'The manager’s name is too long (80 letters at most).' };

    var role = adminRoleKey(r.role);
    if (!role || role === ROLE_FOUNDER) return { error: 'Choose one of the four manager roles.' };

    var creating = o.creating === undefined ? true : !!o.creating;
    var pw = r.password == null ? '' : String(r.password);
    if (creating || pw) {
      if (pw.length < MANAGER_PASSWORD_MIN) return { error: 'Choose a starting password of at least ' + MANAGER_PASSWORD_MIN + ' characters.' };
      if (pw.length > 200) return { error: 'That password is too long.' };
    }
    var pc = r.passcode == null ? '' : String(r.passcode).trim();
    if (creating || pc) {
      if (!MANAGER_PASSCODE_RE.test(pc)) return { error: 'The console passcode is 4 to 8 digits.' };
    }
    return { rec: {
      name: name, role: role, title: adminRoleTitle(role),
      password: pw, passcode: pc,
      /* a password the Founder typed is only a starting one */
      mustChangePassword: pw ? true : undefined
    } };
  }

  /* Roles slice (c), step 3b. A manager changes the starting password the Founder typed.
     Same floor and the same letters-and-numbers rule as every management password; the new
     one must differ from the current one. Returns an error sentence, or null when it is fine.
     (The passcode is never changed here: only the Founder sets a manager's passcode.) */
  function managerPasswordChangeError(current, next) {
    var c = current == null ? '' : String(current), n = next == null ? '' : String(next);
    if (n.length < MANAGER_PASSWORD_MIN) return 'Choose a password of at least ' + MANAGER_PASSWORD_MIN + ' characters.';
    if (n.length > 200) return 'That password is too long.';
    if (!/[0-9]/.test(n) || !/[a-zA-Z]/.test(n)) return 'Use both letters and numbers in a management password.';
    if (n === c) return 'Choose a different password from the one you have now.';
    return null;
  }

  /* ---------------------------------------------------- scholarship (B#2 slice 1 — pure rules)
     Owner decisions (17 Oct 2026):
       • 30 free scholarship places; accepted applicants become GOC students.
       • Form is a dedicated screen inside the app (#scholarship).
       • Fields: name, email, phone, state & city, exam status, subjects,
                 parent/guardian name + email + phone/WhatsApp, pledge checkbox.
       • Public sees "open" or "closed" only — no remaining-place count.
       • When 30 places fill: form closes, Cohort 2.0 waitlist opens (one mode at a time).
       • Anyone may apply — new visitors and existing Open students alike.
       • One active application per email address: a pending or accepted applicant
         cannot submit again; a rejected one may reapply.
       • Application IDs: SCH-1, SCH-2, … (server mints them; rules use a counter).
       • Waitlist IDs: WL-1, WL-2, …
       • Statuses: 'pending' | 'accepted' | 'rejected' | 'approved' (Founder signed off)
       • Waitlist statuses: 'waiting' | 'notified' | 'withdrawn' */

  var SCHOLARSHIP_PLACES   = 30;
  var SCHOLARSHIP_STATUSES = ['pending', 'accepted', 'rejected', 'approved'];
  var SCHOLARSHIP_INACTIVITY_DAYS = 14;   /* continuous inactivity → withdrawal */

  /* Nigerian states — used to validate the state field. */
  var NIGERIA_STATES = [
    'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
    'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo',
    'Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
    'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba',
    'Yobe','Zamfara'
  ];

  /* Exam-status values accepted on the form. */
  var SCHOLARSHIP_EXAM_STATUSES = [
    'Preparing for JAMB 2027',
    'Preparing for JAMB 2028',
    'Already sat JAMB, want to improve',
    'Not yet registered'
  ];

  /* ---------- helpers ---------- */

  /* Trim and normalise a string field; return '' if absent. */
  function _sch_str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  /* Very light email check — same rule used elsewhere in the project. */
  function _sch_email(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')); }

  /* Light phone check: digits, spaces, +, -, (, ) — at least 7 digits present. */
  function _sch_phone(v) {
    var s = String(v || '').replace(/[\s\-().+]/g, '');
    return /^\d{7,15}$/.test(s);
  }

  /* ---------- scholarshipOpen ----------
     Returns 'open' | 'waitlist' | 'closed'.
       settings.scholarshipOpen    boolean — Founder can force-close
       settings.waitlistOpen       boolean — Founder can open the waitlist separately
       approvedCount               number  — accepted + approved applications
  */
  function scholarshipOpen(settings, approvedCount) {
    var s = settings || {};
    var count = Number(approvedCount) || 0;
    /* Founder force-closed everything */
    if (s.scholarshipOpen === false && s.waitlistOpen !== true) return 'closed';
    /* All 30 places taken (or Founder closed scholarship but left waitlist open) */
    if (count >= SCHOLARSHIP_PLACES || s.scholarshipOpen === false) {
      return s.waitlistOpen === true ? 'waitlist' : 'closed';
    }
    return 'open';
  }

  /* ---------- waitlistOpen ---------- */
  function waitlistOpen(settings, approvedCount) {
    return scholarshipOpen(settings, approvedCount) === 'waitlist';
  }

  /* ---------- canApply ----------
     Returns { allowed: true } or { allowed: false, reason }.
     applications: array of stored application records.
     email: the applicant's email (case-insensitive).
     A pending or accepted/approved application blocks reapplication.
     A rejected application allows it.
  */
  function canApply(applications, email) {
    var e = String(email || '').toLowerCase().trim();
    if (!e) return { allowed: false, reason: 'No email address given.' };
    var list = Array.isArray(applications) ? applications : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var ae = String(a.email || '').toLowerCase().trim();
      if (ae !== e) continue;
      if (a.status === 'pending')  return { allowed: false, reason: 'You already have an application under review.' };
      if (a.status === 'accepted') return { allowed: false, reason: 'Your application has been accepted — check your email.' };
      if (a.status === 'approved') return { allowed: false, reason: 'Your application has been accepted — check your email.' };
      /* 'rejected' → allowed to reapply (loop continues in case of multiple past records) */
    }
    return { allowed: true };
  }

  /* ---------- validateScholarApplication ----------
     Validates and normalises a scholarship application form submission.
     Returns { error } on the first problem or { rec } on success.
     `d` is the raw form object. `now` is optional (ms).
  */
  function validateScholarApplication(d) {
    var r = d || {};

    /* — personal — */
    var name = _sch_str(r.name);
    if (name.length < 2)   return { error: 'Enter your full name.' };
    if (name.length > 100) return { error: 'Name is too long (100 characters at most).' };

    var email = _sch_str(r.email).toLowerCase();
    if (!_sch_email(email)) return { error: 'Enter a valid email address.' };

    var phone = _sch_str(r.phone);
    if (!_sch_phone(phone)) return { error: 'Enter a valid phone number.' };

    /* — location — */
    var state = _sch_str(r.state);
    if (!state) return { error: 'Select your state.' };
    if (NIGERIA_STATES.indexOf(state) === -1) return { error: 'Choose a state from the list.' };

    var city = _sch_str(r.city);
    if (city.length < 2)  return { error: 'Enter your city or local government area.' };
    if (city.length > 80) return { error: 'City name is too long (80 characters at most).' };

    /* — exam status — */
    var examStatus = _sch_str(r.examStatus);
    if (SCHOLARSHIP_EXAM_STATUSES.indexOf(examStatus) === -1)
      return { error: 'Choose your exam status from the list.' };

    /* — subjects: must be exactly 4, must include Use of English, all must be known — */
    var subjects = Array.isArray(r.subjects) ? r.subjects.map(_sch_str).filter(Boolean) : [];
    if (subjects.length !== 4)
      return { error: 'Choose exactly 4 subjects (Use of English plus 3 sciences).' };
    if (subjects.indexOf(ENGLISH) === -1)
      return { error: 'Your subject combination must include Use of English.' };
    var ordered = orderedCombination(subjects);
    if (ordered.length !== 4)
      return { error: 'Your subject combination is not valid. Include Use of English and 3 science subjects.' };

    /* — parent / guardian — */
    var pgName = _sch_str(r.parentName);
    if (pgName.length < 2)   return { error: 'Enter your parent or guardian\'s name.' };
    if (pgName.length > 100) return { error: 'Parent or guardian name is too long.' };

    var pgEmail = _sch_str(r.parentEmail).toLowerCase();
    var pgPhone = _sch_str(r.parentPhone);
    var hasParentEmail = _sch_email(pgEmail);
    var hasParentPhone = _sch_phone(pgPhone);
    /* At least one contact method required */
    if (!hasParentEmail && !hasParentPhone)
      return { error: 'Enter your parent or guardian\'s email address or phone number (or both).' };
    if (pgEmail && !hasParentEmail)
      return { error: 'The parent or guardian email address does not look right.' };
    if (pgPhone && !hasParentPhone)
      return { error: 'The parent or guardian phone number does not look right.' };

    /* — pledge — */
    if (!r.pledge) return { error: 'Tick the agreement before submitting.' };

    return {
      rec: {
        name:        name,
        email:       email,
        phone:       phone,
        state:       state,
        city:        city,
        examStatus:  examStatus,
        subjects:    ordered,
        parentName:  pgName,
        parentEmail: hasParentEmail ? pgEmail : '',
        parentPhone: pgPhone || '',
        pledge:      true
      }
    };
  }

  /* ---------- makeApplication ----------
     Stamps a validated rec with an id, status, and timestamp.
     `seq` is the next integer sequence number (server provides it).
  */
  function makeApplication(rec, seq, now) {
    var ts = now == null ? new Date().toISOString() : new Date(now).toISOString();
    return Object.assign({}, rec, {
      id:          'SCH-' + Number(seq),
      status:      'pending',
      submittedAt: ts
    });
  }

  /* ---------- makeWaitlistEntry ---------- */
  function makeWaitlistEntry(data, seq, now) {
    var name  = _sch_str(data && data.name);
    var email = _sch_str(data && data.email).toLowerCase();
    var phone = _sch_str(data && data.phone);
    if (name.length < 2)    return { error: 'Enter your name.' };
    if (!_sch_email(email)) return { error: 'Enter a valid email address.' };
    var ts = now == null ? new Date().toISOString() : new Date(now).toISOString();
    return {
      entry: {
        id:          'WL-' + Number(seq),
        name:        name,
        email:       email,
        phone:       phone,
        status:      'waiting',
        submittedAt: ts
      }
    };
  }

  /* ---------- scholarshipStatus ----------
     Returns a summary object suitable for the public-facing status endpoint.
     Does NOT include application data.
  */
  function scholarshipStatus(settings, applications) {
    var list = Array.isArray(applications) ? applications : [];
    var approvedCount = list.filter(function (a) {
      return a.status === 'accepted' || a.status === 'approved';
    }).length;
    var mode = scholarshipOpen(settings, approvedCount);
    return {
      mode:   mode,          /* 'open' | 'waitlist' | 'closed' */
      places: SCHOLARSHIP_PLACES
    };
  }

  /* ---------- publicApplication ----------
     Strip fields that must not leave the server (pledge raw bool stays internal). */
  function publicApplication(a) {
    if (!a) return null;
    return {
      id:          a.id,
      status:      a.status,
      name:        a.name,
      email:       a.email,
      phone:       a.phone,
      state:       a.state,
      city:        a.city,
      examStatus:  a.examStatus,
      subjects:    a.subjects,
      parentName:  a.parentName,
      parentEmail: a.parentEmail,
      parentPhone: a.parentPhone,
      submittedAt: a.submittedAt,
      decidedAt:   a.decidedAt   || null,
      decidedBy:   a.decidedBy   || null,
      decisionMsg: a.decisionMsg || null,
      approvedAt:  a.approvedAt  || null,
      approvedBy:  a.approvedBy  || null
    };
  }

  /* ---------- scholarshipCsv ----------
     Produces a CSV string of all applications for export.
     Cells are formula-safe (no leading =, +, -, @). */
  function scholarshipCsv(applications) {
    function safe(v) {
      var s = String(v == null ? '' : v).replace(/"/g, '""');
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s + '"';
    }
    var header = ['ID','Status','Name','Email','Phone','State','City',
                  'Exam status','Subjects','Parent name','Parent email',
                  'Parent phone','Submitted','Decided at','Decision message',
                  'Approved at'];
    var rows = (Array.isArray(applications) ? applications : []).map(function (a) {
      return [
        a.id, a.status, a.name, a.email, a.phone, a.state, a.city,
        a.examStatus, (a.subjects || []).join('; '),
        a.parentName, a.parentEmail, a.parentPhone,
        a.submittedAt, a.decidedAt || '', a.decisionMsg || '', a.approvedAt || ''
      ].map(safe).join(',');
    });
    return [header.map(safe).join(',')].concat(rows).join('\r\n');
  }

  /* ---------------------------------------------------- assignments (Phase A, slice 1 — pure rules)
     Owner decisions (17 Oct 2026):
       • Assignment questions go live at once; they carry section tag 'assignment' and are kept
         entirely out of the exam/practice draw (eligible() already ignores unknown sections).
       • File uploads: up to 3 attachments, each ≤ 5 MB, images or PDF.
       • XP = round(30 × final%) — recalculated whenever the assignment is re-marked.
       • Deadline is in Africa/Lagos time.  A submission up to 3 days after the deadline is
         accepted but loses 20 % flat.  Beyond 3 days it is rejected outright.
       • Leaderboard: top-10 plus the student's own rank; ties broken by earlier submission.
       • Record weight: 30 (same argument slot as theory/jamb).
       • A tutor may only set an assignment for their own subject(s). */

  var ASSIGNMENT_SECTION        = 'assignment';
  var ASSIGNMENT_XP_WEIGHT      = 30;          /* record weight                   */
  var ASSIGNMENT_LATE_WINDOW    = 3;           /* days: accepted with penalty      */
  var ASSIGNMENT_LATE_DEDUCT    = 0.20;        /* 20 % flat penalty                */
  var ASSIGNMENT_LEADERBOARD_N  = 10;
  var ASSIGNMENT_FILE_LIMIT     = 3;
  var ASSIGNMENT_FILE_MAX_BYTES = 5 * 1024 * 1024;   /* 5 MB                     */
  var ASSIGNMENT_ALLOWED_MIME   = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

  /* ---- deadline helpers ---- */

  /* Parse an ISO date string (YYYY-MM-DD) as end-of-day in Lagos time, returning
     a UTC millisecond timestamp.  The Lagos offset is UTC+1, so end-of-day Lagos
     = 23:00 UTC on that date. */
  function assignmentDeadlineMs(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    /* 23:00 UTC = end of day in UTC+1 */
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 0, 0, 0);
  }

  /* How many full calendar days past the deadline is `nowMs`?
     Returns 0 when on time (or early), positive integer when late. */
  function assignmentDaysLate(deadlineMs, nowMs) {
    var dl = Number(deadlineMs), now = nowMs == null ? Date.now() : Number(nowMs);
    if (!isFinite(dl) || !isFinite(now) || now <= dl) return 0;
    return Math.ceil((now - dl) / 86400000);
  }

  /* ---- validate a new or edited assignment (tutor / console creates) ---- */

  /* `d` is the raw object from the form/API; `now` is optional (ms, defaults to Date.now()).
     Returns { rec } on success or { error } on the first problem found.

     Required fields:
       subject  — one of ALL_SUBJECTS
       title    — non-empty string, ≤ 200 chars
       deadline — YYYY-MM-DD (Lagos calendar)
       tutorId  — the author; not validated here (server owns ID existence)

     Optional:
       description — string, ≤ 1000 chars
       questions   — array of question IDs (may be empty; the server validates existence)
  */
  function validateAssignment(d, now) {
    var r = d || {};
    var nowMs = now == null ? Date.now() : Number(now);
    var subject = String(r.subject || '').trim();
    var title   = String(r.title   || '').trim();
    var dlStr   = String(r.deadline || '').trim();
    var desc    = String(r.description || '').trim();

    if (ALL_SUBJECTS.indexOf(subject) === -1)
      return { error: 'Choose a valid subject for this assignment.' };
    if (!title)
      return { error: 'Give the assignment a title.' };
    if (title.length > 200)
      return { error: 'Keep the title under 200 characters.' };
    var dlMs = assignmentDeadlineMs(dlStr);
    if (dlMs === null)
      return { error: 'Set a deadline date (YYYY-MM-DD).' };
    if (dlMs <= nowMs)
      return { error: 'The deadline must be in the future.' };
    if (desc.length > 1000)
      return { error: 'Keep the description under 1,000 characters.' };

    return {
      rec: {
        subject:     subject,
        title:       title,
        deadline:    dlStr,
        description: desc,
        questions:   Array.isArray(r.questions) ? r.questions.map(Number).filter(Boolean) : [],
        tutorId:     String(r.tutorId || '').trim() || null
      }
    };
  }

  /* ---- can a student submit? ---- */

  /* Returns { allowed: true } or { allowed: false, reason, message }.
       assignment — the stored assignment record (needs .deadline, .status)
       nowMs      — optional current timestamp
  */
  function assignmentCanSubmit(assignment, nowMs) {
    var a = assignment || {};
    var now = nowMs == null ? Date.now() : Number(nowMs);
    if (a.status === 'closed')
      return { allowed: false, reason: 'closed',
               message: 'This assignment is closed and no longer accepting submissions.' };
    var dlMs = assignmentDeadlineMs(a.deadline);
    if (dlMs === null)
      return { allowed: false, reason: 'no_deadline', message: 'This assignment has no deadline set.' };
    var daysLate = assignmentDaysLate(dlMs, now);
    if (daysLate > ASSIGNMENT_LATE_WINDOW)
      return { allowed: false, reason: 'overdue',
               message: 'The late-submission window has passed. This assignment is no longer accepting work.' };
    return { allowed: true, daysLate: daysLate };
  }

  /* ---- scoring ---- */

  /* Apply the late deduction to a raw percentage.
     daysLate 0 → no penalty; 1-3 → −20 %; >3 should never reach here (canSubmit guards it). */
  function assignmentApplyLate(rawPercent, daysLate) {
    var p = Math.max(0, Math.min(100, Number(rawPercent) || 0));
    var d = Math.max(0, Math.round(Number(daysLate) || 0));
    if (d === 0) return p;
    return Math.max(0, Math.round(p * (1 - ASSIGNMENT_LATE_DEDUCT)));
  }

  /* XP earned from a final (post-deduction) percentage. */
  function assignmentXp(finalPercent) {
    return Math.round(ASSIGNMENT_XP_WEIGHT * Math.max(0, Math.min(100, Number(finalPercent) || 0)) / 100);
  }

  /* Total marks earned from a set of marked answers.
     answers: [{ mark, maxMark }]   — bank questions auto-marked; theory questions marked by tutor. */
  function assignmentScore(answers) {
    if (!Array.isArray(answers) || !answers.length) return { earned: 0, total: 0, percent: 0 };
    var earned = 0, total = 0;
    for (var i = 0; i < answers.length; i++) {
      var ans = answers[i] || {};
      var mk  = Math.max(0, Number(ans.mark)    || 0);
      var mm  = Math.max(0, Number(ans.maxMark) || 0);
      earned += mk;
      total  += mm;
    }
    var pct = total > 0 ? Math.round(earned / total * 100) : 0;
    return { earned: Math.round(earned), total: Math.round(total), percent: pct };
  }

  /* ---- leaderboard ---- */

  /* Build the leaderboard for one assignment.
     submissions: [{ studentId, finalPercent, submittedAt, status }]
       — only 'marked' submissions appear; ties go to the earlier submitter.
     selfId: the calling student's ID (may be absent/null).
     Returns { top: [...], self: { rank, entry } | null }. */
  function assignmentLeaderboard(submissions, selfId) {
    var marked = (submissions || []).filter(function (s) {
      return s && s.status === 'marked';
    });
    marked.sort(function (a, b) {
      var dp = Number(b.finalPercent || 0) - Number(a.finalPercent || 0);
      if (dp !== 0) return dp;
      return Number(a.submittedAt || 0) - Number(b.submittedAt || 0);
    });
    var top = marked.slice(0, ASSIGNMENT_LEADERBOARD_N).map(function (s, i) {
      return { rank: i + 1, studentId: s.studentId, finalPercent: Number(s.finalPercent || 0) };
    });
    var self = null;
    if (selfId != null) {
      for (var i = 0; i < marked.length; i++) {
        if (marked[i].studentId === selfId) {
          self = { rank: i + 1, entry: top[i] || { rank: i + 1, studentId: selfId, finalPercent: Number(marked[i].finalPercent || 0) } };
          break;
        }
      }
    }
    return { top: top, self: self };
  }

  /* ---- file upload guard ---- */

  /* Check a single attachment before it is stored.
     f: { size, type } (same shape as validateImageUpload).
     Returns { ok: true } or { error }. */
  function validateAssignmentFile(f) {
    var file = f || {};
    var size = Number(file.size) || 0;
    var mime = String(file.type || '').trim().toLowerCase();
    if (size === 0)   return { error: 'The file appears to be empty.' };
    if (size > ASSIGNMENT_FILE_MAX_BYTES)
      return { error: 'Each file must be 5 MB or smaller.' };
    if (ASSIGNMENT_ALLOWED_MIME.indexOf(mime) === -1)
      return { error: 'Only images (JPEG, PNG, GIF, WebP) and PDFs are accepted.' };
    return { ok: true };
  }

  /* Check the full set of attachments submitted with a submission.
     files: array of { size, type }.
     Returns { ok: true } or { error }. */
  function validateAssignmentFiles(files) {
    var arr = Array.isArray(files) ? files : [];
    if (arr.length > ASSIGNMENT_FILE_LIMIT)
      return { error: 'You can attach up to ' + ASSIGNMENT_FILE_LIMIT + ' files per submission.' };
    for (var i = 0; i < arr.length; i++) {
      var r = validateAssignmentFile(arr[i]);
      if (r.error) return r;
    }
    return { ok: true };
  }

  /* ---- reuse-warning ---- */

  /* True when a question (by ID) is already used in another assignment for the
     same subject — tutors should know so they can vary their question sets.
     assignments: existing stored assignments; newQuestionIds: the draft's IDs. */
  function assignmentReuseWarnings(newQuestionIds, assignments, subject) {
    var ids = Array.isArray(newQuestionIds) ? newQuestionIds : [];
    var existing = Array.isArray(assignments) ? assignments : [];
    var reused = [];
    for (var i = 0; i < ids.length; i++) {
      for (var j = 0; j < existing.length; j++) {
        var a = existing[j] || {};
        if (a.subject !== subject) continue;
        var qs = Array.isArray(a.questions) ? a.questions : [];
        if (qs.indexOf(ids[i]) !== -1 && reused.indexOf(ids[i]) === -1) {
          reused.push(ids[i]);
        }
      }
    }
    return reused;   /* array of question IDs that appear in previous assignments */
  }

  /* What the Managers panel may be shown or sent: never a hash, a password or a passcode. */
  function publicManager(m) {
    var x = m || {};
    var role = adminRoleKey(x.role || x.title);
    return {
      id: x.id || '', name: x.name || '', role: role, title: adminRoleTitle(role),
      active: x.active !== false, mustChangePassword: !!x.mustChangePassword
    };
  }

  return {
    ENGLISH: ENGLISH,
    SCIENCES: SCIENCES.slice(),
    ALL_SUBJECTS: ALL_SUBJECTS.slice(),
    EXAM: EXAM,
    PERIODS: PERIODS.slice(),
    PERIOD: PERIOD,
    PERIOD_LABEL: PERIOD_LABEL,
    LEGACY_PERIODS: LEGACY_PERIODS.slice(),
    normalizePeriod: normalizePeriod,
    periodLabel: periodLabel,
    hoursLabel: hoursLabel,
    hmsClock: hmsClock,
    stepObjectiveMinutes: stepObjectiveMinutes,
    SECTIONS: SECTIONS.slice(),
    NO_THEORY: NO_THEORY.slice(),
    THEORY_SUBJECTS: THEORY_SUBJECTS.slice(),
    theoryAllowed: theoryAllowed,
    theorySubjects: theorySubjects,
    noTheoryMessage: noTheoryMessage,
    SIGNUP_LIMIT_DEFAULTS: SIGNUP_LIMIT_DEFAULTS,
    SIGNUP_LIMIT_MAX: SIGNUP_LIMIT_MAX,
    SIGNUP_DAY_MS: SIGNUP_DAY_MS,
    signupLimits: signupLimits,
    validateSignupLimits: validateSignupLimits,
    signupWait: signupWait,
    signupLimitMessage: signupLimitMessage,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
    SESSION_DEFAULT: SESSION_DEFAULT,
    WARN_DEFAULT: WARN_DEFAULT,
    SESSION_BOUNDS: { min: SESSION_MIN, max: SESSION_MAX },
    WARN_BOUNDS: { min: WARN_MIN, max: WARN_MAX },
    clampSessionMinutes: clampSessionMinutes,
    clampWarnMinutes: clampWarnMinutes,
    fmtCountdown: fmtCountdown,
    seedQuestions: function () { return JSON.parse(JSON.stringify(QUESTIONS)); },
    seedNotes: function () { return JSON.parse(JSON.stringify(NOTES)); },
    validateSubjects: validateSubjects,
    validateExam: validateExam,
    requireExam: requireExam,
    validateQuestion: validateQuestion,
    validateNote: validateNote,
    validatePassage: validatePassage,
    cleanPassageId: cleanPassageId,
    cleanImageId: cleanImageId,
    cleanImageAlt: cleanImageAlt,
    validateImageUpload: validateImageUpload,
    IMAGE_MAX_BYTES: IMAGE_MAX_BYTES,
    IMAGE_TYPES: JSON.parse(JSON.stringify(IMAGE_TYPES)),
    passageServable: passageServable,
    passageLinkError: passageLinkError,
    groupByPassage: groupByPassage,
    servablePool: servablePool,
    pickWithPassages: pickWithPassages,
    attachPassages: attachPassages,
    attachPassagesToMistakes: attachPassagesToMistakes,
    attachImagesToMistakes: attachImagesToMistakes,
    passageUsage: passageUsage,
    CSV_MAX_ROWS: CSV_MAX_ROWS,
    CSV_QUESTION_HEADER: CSV_QUESTION_HEADER,
    CSV_NOTE_HEADER: CSV_NOTE_HEADER,
    QUESTION_DIFFICULTIES: QUESTION_DIFFICULTIES.slice(),
    tutorKitColumns: tutorKitColumns,
    tutorKitInstructions: tutorKitInstructions,
    tutorKitTemplate: tutorKitTemplate,
    parseCSV: parseCSV,
    csvRows: csvRows,
    csvSection: csvSection,
    importCSV: importCSV,
    answerCheckList: answerCheckList,
    answerCheckFlags: answerCheckFlags,
    csvFingerprint: csvFingerprint,
    csvTemplate: csvTemplate,
    STUDY_PING_INTERVAL_SEC: STUDY_PING_INTERVAL_SEC,
    STUDY_PING_MAX_SEC: STUDY_PING_MAX_SEC,
    clampStudyPingSeconds: clampStudyPingSeconds,
    studyWindowStatus: studyWindowStatus,
    EXTRA_TIME_GRANT_MIN: EXTRA_TIME_GRANT_MIN,
    EXTRA_TIME_MAX_GRANTS_PER_DAY: EXTRA_TIME_MAX_GRANTS_PER_DAY,
    normalizeGuardianPin: normalizeGuardianPin,
    guardianPinMatches: guardianPinMatches,
    STUDY_MODES: STUDY_MODES.slice(),
    STUDY_MAX: STUDY_MAX,
    dailyLimitMessage: dailyLimitMessage,
    bookmarkLimitMessage: bookmarkLimitMessage,
    reviewLimitMessage: reviewLimitMessage,
    clampStudyCount: clampStudyCount,
    clampStudyMinutes: clampStudyMinutes,
    studyPool: studyPool,
    pickPractice: pickPractice,
    PRACTICE_ALL_SUBJECTS: PRACTICE_ALL_SUBJECTS,
    studyTopics: studyTopics,
    pickStudy: pickStudy,
    forPractice: forPractice,
    BOOKMARK_CAP: BOOKMARK_CAP,
    TIERS: TIERS.slice(),
    DEFAULT_TIER: DEFAULT_TIER,
    cleanTier: cleanTier,
    newStudentTier: newStudentTier,
    parseTierChange: parseTierChange,
    restrictWarning: restrictWarning,
    tierChangeNote: tierChangeNote,
    cohortTierMessage: cohortTierMessage,
    PRACTICE_MAX_AGE_DAYS: PRACTICE_MAX_AGE_DAYS,
    dropOldRuns: dropOldRuns,
    capList: capList,
    tierLimits: tierLimits,
    TUTOR_PASSWORD_MIN: TUTOR_PASSWORD_MIN,
    cleanTutorId: cleanTutorId,
    validTutorId: validTutorId,
    nextTutorId: nextTutorId,
    validateTutor: validateTutor,
    tutorCan: tutorCan,
    scopeToSubjects: scopeToSubjects,
    tutorSubjectFor: tutorSubjectFor,
    tutorPublic: tutorPublic,
    QUESTION_STATUSES: QUESTION_STATUSES,
    RETURN_REASON_MIN: RETURN_REASON_MIN,
    RETURN_REASON_MAX: RETURN_REASON_MAX,
    questionStatus: questionStatus,
    questionIsLive: questionIsLive,
    liveQuestions: liveQuestions,
    stampTutorQuestion: stampTutorQuestion,
    tutorOwnsQuestion: tutorOwnsQuestion,
    tutorEditQuestion: tutorEditQuestion,
    reviewQuestion: reviewQuestion,
    approveBatch: approveBatch,
    tutorQuestions: tutorQuestions,
    approvalQueue: approvalQueue,
    pendingCount: pendingCount,
    lastTutorUpload: lastTutorUpload,
    tutorOwnsNote: tutorOwnsNote,
    stampTutorNote: stampTutorNote,
    tutorEditNote: tutorEditNote,
    tutorNotes: tutorNotes,
    validateNotice: validateNotice,
    tutorOwnsNotice: tutorOwnsNotice,
    stampTutorNotice: stampTutorNotice,
    tutorEditNotice: tutorEditNotice,
    tutorNotices: tutorNotices,
    publicNotice: publicNotice,
    noticesForStudent: noticesForStudent,
    makeNoticeAlert: makeNoticeAlert,
    flagNoticeGone: flagNoticeGone,
    FLAG_REASONS: FLAG_REASONS.map(function (r) { return { id: r.id, label: r.label }; }),
    FLAG_STATUSES: FLAG_STATUSES.slice(),
    FLAG_NOTE_MAX: FLAG_NOTE_MAX,
    FLAG_REPLY_MAX: FLAG_REPLY_MAX,
    FLAG_DAILY_CAP: FLAG_DAILY_CAP,
    flagReasonLabel: flagReasonLabel,
    validateFlag: validateFlag,
    canFlag: canFlag,
    stampFlag: stampFlag,
    flagRecipients: flagRecipients,
    answerFlag: answerFlag,
    closeFlag: closeFlag,
    publicFlag: publicFlag,
    flagsForStudent: flagsForStudent,
    flagsForTutor: flagsForTutor,
    flagsForConsole: flagsForConsole,
    staffFlag: staffFlag,
    flagCounts: flagCounts,
    makeFlagAlert: makeFlagAlert,
    cleanAudience: cleanAudience,
    audienceLabel: audienceLabel,
    audienceHas: audienceHas,
    validateBroadcast: validateBroadcast,
    stampBroadcast: stampBroadcast,
    publicBroadcast: publicBroadcast,
    broadcastsForStudent: broadcastsForStudent,
    broadcastRecipients: broadcastRecipients,
    broadcastMailPlan: broadcastMailPlan,
    BROADCAST_MAIL_DAYS: BROADCAST_MAIL_DAYS,
    BROADCAST_MAIL_MAX_FAILS: BROADCAST_MAIL_MAX_FAILS,
    keepNoteStamp: keepNoteStamp,
    tutorMayMarkScript: tutorMayMarkScript,
    tutorScriptSummary: tutorScriptSummary,
    makeMarkAlert: makeMarkAlert,
    addAlert: addAlert,
    unseenAlerts: unseenAlerts,
    markAlertSeen: markAlertSeen,
    publicNote: publicNote,
    ANALYTICS_ACTIVE_DAYS: ANALYTICS_ACTIVE_DAYS,
    ANALYTICS_MIN_ANSWERS: ANALYTICS_MIN_ANSWERS,
    ANALYTICS_MIN_PAPERS: ANALYTICS_MIN_PAPERS,
    tutorSnapshot: tutorSnapshot,
    tutorActivity: tutorActivity,
    tutorAtRisk: tutorAtRisk,
    sortAtRisk: sortAtRisk,
    tutorTopPerformers: tutorTopPerformers,
    tutorMayOpenStudent: tutorMayOpenStudent,
    tutorStudentDetail: tutorStudentDetail,
    tutorStudentContact: tutorStudentContact,
    makeTutorViewEntry: makeTutorViewEntry,
    addTutorView: addTutorView,
    tutorOwnViews: tutorOwnViews,
    auditViews: auditViews,
    auditKindLabel: auditKindLabel,
    auditCsv: auditCsv,
    csvCell: csvCell,
    schoolYearStart: schoolYearStart,
    defaultTerms: defaultTerms,
    termRange: termRange,
    resultsExportRows: resultsExportRows,
    resultsCsv: resultsCsv,
    resultsPdfModel: resultsPdfModel,
    pdfTextWidth: pdfTextWidth,
    pdfFit: pdfFit,
    EXPORT_SECTIONS: EXPORT_SECTIONS,
    validDayStr: validDayStr,
    STUDENT_RECENT: STUDENT_RECENT,
    STUDENT_TOPIC_MIN: STUDENT_TOPIC_MIN,
    AUDIT_KEEP_DAYS: AUDIT_KEEP_DAYS,
    TOP_MIN_PAPERS: TOP_MIN_PAPERS,
    TOP_MIN_ANSWERS: TOP_MIN_ANSWERS,
    ATRISK_INACTIVE_DAYS: ATRISK_INACTIVE_DAYS,
    ATRISK_LOW_AVERAGE: ATRISK_LOW_AVERAGE,
    recordAnswerStats: recordAnswerStats,
    rankWeakTopics: rankWeakTopics,
    rankHardestQuestions: rankHardestQuestions,
    ANALYTICS_WEAK_TOPICS: ANALYTICS_WEAK_TOPICS,
    ANALYTICS_HARDEST_QUESTIONS: ANALYTICS_HARDEST_QUESTIONS,
    SUBJECT_DEPTH_MIN: SUBJECT_DEPTH_MIN,
    subjectDepth: subjectDepth,
    tierFeatures: tierFeatures,
    canUse: canUse,
    dailyAllowance: dailyAllowance,
    reviewAllowance: reviewAllowance,
    capPracticeRun: capPracticeRun,
    noteVisible: noteVisible,
    tierStudyYears: tierStudyYears,
    lockedPastYears: lockedPastYears,
    pastYearLockMessage: pastYearLockMessage,
    lockedNote: lockedNote,
    NOTE_LOCK_MESSAGE: NOTE_LOCK_MESSAGE,
    LIVE_JOIN_LOCK_MESSAGE: LIVE_JOIN_LOCK_MESSAGE,
    videoAllowed: videoAllowed,
    videoLockMessage: videoLockMessage,
    RESOURCE_VIEW_LOCK_MESSAGE: RESOURCE_VIEW_LOCK_MESSAGE,
    webTestAllowed: webTestAllowed,
    webTestLockMessage: webTestLockMessage,
    lagosDay: lagosDay,
    bookmarkKey: bookmarkKey,
    sanitizeBookmark: sanitizeBookmark,
    mistakesFromRuns: mistakesFromRuns,
    mistakesFromAttempts: mistakesFromAttempts,
    mergeMistakes: mergeMistakes,
    SR_INTERVALS_DAYS: SR_INTERVALS_DAYS,
    SR_SESSION_CAP: SR_SESSION_CAP,
    SR_STATE_CAP: SR_STATE_CAP,
    srEntryFor: srEntryFor,
    srDueAt: srDueAt,
    srAfterAnswer: srAfterAnswer,
    srQueue: srQueue,
    srStore: srStore,
    levelFor: levelFor,
    xpIntoLevel: xpIntoLevel,
    xpPerLevel: xpPerLevel,
    eligible: eligible,
    forStudent: forStudent,
    durationFor: durationFor,
    OBJECTIVE_CEILING: { english: OBJECTIVE_CEILING.english, science: OBJECTIVE_CEILING.science },
    OBJECTIVE_SUBJECT: OBJECTIVE_SUBJECT,
    OBJ_MIN_DEFAULT: OBJ_MIN_DEFAULT,
    OBJ_MIN_FLOOR: OBJ_MIN_FLOOR,
    OBJ_MIN_CEIL: OBJ_MIN_CEIL,
    objectiveCeiling: objectiveCeiling,
    objectiveCount: objectiveCount,
    clampObjectiveMinutes: clampObjectiveMinutes,
    orderedCombination: orderedCombination,
    objectiveBlueprint: objectiveBlueprint,
    objectiveTotal: objectiveTotal,
    objectivePaper: objectivePaper,
    JAMB_MIN_DEFAULT: JAMB_MIN_DEFAULT,
    JAMB_MIN_FLOOR: JAMB_MIN_FLOOR,
    JAMB_MIN_CEIL: JAMB_MIN_CEIL,
    jambCeiling: jambCeiling,
    jambCount: jambCount,
    clampJambMinutes: clampJambMinutes,
    JAMB_READY_DEFAULT: JAMB_READY_DEFAULT,
    clampJambReadyMin: clampJambReadyMin,
    jambReadiness: jambReadiness,
    jambOffered: jambOffered,
    WEB_TEST_SECTIONS: WEB_TEST_SECTIONS.slice(),
    REPEATABLE_SECTIONS: REPEATABLE_SECTIONS.slice(),
    canSit: canSit,
    attemptRound: attemptRound,
    stepJambMinutes: stepJambMinutes,
    jambBlueprint: jambBlueprint,
    jambPaper: jambPaper,
    jambSeenCounts: jambSeenCounts,
    jambScore: jambScore,
    cleanQuestionYear: cleanQuestionYear,
    cleanYearList: cleanYearList,
    isPastQuestion: isPastQuestion,
    pastYears: pastYears,
    studyYears: studyYears,
    pastQuestions: pastQuestions,
    JAMB_TOTAL_MAX: JAMB_TOTAL_MAX,
    markAttempt: markAttempt,
    applyTheoryMarks: applyTheoryMarks,
    xpForAttempt: xpForAttempt,
    xpForPractice: xpForPractice,
    practiceXpRemaining: practiceXpRemaining,
    dayStamp: dayStamp,
    dayBefore: dayBefore,
    streakAfterActivity: streakAfterActivity,
    buyStreakFreeze: buyStreakFreeze,
    DAILY_QUEST_TARGET: DAILY_QUEST_TARGET,
    DAILY_QUEST_MIN_ANSWERED: DAILY_QUEST_MIN_ANSWERED,
    weakestTopicFromRuns: weakestTopicFromRuns,
    dailyQuest: dailyQuest,
    questReward: questReward,
    WEEKLY_QUEST_DAYS: WEEKLY_QUEST_DAYS,
    WEEKLY_QUEST_QUESTIONS: WEEKLY_QUEST_QUESTIONS,
    WEEKLY_QUEST_FREEZES: WEEKLY_QUEST_FREEZES,
    weekStart: weekStart,
    weekEnd: weekEnd,
    cleanWeekQuest: cleanWeekQuest,
    weeklyQuest: weeklyQuest,
    weeklyQuestAfterRun: weeklyQuestAfterRun,
    REMINDER_KINDS: REMINDER_KINDS.slice(),
    REMINDER_START_HOUR: REMINDER_START_HOUR,
    REMINDER_END_HOUR: REMINDER_END_HOUR,
    REMINDER_REVIEW_GAP_DAYS: REMINDER_REVIEW_GAP_DAYS,
    REMINDER_DORMANT_DAYS: REMINDER_DORMANT_DAYS,
    cleanReminderPrefs: cleanReminderPrefs,
    reminderEmailOk: reminderEmailOk,
    reminderPhoneOk: reminderPhoneOk,
    reminderChannels: reminderChannels,
    reminderPlan: reminderPlan,
    weeklyQuestClaimed: weeklyQuestClaimed,
    weeklyReward: weeklyReward,
    validateChallenge: validateChallenge,
    cleanChallengeState: cleanChallengeState,
    challengeAfterRun: challengeAfterRun,
    challengeTeamTotal: challengeTeamTotal,
    challengeDone: challengeDone,
    challengeReward: challengeReward,
    challengeClaimed: challengeClaimed,
    challengeForStudent: challengeForStudent,
    CHALLENGE_PER_STUDENT_CAP: CHALLENGE_PER_STUDENT_CAP,
    CHALLENGE_FREEZE_REWARD: CHALLENGE_FREEZE_REWARD,
    CHALLENGE_GOAL_MIN: CHALLENGE_GOAL_MIN,
    CHALLENGE_GOAL_MAX: CHALLENGE_GOAL_MAX,
    QUEST_XP_REWARD: QUEST_XP_REWARD,
    STREAK_FREEZE_COST_XP: STREAK_FREEZE_COST_XP,
    STREAK_FREEZE_MAX: STREAK_FREEZE_MAX,
    PRACTICE_XP_PER_ANSWER: PRACTICE_XP_PER_ANSWER,
    PRACTICE_XP_PER_CORRECT: PRACTICE_XP_PER_CORRECT,
    PRACTICE_XP_DAILY_CAP: PRACTICE_XP_DAILY_CAP,
    topicBreakdown: topicBreakdown,
    topicName: topicName,
    validateTopic: validateTopic,
    topicInventory: topicInventory,
    addTopicTo: addTopicTo,
    renameTopicIn: renameTopicIn,
    computePerformance: computePerformance,
    rankLeague: rankLeague,
    leagueName: leagueName,
    round1: round1,
    mathEscape: mathEscape,
    renderMath: renderMath,
    autoFormatBareLatex: autoFormatBareLatex,
    renderTex: renderTex,
    mathSpans: mathSpans,
    hasMath: hasMath,
    mathPlain: mathPlain,
    texPlain: texPlain,
    mathIssues: mathIssues,
    texKnows: texKnows,
    MATH_HELP: MATH_HELP.slice(),
    ADMIN_ROLES: ADMIN_ROLES.map(function (r) { return { key: r.key, title: r.title }; }),
    adminRoleKey: adminRoleKey,
    adminRoleTitle: adminRoleTitle,
    allCapabilities: allCapabilities,
    adminMayUse: adminMayUse,
    alertCapability: alertCapability,
    alertVisibleTo: alertVisibleTo,
    alertsFor: alertsFor,
    OVERVIEW_FIGURE_CAPS: OVERVIEW_FIGURE_CAPS,
    overviewFiguresAllowed: overviewFiguresAllowed,
    overviewFor: overviewFor,
    MANAGER_LOG_KEEP: MANAGER_LOG_KEEP,
    auditActionFor: auditActionFor,
    stampManagerAction: stampManagerAction,
    addManagerAction: addManagerAction,
    managerLogFor: managerLogFor,
    roleCan: roleCan,
    roleCanAny: roleCanAny,
    consoleSectionAllowed: consoleSectionAllowed,
    consoleSectionsFor: consoleSectionsFor,
    allConsoleSections: allConsoleSections,
    capabilitiesOf: capabilitiesOf,
    rolesWithCapability: rolesWithCapability,
    managerRoles: managerRoles,
    nextAdminId: nextAdminId,
    nextManagerId: nextManagerId,
    validateManager: validateManager,
    publicManager: publicManager,
    managerPasswordChangeError: managerPasswordChangeError,
    MANAGER_PASSWORD_MIN: MANAGER_PASSWORD_MIN,
    SCHOLARSHIP_PLACES: SCHOLARSHIP_PLACES,
    SCHOLARSHIP_STATUSES: SCHOLARSHIP_STATUSES.slice(),
    SCHOLARSHIP_INACTIVITY_DAYS: SCHOLARSHIP_INACTIVITY_DAYS,
    SCHOLARSHIP_EXAM_STATUSES: SCHOLARSHIP_EXAM_STATUSES.slice(),
    NIGERIA_STATES: NIGERIA_STATES.slice(),
    scholarshipOpen: scholarshipOpen,
    waitlistOpen: waitlistOpen,
    canApply: canApply,
    validateScholarApplication: validateScholarApplication,
    makeApplication: makeApplication,
    makeWaitlistEntry: makeWaitlistEntry,
    scholarshipStatus: scholarshipStatus,
    publicApplication: publicApplication,
    scholarshipCsv: scholarshipCsv,
    ASSIGNMENT_SECTION: ASSIGNMENT_SECTION,
    ASSIGNMENT_XP_WEIGHT: ASSIGNMENT_XP_WEIGHT,
    ASSIGNMENT_LATE_WINDOW: ASSIGNMENT_LATE_WINDOW,
    ASSIGNMENT_LATE_DEDUCT: ASSIGNMENT_LATE_DEDUCT,
    ASSIGNMENT_LEADERBOARD_N: ASSIGNMENT_LEADERBOARD_N,
    ASSIGNMENT_FILE_LIMIT: ASSIGNMENT_FILE_LIMIT,
    ASSIGNMENT_FILE_MAX_BYTES: ASSIGNMENT_FILE_MAX_BYTES,
    ASSIGNMENT_ALLOWED_MIME: ASSIGNMENT_ALLOWED_MIME.slice(),
    assignmentDeadlineMs: assignmentDeadlineMs,
    assignmentDaysLate: assignmentDaysLate,
    validateAssignment: validateAssignment,
    assignmentCanSubmit: assignmentCanSubmit,
    assignmentApplyLate: assignmentApplyLate,
    assignmentXp: assignmentXp,
    assignmentScore: assignmentScore,
    assignmentLeaderboard: assignmentLeaderboard,
    validateAssignmentFile: validateAssignmentFile,
    validateAssignmentFiles: validateAssignmentFiles,
    assignmentReuseWarnings: assignmentReuseWarnings
  };
}));
