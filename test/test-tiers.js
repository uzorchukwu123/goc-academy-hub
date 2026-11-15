/* test-tiers.js — Phase 3B, access tiers slice 1: the pure rules.
   Open vs GOC: what each may use and how much. Pure core logic only.
   node test/test-tiers.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
/* Open students now have unrestricted practice, so the live table no longer
   limits them. The limit machinery is proved against a patched COPY of the
   core that carries the old Open numbers (see legacy-limits.js). */
var legacy = require('./legacy-limits.js');
var old = legacy.loadCore(APP);
var fails = 0;
function ok(name, c, extra) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('the two tiers, and failing closed');
ok('there are exactly two tiers: open and goc', core.TIERS.length === 2 && core.TIERS[0] === 'open' && core.TIERS[1] === 'goc');
ok('the default tier is open', core.DEFAULT_TIER === 'open');
ok("'goc' is goc", core.cleanTier('goc') === 'goc');
ok("'GOC' and ' Goc ' are goc (case and spaces do not matter)", core.cleanTier('GOC') === 'goc' && core.cleanTier(' Goc ') === 'goc');
ok("'open' is open", core.cleanTier('open') === 'open');
[undefined, null, '', 'admin', 'premium', 'goc2', 'gocc', 'g o c', 0, 1, true, {}, [], ['goc']].forEach(function (v) {
  ok('a missing or unknown tier reads as open: ' + JSON.stringify(v), core.cleanTier(v) === 'open');
});
ok('limits for an unknown tier are the Open limits', JSON.stringify(core.tierLimits('premium')) === JSON.stringify(core.tierLimits('open')));
ok('features for an unknown tier are the Open features', JSON.stringify(core.tierFeatures(null)) === JSON.stringify(core.tierFeatures('open')));

head('what each tier may use (the 3B table)');
var open = ['practice', 'mistakes', 'notes', 'jambMock', 'pastQuestions', 'resourceDownload', 'news', 'reminders', 'league', 'bookmarks', 'spacedReview'];
var goc = ['webTestObjective', 'webTestTheory', 'resourceView', 'videos', 'classRecordings', 'streakFreezes', 'fullRecord', 'classNotices', 'askTutor'];
open.forEach(function (f) { ok(f + ': Open yes, GOC yes', core.canUse(f, 'open') === true && core.canUse(f, 'goc') === true); });
goc.forEach(function (f) { ok(f + ': Open no, GOC yes', core.canUse(f, 'open') === false && core.canUse(f, 'goc') === true); });
ok('Open users can sit the JAMB-oriented test but not Objective or Theory Web Tests', core.canUse('jambMock', 'open') && !core.canUse('webTestObjective', 'open') && !core.canUse('webTestTheory', 'open'));
ok('there is no JAMB taster any more', core.canUse('jambTaster', 'open') === false && core.canUse('jambTaster', 'goc') === false && core.jambTasterAllowance === undefined);
ok('Open users are ranked in the league like everyone else', core.canUse('league', 'open'));
ok('Open users can download resources but not open them in the app', core.canUse('resourceDownload', 'open') && !core.canUse('resourceView', 'open'));
ok('an unknown feature is refused for everyone', !core.canUse('teleport', 'goc') && !core.canUse('teleport', 'open') && !core.canUse('', 'goc') && !core.canUse(undefined, 'goc'));
ok("inherited object keys are not features ('toString', '__proto__', 'constructor')", ['toString', '__proto__', 'constructor', 'hasOwnProperty'].every(function (f) { return !core.canUse(f, 'goc'); }));
ok('a missing tier cannot use a GOC feature', !core.canUse('webTestObjective') && !core.canUse('videos', undefined) && !core.canUse('webTestTheory', ''));
var fo = core.tierFeatures('open'), fg = core.tierFeatures('goc');
ok('GOC never has less than Open', Object.keys(fo).every(function (k) { return !fo[k] || fg[k]; }));
ok('both tiers list the same features', JSON.stringify(Object.keys(fo)) === JSON.stringify(Object.keys(fg)));
ok('every feature is a plain true/false', Object.keys(fg).every(function (k) { return typeof fg[k] === 'boolean' && typeof fo[k] === 'boolean'; }));
fo.videos = true; fo.practice = false;
ok('editing the returned features does not change the rules', core.canUse('videos', 'open') === false && core.canUse('practice', 'open') === true);

head('limits');
var lo = core.tierLimits('open'), lg = core.tierLimits('goc');
ok('Open: practice has no daily cap and no run cap', lo.practicePerDay === null && lo.practiceRunMax === null);
ok('Open: every past-paper year, practice history not trimmed', lo.pastYears === 'all' && lo.practiceHistory === 30);
ok('Open: 20 bookmarks, only the first few notes of each subject', lo.bookmarks === 20 && lo.notesPerSubject === 3);
ok('Open: reviews are capped per day', lo.reviewsPerDay === 10);
ok('GOC: no daily practice limit, no run limit, all notes, all years', lg.practicePerDay === null && lg.practiceRunMax === null && lg.notesPerSubject === null && lg.pastYears === 'all');
ok('GOC: no limit on saved questions or on how many practice runs are kept', lg.bookmarks === null && lg.practiceHistory === null);
ok('GOC has no numeric limit at all in the live table', Object.keys(lg).every(function (k) { return lg[k] === null || lg[k] === 'all'; }), JSON.stringify(lg));
ok('GOC limits are never tighter than Open (null = none)', (lg.bookmarks === null || lg.bookmarks >= lo.bookmarks) && (lg.practiceHistory === null || lg.practiceHistory >= lo.practiceHistory));
lo.reviewsPerDay = 9999; lo.bookmarks = 9999;
ok('editing the returned limits does not change the rules', core.tierLimits('open').reviewsPerDay === 10 && core.tierLimits('open').bookmarks === 20);
var olo = old.tierLimits('open');
ok('(machinery check) the patched copy carries the old Open numbers', olo.practicePerDay === 20 && olo.practiceRunMax === 10 && olo.practiceHistory === 5 && olo.pastYears === 'latest');

head('daily practice allowance (machinery, old Open numbers)');
ok('live table: Open practice is unlimited', core.dailyAllowance(500, 'open').unlimited === true && core.capPracticeRun(30, 400, 'open') === 30);
var d0 = old.dailyAllowance(0, 'open');
ok('Open, nothing used: 20 of 20 left', d0.limit === 20 && d0.used === 0 && d0.remaining === 20 && d0.allowed === true && d0.unlimited === false);
var d7 = old.dailyAllowance(7, 'open');
ok('Open, 7 used: 13 left', d7.remaining === 13 && d7.allowed === true);
var d20 = old.dailyAllowance(20, 'open');
ok('Open, 20 used: none left and not allowed', d20.remaining === 0 && d20.allowed === false);
ok('Open, over the limit stays at none left (never negative)', old.dailyAllowance(35, 'open').remaining === 0 && old.dailyAllowance(35, 'open').allowed === false);
var dg = old.dailyAllowance(500, 'goc');
ok('GOC is unlimited whatever was used', dg.unlimited === true && dg.limit === null && dg.remaining === null && dg.allowed === true);
ok('a missing tier gets the Open allowance', old.dailyAllowance(5).remaining === 15 && old.dailyAllowance(5, 'nonsense').limit === 20);
[undefined, null, 'x', -4, NaN, 2.9].forEach(function (u) {
  var r = old.dailyAllowance(u, 'open');
  ok('junk usage ' + String(u) + ' never inflates the allowance', r.remaining <= 20 && r.remaining >= 0 && r.used >= 0 && Number.isInteger(r.used));
});
ok('2.9 used counts as 2 (whole questions only)', old.dailyAllowance(2.9, 'open').used === 2);

head('how big a practice run may be (machinery, old Open numbers)');
ok('Open asks for 30: held to 10 per run', old.capPracticeRun(30, 0, 'open') === 10);
ok('Open asks for 10 with 4 left today: held to 4', old.capPracticeRun(10, 16, 'open') === 4);
ok('Open asks for 5 with plenty left: 5', old.capPracticeRun(5, 0, 'open') === 5);
ok('Open with the allowance spent: 0', old.capPracticeRun(10, 20, 'open') === 0);
ok('GOC asks for 30: 30 (no tier limit)', old.capPracticeRun(30, 400, 'goc') === 30);
ok('junk request sizes give 0, never a negative or fraction', old.capPracticeRun(-5, 0, 'open') === 0 && old.capPracticeRun('x', 0, 'goc') === 0 && old.capPracticeRun(7.8, 0, 'goc') === 7);

head('review allowance');
ok('Open: 10 spaced-repetition answers a day, then none', core.reviewAllowance(4, 'open').remaining === 6 && core.reviewAllowance(10, 'open').allowed === false);
ok('GOC: reviews are not limited', core.reviewAllowance(99, 'goc').unlimited === true);

head('notes an Open user may read');
ok('Open: the first 3 notes of a subject (positions 0, 1, 2)', core.noteVisible(0, 'open') && core.noteVisible(1, 'open') && core.noteVisible(2, 'open'));
ok('Open: the 4th note and beyond are locked', !core.noteVisible(3, 'open') && !core.noteVisible(40, 'open'));
ok('Open: a bad position is locked', !core.noteVisible(-1, 'open') && !core.noteVisible(undefined, 'open') && !core.noteVisible('x', 'open'));
ok('GOC: every note is visible', core.noteVisible(0, 'goc') && core.noteVisible(500, 'goc'));
ok('a missing tier sees only the first notes', core.noteVisible(2) && !core.noteVisible(3));

head('the day the allowance resets: midnight in Lagos');
ok('22:59 UTC is still the same Lagos day (23:59 there)', core.lagosDay(Date.UTC(2026, 9, 7, 22, 59, 59)) === '2026-10-07');
ok('23:00 UTC is already the next Lagos day (midnight there)', core.lagosDay(Date.UTC(2026, 9, 7, 23, 0, 0)) === '2026-10-08');
ok('noon UTC is the same day', core.lagosDay(Date.UTC(2026, 9, 7, 12, 0, 0)) === '2026-10-07');
ok('the year rolls over at 23:00 UTC on 31 December', core.lagosDay(Date.UTC(2026, 11, 31, 23, 0, 0)) === '2027-01-01' && core.lagosDay(Date.UTC(2026, 11, 31, 22, 59, 59)) === '2026-12-31');
ok('a leap-year 28 February rolls to the 29th', core.lagosDay(Date.UTC(2028, 1, 28, 23, 30, 0)) === '2028-02-29');
ok('accepts a Date and an ISO-derived number', core.lagosDay(new Date(Date.UTC(2026, 9, 7, 23, 0, 0))) === '2026-10-08' && core.lagosDay(new Date('2026-10-07T23:00:00Z').getTime()) === '2026-10-08');
ok('with no argument it returns a YYYY-MM-DD stamp', /^\d{4}-\d{2}-\d{2}$/.test(core.lagosDay()));
ok('junk input falls back to a valid stamp instead of throwing', /^\d{4}-\d{2}-\d{2}$/.test(core.lagosDay('not a date')) && /^\d{4}-\d{2}-\d{2}$/.test(core.lagosDay(NaN)));

console.log('\npractice runs: no count limit for GOC, a maximum age for everyone');
var NOW = Date.UTC(2026, 9, 8, 12, 0, 0), D = 86400000;
var runsIn = [{ ts: NOW }, { ts: NOW - 364 * D }, { ts: NOW - 366 * D }, { ts: NOW - 900 * D }, { review: [] }, { ts: 'junk' }];
var kept = core.dropOldRuns(runsIn, NOW);
ok('the age limit is a year', core.PRACTICE_MAX_AGE_DAYS === 365);
ok('runs older than a year are dropped, newer ones kept', kept.length === 4 && kept[0].ts === NOW && kept[1].ts === NOW - 364 * D, JSON.stringify(kept));
ok('a run with no usable time is kept, not guessed at', kept.some(function (r) { return !r.ts && r.review; }) && kept.some(function (r) { return r.ts === 'junk'; }));
ok('dropOldRuns tolerates junk and never mutates its input', core.dropOldRuns(null, NOW).length === 0 && runsIn.length === 6);
ok('capList: a number cuts the list, null keeps all of it, a copy either way', core.capList([1, 2, 3, 4], 2).join() === '1,2' && core.capList([1, 2, 3, 4], null).join() === '1,2,3,4' && core.capList(undefined, null).length === 0);
var src = [1, 2, 3]; core.capList(src, null).push(9);
ok('  and the original list is untouched', src.length === 3);

console.log('\nthe tier chosen when the console adds a student');
ok('left out, blank or null it is GOC', core.newStudentTier(undefined).tier === 'goc' && core.newStudentTier('').tier === 'goc' && core.newStudentTier('  ').tier === 'goc' && core.newStudentTier(null).tier === 'goc');
ok('goc and open are accepted in any capitalisation, trimmed', core.newStudentTier(' GOC ').tier === 'goc' && core.newStudentTier('Open').tier === 'open' && core.newStudentTier('open').ok === true);
ok('anything else is refused, not quietly turned into either tier', ['platinum', 'gold', 5, true, {}, []].every(function (v) { var r = core.newStudentTier(v); return r.ok === false && /Open or GOC/.test(r.error); }));

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (slice 1): all checks passed'));
process.exit(fails ? 1 : 0);
