'use strict';

/* Private, append-only Appwrite records. No document is overwritten during
   normal operation: independent server instances cannot lose one another's
   writes by replacing a shared JSON blob. Collection permissions must be []. */
const crypto = require('crypto');
const COLLECTION = 'tutorledger';
const DATABASE = 'goc_academy';
const PAGE_SIZE = 100;

function idFor(kind, key) {
  return 'tl' + crypto.createHash('sha256').update(kind + '\0' + key).digest('hex').slice(0, 32);
}
function createLedger(databases, Query) {
  if (!databases || !Query) throw new Error('Appwrite tutor ledger is not configured');
  async function append(kind, key, owner, subject, at, value) {
    const id = idFor(kind, key);
    const data = { kind, owner: owner || '', subject: subject || '', at: Number(at) || 0, payload: JSON.stringify(value) };
    try {
      return await databases.createDocument(DATABASE, COLLECTION, id, data, []);
    } catch (err) {
      if (Number(err && (err.code || err.status)) !== 409) throw err;
      const existing = await databases.getDocument(DATABASE, COLLECTION, id);
      if (['kind', 'owner', 'subject', 'at', 'payload'].some(k => existing[k] !== data[k])) {
        throw new Error('Tutor ledger event ID collision');
      }
      return existing;
    }
  }
  async function list(kind, owner, subject) {
    const filters = [Query.equal('kind', kind)];
    if (owner) filters.push(Query.equal('owner', owner));
    if (subject) filters.push(Query.equal('subject', subject));
    const out = [];
    let cursor = null;
    for (;;) {
      const queries = filters.concat([Query.orderAsc('$id'), Query.limit(PAGE_SIZE)]);
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await databases.listDocuments(DATABASE, COLLECTION, queries);
      if (!page || !Array.isArray(page.documents)) throw new Error('Invalid tutor ledger response');
      for (const doc of page.documents) {
        let payload;
        try { payload = JSON.parse(doc.payload); } catch (_) { throw new Error('Invalid tutor ledger record'); }
        out.push({ id: doc.$id, owner: doc.owner, subject: doc.subject, at: Number(doc.at) || 0, payload, createdAt: doc.$createdAt });
      }
      if (page.documents.length < PAGE_SIZE) return out;
      const next = page.documents[page.documents.length - 1].$id;
      if (!next || next === cursor) throw new Error('Invalid tutor ledger pagination');
      cursor = next;
    }
  }
  return { append, list };
}
module.exports = { createLedger, idFor, COLLECTION, DATABASE };
