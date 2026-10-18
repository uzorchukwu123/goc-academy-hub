/* test-broadcast-card.js — Phase 4, Targeted broadcast slice 5: the student's "From the academy" card on Home.
   Loads the real app.js functions.
   node test/test-broadcast-card.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html');
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
function el(id) { return els[id] || (els[id] = { id: id, innerHTML: '', textContent: '', style: { display: 'none' } }); }
var fail = null, mine = { locked: false, broadcasts: [] };
var IDS = /^(dashBroadcasts|dashBroadcastsList|dashBroadcastsMore)$/;
var sandbox = {
  GOC: { api: { listMyBroadcasts: function () { return fail ? Promise.reject(new Error('down')) : Promise.resolve(mine); } } },
  document: { getElementById: function (id) { return IDS.test(id) ? el(id) : null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  Promise: Promise, String: String, Number: Number, Array: Array
};
var ctx = vm.createContext(sandbox);
var names = ['dashBroadcastsRender', 'dashBroadcastsToggle', 'dashPaintBroadcasts'];
var code = names.map(grab).join('\n');
ok('all the functions exist', code.split('function ').length - 1 === names.length);
vm.runInContext('var dashBroadcastsAll = [], dashBroadcastsOpen = false, DASH_BROADCASTS_FIRST = 3;\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function B(id, extra) { return Object.assign({ id: id, title: 'Message ' + id, body: 'Body of message ' + id + ' here.', from: 'G.O.C Academy', at: '2026-10-0' + id + 'T10:00:00Z' }, extra || {}); }

(async function () {
  head('the page');
  ok('Home has a hidden "From the academy" card with a Show more button', /id="dashBroadcasts" style="display:none/.test(html) && /id="dashBroadcastsList"/.test(html) && /id="dashBroadcastsMore"/.test(html) && /From the academy/.test(html));
  ok('it sits above the Class notices card', html.indexOf('id="dashBroadcasts"') > -1 && html.indexOf('id="dashBroadcasts"') < html.indexOf('id="dashNotices"'));
  ok('it is filled whenever Home is drawn', /dashPaintLast\(\);\s*dashPaintBroadcasts\(\);\s*dashPaintNotices\(\);\s*\}/.test(app));

  head('the card');
  mine = { locked: false, broadcasts: [] };
  run('dashPaintBroadcasts()'); await tick();
  ok('with no broadcasts the card stays hidden', el('dashBroadcasts').style.display === 'none');
  mine = { locked: true, broadcasts: [] };
  run('dashPaintBroadcasts()'); await tick();
  ok('an Open (locked) student sees no card', el('dashBroadcasts').style.display === 'none');
  mine = { locked: true, broadcasts: [B(1)] };
  run('dashPaintBroadcasts()'); await tick();
  ok('even if a locked reply carried messages, none are drawn', el('dashBroadcasts').style.display === 'none' && el('dashBroadcastsList').innerHTML === '');
  mine = { locked: false, broadcasts: [B(5, { title: 'Mock <b>Friday</b>', body: 'Line one\nLine <i>two</i>' }), B(4), B(3), B(2), B(1)] };
  run('dashPaintBroadcasts()'); await tick();
  var h = el('dashBroadcastsList').innerHTML;
  ok('the card shows, with the newest three', el('dashBroadcasts').style.display === '' && /Message 4/.test(h) && /Message 3/.test(h) && !/Message 2/.test(h) && !/Message 1/.test(h));
  ok('each says it is from the academy, and when', /G\.O\.C Academy/.test(h) && /WHEN\(2026-10-05T10:00:00Z\)/.test(h));
  ok('it never says "edited" (a broadcast cannot be edited)', !/edited/.test(h));
  ok('text is escaped, with line breaks kept', /Mock &lt;b&gt;Friday&lt;\/b&gt;/.test(h) && !/<b>Friday<\/b>/.test(h) && /Line one\nLine &lt;i&gt;two&lt;\/i&gt;/.test(h) && /white-space:pre-wrap/.test(h));
  ok('"Show 2 more" is offered', el('dashBroadcastsMore').style.display === '' && el('dashBroadcastsMore').textContent === 'Show 2 more');
  run('dashBroadcastsToggle()');
  h = el('dashBroadcastsList').innerHTML;
  ok('Show more reveals all five and offers Show fewer', /Message 1/.test(h) && /Message 2/.test(h) && el('dashBroadcastsMore').textContent === 'Show fewer');
  run('dashBroadcastsToggle()');
  ok('Show fewer goes back to three', !/Message 1/.test(el('dashBroadcastsList').innerHTML));
  mine = { locked: false, broadcasts: [B(7)] };
  run('dashPaintBroadcasts()'); await tick();
  ok('with three or fewer there is no Show more button', el('dashBroadcastsMore').style.display === 'none');
  mine = { locked: false, broadcasts: [B(8, { from: undefined })] };
  run('dashPaintBroadcasts()'); await tick();
  ok('a message with no sender still says it is from the academy', /G\.O\.C Academy/.test(el('dashBroadcastsList').innerHTML));
  mine = { locked: false, broadcasts: [B(6)] };
  run('dashPaintBroadcasts()'); await tick();
  fail = true; run('dashPaintBroadcasts()'); await tick(); fail = null;
  ok('a failed load hides the card instead of showing an error on Home', el('dashBroadcasts').style.display === 'none');
  mine = { locked: false, broadcasts: [B(6)] };
  run('dashPaintBroadcasts()'); await tick();
  mine = { locked: true, broadcasts: [] };
  run('dashPaintBroadcasts()'); await tick();
  ok('a student who becomes Open loses the card on the next Home draw', el('dashBroadcasts').style.display === 'none' && el('dashBroadcastsList').innerHTML === '');

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
