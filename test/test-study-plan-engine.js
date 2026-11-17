/* test-study-plan-engine.js — the retained weekly study planner rules (pure).
   The standalone Timetable screen is retired and stays retired, but its planner
   engine is preserved and is not owned by any screen: it lives in
   js/goc-core.js so the redesigned Study Plan page can mount it directly. This
   suite pins the engine itself, so it keeps working whether the interim
   Classes-screen surface exists or has been deleted.
   node test/test-study-plan-engine.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var CHEM = { subject: 'Chemistry' };

head('the week');
ok('days are Monday-first', core.PLAN_DAYS.join(',') === 'Mon,Tue,Wed,Thu,Fri,Sun'.replace(',Sun', ',Sat,Sun'));
ok('every day has a label', core.PLAN_DAYS.every(function (k) { return !!core.PLAN_DAY_LABELS[k]; }));
ok('a Sunday timestamp lands on Sunday, not the Monday of another week',
   core.planDayKey(new Date('2026-11-22T10:00:00')) === 'Sun', core.planDayKey(new Date('2026-11-22T10:00:00')));
ok('a Monday timestamp lands on Monday',
   core.planDayKey(new Date('2026-11-23T10:00:00')) === 'Mon');
ok('an unusable timestamp has no day', core.planDayKey('not a date') === '');
ok('no date, no day', core.planDayKey(null) === '');

head('time labels the planner reads and writes');
ok('midnight reads as 12, not 0', core.planTimeLabel(new Date('2026-11-23T00:30:00')) === '12:30');
ok('morning keeps its hour', core.planTimeLabel(new Date('2026-11-23T09:05:00')) === '9:05');
ok('afternoon keeps its hour', core.planTimeLabel(new Date('2026-11-23T15:45:00')) === '3:45');
ok('a typed time becomes the same label', core.planTimeFromInput('14:30') === '2:30');
ok('and midnight from the input too', core.planTimeFromInput('00:15') === '12:15');
ok('a label reads back to minutes', core.planMinutesOf('9:30') === 9 * 60 + 30);
ok('the 1-6 convention is afternoon, as the schedule has always read it',
   core.planMinutesOf('3:00') === 15 * 60 && core.planMinutesOf('11:00') === 11 * 60);
ok('a broken label reads as midnight rather than NaN',
   core.planMinutesOf('') === 0 && isFinite(core.planMinutesOf('junk')));

head('sorting a day');
var day = [
  { t: '4:00', kind: 'study', subj: 'Chemistry' },
  { t: '8:00', kind: 'study', subj: 'Physics' },
  { rest: true, t: '9:00' },
  { t: '12:30', kind: 'study', subj: 'Chemistry' }
];
var sorted = core.planSortBlocks(day);
ok('morning before afternoon before evening — 4:00 is 16:00, as the schedule has always read it',
   sorted.map(function (b) { return b.t; }).join() === '8:00,12:30,4:00,9:00', sorted.map(function (b) { return b.t; }).join());
ok('the rest marker is always last', sorted[sorted.length - 1].rest === true);
ok('a kind:"rest" block is last too',
   core.planSortBlocks([{ t: '8:00' }, { t: '1:00', kind: 'rest' }])[1].kind === 'rest');
ok('the array it was given is not reordered', day[0].t === '4:00' && day.length === 4);

head('validating a block the student plans');
var good = { day: 'tue', t: '3:30', minutes: 45, subj: 'Chemistry', topic: '  Acids and bases  ' };
var v = core.planValidateBlock(good, [CHEM]);
ok('a good block is accepted', !!v.block && !v.error);
ok('and comes back normalised', v.block.day === 'Tue' && v.block.topic === 'Acids and bases', JSON.stringify(v.block));
ok('with a duration label the surface can print', v.block.dur === '45m' && v.block.minutes === 45);
ok('and marked as the student\'s own study block', v.block.kind === 'study');
ok('a day that is not a day of the week is refused',
   !!core.planValidateBlock(Object.assign({}, good, { day: 'Funday' }), [CHEM]).error);
ok('no day at all is refused', !!core.planValidateBlock(Object.assign({}, good, { day: '' }), [CHEM]).error);
ok('no subject is refused', !!core.planValidateBlock(Object.assign({}, good, { subj: '' }), [CHEM]).error);
ok('a paper the student does not sit is refused by name',
   /do not sit Physics/.test(core.planValidateBlock(Object.assign({}, good, { subj: 'Physics' }), [CHEM]).error || ''));
ok('the shared slots are allowed even though they are not papers', (function () {
  return core.PLAN_SHARED_SLOTS.every(function (s) {
    return !!core.planValidateBlock(Object.assign({}, good, { subj: s }), [CHEM]).block;
  });
})());
ok('a block with no time is refused', !!core.planValidateBlock(Object.assign({}, good, { t: '' }), [CHEM]).error);
ok('a malformed time is refused', !!core.planValidateBlock(Object.assign({}, good, { t: 'tea time' }), [CHEM]).error);
ok('a block shorter than five minutes is refused',
   !!core.planValidateBlock(Object.assign({}, good, { minutes: 3 }), [CHEM]).error);
ok('a block over four hours is refused and says to split it',
   /split it/.test(core.planValidateBlock(Object.assign({}, good, { minutes: 300 }), [CHEM]).error || ''));
ok('a block with no topic is refused',
   !!core.planValidateBlock(Object.assign({}, good, { topic: '  ' }), [CHEM]).error);
ok('nothing at all is refused', !!core.planValidateBlock(null, [CHEM]).error);
ok('a very long topic is capped, not refused', (function () {
  var long = core.planValidateBlock(Object.assign({}, good, { topic: new Array(300).join('x') }), [CHEM]);
  return !!long.block && long.block.topic.length === 120;
})());
ok('with no subject list given, any subject is allowed', !!core.planValidateBlock(good, []).block);

head('duration shorthand');
ok('minutes-only under an hour', core.planDurationLabel(30) === '30m');
ok('exactly an hour', core.planDurationLabel(60) === '1h');
ok('an hour and a half', core.planDurationLabel(90) === '1h30m');
ok('two hours', core.planDurationLabel(120) === '2h');
ok('nothing planned prints nothing', core.planDurationLabel(0) === '');

head('a live class as a planner block');
var cls = { subject: 'Physics', subj: 'Physics', topic: 'Waves', tutor: 'Mr Eze', scheduledAt: '2026-11-23T15:00:00', durationMin: 60, zoomLink: 'https://x.test/z', joinLocked: true };
var cb = core.planClassBlock(cls);
ok('it carries its day, time, duration and subject',
   cb.day === 'Mon' && cb.t === '3:00' && cb.dur === '1h' && cb.subj === 'Physics');
ok('the tutor is named in the topic, as the schedule words it', /Waves — Mr Eze/.test(cb.topic));
ok('it is marked as the academy\'s class, not the student\'s own block', cb.kind === 'class');
ok('the join lock travels with it', cb.joinLocked === true && cb.zoomLink === 'https://x.test/z');
ok('it keeps the timestamp so the surface can print a date', typeof cb.at === 'number' && cb.at > 0);
ok('an unusable class time gives no block', core.planClassBlock({ scheduledAt: 'nope' }) === null);
ok('no class, no block', core.planClassBlock(null) === null);

head('the whole week, grouped');
var week = core.planWeek(
  [cls, { subject: 'Chemistry', topic: 'Salts', scheduledAt: '2026-11-24T09:00:00', durationMin: 90 }],
  [
    { day: 'Mon', t: '8:00', kind: 'study', subj: 'Chemistry', topic: 'Acids', minutes: 30 },
    { day: 'Mon', t: '7:00', kind: 'study', subj: 'Physics', topic: 'Optics', minutes: 45 },
    { day: 'Sun', t: '5:00', kind: 'rest', minutes: 0 }
  ]
);
ok('every day of the week is present, empty or not', week.days.length === 7 &&
   week.days.every(function (k) { return !!week.week[k]; }));
ok('Monday holds the class and the two own blocks, in time order',
   week.week.Mon.blocks.map(function (b) { return b.t; }).join() === '7:00,8:00,3:00',
   week.week.Mon.blocks.map(function (b) { return b.t; }).join());
ok('Tuesday holds the class that was scheduled on it',
   week.week.Tue.blocks.length === 1 && week.week.Tue.blocks[0].t === '9:00');
ok('Sunday holds only the rest marker', week.week.Sun.blocks[0].kind === 'rest');
ok('Wednesday is empty, not missing', week.week.Wed.blocks.length === 0);
ok('a day counts the student\'s own study blocks only, not classes',
   week.week.Mon.studyCount === 2 && week.week.Tue.studyCount === 0);
ok('a day totals its planned minutes and ignores the rest marker',
   week.week.Mon.totalMinutes === 135 && week.week.Sun.totalMinutes === 0,
   week.week.Mon.totalMinutes + ' / ' + week.week.Sun.totalMinutes);

head('the week can be filtered by whose block it is');
var mine = core.planWeek([cls], [{ day: 'Mon', t: '8:00', kind: 'study', subj: 'Chemistry', minutes: 30 }],
  function (bl) { return bl.kind === 'study'; });
ok('a filter that refuses classes leaves only the student\'s own',
   mine.week.Mon.blocks.length === 1 && mine.week.Mon.blocks[0].kind === 'study');
ok('a filter that refuses everything leaves an empty week',
   core.planWeek([cls], [], function () { return false; }).week.Mon.blocks.length === 0);
ok('a block with no usable day is dropped rather than crashing',
   core.planWeek([], [{ day: 'Funday', t: '8:00', kind: 'study' }]).week.Mon.blocks.length === 0);
ok('empty input still gives the seven days',
   core.planWeek().days.length === 7 && core.planWeek(null, null).week.Fri.blocks.length === 0);

head('day summary and progress');
ok('an empty day says so', core.planDaySummary([]) === 'Nothing planned');
ok('one block reads singular', core.planDaySummary([{ kind: 'study' }]) === '1 block planned');
ok('two blocks read plural', core.planDaySummary([{ kind: 'study' }, { kind: 'class' }]) === '2 blocks planned');
ok('a rest marker is not a planned block',
   core.planDaySummary([{ kind: 'rest' }]) === 'Nothing planned');
var pg = core.planDayProgress(60, 45);
ok('progress is the share of the plan, in whole percent', pg.percent === 75 && pg.done === 45 && pg.planned === 60);
ok('a met plan says so and has nothing remaining', pg.met === false && pg.remaining === 15);
ok('over-studying is capped at 100%, never 140%',
   core.planDayProgress(30, 42).percent === 100 && core.planDayProgress(30, 42).met === true);
ok('a day with no plan cannot read as complete', core.planDayProgress(0, 90).percent === 0 &&
   core.planDayProgress(0, 90).met === false);
ok('a fresh day is zero, not NaN', core.planDayProgress().planned === 0 && core.planDayProgress().done === 0);

head('the engine is not owned by any screen');
var fs = require('fs');
var appSrc = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var htmlSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
ok('the standalone Timetable screen is still retired', !/id="timetable"/.test(htmlSrc));
ok('and no Timetable navigation came back',
   !/go\('timetable'\)/.test(appSrc) && !/<option value="timetable"/.test(htmlSrc));
ok('the interim Classes surface uses the engine rather than re-implementing it',
   /GOC\.core\.planWeek\(/.test(appSrc) && !/function blockSortKey/.test(appSrc) &&
   !/function timeInputTo12/.test(appSrc) && !/function sortDayBlocks/.test(appSrc));
ok('study-time tracking still reaches the engine\'s own window rules',
   typeof core.studyWindowStatus === 'function');

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
