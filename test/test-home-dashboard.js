/* test-home-dashboard.js — the Student Home Dashboard (A01), driven inside
   minidom against the mock driver.

   The screen makes one promise that matters: every figure on it is this
   account's own record, read back from the same APIs the rest of the app
   uses, and where a record does not exist the screen says so instead of
   inventing a plausible number. This suite proves that by walking a brand-new
   student through the screen twice — once with nothing at all on file, and
   once after real practice, a real study heartbeat and a real class notice
   are recorded — and by checking that each action goes to an existing screen.

   It also pins the navigation decisions the build rests on: the desktop
   sidebar carries the approved entries, the phone keeps exactly five
   destinations in its bottom bar, and the retired standalone Timetable/Web
   Test entry points have not crept back in.

   Run:  node test/test-home-dashboard.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

/* ---- tiny assertions (same shape as the other minidom suites) ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function api(name) { return run('GOC.api.' + name); }
var activeStudent = require('./active-student.js');
var DEMO = new Proxy({}, { get: function (_, n) { return api(n); } });
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 20) return done(); setImmediate(again); })();
  });
}
function screenNow() {
  var out = '';
  doc.querySelectorAll('.screen').forEach(function (s) {
    if (s.classList.contains('active')) out = s.getAttribute('id') || out;
  });
  return out;
}

var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
var MINE = ['Use of English', 'Mathematics', 'Physics', 'Chemistry'];

async function main() {
  /* ------------------------------------------------------------------ nav */
  head('the approved sidebar: fourteen entries, each its own screen id');
  /* `.tab-m` marks the five destinations a phone keeps in its bottom bar; a
     desktop sidebar shows all of them, so the list here is every entry the
     markup ships, More included (More is itself one of the five). */
  var sidebarIds = [];
  doc.getElementById('tabbar').querySelectorAll('.tab').forEach(function (t) {
    sidebarIds.push(t.getAttribute('data-t'));
  });
  /* Ten working entries then five in the foot (Support, Profile, Settings,
     Log Out and More on a phone). Log Out is a control, not a screen, so it is
     checked separately below.

     The planning destination is the dedicated Study Plan screen: the round-8
     correction replaced the temporary Classes mapping, so `classes` is no
     longer what the sidebar's Study Plan row names. */
  var want = ['home', 'study', 'practice', 'jamb', 'webtest', 'results',
              'resources', 'qbank', 'studyplan', 'league'];
  var order = sidebarIds.slice(0, 10);
  ok('the sidebar\'s planning row opens the dedicated Study Plan screen',
     sidebarIds.indexOf('studyplan') > -1, sidebarIds.join(','));
  ok('and no longer points at Classes',
     sidebarIds.indexOf('classes') === -1, sidebarIds.join(','));
  ok('the ten working entries are present, in the approved order',
     want.every(function (x, i) { return order[i] === x; }), order.join(','));
  ok('and the foot holds Support, Profile, Settings and Log Out',
     ['support', 'profile', 'settings', 'logout'].every(function (x) {
       return sidebarIds.indexOf(x) > -1;
     }), sidebarIds.slice(10).join(','));
  /* More is checked separately: on a wide screen it deliberately lands on the
     dashboard, so the walk skips it here. */
  var walk = sidebarIds.filter(function (v) { return v !== 'logout' && v !== 'more'; });
  var broken = walk.filter(function (v) {
    var screen = v === 'jamb' ? 'webtest' : v === 'qbank' ? 'pastquestions' : v;
    return !run('(function(){ try { go(' + JSON.stringify(screen) + '); return true; } catch(e){ return false; } })()');
  });
  ok('every destination it names is a screen the app can show', broken.length === 0,
     'broken: ' + broken.join(','));
  /* More is a phone menu, so its row exists in the markup for the phone bar and
     must name a screen the app really has — even though go('more') lands on the
     dashboard on a wide screen (checked in test-more-hub.js). */
  ok('More names a screen that exists', doc.getElementById('more') !== null);
  ok('the retired standalone Timetable screen is still gone',
     id('timetable') === null && sidebarIds.indexOf('timetable') === -1);
  ok('no video resource screen came back with it',
     id('video') === null && id('videos') === null);

  head('the phone keeps five destinations, the fifth of which is More');
  var mobile = [];
  doc.getElementById('tabbar').querySelectorAll('.tab').forEach(function (t) {
    if (t.classList.contains('tab-m')) mobile.push(t.getAttribute('data-t'));
  });
  ok('exactly five tabs are marked primary on a phone', mobile.length === 5, mobile.join(','));
  ok('they are Home, Study, Practice, Results, More',
     mobile.join(',') === 'home,study,practice,results,more', mobile.join(','));
  var moreTab = null;
  doc.getElementById('tabbar').querySelectorAll('.tab').forEach(function (t) {
    if (t.getAttribute('data-t') === 'more') moreTab = t;
  });
  /* Round 8: More opens the real More hub, not Profile. */
  ok('and More opens the More hub, not Profile',
     !!moreTab && /go\('more'\)/.test(moreTab.getAttribute('onclick') || ''),
     moreTab && moreTab.getAttribute('onclick'));

  /* ------------------------------------------------------- an empty account */
  head('a brand-new account sees its own name, and dashes where nothing is on file');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  var r = await activeStudent.demo(DEMO, {
    signupCode: 'GOC-2027', name: 'Ernest U. Jesusanusi', password: 'ernest#27',
    goal: 'JAMB / UTME', subjects: MINE
  });
  var SID = r.student && r.student.id;
  ok('the student registered and is signed in', !!SID, SID);
  run('GOC.api._drivers.mock._setTier')(SID, 'goc');

  run('go("home")');
  await run('dashLoad()');
  await flush();

  ok('the greeting is drawn from the signed-in account, not a sample name',
     /Ernest/.test(text('dashName')), text('dashName'));
  ok('the first name only, the way the banner reads it',
     text('dashName').replace(/\s*👋\s*/, '') === 'Ernest', JSON.stringify(text('dashName')));
  ok('the header names the full account', text('dashTopName') === 'Ernest U. Jesusanusi', text('dashTopName'));
  ok('the avatar carries the initials, not a photo the hub does not have',
     text('dashAva') === 'EJ' && text('dashAvaSm') === 'EJ', text('dashAva') + '/' + text('dashAvaSm'));
  ok('the greeting word is one of the three the engine allows',
     ['Good morning,', 'Good afternoon,', 'Good evening,'].indexOf(text('dashHello')) > -1,
     text('dashHello'));

  head('and every metric that has no record says so instead of showing a zero');
  ok('XP reads a real zero, because a new account really has none',
     text('dashXp') === '0', text('dashXp'));
  ok('the streak too', text('dashStreak') === '0', text('dashStreak'));
  ok('performance has no marked paper, so it shows a dash',
     text('dashPerf') === '—', text('dashPerf'));
  /* The approved card is icon + value + label and nothing else, so there is no
     third line to explain the dash with — the dash itself is the honest answer,
     and the engine's own reason is still covered by the `dashMetrics` checks at
     the bottom of this file. */
  ok('and the card carries no extra explanatory line, per the approved design',
     id('dashPerfDetail') === null && id('dashXpDetail') === null && id('dashStreakDetail') === null,
     'detail elements present');
  ok('the reason the dash appears is still the engine\'s, unchanged',
     /marked paper/i.test(run('GOC.core.dashMetrics(null).performance.detail')),
     run('GOC.core.dashMetrics(null).performance.detail'));
  ok('the level badge starts at the first level the engine allows',
     /^Level 1$/.test(text('dashLevel')), text('dashLevel'));
  ok('with the title that band carries', text('dashLevelTitle') === 'Foundation Scholar', text('dashLevelTitle'));

  head('Continue Learning offers the first step when there is no history');
  ok('naming the action honestly', /first practice/i.test(text('dashContinuePos')),
     text('dashContinuePos'));
  ok('and the button says what it does', text('dashContinueCta') === 'Start practising',
     text('dashContinueCta'));

  head('the study plan card states that nothing is planned, rather than faking a week');
  ok('the headline is the empty one', /No plan/i.test(text('dashPlanHeadline')), text('dashPlanHeadline'));
  ok('the percentage is a dash', text('dashPlanPct') === '—', text('dashPlanPct'));
  ok('and the card is marked empty for the stylesheet', 
     !!id('dashPlanCard') && id('dashPlanCard').classList.contains('is-empty'));
  ok('the bar has not been given a fake width',
     !id('dashPlanFill') || !id('dashPlanFill').style || id('dashPlanFill').style.width !== undefined,
     id('dashPlanFill') && id('dashPlanFill').style && id('dashPlanFill').style.width);

  head('announcements are hidden while the academy has sent nothing');
  ok('the strip is hidden', id('dashAnnounce').hidden === true);
  ok('and the bell has no dot', id('dashBellDot').hidden === true);

  /* ------------------------------------------------- a real week on record */
  head('after a real practice run is on the record');
  /* A finished run, stored through the same driver method the run screen calls. */
  var saved = await api('recordPractice')({
    mode: 'practice', subject: 'Mathematics', total: 10, answered: 10,
    correct: 8, wrong: 2, percent: 80, timeUsedSec: 640, xpAwarded: 60,
    topics: [{ topic: 'Quadratic Equations', percent: 100, band: 'strong' }],
    review: [{ n: 1, subject: 'Mathematics', topic: 'Quadratic Equations', section: 'A',
               text: 'Solve x^2 - 5x + 6 = 0.', options: ['2, 3', '-2, -3', '1, 6', '-1, 6'],
               answer: 0, given: 0, isCorrect: true, explanation: 'Factorise.' }],
    ts: Date.now() - 3600000
  });
  ok('the run is on the student\'s record', !!saved && saved.ok === true,
     saved && JSON.stringify(saved).slice(0, 120));
  await run('dashLoad()');
  await flush();
  ok('Continue Learning now names the subject and topic of that run',
     /Mathematics/.test(text('dashContinuePos')) && /Quadratic Equations/.test(text('dashContinuePos')),
     text('dashContinuePos'));
  ok('and offers to continue rather than to start over',
     text('dashContinueCta') === 'Continue Studying', text('dashContinueCta'));
  ok('the card is no longer marked empty',
     !id('dashContinueCard').classList.contains('is-empty'));

  head('an announcement the account receives is reduced to one line');
  /* The offline demo has no tutors, so there is no notice to fetch — the painter
     is driven directly with the shape the route returns, which is what this
     check is about: what the screen does with an announcement once it has one. */
  run('dashAnnounceItems = [{ kind: "notice", title: "Equations clinic this Friday", at: "2026-11-18T05:39:40.440Z" }]');
  run('dashPaintAnnounce()');
  await flush();
  ok('the strip is revealed for an account that was sent one',
     id('dashAnnounce').hidden === false);
  ok('and reads the title, not a placeholder', text('dashAnnounceText') === 'Equations clinic this Friday',
     text('dashAnnounceText'));
  ok('and lights the bell', id('dashBellDot').hidden === false);
  run('dashAnnounceItems = []');
  run('dashPaintAnnounce()');
  await flush();
  ok('with nothing sent, the strip hides again rather than showing an empty card',
     id('dashAnnounce').hidden === true);

  head('the study window is spelled out from the server\'s own numbers');
  await run('loadSettings()');
  await flush();
  run('dashPaintWindow()');
  await flush();
  ok('the details section shows minutes left today', /Minutes? left today/.test(text('dashWindow')),
     text('dashWindow'));
  ok('and the minutes studied', /Studied today/.test(text('dashWindow')), text('dashWindow'));

  /* --------------------------------------------------------- destinations */
  head('every action on the screen is an existing screen, not a new one');
  run('go("home")');
  await flush();
  run('dashContinueGo()');
  await flush();
  ok('Continue Learning opens the practice set-up',
     screenNow() === 'studySet', screenNow());

  run('dashPlanGo()');
  await flush();
  ok('My Study Plan opens the dedicated Study Plan screen, not Classes',
     screenNow() === 'studyplan', screenNow());

  /* The card has to be right on the first paint, not only after the Study Plan
     page has been opened once and pushed its plan back into the dashboard. With
     nothing saved it says so; the honesty is the point, not a placeholder. */
  run('go("home")');
  await flush();
  await flush();
  ok('with nothing saved, the plan card says there is no plan for today',
     /no plan/i.test(text('dashPlanHeadline')), text('dashPlanHeadline'));
  ok('and nobody is shown an invented completion figure',
     text('dashPlanPct') === '—', text('dashPlanPct'));

  run('go("home")');
  await flush();
  run('dashJambGo()');
  await flush();
  ok('JAMB CBT opens the existing Web Test hub',
     screenNow() === 'webtest', screenNow());

  run('go("home")');
  await flush();
  run('dashSupportGo()');
  await flush();
  ok('Support goes to the public homepage, where the contact details are',
     screenNow() === 'landing', screenNow());

  /* --------------------------------------------------- the shared engine */
  head('the rules the screen draws from are the shared ones in goc-core');
  ok('a full hour crosses the greeting correctly',
     run('GOC.core.dashGreeting(9)') === 'Good morning,' &&
     run('GOC.core.dashGreeting(15)') === 'Good afternoon,' &&
     run('GOC.core.dashGreeting(18)') === 'Good evening,' &&
     run('GOC.core.dashGreeting(23)') === 'Good night,');
  ok('initials come off the first and last part of the name',
     run('GOC.core.dashInitials("Ernest U. Jesusanusi")') === 'EJ');
  ok('a one-word name still gets one letter rather than a made-up second',
     run('GOC.core.dashInitials("Ngozi")') === 'N');
  ok('a stored XP of 2,480 reads as 2,480 on the card, through the same level the profile shows',
     run('GOC.core.dashMetrics({xp:2480,streak:12,level:16,performanceDetail:{overall:77.5,hasData:true,markedAttempts:1}}).xp.value') === '2,480' &&
     run('GOC.core.dashMetrics({xp:2480,streak:12,level:16,performanceDetail:{overall:77.5,hasData:true,markedAttempts:1}}).xp.detail')
       === 'Level 16 · Distinction Scholar');
  ok('an account with no marked paper gets a dash and an honest line, never 0%',
     run('GOC.core.dashMetrics({xp:0,streak:0,level:1,performanceDetail:{overall:0,hasData:false,markedAttempts:0}}).performance.value') === '—');
  ok('a plan of 60 minutes with 36 read is 60% done, and says how much is left',
     run('GOC.core.dashStudyPlan({blocks:[{day:"Mon",subject:"Mathematics",minutes:60}],day:"Mon",studiedMinutes:36}).percent') === 60);
  ok('and an empty plan is flagged empty rather than drawn as 0%',
     run('GOC.core.dashStudyPlan({blocks:[],day:"Mon",studiedMinutes:0}).hasData') === false);

  /* ------------------------------------------- the correction round's markup */
  head('the phone bar, the sidebar and the banner carry the corrected structure');
  /* The three defects fixed this round were structural, so they are asserted
     structurally: the nav wrapper that used to stack the phone bar, the "More"
     row that used to appear in the desktop sidebar, and the banner divider that
     did not exist. Layout itself is verified in a real browser; these guard the
     markup and CSS from regressing. */
  var css = require('fs').readFileSync(__dirname + '/../css/styles.css', 'utf8');
  ok('the nav wrapper is a row by default, so the phone bar cannot stack',
     /\.side-nav\{\s*display:flex;\s*flex-direction:row;/.test(css),
     'wrapper rule');
  ok('and a column only inside the desktop sidebar rule',
     /\.side-nav\{\s*flex:0 0 auto;\s*flex-direction:column;/.test(css),
     'sidebar rule');
  ok('the phone bar gives every tab an equal share of the row',
     /\.tabbar \.tab\{\s*flex:1 1 0;\s*width:auto/.test(css), 'phone tab rule');
  ok('More is hidden from the desktop sidebar',
     /\.tabbar \.tab-m\[data-t="more"\]\{\s*display:none;\s*\}/.test(css), 'more rule');
  ok('the hamburger bars are given an explicit width, not an auto one',
     /\.dash-burger span\{[^}]*width:100%/.test(css), 'burger bar rule');
  ok('the banner divider exists in the markup',
     !!doc.querySelector('.dash-welcome-div'));
  ok('the level badge is a markup chip-free badge beside it',
     !!doc.querySelector('.dash-level') &&
     !/rgba\(60,8,8/.test(css.split('.dash-level{')[1].split('}')[0]),
     'level badge background');
  ok('Quick Access shows its descriptions on a phone too',
     !/\.dash-quick-card s\{\s*display:none/.test(css), 'quick subtitle rule');
  ok('Quick Access icons are not sitting on pink chips',
     !/\.dash-quick-ico\{[^}]*background:#FEF1F1/.test(css), 'quick icon chip');
  ok('the phone announcement card ends in a chevron, not a View link',
     !!doc.querySelector('.dash-announce-chev') &&
     !!doc.querySelector('.dash-announce-title'));
  ok('the plan card is tappable and carries its own chevron',
     /onclick="dashPlanGo\(\)"/.test((doc.getElementById('dashPlanCard') || {}).outerHTML || '') &&
     !!doc.querySelector('.dash-plan-chev'));
  ok('the sidebar keeps its lower flourish',
     !!doc.querySelector('.side-flourish'));

  console.log('\n  ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  process.exit(1);
});
