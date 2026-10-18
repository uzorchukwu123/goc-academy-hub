/* test-image-form.js — Question images, slice 5: the picture control on the console
   question form (upload, description, preview, remove, save, edit). Runs the real
   functions from js/app.js against stubs.   node test/test-image-form.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), sw = read('sw.js');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) { if (cond) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
}
function tick() { var p = Promise.resolve(); for (var i = 0; i < 8; i++) p = p.then(function () {}); return p; }

ok('the service worker cache was bumped past v89', /CACHE = 'goc-v(\d+)'/.test(sw) && Number(RegExp.$1) >= 90);

var els = {}, toasts = [], uploads = [], saved = [], painted = [], uploadImpl;
function fakeEl(v) { return { value: v == null ? '' : v, innerHTML: '' }; }
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  toast: function (m) { toasts.push(m); }, busy: function () {}, mathPrev: function () { return ''; },
  admSubj: 'Physics', admQBank: 'practice', admQDraft: null, admQPassages: [], admQLoad: function () {},
  admPeek: function (t) { return t; },
  FormData: function () { this.f = {}; this.append = function (k, v) { this.f[k] = v; }; },
  paintQImage: function (id, q) { painted.push([id, q.image.id, q.image.alt]); },
  GOC: { api: {
    rules: { PERIOD: 'test', theoryAllowed: function () { return true; }, noTheoryMessage: function () { return ''; }, normalizePeriod: function (p) { return p; }, validateImageUpload: core.validateImageUpload },
    uploadQuestionImage: function (fd) { uploads.push(fd); return uploadImpl(fd); },
    createQuestion: function (p) { saved.push(['create', p]); return Promise.resolve({ id: 5 }); },
    updateQuestion: function (id, p) { saved.push(['update', id, p]); return Promise.resolve({ id: id }); }
  } },
  Promise: Promise, String: String, Number: Number
};
var ctx = vm.createContext(sandbox);
['admQBlank', 'admQNeeds', 'admQOpts', 'admLetter', 'admQPassageHTML', 'admQImageHTML', 'admQImagePaint', 'admQImageUpload', 'admQImageRemove',
 'admQFormHTML', 'admQRead', 'admQRepaint', 'admQPrevHTML', 'admQPrev', 'admQSave', 'admQEditQ'].forEach(function (n) { vm.runInContext(grab(n), ctx); });
var run = function (code) { return vm.runInContext(code, ctx); };
sandbox.admQCache = [];

console.log('\nThe control');
els.admQForm = fakeEl(''); els.admQImgBox = fakeEl('');
run('admQDraft = admQBlank(); admQRepaint()');
var h = els.admQForm.innerHTML;
ok('with no picture the form offers a file chooser limited to image types', /id="admQFile" type="file" accept="image\/png,image\/jpeg,image\/gif,image\/webp"/.test(h));
ok('it sits after the question text and before the options', h.indexOf('admQText') < h.indexOf('admQFile') && h.indexOf('admQFile') < h.indexOf('admQO0'));
ok('there is no description box until there is a picture', h.indexOf('admQAlt') === -1);
ok('a theory question can carry a picture too', (function () { run("admQDraft.section = 'theory'; admQBank = 'exam'; admQRepaint()"); var t = els.admQForm.innerHTML; run("admQBank = 'practice'; admQDraft.section = 'practice'"); return /admQFile/.test(t); })());

console.log('\nUploading');
var inp = { files: [{ name: 'a.svg', type: 'image/svg+xml', size: 100 }], value: 'x' };
sandbox.__inp = inp;
run('admQImageUpload(__inp)');
ok('a disallowed file is refused on the page, nothing is sent', uploads.length === 0 && /SVG|PNG/i.test(toasts[toasts.length - 1] || '') && inp.value === '');
sandbox.__inp = { files: [{ name: 'big.png', type: 'image/png', size: 3 * 1048576 }], value: 'x' };
run('admQImageUpload(__inp)');
ok('an oversize file is refused on the page', uploads.length === 0 && /too large/.test(toasts[toasts.length - 1] || ''));
uploadImpl = function () { return Promise.resolve({ imageId: 'QIMG-0123456789abcdef', type: 'image/png', bytes: 10 }); };
sandbox.__inp = { files: [{ name: 'c.png', type: 'image/png', size: 5000 }], value: 'x' };
run("admQDraft.text = 'Typed text'; admQImageUpload(__inp)");
await_();
async function await_() {
  await tick();
  ok('a good file is sent in the "file" field', uploads.length === 1 && uploads[0].f.file && uploads[0].f.file.name === 'c.png');
  ok('the draft keeps the id, and the typed text is not lost', run('admQDraft.imageId') === 'QIMG-0123456789abcdef' && run('admQDraft.text') === 'Typed text');
  var f = els.admQForm.innerHTML;
  ok('the form now shows a preview box and a required description box', /id="admQImgBox"/.test(f) && /id="admQAlt"/.test(f) && /Remove picture/.test(f) && f.indexOf('admQFile') === -1);
  ok('the preview is painted from the draft', painted.length && painted[painted.length - 1][0] === 'admQImgBox' && painted[painted.length - 1][1] === 'QIMG-0123456789abcdef');

  console.log('\nSaving');
  els.admQTopic = fakeEl('Electricity'); els.admQText = fakeEl('Total resistance?'); els.admQO0 = fakeEl('2'); els.admQO1 = fakeEl('4'); els.admQAnswer = fakeEl('1'); els.admQAlt = fakeEl('');
  run('admQSave()');
  ok('a picture with no description is stopped with a clear message', saved.length === 0 && /Describe the picture/.test(toasts[toasts.length - 1]));
  els.admQAlt = fakeEl('A circuit with two resistors');
  run('admQSave()');
  await tick();
  var p = saved[0] && saved[0][1];
  ok('the payload carries the id and the description', saved[0] && saved[0][0] === 'create' && p.imageId === 'QIMG-0123456789abcdef' && p.imageAlt === 'A circuit with two resistors', JSON.stringify(saved[0]));
  ok('after saving, the draft is blank again', run('admQDraft.imageId') === '' && run('admQDraft.imageAlt') === '');

  console.log('\nNo picture, remove, edit');
  els.admQAlt = null;
  run('admQSave()');
  await tick();
  var q2 = saved[1][1];
  ok('with no picture the payload sends blanks (so an edit can clear it)', q2.imageId === '' && q2.imageAlt === '');
  run("admQDraft = admQBlank(); admQDraft.imageId = 'QIMG-0123456789abcdef'; admQDraft.imageAlt = 'x'; admQRepaint(); admQImageRemove()");
  ok('Remove picture clears the id and description and brings the chooser back', run('admQDraft.imageId') === '' && run('admQDraft.imageAlt') === '' && /admQFile/.test(els.admQForm.innerHTML));
  sandbox.admQCache = [{ id: 9, section: 'practice', topic: 'T', text: 'Q', options: ['a', 'b'], answer: 0, imageId: 'QIMG-aaaaaaaaaaaaaaaa', imageAlt: 'A graph of speed' }];
  run('admQEditQ(9)');
  ok('editing a question fills in its picture and description', run('admQDraft.imageId') === 'QIMG-aaaaaaaaaaaaaaaa' && /value="A graph of speed"/.test(els.admQForm.innerHTML));
  uploadImpl = function () { return Promise.reject(new Error('The picture could not be saved.')); };
  run('admQDraft = admQBlank(); admQRepaint()');
  sandbox.__inp = { files: [{ name: 'c.png', type: 'image/png', size: 5000 }], value: 'x' };
  run('admQImageUpload(__inp)'); await tick();
  ok("a failed upload shows the server's message and leaves no picture", /could not be saved/.test(toasts[toasts.length - 1]) && run('admQDraft.imageId') === '');
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}
