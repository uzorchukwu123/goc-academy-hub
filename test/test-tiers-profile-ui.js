/* test-tiers-profile-ui.js — Phase 3B: the Profile "Your access" row shows the tier and, for an
   Open student, the free practice questions left today.   node test/test-tiers-profile-ui.js */
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
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
function fakeEl() {
  var el = { children: [], className: '', textContent: '', innerHTML: '', disabled: false, onclick: null,
    appendChild: function (c) { el.children.push(c); return c; } };
  return el;
}
var els = { tierRow: { style: { display: 'none' } }, tierNote: { textContent: '' }, tierChip: { textContent: '' } };
var core = require(path.join(APP, 'js', 'goc-core.js'));
var sandbox = { document: { getElementById: function (id) { return els[id] || null; } },
  GOC: { core: core }, Number: Number, Math: Math };
vm.runInContext(grab('paintTier'), vm.createContext(sandbox));
function reset() { els.tierRow.style.display = 'none'; els.tierNote.textContent = ''; els.tierChip.textContent = ''; }
function open(tier, practice) { reset(); sandbox.paintTier({ tier: tier, today: practice === undefined ? undefined : { practice: practice } }); }

console.log('\nOpen student');
open('open', { limit: 20, used: 7, remaining: 13, unlimited: false });
ok('the row is shown with an Open chip', els.tierRow.style.display === '' && els.tierChip.textContent === 'Open');
ok('it says 13 of 20 left today', /13 of 20 free practice questions left today/.test(els.tierNote.textContent), els.tierNote.textContent);
ok('it points to GOC', /GOC/.test(els.tierNote.textContent));
open('open', { limit: 20, used: 20, remaining: 0 });
ok('with none left it says they return at midnight', /0 of 20/.test(els.tierNote.textContent) && /midnight/.test(els.tierNote.textContent), els.tierNote.textContent);
open('open');
ok('no allowance sent: still honest, no made-up number', /Open account/.test(els.tierNote.textContent) && !/\d+ of \d+/.test(els.tierNote.textContent), els.tierNote.textContent);
open(' OPEN ', { limit: 20, remaining: 5 });
ok('a stray-cased tier is read as Open', els.tierChip.textContent === 'Open');

console.log('\nGOC student');
open('goc', { limit: null, used: 40, remaining: null, unlimited: true });
ok('GOC chip, full access, no daily count', els.tierChip.textContent === 'GOC' && /full access/.test(els.tierNote.textContent) && !/left today/.test(els.tierNote.textContent), els.tierNote.textContent);
open(' GoC ', undefined);
ok('any capitalisation of goc reads as GOC', els.tierChip.textContent === 'GOC');

console.log('\nNo tier sent (offline demo)');
els.tierRow.style.display = '';
sandbox.paintTier({ streak: 3 });
ok('the row is hidden rather than guessed', els.tierRow.style.display === 'none');
sandbox.paintTier(null);
ok('a missing profile hides it too', els.tierRow.style.display === 'none');

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
