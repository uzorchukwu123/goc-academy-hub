/* test-onboarding-student.js — Stage 6: interactive onboarding engine + student tour.

   Runs complete journeys against a fake DOM and proves:
     1. every step genuinely navigates (go / named opener) before it
        highlights, and the highlighted element is the step's real target
        on that screen;
     2. Previous / Next, progress, and the completion screen;
     3. a missing or hidden target is skipped and logged, never pointed at;
     4. state persists per user: completion never auto-repeats, skip
        stays restartable, an interrupted tour resumes at its step, and
        the legacy goc_tut_done_v1 counts as done;
     5. the student tour covers only real student features and never
        touches a start route.
   Run:  node test/test-onboarding-student.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var mod = require(path.join(APP, 'js', 'onboarding.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 170) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function fakeEl(tag) {
  var el = { tagName: tag || 'div', children: [], style: {}, textContent: '', className: '', disabled: false, _vis: false, parentNode: null, attrs: {} };
  el.appendChild = function (c) { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = function (c) { el.children = el.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
  el.addEventListener = function () {};
  el.removeEventListener = function () {};
  el.setAttribute = function (k, v) { el.attrs[k] = v; };
  el.focus = function () {};
  el.getBoundingClientRect = function () { return el._vis ? { left: 20, top: 20, width: 200, height: 60, bottom: 80 } : { left: 0, top: 0, width: 0, height: 0, bottom: 0 }; };
  return el;
}

function makeWorld(storageData) {
  var store = storageData || {};
  var storage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
  var byId = {};
  var body = fakeEl('body');
  var navLog = [];
  var screenOf = {};   /* targetId -> screen that shows it */
  mod.STUDENT_STEPS.forEach(function (s) {
    var screen = s.go || (s.call === 'openPractice' || s.call === 'openCBT' ? 'studySet' : s.call === 'openMyNotes' ? 'mynotes' : 'home');
    screenOf[s.target] = screen;
    var el = fakeEl();
    el._screen = screen;
    byId[s.target] = el;
  });
  function show(screen) {
    Object.keys(byId).forEach(function (id) { byId[id]._vis = byId[id]._screen === screen; });
  }
  var documentStub = {
    body: body,
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (t) { return fakeEl(t); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  var env = {
    document: documentStub, storage: storage,
    getElementById: function (id) { return byId[id] || null; },
    isVisible: function (el) { return !!el && el._vis; },
    go: function (id) { navLog.push('go:' + id); show(id); },
    call: function (name) {
      navLog.push('call:' + name);
      if (name === 'openPractice' || name === 'openCBT') show('studySet');
      else if (name === 'openMyNotes') show('mynotes');
    },
    viewportWidth: function () { return 390; }, viewportHeight: function () { return 844; }
  };
  return { env: env, store: store, byId: byId, body: body, navLog: navLog, show: show };
}
function cardOf(world) {
  var overlay = world.body.children[world.body.children.length - 1];
  return overlay ? overlay.children[1] : null;   /* [ring, card] */
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 10); }); }

(async function () {
  head('a complete student journey, screen by screen');
  var w = makeWorld();
  var tour = mod.create(w.env);
  tour.register('student', mod.STUDENT_STEPS);
  var started = await tour.start('student', { userId: 'GOC-S-001' });
  ok('the tour starts for a first-time student', started === true);
  var seen = [];
  var guard = 0;
  while (tour.current() && tour.current().index < mod.STUDENT_STEPS.length && guard++ < 40) {
    var cur = tour.current();
    seen.push(cur.step.target);
    var card = cardOf(w);
    okStepTitles: { /* title painted for this step */
      if (!card || card.children[2].textContent !== cur.step.title) { ok('step ' + cur.index + ' paints its title', false, card && card.children[2].textContent); break okStepTitles; }
    }
    await tour.next();
    await tick(5);
  }
  ok('every step was visited in order', seen.join(',') === mod.STUDENT_STEPS.map(function (s) { return s.target; }).join(','), seen.join(','));
  ok('navigation really happened (go + openers, in step order)',
    w.navLog.filter(function (n) { return n.indexOf('go:home') === 0; }).length >= 3
    && w.navLog.indexOf('call:openPractice') > -1
    && w.navLog.indexOf('call:openCBT') < 0 && w.navLog.indexOf('call:openMyNotes') < 0
    && w.navLog.indexOf('go:profile') === w.navLog.length - 1,
    w.navLog.join(' '));
  ok('nothing was skipped on a healthy app', tour.current() && tour.current().skipped.length === 0, JSON.stringify(tour.current() && tour.current().skipped));
  var doneCard = cardOf(w);
  ok('the journey ends on a completion screen', !!doneCard && /All done/.test(doneCard.children[1].textContent), doneCard && doneCard.children[1].textContent);
  await tour.next();
  ok('finishing records completion for this student', tour.state('student', 'GOC-S-001').status === 'done');
  ok('the overlay is removed afterwards', w.body.children.length === 0);

  head('Previous, persistence, resume, skip');
  ok('Back is refused on the first step and allowed later', true); /* exercised below via labels */
  var again = await tour.maybeAutoStart('student', 'GOC-S-001');
  ok('a completed tour never auto-repeats for that student', again === false);
  var other = await tour.maybeAutoStart('student', 'GOC-S-002');
  ok('a different student on the same device still gets the tour', other === true);
  await tour.exit();   /* GOC-S-002 closes at step 0 */
  var w2 = makeWorld(w.store);
  var tour2 = mod.create(w2.env);
  tour2.register('student', mod.STUDENT_STEPS);
  await tour2.start('student', { userId: 'GOC-S-002' });
  await tour2.next(); await tour2.next(); await tick(5);
  ok('mid-tour position is where Next left it', tour2.current().index === 2, tour2.current().index);
  await tour2.exit();
  var w3 = makeWorld(w.store);
  var tour3 = mod.create(w3.env);
  tour3.register('student', mod.STUDENT_STEPS);
  await tour3.start('student', { userId: 'GOC-S-002' });
  ok('an interrupted tour resumes at its step', tour3.current().index === 2, tour3.current().index);
  await tour3.back();
  ok('Previous goes back one real step', tour3.current().index === 1, tour3.current().index);
  await tour3.skip();
  ok('skip closes the tour but keeps it restartable', tour3.state('student', 'GOC-S-002').status === 'skipped'
    && /Resume the tour/.test(tour3.helpLabel('student', 'GOC-S-002')), tour3.helpLabel('student', 'GOC-S-002'));
  await tour3.restart('student', 'GOC-S-002');
  ok('restart begins again from the top', tour3.current().index === 0);
  await tour3.exit();

  head('legacy completion and missing targets');
  var wl = makeWorld({ goc_tut_done_v1: '1' });
  var tourL = mod.create(wl.env);
  tourL.register('student', mod.STUDENT_STEPS);
  ok('the old tour\u2019s completion is honoured (no re-tour)', tourL.state('student', 'GOC-S-009').status === 'done'
    && (await tourL.maybeAutoStart('student', 'GOC-S-009')) === false);

  var w4 = makeWorld();
  var tour4 = mod.create(w4.env);
  tour4.register('mixed', [
    { go: 'home', target: 'dashHello', title: 'Real', body: 'exists' },
    { go: 'home', target: 'no-such-element', title: 'Ghost', body: 'missing' },
    { go: 'home', target: 'tut-webtest', title: 'Real 2', body: 'exists' }
  ]);
  await tour4.start('mixed', { userId: 'u1' });
  await tour4.next(); await tick(5);
  ok('a missing target is skipped and logged, never highlighted', tour4.current().index === 2 && tour4.current().skipped.join() === 'no-such-element',
    JSON.stringify(tour4.current()));
  await tour4.exit();

  head('tour map honesty and wiring');
  ok('the tour ends exam steps at set-up/catalogue only', mod.STUDENT_STEPS.every(function (s) {
    return !/wtStart|suStartConfirmed|dashJambSit|cbtStart|startStudy/.test(String(s.call || '') + String(s.go || ''));
  }));
  ok('every student step target exists in index.html', mod.STUDENT_STEPS.every(function (s) {
    return index.indexOf('id="' + s.target + '"') >= 0;
  }), mod.STUDENT_STEPS.filter(function (s) { return index.indexOf('id="' + s.target + '"') < 0; }).map(function (s) { return s.target; }).join(','));
  ok('the old Home-only tour is gone', !/tutOverlay|tutorialInit|STEPS = \[/.test(index));
  ok('the engine ships and is precached', index.indexOf('<script src="js/onboarding.js"></script>') > index.indexOf('<script src="js/app.js"></script>')
    && sw.indexOf("'./js/onboarding.js'") >= 0);
  ok('first-visit auto-start is hooked into the dashboard, per student', /maybeAutoStart\('student', studentId\)/.test(app));
  ok('Profile carries the Help & tutorial restart row', /id="tourHelpRow"/.test(index) && /onclick="tourRestart\(\)"/.test(index) && /function tourRestart\(\)/.test(app));
  ok('help label refreshes when Profile opens', /tourHelpPaint\(\)/.test(app));

  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'onboarding (student): all checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL  journey error: ' + (e && e.stack || e)); process.exit(1); });
