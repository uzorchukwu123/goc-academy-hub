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
      '(<b>GOC-F-…</b> students), its own activities and its own sessions. Nothing here reads or changes a ' +
      'G.O.C student, attempt or staff record. The website mode itself is switched from the separate ' +
      '<b>Website Mode Control</b> function.</p>' +
      '<div class="ad-seg" id="f27AdmTabs">' + tabsHtml() + '</div>' +
      '<div id="f27AdmBody"><div class="ad-loading">Reading the programme…</div></div></div>';
  }
  /* The SEPARATE Website Mode Control function: one panel, one job — switching
     the public site between Original G.O.C Academy Hub and the 2027 Free
     Tutorial Edition. Founder only (the server refuses the route for every
     other role as well). */
  function modePanel() {
    return '<div class="ad-card"><div class="ad-h">Website Mode Control</div>' +
      '<p class="ad-p">Switch the whole website between the original G.O.C Academy Hub and the 2027 Free ' +
      'Tutorial Edition. The switch is stored with the site data and survives server restarts; it changes ' +
      'nothing else — every G.O.C record, question and setting stays exactly where it is, and switching back ' +
      'restores the complete original experience.</p>' +
      '<div id="f27ModeBody"><div class="ad-loading">Reading the mode…</div></div></div>';
  }
  function tabsHtml() {
    var tabs = [['mode', 'Programme settings'], ['participants', 'Participants'], ['activities', 'Activities'],
      ['results', 'Results'], ['leaderboards', 'Leaderboards'], ['records', 'Session records']];
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
    /* Two extra tiles, drawn beside the console's own twenty-seven, are added at
       runtime rather than to ADM_TILE_META so that the hub's section rule, its
       tile grid and the tests that pin their number stay exactly as they are:
       the edition's records are not console sections in the capability map,
       they are a temporary programme, and every one of its routes carries its
       own guard on the server.

       ROOT-CAUSE FIX: the wrappers must be installed UNCONDITIONALLY. The
       previous version bailed out here when nobody was signed in yet — which
       is exactly the state at DOMContentLoaded, before the administrator has
       logged in — so the wrappers were never installed and the tiles never
       appeared in the running console. The role checks now happen inside the
       wrappers, at the moment the menu is painted or a tile is clicked, when
       global.admMe is populated. */
    var open = global.admOpen;
    if (typeof open === 'function' && !open.__f27) {
      var wrapped = function (section) {
        if (section === 'free2027' || section === 'websitemode') {
          if (section === 'free2027' && !mayManageProgramme()) { say('The 2027 Free Tutorial Management console is for the Founder and Academic Director.'); return; }
          if (section === 'websitemode' && !isFounder()) { say('Website Mode Control is for the Founder only.'); return; }
          var b = $('admSheetBody'), back = $('admSheetBack'), sheet = $('admSheet'), title = $('admSheetTitle');
          if (b) {
            if (title) title.textContent = section === 'websitemode' ? 'Website Mode Control' : '2027 Free Tutorial Management';
            b.innerHTML = section === 'websitemode' ? modePanel() : panel();
            b.scrollTop = 0;
            if (back) back.classList.add('show');
            if (sheet) sheet.classList.add('show');
          }
          /* Mark this tile active and leave every other tile alone. */
          var nav = $('admTileNav');
          if (nav) {
            var tiles = nav.querySelectorAll('.adm-tile');
            for (var i = 0; i < tiles.length; i++) {
              tiles[i].classList.toggle('active', tiles[i].getAttribute('data-section') === section);
            }
          }
          if (section === 'websitemode') { global.f27ModeLoad(); return; }
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
        /* admMenuApply rebuilds the tile grid from scratch on every call, so the
           edition's tiles are re-added on every paint — but only for a role
           that may see them, checked NOW, not at boot. */
        var nav = $('admTileNav');
        if (nav) {
          if (mayManageProgramme() && nav.innerHTML.indexOf('data-section="free2027"') < 0) {
            nav.insertAdjacentHTML('beforeend',
              '<button class="adm-tile" data-section="free2027" onclick="admOpen(\'free2027\')" aria-label="2027 Free Tutorial Management">' +
              '<span class="at-label">2027 Free Tutorial Management</span></button>');
          }
          if (isFounder() && nav.innerHTML.indexOf('data-section="websitemode"') < 0) {
            nav.insertAdjacentHTML('beforeend',
              '<button class="adm-tile" data-section="websitemode" onclick="admOpen(\'websitemode\')" aria-label="Website Mode Control">' +
              '<span class="at-label">Website Mode Control</span></button>');
          }
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
        '<p class="ad-note">The website mode is switched from the separate <b>Website Mode Control</b> console ' +
        'function, which only the Founder may use. Academic programme content and reports remain available here.</p>' +
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
      global.f27ModeLoad();
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

  /* The Website Mode Control panel: the current mode, and the two switch
     buttons. Rendered only for the Founder — the tile itself is only injected
     for the Founder, and the server route refuses every other role. */
  global.f27ModeLoad = function () {
    var host = $('f27ModeBody');
    if (!host) return;
    if (!isFounder()) {
      host.innerHTML = '<p class="ad-warn">Website Mode Control is for the Founder only.</p>';
      return;
    }
    host.innerHTML = '<div class="ad-loading">Reading the mode…</div>';
    api.adminOverview().then(function (o) {
      A.overview = o;
      var on = o.enabled === true;
      var free = o.mode === rules.MODE_FREE && on;
      host.innerHTML =
        '<div class="ad-metric"><span>Current website mode</span><b>' + esc(rules.modeLabel(o.mode)) + '</b></div>' +
        '<div class="ad-metric"><span>2027 edition</span><b>' + (on ? 'Active' : 'Switched off') + '</b></div>' +
        '<p class="ad-note">Original Mode restores the full G.O.C Academy Hub and every one of its features. ' +
        '2027 Free Tutorial Mode shows the homepage and the CBT Portal only — weekly assessments, competitions and the ' +
        'competition leaderboard. Switching either way deletes nothing: every G.O.C record, question and setting stays exactly where it is, ' +
        'and the switch is stored with the site data, so it survives server restarts.</p>' +
        '<div class="ad-actions">' +
          '<button class="ad-btn ' + (free ? '' : 'pri') + '" onclick="f27AdmSetMode(\'' + rules.MODE_ORIGINAL + '\')">Switch to Original Mode</button>' +
          '<button class="ad-btn ' + (free ? 'pri' : '') + '" onclick="f27AdmSetMode(\'' + rules.MODE_FREE + '\')">Switch to 2027 Free Tutorial Mode</button>' +
        '</div>' +
        '<div class="ad-actions" style="margin-top:6px">' +
          '<button class="ad-btn" onclick="f27AdmReloadSite()">Reload the public site</button>' +
        '</div>';
    }, function (er) {
      host.innerHTML = failText(er);
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
    return '<div class="ad-actions" style="margin-bottom:12px"><button class="ad-btn pri" onclick="f27AdmEdit(null)">New activity</button>' +
      '<button class="ad-btn" onclick="f27AdmLoad()">Refresh</button></div>' +
      (rows || '<div class="ad-empty">No activity has been created for this session yet.</div>');
  }

  global.f27AdmEdit = function (id) {
    var a = id ? A.activities.filter(function (x) { return x.id === id; })[0] : null;
    A.editing = a ? JSON.parse(JSON.stringify(a)) : {
      id: null, kind: rules.KIND_WEEKLY, title: '', instructions: '',
      opensAt: Date.now(), closesAt: Date.now() + 7 * 86400000,
      durationMin: 20, maxAttempts: 1, questionIds: [], status: rules.STATUS_DRAFT
    };
    A.selectedQuestion = null;
    paintEditor();
  };

  function paintEditor() {
    var a = A.editing;
    if (!a) return;
    var host = $('f27Editor');
    if (!host) {
      /* Editing after a reload: re-open the list first, then the editor. */
      body(activityListHtml() + '<div id="f27Editor"></div>');
      host = $('f27Editor');
      if (!host) return;
    }
    var qIds = (a.questionIds || []).join(',');
    host.innerHTML = '<div class="ad-card"><div class="ad-h">' + (a.id ? 'Edit activity' : 'New activity') + '</div>' +
      '<div class="ad-grid2 two">' +
        '<div class="ad-field"><label>Kind</label><select id="f27Kind" onchange="f27AdmEditorRead()">' +
          rules.KINDS.map(function (k) {
            return '<option value="' + k + '"' + (a.kind === k ? ' selected' : '') + '>' + esc(rules.KIND_LABELS[k]) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="ad-field"><label>Title</label><input id="f27Title" value="' + esc(a.title) + '" placeholder="e.g. Week 3 — Mechanics"></div>' +
      '</div>' +
      '<div class="ad-field"><label>Instructions (optional)</label><textarea id="f27Instr" rows="2">' + esc(a.instructions || '') + '</textarea></div>' +
      '<div class="ad-grid2 two">' +
        '<div class="ad-field"><label>Opens</label><input id="f27Opens" type="datetime-local" value="' + esc(toLocalInput(a.opensAt)) + '"></div>' +
        '<div class="ad-field"><label>Closes</label><input id="f27Closes" type="datetime-local" value="' + esc(toLocalInput(a.closesAt)) + '"></div>' +
        '<div class="ad-field"><label>Duration (minutes)</label><input id="f27Dur" type="number" min="' + rules.MIN_DURATION_MIN + '" max="' + rules.MAX_DURATION_MIN + '" value="' + Number(a.durationMin) + '"></div>' +
        '<div class="ad-field"><label>Maximum attempts</label><input id="f27Max" type="number" min="' + rules.MIN_ATTEMPTS + '" max="' + rules.MAX_ATTEMPTS + '" value="' + Number(a.maxAttempts) + '"></div>' +
      '</div>' +
      '<div class="ad-field"><label>Questions (' + (a.questionIds || []).length + ' chosen)</label>' +
        '<p class="ad-note">The activity draws on the academy\'s own question bank, exactly as a CBT paper does. ' +
        'Pick a subject below, then add or remove questions.</p>' +
        '<div class="ad-grid2 two">' +
          '<div class="ad-field"><label>Subject</label><select id="f27QSubj">' +
            (GOC.core && GOC.core.ALL_SUBJECTS ? GOC.core.ALL_SUBJECTS : ['Use of English', 'Physics', 'Chemistry', 'Biology', 'Mathematics'])
              .map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="ad-field"><label>&nbsp;</label><button class="ad-btn pri" onclick="f27AdmFontLoad()">Load questions</button></div>' +
        '</div>' +
        '<div id="f27QList"><div class="ad-empty">Choose a subject and press Load questions.</div></div>' +
        '<input type="hidden" id="f27QIds" value="' + esc(qIds) + '">' +
      '</div>' +
      '<div class="ad-actions"><button class="ad-btn pri" id="f27SaveBtn" onclick="f27AdmSaveActivity(this)">Save</button>' +
      '<button class="ad-btn" onclick="f27AdmCancelEdit()">Cancel</button></div>' +
      '<p class="ad-note">Saving keeps the activity as a draft until you publish it. Publishing checks the window, the duration, ' +
      'the attempt limit and the questions again on the server.</p></div>' +
      '<div id="f27QAdded"></div>';
  }

  global.f27AdmEditorRead = function () {
    var a = A.editing;
    if (!a) return;
    a.kind = ($('f27Kind') || {}).value || a.kind;
    a.title = ($('f27Title') || {}).value || '';
    a.instructions = ($('f27Instr') || {}).value || '';
    a.opensAt = fromLocalInput(($('f27Opens') || {}).value) || a.opensAt;
    a.closesAt = fromLocalInput(($('f27Closes') || {}).value) || a.closesAt;
    a.durationMin = Number(($('f27Dur') || {}).value) || a.durationMin;
    a.maxAttempts = Number(($('f27Max') || {}).value) || a.maxAttempts;
    var ids = String(($('f27QIds') || {}).value || '');
    a.questionIds = ids ? ids.split(',').filter(Boolean) : [];
  };

  global.f27AdmCancelEdit = function () {
    A.editing = null;
    loadActivities();
  };

  /* The question picker reads the bank through the EDITION's own route
     (/api/free2027/admin/questions), which reads the hub's local data file and
     never Appwrite. The hub's /api/questions is not used here on purpose: on a
     deployment where the Appwrite Database API is unavailable that route fails,
     and no activity could be built at all. Nothing is copied. */
  global.f27AdmFontLoad = function () {
    var host = $('f27QList');
    if (!host) return;
    var subject = ($('f27QSubj') || {}).value || '';
    host.innerHTML = '<div class="ad-loading">Reading the local question bank…</div>';
    GOC.api.ready.then(function () {
      return api.adminQuestions(subject);
    }).then(function (r) {
      var rows = (r.questions || []).filter(function (q) {
        return q.kind === 'objective' && !q.archived && q.active !== false && (!subject || q.subject === subject);
      });
      A.selectedQuestion = rows;
      if (!rows.length) { host.innerHTML = '<div class="ad-empty">No live objective questions in that subject yet.</div>'; return; }
      A.editing.chosen = {};
      host.innerHTML = rows.map(function (q) {
        var on = (A.editing.questionIds || []).indexOf(String(q.id)) > -1;
        return '<div class="f27-admin-row"><div><b>' + esc(q.topic || 'General') + '</b>' +
          '<span>' + esc(String(q.text || '').slice(0, 160)) + '</span>' +
          '<span>#' + esc(q.id) + ' · ' + esc(q.difficulty || 'medium') + '</span></div>' +
          '<button class="ad-btn' + (on ? ' danger' : '') + '" onclick="f27AdmToggleQuestion(\'' + esc(q.id) + '\')">' +
          (on ? 'Remove' : 'Add') + '</button></div>';
      }).join('');
    }, function (er) {
      host.innerHTML = failText(er);
    });
  };

  global.f27AdmToggleQuestion = function (id) {
    var a = A.editing;
    if (!a) return;
    global.f27AdmEditorRead();
    var ids = (a.questionIds || []).map(String);
    var at = ids.indexOf(String(id));
    if (at > -1) ids.splice(at, 1); else ids.push(String(id));
    a.questionIds = ids;
    var hidden = $('f27QIds');
    if (hidden) hidden.value = ids.join(',');
    var label = document.querySelector('#f27Editor .ad-field label');
    /* Re-render just the picker and the count. */
    var host = $('f27QList');
    if (host && A.selectedQuestion) {
      host.innerHTML = A.selectedQuestion.map(function (q) {
        var on = ids.indexOf(String(q.id)) > -1;
        return '<div class="f27-admin-row"><div><b>' + esc(q.topic || 'General') + '</b>' +
          '<span>' + esc(String(q.text || '').slice(0, 160)) + '</span>' +
          '<span>#' + esc(q.id) + ' · ' + esc(q.difficulty || 'medium') + '</span></div>' +
          '<button class="ad-btn' + (on ? ' danger' : '') + '" onclick="f27AdmToggleQuestion(\'' + esc(q.id) + '\')">' +
          (on ? 'Remove' : 'Add') + '</button></div>';
      }).join('');
    }
    var add = $('f27QAdded');
    if (add) add.innerHTML = '<p class="ad-note">' + ids.length + ' question' + (ids.length === 1 ? '' : 's') + ' chosen.</p>';
  };

  global.f27AdmSaveActivity = function (btn) {
    global.f27AdmEditorRead();
    var a = A.editing;
    if (!a) return;
    var payload = {
      kind: a.kind, title: a.title, instructions: a.instructions,
      opensAt: a.opensAt, closesAt: a.closesAt,
      durationMin: a.durationMin, maxAttempts: a.maxAttempts,
      questionIds: a.questionIds
    };
    busy(btn, true);
    api.saveActivity(payload, a.id).then(function () {
      busy(btn, false);
      say('Saved');
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
