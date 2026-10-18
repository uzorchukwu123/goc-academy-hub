/* test-tutor-notes-ui.js — Phase 3C slice 6.5: the tutor's notes screens (card, list, form), run against a
   stand-in page and a stand-in server.
   node test/test-tutor-notes-ui.js */
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

  var calls = [], notes = [], nextError = null, confirmAnswer = true;
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: url, method: method, body: body, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: notes.length } });
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (/^api\/tutor\/questions/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { live: 0, pending: 0, returned: 0 }, questions: [] });
    if (nextError && /^api\/tutor\/notes/.test(url) && method !== 'GET') { var e = nextError; nextError = null; return reply(e.status, { error: e.error }); }
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
  function ncalls() { return calls.filter(function (c) { return /^api\/tutor\/notes/.test(c.url); }); }

  notes = [
    { id: 21, topic: 'Acids', title: 'Strong <b>acids</b>', body: 'Acids donate protons. '.repeat(10), active: true },
    { id: 22, topic: 'Salts', title: 'Soluble salts', body: 'Most nitrates dissolve in water. '.repeat(8), active: false }
  ];
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(btn('signin')); await tick(40);

  console.log('\nthe dashboard card');
  ok('the notes are asked for with the subject and the token', ncalls()[0] && ncalls()[0].url === 'api/tutor/notes?subject=Chemistry' && ncalls()[0].auth === 'Bearer tok-9', JSON.stringify(ncalls()[0]));
  ok('the card shows live and held-back counts', /Your notes in Chemistry/.test(text()) && /Held back/.test(text()));
  ok('it says a saved note is readable at once, with no approval wait', /readable by students straight away/.test(text()));

  console.log('\nthe list');
  click(btn('nopen'));
  ok('both notes are listed with their state', /Strong/.test(text()) && /Soluble salts/.test(text()) && /Live/.test(text()) && /Held back/.test(text()));
  ok('note text is escaped, never markup', raw().indexOf('<b>acids</b>') < 0 && raw().indexOf('&lt;b&gt;acids&lt;/b&gt;') > -1);
  ok('a live note offers Hold back and no Delete; a held-back one offers Put back live and Delete', all('button[data-act=nhold]').length === 1 && all('button[data-act=nlive]').length === 1 && all('button[data-act=ndelete]').length === 1);
  calls.length = 0; click(btn('nhold')); await tick(30);
  ok('Hold back calls the switch route with active false', calls[0].method === 'PUT' && calls[0].url === 'api/tutor/notes/21/active' && calls[0].body.active === false, JSON.stringify(calls[0]));
  ok('the list is reloaded and a message shows', ncalls().some(function (c) { return c.method === 'GET'; }) && /Held back\. Students no longer see it/.test(text()), text());
  calls.length = 0; click(btn('nlive')); await tick(30);
  ok('Put back live sends active true for the held-back note', calls[0].url === 'api/tutor/notes/22/active' && calls[0].body.active === true, JSON.stringify(calls[0]));
  calls.length = 0; confirmAnswer = false; click(btn('ndelete')); await tick(20);
  ok('Delete asks first and sends nothing on no', calls.length === 0);
  confirmAnswer = true; click(btn('ndelete')); await tick(30);
  ok('Delete sends the right note', calls[0].method === 'DELETE' && /^api\/tutor\/notes\/\d+$/.test(calls[0].url), JSON.stringify(calls[0]));

  console.log('\nwriting a note');
  click(btn('nnew'));
  ok('the form opens with topic, title and the note, and says it goes live at once', !!q('#zxNTopic') && !!q('#zxNTitle') && !!q('#zxNBody') && /as soon as you save it/.test(text()));
  calls.length = 0;
  q('#zxNTopic').value = 'Acids'; q('#zxNTitle').value = 'pH'; q('#zxNBody').value = 'short';
  nextError = { status: 400, error: 'The note is too short to read — write at least a paragraph.' };
  click(btn('nsave')); await tick(30);
  ok('a refusal from the server is shown and the typed text is kept', /too short to read/.test(text()) && !!q('#zxNBody') && /short/.test(raw()), text());
  q('#zxNBody').value = 'The pH scale runs from 0 to 14 and measures how acidic a solution is, with 7 neutral.';
  click(btn('nsave')); await tick(30);
  var post = calls.filter(function (c) { return c.method === 'POST'; }).pop();
  ok('a good save sends the note for the open subject', post && post.url === 'api/tutor/notes' && post.body.subject === 'Chemistry' && post.body.topic === 'Acids' && post.body.title === 'pH', JSON.stringify(post));
  ok('it never sends an author, time, id or status', post && post.body.addedBy === undefined && post.body.addedAt === undefined && post.body.id === undefined && post.body.status === undefined && post.body.active === undefined);
  ok('after saving, the list shows a message and the form is closed', /Students can read it now/.test(text()) && !q('#zxNBody'), text());

  console.log('\nchanging a note');
  click(btn('nedit'));
  ok('Edit opens the form filled with the note, escaped', /Change a note/.test(text()) && /value="Strong &lt;b&gt;acids&lt;\/b&gt;"/.test(raw()), raw().slice(0, 300));
  q('#zxNTitle').value = 'Strong acids (revised)';
  calls.length = 0; click(btn('nsave')); await tick(30);
  ok('Save changes sends a PUT to that note', calls[0].method === 'PUT' && /^api\/tutor\/notes\/\d+$/.test(calls[0].url) && calls[0].body.title === 'Strong acids (revised)', JSON.stringify(calls[0]));
  click(btn('nopen')); click(btn('nnew')); click(btn('ncancel'));
  ok('Cancel goes back to the list without sending anything', /Notes/.test(text()) && !q('#zxNBody'));
  click(btn('nback'));
  ok('Back returns to the dashboard', /Your notes in Chemistry/.test(text()));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
