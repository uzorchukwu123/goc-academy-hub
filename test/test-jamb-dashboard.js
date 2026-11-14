/* test-jamb-dashboard.js — Part Two: the JAMB-oriented session is retired from
   the student website. Nothing on the dashboard or Study hub may start it, and
   no dead painter/entry point may linger. The server-side sitting, its
   readiness gate and the JAMB question bank are deliberately untouched: only
   the website surface is gone, no data is deleted.
   Run:  node test/test-jamb-dashboard.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var server = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var core = fs.readFileSync(path.join(APP, 'js', 'goc-core.js'), 'utf8');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}

head('the JAMB sitting is gone from the website');
ok('no dashboard JAMB card', !/id="dashJamb"/.test(index) && !/<div class="section-t">JAMB \/ UTME<\/div>/.test(index));
ok('no JAMB CBT Study tile', !/onclick="openJambTest\(\)"/.test(index) && !/>JAMB CBT</.test(index));
['dashPaintJamb', 'dashJambSit', 'openJambTest', 'dashPaintUp', 'dashPaintSubjects'].forEach(function (n) {
  ok(n + ' is no longer defined', app.indexOf('function ' + n + '(') < 0);
});
ok('no call site remains in renderDash',
  !/dashPaintJamb\(|dashPaintUp\(|dashPaintSubjects\(/.test(grab('renderDash')));

head('the dashboard still lists legitimate papers, never the retired sitting');
function fakeEl() { return { innerHTML: '' }; }
var els = { dashNext: fakeEl() };
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (x) { return String(x == null ? '' : x); },
  wtMinutes: function (sec) { return Math.round((Number(sec) || 0) / 60) + ' min'; },
  GOC: { api: { listMyTests: function () {
    return Promise.resolve({ tests: [
      { section: 'objective', subject: 'All subjects', questions: 180, durationSec: 5400 },
      { section: 'theory', subject: 'Physics', questions: 4, durationSec: 0 },
      { section: 'jamb', subject: 'All subjects', questions: 180, durationSec: 7200 }
    ] });
  } } },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('dashSet') + '\n' + grab('dashRow') + '\n' + grab('dashPaintNext'), ctx);
sandbox.dashPaintNext();
Promise.resolve().then(function () { return Promise.resolve(); }).then(function () {
  var h = els.dashNext.innerHTML;
  ok('the Objective sitting is still offered', /Objective sitting/.test(h), h);
  ok('the Theory papers are still offered', /Theory papers/.test(h), h);
  ok('the retired JAMB row is not rendered', !/JAMB/i.test(h) && !/dashJambSit/.test(h), h);

  head('the server sitting and its safety gate are untouched');
  ok('the catalogue still gates JAMB behind jambOffered',
    /if \(jTotal && core\.jambOffered\(allQuestions, subs, db\.settings\.jambReadyMin\)\)/.test(server));
  ok('the start route still refuses an unready sitting',
    /if \(!core\.jambOffered\(allQuestions, subs, db\.settings\.jambReadyMin\)\) \{\s*return errJson\(res, 403/.test(server));
  ok('the readiness bar still defaults to 20 and clamps to 1..40',
    /JAMB_READY_DEFAULT = 20/.test(core) && /clampJambReadyMin/.test(core));
  ok('the JAMB question section is still in the bank contract', /\bjamb\b/.test(core) && /\bjamb\b/.test(server));
  ok('the results export still knows the JAMB columns', /jamb/i.test(fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8')));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')');
  process.exit(1);
});
