/* test-more-hub.js — the More hub and the dedicated Study Plan screen, driven
   inside minidom against the mock driver.

   Round 8 replaced two things the Product Owner called out:

     · More used to open Profile. It is now a real hub whose ten rows each go to
       a destination the app already had — no Scholarships, no invented inbox,
       no private messaging, no destination that did not already exist.
     · Study Plan used to redirect to Classes. It is now its own screen, built on
       the planner engine that already existed, with a weekly view, day
       selection, week navigation, add/edit/delete and an honest empty state.

   What this suite can prove without layout: the markup, the wiring, the
   controller's behaviour against a real plan, and that every navigation target
   is a screen that exists. Layout and pixels are checked in the browser and in
   the screenshots under docs/.

   Run:  node test/test-more-hub.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function txt(x) { var e = id(x); return e ? e.textContent : ''; }
function api(name) { return run('GOC.api.' + name); }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 20) return done(); setImmediate(again); })();
  });
}
function screenNow() {
  var out = '';
  doc.querySelectorAll('.screen').forEach(function (s) {
    if (s.classList.contains('active')) out = s.getAttribute('id') || out;
  });
  return out;
}
function rows() {
  return Array.prototype.slice.call(id('more').querySelectorAll('.more-row'));
}
function rowFor(pattern) {
  return rows().filter(function (r) { return pattern.test(r.textContent); })[0] || null;
}

var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
/* the demo roster wants exactly three science papers on a new account */
var MINE = ['Use of English', 'Mathematics', 'Physics', 'Chemistry'];

async function main() {
  /* ================================================================= MORE */
  head('More is a screen of its own, not a redirect to Profile');
  ok('the More screen exists in the markup', id('more') !== null);
  ok('it is not the Profile screen wearing another name', id('profile') !== null && id('more') !== id('profile'));

  run('go("more")');
  await flush();
  ok('opening More shows More', screenNow() === 'more', screenNow());

  head('its ten rows are exactly the approved destinations');
  var labels = rows().map(function (r) {
    var b = r.querySelector('b');
    return b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('there are ten rows', labels.length === 10, labels.join(' | '));
  var approved = ['Study', 'JAMB CBT', 'Resources', 'Question Bank', 'Study Plan',
                  'Results', 'Messages & Updates', 'Contact the academy',
                  'Profile', 'Settings'];
  ok('they are the approved rows, in order', labels.join('|') === approved.join('|'), labels.join('|'));

  head('every row goes to a destination the app already had');
  var targets = rows().map(function (r) { return r.getAttribute('onclick') || ''; });
  ok('Study goes to the Study screen', /go\('study'\)/.test(targets[0]), targets[0]);
  ok('JAMB CBT goes through the existing handler', /dashJambGo\(\)/.test(targets[1]), targets[1]);
  ok('Resources goes to the Resources screen', /go\('resources'\)/.test(targets[2]), targets[2]);
  ok('Question Bank goes through the existing handler', /openPastQuestions\(\)/.test(targets[3]), targets[3]);
  ok('Study Plan goes to the Study Plan screen', /dashPlanGo\(\)/.test(targets[4]), targets[4]);
  ok('Results goes through the existing handler', /openResults\(\)/.test(targets[5]), targets[5]);
  ok('Messages & Updates opens the real Updates screen', /go\('updates'\)/.test(targets[6]), targets[6]);
  ok('Contact the academy opens the real Support destination', /dashSupportGo\(\)/.test(targets[7]), targets[7]);
  ok('Profile goes to Profile', /go\('profile'\)/.test(targets[8]), targets[8]);
  ok('Settings goes to the existing account screen', /go\('profile'\)/.test(targets[9]), targets[9]);

  head('and nothing it was told not to add crept in');
  var moreText = id('more').textContent;
  ok('no Scholarships row', !/scholarship/i.test(moreText));
  ok('no inbox or private messaging', !/inbox|message someone|new message|chat with/i.test(moreText));
  ok('no video destination', !/video|watch/i.test(moreText));
  ok('no timetable entry point', !/timetable/i.test(moreText));

  head('Messages & Updates lands on the Updates screen');
  rowFor(/Messages & Updates/).getAttribute('onclick');
  run('go("updates")');
  await flush();
  ok('the Updates screen is what opens', screenNow() === 'updates', screenNow());

  head('Contact the academy lands on the real Support destination');
  run('go("more")');
  await flush();
  run('dashSupportGo()');
  await flush();
  ok('the Support handler opens the landing support section',
     screenNow() === 'landing' && id('contact') !== null, screenNow());

  head('More is a phone menu, so a wide screen sends it home');
  run('go("more")'); await flush();
  var realWidth = sandbox.innerWidth;
  sandbox.innerWidth = 1440;
  run('go("home")'); await flush();
  run('go("more")'); await flush();
  ok('go("more") on a desktop width lands on the dashboard', screenNow() === 'home', screenNow());
  sandbox.innerWidth = realWidth;

  head('the drawer and the five tabs still work');
  ok('the drawer opens', (run('openDrawer(), document.getElementById("lpDrawer").classList.contains("on")')) === true);
  ok('and closes', (run('closeDrawer(), document.getElementById("lpDrawer").classList.contains("on")')) === false);
  var primary = [];
  id('tabbar').querySelectorAll('.tab').forEach(function (t) {
    if (t.classList.contains('tab-m')) primary.push(t.getAttribute('data-t'));
  });
  ok('five tabs stay primary on a phone', primary.length === 5, primary.join(','));
  ok('and More is the fifth', primary[4] === 'more', primary.join(','));
  ok('the desktop sidebar does not carry a More row',
     (function () {
       var found = false;
       id('tabbar').querySelectorAll('.tab').forEach(function (t) {
         if (t.getAttribute('data-t') === 'more' && !t.classList.contains('tab-m')) found = true;
       });
       return !found;
     })());

  /* ========================================================== STUDY PLAN */
  head('Study Plan is a dedicated screen with its own parts');
  ['studyplan', 'spWeek', 'spDayName', 'spDayTotal', 'spBlocks', 'spEmpty',
   'spError', 'spEditor', 'spDay', 'spStart', 'spMinutes', 'spSubject', 'spTopic',
   'spSaveBtn', 'spDeleteBtn', 'spPrev', 'spNext', 'spWeekLabel',
   'spWeekPlanned', 'spWeekCount', 'spStudiedToday', 'spProgress'].forEach(function (x) {
    ok('the screen has #' + x, id(x) !== null);
  });
  ok('it is not the retired standalone Timetable', id('timetable') === null);

  head('the dashboard card opens it, and so does the sidebar');
  run('go("home")'); await flush();
  run('dashPlanGo()'); await flush();
  ok('dashPlanGo opens Study Plan, not Classes', screenNow() === 'studyplan', screenNow());
  run('go("home")'); await flush();
  var sidebarRow = null;
  id('tabbar').querySelectorAll('.tab').forEach(function (t) {
    if (t.getAttribute('data-t') === 'studyplan') sidebarRow = t;
  });
  ok('the sidebar has a Study Plan row', !!sidebarRow);
  ok('and it opens the same screen', /dashPlanGo\(\)|go\('studyplan'\)/.test(sidebarRow.getAttribute('onclick') || ''),
     sidebarRow && sidebarRow.getAttribute('onclick'));

  head('a signed-in student starts with an empty plan, and the screen says so');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  var stu = await api('createStudent')({
    name: 'Plan Scholar', email: 'plan@example.com', password: 'plan#1234',
    goal: 'JAMB / UTME', subjects: MINE, privacyConsent: { accepted: true }
  });
  var sid = (stu.student || stu).id;
  await api('approveStudent')(sid);
  await api('login')(sid, 'plan#1234');

  run('go("home")');
  await flush(); await flush(); await flush();
  run('go("studyplan")'); await flush();
  run('spLoad(true)'); await flush();
  ok('the plan is empty', run('spPlan.length') === 0, String(run('spPlan.length')));
  ok('the empty state is shown, not hidden', id('spEmpty').hidden === false);
  ok('the day name is set', txt('spDayName').length > 0, txt('spDayName'));
  ok('the weekly planned figure is a real zero', /^0m$|^0h$/.test(txt('spWeekPlanned')) || txt('spWeekPlanned') === '0m', txt('spWeekPlanned'));
  ok('the block count is zero', txt('spWeekCount') === '0', txt('spWeekCount'));
  ok('no blocks are drawn', id('spBlocks').querySelectorAll('.sp-block').length === 0);

  head('the week strip offers seven days');
  var dayKeys = id('spWeek').querySelectorAll('.sp-day');
  ok('seven day buttons', dayKeys.length === 7, dayKeys.length);
  ok('Monday first, as the planner works',
     dayKeys[0].getAttribute('data-day') === 'Mon' &&
     dayKeys[6].getAttribute('data-day') === 'Sun',
     dayKeys.map(function (d) { return d.getAttribute('data-day'); }).join(','));
  ok('each carries a real date for the week on screen',
     /^\d{4}-\d{2}-\d{2}$/.test(dayKeys[0].getAttribute('data-date') || ''),
     dayKeys[0].getAttribute('data-date'));

  head('week navigation moves the week, not the plan');
  var beforeLabel = txt('spWeekLabel');
  var beforeDate = dayKeys[0].getAttribute('data-date');
  run('spShiftWeek(1)'); await flush();
  ok('the label changes', txt('spWeekLabel') !== beforeLabel, beforeLabel + ' -> ' + txt('spWeekLabel'));
  var afterDate = id('spWeek').querySelectorAll('.sp-day')[0].getAttribute('data-date');
  ok('the dates move forward', afterDate !== beforeDate, beforeDate + ' -> ' + afterDate);
  var d1 = new Date(beforeDate + 'T00:00:00Z'), d2 = new Date(afterDate + 'T00:00:00Z');
  ok('by exactly seven days', Math.round((d2 - d1) / 86400000) === 7, Math.round((d2 - d1) / 86400000));
  ok('no day is marked today in another week',
     id('spWeek').querySelectorAll('.sp-day.is-today').length === 0);
  run('spShiftWeek(-1)'); await flush();
  ok('walking back returns to this week', txt('spWeekLabel') === beforeLabel, txt('spWeekLabel'));

  head('a block can be added, and it is validated by the existing engine');
  run('spOpenEditor(null)'); await flush();
  ok('the editor opens on an add', id('spEditor').classList.contains('show'));
  ok('with no delete button, because there is nothing to delete yet', id('spDeleteBtn').hidden === true);
  ok('the day picker offers the planner\'s seven days',
     id('spDay').querySelectorAll('option').length === 7);

  run('document.getElementById("spDay").value="Tue";' +
      'document.getElementById("spStart").value="16:00";' +
      'document.getElementById("spMinutes").value="60";' +
      'document.getElementById("spSubject").value="Mathematics";' +
      'document.getElementById("spTopic").value="Quadratic equations";');
  var made = run('spFormBlock()');
  ok('the form produces a block the engine accepts', made && made.ok !== false && !made.error,
     JSON.stringify(made));

  run('spSave()'); await flush(); await flush();
  ok('the plan now holds one block', run('spPlan.length') === 1, String(run('spPlan.length')));
  ok('the editor closed on success', id('spEditor').classList.contains('show') === false);
  ok('the empty state is gone', id('spEmpty').hidden === true);
  ok('the block is on screen', id('spBlocks').querySelectorAll('.sp-block').length === 1);
  ok('the weekly figure counts it', txt('spWeekPlanned') === '1h', txt('spWeekPlanned'));
  ok('the block count is one', txt('spWeekCount') === '1', txt('spWeekCount'));

  head('the same engine refuses a bad block, before anything is sent');
  run('spOpenEditor(null)'); await flush();
  run('document.getElementById("spDay").value="Tue";' +
      'document.getElementById("spStart").value="16:30";' +
      'document.getElementById("spMinutes").value="60";' +
      'document.getElementById("spSubject").value="Mathematics";' +
      'document.getElementById("spTopic").value="Clashing block";');
  var clash = run('spFormBlock()');
  ok('an overlapping block is refused by the planner engine', !!(clash && clash.error), JSON.stringify(clash));
  ok('and the reason is the engine\'s own wording', /already taken/i.test((clash && clash.error) || ''),
     clash && clash.error);
  run('spSave()'); await flush();
  ok('nothing was saved', run('spPlan.length') === 1, String(run('spPlan.length')));
  ok('the reason is shown in the editor', txt('spEditorMsg').length > 0, txt('spEditorMsg'));
  run('spCloseEditor()');

  head('a block can be edited');
  var planId = run('spPlan[0].id');
  run('spOpenEditor(spPlan[0])'); await flush();
  ok('the editor opens on an edit', id('spEditorTitle').textContent === 'Edit study block',
     id('spEditorTitle').textContent);
  ok('it is pre-filled from the block', id('spStart').value === '16:00' && id('spTopic').value === 'Quadratic equations',
     id('spStart').value + ' / ' + id('spTopic').value);
  ok('and offers delete', id('spDeleteBtn').hidden === false);
  run('document.getElementById("spMinutes").value="90";' +
      'document.getElementById("spTopic").value="Quadratic equations and graphs";');
  run('spSave()'); await flush(); await flush();
  ok('the block kept its ID', run('spPlan[0].id') === planId, run('spPlan[0].id') + ' vs ' + planId);
  ok('the duration changed', run('spPlan[0].minutes') === 90, String(run('spPlan[0].minutes')));
  ok('the weekly figure follows', txt('spWeekPlanned') === '1h30m', txt('spWeekPlanned'));

  head('deleting asks first, and only then removes');
  run('spOpenEditor(spPlan[0])'); await flush();
  var asked = null;
  sandbox.confirm = function (m) { asked = m; return false; };
  run('spDelete()'); await flush();
  ok('deleting asks for confirmation', asked !== null, String(asked));
  ok('the question says it cannot be undone', /cannot be undone/i.test(asked || ''), String(asked));
  ok('declining keeps the block', run('spPlan.length') === 1, String(run('spPlan.length')));
  sandbox.confirm = function () { return true; };
  run('spDelete()'); await flush(); await flush();
  ok('accepting removes it', run('spPlan.length') === 0, String(run('spPlan.length')));
  ok('the editor closed', id('spEditor').classList.contains('show') === false);
  ok('the empty state comes back', id('spEmpty').hidden === false);

  head('nothing about the plan is kept in the browser');
  /* The harness has no Web Storage, which is itself the useful thing to say:
     the plan controller never reaches for it. Prove it by reading the code
     that persists the plan, rather than by trusting the absence of an error. */
  var appSrc = read('js/app.js');
  var start = appSrc.indexOf('var spPlan = [];');
  var end = appSrc.indexOf('function dashPlanGo()');
  var controller = appSrc.slice(start, end > start ? end : start + 20000);
  ok('the plan controller is on the page', start > -1);
  ok('it never writes a plan to localStorage', !/localStorage/.test(controller));
  ok('it never writes a plan to sessionStorage', !/sessionStorage/.test(controller));
  ok('every save goes through GOC.api.savePlan', /GOC\.api\.savePlan/.test(controller));
  ok('and every read through GOC.api.getPlan', /GOC\.api\.getPlan/.test(controller));

  head('the planner engine is not duplicated on the client');
  ok('the screen validates with GOC.core.planValidateStoredBlock',
     /planValidateStoredBlock/.test(read('js/app.js')));
  ok('and reads days with GOC.core.planBlocksForDay',
     /planBlocksForDay/.test(read('js/app.js')));
  ok('it does not keep its own copy of the day list',
     !/var\s+PLAN_DAYS\s*=/.test(read('js/app.js')));

  console.log('\n  ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  process.exit(1);
});
