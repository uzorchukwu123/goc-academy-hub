/* free2027-api.js — the browser's only door to the 2027 Free Tutorial Edition.
   ----------------------------------------------------------------------------
   Every original screen talks to GOC.api (js/api.js). The edition's screens are
   kept out of that file so that nothing in the hub's own API layer has to know
   this temporary mode exists: this file wraps ONE request helper, points it at
   /api/free2027/*, and exposes GOC.free.

   Two tokens are possible, and they are deliberately separate:
     • a free-tutorial participant's token (GOC.free.token), issued only after
       an email address has been verified — it opens the participant routes;
     • the management session's token, which GOC.api already holds and which
       only the console routes accept.

   A request is sent with the participant token unless `admin` is asked for, in
   which case the hub's own token is used. Neither is ever written into the page
   markup, and nothing here decides who may do what: the server does that, on
   every route, in server/server.js.

   Requires: js/goc-core.js and js/goc-free-2027.js loaded first. */
(function (global) {
  'use strict';

  var GOC = global.GOC = global.GOC || {};
  var rules = GOC.free2027;

  var TOKEN_KEY = 'goc.free2027.token';
  var participantToken = null;
  var mode = null;
  /* The token is kept in localStorage, NOT sessionStorage: closing the browser
     must not sign a student out while their session is still valid. The server
     holds the matching session (as a digest) and enforces the inactivity window,
     so a stored token is only useful until it expires or the student signs out.
     An older tab's sessionStorage token is adopted once so nobody who is
     already signed in is interrupted by this change. */
  function readStoredToken() {
    var t = null;
    try { t = global.localStorage ? global.localStorage.getItem(TOKEN_KEY) : null; } catch (e) { t = null; }
    if (t) return t;
    try {
      t = global.sessionStorage ? global.sessionStorage.getItem(TOKEN_KEY) : null;
      if (t && global.localStorage) {
        global.localStorage.setItem(TOKEN_KEY, t);
        global.sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) { /* private mode: whatever we managed to read is enough */ }
    return t || null;
  }
  participantToken = readStoredToken();

  function rememberToken(t) {
    participantToken = t || null;
    try {
      if (global.localStorage) {
        if (participantToken) global.localStorage.setItem(TOKEN_KEY, participantToken);
        else global.localStorage.removeItem(TOKEN_KEY);
      }
      /* Clear the old location too, so signing out cannot leave a usable token
         behind in either store. */
      if (global.sessionStorage) global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* private mode: memory only, which is fine */ }
  }

  function fail(msg) { return Promise.reject(new Error(msg)); }

  function request(method, path, body, opts) {
    var o = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var token = o.admin ? (GOC.api && GOC.api.staffToken ? GOC.api.staffToken() : null) : participantToken;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var init = { method: method, headers: headers };
    if (body !== undefined) init.body = JSON.stringify(body === null ? {} : body);
    return fetch(((GOC && GOC.apiBase) || 'api') + '/free2027' + path, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = (data && data.error) || 'The server could not complete that (' + r.status + ').';
          var err = new Error(msg);
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    });
  }

  var api = {
    rules: rules,

    /* ---- the central switch, as the page sees it ------------------------- */
    config: function () { return request('GET', '/config'); },

    /* ---- registration ---------------------------------------------------- */
    registerStart: function (d) { return request('POST', '/register/start', d || {}); },
    registerVerify: function (d) {
      return request('POST', '/register/verify', d || {}).then(function (r) {
        if (r && r.token) rememberToken(r.token);
        return r;
      });
    },

    /* Email + password login. The token this returns IS the authenticated
       session; it is kept in localStorage and persisted server-side, so a
       refresh, a reopened browser and a server restart all keep the student
       signed in until the inactivity window passes or they sign out. */
    login: function (d) {
      return request('POST', '/login', d || {}).then(function (r) {
        if (r && r.token) rememberToken(r.token);
        return r;
      });
    },

    /* ---- the participant's own side -------------------------------------- */
    hasToken: function () { return !!participantToken; },
    token: function () { return participantToken; },
    me: function () { return request('GET', '/me'); },
    setSubjects: function (subjects) { return request('PUT', '/subjects', { subjects: subjects }); },
    /* Sign out. The request is sent WHILE the token is still held, so the
       server can identify and delete exactly this session; only then is the
       browser's copy dropped. Clearing first would leave the stored session
       alive on the server. Nothing here touches student records: this call
       ends a session, it does not delete an account. */
    logout: function () {
      var t = participantToken;
      if (!t) { rememberToken(null); return Promise.resolve({ ok: true }); }
      return request('POST', '/logout', {}).then(function (r) {
        rememberToken(null);
        return r || { ok: true };
      }, function () {
        rememberToken(null);
        return { ok: true };
      });
    },
    /* Drop the browser's copy without a server round trip — used when the
       server has already said the session is expired or invalid. */
    forgetToken: function () { rememberToken(null); },
    activities: function () { return request('GET', '/activities'); },
    start: function (id) { return request('POST', '/activities/' + encodeURIComponent(String(id)) + '/start', {}); },
    resume: function (attemptId) { return request('GET', '/attempts/' + encodeURIComponent(String(attemptId))); },
    /* Post-submission review of this candidate's own paper. The server checks
       ownership and refuses while the paper is still open. */
    review: function (attemptId) { return request('GET', '/attempts/' + encodeURIComponent(String(attemptId)) + '/review'); },
    answer: function (attemptId, questionId, choice) {
      return request('PUT', '/attempts/' + encodeURIComponent(String(attemptId)) + '/answer', { questionId: String(questionId), choice: choice });
    },
    submit: function (attemptId, responses) {
      return request('POST', '/attempts/' + encodeURIComponent(String(attemptId)) + '/submit', { responses: responses || {} });
    },
    /* Public catalogue: lets a visitor open the CBT Portal with no token,
       no registration and no login step. Public activity metadata only. */
    catalogue: function () { return request('GET', '/catalogue'); },
    results: function () { return request('GET', '/results'); },
    /* The candidate's own programme record: profile, enrolment, access, the
       lesson catalogue and how far through it they are. */
    programme: function () { return request('GET', '/programme'); },
    completeLesson: function (id) {
      return request('POST', '/lessons/' + encodeURIComponent(String(id)) + '/complete', {});
    },
    leaderboards: function () { return request('GET', '/leaderboards'); },
    leaderboard: function (id) { return request('GET', '/leaderboards/' + encodeURIComponent(String(id))); },

    /* ---- console ---------------------------------------------------------
       `admin` is passed on every one of these, so the management token is
       used and the server's own guard (signed in + unlocked + the route's
       capability) decides whether the call is allowed. */
    adminOverview: function () { return request('GET', '/admin/overview', undefined, { admin: true }); },
    /* Programme availability only — the programme's own active/inactive
       setting. There is no website-mode call: the hostname decides which
       experience a visitor enters. */
    setEnabled: function (on) { return request('PUT', '/admin/edition', { enabled: on === true }, { admin: true }); },
    setCourses: function (list) { return request('PUT', '/admin/courses', { courses: list }, { admin: true }); },
    participants: function (q) { return request('GET', '/admin/participants' + (q ? '?q=' + encodeURIComponent(String(q)) : ''), undefined, { admin: true }); },
    participantsCsvUrl: function () { return 'api/free2027/admin/participants.csv'; },
    setParticipantActive: function (id, on) {
      return request('PUT', '/admin/participants/' + encodeURIComponent(String(id)), { active: on === true }, { admin: true });
    },
    removeParticipant: function (id) {
      return request('DELETE', '/admin/participants/' + encodeURIComponent(String(id)), undefined, { admin: true });
    },
    adminActivities: function () { return request('GET', '/admin/activities', undefined, { admin: true }); },
    saveActivity: function (d, id) {
      return id
        ? request('PUT', '/admin/activities/' + encodeURIComponent(String(id)), d || {}, { admin: true })
        : request('POST', '/admin/activities', d || {}, { admin: true });
    },
    /* Deletes ONLY the activity. confirm:true is required by the server;
       attempts, answers, scores and results are always preserved. */
    deleteActivity: function (id) { return request('DELETE', '/admin/activities/' + encodeURIComponent(String(id)), { confirm: true }, { admin: true }); },
    activityState: function (id, action, d) {
      return request('POST', '/admin/activities/' + encodeURIComponent(String(id)) + '/' + action, d || {}, { admin: true });
    },
    activityResults: function (id) { return request('GET', '/admin/activities/' + encodeURIComponent(String(id)) + '/results', undefined, { admin: true }); },
    leaderboardAction: function (id, action) {
      return request('POST', '/admin/activities/' + encodeURIComponent(String(id)) + '/leaderboard/' + action, {}, { admin: true });
    },
    attemptDetail: function (id) { return request('GET', '/admin/attempts/' + encodeURIComponent(String(id)), undefined, { admin: true }); },
    records: function () { return request('GET', '/admin/records', undefined, { admin: true }); },
    /* The edition's own question picker. It reads the edition's LOCAL banks on
       the server (/api/free2027/admin/questions?bank=…), never Appwrite and
       never the shared db.questions — so activities can be built on a box
       where the Appwrite Database API is unavailable. */
    adminQuestions: function (subject, bank) {
      var qs = '?bank=' + encodeURIComponent(bank === 'competition' ? 'competition' : 'weekly');
      if (subject) qs += '&subject=' + encodeURIComponent(String(subject));
      return request('GET', '/admin/questions' + qs, undefined, { admin: true });
    },
    /* The two independent question banks (weekly / competition). */
    adminBanks: function () { return request('GET', '/admin/question-banks', undefined, { admin: true }); },
    adminBankQuestions: function (bank, params) {
      params = params || {};
      var q = [];
      if (params.q) q.push('q=' + encodeURIComponent(String(params.q)));
      if (params.subject) q.push('subject=' + encodeURIComponent(String(params.subject)));
      return request('GET', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/questions' + (q.length ? '?' + q.join('&') : ''), undefined, { admin: true });
    },
    adminBankCreate: function (bank, d) { return request('POST', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/questions', d || {}, { admin: true }); },
    adminBankUpdate: function (bank, id, d) { return request('PUT', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/questions/' + encodeURIComponent(String(id)), d || {}, { admin: true }); },
    adminBankDelete: function (bank, ids, confirm) { return request('POST', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/questions/delete', { ids: ids, confirm: confirm === true }, { admin: true }); },
    adminBankDeleteAll: function (bank, confirm) { return request('POST', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/delete-all', { confirm: confirm === true }, { admin: true }); },
    adminBankImport: function (bank, csv, preview) { return request('POST', '/admin/question-banks/' + encodeURIComponent(String(bank)) + '/import', { csv: csv, preview: preview === true }, { admin: true }); },
    adminLessons: function () { return request('GET', '/admin/lessons', undefined, { admin: true }); },
    saveLesson: function (d, id) {
      return id
        ? request('PUT', '/admin/lessons/' + encodeURIComponent(String(id)), d || {}, { admin: true })
        : request('POST', '/admin/lessons', d || {}, { admin: true });
    },
    deleteLesson: function (id) { return request('DELETE', '/admin/lessons/' + encodeURIComponent(String(id)), undefined, { admin: true }); },
    adminProgress: function () { return request('GET', '/admin/progress', undefined, { admin: true }); },
    adminAudit: function () { return request('GET', '/admin/audit', undefined, { admin: true }); },
    newSession: function (label, confirm) {
      return request('POST', '/admin/sessions/new', { label: label, confirm: confirm === true }, { admin: true });
    },
    archives: function () { return request('GET', '/admin/archives', undefined, { admin: true }); },
    archive: function (file) { return request('GET', '/admin/archives/' + encodeURIComponent(String(file)), undefined, { admin: true }); },
    /* The console's own view of the mode (used when the hub is in Original
       Mode but the administrator is about to switch it on). */
    modeInfo: function () {
      return request('GET', '/config').then(function (c) { mode = c; return c; });
    }
  };

  GOC.free = api;
}(typeof window !== 'undefined' ? window : this));
