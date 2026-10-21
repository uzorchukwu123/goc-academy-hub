/* test-passage-ui.js — Comprehension passages, slice 4 (student screens only):
   the passage is shown above its question on the practice, CBT and Web Test
   screens. Checks the markup, then runs the real paintPassage from js/app.js.
   node test/test-passage-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js'), css = read('css/styles.css');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\nMarkup: a hidden passage box sits above each question text');
[['pracPassage', 'pracQ'], ['cbtPassage', 'cbtQ'], ['wtPassage', 'wtQ']].forEach(function (p) {
  var a = html.indexOf('id="' + p[0] + '"'), b = html.indexOf('id="' + p[1] + '"');
  ok(p[0] + ' exists, above ' + p[1], a > -1 && b > a && b - a < 120);
  ok(p[0] + ' starts hidden', new RegExp('id="' + p[0] + '"[^>]*hidden').test(html));
});
ok('the CSS styles the box and keeps it scrollable', /\.q-passage\{[^}]*overflow-y:auto/.test(css));

console.log('\nWiring: each screen paints its passage when it draws a question');
ok('practice screen', /paintPassage\('pracPassage', d\)/.test(app));
ok('CBT screen', /paintPassage\('cbtPassage', d\)/.test(app));
ok('Web Test screen', /paintPassage\('wtPassage', q\)/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var box = { hidden: true, innerHTML: '', scrollTop: 50 };
var sandbox = {
  document: { getElementById: function (id) { return id === 'box' ? box : null; } },
  esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
};
vm.runInContext(grab('paintPassage'), vm.createContext(sandbox));
// run in the same context the sandbox object belongs to
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('paintPassage'), ctx);

console.log('\npaintPassage behaviour');
sandbox.paintPassage('box', { passage: { id: 3, title: 'The Market', text: 'Line one.\nLine two.' } });
ok('shows the box with the title and text', box.hidden === false && /The Market/.test(box.innerHTML) && /Line one\./.test(box.innerHTML));
ok('line breaks become <br>', /Line one\.<br>Line two\./.test(box.innerHTML));
ok('the box is scrolled back to the top', box.scrollTop === 0);

sandbox.paintPassage('box', { passage: { id: 4, title: '<b>x</b>', text: '<img src=x onerror=alert(1)>' } });
ok('hostile title and text are escaped', !/<img|<b>/.test(box.innerHTML) && /&lt;img/.test(box.innerHTML));

sandbox.paintPassage('box', { passage: { id: 5, text: 'Body only, no title given.' } });
ok('a missing title falls back to "Passage"', />Passage</.test(box.innerHTML));

sandbox.paintPassage('box', { text: 'A standalone question' });
ok('a question with no passage hides and clears the box', box.hidden === true && box.innerHTML === '');
sandbox.paintPassage('box', null);
ok('no question at all hides it too', box.hidden === true);
sandbox.paintPassage('missing-box', { passage: { text: 'x' } });
ok('an absent element is ignored without error', true);

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
