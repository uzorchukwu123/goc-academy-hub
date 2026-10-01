/* test-vercel-readonly.js — the Vercel handler must load and serve /api/health
   on a read-only filesystem without ever writing server/data.json, and must
   answer 503 (not fall back to disk) when Appwrite cannot initialise.
   Offline: node-appwrite is stubbed; every data.json write is made to throw EROFS. */
'use strict';
var path = require('path');
var os = require('os');
var spawnSync = require('child_process').spawnSync;

var APP = path.join(__dirname, '..');
var child = [
  "var fs=require('fs'),Module=require('module'),path=require('path');",
  "var writes=[];",
  "['writeFileSync','renameSync','copyFileSync'].forEach(function(n){var o=fs[n];fs[n]=function(){",
  "  var a=String(arguments[0])+' '+String(arguments[1]);",
  "  if(/data\\.json/.test(a)){writes.push(n+' '+a);var e=new Error('EROFS: read-only file system, open '+arguments[0]);e.code='EROFS';throw e;}",
  "  return o.apply(fs,arguments);};});",
  "var uploads=0;",
  "var realLoad=Module._load;Module._load=function(id){if(id==='node-appwrite'){",
  "  function C(){}['setEndpoint','setProject','setKey'].forEach(function(m){C.prototype[m]=function(){return this;};});",
  "  function St(){}St.prototype.getFileDownload=function(){var e=new Error('not found');e.code=404;return Promise.reject(e);};",
  "  St.prototype.deleteFile=function(){return Promise.resolve();};St.prototype.createFile=function(){uploads++;return Promise.resolve();};",
  "  function D(){}function U(){}",
  "  return {Client:C,Storage:St,Databases:D,Users:U,Query:{limit:function(){return '';}}};}",
  "  return realLoad.apply(this,arguments);};",
  "var handler=require(" + JSON.stringify(path.join(APP, 'server', 'server.js')) + ");",
  "function call(url){return new Promise(function(ok){var out={status:0,body:''};",
  "  var res={writeHead:function(s){out.status=s;},setHeader:function(){},end:function(b){out.body=String(b||'');ok(out);},write:function(b){out.body+=String(b);}};",
  "  var req={url:url,method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'},on:function(ev,cb){if(ev==='end')setImmediate(cb);return req;},connection:{remoteAddress:'127.0.0.1'}};",
  "  handler(req,res);});}",
  "call('/api/health').then(function(r){",
  "  console.log(JSON.stringify({status:r.status,body:r.body,writeAttempts:writes,exists:fs.existsSync(process.env.GOC_DATA_DIR+'/data.json')}));process.exit(0);});"
].join('\n');

function run(env) {
  var r = spawnSync(process.execPath, ['-e', child], {
    env: Object.assign({ PATH: process.env.PATH, VERCEL: '1', GOC_DATA_DIR: path.join(os.tmpdir(), 'goc-vercel-ro-' + process.pid) }, env),
    encoding: 'utf8', timeout: 30000 });
  var line = (r.stdout || '').trim().split('\n').pop();
  try { return JSON.parse(line); } catch (e) { return { parseError: (r.stdout || '') + (r.stderr || '') }; }
}

var failed = 0;
function check(name, ok, extra) { console.log('  ' + (ok ? 'pass' : 'FAIL') + '  ' + name + (ok ? '' : '  ' + extra)); if (!ok) failed++; }
console.log('\ntest-vercel-readonly.js');

var good = run({ APPWRITE_ENDPOINT: 'https://example.invalid/v1', APPWRITE_PROJECT_ID: 'p', APPWRITE_API_KEY: 'k' });
check('Vercel + Appwrite configured: /api/health is 200', good.status === 200, JSON.stringify(good));
check('Vercel startup never attempts to write data.json', good.writeAttempts && good.writeAttempts.length === 0, JSON.stringify(good));
check('data.json is not created on Vercel', good.exists === false, JSON.stringify(good));

var bad = run({});
check('Vercel + Appwrite not configured: 503, no disk fallback', bad.status === 503 && bad.writeAttempts && bad.writeAttempts.length === 0 && bad.exists === false, JSON.stringify(bad));

console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
