/* extract-routes.js — migration tooling (read-only).
   ---------------------------------------------------------------------------
   Reads the existing OneBit route table out of server/server.js and writes a
   machine-readable inventory. This is how the migration proves that EVERY
   existing route is accounted for, including the families that were absent from
   the original migration plan (/api/rounds, /api/managers, /api/flags, ...).

   It never contacts Appwrite, never reads production data and never modifies
   server/server.js. Run it again after any server route change:

     node functions/goc-api/tools/extract-routes.js

   Output: functions/goc-api/route-inventory.json */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER = path.join(ROOT, 'server', 'server.js');
const OUT = path.resolve(__dirname, '..', 'route-inventory.json');

const src = fs.readFileSync(SERVER, 'utf8');

/* The route table is a flat array of object literals. Each entry declares
   method, a path RegExp, an auth tier (`need`) and optionally a capability. */
/* Scan each route entry properly instead of using one lazy regex.
   A lazy `path: /^...(/flags)?,` pattern silently merges adjacent entries when a
   path itself contains "/" or a capture group, and it drops entries that carry
   RegExp flags such as /^...$/i. Both failure modes produce a WRONG inventory
   (the first audit reported 240), so the path RegExp is delimited by scanning
   for the closing unescaped "/" outside any character class. */
const HEAD = /\{\s*method:\s*'([A-Z]+)',\s*path:\s*\//g;

function scanRegexLiteral(text, start) {
  let inClass = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === ']') { inClass = false; continue; }
    if (c === '/' && !inClass) {
      let j = i + 1;
      while (j < text.length && /[a-z]/.test(text[j])) j++;
      return { body: text.slice(start, i), flags: text.slice(i + 1, j), end: j };
    }
  }
  return null;
}

const routes = [];
let m;
while ((m = HEAD.exec(src)) !== null) {
  const method = m[1];
  const lit = scanRegexLiteral(src, m.index + m[0].length);
  if (!lit) continue;
  const rawPath = lit.body.replace(/^\^/, '');
  const flags = lit.flags || '';
  const tail = src.slice(lit.end, lit.end + 260);
  const needMatch = tail.match(/^,\s*need:\s*('[^']*'|null)/);
  if (!needMatch) continue;
  const need = needMatch[1].replace(/^'|'$/g, '');
  const capMatch = tail.match(/cap:\s*'([^']+)'/);
  const line = src.slice(0, m.index).split("\n").length;
  const path_ = rawPath.replace(/\\\//g, '/');
  const family = (function () {
    const clean = path_.replace(/^\//, '').split('$')[0];
    const parts = clean.split('/');
    if (parts[0] !== 'api') return parts[0];
    if (parts[1] === 'free2027') return 'api/free2027';
    if (parts[1] === 'admin') return 'api/admin';
    if (parts[1] === 'tutor') return 'api/tutor';
    return 'api/' + (parts[1] || '');
  })();
  routes.push({
    method,
    path: path_,
    /* The Function router compiles this EXACT RegExp, with the same flags.
       Translating to an Express-style pattern would be lossy: some groups are
       capture params (([A-Za-z0-9._-]+)) while others are action alternations
       ((reply|close)), and existing handlers read them positionally as
       params[0], params[1]. Preserving source+flags keeps routing and capture
       semantics identical to the OneBit server. */
    regex: { source: '^' + lit.body.replace(/^\^/, ''), flags },
    /* Human-readable only. Never used for matching. */
    displayPath: path_.replace(/\$$/, ''),
    caseInsensitive: flags.indexOf('i') > -1,
    authTier: need === 'null' ? 'public' : need,
    capability: capMatch ? capMatch[1] : null,
    family,
    serverLine: line
    /* Migration status is deliberately NOT stored here: it is not a property of
       the source. tools/coverage-report.js derives it from the live router. */
  });
}

if (!routes.length) {
  console.error('No routes extracted — server/server.js route table shape changed. Refusing to write an empty inventory.');
  process.exit(1);
}

const byTier = {}, byMethod = {}, byFamily = {};
routes.forEach(function (r) {
  byTier[r.authTier] = (byTier[r.authTier] || 0) + 1;
  byMethod[r.method] = (byMethod[r.method] || 0) + 1;
  byFamily[r.family] = (byFamily[r.family] || 0) + 1;
});

const inventory = {
  generatedBy: 'functions/goc-api/tools/extract-routes.js',
  source: 'server/server.js',
  note: 'Generated from the OneBit route table. Do not hand-edit; re-run the extractor.',
  total: routes.length,
  counts: { byAuthTier: byTier, byMethod: byMethod, byFamily: byFamily },
  capabilities: Array.from(new Set(routes.map(r => r.capability).filter(Boolean))).sort(),
  routes
};

fs.writeFileSync(OUT, JSON.stringify(inventory, null, 2) + '\n');
console.log('Wrote ' + path.relative(ROOT, OUT));
console.log('  routes:       ' + inventory.total);
console.log('  auth tiers:   ' + Object.keys(byTier).length);
console.log('  capabilities: ' + inventory.capabilities.length);
console.log('  families:     ' + Object.keys(byFamily).length);
