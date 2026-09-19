/* run.js — runs every suite in this folder and reports once.
   node test/run.js   (no dependencies, no build step) */
'use strict';
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var suites = ['test-rules.js', 'test-p1.js', 'test-p2.js', 'test-p6.js', 'test-p3.js', 'test-p4.js', 'test-p78.js',
              'test-p9.js', 'test-p10.js', 'test-study.js', 'test-study-window.js', 'test-math.js', 'test-launch.js',
              'test-server.js', 'test-persist.js', 'test-security.js', 'test-driver-parity.js', 'test-contact.js',
              'test-landing-motion.js', 'test-landing-motion-3.js'];
var failed = [];

suites.forEach(function (s) {
  console.log('\n════ ' + s + ' ' + new Array(Math.max(2, 60 - s.length)).join('═'));
  var r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
});

console.log('\n════ summary ' + new Array(48).join('═'));
suites.forEach(function (s) {
  console.log((failed.indexOf(s) > -1 ? '  FAILED  ' : '  passed  ') + s);
});
process.exit(failed.length ? 1 : 0);
