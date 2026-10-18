/* test-question-images-driver.js — Phase 3, question images, slice 3: the offline
   (demo) driver behind GOC.api behaves like server.js's question-picture routes.
   node test/test-question-images-driver.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var sandbox = {
  console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var A = vm.runInContext('GOC.api', ctx);
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function refused(p) { return p.then(function () { return null; }, function (e) { return e.message || 'refused'; }); }


function Fd(file) { return { get: function (k) { return k === 'file' ? file : null; } }; }
function F(name, type, size) { return { name: name, type: type, size: size }; }
function Q(extra) { return Object.assign({ subject: 'Physics', section: 'practice', kind: 'objective', topic: 'Electricity', text: 'In the circuit shown, what is the total resistance?',
  options: ['2 ohm', '4 ohm', '6 ohm', '8 ohm'], answer: 1, imageAlt: 'A circuit with two resistors in series' }, extra || {}); }

(async function () {
  head('uploading in demo mode');
  ok('a signed-out caller cannot upload', /passcode|log in|Management/i.test(await refused(A.uploadQuestionImage(Fd(F('a.png', 'image/png', 100)))) || ''));
  await A.login('GOC-A-001', 'founder2027');
  ok('a locked console cannot upload', /passcode/i.test(await refused(A.uploadQuestionImage(Fd(F('a.png', 'image/png', 100)))) || ''));
  await A.unlockConsole('2027');
  ok('no file is refused', /choose a picture/i.test(await refused(A.uploadQuestionImage(Fd(null))) || ''));
  ok('an SVG is refused', !!(await refused(A.uploadQuestionImage(Fd(F('a.svg', 'image/svg+xml', 100))))));
  ok('a name that disagrees with the type is refused', /does not match/.test(await refused(A.uploadQuestionImage(Fd(F('a.pdf', 'image/png', 100)))) || ''));
  ok('over 2 MB is refused', /too large/.test(await refused(A.uploadQuestionImage(Fd(F('a.png', 'image/png', 2 * 1048576 + 1)))) || ''));
  var up = await A.uploadQuestionImage(Fd(F('circuit.png', 'image/png', 5000)));
  ok('a good PNG gets a server-style id', /^QIMG-[0-9a-f]{16}$/.test(up.imageId) && up.type === 'image/png' && up.bytes === 5000);

  head('serving and linking');
  var blob = await A.getQuestionImage(up.imageId);
  ok('the picture can be read back', blob && blob.name === 'circuit.png');
  ok('an unknown id is not available', /not available/.test(await refused(A.getQuestionImage('QIMG-ffffffffffffffff')) || ''));
  ok('a question naming a missing picture is refused', /not on the server/.test(await refused(A.createQuestion(Q({ imageId: 'QIMG-ffffffffffffffff' }))) || ''));
  ok('a picture without a description is refused', /Describe/.test(await refused(A.createQuestion(Q({ imageId: up.imageId, imageAlt: '' }))) || ''));
  var q = await A.createQuestion(Q({ imageId: up.imageId }));
  ok('a question with a real picture keeps it', q.imageId === up.imageId && q.imageAlt.length > 5);
  ok('editing to a missing picture is refused', /not on the server/.test(await refused(A.updateQuestion(q.id, { imageId: 'QIMG-eeeeeeeeeeeeeeee' })) || ''));
  var u = await A.updateQuestion(q.id, { imageId: '', imageAlt: '' });
  ok('a picture can be removed from a question', u.imageId === null && u.imageAlt === '');

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})();
