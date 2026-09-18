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
    /* The create-account firewall. Demo mode holds it in memory, exactly like the
       console passcode above: this driver exists so the app can be walked through
       from a file:// page, and it keeps the same rule the server keeps. */
    var SIGNUP_CODE = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
    var SIGNUP_CODE_AT = null, SIGNUP_CODE_BY = null;
    var session = null;

    /* --------------------------------------------------- test-system stores */
    var questions = core.seedQuestions();
    var qSeq = questions.reduce(function (m, r) { return Math.max(m, r.id); }, 0);
    var notes = core.seedNotes();          /* Reading mode */
    var nSeq = notes.reduce(function (m, r) { return Math.max(m, r.id); }, 0);
    var importLog = [];                    /* mirrors server db.importLog, in memory */
    var ilSeq = 0;
    function logImport(entry){
      ilSeq++;
      importLog.push({
        id: ilSeq, kind: entry.kind,
        filename: entry.filename ? String(entry.filename).slice(0, 200) : null,
        fingerprint: entry.fingerprint || null,
        target: entry.target || null,
        read: entry.read || 0, added: entry.added || 0, skipped: entry.skipped || 0,
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


    /* No seeded attempt history: this is a real deployment with no demo
       roster, so there is nobody to seed it for. Real attempts are created
       later, in the studyStart/studySubmit-style calls below, as students
       actually sit papers. */
    var attempts = [];
    var aSeq = 0;
    var openAttempts = {};

    var validateQuestion = core.validateQuestion;

    function attemptSummary(a) {
      return {
        id: a.id, scholarId: a.scholarId, studentName: a.studentName,
        period: a.period, section: a.section, subject: a.subject,
        submittedAt: a.submittedAt, timeUsedSec: a.timeUsedSec,
        total: a.total, answered: a.answered, unanswered: a.unanswered,
        correct: a.correct, wrong: a.wrong,
        score: a.score, maxScore: a.maxScore, percent: a.percent,
        status: a.status, xpAwarded: a.xpAwarded || 0
      };
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
        exam: core.EXAM, performance: perfFor(s.id).overall
      };
    }
    function find(arr, id) {
      for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
      return null;
    }
    /* ONE-SIT RULE — mirrors server.js's hasSubmittedAttempt exactly: the
       period is a fixed constant, not a rotating week or month, so "already
       submitted this section+subject" is the whole rule. Only ever called
       with section 'theory' | 'objective' | 'jamb', never 'practice'. */
    function hasSubmittedAttempt(scholarId, section, subject) {
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        if (a.scholarId === scholarId && a.section === section && a.subject === subject) return true;
      }
      return false;
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
      var r = core.streakAfterActivity(s.streak, s.streakDay);
      s.streak = r.streak;
      s.streakDay = r.day;
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

      /* Sign-up is open to the public, so no session is required — but not to
         everybody: the academy's access code is checked first, before any other
         rule is examined, so a stranger who does not hold it learns nothing. */
      createStudent: function (data) {
        var codeV = core.validateSignupCode(data && data.signupCode);
        if (codeV.error) return fail(codeV.error);
        if (codeV.code !== SIGNUP_CODE) return fail(core.SIGNUP_CODE_REFUSED);
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
          last: 'Just registered', tag: 'g', tl: 'New',
          xp: 0, streak: 0, active: true, subjects: sub.subjects
        };
        students.push(rec);
        session = {
          id: rec.id, name: rec.name, role: 'student', title: null, unlocked: false,
          subjects: rec.subjects.slice(), exam: core.EXAM,
          sessionMinutes: core.clampSessionMinutes(settings.sessionMinutes),
          expiresAt: Date.now() + expiryMs('student')
        };
        return ok({ student: publicStudent(rec), session: clone(session) });
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
          mustChangePassword: true
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

      /* ============================================ STUDENT: the Web Test system */

      myProfile: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var p = perfFor(s.id);
        return ok({
          id: s.id, name: s.name, exam: core.EXAM,
          subjects: (s.subjects || []).slice(),
          xp: s.xp || 0, streak: s.streak || 0,
          level: core.levelFor(s.xp || 0),
          xpIntoLevel: core.xpIntoLevel(s.xp || 0),
          xpPerLevel: core.xpPerLevel(),
          performance: p.overall, performanceDetail: p,
          active: s.active !== false
        });
      },

      /* The catalogue a student may sit. Theory is one paper per subject, because
         a written paper is marked subject by subject. Objective is a single
         sitting of the whole combination, so it appears once however many
         subjects it covers. There is one test, not a weekly and a monthly one,
         so each paper appears exactly once. The JAMB-oriented paper is held back
         — it is offered as coming soon rather than listed as sittable. */
      listMyTests: function () {
        var e = requireStudent(); if (e) return e;
        var s = find(students, session.id);
        var subs = (s.subjects || []).slice();
        var rows = [], period = core.PERIOD;
        subs.forEach(function (sub) {
          var n = core.eligible(questions, { section: 'theory', subject: sub }).length;
          if (n) {
            rows.push({ period: period, section: 'theory', subject: sub,
                        questions: n, durationSec: 0,
                        completed: hasSubmittedAttempt(s.id, 'theory', sub) });
          }
        });
        var bp = core.objectiveBlueprint(questions, subs, settings.objectiveCounts);
        var total = core.objectiveTotal(bp);
        if (total) {
          rows.push({ period: period, section: 'objective', subject: core.OBJECTIVE_SUBJECT,
                      questions: total, durationSec: core.clampObjectiveMinutes(settings.objectiveMinutes) * 60,
                      papers: bp.map(function (r) { return { subject: r.subject, questions: r.serving }; }),
                      completed: hasSubmittedAttempt(s.id, 'objective', core.OBJECTIVE_SUBJECT) });
        }
        return ok({ subjects: subs, tests: rows, objectiveMinutes: core.clampObjectiveMinutes(settings.objectiveMinutes) });
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
        if (section === 'jamb') {
          return fail('The JAMB-oriented paper is coming soon. Sit the Objective session for a full timed sitting.');
        }
        var pool, dur, subs = (s.subjects || []).slice(), papers = null;
        if (section === 'objective') {
          /* One sitting of the whole combination: the student chooses nothing but
             when to begin, exactly as in the hall. */
          var bp = core.objectiveBlueprint(questions, subs, settings.objectiveCounts);
          pool = core.objectivePaper(questions, subs, settings.objectiveCounts);
          if (!pool.length) return fail('No questions have been published for that sitting yet.');
          subject = core.OBJECTIVE_SUBJECT;
          dur = core.clampObjectiveMinutes(settings.objectiveMinutes) * 60;
          papers = bp.filter(function (r) { return r.serving > 0; })
                     .map(function (r) { return { subject: r.subject, questions: r.serving }; });
        } else {
          if (subs.indexOf(subject) === -1) {
            return fail(subject + ' is not part of your registered subject combination.');
          }
          /* Some subjects are examined in the objective sitting only. `eligible`
             would serve nothing anyway, but "nothing published yet" would be the
             wrong reason to give — say the real one. */
          if (!core.theoryAllowed(subject)) return fail(core.noTheoryMessage(subject));
          pool = core.eligible(questions, { section: section, subject: subject });
          if (!pool.length) return fail('No questions have been published for that test yet.');
          dur = 0;   /* a written paper is sat without a clock */
        }
        // ONE-SIT RULE: same gate as server.js — checked here too, not just
        // in the catalogue, so a stale page or a replayed request can never
        // reopen a test that has already been submitted.
        if (hasSubmittedAttempt(s.id, section, subject)) {
          return fail('You have already submitted this test. It cannot be sat again.');
        }
        var rec = {
          id: 'A' + (++aSeq) + '-' + Date.now().toString(36),
          scholarId: s.id, studentName: s.name,
          period: period, section: section, subject: subject,
          questionIds: pool.map(function (r) { return r.id; }),
          startedAt: Date.now(), durationSec: dur
        };
        openAttempts[rec.id] = rec;
        return ok({
          attemptId: rec.id, period: period, section: section, subject: subject,
          kind: section === 'theory' ? 'theory' : 'objective',
          papers: papers, total: pool.length, durationSec: dur,
          questions: pool.map(core.forStudent)   /* answers stripped out */
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
            topics: topics
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
        return ok({ notes: clone(rows) });
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
        var pool = mode === 'practice'
          ? core.studyPool(questions, subject, null)
          : core.studyPool(questions, subject, r.topics);
        if (!pool.length) {
          return fail(mode === 'practice'
            ? 'No questions have been published for ' + subject + ' yet.'
            : 'No questions have been published for the topics you chose yet.');
        }
        var count = core.clampStudyCount(r.count, pool.length);
        var picked = core.pickStudy(pool, count);
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
            questions: picked.map(core.forPractice)
          });
        }
        return ok({
          mode: mode, paperId: rec.id, subject: subject,
          total: picked.length, durationSec: rec.durationSec,
          questions: picked.map(core.forStudent)     /* answers stripped out */
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
        var gain = 0, left = 0;
        if (mode === 'practice' && stu) {
          /* Marked here, not in the page: the XP is calculated from this side's
             own marking, so nothing a student's browser sends can inflate it. */
          left = core.practiceXpRemaining(practiceXpToday(stu));
          gain = Math.min(left, core.xpForPractice(m.answered, m.correct));
          if (gain > 0) {
            stu.xp = (stu.xp || 0) + gain;
            stu.practiceXpDay = core.dayStamp();
            stu.practiceXpToday = practiceXpToday(stu) + gain;
          }
        }
        /* A submitted study run — mock/CBT or practice — is the student's own
           effort for the day whether or not it happens to earn XP, so it is
           what the streak counts, same as on the server. */
        if (stu) bumpStreakRecord(stu);
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
          xpLeftToday: mode === 'practice' ? Math.max(0, left - gain) : 0,
          xpCapped: mode === 'practice' && gain < core.xpForPractice(m.answered, m.correct),
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
         Re-importing the same file (or content) is never refused: a bank a
         teacher keeps re-uploading (say, after adding a couple of rows, or
         just to be safe) always publishes. confirmDuplicate/findDuplicateImport
         are kept only so importHistory can still show "seen before", not to
         gate anything. */
      importQuestions: function (csv, filename, confirmDuplicate, subject, section) {
        var e = requireUnlocked(); if (e) return e;
        var fname = filename ? String(filename).slice(0, 200) : null;
        var tSubject = subject ? String(subject).trim() : '';
        var tSection = section ? String(section).trim().toLowerCase() : '';
        var target = (tSubject || tSection) ? { subject: tSubject, section: tSection } : null;
        var targetKey = target ? (target.subject + '/' + target.section) : null;
        var fingerprint = core.csvFingerprint(csv);
        var r = core.importCSV('questions', csv, target);
        if (r.error) return fail(r.error);
        var added = [];
        r.records.forEach(function (rec) {
          rec.id = ++qSeq;
          questions.push(rec);
          added.push(rec.id);
        });
        logImport({ kind: 'questions', filename: fname, fingerprint: fingerprint, target: targetKey, read: r.read, added: added.length, skipped: r.errors.length });
        return ok({ read: r.read, added: added.length, ids: added,
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
        var r = core.importCSV('notes', csv);
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

      /* ------------------------------------ THE CREATE-ACCOUNT FIREWALL (P8)
         Deliberately requireUnlocked() and not requireFounder(): the academy
         asked that the Academic Director be able to rotate this code too, since
         she is the one who hands it to a new intake. Like every other secret
         here the code is stored, never returned — a client may learn only how
         long it is and when it last changed. */

      setSignupCode: function (newCode) {
        var e = requireUnlocked(); if (e) return e;
        var v = core.validateSignupCode(newCode);
        if (v.error) return fail(v.error);
        SIGNUP_CODE = v.code;            /* real backend: scrypt hash + salt */
        SIGNUP_CODE_AT = new Date().toISOString();
        SIGNUP_CODE_BY = session.id;
        return ok({
          length: v.code.length, changed: true,
          changedAt: SIGNUP_CODE_AT, changedBy: SIGNUP_CODE_BY
        });
      },

      /* Who may change credentials, and how long the current passcode is. The
         passcode itself is never sent to the client. */
      staffAccess: function () {
        var e = requireUnlocked(); if (e) return e;
        return ok({
          staff: staff.map(function (a) { return { id: a.id, name: a.name, title: a.title }; }),
          isFounder: session.title === 'Founder',
          passcodeLength: PASSCODE.length,
          signupCodeLength: SIGNUP_CODE.length,
          signupCodeChangedAt: SIGNUP_CODE_AT,
          signupCodeChangedBy: SIGNUP_CODE_BY,
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
      createCohort: function (d) {
        var e = requireUnlocked(); if (e) return e;
        var b = d || {};
        return ok({
          ok: true, demo: true,
          cohort: {
            cohortId: 'DEMO-COHORT', name: String(b.name || ''), status: 'active',
            dailyLimitMin: null, sessionMinutes: null, sessionWarnMinutes: null,
            objectiveMinutes: null, objectiveCounts: null
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
          objectiveMinutes: null, objectiveCounts: {}, cohortId: null, cohortName: null,
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
      }
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
      listAllNotes:   function (f)     { return req('GET', '/notes' + qs(f)); },
      createNote:     function (d)     { return req('POST', '/notes', d); },
      updateNote:     function (id, d) { return req('PUT', '/notes/' + encodeURIComponent(id), d); },
      setNoteActive:  function (id, on) { return req('PUT', '/notes/' + encodeURIComponent(id) + '/active', { active: !!on }); },
      myAttempt:      function (id)    { return req('GET', '/me/results/' + encodeURIComponent(id)); },
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
      importQuestions: function (csv, filename, confirmDuplicate, subject, section) { return req('POST', '/questions/import', { csv: String(csv == null ? '' : csv), filename: filename ? String(filename) : undefined, confirmDuplicate: !!confirmDuplicate, subject: subject ? String(subject) : undefined, section: section ? String(section) : undefined }); },
      importNotes:    function (csv, filename, confirmDuplicate) { return req('POST', '/notes/import', { csv: String(csv == null ? '' : csv), filename: filename ? String(filename) : undefined, confirmDuplicate: !!confirmDuplicate }); },
      importHistory:  function ()      { return req('GET', '/import/history'); },

      setObjectiveMinutes: function (min) { return req('PUT', '/settings', { objectiveMinutes: Number(min) }); },
      setObjectiveCount:   function (subject, n) {
        return req('PUT', '/settings/objective-count', { subject: String(subject), questions: Number(n) });
      },
      objectiveBlueprint:  function (f) { return req('GET', '/objective/blueprint' + qs(f)); },

      listResults:    function (f)     { return req('GET', '/results' + qs(f)); },
      getAttempt:     function (id)    { return req('GET', '/results/' + encodeURIComponent(id)); },
      listOverview:   function ()      { return req('GET', '/admin/overview'); },
      markTheory:     function (id, m) { return req('POST', '/results/' + encodeURIComponent(id) + '/mark', { marks: m || {} }); },

      setStudentActive: function (id, on) { return req('PUT', '/students/' + encodeURIComponent(norm(id)) + '/active', { active: !!on }); },

      staffAccess:    function ()      { return req('GET', '/staff/access'); },
      setStaffPassword: function (id, pw) { return req('PUT', '/staff/' + encodeURIComponent(norm(id)) + '/password', { password: String(pw) }); },
      setConsolePasscode: function (p) {
        return req('PUT', '/settings/passcode', { passcode: String(p) })
          .then(function (d) { if (d && d.length) passLen = d.length; return d; });
      },
      listResources: function () {
        return req('GET', '/admin/resources');
      },
      getResourceFile: function (id) {
    return fetch(base + '/resources/' + encodeURIComponent(String(id)) + '/file', {
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
    listCohorts: function () {
      return req('GET', '/admin/cohorts');
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
    setSignupCode:  function (c)     { return req('PUT', '/settings/signup-code', { code: String(c) }); }
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
    listAllNotes:   function (f)      { return active.listAllNotes(f); },
    createNote:     function (d)      { return active.createNote(d); },
    updateNote:     function (id, d)  { return active.updateNote(id, d); },
    setNoteActive:  function (id, on) { return active.setNoteActive(id, on); },
    myAttempt:      function (id)     { return active.myAttempt(id); },
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
    importQuestions: function (csv, filename, confirmDuplicate, subject, section) { return active.importQuestions(csv, filename, confirmDuplicate, subject, section); },
    importNotes:    function (csv, filename, confirmDuplicate)  { return active.importNotes(csv, filename, confirmDuplicate); },
    importHistory:  function ()       { return active.importHistory(); },

    setObjectiveMinutes: function (m) { return active.setObjectiveMinutes(m); },
    setObjectiveCount: function (s, n) { return active.setObjectiveCount(s, n); },
    objectiveBlueprint: function (f)  { return active.objectiveBlueprint(f); },
    listResults:    function (f)      { return active.listResults(f); },
    getAttempt:     function (id)     { return active.getAttempt(id); },
    listOverview:   function ()       { return active.listOverview(); },
    markTheory:     function (id, m)  { return active.markTheory(id, m); },

    /* Priority 7 / 8 — account activation and founder-only credentials. */
    setStudentActive: function (id, on) { return active.setStudentActive(id, on); },
    staffAccess:    function ()       { return active.staffAccess(); },
    setStaffPassword: function (id, pw) { return active.setStaffPassword(id, pw); },
    setConsolePasscode: function (p)  { return active.setConsolePasscode(p); },
    listResources: function () { return active.listResources(); },
    listPublishedResources: function () { return active.listPublishedResources(); },
    getResourceFile: function (id) { return active.getResourceFile(id); },
    setResourcePublished: function (id, published) {
      return active.setResourcePublished(id, published);
    },
    deleteResource: function (id) { return active.deleteResource(id); },
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
    listCohorts: function () { return active.listCohorts(); },
    createCohort: function (d) { return active.createCohort(d); },
    updateCohort: function (id, d) { return active.updateCohort(id, d); },
    deleteCohort: function (id) { return active.deleteCohort(id); },
    setStudentCohort: function (id, cohortId) { return active.setStudentCohort(id, cohortId); },
    getMySettings: function () { return active.getMySettings(); },
  setSignupCode:  function (c)      { return active.setSignupCode(c); },

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
