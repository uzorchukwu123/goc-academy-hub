/* test-question-images.js — Phase 3, question images, slice 1: the pure rules
   for a picture on a question (its id, its description, and the upload gate).
   node test/test-question-images.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('cleanImageId');
ok('blank, null and undefined mean "no picture"', [undefined, null, '', '  '].every(function (v) { return core.cleanImageId(v).imageId === null && !core.cleanImageId(v).error; }));
ok('an id the upload step issues is kept', core.cleanImageId(' QIMG-a1B2c3D4e5 ').imageId === 'QIMG-a1B2c3D4e5');
['abc', 'QIMG-', 'QIMG-short', 'img-a1B2c3D4e5', 'QIMG-a1B2c3D4/../x', 12345, 'QIMG-' + new Array(50).join('a')].forEach(function (v) {
  ok('"' + String(v).slice(0, 24) + '" is refused with a message', !!core.cleanImageId(v).error);
});

head('cleanImageAlt');
ok('with no picture the description is empty, whatever was sent', core.cleanImageAlt('anything', false).imageAlt === '' && !core.cleanImageAlt('', false).error);
ok('with a picture a real description is kept and tidied', core.cleanImageAlt('  A circuit  with\ntwo   bulbs ', true).imageAlt === 'A circuit with two bulbs');
ok('with a picture a missing description is refused', /Describe/.test(core.cleanImageAlt('', true).error || '') && !!core.cleanImageAlt(null, true).error && !!core.cleanImageAlt('abc', true).error);
ok('an over-long description is refused', /under 300/.test(core.cleanImageAlt(new Array(320).join('a'), true).error || ''));

head('validateImageUpload');
var MB = 1048576;
[['image/png', 'fig.png', 'png'], ['image/jpeg', 'fig.jpg', 'jpg'], ['image/jpeg', 'fig.JPEG', 'jpg'], ['image/gif', 'a.gif', 'gif'], ['image/webp', 'a.webp', 'webp']].forEach(function (c) {
  var r = core.validateImageUpload({ type: c[0], name: c[1], size: 1000 });
  ok(c[0] + ' ' + c[1] + ' is accepted as ' + c[2], r.ok && r.ok.ext === c[2]);
});
ok('SVG is refused (it can carry script)', !!core.validateImageUpload({ type: 'image/svg+xml', name: 'a.svg', size: 500 }).error);
ok('a PDF and a Word file are refused', !!core.validateImageUpload({ type: 'application/pdf', name: 'a.pdf', size: 500 }).error && !!core.validateImageUpload({ type: 'application/msword', name: 'a.doc', size: 500 }).error);
ok('a renamed document is refused', /does not match/.test(core.validateImageUpload({ type: 'image/png', name: 'notes.pdf', size: 500 }).error || ''));
ok('an empty file is refused', !!core.validateImageUpload({ type: 'image/png', name: 'a.png', size: 0 }).error);
ok('exactly the ceiling is accepted, one byte over is refused', !!core.validateImageUpload({ type: 'image/png', name: 'a.png', size: 2 * MB }).ok && /too large/.test(core.validateImageUpload({ type: 'image/png', name: 'a.png', size: 2 * MB + 1 }).error || ''));
ok('nothing at all is refused, not thrown', !!core.validateImageUpload(null).error && !!core.validateImageUpload(undefined).error);
ok('a missing size is refused', !!core.validateImageUpload({ type: 'image/png', name: 'a.png' }).error);
ok('the exposed type table is a copy — changing it cannot open the gate', (function () { core.IMAGE_TYPES['image/svg+xml'] = 'svg'; return !!core.validateImageUpload({ type: 'image/svg+xml', name: 'a.svg', size: 500 }).error; })());

head('validateQuestion carries the picture');
function q(extra) {
  return Object.assign({ subject: 'Physics', section: 'objective', topic: 'Electricity', text: 'What is the total resistance of the circuit shown?',
    options: ['2 ohms', '4 ohms', '6 ohms'], answer: 1 }, extra || {});
}
var plain = core.validateQuestion(q());
ok('a question with no picture stores none', plain.rec && plain.rec.imageId === null && plain.rec.imageAlt === '');
var withPic = core.validateQuestion(q({ imageId: 'QIMG-a1B2c3D4e5', imageAlt: 'Two resistors in series' }));
ok('an objective question keeps its picture and description', withPic.rec && withPic.rec.imageId === 'QIMG-a1B2c3D4e5' && withPic.rec.imageAlt === 'Two resistors in series');
var theory = core.validateQuestion({ subject: 'Physics', section: 'theory', topic: 'Electricity', text: 'Explain what happens in the circuit shown.', expected: 'Current is the same through both resistors in series.', maxMark: 5, imageId: 'QIMG-a1B2c3D4e5', imageAlt: 'Two resistors in series' });
ok('a theory question may carry a picture too', theory.rec && theory.rec.imageId === 'QIMG-a1B2c3D4e5');
ok('a practice question may carry one', core.validateQuestion(q({ section: 'practice', imageId: 'QIMG-a1B2c3D4e5', imageAlt: 'Two resistors in series' })).rec.imageId === 'QIMG-a1B2c3D4e5');
ok('a picture with no description is refused', /Describe/.test(core.validateQuestion(q({ imageId: 'QIMG-a1B2c3D4e5' })).error || ''));
ok('a bad picture id is refused, not dropped', /uploaded through the console/.test(core.validateQuestion(q({ imageId: 'oops', imageAlt: 'Two resistors in series' })).error || ''));
ok('a description with no picture is not stored', core.validateQuestion(q({ imageAlt: 'Two resistors in series' })).rec.imageAlt === '');
ok('clearing the picture on an edit clears its description', (function () { var r = core.validateQuestion(q({ imageId: '', imageAlt: 'stale text here' })).rec; return r.imageId === null && r.imageAlt === ''; })());
ok('the rest of the record is untouched', plain.rec.passageId === null && plain.rec.options.length === 3 && plain.rec.answer === 1);

head('forStudent shows the picture, never anything secret');
var base = { id: 5, subject: 'Physics', topic: 'Electricity', kind: 'objective', text: 'Total resistance?', options: ['2', '4'], answer: 1, explanation: 'Add them.', maxMark: 1 };
var seen = core.forStudent(Object.assign({ imageId: 'QIMG-a1B2c3D4e5', imageAlt: 'Two resistors in series' }, base), 0);
ok('a question with a picture hands the student its id and description', seen.image && seen.image.id === 'QIMG-a1B2c3D4e5' && seen.image.alt === 'Two resistors in series');
ok('a question without one carries no image field', core.forStudent(Object.assign({ imageId: null, imageAlt: '' }, base), 0).image === undefined && core.forStudent(base, 0).image === undefined);
ok('the answer and explanation are still withheld', seen.answer === undefined && seen.explanation === undefined);

console.log(fails ? '\nFAILED: ' + fails : '\nall passed');
process.exit(fails ? 1 : 0);
