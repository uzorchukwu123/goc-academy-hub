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
check('hero clipping guard is scoped to the homepage, not every app screen', !/\.screen\s*>\s*\*\s*\{\s*flex-shrink:\s*0;/.test(css));
check('original homepage sections remain present', ['lpFeatures', 'lpSubjects', 'lpHow', 'contact'].every((id) => html.includes('id="' + id + '"')));
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
