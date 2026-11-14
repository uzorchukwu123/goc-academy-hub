/* test-notices-ui.js — Phase 3C slice 7: the student's Class notices card, the console's new-notice alert text and
   Class notices list (with Remove), and the offline driver. Loads the real app.js functions, goc-core.js and api.js.
   node test/test-notices-ui.js */
'use strict';
var activeStudent = require('./active-student.js');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html');
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

var els = {};
function el(id) { return els[id] || (els[id] = { id: id, innerHTML: '', textContent: '', hidden: true, style: { display: 'none' } }); }
var calls = [], toasts = [], fail = null, mine = { locked: false, notices: [] }, all = [], confirmAnswer = true;
var IDS = /^(dashNotices|dashNoticesList|dashNoticesMore|admAlCard|admAlList|admNoCard|admNoList)$/;
var sandbox = {
  GOC: { api: {
    listMyNotices: function () { calls.push(['mine']); return fail === 'mine' ? Promise.reject(new Error('down')) : Promise.resolve(mine); },
    listNotices: function () { calls.push(['all']); return fail === 'all' ? Promise.reject(new Error('down')) : Promise.resolve({ count: all.length, notices: all.slice() }); },
    removeNotice: function (id) { calls.push(['remove', id]); return fail === 'remove' ? Promise.reject(new Error('Could not reach the server.')) : Promise.resolve({ ok: true }); },
    listAlerts: function () { calls.push(['alerts']); return Promise.resolve({ count: 0, alerts: [] }); },
    seenAlert: function () { return Promise.resolve({ ok: true }); }
  } },
  document: { getElementById: function (id) { return IDS.test(id) ? el(id) : null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  confirm: function () { return confirmAnswer; },
  toast: function (m) { toasts.push(m); },
  Promise: Promise, String: String, Number: Number, Array: Array
};
var ctx = vm.createContext(sandbox);
var names = ['dashNoticesRender', 'dashNoticesToggle', 'dashPaintNotices', 'admNoLoad', 'admNoRender', 'admNoRemove', 'admAlLoad', 'admAlRender', 'admAlSeen'];
var code = names.map(grab).join('\n');
ok('all the functions exist', code.split('function ').length - 1 === names.length);
vm.runInContext('var dashNoticesAll = [], dashNoticesOpen = false, DASH_NOTICES_FIRST = 3, admNoCache = [], admNoBusy = false, admAlCache = [], admAlBusy = false;\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }

function N(id, extra) { return Object.assign({ id: id, subject: 'Chemistry', title: 'Notice ' + id, body: 'Body of notice ' + id + ' here.', from: 'Chemistry tutor', at: '2026-10-0' + id + 'T10:00:00Z', edited: false }, extra || {}); }

(async function () {
  head('the pages carry the cards');
  ok('the Home screen has a hidden Class notices card with a Show more button', /id="dashNotices" style="display:none/.test(html) && /id="dashNoticesList"/.test(html) && /id="dashNoticesMore"/.test(html));
  ok('the card is filled whenever Home is drawn', /dashPaintNotices\(\);\s*\}\s*function dashSet/.test(app));
  ok('the console overview has a hidden Class notices card and loads it on the way in', /id=\\"admNoCard\\" hidden|id="admNoCard" hidden/.test(app) && /if\(section === 'overview' && typeof admNoLoad === 'function'\) admNoLoad\(\);/.test(app));

  head('the student card');
  mine = { locked: false, notices: [] };
  run('dashPaintNotices()'); await tick();
  ok('with no notices the card stays hidden', el('dashNotices').style.display === 'none');
  mine = { locked: true, notices: [] };
  run('dashPaintNotices()'); await tick();
  ok('an Open (locked) student sees no card', el('dashNotices').style.display === 'none');
  mine = { locked: true, notices: [N(1)] };
  run('dashPaintNotices()'); await tick();
  ok('even if a locked reply carried notices, none are drawn', el('dashNotices').style.display === 'none' && el('dashNoticesList').innerHTML === '');
  mine = { locked: false, notices: [N(5, { title: 'Lab <b>moved</b>', body: 'Line one\nLine <i>two</i>', edited: true }), N(4), N(3), N(2), N(1)] };
  run('dashPaintNotices()'); await tick();
  var h = el('dashNoticesList').innerHTML;
  ok('the card shows, with the newest three', el('dashNotices').style.display === '' && /Notice 4/.test(h) && /Notice 3/.test(h) && !/Notice 2/.test(h) && !/Notice 1/.test(h));
  ok('each says which tutor it is from, when, and if it was edited', /Chemistry tutor/.test(h) && /WHEN\(2026-10-05T10:00:00Z\)/.test(h) && /· edited/.test(h));
  ok('tutor text is escaped, with line breaks kept', /Lab &lt;b&gt;moved&lt;\/b&gt;/.test(h) && !/<b>moved<\/b>/.test(h) && /Line one\nLine &lt;i&gt;two&lt;\/i&gt;/.test(h) && /white-space:pre-wrap/.test(h));
  ok('"Show 2 more" is offered', el('dashNoticesMore').style.display === '' && el('dashNoticesMore').textContent === 'Show 2 more');
  run('dashNoticesToggle()');
  h = el('dashNoticesList').innerHTML;
  ok('Show more reveals all five and offers Show fewer', /Notice 1/.test(h) && /Notice 2/.test(h) && el('dashNoticesMore').textContent === 'Show fewer');
  run('dashNoticesToggle()');
  ok('Show fewer goes back to three', !/Notice 1/.test(el('dashNoticesList').innerHTML));
  mine = { locked: false, notices: [N(7)] };
  run('dashPaintNotices()'); await tick();
  ok('with three or fewer there is no Show more button', el('dashNoticesMore').style.display === 'none');
  fail = 'mine'; run('dashPaintNotices()'); await tick(); fail = null;
  ok('a failed load hides the card instead of showing an error on Home', el('dashNotices').style.display === 'none');

  head('the console: the new-notice alert');
  var alerts = [{ id: 'AL-4', kind: 'class-notice', tutorId: 'GOC-T-001', tutorName: 'Mrs <b>Ada</b> Obi', subject: 'Chemistry', noticeId: 5, title: 'Lab moved', at: '2026-10-08T10:00:00Z', seen: false },
                { id: 'AL-5', kind: 'class-notice', tutorId: 'GOC-T-002', tutorName: 'Mr Eze', subject: 'Physics', noticeId: 6, title: 'Quiz Friday', at: '2026-10-08T11:00:00Z', seen: false, gone: true }];
  sandbox.GOC.api.listAlerts = function () { calls.push(['alerts']); return Promise.resolve({ count: alerts.length, alerts: alerts }); };
  run('admAlLoad()'); await tick();
  h = el('admAlList').innerHTML;
  ok('the alert says who posted which subject\'s notice, its title and the time', /posted a Chemistry class notice/.test(h) && /Lab moved/.test(h) && /WHEN\(2026-10-08T10:00:00Z\)/.test(h) && /New notice/.test(h));
  ok('tutor text is escaped', /Mrs &lt;b&gt;Ada&lt;\/b&gt; Obi/.test(h) && !/<b>Ada<\/b>/.test(h));
  ok('a notice removed since says so', /Quiz Friday · WHEN\(2026-10-08T11:00:00Z\) · since removed/.test(h));
  ok('it has Seen and offers no Open script', (h.match(/>Seen</g) || []).length === 2 && !/Open script/.test(h));

  head('the console: the notices list');
  all = [];
  run('admNoLoad()'); await tick();
  ok('with no notices the card is hidden', el('admNoCard').hidden === true);
  all = [{ id: 5, subject: 'Chemistry', title: 'Lab <b>moved</b>', body: 'Friday\nat ten', addedBy: 'GOC-T-001', addedByName: 'Mrs Ada Obi', addedAt: '2026-10-08T10:00:00Z', editedAt: '2026-10-08T11:00:00Z' },
         { id: 6, subject: 'Physics', title: 'Quiz Friday', body: 'Bring a pen.', addedBy: 'GOC-T-002', addedByName: 'Mr Eze', addedAt: '2026-10-07T09:00:00Z' }];
  run('admNoLoad()'); await tick();
  h = el('admNoList').innerHTML;
  ok('the card lists every notice with subject, tutor, time and an edited tag', el('admNoCard').hidden === false && /Chemistry · Mrs Ada Obi · WHEN\(2026-10-08T10:00:00Z\) · edited/.test(h) && /Physics · Mr Eze/.test(h));
  ok('title and body are escaped, line breaks kept', /Lab &lt;b&gt;moved&lt;\/b&gt;/.test(h) && !/<b>moved<\/b>/.test(h) && /Friday\nat ten/.test(h));
  ok('each has Remove notice', (h.match(/Remove notice/g) || []).length === 2);
  calls.length = 0; confirmAnswer = false; run("admNoRemove('5')"); await tick();
  ok('Remove asks first and sends nothing on no', calls.length === 0);
  confirmAnswer = true; run("admNoRemove('5')"); await tick();
  ok('Remove calls the server with that notice', calls[0][0] === 'remove' && calls[0][1] === '5');
  h = el('admNoList').innerHTML;
  ok('it leaves the list at once and the other stays', !/Lab/.test(h) && /Quiz Friday/.test(h));
  ok('the alerts are re-read so a removed notice\'s alert says so', calls.some(function (c) { return c[0] === 'alerts'; }));
  fail = 'remove'; toasts.length = 0; run("admNoRemove('6')"); await tick(); fail = null;
  ok('a failed Remove keeps the notice and shows the reason', /Quiz Friday/.test(el('admNoList').innerHTML) && toasts.indexOf('Could not reach the server.') > -1);
  fail = 'all'; all = []; run('admNoLoad()'); await tick(); fail = null;
  ok('a failed load hides the card', el('admNoCard').hidden === true);

  head('the offline driver');
  var dctx = vm.createContext({ console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' }, setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent });
  vm.runInContext('window = this; self = this;', dctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), dctx, { filename: f }); });
  var core = vm.runInContext('GOC.core', dctx), mock = vm.runInContext('GOC.api._drivers.mock', dctx);
  function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
  var CODE = 'GOC2027', COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  var r = await activeStudent.demo(mock, { signupCode: CODE, name: 'Opal Open', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
  var open = await mock.listMyNotices();
  ok('an Open student reads as locked with nothing', open.locked === true && open.notices.length === 0);
  mock._setTier(r.student.id, 'goc');
  var goc = await mock.listMyNotices();
  ok('a GOC student gets an empty list (the offline demo has no tutors)', goc.locked === false && goc.notices.length === 0);
  await mock.logout();
  ok('with no session it is refused', !!(await rejects(mock.listMyNotices())));
  await mock.login('GOC-A-001', 'founder2027');
  ok('the console is locked until unlocked', !!(await rejects(mock.listNotices())) && !!(await rejects(mock.removeNotice(1))));
  await mock.unlockConsole('2027');
  var l = await mock.listNotices();
  ok('offline the admin list is empty', l.count === 0 && l.notices.length === 0);
  ok('removing needs a server', /need a server connection/.test(await rejects(mock.removeNotice(1))));
  ok('GOC.api forwards all three', ['listMyNotices', 'listNotices', 'removeNotice'].every(function (m) { return vm.runInContext('typeof GOC.api.' + m, dctx) === 'function'; }));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
