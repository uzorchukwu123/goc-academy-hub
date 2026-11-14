/* test-broadcast-mail.js — Phase 4, Broadcast slice 6: the reminder email.
   The rule (core.broadcastMailPlan), the message text, and a whole sweep driven with a fake mailbox and a fake clock.
   node test/test-broadcast-mail.js  */
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
var NOW = new Date(2026, 9, 7, 18, 0);
function stu(extra) {
  return Object.assign({ id: 'GOC-S-001', name: 'Ada Obi', active: true, tier: 'goc', subjects: ['Physics', 'Chemistry'],
    email: 'ada@example.com' }, extra || {});
}
function bc(extra) {
  return Object.assign({ id: 1, audience: { kind: 'goc' }, title: 'Mock exam on Friday', body: 'Bring your calculator.\nStart at 9am.',
    remind: true, sentBy: 'Mrs Staff Name', sentAt: new Date(2026, 9, 7, 10, 0).toISOString(), reached: 1 }, extra || {});
}
function plan(b, s, prefs, sent, fl, now) {
  return core.broadcastMailPlan(b || bc(), s || stu(), prefs, sent, fl, now === undefined ? NOW.getTime() : now);
}

head('The rule');
ok('a fresh broadcast to a GOC student with an address is sent', plan().send === true);
ok('reminder unticked: never emailed', plan(bc({ remind: false })).reason === 'no-reminder');
ok('a missing remind flag counts as ticked (the default)', plan(bc({ remind: undefined })).send === true);
ok('an Open student is never emailed', plan(null, stu({ tier: 'open' })).reason === 'audience');
ok('no stored tier reads as Open: not emailed', plan(null, stu({ tier: undefined })).reason === 'audience');
ok('a deactivated student is not emailed', plan(null, stu({ active: false })).reason === 'audience');
ok('a subject broadcast reaches only students taking the subject',
  plan(bc({ audience: { kind: 'subject', subject: 'Physics' } })).send &&
  plan(bc({ audience: { kind: 'subject', subject: 'Biology' } })).reason === 'audience');
ok('reminder emails switched off: not emailed', plan(null, null, { email: false }).reason === 'email-off');
ok('SMS preference alone changes nothing (email only)', plan(null, null, { sms: true }).send === true);
['', 'ada', 'a@x', 'a@x.co,b@y.co', null].forEach(function (bad) {
  ok('unusable address ' + JSON.stringify(bad) + ': not emailed', plan(null, stu({ email: bad })).reason === 'no-address');
});
ok('already emailed: not again', plan(null, null, undefined, { 'GOC-S-001': '2026-10-07' }).reason === 'already-sent');
ok('someone else being emailed does not block this student', plan(null, null, undefined, { 'GOC-S-009': '2026-10-07' }).send === true);
ok('three failures: given up', plan(null, null, undefined, undefined, { 'GOC-S-001': 3 }).reason === 'gave-up');
ok('two failures: still tries', plan(null, null, undefined, undefined, { 'GOC-S-001': 2 }).send === true);
var day = 86400000, sent = new Date(2026, 9, 7, 10, 0).getTime();
ok('older than ' + core.BROADCAST_MAIL_DAYS + ' days: never emailed', plan(null, null, undefined, undefined, undefined, sent + core.BROADCAST_MAIL_DAYS * day + 1000).reason === 'too-old');
ok('just inside the limit: emailed', plan(null, null, undefined, undefined, undefined, sent + core.BROADCAST_MAIL_DAYS * day - 1000).send === true);
ok('a broadcast dated in the future waits', plan(null, null, undefined, undefined, undefined, sent - 1000).reason === 'not-yet');
ok('a broadcast with no usable date is not emailed', plan(bc({ sentAt: 'garbage' })).reason === 'no-date');
ok('junk input fails closed', !core.broadcastMailPlan(null, stu(), {}, {}, {}, 1).send && !core.broadcastMailPlan(bc(), null, {}, {}, {}, 1).send && !core.broadcastMailPlan(bc(), { name: 'no id' }, {}, {}, {}, 1).send);

head('The message');
var links = { app: 'https://hub.example.ng/', off: 'https://hub.example.ng/api/unsubscribe?id=GOC-S-001&t=abc' };
var m = svc.composeBroadcast(bc(), stu(), links);
ok('the subject is the title', m.subject === 'Mock exam on Friday');
ok('it greets by first name and carries the message', /^Hi Ada,/.test(m.text) && m.text.indexOf('Bring your calculator.\nStart at 9am.') > -1);
ok('it is signed G.O.C Academy and never names the staff member', /G\.O\.C Academy/.test(m.text) && m.text.indexOf('Mrs Staff Name') === -1 && m.html.indexOf('Mrs Staff Name') === -1);
ok('it carries the app link and the opt-out link', m.text.indexOf(links.app) > -1 && m.text.indexOf(links.off) > -1 && m.html.indexOf('unsubscribe?id=GOC-S-001&amp;t=abc') > -1);
ok('the html keeps the line breaks', /white-space:pre-wrap/.test(m.html));
var evil = svc.composeBroadcast(bc({ title: '<script>alert(1)</script> Hi', body: 'x <img src=x onerror=alert(1)> y' }), stu({ name: '<b>Bob</b>' }), links);
ok('a hostile title, message or name cannot inject markup', evil.html.indexOf('<script>') === -1 && evil.html.indexOf('<img') === -1 && evil.html.indexOf('<b>Bob') === -1);
var bare = svc.composeBroadcast(bc(), { name: '' }, null);
ok('with no links and no name it still reads properly', /^Hello,/.test(bare.text) && /Profile/.test(bare.text) && bare.html.indexOf('href=') === -1);

head('A whole sweep (fake mailbox, fake clock)');
function world(students, data, over) {
  var db = Object.assign({ broadcasts: [bc()], broadcastMail: {}, reminderState: {} }, JSON.parse(JSON.stringify(data || {})));
  var box = [];
  var deps = Object.assign({
    core: core,
    readData: function () { return JSON.parse(JSON.stringify(db)); },
    writeData: function (d) { db = JSON.parse(JSON.stringify(d)); },
    withDataLock: function (fn) { return fn(); },
    listStudents: function () { return Promise.resolve(students); },
    dueCountFor: function () { return Promise.resolve(0); },
    channels: { email: true, sms: false },
    sendEmail: function (mm) { box.push(mm); return Promise.resolve(); },
    sendSms: function () { return Promise.resolve({ ok: false }); },
    publicUrl: 'https://hub.example.ng',
    log: function () {}
  }, over || {});
  return { svc: svc.createReminderService(deps), box: box, db: function () { return db; } };
}

(async function () {
  var w = world([stu()]);
  var r = await w.svc.broadcastSweep(NOW);
  ok('one fresh broadcast, one student: one email', r.sent === 1 && w.box.length === 1, JSON.stringify(r));
  ok('addressed to their email, subject is the title', w.box[0].to === 'ada@example.com' && w.box[0].subject === 'Mock exam on Friday');
  var tok = w.db().reminderState['GOC-S-001'].token;
  ok('the link carries the student\'s stored opt-out token', /^[0-9a-f]{32}$/.test(tok) && w.box[0].links.off.indexOf(tok) > -1);
  ok('the send is recorded against the broadcast', w.db().broadcastMail['1'].sent['GOC-S-001'] === '2026-10-07');
  r = await w.svc.broadcastSweep(NOW);
  ok('a second sweep sends nothing', r.sent === 0 && w.box.length === 1);
  r = await w.svc.broadcastSweep(new Date(2026, 9, 7, 19, 30));
  ok('nor an hour later', w.box.length === 1);

  var both = await Promise.all([world([stu()]).svc.broadcastSweep(NOW)]);
  ok('a lone sweep reports plainly', both[0].sent === 1);
  w = world([stu()]);
  var two = await Promise.all([w.svc.broadcastSweep(NOW), w.svc.broadcastSweep(NOW)]);
  ok('two sweeps at once never double-send', w.box.length === 1 && (two[0].skipped === 'busy' || two[1].skipped === 'busy'), JSON.stringify(two));

  w = world([stu()]);
  r = await w.svc.broadcastSweep(new Date(2026, 9, 7, 9, 0));
  ok('outside the evening window: nothing, and it says why', w.box.length === 0 && r.skipped === 'window');
  r = await w.svc.broadcastSweep(NOW);
  ok('and it goes out once the window opens', w.box.length === 1);

  w = world([stu()], {}, { channels: { email: false, sms: false } });
  r = await w.svc.broadcastSweep(NOW);
  ok('no email delivery switched on: nothing, nothing recorded', r.skipped === 'no-channel' && w.box.length === 0 && !w.db().broadcastMail['1']);
  w = world([stu()], {}, { publicUrl: '' });
  r = await w.svc.broadcastSweep(NOW);
  ok('no public address (no opt-out link possible): nothing', r.skipped === 'no-public-url' && w.box.length === 0);

  w = world([stu()], { broadcasts: [bc({ remind: false })] });
  await w.svc.broadcastSweep(NOW);
  ok('a broadcast sent without the reminder is never emailed', w.box.length === 0);

  w = world([stu({ id: 'A', email: 'a@x.ng' }), stu({ id: 'B', email: 'b@x.ng', tier: 'open' }), stu({ id: 'C', email: '' }),
    stu({ id: 'D', email: 'd@x.ng', active: false }), stu({ id: 'E', email: 'e@x.ng' })],
    { reminderState: { E: { prefs: { email: false } } } });
  r = await w.svc.broadcastSweep(NOW);
  ok('only the one eligible student is emailed (Open, no address, deactivated and opted-out are not)',
    w.box.length === 1 && w.box[0].to === 'a@x.ng', w.box.map(function (x) { return x.to; }).join());

  w = world([stu({ id: 'A', email: 'a@x.ng' }), stu({ id: 'B', email: 'b@x.ng', subjects: ['Biology'] })],
    { broadcasts: [bc({ audience: { kind: 'subject', subject: 'Physics' } })] });
  await w.svc.broadcastSweep(NOW);
  ok('a subject broadcast is emailed only to that subject\'s students', w.box.length === 1 && w.box[0].to === 'a@x.ng');

  w = world([stu({ id: 'A', email: 'a@x.ng' })], { broadcasts: [bc({ id: 1 }), bc({ id: 2, title: 'Second message' })] });
  r = await w.svc.broadcastSweep(NOW);
  ok('two fresh broadcasts: one email each, in the order they were sent', w.box.length === 2 && w.box[0].subject === 'Mock exam on Friday' && w.box[1].subject === 'Second message');
  ok('each is recorded separately', w.db().broadcastMail['1'].sent.A && w.db().broadcastMail['2'].sent.A);

  /* A student who was emailed an earlier broadcast still gets a new one. */
  w = world([stu()], { broadcasts: [bc({ id: 1 }), bc({ id: 2 })], broadcastMail: { '1': { sent: { 'GOC-S-001': '2026-10-07' }, fails: {} } } });
  await w.svc.broadcastSweep(NOW);
  ok('already told about #1, so only #2 goes', w.box.length === 1 && w.db().broadcastMail['2'].sent['GOC-S-001']);

  /* Failure handling. */
  var tries = 0;
  w = world([stu()], {}, { sendEmail: function () { tries++; return Promise.reject(new Error('smtp down')); } });
  r = await w.svc.broadcastSweep(NOW);
  ok('a failed send is counted, not recorded as sent', r.failed === 1 && r.sent === 0 && !w.db().broadcastMail['1'].sent['GOC-S-001'] && w.db().broadcastMail['1'].fails['GOC-S-001'] === 1);
  await w.svc.broadcastSweep(NOW); await w.svc.broadcastSweep(NOW);
  var before = tries;
  await w.svc.broadcastSweep(NOW); await w.svc.broadcastSweep(NOW);
  ok('after three failures it stops trying', before === 3 && tries === 3, 'tries=' + tries);

  w = world([stu(), stu({ id: 'GOC-S-002', email: 'b@x.ng' })], {}, { sendEmail: function (mm) { return mm.to === 'ada@example.com' ? Promise.reject(new Error('bounce')) : Promise.resolve(); } });
  r = await w.svc.broadcastSweep(NOW);
  ok('one failure does not stop the others', r.failed === 1 && r.sent === 1 && w.db().broadcastMail['1'].sent['GOC-S-002']);

  /* Cap. */
  var many = []; for (var i = 0; i < 7; i++) many.push(stu({ id: 'S' + i, email: 's' + i + '@x.ng' }));
  w = world(many, {}, { maxPerSweep: 3 });
  r = await w.svc.broadcastSweep(NOW);
  ok('the per-sweep cap holds', w.box.length === 3 && r.skipped === 'cap');
  await w.svc.broadcastSweep(NOW); await w.svc.broadcastSweep(NOW);
  ok('the rest follow on later sweeps, nobody twice', w.box.length === 7 && new Set(w.box.map(function (x) { return x.to; })).size === 7);

  /* Opting out through the study-reminder switch also stops broadcast email. */
  w = world([stu()], { reminderState: { 'GOC-S-001': { prefs: { email: false }, token: 'keep-me' } } });
  await w.svc.broadcastSweep(NOW);
  ok('the same email switch controls both', w.box.length === 0);

  /* Existing study-reminder data on the student is not disturbed. */
  w = world([stu()], { reminderState: { 'GOC-S-001': { sent: { streak: '2026-10-06' }, token: 'keep-me-0123456789abcdef01234567' } } });
  await w.svc.broadcastSweep(NOW);
  var st = w.db().reminderState['GOC-S-001'];
  ok('an existing token and sent-log are kept as they were', st.token === 'keep-me-0123456789abcdef01234567' && st.sent.streak === '2026-10-06' && w.box[0].links.off.indexOf('keep-me-0123456789abcdef01234567') > -1);

  /* Tidy-up. */
  w = world([stu()], { broadcasts: [bc({ id: 2 })], broadcastMail: { '1': { sent: { X: 'd' } }, '2': { sent: {} } } });
  await w.svc.broadcastSweep(NOW);
  ok('a record for a removed broadcast is dropped', !w.db().broadcastMail['1'] && w.db().broadcastMail['2']);
  var oldSent = new Date(2026, 9, 1, 10, 0).toISOString();
  w = world([stu()], { broadcasts: [bc({ id: 3, sentAt: oldSent })], broadcastMail: { '3': { sent: { X: 'd' } } } });
  r = await w.svc.broadcastSweep(NOW);
  ok('an old broadcast is not emailed and its record is dropped', w.box.length === 0 && !w.db().broadcastMail['3']);

  /* The study-reminder sweep is untouched by all this. */
  w = world([stu({ streak: 4, streakDay: '2026-10-06', streakFreezes: 0 })]);
  r = await w.svc.sweep(NOW);
  ok('the study-reminder sweep still runs on its own', r.sent === 1 && w.box.length === 1 && /streak/i.test(w.box[0].subject), JSON.stringify(r));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  threw: ' + (e && e.stack || e)); process.exit(1); });
