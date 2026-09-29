/* test-p10.js — Priorities 10, 11 and 12: the Scholar League screen.
   The engine's ordering is proved in test-rules.js and the route in
   test-server.js. This suite covers the third link in the chain: what the
   student actually reads. The load-bearing rule is that the screen NEVER
   decides an order — it paints the rows in the order the data layer handed
   over. If a sort ever appears in js/app.js the league can disagree with the
   server, so that is asserted directly. Run:  node test/test-p10.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js', 'goc-core.js'));
var appSrc = read('js/app.js');

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

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function txt(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function mk(x) { var e = id(x); return e ? e.innerHTML : '<missing ' + x + '>'; }
function run(expr) { return vm.runInContext(expr, ctx); }
function paint(d) { sandbox.__d = d; run('paintLeague(__d)'); }

/* There is no seeded demo roster any more (Priority: "the roll is closed to
   strangers"), so the students the driver's own league is checked against
   are registered through the same public sign-up path a scholar would use,
   exactly like test-p9.js and test-p78.js — nothing here is hard-coded. */
function registerStudent(name, pw) {
  return run('GOC.api.createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics']
  }).then(function (r) { return r.student.id; });
}

/* Builds a league payload the same shape both drivers return, ordered by the
   real engine so the fixture can never disagree with production ordering. */
function league(rows, meId) {
  var ranked = core.rankLeague(rows.map(function (r) {
    return { scholarId: r.id, name: r.name, xp: r.xp || 0, streak: r.streak || 0,
             level: r.level || 1, performance: r.performance, assessed: r.assessed || 0,
             me: r.id === meId };
  }));
  var mine = null;
  ranked.forEach(function (r) { if (r.me) mine = r; });
  return { rows: ranked, size: ranked.length, me: mine,
           league: core.leagueName(mine ? mine.rank : 1, ranked.length),
           basis: 'Overall academic performance first, then Academy XP.' };
}

/* --------------------------------------------------------------- markup ---- */
head('the markup the league screen paints into');
['league', 'lgTier', 'lgSub', 'lgCount', 'lgPodium', 'lgTable', 'lgMineCard',
 'lgMineRank', 'lgMineSize', 'lgMineName', 'lgMineNote',
 'lgMinePerf', 'lgMineXp', 'lgMineStreak', 'lgMineLvl', 'lgBasis'].forEach(function (x) {
  ok(x + ' exists', !!id(x));
});
ok('the standing card shows performance before XP, so the basis is obvious',
   mk('lgMineCard').indexOf('Performance') < mk('lgMineCard').indexOf('Academy XP'));
ok('the basis is written on the screen, not left implied',
   /performance/i.test(txt('lgBasis')) && /XP/.test(txt('lgBasis')));

/* ------------------------------------------------------- no sorting here ---- */
head('the screen must never decide the order itself');
var appNoComments = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/* Scoped to the league rendering path (renderLeague through paintMyStanding,
   up to the unrelated CBT section that follows them) rather than the whole
   file: js/app.js also sorts the weekly class schedule's own blocks by time
   (sortDayBlocks), which has nothing to do with the league and must not trip
   this check. */
var leagueSrc = (appNoComments.match(/function renderLeague\(\)[\s\S]*?(?=var cbtN=)/) || [''])[0];
ok('league rendering has a renderLeague/paintLeague/paintMyStanding path to check',
   leagueSrc.indexOf('function paintMyStanding') > -1, leagueSrc.length);
ok('the league rendering path contains no .sort( call anywhere',
   leagueSrc.indexOf('.sort(') < 0);
ok('app.js does not recompute performance or ranks for itself',
   appNoComments.indexOf('rankLeague') < 0 && appNoComments.indexOf('computePerformance') < 0);
ok('renderLeague asks the data layer and paints the answer',
   /function renderLeague\(\)\{[\s\S]*?GOC\.api\.league\(\)[\s\S]*?paintLeague\(d\)/.test(appSrc));

/* The row order handed over is honoured exactly, including a deliberately
   perverse one — if the screen ever re-sorts, this is what catches it. */
var perverse = { rows: [
  { scholarId: 'GOC-S-003', name: 'Third Place', xp: 5000, performance: 12, assessed: 9, rank: 1, level: 9 },
  { scholarId: 'GOC-S-001', name: 'First Place', xp: 10, performance: 99, assessed: 1, rank: 2, level: 1 },
  { scholarId: 'GOC-S-002', name: 'Second Place', xp: 900, performance: 55, assessed: 4, rank: 3, level: 4 }
], size: 3, me: null, league: 'Gold League' };
paint(perverse);
var order = (mk('lgTable').match(/(First|Second|Third) Place/g) || []);
ok('the table is painted in the given order even when that order looks wrong',
   order.join(',') === 'Third Place,First Place,Second Place', order.join(','));
ok('the rank shown is the rank supplied, not the row position',
   /class="rk">1</.test(mk('lgTable')));

/* ---------------------------------------------------------- the podium ----- */
head('the podium');
var five = league([
  { id: 'GOC-S-001', name: 'Amara Obi', xp: 300, performance: 92, assessed: 6, level: 5 },
  { id: 'GOC-S-002', name: 'Bola Ade', xp: 1200, performance: 81, assessed: 4, level: 7 },
  { id: 'GOC-S-003', name: 'Chidi Eze', xp: 90, performance: 70, assessed: 3, level: 2 },
  { id: 'GOC-S-004', name: 'Dara Musa', xp: 40, performance: 55, assessed: 2, level: 1 },
  { id: 'GOC-S-005', name: 'Emeka Nwo', xp: 20, performance: 30, assessed: 1, level: 1 }
], 'GOC-S-004');
paint(five);
var podRanks = (mk('lgPodium').match(/class="base"[^>]*>(\d)/g) || []).join(',');
ok('the podium is drawn 2nd, 1st, 3rd so the winner stands in the middle',
   /2[\s\S]*1[\s\S]*3/.test(podRanks), podRanks);
ok('only three scholars reach the podium',
   (mk('lgPodium').match(/class="pod"/g) || []).length === 3);
ok('the podium figure is performance, not XP',
   mk('lgPodium').indexOf('92') > -1 && mk('lgPodium').indexOf('1,200') < 0);
ok('the winner is drawn larger than the other two',
   /width:60px/.test(mk('lgPodium')));

paint(league([{ id: 'GOC-S-001', name: 'Solo Scholar', xp: 60, performance: 88, assessed: 1 }], 'GOC-S-001'));
ok('a league of two or fewer still draws a podium without a gap',
   (mk('lgPodium').match(/class="pod"/g) || []).length === 1);
ok('the only scholar in the academy is shown Diamond, not Bronze',
   txt('lgTier') === 'Diamond League', txt('lgTier'));

/* ------------------------------------------------------------ the table ---- */
head('the standings table');
paint(five);
ok('every scholar is listed', (mk('lgTable').match(/class="lrow/g) || []).length === 5);
ok('the student\'s own row is marked', /class="lrow me"/.test(mk('lgTable')));
ok('the student\'s own row is labelled You', /class="you">You</.test(mk('lgTable')));
ok('exactly one row is the student\'s own',
   (mk('lgTable').match(/class="lrow me"/g) || []).length === 1);
ok('each row states how many papers were marked', /paper.? marked/.test(mk('lgTable')));
ok('a single marked paper reads in the singular',
   / 1 paper marked/.test(mk('lgTable')));
ok('XP is shown with a thousands separator', mk('lgTable').indexOf('1,200') > -1);
ok('the count above the table matches the table', txt('lgCount') === '5 scholars');
ok('the subtitle states performance first, XP as the tie-break',
   /performance/i.test(txt('lgSub')) && /tie/i.test(txt('lgSub')));

/* A name must never be able to inject markup into the table. Asserted against
   the DOM rather than against innerHTML: minidom decodes entities on its way
   back out, so the serialised string cannot tell an escaped name from a live
   tag. What matters either way is that no element was created from the name. */
paint(league([{ id: 'GOC-S-009', name: '<img src=x onerror=alert(1)>', xp: 10, performance: 50, assessed: 1 }], null));
ok('a hostile name creates no element in the table',
   doc.querySelectorAll('#lgTable img').length === 0 &&
   doc.querySelectorAll('#lgTable script').length === 0);
ok('the name is escaped at source by esc(), on every field it reaches',
   /'<div class="nm">'\+esc\(r\.name\)/.test(appSrc) && /esc\(initials\(r\.name\)\)/.test(appSrc));
ok('the hostile text is carried as text, so the student sees it verbatim',
   id('lgTable').textContent.indexOf('onerror') > -1);

/* --------------------------------------------------- not yet assessed ------ */
head('a scholar with nothing marked yet');
var fresh = league([
  { id: 'GOC-S-001', name: 'Marked Scholar', xp: 60, performance: 90, assessed: 2 },
  { id: 'GOC-S-002', name: 'New Scholar', xp: 0, performance: 0, assessed: 0 }
], 'GOC-S-002');
paint(fresh);
ok('an unassessed scholar is told so rather than shown 0%',
   /class="unranked">Not yet assessed</.test(mk('lgTable')));
ok('no 0% chip is printed for them', mk('lgTable').indexOf('>0%<') < 0);
ok('the podium shows a dash for them, not a zero',
   mk('lgPodium').indexOf('—') > -1);
ok('their own standing explains they are placed by XP for now',
   /XP for now/i.test(txt('lgMineNote')), txt('lgMineNote'));
ok('their performance figure is a dash', txt('lgMinePerf') === '—');
ok('an unassessed scholar ranks below an assessed one, never above',
   fresh.rows[0].name === 'Marked Scholar');

/* ------------------------------------------------------- my own standing --- */
head('the student\'s own standing card');
paint(five);
ok('the rank is shown with a hash', txt('lgMineRank') === '#4', txt('lgMineRank'));
ok('the size of the league is shown beside it', txt('lgMineSize') === '5');
ok('the tier is named next to the student', /League/.test(txt('lgMineName')));
ok('performance is shown as a percentage', /%$/.test(txt('lgMinePerf')), txt('lgMinePerf'));
ok('the note says what decided the position',
   /decided by your performance/i.test(txt('lgMineNote')), txt('lgMineNote'));
ok('the note says XP only separates equals',
   /XP only separates/i.test(txt('lgMineNote')));
ok('the level is prefixed Lv', /^Lv /.test(txt('lgMineLvl')), txt('lgMineLvl'));

/* A member of staff previewing the screen has no standing of their own. */
paint({ rows: five.rows, size: 5, me: null, league: 'Gold League' });
ok('with no standing of their own the rank is a dash', txt('lgMineRank') === '—');
ok('and they are told they are not in the standings',
   /not in the standings/i.test(txt('lgMineName')), txt('lgMineName'));
ok('every figure on the card is a dash, not a zero',
   ['lgMinePerf', 'lgMineXp', 'lgMineStreak', 'lgMineLvl'].every(function (x) { return txt(x) === '—'; }));

/* ------------------------------------------------------------- emptiness --- */
head('an academy where nothing has been marked yet');
paint({ rows: [], size: 0, me: null, league: 'Bronze League' });
ok('the table explains itself instead of sitting blank',
   /class="lg-empty"/.test(mk('lgTable')) && /first paper is marked/.test(txt('lgTable')));
ok('the podium says there are no standings yet',
   /No standings yet/.test(mk('lgPodium')));
ok('the count reads zero scholars', txt('lgCount') === '0 scholars');
ok('a single scholar reads in the singular', (function () {
  paint(league([{ id: 'GOC-S-001', name: 'Only One', xp: 10, performance: 50, assessed: 1 }], null));
  return txt('lgCount') === '1 scholar';
})(), txt('lgCount'));

/* ------------------------------------------------------------- failure ----- */
head('the league must not break the screen when it cannot be reached');
paint(five);
var before = mk('lgTable');
run('paintLeague(null); paintLeague(undefined);');
ok('painting nothing leaves what was already there alone', mk('lgTable') === before);

ok('renderLeague swallows a rejection rather than blanking the table',
   /GOC\.api\.league\(\)\.then\([\s\S]*?function\s*\(\)\s*\{[\s\S]*?\}\s*\)/.test(appSrc) &&
   /must not blank the screen/.test(appSrc));

/* A rejected league really must leave the painted table standing. */
var restore = run('GOC.api.league');
sandbox.__reject = function () { return Promise.reject(new Error('offline')); };
run('GOC.api.league = __reject; role = "student";');
var kept = mk('lgTable');
run('renderLeague()').then(function () {
  ok('after a failed refresh the previous standings are still on screen',
     mk('lgTable') === kept && mk('lgTable').indexOf('Amara Obi') > -1 ||
     mk('lgTable') === kept);
  sandbox.__restore = restore;
  run('GOC.api.league = __restore;');

  head('who may read the league at all');
  run('role = "admin"; previewing = false;');
  ok('a member of staff not previewing is not served a student league',
     run('renderLeague()') === undefined);
  run('role = "admin"; previewing = true;');
  ok('a member of staff previewing a student may see it',
     typeof run('renderLeague()') === 'object');
  run('role = "student"; previewing = false;');

  /* ---------------------------------------------------------------------
     The demo driver is what runs from file:// and at every showing, so its
     league must obey the same rule as the server's. This is the only place
     that driver's league is exercised.
     ------------------------------------------------------------------- */
  head('the demo driver\'s league obeys the same rule');
  var MEPW = 'amara2027!', ME;
  return registerStudent('Amara Obi', MEPW).then(function (sid) {
    ME = sid;
    return registerStudent('Chidi Eze', 'chidi2027!');
  }).then(function () {
    return run('GOC.api.login')(ME, MEPW);
  }).then(function () {
    return run('GOC.api.league')();
  }).then(function (d) {
    ok('the demo league returns standings', !!d && Array.isArray(d.rows) && d.rows.length > 1,
       d && d.rows && String(d.rows.length));
    ok('every row is ranked 1..n with no gap',
       d.rows.every(function (r, i) { return r.rank === i + 1; }));
    ok('the rows arrive already ordered — performance first, then XP',
       d.rows.every(function (r, i) {
         if (i === 0) return true;
         var p = d.rows[i - 1];
         if ((p.performance || 0) < (r.performance || 0)) return false;
         if ((p.performance || 0) === (r.performance || 0) && (p.xp || 0) < (r.xp || 0)) return false;
         return true;
       }));
    ok('the signed-in scholar is flagged, exactly once',
       d.rows.filter(function (r) { return r.me; }).length === 1);
    ok('the signed-in scholar is reported separately too',
       d.me && d.me.scholarId === ME, d.me && d.me.scholarId);
    ok('a tier is named', /League/.test(String(d.league)), d.league);
    ok('the basis is stated', /performance/i.test(String(d.basis)), d.basis);
    ok('no credential is anywhere in the demo standings',
       !/password|hash|salt|scrypt/i.test(JSON.stringify(d)));
    ok('the demo league can be painted without error', (function () {
      sandbox.__dd = d;
      run('paintLeague(__dd)');
      return (mk('lgTable').match(/class="lrow/g) || []).length === d.rows.length;
    })());

    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  });
}, function (e) {
  console.log('  FAIL  renderLeague rejected outward: ' + e.message);
  process.exit(1);
});
