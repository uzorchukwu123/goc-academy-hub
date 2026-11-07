/* The existing 2027 bank panels: labelled options, letter-to-index adapter,
   live preview, editing, CSV guidance/template and bank-local import reports.
   Runs the actual admin script against the repository's small DOM and API
   stand-ins; the real HTTP contracts are covered by test-free2027-banks.js.
   node test/test-free2027-question-form.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js/goc-core.js'));
var rules = require(path.join(APP, 'js/goc-free-2027.js'));
var freeServer = require(path.join(APP, 'server/lib/free2027.js'));
var parseFreeCsv = freeServer.parseFreeBankCsv;
var dom = require('./minidom.js');
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra === undefined ? '' : ' (' + String(extra).slice(0, 240) + ')')); }
}
function tick() { var p = Promise.resolve(); for (var i = 0; i < 20; i++) p = p.then(function () {}); return p; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
var doc = new dom.Doc(), sheet = new dom.El('div', { id: 'admSheetBody' });
doc.body.appendChild(sheet);
var banks = { weekly: [], competition: [] }, calls = [], downloads = [], messages = [];
var seq = { weekly: 0, competition: 0 }, saveError = null, importError = null;
var subjects = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
function overview() {
  var out = { subjects: subjects, banks: {} };
  Object.keys(banks).forEach(function (b) {
    var by = {}; banks[b].forEach(function (q) { by[q.subject] = (by[q.subject] || 0) + 1; });
    out.banks[b] = { count: banks[b].length, bySubject: by };
  });
  return out;
}
function save(bank, payload, id) {
  calls.push(['save', bank, id || null, clone(payload)]);
  if (saveError) return Promise.reject(new Error(saveError));
  // Match cleanBankQuestion: manual bank entries are always objective.
  var v = core.validateQuestion(Object.assign({}, payload, { section: 'objective' }));
  if (v.error) return Promise.reject(new Error(v.error));
  var old = id ? banks[bank].filter(function (q) { return q.id === id; })[0] : null;
  var q = Object.assign(old || {}, v.rec, {
    id: id || (bank === 'weekly' ? 'WQ-' : 'CQ-') + String(++seq[bank]).padStart(3, '0'),
    bank: bank, kind: 'objective', section: 'objective'
  });
  if (!old) banks[bank].push(q);
  return Promise.resolve({ bank: bank, question: clone(q) });
}
var api = {
  adminBanks: function () { return Promise.resolve(overview()); },
  adminBankQuestions: function (bank) { return Promise.resolve({ bank: bank, total: banks[bank].length, questions: clone(banks[bank]) }); },
  adminBankCreate: function (bank, p) { return save(bank, p); },
  adminBankUpdate: function (bank, id, p) { return save(bank, p, id); },
  adminBankImport: function (bank, csv, preview) {
    calls.push(['import', bank, !!preview]);
    if (importError) return Promise.reject(new Error(importError));
    var r = parseFreeCsv(csv, banks[bank], { preview: preview });
    if (r.error) return Promise.reject(new Error(r.error));
    if (preview) return Promise.resolve({ bank: bank, read: r.read, wouldImport: r.records.length, skipped: r.errors.length, errors: r.errors, rows: r.preview });
    var rows = r.records.map(function (q) {
      q.id = (bank === 'weekly' ? 'WQ-' : 'CQ-') + String(++seq[bank]).padStart(3, '0');
      q.bank = bank; banks[bank].push(q); return q;
    });
    return Promise.resolve({ bank: bank, read: r.read, imported: rows.length, skipped: r.errors.length, error: undefined, errors: r.errors, questions: rows });
  }
};
function BlobStub(parts, options) { this.parts = parts; this.type = options.type; }
var sandbox = {
  console: console, document: doc, readyState: 'complete', admMe: { id: 'GOC-A-001', roleKey: 'founder' },
  GOC: { core: core, free2027: rules, free: api, api: { ready: Promise.resolve() } },
  toast: function (m) { messages.push(m); }, Blob: BlobStub,
  URL: { createObjectURL: function (blob) { downloads.push(blob); return 'blob:template'; }, revokeObjectURL: function () {} },
  setTimeout: function (fn) { return 0; }, FileReader: function () {
    var self = this;
    this.readAsText = function (file) { self.result = file.csv; Promise.resolve().then(function () { if (self.onload) self.onload(); }); };
  }
};
sandbox.window = sandbox;
dom.El.prototype.scrollIntoView = function () {};
dom.El.prototype.remove = function () {
  if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(function (c) { return c !== this; }, this);
};
// Capture the click without navigating outside the test DOM.
dom.El.prototype.click = function () { this.clicked = true; };
var adminSrc = fs.readFileSync(path.join(APP, 'js/free2027-admin.js'), 'utf8');
vm.runInContext(adminSrc, vm.createContext(sandbox));
var $ = function (id) { return doc.getElementById(id); };
function field(bank, name, value) {
  var el = $('f27NQ-' + bank + '-' + name); el.value = value;
  // Minidom derives initial select value from markup; model a live selection.
  if (el.tagName === 'SELECT') el.querySelectorAll('option').forEach(function (o) { delete o.attributes.selected; });
  return el;
}
function input(bank) { sandbox.f27BankQuestionInput(bank); }
function fill(bank, withE) {
  field(bank, 'subject', 'Mathematics'); field(bank, 'topic', 'Statistics');
  field(bank, 'text', 'Which of the following is a measure of central tendency?\nChoose the best answer.');
  ['Range', 'Mean', 'Variance', 'Standard deviation', withE ? 'Skewness' : ''].forEach(function (v, i) {
    field(bank, 'option' + 'ABCDE'[i], v);
  });
  field(bank, 'answer', 'B'); field(bank, 'difficulty', 'medium');
  field(bank, 'explanation', 'The mean is the arithmetic average.'); input(bank);
}

(async function () {
  console.log('\nConsole mounting survives sign-in after page load');
  var mdoc = new dom.Doc(), msheet = new dom.El('div', { id: 'admSheetBody' }), mnav = new dom.El('div', { id: 'admTileNav' });
  mdoc.body.appendChild(msheet); mdoc.body.appendChild(mnav);
  mnav.insertAdjacentHTML = function (where, html) { if (where === 'beforeend') this.innerHTML += html; };
  var opened = [];
  var msandbox = {
    console: console, document: mdoc, admMe: { id: '', roleKey: null },
    GOC: { core: core, free2027: rules, free: {
      adminOverview: function () { return Promise.resolve({ enabled: false, mode: 'original', courses: [], session: { label: 'Session 1', id: 'F27-S1', participants: 0, verified: 0, activities: 0, published: 0, submitted: 0 } }); }
    }, api: { ready: Promise.resolve() } },
    toast: function () {}, admOpen: function (section) { opened.push(section); },
    admMenuApply: function () { mnav.innerHTML = '<button class="adm-tile" data-section="overview">Overview</button>'; }
  };
  msandbox.window = msandbox;
  vm.runInContext(adminSrc, vm.createContext(msandbox));
  msandbox.admMenuApply();
  ok('no programme tile is offered before sign-in', mnav.innerHTML.indexOf('data-section="free2027"') < 0);
  msandbox.admMe = { id: 'GOC-A-001', roleKey: 'founder' };
  msandbox.admMenuApply();
  ok('the tile appears after sign-in without a second mount', mnav.innerHTML.indexOf('data-section="free2027"') > -1);
  msandbox.admMenuApply();
  ok('repainting the menu does not duplicate the tile', mnav.innerHTML.split('data-section="free2027"').length === 2);
  msandbox.admOpen('free2027'); await tick();
  ok('the open hook renders the existing console panel', msheet.innerHTML.indexOf('f27AdmTabs') > -1 && opened.length === 0);
  msandbox.admMe = { id: 'GOC-S-001', roleKey: 'student' };
  msandbox.admMenuApply(); msandbox.admOpen('free2027');
  ok('a student role gets neither the tile nor the panel', mnav.innerHTML.indexOf('data-section="free2027"') < 0 && opened.length === 0);

  console.log('\nBoth existing panels use the same accessible entry form');
  sheet.innerHTML = sandbox.GOC.freeAdmin.panel();
  sandbox.GOC.freeAdmin.tab('banks'); await tick();
  ok('both independent bank panels are present', !!$('f27Bank-weekly') && !!$('f27Bank-competition'));
  ['weekly', 'competition'].forEach(function (b) {
    sandbox.f27BankAdd(b);
    var inputs = $('f27BankEdit-' + b).querySelectorAll('input');
    var options = 'ABCDE'.split('').map(function (l) { return $('f27NQ-' + b + '-option' + l); });
    ok(b + ': five separate text inputs, not an options textarea', options.every(function (e) { return e && e.tagName === 'INPUT' && e.type === 'text'; }) && !$('f27NQ-' + b + '-opts'));
    ok(b + ': A–D required, E optional', options.slice(0, 4).every(function (e) { return e.getAttribute('required') !== null; }) && options[4].getAttribute('required') === null);
    ok(b + ': every option has its own visible label', options.every(function (e, i) {
      var label = $('f27BankEdit-' + b).querySelector('label[for=' + e.id + ']');
      return label && label.textContent.indexOf('Option ' + 'ABCDE'[i]) === 0;
    }));
    ok(b + ': subject choices are the requested five', $('f27NQ-' + b + '-subject').querySelectorAll('option').map(function (e) { return e.value; }).join('|') === subjects.join('|'));
    ok(b + ': the question supports multiline entry', $('f27NQ-' + b + '-text').tagName === 'TEXTAREA' && $('f27NQ-' + b + '-text').getAttribute('rows') === '6');
    ok(b + ': answer choices are letters, not numerical positions', $('f27NQ-' + b + '-answer').querySelectorAll('option').slice(1).map(function (e) { return e.value; }).join('') === 'ABCDE');
    ok(b + ': empty E cannot be selected', $('f27NQ-' + b + '-answer').querySelector('option[value=E]').disabled === true);
    ok(b + ': difficulty and optional explanation remain available', $('f27NQ-' + b + '-difficulty').querySelectorAll('option').map(function (e) { return e.value; }).join(',') === 'easy,medium,hard' && !!$('f27NQ-' + b + '-explanation'));
  });
  ok('control IDs are scoped so the two forms never read each other', $('f27NQ-weekly-optionA') !== $('f27NQ-competition-optionA'));

  console.log('\nLive preview and the zero-based backend adapter');
  fill('weekly', false);
  var preview = $('f27NQ-weekly-preview');
  ok('preview resembles an exam question with lettered options', /Question 1/.test(preview.textContent) && /A\./.test(preview.textContent) && /B\./.test(preview.textContent) && /Mean/.test(preview.textContent));
  ok('preview shows Correct Answer: B', /Correct Answer: B/.test(preview.textContent));
  ok('empty E is omitted from the preview', preview.querySelectorAll('li').length === 4);
  field('weekly', 'optionE', 'Skewness'); input('weekly');
  ok('entering E immediately enables it', $('f27NQ-weekly-answer').querySelector('option[value=E]').disabled === false);
  field('weekly', 'answer', 'E'); input('weekly');
  ok('preview follows the selected letter', /Correct Answer: E/.test(preview.textContent));
  field('weekly', 'optionE', '   '); input('weekly');
  ok('clearing E disables and clears its selected answer', $('f27NQ-weekly-answer').querySelector('option[value=E]').disabled === true && $('f27NQ-weekly-answer').value === '');
  field('weekly', 'answer', 'B');
  field('weekly', 'text', 'Line one\n<script>alert("x")</script>'); input('weekly');
  ok('preview escapes entered markup', preview.querySelectorAll('script').length === 0 && /<script>/.test(preview.textContent));
  fill('weekly', false);
  sandbox.f27BankSave('weekly'); await tick();
  var created = calls.filter(function (c) { return c[0] === 'save'; }).slice(-1)[0];
  ok('weekly form submitted successfully', !!created, messages.slice(-1)[0]);
  ok('weekly create uses the existing weekly endpoint adapter', created[1] === 'weekly' && created[2] === null);
  ok('B is stored as zero-based index 1', created[3].answer === 1 && banks.weekly[0].answer === 1);
  ok('blank E is not persisted as a fifth option', created[3].options.length === 4 && banks.weekly[0].options.length === 4);
  ok('multiline text, explanation and active flag are preserved', banks.weekly[0].text.indexOf('\n') > -1 && banks.weekly[0].explanation.indexOf('arithmetic') > -1 && banks.weekly[0].active === true);
  fill('competition', true); sandbox.f27BankSave('competition'); await tick();
  ok('competition creation stays in its independent bank', banks.competition.length === 1 && banks.competition[0].id === 'CQ-001' && banks.competition[0].answer === 1 && banks.weekly.length === 1);
  ok('a filled fifth option is preserved', banks.competition[0].options.length === 5);

  console.log('\nValidation and editing retain the draft and question identity');
  sandbox.f27BankAdd('weekly'); fill('weekly', false); field('weekly', 'optionD', ''); input('weekly');
  var n = calls.length; sandbox.f27BankSave('weekly'); await tick();
  ok('missing D is refused beside the form, with no API call', calls.length === n && /Option D is required/.test($('f27NQ-weekly-message').textContent));
  fill('weekly', false); sandbox.f27BankCancelEdit('weekly'); sandbox.f27BankAdd('weekly', 'WQ-001');
  ok('editing restores the letter from the stored index', $('f27NQ-weekly-answer').value === 'B' && $('f27NQ-weekly-optionB').value === 'Mean');
  field('weekly', 'answer', 'C'); field('weekly', 'topic', 'Averages'); input('weekly');
  sandbox.f27BankSave('weekly', 'WQ-001'); await tick();
  ok('editing uses the same bank and ID and stores C as 2', calls.slice(-1)[0][2] === 'WQ-001' && banks.weekly[0].id === 'WQ-001' && banks.weekly[0].answer === 2 && banks.weekly[0].topic === 'Averages');
  sandbox.f27BankAdd('competition'); fill('competition', false); saveError = 'Server validation retained the draft.';
  sandbox.f27BankSave('competition'); await tick(); saveError = null;
  ok('a failed save keeps the fields and preview and explains the failure', !!$('f27NQ-competition-optionB') && /retained the draft/.test($('f27NQ-competition-message').textContent) && /Correct Answer: B/.test($('f27NQ-competition-preview').textContent));
  ok('the save button is usable again after failure', $('f27NQ-competition-save').disabled === false);

  console.log('\nCSV instructions and a real, parseable downloadable template');
  ['weekly', 'competition'].forEach(function (b) {
    var guide = $('f27Bank-' + b).querySelector('.f27-csv-guide');
    ok(b + ': exact visible guidance heading', guide.children.filter(function (c) { return c.tagName === 'H3'; })[0].textContent === 'CSV IMPORT FORMAT & INSTRUCTIONS');
    ok(b + ': exact required header', guide.querySelector('code.ad-cols').textContent === rules.CSV_HEADER);
    ok(b + ': every one of the 14 columns is explained', guide.querySelectorAll('dt').length === 14);
    ok(b + ': row cap, mixed subjects, answer formats and destination are explicit', /500 question rows/.test(guide.textContent) && /all five subjects/.test(guide.textContent) && /A–E/.test(guide.textContent) && guide.textContent.indexOf(b === 'weekly' ? 'Destination: Weekly Assessment Question Bank' : 'Destination: Competition Question Bank') > -1);
    var example = guide.querySelectorAll('code')[1].textContent;
    var parsed = parseFreeCsv(rules.CSV_HEADER + '\n' + example, [], {});
    ok(b + ': displayed example is valid and selects B', !parsed.error && parsed.records.length === 1 && parsed.records[0].answer === 1 && parsed.errors.length === 0);
    sandbox.f27BankDownloadTemplate(b);
    var blob = downloads.slice(-1)[0], csv = blob.parts.join('').replace(/^\uFEFF/, '');
    var template = parseFreeCsv(csv, [], {});
    ok(b + ': download button produces a CSV file with the exact header', blob.type.indexOf('text/csv') === 0 && csv.split('\r\n')[0] === rules.CSV_HEADER);
    ok(b + ': downloaded template imports cleanly', !template.error && template.records.length === 1 && template.errors.length === 0 && template.records[0].answer === 1);
  });

  console.log('\nCSV preview, report and destination remain bank-local');
  var header = rules.CSV_HEADER;
  var csv = header + '\nPhysics,Motion,A shared physics question,One,Two,Three,Four,,B,easy,Two,TRUE,,\n';
  sandbox.f27BankCsvPicked('weekly', { files: [{ name: 'mixed.csv', csv: csv }] }); await tick();
  ok('weekly preview is shown before saving', /Import preview/.test($('f27CsvBox-weekly').textContent) && /destination: Weekly Assessment Question Bank/.test($('f27CsvBox-weekly').textContent) && banks.weekly.length === 1);
  sandbox.f27BankImportGo('weekly'); await tick();
  ok('weekly import reports success and keeps the report on screen', /Import complete/.test($('f27CsvBox-weekly').textContent) && /1 imported/.test($('f27CsvBox-weekly').textContent) && banks.weekly.length === 2);
  sandbox.f27BankCsvPicked('competition', { files: [{ name: 'mixed.csv', csv: csv }] }); await tick();
  sandbox.f27BankImportGo('competition'); await tick();
  ok('the same file can import independently into competition', banks.competition.some(function (q) { return q.text === 'A shared physics question'; }) && banks.weekly.filter(function (q) { return q.text === 'A shared physics question'; }).length === 1);
  ok('refreshing counts does not erase either import report', /Import complete/.test($('f27CsvBox-weekly').textContent) && /Import complete/.test($('f27CsvBox-competition').textContent));
  sandbox.f27BankCsvPicked('weekly', { files: [{ name: 'mixed.csv', csv: csv }] }); await tick();
  ok('duplicate preview reports the line without importing again', /Line 2/.test($('f27CsvBox-weekly').textContent) && /duplicate/.test($('f27CsvBox-weekly').textContent) && banks.weekly.length === 2);
  sandbox.f27BankCsvPicked('weekly', { files: [{ name: 'bad.csv', csv: header + '\nPhysics,Motion,A bad answer row,One,Two,Three,Four,,Z,easy,,TRUE,,\n' }] }); await tick();
  ok('row-level validation errors survive in the preview', /Line 2/.test($('f27CsvBox-weekly').textContent) && /answer must be a letter from A to E/.test($('f27CsvBox-weekly').textContent));

  console.log('\nMobile containment rules');
  var css = fs.readFileSync(path.join(APP, 'css/free2027.css'), 'utf8');
  ok('form controls are full width and use mobile-safe 16px text', /\.f27-question-field input[\s\S]*?width: 100%[\s\S]*?font-size: 16px/.test(css));
  ok('long text wraps and the sheet remains the vertical scroller', /overflow-wrap: anywhere/.test(css) && /overscroll-behavior-y: contain/.test(css));
  ok('mobile actions have accessible target sizes', /\.f27-question-actions \.ad-btn[\s\S]*?min-height: 48px/.test(css));
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
