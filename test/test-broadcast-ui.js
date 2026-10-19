/* test-broadcast-ui.js — Phase 4, Targeted broadcast slice 4: the console Broadcast screen (audience picker,
   live "will reach" count, send, sent list with Remove). Loads the real app.js functions and goc-core.js.
   node test/test-broadcast-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

var els = {};
function el(id) {
  return els[id] || (els[id] = { id: id, innerHTML: '', textContent: '', value: '', checked: true, disabled: false, attrs: {},
    setAttribute: function (k, v) { this.attrs[k] = String(v); }, getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; } });
}
var calls = [], toasts = [], failWith = null, confirmAnswer = true, confirms = [], sent = [], audienceReach = { goc: 4, Physics: 2, Chemistry: 0 }, store = [];
var IDS = /^(admBcAud|admBcReach|admBcTitle|admBcBody|admBcChars|admBcRemind|admBcSendBtn|admBcList)$/;
var sandbox = {
  GOC: { core: core, api: {
    broadcastAudience: function (a) {
      calls.push(['audience', a]);
      if (failWith === 'audience') return Promise.reject(new Error('down'));
      var n = a.kind === 'goc' ? audienceReach.goc : audienceReach[a.subject] || 0;
      return Promise.resolve({ audience: a, reached: n });
    },
    listBroadcasts: function () { calls.push(['list']); return failWith === 'list' ? Promise.reject(new Error('Could not reach the server.')) : Promise.resolve({ count: store.length, broadcasts: store.slice() }); },
    sendBroadcast: function (d) {
      calls.push(['send', d]);
      if (failWith === 'send') return Promise.reject(new Error('Keep the message to 1000 characters or fewer.'));
      sent.push(d);
      store.unshift({ id: 11, title: d.title, body: d.body, audienceLabel: core.audienceLabel(d.audience), reached: 4, sentBy: 'Ernest Uzorchukwu', sentAt: '2026-10-09T09:00:00Z', remind: d.remind });
      return Promise.resolve({ created: true, broadcast: { id: 11, reached: 4 } });
    },
    deleteBroadcast: function (id) { calls.push(['delete', id]); return failWith === 'delete' ? Promise.reject(new Error('Could not reach the server.')) : Promise.resolve({ ok: true }); }
  } },
  document: { getElementById: function (id) { return IDS.test(id) ? el(id) : null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  confirm: function (m) { confirms.push(m); return confirmAnswer; },
  toast: function (m) { toasts.push(m); },
  Promise: Promise, String: String, Number: Number, Array: Array, Math: Math, isNaN: isNaN
};
var ctx = vm.createContext(sandbox);
var names = ['admBcAudienceOptsHTML', 'admBcAudience', 'admBcCount', 'admBcCounter', 'admBcLoad', 'admBcRender', 'admBcSend', 'admBcRemove'];
var code = names.map(grab).join('\n');
ok('all the functions exist', code.split('function ').length - 1 === names.length);
vm.runInContext('var admBcCache = [], admBcBusy = false;\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function reset() { calls = []; toasts = []; confirms = []; failWith = null; confirmAnswer = true; }

(async function () {
  head('the console selector and panel');
  ok('the console selector offers Broadcast', /<option value="broadcast">Broadcast<\/option>/.test(html));
  ok('opening it loads the screen', /if\(section === 'broadcast'\) admBcLoad\(\);/.test(app));
  ok('the panel has the picker, count, title, message, reminder box, send button and sent list', ['admBcAud', 'admBcReach', 'admBcTitle', 'admBcBody', 'admBcRemind', 'admBcSendBtn', 'admBcList'].every(function (id) { return app.indexOf('id="' + id + '"') > -1; }));
  ok('the reminder note says who is emailed and that delivery must be switched on', /who have an email address and have not switched reminder emails off also get it by email/.test(app) && /once the academy has email delivery switched on/.test(app) && !/not switched on yet/.test(app));
  var opts = run('admBcAudienceOptsHTML()');
  ok('the picker offers all GOC students first, then every subject', opts.indexOf('<option value="goc">All GOC students') === 0 && core.ALL_SUBJECTS.every(function (s) { return opts.indexOf('value="subject:' + s + '">' + s + ' students') > -1; }));
  ok('there is no cohort, everyone or Open choice', !/cohort|everyone|open/i.test(opts));

  head('the audience and the live count');
  el('admBcAud').value = 'goc';
  ok('"goc" reads as the all-GOC audience', JSON.stringify(run('admBcAudience()')) === '{"kind":"goc"}');
  el('admBcAud').value = 'subject:Physics';
  ok('a subject value reads as that subject', JSON.stringify(run('admBcAudience()')) === '{"kind":"subject","subject":"Physics"}');
  el('admBcAud').value = 'garbage';
  ok('anything unrecognised falls back to all GOC, never a wider audience', JSON.stringify(run('admBcAudience()')) === '{"kind":"goc"}');
  el('admBcAud').value = 'subject:Physics';
  await run('admBcCount()');
  ok('the count asks the server for that audience and shows it', calls[0][0] === 'audience' && calls[0][1].subject === 'Physics' && el('admBcReach').textContent === '2 students');
  el('admBcAud').value = 'subject:Chemistry'; await run('admBcCount()');
  ok('zero reads "0 students"', el('admBcReach').textContent === '0 students');
  audienceReach.goc = 1; el('admBcAud').value = 'goc'; await run('admBcCount()');
  ok('one reads "1 student"', el('admBcReach').textContent === '1 student');
  audienceReach.goc = 4;
  reset(); failWith = 'audience'; await run('admBcCount()');
  ok('a failed count says so, without a number', el('admBcReach').textContent === 'could not count');
  reset();
  /* a slow answer for an earlier choice must not overwrite the current one */
  var slow;
  sandbox.GOC.api.broadcastAudience = function (a) { return new Promise(function (r) { if (a.kind === 'goc') slow = function () { r({ reached: 99 }); }; else r({ reached: 2 }); }); };
  el('admBcAud').value = 'goc'; var p1 = run('admBcCount()');
  el('admBcAud').value = 'subject:Physics'; await run('admBcCount()');
  slow(); await p1;
  ok('a late answer for an earlier choice is ignored', el('admBcReach').textContent === '2 students', el('admBcReach').textContent);
  sandbox.GOC.api.broadcastAudience = function (a) { calls.push(['audience', a]); var n = a.kind === 'goc' ? audienceReach.goc : audienceReach[a.subject] || 0; return Promise.resolve({ audience: a, reached: n }); };

  head('the character counter');
  el('admBcBody').value = 'Hello there'; run('admBcCounter()');
  ok('it shows the length and the limits', /^11 of 1000/.test(el('admBcChars').textContent) && /at least 10/.test(el('admBcChars').textContent));

  head('sending');
  reset(); el('admBcAud').value = 'subject:Physics'; await run('admBcCount()'); calls = [];
  el('admBcTitle').value = 'Mock exam on Friday'; el('admBcBody').value = 'The Physics mock holds on Friday.'; el('admBcRemind').checked = true;
  run('admBcSend()'); await tick(); await tick();
  ok('it asks before sending, naming how many will get it', confirms.length === 1 && /2 students/.test(confirms[0]), confirms[0]);
  var sd = calls.filter(function (c) { return c[0] === 'send'; })[0];
  ok('it sends the audience, title, message and reminder choice as typed', sd && sd[1].audience.subject === 'Physics' && sd[1].title === 'Mock exam on Friday' && sd[1].body === 'The Physics mock holds on Friday.' && sd[1].remind === true);
  ok('it sends no sender, time or count of its own', sd && Object.keys(sd[1]).sort().join() === 'audience,body,remind,title');
  ok('afterwards the form is cleared, the button is free and the list refreshes with the new one', el('admBcTitle').value === '' && el('admBcBody').value === '' && el('admBcSendBtn').disabled === false && calls.some(function (c) { return c[0] === 'list'; }) && /Mock exam on Friday/.test(el('admBcList').innerHTML));
  ok('the toast says how many it reached', toasts.some(function (m) { return /Sent to 4 student/.test(m); }), toasts.join('|'));
  ok('the sent row shows audience, reach, sender and time', /Physics students · reached 4 · Ernest Uzorchukwu · WHEN\(2026-10-09T09:00:00Z\)/.test(el('admBcList').innerHTML), el('admBcList').innerHTML);

  reset(); el('admBcTitle').value = 'Keep this'; el('admBcBody').value = 'A draft that must survive.'; el('admBcRemind').checked = false;
  confirmAnswer = false; run('admBcSend()'); await tick();
  ok('saying no to the confirm sends nothing and keeps the draft', !calls.some(function (c) { return c[0] === 'send'; }) && el('admBcTitle').value === 'Keep this');
  confirmAnswer = true; failWith = 'send'; run('admBcSend()'); await tick(); await tick();
  ok('a refusal shows the server\'s own reason and keeps the draft', toasts.indexOf('Keep the message to 1000 characters or fewer.') > -1 && el('admBcTitle').value === 'Keep this' && el('admBcBody').value === 'A draft that must survive.' && el('admBcSendBtn').disabled === false);
  var sd2 = calls.filter(function (c) { return c[0] === 'send'; })[0];
  ok('an unticked reminder box is sent as false', sd2 && sd2[1].remind === false);

  reset(); audienceReach.Chemistry = 0; el('admBcAud').value = 'subject:Chemistry'; await run('admBcCount()'); calls = [];
  run('admBcSend()'); await tick();
  ok('an audience of zero is stopped on the page with a plain message, nothing sent', !calls.some(function (c) { return c[0] === 'send'; }) && toasts.some(function (m) { return /No GOC students/.test(m); }) && confirms.length === 0);

  head('the sent list');
  reset(); store = []; await run('admBcLoad()');
  ok('an empty list says nothing has been sent', /Nothing sent yet/.test(el('admBcList').innerHTML));
  store = [{ id: 5, title: '<b>Hi</b>', body: 'Line one\nLine <i>two</i>', audienceLabel: 'All GOC students', reached: 3, sentBy: 'Mrs <X>', sentAt: 't' }];
  await run('admBcLoad()');
  ok('server text is written escaped', el('admBcList').innerHTML.indexOf('<b>Hi</b>') === -1 && /&lt;b&gt;Hi&lt;\/b&gt;/.test(el('admBcList').innerHTML) && el('admBcList').innerHTML.indexOf('<i>two</i>') === -1 && /Mrs &lt;X&gt;/.test(el('admBcList').innerHTML));
  ok('line breaks are kept', /white-space:pre-wrap/.test(el('admBcList').innerHTML));
  reset(); failWith = 'list'; await run('admBcLoad()');
  ok('a failed load shows the reason on the list only', /Could not reach the server\./.test(el('admBcList').innerHTML));

  head('removing');
  reset(); store = [{ id: 5, title: 'One', body: 'First message here.', audienceLabel: 'All GOC students', reached: 3, sentBy: 'A', sentAt: 't' }, { id: 6, title: 'Two', body: 'Second message here.', audienceLabel: 'All GOC students', reached: 3, sentBy: 'A', sentAt: 't' }];
  await run('admBcLoad()');
  confirmAnswer = false; run('admBcRemove("5")'); await tick();
  ok('saying no removes nothing', !calls.some(function (c) { return c[0] === 'delete'; }) && /One/.test(el('admBcList').innerHTML));
  confirmAnswer = true; run('admBcRemove("5")'); await tick();
  ok('saying yes removes it and redraws without it', calls.some(function (c) { return c[0] === 'delete' && c[1] === '5'; }) && !/>One</.test(el('admBcList').innerHTML) && /Two/.test(el('admBcList').innerHTML));
  reset(); failWith = 'delete'; run('admBcRemove("6")'); await tick();
  ok('a failed remove keeps it and shows the reason', /Two/.test(el('admBcList').innerHTML) && toasts.indexOf('Could not reach the server.') > -1);

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
