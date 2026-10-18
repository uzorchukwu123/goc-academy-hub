/* test-tutor-notes-rules.js — Phase 3C slice 6.5: the pure rules for a tutor's notes.
   node test/test-tutor-notes-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var chem = { id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Chemistry'], active: true };
var phys = { id: 'GOC-T-002', name: 'Eze', subjects: ['Physics'], active: true };
var rec = core.validateNote({ subject: 'Chemistry', topic: 'Acids', title: 'Strong acids', body: 'Acids donate hydrogen ions in water, and strong ones do so completely.' }).rec;
var NOW = Date.UTC(2026, 9, 8, 10, 0, 0);

console.log('\nstamping');
var st = core.stampTutorNote(rec, chem, NOW);
ok('a tutor note is stamped with author, name and time and stays live', st.rec.addedBy === 'GOC-T-001' && st.rec.addedByName === 'Ada Obi' && st.rec.addedAt === '2026-10-08T10:00:00.000Z' && st.rec.active === true);
ok('the input is not changed', rec.addedBy === undefined);
ok('a forged edit time is dropped', core.stampTutorNote(Object.assign({}, rec, { editedAt: 'x' }), chem, NOW).rec.editedAt === undefined);
ok('a tutor cannot stamp a note for a subject they do not teach', /do not teach Chemistry/.test(core.stampTutorNote(rec, phys, NOW).error));
ok('a switched-off tutor cannot', !!core.stampTutorNote(rec, Object.assign({}, chem, { active: false }), NOW).error);
ok('nothing to save is an error', !!core.stampTutorNote(null, chem, NOW).error);

console.log('\nownership');
var mine = Object.assign({}, st.rec, { id: 5 }), adminNote = Object.assign({}, rec, { id: 6 });
ok('a tutor owns their own note', core.tutorOwnsNote(chem, mine));
ok('not another tutor\'s', !core.tutorOwnsNote(phys, mine));
ok('not an admin note (no author)', !core.tutorOwnsNote(chem, adminNote));
ok('not after their subject is taken away', !core.tutorOwnsNote({ id: 'GOC-T-001', name: 'A', subjects: ['Physics'], active: true }, mine));
ok('not when switched off', !core.tutorOwnsNote(Object.assign({}, chem, { active: false }), mine));

console.log('\nediting');
var ch = core.validateNote({ subject: 'Chemistry', topic: 'Acids', title: 'Strong acids, revised', body: 'Acids donate hydrogen ions in water, and strong ones do so completely. Revised.' }).rec;
var ed = core.tutorEditNote(chem, mine, Object.assign({ addedBy: 'GOC-T-099', addedAt: 'forged' }, ch), NOW + 60000);
ok('an edit keeps the id, author and first-added time and adds an edit time', ed.rec.id === 5 && ed.rec.addedBy === 'GOC-T-001' && ed.rec.addedAt === mine.addedAt && ed.rec.editedAt === '2026-10-08T10:01:00.000Z' && ed.rec.title === 'Strong acids, revised', JSON.stringify(ed));
ok('another tutor cannot edit it', !!core.tutorEditNote(phys, mine, ch, NOW).error);
ok('nobody edits an admin note this way', !!core.tutorEditNote(chem, adminNote, ch, NOW).error);
ok('a move to a subject they do not teach is refused', /do not teach Physics/.test(core.tutorEditNote(chem, mine, Object.assign({}, ch, { subject: 'Physics' }), NOW).error));

console.log('\nlists and what a student is sent');
var list = [mine, adminNote, Object.assign({}, mine, { id: 7, addedAt: '2026-10-09T00:00:00.000Z' }), Object.assign({}, mine, { id: 8, addedBy: 'GOC-T-002' })];
ok('a tutor\'s list is only their own, newest first', core.tutorNotes(list, chem).map(function (n) { return n.id; }).join() === '7,5');
var pub = core.publicNote(mine);
ok('a student\'s copy has no author, name or times', pub.addedBy === undefined && pub.addedByName === undefined && pub.addedAt === undefined && pub.editedAt === undefined && pub.title === mine.title && pub.body === mine.body);
ok('the original keeps its stamp', mine.addedBy === 'GOC-T-001');
var kept = core.keepNoteStamp(mine, Object.assign({}, ch, { id: 5 }));
ok('a console edit gets the stamp back', kept.addedBy === 'GOC-T-001' && kept.addedAt === mine.addedAt);
ok('a console edit of an admin note adds no stamp', core.keepNoteStamp(adminNote, ch).addedBy === undefined);

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
