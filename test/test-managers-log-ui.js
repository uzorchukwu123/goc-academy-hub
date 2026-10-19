/* test-managers-log-ui.js — roles slice (c), last piece: the Manager action log card
   in the Managers panel. Checks the markup, wiring and JS functions.
   node test/test-managers-log-ui.js */
'use strict';
var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html');
var app  = read('js/app.js');
var sw   = read('sw.js');

var fails = 0;
function ok(n, c, x) {
  if (c) console.log('  pass  ' + n);
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 120) + ')' : '')); }
}

console.log('\nManager action log — markup');
ok('card heading exists in app.js', app.includes('Manager action log'));
ok('the list container id admMgLogList exists', app.includes('id="admMgLogList"') || app.includes("id='admMgLogList'") || app.includes('id=\\"admMgLogList\\"'));
ok('the action filter dropdown exists', app.includes('admMgLogAction'));
ok('the From date filter exists', app.includes('admMgLogFrom'));
ok('the To date filter exists', app.includes('admMgLogTo'));
ok('the CSV export button exists', app.includes('admMgLogCsvBtn'));
ok('admMgLogLoad is wired to the Show button', app.includes('admMgLogLoad()'));
ok('admMgLogClear is wired to the Clear filters button', app.includes('admMgLogClear()'));
ok('admMgLogExport is wired to the Export button', app.includes('admMgLogExport()'));

console.log('\nManager action log — section wiring');
ok('managers section loads the log on open', /section === 'managers'.*admMgLogLoad|admMgLogLoad.*section === 'managers'/.test(app));

console.log('\nManager action log — JS functions');
// extract the functions we need
function grab(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  var d = 0, j = src.indexOf('{', i);
  for (var k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
var fns = ['admMgLogFilters','admMgLogLoad','admMgLogBtn','admMgLogPaint','admMgLogClear','admMgLogExport'];
fns.forEach(function(n){ ok('function ' + n + ' exists', !!grab(app, n)); });

// set up a minimal sandbox and run the functions
var els = {
  admMgLogList:    { innerHTML: 'Press Show to load the log.', style: {} },
  admMgLogAction:  { value: '' },
  admMgLogFrom:    { value: '' },
  admMgLogTo:      { value: '' },
  admMgLogCsvBtn:  { disabled: true }
};
var downloadCalled = null;
var toastMsg = null;
var sandbox = {
  document: { getElementById: function(id){ return els[id] || null; } },
  GOC: {
    core: {
      validDayStr: function(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s); },
      lagosDay:    function(){ return '2026-10-16'; },
      MANAGER_LOG_KEEP: 1000
    },
    api: {
      listManagerActions: function(f) {
        return Promise.resolve({ count: 0, keep: 1000, entries: [] });
      }
    }
  },
  Promise: Promise, Math: Math, Number: Number, String: String, Array: Array,
  Blob: function(parts){ this.text = parts[0]; },
  downloadResourceBlob: function(b, n, ext){ downloadCalled = { name: n, ext: ext }; },
  toast: function(msg){ toastMsg = msg; },
  esc: function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
};
var code = fns.map(function(n){ return grab(app, n) || ''; }).join('\n') +
           '\nvar admMgLogRows = [];\nvar admMgLogSeq = 0;\n';
var ctx = vm.createContext(sandbox);
vm.runInContext(code, ctx);

console.log('\nManager action log — behaviour');
// clear state
ctx.admMgLogRows = [];
ctx.admMgLogPaint(els.admMgLogList, 1000);
ok('empty log says nothing recorded', /No sensitive actions/.test(els.admMgLogList.innerHTML), els.admMgLogList.innerHTML.slice(0,80));
ok('CSV button disabled when empty', els.admMgLogCsvBtn.disabled);

// seed two rows
var now = Date.now();
ctx.admMgLogRows = [
  { id: 2, action: 'student-tier', label: 'Changed a student access tier', by: 'GOC-A-003', byName: 'Ada Obi', role: 'finance', target: 'GOC-0042', detail: 'open', at: now },
  { id: 1, action: 'manager-delete', label: 'Deleted a manager account', by: 'GOC-A-001', byName: 'Founder', role: null, target: 'GOC-A-007', detail: null, at: now - 60000 }
];
ctx.admMgLogPaint(els.admMgLogList, 1000);
ok('two entries shown', /2<\/b>.*entr|2 entr/.test(els.admMgLogList.innerHTML), els.admMgLogList.innerHTML.slice(0,80));
ok('CSV button enabled when entries exist', !els.admMgLogCsvBtn.disabled);
ok('action label is shown', /Changed a student access tier/.test(els.admMgLogList.innerHTML));
ok('target is shown', /GOC-0042/.test(els.admMgLogList.innerHTML));
ok('detail is shown', /open/.test(els.admMgLogList.innerHTML));
ok('actor name and ID shown', /Ada Obi/.test(els.admMgLogList.innerHTML) && /GOC-A-003/.test(els.admMgLogList.innerHTML));
ok('null detail is not printed', !/null/.test(els.admMgLogList.innerHTML));

// clear filters
els.admMgLogAction.value = 'student-tier';
ctx.admMgLogClear();
ok('clear resets the action filter', els.admMgLogAction.value === '');

// export
ctx.admMgLogRows = [
  { id: 1, action: 'student-tier', label: 'Changed a student access tier', by: 'GOC-A-003', byName: 'Ada', role: 'finance', target: 'GOC-0042', detail: 'goc', at: now }
];
ctx.admMgLogExport();
ok('export calls downloadResourceBlob', !!downloadCalled);
ok('export filename contains the date', downloadCalled && downloadCalled.name.includes('2026-10-16'), downloadCalled && downloadCalled.name);
ok('export extension is csv', downloadCalled && downloadCalled.ext === 'csv');

// nothing to export
ctx.admMgLogRows = [];
downloadCalled = null; toastMsg = null;
ctx.admMgLogExport();
ok('export with nothing shows a toast, no download', !downloadCalled && /Nothing/.test(toastMsg));

console.log('\nManager action log — driver');
ok('listManagerActions exists in api.js', read('js/api.js').includes('listManagerActions'));
ok('listManagerActions exists on the active shim', read('js/api.js').includes('listManagerActions: function (f) { return active.listManagerActions(f); }'));

console.log('\nCache');
ok('cache bumped past goc-v174', /const CACHE = 'goc-v(17[5-9]|1[89]\d|[2-9]\d\d)'/.test(sw));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
