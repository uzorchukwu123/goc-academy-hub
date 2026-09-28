'use strict';
/* clear-attempts.js — one-off maintenance: remove Web Test attempt records
   submitted within a single calendar day, so the students who sat those
   papers can sit them again.

   WHY THIS LETS A STUDENT RESIT
   The server enforces a ONE-SIT RULE (server.js hasSubmittedAttempt): once an
   attempt document exists for a given scholarId+section+subject, the
   /api/me/tests/start route refuses to serve that paper again. Deleting the
   attempt document is therefore exactly what reopens the paper — no code
   change is needed for the resit itself, only the record has to go.

   WHAT IT TOUCHES
   Only the `attempts` collection in the `goc_academy` Appwrite database, and
   only documents whose integer `submittedAt` falls inside the chosen day.
   It never touches students, questions, resources, videos, classes or cohorts,
   and it never deletes an attempt from any other day.

   SAFETY
   - DRY RUN BY DEFAULT. With no --confirm flag it only lists what it *would*
     delete (a per-student / per-paper breakdown and a total) and deletes
     nothing.
   - Pass --confirm to actually delete.
   - The day is "yesterday, Nigeria time (WAT, UTC+1)" by default. Override the
     day with --date=YYYY-MM-DD and the offset with --tzOffsetMin=<minutes>.
   - After a real deletion it runs a resit check: for every scholarId+section+
     subject it removed, it re-queries the collection and confirms no attempt
     remains for that paper (i.e. hasSubmittedAttempt would now be false). Any
     paper still blocked — e.g. because an older attempt from another day also
     exists — is reported by Scholar ID so it can be handled deliberately
     rather than silently.

   Run (from the repo root, with the Appwrite env vars loaded):
     node server/clear-attempts.js                 # dry run, yesterday WAT
     node server/clear-attempts.js --confirm        # delete yesterday WAT
     node server/clear-attempts.js --date=2026-09-27 --confirm
   Needs: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
   (the API key must have databases.write permission). */

const { createAppwriteClient } = require('./lib/appwrite');

const DATABASE_ID = 'goc_academy';
const ATTEMPTS = 'attempts';
const PAGE = 100;                 // Appwrite list page size we paginate with
const WAT_OFFSET_MIN = 60;        // Nigeria is UTC+1, no daylight saving

function arg(name) {
  const hit = process.argv.slice(2).find(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

/* The [start, end) epoch-millisecond window for the target calendar day, in the
   given timezone offset. --date pins an explicit day; otherwise it is
   "yesterday" in that timezone relative to now. Date.UTC normalizes any day/
   month/year rollover (e.g. the 1st minus one day). */
function dayWindow(offsetMin, dateStr) {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) throw new Error('--date must be YYYY-MM-DD');
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const start = Date.UTC(y, mo, d, 0, 0, 0) - offsetMin * 60000;
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }
  const local = new Date(Date.now() + offsetMin * 60000); // "wall clock" in that tz
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate();
  const start = Date.UTC(y, mo, d - 1, 0, 0, 0) - offsetMin * 60000; // yesterday 00:00 tz
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function fmt(epochMs, offsetMin) {
  const shifted = new Date(epochMs + offsetMin * 60000);
  const p = n => String(n).padStart(2, '0');
  return shifted.getUTCFullYear() + '-' + p(shifted.getUTCMonth() + 1) + '-' + p(shifted.getUTCDate())
    + ' ' + p(shifted.getUTCHours()) + ':' + p(shifted.getUTCMinutes()) + ' (UTC+' + (offsetMin / 60) + ')';
}

async function listWindow(databases, Query, start, end) {
  const out = [];
  let cursor = null;
  for (;;) {
    const queries = [
      Query.greaterThanEqual('submittedAt', start),
      Query.lessThan('submittedAt', end),
      Query.orderAsc('$id'),
      Query.limit(PAGE)
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DATABASE_ID, ATTEMPTS, queries);
    out.push(...res.documents);
    if (res.documents.length < PAGE) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return out;
}

/* True if any attempt still exists for this exact paper — the same test
   server.js hasSubmittedAttempt() makes, so a `false` here means the student
   really can sit it again. */
async function stillBlocked(databases, Query, scholarId, section, subject) {
  const res = await databases.listDocuments(DATABASE_ID, ATTEMPTS, [
    Query.equal('scholarId', scholarId),
    Query.equal('section', section),
    Query.equal('subject', subject),
    Query.limit(1)
  ]);
  return (res.total || res.documents.length) > 0;
}

async function main() {
  const bundle = createAppwriteClient();
  if (!bundle) {
    console.error('APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY are not all set. Aborting.');
    process.exit(1);
  }
  const { databases } = bundle;
  const { Query } = require('node-appwrite');

  const offsetMin = arg('tzOffsetMin') !== undefined ? Number(arg('tzOffsetMin')) : WAT_OFFSET_MIN;
  const dateStr = typeof arg('date') === 'string' ? arg('date') : null;
  const confirm = !!arg('confirm');
  const { start, end } = dayWindow(offsetMin, dateStr);

  console.log('');
  console.log('  Target day      : ' + fmt(start, offsetMin) + '  ->  ' + fmt(end, offsetMin));
  console.log('  submittedAt in  : [' + start + ', ' + end + ')  (epoch ms)');
  console.log('  Mode            : ' + (confirm ? 'DELETE (--confirm given)' : 'DRY RUN (no deletion)'));
  console.log('');

  const docs = await listWindow(databases, Query, start, end);
  if (!docs.length) {
    console.log('  No attempts were submitted in that window. Nothing to do.');
    return;
  }

  // Per-student / per-paper breakdown so the preview is auditable.
  const papers = new Map(); // key: scholarId|section|subject
  docs.forEach(d => {
    const key = (d.scholarId || '?') + '|' + (d.section || '?') + '|' + (d.subject || '?');
    if (!papers.has(key)) papers.set(key, { scholarId: d.scholarId, section: d.section, subject: d.subject, n: 0 });
    papers.get(key).n++;
  });

  console.log('  ' + docs.length + ' attempt(s) across ' + papers.size + ' paper(s):');
  [...papers.values()]
    .sort((a, b) => (a.scholarId || '').localeCompare(b.scholarId || ''))
    .forEach(p => console.log('    ' + p.scholarId + '  ' + p.section + '/' + p.subject + '  x' + p.n));
  console.log('');

  if (!confirm) {
    console.log('  DRY RUN — nothing deleted. Re-run with --confirm to delete these.');
    return;
  }

  let deleted = 0;
  const failures = [];
  for (const d of docs) {
    try {
      await databases.deleteDocument(DATABASE_ID, ATTEMPTS, d.$id);
      deleted++;
    } catch (err) {
      failures.push(d.$id + ': ' + (err && err.message || err));
    }
  }
  console.log('  Deleted ' + deleted + ' / ' + docs.length + ' attempt(s).');
  if (failures.length) {
    console.log('  ' + failures.length + ' failed to delete:');
    failures.forEach(f => console.log('    ' + f));
  }

  // Resit check: confirm each paper is now sit-able again.
  console.log('');
  console.log('  Resit check (hasSubmittedAttempt must be false for each paper):');
  let blocked = 0;
  for (const p of papers.values()) {
    const still = await stillBlocked(databases, Query, p.scholarId, p.section, p.subject);
    if (still) {
      blocked++;
      console.log('    STILL BLOCKED  ' + p.scholarId + '  ' + p.section + '/' + p.subject
        + '  (an attempt from another day remains — not deleted by design)');
    } else {
      console.log('    can resit      ' + p.scholarId + '  ' + p.section + '/' + p.subject);
    }
  }
  console.log('');
  if (blocked === 0) {
    console.log('  All ' + papers.size + ' paper(s) are now open for a resit.');
  } else {
    console.log('  ' + blocked + ' paper(s) still blocked by an attempt outside the target day — review above.');
  }
}

main().catch(err => {
  console.error('[clear-attempts] failed:', err && err.stack || err);
  process.exit(1);
});
