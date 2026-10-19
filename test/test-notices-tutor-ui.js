/* test-notices-tutor-ui.js — Phase 3C slice 7: the tutor's class notice screens (card, list, form), run against a
   stand-in page and a stand-in server.
   node test/test-notices-tutor-ui.js */
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

  var calls = [], notes = [], notices = [], nextError = null, confirmAnswer = true;
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: url, method: method, body: body, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: notes.length } });
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (/^api\/tutor\/questions/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { live: 0, pending: 0, returned: 0 }, questions: [] });
    if (nextError && /^api\/tutor\/notices/.test(url) && method !== 'GET') { var e = nextError; nextError = null; return reply(e.status, { error: e.error }); }
    if (/^api\/tutor\/notices/.test(url)) {
      if (method === 'GET') return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], count: notices.length, notices: notices });
      return reply(200, { ok: true, notice: {} });
    }
    if (/^api\/tutor\/notes/.test(url)) {
      if (method === 'GET') return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { live: notes.filter(function (n) { return n.active !== false; }).length, held: notes.filter(function (n) { return n.active === false; }).length }, notes: notes });
      return reply(200, { ok: true, note: {} });
    }
    return reply(200, {});
  }
  var win = {};
  var bctx = vm.createContext({ window: win, document: doc, fetch: fetchStub, setTimeout: setTimeout, Promise: Promise, JSON: JSON, encodeURIComponent: encodeURIComponent, String: String, Number: Number, Object: Object, Array: Array });
  bctx.window.confirm = function () { return confirmAnswer; };
  bctx.window.FileReader = undefined;
  vm.runInContext(bundle, bctx);
  function root() { return doc.body.children[0]; }
  function click(el) { handlers.click({ target: el }); }
  function q(sel) { return root() ? root().querySelector(sel) : null; }
  function all(sel) { return root() ? root().querySelectorAll(sel) : []; }
  function btn(act) { return q('button[data-act=' + act + ']'); }
  function text() { return root() ? root().textContent : ''; }
  function raw() { return root() ? root().__raw : ''; }
  function ncalls() { return calls.filter(function (c) { return /^api\/tutor\/notices/.test(c.url); }); }

  notices = [
    { id: 31, subject: 'Chemistry', title: 'Lab <b>moved</b>', body: 'The titration practical is now on Friday. '.repeat(8), addedAt: '2026-10-08T10:00:00.000Z', addedBy: 'GOC-T-001' },
    { id: 32, subject: 'Chemistry', title: 'Bring calculators', body: 'Calculators are needed next class.', addedAt: '2026-10-07T09:00:00.000Z', editedAt: '2026-10-07T10:00:00.000Z', addedBy: 'GOC-T-001' }
  ];
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(btn('signin')); await tick(40);

  console.log('\nthe dashboard card');
  ok('the notices are asked for with the subject and the token', ncalls()[0] && ncalls()[0].url === 'api/tutor/notices?subject=Chemistry' && ncalls()[0].auth === 'Bearer tok-9', JSON.stringify(ncalls()[0]));
  ok('the card shows how many are showing', /Class notices in Chemistry/.test(text()) && /Showing now/.test(text()));
  ok('it says GOC students see a notice at once and it stays until removed', /GOC students taking Chemistry see a notice as soon as you post it/.test(text()) && /stays until you remove it/.test(text()));

  console.log('\nthe list');
  click(btn('topen'));
  ok('both notices are listed', /Bring calculators/.test(text()) && /Lab/.test(text()) && all('button[data-act=tedit]').length === 2 && all('button[data-act=tremove]').length === 2);
  ok('an edited notice says so', /edited/.test(text()));
  ok('notice text is escaped, never markup', raw().indexOf('<b>moved</b>') < 0 && raw().indexOf('&lt;b&gt;moved&lt;/b&gt;') > -1);
  ok('there is no hold-back or put-back (a notice is shown until removed)', all('button[data-act=nhold]').length === 0 && all('button[data-act=tpause]').length === 0);
  calls.length = 0; confirmAnswer = false; click(btn('tremove')); await tick(20);
  ok('Remove asks first and sends nothing on no', calls.length === 0);
  confirmAnswer = true; click(btn('tremove')); await tick(30);
  ok('Remove sends a DELETE for that notice', calls[0].method === 'DELETE' && /^api\/tutor\/notices\/\d+$/.test(calls[0].url), JSON.stringify(calls[0]));
  ok('the list is reloaded and a message shows', ncalls().some(function (c) { return c.method === 'GET'; }) && /Removed\./.test(text()), text());

  console.log('\nposting a notice');
  click(btn('tnew'));
  ok('the form opens with a title and the notice, and says who sees it and that the academy is told', !!q('#zxTTitle') && !!q('#zxTBody') && /GOC students taking Chemistry will see this as soon as you post it/.test(text()) && /academy is told that you posted it/.test(text()), text());
  ok('the fields carry the length limits', /maxlength="80"/.test(raw()) && /maxlength="1000"/.test(raw()));
  calls.length = 0;
  q('#zxTTitle').value = 'Hi'; q('#zxTBody').value = 'short';
  nextError = { status: 400, error: 'Give the notice a title of at least 3 characters.' };
  click(btn('tsave')); await tick(30);
  ok('a refusal from the server is shown and the typed text is kept', /title of at least 3/.test(text()) && !!q('#zxTBody') && /short/.test(raw()), text());
  q('#zxTTitle').value = 'Lab moved to Friday'; q('#zxTBody').value = 'The titration practical is now on Friday at 10am in Lab 2.';
  click(btn('tsave')); await tick(30);
  var post = calls.filter(function (c) { return c.method === 'POST'; }).pop();
  ok('a good post sends the notice for the open subject', post && post.url === 'api/tutor/notices' && post.body.subject === 'Chemistry' && post.body.title === 'Lab moved to Friday', JSON.stringify(post));
  ok('it never sends an author, time, id, expiry or pin', post && post.body.addedBy === undefined && post.body.addedAt === undefined && post.body.id === undefined && post.body.expires === undefined && post.body.pinned === undefined);
  ok('after posting, the list shows a message and the form is closed', /Students can see it now/.test(text()) && !q('#zxTBody'), text());

  console.log('\nchanging a notice');
  click(btn('tedit'));
  ok('Edit opens the form filled in, escaped, and says nobody is told', /Change a notice/.test(text()) && /value="Lab &lt;b&gt;moved&lt;\/b&gt;"/.test(raw()) && /Nobody is told about a change/.test(text()), raw().slice(0, 300));
  q('#zxTTitle').value = 'Lab moved to Saturday';
  calls.length = 0; click(btn('tsave')); await tick(30);
  ok('Save changes sends a PUT to that notice and never a subject move', calls[0].method === 'PUT' && /^api\/tutor\/notices\/\d+$/.test(calls[0].url) && calls[0].body.title === 'Lab moved to Saturday' && calls[0].body.subject === 'Chemistry', JSON.stringify(calls[0]));
  click(btn('topen')); click(btn('tnew')); click(btn('tcancel'));
  ok('Cancel goes back to the list without sending anything', /Class notices/.test(text()) && !q('#zxTBody'));
  click(btn('tback'));
  ok('Back returns to the dashboard', /Class notices in Chemistry/.test(text()));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
