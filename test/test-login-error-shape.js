/* test-login-error-shape.js — regression for object-shaped login errors.
   Run: node test/test-login-error-shape.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

function mkResponse(status, bodyObj) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: function () { return Promise.resolve(JSON.stringify(bodyObj)); },
    json: function () { return Promise.resolve(bodyObj); }
  };
}

var sandbox = {
  console: console,
  location: { protocol: 'http:', href: 'https://goc-academy-hub.vercel.app' },
  navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent,
  fetch: function (url) {
    if (url === 'api/health') {
      return Promise.resolve(mkResponse(200, { service: 'goc-academy-hub', passcodeLength: 4 }));
    }
    if (url === 'api/auth/login') {
      return Promise.resolve(mkResponse(401, { error: { message: 'That ID and password do not match.' } }));
    }
    return Promise.resolve(mkResponse(200, {}));
  }
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

vm.runInContext('GOC.api.ready', ctx)
  .then(function () {
    return vm.runInContext('GOC.api.login("GOC-S-001", "wrong-password")', ctx)
      .then(function () { return null; }, function (err) { return err; });
  })
  .then(function (err) {
    ok('login rejects on 401', !!err);
    ok('nested error message is unwrapped to plain text',
      err && err.message === 'That ID and password do not match.',
      err && err.message);
    ok('error message is never [object Object]', err && err.message !== '[object Object]', err && err.message);
    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  })
  .catch(function (e) {
    console.log('  FAIL  harness error: ' + (e && e.message));
    process.exit(1);
  });
