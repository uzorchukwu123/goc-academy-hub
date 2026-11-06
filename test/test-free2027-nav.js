/* test-free2027-nav.js — recovered PR #9 navigation behaviour, integrated with
   the current OTP/bank/CBT edition: internal Back/Home history, the mode-
   specific drawer CBT Portal entry, mobile nav visibility, and exam-leave
   preservation. Static markup/CSS assertions plus a small vm harness.
   node test/test-free2027-nav.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html');
var css = read('css/free2027.css');
var styles = read('css/styles.css');
var sw = read('sw.js');
var uiSrc = read('js/free2027-ui.js');
var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 240) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------- markup */
head('Back and Home controls are present on every applicable Free Tutorial screen');
var screens = ['free-home', 'free-register', 'free-login', 'free-portal', 'free-result', 'free-leaderboard'];
screens.forEach(function (id) {
  var i = html.indexOf('id="' + id + '"');
  var j = html.indexOf('</section>', i);
  var seg = i > -1 ? html.slice(i, j > -1 ? j : i + 8000) : '';
  ok(id + ' has ← Back', /freeNavBack\(\)/.test(seg), seg.slice(0, 80));
  ok(id + ' has Home', /freeNavHome\(\)/.test(seg));
});
(function () {
  var i = html.indexOf('id="free-exam"');
  var seg = html.slice(i, html.indexOf('</section>', i));
  ok('free-exam has Back (leave, preserving the attempt)', /freeExamLeave\(\)/.test(seg));
})();
ok('the admin sign-in screen also keeps Back/Home', (function () {
  var i = html.indexOf('id="free-admin"');
  var seg = html.slice(i, html.indexOf('</section>', i));
  return /freeNavBack\(\)/.test(seg) && /freeNavHome\(\)/.test(seg);
})());

head('the controls are actually visible at mobile and desktop widths');
var flatCss = css.replace(/\s+/g, ' ');
ok('the hub really hides inline nav links on mobile (precondition)', /\.lp-nav \.lp-actions \.lp-link\s*\{\s*display:none/.test(styles.replace(/\s+/g, ' ')));
ok('the edition overrides it for its own screens (mobile + desktop)', /body\.f27-mode \.f27 \.f27-nav \.lp-actions \.lp-link/.test(flatCss) && /display: inline-block/.test(flatCss));
ok('the edition nav bar wraps instead of clipping on narrow phones', /@media \(max-width: 480px\)/.test(css) && /\.f27 \.f27-nav \{ flex-wrap: wrap/.test(flatCss));

head('mode-specific navigation drawer and inline actions');
ok('the drawer keeps the original Create free account button (not deleted)', /<button class="btn btn-red btn-block dw-original" onclick="dwGo\('signup'\)">Create free account<\/button>/.test(html));
ok('the drawer keeps the original Log in button (not deleted)', /class="btn btn-outline btn-block dw-original dw-hub-login" onclick="dwGo\('login-v2'\)"[^>]*>Log in</.test(html));
ok('the drawer has one CBT Portal action with supporting wording', /dw-cbt" onclick="dwFreePortal\(\)">CBT Portal</.test(html) && /Access your weekly assessments and competitions\./.test(html));
ok('the CBT Portal drawer entry is hidden in Original Mode (default)', /\.dw-cbt, \.dw-cbt-hint, #landing \.dw-cbt-link \{ display: none; \}/.test(flatCss));
/* Owner correction: the original student account actions must NEVER be hidden.
   Free Tutorial Mode only ADDS the CBT Portal entry beside them. */
ok('Free Tutorial Mode adds the drawer CBT Portal entry', /body\.f27-mode \.dw-btns \.dw-cbt \{ display: block; \}/.test(flatCss));
ok('no rule hides the original drawer account actions in any mode', !/\.dw-original \{ display: none/.test(flatCss));
ok('no rule hides the original inline-nav account actions in any mode', !/#landing \.lp-actions \.dw-original \{ display: none/.test(flatCss));
/* Owner correction: the hero's hub sign-up CTA is shown in Original Mode only.
   The unscoped check still proves no mode hides it unconditionally. */
var unscopedCss = flatCss.replace(/body\.f27-mode[^{}]*\{[^{}]*\}/g, '');
ok('no UNSCOPED rule hides the original hero sign-up CTA', !/\.hero-original-cta \{ display: none/.test(unscopedCss));
ok('the hero sign-up CTA is hidden in Free Tutorial Mode only', /body\.f27-mode #landing \.hero-btns \.hero-original-cta \{ display: none !important; \}/.test(flatCss));
ok('the hero sign-up CTA is still in the markup with its original handler', /class="lp-btn-light hero-original-cta" onclick="go\('signup'\)">Get started</.test(html));
ok('the hero account link routes by mode instead of a fixed hub destination', /class="lp-btn-ghost" onclick="heroAccount\(\)">I already have an account</.test(html));
ok('heroAccount picks the edition login in Free Mode and the hub login otherwise', /F\.heroAccount = function \(\) \{\s*global\.go\(F\.on && F\.mode === rules\.MODE_FREE \? 'free-login' : 'login-v2'\);/.test(uiSrc));
ok('desktop (>=900px) shows the inline CBT Portal entry', /@media \(min-width: 900px\) \{\s*body\.f27-mode #landing \.lp-actions \.dw-cbt-link \{ display: inline-block; \}\s*\}/.test(flatCss));
ok('the landing keeps its original Log in / Get started in the markup', /<button class="lp-link dw-original dw-hub-login" onclick="go\('login-v2'\)">Log in<\/button>/.test(html) && /<button class="lp-cta dw-original" onclick="go\('signup'\)">Get started<\/button>/.test(html));
/* Owner correction (navigation): the edition landing page is the single student
   entry point, so it no longer carries a duplicate Log in link in its own nav
   bar, and the hub's Log in shortcut stands down in Free Tutorial Mode only. */
(function () {
  var i = html.indexOf('id="free-home"');
  var seg = html.slice(i, html.indexOf('</div>\n      <div class="f27-hero">', i) > -1 ? html.indexOf('<div class="f27-hero">', i) : i + 2000);
  ok('the edition landing nav bar has no separate Log in link', !/>Log in</.test(seg), seg.slice(0, 400));
  ok('the edition landing nav bar still offers Register and CBT Portal', /freeHomeCta\(\)">Register</.test(seg) && /freePortalEnter\(\)">CBT Portal</.test(seg));
})();
ok('the landing page still offers Student log in and Enter the CBT Portal', /freePortalEnter\(\)">Student log in</.test(html) && /freePortalEnter\(\)">Enter the CBT Portal</.test(html));
ok('the hub Log in shortcut stands down in Free Tutorial Mode only', /body\.f27-mode \.dw-hub-login \{ display: none !important; \}/.test(flatCss));
ok('dwFreePortal is exposed by the edition script', /'dwFreePortal'/.test(uiSrc) && /F\.dwFreePortal = function/.test(uiSrc));

head('stale service-worker assets cannot serve the old handlers');
ok('the SW cache was bumped past v189', /const CACHE = 'goc-v(19[0-9]|[2-9]\d\d)'/.test(sw), sw.match(/const CACHE = '[^']+'/)[0]);
ok('the SW still precaches every edition asset', ['./js/free2027-ui.js', './js/free2027-admin.js', './js/goc-free-2027.js', './css/free2027.css', './index.html'].every(function (a) { return sw.indexOf("'" + a + "'") > -1; }));

/* ------------------------------------------------------- behaviour (vm) */
function El(tag) {
  var self = this;
  this.tagName = String(tag || 'div').toUpperCase();
  this.className = ''; this._text = ''; this._html = ''; this.hidden = false; this.disabled = false; this.value = '';
  this.dataset = {}; this.style = {}; this.attributes = {}; this.parentNode = null;
  this.classList = {
    add: function (c) { var a = self._p(); if (a.indexOf(c) < 0) a.push(c); self.className = a.join(' '); },
    remove: function (c) { self.className = self._p().filter(function (x) { return x !== c; }).join(' '); },
    contains: function (c) { return self._p().indexOf(c) > -1; },
    toggle: function (c, on) { var w = on === undefined ? !self.classList.contains(c) : !!on; if (w) self.classList.add(c); else self.classList.remove(c); return w; }
  };
}
El.prototype._p = function () { return String(this.className || '').split(/\s+/).filter(Boolean); };
Object.defineProperty(El.prototype, 'textContent', { get: function () { return this._text; }, set: function (v) { this._text = String(v == null ? '' : v); } });
Object.defineProperty(El.prototype, 'innerHTML', { get: function () { return this._html; }, set: function (v) { this._html = String(v == null ? '' : v); } });
El.prototype.getAttribute = function (k) { return this.attributes[k] === undefined ? null : this.attributes[k]; };
El.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
El.prototype.addEventListener = function () {};
El.prototype.focus = function () {};
El.prototype.insertAdjacentHTML = function (w, h) { this._html += h; };
El.prototype.closest = function () { return null; };
El.prototype.querySelectorAll = function () { return []; };

function makeWorld(opts) {
  var o = opts || {};
  var els = {};
  var calls = { go: [], api: [], confirms: [], toasts: [] };
  function el(id) { if (!els[id]) { els[id] = new El('div'); els[id].id = id; } return els[id]; }
  ['freeHomeOpen', 'freeHomeNote', 'freeHomeMode', 'freeWho', 'freePortalList', 'freePortalResults', 'freeExamTitle',
   'freeExamMeta', 'freeExamKind', 'freeExamNum', 'freeExamPanelLabel', 'freeExamPassage', 'freeExamImage', 'freeExamQ', 'freeExamOpts',
   'freeExamTime', 'freeExamSubmit', 'freeExamPanelGrid', 'freeExamPanelBack', 'freeExamPanel', 'freeExamConfirm', 'freeExamConfirmBack',
   'freeExamConfirmAnswered', 'freeExamConfirmUnanswered', 'freeExamConfirmTotal', 'freeResultBody',
   'freeBoardBody', 'freeRegErr', 'freeRegStep1', 'freeRegStep2', 'freeName', 'freeEmail', 'freeCourse',
   'freeCourseList', 'freeRegBtn', 'freeOtp', 'freeOtpErr', 'freeOtpTo', 'freeOtpDev', 'freeOtpBtn', 'freeOtpResendBtn',
   'freeProgramme', 'landing', 'free-home', 'free-register', 'free-portal', 'free-exam', 'free-result', 'free-leaderboard', 'free-admin', 'admin-gate', 'admin'
  ].forEach(el);
  var doc = {
    body: new El('body'), readyState: 'complete', listeners: {},
    getElementById: function (id) { return els[id] || null; },
    querySelectorAll: function () { return []; }, querySelector: function () { return null; },
    createElement: function (t) { return new El(t); }, addEventListener: function (t, fn) { doc.listeners[t] = fn; }
  };
  var session = { token: o.token || null };
  var api = {
    hasToken: function () { return !!session.token; },
    token: function () { return session.token; },
    config: function () { return Promise.resolve({ on: true, mode: 'free2027', courses: rules.DEFAULT_COURSES, otp: { length: 6 }, topN: 10 }); },
    registerStart: function () { return Promise.resolve({ sent: true, delivered: true }); },
    registerVerify: function () { return Promise.resolve({ token: 'T1', participant: { id: 'GOC-F27-0123456789ABCDEF0123', name: 'Ada' } }); },
    me: function () { return session.token ? Promise.resolve({ participant: { id: 'GOC-F27-0123456789ABCDEF0123', name: 'Ada' } }) : Promise.reject(new Error('401')); },
    logout: function () { calls.api.push(['logout']); session.token = null; return Promise.resolve({ ok: true }); },
    activities: function () { calls.api.push(['activities']); return Promise.resolve({ activities: [], participant: { id: 'GOC-F27-0123456789ABCDEF0123', name: 'Ada' } }); },
    /* Public catalogue used by the direct, registration-free CBT Portal entry. */
    catalogue: function () { calls.api.push(['catalogue']); return Promise.resolve(o.catalogueReply || { guest: true, activities: [] }); },
    results: function () { calls.api.push(['results']); return Promise.resolve({ results: [] }); },
    programme: function () { return Promise.resolve({ profile: { id: 'GOC-F27-0123456789ABCDEF0123', name: 'Ada', course: 'Law' }, enrolment: {}, access: {}, progress: { lessons: [], completed: 0, total: 0, percent: 0 }, quizzes: {} }); },
    leaderboards: function () { return Promise.resolve({ leaderboards: [] }); },
    leaderboard: function () { return Promise.resolve({ leaderboard: { rows: [], totalCompetitors: 0 }, mine: null }); },
    start: function (id) { calls.api.push(['start', id]); return Promise.resolve(o.startAttempt || { attempt: { id: 'F27-A1', title: 'Week 1', kind: 'weekly', remainingSec: 600, responses: {} }, questions: o.questions || [], resumed: false }); },
    answer: function (a, q, c) { calls.api.push(['answer', a, q, c]); return Promise.resolve({ saved: true }); },
    submit: function (a, r) { calls.api.push(['submit', a, r]); return Promise.resolve({ result: { title: 'Week 1', score: 1, maxScore: 2 } }); }
  };
  var sb = {
    console: console, document: doc, Promise: Promise,
    setTimeout: function (fn) { fn(); return 0; }, setInterval: function () { return 1; }, clearInterval: function () {},
    Date: { now: function () { return 1000000; }, UTC: Date.UTC },
    fetch: function () { var health = { service: 'goc-academy-hub', free2027: { on: true, mode: 'free2027' } }; return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(health)); }, json: function () { return Promise.resolve(health); } }); },
    confirm: function (m) { calls.confirms.push(m); return o.confirmAnswer !== false; },
    toast: function (m) { calls.toasts.push(m); },
    history: { length: 2, back: function () { calls.go.push('__historyBack__'); } },
    closeDrawer: function () { calls.api.push(['closeDrawer']); },
    go: function (id) {
      calls.go.push(id);
      ['landing', 'free-home', 'free-portal', 'free-result', 'free-exam', 'free-leaderboard', 'free-register', 'free-admin', 'admin-gate'].forEach(function (x) { var e = els[x]; if (e) e.classList.remove('active'); });
      if (els[id]) els[id].classList.add('active');
    }
  };
  sb.window = sb;
  sb.GOC = { free2027: rules, free: api, api: { ready: Promise.resolve('s') } };
  return { sandbox: sb, els: els, calls: calls, doc: doc };
}
function load(w) {
  var ctx = vm.createContext(w.sandbox);
  vm.runInContext('var window = this; var global = this;', ctx);
  vm.runInContext(uiSrc, ctx);
  w.booted = vm.runInContext('GOC.freeUI.ready()', ctx);
  return ctx;
}
function settle(w) {
  return Promise.resolve(w.booted).then(function () { return new Promise(function (r) { setTimeout(r, 20); }); }, function () { return new Promise(function (r) { setTimeout(r, 20); }); });
}

head('behaviour: the CBT Portal entry chain uses the current OTP session');
var w1 = makeWorld({});
load(w1);
settle(w1).then(function () {
  w1.sandbox.freeHomeCta();
  return settle(w1);
}).then(function () {
  ok('entry with NO session lands on registration', w1.calls.go[w1.calls.go.length - 1] === 'free-register', w1.calls.go.join(','));
  ok('no portal dashboard was opened without authentication', w1.calls.go.indexOf('free-portal') < 0);
  var w2 = makeWorld({ token: 'PT' });
  load(w2);
  return settle(w2).then(function () {
    w2.sandbox.freeHomeCta();
    return settle(w2).then(function () {
      ok('Register free always opens the registration page directly, whatever the session', w2.calls.go[w2.calls.go.length - 1] === 'free-register', w2.calls.go.join(','));
      w2.sandbox.freePortalEnter();
      return settle(w2).then(function () {
        ok('Enter the CBT Portal WITH a valid session goes straight to the dashboard', w2.calls.go[w2.calls.go.length - 1] === 'free-portal', w2.calls.go.join(','));
        w2.sandbox.freeSignOut();
        return settle(w2).then(function () {
          ok('logout calls the server and clears identity', w2.calls.api.some(function (c) { return c[0] === 'logout'; }));
          w2.sandbox.freePortalEnter();
          return settle(w2).then(function () {
            ok('after signing out, Enter the CBT Portal requires the edition login', w2.calls.go[w2.calls.go.length - 1] === 'free-login', w2.calls.go.join(','));
            ok('it never sends the student to the hub account login', w2.calls.go.indexOf('login-v2') < 0 && w2.calls.go.indexOf('signup') < 0, w2.calls.go.join(','));
          });
        });
      });
    });
  });
}).then(function () {
  head('behaviour: leaving an active exam preserves answers and time');
  var questions = [{ id: 11, text: 'Q1', options: ['a', 'b'] }, { id: 12, text: 'Q2', options: ['a', 'b'] }];
  var w = makeWorld({ token: 'PT', questions: questions, startAttempt: { attempt: { id: 'F27-A9', title: 'Week 1', kind: 'weekly', remainingSec: 600, responses: {} }, questions: questions, resumed: false } });
  load(w);
  return settle(w).then(function () {
    w.sandbox.go('free-portal');
    w.sandbox.freeExamOpen('F27-Q1');
    return settle(w).then(function () {
      w.sandbox.freeExamLeave();
      return settle(w).then(function () {
        ok('leaving asks for confirmation first', w.calls.confirms.length >= 1 && /saved/i.test(w.calls.confirms[0]), w.calls.confirms.join('|'));
        ok('leaving goes back to the portal, not a destroyed attempt', w.calls.go[w.calls.go.length - 1] === 'free-portal', w.calls.go.join(','));
        ok('leaving never submits the paper', !w.calls.api.some(function (c) { return c[0] === 'submit'; }));
        var w3 = makeWorld({ token: 'PT', questions: questions, confirmAnswer: false, startAttempt: { attempt: { id: 'F27-A9', title: 'Week 1', kind: 'weekly', remainingSec: 600, responses: {} }, questions: questions, resumed: false } });
        load(w3);
        return settle(w3).then(function () {
          w3.sandbox.freeExamOpen('F27-Q1');
          return settle(w3).then(function () {
            w3.sandbox.freeExamLeave();
            return settle(w3).then(function () {
              ok('declining the confirmation stays on the exam screen', w3.calls.go[w3.calls.go.length - 1] === 'free-exam', w3.calls.go.join(','));
              var w4 = makeWorld({});
              load(w4);
              return settle(w4).then(function () {
                w4.sandbox.dwFreePortal();
                return settle(w4).then(function () {
                  /* Corrected contract: every public CBT Portal entry opens the
                     Free UTME Tutorial LANDING page, which is where the student
                     chooses Register / Student log in / Enter the CBT Portal.
                     No account decision is made on the way in. */
                  ok('the drawer CBT Portal action closes the drawer and opens the Free Tutorial landing page', w4.calls.api.some(function (c) { return c[0] === 'closeDrawer'; }) && w4.calls.go[w4.calls.go.length - 1] === 'free-home', w4.calls.go.join(','));
                  ok('the CBT entry never routes a guest through registration or the hub accounts', w4.calls.go.indexOf('free-register') < 0 && w4.calls.go.indexOf('login-v2') < 0 && w4.calls.go.indexOf('signup') < 0, w4.calls.go.join(','));
                  ok('the homepage/desktop CBT entry opens the same landing page', (function () {
                    w4.calls.go.length = 0;
                    w4.sandbox.freeCbtPortal();
                    return w4.calls.go[w4.calls.go.length - 1] === 'free-home';
                  })(), w4.calls.go.join(','));
                  ok('Enter the CBT Portal with no session opens the edition login page', (function () {
                    w4.calls.go.length = 0;
                    w4.sandbox.freePortalEnter();
                    return w4.calls.go[w4.calls.go.length - 1] === 'free-login';
                  })(), w4.calls.go.join(','));
                  head('behaviour: Back uses internal history, Home goes to the hub homepage');
                  var w5 = makeWorld({ token: 'PT' });
                  load(w5);
                  return settle(w5).then(function () {
                    w5.sandbox.go('landing');
                    w5.sandbox.go('free-home');
                    w5.sandbox.go('free-register');
                    w5.sandbox.freeNavBack();
                    ok('Back from registration returns to the Free Tutorial homepage', w5.calls.go[w5.calls.go.length - 1] === 'free-home', w5.calls.go.join(','));
                    w5.sandbox.freeNavBack();
                    ok('Back from the Free Tutorial homepage returns to the main hub homepage', w5.calls.go[w5.calls.go.length - 1] === 'landing', w5.calls.go.join(','));
                    w5.sandbox.freeNavBack();
                    ok('Back with no internal previous screen falls back to the hub homepage', w5.calls.go[w5.calls.go.length - 1] === 'landing', w5.calls.go.join(','));
                    ok('Back never touches browser history (cannot exit to an external site)', w5.calls.go.indexOf('__historyBack__') < 0, w5.calls.go.join(','));
                    w5.sandbox.go('free-home');
                    w5.sandbox.go('free-register');
                    w5.sandbox.freeNavHome();
                    ok('Home always returns directly to the main hub homepage', w5.calls.go[w5.calls.go.length - 1] === 'landing', w5.calls.go.join(','));
                    w5.sandbox.freeGo('free-portal');
                    return settle(w5).then(function () {
                      var before = w5.calls.api.filter(function (c) { return c[0] === 'activities'; }).length;
                      w5.sandbox.go('free-result');
                      w5.sandbox.freeNavBack();
                      return settle(w5).then(function () {
                        var after = w5.calls.api.filter(function (c) { return c[0] === 'activities'; }).length;
                        ok('Back from a result refreshes the portal programme', w5.calls.go[w5.calls.go.length - 1] === 'free-portal' && after > before, before + ' -> ' + after);
                        w5.sandbox.freeNavHome();
                        w5.sandbox.go('free-register');
                        w5.sandbox.freeNavBack();
                        var homeBefore = w5.calls.api.filter(function (c) { return c[0] === 'activities'; }).length;
                        w5.sandbox.go('free-home');
                        w5.sandbox.go('free-register');
                        w5.sandbox.freeNavBack();
                        return settle(w5).then(function () {
                          var homeAfter = w5.calls.api.filter(function (c) { return c[0] === 'activities'; }).length;
                          ok('Back to the edition landing refreshes open activities', homeAfter > homeBefore, homeBefore + ' -> ' + homeAfter);
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
    });
  });
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  process.exit(1);
});
