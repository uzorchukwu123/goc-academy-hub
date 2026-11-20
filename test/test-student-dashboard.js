/* test-student-dashboard.js — Phase 3: the redesigned Student Home Dashboard.

   Pins the contract the approved reference and the owner's decisions set:
     · the sections of the design are present, in order, on one Home screen;
     · the student navigation offers the reference's items, mapped to existing
       screens only; JAMB CBT is visible but "Not open yet" and Question Bank,
       Study Plan, Support and Settings are "Coming soon" — shown, never wired;
     · the phone bottom bar is Home, Study, Practice, Results, More;
     · no retired feature comes back (Next Activity, Guardian PIN, Timetable,
       Web Test, video, Open Students, the Examinations entry);
     · no figure from the reference image ships in the markup;
     · the dashboard's own logic: unread notifications, the newest announcement,
       Continue Learning's subject and topic, Overall Performance's honest
       "Not assessed yet", and the menu sheet built from the sidebar.

   node test/test-student-dashboard.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var home = (function () { var a = html.indexOf('<section class="screen pad db-home" id="home"'); return html.slice(a, html.indexOf('<!-- ============ STUDY HUB', a)); })();
var nav = (function () { var a = html.indexOf('<nav class="tabbar" id="tabbar"'); return html.slice(a, html.indexOf('</nav>', a)); })();

head('the design\'s sections, in order');
var order = ['class="db-head"', 'id="tut-hero"', 'id="dbStats"', 'id="dbContinue"', 'db-plan', 'id="tut-jump"', 'id="dbAnnounce"'];
ok('header, banner, statistics, Continue Learning, My Study Plan, Quick Access, Announcements',
  order.every(function (k, i) { return home.indexOf(k) > -1 && (i === 0 || home.indexOf(k) > home.indexOf(order[i - 1])); }));
ok('the page title reads Student Dashboard', /<h1 class="db-title" id="dbTitle">Student Dashboard<\/h1>/.test(home));
ok('the banner carries the approved welcome line', home.indexOf('Stay consistent, learn deeply and build your UTME advantage.') > -1);
ok('the three statistics are Academy XP, Study Streak and Overall Performance',
  /Academy XP/.test(home) && /Study Streak/.test(home) && /Overall Performance/.test(home));
ok('Quick Access offers JAMB CBT, Practice, Resources and Question Bank, in that order', (function () {
  var q = home.slice(home.indexOf('id="tut-jump"'));
  var i = ['<b>JAMB CBT</b>', '<b>Practice</b>', '<b>Resources</b>', '<b>Question Bank</b>'].map(function (k) { return q.indexOf(k); });
  return i.every(function (x, n) { return x > -1 && (n === 0 || x > i[n - 1]); });
})());
ok('the phone top bar has the menu, the logo, notifications and the avatar',
  /class="db-mtop"/.test(home) && /aria-label="Open menu"/.test(home) && /class="db-mlogo"/.test(home) && /id="dbAvaM"/.test(home));

head('no figure ships in the markup');
ok('the reference\'s example figures (2,480 XP, 5 Days, 78%, 3 of 5 goals, 60%) are not in Home',
  !/2,480|5 Days|78%|3 of 5|60%/.test(home));
ok('every statistic starts as a dash until the account is read',
  /id="dashXp">—</.test(home) && /id="dashStreak">—</.test(home) && /id="dashPerf">—</.test(home) && /id="dashLevel">Level —</.test(home));
ok('no student name ships in the markup', !/Ernest|Jesusanusi|Ada Okafor/.test(home) && /id="dbUserName">Loading…</.test(home));
ok('no announcement ships in the markup', /id="dbAnnText">Loading announcements…</.test(home) && !/New study materials/.test(home));
ok('My Study Plan shows no invented goals or progress', /db-plan is-soon/.test(home) && /<div class="db-bar" aria-hidden="true"><span style="width:0"><\/span><\/div>/.test(home));

head('navigation: existing screens only, and honest about the rest');
function tabs() { return nav.match(/<button type="button" class="tab[^"]*"[^>]*>/g) || []; }
function tabFor(t) { return tabs().filter(function (b) { return b.indexOf('data-t="' + t + '"') > -1; })[0] || ''; }
ok('the sidebar order follows the reference',
  ['home', 'study', 'practice', 'jamb', 'results', 'resources', 'qbank', 'plan', 'league', 'support', 'profile', 'settings', 'logout']
    .every(function (t, i, a) { return nav.indexOf('data-t="' + t + '"') > -1 && (i === 0 || nav.indexOf('data-t="' + t + '"') > nav.indexOf('data-t="' + a[i - 1] + '"')); }));
ok('live items go to existing screens',
  /onclick="go\('home'\)"/.test(tabFor('home')) && /onclick="go\('study'\)"/.test(tabFor('study')) && /onclick="openPractice\(\)"/.test(tabFor('practice')) &&
  /onclick="openResults\(\)"/.test(tabFor('results')) && /onclick="go\('resources'\)"/.test(tabFor('resources')) && /onclick="go\('league'\)"/.test(tabFor('league')) &&
  /onclick="go\('profile'\)"/.test(tabFor('profile')) && /onclick="logout\(\)"/.test(tabFor('logout')));
['jamb', 'qbank', 'plan', 'support', 'settings'].forEach(function (t) {
  ok(t + ' is shown as not open, with no action', /class="tab is-soon"/.test(tabFor(t)) && /aria-disabled="true"/.test(tabFor(t)) && !/onclick=/.test(tabFor(t)), tabFor(t));
});
ok('JAMB CBT says Not open yet; the others say Coming soon',
  /id="tbSoon-jamb"><span class="tb-tag-l">Not open yet<\/span>/.test(nav) &&
  ['qbank', 'plan', 'support', 'settings'].every(function (t) { return new RegExp('id="tbSoon-' + t + '"><span class="tb-tag-l">Coming soon</span>').test(nav); }));
ok('the dormant JAMB CBT is not reactivated anywhere on Home', !/jambStart\(|jambConfirmStart\(|openCBT\(|cbtOpenPaper\(/.test(home + nav));
ok('the not-open Quick Access tiles are not buttons', (home.match(/<div class="db-q is-soon" role="group"/g) || []).length === 2 &&
  !/<button[^>]*class="db-q is-soon"/.test(home));
ok('the phone bottom bar is Home, Study, Practice, Results, More', (function () {
  var m = tabs().filter(function (b) { return / tb-m/.test(b); }).map(function (b) { return /data-t="([a-z]+)"/.exec(b)[1]; });
  return m.join() === 'home,study,practice,results,more';
})());
ok('More opens the full menu sheet', /data-t="more" onclick="navSheetOpen\(this\)"/.test(nav) && /id="navSheet" role="dialog" aria-modal="true"/.test(html));
ok('the desktop sidebar has the red curved decoration', /class="tb-curve"/.test(nav));

head('retired features stay retired');
ok('no Next Activity, Guardian PIN, Timetable, Web Test or video entry on Home or in the navigation',
  !/dashNext|Waiting for you|Guardian|guardianPin|go\('timetable'\)|Timetable|openWebTest|Web Test|go\('classes'\)|Lesson videos|go\('videos'\)/.test(home + nav));
ok('no Examinations entry (the reference shows one; the Web Test it would open is retired)', !/Examinations/.test(home + nav));
ok('no Open Student, tier or tier-switch wording', !/Open Student|tier/i.test(home + nav));
ok('the retired Home panels are gone (journey, ID card, standing, last result)',
  !/id="jnPath"|id="idStrip"|id="dashStand"|id="dashLast"|id="focusRing"/.test(html) && app.indexOf('function paintJourney(') < 0);

head('accessibility');
ok('every icon-only button has an accessible name',
  (home.match(/<button[^>]*class="db-icbtn[^"]*"[^>]*>/g) || []).every(function (b) { return /aria-label="/.test(b); }));
ok('popovers and the sheet are announced as what they are',
  /id="dbNotif" role="dialog" aria-label="Notifications"/.test(home) && /id="dbAcctMenu" role="menu"/.test(home) && /role="menuitem"/.test(home));
ok('openers say what they control and whether it is open', /aria-controls="dbNotif" aria-expanded="false"/.test(home) && /aria-controls="dbAcctMenu" aria-expanded="false"/.test(home));
ok('focus is always visible on the dashboard and the navigation', /\.db-home :focus-visible,\.tabbar :focus-visible,\.nav-sheet :focus-visible\{/.test(css));
ok('decorative art is hidden from assistive technology',
  /<svg class="db-bn-svg"[^>]*aria-hidden="true"/.test(home) && /<svg class="db-laurel"[^>]*aria-hidden="true"/.test(home) && /<svg class="db-cont-svg"[^>]*aria-hidden="true"/.test(home));

head('responsive rules');
ok('a phone layout, a tablet layout from 640px and the desktop sidebar from 900px',
  /@media \(min-width:640px\)\{\n  \.db\{/.test(css) && /@media \(min-width:900px\)\{\n  \.db-mtop\{display:none\}/.test(css));
ok('the bottom bar hides every item that is not a phone item', /\.tabbar \.side-brand,\.tabbar \.tb-curve,\.tabbar \.tab:not\(\.tb-m\)\{display:none\}/.test(css));
ok('More is hidden on the desktop sidebar', /\.tabbar \.tb-more\{display:none!important\}/.test(css));

/* ------------------------------------------------------------ behaviour ---- */
head('the dashboard\'s own logic');
var block = app.slice(app.indexOf('/* ================= STUDENT HOME DASHBOARD (Phase 3) ================='), app.indexOf('/* Help & tutorial (Stage 6)'));
ok('the dashboard module is found', block.length > 2000);
function el(id) {
  return { id: id, textContent: '', hidden: false, innerHTML: '', attrs: {}, classList: { toggle: function () {}, contains: function () { return false; } },
    setAttribute: function (k, v) { this.attrs[k] = v; }, getAttribute: function (k) { return this.attrs[k]; }, hasAttribute: function (k) { return k in this.attrs; },
    querySelector: function () { return this._dot || null; }, querySelectorAll: function () { return []; } };
}
var els = {}, store = {}, bells = [];
['dbNotifEmpty', 'dbAnnText', 'dbAnnBtn', 'dbContSub', 'dbContLbl', 'dashPerf', 'dashPerfNote', 'dbNotif', 'dbAcctMenu', 'navSheet', 'navScrim', 'navSheetList', 'home'].forEach(function (k) { els[k] = el(k); });
var bell = el('bell'); bell._dot = { hidden: true }; bells.push(bell);
var calls = [];
var ctx = vm.createContext({
  console: console, Promise: Promise, Date: Date, Math: Math, isFinite: isFinite, Number: Number, String: String, Array: Array, Object: Object,
  setTimeout: function (f) { f(); },
  localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
  document: { getElementById: function (id) { return els[id] || null; }, querySelectorAll: function (s) { return s === '.db-bell' ? bells : []; }, addEventListener: function () {} },
  list: function (x) { return Array.prototype.slice.call(x); },
  lgPct: function (v) { return Math.round(v) + '%'; },
  studentId: 'GOC-S-001', pracHistCache: [], dashBroadcastsAll: [], dashNoticesAll: [], dashBroadcastsOpen: false,
  loadPracHistory: function () { return []; }, refreshPracHistory: function () { return Promise.resolve(); },
  dashBroadcastsRender: function () {}, openStudySet: function (m, s) { calls.push('openStudySet:' + m + ':' + s); }, openPractice: function () { calls.push('openPractice'); },
  GOC: { api: {} }
});
vm.runInContext(block, ctx);
function run(src) { return vm.runInContext(src, ctx); }

/* notifications: what is new is remembered per student on this device */
run("dashBroadcastsAll = [{ title: 'Older', body: 'a', at: '2026-11-01T10:00:00Z' }, { title: 'Newest', body: 'New study materials are up.', at: '2026-11-17T10:00:00Z' }]; dashNoticesAll = [{ title: 'Lab moved', body: 'b', at: '2026-11-10T09:00:00Z' }]; dbAnnLoaded = true;");
run('dbNotifRefresh()');
ok('unread items light the bell and say how many', bell._dot.hidden === false && bell.attrs['aria-label'] === 'Notifications, 3 new', JSON.stringify(bell.attrs));
ok('the announcement is the newest academy broadcast, whatever the list order', els.dbAnnText.textContent === 'Newest — New study materials are up.' && els.dbAnnBtn.hidden === false, els.dbAnnText.textContent);
run('dbMarkSeen()');
ok('opening the panel marks them seen on this device only', bell._dot.hidden === true && store['goc.notifSeen.GOC-S-001'] === String(Date.parse('2026-11-17T10:00:00Z')));
ok('nothing is written for another student', Object.keys(store).length === 1);
run("dashNoticesAll.push({ title: 'Later', body: 'c', at: '2026-11-18T08:00:00Z' }); dbNotifRefresh();");
ok('a newer item lights the bell again', bell._dot.hidden === false && bell.attrs['aria-label'] === 'Notifications, 1 new');
run("dashBroadcastsAll = []; dashNoticesAll = []; dbNotifRefresh();");
ok('no messages: an honest empty state, and no announcement to view',
  els.dbNotifEmpty.hidden === false && /no notifications yet/.test(els.dbNotifEmpty.textContent) && els.dbAnnText.textContent === 'No announcements from the academy yet.' && els.dbAnnBtn.hidden === true);
run("dbAnnFailed = true; dbNotifFailed = true; dbNotifRefresh();");
ok('a failed load says so rather than showing nothing', /could not be loaded/.test(els.dbAnnText.textContent) && /could not be loaded/.test(els.dbNotifEmpty.textContent));

/* Continue Learning */
run("pracHistCache = [{ subject: 'Mathematics', review: [{ topic: 'Indices' }, { topic: 'Quadratic Equations' }, { topic: 'Quadratic Equations' }] }, { subject: 'Physics', review: [] }]; dbRenderContinue();");
ok('Continue Learning names the newest run\'s subject and its main topic', els.dbContSub.textContent === 'Resume: Mathematics – Quadratic Equations' && els.dbContLbl.textContent === 'Continue Studying', els.dbContSub.textContent);
run('dbContinue()');
ok('and resumes practice in that subject', calls.pop() === 'openStudySet:practice:Mathematics');
run("pracHistCache = []; dbRenderContinue(); dbContinue();");
ok('with no run yet it says so and opens the Practice set-up', /not finished a practice run yet/.test(els.dbContSub.textContent) && els.dbContLbl.textContent === 'Start Practising' && calls.pop() === 'openPractice');

/* Overall Performance */
(async function () {
  ctx.GOC.api.league = function () { return Promise.resolve({ me: { assessed: 3, performance: 64.4 } }); };
  run('dbPaintPerformance()'); await new Promise(function (r) { setImmediate(r); });
  ok('Overall Performance is the league\'s assessed figure', els.dashPerf.textContent === '64%' && els.dashPerfNote.textContent === '', els.dashPerf.textContent);
  ctx.GOC.api.league = function () { return Promise.resolve({ me: { assessed: 0, performance: 0 } }); };
  run('dbPaintPerformance()'); await new Promise(function (r) { setImmediate(r); });
  ok('with no assessed paper it says Not assessed yet instead of 0%', els.dashPerf.textContent === '—' && els.dashPerfNote.textContent === 'Not assessed yet');
  ctx.GOC.api.league = function () { return Promise.reject(new Error('offline')); };
  run('dbPaintPerformance()'); await new Promise(function (r) { setImmediate(r); });
  ok('when the league cannot be read it says so', els.dashPerf.textContent === '—' && els.dashPerfNote.textContent === 'Unavailable right now');

  head('identity and sign-out');
  ok('the header shows the account\'s own name and initial', /set\('dbUserName', isStaff \? 'Management' : name\)/.test(app) && /set\('dbAva', ini\); set\('dbAvaM', ini\);/.test(app));
  ok('the level and streak come from the account', /set\('dashLevel', 'Level ' \+ \(me\.level \|\| 1\)\)/.test(app) && /set\('dashStreak', days \+ \(days === 1 \? ' Day' : ' Days'\)\)/.test(app));
  ok('signing out blanks the dashboard and resets its state', /'dashPerf','dbUserName','dbAva','dbAvaM'\]/.test(app) && /if\(typeof dbReset === 'function'\) dbReset\(\);/.test(app));
  ok('leaving Home closes any open panel or menu', /if\(typeof dbPopClose === 'function'\) dbPopClose\(true\);\n  if\(typeof navSheetClose === 'function'\) navSheetClose\(\);/.test(app));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
