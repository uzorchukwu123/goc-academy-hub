/* test-contact.js — the homepage "Talk to G.O.C Academy" form.
   Covers js/api.js's GOC.api.sendContact (the mail-relay + durable-record
   call used by the contact form in index.html / js/app.js) and the mock
   driver's recordContactMessage that backs it when there is no server.

   This runs in a bare vm sandbox with no `fetch` defined — deliberately,
   since this test environment has no outbound network access. That is a
   real, supported code path (see the `typeof fetch !== 'function'` branch
   in GOC.api.sendContact): it exercises exactly what a very old browser, or
   any environment where the mail relay is unreachable, would do — validate,
   then fall back straight to the durable local/server record.

   Run:  node test/test-contact.js  */
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
  // NOTE: no `fetch` here on purpose — see file header.
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

var fails = 0, passes = 0, pending = [];
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var GOCapi = vm.runInContext('GOC.api', ctx);

head('Contact form — GOC.api.sendContact / recordContactMessage (mock driver, no fetch)');

/* ---- validation: rejects before ever touching the network/record ---- */
pending.push(
  GOCapi.sendContact({ name: '', email: 'a@b.com', message: 'Hi' })
    .then(function () { ok('rejects a blank name', false); })
    .catch(function (e) { ok('rejects a blank name', /name/i.test(e.message), e.message); })
);
pending.push(
  GOCapi.sendContact({ name: 'Ada', email: 'not-an-email', message: 'Hi' })
    .then(function () { ok('rejects a malformed email', false); })
    .catch(function (e) { ok('rejects a malformed email', /email/i.test(e.message), e.message); })
);
pending.push(
  GOCapi.sendContact({ name: 'Ada', email: 'a@b.com', message: '  ' })
    .then(function () { ok('rejects a blank message', false); })
    .catch(function (e) { ok('rejects a blank message', /message/i.test(e.message), e.message); })
);

/* ---- happy path: no fetch in this sandbox, so it must fall back to the
   durable local record and still resolve (never reject) for the visitor ---- */
pending.push(
  GOCapi.sendContact({ name: 'Ada Obi', email: 'ada@example.com', message: 'When does the next cohort start?' })
    .then(function (r) {
      ok('resolves (never rejects) when no relay is reachable', true);
      ok('reports delivered:false when there is no relay to confirm through', r && r.delivered === false, JSON.stringify(r));
    })
    .catch(function (e) { ok('resolves (never rejects) when no relay is reachable', false, e.message); })
);

/* ---- the record actually landed in the mock driver's own store, reachable
   via the same recordContactMessage() path GOC.api exposes for parity ---- */
pending.push(
  GOCapi.recordContactMessage({ name: 'Chidi', email: 'chidi@example.com', message: 'Fees enquiry' })
    .then(function (r) { ok('recordContactMessage resolves on the mock driver', r && r.ok === true, JSON.stringify(r)); })
    .catch(function (e) { ok('recordContactMessage resolves on the mock driver', false, e.message); })
);
pending.push(
  GOCapi.recordContactMessage({ name: '', email: '', message: '' })
    .then(function () { ok('recordContactMessage still validates directly', false); })
    .catch(function (e) { ok('recordContactMessage still validates directly', /name.*email.*message|fill in/i.test(e.message), e.message); })
);

Promise.all(pending).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
