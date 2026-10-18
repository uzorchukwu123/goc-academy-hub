/* test-import-check.js — Phase 3E.C slice 4: "Check what is already in the bank". The rule that lists the newest objective
   questions and flags doubtful ones, and the console card that shows them.   node test/test-import-check.js */
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
ok('the cache was bumped past v143', /CACHE = 'goc-v(\d+)'/.test(sw) && Number(RegExp.$1) >= 144);

function Q(id, subject, opts, ans, expl, extra) { var q = { id: id, subject: subject, section: 'objective', kind: 'objective', topic: 'Algebra', text: 'Question ' + id + '?', options: opts, answer: ans, explanation: expl, active: true }; for (var k in (extra || {})) q[k] = extra[k]; return q; }

console.log('\nThe flags');
var f = core.answerCheckFlags;
ok('a matching answer and explanation is not flagged', f(Q(1, 'Mathematics', ['2', '3', '4', '8'], 2, 'Two doubled is 4.')).length === 0);
var wrong = f(Q(2, 'Mathematics', ['2', '3', '4', '8'], 3, 'Two doubled is 4.'));
ok('an explanation naming another option but not the answer is flagged, naming both letters', wrong.length === 1 && /option C/.test(wrong[0]) && /\(D\)/.test(wrong[0]), JSON.stringify(wrong));
ok('a missing explanation is flagged', f(Q(3, 'Physics', ['a', 'b'], 0, '  ')).join().indexOf('No explanation') === 0);
ok('an answer pointing at no option is flagged', /does not point/.test(f(Q(4, 'Physics', ['a', 'b'], 5, 'x'))[0]) && /does not point/.test(f(Q(5, 'Physics', ['a', 'b'], -1, 'x'))[0]) && /does not point/.test(f(Q(6, 'Physics', ['a', 'b'], null, 'x'))[0]));
var dup = f(Q(7, 'Physics', ['Speed', 'speed ', 'Force'], 0, 'Speed is distance over time.'));
ok('two options worded alike are flagged', dup.length === 1 && /same wording/.test(dup[0]), JSON.stringify(dup));
ok('an explanation that names neither is left alone (nothing to go on)', f(Q(8, 'Biology', ['red', 'green'], 0, 'Because of the way cells divide.')).length === 0);
ok('a whole word is matched, not a piece of one', f(Q(9, 'Biology', ['cell', 'cellulose'], 0, 'Cellulose is a plant sugar.')).length === 1);
ok('flags never change the question', (function () { var q = Q(10, 'Physics', ['2', '4'], 0, 'Four.'); var s = JSON.stringify(q); f(q); return JSON.stringify(q) === s; })());

console.log('\nThe list');
var bank = [Q(1, 'Mathematics', ['2', '3', '4', '8'], 2, 'It is 4.'), Q(2, 'Mathematics', ['2', '3', '4', '8'], 3, 'It is 4.'),
  Q(3, 'Physics', ['a', 'b'], 0, 'a is right.'), Q(4, 'Physics', [], 0, 'x'), { id: 5, subject: 'Physics', section: 'theory', kind: 'theory', text: 't', expected: 'e' },
  Q(6, 'Physics', ['a', 'b'], 0, 'a', { section: 'practice' }), Q(7, 'Physics', ['a', 'b'], 1, 'a is right.', { active: false }), Q(8, 'Physics', ['a', 'b'], 0, 'a', { section: 'jamb' })];
var all = core.answerCheckList(bank, {});
ok('newest first; theory, practice and optionless rows are left out', all.rows.map(function (r) { return r.id; }).join() === '8,7,3,2,1' && all.total === 5, all.rows.map(function (r) { return r.id; }).join());
ok('a switched-off question is still listed, and said to be off', all.rows[1].id === 7 && all.rows[1].active === false);
ok('the answer and options come through as stored', all.rows[3].answer === 3 && all.rows[3].options.join('|') === '2|3|4|8');
ok('it counts what needs a look', all.flagged === 2 && all.checked === 5, all.flagged);
var sub = core.answerCheckList(bank, { subject: 'Mathematics' });
ok('a subject narrows the list and the total', sub.total === 2 && sub.rows.length === 2);
var lim = core.answerCheckList(bank, { limit: 2 });
ok('a limit takes the newest N, and total still says how many exist', lim.rows.length === 2 && lim.total === 5 && lim.checked === 2 && lim.rows[0].id === 8);
var only = core.answerCheckList(bank, { flaggedOnly: true });
ok('flaggedOnly lists just the doubtful ones', only.rows.length === 2 && only.rows.every(function (r) { return r.flags.length; }));
ok('a silly limit is held between 1 and 200 (none given means 20)', core.answerCheckList(bank, { limit: 0 }).checked === 5 && core.answerCheckList(bank, { limit: 9999 }).checked === 5 && core.answerCheckList(bank, { limit: -3 }).checked === 1);
ok('an empty or missing bank is an empty answer, not an error', core.answerCheckList(null, {}).total === 0 && core.answerCheckList([], null).rows.length === 0);
ok('the rule does not change the bank', (function () { var b = [Q(1, 'Mathematics', ['2', '4'], 0, 'Four.')]; var s = JSON.stringify(b); core.answerCheckList(b, {}); return JSON.stringify(b) === s; })());
var opts = core.answerCheckList(bank, {}).rows[4].options; opts.push('zzz');
ok('the rows hold copies of the options', bank[0].options.length === 4);

console.log('\nThe screen');
var els = { admChkSubject: { value: '' }, admChkLimit: { value: '20' }, admChkFlagged: { checked: false }, admChkBtn: {}, admChkOut: { innerHTML: '' } };
var busyLog = [];
var pending;
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  busy: function (b, on) { busyLog.push(on); }, wtSectionLabel: function (s) { return s; },
  GOC: { api: { rules: core, listQuestions: function () { return pending; } } }, String: String
};
var ctx = vm.createContext(sandbox);
['admChkLoad', 'admChkPaint'].forEach(function (n) { vm.runInContext(grab(n), ctx); });
function settle() { return new Promise(function (r) { setTimeout(r, 5); }); }
(async function () {
  var evil = Q(20, 'Mathematics', ['<b>x</b>', '4'], 1, '<script>1</script> four', { text: 'Tags <i>here</i>' });
  pending = Promise.resolve({ questions: [Q(1, 'Mathematics', ['2', '3', '4', '8'], 3, 'Two doubled is 4.'), evil] });
  vm.runInContext('admChkLoad()', ctx); await settle();
  var h = els.admChkOut.innerHTML;
  ok('it lists questions with the answer ticked beside its explanation', /D &#10003;<\/span><b><u>8/.test(h) && /Two doubled is 4\./.test(h));
  ok('a doubtful one carries its flag', /mentions option C but not the marked answer \(D\)/.test(h));
  ok('it counts the bank, the number checked and the number needing a look', /bank<\/span><b>2</.test(h) && /Newest checked<\/span><b>2</.test(h) && /Need a look<\/span><b>1</.test(h));
  ok('everything an author typed is written escaped', !/<script>|<b>x|<i>here/.test(h) && /&lt;script&gt;/.test(h));
  ok('it says how to fix one', /re-import the corrected file/.test(h));
  ok('the button is busy while it reads and free after', busyLog[0] === true && busyLog[busyLog.length - 1] === false);
  els.admChkFlagged.checked = true; vm.runInContext('admChkLoad()', ctx); await settle();
  ok('only-flagged hides the good ones', /Question 1\?/.test(els.admChkOut.innerHTML) && !/Question 20\?/.test(els.admChkOut.innerHTML) && /Need a look<\/span><b>1</.test(els.admChkOut.innerHTML));
  pending = Promise.resolve({ questions: [Q(1, 'Mathematics', ['2', '4'], 1, 'It is 4.')] });
  vm.runInContext('admChkLoad()', ctx); await settle();
  ok('when none need a look it says so', /None of the 1 newest need a look/.test(els.admChkOut.innerHTML));
  els.admChkFlagged.checked = false; els.admChkSubject.value = 'Physics'; vm.runInContext('admChkLoad()', ctx); await settle();
  ok('a subject with no objective questions gets a plain line', /No objective questions in the bank/.test(els.admChkOut.innerHTML));
  pending = Promise.reject(new Error('Console is locked'));
  vm.runInContext('admChkLoad()', ctx); await settle();
  ok('a refusal is shown, not swallowed', /Console is locked/.test(els.admChkOut.innerHTML) && busyLog[busyLog.length - 1] === false);
  ok('the Import screen has the card and its Check button', /Check what is already in the bank/.test(app) && /onclick="admChkLoad\(\)"/.test(app));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nimport check: all passed');
  process.exit(fails ? 1 : 0);
})();
