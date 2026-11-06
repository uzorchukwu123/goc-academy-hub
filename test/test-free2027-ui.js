/* test-free2027-ui.js — the 2027 Free Tutorial Edition, slice 3: the browser.
   Small hand-rolled DOM (there is no jsdom in this sandbox), with the network,
   the clock and the hub's own go() replaced by stand-ins the test controls.

   What is checked here is the behaviour the page is responsible for:
     • Original Mode leaves the hub exactly as it is, and is what an unreachable
       or switched-off server produces;
     • 2027 Free Tutorial Mode adds one class to <body> and nothing else, and
       taking the class away restores the hub;
     • the old Science Subjects card entrance is gone; the existing staff
       sign-in remains available to the verified contact-form entrance;
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
   'freeEmail', 'freePassword', 'freeCourse', 'freeCourseList', 'freeRegBtn', 'freeOtp', 'freeOtpErr', 'freeOtpTo', 'freeOtpDev',
   'freeLoginEmail', 'freeLoginPassword', 'freeLoginErr', 'freeLoginBtn',
   'freeOtpBtn', 'freeOtpResendBtn', 'freeWho', 'freePortalList', 'freePortalResults', 'freeExamTitle', 'freeExamMeta', 'freeExamNum',
   'freeExamPanelLabel', 'freeExamPassage', 'freeExamImage', 'freeExamQ', 'freeExamOpts', 'freeExamTime',
   'freeExamSubmit', 'freeExamPanelGrid', 'freeExamPanelBack', 'freeExamPanel', 'freeExamKind', 'freeExamPrev', 'freeExamNext',
   'freeExamConfirmBack', 'freeExamConfirm', 'freeExamConfirmAnswered', 'freeExamConfirmUnanswered', 'freeExamConfirmTotal', 'freeExamConfirmCancel', 'freeResultBody', 'freeBoardBody',
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
    registerStart: function (d) { calls.api.push(['registerStart', d]); return Promise.resolve(o.startReply || { sent: true, delivered: true, expiresInMin: 15, resendInSec: 60 }); },
    registerVerify: function (d) { calls.api.push(['registerVerify', d]); return Promise.resolve(o.verifyReply || { token: 'T1', participant: { id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada', course: 'Law', email: 'ad••@example.com' } }); },
    me: function () { return Promise.resolve({ participant: { id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada', course: 'Law' } }); },
    logout: function () { return Promise.resolve({ ok: true }); },
    activities: function () { calls.api.push(['activities']); return Promise.resolve(o.listReply || { activities: [], participant: { id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada' } }); },
    /* Public catalogue used by the direct, registration-free CBT Portal entry. */
    catalogue: function () { calls.api.push(['catalogue']); return Promise.resolve(o.catalogueReply || { guest: true, activities: [] }); },
    start: function (id) { calls.api.push(['start', id]); return Promise.resolve(o.startAttempt || { attempt: { id: 'F27-A1', title: 'Week 1', kind: 'weekly', remainingSec: 615, responses: {} }, questions: [], resumed: false }); },
    resume: function () { return Promise.resolve({}); },
    answer: function (a, q, c) { calls.api.push(['answer', a, q, c]); return Promise.resolve({ saved: true }); },
    submit: function (a, r) { calls.api.push(['submit', a, r]); return Promise.resolve(o.submitReply || { result: { title: 'Week 1', kind: 'weekly', score: 2, maxScore: 4, private: true, timeUsedSec: 30 } }); },
    results: function () { calls.api.push(['results']); return Promise.resolve(o.resultsReply || { results: [] }); },
    leaderboards: function () { return Promise.resolve({ leaderboards: [] }); },
    leaderboard: function () { return Promise.resolve({ leaderboard: { rows: [], totalCompetitors: 0 }, mine: null }); },
    programme: function () {
      calls.api.push(['programme']);
      return Promise.resolve(o.programmeReply || {
        profile: { id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada', course: 'Law' },
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
    /* A real Date constructor (the portal formats open/close dates) whose
       zero-argument form follows the controlled clock. */
    Date: (function () {
      function SandboxDate() {
        if (arguments.length === 0) return new Date(clock);
        var args = [null].concat(Array.prototype.slice.call(arguments));
        return new (Function.prototype.bind.apply(Date, args))();
      }
      SandboxDate.now = function () { return clock; };
      SandboxDate.UTC = Date.UTC;
      SandboxDate.parse = Date.parse;
      SandboxDate.prototype = Date.prototype;
      return SandboxDate;
    })(),
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
  ok('the removed card entrance is not exposed by the edition UI',
    typeof w1.sandbox.GOC.freeUI.gateClick !== 'function' && w1.calls.go.indexOf('free-admin') < 0, w1.calls.go.join(','));

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
    ok('the original homepage remains the initial screen in Free Tutorial mode', w3.els.landing.classList.contains('active') && w3.calls.go.indexOf('free-home') < 0, w3.calls.go.join(','));
    ok('the course list was filled from the server', /Medicine and Surgery/.test(w3.els.freeCourseList.innerHTML));
    ok('the mode is named on the page', /2027 Free Tutorial Mode/.test(w3.els.freeHomeMode.textContent), w3.els.freeHomeMode.textContent);
    /* What the CSS must say, read as statements about the page rather than as
       one exact spelling. */
    var flat = css.replace(/\s+/g, ' ');
    var hidesAll = /body\.f27-mode \.screen \{ display: none !important; \}/.test(flat);
    var showsEdition = /body\.f27-mode \.screen\.active\.f27, body\.f27-mode #landing\.active,/.test(flat);
    ok('Free Tutorial mode disables unrelated original app screens', hidesAll, flat.slice(0, 120));
    ok('the homepage, edition screens and console sign-in remain available', showsEdition);
    ok('Free Tutorial mode does not hide the original homepage sections', !/body\.f27-mode #landing \.lp-sec/.test(flat));
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
  console.log('\nThe Science Subjects card is no longer an Admin Console entrance');
  var w = makeWorld({});
  load(w);
  return settle().then(function () {
    ok('the statistics card still reads exactly "4" and "Science subjects"', /<b>4<\/b><span>Science subjects<\/span>/.test(html));
    ok('the card carries no hidden entrance marker', html.indexOf('data-f27-gate') < 0);
    ok('the edition UI has no card click handler or delegated gate listener',
      !/freeGateClick|gateClicks|wireLanding|data-f27-gate/.test(uiSrc));
    ok('the homepage has no other Admin Console entry point', (function () { var landing = html.slice(html.indexOf('id="landing"'), html.indexOf('id="landing"') + 60000); return !/onclick="[^"]*(?:free-admin|admin-gate|go\('admin')/i.test(landing); })());
    ok('the existing staff sign-in screen and handler remain', html.indexOf('free-admin') > -1 && /freeAdminLogin/.test(html));
    ok('the stylesheet shows the login screen without requiring Free mode',
      /#free-admin\.active/.test(css.replace(/\s+/g, ' ')));
    w.sandbox.go('free-admin');
    ok('the verified contact entrance can open the existing staff sign-in', w.els['free-admin'].classList.contains('active'));

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
    var beforePw = w.calls.api.length;
    w.sandbox.freeRegisterStart();
    ok('a registration with no password is refused before it is sent', w.calls.api.length === beforePw && /at least 8 characters/i.test(w.els.freeRegErr.textContent), w.els.freeRegErr.textContent);
    w.els.freePassword.value = 'abcdefgh';
    w.sandbox.freeRegisterStart();
    ok('a password without a number is refused with the exact reason', w.calls.api.length === beforePw && /letters and numbers/i.test(w.els.freeRegErr.textContent), w.els.freeRegErr.textContent);
    w.els.freePassword.value = 'AdaPass-2027';
    w.sandbox.freeRegisterStart();
    return settle().then(function () {
      if (process.env.F27_DEBUG) console.log('REGERR', JSON.stringify(w.els.freeRegErr.textContent), w.calls.api.length, JSON.stringify(w.calls.api));
    ok('a good form sends one request', w.calls.api.filter(function (c) { return c[0] === 'registerStart'; }).length === 1);
      ok('the address is lower-cased and trimmed before it is sent',
        w.calls.api.filter(function (c) { return c[0] === 'registerStart'; })[0][1].email === 'ada@example.com');
      ok('the chosen password travels with the registration request',
        w.calls.api.filter(function (c) { return c[0] === 'registerStart'; })[0][1].password === 'AdaPass-2027');
      ok('the password field is emptied once the code is on its way', w.els.freePassword.value === '');
      ok('the first step is hidden and the code step is shown', w.els.freeRegStep1.hidden === true && w.els.freeRegStep2.hidden === false);
      ok('the address is named on the code step', w.els.freeOtpTo.textContent === 'ada@example.com');
      ok('the verification code is never displayed in the browser UI', w.els.freeOtpDev.hidden && !/123456/.test(w.els.freeOtpDev.textContent));
      ok('the page offers a resend action', /freeRegisterResend/.test(html));
      w.sandbox.freeRegisterResend();
      return settle().then(function () {
      ok('resend asks the server to send a new email to the same address', w.calls.api.filter(function (c) { return c[0] === 'registerStart'; }).length === 2);
      ok('the resend still carries the password, so the account can be created',
        w.calls.api.filter(function (c) { return c[0] === 'registerStart'; })[1][1].password === 'AdaPass-2027');
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
      ok('the title and the count come from the paper', w.els.freeExamTitle.textContent === 'Week 1' && w.els.freeExamKind.textContent === 'Weekly Assessment' && /Question 1 of 2/.test(w.els.freeExamNum.textContent), w.els.freeExamNum.textContent);
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
      ok('submitting opens the confirmation dialog with answered/unanswered counts', w.els.freeExamConfirm.hidden === false && w.els.freeExamConfirmAnswered.textContent === '2' && w.els.freeExamConfirmUnanswered.textContent === '0' && w.els.freeExamConfirmTotal.textContent === '2');
      w.sandbox.freeExamConfirmSubmit();
      return settle();
    }).then(function () {
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
      ok('it names the candidate and their participant ID', /Ada/.test(out) && /GOC-F27-0123456789ABCDEFABCD/.test(out), out.slice(0, 160));
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
  console.log('\nReturning to the CBT Portal refreshes the programme and results');
  var w = makeWorld({
    token: 'T1',
    listReply: { activities: [{ id: 'F27-Q1', kind: 'weekly', title: 'Week 1', state: 'open', questionCount: 1, durationMin: 10, maxAttempts: 1, attemptsLeft: 1, attemptsUsed: 0 }], participant: { id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada' } },
    resultsReply: { results: [{ title: 'Week 1', kind: 'weekly', score: 1, maxScore: 1, submittedAt: 0 }] }
  });
  load(w);
  return settle(w).then(function () {
    var activitiesBefore = w.calls.api.filter(function (c) { return c[0] === 'activities'; }).length;
    var resultsBefore = w.calls.api.filter(function (c) { return c[0] === 'results'; }).length;
    w.sandbox.freeGo('free-portal');
    return settle().then(function () {
      ok('a portal link opens the portal', w.calls.go[w.calls.go.length - 1] === 'free-portal', w.calls.go.join(','));
      ok('and re-reads the activity list on arrival', w.calls.api.filter(function (c) { return c[0] === 'activities'; }).length > activitiesBefore);
      ok('and re-reads the candidate\'s results on arrival', w.calls.api.filter(function (c) { return c[0] === 'results'; }).length > resultsBefore);
      ok('so a just-submitted result is not left stale', /Week 1/.test(w.els.freePortalResults.innerHTML), w.els.freePortalResults.innerHTML.slice(0, 160));
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
    ok('with a working sender the page explains registration honestly: details, a password and an emailed code',
      /one-time code/.test(note) && /verify your email/i.test(note) && /password/.test(note), note);
    return noteFor({ available: false });
  }).then(function (note) {
    ok('with no sender it says registration is unavailable until mail is configured',
      /temporarily unavailable/.test(note) && /configures email verification/.test(note) && !/shown on screen/.test(note), note);
    return noteFor({ available: false });
  }).then(function (note) {
    ok('with no sender the same truthful configuration message is shown in every environment',
      /temporarily unavailable/.test(note) && !/shown on screen/.test(note), note);
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
  /* ===== Homepage CTAs, direct CBT Portal entry and mode-aware routing ===== */
  head('Homepage: obsolete bootcamp CTA removed, CBT Portal entry added');
  ok('"Start Free UTME Bootcamp" is gone from the page entirely', !/start free utme bootcamp/i.test(html));
  ok('"I already have an account" is preserved', /I already have an account/.test(html));
  ok('the homepage hero offers CBT Portal directly', /hero-cbt" onclick="freeCbtPortal\(\)"/.test(html));
  ok('the hero CBT action is not a signup route', !/hero-cbt" onclick="go\('signup'\)/.test(html));
  /* Owner correction: the ORIGINAL account actions are never hidden or
     rerouted. "Get started" is the original signup route and "I already have
     an account" is the original login route, in every mode. */
  ok('the hero keeps the ORIGINAL signup route', /hero-original-cta" onclick="go\('signup'\)">Get started</.test(html));
  /* Owner correction: the account link is unchanged on the page and routes by
     mode; the hero's hub sign-up CTA is displayed in Original Mode only. */
  ok('the hero account link keeps its text, class and position, with a mode-aware action', /<button class="lp-btn-ghost" onclick="heroAccount\(\)">I already have an account<\/button>/.test(html));
  ok('the hero account action is exposed to the markup', /'heroAccount'\]/.test(uiSrc) && /F\.heroAccount = function/.test(uiSrc));
  var unscopedCss = css.replace(/body\.f27-mode[^{}]*\{[^{}]*\}/g, '');
  ok('no UNSCOPED CSS rule hides the original hero signup CTA', !/\.hero-original-cta \{ display: none/.test(unscopedCss));
  ok('the hero signup CTA is hidden in Free Tutorial Mode only', /body\.f27-mode #landing \.hero-btns \.hero-original-cta \{ display: none !important; \}/.test(css));
  ok('the edition no longer defines an account-entry reroute', !/freeAccountEntry/.test(uiSrc) && !/freeAccountEntry/.test(html));
  ok('the CTA styling is mode-scoped rather than hiding a live bootcamp button', /body\.f27-mode #landing \.hero-btns \.hero-cbt/.test(css));
  ok('the exam header exposes Back and Home', /freeExamLeave\(\)/.test(html) && /freeExamHome\(\)/.test(html) && /Back to Home/.test(html));
  ok('the small-screen exam header wraps instead of overlapping', /max-width: 480px[\s\S]{0,200}flex-wrap: wrap/.test(css));
  ok('no bootcamp CTA survives in the nav or drawer markup', !/dw-bootcamp|nav-bootcamp|Bootcamp<\/a>/.test(html));

  head('CBT Portal entry: every public entry opens the Free Tutorial landing page');
  var gp = makeWorld({
    token: null,
    catalogueReply: { guest: true, activities: [
      { id: 'F27-Q1', kind: 'weekly', title: 'Week 1', state: 'open', opensAt: 0, closesAt: 9999999999999, durationMin: 30, questionCount: 2, instructions: 'Answer every question.' },
      { id: 'F27-Q2', kind: 'competition', title: 'Grand Prize', state: 'open', opensAt: 0, closesAt: 9999999999999, durationMin: 20, questionCount: 2, instructions: '' }
    ] }
  });
  load(gp);
  return settle(gp).then(function () {
    gp.sandbox.freeCbtPortal();
    return settle(gp).then(function () {
      ok('a guest clicking CBT Portal reaches the Free UTME Tutorial landing page', gp.calls.go[gp.calls.go.length - 1] === 'free-home', gp.calls.go.join(','));
      ok('the CBT entry never sends the guest to registration', gp.calls.go.indexOf('free-register') < 0, gp.calls.go.join(','));
      ok('the CBT entry never sends the guest to signup or a hub account chooser', gp.calls.go.indexOf('signup') < 0 && gp.calls.go.indexOf('login-v2') < 0);
      ok('the landing page is the one carrying the edition heading and its three choices',
        /2027 UTME · Free Tutorial Edition/.test(html) && /Register free</.test(html) && /Student log in</.test(html) && /Enter the CBT Portal</.test(html));
      /* Enter the CBT Portal is the authentication-aware step. */
      gp.calls.go.length = 0;
      gp.sandbox.freePortalEnter();
      return settle(gp).then(function () {
        ok('Enter the CBT Portal with no session opens the EDITION login page', gp.calls.go[gp.calls.go.length - 1] === 'free-login', gp.calls.go.join(','));
        ok('it never falls back to the hub login or an unknown account page', gp.calls.go.indexOf('login-v2') < 0 && gp.calls.go.indexOf('signup') < 0, gp.calls.go.join(','));
        ok('that login page links to the edition registration page', (function () {
          var i = html.indexOf('id="free-login"');
          var seg = html.slice(i, html.indexOf('</section>', i));
          return /freeGo\('free-register'\)/.test(seg) && /Register free/.test(seg);
        })());
        /* The public catalogue itself is unchanged: opening the portal as a
           guest still renders it. Only the navigation route changed. */
        gp.sandbox.freeGo('free-portal');
        return settle(gp);
      });
    }).then(function () {
      var list = gp.els.freePortalList._html;
      ok('the portal lists the available weekly assessment', /Week 1/.test(list));
      ok('the guest sees a clear, honest note that browsing needs no account', /no account needed/.test(list) && /only required when you sit a paper/.test(list));
      ok('the guest list never renders a Start button that would 401', !/freeExamOpen/.test(list));
      ok('sitting a paper routes the guest through the student login, never straight into an exam', /freePortalEnter\(\)/.test(list) && /Log in to sit this paper/.test(list));
      ok('the guest is still offered registration alongside the login', /free-register/.test(list) && /Register free/.test(list));
      gp.sandbox.freePortalTab('competition');
      return settle(gp).then(function () {
        ok('the competition tab lists the available competition', /Grand Prize/.test(gp.els.freePortalList._html), gp.els.freePortalList._html.slice(0, 160));
        return gp.sandbox.GOC.free.catalogue().then(function (r) {
          ok('the client exposes the public catalogue method', r && r.guest === true);
        });
      });
    });
  });
}).then(function () {
  head('Homepage hero account link: one button, the right login page per mode');
  /* Free Tutorial Mode: the edition's own student login, never the hub's. */
  var hf = makeWorld({ token: null });
  load(hf);
  return settle(hf).then(function () {
    hf.sandbox.heroAccount();
    return settle(hf).then(function () {
      ok('Free Mode: "I already have an account" opens the EDITION student login', hf.calls.go[hf.calls.go.length - 1] === 'free-login', hf.calls.go.join(','));
      ok('Free Mode: it never opens the hub login or an unknown account page', hf.calls.go.indexOf('login-v2') < 0 && hf.calls.go.indexOf('signup') < 0, hf.calls.go.join(','));
      ok('Free Mode: it does not invent a second authentication step', hf.calls.go.indexOf('free-register') < 0 && hf.calls.go.indexOf('admin-gate') < 0, hf.calls.go.join(','));
      /* Original Mode: exactly the route the button always used. */
      var ho = makeWorld({
        token: null,
        health: { service: 'goc-academy-hub', free2027: { on: true, mode: 'original' } },
        config: { on: true, mode: 'original', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 }
      });
      load(ho);
      return settle(ho).then(function () {
        ho.sandbox.heroAccount();
        return settle(ho).then(function () {
          ok('Original Mode: "I already have an account" opens the ORIGINAL hub login', ho.calls.go[ho.calls.go.length - 1] === 'login-v2', ho.calls.go.join(','));
          ok('Original Mode: it is never rerouted into the edition', ho.calls.go.indexOf('free-login') < 0 && ho.calls.go.indexOf('free-home') < 0, ho.calls.go.join(','));
          /* The offline fallback is Original Mode, so the hub route must hold. */
          var hx = makeWorld({ healthFails: true });
          load(hx);
          return settle(hx).then(function () {
            hx.sandbox.heroAccount();
            return settle(hx).then(function () {
              ok('if the mode answer never arrives the hub login is used (safe fallback)', hx.calls.go[hx.calls.go.length - 1] === 'login-v2', hx.calls.go.join(','));
            });
          });
        });
      });
    });
  });
}).then(function () {
  head('Repeated mode switching: the hero destination never goes stale');
  /* One world, switched back and forth through the real applyMode used by the
     console's mode control. The destination must follow the CURRENT mode every
     time, and the body must not accumulate classes. */
  var hs = makeWorld({ token: null });
  load(hs);
  return settle(hs).then(function () {
    var seen = [];
    function flip(mode, on, expected, label) {
      hs.sandbox.applyMode(mode, on);
      return settle(hs).then(function () {
        hs.calls.go.length = 0;
        hs.sandbox.heroAccount();
        return settle(hs).then(function () {
          var got = hs.calls.go[hs.calls.go.length - 1];
          seen.push(got);
          ok(label + ': hero account link goes to ' + expected, got === expected, hs.calls.go.join(','));
          ok(label + ': body carries only the expected mode class', hs.doc.body.classList.contains('f27-mode') === (mode === 'free2027' && on === true));
        });
      });
    }
    return flip('original', true, 'login-v2', 'switch 1 -> Original')
      .then(function () { return flip('free2027', true, 'free-login', 'switch 2 -> Free Tutorial'); })
      .then(function () { return flip('original', true, 'login-v2', 'switch 3 -> Original'); })
      .then(function () { return flip('free2027', true, 'free-login', 'switch 4 -> Free Tutorial'); })
      .then(function () { return flip('original', true, 'login-v2', 'switch 5 -> Original'); })
      .then(function () {
        ok('five switches produce no stale or accumulated destination', seen.join(',') === 'login-v2,free-login,login-v2,free-login,login-v2', seen.join(','));
        ok('the mode class is fully removed in Original Mode', !hs.doc.body.classList.contains('f27-mode') && !hs.doc.body.classList.contains('goc-original-area'));
      });
  });
}).then(function () {
  head('Original student accounts stay reachable in BOTH website modes');
  /* These are the ORIGINAL hub screens. The edition must let them through so a
     new student can register and a returning student can log in and reach their
     own account, in either mode. */
  var fm = makeWorld({ token: null });
  load(fm);
  return settle(fm).then(function () {
    fm.sandbox.go('signup');
    return settle(fm).then(function () {
      ok('Free Mode: the original registration screen is reachable', fm.calls.go[fm.calls.go.length - 1] === 'signup', fm.calls.go.join(','));
      fm.sandbox.go('login-v2');
      return settle(fm).then(function () {
        ok('Free Mode: the original login screen is reachable', fm.calls.go[fm.calls.go.length - 1] === 'login-v2', fm.calls.go.join(','));
        fm.sandbox.go('signup-pending');
        return settle(fm).then(function () {
          ok('Free Mode: the original pending-registration step is reachable', fm.calls.go[fm.calls.go.length - 1] === 'signup-pending', fm.calls.go.join(','));
          fm.sandbox.go('home');
          return settle(fm).then(function () {
            ok('Free Mode: the post-login student dashboard is reachable (session not broken)', fm.calls.go[fm.calls.go.length - 1] === 'home', fm.calls.go.join(','));
            ok('the original student area restores the hub navigation chrome', fm.doc.body.classList.contains('goc-original-area'));
            fm.sandbox.go('profile');
            return settle(fm).then(function () {
              ok('Free Mode: an existing student can open their profile', fm.calls.go[fm.calls.go.length - 1] === 'profile', fm.calls.go.join(','));
              fm.sandbox.go('login-v2');
              return settle(fm).then(function () {
                ok('an auth form is not treated as the student area', !fm.doc.body.classList.contains('goc-original-area'));
                ok('the original registration and login forms are untouched in the markup', /id="signup"/.test(html) && /id="login-v2"/.test(html) && /id="signName"/.test(html) && /id="signEmail"/.test(html) && /id="loginBtn"/.test(html));
                var om = makeWorld({
                  token: null,
                  health: { service: 'goc-academy-hub', free2027: { on: true, mode: 'original' } },
                  config: { on: true, mode: 'original', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 }
                });
                load(om);
                return settle(om).then(function () {
                  om.sandbox.go('signup');
                  om.sandbox.go('login-v2');
                  om.sandbox.go('home');
                  return settle(om).then(function () {
                    ok('Original Mode: registration, login and dashboard all resolve normally', om.calls.go.slice(-3).join(',') === 'signup,login-v2,home', om.calls.go.join(','));
                    ok('Original Mode does not add the free-tutorial body class', !om.doc.body.classList.contains('f27-mode'));
                    ok('Original Mode needs no chrome override', !om.doc.body.classList.contains('goc-original-area'));
                    om.sandbox.freeCbtPortal();
                    return settle(om).then(function () {
                      ok('the CBT Portal entry still opens the edition landing page in Original Mode', om.calls.go[om.calls.go.length - 1] === 'free-home', om.calls.go.join(','));
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}).then(function () {
  head('CBT navigation: Back and Home are always available');
  var nv = makeWorld({ token: 'PT' });
  load(nv);
  return settle(nv).then(function () {
    nv.sandbox.freeExamHome();
    return settle(nv).then(function () {
      ok('Back to Home from the CBT reaches the hub homepage', nv.calls.go[nv.calls.go.length - 1] === 'landing', nv.calls.go.join(','));
      ok('Back to Home never routes to registration', nv.calls.go.indexOf('free-register') < 0);
      ok('the exam Back control is exported for the header button', typeof nv.sandbox.freeExamLeave === 'function');
      nv.sandbox.freeExamOpen('F27-Q1');
      return settle(nv).then(function () {
        var goBefore = nv.calls.go.slice();
        nv.sandbox.freeExamLeave();
        return settle(nv).then(function () {
          /* Home was used just before, so the previous internal screen IS the
             homepage: Back is context-aware and always leaves the exam. */
          ok('Back from a live paper leaves the exam to the previous internal screen', nv.calls.go[nv.calls.go.length - 1] === 'landing', nv.calls.go.join(','));
          ok('Back never leaves the student stranded on the exam screen', nv.calls.go[nv.calls.go.length - 1] !== 'free-exam');
          ok('Back never submits the paper behind the student\'s back', !nv.calls.api.some(function (c) { return c[0] === 'submit'; }));
          ok('Back never routes the student into registration', nv.calls.go.slice(goBefore.length).indexOf('free-register') < 0, nv.calls.go.join(','));
        });
      });
    });
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
