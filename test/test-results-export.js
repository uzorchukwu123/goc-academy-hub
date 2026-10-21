/* test-results-export.js — Phase 4.B (first half): Results export. The pure rules (terms, rows, CSV), the server route
   over HTTP on the real server, the drivers, and the console's "Export results" card.
   node test/test-results-export.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var vm = require('vm');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var apiSrc = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
var serverSrc = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var activeStudent = require('./active-student.js');
var pdfWriter = require(path.join(APP, 'server', 'pdf-writer.js'));
var PORT = Number(process.env.GOC_XP_PORT) || 8177;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function at(day, hhmm) { return Date.parse(day + 'T' + hhmm + ':00+01:00'); }   /* a Nigeria wall-clock time */
function ids(r) { return r.map(function (e) { return e.id; }).join(','); }

/* ---- stored attempts ---- */
function jambAnswers() {
  var out = [];
  [['Use of English', [true, true]], ['Physics', [true, false]], ['Chemistry', [true, true]], ['Biology', [false, false]]].forEach(function (s) {
    s[1].forEach(function (c, i) { out.push({ kind: 'objective', subject: s[0], questionId: s[0] + i, isCorrect: c }); });
  });
  return out;
}
function att(id, scholarId, name, section, subject, day, hhmm, status, score, max) {
  return { id: id, scholarId: scholarId, studentName: name, period: 'Mid-term', section: section, subject: subject, submittedAt: at(day, hhmm),
    status: status, score: score, maxScore: max, percent: max ? Math.round(score / max * 100) : 0, total: max, answered: max, unanswered: 0, correct: score, wrong: max - score, answers: [] };
}
var A = [
  att('R-1', 'GOC-S-001', 'Ada Test', 'objective', 'Physics', '2026-10-05', '10:00', 'marked', 7, 10),
  att('R-2', 'GOC-S-001', 'Ada Test', 'theory', 'Chemistry', '2026-10-06', '09:00', 'awaiting-marking', 0, 20),
  Object.assign(att('R-3', 'GOC-S-001', 'Ada Test', 'jamb', 'JAMB-oriented', '2026-10-07', '11:00', 'marked', 5, 8), { answers: jambAnswers() }),
  att('R-4', 'GOC-S-001', 'Ada Test', 'objective', 'Physics', '2027-02-10', '10:00', 'marked', 9, 10),
  att('R-5', 'GOC-S-001', 'Ada Test', 'objective', 'Physics', '2026-12-31', '23:30', 'marked', 6, 10),
  att('R-6', 'GOC-S-001', 'Ada Test', 'objective', 'Physics', '2027-01-01', '00:10', 'marked', 8, 10),
  att('R-7', 'GOC-S-002', '=HYPERLINK("x"), Zed', 'objective', 'Biology', '2026-10-05', '08:00', 'marked', 3, 10),
  att('R-8', 'GOC-S-003', 'Chi', 'practice', 'Physics', '2026-10-05', '08:00', 'marked', 3, 10)
];
var STU = [{ id: 'GOC-S-001', cohort: 'cohort-a' }, { id: 'GOC-S-002', cohort: '' }];

head('the three terms');
var t = core.defaultTerms(2026);
ok('three terms, dates in order', t.length === 3 && t[0].from === '2026-09-01' && t[0].to === '2026-12-31' && t[1].from === '2027-01-01' && t[1].to === '2027-03-31' && t[2].from === '2027-04-01' && t[2].to === '2027-08-31', JSON.stringify(t));
ok('a bad year gives none', core.defaultTerms('x').length === 0 && core.defaultTerms(1900).length === 0);
ok('September starts a school year, August ends one', core.schoolYearStart('2026-09-01') === 2026 && core.schoolYearStart('2026-08-31') === 2025 && core.schoolYearStart('2027-02-01') === 2026);
ok('a term and a year give the term\'s days and a readable name', JSON.stringify(core.termRange({ term: '2', year: 2026 })) === JSON.stringify({ from: '2027-01-01', to: '2027-03-31', label: 'Second term 2026/27' }));
ok('typed dates win over a term', core.termRange({ term: '1', year: 2026, from: '2026-10-01', to: '2026-10-31' }).from === '2026-10-01');
ok('a range the wrong way round is swapped', core.termRange({ from: '2026-10-09', to: '2026-09-01' }).from === '2026-09-01');
ok('one date alone, a bad date, or nothing is refused with a reason', !!core.termRange({ from: '2026-10-09' }).error && !!core.termRange({ from: 'x', to: 'y' }).error && !!core.termRange({}).error && !!core.termRange({ term: '4', year: 2026 }).error);

head('which results are exported');
var r1 = core.resultsExportRows(A, { from: '2026-09-01', to: '2026-12-31', students: STU });
ok('Term 1: marked papers only, in Scholar ID then time order', ids(r1.rows) === 'R-1,R-3,R-5,R-7', ids(r1.rows));
ok('the theory paper still awaiting marking is left out and counted', r1.awaiting === 1);
ok('a practice run is never a Web Test result', r1.rows.every(function (r) { return r.id !== 'R-8'; }));
ok('Nigeria days decide: 23:30 on 31 Dec is Term 1, 00:10 on 1 Jan is Term 2', ids(core.resultsExportRows(A, { from: '2027-01-01', to: '2027-03-31', students: STU }).rows) === 'R-6,R-4');
ok('both end days are included', ids(core.resultsExportRows(A, { from: '2026-10-05', to: '2026-10-05', students: STU }).rows) === 'R-1,R-7');
ok('subject and session narrow the rows', ids(core.resultsExportRows(A, { subject: 'Biology', students: STU }).rows) === 'R-7' && ids(core.resultsExportRows(A, { section: 'jamb', students: STU }).rows) === 'R-3');
ok('cohort narrows by the student\'s own cohort', ids(core.resultsExportRows(A, { cohort: 'cohort-a', from: '2026-09-01', to: '2026-12-31', students: STU }).rows) === 'R-1,R-3,R-5' && core.resultsExportRows(A, { cohort: 'nope', students: STU }).rows.length === 0);
ok('each row carries its cohort', r1.rows[0].cohort === 'cohort-a' && r1.rows[3].cohort === '');
var jr = r1.rows[1];
ok('a JAMB-oriented row carries four subject scores and the total out of 400', jr.jamb && jr.jamb.total === 250 && jr.jamb.max === 400 && jr.jamb.subjects.length === 4 && jr.jamb.subjects[0].subject === 'Use of English' && jr.jamb.subjects[0].score === 100, JSON.stringify(jr.jamb));
ok('other rows have no JAMB block', r1.rows[0].jamb === null);
ok('a row holds no email, phone, hash or answers', r1.rows.every(function (r) { return !('email' in r) && !('phone' in r) && !('hash' in r) && !('answers' in r); }));
ok('the input is never changed', A.length === 8 && A[0].id === 'R-1');
ok('bad input gives nothing, not a crash', core.resultsExportRows(null, null).rows.length === 0 && core.resultsExportRows([null, 5, {}], {}).rows.length === 0);

head('the CSV');
var csv = core.resultsCsv(r1.rows), lines = csv.split('\r\n');
ok('a header and one line per row', lines.length === 5 && /^Scholar ID,Student,Cohort,Subject,Session,Period,Date \(Nigeria\),Time \(Nigeria\),Score,Out of,Percent,JAMB subject 1,/.test(lines[0]) && /,JAMB total,JAMB out of$/.test(lines[0]));
ok('date and time are Nigeria time', /GOC-S-001,Ada Test,cohort-a,Physics,Objective,Mid-term,2026-10-05,10:00,7,10,70,/.test(lines[1]), lines[1]);
ok('the JAMB-oriented line has the four subjects and 250 out of 400', /JAMB-oriented/.test(lines[2]) && /Use of English,100,Physics,50,Chemistry,100,Biology,0,250,400$/.test(lines[2]), lines[2]);
ok('a name starting with = is neutralised and its comma and quotes escaped', /'=HYPERLINK\(""x""\), Zed/.test(lines[4]) && /^GOC-S-002,"'=HYPERLINK/.test(lines[4]), lines[4]);
ok('no email, phone or hash column', !/email|phone|hash|password/i.test(lines[0]));
ok('no rows is the header only', core.resultsCsv([]).split('\r\n').length === 1);
ok('the audit CSV still escapes the same way (shared cell)', /'=HYPERLINK/.test(core.auditCsv([{ id: 'x', at: 0, tutorId: 't', tutorName: '=HYPERLINK("a")', studentId: 's', studentName: 'n', subject: 'Physics' }])));

head('the PDF page model');
function bigRows(n, subject) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ id: subject + i, scholarId: 'GOC-S-' + String(100 + i), studentName: 'Student ' + i, cohort: 'c1', cohortName: 'Cohort One', subject: subject, section: 'objective', period: 'Mid-term', submittedAt: at('2026-10-05', '10:00') + i, score: i % 11, maxScore: 10, percent: (i % 11) * 10, jamb: null });
  return out;
}
var jr6 = []; for (var q = 0; q < 6; q++) jr6.push(Object.assign({}, jr, { id: 'J' + q, scholarId: 'GOC-S-20' + q }));
var allRows = bigRows(70, 'Physics').concat(bigRows(10, 'Chemistry'), jr6);
var model = core.resultsPdfModel(allRows, { label: 'First term 2026/27', from: '2026-09-01', to: '2026-12-31', awaiting: 3, generatedOn: '2026-10-10', filters: {} });
function texts(pg) { return pg.items.filter(function (i) { return i.kind === 'text'; }).map(function (i) { return i.text; }); }
ok('A4 landscape, and a long list runs over several pages', model.page.w === 842 && model.page.h === 595 && model.pages.length >= 3, model.pages.length);
ok('every page says "Page n of N"', model.pages.every(function (pg, i) { return texts(pg).indexOf('Page ' + (i + 1) + ' of ' + model.pages.length) > -1; }));
ok('the first page carries the title, the term, the count, the awaiting note and the date', /Results/.test(texts(model.pages[0])[0]) && /First term 2026\/27/.test(texts(model.pages[0])[1]) && texts(model.pages[0]).some(function (x) { return /86 marked results/.test(x); }) && texts(model.pages[0]).some(function (x) { return /3 theory papers still awaiting marking are not included/.test(x); }) && texts(model.pages[0]).indexOf('Prepared on 2026-10-10') > -1);
ok('nothing is drawn below the footer line or outside the page', model.pages.every(function (pg) { return pg.items.every(function (i) { return i.kind === 'rule' ? i.y1 <= 595 - 36 : (i.kind === 'rect' ? i.y + i.h <= 595 - 36 - 18 + 1 : (i.y <= 595 - 36 && i.x >= 36 && i.x <= 842 - 36)); }); }));
ok('one table per subject, JAMB-oriented last, each with its count', texts(model.pages[0]).indexOf('Chemistry (10)') > -1 && model.pages.some(function (pg) { return texts(pg).indexOf('Physics (70)') > -1; }) && model.pages[model.pages.length - 1].items.some(function (i) { return i.text === 'JAMB-oriented (6)'; }));
ok('a table that runs onto the next page says "continued" and repeats its column heads', model.pages.some(function (pg, i) { return i > 0 && texts(pg).some(function (x) { return /^Physics \(70\) - continued$/.test(x); }) && texts(pg).indexOf('Scholar ID') > -1; }));
var allTexts = [].concat.apply([], model.pages.map(texts));
ok('every row appears exactly once', allTexts.filter(function (x) { return /^GOC-S-1\d\d$/.test(x); }).length === 80 && allTexts.filter(function (x) { return /^GOC-S-20\d$/.test(x); }).length === 6);
ok('the JAMB table has the four subject scores and the Total /400 column', allTexts.indexOf('Total /400') > -1 && allTexts.indexOf('Eng 100') > -1 && allTexts.indexOf('Phy 50') > -1 && allTexts.indexOf('Chem 100') > -1 && allTexts.indexOf('Bio 0') > -1 && allTexts.indexOf('250') > -1);
ok('numbers are right-aligned in their columns', (function () { var sc = model.pages[0].items.filter(function (i) { return i.text === 'Score'; })[0], v = model.pages[0].items.filter(function (i) { return i.kind === 'text' && /^\d+$/.test(i.text) && Math.abs(i.x + core.pdfTextWidth(i.text, 9, false) - (sc.x + core.pdfTextWidth('Score', 9, true))) < 0.5; }); return v.length > 3; })());
ok('a long name is shortened with "..." so it stays in its column', core.pdfFit('A Very Long Student Name Indeed That Will Not Fit In The Column', 190, 9, false).slice(-3) === '...' && core.pdfTextWidth(core.pdfFit('A Very Long Student Name Indeed That Will Not Fit In The Column', 190, 9, false), 9, false) <= 190 && core.pdfFit('Ada', 190, 9, false) === 'Ada');
ok('the cohort shows by name when the row has one', allTexts.indexOf('Cohort One') > -1);
var emptyModel = core.resultsPdfModel([], { label: 'Third term 2026/27', from: '2027-04-01', to: '2027-08-31', awaiting: 0, generatedOn: '2026-10-10', filters: { cohortName: 'Cohort <A>', subject: 'Physics', section: 'jamb' } });
ok('no results is one page that says so, with the filters listed', emptyModel.pages.length === 1 && texts(emptyModel.pages[0]).some(function (x) { return /No marked results match/.test(x); }) && texts(emptyModel.pages[0]).some(function (x) { return /Cohort: Cohort <A>.*Subject: Physics.*Session: JAMB-oriented/.test(x); }));
ok('the model is plain data (no functions) and bad input does not crash', JSON.stringify(model).length > 1000 && core.resultsPdfModel(null, null).pages.length === 1);

head('the PDF file');
var pdf = pdfWriter.pdfFromModel(model), txt = pdf.toString('latin1');
ok('it is a PDF: header, end marker, and it is a Buffer', Buffer.isBuffer(pdf) && txt.indexOf('%PDF-1.4') === 0 && /%%EOF\s*$/.test(txt));
var xr = txt.lastIndexOf('xref\n0 '), sx = Number(/startxref\n(\d+)\n%%EOF/.exec(txt)[1]);
ok('startxref points at the cross-reference table', sx === Buffer.byteLength(txt.slice(0, xr), 'latin1') && txt.slice(xr, xr + 4) === 'xref');
var size = Number(/^xref\n0 (\d+)\n/.exec(txt.slice(xr))[1]), entries = txt.slice(xr).split('\n').slice(2, 2 + size);
ok('every object sits exactly where the table says', entries.length === size && entries.slice(1).every(function (e, i) { var off = Number(e.slice(0, 10)); return txt.slice(Buffer.from(txt, 'latin1').slice(0, off).toString('latin1').length, Buffer.from(txt, 'latin1').slice(0, off).toString('latin1').length + String(i + 1).length + 6) === (i + 1) + ' 0 obj'; }));
ok('the page count in the file matches the model', new RegExp('/Count ' + model.pages.length + ' ').test(txt) && (txt.match(/\/Type \/Page /g) || []).length === model.pages.length);
ok('each content stream says its true length', (function () { var re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g, m, n = 0; while ((m = re.exec(txt))) { n++; if (Buffer.byteLength(m[2], 'latin1') !== Number(m[1])) return false; } return n === model.pages.length; })());
ok('it uses the two standard fonts and carries the title', /\/BaseFont \/Helvetica /.test(txt) && /\/BaseFont \/Helvetica-Bold /.test(txt) && /\/Title \(GOC Academy - Results - First term 2026\/27\)/.test(txt));
var tricky = pdfWriter.pdfFromModel({ page: { w: 842, h: 595 }, title: 't', pages: [{ number: 1, items: [{ kind: 'text', x: 10, y: 20, size: 9, bold: false, text: 'a (b) \\ c \u0142 \u00e9' }] }] }).toString('latin1');
ok('brackets and backslashes are escaped, a letter outside Latin-1 becomes ?, e-acute is kept', /\(a \\\(b\\\) \\\\ c \? \xe9\) Tj/.test(tricky), tricky.slice(tricky.indexOf('BT'), tricky.indexOf('ET') + 2));
ok('a model with no pages is refused, not written', (function () { try { pdfWriter.pdfFromModel({ page: { w: 1, h: 1 }, pages: [] }); return false; } catch (e) { return true; } })());

head('the route and the drivers');
var routeAt = serverSrc.indexOf("path: /^\\/api\\/results\\/export$/, need: 'console'"), oneAt = serverSrc.indexOf("path: /^\\/api\\/results\\/([A-Za-z0-9-]+)$/");
ok('the server has the export route behind the console gate, before the one-result route', routeAt > 0 && oneAt > routeAt, routeAt + ' ' + oneAt);
ok('both drivers and the public API carry getResultsExport and getResultsPdf', (apiSrc.match(/getResultsExport:/g) || []).length === 3 && (apiSrc.match(/getResultsPdf:/g) || []).length === 3);
ok('the server driver fetches the PDF with the console session and returns the file', /format=pdf/.test(apiSrc) && /Accept': 'application\/pdf'/.test(apiSrc) && /return r\.blob\(\)/.test(apiSrc));
ok('the server driver sends term, year, dates, cohort, subject and session', /\['term', 'year', 'from', 'to', 'cohort', 'subject', 'section'\]/.test(apiSrc) && /\/results\/export/.test(apiSrc));
ok('the offline demo says it needs the server', /Results export needs a server connection/.test(apiSrc));
ok('the cache was bumped for the app.js, api.js and goc-core.js change', /goc-v(14[5-9]|1[5-9]\d)/.test(fs.readFileSync(path.join(APP, 'sw.js'), 'utf8')));

head('the screen');
var panel = app.slice(app.indexOf('results: function(){'), app.indexOf('theorymark: function(){'));
ok('the Results panel has the Export results card with term, year, dates, session, subject, cohort and Download CSV', /Export results/.test(panel) && ['admXpTerm', 'admXpYear', 'admXpFrom', 'admXpTo', 'admXpSection', 'admXpSubject', 'admXpCohort', 'admXpSummary', 'admXpBtn', 'admXpPdfBtn'].every(function (i) { return panel.indexOf('id="' + i + '"') > -1; }));
ok('it starts with the panel and refills the cohorts when they arrive', /section === 'results'\) \{ admXpInit\(\);/.test(app) && /admLoadCohorts\(\)\.then\(admXpFillCohorts\)/.test(app));
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
}
var els = {}; ['admXpTerm', 'admXpYear', 'admXpFrom', 'admXpTo', 'admXpSection', 'admXpSubject', 'admXpCohort'].forEach(function (i) { els[i] = { value: '', innerHTML: '' }; });
els.admXpSummary = { innerHTML: '', textContent: '' }; els.admXpBtn = { disabled: true }; els.admXpPdfBtn = { disabled: true };
var pdfAsked = [], pdfReply = null;
var asked = [], toasts = [], downloads = [], reply = null, failMsg = null;
function Blob(parts, o) { this.parts = parts; this.type = o && o.type; }
var sandbox = {
  GOC: { core: core, api: { getResultsPdf: function (f) { pdfAsked.push(f); return failMsg ? Promise.reject(new Error(failMsg)) : Promise.resolve(pdfReply); }, getResultsExport: function (f) { asked.push(f); return failMsg ? Promise.reject(new Error(failMsg)) : Promise.resolve(reply); } } },
  document: { getElementById: function (id) { return els[id] || null; } }, admCohortsCache: [{ cohortId: 'cohort-a', name: 'Cohort <A>' }],
  admXpData: null, admXpSeq: 0, admXpPdfBusy: false,
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  toast: function (m) { toasts.push(m); }, Blob: Blob, downloadResourceBlob: function (b, tt, e) { downloads.push([b, tt, e]); },
  Promise: Promise, String: String, Number: Number, Date: Date, Array: Array
};
var ctx = vm.createContext(sandbox);
vm.runInContext(['admXpYearOptions', 'admXpFillCohorts', 'admXpInit', 'admXpTermChange', 'admXpDatesEdited', 'admXpFilters', 'admXpCount', 'admXpDownload', 'admXpDownloadPdf'].map(grab).join('\n'), ctx);
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };

function startServer() {
  var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-xp-test-'));
  fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
  try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
  try { require('child_process').spawnSync('pkill', ['-f', 'goc-xp-test-.*server\\.js'], { stdio: 'ignore' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); } catch (e) {}
  var log = '';
  var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function (c) { log += c; }); child.stderr.on('data', function (c) { log += c; });
  return { sandbox: SANDBOX, child: child, log: function () { return log; }, stop: function () { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} } };
}
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j, headers: res.headers }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, headers: {} }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(srv, n) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start\n' + srv.log());
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(srv, n - 1); });
  });
}

(async function () {
  /* ---- the screen, with a stubbed driver ---- */
  reply = { from: '2026-09-01', to: '2026-12-31', label: 'x', count: 4, awaiting: 1, rows: r1.rows };
  sandbox.admXpInit(); await tick(); await tick();
  var today = core.lagosDay(), y = core.schoolYearStart(today), cur = core.defaultTerms(y).filter(function (x) { return today >= x.from && today <= x.to; })[0] || core.defaultTerms(y)[0];
  ok('it opens on the term we are in, with that term\'s dates filled in', els.admXpTerm.value === cur.term && els.admXpFrom.value === cur.from && els.admXpTo.value === cur.to, JSON.stringify([els.admXpTerm.value, els.admXpFrom.value, els.admXpTo.value]));
  ok('the school-year choice starts at this school year', /selected/.test(sandbox.admXpYearOptions()) && new RegExp('value="' + y + '" selected').test(sandbox.admXpYearOptions()));
  ok('the cohort choice lists the cohorts, names escaped', /value="cohort-a"/.test(els.admXpCohort.innerHTML) && /Cohort &lt;A&gt;/.test(els.admXpCohort.innerHTML));
  ok('opening asks the server once with the term\'s dates and no other filter', asked.length === 1 && JSON.stringify(asked[0]) === JSON.stringify({ from: cur.from, to: cur.to, section: '', subject: '', cohort: '' }), JSON.stringify(asked));
  ok('it says how many, which days, and how many theory papers are left out', /<b>4<\/b> marked results from 2026-09-01 to 2026-12-31\./.test(els.admXpSummary.innerHTML) && /1 theory paper still awaiting marking is left out\./.test(els.admXpSummary.innerHTML), els.admXpSummary.innerHTML);
  ok('Download CSV and Download PDF are switched on once there are results', els.admXpBtn.disabled === false && els.admXpPdfBtn.disabled === false);

  els.admXpYear.value = '2026'; els.admXpTerm.value = '2'; sandbox.admXpTermChange(); await tick(); await tick();
  ok('choosing a term fills its default dates and asks again', els.admXpFrom.value === '2027-01-01' && els.admXpTo.value === '2027-03-31' && asked[1].from === '2027-01-01' && asked[1].to === '2027-03-31');
  els.admXpFrom.value = '2026-10-01'; els.admXpTo.value = '2026-10-31'; sandbox.admXpDatesEdited(); await tick(); await tick();
  ok('typing dates switches the term to Custom and uses exactly those days', els.admXpTerm.value === '' && asked[2].from === '2026-10-01' && asked[2].to === '2026-10-31');
  els.admXpSection.value = 'jamb'; els.admXpSubject.value = 'Physics'; els.admXpCohort.value = 'cohort-a';
  sandbox.admXpCount(); await tick(); await tick();
  ok('session, subject and cohort are sent', JSON.stringify(asked[3]) === JSON.stringify({ from: '2026-10-01', to: '2026-10-31', section: 'jamb', subject: 'Physics', cohort: 'cohort-a' }), JSON.stringify(asked[3]));

  sandbox.admXpDownload();
  ok('Download writes exactly the rows counted, as a CSV named for the days', downloads.length === 1 && downloads[0][2] === 'csv' && downloads[0][1] === 'goc-results-2026-09-01-to-2026-12-31' && downloads[0][0].type === 'text/csv;charset=utf-8' && downloads[0][0].parts[0] === core.resultsCsv(r1.rows));

  reply = { from: '2026-10-01', to: '2026-10-31', count: 1, awaiting: 0, rows: [r1.rows[0]] };
  sandbox.admXpCount(); await tick(); await tick();
  ok('one result reads "1 marked result" with nothing left out', /<b>1<\/b> marked result from/.test(els.admXpSummary.innerHTML) && !/awaiting/.test(els.admXpSummary.innerHTML));
  reply = { from: '2026-10-01', to: '2026-10-31', count: 0, awaiting: 3, rows: [] };
  sandbox.admXpCount(); await tick(); await tick();
  ok('nothing marked says so and switches Download off', /No marked results from/.test(els.admXpSummary.innerHTML) && /3 theory papers still awaiting marking are left out/.test(els.admXpSummary.innerHTML) && els.admXpBtn.disabled === true);
  sandbox.admXpDownload();
  ok('downloading with nothing to export does nothing', downloads.length === 1 && toasts.indexOf('Nothing to export.') > -1);

  pdfReply = { pdf: true }; var nDown = downloads.length;
  els.admXpSection.value = ''; els.admXpSubject.value = ''; els.admXpCohort.value = '';
  reply = { from: '2026-10-01', to: '2026-10-31', count: 4, awaiting: 0, rows: r1.rows };
  sandbox.admXpCount(); await tick(); await tick();
  sandbox.admXpDownloadPdf();
  ok('Download PDF is switched off while the file is being made', els.admXpPdfBtn.disabled === true && pdfAsked.length === 1);
  await tick(); await tick();
  ok('it asks the server with the same choices as the count', JSON.stringify(pdfAsked[0]) === JSON.stringify({ from: '2026-10-01', to: '2026-10-31', section: '', subject: '', cohort: '' }), JSON.stringify(pdfAsked[0]));
  ok('the file is saved as a PDF named for the days, and the button comes back', downloads.length === nDown + 1 && downloads[nDown][2] === 'pdf' && downloads[nDown][1] === 'goc-results-2026-10-01-to-2026-10-31' && downloads[nDown][0] === pdfReply && els.admXpPdfBtn.disabled === false && toasts.some(function (m) { return /^PDF ready: 4 results$/.test(m); }), JSON.stringify(downloads[nDown] && downloads[nDown][1]));
  failMsg = 'No PDF today.'; sandbox.admXpDownloadPdf(); await tick(); await tick();
  ok('a failed PDF shows the reason, saves nothing and re-enables the button', toasts.indexOf('No PDF today.') > -1 && downloads.length === nDown + 1 && els.admXpPdfBtn.disabled === false);
  failMsg = null;
  reply = { from: '2026-10-01', to: '2026-10-31', count: 0, awaiting: 0, rows: [] };
  sandbox.admXpCount(); await tick(); await tick();
  var askedPdf = pdfAsked.length; sandbox.admXpDownloadPdf();
  ok('with nothing to export the PDF is not even requested', pdfAsked.length === askedPdf && els.admXpPdfBtn.disabled === true);
  reply = { from: '2026-10-01', to: '2026-10-31', count: 1, awaiting: 0, rows: [r1.rows[0]] };
  sandbox.admXpCount(); await tick(); await tick();
  els.admXpFrom.value = ''; var before = asked.length;
  sandbox.admXpCount(); await tick();
  ok('a missing date is refused on the screen and nothing is asked', asked.length === before && /Choose both a From and a To date\./.test(els.admXpSummary.innerHTML) && els.admXpBtn.disabled === true);
  els.admXpFrom.value = '2026-10-01'; failMsg = 'The server said no.';
  sandbox.admXpCount(); await tick(); await tick();
  ok('a refused or failed count shows the reason and keeps Download off', /The server said no\./.test(els.admXpSummary.innerHTML) && els.admXpBtn.disabled === true);
  failMsg = null;

  /* ---- the real server ---- */
  head('over HTTP on the real server');
  var srv = startServer();
  try {
    await waitForBoot(srv, 100);
    var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var ftok = f.body && f.body.token;
    var stu = await activeStudent(call, { name: 'Ada Test', password: 'secret123', email: 'ada@example.com', phone: '08000000071', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] }, ftok);
    ok('a student exists to own the results', !!stu.id, JSON.stringify(stu.signup && stu.signup.body));
    var dbPath = path.join(srv.sandbox, 'server', 'data.json');
    var db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    var me = db.students.filter(function (s) { return s.id === stu.id; })[0];
    me.cohort = 'cohort-a';
    var real = A.map(function (a) { return Object.assign({}, a, { scholarId: a.scholarId === 'GOC-S-001' ? stu.id : a.scholarId }); });
    db.attempts = real;
    fs.writeFileSync(dbPath, JSON.stringify(db));

    var none = await call('GET', '/api/results/export?term=1&year=2026');
    ok('no sign-in is refused', none.status === 401, none.status);
    var stud = await call('GET', '/api/results/export?term=1&year=2026', null, stu.token);
    ok('a student is refused', stud.status === 401 || stud.status === 403, stud.status);
    var locked = await call('GET', '/api/results/export?term=1&year=2026', null, ftok);
    ok('even the founder is refused until the console is unlocked', locked.status === 403, locked.status + ' ' + locked.raw);
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);

    var t1 = await call('GET', '/api/results/export?term=1&year=2026', null, ftok);
    ok('Term 1 2026/27: the marked rows, with the label, the days and the awaiting count', t1.status === 200 && t1.body.count === 4 && t1.body.rows.length === 4 && t1.body.awaiting === 1 && t1.body.from === '2026-09-01' && t1.body.to === '2026-12-31' && t1.body.label === 'First term 2026/27', t1.raw.slice(0, 200));
    ok('the rows are sorted by Scholar ID then time and carry the cohort', t1.body.rows[0].scholarId === 'GOC-S-001' || t1.body.rows[0].scholarId === stu.id);
    ok('the JAMB-oriented row has its 250 out of 400', t1.body.rows.some(function (r) { return r.jamb && r.jamb.total === 250 && r.jamb.max === 400; }));
    ok('nothing private is in the reply', !/ada@example\.com|08000000071|hash|password/i.test(t1.raw), t1.raw.slice(0, 120));
    var t2 = await call('GET', '/api/results/export?term=2&year=2026', null, ftok);
    ok('Term 2 holds the January and February papers', t2.body.count === 2 && t2.body.awaiting === 0);
    var typed = await call('GET', '/api/results/export?from=2026-10-05&to=2026-10-05', null, ftok);
    ok('typed days work and both ends count', typed.body.count === 2);
    var sw = await call('GET', '/api/results/export?from=2026-10-07&to=2026-10-05', null, ftok);
    ok('a range the wrong way round still works', sw.status === 200 && sw.body.from === '2026-10-05' && sw.body.to === '2026-10-07' && sw.body.count === 3 && sw.body.awaiting === 1);
    var coh = await call('GET', '/api/results/export?term=1&year=2026&cohort=cohort-a', null, ftok);
    ok('cohort filter keeps only that cohort\'s students', coh.body.count === 3 && coh.body.rows.every(function (r) { return r.cohort === 'cohort-a'; }));
    var sub = await call('GET', '/api/results/export?term=1&year=2026&subject=Biology', null, ftok);
    ok('subject filter', sub.body.count === 1 && sub.body.rows[0].subject === 'Biology');
    var sec = await call('GET', '/api/results/export?term=1&year=2026&section=jamb', null, ftok);
    ok('session filter', sec.body.count === 1);
    var bad = await call('GET', '/api/results/export?term=1', null, ftok);
    ok('a term without a year is a 400 with a reason', bad.status === 400 && /term and a school year/.test(bad.raw), bad.raw);
    var bad2 = await call('GET', '/api/results/export?term=1&year=2026&section=practice', null, ftok);
    ok('an unknown session is a 400', bad2.status === 400);
    var csvR = await call('GET', '/api/results/export?term=1&year=2026&format=csv', null, ftok);
    ok('format=csv sends the file: text/csv, an attachment named for the days, header + 4 lines', csvR.status === 200 && /text\/csv/.test(csvR.headers['content-type']) && /attachment; filename="goc-results-2026-09-01-to-2026-12-31\.csv"/.test(csvR.headers['content-disposition']) && csvR.raw.split('\r\n').length === 5, csvR.headers['content-disposition'] + ' ' + csvR.raw.split('\r\n').length);
    ok('the file is exactly what the console would build from the JSON', csvR.raw === core.resultsCsv(t1.body.rows));
    var pdfR = await call('GET', '/api/results/export?term=1&year=2026&format=pdf', null, ftok);
    ok('format=pdf sends a PDF: application/pdf, an attachment named for the days', pdfR.status === 200 && /application\/pdf/.test(pdfR.headers['content-type']) && /attachment; filename="goc-results-2026-09-01-to-2026-12-31\.pdf"/.test(pdfR.headers['content-disposition']), pdfR.status + ' ' + pdfR.headers['content-type']);
    ok('the body is a real PDF with one page for these four results', /^%PDF-1\.4/.test(pdfR.raw) && /%%EOF\s*$/.test(pdfR.raw) && /\/Count 1 /.test(pdfR.raw));
    ok('the PDF holds the results and the awaiting note but nothing private', /Ada Test/.test(pdfR.raw) && /1 theory paper still awaiting marking is not included/.test(pdfR.raw) && /250/.test(pdfR.raw) && !/ada@example\.com|08000000071|password/i.test(pdfR.raw));
    var pdfNone = await call('GET', '/api/results/export?term=1&year=2026&format=pdf');
    ok('a PDF without a console session is refused like the rest', pdfNone.status === 401, pdfNone.status);
    var pdfEmpty = await call('GET', '/api/results/export?term=3&year=2026&format=pdf', null, ftok);
    ok('a term with no results still gives a valid one-page PDF', pdfEmpty.status === 200 && /No marked results match/.test(pdfEmpty.raw) && /\/Count 1 /.test(pdfEmpty.raw));
    var pdfCoh = await call('GET', '/api/results/export?term=1&year=2026&cohort=cohort-a&subject=Physics&format=pdf', null, ftok);
    ok('the filters are printed on the PDF', /Cohort: cohort-a/.test(pdfCoh.raw) && /Subject: Physics/.test(pdfCoh.raw));
    var one = await call('GET', '/api/results/R-1', null, ftok);
    ok('the single-result route still works next to the new one', one.status === 200 || one.status === 404, one.status);
  } finally { srv.stop(); }

  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('\nTEST RUN FAILED: ' + (e && e.stack || e)); process.exit(1); });
