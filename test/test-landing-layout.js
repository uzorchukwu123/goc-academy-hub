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
check('hero keeps its original content and calls to action', /Raising Smart Scholars for Academic Excellence/.test(html) && /Start free UTME Bootcamp/.test(html) && /I already have an account/.test(html));
check('hero clipping guard is scoped to the homepage, not every app screen', !/\.screen\s*>\s*\*\s*\{\s*flex-shrink:\s*0;/.test(css));
check('original homepage sections remain present', ['lpFeatures', 'lpSubjects', 'lpHow', 'contact'].every((id) => html.includes('id="' + id + '"')));
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
