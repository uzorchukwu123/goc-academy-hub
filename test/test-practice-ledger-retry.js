'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const app = fs.readFileSync(require('path').join(__dirname, '../js/app.js'), 'utf8');
const start = app.indexOf('var pracSyncPromise = null');
const end = app.indexOf('function renderPracHistory(){', start);
assert(start >= 0 && end > start);
const store = new Map();
let calls = 0, alerts = [];
const ctx = {
  studentId: 'GOC-S-001', pracHistCache: [],
  localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
  GOC: { api: {
    recordPractice: async () => { if (++calls === 1) throw new Error('offline'); return { runs: [{ subject: 'Physics', review: [{}], ts: 1 }] }; },
    listPractice: async () => ({ runs: [{ subject: 'Physics', review: [{}], ts: 1 }] })
  } },
  toast: s => alerts.push(s), writePracCache: () => {}, loadPracHistory: () => [], renderPracHistory: () => {},
  Promise, JSON, Object, Array, Date
};
vm.createContext(ctx); vm.runInContext(app.slice(start, end), ctx);
(async () => {
  await ctx.savePracResult({ subject: 'Physics', review: [{ given: 0 }] });
  assert.strictEqual(calls, 1); assert.strictEqual(ctx.pracPendingRead(ctx.studentId).length, 1);
  assert(alerts.some(x => /retry/.test(x)));
  await ctx.refreshPracHistory();
  assert.strictEqual(calls, 2); assert.strictEqual(ctx.pracPendingRead(ctx.studentId).length, 0);
  assert.strictEqual(ctx.pracHistCache.length, 1);
  console.log('Practice retry queue survives a failed upload and clears after confirmation.');
})().catch(e => { console.error(e.stack); process.exit(1); });
