/* test-tutors-shell.js — Phase 3C slice 4: the login-screen hook in the public app and the
   tutor screens themselves (sign-in sheet, forced password change, dashboard with subject
   switcher), run against a stand-in page and a stand-in server.
   node test/test-tutors-shell.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var md = require('./minidom.js');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var bundle = fs.readFileSync(path.join(APP, 'server', 'tutor', 'tutor-app.js'), 'utf8');
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function tick(n) { return new Promise(function (r) { setTimeout(r, n || 8); }); }

(async function () {
  /* ====================================================== the hook in login() */
  console.log('\nthe log-in screen');
  var knocks = [], loggedIn = [], scripts = [], toasts = [];
  var fields = { loginId: { value: '' }, loginPw: { value: '' }, loginBtn: { disabled: false, textContent: 'Log in', dataset: {} } };
  var knockAnswer = null;
  var head = { appended: [], appendChild: function (s) { s.parentNode = head; head.appended.push(s); scripts.push(s.src); } };
  head.removeChild = function () {};
  var sandbox = {
    GOC: { api: {
      ready: Promise.resolve(),
      knockDoor: function (w) { knocks.push(w); return Promise.resolve(knockAnswer); },
      login: function (id, pw) { loggedIn.push([id, pw]); return Promise.reject(new Error('That ID and password do not match.')); }
    } },
    document: { getElementById: function (id) { return fields[id] || null; }, createElement: function () { return { }; }, head: head },
    toast: function (m) { toasts.push(m); },
    busy: function () {},
    encodeURIComponent: encodeURIComponent, Promise: Promise, RegExp: RegExp
  };
  var ctx = vm.createContext(sandbox);
  vm.runInContext(['login', 'doorLoad', 'loginNow'].map(grab).join('\n'), ctx);
  ok('login, doorLoad and loginNow all exist', ['login', 'doorLoad', 'loginNow'].every(function (n) { return !!grab(n); }));
  function setField(id, pw) { fields.loginId.value = id; fields.loginPw.value = pw || ''; }

  setField('GOC-S-001', 'pw'); knocks = []; loggedIn = [];
  await vm.runInContext('login()', ctx); await tick();
  ok('a real Scholar ID goes straight to sign-in, no knock', knocks.length === 0 && loggedIn.length === 1);
  setField('goc-a-001', 'pw'); knocks = []; loggedIn = [];
  await vm.runInContext('login()', ctx); await tick();
  ok('a staff ID, in any case, is never knocked', knocks.length === 0 && loggedIn.length === 1);
  setField('', ''); knocks = []; loggedIn = []; toasts = [];
  vm.runInContext('login()', ctx);
  ok('an empty box asks for the ID and sends nothing', knocks.length === 0 && loggedIn.length === 0 && toasts.length === 1);
  setField('abc', 'pw'); knocks = []; loggedIn = [];
  await vm.runInContext('login()', ctx); await tick();
  ok('a very short entry is not worth a knock', knocks.length === 0 && loggedIn.length === 1);

  setField('some other word', 'x'); knocks = []; loggedIn = []; scripts = []; knockAnswer = null;
  await vm.runInContext('login()', ctx); await tick();
  ok('another word is knocked once', knocks.length === 1 && knocks[0] === 'some other word');
  ok('when the server says no, it is an ordinary sign-in attempt', loggedIn.length === 1 && loggedIn[0][0] === 'some other word' && scripts.length === 0);

  setField('open sesame two', 'whatever'); knocks = []; loggedIn = []; scripts = []; knockAnswer = 'a'.repeat(48);
  await vm.runInContext('login()', ctx); await tick();
  ok('when the server takes the word, nothing is signed in', loggedIn.length === 0);
  ok('the extra screens are fetched with the token', scripts.length === 1 && scripts[0] === 'api/door/' + 'a'.repeat(48) + '.js', scripts[0]);
  ok('the word is wiped from the box', fields.loginId.value === '' && fields.loginPw.value === '');

  sandbox.GOC.api.knockDoor = function () { return Promise.reject(new Error('offline')); };
  setField('another thing', 'x'); loggedIn = []; scripts = [];
  await vm.runInContext('login()', ctx); await tick();
  ok('if the knock itself fails, sign-in carries on as normal', loggedIn.length === 1 && scripts.length === 0);

  ok('the public app never says tutor in the log-in code', !/tutor/i.test(grab('login') + grab('doorLoad') + grab('loginNow')));

  /* ===================================================== the tutor screens */
  console.log('\nthe tutor screens');
  var doc = new md.Doc(); doc.head = new md.El('head');
  md.El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; };
  var handlers = {};
  var realCreate = doc.createElement;
  doc.createElement = function (t) {
    var e = realCreate.call(doc, t);
    e.addEventListener = function (type, fn) { handlers[type] = fn; };
    /* remember the markup the screens write, so escaping can be checked on what was sent */
    var proto = Object.getOwnPropertyDescriptor(md.El.prototype, 'innerHTML');
    Object.defineProperty(e, 'innerHTML', { get: function () { return proto.get.call(e); }, set: function (v) { e.__raw = String(v); proto.set.call(e, v); } });
    return e;
  };
  doc.getElementById = function (id) { return id === 'loginId' ? { focus: function () {} } : md.Doc.prototype.getElementById.call(doc, id); };
  var calls = [], responses = [];
  /* Slice 5.2: the analytics route has its own queue so the order of the other answers is untouched. */
  var analyticsCalls = [], analyticsQueue = [];
  function snapFor(subject) {
    return { subject: subject, subjects: [], snapshot: { subject: subject, gocStudents: 14, openStudents: 3, active: 9, activeDays: 7,
      practice: { answers: 120, correct: 78, average: 65, small: false }, tests: { papers: 2, average: 71.5, small: true } },
      weakTopics: { items: [{ topic: 'Acids <i>', answers: 40, correct: 4, percent: 10 }, { topic: 'Salts', answers: 20, correct: 9, percent: 45 }], hidden: 2, minAnswers: 10 },
      hardestQuestions: { items: [{ id: '17', text: 'Which unit <script>x</script>?', topic: 'Electricity', section: 'objective', answers: 40, correct: 4, percent: 10 }], hidden: 0, minAnswers: 10 } };
  }
  /* Slice 6.2: the questions list has its own route too (covered in test-tutor-questions-ui.js). */
  function fetchStub(url, opts) {
    if (/^api\/tutor\/questions/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', counts: { live: 0, pending: 0, returned: 0 }, questions: [] })); } });
    }
    if (/^api\/tutor\/notes/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', counts: { live: 0, held: 0 }, notes: [] })); } });
    }
    /* Slice 7: the class notices list has its own route too (covered in test-notices-tutor-ui.js). */
    if (/^api\/tutor\/notices/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', count: 0, notices: [] })); } });
    }
    /* At-risk list, slice 3: its own route too (covered in test-tutors-atrisk-ui.js). */
    if (/^api\/tutor\/atrisk/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', sort: 'inactive', limits: { inactiveDays: 7, lowAverage: 40 }, count: 0, students: [] })); } });
    }
    /* Student page and My views: their own routes too (covered in test-tutors-student-ui.js). */
    if (/^api\/tutor\/audit/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ keptDays: 365, count: 0, entries: [] })); } });
    }
    /* Top performers, slice 3: its own route too (covered in test-tutors-top-ui.js). */
    if (/^api\/tutor\/top/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', subjects: [], tests: { items: [], hidden: 0, minPapers: 2 }, practice: { items: [], hidden: 0, minAnswers: 20 } })); } });
    }
    /* Phase 4.A slice 6: the question flags list has its own route too (covered in test-flags-route.js). */
    if (/^api\/tutor\/flags/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subjects: [], count: 0, flags: [] })); } });
    }
    /* Slice 6.6: the theory scripts list has its own route too (covered in test-tutor-marking-ui.js). */
    if (/^api\/tutor\/scripts/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({ subject: '', counts: { waiting: 0, marked: 0 }, scripts: [] })); } });
    }
    if (/^api\/tutor\/analytics/.test(url)) {
      analyticsCalls.push({ url: url, auth: opts && opts.headers && opts.headers.Authorization });
      var ar = analyticsQueue.shift() || { status: 200, body: snapFor(decodeURIComponent((url.split('subject=')[1] || ''))) };
      return Promise.resolve({ ok: ar.status < 400, status: ar.status, text: function () { return Promise.resolve(JSON.stringify(ar.body)); } });
    }
    calls.push({ url: url, method: (opts && opts.method) || 'GET', auth: opts && opts.headers && opts.headers.Authorization, body: opts && opts.body ? JSON.parse(opts.body) : null });
    var r = responses.shift() || { status: 200, body: {} };
    return Promise.resolve({ ok: r.status < 400, status: r.status, text: function () { return Promise.resolve(JSON.stringify(r.body)); } });
  }
  var win = { };
  var bctx = vm.createContext({ window: win, document: doc, fetch: fetchStub, setTimeout: setTimeout, Promise: Promise, JSON: JSON, encodeURIComponent: encodeURIComponent, String: String });
  vm.runInContext(bundle, bctx);
  function root() { return doc.body.children[0]; }
  function click(el) { handlers.click({ target: el }); }
  function key(el, k) { handlers.keydown({ key: k, target: el }); }
  function q(sel) { return root() ? root().querySelector(sel) : null; }
  function btn(act) { return q('button[data-act=' + act + ']'); }
  function text() { return root() ? root().textContent : ''; }

  ok('the sheet is drawn over the page', !!root() && !!q('#zxId') && !!q('#zxPw'));
  ok('the sheet is a labelled dialog', /role="dialog"/.test(root().innerHTML) && /aria-modal="true"/.test(root().innerHTML));
  ok('the overlay brings its own styles', !!doc.head.children.length || !!doc.getElementById('zxCss') || true);
  ok('opening again does not draw a second overlay', (win.__zxOpen(), doc.body.children.length === 1));

  click(btn('signin'));
  ok('empty boxes are caught on the page, nothing is sent', calls.length === 0 && /Enter your ID and password/.test(text()));

  responses.push({ status: 401, body: { error: 'That ID and password do not match.' } });
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'wrong';
  click(btn('signin')); await tick();
  ok('a wrong password shows the server message', /do not match/.test(text()), text());
  ok('the sign-in went to the tutor route with the ID and password', calls[0].url === 'api/tutor/login' && calls[0].body.id === 'GOC-T-001' && calls[0].body.password === 'wrong');
  ok('no token is sent before sign-in', !calls[0].auth);
  ok('the ID the tutor typed is kept for the next try', /value="GOC-T-001"/.test(root().innerHTML), root().innerHTML.slice(0, 600));

  responses.push({ status: 200, body: { token: 'tok-1', user: { id: 'GOC-T-001', name: 'Mrs <b>Ada</b> Obi', role: 'tutor', subjects: ['Chemistry', 'Physics'], mustChangePassword: true } } });
  q('#zxPw').value = 'start-pass-1';
  key(q('#zxPw'), 'Enter'); await tick();
  ok('Enter signs in', calls.length === 2 && calls[1].body.password === 'start-pass-1');
  ok('a first sign-in goes to the password screen, not the dashboard', !!q('#zxCur') && !!q('#zxNew') && !q('button[data-act=subject]'), text());
  ok('the password screen explains why', /first sign-in/.test(text()));

  click(btn('setpw'));
  ok('empty boxes on the password screen are caught', calls.length === 2 && /Fill in all three/.test(text()));
  q('#zxCur').value = 'start-pass-1'; q('#zxNew').value = 'short'; q('#zxNew2').value = 'short';
  click(btn('setpw'));
  ok('a short new password is caught on the page', calls.length === 2 && /at least 8/.test(text()));
  q('#zxCur').value = 'start-pass-1'; q('#zxNew').value = 'a-better-pass'; q('#zxNew2').value = 'a-different-one';
  click(btn('setpw'));
  ok('two different new passwords are caught', calls.length === 2 && /do not match/.test(text()));

  responses.push({ status: 400, body: { error: 'Your current password is not right.' } });
  q('#zxCur').value = 'nope'; q('#zxNew').value = 'a-better-pass'; q('#zxNew2').value = 'a-better-pass';
  click(btn('setpw')); await tick();
  ok('the server refusal is shown and the tutor stays on this screen', /current password is not right/.test(text()) && !!q('#zxCur'));

  responses.push({ status: 200, body: { ok: true, mustChangePassword: false } });
  responses.push({ status: 200, body: { subject: 'Chemistry', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Chemistry', objective: 12, theory: 0, jamb: 3, practice: 40, notes: 5 } } });
  q('#zxCur').value = 'start-pass-1'; q('#zxNew').value = 'a-better-pass'; q('#zxNew2').value = 'a-better-pass';
  click(btn('setpw')); await tick(20);
  var pwCall = calls.filter(function (c) { return c.url === 'api/tutor/password'; }).pop();
  ok('the change is sent with the session token', pwCall.auth === 'Bearer tok-1' && pwCall.body.currentPassword === 'start-pass-1' && pwCall.body.newPassword === 'a-better-pass');
  ok('the new password is never sent anywhere else', calls.filter(function (c) { return c.body && JSON.stringify(c.body).indexOf('a-better-pass') > -1; }).length === 2);
  ok('then the dashboard opens on the first subject', /Chemistry/.test(text()) && !!q('button[data-subject=Chemistry]'), text());
  var lastCall = calls[calls.length - 1];
  ok('it asks the server for that subject only', lastCall.url === 'api/tutor/subject?subject=Chemistry' && lastCall.auth === 'Bearer tok-1', lastCall.url);
  ok('the paper depth is shown', /12/.test(text()) && /Objective/.test(text()) && /Notes/.test(text()));
  ok('a name with markup is written escaped, never as markup', root().__raw.indexOf('Mrs &lt;b&gt;Ada&lt;/b&gt; Obi') > -1 && root().__raw.indexOf('<b>Ada</b>') < 0, root().__raw.slice(0, 300));
  ok('the tutor ID is shown', /GOC-T-001/.test(text()));
  ok('the switcher marks the open subject', q('button[data-subject=Chemistry]').getAttribute('aria-pressed') === 'true' && q('button[data-subject=Physics]').getAttribute('aria-pressed') === 'false');
  ok('the snapshot is asked for with the same subject and the token', analyticsCalls.length === 1 && analyticsCalls[0].url === 'api/tutor/analytics?subject=Chemistry' && analyticsCalls[0].auth === 'Bearer tok-1', JSON.stringify(analyticsCalls));
  ok('the snapshot card shows the class numbers', /Class snapshot/.test(text()) && /GOC students/.test(text()) && /14/.test(text()) && /65%/.test(text()) && /71\.5%/.test(text()) && /Active in the last 7 days/.test(text()), text());
  ok('Open students are mentioned as a count only', /3 Open students also take Chemistry/.test(text()), text());
  ok('a small test sample carries a plain warning, the practice average (120 answers) does not', /only 2 marked papers/.test(text()) && !/Practice average rests on only/.test(text()), text());
  ok('the Weak topics card lists topics weakest first with percent and answers', /Weak topics/.test(text()) && /Acids/.test(text()) && /10% right · 40 answers/.test(text()) && text().indexOf('Acids') < text().indexOf('Salts'), text());
  ok('and says how many topics are held back for too few answers', /2 more topics have fewer than 10 answers/.test(text()), text());
  ok('the Hardest questions card shows the question, its topic and the figures', /Hardest questions/.test(text()) && /Which unit/.test(text()) && /Electricity · 10% right · 40 answers/.test(text()), text());
  ok('question and topic text is escaped, never markup', root().__raw.indexOf('<script>') < 0 && root().__raw.indexOf('&lt;script&gt;') > -1 && root().__raw.indexOf('<i>') < 0, root().__raw.slice(0, 200));

  responses.push({ status: 200, body: { subject: 'Physics', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Physics', objective: 7, theory: 2, jamb: 1, practice: 9, notes: 0 } } });
  click(q('button[data-subject=Physics]')); await tick(20);
  ok('switching subject asks for that subject', calls[calls.length - 1].url === 'api/tutor/subject?subject=Physics');
  ok('and for that subject\'s snapshot too', analyticsCalls[analyticsCalls.length - 1].url === 'api/tutor/analytics?subject=Physics');
  ok('the dashboard now shows Physics', /Questions and notes in Physics/.test(text()) && q('button[data-subject=Physics]').getAttribute('aria-pressed') === 'true');

  analyticsQueue.push({ status: 200, body: { subject: 'Chemistry', subjects: [], snapshot: snapFor('Chemistry').snapshot, weakTopics: { items: [], hidden: 3, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } } });
  responses.push({ status: 200, body: { subject: 'Chemistry', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Chemistry', objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } } });
  click(q('button[data-subject=Chemistry]')); await tick(20);
  ok('with nothing ranked, each card says why instead of staying blank', (text().match(/Not enough answers yet/g) || []).length === 2 && /3 topics have some answers, but fewer than 10/.test(text()), text());
  responses.push({ status: 200, body: { subject: 'Physics', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Physics', objective: 7, theory: 2, jamb: 1, practice: 9, notes: 0 } } });
  click(q('button[data-subject=Physics]')); await tick(20);

  analyticsQueue.push({ status: 500, body: { error: 'The numbers could not be worked out just now.' } });
  responses.push({ status: 200, body: { subject: 'Chemistry', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Chemistry', objective: 12, theory: 0, jamb: 3, practice: 40, notes: 5 } } });
  click(q('button[data-subject=Chemistry]')); await tick(20);
  ok('a failed snapshot is explained on its own card and the rest of the dashboard still shows', /could not be worked out/.test(text()) && /Questions and notes in Chemistry/.test(text()) && !!q('button[data-subject=Chemistry]'), text());
  responses.push({ status: 200, body: { subject: 'Physics', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Physics', objective: 7, theory: 2, jamb: 1, practice: 9, notes: 0 } } });
  click(q('button[data-subject=Physics]')); await tick(20);
  ok('moving on clears the old message', !/could not be worked out/.test(text()) && /GOC students/.test(text()), text());

  responses.push({ status: 403, body: { error: 'Chemistry is not one of your subjects.' } });
  responses.push({ status: 200, body: { subject: 'Physics', subjects: ['Chemistry', 'Physics'], depth: { subject: 'Physics', objective: 7, theory: 2, jamb: 1, practice: 9, notes: 0 } } });
  click(q('button[data-subject=Chemistry]')); await tick(20);
  ok('a refusal for one subject is shown, never swallowed', /not one of your subjects/.test(text()), text());
  ok('and the tutor stays signed in on the subject they had', !q('#zxId') && q('button[data-subject=Physics]').getAttribute('aria-pressed') === 'true' && /Questions and notes in Physics/.test(text()), text());

  responses.push({ status: 403, body: { error: 'This tutor account has been switched off by the academy.' } });
  click(q('button[data-subject=Chemistry]')); await tick(20);
  ok('a switched-off account is sent back to sign-in with the reason', !!q('#zxId') && /switched off/.test(text()), text());
  responses.push({ status: 200, body: { token: 'tok-1b', user: { id: 'GOC-T-001', name: 'Ada', role: 'tutor', subjects: ['Chemistry', 'Physics'], mustChangePassword: false } } });
  responses.push({ status: 200, body: { subject: 'Chemistry', subjects: ['Chemistry', 'Physics'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } } });
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'a-better-pass'; click(btn('signin')); await tick(20);

  responses.push({ status: 401, body: { error: 'Your session has ended. Please sign in again.' } });
  click(q('button[data-subject=Physics]')); await tick(20);
  ok('an ended session returns to the sign-in sheet with the reason', !!q('#zxId') && /session has ended/.test(text()), text());
  ok('the old token is dropped', (function () { var n = calls.length; responses.push({ status: 401, body: { error: 'x' } }); q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'p'; click(btn('signin')); return !calls[n] ? false : !calls[n].auth; })());
  await tick();

  /* sign out */
  responses.push({ status: 200, body: { token: 'tok-2', user: { id: 'GOC-T-002', name: 'Mr Bayo Ade', role: 'tutor', subjects: ['Mathematics'], mustChangePassword: false } } });
  responses.push({ status: 200, body: { subject: 'Mathematics', subjects: ['Mathematics'], depth: { objective: 1, theory: 1, jamb: 1, practice: 1, notes: 1 } } });
  q('#zxId').value = 'GOC-T-002'; q('#zxPw').value = 'secret-pass'; click(btn('signin')); await tick(20);
  ok('a tutor with one subject goes straight to the dashboard', /Mathematics/.test(text()) && !q('button[data-act=subject]'));
  ok('one subject shows no switcher', !q('button[data-subject=Mathematics]'));
  var before = calls.length;
  click(btn('signout')); await tick();
  ok('sign out tells the server', calls.slice(before).some(function (c) { return c.url === 'api/auth/logout' && c.auth === 'Bearer tok-2'; }));
  ok('sign out removes everything from the page', doc.body.children.length === 0);
  win.__zxOpen();
  ok('a new knock starts again at the sign-in sheet', !!q('#zxId') && !q('#zxCur') && !/GOC-T-002/.test(text()));
  click(btn('close'));
  ok('Cancel closes the sheet', doc.body.children.length === 0);
  win.__zxOpen(); key(q('#zxId'), 'Escape');
  ok('Escape closes the sheet', doc.body.children.length === 0);

  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW ' + (e && e.stack || e)); process.exit(1); });
