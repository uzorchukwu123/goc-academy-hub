/* test-challenge.js — Phase 4.C team (cohort) challenges, slice 1: the pure rules.
   node test/test-challenge.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var TODAY = '2026-10-07';                 // a Wednesday
var WEEK = core.cleanChallengeState ? '2026-10-05' : '';   // the Monday

console.log('\nvalidation');
var v = core.validateChallenge({ cohortId: 'CH1', title: '  Race to  500  ', goal: '500' }, TODAY);
ok('a good challenge is accepted, title tidied, week snapped to Monday', !!v.rec && v.rec.title === 'Race to 500' && v.rec.goal === 500 && v.rec.week === '2026-10-05' && v.rec.endsOn === '2026-10-11' && v.rec.active === true);
ok('a missing cohort is refused', !!core.validateChallenge({ title: 'x'.repeat(5), goal: 50 }, TODAY).error);
ok('a short or long title is refused', !!core.validateChallenge({ cohortId: 'C', title: 'ab', goal: 50 }, TODAY).error && !!core.validateChallenge({ cohortId: 'C', title: 'x'.repeat(81), goal: 50 }, TODAY).error);
ok('a goal below the floor or above the ceiling is refused', !!core.validateChallenge({ cohortId: 'C', title: 'Good one', goal: 5 }, TODAY).error && !!core.validateChallenge({ cohortId: 'C', title: 'Good one', goal: 999999 }, TODAY).error);
ok('an explicit week is snapped to its Monday', core.validateChallenge({ cohortId: 'C', title: 'Good one', goal: 50, week: '2026-10-11' }, TODAY).rec.week === '2026-10-05');

var ch = v.rec; ch.id = 'CHL-1';

console.log('\nper-student contribution, capped');
var s0 = core.cleanChallengeState(null, ch);
ok('a fresh state is empty for this challenge and week', s0.contributed === 0 && s0.claimed === false && String(s0.challengeId) === 'CHL-1' && s0.week === '2026-10-05');
var s1 = core.challengeAfterRun(s0, ch, { answered: 30 }, TODAY);
ok('a run adds its answered count', s1.contributed === 30 && s1.added === 30);
var s2 = core.challengeAfterRun(s1, ch, { answered: 500 }, TODAY);
ok('one student cannot exceed the per-student cap', s2.contributed === core.CHALLENGE_PER_STUDENT_CAP && s2.added === core.CHALLENGE_PER_STUDENT_CAP - 30);
ok('a run outside the challenge week counts nothing', core.challengeAfterRun(s0, ch, { answered: 40 }, '2026-10-20').added === 0);
ok('a run against an inactive challenge counts nothing', core.challengeAfterRun(s0, Object.assign({}, ch, { active: false }), { answered: 40 }, TODAY).added === 0);
ok('a state from another challenge or week reads as empty', core.cleanChallengeState({ challengeId: 'OTHER', week: '2026-10-05', contributed: 99 }, ch).contributed === 0 && core.cleanChallengeState({ challengeId: 'CHL-1', week: '2026-09-28', contributed: 99 }, ch).contributed === 0);

console.log('\nteam total and completion');
ok('the team total sums the members, capped values', core.challengeTeamTotal([200, 150, 90, 60]) === 500);
ok('junk in the contributions is ignored', core.challengeTeamTotal([200, null, undefined, 'x', 100]) === 300);
ok('done once the goal is met', core.challengeDone(500, 500) === true && core.challengeDone(499, 500) === false);

console.log('\nreward: one freeze each, once, capped and carried');
var done = core.challengeReward(ch, 500, s0, 0);
ok('a member with room is paid one freeze when the team finishes', done.claim === true && done.award === core.CHALLENGE_FREEZE_REWARD && done.freezes === 1);
ok('a member already claimed is not paid again', core.challengeReward(ch, 500, core.challengeClaimed(s0, ch), 0).claim === false);
ok('an unfinished team pays nobody', core.challengeReward(ch, 300, s0, 0).claim === false);
var full = core.challengeReward(ch, 500, s0, core.STREAK_FREEZE_MAX);
ok('a member at the freeze cap is not paid, and is carried (blocked max)', full.claim === false && full.blocked === 'max' && full.freezes === core.STREAK_FREEZE_MAX);
ok('claiming marks the state', core.challengeClaimed(s0, ch).claimed === true);

console.log('\nwhat a member sees');
var view = core.challengeForStudent(ch, 420, core.challengeAfterRun(s0, ch, { answered: 120 }, TODAY), TODAY);
ok('the view carries goal, team total, own share, remaining and days left', view.goal === 500 && view.teamTotal === 420 && view.myShare === 120 && view.remaining === 80 && view.daysLeft >= 0 && view.endsOn === '2026-10-11');
ok('an inactive challenge shows nothing', core.challengeForStudent(Object.assign({}, ch, { active: false }), 1, s0, TODAY) === null);
ok('the view reports done and the reward', core.challengeForStudent(ch, 500, s0, TODAY).done === true && core.challengeForStudent(ch, 500, s0, TODAY).reward === core.CHALLENGE_FREEZE_REWARD);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
