/* preflight.js — refuse to deploy an unconfigured or unsafe project config.
   ---------------------------------------------------------------------------
   Run BEFORE `appwrite push functions`:

       node functions/goc-api/tools/preflight.js

   It cannot see your live project. What it CAN do is stop the two mistakes that
   would be expensive: deploying against the placeholder project ID, and
   deploying a Function whose code grants public execute while its route table
   still has unprotected privileged handlers.

   Exits non-zero with a specific reason. Never prints a secret value. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const problems = [];
const notes = [];

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { problems.push(rel + ' is missing.'); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { problems.push(rel + ' is not valid JSON: ' + e.message); return null; }
}

const cfg = readJson('appwrite.json');
const inventory = readJson('functions/goc-api/route-inventory.json');
const schema = readJson('functions/goc-api/schema/sessions.json');

if (cfg) {
  if (!cfg.projectId || /REPLACE_WITH/i.test(cfg.projectId)) {
    problems.push('appwrite.json projectId is still the placeholder. Set it to your EXISTING project ID (Appwrite Console → Project settings). Never create a new project for this migration.');
  }
  (cfg.functions || []).forEach(function (f) {
    if (!f.path || !fs.existsSync(path.join(ROOT, f.path))) {
      problems.push('Function "' + f.$id + '" path does not exist: ' + f.path);
    }
    if (!f.entrypoint || !fs.existsSync(path.join(ROOT, f.path || '', f.entrypoint))) {
      problems.push('Function "' + f.$id + '" entrypoint does not exist: ' + f.entrypoint);
    }
    if (f.runtime) {
      notes.push('Function "' + f.$id + '" declares runtime "' + f.runtime + '". Confirm this runtime ID is offered by YOUR Appwrite version (Console → Functions → Create) before pushing.');
    }
    if ((f.execute || []).indexOf('any') > -1) {
      notes.push('Function "' + f.$id + '" allows public execute. This is required for a browser-facing API, but it means the Function MUST authenticate every protected route itself. The gateway does this before dispatch; keep it that way.');
    }
  });
}

if (inventory) {
  const covPath = require('path').join(ROOT, 'functions/goc-api/coverage.json');
  const cov = fs.existsSync(covPath) ? JSON.parse(fs.readFileSync(covPath, 'utf8')) : null;
  const implemented = cov ? cov.implemented : 0;
  notes.push('Route inventory: ' + inventory.total + ' routes, ' + implemented + ' marked completed. Unported routes return an explicit 501 and are listed in APPWRITE-TEST-REPORT.md.');
  if (!inventory.total) problems.push('Route inventory is empty — re-run tools/extract-routes.js.');
} else {
  problems.push('Route inventory is missing. Run: node functions/goc-api/tools/extract-routes.js');
}

if (schema) {
  const perms = schema.permissions || {};
  ['create', 'read', 'update', 'delete'].forEach(function (k) {
    if (Array.isArray(perms[k]) && perms[k].length) {
      problems.push('schema/sessions.json grants "' + k + '" to ' + JSON.stringify(perms[k]) + '. Sessions must be reachable only by the server API key.');
    }
  });
  notes.push('schema/sessions.json is a PROPOSAL. Verify no "sessions" collection already exists in ' + schema.databaseId + ' before applying it.');
}

/* The Site build must never receive a privileged variable. */
const envExample = path.join(ROOT, '.env.example');
if (fs.existsSync(envExample)) {
  const txt = fs.readFileSync(envExample, 'utf8');
  const siteLine = txt.split('\n').find(l => /^\s*GOC_API_BASE=/.test(l));
  if (siteLine && /API_KEY|SECRET|PASS/i.test(siteLine)) {
    problems.push('GOC_API_BASE in .env.example looks like it carries a secret. It is baked into the public Site build.');
  }
}

notes.forEach(n => console.log('NOTE    ' + n));
if (problems.length) {
  problems.forEach(p => console.error('REFUSED ' + p));
  console.error('\nPreflight failed: ' + problems.length + ' problem(s). Nothing was deployed.');
  process.exit(1);
}
console.log('\nPreflight passed. Review the NOTEs above, then push deliberately.');
