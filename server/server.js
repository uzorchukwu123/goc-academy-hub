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
     Staff, settings, questions, notes, attempts, and (unless Appwrite Database
     is configured for students) the student roster all live in
     server/data.json. Set GOC_DATA_DIR to a persistent, non-ephemeral mount
     on your host so this file survives restarts/redeploys — see
     DEPLOYMENT.md. When Appwrite is configured (APPWRITE_ENDPOINT/
     APPWRITE_PROJECT_ID/APPWRITE_API_KEY), students live in an Appwrite
     Database collection instead, and uploaded resource/video files live in
     Appwrite Storage (APPWRITE_BUCKET_ID) — neither of those touches
     data.json.
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
const { pdfFromModel } = require('./pdf-writer');
const reminders = require('./lib/reminders');

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
/* Where data.json (and its backups) physically live. Defaults to this same
   server/ folder exactly as before — nothing changes for an existing install
   that doesn't set this. GOC_DATA_DIR exists so a production deploy can point
   this at a mounted persistent volume/disk: on most hosts (this project no
   longer assumes Render or Railway specifically) the container filesystem is
   recreated on every restart/redeploy, so anything left in the default path
   — imported questions, recorded test attempts, console settings — is lost
   the next time the process restarts unless GOC_DATA_DIR is set to a path
   that survives that restart. See TASKS-REMAINING.txt for the deployment
   step that actually wires this up on your host. */
const DATA_DIR = process.env.GOC_DATA_DIR ? path.resolve(process.env.GOC_DATA_DIR) : __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* already exists */ }
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/* ── One-time migration: if GOC_DATA_DIR is set and the target data.json does
   not yet exist there, copy the bundled server/data.json across so existing
   data (students, settings, questions) is not lost on first deploy with the
   persistent-dir change.  After this first copy the persistent file is the
   canonical source and the bundled copy is never read again. */
if (process.env.GOC_DATA_DIR) {
  const _bundledData = path.join(__dirname, 'data.json');
  if (!fs.existsSync(DATA_FILE) && fs.existsSync(_bundledData)) {
    try {
      fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
      fs.copyFileSync(_bundledData, DATA_FILE);
      console.log('[goc] Migrated bundled data.json → ' + DATA_FILE + ' (first boot with GOC_DATA_DIR).');
    } catch (e) {
      console.error('[goc] Could not migrate bundled data.json to GOC_DATA_DIR:', e.message);
    }
  }
}
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
const APPWRITE_TUTORS_COLLECTION_ID = 'tutors';
const APPWRITE_QUESTIONS_COLLECTION_ID = 'questions';
const APPWRITE_ATTEMPTS_COLLECTION_ID = 'attempts';
const APPWRITE_RESOURCES_COLLECTION_ID = 'resources';
const APPWRITE_VIDEOS_COLLECTION_ID = 'videos';
const APPWRITE_LIVECLASSES_COLLECTION_ID = 'liveclasses';
const APPWRITE_COHORTS_COLLECTION_ID = 'cohorts';
let appwriteResourcesStorage = null;
let appwriteDatabases = null;
let appwriteUsers = null;
let appwriteSaveChain = Promise.resolve();

async function createAppwriteAuthUser(rec) {
  if (!appwriteUsers) throw new Error('Appwrite Auth is not initialized.');

  const authEmail = rec.id.toLowerCase() + '@gocacademy.com';

  return appwriteUsers.create(
    require("node-appwrite").ID.unique(),
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
      /* Sent only when held: a deployment whose students collection has not
         yet had the integer attribute `streakFreezes` added must keep working. */
      ...(Number(rec.streakFreezes) > 0 ? { streakFreezes: Number(rec.streakFreezes) } : {}),
      /* Access tier (Phase 3B). Only 'goc' is ever written: an Open account
         stores nothing and reads back as Open, so a deployment whose students
         collection has not yet had the optional string attribute `tier` added
         can still register Open users. */
      ...(core.cleanTier(rec.tier) === 'goc' ? { tier: 'goc' } : {}),
      /* Daily practice count (Phase 3B). Sent only when held, so a collection
         without the optional attributes `practiceCountDay` (string, size 16) and
         `practiceCount` (integer) keeps working. */
      ...(Number(rec.practiceCount) > 0 ? { practiceCountDay: rec.practiceCountDay || null, practiceCount: Number(rec.practiceCount) } : {}),
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
    streakFreezes: Number(doc.streakFreezes || 0),
    tier: typeof doc.tier === 'string' && doc.tier ? doc.tier : null,
    /* Who last moved this student between tiers, and when (optional string
       attributes `tierChangedBy` size 80 and `tierChangedAt` size 40). */
    tierChangedBy: typeof doc.tierChangedBy === 'string' && doc.tierChangedBy ? doc.tierChangedBy : null,
    tierChangedAt: typeof doc.tierChangedAt === 'string' && doc.tierChangedAt ? doc.tierChangedAt : null,
    questDay: doc.questDay || null,
    /* Weekly quest progress, kept as a small JSON string in the optional
       string attribute `weekQuest` (size 80). Absent or unreadable = none. */
    weekQuest: (() => {
      try {
        const v = typeof doc.weekQuest === 'string' ? JSON.parse(doc.weekQuest) : doc.weekQuest;
        return v && typeof v === 'object' ? v : null;
      } catch (_) { return null; }
    })(),
    mustChangePassword: !!doc.must_change_password,
    goal: doc.goal || '',
    last: doc.last || null,
    tag: doc.tag || null,
    tl: doc.tl || null,
    practiceXpDay: doc.practiceXpDay || null,
    practiceXpToday: Number(doc.practiceXpToday || 0),
    practiceCountDay: doc.practiceCountDay || null,
    practiceCount: Number(doc.practiceCount || 0),
    studyDay: doc.studyDay || null,
    studySecToday: Number(doc.studySecToday || 0),
    appwriteUserId: doc.appwriteUserId || null,
    cohort: doc.cohort || null,
    createdAt: doc.$createdAt || null,
    lastSeenAt: doc.lastSeenAt || null,
    pendingApproval: doc.pendingApproval === true,
    approvedBy: doc.approvedBy || null,
    approvedAt: doc.approvedAt || null
  };
}

/* ============================================================================
   DATA-ACCESS LAYER (Appwrite-backed questions & attempts)

   Questions and attempts used to live only inside the single data.json blob.
   They now have their own Appwrite collections so they survive any redeploy
   that replaces the code folder and so concurrent submissions can never clobber
   one another through a shared in-memory object. The accessors below are the
   one choke point every route goes through.

   DISPATCH RULE: when Appwrite is configured (appwriteDatabases is set) the
   accessors talk to the 'questions' / 'attempts' collections. When it is not
   (local dev, the test suite, an install that never set Appwrite env vars) they
   fall back to the arrays on the local db object exactly as before — so nothing
   about the local-file behaviour changes. This mirrors the hybrid pattern the
   students collection already uses (see appwriteStudentToRecord above).

   Every accessor takes an optional `localDb` — the db object the handler has
   already read this request. In local mode the mutating accessors apply their
   change to that same object and leave the single writeData(db) the handler
   already makes to persist it, so there is never a second, clobbering write to
   the file. In Appwrite mode `localDb` is ignored and the write goes straight
   to the collection.
   ========================================================================== */


/* ---- tutors: record <-> Appwrite document ---- */
function appwriteTutorToRecord(doc) {
  if (!doc || typeof doc.record !== 'string') {
    throw new Error('Invalid Appwrite tutor document: missing record.');
  }

  let rec;
  try {
    rec = JSON.parse(doc.record);
  } catch (_) {
    throw new Error('Invalid Appwrite tutor document: invalid JSON.');
  }

  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
    throw new Error('Invalid Appwrite tutor document: record must be an object.');
  }

  rec.id = String(rec.id || doc.$id || '');
  if (!/^GOC-T-\d+$/i.test(rec.id)) {
    throw new Error('Invalid Appwrite tutor document: invalid tutor ID.');
  }
  return rec;
}

async function listAppwriteTutors() {
  if (!appwriteDatabases) return (readData().tutors || []);
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID,
    APPWRITE_TUTORS_COLLECTION_ID,
    [appwriteQuery().limit(5000)]
  );
  return (result.documents || []).map(appwriteTutorToRecord);
}

async function getAppwriteTutor(tutorId) {
  if (!appwriteDatabases) {
    return (readData().tutors || []).find(t => t.id === tutorId) || null;
  }
  try {
    const doc = await appwriteDatabases.getDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_TUTORS_COLLECTION_ID,
      String(tutorId)
    );
    return appwriteTutorToRecord(doc);
  } catch (err) {
    if (err && (err.code === 404 || err.status === 404)) return null;
    throw err;
  }
}

async function saveAppwriteTutor(rec) {
  if (!appwriteDatabases) {
    throw new Error('Appwrite Database is not initialized.');
  }
  if (!rec || !/^GOC-T-\d+$/i.test(String(rec.id || ''))) {
    throw new Error('Cannot save tutor: invalid tutor ID.');
  }
  const doc = await appwriteDatabases.upsertDocument(
    APPWRITE_DATABASE_ID,
    APPWRITE_TUTORS_COLLECTION_ID,
    String(rec.id),
    { record: JSON.stringify(rec) }
  );
  return appwriteTutorToRecord(doc);
}

function appwriteQuery() {
  return require('node-appwrite').Query;
}

/* ---- questions: record <-> Appwrite document ---- */
const APPROVAL_KEYS = ['status', 'addedBy', 'addedByName', 'addedAt', 'editedAt', 'batch', 'returnReason', 'reviewedBy', 'reviewedAt'];
/* A full patch for a reviewed or edited tutor question: every approval field is named, so one
   the rules cleared (an old return reason) is cleared in storage too. */
function approvalPatch(rec) {
  const p = Object.assign({}, rec);
  APPROVAL_KEYS.forEach(k => { if (p[k] === undefined) p[k] = ''; });
  return p;
}
function questionToDoc(rec) {
  const doc = {
    legacyId: Number(rec.id) || 0,
    subject: rec.subject || '',
    topic: rec.topic || '',
    kind: rec.kind || '',
    section: rec.section || '',
    period: rec.period || core.PERIOD,
    text: rec.text || '',
    difficulty: rec.difficulty || '',
    explanation: rec.explanation || '',
    active: rec.active !== false,
    options: Array.isArray(rec.options) ? rec.options.map(String) : [],
    answer: (rec.answer === null || rec.answer === undefined) ? null : Number(rec.answer),
    expected: rec.expected || '',
    maxMark: Number(rec.maxMark) || 0
  };
  /* Only sent when set, so a collection created before the optional `year`
     attribute existed keeps accepting every question that has none. */
  if (Number(rec.year) > 0) doc.year = Number(rec.year);
  if (Number(rec.passageId) > 0) doc.passageId = Number(rec.passageId);
  /* Same rule for the picture: written only when set, so a collection made
     before these optional attributes existed keeps working. */
  if (rec.imageId) { doc.imageId = String(rec.imageId); doc.imageAlt = String(rec.imageAlt || ''); }
  /* Phase 3C slice 6: the approval fields. Written only once a question has a status (a tutor's
     question, or one the admin has reviewed), so a collection made before these optional
     attributes existed keeps accepting every admin-added question. Blank means cleared. */
  if (rec.status !== undefined) {
    doc.status = String(rec.status || '');
    APPROVAL_KEYS.slice(1).forEach(k => { doc[k] = String(rec[k] == null ? '' : rec[k]); });
  }
  return doc;
}

function docToQuestion(doc) {
  const answer = (doc.answer === null || doc.answer === undefined) ? null : Number(doc.answer);
  const out = {
    id: doc.legacyId != null ? Number(doc.legacyId) : Number(doc.$id),
    subject: doc.subject || '',
    topic: doc.topic || '',
    kind: doc.kind || '',
    section: doc.section || '',
    period: doc.period || core.PERIOD,
    text: doc.text || '',
    difficulty: doc.difficulty || '',
    year: Number(doc.year) > 0 ? Number(doc.year) : null,
    passageId: Number(doc.passageId) > 0 ? Number(doc.passageId) : null,
    imageId: doc.imageId || null,
    imageAlt: doc.imageId ? (doc.imageAlt || '') : '',
    explanation: doc.explanation || '',
    active: doc.active !== false,
    options: Array.isArray(doc.options) ? doc.options.slice() : [],
    answer: answer,
    expected: doc.expected || '',
    maxMark: Number(doc.maxMark) || 0
  };
  APPROVAL_KEYS.forEach(k => { if (doc[k]) out[k] = String(doc[k]); });
  return out;
}

/* ---- attempts: record <-> Appwrite document ---- */
function attemptToDoc(rec) {
  return {
    scholarId: rec.scholarId || '',
    studentName: rec.studentName || '',
    period: rec.period || core.PERIOD,
    section: rec.section || '',
    subject: rec.subject || '',
    questionIds: (rec.questionIds || []).map(n => Number(n) || 0),
    startedAt: Number(rec.startedAt) || 0,
    submittedAt: Number(rec.submittedAt) || 0,
    timeUsedSec: Number(rec.timeUsedSec) || 0,
    durationSec: Number(rec.durationSec) || 0,
    total: Number(rec.total) || 0,
    answered: Number(rec.answered) || 0,
    unanswered: Number(rec.unanswered) || 0,
    correct: Number(rec.correct) || 0,
    wrong: Number(rec.wrong) || 0,
    score: Number(rec.score) || 0,
    maxScore: Number(rec.maxScore) || 0,
    percent: Number(rec.percent) || 0,
    status: rec.status || '',
    answers: JSON.stringify(rec.answers || []),
    xpAwarded: Number(rec.xpAwarded) || 0,
    markedBy: rec.markedBy || null,
    markedAt: (rec.markedAt === null || rec.markedAt === undefined) ? null : Number(rec.markedAt)
  };
}

function docToAttempt(doc) {
  let answers = [];
  try { answers = JSON.parse(doc.answers || '[]'); } catch (_) { answers = []; }
  return {
    id: doc.$id,
    scholarId: doc.scholarId || '',
    studentName: doc.studentName || '',
    period: doc.period || core.PERIOD,
    section: doc.section || '',
    subject: doc.subject || '',
    questionIds: Array.isArray(doc.questionIds) ? doc.questionIds.map(Number) : [],
    startedAt: Number(doc.startedAt) || 0,
    submittedAt: Number(doc.submittedAt) || 0,
    timeUsedSec: Number(doc.timeUsedSec) || 0,
    durationSec: Number(doc.durationSec) || 0,
    total: Number(doc.total) || 0,
    answered: Number(doc.answered) || 0,
    unanswered: Number(doc.unanswered) || 0,
    correct: Number(doc.correct) || 0,
    wrong: Number(doc.wrong) || 0,
    score: Number(doc.score) || 0,
    maxScore: Number(doc.maxScore) || 0,
    percent: Number(doc.percent) || 0,
    status: doc.status || '',
    answers: answers,
    xpAwarded: Number(doc.xpAwarded) || 0,
    markedBy: doc.markedBy || null,
    markedAt: (doc.markedAt === null || doc.markedAt === undefined) ? null : Number(doc.markedAt)
  };
}

/* ---- QUESTION accessors ---- */
/* Only LIVE questions unless the caller says { all: true }. Students, papers, blueprints and the
   tutor numbers all read through here, so a question awaiting approval (or returned) can never
   reach them by a route that forgot to ask. The console's bank, imports and approval queue ask
   for all of them. A question with no status is live. */
async function listQuestions(filter, localDb) {
  filter = filter || {};
  const keep = rows => filter.all ? rows : rows.filter(core.questionIsLive);
  if (!appwriteDatabases) {
    let rows = (localDb ? localDb.questions : readData().questions) || [];
    /* Phase 4 — archived questions (soft-deleted) are excluded from every view
       unless the caller explicitly asks for them. Student pools, blueprint
       counts, and the normal admin bank never see archived questions.
       { all: true } still excludes archived unless showArchived is also set,
       so even the approval queue does not resurface soft-deleted records. */
    if (!filter.showArchived) rows = rows.filter(q => !q.archived);
    if (filter.subject) rows = rows.filter(q => q.subject === filter.subject);
    if (filter.section) rows = rows.filter(q => q.section === filter.section);
    if (filter.kind) rows = rows.filter(q => q.kind === filter.kind);
    if (filter.activeOnly) rows = rows.filter(q => q.active !== false);
    return keep(rows).map(q => JSON.parse(JSON.stringify(q)));
  }
  const Query = appwriteQuery();
  const baseQueries = [];
  if (filter.subject) baseQueries.push(Query.equal('subject', filter.subject));
  if (filter.section) baseQueries.push(Query.equal('section', filter.section));
  if (filter.kind) baseQueries.push(Query.equal('kind', filter.kind));
  if (filter.activeOnly) baseQueries.push(Query.equal('active', true));
  /* Paginate with offset so the full bank is always returned regardless of how
     many questions are stored — a single Query.limit(n) call silently truncates
     once the collection exceeds Appwrite's per-request cap for the plan. */
  const PAGE_SIZE = 100;
  let allDocs = [], offset = 0;
  while (true) {
    const result = await appwriteDatabases.listDocuments(
      APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID,
      [...baseQueries, Query.limit(PAGE_SIZE), Query.offset(offset)]);
    allDocs = allDocs.concat(result.documents);
    if (result.documents.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return keep(allDocs.map(docToQuestion));
}

async function getQuestionById(id, localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.questions : readData().questions) || [];
    return rows.find(q => String(q.id) === String(id)) || null;
  }
  try {
    const doc = await appwriteDatabases.getDocument(
      APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID, String(id));
    return docToQuestion(doc);
  } catch (_) {
    return null;
  }
}

async function createQuestion(rec, localDb) {
  if (!appwriteDatabases) {
    if (localDb) {
      /* Local mode: guard against stale in-memory state producing a
         duplicate ID — this cannot happen via the normal import path
         (the lock re-reads and the seq counter is always bumped) but
         a direct caller could pass a hand-crafted ID, so we check. */
      const existing = localDb.questions.find(q => String(q.id) === String(rec.id));
      if (existing) {
        const err = new Error(
          'ID collision: question ' + rec.id + ' already exists. ' +
          'The new record was NOT saved and the existing one was NOT changed.');
        err.code = 409;
        err.collisionId = rec.id;
        throw err;
      }
      localDb.questions.push(rec);
    }
    return rec;
  }
  /* Appwrite mode: a 409 from createDocument means a document with this
     ID already exists in the collection.  We must NEVER silently overwrite
     it — doing so was the root cause of English JAMB questions disappearing
     when a new import reused an ID that the sequence counter had already
     handed out to a different question.  Throw a collision error instead so
     the import handler can skip this record and report the conflict. */
  try {
    const doc = await appwriteDatabases.createDocument(
      APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID,
      String(rec.id), questionToDoc(rec));
    return docToQuestion(doc);
  } catch (err) {
    if (Number(err && (err.code || err.status)) !== 409) throw err;
    const collision = new Error(
      'ID collision: question ' + rec.id + ' already exists in Appwrite. ' +
      'The new record was NOT saved and the existing one was NOT changed.');
    collision.code = 409;
    collision.collisionId = rec.id;
    throw collision;
  }
}

async function updateQuestion(id, patch, localDb) {
  if (!appwriteDatabases) {
    if (localDb) {
      const q = localDb.questions.find(x => String(x.id) === String(id));
      if (q) {
        Object.assign(q, patch);
        APPROVAL_KEYS.forEach(k => { if (q[k] === '') delete q[k]; });
      }
      return q || null;
    }
    return null;
  }
  const doc = await appwriteDatabases.updateDocument(
    APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID,
    String(id), questionToDoc(Object.assign({ id }, patch)));
  return docToQuestion(doc);
}

async function deleteQuestion(id, localDb) {
  if (!appwriteDatabases) {
    if (localDb) localDb.questions = localDb.questions.filter(q => String(q.id) !== String(id));
    return;
  }
  await appwriteDatabases.deleteDocument(
    APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID, String(id));
}

async function deleteQuestions(ids, localDb) {
  if (!appwriteDatabases) {
    if (localDb) {
      const drop = new Set(ids.map(String));
      localDb.questions = localDb.questions.filter(q => !drop.has(String(q.id)));
    }
    return;
  }
  for (const id of ids) await deleteQuestion(id);
}

/* ---- ATTEMPT accessors ---- */
async function getAttemptById(id, localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.find(a => String(a.id) === String(id)) || null;
  }
  try {
    const doc = await appwriteDatabases.getDocument(
      APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID, String(id));
    return docToAttempt(doc);
  } catch (_) {
    return null;
  }
}

async function getAttemptsForStudent(scholarId, localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.filter(a => a.scholarId === scholarId);
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('scholarId', scholarId), Query.limit(5000)]);
  return result.documents.map(docToAttempt);
}

async function hasSubmittedAttempt(scholarId, section, subject, localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.some(a => a.scholarId === scholarId && a.section === section && a.subject === subject);
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('scholarId', scholarId), Query.equal('section', section),
     Query.equal('subject', subject), Query.limit(1)]);
  return (result.total || result.documents.length) > 0;
}

/* How many times this student has submitted this section+subject IN THE GIVEN
   ROUND. The sit rule (core.canSit) decides what that number allows; keeping the
   count here means the JAMB-oriented sitting, which may be repeated, can report
   it. `round` defaults to the current round for this section+subject; an attempt
   with no roundId counts as round 1 (core.attemptRound). */
async function countSubmittedAttempts(scholarId, section, subject, localDb, round) {
  const db = localDb || readData();
  const cur = round != null ? round : currentRound(db, section, subject);
  if (!appwriteDatabases) {
    const rows = db.attempts || [];
    return rows.filter(a => a.scholarId === scholarId && a.section === section
      && a.subject === subject && core.attemptRound(a) === cur).length;
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('scholarId', scholarId), Query.equal('section', section),
     Query.equal('subject', subject), Query.limit(500)]);
  return (result.documents || []).filter(a => core.attemptRound(a) === cur).length;
}

/* The round the academy is currently running for this section+subject. Opening
   a round (POST /api/rounds/open) advances the number and sets isOpen:true;
   POST /api/rounds/close sets isOpen:false without changing the number.
   Before any round is opened the number is 1 (backward-compat with pre-rounds
   behaviour). The stored value may be a bare number (legacy) or an object
   { n, isOpen, openedAt }. */
function currentRound(db, section, subject) {
  const rounds = (db && db.settings && db.settings.rounds) || {};
  const entry = rounds[section + '|' + subject];
  const n = entry && typeof entry === 'object'
    ? Math.floor(Number(entry.n))
    : Math.floor(Number(entry));
  return n > 0 ? n : 1;
}

/* Whether the round for this section+subject is currently open (accepting new
   sittings). Returns true when no round has been explicitly opened yet so that
   deployments without any open call still behave as before. */
function roundIsOpen(db, section, subject) {
  const rounds = (db && db.settings && db.settings.rounds) || {};
  const entry = rounds[section + '|' + subject];
  if (!entry) return true;                          // no round ever opened → open by default
  if (typeof entry !== 'object') return true;       // legacy bare number → treat as open
  return entry.isOpen === true;
}

/* Resolve and validate a round target. Objective and JAMB-oriented papers are
   sat under the single OBJECTIVE_SUBJECT; theory is per real subject. Returns
   { error } or { section, subject }. */
function roundTarget(section, subject) {
  const sec = String(section || '');
  if (core.WEB_TEST_SECTIONS.indexOf(sec) < 0) return { error: 'Choose a test section (theory, objective or jamb).' };
  if (sec === 'theory') {
    const sub = String(subject || '');
    if (core.ALL_SUBJECTS.indexOf(sub) < 0) return { error: 'Choose a subject for the theory round.' };
    return { section: sec, subject: sub };
  }
  return { section: sec, subject: core.OBJECTIVE_SUBJECT };
}

/* How many live questions would be served for this section+subject right now —
   the "N questions would be served" check the console shows before opening a
   round. */
async function roundServedCount(db, section, subject) {
  const servable = core.servablePool(await listQuestions({}, db), db.passages);
  if (section === 'theory') return core.eligible(servable, { section: 'theory', subject }).length;
  return servable.filter(q => q.section === section).length;
}

/* Phase 4.C: the active challenge for a student right now (their cohort's, this week). */
function activeChallengeFor(db, student, today) {
  if (!student || !student.cohort) return null;
  const wk = core.weekStart(today || core.dayStamp());
  const list = db.challenges || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c && c.active && String(c.cohortId) === String(student.cohort) && c.week === wk) return c;
  }
  return null;
}
/* The team total for a challenge: the sum of its cohort members' capped contributions,
   read from db.challengeState (local-file deployments). */
function challengeTeamTotal(db, challenge, students) {
  const roster = students || db.students || [];
  const mine = roster.filter(s => s && String(s.cohort) === String(challenge.cohortId));
  const contributions = mine.map(s => core.cleanChallengeState((db.challengeState || {})[s.id], challenge).contributed);
  return core.challengeTeamTotal(contributions);
}

/* What the catalogue says about one Web Test row, from the same rule that gates
   the start route (core.canSit): `completed` is true only when the session is
   closed for good (Theory, Objective) IN THE CURRENT ROUND, `repeatable` marks
   the JAMB-oriented rehearsal that may be sat again, and `attempts` is how many
   times it has been submitted in the current round. */
async function sitStatus(scholarId, section, subject, localDb) {
  const db = localDb || readData();
  const round = currentRound(db, section, subject);
  const isOpen = roundIsOpen(db, section, subject);
  const n = await countSubmittedAttempts(scholarId, section, subject, db, round);
  const sit = core.canSit(section, new Array(n).fill({ section, roundId: round }), round);
  return { completed: !sit.allowed, repeatable: sit.repeatable, attempts: n, round, isOpen };
}

async function getAttemptsAwaitingMarking(localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.filter(a => a.status === 'awaiting-marking');
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('status', 'awaiting-marking'), Query.limit(5000)]);
  /* Defensive ceiling check — see implementation-map STEP 2.3. "awaiting-marking"
     is a working queue staff clear, not a growing archive, so hitting 5000 is a
     signal something else is wrong rather than a normal state. TODO: paginate
     if this ever warns in practice. */
  if ((result.total || 0) >= 5000) {
    console.warn('[goc] awaiting-marking queue hit the 5000 ceiling — investigate.');
  }
  return result.documents.map(docToAttempt);
}

async function countAttemptsAwaitingMarking(localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.filter(a => a.status === 'awaiting-marking').length;
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('status', 'awaiting-marking'), Query.limit(1)]);
  return result.total || 0;
}

async function countAttempts(localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.length;
  }
  const Query = appwriteQuery();
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID, [Query.limit(1)]);
  return result.total || 0;
}

async function getMarkedAttemptsForPerformance(localDb) {
  if (!appwriteDatabases) {
    const rows = (localDb ? localDb.attempts : readData().attempts) || [];
    return rows.filter(a => a.status === 'marked');
  }
  const Query = appwriteQuery();
  /* NOTE (implementation-map STEP 2.3): this is the query most exposed to
     outgrowing 5000 as years of attempts accumulate. It inherits today's
     "load every marked attempt and compute in JS" limitation rather than
     fixing it; a real fix means server-side aggregation, out of this scope. */
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    [Query.equal('status', 'marked'), Query.limit(5000)]);
  return result.documents.map(docToAttempt);
}

/* Admin results table — filtered by any combination of scholarId/subject/
   section/status, or unfiltered ("show everything"). Unfiltered it is
   collection-wide, exactly as the console results view has always been (it
   already loaded every attempt to render this table). Query.equal filters are
   attached for whatever the admin narrowed by, so a scoped view never pulls the
   whole collection. */
async function listAttempts(filter, localDb) {
  filter = filter || {};
  if (!appwriteDatabases) {
    let rows = (localDb ? localDb.attempts : readData().attempts) || [];
    if (filter.scholarId) rows = rows.filter(a => a.scholarId === filter.scholarId);
    if (filter.subject) rows = rows.filter(a => a.subject === filter.subject);
    if (filter.section) rows = rows.filter(a => a.section === filter.section);
    if (filter.status) rows = rows.filter(a => a.status === filter.status);
    return rows;
  }
  const Query = appwriteQuery();
  const queries = [];
  if (filter.scholarId) queries.push(Query.equal('scholarId', filter.scholarId));
  if (filter.subject) queries.push(Query.equal('subject', filter.subject));
  if (filter.section) queries.push(Query.equal('section', filter.section));
  if (filter.status) queries.push(Query.equal('status', filter.status));
  queries.push(Query.limit(5000));
  const result = await appwriteDatabases.listDocuments(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID, queries);
  return result.documents.map(docToAttempt);
}

async function deleteAttempts(ids, localDb) {
  if (!appwriteDatabases) {
    if (localDb) {
      const drop = new Set(ids.map(String));
      localDb.attempts = localDb.attempts.filter(x => !drop.has(String(x.id)));
    }
    return;
  }
  for (const id of ids) {
    await appwriteDatabases.deleteDocument(
      APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID, String(id));
  }
}

async function createAttempt(rec, localDb) {
  if (!appwriteDatabases) {
    if (localDb) localDb.attempts.push(rec);
    return rec;
  }
  const doc = await appwriteDatabases.createDocument(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    String(rec.id), attemptToDoc(rec));
  return docToAttempt(doc);
}

async function updateAttempt(id, patch, localDb) {
  if (!appwriteDatabases) {
    if (localDb) {
      const a = localDb.attempts.find(x => String(x.id) === String(id));
      if (a) Object.assign(a, patch);
      return a || null;
    }
    return null;
  }
  const current = await getAttemptById(id);
  const merged = Object.assign({}, current, patch, { id });
  const doc = await appwriteDatabases.updateDocument(
    APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
    String(id), attemptToDoc(merged));
  return docToAttempt(doc);
}

/* ---- blob storage (settings/notes/topics/contactMessages/affirmations/importLog)
   The single JSON document still lives on local disk (read/written synchronously
   as before), but when Appwrite Storage is configured every write is also
   mirrored up to the bucket/file, and the disk copy is hydrated from that file
   at boot. That makes the blob durable across a code-folder-replacing redeploy
   without turning the ~67 synchronous readData()/writeData() call sites async. */
function blobStorageEnabled() {
  /* Use the constants loaded once at startup from appwriteConfig (via loadEnv)
     rather than re-reading process.env at call time.  dotenv.config() never
     overwrites a variable that is already set in the process environment, so
     on hosts where APPWRITE_BUCKET_ID / APPWRITE_FILE_ID are absent from the
     platform-level env, process.env[key] stays undefined even though the .env
     file is present and appwriteConfig already has the correct value.  Reading
     the constants here guarantees the check always matches the values that are
     actually being used for uploads and downloads. */
  return !!(appwriteResourcesStorage && APPWRITE_BUCKET_ID && APPWRITE_FILE_ID);
}

async function hydrateBlobFromStorage() {
  if (!blobStorageEnabled()) return false;
  try {
    const buf = await appwriteResourcesStorage.getFileDownload(APPWRITE_BUCKET_ID, APPWRITE_FILE_ID);
    const text = Buffer.isBuffer(buf) ? buf.toString('utf8')
      : (buf && buf.byteLength != null ? Buffer.from(buf).toString('utf8') : String(buf));
    if (text && text.trim()) {
      /* ── Stale-blob guard ───────────────────────────────────────────────────
         If the local file already exists and carries a _savedAt timestamp that
         is more recent than the one in the downloaded blob, the local file is
         the newer authoritative copy and we must NOT overwrite it.  This
         situation arises when:
           • a previous process wrote settings and the Appwrite upload failed or
             was still in-flight when SIGTERM arrived (redeploy), OR
           • the blob was last updated from an earlier deploy while the
             persistent-volume copy has accumulated later changes.
         We only restore when:
           a) the local file does not exist yet (first boot on this volume), OR
           b) the blob's _savedAt is strictly greater than the local _savedAt,  OR
           c) either file has no parseable _savedAt (legacy data — restore for
              safety, the same as before this guard existed).
      ─────────────────────────────────────────────────────────────────────── */
      let blobTs = null, localTs = null;
      try { blobTs = JSON.parse(text)._savedAt || null; } catch (_) {}
      if (fs.existsSync(DATA_FILE)) {
        try { localTs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))._savedAt || null; } catch (_) {}
      }
      if (blobTs && localTs && new Date(localTs) >= new Date(blobTs)) {
        console.log('[goc] Local data.json (' + localTs + ') is as new as or newer than the Appwrite blob (' + blobTs + '); keeping local copy.');
        return false;
      }
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, DATA_FILE);
      console.log('[goc] Hydrated data.json blob from Appwrite Storage' + (blobTs ? ' (blob _savedAt: ' + blobTs + ')' : '') + '.');
      return true;
    }
  } catch (err) {
    /* No file yet (first boot) or a transient error — fall back to whatever is
       on disk, exactly as before this feature existed. */
    console.log('[goc] No blob in Appwrite Storage yet (' + err.message + '); using local data.json.');
  }
  return false;
}

function scheduleBlobUpload() {
  if (!blobStorageEnabled()) return;
  appwriteSaveChain = appwriteSaveChain.then(async () => {
    const { InputFile } = require(
      path.join(path.dirname(require.resolve('node-appwrite')), 'inputFile.js'));
    try { await appwriteResourcesStorage.deleteFile(APPWRITE_BUCKET_ID, APPWRITE_FILE_ID); }
    catch (_) { /* not present yet — createFile below establishes it */ }
    await appwriteResourcesStorage.createFile(
      APPWRITE_BUCKET_ID, APPWRITE_FILE_ID,
      InputFile.fromPath(DATA_FILE, 'academy-data.json'));
  }).catch(err => {
    console.error('[goc] Blob upload to Appwrite Storage failed:', err.message);
  });
}

function readData() {
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
     without this field) had no lazy fallback — db.settings.consolePasscodeHash would
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
  }
  /* The objective sitting: one clock for the whole combination, and an optional
     per-paper count management may lower below the UTME ceiling. */
  if (db.settings.objectiveMinutes == null) db.settings.objectiveMinutes = core.OBJ_MIN_DEFAULT;
  if (!db.settings.objectiveCounts) db.settings.objectiveCounts = {};
  /* The JAMB-oriented sitting is configured independently of the Objective one
     (its own clock and per-paper counts), even though it shares the exam shape
     and can draw on the objective pool. Defaults seeded once, then owned by the
     academy. */
  if (db.settings.jambMinutes == null) db.settings.jambMinutes = core.JAMB_MIN_DEFAULT;
  if (!db.settings.jambCounts) db.settings.jambCounts = {};
  /* Phase 3: the depth the jamb pool must reach, in every subject of a student's
     combination, before the sitting is offered.
     Seeded once — from GOC_JAMB_READY_MIN when the owner sets it, else the
     default — then owned by the academy like the clocks above. */
  if (db.settings.jambReadyMin == null) db.settings.jambReadyMin = core.clampJambReadyMin(process.env.GOC_JAMB_READY_MIN);
  /* Question Bank persistence:
   - A missing questions field means this is a fresh/legacy data file, so seed it once.
   - An existing empty array is intentional: staff may have deleted every question.
     Never repopulate a question bank that management deliberately emptied. */
if (!Array.isArray(db.questions)) db.questions = core.seedQuestions();
  /* Phase 3C: tutor accounts live in the data file (no Appwrite collection). */
  if (!Array.isArray(db.tutors)) db.tutors = [];
  /* Phase 3C slice 6.6: alerts for the console home (a tutor saved a fully marked theory script;
     slice 7 adds class notices to the same list). */
  if (!Array.isArray(db.alerts)) db.alerts = [];
  /* Phase 3C slice 7: class notices posted by tutors (GOC students only read them). */
  if (!Array.isArray(db.notices)) db.notices = [];
  /* Phase 4: targeted broadcasts sent from the console (GOC students only read them). */
  if (!Array.isArray(db.broadcasts)) db.broadcasts = [];
  /* Phase 4.A: "Ask a tutor" question flags (GOC students only; routed to the subject's
     tutors and the console). Stored in the data file; no Appwrite collection. */
  if (!Array.isArray(db.flags)) db.flags = [];
  /* Phase 4.C: team (cohort) challenges and each member's weekly contribution.
     `challengeState[studentId] = { challengeId, week, contributed, claimed }`. Data file only. */
  if (!Array.isArray(db.challenges)) db.challenges = [];
  if (!db.challengeState || typeof db.challengeState !== 'object' || Array.isArray(db.challengeState)) db.challengeState = {};
  /* Who has been emailed each broadcast (Phase 4 slice 6): { broadcastId: { sent: {studentId: day}, fails: {studentId: n} } }. */
  if (!db.broadcastMail || typeof db.broadcastMail !== 'object' || Array.isArray(db.broadcastMail)) db.broadcastMail = {};
  /* Phase 3C student detail page: who opened which student's page (tutors only), kept one year. */
  if (!Array.isArray(db.tutorAudit)) db.tutorAudit = [];
  /* Roles slice (c), step 7: sensitive manager actions, newest 1,000 (core.addManagerAction). */
  if (!Array.isArray(db.managerLog)) db.managerLog = [];
  /* B#2 scholarship: all submitted applications and the Cohort-2.0 waitlist. */
  if (!Array.isArray(db.scholarshipApplications)) db.scholarshipApplications = [];
  if (!Array.isArray(db.scholarshipWaitlist))     db.scholarshipWaitlist = [];
  /* Phase 3C slice 5: per-question and per-topic answer counters for the tutor dashboard
     (counts only, GOC students only; see core.recordAnswerStats). */
  if (!db.answerStats || typeof db.answerStats !== 'object' || Array.isArray(db.answerStats)) db.answerStats = {};
  if (!Array.isArray(db.attempts)) db.attempts = [];
  /* Practice runs, kept per Scholar ID (Phase 1). A missing field means a
     data file written before practice sync existed — start it empty; there is
     nothing to migrate, as older runs only ever lived on the device. */
  if (!db.practiceRuns || typeof db.practiceRuns !== 'object') db.practiceRuns = {};
  /* Saved questions, kept per Scholar ID (Phase 1, part 2). Missing on a data
     file written before bookmarks existed — start it empty. */
  if (!db.bookmarks || typeof db.bookmarks !== 'object') db.bookmarks = {};
  /* Spaced-repetition schedule, kept per Scholar ID (Phase 2): { key: { box,
     due, last, mastered } }. Missing on a data file written before spaced
     repetition existed — start it empty; every mistake simply begins in box 0. */
  if (!db.reviewState || typeof db.reviewState !== 'object') db.reviewState = {};
  /* Study-reminder state, kept per Scholar ID (Phase 2): { prefs: {email, sms},
     token, sent: {streak, weekly, review}, fails }. Missing on a data file
     written before reminders existed — start it empty; everyone then has the
     defaults (email on, SMS off) and nothing has been sent yet. */
  if (!db.reminderState || typeof db.reminderState !== 'object') db.reminderState = {};
  /* Reading-mode notes. Seeded once so a fresh install has something to read,
     then owned by the academy: anything management adds or imports lives here
     beside the question bank and is never overwritten by a later release.
     Same rule as the question bank above: a missing field means a fresh/legacy
     data file, so seed it once. An existing empty array is intentional — staff
     may have bulk-deleted every note — and must never be silently repopulated. */
  if (!Array.isArray(db.notes)) db.notes = core.seedNotes();
  /* Comprehension passages: reading texts shared by several questions. Starts
     empty — there is nothing to seed — and, like notes, is owned by the academy. */
  if (!Array.isArray(db.passages)) db.passages = [];
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
  if (db.settings.passageSeq == null) {
    db.settings.passageSeq = db.passages.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  }
  if (db.settings.questionSeq == null) {
    db.settings.questionSeq = db.questions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  }
  /* Phase 9 — Persistence guard. Runs only in Appwrite mode where the local
     data.json is a cache/fallback rather than the authoritative store. If the
     local file appears to be an older or emptier snapshot than what Appwrite
     holds we log a loud warning so the operator knows the counter may be stale.
     We do NOT refuse to start — that would take the server down on every cold
     boot before Appwrite is reachable — but we mark the state in settings so a
     subsequent /api/questions/diagnostics call can surface it.

     The check is deferred to the next event-loop tick so migrate() stays
     synchronous and the rest of startup can proceed. It is only ever scheduled
     once per process, not once per readData() call. */
  if (appwriteDatabases && !global._gocPersistenceGuardScheduled) {
    global._gocPersistenceGuardScheduled = true;
    setImmediate(async () => {
      try {
        const appwriteList = await listQuestions({ all: true }, null);
        const localCount = (db.questions || []).filter(q => !q.archived).length;
        const localMaxId = (db.questions || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        const appwriteMaxId = appwriteList.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        if (appwriteList.length > localCount || appwriteMaxId > localMaxId) {
          console.warn(
            '[goc] PERSISTENCE GUARD: local data.json has ' + localCount + ' questions (max ID ' + localMaxId + ')' +
            ' but Appwrite has ' + appwriteList.length + ' (max ID ' + appwriteMaxId + ').' +
            ' Syncing questionSeq to Appwrite\'s real max ID (' + appwriteMaxId + ') so imports no longer collide.'
          );
          /* FIX: Sync questionSeq from Appwrite's real max ID so that new
             imports start from the correct next ID instead of colliding with
             questions already in Appwrite. This is the root cause of the
             "ID collision: question 1373 already exists" error that blocks
             every import when data.json is reset on redeploy (no persistent
             disk). Without this fix, data.json resets questionSeq to the
             local count (e.g. 43) on every restart, and every new import
             immediately collides with the 500+ questions already in Appwrite. */
          try {
            const liveDb = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            liveDb.settings = liveDb.settings || {};
            /* Only move the counter forward, never backward — if for some
               reason the local counter is already ahead of Appwrite (e.g. an
               import is in-flight), we keep the higher value. */
            if ((liveDb.settings.questionSeq || 0) < appwriteMaxId) {
              liveDb.settings.questionSeq = appwriteMaxId;
              console.log('[goc] PERSISTENCE GUARD: questionSeq updated to ' + appwriteMaxId + '.');
            }
            liveDb.settings.persistenceWarning = {
              detectedAt: new Date().toISOString(),
              localCount,
              localMaxId,
              appwriteCount: appwriteList.length,
              appwriteMaxId,
              seqSynced: true
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(liveDb));
          } catch (e2) { /* non-fatal: the console.warn above is the primary signal */ }
        } else {
          console.log('[goc] Persistence guard: local data.json and Appwrite are in sync (' + appwriteList.length + ' questions).');
        }
      } catch (e) {
        /* Appwrite may not be reachable on cold boot — not an error here. */
        console.log('[goc] Persistence guard: could not reach Appwrite on startup (' + e.message + ').');
      }
    });
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
  /* Access tiers, one-time migration (Phase 3B decision 2): everyone already
     in the local roster becomes GOC, so nobody loses anything the day tiers
     ship. It runs once, then the marker stops it, so a student who signs up
     later and is stored as Open is never promoted. In Appwrite mode the local
     roster is empty and the marker is NOT set here; migrateAppwriteTiers()
     does that job against the real roster. */
  if (!appwriteDatabases && !db.settings.tierMigrated) {
    (db.students || []).forEach(s => { if (s.tier == null) s.tier = 'goc'; });
    db.settings.tierMigrated = new Date().toISOString();
  }
  (db.students || []).forEach(s => {
    if (s.active == null) s.active = true;
    if (s.xp == null) s.xp = 0;
    if (s.streak == null) s.streak = 0;
    if (s.streakDay === undefined) s.streakDay = null;
    if (s.streakFreezes == null) s.streakFreezes = 0;
    /* Access tiers (Phase 3B): a student on file the day tiers first run is
       already part of the academy, so the one-time migration below makes them
       GOC; a stored tier is only ever normalised, never promoted. */
    if (s.tier != null) s.tier = core.cleanTier(s.tier);
    if (s.questDay === undefined) s.questDay = null;
    if (s.weekQuest === undefined) s.weekQuest = null;
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

/* Written via a temp file + rename, so the file itself is never left
   half-written by a crash mid-write.
   A _savedAt ISO timestamp is injected on every write so that
   hydrateBlobFromStorage() can compare the blob against the local file and
   refuse to restore a stale blob over a newer local copy. */
function writeData(db) {
  db._savedAt = new Date().toISOString();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  /* Mirror the fresh blob up to Appwrite Storage when configured, so it
     survives a redeploy that wipes the code folder. Fire-and-forget on a
     serialized chain — the local write above is the source of truth for this
     process; the upload is durability for the next boot. */
  scheduleBlobUpload();
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

/* A student's mistakes list: wrong answers in their stored practice runs plus
   the wrong objective answers in their latest marked Web Test papers (bounded,
   so one request stays cheap), merged newest first. Shared by the mistakes
   review and spaced repetition so both always read the same list. */
async function mistakesFor(db, studentId) {
  const runs = await practiceRunsOf(db, studentId);
  const marked = (await attemptsFor(db, studentId))
    .filter(a => a.status === 'marked')
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, 20);
  const sums = await Promise.all(marked.map(a => summariseOwn(db, a, null)));
  return core.mergeMistakes([core.mistakesFromRuns(runs), core.mistakesFromAttempts(sums)]);
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
    /* Roles slice (b), step 1: the role KEY, worked out here on the server from the stored title.
       Nothing is refused on it yet; the guard in later steps reads this, never the title string. */
    roleKey: role === 'admin' ? core.adminRoleKey(account.title) : null,
    /* a manager still on the starting password the Founder typed (step 3a: console routes refused) */
    mustChangePassword: role === 'admin' ? !!account.mustChangePassword : false,
    unlocked: false,
    subjects: (role === 'student' || role === 'tutor') ? (account.subjects || []).slice() : [],
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

/* Successful sign-ups per address (Phase 3B slice 5). Sign-up is open, so the thing to
   slow down is one person making many Open accounts. The numbers are management's: the
   defaults are in core.SIGNUP_LIMIT_DEFAULTS and Console -> Access & firewall can raise
   them for a school or shared phone network (many students, one address). Kept in memory
   per address, like the other throttles: a restart forgets the counts. */
const signupLog = new Map();
function signupLimitsOf(db) {
  return core.signupLimits(db && db.settings);
}
function signupBlocked(ip, lim) {
  const now = Date.now();
  const rec = (signupLog.get(ip) || []).filter(t => now - t < core.SIGNUP_DAY_MS);
  if (rec.length) signupLog.set(ip, rec); else signupLog.delete(ip);
  return core.signupWait(rec, now, lim);
}
function noteSignup(ip) {
  const now = Date.now();
  const rec = (signupLog.get(ip) || []).filter(t => now - t < core.SIGNUP_DAY_MS);
  rec.push(now);
  signupLog.set(ip, rec);
}
setInterval(() => {
  const now = Date.now();
  signupLog.forEach((v, k) => { const f = v.filter(t => now - t < core.SIGNUP_DAY_MS); if (f.length) signupLog.set(k, f); else signupLog.delete(k); });
}, 10 * 60 * 1000).unref();

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
      /* Raised from 64 KB to 512 KB so a 500-question CSV import (≈150–200 KB
         of JSON) fits comfortably without being cut off mid-import. */
      if (raw.length > 512 * 1024) { reject(new ClientError('Request too large.')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new ClientError('Malformed request.')); }
    });
    req.on('error', () => reject(new ClientError('Request failed.')));
  });
}

async function publicStudent(db, s, opts) {
  const out = {
    id: s.id, name: s.name, last: s.last, tag: s.tag, tl: s.tl,
    active: s.active !== false, xp: s.xp || 0, streak: s.streak || 0,
    level: core.levelFor(s.xp || 0), subjects: (s.subjects || []).slice(),
    exam: core.EXAM, performance: (await perfFor(db, s.id)).overall
  };
  /* lastSeenAt is a staff-only metric (feeds the Overview "Active today"
     count) — never surfaced to the student it belongs to or to any other
     student, only to console callers. */
  if (opts && opts.console) {
    out.lastSeenAt = s.lastSeenAt || null;
    /* Staff-only: who moved this account between tiers, and when. */
    out.tierChangedBy = s.tierChangedBy || null;
    out.tierChangedAt = s.tierChangedAt || null;
  }
  /* cohort is harmless for a student to see about themselves (it's just
     which group they're in), so it's not console-gated the way lastSeenAt is. */
  out.cohort = s.cohort || null;
  out.tier = core.cleanTier(s.tier);
  /* Admin-approval flow: surface pending status and approval record. */
  out.pendingApproval = s.pendingApproval === true;
  out.approvedBy = s.approvedBy || null;
  out.approvedAt = s.approvedAt || null;
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
  const r = core.streakAfterActivity(s.streak, s.streakDay, undefined, s.streakFreezes);
  s.streak = r.streak;
  s.streakDay = r.day;
  s.streakFreezes = r.freezes;
  return s;
}

/* Appwrite patch for the freeze count: only when it actually changed, so the
   attribute is never written (or required) for a student who holds none. */
function freezePatch(before, after) {
  return Number(before || 0) !== Number(after || 0) ? { streakFreezes: Number(after || 0) } : {};
}

/* ------------------------------------------------- tests, marks, performance */

/* Now backed by the data-access layer: getQuestionById dispatches to Appwrite
   when configured, else the local db array. Async because the Appwrite path
   awaits a network call — every caller awaits it. */
async function findQ(db, id) {
  return getQuestionById(id, db);
}
/* How many practice runs the server keeps per student. Matches the 30 the
   device used to keep on its own, so no student loses history in the move to
   server-authoritative storage (Phase 1). */
/* How many practice runs a student keeps comes from their tier (core.tierLimits(...).practiceHistory;
   null = no count limit) and, for everyone, a maximum age (core.PRACTICE_MAX_AGE_DAYS). */

/* Trims and validates one practice-run result posted by the browser before it
   is stored. A run with no review is refused — there is nothing to review
   later, and it is the review Phase 2 depends on. Everything is coerced to a
   plain shape so a client cannot smuggle arbitrary fields or unbounded data
   into data.json; the review itself is capped and each row reduced to what the
   review screen and mistakes review actually read. Returns null when invalid. */
function sanitizePracticeRun(body) {
  if (!body || typeof body !== 'object') return null;
  const review = Array.isArray(body.review) ? body.review : [];
  if (!review.length) return null;
  const str = (v, n) => (v == null ? '' : String(v)).slice(0, n || 400);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const idx = v => (v == null ? null : num(v));
  /* Each review row keeps exactly the shape the review screen renders from
     (see answerPrac in app.js): the question, its options, the option index the
     student chose (given) and the correct one (answer), whether it was right,
     and the explanation. Reduced to plain values and capped so a client cannot
     store arbitrary fields or unbounded data. id/subject/section are optional —
     they ride along when present so Phase 2 can group mistakes by them. */
  const trimmedReview = review.slice(0, 100).map(q => ({
    n: q && q.n != null ? num(q.n) : null,
    id: q && q.id != null ? idx(q.id) : null,
    subject: str(q && q.subject, 60),
    topic: str(q && q.topic, 120),
    section: str(q && q.section, 20),
    text: str(q && q.text, 2000),
    options: Array.isArray(q && q.options) ? q.options.slice(0, 6).map(o => str(o, 500)) : [],
    answer: q ? idx(q.answer) : null,
    given: q ? idx(q.given) : null,
    isCorrect: !!(q && q.isCorrect),
    explanation: str(q && q.explanation, 2000)
  }));
  const topics = Array.isArray(body.topics) ? body.topics.slice(0, 40).map(t => ({
    topic: str(t && t.topic, 120), percent: num(t && t.percent), band: str(t && t.band, 20)
  })) : [];
  return {
    mode: body.mode === 'cbt' ? 'cbt' : 'practice',
    subject: str(body.subject, 60),
    total: num(body.total), answered: num(body.answered),
    correct: num(body.correct), wrong: num(body.wrong),
    percent: num(body.percent),
    timeUsedSec: body.timeUsedSec == null ? null : num(body.timeUsedSec),
    xpAwarded: num(body.xpAwarded), xpCapped: !!body.xpCapped,
    xpLeftToday: body.xpLeftToday == null ? null : num(body.xpLeftToday),
    topics: topics, review: trimmedReview,
    ts: Number.isFinite(Number(body.ts)) && Number(body.ts) > 0 ? Number(body.ts) : Date.now()
  };
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
    replaced: entry.replaced || 0,
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
/* Backed by the data-access layer (getAttemptsForStudent). Async — callers
   await it. The ONE-SIT RULE existence check now lives in the hasSubmittedAttempt
   accessor above (a web test theory/objective/jamb is sat once; period is a
   fixed constant, so "already submitted this section+subject" is the whole
   rule). */
async function attemptsFor(db, scholarId) {
  return getAttemptsForStudent(scholarId, db);
}
async function perfFor(db, scholarId) {
  const list = await attemptsFor(db, scholarId);
  return core.computePerformance(list, db.settings.perfWeights);
}

function attemptSummary(a) {
  const out = {
    id: a.id, scholarId: a.scholarId, studentName: a.studentName,
    period: a.period, section: a.section, subject: a.subject,
    submittedAt: a.submittedAt, timeUsedSec: a.timeUsedSec,
    total: a.total, answered: a.answered, unanswered: a.unanswered,
    correct: a.correct, wrong: a.wrong,
    score: a.score, maxScore: a.maxScore, percent: a.percent,
    status: a.status, xpAwarded: a.xpAwarded || 0
  };
  /* JAMB-oriented papers also carry the JAMB-style score out of 400 (computed
     from the stored answers, so older and newer attempts read the same way;
     null when the paper cannot honestly be scored — see core.jambScore). */
  if (a.section === 'jamb') { const js = core.jambScore(a); if (js) out.jambScore = js; }
  return out;
}

/* What the owning student may see. Correct answers and explanations are
   released only after the paper is marked, and only on their own paper. A
   student has no route that writes to a score, a mark or a correct answer. */
async function summariseOwn(db, a, stu) {
  const out = attemptSummary(a);
  out.xpTotal = stu ? (stu.xp || 0) : 0;
  out.level = stu ? core.levelFor(stu.xp || 0) : 1;
  out.streak = stu ? (stu.streak || 0) : 0;
  out.breakdown = a.status === 'marked' ? core.topicBreakdown(a.answers) : [];
  /* Resolve the question behind each answer row through the data-access layer.
     Fetched in parallel so a marked-paper review is one round of lookups, not
     a serial walk. */
  const questions = await Promise.all(a.answers.map(r => findQ(db, r.questionId)));
  out.review = a.answers.map((r, i) => {
    const q = questions[i] || {};
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
  out.performance = stu ? (await perfFor(db, stu.id)).overall : 0;
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
/* What a student was served last time they practiced a subject, so a resit
   draws a fresh set instead of the same questions again. Keyed by
   "scholarId|subject", holding just an id list — in memory only, same as
   openStudy above, so it resets on a restart rather than needing a schema
   change to every student record (file-based or Appwrite). Losing this on
   restart only means the next resit after a restart isn't guaranteed fresh,
   which is a fair trade for not persisting it. */
const practiceRecent = new Map();
function practiceRecentKey(scholarId, subject) { return scholarId + '|' + subject; }
function practiceRecentIds(scholarId, subject) {
  return practiceRecent.get(practiceRecentKey(scholarId, subject)) || [];
}
/* Remembers this run's questions, kept alongside what was already
   remembered so a student cycling through several short resits in a row
   keeps seeing new material rather than the last run's set looping back in
   after just one repeat — capped to the size of the pool so old entries
   fall off once the bank has been fully cycled through. */
function practiceRecentRemember(scholarId, subject, ids, poolSize) {
  const key = practiceRecentKey(scholarId, subject);
  const seen = {};
  const merged = [];
  ids.concat(practiceRecent.get(key) || []).forEach((id) => {
    if (!seen[id]) { seen[id] = true; merged.push(id); }
  });
  practiceRecent.set(key, merged.slice(0, Math.max(ids.length, poolSize)));
}

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

/* The access tier of a student by Scholar ID, from the local roster or from
   Appwrite. An unknown or unreadable student reads as Open (fail closed). */
async function studentTierOf(db, id) {
  const st = appwriteDatabases
    ? await getAppwriteStudent(id).catch(() => null)
    : (db.students || []).find(x => x.id === id);
  return core.cleanTier(st && st.tier);
}

/* A student's stored practice runs, newest first, held to what their tier keeps
   (Open 30, GOC no count limit, via TIER_LIMITS) and to the maximum age
   (core.PRACTICE_MAX_AGE_DAYS). A list already over either is trimmed straight
   away and the trim is stored, so lowering a limit later permanently drops
   older runs. Mistakes review, spaced
   repetition and the daily quest all read through this, so they agree. */
async function practiceRunsOf(db, id) {
  const cap = core.tierLimits(await studentTierOf(db, id)).practiceHistory;
  const all = Array.isArray(db.practiceRuns && db.practiceRuns[id]) ? db.practiceRuns[id] : [];
  const kept = core.capList(core.dropOldRuns(all), cap);
  if (kept.length !== all.length) { db.practiceRuns[id] = kept; writeData(db); }
  return kept;
}

/* Practice questions this student has answered today (Phase 3B, access tiers).
   Counted against the calendar day in Nigeria (core.lagosDay), so the allowance
   resets at midnight there whatever time zone the server runs in. A stored
   count from an earlier day reads as zero. The daily limit is enforced at study start. */
function practiceCountToday(s) {
  if (!s || s.practiceCountDay !== core.lagosDay()) return 0;
  return Math.max(0, Math.floor(Number(s.practiceCount) || 0));
}

/* Spaced reviews answered today (Phase 3B, access tiers). Kept in
   db.reviewCount[studentId] = { day, count } beside db.reviewState, so it works
   on Appwrite too with no new attribute. A count from an earlier Lagos day
   reads as zero, so the allowance resets at Nigeria midnight with no sweep. */
function reviewsToday(db, id) {
  const r = db.reviewCount && db.reviewCount[id];
  if (!r || r.day !== core.lagosDay()) return 0;
  return Math.max(0, Math.floor(Number(r.count) || 0));
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
/* GOC_RUN_TIMEOUT: max lifetime (seconds) for an untimed practice run in the
   in-memory openStudy map.  Default is 4 hours.  Tests may set a shorter value
   via the environment variable to verify expiry logic without waiting 4 hours. */
const GOC_RUN_TIMEOUT_SEC = Number(process.env.GOC_RUN_TIMEOUT) || (4 * 3600);

setInterval(() => {
  const now = Date.now();
  openPapers.forEach((v, k) => {
    if (now - v.startedAt > (v.durationSec + 600) * 1000) openPapers.delete(k);
  });
  /* Study runs are swept too, so an abandoned one does not sit in memory. An
     untimed practice run is given GOC_RUN_TIMEOUT seconds (default 4 hours):
     it has no clock of its own, and a student who puts their phone down
     mid-run should still be able to finish. */
  openStudy.forEach((v, k) => {
    const life = (v.durationSec ? v.durationSec + 600 : GOC_RUN_TIMEOUT_SEC) * 1000;
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

/* ------------------------------------------------------- study reminders
   Phase 2, Reminders. The rules live in core.reminderPlan and the message and
   sweep in lib/reminders.js; this block connects them to this server's data,
   its mail transport and a daily timer.

   What it needs to actually send (otherwise it stays idle and says why at
   boot): SMTP (GOC_SMTP_HOST / USER / PASS, shared with the contact form) and
   GOC_PUBLIC_URL — the address students open the hub at, used for the links in
   every message, including the one-tap opt-out.

   Optional: GOC_REMINDERS=0 turns it off; GOC_REMINDER_HOURS="17-21" moves the
   sending window (server's local time); GOC_REMINDER_INTERVAL_MIN (default 30)
   is how often the server looks; GOC_REMINDER_DRY_RUN=1 writes each message to
   reminders-outbox.jsonl beside the data file instead of sending it, which is
   how to preview the wording and the timing without mailing anyone. */
function reminderWindow() {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(process.env.GOC_REMINDER_HOURS || '');
  if (!m) return { start: core.REMINDER_START_HOUR, end: core.REMINDER_END_HOUR };
  const a = Number(m[1]), b = Number(m[2]);
  return a < b && b <= 24 ? { start: a, end: b } : { start: core.REMINDER_START_HOUR, end: core.REMINDER_END_HOUR };
}
function reminderPublicUrl() {
  return String(process.env.GOC_PUBLIC_URL || '').trim().replace(/\/+$/, '');
}
/* Which channels could deliver right now. SMS is a stub and never can. */
function reminderDelivery() {
  if (process.env.GOC_REMINDERS === '0') return { email: false, sms: false };
  const live = !!reminderPublicUrl() &&
    (process.env.GOC_REMINDER_DRY_RUN === '1' || !!getMailTransport());
  return { email: live, sms: false };
}
async function sendReminderEmail(m) {
  if (process.env.GOC_REMINDER_DRY_RUN === '1') {
    fs.appendFileSync(path.join(DATA_DIR, 'reminders-outbox.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), to: m.to, subject: m.subject, text: m.text }) + '\n');
    return;
  }
  const transport = getMailTransport();
  if (!transport) throw new Error('SMTP is not configured.');
  await transport.sendMail({
    from: process.env.GOC_SMTP_FROM || process.env.GOC_SMTP_USER,
    to: m.to, subject: m.subject, text: m.text, html: m.html,
    headers: m.links && m.links.off ? { 'List-Unsubscribe': '<' + m.links.off + '>' } : undefined
  });
}
/* What a student sees on Profile: their two switches, whether we hold an
   address/number for them, and whether a message could really go out. */
function remindersView(db, stu) {
  const st = (db.reminderState && db.reminderState[stu.id]) || {};
  const prefs = core.cleanReminderPrefs(st.prefs);
  const live = reminderDelivery();
  const hasEmail = core.reminderEmailOk(stu.email), hasPhone = core.reminderPhoneOk(stu.phone);
  return {
    email: prefs.email, sms: prefs.sms, hasEmail: hasEmail, hasPhone: hasPhone,
    deliverable: { email: live.email && hasEmail, sms: live.sms && hasPhone }
  };
}
const reminderService = reminders.createReminderService({
  core,
  readData: () => readData(),
  writeData: db => writeData(db),
  withDataLock: fn => withDataLock(fn),
  listStudents: async () => (appwriteDatabases ? await listAppwriteStudents() : (readData().students || [])),
  dueCountFor: async (db, id) => core.srQueue(await mistakesFor(db, id), (db.reviewState && db.reviewState[id]) || {}, Date.now()).dueCount,
  get channels() { return reminderDelivery(); },
  sendEmail: sendReminderEmail,
  sendSms: reminders.sendSmsStub,
  get publicUrl() { return reminderPublicUrl(); },
  get startHour() { return reminderWindow().start; },
  get endHour() { return reminderWindow().end; },
  maxPerSweep: Number(process.env.GOC_REMINDER_MAX_PER_SWEEP) || 200,
  log: m => console.warn(m)
});
function startReminderSchedule() {
  if (process.env.GOC_REMINDERS === '0') { console.log('[goc] study reminders disabled (GOC_REMINDERS=0).'); return; }
  if (!reminderPublicUrl()) { console.log('[goc] study reminders idle: set GOC_PUBLIC_URL (the address students open the hub at) so every message can carry its opt-out link.'); return; }
  if (!reminderDelivery().email) { console.log('[goc] study reminders idle: SMTP is not configured (GOC_SMTP_HOST / GOC_SMTP_USER / GOC_SMTP_PASS).'); return; }
  const minutes = Number(process.env.GOC_REMINDER_INTERVAL_MIN) > 0 ? Number(process.env.GOC_REMINDER_INTERVAL_MIN) : 30;
  const w = reminderWindow();
  const tick = () => reminderService.sweep().then(r => {
    if (r.sent || r.failed) console.log('[goc] reminders: ' + r.sent + ' sent, ' + r.failed + ' failed.');
  }).catch(err => console.error('[goc] reminder sweep failed (continuing):', err && err.message))
    .then(() => reminderService.broadcastSweep()).then(r => {
      if (r && (r.sent || r.failed)) console.log('[goc] broadcast emails: ' + r.sent + ' sent, ' + r.failed + ' failed.');
    }).catch(err => console.error('[goc] broadcast email sweep failed (continuing):', err && err.message));
  setTimeout(tick, Math.min(30000, minutes * 60000));
  setInterval(tick, minutes * 60000);
  console.log('[goc] study reminders: checking every ' + minutes + 'min, sending between ' + w.start + ':00 and ' + w.end + ':00' +
    (process.env.GOC_REMINDER_DRY_RUN === '1' ? ' (DRY RUN — written to reminders-outbox.jsonl, not mailed)' : '') + '.');
}


/* ------------------------------------------------------- question pictures */
/* A question may carry one picture (Phase 3, question images). Files live in
   DATA_DIR/question-images/<id>.<ext>, beside data.json, so they ride whatever
   persistent mount GOC_DATA_DIR points at. The id is issued here, never chosen
   by the client, and is what core.cleanImageId accepts. */
const QIMG_DIR = path.join(DATA_DIR, 'question-images');
const QIMG_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/* The first bytes of the file must really be the image type it claims, so a
   renamed document or script cannot pass on its file name alone. */
function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function findQuestionImage(id) {
  if (!/^QIMG-[A-Za-z0-9]{8,40}$/.test(String(id || ''))) return null;
  for (const ext of Object.keys(QIMG_MIME)) {
    const f = path.join(QIMG_DIR, id + '.' + ext);
    if (fs.existsSync(f)) return { file: f, ext };
  }
  return null;
}

/* A question naming a picture that was never uploaded (or was removed) is
   refused, the same way a link to a missing passage is. */
function imageLinkError(rec) {
  if (rec && rec.imageId && !findQuestionImage(rec.imageId)) {
    return 'That picture is not on the server. Upload it again.';
  }
  return null;
}

async function handleQuestionImageUpload(req, res) {
  const chunks = [];
  let name = '', mimeType = '', size = 0, truncated = false, seen = false;
  try {
    await new Promise((resolve, reject) => {
      const busboy = getBusboy()({
        headers: req.headers,
        limits: { files: 1, fileSize: core.IMAGE_MAX_BYTES + 1, fields: 5, fieldSize: 1024 }
      });
      busboy.on('file', (field, file, info) => {
        seen = true;
        name = String(info.filename || '');
        mimeType = String(info.mimeType || '').toLowerCase();
        file.on('data', c => { size += c.length; chunks.push(c); });
        file.on('limit', () => { truncated = true; });
        file.on('error', reject);
      });
      busboy.on('error', reject);
      busboy.on('finish', resolve);
      req.pipe(busboy);
    });
  } catch (err) {
    console.error('[goc] question image upload parse failed:', err && err.message);
    return errJson(res, 400, 'That upload could not be read.');
  }
  if (!seen) return errJson(res, 400, 'Please choose a picture to upload.');
  const gate = core.validateImageUpload({ type: mimeType, name: name, size: truncated ? core.IMAGE_MAX_BYTES + 1 : size });
  if (gate.error) return errJson(res, 400, gate.error);
  const buf = Buffer.concat(chunks);
  if (sniffImageExt(buf) !== gate.ok.ext) {
    return errJson(res, 400, 'That file is not a real ' + gate.ok.ext.toUpperCase() + ' picture.');
  }
  const imageId = 'QIMG-' + crypto.randomBytes(8).toString('hex');
  try {
    fs.mkdirSync(QIMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(QIMG_DIR, imageId + '.' + gate.ok.ext), buf);
  } catch (err) {
    console.error('[goc] question image write failed:', err.message);
    return errJson(res, 500, 'The picture could not be saved.');
  }
  return okJson(res, { imageId: imageId, type: QIMG_MIME[gate.ok.ext], bytes: buf.length });
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
    jambMinutes: doc.jambMinutes == null ? null : Number(doc.jambMinutes),
    jambCounts: doc.jambCounts ? JSON.parse(doc.jambCounts) : null,
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
    jambMinutes: core.clampJambMinutes(st.jambMinutes),
    jambCounts: Object.assign({}, st.jambCounts || {}),
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
  if (cohort.jambMinutes != null) base.jambMinutes = core.clampJambMinutes(cohort.jambMinutes);
  if (cohort.jambCounts) {
    Object.keys(cohort.jambCounts).forEach(sub => {
      if (cohort.jambCounts[sub] != null) base.jambCounts[sub] = cohort.jambCounts[sub];
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

/* ------------------------------------------------------------------ tutors
   Phase 3C slices 2-3. Tutor accounts are kept in db.tutors. The sign-in route,
   the session role 'tutor' and the scope guard below are separate from the console's
   routes on purpose: a tutor can only ever read or write their own subjects. */
/* Phase 3C slice 4: the hidden door. A secret word typed into the Scholar ID box on the
   log-in screen is sent here. The word lives ONLY in the GOC_TUTOR_DOOR environment variable
   (never in any file the browser can download), a right word returns a single-use token valid
   for 60 seconds, and only that token fetches the tutor screens' code, which sits in
   server/tutor/ (the static server never serves server/). With no word set the door is
   closed and answers exactly like an address that does not exist.
   Honest limit: this hides the tutor screens, it is not what protects the data. The tutor
   sign-in, its lock-outs and the scope guard on every tutor route are. */
const DOOR_WORD_MIN = 6;
function doorNormal(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80); }
const DOOR_WORD_RAW = doorNormal(process.env.GOC_TUTOR_DOOR);
const DOOR_WORD = DOOR_WORD_RAW.length >= DOOR_WORD_MIN ? DOOR_WORD_RAW : '';
const DOOR_DIGEST = DOOR_WORD ? crypto.createHash('sha256').update(DOOR_WORD).digest() : null;
const DOOR_TOKEN_MS = Number(process.env.GOC_DOOR_TOKEN_MS) || 60 * 1000;   // the override exists for the tests
const DOOR_MISS_MAX = 6;
const DOOR_MISS_WINDOW_MS = 15 * 60 * 1000;
const doorMisses = new Map();                 // address -> { count, first }
const doorTokens = new Map();                 // token -> expiry time
const TUTOR_BUNDLE = path.join(__dirname, 'tutor', 'tutor-app.js');

function doorLocked(ip) {
  const rec = doorMisses.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > DOOR_MISS_WINDOW_MS) { doorMisses.delete(ip); return false; }
  return rec.count >= DOOR_MISS_MAX;
}
function doorMiss(ip) {
  const rec = doorMisses.get(ip);
  if (!rec || Date.now() - rec.first > DOOR_MISS_WINDOW_MS) doorMisses.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}
function doorWordOk(word) {
  if (!DOOR_DIGEST) return false;
  const given = crypto.createHash('sha256').update(doorNormal(word)).digest();
  return crypto.timingSafeEqual(given, DOOR_DIGEST);
}
/* Optional second part of the door: GOC_TUTOR_DOOR_PW (case and stray spaces ignored, so phone keyboards cannot break it). */
const DOOR_PW_DIGEST = process.env.GOC_TUTOR_DOOR_PW
  ? crypto.createHash('sha256').update(doorNormal(process.env.GOC_TUTOR_DOOR_PW)).digest() : null;
function doorPwOk(pw) {
  if (!DOOR_PW_DIGEST) return true;
  const given = crypto.createHash('sha256').update(doorNormal(pw)).digest();
  return crypto.timingSafeEqual(given, DOOR_PW_DIGEST);
}
function doorMint() {
  const now = Date.now();
  doorTokens.forEach((exp, k) => { if (exp <= now) doorTokens.delete(k); });
  if (doorTokens.size >= 200) return null;
  const token = crypto.randomBytes(24).toString('hex');
  doorTokens.set(token, now + DOOR_TOKEN_MS);
  return token;
}
/* Single use: the token is gone the moment it is looked at, right or late. */
function doorSpend(token) {
  const exp = doorTokens.get(token);
  doorTokens.delete(token);
  return !!exp && exp > Date.now();
}

const tutorFails = new Map();                 // tutor ID -> { count, first }
const TUTOR_FAIL_MAX = 10;
const TUTOR_FAIL_WINDOW_MS = 15 * 60 * 1000;
let TUTOR_DUMMY_HASH = null;

function tutorIdLocked(id) {
  const rec = tutorFails.get(id);
  if (!rec) return false;
  if (Date.now() - rec.first > TUTOR_FAIL_WINDOW_MS) { tutorFails.delete(id); return false; }
  return rec.count >= TUTOR_FAIL_MAX;
}
function tutorIdFailed(id) {
  const rec = tutorFails.get(id);
  if (!rec || Date.now() - rec.first > TUTOR_FAIL_WINDOW_MS) tutorFails.set(id, { count: 1, first: Date.now() });
  else rec.count += 1;
}

function dropTutorSessions(tutorId) {
  sessions.forEach((v, k) => { if (v.role === 'tutor' && v.id === tutorId) sessions.delete(k); });
}

/* What the console may see of a tutor: never the hash. */
function tutorRow(t) {
  const pub = core.tutorPublic(t);
  delete pub.pwHash;
  pub.active = t.active !== false;
  pub.mustChangePassword = !!t.mustChangePassword;
  return pub;
}

/* Phase 3C slice 5: keep the tutor counters as answers are marked. Only a GOC student's
   answers are counted (the same people the snapshot counts), only objective answers that
   were actually given, and nothing but counts is stored: no ID, no name, no time. Changes
   `db` in place and writes it. Never allowed to break a submit: any failure is logged and
   the student's own result carries on. */
function noteAnswerStats(db, stu, subject, rows) {
  try {
    if (!stu || core.cleanTier(stu.tier) !== 'goc') return false;
    if (!db.answerStats || typeof db.answerStats !== 'object') db.answerStats = {};
    core.recordAnswerStats(db.answerStats, subject, rows);
    writeData(db);
    return true;
  } catch (e) {
    console.error('[goc] Tutor answer counters not updated:', e.message);
    return false;
  }
}

/* The one scope guard. Returns the subject this request may act on, or sends the
   refusal and returns null. Every tutor route that touches subject data calls it. */
function tutorSubjectOr403(res, sess, requested) {
  const r = core.tutorSubjectFor(sess.tutor, requested);
  if (r.error) { errJson(res, 403, r.error); return null; }
  return r.subject;
}

/* Who is reviewing: the signed-in management account, by ID and name. */
function reviewerOf(sess) {
  const d = (sess && sess.data) || {};
  return { id: d.id, name: d.name || d.id, role: d.role };
}

/* One read-mark-write cycle for a theory script, shared by the console and the tutor route.
   Same lost-update risk as the test-submit route: the Appwrite branch awaits an XP update between
   reading and writing the local file, so the whole cycle is held under one lock.
   `marker` is { id } for the console, or { id, tutor } for a tutor. `guard(a)` may refuse a script
   before anything changes. A tutor save that leaves the script fully marked raises an admin alert
   in the same locked write (an unseen alert for the same script is updated, not stacked). */
async function markTheoryScript(attemptId, marks, marker, guard) {
  return withDataLock(async () => {
    const db = readData();
    const a = await getAttemptById(attemptId, db);
    if (!a) return { error: [404, 'That result no longer exists.'] };
    if (a.section !== 'theory') return { error: [400, 'Only theory papers are marked by hand.'] };
    if (guard) { const g = guard(a); if (g) return { error: g }; }
    const was = a.status;
    core.applyTheoryMarks(a, marks || {});
    a.markedBy = marker.id;
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

    await updateAttempt(a.id, a, db);
    let alerted = false;
    if (marker.tutor && a.status === 'marked') {
      db.settings.alertSeq = (db.settings.alertSeq || 0) + 1;
      const al = core.makeMarkAlert(marker.tutor, a, was === 'marked', Date.now());
      al.id = 'AL-' + db.settings.alertSeq;
      db.alerts = core.addAlert(db.alerts, al);
      alerted = true;
    }
    writeData(db);
    return { a, alerted };
  });
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

      // A pending account exists but has not been approved yet.
      if (isStudent && account && account.pendingApproval) {
        return errJson(res, 403, 'Your account is awaiting approval. The academy will review your registration and activate your access shortly.');
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
      } else if (isStaff && account.id !== 'GOC-A-001' && account.id !== 'GOC-A-002') {
        // Migrated managers authenticate through Appwrite Auth; unmigrated managers
        // continue using their existing local password hash.
        // When Appwrite is not configured (endpoint/projectId missing — e.g. in a
        // test environment) verifyAppwritePassword throws before any network call.
        // In that case we fall back to the local pwHash that was stored at account
        // creation time, so tests and offline deployments still work correctly.
        if (account.active !== false) {
          if (account.appwriteUserId) {
            try {
              await require('./lib/appwrite').verifyAppwritePassword(
                account.id.toLowerCase() + '@gocacademy.com',
                password
              );
              passwordOk = true;
            } catch (_) {
              // A linked manager must authenticate through Appwrite.
              // Never accept the local hash when Appwrite verification fails.
              passwordOk = false;
            }
          } else {
            // Preserve local authentication for existing, unlinked managers.
            passwordOk = verifyPassword(password, account.pwHash);
          }
        }
      } else if (isStaff) {
        // TEMPORARY LOCAL TEST: use the seeded account's data.json hash.
        if (account.pwHash) {
          passwordOk = verifyPassword(password, account.pwHash);
        } else {
          const staffPassword =
            account.id === 'GOC-A-001' ? process.env.GOC_FOUNDER_PW :
            account.id === 'GOC-A-002' ? process.env.GOC_ACADDIR_PW :
            null;
          passwordOk = Boolean(staffPassword) && password === staffPassword;
        }
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
        roleKey: sessions.get(token).roleKey,
        subjects: isStaff ? [] : (account.subjects || []).slice(),
        exam: isStaff ? null : core.EXAM,
        sessionMinutes: sessions.get(token).sessionMinutes,
        expiresAt: sessions.get(token).expires,
        mustChangePassword: !!account.mustChangePassword
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

  { method: 'GET', path: /^\/api\/auth\/session$/, need: 'staff-or-student', allowTutor: true, handler: (req, res, body, sess) => {
      const d = sess.data;
      okJson(res, {
        id: d.id, name: d.name, role: d.role, title: d.title,
        roleKey: d.roleKey || null,
        subjects: (d.subjects || []).slice(), exam: d.exam,
        sessionMinutes: d.sessionMinutes, expiresAt: d.expires
      });
    } },

  /* Priority 9 — the countdown on screen asks the server how long is left, so
     the browser is displaying the real remaining time rather than guessing. */
  { method: 'GET', path: /^\/api\/auth\/session-info$/, need: 'staff-or-student', allowTutor: true, handler: (req, res, body, sess) => {
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
      /* Roles slice (c), step 3a: a manager opens the console with their OWN passcode (set by the
         Founder) and never the shared one; the two seeded accounts keep the shared passcode.
         A manager record with no passcode on it can open nothing. */
      const mgr = (db.staff || []).find(x => x.id === sess.data.id && x.id !== 'GOC-A-001' && x.id !== 'GOC-A-002');
      const wantHash = mgr ? mgr.passcodeHash : db.settings.consolePasscodeHash;
      if (!verifyPassword(String(body.passcode == null ? '' : body.passcode), wantHash)) {
        noteFailure(ip);
        return errJson(res, 403, 'Incorrect passcode — access denied.');
      }
      attempts.delete(ip);
      sess.data.unlocked = true;
      okJson(res, { unlocked: true });
    } },

  /* Roles slice (c), step 3b: a manager replaces the starting password the Founder typed.
     Allowed while the forced change is pending (need 'staff', like unlock), which is the only
     way out of that state. Only manager accounts: the two seeded accounts' passwords live in
     the environment and are changed by the Founder in the console. The console passcode is
     never touched here (the Founder alone sets it). Wrong guesses at the current password
     count against the same per-address limit as sign-in. */
  { method: 'POST', path: /^\/api\/auth\/password$/, need: 'staff', handler: (req, res, body, sess) => {
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      if (sess.data.id === 'GOC-A-001' || sess.data.id === 'GOC-A-002') {
        return errJson(res, 403, 'This account’s password is changed by the Founder in the console.');
      }
      const current = String(body.currentPassword == null ? '' : body.currentPassword);
      const next = String(body.newPassword == null ? '' : body.newPassword);
      return withDataLock(async () => {
        const db = readData();
        const m = (db.staff || []).find(x => x.id === sess.data.id);
        if (!m || m.active === false) {
          sessions.delete(sess.token);
          return errJson(res, 403, 'This account has been switched off by the academy.');
        }
        if (!verifyPassword(current, m.pwHash)) {
          noteFailure(ip);
          return errJson(res, 400, 'Your current password is not right.');
        }
        const bad = core.managerPasswordChangeError(current, next);
        if (bad) return errJson(res, 400, bad);
        // Synchronize migrated manager passwords before committing local changes.
        if (m.appwriteUserId) {
          if (!appwriteUsers) {
            return errJson(res, 503, 'Password service is temporarily unavailable. Please try again.');
          }
          try {
            await appwriteUsers.updatePassword(m.appwriteUserId, next);
          } catch (err) {
            console.error('[goc] Appwrite password sync failed for', m.id, err.message);
            return errJson(res, 503, 'Password could not be saved. Please try again.');
          }
        }

        attempts.delete(ip);
        m.pwHash = hashPassword(next);
        m.mustChangePassword = false;
        m.passwordChangedAt = new Date().toISOString();
        writeData(db);
        sess.data.mustChangePassword = false;
        /* any other session this manager has open (an old phone) is ended */
        sessions.forEach((d, tok) => { if (d.id === m.id && tok !== sess.token) sessions.delete(tok); });
        okJson(res, { ok: true, mustChangePassword: false });
      });
    } },

  { method: 'POST', path: /^\/api\/auth\/lock$/, need: 'staff', handler: (req, res, body, sess) => {
      sess.data.unlocked = false;
      okJson(res, { ok: true });
    } },

  { method: 'GET', path: /^\/api\/students$/, need: 'console', cap: 'roster.view', handler: async (req, res) => {
      const db = readData();
      const students = appwriteDatabases
        ? await listAppwriteStudents()
        : db.students;
      okJson(res, await Promise.all(students.map(s => publicStudent(db, s, { console: true }))));
    } },

  /* Public: this is the sign-up form. UTME only, and the subject combination is
     validated here as well as on screen — the rule belongs to the server.
     Sign-up is open (Phase 3B slice 5): anyone may register, and every self-made
     account is Open. There is no access code any more. What stops one person
     minting accounts is a limit on SUCCESSFUL sign-ups per address. */
  { method: 'POST', path: /^\/api\/students$/, need: null, handler: async (req, res, body) => {
      const ip = getClientIp(req);
      /* Sign-up runs a deliberately slow password hash, so the failed-attempt
         throttle that guards login still applies here too. */
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      const db = readData();
      const lim = signupLimitsOf(db);
      const blocked = signupBlocked(ip, lim);
      if (blocked) {
        res.setHeader('Retry-After', String(blocked.retryAfter));
        return errJson(res, 429, core.signupLimitMessage(blocked.retryAfter, blocked.window));
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
        /* Self-registered accounts are Open and start inactive, pending admin
           approval. Only the console activates them (admin-approval flow). */
        tier: 'open',
        active: false, pendingApproval: true,
        xp: 0, streak: 0, streakDay: null, streakFreezes: 0,
        last: 'Awaiting approval', tag: 'a', tl: 'Pending',
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
      noteSignup(ip);

      /* Admin-approval flow: no session is issued at sign-up. The student must
         wait for a Founder or Academic Director to approve their account from
         the console before they can log in. */
      okJson(res, {
        pending: true,
        student: { id: rec.id, name: rec.name }
      });
    } },

  /* Priority 7 — close or reopen an account. History is never deleted. */
  { method: 'PUT', path: /^\/api\/students\/([A-Za-z0-9-]+)\/active$/, need: 'console', cap: 'students.deactivate', handler: async (req, res, body, sess, params) => {
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
        return okJson(res, await publicStudent(db, updatedStudent, { console: true }));
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
      okJson(res, await publicStudent(db, s, { console: true }));
    } },

  /* Admin-approval flow: approve a pending self-registered account.
     Sets active = true, clears pendingApproval, records who approved and when. */
  { method: 'POST', path: /^\/api\/students\/([A-Za-z0-9-]+)\/approve$/, need: 'console', cap: 'students.approve', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');
        const patch = {
          active: true, pendingApproval: false,
          tl: 'New', tag: 'g', last: 'Approved',
          approvedBy: sess.data.id,
          approvedAt: new Date().toISOString()
        };
        const updated = await updateAppwriteStudent(studentId, patch);
        return okJson(res, await publicStudent(db, appwriteStudentToRecord(updated), { console: true }));
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');
      if (!s.pendingApproval) return errJson(res, 400, 'This account is not awaiting approval.');
      s.active = true;
      s.pendingApproval = false;
      s.tl = 'New'; s.tag = 'g'; s.last = 'Approved';
      s.approvedBy = sess.data.id;
      s.approvedAt = new Date().toISOString();
      writeData(db);
      okJson(res, await publicStudent(db, s, { console: true }));
    } },

  /* Admin-approval flow: reject and delete a pending account entirely. */
  { method: 'DELETE', path: /^\/api\/students\/([A-Za-z0-9-]+)\/approve$/, need: 'console', cap: 'students.approve', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');
        if (!s.pendingApproval) return errJson(res, 400, 'This account is not awaiting approval.');
        if (s.appwriteUserId) {
          try { await deleteAppwriteAuthUser(s.appwriteUserId); } catch (_) {}
        }
        try { await appwriteDatabases.deleteDocument(APPWRITE_DB_ID, APPWRITE_STUDENTS_COLLECTION, studentId); } catch (_) {}
        return okJson(res, { rejected: true, id: studentId });
      }

      const idx = db.students.findIndex(x => x.id === studentId);
      if (idx === -1) return errJson(res, 404, 'No such Scholar ID.');
      if (!db.students[idx].pendingApproval) return errJson(res, 400, 'This account is not awaiting approval.');
      db.students.splice(idx, 1);
      writeData(db);
      okJson(res, { rejected: true, id: studentId });
    } },

  { method: 'POST', path: /^\/api\/students\/([A-Za-z0-9-]+)\/reset$/, need: 'console', cap: 'students.passwords', handler: async (req, res, body, sess, params) => {
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
  { method: 'POST', path: /^\/api\/admin\/students$/, need: 'console', cap: 'students.add', handler: async (req, res, body, sess) => {
      const db = readData();
      const name = clean(body.name, 80);
      if (name.length < 2) return errJson(res, 400, 'Enter the student\'s full name.');

      const exam = core.requireExam(body.goal);
      if (!exam.ok) return errJson(res, 400, exam.error);
      const combo = core.validateSubjects(Array.isArray(body.subjects) ? body.subjects : []);
      if (!combo.ok) return errJson(res, 400, combo.error);
      /* Optional: Open or GOC; left out it is GOC (Phase 3B decision 3). */
      const newTier = core.newStudentTier(body.tier);
      if (!newTier.ok) return errJson(res, 400, newTier.error);

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
        /* A student the academy adds itself is GOC unless the console chose Open
           (Phase 3B decision 3). Appwrite stores only 'goc'; Open stores nothing. */
        tier: newTier.tier,
        active: true, xp: 0, streak: 0, streakDay: null, streakFreezes: 0,
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

      okJson(res, { student: await publicStudent(db, rec, { console: true }), temporaryPassword: temp });
    } },

  /* Overview panel — the four headline numbers, computed here in one place
     rather than the client stitching together four separate fetches.
     "Lessons published" needs Appwrite (resources/videos live only there,
     same as the admin resources/videos list routes); everything else works
     in flat-file mode too. */
  { method: 'GET', path: /^\/api\/admin\/overview$/, need: 'console', cap: 'overview.own', handler: async (req, res, body, sess) => {
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
        ? (await getMarkedAttemptsForPerformance(db)).filter(a => typeof a.percent === 'number')
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

      /* Roles slice (d) follow-up: every management role may open the Overview, but each sees only
         the figures its capabilities allow (core.overviewFor); the Founder and the seeded accounts see all four. */
      okJson(res, core.overviewFor(sess.data.id, sess.data.roleKey, { studentsTotal, activeToday, avgScorePercent, lessonsPublished }));
    } },

  /* ============================ ONE-OFF APPWRITE MIGRATION (implementation-map
     STEP 4) — copies the live questions/attempts out of the local data.json
     blob into their Appwrite collections, and pushes the remaining blob up to
     Appwrite Storage. Console-authenticated (same tier as /api/questions*), so
     it can be triggered once by an admin from the browser on the running app
     before the code cuts over — the only place the real pre-migration data
     reliably exists on a host with no shell.

     SAFE TO RUN TWICE: every write is an upsert, so a second run creates no
     duplicates. It NEVER writes to, deletes, or truncates data.json. It reports
     a read-vs-written reconciliation and refuses to report success on a
     mismatch. */
  { method: 'POST', path: /^\/api\/admin\/migrate-appwrite$/, need: 'console', cap: 'system.migrate', handler: async (req, res) => {
      if (!appwriteDatabases) {
        return errJson(res, 503, 'Appwrite is not configured — set the APPWRITE_* env vars first.');
      }
      const db = readData();
      const questions = Array.isArray(db.questions) ? db.questions : [];
      const attempts = Array.isArray(db.attempts) ? db.attempts : [];

      let qWritten = 0, aWritten = 0;
      const errors = [];

      for (const q of questions) {
        try {
          await appwriteDatabases.upsertDocument(
            APPWRITE_DATABASE_ID, APPWRITE_QUESTIONS_COLLECTION_ID,
            String(q.id), questionToDoc(q));
          qWritten++;
        } catch (err) {
          errors.push('question ' + q.id + ': ' + err.message);
        }
      }

      for (const a of attempts) {
        try {
          await appwriteDatabases.upsertDocument(
            APPWRITE_DATABASE_ID, APPWRITE_ATTEMPTS_COLLECTION_ID,
            String(a.id), attemptToDoc(a));
          aWritten++;
        } catch (err) {
          errors.push('attempt ' + a.id + ': ' + err.message);
        }
      }

      /* Push the remaining blob (settings/notes/topics/contactMessages/
         affirmations/importLog) up to Storage and wait for that write to land,
         so the reconciliation below reflects a completed run. */
      let blobUploaded = false;
      if (blobStorageEnabled()) {
        scheduleBlobUpload();
        try { await appwriteSaveChain; blobUploaded = true; }
        catch (err) { errors.push('blob upload: ' + err.message); }
      }

      const qRead = questions.length, aRead = attempts.length;
      const reconciled = (qWritten === qRead) && (aWritten === aRead) && errors.length === 0;
      const payload = {
        ok: reconciled,
        questions: { read: qRead, written: qWritten },
        attempts: { read: aRead, written: aWritten },
        blobUploaded,
        errors
      };
      if (!reconciled) {
        console.error('[goc] Appwrite migration reconciliation mismatch:', JSON.stringify(payload));
        return send(res, 500, Object.assign({ error: 'Migration reconciliation failed — read/written counts do not match. See server logs.' }, payload));
      }
      console.log('[goc] Appwrite migration complete:', JSON.stringify(payload));
      okJson(res, payload);
    } },

  { method: 'GET', path: /^\/api\/staff$/, need: 'console', cap: 'managers.accounts', handler: (req, res) => {
      // Names and titles only. The password hash never leaves the server.
      okJson(res, readData().staff.map(s => ({ id: s.id, name: s.name, title: s.title })));
    } },

  { method: 'GET', path: /^\/api\/updates$/, need: null, handler: (req, res) => {
      okJson(res, readData().updates);
    } },

  { method: 'POST', path: /^\/api\/updates$/, need: 'console', cap: 'homepage.edit', handler: (req, res, body) => {
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

  { method: 'DELETE', path: /^\/api\/updates\/(\d+)$/, need: 'console', cap: 'homepage.edit', handler: (req, res, body, sess, params) => {
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
  { method: 'PUT', path: /^\/api\/affirmations$/, need: 'console', cap: 'homepage.edit', handler: (req, res, body) => {
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

  /* One-tap opt-out from the link in every reminder email. Public on purpose —
     the student may not be signed in on the phone that opens it — and safe
     because the link carries a 128-bit token that exists only in that
     student's reminder state. It switches EMAIL reminders off at once (no
     second confirmation), and the page offers a link to turn them back on, so a
     mail scanner that fetches the link by itself costs the student nothing
     permanent. An unknown id or a wrong token reveals nothing. */
  { method: 'GET', path: /^\/api\/unsubscribe$/, need: null, handler: async (req, res) => {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const id = String(q.get('id') || ''), tok = String(q.get('t') || '');
      const back = q.get('back') === '1';
      const page = (status, title, msg, extra) => {
        const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
          '<body style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:12vh auto;padding:0 20px;color:#1f2937;text-align:center">' +
          '<h2>' + title + '</h2><p>' + msg + '</p>' + (extra || '') + '</body></html>';
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html),
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
        });
        res.end(html);
      };
      const valid = /^[A-Za-z0-9-]{1,40}$/.test(id) && /^[0-9a-f]{32}$/.test(tok);
      const done = valid && await withDataLock(async () => {
        const db = readData();
        const cur = db.reminderState && db.reminderState[id];
        if (!cur || !reminders.tokenMatches(cur.token, tok)) return false;
        cur.prefs = Object.assign(core.cleanReminderPrefs(cur.prefs), { email: back });
        writeData(db);
        return true;
      });
      if (!done) {
        return page(404, 'This link is no longer valid',
          'Sign in to the hub and use Profile \u2192 Study reminders to change your reminders.');
      }
      const link = '/api/unsubscribe?id=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(tok);
      if (back) {
        return page(200, 'Reminders are back on',
          'You will get study reminders by email again.',
          '<p><a href="' + link + '">Turn them off again</a></p>');
      }
      page(200, 'Reminders turned off',
        'You will not get study reminder emails any more. You can switch them back on any time in Profile \u2192 Study reminders.',
        '<p><a href="' + link + '&back=1">Changed your mind? Turn them back on</a></p>');
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
        jambMinutes: core.clampJambMinutes(st.jambMinutes),
        jambReadyMin: core.clampJambReadyMin(st.jambReadyMin),
        hasGuardianPin: !!core.normalizeGuardianPin(st.guardianPin)
      };
      if (isConsole) out.guardianPin = st.guardianPin || '';
      okJson(res, out);
    } },

  { method: 'PUT', path: /^\/api\/settings$/, need: 'console', cap: 'sittings.configure', handler: (req, res, body) => {
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
      if (body.jambMinutes !== undefined) {
        db.settings.jambMinutes = core.clampJambMinutes(body.jambMinutes);
      }
      if (body.jambReadyMin !== undefined) {
        db.settings.jambReadyMin = core.clampJambReadyMin(body.jambReadyMin);
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
        jambMinutes: core.clampJambMinutes(db.settings.jambMinutes),
        jambReadyMin: core.clampJambReadyMin(db.settings.jambReadyMin),
        hasGuardianPin: !!core.normalizeGuardianPin(db.settings.guardianPin),
        guardianPin: db.settings.guardianPin || ''
      });
    } },

  /* How many questions one paper of the objective sitting serves. The UTME
     ceiling is the law here — 60 for Use of English, 40 for a science — and
     management may only come in under it, never over. */
  { method: 'PUT', path: /^\/api\/settings\/objective-count$/, need: 'console', cap: 'sittings.configure', handler: (req, res, body) => {
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

  /* How many questions one paper of the JAMB-oriented sitting serves. Same
     UTME ceilings as the objective sitting, configured independently. */
  { method: 'PUT', path: /^\/api\/settings\/jamb-count$/, need: 'console', cap: 'sittings.configure', handler: (req, res, body) => {
      const db = readData();
      const sub = clean(body.subject, 40);
      if (core.ALL_SUBJECTS.indexOf(sub) === -1) {
        return errJson(res, 400, 'That is not one of the academy’s subjects.');
      }
      db.settings.jambCounts = db.settings.jambCounts || {};
      db.settings.jambCounts[sub] = core.jambCount(sub, { [sub]: body.questions });
      writeData(db);
      okJson(res, { subject: sub, questions: db.settings.jambCounts[sub],
                    ceiling: core.jambCeiling(sub),
                    jambCounts: db.settings.jambCounts });
    } },

  /* What the sitting would look like right now, paper by paper, so a shortfall
     in the bank is visible in the console before a student meets it. */
  { method: 'GET', path: /^\/api\/objective\/blueprint$/, need: 'console', cap: 'sittings.configure', handler: async (req, res) => {
      const db = readData();
      const period = core.normalizePeriod(new URL(req.url, 'http://localhost').searchParams.get('period'));
      const rows = core.objectiveBlueprint(await listQuestions({}, db), core.ALL_SUBJECTS,
                                           db.settings.objectiveCounts);
      const minutes = core.clampObjectiveMinutes(db.settings.objectiveMinutes);
      okJson(res, { period, periodLabel: core.PERIOD_LABEL, minutes,
                    minutesLabel: core.hoursLabel(minutes),
                    ceiling: core.OBJECTIVE_CEILING, papers: rows,
                    fullCombinationTotal: core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 });
    } },

  /* The JAMB-oriented sitting's blueprint — same shape as objective, drawn from
     the jamb pool (jamb-tagged + objective questions). */
  { method: 'GET', path: /^\/api\/jamb\/blueprint$/, need: 'console', cap: 'sittings.configure', handler: async (req, res) => {
      const db = readData();
      const period = core.normalizePeriod(new URL(req.url, 'http://localhost').searchParams.get('period'));
      const rows = core.jambBlueprint(await listQuestions({}, db), core.ALL_SUBJECTS,
                                      db.settings.jambCounts);
      const minutes = core.clampJambMinutes(db.settings.jambMinutes);
      /* Readiness is judged over every academy subject here — the console sees
         the whole bank, not one student's combination. */
      const readiness = core.jambReadiness(await listQuestions({}, db), core.ALL_SUBJECTS, db.settings.jambReadyMin);
      okJson(res, { period, periodLabel: core.PERIOD_LABEL, minutes,
                    minutesLabel: core.hoursLabel(minutes),
                    readyMin: readiness.min, readiness,
                    ceiling: core.OBJECTIVE_CEILING, papers: rows,
                    fullCombinationTotal: core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 });
    } },

  /* -------------------------------------------- Priority 8: credential control
     Both routes sit behind the 'founder' tier, which the dispatcher enforces
     before the handler runs. Hiding the buttons in the interface is not the
     control; this is. */

  { method: 'GET', path: /^\/api\/staff\/access$/, need: 'console', cap: 'managers.accounts', handler: (req, res, body, sess) => {
      const db = readData();
      okJson(res, {
        staff: db.staff.map(s => ({ id: s.id, name: s.name, title: s.title })),
        isFounder: sess.data.title === 'Founder',
        passcodeLength: Number(db.settings.consolePasscodeLength) || 4,
        /* Sign-ups per address: what is in force, and when and by whom it was last changed. */
        signupLimits: core.signupLimits(db.settings),
        signupLimitsChangedAt: db.settings.signupLimitsChangedAt || null,
        signupLimitsChangedBy: db.settings.signupLimitsChangedBy || null,
        sessionMinutes: db.settings.sessionMinutes,
        sessionWarnMinutes: db.settings.sessionWarnMinutes
      });
    } },

  /* Sign-ups per address. Both the Founder and the Academic Director admit scholars, so
     this sits at the 'console' tier, not 'founder'. */
  { method: 'PUT', path: /^\/api\/settings\/signup-limits$/, need: 'console', cap: 'signup.limits', handler: (req, res, body, sess) => {
      const v = core.validateSignupLimits(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.signupPerHour = v.perHour;
      db.settings.signupPerDay = v.perDay;
      db.settings.signupLimitsChangedAt = new Date().toISOString();
      db.settings.signupLimitsChangedBy = sess.data.id;
      writeData(db);
      okJson(res, { limits: core.signupLimits(db.settings), changed: true,
                    changedAt: db.settings.signupLimitsChangedAt,
                    changedBy: db.settings.signupLimitsChangedBy });
    } },

  /* ---- Phase 3E.B: Web Test "rounds" ----------------------------------------
     Each time the academy publishes a fresh Web Test for a section+subject it
     opens a new round. The one-sit rule (core.canSit) counts only attempts in
     the CURRENT round, so a student who finished the last round can sit the new
     one, while every earlier result stays in the record and the league average.
     Before any round is opened the number is 1 and nothing changes. */

  /* Resolve and validate a {section, subject} pair for a round. Objective and
     JAMB-oriented papers are sat under the single OBJECTIVE_SUBJECT; theory is
     per real subject. Returns { error } or { section, subject }. */
  // (helper defined inline in the handlers below)

  { method: 'GET', path: /^\/api\/rounds$/, need: 'console', cap: 'sittings.configure', handler: async (req, res, body, sess) => {
      const db = readData();
      const q = new URL(req.url, 'http://localhost').searchParams;
      const r = roundTarget(String(q.get('section') || ''), String(q.get('subject') || ''));
      if (r.error) return errJson(res, 400, r.error);
      const served = await roundServedCount(db, r.section, r.subject);
      okJson(res, { section: r.section, subject: r.subject,
                    round: currentRound(db, r.section, r.subject),
                    isOpen: roundIsOpen(db, r.section, r.subject), served });
    } },

  { method: 'POST', path: /^\/api\/rounds\/open$/, need: 'console', cap: 'sittings.configure', handler: async (req, res, body, sess) => {
      const r = roundTarget(String((body && body.section) || ''), String((body && body.subject) || ''));
      if (r.error) return errJson(res, 400, r.error);
      const result = await withDataLock(async () => {
        const db = readData();
        if (!db.settings.rounds) db.settings.rounds = {};
        if (!Array.isArray(db.rounds)) db.rounds = [];
        const key = r.section + '|' + r.subject;
        const next = currentRound(db, r.section, r.subject) + 1;
        const openedAt = new Date().toISOString();
        /* Store as object so isOpen and openedAt survive redeploy alongside the
           round number. currentRound() reads .n; roundIsOpen() reads .isOpen. */
        db.settings.rounds[key] = { n: next, isOpen: true, openedAt };
        const name = clean(body && body.name, 80) || ('Round ' + next);
        db.rounds.push({ section: r.section, subject: r.subject, round: next, name,
                         openedBy: sess.data.id, openedAt });
        writeData(db);
        return { next, name, openedAt };
      });
      const served = await roundServedCount(readData(), r.section, r.subject);
      okJson(res, { opened: true, section: r.section, subject: r.subject,
                    round: result.next, name: result.name, isOpen: true,
                    openedAt: result.openedAt, served, openedBy: sess.data.id });
    } },

  { method: 'POST', path: /^\/api\/rounds\/close$/, need: 'console', cap: 'sittings.configure', handler: async (req, res, body, sess) => {
      const r = roundTarget(String((body && body.section) || ''), String((body && body.subject) || ''));
      if (r.error) return errJson(res, 400, r.error);
      const result = await withDataLock(async () => {
        const db = readData();
        if (!db.settings.rounds) db.settings.rounds = {};
        const key = r.section + '|' + r.subject;
        const cur = currentRound(db, r.section, r.subject);
        const closedAt = new Date().toISOString();
        /* Preserve the round number; only flip the open flag. */
        db.settings.rounds[key] = { n: cur, isOpen: false, openedAt: (db.settings.rounds[key] && db.settings.rounds[key].openedAt) || null, closedAt };
        writeData(db);
        return { cur, closedAt };
      });
      okJson(res, { closed: true, section: r.section, subject: r.subject,
                    round: result.cur, isOpen: false, closedAt: result.closedAt });
    } },

  /* ---- Phase 4.C: team (cohort) challenges. The console opens a one-week challenge for a cohort
     (a team total of practice questions); each member's progress folds in at practice submit, and
     a finished team earns every member one streak freeze. Stored in the data file. ---- */
  { method: 'POST', path: /^\/api\/challenges$/, need: 'console', cap: 'challenges.manage', handler: (req, res, body, sess) => {
      const v = core.validateChallenge(body, core.dayStamp());
      if (v.error) return errJson(res, 400, v.error);
      return withDataLock(async () => {
        const db = readData();
        db.settings.challengeSeq = (db.settings.challengeSeq || 0) + 1;
        v.rec.id = 'CHL-' + db.settings.challengeSeq;
        v.rec.createdBy = sess.data.id;
        v.rec.createdAt = new Date().toISOString();
        db.challenges.push(v.rec);
        writeData(db);
        okJson(res, { challenge: v.rec, created: true });
      });
    } },

  { method: 'GET', path: /^\/api\/challenges$/, need: 'console', cap: 'challenges.manage', handler: (req, res) => {
      const db = readData();
      const rows = (db.challenges || []).slice().reverse().map(c => Object.assign({ teamTotal: challengeTeamTotal(db, c), done: core.challengeDone(challengeTeamTotal(db, c), c.goal) }, c));
      okJson(res, { count: rows.length, challenges: rows });
    } },

  { method: 'PUT', path: /^\/api\/challenges\/([A-Za-z0-9-]+)\/active$/, need: 'console', cap: 'challenges.manage', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const c = (db.challenges || []).find(x => String(x.id) === params[0]);
        if (!c) return errJson(res, 404, 'No such challenge.');
        c.active = !!(body && body.active);
        writeData(db);
        okJson(res, { challenge: c, changed: true });
      });
    } },


  /* ---- Phase 3C slice 4: the hidden door (see the note above DOOR_WORD) ---- */

  { method: 'POST', path: /^\/api\/door$/, need: null, handler: (req, res, body) => {
      const ip = getClientIp(req);
      const gone = () => errJson(res, 404, 'No such endpoint.');
      if (!DOOR_WORD) return gone();
      if (doorLocked(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      if (!doorWordOk(body && body.word) || !doorPwOk(body && body.password)) { doorMiss(ip); return gone(); }
      doorMisses.delete(ip);
      const token = doorMint();
      if (!token) return errJson(res, 429, 'Try again in a minute.');
      okJson(res, { ok: true, token });
    } },

  { method: 'GET', path: /^\/api\/door\/([a-f0-9]{48})\.js$/, need: null, handler: (req, res, body, sess, params) => {
      const ip = getClientIp(req);
      const gone = () => errJson(res, 404, 'No such endpoint.');
      if (!DOOR_WORD) return gone();
      if (doorLocked(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      if (!doorSpend(params[0])) { doorMiss(ip); return gone(); }
      fs.readFile(TUTOR_BUNDLE, (err, buf) => {
        if (err) return errJson(res, 404, 'No such endpoint.');
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Length': buf.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
      });
    } },

  /* ---- Phase 3C: tutor sign-in and the tutor's own account ---- */

  { method: 'POST', path: /^\/api\/tutor\/login$/, need: null, handler: async (req, res, body) => {
      const ip = getClientIp(req);
      if (tooManyAttempts(ip)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');
      const id = core.cleanTutorId(clean(body.id, 20));
      const password = String(body.password == null ? '' : body.password).slice(0, 300);
      if (id && tutorIdLocked(id)) return errJson(res, 429, 'Too many attempts. Wait a few minutes and try again.');

      const db = readData();
      let t = null;
      if (core.validTutorId(id)) {
        if (appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID) {
          t = await getAppwriteTutor(id);
        } else {
          t = db.tutors.find(x => x.id === id) || null;
        }
      }

      /* Keep identical failure responses and dummy-hash work for unknown,
         incorrect-password, and inactive tutor accounts. */
      if (!TUTOR_DUMMY_HASH) TUTOR_DUMMY_HASH = hashPassword('goc-tutor-dummy-' + crypto.randomBytes(8).toString('hex'));
      const pwOk = verifyPassword(password, t ? t.pwHash : TUTOR_DUMMY_HASH);
      if (!t || !pwOk || t.active === false) {
        noteFailure(ip);
        if (id) tutorIdFailed(id);
        return errJson(res, 401, 'That ID and password do not match.');
      }

      attempts.delete(ip);
      tutorFails.delete(id);

      t.lastLogin = new Date().toISOString();
      if (appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID) {
        await saveAppwriteTutor(t);
      } else {
        const local = db.tutors.find(x => x.id === t.id);
        if (local) local.lastLogin = t.lastLogin;
        else db.tutors.push(t);
        writeData(db);
      }

      if (!Array.isArray(db.tutors)) db.tutors = [];
      if (!db.tutors.some(x => x.id === t.id)) db.tutors.push(t);

      return newSession(t, 'tutor', db).then(token => {
        const d = sessions.get(token);
        okJson(res, { token, user: {
          id: t.id, name: t.name, role: 'tutor',
          subjects: t.subjects.slice(),
          mustChangePassword: !!t.mustChangePassword,
          sessionMinutes: d.sessionMinutes, expiresAt: d.expires
        } });
      });
    } },

  { method: 'GET', path: /^\/api\/tutor\/me$/, need: 'tutor-setup', handler: (req, res, body, sess) => {
      const t = sess.tutor;
      okJson(res, { tutor: tutorRow(t), subject: core.tutorSubjectFor(t, '').subject || null });
    } },

  { method: 'POST', path: /^\/api\/tutor\/password$/, need: 'tutor-setup', handler: async (req, res, body, sess) => {
      const current = String(body.currentPassword == null ? '' : body.currentPassword);
      const next = String(body.newPassword == null ? '' : body.newPassword);

      if (next.length < core.TUTOR_PASSWORD_MIN) return errJson(res, 400, 'Choose a password of at least ' + core.TUTOR_PASSWORD_MIN + ' characters.');
      if (next.length > 200) return errJson(res, 400, 'That password is too long.');
      if (next === current) return errJson(res, 400, 'Choose a different password from the one you have now.');

      const db = readData();
      const t = appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID
        ? await getAppwriteTutor(sess.tutor.id)
        : db.tutors.find(x => x.id === sess.tutor.id);

      if (!t) return errJson(res, 403, 'This tutor account is no longer available.');
      if (t.active === false) return errJson(res, 403, 'This tutor account is no longer available.');
      if (!verifyPassword(current, t.pwHash)) return errJson(res, 400, 'Your current password is not right.');

      t.pwHash = hashPassword(next);
      t.mustChangePassword = false;
      t.passwordChangedAt = new Date().toISOString();

      if (appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID) {
        await saveAppwriteTutor(t);
      } else {
        const local = db.tutors.find(x => x.id === t.id);
        if (!local) return errJson(res, 403, 'This tutor account is no longer available.');
        Object.assign(local, t);
        writeData(db);
      }

      sess.tutor.pwHash = t.pwHash;
      sess.tutor.mustChangePassword = false;
      okJson(res, { ok: true, mustChangePassword: false });
    } },

  /* The scope guard in use: a tutor reads only the subject they teach. */
  { method: 'GET', path: /^\/api\/tutor\/subject$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const questions = await listQuestions({ subject, all: true }, db);
      const mine = core.subjectDepth(questions, db.notes).find(r => r.subject === subject);
      /* Count all questions for this subject by status so the tutor sees pending/returned
         questions, not only approved 'live' ones (subjectDepth skips non-live rows). */
      const statusCounts = { live: 0, pending: 0, returned: 0, other: 0 };
      (db.questions || []).forEach(q => {
        if (!q || q.subject !== subject) return;
        if (q.addedBy !== sess.tutor.id) return;
        const s = q.status || 'live';
        if (s === 'live') statusCounts.live++;
        else if (s === 'pending') statusCounts.pending++;
        else if (s === 'returned') statusCounts.returned++;
        else statusCounts.other++;
      });
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), depth: mine, statusCounts });
    } },

  /* Slice 5, parts 2 and 3: the tutor dashboard's numbers for ONE subject. The subject goes
     through the same scope guard as every tutor route. The reply is counts, averages and
     questions only: never a student's name, ID, email or phone. `snapshot` comes from
     core.tutorSnapshot; `weakTopics` and `hardestQuestions` come from the per-question and
     per-topic counters (10+ answers to be ranked). */
  { method: 'GET', path: /^\/api\/tutor\/analytics$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const students = appwriteDatabases ? await listAppwriteStudents() : (db.students || []);
      const runsByStudent = {};
      students.forEach(st => {
        if (!st || !st.id) return;
        const runs = db.practiceRuns && db.practiceRuns[st.id];
        if (Array.isArray(runs)) runsByStudent[st.id] = core.dropOldRuns(runs);
      });
      const attempts = await listAttempts({ subject }, db);
      const snapshot = core.tutorSnapshot(subject, students, runsByStudent, attempts, Date.now());
      const mine = (db.answerStats && Object.prototype.hasOwnProperty.call(db.answerStats, subject)) ? db.answerStats[subject] : {};
      const bank = await listQuestions({ subject }, db);
      okJson(res, {
        subject, subjects: sess.tutor.subjects.slice(), snapshot,
        activity: core.tutorActivity(subject, students, runsByStudent, attempts, Date.now()),
        weakTopics: core.rankWeakTopics(mine),
        hardestQuestions: core.rankHardestQuestions(mine, subject, bank)
      });
    } },


  /* Admin console tutor analytics.
     Access requires an authenticated console session and the
     existing tutors.accounts capability. */
  {
    method: 'GET',
    path: /^\/api\/admin\/tutors\/analytics$/,
    need: 'console',
    cap: 'tutors.accounts',
    handler: async (req, res) => {
      const db = readData();
      const students = appwriteDatabases
        ? await listAppwriteStudents()
        : (db.students || []);

      const runsByStudent = {};
      students.forEach(st => {
        if (!st || !st.id) return;
        const runs = db.practiceRuns && db.practiceRuns[st.id];
        if (Array.isArray(runs)) {
          runsByStudent[st.id] = core.dropOldRuns(runs);
        }
      });

      const subjects = Array.from(new Set(
        (db.questions || [])
          .filter(q => q && q.subject)
          .map(q => q.subject)
      ));

      const reports = [];

      for (const subject of subjects) {
        const attempts = await listAttempts({ subject }, db);
        const snapshot = core.tutorSnapshot(
          subject, students, runsByStudent, attempts, Date.now()
        );

        const stats = db.answerStats &&
          Object.prototype.hasOwnProperty.call(db.answerStats, subject)
          ? db.answerStats[subject]
          : {};

        reports.push({
          subject,
          snapshot,
          activity: core.tutorActivity(
            subject, students, runsByStudent, attempts, Date.now()
          ),
          weakTopics: core.rankWeakTopics(stats)
        });
      }

      okJson(res, { reports });
    }
  },

  /* Phase 3C, at-risk list, slice 2: GET /api/tutor/atrisk?subject=[&sort=inactive|score]. The tutor's
     own subject only (same scope guard as every tutor route). GOC students taking the subject who have
     not practised or sat a test for 7 days, never started after 7 days, or average under 40% on marked
     Web Tests (core.tutorAtRisk), ordered by core.sortAtRisk (an unknown sort reads as 'inactive').
     Each row: Scholar ID, name, days inactive, never started, last score, average, papers, reasons.
     Never an email, phone, password hash or any other student detail. */
  { method: 'GET', path: /^\/api\/tutor\/atrisk$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const subject = tutorSubjectOr403(res, sess, q.get('subject'));
      if (!subject) return;
      const sort = q.get('sort') === 'score' ? 'score' : 'inactive';
      const db = readData();
      const students = appwriteDatabases ? await listAppwriteStudents() : (db.students || []);
      const runsByStudent = {};
      students.forEach(st => {
        if (!st || !st.id) return;
        const runs = db.practiceRuns && db.practiceRuns[st.id];
        if (Array.isArray(runs)) runsByStudent[st.id] = core.dropOldRuns(runs);
      });
      const attempts = await listAttempts({ subject }, db);
      const rows = core.sortAtRisk(core.tutorAtRisk(subject, students, runsByStudent, attempts, Date.now()), sort);
      okJson(res, {
        subject, subjects: sess.tutor.subjects.slice(), sort,
        limits: { inactiveDays: core.ATRISK_INACTIVE_DAYS, lowAverage: core.ATRISK_LOW_AVERAGE },
        count: rows.length, students: rows
      });
    } },

  /* Phase 3C, top performers, slice 2: GET /api/tutor/top?subject=. The tutor's own subject only (same scope
     guard as every tutor route). Two lists, never blended (core.tutorTopPerformers): Web Test average (2+ marked
     papers) and Practice percent right (20+ answers), highest first, every ranked student returned so the screen
     can show ten and offer Show all. Each row: Scholar ID, name and the figures; never an email, phone or hash.
     Practice runs are trimmed with core.dropOldRuns, as for the snapshot. */
  { method: 'GET', path: /^\/api\/tutor\/top$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const students = appwriteDatabases ? await listAppwriteStudents() : (db.students || []);
      const runsByStudent = {};
      students.forEach(st => {
        if (!st || !st.id) return;
        const runs = db.practiceRuns && db.practiceRuns[st.id];
        if (Array.isArray(runs)) runsByStudent[st.id] = core.dropOldRuns(runs);
      });
      const attempts = await listAttempts({ subject }, db);
      const top = core.tutorTopPerformers(subject, students, runsByStudent, attempts);
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), tests: top.tests, practice: top.practice });
    } },

  /* Phase 3C, student detail page, slice 2: GET /api/tutor/student?subject=&id=. The tutor's own subject only (same scope
     guard as every tutor route). Opens one GOC student who took that subject, even if switched off since (core.tutorMayOpenStudent);
     anyone else gets the same plain 404, so the route cannot be used to find out who exists. The page holds name, Scholar ID,
     and, for the open subject only, scores, practice figures, last ten attempts and weak topics
     (core.tutorStudentDetail); never a password hash, another subject's data, or (until Show contact) email and phone. EVERY successful open is written to the audit log in
     the same locked write, before anything is sent: if the log cannot be written the tutor gets an error and no student data. */
  { method: 'GET', path: /^\/api\/tutor\/student$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const subject = tutorSubjectOr403(res, sess, q.get('subject'));
      if (!subject) return;
      const sid = String(q.get('id') || '').trim();
      const gone = 'That student is not in your class.';
      if (!/^[A-Za-z0-9-]{1,40}$/.test(sid)) return errJson(res, 404, gone);
      return withDataLock(async () => {
        const db = readData();
        let student = null;
        try { student = appwriteDatabases ? await getAppwriteStudent(sid) : (db.students || []).find(s => s && s.id === sid); } catch (_) { student = null; }
        if (!core.tutorMayOpenStudent(subject, student)) return errJson(res, 404, gone);
        const runs = db.practiceRuns && Array.isArray(db.practiceRuns[sid]) ? core.dropOldRuns(db.practiceRuns[sid]) : [];
        const attempts = await attemptsFor(db, sid);
        const now = Date.now();
        const detail = core.tutorStudentDetail(subject, student, runs, Array.isArray(attempts) ? attempts : [], now);
        if (!detail) return errJson(res, 404, gone);
        const entry = core.makeTutorViewEntry(sess.tutor, student, subject, now);
        db.settings.auditSeq = (db.settings.auditSeq || 0) + 1;
        entry.id = 'AU-' + db.settings.auditSeq;
        db.tutorAudit = core.addTutorView(db.tutorAudit, entry, now);
        try { writeData(db); } catch (e) { console.error('[goc] Audit log not written:', e.message); return errJson(res, 500, 'The student page could not be opened right now.'); }
        okJson(res, { subject, subjects: sess.tutor.subjects.slice(), student: detail });
      });
    } },

  /* Email and phone, only on request ("Show contact"). Same scope guard, same plain 404 and the same openable rule as the page;
     every successful call is its own audit entry ('contact-view'), written before anything is sent. */
  { method: 'GET', path: /^\/api\/tutor\/student\/contact$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const subject = tutorSubjectOr403(res, sess, q.get('subject'));
      if (!subject) return;
      const sid = String(q.get('id') || '').trim();
      const gone = 'That student is not in your class.';
      if (!/^[A-Za-z0-9-]{1,40}$/.test(sid)) return errJson(res, 404, gone);
      return withDataLock(async () => {
        const db = readData();
        let student = null;
        try { student = appwriteDatabases ? await getAppwriteStudent(sid) : (db.students || []).find(s => s && s.id === sid); } catch (_) { student = null; }
        const contact = core.tutorStudentContact(subject, student);
        if (!contact) return errJson(res, 404, gone);
        const now = Date.now();
        const entry = core.makeTutorViewEntry(sess.tutor, student, subject, now, 'contact-view');
        db.settings.auditSeq = (db.settings.auditSeq || 0) + 1;
        entry.id = 'AU-' + db.settings.auditSeq;
        db.tutorAudit = core.addTutorView(db.tutorAudit, entry, now);
        try { writeData(db); } catch (e) { console.error('[goc] Audit log not written:', e.message); return errJson(res, 500, 'The contact details could not be shown right now.'); }
        okJson(res, { subject, contact });
      });
    } },

  /* A tutor reads ONLY their own entries (the tutor record comes from the session, never from the request). */
  { method: 'GET', path: /^\/api\/tutor\/audit$/, need: 'tutor', handler: (req, res, body, sess) => {
      const mine = core.tutorOwnViews(readData().tutorAudit, sess.tutor.id);
      okJson(res, { keptDays: core.AUDIT_KEEP_DAYS, count: mine.length, entries: mine });
    } },

  /* Management (Founder and Academic Director, via the console gate) reads every entry, optionally narrowed with
     ?tutorId=, ?studentId=, ?kind=tutor-view|contact-view, ?from= and ?to= (Nigeria days, YYYY-MM-DD). */
  /* Roles slice (c), step 7: read the manager log. The Founder (and the two seeded accounts) read all of it;
     any other manager reads only their own entries (core.managerLogFor decides, from the session, never the request). */
  { method: 'GET', path: /^\/api\/audit\/manager-actions$/, need: 'console', cap: 'overview.own', handler: (req, res, body, sess) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const entries = core.managerLogFor(readData().managerLog, sess.data.id, sess.data.roleKey,
        { by: q.get('by'), action: q.get('action'), from: q.get('from'), to: q.get('to'), limit: q.get('limit') });
      okJson(res, { count: entries.length, keep: core.MANAGER_LOG_KEEP, entries });
    } },

  { method: 'GET', path: /^\/api\/audit\/tutor-views$/, need: 'console', cap: 'tutors.audit', handler: (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const rows = core.auditViews(readData().tutorAudit, { tutorId: q.get('tutorId'), studentId: q.get('studentId'), kind: q.get('kind'), from: q.get('from'), to: q.get('to') });
      okJson(res, { keptDays: core.AUDIT_KEEP_DAYS, count: rows.length, entries: rows });
    } },

  /* ---- Phase 3C: the console's Tutors panel (Founder and Academic Director) ---- */

  /* ---- Phase 3C slice 6, part 2: tutor questions. Every route here is for the tutor's OWN
     questions in the tutor's OWN subjects, checked against the tutor record read on this
     request. Whatever a tutor types or imports is saved as Awaiting approval; nothing a tutor
     sends can set a status, an author or a review mark (core.stampTutorQuestion and
     core.tutorEditQuestion overwrite them). Students never see a question until the admin
     approves it (listQuestions serves live questions only). */
  { method: 'GET', path: /^\/api\/tutor\/questions$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const mine = core.tutorQuestions(await listQuestions({ subject, all: true }, db), sess.tutor);
      const counts = { live: 0, pending: 0, returned: 0 };
      mine.forEach(q => { counts[core.questionStatus(q)] += 1; });
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), counts, questions: mine });
    } },

  { method: 'POST', path: /^\/api\/tutor\/questions$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, body && body.subject);
      if (!subject) return;
      const v = core.validateQuestion(Object.assign({}, body, { subject }));
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      const pl = core.passageLinkError(v.rec, db.passages);
      if (pl) return errJson(res, 400, pl);
      const il = imageLinkError(v.rec);
      if (il) return errJson(res, 400, il);
      const st = core.stampTutorQuestion(v.rec, sess.tutor, {}, Date.now());
      if (st.error) return errJson(res, 403, st.error);
      db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
      st.rec.id = db.settings.questionSeq;
      await createQuestion(st.rec, db);
      writeData(db);
      okJson(res, { question: st.rec, created: true });
    } },

  /* Bulk import: the same CSV reader and checks as the console, fixed to the tutor's subject,
     every kept row saved as Awaiting approval under one batch id so the admin can approve the
     whole import at once. */
  { method: 'POST', path: /^\/api\/tutor\/questions\/import$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, body && body.subject);
      if (!subject) return;
      const csvText = body && body.csv;
      const filename = body && body.filename ? String(body.filename).slice(0, 200) : null;
      const section = body && body.section ? String(body.section).trim().toLowerCase() : '';
      const stampSection = !!(body && body.stampSection);
      const target = { subject, section, stampSection };
      /* Pre-validate outside the lock so a bad CSV fails fast without holding it. */
      const preParse = core.importCSV('questions', csvText, target, await listQuestions({ all: true }, readData()), readData().passages);
      if (preParse.error) return errJson(res, 400, preParse.error);
      return withDataLock(async () => {
        const db = readData();
        const existing = await listQuestions({ all: true }, db);
        /* Re-run inside the lock against the freshest snapshot. */
        const r = core.importCSV('questions', csvText, target, existing, db.passages);
        if (r.error) return errJson(res, 400, r.error);
        const batch = 'IMP-' + Date.now().toString(36).toUpperCase();
        const ids = [], errors = r.errors.slice();
        const now = Date.now();
        for (const rec of r.records) {
          const st = core.stampTutorQuestion(rec, sess.tutor, { batch }, now);
          if (st.error) { errors.push(st.error); continue; }
          /* Leave status as 'pending' so imported questions sit in the approval
             queue just like individually submitted tutor questions. The admin
             approves the whole batch in one go via POST /api/approvals/batch/approve. */
          db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
          st.rec.id = db.settings.questionSeq;
          /* createQuestion pushes the record into db.questions before writeData
             persists it, so every question is safely in-memory first. */
          await createQuestion(st.rec, db);
          ids.push(st.rec.id);
          writeData(db);
        }
        logImport(db, { kind: 'questions', filename, fingerprint: core.csvFingerprint(csvText),
                        target: subject + '/' + (section || 'any') + (stampSection ? ' (stamped)' : ''),
                        read: r.read, added: ids.length, skipped: errors.length, by: sess.tutor.id });
        writeData(db);
        okJson(res, { read: r.read, added: ids.length, ids, skipped: errors.length, errors, batch, status: ids.length ? 'pending' : '' });
      });
    } },

  { method: 'PUT', path: /^\/api\/tutor\/questions\/(\d+)$/, need: 'tutor', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur || !core.tutorOwnsQuestion(sess.tutor, cur)) return errJson(res, 404, 'That question is not one of yours.');
      const v = core.validateQuestion(Object.assign({}, cur, body, { id: cur.id }));
      if (v.error) return errJson(res, 400, v.error);
      const pl = core.passageLinkError(v.rec, db.passages);
      if (pl) return errJson(res, 400, pl);
      const il = imageLinkError(v.rec);
      if (il) return errJson(res, 400, il);
      const ed = core.tutorEditQuestion(sess.tutor, cur, v.rec, Date.now());
      if (ed.error) return errJson(res, 403, ed.error);
      ed.rec.id = cur.id;
      await updateQuestion(cur.id, approvalPatch(ed.rec), db);
      writeData(db);
      okJson(res, { question: ed.rec, changed: true });
    } },

  /* Withdraw (hide) or republish one's own APPROVED question. This only flips the question's
     on/off switch: it can never make an unapproved question live. */
  { method: 'PUT', path: /^\/api\/tutor\/questions\/(\d+)\/active$/, need: 'tutor', handler: async (req, res, body, sess, params) => {
      if (typeof body.active !== 'boolean') return errJson(res, 400, 'Say whether the question is on or off.');
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur || !core.tutorOwnsQuestion(sess.tutor, cur)) return errJson(res, 404, 'That question is not one of yours.');
      if (!core.questionIsLive(cur)) return errJson(res, 400, 'Only an approved question can be withdrawn or republished.');
      await updateQuestion(cur.id, { active: body.active }, db);
      writeData(db);
      okJson(res, { question: Object.assign({}, cur, { active: body.active }), changed: true });
    } },

  /* Delete one's own question once it is not showing to students: awaiting approval, returned,
     or withdrawn. (Same rule as the console: switch it off first.) */
  { method: 'DELETE', path: /^\/api\/tutor\/questions\/(\d+)$/, need: 'tutor', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (!core.tutorOwnsQuestion(sess.tutor, cur)) return errJson(res, 404, 'That question is not one of yours.');
      if (core.questionIsLive(cur) && cur.active !== false) return errJson(res, 400, 'Withdraw this question before deleting it.');
      await deleteQuestion(cur.id, db);
      writeData(db);
      okJson(res, { ok: true, deleted: cur.id });
    } },

  /* ---- Tutor notes (slice 6.5). A tutor's note is live at once (owner decision), stamped with the
     tutor and the time. Own subject and own notes only. ---- */
  { method: 'GET', path: /^\/api\/tutor\/notes$/, need: 'tutor', handler: (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const mine = core.tutorNotes(db.notes.filter(n => n.subject === subject), sess.tutor);
      const counts = { live: 0, held: 0 };
      mine.forEach(n => { counts[n.active ? 'live' : 'held'] += 1; });
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), counts, notes: mine });
    } },

  { method: 'POST', path: /^\/api\/tutor\/notes$/, need: 'tutor', handler: (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, body && body.subject);
      if (!subject) return;
      const v = core.validateNote(Object.assign({}, body, { subject }));
      if (v.error) return errJson(res, 400, v.error);
      const st = core.stampTutorNote(v.rec, sess.tutor, Date.now());
      if (st.error) return errJson(res, 403, st.error);
      const db = readData();
      db.settings.noteSeq = (db.settings.noteSeq || 0) + 1;
      st.rec.id = db.settings.noteSeq;
      db.notes.push(st.rec);
      writeData(db);
      okJson(res, { note: st.rec, created: true });
    } },

  { method: 'PUT', path: /^\/api\/tutor\/notes\/(\d+)$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur || !core.tutorOwnsNote(sess.tutor, cur)) return errJson(res, 404, 'That note is not one of yours.');
      const v = core.validateNote(Object.assign({}, cur, body, { subject: body && body.subject ? body.subject : cur.subject }));
      if (v.error) return errJson(res, 400, v.error);
      const ed = core.tutorEditNote(sess.tutor, cur, v.rec, Date.now());
      if (ed.error) return errJson(res, 403, ed.error);
      db.notes[db.notes.indexOf(cur)] = ed.rec;
      writeData(db);
      okJson(res, { note: ed.rec, changed: true });
    } },

  /* Hold back / put back: the same switch the console has. */
  { method: 'PUT', path: /^\/api\/tutor\/notes\/(\d+)\/active$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur || !core.tutorOwnsNote(sess.tutor, cur)) return errJson(res, 404, 'That note is not one of yours.');
      if (!body || typeof body.active !== 'boolean') return errJson(res, 400, 'Say whether the note is live or held back.');
      cur.active = body.active;
      cur.editedAt = new Date().toISOString();
      writeData(db);
      okJson(res, { note: cur });
    } },

  /* Same rule as the console: hold a live note back before deleting it. */
  { method: 'DELETE', path: /^\/api\/tutor\/notes\/(\d+)$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (!core.tutorOwnsNote(sess.tutor, cur)) return errJson(res, 404, 'That note is not one of yours.');
      if (cur.active) return errJson(res, 400, 'Hold this note back before deleting it.');
      db.notes.splice(db.notes.indexOf(cur), 1);
      writeData(db);
      okJson(res, { ok: true, deleted: cur.id });
    } },

  /* ---- Class notices (slice 7). A tutor posts for one of their subjects; it is live at once and stays
     until the tutor removes it. The admin gets an alert for a NEW notice only; an edit is quiet. ---- */
  { method: 'GET', path: /^\/api\/tutor\/notices$/, need: 'tutor', handler: (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, new URL(req.url, 'http://x').searchParams.get('subject'));
      if (!subject) return;
      const db = readData();
      const mine = core.tutorNotices(db.notices.filter(n => n.subject === subject), sess.tutor);
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), count: mine.length, notices: mine });
    } },

  { method: 'POST', path: /^\/api\/tutor\/notices$/, need: 'tutor', handler: (req, res, body, sess) => {
      const subject = tutorSubjectOr403(res, sess, body && body.subject);
      if (!subject) return;
      const v = core.validateNotice(Object.assign({}, body, { subject }));
      if (v.error) return errJson(res, 400, v.error);
      const st = core.stampTutorNotice(v.rec, sess.tutor, Date.now());
      if (st.error) return errJson(res, 403, st.error);
      return withDataLock(async () => {
        const db = readData();
        db.settings.noticeSeq = (db.settings.noticeSeq || 0) + 1;
        st.rec.id = db.settings.noticeSeq;
        db.notices.push(st.rec);
        db.settings.alertSeq = (db.settings.alertSeq || 0) + 1;
        const al = core.makeNoticeAlert(sess.tutor, st.rec, Date.now());
        al.id = 'AL-' + db.settings.alertSeq;
        db.alerts = core.addAlert(db.alerts, al);
        writeData(db);
        okJson(res, { notice: st.rec, created: true, alerted: true });
      });
    } },

  { method: 'PUT', path: /^\/api\/tutor\/notices\/(\d+)$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.notices.find(n => String(n.id) === params[0]);
        if (!cur || !core.tutorOwnsNotice(sess.tutor, cur)) return errJson(res, 404, 'That notice is not one of yours.');
        const v = core.validateNotice(Object.assign({}, cur, body, { subject: body && body.subject ? body.subject : cur.subject }));
        if (v.error) return errJson(res, 400, v.error);
        const ed = core.tutorEditNotice(sess.tutor, cur, v.rec, Date.now());
        if (ed.error) return errJson(res, 403, ed.error);
        db.notices[db.notices.indexOf(cur)] = ed.rec;
        writeData(db);               /* an edit raises no alert */
        okJson(res, { notice: ed.rec, changed: true });
      });
    } },

  /* Removing is deleting: a notice stays until its tutor removes it. */
  { method: 'DELETE', path: /^\/api\/tutor\/notices\/(\d+)$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.notices.find(n => String(n.id) === params[0]);
        if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
        if (!core.tutorOwnsNotice(sess.tutor, cur)) return errJson(res, 404, 'That notice is not one of yours.');
        db.notices.splice(db.notices.indexOf(cur), 1);
        db.alerts = core.flagNoticeGone(db.alerts, cur.id);
        writeData(db);
        okJson(res, { ok: true, deleted: cur.id });
      });
    } },

  /* The admin sees every notice and may remove any. */
  { method: 'GET', path: /^\/api\/notices$/, need: 'console', cap: 'notices.manage', handler: (req, res) => {
      const subject = new URL(req.url, 'http://x').searchParams.get('subject') || '';
      const rows = readData().notices.filter(n => !subject || n.subject === subject)
        .slice().sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
      okJson(res, { count: rows.length, notices: rows });
    } },

  { method: 'DELETE', path: /^\/api\/notices\/(\d+)$/, need: 'console', cap: 'notices.manage', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.notices.find(n => String(n.id) === params[0]);
        if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
        db.notices.splice(db.notices.indexOf(cur), 1);
        db.alerts = core.flagNoticeGone(db.alerts, cur.id);
        writeData(db);
        okJson(res, { ok: true, deleted: cur.id });
      });
    } },

  /* ---- Ask a tutor (Phase 4.A, slice 3): the tutor and console side. A tutor acts only on their own
     subjects (core enforces it too); the console acts on any. A reply or a close raises no alert. ---- */
  { method: 'GET', path: /^\/api\/tutor\/flags$/, need: 'tutor', handler: (req, res, body, sess) => {
      const subject = new URL(req.url, 'http://x').searchParams.get('subject') || '';
      const status = new URL(req.url, 'http://x').searchParams.get('status') || '';
      if (subject && !core.tutorCan(sess.tutor, subject)) return errJson(res, 403, 'That subject is not one of yours.');
      const db = readData();
      const flags = core.flagsForTutor(db.flags, sess.tutor, { subject, status });
      okJson(res, { subjects: sess.tutor.subjects.slice(), count: flags.length, flags });
    } },

  { method: 'POST', path: /^\/api\/tutor\/flags\/([A-Za-z0-9-]+)\/(reply|close)$/, need: 'tutor', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.flags.find(f => String(f.id) === params[0]);
        if (!cur || !core.tutorCan(sess.tutor, cur.subject)) return errJson(res, 404, 'That question is not one of yours.');
        const actor = { role: 'tutor', tutor: sess.tutor };
        const r = params[1] === 'reply'
          ? core.answerFlag(cur, actor, body && body.text, Date.now())
          : core.closeFlag(cur, actor, Date.now());
        if (r.error) return errJson(res, 400, r.error);
        db.flags[db.flags.indexOf(cur)] = r.rec;
        writeData(db);
        okJson(res, { flag: core.staffFlag(r.rec), ok: true });
      });
    } },

  /* The console sees every flag and may reply to or close any. */
  { method: 'GET', path: /^\/api\/flags$/, need: 'console', cap: 'approvals.review', handler: (req, res) => {
      const subject = new URL(req.url, 'http://x').searchParams.get('subject') || '';
      const status = new URL(req.url, 'http://x').searchParams.get('status') || '';
      const db = readData();
      const flags = core.flagsForConsole(db.flags, { subject, status });
      okJson(res, { count: flags.length, counts: core.flagCounts(db.flags), flags });
    } },

  { method: 'POST', path: /^\/api\/flags\/([A-Za-z0-9-]+)\/(reply|close)$/, need: 'console', cap: 'approvals.review', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.flags.find(f => String(f.id) === params[0]);
        if (!cur) return errJson(res, 404, 'No such question.');
        const actor = { role: 'console', name: sess.data.name || sess.data.id };
        const r = params[1] === 'reply'
          ? core.answerFlag(cur, actor, body && body.text, Date.now())
          : core.closeFlag(cur, actor, Date.now());
        if (r.error) return errJson(res, 400, r.error);
        db.flags[db.flags.indexOf(cur)] = r.rec;
        writeData(db);
        okJson(res, { flag: core.staffFlag(r.rec), ok: true });
      });
    } },

  /* ---- Targeted broadcast (Phase 4 slice 2). The console sends to all GOC students or one subject's GOC
     students; a student reads it as a notice card. The recipient count is worked out from the roster at send
     time and stored, so the console can show who it reached. The reminder email goes out later, from the same sweep as study
     reminders (lib/reminders.js broadcastSweep), never from this request. ---- */
  { method: 'POST', path: /^\/api\/broadcasts$/, need: 'console', cap: 'broadcast.send', handler: async (req, res, body, sess) => {
      const v = core.validateBroadcast(body);
      if (v.error) return errJson(res, 400, v.error);
      const st = core.stampBroadcast(v.rec, sess.data.name || sess.data.id, Date.now());
      if (st.error) return errJson(res, 400, st.error);
      const students = appwriteDatabases ? await listAppwriteStudents() : readData().students;
      const reached = core.broadcastRecipients(st.rec.audience, students).length;
      return withDataLock(async () => {
        const db = readData();
        db.settings.broadcastSeq = (db.settings.broadcastSeq || 0) + 1;
        st.rec.id = db.settings.broadcastSeq;
        st.rec.reached = reached;
        db.broadcasts.push(st.rec);
        writeData(db);
        okJson(res, { broadcast: Object.assign({ audienceLabel: core.audienceLabel(st.rec.audience) }, st.rec), created: true });
      });
    } },

  /* How many students a message would reach, before it is sent. */
  { method: 'GET', path: /^\/api\/broadcasts\/audience$/, need: 'console', cap: 'broadcast.send', handler: async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const audience = core.cleanAudience({ kind: q.get('kind'), subject: q.get('subject') });
      if (!audience) return errJson(res, 400, 'Choose who it goes to: all GOC students, or one subject’s students.');
      const students = appwriteDatabases ? await listAppwriteStudents() : readData().students;
      okJson(res, { audience, label: core.audienceLabel(audience), reached: core.broadcastRecipients(audience, students).length });
    } },

  { method: 'GET', path: /^\/api\/broadcasts$/, need: 'console', cap: 'broadcast.send', handler: (req, res) => {
      const rows = readData().broadcasts.slice()
        .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')) || (Number(b.id) || 0) - (Number(a.id) || 0))
        .map(b => Object.assign({ audienceLabel: core.audienceLabel(b.audience),
          emailed: Object.keys(((readData().broadcastMail || {})[b.id] || {}).sent || {}).length }, b));
      okJson(res, { count: rows.length, broadcasts: rows });
    } },

  { method: 'DELETE', path: /^\/api\/broadcasts\/(\d+)$/, need: 'console', cap: 'broadcast.send', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const cur = db.broadcasts.find(b => String(b.id) === params[0]);
        if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
        db.broadcasts.splice(db.broadcasts.indexOf(cur), 1);
        if (db.broadcastMail) delete db.broadcastMail[cur.id];
        writeData(db);
        okJson(res, { ok: true, deleted: cur.id });
      });
    } },

  /* ---- Tutor theory marking (slice 6.6). No approval: a mark counts when it is saved. Any theory
     script in a subject the tutor teaches; the subject comes from the script, never from the request.
     A save that leaves the script fully marked raises an alert on the console home. ---- */
  { method: 'GET', path: /^\/api\/tutor\/scripts$/, need: 'tutor', handler: async (req, res, body, sess) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const subject = tutorSubjectOr403(res, sess, q.get('subject'));
      if (!subject) return;
      const status = q.get('status') || '';
      if (status && status !== 'awaiting-marking' && status !== 'marked') return errJson(res, 400, 'Ask for awaiting-marking or marked scripts.');
      const db = readData();
      const rows = (await listAttempts({ subject, section: 'theory' }, db)).slice().sort((a, b) => b.submittedAt - a.submittedAt);
      const counts = { waiting: 0, marked: 0 };
      rows.forEach(a => { counts[a.status === 'marked' ? 'marked' : 'waiting'] += 1; });
      const shown = status ? rows.filter(a => a.status === status) : rows;
      okJson(res, { subject, subjects: sess.tutor.subjects.slice(), counts, scripts: shown.map(core.tutorScriptSummary) });
    } },

  { method: 'GET', path: /^\/api\/tutor\/scripts\/([A-Za-z0-9-]+)$/, need: 'tutor', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const a = await getAttemptById(params[0], db);
      if (!a || a.section !== 'theory') return errJson(res, 404, 'That script no longer exists.');
      const may = core.tutorMayMarkScript(sess.tutor, a);
      if (may.error) return errJson(res, 403, may.error);
      const out = core.tutorScriptSummary(a);
      out.markedBy = a.markedBy || null;
      const theory = a.answers.filter(r => r.kind === 'theory');
      const qs = await Promise.all(theory.map(r => findQ(db, r.questionId)));
      out.answers = theory.map((r, i) => {
        const q = qs[i] || {};
        return { questionId: r.questionId, topic: r.topic, text: q.text || '', expected: q.expected || '',
          given: r.given, markAwarded: r.markAwarded, maxMark: r.maxMark };
      });
      okJson(res, out);
    } },

  { method: 'POST', path: /^\/api\/tutor\/scripts\/([A-Za-z0-9-]+)\/mark$/, need: 'tutor', handler: async (req, res, body, sess, params) => {
      const marker = { id: sess.tutor.id, tutor: sess.tutor };
      const result = await markTheoryScript(params[0], body && body.marks, marker, a => {
        const may = core.tutorMayMarkScript(sess.tutor, a);
        return may.error ? [403, may.error] : null;
      });
      if (result.error) return errJson(res, result.error[0], result.error[1]);
      const out = core.tutorScriptSummary(result.a);
      out.alerted = result.alerted;
      okJson(res, out);
    } },

  /* ---- Alerts on the console home. Unseen ones only; the admin taps Seen. ---- */
  /* Roles slice (c), step 6: each manager sees only the alerts that belong to their role (core.alertsFor);
     the Founder and the two seeded accounts see all of them. */
  { method: 'GET', path: /^\/api\/alerts$/, need: 'console', cap: 'overview.own', handler: (req, res, body, sess) => {
      const list = core.unseenAlerts(core.alertsFor(readData().alerts, sess.data.id, sess.data.roleKey));
      okJson(res, { count: list.length, alerts: list });
    } },

  { method: 'POST', path: /^\/api\/alerts\/([A-Za-z0-9-]+)\/seen$/, need: 'console', cap: 'overview.own', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        /* an alert that is not this role's is answered exactly like one that does not exist */
        const mine = core.alertsFor(db.alerts, sess.data.id, sess.data.roleKey).some(a => String(a.id) === String(params[0]));
        const r = mine ? core.markAlertSeen(db.alerts, params[0], sess.data.id, Date.now()) : { error: 'That alert no longer exists.' };
        if (r.error) return errJson(res, 404, r.error);
        db.alerts = r.list;
        writeData(db);
        okJson(res, { ok: true, count: core.unseenAlerts(core.alertsFor(db.alerts, sess.data.id, sess.data.roleKey)).length });
      });
    } },

  /* ---- The admin side of the same rules (the console screen for these is the next part). ---- */
  { method: 'GET', path: /^\/api\/approvals$/, need: 'console', cap: 'approvals.review', handler: async (req, res) => {
      const db = readData();
      const subject = new URL(req.url, 'http://x').searchParams.get('subject') || '';
      const queue = core.approvalQueue(await listQuestions({ all: true }, db), subject);
      okJson(res, { count: queue.length, queue });
    } },

  { method: 'POST', path: /^\/api\/approvals\/batch\/approve$/, need: 'console', cap: 'approvals.review', handler: async (req, res, body, sess) => {
      const db = readData();
      const r = core.approveBatch(await listQuestions({ all: true }, db), body && body.batch, reviewerOf(sess), Date.now());
      if (r.error) return errJson(res, 400, r.error);
      for (const rec of r.recs) await updateQuestion(rec.id, approvalPatch(rec), db);
      writeData(db);
      okJson(res, { approved: r.recs.length, skipped: r.skipped });
    } },

  { method: 'POST', path: /^\/api\/approvals\/(\d+)\/(approve|return)$/, need: 'console', cap: 'approvals.review', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur) return errJson(res, 404, 'That question no longer exists.');
      /* "Edit then approve": the admin's changes go through the console's own validator, the
         author and review marks stay exactly as the tutor left them, then the rules approve it. */
      let target = cur, edited = false;
      if (params[1] === 'approve' && body && body.edit && typeof body.edit === 'object') {
        const v = core.validateQuestion(Object.assign({}, cur, body.edit));
        if (v.error) return errJson(res, 400, v.error);
        const pl = core.passageLinkError(v.rec, db.passages);
        if (pl) return errJson(res, 400, pl);
        const il = imageLinkError(v.rec);
        if (il) return errJson(res, 400, il);
        target = Object.assign({}, cur, v.rec, { id: cur.id });
        APPROVAL_KEYS.forEach(k => { if (cur[k] !== undefined) target[k] = cur[k]; else delete target[k]; });
        edited = true;
      }
      const r = core.reviewQuestion(target, params[1], reviewerOf(sess), body && body.reason, Date.now());
      if (r.error) return errJson(res, 400, r.error);
      await updateQuestion(cur.id, approvalPatch(r.rec), db);
      writeData(db);
      okJson(res, { question: r.rec, decision: params[1], edited });
    } },

  {
    method: 'GET',
    path: /^\/api\/tutors$/,
    need: 'console',
    cap: 'tutors.accounts',
    handler: async (req, res) => {
      const tutors = appwriteDatabases
        ? await listAppwriteTutors()
        : (readData().tutors || []);
      okJson(res, { tutors: tutors.map(tutorRow) });
    }
  },
  {
    method: 'POST',
    path: /^\/api\/tutors$/,
    need: 'console',
    cap: 'tutors.accounts',
    handler: async (req, res, body, sess) => {
      const v = core.validateTutor(body, { needPassword: true });
      if (v.error) return errJson(res, 400, v.error);

      const db = readData();
      const existingTutors = appwriteDatabases
        ? await listAppwriteTutors()
        : (db.tutors || []);

      let id = v.rec.id;
      if (id && existingTutors.some(t => t.id === id)) {
        return errJson(res, 409, id + ' is already in use.');
      }
      if (!id) id = core.nextTutorId(existingTutors.map(t => t.id));

      const rec = {
        id,
        name: v.rec.name,
        subjects: v.rec.subjects,
        active: true,
        pwHash: hashPassword(v.rec.password),
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        createdBy: sess.data.name || sess.data.id,
        lastLogin: null
      };

      if (appwriteDatabases) {
        await saveAppwriteTutor(rec);
      } else {
        db.tutors.push(rec);
        writeData(db);
      }

      okJson(res, { tutor: tutorRow(rec), created: true });
    }
  },
  { method: 'PUT', path: /^\/api\/tutors\/(GOC-T-\d+)$/i, need: 'console', cap: 'tutors.accounts', handler: async (req, res, body, sess, params) => {
      const v = core.validateTutor({ name: body.name, subjects: body.subjects }, { needPassword: false });
      if (v.error) return errJson(res, 400, v.error);

      const db = readData();
      const id = core.cleanTutorId(params[0]);
      const useAppwrite = !!(appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID);
      const t = useAppwrite ? await getAppwriteTutor(id) : db.tutors.find(x => x.id === id);

      if (!t) return errJson(res, 404, 'That Tutor ID does not exist.');
      t.name = v.rec.name;
      t.subjects = v.rec.subjects;
      t.editedAt = new Date().toISOString();
      t.editedBy = sess.data.name || sess.data.id;

      if (useAppwrite) {
        await saveAppwriteTutor(t);
      } else {
        writeData(db);
      }

      okJson(res, { tutor: tutorRow(t), changed: true });
    } },

  { method: 'PUT', path: /^\/api\/tutors\/(GOC-T-\d+)\/password$/i, need: 'console', cap: 'tutors.accounts', handler: async (req, res, body, sess, params) => {
      const pw = String(body.password == null ? '' : body.password);
      if (pw.length < core.TUTOR_PASSWORD_MIN) return errJson(res, 400, 'Choose a starting password of at least ' + core.TUTOR_PASSWORD_MIN + ' characters.');
      if (pw.length > 200) return errJson(res, 400, 'That password is too long.');

      const db = readData();
      const id = core.cleanTutorId(params[0]);
      const useAppwrite = !!(appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID);
      const t = useAppwrite ? await getAppwriteTutor(id) : db.tutors.find(x => x.id === id);

      if (!t) return errJson(res, 404, 'That Tutor ID does not exist.');
      t.pwHash = hashPassword(pw);
      t.mustChangePassword = true;
      t.passwordResetAt = new Date().toISOString();
      t.passwordResetBy = sess.data.name || sess.data.id;

      if (useAppwrite) {
        await saveAppwriteTutor(t);
      } else {
        writeData(db);
      }

      dropTutorSessions(t.id);
      tutorFails.delete(t.id);
      okJson(res, { tutor: tutorRow(t), reset: true });
    } },

  { method: 'PUT', path: /^\/api\/tutors\/(GOC-T-\d+)\/active$/i, need: 'console', cap: 'tutors.accounts', handler: async (req, res, body, sess, params) => {
      if (typeof body.active !== 'boolean') return errJson(res, 400, 'Say whether the tutor is on or off.');

      const db = readData();
      const id = core.cleanTutorId(params[0]);
      const useAppwrite = !!(appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID);
      const t = useAppwrite ? await getAppwriteTutor(id) : db.tutors.find(x => x.id === id);

      if (!t) return errJson(res, 404, 'That Tutor ID does not exist.');
      t.active = body.active;
      t.activeChangedAt = new Date().toISOString();
      t.activeChangedBy = sess.data.name || sess.data.id;

      if (useAppwrite) {
        await saveAppwriteTutor(t);
      } else {
        writeData(db);
      }

      if (!t.active) dropTutorSessions(t.id);
      okJson(res, { tutor: tutorRow(t), changed: true });
    } },

  /* Subjects & tutors: who teaches each subject and how deep each paper is. */
  { method: 'GET', path: /^\/api\/tutors\/overview$/, need: 'console', cap: 'tutors.accounts', handler: (req, res) => {
      const db = readData();
      const rows = core.subjectDepth(db.questions, db.notes).map(r => {
        r.tutors = db.tutors.filter(t => t.active !== false && t.subjects.indexOf(r.subject) > -1)
                            .map(t => ({ id: t.id, name: t.name }));
        r.pending = core.approvalQueue(db.questions, r.subject).length;
        r.lastUpload = core.lastTutorUpload(db.questions, r.subject);
        return r;
      });
      okJson(res, { subjects: rows, minimums: core.SUBJECT_DEPTH_MIN });
    } },

  /* Roles slice (c), step 2a: the Managers panel's server half, list and create only.
     A manager is a staff record (GOC-A-003 up) whose title is the role's full title, so the
     session already derives the role key from it. The password and the console passcode are
     stored as hashes, never in plain text and never sent back. A manager cannot sign in yet:
     staff sign-in still reads only the two environment passwords, and the own-passcode unlock
     and the forced password change come in the next steps. */
  { method: 'GET', path: /^\/api\/managers$/, need: 'console', cap: 'managers.accounts', handler: (req, res) => {
      const db = readData();
      const rows = (db.staff || []).filter(x => x.id !== 'GOC-A-001' && x.id !== 'GOC-A-002' && core.adminRoleKey(x.title))
                     .map(x => core.publicManager(x));
      okJson(res, { managers: rows, roles: core.managerRoles() });
    } },

  { method: 'POST', path: /^\/api\/managers$/, need: 'console', cap: 'managers.accounts', handler: (req, res, body, sess) => {
      return withDataLock(async () => {
        const v = core.validateManager(body || {}, { creating: true });
        if (v.error) return errJson(res, 400, v.error);

        const pw = v.rec.password;
        if (!/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) return errJson(res, 400, 'Use both letters and numbers in a management password.');
        const db = readData();
        const id = core.nextManagerId((db.staff || []).map(x => x.id), db.settings.managerIdHigh || null);
        if (!appwriteUsers && isProductionRun()) {
          return errJson(res, 503, 'Appwrite Auth is unavailable. No manager account was created.');
        }

        let authUserId = null;
        if (appwriteUsers) {
          try {
            const authUser = await createAppwriteAuthUser({ id, name: v.rec.name, plainPassword: pw });
            authUserId = authUser.$id;
          } catch (err) {
            console.error('[goc] Appwrite manager account creation failed for', id, err.message);
            return errJson(res, 503, 'The manager account could not be created in Appwrite. Please try again.');
          }
        }

        const rec = {
          id, name: v.rec.name, title: v.rec.title,
          appwriteUserId: authUserId,
          pwHash: hashPassword(pw), passcodeHash: hashPassword(v.rec.passcode),
          mustChangePassword: true, active: true,
          createdAt: new Date().toISOString(), createdBy: sess.data.id
        };

        try {
          db.staff.push(rec);
          db.settings.managerIdHigh = id;
          writeData(db);
        } catch (err) {
          if (authUserId) await deleteAppwriteAuthUser(authUserId);
          console.error('[goc] Could not save manager profile for', id, err.message);
          return errJson(res, 500, 'The manager profile could not be saved. Please try again.');
        }

        okJson(res, { manager: core.publicManager(rec) });
      });
    } },

  /* Roles slice (c), step 4: the Founder switches a manager off or on, and resets their starting
     password (and, if given, their console passcode). Only manager accounts are reachable: the two
     seeded accounts are never touched here. Either change ends that manager's open sessions at
     once, and a reset forces a new password change at the next sign-in. */
  { method: 'PUT', path: /^\/api\/managers\/(GOC-A-\d+)\/active$/i, need: 'console', cap: 'managers.accounts', handler: (req, res, body, sess, params) => {
      if (typeof body.active !== 'boolean') return errJson(res, 400, 'Say whether the account should be on or off.');
      return withDataLock(async () => {
        const db = readData();
        const id = params[0].toUpperCase();
        const m = id === 'GOC-A-001' || id === 'GOC-A-002' ? null : (db.staff || []).find(x => x.id === id && core.adminRoleKey(x.title));
        if (!m) return errJson(res, 404, 'That manager ID does not exist.');

        if (m.appwriteUserId) {
          if (!appwriteUsers) return errJson(res, 503, 'Appwrite Auth is unavailable. The account status was not changed.');
          try {
            await appwriteUsers.updateStatus(m.appwriteUserId, body.active);
          } catch (err) {
            console.error('[goc] Appwrite manager status update failed for', m.id, err.message);
            return errJson(res, 503, 'The account status could not be changed in Appwrite. Please try again.');
          }
        }
        // If no appwriteUserId, update local record only (local-only manager account)

        m.active = body.active;
        m.activeChangedAt = new Date().toISOString(); m.activeChangedBy = sess.data.id;
        writeData(db);
        if (!body.active) sessions.forEach((d, tok) => { if (d.id === m.id) sessions.delete(tok); });
        okJson(res, { manager: core.publicManager(m) });
      });
    } },

  { method: 'PUT', path: /^\/api\/managers\/(GOC-A-\d+)\/password$/i, need: 'console', cap: 'managers.accounts', handler: (req, res, body, sess, params) => {
      const pw = String(body.password == null ? '' : body.password);
      const pc = body.passcode == null || body.passcode === '' ? '' : String(body.passcode).trim();
      if (pw.length < core.MANAGER_PASSWORD_MIN) return errJson(res, 400, 'Choose a starting password of at least ' + core.MANAGER_PASSWORD_MIN + ' characters.');
      if (pw.length > 200) return errJson(res, 400, 'That password is too long.');
      if (!/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) return errJson(res, 400, 'Use both letters and numbers in a management password.');
      if (pc && !/^\d{4,8}$/.test(pc)) return errJson(res, 400, 'The console passcode is 4 to 8 digits.');
      return withDataLock(async () => {
        const db = readData();
        const id = params[0].toUpperCase();
        const m = id === 'GOC-A-001' || id === 'GOC-A-002' ? null : (db.staff || []).find(x => x.id === id && core.adminRoleKey(x.title));
        if (!m) return errJson(res, 404, 'That manager ID does not exist.');

        if (m.appwriteUserId) {
          if (!appwriteUsers) return errJson(res, 503, 'Appwrite Auth is unavailable. The password was not reset.');
          try {
            await appwriteUsers.updatePassword(m.appwriteUserId, pw);
          } catch (err) {
            console.error('[goc] Appwrite manager password reset failed for', m.id, err.message);
            return errJson(res, 503, 'The password could not be reset in Appwrite. Please try again.');
          }
        }
        // If no appwriteUserId, update local pwHash only (local-only manager account)

        m.pwHash = hashPassword(pw);
        if (pc) m.passcodeHash = hashPassword(pc);
        m.mustChangePassword = true;
        m.passwordResetAt = new Date().toISOString(); m.passwordResetBy = sess.data.id;
        writeData(db);
        sessions.forEach((d, tok) => { if (d.id === m.id) sessions.delete(tok); });
        okJson(res, { manager: core.publicManager(m), reset: true, passcodeChanged: !!pc });
      });
    } },

  /* Roles slice (c), step 5: the Founder deletes a manager for good. The record and every open
     session go at once. The ID high-water mark (settings.managerIdHigh) is left as it is, so the
     number is never issued to anyone else. The two seeded accounts cannot be deleted here. */
  { method: 'DELETE', path: /^\/api\/managers\/(GOC-A-\d+)$/i, need: 'console', cap: 'managers.accounts', handler: (req, res, body, sess, params) => {
      return withDataLock(async () => {
        const db = readData();
        const id = params[0].toUpperCase();
        const i = id === 'GOC-A-001' || id === 'GOC-A-002' ? -1 : (db.staff || []).findIndex(x => x.id === id && core.adminRoleKey(x.title));
        if (i < 0) return errJson(res, 404, 'That manager ID does not exist.');
        const manager = db.staff[i];
        if (manager.appwriteUserId) {
          if (!appwriteUsers) return errJson(res, 503, 'Appwrite Auth is unavailable. The manager was not deleted.');
          try {
            await appwriteUsers.delete(manager.appwriteUserId);
          } catch (err) {
            console.error('[goc] Appwrite manager deletion failed for', manager.id, err.message);
            return errJson(res, 503, 'The manager could not be deleted from Appwrite. Please try again.');
          }
        }
        // If no appwriteUserId, delete from local store only (local-only manager account)
        db.staff.splice(i, 1);
        writeData(db);
        sessions.forEach((d, tok) => { if (d.id === id) sessions.delete(tok); });
        okJson(res, { deleted: true, id });
      });
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
      const p = await perfFor(db, s.id);
      const today = core.dayStamp();
  const prevDay = s.streakDay || null;
  const dayBefore = prevDay ? core.dayBefore(prevDay) : null;
  let displayStreak = s.streak || 0;
  if (prevDay && prevDay !== today && prevDay !== core.dayBefore(today)) {
    const freezeCanSave = (s.streakFreezes > 0) && (prevDay === core.dayBefore(core.dayBefore(today)));
    if (!freezeCanSave) displayStreak = 0;
  }
  okJson(res, {
        id: s.id, name: s.name, exam: core.EXAM,
        subjects: (s.subjects || []).slice(),
        xp: s.xp || 0, streak: displayStreak, streakFreezes: s.streakFreezes || 0,
        level: core.levelFor(s.xp || 0),
        xpIntoLevel: core.xpIntoLevel(s.xp || 0),
        xpPerLevel: core.xpPerLevel(),
        performance: p.overall, performanceDetail: p,
        active: s.active !== false,
        mustChangePassword: !!s.mustChangePassword,
        /* Access tier (Phase 3B): the screens read what this account may use
           from here instead of guessing; the routes enforce it themselves. */
        tier: core.cleanTier(s.tier),
        features: core.tierFeatures(s.tier),
        limits: core.tierLimits(s.tier),
        /* What is left today, so screens can say so plainly. Informational
           only for now: no route refuses on it yet. */
        today: {
          day: core.lagosDay(),
          practice: core.dailyAllowance(practiceCountToday(s), s.tier),
          reviews: core.reviewAllowance(reviewsToday(db, s.id), s.tier)
        }
      });
    } },

  /* Streak freeze (Phase 2, streak-freeze slice 3): spend XP to hold one more
     freeze. The rule (cost, cap of two, enough XP) lives in core.buyStreakFreeze
     so the demo driver can share it; here it runs under the data lock so two
     quick taps cannot both pass the same balance check. Refusals are 409 with
     a machine-readable reason ('max' or 'xp'). On Appwrite the xp and the freeze
     count go in one patch. */
  { method: 'POST', path: /^\/api\/me\/streak-freeze$/, need: 'student', handler: async (req, res, body, sess) => {
      const out = await withDataLock(async () => {
        let stu, db = null;
        if (appwriteDatabases) {
          stu = await getAppwriteStudentOrNull(sess.data.id);
        } else {
          db = readData();
          stu = db.students.find(x => x.id === sess.data.id);
        }
        if (!stu) return { notFound: true };
        const r = core.buyStreakFreeze(stu.xp, stu.streakFreezes);
        if (!r.ok) return { refused: r };
        if (appwriteDatabases) {
          await updateAppwriteStudent(sess.data.id, { xp: r.xp, streakFreezes: r.freezes });
        } else {
          stu.xp = r.xp;
          stu.streakFreezes = r.freezes;
          writeData(db);
        }
        return { r };
      });
      if (out.notFound) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      if (out.refused) {
        const why = out.refused.reason === 'max'
          ? 'You already hold the most streak freezes you can (' + core.STREAK_FREEZE_MAX + ').'
          : 'A streak freeze costs ' + core.STREAK_FREEZE_COST_XP + ' XP.';
        return send(res, 409, { error: why, reason: out.refused.reason, xp: out.refused.xp, streakFreezes: out.refused.freezes });
      }
      okJson(res, {
        ok: true, xp: out.r.xp, streakFreezes: out.r.freezes,
        level: core.levelFor(out.r.xp), cost: core.STREAK_FREEZE_COST_XP, max: core.STREAK_FREEZE_MAX
      });
    } },

  /* Study reminders (Phase 2, Reminders): on by default, so there is nothing to
     opt into — a student only ever switches off (or back on). GET shows the two
     switches and whether a message could really reach them; POST { email?, sms? }
     changes them. The choice is kept per Scholar ID in db.reminderState, under
     the data lock, and reads nothing the page sends except the two booleans.
     SMS is accepted and stored but nothing is texted until a provider is wired in. */
  { method: 'GET', path: /^\/api\/me\/reminders$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const stu = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      okJson(res, { reminders: remindersView(db, stu) });
    } },

  { method: 'POST', path: /^\/api\/me\/reminders$/, need: 'student', handler: async (req, res, body, sess) => {
      const b = body && typeof body === 'object' ? body : {};
      const has = k => Object.prototype.hasOwnProperty.call(b, k);
      if (!has('email') && !has('sms')) return errJson(res, 400, 'Say which reminders to change.');
      if ((has('email') && typeof b.email !== 'boolean') || (has('sms') && typeof b.sms !== 'boolean')) {
        return errJson(res, 400, 'Reminders can only be switched on or off.');
      }
      const stu = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : readData().students.find(x => x.id === sess.data.id);
      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const view = await withDataLock(async () => {
        const db = readData();
        if (!db.reminderState || typeof db.reminderState !== 'object') db.reminderState = {};
        const cur = db.reminderState[sess.data.id] || {};
        const prefs = core.cleanReminderPrefs(cur.prefs);
        if (has('email')) prefs.email = b.email;
        if (has('sms')) prefs.sms = b.sms;
        cur.prefs = prefs;
        db.reminderState[sess.data.id] = cur;
        writeData(db);
        return remindersView(db, stu);
      });
      okJson(res, { ok: true, reminders: view });
    } },

  /* ---- Practice history (Phase 1: server-authoritative) --------------------
     A practice run is study, never assessment — it never touches the academic
     record or the league. But the review it produces (every question, the
     student's answer, the correct one, the explanation) is what Phase 2's
     mistakes review and spaced repetition read from, and a student may sit a
     paper on one phone and review it on another. So the server, not the device,
     now holds it. Kept per Scholar ID in db.practiceRuns, newest first, capped
     so one student cannot grow data.json without bound. The device still keeps
     a copy for offline, but the server is the source of truth. */
  { method: 'GET', path: /^\/api\/me\/practice$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      okJson(res, { runs: await practiceRunsOf(db, sess.data.id) });
    } },

  /* Mistakes review (Phase 2, slice 2): the questions this student got wrong
     in their stored practice runs, once each, newest first. Read-only. */
  { method: 'GET', path: /^\/api\/me\/mistakes$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const mistakes = await mistakesFor(db, sess.data.id);
      const bank = await listQuestions({}, db);
      okJson(res, { mistakes: core.attachImagesToMistakes(core.attachPassagesToMistakes(mistakes, bank, db.passages), bank) });
    } },

  /* Spaced repetition (Phase 2): the mistakes that are due for another look,
     on a 1 / 3 / 7 / 14 / 30 day schedule (core.srQueue). GET lists today's
     session (at most core.SR_SESSION_CAP, most overdue first) with the counts;
     POST { key, given } answers one. The SERVER judges the answer — it finds the
     question in the student's own mistakes by key and compares `given` with the
     stored answer — so the page cannot mark itself right. A review is study:
     nothing goes in the academic record and no XP is paid. */
  { method: 'GET', path: /^\/api\/me\/review$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const mistakes = await mistakesFor(db, sess.data.id);
      const state = (db.reviewState && db.reviewState[sess.data.id]) || {};
      const queue = core.srQueue(mistakes, state, Date.now());
      const bank = await listQuestions({}, db);
      queue.due = core.attachImagesToMistakes(core.attachPassagesToMistakes(queue.due, bank, db.passages), bank);
      const tier = await studentTierOf(db, sess.data.id);
      okJson(res, { review: queue, today: { day: core.lagosDay(), reviews: core.reviewAllowance(reviewsToday(db, sess.data.id), tier) } });
    } },

  { method: 'POST', path: /^\/api\/me\/review$/, need: 'student', handler: async (req, res, body, sess) => {
      const key = body && typeof body.key === 'string' ? body.key : '';
      const given = body ? body.given : null;
      if (!/^[A-Za-z0-9]{1,64}$/.test(key)) return errJson(res, 400, 'Say which question you are answering.');
      if (!Number.isInteger(given) || given < 0 || given > 25) return errJson(res, 400, 'Pick one of the answer options.');
      const out = await withDataLock(async () => {
        const db = readData();
        const mistakes = await mistakesFor(db, sess.data.id);
        const m = mistakes.find(x => x.key === key);
        if (!m) return { missing: true };
        if (!Array.isArray(m.options) || given >= m.options.length) return { badOption: true };
        /* Access tiers: an Open student has a daily number of spaced reviews.
           Checked after the question is found, so a bad request is never charged
           and never shown the limit; GOC has none (limit is null). */
        const tier = await studentTierOf(db, sess.data.id);
        const usedBefore = reviewsToday(db, sess.data.id);
        const allowance = core.reviewAllowance(usedBefore, tier);
        if (!allowance.allowed) return { limited: true, allowance };
        const now = Date.now();
        const state = (db.reviewState && db.reviewState[sess.data.id]) || {};
        const correct = given === Number(m.answer);
        const entry = core.srAfterAnswer(core.srEntryFor(m, state) ? state[key] : null, correct, now);
        if (!db.reviewState || typeof db.reviewState !== 'object') db.reviewState = {};
        db.reviewState[sess.data.id] = core.srStore(state, key, entry);
        if (!db.reviewCount || typeof db.reviewCount !== 'object') db.reviewCount = {};
        db.reviewCount[sess.data.id] = { day: core.lagosDay(), count: usedBefore + 1 };
        writeData(db);
        const q = core.srQueue(mistakes, db.reviewState[sess.data.id], now);
        return { correct, entry, q, m, allowance: core.reviewAllowance(usedBefore + 1, tier) };
      });
      if (out.missing) return errJson(res, 404, 'That question is not in your mistakes.');
      if (out.badOption) return errJson(res, 400, 'Pick one of the answer options.');
      if (out.limited) {
        return send(res, 403, {
          error: core.reviewLimitMessage(out.allowance.limit), reason: 'daily',
          today: { day: core.lagosDay(), reviews: out.allowance }
        });
      }
      okJson(res, {
        ok: true, today: { day: core.lagosDay(), reviews: out.allowance }, correct: out.correct, answer: out.m.answer, explanation: out.m.explanation || '',
        box: out.entry.box, mastered: out.entry.mastered, nextDue: out.entry.due,
        dueCount: out.q.dueCount, upcoming: out.q.upcoming, masteredCount: out.q.mastered
      });
    } },

  /* Daily quest (Phase 2, slice 2): today's quest for this student — answer
     core.DAILY_QUEST_TARGET questions in their weakest topic (or any topic when
     there is no history yet) — and how far along it is. Read-only, computed
     from the stored practice runs by core.dailyQuest. */
  { method: 'GET', path: /^\/api\/me\/quest$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      okJson(res, { quest: core.dailyQuest(await practiceRunsOf(db, sess.data.id)) });
    } },

  /* Weekly quest (Phase 2, weekly quest slice 2): this calendar week's quest
     (Monday to Sunday) and the student's progress — daily quests finished and
     practice questions answered, whichever reaches its target first. Read-only.
     The counters are kept on the student by the study-submit route (never sent
     by the page); core.weeklyQuest only reads them, and reads a record from an
     earlier week as empty. */
  { method: 'GET', path: /^\/api\/me\/weekly-quest$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      okJson(res, { weeklyQuest: core.weeklyQuest(s.weekQuest, core.dayStamp()), streakFreezes: s.streakFreezes || 0 });
    } },

  { method: 'POST', path: /^\/api\/me\/practice$/, need: 'student', handler: async (req, res, body, sess) => {
      const rec = sanitizePracticeRun(body);
      if (!rec) return errJson(res, 400, 'A practice run needs a review with at least one question.');
      const db = readData();
      if (!db.practiceRuns || typeof db.practiceRuns !== 'object') db.practiceRuns = {};
      const list = Array.isArray(db.practiceRuns[sess.data.id]) ? db.practiceRuns[sess.data.id] : [];
      list.unshift(rec);
      const keep = core.tierLimits(await studentTierOf(db, sess.data.id)).practiceHistory;
      db.practiceRuns[sess.data.id] = core.capList(core.dropOldRuns(list), keep);
      writeData(db);
      okJson(res, { ok: true, saved: rec, runs: db.practiceRuns[sess.data.id] });
    } },

  /* ---- Bookmarks (Phase 1, part 2) ------------------------------------------
     A student saves a question to revisit. Kept per Scholar ID in db.bookmarks,
     newest first, capped. Each is a snapshot (see core.sanitizeBookmark), keyed
     by question id — or by a hash of the text for a run that carried no id — so
     saving the same question twice is a no-op rather than a duplicate. */
  { method: 'GET', path: /^\/api\/me\/bookmarks$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const cap = core.tierLimits(await studentTierOf(db, sess.data.id)).bookmarks;
      const all = Array.isArray(db.bookmarks && db.bookmarks[sess.data.id]) ? db.bookmarks[sess.data.id] : [];
      /* Access tiers (Phase 3B): an account over its tier's limit is trimmed
         straight away, newest kept, and the trim is stored. */
      if (cap != null && all.length > cap) { db.bookmarks[sess.data.id] = all.slice(0, cap); writeData(db); }
      okJson(res, { bookmarks: core.capList(all, cap), limit: cap });
    } },

  { method: 'POST', path: /^\/api\/me\/bookmarks$/, need: 'student', handler: async (req, res, body, sess) => {
      const rec = core.sanitizeBookmark(body);
      if (!rec) return errJson(res, 400, 'A bookmark needs the question text and at least two options.');
      const db = readData();
      const cap = core.tierLimits(await studentTierOf(db, sess.data.id)).bookmarks;
      if (!db.bookmarks || typeof db.bookmarks !== 'object') db.bookmarks = {};
      let list = Array.isArray(db.bookmarks[sess.data.id]) ? db.bookmarks[sess.data.id] : [];
      if (cap != null && list.length > cap) { list = list.slice(0, cap); db.bookmarks[sess.data.id] = list; writeData(db); }
      const existing = list.find(b => b.key === rec.key);
      if (existing) return okJson(res, { ok: true, saved: existing, already: true, bookmarks: list });
      /* Full: refuse and say how to make room. Nothing is dropped silently. */
      if (cap != null && list.length >= cap) {
        return send(res, 409, { error: core.bookmarkLimitMessage(cap), reason: 'tier', limit: cap, count: list.length });
      }
      rec.ts = Date.now();
      list.unshift(rec);
      db.bookmarks[sess.data.id] = core.capList(list, cap);
      writeData(db);
      okJson(res, { ok: true, saved: rec, bookmarks: db.bookmarks[sess.data.id] });
    } },

  { method: 'DELETE', path: /^\/api\/me\/bookmarks\/([A-Za-z0-9]+)$/, need: 'student', handler: (req, res, body, sess, params) => {
      const db = readData();
      const list = (db.bookmarks && Array.isArray(db.bookmarks[sess.data.id])) ? db.bookmarks[sess.data.id] : [];
      const next = list.filter(b => b.key !== params[0]);
      if (next.length !== list.length) { db.bookmarks[sess.data.id] = next; writeData(db); }
      okJson(res, { ok: true, removed: next.length !== list.length, bookmarks: next });
    } },

  /* Priority 6 — the catalogue is built from the student's stored combination,
     so their subjects are the single source of truth for what they can sit.
     Theory is one paper per subject and carries no clock; objective is a single
     sitting of the whole combination, so it appears once. There is one test, not
     a weekly one and a monthly one, so each paper is listed exactly once. The
     JAMB-oriented paper is a second full-combination timed sitting, listed once
     alongside the Objective one. */
  { method: 'GET', path: /^\/api\/me\/tests$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      const subs = (s.subjects || []).slice();
      const minutes = core.clampObjectiveMinutes(db.settings.objectiveMinutes);
      const jambMinutes = core.clampJambMinutes(db.settings.jambMinutes);
      const allQuestions = await listQuestions({}, db);
      const rows = [], period = core.PERIOD;
      for (const sub of subs) {
        const n = core.eligible(allQuestions, { section: 'theory', subject: sub }).length;
        if (n) rows.push(Object.assign({ period, section: 'theory', subject: sub, questions: n, durationSec: 0 },
                                       await sitStatus(s.id, 'theory', sub, db)));
      }
      const bp = core.objectiveBlueprint(allQuestions, subs, db.settings.objectiveCounts);
      const total = core.objectiveTotal(bp);
      if (total) {
        rows.push(Object.assign({ period, section: 'objective', subject: core.OBJECTIVE_SUBJECT,
                    questions: total, durationSec: minutes * 60,
                    papers: bp.map(r => ({ subject: r.subject, questions: r.serving })) },
                    await sitStatus(s.id, 'objective', core.OBJECTIVE_SUBJECT, db)));
      }
      const jbp = core.jambBlueprint(allQuestions, subs, db.settings.jambCounts);
      const jTotal = core.objectiveTotal(jbp);
      /* Held back until the bank is deep enough in every one of this student's
         subjects: a thin paper must never be offered. */
      if (jTotal && core.jambOffered(allQuestions, subs, db.settings.jambReadyMin)) {
        rows.push(Object.assign({ period, section: 'jamb', subject: core.OBJECTIVE_SUBJECT,
                    questions: jTotal, durationSec: jambMinutes * 60,
                    papers: jbp.map(r => ({ subject: r.subject, questions: r.serving })) },
                    await sitStatus(s.id, 'jamb', core.OBJECTIVE_SUBJECT, db)));
      }
      /* Open students still see the papers, marked locked; the start route is the real gate. */
      rows.forEach(r => { if (!core.webTestAllowed(r.section, s.tier)) r.locked = true; });
      okJson(res, { subjects: subs, tests: rows, objectiveMinutes: minutes,
                    objectiveMinutesLabel: core.hoursLabel(minutes),
                    jambMinutes: jambMinutes, jambMinutesLabel: core.hoursLabel(jambMinutes) });
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
      /* ACCESS TIER: Web Tests are for GOC students. Checked here, before anything
         is opened or recorded, because the catalogue is only a courtesy. */
      if (core.WEB_TEST_SECTIONS.indexOf(section) > -1 && !core.webTestAllowed(section, s.tier)) {
        return send(res, 403, { error: core.webTestLockMessage(section), reason: 'tier' });
      }
      const subs = (s.subjects || []).slice();
      /* A question whose passage is missing, switched off or from another subject is
         held back, so a paper never promises a question it cannot show. */
      const allQuestions = core.servablePool(await listQuestions({}, db), db.passages);
      let pool, dur, papers = null;
      if (section === 'objective') {
        /* One sitting of the whole combination: the student chooses nothing but
           when to begin, exactly as in the hall. The clock and per-paper counts
           come from the student's cohort where it overrides them, the academy
           default otherwise — effectiveSettingsFor is the one place that merge
           happens. */
        const cohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
        const eff = effectiveSettingsFor(db, cohort);
        const bp = core.objectiveBlueprint(allQuestions, subs, eff.objectiveCounts);
        pool = core.objectivePaper(allQuestions, subs, eff.objectiveCounts);
        if (!pool.length) return errJson(res, 404, 'No questions have been published for that sitting yet.');
        subject = core.OBJECTIVE_SUBJECT;
        dur = eff.objectiveMinutes * 60;
        papers = bp.filter(r => r.serving > 0).map(r => ({ subject: r.subject, questions: r.serving }));
      } else if (section === 'jamb') {
        /* The JAMB-oriented sitting: a second full-combination timed paper,
           assembled exactly like the objective one but from its own exclusive
           jamb-tagged pool — never the objective bank, so a student never
           meets the same question in both sittings — and on its own
           independent clock and per-paper counts. */
        const cohort = s.cohort ? await getCohortOrNull(s.cohort).catch(() => null) : null;
        const eff = effectiveSettingsFor(db, cohort);
        /* The catalogue already hides a thin sitting; this is the gate that
           enforces it. Checked before anything is opened or recorded. */
        if (!core.jambOffered(allQuestions, subs, db.settings.jambReadyMin)) {
          return errJson(res, 403, 'The JAMB-oriented sitting is not open yet — its question bank is still being built.');
        }
        const bp = core.jambBlueprint(allQuestions, subs, eff.jambCounts);
        /* A repeat draws questions this student has not met in an earlier
           JAMB-oriented attempt first (core.jambPaper, `seen`). */
        const seen = core.jambSeenCounts(await getAttemptsForStudent(s.id, db));
        pool = core.jambPaper(allQuestions, subs, eff.jambCounts, undefined, seen);
        if (!pool.length) return errJson(res, 404, 'No questions have been published for that sitting yet.');
        subject = core.OBJECTIVE_SUBJECT;
        dur = eff.jambMinutes * 60;
        papers = bp.filter(r => r.serving > 0).map(r => ({ subject: r.subject, questions: r.serving }));
      } else {
        if (subs.indexOf(subject) === -1) {
          return errJson(res, 403, subject + ' is not part of your registered subject combination.');
        }
        /* Some subjects are examined in the objective sitting only. `eligible`
           would serve nothing anyway, but "nothing published yet" would be the
           wrong reason to give — say the real one. */
        if (!core.theoryAllowed(subject)) return errJson(res, 403, core.noTheoryMessage(subject));
        pool = core.eligible(allQuestions, { section, subject });
        if (!pool.length) return errJson(res, 404, 'No questions have been published for that test yet.');
        dur = 0;   /* a written paper is sat without a clock */
      }

      // SIT RULE: a Theory or Objective session that has been submitted is
      // closed for good; only the JAMB-oriented session may be sat again, as a
      // rehearsal (every attempt is kept, see core.canSit). Re-checked here
      // even though the catalogue already hides a finished session, because
      // the catalogue is only a courtesy; this is the gate that actually
      // enforces it against a stale page, a replayed request, or a client that
      // never re-read the catalogue.
      const round = currentRound(db, section, subject);
      /* OPEN/CLOSE GATE: block new sittings when the round is explicitly closed.
         The default (no round ever opened) counts as open so pre-rounds apps
         are unaffected. */
      if (!roundIsOpen(db, section, subject)) {
        return errJson(res, 403, 'This test is not currently open. Please wait for the next round to be announced.');
      }
      const priorN = await countSubmittedAttempts(s.id, section, subject, db, round);
      const sit = core.canSit(section, new Array(priorN).fill({ section, roundId: round }), round);
      if (sit.reason === 'unknown') return errJson(res, 400, 'Choose a test section.');
      if (!sit.allowed) {
        return errJson(res, 403, 'You have already submitted this test. It cannot be sat again.');
      }

      db.settings.attemptSeq = (db.settings.attemptSeq || 0) + 1;
      writeData(db);
      const paper = {
        id: 'A' + db.settings.attemptSeq + '-' + crypto.randomBytes(4).toString('hex'),
        scholarId: s.id, studentName: s.name,
        period, section, subject, roundId: round,
        questionIds: pool.map(q => q.id),
        startedAt: Date.now(), durationSec: dur
      };
      openPapers.set(paper.id, paper);
      okJson(res, {
        attemptId: paper.id, period, section, subject,
        kind: section === 'theory' ? 'theory' : 'objective',
        papers, total: pool.length, durationSec: paper.durationSec,
        questions: core.attachPassages(pool, db.passages).map(core.forStudent)      // correct answers stripped out, passage attached
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
        const pool = (await Promise.all(paper.questionIds.map(id => findQ(db, id)))).filter(Boolean);
        const marked = core.markAttempt(pool, body.responses || {});

        const rec = {
          id: paper.id, scholarId: paper.scholarId, studentName: paper.studentName,
          period: paper.period, section: paper.section, subject: paper.subject,
          roundId: core.attemptRound(paper),
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
          const freezesBefore = stu.streakFreezes || 0;
          bumpStreakRecord(stu);

          const updated = await updateAppwriteStudent(rec.scholarId, {
            xp: (stu.xp || 0) + gain,
            streak: stu.streak,
            streakDay: stu.streakDay,
            ...freezePatch(freezesBefore, stu.streakFreezes)
          });
          stu = appwriteStudentToRecord(updated);
        } else {
          stu = db.students.find(x => x.id === rec.scholarId);
          const gain = rec.status === 'marked' ? core.xpForAttempt(rec.percent) : 10;
          rec.xpAwarded = gain;
          if (stu) {
            stu.xp = (stu.xp || 0) + gain;
            bumpStreakRecord(stu);
          }
        }

        if (core.cleanTier(stu && stu.tier) === 'goc') {
          if (!db.answerStats || typeof db.answerStats !== 'object') db.answerStats = {};
          core.recordAnswerStats(db.answerStats, paper.subject, marked.answers);
        }
        await createAttempt(rec, db);
        writeData(db);
        return { db, rec, stu };
      });

      if (result.notFound) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      openPapers.delete(paper.id);
      okJson(res, await summariseOwn(result.db, result.rec, result.stu));
    } },

  { method: 'GET', path: /^\/api\/me\/results$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const list = await attemptsFor(db, sess.data.id);
      const rows = list.slice().sort((a, b) => b.submittedAt - a.submittedAt);
      okJson(res, { attempts: rows.map(attemptSummary), performance: await perfFor(db, sess.data.id) });
    } },

  { method: 'GET', path: /^\/api\/me\/results\/([A-Za-z0-9-]+)$/, need: 'student', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const a = await getAttemptById(params[0], db);
      if (!a || a.scholarId !== sess.data.id) return errJson(res, 404, 'That result is not on your record.');

      const stu = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);

      if (!stu) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');

      okJson(res, await summariseOwn(db, a, stu));
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
      const allQuestions = await listQuestions({}, db);
      const subjects = (s.subjects || []).map(sub => {
        const topics = core.studyTopics(allQuestions, sub);
        /* Open students are offered only the newest past-paper year; how many
           older ones are held back is reported so the screen can say so. */
        const allYears = core.studyYears(allQuestions, sub);
        const years = core.tierStudyYears(allYears, s.tier);
        /* poolTotal is the full live bank size for this subject — identical to
           what the practice start route exposes, so the setup screen and the
           in-run counter always agree and the bank never appears to shrink. */
        const poolTotal = core.studyPool(allQuestions, sub, null, []).length;
        return { subject: sub, questions: topics.reduce((m, t) => m + t.questions, 0), topics,
                 poolTotal, years, yearsLocked: allYears.length - years.length };
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
      /* Access tiers (Phase 3B): an Open student reads the first few notes of
         each subject. "First" is by note id among the subject's active notes,
         so it does not shift with the topic filter. The rest are listed but
         locked, and their text is never sent. */
      const tier = core.cleanTier(s.tier);
      const placeInSubject = {}, seenIn = {};
      db.notes.filter(n => n.active && (s.subjects || []).indexOf(n.subject) !== -1)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .forEach(n => { seenIn[n.subject] = seenIn[n.subject] || 0; placeInSubject[n.id] = seenIn[n.subject]++; });
      okJson(res, { notes: rows.map(n => core.noteVisible(placeInSubject[n.id], tier) ? core.publicNote(n) : core.lockedNote(n)) });
    } },

  /* Class notices (Phase 3C slice 7): GOC students only, and only for a subject they take. An Open
     student gets an empty list and `locked: true`, so no notice text ever leaves the server. */
  { method: 'GET', path: /^\/api\/me\/notices$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const locked = !core.canUse('classNotices', core.cleanTier(s.tier));
      okJson(res, { locked, notices: locked ? [] : core.noticesForStudent(db.notices, s) });
    } },

  /* Broadcasts (Phase 4): GOC students only, and only those whose audience includes them. An Open student
     gets an empty list and `locked: true`, so no message text ever leaves the server. */
  { method: 'GET', path: /^\/api\/me\/broadcasts$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const locked = !core.canUse('classNotices', core.cleanTier(s.tier));
      okJson(res, { locked, broadcasts: locked ? [] : core.broadcastsForStudent(db.broadcasts, s) });
    } },

  /* Ask a tutor (Phase 4.A, slice 2): a GOC student flags a live question. The subject is taken
     from the stored question, never from the request; the student's name is taken from the record. */
  { method: 'GET', path: /^\/api\/me\/flags$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const locked = !core.canUse('askTutor', core.cleanTier(s.tier));
      okJson(res, { locked, flags: locked ? [] : core.flagsForStudent(db.flags, s) });
    } },

  { method: 'POST', path: /^\/api\/me\/flags$/, need: 'student', handler: (req, res, body, sess) => {
      return withDataLock(async () => {
        const db = readData();
        const s = appwriteDatabases
          ? await getAppwriteStudent(sess.data.id).catch(() => null)
          : db.students.find(x => x.id === sess.data.id);
        if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
        if (!core.canUse('askTutor', core.cleanTier(s.tier))) {
          return errJson(res, 403, 'Asking a tutor is for GOC students. Ask the academy about joining.');
        }
        const qid = String((body && body.questionId) != null ? body.questionId : '').trim();
        const q = qid ? await findQ(db, qid) : null;
        const gate = core.canFlag(db.flags, s.id, qid, Date.now());
        if (!gate.allowed) return errJson(res, 409, gate.message);
        const st = core.stampFlag(body || {}, q, s, Date.now());
        if (st.error) return errJson(res, 400, st.error);
        db.settings.flagSeq = (db.settings.flagSeq || 0) + 1;
        st.rec.id = 'FL-' + db.settings.flagSeq;
        db.flags.push(st.rec);
        db.settings.alertSeq = (db.settings.alertSeq || 0) + 1;
        const al = core.makeFlagAlert(st.rec, Date.now());
        al.id = 'AL-' + db.settings.alertSeq;
        db.alerts = core.addAlert(db.alerts, al);
        writeData(db);
        okJson(res, { flag: core.publicFlag(st.rec), created: true });
      });
    } },

  /* Phase 4.C: the student's view of their cohort's team challenge (null when none this week). */
  { method: 'GET', path: /^\/api\/me\/challenge$/, need: 'student', handler: async (req, res, body, sess) => {
      const db = readData();
      const s = appwriteDatabases
        ? await getAppwriteStudent(sess.data.id).catch(() => null)
        : db.students.find(x => x.id === sess.data.id);
      if (!s) return errJson(res, 404, 'That Scholar ID is no longer on the roster.');
      const ch = activeChallengeFor(db, s, core.dayStamp());
      if (!ch) return okJson(res, { challenge: null });
      const total = challengeTeamTotal(db, ch);
      okJson(res, { challenge: core.challengeForStudent(ch, total, (db.challengeState || {})[s.id], core.dayStamp()) });
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
      /* Practice may be narrowed by topic and by past-paper year (the year is a
         Practice-only field). CBT narrows by topic only — a year sent with a
         CBT request is ignored. */
      let year = [];
      if (mode === 'practice') {
        const yc = core.cleanYearList(body.years !== undefined ? body.years : body.year);
        if (yc.error) return errJson(res, 400, yc.error);
        year = yc.years;
      }
      const rawQuestions = await listQuestions({}, db);
      const allQuestions = core.servablePool(rawQuestions, db.passages);
      /* Access tiers: an Open student may pick only the newest year. Checked
         here, not just on the screen. */
      if (mode === 'practice' && year.length) {
        const heldYears = core.studyYears(rawQuestions, subject);
        if (core.lockedPastYears(year, heldYears, s.tier).length) {
          const latest = core.tierStudyYears(heldYears, s.tier)[0];
          return send(res, 403, { error: core.pastYearLockMessage(latest && latest.year), reason: 'tier' });
        }
      }
      const pool = core.studyPool(allQuestions, subject, body.topics, year);
      if (!pool.length) {
        return errJson(res, 404, mode === 'practice'
          ? (year.length ? 'No ' + year.join(', ') + ' questions have been published for ' + subject + (Array.isArray(body.topics) && body.topics.length ? ' in the topics you chose' : '') + ' yet.'
                  : 'No questions have been published for ' + subject + (Array.isArray(body.topics) && body.topics.length ? ' in the topics you chose' : '') + ' yet.')
          : 'No questions have been published for the topics you chose yet.');
      }
      let count = core.clampStudyCount(body.count, pool.length);
      /* Access tiers (Phase 3B, slice 2): an Open student has a daily allowance
         of questions (practice and timed CBT set-ups share it) and a most per
         run. A run bigger than what is left is shortened to fit; with nothing
         left it is refused. GOC students have no tier limit (limit is null). */
      const asked = count;
      const usedToday = practiceCountToday(s);
      const allowed = core.capPracticeRun(count, usedToday, s.tier);
      if (allowed < 1) {
        return send(res, 403, {
          error: core.dailyLimitMessage(core.tierLimits(s.tier).practicePerDay),
          reason: 'daily',
          today: { day: core.lagosDay(), practice: core.dailyAllowance(usedToday, s.tier) }
        });
      }
      count = allowed;
      const tierCapped = count < asked;
      const picked = mode === 'practice'
        ? core.pickPractice(pool, count, practiceRecentIds(s.id, subject))
        : core.pickStudy(pool, count);
      if (mode === 'practice') practiceRecentRemember(s.id, subject, picked.map(q => q.id), pool.length);

      const minutes = mode === 'cbt' ? core.clampStudyMinutes(body.minutes) : 0;
      const paper = {
        id: 'S' + crypto.randomBytes(5).toString('hex'),
        scholarId: s.id, subject, mode,
        questionIds: picked.map(q => q.id),
        startedAt: Date.now(), durationSec: minutes * 60
      };
      openStudy.set(String(paper.id), paper);
      if (mode === 'practice') {
        /* A practice paper carries its answers, because the page marks each one
           as it is tapped. The run is registered here all the same, so finishing
           it can be marked again on this side and earn XP no browser calculated.
           poolTotal is the full live bank size for this subject — always the real
           count, unaffected by the recently-seen deduplication cache. This lets
           the UI show the true bank size rather than the per-run served count,
           so the bank never appears to shrink as a student cycles through it. */
        return okJson(res, {
          mode, paperId: paper.id, subject, total: picked.length, durationSec: 0,
          poolTotal: pool.length,
          xpPerAnswer: core.PRACTICE_XP_PER_ANSWER,
          xpPerCorrect: core.PRACTICE_XP_PER_CORRECT,
          xpLeftToday: core.practiceXpRemaining(practiceXpToday(s)),
          capped: tierCapped, asked: asked,
          questions: core.attachPassages(picked, db.passages).map(core.forPractice)
        });
      }
      okJson(res, {
        mode, paperId: paper.id, subject,
        total: picked.length, durationSec: paper.durationSec,
        poolTotal: pool.length,
        capped: tierCapped, asked: asked,
        questions: core.attachPassages(picked, db.passages).map(core.forStudent)      // correct answers stripped out
      });
    } },

  { method: 'POST', path: /^\/api\/me\/study\/submit$/, need: 'student', handler: async (req, res, body, sess) => {
      const paper = openStudy.get(String(body.paperId || ''));
      if (!paper) return errJson(res, 409, 'That study run has ended. Set it up again.');
      if (paper.scholarId !== sess.data.id) return errJson(res, 403, 'That study run does not belong to this Scholar ID.');
      const db = readData();
      const pool = (await Promise.all(paper.questionIds.map(id => findQ(db, id)))).filter(Boolean);
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

        let gain = 0, left = 0, earned = 0, questBonus = 0, questClaimed = false, questDone = false;
        let weekAfter = null, weekDirty = false, weekReward = null, finalFreezes = null;
        let challengeOut = null;

        /* A submitted study run — mock/CBT or practice — is the student's own
           effort for the day regardless of whether it happens to earn XP, so
           it is what the streak is counted against here (never a bare
           login). streakUpdate is a no-op {streak, day} equal to what's
           already stored when today was already counted. */
        const streakUpdate = stu ? core.streakAfterActivity(stu.streak, stu.streakDay, undefined, stu.streakFreezes) : null;
        const streakChanged = streakUpdate && (streakUpdate.streak !== stu.streak || streakUpdate.day !== stu.streakDay || streakUpdate.freezes !== (stu.streakFreezes || 0));

        if (mode === 'practice' && stu) {
          /* Marked from this side's own answer key, then capped for the day:
             the XP a practice run earns can never be dictated by the page. */
          left = core.practiceXpRemaining(practiceXpToday(stu));
          earned = core.xpForPractice(marked.answered, marked.correct);
          gain = Math.min(left, earned);

          /* Daily quest (Phase 2, slice 5). Whether the quest is done is worked
             out here from the answers this side just marked, added to the runs
             already stored — never from anything the page claims. The reward
             comes out of the same daily allowance as the run's own XP, and the
             day is claimed once (stu.questDay). On Appwrite the claim is
             written FIRST; if the optional string attribute `questDay` has not
             been added to the students collection that write fails and no
             bonus is paid, so the bonus can never be collected twice. */
          const thisRun = {
            ts: Date.now(), subject: paper.subject,
            review: pool.map((q, i) => {
              const a = marked.answers[i] || {};
              return { subject: paper.subject, topic: q.topic, given: a.given === undefined ? null : a.given, isCorrect: !!a.isCorrect };
            })
          };
          const storedRuns = await practiceRunsOf(db, sess.data.id);
          const quest = core.dailyQuest([thisRun].concat(storedRuns));
          questDone = !!quest.done;
          let qr = core.questReward(quest, stu.questDay, practiceXpToday(stu) + gain);
          if (qr.claim && appwriteDatabases) {
            try { await updateAppwriteStudent(sess.data.id, { questDay: qr.day }); }
            catch (e) { qr = { claim: false, award: 0, day: null }; }
          }
          questBonus = qr.award;
          questClaimed = qr.claim;

          /* Weekly quest (Phase 2, weekly slice 2 and 3): fold this run into the
             week, from the answers this side just marked — and from whether
             this run collected today's daily quest, which only the server
             decides. The page sends none of it. When that completes the week,
             one streak freeze is paid, counted on top of whatever the streak
             itself just spent on this run, and the week is marked paid in the
             same write (a student already holding the most freezes keeps the
             week unpaid until a later run finds room — core.weeklyReward).
             On Appwrite the weekly write is made FIRST and on its own: the
             progress and, when a freeze is due, the paid mark plus the new
             freeze count go in ONE patch, so a missing optional attribute
             (`weekQuest` string, or `streakFreezes` integer) fails the whole
             patch and nothing is paid. If the paid patch fails the progress
             alone is tried; if that fails too the week simply goes uncounted
             and nothing else is affected. */
          const weekToday = core.dayStamp();
          const weekBefore = core.cleanWeekQuest(stu.weekQuest, weekToday);
          weekAfter = core.weeklyQuestAfterRun(stu.weekQuest, weekToday, { answered: marked.answered, dailyClaimed: questClaimed });
          weekReward = core.weeklyReward(core.weeklyQuest(weekAfter, weekToday), streakUpdate.freezes);
          const weekPaid = weekReward.claim ? core.weeklyQuestClaimed(weekAfter, weekToday) : weekAfter;
          if (appwriteDatabases) {
            let saved = false;
            if (weekReward.claim) {
              try {
                await updateAppwriteStudent(sess.data.id, { weekQuest: JSON.stringify(weekPaid), streakFreezes: weekReward.freezes });
                saved = true; weekAfter = weekPaid;
              } catch (e) { weekReward = { claim: false, award: 0, freezes: streakUpdate.freezes, blocked: null }; }
            }
            if (!saved) {
              try { await updateAppwriteStudent(sess.data.id, { weekQuest: JSON.stringify(weekAfter) }); }
              catch (e) { weekAfter = weekBefore; }
            }
          } else {
            weekAfter = weekPaid;
            stu.weekQuest = weekAfter;
            weekDirty = true;
          }
          finalFreezes = weekReward.freezes;

          /* Phase 4.C: team (cohort) challenge. Fold this run's answered count into
             the student's capped contribution and, if the team has now met the goal,
             pay this member one streak freeze (once, capped, carried if full — the
             same rule as the weekly quest). Local-file deployments only; a glitch
             here never breaks the practice submit. */
          if (!appwriteDatabases && stu) {
            try {
              const ch = activeChallengeFor(db, stu, weekToday);
              if (ch) {
                if (!db.challengeState) db.challengeState = {};
                const afterState = core.challengeAfterRun(db.challengeState[stu.id], ch, { answered: marked.answered }, weekToday);
                db.challengeState[stu.id] = { challengeId: afterState.challengeId, week: afterState.week, contributed: afterState.contributed, claimed: afterState.claimed };
                const teamTotal = challengeTeamTotal(db, ch);
                const rew = core.challengeReward(ch, teamTotal, db.challengeState[stu.id], finalFreezes);
                if (rew.claim) {
                  finalFreezes = rew.freezes;
                  stu.streakFreezes = finalFreezes;
                  db.challengeState[stu.id] = core.challengeClaimed(db.challengeState[stu.id], ch);
                }
                writeData(db);
                challengeOut = { title: ch.title, teamTotal, goal: ch.goal, added: afterState.added,
                                 done: core.challengeDone(teamTotal, ch.goal), freezeAwarded: rew.award,
                                 claimed: !!(db.challengeState[stu.id] && db.challengeState[stu.id].claimed) };
              }
            } catch (e) { /* a challenge glitch never breaks a practice submit */ }
          }
          const total = gain + questBonus;

          if (total > 0) {
            const newXp = (stu.xp || 0) + total;
            const newPracticeXpToday = practiceXpToday(stu) + total;
            const newPracticeXpDay = core.dayStamp();

            if (appwriteDatabases) {
              const updated = await updateAppwriteStudent(sess.data.id, {
                xp: newXp,
                practiceXpDay: newPracticeXpDay,
                practiceXpToday: newPracticeXpToday,
                streak: streakUpdate.streak,
                streakDay: streakUpdate.day,
                ...freezePatch(stu.streakFreezes, finalFreezes)
              });

              stu = appwriteStudentToRecord(updated);
            } else {
              stu.xp = newXp;
              stu.practiceXpDay = newPracticeXpDay;
              stu.practiceXpToday = newPracticeXpToday;
              if (questClaimed) stu.questDay = qr.day;
              stu.streak = streakUpdate.streak;
              stu.streakDay = streakUpdate.day;
              stu.streakFreezes = finalFreezes;
              writeData(db);
            }
          } else if (streakChanged || (questClaimed && !appwriteDatabases) || weekDirty) {
            // Today's practice cap was already hit, so no XP moves — but the
            // run itself still counts as today's activity for the streak (and
            // a completed quest is still marked as collected for the day).
            if (appwriteDatabases) {
              const updated = await updateAppwriteStudent(sess.data.id, {
                streak: streakUpdate.streak, streakDay: streakUpdate.day,
                ...freezePatch(stu.streakFreezes, finalFreezes)
              });
              stu = appwriteStudentToRecord(updated);
            } else {
              stu.streak = streakUpdate.streak;
              stu.streakDay = streakUpdate.day;
              stu.streakFreezes = finalFreezes;
              if (questClaimed) stu.questDay = qr.day;
              writeData(db);
            }
          }
        } else if (stu && streakChanged) {
          // Mock/CBT self-study never earns XP here, but sitting one is still
          // showing up to study, so it counts toward the streak on its own.
          if (appwriteDatabases) {
            const updated = await updateAppwriteStudent(sess.data.id, {
              streak: streakUpdate.streak, streakDay: streakUpdate.day,
                ...freezePatch(stu.streakFreezes, streakUpdate.freezes)
            });
            stu = appwriteStudentToRecord(updated);
          } else {
            stu.streak = streakUpdate.streak;
            stu.streakDay = streakUpdate.day;
            stu.streakFreezes = streakUpdate.freezes;
            writeData(db);
          }
        }
        /* Access tiers (Phase 3B, slice 2): count the questions answered today,
           practice and timed CBT set-ups alike (the limit is enforced at start). On Appwrite the write is
           best-effort: if the optional attributes have not been added the
           run is still saved and the count simply stays at zero. */
        if (stu && marked.answered > 0) {
          const day = core.lagosDay();
          const count = practiceCountToday(stu) + marked.answered;
          if (appwriteDatabases) {
            try {
              const updated = await updateAppwriteStudent(sess.data.id, { practiceCountDay: day, practiceCount: count });
              stu = appwriteStudentToRecord(updated);
            } catch (e) {
              console.error('[goc] Practice count not stored - add optional attributes practiceCountDay (string, 16) and practiceCount (integer) to the students collection:', e.message);
            }
          } else {
            stu.practiceCountDay = day;
            stu.practiceCount = count;
            writeData(db);
          }
        }
      noteAnswerStats(db, stu, paper.subject, marked.answers);
      okJson(res, {
        mode, subject: paper.subject, assessed: false,
        total: marked.total, answered: marked.answered, unanswered: marked.unanswered,
        correct: marked.correct, wrong: marked.wrong, percent: marked.percent,
        timeUsedSec: used,
        xpAwarded: gain,
        xpTotal: stu ? (stu.xp || 0) : 0,
        level: core.levelFor(stu ? (stu.xp || 0) : 0),
        streak: stu ? (stu.streak || 0) : 0,
        xpLeftToday: mode === 'practice' ? Math.max(0, left - gain - questBonus) : 0,
        xpCapped: mode === 'practice' && gain < earned,
        questXp: questBonus, questClaimed: questClaimed, questDone: questDone,
        weekQuest: weekAfter ? core.weeklyQuest(weekAfter, core.dayStamp()) : null,
        weekClaimed: !!(weekReward && weekReward.claim),
        freezeAwarded: weekReward ? weekReward.award : 0,
        challenge: challengeOut,
        streakFreezes: stu ? (finalFreezes != null ? finalFreezes : (stu.streakFreezes || 0)) : 0,
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

  /* ------------------------------------------- console: comprehension passages
     A passage is a reading text shared by several questions (Phase 3). It is
     kept in the data blob beside the notes. A question links to it by id; the
     link is checked on every question write, and a passage cannot be deleted
     while any question — live or held back — still points at it. */

  { method: 'GET', path: /^\/api\/passages$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const subject = url.searchParams.get('subject') || '';
      const activeOnly = url.searchParams.get('activeOnly') === 'true';
      const all = await listQuestions({ all: true }, db);
      const uses = {};
      all.forEach(q => { if (q.passageId) uses[q.passageId] = (uses[q.passageId] || 0) + 1; });
      const rows = db.passages.filter(p => {
        if (subject && p.subject !== subject) return false;
        if (activeOnly && !p.active) return false;
        return true;
      }).map(p => Object.assign({}, p, { questions: uses[p.id] || 0 }));
      okJson(res, { passages: rows, total: db.passages.length });
    } },

  { method: 'POST', path: /^\/api\/passages$/, need: 'console', cap: 'questions.manage', handler: (req, res, body) => {
      const v = core.validatePassage(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.passageSeq = (db.settings.passageSeq || 0) + 1;
      v.rec.id = db.settings.passageSeq;
      db.passages.push(v.rec);
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/passages\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.passages.find(p => String(p.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That passage no longer exists.');
      const v = core.validatePassage(Object.assign({}, cur, body));
      if (v.error) return errJson(res, 400, v.error);
      if (v.rec.subject !== cur.subject) {
        const all = await listQuestions({ all: true }, db);
        if (all.some(q => String(q.passageId) === String(cur.id))) {
          return errJson(res, 400, 'Questions still use this passage, so its subject cannot change.');
        }
      }
      v.rec.id = cur.id;
      db.passages[db.passages.indexOf(cur)] = v.rec;
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/passages\/(\d+)\/active$/, need: 'console', cap: 'questions.manage', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.passages.find(p => String(p.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That passage no longer exists.');
      cur.active = !!body.active;
      writeData(db);
      okJson(res, cur);
    } },

  /* Same rule as notes and questions: held back first. And, because a question
     with no passage would be shown with nothing to read, never while one links. */
  { method: 'DELETE', path: /^\/api\/passages\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.passages.find(p => String(p.id) === params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (cur.active) return errJson(res, 400, 'Hold this passage back before deleting it.');
      const all = await listQuestions({ all: true }, db);
      const n = all.filter(q => String(q.passageId) === String(cur.id)).length;
      if (n) return errJson(res, 400, n + ' question' + (n !== 1 ? 's' : '') + ' still use this passage — unlink or delete ' + (n !== 1 ? 'them' : 'it') + ' first.');
      db.passages.splice(db.passages.indexOf(cur), 1);
      writeData(db);
      okJson(res, { ok: true, deleted: cur.id });
    } },

  /* ------------------------------------------- console: reading notes */

  { method: 'GET', path: /^\/api\/notes$/, need: 'console', cap: 'questions.manage', handler: (req, res) => {
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

  { method: 'POST', path: /^\/api\/notes$/, need: 'console', cap: 'questions.manage', handler: (req, res, body) => {
      const v = core.validateNote(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      db.settings.noteSeq = (db.settings.noteSeq || 0) + 1;
      v.rec.id = db.settings.noteSeq;
      db.notes.push(v.rec);
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/notes\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That note no longer exists.');
      const v = core.validateNote(Object.assign({}, cur, body));
      if (v.error) return errJson(res, 400, v.error);
      v.rec.id = cur.id;
      v.rec = core.keepNoteStamp(cur, v.rec);
      db.notes[db.notes.indexOf(cur)] = v.rec;
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/notes\/(\d+)\/active$/, need: 'console', cap: 'questions.manage', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return errJson(res, 404, 'That note no longer exists.');
      cur.active = !!body.active;
      writeData(db);
      okJson(res, cur);
    } },

  { method: 'GET', path: /^\/api\/notes\/counts$/, need: 'console', cap: 'questions.manage', handler: (req, res) => {
      const db = readData();
      const bySubject = {}, totals = { live: 0, held: 0 };
      db.notes.forEach(n => {
        const sub = n.subject || 'Unknown';
        if (!bySubject[sub]) bySubject[sub] = { live: 0, held: 0 };
        const k = n.active ? 'live' : 'held';
        bySubject[sub][k]++; totals[k]++;
      });
      okJson(res, { bySubject, totals });
    } },

  /* Same rule as questions: a live note is held back before it is deleted. */
  { method: 'DELETE', path: /^\/api\/notes\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: (req, res, body, sess, params) => {
      const db = readData();
      const cur = db.notes.find(n => String(n.id) === params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (cur.active) return errJson(res, 400, 'Hold this note back before deleting it.');
      db.notes.splice(db.notes.indexOf(cur), 1);
      writeData(db);
      okJson(res, { ok: true, deleted: cur.id });
    } },

  /* Bulk delete by subject; "all" must be typed explicitly, blank is refused. */
  { method: 'DELETE', path: /^\/api\/notes\/bulk$/, need: 'console', cap: 'questions.manage', handler: (req, res, body) => {
      const raw = body && body.subject !== undefined && body.subject !== null ? String(body.subject).trim() : '';
      if (!raw) return errJson(res, 400, 'Choose a subject (or "all") before deleting.');
      const all = raw.toLowerCase() === 'all';
      if (!all && core.ALL_SUBJECTS.indexOf(raw) === -1) {
        return errJson(res, 400, 'Choose one of the academy\u2019s subjects, or "all".');
      }
      const db = readData();
      const before = db.notes.length;
      db.notes = db.notes.filter(n => !all && n.subject !== raw);
      const deleted = before - db.notes.length;
      if (deleted > 0) writeData(db);
      okJson(res, { ok: true, deleted, remaining: db.notes.length, subject: all ? 'all' : raw });
    } },

  /* Bulk import of notes from a CSV. The parsing and every per-row decision is
     core.importCSV — the same helper the browser mock uses — so a file that is
     accepted here is accepted there, and a row refused here is refused there.
     Good rows are written; bad rows come back by line number. Every run — not
     just the good rows inside it — is also logged (see logImport below), so
     the console can show what was imported earlier, not only the run just
     finished in this browser tab.
     Re-running the same file is never refused, same as questions import above
     — findDuplicateImport is kept only to label a repeat in the history. */
  { method: 'POST', path: /^\/api\/notes\/import$/, need: 'console', cap: 'questions.manage', handler: (req, res, body, sess) => {
      const csvText = body && body.csv;
      const filename = body && body.filename ? String(body.filename).slice(0, 200) : null;
      const fingerprint = core.csvFingerprint(csvText);
      const db = readData();
      const r = core.importCSV('notes', csvText, null, db.notes);
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

      const rows = await Promise.all(pool.map(async s => {
        const p = await perfFor(db, s.id);
        return {
          scholarId: s.id, name: s.name, xp: s.xp || 0, streak: s.streak || 0,
          level: core.levelFor(s.xp || 0),
          performance: p.overall, assessed: p.markedAttempts,
          me: s.id === me,
          cohortId: s.cohort || null,
          cohortName: cohortName(s.cohort || null)
        };
      }));
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
  { method: 'GET', path: /^\/api\/topics$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const subject = (url.searchParams.get('subject') || '').trim();

      const subjects = core.ALL_SUBJECTS.slice();
      const topics = [];
      const questions = await listQuestions({ all: true }, db);

      const inventory = core.topicInventory(
        questions,
        db.notes || [],
        subject || null,
        Array.isArray(db.topics) ? db.topics : []
      );

      inventory.forEach(item => {
        const topic = item.topic || 'General';
        const rows = questions.filter(q =>
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

      questions.forEach(q => {
        if (subject && q.subject !== subject) return;
        const topic = q.topic || 'General';
        const key = topic.toLowerCase();
        if (seen.has(key)) return;

        const rows = questions.filter(x =>
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

  { method: 'POST', path: /^\/api\/topics\/rename$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body) => {
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
      const questions = await listQuestions({ all: true }, db);

      const matchingQuestions = questions.filter(q =>
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
        questions.some(q =>
          q.subject === subject &&
          (q.topic || 'General').toLowerCase() === valid.topic.toLowerCase()
        ) ||
        (db.notes || []).some(n =>
          n.subject === subject &&
          (n.topic || 'General').toLowerCase() === valid.topic.toLowerCase()
        );

      /* Questions live in the data-access layer now, so the rename is applied
         as one updateQuestion per matched question rather than mutating an
         in-memory array and relying on a trailing writeData(db). In local mode
         updateQuestion patches db.questions in place (persisted by the
         writeData(db) below); in Appwrite mode it is N document updates. This
         is the one non-obvious multi-write in the rewiring (implementation-map
         STEP 3.1). */
      for (const q of matchingQuestions) {
        await updateQuestion(q.id, { topic: valid.topic }, db);
      }
      const movedQuestions = matchingQuestions.length;

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

      const questionsAfter = await listQuestions({ all: true }, db);
      const topics = [];
      const seen = new Set();

      questionsAfter.forEach(q => {
        if (q.subject !== subject) return;
        const topic = q.topic || 'General';
        const key = topic.toLowerCase();
        if (seen.has(key)) return;

        const rows = questionsAfter.filter(x =>
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

  { method: 'GET', path: /^\/api\/questions\/counts$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const bySubject = {};
      const KNOWN_SECTIONS = ['theory', 'objective', 'jamb', 'practice'];
      const totals = { theory: 0, objective: 0, jamb: 0, practice: 0, other: 0 };
      const allQuestions = await listQuestions({ all: true }, db);
      allQuestions.forEach(q => {
        const sub = q.subject || 'Unknown';
        if (!bySubject[sub]) bySubject[sub] = { theory: 0, objective: 0, jamb: 0, practice: 0, other: 0 };
        const sec = q.section;
        if (KNOWN_SECTIONS.includes(sec)) {
          bySubject[sub][sec]++;
          totals[sec]++;
        } else {
          /* question exists but its section is blank or unrecognised — count it
             so the admin can see it rather than losing it silently */
          bySubject[sub].other++;
          totals.other++;
        }
      });
      /* Phase 5 — authoritative practicePool: call studyPool() directly so the
         admin count and the student-facing pool are always computed by the same
         function. Any future change to studyPool() eligibility rules propagates
         here automatically without a manual sync. subject=null, topics=null,
         year=[] returns every question the student could ever see in Practice. */
      const practicePool = core.studyPool(allQuestions, null, null, []).length;
      okJson(res, { bySubject, totals, practicePool });
    } },

  { method: 'GET', path: /^\/api\/questions$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const f = {
        subject: url.searchParams.get('subject') || '',
        section: url.searchParams.get('section') || '',
        kind: url.searchParams.get('kind') || '',
        activeOnly: url.searchParams.get('activeOnly') === 'true'
      };
      const all = await listQuestions({ all: true }, db);
      const rows = all.filter(q => {
        if (f.subject && q.subject !== f.subject) return false;
        if (f.section && q.section !== f.section) return false;
        /* No period filter: there is one test, and a record written when the
           academy ran weekly and monthly papers still belongs to it. */
        if (f.kind && q.kind !== f.kind) return false;
        if (f.activeOnly && !q.active) return false;
        return true;
      });
      okJson(res, { questions: rows, total: all.length });
    } },

  { method: 'POST', path: /^\/api\/questions$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body) => {
      const v = core.validateQuestion(body);
      if (v.error) return errJson(res, 400, v.error);
      const db = readData();
      const pl = core.passageLinkError(v.rec, db.passages);
      if (pl) return errJson(res, 400, pl);
      const il = imageLinkError(v.rec);
      if (il) return errJson(res, 400, il);
      /* FIX: sync questionSeq from Appwrite before assigning the new ID so
         a stale local counter never produces a collision with an ID that
         Appwrite already holds. */
      if (appwriteDatabases) {
        const existing = await listQuestions({ all: true }, db);
        const appwriteMaxId = existing.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        if (appwriteMaxId > (db.settings.questionSeq || 0)) {
          db.settings.questionSeq = appwriteMaxId;
        }
      }
      db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
      v.rec.id = db.settings.questionSeq;
      await createQuestion(v.rec, db);
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
     the target rides along into the log so it's clear what a past import
     covered.
     stampSection: when true, every kept row is filed under the chosen
     section regardless of what the file's own section column says, instead
     of being refused for not matching — how the same question set gets
     imported once for the Web Test and again for Practice. See core.importCSV.
     Re-running the same file (same name, same content, same target) is never
     refused — every valid row is published again on every run. findDuplicateImport
     is kept only to label a repeat in the import history the admin can look
     back at; it no longer blocks anything. */
  { method: 'POST', path: /^\/api\/questions\/import$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess) => {
      const csvText = body && body.csv;
      const filename = body && body.filename ? String(body.filename).slice(0, 200) : null;
      const subject = body && body.subject ? String(body.subject).trim() : '';
      const section = body && body.section ? String(body.section).trim().toLowerCase() : '';
      const stampSection = !!(body && body.stampSection);
      const replace = !!(body && body.replace);
      const target = (subject || section) ? { subject, section, stampSection } : null;
      const targetKey = target ? (target.subject + '/' + target.section + (stampSection ? ' (stamped)' : '')) : null;
      const fingerprint = core.csvFingerprint(csvText);
      /* Pre-parse outside the lock so a bad CSV fails fast without holding it. */
      const existingPre = await listQuestions({ all: true }, readData());
      const r = core.importCSV('questions', csvText, target, existingPre, readData().passages, { replace });
      if (r.error) return errJson(res, 400, r.error);
      return withDataLock(async () => {
        const db = readData();
        const existing = await listQuestions({ all: true }, db);
        /* FIX: In Appwrite mode, the local data.json may have a stale
           questionSeq (e.g. 43) while Appwrite already holds 500+ questions
           with IDs up to 1150. Every import then collides because it tries to
           create IDs 44, 45, 46… which Appwrite already has. Fix: before
           assigning any new IDs, sync questionSeq to the real max ID in
           Appwrite so new questions always get fresh, unused IDs. */
        if (appwriteDatabases) {
          const appwriteMaxId = existing.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
          if (appwriteMaxId > (db.settings.questionSeq || 0)) {
            console.log('[goc] Import: syncing questionSeq from ' + (db.settings.questionSeq || 0) + ' to Appwrite max ID ' + appwriteMaxId + '.');
            db.settings.questionSeq = appwriteMaxId;
          }
        }
        /* Re-run the import inside the lock against the freshest snapshot so
           duplicate detection and replace matching are always accurate. */
        const ri = core.importCSV('questions', csvText, target, existing, db.passages, { replace });
        if (ri.error) return errJson(res, 400, ri.error);
        const ids = [];
        /* Replace mode: matching questions are corrected where they stand (same id). */
        const replacedIds = [];
        /* The patch is laid over the stored question first, so a store that rewrites the
           whole record (Appwrite) keeps the picture, the live flag and any approval fields. */
        const stored = {};
        existing.forEach(q => { stored[String(q.id)] = q; });
        for (const rp of (ri.replacements || [])) {
          await updateQuestion(rp.id, Object.assign({}, stored[String(rp.id)], rp.patch, { id: rp.id }), db);
          replacedIds.push(rp.id);
        }
        /* Sequential creates on purpose: a 200-row import is 200 Appwrite creates
           in Appwrite mode (implementation-map STEP 3.1 performance note). Local
           mode pushes into db.questions; createQuestion is called before writeData
           so every question is in-memory before it is persisted, preventing a
           concurrent request from overwriting the file mid-import.
           ID-collision safety: if createQuestion encounters a 409 (an ID already
           in use that the sequence counter missed — e.g. stale counter, concurrent
           import, or Appwrite state ahead of local state), it throws with code 409
           rather than silently overwriting the existing question.  We catch that
           here, record it as a skipped row with a clear error, and continue so the
           rest of the import succeeds.  The existing question is preserved intact. */
        const collisionErrors = [];
        for (const rec of ri.records) {
          db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
          rec.id = db.settings.questionSeq;
          try {
            await createQuestion(rec, db);
            ids.push(rec.id);
          } catch (createErr) {
            if (createErr && createErr.code === 409) {
              /* ID collision: existing question preserved, new one skipped. */
              collisionErrors.push({
                id: rec.id,
                error: 'ID collision: question ' + rec.id + ' already exists — ' +
                       'existing question preserved, import row skipped.'
              });
              /* Roll the sequence back so the next question does not skip an ID. */
              db.settings.questionSeq = (db.settings.questionSeq || 1) - 1;
            } else {
              throw createErr;
            }
          }
        }
        /* Write once after all creates succeed — not per-question.
           This prevents a partial-import state from being persisted if the
           process is killed mid-loop; it is idempotent because every successful
           create is already in db.questions / Appwrite before we reach here. */
        const allErrors = (ri.errors || []).concat(collisionErrors);
        logImport(db, { kind: 'questions', filename, fingerprint, target: targetKey, read: ri.read,
                         added: ids.length, replaced: replacedIds.length, skipped: allErrors.length,
                         collisions: collisionErrors.length, by: sess && sess.data && sess.data.id });
        writeData(db);
        const total = existing.length + ids.length;
        okJson(res, { read: ri.read, added: ids.length, ids, replaced: replacedIds.length, replacedIds,
                      skipped: allErrors.length, errors: allErrors,
                      collisions: collisionErrors.length, total });
      });
    } },

  /* What has been imported before — so the console can show it, and an admin
     about to run a file can first check it wasn't already run. Newest first,
     capped at 30: this is a "what came in recently" list, not a full audit
     trail, so it stays small and fast without its own pruning job. */
  { method: 'GET', path: /^\/api\/import\/history$/, need: 'console', cap: 'questions.manage', handler: (req, res) => {
      const db = readData();
      const log = Array.isArray(db.importLog) ? db.importLog : [];
      okJson(res, { imports: log.slice(-30).reverse() });
    } },

  { method: 'PUT', path: /^\/api\/questions\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur) return errJson(res, 404, 'That question no longer exists.');
      const v = core.validateQuestion(Object.assign({}, cur, body));
      if (v.error) return errJson(res, 400, v.error);
      const pl = core.passageLinkError(v.rec, db.passages);
      if (pl) return errJson(res, 400, pl);
      const il = imageLinkError(v.rec);
      if (il) return errJson(res, 400, il);
      v.rec.id = cur.id;
      await updateQuestion(cur.id, v.rec, db);
      writeData(db);
      okJson(res, v.rec);
    } },

  { method: 'PUT', path: /^\/api\/questions\/(\d+)\/active$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur) return errJson(res, 404, 'That question no longer exists.');
      const updated = await updateQuestion(cur.id, { active: !!body.active }, db);
      writeData(db);
      okJson(res, updated || Object.assign(cur, { active: !!body.active }));
    } },

  /* A question may only be deleted once it is unpublished (held back) — the
     same cancel/complete-before-delete pattern used for live classes. This
     stops a question a student is mid-way through answering from being
     pulled out from under them; deactivate it first, then delete it. */
  { method: 'DELETE', path: /^\/api\/questions\/(\d+)$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const cur = await findQ(db, params[0]);
      if (!cur) return okJson(res, { ok: true, deleted: Number(params[0]), alreadyGone: true });
      if (cur.active) return errJson(res, 400, 'Deactivate this question before deleting it.');
      await deleteQuestion(cur.id, db);
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
  { method: 'DELETE', path: /^\/api\/questions\/bulk$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess) => {
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
      /* Phase 4 — soft-delete support: if body.archive===true the questions are
         flagged archived instead of being removed from disk. An archived question
         is invisible to all student-facing pools and to the normal admin list
         (listQuestions without {all:true}) but remains recoverable via
         GET /api/questions?archived=true. Hard delete remains the default so
         existing callers that omit the field behave exactly as before. */
      const softDelete = !!(body && body.archive);
      const db = readData();
      const all = await listQuestions({ all: true }, db);
      const matches = all.filter(q => {
        if (!subjectAll && q.subject !== subject) return false;
        if (!sectionAll && q.section !== section) return false;
        /* Never touch already-archived questions; they were previously deleted
           softly and should not appear in a new soft-delete run. */
        if (softDelete && q.archived) return false;
        return true;
      });
      const deletedCount = matches.length;
      const deletedIds = matches.map(q => q.id);
      if (deletedCount > 0) {
        if (softDelete) {
          /* Mark each matched question as archived in-memory. listQuestions
             already filters them out of normal queries (see filter below). */
          const idSet = new Set(deletedIds.map(String));
          db.questions.forEach(q => { if (idSet.has(String(q.id))) q.archived = true; });
        } else {
          await deleteQuestions(deletedIds, db);
        }
        /* Phase 4 — deletion audit log. Every destructive bulk operation is
           recorded in db.deletionLog (separate from importLog so neither cap
           is hit by the other's volume). The log is capped at 500 entries;
           each entry names the actor, the scope, and every deleted ID so the
           operation can be recreated or reversed by a developer. */
        if (!Array.isArray(db.deletionLog)) db.deletionLog = [];
        db.settings.deletionLogSeq = (db.settings.deletionLogSeq || 0) + 1;
        db.deletionLog.push({
          id: db.settings.deletionLogSeq,
          kind: softDelete ? 'archive' : 'hard-delete',
          subject: subjectAll ? 'all' : subject,
          section: sectionAll ? 'all' : section,
          count: deletedCount,
          deletedIds: deletedIds,
          by: (sess && sess.data && sess.data.id) || 'unknown',
          at: new Date().toISOString()
        });
        if (db.deletionLog.length > 500) db.deletionLog = db.deletionLog.slice(-500);
        writeData(db);
      }
      okJson(res, {
        ok: true,
        deleted: deletedCount,
        archived: softDelete,
        remaining: all.length - deletedCount,
        subject: subjectAll ? 'all' : subject,
        section: sectionAll ? 'all' : section
      });
    } },

  /* Phase 4 — recover archived questions. Accepts a JSON body with an `ids`
     array (specific IDs) or subject+section scope (same grammar as the bulk
     delete). Only archived questions are touched; live questions are ignored
     silently so the call is idempotent. */
  { method: 'POST', path: /^\/api\/questions\/restore$/, need: 'console', cap: 'questions.manage', handler: async (req, res, body, sess) => {
      const db = readData();
      const ids = body && Array.isArray(body.ids) ? body.ids.map(String) : null;
      let restored = 0;
      if (ids) {
        const idSet = new Set(ids);
        db.questions.forEach(q => { if (idSet.has(String(q.id)) && q.archived) { delete q.archived; restored++; } });
      } else {
        /* scope-based restore (subject + section, same as bulk delete) */
        const rawSubject = body && body.subject ? String(body.subject).trim() : '';
        const rawSection = body && body.section ? String(body.section).trim() : '';
        const subjectAll = !rawSubject || rawSubject.toLowerCase() === 'all';
        const sectionAll = !rawSection || rawSection.toLowerCase() === 'all';
        const section = sectionAll ? null : core.csvSection(rawSection);
        db.questions.forEach(q => {
          if (!q.archived) return;
          if (!subjectAll && q.subject !== rawSubject) return;
          if (!sectionAll && q.section !== section) return;
          delete q.archived;
          restored++;
        });
      }
      if (restored > 0) {
        if (!Array.isArray(db.deletionLog)) db.deletionLog = [];
        db.settings.deletionLogSeq = (db.settings.deletionLogSeq || 0) + 1;
        db.deletionLog.push({
          id: db.settings.deletionLogSeq,
          kind: 'restore',
          count: restored,
          by: (sess && sess.data && sess.data.id) || 'unknown',
          at: new Date().toISOString()
        });
        if (db.deletionLog.length > 500) db.deletionLog = db.deletionLog.slice(-500);
        writeData(db);
      }
      okJson(res, { ok: true, restored });
    } },

  /* Phase 4 — deletion audit log read (Founder / console only). */
  { method: 'GET', path: /^\/api\/questions\/deletion-log$/, need: 'console', cap: 'questions.manage', handler: (req, res) => {
      const db = readData();
      okJson(res, { log: Array.isArray(db.deletionLog) ? db.deletionLog.slice().reverse() : [] });
    } },

  /* Phase 8 — diagnostics endpoint. A read-only route that inspects the
     question bank and reports structural problems that would otherwise be
     invisible until a student hit them. All findings are non-destructive; the
     endpoint never writes anything. Problems reported:
       duplicateIds     — IDs that appear more than once in the local bank
       unknownSections  — questions whose section is not one of the four known values
       missingFields    — questions missing subject, text, kind, or section
       badAnswerIndex   — objective questions whose answer index is outside options[]
       inactiveInPool   — questions that are active===false but still live
                          (these would reach students — should not happen)
       localVsAppwrite  — when Appwrite is enabled: difference between local
                          question count and Appwrite count (a positive number
                          means Appwrite has MORE questions than the local file,
                          which is the sign of a stale data.json after a redeploy)
  */
  { method: 'GET', path: /^\/api\/questions\/diagnostics$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const KNOWN_SECTIONS = ['theory', 'objective', 'jamb', 'practice'];
      const REQUIRED_FIELDS = ['subject', 'text', 'kind', 'section'];
      const allLocal = db.questions || [];

      /* 1. Duplicate IDs */
      const idCount = {};
      allLocal.forEach(q => { const k = String(q.id); idCount[k] = (idCount[k] || 0) + 1; });
      const duplicateIds = Object.keys(idCount).filter(k => idCount[k] > 1).map(k => ({
        id: k, count: idCount[k]
      }));

      /* 2. Unrecognised sections */
      const unknownSections = allLocal
        .filter(q => !q.archived && !KNOWN_SECTIONS.includes(q.section))
        .map(q => ({ id: q.id, subject: q.subject, section: q.section }));

      /* 3. Missing required fields */
      const missingFields = allLocal
        .filter(q => !q.archived)
        .filter(q => REQUIRED_FIELDS.some(f => !q[f]))
        .map(q => ({ id: q.id, missing: REQUIRED_FIELDS.filter(f => !q[f]) }));

      /* 4. Answer index out of range */
      const badAnswerIndex = allLocal
        .filter(q => !q.archived && q.kind === 'objective' && Array.isArray(q.options))
        .filter(q => {
          const idx = Number(q.answer);
          return isNaN(idx) || idx < 0 || idx >= q.options.length || !q.options[idx];
        })
        .map(q => ({ id: q.id, subject: q.subject, answer: q.answer, optionCount: Array.isArray(q.options) ? q.options.length : 0 }));

      /* 5. Inactive questions that would still reach students (active===false
         but status is live — the active flag is supposed to hide them from pools
         but in principle a live+inactive question passes core.questionIsLive and
         could appear if pool filtering ever breaks). */
      const inactiveInPool = allLocal
        .filter(q => !q.archived && core.questionIsLive(q) && q.active === false)
        .map(q => ({ id: q.id, subject: q.subject, section: q.section }));

      /* 6. Local vs Appwrite count (only when Appwrite is configured). */
      let localVsAppwrite = null;
      if (appwriteDatabases) {
        try {
          const appwriteQuestions = await listQuestions({ all: true }, null);
          const diff = appwriteQuestions.length - allLocal.filter(q => !q.archived).length;
          localVsAppwrite = { local: allLocal.filter(q => !q.archived).length, appwrite: appwriteQuestions.length, diff };
        } catch (e) {
          localVsAppwrite = { error: e.message };
        }
      }

      /* Phase 7/9 — include the persistence warning stamped by the startup guard. */
      const persistenceWarning = db.settings.persistenceWarning || null;

      const healthy = duplicateIds.length === 0 && unknownSections.length === 0 &&
                      missingFields.length === 0 && badAnswerIndex.length === 0 &&
                      inactiveInPool.length === 0 &&
                      !persistenceWarning &&
                      (!localVsAppwrite || (localVsAppwrite.diff === 0));

      okJson(res, {
        healthy,
        totalQuestions: allLocal.filter(q => !q.archived).length,
        archivedQuestions: allLocal.filter(q => q.archived).length,
        duplicateIds,
        unknownSections,
        missingFields,
        badAnswerIndex,
        inactiveInPool,
        localVsAppwrite,
        persistenceWarning,
        checkedAt: new Date().toISOString()
      });
    } },

  /* Phase 6 — JAMB integrity check. A read-only administrator route that
     reports counts and readiness for every JAMB-eligible subject and raises a
     warning when any recent bulk operation reduced the English pool (or any
     subject's pool) below a configurable threshold. The threshold defaults to
     db.settings.jambReadyMin (the existing per-sitting minimum) and can be
     overridden per-call with ?threshold=N.

     Response fields:
       min            — threshold used (questions needed per subject)
       ready          — true only when every subject meets the threshold
       subjects[]     — { subject, total, active, live, eligible, need, ok }
       short[]        — subjects that do not meet the threshold
       recentDeletions — deletion-log entries for JAMB-section questions
                         in the last 7 days, so an admin can correlate a
                         count drop with a specific bulk-delete operation.
       warning        — human-readable summary when ready is false          */
  { method: 'GET', path: /^\/api\/questions\/jamb-integrity$/, need: 'console', cap: 'questions.manage', handler: async (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const rawThreshold = url.searchParams.get('threshold');
      const min = rawThreshold ? core.clampJambReadyMin(Number(rawThreshold)) : core.clampJambReadyMin(db.settings.jambReadyMin);
      const allQuestions = await listQuestions({ all: true }, db);
      /* Per-subject breakdown for JAMB section. */
      const subjectStats = core.ALL_SUBJECTS.map(sub => {
        const jamb = allQuestions.filter(q => q.subject === sub && q.section === 'jamb');
        const total = jamb.length;
        const active = jamb.filter(q => q.active !== false && q.active).length;
        const live = jamb.filter(q => core.questionIsLive(q)).length;
        /* "eligible" = live AND active — what a sitting can actually draw from */
        const eligible = jamb.filter(q => core.questionIsLive(q) && q.active !== false && q.active).length;
        return { subject: sub, total, active, live, eligible, need: Math.max(0, min - eligible), ok: eligible >= min };
      });
      const short = subjectStats.filter(r => !r.ok).map(r => r.subject);
      const ready = short.length === 0;
      /* Recent deletion-log entries that touched JAMB section (last 7 days). */
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentDeletions = (Array.isArray(db.deletionLog) ? db.deletionLog : [])
        .filter(e => {
          if (!e.at || new Date(e.at).getTime() < sevenDaysAgo) return false;
          if (e.kind === 'restore') return false;
          const sec = e.section || '';
          return sec === 'all' || sec === 'jamb';
        })
        .slice().reverse();
      const warning = ready ? null :
        'JAMB pool is short: ' + short.map(s => {
          const r = subjectStats.find(x => x.subject === s);
          return s + ' has ' + r.eligible + ' eligible question' + (r.eligible === 1 ? '' : 's') + ' (need ' + min + ')';
        }).join('; ') + '.';
      okJson(res, { min, ready, subjects: subjectStats, short, recentDeletions, warning });
    } },

  /* ==================== Priority 4.3-4.5: results and manual theory marking
     Every row is identified by Scholar ID. Theory is never scored
     automatically — an administrator awards each mark. */

  { method: 'GET', path: /^\/api\/results$/, need: 'console', cap: 'results.view', handler: async (req, res) => {
      const db = readData();
      const url = new URL(req.url, 'http://localhost');
      const g = k => url.searchParams.get(k) || '';
      const filter = {};
      if (g('scholarId')) filter.scholarId = g('scholarId').toUpperCase();
      if (g('subject')) filter.subject = g('subject');
      if (g('section')) filter.section = g('section');
      /* One test, so an attempt is never hidden by the period it stored. */
      if (g('status')) filter.status = g('status');
      const list = await listAttempts(filter, db);
      const rows = list.slice().sort((a, b) => b.submittedAt - a.submittedAt);
      okJson(res, {
        results: rows.map(attemptSummary),
        awaitingMarking: await countAttemptsAwaitingMarking(db),
        total: await countAttempts(db)
      });
    } },

  /* Phase 4.B — Results export (Founder and Academic Director only: the console gate). Marked papers only, for a
     stretch of Nigeria days chosen as term+year or as typed From/To dates; optional subject, session and cohort.
     JSON by default ({ count, awaiting, rows }, which the console screen turns into the file); ?format=csv or
     ?format=pdf sends the file itself (the PDF is written here, no browser needed). Rows carry names and results only - no email, phone, password or hash. */
  { method: 'GET', path: /^\/api\/results\/export$/, need: 'console', cap: 'results.export', handler: async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const g = k => (url.searchParams.get(k) || '').trim();
      const range = core.termRange({ term: g('term'), year: g('year'), from: g('from'), to: g('to') });
      if (range.error) return errJson(res, 400, range.error);
      const section = g('section');
      if (section && core.EXPORT_SECTIONS.indexOf(section) < 0) return errJson(res, 400, 'Choose Theory, Objective or JAMB-oriented, or leave the session empty.');
      const db = readData();
      const students = appwriteDatabases ? await listAppwriteStudents() : (db.students || []);
      const filter = {};
      if (g('subject')) filter.subject = g('subject');
      if (section) filter.section = section;
      const attempts = await listAttempts(filter, db);
      const cohortNames = {};
      (await listAllCohorts()).forEach(c => { if (c && c.cohortId) cohortNames[c.cohortId] = c.name || ''; });
      const out = core.resultsExportRows(attempts, {
        from: range.from, to: range.to, subject: g('subject'), section, cohort: g('cohort'),
        students: students.map(s => ({ id: s.id, cohort: s.cohort || '' })), cohortNames
      });
      if (g('format') === 'pdf') {
        const file = pdfFromModel(core.resultsPdfModel(out.rows, {
          label: range.label, from: range.from, to: range.to, awaiting: out.awaiting, generatedOn: core.lagosDay(),
          filters: { cohortName: g('cohort') ? (cohortNames[g('cohort')] || g('cohort')) : '', subject: g('subject'), section }
        }));
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="goc-results-' + range.from + '-to-' + range.to + '.pdf"',
          'Content-Length': file.length,
          'Cache-Control': 'private, no-store'
        });
        return res.end(file);
      }
      if (g('format') === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="goc-results-' + range.from + '-to-' + range.to + '.csv"',
          'Cache-Control': 'private, no-store'
        });
        return res.end(core.resultsCsv(out.rows));
      }
      okJson(res, { from: range.from, to: range.to, label: range.label, count: out.rows.length, awaiting: out.awaiting, rows: out.rows });
    } },


  { method: 'GET', path: /^\/api\/results\/([A-Za-z0-9-]+)$/, need: 'console', cap: 'results.view', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const a = await getAttemptById(params[0], db);
      if (!a) return errJson(res, 404, 'That result no longer exists.');
      const out = attemptSummary(a);
      out.durationSec = a.durationSec;
      out.markedBy = a.markedBy || null;
      const qs = await Promise.all(a.answers.map(r => findQ(db, r.questionId)));
      out.answers = a.answers.map((r, i) => {
        const q = qs[i] || {};
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

  { method: 'POST', path: /^\/api\/results\/([A-Za-z0-9-]+)\/mark$/, need: 'console', cap: 'theory.mark', handler: async (req, res, body, sess, params) => {
      const result = await markTheoryScript(params[0], body && body.marks, { id: sess.data.id });
      if (result.error) return errJson(res, result.error[0], result.error[1]);
      okJson(res, attemptSummary(result.a));
    } },

  { method: 'GET', path: /^\/api\/resources$/, need: 'student', handler: async (req, res, body, sess) => {
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

      /* Tells the screen up front whether this student may open files in the app
         (the file route is the real gate). */
      const st = await getAppwriteStudent(sess.data.id).catch(() => null);
      return okJson(res, { resources, canView: core.canUse('resourceView', st && st.tier) });
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

    /* ACCESS TIER: an Open student may download a resource but not open it in the
       app. `?download=1` is the download; anything else is a view. Fails closed:
       a student record that cannot be read is treated as Open. */
    const wantsDownload = new URL(req.url, 'http://localhost').searchParams.get('download') === '1';
    if (!wantsDownload) {
      const st = await getAppwriteStudent(sess.data.id).catch(() => null);
      if (!core.canUse('resourceView', st && st.tier)) {
        return send(res, 403, { error: core.RESOURCE_VIEW_LOCK_MESSAGE, reason: 'tier' });
      }
    }

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
        'Content-Disposition': wantsDownload ? 'attachment' : 'inline',
        'Cache-Control': 'private, no-store'
      });

      res.end(Buffer.from(fileData));
    } catch (err) {
      console.error('[goc] Resource file request failed:', err.message);
      return errJson(res, 404, 'Could not open that resource.');
    }
  } },

  { method: 'GET', path: /^\/api\/admin\/resources$/, need: 'console', cap: 'resources.publish', handler: async (req, res) => {
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

  { method: 'PUT', path: /^\/api\/admin\/resources\/([A-Za-z0-9._-]+)\/published$/, need: 'console', cap: 'resources.publish', handler: async (req, res, body, sess, params) => {
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

  { method: 'POST', path: /^\/api\/admin\/resources\/upload$/, need: 'console', cap: 'resources.publish', multipart: true, handler: (req, res, body, sess) => {
    return handleResourceUpload(req, res, sess);
  } },

  /* Pictures on questions. Upload is console-only; any signed-in session may
     read one (the id is unguessable and a picture carries no answer). */
  { method: 'POST', path: /^\/api\/admin\/question-images$/, need: 'console', cap: 'questions.manage', multipart: true, handler: (req, res) => {
    return handleQuestionImageUpload(req, res);
  } },

  { method: 'GET', path: /^\/api\/question-images\/(QIMG-[A-Za-z0-9]{8,40})$/, need: 'staff-or-student', handler: (req, res, body, sess, params) => {
    const found = findQuestionImage(params[0]);
    if (!found) return errJson(res, 404, 'That picture is not available.');
    let data;
    try { data = fs.readFileSync(found.file); } catch (e) { return errJson(res, 404, 'That picture is not available.'); }
    res.writeHead(200, {
      'Content-Type': QIMG_MIME[found.ext],
      'Content-Length': data.length,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  } },

  /* Permanently removes a resource's database record (and, best-effort, its
     stored file). Deliberately refuses to touch a published resource — an
     admin has to unpublish first, so a live student-facing document can
     never be deleted by accident. This also covers the "the file is gone
     from Appwrite storage but the record is still listed" case: if the
     stored file was already removed some other way, that file-delete call
     just fails quietly and the (now-empty) database record still gets
     cleared out. */
  { method: 'DELETE', path: /^\/api\/admin\/resources\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'resources.publish', handler: async (req, res, body, sess, params) => {
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

  { method: 'GET', path: /^\/api\/videos$/, need: 'student', handler: async (req, res, body, sess) => {
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

      /* ACCESS TIER: lessons and live-class replays are for GOC students. An Open
         student is sent only what their tier allows, so a held-back video's title,
         file id and external link never leave the server. */
      const st = await getAppwriteStudent(sess.data.id).catch(() => null);
      const allowed = videos.filter(v => core.videoAllowed(v.type, st && st.tier));
      return okJson(res, { videos: allowed, locked: allowed.length < videos.length });
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

      /* ACCESS TIER: the file is the real gate, whatever the list said. A student
         record that cannot be read counts as Open. */
      const st = await getAppwriteStudent(sess.data.id).catch(() => null);
      if (!core.videoAllowed(doc.type, st && st.tier)) {
        return send(res, 403, { error: core.videoLockMessage(doc.type), reason: 'tier' });
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

  { method: 'GET', path: /^\/api\/admin\/videos$/, need: 'console', cap: 'resources.publish', handler: async (req, res) => {
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

  { method: 'PUT', path: /^\/api\/admin\/videos\/([A-Za-z0-9._-]+)\/published$/, need: 'console', cap: 'resources.publish', handler: async (req, res, body, sess, params) => {
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

  { method: 'POST', path: /^\/api\/admin\/videos\/upload$/, need: 'console', cap: 'resources.publish', multipart: true, handler: (req, res, body, sess) => {
    return handleVideoUpload(req, res, sess);
  } },

  /* Same rule as resource deletion: a published video must be unpublished
     first, so a live student-facing recording can never be deleted by
     accident. Best-effort removes the stored file (when there is one —
     a link-only video has none) before clearing the database record. */
  { method: 'DELETE', path: /^\/api\/admin\/videos\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'resources.publish', handler: async (req, res, body, sess, params) => {
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

  { method: 'GET', path: /^\/api\/classes$/, need: 'student', handler: async (req, res, body, sess) => {
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

      /* ACCESS TIER: live classes are for GOC students. An Open student gets no
         classes at all, so neither the timetable entries nor the Zoom link leave
         the server. `joinLocked` stays true so a screen can say why it is empty. */
      const st = await getAppwriteStudent(sess.data.id).catch(() => null);
      const joinOk = core.canUse('liveClassJoin', st && st.tier);
      return okJson(res, { classes: joinOk ? classes : [], joinLocked: !joinOk });
    } catch (err) {
      console.error('[goc] Student class list failed:', err.message);
      return errJson(res, 500, 'Could not load classes.');
    }
  } },

  { method: 'GET', path: /^\/api\/admin\/classes$/, need: 'console', cap: 'classes.schedule', handler: async (req, res) => {
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

  { method: 'POST', path: /^\/api\/admin\/classes\/upload$/, need: 'console', cap: 'classes.schedule', handler: async (req, res, body) => {
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
  { method: 'PUT', path: /^\/api\/admin\/classes\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'classes.schedule', handler: async (req, res, body, sess, params) => {
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
  { method: 'DELETE', path: /^\/api\/admin\/classes\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'classes.schedule', handler: async (req, res, body, sess, params) => {
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

  { method: 'GET', path: /^\/api\/admin\/cohorts$/, need: 'console', cap: 'cohort.manage', handler: async (req, res) => {
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

  { method: 'POST', path: /^\/api\/admin\/cohorts$/, need: 'console', cap: 'cohort.create', handler: async (req, res, body) => {
    if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
    const b = body || {};
    const name = clean(b.name, 100);
    if (!name) return errJson(res, 400, 'A cohort name is required.');

    const cohortId = 'COH-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const record = { cohortId, name, status: 'active' };
    ['dailyLimitMin', 'sessionMinutes', 'sessionWarnMinutes', 'objectiveMinutes', 'jambMinutes'].forEach(f => {
      if (b[f] !== undefined && b[f] !== null && b[f] !== '') record[f] = Number(b[f]);
    });
    if (b.objectiveCounts && typeof b.objectiveCounts === 'object') {
      record.objectiveCounts = JSON.stringify(b.objectiveCounts);
    }
    if (b.jambCounts && typeof b.jambCounts === 'object') {
      record.jambCounts = JSON.stringify(b.jambCounts);
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
  { method: 'PUT', path: /^\/api\/admin\/cohorts\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'cohort.manage', handler: async (req, res, body, sess, params) => {
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
    ['dailyLimitMin', 'sessionMinutes', 'sessionWarnMinutes', 'objectiveMinutes', 'jambMinutes'].forEach(f => {
      if (b[f] !== undefined) patch[f] = (b[f] === null || b[f] === '') ? null : Number(b[f]);
    });
    if (b.objectiveCounts !== undefined) {
      patch.objectiveCounts = b.objectiveCounts && typeof b.objectiveCounts === 'object'
        ? JSON.stringify(b.objectiveCounts) : null;
    }
    if (b.jambCounts !== undefined) {
      patch.jambCounts = b.jambCounts && typeof b.jambCounts === 'object'
        ? JSON.stringify(b.jambCounts) : null;
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
  { method: 'DELETE', path: /^\/api\/admin\/cohorts\/([A-Za-z0-9._-]+)$/, need: 'console', cap: 'cohort.create', handler: async (req, res, body, sess, params) => {
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

  /* Move every student in a cohort between Open and GOC at once (Phase 3B, slice 3).
     Cohorts live in Appwrite, so this needs it, like the rest of the cohort routes. Same
     rules as the single-student route: students already on that tier are left alone and
     record nothing; each student actually moved gets the staff member's name and the time.
     If the very first change is refused (the `tier` attribute is missing) it stops with
     503 rather than failing for every student; after that, a student that cannot be
     changed is listed in `failed` and the rest carry on. */
  { method: 'PUT', path: /^\/api\/admin\/cohorts\/([A-Za-z0-9._-]+)\/tier$/, need: 'console', cap: 'students.tier', handler: async (req, res, body, sess, params) => {
      if (!appwriteDatabases) return errJson(res, 503, 'Appwrite Database is not initialized.');
      const want = core.parseTierChange(body && body.tier);
      if (!want.ok) return errJson(res, 400, want.error);
      const cohortId = params[0];
      const db = readData();
      const cohort = await getCohortOrNull(cohortId);
      if (!cohort) return errJson(res, 404, 'No such cohort.');
      const staffRec = (db.staff || []).find(x => x.id === sess.data.id);
      const by = (staffRec && staffRec.name) || sess.data.id;
      const at = new Date().toISOString();
      const members = (await listAppwriteStudents()).filter(s => s.cohort === cohortId);
      let changed = 0, unchanged = 0, auditWarned = false;
      const failed = [];
      for (const s of members) {
        if (core.cleanTier(s.tier) === want.tier) { unchanged++; continue; }
        try {
          await updateAppwriteStudent(s.id, { tier: want.tier });
        } catch (err) {
          if (changed === 0 && failed.length === 0) {
            console.warn('[tiers] could not store the tier - add an optional string attribute "tier" (size 8) to the students collection.');
            return errJson(res, 503, 'The access tier could not be saved. Add the optional "tier" attribute to the students collection, then try again.');
          }
          failed.push(s.id);
          continue;
        }
        changed++;
        try {
          await updateAppwriteStudent(s.id, { tierChangedBy: by, tierChangedAt: at });
        } catch (err) {
          if (!auditWarned) { auditWarned = true; console.warn('[tiers] tier changed but who/when not stored - add optional string attributes "tierChangedBy" (size 80) and "tierChangedAt" (size 40).'); }
        }
      }
      okJson(res, { cohortId, tier: want.tier, total: members.length, changed, unchanged, failed });
    } },

  /* Assigns (or clears, with cohortId: null) the cohort a student belongs
     to. Works in both storage modes, same dual-path shape as the existing
     .../active route just above it in this file. */
  { method: 'PUT', path: /^\/api\/students\/([A-Za-z0-9-]+)\/cohort$/, need: 'console', cap: 'cohort.manage', handler: async (req, res, body, sess, params) => {
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
        return okJson(res, await publicStudent(db, updatedStudent, { console: true }));
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');
      s.cohort = cohortId;
      writeData(db);
      okJson(res, await publicStudent(db, s, { console: true }));
    } },

  /* Move a student between Open and GOC (Phase 3B, slice 3). Console only, so the
     Founder and the Academic Director can; nobody else holds a console session.
     The target is named in the body ({ tier: 'goc' | 'open' }); the change takes effect
     on the student's next request, because every route reads the tier from the record.
     Who did it and when are stored on the student and shown on the console row. A
     request for the tier the student already has changes nothing and records nothing,
     so the note always reflects a real change. Moving to Open does not delete anything
     itself: the saved-question and practice-history limits trim on the student's next
     read, as before (the console confirm says so). */
  { method: 'PUT', path: /^\/api\/students\/([A-Za-z0-9-]+)\/tier$/, need: 'console', cap: 'students.tier', handler: async (req, res, body, sess, params) => {
      const db = readData();
      const studentId = params[0].toUpperCase();
      const want = core.parseTierChange(body && body.tier);
      if (!want.ok) return errJson(res, 400, want.error);
      const staffRec = (db.staff || []).find(x => x.id === sess.data.id);
      const by = (staffRec && staffRec.name) || sess.data.id;
      const at = new Date().toISOString();

      if (appwriteDatabases) {
        const s = await getAppwriteStudentOrNull(studentId);
        if (!s) return errJson(res, 404, 'No such Scholar ID.');
        if (core.cleanTier(s.tier) === want.tier) return okJson(res, await publicStudent(db, s, { console: true }));
        let updated;
        try {
          updated = await updateAppwriteStudent(studentId, { tier: want.tier });
        } catch (err) {
          console.warn('[tiers] could not store the tier - add an optional string attribute "tier" (size 8) to the students collection.');
          return errJson(res, 503, 'The access tier could not be saved. Add the optional "tier" attribute to the students collection, then try again.');
        }
        try {
          updated = await updateAppwriteStudent(studentId, { tierChangedBy: by, tierChangedAt: at });
        } catch (err) {
          console.warn('[tiers] tier changed but who/when not stored - add optional string attributes "tierChangedBy" (size 80) and "tierChangedAt" (size 40).');
        }
        return okJson(res, await publicStudent(db, appwriteStudentToRecord(updated), { console: true }));
      }

      const s = db.students.find(x => x.id === studentId);
      if (!s) return errJson(res, 404, 'No such Scholar ID.');
      if (core.cleanTier(s.tier) === want.tier) return okJson(res, await publicStudent(db, s, { console: true }));
      s.tier = want.tier;
      s.tierChangedBy = by;
      s.tierChangedAt = at;
      writeData(db);
      okJson(res, await publicStudent(db, s, { console: true }));
    } },

  /* The cohort-resolved settings a signed-in student actually studies
     under — GET /api/settings stays as the academy-wide default (it has no
     session, so it has no way to know whose cohort to apply, and is still
     what the pre-login signup screen reads). This is additive: nothing
     that already calls /api/settings changes behaviour today. */
  /* ============================================================ B#2 SCHOLARSHIP ROUTES (slice 2)
     Public:
       GET  /api/scholarship/status           → { mode, places }  (open | waitlist | closed)
     Applicant (public, rate-limited via existing contact throttle logic):
       POST /api/scholarship/apply            → { application }
       POST /api/scholarship/waitlist         → { entry }
     Console (scholarship.view = AD + SA):
       GET  /api/scholarship/applications     → [ publicApplication, … ]
     Console (scholarship.decide = SA):
       POST /api/scholarship/applications/:id/decide   → { application }  body: { decision, message }
     Console (scholarship.approve = [Founder]):
       POST /api/scholarship/applications/:id/approve  → { application }  (accepted → approved; creates student account)
     Console (scholarship.delete = SA):
       DELETE /api/scholarship/applications/:id        → { ok }  (logged to managerLog)
     Console (scholarship.export = SA):
       GET  /api/scholarship/applications/export       → CSV download
  ============================================================ */

  { method: 'GET', path: /^\/api\/scholarship\/status$/, need: null, handler: (req, res) => {
      const db = readData();
      okJson(res, core.scholarshipStatus(db.settings, db.scholarshipApplications));
    } },

  { method: 'POST', path: /^\/api\/scholarship\/apply$/, need: null, handler: (req, res, body) => {
      const db = readData();
      const mode = core.scholarshipOpen(db.settings,
        (db.scholarshipApplications).filter(a => a.status === 'accepted' || a.status === 'approved').length);
      if (mode !== 'open') return errJson(res, 409, mode === 'waitlist'
        ? 'The scholarship form is now closed. You can join the waitlist instead.'
        : 'Applications are currently closed.');

      const v = core.validateScholarApplication(body);
      if (v.error) return errJson(res, 400, v.error);

      const can = core.canApply(db.scholarshipApplications, body.email);
      if (!can.allowed) return errJson(res, 409, can.reason);

      db.settings.scholarshipSeq = (db.settings.scholarshipSeq || 0) + 1;
      const app = core.makeApplication(v.rec, db.settings.scholarshipSeq);
      db.scholarshipApplications.push(app);
      writeData(db);
      okJson(res, { application: core.publicApplication(app) });
    } },

  { method: 'POST', path: /^\/api\/scholarship\/waitlist$/, need: null, handler: (req, res, body) => {
      const db = readData();
      const mode = core.scholarshipOpen(db.settings,
        (db.scholarshipApplications).filter(a => a.status === 'accepted' || a.status === 'approved').length);
      if (mode !== 'waitlist') return errJson(res, 409, mode === 'open'
        ? 'Applications are still open — you can apply directly.'
        : 'The waitlist is not currently open.');

      /* One entry per email address on the waitlist. */
      const email = String(body.email || '').toLowerCase().trim();
      const already = db.scholarshipWaitlist.some(e => String(e.email || '').toLowerCase().trim() === email);
      if (already) return errJson(res, 409, 'You are already on the waitlist.');

      db.settings.waitlistSeq = (db.settings.waitlistSeq || 0) + 1;
      const r = core.makeWaitlistEntry(body, db.settings.waitlistSeq);
      if (r.error) return errJson(res, 400, r.error);
      db.scholarshipWaitlist.push(r.entry);
      writeData(db);
      okJson(res, { entry: r.entry });
    } },

  { method: 'GET', path: /^\/api\/scholarship\/applications$/, need: 'console', cap: 'scholarship.view', handler: (req, res) => {
      const db = readData();
      okJson(res, db.scholarshipApplications.map(core.publicApplication));
    } },

  /* scholarship.export — SA only: download all applications as a CSV.
     GOC-A-002 (Academic Director) has scholarship.view but not scholarship.export;
     because FULL_ACCESS_IDS bypasses the cap gate we add an explicit role check here,
     mirroring the Founder-only guard on the approve route. */
  { method: 'GET', path: /^\/api\/scholarship\/applications\/export$/, need: 'console', cap: 'scholarship.export', handler: (req, res, body, sess) => {
      if (!core.roleCan(sess.data.roleKey, 'scholarship.export'))
        return errJson(res, 403, 'Only Student Affairs can export scholarship applications.');
      const db = readData();
      const csv = core.scholarshipCsv(db.scholarshipApplications);
      res.writeHead(200, {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="scholarship-applications.csv"'
      });
      res.end(csv);
    } },

  /* scholarship.decide — SA: accept or reject a pending application. */
  { method: 'POST', path: /^\/api\/scholarship\/applications\/(SCH-\d+)\/decide$/, need: 'console', cap: 'scholarship.decide', handler: (req, res, body, sess, params) => {
      const id = params[0];
      const decision = String(body.decision || '').toLowerCase();
      if (decision !== 'accept' && decision !== 'reject')
        return errJson(res, 400, 'Send decision as "accept" or "reject".');

      const db = readData();
      const idx = db.scholarshipApplications.findIndex(a => a.id === id);
      if (idx === -1) return errJson(res, 404, 'Application not found.');
      const a = db.scholarshipApplications[idx];
      if (a.status !== 'pending')
        return errJson(res, 409, 'Only pending applications can be decided.');

      a.status      = decision === 'accept' ? 'accepted' : 'rejected';
      a.decidedAt   = new Date().toISOString();
      a.decidedBy   = sess.data.id;
      a.decisionMsg = String(body.message || '').trim().slice(0, 500) || null;
      writeData(db);
      okJson(res, { application: core.publicApplication(a) });
    } },

  /* scholarship.approve — Founder only: convert an accepted application to 'approved'
     and automatically create a GOC student account for the scholar. */
  { method: 'POST', path: /^\/api\/scholarship\/applications\/(SCH-\d+)\/approve$/, need: 'console', cap: 'scholarship.approve', handler: async (req, res, body, sess, params) => {
      if (sess.data.title !== 'Founder')
        return errJson(res, 403, 'Only the Founder can approve scholarship applications.');

      const id = params[0];
      const db = readData();
      const idx = db.scholarshipApplications.findIndex(a => a.id === id);
      if (idx === -1) return errJson(res, 404, 'Application not found.');
      const a = db.scholarshipApplications[idx];
      if (a.status !== 'accepted')
        return errJson(res, 409, 'Only accepted applications can be approved.');

      a.status     = 'approved';
      a.approvedAt = new Date().toISOString();
      a.approvedBy = sess.data.id;

      /* Create a GOC (paid-tier) student account from the scholarship application.
         Reuse the same logic as POST /api/admin/students but tier = 'GOC'. */
      const emailLower = String(a.email || '').toLowerCase().trim();
      const duplicate = !appwriteDatabases && db.students.some(s => String(s.email || '').toLowerCase() === emailLower);
      if (!duplicate) {
        const seq = (db.settings.studentSeq = (db.settings.studentSeq || 1000) + 1);
        const newId = 'GOC-' + String(seq).padStart(4, '0');
        const tempPw = 'GOC' + String(Math.floor(1000 + Math.random() * 9000));
        const student = {
          id:            newId,
          name:          a.name,
          email:         a.email,
          phone:         a.phone,
          subjects:      a.subjects,
          tier:          'GOC',
          active:        true,
          pendingApproval: false,
          passwordHash:  hashPassword(tempPw),
          createdAt:     new Date().toISOString(),
          approvedAt:    a.approvedAt,
          approvedBy:    a.approvedBy,
          scholarshipId: a.id
        };
        if (!appwriteDatabases) db.students.push(student);
        a.studentId   = newId;
        a.tempPassword = tempPw;   /* Founder sees it once in the response; not stored after this write */
      }

      writeData(db);
      const out = Object.assign({}, core.publicApplication(a));
      if (a.tempPassword) out.tempPassword = a.tempPassword;   /* show once */
      delete a.tempPassword;   /* don't persist it */
      okJson(res, { application: out });
    } },

  /* scholarship.delete — SA: remove an application and log it. */
  { method: 'DELETE', path: /^\/api\/scholarship\/applications\/(SCH-\d+)$/, need: 'console', cap: 'scholarship.delete', handler: (req, res, body, sess, params) => {
      const id = params[0];
      const db = readData();
      const before = db.scholarshipApplications.length;
      const target = db.scholarshipApplications.find(a => a.id === id);
      if (!target) return errJson(res, 404, 'Application not found.');
      db.scholarshipApplications = db.scholarshipApplications.filter(a => a.id !== id);
      if (db.scholarshipApplications.length === before) return errJson(res, 404, 'Application not found.');
      /* Log the deletion to the manager log. */
      if (Array.isArray(db.managerLog)) {
        db.managerLog.unshift({
          action:    'scholarship.delete',
          target:    id,
          name:      target.name,
          email:     target.email,
          by:        sess.data.id,
          byName:    sess.data.name,
          at:        new Date().toISOString()
        });
        if (db.managerLog.length > 1000) db.managerLog = db.managerLog.slice(0, 1000);
      }
      writeData(db);
      okJson(res, { ok: true });
    } },

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

  /* ---- Site analytics: visitor beacon + dashboard read ----
     POST /api/analytics/visit  — public, no auth. Fired by the in-page beacon
       on every page-load. Stores a trimmed visit record (no raw IP, no PII).
       IP is hashed with a daily-rotating salt so unique-visitor counts work
       without ever storing the IP itself.
     GET  /api/analytics/site   — console gate, cap: analytics.site.
       Returns aggregated figures for the Founder / Publicity Manager dashboard:
       totalVisits, visitsToday, uniqueLast30, avgTimeSec, topPages[], recentVisits[]. */

  { method: 'POST', path: /^\/api\/analytics\/visit$/, need: null, handler: (req, res, body) => {
      /* Validate payload loosely — malformed beacons are silently dropped. */
      if (!body || typeof body !== 'object') return okJson(res, { ok: true });
      const pages      = Array.isArray(body.pages) ? body.pages.slice(0, 50).map(p => String(p).slice(0, 60)) : [];
      const durationSec = Math.max(0, Math.min(86400, Number(body.durationSec) || 0));
      const device     = body.device === 'mobile' ? 'mobile' : 'desktop';
      const startedAt  = typeof body.startedAt === 'string' ? body.startedAt.slice(0, 30) : new Date().toISOString();
      const ip         = getClientIp(req);

      /* Daily-rotating IP hash: sha256(ip + date-string). Gives unique-visitor
         counts without persisting a raw IP beyond the current calendar day. */
      const today = new Date().toISOString().slice(0, 10);
      const ipHash = crypto.createHash('sha256').update(ip + today).digest('hex').slice(0, 16);

      const record = { startedAt, durationSec, device, pages, ipHash, country: '', city: '' };

      /* Country / city from Cloudflare or similar edge headers (best-effort). */
      const cfCountry = req.headers['cf-ipcountry'] || req.headers['x-country'] || '';
      const cfCity    = req.headers['cf-ipcity']    || req.headers['x-city']    || '';
      if (cfCountry) record.country = String(cfCountry).slice(0, 60);
      if (cfCity)    record.city    = String(cfCity).slice(0, 80);

      const db = readData();
      if (!Array.isArray(db.analyticsVisits)) db.analyticsVisits = [];
      db.analyticsVisits.push(record);
      /* Keep only the newest 5 000 visit records so data.json stays bounded. */
      if (db.analyticsVisits.length > 5000) db.analyticsVisits = db.analyticsVisits.slice(-5000);
      writeData(db);
      okJson(res, { ok: true });
    } },

  { method: 'GET', path: /^\/api\/analytics\/site$/, need: 'console', cap: 'analytics.site', handler: (req, res) => {
      const db = readData();
      const visits = Array.isArray(db.analyticsVisits) ? db.analyticsVisits : [];

      const nowMs  = Date.now();
      const dayMs  = 86400000;
      const todayStart = new Date().toISOString().slice(0, 10);

      let totalDuration = 0;
      let visitsToday   = 0;
      const pageCounts  = {};
      const pageDurations = {};
      const uniqueHashes = new Set();

      visits.forEach(v => {
        totalDuration += (v.durationSec || 0);
        if (typeof v.startedAt === 'string' && v.startedAt.slice(0, 10) === todayStart) visitsToday++;
        /* Unique visitors over last 30 days */
        if (v.ipHash && typeof v.startedAt === 'string') {
          const age = nowMs - new Date(v.startedAt).getTime();
          if (age >= 0 && age <= 30 * dayMs) uniqueHashes.add(v.ipHash);
        }
        /* Per-page view counts and average time */
        (v.pages || []).forEach(p => {
          pageCounts[p]    = (pageCounts[p]    || 0) + 1;
          pageDurations[p] = (pageDurations[p] || 0) + (v.durationSec || 0);
        });
      });

      const topPages = Object.keys(pageCounts)
        .sort((a, b) => pageCounts[b] - pageCounts[a])
        .slice(0, 20)
        .map(p => ({ page: p, views: pageCounts[p], avgTimeSec: Math.round((pageDurations[p] || 0) / pageCounts[p]) }));

      const recentVisits = visits.slice(-200).reverse().map(v => ({
        startedAt:   v.startedAt,
        country:     v.country  || '',
        city:        v.city     || '',
        pages:       v.pages    || [],
        durationSec: v.durationSec || 0,
        device:      v.device   || ''
      }));

      okJson(res, {
        totalVisits:   visits.length,
        visitsToday,
        uniqueLast30:  uniqueHashes.size,
        avgTimeSec:    visits.length ? Math.round(totalDuration / visits.length) : 0,
        topPages,
        recentVisits
      });
    } },

];

/* ------------------------------------------------------------ CRAWLER SHIELD
   Phase 3D slice 1. The app is for enrolled students, not for search engines
   or AI training sets. Three layers, all of them cheap:
     1. /robots.txt disallows everything and names the known AI crawlers;
     2. every response (pages, scripts, styles, the service worker, images and
        the API alike) carries X-Robots-Tag, set once in the dispatcher;
     3. index.html carries the same instruction as a <meta> tag.
   There is deliberately no sitemap. Honest limit: these only bind crawlers
   that obey them; slice 2 turns the rest away. */
const ROBOTS_DIRECTIVE = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'CCBot', 'PerplexityBot', 'Perplexity-User', 'Bytespider',
  'Amazonbot', 'Applebot-Extended', 'Meta-ExternalAgent', 'Meta-ExternalFetcher',
  'FacebookBot', 'cohere-ai', 'Diffbot', 'ImagesiftBot', 'Omgilibot', 'YouBot',
  'Timpibot', 'PetalBot', 'AI2Bot', 'Scrapy'
];
const ROBOTS_TXT = AI_CRAWLERS.map(n => 'User-agent: ' + n + '\nDisallow: /\n').join('\n')
  + '\nUser-agent: *\nDisallow: /\n';

/* Slice 2 — turn crawlers away. Slice 1 only asks politely; this refuses the
   ones that announce themselves. Any request whose User-Agent names a known
   AI crawler, search-engine bot or scraping tool gets a plain 403 (robots.txt
   alone stays readable, so a polite crawler can learn it is not welcome).
   Honest limit: a scraper can fake its User-Agent — a CDN's bot protection
   is the stronger layer. Generic HTTP-library names (Go-http-client, node-fetch)
   are deliberately NOT listed: hosting health checks use them. */
const OTHER_BOTS = [
  'Googlebot', 'AdsBot-Google', 'Google-InspectionTool', 'GoogleOther', 'bingbot', 'BingPreview',
  'Slurp', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Sogou', 'Exabot', 'SeznamBot', 'facebookexternalhit',
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot', 'DataForSeoBot', 'Barkrowler',
  'archive.org_bot', 'ia_archiver', 'HTTrack', 'wget', 'python-requests', 'aiohttp', 'libwww-perl'
];
const BOT_RE = new RegExp(
  AI_CRAWLERS.concat(OTHER_BOTS).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
function isCrawler(req) {
  const ua = String(req.headers['user-agent'] || '');
  return ua.length > 0 && BOT_RE.test(ua);
}

/* Static files are public and unauthenticated, so they get a per-IP limit the
   way login does: a fixed one-minute window. The app itself fetches about a
   dozen files on a cold load, so the default leaves plenty of room. */
const STATIC_RATE_MAX = Number(process.env.GOC_STATIC_RATE_MAX) || 240;
const STATIC_RATE_WINDOW_MS = 60 * 1000;
const staticHits = new Map();
function staticRateLimited(ip) {
  const now = Date.now();
  if (staticHits.size > 5000) {
    for (const [k, v] of staticHits) if (now - v.first > STATIC_RATE_WINDOW_MS) staticHits.delete(k);
  }
  const rec = staticHits.get(ip);
  if (!rec || now - rec.first > STATIC_RATE_WINDOW_MS) { staticHits.set(ip, { count: 1, first: now }); return false; }
  rec.count += 1;
  return rec.count > STATIC_RATE_MAX;
}

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
/* Phase 3D slice 3: GOC_PUBLIC_DIR serves the built (minified) app from a folder such as
   dist/ made by `node build/build.js`. Unset, the readable source is served as before. */
const PUBLIC_ROOT = process.env.GOC_PUBLIC_DIR ? path.resolve(ROOT, process.env.GOC_PUBLIC_DIR) : ROOT;
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
  const full = path.resolve(PUBLIC_ROOT, '.' + rel);
  if (full !== PUBLIC_ROOT && !full.startsWith(PUBLIC_ROOT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  // The server/ and test/ folders hold the database, the hashes and the test
  // fixtures; they are never served. The comparison is done in lower case
  // because Windows treats SERVER and server as the same folder — so an
  // upper-case request like /SERVER/data.json must be refused too.
  const lowerFull = full.toLowerCase();
  const denied = [path.join(ROOT, 'server'), path.join(ROOT, 'test'), path.join(PUBLIC_ROOT, 'server'), path.join(PUBLIC_ROOT, 'test')].map(d => d.toLowerCase());
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

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  // Crawler shield: set before anything is written, so it rides on EVERY
  // response below (writeHead merges these in), errors and redirects included.
  res.setHeader('X-Robots-Tag', ROBOTS_DIRECTIVE);

  if (urlPath === '/robots.txt') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(ROBOTS_TXT),
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(req.method === 'HEAD' ? undefined : ROBOTS_TXT);
  }

  if (isCrawler(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Forbidden');
  }

  if (urlPath.indexOf('/api/') !== 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (staticRateLimited(getClientIp(req))) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' });
      return res.end('Too many requests. Wait a minute and try again.');
    }
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
  /* A tutor session is for tutor routes only. The shared staff-or-student routes stay
     closed to it unless a route says allowTutor. */
  if (route.need === 'staff-or-student' && sess.data.role === 'tutor' && !route.allowTutor) {
    return errJson(res, 403, 'Tutor accounts use the tutor screens only.');
  }

  /* Phase 3C: one gate for every tutor route. The tutor record is re-read on every
     request, so switching a tutor off or changing their subjects takes effect at once,
     and the session's own copy of the subjects is never trusted.
     'tutor-setup' is allowed while a first-login password change is pending;
     'tutor' is not. */
  if (route.need === 'tutor' || route.need === 'tutor-setup') {
    if (!sess) return errJson(res, 401, 'Your session has ended. Please sign in again.');
    if (sess.data.role !== 'tutor') return errJson(res, 403, 'Tutor accounts only.');
    const tRec = appwriteDatabases && APPWRITE_TUTORS_COLLECTION_ID
      ? await getAppwriteTutor(sess.data.id)
      : (readData().tutors || []).find(t => t.id === sess.data.id);
    if (!tRec || tRec.active === false) {
      sessions.delete(sess.token);
      return errJson(res, 403, 'This tutor account has been switched off by the academy.');
    }
    if (route.need === 'tutor' && tRec.mustChangePassword) {
      return errJson(res, 403, 'Choose a new password before you continue.');
    }
    sess.tutor = tRec;
  }

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
    if (route.need !== 'staff' && sess.data.mustChangePassword) return errJson(res, 403, 'Change your starting password first.');
    // Priority 8 — the Founder check is a server-side gate, not a hidden button.
    /* Roles slice (b), step 2: a console route is checked against the role's capability.
       No route carries a `cap` yet and the two seeded accounts keep full access, so today this
       refuses no one; it starts to bite only for managers issued in a later slice. */
    if (route.need === 'console' && !core.adminMayUse(sess.data.id, sess.data.roleKey, route.cap)) {
      return errJson(res, 403, 'Your role does not include this.');
    }
    if (route.need === 'founder' && sess.data.title !== 'Founder') {
      return errJson(res, 403, 'Only the Founder can change management credentials.');
    }
  }

  const params = (route.path.exec(urlPath) || []).slice(1);

  /* Roles slice (c), step 7: a successful sensitive action by a signed-in management account is
     written to the manager log before the reply goes out, so the log is never behind the answer.
     Only the method, path and the two whitelisted choices (tier, on/off) are read (core.auditActionFor);
     a failed request is never logged, and a logging fault never breaks the request. */
  if (sess && sess.data.role === 'admin') {
    const actor = { id: sess.data.id, name: sess.data.name, roleKey: sess.data.roleKey };
    const origEnd = res.end;
    res.end = function () {
      res.end = origEnd;
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const spec = core.auditActionFor(req.method, urlPath, req._auditBody);
          if (spec) {
            const db = readData();
            db.settings.managerLogSeq = (Number(db.settings.managerLogSeq) || 0) + 1;
            db.managerLog = core.addManagerAction(db.managerLog, core.stampManagerAction(actor, spec, db.settings.managerLogSeq, Date.now()));
            writeData(db);
          }
        }
      } catch (e) { console.error('[goc] manager log write failed:', e && e.message ? e.message : e); }
      return origEnd.apply(this, arguments);
    };
  }

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
    .then(body => { req._auditBody = body; return route.handler(req, res, body, sess, params); })
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

/* Any failure here leaves the local data file as the read/write fallback;
   startup never seeds or uploads here. */
async function initAppwrite() {
  const clientBundle = createAppwriteClient();
  if (!clientBundle) {
    throw new Error('Appwrite environment variables are not configured.');
  }

  const { client, storage, databases, users } = clientBundle;
  appwriteResourcesStorage = storage;
  appwriteDatabases = databases;
  appwriteUsers = users;

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
    passages: [],
    attempts: [],
    settings: {
      dailyLimitMin: 90,
      sessionMinutes: core.SESSION_DEFAULT,            // Priority 9 default
      sessionWarnMinutes: core.WARN_DEFAULT,           // Priority 9 warning lead time
      perfWeights: Object.assign({}, core.DEFAULT_WEIGHTS),   // Priority 11
      updateSeq: 100,
      questionSeq: core.seedQuestions().reduce((m, r) => Math.max(m, r.id), 0),
      noteSeq: core.seedNotes().reduce((m, r) => Math.max(m, r.id), 0),
      passageSeq: 0,
      attemptSeq: 0,
      consolePasscodeHash: hashPassword(process.env.GOC_PASSCODE || '2027'),
      consolePasscodeLength: String(process.env.GOC_PASSCODE || '2027').length
    }
  };
  writeData(db);
  console.log('[goc] Created server/data.json with an empty student roster.');
}

function start() {
  // A platform-assigned PORT, or Appwrite Database being configured at all,
  // is the real signal for "this is a hosted deploy, not someone
  // double-clicking index.html" — defaulting to 127.0.0.1 in that case would
  // bind to loopback and be unreachable even though the process stayed "up"
  // and passed its health check locally.
  const isHostedDeploy = !!process.env.PORT || !!appwriteDatabases;
  const HOST = process.env.HOST || (isHostedDeploy ? '0.0.0.0' : '127.0.0.1');
  // Boot-time gate: check whatever is actually stored (fresh seed or an old,
  // never-rotated data.json) against the published defaults before opening
  // the port. See auditDefaultSecrets() — exits the process in production.
  const startupDb = readData();
  auditDefaultSecrets(startupDb);
  writeData(startupDb);
  startBackupSchedule();
  startReminderSchedule();
  // Chrome UI test: skip automatic Appwrite tier migration.
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
    if (DOOR_WORD) console.log('  Tutor entrance: open (word from GOC_TUTOR_DOOR).');
    else if (DOOR_WORD_RAW) console.log('  Tutor entrance: CLOSED. GOC_TUTOR_DOOR must be at least ' + DOOR_WORD_MIN + ' characters.');
    else console.log('  Tutor entrance: closed. Set GOC_TUTOR_DOOR to a secret word to let tutors in.');
    console.log('');
    if (appwriteDatabases) {
      migrateAppwriteTiers().catch(function(err) {
        console.error('[goc] Tier migration error:', err && err.message || err);
      });
    }
  });
}

// On a clean shutdown (a redeploy sends SIGTERM), flush any pending save first.
process.on('SIGTERM', () => { appwriteSaveChain.finally(() => process.exit(0)); });

if (hasAppwriteConfig()) {
  initAppwrite()
    .then(async () => {
      // Pull the durable blob down from Appwrite Storage before deciding
      // whether to seed, so a redeploy that wiped the code folder restores the
      // real settings/notes/topics instead of reseeding demo defaults.
      await hydrateBlobFromStorage();
      // Students live in Appwrite, but staff/settings/etc. still come from the
      // local data.json blob (see initAppwrite()'s own comment) — a fresh
      // Appwrite deploy with no data.json on disk yet and no blob in Storage
      // had no seed() call on this path at all, so start()'s new
      // auditDefaultSecrets() read (and the first real request needing
      // staff/settings) would throw ENOENT instead of creating the file. Found
      // while wiring up the Phase 5 boot-time secret audit; same guard the
      // other two startup paths already had.
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

/* Access tiers, one-time migration for Appwrite deployments (Phase 3B).
   Students are stored in Appwrite, so the local roster migration cannot reach
   them. This stamps tier 'goc' on every student who already existed. A cutoff
   time is recorded the first time it runs, and only students created at or
   before it are promoted, so an Open sign-up made while the optional `tier`
   attribute was still missing is never promoted by a later retry. The
   finished marker is set only when every update succeeded; until then it
   tries again at the next boot, and students without a stored tier read as
   Open (fail closed). Add the optional string attribute `tier` (size 8) to
   the students collection before this can finish. */
async function migrateAppwriteTiers() {
  if (!appwriteDatabases) return { skipped: true };
  const db = readData();
  if (db.settings.tierAppwriteMigrated) return { skipped: true };
  if (!db.settings.tierCutoff) { db.settings.tierCutoff = new Date().toISOString(); writeData(db); }
  const cutoff = Date.parse(db.settings.tierCutoff);
  let list;
  try { list = await listAppwriteStudents(); }
  catch (err) { console.error('[goc] Tier migration could not list students:', err.message); return { failed: true }; }
  let promoted = 0;
  for (const st of list) {
    if (st.tier) continue;
    const made = st.createdAt ? Date.parse(st.createdAt) : NaN;
    if (!(made <= cutoff)) continue;
    try { await updateAppwriteStudent(st.id, { tier: 'goc' }); promoted++; }
    catch (err) {
      console.error('[goc] Tier migration stopped at ' + st.id + ': ' + err.message +
        ' - add an optional string attribute "tier" (size 8) to the students collection, then restart.');
      return { failed: true, promoted };
    }
  }
  const fresh = readData();
  fresh.settings.tierAppwriteMigrated = new Date().toISOString();
  writeData(fresh);
  if (promoted) console.log('[goc] Tier migration: ' + promoted + ' existing student(s) set to GOC.');
  return { promoted };
}

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
