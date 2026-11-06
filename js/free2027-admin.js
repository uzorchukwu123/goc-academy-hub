/* free2027-admin.js — the 2027 Free Tutorial Management panel in the console.
   ----------------------------------------------------------------------------
   The administrator's console is the hub's own console (the same tile grid, the
   same sections, the same sign-in and passcode). This file adds exactly one
   tile — "2027 Free Tutorial Management" — and the panel behind it, so the
   programme is run from the console that already exists rather than from a
   second application.

   What the panel manages, all of it through /api/free2027/admin/* (and so
   behind the server's own `need: 'console'` guard, which refuses every request
   unless the account is signed in, unlocked, and holds the capability named on
   the route):

     • the WEBSITE MODE — Original Mode <-> 2027 Free Tutorial Mode, with a
       confirmation step before anything changes;
     • PARTICIPANTS — the verified list, switching an address off, removing a
       record, and a deliberate CSV export (the only place a full email address
       is disclosed, as a downloaded file);
     • ACTIVITIES — weekly assessments and competitions: create, edit, upload
       and edit questions, set the window, the duration and the maximum number
       of attempts, then publish, close or reopen;
     • RESULTS — everyone's submitted attempts for one activity, with the
       private weekly results kept out of any public surface;
     • LEADERBOARDS — approve, publish, unpublish (competitions only);
     • SESSION RECORDS — who verified, started and submitted;
     • SESSION ARCHIVING — start a new session, which archives the current one
       to a local JSON file after a confirmation, and read any archive back.

   Everything is drawn with the console's existing classes (ad-card, ad-field,
   ad-btn …), so it matches the rest of the console and needs almost no new CSS.
   Requires: js/goc-free-2027.js, js/api.js, js/free2027-api.js. */
(function (global) {
  'use strict';

  var GOC = global.GOC = global.GOC || {};
  var rules = GOC.free2027;
  var api = GOC.free;
  if (!rules || !api) return;

  var A = {};                 // panel state
  A.tab = 'mode';
  A.overview = null;
  A.activities = [];
  A.editing = null;           // the activity being edited, or a fresh draft
  A.selectedQuestion = null;
  A.participants = [];
  A.archive = null;

  function $(id) { return document.getElementById(id); }
  function roleKey() { return global.admMe && String(global.admMe.roleKey || ''); }
  function isFounder() { return roleKey() === 'founder' || (global.admMe && global.admMe.id === 'GOC-A-001'); }
  function mayManageProgramme() { return isFounder() || roleKey() === 'academic-director'; }
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
  function say(msg) {
    if (typeof global.toast === 'function') global.toast(msg);
    else console.log('[free2027-admin] ' + msg);
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = 'Please wait…'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }

  /* <input type="datetime-local"> speaks local time without a zone; the server
     stores milliseconds. These two convert without ever guessing a zone. */
  function toLocalInput(ms) {
    if (!ms) return '';
    var d = new Date(Number(ms));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fromLocalInput(v) {
    var s = String(v || '').trim();
    if (!s) return null;
    var t = new Date(s).getTime();
    return isFinite(t) ? t : null;
  }
  function when(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function confirmDo(msg) {
    return typeof global.confirm === 'function' ? global.confirm(msg) : true;
  }

  /* ======================================================== THE PANEL MARKUP */

  function panel() {
    return '<div class="ad-card"><div class="ad-h">2027 Free Tutorial Management</div>' +
      '<p class="ad-p">The temporary 2027 Free Tutorial Edition runs beside the hub, on its own records ' +
      '(<b>GOC-F27-…</b> participants), its own activities and its own sessions. Nothing here reads or changes a ' +
      'G.O.C student, attempt or staff record.</p>' +
      '<div class="ad-seg" id="f27AdmTabs">' + tabsHtml() + '</div>' +
      '<div id="f27AdmBody"><div class="ad-loading">Reading the programme…</div></div></div>';
  }
  function tabsHtml() {
    var tabs = [['mode', 'Programme settings'], ['participants', 'Participants'], ['activities', 'Activities'],
      ['banks', 'Question Banks'], ['results', 'Results'], ['leaderboards', 'Leaderboards'], ['records', 'Session records']];
    if (isFounder()) tabs.push(['sessions', 'Sessions & archive']);
    return tabs.map(function (t) {
      return '<button data-f27adm="' + t[0] + '"' + (A.tab === t[0] ? ' class="on"' : '') +
        ' onclick="f27AdmTab(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('');
  }
  function body(html) {
    var host = $('f27AdmBody');
    if (host) host.innerHTML = html;
  }
  function loading(txt) { body('<div class="ad-loading">' + esc(txt || 'Loading…') + '</div>'); }
  function failText(er) {
    return '<p class="ad-warn">' + esc((er && er.message) || 'That could not be loaded.') + '</p>';
  }

  /* The panel is drawn by the console's own admOpen(), so it is registered there
     and the tile is added to the console's tile list. Both are additive: the
     hub's other twenty-seven sections are untouched. */
  A.mount = function () {
    /* One extra tile, drawn beside the console's own twenty-seven. It is added
       at runtime rather than to ADM_TILE_META so that the hub's section rule,
       its tile grid and the tests that pin their number stay exactly as they
       are: the edition's records are not a console section in the capability
       map, they are a temporary programme, and every one of its routes carries
       its own guard on the server. */
    /* Register the hooks even before sign-in: the script loads while admMe is
       still empty. The menu/open hooks below check the current role on every
       invocation, so waiting for a role here would leave the console unmounted
       after the administrator subsequently signs in. */
    var open = global.admOpen;
    if (typeof open === 'function' && !open.__f27) {
      var wrapped = function (section) {
        if (section === 'free2027') {
          if (!mayManageProgramme()) { say('The Free Tutorial Console is for the Founder and Academic Director.'); return; }
          var b = $('admSheetBody'), back = $('admSheetBack'), sheet = $('admSheet'), title = $('admSheetTitle');
          if (b) {
            if (title) title.textContent = '2027 Free Tutorial';
            b.innerHTML = panel();
            b.scrollTop = 0;
            if (back) back.classList.add('show');
            if (sheet) sheet.classList.add('show');
          }
          /* Mark this tile active and leave every other tile alone. */
          var nav = $('admTileNav');
          if (nav) {
            var tiles = nav.querySelectorAll('.adm-tile');
            for (var i = 0; i < tiles.length; i++) {
              tiles[i].classList.toggle('active', tiles[i].getAttribute('data-section') === 'free2027');
            }
          }
          A.tab = 'mode';
          global.f27AdmLoad();
          return;
        }
        return open.apply(this, arguments);
      };
      wrapped.__f27 = true;
      global.admOpen = wrapped;
    }

    var apply = global.admMenuApply;
    if (typeof apply === 'function' && !apply.__f27) {
      var painted = function () {
        var out = apply.apply(this, arguments);
        if (!mayManageProgramme()) return out;
        var nav = $('admTileNav');
        if (nav && nav.innerHTML.indexOf('data-section="free2027"') < 0) {
          nav.insertAdjacentHTML('beforeend',
            '<button class="adm-tile" data-section="free2027" onclick="admOpen(\'free2027\')" aria-label="2027 Free Tutorial">' +
            '<span class="at-label">2027 Free Tutorial</span></button>');
        }
        return out;
      };
      painted.__f27 = true;
      global.admMenuApply = painted;
    }
  };

  /* ============================================================ LANGUAGE */

  A.tab = 'mode';

  global.f27AdmTab = function (tab) {
    A.tab = tab || 'mode';
    var tabs = document.querySelectorAll('#f27AdmTabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-f27adm') === A.tab);
    global.f27AdmLoad();
  };

  global.f27AdmLoad = function () {
    if (A.tab === 'mode') return loadMode();
    if (A.tab === 'participants') return loadParticipants();
    if (A.tab === 'activities') return loadActivities();
    if (A.tab === 'banks') return loadBanks();
    if (A.tab === 'results') return loadResults();
    if (A.tab === 'leaderboards') return loadLeaderboards();
    if (A.tab === 'records') return loadRecords();
    if (A.tab === 'sessions') return loadSessions();
    return loadMode();
  };

  /* ======================================================= 1. WEBSITE MODE */

  function loadMode() {
    loading('Reading the mode…');
    api.adminOverview().then(function (o) {
      A.overview = o;
      var on = o.enabled === true;
      var free = o.mode === rules.MODE_FREE && on;
      body(
        '<div class="ad-metric"><span>Website mode</span><b>' + esc(rules.modeLabel(o.mode)) + '</b></div>' +
        '<div class="ad-metric"><span>2027 edition</span><b>' + (on ? 'Active' : 'Switched off') + '</b></div>' +
        '<div class="ad-metric"><span>Delivery of one-time codes</span><b>' +
          (o.otpDelivery && o.otpDelivery.available ? 'Email (SMTP configured)' :
            'Email verification not configured — registration is unavailable') +
        '</b></div>' +
        '<p class="ad-note">Original Mode restores the full G.O.C Academy Hub and every one of its features. ' +
        '2027 Free Tutorial Mode shows the homepage and the CBT Portal only — weekly assessments, competitions and the ' +
        'competition leaderboard. Switching either way deletes nothing: every G.O.C record, question and setting stays exactly where it is.</p>' +
        (isFounder()
          ? '<div class="ad-actions">' +
              '<button class="ad-btn ' + (free ? '' : 'pri') + '" onclick="f27AdmSetMode(\'' + rules.MODE_ORIGINAL + '\')">Switch to Original Mode</button>' +
              '<button class="ad-btn ' + (free ? 'pri' : '') + '" onclick="f27AdmSetMode(\'' + rules.MODE_FREE + '\')">Switch to 2027 Free Tutorial Mode</button>' +
            '</div>'
          : '<p class="ad-note">Only the Founder can change site mode or edition-wide settings. Academic programme content and reports remain available to you.</p>') +
        '<div class="ad-grid2" style="margin-top:14px">' +
          '<div class="ad-field"><label>Course list (one per line)</label>' +
            '<textarea id="f27Courses" rows="7">' + esc((o.courses || []).join('\n')) + '</textarea></div>' +
          '<div><p class="ad-note">The courses a candidate may say they intend to study. A candidate can still type ' +
            'a course that is not on the list; this only powers the suggestions.</p>' +
            '<div class="ad-actions"><button class="ad-btn" onclick="f27AdmSaveCourses(this)">Save course list</button></div>' +
            '<p class="ad-note" style="margin-top:14px">Session in progress: <b>' + esc(o.session.label) + '</b> (' + esc(o.session.id) + ')<br>' +
            o.session.participants + ' registered · ' + o.session.verified + ' verified · ' + o.session.activities + ' activities (' +
            o.session.published + ' published) · ' + o.session.submitted + ' submitted papers.</p></div>' +
        '</div>' +
        '<div class="ad-actions" style="margin-top:6px">' +
          '<button class="ad-btn" onclick="f27AdmReloadSite()">Reload the public site</button>' +
        '</div>'
      );
    }, function (er) {
      body(failText(er) + '<p class="ad-note">The edition may be switched off for this deployment. Set <code>GOC_FREE_2027</code> to <code>1</code> ' +
        'in the environment to make the switch available.</p>');
    });
  }

  global.f27AdmSetMode = function (mode) {
    if (!isFounder()) { say('Only the Founder can change Free Tutorial site settings.'); return; }
    var label = rules.modeLabel(mode);
    var free = mode === rules.MODE_FREE;
    /* The confirmation step. The server insists on `confirm:true` too, so this
       is not the only thing standing between a mis-click and the switch. */
    if (!confirmDo('Switch the website to ' + label + '?' + (free
      ? '\n\nThe original G.O.C Academy Hub homepage remains public; unrelated student modules are disabled and the 2027 Free Tutorial student experience is enabled.'
      : '\n\nEvery feature of the G.O.C Academy Hub comes straight back, exactly as it was.'))) return;
    api.setMode(mode, true).then(function (r) {
      say('Website is now in ' + r.label);
      loadMode();
      if (global.GOC && GOC.freeUI && GOC.freeUI.applyMode) {
        /* The console is looking at the site it just changed, so the new mode is
           applied without moving the administrator off the console. */
        GOC.freeUI.applyMode(r.mode, r.enabled !== false, { stay: true });
      }
    }, function (er) {
      say(er.message || 'The mode could not be changed.');
    });
  };

  global.f27AdmReloadSite = function () {
    /* A plain reload is the simplest way to be certain the public site is
       drawn from the stored mode. */
    global.location.reload();
  };

  global.f27AdmSaveCourses = function (btn) {
    var t = $('f27Courses');
    var list = String((t && t.value) || '').split(/\r?\n/);
    busy(btn, true);
    api.setCourses(list).then(function (r) {
      busy(btn, false);
      say('Course list saved (' + r.courses.length + ')');
    }, function (er) {
      busy(btn, false);
      say(er.message || 'Could not save the course list.');
    });
  };

  /* ====================================================== 2. PARTICIPANTS */

  function loadParticipants() {
    loading('Reading the participants…');
    api.participants('').then(function (r) {
      A.participants = r.participants || [];
      var rows = A.participants.map(function (p) {
        return '<div class="f27-admin-row">' +
          '<div><b>' + esc(p.name) + ' <span class="f27-chip ' + (p.verified ? 'ok' : 'warn') + '">' + (p.verified ? 'verified' : 'unverified') + '</span>' +
          (p.active === false ? ' <span class="f27-chip no">off</span>' : '') + '</b>' +
          '<span>' + esc(p.id) + ' · ' + esc(p.course) + ' · ' + esc(p.email) + '</span>' +
          '<span>registered ' + esc(when(Number(p.createdAt) || 0)) + ' · ' + p.attempts + ' submitted paper' + (p.attempts === 1 ? '' : 's') +
          (p.best > -1 ? ' · best ' + p.best : '') + '</span></div>' +
          '<button class="ad-btn" onclick="f27AdmToggleParticipant(\'' + esc(p.id) + '\',' + (p.active === false) + ')">' + (p.active === false ? 'Switch on' : 'Switch off') + '</button>' +
          '<button class="ad-btn danger" onclick="f27AdmRemoveParticipant(\'' + esc(p.id) + '\')">Remove</button>' +
        '</div>';
      }).join('');
      body(
        '<p class="ad-note">Every verified candidate in <b>' + esc(r.session.label) + '</b>. Email addresses are shown masked here; ' +
        'the export below is the one deliberate way to obtain them, and the file is downloaded — never displayed.</p>' +
        '<div class="ad-field"><label>Search</label><input id="f27PartQ" placeholder="ID, name or course" oninput="f27AdmSearchParticipants()"></div>' +
        '<div class="ad-metric"><span>Participants</span><b>' + A.participants.length + '</b></div>' +
        '<div id="f27PartList">' + (rows || '<div class="ad-empty">Nobody has registered for this session yet.</div>') + '</div>' +
        '<div class="ad-actions"><button class="ad-btn" onclick="f27AdmSearchParticipants()">Refresh</button>' +
        '<button class="ad-btn" onclick="f27AdmExportParticipants()">Download CSV</button></div>'
      );
    }, function (er) { body(failText(er)); });
  }

  function paintParticipants(list) {
    var host = $('f27PartList');
    if (!host) return;
    host.innerHTML = list.length ? list.map(function (p) {
      return '<div class="f27-admin-row"><div><b>' + esc(p.name) + ' <span class="f27-chip ' + (p.verified ? 'ok' : 'warn') + '">' +
        (p.verified ? 'verified' : 'unverified') + '</span>' + (p.active === false ? ' <span class="f27-chip no">off</span>' : '') + '</b>' +
        '<span>' + esc(p.id) + ' · ' + esc(p.course) + ' · ' + esc(p.email) +
        (p.lessonsTotal ? ' · lessons ' + Number(p.lessonsDone || 0) + '/' + Number(p.lessonsTotal) : '') + '</span></div>' +
        '<button class="ad-btn" onclick="f27AdmToggleParticipant(\'' + esc(p.id) + '\',' + (p.active === false) + ')">' +
        (p.active === false ? 'Switch on' : 'Switch off') + '</button>' +
        '<button class="ad-btn danger" onclick="f27AdmRemoveParticipant(\'' + esc(p.id) + '\')">Remove</button></div>';
    }).join('') : '<div class="ad-empty">Nobody matched that search.</div>';
  }

  global.f27AdmSearchParticipants = function () {
    var q = String(($('f27PartQ') || {}).value || '').trim().toLowerCase();
    var list = !q ? A.participants : A.participants.filter(function (p) {
      return (String(p.id) + ' ' + String(p.name) + ' ' + String(p.course)).toLowerCase().indexOf(q) > -1;
    });
    paintParticipants(list);
  };

  global.f27AdmToggleParticipant = function (id, makeActive) {
    if (!confirmDo((makeActive ? 'Switch this address back on?' : 'Switch this address off? They will not be able to sit anything until it is switched back on.'))) return;
    api.setParticipantActive(id, !!makeActive).then(function () {
      say(makeActive ? 'Switched back on' : 'Switched off');
      loadParticipants();
    }, function (er) { say(er.message || 'Could not change that record.'); });
  };

  global.f27AdmRemoveParticipant = function (id) {
    if (!confirmDo('Remove ' + id + ' and every attempt they submitted in this session?\n\nThis cannot be undone. Starting a new session archives the whole session first if you would rather keep it.')) return;
    api.removeParticipant(id).then(function () {
      say('Removed');
      loadParticipants();
    }, function (er) { say(er.message || 'Could not remove that record.'); });
  };

  global.f27AdmExportParticipants = function () {
    /* A file, not a page: the console never renders a full address. */
    var a = document.createElement('a');
    a.href = api.participantsCsvUrl();
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    say('Preparing the participant list — the download needs your signed-in session, so it is fetched by the browser.');
  };

  /* ======================================================== 3. ACTIVITIES */

  function loadActivities() {
    loading('Reading the activities…');
    api.adminActivities().then(function (r) {
      A.activities = r.activities || [];
      if (A.editing) return paintEditor();
      return api.adminLessons().then(function (lr) {
        A.lessons = (lr && lr.lessons) || [];
        body(activityListHtml() + '<div id="f27Editor"></div>' + lessonsHtml());
      }, function () {
        /* A lessons fault must not hide the activities. */
        A.lessons = [];
        body(activityListHtml() + '<div id="f27Editor"></div>' + lessonsHtml());
      });
    }, function (er) { body(failText(er)); });
  }

  /* ---- programme lessons: the candidate marks them done in the portal ------ */
  function lessonsHtml() {
    var rows = (A.lessons || []).map(function (l) {
      return '<div class="f27-admin-row"><div><b>' + esc(l.title) + '</b>' +
        '<span>' + esc(l.subject || 'General') + ' · #' + esc(l.id) + (l.active === false ? ' · hidden' : '') + '</span>' +
        (l.summary ? '<span>' + esc(l.summary) + '</span>' : '') + '</div>' +
        '<button class="ad-btn danger" onclick="f27AdmDeleteLesson(\'' + esc(l.id) + '\')">Remove</button></div>';
    }).join('');
    return '<div class="ad-card" style="margin-top:18px"><div class="ad-h">Programme lessons</div>' +
      '<p class="ad-note">Lessons the candidate can tick off in the CBT Portal. They belong to this session and are ' +
      'archived with it; deleting one never rewrites a candidate\'s own completion record.</p>' +
      '<div class="f27-admin-row"><div class="ad-field" style="flex:1"><label>Title</label><input id="f27LessonTitle" placeholder="e.g. Cell biology — the basics"></div>' +
      '<div class="ad-field" style="flex:1"><label>Subject</label><input id="f27LessonSubject" placeholder="Biology"></div></div>' +
      '<div class="ad-field"><label>One-line summary (optional)</label><input id="f27LessonSummary" placeholder="What this lesson covers"></div>' +
      '<div class="ad-actions"><button class="ad-btn pri" onclick="f27AdmAddLesson()">Add lesson</button></div>' +
      '<div>' + (rows || '<div class="ad-empty">No lessons yet. Add the first one above.</div>') + '</div></div>';
  }

  global.f27AdmAddLesson = function () {
    var title = String(($('f27LessonTitle') || {}).value || '').trim();
    var subject = String(($('f27LessonSubject') || {}).value || '').trim();
    var summary = String(($('f27LessonSummary') || {}).value || '').trim();
    if (title.length < 3) return say('Give the lesson a title of at least 3 characters.');
    api.saveLesson({ title: title, subject: subject, summary: summary }).then(function () {
      say('Lesson added');
      loadActivities();
    }, function (er) { say(er.message || 'That lesson could not be saved.'); });
  };

  global.f27AdmDeleteLesson = function (id) {
    if (!confirmDo('Remove lesson ' + id + ' from the catalogue?\n\nCandidates keep their own completion marks.')) return;
    api.deleteLesson(id).then(function () {
      say('Lesson removed');
      loadActivities();
    }, function (er) { say(er.message || 'That lesson could not be removed.'); });
  };

  function activityListHtml() {
    var rows = A.activities.map(function (a) {
      var lb = a.kind === rules.KIND_COMPETITION
        ? '<span class="f27-chip ' + (a.leaderboard.published ? 'ok' : a.leaderboard.approved ? 'warn' : '') + '">' +
            (a.leaderboard.published ? 'board published' : a.leaderboard.approved ? 'board approved' : 'board private') + '</span>'
        : '<span class="f27-chip">private results</span>';
      var actions = '';
      if (a.published && a.status === rules.STATUS_PUBLISHED) {
        actions += '<button class="ad-btn" onclick="f27AdmActivityState(\'' + esc(a.id) + '\',\'close\')">Close</button>';
        actions += '<button class="ad-btn" onclick="f27AdmReopen(\'' + esc(a.id) + '\')">Reopen for latecomers</button>';
      } else {
        actions += '<button class="ad-btn pri" onclick="f27AdmActivityState(\'' + esc(a.id) + '\',\'publish\')">Publish</button>';
      }
      actions += '<button class="ad-btn" onclick="f27AdmEdit(\'' + esc(a.id) + '\')">Edit</button>';
      actions += '<button class="ad-btn" onclick="f27AdmResults(\'' + esc(a.id) + '\')">Results</button>';
      actions += '<button class="ad-btn danger" onclick="f27AdmDeleteActivity(\'' + esc(a.id) + '\')">Delete</button>';
      return '<div class="ad-card" style="margin-bottom:10px">' +
        '<div class="f27-admin-row" style="border-bottom:none">' +
          '<div><b>' + esc(a.title) + ' <span class="f27-chip ' + (a.state === 'open' ? 'ok' : a.state === 'upcoming' ? 'warn' : '') + '">' + esc(rules.stateLabel(a.state)) + '</span> ' + lb + '</b>' +
          '<span>' + esc(rules.kindLabel(a.kind)) + ' · ' + a.questionCount + ' questions · ' + a.durationMin + ' min · up to ' + a.maxAttempts + ' attempt' + (a.maxAttempts === 1 ? '' : 's') + '</span>' +
          '<span>opens ' + esc(when(a.opensAt)) + ' · closes ' + esc(when(a.closesAt)) + (a.reopenClosesAt ? ' (reopened to ' + esc(when(a.reopenClosesAt)) + ')' : '') + '</span>' +
          '<span>' + a.attempts + ' submitted · ' + (a.status === rules.STATUS_DRAFT ? 'not published yet' : a.status) + '</span></div>' +
        '</div><div class="ad-actions">' + actions + '</div></div>';
    }).join('');
    return '<div class="ad-actions" style="margin-bottom:12px"><button class="ad-btn pri" onclick="f27AdmNewActivity()">Create Activity</button>' +
      '<button class="ad-btn" onclick="f27AdmLoad()">Refresh</button></div>' +
      (rows || '<div class="ad-empty">No activity has been created for this session yet.</div>');
  }

  function ensureActivityEditorHost() {
    var host = $('f27Editor');
    if (!host) {
      body(activityListHtml() + '<div id="f27Editor"></div>' + lessonsHtml());
      host = $('f27Editor');
    }
    return host;
  }

  function activityCategoryChooserHtml() {
    return '<div class="ad-card f27-activity-chooser"><div class="ad-h">Create Activity — choose a category</div>' +
      '<p class="ad-note">The category chooses the Question Bank automatically. Administrators do not select individual questions.</p>' +
      '<div class="f27-activity-category-grid">' +
        '<button type="button" class="ad-card f27-activity-category" onclick="f27AdmStartActivity(\'weekly\')">' +
          '<b>WEEKLY ASSESSMENT</b><span>Allocates automatically from the Weekly Assessment Question Bank.</span></button>' +
        '<button type="button" class="ad-card f27-activity-category" onclick="f27AdmStartActivity(\'competition\')">' +
          '<b>COMPETITION</b><span>Allocates automatically from the Competition Question Bank.</span></button>' +
      '</div></div>';
  }

  global.f27AdmNewActivity = function () {
    A.editing = null;
    var host = ensureActivityEditorHost();
    if (host) host.innerHTML = activityCategoryChooserHtml();
  };

  global.f27AdmStartActivity = function (kind) {
    kind = rules.cleanKind(kind);
    if (!kind) return;
    A.editing = {
      id: null, kind: kind, title: '', instructions: '',
      opensAt: Date.now(), closesAt: Date.now() + 7 * 86400000,
      durationMin: 20, maxAttempts: 1,
      questionCount: 20, subjectDistribution: null,
      randomizeQuestions: true, randomizeOptions: false,
      status: rules.STATUS_DRAFT
    };
    paintEditor();
  };

  global.f27AdmEdit = function (id) {
    if (!id) { global.f27AdmNewActivity(); return; }
    var a = A.activities.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    A.editing = JSON.parse(JSON.stringify(a));
    A.editing.questionCount = Number(a.questionCount || (a.questionIds || []).length || 0);
    A.editing.subjectDistribution = a.subjectDistribution || null;
    A.editing.randomizeQuestions = a.randomizeQuestions !== false;
    A.editing.randomizeOptions = !!a.randomizeOptions;
    paintEditor();
  };

  function distributionInputsHtml(a) {
    var dist = a.subjectDistribution || {};
    return '<div class="ad-grid2 two f27-distribution-grid">' + BANK_SUBJECTS.map(function (subject, i) {
      var avail = A.availability && A.availability.bySubject ? (A.availability.bySubject[subject] || 0) : null;
      return '<div class="ad-field"><label for="f27Dist-' + i + '">' + esc(subject) + '</label>' +
        '<input id="f27Dist-' + i + '" data-subject="' + esc(subject) + '" type="number" min="0" step="1" ' +
        'value="' + (dist[subject] ? Number(dist[subject]) : '') + '" placeholder="' + (avail === null ? '0' : '0 of ' + avail) + '"></div>';
    }).join('') + '</div>';
  }

  function paintEditor() {
    var a = A.editing;
    if (!a) return;
    var host = ensureActivityEditorHost();
    if (!host) return;
    var bank = a.kind === rules.KIND_COMPETITION ? 'competition' : 'weekly';
    var bankLabel = bank === 'competition' ? 'Competition Question Bank' : 'Weekly Assessment Question Bank';
    host.innerHTML = '<div class="ad-card f27-activity-editor"><div class="ad-h">' + (a.id ? 'Edit activity' : 'Create Activity') + '</div>' +
      '<div class="ad-grid2 two">' +
        '<div class="ad-field"><label for="f27Kind">Category</label><select id="f27Kind" onchange="f27AdmEditorRead(); f27AdmLoadAvailability()">' +
          rules.KINDS.map(function (k) {
            return '<option value="' + k + '"' + (a.kind === k ? ' selected' : '') + '>' + esc(rules.KIND_LABELS[k]) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="ad-field"><label for="f27Title">Title</label><input id="f27Title" value="' + esc(a.title) + '" placeholder="e.g. Week 3 — Mechanics"></div>' +
      '</div>' +
      '<p class="ad-note">Questions are retrieved automatically from the <b>' + bankLabel + '</b>. There is no individual question picker.</p>' +
      '<div id="f27Availability" class="f27-availability"><div class="ad-loading">Checking available eligible questions…</div></div>' +
      '<div class="ad-field"><label for="f27Count">Number of questions</label>' +
        '<input id="f27Count" type="number" min="1" max="' + rules.MAX_QUESTIONS + '" step="1" value="' + Number(a.questionCount || 0) + '" onchange="f27AdmEditorRead()">' +
        '<p class="ad-note">Cannot exceed the available eligible questions in this category’s bank.</p></div>' +
      '<div class="ad-field"><label>Optional subject distribution</label>' +
        '<p class="ad-note">Leave every box blank to draw from all eligible questions. If used, the counts must add up to the number of questions.</p>' +
        distributionInputsHtml(a) + '</div>' +
      '<div class="ad-grid2 two">' +
        '<label class="f27-question-active"><input id="f27RandQ" type="checkbox"' + (a.randomizeQuestions !== false ? ' checked' : '') + ' onchange="f27AdmEditorRead()"> Randomise question order</label>' +
        '<label class="f27-question-active"><input id="f27RandO" type="checkbox"' + (a.randomizeOptions ? ' checked' : '') + ' onchange="f27AdmEditorRead()"> Randomise option order per attempt</label>' +
      '</div>' +
      '<div class="ad-field"><label for="f27Instr">Instructions (optional)</label><textarea id="f27Instr" rows="2">' + esc(a.instructions || '') + '</textarea></div>' +
      '<div class="ad-grid2 two">' +
        '<div class="ad-field"><label for="f27Opens">Opens</label><input id="f27Opens" type="datetime-local" value="' + esc(toLocalInput(a.opensAt)) + '"></div>' +
        '<div class="ad-field"><label for="f27Closes">Closes</label><input id="f27Closes" type="datetime-local" value="' + esc(toLocalInput(a.closesAt)) + '"></div>' +
        '<div class="ad-field"><label for="f27Dur">Duration (minutes)</label><input id="f27Dur" type="number" min="' + rules.MIN_DURATION_MIN + '" max="' + rules.MAX_DURATION_MIN + '" value="' + Number(a.durationMin) + '"></div>' +
        '<div class="ad-field"><label for="f27Max">Maximum attempts</label><input id="f27Max" type="number" min="' + rules.MIN_ATTEMPTS + '" max="' + rules.MAX_ATTEMPTS + '" value="' + Number(a.maxAttempts) + '"></div>' +
        '<div class="ad-field"><label for="f27Status">Publication status</label><select id="f27Status">' +
          '<option value="draft"' + (a.status !== rules.STATUS_PUBLISHED ? ' selected' : '') + '>Draft</option>' +
          '<option value="published"' + (a.status === rules.STATUS_PUBLISHED ? ' selected' : '') + '>Published</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="ad-actions"><button class="ad-btn pri" id="f27SaveBtn" onclick="f27AdmSaveActivity(this)">Save activity</button>' +
      '<button class="ad-btn" onclick="f27AdmCancelEdit()">Cancel</button></div>' +
      '<p class="ad-note">The server allocates and persists the question assignment. Publishing checks the window, duration, attempt limit and bank-bound assignment again.</p></div>';
    global.f27AdmLoadAvailability();
  }

  global.f27AdmLoadAvailability = function () {
    var a = A.editing;
    var host = $('f27Availability');
    if (!a || !host) return;
    var bank = a.kind === rules.KIND_COMPETITION ? 'competition' : 'weekly';
    host.innerHTML = '<div class="ad-loading">Checking available eligible questions…</div>';
    api.adminBanks().then(function (r) {
      var b = (r.banks || {})[bank] || {};
      A.availability = { bank: bank, total: Number(b.eligibleCount || 0), bySubject: b.eligibleBySubject || {} };
      var count = $('f27Count');
      if (count) count.max = String(Math.min(rules.MAX_QUESTIONS, A.availability.total || rules.MAX_QUESTIONS));
      host.innerHTML = '<div class="ad-metric"><span>Available eligible questions</span><b>' + A.availability.total + '</b></div>' +
        '<p class="ad-note">' + BANK_SUBJECTS.map(function (s) { return esc(s) + ': ' + Number(A.availability.bySubject[s] || 0); }).join(' · ') + '</p>';
      var grid = document.querySelector('.f27-distribution-grid');
      if (grid && grid.parentNode) {
        var wrap = document.createElement('div');
        wrap.innerHTML = distributionInputsHtml(a);
        grid.parentNode.replaceChild(wrap.firstChild, grid);
      }
    }, function (er) {
      A.availability = null;
      host.innerHTML = failText(er);
    });
  };

  global.f27AdmEditorRead = function () {
    var a = A.editing;
    if (!a) return;
    a.kind = rules.cleanKind(($('f27Kind') || {}).value) || a.kind;
    a.title = ($('f27Title') || {}).value || '';
    a.instructions = ($('f27Instr') || {}).value || '';
    a.opensAt = fromLocalInput(($('f27Opens') || {}).value) || a.opensAt;
    a.closesAt = fromLocalInput(($('f27Closes') || {}).value) || a.closesAt;
    a.durationMin = Number(($('f27Dur') || {}).value) || a.durationMin;
    a.maxAttempts = Number(($('f27Max') || {}).value) || a.maxAttempts;
    a.questionCount = Number(($('f27Count') || {}).value) || 0;
    a.randomizeQuestions = !!($('f27RandQ') || {}).checked;
    a.randomizeOptions = !!($('f27RandO') || {}).checked;
    a.status = (($('f27Status') || {}).value === rules.STATUS_PUBLISHED) ? rules.STATUS_PUBLISHED : rules.STATUS_DRAFT;
    var dist = {}, any = false;
    BANK_SUBJECTS.forEach(function (subject, i) {
      var el = $('f27Dist-' + i);
      var raw = el ? String(el.value || '').trim() : '';
      if (raw === '') return;
      var n = Number(raw);
      if (!isFinite(n) || n < 0) return;
      n = Math.round(n);
      if (n > 0) { dist[subject] = n; any = true; }
    });
    a.subjectDistribution = any ? dist : null;
  };

  global.f27AdmCancelEdit = function () {
    A.editing = null;
    loadActivities();
  };

  global.f27AdmSaveActivity = function (btn) {
    global.f27AdmEditorRead();
    var a = A.editing;
    if (!a) return;
    var count = Number(a.questionCount);
    if (!isFinite(count) || count < 1 || count > rules.MAX_QUESTIONS) {
      say('Set how many questions to include, between 1 and ' + rules.MAX_QUESTIONS + '.');
      return;
    }
    if (A.availability && count > A.availability.total) {
      say('Only ' + A.availability.total + ' eligible questions are available in this category’s bank.');
      return;
    }
    if (a.subjectDistribution) {
      var sum = 0;
      Object.keys(a.subjectDistribution).forEach(function (k) { sum += Number(a.subjectDistribution[k]) || 0; });
      if (sum !== count) { say('Subject distribution must add up to the requested number of questions (' + count + ').'); return; }
      if (A.availability) {
        var bad = Object.keys(a.subjectDistribution).filter(function (k) { return Number(a.subjectDistribution[k]) > Number(A.availability.bySubject[k] || 0); });
        if (bad.length) { say('Not enough eligible ' + bad[0] + ' questions in this category’s bank.'); return; }
      }
    }
    var payload = {
      kind: a.kind, title: a.title, instructions: a.instructions,
      opensAt: a.opensAt, closesAt: a.closesAt,
      durationMin: a.durationMin, maxAttempts: a.maxAttempts,
      questionCount: count, subjectDistribution: a.subjectDistribution,
      randomizeQuestions: a.randomizeQuestions, randomizeOptions: a.randomizeOptions,
      status: a.status
    };
    busy(btn, true);
    api.saveActivity(payload, a.id).then(function () {
      busy(btn, false);
      say(a.status === rules.STATUS_PUBLISHED ? 'Saved and published' : 'Saved');
      A.editing = null;
      loadActivities();
    }, function (er) {
      busy(btn, false);
      say(er.message || 'That activity could not be saved.');
    });
  };

  global.f27AdmActivityState = function (id, action) {
    if (action === 'publish' && !confirmDo('Publish this activity? Candidates can sit it from its opening time.')) return;
    if (action === 'close' && !confirmDo('Close this activity now? Anyone still sitting will not be able to submit after the current paper.')) return;
    api.activityState(id, action, {}).then(function () {
      say(action === 'publish' ? 'Published' : 'Closed');
      loadActivities();
    }, function (er) { say(er.message || 'That did not work.'); });
  };

  global.f27AdmReopen = function (id) {
    var a = A.activities.filter(function (x) { return x.id === id; })[0];
    /* Reopening is the only way a latecomer gets in, and it needs a closing
       time. Ask for one, plainly. */
    var suggestion = toLocalInput(Math.max(Date.now() + 86400000, (a && a.closesAt) || 0));
    var answer = typeof global.prompt === 'function'
      ? global.prompt('Reopen "' + ((a && a.title) || id) + '" for latecomers.\nNew closing date and time (YYYY-MM-DDTHH:MM):', suggestion)
      : suggestion;
    if (answer == null) return;
    var closes = fromLocalInput(answer);
    if (closes == null) { say('That is not a valid date and time.'); return; }
    if (!confirmDo('Reopen this activity until ' + when(closes) + '?')) return;
    api.activityState(id, 'reopen', { closesAt: closes }).then(function () {
      say('Reopened');
      loadActivities();
    }, function (er) { say(er.message || 'That activity could not be reopened.'); });
  };

  global.f27AdmDeleteActivity = function (id) {
    if (!confirmDo('Delete this activity and every attempt submitted for it in this session?\n\nStarting a new session archives the whole session first if you would rather keep it.')) return;
    api.deleteActivity(id).then(function () {
      say('Deleted');
      loadActivities();
    }, function (er) { say(er.message || 'That activity could not be deleted.'); });
  };

  /* =========================================================== 4. RESULTS */

  function loadResults() {
    var published = A.activities.filter(function (a) { return a.attempts > 0; });
    if (!published.length) {
      return api.adminActivities().then(function (r) {
        A.activities = r.activities || [];
        var withAttempts = A.activities.filter(function (a) { return a.attempts > 0; });
        body('<p class="ad-note">Results appear here once papers have been submitted. Weekly assessment results are private: ' +
          'they are shown to the candidate who sat them and to you, and never on a public page.</p>' +
          (withAttempts.length
            ? withAttempts.map(function (a) {
                return '<div class="f27-admin-row"><div><b>' + esc(a.title) + '</b><span>' + esc(rules.kindLabel(a.kind)) +
                  ' · ' + a.attempts + ' submitted</span></div>' +
                  '<button class="ad-btn pri" onclick="f27AdmResults(\'' + esc(a.id) + '\')">Open results</button></div>';
              }).join('')
            : '<div class="ad-empty">No paper has been submitted in this session yet.</div>'));
      }, function (er) { body(failText(er)); });
    }
    global.f27AdmResults(published[0].id);
  }

  global.f27AdmResults = function (id) {
    A.tab = 'results';
    var tabs = document.querySelectorAll('#f27AdmTabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-f27adm') === 'results');
    loading('Reading the results…');
    api.activityResults(id).then(function (r) {
      A.currentResults = r;
      var a = r.activity;
      var rows = (r.rows || []).map(function (x) {
        return '<div class="f27-admin-row"><div><b>' + esc(x.name) + ' <span class="f27-chip">' + esc(x.participantId) + '</span>' +
          (x.autoSubmitted ? ' <span class="f27-chip warn">time ran out</span>' : '') + '</b>' +
          '<span>' + esc(x.course) + ' · ' + x.score + '/' + x.maxScore + ' · ' + clock(x.timeUsedSec) + ' · submitted ' + esc(when(x.submittedAt)) + '</span></div>' +
          '<span class="f27-chip ' + (x.rank && x.rank <= rules.PUBLIC_TOP_N ? 'ok' : '') + '">' + (x.rank ? '#' + x.rank : '—') + '</span>' +
          '<button class="ad-btn" onclick="f27AdmAttempt(\'' + esc(x.attemptId) + '\')">Paper</button></div>';
      }).join('');
      var lb = a.kind === rules.KIND_COMPETITION
        ? '<div class="ad-actions">' +
            '<button class="ad-btn' + (a.leaderboard && a.leaderboard.approved ? '' : ' pri') + '" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'approve\')">Approve board</button>' +
            '<button class="ad-btn' + (a.leaderboard && a.leaderboard.approved && !a.leaderboard.published ? ' pri' : '') + '" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'publish\')">Publish board</button>' +
            '<button class="ad-btn" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'unpublish\')">Unpublish</button>' +
          '</div>' +
          '<p class="ad-note">Public now: <b>' + (a.publicNow ? 'yes — the top ' + rules.PUBLIC_TOP_N + ' are visible to everyone' : 'no') + '</b>. ' +
          'Unpublishing hides it again at once; nothing is deleted.</p>'
        : '<p class="ad-note">A weekly assessment has no public board. These results are private.</p>';
      body('<div class="ad-actions" style="margin-bottom:10px"><button class="ad-btn" onclick="f27AdmTab(\'results\')">← All results</button></div>' +
        '<div class="ad-metric"><span>Activity</span><b>' + esc(a.title) + '</b></div>' +
        '<div class="ad-metric"><span>Kind</span><b>' + esc(rules.kindLabel(a.kind)) + '</b></div>' +
        '<div class="ad-metric"><span>Submitted papers</span><b>' + (r.rows || []).length + '</b></div>' +
        lb +
        '<div>' + (rows || '<div class="ad-empty">No paper has been submitted for this activity yet.</div>') + '</div>');
    }, function (er) { body(failText(er)); });
  };

  global.f27AdmAttempt = function (id) {
    api.attemptDetail(id).then(function (r) {
      var a = r.attempt;
      var answers = Object.keys(a.responses || {}).map(function (q) {
        return '<div class="ad-metric"><span>Question ' + esc(q) + '</span><b>' + esc(String(a.responses[q])) + '</b></div>';
      }).join('');
      body('<div class="ad-actions" style="margin-bottom:10px"><button class="ad-btn" onclick="f27AdmResults(\'' + esc(a.activityId) + '\')">← Back to results</button></div>' +
        '<div class="ad-metric"><span>Participant</span><b>' + esc(r.participant.name) + ' (' + esc(r.participant.id) + ')</b></div>' +
        '<div class="ad-metric"><span>Activity</span><b>' + esc(r.activity ? r.activity.title : a.activityId) + '</b></div>' +
        '<div class="ad-metric"><span>Score</span><b>' + a.score + ' / ' + a.maxScore + '</b></div>' +
        '<div class="ad-metric"><span>Time used</span><b>' + clock(a.timeUsedSec) + '</b></div>' +
        '<div class="ad-metric"><span>Submitted</span><b>' + esc(when(a.submittedAt)) + '</b></div>' +
        '<div class="ad-metric"><span>' + (a.submittedAt ? 'Auto-submitted' : 'State') + '</span><b>' + (a.submittedAt ? (a.autoSubmitted ? 'yes (clock ran out)' : 'no') : 'open — not submitted') + '</b></div>' +
        '<p class="ad-note">Answers are stored as option positions, exactly as the marking engine reads them.</p>' + answers);
    }, function (er) { say(er.message || 'That paper could not be read.'); });
  };

  /* ======================================================= 5. LEADERBOARDS */

  function loadLeaderboards() {
    loading('Reading the competitions…');
    api.adminActivities().then(function (r) {
      A.activities = r.activities || [];
      var comps = A.activities.filter(function (a) { return a.kind === rules.KIND_COMPETITION; });
      if (!comps.length) {
        body('<div class="ad-empty">No competition has been created for this session yet.</div>');
        return;
      }
      body('<p class="ad-note">Only a competition has a leaderboard. A board becomes public when you <b>approve</b> it and then ' +
        '<b>publish</b> it; the public page shows the top ' + rules.PUBLIC_TOP_N + ' only, ranked on the highest score and then the shortest ' +
        'completion time. Everyone else sees their own position privately. A board is never kept public by itself — unpublish it when the ' +
        'competition is over, or leave it unpublished and it stays private.</p>' +
        comps.map(function (a) {
          var state = a.leaderboard.published ? '<span class="f27-chip ok">public</span>'
            : a.leaderboard.approved ? '<span class="f27-chip warn">approved, not published</span>'
            : '<span class="f27-chip">private</span>';
          return '<div class="ad-card" style="margin-bottom:10px"><div class="f27-admin-row" style="border-bottom:none">' +
            '<div><b>' + esc(a.title) + ' ' + state + '</b>' +
            '<span>' + a.competitors + ' competitor' + (a.competitors === 1 ? '' : 's') + ' · ' + a.attempts + ' submitted · ' +
            esc(rules.stateLabel(a.state)) + '</span>' +
            '<span>approved ' + esc(a.leaderboard.approvedAt ? when(a.leaderboard.approvedAt) : '—') + ' · published ' +
            esc(a.leaderboard.publishedAt ? when(a.leaderboard.publishedAt) : '—') + '</span></div></div>' +
            '<div class="ad-actions">' +
            '<button class="ad-btn" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'approve\')">Approve</button>' +
            '<button class="ad-btn pri" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'publish\')">Publish</button>' +
            '<button class="ad-btn" onclick="f27AdmLb(\'' + esc(a.id) + '\',\'unpublish\')">Unpublish</button>' +
            '<button class="ad-btn" onclick="f27AdmResults(\'' + esc(a.id) + '\')">See the ranking</button>' +
            '</div></div>';
        }).join(''));
    }, function (er) { body(failText(er)); });
  }

  global.f27AdmLb = function (id, action) {
    var words = { approve: 'Approve this leaderboard? It stays private until you publish it.',
      publish: 'Publish this leaderboard? The top ' + rules.PUBLIC_TOP_N + ' become visible to everyone.',
      unpublish: 'Unpublish this leaderboard? It disappears from the public site at once.',
      revoke: 'Withdraw the approval as well as the publication?' };
    if (!confirmDo(words[action] || 'Continue?')) return;
    api.leaderboardAction(id, action).then(function (r) {
      say(action === 'approve' ? 'Approved' : action === 'publish' ? 'Published' : 'Unpublished');
      if (A.tab === 'leaderboards') loadLeaderboards();
      else if (A.currentResults) global.f27AdmResults(A.currentResults.activity.id);
      else loadActivities();
    }, function (er) { say(er.message || 'That did not work.'); });
  };

  /* ==================================================== 6. SESSION RECORDS */

  function loadRecords() {
    loading('Reading the session records…');
    api.records().then(function (r) {
      var auditRows = '';
      api.adminAudit().then(function (a) {
        auditRows = ((a && a.entries) || []).map(function (x) {
          return '<div class="f27-admin-row"><div><b>' + esc(x.action) + (x.target ? ' · ' + esc(x.target) : '') + '</b>' +
            '<span>' + esc(x.actorId) + (x.actorRole ? ' (' + esc(x.actorRole) + ')' : '') + '</span></div>' +
            '<span class="f27-chip">' + esc(when(x.at)) + '</span></div>';
        }).join('');
        var host = $('f27AuditList');
        if (host) host.innerHTML = auditRows || '<div class="ad-empty">No administrative changes in this session yet.</div>';
      }, function () { /* the audit is supplementary: never hide the records */ });
      var rows = (r.records || []).map(function (x) {
        return '<div class="f27-admin-row"><div><b>' + esc(x.name || x.participantId) + '</b>' +
          '<span>' + esc(x.participantId) + ' · ' + esc(x.kind) + (x.activityId ? ' · ' + esc(x.activityId) : '') + '</span></div>' +
          '<span class="f27-chip">' + esc(when(x.at)) + '</span></div>';
      }).join('');
      body('<p class="ad-note">Who registered, verified, opened a paper and submitted it, newest first. ' +
        'These are the free tutorial\'s own records — no G.O.C student record appears here.</p>' +
        '<div class="ad-metric"><span>Session</span><b>' + esc(r.session.label) + ' (' + esc(r.session.id) + ')</b></div>' +
        '<div>' + (rows || '<div class="ad-empty">Nothing has happened in this session yet.</div>') + '</div>' +
        '<div class="ad-card" style="margin-top:18px"><div class="ad-h">Programme audit records</div>' +
        '<p class="ad-note">Who changed what in the programme — the administrator and the action only. ' +
        'No address and no secret is ever written here.</p>' +
        '<div id="f27AuditList"><div class="ad-loading">Reading the audit trail…</div></div></div>' +
        '<div class="ad-actions"><button class="ad-btn" onclick="f27AdmLoad()">Refresh</button></div>');
    }, function (er) { body(failText(er)); });
  }

  /* ================================================ 7. SESSIONS & ARCHIVE */

  function loadSessions() {
    if (!isFounder()) { body('<p class="ad-warn">Only the Founder can access programme session archives.</p>'); return; }
    loading('Reading this session and the archives…');
    api.adminOverview().then(function (o) {
      A.overview = o;
      return api.archives().then(function (ar) {
        var rows = (ar.archives || []).map(function (x) {
          return '<div class="f27-admin-row"><div><b>' + esc(x.label) + (x.missing ? ' <span class="f27-chip no">file missing</span>' : '') + '</b>' +
            '<span>' + esc(x.file) + '</span>' +
            '<span>archived ' + esc(when(Number(x.archivedAt) || 0)) + ' · ' + (x.counts && x.counts.participants != null ? x.counts.participants + ' participants, ' + x.counts.activities + ' activities, ' + x.counts.submissions + ' submissions' : 'index entry only') +
            ' · ' + Math.round((x.bytes || 0) / 1024) + ' KB</span></div>' +
            '<button class="ad-btn" onclick="f27AdmReadArchive(\'' + esc(x.file) + '\')">Open</button></div>';
        }).join('');
        body('<div class="ad-metric"><span>Current session</span><b>' + esc(o.session.label) + ' (' + esc(o.session.id) + ')</b></div>' +
          '<div class="ad-metric"><span>Started</span><b>' + esc(when(o.session.startedAt)) + '</b></div>' +
          '<div class="ad-metric"><span>In this session</span><b>' + o.session.participants + ' participants · ' + o.session.activities + ' activities · ' + o.session.submitted + ' submitted papers</b></div>' +
          '<p class="ad-note">Starting a new session archives <b>this</b> session — its participants, assessments, attempts, results and competition ' +
          'rankings — to a local JSON file, then starts again with fresh programme records. The archive is readable by an administrator only. ' +
          'No G.O.C student record, original question or core setting is touched, and the archiving cannot be undone from here.</p>' +
          '<div class="ad-field"><label>Name for the new session</label><input id="f27NewLabel" placeholder="e.g. 2027 Free Tutorial — Term 2"></div>' +
          '<div class="ad-actions"><button class="ad-btn danger" onclick="f27AdmNewSession(this)">Archive this session and start a new one</button></div>' +
          '<div class="ad-h" style="margin-top:18px">Archived sessions</div>' +
          '<p class="ad-note">Files live in <code>free2027-archives/</code> beside the data file (under <code>GOC_DATA_DIR</code> when it is set), ' +
          'so they survive a redeploy exactly when the data file does. A host with temporary storage loses both together — keep ' +
          '<code>GOC_DATA_DIR</code> on a persistent volume.</p>' +
          '<div>' + (rows || '<div class="ad-empty">No session has been archived yet.</div>') + '</div>' +
          '<div id="f27ArchiveView"></div>');
      });
    }, function (er) { body(failText(er)); });
  }

  global.f27AdmNewSession = function (btn) {
    if (!isFounder()) { say('Only the Founder can archive programme sessions.'); return; }
    var label = String(($('f27NewLabel') || {}).value || '').trim();
    /* Two confirmations: one states what is archived, the second is the
       server's own acknowledgement, which the request carries. */
    if (!confirmDo('Archive the current session and start a new one?\n\nThis archives every participant, activity, attempt, result and ranking in ' +
      'the current session to a local JSON file, then starts empty. G.O.C student records are not touched.')) return;
    if (!confirmDo('Are you sure? Candidates registered now will need to register again for the new session.')) return;
    busy(btn, true);
    api.newSession(label, true).then(function (r) {
      busy(btn, false);
      say('Archived to ' + r.archive.file + ' — new session ' + r.session.id + ' started.');
      loadSessions();
    }, function (er) {
      busy(btn, false);
      say(er.message || 'The session could not be archived.');
    });
  };

  global.f27AdmReadArchive = function (file) {
    if (!isFounder()) { say('Only the Founder can read programme archives.'); return; }
    var host = $('f27ArchiveView');
    if (!host) return;
    host.innerHTML = '<div class="ad-loading">Opening the archive…</div>';
    api.archive(file).then(function (r) {
      var d = r.data || {};
      var s = d.session || {};
      var counts = d.counts || {};
      var ranked = (s.activities || []).filter(function (a) { return a.kind === rules.KIND_COMPETITION; });
      host.innerHTML = '<div class="ad-card"><div class="ad-h">' + esc(file) + '</div>' +
        '<div class="ad-metric"><span>Archived</span><b>' + esc(d.archivedAt || '—') + '</b></div>' +
        '<div class="ad-metric"><span>Session</span><b>' + esc(s.label || '—') + ' (' + esc(s.id || '—') + ')</b></div>' +
        '<div class="ad-metric"><span>Participants</span><b>' + (counts.participants || 0) + '</b></div>' +
        '<div class="ad-metric"><span>Activities</span><b>' + (counts.activities || 0) + '</b></div>' +
        '<div class="ad-metric"><span>Attempts</span><b>' + (counts.attempts || 0) + ' (' + (counts.submissions || 0) + ' submitted)</b></div>' +
        '<div class="ad-metric"><span>Competitions archived</span><b>' + ranked.length + '</b></div>' +
        '<p class="ad-note">The whole session is in this file, including every competition ranking as it stood when the session closed. ' +
        'It is read here and nowhere else.</p></div>';
    }, function (er) {
      host.innerHTML = failText(er);
    });
  };

  /* ============================================================ 7. QUESTION BANKS
     Two completely independent banks: Weekly Assessment Question Bank and
     Competition Question Bank. Each panel states its destination, shows its
     own count, search, subject filter, CSV import (with preview + report),
     manual add/edit, individual delete, bulk delete and delete-all. */
  var BANK_LABEL = { weekly: 'Weekly Assessment Question Bank', competition: 'Competition Question Bank' };
  var BANK_DESC = {
    weekly: 'Serves Weekly Assessments only. Import one mixed-subject CSV (all five subjects in one file) or add questions manually.',
    competition: 'Serves Competitions only. Completely separate from the Weekly bank — imports, edits and deletions here never touch Weekly questions.'
  };
  A.banks = { weekly: { q: '', subject: '', sel: {}, rows: [], count: 0 }, competition: { q: '', subject: '', sel: {}, rows: [], count: 0 } };

  function loadBanks(keepPanels) {
    if (!keepPanels) loading('Reading the question banks…');
    GOC.api.ready.then(function () { return api.adminBanks(); }).then(function (ov) {
      A.bankOverview = ov;
      if (!keepPanels || !$('f27Bank-weekly') || !$('f27Bank-competition')) body(banksHtml());
      ['weekly', 'competition'].forEach(function (b) {
        var bank = ov.banks[b], count = $(('f27BankCount-' + b));
        if (count) count.textContent = bank.count + ' question' + (bank.count === 1 ? '' : 's');
        var chips = $('f27BankSubjects-' + b);
        if (chips) chips.innerHTML = Object.keys(bank.bySubject || {}).map(function (s) {
          return '<span class="f27-chip">' + esc(s) + ' ' + esc(bank.bySubject[s]) + '</span>';
        }).join(' ');
        loadBankRows(b);
      });
    }, function (er) {
      /* A background refresh after a save/import/delete must not erase the
         report that just succeeded or an unsaved draft in the other panel. */
      if (keepPanels && $('f27Bank-weekly') && $('f27Bank-competition')) say((er && er.message) || 'The question banks could not be refreshed.', true);
      else body(failText(er));
    });
  }

  function banksHtml() {
    return '<div class="ad-actions" style="margin-bottom:12px"><button class="ad-btn" onclick="f27AdmLoad()">Refresh</button>' +
      '<p class="ad-note">Two independent banks: Weekly Assessment questions never serve Competitions, and vice versa. ' +
      'Deleting a question still used by an activity is refused by the server.</p></div>' +
      ['weekly', 'competition'].map(bankPanelHtml).join('');
  }

  function bankPanelHtml(bank) {
    var st = A.banks[bank];
    var ov = (A.bankOverview && A.bankOverview.banks && A.bankOverview.banks[bank]) || { count: 0, bySubject: {} };
    var subj = (A.bankOverview && A.bankOverview.subjects) || ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
    var subjChips = Object.keys(ov.bySubject || {}).map(function (s) {
      return '<span class="f27-chip">' + esc(s) + ' ' + ov.bySubject[s] + '</span>';
    }).join(' ');
    return '<div class="ad-card f27-bank-panel" style="margin-bottom:14px" id="f27Bank-' + bank + '">' +
      '<div class="ad-h">' + BANK_LABEL[bank] + ' <span class="f27-chip ok" id="f27BankCount-' + bank + '">' + ov.count + ' question' + (ov.count === 1 ? '' : 's') + '</span></div>' +
      '<p class="ad-note">' + esc(BANK_DESC[bank]) + '</p>' +
      '<p class="ad-note" id="f27BankSubjects-' + bank + '">' + subjChips + '</p>' +
      '<div class="ad-grid2 two">' +
        '<div class="ad-field"><label>Search</label><input id="f27Q-' + bank + '" value="' + esc(st.q) + '" placeholder="Search question text or topic" oninput="f27BankFilter(\'' + bank + '\')"></div>' +
        '<div class="ad-field"><label>Subject</label><select id="f27Subj-' + bank + '" onchange="f27BankFilter(\'' + bank + '\')">' +
          '<option value="">All five subjects</option>' +
          subj.map(function (s) { return '<option value="' + esc(s) + '"' + (st.subject === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="ad-actions" style="margin:10px 0">' +
        '<button class="ad-btn pri" onclick="f27BankAdd(\'' + bank + '\')">Add question</button>' +
        '<button class="ad-btn" onclick="document.getElementById(\'f27Csv-' + bank + '\').click()">Import CSV into THIS bank</button>' +
        '<input type="file" id="f27Csv-' + bank + '" accept=".csv,text/csv" style="display:none" onchange="f27BankCsvPicked(\'' + bank + '\',this)">' +
        '<button class="ad-btn danger" onclick="f27BankDeleteSel(\'' + bank + '\')">Delete selected</button>' +
        '<button class="ad-btn danger" onclick="f27BankDeleteAll(\'' + bank + '\')">Delete all ' + (bank === 'weekly' ? 'Weekly' : 'Competition') + ' questions</button>' +
      '</div>' +
      csvGuideHtml(bank) +
      '<div id="f27CsvBox-' + bank + '" class="f27-csv-result"></div>' +
      '<div id="f27BankList-' + bank + '"><div class="ad-loading">Loading…</div></div>' +
      '<div id="f27BankEdit-' + bank + '"></div>' +
    '</div>';
  }

  /* The guide is deliberately repeated, expanded and bank-local. The Free
     Tutorial CSV has no section/expected/maxMark columns; the destination is
     the selected bank panel, never inferred from the file. */
  var CSV_COLUMNS = [
    ['subject', 'Required. Use of English, Mathematics, Physics, Chemistry or Biology.'],
    ['topic', 'Topic name; blank defaults to General.'],
    ['text', 'Required question text. Quote cells containing commas, quotes or line breaks; double an embedded quote.'],
    ['optionA', 'Required option A.'],
    ['optionB', 'Required option B.'],
    ['optionC', 'Required option C.'],
    ['optionD', 'Required option D.'],
    ['optionE', 'Optional fifth option; leave blank for a four-option question.'],
    ['answer', 'Correct option letter: A, B, C, D or E. It must identify a filled option; E is invalid when optionE is blank.'],
    ['difficulty', 'Easy, Medium or Hard; blank defaults to Medium.'],
    ['explanation', 'Optional explanation of the answer.'],
    ['active', 'TRUE or FALSE; blank defaults to TRUE.'],
    ['year', 'Optional examination year; otherwise leave blank.'],
    ['passageId', 'Optional passage ID metadata; leave blank for a standalone question.']
  ];
  function bankCsvTemplate() {
    // All 14 cells are present, including the trailing optional cells. The
    // shared CSV cell writer handles quoting; the Free Tutorial parser reads it back.
    var row = ['Mathematics', 'Statistics',
      'Which of the following is a measure of central tendency?',
      'Range', 'Mean', 'Variance', 'Standard deviation', '', 'B',
      'medium', 'The mean is the sum of the values divided by their number.', 'TRUE', '', ''];
    return rules.CSV_HEADER + '\r\n' + row.map(GOC.core.csvCell).join(',') + '\r\n';
  }
  function csvGuideHtml(bank) {
    var header = rules.CSV_HEADER;
    var example = bankCsvTemplate().split('\r\n')[1];
    return '<section class="f27-csv-guide" aria-labelledby="f27CsvGuideTitle-' + bank + '">' +
      '<h3 id="f27CsvGuideTitle-' + bank + '">CSV IMPORT FORMAT &amp; INSTRUCTIONS</h3>' +
      '<p>Use this exact header. Save the file as UTF-8 CSV.</p>' +
      '<code class="ad-cols">' + esc(header) + '</code>' +
      '<dl class="f27-csv-columns">' + CSV_COLUMNS.map(function (c) {
        return '<div><dt>' + esc(c[0]) + '</dt><dd>' + esc(c[1]) + '</dd></div>';
      }).join('') + '</dl>' +
      '<h4>Correctly formatted example row</h4><code class="ad-cols">' + esc(example) + '</code>' +
      '<ul class="f27-csv-rules">' +
        '<li>Maximum <b>' + GOC.core.CSV_MAX_ROWS + ' question rows per upload</b> (excluding the header).</li>' +
        '<li>One CSV file can contain questions from <b>all five subjects</b>.</li>' +
        '<li>Options <b>A–D are required</b>; option E is optional. The answer must be <b>A–E</b> and match a filled option.</li>' +
        '<li><b>Destination: ' + BANK_LABEL[bank] + '.</b> The selected import panel determines the bank, not the filename, subject or file contents. The other bank is untouched.</li>' +
        '<li>Review the preview before confirming. Duplicates and invalid rows are reported by line and skipped.</li>' +
      '</ul>' +
      '<button type="button" class="ad-btn f27-csv-download" onclick="f27BankDownloadTemplate(\'' + bank + '\')">DOWNLOAD SAMPLE CSV TEMPLATE</button>' +
      '<p class="ad-note">The template works for either bank; choose the import button in the bank where the questions belong.</p>' +
    '</section>';
  }
  global.f27BankDownloadTemplate = function (bank) {
    if (!A.banks[bank]) return;
    var csv = bankCsvTemplate();
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    // Reuse the console's proven save-to-device helper when the full app is
    // present; the fallback keeps this panel testable in isolation.
    if (typeof global.downloadResourceBlob === 'function') {
      global.downloadResourceBlob(blob, 'goc-2027-' + bank + '-question-template', 'csv');
      return;
    }
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'goc-2027-' + bank + '-question-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  function loadBankRows(bank) {
    var st = A.banks[bank];
    var host = $('f27BankList-' + bank);
    if (host) host.innerHTML = '<div class="ad-loading">Loading…</div>';
    api.adminBankQuestions(bank, { q: st.q, subject: st.subject }).then(function (r) {
      st.rows = r.questions || [];
      st.count = r.total;
      renderBankRows(bank);
    }, function (er) {
      if (host) host.innerHTML = failText(er);
    });
  }

  function renderBankRows(bank) {
    var st = A.banks[bank];
    var host = $('f27BankList-' + bank);
    if (!host) return;
    if (!st.rows.length) { host.innerHTML = '<div class="ad-empty">No questions in this bank yet — import a CSV or add one manually.</div>'; return; }
    host.innerHTML = st.rows.map(function (q) {
      var on = !!st.sel[q.id];
      return '<div class="f27-admin-row"><div>' +
        '<label style="font-weight:700"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="f27BankToggle(\'' + bank + '\',\'' + esc(q.id) + '\',this.checked)"> ' +
        '<b>' + esc(q.subject) + ' · ' + esc(q.topic || 'General') + '</b></label>' +
        '<span>' + esc(String(q.text || '').slice(0, 180)) + '</span>' +
        '<span>#' + esc(q.id) + ' · ' + esc(q.difficulty || 'medium') + '</span></div>' +
        '<div class="ad-actions"><button class="ad-btn" onclick="f27BankAdd(\'' + bank + '\',\'' + esc(q.id) + '\')">Edit</button>' +
        '<button class="ad-btn danger" onclick="f27BankDeleteOne(\'' + bank + '\',\'' + esc(q.id) + '\')">Delete</button></div></div>';
    }).join('');
  }

  global.f27BankFilter = function (bank) {
    var st = A.banks[bank];
    st.q = (($('f27Q-' + bank) || {}).value || '');
    st.subject = (($('f27Subj-' + bank) || {}).value || '');
    loadBankRows(bank);
  };
  global.f27BankToggle = function (bank, id, on) {
    A.banks[bank].sel[id] = !!on;
  };

  /* ---- manual add / edit -------------------------------------------------
     Every control is scoped to its bank: two open editors cannot read or
     overwrite one another. The form speaks letters; only at the API boundary
     is the chosen letter translated to the existing zero-based answer index.
     No new storage shape, endpoint or question system is introduced. */
  var OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var BANK_SUBJECTS = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
  function qid(bank, field) { return 'f27NQ-' + bank + '-' + field; }
  function qval(bank, field) { var el = $(qid(bank, field)); return el ? String(el.value || '') : ''; }
  function formMessage(bank, message) {
    var el = $(qid(bank, 'message'));
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }
  function readQuestionForm(bank) {
    var options = OPTION_LETTERS.map(function (letter) { return qval(bank, 'option' + letter).trim(); });
    var letter = qval(bank, 'answer').toUpperCase();
    var index = OPTION_LETTERS.indexOf(letter);
    return {
      subject: qval(bank, 'subject'), topic: qval(bank, 'topic'),
      text: qval(bank, 'text'), options: options,
      // E is not part of the persisted options array when it is blank.
      answer: index >= 0 && options[index] ? index : null,
      answerLetter: index >= 0 && options[index] ? letter : '',
      difficulty: qval(bank, 'difficulty') || 'medium',
      explanation: qval(bank, 'explanation'),
      active: $(qid(bank, 'active')) ? $(qid(bank, 'active')).checked : true
    };
  }

  /* Reconcile E on every edit, not just on save. Clearing E also clears an
     E answer, so no hidden selection can survive and shift onto another option. */
  global.f27BankQuestionInput = function (bank) {
    if (!A.banks[bank]) return;
    var select = $(qid(bank, 'answer'));
    var e = select && select.querySelector('option[value="E"]');
    if (e) {
      e.disabled = !qval(bank, 'optionE').trim();
      if (e.disabled && select.value === 'E') select.value = '';
    }
    paintQuestionPreview(bank);
  };
  function paintQuestionPreview(bank) {
    var host = $(qid(bank, 'preview'));
    if (!host) return;
    var d = readQuestionForm(bank);
    host.innerHTML = '<div class="f27-question-preview-label">ADMIN PREVIEW</div>' +
      '<h4>Question 1</h4>' +
      '<p class="f27-question-preview-text">' + esc(d.text.trim() || 'Your question will appear here.') + '</p>' +
      '<ol class="f27-question-preview-options">' + OPTION_LETTERS.map(function (letter, i) {
        if (i === 4 && !d.options[i]) return '';
        return '<li><b>' + letter + '.</b><span>' + esc(d.options[i] || 'Enter option ' + letter) + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="f27-question-preview-answer">Correct Answer: <b>' + esc(d.answerLetter || 'Not selected') + '</b></p>' +
      (d.explanation.trim() ? '<p class="f27-question-preview-explanation"><b>Explanation:</b> ' + esc(d.explanation.trim()) + '</p>' : '');
  }

  global.f27BankAdd = function (bank, id) {
    if (!A.banks[bank]) return;
    var st = A.banks[bank];
    var q = id ? st.rows.filter(function (x) { return String(x.id) === String(id); })[0] : null;
    if (id && !q) { say('Reload this bank before editing that question.'); return; }
    var host = $('f27BankEdit-' + bank);
    if (!host) return;
    var answer = q && Number.isInteger(Number(q.answer)) && q.options && q.options[Number(q.answer)]
      ? OPTION_LETTERS[Number(q.answer)] || '' : '';
    var difficulty = q && ['easy', 'medium', 'hard'].indexOf(q.difficulty) > -1 ? q.difficulty : 'medium';
    function field(name, label, control, note) {
      var fieldId = qid(bank, name);
      return '<div class="ad-field f27-question-field"><label for="' + fieldId + '">' + label + '</label>' +
        control + (note ? '<p class="ad-note" id="' + fieldId + '-note">' + note + '</p>' : '') + '</div>';
    }
    function input(name, value, required, placeholder) {
      return '<input id="' + qid(bank, name) + '" type="text" value="' + esc(value || '') + '" ' +
        'placeholder="' + esc(placeholder || '') + '" autocomplete="off" enterkeyhint="next"' + (required ? ' required' : '') + '>';
    }
    var html = '<section class="ad-card f27-question-editor" aria-labelledby="' + qid(bank, 'heading') + '">' +
      '<h3 class="ad-h" id="' + qid(bank, 'heading') + '">' + (q ? 'Edit question' : 'Add question') + '</h3>' +
      '<p class="ad-note">Destination: <b>' + BANK_LABEL[bank] + '</b>' + (q ? ' · #' + esc(q.id) : '') + '</p>' +
      '<form id="' + qid(bank, 'form') + '" class="f27-question-form" novalidate onsubmit="f27BankSubmit(event,\'' + bank + '\',\'' + esc(id || '') + '\')">' +
      field('subject', 'Subject', '<select id="' + qid(bank, 'subject') + '" required>' + BANK_SUBJECTS.map(function (s) {
        return '<option value="' + esc(s) + '"' + (q && q.subject === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('') + '</select>') +
      field('topic', 'Topic', input('topic', q ? q.topic : '', false, 'e.g. Measures of central tendency')) +
      field('text', 'Question', '<textarea id="' + qid(bank, 'text') + '" rows="6" required placeholder="Enter the full question. Press Enter for a new line." aria-describedby="' + qid(bank, 'text-note') + '">' + esc(q ? q.text : '') + '</textarea>', 'Long and multiline questions are supported.') +
      '<fieldset class="f27-question-options"><legend>Answer Options</legend>' +
      '<p class="ad-note">Options A–D are required. Option E is optional.</p>' +
      OPTION_LETTERS.map(function (letter, i) {
        return field('option' + letter, 'Option ' + letter + (i === 4 ? ' <span class="f27-optional">(optional)</span>' : ''),
          input('option' + letter, q && q.options ? q.options[i] : '', i < 4, 'Enter option ' + letter));
      }).join('') + '</fieldset>' +
      field('answer', 'Correct Answer', '<select id="' + qid(bank, 'answer') + '" required><option value="">Select the correct option</option>' +
        OPTION_LETTERS.map(function (letter, i) {
          var value = q && q.options ? q.options[i] || '' : '';
          return '<option value="' + letter + '"' + (answer === letter ? ' selected' : '') +
            (i === 4 && !String(value).trim() ? ' disabled' : '') + '>' + letter + '</option>';
        }).join('') + '</select>', 'Select E is available only when Option E contains text.') +
      field('difficulty', 'Difficulty', '<select id="' + qid(bank, 'difficulty') + '">' + ['easy', 'medium', 'hard'].map(function (d) {
        return '<option value="' + d + '"' + (difficulty === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>';
      }).join('') + '</select>') +
      field('explanation', 'Explanation <span class="f27-optional">(optional)</span>', '<textarea id="' + qid(bank, 'explanation') + '" rows="3" placeholder="Explain why the correct answer is right.">' + esc(q ? q.explanation || '' : '') + '</textarea>') +
      '<label class="f27-question-active"><input id="' + qid(bank, 'active') + '" type="checkbox"' + (!q || q.active !== false ? ' checked' : '') + '> Active — eligible for automatic activity allocation</label>' +
      '<div id="' + qid(bank, 'preview') + '" class="f27-question-preview" role="region" aria-label="Administrator question preview"></div>' +
      '<p id="' + qid(bank, 'message') + '" class="ad-note warn f27-question-message" role="alert" hidden></p>' +
      '<div class="ad-actions f27-question-actions"><button type="submit" class="ad-btn pri" id="' + qid(bank, 'save') + '">' +
        (q ? 'Save changes' : 'Add to ' + (bank === 'weekly' ? 'Weekly Assessment' : 'Competition') + ' bank') + '</button>' +
        '<button type="button" class="ad-btn" onclick="f27BankCancelEdit(\'' + bank + '\')">Cancel</button></div>' +
      '</form></section>';
    host.innerHTML = html;
    var form = $(qid(bank, 'form'));
    // Input covers Android keyboards/composition; change covers native selects.
    form.addEventListener('input', function () { global.f27BankQuestionInput(bank); });
    form.addEventListener('change', function () { global.f27BankQuestionInput(bank); });
    global.f27BankQuestionInput(bank);
    host.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  global.f27BankCancelEdit = function (bank) {
    var host = $('f27BankEdit-' + bank);
    if (host) host.innerHTML = '';
  };
  global.f27BankSubmit = function (event, bank, id) {
    if (event && event.preventDefault) event.preventDefault();
    global.f27BankSave(bank, id);
  };
  global.f27BankSave = function (bank, id) {
    if (!A.banks[bank] || !$(qid(bank, 'form'))) return;
    var d = readQuestionForm(bank), error = '', focusField = '';
    if (BANK_SUBJECTS.indexOf(d.subject) < 0) { error = 'Choose a supported subject.'; focusField = 'subject'; }
    if (!error && !d.text.trim()) { error = 'Enter the question.'; focusField = 'text'; }
    for (var i = 0; i < 4 && !error; i++) {
      if (!d.options[i]) { error = 'Option ' + OPTION_LETTERS[i] + ' is required.'; focusField = 'option' + OPTION_LETTERS[i]; }
    }
    if (!error && d.answer === null) { error = 'Select the correct answer from the filled options.'; focusField = 'answer'; }
    // Keep the server's original validation authoritative after the UI checks.
    var checked = !error && GOC.core ? GOC.core.validateQuestion(Object.assign({}, d, { section: 'objective' })) : null;
    if (checked && checked.error) { error = checked.error; focusField = 'text'; }
    if (error) {
      formMessage(bank, error);
      var bad = $(qid(bank, focusField));
      if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
      return;
    }
    formMessage(bank, '');
    var payload = {
      subject: d.subject, topic: d.topic, text: d.text,
      options: d.options.filter(function (o) { return !!o; }), answer: d.answer,
      explanation: d.explanation, difficulty: d.difficulty, active: d.active
    };
    var btn = $(qid(bank, 'save'));
    busy(btn, true);
    var p = id ? api.adminBankUpdate(bank, id, payload) : api.adminBankCreate(bank, payload);
    p.then(function () {
      say(id ? 'Question updated in the ' + BANK_LABEL[bank] + '.' : 'Question added to the ' + BANK_LABEL[bank] + '.');
      global.f27BankCancelEdit(bank);
      loadBanks(true);
    }, function (er) {
      busy(btn, false);
      // Keep the draft and its preview intact after a validation/network error.
      formMessage(bank, (er && er.message) || 'Could not save the question.');
    });
  };

  /* ---- CSV import with preview and report ---- */
  global.f27BankCsvPicked = function (bank, input) {
    var box = $('f27CsvBox-' + bank);
    var f = input && input.files && input.files[0];
    if (!box) return;
    if (!f) return;
    box.innerHTML = '<div class="ad-loading">Reading ' + esc(f.name) + '…</div>';
    var rd = new FileReader();
    rd.onload = function () {
      var csv = String(rd.result || '');
      A.banks[bank].csv = csv;
      A.banks[bank].csvName = f.name;
      api.adminBankImport(bank, csv, true).then(function (r) {
        var rows = (r.rows || []).map(function (x) {
          return '<div class="f27-admin-row"><div><b>' + esc(x.subject || '') + ' · ' + esc(x.topic || 'General') + '</b><span>' + esc(String(x.text || '').slice(0, 140)) + '</span></div></div>';
        }).join('');
        var errs = (r.errors || []).map(function (e) { return '<div class="ad-note" style="color:var(--red)">Line ' + e.line + ': ' + esc(e.error) + '</div>'; }).join('');
        box.innerHTML = '<div class="ad-card"><div class="ad-h">Import preview — destination: ' + BANK_LABEL[bank] + '</div>' +
          '<p class="ad-note">File ' + esc(f.name) + ': ' + r.read + ' row(s) read, <b>' + r.wouldImport + '</b> would be imported, <b>' + r.skipped + '</b> skipped.</p>' +
          (rows || '<div class="ad-empty">No new questions in this file.</div>') + errs +
          '<div class="ad-actions"><button class="ad-btn pri" onclick="f27BankImportGo(\'' + bank + '\')">Import ' + r.wouldImport + ' question(s) into ' + (bank === 'weekly' ? 'Weekly' : 'Competition') + ' bank</button>' +
          '<button class="ad-btn" onclick="document.getElementById(\'f27CsvBox-' + bank + '\').innerHTML=\'\'">Cancel</button></div></div>';
      }, function (er) {
        box.innerHTML = '<div class="ad-card">' + failText(er) + '</div>';
      });
    };
    rd.onerror = function () {
      box.innerHTML = '<div class="ad-card">' + failText({ message: 'That CSV file could not be read. Choose it again.' }) + '</div>';
    };
    rd.readAsText(f);
    // Allow the same filename to be chosen again after a cancel or correction.
    try { input.value = ''; } catch (e) {}
  };

  global.f27BankImportGo = function (bank) {
    var st = A.banks[bank];
    var box = $('f27CsvBox-' + bank);
    if (box) box.innerHTML = '<div class="ad-loading">Importing into ' + BANK_LABEL[bank] + '…</div>';
    api.adminBankImport(bank, st.csv, false).then(function (r) {
      var errs = (r.errors || []).map(function (e) { return '<div class="ad-note" style="color:var(--red)">Line ' + e.line + ': ' + esc(e.error) + '</div>'; }).join('');
      if (box) box.innerHTML = '<div class="ad-card"><div class="ad-h">Import complete — ' + BANK_LABEL[bank] + '</div>' +
        '<p class="ad-note">' + r.read + ' row(s) read · <b>' + r.imported + ' imported</b> · ' + r.skipped + ' skipped' +
        (r.questions && r.questions.length ? ' (first ID ' + esc(r.questions[0].id) + ')' : '') + '</p>' + errs + '</div>';
      loadBanks(true);
    }, function (er) {
      if (box) box.innerHTML = '<div class="ad-card">' + failText(er) + '</div>';
    });
  };

  /* ---- deletion (individual, bulk, all) — always confirmed in the UI, and
     the server requires confirm:true as well ---- */
  function bankDelete(bank, ids) {
    var label = BANK_LABEL[bank];
    var n = ids.length;
    if (!global.confirm('Delete ' + n + ' selected question' + (n === 1 ? '' : 's') + ' from the ' + label + '?\n\nThis is destructive. Questions already used by an activity are refused by the server.')) return;
    api.adminBankDelete(bank, ids, true).then(function (r) {
      say('Deleted ' + r.deleted + ' question(s) from the ' + label + '.');
      A.banks[bank].sel = {};
      loadBanks(true);
    }, function (er) { say((er && er.message) || 'Delete refused.', true); });
  }
  global.f27BankDeleteOne = function (bank, id) { bankDelete(bank, [id]); };
  global.f27BankDeleteSel = function (bank) {
    var ids = Object.keys(A.banks[bank].sel).filter(function (k) { return A.banks[bank].sel[k]; });
    if (!ids.length) { say('Select at least one question first.', true); return; }
    bankDelete(bank, ids);
  };
  global.f27BankDeleteAll = function (bank) {
    var label = BANK_LABEL[bank];
    var count = A.banks[bank].count || 0;
    if (!global.confirm('DELETE ALL ' + count + ' question(s) in the ' + label + '?\n\nThis is destructive and cannot be undone. The other bank is not affected. Questions used by an activity are refused by the server.')) return;
    api.adminBankDeleteAll(bank, true).then(function (r) {
      say('Deleted all ' + r.deleted + ' question(s) from the ' + label + '. The ' + (bank === 'weekly' ? 'Competition' : 'Weekly Assessment') + ' bank is untouched.');
      loadBanks(true);
    }, function (er) { say((er && er.message) || 'Delete-all refused.', true); });
  };

  /* ============================================================ 8. MOUNTING
     The tile is added to the console's tile list (a plain object the console
     already reads) and admOpen() learns one new section name. Both are additive
     and both are inert unless the console is opened. */
  function mount() {
    A.mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  GOC.freeAdmin = {
    mount: mount,
    panel: panel,
    load: function () { return global.f27AdmLoad(); },
    tab: function (t) { A.tab = t; return global.f27AdmLoad(); }
  };
}(typeof window !== 'undefined' ? window : this));
