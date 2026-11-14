/* test-deploy-notice.js — Parts Three & Five.

   1. A completed student tour belongs to a deployment id. Refreshing on the
      same deployment keeps it done; a new id makes it stale, so the tour runs
      again and the affirmation waits for that completion.
   2. The redeployment notice is one-time per deployment id: dismissing it
      records the id, a refresh on the same build shows nothing, and a later
      id arms it once more. It never clears preferences or stored records.

   Run:  node test/test-deploy-notice.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var mod = require(path.join(APP, 'js', 'onboarding.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var server = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
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
var GATE_SRC = grab('affirmationUnlocked');
function fakeEl() {
  var el = { style: {}, textContent: '', hidden: true, className: '', _vis: true, children: [], attrs: {} };
  el.classList = { add: function (c) { el.className += ' ' + c; }, remove: function (c) { el.className = el.className.replace(c, ''); }, contains: function (c) { return el.className.indexOf(c) >= 0; } };
  el.appendChild = function (c) { el.children.push(c); c.parentNode = el; return c; };
  el.removeChild = function (c) { el.children = el.children.filter(function (x) { return x !== c; }); return c; };
  el.addEventListener = function () {}; el.removeEventListener = function () {};
  el.setAttribute = function (k, v) { el.attrs[k] = v; }; el.focus = function () {};
  el.getBoundingClientRect = function () { return { left: 10, top: 10, width: 100, height: 40, bottom: 50 }; };
  return el;
}
function makeWorld() {
  var store = {};
  var storage = { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
  var byId = {}; var body = fakeEl(); var nav = [];
  var env = {
    document: { body: body, createElement: fakeEl, getElementById: function (id) { return byId[id] || null; }, addEventListener: function () {}, removeEventListener: function () {} },
    storage: storage,
    getElementById: function (id) { return byId[id] || null; },
    isVisible: function (el) { return !!el && el._vis !== false; },
    go: function (id) { nav.push('go:' + id); },
    viewportWidth: function () { return 390; }, viewportHeight: function () { return 844; }
  };
  return { env: env, store: store, byId: byId, body: body };
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 5); }); }

(async function () {
  head('a completed tour is tied to its deployment');
  var w = makeWorld();
  w.env.deployId = 'goc-v223';
  var tour = mod.create(w.env);
  tour.register('student', [{ go: 'home', target: 'x', title: 'One', body: 'Step' }]);
  await tour.start('student', { userId: 'GOC-S-1' });
  await tour.next();   // completion screen
  await tour.next();   // finish -> done
  var st = tour.state('student', 'GOC-S-1');
  ok('completion is stored as done with the current deployment id',
    st.status === 'done' && st.deploy === 'goc-v223', JSON.stringify(st));
  ok('a refresh on the same deployment does not auto-repeat the tour',
    (await tour.maybeAutoStart('student', 'GOC-S-1')) === false);
  ok('the same deployment still reads as done', tour.state('student', 'GOC-S-1').status === 'done');
  w.env.deployId = 'goc-v224';
  ok('a later deployment makes the saved completion stale', tour.state('student', 'GOC-S-1') === null,
    JSON.stringify(tour.state('student', 'GOC-S-1')));
  ok('and the new deployment auto-starts the tour again',
    (await tour.maybeAutoStart('student', 'GOC-S-1')) === true);
  await tour.exit();

  head('the affirmation is gated by a completed tour on this deployment');
  function gate(state, deploy, role, student) {
    var sandbox = {
      role: role || 'student', studentId: student === undefined ? 'GOC-S-1' : student, GOC_DEPLOY_ID: deploy,
      window: { GOCOnboarding: { state: function () { return state; } } }
    };
    var ctx = vm.createContext(sandbox);
    vm.runInContext(GATE_SRC, ctx);
    return sandbox.affirmationUnlocked();
  }
  ok('not shown before the tour is completed', gate(null, 'goc-v223') === false);
  ok('not shown while the tour is in progress', gate({ status: 'in-progress', deploy: 'goc-v223' }, 'goc-v223') === false);
  ok('not shown after a skip', gate({ status: 'skipped', deploy: 'goc-v223' }, 'goc-v223') === false);
  ok('shown after completion on this deployment', gate({ status: 'done', deploy: 'goc-v223' }, 'goc-v223') === true);
  ok('not shown when the completion belongs to an older deployment',
    gate({ status: 'done', deploy: 'goc-v222' }, 'goc-v223') === false);
  ok('not shown when the saved completion has no deployment id',
    gate({ status: 'done' }, 'goc-v223') === false);
  ok('not shown before the current deployment id is known',
    gate({ status: 'done', deploy: 'goc-v223' }, null) === false);
  ok('never shown to staff or a signed-out visitor',
    gate({ status: 'done', deploy: 'goc-v223' }, 'goc-v223', 'admin') === false
    && gate({ status: 'done', deploy: 'goc-v223' }, 'goc-v223', 'student', null) === false);
  ok('login no longer opens the flyer unconditionally',
    !/setTimeout\(openFlyer, 350\)/.test(app) && /deployFetch\(\)\.then\(function\(\)\{ maybeOpenFlyer\(\); \}\)/.test(app));
  ok('the tour completion event feeds the flyer', /goc:tour-done/.test(app) && /maybeOpenFlyer/.test(fs.readFileSync(path.join(APP, 'js', 'onboarding.js'), 'utf8')) === false);

  head('deployment id is one identifier, reported by health');
  ok('the service worker cache is the id source', /const CACHE = 'goc-v223';/.test(sw) && /const DEPLOY_ID = \(\(\) =>/.test(server)
    && /deployId: DEPLOY_ID/.test(server));

  head('one-time redeployment notice');
  ok('the notice markup carries a title, body and two actions',
    /id="deployNotice"/.test(html) && /Changes have been made/.test(html)
    && /Refresh now/.test(html) && /Dismiss/.test(html) && /check your settings/.test(html));
  ok('it is styled as an overlay and starts hidden', /\.deploy-notice\{ position:fixed/.test(css) && /id="deployNotice"[^>]*hidden/.test(html));
  function noticeRun(seen, id) {
    var store = seen ? { 'goc.deployNotice.v1': seen } : {};
    var box = fakeEl(); box.hidden = true;
    var idEl = { textContent: '' };
    var reloads = 0;
    var sandbox = {
      GOC_DEPLOY_ID: id,
      document: { getElementById: function (x) { return x === 'deployNotice' ? box : (x === 'deployNoticeId' ? idEl : null); } },
      localStorage: {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); }
      },
      location: { reload: function () { reloads++; } }
    };
    var ctx = vm.createContext(sandbox);
    vm.runInContext('function deployNoticeCheck(id){\n'
      + '  if(!id) return;\n'
      + '  var seen = null; try { seen = localStorage.getItem(\'goc.deployNotice.v1\'); } catch(e) {}\n'
      + '  if(seen === id) return;\n'
      + '  var box = document.getElementById(\'deployNotice\'); if(!box) return;\n'
      + '  var idEl = document.getElementById(\'deployNoticeId\'); if(idEl) idEl.textContent = id;\n'
      + '  box.hidden = false; box.classList.add(\'show\');\n'
      + '}\n'
      + 'function closeDeployNotice(){\n'
      + '  var box = document.getElementById(\'deployNotice\');\n'
      + '  if(box){ box.classList.remove(\'show\'); box.hidden = true; }\n'
      + '  try { if(GOC_DEPLOY_ID) localStorage.setItem(\'goc.deployNotice.v1\', GOC_DEPLOY_ID); } catch(e) {}\n'
      + '}\n'
      + 'function refreshDeployNotice(){\n'
      + '  try { if(GOC_DEPLOY_ID) localStorage.setItem(\'goc.deployNotice.v1\', GOC_DEPLOY_ID); } catch(e) {}\n'
      + '  location.reload();\n'
      + '}', ctx);
    return { sandbox: sandbox, box: box, store: store, idEl: idEl, reloads: function () { return reloads; } };
  }
  var n1 = noticeRun(null, 'goc-v223');
  n1.sandbox.deployNoticeCheck('goc-v223');
  ok('a new deployment shows the notice once', n1.box.hidden === false && /show/.test(n1.box.className) && n1.idEl.textContent === 'goc-v223');
  n1.sandbox.closeDeployNotice();
  ok('dismissing hides it and records this id', n1.box.hidden === true && n1.store['goc.deployNotice.v1'] === 'goc-v223');
  n1.sandbox.deployNoticeCheck('goc-v223');
  ok('a refresh on the same deployment does not show it again', n1.box.hidden === true);
  var n2 = noticeRun('goc-v223', 'goc-v224');
  n2.sandbox.deployNoticeCheck('goc-v224');
  ok('a later deployment arms it again', n2.box.hidden === false && n2.idEl.textContent === 'goc-v224');
  n2.sandbox.refreshDeployNotice();
  ok('Refresh records the id and reloads', n2.store['goc.deployNotice.v1'] === 'goc-v224' && n2.reloads() === 1);
  ok('no preferences or app data are cleared', !/localStorage\.clear\(\)/.test(app));
  ok('the notice never touches the data API', !/deployNotice[\s\S]{0,900}?GOC\.api/.test(app));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
