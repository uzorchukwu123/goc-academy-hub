/* test-note-practice.js — Stage 4: Practise This Note (extractive only).

   Proves:
     1. questions are generated only from sentences in the selected note,
        with the correct answer lifted from its source sentence;
     2. every question carries source attribution (note title, page where
        the format has pages, and the exact source sentence);
     3. scanned / empty / too-thin notes produce no questions and an honest
        reason — nothing is invented to fill the paper;
     4. duplicates are removed and the requested count is a cap, not a
        promise;
     5. a generated paper runs through the existing Practice interface as a
        paperId-less local run: locally marked, reviewed, no XP, and never
        submitted to the server banks;
     6. the wiring is owner-scoped (the Stage 3 file route) and contains no
        external AI service.
   Run:  node test/test-note-practice.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var gen = require(path.join(APP, 'js', 'note-questions.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
var mod = fs.readFileSync(path.join(APP, 'js', 'note-questions.js'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var PAGES = [
  { page: 1, text: 'Photosynthesis is the process by which green plants make food using sunlight. Chlorophyll is the green pigment found in chloroplasts of plant cells. The chlorophyll traps sunlight energy for the growing plant. Respiration is the process by which living cells release energy from glucose. Glucose is a simple sugar produced during photosynthesis in green plants. Enzymes are biological catalysts that speed up chemical reactions in living organisms.' },
  { page: 2, text: 'Osmosis is the movement of water molecules from a region of higher water potential to a region of lower water potential. Diffusion is the movement of particles from a region of higher concentration to a region of lower concentration. The mitochondria release energy during respiration inside living cells. Chlorophyll absorbs mainly red and blue light from sunlight.' },
  /* a repeated page (headers/footers, re-exported PDFs) must not double the pool */
  { page: 3, text: 'Osmosis is the movement of water molecules from a region of higher water potential to a region of lower water potential. Diffusion is the movement of particles from a region of higher concentration to a region of lower concentration.' }
];
var ALLTEXT = PAGES.map(function (p) { return p.text; }).join(' ');

head('extractive generation');
var r = gen.generateFromPages(PAGES, { count: 5, difficulty: 'standard', noteId: 'n1', noteTitle: 'Cell Biology', subject: 'Biology', topic: 'Cells' });
ok('questions are built from a readable note', r.questions.length >= 3 && r.questions.length <= 5, r.questions.length);
ok('every question has four options and a valid answer index', r.questions.every(function (q) {
  return q.options.length === 4 && q.answer >= 0 && q.answer < 4;
}));
ok('no question is labelled official or JAMB material', r.questions.every(function (q) {
  return !/official|jamb/i.test(q.text) && q.source === 'my-note';
}), r.questions.map(function (q) { return q.text; }).join(' | '));
ok('questions carry no bank id (a null id belongs to no shared bank)', r.questions.every(function (q) { return q.id === null; }));

head('grounding and attribution');
ok('every question carries its exact source sentence', r.questions.every(function (q) {
  return q.sourceText && ALLTEXT.indexOf(q.sourceText.replace(/\.$/, '')) >= 0;
}));
ok('the correct answer is lifted from the source sentence', r.questions.every(function (q) {
  var correct = q.options[q.answer].replace(/…$/, '').toLowerCase();
  var src = q.sourceText.toLowerCase();
  return src.indexOf(correct) >= 0 || correct.split(' ').slice(0, 5).every(function (w) { return src.indexOf(w) >= 0; });
}), JSON.stringify(r.questions.map(function (q) { return q.options[q.answer]; })));
ok('every explanation quotes the source with note title and page', r.questions.every(function (q) {
  return q.explanation.indexOf('Cell Biology') >= 0 && q.explanation.indexOf('page ' + q.page) >= 0 && q.explanation.indexOf(q.sourceText.replace(/\.$/, '').slice(0, 30)) >= 0;
}));
ok('page attribution matches where the sentence lives', r.questions.every(function (q) {
  var p = PAGES.filter(function (x) { return x.page === q.page; })[0];
  return p && p.text.indexOf(q.sourceText.replace(/\.$/, '')) >= 0;
}));

head('duplicates, count and difficulty');
var stems = r.questions.map(function (q) { return q.text; });
ok('no duplicate questions', new Set(stems).size === stems.length);
var r3 = gen.generateFromPages(PAGES, { count: 3, difficulty: 'easy', noteTitle: 'Cell Biology', topic: 'Cells' });
ok('the requested count caps the paper', r3.questions.length === 3, r3.questions.length);
ok('easy papers lean on direct definitions', r3.questions.filter(function (q) { return /^According to/.test(q.text); }).length >= 2,
  r3.questions.map(function (q) { return q.text.slice(0, 30); }).join(' | '));
var rBig = gen.generateFromPages(PAGES, { count: 20, difficulty: 'challenge', noteTitle: 'Cell Biology', topic: 'Cells' });
ok('asking for more than the note supports returns only what exists', rBig.questions.length < 20 && rBig.questions.length >= 3, rBig.questions.length);
var rAgain = gen.generateFromPages(PAGES, { count: 5, difficulty: 'standard', noteId: 'n1', noteTitle: 'Cell Biology', subject: 'Biology', topic: 'Cells' });
ok('generation is deterministic for the same note', JSON.stringify(rAgain.questions) === JSON.stringify(r.questions));

head('honest failure: scanned, empty and thin notes');
var scanned = gen.generateFromPages([{ page: 1, text: '' }, { page: 2, text: '   ' }, { page: 3, text: '' }], { count: 5, noteTitle: 'Scanned' });
ok('a scanned PDF (no text layer) yields no questions', scanned.questions.length === 0 && scanned.stats.reason === 'no-readable-text', JSON.stringify(scanned.stats));
var empty = gen.generateFromPages([], { count: 5 });
ok('an empty note yields no questions and says why', empty.questions.length === 0 && !!empty.stats.reason);
var thin = gen.generateFromPages([{ page: null, text: 'Cells are small. Plants grow.' }], { count: 5, noteTitle: 'Thin' });
ok('a two-line note yields no questions rather than invented ones', thin.questions.length === 0 && !!thin.stats.reason, JSON.stringify(thin.stats));
var txt = gen.generateFromPages([{ page: null, text: PAGES[0].text + ' ' + PAGES[1].text }], { count: 4, noteTitle: 'Plain text note' });
ok('text notes practise too, without page claims', txt.questions.length >= 3 && txt.questions.every(function (q) { return q.page === null && !/page \d/.test(q.explanation); }));

head('the generated paper runs in the existing Practice interface');
function fakeEl() {
  var classes = {};
  var el = { children: [], textContent: '', disabled: false, _html: '', attrs: {} };
  el.classList = { add: function (c) { classes[c] = true; }, contains: function (c) { return !!classes[c]; } };
  Object.defineProperty(el, 'className', {
    get: function () { return Object.keys(classes).join(' '); },
    set: function (v) { classes = {}; String(v).split(/\s+/).forEach(function (c) { if (c) classes[c] = true; }); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = v; if (v === '') el.children = []; }
  });
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.setAttribute = function (k, v) { el.attrs[k] = v; };
  el.querySelectorAll = function (sel) {
    return sel === '.opt' ? el.children.filter(function (c) { return c.classList.contains('opt'); }) : [];
  };
  return el;
}
var els = {};
['pracSub', 'pracNum', 'pracQ', 'pracOpts', 'pracFb', 'pracProg', 'pracPalette', 'pracNavCount', 'pracPrevBtn', 'pracBtn']
  .forEach(function (id) { els[id] = fakeEl(); });
var shown = [], submitted = 0;
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; }, createElement: function () { return fakeEl(); } },
  OPT_KEYS: ['A', 'B', 'C', 'D'],
  mth: function (s) { return String(s == null ? '' : s); }, esc: function (s) { return String(s == null ? '' : s); },
  paintPassage: function () {}, paintQImage: function () {},
  bmButton: function () { return ''; }, askTutorButton: function () { return ''; },
  go: function () {}, toast: function () {}, refreshMe: function () {},
  srShow: function (res) { shown.push(res); },
  GOC: { api: { rules: { topicBreakdown: function () { return []; } },
                submitStudy: function () { submitted++; return Promise.resolve({}); } } },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var pracPaper = null, pracI = 0, pracAnswered = false, pracMarks = [];\n'
  + grab('pracQ') + '\n' + grab('pracAnsweredCount') + '\n' + grab('pracAllAnswered') + '\n'
  + grab('pracFirstUnanswered') + '\n' + grab('pracFbHtml') + '\n' + grab('pracPaintChrome') + '\n'
  + grab('pracGo') + '\n' + grab('pracPrev') + '\n' + grab('renderPrac') + '\n'
  + grab('answerPrac') + '\n' + grab('pracNext') + '\n' + grab('pracFinish') + '\n'
  + grab('pracLocalResult') + '\n' + grab('pracTopicBands'), ctx);

sandbox.pracPaper = { paperId: null, source: 'my-note', noteId: 'n1', noteTitle: 'Cell Biology', subject: 'Biology', questions: r.questions };
sandbox.pracI = 0; sandbox.pracMarks = [];
sandbox.renderPrac();
ok('the practice screen renders a generated question', /Question 1 of/.test(els.pracNum.textContent) && els.pracOpts.children.length === 4);
var first = sandbox.pracPaper.questions[0];
sandbox.answerPrac(first.answer, els.pracOpts.querySelectorAll('.opt')[first.answer]);
ok('feedback shows the source attribution at once', els.pracFb.innerHTML.indexOf('Cell Biology') >= 0 && els.pracFb.innerHTML.indexOf('page ' + first.page) >= 0, els.pracFb.innerHTML.slice(0, 160));
ok('the mark keeps its source sentence and page for review', sandbox.pracMarks[0].sourceText === first.sourceText && sandbox.pracMarks[0].page === first.page);
for (var qi = 1; qi < sandbox.pracPaper.questions.length; qi++) {
  sandbox.pracGo(qi);
  var q = sandbox.pracPaper.questions[qi];
  sandbox.answerPrac(q.answer, els.pracOpts.querySelectorAll('.opt')[q.answer]);
}
sandbox.pracFinish();
ok('finishing shows the local review', shown.length === 1 && shown[0].total === r.questions.length && shown[0].correct === r.questions.length, JSON.stringify(shown[0] && shown[0].total));
ok('the review is unassessed, earns no XP and knows its note', shown[0].assessed === false && shown[0].xpAwarded === 0 && shown[0].source === 'my-note' && shown[0].noteTitle === 'Cell Biology');
ok('nothing was submitted to any server bank', submitted === 0);
ok('review rows still carry the attribution', shown[0].review.every(function (m) { return /Cell Biology/.test(m.explanation) && !!m.sourceText; }));

head('wiring and isolation');
ok('My Notes rows offer Practise this note', app.indexOf('onclick="notePracticeOpen(') >= 0 && /Practise this note/.test(app));
ok('the module loads before app.js and is precached', index.indexOf('<script src="js/note-questions.js"></script>') >= 0 && index.indexOf('<script src="js/note-questions.js"></script>') < index.indexOf('<script src="js/app.js"></script>') && sw.indexOf("'./js/note-questions.js'") >= 0);
ok('extraction reads PDF text with PDF.js getTextContent', /getTextContent\(\)/.test(app) && /GOCNoteQuestions\.generateFromPages/.test(app));
ok('the note file still comes through the owner-checked Stage 3 route', /notePracticeGenerate[\s\S]{0,600}getMyNoteFile\(n\.noteId\)/.test(app));
ok('generated papers are paperId-less local runs', /paperId: null, source: 'my-note'/.test(app));
var stage4 = app.slice(app.indexOf('PRACTISE THIS NOTE (Stage 4)'));
stage4 = stage4.slice(0, stage4.indexOf('function setResFilter'));
ok('Stage 4 code never starts or submits an official run', !/startStudy|submitStudy|startTest/.test(stage4));
ok('no external AI service anywhere in Stage 4', !/openai|anthropic|generativeai|api\.|\.ai\/|fetch\(/.test(mod) && !/openai|anthropic|generativeai/.test(stage4));
ok('scanned PDFs get the honest explanation', /scanned pictures of pages/.test(app) && /no readable text layer/.test(app));
ok('students are told these are not official JAMB questions', /not official JAMB questions/.test(app));
ok('count and difficulty controls exist', /notePracCount/.test(app) && /notePracDiff/.test(app));

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'note practice: all checks passed'));
process.exit(fails ? 1 : 0);
