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

  /* -------------------------------------------- the create-account firewall
     G.O.C Academy Hub is not a public sign-up: an account belongs to a scholar the
     academy has admitted. So the sign-up form asks for an access code the academy
     hands out, and the data layer refuses the account without it. The code is
     stored hashed like a password, is never sent back to any client, and is
     compared server-side — hiding the form would not be the control.

     Case, spacing and the separators are forgiven, because the code is copied off
     a printed slip or a WhatsApp message: "goc 2027", "GOC-2027", "goc_2027" and
     "goc.2027" are all the one code. A space, a dash, a dot and an underscore are
     ways of breaking a code up for the eye, so they are taken out before it is
     compared; the sign-up screen promises exactly that, and this rule has to keep
     the promise. Everything else a scholar might type is left in and refused,
     rather than quietly rewritten into some other code. */
  var SIGNUP_CODE_DEFAULT = 'GOC-2027';
  var SIGNUP_CODE_MIN = 4, SIGNUP_CODE_MAX = 24;
  var SIGNUP_CODE_REFUSED =
    'That academy access code is not correct. Ask G.O.C Academy for the current code.';
  /* Whitespace, dot, underscore, and every dash a phone keyboard or Word turns a
     typed hyphen into: ASCII hyphen, U+2010 to U+2015 (hyphen, non-breaking
     hyphen, figure dash, en dash, em dash, horizontal bar) and the minus sign. */
  var SIGNUP_CODE_SEPARATORS = /[\s\._\-‐-―−]+/g;
  function normalizeSignupCode(v) {
    return String(v == null ? '' : v).replace(SIGNUP_CODE_SEPARATORS, '').toUpperCase();
  }
  /* How the code was written down before separators were forgiven: spaces out,
     dashes kept. A database seeded then holds the hash of THAT form, so the
     server tries this second when the first does not match. It admits nothing
     new — a code with no dash reads the same either way — it only keeps an
     existing roster working. Nothing but that fallback should call this. */
  function legacySignupCode(v) {
    return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  }
  /* Returns { code } or { error }. Used on the way in from a student and on the
     way in from the console, so one shape is enforced in both directions. */
  function validateSignupCode(v) {
    var c = normalizeSignupCode(v);
    if (!c) return { error: 'Enter the academy access code given to you by G.O.C Academy.' };
    if (c.length < SIGNUP_CODE_MIN) {
      return { error: 'The access code must be at least ' + SIGNUP_CODE_MIN + ' characters.' };
    }
    if (c.length > SIGNUP_CODE_MAX) {
      return { error: 'The access code can be at most ' + SIGNUP_CODE_MAX + ' characters.' };
    }
    /* Dashes, spaces and underscores are already gone by here, so what is left
       has to be letters and digits; anything else was really typed. */
    if (!/^[A-Z0-9]+$/.test(c)) {
      return { error: 'Use letters, numbers and dashes only in the access code.' };
    }
    return { code: c };
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
    var rec = {
      id: r.id, subject: subject, topic: String(r.topic || 'General').trim(),
      kind: kind, section: section, period: PERIOD, text: text,
      difficulty: ['easy', 'medium', 'hard'].indexOf(String(r.difficulty)) === -1 ? 'medium' : String(r.difficulty),
      explanation: String(r.explanation || '').trim(),
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
    'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active';
  var CSV_NOTE_HEADER = 'subject,topic,title,body,minutes,active';

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
  function csvOptions(row) {
    var out = [], letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], i, v;
    for (i = 0; i < letters.length; i++) {
      v = row['option' + letters[i]];
      if (v === undefined) v = row['opt' + letters[i]];
      if (v === undefined) v = row['option' + (i + 1)];
      if (v === undefined) v = row['choice' + letters[i]];
      if (v !== undefined && String(v).trim()) out.push(String(v).trim());
    }
    return out;
  }
  /* The answer may be given as a letter, as a position from 1, or simply as the
     text of the correct option — all three appear in real files. */
  function csvAnswerIndex(v, options) {
    var s = String(v == null ? '' : v).trim();
    var opts = options || [];
    if (!s) return -1;
    var up = s.toUpperCase();
    if (up.length === 1 && up >= 'A' && up <= 'H') return up.charCodeAt(0) - 65;
    var n = Number(s);
    if (!isNaN(n) && n >= 1 && n <= opts.length && String(Math.round(n)) === s) return Math.round(n) - 1;
    var hit = -1;
    opts.forEach(function (o, i) { if (hit < 0 && String(o).trim().toLowerCase() === s.toLowerCase()) hit = i; });
    return hit;
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
    if (String(subject).trim().toLowerCase() === 'physics') {
      text = autoFormatBareLatex(text);
      explanation = autoFormatBareLatex(explanation);
      expected = autoFormatBareLatex(expected);
      opts = opts.map(autoFormatBareLatex);
    }
    return {
      subject: subject, section: csvSection(r.section || r.session),
      topic: r.topic || 'General', text: text, options: opts,
      answer: csvAnswerIndex(r.answer !== undefined ? r.answer : r.correct, opts),
      expected: expected,
      maxMark: r.maxmark !== undefined ? r.maxmark : r.marks,
      difficulty: String(r.difficulty || 'medium').trim().toLowerCase(),
      explanation: explanation,
      active: csvFlag(r.active, true)
    };
  }
  function csvNote(row) {
    var r = row || {};
    var body = r.body !== undefined ? r.body : (r.note !== undefined ? r.note : (r.content || ''));
    return {
      subject: r.subject || '', topic: r.topic || '',
      title: r.title || r.heading || '',
      /* A spreadsheet cell usually carries the paragraph break as the two
         characters \n rather than a real line break. Both are accepted. */
      body: String(body).replace(/\\n/g, '\n'),
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
  function importCSV(kind, text, target, existing) {
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
    var seenExisting = {};
    (existing || []).forEach(function (rec) { seenExisting[dupKey(rec)] = true; });
    var seenInFile = {};
    var records = [], errors = [];
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
      var v = notesFile ? validateNote(draft) : validateQuestion(draft);
      if (v.error) { errors.push({ line: row.line, error: v.error }); return; }
      var key = dupKey(v.rec);
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
    });
    return { records: records, errors: errors, read: parsed.rows.length };
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
      'Physics,practice,Motion,"A car speeds up steadily from 10 m/s to 30 m/s in 4 s. What is its acceleration?","2.5 m/s^2","5 m/s^2","8 m/s^2","40 m/s^2",,B,,,easy,"a = (v-u)/t = (30-10)/4 = 5 m/s^2. This one is filed as practice, so it is never drawn into the Web Test.",yes\n';
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
  function studyPool(bank, subject, topics) {
    var want = (topics || []).map(function (t) { return String(t).trim(); })
                             .filter(function (t) { return t.length > 0; });
    return (bank || []).filter(function (r) {
      if (!r.active || r.kind !== 'objective') return false;
      if (subject && r.subject !== subject) return false;
      if (want.length && want.indexOf(String(r.topic)) === -1) return false;
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
  /* Practice marks each answer the moment it is chosen, so a practice question
     must travel with its answer and explanation. That is a deliberate exception
     and it is why practice is not assessed and earns no score on record: it is
     study material, not an examination. The CBT and Web Test paths keep using
     forStudent(), which strips both. */
  function forPractice(r, index) {
    var out = forStudent(r, index);
    out.answer = r.answer;
    out.explanation = r.explanation || '';
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
      /* A JAMB-oriented paper is an objective paper, so it may draw on the
         general objective pool as well as JAMB-exclusive questions. */
      if (section === 'jamb') return r.section === 'jamb' || r.section === 'objective';
      return r.section === section;
    });
  }

  /* Everything a student is allowed to see. The correct answer, the reference
     answer and the explanation are deliberately absent: a student client never
     receives them, so a student cannot read the answers out of the network
     response or change what they are marked against. */
  function forStudent(r, index) {
    return {
      n: index + 1,
      id: r.id,
      subject: r.subject,
      topic: r.topic,
      kind: r.kind,
      text: r.text,
      options: r.kind === 'objective' ? (r.options || []).slice() : [],
      maxMark: r.kind === 'theory' ? r.maxMark : 1
    };
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
          questionId: r.id, topic: r.topic, kind: 'objective',
          given: (given === undefined || given === '') ? null : Number(given),
          isCorrect: !!isCorrect, markAwarded: isCorrect ? 1 : 0, maxMark: 1
        });
      } else {
        maxScore += Number(r.maxMark) || 0;
        var text = (given === undefined || given === null) ? '' : String(given).trim();
        if (text) answered++;
        rows.push({
          questionId: r.id, topic: r.topic, kind: 'theory',
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
  function streakAfterActivity(prevStreak, prevDay, today) {
    var t = today || dayStamp();
    var streak = Math.max(0, Number(prevStreak) || 0);
    if (prevDay === t) return { streak: Math.max(streak, 1), day: t };
    if (prevDay && prevDay === dayBefore(t)) return { streak: streak + 1, day: t };
    return { streak: 1, day: t };
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
    var o = opts || {}, parts = mathSpans(text), out = '', i, esc;
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
  var LATEX_TERM_SRC = '(?:\\\\[A-Za-z]+(?:\\s*\\{[^{}]*\\})*|\\d+(?:\\.\\d+)?(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)*|[A-Za-z]{1,3}(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)*)';
  var LATEX_TRIGGER_SRC = '(?:\\\\[A-Za-z]+(?:\\s*\\{[^{}]*\\})*|\\b[A-Za-z0-9]{1,4}(?:\\s*[\\^_]\\s*\\{?[A-Za-z0-9+\\-]{1,6}\\}?)+)';
  var LATEX_CLUSTER = new RegExp(LATEX_TRIGGER_SRC +
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
        return (/\\[A-Za-z]|[A-Za-z0-9][\^_]/.test(m)) ? '$' + m + '$' : m;
      });
    }
    return out;
  }

  function hasMath(text) {
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
    SIGNUP_CODE_DEFAULT: SIGNUP_CODE_DEFAULT,
    SIGNUP_CODE_BOUNDS: { min: SIGNUP_CODE_MIN, max: SIGNUP_CODE_MAX },
    SIGNUP_CODE_REFUSED: SIGNUP_CODE_REFUSED,
    normalizeSignupCode: normalizeSignupCode,
    legacySignupCode: legacySignupCode,
    validateSignupCode: validateSignupCode,
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
    CSV_MAX_ROWS: CSV_MAX_ROWS,
    CSV_QUESTION_HEADER: CSV_QUESTION_HEADER,
    CSV_NOTE_HEADER: CSV_NOTE_HEADER,
    parseCSV: parseCSV,
    csvRows: csvRows,
    csvSection: csvSection,
    importCSV: importCSV,
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
    clampStudyCount: clampStudyCount,
    clampStudyMinutes: clampStudyMinutes,
    studyPool: studyPool,
    PRACTICE_ALL_SUBJECTS: PRACTICE_ALL_SUBJECTS,
    studyTopics: studyTopics,
    pickStudy: pickStudy,
    forPractice: forPractice,
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
    markAttempt: markAttempt,
    applyTheoryMarks: applyTheoryMarks,
    xpForAttempt: xpForAttempt,
    xpForPractice: xpForPractice,
    practiceXpRemaining: practiceXpRemaining,
    dayStamp: dayStamp,
    dayBefore: dayBefore,
    streakAfterActivity: streakAfterActivity,
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
    renderTex: renderTex,
    mathSpans: mathSpans,
    hasMath: hasMath,
    mathPlain: mathPlain,
    texPlain: texPlain,
    mathIssues: mathIssues,
    texKnows: texKnows,
    MATH_HELP: MATH_HELP.slice()
  };
}));
