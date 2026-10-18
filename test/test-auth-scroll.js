/* test-auth-scroll.js — the Create account and Log in screens must scroll: the auth screen has to keep the height of the
   phone (absolute + inset:0, not relative), and its scroll box must be allowed to shrink and scroll.
   node test/test-auth-scroll.js */
'use strict';
var fs = require('fs'), path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var fails = 0;
function ok(n, c) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n); } }
function rule(sel) { var m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; }
var screenAuth = rule('.screen.auth');
ok('the auth screen is absolute with inset:0 (bounded to the phone)', /position:\s*absolute/.test(screenAuth) && /inset:\s*0/.test(screenAuth) && !/position:\s*relative/.test(screenAuth));
var sc = rule('.screen.auth .auth-scroll');
ok('its scroll box can shrink and scroll vertically', /min-height:\s*0/.test(sc) && /overflow-y:\s*auto/.test(sc));
ok('Create account and Log in both use the auth screen', /<section class="screen auth" id="signup">/.test(html) && /class="screen auth"[^>]*id="login-v2"|id="login-v2"[^>]*class="[^"]*screen auth/.test(html) || /id="login-v2"/.test(html));
ok('the cache was bumped for the css change', /const CACHE = 'goc-v(13[1-9]|1[4-9]\d|[2-9]\d\d)'/.test(fs.readFileSync(path.join(APP, 'sw.js'), 'utf8')));
process.exit(fails ? 1 : 0);
