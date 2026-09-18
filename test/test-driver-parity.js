/* test-driver-parity.js — Phase 6: driver parity.
   js/api.js ships two drivers behind one interface, GOC.api, which just
   forwards every call to whichever driver is active: `return active.foo();`.
   Nothing checks at load time that `foo` actually exists on both drivers —
   a method present on one and missing on the other only surfaces when a
   user happens to be on the driver that's missing it, as a runtime
   "active.foo is not a function" crash on whatever screen calls it.

   That's exactly the shape the original Phase 1.1 bug had. This suite is
   the standing regression test that would have caught it automatically:
   it loads the real js/api.js, reaches into both driver objects via the
   test-only GOC.api._drivers hook, and asserts their method sets match
   exactly — nothing on one side without a matching name on the other.

   Run:  node test/test-driver-parity.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var sandbox = {
  console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var drivers = vm.runInContext('GOC.api._drivers', ctx);

head('Driver parity — js/api.js');

ok('test hook is present (GOC.api._drivers)', !!(drivers && drivers.mock && drivers.http));

if (drivers && drivers.mock && drivers.http) {
  /* Only methods the two drivers are meant to share are compared. A leading
     underscore marks a driver-private helper that exists to make one
     driver's own tests possible (e.g. http's _setPasscodeLength, used to
     simulate server-reported passcode length) — those are allowed to be
     one-sided and are excluded here on purpose, not missed by accident. */
  function isPublic(k) { return k.charAt(0) !== '_'; }
  function methodKeys(obj) {
    return Object.keys(obj).filter(function (k) {
      return isPublic(k) && typeof obj[k] === 'function';
    }).sort();
  }

  var mockKeys = methodKeys(drivers.mock);
  var httpKeys = methodKeys(drivers.http);

  var missingFromMock = httpKeys.filter(function (k) { return mockKeys.indexOf(k) === -1; });
  var missingFromHttp = mockKeys.filter(function (k) { return httpKeys.indexOf(k) === -1; });

  ok('mock driver exposes at least one method', mockKeys.length > 0);
  ok('http driver exposes at least one method', httpKeys.length > 0);

  ok('every http method exists on mock',
    missingFromMock.length === 0,
    missingFromMock.length ? 'missing on mock: ' + missingFromMock.join(', ') : '');

  ok('every mock method exists on http',
    missingFromHttp.length === 0,
    missingFromHttp.length ? 'missing on http: ' + missingFromHttp.join(', ') : '');

  /* Belt-and-braces: also confirm every method GOC.api forwards to `active`
     resolves on BOTH drivers — this is the check that maps most directly
     onto the user-visible symptom (a specific screen throwing). Parsed
     statically from api.js's own source rather than by calling each method
     (many need real args, a session, or a server), so this stays cheap and
     has no side effects. */
  var apiSrc = read('js/api.js');
  var forwardRe = /return active\.([A-Za-z_$][A-Za-z0-9_$]*)\(/g;
  var forwarded = {}, m;
  while ((m = forwardRe.exec(apiSrc))) { forwarded[m[1]] = true; }
  var forwardedNames = Object.keys(forwarded).sort();

  var forwardedMissingFromMock = forwardedNames.filter(function (k) { return mockKeys.indexOf(k) === -1; });
  var forwardedMissingFromHttp = forwardedNames.filter(function (k) { return httpKeys.indexOf(k) === -1; });

  ok('found forwarded GOC.api methods to check', forwardedNames.length > 10, String(forwardedNames.length));
  ok('every forwarded GOC.api method resolves on mock',
    forwardedMissingFromMock.length === 0,
    forwardedMissingFromMock.length ? forwardedMissingFromMock.join(', ') : '');
  ok('every forwarded GOC.api method resolves on http',
    forwardedMissingFromHttp.length === 0,
    forwardedMissingFromHttp.length ? forwardedMissingFromHttp.join(', ') : '');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
