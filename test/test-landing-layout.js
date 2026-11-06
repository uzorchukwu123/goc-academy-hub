/* Homepage layout regression: the fixed-height flex screen shell must not clip
   the landing hero or logo strip on mobile. The original design/spacing stays in
   css/styles.css; this only guards the intrinsic height of homepage sections. */
'use strict';
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function check(name, ok) { if (ok) { pass++; console.log('PASS [' + name + ']'); } else { fail++; console.log('FAIL [' + name + ']'); } }
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('landing children keep their intrinsic height in the flex screen shell', /#landing\s*>\s*\*\s*\{\s*flex-shrink:\s*0;\s*\}/.test(css));
check('hero keeps its original headline', /Raising Smart Scholars for Academic Excellence/.test(html));
/* Corrected contract: the obsolete bootcamp CTA is removed from the markup
   outright (not hidden with CSS), the existing-account action is preserved,
   and a direct CBT Portal entry sits beside it. */
check('the obsolete bootcamp sign-up CTA is completely removed from the page', !/start free utme bootcamp/i.test(html));
check('no bootcamp CTA route survives in the homepage hero', !/hero-btns[\s\S]{0,600}Bootcamp/.test(html));
check('"I already have an account" is preserved on the homepage', /I already have an account/.test(html));
check('a direct CBT Portal action is present in the hero', /class="lp-btn-light hero-cbt" onclick="freeCbtPortal\(\)">CBT Portal</.test(html));
check('the hero CBT action does not route through signup or registration', !/hero-cbt" onclick="go\('signup'\)/.test(html) && !/hero-cbt" onclick="freeHomeCta\(\)/.test(html));
check('the CBT exam screen has both Back and Back to Home controls', /onclick="freeExamLeave\(\)"/.test(html) && /onclick="freeExamHome\(\)"/.test(html));
/* Owner correction: the original student registration and login experience must
   coexist with the CBT Portal entry. Nothing may hide or reroute it. */
const f27css = fs.readFileSync(path.join(__dirname, '..', 'css', 'free2027.css'), 'utf8').replace(/\s+/g, ' ');
check('the original hero signup route is intact', /hero-original-cta" onclick="go\('signup'\)"/.test(html));
check('the original hero login route is intact', /class="lp-btn-ghost" onclick="go\('login-v2'\)"/.test(html));
check('the original nav Log in / Get started are intact', /class="lp-link dw-original" onclick="go\('login-v2'\)"/.test(html) && /class="lp-cta dw-original" onclick="go\('signup'\)"/.test(html));
check('the original drawer Create free account / Log in are intact', /dw-original" onclick="dwGo\('signup'\)"/.test(html) && /dw-original" onclick="dwGo\('login-v2'\)"/.test(html));
check('no stylesheet rule hides any original account action', !/\.dw-original \{ display: none/.test(f27css) && !/\.hero-original-cta \{ display: none/.test(f27css));
check('the original registration and login screens render in Free Tutorial Mode', /body\.f27-mode #signup\.active/.test(f27css) && /body\.f27-mode #login-v2\.active/.test(f27css));
check('the original post-login student area renders in Free Tutorial Mode', /body\.f27-mode #home\.active/.test(f27css) && /body\.f27-mode #profile\.active/.test(f27css));
check('hero clipping guard is scoped to the homepage, not every app screen', !/\.screen\s*>\s*\*\s*\{\s*flex-shrink:\s*0;/.test(css));
check('original homepage sections remain present', ['lpFeatures', 'lpSubjects', 'lpHow', 'contact'].every((id) => html.includes('id="' + id + '"')));
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
