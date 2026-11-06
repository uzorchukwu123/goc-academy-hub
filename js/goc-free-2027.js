/* ============================================================================
   G.O.C Academy Hub — 2027 Free Tutorial Edition (shared rules)
   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS
   The 2027 Free Tutorial Edition is a temporary, switchable mode of the same
   application — not a second application. Every rule about it that BOTH the
   browser and the server must agree on lives here, once, exactly as
   js/goc-core.js does for the original hub:

     • the two website modes and the one central feature switch,
     • what a free-tutorial participant record may contain,
     • OTP rules and the e-mail address policy,
     • activity scheduling (open / closed / upcoming / ended / reopened),
     • the examination timer and attempt rules,
     • ranking (highest score first, then the shortest completion time),
     • the public leaderboard rules (top 10 only, admin approval required),
     • the session/archive record shape.

   It loads in the browser (attaches to window.GOC.free2027) and in Node
   (module.exports), so the page and the server can never drift apart. It holds
   NO storage, NO clock of its own and NO credentials.

   REMOVAL: delete this file and js/free2027-*.js, drop the one `edition`
   block from server/server.js and the free2027 stylesheet, and the original
   hub is exactly what it was. Nothing here ever writes to db.students,
   db.attempts or any other core record.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.GOC = root.GOC || {}; root.GOC.free2027 = api; }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ------------------------------------------------------- 1. website modes */

  var MODE_ORIGINAL = 'original';
  var MODE_FREE = 'free2027';
  var MODES = [MODE_ORIGINAL, MODE_FREE];
  var MODE_LABELS = { original: 'Original Mode', free2027: '2027 Free Tutorial Mode' };

  /* The one central feature switch. GOC_FREE_2027 names the mode the
     deployment opens in. When it is switched off there is no 2027 edition at
     all: the console offers nothing about it and every free-tutorial route on
     the server refuses. Switching the MODE (Original <-> 2027 Free Tutorial)
     is a separate, reversible action the administrator performs inside the
     console and is stored with the rest of the data. */
  function editionDefault(envValue) {
    var v = String(envValue == null ? '' : envValue).trim().toLowerCase();
    if (v === MODE_FREE || v === 'free' || v === 'free-tutorial' || v === 'free_tutorial' || v === '1' || v === 'on' || v === 'true') return MODE_FREE;
    return MODE_ORIGINAL;
  }
  function cleanMode(v) { return MODES.indexOf(String(v)) > -1 ? String(v) : MODE_ORIGINAL; }
  /* The mode the site should actually show: the administrator's choice, held
     inside the edition's own record, and never anything else. A stored value
     that this build does not understand falls back to Original, so a corrupt
     record can never leave the public site with no homepage. */
  function activeMode(edition, featureOn) {
    if (!featureOn) return MODE_ORIGINAL;
    var e = edition || {};
    if (e.enabled === false) return MODE_ORIGINAL;
    return cleanMode(e.mode);
  }
  function modeLabel(mode) { return MODE_LABELS[cleanMode(mode)] || MODE_LABELS[MODE_ORIGINAL]; }

  /* The free-tutorial screens. In 2027 Free Tutorial Mode a browser may sit on
     one of these and nothing else (plus the homepage, the admin gate and the
     password-change screen a manager is forced through). */
  var SCREENS = ['free-home', 'free-register', 'free-login', 'free-portal', 'free-exam', 'free-result', 'free-leaderboard'];
  function isFreeScreen(id) { return SCREENS.indexOf(String(id)) > -1; }

  /* ------------------------------------------------- 2. participant records */

  /* The default set of courses a UTME candidate may say they intend to study.
     The administrator can change the list in the console; this is only the
     starting point, so a fresh install is usable on day one. */
  var DEFAULT_COURSES = [
    'Medicine and Surgery', 'Pharmacy', 'Nursing Science', 'Medical Laboratory Science',
    'Engineering (all branches)', 'Computer Science', 'Mass Communication', 'Law',
    'Accounting', 'Economics', 'Microbiology', 'Biochemistry',
    'Physics', 'Chemistry', 'Mathematics', 'Agriculture', 'Architecture', 'Other'
  ];

  var NAME_MIN = 3;
  var NAME_MAX = 80;
  var COURSE_MAX = 80;
  var EMAIL_MAX = 160;

  /* One e-mail rule for the whole edition. Deliberately simple and strict:
     one @, a dot in the domain, no spaces. This is an identifier, not a
     deliverability test — the OTP is what proves the address is real. */
  function cleanEmail(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase().slice(0, EMAIL_MAX);
    if (!s) return { error: 'Enter your email address.' };
    if (/\s/.test(s)) return { error: 'An email address cannot contain spaces.' };
    var at = s.indexOf('@');
    if (at < 1 || at !== s.lastIndexOf('@')) return { error: 'Enter a valid email address.' };
    var domain = s.slice(at + 1);
    if (domain.indexOf('.') < 1 || domain.slice(-1) === '.' || domain.indexOf('..') > -1) {
      return { error: 'Enter a valid email address.' };
    }
    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(s)) return { error: 'Enter a valid email address.' };
    return { email: s };
  }

  function cleanName(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (s.length < NAME_MIN) return { error: 'Enter your full name.' };
    if (!/[a-z]/i.test(s)) return { error: 'Enter your full name.' };
    return { name: s };
  }

  function cleanCourse(v, courses) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, COURSE_MAX);
    if (!s) return { error: 'Choose the course you intend to study.' };
    var list = Array.isArray(courses) && courses.length ? courses : DEFAULT_COURSES;
    /* The console list is a convenience, not a cage: an address the academy
       adds later is still accepted verbatim, so a stale page cannot lock a
       candidate out. Anything else is trimmed to COURSE_MAX and kept. */
    if (list.indexOf(s) === -1 && s.length < 2) return { error: 'Choose the course you intend to study.' };
    return { course: s };
  }

  /* What the administrator may change about the course list. */
  function cleanCourseList(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (c) {
      var s = String(c == null ? '' : c).replace(/\s+/g, ' ').trim().slice(0, COURSE_MAX);
      var k = s.toLowerCase();
      if (s.length < 2 || seen[k]) return;
      seen[k] = true; out.push(s);
    });
    return out.slice(0, 60);
  }

  /* A student identifier is PERMANENT and sequential: the first student of the
     programme is GOC-F-001, the next GOC-F-002, and so on. The sequence is
     allocated on the server inside the data lock (so two simultaneous
     registrations can never receive the same number), the issued numbers are
     remembered forever in db.free2027.studentIds (so a deleted student's number
     is never handed out again), and the identifier never changes for the life
     of the programme. It carries no personal data and is never an email address
     or an internal database ID. */
  var ID_RE = /^GOC-F-\d{3,}$/;
  /* Identifiers issued by the earlier random scheme stay VALID forever. Those
     students already hold records, attempts and results under that ID, so it is
     still accepted everywhere an identifier is read; only NEW registrations use
     the sequential scheme. Nothing is ever renumbered. */
  var LEGACY_ID_RE = /^GOC-F27-[A-F0-9]{20}$/;
  function isLegacyParticipantId(v) { return LEGACY_ID_RE.test(String(v == null ? '' : v).trim().toUpperCase()); }
  function isParticipantId(v) {
    var s = String(v == null ? '' : v).trim().toUpperCase();
    return ID_RE.test(s) || LEGACY_ID_RE.test(s);
  }
  function studentId(n) {
    var k = Math.max(1, Math.floor(Number(n) || 1));
    var s = String(k);
    while (s.length < 3) s = '0' + s;
    return 'GOC-F-' + s;
  }
  /* The highest sequence number already represented by an identifier. A legacy
     random identifier carries no sequence number, so it answers 0 and simply
     does not move the counter. */
  function idSeqOf(id) {
    var m = /^GOC-F-(\d+)$/.exec(String(id == null ? '' : id).trim().toUpperCase());
    return m ? parseInt(m[1], 10) : 0;
  }
  /* Kept as an alias: the old name of studentId(). */
  function participantId(n) { return studentId(n); }

  /* The registration password. It is stored only as a salted scrypt hash on
     the server; this rule just makes sure a real password was chosen. One rule,
     shared by the page and the server so they can never disagree. The messages
     name the exact failure: too short, or missing a letter or a number. */
  var PASSWORD_MIN = 8;
  var PASSWORD_MAX = 72;
  function cleanPassword(v) {
    var s = String(v == null ? '' : v);
    if (s.length < PASSWORD_MIN) return { error: 'Your password must contain at least ' + PASSWORD_MIN + ' characters.' };
    if (s.length > PASSWORD_MAX) return { error: 'Your password cannot be longer than ' + PASSWORD_MAX + ' characters.' };
    if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return { error: 'Use a password containing both letters and numbers.' };
    return { password: s };
  }

  /* The shape the PUBLIC side of the site may hold. No email address, no OTP,
     no verification state, nothing the administrator wrote privately. Every
     student-facing route answers with this (or a `self` record — below). */
  function publicParticipant(p) {
    var r = p || {};
    return {
      id: String(r.id || ''),
      name: String(r.name || ''),
      course: String(r.course || ''),
      verified: r.verified === true
    };
  }

  /* What a signed-in participant may see about themselves. An email address is
     echoed back masked, because "keep email addresses private" is a rule about
     what the site displays, not only about what the database stores. */
  function maskEmail(v) {
    var s = String(v == null ? '' : v).trim();
    var at = s.indexOf('@');
    if (at < 1) return '';
    var name = s.slice(0, at), domain = s.slice(at + 1);
    var head = name.slice(0, Math.min(2, name.length));
    return head + new Array(Math.max(2, name.length - head.length + 1)).join('•') + '@' + domain;
  }
  function selfParticipant(p) {
    var r = p || {};
    return {
      id: String(r.id || ''), name: String(r.name || ''), course: String(r.course || ''),
      verified: r.verified === true, email: maskEmail(r.email),
      createdAt: String(r.createdAt || '')
    };
  }

  /* ------------------------------------------------- session policy (auth) */

  /* How long a signed-in student may be INACTIVE before they must log in again.
     This is the single source of the timeout: the server reads it from here and
     the deployment may override it with GOC_FREE_2027_SESSION_IDLE_MIN. It is an
     inactivity window, not a fixed session length — every authenticated request
     moves it forward, so a student who keeps working is never interrupted,
     while one who walks away is asked to authenticate again. */
  var SESSION_IDLE_MIN = 480;              /* 8 hours, the programme's default */
  var SESSION_IDLE_MIN_FLOOR = 5;          /* never configure a useless window */
  var SESSION_IDLE_MIN_CEILING = 43200;    /* 30 days */
  function sessionIdleMinutes(envValue) {
    var n = Math.floor(Number(envValue));
    if (!isFinite(n) || n <= 0) return SESSION_IDLE_MIN;
    return Math.min(SESSION_IDLE_MIN_CEILING, Math.max(SESSION_IDLE_MIN_FLOOR, n));
  }

  /* -------------------------------------------------------- 3. OTP policy */

  var OTP_LENGTH = 6;
  var OTP_TTL_MIN = 15;          /* how long a code stays usable */
  var OTP_RESEND_SEC = 60;       /* one code per minute per address */
  var OTP_MAX_TRIES = 5;         /* wrong guesses before the code burns */
  var OTP_MAX_PER_HOUR = 6;      /* codes issued to one address per hour */

  /* The digits the person typed, with spaces dropped but nothing added or cut
     short: a code of the wrong length is refused rather than trimmed into a
     guess at the right one. */
  function cleanOtp(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, '');
    if (!/^\d+$/.test(s) || s.length !== OTP_LENGTH) {
      return { error: 'Enter the ' + OTP_LENGTH + '-digit code from your email.' };
    }
    return { code: s };
  }
  /* Comparing two codes without leaking how many digits matched. */
  function otpMatches(given, stored) {
    var a = String(given == null ? '' : given), b = String(stored == null ? '' : stored);
    if (a.length !== b.length || !a.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    return diff === 0;
  }

  /* ----------------------------------------------------- 4. activity rules
     An activity is a weekly assessment or a competition. It is only ever
     opened for sitting inside its window, and only while its status is
     'published'. 'closed' means the academy closed it early; 'reopened' is
     what the administrator sets to give latecomers another chance, and the
     window is then extended to the reopen time if that is later. */

  var KIND_WEEKLY = 'weekly';
  var KIND_COMPETITION = 'competition';
  var KINDS = [KIND_WEEKLY, KIND_COMPETITION];
  var KIND_LABELS = { weekly: 'Weekly Assessment', competition: 'Competition' };

  function cleanKind(v) { return KINDS.indexOf(String(v)) > -1 ? String(v) : null; }
  function kindLabel(v) { return KIND_LABELS[String(v)] || 'Activity'; }

  var STATUS_DRAFT = 'draft';
  var STATUS_PUBLISHED = 'published';
  var STATUS_CLOSED = 'closed';
  var STATUS_ARCHIVED = 'archived';
  var STATUSES = [STATUS_DRAFT, STATUS_PUBLISHED, STATUS_CLOSED, STATUS_ARCHIVED];
  function cleanStatus(v) { return STATUSES.indexOf(String(v)) > -1 ? String(v) : null; }

  var MIN_DURATION_MIN = 1;
  var MAX_DURATION_MIN = 300;
  var MIN_ATTEMPTS = 1;
  var MAX_ATTEMPTS = 10;
  var MAX_QUESTIONS = 100;
  /* A competition may now hold a full standard UTME paper of 180 questions.
     Weekly assessments keep the limit they always had: only the competition
     cap rises, and only far enough to admit the standard paper. */
  var MAX_COMPETITION_QUESTIONS = 180;
  function maxQuestionsFor(kind) {
    return cleanKind(kind) === KIND_COMPETITION ? MAX_COMPETITION_QUESTIONS : MAX_QUESTIONS;
  }

  /* The edition's banks support exactly these five subjects. They are metadata
     on a question, never a destination: the selected bank panel / activity
     category alone decides where a question lives and serves. */
  var SUBJECTS = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];

  /* The Free Tutorial CSV contract. It deliberately has no section, expected
     or maxMark column: every row is a multiple-choice question for the bank
     the administrator selected. The internal question model still carries an
     optional/default `section` for compatibility with the hub's validator. */
  var CSV_HEADER = 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId';
  var CSV_COLUMNS = ['subject', 'topic', 'text', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'answer', 'difficulty', 'explanation', 'active', 'year', 'passageId'];

  /* Optional subject distribution for automatic allocation. Blank / null means
     "draw from all eligible questions". When present, the positive counts must
     add up to the requested question count; the server checks each subject's
     available eligible questions before assigning anything. */
  function cleanSubjectDistribution(v, questionCount) {
    if (v === undefined || v === null || v === '') return { distribution: null };
    if (typeof v !== 'object' || Array.isArray(v)) return { error: 'Subject distribution must be an object of subject counts.' };
    var out = {}, sum = 0, bad = false;
    Object.keys(v).forEach(function (k) {
      var subject = String(k).trim();
      if (SUBJECTS.indexOf(subject) < 0) return;
      var n = Number(v[k]);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) { bad = true; return; }
      if (n > 0) { out[subject] = n; sum += n; }
    });
    if (bad) return { error: 'Subject distribution counts must be whole numbers of zero or more.' };
    var keys = Object.keys(out);
    if (!keys.length) return { distribution: null };
    if (sum !== questionCount) return { error: 'Subject distribution must add up to the requested number of questions (' + questionCount + ').' };
    return { distribution: out };
  }

  function parseWhen(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return new Date(v).getTime();
    var s = String(v).trim();
    if (!s) return null;
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  /* Where an activity stands right now, for one participant. Pure: `now` and
     the activity are both handed in, so a test drives any date it likes.
     Returns one of: draft | closed | upcoming | open | ended. */
  function activityState(a, now) {
    var x = a || {}, t = Number(now) || Date.now();
    if (x.status === STATUS_DRAFT || !x.published) return 'draft';
    if (x.status === STATUS_CLOSED) return 'closed';
    if (x.status === STATUS_ARCHIVED) return 'closed';
    var opens = Number(x.opensAt) || 0;
    var closes = Number(x.closesAt) || 0;
    /* A reopen is an explicit administrator decision to let latecomers in: it
       moves the closing edge, it never moves the opening edge. */
    if (x.reopenedAt) {
      var re = Number(x.reopenClosesAt) || Number(x.reopenedAt);
      if (re > closes) closes = re;
    }
    if (opens && t < opens) return 'upcoming';
    if (closes && t > closes) return 'ended';
    return 'open';
  }
  function canSit(a, now) { return activityState(a, now) === 'open'; }

  function stateLabel(state) {
    return { draft: 'Draft', closed: 'Closed by the academy', upcoming: 'Opens later', open: 'Open now', ended: 'Closed' }[state] || 'Closed';
  }

  /* The validation the console runs before an activity may be published.
     `existing` is the stored draft; `patch` is what the form sent. Both are
     merged here so a partial edit is judged on the whole record. */
  function validateActivity(patch, existing) {
    var p = patch || {}, e = existing || {};
    var pick = function (k, d) { return p[k] === undefined ? (e[k] === undefined ? d : e[k]) : p[k]; };

    var kind = cleanKind(pick('kind', ''));
    if (!kind) return { error: 'Choose whether this is a weekly assessment or a competition.' };

    var title = String(pick('title', '') == null ? '' : pick('title', '')).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (title.length < 3) return { error: 'Give the activity a title of at least three characters.' };

    var opensAt = parseWhen(pick('opensAt', null));
    var closesAt = parseWhen(pick('closesAt', null));
    if (opensAt == null) return { error: 'Set the date and time the activity opens.' };
    if (closesAt == null) return { error: 'Set the date and time the activity closes.' };
    if (closesAt <= opensAt) return { error: 'The closing time must be after the opening time.' };

    var durationMin = Math.round(Number(pick('durationMin', 0)));
    if (!isFinite(durationMin) || durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
      return { error: 'Set an examination duration between ' + MIN_DURATION_MIN + ' and ' + MAX_DURATION_MIN + ' minutes.' };
    }
    var maxAttempts = Math.round(Number(pick('maxAttempts', 1)));
    if (!isFinite(maxAttempts) || maxAttempts < MIN_ATTEMPTS || maxAttempts > MAX_ATTEMPTS) {
      return { error: 'Set a maximum of between ' + MIN_ATTEMPTS + ' and ' + MAX_ATTEMPTS + ' attempts.' };
    }
    /* Historical activities stored an explicit questionIds list. New activities
       store a requested questionCount and the server allocates questionIds from
       the bound bank. Both shapes remain readable so old records keep working. */
    var ids = Array.isArray(pick('questionIds', [])) ? pick('questionIds', []) : [];
    ids = ids.map(function (x) { return String(x); }).filter(Boolean);
    var seen = {};
    ids = ids.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
    var cap = maxQuestionsFor(kind);
    if (ids.length > cap) return { error: 'An activity can hold at most ' + cap + ' questions.' };

    var questionCount = Math.round(Number(pick('questionCount', ids.length || 0)));
    if (!isFinite(questionCount) || questionCount < 1 || questionCount > cap) {
      return { error: 'Set how many questions to include, between 1 and ' + cap + '.' };
    }
    var dist = cleanSubjectDistribution(pick('subjectDistribution', null), questionCount);
    if (dist.error) return { error: dist.error };
    /* A competition configured as a standard 180-question UTME paper must carry
       the standard distribution. Other competitions and every weekly assessment
       keep the distribution rules they already had. */
    if (kind === KIND_COMPETITION && questionCount === JAMB_QUESTION_COUNT) {
      var jambProblem = jambDistributionProblem(dist.distribution);
      if (jambProblem) return { error: jambProblem };
    }
    var randomizeQuestions = pick('randomizeQuestions', true) !== false;
    var randomizeOptions = pick('randomizeOptions', false) === true;

    return {
      rec: {
        kind: kind, title: title,
        instructions: String(pick('instructions', '') == null ? '' : pick('instructions', '')).trim().slice(0, 2000),
        opensAt: opensAt, closesAt: closesAt,
        durationMin: durationMin, maxAttempts: maxAttempts,
        questionIds: ids,
        questionCount: questionCount,
        subjectDistribution: dist.distribution,
        randomizeQuestions: randomizeQuestions,
        randomizeOptions: randomizeOptions
      }
    };
  }

  /* ------------------------------------------------- 5. attempts + timing */

  /* The clock belongs to the server. A page that has been tampered with can
     claim any remaining time it likes; the deadline below is recomputed from
     the stored start time every time a question is served, so the answer the
     server gives is always the true one. `graceSec` covers a slow network
     without handing out free minutes. */
  var GRACE_SEC = 5;

  function attemptDeadline(a) {
    var x = a || {};
    return (Number(x.startedAt) || 0) + (Number(x.durationSec) || 0) * 1000;
  }
  function attemptRemainingSec(a, now) {
    var t = Number(now) || Date.now();
    var left = Math.round((attemptDeadline(a) - t) / 1000);
    return left > 0 ? left : 0;
  }
  function attemptExpired(a, now) {
    return attemptRemainingSec(a, now) <= 0;
  }
  /* A submitted attempt is finished; an open one may be resumed; an expired
     one is closed out (the answers kept) rather than deleted. */
  function attemptState(a, now) {
    var x = a || {};
    if (x.submittedAt) return 'submitted';
    if (attemptExpired(x, now)) return 'expired';
    return 'open';
  }
  /* How many attempts were really used: a submitted one counts, an abandoned
     open one does not (a candidate who closed the tab mid-paper gets it back). */
  function attemptsUsed(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) { return !!(a && a.submittedAt); }).length;
  }
  function attemptsLeft(activity, mine) {
    var max = Math.max(1, Math.round(Number(activity && activity.maxAttempts) || 1));
    return Math.max(0, max - attemptsUsed(mine));
  }
  function openAttempt(list, now) {
    var rows = Array.isArray(list) ? list : [];
    var t = Number(now) || Date.now();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && !rows[i].submittedAt && attemptState(rows[i], t) === 'open') return rows[i];
    }
    return null;
  }

  /* ------------------------------------ 5b. standard JAMB UTME competition
     A competition configured as a standard UTME paper is exactly 180 questions:
     Use of English 60, and three other subjects 40 each. Each subject is scaled
     to 100, so the paper is out of 400.

     This is keyed off the EXISTING configuration (kind + questionCount +
     subjectDistribution) rather than a new stored flag, so no activity record,
     schema or historical result changes shape. A competition configured any
     other way keeps the marking it already had. */
  var JAMB_QUESTION_COUNT = 180;
  var JAMB_ENGLISH = 'Use of English';
  var JAMB_ENGLISH_QUESTIONS = 60;
  var JAMB_OTHER_QUESTIONS = 40;
  var JAMB_SUBJECT_MAX = 100;
  var JAMB_TOTAL_MAX = 400;
  var JAMB_OTHER_SUBJECTS = 3;

  function isJambCompetition(rec) {
    return !!rec && rec.kind === KIND_COMPETITION &&
      Number(rec.questionCount) === JAMB_QUESTION_COUNT;
  }

  /* Null when the distribution is the standard one, otherwise a sentence
     naming what is wrong with it. */
  function jambDistributionProblem(dist) {
    if (!dist || typeof dist !== 'object' || Array.isArray(dist)) {
      return 'A standard 180-question competition needs a subject distribution: ' +
        JAMB_ENGLISH + ' ' + JAMB_ENGLISH_QUESTIONS + ' and three other subjects ' +
        JAMB_OTHER_QUESTIONS + ' each.';
    }
    var keys = Object.keys(dist).filter(function (k) { return Number(dist[k]) > 0; });
    if (Number(dist[JAMB_ENGLISH]) !== JAMB_ENGLISH_QUESTIONS) {
      return JAMB_ENGLISH + ' must carry exactly ' + JAMB_ENGLISH_QUESTIONS + ' questions.';
    }
    var others = keys.filter(function (k) { return k !== JAMB_ENGLISH; });
    if (others.length !== JAMB_OTHER_SUBJECTS) {
      return 'A standard competition needs exactly ' + JAMB_OTHER_SUBJECTS +
        ' other subjects alongside ' + JAMB_ENGLISH + '.';
    }
    for (var i = 0; i < others.length; i++) {
      if (SUBJECTS.indexOf(others[i]) < 0) return 'Unknown subject: ' + others[i] + '.';
      if (Number(dist[others[i]]) !== JAMB_OTHER_QUESTIONS) {
        return others[i] + ' must carry exactly ' + JAMB_OTHER_QUESTIONS + ' questions.';
      }
    }
    return null;
  }

  /* English first, then the other three in the configured order. */
  function jambSubjectOrder(dist) {
    var others = Object.keys(dist || {}).filter(function (k) {
      return k !== JAMB_ENGLISH && Number(dist[k]) > 0;
    });
    return [JAMB_ENGLISH].concat(others);
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ONE percentage rule for every surface: always derived from the official
     score and its maximum, never from a separately kept figure. */
  function percentOf(score, maxScore) {
    var max = Number(maxScore) || 0;
    if (!max) return 0;
    return round2((Number(score) || 0) / max * 100);
  }

  /* Subject-based marking. `rows` are the marking engine's own per-question
     rows, so the raw correct counts come from the same authoritative marking
     that produced the individual answer verdicts. Each subject is rounded once
     to 2dp and the total is the sum of those rounded subject scores, so the
     four subject scores always add up to the displayed total. */
  function jambSubjectScores(rows, dist) {
    var order = jambSubjectOrder(dist);
    var counts = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.kind !== 'objective') return;
      var subject = String(r.subject || '');
      if (!counts[subject]) counts[subject] = { correct: 0, seen: 0 };
      counts[subject].seen++;
      if (r.isCorrect === true) counts[subject].correct++;
    });
    var subjects = order.map(function (subject) {
      var want = Number(dist[subject]) || 0;
      var c = counts[subject] || { correct: 0, seen: 0 };
      return {
        subject: subject,
        correct: c.correct,
        total: want,
        score: want ? round2(c.correct / want * JAMB_SUBJECT_MAX) : 0,
        maxScore: JAMB_SUBJECT_MAX
      };
    });
    var total = round2(subjects.reduce(function (sum, x) { return sum + x.score; }, 0));
    return {
      subjects: subjects,
      score: total,
      maxScore: JAMB_TOTAL_MAX,
      percent: percentOf(total, JAMB_TOTAL_MAX)
    };
  }

  /* ------------------------------------------------------------- 6. ranking
     Highest score first. Where two candidates hold the same score, the one who
     finished the paper in the shorter time is placed above the other. A
     candidate who never finished has no completion time and always ranks
     below a candidate who did. Ties beyond that fall back to the participant
     ID, so the order never wobbles between two reads. */

  function betterRank(a, b) {
    var sa = Number(a && a.score) || 0, sb = Number(b && b.score) || 0;
    if (sa !== sb) return sa > sb ? -1 : 1;
    var ta = Number(a && a.timeUsedSec), tb = Number(b && b.timeUsedSec);
    var va = isFinite(ta) && ta > 0 ? ta : Infinity;
    var vb = isFinite(tb) && tb > 0 ? tb : Infinity;
    if (va !== vb) return va < vb ? -1 : 1;
    return String((a && a.participantId) || '') < String((b && b.participantId) || '') ? -1 : 1;
  }

  /* Rows in: one per submitted attempt ({participantId, name, course, score,
     maxScore, timeUsedSec, submittedAt}). A participant who sat the paper more
     than once appears once, with their best attempt. */
  function rankRows(rows) {
    var best = {}, order = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.participantId) return;
      var id = String(r.participantId);
      var row = {
        participantId: id,
        name: String(r.name || ''),
        course: String(r.course || ''),
        score: Number(r.score) || 0,
        maxScore: Number(r.maxScore) || 0,
        percent: Number(r.percent) || 0,
        timeUsedSec: Number(r.timeUsedSec) || 0,
        submittedAt: Number(r.submittedAt) || 0,
        attemptCount: Number(r.attemptCount) || 1
      };
      if (!best[id]) { best[id] = row; order.push(id); return; }
      var prev = best[id];
      row.attemptCount = (prev.attemptCount || 1) + (row.attemptCount || 1) - 1;
      if (betterRank(row, prev) < 0) best[id] = row;
    });
    var list = order.map(function (id) { return best[id]; });
    list.sort(function (a, b) { return betterRank(a, b); });
    /* Competition ranking: equal scores AND equal times share a place. */
    var place = 0, prevKey = null;
    list.forEach(function (r, i) {
      var key = r.score + '|' + (isFinite(r.timeUsedSec) && r.timeUsedSec > 0 ? r.timeUsedSec : '');
      if (key !== prevKey) { place = i + 1; prevKey = key; }
      r.rank = place;
    });
    return list;
  }

  var PUBLIC_TOP_N = 10;

  /* What the PUBLIC leaderboard shows: published competitions only, top 10
     only, and only handled fields. */
  function publicLeaderboard(activity, rows) {
    if (!activity || activity.kind !== KIND_COMPETITION) return null;
    /* Approved AND published, by the same rule the console uses. */
    if (!leaderboardPublished(activity)) return null;
    var ranked = rankRows(rows);
    return {
      activityId: String(activity.id || ''),
      title: String(activity.title || ''),
      publishedAt: Number((activity.leaderboard && activity.leaderboard.publishedAt) || 0),
      totalCompetitors: ranked.length,
      /* Percentage is the public performance metric. The raw score and its
         maximum deliberately do not leave the server here: a candidate reads
         their own score on their own result, while the board compares
         percentages. Ordering and ties are unchanged — betterRank still ranks
         on the official score, then the shortest completion time. */
      rows: ranked.slice(0, PUBLIC_TOP_N).map(function (r) {
        return { rank: r.rank, participantId: r.participantId, name: r.name, course: r.course,
          percent: percentOf(r.score, r.maxScore), timeUsedSec: r.timeUsedSec };
      })
    };
  }

  /* A participant outside the top 10 may still see where they came. */
  function myPosition(activity, rows, participantId) {
    if (!activity || activity.kind !== KIND_COMPETITION) return null;
    var ranked = rankRows(rows);
    var id = String(participantId || '');
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].participantId === id) {
        return {
          rank: ranked[i].rank, of: ranked.length,
          inTop: ranked[i].rank <= PUBLIC_TOP_N,
          score: ranked[i].score, maxScore: ranked[i].maxScore,
          timeUsedSec: ranked[i].timeUsedSec
        };
      }
    }
    return null;
  }

  /* A leaderboard is only public when the administrator has approved it AND
     published it AND the competition is not a draft. */
  function leaderboardPublished(activity) {
    var lb = (activity && activity.leaderboard) || {};
    return !!(activity && activity.kind === KIND_COMPETITION &&
      lb.approved === true && lb.published === true && activity.status !== STATUS_DRAFT);
  }

  /* ------------------------------------------------------- 7. sessions
     The free tutorial keeps its own sessions. Starting a new one archives the
     previous one to a local JSON file (written by the server) and starts
     clean; nothing in the original hub's records is touched. */
  var SESSION_LABEL_MAX = 60;
  function cleanSessionLabel(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, SESSION_LABEL_MAX);
    return s || 'Free Tutorial Session';
  }
  function archiveName(sessionId) {
    var id = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
    return 'free2027-archive-' + (id || 'session') + '.json';
  }

  function emptySession(n) {
    var seq = Math.max(1, Math.floor(Number(n) || 1));
    return {
      id: 'F27-S' + seq,
      label: 'Free Tutorial Session ' + seq,
      seq: seq,
      startedAt: Date.now(),
      endedAt: null,
      participantSeq: 0,
      activitySeq: 0,
      attemptSeq: 0,
      participants: [],
      activities: [],
      attempts: [],
      /* Programme lessons belong to the session, like the activities: they are
         created by the administrator and archived with it. */
      lessons: [],
      lessonSeq: 0,
      /* Who changed what in the programme (administrators only). Bounded, and
         never a password, a passcode or a one-time code. */
      audit: [],
      archives: []
    };
  }

  /* ------------------------------------------- 8. programme lessons
     A lesson is a short teaching item the candidate marks as done. It is
     programme-owned (nothing is copied from the hub's own lesson material and
     nothing in the hub is written), so the edition never needs Appwrite to
     show progress. */
  var LESSON_TITLE_MIN = 3;
  var LESSON_TITLE_MAX = 120;
  var LESSON_SUMMARY_MAX = 300;
  var LESSON_SUBJECT_MAX = 40;
  var LESSON_MAX = 200;
  var LESSON_ID_RE = /^F27-L-\d{3,6}$/;

  function lessonId(n) {
    var k = Math.max(1, Math.floor(Number(n) || 1));
    return 'F27-L-' + (k < 10 ? '00' + k : k < 100 ? '0' + k : String(k));
  }
  function isLessonId(v) { return LESSON_ID_RE.test(String(v == null ? '' : v).trim().toUpperCase()); }

  function cleanLesson(input) {
    var b = input || {};
    var title = String(b.title == null ? '' : b.title).replace(/\s+/g, ' ').trim().slice(0, LESSON_TITLE_MAX);
    if (title.length < LESSON_TITLE_MIN) return { error: 'Give the lesson a title of at least ' + LESSON_TITLE_MIN + ' characters.' };
    var subject = String(b.subject == null ? '' : b.subject).replace(/\s+/g, ' ').trim().slice(0, LESSON_SUBJECT_MAX);
    var summary = String(b.summary == null ? '' : b.summary).replace(/\s+/g, ' ').trim().slice(0, LESSON_SUMMARY_MAX);
    return { lesson: { title: title, subject: subject, summary: summary } };
  }

  function publicLesson(l) {
    var r = l || {};
    return {
      id: String(r.id || ''),
      title: String(r.title || ''),
      subject: String(r.subject || ''),
      summary: String(r.summary || ''),
      order: Number(r.order) || 0,
      active: r.active !== false
    };
  }

  /* The lessons a candidate may see: live ones, in the administrator's order. */
  function liveLessons(lessons) {
    return (Array.isArray(lessons) ? lessons : [])
      .filter(function (l) { return l && l.active !== false; })
      .slice()
      .sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  }

  /* A candidate's own progress. It is derived from the completion map that is
     stored on the participant, so a reload, a restart or an archive can never
     disagree with what the candidate sees. */
  function progressOf(participant, lessons) {
    var p = participant || {};
    var done = (p.progress && p.progress.lessons) || {};
    var live = liveLessons(lessons);
    var rows = live.map(function (l) {
      var at = done[String(l.id)];
      return Object.assign(publicLesson(l), { done: !!at, completedAt: at ? Number(at) : null });
    });
    var completed = rows.filter(function (r) { return r.done; }).length;
    var total = rows.length;
    return {
      lessons: rows,
      completed: completed,
      total: total,
      percent: total ? Math.round((completed / total) * 100) : 0,
      lastAt: (p.progress && Number(p.progress.lastAt)) || null
    };
  }

  /* --------------------------------------------- 9. programme audit records
     One entry per administrative change, written by the server after the
     change succeeded. It names the administrator (staff ID and role) and what
     was changed — never a password, passcode or one-time code. */
  var AUDIT_MAX = 1000;
  var AUDIT_ACTOR_MAX = 40;
  var AUDIT_ACTION_MAX = 60;
  var AUDIT_TARGET_MAX = 80;

  function auditEntry(actor, action, target, detail, at) {
    var a = actor || {};
    function cut(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
    return {
      at: Number(at) || Date.now(),
      actorId: cut(a.id, AUDIT_ACTOR_MAX) || 'system',
      actorRole: cut(a.role, AUDIT_ACTOR_MAX) || '',
      action: cut(action, AUDIT_ACTION_MAX) || 'unknown',
      target: cut(target, AUDIT_TARGET_MAX),
      detail: cut(detail, AUDIT_TARGET_MAX)
    };
  }
  function pushAudit(session, entry) {
    if (!Array.isArray(session.audit)) session.audit = [];
    session.audit.unshift(entry);
    if (session.audit.length > AUDIT_MAX) session.audit = session.audit.slice(0, AUDIT_MAX);
    return entry;
  }

  return {
    /* modes */
    MODE_ORIGINAL: MODE_ORIGINAL,
    MODE_FREE: MODE_FREE,
    MODES: MODES.slice(),
    MODE_LABELS: MODE_LABELS,
    editionDefault: editionDefault,
    cleanMode: cleanMode,
    activeMode: activeMode,
    modeLabel: modeLabel,
    SCREENS: SCREENS.slice(),
    isFreeScreen: isFreeScreen,
    /* participants */
    DEFAULT_COURSES: DEFAULT_COURSES.slice(),
    NAME_MIN: NAME_MIN,
    NAME_MAX: NAME_MAX,
    COURSE_MAX: COURSE_MAX,
    EMAIL_MAX: EMAIL_MAX,
    cleanEmail: cleanEmail,
    cleanName: cleanName,
    cleanCourse: cleanCourse,
    cleanCourseList: cleanCourseList,
    isParticipantId: isParticipantId,
    isLegacyParticipantId: isLegacyParticipantId,
    studentId: studentId,
    idSeqOf: idSeqOf,
    participantId: participantId,
    PASSWORD_MIN: PASSWORD_MIN,
    PASSWORD_MAX: PASSWORD_MAX,
    cleanPassword: cleanPassword,
    publicParticipant: publicParticipant,
    selfParticipant: selfParticipant,
    maskEmail: maskEmail,
    /* sessions */
    SESSION_IDLE_MIN: SESSION_IDLE_MIN,
    sessionIdleMinutes: sessionIdleMinutes,
    /* otp */
    OTP_LENGTH: OTP_LENGTH,
    OTP_TTL_MIN: OTP_TTL_MIN,
    OTP_RESEND_SEC: OTP_RESEND_SEC,
    OTP_MAX_TRIES: OTP_MAX_TRIES,
    OTP_MAX_PER_HOUR: OTP_MAX_PER_HOUR,
    cleanOtp: cleanOtp,
    otpMatches: otpMatches,
    /* activities */
    KIND_WEEKLY: KIND_WEEKLY,
    KIND_COMPETITION: KIND_COMPETITION,
    KINDS: KINDS.slice(),
    KIND_LABELS: KIND_LABELS,
    cleanKind: cleanKind,
    kindLabel: kindLabel,
    STATUS_DRAFT: STATUS_DRAFT,
    STATUS_PUBLISHED: STATUS_PUBLISHED,
    STATUS_CLOSED: STATUS_CLOSED,
    STATUS_ARCHIVED: STATUS_ARCHIVED,
    STATUSES: STATUSES.slice(),
    cleanStatus: cleanStatus,
    MIN_DURATION_MIN: MIN_DURATION_MIN,
    MAX_DURATION_MIN: MAX_DURATION_MIN,
    MIN_ATTEMPTS: MIN_ATTEMPTS,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    MAX_QUESTIONS: MAX_QUESTIONS,
    MAX_COMPETITION_QUESTIONS: MAX_COMPETITION_QUESTIONS,
    maxQuestionsFor: maxQuestionsFor,
    SUBJECTS: SUBJECTS.slice(),
    CSV_HEADER: CSV_HEADER,
    CSV_COLUMNS: CSV_COLUMNS.slice(),
    cleanSubjectDistribution: cleanSubjectDistribution,
    parseWhen: parseWhen,
    activityState: activityState,
    canSit: canSit,
    stateLabel: stateLabel,
    validateActivity: validateActivity,
    /* attempts */
    GRACE_SEC: GRACE_SEC,
    attemptDeadline: attemptDeadline,
    attemptRemainingSec: attemptRemainingSec,
    attemptExpired: attemptExpired,
    attemptState: attemptState,
    attemptsUsed: attemptsUsed,
    attemptsLeft: attemptsLeft,
    openAttempt: openAttempt,
    /* standard JAMB UTME competition structure and marking */
    JAMB_QUESTION_COUNT: JAMB_QUESTION_COUNT,
    JAMB_ENGLISH: JAMB_ENGLISH,
    JAMB_ENGLISH_QUESTIONS: JAMB_ENGLISH_QUESTIONS,
    JAMB_OTHER_QUESTIONS: JAMB_OTHER_QUESTIONS,
    JAMB_SUBJECT_MAX: JAMB_SUBJECT_MAX,
    JAMB_TOTAL_MAX: JAMB_TOTAL_MAX,
    JAMB_OTHER_SUBJECTS: JAMB_OTHER_SUBJECTS,
    isJambCompetition: isJambCompetition,
    jambDistributionProblem: jambDistributionProblem,
    jambSubjectOrder: jambSubjectOrder,
    jambSubjectScores: jambSubjectScores,
    round2: round2,
    percentOf: percentOf,
    /* ranking */
    betterRank: betterRank,
    rankRows: rankRows,
    PUBLIC_TOP_N: PUBLIC_TOP_N,
    publicLeaderboard: publicLeaderboard,
    myPosition: myPosition,
    leaderboardPublished: leaderboardPublished,
    /* sessions */
    SESSION_LABEL_MAX: SESSION_LABEL_MAX,
    cleanSessionLabel: cleanSessionLabel,
    archiveName: archiveName,
    emptySession: emptySession,
    /* programme lessons and progress */
    LESSON_MAX: LESSON_MAX,
    LESSON_TITLE_MAX: LESSON_TITLE_MAX,
    LESSON_SUMMARY_MAX: LESSON_SUMMARY_MAX,
    lessonId: lessonId,
    isLessonId: isLessonId,
    cleanLesson: cleanLesson,
    publicLesson: publicLesson,
    liveLessons: liveLessons,
    progressOf: progressOf,
    /* programme audit records */
    AUDIT_MAX: AUDIT_MAX,
    auditEntry: auditEntry,
    pushAudit: pushAudit
  };
}));
