/* test-import-preview.js — Phase 3E.C slice 2: the import Preview. Questions are read with the
   import's own rules and shown (options in file order, the right one ticked, the explanation
   beside it, doubtful rows flagged) with nothing saved.   node test/test-import-preview.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8'), sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
var fails = 0;
function ok(name, c, extra) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }
function grab(name) {
  var i = app.indexOf('function ' + name + '('); if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
}
ok('the cache was bumped past v141', /CACHE = 'goc-v(\d+)'/.test(sw) && Number(RegExp.$1) >= 142);

var HEAD = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active\n';
function row(opts, ans, text, expl) { return 'Mathematics,objective,Algebra,"' + text + ' Which option is right?",' + opts.join(',') + ',' + ans + ',,,medium,' + (expl === undefined ? '"Because."' : expl) + ',yes\n'; }
function prev(csv, target, existing) { return core.importCSV('questions', HEAD + csv, target || null, existing || [], [], { preview: true }); }

console.log('\nThe rows');
var p = prev(row(['red', 'green', 'blue', 'amber', ''], 'C', 'Colour one.', '"Blue is the third."'));
var q = p.preview[0];
ok('a good row is previewed with its line number', p.preview.length === 1 && q.line === 2);
ok('options are in file order and the answer points at the right one', q.options.join('|') === 'red|green|blue|amber' && q.options[q.answer] === 'blue');
ok('the explanation travels with the row', q.explanation === 'Blue is the third.');
ok('a clean row has no flags', q.flags.length === 0, JSON.stringify(q.flags));
ok('nothing is flagged as saved: records are still produced for the real import to use', p.records.length === 1);

var g = prev(row(['red', '', 'blue', 'amber', ''], 'C', 'Gap one.')).preview[0];
ok('a blank cell between options is flagged', g.flags.some(function (f) { return /empty between/.test(f); }));
ok('...and the answer still points at "blue"', g.options[g.answer] === 'blue');
var t = prev(row(['Paris', 'Rome', 'Oslo', 'Bern', ''], 'oslo', 'Text one.')).preview[0];
ok('an answer written as text is flagged and says which option it became', t.flags.some(function (f) { return /not a letter/.test(f) && /option C/.test(f); }), JSON.stringify(t.flags));
var ne = prev(row(['red', 'green', 'blue', 'amber', ''], 'B', 'No note.', '')).preview[0];
ok('a missing explanation is flagged', ne.flags.indexOf('No explanation.') > -1);
var lower = prev(row(['red', 'green', 'blue', 'amber', ''], 'b', 'Lower one.')).preview[0];
ok('a lowercase letter is not flagged', lower.flags.length === 0);

console.log('\nRefusals and rules');
var bad = prev(row(['2', '4', '6', '8', ''], '4', 'Clash one.') + row(['red', 'green', 'blue', 'amber', ''], 'A', 'Fine one.'));
ok('a row the import would refuse is listed as an error, not previewed', bad.preview.length === 1 && bad.errors.length === 1 && /could mean/.test(bad.errors[0].error));
ok('the refusal reads cleanly (no doubled full stop)', !/\.\s+—/.test(bad.errors[0].error), bad.errors[0].error);
var d = prev(row(['red', 'green', 'blue', 'amber', ''], 'A', 'Same one.') + row(['red', 'green', 'blue', 'amber', ''], 'A', 'Same one.'));
ok('a repeat inside the file is shown as refused, as the import would', d.preview.length === 1 && /duplicate/i.test(d.errors[0].error));
var wrongSubj = prev(row(['red', 'green', 'blue', 'amber', ''], 'A', 'Subject one.'), { subject: 'Physics', section: '', stampSection: false });
ok('the chosen subject restricts the preview like it restricts the import', wrongSubj.preview.length === 0 && wrongSubj.errors.length === 1);
var th = prev('Physics,theory,Motion,"State the law of motion.",,,,,,"Force equals mass times acceleration",,10,medium,"Why.",yes\n');
ok('a theory row previews without option flags', th.preview.length === 1 && th.preview[0].options.length === 0 && th.preview[0].flags.length === 0);
var pass = core.importCSV('questions', HEAD + 'Use of English,objective,Comprehension,"What is the passage about, according to it?",a,b,c,d,,A,,,medium,"Because.",yes\n'.replace(',yes\n', ',yes\n'), null, [], [], { preview: true });
ok('preview works with no passages supplied', pass.preview.length === 1);
var plain = core.importCSV('questions', HEAD + row(['red', 'green', 'blue', 'amber', ''], 'A', 'Plain one.'), null, [], []);
ok('the ordinary import result has no preview key', plain.preview === undefined && plain.records.length === 1);

console.log('\nThe screen');
var els = { admImCsv: { value: '' }, admImOut: { innerHTML: '' } }, toasts = [];
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  toast: function (m) { toasts.push(m); }, wtSectionLabel: function (s) { return s; },
  admImKind: 'questions', admImSubject: '', admImSection: '', admImStamp: false, admImReplace: false,
  GOC: { api: { rules: core } }, String: String
};
var ctx = vm.createContext(sandbox);
['admImPreview', 'admImPaintPreview'].forEach(function (n) { vm.runInContext(grab(n), ctx); });
vm.runInContext('var ADM_IM_PREVIEW_MAX = 50;', ctx);
var run = function (c) { return vm.runInContext(c, ctx); };
run('admImPreview()');
ok('an empty box asks for a file and paints nothing', toasts.length === 1 && els.admImOut.innerHTML === '');
els.admImCsv.value = HEAD + row(['red', 'green', 'blue', 'amber', ''], 'C', 'Screen one.', '"Blue is the third."') + row(['2', '4', '6', '8', ''], '4', 'Screen clash.');
run('admImPreview()');
var h = els.admImOut.innerHTML;
ok('it says nothing has been saved', /Nothing has been saved/.test(h));
ok('it counts what would be published and refused', /Would be published<\/span><b>1</.test(h) && /Would be refused<\/span><b>1</.test(h));
ok('the right option is ticked and the others are not', /C &#10003;<\/span><b><u>blue/.test(h) && !/A &#10003;/.test(h));
ok('the explanation sits beside the question', h.indexOf('Blue is the third.') > h.indexOf('Screen one.'));
ok('the refused line is named', /Line 3/.test(h) && /could mean/.test(h));
els.admImCsv.value = HEAD + row(['<b>x</b>', 'green', 'blue', 'amber', ''], 'B', 'Tags <i>here</i>.', '"<script>1</script>"');
run('admImPreview()');
ok('everything typed by an author is written escaped', !/<script>|<b>x|<i>here/.test(els.admImOut.innerHTML) && /&lt;script&gt;/.test(els.admImOut.innerHTML));
var many = ''; for (var i = 0; i < 60; i++) many += row(['red', 'green', 'blue', 'amber', ''], 'A', 'Many number ' + i + '.');
els.admImCsv.value = HEAD + many; run('admImPreview()');
ok('a long file shows the first 50 and says so', /Showing the first 50 of 60/.test(els.admImOut.innerHTML));
run('admImKind = "notes"'); toasts.length = 0; run('admImPreview()');
ok('notes get a plain message, not a preview', toasts.length === 1 && /notes/.test(toasts[0]));
run('admImKind = "questions"; admImSubject = "Physics"'); els.admImCsv.value = HEAD + row(['red', 'green', 'blue', 'amber', ''], 'A', 'Target one.'); run('admImPreview()');
ok('the screen\'s subject choice applies to the preview', /Would be published<\/span><b>0</.test(els.admImOut.innerHTML));
ok('the Import screen has a Preview button next to Import', /id=\\"admImPrevBtn\\" onclick=\\"admImPreview\(\)\\">Preview/.test(app) || /admImPrevBtn/.test(app));

console.log(fails ? '\n' + fails + ' FAILED' : '\nimport preview: all passed');
process.exit(fails ? 1 : 0);
