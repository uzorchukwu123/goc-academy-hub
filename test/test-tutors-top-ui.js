/* test-tutors-top-ui.js — Phase 3C, top performers, slice 3: the Top performers card on the tutor dashboard, run against a
   stand-in page and a stand-in server.
   node test/test-tutors-top-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var md = require('./minidom.js');
var bundle = fs.readFileSync(path.join(APP, 'server', 'tutor', 'tutor-app.js'), 'utf8');
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 220) + ')' : '')); }
}
function tick(n) { return new Promise(function (r) { setTimeout(r, n || 10); }); }

(async function () {
  var doc = new md.Doc(); doc.head = new md.El('head');
  md.El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; };
  var handlers = {}, realCreate = doc.createElement;
  doc.createElement = function (t) {
    var e = realCreate.call(doc, t);
    e.addEventListener = function (type, fn) { handlers[type] = fn; };
    var proto = Object.getOwnPropertyDescriptor(md.El.prototype, 'innerHTML');
    Object.defineProperty(e, 'innerHTML', { get: function () { return proto.get.call(e); }, set: function (v) { e.__raw = String(v); proto.set.call(e, v); } });
    return e;
  };
  doc.getElementById = function (id) { return id === 'loginId' ? { focus: function () {} } : md.Doc.prototype.getElementById.call(doc, id); };

  var calls = [], testsRows = [], practiceRows = [], hiddenT = 0, hiddenP = 0, failNext = false;
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET';
    calls.push({ url: url, method: method, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } });
    if (/^api\/tutor\/top/.test(url)) {
      if (failNext) { failNext = false; return reply(500, { error: 'The top performers are not available.' }); }
      return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], tests: { items: testsRows, hidden: hiddenT, minPapers: 2 }, practice: { items: practiceRows, hidden: hiddenP, minAnswers: 20 } });
    }
    if (/^api\/tutor\/atrisk/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], sort: 'inactive', limits: { inactiveDays: 7, lowAverage: 40 }, count: 0, students: [] });
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, activity: { days: [], total: { answers: 0, tests: 0 } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (/^api\/tutor\/questions/.test(url)) return reply(200, { subject: 'Chemistry', counts: { live: 0, pending: 0, returned: 0 }, questions: [] });
    if (/^api\/tutor\/notes/.test(url)) return reply(200, { subject: 'Chemistry', counts: { live: 0, held: 0 }, notes: [] });
    if (/^api\/tutor\/notices/.test(url)) return reply(200, { subject: 'Chemistry', count: 0, notices: [] });
    if (/^api\/tutor\/scripts/.test(url)) return reply(200, { subject: 'Chemistry', counts: { waiting: 0, marked: 0 }, scripts: [] });
    return reply(200, {});
  }
  var win = {};
  var bctx = vm.createContext({ window: win, document: doc, fetch: fetchStub, setTimeout: setTimeout, Promise: Promise, JSON: JSON, encodeURIComponent: encodeURIComponent, String: String, Number: Number, Object: Object, Array: Array });
  bctx.window.confirm = function () { return true; };
  vm.runInContext(bundle, bctx);
  function root() { return doc.body.children[0]; }
  function click(el) { handlers.click({ target: el }); }
  function q(sel) { return root() ? root().querySelector(sel) : null; }
  function all(sel) { return root() ? root().querySelectorAll(sel) : []; }
  function text() { return root() ? root().textContent : ''; }
  function raw() { return root() ? root().__raw : ''; }
  function topCalls() { return calls.filter(function (c) { return /^api\/tutor\/top/.test(c.url); }); }
  function signIn() { q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123'; click(q('button[data-act=signin]')); return tick(60); }

  testsRows = [
    { id: 'GOC-S-021', name: 'Chidi <b>Okoro</b>', average: 91.5, papers: 3 },
    { id: 'GOC-S-022', name: 'Bisi Adeyemi', average: 80, papers: 2 },
    { id: 'GOC-S-023', name: 'Femi Lawal', average: 72.5, papers: 4 },
    { id: 'GOC-S-024', name: 'Kemi Ojo', average: 60, papers: 2 }
  ];
  practiceRows = [];
  for (var i = 1; i <= 14; i++) practiceRows.push({ id: 'GOC-S-1' + (i < 10 ? '0' : '') + i, name: 'Student ' + i, percent: 90 - i, answers: 20 + i, correct: 10 });
  hiddenT = 4; hiddenP = 1;
  await signIn();

  console.log('\nthe card');
  ok('the list is asked for with the subject and the token', topCalls()[0] && topCalls()[0].url === 'api/tutor/top?subject=Chemistry' && topCalls()[0].auth === 'Bearer tok-9', JSON.stringify(topCalls()[0]));
  ok('the card names the subject', /Top performers in Chemistry/.test(text()));
  ok('Web Tests is open first', q('button[data-tab=tests]').getAttribute('aria-pressed') === 'true' && q('button[data-tab=practice]').getAttribute('aria-pressed') === 'false');
  ok('each row shows name, Scholar ID and the figures', all('.zx-tplist li').length === 4 && /Femi Lawal/.test(text()) && /GOC-S-023/.test(text()) && /Average 72\.5% over 4 papers/.test(text()), text().slice(0, 500));
  ok('rank numbers only on the top three', all('.zx-rk').length === 3 && all('.zx-rk')[0].textContent === '1' && all('.zx-rk')[2].textContent === '3');
  ok('rows come in the server order (the app never sorts)', all('.zx-tplist li')[0].textContent.indexOf('Chidi') > -1 && all('.zx-tplist li')[3].textContent.indexOf('Kemi') > -1);
  ok('a name with markup is written escaped', /Chidi &lt;b&gt;Okoro&lt;\/b&gt;/.test(raw()) && !/<b>Okoro<\/b>/.test(raw()));
  ok('held-back students are a count only', /4 students need more work to be ranked\./.test(text()));
  ok('the card sits right after At-risk students and before Weak topics', raw().indexOf('At-risk students') < raw().indexOf('Top performers') && raw().indexOf('Top performers') < raw().indexOf('Weak topics'));

  console.log('\nthe tabs');
  var n0 = topCalls().length;
  click(q('button[data-tab=practice]'));
  ok('Practice shows its own list without asking the server again', topCalls().length === n0 && /Student 1GOC/.test(text()) && /89% right over 21 answers/.test(text()), text().slice(0, 400));
  ok('Practice is marked on and the lists are not blended', q('button[data-tab=practice]').getAttribute('aria-pressed') === 'true' && !/Chidi/.test(text()));
  ok('the held-back count follows the tab (singular)', /1 student needs more work to be ranked\./.test(text()));
  ok('ten rows at first, rank on three only', all('.zx-tplist li').length === 10 && all('.zx-rk').length === 3);
  ok('Show all 14 is offered', /Show all 14/.test(q('button[data-act=topall]').textContent));
  click(q('button[data-act=topall]'));
  ok('Show all reveals every row, still three ranks', all('.zx-tplist li').length === 14 && all('.zx-rk').length === 3 && /Show fewer/.test(q('button[data-act=topall]').textContent));
  click(q('button[data-tab=tests]'));
  ok('switching tab goes back to ten rows (no Show all on a short list)', all('.zx-tplist li').length === 4 && !q('button[data-act=topall]'));
  click(q('button[data-tab=practice]'));
  ok('and the Practice tab starts at ten again', all('.zx-tplist li').length === 10);

  console.log('\nempty, failed, and signing out');
  click(q('button[data-act=signout]')); await tick(30);
  ok('sign out clears the card from the page', !/Top performers/.test(text()) && !/Chidi/.test(text()));
  failNext = true;
  bctx.window.__zxOpen(); await tick(30); await signIn();
  ok('a failed load is explained on this card only', /The top performers are not available\./.test(text()) && /Class snapshot/.test(text()) && /At-risk students/.test(text()) && !q('.zx-tplist'), text().slice(0, 300));
  click(q('button[data-act=signout]')); await tick(30);
  testsRows = []; practiceRows = []; hiddenT = 0; hiddenP = 0;
  bctx.window.__zxOpen(); await tick(30); await signIn();
  ok('with nobody ranked the card says so and shows no count', /Nobody is ranked yet\./.test(text()) && !/need more work/.test(text()) && !q('.zx-tplist'));
  ok('the next sign-in opens on Web Tests again', q('button[data-tab=tests]').getAttribute('aria-pressed') === 'true');
  click(q('button[data-act=signout]')); await tick(30);
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
