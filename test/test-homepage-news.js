/* test-homepage-news.js — Stage 9: public homepage structure + announcements.

   Proves the landing carries clear, labelled paths for every audience
   (programmes, updates, scholarships, contact, Try GOC), that the
   "Latest announcements" block renders the SAME public feed as the
   Updates & News screen (top 3, summarised, category deep-link), and
   that no guided-tour overlay attaches to the public homepage.
   Run:  node test/test-homepage-news.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}

head('clear information architecture on the landing');
[['Programmes', "dwGoTo('lpTiers')"], ['Updates & News', "go('updates')"], ['Try GOC free', "dwGoTo('lpTry')"], ['Get started', "go('signup')"], ['Log in', "go('login-v2')"]].forEach(function (pair) {
  ok('top nav offers “' + pair[0] + '”', index.indexOf(pair[0]) >= 0 && index.indexOf(pair[1]) >= 0);
});
ok('the hero offers the free preview beside sign-up', /onclick="dwGoTo\('lpTry'\)">Try a free practice session<\/button>/.test(index));
ok('the drawer carries the same labelled paths', /Try GOC — free practice/.test(index) && />Programmes<\/button>/.test(index) && /About G\.O\.C<\/button>/.test(index));
ok('About and the Independent Scholars System are labelled in plain words',
  /About G\.O\.C Academy Hub/.test(index) && /The Independent Scholars System/.test(index));
ok('the Try GOC section makes the free, anonymous offer plainly',
  /id="lpTry"/.test(index) && /Free JAMB Practice Preview/.test(index) && /no account, no name, no email needed/i.test(index)
  && /not official JAMB questions/i.test(index) && /onclick="demoOpen\(\)"/.test(index));
ok('parents, schools and partners are addressed by label', /id="lpParents"/.test(index) && /Parents, schools &amp; partners/.test(index));
ok('announcements have a prominent home on the landing', /id="lpNewsList"/.test(index) && /Updates &amp; News/.test(index));
ok('existing sections survive (subjects, tiers, scholarship, contact, footer)',
  /id="lpSubjects"/.test(index) && /id="lpTiers"/.test(index) && /id="lpScholarship"/.test(index) && /id="contact"/.test(index) && /lp-foot/.test(index));
ok('the landing announcements grid adapts (1 column mobile, 3 desktop)',
  /\.lp-news-list\{[^}]*display:grid/.test(css) && /@media \(min-width:720px\)\{ \.lp-news-list\{ grid-template-columns:repeat\(3,1fr\)/.test(css));
ok('no onboarding overlay attaches to the public homepage',
  !/landing[\s\S]{0,200}GOCOnboarding|maybeAutoStart\('student'[\s\S]{0,80}landing/.test(index + app)
  && /maybeAutoStart\('student', studentId\)/.test(app));

head('one feed, two presentations');
var host = { innerHTML: '' };
var nav = [];
var sandbox = {
  document: { getElementById: function (id) { return id === 'lpNewsList' ? host : null; } },
  esc: function (s) { return String(s == null ? '' : s); },
  go: function (id) { nav.push(id); },
  renderUpdates: function () { sandbox._rendered = true; }
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var updatesData = [], upActiveFilter = "all";\n' + grab('lpSummary') + '\n' + grab('renderLpNews') + '\n' + grab('lpNewsOpen'), ctx);

sandbox.updatesData = [];
sandbox.renderLpNews();
ok('an empty feed says so plainly', /No announcements yet/.test(host.innerHTML), host.innerHTML);
sandbox.updatesData = [
  { cat: 'utme', date: 'Nov 2026', title: 'UTME registration dates', body: 'x'.repeat(300) },
  { cat: 'news', date: 'Nov 2026', title: 'New tutors join', body: 'Short body.' },
  { cat: 'scholarship', date: 'Oct 2026', title: 'Scholarship places', body: 'Apply now.' },
  { cat: 'admission', date: 'Oct 2026', title: 'Fourth story', body: 'Should not appear on the landing.' }
];
sandbox.renderLpNews();
ok('only the top three announcements appear', (host.innerHTML.match(/lp-news-card/g) || []).length === 3 && !/Fourth story/.test(host.innerHTML));
ok('each card carries headline, date, category and a summary', /UTME registration dates/.test(host.innerHTML) && /Nov 2026/.test(host.innerHTML)
  && />UTME</.test(host.innerHTML) && /…/.test(host.innerHTML) && host.innerHTML.indexOf('x'.repeat(200)) < 0);
ok('Read more deep-links to the Updates screen filtered by category', /lpNewsOpen\('utme'\)/.test(host.innerHTML));
sandbox.lpNewsOpen('scholarship');
ok('following a card opens Updates on that category', nav.join() === 'updates' && sandbox.upActiveFilter === 'scholarship' && sandbox._rendered === true);
ok('the landing renderer reuses the one public feed (no second store)',
  /listUpdates\(\)\.then\(function\(rows\)\{\s*\n\s*updatesData = rows \|\| \[\];\s*\n\s*renderUpdates\(\);\s*\n\s*renderLpNews\(\);/.test(app)
  && !/lpNews(S|t)ore|localStorage.*news/i.test(app));
ok('a failed feed load explains itself on the landing too', /Announcements could not be loaded right now/.test(app));

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'homepage news: all checks passed'));
process.exit(fails ? 1 : 0);
