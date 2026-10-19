/* test-tutors-student-ui.js — Phase 3C, student page, slice 3: the Open buttons, the student page, Show contact and the
   My views card, run against a stand-in page and a stand-in server.
   node test/test-tutors-student-ui.js */
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

  var calls = [], failStudent = false, failContact = false, failAudit = false, auditEntries = [];
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  var DETAIL = { id: 'GOC-S-011', name: 'Tunde <i>Bello</i>', active: false, subject: 'Chemistry', lastActiveAt: Date.UTC(2026, 9, 1, 10, 30), daysInactive: 8,
    tests: { papers: 2, average: 35, lastScore: 30 }, practice: { answers: 40, correct: 22, percent: 55 },
    recent: [{ kind: 'practice', at: Date.UTC(2026, 9, 1, 10, 30), answers: 10, correct: 6, percent: 60 }, { kind: 'test', at: Date.UTC(2026, 8, 28, 9, 0), section: 'objective', status: 'marked', percent: 30, score: 6, maxScore: 20 }, { kind: 'test', at: Date.UTC(2026, 8, 27, 9, 0), section: 'theory', status: 'awaiting-marking', percent: null, score: null, maxScore: 20 }],
    weakTopics: { items: [{ topic: 'Acids <b>x</b>', answers: 12, correct: 3, percent: 25 }], hidden: 2, minAnswers: 3 } };
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET';
    calls.push({ url: url, method: method, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } });
    if (/^api\/tutor\/atrisk/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], sort: 'inactive', limits: { inactiveDays: 7, lowAverage: 40 }, count: 1, students: [{ id: 'GOC-S-011', name: 'Tunde <i>Bello</i>', daysInactive: 8, never: false, average: 35, papers: 2, lastScore: 30, reasons: ['inactive'] }] });
    if (/^api\/tutor\/top/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], tests: { items: [{ id: 'GOC-S-012', name: 'Amina Yusuf', average: 90, papers: 3 }], hidden: 0, minPapers: 2 }, practice: { items: [], hidden: 0, minAnswers: 20 } });
    if (/^api\/tutor\/student\/contact/.test(url)) {
      if (failContact) return reply(500, { error: 'The contact details could not be shown right now.' });
      return reply(200, { subject: 'Chemistry', contact: { id: 'GOC-S-011', name: 'Tunde Bello', email: 'tunde@example.com', phone: '08011112222' } });
    }
    if (/^api\/tutor\/student/.test(url)) {
      if (failStudent) return reply(404, { error: 'That student is not in your class.' });
      return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], student: DETAIL });
    }
    if (/^api\/tutor\/audit/.test(url)) {
      if (failAudit) { failAudit = false; return reply(500, { error: 'Your views are not available.' }); }
      return reply(200, { keptDays: 365, count: auditEntries.length, entries: auditEntries });
    }
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, activity: { days: [], total: { answers: 0, tests: 0 } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (/^api\/tutor\/questions/.test(url)) return reply(200, { subject: 'Chemistry', counts: { live: 0, pending: 0, returned: 0 }, questions: [] });
    if (/^api\/tutor\/notes/.test(url)) return reply(200, { subject: 'Chemistry', counts: { live: 0, held: 0 }, notes: [] });
    if (/^api\/tutor\/notices/.test(url)) return reply(200, { subject: 'Chemistry', count: 0, notices: [] });
    if (/^api\/tutor\/scripts/.test(url)) return reply(200, { subject: 'Chemistry', counts: { waiting: 0, marked: 0 }, scripts: [] });
    return reply(200, {});
  }
  var win = {};
  var bctx = vm.createContext({ window: win, document: doc, fetch: fetchStub, setTimeout: setTimeout, Promise: Promise, JSON: JSON, encodeURIComponent: encodeURIComponent, String: String, Number: Number, Object: Object, Array: Array, Date: Date, Math: Math });
  bctx.window.confirm = function () { return true; };
  vm.runInContext(bundle, bctx);
  function root() { return doc.body.children[0]; }
  function click(el) { handlers.click({ target: el }); }
  function q(sel) { return root() ? root().querySelector(sel) : null; }
  function all(sel) { return root() ? root().querySelectorAll(sel) : []; }
  function text() { return root() ? root().textContent : ''; }
  function raw() { return root() ? root().__raw : ''; }
  function hits(re) { return calls.filter(function (c) { return re.test(c.url); }); }

  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);

  console.log('\nthe Open buttons');
  var openBtns = all('button[data-act=stuopen]');
  ok('each At-risk row and each Top performers row has an Open button', openBtns.length === 2 && openBtns.every(function (b) { return /Open/.test(b.textContent); }), openBtns.length);
  ok('the button carries the Scholar ID', openBtns[0].getAttribute('data-id') === 'GOC-S-011' && openBtns[1].getAttribute('data-id') === 'GOC-S-012');
  ok('the dashboard has a My views card, empty at first', /My views/.test(text()) && /You have not opened a student yet\./.test(text()));
  ok('nothing is opened until a button is tapped', hits(/^api\/tutor\/student/).length === 0);

  console.log('\nthe page');
  click(openBtns[0]); await tick(30);
  var sc = hits(/^api\/tutor\/student\?/);
  ok('the page is asked for with the subject, the ID and the token', sc.length === 1 && sc[0].url === 'api/tutor/student?subject=Chemistry&id=GOC-S-011' && sc[0].auth === 'Bearer tok-9', JSON.stringify(sc));
  ok('the contact route has not been touched', hits(/student\/contact/).length === 0);
  ok('name, Scholar ID and subject', /Tunde/.test(text()) && /GOC-S-011/.test(text()) && /Chemistry/.test(text()));
  ok('a switched-off account says so', /This account is switched off\./.test(text()));
  ok('last activity in days', /Last practised or sat a test 8 days ago/.test(text()));
  ok('scores: test average with papers, last test, practice', /35% over 2 papers/.test(text()) && /30%/.test(text()) && /55% right over 40 answers/.test(text()), text().slice(0, 600));
  ok('recent attempts: practice, a marked test with score, a test waiting for a mark', /Practice/.test(text()) && /60% right over 10 answers/.test(text()) && /Test \(objective\)/.test(text()) && /30% \(6\/20\)/.test(text()) && /Waiting for a mark/.test(text()));
  ok('weak topics with percent and answers, plus the held-back count', /25% right over 12 answers/.test(text()) && /2 topics have too few answers to show\./.test(text()));
  ok('names and topics are written escaped, never as markup', /Tunde &lt;i&gt;Bello&lt;\/i&gt;/.test(raw()) && /Acids &lt;b&gt;x&lt;\/b&gt;/.test(raw()) && !/<i>Bello<\/i>/.test(raw()) && !/<b>x<\/b>/.test(raw()));
  ok('email and phone are hidden and the page says so', !/tunde@example\.com|08011112222/.test(text()) && /Email and phone are hidden\./.test(text()) && !!q('button[data-act=stucontact]'));

  console.log('\nShow contact');
  failContact = true;
  click(q('button[data-act=stucontact]')); await tick(30);
  ok('a failed request is explained on the page and the button stays', /could not be shown right now/.test(text()) && !!q('button[data-act=stucontact]') && !/tunde@example\.com/.test(text()));
  failContact = false;
  click(q('button[data-act=stucontact]')); await tick(30);
  var cc = hits(/student\/contact/);
  ok('tapping it asks the server (the contact route, subject and ID)', cc.length === 2 && cc[1].url === 'api/tutor/student/contact?subject=Chemistry&id=GOC-S-011', JSON.stringify(cc));
  ok('email and phone are then shown, and the page says it was recorded', /tunde@example\.com/.test(text()) && /08011112222/.test(text()) && /Showing these was recorded in your views\./.test(text()) && !q('button[data-act=stucontact]'));
  console.log('\nback to the dashboard');
  var auditBefore = hits(/^api\/tutor\/audit/).length;
  auditEntries = [
    { id: 'AU-3', kind: 'contact-view', tutorId: 'GOC-T-001', tutorName: 'Mrs Ada Obi', studentId: 'GOC-S-011', studentName: 'Tunde <i>Bello</i>', subject: 'Chemistry', at: Date.UTC(2026, 9, 9, 11, 5) },
    { id: 'AU-2', kind: 'tutor-view', tutorId: 'GOC-T-001', tutorName: 'Mrs Ada Obi', studentId: 'GOC-S-011', studentName: 'Tunde <i>Bello</i>', subject: 'Chemistry', at: Date.UTC(2026, 9, 9, 11, 4) }
  ];
  click(q('button[data-act=stuback]')); await tick(40);
  ok('Back returns to the dashboard and asks for the views again', !!q('button[data-act=signout]') && hits(/^api\/tutor\/audit/).length === auditBefore + 1 && !/tunde@example\.com/.test(text()));
  ok('My views lists the entries, newest first, saying what was done', /Opened page/.test(text()) && /Showed contact/.test(text()) && text().indexOf('Showed contact') < text().indexOf('Opened page'), text().slice(-500));
  ok('each entry shows the name, Scholar ID, subject and time', /GOC-S-011 · Chemistry/.test(text()) && /2026-10-09 11:05/.test(text()));
  ok('a name with markup is written escaped here too', !/<i>Bello<\/i>/.test(raw()) && /Tunde &lt;i&gt;Bello&lt;\/i&gt;/.test(raw()));
  ok('the contact details do not linger on the dashboard', !/08011112222/.test(text()));
  click(all('button[data-act=stuopen]')[0]); await tick(30);
  ok('opening the same student again starts hidden again', !/tunde@example\.com/.test(text()) && !!q('button[data-act=stucontact]'));

  console.log('\na refused student, the last twenty, a failed load');
  click(q('button[data-act=stuback]')); await tick(30);
  failStudent = true;
  click(all('button[data-act=stuopen]')[1]); await tick(30);
  ok('a refused student shows the server\'s reason and none of the student\'s data', /That student is not in your class\./.test(text()) && !/Tunde|Amina|Acids/.test(text()) && !q('button[data-act=stucontact]'), text().slice(0, 300));
  failStudent = false;
  click(q('button[data-act=stuback]')); await tick(30);
  click(q('button[data-act=signout]')); await tick(30);
  auditEntries = []; for (var i = 1; i <= 25; i++) auditEntries.push({ id: 'AU-' + i, kind: 'tutor-view', tutorId: 'GOC-T-001', studentId: 'GOC-S-0' + (i < 10 ? '0' : '') + i, studentName: 'Student ' + i, subject: 'Chemistry', at: Date.UTC(2026, 9, 9, 12, 0) - i * 60000 });
  bctx.window.__zxOpen(); await tick(10);
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);
  ok('only the last twenty are listed, with the full count', /Your last 20 of 25/.test(text()) && /Student 20/.test(text()) && !/Student 21/.test(text()), text().slice(-300));
  click(q('button[data-act=signout]')); await tick(30);
  ok('sign out clears the student and the views from the page', !/My views/.test(text()) && !/Student 1/.test(text()));
  failAudit = true;
  bctx.window.__zxOpen(); await tick(30);
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);
  ok('a failed views load is explained on its card only', /Your views are not available\./.test(text()) && /Class snapshot/.test(text()) && /At-risk students/.test(text()));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
