/* test-tutor-marking-ui.js — Phase 3C slice 6.6: the tutor's theory-script screens (card, list, marking sheet), run
   against a stand-in page and a stand-in server.
   node test/test-tutor-marking-ui.js */
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

  var calls = [], nextError = null;
  var scripts = [
    { id: 'A1-1', scholarId: 'GOC-S-001', subject: 'Chemistry', period: 'test', submittedAt: Date.UTC(2026, 9, 8, 9, 30), status: 'awaiting-marking', score: null, maxScore: 20, percent: null, written: 2, marked: 1 },
    { id: 'A1-2', scholarId: 'GOC-S-002', subject: 'Chemistry', period: 'test', submittedAt: Date.UTC(2026, 9, 7, 9, 30), status: 'marked', score: 14, maxScore: 20, percent: 70, written: 2, marked: 2 }
  ];
  var detail = { id: 'A1-1', scholarId: 'GOC-S-001', subject: 'Chemistry', submittedAt: Date.UTC(2026, 9, 8, 9, 30), status: 'awaiting-marking', score: null, maxScore: 20, percent: null, written: 2, marked: 1,
    answers: [
      { questionId: 33, topic: 'Acids', text: 'Define <i>electrolysis</i>.', expected: 'Decomposition by current.', given: 'It <b>splits</b> things.', markAwarded: 4, maxMark: 10 },
      { questionId: 34, topic: 'Acids', text: 'Name a strong acid.', expected: 'HCl.', given: '', markAwarded: null, maxMark: 10 }
    ] };
  var saveReply = { id: 'A1-1', status: 'marked', score: 14, maxScore: 20, percent: 70, written: 2, marked: 2, alerted: true };
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: url, method: method, body: body, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } });
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (/^api\/tutor\/questions/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { live: 0, pending: 0, returned: 0 }, questions: [] });
    if (/^api\/tutor\/notes/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { live: 0, held: 0 }, notes: [] });
    if (nextError && /^api\/tutor\/scripts/.test(url)) { var e = nextError; nextError = null; return reply(e.status, { error: e.error }); }
    if (/^api\/tutor\/scripts\/[^/]+\/mark/.test(url)) return reply(200, saveReply);
    if (/^api\/tutor\/scripts\/[^/?]+$/.test(url)) return reply(200, detail);
    if (/^api\/tutor\/scripts/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: { waiting: scripts.filter(function (x) { return x.status !== 'marked'; }).length, marked: scripts.filter(function (x) { return x.status === 'marked'; }).length }, scripts: scripts });
    return reply(200, {});
  }
  var win = {};
  var bctx = vm.createContext({ window: win, document: doc, fetch: fetchStub, setTimeout: setTimeout, Promise: Promise, JSON: JSON, encodeURIComponent: encodeURIComponent, String: String, Number: Number, Object: Object, Array: Array, Date: Date, isNaN: isNaN, isFinite: isFinite });
  bctx.window.confirm = function () { return true; };
  bctx.window.FileReader = undefined;
  vm.runInContext(bundle, bctx);
  function root() { return doc.body.children[0]; }
  function click(el) { handlers.click({ target: el }); }
  function q(sel) { return root() ? root().querySelector(sel) : null; }
  function all(sel) { return root() ? root().querySelectorAll(sel) : []; }
  function btn(act) { return q('button[data-act=' + act + ']'); }
  function text() { return root() ? root().textContent : ''; }
  function raw() { return root() ? root().__raw : ''; }
  function sc() { return calls.filter(function (c) { return /^api\/tutor\/scripts/.test(c.url); }); }

  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(btn('signin')); await tick(40);

  console.log('\nthe dashboard card');
  ok('the scripts are asked for with the subject and the token', sc()[0] && sc()[0].url === 'api/tutor/scripts?subject=Chemistry' && sc()[0].auth === 'Bearer tok-9', JSON.stringify(sc()[0]));
  ok('the card shows how many wait and how many are marked', /Theory scripts in Chemistry/.test(text()) && /Waiting for a mark/.test(text()));
  ok('it says a saved mark counts straight away and that the admin is told', /counts straight away/.test(text()) && /admin is told/.test(text()));

  console.log('\nthe list');
  click(btn('sopen'));
  ok('it opens on the scripts waiting for a mark', /Script A1-1/.test(text()) && !/Script A1-2/.test(text()), text());
  ok('each shows the Scholar ID and how many answers are marked', /GOC-S-001/.test(text()) && /1 of 2 written answers marked/.test(text()));
  click(q('button[data-filter=marked]'));
  ok('the Marked filter shows the marked script with its mark', /Script A1-2/.test(text()) && !/Script A1-1/.test(text()) && /14\/20 \(70%\)/.test(text()) && /Open or change marks/.test(text()));
  click(q('button[data-filter=""]'));
  ok('All shows both', /Script A1-1/.test(text()) && /Script A1-2/.test(text()));
  ok('no filter click asked the server again', sc().filter(function (c) { return c.method === 'GET' && /status=/.test(c.url); }).length === 0);

  console.log('\nthe marking sheet');
  calls.length = 0; click(all('button[data-act=sview]')[0]); await tick(30);
  ok('opening a script asks for that script', calls[0].url === 'api/tutor/scripts/A1-1' && calls[0].method === 'GET', JSON.stringify(calls[0]));
  ok('it shows the question, the reference answer and the student\'s answer', /Define/.test(text()) && /Decomposition by current/.test(text()) && /splits/.test(text()) && /\(left blank\)/.test(text()));
  ok('server text is escaped, never markup', raw().indexOf('<i>electrolysis</i>') < 0 && raw().indexOf('<b>splits</b>') < 0 && raw().indexOf('&lt;i&gt;electrolysis&lt;/i&gt;') > -1);
  ok('there is a mark box for each written answer, with its maximum', all('input[data-qid]').length === 2 && /Mark out of 10/.test(text()));
  ok('it warns that a mark counts at once and that blank means later', /counts at once/.test(text()) && /Leave a box empty/.test(text()));

  console.log('\nsaving');
  var boxes = all('input[data-qid]');
  boxes[0].value = '6'; boxes[1].value = '8';
  calls.length = 0; click(btn('ssave')); await tick(40);
  var post = calls.filter(function (c) { return c.method === 'POST'; })[0];
  ok('Save posts the marks keyed by question to the script\'s mark route', post && post.url === 'api/tutor/scripts/A1-1/mark' && post.body.marks['33'] === 6 && post.body.marks['34'] === 8 && post.auth === 'Bearer tok-9', JSON.stringify(post));
  ok('the subject is not part of the request: the server takes it from the script', post && post.body.subject === undefined);
  ok('a fully marked script says so, with the mark and that the admin was told', /fully marked: 14\/20 \(70%\)\. The admin has been told/.test(text()), text());
  ok('the list and the script are loaded again', calls.some(function (c) { return c.url === 'api/tutor/scripts?subject=Chemistry'; }) && calls.some(function (c) { return c.url === 'api/tutor/scripts/A1-1'; }));

  console.log('\nsome answers still unmarked');
  boxes = all('input[data-qid]'); boxes[0].value = '6'; boxes[1].value = '';
  saveReply = { id: 'A1-1', status: 'awaiting-marking', score: null, maxScore: 20, percent: null, written: 2, marked: 1, alerted: false };
  calls.length = 0; click(btn('ssave')); await tick(40);
  post = calls.filter(function (c) { return c.method === 'POST'; })[0];
  ok('a blank box is not sent as a zero', post && post.body.marks['33'] === 6 && post.body.marks['34'] === undefined, JSON.stringify(post && post.body));
  ok('the tutor is told the admin hears only when every answer has a mark', /1 of 2 answers marked\. The admin is told once every answer has a mark/.test(text()), text());

  console.log('\nbad input and refusals');
  boxes = all('input[data-qid]'); boxes[0].value = 'abc';
  calls.length = 0; click(btn('ssave')); await tick(20);
  ok('a mark that is not a number is stopped before anything is sent', calls.length === 0 && /must be a number/.test(text()), text());
  boxes = all('input[data-qid]'); boxes[0].value = '3';
  nextError = { status: 403, error: 'You do not teach Physics.' };
  click(btn('ssave')); await tick(30);
  ok('a refusal shows the server\'s words and keeps the sheet', /You do not teach Physics\./.test(text()) && all('input[data-qid]').length === 2, text());
  click(btn('sclose')); await tick(30);
  ok('Back returns to the list', /Theory scripts/.test(text()) && /Script A1-1/.test(text()) && !!btn('sback'));
  click(btn('sback'));
  ok('and back again to the dashboard', /Theory scripts in Chemistry/.test(text()) && !!btn('signout'));

  console.log('\nan ended session');
  nextError = null;
  click(btn('sopen')); await tick(20);
  nextError = { status: 401, error: 'Please sign in again.' };
  click(all('button[data-act=sview]')[0]); await tick(30);
  ok('goes back to sign-in with the server\'s reason', !!q('#zxId') && /Please sign in again\./.test(text()), text());

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
