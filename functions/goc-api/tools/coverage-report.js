/* coverage-report.js — derive migration coverage from the ACTUAL router.
   ---------------------------------------------------------------------------
   Instantiates the gateway with stub dependencies (no Appwrite, no network) and
   asks the router which inventoried routes have a registered handler. Writes
   functions/goc-api/coverage.json and prints a per-family summary.

       node functions/goc-api/tools/coverage-report.js

   This is the honest coverage number: it cannot claim a route is migrated
   unless a handler is actually registered for its exact method + regex. */
'use strict';
const fs = require('fs');
const path = require('path');
const gateway = require('../src/index.js');
const config = require('../src/config.js');

const core = require('../../../js/goc-core.js');
const app = gateway.createHandler({
  cfg: config.load({}),
  core,
  sessions: null,
  readState: async () => ({}),
  log: function () {}
});

const rows = app.router.coverage();
const byFamily = {};
rows.forEach(function (r) {
  byFamily[r.family] = byFamily[r.family] || { total: 0, implemented: 0 };
  byFamily[r.family].total++;
  if (r.status === 'implemented') byFamily[r.family].implemented++;
});

const implemented = rows.filter(r => r.status === 'implemented').length;
const report = {
  generatedBy: 'functions/goc-api/tools/coverage-report.js',
  total: rows.length,
  implemented,
  notStarted: rows.length - implemented,
  percent: Number(((implemented / rows.length) * 100).toFixed(1)),
  byFamily,
  routes: rows
};

fs.writeFileSync(path.resolve(__dirname, '..', 'coverage.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Route coverage: ' + implemented + '/' + rows.length + ' (' + report.percent + '%)');
Object.keys(byFamily).sort().forEach(function (f) {
  const v = byFamily[f];
  console.log('  ' + (v.implemented ? 'partial ' : 'pending ') + f + '  ' + v.implemented + '/' + v.total);
});
console.log('\nWrote functions/goc-api/coverage.json');
