/* test-reminders-route.js — Phase 2, Reminders: the student's switches
   (GET/POST /api/me/reminders), the one-tap opt-out link, and a real sweep
   inside a running server (dry-run: messages land in reminders-outbox.jsonl).
   node test/test-reminders-route.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8161;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-reminders-route-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw, headers: res.headers }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return sleep(250).then(function () { return waitForBoot(tries - 1); });
  });
}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP,
    GOC_PUBLIC_URL: 'https://hub.example.test', GOC_REMINDER_DRY_RUN: '1',
    GOC_REMINDER_HOURS: '0-24', GOC_REMINDER_INTERVAL_MIN: '0.02'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

var DATA = path.join(SANDBOX, 'server', 'data.json');
var OUTBOX = path.join(SANDBOX, 'server', 'reminders-outbox.jsonl');
function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return core.dayStamp(d); }
function patchStudent(id, fields) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  Object.assign(db.students.filter(function (s) { return s.id === id; })[0], fields);
  fs.writeFileSync(DATA, JSON.stringify(db));
}
function outbox() {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}
function waitForMail(n, ms) {
  var t0 = Date.now();
  function poll() {
    if (outbox().length >= n || Date.now() - t0 > ms) return Promise.resolve(outbox());
    return sleep(200).then(poll);
  }
  return poll();
}
function mk(name, email) {
  return { signupCode: SIGNUP, name: name, password: 'secret123', email: email, phone: '08000000009',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
}

(function main() {
  var tokA, tokB, idA, idB;
  waitForBoot(40).then(function () {
    head('Study reminders — the switches');
    ok('the server announces the schedule at boot', /study reminders: checking every/.test(serverLog) && /DRY RUN/.test(serverLog), serverLog.slice(-300));
    return call('GET', '/api/me/reminders').then(function (r) {
      ok('GET without a login is refused', r.status === 401 || r.status === 403, String(r.status));
      return call('POST', '/api/me/reminders', { email: false });
    }).then(function (r) {
      ok('POST without a login is refused', r.status === 401 || r.status === 403, String(r.status));
      return activeStudent.signedUp(call, mk('Ada Test', 'ada.test@example.com'));
    }).then(function (r) {
      tokA = r.body.token; idA = r.body.student ? r.body.student.id : (r.body.id || 'GOC-S-001');
      return activeStudent.signedUp(call, mk('Bola Test', 'bola.test@example.com'));
    }).then(function (r) {
      tokB = r.body.token; idB = r.body.student ? r.body.student.id : (r.body.id || 'GOC-S-002');
      return call('GET', '/api/me/reminders', undefined, tokA);
    }).then(function (r) {
      var v = r.body && r.body.reminders;
      ok('a new student is opted IN by default (email on, SMS off)', r.status === 200 && v.email === true && v.sms === false, r.raw);
      ok('it knows an address and a number are held', v.hasEmail === true && v.hasPhone === true, r.raw);
      ok('and that email can really be delivered here, SMS cannot', v.deliverable.email === true && v.deliverable.sms === false, r.raw);
      return call('POST', '/api/me/reminders', {}, tokA);
    }).then(function (r) {
      ok('an empty change is refused', r.status === 400, r.raw);
      return call('POST', '/api/me/reminders', { email: 'no' }, tokA);
    }).then(function (r) {
      ok('a non-boolean is refused', r.status === 400, r.raw);
      return call('POST', '/api/me/reminders', { sms: 1 }, tokA);
    }).then(function (r) {
      ok('a number is not a boolean either', r.status === 400, r.raw);
      return call('POST', '/api/me/reminders', { email: false }, tokA);
    }).then(function (r) {
      ok('switching email off works and returns the new state', r.status === 200 && r.body.reminders.email === false && r.body.reminders.sms === false, r.raw);
      return call('GET', '/api/me/reminders', undefined, tokA);
    }).then(function (r) {
      ok('and it stays off', r.body.reminders.email === false);
      return call('GET', '/api/me/reminders', undefined, tokB);
    }).then(function (r) {
      ok('another student is not affected', r.body.reminders.email === true);
      return call('POST', '/api/me/reminders', { email: true, sms: true }, tokA);
    }).then(function (r) {
      ok('both can be changed at once', r.body.reminders.email === true && r.body.reminders.sms === true, r.raw);
      return call('POST', '/api/me/reminders', { sms: false, extra: 'x', xp: 9999 }, tokA);
    }).then(function (r) {
      ok('unknown fields are ignored', r.status === 200 && r.body.reminders.sms === false && r.body.reminders.email === true, r.raw);
      return call('GET', '/api/me', undefined, tokA);
    }).then(function (r) {
      ok('nothing else on the student changed (XP untouched)', r.body.xp === 0, r.raw);

      head('A real sweep inside the server');
      ok('nothing has been mailed yet', outbox().length === 0);
      patchStudent(idA, { streak: 3, streakDay: daysAgo(1) });
      patchStudent(idB, { streak: 5, streakDay: daysAgo(1) });
      return call('POST', '/api/me/reminders', { email: false }, tokB);
    }).then(function () {
      return waitForMail(1, 9000);
    }).then(function (box) {
      ok('the opted-in student with a streak at risk is emailed', box.length >= 1 && box.some(function (m) { return m.to === 'ada.test@example.com'; }), JSON.stringify(box.map(function (m) { return m.to; })));
      ok('the opted-out student is not', !box.some(function (m) { return m.to === 'bola.test@example.com'; }));
      var m = box.filter(function (x) { return x.to === 'ada.test@example.com'; })[0] || { text: '', subject: '' };
      ok('the subject names the 3-day streak', /3 days streak ends tonight/.test(m.subject), m.subject);
      var found = /https:\/\/hub\.example\.test(\/api\/unsubscribe\?id=[^&\s]+&t=[0-9a-f]{32})/.exec(m.text);
      ok('the message carries a working-looking opt-out link', !!found, m.text);
      return sleep(3500).then(function () {
        ok('and she is mailed once, however often the server looks', outbox().filter(function (x) { return x.to === 'ada.test@example.com'; }).length === 1,
          String(outbox().length));
        ok('(the server logged the send)', /reminders: 1 sent/.test(serverLog), serverLog.slice(-300));
        return found && found[1];
      });
    }).then(function (link) {
      head('One-tap opt-out');
      return call('GET', link).then(function (r) {
        ok('opening the link needs no login and says it worked', r.status === 200 && /Reminders turned off/.test(r.raw), r.raw.slice(0, 200));
        ok('it is a page, not JSON, and is not cached', /text\/html/.test(r.headers['content-type']) && r.headers['cache-control'] === 'no-store');
        return call('GET', '/api/me/reminders', undefined, tokA);
      }).then(function (r) {
        ok('the student\'s switch is now off', r.body.reminders.email === false, r.raw);
        return call('GET', link + '&back=1');
      }).then(function (r) {
        ok('the page offered a way back, and it works', r.status === 200 && /back on/.test(r.raw));
        return call('GET', '/api/me/reminders', undefined, tokA);
      }).then(function (r) {
        ok('switch is on again', r.body.reminders.email === true);
        var bad = link.replace(/t=[0-9a-f]{32}/, 't=' + new Array(33).join('0'));
        return call('GET', bad);
      }).then(function (r) {
        ok('a wrong token is refused and reveals nothing', r.status === 404 && /no longer valid/.test(r.raw) && r.raw.indexOf('Ada') === -1, r.raw.slice(0, 160));
        return call('GET', '/api/unsubscribe?id=GOC-S-999&t=' + new Array(33).join('a'));
      }).then(function (r) {
        ok('an unknown scholar is refused the same way', r.status === 404);
        return call('GET', '/api/unsubscribe?id=' + encodeURIComponent('../x') + '&t=zz');
      }).then(function (r) {
        ok('a malformed id/token is refused, not crashed on', r.status === 404);
        return call('GET', '/api/unsubscribe');
      }).then(function (r) {
        ok('no parameters at all: refused', r.status === 404);
        return call('GET', '/api/health');
      }).then(function (r) {
        ok('the server is still up', r.status === 200);
      });
    }).then(function () {
      console.log('\n' + passes + ' passed, ' + fails + ' failed');
      stop();
      process.exit(fails ? 1 : 0);
    });
  }).catch(function (e) {
    console.log('THREW: ' + (e && e.stack || e));
    console.log(serverLog);
    stop();
    process.exit(1);
  });
})();
