/* test-migration-api-config.js — Appwrite Sites/Functions migration, Phase A.
   ---------------------------------------------------------------------------
   Guards the ONE API base decision point and both hosting builds:

     • OneBit (GOC_API_BASE unset) must keep the existing relative 'api' base,
       so every current request path and the current deployment are unchanged.
     • Appwrite Sites (GOC_API_BASE set) must route all four choke points at the
       Function base, with no per-module host strings.
     • A malformed GOC_API_BASE must be refused rather than silently built.
     • The static build must never carry server secrets or production data.
     • The service worker must never cache authenticated API responses.

   No network, no Appwrite project, no production data. Builds go to a temp dir. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS [' + name + ']'); }
  else { fail++; console.log('FAIL [' + name + ']' + (detail ? ' — ' + detail : '')); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const api = read('js/api.js');
const f27api = read('js/free2027-api.js');
const f27ui = read('js/free2027-ui.js');
const build = read('build/build.js');
const sw = read('sw.js');

/* ---------------------------------------------------- the single decision point */
console.log('\n— central configuration —');
const assign = api.match(/GOC\.apiBase\s*=\s*[\s\S]*?:\s*'api';/);
check('js/api.js decides GOC.apiBase exactly once', !!assign && (api.match(/GOC\.apiBase\s*=/g) || []).length === 1);

function evalBase(injected) {
  const sandbox = { GOC: {} };
  if (injected !== undefined) sandbox.__GOC_API_BASE__ = injected;
  vm.runInNewContext('var GOC = this.GOC;' + assign[0], sandbox);
  return sandbox.GOC.apiBase;
}
check('unset injection keeps the OneBit relative base', evalBase(undefined) === 'api', evalBase(undefined));
check('empty injection keeps the OneBit relative base', evalBase('') === 'api');
check('injected Function base is used verbatim',
  evalBase('https://fn.appwrite.global/api') === 'https://fn.appwrite.global/api');
check('trailing slashes are normalised off the injected base',
  evalBase('https://fn.appwrite.global/api///') === 'https://fn.appwrite.global/api');

/* ------------------------------------------------------- all four choke points */
console.log('\n— choke points route through the config —');
check('choke 1: http driver base reads GOC.apiBase', /var base = GOC\.apiBase;/.test(api));
check('choke 1: no literal base remains in the http driver', !/var base = 'api';/.test(api));
check('choke 2: api.js health probe uses GOC.apiBase', /fetch\(GOC\.apiBase \+ '\/health'/.test(api));
check('choke 3: free2027-api uses GOC.apiBase', /GOC\.apiBase\)\s*\|\|\s*'api'\)\s*\+\s*'\/free2027'/.test(f27api));
check('choke 4: free2027-ui health probe uses GOC.apiBase', /GOC\.apiBase\)\s*\|\|\s*'api'\)\s*\+\s*'\/health'/.test(f27ui));
check('no hardcoded relative api/free2027 fetch survives', !/fetch\('api\/free2027'/.test(f27api));
check('no hardcoded relative api/health fetch survives',
  !/fetch\('api\/health'/.test(api) && !/fetch\('api\/health'/.test(f27ui));
/* Strip comments first: js/api.js documents an EXAMPLE Function URL in a comment,
   which is documentation, not a hardcoded host. The assertion is about code. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
check('feature modules hardcode no appwrite host in executable code',
  !/appwrite\.global/.test(codeOnly(f27api)) &&
  !/appwrite\.global/.test(codeOnly(f27ui)) &&
  !/appwrite\.global/.test(codeOnly(api)));
check('index.html needed no change (api.js loads before the free2027 modules)',
  (function () {
    const h = read('index.html');
    return h.indexOf('src="js/api.js"') < h.indexOf('src="js/free2027-api.js"')
        && h.indexOf('src="js/api.js"') < h.indexOf('src="js/free2027-ui.js"');
  })());

/* ------------------------------------------------------------- build integration */
console.log('\n— build integration —');
check('build.js injects via esbuild define', /define:\s*JS_DEFINE/.test(build));
check('build.js reads GOC_API_BASE from the environment', /process\.env\.GOC_API_BASE/.test(build));
check('build.js validates the injected base', /must be an absolute http/.test(build));
check('build.js still defaults its output to dist', /process\.argv\[2\]\s*\|\|\s*'dist'/.test(build));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mig-build-'));
function buildTo(dir, env) {
  const out = path.join(tmp, dir);
  execFileSync(process.execPath, [path.join(ROOT, 'build', 'build.js'), out], {
    cwd: ROOT, env: Object.assign({}, process.env, env || {}), stdio: 'pipe'
  });
  return out;
}
let onebit = null, appwrite = null;
try {
  const e = Object.assign({}, process.env); delete e.GOC_API_BASE;
  onebit = buildTo('onebit', e);
  check('OneBit build succeeds', fs.existsSync(path.join(onebit, 'index.html')));
  const obApi = fs.readFileSync(path.join(onebit, 'js', 'api.js'), 'utf8');
  check('OneBit build injects no Function host', !/appwrite\.global/.test(obApi));
  check('OneBit build keeps the relative api fallback', /"api"|'api'/.test(obApi));

  appwrite = buildTo('appwrite', { GOC_API_BASE: 'https://unit-test-fn.appwrite.global/api' });
  const awApi = fs.readFileSync(path.join(appwrite, 'js', 'api.js'), 'utf8');
  check('Appwrite build injects the Function base', awApi.includes('https://unit-test-fn.appwrite.global/api'));
  check('Appwrite build still emits the service worker', fs.existsSync(path.join(appwrite, 'sw.js')));
  check('Appwrite build still emits the manifest', fs.existsSync(path.join(appwrite, 'manifest.webmanifest')));
  check('Appwrite build emits the free2027 modules',
    fs.existsSync(path.join(appwrite, 'js', 'free2027-api.js')) &&
    fs.existsSync(path.join(appwrite, 'js', 'free2027-ui.js')));
} catch (e) {
  check('both hosting builds complete', false, e.message);
}

let refused = false;
try {
  execFileSync(process.execPath, [path.join(ROOT, 'build', 'build.js'), path.join(tmp, 'bad')], {
    cwd: ROOT, env: Object.assign({}, process.env, { GOC_API_BASE: 'not-a-url' }), stdio: 'pipe'
  });
} catch (e) { refused = e.status === 1; }
check('a malformed GOC_API_BASE refuses the build', refused);

/* --------------------------------------------------- no secrets / data in build */
console.log('\n— build hygiene —');
function walk(dir, base, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  });
  return out;
}
if (appwrite) {
  const files = walk(appwrite, '', []);
  check('build contains no .env file', !files.some(f => /(^|\/)\.env/.test(f)));
  check('build contains no data.json', !files.some(f => /(^|\/)data\.json/.test(f)));
  check('build contains no server directory', !files.some(f => f.startsWith('server/')));
  check('build contains no backups or logs', !files.some(f => /\.(bak|log|pem|key)$/.test(f)));
  const js = files.filter(f => /\.(js|mjs)$/.test(f))
    .map(f => fs.readFileSync(path.join(appwrite, f), 'utf8')).join('\n');
  check('build carries no Appwrite server API key variable', !/APPWRITE_API_KEY/.test(js));
  check('build carries no SMTP credential variable', !/GOC_SMTP_PASS|GOC_SMTP_USER/.test(js));
  check('build carries no OTP signing secret variable', !/GOC_FREE_2027_OTP_SECRET/.test(js));
  check('build carries no founder/academic password variable', !/GOC_FOUNDER_PW|GOC_ACADDIR_PW/.test(js));
}

/* ------------------------------------------------------------------- PWA safety */
console.log('\n— PWA —');
check('service worker never writes API responses to a cache', !/cache\.put|caches\.open\([^)]*\)\.then\([^)]*put/.test(sw));
check('service worker only pre-caches the declared static asset list',
  /const ASSETS = \[/.test(sw) && /caches\.open\(CACHE\)\.then\(c => c\.addAll\(ASSETS\)\)/.test(sw));
check('service worker passes non-GET requests straight through', /e\.request\.method !== 'GET'/.test(sw));
check('service worker cache name is untouched by the migration', /const CACHE = 'goc-v220';/.test(sw));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
