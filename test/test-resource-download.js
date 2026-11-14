/* test-resource-download.js — Phase 3B: the HTTP driver asks for `?download=1` only when a
   download is wanted, and the screen refuses to open files for an Open student.
   node test/test-resource-download.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

var urls = [];
var sandbox = {
  console: console, location: { protocol: 'http:', href: 'http://x/' }, navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent,
  fetch: function (u) { urls.push(u); return Promise.resolve({ ok: true, blob: function () { return Promise.resolve('blob'); } }); }
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var http = sandbox.GOC.api._drivers.http;

console.log('\nthe HTTP driver');
function lastFor(id) { return urls.filter(function (u) { return u.indexOf(id) > -1; }).pop(); }
http.getResourceFile('RES-1').then(function () {
  ok('a plain call is a view (no query)', lastFor('RES-1') === 'api/resources/RES-1/file', lastFor('RES-1'));
  return http.getResourceFile('RES-3', { download: true });
}).then(function () {
  ok('{ download: true } adds ?download=1', lastFor('RES-3') === 'api/resources/RES-3/file?download=1', lastFor('RES-3'));
  return http.getResourceFile('RES-1');
}).then(function () {
  ok('a later plain call is still a view', lastFor('RES-1') === 'api/resources/RES-1/file', lastFor('RES-1'));
}).then(function () {
  console.log('\nthe screen');
  var app = read('js/app.js');
  ok('opening is refused up front when the list said canView is false', /if\(!resourcesCanView\)\{\s*toast\(GOC\.core\.RESOURCE_VIEW_LOCK_MESSAGE\);\s*return;/.test(app));
  ok('the download button asks for a download', /getResourceFile\(r\.resourceId, \{ download: true \}\)/.test(app));
  ok('the lock message names the download icon and GOC', /download icon/.test(sandbox.GOC.core.RESOURCE_VIEW_LOCK_MESSAGE) && /GOC/.test(sandbox.GOC.core.RESOURCE_VIEW_LOCK_MESSAGE));
}).catch(function (e) { fails++; console.log('  FAIL  threw ' + e.stack); }).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
