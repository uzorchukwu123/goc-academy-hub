/* ============================================================================
   G.O.C Academy Hub — server
   ----------------------------------------------------------------------------
   A small, dependency-free Node server. Nothing to install: if you have Node,
   you can run it.

       node server/server.js
       then open http://localhost:8080

   What it does
     · serves the app files (index.html, css, js, icons)
     · answers /api/* with real data from server/data.json
     · hashes passwords with scrypt — no plaintext password is ever stored
     · issues session tokens that expire, and checks the role on every request

   Storage
     Local mode uses server/data.json. Production mode uses one JSON backup file
     in Appwrite Storage, while the app keeps its working copy in memory.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadEnv, createAppwriteClient, hasAppwriteConfig } = require('./lib/appwrite');

/* busboy is only needed by the two multipart file-upload endpoints below.
   Loading it lazily (on first actual upload) keeps the rest of the server
   genuinely dependency-free, as the header comment promises: the process
   can boot and serve every non-upload route without node_modules/busboy
   present at all. */
let Busboy = null;
function getBusboy() {
  if (!Busboy) Busboy = require('busboy');
  return Busboy;
}

loadEnv();

/* The same domain rules the browser loads. Marking, the performance
   calculation and the league order are therefore computed by identical code on
   both sides — they cannot drift apart. */
const core = require('../js/goc-core.js');

function setEnvSecret(key, value) {
  const cleanKey = String(key || '').trim();
  const cleanValue = String(value == null ? '' : value);

  if (!/^[A-Z0-9_]+$/.test(cleanKey)) {
    throw new Error('Invalid environment variable name.');
  }
  if (/[\r\n]/.test(cleanValue)) {
    throw new Error('Password cannot contain a newline.');
  }

  const envPath = path.join(ROOT, '.env');
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const escaped = JSON.stringify(cleanValue);

  const line = `${cleanKey}=${escaped}`;
  const pattern = new RegExp(`^${cleanKey}=.*$`, 'm');

  if (pattern.test(text)) {
    text = text.replace(pattern, line);
  } else {
    if (text && !text.endsWith('\n')) text += '\n';
    text += line + '\n';
  }

  fs.writeFileSync(envPath, text, { mode: 0o600 });
  process.env[cleanKey] = cleanValue;
}


const ROOT = path.resolve(__dirname, '..');          // the GOC-Web-App folder
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const PORT = Number(process.env.PORT) || 8080;
const SESSION_HOURS = 8;                             // hard ceiling for staff

/* ------------------------------------------------------------------ storage */

/* Appwrite mode stores the same single JSON document in Storage. This keeps the
   existing route and data model intact while the structured Students table is
   available for a later reporting/query layer. */
const appwriteConfig = loadEnv();
const APPWRITE_ENDPOINT = appwriteConfig.endpoint;
const APPWRITE_PROJECT_ID = appwriteConfig.projectId;
const APPWRITE_API_KEY = appwriteConfig.apiKey;
const APPWRITE_BUCKET_ID = appwriteConfig.bucketId;
const APPWRITE_FILE_ID = appwriteConfig.fileId;
const APPWRITE_DATABASE_ID = 'goc_academy';
const APPWRITE_STUDENTS_COLLECTION_ID = 'students';
const APPWRITE_RESOURCES_COLLECTION_ID = 'resources';
const APPWRITE_VIDEOS_COLLECTION_ID = 'videos';
const APPWRITE_LIVECLASSES_COLLECTION_ID = 'liveclasses';
const APPWRITE_COHORTS_COLLECTION_ID = 'cohorts';
let appwriteStorage = null;
let appwriteResourcesStorage = null;
let appwriteDatabases = null;
let appwriteUsers = null;
let CACHE = null;
let appwriteSaveChain = Promise.resolve();

async function createAppwriteAuthUser(rec) {
  if (!appwriteUsers) throw new Error('Appwrite Auth is not initialized.');

  const authEmail = rec.id.toLowerCase() + '@gocacademy.com';

  return appwriteUsers.create(
    'unique()',
    authEmail,
    undefined,
    rec.plainPassword,
    rec.name
  );
}

async function deleteAppwriteAuthUser(userId) {
  if (!appwriteUsers || !userId) return;
  try {
    await appwriteUsers.delete(userId);
  } catch (err) {
    console.error('[goc] Failed to clean up Appwrite Auth user:', err.message);
  }
}

async function createAppwriteStudent(rec) {
  if (!appwriteDatabases) throw new Error('Appwrite Database is not initialized.');

  return appwriteDatabases.upsertDocument(
    APPWRITE_DATABASE_ID,
    APPWRITE_STUDENTS_COLLECTION_ID,
    rec.id,
    {
      scholarId: rec.id,
      name: rec.name,
      email: rec.email || null,
      phone: rec.phone || null,
      passwordHash: rec.pwHash,
      exam: rec.exam,
      subjects: JSON.stringify(rec.subjects || []),
      active: rec.active !== false,
      xp: Number(rec.xp || 0),
      streak: Number(rec.streak || 0),
      streakDay: rec.streakDay || null,
      pwHash: rec.pwHash,
      must_change_password: !!rec.mustChangePassword,
      goal: rec.goal || '',
      last: rec.last || null,
      tag: rec.tag || null,
      tl: rec.tl || null,
      practiceXpDay: rec.practiceXpDay || null,
      practiceXpToday: Number(rec.practiceXpToday || 0),
      studyDay: rec.studyDay || null,
      studySecToday: Number(rec.studySecToday || 0),
      appwriteUserId: rec.appwriteUserId || null
    }
  );
}

async function getAppwriteStudent(studentId) {
  if (!appwriteDatabases) {
    throw new Error('Appwrite Database is not initialized.');
  }

  const doc = await appwriteDatabases.getDocument(
    APPWRITE_DATABASE_ID,
    APPWRITE_STUDENTS_COLLECTION_ID,
    studentId
  );

  return appwriteStudentToRecord(doc);
}

function appwriteStudentToRecord(doc) {
  return {
    id: doc.scholarId || doc.$id,
    name: doc.name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    passwordHash: doc.passwordHash || doc.pwHash || '',
    pwHash: doc.pwHash || doc.passwordHash || '',
    exam: doc.exam || core.EXAM,
    subjects: Array.isArray(doc.subjects)
      ? doc.subjects
      : (() => {
          try { return JSON.parse(doc.subjects || '[]'); }
          catch (_) { return []; }
        })(),
    active: doc.active !== false,
    xp: Number(doc.xp || 0),
    streak: Number(doc.streak || 0),
    streakDay: doc.streakDay || null,
    mustChangePassword: !!doc.must_change_password,
    goal: doc.goal || '',
    last: doc.last || null,
    tag: doc.tag || null,
    tl: doc.tl || null,
    practiceXpDay: doc.practiceXpDay || null,
    practiceXpToday: Number(doc.practiceXpToday || 0),
    studyDay: doc.studyDay || null,
    studySecToday: Number(doc.studySecToday || 0),
    appwriteUserId: doc.appwriteUserId || null,
    cohort: doc.cohort || null,
    createdAt: doc.$createdAt || null,
    lastSeenAt: doc.lastSeenAt || null
  };
}

function readData() {
  if (appwriteStorage) {
    // Hand back a fresh copy each time, exactly like re-reading the file would,
    // so a caller that mutates its copy cannot disturb the shared one by accident.
    return migrate(JSON.parse(JSON.stringify(CACHE)));
  }
  return migrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
}

/* An existing data.json from an earlier release is upgraded in place: new
   fields are added, nothing already stored is removed or overwritten. This is
   why deactivating a student, or any later change, never costs history. */
function migrate(db) {
  db.settings = db.settings || {};
  if (db.settings.sessionMinutes == null) db.settings.sessionMinutes = core.SESSION_DEFAULT;
  if (db.settings.sessionWarnMinutes == null) db.settings.sessionWarnMinutes = core.WARN_DEFAULT;
  if (!db.settings.perfWeights) db.settings.perfWeights = Object.assign({}, core.DEFAULT_WEIGHTS);
  /* Phase 4 data-integrity fix: a data.json that predates the console
     passcode feature (or was hand-edited/restored from an old backup
     without this field) had no lazy fallback the way signupCodeHash gets
     via signupCodeStored() below — db.settings.consolePasscodeHash would
     stay undefined forever, and verifyPassword(anything, undefined) always
     returns false, permanently locking the console out on that install
     with no way back in except editing the file by hand. Same seeded
     default as a brand-new install (GOC_PASSCODE env var, else '2027'),
     applied once, the same way every other missing-settings-field default
     above already is. */
  if (!db.settings.consolePasscodeHash) {
    var defaultPasscode = process.env.GOC_PASSCODE || '2027';
    db.settings.consolePasscodeHash = hashPassword(defaultPasscode);
    db.settings.consolePasscodeLength = String(defaultPasscode).length;
  } else if (process.env.GOC_PASSCODE &&
             process.env.GOC_PASSCODE !== '2027' &&
             verifyPassword('2027', db.settings.consolePasscodeHash)) {
    /* A previous release may have persisted the published 2027 default.
       If a real GOC_PASSCODE is now configured, migrate only that default.
       Never overwrite a passcode that management has intentionally changed. */
    db.settings.consolePasscodeHash = hashPassword(process.env.GOC_PASSCODE);
    db.settings.consolePasscodeLength = String(process.env.GOC_PASSCODE).length;
    db.settings.passcodeChangedAt = new Date().toISOString();
    db.settings.passcodeChangedBy = 'environment-migration';
  } else if (process.env.GOC_SIGNUP_CODE &&
             core.normalizeSignupCode(process.env.GOC_SIGNUP_CODE) !== core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT) &&
             verifyPassword(
               core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT),
               db.settings.signupCodeHash
             )) {
    /* A previous release may have persisted the published signup default.
       If a real GOC_SIGNUP_CODE is now configured, migrate only that default.
       Never overwrite a signup code that management has intentionally changed. */
    var configuredSignupCode = core.normalizeSignupCode(process.env.GOC_SIGNUP_CODE);
    var signupCheck = core.validateSignupCode(configuredSignupCode);
    if (!signupCheck.error) {
      db.settings.signupCodeHash = hashPassword(configuredSignupCode);
      db.settings.signupCodeLength = configuredSignupCode.length;
      db.settings.signupCodeChangedAt = new Date().toISOString();
      db.settings.signupCodeChangedBy = 'environment-migration';
    }
  }
  /* The objective sitting: one clock for the whole combination, and an optional
     per-paper count management may lower below the UTME ceiling. */
  if (db.settings.objectiveMinutes == null) db.settings.objectiveMinutes = core.OBJ_MIN_DEFAULT;
  if (!db.settings.objectiveCounts) db.settings.objectiveCounts = {};
  /* Question Bank persistence:
   - A missing questions field means this is a fresh/legacy data file, so seed it once.
   - An existing empty array is intentional: staff may have deleted every question.
     Never repopulate a question bank that management deliberately emptied. */
if (!Array.isArray(db.questions)) db.questions = core.seedQuestions();
  if (!Array.isArray(db.attempts)) db.attempts = [];
  /* Reading-mode notes. Seeded once so a fresh install has something to read,
     then owned by the academy: anything management adds or imports lives here
     beside the question bank and is never overwritten by a later release. */
  if (!Array.isArray(db.notes) || !db.notes.length) db.notes = core.seedNotes();
  /* Topics management has declared but nothing carries yet — the only place a
     topic label can exist without a question or a note behind it. */
  if (!Array.isArray(db.topics)) db.topics = [];
  /* Homepage "Talk to G.O.C Academy" form submissions — kept even though the
     primary delivery path (js/api.js sendContact) mails the academy inbox
     directly, so a message still exists here if that relay is ever
     unreachable from a visitor's network. */
  if (!Array.isArray(db.contactMessages)) db.contactMessages = [];
  /* Task 3 (second half) — the daily affirmation pool used to be a hard-coded
     array baked into js/app.js with no admin control at all. It now lives
     here, seeded once with those same seven strings so an upgrading install
     keeps showing exactly what students were already seeing, and from then
     on is owned entirely by the academy the same way updates/notes are. */
  if (!Array.isArray(db.affirmations) || !db.affirmations.length) {
    db.affirmations = [
      "I am a purpose-driven scholar. Today I study with focus.",
      "Every question I attempt makes me sharper.",
      "I don't chase luck — I build mastery, one topic at a time.",
      "My effort today is my score tomorrow.",
      "I can understand anything if I take it step by step.",
      "Small steps, every single day, become big results.",
      "I study to understand, not just to pass."
    ];
  }
  if (db.settings.noteSeq == null) {
    db.settings.noteSeq = db.notes.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  }
  if (db.settings.questionSeq == null) {
    db.settings.questionSeq = db.questions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  }
  if (db.settings.attemptSeq == null) db.settings.attemptSeq = 0;
  /* The academy used to publish a weekly paper and a monthly one; it publishes
     one test. Stored records keep reading cleanly either way — nothing filters
     on the field any more — but rewriting them here means the console and the
     results table never show a student the word "weekly" again.
     Removal condition: this rewrites the field in place every time migrate()
     runs, so it is already a no-op for any file that has been booted once
     against this code — it never needs a second pass on the same record. Safe
     to delete once every environment this app is deployed to has had its
     data.json through at least one boot on a version carrying this line (in
     practice: any time after this fix ships, short of someone restoring a
     pre-fix backup directly over a live file without booting first). */
  const legacyPeriod = v => core.LEGACY_PERIODS.indexOf(String(v)) > -1 || !v;
  db.questions.forEach(q => { if (legacyPeriod(q.period)) q.period = core.PERIOD; });
  db.attempts.forEach(a => { if (legacyPeriod(a.period)) a.period = core.PERIOD; });
  (db.students || []).forEach(s => {
    if (s.active == null) s.active = true;
    if (s.xp == null) s.xp = 0;
    if (s.streak == null) s.streak = 0;
    if (s.streakDay === undefined) s.streakDay = null;
    if (s.cohort === undefined) s.cohort = null;
    if (!Array.isArray(s.subjects) || s.subjects.length !== 4) {
      // Registered before subject combinations existed: give the default UTME
      // four so nothing in the dashboard is left without a subject list.
      s.subjects = [core.ENGLISH, 'Physics', 'Chemistry', 'Mathematics'];
    }
    s.exam = core.EXAM;
  });
  return db;
}

/* File mode: written via a temp file + rename. Appwrite mode keeps request
   changes in memory until explicit persistence is added later. */
function writeData(db) {
  if (appwriteStorage) {
    CACHE = db;
    return;
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* writeFileSync + renameSync alone keeps the file itself from ever being left
   half-written, but it does not stop a lost update: a handler that awaits an
   Appwrite call between readData() and writeData() leaves a window where a
   second concurrent request can read the same on-disk snapshot, and whichever
   of the two writes second silently discards the first one's change — the
   file stays valid JSON throughout, so nothing throws or logs an error, a
   submitted paper or an XP award just quietly never lands. This is an
   in-process queue (a simple promise chain) that any route with an await
   between its read and its write can use to hold that whole cycle as one
   unit, so a second request's cycle only starts once the first has finished
   writing. It only protects call sites that opt in by wrapping their
   read-modify-write in it — see the test-submit and theory-marking routes. */
let dataLock = Promise.resolve();
function withDataLock(fn) {
  const run = dataLock.then(fn, fn);
  dataLock = run.then(() => {}, () => {});
  return run;
}

/* ---------------------------------------------------------------- passwords */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + key;
}

function verifyPassword(plain, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const key = crypto.scryptSync(String(plain), parts[1], 64);
  const want = Buffer.from(parts[2], 'hex');
  // Constant-time compare, so response timing cannot leak the password.
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

/* The create-account firewall. A database written before this rule existed has no
   code stored, so the published default is written in on first use rather than
   leaving the form open to anyone — the readme says to change it before a cohort
   registers, and the console can. */
function signupCodeStored(db) {
  if (!db.settings.signupCodeHash) {
    db.settings.signupCodeHash = hashPassword(core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT));
    db.settings.signupCodeLength = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT).length;
    writeData(db);
  }
  return db.settings.signupCodeHash;
}

/* Does what the scholar typed match the code in force? Compared against the
   stored hash in the form written today, and — only if that fails — in the older
   form that kept dashes, so a data.json seeded before separators were forgiven
   still admits the cohort it was set up for. The second attempt can admit
   nothing the first would not: a code with no dash normalises identically both
   ways. It is given the raw typing, because the two forms differ only in what
   they strip out of it.
   Removal condition: unlike legacyPeriod above, nothing else in this codebase
   ever rewrites signupCodeHash back to the current normalized form on its own
   — the stored hash stays in the old dash-kept shape indefinitely unless the
   code is rotated. So this branch is made self-healing here: the moment it
   succeeds, it rewrites the stored hash to the current normalized form, so
   every later check for this install takes the fast path above and this
   fallback is never reached again for it. That makes the removal condition
   checkable rather than open-ended: once nothing has hit this branch for as
   long as this install's session/log retention window, every live data.json
   has self-healed and the fallback (and this comment) can be deleted. */
function signupCodeMatches(db, raw) {
  const stored = signupCodeStored(db);
  if (verifyPassword(core.normalizeSignupCode(raw), stored)) return true;
  const legacy = core.legacySignupCode(raw);
  if (legacy !== core.normalizeSignupCode(raw) && verifyPassword(legacy, stored)) {
    db.settings.signupCodeHash = hashPassword(core.normalizeSignupCode(raw));
    writeData(db);
    return true;
  }
  return false;
}

/* ----------------------------------------------------------------- sessions
   In memory on purpose: restarting the server signs everyone out. */

const sessions = new Map();

/* Priority 9. A student's session lifetime is whatever management configured;
   staff keep the fixed 8-hour working session. The expiry lives here, on the
   server, so a tampered-with page timer cannot extend anyone's access. */
async function newSession(account, role, db) {
  const token = crypto.randomBytes(24).toString('hex');
  let minutes = SESSION_HOURS * 60;
  if (role === 'student') {
    const cohort = account && account.cohort ? await getCohortOrNull(account.cohort).catch(() => null) : null;
    minutes = effectiveSettingsFor(db, cohort).sessionMinutes;
  }
  sessions.set(token, {
    id: account.id,
    name: account.name,
    role: role,
    title: account.title || null,
    unlocked: false,
    subjects: role === 'student' ? (account.subjects || []).slice() : [],
    exam: role === 'student' ? core.EXAM : null,
    sessionMinutes: minutes,
    expires: Date.now() + minutes * 60 * 1000
  });
  return token;
}

function getSession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : null;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return { token, data: s };
}

/* Housekeeping: drop expired tokens rather than let the map grow for as long
   as the server runs. */
setInterval(() => {
  const now = Date.now();
  sessions.forEach((v, k) => { if (v.expires < now) sessions.delete(k); });
}, 5 * 60 * 1000).unref();

/* Throttle repeated failed logins from one address, so a script cannot sit
   there guessing Scholar IDs and passwords. */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(ip); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}

/* Behind Render/Railway's edge proxy, req.socket.remoteAddress is the
   platform's proxy address for every single visitor, not the visitor's own
   IP — so out of the box the throttle above would either look like one
   address that never trips it, or (worse) trip once and lock out everyone
   at once. The fix is X-Forwarded-For, but that header is client-supplied
   and trivially spoofable by anyone who can reach the server directly, so
   it must only be trusted when the operator has confirmed there really is
   a trusted reverse proxy in front of this process. Local runs and
   double-click demo mode never set this, so they keep using the sockets
   own address exactly as before. */
const TRUST_PROXY = process.env.GOC_TRUST_PROXY === '1' || process.env.GOC_TRUST_PROXY === 'true';

function getClientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) {
      // X-Forwarded-For is a comma-separated hop list appended to by each
      // proxy in the chain; the left-most entry is the original client.
      const first = String(fwd).split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/* Same shape as the login throttle above, kept separate because this one
   guards a public, unauthenticated endpoint (the homepage contact form)
   against a script hammering it, not against password guessing — a much
   more generous allowance is appropriate. */
const contactAttempts = new Map();
const CONTACT_MAX = 8;
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
function tooManyContacts(ip) {
  const rec = contactAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > CONTACT_WINDOW_MS) { contactAttempts.delete(ip); return false; }
  return rec.count >= CONTACT_MAX;
}
function noteContact(ip) {
  const rec = contactAttempts.get(ip);
  if (!rec || Date.now() - rec.first > CONTACT_WINDOW_MS) contactAttempts.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}

/* ------------------------------------------------------------------ helpers */

function send(res, status, obj) {
  const body = JSON.stringify(obj === undefined ? null : obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}
const okJson = (res, obj) => send(res, 200, obj);
const errJson = (res, status, msg) => send(res, status, { error: msg });

/* A ClientError carries a message the app deliberately wrote for the person
   using it (e.g. "Request too large.", "That file type is not allowed.") —
   safe to show verbatim. Anything else that reaches a catch block is treated
   as internal: logged in full server-side, never echoed to the browser. This
   is the one place that distinction is made, so every catch-all stays safe
   automatically instead of each one having to remember to sanitise. */
class ClientError extends Error {}

/* What a catch-all is allowed to send to the browser: the app's own
   deliberate message if there is one, otherwise a fixed generic string —
   never the raw error, which could carry a library name, a file path, or an
   internal stack detail. The full error is always logged server-side first. */
function safeClientMessage(err, fallback) {
  console.error('[goc]', fallback, '—', (err && err.stack) || err);
  return err instanceof ClientError ? err.message : fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) { reject(new ClientError('Request too large.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new ClientError('Malformed request.')); }
    });
    req.on('error', () => reject(new ClientError('Request failed.')));
  });
}

function publicStudent(db, s, opts) {
  const out = {
    id: s.id, name: s.name, last: s.last, tag: s.tag, tl: s.tl,
    active: s.active !== false, xp: s.xp || 0, streak: s.streak || 0,
    level: core.levelFor(s.xp || 0), subjects: (s.subjects || []).slice(),
    exam: core.EXAM, performance: perfFor(db, s.id).overall
  };
  /* lastSeenAt is a staff-only metric (feeds the Overview "Active today"
     count) — never surfaced to the student it belongs to or to any other
     student, only to console callers. */
  if (opts && opts.console) out.lastSeenAt = s.lastSeenAt || null;
  /* cohort is harmless for a student to see about themselves (it's just
     which group they're in), so it's not console-gated the way lastSeenAt is. */
  out.cohort = s.cohort || null;
  return out;
}

/* Stamp the student's last-seen time. Called from the session-info poll the
   Priority-9 countdown already makes, so this rides an existing request
   rather than adding a new one. Fire-and-forget in Appwrite mode so a slow
   write never delays the countdown response every logged-in screen polls. */
function stampLastSeen(db, studentId) {
  const now = new Date().toISOString();
  if (appwriteDatabases) {
    updateAppwriteStudent(studentId, { lastSeenAt: now })
      .catch(err => console.error('[goc] lastSeenAt stamp failed:', err.message));
    return;
  }
  const s = db.students.find(x => x.id === studentId);
  if (s) { s.lastSeenAt = now; writeData(db); }
}

/* Count one calendar day of streak toward a student's own record, in place.
   Called only from the routes a student reaches by actually doing something
   — submitting a test or a study/practice run — never from a staff action
   (marking a theory paper days later is the marker's activity, not the
   student's, and must not extend a streak the student didn't earn that day)
   and never from a bare login (opening the app is not showing up to study).
   Mutates the given student record; the caller is responsible for
   persisting it (writeData for local mode, updateAppwriteStudent for
   Appwrite — this stays storage-agnostic so both call sites can fold the
   change into the same write they're already making). */
function bumpStreakRecord(s) {
  if (!s) return s;
  const r = core.streakAfterActivity(s.streak, s.streakDay);
  s.streak = r.streak;
  s.streakDay = r.day;
  return s;
}

/* ------------------------------------------------- tests, marks, performance */

function findQ(db, id) {
  return db.questions.find(q => String(q.id) === String(id)) || null;
}
/* Records one CSV import run so /api/import/history can show it later — the
   admin console's own memory of "what came in earlier" that Task 8 asked
   for, rather than only ever showing the run just finished in this tab.
   Kept on the db itself so it survives a refresh and a new admin session,
   same as everything else importCSV writes. */
function logImport(db, entry) {
  if (!Array.isArray(db.importLog)) db.importLog = [];
  db.settings.importLogSeq = (db.settings.importLogSeq || 0) + 1;
  db.importLog.push({
    id: db.settings.importLogSeq,
    kind: entry.kind,
    filename: entry.filename ? String(entry.filename).slice(0, 200) : null,
    fingerprint: entry.fingerprint || null,
    /* Only questions imports carry a target ("Physics/objective") — see
       findDuplicateImport just below for why it is folded into the
       duplicate check rather than left as display-only metadata. */
    target: entry.target || null,
    read: entry.read || 0,
    added: entry.added || 0,
    skipped: entry.skipped || 0,
    by: entry.by || null,
    at: new Date().toISOString()
  });
  /* Trimmed here too, not just on read, so the file this actually lives in
     (data.json) never grows without bound from imports alone. */
  if (db.importLog.length > 200) db.importLog = db.importLog.slice(-200);
}
/* IMPORT DUPLICATE DETECTION — "same file" is read narrowly here: the exact
   same file name plus the exact same content (core.csvFingerprint of the raw
   CSV text), the first reading from REMAINING-TASKS-AFTER-GUARDIAN-PIN-FIX.txt.
   A paste with no filename can never match — there is nothing to call "the
   same file" without a name — so it always imports without a warning. Only
   the same kind's own history is searched, so a notes file can never flag a
   questions file as a duplicate. target ("Physics/objective") is part of
   "same file" too, questions-only: the CSV import screen lets the very same
   file be run once per subject+section it legitimately covers (a bank kept
   as one spreadsheet with a "which sheet" convention, say), so a second run
   against a different target is a new, deliberate import, not a re-run —
   only a repeat against the same target is flagged. Returns the most recent
   matching run, or null. */
function findDuplicateImport(db, kind, filename, fingerprint, target) {
  if (!filename || !fingerprint) return null;
  var log = Array.isArray(db.importLog) ? db.importLog : [];
  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    if (e.kind === kind && e.filename === filename && e.fingerprint === fingerprint &&
        (e.target || null) === (target || null)) return e;
  }
  return null;
}
function attemptsFor(db, scholarId) {
  return db.attempts.filter(a => a.scholarId === scholarId);
}
/* ONE-SIT RULE — a web test (theory/objective/jamb) is sat once. The period
   is a fixed constant (core.PERIOD === 'test'), not a rotating week or month,
   so "already submitted this section+subject" is the whole rule: there is no
   later period for a retake to belong to. Practice is deliberately excluded —
   this is only ever called with section 'theory' | 'objective' | 'jamb'. */
function hasSubmittedAttempt(db, scholarId, section, subject) {
  return db.attempts.some(a => a.scholarId === scholarId && a.section === section && a.subject === subject);
}
function perfFor(db, scholarId) {
  return core.computePerformance(attemptsFor(db, scholarId), db.settings.perfWeights);
}

function attemptSummary(a) {
  return {
    id: a.id, scholarId: a.scholarId, studentName: a.studentName,
    period: a.period, section: a.section, subject: a.subject,
    submittedAt: a.submittedAt, timeUsedSec: a.timeUsedSec,
    total: a.total, answered: a.answered, unanswered: a.unanswered,
    correct: a.correct, wrong: a.wrong,
    score: a.score, maxScore: a.maxScore, percent: a.percent,
    status: a.status, xpAwarded: a.xpAwarded || 0
  };
}

/* What the owning student may see. Correct answers and explanations are
   released only after the paper is marked, and only on their own paper. A
   student has no route that writes to a score, a mark or a correct answer. */
function summariseOwn(db, a, stu) {
  const out = attemptSummary(a);
  out.xpTotal = stu ? (stu.xp || 0) : 0;
  out.level = stu ? core.levelFor(stu.xp || 0) : 1;
  out.streak = stu ? (stu.streak || 0) : 0;
  out.breakdown = a.status === 'marked' ? core.topicBreakdown(a.answers) : [];
  out.review = a.answers.map(r => {
    const q = findQ(db, r.questionId) || {};
    const row = {
      questionId: r.questionId, kind: r.kind, topic: r.topic,
      text: q.text || '', given: r.given,
      markAwarded: r.markAwarded, maxMark: r.maxMark
    };
    if (a.status === 'marked') {
      row.isCorrect = r.isCorrect;
      row.explanation = q.explanation || '';
      if (r.kind === 'objective') { row.options = (q.options || []).slice(); row.answer = q.answer; }
    }
    return row;
  });
  out.performance = stu ? perfFor(db, stu.id).overall : 0;
  return out;
}

/* Papers that have been started but not submitted. Held in memory with the
   question set the server chose, so the submission is marked against the very
   questions that were served — the client cannot substitute an easier set. */
const openPapers = new Map();

/* Self-directed CBT runs, kept apart from real papers so an unassessed study
   run can never be mistaken for — or submitted as — an academic attempt. */
const openStudy = new Map();

/* True once a student has an unfinished practice paper in some subject other
   than the one they are trying to start now. Same-subject overlap (a second
   run before the first is submitted) is left alone — that already happens
   in the wild and nothing in the request asked to stop it — but the student
   is on the practice screen already for one subject, so switching subjects
   mid-run is refused rather than silently letting two run at once. */
function openPracticeElsewhere(scholarId, subject) {
  let found = null;
  openStudy.forEach((v) => {
    if (!found && v.scholarId === scholarId && v.mode === 'practice' && v.subject !== subject) found = v;
  });
  return found;
}

/* Practice XP already earned today by this student, stamped with the calendar
   day it belongs to so yesterday's allowance never limits today. */
function practiceXpToday(s) {
  if (!s || s.practiceXpDay !== core.dayStamp()) return 0;
  return Number(s.practiceXpToday) || 0;
}

/* Same "resets when the day stamp doesn't match today" shape as
   practiceXpToday above — a day's total that is never carried into the
   next one, without a cron job or midnight sweep anywhere. */
function studySecToday(s) {
  if (!s || s.studyDay !== core.dayStamp()) return 0;
  return Number(s.studySecToday) || 0;
}
/* Same day-stamped-reset shape again, this time for a guardian's "add 15
   min" grants (see core.EXTRA_TIME_GRANT_MIN): both the extra minutes and
   how many grants have been used today reset together, the moment the day
   stamp no longer matches today. */
function studyBonusMinToday(s) {
  if (!s || s.studyBonusDay !== core.dayStamp()) return 0;
  return Number(s.studyBonusMin) || 0;
}
function studyExtendCountToday(s) {
  if (!s || s.studyBonusDay !== core.dayStamp()) return 0;
  return Number(s.studyExtendCount) || 0;
}
setInterval(() => {
  const now = Date.now();
  openPapers.forEach((v, k) => {
    if (now - v.startedAt > (v.durationSec + 600) * 1000) openPapers.delete(k);
  });
  /* Study runs are swept too, so an abandoned one does not sit in memory. An
     untimed practice run is given four hours: it has no clock of its own, and a
     student who puts their phone down mid-run should still be able to finish. */
  openStudy.forEach((v, k) => {
    const life = (v.durationSec ? v.durationSec + 600 : 4 * 3600) * 1000;
    if (now - v.startedAt > life) openStudy.delete(k);
  });
}, 10 * 60 * 1000).unref();

function nextScholarId(db) {
  let max = 0;
  db.students.forEach(s => {
    const n = parseInt(String(s.id).replace('GOC-S-', ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  const n = max + 1;
  return 'GOC-S-' + (n < 10 ? '00' + n : n < 100 ? '0' + n : String(n));
}

function todayLabel() {
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date();
  return m[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

/* Trim and cap anything a user typed, so one long paste cannot bloat the file. */
function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

/* Optional server-side leg of the contact form's email delivery (see the
   POST /api/contact route above). Nothing calls this unless SMTP is
   configured, and 'nodemailer' is only required() the first time it's
   actually needed — so an install that never sets these env vars (or
   hasn't run `npm install` for this optional dependency) is completely
   unaffected: the contact form still works via the FormSubmit relay in
   js/api.js and the data.json record above either way. */
let _mailTransport;
function getMailTransport() {
  if (_mailTransport !== undefined) return _mailTransport;
  if (!process.env.GOC_SMTP_HOST || !process.env.GOC_SMTP_USER || !process.env.GOC_SMTP_PASS) {
    _mailTransport = null;
    return _mailTransport;
  }
  try {
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    _mailTransport = nodemailer.createTransport({
      host: process.env.GOC_SMTP_HOST,
      port: Number(process.env.GOC_SMTP_PORT) || 587,
      secure: process.env.GOC_SMTP_SECURE === '1' || process.env.GOC_SMTP_SECURE === 'true',
      auth: { user: process.env.GOC_SMTP_USER, pass: process.env.GOC_SMTP_PASS }
    });
  } catch (e) {
    console.warn('[contact] GOC_SMTP_* is set but the optional "nodemailer" package is not installed — run npm install. Falling back to the stored copy only.');
    _mailTransport = null;
  }
  return _mailTransport;
}
async function sendContactEmail(name, email, message) {
  const transport = getMailTransport();
  if (!transport) return;
  const to = process.env.GOC_CONTACT_TO || 'godsowncenterinfo@gmail.com';
  await transport.sendMail({
    from: process.env.GOC_SMTP_FROM || process.env.GOC_SMTP_USER,
    to,
    replyTo: email,
    subject: 'New message from the G.O.C Academy Hub website',
    text: 'From: ' + name + ' <' + email + '>\n\n' + message
  });
}

/* ------------------------------------------------------------- resources */
/*
 * Handles an admin resource upload.
 * Multipart requests are parsed separately from the normal JSON body reader
 * because uploaded resources are binary files.
 */
async function handleResourceUpload(req, res) {
  if (!appwriteResourcesStorage || !appwriteDatabases) {
    return errJson(res, 503, 'Resource storage is not available.');
  }

  const os = require('os');
  const { InputFile } = require(
    path.join(path.dirname(require.resolve('node-appwrite')), 'inputFile.js')
  );

  const allowedExtensions = new Set([
    '.jpg', '.jpeg', '.png', '.gif',
    '.pdf', '.doc', '.docx',
    '.xls', '.xlsx', '.zip', '.mp4'
  ]);

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-resource-'));
  let tempFilePath = null;
  let uploadedFileName = '';
  let uploadedBytes = 0;
  let fileSeen = false;

  const fields = {};

  try {
    await new Promise((resolve, reject) => {
      const busboy = getBusboy()({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: MAX_FILE_SIZE,
          fields: 10,
          fieldSize: 10 * 1024
        }
      });

      let fileWritePromise = Promise.resolve();

      busboy.on('field', (name, value) => {
        fields[name] = String(value || '').trim();
      });

      busboy.on('file', (name, file, info) => {
        fileSeen = true;

        uploadedFileName = String(info.filename || 'resource');
        const ext = path.extname(uploadedFileName).toLowerCase();

        if (!allowedExtensions.has(ext)) {
          file.resume();
          return reject(new ClientError('That file type is not allowed.'));
        }

        tempFilePath = path.join(
          tempDir,
          crypto.randomUUID() + ext
        );

        const writeStream = fs.createWriteStream(tempFilePath);

        file.on('data', chunk => {
          uploadedBytes += chunk.length;
        });

        file.on('limit', () => {
          reject(new ClientError('The resource file is too large. Maximum size is 50 MB.'));
        });

        file.pipe(writeStream);

        fileWritePromise = new Promise((resolveWrite, rejectWrite) => {
          writeStream.on('finish', resolveWrite);
          writeStream.on('error', rejectWrite);
          file.on('error', rejectWrite);
        });
      });

      busboy.on('error', reject);

      busboy.on('finish', async () => {
        try {
          await fileWritePromise;
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      req.pipe(busboy);
    });

    if (!fileSeen || !tempFilePath) {
      return errJson(res, 400, 'Please select a resource file to upload.');
    }

    if (!fields.title) {
      return errJson(res, 400, 'Resource title is required.');
    }

    if (!fields.subject) {
      return errJson(res, 400, 'Resource subject is required.');
    }

    if (!fields.category) {
      return errJson(res, 400, 'Resource category is required.');
    }

    if (uploadedBytes <= 0) {
      return errJson(res, 400, 'The uploaded file is empty.');
    }

    const resourceId = 'RES-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const storageFileId = crypto.randomUUID();

    const inputFile = InputFile.fromPath(
      tempFilePath,
      uploadedFileName
    );

    await appwriteResourcesStorage.createFile(
      APPWRITE_BUCKET_ID,
      storageFileId,
      inputFile
    );

    await appwriteDatabases.createDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_RESOURCES_COLLECTION_ID,
      resourceId,
      {
        resourceId,
        title: clean(fields.title, 255),
        description: clean(fields.description, 1000),
        subject: clean(fields.subject, 100),
        category: clean(fields.category, 100),
        fileType: path.extname(uploadedFileName).replace('.', '').toUpperCase(),
        storageFileId,
        published: false
      }
    );

    return okJson(res, {
      ok: true,
      resource: {
        resourceId,
        title: clean(fields.title, 255),
        subject: clean(fields.subject, 100),
        category: clean(fields.category, 100),
        fileType: path.extname(uploadedFileName).replace('.', '').toUpperCase(),
        storageFileId,
        published: false
      }
    });
  } catch (err) {
    return errJson(
      res,
      400,
      safeClientMessage(err, 'Resource upload failed. Please try again.')
    );
  } finally {
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (_) {}

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/* ------------------------------------------------------------------ videos */
/*
 * Handles an admin video upload. Mirrors handleResourceUpload, with one
 * difference: the file is optional. A video can be backed by an uploaded
 * MP4 (stored the same way a resource file is) or by an external link
 * (a Zoom cloud recording or an unlisted YouTube URL) — at least one of
 * the two is required, but not both.
 */
async function handleVideoUpload(req, res) {
  if (!appwriteResourcesStorage || !appwriteDatabases) {
    return errJson(res, 503, 'Video storage is not available.');
  }

  const os = require('os');
  const { InputFile } = require(
    path.join(path.dirname(require.resolve('node-appwrite')), 'inputFile.js')
  );

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-video-'));
  let tempFilePath = null;
  let uploadedFileName = '';
  let uploadedBytes = 0;
  let fileSeen = false;

  const fields = {};

  try {
    await new Promise((resolve, reject) => {
      const busboy = getBusboy()({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: MAX_FILE_SIZE,
          fields: 10,
          fieldSize: 10 * 1024
        }
      });

      let fileWritePromise = Promise.resolve();

      busboy.on('field', (name, value) => {
        fields[name] = String(value || '').trim();
      });

      busboy.on('file', (name, file, info) => {
        fileSeen = true;

        uploadedFileName = String(info.filename || 'video');
        const ext = path.extname(uploadedFileName).toLowerCase();

        if (ext !== '.mp4') {
          file.resume();
          return reject(new ClientError('Only .mp4 video files are allowed.'));
        }

        tempFilePath = path.join(
          tempDir,
          crypto.randomUUID() + ext
        );

        const writeStream = fs.createWriteStream(tempFilePath);

        file.on('data', chunk => {
          uploadedBytes += chunk.length;
        });

        file.on('limit', () => {
          reject(new ClientError('The video file is too large. Maximum size is 50 MB.'));
        });

        file.pipe(writeStream);

        fileWritePromise = new Promise((resolveWrite, rejectWrite) => {
          writeStream.on('finish', resolveWrite);
          writeStream.on('error', rejectWrite);
          file.on('error', rejectWrite);
        });
      });

      busboy.on('error', reject);

      busboy.on('finish', async () => {
        try {
          await fileWritePromise;
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      req.pipe(busboy);
    });

    if (!fields.title) {
      return errJson(res, 400, 'Video title is required.');
    }

    if (!fields.subject) {
      return errJson(res, 400, 'Video subject is required.');
    }

    if (fields.type !== 'live' && fields.type !== 'lesson') {
      return errJson(res, 400, 'Video type must be "live" or "lesson".');
    }

    if (!fields.tutor) {
      return errJson(res, 400, 'Tutor / instructor name is required.');
    }

    if (!fields.duration) {
      return errJson(res, 400, 'Video duration is required.');
    }

    const externalUrl = clean(fields.externalUrl || '', 500);

    if (fileSeen && uploadedBytes <= 0) {
      return errJson(res, 400, 'The uploaded file is empty.');
    }

    if (!fileSeen && !externalUrl) {
      return errJson(res, 400, 'Provide either a video file or a link.');
    }

    if (externalUrl && !/^https?:\/\//i.test(externalUrl)) {
      return errJson(res, 400, 'The link must start with http:// or https://.');
    }

    const videoId = 'VID-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    let storageFileId = '';

    if (fileSeen && tempFilePath) {
      storageFileId = crypto.randomUUID();
      const inputFile = InputFile.fromPath(tempFilePath, uploadedFileName);
      await appwriteResourcesStorage.createFile(
        APPWRITE_BUCKET_ID,
        storageFileId,
        inputFile
      );
    }

    const record = {
      videoId,
      title: clean(fields.title, 255),
      subject: clean(fields.subject, 100),
      type: fields.type,
      tutor: clean(fields.tutor, 100),
      duration: clean(fields.duration, 20),
      storageFileId,
      externalUrl,
      published: false
    };

    await appwriteDatabases.createDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_VIDEOS_COLLECTION_ID,
      videoId,
      record
    );

    return okJson(res, { ok: true, video: record });
  } catch (err) {
    return errJson(
      res,
      400,
      safeClientMessage(err, 'Video upload failed. Please try again.')
    );
  } finally {
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (_) {}

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/* ------------------------------------------------------------- video cache
   Every play used to re-download the whole file from Appwrite Storage into
   server memory and forward it — on *every* watch, by every student, no
   matter how many times the same recording had already been served. That
   made a first play slow (a full round trip to Appwrite for a file that
   can be tens of MB) and made a second play fragile: any Appwrite hiccup,
   rate limit, or slow response on that particular request failed the whole
   thing, with nothing to fall back on.

   Fix: fetch a given storageFileId from Appwrite at most once per server
   run, cache it to local disk, and serve every request — first or
   hundredth — straight off disk with proper Range support, so seeking and
   fast start work like a normal video file. */
const VIDEO_CACHE_DIR = path.join(os.tmpdir(), 'goc-video-cache');
try { fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true }); } catch (_) {}

// Collapses concurrent first-time requests for the same file into a single
// Appwrite fetch, so ten students opening a brand-new recording at once
// don't trigger ten downloads.
const videoCacheInFlight = new Map();

function videoCachePath(storageFileId) {
  return path.join(VIDEO_CACHE_DIR, storageFileId.replace(/[^A-Za-z0-9._-]/g, '_') + '.mp4');
}

function ensureVideoCached(storageFileId) {
  const localPath = videoCachePath(storageFileId);

  if (fs.existsSync(localPath)) {
    return Promise.resolve(localPath);
  }

  if (videoCacheInFlight.has(storageFileId)) {
    return videoCacheInFlight.get(storageFileId);
  }

  const fetchPromise = (async () => {
    const fileData = await appwriteResourcesStorage.getFileView(APPWRITE_BUCKET_ID, storageFileId);
    // Write to a temp path and rename into place — rename is atomic, so a
    // request that arrives while the download is still in flight can never
    // see (and serve) a half-written file.
    const tmpPath = localPath + '.' + crypto.randomUUID() + '.tmp';
    await fs.promises.writeFile(tmpPath, Buffer.from(fileData));
    await fs.promises.rename(tmpPath, localPath);
    return localPath;
  })();

  videoCacheInFlight.set(storageFileId, fetchPromise);
  fetchPromise.finally(() => videoCacheInFlight.delete(storageFileId)).catch(() => {});
  return fetchPromise;
}

function clearCachedVideo(storageFileId) {
  try { fs.unlinkSync(videoCachePath(storageFileId)); } catch (_) {}
}

// Serves a cached video file with Range support, so the <video> element can
// seek and start playback without waiting for the whole file to download.
function streamVideoFile(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return errJson(res, 404, 'Could not open that video.');
  }

  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;

  if (!match || isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
    return res.end();
  }

  res.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store'
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

/* ================================================================= API ROUTES
   Each handler receives (req, res, body, session, params).
   `need` says what the caller must already be: null, 'staff', or 'console'
   ('console' = staff who have also passed the access passcode). */

/* Maps a liveclasses Appwrite document onto the one shape every class route
   returns, so the mapping lives in one place instead of being repeated at
   each route the way the videos routes above do. */
function classFromDoc(doc) {
  return {
    classId: doc.classId || doc.$id,
    subject: doc.subject || '',
    topic: doc.topic || '',
    tutor: doc.tutor || '',
    scheduledAt: doc.scheduledAt || null,
    durationMin: typeof doc.durationMin === 'number' ? doc.durationMin : Number(doc.durationMin) || 0,
    zoomLink: doc.zoomLink || '',
    status: doc.status || 'scheduled',
    createdAt: doc.$createdAt || null,
    updatedAt: doc.$updatedAt || null
  };
}

/* Maps a cohorts Appwrite document onto the one shape every cohort route
   returns. The four override fields are nullable — null/undefined means
   "inherit the academy-wide default", exactly like a student with no cohort
   already inherits everything today. objectiveCounts is a per-subject map,
   same shape as db.settings.objectiveCounts, also nullable per subject. */
function cohortFromDoc(doc) {
  return {
    cohortId: doc.cohortId || doc.$id,
    name: doc.name || '',
    status: doc.status || 'active',
    dailyLimitMin: doc.dailyLimitMin == null ? null : Number(doc.dailyLimitMin),
    sessionMinutes: doc.sessionMinutes == null ? null : Number(doc.sessionMinutes),
    sessionWarnMinutes: doc.sessionWarnMinutes == null ? null : Number(doc.sessionWarnMinutes),
    objectiveMinutes: doc.objectiveMinutes == null ? null : Number(doc.objectiveMinutes),
    objectiveCounts: doc.objectiveCounts ? JSON.parse(doc.objectiveCounts) : null,
    createdAt: doc.$createdAt || null,
    updatedAt: doc.$updatedAt || null
  };
}

/* Resolves the settings a given student actually studies under: each field
   comes from their cohort's override when the cohort set one, and falls back
   to the academy-wide default otherwise. A student with no cohort, or a
   cohort that overrides nothing, behaves exactly as before this feature
   existed. This is the one place that merge happens, so every caller (the
   student-facing settings route today, session/attempt limits as they are
   wired in next) reads the same resolved numbers. */
function effectiveSettingsFor(db, cohort) {
  const st = db.settings;
  const base = {
    dailyLimitMin: st.dailyLimitMin,
    sessionMinutes: core.clampSessionMinutes(st.sessionMinutes),
    sessionWarnMinutes: core.clampWarnMinutes(st.sessionWarnMinutes, st.sessionMinutes),
    objectiveMinutes: core.clampObjectiveMinutes(st.objectiveMinutes),
    objectiveCounts: Object.assign({}, st.objectiveCounts || {}),
    // The guardian PIN is academy-wide, not cohort-resolved (no cohort ever
    // overrides it below), but a signed-in student still needs to know
    // *whether* one is set so the wind-down overlay can decide whether to
    // show its "enter the guardian PIN to keep going" field at all. Only
    // the yes/no flag travels here — the digits themselves stay off every
    // route but the console's own GET /api/settings.
    hasGuardianPin: !!core.normalizeGuardianPin(st.guardianPin),
    cohortId: null, cohortName: null
  };
  if (!cohort) return base;

  if (cohort.dailyLimitMin != null) base.dailyLimitMin = cohort.dailyLimitMin;
  if (cohort.sessionMinutes != null) base.sessionMinutes = core.clampSessionMinutes(cohort.sessionMinutes);
  if (cohort.sessionWarnMinutes != null) {
    base.sessionWarnMinutes = core.clampWarnMinutes(cohort.sessionWarnMinutes, base.sessionMinutes);
  } else {
    base.sessionWarnMinutes = core.clampWarnMinutes(base.sessionWarnMinutes, base.sessionMinutes);
  }
  if (cohort.objectiveMinutes != null) base.objectiveMinutes = core.clampObjectiveMinutes(cohort.objectiveMinutes);
  if (cohort.objectiveCounts) {
    Object.keys(cohort.objectiveCounts).forEach(sub => {
      if (cohort.objectiveCounts[sub] != null) base.objectiveCounts[sub] = cohort.objectiveCounts[sub];
    });
  }
  base.cohortId = cohort.cohortId;
  base.cohortName = cohort.name;
  return base;
}

/* Every cohort, for callers that need to label a whole roster at once (the
   league) rather than resolve one student's cohort at a time. Same "no
   flat-file fallback" convention as the rest of cohorts: an empty list when
   Appwrite isn't configured, never a thrown error, so a route that merely
   wants to label rows can degrade to unlabelled instead of failing outright. */
async function listAllCohorts() {
  if (!appwriteDatabases) return [];
  try {
    const { Query } = require('node-appwrite');
    const result = await appwriteDatabases.listDocuments(
      APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, [Query.limit(5000)]
    );
    return result.documents.map(cohortFromDoc);
  } catch (err) {
    console.error('[goc] Cohort list failed:', err.message);
    return [];
  }
}

async function getCohortOrNull(cohortId) {
  if (!cohortId || !appwriteDatabases) return null;
  try {
    const doc = await appwriteDatabases.getDocument(APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, cohortId);
    return cohortFromDoc(doc);
  } catch (err) {
    if (err && (err.code === 404 || err.status === 404)) return null;
    throw err;
  }
}

const ROUTES = [
  { method: 'GET', path: /^\/api\/health$/, need: null, handler: (req, res) => {
      const db = readData();
      okJson(res, { service: 'goc-academy-hub', version: 1, passcodeLength: Number(db.settings.consolePasscodeLength) || 4 });
    } },

  { method: 'POST', path: /^\/api\/auth\/login$/, need: null, handler: async (req, res, body) => {
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');

      const id = clean(body.id, 20).toUpperCase();
      const password = String(body.password == null ? '' : body.password);
      const db = readData();

      const isStaff = /^GOC-A-\d+$/.test(id);
      const isStudent = /^GOC-S-\d+$/.test(id);
      let account = isStaff ? db.staff.find(s => s.id === id) : null;

      if (isStudent) {
        if (appwriteDatabases) {
          try {
            account = await getAppwriteStudent(id);
          } catch (_) {
            account = null;
          }
        } else {
          account = db.students.find(s => s.id === id) || null;
        }
      }

      // A known deactivated student must be told that access is closed while
      // keeping the records-safe message. Unknown IDs still get the generic
      // response below so the login screen does not reveal roster membership.
      if (isStudent && account && account.active === false) {
        return errJson(res, 403, 'This Scholar ID has been deactivated by your academy. Your records are safe — contact the academy to reopen it.');
      }

      // One message for both "no such ID" and "wrong password": the login screen
      // must never confirm which IDs exist.
    let passwordOk = false;

    if (account) {
      if (isStudent && appwriteDatabases) {
        // Students authenticate through Appwrite Auth.
        // The Auth email is an internal identity derived from the Scholar ID.
        if (account.appwriteUserId) {
          try {
            await require('./lib/appwrite').verifyAppwritePassword(
              account.id.toLowerCase() + '@gocacademy.com',
              password
            );
            passwordOk = true;
          } catch (_) {
            passwordOk = false;
          }
        }
      } else if (isStaff) {
        // Staff management passwords live in .env, not data.json.
        const staffPassword =
          account.id === 'GOC-A-001' ? process.env.GOC_FOUNDER_PW :
          account.id === 'GOC-A-002' ? process.env.GOC_ACADDIR_PW :
          null;

        passwordOk = Boolean(staffPassword) && password === staffPassword;
      } else {
        // Local student fallback keeps the existing password verifier.
        passwordOk = verifyPassword(password, account.pwHash);
      }
    }

    if (!account || !passwordOk) {
      noteFailure(ip);
      return errJson(res, 401, 'That ID and password do not match.');
    }
      attempts.delete(ip);

      const role = isStaff ? 'admin' : 'student';
      const token = await newSession(account, role, db);
      if (isStudent) {
        account.last = 'Active now'; account.tag = 'g'; account.tl = 'Online';
        writeData(db);
      }
      okJson(res, { token, user: {
        id: account.id, name: account.name, role, title: account.title || null,
        subjects: isStaff ? [] : (account.subjects || []).slice(),
        exam: isStaff ? null : core.EXAM,
        sessionMinutes: sessions.get(token).sessionMinutes,
        expiresAt: sessions.get(token).expires,
        mustChangePassword: isStudent ? !!account.mustChangePassword : false
      } });
    } },

  { method: 'POST', path: /^\/api\/auth\/logout$/, need: null, handler: (req, res, body, sess) => {
      if (sess) sessions.delete(sess.token);
      okJson(res, { ok: true });
    } },

  { method: 'POST', path: /^\/api\/me\/password$/, need: 'student', handler: async (req, res, body, sess) => {
    if (!appwriteDatabases || !appwriteUsers) {
      return errJson(res, 503, 'Appwrite Auth is not available.');
    }

    const newPassword = String(body.newPassword == null ? '' : body.newPassword);

    if (newPassword.length < 8) {
      return errJson(res, 400, 'Choose a password of at least 8 characters.');
    }

    if (newPassword.length > 256) {
      return errJson(res, 400, 'Password must not be longer than 256 characters.');
    }

    const studentId = String(sess.data.id || '').toUpperCase();
    const s = await getAppwriteStudentOrNull(studentId);

    if (!s) {
      return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
    }

    if (!s.appwriteUserId) {
      return errJson(res, 503, 'This Scholar is not linked to Appwrite Auth.');
    }

    try {
      await appwriteUsers.updatePassword(s.appwriteUserId, newPassword);

      await updateAppwriteStudent(studentId, {
        must_change_password: false
      });

      return okJson(res, {
        ok: true,
        mustChangePassword: false
      });
    } catch (err) {
      console.error('Student password change failed:', err.message);
      return errJson(res, 503, 'Password could not be changed. Please try again.');
    }
  } },

  { method: 'GET', path: /^\/api\/auth\/session$/, need: 'staff-or-student', handler: (req, res, body, sess) => {
      const d = sess.data;
      okJson(res, {
        id: d.id, name: d.name, role: d.role, title: d.title,
        subjects: (d.subjects || []).slice(), exam: d.exam,
        sessionMinutes: d.sessionMinutes, expiresAt: d.expires
      });
    } },

  /* Priority 9 — the countdown on screen asks the server how long is left, so
     the browser is displaying the real remaining time rather than guessing. */
  { method: 'GET', path: /^\/api\/auth\/session-info$/, need: 'staff-or-student', handler: (req, res, body, sess) => {
      const d = sess.data;
      /* The warning lead time is read live rather than from the token, so a
         change management makes now reaches a student who is already signed in.
         The expiry itself is not re-read: the lifetime was settled at login and
         extending it here would let a setting change silently prolong a
         session. */
      const db = readData();
      const st = db.settings;
      const warn = core.clampWarnMinutes(st.sessionWarnMinutes, d.sessionMinutes);
      if (d.role === 'student') stampLastSeen(db, d.id);
      okJson(res, {
        active: true, id: d.id, role: d.role,
        sessionMinutes: d.sessionMinutes,
        sessionWarnMinutes: warn,
        warnInSec: warn * 60,
        expiresAt: d.expires,
        expiresInSec: Math.max(0, Math.round((d.expires - Date.now()) / 1000))
      });
    } },

  { method: 'POST', path: /^\/api\/auth\/unlock$/, need: 'staff', handler: (req, res, body, sess) => {
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      const db = readData();
      if (!verifyPassword(String(body.passcode == null ? '' : body.passcode), db.settings.consolePasscodeHash)) {
        noteFailure(ip);
        return errJson(res, 403, 'Incorrect passcode — access denied.');
      }
      attempts.delete(ip);
      sess.data.unlocked = true;
      okJson(res, { unlocked: true });
    } },

  { method: 'POST', path: /^\/api\/auth\/lock$/, need: 'staff', handler: (req, res, body, sess) => {
      sess.data.unlocked = false;
      okJson(res, { ok: true });
    } },

  { method: 'GET', path: /^\/api\/students$/, need: 'console', handler: async (req, res) => {
      const db = readData();
      const students = appwriteDatabases
        ? await listAppwriteStudents()
        : db.students;
      okJson(res, students.map(s => publicStudent(db, s, { console: true })));
    } },

  /* Public: this is the sign-up form. UTME only, and the subject combination is
     validated here as well as on screen — the rule belongs to the server.
     The academy access code is checked first, before anything else is examined:
     a stranger who does not hold it learns nothing about the academy's rules. */
  { method: 'POST', path: /^\/api\/students$/, need: null, handler: async (req, res, body) => {
      // Sign-up runs a deliberately slow password check, so it is throttled the
      // same way login and the console unlock are: repeated wrong codes from one
      // address are stopped before they can tie the server up. A correct sign-up
      // clears the counter, so an invited cohort is never locked out.
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      const db = readData();
      const codeV = core.validateSignupCode(body.signupCode);
      if (codeV.error) return errJson(res, 400, codeV.error);
      if (!signupCodeMatches(db, body.signupCode)) {
        noteFailure(ip);
        return errJson(res, 403, core.SIGNUP_CODE_REFUSED);
      }

      const name = clean(body.name, 80);
      const password = String(body.password == null ? '' : body.password);
      if (name.length < 2) return errJson(res, 400, 'Enter your full name.');
      if (password.length < 8) return errJson(res, 400, 'Choose a password of at least 8 characters.');

      const exam = core.requireExam(body.goal);
      if (!exam.ok) return errJson(res, 400, exam.error);
      const combo = core.validateSubjects(Array.isArray(body.subjects) ? body.subjects : []);
      if (!combo.ok) return errJson(res, 400, combo.error);

      const rec = {
        id: appwriteDatabases
          ? await nextAppwriteScholarId()
          : nextScholarId(db),
        name,
        email: clean(body.email, 120),
        phone: clean(body.phone, 30),
        goal: exam.exam,
        exam: core.EXAM,
        subjects: combo.subjects,
        pwHash: hashPassword(password),
    plainPassword: password,
    appwriteUserId: null,
        mustChangePassword: false,
        active: true, xp: 0, streak: 0, streakDay: null,
        last: 'Just registered', tag: 'g', tl: 'New',
        createdAt: new Date().toISOString()
      };
      if (appwriteDatabases) {
    let authUser = null;
    try {
      authUser = await createAppwriteAuthUser(rec);
      rec.appwriteUserId = authUser.$id;

      await createAppwriteStudent(rec);
    } catch (err) {
      if (authUser && authUser.$id) {
        await deleteAppwriteAuthUser(authUser.$id);
      }
      console.error('Appwrite student registration failed:', err.message);
      return errJson(res, 503, 'Registration could not be completed. Please try again.');
    }
  } else {
        db.students.push(rec);
      }
      delete rec.plainPassword;
  writeData(db);
      attempts.delete(ip);

      const token = await newSession(rec, 'student', db);
      okJson(res, {
        student: publicStudent(db, rec),
        session: {
          id: rec.id, name: rec.name, role: 'student', title: null,
          subjects: rec.subjects.slice(), exam: core.EXAM,
          sessionMinutes: sessions.get(token).sessionMinutes,
          expiresAt: sessions.get(token).expires
        },
        token
      });
    } },

  /* Priority 7 — close or reopen an account. History is never deleted. */
  { method: 'PUT', path: /^\/api\/students\/([A-Za-z0-9-]+)\/active$/, need: 'console', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');

        const active = !!body.active;
        const patch = { active };

        if (!active) {
          patch.tl = 'Closed';
          patch.tag = 'r';
          patch.last = 'Deactivated';
          sessions.forEach((v, k) => { if (v.id === s.id) sessions.delete(k); });
        } else {
          if (s.last === 'Deactivated') {
            patch.tl = 'Away';
            patch.tag = 'a';
            patch.last = 'Reopened';
          }
        }

        const updated = await updateAppwriteStudent(studentId, patch);
        const updatedStudent = appwriteStudentToRecord(updated);
        return okJson(res, publicStudent(db, updatedStudent, { console: true }));
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');

      s.active = !!body.active;
      if (!s.active) {
        s.tl = 'Closed'; s.tag = 'r'; s.last = 'Deactivated';
        s.deactivatedAt = new Date().toISOString();
        s.deactivatedBy = sess.data.id;
        sessions.forEach((v, k) => { if (v.id === s.id) sessions.delete(k); });
      } else {
        if (s.last === 'Deactivated') { s.tl = 'Away'; s.tag = 'a'; s.last = 'Reopened'; }
        s.reactivatedAt = new Date().toISOString();
        s.reactivatedBy = sess.data.id;
      }
      writeData(db);
      okJson(res, publicStudent(db, s, { console: true }));
    } },

  { method: 'POST', path: /^\/api\/students\/([A-Za-z0-9-]+)\/reset$/, need: 'console', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');

          // Reset the student's password in Appwrite Auth.
          // The Database keeps only the account state, not the authoritative password.
          const temp = 'GOC' + crypto.randomInt(10000, 99999);

          if (!s.appwriteUserId) {
            return errJson(res, 503, 'This Scholar is not linked to Appwrite Auth.');
          }

          await appwriteUsers.updatePassword(
            s.appwriteUserId,
            temp
          );

          await updateAppwriteStudent(studentId, {
            must_change_password: true
          });

        return okJson(res, {
          id: studentId,
          temporaryPassword: temp,
          mustChange: true,
          issuedBy: sess.data.id
        });
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');

      const temp = 'GOC' + crypto.randomInt(10000, 99999);
      s.pwHash = hashPassword(temp);
      s.mustChangePassword = true;
      writeData(db);
      okJson(res, { id: s.id, temporaryPassword: temp, mustChange: true, issuedBy: sess.data.id });
    } },

  /* Admin: enrol a student in person. Staff are already authenticated as
     console, so no sign-up access code is checked here — but staff should
     not be choosing the student's password for them either, so a temporary
     one is issued the same way resetPassword issues one, and the student is
     forced to set their own on first login (mustChangePassword). Runs the
     same requireExam/validateSubjects checks the public sign-up route runs,
     so an admin-created account can never hold a combination a
     self-registered one couldn't. */
  { method: 'POST', path: /^\/api\/admin\/students$/, need: 'console', handler: async (req, res, body, sess) => {
      const db = readData();
      const name = clean(body.name, 80);
      if (name.length < 2) return errJson(res, 400, 'Enter the student\'s full name.');

      const exam = core.requireExam(body.goal);
      if (!exam.ok) return errJson(res, 400, exam.error);
      const combo = core.validateSubjects(Array.isArray(body.subjects) ? body.subjects : []);
      if (!combo.ok) return errJson(res, 400, combo.error);

      const temp = 'GOC' + crypto.randomInt(10000, 99999);

      const rec = {
        id: appwriteDatabases
          ? await nextAppwriteScholarId()
          : nextScholarId(db),
        name,
        email: clean(body.email, 120),
        phone: clean(body.phone, 30),
        goal: exam.exam,
        exam: core.EXAM,
        subjects: combo.subjects,
        pwHash: hashPassword(temp),
        plainPassword: temp,
        appwriteUserId: null,
        mustChangePassword: true,
        active: true, xp: 0, streak: 0, streakDay: null,
        last: 'Just registered', tag: 'g', tl: 'New',
        createdAt: new Date().toISOString(),
        enrolledBy: sess.data.id
      };

      if (appwriteDatabases) {
        let authUser = null;
        try {
          authUser = await createAppwriteAuthUser(rec);
          rec.appwriteUserId = authUser.$id;
          await createAppwriteStudent(rec);
        } catch (err) {
          if (authUser && authUser.$id) {
            await deleteAppwriteAuthUser(authUser.$id);
          }
          console.error('Admin student enrolment failed:', err.message);
          return errJson(res, 503, 'Enrolment could not be completed. Please try again.');
        }
      } else {
        db.students.push(rec);
      }
      delete rec.plainPassword;
      writeData(db);

      okJson(res, { student: publicStudent(db, rec, { console: true }), temporaryPassword: temp });
    } },

  /* Overview panel — the four headline numbers, computed here in one place
     rather than the client stitching together four separate fetches.
     "Lessons published" needs Appwrite (resources/videos live only there,
     same as the admin resources/videos list routes); everything else works
     in flat-file mode too. */
  { method: 'GET', path: /^\/api\/admin\/overview$/, need: 'console', handler: async (req, res) => {
      const db = readData();
      const students = appwriteDatabases ? await listAppwriteStudents() : db.students;

      const studentsTotal = students.length;
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const activeToday = students.filter(s => {
        if (!s.lastSeenAt) return false;
        const t = Date.parse(s.lastSeenAt);
        return Number.isFinite(t) && t >= dayAgo;
      }).length;

      const marked = studentsTotal > 0
        ? db.attempts.filter(a => a.status === 'marked' && typeof a.percent === 'number')
        : [];
      const avgScorePercent = marked.length
        ? Math.round(marked.reduce((sum, a) => sum + a.percent, 0) / marked.length)
        : null;

      let lessonsPublished = 0;
      if (appwriteDatabases) {
        try {
          const { Query } = require('node-appwrite');
          const [resResult, vidResult] = await Promise.all([
            appwriteDatabases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_RESOURCES_COLLECTION_ID, [Query.limit(5000)]),
            appwriteDatabases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_VIDEOS_COLLECTION_ID, [Query.limit(5000)])
          ]);
          lessonsPublished = resResult.documents.filter(d => !!d.published).length
            + vidResult.documents.filter(d => !!d.published).length;
        } catch (err) {
          console.error('[goc] Overview lessons-published count failed:', err.message);
        }
      }

      okJson(res, { studentsTotal, activeToday, avgScorePercent, lessonsPublished });
    } },

  { method: 'GET', path: /^\/api\/staff$/, need: 'console', handler: (req, res) => {
      // Names and titles only. The password hash never leaves the server.
      okJson(res, readData().staff.map(s => ({ id: s.id, name: s.name, title: s.title })));
    } },

  { method: 'GET', path: /^\/api\/updates$/, need: null, handler: (req, res) => {
      okJson(res, readData().updates);
    } },

  { method: 'POST', path: /^\/api\/updates$/, need: 'console', handler: (req, res, body) => {
      const title = clean(body.title, 140);
      const text = clean(body.body, 1200);
      const allowed = ['news', 'admission', 'utme', 'scholarship'];
      const cat = allowed.indexOf(String(body.cat)) >= 0 ? String(body.cat) : 'news';
      if (!title || !text) return errJson(res, 400, 'Add a headline and message first.');

      const db = readData();
      const rec = {
        id: (db.settings.updateSeq = (db.settings.updateSeq || 100) + 1),
        cat, date: todayLabel(), title, body: text,
        ctaLabel: 'Learn more →', ctaAction: "go('signup')"
      };
      db.updates.unshift(rec);
      writeData(db);
      okJson(res, rec);
    } },

  { method: 'DELETE', path: /^\/api\/updates\/(\d+)$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const id = Number(params[0]);
      const before = db.updates.length;
      db.updates = db.updates.filter(u => u.id !== id);
      if (db.updates.length === before) return errJson(res, 404, 'That update no longer exists.');
      writeData(db);
      okJson(res, { ok: true });
    } },

  /* The daily affirmation flyer is public (a student sees it before doing
     anything else), so GET has no auth requirement — same as GET /updates
     above. Only console may change the pool. */
  { method: 'GET', path: /^\/api\/affirmations$/, need: null, handler: (req, res) => {
      okJson(res, readData().affirmations);
    } },

  /* Replaces the whole pool in one call, the same "send the full list back"
     shape the admin screen will use once it exists (see the remaining-tasks
     notes) rather than one-at-a-time add/remove routes that would need their
     own id scheme for what are just plain strings. Blank lines are dropped
     and each message is capped the same way clean() caps everything else
     free-text management can type into this app; at least one message must
     survive the cleanup or the flyer would have nothing to show. */
  { method: 'PUT', path: /^\/api\/affirmations$/, need: 'console', handler: (req, res, body) => {
      const items = Array.isArray(body.items) ? body.items : null;
      if (!items) return errJson(res, 400, 'Send the affirmation list as an array of messages.');
      const list = items.map(m => clean(m, 300)).filter(Boolean).slice(0, 50);
      if (!list.length) return errJson(res, 400, 'Add at least one affirmation before saving.');
      const db = readData();
      db.affirmations = list;
      writeData(db);
      okJson(res, db.affirmations);
    } },

  /* Homepage "Talk to G.O.C Academy" form. Public on purpose — a visitor
     hasn't signed in yet when they use it. js/api.js's sendContact() calls
     the mail relay (FormSubmit, straight to godsowncenterinfo@gmail.com)
     itself and calls this route in parallel purely to keep a durable copy;
     this handler ALSO makes its own best-effort attempt to email the
     academy inbox when SMTP is configured (GOC_SMTP_HOST/PORT/USER/PASS
     env vars — see DEPLOYMENT.md), so the message still reaches the inbox
     even from a visitor whose browser/network blocks the third-party
     relay. Either way the submission is never lost: it is written to
     data.json before any mail attempt is made. */
  { method: 'POST', path: /^\/api\/contact$/, need: null, handler: (req, res, body) => {
      const ip = getClientIp(req);
      if (tooManyContacts(ip)) return errJson(res, 429, 'Too many messages sent from this connection. Please try again later.');

      const name = clean(body.name, 120);
      const email = clean(body.email, 160);
      const message = clean(body.message, 4000);
      if (!name) return errJson(res, 400, 'Please add your name.');
      if (!email || email.indexOf('@') < 1 || email.indexOf('@') === email.length - 1) return errJson(res, 400, 'Please add a valid email address.');
      if (!message) return errJson(res, 400, 'Please add a short message.');

      noteContact(ip);
      const db = readData();
      db.contactMessages.push({ name, email, message, date: todayLabel(), receivedAt: new Date().toISOString() });
      // Cap the log so an old install's data.json cannot grow forever; the
      // mail relay is the real delivery path, this is only a safety net.
      if (db.contactMessages.length > 500) db.contactMessages = db.contactMessages.slice(-500);
      writeData(db);
      okJson(res, { ok: true });

      // Best-effort email, after the response has already gone out: a slow
      // or failing SMTP server must never make the visitor's form hang or
      // show an error when their message has already been safely recorded.
      sendContactEmail(name, email, message).catch(() => {});
    } },

  { method: 'GET', path: /^\/api\/settings$/, need: null, handler: (req, res, body, sess) => {
      const st = readData().settings;
      // Only the values the app needs to draw itself. No hashes, no secrets —
      // and the guardian PIN is a secret, so it is never sent here at all.
      // Everyone (including a logged-out visitor) may know a PIN feature
      // exists; only console gets the digits back, to prefill the edit form.
      const isConsole = !!(sess && sess.data && sess.data.role === 'admin' && sess.data.unlocked);
      const out = {
        dailyLimitMin: st.dailyLimitMin,
        sessionMinutes: st.sessionMinutes,
        sessionWarnMinutes: st.sessionWarnMinutes,
        objectiveMinutes: core.clampObjectiveMinutes(st.objectiveMinutes),
        hasGuardianPin: !!core.normalizeGuardianPin(st.guardianPin)
      };
      if (isConsole) out.guardianPin = st.guardianPin || '';
      okJson(res, out);
    } },

  { method: 'PUT', path: /^\/api\/settings$/, need: 'console', handler: (req, res, body) => {
      const db = readData();
      if (body.dailyLimitMin !== undefined) {
        db.settings.dailyLimitMin = Math.max(30, Math.min(180, Number(body.dailyLimitMin) || 90));
      }
      if (body.sessionMinutes !== undefined) {
        db.settings.sessionMinutes = core.clampSessionMinutes(body.sessionMinutes);
      }
      if (body.sessionWarnMinutes !== undefined) {
        db.settings.sessionWarnMinutes = core.clampWarnMinutes(body.sessionWarnMinutes, db.settings.sessionMinutes);
      }
      if (body.objectiveMinutes !== undefined) {
        db.settings.objectiveMinutes = core.clampObjectiveMinutes(body.objectiveMinutes);
      }
      /* Sending an empty string clears the PIN back to "feature off", the same
         {field: ''/null} convention cohorts use to mean "go back to unset".
         A non-empty value that isn't 4-8 digits is refused outright, so a typo
         can never lock the feature into an unusable PIN silently. */
      if (body.guardianPin !== undefined) {
        const raw = String(body.guardianPin == null ? '' : body.guardianPin).trim();
        if (!raw) {
          db.settings.guardianPin = null;
        } else {
          const norm = core.normalizeGuardianPin(raw);
          if (!norm) return errJson(res, 400, 'A guardian PIN must be 4 to 8 digits.');
          db.settings.guardianPin = norm;
        }
      }
      /* Shortening the session can leave a warning longer than the session it
         warns about, so the pair is always settled together. */
      db.settings.sessionWarnMinutes =
        core.clampWarnMinutes(db.settings.sessionWarnMinutes, db.settings.sessionMinutes);
      writeData(db);
      okJson(res, {
        dailyLimitMin: db.settings.dailyLimitMin,
        sessionMinutes: db.settings.sessionMinutes,
        sessionWarnMinutes: db.settings.sessionWarnMinutes,
        objectiveMinutes: core.clampObjectiveMinutes(db.settings.objectiveMinutes),
        hasGuardianPin: !!core.normalizeGuardianPin(db.settings.guardianPin),
        guardianPin: db.settings.guardianPin || ''
      });
    } },

  /* How many questions one paper of the objective sitting serves. The UTME
     ceiling is the law here — 60 for Use of English, 40 for a science — and
     management may only come in under it, never over. */
  { method: 'PUT', path: /^\/api\/settings\/objective-count$/, need: 'console', handler: (req, res, body) => {
      const db = readData();
      const sub = clean(body.subject, 40);
      if (core.ALL_SUBJECTS.indexOf(sub) === -1) {
        return errJson(res, 400, 'That is not one of the academy’s subjects.');
      }
      db.settings.objectiveCounts = db.settings.objectiveCounts || {};
      db.settings.objectiveCounts[sub] = core.objectiveCount(sub, { [sub]: body.questions });
      writeData(db);
      okJson(res, { subject: sub, questions: db.settings.objectiveCounts[sub],
                    ceiling: core.objectiveCeiling(sub),
                    objectiveCounts: db.settings.objectiveCounts });
    } },

  /* What the sitting would look like right now, paper by paper, so a shortfall
     in the bank is visible in the console before a student meets it. */
  { method: 'GET', path: /^\/api\/objective\/blueprint$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const period = core.normalizePeriod(new URL(req.url, 'http://localhost').searchParams.get('period'));
      const rows = core.objectiveBlueprint(db.questions, core.ALL_SUBJECTS,
                                           db.settings.objectiveCounts);
      const minutes = core.clampObjectiveMinutes(db.settings.objectiveMinutes);
      okJson(res, { period, periodLabel: core.PERIOD_LABEL, minutes,
                    minutesLabel: core.hoursLabel(minutes),
                    ceiling: core.OBJECTIVE_CEILING, papers: rows,
                    fullCombinationTotal: core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 });
    } },

  /* -------------------------------------------- Priority 8: credential control
     Both routes sit behind the 'founder' tier, which the dispatcher enforces
     before the handler runs. Hiding the buttons in the interface is not the
     control; this is. */

  { method: 'GET', path: /^\/api\/staff\/access$/, need: 'console', handler: (req, res, body, sess) => {
      const db = readData();
      signupCodeStored(db);
      okJson(res, {
        staff: db.staff.map(s => ({ id: s.id, name: s.name, title: s.title })),
        isFounder: sess.data.title === 'Founder',
        passcodeLength: Number(db.settings.consolePasscodeLength) || 4,
        /* The access code itself is never returned — only its shape and its
           history, which is all the console needs to know it is current. */
        signupCodeLength: Number(db.settings.signupCodeLength) || 0,
        signupCodeChangedAt: db.settings.signupCodeChangedAt || null,
        signupCodeChangedBy: db.settings.signupCodeChangedBy || null,
        sessionMinutes: db.settings.sessionMinutes,
        sessionWarnMinutes: db.settings.sessionWarnMinutes
      });
    } },

  /* The create-account firewall is the Academic Director's business as much as the
     Founder's — both admit scholars — so this sits at the 'console' tier, not
     'founder'. It is still management-only and still behind the passcode. */
  { method: 'PUT', path: /^\/api\/settings\/signup-code$/, need: 'console', handler: (req, res, body, sess) => {
      const v = core.validateSignupCode(body.code);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.signupCodeHash = hashPassword(v.code);
      db.settings.signupCodeLength = v.code.length;
      db.settings.signupCodeChangedAt = new Date().toISOString();
      db.settings.signupCodeChangedBy = sess.data.id;
      writeData(db);
      /* No code material in the response: the person who set it already knows it,
         and nobody else may read it back. */
      okJson(res, { length: v.code.length, changed: true,
                    changedAt: db.settings.signupCodeChangedAt,
                    changedBy: db.settings.signupCodeChangedBy });
    } },

  { method: 'PUT', path: /^\/api\/staff\/([A-Za-z0-9-]+)\/password$/, need: 'founder', handler: (req, res, body, sess, params) => {
      const pw = String(body.password == null ? '' : body.password);
      if (pw.length < 8) return errJson(res, 400, 'Management passwords must be at least 8 characters.');
      if (!/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) return errJson(res, 400, 'Use both letters and numbers in a management password.');

      const db = readData();
      const a = db.staff.find(x => x.id === params[0].toUpperCase());
      if (!a) return errJson(res, 404, 'That Staff ID does not exist.');

      const envKey =
        a.id === 'GOC-A-001' ? 'GOC_FOUNDER_PW' :
        a.id === 'GOC-A-002' ? 'GOC_ACADDIR_PW' :
        null;

      if (!envKey) {
        return errJson(res, 400, 'That staff account does not have a management password configured.');
      }

      try {
        setEnvSecret(envKey, pw);
      } catch (err) {
        return errJson(res, 500, 'Unable to save the management password.');
      }

      // Password material is kept out of data.json.
      // Only the audit metadata remains on the staff record.
      a.passwordChangedAt = new Date().toISOString();
      a.passwordChangedBy = sess.data.id;
      delete a.pwHash;
      writeData(db);

      // The response deliberately carries no password material of any kind.
      okJson(res, { id: a.id, name: a.name, title: a.title, changed: true });
    } },

  { method: 'PUT', path: /^\/api\/settings\/passcode$/, need: 'founder', handler: (req, res, body, sess) => {
      const p = String(body.passcode == null ? '' : body.passcode).trim();
      if (!/^[0-9]{4,8}$/.test(p)) return errJson(res, 400, 'The firewall passcode must be 4 to 8 digits.');
      const db = readData();
      db.settings.consolePasscodeHash = hashPassword(p);
      db.settings.consolePasscodeLength = p.length;
      db.settings.passcodeChangedAt = new Date().toISOString();
      db.settings.passcodeChangedBy = sess.data.id;
      writeData(db);
      // Everyone else must re-enter the new passcode.
      sessions.forEach(v => { if (v.role === 'admin' && v.id !== sess.data.id) v.unlocked = false; });
      okJson(res, { length: p.length, changed: true });
    } },

  /* ================================================ Priority 3: the Web Test
     Everything a student may do with a paper. The question set, the clock and
     the marking all belong to the server; the page only collects answers. */

  { method: 'GET', path: /^\/api\/me$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const p = perfFor(db, s.id);
      okJson(res, {
        id: s.id, name: s.name, exam: core.EXAM,
        subjects: (s.subjects || []).slice(),
        xp: s.xp || 0, streak: s.streak || 0,
        level: core.levelFor(s.xp || 0),
        xpIntoLevel: core.xpIntoLevel(s.xp || 0),
        xpPerLevel: core.xpPerLevel(),
        performance: p.overall, performanceDetail: p,
        active: s.active !== false,
        mustChangePassword: !!s.mustChangePassword
      });
    } },

  /* Priority 6 — the catalogue is built from the student's stored combination,
     so their subjects are the single source of truth for what they can sit.
     Theory is one paper per subject and carries no clock; objective is a single
     sitting of the whole combination, so it appears once. There is one test, not
     a weekly one and a monthly one, so each paper is listed exactly once. The
     JAMB-oriented paper is held back and never listed as sittable. */
  { method: 'GET', path: /^\/api\/me\/tests$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      const subs = (s.subjects || []).slice();
      const minutes = core.clampObjectiveMinutes(db.settings.objectiveMinutes);
      const rows = [], period = core.PERIOD;
      subs.forEach(sub => {
        const n = core.eligible(db.questions, { section: 'theory', subject: sub }).length;
        if (n) rows.push({ period, section: 'theory', subject: sub, questions: n, durationSec: 0,
                           completed: hasSubmittedAttempt(db, s.id, 'theory', sub) });
      });
      const bp = core.objectiveBlueprint(db.questions, subs, db.settings.objectiveCounts);
      const total = core.objectiveTotal(bp);
      if (total) {
        rows.push({ period, section: 'objective', subject: core.OBJECTIVE_SUBJECT,
                    questions: total, durationSec: minutes * 60,
                    papers: bp.map(r => ({ subject: r.subject, questions: r.serving })),
                    completed: hasSubmittedAttempt(db, s.id, 'objective', core.OBJECTIVE_SUBJECT) });
      }
      okJson(res, { subjects: subs, tests: rows, objectiveMinutes: minutes,
                    objectiveMinutesLabel: core.hoursLabel(minutes) });
    } },

  { method: 'POST', path: /^\/api\/me\/tests\/start$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const winCohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
      const winEff = effectiveSettingsFor(db, winCohort);
      if (core.studyWindowStatus(winEff.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)).exhausted) {
        return errJson(res, 403, "Today's study window is used up — read on your own for now and come back tomorrow.");
      }
      /* Whatever period a client asks for, there is one test to sit: an older
         page still sending 'weekly' is answered rather than refused. */
      const period = core.normalizePeriod(clean(body.period, 12));
      const section = clean(body.section, 12);
      let subject = clean(body.subject, 40);
      if (core.SECTIONS.indexOf(section) === -1) return errJson(res, 400, 'Choose a test section.');
      if (section === 'jamb') {
        return errJson(res, 403, 'The JAMB-oriented paper is coming soon. Sit the Objective session for a full timed sitting.');
      }
      const subs = (s.subjects || []).slice();
      let pool, dur, papers = null;
      if (section === 'objective') {
        /* One sitting of the whole combination: the student chooses nothing but
           when to begin, exactly as in the hall. The clock and per-paper counts
           come from the student's cohort where it overrides them, the academy
           default otherwise — effectiveSettingsFor is the one place that merge
           happens. */
        const cohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
        const eff = effectiveSettingsFor(db, cohort);
        const bp = core.objectiveBlueprint(db.questions, subs, eff.objectiveCounts);
        pool = core.objectivePaper(db.questions, subs, eff.objectiveCounts);
        if (!pool.length) return errJson(res, 404, 'No questions have been published for that sitting yet.');
        subject = core.OBJECTIVE_SUBJECT;
        dur = eff.objectiveMinutes * 60;
        papers = bp.filter(r => r.serving > 0).map(r => ({ subject: r.subject, questions: r.serving }));
      } else {
        if (subs.indexOf(subject) === -1) {
          return errJson(res, 403, subject + ' is not part of your registered subject combination.');
        }
        /* Some subjects are examined in the objective sitting only. `eligible`
           would serve nothing anyway, but "nothing published yet" would be the
           wrong reason to give — say the real one. */
        if (!core.theoryAllowed(subject)) return errJson(res, 403, core.noTheoryMessage(subject));
        pool = core.eligible(db.questions, { section, subject });
        if (!pool.length) return errJson(res, 404, 'No questions have been published for that test yet.');
        dur = 0;   /* a written paper is sat without a clock */
      }

      // ONE-SIT RULE: once a web test (theory/objective/jamb) has been
      // submitted, it is closed for good — re-checked here even though the
      // catalogue already hides it, because the catalogue is only a courtesy;
      // this is the gate that actually enforces it against a stale page, a
      // replayed request, or a client that never re-read the catalogue.
      if (hasSubmittedAttempt(db, s.id, section, subject)) {
        return errJson(res, 403, 'You have already submitted this test. It cannot be sat again.');
      }

      db.settings.attemptSeq = (db.settings.attemptSeq || 0) + 1;
      writeData(db);
      const paper = {
        id: 'A' + db.settings.attemptSeq + '-' + crypto.randomBytes(4).toString('hex'),
        scholarId: s.id, studentName: s.name,
        period, section, subject,
        questionIds: pool.map(q => q.id),
        startedAt: Date.now(), durationSec: dur
      };
      openPapers.set(paper.id, paper);
      okJson(res, {
        attemptId: paper.id, period, section, subject,
        kind: section === 'theory' ? 'theory' : 'objective',
        papers, total: pool.length, durationSec: paper.durationSec,
        questions: pool.map(core.forStudent)      // correct answers stripped out
      });
    } },

  { method: 'POST', path: /^\/api\/me\/tests\/submit$/, need: 'student', handler: async (req, res, body, sess) => {
      const paper = openPapers.get(String(body.attemptId || ''));
      if (!paper) return errJson(res, 409, 'That test session has ended. Start the test again.');
      if (paper.scholarId !== sess.data.id) return errJson(res, 403, 'That test does not belong to this Scholar ID.');

      let used = Number(body.timeUsedSec);
      if (isNaN(used) || used < 0) used = Math.round((Date.now() - paper.startedAt) / 1000);
      // The clock is the server's: a client cannot claim it finished in no time.
      // An untimed paper has no ceiling to clamp against, so the time is only
      // recorded — clamping against zero would file every theory sitting as
      // having taken no time at all.
      used = Math.max(used, 0);
      if (paper.durationSec > 0) used = Math.min(used, paper.durationSec);
      const elapsed = Math.round((Date.now() - paper.startedAt) / 1000);
      if (elapsed < used) used = elapsed;

      // The read (of db.attempts/students), the Appwrite XP update, and the
      // write are held inside one lock: the Appwrite branch awaits between
      // reading the local file and writing it back, and without the lock a
      // second student submitting in that window would read the same
      // pre-write snapshot and its write would silently erase this attempt
      // when it saved — a lost paper, not a crash, so nothing would look wrong
      // until a roster count came up short.
      const result = await withDataLock(async () => {
        const db = readData();
        const pool = paper.questionIds.map(id => findQ(db, id)).filter(Boolean);
        const marked = core.markAttempt(pool, body.responses || {});

        const rec = {
          id: paper.id, scholarId: paper.scholarId, studentName: paper.studentName,
          period: paper.period, section: paper.section, subject: paper.subject,
          questionIds: paper.questionIds,
          startedAt: paper.startedAt, submittedAt: Date.now(),
          timeUsedSec: used, durationSec: paper.durationSec,
          total: marked.total, answered: marked.answered, unanswered: marked.unanswered,
          correct: marked.correct, wrong: marked.wrong,
          score: marked.score, maxScore: marked.maxScore,
          percent: marked.percent, status: marked.status,
          answers: marked.answers, xpAwarded: 0
        };
        let stu;
        if (appwriteDatabases) {
          stu = await getAppwriteStudentOrNull(rec.scholarId);
          if (!stu) return { notFound: true };

          const gain = rec.status === 'marked' ? core.xpForAttempt(rec.percent) : 10;
          rec.xpAwarded = gain;
          // A submitted paper is the student's own activity, so it also
          // counts today toward their streak (see bumpStreakRecord above).
          bumpStreakRecord(stu);

          const updated = await updateAppwriteStudent(rec.scholarId, {
            xp: (stu.xp || 0) + gain,
            streak: stu.streak,
            streakDay: stu.streakDay
          });
          stu = appwriteStudentToRecord(updated);
        } else {
          stu = db.students.find(x => x.id === rec.scholarId);
          const gain = rec.status === 'marked' ? core.xpForAttempt(rec.percent) : 10;
          rec.xpAwarded = gain;
          if (stu) { stu.xp = (stu.xp || 0) + gain; bumpStreakRecord(stu); }
        }

        db.attempts.push(rec);
        writeData(db);
        return { db, rec, stu };
      });

      if (result.notFound) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      openPapers.delete(paper.id);
      okJson(res, summariseOwn(result.db, result.rec, result.stu));
    } },

  { method: 'GET', path: /^\/api\/me\/results$/, need: 'student', handler: (req, res, body, sess) => {
      const db = readData();
      const rows = attemptsFor(db, sess.data.id).slice().sort((a, b) => b.submittedAt - a.submittedAt);
      okJson(res, { attempts: rows.map(attemptSummary), performance: perfFor(db, sess.data.id) });
    } },

  { method: 'GET', path: /^\/api\/me\/results\/([A-Za-z0-9-]+)$/, need: 'student', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const a = db.attempts.find(x => String(x.id) === params[0]);
      if (!a || a.scholarId !== sess.data.id) return errJson(res, 404, 'That result is not on your record.');

      const stu = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      okJson(res, summariseOwn(db, a, stu));
    } },

  /* ---------------------------------------------- self-directed study
     Reading mode, practice and the student-configured CBT. None of this is
     assessed: no attempt is filed, no XP moves, nothing reaches the console
     results table or the league. That is what lets a practice question carry
     its own answer so the page can mark it the moment it is chosen. */

  { method: 'GET', path: /^\/api\/me\/study$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const subjects = (s.subjects || []).map(sub => {
        const topics = core.studyTopics(db.questions, sub);
        return { subject: sub, questions: topics.reduce((m, t) => m + t.questions, 0), topics };
      });
      const reading = (s.subjects || []).map(sub => {
        const seen = {}, topics = [];
        db.notes.forEach(n => {
          if (!n.active || n.subject !== sub) return;
          if (seen[n.topic] === undefined) { seen[n.topic] = topics.length; topics.push({ topic: n.topic, notes: 0 }); }
          topics[seen[n.topic]].notes++;
        });
        return { subject: sub, topics, notes: topics.reduce((m, t) => m + t.notes, 0) };
      });
      const cohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
      const eff = effectiveSettingsFor(db, cohort);
      okJson(res, Object.assign(
        { subjects, reading, maxQuestions: core.STUDY_MAX },
        core.studyWindowStatus(eff.dailyLimitMin, studySecToday(s), studyBonusMinToday(s))
      ));
    } },

  /* The heartbeat behind the daily study window. The page calls this roughly
     once a minute while a student is signed in and the tab is in the
     foreground; only what this adds ever counts, and only up to
     STUDY_PING_MAX_SEC per call, so a tampered or repeated call can never
     inflate the total beyond what real elapsed time could produce. The day
     rolls over here too — studySecToday() already treats yesterday's stamp as
     zero, this is just where "yesterday" becomes "today" in the stored record. */
  { method: 'POST', path: /^\/api\/me\/study-time\/ping$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      let stu = appwriteDatabases
        ? await getAppwriteStudentOrNull(sess.data.id)
        : db.students.find(x => x.id === sess.data.id);
      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      const today = core.dayStamp();
      const addSec = core.clampStudyPingSeconds(body && body.seconds);
      const afterSec = studySecToday(stu) + addSec;

      if (appwriteDatabases) {
        const updated = await updateAppwriteStudent(sess.data.id, { studyDay: today, studySecToday: afterSec });
        stu = appwriteStudentToRecord(updated);
      } else {
        stu.studyDay = today;
        stu.studySecToday = afterSec;
        writeData(db);
      }

      const cohort = stu.cohort ? await getCohortOrNull(stu.cohort).catch(() => null) : null;
      const eff = effectiveSettingsFor(db, cohort);
      okJson(res, core.studyWindowStatus(eff.dailyLimitMin, studySecToday(stu), studyBonusMinToday(stu)));
    } },

  /* "Add 15 min (guardian PIN)" — see DAILY-STUDY-WINDOW-STATUS.txt. A single
     academy-wide PIN, checked here against db.settings.guardianPin, grants a
     fixed EXTRA_TIME_GRANT_MIN on top of today's window, up to
     EXTRA_TIME_MAX_GRANTS_PER_DAY times a day. Wrong-PIN guesses share the
     same tooManyAttempts(ip)/noteFailure(ip) throttle already used on
     login/signup, so this can't be brute-forced any more easily than a
     password. */
  { method: 'POST', path: /^\/api\/me\/study-time\/extend$/, need: 'student', handler: async (req, res, body, sess) => {
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');

      const db = readData();
      let stu = appwriteDatabases
        ? await getAppwriteStudentOrNull(sess.data.id)
        : db.students.find(x => x.id === sess.data.id);
      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      if (!core.normalizeGuardianPin(db.settings.guardianPin)) {
        return errJson(res, 403, 'No guardian PIN has been set for this academy.');
      }
      if (!core.guardianPinMatches(db.settings.guardianPin, body && body.pin)) {
        noteFailure(ip);
        return errJson(res, 401, 'That PIN is not correct.');
      }
      attempts.delete(ip);

      if (studyExtendCountToday(stu) >= core.EXTRA_TIME_MAX_GRANTS_PER_DAY) {
        return errJson(res, 403, "Today's extra time has already been used up.");
      }

      const today = core.dayStamp();
      const afterBonus = studyBonusMinToday(stu) + core.EXTRA_TIME_GRANT_MIN;
      const afterCount = studyExtendCountToday(stu) + 1;

      if (appwriteDatabases) {
        // studyBonusMin/studyBonusDay/studyExtendCount are new attributes that
        // may not exist yet on a live Appwrite "students" collection — reads
        // of an unmapped field are safe (undefined/0), but this write will
        // throw until the academy adds them, so that case gets a clear
        // message instead of a raw 500.
        try {
          const updated = await updateAppwriteStudent(sess.data.id, {
            studyBonusDay: today, studyBonusMin: afterBonus, studyExtendCount: afterCount
          });
          stu = appwriteStudentToRecord(updated);
        } catch (err) {
          return errJson(res, 500, 'Could not save the extra time. Ask the academy to add the studyBonusMin, studyBonusDay and studyExtendCount attributes to the Appwrite students collection, then try again.');
        }
      } else {
        stu.studyBonusDay = today;
        stu.studyBonusMin = afterBonus;
        stu.studyExtendCount = afterCount;
        writeData(db);
      }

      const cohort = stu.cohort ? await getCohortOrNull(stu.cohort).catch(() => null) : null;
      const eff = effectiveSettingsFor(db, cohort);
      okJson(res, core.studyWindowStatus(eff.dailyLimitMin, studySecToday(stu), studyBonusMinToday(stu)));
    } },

  /* A student reads only notes for a paper they sit, and only what management
     has left active. */
  { method: 'GET', path: /^\/api\/me\/notes$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const url = new URL(req.url, 'http://localhost');
      const subject = url.searchParams.get('subject') || '';
      const topic = url.searchParams.get('topic') || '';
      const rows = db.notes.filter(n => {
        if (!n.active) return false;
        if ((s.subjects || []).indexOf(n.subject) === -1) return false;
        if (subject && n.subject !== subject) return false;
        if (topic && n.topic !== topic) return false;
        return true;
      });
      okJson(res, { notes: rows });
    } },

  { method: 'POST', path: /^\/api\/me\/study\/start$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const winCohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
      const winEff = effectiveSettingsFor(db, winCohort);
      if (core.studyWindowStatus(winEff.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)).exhausted) {
        return errJson(res, 403, "Today's study window is used up — read on your own for now and come back tomorrow.");
      }
      const mode = clean(body.mode, 12) || 'cbt';
      const subject = clean(body.subject, 60);
      if (core.STUDY_MODES.indexOf(mode) === -1) return errJson(res, 400, 'Choose practice or CBT.');
      /* Practice runs exactly one subject at a time — never trust the screen
         for this. The sentinel some older clients still send is refused
         outright rather than silently narrowed. */
      if (mode === 'practice' && subject === core.PRACTICE_ALL_SUBJECTS) {
        return errJson(res, 400, 'Choose a single subject to practice.');
      }
      if ((s.subjects || []).indexOf(subject) === -1) {
        return errJson(res, 403, subject + ' is not part of your registered subject combination.');
      }
      /* One subject at a time, once a run is under way (item 2): the student
         is already on the practice screen for whatever they started, so a
         different subject has to wait until that run is submitted. */
      if (mode === 'practice') {
        const openElsewhere = openPracticeElsewhere(s.id, subject);
        if (openElsewhere) {
          return errJson(res, 409, 'Finish or submit your ' + openElsewhere.subject +
            ' practice run before starting a different subject.');
        }
      }
      /* Practice is subject-only by design (item 4/6): whatever topics the
         client sends are ignored here, even if it still sends some — only CBT
         narrows by topic. */
      const pool = mode === 'practice'
        ? core.studyPool(db.questions, subject, null)
        : core.studyPool(db.questions, subject, body.topics);
      if (!pool.length) {
        return errJson(res, 404, mode === 'practice'
          ? 'No questions have been published for ' + subject + ' yet.'
          : 'No questions have been published for the topics you chose yet.');
      }
      const picked = core.pickStudy(pool, core.clampStudyCount(body.count, pool.length));

      const minutes = mode === 'cbt' ? core.clampStudyMinutes(body.minutes) : 0;
      const paper = {
        id: 'S' + crypto.randomBytes(5).toString('hex'),
        scholarId: s.id, subject, mode,
        questionIds: picked.map(q => q.id),
        startedAt: Date.now(), durationSec: minutes * 60
      };
      openStudy.set(paper.id, paper);
      if (mode === 'practice') {
        /* A practice paper carries its answers, because the page marks each one
           as it is tapped. The run is registered here all the same, so finishing
           it can be marked again on this side and earn XP no browser calculated. */
        return okJson(res, {
          mode, paperId: paper.id, subject, total: picked.length, durationSec: 0,
          xpPerAnswer: core.PRACTICE_XP_PER_ANSWER,
          xpPerCorrect: core.PRACTICE_XP_PER_CORRECT,
          xpLeftToday: core.practiceXpRemaining(practiceXpToday(s)),
          questions: picked.map(core.forPractice)
        });
      }
      okJson(res, {
        mode, paperId: paper.id, subject,
        total: picked.length, durationSec: paper.durationSec,
        questions: picked.map(core.forStudent)      // correct answers stripped out
      });
    } },

  { method: 'POST', path: /^\/api\/me\/study\/submit$/, need: 'student', handler: async (req, res, body, sess) => {
      const paper = openStudy.get(String(body.paperId || ''));
      if (!paper) return errJson(res, 409, 'That study run has ended. Set it up again.');
      if (paper.scholarId !== sess.data.id) return errJson(res, 403, 'That study run does not belong to this Scholar ID.');
      const db = readData();
      const pool = paper.questionIds.map(id => findQ(db, id)).filter(Boolean);
      const marked = core.markAttempt(pool, body.responses || {});
      let used = Number(body.timeUsedSec);
      if (isNaN(used) || used < 0) used = Math.round((Date.now() - paper.startedAt) / 1000);
      used = Math.max(used, 0);
      if (paper.durationSec) used = Math.min(used, paper.durationSec);
      openStudy.delete(paper.id);
      const mode = paper.mode || 'cbt';
        let stu;

        if (appwriteDatabases) {
          stu = await getAppwriteStudentOrNull(sess.data.id);
          if (!stu) {
            return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
          }
        } else {
          stu = db.students.find(x => x.id === sess.data.id);
        }

        let gain = 0, left = 0, earned = 0;

        /* A submitted study run — mock/CBT or practice — is the student's own
           effort for the day regardless of whether it happens to earn XP, so
           it is what the streak is counted against here (never a bare
           login). streakUpdate is a no-op {streak, day} equal to what's
           already stored when today was already counted. */
        const streakUpdate = stu ? core.streakAfterActivity(stu.streak, stu.streakDay) : null;
        const streakChanged = streakUpdate && (streakUpdate.streak !== stu.streak || streakUpdate.day !== stu.streakDay);

        if (mode === 'practice' && stu) {
          /* Marked from this side's own answer key, then capped for the day:
             the XP a practice run earns can never be dictated by the page. */
          left = core.practiceXpRemaining(practiceXpToday(stu));
          earned = core.xpForPractice(marked.answered, marked.correct);
          gain = Math.min(left, earned);

          if (gain > 0) {
            const newXp = (stu.xp || 0) + gain;
            const newPracticeXpToday = practiceXpToday(stu) + gain;
            const newPracticeXpDay = core.dayStamp();

            if (appwriteDatabases) {
              const updated = await updateAppwriteStudent(sess.data.id, {
                xp: newXp,
                practiceXpDay: newPracticeXpDay,
                practiceXpToday: newPracticeXpToday,
                streak: streakUpdate.streak,
                streakDay: streakUpdate.day
              });

              stu = appwriteStudentToRecord(updated);
            } else {
              stu.xp = newXp;
              stu.practiceXpDay = newPracticeXpDay;
              stu.practiceXpToday = newPracticeXpToday;
              stu.streak = streakUpdate.streak;
              stu.streakDay = streakUpdate.day;
              writeData(db);
            }
          } else if (streakChanged) {
            // Today's practice cap was already hit, so no XP moves — but the
            // run itself still counts as today's activity for the streak.
            if (appwriteDatabases) {
              const updated = await updateAppwriteStudent(sess.data.id, {
                streak: streakUpdate.streak, streakDay: streakUpdate.day
              });
              stu = appwriteStudentToRecord(updated);
            } else {
              stu.streak = streakUpdate.streak;
              stu.streakDay = streakUpdate.day;
              writeData(db);
            }
          }
        } else if (stu && streakChanged) {
          // Mock/CBT self-study never earns XP here, but sitting one is still
          // showing up to study, so it counts toward the streak on its own.
          if (appwriteDatabases) {
            const updated = await updateAppwriteStudent(sess.data.id, {
              streak: streakUpdate.streak, streakDay: streakUpdate.day
            });
            stu = appwriteStudentToRecord(updated);
          } else {
            stu.streak = streakUpdate.streak;
            stu.streakDay = streakUpdate.day;
            writeData(db);
          }
        }
      okJson(res, {
        mode, subject: paper.subject, assessed: false,
        total: marked.total, answered: marked.answered, unanswered: marked.unanswered,
        correct: marked.correct, wrong: marked.wrong, percent: marked.percent,
        timeUsedSec: used,
        xpAwarded: gain,
        xpTotal: stu ? (stu.xp || 0) : 0,
        level: core.levelFor(stu ? (stu.xp || 0) : 0),
        streak: stu ? (stu.streak || 0) : 0,
        xpLeftToday: mode === 'practice' ? Math.max(0, left - gain) : 0,
        xpCapped: mode === 'practice' && gain < earned,
        review: pool.map((q, i) => {
          const a = marked.answers[i] || {};
          return {
            n: i + 1, questionId: q.id, topic: q.topic, text: q.text,
            options: (q.options || []).slice(), answer: q.answer,
            given: a.given === undefined ? null : a.given,
            isCorrect: !!a.isCorrect, explanation: q.explanation || ''
          };
        }),
        topics: core.topicBreakdown(marked.answers)
      });
    } },

  /* ------------------------------------------- console: reading notes */

  { method: 'GET', path: /^\/api\/notes$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const subject = url.searchParams.get('subject') || '';
      const topic = url.searchParams.get('topic') || '';
      const activeOnly = url.searchParams.get('activeOnly') === 'true';
      const rows = db.notes.filter(n => {
        if (subject && n.subject !== subject) return false;
        if (topic && n.topic !== topic) return false;
        if (activeOnly && !n.active) return false;
        return true;
      });
      okJson(res, { notes: rows, total: db.notes.length });
    } },

  { method: 'POST', path: /^\/api\/notes$/, need: 'console', handler: (req, res, body) => {
      const v = core.validateNote(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.noteSeq = (db.settings.noteSeq || 0) + 1;
      v.rec.id = db.settings.noteSeq;
      db.notes.push(v.rec);
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/notes\/(\d+)$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That note no longer exists.');
      const v = core.validateNote(Object.assign({}, cur, body));
      if (v.error) return errJson(res, 400, v.error);
      v.rec.id = cur.id;
      db.notes[db.notes.indexOf(cur)] = v.rec;
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/notes\/(\d+)\/active$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That note no longer exists.');
      cur.active = !!body.active;
      writeData(db);
      okJson(res, cur);
    } },

  /* Bulk import of notes from a CSV. The parsing and every per-row decision is
     core.importCSV — the same helper the browser mock uses — so a file that is
     accepted here is accepted there, and a row refused here is refused there.
     Good rows are written; bad rows come back by line number. Every run — not
     just the good rows inside it — is also logged (see logImport below), so
     the console can show what was imported earlier, not only the run just
     finished in this browser tab. */
  { method: 'POST', path: /^\/api\/notes\/import$/, need: 'console', handler: (req, res, body, sess) => {
      const csvText = body && body.csv;
      const filename = body && body.filename ? String(body.filename).slice(0, 200) : null;
      const fingerprint = core.csvFingerprint(csvText);
      const db = readData();
      const dup = findDuplicateImport(db, 'notes', filename, fingerprint);
      if (dup && !(body && body.confirmDuplicate)) {
        return okJson(res, { duplicate: dup });
      }
      const r = core.importCSV('notes', csvText);
      if (r.error) return errJson(res, 400, r.error);
      const ids = [];
      r.records.forEach(rec => {
        db.settings.noteSeq = (db.settings.noteSeq || 0) + 1;
        rec.id = db.settings.noteSeq;
        db.notes.push(rec);
        ids.push(rec.id);
      });
      logImport(db, { kind: 'notes', filename, fingerprint, read: r.read,
                       added: ids.length, skipped: r.errors.length, by: sess && sess.data && sess.data.id });
      writeData(db);
      okJson(res, { read: r.read, added: ids.length, ids,
                    skipped: r.errors.length, errors: r.errors, total: db.notes.length });
    } },

  /* ============================ Priorities 10-12: the Scholar League
     Overall academic performance decides the order; XP is only the
     tie-breaker. XP alone can never lift a student above a better performer.

     Cohort-scoped (added alongside the cohorts feature): a signed-in
     student only ranks against their own cohort-mates — every student
     sharing their exact cohort, or, if they carry no cohort, every other
     uncohorted student. That keeps two cohorts running different study
     policies from being ranked against each other on the same table. A
     student with no cohort at all (the state of every student before this
     feature, and every student in an academy that has never created a
     cohort) still ranks against the whole roster, exactly as before —
     nothing changes until a cohort actually exists and is assigned.
     Staff always see the unscoped, whole-academy table; the admin console
     narrows it further with its own cohort filter, client-side, the same
     way the Results panel already does. */
  { method: 'GET', path: /^\/api\/league$/, need: 'staff-or-student', handler: async (req, res, body, sess) => {
      const db = readData();
      const me = sess.data.role === 'student' ? sess.data.id : null;
      const students = appwriteDatabases
        ? await listAppwriteStudents()
        : db.students;
      const active = students.filter(s => s.active !== false);

      let pool = active;
      let scopeCohortId = null;
      if (me) {
        const myRec = active.find(s => s.id === me);
        scopeCohortId = myRec ? (myRec.cohort || null) : null;
        pool = active.filter(s => (s.cohort || null) === scopeCohortId);
      }

      const cohorts = await listAllCohorts();
      const cohortName = id => {
        const c = id && cohorts.find(x => x.cohortId === id);
        return c ? c.name : null;
      };

      const rows = pool.map(s => {
        const p = perfFor(db, s.id);
        return {
          scholarId: s.id, name: s.name, xp: s.xp || 0, streak: s.streak || 0,
          level: core.levelFor(s.xp || 0),
          performance: p.overall, assessed: p.markedAttempts,
          me: s.id === me,
          cohortId: s.cohort || null,
          cohortName: cohortName(s.cohort || null)
        };
      });
      const ranked = core.rankLeague(rows);
      const mine = ranked.find(r => r.me) || null;
      okJson(res, {
        rows: ranked, size: ranked.length, me: mine,
        league: core.leagueName(mine ? mine.rank : 1, ranked.length),
        basis: 'Overall academic performance first, then Academy XP.',
        /* Present only for a student, and only once they actually carry a
           cohort — mirrors effectiveSettingsFor's cohortId/cohortName shape
           so a client already reading one recognises the other. */
        scope: (me && scopeCohortId) ? { cohortId: scopeCohortId, cohortName: cohortName(scopeCohortId) } : null
      });
    } },

  /* ================================ Priority 4: the console question bank
     One bank, extended — not a second question system. */

  /* Section×subject totals for the admin "Question bank" screen's summary bar
     (Web Test sections counted individually, Practice counted separately) and
     for the Practice panel's per-subject breakdown. Computed here, once, over
     the whole bank so the console never has to page every question to the
     browser just to show a count. */
  /* ================================ Topic management
     Topics are derived from the question bank. The declared topic inventory
     remains available through core.topicInventory(), while liveQuestions
     counts only active questions so the console can distinguish published
     material from inactive rows. */ 
  { method: 'GET', path: /^\/api\/topics$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const subject = (url.searchParams.get('subject') || '').trim();

      const subjects = core.ALL_SUBJECTS.slice();
      const topics = [];

      const inventory = core.topicInventory(
        db.questions || [],
        db.notes || [],
        subject || null,
        Array.isArray(db.topics) ? db.topics : []
      );

      inventory.forEach(item => {
        const topic = item.topic || 'General';
        const rows = (db.questions || []).filter(q =>
          (!subject || q.subject === subject) &&
          (q.topic || 'General') === topic
        );

        topics.push({
          topic,
          questions: rows.length,
          liveQuestions: rows.filter(q => q.active !== false).length,
          notes: (db.notes || []).filter(n =>
            (!subject || n.subject === subject) &&
            (n.topic || 'General') === topic &&
            n.active !== false
          ).length
        });
      });

      /* Include topics carried by questions even when they are not present in
         the declared inventory. This keeps the console truthful for existing
         banks created before declared-topic support existed. */
      const seen = new Set(topics.map(t => t.topic.toLowerCase()));

      (db.questions || []).forEach(q => {
        if (subject && q.subject !== subject) return;
        const topic = q.topic || 'General';
        const key = topic.toLowerCase();
        if (seen.has(key)) return;

        const rows = (db.questions || []).filter(x =>
          (!subject || x.subject === subject) &&
          (x.topic || 'General') === topic
        );

        topics.push({
          topic,
          questions: rows.length,
          liveQuestions: rows.filter(x => x.active !== false).length,
          notes: (db.notes || []).filter(n =>
            (!subject || n.subject === subject) &&
            (n.topic || 'General') === topic &&
            n.active !== false
          ).length
        });

        seen.add(key);
      });

      okJson(res, { subjects, topics });
    } },

  { method: 'POST', path: /^\/api\/topics\/rename$/, need: 'console', handler: (req, res, body) => {
      const subject = body && typeof body.subject === 'string'
        ? body.subject.trim()
        : '';
      const from = body && typeof body.from === 'string'
        ? body.from.trim()
        : '';
      const to = body && typeof body.to === 'string'
        ? body.to.trim()
        : '';

      if (!subject) return errJson(res, 400, 'Choose a subject.');
      if (!from) return errJson(res, 400, 'Choose the topic to rename.');

      const valid = core.validateTopic(to);
      if (valid.error) return errJson(res, 400, valid.error);

      if (from.toLowerCase() === valid.topic.toLowerCase()) {
        return errJson(res, 400, 'The topic already has that name.');
      }

      const db = readData();

      const matchingQuestions = (db.questions || []).filter(q =>
        q.subject === subject &&
        (q.topic || 'General').toLowerCase() === from.toLowerCase()
      );

      const matchingNotes = (db.notes || []).filter(n =>
        n.subject === subject &&
        (n.topic || 'General').toLowerCase() === from.toLowerCase()
      );

      if (!matchingQuestions.length && !matchingNotes.length) {
        return errJson(res, 404, 'That topic is not carried by any question or note.');
      }

      const targetExists =
        (db.questions || []).some(q =>
          q.subject === subject &&
          (q.topic || 'General').toLowerCase() === valid.topic.toLowerCase()
        ) ||
        (db.notes || []).some(n =>
          n.subject === subject &&
          (n.topic || 'General').toLowerCase() === valid.topic.toLowerCase()
        );

      const movedQuestions = core.renameTopicIn(
        db.questions,
        subject,
        from,
        valid.topic
      );

      const movedNotes = core.renameTopicIn(
        db.notes,
        subject,
        from,
        valid.topic
      );

      if (Array.isArray(db.topics)) {
        core.renameTopicIn(db.topics, subject, from, valid.topic);
      }

      writeData(db);

      const topics = [];
      const seen = new Set();

      (db.questions || []).forEach(q => {
        if (q.subject !== subject) return;
        const topic = q.topic || 'General';
        const key = topic.toLowerCase();
        if (seen.has(key)) return;

        const rows = db.questions.filter(x =>
          x.subject === subject &&
          (x.topic || 'General') === topic
        );

        topics.push({
          topic,
          questions: rows.length,
          liveQuestions: rows.filter(x => x.active !== false).length,
          notes: db.notes.filter(n =>
            n.subject === subject &&
            (n.topic || 'General') === topic &&
            n.active !== false
          ).length
        });

        seen.add(key);
      });

      (db.notes || []).forEach(n => {
        if (n.subject !== subject) return;
        const topic = n.topic || 'General';
        const key = topic.toLowerCase();
        if (seen.has(key)) return;

        topics.push({
          topic,
          questions: 0,
          liveQuestions: 0,
          notes: db.notes.filter(x =>
            x.subject === subject &&
            (x.topic || 'General') === topic &&
            x.active !== false
          ).length
        });

        seen.add(key);
      });

      okJson(res, {
        subject,
        from,
        to: valid.topic,
        questions: movedQuestions,
        notes: movedNotes,
        merged: targetExists,
        topics
      });
    } },

  { method: 'GET', path: /^\/api\/questions\/counts$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const bySubject = {};
      const totals = { theory: 0, objective: 0, jamb: 0, practice: 0 };
      db.questions.forEach(q => {
        const sub = q.subject || 'Unknown';
        if (!bySubject[sub]) bySubject[sub] = { theory: 0, objective: 0, jamb: 0, practice: 0 };
        const sec = q.section;
        if (Object.prototype.hasOwnProperty.call(totals, sec)) {
          bySubject[sub][sec]++;
          totals[sec]++;
        }
      });
      okJson(res, { bySubject, totals });
    } },

  { method: 'GET', path: /^\/api\/questions$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const f = {
        subject: url.searchParams.get('subject') || '',
        section: url.searchParams.get('section') || '',
        kind: url.searchParams.get('kind') || '',
        activeOnly: url.searchParams.get('activeOnly') === 'true'
      };
      const rows = db.questions.filter(q => {
        if (f.subject && q.subject !== f.subject) return false;
        if (f.section && q.section !== f.section) return false;
        /* No period filter: there is one test, and a record written when the
           academy ran weekly and monthly papers still belongs to it. */
        if (f.kind && q.kind !== f.kind) return false;
        if (f.activeOnly && !q.active) return false;
        return true;
      });
      okJson(res, { questions: rows, total: db.questions.length });
    } },

  { method: 'POST', path: /^\/api\/questions$/, need: 'console', handler: (req, res, body) => {
      const v = core.validateQuestion(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
      v.rec.id = db.settings.questionSeq;
      db.questions.push(v.rec);
      writeData(db);
      okJson(res, v.rec);
    } },

  /* Bulk import of questions from a CSV, parsed by the shared core helper so the
     server and the browser mock accept exactly the same file. A row that would
     have been refused on the form is refused here too and reported by its line
     number; the rows that pass are published. Logged the same way notes import
     is, right below.
     subject/section (both optional here, on purpose): the target the admin
     picked on the import screen before choosing a file. Left unsent, a file
     imports exactly as it always has — nothing here requires them, so every
     caller that predates the subject/section pickers (including this file's
     own tests) keeps working. Sent, core.importCSV refuses any row that
     doesn't match rather than importing it under the file's own claim, and
     the target rides along into the duplicate check and the log so a second,
     legitimate run of the same file against a different target is never
     mistaken for a re-run of the same import. */
  { method: 'POST', path: /^\/api\/questions\/import$/, need: 'console', handler: (req, res, body, sess) => {
      const csvText = body && body.csv;
      const filename = body && body.filename ? String(body.filename).slice(0, 200) : null;
      const subject = body && body.subject ? String(body.subject).trim() : '';
      const section = body && body.section ? String(body.section).trim().toLowerCase() : '';
      const target = (subject || section) ? { subject, section } : null;
      const targetKey = target ? (target.subject + '/' + target.section) : null;
      const fingerprint = core.csvFingerprint(csvText);
      const db = readData();
      const dup = findDuplicateImport(db, 'questions', filename, fingerprint, targetKey);
      if (dup && !(body && body.confirmDuplicate)) {
        return okJson(res, { duplicate: dup });
      }
      const r = core.importCSV('questions', csvText, target);
      if (r.error) return errJson(res, 400, r.error);
      const ids = [];
      r.records.forEach(rec => {
        db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
        rec.id = db.settings.questionSeq;
        db.questions.push(rec);
        ids.push(rec.id);
      });
      logImport(db, { kind: 'questions', filename, fingerprint, target: targetKey, read: r.read,
                       added: ids.length, skipped: r.errors.length, by: sess && sess.data && sess.data.id });
      writeData(db);
      okJson(res, { read: r.read, added: ids.length, ids,
                    skipped: r.errors.length, errors: r.errors, total: db.questions.length });
    } },

  /* What has been imported before — so the console can show it, and an admin
     about to run a file can first check it wasn't already run. Newest first,
     capped at 30: this is a "what came in recently" list, not a full audit
     trail, so it stays small and fast without its own pruning job. */
  { method: 'GET', path: /^\/api\/import\/history$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const log = Array.isArray(db.importLog) ? db.importLog : [];
      okJson(res, { imports: log.slice(-30).reverse() });
    } },

  { method: 'PUT', path: /^\/api\/questions\/(\d+)$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = findQ(db, params[0]);
      if (!cur) return errJson(res, 404, 'That question no longer exists.');
      const v = core.validateQuestion(Object.assign({}, cur, body));
      if (v.error) return errJson(res, 400, v.error);
      v.rec.id = cur.id;
      db.questions[db.questions.indexOf(cur)] = v.rec;
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/questions\/(\d+)\/active$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = findQ(db, params[0]);
      if (!cur) return errJson(res, 404, 'That question no longer exists.');
      cur.active = !!body.active;
      writeData(db);
      okJson(res, cur);
    } },

  /* A question may only be deleted once it is unpublished (held back) — the
     same cancel/complete-before-delete pattern used for live classes. This
     stops a question a student is mid-way through answering from being
     pulled out from under them; deactivate it first, then delete it. */
  { method: 'DELETE', path: /^\/api\/questions\/(\d+)$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = findQ(db, params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (cur.active) return errJson(res, 400, 'Deactivate this question before deleting it.');
      db.questions.splice(db.questions.indexOf(cur), 1);
      writeData(db);
      okJson(res, { ok: true, deleted: cur.id });
    } },

  /* Bulk delete by subject/section, for clearing out a whole slice of the
     Question Bank at once (e.g. re-importing a subject from scratch).
     "all" must be typed explicitly for either field — a blank or missing
     value is refused rather than treated as "everything", so a client bug
     that forgets to fill in the selector can never wipe the bank. Subject
     matches exactly (after trimming) against the same ALL_SUBJECTS list
     validateQuestion uses; section is normalized with the same csvSection
     logic the CSV importer already uses, so "Practice-only" from a form and
     "practice" from a script land on the same bucket. This route is
     intentionally registered after the single-question DELETE above: /bulk
     never matches the numeric-id pattern, but keeping the specific route
     ahead of nothing more general avoids any future ambiguity. */
  { method: 'DELETE', path: /^\/api\/questions\/bulk$/, need: 'console', handler: (req, res, body) => {
      const rawSubject = body && body.subject !== undefined && body.subject !== null ? String(body.subject).trim() : '';
      const rawSection = body && body.section !== undefined && body.section !== null ? String(body.section).trim() : '';
      if (!rawSubject || !rawSection) {
        return errJson(res, 400, 'Choose a subject and a section (or "all") before deleting.');
      }
      const subjectAll = rawSubject.toLowerCase() === 'all';
      const sectionAll = rawSection.toLowerCase() === 'all';
      let subject = rawSubject;
      if (!subjectAll && core.ALL_SUBJECTS.indexOf(subject) === -1) {
        return errJson(res, 400, 'Choose one of the academy\u2019s subjects, or "all".');
      }
      let section = rawSection;
      if (!sectionAll) {
        section = core.csvSection(rawSection);
        if (!section) {
          return errJson(res, 400, 'Choose a section: theory, objective, JAMB-oriented, practice-only, or "all".');
        }
      }
      const db = readData();
      const matches = db.questions.filter(q => {
        if (!subjectAll && q.subject !== subject) return false;
        if (!sectionAll && q.section !== section) return false;
        return true;
      });
      const deletedCount = matches.length;
      if (deletedCount > 0) {
        const matchSet = new Set(matches);
        db.questions = db.questions.filter(q => !matchSet.has(q));
        writeData(db);
      }
      okJson(res, {
        ok: true,
        deleted: deletedCount,
        remaining: db.questions.length,
        subject: subjectAll ? 'all' : subject,
        section: sectionAll ? 'all' : section
      });
    } },

  /* ==================== Priority 4.3-4.5: results and manual theory marking
     Every row is identified by Scholar ID. Theory is never scored
     automatically — an administrator awards each mark. */

  { method: 'GET', path: /^\/api\/results$/, need: 'console', handler: (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const g = k => url.searchParams.get(k) || '';
      const rows = db.attempts.filter(a => {
        if (g('scholarId') && a.scholarId !== g('scholarId').toUpperCase()) return false;
        if (g('subject') && a.subject !== g('subject')) return false;
        if (g('section') && a.section !== g('section')) return false;
        /* One test, so an attempt is never hidden by the period it stored. */
        if (g('status') && a.status !== g('status')) return false;
        return true;
      }).slice().sort((a, b) => b.submittedAt - a.submittedAt);
      okJson(res, {
        results: rows.map(attemptSummary),
        awaitingMarking: db.attempts.filter(a => a.status === 'awaiting-marking').length,
        total: db.attempts.length
      });
    } },

  { method: 'GET', path: /^\/api\/results\/([A-Za-z0-9-]+)$/, need: 'console', handler: (req, res, body, sess, params) => {
      const db = readData();
      const a = db.attempts.find(x => String(x.id) === params[0]);
      if (!a) return errJson(res, 404, 'That result no longer exists.');
      const out = attemptSummary(a);
      out.durationSec = a.durationSec;
      out.markedBy = a.markedBy || null;
      out.answers = a.answers.map(r => {
        const q = findQ(db, r.questionId) || {};
        return {
          questionId: r.questionId, kind: r.kind, topic: r.topic,
          text: q.text || '', options: (q.options || []).slice(),
          answer: q.answer, expected: q.expected || '',
          given: r.given, isCorrect: r.isCorrect,
          markAwarded: r.markAwarded, maxMark: r.maxMark
        };
      });
      out.breakdown = a.status === 'marked' ? core.topicBreakdown(a.answers) : [];
      okJson(res, out);
    } },

  { method: 'POST', path: /^\/api\/results\/([A-Za-z0-9-]+)\/mark$/, need: 'console', handler: async (req, res, body, sess, params) => {
      // Same lost-update risk as the test-submit route above: the Appwrite
      // branch awaits an XP update between reading and writing the local
      // file, so the whole read-mark-write cycle is held under one lock.
      const result = await withDataLock(async () => {
        const db = readData();
        const a = db.attempts.find(x => String(x.id) === params[0]);
        if (!a) return { error: [404, 'That result no longer exists.'] };
        if (a.section !== 'theory') return { error: [400, 'Only theory papers are marked by hand.'] };
        const was = a.status;
        core.applyTheoryMarks(a, body.marks || {});
        a.markedBy = sess.data.id;
        a.markedAt = Date.now();

        if (was !== 'marked' && a.status === 'marked') {
          const extra = Math.max(0, core.xpForAttempt(a.percent) - (a.xpAwarded || 0));
          a.xpAwarded = (a.xpAwarded || 0) + extra;

          if (appwriteDatabases) {
            const stu = await getAppwriteStudentOrNull(a.scholarId);
            if (!stu) return { error: [404, 'That Scholar ID is no longer on the roster.'] };
            if (extra > 0) {
              await updateAppwriteStudent(a.scholarId, {
                xp: (stu.xp || 0) + extra
              });
            }
          } else {
            const stu = db.students.find(x => x.id === a.scholarId);
            if (stu) stu.xp = (stu.xp || 0) + extra;
          }
        }

        writeData(db);
        return { a };
      });

      if (result.error) return errJson(res, result.error[0], result.error[1]);
      okJson(res, attemptSummary(result.a));
    } },

  { method: 'GET', path: /^\/api\/resources$/, need: 'student', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');

      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        [
          Query.equal('published', true),
          Query.limit(5000)
        ]
      );

      const resources = result.documents.map(doc => ({
        resourceId: doc.resourceId || doc.$id,
        title: doc.title || '',
        description: doc.description || '',
        subject: doc.subject || '',
        category: doc.category || '',
        fileType: doc.fileType || '',
        storageFileId: doc.storageFileId || '',
        published: true,
        createdAt: doc.$createdAt || null,
        updatedAt: doc.$updatedAt || null
      }));

      resources.sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );

      return okJson(res, { resources });
    } catch (err) {
      console.error('[goc] Student resource list failed:', err.message);
      return errJson(res, 500, 'Could not load resources.');
    }
  } },

  { method: 'GET', path: /^\/api\/resources\/([A-Za-z0-9._-]+)\/file$/, need: 'student', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases || !appwriteResourcesStorage) {
      return errJson(res, 503, 'Resource storage is not available.');
    }

    const resourceId = params[0];

    try {
      const doc = await appwriteDatabases.getDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        resourceId
      );

      if (!doc || !doc.published) {
        return errJson(res, 404, 'That resource is not available.');
      }

      if (!doc.storageFileId) {
        return errJson(res, 404, 'The resource file is missing.');
      }

      const fileData = await appwriteResourcesStorage.getFileView(
        APPWRITE_BUCKET_ID,
        doc.storageFileId
      );

      const ext = String(doc.fileType || '').toLowerCase();

      const mimeTypes = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        zip: 'application/zip',
        mp4: 'video/mp4'
      };

      const mime = mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store'
      });

      res.end(Buffer.from(fileData));
    } catch (err) {
      console.error('[goc] Resource file request failed:', err.message);
      return errJson(res, 404, 'Could not open that resource.');
    }
  } },

  { method: 'GET', path: /^\/api\/admin\/resources$/, need: 'console', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');
      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        [Query.limit(5000)]
      );

      const resources = result.documents.map(doc => ({
        resourceId: doc.resourceId || doc.$id,
        title: doc.title || '',
        description: doc.description || '',
        subject: doc.subject || '',
        category: doc.category || '',
        fileType: doc.fileType || '',
        storageFileId: doc.storageFileId || '',
        published: !!doc.published,
        createdAt: doc.$createdAt || null,
        updatedAt: doc.$updatedAt || null
      }));

      resources.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return okJson(res, { resources });
    } catch (err) {
      console.error('[goc] Resource list failed:', err.message);
      return errJson(res, 500, 'Could not load resources.');
    }
  } },

  { method: 'PUT', path: /^\/api\/admin\/resources\/([A-Za-z0-9._-]+)\/published$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const resourceId = params[0];
    const published = body && typeof body.published === 'boolean'
      ? body.published
      : null;

    if (published === null) {
      return errJson(res, 400, 'Published must be true or false.');
    }

    try {
      const doc = await appwriteDatabases.updateDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        resourceId,
        { published }
      );

      return okJson(res, {
        resource: {
          resourceId: doc.resourceId || doc.$id,
          title: doc.title || '',
          description: doc.description || '',
          subject: doc.subject || '',
          category: doc.category || '',
          fileType: doc.fileType || '',
          storageFileId: doc.storageFileId || '',
          published: !!doc.published,
          createdAt: doc.$createdAt || null,
          updatedAt: doc.$updatedAt || null
        }
      });
    } catch (err) {
      console.error('[goc] Resource publish update failed:', err.message);
      return errJson(res, 500, 'Could not update the resource publication status.');
    }
  } },

  { method: 'POST', path: /^\/api\/admin\/resources\/upload$/, need: 'console', multipart: true, handler: (req, res, body, sess) => {
    return handleResourceUpload(req, res, sess);
  } },

  /* Permanently removes a resource's database record (and, best-effort, its
     stored file). Deliberately refuses to touch a published resource — an
     admin has to unpublish first, so a live student-facing document can
     never be deleted by accident. This also covers the "the file is gone
     from Appwrite storage but the record is still listed" case: if the
     stored file was already removed some other way, that file-delete call
     just fails quietly and the (now-empty) database record still gets
     cleared out. */
  { method: 'DELETE', path: /^\/api\/admin\/resources\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const resourceId = params[0];
    let doc = null;

    try {
      doc = await appwriteDatabases.getDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        resourceId
      );
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        // Already gone — nothing left to delete, so treat this as success
        // rather than making the admin fight a stale row in the list.
        return okJson(res, { ok: true, deleted: resourceId, alreadyGone: true });
      }
      console.error('[goc] Resource lookup before delete failed:', err.message);
      return errJson(res, 500, 'Could not look up that resource.');
    }

    if (doc && doc.published) {
      return errJson(res, 400, 'Unpublish this resource before deleting it.');
    }

    if (doc && doc.storageFileId && appwriteResourcesStorage) {
      try {
        await appwriteResourcesStorage.deleteFile(APPWRITE_BUCKET_ID, doc.storageFileId);
      } catch (fileErr) {
        // The file may already be missing from storage (exactly the
        // situation this endpoint exists to clean up after) — log and
        // continue so the database record still gets removed.
        console.error('[goc] Resource file delete failed (continuing):', fileErr.message);
      }
    }

    try {
      await appwriteDatabases.deleteDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_RESOURCES_COLLECTION_ID,
        resourceId
      );
      return okJson(res, { ok: true, deleted: resourceId });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return okJson(res, { ok: true, deleted: resourceId, alreadyGone: true });
      }
      console.error('[goc] Resource delete failed:', err.message);
      return errJson(res, 500, 'Could not delete the resource.');
    }
  } },

  { method: 'GET', path: /^\/api\/videos$/, need: 'student', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');

      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        [
          Query.equal('published', true),
          Query.limit(5000)
        ]
      );

      const videos = result.documents.map(doc => ({
        videoId: doc.videoId || doc.$id,
        title: doc.title || '',
        subject: doc.subject || '',
        type: doc.type || 'lesson',
        tutor: doc.tutor || '',
        duration: doc.duration || '',
        storageFileId: doc.storageFileId || '',
        externalUrl: doc.externalUrl || '',
        published: true,
        createdAt: doc.$createdAt || null,
        updatedAt: doc.$updatedAt || null
      }));

      videos.sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );

      return okJson(res, { videos });
    } catch (err) {
      console.error('[goc] Student video list failed:', err.message);
      return errJson(res, 500, 'Could not load videos.');
    }
  } },

  { method: 'GET', path: /^\/api\/videos\/([A-Za-z0-9._-]+)\/file$/, need: 'student', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases || !appwriteResourcesStorage) {
      return errJson(res, 503, 'Video storage is not available.');
    }

    const videoId = params[0];

    try {
      const doc = await appwriteDatabases.getDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        videoId
      );

      if (!doc || !doc.published) {
        return errJson(res, 404, 'That video is not available.');
      }

      if (!doc.storageFileId) {
        return errJson(res, 404, 'This video has no stored file — it plays via its link instead.');
      }

      const localPath = await ensureVideoCached(doc.storageFileId);
      return streamVideoFile(req, res, localPath);
    } catch (err) {
      console.error('[goc] Video file request failed:', err.message);
      return errJson(res, 404, 'Could not open that video.');
    }
  } },

  { method: 'GET', path: /^\/api\/admin\/videos$/, need: 'console', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');
      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        [Query.limit(5000)]
      );

      const videos = result.documents.map(doc => ({
        videoId: doc.videoId || doc.$id,
        title: doc.title || '',
        subject: doc.subject || '',
        type: doc.type || 'lesson',
        tutor: doc.tutor || '',
        duration: doc.duration || '',
        storageFileId: doc.storageFileId || '',
        externalUrl: doc.externalUrl || '',
        published: !!doc.published,
        createdAt: doc.$createdAt || null,
        updatedAt: doc.$updatedAt || null
      }));

      videos.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return okJson(res, { videos });
    } catch (err) {
      console.error('[goc] Video list failed:', err.message);
      return errJson(res, 500, 'Could not load videos.');
    }
  } },

  { method: 'PUT', path: /^\/api\/admin\/videos\/([A-Za-z0-9._-]+)\/published$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const videoId = params[0];
    const published = body && typeof body.published === 'boolean'
      ? body.published
      : null;

    if (published === null) {
      return errJson(res, 400, 'Published must be true or false.');
    }

    try {
      const doc = await appwriteDatabases.updateDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        videoId,
        { published }
      );

      return okJson(res, {
        video: {
          videoId: doc.videoId || doc.$id,
          title: doc.title || '',
          subject: doc.subject || '',
          type: doc.type || 'lesson',
          tutor: doc.tutor || '',
          duration: doc.duration || '',
          storageFileId: doc.storageFileId || '',
          externalUrl: doc.externalUrl || '',
          published: !!doc.published,
          createdAt: doc.$createdAt || null,
          updatedAt: doc.$updatedAt || null
        }
      });
    } catch (err) {
      console.error('[goc] Video publish update failed:', err.message);
      return errJson(res, 500, 'Could not update the video publication status.');
    }
  } },

  { method: 'POST', path: /^\/api\/admin\/videos\/upload$/, need: 'console', multipart: true, handler: (req, res, body, sess) => {
    return handleVideoUpload(req, res, sess);
  } },

  /* Same rule as resource deletion: a published video must be unpublished
     first, so a live student-facing recording can never be deleted by
     accident. Best-effort removes the stored file (when there is one —
     a link-only video has none) before clearing the database record. */
  { method: 'DELETE', path: /^\/api\/admin\/videos\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const videoId = params[0];
    let doc = null;

    try {
      doc = await appwriteDatabases.getDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        videoId
      );
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return okJson(res, { ok: true, deleted: videoId, alreadyGone: true });
      }
      console.error('[goc] Video lookup before delete failed:', err.message);
      return errJson(res, 500, 'Could not look up that video.');
    }

    if (doc && doc.published) {
      return errJson(res, 400, 'Unpublish this video before deleting it.');
    }

    if (doc && doc.storageFileId && appwriteResourcesStorage) {
      try {
        await appwriteResourcesStorage.deleteFile(APPWRITE_BUCKET_ID, doc.storageFileId);
      } catch (fileErr) {
        console.error('[goc] Video file delete failed (continuing):', fileErr.message);
      }
      clearCachedVideo(doc.storageFileId);
    }

    try {
      await appwriteDatabases.deleteDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_VIDEOS_COLLECTION_ID,
        videoId
      );
      return okJson(res, { ok: true, deleted: videoId });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return okJson(res, { ok: true, deleted: videoId, alreadyGone: true });
      }
      console.error('[goc] Video delete failed:', err.message);
      return errJson(res, 500, 'Could not delete the video.');
    }
  } },

  /* ------------------------------------------------------------ classes
     Live classes (Zoom schedule). Lives only in Appwrite — same convention
     as resources/videos, no flat-file fallback. classFromDoc keeps the one
     mapping in one place instead of repeating it at every route. */

  { method: 'GET', path: /^\/api\/classes$/, need: 'student', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');
      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        [Query.limit(5000)]
      );

      const now = Date.now();
      const classes = result.documents
        .map(classFromDoc)
        .filter(c => c.status !== 'cancelled' && Date.parse(c.scheduledAt || '') >= now)
        .sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));

      return okJson(res, { classes });
    } catch (err) {
      console.error('[goc] Student class list failed:', err.message);
      return errJson(res, 500, 'Could not load classes.');
    }
  } },

  { method: 'GET', path: /^\/api\/admin\/classes$/, need: 'console', handler: async (req, res) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    try {
      const { Query } = require('node-appwrite');
      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        [Query.limit(5000)]
      );

      const classes = result.documents
        .map(classFromDoc)
        .sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));

      return okJson(res, { classes });
    } catch (err) {
      console.error('[goc] Class list failed:', err.message);
      return errJson(res, 500, 'Could not load classes.');
    }
  } },

  { method: 'POST', path: /^\/api\/admin\/classes\/upload$/, need: 'console', handler: async (req, res, body) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const b = body || {};
    const subject = clean(b.subject, 100);
    const topic = clean(b.topic, 200);
    const tutor = clean(b.tutor, 100);
    const zoomLink = clean(b.zoomLink, 500);
    const scheduledAtRaw = clean(b.scheduledAt, 60);
    const durationMin = Number(b.durationMin);

    if (!subject) return errJson(res, 400, 'Subject is required.');
    if (!topic) return errJson(res, 400, 'Topic is required.');
    if (!scheduledAtRaw || !Number.isFinite(Date.parse(scheduledAtRaw))) {
      return errJson(res, 400, 'A valid class date and time is required.');
    }
    if (!zoomLink || !/^https?:\/\//i.test(zoomLink)) {
      return errJson(res, 400, 'The Zoom link must start with http:// or https://.');
    }
    if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 600) {
      return errJson(res, 400, 'Duration must be a number of minutes between 1 and 600.');
    }

    const classId = 'CLS-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const record = {
      classId,
      subject,
      topic,
      tutor,
      scheduledAt: new Date(scheduledAtRaw).toISOString(),
      durationMin: Math.round(durationMin),
      zoomLink,
      status: 'scheduled'
    };

    try {
      await appwriteDatabases.createDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        classId,
        record
      );
      return okJson(res, { ok: true, class: record });
    } catch (err) {
      console.error('[goc] Class creation failed:', err.message);
      return errJson(res, 500, 'Could not schedule the class.');
    }
  } },

  /* Edits time/link/details, or sets status to 'cancelled'/'completed'. Only
     the fields actually sent are changed — same partial-update shape the
     rest of the console uses (e.g. settings). */
  { method: 'PUT', path: /^\/api\/admin\/classes\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const classId = params[0];
    const b = body || {};
    const patch = {};

    if (b.subject !== undefined) {
      patch.subject = clean(b.subject, 100);
      if (!patch.subject) return errJson(res, 400, 'Subject cannot be blank.');
    }
    if (b.topic !== undefined) {
      patch.topic = clean(b.topic, 200);
      if (!patch.topic) return errJson(res, 400, 'Topic cannot be blank.');
    }
    if (b.tutor !== undefined) patch.tutor = clean(b.tutor, 100);
    if (b.zoomLink !== undefined) {
      const link = clean(b.zoomLink, 500);
      if (!link || !/^https?:\/\//i.test(link)) {
        return errJson(res, 400, 'The Zoom link must start with http:// or https://.');
      }
      patch.zoomLink = link;
    }
    if (b.scheduledAt !== undefined) {
      const raw = clean(b.scheduledAt, 60);
      if (!raw || !Number.isFinite(Date.parse(raw))) {
        return errJson(res, 400, 'A valid class date and time is required.');
      }
      patch.scheduledAt = new Date(raw).toISOString();
    }
    if (b.durationMin !== undefined) {
      const durationMin = Number(b.durationMin);
      if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 600) {
        return errJson(res, 400, 'Duration must be a number of minutes between 1 and 600.');
      }
      patch.durationMin = Math.round(durationMin);
    }
    if (b.status !== undefined) {
      if (['scheduled', 'completed', 'cancelled'].indexOf(b.status) === -1) {
        return errJson(res, 400, 'Status must be scheduled, completed or cancelled.');
      }
      patch.status = b.status;
    }

    if (!Object.keys(patch).length) {
      return errJson(res, 400, 'Nothing to update.');
    }

    try {
      const doc = await appwriteDatabases.updateDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        classId,
        patch
      );
      return okJson(res, { class: classFromDoc(doc) });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return errJson(res, 404, 'That class no longer exists.');
      }
      console.error('[goc] Class update failed:', err.message);
      return errJson(res, 500, 'Could not update the class.');
    }
  } },

  /* Same "must not be live" family of guard the resources/videos delete
     routes use, adapted for a schedule instead of a publish flag: a class a
     student has already been told about (still 'scheduled') cannot just
     vanish — it must be cancelled or marked completed first. */
  { method: 'DELETE', path: /^\/api\/admin\/classes\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) {
      return errJson(res, 503, 'Appwrite Database is not initialized.');
    }

    const classId = params[0];
    let doc = null;

    try {
      doc = await appwriteDatabases.getDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        classId
      );
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return okJson(res, { ok: true, deleted: classId, alreadyGone: true });
      }
      console.error('[goc] Class lookup before delete failed:', err.message);
      return errJson(res, 500, 'Could not look up that class.');
    }

    if (doc && doc.status === 'scheduled') {
      return errJson(res, 400, 'Cancel or complete this class before deleting it.');
    }

    try {
      await appwriteDatabases.deleteDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_LIVECLASSES_COLLECTION_ID,
        classId
      );
      return okJson(res, { ok: true, deleted: classId });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) {
        return okJson(res, { ok: true, deleted: classId, alreadyGone: true });
      }
      console.error('[goc] Class delete failed:', err.message);
      return errJson(res, 500, 'Could not delete the class.');
    }
  } },

  /* ------------------------------------------------------------ cohorts
     A cohort is a named group of students that can override the academy's
     study-window / session-length / objective-clock / question-ceiling
     defaults. Lives only in Appwrite, same convention as classes/resources/
     videos — no flat-file fallback. cohortFromDoc + effectiveSettingsFor
     keep the mapping and the merge logic in one place each. */

  { method: 'GET', path: /^\/api\/admin\/cohorts$/, need: 'console', handler: async (req, res) => {
    if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
    try {
      const { Query } = require('node-appwrite');
      const result = await appwriteDatabases.listDocuments(
        APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, [Query.limit(5000)]
      );
      const cohorts = result.documents.map(cohortFromDoc)
        .sort((a, b) => a.name.localeCompare(b.name));
      return okJson(res, { cohorts });
    } catch (err) {
      console.error('[goc] Cohort list failed:', err.message);
      return errJson(res, 500, 'Could not load cohorts.');
    }
  } },

  { method: 'POST', path: /^\/api\/admin\/cohorts$/, need: 'console', handler: async (req, res, body) => {
    if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
    const b = body || {};
    const name = clean(b.name, 100);
    if (!name) return errJson(res, 400, 'A cohort name is required.');

    const cohortId = 'COH-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const record = { cohortId, name, status: 'active' };
    ['dailyLimitMin', 'sessionMinutes', 'sessionWarnMinutes', 'objectiveMinutes'].forEach(f => {
      if (b[f] !== undefined && b[f] !== null && b[f] !== '') record[f] = Number(b[f]);
    });
    if (b.objectiveCounts && typeof b.objectiveCounts === 'object') {
      record.objectiveCounts = JSON.stringify(b.objectiveCounts);
    }

    try {
      await appwriteDatabases.createDocument(APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, cohortId, record);
      return okJson(res, { ok: true, cohort: cohortFromDoc(record) });
    } catch (err) {
      console.error('[goc] Cohort creation failed:', err.message);
      return errJson(res, 500, 'Could not create the cohort.');
    }
  } },

  /* Partial update: rename, change status, or change any of the four
     overrides. Sending a field as null clears that override back to
     "inherit the academy default" rather than leaving the old number
     stuck — the same intent {field: null} carries everywhere else in
     this API when a value should go back to unset. */
  { method: 'PUT', path: /^\/api\/admin\/cohorts\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
    const cohortId = params[0];
    const b = body || {};
    const patch = {};

    if (b.name !== undefined) {
      patch.name = clean(b.name, 100);
      if (!patch.name) return errJson(res, 400, 'Cohort name cannot be blank.');
    }
    if (b.status !== undefined) {
      if (['active', 'draft'].indexOf(b.status) === -1) return errJson(res, 400, 'Status must be active or draft.');
      patch.status = b.status;
    }
    ['dailyLimitMin', 'sessionMinutes', 'sessionWarnMinutes', 'objectiveMinutes'].forEach(f => {
      if (b[f] !== undefined) patch[f] = (b[f] === null || b[f] === '') ? null : Number(b[f]);
    });
    if (b.objectiveCounts !== undefined) {
      patch.objectiveCounts = b.objectiveCounts && typeof b.objectiveCounts === 'object'
        ? JSON.stringify(b.objectiveCounts) : null;
    }
    if (!Object.keys(patch).length) return errJson(res, 400, 'Nothing to update.');

    try {
      const doc = await appwriteDatabases.updateDocument(APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, cohortId, patch);
      return okJson(res, { cohort: cohortFromDoc(doc) });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) return errJson(res, 404, 'That cohort no longer exists.');
      console.error('[goc] Cohort update failed:', err.message);
      return errJson(res, 500, 'Could not update the cohort.');
    }
  } },

  /* Guarded the same way topics/resources deletes are: a cohort still
     holding students cannot simply vanish out from under them. Reassign
     or clear every student's cohort first. */
  { method: 'DELETE', path: /^\/api\/admin\/cohorts\/([A-Za-z0-9._-]+)$/, need: 'console', handler: async (req, res, body, sess, params) => {
    if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
    const cohortId = params[0];

    try {
      const db = readData();
      const students = await listAppwriteStudents();
      const inUse = students.some(s => s.cohort === cohortId);
      if (inUse) return errJson(res, 400, 'Move every student out of this cohort before deleting it.');

      await appwriteDatabases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_COHORTS_COLLECTION_ID, cohortId);
      return okJson(res, { ok: true, deleted: cohortId });
    } catch (err) {
      if (err && (err.code === 404 || err.status === 404)) return okJson(res, { ok: true, deleted: cohortId, alreadyGone: true });
      console.error('[goc] Cohort delete failed:', err.message);
      return errJson(res, 500, 'Could not delete the cohort.');
    }
  } },

  /* Assigns (or clears, with cohortId: null) the cohort a student belongs
     to. Works in both storage modes, same dual-path shape as the existing
     .../active route just above it in this file. */
  { method: 'PUT', path: /^\/api\/students\/([A-Za-z0-9-]+)\/cohort$/, need: 'console', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();
      const cohortId = body.cohortId == null || body.cohortId === '' ? null : String(body.cohortId);

      if (cohortId && appwriteDatabases) {
        const cohort = await getCohortOrNull(cohortId);
        if (!cohort) return errJson(res, 404, 'No such cohort.');
      }

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');
        const updated = await updateAppwriteStudent(studentId, { cohort: cohortId });
        const updatedStudent = appwriteStudentToRecord(updated);
        return okJson(res, publicStudent(db, updatedStudent, { console: true }));
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');
      s.cohort = cohortId;
      writeData(db);
      okJson(res, publicStudent(db, s, { console: true }));
    } },

  /* The cohort-resolved settings a signed-in student actually studies
     under — GET /api/settings stays as the academy-wide default (it has no
     session, so it has no way to know whose cohort to apply, and is still
     what the pre-login signup screen reads). This is additive: nothing
     that already calls /api/settings changes behaviour today. */
  { method: 'GET', path: /^\/api\/me\/settings$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const studentId = sess.data.id;
      const s = appwriteDatabases
        ? await getAppwriteStudentOrNull(studentId)
        : db.students.find(x => x.id === studentId);
      const cohort = s && s.cohort ? await getCohortOrNull(s.cohort) : null;
      const eff = effectiveSettingsFor(db, cohort);
      okJson(res, Object.assign(eff, core.studyWindowStatus(eff.dailyLimitMin, studySecToday(s), studyBonusMinToday(s))));
    } },

];

/* ============================================================ STATIC FILES */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8'
};

/* Only the app's own file types are ever served over the web. Everything else —
   readme.md (which lists the demo passwords), start-server.ps1, the blueprint
   PDF, server/schema.sql, and the import CSVs — is refused. This is an allow
   list on purpose: any sensitive file added later is denied by default. */
const SERVE_EXT = new Set(['.html', '.css', '.js', '.mjs', '.webmanifest', '.png', '.svg', '.ico']);

function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    // A malformed percent-escape (e.g. "/%") used to throw here and, with no
    // handler above it, take the whole server — and every signed-in student —
    // down with it. Now it is simply a bad request.
    res.writeHead(400); return res.end('Bad request');
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  // Resolve, then confirm the result is still inside ROOT. This is what stops
  // a crafted path like /../../secrets from escaping the app folder.
  const full = path.resolve(ROOT, '.' + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  // The server/ and test/ folders hold the database, the hashes and the test
  // fixtures; they are never served. The comparison is done in lower case
  // because Windows treats SERVER and server as the same folder — so an
  // upper-case request like /SERVER/data.json must be refused too.
  const lowerFull = full.toLowerCase();
  const denied = [path.join(ROOT, 'server'), path.join(ROOT, 'test')].map(d => d.toLowerCase());
  if (denied.some(d => lowerFull === d || lowerFull.startsWith(d + path.sep))) {
    res.writeHead(404); return res.end('Not found');
  }
  // Refuse anything that is not one of the app's own file types.
  if (!SERVE_EXT.has(path.extname(lowerFull))) {
    res.writeHead(404); return res.end('Not found');
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ================================================================ DISPATCH */

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath.indexOf('/api/') !== 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, urlPath);
  }

  const route = ROUTES.find(r => r.path.test(urlPath) && r.method === req.method);
  if (!route) {
    const pathExists = ROUTES.some(r => r.path.test(urlPath));
    return errJson(res, pathExists ? 405 : 404, pathExists ? 'Wrong method for that endpoint.' : 'No such endpoint.');
  }

  const sess = getSession(req);

  // Authorisation is decided here, once, for every route — never inside a handler.
  if (route.need === 'staff-or-student' && !sess) return errJson(res, 401, 'Please log in again.');

  if (route.need === 'student') {
    if (!sess) return errJson(res, 401, 'Your session has ended. Please log in again.');
    if (sess.data.role !== 'student') return errJson(res, 403, 'Student accounts only.');
    // During the Appwrite migration, Appwrite Database is the student source of truth.
    // The local data.json student roster is intentionally empty.
    if (!appwriteDatabases) {
      const roster = readData().students.find(s => s.id === sess.data.id);
      if (!roster || roster.active === false) {
        sessions.delete(sess.token);
        return errJson(res, 403, 'This account has been deactivated by your academy.');
      }
    }
  }

  if (route.need === 'staff' || route.need === 'console' || route.need === 'founder') {
    if (!sess) return errJson(res, 401, 'Please log in again.');
    if (sess.data.role !== 'admin') return errJson(res, 403, 'Management accounts only.');
    if (route.need !== 'staff' && !sess.data.unlocked) return errJson(res, 403, 'Enter the access passcode first.');
    // Priority 8 — the Founder check is a server-side gate, not a hidden button.
    if (route.need === 'founder' && sess.data.title !== 'Founder') {
      return errJson(res, 403, 'Only the Founder can change management credentials.');
    }
  }

  const params = (route.path.exec(urlPath) || []).slice(1);

  if (route.multipart) {
    Promise.resolve(route.handler(req, res, null, sess, params))
      .catch(err => {
        if (!res.headersSent) {
          errJson(res, 400, safeClientMessage(err, 'That request could not be handled.'));
        } else {
          console.error('[goc] Multipart route failed after response started:', err && err.stack || err);
        }
      });
    return;
  }

  readBody(req)
    .then(body => route.handler(req, res, body, sess, params))
    .catch(err => {
      if (!res.headersSent) errJson(res, 400, safeClientMessage(err, 'That request could not be handled.'));
    });
  });

// Last-resort safety net. Every request path already turns bad input into a
// 4xx, but if anything unforeseen ever throws, the process must not die and
// sign out every student mid-paper. Log it and stay up.
process.on('uncaughtException', err => {
  console.error('[goc] uncaught exception (kept running):', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', err => {
  console.error('[goc] unhandled promise rejection (kept running):', err && err.stack ? err.stack : err);
});

/* Appwrite mode loads the JSON backup into memory. Any failure leaves the local
  data file as the read/write fallback; startup never seeds or uploads here. */
async function initAppwrite() {
  const clientBundle = createAppwriteClient();
  if (!clientBundle) {
    throw new Error('Appwrite environment variables are not configured.');
  }

  const { client, storage, databases, users } = clientBundle;
  appwriteResourcesStorage = storage;
  appwriteDatabases = databases;
  appwriteUsers = users;

  // Appwrite Database is initialized independently of the old Storage backup.
  // The local data.json remains the temporary base for data not yet migrated.
  appwriteStorage = null;
  CACHE = null;

  console.log('[goc] Appwrite Database initialized; using local data.json for unmigrated data.');
  return client;
}

/* Whether this is a production-like run: NODE_ENV=production is the standard
   signal Render/Railway/most Node hosts already set, and GOC_NO_DEMO_SEED=1
   covers a production-like run that doesn't set NODE_ENV (kept as a legacy
   env var name so existing deploy configs don't need to change). */
function isProductionRun() {
  return process.env.NODE_ENV === 'production' || process.env.GOC_NO_DEMO_SEED === '1';
}

/* Phase 5 close-out: "confirm the server refuses to boot (or warns loudly) on
   a shipped default secret value in production." The roadmap accepts either
   behaviour, so this picks refuse-to-boot in a production-like run (per
   isProductionRun()) and a loud, impossible-to-miss banner everywhere else
   (local dev, a bare `node server/server.js` with nothing set).

   This runs on every boot against whatever is actually stored — not just at
   fresh-seed time — by re-hashing each published default and comparing it to
   the live stored hash with the same constant-time verifyPassword() used for
   real logins. That also catches an old data.json that was seeded years ago
   and never rotated, which a seed()-only check would miss entirely. */
function auditDefaultSecrets(db) {
  const flags = [];
  if (process.env.GOC_FOUNDER_PW === 'founder2027') {
    flags.push('GOC_FOUNDER_PW — Founder console login is still the published demo password.');
  }
  if (process.env.GOC_ACADDIR_PW === 'acaddir2027') {
    flags.push('GOC_ACADDIR_PW — Academic Director console login is still the published demo password.');
  }
  if (db.settings && verifyPassword('2027', db.settings.consolePasscodeHash)) {
    flags.push('GOC_PASSCODE — the console unlock passcode is still the published default (2027).');
  }
  if (db.settings && verifyPassword(core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT), db.settings.signupCodeHash)) {
    flags.push('GOC_SIGNUP_CODE — the create-account firewall is still the published default code.');
  }
  if (!flags.length) return;

  const isProd = isProductionRun();
  const lines = [
    '',
    '**********************************************************************',
    '*  [goc] SHIPPED DEFAULT SECRET(S) STILL ACTIVE                     *'
  ]
    .concat(isProd ? ['*  Refusing to start in production with a default secret live.      *'] : [])
    .concat(['**********************************************************************'])
    .concat(flags.map(f => '*  - ' + f))
    .concat([
      '*  Change these from Console -> Priority 8 / Access & firewall, or   *',
      '*  set the matching env var before the next boot.                    *',
      '**********************************************************************',
      ''
    ]);

  if (isProd) {
    // Production-like run (NODE_ENV=production or GOC_NO_DEMO_SEED=1): refuse
    // to boot rather than serve real students behind a published password.
    lines.forEach(l => console.error(l));
    process.exit(1);
  } else {
    lines.forEach(l => console.warn(l));
  }
}

/* Phase 5 close-out: a rotating local backup of server/data.json. This is
   the LOCAL-FILE path only — staff, settings, questions, notes, attempts and
   (in non-Appwrite installs) students all live in data.json, so this covers
   every install that isn't using Appwrite Database for students. It does
   NOT back up the Appwrite-hosted student records on a Database-backed
   install: that data never touches this file, so copying data.json there
   would give a false sense of safety. For that path, "backup" means a
   periodic export/snapshot pulled from Appwrite itself (Appwrite's own
   Database backup/export tooling, or a scheduled script using the Appwrite
   SDK to dump the Students collection) — a decision for whoever runs that
   install, since it needs real Appwrite credentials this sandbox doesn't
   have. Documented in DEPLOYMENT.md.

   Interval and retention are both configurable so a low-traffic install
   doesn't have to accept the defaults: GOC_BACKUP_INTERVAL_MIN (minutes
   between backups, default 360 = every 6h) and GOC_BACKUP_KEEP (how many
   timestamped copies to retain before pruning the oldest, default 28 — a
   week's worth at the default interval). Set GOC_BACKUP_INTERVAL_MIN=0 to
   disable entirely (e.g. for a throwaway local dev run). */
function backupOnce() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, 'data-' + stamp + '.json');
    fs.copyFileSync(DATA_FILE, dest);

    const keep = Math.max(1, Number(process.env.GOC_BACKUP_KEEP) || 28);
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^data-.*\.json$/.test(f))
      .sort(); // ISO-ish timestamps in the filename sort chronologically as text
    const excess = files.length - keep;
    if (excess > 0) {
      files.slice(0, excess).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* best-effort prune */ }
      });
    }
  } catch (err) {
    // A failed backup should never take the server down — log and move on.
    console.error('[goc] data.json backup failed (continuing):', err && err.message);
  }
}

function startBackupSchedule() {
  if (appwriteStorage) return; // legacy in-memory mode: no local file to back up
  const minutes = process.env.GOC_BACKUP_INTERVAL_MIN != null
    ? Number(process.env.GOC_BACKUP_INTERVAL_MIN)
    : 360;
  if (!minutes || minutes <= 0) {
    console.log('[goc] data.json backups disabled (GOC_BACKUP_INTERVAL_MIN=0).');
    return;
  }
  backupOnce(); // one at boot, so a restart doesn't leave a long gap
  setInterval(backupOnce, minutes * 60 * 1000);
  console.log('[goc] data.json backups: every ' + minutes + 'min, keeping last ' +
              (Number(process.env.GOC_BACKUP_KEEP) || 28) + ' in server/backups/.');
}

function seed() {
  /* The two management passwords are the only credentials in this file that
     matter after launch, because they open the console. The literals below are
     the demo values and are only used when nothing better is supplied: set
     GOC_FOUNDER_PW and GOC_ACADDIR_PW before the very first run and the
     published defaults are never written to data.json at all. Changing them
     later is done from the console (Priority 8), which is Founder-only. */
  if (!process.env.GOC_FOUNDER_PW || !process.env.GOC_ACADDIR_PW ||
      process.env.GOC_FOUNDER_PW === 'founder2027' ||
      process.env.GOC_ACADDIR_PW === 'acaddir2027') {
    console.warn('[goc] seeding management with a published demo password is unsafe. ' +
                 'Set GOC_FOUNDER_PW and GOC_ACADDIR_PW before launch.');
  }
  /* The create-account firewall: nobody opens an account without this code. */
  const signupWanted = core.normalizeSignupCode(process.env.GOC_SIGNUP_CODE || core.SIGNUP_CODE_DEFAULT);
  const signupCheck = core.validateSignupCode(signupWanted);
  if (signupCheck.error) {
    console.warn('[goc] GOC_SIGNUP_CODE was refused (' + signupCheck.error +
                 ') — seeding the published default instead.');
  }
  const signupSeedCode = signupCheck.code || core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
  if (signupSeedCode === core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT)) {
    console.warn('[goc] seeding the create-account firewall with the published ' +
                 'default access code. Change it from Console → Access & firewall ' +
                 'before a cohort registers, or anyone who has read the readme can ' +
                 'open an account.');
  }
  const db = {
    staff: [
      { id: 'GOC-A-001', name: 'Ernest Uzorchukwu', title: 'Founder' },
      { id: 'GOC-A-002', name: 'Itsemeh Victorian', title: 'Academic Director' }
    ],
    students: [],
    updates: [
      { id: 1, cat: 'utme', date: 'Aug 20, 2026', title: '2027 UTME Bootcamp registration is open', body: 'Our free UTME Bootcamp for the 2027 cohort has begun. Secure your spot, get a study plan across every JAMB subject, and start practising today.', ctaLabel: 'Join the bootcamp →', ctaAction: "go('signup')" },
      { id: 2, cat: 'admission', date: 'Aug 15, 2026', title: 'New student intake — limited pilot places', body: "We're admitting a small pilot group of students for tutoring and the Academy Hub. Early applicants get priority onboarding and mentorship.", ctaLabel: 'Enquire about admission →', ctaAction: 'scrollContactFromUpdates()' },
      { id: 3, cat: 'scholarship', date: 'Aug 10, 2026', title: 'Purpose-Driven Scholar award', body: 'Dedicated students who keep their study streaks and top the Weekly Scholar League can earn fee waivers and free premium access. Consistency is rewarded.', ctaLabel: 'Start earning it →', ctaAction: "go('signup')" },
      { id: 4, cat: 'news', date: 'Aug 5, 2026', title: 'AI Literacy program added to the curriculum', body: "Every G.O.C student now learns to use AI responsibly as a study partner — building independent thinking, not dependence. It's baked into the learning path.", ctaLabel: 'Learn more →', ctaAction: "go('landing')" },
      { id: 5, cat: 'news', date: 'Jul 28, 2026', title: 'Live Zoom classes now paired with the app', body: 'Attend interactive live classes on Zoom, then reinforce every lesson with practice and CBT mocks in the Academy Hub between sessions.', ctaLabel: 'See how it works →', ctaAction: "go('landing')" }
    ],
    questions: core.seedQuestions(),
    notes: core.seedNotes(),
    attempts: [],
    settings: {
      dailyLimitMin: 90,
      sessionMinutes: core.SESSION_DEFAULT,            // Priority 9 default
      sessionWarnMinutes: core.WARN_DEFAULT,           // Priority 9 warning lead time
      perfWeights: Object.assign({}, core.DEFAULT_WEIGHTS),   // Priority 11
      updateSeq: 100,
      questionSeq: core.seedQuestions().reduce((m, r) => Math.max(m, r.id), 0),
      noteSeq: core.seedNotes().reduce((m, r) => Math.max(m, r.id), 0),
      attemptSeq: 0,
      consolePasscodeHash: hashPassword(process.env.GOC_PASSCODE || '2027'),
      consolePasscodeLength: String(process.env.GOC_PASSCODE || '2027').length,
      /* The create-account firewall. Set GOC_SIGNUP_CODE before the first run and
         the published default is never written at all; otherwise change it from
         the console before a cohort registers. */
      signupCodeHash: hashPassword(signupSeedCode),
      signupCodeLength: signupSeedCode.length,
      signupCodeChangedAt: null,
      signupCodeChangedBy: null
    }
  };
  writeData(db);
  console.log('[goc] Created server/data.json with an empty student roster.');
}

function start() {
  // `appwriteStorage` is legacy from an earlier architecture (the whole-JSON-
  // blob-in-Appwrite-Storage design) and is never set truthy any more — the
  // Students collection replaced it. Checking it here silently always chose
  // 127.0.0.1, so a Railway deploy (which sets PORT but not HOST) would bind
  // to loopback and be unreachable even though the process stayed "up" and
  // passed its health check locally. The real signal for "this is a hosted
  // deploy, not someone double-clicking index.html" is a platform-assigned
  // PORT, or Appwrite Database being configured at all.
  const isHostedDeploy = !!process.env.PORT || !!appwriteDatabases;
  const HOST = process.env.HOST || (isHostedDeploy ? '0.0.0.0' : '127.0.0.1');
  // Boot-time gate: check whatever is actually stored (fresh seed or an old,
  // never-rotated data.json) against the published defaults before opening
  // the port. See auditDefaultSecrets() — exits the process in production.
  const startupDb = readData();
  auditDefaultSecrets(startupDb);
  writeData(startupDb);
  startBackupSchedule();
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  G.O.C Academy Hub is running');
    console.log('  Open:  http://localhost:' + PORT);
    console.log('  Stop:  press Ctrl+C');
    console.log('');
    if (HOST === '127.0.0.1') {
      console.log('  Bound to 127.0.0.1, so only this computer can reach it.');
    } else {
      console.log('  Bound to ' + HOST + ' (reachable from the network / internet — use HTTPS).');
    }
    console.log('  Storage: ' + (appwriteDatabases ? 'Appwrite Database (cloud)' : 'local file (server/data.json)'));
    console.log('  Console passcode: ' + (process.env.GOC_PASSCODE ? '(from GOC_PASSCODE)' : '2027'));
    console.log('');
  });
}

// On a clean shutdown (a redeploy sends SIGTERM), flush any pending save first.
process.on('SIGTERM', () => { appwriteSaveChain.finally(() => process.exit(0)); });

if (hasAppwriteConfig()) {
  initAppwrite()
    .then(() => {
      // Students live in Appwrite, but staff/settings/questions/etc. still
      // come from local data.json (see initAppwrite()'s own comment) — a
      // fresh Appwrite deploy with no data.json on disk yet had no seed()
      // call on this path at all, so start()'s new auditDefaultSecrets()
      // read (and the first real request needing staff/settings) would
      // throw ENOENT instead of creating the file. Found while wiring up
      // the Phase 5 boot-time secret audit; same guard the other two
      // startup paths already had.
      if (!fs.existsSync(DATA_FILE)) seed();
      start();
    })
    .catch(err => {
      // Without this catch, a failed Appwrite init (missing node-appwrite
      // package, a malformed client, etc.) left start() never called at
      // all: no crash, no error banner, the process just sat there with
      // no port bound and nothing in the log to say why. Fail loud instead,
      // reset anything initAppwrite() may have partially set, and still
      // bring the server up in local-file mode so a misconfigured Appwrite
      // key degrades the deployment instead of silently killing it.
      console.error('[goc] Appwrite initialization failed — falling back to local data.json.', err && err.stack || err);
      appwriteDatabases = null;
      appwriteResourcesStorage = null;
      appwriteUsers = null;
      if (!fs.existsSync(DATA_FILE)) seed();
      start();
    });
} else {
  if (!fs.existsSync(DATA_FILE)) seed();
  start();
}

/* ============================================================
   APPWRITE STUDENT REPOSITORY
   Students are stored in Appwrite Database.
   Other application data remains in server/data.json for now.
   ============================================================ */

async function listAppwriteStudents() {
  if (!appwriteDatabases) {
    throw new Error('Appwrite Database is not initialized.');
  }

  const { Query } = require('node-appwrite');

  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID,
    APPWRITE_STUDENTS_COLLECTION_ID,
    [
      Query.limit(5000)
    ]
  );

  return result.documents.map(appwriteStudentToRecord);
}

async function updateAppwriteStudent(studentId, patch) {
  if (!appwriteDatabases) {
    throw new Error('Appwrite Database is not initialized.');
  }

  return appwriteDatabases.updateDocument(
    APPWRITE_DATABASE_ID,
    APPWRITE_STUDENTS_COLLECTION_ID,
    studentId,
    patch
  );
}

async function getAppwriteStudentOrNull(studentId) {
  try {
    return await getAppwriteStudent(studentId);
  } catch (err) {
    if (err && (err.code === 404 || err.status === 404)) {
      return null;
    }
    throw err;
  }
}

async function nextAppwriteScholarId() {
  const students = await listAppwriteStudents();

  let max = 0;

  for (const student of students) {
    const match = String(student.id || '').match(/^GOC-S-(\d+)$/);
    if (!match) continue;

    const number = parseInt(match[1], 10);
    if (Number.isFinite(number) && number > max) {
      max = number;
    }
  }

  const next = max + 1;

  return 'GOC-S-' + (
    next < 10
      ? '00' + next
      : next < 100
        ? '0' + next
        : String(next)
  );
}
