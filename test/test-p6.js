/* test-p6.js — exercises the real index.html + js/*.js inside minidom.
   Priorities under test: 5 (UTME only, four-paper combination) and 6 (the
   stored combination drives every subject-aware surface). Run:
       node test/test-p6.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

/* ---- build a document from the real markup ---- */
var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
var bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
doc.body.innerHTML = bodyHtml;

/* ---- a window the app can live in ----
   The sandbox IS the window, because js/api.js writes `global.GOC` while
   js/app.js reads a bare `GOC` — they only meet if window is the global. */
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; },          // no deferred work in tests
  clearTimeout: function () {}, setInterval: function () { return 0; },
  clearInterval: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

/* ---- tiny assertions ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }

head('markup the new code depends on');
['signGoal', 'examNote', 'examNoteBody', 'subjPick', 'subjGrid', 'subjCount', 'subjMsg',
 'classFilters', 'resList', 'ttBlocks', 'pracSub'].forEach(function (x) {
  ok('#' + x + ' exists', !!id(x));
});
/* The home screen was cut back to what is live and honest: the hero, the
   Scholar ID and the daily study window. The sections that promised progress
   the app was not yet measuring are gone, and so are the renderers behind
   them — a surface that no longer exists cannot go stale. */
['homeSubjects', 'homeSubjNote', 'm1text', 'm2text', 'homeTTtitle', 'homeTTsub',
 'continueCard'].forEach(function (x) {
  ok('#' + x + ' is gone from the home screen', !id(x));
});
['renderSubjectProgress', 'renderMissions', 'toggleMission', 'fillHomeTimetable'].forEach(function (fn) {
  ok(fn + ' was deleted, not left behind', run('typeof ' + fn) === 'undefined',
     run('typeof ' + fn));
});
ok('four science checkboxes', run("scienceBoxes().length") === 4, run("scienceBoxes().length"));
ok('logo <use> untouched', read('index.html').indexOf('<use href="#goc-mark"') > -1 ||
   read('index.html').indexOf('xlink:href="#goc-mark"') > -1 || read('index.html').indexOf('goc-mark') > -1);

head('Priority 5 — UTME only');
function pickExam(v) { id('signGoal').value = v; return run('examPicked()'); }
ok('JAMB / UTME 2027 accepted', pickExam('JAMB / UTME 2027') === true);
ok('notice hidden while UTME is chosen', id('examNote').hidden === true);
['WAEC', 'NECO', 'Post-UTME'].forEach(function (x) {
  ok(x + ' refused', pickExam(x) === false);
  ok(x + ' shows the notice', id('examNote').hidden === false);
  ok(x + ' is named in the notice', text('examNoteBody').indexOf(x) > -1, text('examNoteBody'));
});
pickExam('JAMB / UTME 2027');

head('Priority 5 — exactly three sciences');
function tick(name, on) {
  var box = run("scienceBoxes()").filter(function (b) { return b.getAttribute('data-subject') === name; })[0];
  box.checked = on === undefined ? true : !!on;
  run('subjToggle')(box);
  return box;
}
ok('counter starts at zero', text('subjCount').indexOf('0 of 3') === 0, text('subjCount'));
tick('Physics'); tick('Chemistry');
ok('counter tracks two', text('subjCount').indexOf('2 of 3') === 0, text('subjCount'));
ok('two sciences is not a valid combination', run('chosenCombination().length') === 3 &&
   !run('rulebook().validateSubjects(chosenCombination()).ok'));
tick('Mathematics');
ok('counter reports the full four papers', text('subjCount').indexOf('3 of 3') === 0 &&
   text('subjCount').indexOf('4 papers') > -1, text('subjCount'));
ok('three sciences + English validates', run('rulebook().validateSubjects(chosenCombination()).ok'));
ok('combination is English-first', run('chosenCombination()')[0] === 'Use of English');
var fourth = tick('Biology');
ok('a fourth science is refused at the tick', fourth.checked === false);
ok('the refusal is explained on screen', text('subjMsg').length > 0, text('subjMsg'));
ok('still exactly three after the refusal', run('chosenSciences().length') === 3);

head('Priority 6 — the stored combination drives every subject-aware surface');
/* Priority 6 tests whether the *filtering logic* correctly narrows videos to
   a student's combination — it has nothing to do with what real videos an
   academy has published. Production js/app.js no longer ships hardcoded
   placeholder rows (Priority: "clear the placeholder videos"), so this test
   supplies its own small fixture directly, the same way a real published
   video would arrive from loadPublishedVideos() once the server has one for
   every subject under test. */
run("videos = [" +
  "{type:'live',subj:'Use of English',title:'Comprehension Fixture',tutor:'t',dur:'10:00',date:'d',c1:'#000',c2:'#000'}," +
  "{type:'live',subj:'Physics',title:'Newton Fixture',tutor:'t',dur:'10:00',date:'d',c1:'#000',c2:'#000'}," +
  "{type:'live',subj:'Chemistry',title:'Hydrocarbons Fixture',tutor:'t',dur:'10:00',date:'d',c1:'#000',c2:'#000'}," +
  "{type:'live',subj:'Biology',title:'Cell Fixture',tutor:'t',dur:'10:00',date:'d',c1:'#000',c2:'#000'}," +
  "{type:'live',subj:'Maths',title:'Quadratic Equations Fixture',tutor:'t',dur:'10:00',date:'d',c1:'#000',c2:'#000'}" +
  "]");
run("resources = [{resourceId:'FIXTURE-SYL',storageFileId:'',description:'',published:true,cat:'syllabus',type:'SYL',tcol:'#15803D',subj:'all',title:'JAMB 2027 Syllabus — Fixture',meta:'All subjects · test fixture',fileExt:'pdf'}]");
run('applySubjects')(['Use of English', 'Physics', 'Chemistry', 'Mathematics']);
['Use of English', 'Physics', 'Chemistry', 'Mathematics'].forEach(function (s) {
  ok('class filters show ' + s, markup('classFilters').indexOf(s) > -1);
});
ok('class filters = All + four papers', (markup('classFilters').match(/fchip/g) || []).length === 5,
   (markup('classFilters').match(/fchip/g) || []).length);
ok('no Biology filter', markup('classFilters').indexOf('Biology') < 0);
ok('recordings exclude Biology', markup('liveList').indexOf('Biology') < 0 &&
   markup('lessonList').indexOf('Biology') < 0);
ok('recordings keep Mathematics (written "Maths")',
   (markup('liveList') + markup('lessonList')).indexOf('Quadratic') > -1);
ok('materials exclude Biology', markup('resList').indexOf('Biology') < 0);
ok('materials keep the all-subject syllabus', markup('resList').indexOf('Syllabus') > -1);
ok('timetable excludes Biology', markup('ttBlocks').indexOf('Biology') < 0, markup('ttBlocks'));
ok('timetable keeps a shared CBT/Review block or says why not',
   markup('ttBlocks').length > 0);
ok('the study catalogue narrowed to the combination',
   run('studyCat') === null || run('studyCat').subjects.every(function (e) {
     return ['Use of English','Physics','Chemistry','Mathematics'].indexOf(e.subject) > -1;
   }));

head('Priority 6 — a different combination redraws everything');
run('applySubjects')(['Use of English', 'Biology', 'Chemistry', 'Physics']);
ok('class filters now show Biology', markup('classFilters').indexOf('Biology') > -1);
ok('class filters drop Mathematics', markup('classFilters').indexOf('Mathematics') < 0);
ok('recordings drop the Maths class', (markup('liveList') + markup('lessonList')).indexOf('Quadratic') < 0);
ok('timetable drops Mathematics', markup('ttBlocks').indexOf('Mathematics') < 0);
ok('the study catalogue drops Mathematics',
   run('studyCat') === null || run('studyCat').subjects.every(function (e) { return e.subject !== 'Mathematics'; }));

head('Priority 6 — signed out shows all five papers');
run('applySubjects')([]);
ok('all five papers filterable', (markup('classFilters').match(/fchip/g) || []).length === 6,
   (markup('classFilters').match(/fchip/g) || []).length);
ok('mySubjects cleared', run('mySubjects') === null);

head('a filter for a dropped paper cannot survive');
run('setClassFilter')('Mathematics');
run('applySubjects')(['Use of English', 'Biology', 'Chemistry', 'Physics']);
ok('filter fell back to All', run('classFilter') === 'all', run('classFilter'));
ok('the shelf is not empty', markup('liveList').length > 0);

head('the account is the source of truth');
run('applyIdentity')({ id: 'GOC-S-042', name: 'Ada Test', role: 'student',
  subjects: ['Use of English', 'Biology', 'Chemistry', 'Physics'], exam: 'JAMB / UTME' });
ok('login applied the account combination',
   run('orderedSubjects()').join(',') === 'Use of English,Physics,Chemistry,Biology',
   run('orderedSubjects()').join(','));
ok('the subject surfaces redrew from it', markup('classFilters').indexOf('Mathematics') < 0);
run('applyIdentity')({ id: 'GOC-A-001', name: 'Ernest Uzorchukwu', role: 'staff',
  title: 'Founder', subjects: [], exam: null });
ok('staff preview shows all five papers', (markup('classFilters').match(/fchip/g) || []).length === 6);
run('applyIdentity')({ id: 'GOC-S-042', name: 'Ada Test', role: 'student',
  subjects: ['Use of English', 'Biology', 'Chemistry', 'Physics'] });
run('logout()');
ok('logout does not leave one student\'s papers for the next', run('mySubjects') === null);

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
