/* free2027-ui.js — the browser side of the 2027 Free Tutorial Edition.
   ----------------------------------------------------------------------------
   This file does three things and nothing else:

     1. THE MODE. It asks the server which mode the site is in (the one central
        switch, /api/health -> free2027), and then either leaves the original
        hub completely alone (Original Mode) or puts the site into 2027 Free
        Tutorial Mode. Original Mode is the default and the fallback: if the
        answer never arrives, if the request fails, or if the edition has been
        switched off, the hub shows exactly what it always showed.

        "2027 Free Tutorial Mode" is implemented by a class on <body> plus one
        rule in css/free2027.css. Every element of the original hub stays in
        the page — nothing is deleted — it is simply not shown, and one click
        on the console's mode switch brings all of it straight back.

     2. THE PARTICIPANT'S SCREENS. Registration (email + one-time code), the
        CBT Portal (weekly assessments, competitions, competition leaderboard),
        the examination runner and its result. Every rule enforced here is also
        enforced on the server, which is the authority: this side exists so the
        page behaves sensibly, not so it can be trusted.

     3. THE ADMIN ENTRY. One click on the existing "4 Science subjects" card
        opens the administrator sign-in. It is the only public console entry.

   Loading order: js/goc-free-2027.js (rules), js/api.js, js/app.js, then this
   file. Requires js/free2027-api.js. */
(function (global) {
  'use strict';

  var GOC = global.GOC = global.GOC || {};
  var rules = GOC.free2027;
  var api = GOC.free;
  if (!rules || !api) return;

  var F = {};                       // state, in one place

  F.mode = rules.MODE_ORIGINAL;
  F.on = false;
  F.config = null;
  F.me = null;
  F.activities = [];
  F.tab = 'weekly';
  F.exam = null;                    // { attempt, questions, index, answers, tick }
  F.saveQueue = {};

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + pad2(m) : pad2(m)) + ':' + pad2(r);
  }
  function when(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function say(msg) {
    if (typeof global.toast === 'function') global.toast(msg);
    else console.log('[free2027] ' + msg);
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = 'Please wait…'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }

  /* ======================================================= 1. THE MODE SWITCH
     The class on <body> is the whole mechanism. css/free2027.css does the rest.
     Original Mode removes it, and the hub is exactly what it was. */
  /* opts.stay — apply the mode without moving the person looking at it (the
     administrator flipping the switch from inside the console). */
  function applyMode(mode, on, opts) {
    var o = opts || {};
    F.mode = mode;
    F.on = !!on;
    var body = document.body;
    if (!body || !body.classList) return;
    var free = on && mode === rules.MODE_FREE;
    body.classList.toggle('f27-mode', free);
    var note = $('freeHomeMode');
    if (note) note.textContent = rules.modeLabel(mode);
    var fine = $('freeHomeNote');
    if (fine && F.config) {
      var del = F.config.otpDelivery || null;
      fine.textContent = del && del.available === false
        ? 'Email verification is required. Registration is temporarily unavailable until the academy configures email verification.'
        : 'Registration is verified by a one-time code sent to your email address.';
    }
    if (free) {
      freeHomeLoad();
    }
  }
  F.applyMode = applyMode;

  /* Ask the server, once, at boot. /api/health already answers with the mode —
     it costs no extra round trip on a cold load. */
  function boot() {
    var ready = (GOC.api && GOC.api.ready) ? GOC.api.ready : Promise.resolve('mock');
    return Promise.resolve(ready).then(function () {
      return fetch('api/health', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }).then(function (h) {
      var f = (h && h.free2027) || null;
      if (!f || f.on !== true) return applyMode(rules.MODE_ORIGINAL, false);
      return api.config().then(function (c) {
        F.config = c;
        /* Boot is the page's own entry point: it may move the visitor, so the
           "stay where you are" option is passed explicitly. */
        applyMode(c.mode, c.on, { boot: true });
        if (c.on && c.mode === rules.MODE_FREE) resumeParticipant();
      }, function () {
        /* The config endpoint failed: stay in Original Mode rather than show a
           half-built edition. */
        applyMode(rules.MODE_ORIGINAL, false);
      });
    }).catch(function () { applyMode(rules.MODE_ORIGINAL, false); });
  }

  /* A participant whose tab was refreshed keeps their verified session (the
     token is in sessionStorage), so an interrupted paper is one click away. */
  function resumeParticipant() {
    if (!api.hasToken()) return;
    api.me().then(function (r) {
      F.me = r.participant;
      paintWho();
      /* Never yank a visitor off the homepage just because a token exists; only
         the portal needs the identity, and it re-reads it on arrival. */
    }).catch(function () { /* an expired token is simply dropped by the server */ });
  }

  /* ==================================================== 2. THE PUBLIC HOME */

  function freeHomeLoad() {
    var host = $('freeHomeOpen');
    if (!host) return;
    host.innerHTML = '<div class="ad-loading">Reading this week\'s programme…</div>';
    api.activities().then(function (r) {
      F.activities = r.activities || [];
      paintHomeOpen(host);
    }).catch(function (err) {
      /* Without a token the portal list is closed; show what is public, which
         is the leaderboard list, and invite the visitor to register. */
      host.innerHTML = '<p class="f27-fine">Register (it takes a minute) to see the assessments and competitions open this week.</p>' +
        '<div class="f27-cta"><button class="btn btn-red btn-block" onclick="freeHomeCta()">Register free</button>' +
        '<button class="btn btn-outline btn-block" onclick="freeBoardOpenList()">Competition leaderboards</button></div>';
    });
  }
  function paintHomeOpen(host) {
    var live = F.activities.filter(function (a) { return a.state === 'open'; });
    if (!live.length) {
      host.innerHTML = '<p class="f27-fine">Nothing is open at the moment. The academy announces each assessment and competition here when it opens.</p>';
      return;
    }
    host.innerHTML = live.map(function (a) {
      return '<div class="f27-open-card"><div class="f27-open-top"><span class="f27-tag">' + esc(rules.kindLabel(a.kind)) + '</span>' +
        '<span class="f27-until">closes ' + esc(when(a.closesAt)) + '</span></div>' +
        '<h3>' + esc(a.title) + '</h3>' +
        '<p>' + (a.kind === rules.KIND_WEEKLY ? 'Weekly assessment · results are private to you' : 'Competition · ranked on score, then on time') +
        ' · ' + a.questionCount + ' question' + (a.questionCount === 1 ? '' : 's') + ' · ' + a.durationMin + ' min</p></div>';
    }).join('');
  }

  F.freeHomeCta = function () {
    if (F.me) { global.go('free-portal'); return; }
    if (api.hasToken()) {
      /* A token exists but the identity was not read yet: ask once, then move. */
      api.me().then(function (r) { F.me = r.participant; paintWho(); global.go('free-portal'); },
        function () { global.go('free-register'); });
      return;
    }
    global.go('free-register');
  };

  /* "Enter the CBT Portal": with no valid authenticated session the student
     gets the LOGIN interface first; only a valid session opens the dashboard.
     After a logout the token is gone, so this shows the login again — nobody
     is ever silently logged back in. */
  F.freePortalEnter = function () {
    if (api.hasToken()) {
      api.me().then(function (r) {
        F.me = r.participant;
        paintWho();
        global.go('free-portal');
        F.freePortalLoad();
      }, function () {
        /* expired or invalid session: fresh authentication required */
        api.logout();
        F.me = null;
        global.go('free-login');
      });
      return;
    }
    global.go('free-login');
  };

  /* Email + password login. On success the session token is stored and the
     CBT dashboard opens; refreshing the browser keeps that session. */
  F.freeLogin = function () {
    var err = $('freeLoginErr');
    if (err) err.textContent = '';
    var email = (($('freeLoginEmail') || {}).value || '').trim();
    var password = ($('freeLoginPassword') || {}).value || '';
    var e = rules.cleanEmail(email);
    if (e.error) { if (err) err.textContent = e.error; return; }
    if (!password) { if (err) err.textContent = 'Enter your password.'; return; }
    var btn = $('freeLoginBtn');
    busy(btn, true);
    api.login({ email: e.email, password: password }).then(function (r) {
      busy(btn, false);
      F.me = r.participant;
      paintWho();
      say('Welcome back, ' + r.participant.name + ' (' + r.participant.id + ')');
      global.go('free-portal');
      F.freePortalLoad();
    }, function (er) {
      busy(btn, false);
      if (err) err.textContent = (er && er.message) || 'That email address or password is not right.';
    });
  };

  /* Internal navigation history. Back NEVER calls window.history.back(): a
     browser history entry can point at an external website, and a direct URL
     or refresh leaves no useful internal entry — either would take the
     student out of the hub. Instead every free screen shown is pushed onto
     F.navStack; Back pops to the previous internal screen and falls back to
     the main G.O.C Academy Hub homepage when nothing valid remains. Home is
     a separate control that always goes straight to that homepage. */
  F.navStack = ['landing'];
  function trackScreen(id) {
    if (!F.on || F.mode !== rules.MODE_FREE) return;
    if (rules.SCREENS.indexOf(id) < 0 && id !== 'landing') return;
    var s = F.navStack;
    if (s[s.length - 1] !== id) s.push(id);
    if (s.length > 50) s.splice(0, s.length - 50);
  }
  F.freeNavBack = function () {
    var s = F.navStack;
    if (s.length > 1) { s.pop(); global.go(s[s.length - 1]); return; }
    s.length = 0; s.push('landing');
    global.go('landing');
  };
  F.freeNavHome = function () { F.navStack = ['landing']; global.go('landing'); };

  /* The navigation drawer's CBT Portal action (Free Tutorial Mode only — the
     button is hidden by CSS in Original Mode). Closes the drawer, then runs
     the same entry chain as the homepage button: login when there is no valid
     session, dashboard when there is. */
  F.dwFreePortal = function () {
    if (typeof global.closeDrawer === 'function') global.closeDrawer();
    setTimeout(function () { F.freePortalEnter(); }, 180);
  };

  /* ================================================= 3. REGISTRATION (OTP) */

  F.freeRegisterStart = function () {
    var err = $('freeRegErr');
    if (err) err.textContent = '';
    var name = (($('freeName') || {}).value || '').trim();
    var email = (($('freeEmail') || {}).value || '').trim();
    var password = ($('freePassword') || {}).value || '';
    var course = (($('freeCourse') || {}).value || '').trim();
    var n = rules.cleanName(name); if (n.error) return showErr('freeRegErr', n.error);
    var e = rules.cleanEmail(email); if (e.error) return showErr('freeRegErr', e.error);
    var pw = rules.cleanPassword(password); if (pw.error) return showErr('freeRegErr', pw.error);
    var c = rules.cleanCourse(course, F.config && F.config.courses);
    if (c.error) return showErr('freeRegErr', c.error);

    var btn = $('freeRegBtn');
    busy(btn, true);
    F.pendingName = n.name;
    F.pendingEmail = e.email;
    F.pendingPassword = pw.password;
    F.pendingCourse = c.course;
    api.registerStart({ name: n.name, email: e.email, password: pw.password, course: c.course }).then(function (r) {
      busy(btn, false);
      var step1 = $('freeRegStep1'), step2 = $('freeRegStep2');
      if (step1) step1.hidden = true;
      if (step2) step2.hidden = false;
      var to = $('freeOtpTo');
      if (to) to.textContent = e.email;
      var dev = $('freeOtpDev');
      if (dev) { dev.hidden = true; dev.textContent = ''; }
      var otp = $('freeOtp');
      if (otp) { otp.value = ''; otp.focus(); }
      showErr('freeOtpErr', '');
    }, function (er) {
      busy(btn, false);
      showErr('freeRegErr', er.message || 'Could not send the code.');
    });
  };

  F.freeRegisterResend = function () {
    if (!F.pendingEmail || !F.pendingName || !F.pendingCourse) {
      showErr('freeOtpErr', 'Start registration again to request a verification code.');
      return;
    }
    var btn = $('freeOtpResendBtn');
    busy(btn, true);
    api.registerStart({ name: F.pendingName, email: F.pendingEmail, password: F.pendingPassword, course: F.pendingCourse }).then(function () {
      busy(btn, false);
      showErr('freeOtpErr', 'A new verification code has been emailed. Older codes are no longer valid.');
    }, function (er) {
      busy(btn, false);
      showErr('freeOtpErr', er.message || 'Could not resend the code.');
    });
  };

  F.freeRegisterVerify = function () {
    var err = $('freeOtpErr');
    if (err) err.textContent = '';
    var code = (($('freeOtp') || {}).value || '').trim();
    var c = rules.cleanOtp(code);
    if (c.error) return showErr('freeOtpErr', c.error);
    var btn = $('freeOtpBtn');
    busy(btn, true);
    api.registerVerify({ email: F.pendingEmail, code: c.code }).then(function (r) {
      busy(btn, false);
      F.me = r.participant;
      paintWho();
      say('You are registered as ' + r.participant.id);
      global.go('free-portal');
      F.freePortalLoad();
    }, function (er) {
      busy(btn, false);
      showErr('freeOtpErr', er.message || 'That code was not accepted.');
    });
  };

  F.freeRegisterRestart = function () {
    F.pendingEmail = null;
    var step1 = $('freeRegStep1'), step2 = $('freeRegStep2');
    if (step1) step1.hidden = false;
    if (step2) step2.hidden = true;
    showErr('freeOtpErr', '');
    showErr('freeRegErr', '');
  };

  function showErr(id, msg) {
    var el = $(id);
    if (el) el.textContent = msg ? String(msg) : '';
  }

  /* ========================================================= 4. CBT PORTAL */

  function paintWho() {
    var who = $('freeWho');
    if (!who) return;
    who.textContent = F.me ? (F.me.name + ' · ' + F.me.id) : 'Not registered';
  }

  F.freePortalTab = function (tab) {
    F.tab = tab || 'weekly';
    var tabs = document.querySelectorAll('.f27-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-f27tab') === F.tab);
    }
    F.freePortalLoad();
  };

  /* ---------------------------------------------------- the programme card
     The candidate's own record: who they are, what they enrolled on, the access
     the academy granted, and the lessons with their completion marks. It is
     read from the server's local data file, so a restart never loses it. */
  F.freeProgrammeLoad = function () {
    var host = $('freeProgramme');
    if (!host) return;
    if (!api.hasToken()) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = '<div class="ad-loading">Loading your programme…</div>';
    api.programme().then(function (r) {
      paintProgramme(host, r || {});
    }, function (er) {
      host.innerHTML = '<p class="f27-fine">' + esc((er && er.message) || 'Your programme could not be read just now.') + '</p>';
    });
  };

  function paintProgramme(host, r) {
    var p = r.profile || {};
    var prog = r.progress || { lessons: [], completed: 0, total: 0, percent: 0 };
    var access = r.access || {};
    var enrol = r.enrolment || {};
    var rows = (prog.lessons || []).map(function (l) {
      return '<div class="f27-lesson' + (l.done ? ' done' : '') + '">' +
        '<div class="f27-lesson-main"><b>' + esc(l.title) + '</b>' +
        (l.subject ? '<span>' + esc(l.subject) + '</span>' : '') +
        (l.summary ? '<span>' + esc(l.summary) + '</span>' : '') + '</div>' +
        (l.done
          ? '<span class="f27-tick" title="Completed">✓ Done</span>'
          : '<button class="btn btn-outline f27-small" onclick="freeLessonDone(\'' + esc(l.id) + '\')">Mark done</button>') +
        '</div>';
    }).join('');
    host.innerHTML =
      '<div class="f27-prog-head"><div><b>' + esc(p.name || 'Candidate') + '</b>' +
        '<span>' + esc(p.id || '') + ' · ' + esc(enrol.course || p.course || '') + '</span></div>' +
        '<span class="f27-chip">' + esc(access.status === 'suspended' ? 'Access paused' : 'Access active') + '</span></div>' +
      '<div class="f27-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (prog.percent || 0) + '">' +
        '<i style="width:' + (prog.percent || 0) + '%"></i></div>' +
      '<p class="f27-fine">Lessons completed: <b>' + (prog.completed || 0) + ' of ' + (prog.total || 0) + '</b>' +
        ((r.quizzes && r.quizzes.submitted) ? ' · quizzes submitted: <b>' + r.quizzes.submitted + '</b>' +
          (r.quizzes.average == null ? '' : ' · your average: <b>' + r.quizzes.average + '%</b>') : '') + '</p>' +
      (rows || '<p class="f27-fine">No lessons have been published for this session yet.</p>');
  }

  /* Marking a lesson done. Idempotent on the server, so a double tap is safe. */
  F.freeLessonDone = function (id) {
    var lessonId = String(id || '');
    if (!lessonId) return;
    api.completeLesson(lessonId).then(function () {
      F.freeProgrammeLoad();
      say('Lesson marked done');
    }, function (er) {
      say((er && er.message) || 'That lesson could not be marked just now.');
    });
  };

  F.freePortalLoad = function () {
    var host = $('freePortalList');
    var mine = $('freePortalResults');
    if (!host) return;
    F.freeProgrammeLoad();
    if (!api.hasToken()) {
      host.innerHTML = '<div class="f27-empty"><p>Log in with your email and password to open your CBT dashboard.</p>' +
        '<button class="btn btn-red btn-block" onclick="freeGo(\'free-login\')">Log in</button>' +
        '<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="freeGo(\'free-register\')">Register free</button></div>';
      if (mine) mine.innerHTML = '';
      paintWho();
      return;
    }
    host.innerHTML = '<div class="ad-loading">Loading this session\'s programme…</div>';
    api.activities().then(function (r) {
      F.activities = r.activities || [];
      F.me = r.participant || F.me;
      paintWho();
      if (F.tab === 'leaderboard') return paintBoards(host, mine);
      paintLists(host, mine);
    }, function (er) {
      if (er && er.status === 401) {
        api.logout();
        F.me = null;
        paintWho();
        host.innerHTML = '<div class="f27-empty"><p>Your verification has expired. Register again — your email is remembered.</p>' +
          '<button class="btn btn-red btn-block" onclick="freeHomeCta()">Register again</button></div>';
        return;
      }
      host.innerHTML = '<p class="f27-fine">' + esc(er.message || 'Could not load the portal.') + '</p>';
    });
  };

  function stateClass(a) { return 'f27-state ' + (a.state === 'open' ? 'open' : a.state === 'upcoming' ? 'soon' : 'shut'); }
  function paintLists(host, mine) {
    var rows = F.activities.filter(function (a) { return a.kind === F.tab; });
    if (!rows.length) {
      host.innerHTML = '<p class="f27-fine">' + (F.tab === 'weekly'
        ? 'No weekly assessment has been published for this session yet.'
        : 'No competition has been published for this session yet.') + '</p>';
      if (mine) mine.innerHTML = '';
      return;
    }
    host.innerHTML = rows.map(function (a) {
      var action;
      if (a.openAttemptId) {
        action = '<button class="btn btn-red btn-block" onclick="freeExamOpen(\'' + esc(a.id) + '\')">Resume — ' +
          clock(a.remainingSec) + ' left</button>';
      } else if (a.state === 'open' && a.attemptsLeft > 0) {
        action = '<button class="btn btn-red btn-block" onclick="freeExamOpen(\'' + esc(a.id) + '\')">' +
          (a.attemptsUsed ? 'Sit again (' + a.attemptsLeft + ' left)' : 'Start') + '</button>';
      } else if (a.state === 'open' && a.attemptsLeft === 0) {
        action = '<button class="btn btn-outline btn-block" disabled>All attempts used</button>';
      } else {
        action = '<button class="btn btn-outline btn-block" disabled>' +
          (a.state === 'upcoming' ? 'Opens ' + when(a.opensAt) : 'Closed') + '</button>';
      }
      var lb = '';
      if (a.kind === rules.KIND_COMPETITION && a.leaderboard && a.leaderboard.published) {
        lb = '<button class="btn btn-outline btn-block" style="margin-top:8px" onclick="freeBoardOpen(\'' + esc(a.id) + '\')">See the leaderboard</button>';
      }
      return '<div class="f27-item">' +
        '<div class="f27-item-top"><span class="f27-tag">' + esc(rules.kindLabel(a.kind)) + '</span>' +
        '<span class="' + stateClass(a) + '">' + esc(rules.stateLabel(a.state)) + '</span></div>' +
        '<h3>' + esc(a.title) + '</h3>' +
        (a.instructions ? '<p class="f27-instr">' + esc(a.instructions) + '</p>' : '') +
        '<div class="f27-facts">' +
        '<span><b>' + a.questionCount + '</b> questions</span>' +
        '<span><b>' + a.durationMin + '</b> min</span>' +
        '<span><b>' + a.attemptsLeft + '</b> of ' + a.maxAttempts + ' attempt' + (a.maxAttempts === 1 ? '' : 's') + ' left</span>' +
        '<span>closes <b>' + esc(when(a.closesAt)) + '</b></span>' +
        (a.bestScore > -1 ? '<span>best <b>' + a.bestScore + '</b></span>' : '') +
        '</div>' + action + lb + '</div>';
    }).join('');
    if (mine) mine.innerHTML = '';
    paintMyResults();
  }

  function paintMyResults() {
    var host = $('freePortalResults');
    if (!host || !api.hasToken()) return;
    api.results().then(function (r) {
      F.results = r.results || [];
      if (!F.results.length) { host.innerHTML = ''; return; }
      host.innerHTML = '<h2 class="f27-h2">Your results this session</h2>' + F.results.map(function (x, i) {
        return '<div class="f27-res-row"><div><b>' + esc(x.title) + '</b>' +
          '<span>' + esc(rules.kindLabel(x.kind)) + ' · ' + esc(when(x.submittedAt)) + '</span></div>' +
          '<div class="f27-res-score">' + (x.score == null ? '—' : x.score + '/' + x.maxScore) + '</div>' +
          '<button class="btn btn-outline" onclick="freeResultShow(' + i + ')">View</button></div>';
      }).join('') +
        '<p class="f27-fine">Weekly assessment results are private: they are shown only here, to you.</p>';
    }).catch(function () { host.innerHTML = ''; });
  }

  /* ====================================================== 5. THE EXAMINER
     The clock is the SERVER'S. `remainingSec` comes from the server on every
     load, save and resume; the local interval only draws it. When it reaches
     zero the paper is submitted, not discarded. */
  F.freeExamOpen = function (activityId) {
    api.start(activityId).then(function (r) {
      if (r && r.submitted) return freeResultGo(r.result);
      F.exam = {
        attemptId: r.attempt.id,
        title: r.attempt.title,
        kind: r.attempt.kind,
        questions: r.questions || [],
        answers: Object.assign({}, r.attempt.responses || {}),
        remaining: r.attempt.remainingSec,
        index: 0,
        tick: null
      };
      if (r.resumed) say('Your paper was resumed with your answers and the time you had left.');
      global.go('free-exam');
      paintExam();
      startClock();
    }, function (er) {
      if (er && er.status === 409 && /submitted/i.test(er.message)) return;
      say(er.message || 'Could not open that activity.');
    });
  };

  function startClock() {
    stopClock();
    if (!F.exam) return;
    F.exam.lastTick = Date.now();
    F.exam.tick = setInterval(function () {
      if (!F.exam) return;
      var nowMs = Date.now();
      F.exam.remaining = Math.max(0, F.exam.remaining - Math.round((nowMs - F.exam.lastTick) / 1000));
      F.exam.lastTick = nowMs;
      var t = $('freeExamTime');
      if (t) t.textContent = clock(F.exam.remaining);
      if (F.exam.remaining <= 0) {
        stopClock();
        say('Time is up — your paper is being submitted.');
        doSubmit(true);
      }
    }, 1000);
    var t0 = $('freeExamTime');
    if (t0) t0.textContent = clock(F.exam.remaining);
  }
  function stopClock() {
    if (F.exam && F.exam.tick) { clearInterval(F.exam.tick); F.exam.tick = null; }
  }

  function paintExam() {
    if (!F.exam) return;
    var q = F.exam.questions[F.exam.index];
    var n = F.exam.questions.length;
    var title = $('freeExamTitle');
    if (title) title.textContent = F.exam.title;
    var meta = $('freeExamMeta');
    if (meta) meta.textContent = rules.kindLabel(F.exam.kind) + ' · ' + n + ' question' + (n === 1 ? '' : 's');
    var num = $('freeExamNum');
    if (num) num.textContent = 'Question ' + (F.exam.index + 1) + ' of ' + n;
    var label = $('freeExamPanelLabel');
    if (label) label.textContent = 'Q ' + (F.exam.index + 1) + ' / ' + n;
    var pass = $('freeExamPassage');
    if (pass) {
      if (q && q.passage) { pass.hidden = false; pass.innerHTML = '<b>' + esc(q.passage.title || '') + '</b><br>' + esc(q.passage.text || ''); }
      else { pass.hidden = true; pass.innerHTML = ''; }
    }
    var img = $('freeExamImage');
    if (img) {
      if (q && q.image) { img.hidden = false; img.innerHTML = '<img src="api/question-images/' + encodeURIComponent(q.image.id) + '" alt="' + esc(q.image.alt || '') + '">'; }
      else { img.hidden = true; img.innerHTML = ''; }
    }
    var qt = $('freeExamQ');
    if (qt) qt.textContent = q ? q.text : '';
    var host = $('freeExamOpts');
    if (host && q) {
      host.innerHTML = (q.options || []).map(function (o, i) {
        var on = F.exam.answers[q.id] === i;
        return '<button class="exam-opt' + (on ? ' sel' : '') + '" onclick="freeExamPick(' + i + ')">' +
          '<span class="eo-key">' + String.fromCharCode(65 + i) + '</span><span class="eo-txt">' + esc(o) + '</span></button>';
      }).join('');
    }
  }

  F.freeExamPick = function (i) {
    if (!F.exam) return;
    var q = F.exam.questions[F.exam.index];
    if (!q) return;
    /* Paint first, save second: the page must not wait on the network while a
       candidate is working. A failed save is retried in the background. */
    F.exam.answers[q.id] = i;
    paintExam();
    saveAnswer(q.id, i, 0);
  };

  function saveAnswer(questionId, choice, tries) {
    var attemptId = F.exam && F.exam.attemptId;
    if (!attemptId) return;
    var key = attemptId + '|' + questionId;
    F.saveQueue[key] = true;
    api.answer(attemptId, questionId, choice).then(function () {
      delete F.saveQueue[key];
    }, function (er) {
      delete F.saveQueue[key];
      if (er && er.status === 410) { stopClock(); return doSubmit(true); }
      if (tries < 3) setTimeout(function () { saveAnswer(questionId, choice, tries + 1); }, 1200 * (tries + 1));
      else say('That answer could not be saved — check your connection.');
    });
  }

  F.freeExamMove = function (d) {
    if (!F.exam) return;
    var next = F.exam.index + d;
    if (next < 0 || next >= F.exam.questions.length) return;
    F.exam.index = next;
    paintExam();
  };
  F.freeExamPanel = function () {
    if (!F.exam) return;
    var grid = $('freeExamPanelGrid');
    if (grid) {
      grid.innerHTML = F.exam.questions.map(function (q, i) {
        var cls = i === F.exam.index ? 'qn cur' : (F.exam.answers[q.id] != null ? 'qn ans' : 'qn');
        return '<button class="' + cls + '" onclick="freeExamJump(' + i + ')">' + (i + 1) + '</button>';
      }).join('');
    }
    var back = $('freeExamPanelBack'), pan = $('freeExamPanel');
    if (back) back.hidden = false;
    if (pan) pan.hidden = false;
  };
  F.freeExamJump = function (i) {
    if (!F.exam) return;
    F.exam.index = Math.max(0, Math.min(F.exam.questions.length - 1, Number(i) || 0));
    paintExam();
    F.freeExamPanelClose();
  };
  F.freeExamPanelClose = function () {
    var back = $('freeExamPanelBack'), pan = $('freeExamPanel');
    if (back) back.hidden = true;
    if (pan) pan.hidden = true;
  };

  /* Leaving keeps the attempt open on the server, with every answer already
     saved: coming back resumes it rather than starting again. */
  /* Leaving an active examination never silently destroys the attempt: the
     answers and the remaining time are already on the server, and the student
     is asked first. Coming back resumes the same paper. */
  F.freeExamLeave = function () {
    if (!F.exam) { global.go('free-portal'); return; }
    if (typeof global.confirm === 'function' && !global.confirm(
      'Leave this paper? Your answers and remaining time are saved — you can resume it from the CBT Portal.')) return;
    stopClock();
    F.exam = null;
    say('Your paper is saved. Open it again from the portal to carry on.');
    /* Internal-history back: the previous free screen (normally the portal),
       never the browser history — answers and remaining time stay on the
       server either way. */
    F.freeNavBack();
    if (F.navStack.indexOf('free-portal') > -1) F.freePortalLoad();
  };
  /* Home during an examination asks first for the same reason. */
  F.freeExamHome = function () {
    if (!F.exam) { F.freeNavHome(); return; }
    if (typeof global.confirm === 'function' && !global.confirm(
      'Leave this paper for the homepage? Your answers and remaining time are saved.')) return;
    stopClock();
    F.exam = null;
    F.freeNavHome();
  };

  F.freeExamSubmit = function () {
    if (!F.exam) return;
    var unanswered = F.exam.questions.length - Object.keys(F.exam.answers).length;
    var msg = unanswered > 0
      ? 'You have ' + unanswered + ' unanswered question' + (unanswered === 1 ? '' : 's') + '. Submit anyway?'
      : 'Submit your paper?';
    if (typeof global.confirm === 'function' && !global.confirm(msg)) return;
    doSubmit(false);
  };

  var submitting = false;
  function doSubmit(auto) {
    if (!F.exam || submitting) return;
    submitting = true;
    stopClock();
    var btn = $('freeExamSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    var payload = {};
    F.exam.questions.forEach(function (q) {
      if (F.exam.answers[q.id] != null) payload[q.id] = F.exam.answers[q.id];
    });
    api.submit(F.exam.attemptId, payload).then(function (r) {
      submitting = false;
      F.exam = null;
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      freeResultGo(r.result);
    }, function (er) {
      submitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
      if (er && er.status === 410 && !auto) return doSubmit(true);
      say(er.message || 'Could not submit. Try again.');
      startClock();
    });
  }

  /* ============================================================ 6. RESULT */
  function freeResultGo(result) {
    global.go('free-result');
    freeResultPaint(result);
  }
  /* Called from the portal's own list with the row's index, so nothing about a
     result is ever serialised into the page. */
  F.freeResultShow = function (index) {
    var result = (F.results || [])[Number(index) || 0] || null;
    global.go('free-result');
    freeResultPaint(result);
  };
  function freeResultPaint(r) {
    var host = $('freeResultBody');
    if (!host) return;
    if (!r) { host.innerHTML = '<p class="f27-fine">No result to show.</p>'; return; }
    var pct = r.maxScore ? Math.round((Number(r.score) || 0) / Number(r.maxScore) * 100) : 0;
    var pos = r.position;
    host.innerHTML = '<div class="f27-result">' +
      '<span class="f27-tag">' + esc(rules.kindLabel(r.kind)) + '</span>' +
      '<h1>' + esc(r.title || 'Result') + '</h1>' +
      '<div class="f27-score"><b>' + (r.score == null ? '—' : r.score) + '</b><span>of ' + (r.maxScore == null ? '—' : r.maxScore) + '</span></div>' +
      '<div class="f27-bars"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>' +
      '<div class="f27-facts">' +
      '<span>correct <b>' + (r.correct == null ? '—' : r.correct) + '</b></span>' +
      '<span>wrong <b>' + (r.wrong == null ? '—' : r.wrong) + '</b></span>' +
      '<span>answered <b>' + (r.answered == null ? '—' : r.answered) + '</b> of ' + (r.total == null ? '—' : r.total) + '</span>' +
      '<span>time <b>' + clock(r.timeUsedSec) + '</b></span>' +
      '</div>' +
      (r.autoSubmitted ? '<p class="f27-fine">The clock ran out, so the paper was submitted with the answers that had been saved.</p>' : '') +
      (r.private
        ? '<p class="f27-fine">This is a weekly assessment: your result is private and is never shown to anyone else.</p>'
        : (pos ? '<p class="f27-fine">Competition position: <b>' + pos.rank + '</b> of ' + pos.of + '.' +
            (pos.inTop ? ' You are in the published top ten.' : ' The public board shows only the top ten — this is your private position.') + '</p>' : '')) +
      '<div class="f27-cta"><button class="btn btn-red btn-block" onclick="freeGo(\'free-portal\')">Back to the CBT Portal</button></div>' +
      '</div>';
  }

  /* ===================================================== 7. LEADERBOARDS */
  F.freeBoardOpenList = function () {
    global.go('free-leaderboard');
    var host = $('freeBoardBody');
    if (!host) return;
    host.innerHTML = '<div class="ad-loading">Loading the boards…</div>';
    api.leaderboards().then(function (r) {
      var rows = r.leaderboards || [];
      host.innerHTML = rows.length
        ? rows.map(function (b) {
            return '<div class="f27-item"><h3>' + esc(b.title) + '</h3>' +
              '<div class="f27-facts"><span><b>' + b.competitors + '</b> competitors</span></div>' +
              '<button class="btn btn-red btn-block" onclick="freeBoardOpen(\'' + esc(b.id) + '\')">View board</button></div>';
          }).join('')
        : '<p class="f27-fine">No competition leaderboard has been published for this session yet. The academy approves each board before it appears here.</p>';
    }, function (er) {
      host.innerHTML = '<p class="f27-fine">' + esc(er.message || 'Could not load the boards.') + '</p>';
    });
  };

  F.freeBoardOpen = function (id) {
    global.go('free-leaderboard');
    var host = $('freeBoardBody');
    if (!host) return;
    host.innerHTML = '<div class="ad-loading">Loading the board…</div>';
    api.leaderboard(id).then(function (r) {
      var b = r.leaderboard;
      var mine = r.mine;
      var rows = (b.rows || []).map(function (x) {
        var me = mine && mine.participantId === x.participantId;
        return '<tr' + (me ? ' class="me"' : '') + '><td>' + x.rank + '</td><td>' + esc(x.participantId) + '</td>' +
          '<td>' + esc(x.name) + '</td><td>' + esc(x.course) + '</td>' +
          '<td>' + x.score + '/' + x.maxScore + '</td><td>' + clock(x.timeUsedSec) + '</td></tr>';
      }).join('');
      host.innerHTML = '<h1 class="f27-h1">' + esc(b.title) + '</h1>' +
        '<p class="f27-fine">Top ' + rules.PUBLIC_TOP_N + ' of ' + b.totalCompetitors + ' competitor' + (b.totalCompetitors === 1 ? '' : 's') +
        '. Ranked on the highest score first, then on the shortest completion time.</p>' +
        '<div class="f27-table-wrap"><table class="f27-table"><thead><tr><th>#</th><th>Participant</th><th>Name</th><th>Course</th><th>Score</th><th>Time</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        (mine && !mine.inTop
          ? '<div class="f27-mine-card"><b>Your position</b><span>' + mine.rank + ' of ' + mine.of + '</span>' +
            '<p>Only the top ' + rules.PUBLIC_TOP_N + ' are shown publicly. This is your own position, visible only to you.</p></div>'
          : (mine && mine.inTop ? '<p class="f27-fine">You are on this board.</p>' : '')) +
        '<div class="f27-cta"><button class="btn btn-outline btn-block" onclick="freeBoardOpenList()">All competitions</button></div>';
    }, function (er) {
      host.innerHTML = '<p class="f27-fine">' + esc(er.message || 'That board is not published.') + '</p>' +
        '<div class="f27-cta"><button class="btn btn-outline btn-block" onclick="freeBoardOpenList()">All competitions</button></div>';
    });
  };

  /* ======================================================= 8. SIGNING OUT */
  F.freeSignOut = function () {
    stopClock();
    F.exam = null;
    api.logout().then(function () {
      F.me = null;
      paintWho();
      say('Signed out');
      global.go('free-home');
    });
  };

  /* =================================================== 9. ADMIN ENTRY
     The existing homepage statistic is the single public console gateway.
     It opens the existing staff sign-in; authentication and the console's
     passcode gate remain enforced by the original server mechanisms. */
  /* The homepage statistics card is NO LONGER a hidden admin entrance (PR #9):
     the Founder reaches the console through the Get-in-Touch contact form with
     the exact message "GOC FOUNDER", which the server checks against the
     configured Founder account and then routes to the existing staff sign-in.
     The card is a plain statistic again — no gate, no hidden handler. */

  /* The administrator signs in with the hub's own login (js/app.js loginNow),
     which the server authorises exactly as it always did. This only feeds the
     two fields and reports the answer. */
  F.freeAdminLogin = function () {
    var id = (($('freeAdminId') || {}).value || '').trim();
    var pw = (($('freeAdminPw') || {}).value || '');
    var err = $('freeAdminErr');
    if (err) err.textContent = '';
    if (!id) { if (err) err.textContent = 'Enter your Staff ID.'; return; }
    var btn = $('freeAdminBtn');
    busy(btn, true);
    GOC.api.ready.then(function () { return GOC.api.login(id, pw); }).then(function (user) {
      busy(btn, false);
      if (!user || user.role !== 'admin') {
        if (err) err.textContent = 'That is not a management account.';
        return;
      }
      if (typeof global.applyIdentity === 'function') global.applyIdentity(user);
      /* Into the hub's own secure access portal: the passcode is still asked
         for, and the console is still locked until the server accepts it. */
      global.go('admin-gate');
      say('Staff ID recognised — enter your access passcode');
    }, function (er) {
      busy(btn, false);
      if (err) err.textContent = (er && er.message) || 'That ID and password do not match.';
    });
  };

  /* ====================================================== 10. HYDRATION */
  /* Fill the course list from the server's own copy, so the console's list and
     the page's list are the same list. */
  function paintCourses(courses) {
    var list = $('freeCourseList');
    if (!list) return;
    list.innerHTML = (courses || rules.DEFAULT_COURSES).map(function (c) {
      return '<option value="' + esc(c) + '"></option>';
    }).join('');
  }

  function hydrate() {
    /* `ready` is the one boot promise: the page awaits it, and so can a test. */
    F.ready = boot().then(function () {
      /* The original hub's `go()` is wrapped, not replaced: every screen, the
         tab bar, the sidebar and the admin gate behave exactly as before, and
         the one thing added is the rule for which screens belong to which
         mode. */
      hookGo();
      if (F.config) paintCourses(F.config.courses);
    });
    return F.ready;
  }

  /* The original public homepage always remains the initial page. In Free
     Tutorial mode, legacy student routes resolve to that edition's portal, but
     no mode switch hides or replaces the G.O.C Academy Hub homepage. */
  function hookGo() {
    if (!global.go || global.go.__f27) return;
    var original = global.go;
    var wrapped = function (id) {
      if (F.on && F.mode === rules.MODE_FREE) {
        var allowed = rules.SCREENS.concat(['landing', 'admin-gate', 'admin', 'staff-change-password', 'free-admin']);
        if (allowed.indexOf(id) < 0) id = 'free-home';
        trackScreen(id);
      }
      return original(id);
    };
    wrapped.__f27 = true;
    global.go = wrapped;
  }

  /* Expose the handful of names the markup calls. */
  var names = ['freeHomeCta', 'freeRegisterStart', 'freeRegisterVerify', 'freeRegisterRestart',
    'freePortalTab', 'freeExamOpen', 'freeExamPick', 'freeExamMove', 'freeExamPanel', 'freeExamJump',
    'freeExamPanelClose', 'freeExamLeave', 'freeExamHome', 'freeExamSubmit', 'freeResultShow', 'freeBoardOpen',
    'freeBoardOpenList', 'freeSignOut', 'freeAdminLogin', 'freeRegisterResend', 'freePortalLoad', 'applyMode',
    'freeProgrammeLoad', 'freeLessonDone', 'freeLogin', 'freePortalEnter', 'freeNavBack', 'freeNavHome', 'dwFreePortal'];
  names.forEach(function (n) {
    if (typeof F[n] === 'function') global[n] = F[n];
  });
  global.freeGo = function (id) { return global.go(id); };

  GOC.freeUI = {
    applyMode: applyMode,
    mode: function () { return { on: F.on, mode: F.mode }; },
    config: function () { return F.config; },
    /* The boot promise, so a caller can wait for the mode to be settled. */
    ready: function () { return F.ready || Promise.resolve(); },
    boot: boot
  };

  /* Run once the document is ready. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else {
    hydrate();
  }
}(typeof window !== 'undefined' ? window : this));
