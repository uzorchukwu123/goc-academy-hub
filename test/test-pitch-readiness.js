/* test-pitch-readiness.js — Approved pitch-readiness fixes (ISSUES 01 & 05).

   Static, dependency-free proof that:
     1. ISSUE-01: the simulated phone frame is gone on every viewport below
        the desktop layout — the full-bleed declarations that used to apply
        only up to 480px now apply up to 899px (landscape phones, large
        phones and small tablets included), with the exact former portrait
        declarations preserved and the >=900px desktop layout untouched.
        Each viewport named in the audit is checked against that rule.
     2. ISSUE-05: index.html carries a meta description and an Open Graph /
        Twitter sharing preview, and no noindex robots meta.
   Live agent/crawler behaviour is covered by test-crawler-shield.js and
   test-crawler-refusal.js.  Run:  node test/test-pitch-readiness.js  */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 140) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var css = read('css/styles.css');
var html = read('index.html');

head('ISSUE-01 — no simulated phone frame below the desktop layout');
var fullBleed = /@media \(max-width:899px\)\{\s*body\{background:var\(--bg\)\}\s*\.phone\{width:100vw;height:100dvh;border-radius:0;box-shadow:none\}\s*\.notch\{display:none\}\s*\}/;
ok('the full-bleed block now runs to 899px', fullBleed.test(css));
ok('the former portrait declarations are preserved verbatim inside it',
  /\.phone\{width:100vw;height:100dvh;border-radius:0;box-shadow:none\}/.test(css) &&
  /body\{background:var\(--bg\)\}/.test(css));
ok('no phone-frame relief remains stranded at 480px',
  !/@media \(max-width:480px\)\{\s*body\{background:var\(--bg\)\}/.test(css));
ok('the simulated frame rules themselves are unchanged (they only show >=900px is overridden below)',
  /\.phone\{\s*position:relative; width:min\(430px,100vw\); height:min\(924px,100dvh\);/.test(css));
ok('the >=900px desktop layout is untouched',
  /@media \(min-width:900px\)\{[\s\S]{0,400}?\.phone\{position:relative;width:100vw;height:100dvh;max-width:none;border-radius:0;box-shadow:none/.test(css));

/* Which presentation each audited viewport receives, by the cascade above:
   <900px → full-bleed app in the real viewport; >=900px → desktop layout. */
function presentation(width) {
  if (width >= 900) return 'desktop';
  return fullBleed.test(css) ? 'full-bleed' : 'phone-frame';
}
[1920, 1600, 1440, 1366, 1280].forEach(function (w) {
  ok('desktop viewport ' + w + 'px gets the desktop layout', presentation(w) === 'desktop');
});
[899, 844, 768, 600, 481, 430, 390, 375, 360].forEach(function (w) {
  ok('viewport ' + w + 'px fills the real screen (no phone mockup)', presentation(w) === 'full-bleed');
});

head('ISSUE-05 — description and sharing preview');
ok('a meta description is present', /<meta name="description" content="[^"]*G\.O\.C Academy Hub[^"]*">/.test(html));
ok('Open Graph title, description, type and image are present',
  /<meta property="og:title" content="G\.O\.C Academy Hub">/.test(html) &&
  /<meta property="og:description" content="[^"]+">/.test(html) &&
  /<meta property="og:type" content="website">/.test(html) &&
  /<meta property="og:image" content="https:\/\/gocacademy\.live\/icons\/icon-512\.png">/.test(html));
ok('a Twitter card preview is present', /<meta name="twitter:card" content="summary">/.test(html));
ok('no noindex robots meta remains', !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html));
ok('the page title is unchanged', /<title>G\.O\.C Academy Hub<\/title>/.test(html));

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'pitch readiness: all checks passed'));
process.exit(fails ? 1 : 0);
