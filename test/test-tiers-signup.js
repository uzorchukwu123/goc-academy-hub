/* test-tiers-signup.js — Phase 3B: the sign-up screen explains Open vs GOC, and what it says matches the
   tier table in js/goc-core.js, so tuning the table cannot leave the page telling a student something false.
   node test/test-tiers-signup.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }

var si = html.indexOf('id="signup"'), sEnd = html.indexOf('</section>', si);
var screen = html.slice(si, sEnd);
var ti = screen.indexOf('id="tierCompare"');
var panel = ti < 0 ? '' : screen.slice(ti, screen.indexOf('</details>', ti));
var open = panel.slice(panel.indexOf('tc-card open'), panel.indexOf('tc-card goc'));
var goc = panel.slice(panel.indexOf('tc-card goc'));
var text = function (s) { return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '); };

console.log('\nthe panel');
ok('it is on the sign-up screen, above the form, collapsed by default', ti > 0 && ti < screen.indexOf('<form') && !/id="tierCompare"[^>]*\bopen\b/.test(screen));
ok('it has an Open card and a GOC card', open.length > 0 && goc.length > 0);
ok('it says this sign-up gives an Open account, and that GOC means asking the academy', /gives you an <b>Open<\/b> account/.test(panel) && /ask the academy/.test(panel));
ok('it adds no field and no script to the form', panel.indexOf('<input') < 0 && panel.indexOf('<script') < 0 && panel.indexOf('onclick') < 0);

console.log('\nwhat it says matches the tier table');
var L = core.tierLimits('open'), F = core.tierFeatures('open'), G = core.tierFeatures('goc');
ok('Open: ' + L.notesPerSubject + ' notes per subject', new RegExp('first ' + L.notesPerSubject + ' notes').test(text(open)));
ok('Open: ' + L.reviewsPerDay + ' reviews a day', new RegExp(L.reviewsPerDay + ' spaced reviews a day').test(text(open)));
ok('Open: ' + L.bookmarks + ' saved questions', new RegExp(L.bookmarks + ' saved questions').test(text(open)));
ok('Open: practice and past questions are unlimited, as the table says',
   L.practicePerDay === null && L.practiceRunMax === null && L.pastYears === 'all' && /Unlimited practice and past questions/.test(text(open)));
ok('Open: the JAMB-oriented test is offered, as the table says', F.jambMock === true && /JAMB-oriented test/.test(text(open)));
ok('Open: resource downloads are offered, as the table says', F.resourceDownload === true && /Resource downloads/.test(text(open)));
ok('Open: nothing is promised that the table refuses', !/Web Test|live class|video|replay|streak/i.test(text(open)) && F.webTestObjective === false && F.videos === false && F.liveClassJoin === false);
ok('GOC: Objective and Theory Web Tests', G.webTestObjective && G.webTestTheory && /Objective and Theory Web Tests/.test(text(goc)));
ok('GOC: live classes, videos and replays', G.liveClassJoin && G.videos && G.classRecordings && /Live classes, lesson videos and class replays/.test(text(goc)));
ok('GOC: in-app resource viewing and streak freezes', G.resourceView && G.streakFreezes && /Read resources in the app/.test(text(goc)) && /streak freezes/.test(text(goc)));
var GL = core.tierLimits('goc');
ok('GOC: no limit on reviews, saved questions or notes, as the table says', GL.reviewsPerDay === null && GL.bookmarks === null && GL.notesPerSubject === null && /unlimited reviews and saved questions/.test(text(goc)));

console.log('\nthe landing page copy (slice 5)');
var li = html.indexOf('id="lpTiers"'), lEnd = html.indexOf('</section>', li);
var land = html.slice(li, html.indexOf('lpHow', li) > li ? html.indexOf('lpHow', li) : lEnd);
var lcards = land.slice(land.indexOf('<div class="tc-grid">'), land.indexOf('<p class="tc-note">'));
var scards = panel.slice(panel.indexOf('<div class="tc-grid">'), panel.indexOf('<p class="tc-note">'));
var lnote = (land.match(/<p class="tc-note">[\s\S]*?<\/p>/) || [''])[0];
var snote = (panel.match(/<p class="tc-note">[\s\S]*?<\/p>/) || [''])[0];
var norm = function (x) { return text(x).trim(); };
ok('the landing page has the tier section', li > 0 && land.indexOf('tc-card open') > 0 && land.indexOf('tc-card goc') > 0);
ok('the two cards read exactly as they do on the sign-up screen', lcards.length > 0 && norm(lcards) === norm(scards));
ok('the note about asking the academy is identical', lnote.length > 0 && norm(lnote) === norm(snote));
ok('it has a Create account button that goes to sign-up', /onclick="go\('signup'\)"[^>]*>\s*Create account/.test(land));
ok('it sits before the contact section', li > 0 && li < html.indexOf('id="contact"'));
ok('it names no price (the decision is: ask the academy)', !/N8|₦|\u20A6|8,000|per month|\/month/i.test(text(land)));
var lo = land.slice(land.indexOf('tc-card open'), land.indexOf('tc-card goc')), lg = land.slice(land.indexOf('tc-card goc'));
ok('landing Open card matches the table', new RegExp('first ' + L.notesPerSubject + ' notes').test(text(lo)) && new RegExp(L.reviewsPerDay + ' spaced reviews a day').test(text(lo)) && new RegExp(L.bookmarks + ' saved questions').test(text(lo)));
ok('landing GOC card matches the table', G.webTestObjective && G.liveClassJoin && /Objective and Theory Web Tests/.test(text(lg)) && /Live classes, lesson videos and class replays/.test(text(lg)));
ok('landing styles exist', /\.landing-tiers\b/.test(css));

console.log('\nstyle and release');
ok('the panel has styles', /\.tier-compare\b/.test(css) && /\.tc-card\.goc\b/.test(css));
var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
ok('the service worker cache was bumped past v110', Number((sw.match(/goc-v(\d+)/) || [])[1]) >= 111);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
