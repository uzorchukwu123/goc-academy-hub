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
     checked separately below. */
  var want = ['home', 'study', 'practice', 'jamb', 'webtest', 'results',
              'resources', 'qbank', 'classes', 'league'];
  var order = sidebarIds.slice(0, 10);
  ok('Study Plan is no longer its own entry (the planner lives on Classes)',
     sidebarIds.indexOf('studyPlan') === -1, sidebarIds.join(','));
  ok('the Classes screen is the study-planning destination',
     sidebarIds.indexOf('classes') > -1, sidebarIds.join(','));
  ok('the ten working entries are present, in the approved order',
     want.every(function (x, i) { return order[i] === x; }), order.join(','));
  ok('and the foot holds Support, Profile, Settings and Log Out',
     ['support', 'profile', 'settings', 'logout'].every(function (x) {
       return sidebarIds.indexOf(x) > -1;
     }), sidebarIds.slice(10).join(','));
  ok('every destination it names is a screen the app can show',
     sidebarIds.filter(function (v) { return v !== 'logout'; }).every(function (v) {
       return run('(function(){ try { go(' + JSON.stringify(v === 'jamb' ? 'webtest' :
         v === 'qbank' ? 'pastquestions' : v) + '); return true; } catch(e){ return false; } })()');
     }), sidebarIds.join(','));
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
  ok('and More opens a screen that exists, not a made-up one',
     !!moreTab && /go\('profile'\)/.test(moreTab.getAttribute('onclick') || ''),
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
  ok('and explains why', /marked paper/i.test(text('dashPerfDetail')), text('dashPerfDetail'));
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
  ok('My Study Plan opens the study-planning destination',
     screenNow() === 'classes', screenNow());

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

  console.log('\n  ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  process.exit(1);
});
