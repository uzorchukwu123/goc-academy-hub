/* reminders.js — Phase 2, Reminders: the message text and the daily sweep.

   Who gets what, and when, is decided by the pure rules in js/goc-core.js
   (core.reminderPlan). This file turns a plan into a message and sends it.
   It owns no storage and no clock of its own: server.js hands in everything it
   needs (see createReminderService), so test/test-reminders.js can drive a whole
   sweep with a fake mailbox and a fake date.

   Email is the live channel. SMS is a STUB: the hook exists (sendSms) and a
   student can hold an SMS preference, but until a provider adapter is written
   and GOC_SMS_PROVIDER names it, nothing is ever texted. */
'use strict';

var crypto = require('crypto');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function firstName(name) {
  var n = String(name || '').trim().split(/\s+/)[0] || '';
  return n.slice(0, 40);
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* The message for one plan. Pure: returns { subject, text, html, sms }.
   `links` is { app, off } — the page to open and the one-tap opt-out. */
function composeReminder(plan, student, links) {
  var kinds = plan.kinds || [];
  var name = firstName(student && student.name);
  var hello = name ? 'Hi ' + name + ',' : 'Hello,';
  var sections = [];   // [{ head, body }]
  var smsBits = [];

  if (kinds.indexOf('streak') > -1) {
    var held = plan.freezes > 0;
    sections.push({
      head: 'Your ' + plural(plan.streak, 'day', 'days') + ' streak ends tonight',
      body: 'You practised yesterday but not yet today. A short practice run before midnight keeps it going.' +
        (held ? ' You are holding ' + plural(plan.freezes, 'streak freeze', 'streak freezes') +
          ', which would cover one missed day \u2014 but why spend it?' : '')
    });
    smsBits.push('your ' + plan.streak + '-day streak ends tonight');
  }
  if (kinds.indexOf('weekly') > -1) {
    var w = plan.weekly || {};
    var body;
    if (w.done) {
      body = 'You finished this week\u2019s quest (' + plural(w.days, 'daily quest', 'daily quests') + ', ' +
        plural(w.questions, 'question', 'questions') + ' answered). Well done.';
    } else {
      body = 'This week so far: ' + w.days + ' of ' + w.targetDays + ' daily quests and ' +
        w.questions + ' of ' + w.targetQuestions + ' practice questions. Reach either target and you earn a streak freeze. ' +
        'The week closes tonight.';
    }
    sections.push({ head: 'Your week', body: body });
    smsBits.push(w.done ? 'weekly quest done' : 'weekly quest: ' + w.days + '/' + w.targetDays + ' days');
  }
  if (kinds.indexOf('review') > -1) {
    sections.push({
      head: plural(plan.dueCount, 'question is', 'questions are') + ' ready to review',
      body: 'These are questions you missed before, brought back at the right moment so they stick. ' +
        'Open Study \u2192 Review due.'
    });
    smsBits.push(plan.dueCount + ' to review');
  }

  var top = kinds[0];
  var subject = top === 'streak'
    ? 'Your ' + plural(plan.streak, 'day', 'days') + ' streak ends tonight \u2014 one quick practice keeps it'
    : top === 'weekly'
      ? 'Your week on G.O.C Academy Hub'
      : plural(plan.dueCount, 'question', 'questions') + ' ready to review';

  var offLine = links && links.off
    ? 'Turn these reminders off: ' + links.off + '\n(You can also switch them off any time in Profile \u2192 Study reminders.)'
    : 'You can switch these reminders off any time in Profile \u2192 Study reminders.';
  var text = hello + '\n\n' +
    sections.map(function (s) { return s.head + '\n' + s.body; }).join('\n\n') +
    (links && links.app ? '\n\nOpen the hub: ' + links.app : '') +
    '\n\n\u2014 G.O.C Academy\n\n' +
    'You are getting this because study reminders are on by default for every scholar.\n' + offLine + '\n';

  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">' +
    '<p>' + esc(hello) + '</p>' +
    sections.map(function (s) {
      return '<h3 style="margin:18px 0 4px;font-size:16px">' + esc(s.head) + '</h3><p style="margin:0">' + esc(s.body) + '</p>';
    }).join('') +
    (links && links.app
      ? '<p style="margin:22px 0"><a href="' + esc(links.app) + '" style="background:#0E7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Open the hub</a></p>'
      : '') +
    '<p style="color:#6b7280;font-size:12px;margin-top:28px">You are getting this because study reminders are on by default for every scholar. ' +
    (links && links.off
      ? '<a href="' + esc(links.off) + '">Turn these reminders off</a>, or do it any time in Profile \u2192 Study reminders.'
      : 'Switch them off any time in Profile \u2192 Study reminders.') +
    '</p></div>';

  var sms = 'G.O.C: ' + smsBits.join(', ') + '.' + (links && links.app ? ' ' + links.app : '') +
    (links && links.off ? ' Stop: ' + links.off : '');
  return { subject: subject, text: text, html: html, sms: sms };
}

/* The email for one broadcast. Pure: { subject, text, html }. The sender is always "G.O.C Academy" (never the
   staff member's name), the message keeps its line breaks, and every piece of text is escaped. */
function composeBroadcast(b, student, links) {
  var name = firstName(student && student.name);
  var hello = name ? 'Hi ' + name + ',' : 'Hello,';
  var title = String((b && b.title) || '').trim();
  var body = String((b && b.body) || '').trim();
  var offLine = links && links.off
    ? 'Turn these emails off: ' + links.off + '\n(You can also switch them off any time in Profile \u2192 Study reminders.)'
    : 'You can switch these emails off any time in Profile \u2192 Study reminders.';
  var text = hello + '\n\nA message from G.O.C Academy:\n\n' + title + '\n\n' + body +
    (links && links.app ? '\n\nOpen the hub: ' + links.app : '') +
    '\n\n\u2014 G.O.C Academy\n\n' +
    'You are getting this because the academy sent a message to GOC students and reminder emails are on for you.\n' + offLine + '\n';
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">' +
    '<p>' + esc(hello) + '</p>' +
    '<p style="margin:0 0 4px;color:#6b7280;font-size:13px">A message from G.O.C Academy</p>' +
    '<h3 style="margin:0 0 8px;font-size:17px">' + esc(title) + '</h3>' +
    '<p style="margin:0;white-space:pre-wrap">' + esc(body) + '</p>' +
    (links && links.app
      ? '<p style="margin:22px 0"><a href="' + esc(links.app) + '" style="background:#0E7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Open the hub</a></p>'
      : '') +
    '<p style="color:#6b7280;font-size:12px;margin-top:28px">You are getting this because the academy sent a message to GOC students and reminder emails are on for you. ' +
    (links && links.off
      ? '<a href="' + esc(links.off) + '">Turn these emails off</a>, or do it any time in Profile \u2192 Study reminders.'
      : 'Switch them off any time in Profile \u2192 Study reminders.') +
    '</p></div>';
  return { subject: title || 'A message from G.O.C Academy', text: text, html: html };
}

/* A fresh opt-out token: 128 random bits, hex. Kept with the student's
   reminder state and compared in constant time by the unsubscribe route. */
function newToken() { return crypto.randomBytes(16).toString('hex'); }
function tokenMatches(have, given) {
  var a = Buffer.from(String(have || '')), b = Buffer.from(String(given || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* The sweep. deps:
     core            js/goc-core.js
     readData()      -> the data object (read once per sweep)
     writeData(db)
     withDataLock(fn)
     listStudents()  -> Promise<student[]>
     dueCountFor(db, studentId) -> Promise<number>   spaced-repetition questions due
     channels        { email: bool, sms: bool }      which channels can actually deliver
     sendEmail({ to, subject, text, html, links }) -> Promise
     sendSms(phone, text) -> Promise<{ok}>           stub until a provider exists
     publicUrl       base URL used for links ('' = none)
     startHour/endHour  optional window override
     maxPerSweep     cap on messages in one sweep (default 200)
     log             function(msg) */
function createReminderService(deps) {
  var core = deps.core;
  var log = deps.log || function () {};
  var maxPerSweep = deps.maxPerSweep > 0 ? deps.maxPerSweep : 200;
  var MAX_FAILS_PER_DAY = 3;
  var running = false;

  function linksFor(studentId, token) {
    var base = String(deps.publicUrl || '').replace(/\/+$/, '');
    if (!base) return null;
    return {
      app: base + '/',
      off: base + '/api/unsubscribe?id=' + encodeURIComponent(studentId) + '&t=' + encodeURIComponent(token)
    };
  }

  /* One pass over every student. Safe to call as often as you like: a student
     already sent today's kinds is skipped, and nothing goes out of hours. */
  async function sweep(when) {
    var now = when instanceof Date ? when : new Date();
    var result = { considered: 0, sent: 0, failed: 0, skipped: null };
    if (running) { result.skipped = 'busy'; return result; }
    running = true;
    try {
      if (!deps.channels || (!deps.channels.email && !deps.channels.sms)) { result.skipped = 'no-channel'; return result; }
      if (!deps.publicUrl) { result.skipped = 'no-public-url'; return result; }
      var today = core.dayStamp(now), hour = now.getHours();
      var from = deps.startHour != null ? deps.startHour : core.REMINDER_START_HOUR;
      var to = deps.endHour != null ? deps.endHour : core.REMINDER_END_HOUR;
      if (!(hour >= from && hour < to)) { result.skipped = 'window'; return result; }

      var db = deps.readData();
      var students = await deps.listStudents();
      for (var i = 0; i < students.length; i++) {
        if (result.sent >= maxPerSweep) { result.skipped = 'cap'; break; }
        var s = students[i];
        if (!s || !s.id) continue;
        var st = (db.reminderState && db.reminderState[s.id]) || {};
        var base = {
          student: s, prefs: st.prefs, sent: st.sent, today: today, hour: hour,
          weekQuest: s.weekQuest, startHour: from, endHour: to
        };
        /* Cheap pass first: pretend one review is due. If even that sends
           nothing, the (heavier) real due count is never worked out. */
        var probe = core.reminderPlan(Object.assign({}, base, { dueCount: 1 }));
        var channels = probe.channels.filter(function (c) { return deps.channels[c]; });
        if (!probe.send || !channels.length) continue;
        if (st.fails && st.fails.day === today && st.fails.n >= MAX_FAILS_PER_DAY) continue;
        result.considered++;

        var due = 0;
        try { due = await deps.dueCountFor(db, s.id); } catch (e) { due = 0; }
        var plan = core.reminderPlan(Object.assign({}, base, { dueCount: due }));
        if (!plan.send) continue;

        var token = st.token || newToken();
        var links = linksFor(s.id, token);
        var msg = composeReminder(plan, s, links);
        var delivered = false, tried = false;
        if (channels.indexOf('email') > -1) {
          tried = true;
          try { await deps.sendEmail({ to: String(s.email).trim(), subject: msg.subject, text: msg.text, html: msg.html, links: links }); delivered = true; }
          catch (e) { log('[reminders] email to ' + s.id + ' failed: ' + (e && e.message)); }
        }
        if (channels.indexOf('sms') > -1) {
          tried = true;
          try {
            var r = await deps.sendSms(s.phone, msg.sms);
            if (r && r.ok) delivered = true;
          } catch (e) { log('[reminders] sms to ' + s.id + ' failed: ' + (e && e.message)); }
        }
        if (!tried) continue;

        await deps.withDataLock(async function () {
          var fresh = deps.readData();
          if (!fresh.reminderState || typeof fresh.reminderState !== 'object') fresh.reminderState = {};
          var cur = fresh.reminderState[s.id] || {};
          cur.token = cur.token || token;
          if (delivered) {
            cur.sent = Object.assign({}, cur.sent);
            if (plan.kinds.indexOf('streak') > -1) cur.sent.streak = today;
            if (plan.kinds.indexOf('weekly') > -1) cur.sent.weekly = core.weekStart(today);
            if (plan.kinds.indexOf('review') > -1) cur.sent.review = today;
            delete cur.fails;
          } else {
            var n = cur.fails && cur.fails.day === today ? cur.fails.n : 0;
            cur.fails = { day: today, n: n + 1 };
          }
          fresh.reminderState[s.id] = cur;
          deps.writeData(fresh);
          db = fresh;
        });
        if (delivered) result.sent++; else result.failed++;
      }
      return result;
    } finally {
      running = false;
    }
  }

  /* Broadcast emails (Phase 4, slice 6). Same channel, window, cap and opt-out as study reminders. The record of who
     was emailed lives in db.broadcastMail[broadcastId] = { sent: { studentId: day }, fails: { studentId: n } },
     written after each attempt, so a restart or a second sweep never sends the same broadcast to the same
     student twice. Records for removed or expired broadcasts are dropped as the sweep goes. */
  var bRunning = false;
  async function broadcastSweep(when) {
    var now = when instanceof Date ? when : new Date();
    var result = { considered: 0, sent: 0, failed: 0, skipped: null };
    if (bRunning) { result.skipped = 'busy'; return result; }
    bRunning = true;
    try {
      if (!deps.channels || !deps.channels.email) { result.skipped = 'no-channel'; return result; }
      if (!deps.publicUrl) { result.skipped = 'no-public-url'; return result; }
      var today = core.dayStamp(now), hour = now.getHours();
      var from = deps.startHour != null ? deps.startHour : core.REMINDER_START_HOUR;
      var to = deps.endHour != null ? deps.endHour : core.REMINDER_END_HOUR;
      if (!(hour >= from && hour < to)) { result.skipped = 'window'; return result; }

      var db = deps.readData();
      var fresh = (db.broadcasts || []).filter(function (b) {
        if (!b || b.remind === false) return false;
        var t = new Date(b.sentAt).getTime();
        return isFinite(t) && now.getTime() - t <= core.BROADCAST_MAIL_DAYS * 86400000;
      });
      if (!fresh.length) { await tidyBroadcastMail(now.getTime()); return result; }
      var students = await deps.listStudents();
      var at = now.getTime();

      for (var bi = 0; bi < fresh.length; bi++) {
        var b = fresh[bi];
        for (var i = 0; i < students.length; i++) {
          if (result.sent + result.failed >= maxPerSweep) { result.skipped = 'cap'; return result; }
          var s = students[i];
          if (!s || !s.id) continue;
          var state = (db.broadcastMail && db.broadcastMail[b.id]) || {};
          var rs = (db.reminderState && db.reminderState[s.id]) || {};
          var plan = core.broadcastMailPlan(b, s, rs.prefs, state.sent, state.fails, at);
          if (!plan.send) continue;
          result.considered++;

          var token = rs.token || newToken();
          var links = linksFor(s.id, token);
          var msg = composeBroadcast(b, s, links);
          var delivered = false;
          try { await deps.sendEmail({ to: String(s.email).trim(), subject: msg.subject, text: msg.text, html: msg.html, links: links }); delivered = true; }
          catch (e) { log('[broadcast mail] email to ' + s.id + ' failed: ' + (e && e.message)); }

          await deps.withDataLock(async function () {
            var cur = deps.readData();
            if (!cur.broadcastMail || typeof cur.broadcastMail !== 'object') cur.broadcastMail = {};
            if (!cur.reminderState || typeof cur.reminderState !== 'object') cur.reminderState = {};
            var rec = cur.broadcastMail[b.id] || { sent: {}, fails: {} };
            rec.sent = rec.sent || {}; rec.fails = rec.fails || {};
            if (delivered) { rec.sent[s.id] = today; delete rec.fails[s.id]; }
            else rec.fails[s.id] = (Number(rec.fails[s.id]) || 0) + 1;
            cur.broadcastMail[b.id] = rec;
            var rstate = cur.reminderState[s.id] || {};
            rstate.token = rstate.token || token;
            cur.reminderState[s.id] = rstate;
            deps.writeData(cur);
            db = cur;
          });
          if (delivered) result.sent++; else result.failed++;
        }
      }
      await tidyBroadcastMail(now.getTime());
      return result;
    } finally {
      bRunning = false;
    }
  }
  /* Drop the who-was-emailed record of any broadcast that is gone or too old to be emailed any more. */
  async function tidyBroadcastMail(nowMs) {
    var db = deps.readData();
    if (!db.broadcastMail || typeof db.broadcastMail !== 'object') return;
    var keep = {}, changed = false;
    (db.broadcasts || []).forEach(function (b) {
      var t = new Date(b && b.sentAt).getTime();
      if (b && isFinite(t) && nowMs - t <= core.BROADCAST_MAIL_DAYS * 86400000 * 2) keep[String(b.id)] = true;
    });
    Object.keys(db.broadcastMail).forEach(function (k) { if (!keep[k]) changed = true; });
    if (!changed) return;
    await deps.withDataLock(async function () {
      var cur = deps.readData();
      Object.keys(cur.broadcastMail || {}).forEach(function (k) { if (!keep[k]) delete cur.broadcastMail[k]; });
      deps.writeData(cur);
    });
  }

  return { sweep: sweep, broadcastSweep: broadcastSweep, compose: composeReminder, composeBroadcast: composeBroadcast };
}

/* Placeholder for a future text-message provider. Returns { ok:false } so the
   sweep treats it as "nothing delivered" rather than pretending. A real
   adapter replaces this function and reads its keys from the environment. */
async function sendSmsStub() {
  return { ok: false, reason: 'sms-not-configured' };
}

module.exports = { composeReminder: composeReminder, composeBroadcast: composeBroadcast, createReminderService: createReminderService,
  newToken: newToken, tokenMatches: tokenMatches, sendSmsStub: sendSmsStub };
