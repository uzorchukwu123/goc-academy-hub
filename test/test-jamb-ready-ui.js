/* test-jamb-ready-ui.js — Phase 3, JAMB mock slice 4: the console JAMB panel shows
   how many more questions each subject needs and lets staff set the bar; the
   student's Web Test card says "coming soon" while the sitting is held back.
   Runs the real functions from js/app.js against stubs.  node test/test-jamb-ready-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function fakeEl(tag) {
  var el = { tag: tag, children: [], className: '', textContent: '', _html: '', style: {},
    classList: { contains: function (c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') > -1; } },
    appendChild: function (c) { el.children.push(c); return c; } };
  Object.defineProperty(el, 'innerHTML', { get: function () { return el._html; }, set: function (v) { el._html = v; if (v === '') el.children = []; } });
  return el;
}

console.log('\nConsole JAMB panel: depth bar');
var panelFn = app.indexOf("jamb: function(){ return (");
var panel = app.slice(panelFn, app.indexOf('window: function(){', panelFn));
ok('the panel has a bar card with a stepper wired to admJambBarStep',
   /admJambBarStep\(-5\)/.test(panel) && /admJambBarStep\(5\)/.test(panel) && /id="admJambReady"/.test(panel));
ok('it explains why the sitting is hidden', /every<\/b> subject/.test(panel));
ok('admJambLoad keeps the bar and the readiness report', /admJambBar = Number\(r && r\.readyMin\)/.test(app) && /admJambReadiness = \(r && r\.readiness\)/.test(app));

var els = { admJambBar: fakeEl(), admJambBarVal: fakeEl(), admJambReady: fakeEl() };
var toasts = [], saved = [], loads = 0, setImpl;
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (x) { return String(x); },
  toast: function (m) { toasts.push(m); },
  admJambBar: 20, admJambReadiness: null,
  admJambLoad: function () { loads++; },
  GOC: { api: { setJambReadyMin: function (n) { saved.push(n); return setImpl(n); } } },
  Promise: Promise, Math: Math, Number: Number
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('admJambPaintReady') + '\n' + grab('admJambBarStep'), ctx);

sandbox.admJambReadiness = { min: 20, ready: false, short: ['Physics', 'Chemistry'], subjects: [
  { subject: 'Use of English', available: 25, need: 0, ok: true },
  { subject: 'Physics', available: 14, need: 6, ok: false },
  { subject: 'Chemistry', available: 19, need: 1, ok: false }] };
sandbox.admJambPaintReady();
var h = els.admJambReady.innerHTML;
ok('the bar is shown', String(els.admJambBar.textContent) === '20' && String(els.admJambBarVal.textContent) === '20');
ok('a short subject says exactly how many more it needs', /Physics · 14 live[\s\S]*6 more needed/.test(h) && /Chemistry · 19 live[\s\S]*1 more needed/.test(h), h);
ok('a deep subject says Ready', /Use of English · 25 live[\s\S]*Ready/.test(h));
ok('it names who is holding the sitting back', /Held back from students until Physics, Chemistry reach 20/.test(h), h);
sandbox.admJambReadiness = { min: 20, ready: true, short: [], subjects: [{ subject: 'Physics', available: 30, need: 0, ok: true }] };
sandbox.admJambPaintReady();
ok('when every subject is deep it says students see the sitting', /students see the sitting/.test(els.admJambReady.innerHTML));
sandbox.admJambReadiness = null; sandbox.admJambPaintReady();
ok('no report yet: nothing is drawn', els.admJambReady.innerHTML === '');

setImpl = function (n) { return Promise.resolve({ jambReadyMin: n }); };
sandbox.admJambBarStep(5);
function tick() { return Promise.resolve().then(function () {}).then(function () {}).then(function () {}); }
tick().then(function () {
  ok('+ asks for the bar plus 5', saved[0] === 25, saved.join());
  ok('and reloads the panel, telling staff', loads === 1 && /25 questions/.test(toasts[0] || ''), toasts.join('|'));
  sandbox.admJambBar = 38;
  sandbox.admJambBarStep(5);
  ok('the bar is never asked above 40', saved[1] === 40, saved.join());
  sandbox.admJambBar = 3;
  sandbox.admJambBarStep(-5);
  ok('nor below 1', saved[2] === 1, saved.join());
  setImpl = function () { return Promise.reject(new Error('Enter the access passcode first.')); };
  sandbox.admJambBarStep(5);
  return tick();
}).then(function () {
  ok('a refusal shows the server\'s own message', toasts[toasts.length - 1] === 'Enter the access passcode first.', toasts.join('|'));

  console.log('\nStudent Web Test card: retired with the Web Test catalogue (clean sweep)');
  ok('there is no student Web Test card renderer any more', app.indexOf('function renderWebTest(') < 0 && app.indexOf('var WT_SECTIONS') < 0);
}).catch(function (e) { fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')'); })
.then(function () { console.log('\n' + (fails ? fails + ' FAILED' : 'all passed')); process.exit(fails ? 1 : 0); });
