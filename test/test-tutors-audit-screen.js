/* test-tutors-audit-screen.js — Phase 3C, last piece: the console's Tutor access log (inside Console -> Tutors):
   filters (tutor, student, action, Nigeria days), CSV export, the offline driver and the screen functions.
   node test/test-tutors-audit-screen.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function at(day, hhmm) { return Date.parse(day + 'T' + hhmm + ':00+01:00'); }   /* a Nigeria wall-clock time */
var LOG = [
  { id: 'AU-1', kind: 'tutor-view', tutorId: 'GOC-T-001', tutorName: 'Mrs Ada Obi', studentId: 'GOC-S-001', studentName: 'Gina Goc', subject: 'Physics', at: at('2026-10-05', '09:00') },
  { id: 'AU-2', kind: 'contact-view', tutorId: 'GOC-T-001', tutorName: 'Mrs Ada Obi', studentId: 'GOC-S-001', studentName: 'Gina Goc', subject: 'Physics', at: at('2026-10-05', '09:02') },
  { id: 'AU-3', kind: 'tutor-view', tutorId: 'GOC-T-002', tutorName: 'Mr Bayo', studentId: 'GOC-S-002', studentName: 'Sam Goc', subject: 'Chemistry', at: at('2026-10-06', '23:30') },
  { id: 'AU-4', kind: 'tutor-view', tutorId: 'GOC-T-001', tutorName: 'Mrs Ada Obi', studentId: 'GOC-S-003', studentName: 'Tolu', subject: 'Physics', at: at('2026-10-07', '00:10') },
  { id: 'AU-5', tutorId: 'GOC-T-002', tutorName: 'Mr Bayo', studentId: 'GOC-S-001', studentName: 'Gina Goc', subject: 'Chemistry', at: at('2026-10-08', '12:00') }   /* an old row with no kind */
];
function ids(r) { return r.map(function (e) { return e.id; }).join(','); }

console.log('\nthe filters');
ok('no filter: everything, newest first', ids(core.auditViews(LOG, {})) === 'AU-5,AU-4,AU-3,AU-2,AU-1');
ok('by tutor', ids(core.auditViews(LOG, { tutorId: 'GOC-T-002' })) === 'AU-5,AU-3');
ok('by student', ids(core.auditViews(LOG, { studentId: 'GOC-S-001' })) === 'AU-5,AU-2,AU-1');
ok('by action: opened page (a row with no kind counts as an opened page)', ids(core.auditViews(LOG, { kind: 'tutor-view' })) === 'AU-5,AU-4,AU-3,AU-1');
ok('by action: showed contact', ids(core.auditViews(LOG, { kind: 'contact-view' })) === 'AU-2');
ok('an unknown action is ignored', core.auditViews(LOG, { kind: 'whatever' }).length === 5);
ok('one Nigeria day: 23:30 on the 6th is the 6th, 00:10 on the 7th is the 7th', ids(core.auditViews(LOG, { from: '2026-10-06', to: '2026-10-06' })) === 'AU-3' && ids(core.auditViews(LOG, { from: '2026-10-07', to: '2026-10-07' })) === 'AU-4');
ok('both ends are included', ids(core.auditViews(LOG, { from: '2026-10-05', to: '2026-10-06' })) === 'AU-3,AU-2,AU-1');
ok('only From, only To', ids(core.auditViews(LOG, { from: '2026-10-07' })) === 'AU-5,AU-4' && ids(core.auditViews(LOG, { to: '2026-10-05' })) === 'AU-2,AU-1');
ok('a range the wrong way round is swapped, not empty', ids(core.auditViews(LOG, { from: '2026-10-06', to: '2026-10-05' })) === 'AU-3,AU-2,AU-1');
ok('a malformed or impossible day is ignored', core.auditViews(LOG, { from: 'yesterday' }).length === 5 && core.auditViews(LOG, { to: '2026-02-31' }).length === 5);
ok('all filters combine', ids(core.auditViews(LOG, { tutorId: 'GOC-T-001', studentId: 'GOC-S-001', kind: 'contact-view', from: '2026-10-05', to: '2026-10-05' })) === 'AU-2');
ok('the input list is never changed', LOG[0].id === 'AU-1' && LOG.length === 5);
ok('bad input gives an empty list, not a crash', core.auditViews(null, {}).length === 0 && core.auditViews([null, 5], null).length === 0);

console.log('\nthe CSV');
var csv = core.auditCsv(core.auditViews(LOG, { tutorId: 'GOC-T-001' }));
var lines = csv.split('\r\n');
ok('a header and one line per entry', lines.length === 4 && /^Entry,Date \(Nigeria\),Time \(Nigeria\),Tutor ID,Tutor,Scholar ID,Student,Subject,Action$/.test(lines[0]), csv);
ok('times are Nigeria time (00:10 on the 7th stays on the 7th)', lines[1] === 'AU-4,2026-10-07,00:10,GOC-T-001,Mrs Ada Obi,GOC-S-003,Tolu,Physics,Opened page', lines[1]);
ok('the action is written in words', /Showed contact/.test(csv) && /Opened page/.test(csv));
var evil = core.auditCsv([{ id: 'AU-9', kind: 'tutor-view', tutorId: 'T', tutorName: '=HYPERLINK("x")', studentId: 'S', studentName: 'A, "B"', subject: 'Physics', at: at('2026-10-05', '09:00') }]);
ok('a name that starts with = is neutralised, and commas and quotes are escaped', /'=HYPERLINK/.test(evil) && /"A, ""B"""/.test(evil), evil);
ok('an empty list is the header only', core.auditCsv([]).split('\r\n').length === 1);
ok('no email, phone or hash column exists', !/email|phone|hash|password/i.test(lines[0]));

console.log('\nthe routes and drivers');
var apiSrc = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
ok('both drivers and the public API carry listTutorViews', (apiSrc.match(/listTutorViews:/g) || []).length === 3);
ok('the HTTP driver sends all five filters to the management route', /\/audit\/tutor-views/.test(apiSrc) && /\['tutorId', 'studentId', 'kind', 'from', 'to'\]/.test(apiSrc));
var serverSrc = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
ok('the server passes kind, from and to on, behind the console gate', /path: \/\^\\\/api\\\/audit\\\/tutor-views\$\/, need: 'console'/.test(serverSrc) && /kind: q\.get\('kind'\), from: q\.get\('from'\), to: q\.get\('to'\)/.test(serverSrc));

console.log('\nthe screen');
var panel = app.slice(app.indexOf('tutors: function(){'), app.indexOf('approvals: function(){'));
ok('the Tutors panel has the Tutor access log with all five filters and Export CSV', /Tutor access log/.test(panel) && ['admAudTutor', 'admAudStudent', 'admAudKind', 'admAudFrom', 'admAudTo', 'admAudCsvBtn'].every(function (i) { return panel.indexOf('id="' + i + '"') > -1; }));
ok('it opens with the panel, and the tutor list also fills the tutor choice', /section === 'tutors'\)\{ admTutLoad\(\); admAuditLoad\(\); \}/.test(app) && /admTutRender\(\);\s*admAuditFillTutors\(\);/.test(app));

var els = { admAudList: { innerHTML: '' }, admAudTutor: { value: '', innerHTML: '' }, admAudStudent: { value: '' }, admAudKind: { value: '' }, admAudFrom: { value: '' }, admAudTo: { value: '' }, admAudCsvBtn: { disabled: true } };
var asked = [], toasts = [], blobs = [], downloads = [], reply = null, fail = null;
function Blob(parts, o) { this.parts = parts; this.type = o && o.type; }
var sandbox = {
  GOC: { core: core, api: { listTutorViews: function (f) { asked.push(f); return fail ? Promise.reject(new Error(fail)) : Promise.resolve(reply); } } },
  document: { getElementById: function (id) { return els[id] || null; } },
  admTutCache: [{ id: 'GOC-T-001', name: 'Mrs Ada Obi' }, { id: 'GOC-T-002', name: 'Mr <b>Bayo</b>' }], admAudRows: [], admAudSeq: 0,
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  toast: function (m) { toasts.push(m); }, Blob: Blob, downloadResourceBlob: function (b, t, e) { downloads.push([b, t, e]); },
  Promise: Promise, String: String, Number: Number, Date: Date, Array: Array
};
var ctx = vm.createContext(sandbox);
vm.runInContext(['admAuditFilters', 'admAuditFillTutors', 'admAuditLoad', 'admAuditBtn', 'admAuditPaint', 'admAuditClear', 'admAuditExport'].map(grab).join('\n'), ctx);
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };

(async function () {
  reply = { keptDays: 365, count: 5, entries: core.auditViews(LOG, {}) };
  sandbox.admAuditFillTutors();
  ok('the tutor choice lists every tutor, names escaped', /Any tutor/.test(els.admAudTutor.innerHTML) && /GOC-T-001/.test(els.admAudTutor.innerHTML) && /&lt;b&gt;Bayo/.test(els.admAudTutor.innerHTML) && !/<b>Bayo/.test(els.admAudTutor.innerHTML));
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('Show asks the server with the chosen filters (all blank at first)', asked.length === 1 && JSON.stringify(asked[0]) === JSON.stringify({ tutorId: '', studentId: '', kind: '', from: '', to: '' }), JSON.stringify(asked));
  var h = els.admAudList.innerHTML;
  ok('it lists the entries with tutor, student, subject, action and Nigeria time', /Mrs Ada Obi/.test(h) && /Gina Goc/.test(h) && /Showed contact/.test(h) && /Opened page/.test(h) && /AU-5/.test(h) && /<b>5<\/b> entries/.test(h), h.slice(0, 300));
  ok('Export CSV is switched on once there are rows', els.admAudCsvBtn.disabled === false);

  els.admAudTutor.value = 'GOC-T-001'; els.admAudStudent.value = ' GOC-S-001 '; els.admAudKind.value = 'contact-view'; els.admAudFrom.value = '2026-10-05'; els.admAudTo.value = '2026-10-06';
  reply = { keptDays: 365, count: 1, entries: [LOG[1]] };
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('the chosen filters are sent (the Scholar ID trimmed)', JSON.stringify(asked[1]) === JSON.stringify({ tutorId: 'GOC-T-001', studentId: 'GOC-S-001', kind: 'contact-view', from: '2026-10-05', to: '2026-10-06' }), JSON.stringify(asked[1]));
  ok('one entry reads "1 entry"', /<b>1<\/b> entry/.test(els.admAudList.innerHTML));

  sandbox.admAuditExport();
  ok('Export CSV writes exactly the rows on screen, as a CSV file named for the day', downloads.length === 1 && downloads[0][2] === 'csv' && /^goc-tutor-access-log-\d{4}-\d{2}-\d{2}$/.test(downloads[0][1]) && downloads[0][0].type === 'text/csv;charset=utf-8' && downloads[0][0].parts[0].split('\r\n').length === 2, JSON.stringify(downloads[0] && downloads[0][1]));

  reply = { keptDays: 365, count: 0, entries: [] };
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('nothing matching says so, and Export CSV is switched off', /No entries match these filters\./.test(els.admAudList.innerHTML) && els.admAudCsvBtn.disabled === true);
  sandbox.admAuditExport();
  ok('exporting with no rows exports nothing', downloads.length === 1 && toasts.indexOf('Nothing to export.') > -1);

  sandbox.admAuditClear(); await tick(); await tick();
  ok('Clear empties every filter and reloads', els.admAudStudent.value === '' && els.admAudKind.value === '' && els.admAudFrom.value === '' && asked.length === 4 && JSON.stringify(asked[3]) === JSON.stringify({ tutorId: '', studentId: '', kind: '', from: '', to: '' }));
  ok('an empty log with no filters says no tutor has opened a student yet', /No tutor has opened a student yet\./.test(els.admAudList.innerHTML));

  var many = []; for (var i = 0; i < 260; i++) many.push(Object.assign({}, LOG[0], { id: 'AU-' + (100 + i), at: LOG[0].at + i * 1000 }));
  reply = { keptDays: 365, count: 260, entries: core.auditViews(many, {}) };
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('a long log shows the newest 200 and says the CSV has them all', (els.admAudList.innerHTML.match(/class="ad-cred"/g) || []).length === 200 && /newest 200 shown; Export CSV has them all/.test(els.admAudList.innerHTML));
  sandbox.admAuditExport();
  ok('the CSV of a long log carries all 260', downloads[1][0].parts[0].split('\r\n').length === 261);

  els.admAudFrom.value = 'tomorrow'; var before = asked.length;
  sandbox.admAuditLoad(); await tick();
  ok('a bad date is refused on the screen and nothing is asked', asked.length === before && toasts.indexOf('Choose a valid From date.') > -1);
  els.admAudFrom.value = '';

  fail = 'Management accounts only.';
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('a refused request shows the reason on the card and switches Export off', /Management accounts only\./.test(els.admAudList.innerHTML) && els.admAudCsvBtn.disabled === true);
  fail = null;

  reply = { keptDays: 365, count: 1, entries: [Object.assign({}, LOG[0], { tutorName: '<img src=x onerror=alert(1)>' })] };
  sandbox.admAuditLoad(); await tick(); await tick();
  ok('a name with markup in it is written escaped', !/<img/.test(els.admAudList.innerHTML) && /&lt;img/.test(els.admAudList.innerHTML));

  var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  ok('the cache was bumped for the app.js and goc-core.js change', /const CACHE = 'goc-v(1[3-9]\d|[2-9]\d\d)'/.test(sw) && !/goc-v129/.test(sw));

  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
