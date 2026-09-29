/* Preloaded with `node -r` by test-media-stub.js. Sends every require of
   'node-appwrite' to the in-memory stand-in beside this file, even when the
   real package is installed in the project, so the test can never touch a
   live Appwrite project. */
'use strict';
var Module = require('module');
var path = require('path');
var STUB = path.join(__dirname, 'node-appwrite', 'index.js');
var orig = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'node-appwrite') return STUB;
  return orig.apply(this, arguments);
};
