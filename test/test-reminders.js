/* test-reminders.js — Phase 2, Reminders: the rules (core.reminderPlan), the
   message text, and a whole sweep driven with a fake mailbox and a fake clock.
   node test/test-reminders.js  */
'use strict';
var path = require('path');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var svc = require(path.join(APP, 'server', 'lib', 'reminders.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* Wednesday 7 Oct 2026, 18:00 local. */
var WED = '2026-10-07', TUE = '2026-10-06', SUN = '2026-10-11', MON = '2026-10-05';
function stu(extra) {
  return Object.assign({ id: 'GOC-S-001', name: 'Ada Obi', active: true, email: 'ada@example.com', phone: '08031234567',
    streak: 4, streakDay: TUE, streakFreezes: 0, weekQuest: null }, extra || {});
}
function plan(extra) {
  return core.reminderPlan(Object.assign({ student: stu(), today: WED, hour: 18, dueCount: 0 }, extra || {}));
}

head('Preferences and channels');
ok('no stored choice = email on, SMS off', JSON.stringify(core.cleanReminderPrefs()) === '{"email":true,"sms":false}');
ok('garbage reads as the defaults', JSON.stringify(core.cleanReminderPrefs({ email: 'no', sms: 'yes' })) === '{"email":true,"sms":false}');
ok('only a real false switches email off', core.cleanReminderPrefs({ email: false }).email === false);
ok('only a real true switches SMS on', core.cleanReminderPrefs({ sms: true }).sms === true);
ok('an address that looks right passes', core.reminderEmailOk('a.b@mail.example.ng'));
['', 'ada', 'ada@', '@x.co', 'a b@x.co', 'a@x', 'a@x.co,b@y.co', null].forEach(function (bad) {
  ok('rejects ' + JSON.stringify(bad), !core.reminderEmailOk(bad));
});
ok('phone numbers: local, international, spaced', core.reminderPhoneOk('08031234567') && core.reminderPhoneOk('+234 803 123 4567'));
ok('phone numbers: too short or lettered fail', !core.reminderPhoneOk('123') && !core.reminderPhoneOk('call me'));
ok('email is the only channel by default', JSON.stringify(core.reminderChannels(stu(), undefined)) === '["email"]');
ok('email off and no SMS: no channel', core.reminderChannels(stu(), { email: false }).length === 0);
ok('SMS needs both the switch and a number',
  JSON.stringify(core.reminderChannels(stu(), { sms: true })) === '["email","sms"]' &&
  core.reminderChannels(stu({ phone: '' }), { sms: true }).indexOf('sms') === -1);
ok('no usable address: no channel', core.reminderChannels(stu({ email: '' }), undefined).length === 0);

head('Streak at risk');
var p = plan();
ok('practised yesterday, not today: streak reminder', p.send && p.kinds.join() === 'streak' && p.streak === 4, JSON.stringify(p.kinds));
ok('practised today: nothing', !plan({ student: stu({ streakDay: WED }) }).send);
ok('streak already lost (older than yesterday): nothing to save',
  !plan({ student: stu({ streakDay: '2026-10-03' }), weekQuest: { week: MON, days: 1, questions: 5, claimed: false } }).send);
ok('no streak: nothing', !plan({ student: stu({ streak: 0 }) }).send);
ok('a held freeze is carried on the plan', plan({ student: stu({ streakFreezes: 2 }) }).freezes === 2);
ok('already told today: nothing', !plan({ sent: { streak: WED } }).send);
ok('told yesterday: tells again', plan({ sent: { streak: TUE } }).send);

head('Spaced-repetition reviews');
p = plan({ student: stu({ streakDay: WED }), dueCount: 3 });
ok('reviews due: review reminder', p.send && p.kinds.join() === 'review' && p.dueCount === 3);
ok('nothing due: nothing', !plan({ student: stu({ streakDay: WED }), dueCount: 0 }).send);
ok('told yesterday: waits (at most every 2 days)', !plan({ student: stu({ streakDay: WED }), dueCount: 3, sent: { review: TUE } }).send);
ok('told two days ago: tells again', plan({ student: stu({ streakDay: WED }), dueCount: 3, sent: { review: '2026-10-05' } }).send);

head('Weekly digest');
p = plan({ today: SUN, student: stu({ streakDay: SUN }), weekQuest: { week: MON, days: 2, questions: 40, claimed: false } });
ok('Sunday: the digest goes', p.send && p.kinds.join() === 'weekly' && p.weekly.days === 2 && p.weekly.questions === 40, JSON.stringify(p.kinds));
ok('not on a weekday', !plan({ student: stu({ streakDay: WED }), weekQuest: { week: MON, days: 2, questions: 40, claimed: false } }).send);
ok('once per week', !plan({ today: SUN, student: stu({ streakDay: SUN }), weekQuest: { week: MON, days: 2, questions: 40, claimed: false }, sent: { weekly: MON } }).send);

head('Several at once → one message, in priority order');
p = plan({ today: SUN, student: stu({ streakDay: '2026-10-10' }), dueCount: 5, weekQuest: { week: MON, days: 1, questions: 10, claimed: false } });
ok('streak, weekly, review together', p.kinds.join() === 'streak,weekly,review', p.kinds.join());

head('When nothing may go out');
ok('before the window', !plan({ hour: 16 }).send);
ok('at the window\'s end', !plan({ hour: 21 }).send);
ok('the window can be moved', plan({ hour: 9, startHour: 8, endHour: 12 }).send);
ok('deactivated student', !plan({ student: stu({ active: false }) }).send);
ok('opted out', !plan({ prefs: { email: false } }).send);
ok('no student', !core.reminderPlan({ today: WED, hour: 18 }).send);
ok('dormant a month and nothing this week: silence',
  !plan({ student: stu({ streakDay: '2026-08-01' }), dueCount: 9 }).send);
ok('never practised and nothing this week: silence', !plan({ student: stu({ streak: 0, streakDay: null }), dueCount: 9 }).send);

head('The message');
var P = { kinds: ['streak', 'weekly', 'review'], streak: 6, freezes: 1, dueCount: 1,
  weekly: core.weeklyQuest({ week: MON, days: 2, questions: 30, claimed: false }, SUN) };
var links = { app: 'https://hub.example.ng/', off: 'https://hub.example.ng/api/unsubscribe?id=GOC-S-001&t=abc' };
var m = svc.composeReminder(P, { name: 'Ada Obi' }, links);
ok('subject leads with the streak', /^Your 6 days streak ends tonight/.test(m.subject), m.subject);
ok('greets by first name only', /^Hi Ada,/.test(m.text) && m.text.indexOf('Obi') === -1);
ok('says how many reviews are due, singular', /1 question is ready to review/.test(m.text), m.text);
ok('mentions the weekly progress', /2 of 5 daily quests/.test(m.text) && /30 of 100/.test(m.text));
ok('mentions the held freeze', /1 streak freeze/.test(m.text));
ok('text carries the opt-out link and the Profile route',
  m.text.indexOf(links.off) > -1 && /Profile \u2192 Study reminders/.test(m.text));
ok('html carries the opt-out link', m.html.indexOf('unsubscribe?id=GOC-S-001&amp;t=abc') > -1);
ok('review-only subject', svc.composeReminder({ kinds: ['review'], dueCount: 4 }, { name: 'X' }, links).subject === '4 questions ready to review');
ok('weekly-only subject', /^Your week/.test(svc.composeReminder({ kinds: ['weekly'], weekly: P.weekly }, { name: 'X' }, links).subject));
var done = svc.composeReminder({ kinds: ['weekly'], weekly: core.weeklyQuest({ week: MON, days: 5, questions: 0, claimed: true }, SUN) }, { name: 'X' }, links);
ok('a finished week is congratulated, not nagged', /finished this week/.test(done.text) && !/closes tonight/.test(done.text));
var evil = svc.composeReminder({ kinds: ['review'], dueCount: 1 }, { name: '<script>alert(1)</script> Bob' }, links);
ok('a hostile name cannot inject markup into the html', evil.html.indexOf('<script>') === -1);
ok('and never reaches the subject', evil.subject.indexOf('script') === -1);
ok('the SMS text is short and has the stop link', m.sms.length < 220 && m.sms.indexOf(links.off) > -1, String(m.sms.length));
ok('tokens are 32 hex chars and distinct', /^[0-9a-f]{32}$/.test(svc.newToken()) && svc.newToken() !== svc.newToken());
ok('token check is exact', svc.tokenMatches('abc', 'abc') && !svc.tokenMatches('abc', 'abd') && !svc.tokenMatches('', '') && !svc.tokenMatches('abc', 'ab'));

head('A whole sweep (fake mailbox, fake clock)');
function world(students, state, dueById, over) {
  var db = { reminderState: JSON.parse(JSON.stringify(state || {})) };
  var box = [], texts = [];
  var deps = Object.assign({
    core: core,
    readData: function () { return JSON.parse(JSON.stringify(db)); },
    writeData: function (d) { db = JSON.parse(JSON.stringify(d)); },
    withDataLock: function (fn) { return fn(); },
    listStudents: function () { return Promise.resolve(students); },
    dueCountFor: function (_db, id) { return Promise.resolve((dueById || {})[id] || 0); },
    channels: { email: true, sms: false },
    sendEmail: function (m) { box.push(m); return Promise.resolve(); },
    sendSms: function (to, t) { texts.push([to, t]); return Promise.resolve({ ok: false }); },
    publicUrl: 'https://hub.example.ng',
    log: function () {}
  }, over || {});
  return { svc: svc.createReminderService(deps), box: box, texts: texts, db: function () { return db; } };
}
var at18 = new Date(2026, 9, 7, 18, 0);

(async function () {
  var w = world([stu()], {}, {});
  var r = await w.svc.sweep(at18);
  ok('an at-risk student gets one email', r.sent === 1 && w.box.length === 1, JSON.stringify(r));
  ok('addressed to their email, with the opt-out link', w.box[0].to === 'ada@example.com' &&
    /^https:\/\/hub\.example\.ng\/api\/unsubscribe\?id=GOC-S-001&t=[0-9a-f]{32}$/.test(w.box[0].links.off), w.box[0].links && w.box[0].links.off);
  var stored = w.db().reminderState['GOC-S-001'];
  ok('the send is recorded for today', stored.sent.streak === WED);
  ok('and the stored token is the one in the link', w.box[0].links.off.indexOf(stored.token) > -1);
  r = await w.svc.sweep(at18);
  ok('a second sweep the same day sends nothing', r.sent === 0 && w.box.length === 1);
  r = await w.svc.sweep(new Date(2026, 9, 7, 19, 30));
  ok('nor an hour later', w.box.length === 1);

  w = world([stu()], {}, {});
  r = await w.svc.sweep(new Date(2026, 9, 7, 9, 0));
  ok('outside the window: nothing, and it says why', w.box.length === 0 && r.skipped === 'window', JSON.stringify(r));

  w = world([stu()], { 'GOC-S-001': { prefs: { email: false } } }, {});
  await w.svc.sweep(at18);
  ok('an opted-out student is never mailed', w.box.length === 0);

  w = world([stu({ active: false }), stu({ id: 'GOC-S-002', email: '' })], {}, {});
  await w.svc.sweep(at18);
  ok('deactivated, or without an address: not mailed', w.box.length === 0);

  w = world([stu({ streakDay: WED })], {}, { 'GOC-S-001': 7 });
  await w.svc.sweep(at18);
  ok('reviews due and nothing else: a review email', w.box.length === 1 && /7 questions ready to review/.test(w.box[0].subject), w.box[0] && w.box[0].subject);
  ok('review date recorded, streak untouched', w.db().reminderState['GOC-S-001'].sent.review === WED && !w.db().reminderState['GOC-S-001'].sent.streak);

  var probed = 0;
  w = world([stu({ streakDay: WED })], { 'GOC-S-001': { sent: { review: TUE } } }, { 'GOC-S-001': 7 },
    { dueCountFor: function () { probed++; return Promise.resolve(7); } });
  await w.svc.sweep(at18);
  ok('the heavy due-count is never worked out for someone who cannot be mailed', probed === 0 && w.box.length === 0, String(probed));

  w = world([stu()], {}, {}, { publicUrl: '' });
  r = await w.svc.sweep(at18);
  ok('without a public URL nothing is sent (no opt-out link possible)', w.box.length === 0 && r.skipped === 'no-public-url');
  w = world([stu()], {}, {}, { channels: { email: false, sms: false } });
  r = await w.svc.sweep(at18);
  ok('without a working channel nothing is sent', w.box.length === 0 && r.skipped === 'no-channel');

  w = world([stu()], {}, {}, { sendEmail: function () { return Promise.reject(new Error('smtp down')); } });
  r = await w.svc.sweep(at18);
  ok('a failed send is not recorded as sent', r.failed === 1 && !(w.db().reminderState['GOC-S-001'].sent || {}).streak, JSON.stringify(r));
  await w.svc.sweep(at18); await w.svc.sweep(at18); r = await w.svc.sweep(at18);
  ok('and is given up on after 3 tries in a day', w.db().reminderState['GOC-S-001'].fails.n === 3 && r.considered === 0, JSON.stringify(w.db().reminderState['GOC-S-001'].fails));

  var two = [stu({ id: 'GOC-S-001', email: 'bad-address' }), stu({ id: 'GOC-S-002', email: 'b@example.com' })];
  var failFirst = 0;
  w = world(two, {}, {}, { sendEmail: function (m) { failFirst++; return m.to === 'b@example.com' ? Promise.resolve() : Promise.reject(new Error('x')); } });
  r = await w.svc.sweep(at18);
  ok('a bad address is skipped and the next student is still mailed', r.sent === 1 && failFirst === 1);

  var many = [], i;
  for (i = 1; i <= 5; i++) many.push(stu({ id: 'GOC-S-00' + i, email: 'u' + i + '@example.com' }));
  w = world(many, {}, {}, { maxPerSweep: 2 });
  r = await w.svc.sweep(at18);
  ok('the per-sweep cap holds', w.box.length === 2 && r.skipped === 'cap');
  r = await w.svc.sweep(at18);
  ok('the next sweep carries on where it stopped', w.box.length === 4);

  var sunday = new Date(2026, 9, 11, 18, 0);
  var s2 = [stu({ streakDay: SUN, weekQuest: { week: MON, days: 3, questions: 55, claimed: false } })];
  w = world(s2, {}, {});
  await w.svc.sweep(sunday);
  ok('Sunday digest is emailed and its week recorded', w.box.length === 1 && /^Your week/.test(w.box[0].subject) &&
    w.db().reminderState['GOC-S-001'].sent.weekly === MON, w.box[0] && w.box[0].subject);

  w = world([stu()], { 'GOC-S-001': { prefs: { email: false, sms: true } } }, {}, { channels: { email: true, sms: true } });
  await w.svc.sweep(at18);
  ok('SMS-only student: the stub is asked, nothing is marked sent when it delivers nothing',
    w.texts.length === 1 && w.box.length === 0 && !(w.db().reminderState['GOC-S-001'].sent || {}).streak);
  ok('the real stub reports not configured', (await svc.sendSmsStub()).ok === false);

  var overlap = world([stu()], {}, {}, { sendEmail: function (m) { return new Promise(function (res) { setTimeout(function () { w.box.push(m); res(); }, 30); }); } });
  w = overlap;
  var both = await Promise.all([overlap.svc.sweep(at18), overlap.svc.sweep(at18)]);
  ok('two sweeps at once never double-send', overlap.box.length === 1 && both.some(function (x) { return x.skipped === 'busy'; }), JSON.stringify(both));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
