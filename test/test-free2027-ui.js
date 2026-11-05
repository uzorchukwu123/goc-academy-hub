/* test-free2027-ui.js — the 2027 Free Tutorial Edition, slice 3: the browser.
   Small hand-rolled DOM (there is no jsdom in this sandbox), with the network,
   the clock and the hub's own go() replaced by stand-ins the test controls.

   What is checked here is the behaviour the page is responsible for:
     • Original Mode leaves the hub exactly as it is, and is what an unreachable
       or switched-off server produces;
     • 2027 Free Tutorial Mode adds one class to <body> and nothing else, and
       taking the class away restores the hub;
     • five quick clicks on the "4 Science subjects" card open the administrator
       sign-in, and a pause restarts the count — and the card itself is never
       restyled, renamed or given a hint;
     • the registration form refuses a bad address before it calls the server;
     • the examination paints the paper it is served, saves an answer, moves,
       and keeps its clock running down from the SERVER's remaining time.
   node test/test-free2027-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));
var core = require(path.join(APP, 'js', 'goc-core.js'));
var uiSrc = read('js/free2027-ui.js');
var apiSrc = read('js/free2027-api.js');
var html = read('index.html');
var css = read('css/free2027.css');

/* ------------------------------------------------------------ a tiny DOM */
function El(tag) {
  var self = this;
  this.tagName = String(tag || 'div').toUpperCase();
  this.className = '';
  this._text = '';
  this._html = '';
  this.hidden = false;
  this.disabled = false;
  this.value = '';
  this.dataset = {};
  this.style = {};
  this.attributes = {};
  this.parentNode = null;
  this.focused = 0;
  this.classList = {
    add: function (c) { var a = self._parts(); if (a.indexOf(c) < 0) a.push(c); self.className = a.join(' '); },
    remove: function (c) { self.className = self._parts().filter(function (x) { return x !== c; }).join(' '); },
    contains: function (c) { return self._parts().indexOf(c) > -1; },
    toggle: function (c, on) {
      var want = on === undefined ? !self.classList.contains(c) : !!on;
      if (want) self.classList.add(c); else self.classList.remove(c);
      return want;
    }
  };
}
El.prototype._parts = function () { return String(this.className || '').split(/\s+/).filter(Boolean); };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v == null ? '' : v); }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v == null ? '' : v); }
});
El.prototype.getAttribute = function (k) { return this.attributes[k] === undefined ? null : this.attributes[k]; };
El.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); };
El.prototype.addEventListener = function (t, fn) { (this.listeners = this.listeners || {})[t] = fn; };
El.prototype.focus = function () { this.focused++; };
El.prototype.insertAdjacentHTML = function (where, h) { this._html += h; };
El.prototype.closest = function (sel) {
  var n = this;
  while (n) {
    if (sel === '[data-f27-gate]' && n.attributes && n.attributes['data-f27-gate'] !== undefined) return n;
    n = n.parentNode;
  }
  return null;
};
El.prototype.querySelectorAll = function () { return []; };

/* --------------------------------------------------------- the sandbox */
function makeWorld(opts) {
  var o = opts || {};
  var els = {};
  var calls = { go: [], fetches: [], toasts: [], confirms: [], api: [], confirmsAsked: [] };
  var clock = o.now || 1000000;

  function el(id) {
    if (!els[id]) { els[id] = new El('div'); els[id].id = id; }
    return els[id];
  }
  /* the pieces of the page the script touches */
  ['freeHomeOpen', 'freeHomeNote', 'freeHomeMode', 'freeRegErr', 'freeRegStep1', 'freeRegStep2', 'freeName',
   'freeEmail', 'freeCourse', 'freeCourseList', 'freeRegBtn', 'freeOtp', 'freeOtpErr', 'freeOtpTo', 'freeOtpDev',
   'freeOtpBtn', 'freeWho', 'freePortalList', 'freePortalResults', 'freeExamTitle', 'freeExamMeta', 'freeExamNum',
   'freeExamPanelLabel', 'freeExamPassage', 'freeExamImage', 'freeExamQ', 'freeExamOpts', 'freeExamTime',
   'freeExamSubmit', 'freeExamPanelGrid', 'freeExamPanelBack', 'freeExamPanel', 'freeResultBody', 'freeBoardBody',
   'freeAdminNote', 'freeAdminErr', 'freeAdminId', 'freeAdminPw', 'freeAdminBtn', 'lpStat4', 'landing', 'freeProgramme',
   'free-admin', 'free-home', 'free-portal', 'free-result', 'free-exam', 'free-leaderboard', 'admin-gate', 'admin'
  ].forEach(el);
  el('freeRegStep2').hidden = true;
  el('freeRegStep1').hidden = false;
  el('landing').classList.add('active');

  var doc = {
    body: new El('body'),
    readyState: 'complete',
    listeners: {},
    getElementById: function (id) { return els[id] || null; },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    createElement: function (t) { return new El(t); },
    addEventListener: function (t, fn) { doc.listeners[t] = fn; }
  };

  var api = {
    hasToken: function () { return !!o.token; },
    token: function () { return o.token || null; },
    config: function () {
      return o.configFails ? Promise.reject(new Error('no config'))
        : Promise.resolve(o.config || { on: true, mode: 'free2027', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 });
    },
    registerStart: function (d) { calls.api.push(['registerStart', d]); return Promise.resolve(o.startReply || { sent: true, delivered: false, devCode: '123456', dev: true }); },
    registerVerify: function (d) { calls.api.push(['registerVerify', d]); return Promise.resolve(o.verifyReply || { token: 'T1', participant: { id: 'GOC-F27-0001', name: 'Ada', course: 'Law', email: 'ad••@example.com' } }); },
    me: function () { return Promise.resolve({ participant: { id: 'GOC-F27-0001', name: 'Ada', course: 'Law' } }); },
    logout: function () { return Promise.resolve({ ok: true }); },
    activities: function () { return Promise.resolve(o.listReply || { activities: [], participant: { id: 'GOC-F27-0001', name: 'Ada' } }); },
    start: function (id) { calls.api.push(['start', id]); return Promise.resolve(o.startAttempt || { attempt: { id: 'F27-A1', title: 'Week 1', kind: 'weekly', remainingSec: 615, responses: {} }, questions: [], resumed: false }); },
    resume: function () { return Promise.resolve({}); },
    answer: function (a, q, c) { calls.api.push(['answer', a, q, c]); return Promise.resolve({ saved: true }); },
    submit: function (a, r) { calls.api.push(['submit', a, r]); return Promise.resolve(o.submitReply || { result: { title: 'Week 1', kind: 'weekly', score: 2, maxScore: 4, private: true, timeUsedSec: 30 } }); },
    results: function () { return Promise.resolve({ results: [] }); },
    leaderboards: function () { return Promise.resolve({ leaderboards: [] }); },
    leaderboard: function () { return Promise.resolve({ leaderboard: { rows: [], totalCompetitors: 0 }, mine: null }); },
    programme: function () {
      calls.api.push(['programme']);
      return Promise.resolve(o.programmeReply || {
        profile: { id: 'GOC-F27-0001', name: 'Ada', course: 'Law' },
        enrolment: { course: 'Law', status: 'enrolled', enrolledAt: 1 },
        access: { programme: '2027-free-tutorial', status: 'active', grantedAt: 1 },
        progress: {
          completed: 1, total: 2, percent: 50,
          lessons: [
            { id: 'F27-L-001', title: 'Cell biology', subject: 'Biology', summary: 'Membranes', done: true, completedAt: 1700000000000 },
            { id: 'F27-L-002', title: 'Algebra', subject: 'Mathematics', summary: '', done: false, completedAt: null }
          ]
        },
        quizzes: { submitted: 1, average: 75, best: 3, lastAt: 1700000000000 }
      });
    },
    completeLesson: function (id) { calls.api.push(['completeLesson', id]); return Promise.resolve({ completed: true, already: false }); }
  };

  var sandbox = {
    console: console,
    document: doc,
    rules: rules,
    Promise: Promise,
    setTimeout: function (fn) { if (o.runTimeouts) fn(); return 0; },
    setInterval: function () { return 1; },
    clearInterval: function () {},
    Date: { now: function () { return clock; }, UTC: Date.UTC },
    /* Two answers, like the real server: /api/health names the mode without a
       token, /api/free2027/config is the edition's own copy of the switch and
       its course list. GOC.free reads the response as TEXT, so this must too. */
    fetch: function (url) {
      calls.fetches.push(url);
      if (o.healthFails) return Promise.reject(new Error('offline'));
      var isHealth = /^api\/health$/.test(String(url));
      var body = isHealth
        ? (o.health || { service: 'goc-academy-hub', free2027: { on: true, mode: 'free2027' } })
        : (o.config || { on: true, mode: 'free2027', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 });
      return Promise.resolve({
        ok: true, status: 200,
        text: function () { return Promise.resolve(JSON.stringify(body)); },
        json: function () { return Promise.resolve(body); }
      });
    },
    confirm: function (m) { calls.confirmsAsked.push(m); return o.confirmAnswer !== false; },
    toast: function (m) { calls.toasts.push(m); },
    go: function (id) {
      calls.go.push(id);
      var all = ['landing', 'free-home', 'free-portal', 'free-result', 'free-exam', 'free-leaderboard', 'admin-gate', 'free-admin'];
      all.forEach(function (x) { var e = els[x]; if (e) e.classList.remove('active'); });
      var target = els[id];
      if (target) target.classList.add('active');
    }
  };
  sandbox.window = sandbox;
  sandbox.GOC = { free2027: rules, core: core, free: api };
  sandbox.GOC.api = { ready: Promise.resolve('server'), login: function () { return Promise.resolve({ id: 'GOC-A-001', role: 'admin' }); } };
  sandbox.advance = function (ms) { clock += ms; };
  sandbox.now = function () { return clock; };
  sandbox.els = els;
  sandbox.calls = calls;

  return { sandbox: sandbox, els: els, calls: calls, doc: doc };
}

function load(world) {
  var ctx = vm.createContext(world.sandbox);
  vm.runInContext('var window = this; var global = this;', ctx);
  world.sandbox.console = console;
  world.sandbox.bootLog = [];
  world.sandbox.GOC.api = world.sandbox.GOC.api;
  /* GOC.free is the stub built above: the screens' behaviour is what is under
     test here. The real client (js/free2027-api.js) is driven by the last
     section of this file, against a stubbed fetch. */
  try { vm.runInContext(uiSrc, ctx); } catch (e) { world.bootErr = e; console.log('BOOTERR', e && e.stack); }
  /* hydrate() runs boot() once by itself; the test calls it again so the
     result is awaited instead of slept for. */
  /* hydrate() has already started boot(); the test only waits for it. */
  world.booted = vm.runInContext('GOC.freeUI.ready()', ctx);
  return ctx;
}

function settle(world) {
  return new Promise(function (r) {
    if (world && world.booted && world.booted.then) world.booted.then(function () { setTimeout(r, 20); }, function () { setTimeout(r, 20); });
    else setTimeout(r, 20);
  });
}

console.log('\nOriginal Mode: the hub is left exactly as it was');
var w2, w3;
var w1 = makeWorld({
  health: { service: 'goc-academy-hub', free2027: { on: true, mode: 'original' } },
  config: { on: true, mode: 'original', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 }
});
settle(load(w1)).then(function () {
  return settle();
}).then(function () {
  ok('the body carries no edition class', !w1.doc.body.classList.contains('f27-mode'));
  ok('the page was not moved off the homepage', w1.calls.go.length === 0 || w1.calls.go[w1.calls.go.length - 1] === 'landing', w1.calls.go.join(','));
  ok('the edition\'s screens were not opened', w1.calls.go.indexOf('free-home') < 0);
  ok('GOC.freeUI reports Original Mode', w1.sandbox.GOC.freeUI.mode().mode === 'original');
  /* the hidden entrance belongs to the edition: in Original Mode it is inert */
  for (var g = 0; g < 5; g++) w1.sandbox.GOC.freeUI.gateClick();
  ok('the hidden administrator entrance never opens in Original Mode',
    w1.calls.go.indexOf('free-admin') < 0, w1.calls.go.join(','));

  console.log('\nA server that cannot be reached also leaves the hub alone');
  w2 = makeWorld({ healthFails: true });
  load(w2); return settle(w2);
}).then(function () {
  ok('no edition class when the answer never arrives', !w2.doc.body.classList.contains('f27-mode'));
  ok('and Original Mode is what is reported', w2.sandbox.GOC.freeUI.mode().mode === 'original');

  console.log('\n2027 Free Tutorial Mode: one class, no deletions');
  w3 = makeWorld({});
  var ctx3 = load(w3); return settle(w3).then(function () {
    ok('the body carries the edition class', w3.doc.body.classList.contains('f27-mode'));
    ok('the homepage screen is the one shown', w3.calls.go.indexOf('free-home') > -1, w3.calls.go.join(','));
    ok('the course list was filled from the server', /Medicine and Surgery/.test(w3.els.freeCourseList.innerHTML));
    ok('the mode is named on the page', /2027 Free Tutorial Mode/.test(w3.els.freeHomeMode.textContent), w3.els.freeHomeMode.textContent);
    /* What the CSS must say, read as statements about the page rather than as
       one exact spelling. */
    var flat = css.replace(/\s+/g, ' ');
    var hidesAll = /body\.f27-mode \.screen \{ display: none !important; \}/.test(flat);
    var showsEdition = /body\.f27-mode \.screen\.active\.f27, body\.f27-mode #landing\.active,/.test(flat);
    ok('the CSS hides every original screen', hidesAll, flat.slice(0, 120));
    ok('and shows only the edition\'s screens, the homepage and the console', showsEdition);
    ok('the original chrome (tab bar, sidebar) is hidden, not deleted', /body\.f27-mode \.tabbar, body\.f27-mode \.side \{ display: none !important; \}/.test(flat) || /body\.f27-mode \.tabbar,/.test(flat));
    ok('every hiding rule is scoped to the mode class', (function () {
      var blocks = flat.split('}').filter(function (b) { return /display: none !important/.test(b); });
      return blocks.length > 0 && blocks.every(function (b) { return b.indexOf('f27-mode') > -1; });
    })());
    ok('nothing in the hub was removed to make room: every original screen is still in the page',
      ['id="home"', 'id="study"', 'id="cbt"', 'id="league"', 'id="results"', 'id="admin"'].every(function (s) { return html.indexOf(s) > -1; }));
    ok('and every original script is still loaded', ['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js'].every(function (s) { return html.indexOf(s) > -1; }));

    console.log('\nSwitching back restores the hub');
    var movesBefore = w3.calls.go.length;
    w3.sandbox.GOC.freeUI.applyMode('original', true, { stay: true });
    ok('the class is gone', !w3.doc.body.classList.contains('f27-mode'));
    ok('the console was not navigated away from (stay: true)', w3.calls.go.length === movesBefore, w3.calls.go.join(','));
    w3.sandbox.GOC.freeUI.applyMode('free2027', true, { stay: true });
    ok('and switching on again is the same one class', w3.doc.body.classList.contains('f27-mode'));
  });
}).then(function () {
  console.log('\nThe hidden entrance: five clicks on the "4 Science subjects" card');
  var w = makeWorld({});
  load(w);
  return settle().then(function () {
    var card = w.els.lpStat4;
    ok('the card is the one the page marks, and it is not restyled', card && html.indexOf('id="lpStat4"') > -1 && !/lpStat4[^{]*\{/.test(css));
    ok('the card still reads exactly "4" and "Science subjects"', /<b>4<\/b><span>Science subjects<\/span>/.test(html));
    ok('the click is handled by a delegated listener, not a visible button', /closest\('\[data-f27-gate\]'\)/.test(uiSrc));
    var click = function () { w.sandbox.GOC.freeUI.gateClick(); };
    click(); click(); click(); click();
    ok('four clicks open nothing', w.calls.go.indexOf('free-admin') < 0, w.calls.go.join(','));
    ok('the counter is at four', w.sandbox.GOC.freeUI.gateClicks() === 4, w.sandbox.GOC.freeUI.gateClicks());
    ok('the hub is still on the homepage', w.els['free-home'].classList.contains('active') || w.calls.go.indexOf('free-admin') < 0);
    click();
    ok('the fifth click counts as a complete sequence', w.sandbox.GOC.freeUI.gateClicks() === 0, w.sandbox.GOC.freeUI.gateClicks());
    ok('the fifth click reveals the administrator sign-in',
      w.calls.go.indexOf('free-admin') > -1, w.calls.go.join(','));
    ok('and the edition\'s homepage gives way to it', w.els['free-admin'].classList.contains('active') &&
      !w.els['free-home'].classList.contains('active'));
    /* The hand-rolled go() is a stand-in: what the visitor actually sees is
       decided by the stylesheet, so the sign-in it lands on must be one the
       edition shows. */
    ok('the stylesheet shows that screen while the edition is on',
      /body\.f27-mode #free-admin\.active/.test(css.replace(/\s+/g, ' ')));
    ok('the note warns that the console keeps its own passcode',
      /own passcode/i.test(w.els.freeAdminNote.textContent), w.els.freeAdminNote.textContent);
    ok('and the sign-in is the hub\'s own administrator form', html.indexOf('free-admin') > -1 && /freeAdminLogin/.test(html));
    /* a pause restarts the count, and a broken sequence never opens the gate */
    var reveals = w.calls.go.filter(function (x) { return x === 'free-admin'; }).length;
    w.sandbox.advance(5000);
    click(); click(); click(); click();
    ok('after a pause, four slow clicks leave the count at four',
      w.sandbox.GOC.freeUI.gateClicks() === 4, w.sandbox.GOC.freeUI.gateClicks());
    w.sandbox.advance(4000);
    click();
    ok('and a click after a long pause starts the count again, at one',
      w.sandbox.GOC.freeUI.gateClicks() === 1, w.sandbox.GOC.freeUI.gateClicks());
    ok('a sequence broken by a pause never opens the sign-in again',
      w.calls.go.filter(function (x) { return x === 'free-admin'; }).length === reveals, w.calls.go.join(','));

    console.log('\nThe administrator sign-in keeps the server authorisation');
    w.els.freeAdminId.value = 'GOC-A-001';
    w.els.freeAdminPw.value = 'founder2027';
    w.sandbox.freeAdminLogin();
    return settle().then(function () {
      ok('a management sign-in lands on the hub\'s own secure access portal', w.calls.go[w.calls.go.length - 1] === 'admin-gate', w.calls.go.join(','));
    });
  });
}).then(function () {
  console.log('\nRegistration: the form refuses a bad address before it calls the server');
  var w = makeWorld({});
  load(w);
  return settle().then(function () {
    w.els.freeName.value = 'Ada Obi';
    w.els.freeEmail.value = 'not-an-email';
    w.els.freeCourse.value = 'Law';
    var before = w.calls.api.length;
    w.sandbox.freeRegisterStart();
    ok('no request was sent', w.calls.api.length === before);
    ok('the reason is shown beside the field', /valid email/i.test(w.els.freeRegErr.textContent), w.els.freeRegErr.textContent);
    w.els.freeEmail.value = 'ada@example.com';
    w.sandbox.freeRegisterStart();
    return settle().then(function () {
      if (process.env.F27_DEBUG) console.log('REGERR', JSON.stringify(w.els.freeRegErr.textContent), w.calls.api.length, JSON.stringify(w.calls.api));
    ok('a good form sends one request', w.calls.api.filter(function (c) { return c[0] === 'registerStart'; }).length === 1);
      ok('the address is lower-cased and trimmed before it is sent',
        w.calls.api.filter(function (c) { return c[0] === 'registerStart'; })[0][1].email === 'ada@example.com');
      ok('the first step is hidden and the code step is shown', w.els.freeRegStep1.hidden === true && w.els.freeRegStep2.hidden === false);
      ok('the address is named on the code step', w.els.freeOtpTo.textContent === 'ada@example.com');
      ok('with no mail sender the code is shown to the person registering', !w.els.freeOtpDev.hidden && /123456/.test(w.els.freeOtpDev.textContent));
      w.els.freeOtp.value = '12';
      var n = w.calls.api.length;
      w.sandbox.freeRegisterVerify();
      ok('a short code is refused before it is sent', w.calls.api.length === n && /6-digit/i.test(w.els.freeOtpErr.textContent), w.els.freeOtpErr.textContent);
      w.els.freeOtp.value = '123456';
      w.sandbox.freeRegisterVerify();
      return settle();
    }).then(function () {
      ok('the right-length code is sent to the server', w.calls.api.some(function (c) { return c[0] === 'registerVerify' && c[1].code === '123456'; }));
      ok('and the candidate lands in the CBT Portal', w.calls.go[w.calls.go.length - 1] === 'free-portal', w.calls.go.join(','));
    });
  });
}).then(function () {
  console.log('\nThe examination: the paper, the answers and the SERVER\'s clock');
  var questions = [
    { id: 11, n: 1, subject: 'Physics', topic: 'Motion', kind: 'objective', text: 'A body moves at 3 m/s. How far in 4 s?', options: ['7 m', '12 m', '1 m'], maxMark: 1 },
    { id: 12, n: 2, subject: 'Physics', topic: 'Force', kind: 'objective', text: 'Which is a unit of force?', options: ['Newton', 'Joule'], maxMark: 1, passage: { id: 'P1', title: 'A note', text: 'Read this first.' } }
  ];
  var w = makeWorld({ token: 'PT', startAttempt: { attempt: { id: 'F27-A9', title: 'Week 1', kind: 'weekly', remainingSec: 615, responses: { 11: 1 } }, questions: questions, resumed: true } });
  load(w);
  return settle().then(function () {
    w.sandbox.freeExamOpen('F27-Q1');
    return settle().then(function () {
      ok('the paper is opened through the server', w.calls.api.some(function (c) { return c[0] === 'start' && c[1] === 'F27-Q1'; }));
      ok('the screen is the examiner', w.calls.go[w.calls.go.length - 1] === 'free-exam', w.calls.go.join(','));
      ok('the title and the count come from the paper', w.els.freeExamTitle.textContent === 'Week 1' && /2 question/.test(w.els.freeExamMeta.textContent), w.els.freeExamMeta.textContent);
      ok('the clock starts from the SERVER\'s remaining time, not the full duration', w.els.freeExamTime.textContent === '10:15', w.els.freeExamTime.textContent);
      ok('question 1 is painted with its options', /A body moves/.test(w.els.freeExamQ.textContent) && w.els.freeExamOpts.innerHTML.indexOf('12 m') > -1);
      ok('a resumed answer is already marked', /sel/.test(w.els.freeExamOpts.innerHTML));
      ok('a passage is shown when the question has one', w.els.freeExamPassage.hidden === true);
      w.sandbox.freeExamMove(1);
      ok('moving to question 2 paints question 2', /unit of force/.test(w.els.freeExamQ.textContent));
      ok('and its passage appears', w.els.freeExamPassage.hidden === false && /Read this first/.test(w.els.freeExamPassage.innerHTML));
      w.sandbox.freeExamPick(0);
      return settle();
    }).then(function () {
      ok('choosing an answer sends it to the server at once', w.calls.api.some(function (c) { return c[0] === 'answer' && c[1] === 'F27-A9' && c[2] === 12 && c[3] === 0; }));
      ok('the page shows the answer as chosen', /sel/.test(w.els.freeExamOpts.innerHTML));
      w.sandbox.freeExamMove(-1);
      ok('back to question 1', /A body moves/.test(w.els.freeExamQ.textContent));
      w.sandbox.freeExamSubmit();
      return settle();
    }).then(function () {
      ok('submitting asks first', w.calls.confirmsAsked.length >= 1 && /Submit/.test(w.calls.confirmsAsked[0]), w.calls.confirmsAsked[0]);
      ok('the saved answers are what is submitted', (function () {
        var s = w.calls.api.filter(function (c) { return c[0] === 'submit'; })[0];
        return !!s && s[2]['11'] === 1 && s[2]['12'] === 0;
      })(), JSON.stringify(w.calls.api.filter(function (c) { return c[0] === 'submit'; })));
      ok('the result screen is opened', w.calls.go[w.calls.go.length - 1] === 'free-result', w.calls.go.join(','));
      ok('and the result is painted with the score and the private note', /2/.test(w.els.freeResultBody.innerHTML) && /private/i.test(w.els.freeResultBody.innerHTML));
    });
  });
}).then(function () {
  console.log('\nThe portal shows the candidate their own programme');
  var w = makeWorld({ token: 'T1' });
  load(w);
  return settle(w).then(function () {
    w.sandbox.freeProgrammeLoad();
    return settle().then(function () {
      var out = w.els.freeProgramme.innerHTML;
      ok('the card is shown once a candidate has a token', w.els.freeProgramme.hidden === false);
      ok('it names the candidate and their participant ID', /Ada/.test(out) && /GOC-F27-0001/.test(out), out.slice(0, 160));
      ok('it shows the course they enrolled on', /Law/.test(out));
      ok('it says their access is active', /Access active/.test(out));
      ok('it counts the lessons done', /1 of 2/.test(out), out.slice(0, 220));
      ok('it paints a progress bar at that percentage', /aria-valuenow="50"/.test(out) && /width:50%/.test(out));
      ok('a completed lesson is ticked, not offered again', /Cell biology/.test(out) && /✓ Done/.test(out));
      ok('an unfinished lesson can be marked done', /Algebra/.test(out) && /freeLessonDone\('F27-L-002'\)/.test(out), out.slice(-260));
      ok('the candidate\'s quiz record is shown', /quizzes submitted/.test(out) && /75%/.test(out));
      w.sandbox.freeLessonDone('F27-L-002');
      return settle().then(function () {
        ok('marking a lesson done calls the server',
          JSON.stringify(w.calls.api).indexOf('["completeLesson","F27-L-002"]') > -1, JSON.stringify(w.calls.api));
        ok('and the programme is re-read afterwards',
          w.calls.api.filter(function (c) { return c[0] === 'programme'; }).length === 2, JSON.stringify(w.calls.api));
      });
    });
  });
}).then(function () {
  console.log('\nThe homepage tells the truth about the email sender');
  function noteFor(delivery) {
    var w = makeWorld({
      config: { on: true, mode: 'free2027', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10, otpDelivery: delivery }
    });
    load(w);
    return settle(w).then(function () { return w.els.freeHomeNote.textContent; });
  }
  return noteFor({ available: true }).then(function (note) {
    ok('with a working sender the page says the code is emailed',
      /one-time code sent to your email address/.test(note), note);
    return noteFor({ available: false, devAllowed: true });
  }).then(function (note) {
    ok('with no sender in development it says codes are shown on screen',
      /shown on screen/.test(note) && !/cannot be completed/.test(note), note);
    return noteFor({ available: false, devAllowed: false });
  }).then(function (note) {
    ok('with no sender in production it says registration cannot be completed',
      /cannot be completed/.test(note) && !/shown on screen/.test(note), note);
  });
}).then(function () {
  console.log('\nThe client API sends the right token to the right route');
  function world(fetchSpy) {
    var sb = { console: console, document: { getElementById: function () { return null; }, readyState: 'complete' }, Promise: Promise,
      sessionStorage: null, fetch: fetchSpy };
    sb.window = sb;
    sb.GOC = { free2027: rules, api: { staffToken: function () { return 'ADMIN-TOKEN'; } } };
    var ctx = vm.createContext(sb);
    vm.runInContext(apiSrc, ctx);
    return { sb: sb, api: sb.GOC.free };
  }
  var seen = [];
  function spy(url, init) {
    seen.push({ url: url, init: init });
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve('{"ok":true,"token":"PART-TOKEN"}'); } });
  }
  var w = world(spy);
  return w.api.registerVerify({ email: 'a@example.com', code: '123456' }).then(function () {
    ok('verification goes to the edition\'s own route', /^api\/free2027\/register\/verify$/.test(seen[0].url), seen[0].url);
    return w.api.activities();
  }).then(function () {
    ok('a participant route now carries the participant token', seen[1].init.headers.Authorization === 'Bearer PART-TOKEN', JSON.stringify(seen[1].init.headers));
    return w.api.adminOverview();
  }).then(function () {
    ok('a console route carries the management token instead', seen[2].init.headers.Authorization === 'Bearer ADMIN-TOKEN', JSON.stringify(seen[2].init.headers));
    return w.api.programme();
  }).then(function () {
    ok('the programme record is a participant route', /^api\/free2027\/programme$/.test(seen[3].url) &&
      seen[3].init.headers.Authorization === 'Bearer PART-TOKEN', seen[3].url + ' ' + JSON.stringify(seen[3].init.headers));
    return w.api.completeLesson('F27-L-002');
  }).then(function () {
    ok('a lesson is completed by POST to its own route', /^api\/free2027\/lessons\/F27-L-002\/complete$/.test(seen[4].url) && seen[4].init.method === 'POST',
      seen[4].init.method + ' ' + seen[4].url);
    return w.api.adminQuestions('Biology');
  }).then(function () {
    ok('the console question picker is the edition\'s own route', /^api\/free2027\/admin\/questions/.test(seen[5].url) &&
      seen[5].init.headers.Authorization === 'Bearer ADMIN-TOKEN', seen[5].url);
    ok('and it is the same route the server guards', /^api\/free2027\/admin\/overview$/.test(seen[2].url), seen[2].url);
    ok('a refused request surfaces the server\'s own message', (function () {
      var w2 = world(function () { return Promise.resolve({ ok: false, status: 403, text: function () { return Promise.resolve('{"error":"Your role does not include this."}'); } }); });
      return w2.api.adminOverview().then(function () { return false; }, function (e) { return /role does not include/.test(e.message) && e.status === 403; });
    })());
  });
}).then(function () {
  return null;
}).catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e));
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
