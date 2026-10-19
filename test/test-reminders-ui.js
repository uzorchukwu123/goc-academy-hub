/* test-reminders-ui.js — Phase 2, Reminders: the Study reminders row on the
   Profile screen. Checks the markup, then runs the real paintReminders /
   toggleReminders from js/app.js against a stub page and stub GOC.api.
   node test/test-reminders-ui.js  */
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

console.log('\nStudy reminders on the Profile screen');
ok('the row, note and button exist', /id="reminderRow"/.test(html) && /id="reminderNote"/.test(html) && /id="reminderBtn"/.test(html));
ok('the button calls toggleReminders()', /id="reminderBtn"[^>]*onclick="toggleReminders\(\)"/.test(html));
ok('the row sits in Profile settings, beside the streak freeze',
  html.indexOf('id="reminderRow"') > html.indexOf('id="freezeRow"') && html.indexOf('id="reminderRow"') < html.indexOf('id="freezeRow"') + 2500);
ok('the profile refresh reads it', /refreshReminders\(\);/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var els = { reminderNote: { textContent: '' }, reminderBtn: { textContent: '', disabled: false } };
var toasts = [], setImpl, getImpl, calls = [];
var sandbox = {
  role: 'student',
  document: { getElementById: function (id) { return els[id] || null; } },
  GOC: { api: {
    getReminders: function () { return getImpl(); },
    setReminders: function (c) { calls.push(c); return setImpl(c); }
  } },
  toast: function (m) { toasts.push(m); },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var reminderEmailOn = true;\n' + grab('paintReminders') + '\n' + grab('refreshReminders') + '\n' + grab('toggleReminders'), ctx);
function flush() { return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {}); }

sandbox.paintReminders({ email: true, hasEmail: true, deliverable: { email: true } });
ok('on and deliverable: says what it sends, offers Turn off',
  /^On/.test(els.reminderNote.textContent) && /streak/.test(els.reminderNote.textContent) && els.reminderBtn.textContent === 'Turn off', els.reminderNote.textContent);
sandbox.paintReminders({ email: false, hasEmail: true, deliverable: { email: true } });
ok('off: says so, offers Turn on', /^Off/.test(els.reminderNote.textContent) && els.reminderBtn.textContent === 'Turn on');
sandbox.paintReminders({ email: true, hasEmail: true, deliverable: { email: false } });
ok('on but the academy has not enabled delivery: honest about it', /not switched email delivery on/.test(els.reminderNote.textContent), els.reminderNote.textContent);
sandbox.paintReminders({ email: true, hasEmail: false, deliverable: { email: false } });
ok('no address on file: says to ask the academy', /No email address/.test(els.reminderNote.textContent), els.reminderNote.textContent);
sandbox.paintReminders();
ok('no data at all (older server): defaults to on, no crash', els.reminderBtn.textContent === 'Turn off');

getImpl = function () { return Promise.resolve({ reminders: { email: false, hasEmail: true, deliverable: { email: true } } }); };
sandbox.refreshReminders();
flush().then(function () {
  ok('refresh paints what the server holds', /^Off/.test(els.reminderNote.textContent) && els.reminderBtn.textContent === 'Turn on');
  setImpl = function (c) { return Promise.resolve({ ok: true, reminders: { email: c.email, hasEmail: true, deliverable: { email: true } } }); };
  sandbox.toggleReminders();
  ok('tapping while off asks for email: true', calls.length === 1 && calls[0].email === true && Object.keys(calls[0]).length === 1, JSON.stringify(calls));
  ok('and the button is held while it works', els.reminderBtn.disabled === true);
  return flush();
}).then(function () {
  ok('success: repainted as on and told the student', /^On/.test(els.reminderNote.textContent) && toasts[0] === 'Study reminders are on', toasts.join('|'));
  ok('the button is usable again', els.reminderBtn.disabled === false);
  sandbox.toggleReminders();
  return flush();
}).then(function () {
  ok('tapping while on asks for email: false', calls[1].email === false, JSON.stringify(calls));
  ok('and says they are off', toasts[1] === 'Study reminders are off' && /^Off/.test(els.reminderNote.textContent), toasts.join('|'));
  setImpl = function () { return Promise.reject(new Error('Reminders can only be switched on or off.')); };
  sandbox.toggleReminders();
  return flush();
}).then(function () {
  ok('a refusal shows the server\'s own message', toasts[2] === 'Reminders can only be switched on or off.', toasts.join('|'));
  ok('and the button is usable again, state unchanged', els.reminderBtn.disabled === false && /^Off/.test(els.reminderNote.textContent));
  getImpl = function () { return Promise.reject(new Error('offline')); };
  sandbox.refreshReminders();
  return flush();
}).then(function () {
  ok('a failed refresh leaves the row as it was, silently', /^Off/.test(els.reminderNote.textContent) && toasts.length === 3);
  sandbox.role = 'admin';
  var before = calls.length;
  sandbox.toggleReminders(); sandbox.refreshReminders();
  ok('a non-student does nothing', calls.length === before);
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
