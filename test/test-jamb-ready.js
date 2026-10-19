/* test-jamb-ready.js — Phase 3, JAMB mock slice 1: when the sitting may open.
   Pure core logic only.   node test/test-jamb-ready.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c, extra) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }

var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var nextId = 1;
function jq(subject, n, extra) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(Object.assign({ id: nextId++, subject: subject, section: 'jamb', kind: 'objective', active: true }, extra || {}));
  return out;
}
function bank() { var b = []; for (var i = 0; i < arguments.length; i += 2) b = b.concat(jq(arguments[i], arguments[i + 1])); return b; }

/* the bar itself */
ok('default bar is 20', core.JAMB_READY_DEFAULT === 20 && core.clampJambReadyMin() === 20);
ok('blank / junk fall back to the default', core.clampJambReadyMin('') === 20 && core.clampJambReadyMin(null) === 20 && core.clampJambReadyMin('abc') === 20);
ok('the bar is clamped to 1..40', core.clampJambReadyMin(0) === 1 && core.clampJambReadyMin(-5) === 1 && core.clampJambReadyMin(500) === 40);
ok('a fractional bar is rounded', core.clampJambReadyMin('12.4') === 12);

/* the seeded bank is thin on purpose: not enough to open */
var seed = core.seedQuestions();
var seedRep = core.jambReadiness(seed, COMBO);
ok('the seeded bank (about one JAMB question per subject) is not ready', seedRep.ready === false && seedRep.short.length === 4);
ok('and says so by name, in sitting order', seedRep.short.join(',') === 'Use of English,Physics,Chemistry,Mathematics', seedRep.short.join(','));
ok('jambOffered agrees', core.jambOffered(seed, COMBO) === false);

/* depth is judged per subject, against the whole combination */
var full = bank('Use of English', 20, 'Physics', 20, 'Chemistry', 20, 'Mathematics', 20);
var r = core.jambReadiness(full, COMBO);
ok('every subject at the bar is ready', r.ready === true && r.short.length === 0 && r.min === 20);
ok('rows carry available / need / ok', r.subjects.every(function (x) { return x.available === 20 && x.need === 0 && x.ok === true; }));

var oneShort = bank('Use of English', 20, 'Physics', 19, 'Chemistry', 20, 'Mathematics', 20);
var r2 = core.jambReadiness(oneShort, COMBO);
ok('one subject a question short holds the whole sitting back', r2.ready === false && r2.short.join() === 'Physics');
ok('and reports exactly how many more it needs', r2.subjects.filter(function (x) { return x.subject === 'Physics'; })[0].need === 1);
ok('a subject with no questions at all is short by the full bar',
   core.jambReadiness(bank('Use of English', 20, 'Physics', 20, 'Chemistry', 20), COMBO).subjects[3].need === 20);

/* only the jamb pool counts */
var objOnly = [];
for (var i = 0; i < 25; i++) COMBO.forEach(function (s) { objOnly.push({ id: nextId++, subject: s, section: 'objective', kind: 'objective', active: true }); });
ok('a deep OBJECTIVE bank does not open the JAMB sitting', core.jambOffered(objOnly, COMBO) === false);
var practiceOnly = full.map(function (q) { return Object.assign({}, q, { section: 'practice' }); });
ok('practice-only questions do not count either', core.jambOffered(practiceOnly, COMBO) === false);
var inactive = full.map(function (q) { return Object.assign({}, q, { active: false }); });
ok('switched-off questions do not count', core.jambOffered(inactive, COMBO) === false);

/* the bar is the academy's to move */
ok('a lower bar opens a thinner bank', core.jambOffered(oneShort, COMBO, 19) === true);
ok('a higher bar closes it again', core.jambOffered(full, COMBO, 21) === false);
ok('an out-of-range bar is clamped, not trusted', core.jambOffered(bank('Use of English', 1, 'Physics', 1, 'Chemistry', 1, 'Mathematics', 1), COMBO, 0) === true);
ok('the report shows the bar actually applied', core.jambReadiness(full, COMBO, 999).min === 40);

/* only the student's own combination is judged */
var noBio = core.jambReadiness(full, COMBO);
ok('Biology (not in this combination) is neither listed nor required', noBio.subjects.every(function (x) { return x.subject !== 'Biology'; }));
var bio = ['Use of English', 'Biology', 'Chemistry', 'Physics'];
ok('a combination is judged on its own subjects', core.jambOffered(bank('Use of English', 20, 'Biology', 20, 'Chemistry', 20, 'Physics', 20), bio) === true);
ok('and is not rescued by another combination\'s depth', core.jambOffered(full, bio) === false);

/* nothing to sit */
ok('an empty combination is never ready', core.jambReadiness(full, []).ready === false && core.jambOffered(full, null) === false);
ok('an empty bank is never ready', core.jambOffered([], COMBO) === false && core.jambOffered(null, COMBO) === false);

/* it does not disturb the existing blueprint */
var bp = core.jambBlueprint(full, COMBO, null);
ok('jambBlueprint is unchanged', bp.length === 4 && bp.every(function (x) { return x.available === 20; }));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
