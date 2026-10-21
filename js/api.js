/* ============================================================================
   G.O.C Academy Hub — API layer
   ----------------------------------------------------------------------------
   This is the ONLY file that knows where data comes from. app.js never touches
   an array or a fetch() directly; it calls GOC.api.something() and gets a
   promise back. That means the backend can be swapped without reopening app.js.

   Two drivers ship in this file:

     mock  — an in-memory driver (no demo accounts) that used to hold sample
             data inline in app.js. Runs with no server, so opening index.html
             straight from the file system still works.
     http  — talks to a real server over /api/*. Selected automatically when the
             page is served over http(s) AND /api/health answers.

   Every function returns a Promise that resolves with plain data, or rejects
   with an Error whose .message is already safe to show the user.

   To move to Supabase later, only the `http` driver changes — see
   server/SUPABASE.md. Nothing in app.js needs to be touched.
   ========================================================================== */
(function (global) {
  'use strict';

  var GOC = global.GOC = global.GOC || {};

  /* Shared domain rules and the seed question bank. js/goc-core.js is loaded
     before this file and by server/server.js too, so marking, performance and
     league ranking are computed by identical code in both drivers. */
  var core = GOC.core;

  /* ---------------------------------------------------------------- helpers */

  function fail(msg) { return Promise.reject(new Error(msg)); }
  function ok(v) { return Promise.resolve(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function norm(id) { return String(id == null ? '' : id).trim().toUpperCase(); }

  function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n); }

  function todayLabel() {
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var d = new Date();
    return m[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* ============================================================ MOCK DRIVER
     No demo accounts — starts empty, same as a fresh server install. Any
     account data held here only exists because there is no server in this
     mode; the driver still refuses a wrong password, so the login screen
     behaves exactly as it will against the real backend. */

  var mock = (function () {
    /* The Founder and Academic Director are the two permanent management
       accounts every deployment ships with — the server seeds the identical
       pair (server/server.js) from GOC_FOUNDER_PW / GOC_ACADDIR_PW, falling
       back to these same published defaults with a launch-time warning when
       an operator hasn't set their own. They are not part of the removed
       demo *student* roster (test-launch.js checks this driver only for the
       demo student passwords, never for these two), so the mock driver keeps
       them hardcoded the same way it keeps its console PASSCODE below,
       purely so the app still has a management sign-in when opened with no
       server. */
    var staff = [
      { id: 'GOC-A-001', name: 'Ernest Uzorchukwu', title: 'Founder', pw: 'founder2027' },
      { id: 'GOC-A-002', name: 'Itsemeh Victorian', title: 'Academic Director', pw: 'acaddir2027' }
    ];

    /* No demo roster. This is a real deployment, not a prototype — the mock
       driver still exists so index.html works when opened straight from the
       file system (no server), but it starts with zero students, exactly
       like a fresh server/data.json. `subjects` is the student's authorised
       UTME combination and is the single source of truth the dashboard
       reads from — nothing is hard-coded per page. `active:false` would mean
       the account has been closed by management but its history is kept. */
    var students = [];

    /* Homepage "talk to us" form. No server in this mode, so a submission
       just lives here for the length of the tab — sendContact() (below,
       driver-independent) still tries the real mail relay first; this is
       only the local record-keeping half of that call. */
    var contactMessages = [];

    /* Task 3 (second half) — same pool that used to be hard-coded straight
       into js/app.js, now owned here so the mock driver behaves like a
       fresh server/data.json instead of like the old prototype. */
    var affirmations = [
      "I am a purpose-driven scholar. Today I study with focus.",
      "Every question I attempt makes me sharper.",
      "I don't chase luck — I build mastery, one topic at a time.",
      "My effort today is my score tomorrow.",
      "I can understand anything if I take it step by step.",
      "Small steps, every single day, become big results.",
      "I study to understand, not just to pass."
    ];

    var updates = [
      { id:1, cat:'utme',        date:'Aug 20, 2026', title:'2027 UTME Bootcamp registration is open', body:'Our free UTME Bootcamp for the 2027 cohort has begun. Secure your spot, get a study plan across every JAMB subject, and start practising today.', ctaLabel:'Join the bootcamp →', ctaAction:"go('signup')" },
      { id:2, cat:'admission',   date:'Aug 15, 2026', title:'New student intake — limited pilot places', body:"We're admitting a small pilot group of students for tutoring and the Academy Hub. Early applicants get priority onboarding and mentorship.", ctaLabel:'Enquire about admission →', ctaAction:'scrollContactFromUpdates()' },
      { id:3, cat:'scholarship', date:'Aug 10, 2026', title:'Purpose-Driven Scholar award', body:'Dedicated students who keep their study streaks and top the Weekly Scholar League can earn fee waivers and free premium access. Consistency is rewarded.', ctaLabel:'Start earning it →', ctaAction:"go('signup')" },
      { id:4, cat:'news',        date:'Aug 5, 2026',  title:'AI Literacy program added to the curriculum', body:"Every G.O.C student now learns to use AI responsibly as a study partner — building independent thinking, not dependence. It's baked into the learning path.", ctaLabel:'Learn more →', ctaAction:"go('landing')" },
      { id:5, cat:'news',        date:'Jul 28, 2026', title:'Live Zoom classes now paired with the app', body:'Attend interactive live classes on Zoom, then reinforce every lesson with practice and CBT mocks in the Academy Hub between sessions.', ctaLabel:'See how it works →', ctaAction:"go('landing')" }
    ];

    var seq = 100;
    var settings = {
      dailyLimitMin: 90,
      /* Priority 9 — how long a student may stay logged in, set by management. */
      sessionMinutes: 120,
      /* Priority 9 — and how long before the end they are warned. */
      sessionWarnMinutes: 5,
      /* Priority 11 — configurable weighting, not arbitrary hard-coded values. */
      perfWeights: { objective: 40, theory: 30, jamb: 30 },
      /* How long the whole objective sitting runs, and how many questions each
         paper in it serves. Both are management's to set; the student only
         presses Start. An absent count means the full UTME paper. */
      objectiveMinutes: core.OBJ_MIN_DEFAULT,
      objectiveCounts: {},
      /* The JAMB-oriented sitting is configured independently of the Objective
         one — its own clock and per-paper counts. */
      jambMinutes: core.JAMB_MIN_DEFAULT,
      jambCounts: {},
      /* How many active JAMB-pool questions EVERY subject in a student's
         combination needs before the sitting is offered (see
         core.jambReadiness). Same default and clamp as the server. */
      jambReadyMin: core.JAMB_READY_DEFAULT,
      /* Academy-wide guardian PIN for the "add 15 min" grant (see
         server.js's /me/study-time/extend) — kept on this same settings
         object so the offline driver's rules mirror the live one. */
      guardianPin: null
    };
    /* Mirrors server.js's studyBonusMinToday/studyExtendCountToday: the
       bonus and grant count only count for today, so a stale stamp from a
       previous day reads back as zero rather than carrying over. */
    function studyBonusMinToday(s) {
      if (!s || s.studyBonusDay !== core.dayStamp()) return 0;
      return Number(s.studyBonusMin) || 0;
    }
    function studyExtendCountToday(s) {
      if (!s || s.studyBonusDay !== core.dayStamp()) return 0;
      return Number(s.studyExtendCount) || 0;
    }
    var PASSCODE = '2027';
    /* Sign-ups per address. Demo mode has no network address to count, so it never refuses
       a sign-up; it only holds the numbers in memory so the console panel works offline. */
    var SIGNUP_LIMITS = { perHour: core.SIGNUP_LIMIT_DEFAULTS.perHour, perDay: core.SIGNUP_LIMIT_DEFAULTS.perDay };
    var SIGNUP_LIMITS_AT = null, SIGNUP_LIMITS_BY = null;
    var session = null;

    /* --------------------------------------------------- test-system stores */
    var questions = core.seedQuestions();
    var qSeq = questions.reduce(function (m, r) { return Math.max(m, r.id); }, 0);
    var notes = core.seedNotes();          /* Reading mode */
    var nSeq = notes.reduce(function (m, r) { return Math.max(m, r.id); }, 0);
    var passages = [];                     /* Comprehension passages (Phase 3) */
    var qImages = {};                      /* Question pictures (Phase 3): id -> { file, type, bytes } */
    function imageLinkError(rec) {
      return rec && rec.imageId && !qImages[rec.imageId] ? 'That picture is not on the server. Upload it again.' : null;
    }
    var pSeq = 0;
    var importLog = [];                    /* mirrors server db.importLog, in memory */
    var ilSeq = 0;
    function logImport(entry){
      ilSeq++;
      importLog.push({
        id: ilSeq, kind: entry.kind,
        filename: entry.filename ? String(entry.filename).slice(0, 200) : null,
        fingerprint: entry.fingerprint || null,
        target: entry.target || null,
        read: entry.read || 0, added: entry.added || 0, replaced: entry.replaced || 0, skipped: entry.skipped || 0,
        by: null, at: new Date().toISOString()
      });
      if(importLog.length > 200) importLog = importLog.slice(-200);
    }
    /* Mirrors server.js's findDuplicateImport — same narrow reading of "same
       file": exact filename plus exact content fingerprint, within the same
       kind's own history, and (questions only) the same chosen subject/section
       target — a re-run against a different target is a fresh import, not a
       repeat. A paste with no filename never matches. */
    function findDuplicateImport(kind, filename, fingerprint, target){
      if(!filename || !fingerprint) return null;
      for(var i = importLog.length - 1; i >= 0; i--){
        var e = importLog[i];
        if(e.kind === kind && e.filename === filename && e.fingerprint === fingerprint &&
           (e.target || null) === (target || null)) return e;
      }
      return null;
    }
    /* Topics management has declared but nothing carries yet. A topic is only a
       label, so this is the one place a label can exist on its own. */
    var declaredTopics = [];
    var openStudy = {};                    /* self-directed CBT runs in progress */
    var sSeq = 0;
    /* Mirrors server.js's practiceRecent: what a student was served last time
       they practiced a subject, in memory only, so a resit here behaves the
       same as against the live server — a fresh draw, not the same set back
       to back. Keyed the same way: "scholarId|subject" -> id list. */
    var practiceRecent = {};
    function practiceRecentKey(scholarId, subject){ return scholarId + '|' + subject; }
    function practiceRecentIds(scholarId, subject){
      return practiceRecent[practiceRecentKey(scholarId, subject)] || [];
    }
    function practiceRecentRemember(scholarId, subject, ids, poolSize){
      var key = practiceRecentKey(scholarId, subject);
      var seen = {}, merged = [];
      ids.concat(practiceRecent[key] || []).forEach(function(id){
        if(!seen[id]){ seen[id] = true; merged.push(id); }
      });
      practiceRecent[key] = merged.slice(0, Math.max(ids.length, poolSize));
    }


    /* No seeded attempt history: this is a real deployment with no demo
       roster, so there is nobody to seed it for. Real attempts are created
       later, in the studyStart/studySubmit-style calls below, as students
       actually sit papers. */
    var attempts = [];
    var aSeq = 0;
    var openAttempts = {};
    /* Practice history per Scholar ID (Phase 1). In-memory only, like the rest
       of demo mode: it lives for the session and resets on refresh, matching
       how demo data has always behaved. Newest first, capped at 30. */
    var practiceRuns = {};
    /* Saved questions per Scholar ID (Phase 1, part 2) — in-memory, like the above. */
    var bookmarks = {};
    /* Spaced-repetition schedule per Scholar ID (Phase 2) — in-memory, like the above. */
    var reviewState = {};
    /* Access tiers (Phase 3B), mirroring server.js: spaced reviews answered per
       student per Lagos day, { day, count }. In memory like the rest of demo mode. */
    var reviewCount = {};
    /* A student's kept practice runs: their tier's count limit (null = none) and the maximum age. */
    function demoRuns(id, list) { return core.capList(core.dropOldRuns(list), core.tierLimits(tierOf(id)).practiceHistory); }
    function tierOf(id) { var st = find(students, id); return core.cleanTier(st && st.tier); }
    function reviewsUsedToday(id) {
      var r = reviewCount[id];
      return r && r.day === core.lagosDay() ? Math.max(0, Math.floor(Number(r.count) || 0)) : 0;
    }
    /* Targeted broadcasts (Phase 4), mirroring server.js — in memory like the rest of demo mode. */
    var broadcasts = [], broadcastSeq = 0;
    /* Ask a tutor (Phase 4.A) question flags — in memory like the rest of demo mode. */
    var flags = [], flagSeq = 0;
    var reminderPrefs = {};   /* Study reminders (Phase 2): per Scholar ID, {email, sms} — in memory like the rest of demo mode */

    var validateQuestion = core.validateQuestion;

    /* The student's mistakes: wrong practice answers plus wrong objective answers
       in their latest marked Web Test papers, merged newest first. Shared by the
       mistakes review and spaced repetition, like mistakesFor on the server. */
    function demoMistakes(studentId) {
      var marked = attemptsFor(studentId).filter(function (a) { return a.status === 'marked'; })
        .sort(function (a, b) { return b.submittedAt - a.submittedAt; }).slice(0, 20)
        .map(function (a) { return summariseOwn(a, 0, null); });
      return core.attachImagesToMistakes(core.attachPassagesToMistakes(core.mergeMistakes([core.mistakesFromRuns(demoRuns(studentId, practiceRuns[studentId])), core.mistakesFromAttempts(marked)]), questions, passages), questions);
    }

    function attemptSummary(a) {
      var out = {
        id: a.id, scholarId: a.scholarId, studentName: a.studentName,
        period: a.period, section: a.section, subject: a.subject,
        submittedAt: a.submittedAt, timeUsedSec: a.timeUsedSec,
        total: a.total, answered: a.answered, unanswered: a.unanswered,
        correct: a.correct, wrong: a.wrong,
        score: a.score, maxScore: a.maxScore, percent: a.percent,
        status: a.status, xpAwarded: a.xpAwarded || 0
      };
      /* Same as server.js: the JAMB-style score out of 400, where it can honestly be given. */
      if (a.section === 'jamb') { var js = core.jambScore(a); if (js) out.jambScore = js; }
      return out;
    }

    /* What a student is allowed to see after submitting. Correct answers and
       explanations appear only once the paper has been marked, and only for the
       student's own paper — a student can never read them beforehand and can
       never write to any of these fields. */
    function summariseOwn(a, gain, stu) {
      var out = attemptSummary(a);
      out.xpAwarded = gain || a.xpAwarded || 0;
      out.xpTotal = stu ? (stu.xp || 0) : 0;
      out.level = stu ? core.levelFor(stu.xp || 0) : 1;
      out.streak = stu ? (stu.streak || 0) : 0;
      out.breakdown = a.status === 'marked' ? core.topicBreakdown(a.answers) : [];
      out.review = a.answers.map(function (r) {
        var q = find(questions, r.questionId) || {};
        var row = {
          questionId: r.questionId, kind: r.kind, topic: r.topic,
          text: q.text || '', given: r.given,
          markAwarded: r.markAwarded, maxMark: r.maxMark
        };
        if (a.status === 'marked') {
          row.isCorrect = r.isCorrect;
          row.explanation = q.explanation || '';
          if (r.kind === 'objective') { row.options = (q.options || []).slice(); row.answer = q.answer; }
        }
        return row;
      });
      out.performance = stu ? perfFor(stu.id).overall : 0;
      return out;
    }

    function attemptsFor(id) {
      return attempts.filter(function (a) { return a.scholarId === id; });
    }
    function perfFor(id) {
      return core.computePerformance(attemptsFor(id), settings.perfWeights);
    }
    function publicStudent(s) {
      return {
        id: s.id, name: s.name, last: s.last, tag: s.tag, tl: s.tl,
        active: s.active !== false, xp: s.xp || 0, streak: s.streak || 0,
        level: core.levelFor(s.xp || 0), subjects: (s.subjects || []).slice(),
        exam: core.EXAM, performance: perfFor(s.id).overall,
        tier: core.cleanTier(s.tier),   /* as the server's console view of a student */
        tierChangedBy: s.tierChangedBy || null,
        tierChangedAt: s.tierChangedAt || null
      };
    }
    function find(arr, id) {
      for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
      return null;
    }
    /* How many times this student has submitted this section+subject IN THE
       CURRENT ROUND, and what the sit rule (core.canSit) makes of it — the same
       steps as sitStatus in server.js, so the catalogue reads the same in both.
       A new round (openRound) lets a finished section be sat again. */
    function currentRound(section, subject) {
      var rounds = settings.rounds || {};
      var n = Math.floor(Number(rounds[section + '|' + subject]));
      return n > 0 ? n : 1;
    }
    function countSubmittedAttempts(scholarId, section, subject, round) {
      var cur = round != null ? round : currentRound(section, subject);
      var n = 0;
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        if (a.scholarId === scholarId && a.section === section && a.subject === subject
            && core.attemptRound(a) === cur) n++;
      }
      return n;
    }
    function sitStatus(scholarId, section, subject) {
      var round = currentRound(section, subject);
      var n = countSubmittedAttempts(scholarId, section, subject, round);
      var sit = core.canSit(section, new Array(n).fill({ section: section, roundId: round }), round);
      return { completed: !sit.allowed, repeatable: sit.repeatable, attempts: n, round: round };
    }
    /* Validate a round target the way the server's roundTarget does. */
    function roundTargetDemo(section, subject) {
      var sec = String(section || '');
      if (core.WEB_TEST_SECTIONS.indexOf(sec) < 0) return { error: 'Choose a test section (theory, objective or jamb).' };
      if (sec === 'theory') {
        var sub = String(subject || '');
        if (core.ALL_SUBJECTS.indexOf(sub) < 0) return { error: 'Choose a subject for the theory round.' };
        return { section: sec, subject: sub };
      }
      return { section: sec, subject: core.OBJECTIVE_SUBJECT };
    }
    function roundServedDemo(section, subject) {
      var bank = core.servablePool(questions, passages);
      if (section === 'theory') return core.eligible(bank, { section: 'theory', subject: subject }).length;
      return bank.filter(function (q) { return q.section === section; }).length;
    }
    /* Practice XP already earned today by this student. Kept on the student as a
       stamped running total, so yesterday's allowance never limits today. */
    function practiceXpToday(s) {
      if (!s || s.practiceXpDay !== core.dayStamp()) return 0;
      return Number(s.practiceXpToday) || 0;
    }
    /* Seconds of study time already spent today, same stamped-running-total
       shape as practiceXpToday above — real in this driver too, so a demo run
       with no server behaves exactly like the live one. */
    function studySecToday(s) {
      if (!s || s.studyDay !== core.dayStamp()) return 0;
      return Number(s.studySecToday) || 0;
    }
    /* One calendar day of streak, counted the same way the server counts it
       (core.streakAfterActivity): only from a route the student reaches by
       actually submitting a test or study/practice run, never from a bare
       login and never from a staff action on their behalf. */
    function bumpStreakRecord(s) {
      if (!s) return s;
      var r = core.streakAfterActivity(s.streak, s.streakDay, undefined, s.streakFreezes);
      s.streak = r.streak;
      s.streakDay = r.day;
      s.streakFreezes = r.freezes;
      return s;
    }
    function requireStaff() {
      if (!session || session.role !== 'admin') return fail('Management accounts only.');
      return null;
    }
    function requireUnlocked() {
      var e = requireStaff(); if (e) return e;
      if (!session.unlocked) return fail('Enter the access passcode first.');
      return null;
    }
    /* Priority 8 — only the Founder may change management credentials. The demo
       driver enforces the same rule the server enforces, so the behaviour the
       user sees offline is the behaviour they get online. */
    function requireFounder() {
      var e = requireUnlocked(); if (e) return e;
      if (session.title !== 'Founder') return fail('Only the Founder can change management credentials.');
      return null;
    }
    function requireStudent() {
      if (!session || session.role !== 'student') return fail('Please log in as a student.');
      var s = find(students, session.id);
      if (!s || s.active === false) return fail('This account has been deactivated by your academy.');
      return null;
    }
    /* Priority 9 — the configurable threshold belongs to students. Staff keep a
       fixed working session, the same eight hours the server gives them, so
       shortening a student's session never shortens management's own. */
    var STAFF_SESSION_MIN = 480;
    function expiryMs(role) {
      var min = role === 'student'
        ? core.clampSessionMinutes(settings.sessionMinutes)
        : STAFF_SESSION_MIN;
      return min * 60000;
    }
    function warnSec() {
      return core.clampWarnMinutes(settings.sessionWarnMinutes, settings.sessionMinutes) * 60;
    }
    function touchSession() {
      if (session) session.expiresAt = Date.now() + expiryMs(session.role);
    }
    /* Expiry is checked on every call, not by a screen timer, so a stale tab
       cannot keep using an expired session. */
    function sessionAlive() {
      if (!session) return false;
      if (session.expiresAt && Date.now() > session.expiresAt) { session = null; return false; }
      return true;
    }

    return {
      name: 'demo',

      login: function (rawId, password) {
        var id = norm(rawId);
        if (!id) return fail('Enter your Scholar ID.');
        var isStaff = /^GOC-A-\d+$/.test(id);
        var isStudent = /^GOC-S-\d+$/.test(id);
        if (!isStaff && !isStudent) return fail('That does not look like a G.O.C ID.');
        var acct = isStaff ? find(staff, id) : find(students, id);
        // Same message for "no such ID" and "wrong password", so the login
        // screen never confirms which IDs exist.
        if (!acct || String(password) !== acct.pw) return fail('That ID and password do not match.');
        /* Priority 7 — a closed account can no longer sign in, but its record,
           results, XP and history all remain. */
        if (!isStaff && acct.active === false) {
          return fail('This Scholar ID has been deactivated by your academy. Your records are safe — contact the academy to reopen it.');
        }
        session = {
          id: acct.id,
          name: acct.name,
          role: isStaff ? 'admin' : 'student',
          title: isStaff ? acct.title : null,
          unlocked: false,
          subjects: isStaff ? [] : (acct.subjects || []).slice(),
          exam: isStaff ? null : core.EXAM,
          sessionMinutes: isStaff ? STAFF_SESSION_MIN : core.clampSessionMinutes(settings.sessionMinutes),
          expiresAt: Date.now() + expiryMs(isStaff ? 'admin' : 'student')
        };
        return ok(clone(session));
      },

      logout: function () { session = null; return ok(true); },
      session: function () { return ok(sessionAlive() ? clone(session) : null); },

      /* Priority 9 — the remaining time is reported by the data layer, so the
         countdown a student sees is the real one and refreshing cannot extend
         it. */
      sessionInfo: function () {
        if (!sessionAlive()) {
          return ok({
            active: false, expiresInSec: 0,
            sessionMinutes: settings.sessionMinutes,
            sessionWarnMinutes: settings.sessionWarnMinutes,
            warnInSec: warnSec()
          });
        }
        return ok({
          active: true,
          id: session.id,
          role: session.role,
          /* The length settled at login, not the current setting: a change made
             now applies to the next login, never to a session already running. */
          sessionMinutes: session.sessionMinutes,
          sessionWarnMinutes: core.clampWarnMinutes(settings.sessionWarnMinutes, session.sessionMinutes),
          /* The warning lead time is sent in seconds so the page never has to
             do the clamping itself. It is read live, so a change management
             makes now reaches a student who is already signed in. */
          warnInSec: core.clampWarnMinutes(settings.sessionWarnMinutes, session.sessionMinutes) * 60,
          expiresAt: session.expiresAt,
          expiresInSec: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
        });
      },

      unlockConsole: function (passcode) {
        var e = requireStaff(); if (e) return e;
        if (String(passcode) !== PASSCODE) return fail('Incorrect passcode — access denied.');
        session.unlocked = true;
        return ok({ unlocked: true });
      },
      lockConsole: function () { if (session) session.unlocked = false; return ok(true); },
      /* A manager replaces the starting password the Founder typed. The offline demo has only the
         two seeded accounts, whose password is the Founder's to change in the console, so it
         refuses after the same checks the server makes. */
      changeStaffPassword: function (current, next) {
        var e = requireStaff(); if (e) return e;
        var bad = core.managerPasswordChangeError(current, next);
        if (bad) return fail(bad);
        return fail('This account’s password is changed by the Founder in the console.');
      },
      passcodeLength: function () { return PASSCODE.length; },

      listStudents: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok(students.map(publicStudent));
      },

      /* The console shows which staff accounts are authorised. Titles and names
         only — never a password field, in either driver. */
      listStaff: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok(staff.map(function (a) { return { id: a.id, name: a.name, title: a.title }; }));
      },

      /* Sign-up is open to the public: no session and no access code. Every self-made
         account is Open. */
      createStudent: function (data) {
        var name = String((data && data.name) || '').trim();
        var pw = String((data && data.password) || '');
        if (name.length < 2) return fail('Enter your full name.');
        if (pw.length < 6) return fail('Choose a password of at least 6 characters.');
        /* This academy registers UTME candidates only. */
        var ex = core.requireExam(data && data.goal);
        if (!ex.ok) return fail(ex.error);
        /* Use of English plus exactly three sciences — checked here, not only
           in the form, so the rule holds however the call arrives. */
        var sub = core.validateSubjects((data && data.subjects) || []);
        if (!sub.ok) return fail(sub.error);
        var max = 0;
        students.forEach(function (s) {
          var n = parseInt(String(s.id).replace('GOC-S-', ''), 10);
          if (!isNaN(n) && n > max) max = n;
        });
        var rec = {
          id: 'GOC-S-' + pad3(max + 1), name: name, pw: pw,
          /* Kept like the server keeps them, so the Profile reminders row can
             tell whether there is an address to write to. */
          email: String((data && data.email) || '').trim(),
          phone: String((data && data.phone) || '').trim(),
          /* Admin-approval flow: account starts inactive, pending approval. */
          last: 'Awaiting approval', tag: 'a', tl: 'Pending',
          xp: 0, streak: 0, active: false, pendingApproval: true,
          subjects: sub.subjects,
          tier: 'open'   /* self-registered accounts are Open, as on the server */
        };
        students.push(rec);
        /* No session is issued — the student must wait for approval. */
        return ok({ pending: true, student: { id: rec.id, name: rec.name } });
      },

      /* Admin: enrol a student in person. Same validation as the public
         sign-up above, but no access code (staff are already unlocked) and
         a temporary password is issued instead of one the student chose —
         same "honest demo" behaviour every other mock method already has:
         it works, but nothing here survives a refresh. */
      addStudent: function (data) {
        var e = requireUnlocked(); if (e) return e;
        var name = String((data && data.name) || '').trim();
        if (name.length < 2) return fail("Enter the student's full name.");
        var ex = core.requireExam(data && data.goal);
        if (!ex.ok) return fail(ex.error);
        var sub = core.validateSubjects((data && data.subjects) || []);
        if (!sub.ok) return fail(sub.error);
        var newTier = core.newStudentTier(data && data.tier);
        if (!newTier.ok) return fail(newTier.error);
        var max = 0;
        students.forEach(function (s) {
          var n = parseInt(String(s.id).replace('GOC-S-', ''), 10);
          if (!isNaN(n) && n > max) max = n;
        });
        var t = 'GOC' + (1000 + Math.floor(Math.random() * 8999));
        var rec = {
          id: 'GOC-S-' + pad3(max + 1), name: name, pw: t,
          email: String((data && data.email) || '').trim(),
          phone: String((data && data.phone) || '').trim(),
          last: 'Just registered', tag: 'g', tl: 'New',
          xp: 0, streak: 0, active: true, subjects: sub.subjects,
          mustChangePassword: true,
          tier: newTier.tier   /* GOC unless the console chose Open */
        };
        students.push(rec);
        return ok({ student: publicStudent(rec), temporaryPassword: t });
      },

      /* Reveal only exists because this mode has no server. The http driver
         refuses it, which is the correct behaviour for hashed passwords. */
      revealPassword: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var s = find(students, norm(id));
        if (!s) return fail('No such Scholar ID.');
        return ok({ id: s.id, password: s.pw, demoOnly: true });
      },

      resetPassword: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var s = find(students, norm(id));
        if (!s) return fail('No such Scholar ID.');
        var t = 'GOC' + (1000 + Math.floor(Math.random() * 8999));
        s.pw = t;
        return ok({ id: s.id, temporaryPassword: t, mustChange: true });
      },

      listUpdates: function () { return ok(clone(updates)); },

      listAffirmations: function () { return ok(clone(affirmations)); },

      /* B#2 scholarship — mock returns 'open' always in demo mode */
      getScholarshipStatus: function () { return ok({ mode: 'open', places: 30 }); },
      submitScholarApplication: function () { return fail('Scholarship applications need a server connection. Demo mode does not store them.'); },
      submitWaitlistEntry:      function () { return fail('Waitlist submissions need a server connection. Demo mode does not store them.'); },
      listScholarshipApplications:  function () { return fail('Scholarship console needs a server connection.'); },
      decideScholarshipApplication: function () { return fail('Scholarship decisions need a server connection.'); },
      approveScholarshipApplication: function () { return fail('Scholarship approvals need a server connection.'); },
      deleteScholarshipApplication: function () { return fail('Scholarship deletions need a server connection.'); },
      exportScholarshipApplications: function () { return fail('Scholarship export needs a server connection.'); },

      /* Mirrors server.js's PUT /api/affirmations exactly: replaces the whole
         pool, drops blanks, caps length/count, and refuses to leave the flyer
         with nothing to show. */
      saveAffirmations: function (list) {
        var e = requireUnlocked(); if (e) return e;
        var cleaned = (Array.isArray(list) ? list : [])
          .map(function (m) { return String(m == null ? '' : m).replace(/\s+/g, ' ').trim().slice(0, 300); })
          .filter(function (m) { return !!m; })
          .slice(0, 50);
        if (!cleaned.length) return fail('Add at least one affirmation before saving.');
        affirmations = cleaned;
        return ok(clone(affirmations));
      },

      recordContactMessage: function (data) {
        var name = String((data && data.name) || '').trim();
        var email = String((data && data.email) || '').trim();
        var message = String((data && data.message) || '').trim();
        if (!name || !email || !message) return fail('Please fill in your name, email and message.');
        contactMessages.push({ name: name, email: email, message: message, date: todayLabel() });
        return ok({ ok: true });
      },

      createUpdate: function (data) {
        var e = requireUnlocked(); if (e) return e;
        var title = String((data && data.title) || '').trim();
        var body = String((data && data.body) || '').trim();
        if (!title || !body) return fail('Add a headline and message first.');
        var rec = {
          id: ++seq,
          cat: String((data && data.cat) || 'news'),
          date: todayLabel(),
          title: title, body: body,
          ctaLabel: 'Learn more →', ctaAction: "go('signup')"
        };
        updates.unshift(rec);
        return ok(clone(rec));
      },

      removeUpdate: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var before = updates.length;
        updates = updates.filter(function (u) { return u.id !== Number(id); });
        if (updates.length === before) return fail('That update no longer exists.');
        return ok(true);
      },

      getSettings: function () { return ok(clone(settings)); },

      setDailyLimit: function (min) {
        var e = requireUnlocked(); if (e) return e;
        var v = Math.max(30, Math.min(180, Number(min) || 90));
        settings.dailyLimitMin = v;
        return ok(clone(settings));
      },

      /* Mirrors server.js's PUT /api/settings guardianPin handling exactly:
         an empty string clears the PIN back to "feature off"; anything else
         must normalize to 4-8 digits or the change is refused outright, so a
         typo can never lock the feature into an unusable PIN silently. */
      setGuardianPin: function (pin) {
        var e = requireUnlocked(); if (e) return e;
        var raw = String(pin == null ? '' : pin).trim();
        if (!raw) {
          settings.guardianPin = null;
        } else {
          var norm = core.normalizeGuardianPin(raw);
          if (!norm) return fail('A guardian PIN must be 4 to 8 digits.');
          settings.guardianPin = norm;
        }
        return ok(clone(settings));
      },

      /* Priority 9 — management sets how long a student may stay signed in.
         Shortening the session can leave the warning lead time longer than the
         session itself, so it is re-clamped in the same breath. */
      setSessionMinutes: function (min) {
        var e = requireUnlocked(); if (e) return e;
        settings.sessionMinutes = core.clampSessionMinutes(min);
        settings.sessionWarnMinutes = core.clampWarnMinutes(settings.sessionWarnMinutes, settings.sessionMinutes);
        return ok(clone(settings));
      },

      /* Priority 9 — and how much notice the student is given before it ends. */
      setSessionWarnMinutes: function (min) {
        var e = requireUnlocked(); if (e) return e;
        settings.sessionWarnMinutes = core.clampWarnMinutes(min, settings.sessionMinutes);
        return ok(clone(settings));
      },

      /* The objective sitting's clock, and how many questions each paper in it
         serves. Management's to set; a student cannot shorten or lengthen the
         paper they are given. */
      setObjectiveMinutes: function (min) {
        var e = requireUnlocked(); if (e) return e;
        settings.objectiveMinutes = core.clampObjectiveMinutes(min);
        return ok(clone(settings));
      },
      setObjectiveCount: function (subject, n) {
        var e = requireUnlocked(); if (e) return e;
        var sub = String(subject || '');
        if (core.ALL_SUBJECTS.indexOf(sub) === -1) return fail('That is not one of the academy’s subjects.');
        if (!settings.objectiveCounts) settings.objectiveCounts = {};
        settings.objectiveCounts[sub] = core.objectiveCount(sub, (function () {
          var o = {}; o[sub] = n; return o;
        }()));
        /* The same answer the server gives, so the console cannot read one shape
           in the demo and another against a real back end. */
        return ok({ subject: sub, questions: settings.objectiveCounts[sub],
                    ceiling: core.objectiveCeiling(sub),
                    objectiveCounts: clone(settings.objectiveCounts) });
      },
      /* The JAMB-oriented sitting's clock and per-paper counts — independent of
         the objective ones, same shape. */
      setJambMinutes: function (min) {
        var e = requireUnlocked(); if (e) return e;
        settings.jambMinutes = core.clampJambMinutes(min);
        return ok(clone(settings));
      },
      /* The depth bar for the JAMB sitting — the academy's to move, clamped to
         1..40 exactly as the server clamps it. Returns the settings, like
         setJambMinutes. */
      setJambReadyMin: function (min) {
        var e = requireUnlocked(); if (e) return e;
        settings.jambReadyMin = core.clampJambReadyMin(min);
        return ok(clone(settings));
      },
      /* Phase 3E.B: Web Test rounds. Opening a round lets a finished Theory or
         Objective section be sat again; the one-sit rule counts only the current
         round (see sitStatus / core.canSit). Objective and JAMB are sat under
         OBJECTIVE_SUBJECT; theory is per subject. */
      openRound: function (section, subject) {
        var e = requireUnlocked(); if (e) return e;
        var t = roundTargetDemo(section, subject);
        if (t.error) return fail(t.error);
        if (!settings.rounds) settings.rounds = {};
        var key = t.section + '|' + t.subject;
        var next = currentRound(t.section, t.subject) + 1;
        settings.rounds[key] = next;
        return ok({ opened: true, section: t.section, subject: t.subject,
                    round: next, served: roundServedDemo(t.section, t.subject) });
      },
      getRound: function (section, subject) {
        var e = requireUnlocked(); if (e) return e;
        var t = roundTargetDemo(section, subject);
        if (t.error) return fail(t.error);
        return ok({ section: t.section, subject: t.subject,
                    round: currentRound(t.section, t.subject), served: roundServedDemo(t.section, t.subject) });
      },
      /* Test-only (leading underscore = excluded from the parity check): lets a
         suite that sits the JAMB paper on the thin seed bank lower the bar
         without signing in as management. */
      _setJambReadyMin: function (min) { settings.jambReadyMin = core.clampJambReadyMin(min); },
      /* Test-only: a public sign-up is Open, so a suite that sits Web Tests promotes its student, as the console would. */
      _setTier: function (id, tier) { var st = find(students, id); if (st) st.tier = core.cleanTier(tier); },
      setJambCount: function (subject, n) {
        var e = requireUnlocked(); if (e) return e;
        var sub = String(subject || '');
        if (core.ALL_SUBJECTS.indexOf(sub) === -1) return fail('That is not one of the academy’s subjects.');
        if (!settings.jambCounts) settings.jambCounts = {};
        settings.jambCounts[sub] = core.jambCount(sub, (function () {
          var o = {}; o[sub] = n; return o;
        }()));
        return ok({ subject: sub, questions: settings.jambCounts[sub],
                    ceiling: core.jambCeiling(sub),
                    jambCounts: clone(settings.jambCounts) });
      },
      /* What the sitting would look like right now, per paper, so a shortfall in
         the bank is visible in the console before a student meets it. */
      objectiveBlueprint: function (f) {
        var e = requireUnlocked(); if (e) return e;
        var period = core.normalizePeriod(f && f.period);
        var rows = core.objectiveBlueprint(questions, core.ALL_SUBJECTS, settings.objectiveCounts);
        return ok({ period: period, periodLabel: core.PERIOD_LABEL,
                    minutes: core.clampObjectiveMinutes(settings.objectiveMinutes),
                    minutesLabel: core.hoursLabel(core.clampObjectiveMinutes(settings.objectiveMinutes)),
                    ceiling: core.OBJECTIVE_CEILING, papers: rows,
                    fullCombinationTotal: core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 });
      },
      jambBlueprint: function (f) {
        var e = requireUnlocked(); if (e) return e;
        var period = core.normalizePeriod(f && f.period);
        var rows = core.jambBlueprint(questions, core.ALL_SUBJECTS, settings.jambCounts);
        /* Readiness is judged over every academy subject — the console sees the
           whole bank, not one student's combination (as on the server). */
        var readiness = core.jambReadiness(questions, core.ALL_SUBJECTS, settings.jambReadyMin);
        return ok({ period: period, periodLabel: core.PERIOD_LABEL,
                    minutes: core.clampJambMinutes(settings.jambMinutes),
                    minutesLabel: core.hoursLabel(core.clampJambMinutes(settings.jambMinutes)),
                    readyMin: readiness.min, readiness: readiness,
                    ceiling: core.OBJECTIVE_CEILING, papers: rows,
                    fullCombinationTotal: core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 });
      },

      /* ============================================ STUDENT: the Web Test system */

      myProfile: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var p = perfFor(s.id);
        return ok({
          id: s.id, name: s.name, exam: core.EXAM,
          subjects: (s.subjects || []).slice(),
          xp: s.xp || 0, streak: s.streak || 0, streakFreezes: s.streakFreezes || 0,
          level: core.levelFor(s.xp || 0),
          xpIntoLevel: core.xpIntoLevel(s.xp || 0),
          xpPerLevel: core.xpPerLevel(),
          performance: p.overall, performanceDetail: p,
          active: s.active !== false,
          tier: core.cleanTier(s.tier),
          features: core.tierFeatures(s.tier),
          limits: core.tierLimits(s.tier),
          today: {
            day: core.lagosDay(),
            practice: core.dailyAllowance(0, s.tier),
            reviews: core.reviewAllowance(reviewsUsedToday(s.id), s.tier)
          }
        });
      },

      /* The catalogue a student may sit. Theory is one paper per subject, because
         a written paper is marked subject by subject. Objective is a single
         sitting of the whole combination, so it appears once however many
         subjects it covers. There is one test, not a weekly and a monthly one,
         so each paper appears exactly once. The JAMB-oriented paper is a second
         full-combination timed sitting, listed once alongside the Objective one. */
      listMyTests: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var subs = (s.subjects || []).slice();
        var rows = [], period = core.PERIOD;
        subs.forEach(function (sub) {
          var n = core.eligible(questions, { section: 'theory', subject: sub }).length;
          if (n) {
            rows.push(Object.assign({ period: period, section: 'theory', subject: sub,
                        questions: n, durationSec: 0 }, sitStatus(s.id, 'theory', sub)));
          }
        });
        var bp = core.objectiveBlueprint(questions, subs, settings.objectiveCounts);
        var total = core.objectiveTotal(bp);
        if (total) {
          rows.push(Object.assign({ period: period, section: 'objective', subject: core.OBJECTIVE_SUBJECT,
                      questions: total, durationSec: core.clampObjectiveMinutes(settings.objectiveMinutes) * 60,
                      papers: bp.map(function (r) { return { subject: r.subject, questions: r.serving }; }) },
                      sitStatus(s.id, 'objective', core.OBJECTIVE_SUBJECT)));
        }
        var jbp = core.jambBlueprint(questions, subs, settings.jambCounts);
        var jTotal = core.objectiveTotal(jbp);
        /* Held back until the bank is deep enough in every one of this student's
           subjects — a thin paper is never offered. */
        if (jTotal && core.jambOffered(questions, subs, settings.jambReadyMin)) {
          rows.push(Object.assign({ period: period, section: 'jamb', subject: core.OBJECTIVE_SUBJECT,
                      questions: jTotal, durationSec: core.clampJambMinutes(settings.jambMinutes) * 60,
                      papers: jbp.map(function (r) { return { subject: r.subject, questions: r.serving }; }) },
                      sitStatus(s.id, 'jamb', core.OBJECTIVE_SUBJECT)));
        }
        /* Open students still see the papers, marked locked; startTest is the real gate. */
        rows.forEach(function (r) { if (!core.webTestAllowed(r.section, s.tier)) r.locked = true; });
        return ok({ subjects: subs, tests: rows,
                    objectiveMinutes: core.clampObjectiveMinutes(settings.objectiveMinutes),
                    jambMinutes: core.clampJambMinutes(settings.jambMinutes) });
      },

      startTest: function (d) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        if (core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)).exhausted) {
          return fail("Today's study window is used up — read on your own for now and come back tomorrow.");
        }
        /* Whatever period a client asks for, there is one test to sit. An older
           page still saying 'weekly' is answered, not refused. */
        var period = core.normalizePeriod(d && d.period);
        var section = String((d && d.section) || '');
        var subject = String((d && d.subject) || '');
        if (core.SECTIONS.indexOf(section) === -1) return fail('Choose a test section.');
        /* ACCESS TIER: same gate as the server, before anything is opened or recorded. */
        if (core.WEB_TEST_SECTIONS.indexOf(section) > -1 && !core.webTestAllowed(section, s.tier)) {
          return fail(core.webTestLockMessage(section));
        }
        var pool, dur, subs = (s.subjects || []).slice(), papers = null;
        /* A question whose passage cannot be shown is held back, as on the server. */
        var bank = core.servablePool(questions, passages);
        if (section === 'objective') {
          /* One sitting of the whole combination: the student chooses nothing but
             when to begin, exactly as in the hall. */
          var bp = core.objectiveBlueprint(bank, subs, settings.objectiveCounts);
          pool = core.objectivePaper(bank, subs, settings.objectiveCounts);
          if (!pool.length) return fail('No questions have been published for that sitting yet.');
          subject = core.OBJECTIVE_SUBJECT;
          dur = core.clampObjectiveMinutes(settings.objectiveMinutes) * 60;
          papers = bp.filter(function (r) { return r.serving > 0; })
                     .map(function (r) { return { subject: r.subject, questions: r.serving }; });
        } else if (section === 'jamb') {
          /* The JAMB-oriented sitting: assembled like objective but from the jamb
             pool (jamb-tagged + objective questions), on its own clock/counts. */
          /* The catalogue hides a thin sitting; this is the gate that enforces
             it, checked before anything is opened or recorded. */
          if (!core.jambOffered(bank, subs, settings.jambReadyMin)) {
            return fail('The JAMB-oriented sitting is not open yet — its question bank is still being built.');
          }
          var jbp = core.jambBlueprint(bank, subs, settings.jambCounts);
          /* A repeat draws questions this student has not met yet first. */
          var seen = core.jambSeenCounts(attempts.filter(function (a) { return a.scholarId === s.id; }));
          pool = core.jambPaper(bank, subs, settings.jambCounts, undefined, seen);
          if (!pool.length) return fail('No questions have been published for that sitting yet.');
          subject = core.OBJECTIVE_SUBJECT;
          dur = core.clampJambMinutes(settings.jambMinutes) * 60;
          papers = jbp.filter(function (r) { return r.serving > 0; })
                      .map(function (r) { return { subject: r.subject, questions: r.serving }; });
        } else {
          if (subs.indexOf(subject) === -1) {
            return fail(subject + ' is not part of your registered subject combination.');
          }
          /* Some subjects are examined in the objective sitting only. `eligible`
             would serve nothing anyway, but "nothing published yet" would be the
             wrong reason to give — say the real one. */
          if (!core.theoryAllowed(subject)) return fail(core.noTheoryMessage(subject));
          pool = core.eligible(bank, { section: section, subject: subject });
          if (!pool.length) return fail('No questions have been published for that test yet.');
          dur = 0;   /* a written paper is sat without a clock */
        }
        // ONE-SIT RULE: same gate as server.js — checked here too, not just
        // in the catalogue, so a stale page or a replayed request can never
        // reopen a test that has already been submitted.
        if (sitStatus(s.id, section, subject).completed) {
          return fail('You have already submitted this test. It cannot be sat again.');
        }
        var rec = {
          id: 'A' + (++aSeq) + '-' + Date.now().toString(36),
          scholarId: s.id, studentName: s.name,
          period: period, section: section, subject: subject,
          roundId: currentRound(section, subject),
          questionIds: pool.map(function (r) { return r.id; }),
          startedAt: Date.now(), durationSec: dur
        };
        openAttempts[rec.id] = rec;
        return ok({
          attemptId: rec.id, period: period, section: section, subject: subject,
          kind: section === 'theory' ? 'theory' : 'objective',
          papers: papers, total: pool.length, durationSec: dur,
          questions: core.attachPassages(pool, passages).map(core.forStudent)   /* answers stripped out, passage attached */
        });
      },

      submitTest: function (d) {
        var e = requireStudent(); if (e) return e;
        var id = String((d && d.attemptId) || '');
        var open = openAttempts[id];
        if (!open) return fail('That test session has ended. Start the test again.');
        if (open.scholarId !== session.id) return fail('That test does not belong to this Scholar ID.');
        var pool = open.questionIds.map(function (qid) { return find(questions, qid); })
                                   .filter(function (r) { return !!r; });
        var m = core.markAttempt(pool, (d && d.responses) || {});
        var used = Number(d && d.timeUsedSec);
        if (isNaN(used) || used < 0) used = Math.round((Date.now() - open.startedAt) / 1000);
        var rec = {
          id: open.id, scholarId: open.scholarId, studentName: open.studentName,
          period: open.period, section: open.section, subject: open.subject,
          roundId: core.attemptRound(open),
          questionIds: open.questionIds, startedAt: open.startedAt,
          submittedAt: Date.now(),
          /* An untimed paper has no ceiling to clamp against, so the time is
             simply recorded. Clamping against a zero duration would file every
             theory sitting as having taken no time at all. */
          timeUsedSec: open.durationSec > 0 ? Math.min(used, open.durationSec) : used,
          durationSec: open.durationSec,
          total: m.total, answered: m.answered, unanswered: m.unanswered,
          correct: m.correct, wrong: m.wrong, score: m.score, maxScore: m.maxScore,
          percent: m.percent, status: m.status, answers: m.answers, xpAwarded: 0
        };
        attempts.push(rec);
        delete openAttempts[id];
        var stu = find(students, rec.scholarId);
        /* XP: full award once a paper is marked; completion XP only while a
           theory paper is still waiting for an administrator. */
        var gain = rec.status === 'marked' ? core.xpForAttempt(rec.percent) : 10;
        rec.xpAwarded = gain;
        if (stu) { stu.xp = (stu.xp || 0) + gain; bumpStreakRecord(stu); }
        return ok(summariseOwn(rec, gain, stu));
      },

      /* ================================== STUDENT: self-directed study
         Reading mode, the practice run and the student-configured CBT. These are
         study tools, not assessments: nothing here is filed in the academic
         record, appears in the console results table, or moves the league. That
         separation is what makes it safe for a practice question to travel with
         its answer, which is the only way an answer can be marked the instant it
         is chosen while the app is offline. */

      /* Only the papers this student sits, only topics that actually hold live
         objective questions. */
      studyCatalogue: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var rows = (s.subjects || []).map(function (sub) {
          var topics = core.studyTopics(questions, sub);
          return {
            subject: sub,
            questions: topics.reduce(function (m, t) { return m + t.questions; }, 0),
            topics: topics,
            years: core.studyYears(questions, sub)
          };
        });
        var notesBySubject = (s.subjects || []).map(function (sub) {
          var seen = {}, tps = [];
          notes.forEach(function (n) {
            if (!n.active || n.subject !== sub) return;
            if (seen[n.topic] === undefined) { seen[n.topic] = tps.length; tps.push({ topic: n.topic, notes: 0 }); }
            tps[seen[n.topic]].notes++;
          });
          return { subject: sub, topics: tps, notes: tps.reduce(function (m, t) { return m + t.notes; }, 0) };
        });
        var win = core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s));
        return ok(Object.assign({ subjects: rows, reading: notesBySubject, maxQuestions: core.STUDY_MAX }, win));
      },

      /* The heartbeat behind the daily study window — see server.js's
         /me/study-time/ping for the full explanation. This driver keeps the
         running total on the student record itself, same as practiceXpToday. */
      pingStudyTime: function (seconds) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var addSec = core.clampStudyPingSeconds(seconds);
        var before = studySecToday(s);   // reads the *old* day stamp first, so a rollover correctly resets to 0
        s.studyDay = core.dayStamp();
        s.studySecToday = before + addSec;
        return ok(core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)));
      },

      /* Offline mirror of server.js's POST /me/study-time/extend: same
         guardian-PIN check, same daily grant cap, same fixed grant size —
         enforced locally so a file:// preview with no server behaves like
         the live one instead of silently accepting or always refusing. */
      extendStudyTime: function (pin) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        if (!core.normalizeGuardianPin(settings.guardianPin)) {
          return fail('No guardian PIN has been set for this academy.');
        }
        if (!core.guardianPinMatches(settings.guardianPin, pin)) {
          return fail('That PIN is not correct.');
        }
        if (studyExtendCountToday(s) >= core.EXTRA_TIME_MAX_GRANTS_PER_DAY) {
          return fail("Today's extra time has already been used up.");
        }
        var today = core.dayStamp();
        s.studyBonusDay = today;
        s.studyBonusMin = studyBonusMinToday(s) + core.EXTRA_TIME_GRANT_MIN;
        s.studyExtendCount = studyExtendCountToday(s) + 1;
        return ok(core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)));
      },

      /* Reading mode. A student may only read notes for a paper they sit, and
         only notes management has left active. */
      listNotes: function (filter) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var f = filter || {};
        var rows = notes.filter(function (n) {
          if (!n.active) return false;
          if ((s.subjects || []).indexOf(n.subject) === -1) return false;
          if (f.subject && n.subject !== f.subject) return false;
          if (f.topic && n.topic !== f.topic) return false;
          return true;
        });
        /* Access tiers: an Open student reads the first few notes of each subject
           (by note id among the subject's active notes, so the topic filter does not
           move the line); the rest are listed but locked, with no body. */
        var tier = core.cleanTier(s.tier), place = {}, seenIn = {};
        notes.filter(function (n) { return n.active && (s.subjects || []).indexOf(n.subject) !== -1; })
          .sort(function (a, b) { return Number(a.id) - Number(b.id); })
          .forEach(function (n) { seenIn[n.subject] = seenIn[n.subject] || 0; place[n.id] = seenIn[n.subject]++; });
        return ok({ notes: clone(rows).map(function (n) { return core.noteVisible(place[n.id], tier) ? n : core.lockedNote(n); }) });
      },

      startStudy: function (d) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        if (core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s)).exhausted) {
          return fail("Today's study window is used up — read on your own for now and come back tomorrow.");
        }
        var r = d || {};
        var mode = String(r.mode || 'cbt');
        var subject = String(r.subject || '');
        if (core.STUDY_MODES.indexOf(mode) === -1) return fail('Choose practice or CBT.');
        if (mode === 'practice' && subject === core.PRACTICE_ALL_SUBJECTS) {
          return fail('Choose a single subject to practice.');
        }
        if ((s.subjects || []).indexOf(subject) === -1) {
          return fail(subject + ' is not part of your registered subject combination.');
        }
        if (mode === 'practice') {
          var openElsewhere = null;
          Object.keys(openStudy).forEach(function (id) {
            var v = openStudy[id];
            if (!openElsewhere && v.scholarId === s.id && v.mode === 'practice' && v.subject !== subject) openElsewhere = v;
          });
          if (openElsewhere) {
            return fail('Finish or submit your ' + openElsewhere.subject +
              ' practice run before starting a different subject.');
          }
        }
        /* Practice may be narrowed by topic and by past-paper year; CBT by topic only. */
        var year = [];
        if (mode === 'practice') {
          var yc = core.cleanYearList(r.years !== undefined ? r.years : r.year);
          if (yc.error) return fail(yc.error);
          year = yc.years;
        }
        var pool = core.studyPool(core.servablePool(questions, passages), subject, r.topics, year);
        if (!pool.length) {
          var narrowed = (r.topics && r.topics.length) ? ' in the topics you chose' : '';
          return fail(mode === 'practice'
            ? 'No ' + (year.length ? year.join(', ') + ' ' : '') + 'questions have been published for ' + subject + narrowed + ' yet.'
            : 'No questions have been published for the topics you chose yet.');
        }
        var count = core.clampStudyCount(r.count, pool.length);
        var picked = mode === 'practice'
          ? core.pickPractice(pool, count, practiceRecentIds(s.id, subject))
          : core.pickStudy(pool, count);
        if(mode === 'practice') practiceRecentRemember(s.id, subject, picked.map(function(q){ return q.id; }), pool.length);
        var minutes = mode === 'cbt' ? core.clampStudyMinutes(r.minutes) : 0;
        var rec = {
          id: 'S' + (++sSeq) + '-' + Date.now().toString(36),
          scholarId: s.id, subject: subject, mode: mode,
          questionIds: picked.map(function (q) { return q.id; }),
          startedAt: Date.now(), durationSec: minutes * 60
        };
        openStudy[rec.id] = rec;
        if (mode === 'practice') {
          /* A practice paper carries its answers, because it is marked in the
             page as each option is tapped. The run is still registered here so
             that finishing it can be marked again on this side and earn XP no
             screen was trusted to calculate. */
          return ok({
            mode: mode, paperId: rec.id, subject: subject,
            topics: picked.map(function (q) { return q.topic; }),
            total: picked.length, durationSec: 0,
            xpPerAnswer: core.PRACTICE_XP_PER_ANSWER,
            xpPerCorrect: core.PRACTICE_XP_PER_CORRECT,
            xpLeftToday: core.practiceXpRemaining(practiceXpToday(s)),
            questions: core.attachPassages(picked, passages).map(core.forPractice)
          });
        }
        return ok({
          mode: mode, paperId: rec.id, subject: subject,
          total: picked.length, durationSec: rec.durationSec,
          questions: core.attachPassages(picked, passages).map(core.forStudent)     /* answers stripped out */
        });
      },

      /* Marks a self-directed run and returns the full review. Nothing is written
         to the academic record — see the note at the top of this block — but a
         practice run does earn XP, so effort outside the exam still counts. */
      submitStudy: function (d) {
        var e = requireStudent(); if (e) return e;
        var id = String((d && d.paperId) || '');
        var open = openStudy[id];
        if (!open) return fail('That study run has ended. Set it up again.');
        if (open.scholarId !== session.id) return fail('That study run does not belong to this Scholar ID.');
        var pool = open.questionIds.map(function (qid) { return find(questions, qid); })
                                   .filter(function (r) { return !!r; });
        var m = core.markAttempt(pool, (d && d.responses) || {});
        var used = Number(d && d.timeUsedSec);
        if (isNaN(used) || used < 0) used = Math.round((Date.now() - open.startedAt) / 1000);
        delete openStudy[id];
        var mode = open.mode || 'cbt';
        var stu = find(students, session.id);
        var gain = 0, left = 0, questBonus = 0, questClaimed = false, quest = null;
        var weekAfter = null, weekReward = null;
        if (mode === 'practice' && stu) {
          /* Marked here, not in the page: the XP is calculated from this side's
             own marking, so nothing a student's browser sends can inflate it. */
          left = core.practiceXpRemaining(practiceXpToday(stu));
          gain = Math.min(left, core.xpForPractice(m.answered, m.correct));
          /* Daily quest reward (Phase 2, slice 5), mirroring the server: done
             is judged from this run as marked here plus the stored runs, paid
             from the same daily allowance, and claimed once per day. */
          var thisRun = {
            ts: Date.now(), subject: open.subject,
            review: pool.map(function (q, i) {
              var a = m.answers[i] || {};
              return { subject: open.subject, topic: q.topic, given: a.given === undefined ? null : a.given, isCorrect: !!a.isCorrect };
            })
          };
          quest = core.dailyQuest([thisRun].concat(demoRuns(session.id, practiceRuns[session.id])));
          var qr = core.questReward(quest, stu.questDay, practiceXpToday(stu) + gain);
          questBonus = qr.award; questClaimed = qr.claim;
          if (gain + questBonus > 0) {
            stu.xp = (stu.xp || 0) + gain + questBonus;
            stu.practiceXpDay = core.dayStamp();
            stu.practiceXpToday = practiceXpToday(stu) + gain + questBonus;
          }
          if (qr.claim) stu.questDay = qr.day;
          /* Weekly quest (Phase 2, weekly slices 2 and 3), mirroring the server:
             this run is folded into the calendar week from what was marked
             here, and finishing the week pays one streak freeze on top of any
             the streak itself spends on this run (held back, unpaid, while the
             student already holds the most). */
          var weekToday = core.dayStamp();
          var spentTo = core.streakAfterActivity(stu.streak, stu.streakDay, undefined, stu.streakFreezes).freezes;
          weekAfter = core.weeklyQuestAfterRun(stu.weekQuest, weekToday, { answered: m.answered, dailyClaimed: qr.claim });
          weekReward = core.weeklyReward(core.weeklyQuest(weekAfter, weekToday), spentTo);
          if (weekReward.claim) weekAfter = core.weeklyQuestClaimed(weekAfter, weekToday);
          stu.weekQuest = weekAfter;
        }
        /* A submitted study run — mock/CBT or practice — is the student's own
           effort for the day whether or not it happens to earn XP, so it is
           what the streak counts, same as on the server. */
        if (stu) bumpStreakRecord(stu);
        if (stu && weekReward && weekReward.claim) stu.streakFreezes = weekReward.freezes;
        return ok({
          mode: mode, subject: open.subject, total: m.total, answered: m.answered,
          unanswered: m.unanswered, correct: m.correct, wrong: m.wrong,
          percent: m.percent,
          timeUsedSec: open.durationSec ? Math.min(used, open.durationSec) : used,
          assessed: false,
          xpAwarded: gain,
          xpTotal: stu ? (stu.xp || 0) : 0,
          level: stu ? core.levelFor(stu.xp || 0) : 1,
          streak: stu ? (stu.streak || 0) : 0,
          xpLeftToday: mode === 'practice' ? Math.max(0, left - gain - questBonus) : 0,
          xpCapped: mode === 'practice' && gain < core.xpForPractice(m.answered, m.correct),
          questXp: questBonus, questClaimed: questClaimed, questDone: !!(quest && quest.done),
          weekQuest: weekAfter ? core.weeklyQuest(weekAfter, core.dayStamp()) : null,
          weekClaimed: !!(weekReward && weekReward.claim),
          freezeAwarded: weekReward ? weekReward.award : 0,
          streakFreezes: stu ? (stu.streakFreezes || 0) : 0,
          review: pool.map(function (q, i) {
            var a = m.answers[i] || {};
            return {
              n: i + 1, questionId: q.id, topic: q.topic, text: q.text,
              options: (q.options || []).slice(), answer: q.answer,
              given: a.given === undefined ? null : a.given,
              isCorrect: !!a.isCorrect, explanation: q.explanation || ''
            };
          }),
          topics: core.topicBreakdown(m.answers)
        });
      },

      /* ------------------------------------------- CONSOLE: reading notes */

      listAllNotes: function (filter) {
        var e = requireUnlocked(); if (e) return e;
        var f = filter || {};
        var rows = notes.filter(function (n) {
          if (f.subject && n.subject !== f.subject) return false;
          if (f.topic && n.topic !== f.topic) return false;
          if (f.activeOnly && !n.active) return false;
          return true;
        });
        return ok({ notes: clone(rows), total: notes.length });
      },

      /* Comprehension passages: the same contract as server.js's /api/passages. */
      listPassages: function (filter) {
        var e = requireUnlocked(); if (e) return e;
        var f = filter || {};
        var rows = passages.filter(function (p) {
          if (f.subject && p.subject !== f.subject) return false;
          if (f.activeOnly && !p.active) return false;
          return true;
        }).map(function (p) {
          var c = clone(p);
          c.questions = questions.filter(function (q) { return Number(q.passageId) === Number(p.id); }).length;
          return c;
        });
        return ok({ passages: rows, total: passages.length });
      },

      createPassage: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validatePassage(d);
        if (v.error) return fail(v.error);
        v.rec.id = ++pSeq;
        passages.push(v.rec);
        return ok(clone(v.rec));
      },

      updatePassage: function (id, d) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(passages, Number(id));
        if (!cur) return fail('That passage no longer exists.');
        var merged = {};
        Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
        Object.keys(d || {}).forEach(function (k) { merged[k] = d[k]; });
        var v = core.validatePassage(merged);
        if (v.error) return fail(v.error);
        if (v.rec.subject !== cur.subject &&
            questions.some(function (q) { return Number(q.passageId) === Number(cur.id); })) {
          return fail('Questions still use this passage, so its subject cannot change.');
        }
        v.rec.id = cur.id;
        passages[passages.indexOf(cur)] = v.rec;
        return ok(clone(v.rec));
      },

      setPassageActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(passages, Number(id));
        if (!cur) return fail('That passage no longer exists.');
        cur.active = !!on;
        return ok(clone(cur));
      },

      deletePassage: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(passages, Number(id));
        if (!cur) return ok({ ok: true, deleted: Number(id), alreadyGone: true });
        if (cur.active) return fail('Hold this passage back before deleting it.');
        var n = questions.filter(function (q) { return Number(q.passageId) === Number(cur.id); }).length;
        if (n) return fail(n + ' question' + (n !== 1 ? 's' : '') + ' still use this passage — unlink or delete ' + (n !== 1 ? 'them' : 'it') + ' first.');
        passages.splice(passages.indexOf(cur), 1);
        return ok({ ok: true, deleted: cur.id });
      },

      createNote: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateNote(d);
        if (v.error) return fail(v.error);
        v.rec.id = ++nSeq;
        notes.push(v.rec);
        return ok(clone(v.rec));
      },

      updateNote: function (id, d) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(notes, Number(id));
        if (!cur) return fail('That note no longer exists.');
        var merged = {};
        Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
        Object.keys(d || {}).forEach(function (k) { merged[k] = d[k]; });
        var v = core.validateNote(merged);
        if (v.error) return fail(v.error);
        v.rec.id = cur.id;
        notes[notes.indexOf(cur)] = v.rec;
        return ok(clone(v.rec));
      },

      setNoteActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(notes, Number(id));
        if (!cur) return fail('That note no longer exists.');
        cur.active = !!on;
        return ok(clone(cur));
      },

      /* Same contract as the question bank: only a held-back note may be
         deleted, so a note a student may be reading is never pulled away. */
      deleteNote: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(notes, Number(id));
        if (!cur) return ok({ ok: true, deleted: Number(id), alreadyGone: true });
        if (cur.active) return fail('Hold this note back before deleting it.');
        notes.splice(notes.indexOf(cur), 1);
        return ok({ ok: true, deleted: cur.id });
      },

      /* Bulk delete by subject — \"all\" must be explicit, blank is refused. */
      bulkDeleteNotes: function (subject) {
        var e = requireUnlocked(); if (e) return e;
        var raw = String(subject == null ? '' : subject).trim();
        if (!raw) return fail('Choose a subject (or \"all\") before deleting.');
        var all = raw.toLowerCase() === 'all';
        if (!all && core.ALL_SUBJECTS.indexOf(raw) === -1) return fail('Choose one of the academy\u2019s subjects, or \"all\".');
        var before = notes.length;
        var keep = notes.filter(function (n) { return !all && n.subject !== raw; });
        var deleted = before - keep.length;
        if (deleted > 0) { notes.length = 0; keep.forEach(function (n) { notes.push(n); }); }
        return ok({ ok: true, deleted: deleted, remaining: notes.length, subject: all ? 'all' : raw });
      },

      noteCounts: function () {
        var e = requireUnlocked(); if (e) return e;
        var bySubject = {}, totals = { live: 0, held: 0 };
        notes.forEach(function (n) {
          var sub = n.subject || 'Unknown';
          if (!bySubject[sub]) bySubject[sub] = { live: 0, held: 0 };
          var k = n.active ? 'live' : 'held';
          bySubject[sub][k]++; totals[k]++;
        });
        return ok({ bySubject: bySubject, totals: totals });
      },

      myResults: function () {
        var e = requireStudent(); if (e) return e;
        var rows = attemptsFor(session.id).slice().sort(function (a, b) { return b.submittedAt - a.submittedAt; });
        return ok({
          attempts: rows.map(attemptSummary),
          performance: perfFor(session.id)
        });
      },

      myAttempt: function (id) {
        var e = requireStudent(); if (e) return e;
        var a = null;
        attempts.forEach(function (r) { if (String(r.id) === String(id)) a = r; });
        if (!a || a.scholarId !== session.id) return fail('That result is not on your record.');
        return ok(summariseOwn(a, a.xpAwarded, find(students, session.id)));
      },

      /* Practice history (Phase 1), mirroring the http driver so app.js can
         call the same methods whichever mode it is in. A run with no review is
         refused — there would be nothing to review later. */
      recordPractice: function (run) {
        var e = requireStudent(); if (e) return e;
        if (!run || !Array.isArray(run.review) || !run.review.length) {
          return fail('A practice run needs a review with at least one question.');
        }
        var rec = Object.assign({}, run, { ts: Number(run.ts) > 0 ? Number(run.ts) : Date.now() });
        var list = Array.isArray(practiceRuns[session.id]) ? practiceRuns[session.id] : [];
        list.unshift(rec);
        practiceRuns[session.id] = demoRuns(session.id, list);
        return ok({ ok: true, saved: rec, runs: practiceRuns[session.id] });
      },
      listPractice: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ runs: demoRuns(session.id, practiceRuns[session.id]) });
      },

      /* Mistakes review (Phase 2, slice 3), mirroring the http driver. */
      listMistakes: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ mistakes: demoMistakes(session.id) });
      },

      /* Spaced repetition (Phase 2), mirroring GET/POST /api/me/review. The
         answer is judged here, from the stored mistake, never from the caller. */
      listReview: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ review: core.srQueue(demoMistakes(session.id), reviewState[session.id] || {}, Date.now()),
                    today: { day: core.lagosDay(), reviews: core.reviewAllowance(reviewsUsedToday(session.id), tierOf(session.id)) } });
      },
      answerReview: function (key, given) {
        var e = requireStudent(); if (e) return e;
        key = typeof key === 'string' ? key : '';
        if (!/^[A-Za-z0-9]{1,64}$/.test(key)) return fail('Say which question you are answering.');
        if (typeof given !== 'number' || Math.floor(given) !== given || given < 0 || given > 25) return fail('Pick one of the answer options.');
        var mistakes = demoMistakes(session.id);
        var m = mistakes.filter(function (x) { return x.key === key; })[0];
        if (!m) return fail('That question is not in your mistakes.');
        if (!Array.isArray(m.options) || given >= m.options.length) return fail('Pick one of the answer options.');
        /* Access tiers: checked after the question is found, so a bad request is never charged. */
        var usedBefore = reviewsUsedToday(session.id), tier = tierOf(session.id);
        var allowance = core.reviewAllowance(usedBefore, tier);
        if (!allowance.allowed) return fail(core.reviewLimitMessage(allowance.limit));
        reviewCount[session.id] = { day: core.lagosDay(), count: usedBefore + 1 };
        var now = Date.now(), state = reviewState[session.id] || {};
        var correct = given === Number(m.answer);
        var entry = core.srAfterAnswer(core.srEntryFor(m, state) ? state[key] : null, correct, now);
        reviewState[session.id] = core.srStore(state, key, entry);
        var q = core.srQueue(mistakes, reviewState[session.id], now);
        return ok({
          ok: true, today: { day: core.lagosDay(), reviews: core.reviewAllowance(usedBefore + 1, tier) },
          correct: correct, answer: m.answer, explanation: m.explanation || '',
          box: entry.box, mastered: entry.mastered, nextDue: entry.due,
          dueCount: q.dueCount, upcoming: q.upcoming, masteredCount: q.mastered
        });
      },

      /* Daily quest (Phase 2, daily quest slice 3), mirroring GET /api/me/quest. */
      getQuest: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ quest: core.dailyQuest(demoRuns(session.id, practiceRuns[session.id])) });
      },

      /* Weekly quest (Phase 2, weekly quest slice 4), mirroring GET /api/me/weekly-quest. */
      getWeeklyQuest: function () {
        var e = requireStudent(); if (e) return e;
        var stu = find(students, session.id);
        return ok({ weeklyQuest: core.weeklyQuest(stu && stu.weekQuest, core.dayStamp()), streakFreezes: (stu && stu.streakFreezes) || 0 });
      },

      /* Study reminders (Phase 2), mirroring GET/POST /api/me/reminders: on by
         default, switched off or back on, only ever by true/false. Nothing is
         delivered in demo mode, so `deliverable` is always false. */
      getReminders: function () {
        var e = requireStudent(); if (e) return e;
        var stu = find(students, session.id) || {};
        var p = core.cleanReminderPrefs(reminderPrefs[session.id]);
        return ok({ reminders: { email: p.email, sms: p.sms, hasEmail: core.reminderEmailOk(stu.email),
          hasPhone: core.reminderPhoneOk(stu.phone), deliverable: { email: false, sms: false } } });
      },
      setReminders: function (change) {
        var e = requireStudent(); if (e) return e;
        var b = change && typeof change === 'object' ? change : {};
        var hasE = Object.prototype.hasOwnProperty.call(b, 'email'), hasS = Object.prototype.hasOwnProperty.call(b, 'sms');
        if (!hasE && !hasS) return fail('Say which reminders to change.');
        if ((hasE && typeof b.email !== 'boolean') || (hasS && typeof b.sms !== 'boolean')) return fail('Reminders can only be switched on or off.');
        var p = core.cleanReminderPrefs(reminderPrefs[session.id]);
        if (hasE) p.email = b.email;
        if (hasS) p.sms = b.sms;
        reminderPrefs[session.id] = p;
        var stu = find(students, session.id) || {};
        return ok({ ok: true, reminders: { email: p.email, sms: p.sms, hasEmail: core.reminderEmailOk(stu.email),
          hasPhone: core.reminderPhoneOk(stu.phone), deliverable: { email: false, sms: false } } });
      },

      /* Streak freeze (Phase 2, slice 3), mirroring POST /api/me/streak-freeze:
         the same core rule, and the same refusal messages. */
      buyStreakFreeze: function () {
        var e = requireStudent(); if (e) return e;
        var stu = find(students, session.id);
        var r = core.buyStreakFreeze(stu.xp, stu.streakFreezes);
        if (!r.ok) {
          return fail(r.reason === 'max'
            ? 'You already hold the most streak freezes you can (' + core.STREAK_FREEZE_MAX + ').'
            : 'A streak freeze costs ' + core.STREAK_FREEZE_COST_XP + ' XP.');
        }
        stu.xp = r.xp;
        stu.streakFreezes = r.freezes;
        return ok({ ok: true, xp: r.xp, streakFreezes: r.freezes, level: core.levelFor(r.xp),
          cost: core.STREAK_FREEZE_COST_XP, max: core.STREAK_FREEZE_MAX });
      },

      /* Bookmarks (Phase 1, part 2), mirroring the http driver. */
      listBookmarks: function () {
        var e = requireStudent(); if (e) return e;
        var cap = core.tierLimits(tierOf(session.id)).bookmarks;
        return ok({ bookmarks: core.capList(bookmarks[session.id], cap), limit: cap });
      },
      addBookmark: function (b) {
        var e = requireStudent(); if (e) return e;
        var rec = core.sanitizeBookmark(b);
        if (!rec) return fail('A bookmark needs the question text and at least two options.');
        var cap = core.tierLimits(tierOf(session.id)).bookmarks;
        var list = Array.isArray(bookmarks[session.id]) ? core.capList(bookmarks[session.id], cap) : [];
        bookmarks[session.id] = list;
        var existing = null;
        list.forEach(function (x) { if (x.key === rec.key) existing = x; });
        if (existing) return ok({ ok: true, saved: existing, already: true, bookmarks: list });
        /* Full: refuse and say how to make room. Nothing is dropped silently. */
        if (cap != null && list.length >= cap) return fail(core.bookmarkLimitMessage(cap));
        rec.ts = Date.now();
        list.unshift(rec);
        bookmarks[session.id] = core.capList(list, cap);
        return ok({ ok: true, saved: rec, bookmarks: bookmarks[session.id] });
      },
      removeBookmark: function (key) {
        var e = requireStudent(); if (e) return e;
        var list = bookmarks[session.id] || [];
        var next = list.filter(function (x) { return x.key !== String(key); });
        bookmarks[session.id] = next;
        return ok({ ok: true, removed: next.length !== list.length, bookmarks: next });
      },

      /* ================================================ THE SCHOLAR LEAGUE
         Ranked by overall academic performance first and XP only as the
         tie-breaker, so XP can never buy a higher position than results. */
      league: function () {
        if (!sessionAlive()) return fail('Please log in again.');
        var me = session.role === 'student' ? session.id : null;
        var active = students.filter(function (s) { return s.active !== false; });
        /* Cohort-scoped, same rule as the server: a student ranks only
           against their own cohort-mates (or other uncohorted students).
           No cohorts persist in demo mode, so every demo student is always
           uncohorted and this stays a no-op here — kept for shape parity
           with the http driver, and correct the moment demo cohorts do
           persist. */
        var scopeCohortId = null;
        var pool = active;
        if (me) {
          var myRec = null;
          active.forEach(function (s) { if (s.id === me) myRec = s; });
          scopeCohortId = (myRec && myRec.cohort) || null;
          pool = active.filter(function (s) { return (s.cohort || null) === scopeCohortId; });
        }
        var rows = pool.map(function (s) {
          var p = perfFor(s.id);
          return {
            scholarId: s.id, name: s.name, xp: s.xp || 0, streak: s.streak || 0,
            level: core.levelFor(s.xp || 0),
            performance: p.overall, assessed: p.markedAttempts,
            me: s.id === me,
            cohortId: s.cohort || null, cohortName: null
          };
        });
        var ranked = core.rankLeague(rows);
        var mine = null;
        ranked.forEach(function (r) { if (r.me) mine = r; });
        return ok({
          rows: ranked,
          size: ranked.length,
          me: mine,
          league: mine ? core.leagueName(mine.rank, ranked.length) : core.leagueName(1, ranked.length),
          basis: 'Overall academic performance first, then Academy XP.',
          scope: (me && scopeCohortId) ? { cohortId: scopeCohortId, cohortName: null } : null
        });
      },

      /* ========================================= CONSOLE: the question bank
         This extends the console's existing Question bank section rather than
         adding a second question system. */

      listQuestions: function (filter) {
        var e = requireUnlocked(); if (e) return e;
        var f = filter || {};
        var rows = questions.filter(function (r) {
          if (f.subject && r.subject !== f.subject) return false;
          if (f.section && r.section !== f.section) return false;
          /* No period filter: there is one test, and a record written when the
             academy ran weekly and monthly papers still belongs to it. */
          if (f.kind && r.kind !== f.kind) return false;
          if (f.activeOnly && !r.active) return false;
          return true;
        });
        return ok({ questions: clone(rows), total: questions.length });
      },

      /* Section×subject totals — see server.js's GET /api/questions/counts for
         why this exists as its own call instead of being derived client-side
         from listQuestions(). */
      questionCounts: function () {
        var e = requireUnlocked(); if (e) return e;
        var bySubject = {};
        var totals = { theory: 0, objective: 0, jamb: 0, practice: 0 };
        questions.forEach(function (q) {
          var sub = q.subject || 'Unknown';
          if (!bySubject[sub]) bySubject[sub] = { theory: 0, objective: 0, jamb: 0, practice: 0 };
          var sec = q.section;
          if (Object.prototype.hasOwnProperty.call(totals, sec)) {
            bySubject[sub][sec]++;
            totals[sec]++;
          }
        });
        return ok({ bySubject: bySubject, totals: totals });
      },

      createQuestion: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var v = validateQuestion(d);
        if (v.error) return fail(v.error);
        var pl = core.passageLinkError(v.rec, passages);
        if (pl) return fail(pl);
        var il = imageLinkError(v.rec);
        if (il) return fail(il);
        v.rec.id = ++qSeq;
        questions.push(v.rec);
        return ok(clone(v.rec));
      },

      updateQuestion: function (id, d) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(questions, Number(id));
        if (!cur) return fail('That question no longer exists.');
        var merged = {};
        Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
        Object.keys(d || {}).forEach(function (k) { merged[k] = d[k]; });
        var v = validateQuestion(merged);
        if (v.error) return fail(v.error);
        var pl = core.passageLinkError(v.rec, passages);
        if (pl) return fail(pl);
        var il = imageLinkError(v.rec);
        if (il) return fail(il);
        v.rec.id = cur.id;
        questions[questions.indexOf(cur)] = v.rec;
        return ok(clone(v.rec));
      },

      /* ------------------------------------- CONSOLE: bulk import from CSV
         Typing a bank one question at a time is the slowest part of running the
         academy, so a spreadsheet may be pasted or opened instead. Every row
         still passes the same validator a typed record passes — a file cannot
         write a record the form would have refused. Good rows are kept and bad
         rows are reported by line number, so a single typo never costs the
         whole file. */

      /* subject/section: optional, mirroring server.js's endpoint — omitted,
         a file imports exactly as it always has; given, core.importCSV
         refuses any row that doesn't match instead of trusting the file, and
         the target folds into the log the same way it does server-side.
         stampSection: when true, every row kept (all of them, or only the
         rows matching subject, if given) is filed under the chosen section
         regardless of what the file's own section column says — this is how
         the same question set is imported once for the Web Test and again
         for Practice, without hand-editing the file. See core.importCSV.
         Re-importing the same file (or content) is never refused: a bank a
         teacher keeps re-uploading (say, after adding a couple of rows, or
         just to be safe) always publishes. confirmDuplicate/findDuplicateImport
         are kept only so importHistory can still show "seen before", not to
         gate anything. */
      importQuestions: function (csv, filename, confirmDuplicate, subject, section, stampSection, replace) {
        var e = requireUnlocked(); if (e) return e;
        var fname = filename ? String(filename).slice(0, 200) : null;
        var tSubject = subject ? String(subject).trim() : '';
        var tSection = section ? String(section).trim().toLowerCase() : '';
        var target = (tSubject || tSection) ? { subject: tSubject, section: tSection, stampSection: !!stampSection } : null;
        var targetKey = target ? (target.subject + '/' + target.section + (stampSection ? ' (stamped)' : '')) : null;
        var fingerprint = core.csvFingerprint(csv);
        var r = core.importCSV('questions', csv, target, questions, passages, { replace: !!replace });
        if (r.error) return fail(r.error);
        var added = [], replacedIds = [];
        (r.replacements || []).forEach(function (rp) {
          var cur = find(questions, Number(rp.id));
          if (!cur) return;
          Object.keys(rp.patch).forEach(function (k) { cur[k] = rp.patch[k]; });
          replacedIds.push(rp.id);
        });
        r.records.forEach(function (rec) {
          rec.id = ++qSeq;
          questions.push(rec);
          added.push(rec.id);
        });
        logImport({ kind: 'questions', filename: fname, fingerprint: fingerprint, target: targetKey, read: r.read, added: added.length, replaced: replacedIds.length, skipped: r.errors.length });
        return ok({ read: r.read, added: added.length, ids: added, replaced: replacedIds.length, replacedIds: replacedIds,
                    skipped: r.errors.length, errors: r.errors, total: questions.length });
      },

      /* Re-importing the same file is never refused — same as importQuestions
         above. findDuplicateImport/confirmDuplicate are kept only so
         importHistory can still show a note was seen before, not to gate
         anything. */
      importNotes: function (csv, filename, confirmDuplicate) {
        var e = requireUnlocked(); if (e) return e;
        var fname = filename ? String(filename).slice(0, 200) : null;
        var fingerprint = core.csvFingerprint(csv);
        var r = core.importCSV('notes', csv, null, notes);
        if (r.error) return fail(r.error);
        var added = [];
        r.records.forEach(function (rec) {
          rec.id = ++nSeq;
          notes.push(rec);
          added.push(rec.id);
        });
        logImport({ kind: 'notes', filename: fname, fingerprint: fingerprint, read: r.read, added: added.length, skipped: r.errors.length });
        return ok({ read: r.read, added: added.length, ids: added,
                    skipped: r.errors.length, errors: r.errors, total: notes.length });
      },

      /* What has been imported before, newest first — see logImport above. */
      importHistory: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ imports: importLog.slice(-30).slice().reverse() });
      },

      setQuestionActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(questions, Number(id));
        if (!cur) return fail('That question no longer exists.');
        cur.active = !!on;
        return ok(clone(cur));
      },

      /* Only an unpublished (held-back) question may be deleted — a live one
         must be deactivated first. This mirrors the safety rule already used
         for live classes (cancel/complete before delete), so a published
         question a student may already be answering can't be pulled out from
         under them by mistake. */
      deleteQuestion: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var cur = find(questions, Number(id));
        if (!cur) return ok({ ok: true, deleted: Number(id), alreadyGone: true });
        if (cur.active) return fail('Deactivate this question before deleting it.');
        questions.splice(questions.indexOf(cur), 1);
        return ok({ ok: true, deleted: cur.id });
      },

      /* Bulk delete by subject/section — same contract as the server's
         DELETE /api/questions/bulk: "all" must be explicit, blank is refused. */
      bulkDeleteQuestions: function (subject, section) {
        var e = requireUnlocked(); if (e) return e;
        var rawSubject = String(subject == null ? '' : subject).trim();
        var rawSection = String(section == null ? '' : section).trim();
        if (!rawSubject || !rawSection) return fail('Choose a subject and a section (or "all") before deleting.');
        var subjectAll = rawSubject.toLowerCase() === 'all';
        var sectionAll = rawSection.toLowerCase() === 'all';
        if (!subjectAll && core.ALL_SUBJECTS.indexOf(rawSubject) === -1) return fail('Choose one of the academy\u2019s subjects, or "all".');
        var sec = rawSection;
        if (!sectionAll) {
          sec = core.csvSection(rawSection);
          if (!sec) return fail('Choose a section: theory, objective, JAMB-oriented, practice-only, or "all".');
        }
        var before = questions.length;
        var keep = questions.filter(function (q) {
          if (!subjectAll && q.subject !== rawSubject) return true;
          if (!sectionAll && q.section !== sec) return true;
          return false;
        });
        var deleted = before - keep.length;
        if (deleted > 0) {
          questions.length = 0;
          keep.forEach(function (q) { questions.push(q); });
        }
        return ok({ ok: true, deleted: deleted, remaining: questions.length,
                    subject: subjectAll ? 'all' : rawSubject, section: sectionAll ? 'all' : sec });
      },

      /* ============================================ CONSOLE: student results
         Every row identifies the student by Scholar ID. */

      listResults: function (filter) {
        var e = requireUnlocked(); if (e) return e;
        var f = filter || {};
        var rows = attempts.filter(function (a) {
          if (f.scholarId && a.scholarId !== norm(f.scholarId)) return false;
          if (f.subject && a.subject !== f.subject) return false;
          if (f.section && a.section !== f.section) return false;
          /* One test, so an attempt is never hidden by the period it stored. */
          if (f.status && a.status !== f.status) return false;
          return true;
        }).slice().sort(function (a, b) { return b.submittedAt - a.submittedAt; });
        return ok({
          results: rows.map(attemptSummary),
          awaitingMarking: attempts.filter(function (a) { return a.status === 'awaiting-marking'; }).length,
          total: attempts.length
        });
      },

      /* ============================================ CONSOLE: overview panel
         The four headline numbers, computed the same way the server route
         does. Demo mode has no lastSeenAt tracking (nothing persists between
         reloads to track it against), so activeToday is honestly 0, and
         lessonsPublished is honestly 0 since listResources/listVideos are
         empty in demo mode too — not a bug to chase, matches those. */
      listOverview: function () {
        var e = requireUnlocked(); if (e) return e;
        var marked = attempts.filter(function (a) {
          return a.status === 'marked' && typeof a.percent === 'number';
        });
        var avgScorePercent = marked.length
          ? Math.round(marked.reduce(function (sum, a) { return sum + a.percent; }, 0) / marked.length)
          : null;
        return ok({
          studentsTotal: students.length,
          activeToday: 0,
          avgScorePercent: avgScorePercent,
          lessonsPublished: 0
        });
      },

      /* Full detail for marking: the question, what the student wrote, the
         reference answer and the maximum mark. Staff only. */
      getAttempt: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var a = null;
        attempts.forEach(function (r) { if (String(r.id) === String(id)) a = r; });
        if (!a) return fail('That result no longer exists.');
        var out = attemptSummary(a);
        out.durationSec = a.durationSec;
        out.markedBy = a.markedBy || null;
        out.answers = a.answers.map(function (r) {
          var q = find(questions, r.questionId) || {};
          return {
            questionId: r.questionId, kind: r.kind, topic: r.topic,
            text: q.text || '', options: (q.options || []).slice(),
            answer: q.answer, expected: q.expected || '',
            given: r.given, isCorrect: r.isCorrect,
            markAwarded: r.markAwarded, maxMark: r.maxMark
          };
        });
        out.breakdown = a.status === 'marked' ? core.topicBreakdown(a.answers) : [];
        return ok(out);
      },

      /* Priority 4.4 — the administrator awards each theory mark by hand; the
         system then totals it and stores the final result against the Scholar
         ID. No theory score is ever assigned automatically. */
      markTheory: function (id, marks) {
        var e = requireUnlocked(); if (e) return e;
        var a = null;
        attempts.forEach(function (r) { if (String(r.id) === String(id)) a = r; });
        if (!a) return fail('That result no longer exists.');
        if (a.section !== 'theory') return fail('Only theory papers are marked by hand.');
        var was = a.status;
        core.applyTheoryMarks(a, marks || {});
        a.markedBy = session.id;
        a.markedAt = Date.now();
        var stu = find(students, a.scholarId);
        if (stu && was !== 'marked' && a.status === 'marked') {
          var extra = Math.max(0, core.xpForAttempt(a.percent) - (a.xpAwarded || 0));
          a.xpAwarded = (a.xpAwarded || 0) + extra;
          stu.xp = (stu.xp || 0) + extra;
        }
        return ok(attemptSummary(a));
      },

      /* ================================ CONSOLE: account activation (P7)
         Deactivating closes access. It never deletes anything — the Scholar
         ID, results, performance history and XP all stay exactly as they are
         so the record can be reopened intact. */

      setStudentActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        var s = find(students, id);
        if (!s) return fail('That Scholar ID is not on the roster.');
        s.active = !!on;
        if (!s.active) {
          s.tl = 'Closed';
          s.tag = 'r';
          s.last = 'Deactivated';
        } else if (s.last === 'Deactivated') {
          s.tl = 'Away';
          s.tag = 'a';
          s.last = 'Reopened';
        }
        return ok(publicStudent(s));
      },

      /* Move a student between Open and GOC, as PUT /api/students/:id/tier does on the
         server: same refusal wording, no change (and nothing recorded) when the student
         already has that tier, otherwise who and when are stamped on the student. */
      setStudentTier: function (id, tier) {
        var e = requireUnlocked(); if (e) return e;
        var want = core.parseTierChange(tier);
        if (!want.ok) return fail(want.error);
        var s = find(students, id);
        if (!s) return fail('That Scholar ID is not on the roster.');
        if (core.cleanTier(s.tier) !== want.tier) {
          s.tier = want.tier;
          s.tierChangedBy = session.name || session.id;
          s.tierChangedAt = new Date().toISOString();
        }
        return ok(publicStudent(s));
      },

      /* Admin-approval flow: approve a pending self-registered account. */
      approveStudent: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var s = find(students, id);
        if (!s) return fail('That Scholar ID is not on the roster.');
        if (!s.pendingApproval) return fail('This account is not awaiting approval.');
        s.active = true;
        s.pendingApproval = false;
        s.tl = 'New'; s.tag = 'g'; s.last = 'Approved';
        s.approvedBy = session.name || session.id;
        s.approvedAt = new Date().toISOString();
        return ok(publicStudent(s));
      },

      /* Admin-approval flow: reject and remove a pending account. */
      rejectStudent: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var idx = students.findIndex(function (x) { return x.id === String(id).toUpperCase(); });
        if (idx === -1) return fail('That Scholar ID is not on the roster.');
        if (!students[idx].pendingApproval) return fail('This account is not awaiting approval.');
        students.splice(idx, 1);
        return ok({ rejected: true, id: String(id).toUpperCase() });
      },

      /* ------------------------------------------------------------ tutors (Phase 3C)
         Tutor accounts live on the server, as cohorts do: the offline demo has none, so
         the panel reads empty and every change says it needs a connection. */
      /* The offline demo has no tutor screens, so no word opens anything. */
      knockDoor: function () { return ok(null); },
      listTutors: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ tutors: [] });
      },
      createTutor: function (b) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateTutor(b, { needPassword: true });
        if (v.error) return fail(v.error);
        return fail('Tutor accounts need a server connection.');
      },
      updateTutor: function (id, b) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateTutor({ name: b && b.name, subjects: b && b.subjects }, { needPassword: false });
        if (v.error) return fail(v.error);
        return fail('Tutor accounts need a server connection.');
      },
      resetTutorPassword: function (id, password) {
        var e = requireUnlocked(); if (e) return e;
        if (String(password || '').length < core.TUTOR_PASSWORD_MIN) return fail('Choose a starting password of at least ' + core.TUTOR_PASSWORD_MIN + ' characters.');
        return fail('Tutor accounts need a server connection.');
      },
      setTutorActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        if (typeof on !== 'boolean') return fail('Say whether the tutor is on or off.');
        return fail('Tutor accounts need a server connection.');
      },
      listTutorViews: function (f) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ keptDays: core.AUDIT_KEEP_DAYS, count: 0, entries: [] });
      },
      listManagerActions: function (f) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ count: 0, keep: core.MANAGER_LOG_KEEP, entries: [] });
      },
      /* ------------------------------------------------------------ managers (roles slice c)
         Manager accounts live on the server, like tutors: the offline demo has none, so the
         panel reads empty and every change says it needs a connection (after the same checks). */
      listManagers: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ managers: [], roles: core.managerRoles() });
      },
      createManager: function (b) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateManager(b || {}, { creating: true });
        if (v.error) return fail(v.error);
        return fail('Manager accounts need a server connection.');
      },
      setManagerActive: function (id, on) {
        var e = requireUnlocked(); if (e) return e;
        if (typeof on !== 'boolean') return fail('Say whether the account should be on or off.');
        return fail('Manager accounts need a server connection.');
      },
      resetManagerPassword: function (id, password, passcode) {
        var e = requireUnlocked(); if (e) return e;
        var pw = String(password == null ? '' : password), pc = passcode == null ? '' : String(passcode).trim();
        if (pw.length < core.MANAGER_PASSWORD_MIN) return fail('Choose a starting password of at least ' + core.MANAGER_PASSWORD_MIN + ' characters.');
        if (!/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) return fail('Use both letters and numbers in a management password.');
        if (pc && !/^\d{4,8}$/.test(pc)) return fail('The console passcode is 4 to 8 digits.');
        return fail('Manager accounts need a server connection.');
      },
      deleteManager: function (id) {
        var e = requireUnlocked(); if (e) return e;
        return fail('Manager accounts need a server connection.');
      },
      getResultsExport: function (f) {
        var e = requireUnlocked(); if (e) return e;
        return fail('Results export needs a server connection.');
      },
      getResultsPdf: function (f) {
        var e = requireUnlocked(); if (e) return e;
        return fail('Results export needs a server connection.');
      },
      tutorOverview: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ subjects: core.subjectDepth(questions, notes).map(function (r) { r.tutors = []; return r; }), minimums: core.SUBJECT_DEPTH_MIN });
      },
      /* Tutor questions waiting for approval live on the server; offline there are none. */
      listApprovals: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ count: 0, queue: [] });
      },
      approveQuestion: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Approvals need a server connection.');
      },
      returnQuestion: function (id, reason) {
        var e = requireUnlocked(); if (e) return e;
        var why = String(reason == null ? '' : reason).trim();
        if (why.length < core.RETURN_REASON_MIN) return fail('Say why the question is being returned (at least ' + core.RETURN_REASON_MIN + ' characters).');
        return fail('Approvals need a server connection.');
      },
      approveBatch: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Approvals need a server connection.');
      },
      /* Class notices come from tutors, and the offline demo has no tutors: nothing to show. A student's
         answer still follows the tier rule, so an Open student reads as locked here too. */
      listMyNotices: function () {
        var e = requireStudent(); if (e) return e;
        var locked = !core.canUse('classNotices', tierOf(session.id));
        return ok({ locked: locked, notices: [] });
      },
      listNotices: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ count: 0, notices: [] });
      },
      removeNotice: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Class notices need a server connection.');
      },
      /* Targeted broadcasts (Phase 4): the same rules as the server, in memory. */
      sendBroadcast: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateBroadcast(d);
        if (v.error) return fail(v.error);
        var st = core.stampBroadcast(v.rec, session.name || session.id, Date.now());
        if (st.error) return fail(st.error);
        broadcastSeq += 1;
        st.rec.id = broadcastSeq;
        st.rec.reached = core.broadcastRecipients(st.rec.audience, students).length;
        broadcasts.push(st.rec);
        return ok({ broadcast: Object.assign({ audienceLabel: core.audienceLabel(st.rec.audience) }, st.rec), created: true });
      },
      listBroadcasts: function () {
        var e = requireUnlocked(); if (e) return e;
        var rows = broadcasts.slice()
          .sort(function (a, b) { return String(b.sentAt || '').localeCompare(String(a.sentAt || '')) || b.id - a.id; })
          .map(function (b) { return Object.assign({ audienceLabel: core.audienceLabel(b.audience) }, b); });
        return ok({ count: rows.length, broadcasts: rows });
      },
      broadcastAudience: function (audience) {
        var e = requireUnlocked(); if (e) return e;
        var a = core.cleanAudience(audience);
        if (!a) return fail('Choose who it goes to: all GOC students, or one subject’s students.');
        return ok({ audience: a, label: core.audienceLabel(a), reached: core.broadcastRecipients(a, students).length });
      },
      deleteBroadcast: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var i = -1;
        broadcasts.forEach(function (b, k) { if (String(b.id) === String(id)) i = k; });
        if (i === -1) return ok({ ok: true, deleted: Number(id), alreadyGone: true });
        var gone = broadcasts.splice(i, 1)[0];
        return ok({ ok: true, deleted: gone.id });
      },
      listMyBroadcasts: function () {
        var e = requireStudent(); if (e) return e;
        var locked = !core.canUse('classNotices', tierOf(session.id));
        return ok({ locked: locked, broadcasts: locked ? [] : core.broadcastsForStudent(broadcasts, find(students, session.id)) });
      },
      /* Ask a tutor (Phase 4.A): the student side, offline, with the same core rules as the server. */
      listMyFlags: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var locked = !core.canUse('askTutor', tierOf(session.id));
        return ok({ locked: locked, flags: locked ? [] : core.flagsForStudent(flags, s) });
      },
      askTutor: function (d) {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        if (!core.canUse('askTutor', tierOf(session.id))) return fail('Asking a tutor is for GOC students. Ask the academy about joining.');
        var qid = String((d && d.questionId) != null ? d.questionId : '').trim();
        var q = null;
        for (var qi = 0; qi < questions.length; qi++) { if (String(questions[qi].id) === qid) { q = questions[qi]; break; } }
        var gate = core.canFlag(flags, s.id, qid, Date.now());
        if (!gate.allowed) return fail(gate.message);
        var st = core.stampFlag(d || {}, q, s, Date.now());
        if (st.error) return fail(st.error);
        flagSeq += 1;
        st.rec.id = 'FL-' + flagSeq;
        flags.push(st.rec);
        return ok({ flag: core.publicFlag(st.rec), created: true });
      },
      /* Ask a tutor: the console side (demo has no tutors, so the console answers them). */
      listFlags: function (opts) {
        var e = requireUnlocked(); if (e) return e;
        var o = opts || {};
        return ok({ count: core.flagsForConsole(flags, o).length, counts: core.flagCounts(flags),
                    flags: core.flagsForConsole(flags, o) });
      },
      replyFlag: function (id, text) {
        var e = requireUnlocked(); if (e) return e;
        var cur = flags.filter(function (f) { return String(f.id) === String(id); })[0];
        if (!cur) return fail('No such question.');
        var r = core.answerFlag(cur, { role: 'console', name: session.name || session.id }, text, Date.now());
        if (r.error) return fail(r.error);
        flags[flags.indexOf(cur)] = r.rec;
        return ok({ flag: core.staffFlag(r.rec), ok: true });
      },
      closeFlag: function (id) {
        var e = requireUnlocked(); if (e) return e;
        var cur = flags.filter(function (f) { return String(f.id) === String(id); })[0];
        if (!cur) return fail('No such question.');
        var r = core.closeFlag(cur, { role: 'console', name: session.name || session.id }, Date.now());
        if (r.error) return fail(r.error);
        flags[flags.indexOf(cur)] = r.rec;
        return ok({ flag: core.staffFlag(r.rec), ok: true });
      },
      /* Team (cohort) challenges (Phase 4.C). Like cohorts and classes, these need a server:
         the offline demo has no cohorts, so a student is never on a team here. The methods
         exist for shape parity with the server driver. */
      getChallenge: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ challenge: null });
      },
      createChallenge: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Team challenges need a server connection (the offline demo has no cohorts).');
      },
      listChallenges: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ count: 0, challenges: [] });
      },
      setChallengeActive: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Team challenges need a server connection (the offline demo has no cohorts).');
      },
      /* Alerts (a tutor finished marking a script) come from the server; offline there are none. */
      listAlerts: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ count: 0, alerts: [] });
      },
      seenAlert: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Alerts need a server connection.');
      },

      /* ================================ FOUNDER-ONLY CREDENTIALS (P8)
         requireFounder() is the authorisation gate. In the real backend the
         same check runs server-side before anything is written — the frontend
         never decides who is allowed to do this. */

      setStaffPassword: function (staffId, newPassword) {
        var e = requireFounder(); if (e) return e;
        var a = find(staff, staffId);
        if (!a) return fail('That Staff ID does not exist.');
        var pw = String(newPassword || '');
        if (pw.length < 8) return fail('Management passwords must be at least 8 characters.');
        if (!/[0-9]/.test(pw) || !/[a-zA-Z]/.test(pw)) return fail('Use both letters and numbers in a management password.');
        a.pw = pw;                       /* real backend: scrypt hash + salt */
        return ok({ id: a.id, name: a.name, title: a.title, changed: true });
      },

      /* Question pictures — same gate as the server (type, size, name), minus
         the first-bytes check, which needs the file's bytes. */
      uploadQuestionImage: function (formData) {
        var e = requireUnlocked(); if (e) return e;
        var f = formData && formData.get ? formData.get('file') : null;
        if (!f) return fail('Please choose a picture to upload.');
        var g = core.validateImageUpload({ type: String(f.type || '').toLowerCase(), name: String(f.name || ''), size: f.size });
        if (g.error) return fail(g.error);
        var id = 'QIMG-';
        var chars = 'abcdef0123456789';
        for (var i = 0; i < 16; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        qImages[id] = { file: f, type: String(f.type).toLowerCase(), bytes: f.size };
        return ok({ imageId: id, type: qImages[id].type, bytes: f.size });
      },
      getQuestionImage: function (id) {
        if (!session) return fail('Please log in again.');
        var im = qImages[String(id)];
        if (!im) return fail('That picture is not available.');
        return ok(im.file);
      },

      uploadResource: function (formData) {
      var e = requireUnlocked(); if (e) return e;
      return ok({
        ok: true,
        demo: true,
        resource: {
          resourceId: 'DEMO-RESOURCE',
          title: formData && formData.get ? String(formData.get('title') || 'Untitled resource') : 'Untitled resource',
          subject: formData && formData.get ? String(formData.get('subject') || '') : '',
          category: formData && formData.get ? String(formData.get('category') || '') : '',
          published: false
        }
      });
    },
    setConsolePasscode: function (newPasscode) {
        var e = requireFounder(); if (e) return e;
        var p = String(newPasscode || '').trim();
        if (!/^[0-9]{4,8}$/.test(p)) return fail('The firewall passcode must be 4 to 8 digits.');
        PASSCODE = p;                    /* real backend: hashed, never returned */
        return ok({ length: p.length, changed: true });
      },

      /* Sign-ups per address. Founder and Academic Director may both change it
         (requireUnlocked, not requireFounder), like the server's 'console' tier. */
      setSignupLimits: function (body) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateSignupLimits(body);
        if (v.error) return fail(v.error);
        SIGNUP_LIMITS = { perHour: v.perHour, perDay: v.perDay };
        SIGNUP_LIMITS_AT = new Date().toISOString();
        SIGNUP_LIMITS_BY = session.id;
        return ok({ limits: core.signupLimits({ signupPerHour: v.perHour, signupPerDay: v.perDay }),
                    changed: true, changedAt: SIGNUP_LIMITS_AT, changedBy: SIGNUP_LIMITS_BY });
      },

      /* Who may change credentials, and how long the current passcode is. The
         passcode itself is never sent to the client. */
      staffAccess: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({
          staff: staff.map(function (a) { return { id: a.id, name: a.name, title: a.title }; }),
          isFounder: session.title === 'Founder',
          passcodeLength: PASSCODE.length,
          signupLimits: { perHour: SIGNUP_LIMITS.perHour, perDay: SIGNUP_LIMITS.perDay },
          signupLimitsChangedAt: SIGNUP_LIMITS_AT,
          signupLimitsChangedBy: SIGNUP_LIMITS_BY,
          sessionMinutes: settings.sessionMinutes,
          sessionWarnMinutes: settings.sessionWarnMinutes
        });
      },

      /* ------------------------------------------ DEMO-DRIVER PARITY (P1.1)
         The http driver exposes these five methods; the demo driver did not,
         which meant hitting any of them offline threw instead of failing
         gracefully — and one of them (listPublishedResources) is called on
         every single login. The demo driver has no real file storage, so
         these return honest empty/refusal results rather than fake data. */

      listResources: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ resources: [] });   // no resources are persisted in demo mode
      },
      listPublishedResources: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ resources: [] });
      },
      getResourceFile: function () {
        return fail('Resource downloads require a server connection.');
      },
      setResourcePublished: function (id, published) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id), published: !!published });
      },
      deleteResource: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Resource deletion requires a server connection.');
      },
      uploadVideo: function (formData) {
        var e = requireUnlocked(); if (e) return e;
        return ok({
          ok: true,
          demo: true,
          video: {
            videoId: 'DEMO-VIDEO',
            title: formData && formData.get ? String(formData.get('title') || 'Untitled video') : 'Untitled video',
            subject: formData && formData.get ? String(formData.get('subject') || '') : '',
            type: formData && formData.get ? String(formData.get('type') || 'lesson') : 'lesson',
            tutor: formData && formData.get ? String(formData.get('tutor') || '') : '',
            duration: formData && formData.get ? String(formData.get('duration') || '') : '',
            published: false
          }
        });
      },
      listVideos: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ videos: [] });   // no videos are persisted in demo mode
      },
      listPublishedVideos: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ videos: [] });
      },
      getVideoFile: function () {
        return fail('Video downloads require a server connection.');
      },
      setVideoPublished: function (id, published) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id), published: !!published });
      },
      deleteVideo: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Video deletion requires a server connection.');
      },

      /* ------------------------------------------------------------ classes
         Live classes (Zoom schedule). No classes persist in demo mode, same
         convention as listResources/listVideos above. */
      listClasses: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ classes: [] });
      },
      listUpcomingClasses: function () {
        var e = requireStudent(); if (e) return e;
        return ok({ classes: [] });
      },
      createClass: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var b = d || {};
        return ok({
          ok: true,
          demo: true,
          class: {
            classId: 'DEMO-CLASS',
            subject: String(b.subject || ''),
            topic: String(b.topic || ''),
            tutor: String(b.tutor || ''),
            scheduledAt: String(b.scheduledAt || ''),
            durationMin: Number(b.durationMin) || 0,
            zoomLink: String(b.zoomLink || ''),
            status: 'scheduled'
          }
        });
      },
      updateClass: function (id, d) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id), patch: d || {} });
      },
      cancelClass: function (id) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id), status: 'cancelled' });
      },
      deleteClass: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Class deletion requires a server connection.');
      },

      /* ------------------------------------------------------------ cohorts
         No cohorts persist in demo mode, same convention as classes above. */
      listCohorts: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ cohorts: [] });
      },
      setCohortTier: function (id, tier) {
        var e = requireUnlocked(); if (e) return e;
        var want = core.parseTierChange(tier);
        if (!want.ok) return fail(want.error);
        return fail('Moving a whole cohort needs a server connection.');
      },
      createCohort: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var b = d || {};
        return ok({
          ok: true, demo: true,
          cohort: {
            cohortId: 'DEMO-COHORT', name: String(b.name || ''), status: 'active',
            dailyLimitMin: null, sessionMinutes: null, sessionWarnMinutes: null,
            objectiveMinutes: null, objectiveCounts: null,
            jambMinutes: null, jambCounts: null
          }
        });
      },
      updateCohort: function (id, d) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id), patch: d || {} });
      },
      deleteCohort: function () {
        var e = requireUnlocked(); if (e) return e;
        return fail('Cohort deletion requires a server connection.');
      },
      setStudentCohort: function (id) {
        var e = requireUnlocked(); if (e) return e;
        return ok({ ok: true, demo: true, id: String(id) });
      },
      getMySettings: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        /* Cohort overrides aren't resolved in this offline driver (same as
           the rest of Cohorts here — see the "demo: true" stubs above), but
           the academy-wide daily limit and this student's real usage today
           are, so the ring on a file:// preview behaves like the live app. */
        return ok(Object.assign({
          dailyLimitMin: settings.dailyLimitMin, sessionMinutes: null, sessionWarnMinutes: null,
          objectiveMinutes: null, objectiveCounts: {},
          jambMinutes: null, jambCounts: {},
          cohortId: null, cohortName: null,
          // Matches the HTTP driver's effectiveSettingsFor(): a student gets
          // the yes/no flag (for the wind-down overlay's PIN field), never
          // the digits.
          hasGuardianPin: !!core.normalizeGuardianPin(settings.guardianPin)
        }, core.studyWindowStatus(settings.dailyLimitMin, studySecToday(s), studyBonusMinToday(s))));
      },
      changePassword: function (newPassword) {
        var e = requireStudent(); if (e) return e;
        var pw = String(newPassword == null ? '' : newPassword);
        if (pw.length < 8) return fail('Choose a password of at least 8 characters.');
        if (pw.length > 256) return fail('Password must not be longer than 256 characters.');
        var s = find(students, session.id);
        if (!s) return fail('That Scholar ID is no longer on the roster.');
        s.pw = pw;
        s.mustChangePassword = false;
        return ok({ ok: true, mustChangePassword: false });
      },
      getSiteAnalytics: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({ totalVisits: 0, visitsToday: 0, avgTimeSec: 0, uniqueLast30: 0, topPages: [], recentVisits: [] });
      },
      recordVisit: function () { return ok({ ok: true }); }
    };
  }());

  /* ============================================================ HTTP DRIVER
     Talks to server/server.js (or any server with the same routes).
     The token lives in a variable first and foremost. For staff, that is
     still the whole story — a refresh signs them out on purpose, since an
     admin console session shouldn't quietly survive on a shared machine.
     For a student, the same in-memory-only token meant a refresh looked
     like a logout even though the server's session was still perfectly
     valid, so a student's token is also mirrored into sessionStorage
     (never localStorage: it dies with the tab, it does not linger after
     the browser closes). Nothing about staff changes — they are never
     written to sessionStorage at all. */

  var STUDENT_TOKEN_KEY = 'goc.studentToken';

  function readStoredStudentToken() {
    try { return window.sessionStorage.getItem(STUDENT_TOKEN_KEY); }
    catch (e) { return null; }
  }
  function writeStoredStudentToken(tok) {
    try {
      if (tok) window.sessionStorage.setItem(STUDENT_TOKEN_KEY, tok);
      else window.sessionStorage.removeItem(STUDENT_TOKEN_KEY);
    } catch (e) { /* private-mode/storage-disabled: fall back to memory-only, silently */ }
  }

  var http = (function () {
    var base = 'api';
    var token = null;
    var passLen = 4;

    function req(method, path, body) {
      var opts = { method: method, headers: { 'Accept': 'application/json' } };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      return fetch(base + path, opts).then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          if (!r.ok) {
            var msg = (data && data.error) || 'The server could not complete that (' + r.status + ').';
            throw new Error(msg);
          }
          return data;
        });
      }, function () {
        throw new Error('Cannot reach the server. Check that it is running.');
      });
    }

    function uploadReq(uploadPath, formData) {
    var opts = {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: formData
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    return fetch(base + uploadPath, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }

        if (!r.ok) {
          var msg = (data && data.error) || 'The server could not complete that (' + r.status + ').';
          throw new Error(msg);
        }

        return data;
      });
    }, function () {
      throw new Error('Cannot reach the server. Check that it is running.');
    });
  }

  function qs(filter) {
      if (!filter) return '';
      var parts = [];
      for (var k in filter) {
        if (Object.prototype.hasOwnProperty.call(filter, k) && filter[k] !== '' && filter[k] != null) {
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(filter[k])));
        }
      }
      return parts.length ? '?' + parts.join('&') : '';
    }

    return {
      name: 'server',
      _setPasscodeLength: function (n) { passLen = Number(n) || 4; },

      login: function (id, password) {
        return req('POST', '/auth/login', { id: norm(id), password: String(password) })
          .then(function (d) {
            token = d.token;
            // Only a student's token is mirrored to sessionStorage; a staff
            // login leaves it memory-only, same as before this fix.
            writeStoredStudentToken(d.user && d.user.role === 'student' ? d.token : null);
            return d.user;
          });
      },
      logout: function () {
        var t = token; token = null;
        writeStoredStudentToken(null);
        return t ? req('POST', '/auth/logout').catch(function () { return true; }) : ok(true);
      },
      session: function () {
        // No in-memory token yet on this load — before giving up, check for
        // a student token this same tab stashed before a refresh.
        if (!token) token = readStoredStudentToken();
        if (!token) return ok(null);
        return req('GET', '/auth/session').then(function (d) {
          // A restored token that turns out to belong to staff, or that the
          // server no longer recognises, is not something to keep around.
          if (!d || d.role !== 'student') writeStoredStudentToken(null);
          return d;
        }, function () {
          token = null;
          writeStoredStudentToken(null);
          return null;
        });
      },

      unlockConsole: function (passcode) { return req('POST', '/auth/unlock', { passcode: String(passcode) }); },
      changeStaffPassword: function (current, next) {
        return req('POST', '/auth/password', { currentPassword: String(current == null ? '' : current), newPassword: String(next == null ? '' : next) });
      },
      lockConsole: function () { return req('POST', '/auth/lock').catch(function () { return true; }); },
      passcodeLength: function () { return passLen; },

      listStudents:   function ()      { return req('GET', '/students'); },
      listStaff:      function ()      { return req('GET', '/staff'); },
      createStudent:  function (d)     { return req('POST', '/students', d).then(function (r) { if (r.token) { token = r.token; writeStoredStudentToken(r.token); } return r; }); },
      addStudent:     function (d)     { return req('POST', '/admin/students', d); },
      revealPassword: function ()      { return fail('Passwords are stored hashed and cannot be shown. Use "Reset password" instead.'); },
      resetPassword:  function (id)    { return req('POST', '/students/' + encodeURIComponent(norm(id)) + '/reset'); },
      changePassword: function (newPassword) { return req('POST', '/me/password', { newPassword: String(newPassword) }); },

      listUpdates:    function ()      { return req('GET', '/updates'); },
      createUpdate:   function (d)     { return req('POST', '/updates', d); },
      removeUpdate:   function (id)    { return req('DELETE', '/updates/' + encodeURIComponent(id)); },

      /* B#2 scholarship */
      getScholarshipStatus:           function ()      { return req('GET',    '/scholarship/status'); },
      submitScholarApplication:       function (d)     { return req('POST',   '/scholarship/apply', d); },
      submitWaitlistEntry:            function (d)     { return req('POST',   '/scholarship/waitlist', d); },
      listScholarshipApplications:    function ()      { return req('GET',    '/scholarship/applications'); },
      decideScholarshipApplication:   function (id, d) { return req('POST',   '/scholarship/applications/' + encodeURIComponent(id) + '/decide', d); },
      approveScholarshipApplication:  function (id)    { return req('POST',   '/scholarship/applications/' + encodeURIComponent(id) + '/approve', {}); },
      deleteScholarshipApplication:   function (id)    { return req('DELETE', '/scholarship/applications/' + encodeURIComponent(id)); },
      exportScholarshipApplications:  function ()      { return req('GET',    '/scholarship/applications/export'); },

      listAffirmations: function ()    { return req('GET', '/affirmations'); },
      saveAffirmations: function (list) { return req('PUT', '/affirmations', { items: list || [] }); },

      /* Durable copy of a homepage contact submission — kept server-side so
         a message is never lost even on the run where the mail relay
         (called separately, straight from sendContact() below) is down or
         blocked by the visitor's network. No auth: anyone on the homepage,
         logged in or not, may reach this. */
      recordContactMessage: function (d) { return req('POST', '/contact', d); },

      getSettings:    function ()      { return req('GET', '/settings'); },
      setDailyLimit:  function (min)   { return req('PUT', '/settings', { dailyLimitMin: Number(min) }); },
      setSessionMinutes: function (m)  { return req('PUT', '/settings', { sessionMinutes: Number(m) }); },
      setSessionWarnMinutes: function (m) { return req('PUT', '/settings', { sessionWarnMinutes: Number(m) }); },
      setGuardianPin: function (pin)   { return req('PUT', '/settings', { guardianPin: String(pin == null ? '' : pin) }); },

      /* --- session lifetime (Priority 9). The server owns the clock; the
         countdown on screen only reflects what the server reports. --- */
      sessionInfo:    function ()      { return token ? req('GET', '/auth/session-info') : ok({ active: false }); },

      /* --- student: subjects, papers, results, league --- */
      myProfile:      function ()      { return req('GET', '/me'); },
      listMyTests:    function ()      { return req('GET', '/me/tests'); },
      startTest:      function (d)     { return req('POST', '/me/tests/start', d); },
      submitTest:     function (d)     { return req('POST', '/me/tests/submit', d); },
      myResults:      function ()      { return req('GET', '/me/results'); },
      studyCatalogue: function ()      { return req('GET', '/me/study'); },
      startStudy:     function (d)     { return req('POST', '/me/study/start', d); },
      submitStudy:    function (d)     { return req('POST', '/me/study/submit', d); },
      pingStudyTime:  function (sec)   { return req('POST', '/me/study-time/ping', { seconds: Number(sec) || 0 }); },
      extendStudyTime: function (pin)  { return req('POST', '/me/study-time/extend', { pin: String(pin) }); },
      listNotes:      function (f)     { return req('GET', '/me/notes' + qs(f)); },
      listMyNotices:  function ()      { return req('GET', '/me/notices'); },
      listMyBroadcasts: function ()    { return req('GET', '/me/broadcasts'); },
      listMyFlags:    function ()      { return req('GET', '/me/flags'); },
      askTutor:       function (d)     { return req('POST', '/me/flags', d || {}); },
      listFlags:      function (opts)  { var o = opts || {}; return req('GET', '/flags?subject=' + encodeURIComponent(o.subject || '') + '&status=' + encodeURIComponent(o.status || '')); },
      replyFlag:      function (id, t) { return req('POST', '/flags/' + encodeURIComponent(id) + '/reply', { text: String(t == null ? '' : t) }); },
      closeFlag:      function (id)    { return req('POST', '/flags/' + encodeURIComponent(id) + '/close', {}); },
      getChallenge:   function ()      { return req('GET', '/me/challenge'); },
      createChallenge: function (d)    { return req('POST', '/challenges', d || {}); },
      listChallenges: function ()      { return req('GET', '/challenges'); },
      setChallengeActive: function (id, a) { return req('PUT', '/challenges/' + encodeURIComponent(id) + '/active', { active: !!a }); },
      listAllNotes:   function (f)     { return req('GET', '/notes' + qs(f)); },
      createNote:     function (d)     { return req('POST', '/notes', d); },
      updateNote:     function (id, d) { return req('PUT', '/notes/' + encodeURIComponent(id), d); },
      setNoteActive:  function (id, on) { return req('PUT', '/notes/' + encodeURIComponent(id) + '/active', { active: !!on }); },
      deleteNote:     function (id)     { return req('DELETE', '/notes/' + encodeURIComponent(id)); },
      bulkDeleteNotes: function (subject) { return req('DELETE', '/notes/bulk', { subject: String(subject == null ? '' : subject) }); },
      noteCounts:     function ()       { return req('GET', '/notes/counts'); },
      listPassages:   function (f)      { return req('GET', '/passages' + qs(f)); },
      createPassage:  function (d)      { return req('POST', '/passages', d); },
      updatePassage:  function (id, d)  { return req('PUT', '/passages/' + encodeURIComponent(id), d); },
      setPassageActive: function (id, on) { return req('PUT', '/passages/' + encodeURIComponent(id) + '/active', { active: !!on }); },
      deletePassage:  function (id)     { return req('DELETE', '/passages/' + encodeURIComponent(id)); },
      myAttempt:      function (id)    { return req('GET', '/me/results/' + encodeURIComponent(id)); },
      /* Practice history, server-authoritative (Phase 1). recordPractice stores
         a finished run and returns the updated list; listPractice reads it back,
         newest first, on any device the student signs in on. */
      recordPractice: function (run)   { return req('POST', '/me/practice', run || {}); },
      listPractice:   function ()      { return req('GET', '/me/practice'); },
      /* Mistakes review (Phase 2): wrong answers from stored practice runs. */
      listMistakes:   function ()      { return req('GET', '/me/mistakes'); },
      /* Spaced repetition (Phase 2): the mistakes due for another look, and answering one. */
      listReview:     function ()      { return req('GET', '/me/review'); },
      answerReview:   function (key, given) { return req('POST', '/me/review', { key: key, given: given }); },
      getQuest:       function ()      { return req('GET', '/me/quest'); },
      getWeeklyQuest: function ()      { return req('GET', '/me/weekly-quest'); },
      /* Study reminders (Phase 2): on by default; switch email/SMS off or back on. */
      getReminders:   function ()      { return req('GET', '/me/reminders'); },
      setReminders:   function (c)     { return req('POST', '/me/reminders', c || {}); },
      /* Streak freeze (Phase 2): spend XP for one more freeze. */
      buyStreakFreeze: function ()     { return req('POST', '/me/streak-freeze', {}); },
      /* Bookmarks (Phase 1, part 2): a student's saved questions, per Scholar ID. */
      listBookmarks:  function ()      { return req('GET', '/me/bookmarks'); },
      addBookmark:    function (b)     { return req('POST', '/me/bookmarks', b || {}); },
      removeBookmark: function (key)   { return req('DELETE', '/me/bookmarks/' + encodeURIComponent(String(key))); },
      league:         function ()      { return req('GET', '/league'); },

      /* --- console: question bank, results, marking, accounts, credentials --- */
      listQuestions:  function (f)     { return req('GET', '/questions' + qs(f)); },
      questionCounts: function ()      { return req('GET', '/questions/counts'); },
      createQuestion: function (d)     { return req('POST', '/questions', d); },
      updateQuestion: function (id, d) { return req('PUT', '/questions/' + encodeURIComponent(id), d); },
      setQuestionActive: function (id, on) { return req('PUT', '/questions/' + encodeURIComponent(id) + '/active', { active: !!on }); },
      deleteQuestion: function (id) { return req('DELETE', '/questions/' + encodeURIComponent(id)); },

      /* Bulk delete by subject/section. Pass the literal string "all" for
         either argument to mean "every subject" / "every section"; leaving
         either blank is refused by the server rather than treated as "all"
         (see DELETE /api/questions/bulk). Resolves to
         { ok, deleted, remaining, subject, section }. */
      bulkDeleteQuestions: function (subject, section) { return req('DELETE', '/questions/bulk', { subject: String(subject == null ? '' : subject), section: String(section == null ? '' : section) }); },

      /* Bulk import. The CSV is posted as text and parsed on the server by the
         very same core helper the browser would have used, so the file is
         accepted or refused identically in both modes. */
      importQuestions: function (csv, filename, confirmDuplicate, subject, section, stampSection, replace) { return req('POST', '/questions/import', { csv: String(csv == null ? '' : csv), filename: filename ? String(filename) : undefined, confirmDuplicate: !!confirmDuplicate, subject: subject ? String(subject) : undefined, section: section ? String(section) : undefined, stampSection: !!stampSection, replace: !!replace }); },
      importNotes:    function (csv, filename, confirmDuplicate) { return req('POST', '/notes/import', { csv: String(csv == null ? '' : csv), filename: filename ? String(filename) : undefined, confirmDuplicate: !!confirmDuplicate }); },
      importHistory:  function ()      { return req('GET', '/import/history'); },

      setObjectiveMinutes: function (min) { return req('PUT', '/settings', { objectiveMinutes: Number(min) }); },
      setObjectiveCount:   function (subject, n) {
        return req('PUT', '/settings/objective-count', { subject: String(subject), questions: Number(n) });
      },
      objectiveBlueprint:  function (f) { return req('GET', '/objective/blueprint' + qs(f)); },
      setJambMinutes: function (min) { return req('PUT', '/settings', { jambMinutes: Number(min) }); },
      setJambReadyMin: function (min) { return req('PUT', '/settings', { jambReadyMin: Number(min) }); },
      openRound: function (section, subject) { return req('POST', '/rounds/open', { section: String(section || ''), subject: String(subject == null ? '' : subject) }); },
      getRound: function (section, subject) { return req('GET', '/rounds?section=' + encodeURIComponent(String(section || '')) + '&subject=' + encodeURIComponent(String(subject == null ? '' : subject))); },
      setJambCount:   function (subject, n) {
        return req('PUT', '/settings/jamb-count', { subject: String(subject), questions: Number(n) });
      },
      jambBlueprint:  function (f) { return req('GET', '/jamb/blueprint' + qs(f)); },

      listResults:    function (f)     { return req('GET', '/results' + qs(f)); },
      getAttempt:     function (id)    { return req('GET', '/results/' + encodeURIComponent(id)); },
      listOverview:   function ()      { return req('GET', '/admin/overview'); },
      markTheory:     function (id, m) { return req('POST', '/results/' + encodeURIComponent(id) + '/mark', { marks: m || {} }); },

      setStudentActive: function (id, on) { return req('PUT', '/students/' + encodeURIComponent(norm(id)) + '/active', { active: !!on }); },
      setStudentTier:   function (id, tier) { return req('PUT', '/students/' + encodeURIComponent(norm(id)) + '/tier', { tier: String(tier) }); },
      approveStudent:   function (id) { return req('POST', '/students/' + encodeURIComponent(norm(id)) + '/approve', {}); },
      rejectStudent:    function (id) { return req('DELETE', '/students/' + encodeURIComponent(norm(id)) + '/approve', {}); },

      staffAccess:    function ()      { return req('GET', '/staff/access'); },
      setStaffPassword: function (id, pw) { return req('PUT', '/staff/' + encodeURIComponent(norm(id)) + '/password', { password: String(pw) }); },
      setConsolePasscode: function (p) {
        return req('PUT', '/settings/passcode', { passcode: String(p) })
          .then(function (d) { if (d && d.length) passLen = d.length; return d; });
      },
      listResources: function () {
        return req('GET', '/admin/resources');
      },
      getResourceFile: function (id, opts) {
    return fetch(base + '/resources/' + encodeURIComponent(String(id)) + '/file' + (opts && opts.download ? '?download=1' : ''), {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Authorization': token ? 'Bearer ' + token : ''
      }
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
          throw new Error(
            (data && data.error) ||
            'Could not open this resource (' + r.status + ').'
          );
        });
      }
      return r.blob();
    }, function () {
      throw new Error('Cannot reach the server. Check that it is running.');
    });
  },

  listPublishedResources: function () {
        return req('GET', '/resources');
      },
      setResourcePublished: function (id, published) {
        return req('PUT', '/admin/resources/' + encodeURIComponent(String(id)) + '/published', {
          published: !!published
        });
      },
      deleteResource: function (id) {
        return req('DELETE', '/admin/resources/' + encodeURIComponent(String(id)));
      },
      uploadQuestionImage: function (formData) {
        return uploadReq('/admin/question-images', formData);
      },
      getQuestionImage: function (id) {
        return fetch(base + '/question-images/' + encodeURIComponent(String(id)), {
          method: 'GET',
          headers: { 'Accept': 'image/*', 'Authorization': token ? 'Bearer ' + token : '' }
        }).then(function (r) {
          if (!r.ok) {
            return r.text().then(function (txt) {
              var data = null;
              try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
              throw new Error((data && data.error) || 'Could not open this picture (' + r.status + ').');
            });
          }
          return r.blob();
        }, function () {
          throw new Error('Cannot reach the server. Check that it is running.');
        });
      },
      uploadResource: function (formData) {
      return uploadReq('/admin/resources/upload', formData);
    },
    listVideos: function () {
      return req('GET', '/admin/videos');
    },
    getVideoFile: function (id) {
  return fetch(base + '/videos/' + encodeURIComponent(String(id)) + '/file', {
    method: 'GET',
    headers: {
      'Accept': '*/*',
      'Authorization': token ? 'Bearer ' + token : ''
    }
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        throw new Error(
          (data && data.error) ||
          'Could not open this video (' + r.status + ').'
        );
      });
    }
    return r.blob();
  }, function () {
    throw new Error('Cannot reach the server. Check that it is running.');
  });
},
listPublishedVideos: function () {
      return req('GET', '/videos');
    },
    setVideoPublished: function (id, published) {
      return req('PUT', '/admin/videos/' + encodeURIComponent(String(id)) + '/published', {
        published: !!published
      });
    },
    deleteVideo: function (id) {
      return req('DELETE', '/admin/videos/' + encodeURIComponent(String(id)));
    },
    uploadVideo: function (formData) {
      return uploadReq('/admin/videos/upload', formData);
    },
    listClasses: function () {
      return req('GET', '/admin/classes');
    },
    listUpcomingClasses: function () {
      return req('GET', '/classes');
    },
    createClass: function (d) {
      return req('POST', '/admin/classes/upload', d || {});
    },
    updateClass: function (id, d) {
      return req('PUT', '/admin/classes/' + encodeURIComponent(String(id)), d || {});
    },
    cancelClass: function (id) {
      return req('PUT', '/admin/classes/' + encodeURIComponent(String(id)), { status: 'cancelled' });
    },
    deleteClass: function (id) {
      return req('DELETE', '/admin/classes/' + encodeURIComponent(String(id)));
    },
    /* Resolves to a short-lived token, or null for anything else: a wrong word looks the same
       as no door at all, so nothing here says what the word was meant to open. */
    knockDoor: function (word, pw) {
      return req('POST', '/door', { word: String(word == null ? '' : word), password: String(pw == null ? '' : pw) }).then(function (r) { return (r && r.token) || null; }, function () { return null; });
    },
    listTutors: function () { return req('GET', '/tutors'); },
    createTutor: function (b) {
      return req('POST', '/tutors', { name: b && b.name, subjects: b && b.subjects, password: b && b.password });
    },
    updateTutor: function (id, b) {
      return req('PUT', '/tutors/' + encodeURIComponent(String(id)), { name: b && b.name, subjects: b && b.subjects });
    },
    resetTutorPassword: function (id, password) {
      return req('PUT', '/tutors/' + encodeURIComponent(String(id)) + '/password', { password: String(password == null ? '' : password) });
    },
    setTutorActive: function (id, on) {
      return req('PUT', '/tutors/' + encodeURIComponent(String(id)) + '/active', { active: on });
    },
    listManagers: function () { return req('GET', '/managers'); },
    createManager: function (b) {
      return req('POST', '/managers', { name: b && b.name, role: b && b.role, password: b && b.password, passcode: b && b.passcode });
    },
    setManagerActive: function (id, on) {
      return req('PUT', '/managers/' + encodeURIComponent(String(id)) + '/active', { active: on });
    },
    resetManagerPassword: function (id, password, passcode) {
      var body = { password: String(password == null ? '' : password) };
      if (passcode != null && String(passcode).trim() !== '') body.passcode = String(passcode).trim();
      return req('PUT', '/managers/' + encodeURIComponent(String(id)) + '/password', body);
    },
    deleteManager: function (id) {
      return req('DELETE', '/managers/' + encodeURIComponent(String(id)));
    },
    listTutorViews: function (f) {
      f = f || {};
      var q = ['tutorId', 'studentId', 'kind', 'from', 'to'].filter(function (k) { return f[k]; })
        .map(function (k) { return k + '=' + encodeURIComponent(String(f[k])); }).join('&');
      return req('GET', '/audit/tutor-views' + (q ? '?' + q : ''));
    },
    listManagerActions: function (f) {
      f = f || {};
      var q = ['by', 'action', 'from', 'to', 'limit'].filter(function (k) { return f[k]; })
        .map(function (k) { return k + '=' + encodeURIComponent(String(f[k])); }).join('&');
      return req('GET', '/audit/manager-actions' + (q ? '?' + q : ''));
    },
    getResultsExport: function (f) {
      f = f || {};
      var q = ['term', 'year', 'from', 'to', 'cohort', 'subject', 'section'].filter(function (k) { return f[k]; })
        .map(function (k) { return k + '=' + encodeURIComponent(String(f[k])); }).join('&');
      return req('GET', '/results/export' + (q ? '?' + q : ''));
    },
    /* The PDF is written by the server; this fetches it with the console session and hands back the file (a Blob). */
    getResultsPdf: function (f) {
      f = f || {};
      var q = ['term', 'year', 'from', 'to', 'cohort', 'subject', 'section'].filter(function (k) { return f[k]; })
        .map(function (k) { return k + '=' + encodeURIComponent(String(f[k])); });
      q.push('format=pdf');
      var headers = { 'Accept': 'application/pdf' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return fetch(base + '/results/export?' + q.join('&'), { method: 'GET', headers: headers }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (txt) {
            var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
            throw new Error((data && data.error) || 'The server could not complete that (' + r.status + ').');
          });
        }
        return r.blob();
      }, function () { throw new Error('Cannot reach the server. Check that it is running.'); });
    },
    tutorOverview: function () { return req('GET', '/tutors/overview'); },
    adminTutorAnalytics: function () { return req('GET', '/admin/tutors/analytics'); },
    listApprovals: function (subject) {
      return req('GET', '/approvals' + (subject ? '?subject=' + encodeURIComponent(String(subject)) : ''));
    },
    approveQuestion: function (id, edit) {
      var b = {}; if (edit && typeof edit === 'object') b.edit = edit;
      return req('POST', '/approvals/' + encodeURIComponent(String(id)) + '/approve', b);
    },
    returnQuestion: function (id, reason) {
      return req('POST', '/approvals/' + encodeURIComponent(String(id)) + '/return', { reason: String(reason == null ? '' : reason) });
    },
    approveBatch: function (batch) {
      return req('POST', '/approvals/batch/approve', { batch: String(batch == null ? '' : batch) });
    },
    listNotices: function (subject) { return req('GET', '/notices' + (subject ? '?subject=' + encodeURIComponent(String(subject)) : '')); },
    removeNotice: function (id) { return req('DELETE', '/notices/' + encodeURIComponent(String(id))); },
    sendBroadcast: function (d) { return req('POST', '/broadcasts', d || {}); },
    listBroadcasts: function () { return req('GET', '/broadcasts'); },
    broadcastAudience: function (a) {
      var x = a || {};
      return req('GET', '/broadcasts/audience?kind=' + encodeURIComponent(String(x.kind || '')) + (x.subject ? '&subject=' + encodeURIComponent(String(x.subject)) : ''));
    },
    deleteBroadcast: function (id) { return req('DELETE', '/broadcasts/' + encodeURIComponent(String(id))); },
    listAlerts: function () { return req('GET', '/alerts'); },
    seenAlert: function (id) { return req('POST', '/alerts/' + encodeURIComponent(String(id)) + '/seen', {}); },
    listCohorts: function () {
      return req('GET', '/admin/cohorts');
    },
    setCohortTier: function (id, tier) {
      return req('PUT', '/admin/cohorts/' + encodeURIComponent(String(id)) + '/tier', { tier: String(tier) });
    },
    createCohort: function (d) {
      return req('POST', '/admin/cohorts', d || {});
    },
    updateCohort: function (id, d) {
      return req('PUT', '/admin/cohorts/' + encodeURIComponent(String(id)), d || {});
    },
    deleteCohort: function (id) {
      return req('DELETE', '/admin/cohorts/' + encodeURIComponent(String(id)));
    },
    setStudentCohort: function (id, cohortId) {
      return req('PUT', '/students/' + encodeURIComponent(String(id)) + '/cohort', { cohortId: cohortId == null ? null : String(cohortId) });
    },
    getMySettings: function () {
      return req('GET', '/me/settings');
    },
    setSignupLimits: function (b)    { return req('PUT', '/settings/signup-limits', { perHour: b && b.perHour, perDay: b && b.perDay }); },
    getSiteAnalytics: function ()    { return req('GET', '/analytics/site'); },
    recordVisit: function (b)        { return req('POST', '/analytics/visit', b || {}); }
    };
  }());

  /* ======================================================== DRIVER SELECTION
     Probe once at startup. Anything other than a healthy server — opened from
     a file, server switched off, offline — falls back to the demo driver so the
     app is never a blank screen. GOC.api.ready resolves with the driver name. */

  var active = mock;

  GOC.api = {
    ready: null,
    mode: function () { return active.name; },
    isDemo: function () { return active === mock; },

    login:          function (id, pw) { return active.login(id, pw); },
    logout:         function ()       { return active.logout(); },
    session:        function ()       { return active.session(); },
    /* Synchronous, no network: lets the boot sequence decide — before it
       ever calls session() — whether there is a student token left over
       from before a refresh worth restoring. Always false in demo mode
       and for staff, since neither is ever written to sessionStorage. */
    hasPendingStudentSession: function () { return !!readStoredStudentToken(); },
    unlockConsole:  function (p)      { return active.unlockConsole(p); },
    changeStaffPassword: function (c, n) { return active.changeStaffPassword(c, n); },
    lockConsole:    function ()       { return active.lockConsole(); },
    passcodeLength: function ()       { return active.passcodeLength(); },

    listStudents:   function ()       { return active.listStudents(); },
    listStaff:      function ()       { return active.listStaff(); },
    createStudent:  function (d)      { return active.createStudent(d); },
    addStudent:     function (d)      { return active.addStudent(d); },
    revealPassword: function (id)     { return active.revealPassword(id); },
    resetPassword:  function (id)     { return active.resetPassword(id); },
    changePassword: function (newPassword) { return active.changePassword(newPassword); },

    listUpdates:    function ()       { return active.listUpdates(); },
    createUpdate:   function (d)      { return active.createUpdate(d); },
    removeUpdate:   function (id)     { return active.removeUpdate(id); },

    /* B#2 scholarship */
    getScholarshipStatus:           function ()      { return active.getScholarshipStatus(); },
    submitScholarApplication:       function (d)     { return active.submitScholarApplication(d); },
    submitWaitlistEntry:            function (d)     { return active.submitWaitlistEntry(d); },
    listScholarshipApplications:    function ()      { return active.listScholarshipApplications(); },
    decideScholarshipApplication:   function (id, d) { return active.decideScholarshipApplication(id, d); },
    approveScholarshipApplication:  function (id)    { return active.approveScholarshipApplication(id); },
    deleteScholarshipApplication:   function (id)    { return active.deleteScholarshipApplication(id); },
    exportScholarshipApplications:  function ()      { return active.exportScholarshipApplications(); },

    listAffirmations: function ()     { return active.listAffirmations(); },
    saveAffirmations: function (list) { return active.saveAffirmations(list); },
    recordContactMessage: function (d) { return active.recordContactMessage(d); },

    getSettings:    function ()       { return active.getSettings(); },
    setDailyLimit:  function (m)      { return active.setDailyLimit(m); },
    setSessionMinutes: function (m)   { return active.setSessionMinutes(m); },
    setSessionWarnMinutes: function (m) { return active.setSessionWarnMinutes(m); },
    setGuardianPin: function (pin)    { return active.setGuardianPin(pin); },

    /* Priority 9 — how much of the session is left, according to the driver. */
    sessionInfo:    function ()       { return active.sessionInfo(); },

    /* Daily study window — heartbeat ping, forwarded to whichever driver is active. */
    pingStudyTime:  function (sec)    { return active.pingStudyTime(sec); },
    extendStudyTime: function (pin)   { return active.extendStudyTime(pin); },

    /* Priority 3 / 6 / 10-12 — the student's own subjects, papers and standing. */
    myProfile:      function ()       { return active.myProfile(); },
    listMyTests:    function ()       { return active.listMyTests(); },
    startTest:      function (d)      { return active.startTest(d); },
    submitTest:     function (d)      { return active.submitTest(d); },
    myResults:      function ()       { return active.myResults(); },
    studyCatalogue: function ()       { return active.studyCatalogue(); },
    startStudy:     function (d)      { return active.startStudy(d); },
    submitStudy:    function (d)      { return active.submitStudy(d); },
    listNotes:      function (f)      { return active.listNotes(f); },
    listMyNotices:  function ()       { return active.listMyNotices(); },
    listMyBroadcasts: function ()     { return active.listMyBroadcasts(); },
    listMyFlags: function ()          { return active.listMyFlags(); },
    askTutor: function (d)            { return active.askTutor(d); },
    listFlags: function (opts)        { return active.listFlags(opts); },
    replyFlag: function (id, t)       { return active.replyFlag(id, t); },
    closeFlag: function (id)          { return active.closeFlag(id); },
    getChallenge: function ()         { return active.getChallenge(); },
    createChallenge: function (d)     { return active.createChallenge(d); },
    listChallenges: function ()       { return active.listChallenges(); },
    setChallengeActive: function (id, a) { return active.setChallengeActive(id, a); },
    listAllNotes:   function (f)      { return active.listAllNotes(f); },
    createNote:     function (d)      { return active.createNote(d); },
    updateNote:     function (id, d)  { return active.updateNote(id, d); },
    setNoteActive:  function (id, on) { return active.setNoteActive(id, on); },
    deleteNote:     function (id)     { return active.deleteNote(id); },
    bulkDeleteNotes: function (subject) { return active.bulkDeleteNotes(subject); },
    noteCounts:     function ()       { return active.noteCounts(); },
    listPassages:   function (f)      { return active.listPassages(f); },
    createPassage:  function (d)      { return active.createPassage(d); },
    updatePassage:  function (id, d)  { return active.updatePassage(id, d); },
    setPassageActive: function (id, on) { return active.setPassageActive(id, on); },
    deletePassage:  function (id)     { return active.deletePassage(id); },
    myAttempt:      function (id)     { return active.myAttempt(id); },
    recordPractice: function (run)    { return active.recordPractice(run); },
    listPractice:   function ()       { return active.listPractice(); },
    listMistakes:   function ()       { return active.listMistakes(); },
    listReview:     function ()       { return active.listReview(); },
    answerReview:   function (k, g)   { return active.answerReview(k, g); },
    getQuest:       function ()       { return active.getQuest(); },
    getWeeklyQuest: function ()       { return active.getWeeklyQuest(); },
    buyStreakFreeze: function ()      { return active.buyStreakFreeze(); },
    getReminders:   function ()       { return active.getReminders(); },
    setReminders:   function (c)      { return active.setReminders(c); },
    listBookmarks:  function ()       { return active.listBookmarks(); },
    addBookmark:    function (b)      { return active.addBookmark(b); },
    removeBookmark: function (key)    { return active.removeBookmark(key); },
    league:         function ()       { return active.league(); },

    /* Priority 4 — one question bank, results by Scholar ID, manual marking. */
    listQuestions:  function (f)      { return active.listQuestions(f); },
    questionCounts: function ()       { return active.questionCounts(); },
    createQuestion: function (d)      { return active.createQuestion(d); },
    updateQuestion: function (id, d)  { return active.updateQuestion(id, d); },
    setQuestionActive: function (id, on) { return active.setQuestionActive(id, on); },
    deleteQuestion: function (id)     { return active.deleteQuestion(id); },
    bulkDeleteQuestions: function (subject, section) { return active.bulkDeleteQuestions(subject, section); },

    /* Priority 4 — a spreadsheet of questions or notes, parsed by the shared
       core helper so a file cannot publish anything the form would refuse. */
    importQuestions: function (csv, filename, confirmDuplicate, subject, section, stampSection, replace) { return active.importQuestions(csv, filename, confirmDuplicate, subject, section, stampSection, replace); },
    importNotes:    function (csv, filename, confirmDuplicate)  { return active.importNotes(csv, filename, confirmDuplicate); },
    importHistory:  function ()       { return active.importHistory(); },

    setObjectiveMinutes: function (m) { return active.setObjectiveMinutes(m); },
    setObjectiveCount: function (s, n) { return active.setObjectiveCount(s, n); },
    objectiveBlueprint: function (f)  { return active.objectiveBlueprint(f); },
    setJambMinutes: function (m) { return active.setJambMinutes(m); },
    setJambReadyMin: function (m) { return active.setJambReadyMin(m); },
    openRound: function (section, subject) { return active.openRound(section, subject); },
    getRound: function (section, subject) { return active.getRound(section, subject); },
    setJambCount: function (s, n) { return active.setJambCount(s, n); },
    jambBlueprint: function (f)  { return active.jambBlueprint(f); },
    listResults:    function (f)      { return active.listResults(f); },
    getAttempt:     function (id)     { return active.getAttempt(id); },
    listOverview:   function ()       { return active.listOverview(); },
    markTheory:     function (id, m)  { return active.markTheory(id, m); },

    /* Priority 7 / 8 — account activation and founder-only credentials. */
    setStudentActive: function (id, on) { return active.setStudentActive(id, on); },
    setStudentTier: function (id, tier) { return active.setStudentTier(id, tier); },
    approveStudent:  function (id)      { return active.approveStudent(id); },
    rejectStudent:   function (id)      { return active.rejectStudent(id); },
    staffAccess:    function ()       { return active.staffAccess(); },
    setStaffPassword: function (id, pw) { return active.setStaffPassword(id, pw); },
    setConsolePasscode: function (p)  { return active.setConsolePasscode(p); },
    listResources: function () { return active.listResources(); },
    listPublishedResources: function () { return active.listPublishedResources(); },
    getResourceFile: function (id, opts) { return active.getResourceFile(id, opts); },
    setResourcePublished: function (id, published) {
      return active.setResourcePublished(id, published);
    },
    deleteResource: function (id) { return active.deleteResource(id); },
    uploadQuestionImage: function (formData) { return active.uploadQuestionImage(formData); },
    getQuestionImage: function (id) { return active.getQuestionImage(id); },
    uploadResource: function (formData) { return active.uploadResource(formData); },
    listVideos: function () { return active.listVideos(); },
    listPublishedVideos: function () { return active.listPublishedVideos(); },
    getVideoFile: function (id) { return active.getVideoFile(id); },
    setVideoPublished: function (id, published) {
      return active.setVideoPublished(id, published);
    },
    deleteVideo: function (id) { return active.deleteVideo(id); },
    uploadVideo: function (formData) { return active.uploadVideo(formData); },
    listClasses: function () { return active.listClasses(); },
    listUpcomingClasses: function () { return active.listUpcomingClasses(); },
    createClass: function (d) { return active.createClass(d); },
    updateClass: function (id, d) { return active.updateClass(id, d); },
    cancelClass: function (id) { return active.cancelClass(id); },
    deleteClass: function (id) { return active.deleteClass(id); },
    knockDoor: function (word, pw) { return active.knockDoor(word, pw); },
    listTutors: function () { return active.listTutors(); },
    createTutor: function (b) { return active.createTutor(b); },
    updateTutor: function (id, b) { return active.updateTutor(id, b); },
    resetTutorPassword: function (id, pw) { return active.resetTutorPassword(id, pw); },
    setTutorActive: function (id, on) { return active.setTutorActive(id, on); },
    listManagers: function () { return active.listManagers(); },
    createManager: function (b) { return active.createManager(b); },
    setManagerActive: function (id, on) { return active.setManagerActive(id, on); },
    resetManagerPassword: function (id, pw, pc) { return active.resetManagerPassword(id, pw, pc); },
    deleteManager: function (id) { return active.deleteManager(id); },
    listTutorViews: function (f) { return active.listTutorViews(f); },
    listManagerActions: function (f) { return active.listManagerActions(f); },
    getResultsExport: function (f) { return active.getResultsExport(f); },
    getResultsPdf: function (f) { return active.getResultsPdf(f); },
    tutorOverview: function () { return active.tutorOverview(); },
    listApprovals: function (subject) { return active.listApprovals(subject); },
    approveQuestion: function (id, edit) { return active.approveQuestion(id, edit); },
    returnQuestion: function (id, reason) { return active.returnQuestion(id, reason); },
    approveBatch: function (batch) { return active.approveBatch(batch); },
    listNotices: function (subject) { return active.listNotices(subject); },
    removeNotice: function (id) { return active.removeNotice(id); },
    sendBroadcast: function (d) { return active.sendBroadcast(d); },
    listBroadcasts: function () { return active.listBroadcasts(); },
    broadcastAudience: function (a) { return active.broadcastAudience(a); },
    deleteBroadcast: function (id) { return active.deleteBroadcast(id); },
    listAlerts: function () { return active.listAlerts(); },
    seenAlert: function (id) { return active.seenAlert(id); },
    listCohorts: function () { return active.listCohorts(); },
    setCohortTier: function (id, tier) { return active.setCohortTier(id, tier); },
    createCohort: function (d) { return active.createCohort(d); },
    updateCohort: function (id, d) { return active.updateCohort(id, d); },
    deleteCohort: function (id) { return active.deleteCohort(id); },
    setStudentCohort: function (id, cohortId) { return active.setStudentCohort(id, cohortId); },
    getMySettings: function () { return active.getMySettings(); },
  setSignupLimits: function (b)     { return active.setSignupLimits(b); },
  getSiteAnalytics: function ()      { return active.getSiteAnalytics(); },
  recordVisit: function (b)          { return active.recordVisit(b); },

    /* Shared domain rules, so app.js can validate a subject combination on
       screen with exactly the same code the driver enforces with. */
    rules: core
  };

  /* Test-only hook. Exposes both driver objects (never their data, just the
     objects themselves) so a regression test can assert every method the
     http driver implements also exists on the mock driver, and vice versa.
     This is the check that would have caught the original Phase 1.1 bug
     (a method present on one driver but not the other) automatically,
     instead of only surfacing at runtime when that driver happened to be
     active. Harmless in production: app.js and index.html never reference
     GOC.api._drivers, so this adds no behaviour outside the test suite. */
  GOC.api._drivers = { mock: mock, http: http };

  /* Homepage "Talk to G.O.C Academy" form. This is deliberately NOT routed
     through `active` alone: the academy's inbox (godsowncenterinfo@gmail.com)
     is reached over the public internet no matter which driver is running,
     while `active.recordContactMessage` keeps a durable local/server copy so
     a message is never silently dropped if that relay is unreachable (a
     school Wi-Fi blocking it, a visitor on a flaky connection, etc). Both
     legs are attempted; only a validation failure (empty field) rejects —
     everything else resolves so the visitor always sees a plain "sent"
     confirmation rather than a scary error for what is, from their side,
     a one-button form. */
  GOC.api.sendContact = function (data) {
    var name = String((data && data.name) || '').trim();
    var email = String((data && data.email) || '').trim();
    var message = String((data && data.message) || '').trim();
    if (!name) return fail('Please add your name.');
    if (!email || email.indexOf('@') < 1 || email.indexOf('@') === email.length - 1) return fail('Please add a valid email address.');
    if (!message) return fail('Please add a short message.');

    function storeCopy() {
      // Belt-and-braces only — its own failure must never surface as the
      // form's result, so it is swallowed here rather than in every caller.
      return active.recordContactMessage({ name: name, email: email, message: message }).catch(function () { return null; });
    }

    if (typeof fetch !== 'function') return storeCopy().then(function () { return { delivered: false }; });

    return fetch('https://formsubmit.co/ajax/godsowncenterinfo@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        name: name, email: email, message: message,
        _subject: 'New message from the G.O.C Academy Hub website',
        _template: 'table',
        _captcha: 'false'
      })
    }).then(function (r) {
      return storeCopy().then(function () { return { delivered: !!(r && r.ok) }; });
    }, function () {
      return storeCopy().then(function () { return { delivered: false }; });
    });
  };

  GOC.api.ready = (function () {
    var servable = global.location && String(global.location.protocol).indexOf('http') === 0;
    if (!servable || typeof fetch !== 'function' || typeof Promise !== 'function') return ok(mock.name);
    return fetch('api/health', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.service === 'goc-academy-hub') {
          active = http;
          if (d.passcodeLength) http._setPasscodeLength(d.passcodeLength);
        }
        return active.name;
      })
      .catch(function () { return active.name; });
  }());

}(typeof window !== 'undefined' ? window : this));
