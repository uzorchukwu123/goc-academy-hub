/* free2027.js — the 2027 Free Tutorial Edition engine (server side).
   ----------------------------------------------------------------------------
   This file owns EVERYTHING that belongs to the temporary edition, and nothing
   else: participants and their one-time e-mail codes, the activities (weekly
   assessments and competitions), attempts and their server-side clock, the
   competition rankings and their publication, the archive of a finished
   session, and the website-mode switch.

   Deliberate boundaries (see js/goc-free-2027.js for the shared rules):

     • It never reads or writes db.students, db.attempts, db.questions,
       db.staff or any other original G.O.C record. The question BANK is
       borrowed read-only (an activity stores question IDs, and marking uses
       js/goc-core.js markAttempt), which is exactly the "reuse the existing
       CBT engine, question bank and marking system" requirement.
     • Its own records live in db.free2027, a new top-level field of the same
       data file, so they ride the existing persistence, backup and Appwrite
       blob mirror without a single new collection.
     • The archived sessions are written to their own local JSON files under
       DATA_DIR/free2027-archives/, and only an administrator route hands one
       back. Deleting that folder deletes only archived free-tutorial data.

   Nothing here decides who may call it: server/server.js holds the route table
   and its guard. This module holds the rules and the storage. */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var core = require('../../js/goc-core.js');
var rules = require('../../js/goc-free-2027.js');

/* An error the page is allowed to read verbatim (a 4xx with a written
   message). Anything else that escapes is treated as internal by the caller. */
function FreeError(status, message) {
  var e = new Error(message);
  e.status = status || 400;
  e.expected = true;
  return e;
}

/* environment switches — one central place */
function featureOffFromEnv(env) {
  var v = String((env || {}).GOC_FREE_2027 == null ? '' : env.GOC_FREE_2027).trim().toLowerCase();
  return v === '0' || v === 'off' || v === 'false' || v === 'no';
}

/* ---------------------------------------------------------------------------
   ensureEdition(db, opts) — shape db.free2027 in place.
   Called from the server's migrate() so an older data file acquires the field
   on its first boot and nothing already stored is touched. Idempotent.
   ------------------------------------------------------------------------- */
function ensureEdition(db, opts) {
  opts = opts || {};
  var env = opts.env || {};
  var ed = db.free2027;
  if (!ed || typeof ed !== 'object' || Array.isArray(ed)) ed = {};

  var envOff = featureOffFromEnv(env);
  if (ed.enabled === undefined) {
    /* A fresh install opens the edition only when the deployment asked for it
       with the central switch. */
    ed.enabled = !envOff && rules.editionDefault(env.GOC_FREE_2027) === rules.MODE_FREE;
  }
  /* The switch may be turned OFF at the deployment level at any time; turning
     it back ON is the administrator's decision on the console. */
  if (envOff) ed.enabled = false;

  ed.enabled = ed.enabled !== false;
  var courses = rules.cleanCourseList(ed.courses);
  ed.courses = courses.length ? courses : rules.DEFAULT_COURSES.slice();

  if (rules.MODES.indexOf(ed.mode) < 0) {
    ed.mode = ed.enabled ? rules.MODE_FREE : rules.MODE_ORIGINAL;
  }
  if (!Array.isArray(ed.sessions)) ed.sessions = [];
  if (!Array.isArray(ed.archives)) ed.archives = [];
  if (!Array.isArray(ed.otps)) ed.otps = [];
  /* Permanent identifier registry is scoped to this programme and survives
     session archiving/deletion. */
  if (!Array.isArray(ed.studentIds)) ed.studentIds = [];
  if (!ed.studentIdsByEmail || typeof ed.studentIdsByEmail !== 'object' || Array.isArray(ed.studentIdsByEmail)) ed.studentIdsByEmail = {};
  /* The sequential student-identifier counter. It lives on the edition record
     (not on a session) so it survives archiving, and it is seeded from every
     identifier already issued, so an older data file resumes exactly where it
     left off. Deleted identifiers stay in ed.studentIds, so they are never
     re-issued: the counter only ever moves forward. */
  if (typeof ed.studentIdSeq !== 'number' || !isFinite(ed.studentIdSeq)) {
    var maxSeq = 0;
    (ed.studentIds || []).forEach(function (id) { maxSeq = Math.max(maxSeq, rules.idSeqOf(id)); });
    (ed.sessions || []).forEach(function (s) {
      (s && s.participants || []).forEach(function (p) { if (p && p.id) maxSeq = Math.max(maxSeq, rules.idSeqOf(p.id)); });
    });
    ed.studentIdSeq = maxSeq;
  }
  /* Authenticated sessions, persisted with the rest of the programme data so
     a normal browser refresh (and even a server restart) keeps a signed-in
     student signed in. Only a SHA-256 digest of each token is stored, so the
     data file never holds a usable session credential. */
  if (!Array.isArray(ed.authSessions)) ed.authSessions = [];
  if (typeof ed.rev !== 'number') ed.rev = 0;

  /* One session always exists, so every route has somewhere to write. */
  if (!ed.sessions.length) {
    var first = rules.emptySession(1);
    ed.sessions.push(first);
    ed.currentSessionId = first.id;
  }
  var cur = ed.sessions.filter(function (s) { return s && s.id === ed.currentSessionId; })[0];
  if (!cur) { cur = ed.sessions[ed.sessions.length - 1]; ed.currentSessionId = cur.id; }
  (ed.sessions || []).forEach(function (session) {
    (session && session.participants || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (ed.studentIds.indexOf(String(p.id)) < 0) ed.studentIds.push(String(p.id));
      if (p.email && !ed.studentIdsByEmail[String(p.email).toLowerCase()]) ed.studentIdsByEmail[String(p.email).toLowerCase()] = String(p.id);
    });
  });
  ['participants', 'activities', 'attempts', 'records', 'lessons', 'audit'].forEach(function (k) {
    if (!Array.isArray(cur[k])) cur[k] = [];
  });
  ['participantSeq', 'activitySeq', 'attemptSeq', 'lessonSeq'].forEach(function (k) {
    if (typeof cur[k] !== 'number') cur[k] = 0;
  });

  db.free2027 = ed;
  return ed;
}

/* ---------------------------------------------------------------------------
   createFree2027(deps) — the service.
   deps: {
     dataDir,                    folder the archives are written to
     readData, writeData,        the hub's own data-file accessors
     withDataLock,               the hub's read-modify-write queue
     listQuestions,              the hub's question-bank reader
     deliverOtp,                 async ({email,name,code}) -> {delivered}
     now,                        () -> ms (injected so tests own the clock)
     log                         (optional) message sink
   }
   ------------------------------------------------------------------------- */
function createFree2027(deps) {
  var d = deps || {};
  var now = typeof d.now === 'function' ? d.now : function () { return Date.now(); };
  var dataDir = d.dataDir || process.cwd();
  var archiveDir = path.join(dataDir, 'free2027-archives');
  var log = typeof d.log === 'function' ? d.log : function () {};

  /* Participant sessions are PERSISTED in db.free2027.authSessions (only the
     SHA-256 digest of each token is stored). A normal browser refresh therefore
     keeps a signed-in student signed in — even across a server restart — while
     logout deletes the stored record, so a logged-out student is never silently
     signed back in and an expired/invalid token requires fresh authentication. */
  var TOKEN_HOURS = 8;
  var AUTH_SESSION_MAX = 5000;

  function readData() { return d.readData(); }
  function writeData(db) { d.writeData(db); }
  function locked(fn) {
    return typeof d.withDataLock === 'function' ? d.withDataLock(fn) : Promise.resolve().then(fn);
  }
  function edition(db) { return ensureEdition(db, { env: d.env || process.env }); }
  function currentSession(ed) {
    var cur = (ed.sessions || []).filter(function (s) { return s && s.id === ed.currentSessionId; })[0];
    if (!cur) {
      if (!ed.sessions.length) ed.sessions.push(rules.emptySession(1));
      cur = ed.sessions[ed.sessions.length - 1];
      ed.currentSessionId = cur.id;
    }
    return cur;
  }
  function requireOn(ed) {
    if (!ed.enabled) throw FreeError(404, 'The 2027 Free Tutorial Edition is not active on this site.');
    return ed;
  }

  /* ------------------------------------------------------------- utilities */

  function codeHash(salt, code) {
    var secret = String(d.otpSecret || (d.env || process.env).GOC_FREE_2027_OTP_SECRET || '');
    return crypto.createHmac('sha256', secret).update(String(salt) + ':' + String(code)).digest('hex');
  }
  function otpSecretAvailable() {
    return String(d.otpSecret || (d.env || process.env).GOC_FREE_2027_OTP_SECRET || '').length >= 32;
  }
  function sixDigits() { return String(crypto.randomInt ? crypto.randomInt(0, 1000000) : Math.floor(Math.random() * 1000000)).padStart(6, '0'); }
  function token() { return crypto.randomBytes(24).toString('hex'); }
  function tokenDigest(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }

  /* The one place a student identifier is allocated. Called ONLY from inside
     the data lock (verifyRegistration), so two simultaneous registrations are
     serialized and can never receive the same number. The counter is stored
     on the edition record and only ever moves forward; every previously issued
     identifier (including ones whose student was later deleted) is in
     ed.studentIds, and the loop skips any that are somehow still present, so a
     number is guaranteed unique and is never reused. */
  function nextStudentId(ed) {
    var used = new Set((ed.studentIds || []).map(function (id) { return String(id).toUpperCase(); }));
    (ed.sessions || []).forEach(function (session) {
      (session && session.participants || []).forEach(function (p) { if (p && p.id) used.add(String(p.id).toUpperCase()); });
    });
    var n = Math.max(Number(ed.studentIdSeq) || 0, (ed.studentIds || []).reduce(function (m, id) { return Math.max(m, rules.idSeqOf(id)); }, 0));
    var id;
    do {
      n++;
      id = rules.studentId(n);
    } while (used.has(id.toUpperCase()));
    ed.studentIdSeq = n;
    return id;
  }

  /* Passwords are hashed with scrypt + a per-password random salt, the same
     scheme the hub's own staff accounts use. Only the hash is ever stored. */
  function hashPassword(plain) {
    var salt = crypto.randomBytes(16).toString('hex');
    var key = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    return 'scrypt$' + salt + '$' + key;
  }
  function verifyPassword(plain, stored) {
    var parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    try {
      var key = crypto.scryptSync(String(plain), parts[1], 64);
      var want = Buffer.from(parts[2], 'hex');
      return key.length === want.length && crypto.timingSafeEqual(key, want);
    } catch (e) { return false; }
  }

  function findParticipant(session, id) {
    var want = String(id || '').toUpperCase();
    for (var i = 0; i < session.participants.length; i++) {
      if (String(session.participants[i].id).toUpperCase() === want) return session.participants[i];
    }
    return null;
  }
  function findParticipantByEmail(session, email) {
    var want = String(email || '').trim().toLowerCase();
    for (var i = 0; i < session.participants.length; i++) {
      if (String(session.participants[i].email || '').toLowerCase() === want) return session.participants[i];
    }
    return null;
  }
  function findActivity(session, id) {
    var want = String(id || '');
    for (var i = 0; i < session.activities.length; i++) {
      if (String(session.activities[i].id) === want) return session.activities[i];
    }
    return null;
  }
  function findAttempt(session, id) {
    var want = String(id || '');
    for (var i = 0; i < session.attempts.length; i++) {
      if (String(session.attempts[i].id) === want) return session.attempts[i];
    }
    return null;
  }
  function attemptsFor(session, activityId, participantId) {
    return session.attempts.filter(function (a) {
      return a && String(a.activityId) === String(activityId) && String(a.participantId) === String(participantId);
    });
  }
  function pushRecord(session, rec) {
    if (!Array.isArray(session.records)) session.records = [];
    session.records.unshift(Object.assign({ at: now() }, rec));
    if (session.records.length > 2000) session.records = session.records.slice(0, 2000);
  }

  /* Every participant carries a programme record of their own: the course they
     enrolled on, the access the academy granted, and their progress. A record
     written before these fields existed acquires them the first time it is
     read (and is then saved with the next write) — additive, so nothing that
     is already stored is rewritten or lost. */
  function ensureParticipantProgramme(p) {
    if (!p || typeof p !== 'object') return p;
    var seen = Number(p.verifiedAt || p.createdAt) || now();
    if (!p.enrolment || typeof p.enrolment !== 'object') {
      p.enrolment = { course: String(p.course || ''), enrolledAt: seen, status: 'enrolled' };
    }
    if (!p.access || typeof p.access !== 'object') {
      p.access = {
        programme: '2027-free-tutorial',
        grantedAt: seen,
        status: p.active === false ? 'suspended' : 'active'
      };
    }
    if (!p.progress || typeof p.progress !== 'object') p.progress = { lessons: {}, lastAt: null };
    if (!p.progress.lessons || typeof p.progress.lessons !== 'object') p.progress.lessons = {};
    return p;
  }

  /* Question records for an activity, read-only out of the hub's bank. */
  async function questionRecords(db, ids) {
    var all = await d.listQuestions({ all: true }, db);
    var byId = {};
    all.forEach(function (q) { byId[String(q.id)] = q; });
    var out = [];
    ids.forEach(function (id) {
      var q = byId[String(id)];
      if (q) out.push(q);
    });
    return out;
  }

  /* ---------------------------------------------------------------- sessions
     A free-tutorial candidate's token, persisted as a digest in the edition's
     own record. issueToken() must be called inside the data lock (both call
     sites are); sessionFromReq() checks expiry on every use. */
  function issueToken(participantId, sessionId) {
    var t = token();
    var db = readData();
    var ed = edition(db);
    if (!Array.isArray(ed.authSessions)) ed.authSessions = [];
    var t0 = now();
    ed.authSessions.push({
      tokenHash: tokenDigest(t),
      participantId: String(participantId),
      sessionId: String(sessionId),
      createdAt: t0,
      lastSeenAt: t0,
      expiresAt: t0 + TOKEN_HOURS * 3600 * 1000
    });
    /* Bound the list: drop expired records first, then the oldest. */
    ed.authSessions = ed.authSessions.filter(function (s) { return s && s.expiresAt > t0 - 86400000; });
    if (ed.authSessions.length > AUTH_SESSION_MAX) ed.authSessions = ed.authSessions.slice(-AUTH_SESSION_MAX);
    writeData(db);
    return t;
  }
  /* What the dispatcher calls for a `need: 'free'` route. Returns a sess-shaped
     object ({ token, data: { role:'free', id, sessionId } }) or null. */
  function sessionFromReq(req) {
    var auth = (req && req.headers && req.headers.authorization) || '';
    if (auth.indexOf('Bearer ') !== 0) return null;
    var t = auth.slice(7);
    if (!t) return null;
    var db = readData();
    var ed = edition(db);
    var list = ed.authSessions || [];
    var digest = tokenDigest(t);
    var t0 = now();
    var rec = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].tokenHash === digest) { rec = list[i]; break; }
    }
    if (!rec) return null;
    if (rec.expiresAt < t0) return null;   /* expired: fresh authentication required */
    return { token: t, data: { role: 'free', id: rec.participantId, sessionId: rec.sessionId } };
  }
  /* Logout / deactivation helpers. Both run inside the data lock at every call
     site. dropToken removes ONE session (the one being logged out); dropTokensFor
     removes every persisted session of a participant (deactivation, deletion). */
  function dropToken(t) {
    if (!t) return;
    var db = readData();
    var ed = edition(db);
    if (!Array.isArray(ed.authSessions)) return;
    var digest = tokenDigest(t);
    var before = ed.authSessions.length;
    ed.authSessions = ed.authSessions.filter(function (s) { return !(s && s.tokenHash === digest); });
    if (ed.authSessions.length !== before) writeData(db);
  }
  function dropTokensFor(participantId) {
    var db = readData();
    var ed = edition(db);
    if (!Array.isArray(ed.authSessions)) return;
    var before = ed.authSessions.length;
    ed.authSessions = ed.authSessions.filter(function (s) {
      return !(s && String(s.participantId) === String(participantId));
    });
    if (ed.authSessions.length !== before) writeData(db);
  }

  /* --------------------------------------------------------------- public */

  function publicConfig() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    return {
      on: ed.enabled === true,
      mode: rules.activeMode(ed, ed.enabled),
      label: rules.modeLabel(rules.activeMode(ed, ed.enabled)),
      modes: rules.MODES.slice(),
      modeLabels: rules.MODE_LABELS,
      courses: (ed.courses || []).slice(),
      screens: rules.SCREENS.slice(),
      topN: rules.PUBLIC_TOP_N,
      otp: { length: rules.OTP_LENGTH, resendSec: rules.OTP_RESEND_SEC, ttlMin: rules.OTP_TTL_MIN },
      session: { id: session.id, label: session.label, startedAt: session.startedAt }
    };
  }

  /* ---------------------------------------------------------- registration
     startRegistration: validate, then issue a code. Nothing is created yet —
     a participant only exists once an address has been proved. */
  function startRegistration(input) {
    var body = input || {};
    return locked(async function () {
      var db = readData();
      var ed = requireOn(edition(db));
      if (!otpSecretAvailable()) throw FreeError(503, 'Email verification is not configured. Contact the academy before registering.');
      var name = rules.cleanName(body.name);
      if (name.error) throw FreeError(400, name.error);
      var email = rules.cleanEmail(body.email);
      if (email.error) throw FreeError(400, email.error);
      var course = rules.cleanCourse(body.course, ed.courses);
      if (course.error) throw FreeError(400, course.error);
      /* A password is chosen at registration and kept only as a scrypt hash;
         it is what the student will log in with after the email is verified. */
      var password = rules.cleanPassword(body.password);
      if (password.error) throw FreeError(400, password.error);

      var session = currentSession(ed);
      var existing = findParticipantByEmail(session, email.email);
      if (existing && existing.active === false) {
        throw FreeError(403, 'This email address has been switched off for this programme. Contact the academy.');
      }
      if (existing && existing.verified === true) {
        /* No duplicate registrations: an address that already holds a verified
           account must log in with its password instead. */
        throw FreeError(409, 'That email address is already registered. Log in with your password instead.');
      }

      var t = now();
      var mine = (ed.otps || []).filter(function (o) { return o && o.email === email.email; });
      /* one code a minute, and a hard hourly ceiling per address */
      var last = mine.filter(function (o) { return o.createdAt > t - rules.OTP_RESEND_SEC * 1000; })[0];
      if (last) {
        var wait = Math.ceil((last.createdAt + rules.OTP_RESEND_SEC * 1000 - t) / 1000);
        throw FreeError(429, 'A code was just sent. You can ask for another in ' + wait + ' second' + (wait === 1 ? '' : 's') + '.');
      }
      var hourAgo = t - 3600 * 1000;
      if (mine.filter(function (o) { return o.createdAt > hourAgo; }).length >= rules.OTP_MAX_PER_HOUR) {
        throw FreeError(429, 'Too many codes have been sent to that address. Try again in an hour.');
      }

      var code = sixDigits();
      var salt = crypto.randomBytes(12).toString('hex');
      ed.otps.push({
        email: email.email, salt: salt, hash: codeHash(salt, code),
        name: name.name, course: course.course,
        /* The chosen password travels with the pending code as a hash, so the
           account can only be created once the address is proved AND the
           password is already safely hashed. */
        pwHash: hashPassword(password.password),
        createdAt: t, expiresAt: t + rules.OTP_TTL_MIN * 60000, tries: 0, usedAt: null
      });
      /* keep the list bounded: newest 500, and drop anything useless */
      ed.otps = ed.otps.filter(function (o) { return o && o.expiresAt > t - 86400000; }).slice(-500);
      writeData(db);

      var delivery = { delivered: false, dev: false };
      try {
        if (typeof d.deliverOtp === 'function') {
          delivery = await d.deliverOtp({ email: email.email, name: name.name, code: code });
        }
      } catch (e) {
        log('[free2027] OTP delivery failed: ' + (e && e.message ? e.message : e));
        delivery = { delivered: false, dev: false };
      }
      if (delivery.delivered !== true) {
        /* Do not turn a missing or failed sender into a fake success. The
           stored digest remains unusable unless the code reached the inbox;
           the resend window also bounds repeated delivery attempts. */
        throw FreeError(503, 'Email delivery is not configured or is temporarily unavailable. Please contact the academy or try again later.');
      }
      return {
        sent: true,
        delivered: true,
        expiresInMin: rules.OTP_TTL_MIN,
        resendInSec: rules.OTP_RESEND_SEC,
      };
    });
  }

  /* verifyRegistration: proves the address, creates/returns the participant and
     signs them in. */
  function verifyRegistration(input) {
    var body = input || {};
    return locked(async function () {
      var db = readData();
      var ed = requireOn(edition(db));
      var email = rules.cleanEmail(body.email);
      if (email.error) throw FreeError(400, email.error);
      var code = rules.cleanOtp(body.code);
      if (code.error) throw FreeError(400, code.error);

      var t = now();
      var mine = (ed.otps || []).filter(function (o) {
        return o && o.email === email.email && !o.usedAt && o.expiresAt > t;
      });
      if (!mine.length) throw FreeError(400, 'That code has expired. Ask for a new one.');
      var otp = mine[mine.length - 1];
      if (otp.tries >= rules.OTP_MAX_TRIES) {
        throw FreeError(429, 'Too many wrong tries. Ask for a new code.');
      }
      /* Compared as digests, in constant time: the stored code itself is never
         kept, so a stolen data file holds no usable one-time code. */
      if (!rules.otpMatches(codeHash(otp.salt, code.code), String(otp.hash))) {
        otp.tries = (otp.tries || 0) + 1;
        writeData(db);
        throw FreeError(403, 'That code is not right. Check your email and try again.');
      }

      /* All issued codes for the address are invalidated when any current one
         succeeds. This prevents an older resent code being replayed later. */
      (ed.otps || []).forEach(function (o) {
        if (o && o.email === email.email && !o.usedAt) o.usedAt = t;
      });
      var session = currentSession(ed);
      var p = findParticipantByEmail(session, email.email);
      if (p && p.active === false) throw FreeError(403, 'This email address has been switched off for this programme.');
      if (!p) {
        session.participantSeq = (session.participantSeq || 0) + 1;
        var emailKey = email.email.toLowerCase();
        /* A permanent, sequential identifier (GOC-F-001, GOC-F-002, …),
           allocated inside this lock so concurrent registrations can never
           collide and a removed student's number is never re-issued. An email
           that already holds an identifier in the permanent registry (for
           example a returning student after a session archive) keeps it. */
        var permanentId = ed.studentIdsByEmail[emailKey] || nextStudentId(ed);
        if (ed.studentIds.indexOf(permanentId) < 0) ed.studentIds.push(permanentId);
        ed.studentIdsByEmail[emailKey] = permanentId;
        p = {
          id: permanentId,
          name: otp.name || rules.cleanName(body.name).name || 'Candidate',
          email: email.email,
          course: otp.course || rules.cleanCourse(body.course, ed.courses).course || 'Other',
          /* Never plaintext: only the scrypt hash of the chosen password. */
          passwordHash: otp.pwHash || null,
          verified: true,
          active: true,
          createdAt: t,
          verifiedAt: t,
          lastSeenAt: t,
          /* The programme record travels with the candidate from the moment
             the address is proved: what they enrolled on, the access that was
             granted, and an empty progress sheet to fill in. */
          enrolment: { course: null, enrolledAt: t, status: 'enrolled' },
          access: { programme: '2027-free-tutorial', grantedAt: t, status: 'active' },
          progress: { lessons: {}, lastAt: null }
        };
        p.enrolment.course = String(p.course || '');
        session.participants.push(p);
        pushRecord(session, { participantId: p.id, kind: 'register' });
      } else {
        p.verified = true;
        p.lastSeenAt = t;
        p.verifiedAt = p.verifiedAt || t;
        if (!p.course && otp.course) p.course = otp.course;
        /* A record from before passwords existed acquires the hash of the
           password that was just proved with the code. */
        if (!p.passwordHash && otp.pwHash) p.passwordHash = otp.pwHash;
        ensureParticipantProgramme(p);
        pushRecord(session, { participantId: p.id, kind: 'login' });
      }
      writeData(db);
      return {
        token: issueToken(p.id, session.id),
        participant: rules.selfParticipant(p),
        session: { id: session.id, label: session.label }
      };
    });
  }

  /* login: the REAL authentication mechanism. Email + the password chosen at
     registration; the email verification code alone never authenticates anyone
     permanently. Answers identically whether the address is unknown or the
     password is wrong, so the route cannot be used to enumerate accounts. */
  function login(input) {
    var body = input || {};
    return locked(async function () {
      var db = readData();
      var ed = requireOn(edition(db));
      var email = rules.cleanEmail(body.email);
      if (email.error) throw FreeError(400, email.error);
      var pw = String(body.password == null ? '' : body.password);
      if (!pw) throw FreeError(400, 'Enter your password.');
      var session = currentSession(ed);
      var p = findParticipantByEmail(session, email.email);
      var fail = function () { throw FreeError(403, 'That email address or password is not right.'); };
      if (!p || p.verified !== true || p.active === false) fail();
      if (!p.passwordHash || !verifyPassword(pw, p.passwordHash)) fail();
      var t = now();
      p.lastSeenAt = t;
      pushRecord(session, { participantId: p.id, kind: 'login' });
      writeData(db);
      return {
        token: issueToken(p.id, session.id),
        participant: rules.selfParticipant(p),
        session: { id: session.id, label: session.label }
      };
    });
  }

  /* ------------------------------------------------------- participant side */

  function sessionForCaller(data) {
    var ed = requireOn(edition(data));
    var session = currentSession(ed);
    if (data && data.sessionId && String(data.sessionId) !== String(session.id)) {
      throw FreeError(401, 'This free tutorial session has been archived. Please register again for the new session.');
    }
    return { ed: ed, session: session };
  }

  function me(data) {
    var db = readData();
    var ctx = sessionForCallerWithDb(db, data);
    var p = findParticipant(ctx.session, data.id);
    if (!p) throw FreeError(401, 'Your registration was not found. Please verify your email again.');
    if (p.active === false) throw FreeError(403, 'This email address has been switched off for this programme.');
    return { participant: rules.selfParticipant(p), session: { id: ctx.session.id, label: ctx.session.label }, mode: rules.activeMode(ctx.ed, ctx.ed.enabled) };
  }
  function sessionForCallerWithDb(db, data) {
    var ed = requireOn(edition(db));
    var session = currentSession(ed);
    if (data && data.sessionId && String(data.sessionId) !== String(session.id)) {
      throw FreeError(401, 'This free tutorial session has been archived. Please register again for the new session.');
    }
    return { ed: ed, session: session };
  }

  /* Logout destroys THE authenticated session in use: the persisted record for
     this token is deleted, so no refresh, restart or replay of this token can
     sign the student back in — clicking Enter CBT Portal again shows the login
     interface. The client also drops its stored token, so it cannot silently
     re-authenticate either. (Deactivation/deletion by an administrator still
     removes every session of the student via dropTokensFor.) */
  function logout(data, token) {
    return locked(async function () {
      dropToken(token || (data && data.token));
      return { ok: true };
    });
  }

  /* The portal's list: weekly assessments and competitions only, each with
     where it stands for THIS candidate and nothing about anyone else. */
  function listActivities(data) {
    var db = readData();
    var ctx = sessionForCallerWithDb(db, data);
    var t = now();
    if (!t) t = Date.now();
    var p = findParticipant(ctx.session, data.id);
    if (!p) throw FreeError(401, 'Your registration was not found.');
    var rows = ctx.session.activities
      .filter(function (a) { return a && a.status !== rules.STATUS_ARCHIVED && a.published; })
      .map(function (a) {
        var mine = attemptsFor(ctx.session, a.id, p.id);
        var open = rules.openAttempt(mine, t);
        return {
          id: a.id, kind: a.kind, title: a.title,
          instructions: a.instructions || '',
          opensAt: a.opensAt, closesAt: a.closesAt,
          durationMin: a.durationMin, maxAttempts: a.maxAttempts,
          questionCount: (a.questionIds || []).length,
          state: rules.activityState(a, t),
          attemptsUsed: rules.attemptsUsed(mine),
          attemptsLeft: rules.attemptsLeft(a, mine),
          openAttemptId: open ? open.id : null,
          remainingSec: open ? rules.attemptRemainingSec(open, t) : 0,
          bestScore: mine.filter(function (x) { return x.submittedAt; })
            .reduce(function (m, x) { return Math.max(m, Number(x.score) || 0); }, -1),
          leaderboard: a.kind === rules.KIND_COMPETITION
            ? { approved: !!(a.leaderboard && a.leaderboard.approved), published: rules.leaderboardPublished(a) }
            : null
        };
      })
      .sort(function (a, b) { return (a.opensAt || 0) - (b.opensAt || 0); });
    return { activities: rows, session: { id: ctx.session.id, label: ctx.session.label }, participant: rules.selfParticipant(p) };
  }

  /* Start or resume. Resuming is the default: an interrupted paper is handed
     back with its answers and its remaining time, and no new attempt is used. */
  function startActivity(data, activityId) {
    return locked(async function () {
      var db = readData();
      var ctx = sessionForCallerWithDb(db, data);
      var t = now();
      var p = findParticipant(ctx.session, data.id);
      if (!p || p.active === false) throw FreeError(403, 'This email address has been switched off for this programme.');
      var activity = findActivity(ctx.session, activityId);
      if (!activity || !activity.published || activity.status === rules.STATUS_ARCHIVED) {
        throw FreeError(404, 'That activity is not available.');
      }
      var mine = attemptsFor(ctx.session, activity.id, p.id);
      var state = rules.activityState(activity, t);

      /* An attempt that ran out while the candidate was away is closed out
         here, with whatever answers the server already holds. It keeps the
         paper honest: the clock cannot be dodged by walking away. */
      var stale = mine.filter(function (a) { return !a.submittedAt && rules.attemptExpired(a, t); });
      if (stale.length) {
        var qs = await questionRecords(db, stale[0].questionIds || []);
        stale.forEach(function (a) { finaliseAttempt(a, qs, t, true); });
        writeData(db);
        mine = attemptsFor(ctx.session, activity.id, p.id);
      }

      if (!rules.canSit(activity, t)) {
        throw FreeError(403, 'This activity is ' + (rules.activityState(activity, t) === 'upcoming' ? 'not open yet' : 'closed') + '. Only the academy can reopen it.');
      }
      var open = rules.openAttempt(mine, t);
      if (open) {
        var openQs = await questionRecords(db, open.questionIds || []);
        return attemptPayload(ctx.session, activity, open, openQs, p, t, true);
      }
      if (rules.attemptsLeft(activity, mine) <= 0) {
        throw FreeError(403, 'You have used all ' + activity.maxAttempts + ' attempt(s) for this activity.');
      }
      var paperQs = await questionRecords(db, activity.questionIds || []);
      if (!paperQs.length) throw FreeError(409, 'This activity has no servable questions yet.');
      ctx.session.attemptSeq = (ctx.session.attemptSeq || 0) + 1;
      var attempt = {
        id: 'F27-A' + ctx.session.attemptSeq + '-' + crypto.randomBytes(3).toString('hex'),
        activityId: activity.id,
        participantId: p.id,
        questionIds: paperQs.map(function (q) { return String(q.id); }),
        responses: {},
        startedAt: t,
        durationSec: Math.round(activity.durationMin * 60),
        submittedAt: null,
        score: null, maxScore: null, percent: null, correct: null, total: null,
        timeUsedSec: null, status: 'open'
      };
      ctx.session.attempts.push(attempt);
      pushRecord(ctx.session, { participantId: p.id, kind: 'start', activityId: activity.id });
      writeData(db);
      return attemptPayload(ctx.session, activity, attempt, paperQs, p, t, false);
    });
  }

  function attemptPayload(session, activity, attempt, questions, participant, t, resumed) {
    return {
      resumed: !!resumed,
      attempt: {
        id: attempt.id,
        activityId: activity.id,
        title: activity.title,
        kind: activity.kind,
        startedAt: attempt.startedAt,
        durationSec: attempt.durationSec,
        remainingSec: rules.attemptRemainingSec(attempt, t),
        deadline: rules.attemptDeadline(attempt),
        maxAttempts: activity.maxAttempts,
        attemptsUsed: rules.attemptsUsed(attemptsFor(session, activity.id, participant.id)),
        responses: Object.assign({}, attempt.responses || {})
      },
      participant: rules.publicParticipant(participant),
      questions: questions.map(core.forStudent)
    };
  }

  /* One answer, saved on the server as it is given — that is what makes an
     interruption survivable. The value is checked against the question's own
     option count, so a hand-made request cannot inject a "correct" index. */
  function saveAnswer(data, attemptId, body) {
    return locked(async function () {
      var db = readData();
      var ctx = sessionForCallerWithDb(db, data);
      var t = now();
      var attempt = findAttempt(ctx.session, attemptId);
      if (!attempt) throw FreeError(404, 'That examination was not found.');
      if (String(attempt.participantId) !== String(data.id)) throw FreeError(403, 'That examination does not belong to you.');
      if (attempt.submittedAt) throw FreeError(409, 'That examination has already been submitted.');
      var activity = findActivity(ctx.session, attempt.activityId);
      if (!activity || !rules.canSit(activity, t)) throw FreeError(403, 'This activity is closed.');
      if (rules.attemptExpired(attempt, t)) throw FreeError(410, 'Time is up for that examination.');

      var qid = String((body && body.questionId) || '');
      if ((attempt.questionIds || []).indexOf(qid) < 0) throw FreeError(400, 'That question is not part of this paper.');
      var qs = await questionRecords(db, [qid]);
      var q = qs[0];
      if (!q) throw FreeError(404, 'That question is no longer available.');
      var value = body ? body.choice : null;
      if (value === null || value === undefined || value === '') {
        delete attempt.responses[qid];
      } else {
        var n = Number(value);
        if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n >= (q.options || []).length) {
          throw FreeError(400, 'That is not one of the options.');
        }
        attempt.responses[qid] = n;
      }
      attempt.lastAnswerAt = t;
      writeData(db);
      return { saved: true, remainingSec: rules.attemptRemainingSec(attempt, t), answered: Object.keys(attempt.responses || {}).length };
    });
  }

  /* Resume endpoint: the paper, the answers already held, the clock. */
  async function resumeAttempt(data, attemptId) {
    var db = readData();
    var ctx = sessionForCallerWithDb(db, data);
    var t = now();
    var attempt = findAttempt(ctx.session, attemptId);
    if (!attempt) throw FreeError(404, 'That examination was not found.');
    if (String(attempt.participantId) !== String(data.id)) throw FreeError(403, 'That examination does not belong to you.');
    if (attempt.submittedAt) {
      return { submitted: true, result: resultOf(attempt, ctx.session) };
    }
    var activity = findActivity(ctx.session, attempt.activityId);
    if (!activity) throw FreeError(404, 'That activity was not found.');
    var qs = await questionRecords(db, attempt.questionIds || []);
    if (rules.attemptExpired(attempt, t)) {
      /* Closing it out here rather than on the next start keeps the result
         available on a device that comes back after the clock ran out. */
      await locked(async function () {
        var db2 = readData();
        var ctx2 = sessionForCallerWithDb(db2, data);
        var a2 = findAttempt(ctx2.session, attemptId);
        if (a2 && !a2.submittedAt) {
          var qs2 = await questionRecords(db2, a2.questionIds || []);
          finaliseAttempt(a2, qs2, t, true);
          writeData(db2);
        }
      });
      var db3 = readData();
      var ctx3 = sessionForCallerWithDb(db3, data);
      var a3 = findAttempt(ctx3.session, attemptId);
      return { submitted: true, expired: true, result: a3 ? resultOf(a3, ctx3.session) : null };
    }
    return attemptPayload(ctx.session, activity, attempt, qs, findParticipant(ctx.session, data.id), t, true);
  }

  /* Marking is the hub's own: js/goc-core.js markAttempt over the real question
     records. Nothing about it is re-implemented here. */
  function finaliseAttempt(attempt, questions, t, autoClosed) {
    var marked = core.markAttempt(questions, attempt.responses || {});
    var elapsed = Math.round((t - (Number(attempt.startedAt) || t)) / 1000);
    var used = Math.max(0, Math.min(elapsed, Number(attempt.durationSec) || 0));
    attempt.submittedAt = t;
    attempt.autoSubmitted = !!autoClosed;
    attempt.timeUsedSec = used;
    attempt.status = marked.status === 'marked' ? 'marked' : 'awaiting-marking';
    attempt.score = marked.score;
    attempt.maxScore = marked.maxScore;
    attempt.percent = marked.percent;
    attempt.correct = marked.correct;
    attempt.wrong = marked.wrong;
    attempt.answered = marked.answered;
    attempt.total = marked.total;
    attempt.markedAt = t;
    return attempt;
  }

  function resultOf(attempt, session) {
    var activity = findActivity(session, attempt.activityId);
    return {
      attemptId: attempt.id,
      activityId: attempt.activityId,
      title: activity ? activity.title : '',
      kind: activity ? activity.kind : '',
      score: attempt.score,
      maxScore: attempt.maxScore,
      percent: attempt.percent,
      correct: attempt.correct,
      wrong: attempt.wrong,
      answered: attempt.answered,
      total: attempt.total,
      timeUsedSec: attempt.timeUsedSec,
      durationSec: attempt.durationSec,
      submittedAt: attempt.submittedAt,
      autoSubmitted: !!attempt.autoSubmitted,
      /* Results are immediate. A weekly assessment is private: this is the only
         place it is ever shown, and only to the candidate who sat it. */
      private: activity ? activity.kind === rules.KIND_WEEKLY : true,
      position: activity && activity.kind === rules.KIND_COMPETITION
        ? myPositionFor(session, activity, attempt.participantId)
        : null
    };
  }

  function submitAttempt(data, attemptId, body) {
    return locked(async function () {
      var db = readData();
      var ctx = sessionForCallerWithDb(db, data);
      var t = now();
      var attempt = findAttempt(ctx.session, attemptId);
      if (!attempt) throw FreeError(404, 'That examination was not found.');
      if (String(attempt.participantId) !== String(data.id)) throw FreeError(403, 'That examination does not belong to you.');
      if (attempt.submittedAt) return { alreadySubmitted: true, result: resultOf(attempt, ctx.session) };
      var activity = findActivity(ctx.session, attempt.activityId);
      if (!activity) throw FreeError(404, 'That activity was not found.');
      var qs = await questionRecords(db, attempt.questionIds || []);

      /* Answers sent with the submit are only ever used to fill gaps: the
         server's own copy wins, and each value is validated the same way an
         individual answer is. A hand-made request can neither add a question
         nor claim a mark. */
      var sent = (body && body.responses) || {};
      if (sent && typeof sent === 'object') {
        var byId = {};
        qs.forEach(function (q) { byId[String(q.id)] = q; });
        Object.keys(sent).forEach(function (qid) {
          var q = byId[String(qid)];
          if (!q) return;
          var n = Number(sent[qid]);
          if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n >= (q.options || []).length) return;
          if (attempt.responses[qid] === undefined) attempt.responses[qid] = n;
        });
      }

      finaliseAttempt(attempt, qs, t, false);
      pushRecord(ctx.session, { participantId: attempt.participantId, kind: 'submit', activityId: attempt.activityId });
      writeData(db);
      return { result: resultOf(attempt, ctx.session) };
    });
  }

  function myResults(data) {
    var db = readData();
    var ctx = sessionForCallerWithDb(db, data);
    var rows = ctx.session.attempts
      .filter(function (a) { return a && String(a.participantId) === String(data.id) && a.submittedAt; })
      .sort(function (a, b) { return (b.submittedAt || 0) - (a.submittedAt || 0); })
      .map(function (a) { return resultOf(a, ctx.session); });
    return { results: rows };
  }

  /* ------------------------------------------- the candidate's programme
     One call for the portal: who they are, what they enrolled on, the access
     they hold, how far through the lessons they are, and what their own
     quizzes add up to. Everything is read from the participant's own record
     and this session, so it survives a restart unchanged. */
  function programme(data) {
    var db = readData();
    var ctx = sessionForCallerWithDb(db, data);
    var p = findParticipant(ctx.session, data.id);
    if (!p) throw FreeError(401, 'Your registration was not found. Please verify your email again.');
    if (p.active === false) throw FreeError(403, 'This email address has been switched off for this programme.');
    ensureParticipantProgramme(p);
    var submissions = ctx.session.attempts.filter(function (a) {
      return a && String(a.participantId) === String(p.id) && a.submittedAt;
    });
    var percentSum = submissions.reduce(function (n, a) { return n + (Number(a.percent) || 0); }, 0);
    return {
      participant: rules.selfParticipant(p),
      profile: {
        id: p.id,
        name: String(p.name || ''),
        course: String(p.course || ''),
        joinedAt: Number(p.createdAt) || null,
        verifiedAt: Number(p.verifiedAt) || null,
        lastSeenAt: Number(p.lastSeenAt) || null
      },
      enrolment: {
        course: String((p.enrolment && p.enrolment.course) || p.course || ''),
        enrolledAt: Number(p.enrolment && p.enrolment.enrolledAt) || null,
        status: String((p.enrolment && p.enrolment.status) || 'enrolled')
      },
      access: {
        programme: String((p.access && p.access.programme) || '2027-free-tutorial'),
        grantedAt: Number(p.access && p.access.grantedAt) || null,
        status: String((p.access && p.access.status) || (p.active === false ? 'suspended' : 'active'))
      },
      progress: rules.progressOf(p, ctx.session.lessons),
      quizzes: {
        submitted: submissions.length,
        average: submissions.length ? Math.round(percentSum / submissions.length) : null,
        best: submissions.length ? submissions.reduce(function (m, a) { return Math.max(m, Number(a.score) || 0); }, 0) : null,
        lastAt: submissions.length ? submissions.reduce(function (m, a) { return Math.max(m, Number(a.submittedAt) || 0); }, 0) : null
      },
      session: { id: ctx.session.id, label: ctx.session.label },
      mode: rules.activeMode(ctx.ed, ctx.ed.enabled)
    };
  }

  /* A candidate marks a lesson done. Idempotent: marking it twice changes
     nothing and consumes nothing, so a double tap or a reload is harmless. */
  function completeLesson(data, lessonId) {
    return locked(async function () {
      var db = readData();
      var ctx = sessionForCallerWithDb(db, data);
      var p = findParticipant(ctx.session, data.id);
      if (!p) throw FreeError(401, 'Your registration was not found. Please verify your email again.');
      if (p.active === false) throw FreeError(403, 'This email address has been switched off for this programme.');
      ensureParticipantProgramme(p);
      var id = String(lessonId == null ? '' : lessonId).trim();
      var lesson = (ctx.session.lessons || []).filter(function (l) {
        return l && String(l.id) === id && l.active !== false;
      })[0];
      if (!lesson) throw FreeError(404, 'That lesson is not part of this programme.');
      if (p.progress.lessons[lesson.id]) {
        return { completed: true, already: true, lesson: rules.publicLesson(lesson), progress: rules.progressOf(p, ctx.session.lessons) };
      }
      var t = now();
      p.progress.lessons[lesson.id] = t;
      p.progress.lastAt = t;
      p.lastSeenAt = t;
      pushRecord(ctx.session, { participantId: p.id, kind: 'lesson', lessonId: lesson.id });
      writeData(db);
      return { completed: true, already: false, lesson: rules.publicLesson(lesson), progress: rules.progressOf(p, ctx.session.lessons) };
    });
  }

  /* --------------------------------------------------------- leaderboards */

  /* Submitted attempts of one competition, as ranking rows. */
  function rankRowsFor(session, activity) {
    var rows = session.attempts
      .filter(function (a) { return a && String(a.activityId) === String(activity.id) && a.submittedAt; })
      .map(function (a) {
        var p = findParticipant(session, a.participantId) || {};
        return {
          participantId: a.participantId,
          name: p.name || '',
          course: p.course || '',
          score: Number(a.score) || 0,
          maxScore: Number(a.maxScore) || 0,
          percent: Number(a.percent) || 0,
          timeUsedSec: Number(a.timeUsedSec) || 0,
          submittedAt: Number(a.submittedAt) || 0
        };
      });
    return rules.rankRows(rows);
  }
  function myPositionFor(session, activity, participantId) {
    return rules.myPosition(activity, session.attempts
      .filter(function (a) { return a && String(a.activityId) === String(activity.id) && a.submittedAt; })
      .map(function (a) {
        var p = findParticipant(session, a.participantId) || {};
        return { participantId: a.participantId, name: p.name || '', course: p.course || '', score: a.score, maxScore: a.maxScore, percent: a.percent, timeUsedSec: a.timeUsedSec, submittedAt: a.submittedAt };
      }), participantId);
  }

  /* The public leaderboard. Only a competition, only when the administrator has
     approved it AND published it, and only ever the top 10 rows. */
  function publicLeaderboardFor(activityId, data) {
    var db = readData();
    var ed = requireOn(edition(db));
    var session = currentSession(ed);
    var activity = findActivity(session, activityId);
    if (!activity || activity.kind !== rules.KIND_COMPETITION) throw FreeError(404, 'No competition leaderboard here.');
    if (!rules.leaderboardPublished(activity)) throw FreeError(404, 'That leaderboard has not been published.');
    var board = rules.publicLeaderboard(activity, session.attempts
      .filter(function (a) { return a && String(a.activityId) === String(activity.id) && a.submittedAt; })
      .map(function (a) {
        var p = findParticipant(session, a.participantId) || {};
        return { participantId: a.participantId, name: p.name || '', course: p.course || '', score: a.score, maxScore: a.maxScore, percent: a.percent, timeUsedSec: a.timeUsedSec, submittedAt: a.submittedAt };
      }));
    if (!board) throw FreeError(404, 'That leaderboard has not been published.');
    /* A signed-in candidate outside the top ten is shown their own position
       privately: it is never part of the public ten. */
    var mine = null;
    if (data && data.id) {
      var pos = myPositionFor(session, activity, data.id);
      if (pos) mine = { participantId: data.id, rank: pos.rank, of: pos.of, inTop: pos.inTop };
    }
    return { leaderboard: board, mine: mine, session: { id: session.id, label: session.label } };
  }

  function publishedLeaderboards() {
    var db = readData();
    var ed = requireOn(edition(db));
    var session = currentSession(ed);
    var rows = session.activities
      .filter(function (a) { return a && a.kind === rules.KIND_COMPETITION && rules.leaderboardPublished(a); })
      .map(function (a) {
        var ranked = rankRowsFor(session, a);
        return { id: a.id, title: a.title, publishedAt: (a.leaderboard && a.leaderboard.publishedAt) || 0, competitors: ranked.length, closesAt: a.closesAt };
      })
      .sort(function (a, b) { return (b.publishedAt || 0) - (a.publishedAt || 0); });
    return { leaderboards: rows };
  }

  /* ----------------------------------------------------------------- admin */

  function adminOverview() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var published = session.activities.filter(function (a) { return a && a.published && a.status !== rules.STATUS_ARCHIVED; });
    return {
      enabled: ed.enabled === true,
      mode: rules.activeMode(ed, ed.enabled),
      modes: rules.MODES.slice(),
      labels: rules.MODE_LABELS,
      session: {
        id: session.id, label: session.label, seq: session.seq,
        startedAt: session.startedAt, endedAt: session.endedAt,
        participants: session.participants.length,
        verified: session.participants.filter(function (p) { return p && p.verified; }).length,
        activities: session.activities.length,
        published: published.length,
        attempts: session.attempts.length,
        submitted: session.attempts.filter(function (a) { return a && a.submittedAt; }).length,
        lessons: (session.lessons || []).length,
        audit: (session.audit || []).length
      },
      archives: (ed.archives || []).length,
      courses: (ed.courses || []).slice(),
      otp: { length: rules.OTP_LENGTH, ttlMin: rules.OTP_TTL_MIN },
      topN: rules.PUBLIC_TOP_N
    };
  }

  /* The mode switch. `confirm` must be present: the page asks the
     administrator first, and the server insists rather than trusting the page. */
  function setMode(body) {
    var mode = rules.cleanMode(body && body.mode);
    if (!rules.MODES.length || rules.MODES.indexOf(String(body && body.mode)) < 0) {
      throw FreeError(400, 'Choose Original Mode or 2027 Free Tutorial Mode.');
    }
    if (!(body && body.confirm === true)) throw FreeError(400, 'Confirm the switch before it is applied.');
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      ed.mode = mode;
      /* Turning the edition on in the console is what "activates" it; turning
         it back to Original leaves every record exactly where it is. */
      if (mode === rules.MODE_FREE) ed.enabled = true;
      ed.rev = (ed.rev || 0) + 1;
      ed.modeChangedAt = now();
      writeData(db);
      return { mode: ed.mode, label: rules.modeLabel(ed.mode), enabled: ed.enabled };
    });
  }

  function setEdition(body) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      if (body && body.enabled !== undefined) ed.enabled = body.enabled === true;
      ed.rev = (ed.rev || 0) + 1;
      writeData(db);
      return { enabled: ed.enabled, mode: rules.activeMode(ed, ed.enabled) };
    });
  }

  function setCourses(body) {
    var list = rules.cleanCourseList((body || {}).courses);
    if (!list.length) throw FreeError(400, 'Keep at least one course on the list.');
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      ed.courses = list;
      writeData(db);
      return { courses: ed.courses.slice() };
    });
  }

  /* ------------------------------------------------------- participants */

  function listParticipants(query) {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var q = String((query && query.q) || '').trim().toLowerCase();
    var rows = session.participants
      .filter(function (p) {
        if (!p) return false;
        if (!q) return true;
        return (String(p.id) + ' ' + String(p.name) + ' ' + String(p.course)).toLowerCase().indexOf(q) > -1;
      })
      .map(function (p) {
        var mine = session.attempts.filter(function (a) { return a && String(a.participantId) === String(p.id) && a.submittedAt; });
        ensureParticipantProgramme(p);
        var prog = rules.progressOf(p, session.lessons);
        return {
          id: p.id, name: p.name,
          lessonsDone: prog.completed, lessonsTotal: prog.total, progressPercent: prog.percent,
          /* The console shows the address masked, the same as the candidate
             sees it. The CSV export is the deliberate way to obtain addresses. */
          email: rules.maskEmail(p.email),
          course: p.course, verified: p.verified === true, active: p.active !== false,
          createdAt: p.createdAt, verifiedAt: p.verifiedAt || null, lastSeenAt: p.lastSeenAt || null,
          attempts: mine.length,
          best: mine.reduce(function (m, a) { return Math.max(m, Number(a.score) || 0); }, -1)
        };
      })
      .sort(function (a, b) { return String(b.createdAt || 0) > String(a.createdAt || 0) ? -1 : 1; });
    return { participants: rows, total: rows.length, session: { id: session.id, label: session.label } };
  }

  function updateParticipant(id, body) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var p = findParticipant(session, id);
      if (!p) throw FreeError(404, 'That participant was not found.');
      if (body && body.active !== undefined) {
        p.active = body.active === true;
        if (p.active === false) dropTokensFor(p.id);
      }
      writeData(db);
      return { participant: rules.selfParticipant(p) };
    });
  }

  function deleteParticipant(id) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var p = findParticipant(session, id);
      if (!p) throw FreeError(404, 'That participant was not found.');
      session.participants = session.participants.filter(function (x) { return x.id !== p.id; });
      session.attempts = session.attempts.filter(function (a) { return String(a.participantId) !== String(p.id); });
      dropTokensFor(p.id);
      pushRecord(session, { participantId: p.id, kind: 'removed' });
      writeData(db);
      return { ok: true };
    });
  }

  /* ------------------------------------------------------ programme lessons
     Managed by the administrator (Founder and Academic Director through the
     existing question-bank capability). Lessons are the programme's own
     records; nothing is copied from the hub and nothing in the hub is written. */
  function adminLessons() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var rows = (session.lessons || []).map(rules.publicLesson);
    return { lessons: rows, total: rows.length, session: { id: session.id, label: session.label } };
  }

  function saveLesson(body, id) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var clean = rules.cleanLesson(body);
      if (clean.error) throw FreeError(400, clean.error);
      var t = now();
      var existing = id ? (session.lessons || []).filter(function (l) { return l && String(l.id) === String(id); })[0] : null;
      if (id && !existing) throw FreeError(404, 'That lesson was not found.');
      var lesson;
      if (existing) {
        existing.title = clean.lesson.title;
        existing.subject = clean.lesson.subject;
        existing.summary = clean.lesson.summary;
        if (body && body.active !== undefined) existing.active = body.active !== false;
        existing.updatedAt = t;
        lesson = existing;
      } else {
        if ((session.lessons || []).length >= rules.LESSON_MAX) {
          throw FreeError(409, 'This session already holds the maximum of ' + rules.LESSON_MAX + ' lessons.');
        }
        session.lessonSeq = (session.lessonSeq || 0) + 1;
        lesson = {
          id: rules.lessonId(session.lessonSeq),
          title: clean.lesson.title,
          subject: clean.lesson.subject,
          summary: clean.lesson.summary,
          order: (session.lessons || []).length + 1,
          active: true,
          createdAt: t,
          updatedAt: t
        };
        session.lessons.push(lesson);
      }
      writeData(db);
      return { lesson: rules.publicLesson(lesson), created: !existing };
    });
  }

  function deleteLesson(id) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var lesson = (session.lessons || []).filter(function (l) { return l && String(l.id) === String(id); })[0];
      if (!lesson) throw FreeError(404, 'That lesson was not found.');
      /* Removed from the catalogue only: a candidate's completion stamp stays
         on their own record, so deleting a lesson never rewrites history. */
      session.lessons = session.lessons.filter(function (l) { return String(l.id) !== String(lesson.id); });
      writeData(db);
      return { ok: true, id: String(lesson.id) };
    });
  }

  /* Every candidate's progress in one place, for the console. */

  function adminProgress() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var lessons = session.lessons || [];
    var rows = session.participants.filter(Boolean).map(function (p) {
      ensureParticipantProgramme(p);
      var prog = rules.progressOf(p, lessons);
      var mine = session.attempts.filter(function (a) {
        return a && String(a.participantId) === String(p.id) && a.submittedAt;
      });
      var percentSum = mine.reduce(function (n, a) { return n + (Number(a.percent) || 0); }, 0);
      return {
        id: p.id, name: String(p.name || ''), course: String(p.course || ''),
        active: p.active !== false,
        lessonsDone: prog.completed, lessonsTotal: prog.total, percent: prog.percent,
        quizzes: mine.length,
        average: mine.length ? Math.round(percentSum / mine.length) : null,
        lastAt: Number((p.progress && p.progress.lastAt) || p.lastSeenAt) || null
      };
    });
    return {
      participants: rows, total: rows.length, lessons: lessons.length,
      session: { id: session.id, label: session.label }
    };
  }

  /* -------------------------------------------------- programme audit records
     Written by the server after an administrative change succeeds. The actor
     is the staff account that made the call; nothing secret is ever stored. */
  function recordAudit(actor, action, target, detail) {
    /* Synchronous on purpose, and called from the server's response hook after
       the handler's own write has finished — exactly the pattern the hub's
       manager log already uses. A logging fault must never break the request,
       so the caller wraps it; here we only ever append. */
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var entry = rules.auditEntry(actor, action, target, detail, now());
    rules.pushAudit(session, entry);
    writeData(db);
    return entry;
  }

  function auditLog(query) {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var limit = Math.max(1, Math.min(500, Number((query && query.limit) || 100)));
    var rows = (session.audit || []).slice(0, limit);
    return { entries: rows, total: (session.audit || []).length, session: { id: session.id, label: session.label } };
  }

  /* Deliberate, administrator-only export. This is the one place a full email
     address leaves the server, and it is a file the administrator downloads. */
  function participantsCsv() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    function cell(v) {
      var s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var head = ['Participant ID', 'Full name', 'Email', 'Intended course', 'Verified', 'Active', 'Registered'];
    var lines = [head.join(',')];
    session.participants.forEach(function (p) {
      lines.push([p.id, p.name, p.email, p.course, p.verified ? 'yes' : 'no', p.active === false ? 'no' : 'yes',
        p.createdAt ? new Date(p.createdAt).toISOString() : ''].map(cell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  /* --------------------------------------------------------- activities */

  function adminActivities() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var t = now();
    return {
      activities: session.activities.map(function (a) {
        var submitted = session.attempts.filter(function (x) { return x && String(x.activityId) === String(a.id) && x.submittedAt; });
        var ranked = a.kind === rules.KIND_COMPETITION ? rankRowsFor(session, a) : [];
        return {
          id: a.id, kind: a.kind, title: a.title, instructions: a.instructions || '',
          opensAt: a.opensAt, closesAt: a.closesAt, durationMin: a.durationMin, maxAttempts: a.maxAttempts,
          questionIds: (a.questionIds || []).slice(),
          questionCount: (a.questionIds || []).length,
          status: a.status, published: !!a.published,
          reopenedAt: a.reopenedAt || null, reopenClosesAt: a.reopenClosesAt || null,
          state: rules.activityState(a, t),
          createdAt: a.createdAt, updatedAt: a.updatedAt,
          attempts: submitted.length,
          competitors: ranked.length,
          leaderboard: {
            approved: !!(a.leaderboard && a.leaderboard.approved),
            published: !!(a.leaderboard && a.leaderboard.published),
            approvedAt: (a.leaderboard && a.leaderboard.approvedAt) || null,
            publishedAt: (a.leaderboard && a.leaderboard.publishedAt) || null
          }
        };
      }).sort(function (x, y) { return (y.opensAt || 0) - (x.opensAt || 0); }),
      session: { id: session.id, label: session.label }
    };
  }

  function saveActivity(body, id) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var existing = id ? findActivity(session, id) : null;
      if (id && !existing) throw FreeError(404, 'That activity was not found.');
      if (existing && existing.status === rules.STATUS_ARCHIVED) throw FreeError(409, 'That activity belongs to an archived session.');
      var v = rules.validateActivity(body, existing || {});
      if (v.error) throw FreeError(400, v.error);
      var t = now();
      if (existing) {
        Object.assign(existing, v.rec, { updatedAt: t });
      } else {
        session.activitySeq = (session.activitySeq || 0) + 1;
        existing = Object.assign({
          id: 'F27-Q' + session.activitySeq,
          status: rules.STATUS_DRAFT,
          published: false,
          createdAt: t, updatedAt: t,
          leaderboard: { approved: false, published: false, approvedAt: null, publishedAt: null }
        }, v.rec);
        session.activities.push(existing);
      }
      writeData(db);
      return { activity: existing };
    });
  }

  /* publish / close / reopen. Reopening is the ONLY way a latecomer gets in,
     and it always carries the closing time the administrator chose — the
     opening time is never moved, so nobody can sit a paper early. */
  function setActivityState(id, action, body) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var a = findActivity(session, id);
      if (!a) throw FreeError(404, 'That activity was not found.');
      var t = now();
      var act = String(action || '');
      if (act === 'publish') {
        var v = rules.validateActivity({}, a);
        if (v.error) throw FreeError(400, v.error + ' Correct the settings before publishing.');
        a.status = rules.STATUS_PUBLISHED;
        a.published = true;
        a.publishedAt = a.publishedAt || t;
      } else if (act === 'close') {
        a.status = rules.STATUS_CLOSED;
      } else if (act === 'reopen') {
        var closes = rules.parseWhen(body && body.closesAt);
        if (closes == null) throw FreeError(400, 'Set the new closing date and time.');
        if (closes <= t) throw FreeError(400, 'The new closing time must be in the future.');
        a.status = rules.STATUS_PUBLISHED;
        a.published = true;
        a.reopenedAt = t;
        a.reopenClosesAt = closes;
        if (closes > (Number(a.closesAt) || 0)) a.closesAt = closes;
      } else {
        throw FreeError(400, 'Choose publish, close or reopen.');
      }
      a.updatedAt = t;
      writeData(db);
      return { activity: a };
    });
  }

  function deleteActivity(id) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var a = findActivity(session, id);
      if (!a) throw FreeError(404, 'That activity was not found.');
      session.activities = session.activities.filter(function (x) { return x.id !== a.id; });
      session.attempts = session.attempts.filter(function (x) { return String(x.activityId) !== String(a.id); });
      writeData(db);
      return { ok: true };
    });
  }

  /* A leaderboard becomes public only when the administrator approves it AND
     publishes it. Both are separate calls, so a mis-click cannot expose a
     board, and unpublishing is one call too. */
  function leaderboardAction(id, action) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      var a = findActivity(session, id);
      if (!a) throw FreeError(404, 'That activity was not found.');
      if (a.kind !== rules.KIND_COMPETITION) throw FreeError(400, 'Only a competition has a leaderboard.');
      if (!a.leaderboard) a.leaderboard = { approved: false, published: false };
      var t = now();
      var act = String(action || '');
      if (act === 'approve') {
        a.leaderboard.approved = true;
        a.leaderboard.approvedAt = t;
      } else if (act === 'publish') {
        if (!a.leaderboard.approved) throw FreeError(400, 'Approve the leaderboard before publishing it.');
        a.leaderboard.published = true;
        a.leaderboard.publishedAt = t;
      } else if (act === 'unpublish') {
        a.leaderboard.published = false;
        a.leaderboard.unpublishedAt = t;
      } else if (act === 'revoke') {
        a.leaderboard.approved = false;
        a.leaderboard.published = false;
      } else {
        throw FreeError(400, 'Choose approve, publish, unpublish or revoke.');
      }
      writeData(db);
      return { leaderboard: a.leaderboard, publicNow: rules.leaderboardPublished(a), rows: rankRowsFor(session, a).length };
    });
  }

  function activityResults(id) {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var a = findActivity(session, id);
    if (!a) throw FreeError(404, 'That activity was not found.');
    var ranked = rankRowsFor(session, a);
    var rows = session.attempts
      .filter(function (x) { return x && String(x.activityId) === String(a.id) && x.submittedAt; })
      .sort(function (x, y) { return (y.submittedAt || 0) - (x.submittedAt || 0); })
      .map(function (x) {
        var p = findParticipant(session, x.participantId) || {};
        return {
          attemptId: x.id, participantId: x.participantId, name: p.name || '', course: p.course || '',
          score: x.score, maxScore: x.maxScore, percent: x.percent,
          timeUsedSec: x.timeUsedSec, submittedAt: x.submittedAt, autoSubmitted: !!x.autoSubmitted,
          rank: (ranked.filter(function (r) { return r.participantId === x.participantId; })[0] || {}).rank || null
        };
      });
    return {
      activity: { id: a.id, title: a.title, kind: a.kind, state: rules.activityState(a, now()), status: a.status,
        leaderboard: a.leaderboard || null, publicNow: rules.leaderboardPublished(a) },
      rows: rows,
      top: ranked.slice(0, rules.PUBLIC_TOP_N),
      ranked: ranked.length,
      records: session.records.filter(function (r) { return String(r.activityId) === String(a.id); }).slice(0, 200)
    };
  }

  function attemptDetail(id) {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    var a = findAttempt(session, id);
    if (!a) throw FreeError(404, 'That examination was not found.');
    var p = findParticipant(session, a.participantId) || {};
    return {
      attempt: Object.assign({}, a, { responses: Object.assign({}, a.responses || {}) }),
      participant: { id: p.id, name: p.name, course: p.course },
      activity: (function () { var x = findActivity(session, a.activityId); return x ? { id: x.id, title: x.title, kind: x.kind } : null; })()
    };
  }

  /* Session records: who verified, started and submitted, newest first. */
  function sessionRecords() {
    var db = readData();
    var ed = edition(db);
    var session = currentSession(ed);
    return {
      session: { id: session.id, label: session.label, startedAt: session.startedAt },
      records: (session.records || []).slice(0, 500).map(function (r) {
        var p = findParticipant(session, r.participantId) || {};
        return { at: r.at, kind: r.kind, participantId: r.participantId, name: p.name || '', activityId: r.activityId || null };
      })
    };
  }

  /* ---------------------------------------------------------- archiving
     Starting a new session writes the whole of the current one to a local JSON
     file, then begins again with empty arrays. Nothing outside db.free2027 is
     read or written, so the original G.O.C records cannot be affected. */

  function archiveDirEnsure() {
    try { fs.mkdirSync(archiveDir, { recursive: true }); } catch (e) { /* already there */ }
    return archiveDir;
  }

  function safeArchiveName(file) {
    var name = String(file || '');
    if (!/^free2027-archive-[A-Za-z0-9_-]+\.json$/.test(name)) return null;
    return name;
  }

  function startSession(body) {
    return locked(async function () {
      var db = readData();
      var ed = edition(db);
      var session = currentSession(ed);
      if (!(body && body.confirm === true)) {
        throw FreeError(400, 'Confirm that the current session should be archived before starting a new one.');
      }
      var label = rules.cleanSessionLabel(body && body.label);
      var dir = archiveDirEnsure();
      var file = rules.archiveName(session.id);
      var payload = {
        kind: 'goc-free2027-archive',
        version: 1,
        archivedAt: new Date(now()).toISOString(),
        session: JSON.parse(JSON.stringify(session)),
        counts: {
          participants: session.participants.length,
          activities: session.activities.length,
          attempts: session.attempts.length,
          submissions: session.attempts.filter(function (a) { return a && a.submittedAt; }).length
        }
      };
      var text = JSON.stringify(payload, null, 2);
      var full = path.join(dir, file);
      var tmp = full + '.tmp';
      try {
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, full);
      } catch (e) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) {}
        throw FreeError(500, 'The previous session could not be archived, so nothing was changed. Check the data folder is writable.');
      }

      /* Retain permanent student IDs when session records move to the archive. */
      (session.participants || []).forEach(function (p) {
        if (!p || !p.id) return;
        if (ed.studentIds.indexOf(String(p.id)) < 0) ed.studentIds.push(String(p.id));
        if (p.email && !ed.studentIdsByEmail[String(p.email).toLowerCase()]) ed.studentIdsByEmail[String(p.email).toLowerCase()] = String(p.id);
      });
      /* Record the archive, then start the new session with fresh records. */
      ed.archives = (ed.archives || []).filter(function (a) { return a && a.file !== file; });
      ed.archives.unshift({
        file: file, sessionId: session.id, label: session.label,
        archivedAt: now(), bytes: Buffer.byteLength(text),
        counts: payload.counts
      });
      var next = rules.emptySession((Number(ed.sessions.reduce(function (m, s) { return Math.max(m, Number(s && s.seq) || 0); }, 0)) || 0) + 1);
      next.label = label;
      next.startedAt = now();
      ed.sessions = [next];
      ed.currentSessionId = next.id;
      /* One-time codes belong to the session that issued them. */
      ed.otps = [];
      ed.rev = (ed.rev || 0) + 1;
      writeData(db);
      return {
        ok: true,
        archive: { file: file, counts: payload.counts, bytes: Buffer.byteLength(text) },
        session: { id: next.id, label: next.label, startedAt: next.startedAt }
      };
    });
  }

  /* The administrator's list of archives: the index kept with the data, plus
     any file found in the folder (so a lost index does not hide an archive). */
  function listArchives() {
    var db = readData();
    var ed = edition(db);
    var onDisk = [];
    try {
      onDisk = fs.readdirSync(archiveDirEnsure()).filter(function (f) { return /^free2027-archive-.*\.json$/.test(f); });
    } catch (e) { onDisk = []; }
    var byFile = {};
    (ed.archives || []).forEach(function (a) { if (a && a.file) byFile[a.file] = a; });
    var rows = onDisk.map(function (f) {
      var idx = byFile[f] || {};
      var bytes = 0;
      try { bytes = fs.statSync(path.join(archiveDir, f)).size; } catch (e) {}
      return {
        file: f, sessionId: idx.sessionId || '', label: idx.label || f,
        archivedAt: idx.archivedAt || null, bytes: bytes,
        counts: idx.counts || {}
      };
    });
    /* An index entry whose file is gone is still reported, so a missing archive
       is visible rather than silently dropped. */
    (ed.archives || []).forEach(function (a) {
      if (a && a.file && onDisk.indexOf(a.file) < 0) {
        rows.push({ file: a.file, sessionId: a.sessionId || '', label: a.label || a.file, archivedAt: a.archivedAt || null, bytes: 0, counts: a.counts || {}, missing: true });
      }
    });
    rows.sort(function (a, b) { return (b.archivedAt || 0) - (a.archivedAt || 0); });
    return { archives: rows, folder: 'free2027-archives' };
  }

  function readArchive(file) {
    var name = safeArchiveName(file);
    if (!name) throw FreeError(400, 'That is not an archive file name.');
    var full = path.join(archiveDirEnsure(), name);
    if (!fs.existsSync(full)) throw FreeError(404, 'That archive is not on this server.');
    try {
      return { file: name, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
    } catch (e) {
      throw FreeError(500, 'That archive file could not be read.');
    }
  }

  /* -------------------------------------------------------- console notes
     Everything the console should be able to say about the mode on the sign-in
     screen: whether the edition is on, and which mode the public site is in. */
  function modeInfo() {
    var db = readData();
    var ed = edition(db);
    return { on: ed.enabled === true, mode: rules.activeMode(ed, ed.enabled), label: rules.modeLabel(rules.activeMode(ed, ed.enabled)) };
  }

  return {
    rules: rules,
    ensureEdition: ensureEdition,
    featureOffFromEnv: featureOffFromEnv,
    publicConfig: publicConfig,
    modeInfo: modeInfo,
    /* registration */
    startRegistration: startRegistration,
    verifyRegistration: verifyRegistration,
    login: login,
    /* participant */
    sessionFromReq: sessionFromReq,
    me: me,
    logout: logout,
    listActivities: listActivities,
    startActivity: startActivity,
    saveAnswer: saveAnswer,
    resumeAttempt: resumeAttempt,
    submitAttempt: submitAttempt,
    myResults: myResults,
    /* leaderboards */
    publicLeaderboardFor: publicLeaderboardFor,
    publishedLeaderboards: publishedLeaderboards,
    /* admin */
    adminOverview: adminOverview,
    /* programme records: the candidate's own view, lessons, progress, audit */
    programme: programme,
    completeLesson: completeLesson,
    adminLessons: adminLessons,
    saveLesson: saveLesson,
    deleteLesson: deleteLesson,
    adminProgress: adminProgress,
    recordAudit: recordAudit,
    auditLog: auditLog,
    setMode: setMode,
    setEdition: setEdition,
    setCourses: setCourses,
    listParticipants: listParticipants,
    updateParticipant: updateParticipant,
    deleteParticipant: deleteParticipant,
    participantsCsv: participantsCsv,
    adminActivities: adminActivities,
    saveActivity: saveActivity,
    setActivityState: setActivityState,
    deleteActivity: deleteActivity,
    leaderboardAction: leaderboardAction,
    activityResults: activityResults,
    attemptDetail: attemptDetail,
    sessionRecords: sessionRecords,
    startSession: startSession,
    listArchives: listArchives,
    readArchive: readArchive,
    /* tests only: let a suite point the archive folder somewhere disposable */
    _archiveDir: archiveDir
  };
}

module.exports = {
  FreeError: FreeError,
  ensureEdition: ensureEdition,
  featureOffFromEnv: featureOffFromEnv,
  createFree2027: createFree2027
};
