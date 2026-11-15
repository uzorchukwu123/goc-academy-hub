'use strict';
/* Import ONE authoritative, frozen backup. Dry-run unless --apply is supplied.
   No existing files or documents are deleted. Re-runs must use the same bytes. */
const fs = require('fs');
const crypto = require('crypto');
const { createAppwriteClient } = require('./lib/appwrite');
const { createLedger, idFor, DATABASE, COLLECTION } = require('./lib/tutor-ledger');
const args = process.argv.slice(2);
const input = args.find(x => x !== '--apply');
if (!input) { console.error('Usage: node server/migrate-tutor-ledger.js <authoritative-backup.json> [--apply]'); process.exit(1); }
const raw = fs.readFileSync(input);
const db = JSON.parse(raw.toString('utf8'));
if (!db || typeof db !== 'object' || Array.isArray(db) || !Array.isArray(db.students) || !db.practiceRuns || typeof db.practiceRuns !== 'object' || !db.answerStats || typeof db.answerStats !== 'object' || !Array.isArray(db.tutorAudit)) {
  throw new Error('Backup lacks required academy data, practiceRuns, answerStats or tutorAudit; nothing was changed');
}
const hash = crypto.createHash('sha256').update(raw).digest('hex');
const records = [];
for (const owner of Object.keys(db.practiceRuns).sort()) {
  if (!Array.isArray(db.practiceRuns[owner])) throw new Error('Invalid practice history');
  db.practiceRuns[owner].forEach((run, index) => records.push(['practice', 'legacy:' + owner + ':' + index, owner, '', Number(run && run.ts) || 0, run]));
}
for (const subject of Object.keys(db.answerStats).sort()) records.push(['baseline', 'legacy:' + subject, '', subject, 0, db.answerStats[subject]]);
db.tutorAudit.forEach((entry, index) => records.push(['audit', 'legacy:' + index, String(entry && entry.tutorId || ''), '', Number(entry && entry.at) || 0, entry]));
console.log('Validated snapshot: ' + records.length + ' records; ' + (args.includes('--apply') ? 'import requested' : 'dry run, no writes') + '.');
if (!args.includes('--apply')) process.exit(0);
(async () => {
  const bundle = createAppwriteClient();
  if (!bundle) throw new Error('Appwrite is not configured');
  const { Query } = require('node-appwrite');
  const info = await bundle.databases.getCollection(DATABASE, COLLECTION);
  if (!Array.isArray(info.$permissions) || info.$permissions.length || info.documentSecurity !== false) throw new Error('Tutor ledger collection is not private');
  const ledger = createLedger(bundle.databases, Query);
  /* Claim the snapshot first: a later retry with different input cannot silently
     append a second baseline after an interrupted migration. */
  await ledger.append('migration', 'snapshot', '', '', 0, { hash });
  for (const row of records) await ledger.append(...row);
  await ledger.append('migration', 'complete', '', '', 0, { hash, count: records.length });
  const complete = await bundle.databases.getDocument(DATABASE, COLLECTION, idFor('migration', 'complete'));
  if (JSON.parse(complete.payload).hash !== hash) throw new Error('Migration verification failed');
  console.log('Import complete. Verify counts and deploy all instances together before enabling the ledger.');
})().catch(err => { console.error('Migration failed: ' + (err && err.message || 'unknown error')); process.exit(1); });
