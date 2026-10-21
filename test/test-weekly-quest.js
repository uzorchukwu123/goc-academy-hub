/* test-weekly-quest.js — Phase 2, weekly quest slice 1: pure core logic.
   node test/test-weekly-quest.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name); } }

/* 2026-10-05 is a Monday, 2026-10-11 the Sunday that closes that week. */
var MON = '2026-10-05', TUE = '2026-10-06', SUN = '2026-10-11', NEXT_MON = '2026-10-12';

ok('targets are the agreed medium ones', core.WEEKLY_QUEST_DAYS === 5 && core.WEEKLY_QUEST_QUESTIONS === 100 && core.WEEKLY_QUEST_FREEZES === 1);

/* weeks run Monday to Sunday */
ok('a Monday starts its own week', core.weekStart(MON) === MON);
ok('midweek maps back to Monday', core.weekStart(TUE) === MON && core.weekStart('2026-10-09') === MON);
ok('a Sunday belongs to the week that began six days earlier', core.weekStart(SUN) === MON);
ok('the next Monday starts a new week', core.weekStart(NEXT_MON) === NEXT_MON);
ok('the week ends on Sunday', core.weekEnd(TUE) === SUN && core.weekEnd(MON) === SUN && core.weekEnd(SUN) === SUN);
ok('weeks cross a month boundary', core.weekStart('2026-11-01') === '2026-10-26' && core.weekEnd('2026-10-28') === '2026-11-01');
ok('weeks cross a year boundary', core.weekStart('2027-01-01') === '2026-12-28' && core.weekEnd('2026-12-30') === '2027-01-03');
ok('a bad stamp falls back to the current week', core.weekStart('nonsense') === core.weekStart());

/* reading a stored record */
var empty = core.weeklyQuest(null, TUE);
ok('no record is an empty current week', empty.week === MON && empty.endsOn === SUN && empty.days === 0 && empty.questions === 0 && !empty.done && !empty.claimed);
ok('the view carries both targets and what is left', empty.targetDays === 5 && empty.targetQuestions === 100 && empty.remainingDays === 5 && empty.remainingQuestions === 100 && empty.reward === 1);
var stale = core.weeklyQuest({ week: '2026-09-28', days: 5, questions: 140, claimed: true }, TUE);
ok('a record from an earlier week reads as empty', stale.week === MON && stale.days === 0 && stale.questions === 0 && !stale.done && !stale.claimed);
var junk = core.weeklyQuest({ week: MON, days: -3, questions: 'x', claimed: 'yes' }, TUE);
ok('garbage counters are made safe', junk.days === 0 && junk.questions === 0 && junk.claimed === false);
ok('a non-object record is safe', core.weeklyQuest('oops', TUE).days === 0 && core.weeklyQuest(42, TUE).questions === 0);
ok('a runaway counter is clamped', core.cleanWeekQuest({ week: MON, days: 1e12, questions: 1e12 }, TUE).questions <= 100000);

/* folding runs into the week */
var s = core.weeklyQuestAfterRun(null, TUE, { answered: 12, dailyClaimed: false });
ok('answered questions add up', s.week === MON && s.questions === 12 && s.days === 0);
s = core.weeklyQuestAfterRun(s, TUE, { answered: 8, dailyClaimed: true });
ok('a collected daily quest adds one day', s.questions === 20 && s.days === 1);
s = core.weeklyQuestAfterRun(s, TUE, { answered: 5, dailyClaimed: false });
ok('a later run the same day adds questions but not a second day', s.questions === 25 && s.days === 1);
ok('a bad run changes nothing', (function () { var x = core.weeklyQuestAfterRun(s, TUE, null); return x.questions === 25 && x.days === 1; })());
ok('negative or fractional answered is made safe', core.weeklyQuestAfterRun(null, TUE, { answered: -4 }).questions === 0 && core.weeklyQuestAfterRun(null, TUE, { answered: 3.9 }).questions === 3);
ok('a run in a new week starts that week afresh', (function () {
  var x = core.weeklyQuestAfterRun({ week: MON, days: 4, questions: 90, claimed: true }, NEXT_MON, { answered: 6, dailyClaimed: true });
  return x.week === NEXT_MON && x.questions === 6 && x.days === 1 && x.claimed === false;
})());
ok('Sunday still counts toward the week that is ending', core.weeklyQuestAfterRun({ week: MON, days: 4, questions: 0 }, SUN, { answered: 10, dailyClaimed: true }).week === MON);

/* whichever hits first */
var byDays = core.weeklyQuest({ week: MON, days: 5, questions: 30 }, SUN);
ok('five daily quests finish it even with few questions', byDays.done && byDays.byDays && !byDays.byQuestions && byDays.remainingDays === 0);
var byQs = core.weeklyQuest({ week: MON, days: 2, questions: 100 }, SUN);
ok('a hundred questions finish it even with few daily quests', byQs.done && byQs.byQuestions && !byQs.byDays && byQs.remainingQuestions === 0);
ok('just short of both is not done', !core.weeklyQuest({ week: MON, days: 4, questions: 99 }, SUN).done);
ok('going past a target never leaves a negative remainder', (function () { var q = core.weeklyQuest({ week: MON, days: 7, questions: 250 }, SUN); return q.remainingDays === 0 && q.remainingQuestions === 0 && q.done; })());
ok('both targets met is still just done', (function () { var q = core.weeklyQuest({ week: MON, days: 5, questions: 100 }, SUN); return q.done && q.byDays && q.byQuestions; })());

/* the reward */
var doneQ = core.weeklyQuest({ week: MON, days: 5, questions: 10 }, TUE);
var r = core.weeklyReward(doneQ, 0);
ok('a finished, unpaid quest pays one freeze', r.claim && r.award === 1 && r.freezes === 1 && r.blocked === null);
ok('it pays up to the cap', core.weeklyReward(doneQ, 1).freezes === 2 && core.weeklyReward(doneQ, 1).claim);
r = core.weeklyReward(doneQ, core.STREAK_FREEZE_MAX);
ok('at the cap it is not spent: nothing paid, nothing claimed', !r.claim && r.award === 0 && r.freezes === core.STREAK_FREEZE_MAX && r.blocked === 'max');
ok('an unfinished quest pays nothing', (function () { var x = core.weeklyReward(core.weeklyQuest({ week: MON, days: 4, questions: 99 }, TUE), 0); return !x.claim && x.award === 0 && x.blocked === null; })());
ok('an already-paid quest pays nothing again', (function () { var x = core.weeklyReward(core.weeklyQuest({ week: MON, days: 5, questions: 0, claimed: true }, TUE), 0); return !x.claim && x.award === 0 && x.blocked === null; })());
ok('no quest at all pays nothing', core.weeklyReward(null, 0).claim === false);
ok('a nonsense freeze count is made safe', core.weeklyReward(doneQ, 'many').freezes === 1 && core.weeklyReward(doneQ, -5).freezes === 1);
var paid = core.weeklyQuestClaimed({ week: MON, days: 5, questions: 10 }, TUE);
ok('claiming marks the week paid and keeps its counts', paid.claimed === true && paid.days === 5 && paid.questions === 10 && paid.week === MON);
ok('a paid week reads as claimed', core.weeklyQuest(paid, TUE).claimed === true);
ok('a new week is claimable again', (function () { var q = core.weeklyQuest(paid, NEXT_MON); return !q.claimed && !q.done; })());

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
