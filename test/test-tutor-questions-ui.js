/* test-tutor-questions-ui.js — Phase 3C slice 6, part 2: the tutor's question screens (list, form, import),
   run against a stand-in page and a stand-in server.
   node test/test-tutor-questions-ui.js */
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

  var calls = [], list = [], counts = { live: 1, pending: 1, returned: 1 }, nextError = null, confirmAnswer = true, importReply = null;
  function reply(status, body) { return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
  function fetchStub(url, opts) {
    var method = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: url, method: method, body: body, auth: opts && opts.headers && opts.headers.Authorization });
    if (/^api\/tutor\/login/.test(url)) return reply(200, { token: 'tok-9', user: { id: 'GOC-T-001', name: 'Mrs Ada Obi', role: 'tutor', subjects: ['Chemistry'], mustChangePassword: false } });
    if (/^api\/tutor\/subject/.test(url)) return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], depth: { objective: 1, theory: 0, jamb: 0, practice: 0, notes: 0 } });
    if (/^api\/tutor\/analytics/.test(url)) return reply(200, { subject: 'Chemistry', subjects: [], snapshot: { gocStudents: 0, openStudents: 0, active: 0, activeDays: 7, practice: { answers: 0, correct: 0, average: null, small: false }, tests: { papers: 0, average: null, small: false } }, weakTopics: { items: [], hidden: 0, minAnswers: 10 }, hardestQuestions: { items: [], hidden: 0, minAnswers: 10 } });
    if (nextError && /^api\/tutor\/questions/.test(url) && method !== 'GET') { var e = nextError; nextError = null; return reply(e.status, { error: e.error }); }
    if (/^api\/tutor\/questions\/import/.test(url)) return reply(200, importReply || { read: 2, added: 2, skipped: 0, errors: [], batch: 'IMP-X', status: 'pending' });
    if (/^api\/tutor\/questions/.test(url)) {
      if (method === 'GET') return reply(200, { subject: 'Chemistry', subjects: ['Chemistry'], counts: counts, questions: list });
      return reply(200, { ok: true, question: {} });
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
  function qcalls() { return calls.filter(function (c) { return /^api\/tutor\/questions/.test(c.url); }); }

  list = [
    { id: 11, section: 'objective', topic: 'Acids', text: 'Pending <b>one</b>', status: 'pending', active: true },
    { id: 12, section: 'objective', topic: 'Salts', text: 'A live question', status: 'live', active: true },
    { id: 13, section: 'theory', topic: 'Acids', text: 'A returned question', status: 'returned', returnReason: 'Option <i>C</i> is also right', active: true, expected: 'It ionises completely.', maxMark: 4 }
  ];
  q('#zxId').value = 'GOC-T-001'; q('#zxPw').value = 'whatever-123';
  click(btn('signin')); await tick(40);

  console.log('\nthe dashboard card');
  ok('the questions are asked for with the subject and the token', qcalls()[0].url === 'api/tutor/questions?subject=Chemistry' && qcalls()[0].auth === 'Bearer tok-9', JSON.stringify(qcalls()[0]));
  ok('the card shows the three counts', /Your questions in Chemistry/.test(text()) && /Awaiting approval/.test(text()) && /Returned/.test(text()), text());
  ok('it says new questions wait for the admin', /wait for the admin before students see them/.test(text()));

  console.log('\nthe list');
  click(btn('qopen'));
  ok('the list shows every status badge', /Awaiting approval/.test(text()) && /Live/.test(text()) && /Returned/.test(text()), text());
  ok('a returned question shows the admin\'s reason', /Returned:/.test(text()) && /is also right/.test(text()));
  ok('question text and reasons are escaped, never markup', raw().indexOf('<b>one</b>') < 0 && raw().indexOf('&lt;b&gt;one&lt;/b&gt;') > -1 && raw().indexOf('<i>C</i>') < 0);
  ok('a pending question offers Edit and Delete, no withdraw', all('button[data-act=qedit]').length === 3 && all('button[data-act=qdelete]').length === 2 && all('button[data-act=qwithdraw]').length === 1);
  click(all('button[data-act=qfilter]')[1]);
  ok('the filter keeps only that status', /Pending/.test(text()) && !/A live question/.test(text()) && !/A returned question/.test(text()), text());
  click(all('button[data-act=qfilter]')[0]);

  console.log('\nwithdraw and delete');
  calls.length = 0;
  click(btn('qwithdraw')); await tick(30);
  ok('Withdraw calls the switch route with active false', calls[0].method === 'PUT' && calls[0].url === 'api/tutor/questions/12/active' && calls[0].body.active === false, JSON.stringify(calls[0]));
  ok('the list is reloaded and a message shows', qcalls().some(function (c) { return c.method === 'GET'; }) && /Withdrawn/.test(text()), text());
  calls.length = 0; confirmAnswer = false;
  click(all('button[data-act=qdelete]')[0]); await tick(20);
  ok('Delete asks first, and nothing is sent when the tutor says no', calls.length === 0);
  confirmAnswer = true;
  click(all('button[data-act=qdelete]')[0]); await tick(30);
  ok('Delete sends the right question', calls[0].method === 'DELETE' && calls[0].url === 'api/tutor/questions/11', JSON.stringify(calls[0]));

  console.log('\nadding a question');
  click(btn('qnew'));
  ok('the form opens on Objective with five options', !!q('#zxText') && !!q('#zxO4') && !q('#zxExp') && /once the admin approves it/.test(text()));
  calls.length = 0;
  q('#zxTopic').value = 'Acids'; q('#zxText').value = 'Which is a strong acid?';
  q('#zxO0').value = 'Ethanoic acid'; q('#zxO1').value = 'Hydrochloric acid'; q('#zxO2').value = ''; q('#zxO3').value = ''; q('#zxO4').value = '';
  q('#zxAns').value = '1';
  nextError = { status: 400, error: 'An objective question needs at least two options.' };
  click(btn('qsave')); await tick(30);
  ok('a refusal from the server is shown and the typed text is kept', /at least two options/.test(text()) && !!q('#zxText') && /Which is a strong acid/.test(raw()), text());
  click(btn('qsave')); await tick(30);
  var post = calls.filter(function (c) { return c.method === 'POST'; })[1];
  ok('a good save sends the question for the open subject', post && post.url === 'api/tutor/questions' && post.body.subject === 'Chemistry' && post.body.section === 'objective' && post.body.answer === 1 && post.body.options.length === 5, JSON.stringify(post));
  ok('it never sends a status, author or review mark', post && post.body.status === undefined && post.body.addedBy === undefined && post.body.reviewedBy === undefined);
  ok('after saving, the list shows a message about approval', /Sent for approval/.test(text()) && !q('#zxText'), text());

  console.log('\na theory question');
  click(btn('qnew'));
  q('#zxSec').value = 'theory';
  handlers.change({ target: q('#zxSec') });
  ok('choosing Theory swaps the options for an expected answer and a mark', !!q('#zxExp') && !!q('#zxMax') && !q('#zxO0'));
  calls.length = 0;
  q('#zxTopic').value = 'Acids'; q('#zxText').value = 'Explain why HCl is a strong acid.'; q('#zxExp').value = 'It ionises completely in water.'; q('#zxMax').value = '5';
  click(btn('qsave')); await tick(30);
  var tp = calls.filter(function (c) { return c.method === 'POST'; })[0];
  ok('the theory question goes with its expected answer and mark', tp && tp.body.section === 'theory' && tp.body.expected === 'It ionises completely in water.' && tp.body.maxMark === 5 && tp.body.options === undefined, JSON.stringify(tp));

  console.log('\nchanging a question');
  click(btn('qopen'));
  var editBtns = all('button[data-act=qedit]');
  click(editBtns[editBtns.length - 1]);
  ok('editing opens the form filled in, and warns that saving resends it', /Saving sends this question back to the admin/.test(text()) && /A returned question/.test(raw()) && !!q('#zxExp'), text());
  calls.length = 0;
  q('#zxText').value = 'A returned question, now fixed properly.';
  click(btn('qsave')); await tick(30);
  var put = calls.filter(function (c) { return c.method === 'PUT'; })[0];
  ok('saving sends a PUT for that question only', put && put.url === 'api/tutor/questions/13' && /now fixed/.test(put.body.text), JSON.stringify(put));
  click(btn('qopen'));
  click(btn('qnew')); click(btn('qcancel'));
  ok('cancel goes back to the list without sending anything', !!q('button[data-act=qimport]') && !q('#zxText'));

  console.log('\nimporting');
  click(btn('qimport'));
  ok('the import screen names the subject and the columns', /Import questions/.test(text()) && /Every row must be for Chemistry/.test(text()) && /optionA/.test(text()));
  calls.length = 0;
  click(btn('qimportgo'));
  ok('an empty box is caught on the page, nothing is sent', calls.length === 0 && /Choose a file or paste/.test(text()));
  q('#zxCsv').value = 'subject,text\nChemistry,Something long enough here';
  q('#zxImpSec').value = 'objective';
  importReply = { read: 3, added: 2, skipped: 1, errors: [{ line: 4, error: 'Row <b>4</b> is wrong.' }], batch: 'IMP-X', status: 'pending' };
  click(btn('qimportgo')); await tick(30);
  var ic = calls.filter(function (c) { return /import/.test(c.url); })[0];
  ok('the file goes to the import route for this subject, section stamped', ic && ic.method === 'POST' && ic.body.subject === 'Chemistry' && ic.body.section === 'objective' && ic.body.stampSection === true && /Something long/.test(ic.body.csv), JSON.stringify(ic));
  ok('the result says how many went for approval and how many were skipped', /2 questions sent for approval, 1 skipped/.test(text()), text());
  ok('skipped rows are listed by line, escaped', /Line 4/.test(text()) && raw().indexOf('<b>4</b>') < 0);

  console.log('\nsession and sign-out');
  win.__zxOpen();
  nextError = null;
  var tops = all('button[data-act=qcancel]');
  click(tops[0]);
  click(btn('qback'));
  ok('Back returns to the dashboard', /Your questions in Chemistry/.test(text()));
  click(btn('signout'));
  ok('signing out clears the screen', doc.body.children.length === 0);

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
