/* test-broadcast-rules.js — Phase 4, Targeted broadcast slice 1: the pure rules.
   node test/test-broadcast-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var NOW = Date.UTC(2026, 9, 8, 10, 0, 0);
var good = { audience: { kind: 'subject', subject: 'Chemistry' }, title: 'Mock exam on Friday', body: 'The Chemistry mock holds on Friday at 10am. Bring your calculator.' };

console.log('\naudience');
ok('"goc" is an audience', core.cleanAudience({ kind: 'goc' }).kind === 'goc');
ok('case and spaces in the kind are tidied', core.cleanAudience({ kind: ' GOC ' }).kind === 'goc');
ok('a subject audience keeps its subject', core.cleanAudience({ kind: 'subject', subject: 'Physics' }).subject === 'Physics');
ok('an unknown subject is refused', core.cleanAudience({ kind: 'subject', subject: 'Latin' }) === null);
ok('a subject audience with no subject is refused', core.cleanAudience({ kind: 'subject' }) === null);
ok('no cohort, "everyone" or "open" target exists', ['cohort', 'all', 'everyone', 'open'].every(function (k) { return core.cleanAudience({ kind: k, subject: 'Physics' }) === null; }));
ok('garbage and nothing are refused, not crashes', core.cleanAudience(null) === null && core.cleanAudience('goc') === null && core.cleanAudience(7) === null);
ok('labels read plainly', core.audienceLabel({ kind: 'goc' }) === 'All GOC students' && core.audienceLabel({ kind: 'subject', subject: 'Physics' }) === 'Physics students' && core.audienceLabel(null) === '');

console.log('\nwho is in an audience');
var goc = { id: 'S1', tier: 'goc', active: true, subjects: ['English Language', 'Chemistry', 'Physics', 'Mathematics'] };
var bio = { id: 'S2', tier: 'goc', active: true, subjects: ['English Language', 'Biology'] };
var open = Object.assign({}, goc, { id: 'S3', tier: 'open' });
ok('every GOC student is in the GOC audience', core.audienceHas({ kind: 'goc' }, goc) && core.audienceHas({ kind: 'goc' }, bio));
ok('a subject audience takes only GOC students who take it', core.audienceHas({ kind: 'subject', subject: 'Chemistry' }, goc) && !core.audienceHas({ kind: 'subject', subject: 'Chemistry' }, bio));
ok('an Open student is in neither audience', !core.audienceHas({ kind: 'goc' }, open) && !core.audienceHas({ kind: 'subject', subject: 'Chemistry' }, open));
ok('no tier reads as Open', !core.audienceHas({ kind: 'goc' }, { id: 'S4', active: true, subjects: ['Chemistry'] }));
ok('an odd tier such as "GOCX" is not GOC', !core.audienceHas({ kind: 'goc' }, Object.assign({}, goc, { tier: 'GOCX' })));
ok('a deactivated student is left out', !core.audienceHas({ kind: 'goc' }, Object.assign({}, goc, { active: false })));
ok('a bad audience or no student reaches nobody', !core.audienceHas(null, goc) && !core.audienceHas({ kind: 'goc' }, null) && !core.audienceHas({ kind: 'subject', subject: 'Latin' }, goc));
ok('a student with no subject list is not in a subject audience', !core.audienceHas({ kind: 'subject', subject: 'Chemistry' }, { id: 'S5', tier: 'goc', active: true }));
ok('recipients are counted from the roster', core.broadcastRecipients({ kind: 'goc' }, [goc, bio, open]).length === 2 && core.broadcastRecipients({ kind: 'subject', subject: 'Biology' }, [goc, bio, open]).map(function (s) { return s.id; }).join() === 'S2');

console.log('\nvalidation');
var v = core.validateBroadcast(good);
ok('a good broadcast is accepted, reminder on by default', !!v.rec && v.rec.title === 'Mock exam on Friday' && v.rec.remind === true && v.rec.audience.subject === 'Chemistry');
ok('the reminder can be turned off, and only by false', core.validateBroadcast(Object.assign({}, good, { remind: false })).rec.remind === false && core.validateBroadcast(Object.assign({}, good, { remind: 0 })).rec.remind === true);
ok('no audience is refused', /who it goes to/.test(core.validateBroadcast(Object.assign({}, good, { audience: null })).error));
ok('a short title is refused', !!core.validateBroadcast(Object.assign({}, good, { title: 'Hi' })).error);
ok('a long title is refused', !!core.validateBroadcast(Object.assign({}, good, { title: new Array(90).join('a') })).error);
ok('a short body is refused', !!core.validateBroadcast(Object.assign({}, good, { body: 'Soon' })).error);
ok('a body over 1000 characters is refused', !!core.validateBroadcast(Object.assign({}, good, { body: new Array(1002).join('x') })).error);
ok('title spaces are tidied and body line breaks kept', (function () {
  var r = core.validateBroadcast({ audience: { kind: 'goc' }, title: '  Mock   exam ', body: 'Line one here.\r\nLine two here.' }).rec;
  return r.title === 'Mock exam' && r.body === 'Line one here.\nLine two here.';
})());
ok('nothing at all is an error, not a crash', !!core.validateBroadcast(null).error);

console.log('\nstamping');
var st = core.stampBroadcast(v.rec, 'Mrs Okafor', NOW);
ok('a broadcast is stamped with sender and time', st.rec.sentBy === 'Mrs Okafor' && st.rec.sentAt === '2026-10-08T10:00:00.000Z');
ok('the input is not changed', v.rec.sentBy === undefined);
ok('a blank sender reads "The academy"', core.stampBroadcast(v.rec, '  ', NOW).rec.sentBy === 'The academy');
ok('stamping re-checks the record (a forged stamp or bad audience cannot slip in)', !!core.stampBroadcast(Object.assign({}, v.rec, { audience: { kind: 'everyone' } }), 'X', NOW).error && core.stampBroadcast(Object.assign({}, v.rec, { sentBy: 'forged' }), 'Real', NOW).rec.sentBy === 'Real');
ok('nothing to send is an error', !!core.stampBroadcast(null, 'X', NOW).error);

console.log('\nwhat a student reads');
var list = [
  Object.assign({}, st.rec, { id: 1 }),
  Object.assign({}, st.rec, { id: 2, audience: { kind: 'goc' }, title: 'Holiday', sentAt: '2026-10-09T00:00:00.000Z' }),
  Object.assign({}, st.rec, { id: 3, audience: { kind: 'subject', subject: 'Biology' }, title: 'Bio quiz', sentAt: '2026-10-07T00:00:00.000Z' })
];
ok('a student sees what is addressed to them, newest first', core.broadcastsForStudent(list, goc).map(function (b) { return b.id; }).join() === '2,1');
ok('a Biology student sees the GOC one and the Biology one', core.broadcastsForStudent(list, bio).map(function (b) { return b.id; }).join() === '2,3');
ok('an Open student sees none', core.broadcastsForStudent(list, open).length === 0);
ok('a student receives no staff name, only "G.O.C Academy"', (function () {
  var b = core.broadcastsForStudent(list, goc)[0];
  return b.from === 'G.O.C Academy' && b.sentBy === undefined && b.audience === undefined && b.at === '2026-10-09T00:00:00.000Z';
})());
ok('junk in the list is ignored', core.broadcastsForStudent([null, 5, {}], goc).length === 0 && core.broadcastsForStudent(null, goc).length === 0);

if (fails) { console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nall passed');
