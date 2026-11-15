/* Shared tutor login, unavailable-server handling and authenticated app handoff. */
'use strict';
var assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(APP, p), 'utf8'); }
var src = read('js/app.js'), apiSrc = read('js/api.js'), coreSrc = read('js/goc-core.js');
var loginSrc = src.slice(src.indexOf('var pendingTutor = null;'), src.indexOf('/* ===== Management preview ====='));
var passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  pass  ' + name); }
function response(status, type, body) {
  return { status: status, ok: status >= 200 && status < 300, headers: { get: function () { return type; } }, text: function () { return Promise.resolve(body); }, json: function () { return Promise.resolve(JSON.parse(body)); } };
}
function json(status, body) { return response(status, 'application/json; charset=utf-8', JSON.stringify(body)); }
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
var user = { id: 'GOC-T-001', name: 'Tutor', role: 'tutor', subjects: ['Physics'], mustChangePassword: false };
async function world(bootResponse) {
  var ids = ['loginId','loginPw','loginBtn','loginForm','tutorConnection','tutorConnectionTitle','tutorConnectionMessage','tutorRetry'];
  var els = {}, calls = [], queue = [], timers = [], opened = [], toasts = [], scripts = [];
  ids.forEach(function (id) { els[id] = { value: '', textContent: '', hidden: id === 'tutorConnection', disabled: false, dataset: {} }; });
  els.loginBtn.textContent = 'Log in'; els.tutorRetry.textContent = 'Retry Connection';
  var document = { getElementById: function (id) { return els[id]; }, createElement: function () { return {}; }, body: { appendChild: function (el) { scripts.push(el); if (el.onload) el.onload(); } } };
  var storage = { map: {}, getItem: function(k){return this.map[k] || null;}, setItem: function(k,v){this.map[k]=v;}, removeItem: function(k){delete this.map[k];} };
  var sandbox = { console: console, document: document, location: {protocol:'https:',href:'https://example.test/'}, navigator: {userAgent:'test'}, sessionStorage: storage,
    fetch: function (url, opts) {
      calls.push({ url: url, opts: opts });
      var r = queue.shift(); if (typeof r === 'function') return r();
      if (r instanceof Error) return Promise.reject(r);
      if (!r) throw new Error('unexpected request ' + url);
      return Promise.resolve(r);
    },
    toast: function (text) { toasts.push(text); }, setTimeout: function (f,ms) { timers.push(ms); }, clearTimeout:function(){}, Promise:Promise, JSON:JSON, Math:Math, Date:Date, String:String, Number:Number, Object:Object, Array:Array, Error:Error, encodeURIComponent:encodeURIComponent,
    URL: {createObjectURL:function(){return 'blob:test';},revokeObjectURL:function(){}}, Blob:function(){} };
  sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.__zxOpen = function (session) { opened.push(session); };
  queue.push(bootResponse || json(200, {service:'goc-academy-hub', version:1}));
  var ctx = vm.createContext(sandbox); vm.runInContext(coreSrc,ctx); vm.runInContext(apiSrc,ctx); vm.runInContext(loginSrc,ctx); await sandbox.GOC.api.ready;
  return { ctx:ctx, els:els, calls:calls, queue:queue, timers:timers, opened:opened, toasts:toasts, storage:storage, scripts:scripts,
    login:function(){els.loginId.value='GOC-T-001';els.loginPw.value='secret';return sandbox.login();}, retry:function(){return sandbox.retryTutorConnection();} };
}
(async function () {
  var w = await world(); w.queue.push(json(200,{token:'tok',user:user})); await w.login();
  ok('common login hands the verified session to the dashboard without a delivery gate',function(){assert.equal(w.calls[1].url,'api/auth/login');assert.equal(w.calls.length,2);assert.equal(w.opened.length,1);assert.equal(w.opened[0].token,'tok');assert.equal(w.opened[0].user.role,'tutor');});
  ok('tutor password and token are not stored in the browser',function(){assert.equal(w.els.loginPw.value,'');assert.deepEqual(w.storage.map,{});});
  w = await world(); w.queue.push(json(401,{error:'That ID and password do not match.'})); await w.login();
  ok('invalid credentials are shown normally',function(){assert.match(w.toasts.join(' '),/do not match/);assert.equal(w.opened.length,0);assert.equal(w.els.loginPw.value,'');});
  for (var status of [502,503,504]) {
    w = await world(); w.queue.push(response(status,'text/html','<html>Starting your app</html>')); await w.login();
    ok('HTML '+status+' shows waking message',function(){assert.equal(w.els.tutorConnectionTitle.textContent,'G.O.C is waking up');assert.match(w.els.tutorConnectionMessage.textContent,/Your tutor account is safe/);assert.equal(w.els.loginForm.hidden,true);assert.equal(w.opened.length,0);});
  }
  w = await world(); w.queue.push(new Error('network')); await w.login();
  ok('network failure is distinct',function(){assert.equal(w.els.tutorConnectionTitle.textContent,'Connection problem');});
  w = await world(); w.queue.push(json(503,{error:'Maintenance underway',maintenance:true})); await w.login();
  ok('maintenance JSON is distinct from waking',function(){assert.equal(w.els.tutorConnectionTitle.textContent,'G.O.C is under maintenance');assert.equal(w.els.tutorConnectionMessage.textContent,'Maintenance underway');});
  for (var bad of [response(200,'text/html','<html>wrong</html>'),response(200,'application/json','{broken'),json(200,{token:'x'}),response(401,'text/html','bad')]) {
    w=await world(); w.queue.push(bad); await w.login();
    ok('unexpected content never signs in',function(){assert.equal(w.els.tutorConnectionTitle.textContent,'Temporary service error');assert.equal(w.opened.length,0);});
  }
  w=await world(response(503,'text/html','wake')); w.queue.push(response(503,'text/html','wake')); await w.login();
  ok('even if startup probe failed, tutor login never falls back to demo',function(){assert.equal(w.calls[1].url,'api/auth/login');assert.equal(w.els.tutorConnectionTitle.textContent,'G.O.C is waking up');});
  ok('no automatic retries or timers are started',function(){assert.equal(w.calls.length,2);assert.equal(w.timers.length,0);});
  w.queue.push(response(503,'text/html','wake')); await w.retry();
  ok('manual failed retry sends one credential-free health check',function(){assert.equal(w.calls.length,3);assert.equal(w.calls[2].url,'api/health');assert.equal(w.calls[2].opts.body,undefined);assert.equal(w.timers.length,0);});
  w.queue.push(json(200,{service:'goc-academy-hub'})); await w.retry();
  ok('retry restores the form with ID and no password',function(){assert.equal(w.els.loginForm.hidden,false);assert.equal(w.els.loginId.value,'GOC-T-001');assert.equal(w.els.loginPw.value,'');assert.equal(w.opened.length,0);});
  w=await world(); var resolveLogin; w.queue.push(function(){return new Promise(function(resolve){resolveLogin=resolve;});}); var pending=w.login(); w.ctx.loginNow('GOC-T-001','secret'); await tick();
  ok('pending login cannot be submitted twice',function(){assert.equal(w.calls.length,2);}); resolveLogin(json(401,{error:'Invalid'})); await pending;
  w=await world(); w.queue.push(response(503,'text/html','wake')); await w.login(); var resolveProbe; w.queue.push(function(){return new Promise(function(resolve){resolveProbe=resolve;});}); var p=w.retry(); w.retry();
  ok('manual connection probes are single-flight',function(){assert.equal(w.calls.length,3);}); resolveProbe(json(200,{service:'goc-academy-hub'})); await p;
  var tutor = read('js/tutor-app.js'), fn = tutor.slice(tutor.indexOf('  function connectionError('),tutor.indexOf('\n\n  /* ------------------------------------------------------------------ styles */'));
  var tutorUrl; async function appCall(r) { return vm.runInNewContext(fn+'\ncall("GET", "/tutor/me")',{window:{GOC:{apiBase:'https://api.example/api'}},st:{token:'t'},fetch:function(url){tutorUrl=url;return Promise.resolve(r);},JSON:JSON,Promise:Promise}); }
  var result=await appCall(json(200,{tutor:{id:'GOC-T-001'}})); ok('tutor session JSON remains readable and uses configured API base',function(){assert.equal(result.tutor.id,'GOC-T-001');assert.equal(tutorUrl,'https://api.example/api/tutor/me');});
  try {await appCall(response(401,'text/html','bad')); assert.fail('expected error');} catch(e) {ok('HTML cannot falsely expire a tutor session',function(){assert.equal(e.status,undefined);});}
  try {await appCall(json(401,{error:'Please sign in again.'})); assert.fail('expected error');} catch(e) {ok('verified JSON session refusal expires a tutor session',function(){assert.equal(e.status,401);});}
  console.log('\n'+passed+' passed, 0 failed');
})().catch(function(e){console.error(e.stack || e);process.exitCode=1;});
