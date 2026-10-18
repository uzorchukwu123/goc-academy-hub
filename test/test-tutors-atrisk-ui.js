/* test-tutors-atrisk-ui.js — Phase 3C, tutor at-risk list, slice 3: the At-risk card on the tutor dashboard, run against a
   stand-in page and a stand-in server.
   node test/test-tutors-atrisk-ui.js */
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

  var calls = [], rowsInactive = [], rowsScore = [], failNext = false, slow = null;
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET';
    calls.push({ url: url, method: method, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } });
    if (/^api\/tutor\/atrisk/.test(url)) {
      if (failNext) { failNext = false; return reply(500, { error: 'The at-risk list is not available.' }); }
      var score = /sort=score/.test(url), rows = score ? rowsScore : rowsInactive;
      return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], sort: score ? 'score' : 'inactive', limits: { inactiveDays: 7, lowAverage: 40 }, count: rows.length, students: rows });
    }
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
  function arCalls() { return calls.filter(function (c) { return /^api\/tutor\/atrisk/.test(c.url); }); }
  function row(id, name, d, never, avg, papers, last, reasons) { return { id: id, name: name, daysInactive: d, never: never, average: avg, papers: papers, lastScore: last, reasons: reasons }; }

  rowsInactive = [
    row('GOC-S-010', 'Ngozi <b>Eze</b>', null, true, null, 0, null, ['never-started']),
    row('GOC-S-011', 'Tunde Bello', 12, false, 30, 2, 35, ['inactive', 'low-average']),
    row('GOC-S-012', 'Amina Yusuf', 1, false, null, 0, null, ['inactive'])
  ];
  rowsScore = [rowsInactive[1], rowsInactive[0], rowsInactive[2]];
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);

  console.log('\nthe card');
  ok('the list is asked for with the subject, the default order and the token', arCalls()[0] && arCalls()[0].url === 'api/tutor/atrisk?subject=Chemistry&sort=inactive' && arCalls()[0].auth === 'Bearer tok-9', JSON.stringify(arCalls()[0]));
  ok('the card names the subject and says what at risk means', /At-risk students in Chemistry/.test(text()) && /not practised or sat a test for 7 days/.test(text()) && /under 40%/.test(text()));
  ok('it counts the students', /3\s*students at risk/.test(text()), text().slice(0, 400));
  ok('each row shows the name and the Scholar ID', /Tunde Bello/.test(text()) && /GOC-S-011/.test(text()) && all('.zx-ar li').length === 3);
  ok('never started reads in plain words', /Joined over 7 days ago and has not started/.test(text()));
  ok('inactivity names the days (and one day is singular)', /No practice or test for 12 days/.test(text()) && /No practice or test for 1 day(?!s)/.test(text()));
  ok('low average shows the average, the papers and the last score', /Test average 30% over 2 papers \(last 35%\)/.test(text()));
  ok('a name with markup is written escaped, never as markup', /Ngozi &lt;b&gt;Eze&lt;\/b&gt;/.test(raw()) && !/<b>Eze<\/b>/.test(raw()));
  ok('the card sits after the last-7-days card and before weak topics', raw().indexOf('Last 7 days') < raw().indexOf('At-risk students') && raw().indexOf('At-risk students') < raw().indexOf('Weak topics'));
  ok('Most inactive is the one marked on', q('button[data-sort=inactive]').getAttribute('aria-pressed') === 'true' && q('button[data-sort=score]').getAttribute('aria-pressed') === 'false');

  console.log('\nthe order switch');
  var before = arCalls().length;
  click(q('button[data-sort=score]')); await tick(30);
  ok('Lowest score asks the server again with that order', arCalls().length === before + 1 && /sort=score/.test(arCalls()[before].url), JSON.stringify(arCalls().slice(-1)));
  ok('the list is drawn in the order the server sent (the app never sorts)', all('.zx-ar li')[0].textContent.indexOf('Tunde Bello') > -1, all('.zx-ar li')[0].textContent);
  ok('Lowest score is now the one marked on', q('button[data-sort=score]').getAttribute('aria-pressed') === 'true');
  var n2 = arCalls().length;
  click(q('button[data-sort=score]')); await tick(20);
  ok('tapping the order already showing asks nothing', arCalls().length === n2);
  click(q('button[data-sort=inactive]')); await tick(30);
  ok('and back again', /sort=inactive/.test(arCalls().slice(-1)[0].url) && all('.zx-ar li')[0].textContent.indexOf('Ngozi') > -1);

  console.log('\na long list');
  rowsInactive = []; for (var i = 1; i <= 14; i++) rowsInactive.push(row('GOC-S-1' + (i < 10 ? '0' : '') + i, 'Student ' + i, 8 + i, false, null, 0, null, ['inactive']));
  click(q('button[data-sort=score]')); await tick(30); click(q('button[data-sort=inactive]')); await tick(30);
  ok('ten rows show at first, with the full count', all('.zx-ar li').length === 10 && /14\s*students at risk/.test(text()));
  ok('Show all 14 is offered', !!q('button[data-act=arall]') && /Show all 14/.test(q('button[data-act=arall]').textContent));
  var n3 = arCalls().length;
  click(q('button[data-act=arall]'));
  ok('Show all reveals every row without asking the server', all('.zx-ar li').length === 14 && arCalls().length === n3 && /Show fewer/.test(q('button[data-act=arall]').textContent));
  click(q('button[data-act=arall]'));
  ok('Show fewer goes back to ten', all('.zx-ar li').length === 10);

  console.log('\na failed load, nobody at risk, and signing out');
  click(q('button[data-act=signout]')); await tick(30);
  ok('sign out clears the list from the page', !/At-risk students/.test(text()) && !/Student 1/.test(text()));
  failNext = true;
  bctx.window.__zxOpen(); await tick(30);
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);
  ok('a failed load is explained on this card only', /The at-risk list is not available\./.test(text()) && /Class snapshot/.test(text()) && !q('.zx-ar'), text().slice(0, 300));
  click(q('button[data-act=signout]')); await tick(30);
  rowsInactive = []; rowsScore = [];
  bctx.window.__zxOpen(); await tick(30);
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(q('button[data-act=signin]')); await tick(60);
  ok('with nobody at risk the card says so and offers no order switch', /Nobody is at risk right now\./.test(text()) && !q('button[data-act=arsort]') && !q('.zx-ar'));
  click(q('button[data-act=signout]')); await tick(30);
  ok('the next sign-in starts again on the default order', (function () { var c0 = arCalls().length; return c0 > 0 && /sort=inactive/.test(arCalls().slice(-1)[0].url); })());
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
