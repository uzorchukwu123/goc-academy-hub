/* test-quest-ui.js — Phase 2, daily quest slice 4: the read-only Daily quest
   card on the Study hub. Checks the markup, then runs the real paintQuest /
   refreshQuest from js/app.js against a stub page and stub GOC.api.
   node test/test-quest-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\nDaily quest card on the Study hub');
var studyAt = html.indexOf('id="study"'), setAt = html.indexOf('id="studySet"');
['questCard', 'questText', 'questBar', 'questNote'].forEach(function (id) {
  var at = html.indexOf('id="' + id + '"');
  ok(id + ' exists inside the Study screen', at > studyAt && at < setAt);
});
ok('the card starts hidden', /id="questCard"[^>]*display:none/.test(html));
ok('opening the Study hub refreshes it', /id === 'study' && typeof refreshQuest === 'function'\) refreshQuest\(\)/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var els = {
  questCard: { style: { display: 'none' } }, questText: { textContent: '' },
  questBar: { style: { width: '' } }, questNote: { textContent: '' }
};
var getImpl;
var sandbox = {
  studentId: 'GOC-1',
  document: { getElementById: function (id) { return els[id] || null; } },
  GOC: { api: { getQuest: function () { return getImpl(); } } },
  Promise: Promise, Math: Math, Number: Number
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('paintQuest') + '\n' + grab('refreshQuest'), ctx);

sandbox.paintQuest({ kind: 'weak', subject: 'Physics', topic: 'Motion', target: 10, answered: 4, remaining: 6, done: false });
ok('weak quest names the subject, topic and target', /10 questions in Physics · Motion/.test(els.questText.textContent), els.questText.textContent);
ok('progress bar and note show 4 of 10', els.questBar.style.width === '40%' && /4 of 10 answered today/.test(els.questNote.textContent), els.questBar.style.width + ' ' + els.questNote.textContent);
ok('the card is shown', els.questCard.style.display === '');

sandbox.paintQuest({ kind: 'any', subject: null, topic: null, target: 10, answered: 0, remaining: 10, done: false });
ok('plain goal says any topic', /any topic/.test(els.questText.textContent) && els.questBar.style.width === '0%');

sandbox.paintQuest({ kind: 'weak', subject: 'Physics', topic: 'Motion', target: 10, answered: 14, remaining: 0, done: true });
ok('done: bar is full, never past, and the note says so', els.questBar.style.width === '100%' && /Done for today/.test(els.questNote.textContent));

sandbox.paintQuest(null);
ok('no quest hides the card', els.questCard.style.display === 'none');
sandbox.paintQuest({});
ok('an empty object hides it too', els.questCard.style.display === 'none');

getImpl = function () { return Promise.resolve({ quest: { kind: 'any', target: 10, answered: 3, done: false } }); };
sandbox.refreshQuest().then(function () {
  ok('refreshQuest paints what the server returned', els.questCard.style.display === '' && /3 of 10/.test(els.questNote.textContent));
  getImpl = function () { return Promise.reject(new Error('offline')); };
  return sandbox.refreshQuest();
}).then(function () {
  ok('offline: the card is left as it was', els.questCard.style.display === '' && /3 of 10/.test(els.questNote.textContent));
  sandbox.studentId = null;
  return sandbox.refreshQuest();
}).then(function () {
  ok('signed out: the card is hidden', els.questCard.style.display === 'none');
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
