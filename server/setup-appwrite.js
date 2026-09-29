'use strict';
/* setup-appwrite.js — implementation-map STEP 1 (PROVISION APPWRITE) as a
   runnable, idempotent script.

   Creates the two new collections the migration needs — `questions` and
   `attempts` — with their attributes and the indexes that back the
   Query.equal filters in the data-access layer, inside the existing
   `goc_academy` database. It does NOT touch students/resources/videos/
   liveclasses/cohorts, and it never deletes anything.

   Safe to run more than once: every create is wrapped so an "already exists"
   error is treated as success. Attributes and indexes are only added when
   missing.

   Run:  node server/setup-appwrite.js
   Needs these env vars (same ones the app reads, loaded from .env):
     APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
   The API key must have databases.write permission. */

const { createAppwriteClient } = require('./lib/appwrite');

const DATABASE_ID = 'goc_academy';
const QUESTIONS = 'questions';
const ATTEMPTS = 'attempts';

const bundle = createAppwriteClient();
if (!bundle) {
  console.error('APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY are not all set. Aborting.');
  process.exit(1);
}
const { databases } = bundle;
const { Permission, Role } = require('node-appwrite');

/* Same access model as students/resources: writes are server-key only, no
   public read/write. (An API-key request bypasses collection permissions, so
   these govern client SDK access only — kept explicit so the collections match
   the others.) */
const COLLECTION_PERMS = [
  Permission.read(Role.any()),
];

function tolerate(label, promise) {
  return promise.then(
    () => { console.log('  created  ' + label); },
    (err) => {
      if (err && (err.code === 409 || /already exists/i.test(err.message || ''))) {
        console.log('  exists   ' + label);
      } else {
        throw new Error(label + ': ' + (err && err.message || err));
      }
    }
  );
}

async function ensureCollection(id, name) {
  await tolerate('collection ' + id, databases.createCollection(
    DATABASE_ID, id, name, COLLECTION_PERMS, /* documentSecurity */ false));
}

/* Attribute helpers. `size` is the max string length; large text fields use a
   generous ceiling. Appwrite creates attributes asynchronously, so we pace the
   calls and let Appwrite settle between collections. */
const str = (col, key, size, required = false, arr = false) =>
  tolerate(col + '.' + key + ' (string)',
    databases.createStringAttribute(DATABASE_ID, col, key, size, required, undefined, arr));
const int = (col, key, required = false, arr = false) =>
  tolerate(col + '.' + key + ' (integer)',
    databases.createIntegerAttribute(DATABASE_ID, col, key, required, undefined, undefined, undefined, arr));
const flt = (col, key, required = false) =>
  tolerate(col + '.' + key + ' (float)',
    databases.createFloatAttribute(DATABASE_ID, col, key, required));
const bool = (col, key, required = false) =>
  tolerate(col + '.' + key + ' (boolean)',
    databases.createBooleanAttribute(DATABASE_ID, col, key, required));

async function ensureQuestionAttributes() {
  await int(QUESTIONS, 'legacyId');
  await str(QUESTIONS, 'subject', 100);
  await str(QUESTIONS, 'topic', 200);
  await str(QUESTIONS, 'kind', 40);
  await str(QUESTIONS, 'section', 40);
  await str(QUESTIONS, 'period', 40);
  await str(QUESTIONS, 'text', 20000);
  await str(QUESTIONS, 'difficulty', 40);
  await str(QUESTIONS, 'explanation', 20000);
  await bool(QUESTIONS, 'active');
  await str(QUESTIONS, 'options', 5000, false, /* array */ true);
  await int(QUESTIONS, 'answer');            // nullable
  await str(QUESTIONS, 'expected', 20000);
  await int(QUESTIONS, 'maxMark');
}

async function ensureAttemptAttributes() {
  await str(ATTEMPTS, 'scholarId', 60);
  await str(ATTEMPTS, 'studentName', 200);
  await str(ATTEMPTS, 'period', 40);
  await str(ATTEMPTS, 'section', 40);
  await str(ATTEMPTS, 'subject', 100);
  await int(ATTEMPTS, 'questionIds', false, /* array */ true);
  await int(ATTEMPTS, 'startedAt');
  await int(ATTEMPTS, 'submittedAt');
  await int(ATTEMPTS, 'timeUsedSec');
  await int(ATTEMPTS, 'durationSec');
  await int(ATTEMPTS, 'total');
  await int(ATTEMPTS, 'answered');
  await int(ATTEMPTS, 'unanswered');
  await int(ATTEMPTS, 'correct');
  await int(ATTEMPTS, 'wrong');
  await flt(ATTEMPTS, 'score');
  await flt(ATTEMPTS, 'maxScore');
  await flt(ATTEMPTS, 'percent');
  await str(ATTEMPTS, 'status', 40);
  await str(ATTEMPTS, 'answers', 1000000);   // JSON-encoded, large
  await int(ATTEMPTS, 'xpAwarded');
  await str(ATTEMPTS, 'markedBy', 60);        // nullable
  await int(ATTEMPTS, 'markedAt');            // nullable
}

function index(col, key, attributes) {
  return tolerate('index ' + col + '.' + key,
    databases.createIndex(DATABASE_ID, col, key, 'key', attributes));
}

async function ensureIndexes() {
  // questions — single-attribute indexes backing listQuestions filters.
  await index(QUESTIONS, 'idx_subject', ['subject']);
  await index(QUESTIONS, 'idx_section', ['section']);
  await index(QUESTIONS, 'idx_kind', ['kind']);
  await index(QUESTIONS, 'idx_active', ['active']);
  // attempts — scholarId alone + compound scholarId/section/subject backs
  // hasSubmittedAttempt directly; status backs the marking queue + performance.
  await index(ATTEMPTS, 'idx_scholar', ['scholarId']);
  await index(ATTEMPTS, 'idx_scholar_section_subject', ['scholarId', 'section', 'subject']);
  await index(ATTEMPTS, 'idx_status', ['status']);
  await index(ATTEMPTS, 'idx_submitted', ['submittedAt']);   // backs the results date-range filter
}

/* Attributes must exist and be "available" before an index over them can be
   created. Appwrite builds attributes asynchronously, so we wait for them. */
async function waitForAttributes(col) {
  for (let i = 0; i < 30; i++) {
    const list = await databases.listAttributes(DATABASE_ID, col);
    const pending = list.attributes.filter(a => a.status !== 'available');
    if (!pending.length) return;
    console.log('  ...waiting for ' + col + ' attributes (' + pending.length + ' pending)');
    await new Promise(r => setTimeout(r, 2000));
  }
  console.warn('  (proceeding though some ' + col + ' attributes are still processing)');
}

(async () => {
  console.log('Provisioning Appwrite collections in database "' + DATABASE_ID + '"...');
  await ensureCollection(QUESTIONS, 'Questions');
  await ensureCollection(ATTEMPTS, 'Attempts');

  console.log('Questions attributes:');
  await ensureQuestionAttributes();
  console.log('Attempts attributes:');
  await ensureAttemptAttributes();

  await waitForAttributes(QUESTIONS);
  await waitForAttributes(ATTEMPTS);

  console.log('Indexes:');
  await ensureIndexes();

  console.log('\nDone. Collections "questions" and "attempts" are provisioned.');
  console.log('Next: trigger POST /api/admin/migrate-appwrite once from the running app.');
})().catch(err => {
  console.error('\nProvisioning failed:', err.message || err);
  process.exit(1);
});
