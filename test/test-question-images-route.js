/* test-question-images-route.js — Phase 3, question images, slice 2b: upload, serve and link checks.
   Boots a throwaway server, signs a student up, saves questions on one token,
   reads them back on a fresh login (the "other phone"), and checks the guards:
   duplicates, removal, validation, isolation between students, auth.
   No dependencies; run:  node test/test-bookmarks.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var activeStudent = require('./active-student.js');
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8152;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-qimg-test-'));
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
var skipped = 0;
function okU(name, cond, extra, r) { if (r && r.skipped) { skipped++; console.log('  skip  ' + name); } else ok(name, cond, extra); }
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function HAS_BUSBOY_GLOBAL() { return HAS_BUSBOY; }
function upload(token, name, type, buf) {
  if (!HAS_BUSBOY_GLOBAL()) return Promise.resolve({ status: 0, body: {}, raw: 'skipped', skipped: true });
  return new Promise(function (resolve, reject) {
    var b = 'XXBOUNDARYXX';
    var pre = Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + type + '\r\n\r\n');
    var post = Buffer.from('\r\n--' + b + '--\r\n');
    var body = Buffer.concat([pre, buf, post]);
    var req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/admin/question-images', method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + b, 'Content-Length': body.length, 'Authorization': 'Bearer ' + token } }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function fetchBin(url, token) {
  return new Promise(function (resolve, reject) {
    var h = token ? { Authorization: 'Bearer ' + token } : {};
    http.get({ host: '127.0.0.1', port: PORT, path: url, headers: h }, function (res) {
      var chunks = []; res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }); });
    }).on('error', reject);
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
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


var HAS_BUSBOY = (function () { try { require.resolve('busboy', { paths: [APP, path.join(APP, 'node_modules')] }); return true; } catch (e) { return false; } })();
if (!HAS_BUSBOY) console.log('NOTE: busboy is not installed here, so the upload steps are skipped; run npm install to cover them.');
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);
var signup = { signupCode: SIGNUP, name: 'Ada Test', password: 'secret123',
  email: 'ada.img@example.com', phone: '08000000019', goal: 'JAMB / UTME 2027',
  subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
function Q(extra) { return Object.assign({ subject: 'Physics', section: 'practice', kind: 'objective', topic: 'Electricity', text: 'In the circuit shown, what is the total resistance?',
  options: ['2 ohm', '4 ohm', '6 ohm', '8 ohm'], answer: 1, explanation: 'Series sum.', imageAlt: 'A circuit with two resistors in series' }, extra || {}); }

(function main() {
  waitForBoot(40).then(function () {
    head('Question pictures — upload, serve, link checks (slice 2b)');
    var adm, stu, imgId;
    return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' }).then(function (r) {
      adm = r.body && r.body.token; ok('console signs in', !!adm, r.raw);
      return call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    }).then(function () { return activeStudent(call, signup, adm); }).then(function (r) {
      stu = r.token; ok('a student signs up', !!stu, r.signup && r.signup.raw);
      return upload(stu, 'a.png', 'image/png', PNG);
    }).then(function (r) {
      okU('a student cannot upload a picture', r.status === 403, r.status, r);
      return upload(adm, 'circuit.png', 'image/png', PNG);
    }).then(function (r) {
      okU('the console can upload a PNG', r.status === 200 && /^QIMG-[0-9a-f]{16}$/.test(r.body.imageId) && r.body.bytes === PNG.length, r.raw, r);
      if (r.skipped) {
        imgId = 'QIMG-0123456789abcdef';
        fs.mkdirSync(path.join(SANDBOX, 'server', 'question-images'), { recursive: true });
        fs.writeFileSync(path.join(SANDBOX, 'server', 'question-images', imgId + '.png'), PNG);
      } else imgId = r.body.imageId;
      return upload(adm, 'x.png', 'image/png', Buffer.from('<?php echo 1; ?> not an image at all'));
    }).then(function (r) {
      okU('a file that is not really a PNG is refused', r.status === 400 && /real PNG/.test(r.body.error), r.raw, r);
      return upload(adm, 'x.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'));
    }).then(function (r) {
      okU('an SVG is refused', r.status === 400, r.raw, r);
      return upload(adm, 'big.png', 'image/png', Buffer.concat([PNG, Buffer.alloc(2 * 1048576)]));
    }).then(function (r) {
      okU('a picture over 2 MB is refused', r.status === 400 && /too large/.test(r.body.error), r.raw, r);
      return upload(adm, 'a.jpg', 'image/png', PNG);
    }).then(function (r) {
      okU('a name that disagrees with the type is refused', r.status === 400, r.raw, r);
      return fetchBin('/api/question-images/' + imgId, stu);
    }).then(function (r) {
      ok('a student can read the picture, with the right type and bytes', r.status === 200 && r.headers['content-type'] === 'image/png' && r.buf.equals(PNG));
      ok('it is served nosniff and inline', r.headers['x-content-type-options'] === 'nosniff' && r.headers['content-disposition'] === 'inline');
      return fetchBin('/api/question-images/' + imgId, null);
    }).then(function (r) {
      ok('someone not signed in cannot read it', r.status === 401, r.status);
      return fetchBin('/api/question-images/QIMG-ffffffffffffffff', stu);
    }).then(function (r) {
      ok('an id that was never issued is a 404', r.status === 404);
      return fetchBin('/api/question-images/..%2F..%2Fdata.json', stu);
    }).then(function (r) {
      ok('a path-escape attempt finds nothing', r.status === 404 && r.buf.toString().indexOf('"students"') === -1);
      return call('POST', '/api/questions', Q({ imageId: 'QIMG-ffffffffffffffff' }), adm);
    }).then(function (r) {
      ok('a question naming a missing picture is refused', r.status === 400 && /not on the server/.test(r.body.error), r.raw);
      return call('POST', '/api/questions', Q({ imageId: imgId, imageAlt: '' }), adm);
    }).then(function (r) {
      ok('a picture without a description is refused', r.status === 400 && /Describe/.test(r.body.error), r.raw);
      return call('POST', '/api/questions', Q({ imageId: imgId }), adm);
    }).then(function (r) {
      ok('a question with a real picture is saved with it', r.status === 200 && r.body.imageId === imgId && r.body.imageAlt.length > 5, r.raw);
      var qid = r.body.id;
      return call('PUT', '/api/questions/' + qid, { imageId: 'QIMG-eeeeeeeeeeeeeeee' }, adm).then(function (e) {
        ok('editing a question to a missing picture is refused', e.status === 400 && /not on the server/.test(e.body.error), e.raw);
        return call('PUT', '/api/questions/' + qid, { imageId: '', imageAlt: '' }, adm);
      }).then(function (u) {
        ok('a picture can be removed from a question', u.status === 200 && u.body.imageId === null && u.body.imageAlt === '', u.raw);
      });
    }).then(function () {
      console.log('\n' + passes + ' passed, ' + fails + ' failed' + (skipped ? ', ' + skipped + ' skipped (no busboy)' : ''));
      stop(); process.exit(fails ? 1 : 0);
    });
  }).catch(function (e) {
    console.log('THREW: ' + e.message); console.log(serverLog); stop(); process.exit(1);
  });
})();
