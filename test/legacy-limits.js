/* legacy-limits.js — test helper. Phase 3B opened practice and the JAMB-oriented
   Web Test to Open students, so the live tier table no longer limits them. The
   limit MACHINERY (daily cap, run cap, history trim, year lock, Web Test lock)
   is still in the code and still needs proof, so these helpers rewrite a COPY of
   goc-core.js with the old Open numbers: 20 a day, 10 a run, history of 5,
   latest past-paper year only, and (opt-in) no JAMB mock. Nothing here touches
   the real file. */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');

function patch(src, opts) {
  opts = opts || {};
  var i = src.indexOf('var TIER_LIMITS = {'), j = src.indexOf('goc: {', i);
  if (i < 0 || j < 0) throw new Error('legacy-limits: cannot find the TIER_LIMITS table');
  var block = src.slice(i, j)
    .replace(/practicePerDay: null/, 'practicePerDay: 20')
    .replace(/practiceRunMax: null/, 'practiceRunMax: 10')
    .replace(/practiceHistory: 30/, 'practiceHistory: 5')
    .replace(/pastYears: 'all'/, "pastYears: 'latest'");
  var out = src.slice(0, i) + block + src.slice(j);
  if (opts.jambMock === false) out = out.replace('jambMock: true, webTestObjective: false', 'jambMock: false, webTestObjective: false');
  if (out === src) throw new Error('legacy-limits: nothing was patched');
  return out;
}
/* Patch the core inside a test sandbox (the server there loads it). */
function patchSandbox(sandbox, opts) {
  var f = path.join(sandbox, 'js', 'goc-core.js');
  fs.writeFileSync(f, patch(fs.readFileSync(f, 'utf8'), opts));
}
/* A patched core as a module, for the pure-rule tests. */
function loadCore(appDir, opts) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-legacy-core-'));
  var f = path.join(tmp, 'goc-core.js');
  fs.writeFileSync(f, patch(fs.readFileSync(path.join(appDir, 'js', 'goc-core.js'), 'utf8'), opts));
  var m = require(f);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  return m;
}
module.exports = { patch: patch, patchSandbox: patchSandbox, loadCore: loadCore };
