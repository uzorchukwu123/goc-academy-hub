/* test-jamb-dashboard.js — Stage 1: JAMB discoverability.

   Proves the dashboard JAMB card and the Study JAMB tile reflect the SAME
   Web Test catalogue the server builds for the student — nothing more:
     1. a listed (ready) sitting is shown with its real size/clock/papers and
        a Sit button that starts through wtConfirmStart (the Web Test start
        route, which re-checks the bank-depth gate server-side);
     2. a sitting the server did not list (bank not deep enough in every
        subject of the combination) shows the honest readiness explanation
        and offers no start;
     3. a locked (tier) sitting is explained and cannot be started here;
     4. the dashboard's "Waiting for you" painter feeds the JAMB card from
        the same catalogue read, and a failed read degrades honestly;
     5. the server gate itself is untouched (jambOffered + start-route 403).
   Runs the real functions from js/app.js against stubs.
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

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
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

head('entry points exist');
ok('the dashboard carries a JAMB / UTME card painted from the catalogue',
  /<div class="section-t">JAMB \/ UTME<\/div>/.test(index) && /id="dashJamb"/.test(index));
ok('the Study tools grid carries a JAMB CBT tile', /onclick="openJambTest\(\)"[\s\S]{0,400}?JAMB CBT/.test(index));
ok('openJambTest, dashPaintJamb and dashJambSit are defined',
  /function openJambTest\(\)/.test(app) && /function dashPaintJamb\(/.test(app) && /function dashJambSit\(/.test(app));
ok('the dashboard start goes through the Web Test instructions/start route',
  /function dashJambSit\(btn\)\{\s*if\(dashJambTest && !dashJambTest\.locked\) wtConfirmStart\(dashJambTest, btn\)/.test(app));
ok('no dashboard code calls the start API directly (no gate bypass)',
  !/dashJamb[\s\S]{0,900}?GOC\.api\.startTest/.test(app.slice(app.indexOf('function dashPaintJamb'), app.indexOf('function dashPaintNext'))));

head('the server readiness gate is untouched');
ok('the catalogue still lists JAMB only when jambOffered passes',
  /if \(jTotal && core\.jambOffered\(allQuestions, subs, db\.settings\.jambReadyMin\)\)/.test(server));
ok('the start route still refuses an unready sitting',
  /if \(!core\.jambOffered\(allQuestions, subs, db\.settings\.jambReadyMin\)\) \{\s*return errJson\(res, 403/.test(server));
ok('the readiness bar still defaults to 20 and clamps to 1..40',
  /JAMB_READY_DEFAULT = 20/.test(core) && /clampJambReadyMin/.test(core));

/* ---- run the real painters against stubs ---- */
function fakeEl() { return { innerHTML: '' }; }
var els = { dashJamb: fakeEl(), dashNext: fakeEl() };
var confirmed = [], webTestOpens = 0;
var catalogueRows = [];
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
  wtMinutes: function (sec) { return Math.round((Number(sec) || 0) / 60) + ' min'; },
  wtPapersLine: function (papers) { return papers.map(function (p) { return p.subject + ' ' + p.questions; }).join(' · '); },
  wtConfirmStart: function (t, btn) { confirmed.push(t); },
  openWebTest: function () { webTestOpens++; },
  GOC: { api: { listMyTests: function () { return Promise.resolve({ tests: catalogueRows }); } } },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var dashJambTest = null;\n'
  + grab('dashSet') + '\n' + grab('dashRow') + '\n'
  + grab('dashPaintJamb') + '\n' + grab('dashJambSit') + '\n' + grab('openJambTest') + '\n'
  + grab('dashPaintNext'), ctx);

var JAMB_ROW = { section: 'jamb', subject: 'All subjects', questions: 180, durationSec: 7200,
  papers: [{ subject: 'Use of English', questions: 60 }, { subject: 'Physics', questions: 40 },
           { subject: 'Chemistry', questions: 40 }, { subject: 'Mathematics', questions: 40 }],
  repeatable: true, attempts: 0 };
var OBJ_ROW = { section: 'objective', subject: 'All subjects', questions: 180, durationSec: 5400 };

function tick() { return Promise.resolve().then(function () {}).then(function () {}); }

head('JAMB available');
sandbox.dashPaintJamb([OBJ_ROW, JAMB_ROW]);
var h = els.dashJamb.innerHTML;
ok('the card names the sitting', /JAMB-oriented sitting/.test(h), h);
ok('it shows the real size, clock and per-paper counts',
  /180 questions/.test(h) && /120 min/.test(h) && /Use of English 60/.test(h) && /Physics 40/.test(h), h);
ok('it offers Sit it through dashJambSit', /onclick="dashJambSit\(this\)">Sit it<\/button>/.test(h), h);
sandbox.dashJambSit(null);
ok('Sit starts through wtConfirmStart with the catalogue row', confirmed.length === 1 && confirmed[0] === JAMB_ROW);
sandbox.openJambTest();
ok('the Study/dashboard entry starts the listed sitting directly too', confirmed.length === 2 && confirmed[1] === JAMB_ROW);

head('JAMB available, sat before');
sandbox.dashPaintJamb([Object.assign({}, JAMB_ROW, { attempts: 2 })]);
h = els.dashJamb.innerHTML;
ok('it says it can be sat again', /sat 2 times/.test(h) && />Sit again<\/button>/.test(h), h);

head('JAMB unavailable (bank short in at least one subject)');
sandbox.dashPaintJamb([OBJ_ROW]);
h = els.dashJamb.innerHTML;
ok('the card explains the readiness position honestly', /opens once its question bank is ready in all of your subjects/.test(h), h);
ok('it offers no start button', !/dashJambSit/.test(h), h);
confirmed.length = 0; webTestOpens = 0;
sandbox.openJambTest();
ok('the entry point lands on the Web Test screen instead of starting', webTestOpens === 1 && confirmed.length === 0);

head('different combination, still short');
sandbox.dashPaintJamb([{ section: 'theory', subject: 'Biology', questions: 5, durationSec: 0 }]);
ok('a combination with no listed sitting gets the same honest card',
  /question bank is ready in all of your subjects/.test(els.dashJamb.innerHTML));

head('locked for this tier');
sandbox.dashPaintJamb([Object.assign({}, JAMB_ROW, { locked: true })]);
h = els.dashJamb.innerHTML;
ok('the locked sitting is explained, with a disabled button',
  /for GOC students/.test(h) && /<button class="wt-start locked" disabled>/.test(h), h);
confirmed.length = 0; webTestOpens = 0;
sandbox.dashJambSit(null);
ok('a locked sitting is never started from the dashboard', confirmed.length === 0 && webTestOpens === 1);

head('catalogue read failure');
sandbox.dashPaintJamb(null);
ok('a failed read degrades to an honest unavailable line',
  /not available right now/.test(els.dashJamb.innerHTML) && sandbox.dashJambTest === null);

head('the dashboard painter feeds both cards from one catalogue');
catalogueRows = [OBJ_ROW, JAMB_ROW];
sandbox.dashPaintNext();
tick().then(function () {
  ok('"Waiting for you" still lists the Objective sitting', /Objective sitting/.test(els.dashNext.innerHTML), els.dashNext.innerHTML);
  ok('and the JAMB card is painted from the same read', /JAMB-oriented sitting/.test(els.dashJamb.innerHTML), els.dashJamb.innerHTML);
  catalogueRows = [OBJ_ROW];
  sandbox.dashPaintNext();
  return tick();
}).then(function () {
  ok('when the sitting is withdrawn, the JAMB card returns to the honest line',
    /question bank is ready in all of your subjects/.test(els.dashJamb.innerHTML), els.dashJamb.innerHTML);
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'JAMB dashboard: all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')');
  process.exit(1);
});
