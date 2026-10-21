/* test-question-images-ui.js — Question images, slice 4 (student screens):
   the picture is shown above its question on the practice, CBT and Web Test
   screens. Checks markup and wiring, then runs the real paintQImage.
   node test/test-question-images-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js'), css = read('css/styles.css');
var fails = 0;
function ok(name, cond, extra) { if (cond) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }

console.log('\nMarkup: a hidden picture box sits between passage and question text');
[['pracPassage', 'pracImage', 'pracQ'], ['cbtPassage', 'cbtImage', 'cbtQ'], ['wtPassage', 'wtImage', 'wtQ']].forEach(function (p) {
  var a = html.indexOf('id="' + p[0] + '"'), b = html.indexOf('id="' + p[1] + '"'), c = html.indexOf('id="' + p[2] + '"');
  ok(p[1] + ' is after the passage and before the question', a > -1 && b > a && c > b);
  ok(p[1] + ' starts hidden', new RegExp('id="' + p[1] + '"[^>]*hidden').test(html));
});
ok('the CSS sizes the picture to the screen', /\.q-image img\{[^}]*max-width:100%/.test(css) && /\.q-image\[hidden\]\{display:none/.test(css));

console.log('\nWiring');
ok('practice screen', /paintQImage\('pracImage', d\)/.test(app));
ok('CBT screen', /paintQImage\('cbtImage', d\)/.test(app));
ok('Web Test screen', /paintQImage\('wtImage', q\)/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var attrs = {}, box = { hidden: true, innerHTML: '', firstChild: { src: '' },
  setAttribute: function (k, v) { attrs[k] = v; }, getAttribute: function (k) { return attrs[k]; } };
var revoked = [], calls = [], pending = [];
var sandbox = {
  Promise: Promise, console: console, String: String,
  document: { getElementById: function (id) { return id === 'box' ? box : null; } },
  esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  URL: { createObjectURL: function (b) { return 'blob:' + b.n; }, revokeObjectURL: function (u) { revoked.push(u); } },
  GOC: { api: { getQuestionImage: function (id) { calls.push(id); return new Promise(function (res, rej) { pending.push({ res: res, rej: rej, id: id }); }); } } }
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var qImgSeq = 0, qImgUrls = {};' + grab('paintQImage') + ';', ctx);
var paint = function (q) { vm.runInContext('paintQImage("box", ' + JSON.stringify(q) + ')', ctx); };
var tick = function () { return new Promise(function (r) { setTimeout(r, 5); }); };

(async function () {
  console.log('\npaintQImage');
  paint({ text: 'no picture' });
  ok('a question with no picture hides the box', box.hidden === true && box.innerHTML === '' && calls.length === 0);

  paint({ image: { id: 'QIMG-aaaaaaaaaaaaaaaa', alt: 'A circuit with <two> bulbs' } });
  var shownAtOnce = box.hidden === false && /Loading/.test(box.innerHTML);
  await tick();
  ok('a picture shows a loading note at once and asks for the file', shownAtOnce && calls[0] === 'QIMG-aaaaaaaaaaaaaaaa');
  pending[0].res({ n: 1 }); await tick();
  ok('once loaded it shows an image with escaped alt text', /<img alt="A circuit with &lt;two&gt; bulbs">/.test(box.innerHTML) && box.firstChild.src === 'blob:1');

  paint({ image: { id: 'QIMG-bbbbbbbbbbbbbbbb', alt: 'Second' } }); await tick();
  ok('moving on releases the previous picture', revoked.indexOf('blob:1') > -1);
  paint({ image: { id: 'QIMG-cccccccccccccccc', alt: 'Third' } }); await tick();
  pending[1].res({ n: 2 }); await tick();
  ok('a slow, stale picture never replaces the current one', !/blob:2/.test(box.firstChild.src) && /Loading/.test(box.innerHTML));
  pending[2].res({ n: 3 }); await tick();
  ok('the current picture shows', box.firstChild.src === 'blob:3');

  paint({ image: { id: 'QIMG-dddddddddddddddd', alt: 'Resistors in series' } }); await tick();
  pending[3].rej(new Error('offline')); await tick();
  ok('if the picture fails, its description is shown instead (no dead end)', /Resistors in series/.test(box.innerHTML) && !/<img/.test(box.innerHTML));

  paint({ text: 'next' });
  ok('a following question with no picture hides the box again', box.hidden === true);
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})();
