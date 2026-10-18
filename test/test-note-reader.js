/* test-note-reader.js — remove the "Practise this topic" prompt from the note reader (plan B#4).
   The reader's bottom bar and practiseThisNote are gone; the header arrow still returns to Read / Learn;
   the footers talk about notes only. node test/test-note-reader.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html');
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

/* The #lesson section, isolated, so the checks are about the reader only. */
var lesson = (function () {
  var i = html.indexOf('id="lesson"');
  var end = html.indexOf('</section>', i);
  return i > -1 ? html.slice(i, end) : '';
})();

ok('the note reader no longer offers "Practise this topic"', lesson.indexOf('Practise this topic') === -1 && html.indexOf('Practise this topic') === -1);
ok('the reader has no bottom bar / practiseThisNote button', lesson.indexOf('bottom-bar') === -1 && lesson.indexOf('practiseThisNote') === -1);
ok('the header back arrow still returns to Read / Learn', /aria-label="Back to Read \/ Learn"[\s\S]*onclick="go\('reading'\)"/.test(lesson));

ok('practiseThisNote() is removed from app.js', app.indexOf('function practiseThisNote') === -1 && app.indexOf('practiseThisNote(') === -1);
ok('openStudySet no longer takes a topic argument', /function openStudySet\(mode, subject, past\)\{/.test(app) && app.indexOf('function openStudySet(mode, subject, topic, past)') === -1);
ok('openStudySet no longer has the "Arriving from a note" topic block', app.indexOf('Arriving from a note') === -1);
ok('Past questions still opens practice in past mode (3-arg call)', /openStudySet\('practice', null, true\)/.test(app));

ok('the reading-list footer talks about notes only, not practising', /Notes are written and published by the academy\. If a topic you sit is not here yet, it has not been published\./.test(html) && !/not been published — your practice questions/.test(html));
ok('the empty state talks about notes only', app.indexOf('No notes have been published for your papers yet.') > -1 && app.indexOf('No notes have been published for your papers yet. Your practice questions') === -1);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
