/* G.O.C Academy Hub — application script
   All behaviour lives here. State is in-memory only (no localStorage), so a
   refresh resets the demo. Comments marked BACKEND flag the places a real
   server must take over. */
/* ================= COMPATIBILITY =================
   Older Android WebViews and Safari builds have no NodeList.forEach. Without
   this shim the very first go() call would throw and the app would render a
   blank frame. list() turns any NodeList/HTMLCollection into a real array. */
if(window.NodeList && !NodeList.prototype.forEach){ NodeList.prototype.forEach = Array.prototype.forEach; }
if(window.HTMLCollection && !HTMLCollection.prototype.forEach){ HTMLCollection.prototype.forEach = Array.prototype.forEach; }
function list(x){ return Array.prototype.slice.call(x || []); }

/* ================= PWA INSTALL (Phase 3) =================
   Android/Chrome fires beforeinstallprompt once, early in the page's life,
   and only when the browser itself decides the site qualifies (manifest +
   registered service worker, both already in place). It must be captured
   here with a top-level listener and deferred with preventDefault() — miss
   it, and the browser falls back to its own native infobar with no way for
   this app to trigger the prompt itself later on that same page load.
   iOS Safari has no such event at all — it only ever supports the manual
   Share -> "Add to Home Screen" flow, so iOS is detected separately below
   and shown static instructions instead of a native prompt. */
var deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  deferredInstallPrompt = e;
  renderInstallRow();
});
window.addEventListener('appinstalled', function(){
  deferredInstallPrompt = null;
  renderInstallRow();
});

function isStandaloneDisplay(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
function isIOSDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
/* Called once when the Profile screen renders (see go()) and again from the
   beforeinstallprompt/appinstalled listeners above, since either can fire
   after the row is already on screen. Safe to call before the row exists —
   go('profile') calls it again once it does. */
function renderInstallRow(){
  var row = document.getElementById('installAction');
  if(!row) return;
  if(isStandaloneDisplay()){
    row.innerHTML = '<span class="chip green">Installed</span>';
    return;
  }
  if(deferredInstallPrompt){
    row.innerHTML = '<button class="mini-link" onclick="triggerInstall()">Install</button>';
    return;
  }
  if(isIOSDevice()){
    row.innerHTML = '<button class="mini-link" onclick="toggleIosInstallHelp()">How to install</button>';
    return;
  }
  row.innerHTML = '<span class="chip">Not offered by this browser</span>';
}

/* ================= PROFILE BADGES =================
   Every badge here is computed live from this account's own record — streak,
   XP, level, marked results and league standing — the same numbers the rest
   of the app already shows. Nothing is stored or awarded server-side; a
   badge "unlocks" the moment its condition reads true and can never be out
   of sync with the numbers a student can already see elsewhere (dashStreak,
   dashXp, the league table). If that ever needs to become a real earned-once
   record (e.g. to celebrate the moment a badge unlocks rather than just
   reflecting current state), it would need a small server-side field per
   student — this client-side version is the "is it currently true" case,
   which is what the Profile screen actually displays. */
var BADGE_DEFS = [
  { id:'streak7',  icon:'🔥', color:'#DC2626',        label:'7-day',
    test:function(c){ return (c.me.streak || 0) >= 7; } },
  { id:'xp1k',     icon:'⭐', color:'var(--gold)',    label:'1k XP',
    test:function(c){ return (c.me.xp || 0) >= 1000; } },
  { id:'sharp',    icon:'🎯', color:'#15803D',        label:'Sharp',
    test:function(c){ return (c.me.performance || 0) >= 80 && (c.me.performanceDetail && c.me.performanceDetail.markedAttempts) >= 3; } },
  { id:'reader',   icon:'📘', color:'#0E7490',        label:'Reader',
    test:function(c){ return c.attemptCount >= 5; } },
  { id:'mock90',   icon:'🏆', color:'#7C3AED',        label:'Mock 90%',
    test:function(c){ return c.bestPercent >= 90; } },
  { id:'streak30', icon:'📆', color:'#DC2626',        label:'30-day',
    test:function(c){ return (c.me.streak || 0) >= 30; } },
  { id:'top3',     icon:'🥇', color:'#D97706',        label:'Top 3',
    test:function(c){ return !!(c.leagueMe && c.leagueMe.rank && c.leagueMe.rank <= 3); } },
  { id:'master',   icon:'👑', color:'#1F2937',        label:'Master',
    test:function(c){ return (c.me.level || 1) >= 20; } }
];
/* Shared by renderProfileBadges() (paints the Profile screen) and
   checkBadgeCelebrations() (just wants to know what's newly earned) so the
   two never compute "earned" two different ways. */
function badgeContext(meArg){
  /* meArg lets a caller that already has a fresh profile (refreshMe()) skip
     re-fetching it here — see checkBadgeCelebrations() below. */
  var meP = meArg ? Promise.resolve(meArg) : GOC.api.myProfile();
  return Promise.all([
    meP,
    GOC.api.myResults ? GOC.api.myResults() : Promise.resolve({attempts:[]}),
    GOC.api.league ? GOC.api.league() : Promise.resolve(null)
  ]).then(function(res){
    var me = res[0] || {};
    var attempts = (res[1] && res[1].attempts) || [];
    var marked = attempts.filter(function(a){ return a.status === 'marked' && a.percent !== null && a.percent !== undefined; });
    var bestPercent = marked.reduce(function(m, a){ return Math.max(m, Number(a.percent) || 0); }, 0);
    return {
      me: me,
      attemptCount: attempts.length,
      bestPercent: bestPercent,
      leagueMe: res[2] && res[2].me
    };
  });
}
function renderProfileBadges(){
  var host = document.getElementById('profBadges');
  if(!host || role !== 'student' || !GOC.api.myProfile) return;
  badgeContext().then(function(ctx){
    var me = ctx.me;
    set('profLevel', 'Lv ' + (me.level || 1));
    set('profStreakStat', String(me.streak || 0));
    var earnedCount = 0;
    var earnedIds = [];
    var html = BADGE_DEFS.map(function(b){
      var earned = !!b.test(ctx);
      if(earned){ earnedCount++; earnedIds.push(b.id); }
      return earned
        ? '<div class="badge"><div class="b" style="background:' + b.color + '">' + b.icon + '</div><span>' + esc(b.label) + '</span></div>'
        : '<div class="badge lock"><div class="b">🔒</div><span>' + esc(b.label) + '</span></div>';
    }).join('');
    set('profBadgeCount', String(earnedCount));
    host.innerHTML = html;
    noteBadgesSeen(earnedIds); /* Profile is the one screen a student can look
      at every badge on, so opening it also settles the celebration baseline —
      it should never re-celebrate something the student can already see is
      unlocked. */
  }, function(){
    host.innerHTML = '<div class="ad-empty">Badges are not available right now.</div>';
  });
}

/* ================= CELEBRATE (Task 3, half 1: the pop-up itself) =================
   A student's streak and badges are both derived, silently, from numbers
   that update elsewhere (refreshMe() below) — there was no moment that ever
   announced "that just went up". These three functions are that moment:
   session-scoped so a student is never re-congratulated for something they
   already had before this visit, but firing the instant a change is next
   observed (refreshMe() already runs right after everything that can move
   XP/streak/results — see its call sites). Making the pop-up queue and the
   comparison durable across reloads is still left for a later pass (see the
   remaining-tasks file); the affirmation pool below is no longer hard-coded
   only — it is now server-persisted (see loadAffirmations()), with just the
   admin-console editing screen for it still to be built. */
var celebKnownStreak = null;     // null = not observed yet this session
var celebKnownBadges = null;     // null = not observed yet this session; else a set of ids
var celebQueue = [];
var celebShowing = false;

function celebrateStreak(n){ celebQueue.push({icon:'🔥', title:n + '-day streak!', sub:"You're on fire — keep it going."}); celebPump(); }
function celebrateBadge(b){ celebQueue.push({icon:b.icon, title:'Badge unlocked: ' + b.label, sub:'Added to your Profile — nice work.'}); celebPump(); }
function celebPump(){
  if(celebShowing || !celebQueue.length) return;
  var c = celebQueue.shift();
  celebShowing = true;
  set('celebrateIcon', c.icon);
  set('celebrateTitle', c.title);
  set('celebrateSub', c.sub);
  var ov = document.getElementById('celebrateOverlay');
  if(ov) ov.classList.add('show');
}
function closeCelebrate(){
  var ov = document.getElementById('celebrateOverlay');
  if(ov) ov.classList.remove('show');
  celebShowing = false;
  if(celebQueue.length) setTimeout(celebPump, 260); /* let the close transition finish first */
}
/* Called from refreshMe() with the freshly-read streak number. */
function checkStreakCelebration(streak){
  streak = streak || 0;
  if(celebKnownStreak !== null && streak > celebKnownStreak) celebrateStreak(streak);
  celebKnownStreak = streak;
}
/* Called from refreshMe() (badges can move on the same actions XP/streak do,
   even though the student isn't on the Profile screen to see it happen).
   meArg is refreshMe()'s own just-fetched profile, passed through so
   badgeContext() doesn't fetch it a second time in the same tick. */
function checkBadgeCelebrations(meArg){
  if(role !== 'student' || !GOC.api.myProfile) return;
  badgeContext(meArg).then(function(ctx){
    var earnedIds = BADGE_DEFS.filter(function(b){ return !!b.test(ctx); }).map(function(b){ return b.id; });
    noteBadgesSeen(earnedIds);
  }, function(){ /* a failed check must never surface anything to the student */ });
}
/* Shared landing point: records what's earned, and celebrates only the ids
   that are new since the last time either checker looked. */
function noteBadgesSeen(earnedIds){
  if(celebKnownBadges === null){ celebKnownBadges = {}; earnedIds.forEach(function(id){ celebKnownBadges[id] = true; }); return; }
  earnedIds.forEach(function(id){
    if(!celebKnownBadges[id]){
      celebKnownBadges[id] = true;
      var def = BADGE_DEFS.filter(function(b){ return b.id === id; })[0];
      if(def) celebrateBadge(def);
    }
  });
}
function set(id, v){ var e = document.getElementById(id); if(e) e.textContent = v; }
function triggerInstall(){
  if(!deferredInstallPrompt) return;
  var p = deferredInstallPrompt;
  deferredInstallPrompt = null;
  p.prompt();
  p.userChoice.then(function(){ renderInstallRow(); });
}
function toggleIosInstallHelp(){
  var help = document.getElementById('iosInstallHelp');
  if(!help) return;
  help.style.display = (help.style.display === 'none' || !help.style.display) ? 'block' : 'none';
}

/* ================= STATE ================= */
/* limit/used are the daily study window; sessionMin/sessionWarn are the
   Priority 9 session policy. All four are academy settings the console owns —
   these are only the last values the API reported. used/limit stay in whole
   minutes for the ring and the admin screens; studyLeftSec/studyExhausted
   carry the precise, server-decided truth used to gate Start buttons and
   trigger the wind-down screen. Everything starts at zero/false rather than
   a guessed placeholder, and is only ever filled in from a real response —
   see paintStudyWindow(). */
var state = { limit:90, used:0, sessionMin:120, sessionWarn:5,
              studyLeftSec:null, studyExhausted:false,
              studyBonusMin:0, studyExtensionsLeft:0,
              hasGuardianPin:false, guardianPin:'' };
/* The student's first name, for the wind-down screen's copy. Set by
   applyIdentity(); '' before anyone is signed in. */
var studentFirst = '';
var role = 'student';  // demo role gate: 'student' | 'admin'
var adminUnlocked = false;   // secure access portal (firewall) state
var gateBuf = '';
/* The access passcode is verified by GOC.api, never here. All this file knows
   is how many dots to draw, which the API reports. */
function pinLength(){ return GOC.api.passcodeLength(); }
/* Task 3 (second half) — this used to be the only copy of the affirmation
   pool anywhere: fixed, client-side, with no admin control. It now doubles
   as the instant-paint fallback (so the flyer never has to wait on a
   network round trip to show something) while loadAffirmations() below
   pulls the console-owned, server-persisted list in behind it. */
var affirmations = [
  "I am a purpose-driven scholar. Today I study with focus.",
  "Every question I attempt makes me sharper.",
  "I don't chase luck — I build mastery, one topic at a time.",
  "My effort today is my score tomorrow.",
  "I can understand anything if I take it step by step.",
  "Small steps, every single day, become big results.",
  "I study to understand, not just to pass."
];
var affIndex = 0;
var affirmationsLoaded = false;   // becomes true once the server list is in
/* Fetched lazily (openFlyer() triggers it) rather than at page load, since a
   visitor who never opens the flyer this session shouldn't pay for the
   request. Safe to call more than once — later calls are no-ops until the
   admin screen (still to be built) needs a manual refresh hook. */
function loadAffirmations(){
  if(!GOC.api.listAffirmations) return;
  GOC.api.listAffirmations().then(function(list){
    if(Array.isArray(list) && list.length){
      affirmations = list;
      affirmationsLoaded = true;
      // If the flyer is already open and showing a fallback message, bring
      // it up to date rather than leaving it stale until next open.
      var ov = document.getElementById('flyerOverlay');
      if(ov && ov.classList.contains('show')){
        affIndex = affIndex % affirmations.length;
        var q = document.getElementById('flyerQuote');
        if(q) q.textContent = affirmations[affIndex];
      }
    }
  }, function(){ /* offline or no server: the hard-coded fallback stands */ });
}

/* ================= NAV ================= */
/* ===== Mobile drawer for the public homepage =====
   Opens from the burger or by dragging in from the left edge. Desktop hides
   both the burger and the drawer via CSS, so this code simply never fires there. */
function drawerEls(){
  return { d: document.getElementById('lpDrawer'), s: document.getElementById('lpScrim'), b: document.getElementById('lpBurger') };
}
function openDrawer(){
  var e = drawerEls(); if(!e.d) return;
  e.d.style.transform = '';
  e.d.classList.add('on'); e.s.classList.add('on');
  e.d.setAttribute('aria-hidden','false');
  if(e.b) e.b.setAttribute('aria-expanded','true');
}
function closeDrawer(){
  var e = drawerEls(); if(!e.d) return;
  e.d.style.transform = '';
  e.d.classList.remove('on'); e.s.classList.remove('on');
  e.d.setAttribute('aria-hidden','true');
  if(e.b) e.b.setAttribute('aria-expanded','false');
}
function dwGo(id){ closeDrawer(); setTimeout(function(){ go(id); }, 180); }
function dwGoTo(secId){
  closeDrawer();
  setTimeout(function(){
    var t = document.getElementById(secId);
    if(t && t.scrollIntoView) t.scrollIntoView({behavior:'smooth', block:'start'});
  }, 200);
}
/* Edge-drag: start within 26px of the left edge on the landing screen and pull
   right to reveal the drawer; drag it back left (or flick) to dismiss. */
(function(){
  var startX = 0, startY = 0, dragging = false, fromEdge = false, width = 300, wasOpen = false;
  function onLanding(){
    var l = document.getElementById('landing');
    return l && l.classList.contains('active');
  }
  function isMobile(){ return window.innerWidth < 900; }
  document.addEventListener('touchstart', function(ev){
    if(!onLanding() || !isMobile()) return;
    var d = document.getElementById('lpDrawer'); if(!d) return;
    var t = ev.touches[0];
    startX = t.clientX; startY = t.clientY;
    wasOpen = d.classList.contains('on');
    fromEdge = startX <= 26;
    dragging = fromEdge || wasOpen;
    width = d.offsetWidth || 300;
  }, {passive:true});
  document.addEventListener('touchmove', function(ev){
    if(!dragging) return;
    var d = document.getElementById('lpDrawer'), s = document.getElementById('lpScrim');
    if(!d) return;
    var t = ev.touches[0];
    var dx = t.clientX - startX, dy = t.clientY - startY;
    // Vertical intent wins — let the page scroll instead of fighting the gesture.
    if(Math.abs(dy) > Math.abs(dx) && !wasOpen){ dragging = false; return; }
    var off;
    if(wasOpen){ off = Math.min(0, dx); }
    else { off = Math.min(0, -width + Math.max(0, dx)); }
    d.classList.add('on');
    d.setAttribute('aria-hidden','false');   // it is visible, so it must not be hidden from screen readers
    d.style.transition = 'none';
    d.style.transform = 'translateX(' + off + 'px)';
    if(s){ s.classList.add('on'); s.style.opacity = String(1 - Math.abs(off)/width); }
  }, {passive:true});
  document.addEventListener('touchend', function(ev){
    if(!dragging) return;
    dragging = false;
    var d = document.getElementById('lpDrawer'), s = document.getElementById('lpScrim');
    if(!d) return;
    d.style.transition = '';
    if(s) s.style.opacity = '';
    var t = (ev.changedTouches && ev.changedTouches[0]) || null;
    var dx = t ? t.clientX - startX : 0;
    if(wasOpen){ if(dx < -60) closeDrawer(); else openDrawer(); }
    else { if(dx > width * 0.35) openDrawer(); else closeDrawer(); }
  }, {passive:true});
})();

function go(id){
  if(typeof closeDrawer === 'function') closeDrawer();
  /* Priority 9 — no in-app screen may be reached once the session has run out,
     so a tab left open cannot be clicked back into the dashboard. The server
     refuses the data anyway; this stops the empty shell being shown at all.
     The public screens stay open, because that is where an expired student is
     being sent. */
  var openScreens = ['landing','login-v2','signup','updates','legal'];
  if(openScreens.indexOf(id) < 0 && ssExpired()){ ssEnd(); return; }
  if(id === 'login-v2' && typeof ssClearNotice === 'function' && !(ss && ss.ending)) ssClearNotice();
  // Access guard: the admin console is never reachable as a student, and only
  // after passing the secure access portal (firewall) as an admin.
  if(id === 'admin'){
    if(role !== 'admin'){ toast('That screen is not part of your account'); id = 'profile'; }
    else if(!adminUnlocked){ id = 'admin-gate'; }
  }
  if(id === 'admin-gate' && role !== 'admin'){ toast('Admin only'); id = 'profile'; }
  list(document.querySelectorAll('.screen')).forEach(function(s){
    s.classList.remove('active');
    /* Priority 1 — the richer entrance belongs to one arrival only, so it is
       cleared from every screen before the next one is shown. */
    s.classList.remove('enter-rich');
    s.classList.remove('enter-id');
  });
  var el = document.getElementById(id);
  if(el){
    el.classList.add('active'); el.scrollTop = 0;
    if(animEnterOnce){
      el.classList.add('enter-rich');
      if(animEnterId) el.classList.add('enter-id');
      animEnterOnce = false; animEnterId = false;
    }
  }
  /* Priority 1.1 — the landing page reveals its sections as they are reached. */
  if(id === 'landing' && typeof animInit === 'function') animInit();
  if(id === 'admin'){ admOpen('overview'); admKpiLoad(); }
  /* Priority 12 — the standings are re-read on the way in, so they are current
     whenever the student looks rather than only just after logging in. */
  if(id === 'league' && typeof renderLeague === 'function') renderLeague();
  /* The dashboard's panels are the account's own record, so they are re-read on
     the way in rather than held from the last visit. */
  if(id === 'home' && typeof renderDash === 'function') renderDash();
  // Install-state can change between visits (installed elsewhere, prompt
  // captured after the screen first loaded), so it's re-read on the way in.
  if(id === 'profile'){ renderInstallRow(); renderProfileBadges(); }
  /* Priority 2 — the nav height is only measurable once the screen is visible,
     so the filter row's sticky offset is set on the way in. */
  if(id === 'updates' && typeof upFiltersInit === 'function') upFiltersInit();
  // A mock exam timer must never keep running on a screen the student left.
  if(id !== 'cbt' && typeof cbtTimerId !== 'undefined' && cbtTimerId){
    clearInterval(cbtTimerId); cbtTimerId = null;
  }
  // Same rule for the Web Test runner's clock.
  if(id !== 'wtRun' && typeof wtTimerId !== 'undefined' && wtTimerId){
    clearInterval(wtTimerId); wtTimerId = null;
  }
  // The preview banner belongs only to student-facing screens.
  if(id === 'admin' || id === 'admin-gate' || id === 'landing' || id === 'login-v2'){
    previewing = false;
    document.body.classList.remove('previewing');
    var pb = document.getElementById('pvBar'); if(pb) pb.style.display = 'none';
  }
  var tabbar = document.getElementById('tabbar');
  var tabScreens = ['home','timetable','classes','study','league','profile','webtest'];
  var showTabs = tabScreens.indexOf(id) > -1;
  // Immersive flows (login, lesson/practice/CBT/results, video player, resources)
  // hide the tab bar so it never overlaps their own bottom action bars.
  tabbar.style.display = showTabs ? 'flex' : 'none';
  // On desktop: public screens (landing, login, sign-up) are full-bleed, and
  // every in-app screen shows the left sidebar. This class drives that split.
  var publicScreens = ['landing','login-v2','signup','updates','legal'];
  document.getElementById('phone').classList.toggle('is-login', publicScreens.indexOf(id) > -1);
  // highlight tab (map sub-screens to their section)
  var map = { timetable:'home', lesson:'study', practice:'study', cbt:'study', results:'study', resources:'study', webtest:'study', wtRun:'study', wtResult:'study' };
  var active = map[id] || id;
  list(document.querySelectorAll('.tab')).forEach(function(t){
    var on = t.getAttribute('data-t') === active;
    t.classList.toggle('on', on);
    t.querySelector('.icon').setAttribute('stroke', on ? '#DC2626' : '#9AA3AF');
    // Keep the accessible "current page" state in sync with the visual one —
    // the .on class alone is invisible to screen readers.
    if(on) t.setAttribute('aria-current', 'page'); else t.setAttribute('aria-current', 'false');
  });
  window.scrollTo(0,0);
}

/* The ID and password are checked by GOC.api — in demo mode against the local
   roster, in server mode against a password hash. Either way this function only
   ever sees the answer, never the stored password. */
function login(){
  var raw = ((document.getElementById('loginId')||{}).value||'').trim();
  var pw  = ((document.getElementById('loginPw')||{}).value||'');
  if(!raw){ toast('Enter your Scholar ID'); return; }
  var btn = document.getElementById('loginBtn');
  busy(btn, true);
  return GOC.api.ready.then(function(){ return GOC.api.login(raw, pw); }).then(function(user){
    busy(btn, false);
    /* Priority 1.2 — the transition is set up only once the credentials have
       actually been accepted, so a refused login never animates as though it
       had succeeded. It marks the next screen; it does not delay it. */
    if(typeof animEnter === 'function') animEnter();
    applyIdentity(user);
    loadSettings();
    /* Defense in depth (Phase 1.1) — a successful login must always reach the
       dashboard. None of this dashboard-widget hydration is allowed to stop
       that: each call is isolated so a failure in one (e.g. the demo driver
       not yet supporting some server-only feature) only logs a warning
       instead of throwing the whole chain into the outer .catch() below,
       which used to strand an authenticated user on the login screen. */
    [buildWeek, renderClasses, renderResources, loadPublishedResources, loadPublishedVideos, loadUpcomingClasses, refreshMe, renderLeague]
      .forEach(function(fn){
        try{ fn(); }
        catch(e){ console.warn('[login] dashboard widget failed to hydrate:', e); }
      });
    wtCatalogue = null;                  // the papers belong to whoever just logged in
    // Management lands on the secure access portal, not the student dashboard.
    if(role === 'admin'){
      go('admin-gate');
      toast('Staff ID recognised — enter your access passcode');
      return;
    }
    if(user.mustChangePassword){
      go('change-password');
      return;
    }

    go('home');
    ssStart();                          // Priority 9 — begin watching the clock
    swStart();                          // and begin the daily study-window heartbeat
    setTimeout(openFlyer, 350);
  }).catch(function(err){
    busy(btn, false);
    toast(err.message || 'Could not log you in');
  });
}
/* Disables a button while a request is in flight, so a slow network cannot be
   turned into two logins or two published updates by an impatient double-tap. */
function busy(btn, on){
  if(!btn) return;
  btn.disabled = !!on;
  if(on){ btn.dataset.label = btn.textContent; btn.textContent = 'Please wait…'; }
  else if(btn.dataset.label){ btn.textContent = btn.dataset.label; }
}
/* ===== Management preview =====
   Lets staff step into the student dashboard to confirm a change landed,
   then step straight back. Role stays 'admin' the whole time, so the console
   remains unlocked and no student ever gains this route. */
var previewing = false;
function admPreview(){
  if(role !== 'admin') return;
  previewing = true;
  document.body.classList.add('previewing');
  var b = document.getElementById('pvBar'); if(b) b.style.display = 'flex';
  go('home');
  updateFocus(); buildWeek(); renderClasses(); renderResources(); renderUpdates();
  renderLeague();
  toast('Previewing as a student — your console session stays unlocked');
}
function exitPreview(){
  previewing = false;
  document.body.classList.remove('previewing');
  var b = document.getElementById('pvBar'); if(b) b.style.display = 'none';
  go('admin');
}
/* ===== Rosters =====
   Both rosters now live behind GOC.api. This file keeps a read-only cache of
   the student list purely so the console can render without re-fetching on
   every keystroke; it is refreshed by loadStudents(). No password ever
   reaches this cache in server mode. */
var studentsData = [];        // cache of GET /students — never holds passwords
var staffData    = [];        // cache of GET /staff — names and titles only
var revealed = {};            // Scholar ID -> password shown in demo mode only

/* Pulls the roster for the console. Resolves either way so a failed fetch shows
   a message in the panel instead of leaving it blank forever. */
/* Authorised staff accounts, shown on the console's Access panel. */
function loadStaff(){
  return GOC.api.listStaff().then(function(rows){
    staffData = rows || [];
    return staffData;
  }).catch(function(){ return []; });
}
function loadStudents(){
  return GOC.api.listStudents().then(function(rows){
    studentsData = rows || [];
    var w = document.getElementById('admCredList'); if(w) w.innerHTML = admCredHTML();
    var c = document.getElementById('admCount');    if(c) c.textContent = studentsData.length;
    var t = document.getElementById('admStuTabs');  if(t) t.innerHTML = admStuTabsHTML();
    var n = document.getElementById('admStuNote');  if(n) n.innerHTML = admStuNoteHTML();
    admKpiLoad();
    return studentsData;
  }).catch(function(err){
    var w = document.getElementById('admCredList');
    if(w) w.innerHTML = '<p class="ad-p">Could not load the roster — '+esc(err.message)+'</p>';
    return [];
  });
}
function initials(n){
  var p = String(n||'').trim().split(/\s+/);
  var a = (p[0]||'G').charAt(0);
  var b = (p[1]||p[0]||'C').charAt(p[1] ? 0 : 1) || 'C';
  return (a+b).toUpperCase();
}
function admCredHTML(){
  if(!studentsData.length) return '<p class="ad-p">No students on the roster yet.</p>';
  var rows = studentsData.filter(function(s){
    if(admStuFilter === 'active') return s.active !== false;
    if(admStuFilter === 'closed') return s.active === false;
    return true;
  });
  if(!rows.length) return '<div class="ad-empty">No '+(admStuFilter === 'closed' ? 'deactivated' : 'active')+' accounts.</div>';
  return rows.map(function(s){
    // In server mode revealed[] is always empty: a hashed password cannot be shown.
    var shown = revealed[s.id] ? esc(revealed[s.id]) : '••••••••';
    var open = s.active !== false;
    return '<div class="ad-cred'+(open ? '' : ' off')+'">'+
      '<div class="ac-top"><div class="ad-av">'+esc(initials(s.name))+'</div>'+
      '<div class="ac-who"><b>'+esc(s.name)+'</b><span>'+esc(s.last)+'</span></div>'+
      '<span class="ad-tag '+(open ? s.tag : 'r')+'">'+esc(open ? s.tl : 'Deactivated')+'</span></div>'+
      '<div class="ac-grid">'+
        '<div class="ac-cell"><label>Scholar ID</label><code>'+esc(s.id)+'</code></div>'+
        '<div class="ac-cell"><label>Password</label><code>'+shown+'</code></div>'+
      '</div>'+
      '<div class="ad-field"><label>Cohort</label><select onchange="admSetStudentCohort(\''+s.id+'\', this.value)">'+
        '<option value=""'+(!s.cohort?' selected':'')+'>Unassigned</option>'+
        admCohortsCache.map(function(c){
          return '<option value="'+esc(c.cohortId)+'"'+(s.cohort===c.cohortId?' selected':'')+'>'+esc(c.name)+'</option>';
        }).join('')+
      '</select></div>'+
      '<div class="ad-metric"><span>Account</span><b>'+(open ? 'Active' : 'Deactivated — records kept')+'</b></div>'+
      '<div class="ad-metric"><span>Academy XP</span><b>'+esc(s.xp || 0)+' XP · Level '+esc(s.level || 1)+'</b></div>'+
      '<div class="ad-metric"><span>Overall performance</span><b>'+esc(s.performance || 0)+'%</b></div>'+
      '<div class="ac-btns">'+
        '<button class="ad-btn" onclick="admReveal(\''+s.id+'\')">'+(revealed[s.id]?'Hide':'Reveal')+'</button>'+
        '<button class="ad-btn" onclick="admResetPw(\''+s.id+'\')">Reset password</button>'+
      '</div>'+
      '<div class="ac-btns">'+
        (open
          ? '<button class="ad-btn warn" onclick="admSetActive(\''+s.id+'\',false)">Deactivate account</button>'
          : '<button class="ad-btn pri" onclick="admSetActive(\''+s.id+'\',true)">Reopen account</button>')+
      '</div></div>';
  }).join('');
}
/* Priority 7 — which accounts the list is showing, so a closed account is easy
   to find again. */
var admStuFilter = 'all';
function admStuSetFilter(f){
  admStuFilter = f;
  var seg = document.getElementById('admStuTabs');
  if(seg) seg.innerHTML = admStuTabsHTML();
  var list = document.getElementById('admCredList');
  if(list) list.innerHTML = admCredHTML();
}
function admStuTabsHTML(){
  var closed = studentsData.filter(function(s){ return s.active === false; }).length;
  var tabs = [['all', 'Everyone (' + studentsData.length + ')'],
              ['active', 'Active (' + (studentsData.length - closed) + ')'],
              ['closed', 'Deactivated (' + closed + ')']];
  return tabs.map(function(t){
    return '<button class="'+(admStuFilter === t[0] ? 'on' : '')+'" onclick="admStuSetFilter(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('');
}
/* Priority 7 — closing an account withdraws access and nothing else. Every
   result, every mark, the performance history and the XP stay exactly where
   they are, still attached to the same Scholar ID, so the account can be
   reopened with its record intact. The rule is enforced by the API for both
   drivers; this only asks for it. */
function admSetActive(id, on){
  if(!on && typeof confirm === 'function'){
    if(!confirm('Deactivate ' + id + '?\n\nThe student will be signed out and cannot log in again until the account is reopened. Nothing is deleted — results, performance history and XP are all kept.')) return;
  }
  GOC.api.setStudentActive(id, on).then(function(s){
    toast(on
      ? s.id + ' reopened — the student can log in again, with their record intact'
      : s.id + ' deactivated — access withdrawn, and every result and XP kept on file');
    return loadStudents();
  }).catch(function(err){ toast(err.message || 'That account was not changed'); });
}
function admStuNoteHTML(){
  var closed = studentsData.filter(function(s){ return s.active === false; }).length;
  return closed
    ? '<b>'+closed+' account'+(closed === 1 ? '' : 's')+' deactivated.</b> A deactivated scholar cannot log in and cannot reach any protected page, but nothing has been deleted: the Scholar ID, test results, marks, performance history and XP are all still on file and come back the moment the account is reopened.'
    : 'Deactivating an account withdraws access only. The Scholar ID, test results, marks, performance history and XP are all preserved, so an account can be reopened with its record intact.';
}
function admReveal(id){
  if(revealed[id]){                       // already showing → just hide it
    delete revealed[id];
    var h = document.getElementById('admCredList'); if(h) h.innerHTML = admCredHTML();
    return;
  }
  GOC.api.revealPassword(id).then(function(r){
    revealed[id] = r.password;
    var w = document.getElementById('admCredList'); if(w) w.innerHTML = admCredHTML();
  }).catch(function(err){
    // Server mode lands here by design — hashes cannot be reversed.
    toast(err.message || 'Password cannot be shown');
  });
}
function admResetPw(id){
  GOC.api.resetPassword(id).then(function(r){
    if(r.temporaryPassword){
      revealed[id] = r.temporaryPassword;
      toast('Temporary password issued for '+r.id+' — student must change it on next login');
    } else {
      toast('Reset link sent for '+r.id+' — the student sets their own new password');
    }
    var w = document.getElementById('admCredList'); if(w) w.innerHTML = admCredHTML();
  }).catch(function(err){ toast(err.message || 'Could not reset that password'); });
}
/* Copy the signed-in scholar's ID. No clipboard permissions in the prototype —
   we select the text so the student can copy it with one gesture. */
function copyId(){
  var c = document.getElementById('idCode') || document.getElementById('dashId');
  if(!c) return;
  try{
    var r = document.createRange(); r.selectNodeContents(c);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }catch(e){}
  toast('Scholar ID '+c.textContent+' selected — tap Copy on your keyboard');
}
/* Identity: the ID prefix decides the account type.
   GOC-A-…  = management / staff  → console available (behind the access portal)
   GOC-S-… or an email = student  → console never shown */
/* Paints the signed-in user onto the screens. `user` is exactly what
   GOC.api.login() resolved with: {id, name, role, title}. This function makes
   no decisions about who may log in — the API already did. */
function applyIdentity(user){
  if(!user || !user.id) return false;
  var code = String(user.id).toUpperCase();
  var isStaff = user.role === 'admin';
  role = isStaff ? 'admin' : 'student';
  adminUnlocked = false;
  var staff = { name: user.name, title: user.title || 'Management' };
  var name = user.name || code;
  var first = String(name).trim().split(/\s+/)[0];
  studentFirst = isStaff ? '' : first;
  var set = function(el,v){ var e=document.getElementById(el); if(e) e.textContent=v; };
  set('idName', name);
  set('idAva', initials(name));
  set('idRole', isStaff ? ('Management · ' + staff.title) : 'Student');
  set('idLabel', isStaff ? 'Staff ID' : 'Scholar ID');
  set('idCode', code);
  set('dashId', code);
  set('profName', name);
  set('profAva', initials(name));
  set('profId', (isStaff ? 'Staff ID · ' : 'Scholar ID · ') + code);
  if(isStaff) set('admWho', staff.name + ' · ' + staff.title);
  // The student dashboard greeting says "Management" when staff are viewing it,
  // so it's always obvious whose screen you're looking at.
  set('dashHello', isStaff ? 'Viewing as' : 'Good afternoon,');
  set('dashName', isStaff ? ('Management 👋') : (first + ' 👋'));
  set('idNote', isStaff
    ? 'Staff IDs are issued to management only and cannot be self-registered — the console is limited to the Founder and the Academic Director, and still requires the secure access passcode.'
    : 'Your Scholar ID identifies you across lessons, practice, CBT and the league — keep it safe, you log in with it.');
  var strip = document.getElementById('idStrip');
  if(strip) strip.style.display = isStaff ? 'none' : 'flex';
  var entry = document.getElementById('adminEntry');
  if(entry) entry.style.display = isStaff ? 'inline-flex' : 'none';
  /* The account's stored JAMB combination drives every subject-aware surface.
     Staff previewing the dashboard see the full five papers. */
  applySubjects(isStaff ? [] : (user.subjects || []));
  return true;
}
function changeStudentPassword(){
  var pw = String(((document.getElementById('newStudentPassword') || {}).value || ''));
  var pw2 = String(((document.getElementById('confirmStudentPassword') || {}).value || ''));
  var btn = document.getElementById('changePasswordBtn');

  formMsg('changePwMsg', '');
  if(!pw) return formMsg('changePwMsg', 'Type your new password');
  if(pw !== pw2) return formMsg('changePwMsg', 'The two passwords do not match');

  busy(btn, true);

  GOC.api.changePassword(pw).then(function(){
    busy(btn, false);
    if(typeof admClear === 'function'){
      admClear(['newStudentPassword','confirmStudentPassword']);
    } else {
      var a = document.getElementById('newStudentPassword');
      var b = document.getElementById('confirmStudentPassword');
      if(a) a.value = '';
      if(b) b.value = '';
    }

    /* The screen changes to login-v2 right after this, so an inline message
       on THIS screen would never be seen — and Task 5 says remove toast()
       here too, since this isn't one of the two named exceptions. The login
       screen already has its own notice area (#loginNotice, used for the
       "your session ended" message from ssNotice()); go('login-v2') clears
       it on the way in, so it's set here AFTER go(), reusing that same
       element rather than adding a second one. */
    if (typeof GOC !== 'undefined' && GOC.api && typeof GOC.api.logout === 'function') {
      GOC.api.logout();
    }
    go('login-v2');
    var pwNotice = document.getElementById('loginNotice');
    if(pwNotice){
      pwNotice.innerHTML = '<b>Password updated.</b> Please log in with your new password.';
      pwNotice.style.display = 'block';
    }
  }).catch(function(err){
    busy(btn, false);
    var a = document.getElementById('newStudentPassword');
    var b = document.getElementById('confirmStudentPassword');
    if(a) a.value = '';
    if(b) b.value = '';
    formMsg('changePwMsg', err.message || 'That password was not changed');
  });
}

function logout(){
  GOC.api.logout();                      // drop the server session / demo session
  if(typeof ssStop === 'function') ssStop();   // and stop watching the clock
  if(typeof swStop === 'function') swStop();   // and stop the study-window heartbeat
  staffData = [];
  role = 'student'; adminUnlocked = false;
  studentsData = [];                     // the next user must re-fetch the roster
  mySubjects = null;                     // and the next user must not inherit this one's papers
  wtCatalogue = null;                    // nor this one's web-test catalogue
  wtPaper = null; wtResp = {}; cbtPaper = null;
  if(wtTimerId){ clearInterval(wtTimerId); wtTimerId = null; }
  previewing = false;
  revealed = {};                        // no revealed password survives a logout
  document.body.classList.remove('previewing');
  var pb = document.getElementById('pvBar'); if(pb) pb.style.display = 'none';
  var entry = document.getElementById('adminEntry'); if(entry) entry.style.display='none';
  // Blank the identity fields so a signed-out page never shows the last user.
  ['idName','idCode','dashId','dashName','profName','profId','admWho'].forEach(function(k){
    var e = document.getElementById(k); if(e) e.textContent = '\u2014';
  });
  go('landing');
}
/* ================= SIGN-UP: EXAM + SUBJECT COMBINATION =================
   Both rules are owned by js/goc-core.js and reachable here as GOC.api.rules,
   so the form validates with exactly the code the API enforces with. The form
   is the courtesy; the API is the control. */
function rulebook(){ return (window.GOC && GOC.api && GOC.api.rules) || null; }

/* This academy prepares UTME candidates only. Choosing anything else explains
   why rather than failing silently. */
function examPicked(){
  var sel = document.getElementById('signGoal');
  var note = document.getElementById('examNote');
  if(!sel) return true;
  var r = rulebook();
  var verdict = r ? r.validateExam(sel.value)
                  : { ok: !/post/i.test(sel.value) && /utme|jamb/i.test(sel.value) };
  if(note) note.hidden = !!verdict.ok;
  // Name the examination the student actually chose, so the notice reads as an
  // answer to what they just did.
  var body = document.getElementById('examNoteBody');
  if(body && !verdict.ok && verdict.error) body.textContent = verdict.error;
  return verdict.ok;
}
function scienceBoxes(){ return list(document.querySelectorAll('#subjGrid input[type=checkbox]')); }
function chosenSciences(){
  var out = [];
  scienceBoxes().forEach(function(c){ if(c.checked) out.push(c.getAttribute('data-subject')); });
  return out;
}
/* Exactly three sciences: a fourth tick is refused at the moment it happens,
   which is kinder than letting the form fill up and then rejecting it. */
function subjToggle(box){
  if(box.checked && chosenSciences().length > 3){
    box.checked = false;
    paintSubjPick('That would be five papers. Untick a science first, then pick this one.');
    return;
  }
  paintSubjPick('');
}
function paintSubjPick(msg){
  var picked = chosenSciences();
  scienceBoxes().forEach(function(c){
    var lbl = c.parentNode;
    if(lbl && lbl.classList) lbl.classList.toggle('on', c.checked);
  });
  var cnt = document.getElementById('subjCount');
  if(cnt){
    cnt.textContent = picked.length + ' of 3 sciences chosen' + (picked.length === 3 ? ' · 4 papers in all' : '');
    cnt.classList.toggle('done', picked.length === 3);
  }
  var m = document.getElementById('subjMsg');
  if(m) m.textContent = msg || '';
}
/* The combination the student is asking for: the compulsory paper plus their
   sciences. Returned in full so the API validates the same array shown. */
function chosenCombination(){
  var r = rulebook();
  var english = r ? r.ENGLISH : 'Use of English';
  return [english].concat(chosenSciences());
}

/* Sign-up always creates a student account and issues a Scholar ID.
   The new scholar is added to the roster so management can look the ID up. */
function signupSubmit(){
  var nm = ((document.getElementById('signName')||{}).value||'').trim();
  var pw = ((document.getElementById('signPw')||{}).value||'');
  var em = ((document.getElementById('signEmail')||{}).value||'').trim();
  var ph = ((document.getElementById('signPhone')||{}).value||'').trim();
  var goal = ((document.getElementById('signGoal')||{}).value||'');
  var code = ((document.getElementById('signCode')||{}).value||'');
  var btn = document.getElementById('signupBtn');
  /* The create-account firewall, checked first here for the same reason the
     server checks it first: somebody without the academy's code should be sent
     away before they are walked through the rest of the form. The screen only
     catches the obvious cases — whether the code is *right* is decided by the
     data layer, which is the only place that holds it. */
  var rb = rulebook();
  var codeCheck = rb ? rb.validateSignupCode(code) : null;
  if(codeCheck && codeCheck.error){
    var cf = document.getElementById('signCode');
    if(cf && cf.focus) cf.focus();
    toast(codeCheck.error);
    return;
  }
  /* UTME only — checked here so the student is told why, and again by the API
     so the rule holds however the call arrives. */
  if(!examPicked()){
    var sel = document.getElementById('signGoal');
    if(sel && sel.focus) sel.focus();
    toast('G.O.C Academy Hub prepares UTME candidates only — choose JAMB / UTME 2027.');
    return;
  }
  var combo = chosenCombination();
  var r = rulebook();
  var check = r ? r.validateSubjects(combo) : { ok:true, subjects: combo };
  if(!check.ok){
    paintSubjPick(check.error);
    toast(check.error);
    var pick = document.getElementById('subjPick');
    if(pick && pick.scrollIntoView) pick.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  busy(btn, true);
  // The server issues the Scholar ID, so two people signing up at the same
  // moment can never be handed the same one.
  GOC.api.createStudent({signupCode:code, name:nm, password:pw, email:em, phone:ph, goal:goal, subjects:check.subjects}).then(function(r2){
    busy(btn, false);
    /* Priority 1.3 — same hand-off as the login, and in the same place: after
       the account exists, before the dashboard is shown. The order of
       everything below is unchanged. */
    if(typeof animEnter === 'function') animEnter('id');
    applyIdentity(r2.session);
    loadSettings();
    go('home');
    buildWeek(); renderClasses(); renderResources();
    wtCatalogue = null;
    refreshMe();
    renderLeague();                     // Priority 12 — a new scholar joins the standings
    ssStart();                          // Priority 9 — a new account is a new session
    swStart();                          // and begin the daily study-window heartbeat
    toast('Account created · your Scholar ID is '+r2.student.id+' — it stays on your dashboard');
    setTimeout(openFlyer, 700);
  }).catch(function(err){
    busy(btn, false);
    var msg = err.message || 'Could not create that account';
    /* A refused access code is the one failure the visitor can fix on the spot,
       so send them back to that field rather than leaving them to hunt. */
    if(msg.indexOf('access code') > -1){
      var cf2 = document.getElementById('signCode');
      if(cf2){ cf2.value = ''; if(cf2.focus) cf2.focus(); }
    }
    toast(msg);
  });
}

/* ================= SUBJECT PERSONALIZATION =================
   The combination stored on the account is the single source of truth. No screen
   keeps its own subject list: every subject-aware surface asks mySubjectList()
   and redraws. Signed out — or in the public demo — all five papers show, which
   is what the marketing pages are describing. */
var SUBJECT_META = {
  'Use of English': { ab:'En', color:'#4F46E5', pct:80 },
  'Physics':        { ab:'Ph', color:'#DC2626', pct:45 },
  'Chemistry':      { ab:'Ch', color:'#0E7490', pct:72 },
  'Biology':        { ab:'Bi', color:'#15803D', pct:60 },
  'Mathematics':    { ab:'Ma', color:'#7F1D1D', pct:38 }
};
/* Some existing content was written with short forms. Canonicalise rather than
   rewrite the content, so nothing that already works has to change. */
var SUBJECT_ALIASES = { 'Maths':'Mathematics', 'Math':'Mathematics', 'English':'Use of English' };
var mySubjects = null;                 // null until a student account is signed in

function canonSubject(name){
  var n = String(name == null ? '' : name).trim();
  return SUBJECT_ALIASES[n] || n;
}
function mySubjectList(){
  if(mySubjects && mySubjects.length) return mySubjects.slice();
  var r = rulebook();
  return r ? r.ALL_SUBJECTS.slice() : ['Use of English','Physics','Chemistry','Biology','Mathematics'];
}
/* Canonical order (English first), narrowed to what this student sits. */
function orderedSubjects(){
  var r = rulebook();
  var all = r ? r.ALL_SUBJECTS.slice() : ['Use of English','Physics','Chemistry','Biology','Mathematics'];
  var mine = mySubjectList();
  return all.filter(function(s){ return mine.indexOf(s) > -1; });
}
/* True when a piece of content belongs to this student. Anything that is not a
   subject at all — a CBT block, a revision slot, an all-subject syllabus —
   belongs to everyone. */
function studiesSubject(name){
  var n = canonSubject(name);
  if(!SUBJECT_META[n]) return true;

  return mySubjectList().some(function(subject){
    var mine = canonSubject(subject);

    if(mine === n) return true;

    /* Be tolerant of harmless label differences while keeping
       subject access restricted to the student's actual subjects. */
    return String(mine).trim().toLowerCase() ===
           String(n).trim().toLowerCase();
  });
}
/* Called with whatever the API reported for the signed-in account. */
function applySubjects(subs){
  var clean = [];
  (subs || []).forEach(function(s){
    var n = canonSubject(s);
    if(SUBJECT_META[n] && clean.indexOf(n) < 0) clean.push(n);
  });
  mySubjects = clean.length ? clean : null;
  paintSubjectSurfaces();
}
function paintSubjectSurfaces(){
  renderClassFilters();
  renderClasses();
  renderResources();
  if(document.getElementById('weekStrip') && document.getElementById('ttBlocks')) renderDay();
}
function renderClassFilters(){
  var host = document.getElementById('classFilters');
  if(!host) return;
  var subs = orderedSubjects();
  // A filter for a paper the student dropped would show an empty shelf.
  if(classFilter !== 'all' && subs.indexOf(canonSubject(classFilter)) < 0) classFilter = 'all';
  var html = '<button class="fchip' + (classFilter === 'all' ? ' on' : '') + '" data-f="all" onclick="setClassFilter(\'all\')" aria-pressed="' + (classFilter === 'all') + '">All</button>';
  subs.forEach(function(s){
    html += '<button class="fchip' + (classFilter === s ? ' on' : '') + '" data-f="' + esc(s) + '" ' +
            'onclick="setClassFilter(&quot;' + esc(s) + '&quot;)" aria-pressed="' + (classFilter === s) + '">' + esc(s) + '</button>';
  });
  host.innerHTML = html;
}
function openFlyer(){
  var d = new Date();
  var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('flyerDate').textContent = days[d.getDay()]+' · '+d.getDate()+' '+months[d.getMonth()];
  affIndex = d.getDate() % affirmations.length;
  document.getElementById('flyerQuote').textContent = affirmations[affIndex];
  document.getElementById('flyerOverlay').classList.add('show');
  if(!affirmationsLoaded) loadAffirmations();
}
function closeFlyer(){ document.getElementById('flyerOverlay').classList.remove('show'); }

/* ================= AUTH HELPERS ================= */
function togglePw(id,btn){
  var f=document.getElementById(id); if(!f) return;
  var show=f.type==='password'; f.type=show?'text':'password';
  btn.textContent=show?'Hide':'Show';
}
function scrollToContact(){
  var c=document.getElementById('contact');
  if(c && c.scrollIntoView) c.scrollIntoView({behavior:'smooth', block:'start'});
}
function sendContact(){
  var n=document.getElementById('cName'), e=document.getElementById('cEmail'), m=document.getElementById('cMsg');
  var btn=document.getElementById('cSendBtn'), status=document.getElementById('cStatus');
  var firstName=(n&&n.value.trim().split(' ')[0])||'there';
  if(status){ status.className='lp-cstatus'; status.textContent=''; }
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  GOC.api.sendContact({
    name: n && n.value, email: e && e.value, message: m && m.value
  }).then(function(){
    if(n)n.value='';if(e)e.value='';if(m)m.value='';
    if(status){ status.className='lp-cstatus ok'; status.textContent='Thanks '+firstName+'! Your message has been sent to the G.O.C Academy team — we usually reply within a day.'; }
  }).catch(function(err){
    if(status){ status.className='lp-cstatus err'; status.textContent=(err&&err.message)||'Please check the form and try again.'; }
  }).then(function(){
    if(btn){ btn.disabled=false; btn.textContent='Send message'; }
  });
}
var updatesData = [];      // cache of GET /updates

/* Homepage updates are public, so this runs before anyone logs in. */
function loadUpdates(){
  return GOC.api.listUpdates().then(function(rows){
    updatesData = rows || [];
    renderUpdates();
    var mu = document.getElementById('admUpList'); if(mu) mu.innerHTML = admUpdatesHTML();
    return updatesData;
  }).catch(function(){
    var l = document.getElementById('upList');
    if(l) l.innerHTML = '<p class="ad-p">Updates could not be loaded right now.</p>';
    return [];
  });
}
var upActiveFilter = 'all';
function renderUpdates(){
  var list=document.getElementById('upList'); if(!list) return;
  list.innerHTML = updatesData.map(function(u){
    var label={admission:'Admission',utme:'UTME',scholarship:'Scholarship',news:'News'}[u.cat];
    return '<article class="up-card" data-cat="'+u.cat+'"><div class="tagrow"><span class="up-tag '+u.cat+'">'+label+'</span><span class="date">'+esc(u.date)+'</span></div><h3>'+esc(u.title)+'</h3><p>'+esc(u.body)+'</p><button class="more" onclick="'+(u.ctaAction||"go('signup')")+'">'+esc(u.ctaLabel||'Learn more →')+'</button></article>';
  }).join('');
  // re-apply current filter
  var cards=list.querySelectorAll('.up-card');
  for(var j=0;j<cards.length;j++){ var show = upActiveFilter==='all' || cards[j].getAttribute('data-cat')===upActiveFilter; cards[j].style.display = show?'':'none'; }
}
function filterUpdates(cat,btn){
  var chips=document.querySelectorAll('#upFilters .up-chip');
  for(var i=0;i<chips.length;i++){ chips[i].classList.remove('on'); chips[i].setAttribute('aria-pressed','false'); }
  if(btn){ btn.classList.add('on'); btn.setAttribute('aria-pressed','true'); }
  upActiveFilter = cat;
  var cards=document.querySelectorAll('#upList .up-card');
  for(var j=0;j<cards.length;j++){
    var show = cat==='all' || cards[j].getAttribute('data-cat')===cat;
    cards[j].style.display = show ? '' : 'none';
  }
  /* A chip the student had to scroll to reach is pulled fully into view, so the
     one that is now active is never the half-cut one at the edge. */
  if(btn && btn.scrollIntoView){
    try { btn.scrollIntoView({block:'nearest', inline:'nearest', behavior:'smooth'}); } catch(e){}
  }
  upFadeSync();
}

/* ===== Updates & News filter row (Priority 2) =====
   Two separate faults were being seen as one. First, the chip row was not
   sticky, so scrolling slid it up underneath the sticky .lp-nav and left the
   chips cut in half. The wrapper is now sticky and parks directly below the
   nav — but the nav's height changes with the breakpoint, so it is measured
   here rather than guessed in the stylesheet. Second, five chips are wider
   than a phone, so Scholarship and News sat off-screen with nothing to say so.
   A right-edge fade appears whenever there is more row to reach. */
function upStickTop(){
  var scr = document.getElementById('updates');
  if(!scr || !scr.querySelector) return;
  var nav = scr.querySelector('.lp-nav');
  var h = nav && nav.offsetHeight ? nav.offsetHeight : 0;
  var root = document.documentElement;
  if(h && root && root.style && root.style.setProperty){
    root.style.setProperty('--goc-navh', h + 'px');
  }
}
function upFadeSync(){
  var row = document.getElementById('upFilters');
  var wrap = document.getElementById('upFilterWrap');
  if(!row || !wrap || !wrap.classList) return;
  var left = (row.scrollWidth || 0) - (row.clientWidth || 0) - (row.scrollLeft || 0);
  if(left > 4) wrap.classList.add('up-more'); else wrap.classList.remove('up-more');
}
var upFiltersWired = false;
function upFiltersInit(){
  upStickTop(); upFadeSync();
  if(upFiltersWired) return;          /* listeners are attached once, not per visit */
  upFiltersWired = true;
  var row = document.getElementById('upFilters');
  if(row && row.addEventListener) row.addEventListener('scroll', upFadeSync);
  if(window.addEventListener) window.addEventListener('resize', function(){ upStickTop(); upFadeSync(); });
}
function scrollContactFromUpdates(){
  go('landing');
  setTimeout(scrollToContact,60);
}
function nextAffirmation(){
  affIndex = (affIndex+1) % affirmations.length;
  document.getElementById('flyerQuote').textContent = affirmations[affIndex];
}

/* ================= PRIORITY 1 — PREMIUM MOTION =================
   The stylesheet holds the effects; this holds the two decisions the CSS
   cannot make for itself: whether to animate at all, and when a section has
   come into view.

   The order here matters. html.anim-on is what hides the cards ready to be
   revealed, so it is added ONLY after this code has established that it can
   also reveal them — an IntersectionObserver to notice the section arriving,
   and a classList to act on. If either is missing, or the student has asked
   for reduced motion, the class is never added and the page renders plainly.
   A motion effect that fails must leave the content readable, not blank. */

var animOn = false;              /* has the reveal machinery been switched on */
var animObserver = null;

function animWanted(){
  var root = document.documentElement;
  if(!root || !root.classList) return false;
  if(typeof window.IntersectionObserver !== 'function') return false;
  /* The student's own setting wins over ours. */
  if(window.matchMedia){
    var q = window.matchMedia('(prefers-reduced-motion: reduce)');
    if(q && q.matches) return false;
  }
  return true;
}

/* Everything the landing page reveals on scroll, as [element, ...]. The class
   goes on the container, and the stylesheet staggers the children — so a
   section is one decision rather than one per card. */
function animSections(){
  var out = [], i;
  var sel = ['#lpFeatures .lp-grid', '#lpSubjects .lp-subj'];
  for(i = 0; i < sel.length; i++){
    var el = document.querySelector(sel[i]);
    if(el) out.push(el);
  }
  return out;
}

function animInit(){
  if(animOn) { animSweep(); return; }
  if(!animWanted()) return;
  var sections = animSections();
  if(!sections.length) return;

  document.documentElement.classList.add('anim-on');
  animOn = true;

  animObserver = new window.IntersectionObserver(function(entries){
    for(var i = 0; i < entries.length; i++){
      var e = entries[i];
      if(e.isIntersecting && e.target.classList){
        e.target.classList.add('rv');
        animObserver.unobserve(e.target);   /* a reveal happens once, not on every pass */
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  for(var j = 0; j < sections.length; j++) animObserver.observe(sections[j]);

  /* A section already on screen when the page opens would otherwise wait for a
     scroll that never comes. */
  animSweep();
}

/* Reveals anything already within the viewport. Also the safety net: if the
   observer has not fired for a section the student has plainly reached, this
   catches it on the next visit to the page. */
function animSweep(){
  if(!animOn) return;
  var sections = animSections(), i, el, box;
  var h = window.innerHeight || 800;
  for(i = 0; i < sections.length; i++){
    el = sections[i];
    if(!el.classList || el.classList.contains('rv')) continue;
    box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if(!box || box.top < h * 0.92){
      el.classList.add('rv');
      if(animObserver) animObserver.unobserve(el);
    }
  }
}

/* --- 1.2 and 1.3: the hand-off into the app ---------------------------
   Signing in and signing up should feel like the app opened rather than that
   a tab changed. Rather than delay the navigation — which would put a timer
   between the student and their dashboard — the incoming screen is simply
   marked for a richer entrance, and go() applies it to exactly one activation.
   Nothing waits on an animation, so a dropped frame cannot strand anyone. */
var animEnterOnce = false;
var animEnterId = false;
/* kind is 'id' for the sign-up hand-off, where the Scholar ID the server has
   just issued is the last thing to settle. Anything else is an ordinary
   arrival. Neither one delays go(): all this does is set a flag that the next
   activation turns into a class. */
function animEnter(kind){ animEnterOnce = true; animEnterId = (kind === 'id'); }

/* ================= FOCUS LIMIT RING =================
   Draws from state.studyLeftSec when it's known (a real answer from
   getMySettings() or a ping) and only falls back to the coarse
   limit-minus-used-minutes arithmetic before that first real answer has
   arrived, so the ring never sits on a guessed number for long. */
function updateFocus(){
  var limitSec = Math.max(0, Number(state.limit) || 0) * 60;
  var leftSec = (state.studyLeftSec != null)
    ? Math.max(0, Number(state.studyLeftSec) || 0)
    : Math.max(0, limitSec - (Number(state.used) || 0) * 60);
  var leftMin = Math.ceil(leftSec / 60);
  var frac = limitSec ? Math.max(0, Math.min(1, leftSec / limitSec)) : 0;
  var r=40, c=2*Math.PI*r;
  var arc = document.getElementById('focusArc');
  arc.setAttribute('stroke-dasharray', c);
  arc.setAttribute('stroke-dashoffset', c*(1-frac));
  arc.setAttribute('stroke', leftMin<=15 ? '#D97706' : '#DC2626');
  document.getElementById('focusMin').textContent = leftMin;
  document.getElementById('focusText').textContent = 'Learn here, then read on your own, apply it, and bring questions to your tutor.';
  // The wind-down card is the whole point of the daily limit, so show it when it is spent —
  // exhausted comes from the server whenever it's known, never guessed client-side.
  var exhausted = state.studyExhausted || (state.studyLeftSec != null && leftSec <= 0);
  if(exhausted) showWinddown(); else hideWinddown();
}
/* Folds a studyWindowStatus()-shaped response (from getMySettings or a ping)
   into state and repaints the ring/gate from it. Never called with a guess —
   only with what the server (or the offline mock driver, for file:// preview)
   actually returned. */
function paintStudyWindow(win){
  if(!win) return;
  if(win.dailyLimitMin != null) state.limit = Number(win.dailyLimitMin) || state.limit;
  if(win.usedMin != null) state.used = Number(win.usedMin) || 0;
  state.studyLeftSec = (win.leftSec != null) ? Number(win.leftSec) : null;
  state.studyExhausted = !!win.exhausted;
  // Any guardian-granted bonus minutes for today, and how many "Add 15 min"
  // grants are still available today. Derived the same way server.js derives
  // them (bonusMin / EXTRA_TIME_GRANT_MIN) rather than guessed, so the
  // wind-down copy and the extend button can never promise a grant the
  // server would refuse. Falls back to the same defaults core.js ships with
  // if the rulebook isn't reachable yet.
  state.studyBonusMin = (win.bonusMin != null) ? Math.max(0, Number(win.bonusMin) || 0) : 0;
  var rb0 = rulebook();
  var grantMin = (rb0 && rb0.EXTRA_TIME_GRANT_MIN) || 15;
  var maxGrants = (rb0 && rb0.EXTRA_TIME_MAX_GRANTS_PER_DAY != null) ? rb0.EXTRA_TIME_MAX_GRANTS_PER_DAY : 2;
  var grantsUsed = grantMin ? Math.round(state.studyBonusMin / grantMin) : 0;
  state.studyExtensionsLeft = Math.max(0, maxGrants - grantsUsed);
  updateFocus();
  // If a student is sitting on a screen whose Start button depends on this,
  // relabel it immediately rather than waiting for the next navigation —
  // the wind-down overlay above already blocks the screen either way, but a
  // still-visible button should never say something the click will refuse.
  var active = document.querySelector('.screen.active');
  var activeId = active && active.id;
  if(activeId === 'studySet' && typeof renderStudySet === 'function') renderStudySet();
  if(activeId === 'webtest' && typeof renderWebTest === 'function') renderWebTest();
}
function showWinddown(){
  paintWinddownText();
  var o=document.getElementById('windOverlay'); if(o) o.classList.add('show');
}
function hideWinddown(){ var o=document.getElementById('windOverlay'); if(o) o.classList.remove('show'); }

/* ============ PRE-TEST INSTRUCTIONS ============
   Shown once, right before the actual attempt is created, for both the
   Practice/CBT screen and the Web Test screen — so "what this is" and "how
   this is marked" is read before the click that really starts the clock,
   not discovered afterward. One overlay, one pair of show/hide functions;
   only the title/about/rules text and the confirm callback differ by
   context. Cancel just closes it — nothing has started yet at that point. */
var tiConfirm = null;
function showTestInfo(title, about, rules, onConfirm){
  tiConfirm = onConfirm;
  var t = document.getElementById('tiTitle'); if(t) t.textContent = title;
  var a = document.getElementById('tiAbout'); if(a) a.textContent = about;
  var ul = document.getElementById('tiRules');
  if(ul) ul.innerHTML = rules.map(function(r){ return '<li>' + esc(r) + '</li>'; }).join('');
  var o = document.getElementById('testInfoOverlay'); if(o) o.classList.add('show');
}
function hideTestInfo(){
  tiConfirm = null;
  var o = document.getElementById('testInfoOverlay'); if(o) o.classList.remove('show');
}
function confirmTestInfo(){
  var fn = tiConfirm;
  hideTestInfo();
  if(fn) fn();
}
/* What Practice/CBT's Start button is about to do, in the student's own
   picks (subject, topic count, question count, minutes) — never a generic
   paragraph, so the instructions actually describe the run they set up. */
function suInstructions(){
  var prac = suMode === 'practice';
  var about;
  if(prac){
    about = suSubj + ' practice \u00b7 ' + suCount + ' question' + (suCount !== 1 ? 's' : '')
      + ', shuffled fresh for this run.';
  } else {
    var topicWord = suChosen().length === 1 ? 'topic' : 'topics';
    about = suSubj + ' CBT \u00b7 ' + suCount + ' question' + (suCount !== 1 ? 's' : '')
      + ' on the ' + suChosen().length + ' ' + topicWord + ' you picked, ' + suMins + ' minutes.';
  }
  return {
    title: prac ? 'Before you start practice' : 'Before you start your CBT',
    about: about,
    rules: prac ? [
      'Each answer is marked the moment you pick it, and the explanation shows right away.',
      'Untimed \u2014 there is no clock, and you can come back to this set-up screen any time.',
      'This still counts toward today\u2019s study window.'
    ] : [
      'The clock starts the moment you press Start below and cannot be paused.',
      'Your answers are marked only once you submit at the end, not question by question.',
      'This counts toward today\u2019s study window.'
    ]
  };
}
/* Same idea for a Web Test row: names the actual paper (subject, section,
   question count, its real clock or the lack of one, and the papers inside
   an objective sitting) rather than a one-size-fits-all notice. */
function wtInstructions(t){
  var timed = Number(t.durationSec) > 0;
  var about = t.subject + ' \u00b7 ' + wtSectionLabel(t.section) + ' \u00b7 ' + t.questions
    + ' question' + (t.questions !== 1 ? 's' : '') + ' \u00b7 ' + (timed ? wtMinutes(t.durationSec) : 'no time limit');
  if(t.papers && t.papers.length) about += ' \u00b7 ' + wtPapersLine(t.papers);
  return {
    title: 'Before you start',
    about: about,
    rules: [
      timed ? 'The clock starts the moment you press Start below and cannot be paused or restarted.'
            : 'There is no clock on this paper \u2014 work at your own pace.',
      'Once you submit, your answers are final and sent for marking.',
      'Stay on this screen until you submit \u2014 closing or refreshing the tab can end your attempt.',
      'This counts toward today\u2019s study window.'
    ]
  };
}
function wtConfirmStart(t, btn){
  var info = wtInstructions(t);
  showTestInfo(info.title, info.about, info.rules, function(){ wtStart(t.period, t.section, t.subject, btn); });
}
/* The wind-down card used to carry a fixed "90-minute… Amara" sentence no
   matter who was signed in or what the academy's limit actually was. This
   fills in the real limit and the real student's first name every time the
   card is shown. */
function paintWinddownText(){
  var p = document.getElementById('windMsg');
  if(!p) return;
  var who = studentFirst || 'there';
  var lim = Math.max(0, Number(state.limit) || 0);
  var bonus = Math.max(0, Number(state.studyBonusMin) || 0);
  var msg = 'You\u2019ve reached your ' + lim + '-minute daily limit';
  if(bonus) msg += ' (already includes ' + bonus + ' extra minute' + (bonus === 1 ? '' : 's') + ' added today)';
  msg += '. Great work, ' + who + ' — rest lets what you learned settle. Come back tomorrow to keep your streak. \uD83D\uDD25';
  p.textContent = msg;
  // Keeps a stale error from an earlier attempt from lingering into the
  // next time the overlay is shown.
  var e = document.getElementById('windPinErr'); if(e) e.textContent = '';
  // The PIN field only makes sense to show if a guardian PIN is actually
  // set — swExtend() would otherwise just no-op with "Enter the guardian
  // PIN." forever. state.hasGuardianPin is populated either by
  // paintGuardianPin() (console) or, for a real student session, directly
  // from getMySettings()'s hasGuardianPin flag in loadSettings() — both
  // land in the same state field, so this check works for either session.
  var wrap = document.getElementById('windExtendWrap');
  if(wrap) wrap.style.display = state.hasGuardianPin ? 'block' : 'none';
}
/* The daily study window is an academy-wide setting, so it is stored on the
   server. The screen updates once the save is confirmed, never before. */
function adminSetLimit(delta){
  var want = Math.max(30, Math.min(180, state.limit + delta));
  if(want === state.limit) return;
  GOC.api.setDailyLimit(want).then(function(cfg){
    paintLimit(cfg.dailyLimitMin);
    toast('Daily study window set to '+state.limit+' minutes');
  }).catch(function(err){ toast(err.message || 'Could not save that setting'); });
}
function paintLimit(min){
  state.limit = Number(min) || state.limit;
  var a=document.getElementById('admLimit');    if(a) a.textContent = state.limit;
  var b=document.getElementById('admLimitVal'); if(b) b.textContent = state.limit+' min';
  var lv=document.getElementById('limitVal');   if(lv) lv.textContent = state.limit+' min';
  updateFocus();
}
function loadSettings(){
  var isStudent = role === 'student';
  var call = isStudent ? GOC.api.getMySettings() : GOC.api.getSettings();
  return call.then(function(cfg){
    paintLimit(cfg.dailyLimitMin);
    paintSession(cfg);
    // An admin's settings response carries both the yes/no flag and (for
    // prefilling the edit form) the actual digits, so it gets the full
    // paint. getMySettings() now carries the flag too (effectiveSettingsFor()
    // on the server, the mock driver's getMySettings() offline) but never the
    // digits — a student only needs to know whether the wind-down overlay's
    // PIN field should show at all.
    if(!isStudent) paintGuardianPin(cfg);
    else if(cfg && cfg.hasGuardianPin != null) state.hasGuardianPin = !!cfg.hasGuardianPin;
    // Only getMySettings() carries this student's real usage today — the
    // academy-wide getSettings() an admin gets back has no personal window.
    if(isStudent && cfg && cfg.exhausted != null) paintStudyWindow(cfg);
  }).catch(function(){ updateFocus(); });   // keep the current value if unreachable
}

/* ============================================ PRIORITY 9 — the session clock
   Management sets how long a student may stay signed in and how much notice
   they get before the end. Both live in the settings; the expiry itself lives
   on the server, which refuses every protected route once a token is past it
   and deletes the token on the next request. This block therefore never
   *decides* anything about access. It asks the data layer how long is left,
   shows that as a countdown, and when the answer reaches zero it ends the
   session here too so the page cannot be left sitting on a dashboard it is no
   longer entitled to.

   Two intervals, deliberately: a poll every 20 seconds for the truth, and a
   one-second tick that only redraws. That keeps the countdown smooth without
   ever making the page the authority on time. A failed poll is not a logout —
   it keeps counting down from the last expiry the server gave it and tries
   again, because a dropped connection must not throw a student out. */
var ss = { on:false, expiresAt:0, warnSec:300, tick:0, poll:0, ending:false, netFail:0 };

function ssFmt(sec){
  var r = rulebook();
  if(r && r.fmtCountdown) return r.fmtCountdown(sec);
  var s = Math.max(0, Math.round(sec)), m = Math.floor(s/60), q = s%60;
  return (m<10?'0':'')+m+':'+(q<10?'0':'')+q;
}
/* Students only. Staff keep a fixed working session and never see this bar. */
function ssStart(){
  ssStop();
  if(role !== 'student') return;
  ss.on = true; ss.ending = false; ss.netFail = 0; ss.expiresAt = 0; ss.warnSec = 300;
  ssPoll();
  ss.poll = setInterval(ssPoll, 20000);
  ss.tick = setInterval(ssTick, 1000);
}
function ssStop(){
  if(ss.poll) clearInterval(ss.poll);
  if(ss.tick) clearInterval(ss.tick);
  ss.poll = 0; ss.tick = 0; ss.on = false;
  ssHide();
}
function ssHide(){
  var b = document.getElementById('ssBar'); if(b) b.style.display = 'none';
  document.body.classList.remove('session-warning');
}
function ssLeft(){
  if(!ss || !ss.expiresAt) return null;
  return Math.round((ss.expiresAt - Date.now()) / 1000);
}
/* True only once a watched session has genuinely run out — never before a
   student has logged in, so this cannot block the public screens. */
function ssExpired(){
  if(!ss || !ss.on) return false;
  var l = ssLeft();
  return l !== null && l <= 0;
}
function ssPoll(){
  if(!ss.on || ss.ending) return;
  GOC.api.sessionInfo().then(function(info){
    if(!ss.on || ss.ending) return;
    if(!info || info.active === false){ ssEnd('expired'); return; }
    ss.netFail = 0;
    if(info.warnInSec) ss.warnSec = Math.max(30, Number(info.warnInSec) || 300);
    ss.expiresAt = Number(info.expiresAt) ||
      (Date.now() + (Number(info.expiresInSec) || 0) * 1000);
    ssTick();
  }).catch(function(){
    ss.netFail++;                 // keep the last known expiry and try again
  });
}
function ssTick(){
  if(!ss.on || ss.ending) return;
  var left = ssLeft();
  if(left === null) return;
  if(left <= 0){ ssEnd('expired'); return; }
  if(left <= ss.warnSec) ssShow(left); else ssHide();
}
function ssShow(left){
  var b = document.getElementById('ssBar'); if(!b) return;
  if(b.style.display !== 'flex'){
    b.style.display = 'flex';
    document.body.classList.add('session-warning');
  }
  var c = document.getElementById('ssCount');
  if(c) c.textContent = 'Automatic logout in ' + ssFmt(left);
}
/* At zero: end the session, return to the login screen, and say why. Anything
   already submitted is stored against the Scholar ID and is unaffected; a paper
   still open has never been sent, so it is reported as lost rather than quietly
   dropped. */
function ssEnd(){
  if(ss.ending) return;
  ss.ending = true;
  var unsent = !!(typeof wtPaper !== 'undefined' && wtPaper) ||
               !!(typeof cbtPaper !== 'undefined' && cbtPaper);
  ssStop();
  logout();
  go('login-v2');
  ssNotice(unsent);
  toast('Session ended — please log in again');
  ss.ending = false;
}
function ssNotice(unsent){
  var n = document.getElementById('loginNotice'); if(!n) return;
  n.innerHTML = '<b>Your session ended.</b> You were signed out automatically because your '+
    'session time was reached. Everything you had already submitted is saved against your '+
    'Scholar ID and is waiting for you.' +
    (unsent ? ' The paper you had open was not submitted, so it has not been recorded — you '+
              'will need to sit it again.' : '');
  n.style.display = 'block';
}
function ssClearNotice(){
  var n = document.getElementById('loginNotice');
  if(n){ n.style.display = 'none'; n.innerHTML = ''; }
}

/* ============================================ daily study window heartbeat
   Mirrors the session clock above: the server holds the real total, this
   page only asks for it. Roughly once a minute while a student is signed in
   and the tab is actually in the foreground, it reports that minute back to
   the server and repaints the ring from whatever the server says the new
   total is. A tab in the background sends nothing, so switching away to
   another app does not silently burn a student's daily window. A failed
   ping is not treated as time lost — it's simply tried again next beat. */
var STUDY_PING_MS = 60000;
var sw = { timer:0 };
function swStart(){
  swStop();
  if(role !== 'student') return;
  sw.timer = setInterval(swPing, STUDY_PING_MS);
}
function swStop(){
  if(sw.timer) clearInterval(sw.timer);
  sw.timer = 0;
}
function swPing(){
  if(role !== 'student') return;
  if(typeof document !== 'undefined' && document.hidden) return; // foreground only
  GOC.api.pingStudyTime(STUDY_PING_MS / 1000).then(function(win){
    paintStudyWindow(win);
  }).catch(function(){ /* network hiccup — the next beat will try again */ });
}
/* The wind-down overlay's "Add 15 min (guardian PIN)" button — see
   DAILY-STUDY-WINDOW-STATUS.txt and core.EXTRA_TIME_GRANT_MIN. Reads
   whatever was typed into the PIN input (Task 4 restores that input; the
   ids below are what it will use), asks the server to check and grant it,
   and only ever repaints from what the server actually sends back. A wrong
   PIN or an already-exhausted daily grant count comes back as a plain
   inline error next to the input — never a toast, and the message is
   always the server's own ("That PIN is not correct." /
   "Today's extra time has already been used up.") so it can never hint at
   what the correct PIN is or how many tries are left. */
function swExtend(){
  var input = document.getElementById('windPinInput');
  var errEl = document.getElementById('windPinErr');
  if(errEl) errEl.textContent = '';
  var pin = input ? String(input.value || '').trim() : '';
  if(!pin){
    if(errEl) errEl.textContent = 'Enter the guardian PIN.';
    return;
  }
  GOC.api.extendStudyTime(pin).then(function(win){
    if(input) input.value = '';
    if(errEl) errEl.textContent = '';
    paintStudyWindow(win);
  }).catch(function(err){
    if(input) input.value = '';
    if(errEl) errEl.textContent = err.message || 'Could not add that time.';
  });
}

/* The console's view of the same two settings. */
function paintSession(cfg){
  if(!cfg) return;
  if(cfg.sessionMinutes != null) state.sessionMin = Number(cfg.sessionMinutes);
  if(cfg.sessionWarnMinutes != null) state.sessionWarn = Number(cfg.sessionWarnMinutes);
  var a = document.getElementById('admSessVal');
  if(a) a.textContent = state.sessionMin + ' min';
  var b = document.getElementById('admSess');
  if(b) b.textContent = state.sessionMin;
  var c = document.getElementById('admWarnVal');
  if(c) c.textContent = state.sessionWarn + ' min';
  var e = document.getElementById('admWarnStep');
  if(e) e.textContent = state.sessionWarn + ' min';
  var d = document.getElementById('admSessNote');
  if(d) d.textContent = 'A student is signed out ' + state.sessionMin +
    ' minutes after logging in, and warned with a live countdown for the last ' +
    state.sessionWarn + ' minute' + (state.sessionWarn === 1 ? '' : 's') + '.';
}
function admSetSession(delta){
  var want = state.sessionMin + delta;
  GOC.api.setSessionMinutes(want).then(function(cfg){
    paintSession(cfg);
    toast('Student session set to '+state.sessionMin+' minutes');
  }).catch(function(err){ toast(err.message || 'Could not save that setting'); });
}
function admSetWarn(delta){
  var want = state.sessionWarn + delta;
  GOC.api.setSessionWarnMinutes(want).then(function(cfg){
    paintSession(cfg);
    toast('Students are warned '+state.sessionWarn+' minutes before the end');
  }).catch(function(err){ toast(err.message || 'Could not save that setting'); });
}
/* The console's view of the same guardian PIN swExtend() checks (see
   DAILY-STUDY-WINDOW-STATUS.txt and core.EXTRA_TIME_GRANT_MIN). Only
   console ever gets the actual digits back — see server.js's GET
   /api/settings, which sends hasGuardianPin to everyone but the raw
   guardianPin only to an unlocked admin session — so this fills in
   whichever of the two the response actually carried, never guesses.
   Task 4 adds the elements these ids reference (#admGuardianStatus,
   #admGuardianPinInput, #admGuardianPinErr); until then this keeps state
   in sync and no-ops on the DOM, the same way paintWinddownText() did
   before its own ids existed. */
function paintGuardianPin(cfg){
  if(!cfg) return;
  if(cfg.hasGuardianPin != null) state.hasGuardianPin = !!cfg.hasGuardianPin;
  else if(cfg.guardianPin !== undefined) state.hasGuardianPin = !!cfg.guardianPin;
  if(cfg.guardianPin !== undefined) state.guardianPin = cfg.guardianPin || '';
  var s = document.getElementById('admGuardianStatus');
  if(s) s.textContent = state.hasGuardianPin ? 'A guardian PIN is set.' : 'No guardian PIN set.';
  var i = document.getElementById('admGuardianPinInput');
  if(i && document.activeElement !== i) i.value = state.guardianPin || '';
  var e = document.getElementById('admGuardianPinErr'); if(e){ e.textContent = ''; e.classList.remove('ok-note'); }
}
/* Sets or clears the academy-wide guardian PIN — the adminSetLimit()/
   admSetSession() pattern: read the console's own input, ask the server,
   and only ever repaint from what it actually sends back. An empty field
   clears the PIN; anything else must be 4-8 digits, the same rule
   server.js enforces in PUT /api/settings, so a typo can never lock the
   feature into an unusable PIN silently. A wrong-shaped PIN comes back as
   a plain inline error next to the input, never a toast — the save
   itself (not a guess) gets the toast, same as adminSetLimit(). */
function admSetGuardianPin(){
  var input = document.getElementById('admGuardianPinInput');
  var errEl = document.getElementById('admGuardianPinErr');
  if(errEl) errEl.textContent = '';
  var pin = input ? String(input.value || '').trim() : '';
  GOC.api.setGuardianPin(pin).then(function(cfg){
    paintGuardianPin(cfg);
    if(errEl){
      errEl.textContent = pin ? 'Guardian PIN updated.' : 'Guardian PIN cleared.';
      errEl.classList.add('ok-note');
    }
  }).catch(function(err){
    if(errEl){ errEl.classList.remove('ok-note'); errEl.textContent = err.message || 'Could not save that PIN.'; }
  });
}
/* ===== Secure access portal (firewall) ===== */
function gatePaint(){
  var host = document.getElementById('gatePins');
  if(!host) return;
  // Dots are drawn from the passcode length, so changing the passcode (or
  // moving the check server-side) can never leave the UI out of step.
  var len = pinLength();
  if(host.children.length !== len){
    var h = '';
    for(var k=0;k<len;k++){ h += '<span></span>'; }
    host.innerHTML = h;
  }
  list(host.children).forEach(function(s,i){ s.classList.toggle('f', i < gateBuf.length); });
}
function gateKey(n){
  var err=document.getElementById('gateErr'); if(err) err.textContent='';
  var len = pinLength();
  if(gateBuf.length >= len) return;
  gateBuf += n; gatePaint();
  if(gateBuf.length !== len) return;
  var attempt = gateBuf;
  // The passcode is checked by the API. A wrong code never reveals anything and
  // the console stays locked until the API says otherwise.
  GOC.api.unlockConsole(attempt).then(function(){
    adminUnlocked = true;
    gateBuf=''; gatePaint();
    return Promise.all([loadStudents(), loadStaff(), loadSettings(), loadUpdates()]);
  }).then(function(){
    if(adminUnlocked) go('admin');
  }).catch(function(er){
    adminUnlocked = false;
    var e=document.getElementById('gateErr');
    if(e) e.textContent = er.message || 'Incorrect passcode — access denied';
    gateBuf=''; gatePaint();
  });
}
function gateDel(){ gateBuf = gateBuf.slice(0,-1); gatePaint(); }
function gateClear(){ gateBuf=''; var e=document.getElementById('gateErr'); if(e) e.textContent=''; gatePaint(); }
function admLock(){ GOC.api.lockConsole(); adminUnlocked = false; revealed = {}; accessData = null; go('profile'); toast('Console locked'); }

/* =============================================== PRIORITY 8 — the Founder only
   Changing a management login password or the firewall passcode is a Founder
   action. The server decides that: every write goes through a route that the
   API refuses outright unless the signed-in staff account holds the Founder
   role, so a hand-crafted request from an Academic Director's session is turned
   away with 'Only the Founder can change management credentials.' What follows
   only asks the question and reports the answer.

   Nothing secret is ever put on the page. The forms are write-only: passwords
   are typed into password fields, sent once, and the boxes are emptied. No
   password, hash or passcode is rendered, logged or echoed back in a toast —
   the current passcode is shown as a row of dots whose length is the only thing
   the API discloses. */
var accessData = null;
function admAccessLoad(){
  var w = document.getElementById('admAccess'); if(!w) return;
  GOC.api.staffAccess().then(function(d){
    accessData = d;
    var t = document.getElementById('admAccess');
    if(t) t.innerHTML = admAccessHTML(d);
  }).catch(function(err){
    var t = document.getElementById('admAccess');
    if(t) t.innerHTML = '<p class="ad-p">Could not check your authorisation — '+esc(err.message)+'</p>';
  });
}
function admAccessHTML(d){
  var dots = new Array((Number(d.passcodeLength) || 4) + 1).join('•');
  var h = '<div class="ad-metric"><span>Signed in as</span><b>'+esc(d.isFounder ? 'Founder' : 'Management staff')+'</b></div>'+
    '<div class="ad-metric"><span>May change credentials</span><b>'+(d.isFounder ? 'Yes — Founder' : 'No — Founder only')+'</b></div>'+
    '<div class="ad-metric"><span>Firewall passcode</span><b><code>'+dots+'</code> · '+esc(d.passcodeLength)+' digits</b></div>'+
    admSignupCodeHTML(d);
  if(!d.isFounder){
    return h + '<p class="ad-warn">Management passwords and the firewall passcode can only be changed by the Founder. This is checked on the server for every request, so the controls are absent here <b>and</b> the change would be refused even if the request were sent by hand. The <b>create-account code above</b> is the exception: the Founder and the Academic Director may both change it.</p>';
  }
  h += '<div class="ad-sub">Management login password</div>'+
    '<div class="ad-field"><label>Staff account</label><select id="admPwWho">'+
      (d.staff || []).map(function(s){
        return '<option value="'+esc(s.id)+'">'+esc(s.name)+' — '+esc(s.title)+' ('+esc(s.id)+')</option>';
      }).join('')+
    '</select></div>'+
    '<div class="ad-grid2">'+
      '<div class="ad-field"><label>New password</label><input id="admPwNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>'+
      '<div class="ad-field"><label>Confirm new password</label><input id="admPwNew2" type="password" autocomplete="new-password" placeholder="Type it again"></div>'+
    '</div>'+
    '<p class="ad-note">At least 8 characters, with both letters and numbers. The password is stored hashed and can never be read back — not here, and not through the API.</p>'+
    '<div class="ad-actions"><button class="ad-btn pri" onclick="admPwSave()">Update password</button></div>'+
    '<div class="ad-sub">Firewall passcode</div>'+
    '<div class="ad-grid2">'+
      '<div class="ad-field"><label>New passcode</label><input id="admPcNew" type="password" inputmode="numeric" autocomplete="off" placeholder="4 to 8 digits"></div>'+
      '<div class="ad-field"><label>Confirm new passcode</label><input id="admPcNew2" type="password" inputmode="numeric" autocomplete="off" placeholder="Type it again"></div>'+
    '</div>'+
    '<p class="ad-note">Changing the passcode signs every other management session out of the console — they will need the new passcode to get back in.</p>'+
    '<div class="ad-actions"><button class="ad-btn pri" onclick="admPcSave()">Update passcode</button></div>';
  return h;
}
function admVal(id){ var e = document.getElementById(id); return e ? String(e.value || '') : ''; }
function admClear(ids){
  for(var i = 0; i < ids.length; i++){ var e = document.getElementById(ids[i]); if(e) e.value = ''; }
}
/* ---------------- THE CREATE-ACCOUNT FIREWALL, IN THE CONSOLE ----------------
   Drawn for every unlocked console account rather than the Founder alone: the
   academy asked that the Academic Director be able to rotate this code too,
   since she is the one who hands it to a new intake. The server agrees — its
   route sits at the console tier, so removing this block would not stop her and
   restoring it does not let anybody else in. Like a password, the code is
   stored hashed: the console can be told how long it is and when it last
   changed, and nothing more. */
function admWhen(v){
  if(v === null || v === undefined || v === '') return '';
  var d = /^[0-9]+$/.test(String(v)) ? new Date(Number(v)) : new Date(String(v));
  if(isNaN(d.getTime())) return '';
  var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return d.getDate() + ' ' + mon + ' ' + d.getFullYear() + ' · ' +
    (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}
function admSignupCodeHTML(d){
  var len = Number(d.signupCodeLength) || 0;
  var dots = len ? new Array(len + 1).join('•') : '—';
  var when = admWhen(d.signupCodeChangedAt);
  var last = when
    ? esc(when) + (d.signupCodeChangedBy ? ' · by ' + esc(d.signupCodeChangedBy) : '')
    : 'Never — still the code the Hub shipped with';
  return '<div class="ad-metric"><span>Create-account code</span><b><code>'+dots+'</code> · '+esc(len)+' characters</b></div>'+
    '<div class="ad-metric"><span>Code last changed</span><b>'+last+'</b></div>'+
    '<div class="ad-sub">Create-account firewall</div>'+
    '<p class="ad-p">No student account can be opened without this code, so the sign-up page is not open to the public. Give it to a scholar when they are admitted, and change it once an intake closes — everyone still holding the old code is shut out the moment you do.</p>'+
    (when ? '' : '<p class="ad-note warn">This is still the access code the Hub was published with, so anyone who has read its documentation could register. Change it before you hand the Hub to a cohort.</p>')+
    '<div class="ad-grid2">'+
      '<div class="ad-field"><label>New access code</label><input id="admScNew" type="text" autocomplete="off" spellcheck="false" placeholder="4 to 24 letters, numbers or dashes"></div>'+
      '<div class="ad-field"><label>Confirm new code</label><input id="admScNew2" type="text" autocomplete="off" spellcheck="false" placeholder="Type it again"></div>'+
    '</div>'+
    '<p class="ad-note">Only the letters and numbers are compared, so a scholar who types it in lower case, or writes a space where you wrote a dash, is still let in. The code is stored hashed like a password and can never be read back — not here and not through the API — so keep your own record of what you set.</p>'+
    '<div class="ad-actions"><button class="ad-btn pri" onclick="admScSave()">Update access code</button></div>';
}
function admScSave(){
  var c = admVal('admScNew'), c2 = admVal('admScNew2');
  if(!c) return toast('Type the new access code');
  var rb = rulebook();
  /* Same separators the rulebook forgives, in case it has not loaded. */
  var norm = rb ? rb.normalizeSignupCode : function(x){ return String(x || '').replace(/[\s\._\-‐-―−]+/g, '').toUpperCase(); };
  if(rb){
    var v = rb.validateSignupCode(c);
    if(v.error) return toast(v.error);
  }
  if(norm(c) !== norm(c2)) return toast('The two access codes do not match');
  GOC.api.setSignupCode(c).then(function(r){
    admClear(['admScNew','admScNew2']);
    toast('Create-account code updated — '+r.length+' characters. The old code stops working now.');
    admAccessLoad();
  }).catch(function(err){
    admClear(['admScNew','admScNew2']);
    toast(err.message || 'The access code was not changed');
  });
}
function admPwSave(){
  var who = admVal('admPwWho'), pw = admVal('admPwNew'), pw2 = admVal('admPwNew2');
  if(!who) return toast('Choose the staff account to change');
  if(!pw) return toast('Type the new password');
  if(pw !== pw2) return toast('The two passwords do not match');
  GOC.api.setStaffPassword(who, pw).then(function(r){
    admClear(['admPwNew','admPwNew2']);
    /* r carries no password material, so there is nothing here to leak. */
    toast('Password updated for '+r.id+' — stored hashed, and never shown again');
  }).catch(function(err){
    admClear(['admPwNew','admPwNew2']);
    toast(err.message || 'That password was not changed');
  });
}
function admPcSave(){
  var p = admVal('admPcNew'), p2 = admVal('admPcNew2');
  if(!p) return toast('Type the new passcode');
  if(p !== p2) return toast('The two passcodes do not match');
  GOC.api.setConsolePasscode(p).then(function(r){
    admClear(['admPcNew','admPcNew2']);
    toast('Firewall passcode updated — '+r.length+' digits. Other management sessions must re-enter it.');
    admAccessLoad();
  }).catch(function(err){
    admClear(['admPcNew','admPcNew2']);
    toast(err.message || 'The passcode was not changed');
  });
}

function admOpen(section){
  var sel = document.getElementById('admSelect');
  if(sel && sel.value !== section) sel.value = section;
  var p = document.getElementById('admPanel');
  if(!p) return;
  var L = state.limit;
  var V = {
    overview: function(){ return (
      '<div class="ad-card"><div class="ad-h">JAMB 2027 · Science</div>'+
      '<div style="margin-top:10px">'+
      '<div class="ad-metric"><span>Students enrolled</span><b id="admCount">'+studentsData.length+'</b></div>'+
      '<div class="ad-metric"><span>Active today</span><b id="admOvActive">…</b></div>'+
      '<div class="ad-metric"><span>Average mock score</span><b id="admOvAvg">…</b></div>'+
      '<div class="ad-metric"><span>Daily study window</span><b>'+L+' min</b></div>'+
      '<div class="ad-metric"><span>Lessons published</span><b id="admOvLessons">…</b></div></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" onclick="admPreview()">View as student</button><button class="ad-btn" onclick="admOpen(\'results\')">View results</button><button class="ad-btn" onclick="admOpen(\'window\')">Set study window</button></div></div>'
    ); },
    students: function(){ return (
      '<div class="ad-card"><div class="ad-h">Students &amp; login credentials</div><p class="ad-p">'+studentsData.length+' enrolled.</p>'+
      '<div class="ad-seg" id="admStuTabs">'+admStuTabsHTML()+'</div>'+
      '<div id="admCredList">'+admCredHTML()+'</div>'+
      '<p class="ad-note" id="admStuNote">'+admStuNoteHTML()+'</p>'+
      '<p class="ad-warn">Passwords are hashed and cannot be read back — use <b>Reset password</b> to issue a new one.</p>'+
      '<div class="ad-actions"><button class="ad-btn pri" onclick="admToggleAddStudent()">Add student</button><button class="ad-btn" onclick="admExportStudents()">Export</button></div>'+
      '<div id="admAddStudentWrap"></div></div>'
    ); },
    cohorts: function(){ return (
      '<div class="ad-card"><div class="ad-h">New cohort</div><p class="ad-p">Groups students under one study window, session length and question ceiling. Leave a field blank to inherit the academy default.</p>'+
      '<div class="ad-field"><label>Name</label><input id="admCohName" placeholder="e.g. JAMB 2027 · Science"></div>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Daily study window (min)</label><input id="admCohLimit" type="number" min="30" max="180" placeholder="inherit"></div>'+
      '<div class="ad-field"><label>Session length (min)</label><input id="admCohSess" type="number" min="15" max="480" placeholder="inherit"></div></div>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Session warning (min)</label><input id="admCohWarn" type="number" min="1" max="30" placeholder="inherit"></div>'+
      '<div class="ad-field"><label>Objective sitting (min)</label><input id="admCohObj" type="number" min="5" max="300" placeholder="inherit"></div></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" id="admCohNewBtn" onclick="admCreateCohort()">New cohort</button></div></div>'+
      '<div class="ad-card"><div class="ad-h">Cohorts</div><p class="ad-p">Assign a student to one from the Students panel.</p>'+
      '<div id="admCohList"><div class="ad-loading">Loading cohorts…</div></div></div>'
    ); },
    questions: function(){ return (
      '<div class="ad-card"><div class="ad-h">Question bank</div><p class="ad-p"><b>Web Test</b> covers theory, objective and JAMB-oriented sessions; <b>Practice</b> is separate and never reaches the Web Test.</p>'+
      '<div class="ad-metric" id="admQTotals"><span>Bank totals</span><b>counting…</b></div></div>'+
      '<div class="ad-card"><div class="ad-h">Add / edit a question</div>'+
      subjSeg()+
      '<div class="ad-seg" id="admQBankTabs">'+admQBankTabsHTML()+'</div>'+
      '<div class="ad-metric"><span>Questions held</span><b id="admQCount">counting…</b></div>'+
      '<div id="admQForm">'+admQFormHTML()+'</div></div>'+
      '<div class="ad-card"><div class="ad-h">Published questions</div><p class="ad-p">'+esc(admSubj)+(admQBank === 'practice' ? '' : ', grouped by session')+'.</p>'+
      '<div class="ad-seg" id="admQTabs">'+admQTabsHTML()+'</div>'+
      '<div id="admQBulkBar">'+admQBulkBarHTML()+'</div>'+
      '<div id="admQList"><div class="ad-loading">Loading the bank…</div></div></div>'+
      '<div class="ad-card"><div class="ad-h">Bulk delete by subject &amp; section</div>'+
      '<p class="ad-p">Delete every matching question at once. "All" widens the match, up to the entire bank.</p>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Subject</label><select id="admQBulkSubj">'+admQBulkFilterOptsHTML(mySubjectList(), 'All subjects')+'</select></div>'+
      '<div class="ad-field"><label>Section</label><select id="admQBulkSect">'+admQBulkFilterOptsHTML([['theory','Theory'],['objective','Objective'],['jamb','JAMB-oriented'],['practice','Practice']], 'All sections')+'</select></div>'+
      '</div>'+
      '<div class="ad-actions"><button class="ad-btn danger" id="admQBulkFilterBtn" onclick="admQBulkDeleteByFilter()">Delete matching questions</button></div>'+
      '<p class="ad-note">Applies across every subject/session, not just '+esc(admSubj)+' above.</p></div>'+
      (admQBank === 'practice' ? admQPracticeRefCardHTML() : admQRefCardHTML())
    ); },
    league: function(){ return (
      '<div class="ad-card"><div class="ad-h">Leaderboard</div>'+
      '<p class="ad-p">Position is decided by academic performance; XP only separates two scholars on the same performance. A student ranks only within their own cohort.</p>'+
      '<div class="ad-field"><label>Cohort</label><select id="admLgCohort" onchange="admLgSetFilter()">'+admLgCohortOptions()+'</select></div>'+
      '<div class="ad-metric"><span>League</span><b id="admLgName">loading…</b></div>'+
      '<div class="ad-metric"><span>Scholars ranked</span><b id="admLgCount">—</b></div>'+
      '<div id="admLgList"><div class="ad-loading">Loading the standings…</div></div>'+
      '<p class="ad-note" id="admLgBasis">Reading the ranking basis…</p>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admLgLoad()">Refresh</button><button class="ad-btn pri" onclick="admPreview()">View as student</button></div></div>'
    ); },
    videos: function(){ return (
      '<div class="ad-card"><div class="ad-h">Recorded videos</div><p class="ad-p">Upload a recorded class, or link one hosted elsewhere (Zoom cloud, unlisted YouTube).</p>'+
      subjSeg()+
      '<div class="ad-field"><label>Video title</label><input id="admVidTitle" placeholder="e.g. '+admSubj+' — Live Class 04"></div>'+
      '<div class="ad-field"><label>Type</label><select id="admVidType"><option value="live">Live class replay</option><option value="lesson">Lesson video</option></select></div>'+
      '<div class="ad-field"><label>Tutor / instructor</label><input id="admVidTutor" placeholder="e.g. Mr. Okafor"></div>'+
      '<div class="ad-field"><label>Duration</label><input id="admVidDuration" placeholder="e.g. 48:00"></div>'+
      '<div class="ad-drop" onclick="document.getElementById(\'admVidFile\').click()">'+upIcon()+'<b id="admVidFileLabel">Choose an MP4 file (optional)</b><span>MP4 · maximum 50 MB</span></div>'+
      '<input id="admVidFile" type="file" accept=".mp4" style="display:none" onchange="admVideoFilePicked(this)">'+
      '<div class="ad-field"><label>Link (used if no file is chosen)</label><input id="admVidLink" placeholder="Zoom cloud / YouTube unlisted link"></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" id="admVidUploadBtn" onclick="admUploadVideo()">Add video</button></div>'+
      '<div id="admVidStatus" class="ad-note"></div>'+
      '<div class="ad-field"><label>Uploaded videos</label><div id="admVideoList"><div class="ad-note">Loading videos…</div></div></div>'+
      '</div>'
    ); },
    resources: function(){ return (
      '<div class="ad-card"><div class="ad-h">Resources</div><p class="ad-p">Upload past questions, notes and downloadable materials.</p>'+
      subjSeg(true)+
      '<div class="ad-field"><label>Resource title</label><input id="admResTitle" placeholder="e.g. JAMB Chemistry Past Questions 2015–2025"></div>'+
      '<div class="ad-field"><label>Description (optional)</label><textarea id="admResDescription" placeholder="Briefly describe this resource..."></textarea></div>'+
      '<div class="ad-field"><label>Category</label><select id="admResCategory"><option value="past_questions">Past Questions</option><option value="notes">Notes</option><option value="formula">Formula Sheet</option><option value="syllabus">Syllabus</option><option value="other">Other</option></select></div>'+
      '<div class="ad-drop" onclick="document.getElementById(\'admResFile\').click()">'+upIcon()+'<b id="admResFileLabel">Choose a resource file</b><span>PDF / DOCX / image · maximum 50 MB</span></div>'+
      '<input id="admResFile" type="file" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.zip,.mp4" style="display:none" onchange="admResourceFilePicked(this)">'+
      '<div class="ad-actions"><button class="ad-btn pri" id="admResUploadBtn" onclick="admUploadResource()">Upload resource</button></div>'+
      '<div id="admResStatus" class="ad-note"></div>'+
      '<div class="ad-field"><label>Uploaded resources</label><div id="admResourceList"><div class="ad-note">Loading resources…</div></div></div>'+
      '</div>'
    ); },
    homepage: function(){ return (
      '<div class="ad-card"><div class="ad-h">Post an update</div><p class="ad-p">Publish announcements to the public Updates &amp; News page and homepage.</p>'+
      '<div class="ad-field"><label>Category</label><select id="upCat"><option value="admission">Admission</option><option value="utme">UTME</option><option value="scholarship">Scholarship</option><option value="news">News</option></select></div>'+
      '<div class="ad-field"><label>Headline</label><input id="upTitle" placeholder="e.g. 2027 intake now open"></div>'+
      '<div class="ad-field"><label>Message</label><textarea id="upBody" placeholder="Write the update students and visitors will see..."></textarea></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" id="upPostBtn" onclick="admPostUpdate()">Publish update</button><button class="ad-btn" onclick="go(\'updates\')">View updates page</button></div></div>'+
      '<div class="ad-card"><div class="ad-h">Manage updates</div><p class="ad-p">Remove any update from the homepage.</p><div id="admUpList">'+admUpdatesHTML()+'</div></div>'
    ); },
    affirmations: function(){ admAffLoad(); return (
      '<div class="ad-card"><div class="ad-h">Daily affirmation pop-up</div><p class="ad-p">Messages shown in the daily affirmation flyer.</p>'+
      '<div id="admAffList"><div class="ad-note">Loading affirmations…</div></div>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admAffAddRow()">Add affirmation</button><button class="ad-btn pri" id="admAffSaveBtn" onclick="admSaveAffirmations()">Save changes</button></div>'+
      '<p class="ad-note" id="admAffNote"></p></div>'
    ); },
    classes: function(){ return (
      '<div class="ad-card"><div class="ad-h">Live classes</div><p class="ad-p">Schedule a Zoom class — it appears on the Timetable once saved. Cancel it if plans change.</p>'+
      subjSeg()+
      '<div class="ad-field"><label>Topic</label><input id="admClsTopic" placeholder="e.g. Motion, Moles, Quadratic Equations"></div>'+
      '<div class="ad-field"><label>Tutor / instructor</label><input id="admClsTutor" placeholder="e.g. Mr. Okafor"></div>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Date &amp; time</label><input id="admClsWhen" type="datetime-local"></div>'+
      '<div class="ad-field"><label>Duration (minutes)</label><input id="admClsDuration" type="number" min="1" max="600" placeholder="e.g. 45" value="45"></div></div>'+
      '<div class="ad-field"><label>Zoom link</label><input id="admClsLink" placeholder="https://zoom.us/j/..."></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" id="admClsScheduleBtn" onclick="admScheduleClass()">Schedule class</button></div>'+
      '<div id="admClsStatus" class="ad-note"></div>'+
      '<div class="ad-field"><label>Scheduled classes</label><div id="admClassList"><div class="ad-note">Loading classes…</div></div></div>'+
      /* Bulk reset for the whole timetable — every subject, not just the one
         selected above — so the academy can wipe an old schedule and lay a
         fresh one down without cancelling and deleting each class by hand.
         A scheduled class must be cancelled before it can be deleted (the
         server enforces this — see the DELETE /api/admin/classes/:id route),
         so admClearAllClasses does both steps for every class it finds. */
      '<div class="ad-actions"><button class="ad-btn danger" onclick="admClearAllClasses()">Clear entire timetable</button></div>'+
      '<div id="admClsClearStatus" class="ad-note"></div>'+
      '</div>'
    ); },
    results: function(){ return (
      '<div class="ad-card"><div class="ad-h">Web test results</div><p class="ad-p">Tap a row to read the paper. Objective/JAMB papers are already marked; use <b>Mark theory papers</b> for theory.</p>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Session</label><select id="admRSection" onchange="admRSetFilter()"><option value="">All sessions</option><option value="theory">Theory</option><option value="objective">Objective</option><option value="jamb">JAMB-oriented</option></select></div>'+
      '<div class="ad-field"><label>Subject</label><select id="admRSubject" onchange="admRSetFilter()">'+admRSubjectOptions()+'</select></div></div>'+
      '<div class="ad-grid2">'+
      '<div class="ad-field"><label>Marking</label><select id="admRStatus" onchange="admRSetFilter()"><option value="">Any status</option><option value="awaiting-marking">Awaiting marking</option><option value="marked">Marked</option></select></div>'+
      '<div class="ad-field"><label>Scholar ID</label><input id="admRScholar" placeholder="e.g. GOC-S-002" value="'+esc(admRFilter.scholarId)+'" onchange="admRSetFilter()"></div>'+
      '<div class="ad-field"><label>Cohort</label><select id="admRCohort" onchange="admRSetFilter()">'+admRCohortOptions()+'</select></div></div>'+
      '<div id="admRSummary"></div>'+
      '<div id="admRList"><div class="ad-loading">Loading results…</div></div></div>'+
      '<div class="ad-card" id="admRDetailCard" hidden><div class="ad-h" id="admRDetailTitle">Result detail</div><div id="admRDetail"></div></div>'
    ); },
    /* Dedicated theory-marking panel. Results (above) can still open and mark
       any sitting, theory included — this panel doesn't take that away. What
       it adds is the thing Results never showed: how many students actually
       sat each subject's theory paper, and how many of those are still
       waiting on a mark, before you go looking one Scholar ID at a time. It
       reuses the same attempt-detail card and mark-saving code Results uses
       (admROpen/admRPaint/admMarkSave) — same #admRDetailCard markup below —
       so a paper marked from here behaves identically to one marked there. */
    theorymark: function(){ return (
      '<div class="ad-card"><div class="ad-h">Mark theory papers</div>'+
      '<p class="ad-p">Pick a subject to see who has sat it and who still needs a mark.</p>'+
      '<div id="admTMSummary"><div class="ad-loading">Loading…</div></div>'+
      '<div class="ad-field"><label>Subject</label><select id="admTMSubjectSel" onchange="admTMSetSubject()">'+admTMSubjectOptions()+'</select></div>'+
      '<div id="admTMList"></div></div>'+
      '<div class="ad-card" id="admRDetailCard" hidden><div class="ad-h" id="admRDetailTitle">Result detail</div><div id="admRDetail"></div></div>'
    ); },
    /* The objective sitting. One clock for the whole combination and one count
       per paper, both management's to set — the student chooses nothing but when
       to begin. The blueprint underneath reads the live bank, so a paper the
       bank cannot fill is visible here before a student meets it. */
    objective: function(){ return (
      '<div class="ad-card"><div class="ad-h">Objective sitting</div>'+
      '<p class="ad-p">One sitting of the whole combination, UTME order: Use of English first, then the sciences.</p>'+
      '<div class="ad-metric"><span>Time for the whole sitting</span><b id="admObjMin">…</b></div>'+
      '<div class="stepper" style="justify-content:center;margin-top:6px"><button onclick="admObjStep(-30)">\u2212</button><b id="admObjStepVal">…</b><button onclick="admObjStep(30)">+</button></div>'+
      '<p class="ad-warn">Between 5 minutes and 5 hours, in half-hour steps. Theory has no clock and is unaffected.</p></div>'+
      '<div class="ad-card"><div class="ad-h">Questions per paper</div>'+
      '<p class="ad-p">UTME ceiling: 60 for Use of English, 40 per science — 180 for a four-subject combination. If the bank holds fewer live questions, the student sits what exists.</p>'+
      '<div id="admObjList"><div class="ad-loading">Reading the bank\u2026</div></div>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admObjLoad()">Refresh</button><button class="ad-btn pri" onclick="admOpen(\'questions\')">Open question bank</button></div></div>'
    ); },
    window: function(){ return (
      '<div class="ad-card"><div class="ad-h">Daily study window</div><p class="ad-p">Caps daily time in the app. Students can\'t change this.</p>'+
      '<div class="ad-win"><div class="big"><span id="admLimit">'+L+'</span> <s>min / day</s></div></div>'+
      '<div class="stepper" style="justify-content:center;margin-top:10px"><button onclick="adminSetLimit(-15)">−</button><b id="admLimitVal">'+L+' min</b><button onclick="adminSetLimit(15)">+</button></div>'+
      '<div class="ad-actions" style="justify-content:center"><button class="ad-btn" onclick="admPreview()">Check on student dashboard</button></div>'+
      /* Guardian PIN — lets a parent/guardian grant a student a few extra
         minutes past the window above from the wind-down screen (see
         swExtend() / #windExtendWrap), without handing the student the
         console passcode. Lives next to the stepper because it's a
         setting on the same window. paintGuardianPin() repaints
         #admGuardianStatus/#admGuardianPinInput/#admGuardianPinErr from
         whatever the server actually sends back — this markup just gives
         it somewhere to write. */
      '<div class="ad-field" style="margin-top:14px"><label>Guardian PIN</label>'+
        '<p class="ad-note" id="admGuardianStatus" style="margin:6px 0 8px">'+(state.hasGuardianPin?'A guardian PIN is set.':'No guardian PIN set.')+'</p>'+
        '<input id="admGuardianPinInput" type="text" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="4 to 8 digits" value="'+esc(state.guardianPin||'')+'">'+
        '<div class="gate-err" id="admGuardianPinErr"></div>'+
      '</div>'+
      '<p class="ad-note">Lets a guardian add '+((rulebook().EXTRA_TIME_GRANT_MIN)||15)+' minutes to a student\'s day from the wind-down screen, up to '+((rulebook().EXTRA_TIME_MAX_GRANTS_PER_DAY)!=null?rulebook().EXTRA_TIME_MAX_GRANTS_PER_DAY:2)+' time'+(((rulebook().EXTRA_TIME_MAX_GRANTS_PER_DAY)!=null?rulebook().EXTRA_TIME_MAX_GRANTS_PER_DAY:2)===1?'':'s')+' a day. Leave blank and save to turn it off.</p>'+
      '<div class="ad-actions" style="justify-content:center"><button class="ad-btn pri" onclick="admSetGuardianPin()">Save guardian PIN</button></div></div>'+
      /* Priority 9 — the session threshold sits beside the daily study window
         because they are the same kind of setting: how long a student spends in
         the app, decided by the academy. The expiry is enforced on the server;
         this only chooses the number. */
      '<div class="ad-card"><div class="ad-h">Student session time</div>'+
      '<p class="ad-p">How long a student stays signed in, and how much warning they get. Enforced on the server. Staff sessions are separate.</p>'+
      '<div class="ad-metric"><span>Session length</span><b><span id="admSess">'+state.sessionMin+'</span> minutes</b></div>'+
      '<div class="stepper" style="justify-content:center;margin-top:6px"><button onclick="admSetSession(-15)">−</button><b id="admSessVal">'+state.sessionMin+' min</b><button onclick="admSetSession(15)">+</button></div>'+
      '<div class="ad-metric" style="margin-top:12px"><span>Warning before the end</span><b><span id="admWarnVal">'+state.sessionWarn+' min</span></b></div>'+
      '<div class="stepper" style="justify-content:center;margin-top:6px"><button onclick="admSetWarn(-1)">−</button><b id="admWarnStep">'+state.sessionWarn+' min</b><button onclick="admSetWarn(1)">+</button></div>'+
      '<p class="ad-note" id="admSessNote">A student is signed out '+state.sessionMin+' minutes after logging in, and warned with a live countdown for the last '+state.sessionWarn+' minute'+(state.sessionWarn === 1 ? '' : 's')+'.</p>'+
      '<p class="ad-warn">15–480 minutes for a session, 1–30 minutes of warning, always shorter than the session. Out-of-range values are brought back inside them.</p></div>'
    ); },
    /* Reading notes. The Study screen's Read / Learn holds no prose of its own —
       every word a student reads there is written in this panel. */
    notes: function(){ return (
      '<div class="ad-card"><div class="ad-h">Reading notes</div><p class="ad-p">What a student reads in Read / Learn. File a note under the topic the questions use. A note held back is not served.</p>'+
      subjSeg()+
      '<div class="ad-metric"><span>Notes held</span><b id="admNCount">counting…</b></div>'+
      '<div id="admNForm">'+admNFormHTML()+'</div></div>'+
      '<div class="ad-card"><div class="ad-h">Published notes</div>'+
      '<p class="ad-p">Everything in '+esc(admSubj)+', grouped by topic — the same grouping the student sees. Correct the wording, change the reading time, or hold a note back.</p>'+
      '<div class="ad-seg" id="admNTabs">'+admNTabsHTML()+'</div>'+
      '<div id="admNList"><div class="ad-loading">Loading the notes…</div></div>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admNLoad()">Refresh</button><button class="ad-btn pri" onclick="admOpen(\'import\')">Import from a spreadsheet</button></div></div>'
    ); },
    /* Bulk import. Typing a bank one question at a time is the slowest part of
       running the academy, so a spreadsheet may be pasted or opened instead. */
    'import': function(){ return (
      '<div class="ad-card"><div class="ad-h">Import from a spreadsheet</div>'+
      '<p class="ad-p">Save a sheet as CSV, then paste it below or open the file. Rows are checked by the same rules as the form; a failing row is reported by line number and nothing already published is touched.</p>'+
      '<div class="ad-field"><label>What is in this file</label><select id="admImKind" onchange="admImKindSet()">'+
      '<option value="questions">Questions</option><option value="notes">Reading notes</option></select></div>'+
      '<div id="admImTarget">'+admImTargetHTML()+'</div>'+
      '<div class="ad-field"><label>Columns, in this order</label><code id="admImCols" class="ad-cols">'+esc(GOC.api.rules.CSV_QUESTION_HEADER)+'</code></div>'+
      '<p class="ad-note" id="admImNote">subject and text are required. Objective: fill optionA onwards, answer as a letter, position or text. Theory: give expected and maxMark instead. Section accepts theory, objective, jamb or <b>practice</b> — practice rows go straight to Practice and never reach the Web Test.</p>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admImTemplate()">Fill with a template</button><button class="ad-btn" onclick="admImClear()">Clear</button></div>'+
      '<div class="ad-drop"><label for="admImFile" style="cursor:pointer;display:block">'+upIcon()+'<b>Open a CSV file</b><span>Its contents land in the box below so you can check them first</span></label>'+
      '<input id="admImFile" type="file" accept=".csv,text/csv,text/plain" onchange="admImPick(this)"></div>'+
      '<div class="ad-field"><label>The file</label><textarea id="admImCsv" rows="10" placeholder="Paste the CSV here — the first line must name the columns."></textarea></div>'+
      '<div class="ad-actions"><button class="ad-btn pri" id="admImBtn" onclick="admImRun()">Import</button></div>'+
      '<p class="ad-warn">At most '+esc(GOC.api.rules.CSV_MAX_ROWS)+' rows in one go. Import adds records — it never edits or removes what is already published. A repeat of the same file is flagged before it runs again.</p></div>'+
      '<div class="ad-card"><div class="ad-h">What was imported</div>'+
      '<div id="admImOut"><div class="ad-empty">Nothing imported in this sitting yet.</div></div></div>'+
      '<div class="ad-card"><div class="ad-h">Previously imported</div>'+
      '<div id="admImHistory"><div class="ad-loading">Checking earlier imports…</div></div></div>'
    ); },
    access: function(){ return (
      '<div class="ad-card"><div class="ad-h">Access &amp; firewall</div>'+
      '<div class="ad-metric"><span>Identity scheme</span><b>GOC-S-… students · GOC-A-… staff</b></div>'+
      '<div class="ad-metric"><span>Console authorised</span><b>'+staffData.length+' accounts only</b></div>'+
      staffData.map(function(s){
        return '<div class="ad-cred"><div class="ac-top"><div class="ad-av">'+esc(initials(s.name))+'</div>'+
          '<div class="ac-who"><b>'+esc(s.name)+'</b><span>'+esc(s.title)+'</span></div>'+
          '<span class="ad-tag g">Authorised</span></div>'+
          '<div class="ac-grid"><div class="ac-cell"><label>Staff ID</label><code>'+esc(s.id)+'</code></div>'+
          '<div class="ac-cell"><label>Console</label><code>Full access</code></div></div></div>';
      }).join('')+
      '<p class="ad-warn">No other account can open this console. A Staff ID that isn\'t on this roster is refused at login, even if it uses the GOC-A- prefix.</p>'+
      '<div class="ad-actions"><button class="ad-btn" onclick="admLock()">Lock console</button></div></div>'+
      '<div class="ad-card"><div class="ad-h">Management credentials</div>'+
      '<p class="ad-p">Only the Founder may change the login password or firewall passcode — enforced by the server.</p>'+
      '<div id="admAccess"><div class="ad-loading">Checking your authorisation…</div></div></div>'
    ); }
  };
  p.innerHTML = (V[section] || V.overview)();
  /* Panels that read live data fill themselves in after the markup lands, the
     same way the credentials list already does. */
  if(section === 'questions') admQLoad();
  if(section === 'notes') admNLoad();
  if(section === 'import'){ admImKindSet(); admImLoadHistory(); }
  if(section === 'objective') admObjLoad();
  if(section === 'overview') admOverviewLoad();
  if(section === 'resources') admLoadResources();
  if(section === 'videos') admLoadVideos();
  if(section === 'classes') admLoadClasses();
  if(section === 'cohorts') admLoadCohorts();
  if(section === 'students') admLoadCohorts();
  if(section === 'results') { if(!admCohortsCache.length) admLoadCohorts(); admRLoad(); }
  if(section === 'theorymark') admTMLoad();
  if(section === 'league') admLgLoad();
  if(section === 'access') admAccessLoad();
  if(section === 'window') loadSettings();   // Priority 9 — show the live policy
}
var admSubj = 'Physics';
function admSetSubj(s){ admSubj = s; var sel=document.getElementById('admSelect'); admOpen(sel?sel.value:'questions'); }
/* includeMaterials: the "GOC Materials" 6th tab is only offered on the
   Resources and Videos panels now — every other panel (Questions, Topics,
   Notes, Live classes) gets the five real subjects only. If a panel that no
   longer offers the tab is somehow left on admSubj === 'GOC Materials'
   (e.g. left there before this change, or via old state), fall back to
   Physics so it isn't stuck pointing at a tab that no longer renders. */
function subjSeg(includeMaterials){
  if(!includeMaterials && admSubj === 'GOC Materials') admSubj = 'Physics';
  var subs=['Use of English','Physics','Chemistry','Biology','Mathematics'];
  var seg = subs.map(function(s){return '<button class="'+(s===admSubj?'on':'')+'" onclick="admSetSubj(\''+s+'\')">'+s+'</button>';}).join('');
  /* "GOC Materials" is a deliberate 6th tab, not a real subject: it's where
     general, not-subject-specific resources (templates, study-skill guides,
     schedules...) get filed. A resource uploaded under it goes out with
     subject:"GOC Materials", which the student Resources screen already
     shows to everyone regardless of their subject combination — see
     studiesSubject()'s fallback for names it doesn't recognise — and the
     matching "GOC Materials" chip on that screen pulls exactly these back
     out again, the same way any other tab here feeds its own filter chip. */
  if(includeMaterials){
    seg += '<button class="'+('GOC Materials'===admSubj?'on':'')+' seg-brand" onclick="admSetSubj(\'GOC Materials\')"><svg class="seg-mark" viewBox="0 0 100 100" aria-hidden="true"><use href="#goc-mark" xlink:href="#goc-mark"/></svg>GOC Materials</button>';
  }
  return '<div class="ad-seg">'+seg+'</div>';
}
function upIcon(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/></svg>'; }
/* Overview panel — one call, four numbers filled in after the markup
   lands, same "fill itself in after the panel renders" pattern every
   other live admin panel uses (admLoadResources/admLoadVideos below,
   admObjLoad, etc). */
/* KPI strip at the top of the console — real numbers, not placeholders.
   Students comes from the roster cache (kept current by loadStudents()),
   active-today/avg-mock come from the same overview endpoint the Overview
   panel uses, and cohorts comes from the cohorts cache (kept current by
   admLoadCohorts()). Each figure degrades to '—' independently if its
   source isn't loaded yet or the fetch fails, rather than blocking the rest. */
function admKpiLoad(){
  var stu = document.getElementById('admKpiStudents');
  var act = document.getElementById('admKpiActive');
  var avg = document.getElementById('admKpiAvg');
  var coh = document.getElementById('admKpiCohorts');
  if(!stu && !act && !avg && !coh) return;

  if(stu) stu.textContent = studentsData.length ? String(studentsData.length) : '—';
  if(coh) coh.textContent = admCohortsCache.length ? String(admCohortsCache.length) : '—';

  GOC.api.listOverview().then(function(r){
    r = r || {};
    if(act) act.textContent = (typeof r.activeToday === 'number') ? String(r.activeToday) : '—';
    if(avg) avg.textContent = (typeof r.avgScorePercent === 'number') ? (r.avgScorePercent + '%') : '—';
    // studentsTotal is the authoritative count straight from the server —
    // prefer it over the roster cache when it's available.
    if(stu && typeof r.studentsTotal === 'number') stu.textContent = String(r.studentsTotal);
  }, function(){
    if(act) act.textContent = '—';
    if(avg) avg.textContent = '—';
  });

  if(!admCohortsCache.length){
    GOC.api.listCohorts().then(function(result){
      var list = (result && Array.isArray(result.cohorts)) ? result.cohorts : [];
      admCohortsCache = list;
      if(coh) coh.textContent = list.length ? String(list.length) : '0';
    }, function(){
      if(coh) coh.textContent = '—';
    });
  }
}

function admOverviewLoad(){
  var active = document.getElementById('admOvActive');
  var avg = document.getElementById('admOvAvg');
  var lessons = document.getElementById('admOvLessons');
  if(!active && !avg && !lessons) return;

  GOC.api.listOverview().then(function(r){
    r = r || {};
    if(active) active.textContent = (typeof r.activeToday === 'number') ? String(r.activeToday) : '—';
    if(avg) avg.textContent = (typeof r.avgScorePercent === 'number') ? (r.avgScorePercent + '%') : '—';
    if(lessons) lessons.textContent = (typeof r.lessonsPublished === 'number') ? String(r.lessonsPublished) : '—';
  }, function(){
    if(active) active.textContent = '—';
    if(avg) avg.textContent = '—';
    if(lessons) lessons.textContent = '—';
  });
}

function admLoadResources(){
  var host = document.getElementById('admResourceList');
  if(!host) return;

  host.innerHTML = '<div class="ad-loading">Loading resources…</div>';

  GOC.api.listResources().then(function(result){
    var resources = result && Array.isArray(result.resources) ? result.resources : [];
    admRenderResources(resources);
  }, function(err){
    host.innerHTML = '<div class="ad-note warn">' +
      esc(err.message || 'Could not load resources.') +
      '</div>';
  });
}

function admRenderResources(resources){
  var host = document.getElementById('admResourceList');
  if(!host) return;

  var filtered = resources.filter(function(r){
    return String(r.subject || '').toLowerCase() === String(admSubj || '').toLowerCase();
  });

  if(!filtered.length){
    if(resources.length){
      // They're not missing — they're just filed under a subject that isn't selected right now.
      var bySubj = {};
      resources.forEach(function(r){
        var s = r.subject || 'Unspecified';
        bySubj[s] = (bySubj[s] || 0) + 1;
      });
      var breakdown = Object.keys(bySubj).map(function(s){
        return esc(s) + ' (' + bySubj[s] + ')';
      }).join(', ');

      host.innerHTML = '<div class="ad-empty">No resources uploaded for ' + esc(admSubj) +
        ' yet.<br>' + resources.length + ' resource' + (resources.length === 1 ? '' : 's') +
        ' exist under other subjects — switch the subject above to view them: ' + breakdown + '.</div>';
    } else {
      host.innerHTML = '<div class="ad-empty">No resources uploaded for ' +
        esc(admSubj) + ' yet.</div>';
    }
    return;
  }

  host.innerHTML = filtered.map(function(r){
    var published = !!r.published;
    var status = published ? 'Published' : 'Draft';
    var statusClass = published ? 'published' : 'draft';
    var fileType = String(r.fileType || 'FILE').toUpperCase();

    return '<div class="goc-resource-item">' +
      '<div class="goc-resource-icon">' + esc(fileType) + '</div>' +
      '<div class="goc-resource-main">' +
        '<span class="goc-resource-title">' +
          esc(r.title || 'Untitled resource') +
        '</span>' +
        '<div class="goc-resource-meta">' +
          '<span>' + esc(r.subject || 'All subjects') + '</span>' +
          '<span>' + esc(fileType) + '</span>' +
          '<span>' + esc(r.category || 'Other') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="goc-resource-actions">' +
        '<span class="goc-resource-status ' + statusClass + '">' +
          status +
        '</span>' +
        '<button class="ad-btn" onclick="admSetResourcePublished(\'' +
          esc(r.resourceId) + '\',' + (!published) + ')">' +
          (published ? 'Unpublish' : 'Publish') +
        '</button>' +
        (published ? '' :
          '<button class="ad-btn danger" onclick="admDeleteResource(\'' +
            esc(r.resourceId) + '\',\'' + esc((r.title || 'this resource').replace(/'/g, "\\'")) + '\')">' +
            'Delete' +
          '</button>'
        ) +
      '</div>' +
    '</div>';
  }).join('');
}

function admSetResourcePublished(id, published){
  GOC.api.setResourcePublished(id, published).then(function(){
    toast(published ? 'Resource published.' : 'Resource unpublished.');
    admLoadResources();
  }, function(err){
    toast(err.message || 'Could not update the resource.');
  });
}

function admDeleteResource(id, title){
  if(!confirm('Permanently delete "' + title + '"?\n\nThis removes the database record and its stored file for good — it cannot be undone. Only unpublished (draft) resources can be deleted; a published resource must be unpublished first.')) return;

  GOC.api.deleteResource(id).then(function(){
    toast('Resource deleted.');
    admLoadResources();
  }, function(err){
    toast(err.message || 'Could not delete the resource.');
  });
}

function admLoadVideos(){
  var host = document.getElementById('admVideoList');
  if(!host) return;

  host.innerHTML = '<div class="ad-loading">Loading videos…</div>';

  GOC.api.listVideos().then(function(result){
    var videos = result && Array.isArray(result.videos) ? result.videos : [];
    admRenderVideos(videos);
  }, function(err){
    host.innerHTML = '<div class="ad-note warn">' +
      esc(err.message || 'Could not load videos.') +
      '</div>';
  });
}

function admRenderVideos(videos){
  var host = document.getElementById('admVideoList');
  if(!host) return;

  var filtered = videos.filter(function(v){
    return String(v.subject || '').toLowerCase() === String(admSubj || '').toLowerCase();
  });

  if(!filtered.length){
    if(videos.length){
      var bySubj = {};
      videos.forEach(function(v){
        var s = v.subject || 'Unspecified';
        bySubj[s] = (bySubj[s] || 0) + 1;
      });
      var breakdown = Object.keys(bySubj).map(function(s){
        return esc(s) + ' (' + bySubj[s] + ')';
      }).join(', ');

      host.innerHTML = '<div class="ad-empty">No videos uploaded for ' + esc(admSubj) +
        ' yet.<br>' + videos.length + ' video' + (videos.length === 1 ? '' : 's') +
        ' exist under other subjects — switch the subject above to view them: ' + breakdown + '.</div>';
    } else {
      host.innerHTML = '<div class="ad-empty">No videos uploaded for ' +
        esc(admSubj) + ' yet.</div>';
    }
    return;
  }

  host.innerHTML = filtered.map(function(v){
    var published = !!v.published;
    var status = published ? 'Published' : 'Draft';
    var statusClass = published ? 'published' : 'draft';
    var typeLabel = v.type === 'live' ? 'Live' : 'Lesson';
    var source = v.storageFileId ? 'MP4' : 'Link';

    return '<div class="goc-resource-item">' +
      '<div class="goc-resource-icon">' + esc(typeLabel) + '</div>' +
      '<div class="goc-resource-main">' +
        '<span class="goc-resource-title">' +
          esc(v.title || 'Untitled video') +
        '</span>' +
        '<div class="goc-resource-meta">' +
          '<span>' + esc(v.subject || '') + '</span>' +
          '<span>' + esc(v.tutor || '') + '</span>' +
          '<span>' + esc(v.duration || '') + '</span>' +
          '<span>' + esc(source) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="goc-resource-actions">' +
        '<span class="goc-resource-status ' + statusClass + '">' +
          status +
        '</span>' +
        '<button class="ad-btn" onclick="admSetVideoPublished(\'' +
          esc(v.videoId) + '\',' + (!published) + ')">' +
          (published ? 'Unpublish' : 'Publish') +
        '</button>' +
        (published ? '' :
          '<button class="ad-btn danger" onclick="admDeleteVideo(\'' +
            esc(v.videoId) + '\',\'' + esc((v.title || 'this video').replace(/'/g, "\\'")) + '\')">' +
            'Delete' +
          '</button>'
        ) +
      '</div>' +
    '</div>';
  }).join('');
}

function admSetVideoPublished(id, published){
  GOC.api.setVideoPublished(id, published).then(function(){
    toast(published ? 'Video published.' : 'Video unpublished.');
    admLoadVideos();
  }, function(err){
    toast(err.message || 'Could not update the video.');
  });
}

function admDeleteVideo(id, title){
  if(!confirm('Permanently delete "' + title + '"?\n\nThis removes the database record and its stored file (if any) for good — it cannot be undone. Only unpublished (draft) videos can be deleted; a published video must be unpublished first.')) return;

  GOC.api.deleteVideo(id).then(function(){
    toast('Video deleted.');
    admLoadVideos();
  }, function(err){
    toast(err.message || 'Could not delete the video.');
  });
}

/* ================= LIVE CLASSES (admin) =================
   Function-for-function against the admin video pattern above
   (admLoadVideos/admRenderVideos/admDeleteVideo) rather than a new shape —
   a scheduled class filtered by admSubj, one form to create, cancel/mark
   complete/delete to manage what already exists. */
function admLoadClasses(){
  var host = document.getElementById('admClassList');
  if(!host) return;

  host.innerHTML = '<div class="ad-loading">Loading classes…</div>';

  GOC.api.listClasses().then(function(result){
    var classes = result && Array.isArray(result.classes) ? result.classes : [];
    admRenderClasses(classes);
  }, function(err){
    host.innerHTML = '<div class="ad-note warn">' +
      esc(err.message || 'Could not load classes.') +
      '</div>';
  });
}

function admRenderClasses(classes){
  var host = document.getElementById('admClassList');
  if(!host) return;

  var filtered = classes.filter(function(c){
    return String(c.subject || '').toLowerCase() === String(admSubj || '').toLowerCase();
  });

  if(!filtered.length){
    if(classes.length){
      var bySubj = {};
      classes.forEach(function(c){
        var s = c.subject || 'Unspecified';
        bySubj[s] = (bySubj[s] || 0) + 1;
      });
      var breakdown = Object.keys(bySubj).map(function(s){
        return esc(s) + ' (' + bySubj[s] + ')';
      }).join(', ');

      host.innerHTML = '<div class="ad-empty">No classes scheduled for ' + esc(admSubj) +
        ' yet.<br>' + classes.length + ' class' + (classes.length === 1 ? '' : 'es') +
        ' exist under other subjects — switch the subject above to view them: ' + breakdown + '.</div>';
    } else {
      host.innerHTML = '<div class="ad-empty">No classes scheduled for ' +
        esc(admSubj) + ' yet.</div>';
    }
    return;
  }

  // GET /api/admin/classes already returns these ordered by scheduledAt —
  // filtering by subject here preserves that order, nothing to re-sort.
  host.innerHTML = filtered.map(function(c){
    var when = '';
    var d = c.scheduledAt ? new Date(c.scheduledAt) : null;
    if(d && !isNaN(d.getTime())){
      when = d.toLocaleString(undefined, { weekday:'short', day:'numeric', month:'short', hour:'numeric', minute:'2-digit' });
    }
    var tagClass = c.status === 'cancelled' ? 'r' : (c.status === 'completed' ? 'a' : 'g');
    var statusLabel = c.status === 'cancelled' ? 'Cancelled' : (c.status === 'completed' ? 'Completed' : 'Scheduled');

    return '<div class="goc-resource-item">' +
      '<div class="goc-resource-icon">' + esc((c.subject||'?').slice(0,2)) + '</div>' +
      '<div class="goc-resource-main">' +
        '<span class="goc-resource-title">' + esc(c.topic || 'Untitled class') + '</span>' +
        '<div class="goc-resource-meta">' +
          '<span>' + esc(c.subject || '') + '</span>' +
          '<span>' + esc(c.tutor || '') + '</span>' +
          '<span>' + esc(when) + '</span>' +
          '<span>' + esc(c.durationMin ? (c.durationMin + ' min') : '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="goc-resource-actions">' +
        '<span class="ad-tag ' + tagClass + '">' + statusLabel + '</span>' +
        (c.status === 'scheduled' ?
          '<button class="ad-btn" onclick="admCompleteClass(\'' + esc(c.classId) + '\')">Mark completed</button>' +
          '<button class="ad-btn danger" onclick="admCancelClass(\'' + esc(c.classId) + '\')">Cancel</button>'
          :
          '<button class="ad-btn danger" onclick="admDeleteClass(\'' + esc(c.classId) + '\',\'' +
            esc((c.topic || 'this class').replace(/'/g, "\\'")) + '\')">Delete</button>'
        ) +
      '</div>' +
    '</div>';
  }).join('');
}

function admScheduleClass(){
  var topicEl = document.getElementById('admClsTopic');
  var tutorEl = document.getElementById('admClsTutor');
  var whenEl = document.getElementById('admClsWhen');
  var durationEl = document.getElementById('admClsDuration');
  var linkEl = document.getElementById('admClsLink');
  var btn = document.getElementById('admClsScheduleBtn');
  var status = document.getElementById('admClsStatus');

  var topic = topicEl ? String(topicEl.value || '').trim() : '';
  var tutor = tutorEl ? String(tutorEl.value || '').trim() : '';
  var when = whenEl ? String(whenEl.value || '').trim() : '';
  var duration = durationEl ? Number(durationEl.value) : 0;
  var link = linkEl ? String(linkEl.value || '').trim() : '';

  if(!admSubj){ toast('Select a subject first.'); return; }
  if(!topic){ toast('Enter a topic first.'); return; }
  if(!when || isNaN(new Date(when).getTime())){ toast('Pick a date and time.'); return; }
  if(!duration || duration <= 0 || duration > 600){ toast('Duration must be between 1 and 600 minutes.'); return; }
  if(!link || !/^https?:\/\//i.test(link)){ toast('The Zoom link must start with http:// or https://'); return; }

  if(btn){ btn.disabled = true; btn.textContent = 'Scheduling…'; }
  if(status){ status.textContent = 'Scheduling…'; }

  GOC.api.createClass({
    subject: admSubj,
    topic: topic,
    tutor: tutor,
    scheduledAt: new Date(when).toISOString(),
    durationMin: duration,
    zoomLink: link
  }).then(function(){
    if(status){ status.textContent = 'Class scheduled. It appears on the student Timetable straight away.'; }
    toast('Class scheduled.');
    if(topicEl) topicEl.value = '';
    if(tutorEl) tutorEl.value = '';
    if(whenEl) whenEl.value = '';
    if(linkEl) linkEl.value = '';
    admLoadClasses();
  }, function(err){
    if(status){ status.textContent = err.message || 'The class could not be scheduled.'; }
    toast(err.message || 'Could not schedule the class.');
  }).then(function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Schedule class'; }
  });
}

function admCancelClass(id){
  if(!confirm('Cancel this class? Students will no longer see it on their Timetable.')) return;
  GOC.api.cancelClass(id).then(function(){
    toast('Class cancelled.');
    admLoadClasses();
  }, function(err){
    toast(err.message || 'Could not cancel the class.');
  });
}

function admCompleteClass(id){
  GOC.api.updateClass(id, { status: 'completed' }).then(function(){
    toast('Class marked completed.');
    admLoadClasses();
  }, function(err){
    toast(err.message || 'Could not update the class.');
  });
}

function admDeleteClass(id, topic){
  if(!confirm('Permanently delete "' + topic + '"?\n\nThis cannot be undone. Only a cancelled or completed class can be deleted.')) return;
  GOC.api.deleteClass(id).then(function(){
    toast('Class deleted.');
    admLoadClasses();
  }, function(err){
    toast(err.message || 'Could not delete the class.');
  });
}

/* Wipes the whole live-class timetable — every subject, scheduled, cancelled
   or completed — so a fresh schedule can be set from a clean slate. A
   scheduled class can't be deleted directly (the server requires it to be
   cancelled or completed first), so each one is cancelled, then every class
   is deleted, one request at a time so a single failure doesn't abort the
   rest of the batch. */
function admClearAllClasses(){
  if(!confirm('Clear the ENTIRE live-class timetable?\n\nThis cancels and permanently deletes every scheduled, cancelled and completed class across ALL subjects. This cannot be undone.')) return;

  var status = document.getElementById('admClsClearStatus');
  if(status) status.textContent = 'Reading the current timetable…';

  GOC.api.listClasses().then(function(result){
    var classes = result && Array.isArray(result.classes) ? result.classes : [];
    if(!classes.length){
      if(status) status.textContent = 'Timetable is already empty.';
      toast('Nothing to clear — the timetable is already empty.');
      return;
    }

    var total = classes.length;
    var done = 0, failed = 0;

    // One class at a time (cancel-if-needed, then delete) rather than
    // Promise.all, so the requests don't all hit the server at once.
    var chain = classes.reduce(function(p, c){
      return p.then(function(){
        var next = (c.status === 'scheduled') ? GOC.api.cancelClass(c.classId) : Promise.resolve();
        return next.then(function(){
          return GOC.api.deleteClass(c.classId);
        }).then(function(){
          done++;
        }, function(){
          failed++;
        }).then(function(){
          if(status) status.textContent = 'Clearing… ' + (done + failed) + ' / ' + total;
        });
      });
    }, Promise.resolve());

    chain.then(function(){
      var msg = 'Cleared ' + done + ' of ' + total + ' class' + (total === 1 ? '' : 'es') + (failed ? (' — ' + failed + ' failed.') : '.');
      if(status) status.textContent = msg;
      toast(msg);
      admLoadClasses();
    });
  }, function(err){
    if(status) status.textContent = err.message || 'Could not read the timetable.';
    toast(err.message || 'Could not read the timetable.');
  });
}

/* ------------------------------------------------------------ cohorts
   A cohort groups students and can override the academy-wide study
   window / session length / objective clock / question ceilings for
   just that group. admCohortsCache also feeds the cohort picker on the
   Students panel, so it's loaded whenever either panel opens. */
var admCohortsCache = [];
var admCohEditing = {};   // cohortId -> true while its inline edit form is open

function admLoadCohorts(){
  var host = document.getElementById('admCohList');
  if(host) host.innerHTML = '<div class="ad-loading">Loading cohorts…</div>';
  return GOC.api.listCohorts().then(function(result){
    admCohortsCache = (result && Array.isArray(result.cohorts)) ? result.cohorts : [];
    if(host) admRenderCohorts();
    var list = document.getElementById('admCredList');
    if(list) list.innerHTML = admCredHTML();
    admKpiLoad();
  }, function(err){
    admCohortsCache = [];
    if(host) host.innerHTML = '<div class="ad-note warn">' + esc(err.message || 'Could not load cohorts.') + '</div>';
  });
}

function admCohStudentCount(cohortId){
  return studentsData.filter(function(s){ return s.cohort === cohortId; }).length;
}

function admOverrideRow(label, val, suffix){
  return '<div class="ad-metric"><span>'+esc(label)+'</span><b>'+
    (val == null ? 'Inherits academy default' : (esc(String(val)) + (suffix || ' min'))) +
    '</b></div>';
}

function admRenderCohorts(){
  var host = document.getElementById('admCohList');
  if(!host) return;
  if(!admCohortsCache.length){
    host.innerHTML = '<div class="ad-empty">No cohorts yet — create one above.</div>';
    return;
  }
  host.innerHTML = admCohortsCache.map(function(c){
    var count = admCohStudentCount(c.cohortId);
    var editing = !!admCohEditing[c.cohortId];
    var body = '<div class="ac-top"><div class="ad-av">'+esc((c.name||'?').slice(0,2))+'</div>'+
      '<div class="ac-who"><b>'+esc(c.name)+'</b><span>'+count+' student'+(count===1?'':'s')+'</span></div>'+
      '<span class="ad-tag '+(c.status==='active'?'g':'a')+'">'+(c.status==='active'?'Active':'Draft')+'</span></div>'+
      admOverrideRow('Daily study window', c.dailyLimitMin) +
      admOverrideRow('Session length', c.sessionMinutes) +
      admOverrideRow('Session warning', c.sessionWarnMinutes) +
      admOverrideRow('Objective sitting', c.objectiveMinutes);
    if(editing){
      body += '<div class="ad-grid2">'+
        '<div class="ad-field"><label>Daily study window (min)</label><input id="admCohE_limit_'+esc(c.cohortId)+'" type="number" min="30" max="180" value="'+(c.dailyLimitMin==null?'':c.dailyLimitMin)+'" placeholder="inherit"></div>'+
        '<div class="ad-field"><label>Session length (min)</label><input id="admCohE_sess_'+esc(c.cohortId)+'" type="number" min="15" max="480" value="'+(c.sessionMinutes==null?'':c.sessionMinutes)+'" placeholder="inherit"></div></div>'+
        '<div class="ad-grid2">'+
        '<div class="ad-field"><label>Session warning (min)</label><input id="admCohE_warn_'+esc(c.cohortId)+'" type="number" min="1" max="30" value="'+(c.sessionWarnMinutes==null?'':c.sessionWarnMinutes)+'" placeholder="inherit"></div>'+
        '<div class="ad-field"><label>Objective sitting (min)</label><input id="admCohE_obj_'+esc(c.cohortId)+'" type="number" min="5" max="300" value="'+(c.objectiveMinutes==null?'':c.objectiveMinutes)+'" placeholder="inherit"></div></div>'+
        '<p class="ad-note">Leave a field blank to clear the override and inherit the academy default again.</p>'+
        '<div class="ac-btns"><button class="ad-btn pri" onclick="admSaveCohortOverrides(\''+esc(c.cohortId)+'\')">Save</button>'+
        '<button class="ad-btn" onclick="admToggleCohortEdit(\''+esc(c.cohortId)+'\')">Cancel</button></div>';
    }
    body += '<div class="ac-btns">'+
      (editing ? '' : '<button class="ad-btn" onclick="admToggleCohortEdit(\''+esc(c.cohortId)+'\')">Edit overrides</button>')+
      '<button class="ad-btn" onclick="admSetCohortStatus(\''+esc(c.cohortId)+'\',\''+(c.status==='active'?'draft':'active')+'\')">'+(c.status==='active'?'Set draft':'Set active')+'</button>'+
      '<button class="ad-btn danger" onclick="admDeleteCohort(\''+esc(c.cohortId)+'\',\''+esc((c.name||'this cohort').replace(/'/g, "\\'"))+'\')">Delete</button>'+
      '</div>';
    return '<div class="ad-cred">'+body+'</div>';
  }).join('');
}

function admToggleCohortEdit(id){
  admCohEditing[id] = !admCohEditing[id];
  admRenderCohorts();
}

function admReadCohNum(elId){
  var el = document.getElementById(elId);
  if(!el) return undefined;
  var v = String(el.value || '').trim();
  return v === '' ? null : Number(v);
}

function admCreateCohort(){
  var nameEl = document.getElementById('admCohName');
  var name = nameEl ? String(nameEl.value || '').trim() : '';
  if(!name){ toast('Enter a cohort name first.'); return; }
  var btn = document.getElementById('admCohNewBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Creating…'; }

  var payload = { name: name };
  var limit = admReadCohNum('admCohLimit'); if(limit != null) payload.dailyLimitMin = limit;
  var sess = admReadCohNum('admCohSess'); if(sess != null) payload.sessionMinutes = sess;
  var warn = admReadCohNum('admCohWarn'); if(warn != null) payload.sessionWarnMinutes = warn;
  var obj = admReadCohNum('admCohObj'); if(obj != null) payload.objectiveMinutes = obj;

  GOC.api.createCohort(payload).then(function(){
    toast('Cohort created.');
    ['admCohName','admCohLimit','admCohSess','admCohWarn','admCohObj'].forEach(function(id){
      var el = document.getElementById(id); if(el) el.value = '';
    });
    admLoadCohorts();
  }, function(err){
    toast(err.message || 'Could not create the cohort.');
  }).then(function(){
    if(btn){ btn.disabled = false; btn.textContent = 'New cohort'; }
  });
}

function admSaveCohortOverrides(id){
  var patch = {
    dailyLimitMin: admReadCohNum('admCohE_limit_'+id),
    sessionMinutes: admReadCohNum('admCohE_sess_'+id),
    sessionWarnMinutes: admReadCohNum('admCohE_warn_'+id),
    objectiveMinutes: admReadCohNum('admCohE_obj_'+id)
  };
  GOC.api.updateCohort(id, patch).then(function(){
    toast('Cohort updated.');
    admCohEditing[id] = false;
    admLoadCohorts();
  }, function(err){
    toast(err.message || 'Could not update the cohort.');
  });
}

function admSetCohortStatus(id, status){
  GOC.api.updateCohort(id, { status: status }).then(function(){
    toast(status === 'active' ? 'Cohort set active.' : 'Cohort set to draft.');
    admLoadCohorts();
  }, function(err){
    toast(err.message || 'Could not update the cohort.');
  });
}

function admDeleteCohort(id, name){
  if(!confirm('Permanently delete "' + name + '"?\n\nThis cannot be undone, and only an empty cohort (no students assigned) can be deleted.')) return;
  GOC.api.deleteCohort(id).then(function(){
    toast('Cohort deleted.');
    admLoadCohorts();
  }, function(err){
    toast(err.message || 'Could not delete the cohort.');
  });
}

function admSetStudentCohort(studentId, cohortId){
  GOC.api.setStudentCohort(studentId, cohortId || null).then(function(){
    toast('Cohort updated.');
    var s = studentsData.find(function(x){ return x.id === studentId; });
    if(s) s.cohort = cohortId || null;
    var list = document.getElementById('admCredList');
    if(list) list.innerHTML = admCredHTML();
  }, function(err){
    toast(err.message || 'Could not update that student\'s cohort.');
    var list = document.getElementById('admCredList');
    if(list) list.innerHTML = admCredHTML();
  });
}

function admPostUpdate(){
  var elT=document.getElementById('upTitle'), elB=document.getElementById('upBody');
  // If the panel was swapped out the form is gone — bail rather than publish
  // an empty update built from defaults.
  if(!elT || !elB){ toast('Open Homepage updates again to post'); return; }
  var cat=(document.getElementById('upCat')||{}).value||'news';
  var title=(elT.value||'').trim();
  var body=(elB.value||'').trim();
  if(!title||!body){ toast('Add a headline and message first'); return; }
  var btn=document.getElementById('upPostBtn');
  busy(btn, true);
  // The server stamps the date and owns the id, so two admins posting at once
  // cannot collide.
  GOC.api.createUpdate({cat:cat, title:title, body:body}).then(function(){
    busy(btn, false);
    var t=document.getElementById('upTitle'), b=document.getElementById('upBody');
    if(t)t.value=''; if(b)b.value='';
    toast('Update published to homepage');
    return loadUpdates();
  }).catch(function(err){
    busy(btn, false);
    toast(err.message || 'Could not publish that update');
  });
}
function admUpdatesHTML(){
  if(!updatesData.length) return '<p class="ad-p">No updates yet.</p>';
  return updatesData.map(function(u){
    var label={admission:'Admission',utme:'UTME',scholarship:'Scholarship',news:'News'}[u.cat];
    return '<div class="ad-row"><div class="nm"><b>'+esc(u.title)+'</b><span>'+label+' · '+esc(u.date)+'</span></div><button class="ad-btn" style="color:#B91C1C;border-color:#F3C7C7" onclick="admRemoveUpdate('+u.id+')">Remove</button></div>';
  }).join('');
}
function admRemoveUpdate(id){
  GOC.api.removeUpdate(id).then(function(){
    toast('Update removed');
    return loadUpdates();
  }).catch(function(err){ toast(err.message || 'Could not remove that update'); });
}

/* ============== CONSOLE: DAILY AFFIRMATIONS (Task 3, second half, part 2) ==============
   The pool itself now lives on the server (GET/PUT /api/affirmations, wired up in the
   previous pass) — this is just the console screen that calls those two methods. Rows
   are edited in the DOM directly (no separate draft array to keep in sync); Save reads
   every textarea's current value and sends the whole list, same shape as GET/PUT
   /api/settings, so it inherits that pattern's refresh-survives behaviour by construction. */
function admAffirmationsRowsHTML(list){
  if(!list || !list.length) return '<p class="ad-p">No affirmations yet — add one below.</p>';
  return list.map(function(msg){
    return '<div class="ad-row" style="align-items:flex-start"><textarea style="flex:1" maxlength="300">'+esc(msg)+'</textarea><button class="ad-btn warn" onclick="this.closest(\'.ad-row\').remove()">Remove</button></div>';
  }).join('');
}
function admAffLoad(){
  GOC.api.listAffirmations().then(function(list){
    var wrap = document.getElementById('admAffList');
    if(wrap) wrap.innerHTML = admAffirmationsRowsHTML(list);
  }).catch(function(err){
    var wrap = document.getElementById('admAffList');
    if(wrap) wrap.innerHTML = '<p class="ad-note warn">'+esc(err.message || 'Could not load affirmations.')+'</p>';
  });
}
function admAffAddRow(){
  var wrap = document.getElementById('admAffList');
  if(!wrap) return;
  if(!wrap.querySelector('textarea')) wrap.innerHTML = '';
  var row = document.createElement('div');
  row.className = 'ad-row';
  row.style.alignItems = 'flex-start';
  row.innerHTML = '<textarea style="flex:1" maxlength="300" placeholder="New affirmation…"></textarea><button class="ad-btn warn" onclick="this.closest(\'.ad-row\').remove()">Remove</button>';
  wrap.appendChild(row);
  var ta = row.querySelector('textarea'); if(ta) ta.focus();
}
function admSaveAffirmations(){
  var wrap = document.getElementById('admAffList');
  var note = document.getElementById('admAffNote');
  var btn  = document.getElementById('admAffSaveBtn');
  if(!wrap) return;
  var list = Array.prototype.map.call(wrap.querySelectorAll('textarea'), function(t){ return t.value; });
  if(note){ note.textContent=''; note.className='ad-note'; }
  busy(btn, true);
  GOC.api.saveAffirmations(list).then(function(saved){
    busy(btn, false);
    wrap.innerHTML = admAffirmationsRowsHTML(saved && saved.length ? saved : list);
    if(note) note.textContent = 'Saved.';
  }).catch(function(err){
    busy(btn, false);
    if(note){ note.textContent = err.message || 'Could not save affirmations.'; note.className='ad-note warn'; }
  });
}

/* ============== CONSOLE: WEB TEST MANAGEMENT (Priority 4) ==============
   The console already had a Question bank section and a Results section, so both
   are extended here instead of a second question system being built beside them.
   The bank these panels write to is the one every web test, the practice engine
   and the CBT mock draw from, and the results are the very records the student
   sees. None of it is reachable from a student account: every call below is
   refused by the API unless the console has been unlocked by staff. */
var admQDraft  = null;    // the question being composed or edited
var admQFilter = 'all';   // which session the published list is showing (Web Test bank only)
var admQBank   = 'webtest'; // 'webtest' (theory/objective/jamb) or 'practice' — the two panels kept apart
var admQSelected = {};    // ids checked in the bank list, for bulk delete
var admQCache  = [];      // last read of the bank, so Edit can fill the form
var admRFilter = { section:'', subject:'', status:'', scholarId:'', cohort:'' };
var admRCache  = [];
var admRAttempt = null;   // the sitting open for reading or hand marking
var admTMCache   = [];    // last read of every theory sitting, for the dedicated marking panel
var admTMSubject = '';    // which subject that panel's list is narrowed to ('' = every subject)

/* There is one test, so every record reads as that one test however it was
   stored. A paper filed when the academy ran a weekly and a monthly sitting
   still reads "Test" here rather than naming a period that no longer exists. */
function admPeriodLabel(){
  return GOC.api.rules.PERIOD_LABEL;
}
function admCompletion(a){
  if(!a || !a.total) return 'not attempted';
  return a.unanswered ? (a.answered + ' of ' + a.total + ' attempted') : 'completed';
}
function admQBlank(){
  return { id:null, period:GOC.api.rules.PERIOD, section:(admQBank === 'practice' ? 'practice' : 'objective'),
           topic:'', text:'', options:['','','',''], answer:0, expected:'', maxMark:10,
           difficulty:'medium', explanation:'', active:true };
}
function admQNeeds(){ if(!admQDraft) admQDraft = admQBlank(); return admQDraft; }
function admQOpts(pairs, cur){
  return pairs.map(function(p){
    return '<option value="'+esc(p[0])+'"'+(String(p[0])===String(cur)?' selected':'')+'>'+p[1]+'</option>';
  }).join('');
}
function admLetter(i){ return String.fromCharCode(65 + i); }
/* 4.1 — one form for both kinds of question. The fields change with the chosen
   session (options + correct answer for objective, reference answer + maximum
   mark for theory) and the draft survives the swap, so nothing typed is lost. */
function admQFormHTML(){
  var d = admQNeeds();
  if(admQBank === 'practice') d.section = 'practice';
  var theory = d.section === 'theory';
  var h;
  if(admQBank === 'practice'){
    h = '<div class="ad-grid2">'
      + '<div class="ad-field"><label>Test section</label><input value="Practice only — not in Web Test" readonly></div>'
      + '<div class="ad-field"><label>Question type</label><input id="admQKind" value="Objective — multiple choice" readonly></div>'
      + '</div>';
  } else {
    h = '<div class="ad-grid2">'
      + '<div class="ad-field"><label>Test section</label><select id="admQSection" onchange="admQSet()">'
      + admQOpts([['objective','Objective session'],['theory','Theory session'],['jamb','JAMB-oriented session']], d.section)
      + '</select></div>'
      + '<div class="ad-field"><label>Question type</label><input id="admQKind" value="'
      + (theory ? 'Theory — written answer' : 'Objective — multiple choice') + '" readonly></div>'
      + '</div>';
  }
  h += '<div class="ad-field"><label>Topic</label><input id="admQTopic" value="'+esc(d.topic)+'" placeholder="e.g. Kinematics"></div>'
    + '<div class="ad-field"><label>Question</label><textarea id="admQText" oninput="admQPrev()" placeholder="Type the question exactly as the student will read it">'+esc(d.text)+'</textarea></div>';
  if(theory){
    h += '<div class="ad-field"><label>Expected / reference answer</label><textarea id="admQExpected" oninput="admQPrev()" placeholder="What a full-mark answer must contain — only the marker ever sees this">'+esc(d.expected)+'</textarea></div>'
      + '<div class="ad-grid2">'
      + '<div class="ad-field"><label>Maximum mark</label><input id="admQMax" type="number" min="1" max="100" value="'+esc(d.maxMark)+'"></div>'
      + '<div class="ad-field"><label>Difficulty</label><select id="admQDiff">'
      + admQOpts([['easy','Easy'],['medium','Medium'],['hard','Hard']], d.difficulty) + '</select></div></div>'
      + '<p class="ad-note">A theory question is never scored automatically. The reference answer and maximum mark above are only the template — actual marking of what a student wrote happens in <b>Console → Mark theory papers</b>, not here.</p>';
    /* Some subjects are examined in the objective sitting only. Saying so here is
       a courtesy — the data layer refuses the question either way. */
    if(!GOC.api.rules.theoryAllowed(admSubj)){
      h += '<p class="ad-note warn">' + esc(GOC.api.rules.noTheoryMessage(admSubj))
        + ' A theory question cannot be filed under it — choose the objective or JAMB-oriented session, or switch to the Practice tab above.</p>';
    }
  } else {
    h += (d.section === 'practice'
      ? '<p class="ad-note">Filed as practice-only: this question reaches the student\'s Practice screen and nowhere else — it is never drawn into the Objective, Theory or JAMB-oriented Web Test.</p>'
      : '<p class="ad-note">Fill in between two and five options, then say which one is correct.</p>');
    for(var i = 0; i < d.options.length; i++){
      h += '<div class="ad-field"><label>Option '+admLetter(i)+(i === Number(d.answer) ? ' · correct' : '')+'</label>'
        + '<input id="admQO'+i+'" oninput="admQPrev()" value="'+esc(d.options[i])+'" placeholder="Option '+admLetter(i)+'"></div>';
    }
    h += '<div class="ad-grid2">'
      + '<div class="ad-field"><label>Correct answer</label><select id="admQAnswer" onchange="admQSet()">'
      + admQOpts(d.options.map(function(o, j){ return [j, 'Option ' + admLetter(j)]; }), d.answer)
      + '</select></div>'
      + '<div class="ad-field"><label>Difficulty</label><select id="admQDiff">'
      + admQOpts([['easy','Easy'],['medium','Medium'],['hard','Hard']], d.difficulty) + '</select></div></div>';
  }
  h += '<div class="ad-field"><label>Explanation (optional)</label><textarea id="admQWhy" oninput="admQPrev()" placeholder="Shown with the answer once the paper has been marked">'+esc(d.explanation)+'</textarea></div>'
    + '<div id="admQPrevBox">' + admQPrevHTML() + '</div>'
    + '<div class="ad-field"><label>Availability</label><select id="admQActive">'
    + admQOpts([['yes','Active — may be served to students'],['no','Inactive — held back']], d.active ? 'yes' : 'no')
    + '</select></div>'
    + '<div class="ad-actions"><button class="ad-btn pri" id="admQSaveBtn" onclick="admQSave()">'
    + (d.id ? 'Update question #'+esc(d.id) : 'Add to the bank') + '</button>'
    + (d.id ? '<button class="ad-btn" onclick="admQCancel()">Cancel edit</button>' : '') + '</div>';
  return h;
}
/* Reads whatever is on screen back into the draft. Selects are only trusted when
   they report a value, so a repaint can never blank a field. */
function admQRead(){
  var d = admQNeeds();
  function v(id){ var e = document.getElementById(id); return e ? String(e.value == null ? '' : e.value) : null; }
  if(admQBank === 'practice') d.section = 'practice';
  else { var s = v('admQSection'); if(s) d.section = s; }
  var f = v('admQDiff');    if(f) d.difficulty = f;
  var a = v('admQActive');  if(a) d.active = a !== 'no';
  var t = v('admQTopic');   if(t !== null) d.topic = t;
  var q = v('admQText');    if(q !== null) d.text = q;
  var w = v('admQWhy');     if(w !== null) d.explanation = w;
  if(d.section === 'theory'){
    var x = v('admQExpected'); if(x !== null) d.expected = x;
    var m = v('admQMax');      if(m) d.maxMark = Number(m) || d.maxMark;
  } else {
    for(var i = 0; i < d.options.length; i++){
      var o = v('admQO' + i); if(o !== null) d.options[i] = o;
    }
    var n = v('admQAnswer'); if(n) d.answer = Number(n) || 0;
  }
  return d;
}
function admQRepaint(){
  var host = document.getElementById('admQForm');
  if(host) host.innerHTML = admQFormHTML();
}
/* The live preview under the editor. It gathers whatever the author has typed —
   the stem, the reference answer or the options, the explanation — and hands the
   lot to the shared preview. Only the preview node is rebuilt, never the form,
   because repainting a form while somebody is typing in it moves the caret to
   the end of the field. */
function admQPrevHTML(){
  var d = admQNeeds(), parts = [{ label:'Question', src:d.text }], i;
  if(d.section === 'theory'){
    parts.push({ label:'Reference answer', src:d.expected });
  } else {
    for(i = 0; i < d.options.length; i++){
      parts.push({ label:admLetter(i), src:d.options[i] });
    }
  }
  parts.push({ label:'Why', src:d.explanation });
  return mathPrev(parts);
}
function admQPrev(){
  admQRead();
  var box = document.getElementById('admQPrevBox');
  if(box) box.innerHTML = admQPrevHTML();
}
function admQSet(){ admQRead(); admQRepaint(); }
function admQCancel(){ admQDraft = admQBlank(); admQRepaint(); toast('Edit cancelled'); }
/* The subject is never typed in: it is whichever subject the segmented control
   above the form is showing, so a question cannot be filed under a subject the
   academy does not teach. The API validates the rest. */
function admQSave(){
  var d = admQRead();
  var payload = {
    subject: admSubj, period: d.period, section: d.section,
    topic: String(d.topic || '').trim(), text: String(d.text || '').trim(),
    difficulty: d.difficulty, explanation: String(d.explanation || '').trim(),
    active: !!d.active
  };
  if(d.section === 'theory'){
    if(!GOC.api.rules.theoryAllowed(admSubj)){ toast(GOC.api.rules.noTheoryMessage(admSubj)); return; }
    payload.expected = String(d.expected || '').trim();
    payload.maxMark = Number(d.maxMark) || 0;
  } else {
    var opts = [], ans = -1;
    d.options.forEach(function(o, j){
      var one = String(o == null ? '' : o).trim();
      if(!one) return;
      if(j === Number(d.answer)) ans = opts.length;
      opts.push(one);
    });
    if(opts.length < 2){ toast('An objective question needs at least two options'); return; }
    if(ans < 0){ toast('Mark one of the options you filled in as the correct answer'); return; }
    payload.options = opts;
    payload.answer = ans;
  }
  var btn = document.getElementById('admQSaveBtn');
  busy(btn, true);
  var after = function(msg){
    busy(btn, false);
    admQDraft = admQBlank();
    admQRepaint();
    toast(msg);
    admQLoad();
  };
  var failed = function(err){ busy(btn, false); toast(err.message || 'That question was not accepted'); };
  if(d.id) GOC.api.updateQuestion(d.id, payload).then(function(q){ after('Question #' + q.id + ' updated'); }, failed);
  else GOC.api.createQuestion(payload).then(function(q){ after('Question #' + q.id + ' added to ' + payload.subject); }, failed);
}
/* 4.2 — edit the wording, correct the answer, change the maximum mark. The same
   form is reused, filled from the bank, so there is one place questions are
   written and one place they are corrected. */
function admQEditQ(id){
  var q = null;
  admQCache.forEach(function(r){ if(String(r.id) === String(id)) q = r; });
  if(!q){ toast('That question is no longer in the bank'); return; }
  admQDraft = {
    id: q.id, period: GOC.api.rules.normalizePeriod(q.period), section: q.section || 'objective',
    topic: q.topic || '', text: q.text || '',
    options: (q.options && q.options.length ? q.options.slice() : ['','','','']),
    answer: q.answer == null ? 0 : Number(q.answer),
    expected: q.expected || '', maxMark: q.maxMark || 10,
    difficulty: q.difficulty || 'medium', explanation: q.explanation || '',
    active: q.active !== false
  };
  admQRepaint();
  toast('Editing question #' + q.id + ' — the form above is filled in');
}
function admQToggle(id, on){
  GOC.api.setQuestionActive(id, on).then(function(){
    toast(on ? 'Question #' + id + ' is live again'
             : 'Question #' + id + ' held back — it will not be served to students');
    admQLoad();
  }, function(err){ toast(err.message || 'Could not change that question'); });
}
/* The server (and the mock API behind it) only ever deletes a held-back
   question — a live one must be deactivated first, so a student mid-way
   through answering it can't have it pulled out from under them. That two-step
   rule used to be the admin's own job to remember, and a click on "Delete"
   for a still-active question just silently failed with "Deactivate this
   question before deleting it" — easy to read as the delete function itself
   not responding. admQForceDelete does the deactivate-then-delete itself, in
   order, so one click finishes the job regardless of the question's current
   state. */
function admQForceDelete(id){
  var q = null;
  admQCache.forEach(function(r){ if(String(r.id) === String(id)) q = r; });
  var doDelete = function(){ return GOC.api.deleteQuestion(id); };
  if(q && q.active !== false) return GOC.api.setQuestionActive(id, false).then(doDelete);
  return doDelete();
}
function admQDelete(id){
  if(!confirm('Permanently delete question #' + id + '?\n\nThis cannot be undone.')) return;
  admQForceDelete(id).then(function(){
    toast('Question #' + id + ' deleted');
    delete admQSelected[id];
    admQLoad();
  }, function(err){ toast(err.message || 'Could not delete that question'); });
}
/* ---- deleting several at once ----
   A checkbox on every card feeds this selection; the bar above the list only
   shows itself once something is checked, and stays out of the way otherwise. */
function admQToggleSelect(id, on){
  if(on) admQSelected[id] = true; else delete admQSelected[id];
  var bar = document.getElementById('admQBulkBar');
  if(bar) bar.innerHTML = admQBulkBarHTML();
}
function admQClearSelection(){
  admQSelected = {};
  admQRender();
}
function admQBulkBarHTML(){
  var ids = Object.keys(admQSelected);
  if(!ids.length) return '';
  return '<div class="ad-actions ad-bulkbar">'
    + '<span>' + ids.length + ' question' + (ids.length !== 1 ? 's' : '') + ' selected</span>'
    + '<button class="ad-btn danger" id="admQBulkDelBtn" onclick="admQBulkDelete()">Delete selected</button>'
    + '<button class="ad-btn" onclick="admQClearSelection()">Clear</button>'
    + '</div>';
}
/* Runs the deactivate-then-delete for each checked id in turn (not all at
   once) so one question's server error can't abort the rest — everything
   that can go is gone, and the toast at the end says how many of each. */
function admQBulkDelete(){
  var ids = Object.keys(admQSelected);
  if(!ids.length) return;
  if(!confirm('Permanently delete ' + ids.length + ' question' + (ids.length !== 1 ? 's' : '') + '?\n\nThis cannot be undone.')) return;
  var btn = document.getElementById('admQBulkDelBtn');
  busy(btn, true);
  var okCount = 0, failCount = 0;
  var chain = Promise.resolve();
  ids.forEach(function(id){
    chain = chain.then(function(){
      return admQForceDelete(id).then(function(){ okCount++; }, function(){ failCount++; });
    });
  });
  chain.then(function(){
    admQSelected = {};
    busy(btn, false);
    toast(okCount + ' question' + (okCount !== 1 ? 's' : '') + ' deleted'
      + (failCount ? ', ' + failCount + ' could not be deleted' : ''));
    admQLoad();
  });
}
/* Builds <option> markup for the bulk-delete-by-filter selects. Accepts
   either a flat list of subject names or a list of [value,label] pairs
   for section, with an "All ..." option (value "all") always first —
   matching the server contract for DELETE /api/questions/bulk, which
   treats the literal string "all" as "every subject"/"every section". */
function admQBulkFilterOptsHTML(list, allLabel){
  var opts = '<option value="all">'+esc(allLabel)+'</option>';
  (list || []).forEach(function(item){
    var val = Array.isArray(item) ? item[0] : item;
    var label = Array.isArray(item) ? item[1] : item;
    opts += '<option value="'+esc(val)+'">'+esc(label)+'</option>';
  });
  return opts;
}
/* Bulk delete by subject+section rather than by hand-picked selection.
   Confirms with the actual choice and a live count (a fresh listQuestions
   with the same filter, so the number shown matches what will actually be
   deleted) before sending the request — the request is never sent without
   that confirmation. On success it refreshes the totals and the list the
   same way any other question edit does. */
function admQBulkDeleteByFilter(){
  var subjSel = document.getElementById('admQBulkSubj');
  var sectSel = document.getElementById('admQBulkSect');
  if(!subjSel || !sectSel) return;
  var subject = subjSel.value, section = sectSel.value;
  var subjLabel = subject === 'all' ? 'all subjects' : subject;
  var sectLabel = section === 'all' ? 'all sections' : sectSel.options[sectSel.selectedIndex].text;
  var btn = document.getElementById('admQBulkFilterBtn');
  busy(btn, true);
  /* A single .then().catch() chain (not .then(ok, fail)) so that anything that
     throws inside a step — not only a rejected request — still lands in the
     catch and un-sticks the button instead of leaving it on "Please wait…". */
  GOC.api.listQuestions({
    subject: subject === 'all' ? undefined : subject,
    section: section === 'all' ? undefined : section
  }).then(function(r){
    var count = (r && r.questions && r.questions.length) || 0;
    if(!count){ busy(btn, false); toast('No matching questions to delete.'); return; }
    var msg = (subject === 'all' && section === 'all')
      ? 'Delete ALL ' + count + ' questions in the Question Bank permanently?'
      : 'Delete all ' + count + ' ' + subjLabel + ' ' + sectLabel + ' questions permanently?';
    if(!confirm(msg + '\n\nThis cannot be undone.')){ busy(btn, false); return; }
    return GOC.api.bulkDeleteQuestions(subject, section).then(function(res){
      busy(btn, false);
      toast((res && res.deleted || 0) + ' question' + ((res && res.deleted) === 1 ? '' : 's') + ' deleted');
      admQLoad();
    });
  }).catch(function(err){
    busy(btn, false);
    toast((err && err.message) || 'Could not delete those questions.');
  });
}
function admQSetFilter(f){ admQFilter = f; admQRender(); }
function admQTabsHTML(){
  if(admQBank === 'practice') return '';
  return [['all','All'],['theory','Theory'],['objective','Objective'],['jamb','JAMB']].map(function(t){
    return '<button class="'+(admQFilter === t[0] ? 'on' : '')+'" onclick="admQSetFilter(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('');
}
/* ---- Web Test vs Practice: two panels, one container ----
   Switching banks rebuilds the whole Question bank screen (the same way
   switching subject already does via admSetSubj -> admOpen) so the form, the
   session tabs, the list and the reflection card all agree on which bank is
   showing. Any in-progress draft and bulk selection are dropped on switch —
   they belong to whichever bank's list they were made from. */
function admQSetBank(b){
  if(admQBank === b) return;
  admQBank = b;
  admQFilter = 'all';
  admQDraft = null;
  admQSelected = {};
  admOpen('questions');
}
function admQBankTabsHTML(){
  return [['webtest','Web test'],['practice','Practice']].map(function(t){
    return '<button class="'+(admQBank === t[0] ? 'on' : '')+'" onclick="admQSetBank(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('');
}
function admQLoad(){
  var host = document.getElementById('admQList');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Loading the bank…</div>';
  GOC.api.listQuestions({ subject: admSubj }).then(function(r){
    admQCache = (r && r.questions) || [];
    admQRender();
  }, function(err){
    admQCache = [];
    var h = document.getElementById('admQList');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The question bank is not available.')+'</div>';
  });
  admQTotalsLoad();
  if(admQBank === 'practice') admQPracticeRefLoad(); else admQRefLoad();
}
/* The count-only summary — Theory / Objective / JAMB / Practice, each its own
   total across every subject — visible at the top of the screen regardless of
   which bank panel is open below, computed server-side (GET
   /api/questions/counts) rather than by paging the whole bank to the browser. */
function admQTotalsLoad(){
  var host = document.getElementById('admQTotals');
  if(!host) return;
  GOC.api.questionCounts().then(function(r){
    var h = document.getElementById('admQTotals');
    if(!h) return;
    var t = (r && r.totals) || { theory:0, objective:0, jamb:0, practice:0 };
    h.innerHTML = '<span>Bank totals</span><b>Theory ' + t.theory + ' · Objective ' + t.objective +
      ' · JAMB ' + t.jamb + ' · Practice ' + t.practice + '</b>';
  }, function(err){
    var h = document.getElementById('admQTotals');
    if(h) h.innerHTML = '<span>Bank totals</span><b>'+esc(err.message || 'not available')+'</b>';
  });
}
/* ---- the objective sitting ----
   Two settings and one honest picture of the paper they produce. The clock and
   the counts are clamped by the data layer, so what the console shows after a
   save is what the academy actually holds, not what was typed. */
var admObjMin = 0, admObjRows = [], admObjCeil = null;
function admObjLoad(){
  var host = document.getElementById('admObjList');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Reading the bank…</div>';
  GOC.api.objectiveBlueprint({}).then(function(r){
    admObjMin = Number(r && r.minutes) || 0;
    admObjRows = (r && r.papers) || [];
    admObjCeil = (r && r.ceiling) || null;
    admObjPaintClock();
    admObjRender();
  }, function(err){
    admObjRows = [];
    var h = document.getElementById('admObjList');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The objective sitting is not available.')+'</div>';
  });
}
/* The academy sets a sitting in hours — "two hours", not "120 minutes" — so both
   readings are the hours label. Minutes remain the stored unit underneath. */
function admObjPaintClock(){
  var a = document.getElementById('admObjMin'), b = document.getElementById('admObjStepVal');
  var label = GOC.api.rules.hoursLabel(admObjMin);
  if(a) a.textContent = label;
  if(b) b.textContent = label;
}
function admObjStep(d){
  GOC.api.setObjectiveMinutes(GOC.api.rules.stepObjectiveMinutes(admObjMin, d)).then(function(st){
    admObjMin = Number(st && st.objectiveMinutes) || admObjMin;
    admObjPaintClock();
    toast('The objective sitting runs for ' + GOC.api.rules.hoursLabel(admObjMin));
  }, function(err){
    toast(err.message || 'That clock could not be saved');
  });
}
function admObjRender(){
  var host = document.getElementById('admObjList');
  if(!host) return;
  if(!admObjRows.length){
    host.innerHTML = '<div class="ad-empty">No paper is set for this sitting yet.</div>';
    return;
  }
  var total = 0, i;
  for(i = 0; i < admObjRows.length; i++) total += Number(admObjRows[i].serving) || 0;
  host.innerHTML = admObjRows.map(function(r, n){
    /* Three numbers, and they are different things: what the ceiling allows,
       what management asked for, and what the bank can actually serve. */
    var short = r.available < r.want;
    var tag = r.want === 0 ? '<span class="ad-tag r">Not served</span>'
            : (short ? '<span class="ad-tag a">'+(r.want - r.available)+' short</span>'
                     : '<span class="ad-tag g">Bank covers it</span>');
    return '<div class="ad-cred"><div class="ac-top">'+
      '<div class="ac-who"><b>'+esc(r.subject)+'</b><span>serving '+r.serving+
      ' of '+r.want+' asked · '+r.available+' live in the bank · ceiling '+r.ceiling+'</span></div>'+tag+'</div>'+
      '<div class="stepper" style="margin-top:8px"><button onclick="admObjCount('+n+',-5)">−</button>'+
      '<b>'+r.want+' question'+(r.want === 1 ? '' : 's')+'</b>'+
      '<button onclick="admObjCount('+n+',5)">+</button></div></div>';
  }).join('') +
    '<div class="ad-metric"><span>A full four-subject sitting</span><b>'+total+' question'+
    (total === 1 ? '' : 's')+'</b></div>' +
    (admObjCeil ? '<p class="ad-note">The UTME ceiling for a four-subject combination is '+
      (Number(admObjCeil.english) + Number(admObjCeil.science) * 3)+
      ' questions. A student sits only their own combination, so their total is lower if they carry fewer subjects.</p>' : '');
}
function admObjCount(n, d){
  var r = admObjRows[n];
  if(!r) return;
  GOC.api.setObjectiveCount(r.subject, (Number(r.want) || 0) + d).then(function(res){
    toast(r.subject + ' · ' + res.questions + ' question' + (res.questions === 1 ? '' : 's') +
      ' of a possible ' + res.ceiling);
    admObjLoad();
  }, function(err){
    toast(err.message || 'That count could not be saved');
  });
}
/* ---- the Web Test reflection ----
   Reads the whole bank, not one subject, and reports it the way a student meets
   it: per paper, per test period, per session. Called from admQLoad(), so every
   save, edit and hold-back refreshes it without a separate step. */
function admQRefCardHTML(){
  return '<div class="ad-card"><div class="ad-h">How this lands in the Web Test</div>'+
    '<p class="ad-p">What a student sits after you publish. Only active questions are counted — a question held back is not served, so it is not counted here.</p>'+
    '<div id="admQRef"><div class="ad-loading">Reading the bank…</div></div></div>';
}
function admQRefLoad(){
  var host = document.getElementById('admQRef');
  if(!host) return;
  GOC.api.listQuestions({ activeOnly: true }).then(function(r){
    var h = document.getElementById('admQRef');
    if(h) h.innerHTML = admQRefHTML((r && r.questions) || []);
  }, function(err){
    var h = document.getElementById('admQRef');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The question bank is not available.')+'</div>';
  });
}
/* Practice's own reflection: a subject count only, since practice carries no
   sessions to break down (item 5's "subject counts only, no section
   breakdown"). */
function admQPracticeRefCardHTML(){
  return '<div class="ad-card"><div class="ad-h">Practice bank, by subject</div>'+
    '<p class="ad-p">Live practice questions available to a student, per subject. Practice has no sessions of its own, so this is a subject count only.</p>'+
    '<div id="admQPracticeRef"><div class="ad-loading">Reading the bank…</div></div></div>';
}
function admQPracticeRefLoad(){
  var host = document.getElementById('admQPracticeRef');
  if(!host) return;
  GOC.api.listQuestions({ section:'practice', activeOnly: true }).then(function(r){
    var h = document.getElementById('admQPracticeRef');
    if(h) h.innerHTML = admQPracticeRefHTML((r && r.questions) || []);
  }, function(err){
    var h = document.getElementById('admQPracticeRef');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The question bank is not available.')+'</div>';
  });
}
function admQPracticeRefHTML(rows){
  var subs = ['Use of English','Physics','Chemistry','Biology','Mathematics'];
  var out = '', gaps = [];
  subs.forEach(function(s){
    var mine = rows.filter(function(q){ return canonSubject(q.subject) === s; });
    if(!mine.length) gaps.push(s);
    out += '<div class="ad-metric"><span>' + esc(s) + '</span><b>' + mine.length +
      ' live question' + (mine.length !== 1 ? 's' : '') + '</b></div>';
  });
  out += gaps.length
    ? '<p class="ad-warn">No live practice question yet in ' + esc(gaps.join(', ')) + '.</p>'
    : '<p class="ad-note">Every subject has at least one live practice question.</p>';
  return out;
}
function admQRefHTML(rows){
  var subs = ['Use of English','Physics','Chemistry','Biology','Mathematics'];
  var secs = ['objective','theory','jamb'];
  var out = '', gaps = [];
  subs.forEach(function(s){
    var mine = rows.filter(function(q){ return canonSubject(q.subject) === s; });
    out += '<div class="ad-sub">' + esc(s) + ' · ' + mine.length +
           ' live question' + (mine.length !== 1 ? 's' : '') + '</div>';
    if(!mine.length){
      gaps.push(s);
      out += '<div class="ad-empty">No live question in ' + esc(s) +
             ' — a student who sits this paper is offered no web test in it yet.</div>';
      return;
    }
    /* One test, so the only breakdown that means anything is by session. */
    var parts = secs.map(function(sec){
      var n = mine.filter(function(q){ return q.section === sec; }).length;
      return wtSectionLabel(sec) + ' ' + n;
    });
    out += '<div class="ad-metric"><span>' + esc(parts.join(' · ')) +
           '</span><b>' + mine.length + '</b></div>';
  });
  out += gaps.length
    ? '<p class="ad-warn">' + gaps.length + ' paper' + (gaps.length !== 1 ? 's have' : ' has') +
      ' nothing live: ' + esc(gaps.join(', ')) + '. Publish at least one question in each session you intend students to sit.</p>'
    : '<p class="ad-note">Every paper has live questions. A student sees only the papers in their own combination.</p>';
  return out;
}
/* ================= CONSOLE: READING NOTES =================
   A note is what a student reads in Read / Learn. It is written here and
   nowhere else: the reading screen holds no prose of its own. The topic is the
   same label the question bank uses, so a note and the questions on the same
   topic sit together for the student.

   Body is stored as plain text and every character of it is escaped before
   anything is done with it — so a note pasted out of a spreadsheet cannot put
   HTML into a student's screen. The one thing the Hub sets rather than shows
   verbatim is a formula between dollar signs, and it sets that from the escaped
   text, never from what was typed. */
var admNCache = [];
var admNFilter = 'all';
var admNDraft = null;

function admNBlank(){ return { id:null, topic:'', title:'', body:'', minutes:'', active:true }; }
function admNNeeds(){ if(!admNDraft) admNDraft = admNBlank(); return admNDraft; }
function admNFormHTML(){
  var d = admNNeeds();
  return '<div class="ad-grid2">'
    + '<div class="ad-field"><label>Topic</label><input id="admNTopic" value="'+esc(d.topic)+'" placeholder="e.g. Kinematics"></div>'
    + '<div class="ad-field"><label>Reading time (optional)</label><input id="admNMins" type="number" min="1" max="120" value="'+esc(d.minutes)+'" placeholder="worked out from the length"></div>'
    + '</div>'
    + '<div class="ad-field"><label>Title</label><input id="admNTitle" oninput="admNPrev()" value="'+esc(d.title)+'" placeholder="e.g. Acceleration"></div>'
    + '<div class="ad-field"><label>The note</label><textarea id="admNBody" rows="8" oninput="admNPrev()" placeholder="Write the note as the student will read it. Leave a blank line between paragraphs.">'+esc(d.body)+'</textarea></div>'
    + '<div id="admNPrevBox">' + admNPrevHTML() + '</div>'
    + '<div class="ad-field"><label>Availability</label><select id="admNActive">'
    + admQOpts([['yes','Active — students may read it'],['no','Inactive — held back']], d.active ? 'yes' : 'no')
    + '</select></div>'
    + '<p class="ad-note">Plain text, except for formulas written between dollar signs. A blank line starts a new paragraph; anything else that looks like markup is shown as the characters you typed, never run.</p>'
    + '<div class="ad-actions"><button class="ad-btn pri" id="admNSaveBtn" onclick="admNSave()">'
    + (d.id ? 'Update note #'+esc(d.id) : 'Publish note') + '</button>'
    + (d.id ? '<button class="ad-btn" onclick="admNCancel()">Cancel edit</button>' : '') + '</div>';
}
function admNRead(){
  var d = admNNeeds();
  function v(id){ var e = document.getElementById(id); return e ? String(e.value == null ? '' : e.value) : null; }
  var t = v('admNTopic'); if(t !== null) d.topic = t;
  var h = v('admNTitle'); if(h !== null) d.title = h;
  var b = v('admNBody');  if(b !== null) d.body = b;
  var m = v('admNMins');  if(m !== null) d.minutes = m;
  var a = v('admNActive'); if(a) d.active = a !== 'no';
  return d;
}
function admNRepaint(){
  var host = document.getElementById('admNForm');
  if(host) host.innerHTML = admNFormHTML();
}
/* The same live proof for a reading note. A note is long, so the preview shows
   the whole body: a formula in the third paragraph is exactly the one an author
   cannot check by eye. */
function admNPrevHTML(){
  var d = admNNeeds();
  return mathPrev([{ label:'Title', src:d.title }, { label:'', src:d.body }]);
}
function admNPrev(){
  admNRead();
  var box = document.getElementById('admNPrevBox');
  if(box) box.innerHTML = admNPrevHTML();
}
function admNCancel(){ admNDraft = admNBlank(); admNRepaint(); }
function admNSave(){
  var d = admNRead();
  var payload = { subject: admSubj, topic: String(d.topic || '').trim(),
                  title: String(d.title || '').trim(), body: String(d.body || ''),
                  active: !!d.active };
  if(String(d.minutes || '').trim()) payload.minutes = Number(d.minutes);
  var btn = document.getElementById('admNSaveBtn');
  busy(btn, true);
  var after = function(msg){
    busy(btn, false); admNDraft = admNBlank(); admNRepaint(); toast(msg); admNLoad();
  };
  var failed = function(err){ busy(btn, false); toast(err.message || 'That note was not accepted'); };
  if(d.id) GOC.api.updateNote(d.id, payload).then(function(n){ after('Note #' + n.id + ' updated'); }, failed);
  else GOC.api.createNote(payload).then(function(n){ after('Note #' + n.id + ' published to ' + payload.subject); }, failed);
}
function admResourceFilePicked(input){
  var label = document.getElementById('admResFileLabel');
  if(!label) return;

  var file = input && input.files && input.files[0];

  if(!file){
    label.textContent = 'Choose a resource file';
    return;
  }

  label.textContent = file.name + ' · ' + Math.round(file.size / 1024 / 1024 * 10) / 10 + ' MB';
}

function admUploadResource(){
  var titleEl = document.getElementById('admResTitle');
  var descEl = document.getElementById('admResDescription');
  var catEl = document.getElementById('admResCategory');
  var fileEl = document.getElementById('admResFile');
  var btn = document.getElementById('admResUploadBtn');
  var status = document.getElementById('admResStatus');

  var title = titleEl ? String(titleEl.value || '').trim() : '';
  var description = descEl ? String(descEl.value || '').trim() : '';
  var category = catEl ? String(catEl.value || '').trim() : '';
  var file = fileEl && fileEl.files ? fileEl.files[0] : null;

  if(!title){
    toast('Enter a resource title first.');
    return;
  }

  if(!admSubj){
    toast('Select a subject first.');
    return;
  }

  if(!category){
    toast('Select a resource category.');
    return;
  }

  if(!file){
    toast('Choose a resource file first.');
    return;
  }

  if(file.size > 50 * 1024 * 1024){
    toast('The resource file must not exceed 50 MB.');
    return;
  }

  var form = new FormData();
  form.append('title', title);
  form.append('description', description);
  form.append('subject', admSubj);
  form.append('category', category);
  form.append('file', file);

  if(btn){
    btn.disabled = true;
    btn.textContent = 'Uploading…';
  }

  if(status){
    status.textContent = 'Uploading ' + file.name + '…';
  }

  GOC.api.uploadResource(form).then(function(result){
    if(status){
      status.textContent = 'Uploaded successfully. The resource is saved as a draft — publish it below to make it visible to students.';
    }

    toast('Resource uploaded successfully.');

    if(titleEl) titleEl.value = '';
    if(descEl) descEl.value = '';
    if(fileEl) fileEl.value = '';

    var label = document.getElementById('admResFileLabel');
    if(label) label.textContent = 'Choose a resource file';

    admLoadResources();
  }, function(err){
    if(status){
      status.textContent = err.message || 'The resource could not be uploaded.';
    }

    toast(err.message || 'Resource upload failed.');
  }).then(function(){
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Upload resource';
    }
  });
}

function admVideoFilePicked(input){
  var label = document.getElementById('admVidFileLabel');
  if(!label) return;

  var file = input && input.files && input.files[0];

  if(!file){
    label.textContent = 'Choose an MP4 file (optional)';
    return;
  }

  label.textContent = file.name + ' · ' + Math.round(file.size / 1024 / 1024 * 10) / 10 + ' MB';
}

function admUploadVideo(){
  var titleEl = document.getElementById('admVidTitle');
  var typeEl = document.getElementById('admVidType');
  var tutorEl = document.getElementById('admVidTutor');
  var durationEl = document.getElementById('admVidDuration');
  var fileEl = document.getElementById('admVidFile');
  var linkEl = document.getElementById('admVidLink');
  var btn = document.getElementById('admVidUploadBtn');
  var status = document.getElementById('admVidStatus');

  var title = titleEl ? String(titleEl.value || '').trim() : '';
  var type = typeEl ? String(typeEl.value || 'lesson').trim() : 'lesson';
  var tutor = tutorEl ? String(tutorEl.value || '').trim() : '';
  var duration = durationEl ? String(durationEl.value || '').trim() : '';
  var file = fileEl && fileEl.files ? fileEl.files[0] : null;
  var link = linkEl ? String(linkEl.value || '').trim() : '';

  if(!title){
    toast('Enter a video title first.');
    return;
  }

  if(!admSubj){
    toast('Select a subject first.');
    return;
  }

  if(!tutor){
    toast('Enter the tutor / instructor name.');
    return;
  }

  if(!duration){
    toast('Enter the video duration.');
    return;
  }

  if(!file && !link){
    toast('Choose an MP4 file or paste a link.');
    return;
  }

  if(file && file.size > 50 * 1024 * 1024){
    toast('The video file must not exceed 50 MB.');
    return;
  }

  if(link && !/^https?:\/\//i.test(link)){
    toast('The link must start with http:// or https://');
    return;
  }

  var form = new FormData();
  form.append('title', title);
  form.append('subject', admSubj);
  form.append('type', type);
  form.append('tutor', tutor);
  form.append('duration', duration);
  form.append('externalUrl', link);
  if(file) form.append('file', file);

  if(btn){
    btn.disabled = true;
    btn.textContent = 'Uploading…';
  }

  if(status){
    status.textContent = file ? ('Uploading ' + file.name + '…') : 'Saving link…';
  }

  GOC.api.uploadVideo(form).then(function(result){
    if(status){
      status.textContent = 'Added successfully. The video is saved as a draft — publish it below to make it visible to students.';
    }

    toast('Video added successfully.');

    if(titleEl) titleEl.value = '';
    if(tutorEl) tutorEl.value = '';
    if(durationEl) durationEl.value = '';
    if(linkEl) linkEl.value = '';
    if(fileEl) fileEl.value = '';

    var label = document.getElementById('admVidFileLabel');
    if(label) label.textContent = 'Choose an MP4 file (optional)';

    admLoadVideos();
  }, function(err){
    if(status){
      status.textContent = err.message || 'The video could not be added.';
    }

    toast(err.message || 'Video upload failed.');
  }).then(function(){
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Add video';
    }
  });
}

function admNEdit(id){
  var n = null;
  admNCache.forEach(function(r){ if(String(r.id) === String(id)) n = r; });
  if(!n){ toast('That note is no longer published'); return; }
  admNDraft = { id: n.id, topic: n.topic || '', title: n.title || '', body: n.body || '',
                minutes: n.minutes || '', active: n.active !== false };
  admNRepaint();
  toast('Editing note #' + n.id + ' — the form above is filled in');
}
function admNToggle(id, on){
  GOC.api.setNoteActive(id, on).then(function(){
    toast(on ? 'Note #' + id + ' is readable again'
             : 'Note #' + id + ' held back — students will not see it');
    admNLoad();
  }, function(err){ toast(err.message || 'Could not change that note'); });
}
function admNSetFilter(f){ admNFilter = f; admNRender(); }
function admNTabsHTML(){
  return [['all','All'],['live','Active'],['held','Held back']].map(function(t){
    return '<button class="'+(admNFilter === t[0] ? 'on' : '')+'" onclick="admNSetFilter(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('');
}
function admNLoad(){
  var host = document.getElementById('admNList');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Loading the notes…</div>';
  GOC.api.listAllNotes({ subject: admSubj }).then(function(r){
    admNCache = (r && r.notes) || [];
    admNRender();
  }, function(err){
    var h = document.getElementById('admNList');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The notes are not available.')+'</div>';
  });
}
function admNRender(){
  var host = document.getElementById('admNList');
  if(!host) return;
  var tabs = document.getElementById('admNTabs');
  if(tabs) tabs.innerHTML = admNTabsHTML();
  var count = document.getElementById('admNCount');
  var live = admNCache.filter(function(n){ return n.active !== false; }).length;
  if(count) count.textContent = admNCache.length + ' in ' + admSubj + ' · ' + live + ' readable';
  var rows = admNCache.filter(function(n){
    if(admNFilter === 'live') return n.active !== false;
    if(admNFilter === 'held') return n.active === false;
    return true;
  });
  if(!rows.length){
    host.innerHTML = '<div class="ad-empty">No note in ' + esc(admSubj)
      + ' for this filter yet. A student who opens Read / Learn is told plainly that nothing has been published, not shown an empty screen.</div>';
    return;
  }
  /* Grouped under the topic, because the topic is what a student picks. */
  var order = [], byTopic = {};
  rows.forEach(function(n){
    var tp = n.topic || 'General';
    if(!byTopic[tp]){ byTopic[tp] = []; order.push(tp); }
    byTopic[tp].push(n);
  });
  host.innerHTML = order.map(function(tp){
    return '<div class="ad-sub">' + esc(tp) + ' · ' + byTopic[tp].length
      + ' note' + (byTopic[tp].length !== 1 ? 's' : '') + '</div>'
      + byTopic[tp].map(admNCardHTML).join('');
  }).join('');
}
/* A preview is a slice of the note, and a slice can land in the middle of a
   formula. An unclosed formula reads as a plain dollar sign rather than breaking
   anything, but it still looks wrong on the card, so the cut is pulled back to
   before the formula it would have split. */
function admPeek(body, max){
  var t = String(body == null ? '' : body);
  if(t.length <= max) return t;
  var cut = t.slice(0, max);
  if((cut.match(/\$/g) || []).length % 2){ cut = cut.slice(0, cut.lastIndexOf('$')); }
  return cut.replace(/\s+$/, '') + '…';
}
function admNCardHTML(n){
  var live = n.active !== false;
  var body = String(n.body || '');
  var peek = admPeek(body, 220);
  return '<div class="ad-q' + (live ? '' : ' off') + '">'
    + '<div class="qh"><code>#' + esc(n.id) + '</code>'
    + '<span class="ad-tag ' + (live ? 'g' : 'r') + '">' + (live ? 'Readable' : 'Held back') + '</span>'
    + '<code>' + esc(n.minutes) + ' min read</code>'
    + '<code>' + esc(n.topic) + '</code></div>'
    + '<div class="qt">' + mth(n.title) + '</div>'
    + '<div class="qm">' + mth(peek, {breaks:true}) + '</div>'
    + '<div class="ad-actions"><button class="ad-btn" onclick="admNEdit(' + esc(n.id) + ')">Edit note</button>'
    + '<button class="ad-btn" onclick="admNToggle(' + esc(n.id) + ',' + (live ? 'false' : 'true') + ')">'
    + (live ? 'Hold back' : 'Publish') + '</button></div></div>';
}

/* ================= CONSOLE: IMPORT FROM A SPREADSHEET =================
   Typing a bank one question at a time is the slowest part of running the
   academy, so a CSV may be pasted or opened instead. The file is parsed by the
   shared core helper and every row passes the very same validator the form
   passes, so an import can never publish a record the form would have refused.
   Good rows are published, bad rows come back by line number, and nothing that
   was already published is touched. */
var admImKind = 'questions';
var admImLast = null;
var admImFileName = null;   /* the name of the last file opened via admImPick, if any */

/* subject + section the file is being imported into — the target the row-level
   check in core.importCSV rejects mismatches against (or, with admImStamp,
   overwrites). Both default to "" (no restriction, the Session filter at
   admRSection just above uses the same "All ..." first option for the same
   reason): a blank subject/section keeps importing exactly as it always did,
   one file free to carry several subjects/sections, which is what the
   existing single-file, mixed-section imports below rely on. Choosing a
   specific subject and section is how an admin answers "I want to import a
   CSV file for [this subject] [this section]" — every row that doesn't match
   what was chosen is then skipped and reported, rather than trusted. Notes
   have no such target — notes import has no section at all — so this only
   shows for kind 'questions'; see admImTargetHTML/admImKindSet.

   admImStamp (questions + a section chosen, only): flips the section check
   from "reject rows that don't already say this section" to "file every kept
   row under this section, whatever it said" — how the very same bank of
   questions gets imported once for the Web Test and again for Practice,
   without hand-editing the section column of the CSV in between. */
var admImSubject = '';
var admImSection = '';
var admImStamp = false;

function admImCols(){
  return admImKind === 'notes' ? GOC.api.rules.CSV_NOTE_HEADER : GOC.api.rules.CSV_QUESTION_HEADER;
}
/* The subject/section pickers, questions-only. Built with admQOpts, the same
   helper the question form's own subject/section selects use, so the labels
   ("JAMB-oriented session" etc.) never drift apart from the rest of the
   console. Re-rendered (not just toggled) on every kind switch so the
   selected value in the DOM always matches admImSubject/admImSection, the
   same "state repaints its own markup" pattern admImPaintCols already uses
   for the columns line just below it. */
function admImTargetHTML(){
  if(admImKind === 'notes') return '';
  var h = '<div class="ad-field"><label>Subject to import into</label><select id="admImSubjSel" onchange="admImSetSubject(this.value)">'
    + admQOpts([['', 'Any subject — take it from the file']].concat(
        ['Use of English','Physics','Chemistry','Biology','Mathematics'].map(function(s){ return [s, s]; })), admImSubject)
    + '</select></div>'
    + '<div class="ad-field"><label>Section to import into</label><select id="admImSecSel" onchange="admImSetSection(this.value)">'
    + admQOpts([['', 'Any section — take it from the file'],
                ['objective','Objective session'],['theory','Theory session'],
                ['jamb','JAMB-oriented session'],['practice','Practice only']], admImSection)
    + '</select></div>';
  if(admImSection){
    h += '<div class="ad-field"><label>How the section applies</label><select id="admImStampSel" onchange="admImSetStamp(this.value)">'
      + admQOpts([['no', 'Only import rows already filed under this section'],
                  ['yes', 'Import every matching row AS this section, whatever the file says']], admImStamp ? 'yes' : 'no')
      + '</select></div>'
      + (admImStamp
          ? '<p class="ad-note">Every row that passes the subject check (if any) is filed under <b>' + esc(wtSectionLabel(admImSection)) +
            '</b> regardless of what its own section column says — this is how to reuse the same file for the Web Test and, separately, for Practice.</p>'
          : '<p class="ad-note">Only rows in the file filed under this exact subject and section are imported — a row filed under anything else is skipped and reported below, the same as a row that fails any other check.</p>');
  } else if(admImSubject){
    h += '<p class="ad-note">Only rows in the file filed under this exact subject are imported — a row filed under a different subject is skipped and reported below.</p>';
  } else {
    h += '<p class="ad-note">Left on "Any", each row is imported under whatever subject and section that row itself names — pick a specific subject and/or section here to restrict the whole file, or pick a section and choose to import every row as that section (useful for reusing a Web Test file for Practice).</p>';
  }
  return h;
}
function admImSetSubject(s){ admImSubject = s; admImPaintTarget(); }
function admImSetSection(s){ admImSection = s; if(!s) admImStamp = false; admImPaintTarget(); }
function admImSetStamp(v){ admImStamp = v === 'yes'; admImPaintTarget(); }
function admImPaintTarget(){
  var host = document.getElementById('admImTarget');
  if(host) host.innerHTML = admImTargetHTML();
}
function admImPaintCols(){
  var c = document.getElementById('admImCols');
  if(c) c.textContent = admImCols();
  var n = document.getElementById('admImNote');
  if(n) n.textContent = admImKind === 'notes'
    ? 'subject, topic, title and body are required. A blank line inside the body starts a new paragraph; the two characters \\n do the same, which is how a spreadsheet usually carries one.'
    : 'subject and text are required. For an objective question fill optionA onwards and give the answer as a letter, as a position from 1, or as the text of the correct option. For a theory question give expected and maxMark instead.';
}
function admImKindSet(){
  var s = document.getElementById('admImKind');
  admImKind = s && s.value === 'notes' ? 'notes' : 'questions';
  admImPaintCols();
  admImPaintTarget();
}
function admImTemplate(){
  var box = document.getElementById('admImCsv');
  if(!box) return;
  box.value = GOC.api.rules.csvTemplate(admImKind);
  toast('A template for ' + (admImKind === 'notes' ? 'notes' : 'questions') + ' — edit it, or replace it with your own file');
}
function admImClear(){
  var box = document.getElementById('admImCsv');
  if(box) box.value = '';
  var out = document.getElementById('admImOut');
  if(out) out.innerHTML = '';
  admImLast = null;
  admImFileName = null;
}
/* Opening a file is a convenience on top of the same textarea: whatever is read
   lands there, so management always sees exactly what is about to be imported
   and can correct it before pressing Import. The file's name travels with the
   import call too, purely so the history list below can name it later — it is
   never re-read from disk. */
function admImPick(input){
  var f = input && input.files && input.files[0];
  if(!f) return;
  if(typeof FileReader === 'undefined'){ toast('This browser cannot open files — paste the CSV instead'); return; }
  admImFileName = f.name;
  var fr = new FileReader();
  fr.onload = function(){
    var box = document.getElementById('admImCsv');
    if(box) box.value = String(fr.result == null ? '' : fr.result);
    toast(f.name + ' loaded — check it, then press Import');
  };
  fr.onerror = function(){ toast('Could not read that file'); };
  fr.readAsText(f);
}
function admImRun(confirmDuplicate){
  var box = document.getElementById('admImCsv');
  var csv = box ? String(box.value || '') : '';
  if(!csv.trim()){ toast('Paste a CSV or open one first'); return; }
  var btn = document.getElementById('admImBtn');
  busy(btn, true);
  var done = function(r){
    busy(btn, false);
    /* A duplicate is reported, not imported — nothing has been published
       yet. Show what matched and let management choose to run it anyway. */
    if(r && r.duplicate){
      admImLast = null;
      admImPaintDuplicate(r.duplicate);
      return;
    }
    admImLast = r;
    admImPaintResult(r);
    toast(r.added + ' of ' + r.read + ' row' + (r.read !== 1 ? 's' : '') + ' imported');
    /* Whatever was just published should be visible where it lives. */
    if(admImKind === 'notes'){ if(document.getElementById('admNList')) admNLoad(); }
    else if(document.getElementById('admQList')) admQLoad();
    admImLoadHistory();
  };
  var failed = function(err){
    busy(btn, false);
    admImLast = null;
    var out = document.getElementById('admImOut');
    if(out) out.innerHTML = '<p class="ad-warn">' + esc(err.message || 'That file was not accepted.') + '</p>';
  };
  if(admImKind === 'notes') GOC.api.importNotes(csv, admImFileName, !!confirmDuplicate).then(done, failed);
  else GOC.api.importQuestions(csv, admImFileName, !!confirmDuplicate, admImSubject, admImSection, admImStamp).then(done, failed);
}
/* Shown instead of a result when the file (same name, same content) already
   appears in the import history — nothing was published on this call.
   Management can press "Import anyway" to re-run it with confirmDuplicate
   set, which imports unconditionally. */
function admImPaintDuplicate(prior){
  var out = document.getElementById('admImOut');
  if(!out) return;
  var when = wtWhen ? wtWhen(prior.at) : new Date(prior.at).toLocaleString();
  out.innerHTML = '<p class="ad-warn">This looks like the same file already imported '
    + esc(when) + ' (' + esc(prior.added) + ' of ' + esc(prior.read) + ' rows published'
    + (prior.skipped ? ', ' + esc(prior.skipped) + ' skipped' : '') + '). Nothing was imported this time.</p>'
    + '<div class="ad-actions"><button class="ad-btn" onclick="admImRun(true)">Import anyway</button></div>';
}
function admImPaintResult(r){
  var out = document.getElementById('admImOut');
  if(!out) return;
  var what = admImKind === 'notes' ? 'note' : 'question';
  var h = '<div class="ad-metric"><span>Rows read</span><b>' + esc(r.read) + '</b></div>'
    + '<div class="ad-metric"><span>Published</span><b>' + esc(r.added) + ' ' + what
    + (r.added !== 1 ? 's' : '') + '</b></div>'
    + '<div class="ad-metric"><span>Skipped</span><b>' + esc(r.skipped) + '</b></div>';
  if(r.errors && r.errors.length){
    h += '<div class="ad-sub">Rows that were not accepted</div>'
      + r.errors.map(function(e){
          return '<div class="ad-metric"><span>Line ' + esc(e.line) + '</span><b>' + esc(e.error) + '</b></div>';
        }).join('')
      + '<p class="ad-note">Nothing else was affected. Correct those lines and import them on their own — the rows that passed are already published.</p>';
  } else {
    h += '<p class="ad-note">Every row was accepted and is published.</p>';
  }
  out.innerHTML = h;
}
/* What the console asked for: a memory of CSV files imported earlier, not
   just the run that just finished in this browser tab. Read fresh every
   time the Import screen opens, and again right after a new import, so an
   admin about to run a file can check first whether it (or one very like
   it) already went in — the running-the-same-file-twice warning above this
   list is no longer the only defence against that. */
function admImLoadHistory(){
  var host = document.getElementById('admImHistory');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Checking earlier imports…</div>';
  GOC.api.importHistory().then(function(r){
    var rows = (r && r.imports) || [];
    if(!rows.length){
      host.innerHTML = '<div class="ad-empty">Nothing has been imported yet.</div>';
      return;
    }
    host.innerHTML = rows.map(function(e){
      var when = wtWhen ? wtWhen(e.at) : new Date(e.at).toLocaleString();
      var name = e.filename ? esc(e.filename) : '<i>pasted, no file name</i>';
      return '<div class="ad-metric"><span>' + name + ' &middot; ' + esc(when) + '</span>'
        + '<b>' + esc(e.kind === 'notes' ? 'Notes' : 'Questions') + ' &middot; '
        + esc(e.added) + ' of ' + esc(e.read) + ' published'
        + (e.skipped ? ', ' + esc(e.skipped) + ' skipped' : '') + '</b></div>';
    }).join('');
  }, function(err){
    host.innerHTML = '<div class="ad-empty">' + esc(err.message || 'Earlier imports are not available right now.') + '</div>';
  });
}

/* ---- the management view of the league ----
   Deliberately its own loader and its own container ids. renderLeague() stays
   the student\'s screen, guard and all; this reads the same GOC.api.league(),
   which the server already allows staff, and paints it into the console. */
var admLgData = null;
var admLgFilter = { cohort: '' };
/* Built from the league's own rows, not admCohortsCache — the league already
   labels every row with its cohort, so the filter never depends on the
   Students/Cohorts panels having been opened first in this session. */
function admLgCohortOptions(){
  var rows = (admLgData && admLgData.rows) || [];
  var seen = {}, opts = [];
  /* Listed in the order the league itself ranks them, not alphabetised —
     the league screen is never allowed to re-sort what the server sent,
     and that rule holds for anything built from its rows in this file too. */
  rows.forEach(function(r){
    if(!r.cohortId || seen[r.cohortId]) return;
    seen[r.cohortId] = true;
    opts.push({ id: r.cohortId, name: r.cohortName || r.cohortId });
  });
  return '<option value=""'+(!admLgFilter.cohort ? ' selected' : '')+'>All cohorts</option>' +
    opts.map(function(c){
      return '<option value="'+esc(c.id)+'"'+(admLgFilter.cohort === c.id ? ' selected' : '')+'>'+esc(c.name)+'</option>';
    }).join('');
}
function admLgSetFilter(){
  var e = document.getElementById('admLgCohort');
  admLgFilter.cohort = e ? String(e.value || '') : '';
  admLgRender();
}
function admLgLoad(){
  var host = document.getElementById('admLgList');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Loading the standings…</div>';
  GOC.api.league().then(function(r){
    admLgData = r;
    admLgRender();
  }, function(err){
    var h = document.getElementById('admLgList');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'The standings are not available.')+'</div>';
  });
}
/* The cohort filter narrows what is shown, not what was fetched — the
   whole-academy table is asked for once and kept in admLgData, the same way
   Results narrows its own already-fetched page. Ranks are the ones the
   server gave the row academy-wide; this view does not renumber a cohort
   from 1, since a scholar's rank here should read the same as everywhere
   else it is shown. */
function admLgRender(){
  var h = document.getElementById('admLgList');
  if(!h) return;
  var r = admLgData;
  var rows = ((r && r.rows) || []).filter(function(s){
    return !admLgFilter.cohort || s.cohortId === admLgFilter.cohort;
  });
  var sel = document.getElementById('admLgCohort');
  if(sel) sel.innerHTML = admLgCohortOptions();
  var nm = document.getElementById('admLgName');
  if(nm) nm.textContent = (r && (r.leagueName || r.league)) || 'Current league';
  var ct = document.getElementById('admLgCount');
  if(ct) ct.textContent = rows.length + ' of ' + ((r && r.size) || rows.length);
  /* The basis is read from the same place the students read it, never retyped
     here: if the ranking rule ever changes, the console cannot describe the
     old one by accident. */
  var bs = document.getElementById('admLgBasis');
  if(bs) bs.textContent = (r && r.basis) || 'The ranking basis is not stated.';
  if(!rows.length){
    h.innerHTML = '<div class="ad-empty">'+
      (admLgFilter.cohort ? 'No scholar in this cohort has earned XP yet, so there is nothing to rank.'
                           : 'No scholar has earned XP yet, so there is nothing to rank.')+'</div>';
    return;
  }
  h.innerHTML = rows.map(function(s){
    return '<div class="ad-cred"><div class="ac-top"><div class="ad-av">' + esc(String(s.rank)) + '</div>'+
      '<div class="ac-who"><b>' + esc(s.name || s.scholarId) + '</b><span>' + esc(s.scholarId) + '</span></div>'+
      '<span class="ad-tag g">' + esc(String(s.xp)) + ' XP</span></div>'+
      '<div class="ac-grid"><div class="ac-cell"><label>Streak</label><code>' + esc(String(s.streak || 0)) + ' day</code></div>'+
      '<div class="ac-cell"><label>Level</label><code>' + esc(String(s.level || 1)) + '</code></div>'+
      '<div class="ac-cell"><label>Performance</label><code>' +
        (s.assessed ? esc(String(s.performance)) + '%' : 'not assessed') + '</code></div></div></div>';
  }).join('');
}
function admQRender(){
  var host = document.getElementById('admQList');
  if(!host) return;
  var tabs = document.getElementById('admQTabs');
  if(tabs) tabs.innerHTML = admQTabsHTML();
  /* Web Test and Practice are kept apart here too — a practice question is
     never listed, edited or bulk-deleted from the Web Test panel and vice
     versa (item 3: web test only, excluding practice). */
  var bankRows = admQCache.filter(function(q){
    return admQBank === 'practice' ? q.section === 'practice' : q.section !== 'practice';
  });
  var count = document.getElementById('admQCount');
  if(count) count.textContent = bankRows.length + ' in ' + admSubj;
  /* Drop any selected id that is no longer in the bank (deleted elsewhere, or
     the subject/bank was switched) so the bulk bar's count never lies. */
  var stillHere = {};
  bankRows.forEach(function(q){ stillHere[q.id] = true; });
  Object.keys(admQSelected).forEach(function(id){ if(!stillHere[id]) delete admQSelected[id]; });
  var bar = document.getElementById('admQBulkBar');
  if(bar) bar.innerHTML = admQBulkBarHTML();
  var rows = admQBank === 'practice' ? bankRows
    : bankRows.filter(function(q){ return admQFilter === 'all' || q.section === admQFilter; });
  if(!rows.length){
    host.innerHTML = '<div class="ad-empty">Nothing in ' + esc(admSubj) +
      (admQBank === 'practice' ? ' practice bank yet' : ' for this session yet') +
      ' — add the first question above.</div>';
    return;
  }
  var out = '';
  (admQBank === 'practice' ? ['practice'] : ['theory','objective','jamb']).forEach(function(sec){
    var group = rows.filter(function(q){ return q.section === sec; });
    if(!group.length) return;
    out += '<div class="ad-sub">' + wtSectionLabel(sec) + ' · ' + group.length
        +  ' question' + (group.length !== 1 ? 's' : '') + '</div>'
        +  group.map(admQCardHTML).join('');
  });
  host.innerHTML = out;
}
function admQCardHTML(q){
  var live = q.active !== false;
  var body;
  if(q.kind === 'theory'){
    body = '<div class="qm">Reference answer: ' + mth(q.expected, {breaks:true})
         + '<br>Maximum mark <b>' + esc(q.maxMark) + '</b></div>';
  } else {
    body = '<div class="qm">' + (q.options || []).map(function(o, i){
      return admLetter(i) + '. ' + mth(o) + (i === q.answer ? ' <b>✓ correct</b>' : '');
    }).join('<br>') + '</div>';
  }
  return '<div class="ad-q' + (live ? '' : ' off') + '">'
    + '<div class="qh"><input type="checkbox" class="ad-chk" title="Select for bulk delete"'
    + ' onchange="admQToggleSelect(' + esc(q.id) + ', this.checked)"' + (admQSelected[q.id] ? ' checked' : '') + '>'
    + '<code>#' + esc(q.id) + '</code>'
    + '<span class="ad-tag ' + (live ? 'g' : 'r') + '">' + (live ? 'Active' : 'Inactive') + '</span>'
    + '<code>' + esc(q.difficulty || 'medium') + '</code>'
    + (q.topic ? '<code>' + esc(q.topic) + '</code>' : '')
    + '</div><div class="qt">' + mth(q.text, {breaks:true}) + '</div>' + body
    + (q.explanation ? '<div class="qm">Explanation: ' + mth(q.explanation, {breaks:true}) + '</div>' : '')
    + '<div class="ad-actions"><button class="ad-btn" onclick="admQEditQ(' + esc(q.id) + ')">Edit '
    + (q.kind === 'theory' ? '' : '/ answer') + '</button>'
    + '<button class="ad-btn" onclick="admQToggle(' + esc(q.id) + ',' + (live ? 'false' : 'true') + ')">'
    + (live ? 'Deactivate' : 'Activate') + '</button>'
    + '<button class="ad-btn danger" onclick="admQDelete(' + esc(q.id) + ')">Delete</button>'
    + '</div></div>';
}
/* 4.3 — the record. Every row names the student by Scholar ID first, because the
   Scholar ID is what a result is filed against; the name is only there to help a
   human read the list. */
function admRSubjectOptions(){
  return '<option value="">All subjects</option>' + ['Use of English','Physics','Chemistry','Biology','Mathematics']
    .map(function(s){
      return '<option value="'+esc(s)+'"'+(admRFilter.subject === s ? ' selected' : '')+'>'+esc(s)+'</option>';
    }).join('');
}
/* Cohort filtering happens client-side: /api/results has no cohort concept
   of its own, so this narrows the already-fetched page by cross-referencing
   each result's scholarId against studentsData's cohort field, the same
   roster the Students panel's cohort picker reads and writes. */
function admRCohortOptions(){
  return '<option value="">All cohorts</option>' + admCohortsCache.map(function(c){
    return '<option value="'+esc(c.cohortId)+'"'+(admRFilter.cohort === c.cohortId ? ' selected' : '')+'>'+esc(c.name)+'</option>';
  }).join('');
}
function admRSetFilter(){
  function v(id){ var e = document.getElementById(id); return e ? String(e.value == null ? '' : e.value).trim() : ''; }
  admRFilter = { section:v('admRSection'), subject:v('admRSubject'),
                 status:v('admRStatus'), scholarId:v('admRScholar'), cohort:v('admRCohort') };
  admRLoad();
}
function admRLoad(){
  var host = document.getElementById('admRList');
  if(!host) return;
  host.innerHTML = '<div class="ad-loading">Loading results…</div>';
  admRClose();
  var f = {};
  ['section','subject','status','scholarId'].forEach(function(k){
    if(admRFilter[k]) f[k] = admRFilter[k];
  });
  GOC.api.listResults(f).then(function(r){
    admRCache = (r && r.results) || [];
    var sum = document.getElementById('admRSummary');
    if(sum) sum.innerHTML =
        '<div class="ad-metric"><span>Sittings shown</span><b>' + admRCache.length + ' of ' + ((r && r.total) || 0) + '</b></div>'
      + '<div class="ad-metric"><span>Theory awaiting marking</span><b>' + ((r && r.awaitingMarking) || 0) + '</b></div>';
    admRRender();
  }, function(err){
    admRCache = [];
    var h = document.getElementById('admRList');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'Results are not available right now.')+'</div>';
  });
}
function admRRender(){
  var host = document.getElementById('admRList');
  if(!host) return;
  var rows = admRFilter.cohort
    ? admRCache.filter(function(a){
        var s = studentsData.find(function(x){ return x.id === a.scholarId; });
        return s && s.cohort === admRFilter.cohort;
      })
    : admRCache;
  if(!rows.length){ host.innerHTML = '<div class="ad-empty">No sittings match that filter yet.</div>'; return; }
  host.innerHTML = rows.map(admRRowHTML).join('');
}
function admRRowHTML(a){
  var meta = SUBJECT_META[a.subject] || { ab:String(a.subject || '?').substr(0, 2), color:'#334155' };
  var marked = a.status === 'marked';
  var score = marked ? (a.score + '/' + a.maxScore + ' · ' + a.percent + '%') : 'awaiting marking';
  return '<button class="ad-res" onclick="admROpen(\'' + esc(a.id) + '\')">'
    + '<span class="pc" style="background:' + meta.color + '">' + esc(meta.ab) + '</span>'
    + '<span class="nm"><b>' + esc(a.scholarId) + ' · ' + esc(a.studentName) + '</b>'
    + '<span>' + esc(admPeriodLabel()) + ' · ' + esc(wtSectionLabel(a.section)) + ' · ' + esc(a.subject) + '</span>'
    + '<span>' + esc(wtWhen(a.submittedAt)) + ' · ' + score + ' · ' + mmss(a.timeUsedSec) + ' used · '
    + esc(admCompletion(a)) + '</span></span>'
    + '<span class="ad-tag ' + (marked ? 'g' : 'a') + '">' + (marked ? 'Marked' : 'Pending') + '</span></button>';
}
function admROpen(id){
  var card = document.getElementById('admRDetailCard');
  var host = document.getElementById('admRDetail');
  if(!card || !host) return;
  card.hidden = false;
  host.innerHTML = '<div class="ad-loading">Opening the paper…</div>';
  GOC.api.getAttempt(id).then(function(a){
    admRAttempt = a;
    admRPaint();
  }, function(err){
    admRAttempt = null;
    var h = document.getElementById('admRDetail');
    if(h) h.innerHTML = '<div class="ad-empty">'+esc(err.message || 'That paper could not be opened.')+'</div>';
  });
}
function admRClose(){
  admRAttempt = null;
  var card = document.getElementById('admRDetailCard');
  if(card) card.hidden = true;
  var host = document.getElementById('admRDetail');
  if(host) host.innerHTML = '';
  var t = document.getElementById('admRDetailTitle');
  if(t) t.textContent = 'Result detail';
}
function admRPaint(){
  var a = admRAttempt;
  var host = document.getElementById('admRDetail');
  if(!a || !host) return;
  var title = document.getElementById('admRDetailTitle');
  if(title) title.textContent = a.scholarId + ' · ' + a.subject + ' · ' + wtSectionLabel(a.section);
  var marked = a.status === 'marked';
  var theory = a.section === 'theory';
  var h = '<div class="ad-metric"><span>Scholar ID</span><b>' + esc(a.scholarId) + '</b></div>'
    + '<div class="ad-metric"><span>Student</span><b>' + esc(a.studentName) + '</b></div>'
    + '<div class="ad-metric"><span>Paper</span><b>' + esc(admPeriodLabel()) + ' · ' + esc(wtSectionLabel(a.section)) + '</b></div>'
    + '<div class="ad-metric"><span>Subject</span><b>' + esc(a.subject) + '</b></div>'
    + '<div class="ad-metric"><span>Date &amp; submission time</span><b>' + esc(wtWhen(a.submittedAt)) + '</b></div>'
    + '<div class="ad-metric"><span>Questions</span><b>' + esc(a.total) + ' · ' + esc(a.answered) + ' answered</b></div>'
    + (theory ? '' : '<div class="ad-metric"><span>Correct / incorrect</span><b>' + esc(a.correct) + ' / ' + esc(a.wrong) + '</b></div>')
    + '<div class="ad-metric"><span>Score</span><b>' + (marked ? esc(a.score) + ' / ' + esc(a.maxScore) : 'Awaiting marking') + '</b></div>'
    + '<div class="ad-metric"><span>Percentage</span><b>' + (marked ? esc(a.percent) + '%' : '—') + '</b></div>'
    + '<div class="ad-metric"><span>Time used</span><b>' + mmss(a.timeUsedSec)
    + (Number(a.durationSec) > 0 ? ' of ' + wtMinutes(a.durationSec) : ' · no limit set') + '</b></div>'
    + '<div class="ad-metric"><span>Completion status</span><b>' + esc(admCompletion(a)) + '</b></div>'
    + '<div class="ad-metric"><span>Marking status</span><b>'
    + (marked ? 'Marked' + (a.markedBy ? ' by ' + esc(a.markedBy) : ' automatically') : 'Awaiting marking by hand') + '</b></div>'
    + '<div class="ad-metric"><span>XP credited</span><b>' + esc(a.xpAwarded || 0) + ' XP</b></div>';
  if(theory){
    h += '<p class="ad-p" style="margin-top:12px">Award every mark yourself. Nothing on a theory paper is scored automatically — '
      +  'the total is added up only when you save, and it is saved against ' + esc(a.scholarId) + '.</p>'
      +  a.answers.map(admMarkCardHTML).join('')
      +  '<div class="ad-actions"><button class="ad-btn pri" id="admMarkBtn" onclick="admMarkSave()">Save marks</button>'
      +  '<button class="ad-btn" onclick="admRClose()">Close</button></div>';
  } else {
    h += a.answers.map(admReviewCardHTML).join('')
      +  '<div class="ad-actions"><button class="ad-btn" onclick="admRClose()">Close</button></div>';
  }
  host.innerHTML = h;
}
/* 4.4 — hand marking: the question, what the student wrote, the reference answer,
   the maximum mark and one box for the mark awarded. */
function admMarkCardHTML(r, i){
  var given = String(r.given == null ? '' : r.given);
  return '<div class="ad-mk">'
    + '<div class="mq">Question ' + (i + 1) + (r.topic ? ' · ' + esc(r.topic) : '') + '</div>'
    + '<div class="mt">' + mth(r.text, {breaks:true}) + '</div>'
    + '<div class="mb"><em>Student answer</em>' + (given ? mth(given, {breaks:true}) : 'Left blank') + '</div>'
    + '<div class="mb"><em>Expected / reference answer</em>' + mth(r.expected, {breaks:true}) + '</div>'
    + '<div class="mm"><label for="admMk' + esc(r.questionId) + '">Mark awarded</label>'
    + '<input id="admMk' + esc(r.questionId) + '" type="number" min="0" max="' + esc(r.maxMark) + '" value="'
    + (r.markAwarded == null ? '' : esc(r.markAwarded)) + '" placeholder="0">'
    + '<s>of ' + esc(r.maxMark) + ' maximum</s></div></div>';
}
/* An objective paper is read-only here: it was marked by the server the moment it
   was submitted, and nothing in this console rewrites a machine mark. */
function admReviewCardHTML(r, i){
  var opts = (r.options || []).map(function(o, j){
    var tag = j === r.answer ? ' <b>✓ correct answer</b>'
            : (String(j) === String(r.given) ? ' <b style="color:#B91C1C">← chosen</b>' : '');
    return admLetter(j) + '. ' + mth(o) + tag;
  }).join('<br>');
  var verdict = (r.given == null || r.given === '') ? 'Not answered'
              : (r.isCorrect ? 'Answered correctly' : 'Answered incorrectly');
  return '<div class="ad-mk">'
    + '<div class="mq">Question ' + (i + 1) + (r.topic ? ' · ' + esc(r.topic) : '') + '</div>'
    + '<div class="mt">' + mth(r.text, {breaks:true}) + '</div>'
    + '<div class="mb">' + (opts || 'No options recorded') + '</div>'
    + '<div class="mm"><s>' + verdict + ' · marked automatically · '
    + esc(r.markAwarded == null ? 0 : r.markAwarded) + ' of ' + esc(r.maxMark) + '</s></div></div>';
}
function admMarkSave(){
  var a = admRAttempt;
  if(!a){ toast('Open a theory paper first'); return; }
  if(a.section !== 'theory'){ toast('Only theory papers are marked by hand'); return; }
  var marks = {}, bad = null, given = 0;
  a.answers.forEach(function(r){
    var el = document.getElementById('admMk' + r.questionId);
    var raw = el ? String(el.value == null ? '' : el.value).trim() : '';
    if(raw === '') return;                        // left for a later sitting at the desk
    var n = Number(raw);
    if(isNaN(n) || n < 0 || n > r.maxMark) bad = r.maxMark;
    else { marks[r.questionId] = n; given++; }
  });
  if(bad !== null){ toast('Each mark must be between 0 and the maximum (' + bad + ')'); return; }
  if(!given){ toast('Award at least one mark before saving'); return; }
  var btn = document.getElementById('admMarkBtn');
  busy(btn, true);
  GOC.api.markTheory(a.id, marks).then(function(res){
    busy(btn, false);
    toast(res.status === 'marked'
      ? 'Marked — ' + res.score + '/' + res.maxScore + ' (' + res.percent + '%) saved against ' + res.scholarId
      : 'Marks saved — this paper still has answers waiting');
    var reopen = a.id;
    var sel = document.getElementById('admSelect');
    if(sel && sel.value === 'theorymark') admTMLoad(); else admRLoad();
    admROpen(reopen);
  }, function(err){ busy(btn, false); toast(err.message || 'Those marks were not saved'); });
}
/* ---------- Dedicated theory-marking panel ---------- */
function admTMSubjectOptions(){
  return '<option value="">All subjects</option>' + ['Use of English','Physics','Chemistry','Biology','Mathematics']
    .map(function(s){
      return '<option value="'+esc(s)+'"'+(admTMSubject === s ? ' selected' : '')+'>'+esc(s)+'</option>';
    }).join('');
}
function admTMSetSubject(){
  var e = document.getElementById('admTMSubjectSel');
  admTMSubject = e ? String(e.value || '') : '';
  admTMRender();
}
/* One fetch — every theory sitting, whatever its subject or marking status —
   then admTMRender() slices it two ways: a per-subject attempt-count strip
   (always every subject, so the counts stay a fixed reference point) and the
   Scholar ID list underneath (narrowed to whichever subject is picked). */
function admTMLoad(){
  var sum = document.getElementById('admTMSummary');
  var host = document.getElementById('admTMList');
  if(!sum && !host) return;
  if(sum) sum.innerHTML = '<div class="ad-loading">Loading…</div>';
  if(host) host.innerHTML = '';
  admRClose();   // a detail card left open from a previous visit shouldn't linger
  GOC.api.listResults({ section: 'theory' }).then(function(r){
    admTMCache = (r && r.results) || [];
    admTMRender();
  }, function(err){
    admTMCache = [];
    if(sum) sum.innerHTML = '';
    if(host) host.innerHTML = '<div class="ad-empty">'+esc(err.message || 'Theory papers are not available right now.')+'</div>';
  });
}
function admTMRender(){
  var sum = document.getElementById('admTMSummary');
  var host = document.getElementById('admTMList');
  if(!host) return;

  var bySubj = {};
  admTMCache.forEach(function(a){
    var k = a.subject || 'Unknown';
    if(!bySubj[k]) bySubj[k] = { attempted: 0, pending: 0 };
    bySubj[k].attempted++;
    if(a.status !== 'marked') bySubj[k].pending++;
  });
  // Fixed subject order (same list every other subject picker in the console
  // uses), not an alphabetical .sort() — js/app.js never reorders data itself,
  // it only ever presents an order the data layer already gives it.
  var subjectOrder = ['Use of English','Physics','Chemistry','Biology','Mathematics'];
  var subjects = subjectOrder.filter(function(s){ return bySubj[s]; })
    .concat(Object.keys(bySubj).filter(function(s){ return subjectOrder.indexOf(s) < 0; }));
  if(sum){
    sum.innerHTML = subjects.length
      ? subjects.map(function(s){
          return '<div class="ad-metric"><span>'+esc(s)+'</span><b>'
            + bySubj[s].attempted + ' attempted · ' + bySubj[s].pending + ' awaiting marking</b></div>';
        }).join('')
      : '<div class="ad-empty">No student has attempted a theory paper yet.</div>';
  }

  var rows = admTMSubject ? admTMCache.filter(function(a){ return a.subject === admTMSubject; }) : admTMCache;
  if(!rows.length){
    host.innerHTML = '<div class="ad-empty">'
      + (admTMSubject ? 'No student has attempted the ' + esc(admTMSubject) + ' theory paper yet.' : 'No student has attempted a theory paper yet.')
      + '</div>';
    return;
  }
  // Newest-submitted-first, same order the API already returns.
  host.innerHTML = rows.map(admRRowHTML).join('');
}
/* esc(): safe for any value a backend may send (null, numbers, objects) and
   escapes quotes too, so it is also safe inside an HTML attribute. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function row(av,nm,sub,tag,tl){
  return '<div class="ad-row"><div class="ad-av">'+esc(av)+'</div><div class="nm"><b>'+esc(nm)+'</b><span>'+esc(sub)+'</span></div><span class="ad-tag '+esc(tag)+'">'+esc(tl)+'</span></div>';
}
/* mth(): the same as esc() for ordinary text, and sets the mathematics when a
   formula is present. Every place a student reads a question, an option, an
   explanation or a note goes through this rather than esc(), so a formula an
   author typed once is set the same way wherever it appears. The fallback keeps
   the screens working even if the rulebook is an older copy than the app. */
function mth(s, opts){
  var r = rulebook();
  if (r && r.renderMath) return r.renderMath(s, opts);
  var out = esc(s);
  return opts && opts.breaks ? out.replace(/\n/g,'<br>') : out;
}
/* And the one-line reading of it, for a place that can hold no markup at all. */
function mthPlain(s){
  var r = rulebook();
  return r && r.mathPlain ? r.mathPlain(s) : String(s == null ? '' : s);
}
/* mathPrev(): the console's live proof. An author typing a question sees the
   formula set exactly as the student will read it, and any problem with it named
   underneath in words. Neither panel can refuse a save — a lone $ is a dollar
   sign, and a command the Hub has not met is still shown to the student — so the
   author looks at the two panels and decides. The preview appears only once
   there is a formula to show; the short list of forms below it is always there,
   because an author who does not know the Hub sets formulas will never type one.

   Each part is {label, src}. The whole panel is rebuilt on every keystroke,
   which is cheap: it is one node, and nothing here measures text. */
function mathPrev(parts){
  var r = rulebook();
  if(!(r && r.renderMath)) return '';
  var issues = [], seen = {}, any = false, out = '', i, j, got, s;
  for(i = 0; i < parts.length; i++){
    s = String(parts[i].src == null ? '' : parts[i].src);
    if(!s) continue;
    if(r.hasMath && r.hasMath(s)) any = true;
    if(r.mathIssues){
      got = r.mathIssues(s);
      for(j = 0; j < got.length; j++){ if(!seen[got[j]]){ seen[got[j]] = 1; issues.push(got[j]); } }
    }
  }
  if(any || issues.length){
    out += '<p class="mprev-l">How the student will read it</p>';
    for(i = 0; i < parts.length; i++){
      s = String(parts[i].src == null ? '' : parts[i].src);
      if(!s) continue;
      out += '<div class="mprev">'
        + (parts[i].label ? '<b>' + esc(parts[i].label) + '</b>' : '')
        + mth(s, {breaks:true}) + '</div>';
    }
  }
  if(issues.length){
    out += '<div class="mwarn"><b>Worth a second look before you save</b><ul>';
    for(i = 0; i < issues.length; i++){ out += '<li>' + esc(issues[i]) + '</li>'; }
    out += '</ul></div>';
  }
  return out + mathHelp();
}
/* The short list of forms, set by the very renderer it describes, so it can
   never promise something the Hub does not actually do. */
function mathHelp(){
  var r = rulebook();
  if(!(r && r.renderMath && r.MATH_HELP)) return '';
  var list = r.MATH_HELP, out = '', i;
  for(i = 0; i < list.length; i++){
    out += '<span title="' + esc(list[i].note) + '"><code>' + esc(list[i].tex)
      + '</code> ' + mth(list[i].tex) + '</span>';
  }
  if(!out) return '';
  return '<div class="mhelp"><b>Formulas go between dollar signs</b> — '
    + 'type one of these anywhere in the question, the options, the answer or a note: '
    + out + '</div>';
}

/* ================= TIMETABLE ================= */
var week = {
  Mon:{label:'Monday', blocks:[]},
  Tue:{label:'Tuesday', blocks:[]},
  Wed:{label:'Wednesday', blocks:[]},
  Thu:{label:'Thursday', blocks:[]},
  Fri:{label:'Friday', blocks:[]},
  Sat:{label:'Saturday', blocks:[]},
  Sun:{label:'Sunday', blocks:[]}
};
var dayKeys = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
/* The strip always shows the current Mon-Sun week, so the prototype never looks
   stale. BACKEND: the real week should come from the server with the timetable. */
var dayNums = (function(){
  var t = new Date(), dow = t.getDay();            // 0 = Sunday
  var mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (dow === 0 ? 6 : dow - 1));
  var out = [];
  for(var i = 0; i < 7; i++){
    var d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    out.push(String(d.getDate()));
  }
  return out;
})();
var curDay = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];

/* Real classes replace the hardcoded `week` above once loaded. Kept as the
   honest fallback for a brand-new deployment (or an academy with nothing
   scheduled yet) — same "keep the demo data only when the server returns
   nothing real" rule loadPublishedResources()/loadPublishedVideos() use. */
function loadUpcomingClasses(){
  if(!GOC.api || !GOC.api.listUpcomingClasses) return;

  GOC.api.listUpcomingClasses().then(function(result){
    var items = result && Array.isArray(result.classes) ? result.classes : [];
    if(!items.length){
      week = {
        Mon:{label:'Monday', blocks:[]},
        Tue:{label:'Tuesday', blocks:[]},
        Wed:{label:'Wednesday', blocks:[]},
        Thu:{label:'Thursday', blocks:[]},
        Fri:{label:'Friday', blocks:[]},
        Sat:{label:'Saturday', blocks:[]},
        Sun:{label:'Sunday', blocks:[]}
      };
      buildWeek();
      return;
    }

    var byDay = {};
    dayKeys.forEach(function(k){ byDay[k] = { label: week[k].label, blocks: [] }; });

    items.forEach(function(c){
      var d = new Date(c.scheduledAt);
      if(isNaN(d.getTime())) return;
      var key = dayKeys[(d.getDay() + 6) % 7];   // getDay(): 0=Sun; dayKeys starts Mon
      var subj = canonSubject(c.subject);
      var color = (SUBJECT_META[subj] || {}).color || '#334155';
      var hh = d.getHours() % 12; if(hh === 0) hh = 12;
      var mm = String(d.getMinutes()).padStart ? String(d.getMinutes()).padStart(2,'0') : ('0'+d.getMinutes()).slice(-2);
      var durationMin = Number(c.durationMin) || 0;
      var dur = durationMin ? (durationMin % 60 === 0 ? (durationMin/60)+'h' : durationMin+'m') : '';

      // GET /api/classes already returns these ordered by scheduledAt, so
      // grouping by weekday here — without re-sorting — keeps each day's
      // blocks in chronological order too.
      byDay[key].blocks.push({
        t: hh+':'+mm, dur: dur, subj: subj,
        topic: c.topic + (c.tutor ? ' — ' + c.tutor : ''),
        color: color, zoomLink: c.zoomLink || ''
      });
    });

    week = byDay;
    buildWeek();
  }, function(err){
    console.warn('[goc] Could not load upcoming classes:', err && err.message);
  });
}

function buildWeek(){
  var strip = document.getElementById('weekStrip');
  strip.innerHTML = '';
  dayKeys.forEach(function(k,i){
    var b = document.createElement('button');
    b.className = 'wday' + (k===curDay?' on':'');
    b.innerHTML = '<div class="d">'+k+'</div><div class="n">'+dayNums[i]+'</div>';
    b.onclick = function(){ curDay=k; buildWeek(); renderDay(); };
    strip.appendChild(b);
  });
  renderDay();
}
/* The timetable is the student's own week: a block for a paper they do not sit
   is not their study block. CBT, Review and Revision belong to everyone, which
   studiesSubject() already allows because they are not subjects. */
function dayBlocks(key){
  var day = week[key];
  if(!day) return [];
  return day.blocks.filter(function(bl){ return bl.rest || studiesSubject(bl.subj); });
}
function renderDay(){
  var day = week[curDay];
  var blocks = dayBlocks(curDay);
  document.getElementById('ttDayLabel').textContent = day.label;
  var real = blocks.filter(function(x){return !x.rest;});
  document.getElementById('ttDaySummary').textContent = real.length+' study block'+(real.length!==1?'s':'')+' planned';
  var host = document.getElementById('ttBlocks');
  host.innerHTML = '';
  if(!blocks.length){
    var e = document.createElement('div');
    e.className = 'rest';
    e.innerHTML = 'Nothing scheduled for your combination today';
    host.appendChild(e);
    return;
  }
  blocks.forEach(function(bl){
    if(bl.rest){
      var r = document.createElement('div');
      r.className='rest';
      r.innerHTML='🌙 Rest & recharge — you earned it';
      host.appendChild(r); return;
    }
    var d = document.createElement('div');
    d.className='tt-block';
    d.innerHTML =
      '<div class="tt-bar" style="background:'+bl.color+'"></div>'+
      '<div class="tt-time">'+esc(bl.t)+'</div>'+
      '<div class="tt-main"><h4>'+esc(bl.topic)+'</h4><p>'+esc(bl.dur)+' · '+esc(bl.subj)+'</p>'+
      '<span class="tt-tag" style="background:'+hexA(bl.color)+';color:'+bl.color+'">'+esc(bl.subj)+'</span></div>';
    // A real class carries its own Zoom link — open it the same way a
    // video's externalUrl already does. A demo block has no link, so it
    // still just names itself.
    d.onclick=function(){ if(bl.zoomLink){ window.open(bl.zoomLink, '_blank'); } else { toast(bl.subj+' · '+bl.topic); } };
    host.appendChild(d);
  });
}
function hexA(hex){
  var h=hex.replace('#','');
  var r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);
  return 'rgba('+r+','+g+','+b+',0.10)';
}

/* ================= ADD STUDY BLOCK (student's own session) =================
   The button in the markup had no onclick at all, so tapping it did nothing —
   that was the bug. This wires it up: a small inline form that adds a block
   to whichever day is currently open in the strip. Pushed straight into the
   in-memory `week` object alongside real classes, so — same as everything
   else in this file (see the header note) — it lasts for this session and
   resets on refresh. BACKEND: once a student's own blocks should persist and
   sync across devices, save it through the API instead of into `week`
   directly, the same way a scheduled class already round-trips. */
function toggleAddBlock(){
  var form = document.getElementById('ttAddForm');
  var opening = form.style.display === 'none' || !form.style.display;
  if(!opening){ form.style.display = 'none'; return; }
  populateAddBlockSubjects();
  document.getElementById('ttNewTime').value = '';
  document.getElementById('ttNewDuration').value = '30';
  document.getElementById('ttNewTopic').value = '';
  form.style.display = 'block';
  document.getElementById('ttNewTime').focus();
}
/* Only the papers this student actually sits, plus the shared, non-subject
   slots studiesSubject() already treats as belonging to everyone. */
function populateAddBlockSubjects(){
  var sel = document.getElementById('ttNewSubject');
  var opts = orderedSubjects().concat(['Revision', 'Review']);
  sel.innerHTML = opts.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
}
function submitStudyBlock(){
  var timeEl = document.getElementById('ttNewTime');
  var durEl = document.getElementById('ttNewDuration');
  var subjEl = document.getElementById('ttNewSubject');
  var topicEl = document.getElementById('ttNewTopic');

  if(!timeEl.value){ toast('Pick a time for this block.'); timeEl.focus(); return; }
  var mins = parseInt(durEl.value, 10);
  if(!mins || mins <= 0){ toast('Enter a duration in minutes.'); durEl.focus(); return; }
  var topic = topicEl.value.trim();
  if(!topic){ toast('Give this block a topic to study.'); topicEl.focus(); return; }

  var subj = subjEl.value;
  var color = (SUBJECT_META[subj] || {}).color || '#334155';

  week[curDay].blocks.push({
    t: timeInputTo12(timeEl.value),
    dur: mins % 60 === 0 ? (mins / 60) + 'h' : mins + 'm',
    subj: subj,
    topic: topic,
    color: color
  });
  sortDayBlocks(curDay);

  toggleAddBlock();
  renderDay();
  toast('Study block added to ' + week[curDay].label + '.');
}
/* Matches the "H:MM, no am/pm" label the rest of the timetable already uses
   (see loadUpcomingClasses above), so a student-added block looks identical
   to a real class. */
function timeInputTo12(hhmm){
  var p = hhmm.split(':');
  var h = parseInt(p[0], 10) % 12; if(h === 0) h = 12;
  return h + ':' + p[1];
}
/* Existing blocks arrive already in time order (hardcoded demo data, or real
   classes grouped in the chronological order the server returns them in), so
   this only needs to place ONE new block correctly among them. The label has
   no am/pm marker, so reading it back to minutes is a heuristic, not a fact:
   it assumes the 1–6 o'clock hours on this timetable are always afternoon,
   which holds for every block this app currently produces (school hours run
   from morning classes into evening revision, never past-midnight study). */
function blockSortKey(label){
  var p = String(label).split(':');
  var h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
  if(h >= 1 && h <= 6) h += 12;
  return h * 60 + m;
}
function sortDayBlocks(key){
  week[key].blocks.sort(function(a, b){
    if(a.rest || b.rest) return a.rest ? 1 : -1;
    return blockSortKey(a.t) - blockSortKey(b.t);
  });
}

/* ================= SELF-DIRECTED STUDY =================
   Reading mode, the practice run and the student-configured CBT. All three are
   built from what the backend reports for this Scholar ID, so a student is only
   ever offered the papers they sit and the topics questions or notes have
   actually been published for.

   None of it is assessed. Nothing here is filed against the academic record,
   reaches the console results table or moves the league — the Web Test remains
   the only graded route. That separation is what lets a practice question carry
   its own answer so it can be marked the instant it is chosen, offline. */

var studyCat = null;      /* studyCatalogue(): subjects + reading, per own paper */
var suMode = 'cbt';       /* which mode the set-up screen is configuring */
var suSubj = null;        /* the chosen paper */
var suPick = {};          /* topic -> true, for the chosen paper only */
var suCount = 20, suMins = 20;
var SU_COUNTS = [5, 10, 20, 40];
var SU_MINUTES = [5, 10, 20, 45];

/* The catalogue is fetched once per sign-in and re-fetched on demand, because a
   question published by management mid-session should appear without a reload. */
function loadStudyCat(force){
  if(studyCat && !force) return Promise.resolve(studyCat);
  return GOC.api.studyCatalogue().then(function(c){ studyCat = c; return c; });
}
function suSubjects(){ return (studyCat && studyCat.subjects) || []; }
function suEntry(subject){
  var found = null;
  suSubjects().forEach(function(e){ if(e.subject === subject) found = e; });
  return found;
}
function suTopicList(){ var e = suEntry(suSubj); return (e && e.topics) || []; }
function suChosen(){
  return suTopicList().filter(function(t){ return !!suPick[t.topic]; });
}
function suAvailable(){
  /* Practice never narrows by topic (item 4/6: subject-only), so the pool is
     simply everything held for the one chosen subject (item 2: one subject
     at a time, never "all my subjects"). CBT keeps narrowing by the topics
     ticked below. */
  if(suMode === 'practice'){
    var entry = suEntry(suSubj);
    return entry ? entry.questions : 0;
  }
  return suChosen().reduce(function(m, t){ return m + t.questions; }, 0);
}
/* Every topic starts ticked: the common case is "the whole paper", and a
   student who wants one topic unticks the rest. */
function suSelectAll(on){
  suPick = {};
  if(on !== false) suTopicList().forEach(function(t){ suPick[t.topic] = true; });
}

function openStudySet(mode, subject, topic){
  suMode = (mode === 'practice') ? 'practice' : 'cbt';
  go('studySet');
  var host = document.getElementById('suTopics');
  if(host) host.innerHTML = '<div class="wt-none">Loading your papers…</div>';
  loadStudyCat().then(function(){
    var live = suSubjects().filter(function(e){ return e.questions > 0; });
    if(!live.length){
      toast('No questions have been published for your papers yet — your Web Test is still available');
      go('study');
      return;
    }
    var want = subject ? canonSubject(subject) : null;
    var pick = null;
    live.forEach(function(e){ if(!pick && (!want || e.subject === want)) pick = e; });
    suSubj = (pick || live[0]).subject;
    suSelectAll(true);
    /* Arriving from a note: that topic alone is ticked, so "practise this
       topic" means exactly the topic just read. */
    if(topic){
      var match = null;
      suTopicList().forEach(function(t){ if(t.topic === topic) match = t; });
      if(match){ suPick = {}; suPick[match.topic] = true; }
    }
    renderStudySet();
  }, function(err){
    if(host) host.innerHTML = '<div class="wt-none">' + esc(err.message || 'Could not load your papers') + '</div>';
  });
}
/* The two study set-ups. Both land on the same screen — what differs is the
   clock and when the marking happens. Practice is what a student can sit today;
   the CBT set-up is built and tested but has no tile yet, held back until the
   academy says the mock bank is deep enough to be worth a student's hour.
   Nothing else is advertised and then withheld: every tile on the Study screen
   opens something real, so there is no "coming soon" left to say. */
function openCBT(){ openStudySet('cbt'); }
function openPractice(){ openStudySet('practice'); }

function suSetSubject(s){
  if(s === suSubj) return;
  suSubj = canonSubject(s);
  suSelectAll(true);
  renderStudySet();
}
function suToggleTopic(t){
  if(suPick[t]) delete suPick[t]; else suPick[t] = true;
  renderStudySet();
}
function suToggleAll(){
  suSelectAll(suChosen().length !== suTopicList().length);
  renderStudySet();
}
function suSetCount(n){ suCount = n; renderStudySet(); }
function suSetMins(m){ suMins = m; renderStudySet(); }

function renderStudySet(){
  var prac = suMode === 'practice';
  var t = document.getElementById('suTitle'), sub = document.getElementById('suSub');
  if(t) t.textContent = prac ? 'Set up your practice' : 'Set up your CBT';
  if(sub) sub.textContent = prac
    ? 'Untimed · marked as you choose each answer · a fresh shuffle every run'
    : 'Timed · marked when you submit';

  var live = suSubjects().filter(function(e){ return e.questions > 0; });
  /* Practice picks its subject from a dropdown; the CBT set-up keeps the chips. */
  var chipsWrap = document.getElementById('suSubjectChipsWrap');
  var ddWrap = document.getElementById('suSubjectDDWrap');
  if(chipsWrap) chipsWrap.hidden = prac;
  if(ddWrap) ddWrap.hidden = !prac;
  var dd = document.getElementById('suSubjectDD');
  if(dd && prac){
    var opts = live.map(function(e){
      return '<option value="' + esc(e.subject) + '"' + (e.subject === suSubj ? ' selected' : '') + '>' + esc(e.subject) + '</option>';
    });
    dd.innerHTML = opts.join('');
    dd.value = suSubj;
  }
  var strip = document.getElementById('suSubjects');
  if(strip && !prac){
    var chips = live.map(function(e){
      return '<button class="fchip' + (e.subject === suSubj ? ' on' : '') + '" data-f="' + esc(e.subject) + '" ' +
             'onclick="suSetSubject(&quot;' + esc(e.subject) + '&quot;)">' + esc(e.subject) + '</button>';
    });
    strip.innerHTML = chips.join('');
  }

  /* Item 4/6: practice is subject-only — no topic picker at all. CBT keeps
     the topic picker exactly as before. */
  var topicsSection = document.getElementById('suTopicsSection');
  if(topicsSection) topicsSection.hidden = prac;

  if(!prac){
    var topics = suTopicList(), host = document.getElementById('suTopics');
    if(host){
      host.innerHTML = topics.length ? topics.map(function(x){
        var on = !!suPick[x.topic];
        return '<button class="ss-row' + (on ? ' on' : '') + '" onclick="suToggleTopic(&quot;' + esc(x.topic) + '&quot;)">' +
               '<span class="bx"></span><span class="nm"><b>' + esc(x.topic) + '</b>' +
               '<span>' + x.questions + ' question' + (x.questions !== 1 ? 's' : '') + '</span></span></button>';
      }).join('') : '<div class="wt-none">No topics have been published for this paper yet.</div>';
    }
    var all = document.getElementById('suAll');
    if(all) all.textContent = (topics.length && suChosen().length === topics.length) ? 'Clear all' : 'Select all';
  }

  /* Practice: the student types how many questions they want. The number is
     kept between 1 and what the subject can supply (never more than one run
     may hold). CBT keeps its chips, capped by what the chosen topics have. */
  var avail = suAvailable();
  var cChips = document.getElementById('suCountChipsWrap');
  var cInput = document.getElementById('suCountInputWrap');
  if(cChips) cChips.hidden = prac;
  if(cInput) cInput.hidden = !prac;
  if(prac){
    var cap = suCountCap(avail);
    if(avail){
      if(!(suCount >= 1)) suCount = Math.min(10, cap);
      if(suCount > cap) suCount = cap;
      suLastCount = suCount;
    }
    var inp = document.getElementById('suCountInput');
    if(inp){
      inp.max = String(cap || 1);
      inp.disabled = !avail;
      inp.value = avail ? String(suCount) : '';
    }
    var hint = document.getElementById('suCountHint');
    if(hint) hint.textContent = avail
      ? 'Type a number from 1 to ' + cap + (avail > cap ? ' (one run holds at most ' + cap + ').' : ' \u2014 the most this subject holds.')
      : 'No questions published yet.';
  } else {
    /* A count larger than the bank holds would promise questions that do not
       exist, so the options are capped by what the chosen topics actually have. */
    var seg = document.getElementById('suCounts');
    if(seg){
      var offer = SU_COUNTS.filter(function(n){ return n <= avail; });
      if(avail && offer.indexOf(avail) < 0 && avail < SU_COUNTS[SU_COUNTS.length - 1]) offer.push(avail);
      if(!offer.length && avail) offer = [avail];
      if(offer.indexOf(suCount) < 0) suCount = offer.length ? offer[offer.length - 1] : 0;
      seg.innerHTML = offer.length ? offer.map(function(n){
        return '<button class="wt-tab sm' + (n === suCount ? ' on' : '') + '" onclick="suSetCount(' + n + ')">' + n + '</button>';
      }).join('') : '<span class="wt-none">Pick at least one topic.</span>';
    }
  }

  var wrap = document.getElementById('suTimeWrap');
  if(wrap) wrap.hidden = prac;
  var mseg = document.getElementById('suMinutes');
  if(mseg && !prac){
    mseg.innerHTML = SU_MINUTES.map(function(m){
      return '<button class="wt-tab sm' + (m === suMins ? ' on' : '') + '" onclick="suSetMins(' + m + ')">' + m + ' min</button>';
    }).join('');
  }

  suPaintStart();
}

/* The Start button, drawn from the current choices. Kept apart from
   renderStudySet() so typing in the number box can refresh it without
   rebuilding the box (which would drop the cursor). */
function suPaintStart(){
  var prac = suMode === 'practice';
  var avail = suAvailable();
  var btn = document.getElementById('suStart');
  if(btn){
    // The server has refused suStart() since the ping route shipped; this just
    // gives the student a clear, disabled button instead of a Start-then-toast.
    if(state.studyExhausted){
      btn.disabled = true;
      btn.textContent = 'Today\u2019s study window is used up';
    } else if(prac && avail && !(suCount >= 1)){
      btn.disabled = true;
      btn.textContent = 'Enter number of questions';
    } else {
      btn.disabled = !avail;
      btn.textContent = !avail ? (prac ? 'No questions yet' : 'Pick a topic')
        : (prac ? 'Start practice \u00b7 ' + suCount + ' question' + (suCount === 1 ? '' : 's')
                : 'Start CBT \u00b7 ' + suCount + ' in ' + suMins + ' min');
    }
  }
}

/* ---- practice: the typed question count ---- */
var suLastCount = 0;   /* the last valid number, restored if the box is left empty */
function suCountCap(avail){
  var max = (studyCat && Number(studyCat.maxQuestions)) || 60;
  return Math.max(0, Math.min(max, Number(avail) || 0));
}
function suCountTyped(el){
  var cap = suCountCap(suAvailable());
  var n = Math.floor(Number(el.value));
  if(!isFinite(n) || n < 1) n = 0;
  if(n > cap){
    n = cap;
    el.value = String(cap);
    var hint = document.getElementById('suCountHint');
    if(hint) hint.textContent = 'Only ' + cap + ' available here \u2014 set to ' + cap + '.';
  }
  suCount = n;
  if(n >= 1) suLastCount = n;
  suPaintStart();
}
function suCountCommit(el){
  if(suMode !== 'practice' || !el) return;
  suCountTyped(el);
  if(!(suCount >= 1)){
    var cap = suCountCap(suAvailable());
    suCount = suLastCount >= 1 ? Math.min(suLastCount, cap) : Math.min(10, cap);
  }
  if(suCount >= 1){ suLastCount = suCount; el.value = String(suCount); }
  suPaintStart();
}

function suStart(){
  if(!suAvailable()) return;
  if(suMode === 'practice') suCountCommit(document.getElementById('suCountInput'));
  if(state.studyExhausted){ showWinddown(); return; }
  var info = suInstructions();
  showTestInfo(info.title, info.about, info.rules, suStartConfirmed);
}
function suStartConfirmed(){
  var mode = suMode;
  var body = { mode: mode, subject: suSubj, count: suCount };
  if(mode === 'cbt'){
    body.minutes = suMins;
    body.topics = suChosen().map(function(t){ return t.topic; });
  }
  var btn = document.getElementById('suStart');
  if(btn){ btn.disabled = true; btn.textContent = 'Setting up…'; }
  GOC.api.startStudy(body).then(function(p){
    if(p.mode === 'practice') pracOpen(p); else cbtOpenStudy(p);
  }, function(err){
    toast(err.message || 'Could not start that run');
    renderStudySet();
  });
}

/* ================= PRACTICE =================
   Untimed, and marked question by question the moment an option is chosen —
   which is why a practice paper travels with its answer and explanation. The
   run is scored only in the page; nothing is submitted. */
var pracPaper = null;
var pracI = 0, pracAnswered = false;
var pracMarks = [];          /* what the review screen is built from */

function pracOpen(p){
  pracPaper = p;
  pracI = 0; pracMarks = [];
  go('practice');
  renderPrac();
}
function pracQ(){ return (pracPaper && pracPaper.questions[pracI]) || null; }
function renderPrac(){
  pracAnswered = false;
  var d = pracQ();
  if(!d) return;
  var total = pracPaper.questions.length;
  var sub = document.getElementById('pracSub');
  if(sub){
    /* The header states what the run is worth, from the figures the data layer
       sent — the page never invents an XP rate of its own. */
    var rate = pracPaper.xpPerCorrect
      ? ' · ' + pracPaper.xpPerAnswer + ' XP answered, ' + pracPaper.xpPerCorrect + ' XP correct' : '';
    sub.textContent = pracPaper.subject + ' · ' + d.topic + ' · untimed' + rate;
  }
  document.getElementById('pracNum').textContent = 'Question ' + (pracI + 1) + ' of ' + total;
  document.getElementById('pracQ').innerHTML = mth(d.text, {breaks:true});
  var host = document.getElementById('pracOpts');
  host.innerHTML = '';
  (d.options || []).forEach(function(o, i){
    var b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = '<span class="key">' + OPT_KEYS[i] + '</span>' + mth(o);
    b.onclick = function(){ answerPrac(i, b); };
    host.appendChild(b);
  });
  document.getElementById('pracFb').innerHTML = '';
  var btn = document.getElementById('pracBtn');
  btn.disabled = true; btn.textContent = 'Select an answer';
  var prog = document.getElementById('pracProg');
  prog.innerHTML = '';
  for(var i = 0; i < total; i++){
    var s = document.createElement('span');
    if(i < pracI) s.className = 'on'; else if(i === pracI) s.className = 'cur';
    prog.appendChild(s);
  }
}
function answerPrac(i, btn){
  if(pracAnswered) return;
  pracAnswered = true;
  var d = pracQ();
  var opts = document.getElementById('pracOpts').querySelectorAll('.opt');
  opts.forEach(function(o){ o.disabled = true; });
  var right = i === d.answer;
  btn.classList.add(right ? 'correct' : 'wrong');
  if(!right && opts[d.answer]) opts[d.answer].classList.add('correct');
  document.getElementById('pracFb').innerHTML =
    '<div class="feedback ' + (right ? 'ok' : 'no') + '"><h4>' + (right ? 'Correct' : 'Not quite') + '</h4>' +
    '<p>' + mth(d.explanation || 'Read the note on this topic in Read / Learn.', {breaks:true}) + '</p></div>';
  pracMarks.push({ n: pracI + 1, topic: d.topic, text: d.text, options: (d.options || []).slice(),
                   answer: d.answer, given: i, isCorrect: right, explanation: d.explanation || '' });
  var b = document.getElementById('pracBtn');
  b.disabled = false;
  b.textContent = pracI < pracPaper.questions.length - 1 ? 'Next question →' : 'See your review';
}
/* Finishing a practice run: the page has already marked every question for the
   student, but the run is sent back all the same. The data layer marks it again
   from its own copy of the answers and awards the XP, so no screen is ever
   trusted to say how much a student earned. If that call cannot be made, the
   review is still shown from what the page marked — with no XP claimed. */
function pracNext(){
  if(!pracAnswered) return;
  if(pracI < pracPaper.questions.length - 1){ pracI++; renderPrac(); return; }
  var paper = pracPaper;
  var local = pracLocalResult(paper);
  pracPaper = null;
  if(!paper.paperId){ srShow(local); return; }
  var responses = {};
  pracMarks.forEach(function(m, i){
    var q = paper.questions[i];
    if(q && m.given != null) responses[q.id] = m.given;
  });
  GOC.api.submitStudy({ paperId: paper.paperId, responses: responses, timeUsedSec: 0 })
    .then(function(res){
      res.review = pracMarks;          /* keep the order the student answered in */
      res.mode = 'practice';
      srShow(res);
      refreshMe();                     /* the XP has moved, so the header must too */
    }, function(){ srShow(local); });
}
function pracLocalResult(paper){
  var correct = pracMarks.filter(function(m){ return m.isCorrect; }).length;
  var total = paper.questions.length;
  return {
    mode: 'practice', subject: paper.subject, assessed: false,
    total: total, answered: pracMarks.length, unanswered: total - pracMarks.length,
    correct: correct, wrong: pracMarks.length - correct,
    percent: total ? Math.round(correct * 100 / total) : 0,
    timeUsedSec: null, xpAwarded: 0, review: pracMarks, topics: pracTopicBands()
  };
}
/* The same strong / developing / weak bands the graded results use. A practice
   run is marked in the page, so the rows are built here — but the banding and
   the ordering come from the shared core rule, never from this screen. */
function pracTopicBands(){
  return GOC.api.rules.topicBreakdown(pracMarks.map(function(m){
    return { topic: m.topic, markAwarded: m.isCorrect ? 1 : 0, maxMark: 1 };
  }));
}

/* ================= STUDY REVIEW =================
   Shared by both self-directed modes. It says plainly that the run is not
   assessed, so a good score here is never mistaken for a graded result. */
var srLast = null;
function srShow(res){
  srLast = res;
  var prac = res.mode === 'practice';
  var t = document.getElementById('srTitle'), sub = document.getElementById('srSub');
  if(t) t.textContent = res.correct + ' of ' + res.total + ' correct · ' + res.percent + '%';
  if(sub) sub.textContent = res.subject + ' · ' + (prac ? 'practice · earns XP' : 'CBT set-up') + ' · not part of your record';

  var rows = [
    ['Questions', String(res.total)],
    ['Answered', String(res.answered)],
    ['Correct', String(res.correct)],
    ['Incorrect', String(res.wrong)],
    ['Score', res.percent + '%']
  ];
  if(res.timeUsedSec !== null && res.timeUsedSec !== undefined) rows.push(['Time used', mmss(res.timeUsedSec)]);
  /* Practice is unassessed but not unrewarded: the student sees the XP their
     work earned, and is told when a day's allowance has been reached rather
     than being left to wonder why the figure stopped moving. */
  if(prac){
    rows.push(['XP earned', '+' + (Number(res.xpAwarded) || 0) + ' XP']);
    if(res.xpCapped) rows.push(['Daily XP allowance', 'Reached for today — keep practising for the marks']);
    else if(res.xpLeftToday != null) rows.push(['XP left today', res.xpLeftToday + ' XP']);
  }
  rows.push(['On your record', 'No — study runs are not assessed']);
  var stats = document.getElementById('srStats');
  if(stats){
    stats.innerHTML = rows.map(function(r){
      return '<div class="wt-stat"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
  }
  var brk = document.getElementById('srBrk');
  if(brk){
    brk.innerHTML = (res.topics || []).length ? res.topics.map(function(x){
      var col = x.band === 'strong' ? '#15803D' : x.band === 'developing' ? '#E08600' : '#DC2626';
      return '<div class="brk"><span class="tag" style="background:' + col + '"></span>' +
             '<span class="nm">' + esc(x.topic) + '</span>' +
             '<span class="st" style="background:' + hexA(col) + ';color:' + col + '">' +
             x.percent + '% · ' + esc(x.band.charAt(0).toUpperCase() + x.band.slice(1)) + '</span></div>';
    }).join('') : '<div class="wt-none">No topic breakdown for this run.</div>';
  }
  var rev = document.getElementById('srReview');
  if(rev){
    rev.innerHTML = (res.review || []).map(function(r){
      var opts = r.options || [];
      var mine = (r.given === null || r.given === undefined) ? 'Not answered' : opts[r.given];
      return '<div class="wt-rev"><div class="rq">Question ' + r.n + ' · ' + esc(r.topic || '') + '</div>' +
             '<div class="rt">' + mth(r.text, {breaks:true}) + '</div>' +
             '<div class="ra"><em>Your answer</em>' + mth(mine) + '</div>' +
             '<div class="ra"><em>Correct answer</em>' + mth(opts[r.answer]) + '</div>' +
             (r.explanation ? '<div class="ra"><em>Why</em>' + mth(r.explanation, {breaks:true}) + '</div>' : '') +
             '<span class="verdict ' + (r.isCorrect ? 'ok' : 'no') + '">' +
             (r.isCorrect ? 'Correct' : 'Incorrect') + '</span></div>';
    }).join('');
  }
  go('studyRes');
}
/* Straight back to the set-up screen for the mode just finished. */
function srAgain(){ openStudySet(srLast && srLast.mode === 'practice' ? 'practice' : 'cbt', srLast && srLast.subject); }

/* ================= READING MODE =================
   Subject, then topic, then note. Every note is written and published by the
   academy through the console, so this screen holds no lesson prose of its own —
   it draws what has been published for the papers this student sits. Before
   this it was a single hard-coded Chemistry lesson, which told a student who
   does not sit Chemistry that the reading mode was somebody else's. */
var rdSubj = null;
var rdNotes = [];         /* the notes for rdSubj, as the backend returned them */
var rdNote = null;        /* the note open in the reader */

function openReading(subject){
  go('reading');
  var host = document.getElementById('rdTopics');
  if(host) host.innerHTML = '<div class="wt-none">Loading your notes…</div>';
  loadStudyCat().then(function(c){
    var live = (c.reading || []).filter(function(e){ return e.notes > 0; });
    if(!live.length){
      if(host) host.innerHTML = '<div class="wt-none">No notes have been published for your papers yet. Your practice questions and Web Test are still available.</div>';
      renderReadingSubjects([]);
      return;
    }
    var want = subject ? canonSubject(subject) : null;
    var pick = null;
    live.forEach(function(e){ if(!pick && (!want || e.subject === want)) pick = e; });
    rdSubj = (pick || live[0]).subject;
    renderReadingSubjects(live);
    loadReadingNotes();
  }, function(err){
    if(host) host.innerHTML = '<div class="wt-none">' + esc(err.message || 'Could not load your notes') + '</div>';
  });
}
/* Kept as the entry point the home screen's "continue" card already calls. */
function openLesson(subject){ openReading(subject); }

function renderReadingSubjects(live){
  var strip = document.getElementById('rdSubjects');
  if(!strip) return;
  strip.innerHTML = (live || []).map(function(e){
    return '<button class="fchip' + (e.subject === rdSubj ? ' on' : '') + '" data-f="' + esc(e.subject) + '" ' +
           'onclick="setReadingSubj(&quot;' + esc(e.subject) + '&quot;)">' + esc(e.subject) + '</button>';
  }).join('');
}
function setReadingSubj(s){
  rdSubj = canonSubject(s);
  renderReadingSubjects((studyCat && studyCat.reading || []).filter(function(e){ return e.notes > 0; }));
  loadReadingNotes();
}
function loadReadingNotes(){
  var host = document.getElementById('rdTopics');
  if(host) host.innerHTML = '<div class="wt-none">Loading…</div>';
  GOC.api.listNotes({ subject: rdSubj }).then(function(r){
    rdNotes = r.notes || [];
    renderReadingTopics();
  }, function(err){
    if(host) host.innerHTML = '<div class="wt-none">' + esc(err.message || 'Could not load those notes') + '</div>';
  });
}
function renderReadingTopics(){
  var host = document.getElementById('rdTopics');
  if(!host) return;
  var sub = document.getElementById('rdSub');
  if(sub) sub.textContent = rdSubj + ' · ' + rdNotes.length + ' note' + (rdNotes.length !== 1 ? 's' : '');
  if(!rdNotes.length){
    host.innerHTML = '<div class="wt-none">No notes have been published for this paper yet.</div>';
    return;
  }
  /* Grouped under the topic, because the topic is what a student is revising —
     and it is the same topic name the practice set-up offers. */
  var order = [], byTopic = {};
  rdNotes.forEach(function(n){
    if(!byTopic[n.topic]){ byTopic[n.topic] = []; order.push(n.topic); }
    byTopic[n.topic].push(n);
  });
  host.innerHTML = order.map(function(tp){
    return '<div class="rd-tp">' + esc(tp) + '</div>' + byTopic[tp].map(function(n){
      return '<button class="rd-note" onclick="openNote(' + n.id + ')">' +
             '<span class="nm"><b>' + esc(n.title) + '</b><span>' + esc(n.subject) + ' · ' + esc(n.topic) + '</span></span>' +
             '<span class="mins">' + n.minutes + ' min</span></button>';
    }).join('');
  }).join('');
}
function noteById(id){
  var found = null;
  rdNotes.forEach(function(n){ if(String(n.id) === String(id)) found = n; });
  return found;
}
function openNote(id){
  var n = noteById(id);
  if(!n){ toast('That note is no longer available'); return; }
  rdNote = n;
  go('lesson');
  renderLesson();
  var wm = document.getElementById('wmLesson');
  if(wm && !wm.dataset.done){
    /* The watermark carries whoever is signed in, read off the identity strip
       the login already painted, so a shared screenshot names its own source. */
    var nEl = document.getElementById('idName'), cEl = document.getElementById('idCode');
    var stamp = ((nEl && nEl.textContent) || 'G.O.C Academy') + ' · ' + ((cEl && cEl.textContent) || '');
    var html = '';
    for(var i = 0; i < 7; i++){ for(var j = 0; j < 3; j++){ html += '<b style="top:' + (i * 140 - 40) + 'px;left:' + (j * 230 - 60) + 'px">' + esc(stamp) + '</b>'; } }
    wm.innerHTML = html; wm.dataset.done = '1';
  }
}
function renderLesson(){
  var n = rdNote;
  if(!n) return;
  var t = document.getElementById('lessonTitle'), sub = document.getElementById('lessonSub');
  if(t) t.textContent = n.title;
  if(sub) sub.textContent = n.subject + ' · ' + n.topic + ' · ' + n.minutes + ' min read';
  /* Notes are stored as plain text, never as markup: a paragraph break is a
     blank line. Rendering them by paragraph means a note typed or imported by
     management can never inject markup into a student's screen — the only markup
     that reaches it is what the Hub itself writes to set a formula. */
  var body = document.getElementById('lessonBody');
  if(!body) return;
  var paras = String(n.body || '').split(/\n{2,}/).filter(function(x){ return x.trim(); });
  var siblings = rdNotes.filter(function(x){ return x.topic === n.topic && x.id !== n.id; });
  body.innerHTML =
    '<div class="kb">' + esc(n.topic) + '</div>' +
    paras.map(function(x){ return '<p>' + mth(x.trim(), {breaks:true}) + '</p>'; }).join('') +
    (siblings.length ? '<div class="rd-tp">More on this topic</div>' + siblings.map(function(x){
      return '<button class="rd-note" onclick="openNote(' + x.id + ')"><span class="nm"><b>' + esc(x.title) +
             '</b><span>' + x.minutes + ' min read</span></span></button>';
    }).join('') : '') +
    '<div class="spacer"></div>';
}
/* The bottom bar of the reader: practise the very topic just read. */
function practiseThisNote(){
  if(!rdNote){ openPractice(); return; }
  openStudySet('practice', rdNote.subject, rdNote.topic);
}



/* ================= WEB TEST (Priority 3) =================
   A paper's questions, its clock and its marking all belong to the backend.
   This module draws what GOC.api reports and posts back only what the student
   typed or picked — so a correct answer is never in the page before marking,
   and a score is never writable from here. */
var wtCatalogue = null;   // { subjects:[], tests:[{period,section,subject,questions,durationSec}] }
var wtPaper = null;       // the paper in progress, exactly as startTest returned it
var wtGroups = null;      // the papers inside an objective sitting, in served order
var wtResp = {};          // questionId -> chosen option index, or typed answer
var wtCur = 0;
var wtSecs = 0, wtTimerId = null, wtBusy = false, wtArmed = false;
var wtUntimed = false, wtOpenedAt = 0;
var OPT_KEYS = ['A','B','C','D','E','F','G','H'];

/* One entry per session, so the three sessions stay clearly separated. How a
   paper is marked is the academy's business, not the student's: nothing here
   says who or what awards the mark. A result simply arrives, or is honestly
   shown as still awaited. The JAMB-oriented session is held back: it is shown
   as coming soon rather than offered, because the objective sitting already
   gives a full timed paper. */
var WT_SECTIONS = [
  { key:'theory', title:'Theory session', colour:'#0E7490',
    note:'A written paper in each subject that has one, sat without a clock. Write your answers in full and submit when you are ready.',
    icon:'<path d="M4 20h16"/><path d="M6.2 16.4L16.9 5.7a2 2 0 112.8 2.8L9 19.2l-4.3.8.5-3.6z"/>' },
  { key:'objective', title:'Objective session', colour:'#DC2626',
    note:'One sitting of your whole combination, on a clock set by the academy. Move between your papers freely until you submit.',
    icon:'<circle cx="6.5" cy="8" r="2.4"/><circle cx="6.5" cy="16" r="2.4"/><path d="M12 8h8M12 16h8"/>' },
  { key:'jamb', title:'JAMB-oriented session', colour:'#141821', soon:true,
    note:'Full CBT mode — numbered questions, a navigation panel and a running clock.',
    icon:'<rect x="3" y="4.5" width="18" height="11.5" rx="1.6"/><path d="M2 20h20"/>' }
];
function wtSectionLabel(s){ return s === 'jamb' ? 'JAMB-oriented' : (s === 'theory' ? 'Theory' : (s === 'practice' ? 'Practice only' : 'Objective')); }
/* There is one test. Every paper — and every record of one, however it was
   stored — reads as that test. */
function wtPeriodLabel(){ return GOC.api.rules.PERIOD_LABEL; }
function mmss(total){
  /* Hours as soon as the paper has one: a two-hour sitting reads 2:00:00. */
  return GOC.api.rules.hmsClock(total);
}
function wtMinutes(sec){ return GOC.api.rules.hoursLabel(Math.round((Number(sec) || 0) / 60)); }
function wtWhen(ms){
  var d = new Date(Number(ms) || 0);
  if(isNaN(d.getTime()) || !ms) return 'just now';
  var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return d.getDate() + ' ' + mon + ' · ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}

function openWebTest(){ go('webtest'); wtLoad(); }
function wtLoad(){
  var host = document.getElementById('wtSections');
  if(host && !wtCatalogue) host.innerHTML = '<div class="wt-none">Loading your papers…</div>';
  GOC.api.listMyTests().then(function(r){
    wtCatalogue = { subjects: (r && r.subjects) || [], tests: (r && r.tests) || [] };
    renderWebTest();
  }, function(err){
    wtCatalogue = null;
    if(host) host.innerHTML = '<div class="wt-none">' + esc(err.message || 'Your papers are not available right now.') + '</div>';
  });
  wtLoadHistory();
}
/* The hub only ever lists papers in the student's own combination, because the
   catalogue itself is built from the account's stored subjects (Priority 6). */
function renderWebTest(){
  var host = document.getElementById('wtSections');
  if(!host) return;
  var lead = document.getElementById('wtLead');
  if(lead && wtCatalogue){
    var n = wtCatalogue.subjects.length;
    lead.textContent = n + ' registered subject' + (n !== 1 ? 's' : '') + ' · ' + wtPeriodLabel().toLowerCase();
  }
  host.innerHTML = '';
  if(!wtCatalogue){ host.innerHTML = '<div class="wt-none">Log in with your Scholar ID to sit a web test.</div>'; return; }
  WT_SECTIONS.forEach(function(sec){
    /* No period filter: there is one test, so every published paper for this
       session belongs on this card however it was stored. */
    var rows = wtCatalogue.tests.filter(function(t){ return t.section === sec.key; });
    var card = document.createElement('div');
    card.className = 'wt-sec' + (sec.soon ? ' soon' : '');
    card.innerHTML = '<div class="wt-sec-top">'
      + '<div class="wt-si" style="background:' + sec.colour + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">' + sec.icon + '</svg></div>'
      + '<div class="wt-st"><h4>' + esc(sec.title) + '</h4><p>' + esc(sec.note) + '</p></div>'
      + '</div>';
    /* A session that is not built yet says so once, and offers no Start at all.
       Nothing here is the control — the data layer refuses it as well. */
    if(sec.soon){
      var soon = document.createElement('button');
      soon.className = 'wt-none soon';
      soon.type = 'button';
      soon.textContent = 'Coming soon. Sit the Objective session for a full timed sitting of your whole combination.';
      soon.onclick = function(){ toast('The JAMB-oriented session is coming soon'); };
      card.appendChild(soon);
      host.appendChild(card);
      return;
    }
    if(!rows.length){
      var none = document.createElement('div');
      none.className = 'wt-none';
      none.textContent = 'No ' + wtSectionLabel(sec.key).toLowerCase()
        + ' paper has been published for your subjects yet.';
      card.appendChild(none);
    }
    rows.forEach(function(t, i){
      card.appendChild(wtRowEl(t, i === 0));
    });
    /* A student who takes a subject with no written paper is told so plainly,
       rather than left looking for a paper that will never appear. */
    if(sec.key === 'theory'){
      var off = wtNoTheorySubjects();
      if(off.length){
        var why = document.createElement('div');
        why.className = 'wt-none';
        why.textContent = off.join(' and ') + (off.length > 1 ? ' are' : ' is')
          + ' examined in the objective sitting only, so there is no written paper to sit.';
        card.appendChild(why);
      }
    }
    host.appendChild(card);
  });
}
/* Which of this student's own subjects offer no written paper. The rule lives in
   the data layer; this only reports it. */
function wtNoTheorySubjects(){
  var subs = (wtCatalogue && wtCatalogue.subjects) || [];
  return subs.filter(function(s){ return !GOC.api.rules.theoryAllowed(s); });
}
/* A row states what the paper actually is: how many questions, and either the
   clock the academy set or, for a written paper, that there is no clock. The
   objective sitting also names the papers inside it, so a student can see the
   whole combination before pressing Start. */
function wtRowEl(t, first){
  var row = document.createElement('div');
  row.className = 'wt-row' + (first ? ' first' : '');
  var nm = document.createElement('div');
  nm.className = 'nm';
  var when = Number(t.durationSec) > 0 ? wtMinutes(t.durationSec) : 'no time limit';
  var line = '<b>' + esc(t.subject) + '</b><span>' + t.questions + ' question' + (t.questions !== 1 ? 's' : '')
    + ' · ' + esc(when) + '</span>';
  if(t.papers && t.papers.length){
    line += '<span class="papers">' + esc(wtPapersLine(t.papers)) + '</span>';
  }
  nm.innerHTML = line;
  var b = document.createElement('button');
  b.className = 'wt-start';
  // ONE-SIT RULE: a submitted paper never offers Start again — the backend
  // refuses it too (see hasSubmittedAttempt), this is just the courtesy of
  // not letting a student tap a button that can only ever fail.
  if(t.completed){
    b.disabled = true;
    b.className = 'wt-start done';
    b.textContent = 'Submitted';
  } else if(state.studyExhausted){
    b.disabled = true;
    b.textContent = 'Window used up';
  } else {
    b.textContent = 'Start';
    b.onclick = function(){ wtConfirmStart(t, b); };
  }
  row.appendChild(nm);
  row.appendChild(b);
  return row;
}
function wtPapersLine(papers){
  var parts = [];
  papers.forEach(function(p){
    if(Number(p.questions) > 0) parts.push(p.subject + ' ' + p.questions);
  });
  return parts.join(' · ');
}

/* The record is read from the backend, never from anything this page holds, so
   what a student sees is exactly what was stored against their Scholar ID. */
function wtLoadHistory(){
  var host = document.getElementById('wtHistory');
  if(!host) return;
  GOC.api.myResults().then(function(r){
    var rows = (r && r.attempts) || [];
    host.innerHTML = '';
    if(!rows.length){
      host.innerHTML = '<div class="wt-none">You have not submitted a web test yet.</div>';
      return;
    }
    rows.slice(0, 8).forEach(function(a){
      var marked = a.status === 'marked';
      var pct = marked ? Math.round(Number(a.percent) || 0) : null;
      var col = pct === null ? '#D97706' : (pct >= 70 ? '#15803D' : (pct >= 50 ? '#D97706' : '#DC2626'));
      var b = document.createElement('button');
      b.className = 'wt-his';
      b.innerHTML = '<div class="score" style="background:' + col + '">' + (pct === null ? '⏳' : pct + '%') + '</div>'
        + '<div class="nm"><b>' + esc(a.subject) + ' · ' + esc(wtSectionLabel(a.section)) + '</b>'
        + '<span>' + esc(wtPeriodLabel()) + ' · ' + esc(wtWhen(a.submittedAt)) + ' · '
        + (marked ? (a.score + ' / ' + a.maxScore + ' marks') : 'awaiting your result') + '</span></div>'
        + '<svg class="icon arr" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>';
      b.onclick = function(){ wtOpenResult(a.id); };
      host.appendChild(b);
    });
  }, function(err){
    host.innerHTML = '<div class="wt-none">' + esc(err.message || 'Your test record is not available right now.') + '</div>';
  });
}

/* Starting a paper is a request, not a local decision: the backend checks the
   sitting is really the student's, opens the attempt and stamps the start time.
   The objective sitting carries the whole combination, so nothing is chosen
   here but the moment to begin. */
function wtStart(period, section, subject, btn){
  if(wtBusy) return;
  if(state.studyExhausted){ showWinddown(); return; }
  wtBusy = true;
  if(btn){ btn.disabled = true; btn.textContent = '…'; }
  GOC.api.startTest({ period: period, section: section, subject: subject }).then(function(p){
    wtBusy = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Start'; }
    wtPaper = p;
    wtResp = {};
    wtCur = 0;
    wtArmed = false;
    wtBuildGroups();
    /* A duration of zero is a real answer, not a missing one: the paper is sat
       without a clock. Time is still recorded, from the moment it opened. */
    wtUntimed = !(Number(p.durationSec) > 0);
    wtSecs = wtUntimed ? 0 : Number(p.durationSec);
    wtOpenedAt = Date.now();
    go('wtRun');
    wtPaintHead(); wtBuildNav(); wtRender();
    if(wtUntimed) wtNoClock(); else wtStartClock();
  }, function(err){
    wtBusy = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Start'; }
    toast(err.message || 'Could not start that test');
  });
}

function wtPaintHead(){
  if(!wtPaper) return;
  var t = document.getElementById('wtRunTitle'), s = document.getElementById('wtRunSub');
  if(t) t.textContent = wtPaper.subject + ' · ' + wtSectionLabel(wtPaper.section);
  if(s){
    var line = wtPeriodLabel() + ' · ' + wtPaper.total
      + ' question' + (wtPaper.total !== 1 ? 's' : '') + ' · '
      + (Number(wtPaper.durationSec) > 0 ? wtMinutes(wtPaper.durationSec) : 'no time limit');
    if(wtPaper.papers && wtPaper.papers.length) line += ' · ' + wtPapersLine(wtPaper.papers);
    s.textContent = line;
  }
  var el = document.getElementById('wtTime');
  if(el) el.textContent = wtUntimed ? 'No limit' : mmss(wtSecs);
}

/* ---- the papers inside one objective sitting ----
   The objective session is a single clock over the whole combination, exactly as
   a sitting runs in the hall: a scholar may leave Physics, answer a Chemistry
   question and come back before submitting. The groups below are derived from
   the order the backend served the paper in — this page never decides which
   question belongs to which subject, and never reorders them. */
function wtBuildGroups(){
  wtGroups = null;
  if(!wtPaper || !wtPaper.papers || wtPaper.papers.length < 2) return;
  var total = wtPaper.questions.length, at = 0, g = [], bad = false;
  wtPaper.papers.forEach(function(p){
    var n = Math.max(0, Math.round(Number(p.questions) || 0));
    if(n === 0) return;
    if(at + n > total){ bad = true; return; }
    g.push({ subject: p.subject, from: at, to: at + n - 1, count: n });
    at += n;
  });
  /* If the counts do not account for the paper exactly, the switcher would be
     lying about which questions it opens — so it simply is not offered. */
  if(bad || at !== total || g.length < 2) return;
  wtGroups = g;
}
function wtGroupAt(i){
  if(!wtGroups) return null;
  for(var k = 0; k < wtGroups.length; k++){
    if(i >= wtGroups[k].from && i <= wtGroups[k].to) return wtGroups[k];
  }
  return null;
}
function wtGroupDone(g){
  var n = 0;
  for(var i = g.from; i <= g.to; i++){ if(wtAnswered(i)) n++; }
  return n;
}
/* Opening a paper lands on its first unanswered question, or on its first
   question if it is already complete — the courtesy of turning to a page. */
function wtOpenSubject(k){
  var g = wtGroups && wtGroups[k];
  if(!g) return;
  var at = g.from;
  for(var i = g.from; i <= g.to; i++){ if(!wtAnswered(i)){ at = i; break; } }
  wtGo(at);
}
function wtPaintSubjects(){
  var host = document.getElementById('wtSubjects');
  if(!host) return;
  if(!wtGroups){ host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = '';
  var cur = wtGroupAt(wtCur);
  wtGroups.forEach(function(g, k){
    var done = wtGroupDone(g);
    var b = document.createElement('button');
    b.className = 'wt-sub' + (g === cur ? ' cur' : '') + (done === g.count ? ' done' : '');
    b.type = 'button';
    b.innerHTML = '<b>' + esc(g.subject) + '</b><span>' + done + '/' + g.count + '</span>';
    b.onclick = function(){ wtOpenSubject(k); };
    host.appendChild(b);
  });
}
function wtAnswered(i){
  if(!wtPaper) return false;
  var q = wtPaper.questions[i];
  if(!q) return false;
  var v = wtResp[q.id];
  if(q.kind === 'theory') return typeof v === 'string' && v.replace(/\s+/g,'') !== '';
  return v !== undefined && v !== null && v !== '';
}
function wtBuildNav(){
  if(!wtPaper) return;
  wtPaintSubjects();
  /* Inside a sitting of several papers the panel shows the paper being sat,
     numbered from 1 the way that subject's question paper is numbered. The
     subject strip above moves between papers. */
  var g = wtGroupAt(wtCur);
  var from = g ? g.from : 0;
  var to = g ? g.to : wtPaper.questions.length - 1;
  var span = to - from + 1;
  var nav = document.getElementById('wtNav');
  if(nav){
    nav.innerHTML = '';
    for(var i = from; i <= to; i++){
      (function(i){
        var b = document.createElement('button');
        b.className = 'qn' + (i === wtCur ? ' cur' : '') + (wtAnswered(i) ? ' ans' : '');
        b.textContent = i - from + 1;
        b.onclick = function(){ wtGo(i); };
        nav.appendChild(b);
      })(i);
    }
  }
  /* The strip is a quick glance for a short paper; on a long one the numbered
     panel above already carries the same information without 40 slivers. */
  var prog = document.getElementById('wtProg');
  if(prog){
    prog.innerHTML = '';
    if(span > 12){ prog.style.display = 'none'; }
    else {
      prog.style.display = 'flex';
      for(var j = from; j <= to; j++){
        var s = document.createElement('span');
        s.className = j === wtCur ? 'cur' : (wtAnswered(j) ? 'on' : '');
        prog.appendChild(s);
      }
    }
  }
}
function wtRender(){
  if(!wtPaper) return;
  var q = wtPaper.questions[wtCur];
  var num = document.getElementById('wtNum'), txt = document.getElementById('wtQ');
  var g = wtGroupAt(wtCur);
  if(num) num.textContent = g
    ? g.subject + ' · Question ' + (wtCur - g.from + 1) + ' of ' + g.count
    : 'Question ' + (wtCur + 1) + ' of ' + wtPaper.total;
  if(txt) txt.innerHTML = mth(q.text, {breaks:true});
  var opts = document.getElementById('wtOpts'), thy = document.getElementById('wtTheory');
  if(opts) opts.innerHTML = '';
  if(q.kind === 'theory'){
    if(opts) opts.hidden = true;
    if(thy) thy.hidden = false;
    var box = document.getElementById('wtAnswer');
    if(box) box.value = typeof wtResp[q.id] === 'string' ? wtResp[q.id] : '';
    var hint = document.getElementById('wtMarkHint');
    /* What the mark is worth is the student's business; who awards it is not. */
    if(hint) hint.textContent = 'Worth ' + (q.maxMark || 0) + ' mark' + ((q.maxMark || 0) !== 1 ? 's' : '')
      + ' · write your full working';
  } else {
    if(thy) thy.hidden = true;
    if(opts){
      opts.hidden = false;
      (q.options || []).forEach(function(o, i){
        var b = document.createElement('button');
        b.className = 'opt' + (Number(wtResp[q.id]) === i ? ' sel' : '');
        b.innerHTML = '<span class="key">' + OPT_KEYS[i] + '</span>' + mth(o);
        b.onclick = function(){ wtPick(i); };
        opts.appendChild(b);
      });
    }
  }
  var btn = document.getElementById('wtSubmitBtn');
  if(btn) btn.textContent = wtArmed ? 'Submit anyway' : 'Submit';
}
function wtPick(i){
  if(!wtPaper) return;
  wtResp[wtPaper.questions[wtCur].id] = i;
  wtRender(); wtBuildNav();
}
function wtTyped(){
  if(!wtPaper) return;
  var box = document.getElementById('wtAnswer');
  wtResp[wtPaper.questions[wtCur].id] = box ? box.value : '';
  wtBuildNav();
}
function wtGo(i){
  if(!wtPaper) return;
  wtCur = Math.max(0, Math.min(wtPaper.questions.length - 1, i));
  wtRender(); wtBuildNav();
}
function wtMove(d){ wtGo(wtCur + d); }

/* The clock on screen is a courtesy. The backend stamped the start time and
   clamps the time used on submit, so pausing or editing this timer cannot buy a
   student a single extra minute. */
function wtStartClock(){
  if(wtTimerId) clearInterval(wtTimerId);
  var el = document.getElementById('wtTime'), box = document.getElementById('wtTimer');
  if(box) box.classList.remove('none');
  if(el) el.textContent = mmss(wtSecs);
  wtTimerId = setInterval(function(){
    wtSecs--;
    if(wtSecs <= 0){
      wtSecs = 0;
      clearInterval(wtTimerId); wtTimerId = null;
      if(el) el.textContent = mmss(0);
      toast('Time up — submitting your paper');
      wtSubmit(true);
      return;
    }
    if(el) el.textContent = mmss(wtSecs);
    if(box) box.classList.toggle('warn', wtSecs < 300);
  }, 1000);
}
/* A written paper is not a race. There is no countdown to run, nothing to
   auto-submit, and the badge says so plainly rather than showing --:--. */
function wtNoClock(){
  if(wtTimerId !== null){ clearInterval(wtTimerId); wtTimerId = null; }
  var el = document.getElementById('wtTime'), box = document.getElementById('wtTimer');
  if(box){ box.classList.remove('warn'); box.classList.add('none'); }
  if(el) el.textContent = 'No limit';
}
function wtUnanswered(){
  var n = 0;
  if(!wtPaper) return 0;
  for(var i = 0; i < wtPaper.questions.length; i++){ if(!wtAnswered(i)) n++; }
  return n;
}
function wtSubmit(auto){
  if(!wtPaper || wtBusy) return;
  var btn = document.getElementById('wtSubmitBtn');
  var left = wtUnanswered();
  /* One warning, then the student's decision — no blocking dialog. */
  if(!auto && left && !wtArmed){
    wtArmed = true;
    if(btn) btn.textContent = 'Submit anyway';
    toast(left + ' question' + (left !== 1 ? 's' : '') + ' still unanswered — tap Submit again');
    return;
  }
  wtArmed = false;
  wtBusy = true;
  if(btn){ btn.disabled = true; btn.textContent = 'Submitting…'; }
  if(wtTimerId){ clearInterval(wtTimerId); wtTimerId = null; }
  var used = wtUntimed
    ? Math.max(0, Math.round((Date.now() - wtOpenedAt) / 1000))
    : Math.max(0, (Number(wtPaper.durationSec) || 0) - wtSecs);
  GOC.api.submitTest({ attemptId: wtPaper.attemptId, responses: wtResp, timeUsedSec: used })
    .then(function(res){
      wtBusy = false;
      if(btn){ btn.disabled = false; btn.textContent = 'Submit'; }
      wtPaper = null; wtResp = {}; wtCur = 0; wtGroups = null;
      wtShowResult(res);
      wtLoadHistory();
      refreshMe();
      renderLeague();      // Priority 12 — the standings move when the data does
    }, function(err){
      wtBusy = false;
      if(btn){ btn.disabled = false; btn.textContent = 'Submit'; }
      toast(err.message || 'Could not submit your paper');
    });
}
function wtExit(){
  if(wtTimerId){ clearInterval(wtTimerId); wtTimerId = null; }
  wtPaper = null; wtResp = {}; wtCur = 0; wtArmed = false; wtGroups = null;
  go('webtest');
  toast('Paper closed — nothing was submitted');
}

function wtOpenResult(id){
  GOC.api.myAttempt(id).then(function(res){ wtShowResult(res); },
    function(err){ toast(err.message || 'That result is not on your record'); });
}
/* Everything on this screen is read from the submitted record. Nothing here can
   change a score: the marks, the percentage and the status were all decided by
   the backend before this function ever saw them. */
function wtShowResult(r){
  if(!r) return;
  go('wtResult');
  var marked = r.status === 'marked';
  var pct = marked ? Math.round(Number(r.percent) || 0) : null;
  var set = function(id, v){ var e = document.getElementById(id); if(e) e.textContent = v; };
  set('wtrTitle', r.subject + ' · ' + wtSectionLabel(r.section));
  set('wtrSub', wtPeriodLabel() + ' · ' + wtWhen(r.submittedAt) + ' · ' + esc(r.scholarId || ''));
  var ring = document.getElementById('wtrRing');
  if(ring){
    var col = pct === null ? '#D97706' : (pct >= 70 ? '#15803D' : (pct >= 50 ? '#D97706' : '#DC2626'));
    var off = pct === null ? 402 : Math.round(402 * (1 - Math.max(0, Math.min(100, pct)) / 100));
    ring.innerHTML = '<svg width="150" height="150" viewBox="0 0 150 150" style="transform:rotate(-90deg)">'
      + '<circle cx="75" cy="75" r="64" fill="none" stroke="#EEF0F3" stroke-width="14"/>'
      + '<circle cx="75" cy="75" r="64" fill="none" stroke="' + col + '" stroke-width="14" stroke-linecap="round"'
      + ' stroke-dasharray="402" stroke-dashoffset="' + off + '"/></svg>'
      + '<div class="rt"><b>' + (pct === null ? '—' : pct + '%') + '</b><s>'
      + (marked ? (r.score + ' / ' + r.maxScore + ' marks') : 'awaiting your result') + '</s></div>';
  }
  set('wtrXp', '+' + (r.xpAwarded || 0) + ' Academy XP earned');
  var pend = document.getElementById('wtrPending');
  if(pend) pend.hidden = marked;
  wtPaintStats(r, marked, pct);
  wtPaintBreakdown(r, marked);
  wtPaintReview(r);
}
function wtPaintStats(r, marked, pct){
  var host = document.getElementById('wtrStats');
  if(!host) return;
  var rows = [
    ['Total questions', String(r.total)],
    ['Answered', String(r.answered)],
    ['Unanswered', String(r.unanswered)]
  ];
  if(r.section !== 'theory'){
    rows.push(['Correct', marked ? String(r.correct) : '—']);
    rows.push(['Incorrect', marked ? String(r.wrong) : '—']);
  }
  rows.push(['Score', marked ? (r.score + ' / ' + r.maxScore) : 'awaiting your result']);
  rows.push(['Percentage', marked ? (pct + '%') : 'awaiting your result']);
  rows.push(['Time used', mmss(r.timeUsedSec)]);
  rows.push(['Completion', r.unanswered === 0 ? 'Completed — every question attempted'
                                              : r.unanswered + ' left unanswered']);
  /* Whether the result is out, not how it was arrived at. */
  rows.push(['Result', marked ? 'Released' : 'Submitted · not released yet']);
  host.innerHTML = '';
  rows.forEach(function(pair){
    var d = document.createElement('div');
    d.className = 'wt-stat';
    d.innerHTML = '<span>' + esc(pair[0]) + '</span><b>' + esc(pair[1]) + '</b>';
    host.appendChild(d);
  });
}
function wtPaintBreakdown(r, marked){
  var wrap = document.getElementById('wtrBrkWrap'), host = document.getElementById('wtrBrk');
  var rows = (marked && r.breakdown) ? r.breakdown : [];
  if(wrap) wrap.hidden = !rows.length;
  if(!host) return;
  host.innerHTML = '';
  rows.forEach(function(b){
    /* goc-core reports 'strong' | 'developing' | 'weak'; the existing results
       screen shows those with a capital. */
    var key = String(b.band || (b.percent >= 75 ? 'strong' : (b.percent >= 50 ? 'developing' : 'weak'))).toLowerCase();
    var band = key.charAt(0).toUpperCase() + key.slice(1);
    var col = key === 'strong' ? '#15803D' : (key === 'developing' ? '#D97706' : '#DC2626');
    var bg = key === 'strong' ? '#E6F4EC' : (key === 'developing' ? '#FFF3DE' : '#FDECEC');
    var fg = key === 'strong' ? '#106b34' : (key === 'developing' ? '#9A5B00' : '#B91C1C');
    var d = document.createElement('div');
    d.className = 'brk';
    d.innerHTML = '<div class="tag" style="background:' + col + '"></div>'
      + '<div class="nm">' + esc(b.topic) + '</div>'
      + '<div class="st" style="background:' + bg + ';color:' + fg + '">' + esc(band) + '</div>';
    host.appendChild(d);
  });
}

/* A review row shows a correct answer or an explanation only when the backend
   chose to include it — which it does only for a marked paper, and only for the
   student's own submission. Nothing is unlocked here. */
function wtPaintReview(r){
  var wrap = document.getElementById('wtrReviewWrap'), host = document.getElementById('wtrReview');
  var rows = (r && r.review) || [];
  if(wrap) wrap.hidden = !rows.length;
  if(!host) return;
  host.innerHTML = '';
  rows.forEach(function(row, i){
    var card = document.createElement('div');
    card.className = 'wt-rev';
    var h = '<div class="rq">Question ' + (i + 1) + ' · ' + esc(row.topic || 'General') + '</div>'
          + '<div class="rt">' + mth(row.text, {breaks:true}) + '</div>';
    h += '<div class="ra"><em>Your answer</em>' + mth(wtGivenText(row), {breaks:true}) + '</div>';
    if(row.kind === 'objective' && row.answer !== undefined && row.answer !== null && row.options){
      h += '<div class="ra"><em>Correct answer</em>'
        + esc(OPT_KEYS[row.answer] + '. ')
        + mth(row.options[row.answer] === undefined ? '' : row.options[row.answer])
        + '</div>';
    }
    if(row.explanation){ h += '<div class="ra"><em>Why</em>' + mth(row.explanation, {breaks:true}) + '</div>'; }
    if(row.kind === 'theory'){
      h += (row.markAwarded === null || row.markAwarded === undefined)
        ? '<span class="verdict wait">Not scored yet · worth ' + (row.maxMark || 0) + '</span>'
        : '<span class="verdict ok">' + row.markAwarded + ' / ' + (row.maxMark || 0) + ' marks awarded</span>';
    } else if(row.isCorrect === true){ h += '<span class="verdict ok">Correct</span>'; }
    else if(row.isCorrect === false){ h += '<span class="verdict no">Incorrect</span>'; }
    card.innerHTML = h;
    host.appendChild(card);
  });
}
function wtGivenText(row){
  if(row.kind === 'objective'){
    if(row.given === null || row.given === undefined) return 'Not answered';
    var o = row.options && row.options[row.given] !== undefined ? '. ' + row.options[row.given] : '';
    return OPT_KEYS[row.given] + o;
  }
  return row.given ? row.given : 'Not answered';
}

/* XP, level and streak are the academy's numbers, not this page's: they are
   re-read from the account after anything that could have changed them. */
function refreshMe(){
  if(role !== 'student' || !GOC.api.myProfile) return;
  GOC.api.myProfile().then(function(me){
    var set = function(id, v){ var e = document.getElementById(id); if(e) e.textContent = v; };
    set('dashLevel', 'Lv ' + (me.level || 1));
    set('dashXp', String(me.xp || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    set('dashStreak', (me.streak || 0) + ' 🔥');
    set('dashStreakChip', '🔥 ' + (me.streak || 0));
    checkStreakCelebration(me.streak || 0);
    checkBadgeCelebrations(me);
    /* The combination is re-read here too, so a change management makes to the
       account reaches every subject-aware surface on the next refresh rather
       than waiting for the student to log out and back in. Repainting is
       skipped when nothing actually changed, because these surfaces are
       rebuilt from scratch and a needless repaint would restart the practice
       run the student is in the middle of. */
    var fresh = (me.subjects || []).map(canonSubject).filter(function(s){ return !!SUBJECT_META[s]; });
    if(fresh.length && fresh.join('|') !== (mySubjects || []).join('|')) applySubjects(fresh);
  }, function(){ /* a failed refresh must never break the screen the student is on */ });
}

/* ================= THE DASHBOARD'S OWN PANELS =================
   The home screen used to end in blank space. What fills it now is the same data
   the rest of the app is built on, re-read each time the screen is opened: the
   papers the academy has actually published for this scholar's own combination,
   their place in the league, and their most recent result. Nothing here is
   invented and nothing is decided here — an account with no record says exactly
   that, and every figure comes from GOC.api. */
function renderDash(){
  if(role !== 'student' && !previewing) return;
  dashPaintNext();
  dashPaintStanding();
  dashPaintLast();
}
function dashSet(id, html){
  var e = document.getElementById(id);
  if(e) e.innerHTML = html;
}
function dashRow(title, sub, cta){
  return '<div class="wt-row"><div class="nm"><b>' + esc(title) + '</b><span>' + esc(sub)
    + '</span></div><button class="wt-start" onclick="openWebTest()">' + esc(cta) + '</button></div>';
}
function dashStat(k, v){
  return '<div class="wt-stat"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
}
/* What is actually published for this student, in the order they would sit it. */
function dashPaintNext(){
  if(!GOC.api.listMyTests) return;
  GOC.api.listMyTests().then(function(r){
    var rows = (r && r.tests) || [];
    if(!rows.length){
      dashSet('dashNext', '<div class="wt-none">No paper has been published for your subjects yet. One will appear here the moment it is.</div>');
      return;
    }
    var thy = [], obj = null;
    rows.forEach(function(t){
      if(t.section === 'objective') obj = t;
      else if(t.section === 'theory') thy.push(t);
    });
    var h = '';
    if(obj){
      h += dashRow('Objective sitting',
        obj.questions + ' question' + (obj.questions !== 1 ? 's' : '')
        + ' · ' + wtMinutes(obj.durationSec) + ' · your whole combination', 'Sit it');
    }
    if(thy.length){
      var q = 0;
      thy.forEach(function(t){ q += Number(t.questions) || 0; });
      h += dashRow('Theory papers',
        thy.length + ' paper' + (thy.length !== 1 ? 's' : '')
        + ' · ' + q + ' question' + (q !== 1 ? 's' : '') + ' · no time limit', 'Open');
    }
    dashSet('dashNext', h || '<div class="wt-none">No paper has been published for your subjects yet.</div>');
  }, function(){
    dashSet('dashNext', '<div class="wt-none">Your papers are not available right now.</div>');
  });
}
/* The same standing the league screen shows, spelled out on the way past. */
function dashPaintStanding(){
  if(!GOC.api.league) return;
  GOC.api.league().then(function(d){
    var me = d && d.me, n = ((d && d.rows) || []).length;
    if(!me){
      dashSet('dashStand', '<div class="wt-none">You are not in the standings yet. Sit a Test and the league places you as soon as your result is out.</div>');
      return;
    }
    dashSet('dashStand',
      dashStat('Position', '#' + me.rank + ' of ' + n)
      + dashStat('League', d.league || 'Scholar League')
      + dashStat('Performance', me.assessed ? lgPct(me.performance) : 'not assessed yet')
      + dashStat('Papers counted', String(me.assessed || 0))
      + dashStat('Academy XP', lgNum(me.xp) + ' · Lv ' + (me.level || 1)));
  }, function(){
    dashSet('dashStand', '<div class="wt-none">The standings are not available right now.</div>');
  });
}
/* The most recent submission, openable straight into its own review. */
function dashPaintLast(){
  if(!GOC.api.myResults) return;
  GOC.api.myResults().then(function(r){
    var rows = (r && r.attempts) || [];
    if(!rows.length){
      dashSet('dashLast', '<div class="wt-none">You have not submitted a paper yet. Your results and their reviews appear here.</div>');
      return;
    }
    var a = rows[0];
    var marked = a.status === 'marked';
    var pct = marked ? Math.round(Number(a.percent) || 0) : null;
    var col = pct === null ? '#D97706' : (pct >= 70 ? '#15803D' : (pct >= 50 ? '#D97706' : '#DC2626'));
    dashSet('dashLast',
      '<button class="wt-his" onclick="wtOpenResult(&quot;' + esc(String(a.id)) + '&quot;)">'
      + '<span class="score" style="background:' + col + '">' + (pct === null ? '⏳' : pct + '%') + '</span>'
      + '<span class="nm"><b>' + esc(a.subject) + ' · ' + esc(wtSectionLabel(a.section)) + '</b>'
      + '<span>' + esc(wtWhen(a.submittedAt)) + ' · '
      + (marked ? (a.score + ' / ' + a.maxScore + ' marks') : 'result not released yet') + '</span></span>'
      + '<svg class="icon arr" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></button>');
  }, function(){
    dashSet('dashLast', '<div class="wt-none">Your record is not available right now.</div>');
  });
}

/* ================= THE SCHOLAR LEAGUE (Priorities 10, 11, 12) =================
   The order is decided by GOC.api.league(), which ranks on overall academic
   performance first and uses Academy XP only to separate two scholars on the
   same performance. This screen only draws what it is given — it must never
   re-sort, because a second sort here is exactly how XP would end up quietly
   outranking results. */
var leagueData = null;

function lgNum(n){
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function lgPct(v){
  var n = Number(v) || 0;
  return (Math.round(n * 10) / 10) + '%';
}
/* A steady colour per scholar, so the same face keeps the same avatar between
   visits without any of it being stored. */
var LG_TINTS = ['#DC2626,#7F1D1D', '#0E7490,#155e75', '#15803D,#106b34',
                '#D97706,#b56b00', '#4F46E5,#3730A3', '#BE185D,#831843'];
function lgTint(id){
  var s = String(id || ''), t = 0;
  for(var i = 0; i < s.length; i++) t += s.charCodeAt(i);
  return LG_TINTS[t % LG_TINTS.length];
}
function lgAvatar(r, size){
  var px = size || 36;
  return '<div class="avatar" style="width:'+px+'px;height:'+px+'px;font-size:'+(px/2.6).toFixed(0)+
    'px;background:linear-gradient(135deg,'+lgTint(r.scholarId)+')">'+esc(initials(r.name))+'</div>';
}
/* A scholar with nothing marked yet has no performance to rank on, and saying
   "0.0%" would read as a bad result rather than as an empty record. */
function lgPerfChip(r, mine){
  if(!r.assessed) return '<span class="unranked">Not yet assessed</span>';
  return '<div class="chip '+(mine ? 'red' : 'gray')+'">'+lgPct(r.performance)+'</div>';
}

function renderLeague(){
  if(role !== 'student' && !previewing) return;
  if(!GOC.api.league) return;
  return GOC.api.league().then(function(d){
    leagueData = d;
    paintLeague(d);
  }, function(){ /* a league that cannot be reached must not blank the screen */ });
}

function paintLeague(d){
  if(!d) return;
  var rows = d.rows || [];
  var set = function(x, v){ var e = document.getElementById(x); if(e) e.textContent = v; };
  set('lgTier', d.league || 'Scholar League');
  set('lgSub', 'Ranked by academic performance · XP only breaks a tie' +
    (d.scope && d.scope.cohortName ? ' · ' + d.scope.cohortName + ' cohort' : ''));
  set('lgCount', rows.length + ' scholar' + (rows.length === 1 ? '' : 's'));

  /* The podium: the top three, tallest in the middle, exactly as before — only
     the figure beneath each name is now the performance that put them there. */
  var pod = document.getElementById('lgPodium');
  if(pod){
    var top = rows.slice(0, 3);
    var order = top.length === 3 ? [top[1], top[0], top[2]] : top;
    var heights = { 1: 64, 2: 46, 3: 34 };
    var h = '';
    order.forEach(function(r){
      if(!r) return;
      var big = r.rank === 1;
      /* Same tier icon as the table rows and "my standing" card, computed the
         same way (core.leagueName(rank, size)) — settles the "should the
         podium get one too" question left open in the prior pass: yes, since
         the top 3 aren't always all Diamond (e.g. a league with <3 in it). */
      var podTier = (GOC.core && GOC.core.leagueName) ? GOC.core.leagueName(r.rank, rows.length) : null;
      h += '<div class="pod">'+
        '<span class="tier" aria-hidden="true">'+(podTier ? lgTierIcon(podTier) : '')+'</span>'+
        '<div class="av"'+(big ? ' style="width:60px;height:60px;font-size:22px"' : '')+'>'+
          esc(initials(r.name))+'</div>'+
        '<div class="nm">'+esc(r.me ? 'You' : lgFirst(r.name))+'</div>'+
        '<div class="xp">'+(r.assessed ? lgPct(r.performance) : '—')+'</div>'+
        '<div class="base" style="height:'+(heights[r.rank] || 30)+'px">'+r.rank+'</div>'+
      '</div>';
    });
    pod.innerHTML = h || '<div class="pod"><div class="nm">No standings yet</div></div>';
  }

  /* The whole table, in the order the data layer gave it. */
  var tbl = document.getElementById('lgTable');
  if(tbl){
    if(!rows.length){
      tbl.innerHTML = '<p class="lg-empty">The league opens as soon as the first paper is marked.</p>';
    } else {
      var out = '';
      rows.forEach(function(r){
        /* Same tier icon as the student's own standing card, computed per row
           via the same core.leagueName(rank, size) the server already uses
           for "mine" — each row's rank can sit in a different tier band. */
        var rowTier = (GOC.core && GOC.core.leagueName) ? GOC.core.leagueName(r.rank, rows.length) : null;
        /* Rank text stays the very first thing after class="rk"> (test-p10.js
           checks that literally) — the icon is added after in the DOM and
           moved above it visually with CSS (column-reverse), so "rank
           supplied, not row position" keeps being trivially greppable. */
        out += '<div class="lrow'+(r.me ? ' me' : '')+'">'+
          '<div class="rk">'+r.rank+'<span class="tier" aria-hidden="true">'+(rowTier ? lgTierIcon(rowTier) : '')+'</span></div>'+
          lgAvatar(r, 36)+
          '<div class="nm">'+esc(r.name)+(r.me ? '<span class="you">You</span>' : '')+
            '<em>'+lgNum(r.xp)+' XP · Lv '+(r.level || 1)+
            (r.assessed ? ' · '+r.assessed+' paper'+(r.assessed === 1 ? '' : 's')+' marked' : '')+'</em></div>'+
          lgPerfChip(r, !!r.me)+
        '</div>';
      });
      tbl.innerHTML = out;
    }
  }
  paintMyStanding(d);
}

/* The student's own position, spelled out so it is never something they have to
   find in the table (Priority 12). */
function paintMyStanding(d){
  var set = function(x, v){ var e = document.getElementById(x); if(e) e.textContent = v; };
  var me = d.me;
  set('lgMineSize', String((d.rows || []).length));
  var tierIcon = document.getElementById('lgMineTierIcon');
  if(!me){
    set('lgMineRank', '—');
    set('lgMineName', 'You are not in the standings yet');
    set('lgMineNote', 'Sit a Web Test and the league will place you as soon as it is marked.');
    ['lgMinePerf','lgMineXp','lgMineStreak','lgMineLvl'].forEach(function(x){ set(x, '—'); });
    if(tierIcon) tierIcon.textContent = '';
    return;
  }
  if(tierIcon) tierIcon.textContent = lgTierIcon(d.league);
  set('lgMineRank', '#' + me.rank);
  set('lgMineName', me.name + ' · ' + (d.league || 'Scholar League'));
  set('lgMineNote', me.assessed
    ? 'Position ' + me.rank + ' of ' + (d.rows || []).length + ', decided by your performance across '
      + me.assessed + ' marked paper' + (me.assessed === 1 ? '' : 's') + '. XP only separates scholars who perform equally.'
    : 'You are placed by XP for now. Your position becomes a performance one as soon as your first paper is marked.');
  set('lgMinePerf', me.assessed ? lgPct(me.performance) : '—');
  set('lgMineXp', lgNum(me.xp));
  set('lgMineStreak', String(me.streak || 0));
  set('lgMineLvl', 'Lv ' + (me.level || 1));
}
function lgFirst(n){
  var p = String(n || '').trim().split(/\s+/);
  return p[0] || 'Scholar';
}
/* Task 5 (first slice): a precious-stone icon above the student's own rank,
   keyed off the same tier name core.leagueName() already computes (d.league,
   e.g. "Diamond League") — no new tiering logic, just a face for the one
   that exists. Rest of Task 5 (toast sweep) is separate and untouched. */
var LG_TIER_ICONS = { 'Diamond League':'💎', 'Gold League':'🥇', 'Silver League':'🥈', 'Bronze League':'🥉' };
function lgTierIcon(leagueName){
  return LG_TIER_ICONS[leagueName] || '🏅';
}


/* ================= CBT =================
   One CBT screen serves two callers: the practice mock reachable from Study,
   and the JAMB-oriented Web Test session (Priority 3). `cbtPaper` decides which
   — null means the mock, a paper from GOC.api.startTest means a real, marked
   sitting. The screen itself, its numbering, its navigation panel, its timer and
   its submit bar are the existing ones. */
var cbtN=40, cbtCur=0, cbtAns={}, cbtSecs=1798, cbtTimerId=null;
/* The CBT screen serves two kinds of paper, and never a demo one: a real
   JAMB-oriented Web Test sitting (cbtPaper) and a student-configured study run
   (cbtStudy). Both come from the backend with their answers stripped out; what
   differs is where the submission goes and whether it counts. */
var cbtPaper = null;
var cbtStudy = null;

/* A student-configured run: their subject, their topics, their clock. Marked at
   submit like an exam, but filed nowhere — see the study section above. */
function cbtOpenStudy(p){
  cbtPaper = null;
  cbtStudy = p;
  cbtCur = 0; cbtAns = {};
  cbtN = p.questions.length;
  cbtSecs = Number(p.durationSec) || 600;
  go('cbt'); paintCBTHead(); buildCBTNav(); renderCBTQ(); startTimer();
}
/* The JAMB-oriented session: same screen, real questions, real clock, real
   marking. Answers were stripped by the backend before they reached us. */
function cbtOpenPaper(p){
  cbtPaper = p;
  cbtStudy = null;
  cbtCur = 0; cbtAns = {};
  cbtN = p.questions.length;
  cbtSecs = Number(p.durationSec) || 1800;
  go('cbt'); paintCBTHead(); buildCBTNav(); renderCBTQ(); startTimer();
}
function paintCBTHead(){
  var t = document.getElementById('cbtTitle'), m = document.getElementById('cbtMeta');
  if(cbtPaper){
    if(t) t.textContent = cbtPaper.subject + ' · JAMB-oriented';
    if(m) m.textContent = wtPeriodLabel() + ' · ' + cbtN
      + ' question' + (cbtN !== 1 ? 's' : '') + ' · ' + wtMinutes(cbtPaper.durationSec);
  } else if(cbtStudy){
    /* The header names the paper and the topics the student chose, so the run
       reads as theirs — and says plainly that it is a practice CBT. */
    var tps = [];
    cbtStudy.questions.forEach(function(q){ if(q.topic && tps.indexOf(q.topic) < 0) tps.push(q.topic); });
    if(t) t.textContent = cbtStudy.subject + ' · CBT set-up';
    if(m) m.textContent = cbtN + ' question' + (cbtN !== 1 ? 's' : '') + ' · ' +
      wtMinutes(cbtStudy.durationSec) + (tps.length ? ' · ' + tps.join(' · ') : '');
  }
  var el = document.getElementById('cbtTime');
  if(el) el.textContent = mmss(cbtSecs);
}
function cbtQuestionAt(i){
  var p = cbtPaper || cbtStudy;
  return p ? p.questions[i] : null;
}
function startTimer(){
  if(cbtTimerId) clearInterval(cbtTimerId);
  cbtTimerId=setInterval(function(){
    cbtSecs--; if(cbtSecs<0){ cbtSecs=0; clearInterval(cbtTimerId); cbtTimerId=null; submitCBT(true); return; }
    var m=Math.floor(cbtSecs/60), s=cbtSecs%60;
    var el = document.getElementById('cbtTime');
    if(el) el.textContent = (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
    var box = document.getElementById('cbtTimer');
    if(box) box.classList.toggle('warn', cbtSecs<300);
  },1000);
}
function buildCBTNav(){
  var nav=document.getElementById('cbtNav'); nav.innerHTML='';
  for(var i=0;i<cbtN;i++){
    (function(i){
      var b=document.createElement('button');
      b.className='qn'+(i===cbtCur?' cur':'')+(cbtAns[i]!=null?' ans':'');
      b.textContent=i+1;
      b.onclick=function(){ cbtCur=i; renderCBTQ(); buildCBTNav(); };
      nav.appendChild(b);
    })(i);
  }
}
function renderCBTQ(){
  var d = cbtQuestionAt(cbtCur) || { text:'', options:[] };
  document.getElementById('cbtNum').textContent='Question '+(cbtCur+1)+' of '+cbtN;
  document.getElementById('cbtQ').innerHTML = mth(d.text || d.q || '', {breaks:true});
  var host=document.getElementById('cbtOpts'); host.innerHTML='';
  (d.options || d.opts || []).forEach(function(o,i){
    var b=document.createElement('button');
    b.className='opt'+(cbtAns[cbtCur]===i?' sel':'');
    b.innerHTML='<span class="key">'+OPT_KEYS[i]+'</span>'+mth(o);
    b.onclick=function(){ cbtAns[cbtCur]=i; renderCBTQ(); buildCBTNav(); };
    host.appendChild(b);
  });
}
function cbtMove(d){
  cbtCur=Math.max(0,Math.min(cbtN-1,cbtCur+d));
  renderCBTQ(); buildCBTNav();
}
function confirmExit(){
  if(cbtTimerId){ clearInterval(cbtTimerId); cbtTimerId = null; }
  if(cbtPaper){ cbtPaper = null; cbtAns = {}; go('webtest'); toast('Paper closed — nothing was submitted'); return; }
  /* Leaving a study run submits nothing: it was never an attempt, so there is
     nothing to abandon. The set-up screen is where they came from. */
  if(cbtStudy){ cbtStudy = null; cbtAns = {}; go('studySet'); renderStudySet(); return; }
  go('study');
}
function submitCBT(auto){
  if(cbtTimerId){ clearInterval(cbtTimerId); cbtTimerId = null; }
  if(!cbtPaper && cbtStudy){
    /* A study run is still marked properly by the backend — the student sees a
       real score and a full review — it just is not filed against the record. */
    var sres = {}, k;
    for(k=0;k<cbtStudy.questions.length;k++){
      if(cbtAns[k] != null) sres[cbtStudy.questions[k].id] = cbtAns[k];
    }
    var sused = Math.max(0, (Number(cbtStudy.durationSec)||0) - cbtSecs);
    var run = cbtStudy;
    cbtStudy = null;
    toast(auto ? 'Time up — marking your run' : 'Marking your run…');
    GOC.api.submitStudy({ paperId: run.paperId, responses: sres, timeUsedSec: sused })
      .then(function(res){ srShow(res); refreshMe(); /* the streak may have moved even though XP didn't */ },
        function(err){ cbtStudy = run; toast(err.message || 'Could not mark that run'); });
    return;
  }
  if(!cbtPaper) return;
  /* A real sitting: the responses go to the backend, which marks them and
     stores the result against this student's Scholar ID. */
  var responses = {}, i;
  for(i=0;i<cbtPaper.questions.length;i++){
    if(cbtAns[i] != null) responses[cbtPaper.questions[i].id] = cbtAns[i];
  }
  var used = Math.max(0, (Number(cbtPaper.durationSec)||0) - cbtSecs);
  var paper = cbtPaper;
  cbtPaper = null;
  toast(auto ? 'Time up — submitting your paper' : 'Submitting your paper…');
  GOC.api.submitTest({ attemptId: paper.attemptId, responses: responses, timeUsedSec: used })
    .then(function(res){ wtShowResult(res); wtLoadHistory(); refreshMe(); renderLeague(); },
      function(err){ cbtPaper = paper; toast(err.message || 'Could not submit your paper'); });
}

/* ================= RESULTS & REVIEW =================
   Driven entirely by the student's own marked papers. The screen used to show a
   fixed 78% over four Chemistry topics, which was somebody else's result — and
   worse, said nothing about which kind of test produced it. Now every figure is
   the student's, and the record is read the way the academy assesses: by the
   type of paper sat. Objective, theory and JAMB-oriented are marked, weighted
   and reported separately, because they measure different things. */
var rsData = null;          /* the last {attempts, performance} we were given */
var rsFilter = 'all';       /* 'all' | 'objective' | 'theory' | 'jamb' */
var RS_SECTIONS = ['objective', 'theory', 'jamb'];

function openResults(){
  go('results');
  var list = document.getElementById('rsList');
  if(list) list.innerHTML = '<div class="wt-none">Loading your record…</div>';
  GOC.api.myResults().then(function(d){
    rsData = d;
    renderResults();
  }, function(err){
    rsData = null;
    if(list) list.innerHTML = '<div class="wt-none">' + esc(err.message || 'Could not load your results') + '</div>';
  });
}
function rsSetFilter(s){ rsFilter = s; renderResults(); }
/* Only the papers of the type currently being looked at. */
function rsRows(){
  var rows = (rsData && rsData.attempts) || [];
  if(rsFilter === 'all') return rows;
  return rows.filter(function(a){ return rsSectionOf(a) === rsFilter; });
}
function rsSectionOf(a){
  return a.section === 'jamb' ? 'jamb' : (a.section === 'theory' ? 'theory' : 'objective');
}
function renderResults(){
  var perf = (rsData && rsData.performance) || null;
  var rows = rsRows();
  var all = (rsData && rsData.attempts) || [];
  var marked = rows.filter(function(a){ return a.status === 'marked' && typeof a.percent === 'number'; });

  /* The ring shows the figure that belongs to the filter: the weighted overall
     performance when looking at everything, the average for that one type of
     paper when looking at one. */
  var pct = null;
  if(rsFilter === 'all') pct = perf && perf.hasData ? Math.round(perf.overall) : null;
  else if(perf && perf.bySection && perf.bySection[rsFilter] != null) pct = Math.round(perf.bySection[rsFilter]);
  var ring = document.getElementById('rsRing');
  if(ring){
    var col = pct === null ? '#8A93A0' : (pct >= 70 ? '#15803D' : (pct >= 50 ? '#D97706' : '#DC2626'));
    var off = pct === null ? 402 : Math.round(402 * (1 - Math.max(0, Math.min(100, pct)) / 100));
    ring.innerHTML = '<svg width="150" height="150" viewBox="0 0 150 150" style="transform:rotate(-90deg)">'
      + '<circle cx="75" cy="75" r="64" fill="none" stroke="#EEF0F3" stroke-width="14"/>'
      + '<circle cx="75" cy="75" r="64" fill="none" stroke="' + col + '" stroke-width="14" stroke-linecap="round"'
      + ' stroke-dasharray="402" stroke-dashoffset="' + off + '"/></svg>'
      + '<div class="rt"><b>' + (pct === null ? '—' : pct + '%') + '</b><s>'
      + (pct === null ? 'no marked paper yet'
          : marked.length + ' marked paper' + (marked.length === 1 ? '' : 's')) + '</s></div>';
  }
  var sub = document.getElementById('rsSub');
  if(sub){
    sub.textContent = rsFilter === 'all'
      ? 'Weighted across every session you have sat'
      : wtSectionLabel(rsFilter) + ' papers only';
  }
  var xp = document.getElementById('rsXp');
  if(xp){
    var gained = 0;
    all.forEach(function(a){ gained += Number(a.xpAwarded) || 0; });
    xp.textContent = gained ? '+' + gained + ' Academy XP from your papers'
                            : 'Sit a paper to earn Academy XP';
  }
  rsPaintSections(perf);
  rsPaintFilter(all);
  rsPaintList(rows);
  rsPaintTopics(marked);
}
/* One card per session, with the weight it carries in the overall figure,
   so a student can see why their overall sits where it does. */
function rsPaintSections(perf){
  var host = document.getElementById('rsSections');
  if(!host) return;
  var all = (rsData && rsData.attempts) || [];
  host.innerHTML = RS_SECTIONS.map(function(s){
    var sat = all.filter(function(a){ return rsSectionOf(a) === s; });
    var done = sat.filter(function(a){ return a.status === 'marked' && typeof a.percent === 'number'; });
    var waiting = sat.length - done.length;
    var avg = perf && perf.bySection && perf.bySection[s] != null ? Math.round(perf.bySection[s]) : null;
    var weight = perf && perf.weights ? perf.weights[s] : null;
    var col = avg === null ? '#8A93A0' : (avg >= 70 ? '#15803D' : (avg >= 50 ? '#D97706' : '#DC2626'));
    var note = !sat.length ? 'Not sat yet'
      : done.length + ' scored' + (waiting ? ' · ' + waiting + ' not released yet' : '');
    return '<div class="rs-sec" onclick="rsSetFilter(&quot;' + s + '&quot;)">' +
      '<div class="rs-pct" style="background:' + hexA(col) + ';color:' + col + '">' +
        (avg === null ? '—' : avg + '%') + '</div>' +
      '<div class="rs-body"><h4>' + esc(wtSectionLabel(s)) + '</h4><p>' + esc(note) + '</p></div>' +
      (weight ? '<span class="rs-w">' + weight + '% of overall</span>' : '') +
      '</div>';
  }).join('');
}
function rsPaintFilter(all){
  var host = document.getElementById('rsFilter');
  if(!host) return;
  var chips = [['all', 'All papers']];
  RS_SECTIONS.forEach(function(s){ chips.push([s, wtSectionLabel(s)]); });
  host.innerHTML = chips.map(function(c){
    var n = c[0] === 'all' ? all.length
      : all.filter(function(a){ return rsSectionOf(a) === c[0]; }).length;
    return '<button class="fchip' + (rsFilter === c[0] ? ' on' : '') + '" data-f="' + c[0] +
      '" onclick="rsSetFilter(&quot;' + c[0] + '&quot;)">' + esc(c[1]) + ' (' + n + ')</button>';
  }).join('');
}
/* Every sitting of the chosen type, newest first, each one openable so the
   review a student reads is the review of that exact paper. */
function rsPaintList(rows){
  var host = document.getElementById('rsList');
  if(!host) return;
  if(!rows.length){
    host.innerHTML = '<div class="wt-none">' + (rsFilter === 'all'
      ? 'You have not sat a Web Test yet. Your papers and their reviews appear here.'
      : 'No ' + wtSectionLabel(rsFilter) + ' paper yet.') + '</div>';
    return;
  }
  host.innerHTML = rows.map(function(a){
    var mk = a.status === 'marked' && typeof a.percent === 'number';
    var p = mk ? Math.round(a.percent) : null;
    var col = !mk ? '#D97706' : (p >= 70 ? '#15803D' : (p >= 50 ? '#D97706' : '#DC2626'));
    return '<button class="wt-his" onclick="rsOpen(&quot;' + esc(String(a.id)) + '&quot;)">' +
      '<span class="rs-pct sm" style="background:' + hexA(col) + ';color:' + col + '">' +
        (mk ? p + '%' : '⏳') + '</span>' +
      '<span class="rs-body"><h4>' + esc(a.subject) + ' · ' + esc(wtSectionLabel(a.section)) + '</h4>' +
      '<p>' + esc(wtPeriodLabel()) + ' · ' + esc(wtWhen(a.submittedAt)) +
      (mk ? ' · ' + a.correct + ' of ' + a.total + ' correct' : ' · result not released yet') + '</p></span>' +
      '</button>';
  }).join('');
}
/* The topic breakdown is only as honest as the papers behind it, so it is drawn
   from the scored papers of the session being looked at — never from a fixed list. */
function rsPaintTopics(marked){
  var brk = document.getElementById('rsBrk');
  var focus = document.getElementById('rsFocus');
  if(!brk) return;
  if(!marked.length){
    brk.innerHTML = '<div class="wt-none">A topic breakdown appears once a paper from this session has a released result.</div>';
    if(focus) focus.hidden = true;
    return;
  }
  brk.innerHTML = '<div class="ad-loading">Reading your marked papers…</div>';
  /* Each paper's own answers carry the topics, so the breakdown is assembled
     from the papers themselves rather than from a running total nobody can check. */
  var want = marked.slice(0, 8);
  Promise.all(want.map(function(a){
    return GOC.api.myAttempt(a.id).then(function(r){ return r; }, function(){ return null; });
  })).then(function(list){
    var answers = [];
    list.forEach(function(r){
      if(!r || !r.review) return;
      answers = answers.concat(r.review.map(function(x){
        return { topic: x.topic,
          markAwarded: Number(x.markAwarded) || 0,
          maxMark: Number(x.maxMark) || 1 };
      }));
    });
    var bands = GOC.api.rules.topicBreakdown(answers);
    brk.innerHTML = bands.length ? bands.map(function(x){
      var col = x.band === 'strong' ? '#15803D' : x.band === 'developing' ? '#E08600' : '#DC2626';
      return '<div class="brk"><span class="tag" style="background:' + col + '"></span>' +
        '<span class="nm">' + esc(x.topic) + '</span>' +
        '<span class="st" style="background:' + hexA(col) + ';color:' + col + '">' +
        x.percent + '% · ' + esc(x.band.charAt(0).toUpperCase() + x.band.slice(1)) + '</span></div>';
    }).join('') : '<div class="wt-none">No topics were recorded against these papers.</div>';
    if(focus){
      var weak = bands.filter(function(x){ return x.band !== 'strong'; })[0];
      focus.hidden = !weak;
      if(weak){
        focus.innerHTML = '🎯 <b>Focus next:</b> ' + esc(weak.topic) + ' is your weakest topic at ' +
          weak.percent + '%. Practice is untimed and marks you as you answer.';
      }
    }
  });
}
/* Opening one paper's review. The backend decides what a student may see — an
   unmarked theory paper still shows no marks and no model answer. */
function rsOpen(id){
  GOC.api.myAttempt(id).then(function(r){ wtShowResult(r); },
    function(err){ toast(err.message || 'Could not open that paper'); });
}

/* ================= CLASSES / VIDEOS =================
   No hardcoded demo rows here on purpose — this list is only ever filled by
   loadPublishedVideos() (below), reading real published video records from
   the server. An empty array is the honest state before that call resolves
   or if the academy hasn't published anything yet; renderClasses() already
   shows the right "Nothing yet" message for an empty list on its own. */
var videos = [];
var classFilter = 'all';
var publishedVideosLoaded = false;

/* Real video records don't carry their own thumbnail gradient the way the
   old hardcoded demo rows did, so map the canonical subject onto one —
   reusing the same brand colour per subject as SUBJECT_META, paired with a
   slightly darker second stop. Unknown/blank subjects fall back to grey. */
var VIDEO_GRADIENTS = {
  'Use of English': ['#4F46E5', '#3730A3'],
  'Physics':        ['#DC2626', '#7F1D1D'],
  'Chemistry':      ['#0E7490', '#155e75'],
  'Biology':        ['#15803D', '#106b34'],
  'Mathematics':    ['#7F1D1D', '#5E1212']
};
var VIDEO_GRADIENT_FALLBACK = ['#475467', '#344054'];

function videoGradient(subj){
  return VIDEO_GRADIENTS[canonSubject(subj)] || VIDEO_GRADIENT_FALLBACK;
}

function setClassFilter(f){ classFilter = f; renderClasses(); }

/* This is the one function that was missing end to end: the admin console
   could already publish a video, but nothing on the student side ever
   asked the server for the published list — the screen only ever showed
   the fixed demo rows above (now removed). This mirrors
   loadPublishedResources() function-for-function. */
function loadPublishedVideos(){
  if(!GOC.api || !GOC.api.listPublishedVideos) return;

  GOC.api.listPublishedVideos().then(function(result){
    var items = result && Array.isArray(result.videos) ? result.videos : [];
    publishedVideosLoaded = true;

    /* Convert Appwrite video records into the {type, subj, title, tutor,
       dur, date, c1, c2, videoId, storageFileId, externalUrl} shape the
       existing renderClasses() / videoCard() functions already expect. */
    videos = items.map(function(v){
      var subj = canonSubject(v.subject || '');
      var grad = videoGradient(subj);
      var type = v.type === 'live' ? 'live' : 'lesson';

      var when = '';
      if(v.createdAt){
        var d = new Date(v.createdAt);
        if(!isNaN(d.getTime())){
          when = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
        }
      }
      var date = when
        ? (type === 'live' ? ('Recorded ' + when) : ('Added ' + when))
        : (type === 'live' ? 'Recorded class' : 'Lesson video');

      return {
        type: type,
        subj: subj,
        title: v.title || 'Untitled video',
        tutor: v.tutor || '',
        dur: v.duration || '',
        date: date,
        c1: grad[0],
        c2: grad[1],
        videoId: v.videoId || '',
        storageFileId: v.storageFileId || '',
        externalUrl: v.externalUrl || ''
      };
    });

    renderClasses();

  }, function(err){
    console.warn('[goc] Could not load published videos:', err && err.message);
    publishedVideosLoaded = false;
    videos = [];
    renderClasses();
  });
}
function renderClasses(){
  var cs = document.getElementById('classFilters');
  if(cs){ cs.querySelectorAll('.fchip').forEach(function(ch){ var on = ch.getAttribute('data-f') === classFilter; ch.classList.toggle('on', on); ch.setAttribute('aria-pressed', String(on)); }); }
  var live = document.getElementById('liveList'), les = document.getElementById('lessonList');
  if(!live || !les) return;
  live.innerHTML = ''; les.innerHTML = '';
  var liveN = 0, lesN = 0;
  videos.forEach(function(v){
    var subj = canonSubject(v.subj);
    // A recording for a paper the student does not sit is not on their shelf.
    if(!studiesSubject(subj)) return;
    if(classFilter !== 'all' && subj !== canonSubject(classFilter)) return;
    if(v.type === 'live'){ live.appendChild(videoCard(v)); liveN++; }
    else { les.appendChild(videoCard(v)); lesN++; }
  });
  document.getElementById('liveEmpty').style.display = liveN ? 'none' : 'block';
  document.getElementById('lessonEmpty').style.display = lesN ? 'none' : 'block';
  /* Say which papers were looked in. An empty shelf is otherwise ambiguous: the
     student cannot tell whether nothing has been published for their
     combination or whether the app has forgotten what they sit. */
  var scope = classFilter === 'all' ? orderedSubjects().join(', ') : canonSubject(classFilter);
  var le = document.getElementById('liveEmpty'), se = document.getElementById('lessonEmpty');
  if(le) le.textContent = 'No live classes yet for ' + scope + '.';
  if(se) se.textContent = 'No lesson videos yet for ' + scope + '.';
}
function videoCard(v){
  var b = document.createElement('button');
  b.className = 'vcard';
  var badge = v.type === 'live'
    ? '<span class="vbadge live"><svg width="7" height="7" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#fff"/></svg>Live replay</span>'
    : '<span class="vbadge">Lesson</span>';
  b.innerHTML =
    '<div class="vthumb" style="background:linear-gradient(135deg,' + v.c1 + ',' + v.c2 + ')">' +
      badge +
      '<span class="vplay"><svg class="icon" viewBox="0 0 24 24" fill="#DC2626"><path d="M8 5v14l11-7z"/></svg></span>' +
      '<span class="vdur">' + esc(v.dur) + '</span>' +
    '</div>' +
    '<div class="vmeta">' +
      '<span class="vtag" style="background:' + hexA(v.c1) + ';color:' + v.c1 + '">' + esc(v.subj) + '</span>' +
      '<h4>' + esc(v.title) + '</h4>' +
      '<p>' + esc(v.tutor) + ' · ' + esc(v.date) + '</p>' +
    '</div>';
  b.onclick = function(){ playVideo(v); };
  return b;
}
function playVideo(v){
  /* External links (Zoom cloud / unlisted YouTube) are never embedded
     inline — hand off to the browser/app that already knows how to play
     them. File-backed videos stream through the same overlay viewer the
     video-type resources already use, so no new player UI is needed. */
  if(v.externalUrl){
    window.open(v.externalUrl, '_blank');
    return;
  }

  if(v.storageFileId){
    toast('Opening “' + v.title + '”…');
    GOC.api.getVideoFile(v.videoId).then(function(blob){
      openResourceMediaViewer(blob, v.title, 'video', 'mp4');
    }, function(err){
      toast(err.message || 'Could not open this video.');
    });
    return;
  }

  toast('This video has no file or link attached.');
}

/* ================= RESOURCES ================= */
/* `subj` is what personalisation reads. 'all' means the item belongs to every
   combination (a syllabus, a reading list) and is always shown. */
var resources = [];
var resFilter = 'all';
var publishedResources = [];
var publishedResourcesLoaded = false;


/* Only these can actually be shown inside the app (an iframe, an <img>, or
   a <video> tag). Word/Excel/zip files have no in-browser renderer, so for
   those "open" and "download" both just save the file — there is no third
   option a browser can offer without a plugin. */
function resourceViewerKind(ext){
  ext = String(ext || '').toLowerCase();
  if(ext === 'pdf') return 'pdf';
  if(ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif') return 'image';
  if(ext === 'mp4') return 'video';
  return null;
}

function resourceFileName(title, ext){
  var base = String(title || 'resource')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  if(!base) base = 'resource';
  return base + '.' + String(ext || 'file').toLowerCase();
}

/* Builds a CSV of the roster, respecting whichever Students filter (All /
   Active / Deactivated) is currently selected — an admin who filtered to
   Deactivated before pressing Export almost certainly wants a
   deactivated-only file, not the whole roster. No password column: Reveal
   and Reset already handle credentials one scholar at a time, on purpose. */
function admExportStudents(){
  var rows = studentsData.filter(function(s){
    if(admStuFilter === 'active') return s.active !== false;
    if(admStuFilter === 'closed') return s.active === false;
    return true;
  });
  function csvCell(v){
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var header = ['Scholar ID', 'Name', 'Status', 'XP', 'Level', 'Overall performance (%)'];
  var lines = [header.join(',')];
  rows.forEach(function(s){
    var open = s.active !== false;
    lines.push([
      csvCell(s.id),
      csvCell(s.name),
      csvCell(open ? 'Active' : 'Deactivated'),
      csvCell(s.xp || 0),
      csvCell(s.level || 1),
      csvCell(s.performance || 0)
    ].join(','));
  });
  var blob = new Blob([lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
  var date = new Date().toISOString().slice(0, 10);
  downloadResourceBlob(blob, 'goc-students-' + admStuFilter + '-' + date, 'csv');
  toast('Exported ' + rows.length + ' student' + (rows.length === 1 ? '' : 's'));
}

/* ===== Add student (admin-side enrolment) =====
   Mirrors the public sign-up form's subject picker, but runs against its own
   element IDs (both screens exist in the same DOM at once, so the public
   #subjGrid / #subjToggle helpers can't be reused directly without one form
   stomping on the other). Exam is fixed to UTME, the only value
   core.requireExam accepts today, so no exam picker is shown. */
var admAddStuOpen = false;
function admAddStuScienceBoxes(){ return list(document.querySelectorAll('#admAddSubjGrid input[type=checkbox]')); }
function admAddStuChosenSciences(){
  var out = [];
  admAddStuScienceBoxes().forEach(function(c){ if(c.checked) out.push(c.getAttribute('data-subject')); });
  return out;
}
function admAddStuToggle(box){
  if(box.checked && admAddStuChosenSciences().length > 3){
    box.checked = false;
    admAddStuPaint('That would be five papers. Untick a science first, then pick this one.');
    return;
  }
  admAddStuPaint('');
}
function admAddStuPaint(msg){
  var picked = admAddStuChosenSciences();
  admAddStuScienceBoxes().forEach(function(c){
    var lbl = c.parentNode;
    if(lbl && lbl.classList) lbl.classList.toggle('on', c.checked);
  });
  var cnt = document.getElementById('admAddSubjCount');
  if(cnt){
    cnt.textContent = picked.length + ' of 3 sciences chosen' + (picked.length === 3 ? ' · 4 papers in all' : '');
    cnt.classList.toggle('done', picked.length === 3);
  }
  var m = document.getElementById('admAddSubjMsg');
  if(m) m.textContent = msg || '';
}
function admAddStudentFormHTML(){
  var r = rulebook();
  var english = r ? r.ENGLISH : 'Use of English';
  return '<div class="ad-card">'+
    '<div class="ad-h">Add student</div>'+
    '<p class="ad-p">Enrol a scholar in person. A Scholar ID and temporary password are issued automatically — the student sets their own password on first login.</p>'+
    '<div class="field"><label for="admAddName">Full name</label><input type="text" id="admAddName" placeholder="e.g. Ada Obi"></div>'+
    '<div class="auth-row">'+
      '<div class="field"><label for="admAddEmail">Email</label><input type="email" id="admAddEmail" placeholder="you@example.com"></div>'+
      '<div class="field"><label for="admAddPhone">Phone</label><input type="tel" id="admAddPhone" placeholder="0801 234 5678"></div>'+
    '</div>'+
    '<div class="field"><label>Preparing for</label><div class="ad-p" style="margin:0">UTME (JAMB) — the only programme this academy runs.</div></div>'+
    '<div class="field subj-pick" id="admAddSubjPick">'+
      '<label id="admAddSubjLabel">JAMB subject combination</label>'+
      '<p class="field-hint" style="margin-top:0;margin-bottom:10px">'+esc(english)+' is compulsory. Choose <b>exactly three</b> of the four sciences.</p>'+
      '<div class="subj-opt locked"><span class="so-box on" aria-hidden="true">✓</span><span class="so-name">'+esc(english)+'</span><span class="so-tag">Compulsory</span></div>'+
      '<div class="subj-grid" id="admAddSubjGrid" role="group" aria-labelledby="admAddSubjLabel">'+
        '<label class="subj-opt"><input type="checkbox" data-subject="Physics" onchange="admAddStuToggle(this)"><span class="so-box" aria-hidden="true">✓</span><span class="so-name">Physics</span></label>'+
        '<label class="subj-opt"><input type="checkbox" data-subject="Chemistry" onchange="admAddStuToggle(this)"><span class="so-box" aria-hidden="true">✓</span><span class="so-name">Chemistry</span></label>'+
        '<label class="subj-opt"><input type="checkbox" data-subject="Biology" onchange="admAddStuToggle(this)"><span class="so-box" aria-hidden="true">✓</span><span class="so-name">Biology</span></label>'+
        '<label class="subj-opt"><input type="checkbox" data-subject="Mathematics" onchange="admAddStuToggle(this)"><span class="so-box" aria-hidden="true">✓</span><span class="so-name">Mathematics</span></label>'+
      '</div>'+
      '<div class="subj-foot"><span class="subj-count" id="admAddSubjCount">0 of 3 sciences chosen</span><span class="subj-msg" id="admAddSubjMsg" role="status" aria-live="polite"></span></div>'+
    '</div>'+
    '<div id="admAddStuResult"></div>'+
    '<div class="ad-actions"><button class="ad-btn pri" id="admAddStuBtn" onclick="admSubmitAddStudent()">Create account</button><button class="ad-btn" onclick="admToggleAddStudent()">Cancel</button></div>'+
  '</div>';
}
function admToggleAddStudent(){
  var w = document.getElementById('admAddStudentWrap');
  if(!w) return;
  admAddStuOpen = !admAddStuOpen;
  w.innerHTML = admAddStuOpen ? admAddStudentFormHTML() : '';
}
function admSubmitAddStudent(){
  var name = admVal('admAddName').trim();
  var email = admVal('admAddEmail').trim();
  var phone = admVal('admAddPhone').trim();
  var r = rulebook();
  var english = r ? r.ENGLISH : 'Use of English';
  var combo = [english].concat(admAddStuChosenSciences());
  var check = r ? r.validateSubjects(combo) : { ok: true, subjects: combo };
  if(name.length < 2){
    toast('Enter the student\'s full name.');
    return;
  }
  if(!check.ok){
    admAddStuPaint(check.error);
    toast(check.error);
    return;
  }
  var btn = document.getElementById('admAddStuBtn');
  busy(btn, true);
  GOC.api.addStudent({name: name, email: email, phone: phone, goal: 'JAMB / UTME 2027', subjects: check.subjects}).then(function(r2){
    busy(btn, false);
    var out = document.getElementById('admAddStuResult');
    if(out){
      out.innerHTML = '<div class="ad-card" style="margin-top:10px">'+
        '<div class="ad-h">Account created</div>'+
        '<div class="ac-grid">'+
          '<div class="ac-cell"><label>Scholar ID</label><code>'+esc(r2.student.id)+'</code></div>'+
          '<div class="ac-cell"><label>Temporary password</label><code>'+esc(r2.temporaryPassword)+'</code></div>'+
        '</div>'+
        '<p class="ad-note">Give these to the student directly — they will be asked to set their own password on first login. This card will disappear once you close this form.</p>'+
      '</div>';
    }
    admClear(['admAddName','admAddEmail','admAddPhone']);
    loadStudents();
    toast('Scholar ID '+r2.student.id+' created');
  }).catch(function(err){
    busy(btn, false);
    toast(err.message || 'Could not create that account');
  });
}

/* Forces a real save-to-device, regardless of what the browser would
   otherwise do with this file type — this is what the visible "download"
   affordance actually needs to do, as opposed to the old decorative icon
   that did nothing of the sort. */
function downloadResourceBlob(blob, title, ext){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = resourceFileName(title, ext);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}

/* The <object>/<iframe> approach relied on the browser having its own
   built-in PDF plugin wired into embedded content. Desktop Chrome/Firefox
   have that; mobile Chrome — confirmed by testing — does not, even
   though it renders PDFs fine as a full-page navigation. There is no
   webview-safe way to lean on a native renderer here, so we ship our
   own: pdf.js (vendored locally under js/vendor/pdfjs/, no CDN, works
   offline) draws each page onto a <canvas>, which works identically on
   any browser or webview with basic Canvas2D support — no plugin needed. */
function pdfjsAssetUrl(file){
  var scripts = document.getElementsByTagName('script');
  var appScript = null;
  for(var i = 0; i < scripts.length; i++){
    if(/app\.js(\?|#|$)/.test(scripts[i].src)){ appScript = scripts[i]; break; }
  }
  var base = appScript ? appScript.src : document.baseURI;
  return new URL('vendor/pdfjs/' + file, base).href;
}

function openResourceMediaViewer(blob, title, kind, ext){
  var old = document.getElementById('gocPdfViewer');
  if(old) old.remove();

  var url = (kind !== 'pdf') ? URL.createObjectURL(blob) : null;
  var settled = false; // true once we know the preview rendered (or we've already shown the fallback)

  var overlay = document.createElement('div');
  overlay.id = 'gocPdfViewer';
  overlay.className = 'goc-viewer';
  overlay.style.cssText =
    'position:fixed;inset:0;height:100vh;height:100dvh;z-index:99999;background:#111;display:flex;flex-direction:column;';

  var body;
  if(kind === 'image'){
    body = '<div class="goc-viewer-stage" style="flex:1;min-height:0;background:#333;display:flex;align-items:center;justify-content:center;overflow:auto;">' +
      '<img id="gocPdfFrame" alt="' + esc(title || 'Resource image') + '" style="max-width:100%;max-height:100%;object-fit:contain;">' +
    '</div>';
  } else if(kind === 'video'){
    body = '<div class="goc-viewer-stage" style="flex:1;min-height:0;background:#000;display:flex;align-items:center;justify-content:center;">' +
      '<video id="gocPdfFrame" controls autoplay style="max-width:100%;max-height:100%;"></video>' +
    '</div>';
  } else {
    body = '<div id="gocPdfCanvasWrap" class="goc-viewer-stage" style="flex:1;min-height:0;background:#3a3b3e;overflow:auto;display:flex;align-items:center;justify-content:center;padding:14px 0;">' +
      '<canvas id="gocPdfCanvas" style="box-shadow:0 2px 14px rgba(0,0,0,.4);background:#fff;height:fit-content;"></canvas>' +
    '</div>' +
    '<div id="gocPdfPager" class="goc-viewer-pager" style="display:none;flex:0 0 52px;background:#fff;border-top:1px solid #e5e7eb;align-items:center;justify-content:center;gap:16px;">' +
      '<button id="gocPdfPrev" class="goc-pager-btn" type="button" aria-label="Previous page" style="border:0;background:#f3f4f6;border-radius:10px;width:38px;height:38px;font-size:16px;cursor:pointer;">‹</button>' +
      '<span id="gocPdfPageInfo" style="font-size:13px;font-weight:700;color:#111827;min-width:70px;text-align:center;"></span>' +
      '<button id="gocPdfNext" class="goc-pager-btn" type="button" aria-label="Next page" style="border:0;background:#f3f4f6;border-radius:10px;width:38px;height:38px;font-size:16px;cursor:pointer;">›</button>' +
    '</div>';
  }

  var fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  var showZoom = (kind === 'image' || kind === 'pdf');

  overlay.innerHTML =
    '<div class="goc-viewer-header" style="height:58px;flex:0 0 58px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;border-bottom:1px solid #e5e7eb;">' +
      '<button id="gocPdfClose" class="goc-viewer-btn" type="button" aria-label="Close viewer" style="border:0;background:#f3f4f6;border-radius:10px;width:38px;height:38px;font-size:20px;cursor:pointer;">×</button>' +
      '<div class="goc-viewer-title" style="flex:1;min-width:0;font-size:14px;font-weight:700;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        esc(title || 'Resource') +
      '</div>' +
      (fsSupported ? '<button id="gocPdfFullscreen" class="goc-viewer-btn" type="button" aria-label="Enter full screen" style="border:0;background:#f3f4f6;border-radius:10px;width:38px;height:38px;font-size:16px;cursor:pointer;">\u26F6</button>' : '') +
    '</div>' +
    body +
    (showZoom ?
      '<div id="gocZoomBar" class="goc-zoom-bar" style="position:absolute;right:14px;' + (kind === 'pdf' ? 'bottom:68px;' : 'bottom:14px;') + 'display:flex;align-items:center;gap:6px;background:rgba(17,17,17,.6);border-radius:12px;padding:6px;z-index:5;">' +
        '<button id="gocZoomOut" class="goc-zoom-btn" type="button" aria-label="Zoom out" style="border:0;background:#fff;border-radius:8px;width:34px;height:34px;font-size:20px;font-weight:700;line-height:1;cursor:pointer;">\u2212</button>' +
        '<button id="gocZoomReset" class="goc-zoom-btn" type="button" aria-label="Reset zoom" style="border:0;background:#fff;border-radius:8px;height:34px;min-width:48px;padding:0 8px;font-size:12px;font-weight:700;cursor:pointer;">100%</button>' +
        '<button id="gocZoomIn" class="goc-zoom-btn" type="button" aria-label="Zoom in" style="border:0;background:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;font-weight:700;line-height:1;cursor:pointer;">+</button>' +
      '</div>' : '') +
    '<div id="gocPdfFallback" style="display:none;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;color:#fff;background:#1a1b1e;">' +
      '<div style="font-size:15px;font-weight:700;">Can\u2019t preview this here</div>' +
      '<div style="font-size:13px;color:#9CA3AF;max-width:280px;">This device doesn\u2019t support opening it inside the app. You can still download it.</div>' +
      '<button id="gocPdfFallbackDl" class="goc-viewer-dl" type="button" style="border:0;background:#DC2626;color:#fff;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;cursor:pointer;">Download instead</button>' +
    '</div>';

  document.body.appendChild(overlay);

  /* Belt-and-braces on top of the 100dvh above: a handful of older/quirky
     Android WebViews report a stale layout viewport height instead of
     following the visible (toolbar-aware) one. Pin the overlay to
     window.visualViewport when it exists — this is what actually reflects
     the space left once the address bar has settled. */
  function syncViewerHeight(){
    var vv = window.visualViewport;
    overlay.style.height = (vv ? vv.height : window.innerHeight) + 'px';
  }
  if(window.visualViewport){
    syncViewerHeight();
    window.visualViewport.addEventListener('resize', syncViewerHeight);
  }
  window.addEventListener('orientationchange', syncViewerHeight);

  var close = document.getElementById('gocPdfClose');
  var fallback = document.getElementById('gocPdfFallback');
  var fallbackDl = document.getElementById('gocPdfFallbackDl');
  var fsBtn = document.getElementById('gocPdfFullscreen');
  var zoomOutBtn = document.getElementById('gocZoomOut');
  var zoomInBtn = document.getElementById('gocZoomIn');
  var zoomResetBtn = document.getElementById('gocZoomReset');
  var zoomLevel = 1; // shared by the image and pdf branches below; pinch-zoom is disabled app-wide, so this is the only way in

  /* ---- full screen: reclaims the address-bar/tab-strip space the overlay can't cover on its own.
     Must run from this direct click handler (a real user gesture) — browsers refuse
     requestFullscreen() called from inside an async .then(), which is why this isn't
     auto-triggered when the viewer opens. Not supported on iOS Safari at all; the button
     is simply omitted there (see fsSupported above). */
  function isFullscreen(){
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function onFsChange(){
    /* Entering/exiting full screen changes how much of the physical screen
       is available (the address bar/tab strip disappear or come back), so
       the px height captured by syncViewerHeight() before the transition is
       now stale. Re-measure once the transition settles so the overlay
       doesn't stay pinned to the old (shorter or taller) size and leave a
       dead band at the bottom. */
    syncViewerHeight();
    if(!fsBtn) return;
    fsBtn.textContent = isFullscreen() ? '\u2913' : '\u26F6';
    fsBtn.setAttribute('aria-label', isFullscreen() ? 'Exit full screen' : 'Enter full screen');
  }
  if(fsBtn){
    fsBtn.onclick = function(){
      if(!isFullscreen()){
        var req = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
        if(req) req.call(overlay).catch(function(){});
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if(exit) exit.call(document).catch(function(){});
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  /* ---- zoom: lets a student blow up a detail (a diagram, small print in a table)
     past the normal fit-to-width view, for both images and pdf.js canvas pages. */
  function setZoomUi(){
    if(zoomResetBtn) zoomResetBtn.textContent = Math.round(zoomLevel * 100) + '%';
    if(zoomOutBtn) zoomOutBtn.disabled = zoomLevel <= 0.51;
    if(zoomInBtn) zoomInBtn.disabled = zoomLevel >= 3.99;
  }
  function applyImageZoom(){
    var frame = document.getElementById('gocPdfFrame');
    var wrap = frame && frame.parentElement;
    if(!frame || !wrap) return;
    if(zoomLevel === 1){
      frame.style.maxWidth = '100%';
      frame.style.maxHeight = '100%';
      frame.style.width = '';
      frame.style.height = '';
      wrap.style.justifyContent = 'center';
      wrap.style.alignItems = 'center';
    } else {
      // capture the fitted (100%) box size once, so zoom multiplies from a stable base
      if(!frame.dataset.baseW){
        frame.dataset.baseW = frame.clientWidth;
        frame.dataset.baseH = frame.clientHeight;
      }
      frame.style.maxWidth = 'none';
      frame.style.maxHeight = 'none';
      frame.style.width = Math.round(frame.dataset.baseW * zoomLevel) + 'px';
      frame.style.height = Math.round(frame.dataset.baseH * zoomLevel) + 'px';
      wrap.style.justifyContent = 'flex-start';
      wrap.style.alignItems = 'flex-start';
    }
    setZoomUi();
  }
  function stepZoom(dir){
    zoomLevel = dir > 0 ? Math.min(4, +(zoomLevel * 1.25).toFixed(3)) : Math.max(0.5, +(zoomLevel / 1.25).toFixed(3));
    if(kind === 'pdf'){ renderPage(pageNum); } else { applyImageZoom(); }
  }
  if(zoomInBtn) zoomInBtn.onclick = function(){ stepZoom(1); };
  if(zoomOutBtn) zoomOutBtn.onclick = function(){ stepZoom(-1); };
  if(zoomResetBtn) zoomResetBtn.onclick = function(){
    zoomLevel = 1;
    if(kind === 'pdf'){ renderPage(pageNum); } else { applyImageZoom(); }
  };

  function showFallback(){
    if(settled) return;
    settled = true;
    var wrap = document.getElementById('gocPdfCanvasWrap');
    var frame = document.getElementById('gocPdfFrame');
    var pager = document.getElementById('gocPdfPager');
    var zoomBar = document.getElementById('gocZoomBar');
    if(wrap) wrap.style.display = 'none';
    if(frame) frame.style.display = 'none';
    if(pager) pager.style.display = 'none';
    if(zoomBar) zoomBar.style.display = 'none';
    if(fallback) fallback.style.display = 'flex';
  }

  if(fallbackDl) fallbackDl.onclick = function(){
    downloadResourceBlob(blob, title, ext);
  };

  function closeViewer(){
    if(isFullscreen()){
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if(exit) exit.call(document).catch(function(){});
    }
    if(url) URL.revokeObjectURL(url);
    if(window.visualViewport) window.visualViewport.removeEventListener('resize', syncViewerHeight);
    window.removeEventListener('orientationchange', syncViewerHeight);
    overlay.remove();
  }

  if(close) close.onclick = closeViewer;
  overlay.addEventListener('click', function(e){
    if(e.target === overlay) closeViewer();
  });

  if(kind === 'image' || kind === 'video'){
    var frame = document.getElementById('gocPdfFrame');
    if(frame){
      frame.src = url;
      frame.addEventListener('load', function(){
        settled = true;
        if(kind === 'image') setZoomUi();
      });
      frame.addEventListener('loadeddata', function(){ settled = true; }); // video
      frame.addEventListener('error', showFallback);
      setTimeout(function(){ if(!settled) showFallback(); }, 1500);
    } else {
      showFallback();
    }
    return;
  }

  // ---- PDF: render with pdf.js onto <canvas>, no native plugin required ----
  var canvas = document.getElementById('gocPdfCanvas');
  var wrap = document.getElementById('gocPdfCanvasWrap');
  var pager = document.getElementById('gocPdfPager');
  var prevBtn = document.getElementById('gocPdfPrev');
  var nextBtn = document.getElementById('gocPdfNext');
  var pageInfo = document.getElementById('gocPdfPageInfo');

  var pdfDoc = null, pageNum = 1, rendering = false;

  function renderPage(n){
    if(!pdfDoc || rendering) return;
    rendering = true;
    pdfDoc.getPage(n).then(function(page){
      var containerWidth = Math.max(280, wrap.clientWidth - 24);
      var unscaled = page.getViewport({ scale: 1 });
      var dpr = window.devicePixelRatio || 1;
      var scale = (containerWidth / unscaled.width) * dpr * zoomLevel;
      var viewport = page.getViewport({ scale: scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
      canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
      wrap.style.justifyContent = zoomLevel > 1 ? 'flex-start' : 'center';
      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }).then(function(){
      settled = true;
      rendering = false;
      pageInfo.textContent = 'Page ' + pageNum + ' of ' + pdfDoc.numPages;
      prevBtn.disabled = pageNum <= 1;
      nextBtn.disabled = pageNum >= pdfDoc.numPages;
      setZoomUi();
    }).catch(function(){
      rendering = false;
      showFallback();
    });
  }

  if(prevBtn) prevBtn.onclick = function(){ if(pageNum > 1){ pageNum--; renderPage(pageNum); } };
  if(nextBtn) nextBtn.onclick = function(){ if(pdfDoc && pageNum < pdfDoc.numPages){ pageNum++; renderPage(pageNum); } };

  setTimeout(function(){ if(!settled) showFallback(); }, 6000); // pdf.js parsing a large file can legitimately take a few seconds

  blob.arrayBuffer().then(function(buf){
    return import(pdfjsAssetUrl('pdf.min.mjs')).then(function(pdfjsLib){
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsAssetUrl('pdf.worker.min.mjs');
      return pdfjsLib.getDocument({ data: buf }).promise;
    });
  }).then(function(doc){
    pdfDoc = doc;
    if(pdfDoc.numPages > 1){
      pager.style.display = 'flex';
    } else {
      var zoomBar = document.getElementById('gocZoomBar');
      if(zoomBar) zoomBar.style.bottom = '14px';
    }
    renderPage(1);
  }).catch(function(){
    showFallback();
  });
}

function setResFilter(f){ resFilter = f; renderResources(); }

function loadPublishedResources(){
  if(!GOC.api || !GOC.api.listPublishedResources) return;

  GOC.api.listPublishedResources().then(function(result){
    var items = result && Array.isArray(result.resources)
      ? result.resources
      : [];

    publishedResources = items;
    publishedResourcesLoaded = true;

    /* Convert Appwrite resource records into the format
       already expected by the student Resources UI. */
    var mapped = items.map(function(r){
      var category = String(r.category || 'other').toLowerCase();
      var catMap = {
        past_questions: 'past',
        notes: 'notes',
        formula: 'formula',
        syllabus: 'syllabus',
        other: 'other'
      };

      var typeMap = {
        past_questions: 'PDF',
        notes: 'DOC',
        formula: 'REF',
        syllabus: 'SYL',
        other: String(r.fileType || 'FILE').toUpperCase()
      };

      var colorMap = {
        past_questions: '#DC2626',
        notes: '#0E7490',
        formula: '#7F1D1D',
        syllabus: '#15803D',
        other: '#475467'
      };

      var fileType = String(r.fileType || 'FILE').toUpperCase();
      var subject = String(r.subject || 'all');

      return {
        resourceId: r.resourceId || '',
        storageFileId: r.storageFileId || '',
        description: r.description || '',
        published: !!r.published,

        cat: catMap[category] || 'other',
        type: typeMap[category] || fileType,
        tcol: colorMap[category] || '#475467',
        subj: subject,
        title: r.title || 'Untitled resource',
        meta: subject + ' · ' + (r.category || 'Other') + ' · ' + fileType,
        // The real file extension, independent of the badge label above
        // (which is a category-based relabel and can say "PDF" for a
        // resource that is actually a .docx). Open/download logic must
        // use the real extension, not the badge.
        fileExt: fileType.toLowerCase()
      };
    });

    /* Appwrite is the sole source of published resources.
       An empty result must produce an empty student resource list. */
    resources = mapped;

    renderResources();

  }, function(err){
    console.warn(
      '[goc] Could not load published resources:',
      err && err.message
    );

    publishedResourcesLoaded = false;
    resources = [];
    renderResources();
  });
}
function renderResources(){
  var cs = document.getElementById('resFilters');
  if(cs){ cs.querySelectorAll('.fchip').forEach(function(ch){ var on = ch.getAttribute('data-f') === resFilter; ch.classList.toggle('on', on); ch.setAttribute('aria-pressed', String(on)); }); }
  var host = document.getElementById('resList');
  if(!host) return;
  host.innerHTML = '';
  var n = 0;
  resources.forEach(function(r){
    /* "GOC Materials" is a special chip: it doesn't filter by the usual
       category (past/notes/formula/syllabus) — it shows whatever the
       admin console filed under the matching "GOC Materials" subject tab,
       regardless of category. */
    if(resFilter === 'materials'){
      if(String(r.subj || '').trim().toLowerCase() !== 'goc materials') return;
    } else if(resFilter !== 'all' && r.cat !== resFilter){
      return;
    }
    // Materials follow the student's own combination.
    if(r.subj !== 'all' && !studiesSubject(r.subj)) return;
    n++;
    var d = document.createElement('div');
    d.className = 'rcard';
    d.innerHTML =
      '<button type="button" class="rcard-main" aria-label="Open ' + esc(r.title) + '">' +
        '<div class="ricon" style="background:' + r.tcol + '">' + esc(r.type) + '</div>' +
        '<div style="flex:1;min-width:0"><h4>' + esc(r.title) + '</h4><p>' + esc(r.meta) + '</p></div>' +
      '</button>' +
      '<button type="button" class="rcard-dl" aria-label="Download ' + esc(r.title) + '" title="Download">' +
        '<svg class="icon dl" viewBox="0 0 24 24" fill="none" stroke="#1F2937" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>' +
      '</button>';

    var openBtn = d.querySelector('.rcard-main');
    var dlBtn = d.querySelector('.rcard-dl');

    openBtn.onclick = function(){
      if(!r.resourceId){
        toast('This resource cannot be opened.');
        return;
      }

      var kind = resourceViewerKind(r.fileExt);
      toast(kind ? ('Opening “' + r.title + '”…') : ('“' + r.title + '” can’t be previewed here — downloading it instead…'));

      GOC.api.getResourceFile(r.resourceId).then(function(blob){
        if(kind) openResourceMediaViewer(blob, r.title, kind, r.fileExt);
        else downloadResourceBlob(blob, r.title, r.fileExt);
      }, function(err){
        toast(err.message || 'Could not open this resource.');
      });
    };

    dlBtn.onclick = function(e){
      e.stopPropagation();
      if(!r.resourceId){
        toast('This resource cannot be downloaded.');
        return;
      }

      toast('Downloading “' + r.title + '”…');

      GOC.api.getResourceFile(r.resourceId).then(function(blob){
        downloadResourceBlob(blob, r.title, r.fileExt);
      }, function(err){
        toast(err.message || 'Could not download this resource.');
      });
    };

    host.appendChild(d);
  });
  document.getElementById('resEmpty').style.display = n ? 'none' : 'block';
  var re = document.getElementById('resEmpty');
  if(re) re.textContent = resFilter === 'materials'
    ? 'No general study materials have been added yet.'
    : 'Nothing here yet for ' + orderedSubjects().join(', ') + '.';
}

/* ================= TOAST / SHEET ================= */
var toastId=null;
function toast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  if(toastId) clearTimeout(toastId);
  toastId=setTimeout(function(){ t.classList.remove('show'); },2200);
}
function closeSheet(){
  document.querySelectorAll('.sheet').forEach(function(s){ s.classList.remove('show'); });
  document.getElementById('sheetBack').classList.remove('show');
}

/* Task 5 — the inline replacement for toast() on a form: puts the message
   next to the fields it's about instead of flashing it at the bottom of the
   screen. `kind` is 'err' or 'ok'; an empty/undefined text hides it again.
   Each call site still owns the element id, so different forms never step
   on each other's message. */
function formMsg(id, text, kind){
  var el = document.getElementById(id);
  if(!el) return;
  if(!text){ el.classList.remove('show','err','ok'); return; }
  el.textContent = text;
  el.classList.remove('err','ok');
  el.classList.add('show', kind === 'ok' ? 'ok' : 'err');
}

/* deterrent demo: block context menu inside protected areas */
document.addEventListener('contextmenu', function(e){
  if(e.target.closest && e.target.closest('.protected')){ e.preventDefault(); toast('Content is protected'); }
});

/* Task 6 — a refresh must not log a student out. js/api.js mirrors a
   student's token into sessionStorage (never staff, never localStorage —
   see its own comment for why); this is where that gets used. If this tab
   is carrying one when the app boots, it's worth trying to walk straight
   back into the dashboard instead of flashing the public landing page and
   making the student log in again. Restoration is attempted; it is not
   assumed — a token can outlive the server session it named (expiry,
   account changes), so every failure path below falls back to the
   ordinary landing screen exactly as before this fix. */
function restoreSession(){
  return GOC.api.ready.then(function(){
    return GOC.api.session();
  }).then(function(sessionData){
    if(!sessionData || sessionData.role !== 'student'){ go('landing'); return; }
    // The session check alone doesn't say whether a forced password change
    // is still pending — /me does, the same source a fresh login checks —
    // so that's read before deciding which screen to land on.
    return GOC.api.myProfile().then(function(me){
      var user = {
        id: sessionData.id, name: sessionData.name, role: sessionData.role,
        title: sessionData.title, subjects: sessionData.subjects
      };
      if(typeof animEnter === 'function') animEnter();
      applyIdentity(user);
      loadSettings();
      [buildWeek, renderClasses, renderResources, loadPublishedResources, loadPublishedVideos, loadUpcomingClasses, refreshMe, renderLeague]
        .forEach(function(fn){
          try{ fn(); }
          catch(e){ console.warn('[restoreSession] dashboard widget failed to hydrate:', e); }
        });
      wtCatalogue = null;
      if(me && me.mustChangePassword){ go('change-password'); return; }
      go('home');
      ssStart();
      swStart();
    });
  }).catch(function(){
    // Token turned out to be stale/invalid, or the profile re-read failed —
    // land where a student with no session would, same as before this fix.
    go('landing');
  });
}

/* ================= BOOT =================
   Wait for the API to work out whether a server is present, then load the
   public homepage updates. A tab with no leftover student token shows the
   landing screen immediately, exactly as before; one that has one attempts
   the restore above instead. */
if(GOC.api.hasPendingStudentSession && GOC.api.hasPendingStudentSession()){
  restoreSession();
} else {
  go('landing');
}
/* The sign-up form must be correct before anyone touches it: the exam notice
   hidden while JAMB / UTME is selected, and the science counter at zero. */
examPicked();
paintSubjPick('');
GOC.api.ready.then(function(mode){
  return loadUpdates();
});
