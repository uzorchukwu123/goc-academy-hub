/* test-broadcast-driver.js — Phase 4, Targeted broadcast slice 3: both drivers and GOC.api carry the
   broadcast calls; the offline demo driver applies the same rules as the server, in memory; the HTTP driver
   sends the right requests. Loads the real js/goc-core.js and js/api.js.
   node test/test-broadcast-driver.js */
'use strict';
var activeStudent = require('./active-student.js');
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
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
var mock = vm.runInContext('GOC.api._drivers.mock', ctx);
var http = vm.runInContext('GOC.api._drivers.http', ctx);
var METHODS = ['sendBroadcast', 'listBroadcasts', 'broadcastAudience', 'deleteBroadcast', 'listMyBroadcasts'];

var CODE = 'GOC2027';
var CHEM = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var BIO = ['Use of English', 'Physics', 'Biology', 'Mathematics'];

async function main() {
  head('every call exists on both drivers and on GOC.api');
  ok('the offline driver has all five', METHODS.every(function (m) { return typeof mock[m] === 'function'; }));
  ok('the server driver has all five', METHODS.every(function (m) { return typeof http[m] === 'function'; }));
  ok('GOC.api forwards all five', METHODS.every(function (m) { return vm.runInContext('typeof GOC.api.' + m, ctx) === 'function'; }));

  head('the server driver asks the right questions');
  var seen = [];
  vm.runInContext('GOC.api._drivers.http', ctx);
  var real = sandbox.fetch;
  sandbox.fetch = function (url, opts) {
    seen.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve('{}'); }, headers: { get: function () { return 'application/json'; } } });
  };
  var hadFetch = typeof vm.runInContext('typeof fetch', ctx) === 'string' && vm.runInContext('typeof fetch', ctx) === 'function';
  if (hadFetch) {
    await http.sendBroadcast({ audience: { kind: 'goc' }, title: 'Hello there', body: 'A message long enough.' }).catch(function () {});
    await http.listBroadcasts().catch(function () {});
    await http.broadcastAudience({ kind: 'subject', subject: 'Further Maths & Co' }).catch(function () {});
    await http.broadcastAudience({ kind: 'goc' }).catch(function () {});
    await http.deleteBroadcast(7).catch(function () {});
    await http.listMyBroadcasts().catch(function () {});
    var by = function (m, u) { return seen.filter(function (x) { return x.method === m && x.url.indexOf(u) > -1; })[0]; };
    ok('send is a POST to /broadcasts with the body', !!by('POST', '/broadcasts') && /Hello there/.test(by('POST', '/broadcasts').body));
    ok('list is a GET of /broadcasts', seen.some(function (x) { return x.method === 'GET' && /\/broadcasts$/.test(x.url); }));
    ok('audience carries kind and an encoded subject', seen.some(function (x) { return /\/broadcasts\/audience\?kind=subject&subject=Further%20Maths%20%26%20Co$/.test(x.url); }));
    ok('audience for "goc" carries no subject', seen.some(function (x) { return /\/broadcasts\/audience\?kind=goc$/.test(x.url); }));
    ok('delete is a DELETE of /broadcasts/7', !!by('DELETE', '/broadcasts/7'));
    ok('a student reads /me/broadcasts', seen.some(function (x) { return x.method === 'GET' && /\/me\/broadcasts$/.test(x.url); }));
  } else {
    /* The test sandbox has no fetch; the request shapes are covered end to end by test-broadcast-route.js. */
    console.log('  skip  request shapes (no fetch in the sandbox); covered by test-broadcast-route.js');
  }
  sandbox.fetch = real;

  head('the offline driver: who may use what');
  ok('nobody signed in is refused', !!(await rejects(mock.listBroadcasts())) && !!(await rejects(mock.listMyBroadcasts())));
  await mock.login('GOC-A-001', 'founder2027');
  ok('staff are refused until the console is unlocked', !!(await rejects(mock.sendBroadcast({ audience: { kind: 'goc' }, title: 'Hello there', body: 'A message long enough.' }))) && !!(await rejects(mock.broadcastAudience({ kind: 'goc' }))));
  ok('staff cannot use the student call', !!(await rejects(mock.listMyBroadcasts())));
  await mock.unlockConsole('2027');

  head('the offline driver: the same checks as the server');
  var good = { audience: { kind: 'subject', subject: 'Chemistry' }, title: 'Mock exam on Friday', body: 'ZQXBROADCAST The Chemistry mock holds on Friday at 10am.' };
  ok('a bad message is refused with the reason', /title/i.test(await rejects(mock.sendBroadcast({ audience: { kind: 'goc' }, title: 'x', body: 'y' }))));
  ok('a missing or unknown audience is refused', !!(await rejects(mock.sendBroadcast(Object.assign({}, good, { audience: null })))) && !!(await rejects(mock.sendBroadcast(Object.assign({}, good, { audience: { kind: 'open' } })))));
  ok('a bad audience count is refused', !!(await rejects(mock.broadcastAudience({ kind: 'everyone' }))) && !!(await rejects(mock.broadcastAudience({ kind: 'subject', subject: 'Latin' }))));
  ok('nothing was stored by the refused ones', (await mock.listBroadcasts()).count === 0);

  /* three students: an Open sign-up taking Chemistry, a GOC one taking Chemistry, a GOC one taking Biology */
  var openR = await activeStudent.demo(mock, { signupCode: CODE, name: 'Opal Open', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: CHEM });
  await mock.logout();
  await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027');
  var gocChem = await mock.addStudent({ name: 'Gina Goc', email: 'gina@example.com', phone: '08000000051', goal: 'JAMB / UTME 2027', subjects: CHEM, tier: 'goc' });
  var gocBio = await mock.addStudent({ name: 'Gabe Goc', email: 'gabe@example.com', phone: '08000000052', goal: 'JAMB / UTME 2027', subjects: BIO, tier: 'goc' });
  var chemId = gocChem.student.id, bioId = gocBio.student.id, openId = openR.student.id;

  head('the offline driver: audience count and sending');
  ok('all GOC students counts only the GOC ones', (await mock.broadcastAudience({ kind: 'goc' })).reached === 2);
  var c = await mock.broadcastAudience({ kind: 'subject', subject: 'Chemistry' });
  ok('one subject counts GOC students taking it, with a label', c.reached === 1 && c.label === 'Chemistry students');
  var p0 = await mock.sendBroadcast(Object.assign({ sentBy: 'forged', sentAt: 'forged', id: 9999, reached: 500 }, good));
  ok('the console sends a subject broadcast', p0.created === true && p0.broadcast.audienceLabel === 'Chemistry students');
  ok('forged sender, time, id and reach are ignored', p0.broadcast.sentBy === 'Ernest Uzorchukwu' && p0.broadcast.sentAt !== 'forged' && p0.broadcast.id !== 9999 && p0.broadcast.reached === 1);
  ok('the reminder is on by default', p0.broadcast.remind === true);
  var bid = p0.broadcast.id;
  var p1 = await mock.sendBroadcast({ audience: { kind: 'goc' }, title: 'Holiday notice', body: 'The academy is closed on Monday for the holiday.', remind: false });
  ok('an all-GOC one reaches both, reminder off', p1.broadcast.reached === 2 && p1.broadcast.remind === false);
  var list = await mock.listBroadcasts();
  ok('the console lists both, newest first, with sender and reach', list.count === 2 && list.broadcasts[0].title === 'Holiday notice' && list.broadcasts[1].reached === 1 && list.broadcasts[1].sentBy === 'Ernest Uzorchukwu');
  await mock.logout();

  head('the offline driver: who reads it');
  await mock.login(chemId, gocChem.temporaryPassword);
  var g1 = await mock.listMyBroadcasts();
  ok('a GOC Chemistry student sees both, newest first', g1.locked === false && g1.broadcasts.map(function (b) { return b.title; }).join('|') === 'Holiday notice|Mock exam on Friday');
  ok('it says "G.O.C Academy", never the staff name, audience or count', g1.broadcasts[0].from === 'G.O.C Academy' && JSON.stringify(g1).indexOf('Ernest') === -1 && JSON.stringify(g1).indexOf('audience') === -1 && JSON.stringify(g1).indexOf('reached') === -1);
  ok('staff-only calls are refused to a student', !!(await rejects(mock.listBroadcasts())) && !!(await rejects(mock.sendBroadcast(good))));
  await mock.logout();
  await mock.login(bioId, gocBio.temporaryPassword);
  ok('a GOC Biology student sees only the all-GOC one', (await mock.listMyBroadcasts()).broadcasts.map(function (b) { return b.title; }).join('|') === 'Holiday notice');
  await mock.logout();
  await mock.login(openId, 'secret123');
  var o1 = await mock.listMyBroadcasts();
  ok('an Open student sees nothing, locked, and no text', o1.locked === true && o1.broadcasts.length === 0 && JSON.stringify(o1).indexOf('ZQXBROADCAST') === -1);
  await mock.logout();

  head('the offline driver: tier change and removing');
  mock._setTier(openId, 'goc');
  await mock.login(openId, 'secret123');
  ok('Open made GOC now sees the messages for them', (await mock.listMyBroadcasts()).broadcasts.length === 2);
  await mock.logout();
  await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027');
  var d1 = await mock.deleteBroadcast(bid);
  ok('the console removes one', d1.ok === true && (await mock.listBroadcasts()).count === 1);
  ok('removing it twice is harmless', (await mock.deleteBroadcast(bid)).alreadyGone === true);
  await mock.logout();
  await mock.login(chemId, gocChem.temporaryPassword);
  ok('it is gone from the student at once', (await mock.listMyBroadcasts()).broadcasts.map(function (b) { return b.title; }).join() === 'Holiday notice');

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}
main().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
