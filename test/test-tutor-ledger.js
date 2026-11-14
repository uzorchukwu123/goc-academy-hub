'use strict';
const assert = require('assert');
const { createLedger } = require('../server/lib/tutor-ledger');
const { spawnSync } = require('child_process');
const map = new Map();
const Query = { equal: (a, v) => ({ a, v }), limit: n => ({ limit: n }), offset: n => ({ offset: n }), orderAsc: () => ({ order: true }), cursorAfter: id => ({ cursor: id }) };
const db = {
  async createDocument(_db, _col, id, data, permissions) {
    assert.deepStrictEqual(permissions, []);
    if (map.has(id)) { const e = new Error('exists'); e.code = 409; throw e; }
    const doc = Object.assign({ $id: id }, data); map.set(id, doc); return doc;
  },
  async getDocument(_db, _col, id) { return map.get(id); },
  async listDocuments(_db, _col, queries) {
    let rows = [...map.values()];
    for (const q of queries) if (q.a) rows = rows.filter(r => r[q.a] === q.v);
    rows.sort((x, y) => x.$id < y.$id ? -1 : x.$id > y.$id ? 1 : 0);
    const after = queries.find(q => q.cursor); if (after) rows = rows.filter(x => x.$id > after.cursor);
    const off = (queries.find(q => q.offset != null) || {}).offset || 0;
    const limit = (queries.find(q => q.limit != null) || {}).limit || 100;
    return { documents: rows.slice(off, off + limit) };
  }
};
(async () => {
  const a = createLedger(db, Query), b = createLedger(db, Query);
  await Promise.all(Array.from({ length: 205 }, (_, i) => (i % 2 ? a : b).append('audit', 'event-' + i, i % 2 ? 'T1' : 'T2', '', i + 1, { at: i + 1 })));
  assert.strictEqual((await a.list('audit')).length, 205);
  assert.strictEqual((await b.list('audit', 'T1')).length, 102);
  await a.append('audit', 'event-1', 'T1', '', 2, { at: 2 });
  assert.strictEqual((await a.list('audit')).length, 205);
  await assert.rejects(() => b.append('audit', 'event-1', 'T1', '', 2, { at: 99 }), /collision/);
  const failed = createLedger({ createDocument: async () => { throw new Error('offline'); } }, Query);
  await assert.rejects(() => failed.append('audit', 'a', 'T1', '', 1, {}), /offline/);
  const integration = spawnSync(process.execPath, [require('path').join(__dirname, 'test-tutors-appwrite-students.js')], {
    env: Object.assign({}, process.env, { GOC_TEST_LEDGER: '1', GOC_TUTOR_AW_STUDENTS_PORT: '8189' }), encoding: 'utf8'
  });
  if (integration.status !== 0) throw new Error(integration.stdout + integration.stderr);
  console.log('Tutor ledger: pagination, concurrent instances, retries, failure handling and Appwrite route/restart integration passed.');
})().catch(e => { console.error(e.stack); process.exit(1); });
