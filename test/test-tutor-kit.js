/* test-tutor-kit.js — Phase 4.D tutor question-writing kit, slice 1: the kit text and its guard.
   The kit must be built from the SAME columns and difficulty values the importer reads, so it can
   never tell a tutor's AI to produce a format the import box then rejects.
   node test/test-tutor-kit.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

console.log('\nthe kit cannot drift from the importer');
var cols = core.tutorKitColumns();
var fullHeader = core.CSV_QUESTION_HEADER.split(',');
ok('the kit columns are a prefix of the importer header, in the same order', cols.join(',') === fullHeader.slice(0, cols.length).join(','));
ok('the kit columns end at explanation (active/year/passageId are console-set, not asked of the AI)', cols[cols.length - 1] === 'explanation' && cols.indexOf('active') === -1 && cols.indexOf('passageId') === -1);
ok('every kit column is a real importer column', cols.every(function (c) { return fullHeader.indexOf(c) > -1; }));

var kit = core.tutorKitInstructions({ subject: 'Chemistry', topics: 'Acids and bases, Stoichiometry' });
ok('the kit prints the exact importer header line', kit.indexOf(cols.join(',')) > -1);
ok('the kit names the subject', /for Chemistry/.test(kit) && /always Chemistry/.test(kit));
ok('the kit lists exactly the importer difficulty values', (function () {
  var line = kit.split('\n').filter(function (l) { return /^- difficulty:/.test(l); })[0] || '';
  return line === '- difficulty: ' + core.QUESTION_DIFFICULTIES.join(', ');
})(), kit.split('\n').filter(function (l) { return /difficulty:/.test(l); })[0]);
ok('the kit names the sections objective, jamb and theory', /objective/.test(kit) && /jamb/.test(kit) && /theory/.test(kit));
ok('the typed topics are filled in and the AI is told to use only them', /Acids and bases, Stoichiometry/.test(kit) && /Use only these topics/.test(kit));

console.log('\ntopics and the Mathematics theory rule');
var noTopics = core.tutorKitInstructions({ subject: 'Physics' });
ok('with no topics the AI is told to ask first', /ask me for the topic/.test(noTopics) && /\(none given yet\)/.test(noTopics));
ok('Mathematics is told it has no theory paper; Chemistry is not', /no theory paper/.test(core.tutorKitInstructions({ subject: 'Mathematics' })) && !/no theory paper/.test(kit));

console.log('\nthe downloadable template imports cleanly through the real importer');
var tpl = core.tutorKitTemplate();
ok('the template starts with the kit header', tpl.split('\n')[0] === cols.join(','));
var imp = core.importCSV('questions', tpl, null, [], []);
ok('the importer accepts every template row with no errors', !imp.error && imp.records && imp.records.length === 3 && (imp.errors || []).length === 0, JSON.stringify({ e: imp.error, n: imp.records && imp.records.length, errs: imp.errors }).slice(0, 160));
ok('the template exercises all three sections', (function () {
  var secs = imp.records.map(function (r) { return r.section; }).sort().join(',');
  return secs === 'jamb,objective,theory';
})(), imp.records.map(function (r) { return r.section; }).join(','));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
