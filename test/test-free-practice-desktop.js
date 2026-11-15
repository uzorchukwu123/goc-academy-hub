/* test-free-practice-desktop.js — the free preview's desktop layout.

   The anonymous preview shares #cbt with student practice, so this suite pins
   the desktop-only workspace rules: the question column uses the available
   width, the existing #cbtNav palette moves beside it, the action bar stays
   visible, and the pre-exam card starts beneath its header instead of floating
   in the middle of a blank viewport.

   Run:  node test/test-free-practice-desktop.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var index = read('index.html');
var css = read('css/styles.css');
var app = read('js/app.js');
var sw = read('sw.js');
var passed = 0, failed = 0;
function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '   (' + String(detail).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function block(selector) {
  var i = css.indexOf(selector);
  if (i < 0) return '';
  var j = css.indexOf('{', i);
  var depth = 0;
  for (var k = j; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}') { depth--; if (!depth) return css.slice(i, k + 1); }
  }
  return '';
}
var desktop = css.slice(css.indexOf('DESKTOP FREE PRACTICE / CBT RUNNER'));

head('pre-exam page begins beneath its header');
var pre = (css.match(/#demo \.demo-pre\{[^}]*\}/) || [''])[0];
ok('the introduction is no longer vertically centred', /align-items:flex-start/.test(pre) && !/align-items:center/.test(pre), pre);
ok('the card starts at a natural padding instead of a negative offset',
  /padding:18px 16px/.test(pre) && !/margin-top:\s*-/.test(pre));
ok('only the middle area can scroll on a very short screen',
  /overflow-y:auto/.test(pre) && /#demo\.demo-screen\{\s*overflow:hidden/.test(css));
ok('the card is not clipped by a fixed maximum height',
  !/#demo \.demo-card\{[^}]*max-height:100%/.test(css));
ok('desktop gives the card breathing room without recentring it',
  block('@media (min-width:900px)').length > 0 && /#demo \.demo-card\{ max-width:720px/.test(css));

head('desktop CBT uses the available workspace');
ok('the runner is a two-column grid with a bounded question column',
  /#cbt:not\(\.jamb-mode\)\{[^}]*display:grid/.test(desktop)
  && /grid-template-columns:minmax\(0,1fr\) 320px/.test(desktop));
ok('the question area owns the left column', /\.exam-body\{[^}]*grid-column:1/.test(desktop));
ok('the question navigator owns the right column', /#cbtNav\{[^}]*grid-column:2/.test(desktop));
ok('the navigator is visible despite its mobile hidden attribute',
  /#cbtNav\{[^}]*display:grid!important/.test(desktop));
ok('the action bar spans the workspace and stays at the bottom',
  /\.exam-bar\{[^}]*grid-column:1 \/ -1[^}]*grid-row:4/.test(desktop));
ok('the question typography is larger on desktop', /font-size:clamp\(21px,2vw,27px\)/.test(desktop));
ok('answer options have larger, consistent touch targets',
  /\.exam-opts \.opt\{[^}]*min-height:56px[^}]*font-size:16px/.test(desktop));
ok('the desktop reading measure stays bounded on very wide screens',
  /@media \(min-width:1500px\)/.test(desktop) && /calc\(\(100% - 980px\)\/2\)/.test(desktop));
ok('authenticated practice also escapes the narrow reading column',
  /\.phone:not\(\.is-login\) #cbt > \*\{ max-width:none/.test(desktop));

head('question navigation and controls use the existing runner');
ok('the navigator keeps its accessible name', /id="cbtNav" aria-label="Question navigator"/.test(index));
ok('the navigator is still populated by buildCBTNav()', /function buildCBTNav\(\)/.test(app)
  && /buildCBTNav\(\); renderCBTQ\(\); startTimer\(\);/.test(app));
ok('Prev, Next and Submit remain the existing controls',
  /onclick="cbtMove\(-1\)"/.test(index) && /onclick="cbtMove\(1\)"/.test(index)
  && /onclick="submitCBT\(\)"/.test(index));
ok('the palette is not a second engine: it reuses the existing .qn buttons',
  /b\.className='qn'/.test(app) && /#cbt:not\(\.jamb-mode\) > #cbtNav \.qn\{/.test(desktop));

head('mobile practice is untouched');
ok('the base runner is still the fixed flex layout',
  /\.exam-screen\{[^}]*display:flex[^}]*height:100%[^}]*overflow:hidden/.test(css));
ok('the desktop grid is inside a min-width:900px media query',
  /@media \(min-width:900px\)\{[\s\S]*#cbt:not\(\.jamb-mode\)\{/.test(desktop));
ok('the mobile navigator remains hidden until the Q-panel is opened',
  /id="cbtNav" aria-label="Question navigator" style="display:none"/.test(index));
ok('no fixed desktop width can create horizontal overflow',
  !/#cbt:not\(\.jamb-mode\)\{[^}]*width:\s*\d+px/.test(desktop));

head('stale shell caching is addressed');
ok('the service-worker cache version was bumped for this release',
  /const CACHE = 'goc-v22[4-9]'/.test(sw), sw.match(/const CACHE = '[^']+'/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
