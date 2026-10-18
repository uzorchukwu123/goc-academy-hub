/* Tutor screens (Phase 3C slice 4). This file is NOT part of the public app bundle: it lives in
   server/tutor/, which the static server never serves, and goes out only through the
   single-use door route. It is plain ES5 like the rest of the app and draws its own overlay and
   its own styles, so nothing here touches the student screens.
   The session token is held in memory only: a reload ends the session on purpose. */
(function () {
  'use strict';
  if (window.__zxOpen) { window.__zxOpen(); return; }

  var PW_MIN = 8;
  var st = { view: 'signin', token: null, user: null, subject: '', info: null, stats: null, statsError: '', busy: false, error: '', note: '', idDraft: '', shown: false,
    qs: null, qError: '', qFilter: 'all', form: null, imp: null,
    ns: null, nError: '', nForm: null,
    sc: null, scError: '', scFilter: 'awaiting-marking', script: null, scriptError: '',
    ar: null, arError: '', arSort: 'inactive', arAll: false,
    top: null, topError: '', topTab: 'tests', topAll: false,
    stu: null, stuError: '', stuId: '', stuContact: null, stuContactError: '', stuContactBusy: false,
    audit: null, auditError: '' };
  var root = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------ server calls */
  function call(method, path, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (st.token) opts.headers.Authorization = 'Bearer ' + st.token;
    return fetch('api' + path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var err = new Error((data && data.error) || 'The server could not complete that (' + r.status + ').');
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function () { throw new Error('Cannot reach the server. Check your connection.'); });
  }

  /* ------------------------------------------------------------------ styles */
  var CSS = [
    '.zx-wrap{position:fixed;inset:0;z-index:99999;font-family:inherit;color:#1c1c1e}',
    '.zx-back{position:absolute;inset:0;background:rgba(15,15,20,.55)}',
    '.zx-sheet{position:absolute;left:0;right:0;bottom:0;max-width:460px;margin:0 auto;background:#fff;border-radius:18px 18px 0 0;padding:22px 20px 26px;box-shadow:0 -10px 40px rgba(0,0,0,.25);transform:translateY(100%);transition:transform .28s ease}',
    '.zx-wrap.zx-in .zx-sheet{transform:translateY(0)}',
    '.zx-full{position:absolute;inset:0;background:#f5f5f7;overflow:auto;-webkit-overflow-scrolling:touch}',
    '.zx-h{margin:0 0 4px;font-size:20px;font-weight:700}',
    '.zx-p{margin:0 0 14px;font-size:14px;color:#555;line-height:1.45}',
    '.zx-f{margin:0 0 12px}',
    '.zx-f label{display:block;font-size:13px;font-weight:600;margin:0 0 5px}',
    '.zx-f input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #c9c9ce;border-radius:10px;background:#fff}',
    '.zx-row{display:flex;gap:8px;align-items:center}',
    '.zx-btn{display:block;width:100%;padding:13px;font-size:16px;font-weight:700;border:0;border-radius:10px;background:#c8102e;color:#fff;cursor:pointer}',
    '.zx-btn[disabled]{opacity:.6}',
    '.zx-ghost{background:transparent;color:#444;border:1px solid #c9c9ce;font-weight:600}',
    '.zx-sm{display:inline-block;width:auto;padding:8px 12px;font-size:13px}',
    '.zx-err{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#fde8ea;color:#8a1022;font-size:14px}',
    '.zx-note{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#e7f4ea;color:#17532a;font-size:14px}',
    '.zx-top{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;background:#fff;border-bottom:1px solid #e3e3e8}',
    '.zx-who{font-size:13px;color:#555}.zx-who b{display:block;font-size:16px;color:#1c1c1e}',
    '.zx-body{max-width:760px;margin:0 auto;padding:16px}',
    '.zx-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}',
    '.zx-chip{padding:9px 14px;font-size:14px;font-weight:600;border:1px solid #c9c9ce;border-radius:999px;background:#fff;color:#333;cursor:pointer}',
    '.zx-chip[aria-pressed=true]{background:#c8102e;border-color:#c8102e;color:#fff}',
    '.zx-card{background:#fff;border:1px solid #e3e3e8;border-radius:14px;padding:14px 16px;margin:0 0 12px}',
    '.zx-card h3{margin:0 0 6px;font-size:15px}',
    '.zx-card p{margin:0;font-size:14px;color:#555;line-height:1.45}',
    '.zx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:8px}',
    '.zx-stat{background:#f5f5f7;border-radius:10px;padding:8px 10px;font-size:12px;color:#555}.zx-stat b{display:block;font-size:20px;color:#1c1c1e}',
    '.zx-soon{opacity:.75;border-style:dashed}',
    '.zx-act{margin-top:12px}.zx-actl{font-size:12px;color:#555;margin-bottom:4px}.zx-bars{display:flex;gap:6px;align-items:flex-end}.zx-bar{flex:1;text-align:center;font-size:11px;color:#555}.zx-bar i{display:block;background:#1a7f5a;border-radius:4px 4px 0 0;margin:0 auto;width:100%}.zx-bar i.zx-zero{background:#d8d8dc}.zx-bar b{display:block;font-size:12px;color:#1c1c1e;font-weight:600}',
    '.zx-rank{margin:6px 0 0;padding-left:22px;font-size:14px}.zx-rank li{margin:0 0 8px;line-height:1.4}.zx-rank b{display:block;font-weight:600;word-break:break-word}.zx-rank span{display:block;font-size:12px;color:#555}',
    '.zx-f textarea,.zx-f select{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #c9c9ce;border-radius:10px;background:#fff;font-family:inherit}',
    '.zx-f textarea{min-height:92px;resize:vertical}',
    '.zx-badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700;margin:0 6px 6px 0}',
    '.zx-b-pending{background:#fff1cc;color:#6b4a00}.zx-b-live{background:#dcf3e3;color:#17532a}.zx-b-returned{background:#fde8ea;color:#8a1022}.zx-b-off{background:#e8e8ed;color:#444}',
    '.zx-qtext{margin:4px 0 8px;font-size:15px;color:#1c1c1e;word-break:break-word}',
    '.zx-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
    '.zx-why{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:#fde8ea;color:#8a1022;font-size:13px}',
    '.zx-card p.zx-warn{margin-top:8px;padding:8px 10px;border-radius:8px;background:#fff6e0;color:#6b4a00;font-size:13px}',
    '.zx-card p.zx-ok{margin-top:8px;padding:8px 10px;border-radius:8px;background:#e7f4ea;color:#17532a;font-size:13px}',
    '.zx-ar{list-style:none;margin:0 0 10px;padding:0}.zx-ar li{padding:9px 0;border-top:1px solid #eee;font-size:14px;color:#1c1c1e}',
    '.zx-arid{font-size:12px;color:#777}.zx-arwhy{display:block;margin-top:3px;font-size:13px;color:#8a1022}',
    '.zx-open{display:block;margin-top:6px}.zx-kv{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #eee;font-size:14px}.zx-kv span:last-child{font-weight:600;text-align:right}.zx-off{font-size:13px;color:#8a1022}',
    '.zx-tplist li{display:flex;gap:10px;align-items:flex-start}.zx-rk{flex:0 0 26px;height:26px;border-radius:50%;background:#c8102e;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:26px}.zx-rk0{flex:0 0 26px}.zx-topfig{display:block;margin-top:3px;font-size:13px;color:#17532a}'
  ].join('');

  /* ----------------------------------------------------------------- drawing */
  function errHTML() { return st.error ? '<div class="zx-err" role="alert">' + esc(st.error) + '</div>' : ''; }
  function noteHTML() { return st.note ? '<div class="zx-note" role="status">' + esc(st.note) + '</div>' : ''; }

  function signinHTML() {
    return '<div class="zx-back" data-act="close"></div>' +
      '<div class="zx-sheet" role="dialog" aria-modal="true" aria-label="Sign in">' +
      '<h2 class="zx-h">Sign in</h2><p class="zx-p">Enter your ID and password.</p>' +
      errHTML() +
      '<div class="zx-f"><label for="zxId">ID</label><input id="zxId" type="text" autocomplete="username" autocapitalize="characters" placeholder="GOC-T-001" value="' + esc(st.idDraft) + '"></div>' +
      '<div class="zx-f"><label for="zxPw">Password</label><div class="zx-row"><input id="zxPw" type="password" autocomplete="current-password"><button type="button" class="zx-btn zx-ghost zx-sm" data-act="show" data-for="zxPw">Show</button></div></div>' +
      '<button type="button" class="zx-btn" data-act="signin"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : 'Sign in') + '</button>' +
      '<button type="button" class="zx-btn zx-ghost" style="margin-top:8px" data-act="close">Cancel</button>' +
      '</div>';
  }

  function passwordHTML() {
    return '<div class="zx-full"><div class="zx-body" style="max-width:460px;padding-top:40px">' +
      '<h2 class="zx-h">Choose a new password</h2>' +
      '<p class="zx-p">This is your first sign-in, so you need your own password before you continue. Use at least ' + PW_MIN + ' characters.</p>' +
      errHTML() +
      '<div class="zx-f"><label for="zxCur">Current password</label><input id="zxCur" type="password" autocomplete="current-password"></div>' +
      '<div class="zx-f"><label for="zxNew">New password</label><input id="zxNew" type="password" autocomplete="new-password"></div>' +
      '<div class="zx-f"><label for="zxNew2">New password again</label><input id="zxNew2" type="password" autocomplete="new-password"></div>' +
      '<button type="button" class="zx-btn" data-act="setpw"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : 'Save password') + '</button>' +
      '<button type="button" class="zx-btn zx-ghost" style="margin-top:8px" data-act="signout">Sign out</button>' +
      '</div></div>';
  }

  function depthCard() {
    var d = st.info && st.info.depth;
    if (!d) return '<div class="zx-card"><h3>Your paper</h3><p>Loading…</p></div>';
    function s(label, n) { return '<div class="zx-stat"><b>' + esc(n) + '</b>' + esc(label) + '</div>'; }
    return '<div class="zx-card"><h3>Questions and notes in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid">' + s('Objective', d.objective) + s('Theory', d.theory) + s('JAMB-style', d.jamb) + s('Practice', d.practice) + s('Notes', d.notes) + '</div></div>';
  }

  /* Slice 5.2: the class snapshot. Counts and averages only; the server never sends a name or ID.
     An average resting on a small sample is shown with a plain warning, never hidden. */
  function avgText(avg, unit) { return avg == null ? 'No ' + unit + ' yet' : String(avg) + '%'; }
  function snapshotCard() {
    var a = st.stats, sn = a && a.snapshot;
    if (st.statsError) return '<div class="zx-card"><h3>Class snapshot</h3><p>' + esc(st.statsError) + '</p></div>';
    if (!sn) return '<div class="zx-card zx-soon"><h3>Class snapshot</h3><p>Loading…</p></div>';
    function s(label, n) { return '<div class="zx-stat"><b>' + esc(n) + '</b>' + esc(label) + '</div>'; }
    var warn = [];
    if (sn.practice.average != null && sn.practice.small) warn.push('Practice average rests on only ' + sn.practice.answers + ' answer' + (sn.practice.answers === 1 ? '' : 's') + ' (under 10), so read it with care.');
    if (sn.tests.average != null && sn.tests.small) warn.push('Test average rests on only ' + sn.tests.papers + ' marked paper' + (sn.tests.papers === 1 ? '' : 's') + ' (under 3), so read it with care.');
    return '<div class="zx-card"><h3>Class snapshot</h3>' +
      '<div class="zx-grid">' +
      s('GOC students', sn.gocStudents) +
      s('Active in the last ' + sn.activeDays + ' days', sn.active) +
      s('Practice average', avgText(sn.practice.average, 'answers')) +
      s('Test average', avgText(sn.tests.average, 'marked tests')) +
      '</div>' +
      '<p style="margin-top:10px">' + esc(sn.openStudents) + ' Open student' + (sn.openStudents === 1 ? '' : 's') + ' also take ' + esc(st.subject) + ' (counted only, never averaged).</p>' +
      warn.map(function (w) { return '<p class="zx-warn">' + esc(w) + '</p>'; }).join('') +
      '</div>';
  }

  /* Slice 5.5: the 7-day activity chart. Three small bar rows (students active, practice answers,
     tests), one bar per day. Counts only; the server sends no name or ID. */
  function activityCard() {
    var a = st.stats && st.stats.activity;
    if (st.statsError) return '<div class="zx-card"><h3>Last 7 days</h3><p>' + esc(st.statsError) + '</p></div>';
    if (!a) return '<div class="zx-card zx-soon"><h3>Last 7 days</h3><p>Loading…</p></div>';
    var days = a.days || [], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function row(label, key) {
      var max = 0; days.forEach(function (d) { if ((d[key] || 0) > max) max = d[key]; });
      return '<div class="zx-act"><div class="zx-actl">' + esc(label) + '</div><div class="zx-bars">' + days.map(function (d) {
        var v = Number(d[key]) || 0, h = max ? Math.max(v ? 8 : 2, Math.round(v / max * 48)) : 2;
        var wd = WD[new Date(d.day + 'T00:00:00Z').getUTCDay()];
        return '<div class="zx-bar"><i style="height:' + h + 'px"' + (v ? '' : ' class="zx-zero"') + '></i><b>' + esc(v) + '</b><span>' + esc(wd) + '</span></div>';
      }).join('') + '</div></div>';
    }
    var none = !a.total || (!a.total.answers && !a.total.tests);
    return '<div class="zx-card"><h3>Last 7 days</h3>' +
      row('Students active', 'active') + row('Practice answers', 'answers') + row('Tests submitted', 'tests') +
      (none ? '<p class="zx-warn">No practice or tests from your GOC students in the last 7 days.</p>' : '') +
      '</div>';
  }

  /* Slice 5.4: the Weak topics and Hardest questions cards. The server has already applied the
     10-answer floor; here we only draw what it sent, and say plainly when there is not enough yet.
     Everything from the server is written escaped. */
  function rankedCard(title, what, list, rowHTML) {
    if (st.statsError) return '<div class="zx-card"><h3>' + esc(title) + '</h3><p>' + esc(st.statsError) + '</p></div>';
    if (!list) return '<div class="zx-card zx-soon"><h3>' + esc(title) + '</h3><p>Loading…</p></div>';
    var items = list.items || [], min = list.minAnswers || 10, hidden = list.hidden || 0, out = '<div class="zx-card"><h3>' + esc(title) + '</h3>';
    if (!items.length) {
      out += '<p>Not enough answers yet. A ' + what + ' appears here once it has at least ' + esc(min) + ' answers from your GOC students.</p>';
    } else {
      out += '<ol class="zx-rank">' + items.map(rowHTML).join('') + '</ol>';
    }
    if (hidden && items.length) out += '<p class="zx-warn">' + esc(hidden) + ' more ' + what + (hidden === 1 ? ' has' : 's have') + ' fewer than ' + esc(min) + ' answers, so ' + (hidden === 1 ? 'it is' : 'they are') + ' not ranked yet.</p>';
    else if (hidden) out += '<p class="zx-warn">' + esc(hidden) + ' ' + what + (hidden === 1 ? ' has' : 's have') + ' some answers, but fewer than ' + esc(min) + '.</p>';
    return out + '</div>';
  }
  function pctLine(x) { return esc(x.percent) + '% right · ' + esc(x.answers) + ' answers'; }
  function weakCard() {
    return rankedCard('Weak topics', 'topic', st.stats && st.stats.weakTopics, function (x) {
      return '<li><b>' + esc(x.topic) + '</b><span>' + pctLine(x) + '</span></li>';
    });
  }
  function hardCard() {
    return rankedCard('Hardest questions', 'question', st.stats && st.stats.hardestQuestions, function (x) {
      return '<li><b>' + esc(x.text) + '</b><span>' + (x.topic ? esc(x.topic) + ' · ' : '') + pctLine(x) + '</span></li>';
    });
  }


  /* At-risk list, slice 3: GOC students of the open subject who need a nudge. The server decides who is listed
     and in which order (GET /tutor/atrisk); here we only draw it. Two orders: most inactive first, or lowest
     test average first. Ten rows show at first, the rest sit behind Show all. Everything from the server is
     written escaped. */
  var AR_SHOW = 10;
  function arReasons(x, lim) {
    var out = [];
    (x.reasons || []).forEach(function (r) {
      if (r === 'never-started') out.push('Joined over ' + esc(lim.inactiveDays) + ' days ago and has not started');
      else if (r === 'inactive') out.push('No practice or test for ' + esc(x.daysInactive) + ' day' + (x.daysInactive === 1 ? '' : 's'));
      else if (r === 'low-average') out.push('Test average ' + esc(x.average) + '% over ' + esc(x.papers) + ' paper' + (x.papers === 1 ? '' : 's') + (x.lastScore != null ? ' (last ' + esc(x.lastScore) + '%)' : ''));
    });
    return out;
  }
  function atRiskCard() {
    var title = 'At-risk students';
    if (st.arError) return '<div class="zx-card"><h3>' + title + '</h3><p>' + esc(st.arError) + '</p></div>';
    if (!st.ar) return '<div class="zx-card zx-soon"><h3>' + title + '</h3><p>Loading…</p></div>';
    var r = st.ar, lim = r.limits || { inactiveDays: 7, lowAverage: 40 }, rows = r.students || [];
    var out = '<div class="zx-card"><h3>' + title + ' in ' + esc(st.subject) + '</h3>' +
      '<p>GOC students who have not practised or sat a test for ' + esc(lim.inactiveDays) + ' days, or whose marked test average is under ' + esc(lim.lowAverage) + '%.</p>';
    if (!rows.length) return out + '<p class="zx-ok">Nobody is at risk right now.</p></div>';
    out += '<div class="zx-chips" role="group" aria-label="Order" style="margin:10px 0 8px">' +
      '<button type="button" class="zx-chip" data-act="arsort" data-sort="inactive" aria-pressed="' + (r.sort === 'score' ? 'false' : 'true') + '">Most inactive</button>' +
      '<button type="button" class="zx-chip" data-act="arsort" data-sort="score" aria-pressed="' + (r.sort === 'score' ? 'true' : 'false') + '">Lowest score</button></div>';
    out += '<p><b>' + esc(rows.length) + '</b> student' + (rows.length === 1 ? '' : 's') + ' at risk.</p>';
    var shown = st.arAll ? rows : rows.slice(0, AR_SHOW);
    out += '<ul class="zx-ar">' + shown.map(function (x) {
      return '<li><b>' + esc(x.name || x.id) + '</b> <span class="zx-arid">' + esc(x.id) + '</span>' +
        arReasons(x, lim).map(function (t) { return '<span class="zx-arwhy">' + t + '</span>'; }).join('') +
        '<button type="button" class="zx-btn zx-ghost zx-sm zx-open" data-act="stuopen" data-id="' + esc(x.id) + '">Open</button></li>';
    }).join('') + '</ul>';
    if (rows.length > AR_SHOW) out += '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="arall">' + (st.arAll ? 'Show fewer' : 'Show all ' + esc(rows.length)) + '</button>';
    return out + '</div>';
  }
  function loadAtRisk() {
    var want = st.subject, sort = st.arSort;
    st.ar = null; st.arError = '';
    return call('GET', '/tutor/atrisk?subject=' + encodeURIComponent(want) + '&sort=' + encodeURIComponent(sort)).then(function (r) {
      if (st.subject !== want || st.arSort !== sort) return;
      st.ar = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.arError = (e && e.message) || 'The at-risk list could not be loaded.'; draw();
    });
  }

  /* Top performers, slice 3: one card, two tabs (Web Tests / Practice), never blended. The server ranks and drops
     students under the evidence floor (GET /tutor/top); here we only draw it. Only the top three rows carry a rank
     number. Ten rows show at first, the rest sit behind Show all. Students held back for too little evidence are
     shown as a count only. Everything from the server is written escaped. */
  var TOP_SHOW = 10;
  function topCard() {
    var title = 'Top performers';
    if (st.topError) return '<div class="zx-card"><h3>' + title + '</h3><p>' + esc(st.topError) + '</p></div>';
    if (!st.top) return '<div class="zx-card zx-soon"><h3>' + title + '</h3><p>Loading…</p></div>';
    var tests = st.topTab !== 'practice', list = (tests ? st.top.tests : st.top.practice) || { items: [], hidden: 0 };
    var rows = list.items || [], hidden = Number(list.hidden) || 0;
    var out = '<div class="zx-card"><h3>' + title + ' in ' + esc(st.subject) + '</h3>' +
      '<p>GOC students taking this subject, highest first. Web Tests ranks the average of marked papers; Practice ranks the share of questions answered right.</p>' +
      '<div class="zx-chips" role="group" aria-label="List" style="margin:10px 0 8px">' +
      '<button type="button" class="zx-chip" data-act="toptab" data-tab="tests" aria-pressed="' + (tests ? 'true' : 'false') + '">Web Tests</button>' +
      '<button type="button" class="zx-chip" data-act="toptab" data-tab="practice" aria-pressed="' + (tests ? 'false' : 'true') + '">Practice</button></div>';
    if (!rows.length) out += '<p class="zx-ok">Nobody is ranked yet.</p>';
    else {
      var shown = st.topAll ? rows : rows.slice(0, TOP_SHOW);
      out += '<ul class="zx-ar zx-tplist">' + shown.map(function (x, i) {
        var fig = tests
          ? 'Average ' + esc(x.average) + '% over ' + esc(x.papers) + ' paper' + (x.papers === 1 ? '' : 's')
          : esc(x.percent) + '% right over ' + esc(x.answers) + ' answer' + (x.answers === 1 ? '' : 's');
        return '<li>' + (i < 3 ? '<span class="zx-rk">' + (i + 1) + '</span>' : '<span class="zx-rk0"></span>') +
          '<div><b>' + esc(x.name || x.id) + '</b> <span class="zx-arid">' + esc(x.id) + '</span><span class="zx-topfig">' + fig + '</span>' +
          '<button type="button" class="zx-btn zx-ghost zx-sm zx-open" data-act="stuopen" data-id="' + esc(x.id) + '">Open</button></div></li>';
      }).join('') + '</ul>';
      if (rows.length > TOP_SHOW) out += '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="topall">' + (st.topAll ? 'Show fewer' : 'Show all ' + esc(rows.length)) + '</button>';
    }
    if (hidden > 0) out += '<p style="margin-top:8px">' + esc(hidden) + ' student' + (hidden === 1 ? ' needs' : 's need') + ' more work to be ranked.</p>';
    return out + '</div>';
  }
  function loadTop() {
    var want = st.subject;
    st.top = null; st.topError = ''; st.topAll = false;
    return call('GET', '/tutor/top?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.top = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.topError = (e && e.message) || 'The top performers could not be loaded.'; draw();
    });
  }

  /* Student page and My views (Phase 3C). The page is for one student of the open subject; the server decides who may be
     opened (GET /tutor/student) and writes an audit entry for every open. Email and phone are not on the page: they come
     from a request of their own when the tutor taps Show contact (GET /tutor/student/contact), which is logged separately.
     The page never sorts or works anything out; it draws what the server sends, escaped. My views is a dashboard card with
     the tutor's own last 20 entries (GET /tutor/audit). */
  var AUDIT_SHOWN = 20;
  function pctText(v) { return v === null || v === undefined ? 'None yet' : esc(v) + '%'; }
  function studentHTML() {
    var x = st.stu, body;
    if (!x) {
      body = '<div class="zx-card"><p>' + esc(st.stuError || 'Loading…') + '</p></div>';
    } else {
      var t = x.tests || {}, p = x.practice || {}, w = x.weakTopics || { items: [], hidden: 0, minAnswers: 3 };
      var contact;
      if (st.stuContact) contact = '<div class="zx-kv"><span>Email</span><span>' + esc(st.stuContact.email || 'None on file') + '</span></div><div class="zx-kv"><span>Phone</span><span>' + esc(st.stuContact.phone || 'None on file') + '</span></div><p>Showing these was recorded in your views.</p>';
      else contact = (st.stuContactError ? '<p class="zx-warn">' + esc(st.stuContactError) + '</p>' : '') + '<p>Email and phone are hidden. Showing them is recorded in your views.</p><button type="button" class="zx-btn zx-ghost zx-sm" data-act="stucontact"' + (st.stuContactBusy ? ' disabled' : '') + '>' + (st.stuContactBusy ? 'Loading…' : 'Show contact') + '</button>';
      body = '<div class="zx-card"><h3>' + esc(x.name || x.id) + '</h3><p>' + esc(x.id) + ' · ' + esc(x.subject) + '</p>' +
        (x.active === false ? '<p class="zx-off">This account is switched off.</p>' : '') +
        '<p>' + (x.lastActiveAt ? 'Last practised or sat a test ' + esc(x.daysInactive) + ' day' + (x.daysInactive === 1 ? '' : 's') + ' ago (' + esc(whenText(x.lastActiveAt)) + ').' : 'Has not practised or sat a test in this subject yet.') + '</p></div>' +
        '<div class="zx-card"><h3>Contact</h3>' + contact + '</div>' +
        '<div class="zx-card"><h3>Scores in ' + esc(x.subject) + '</h3>' +
        '<div class="zx-kv"><span>Web Test average</span><span>' + (t.average === null || t.average === undefined ? 'None yet' : esc(t.average) + '% over ' + esc(t.papers) + ' paper' + (t.papers === 1 ? '' : 's')) + '</span></div>' +
        '<div class="zx-kv"><span>Last marked test</span><span>' + pctText(t.lastScore) + '</span></div>' +
        '<div class="zx-kv"><span>Practice</span><span>' + (p.percent === null || p.percent === undefined ? 'None yet' : esc(p.percent) + '% right over ' + esc(p.answers) + ' answer' + (p.answers === 1 ? '' : 's')) + '</span></div></div>' +
        '<div class="zx-card"><h3>Recent attempts</h3>' + ((x.recent || []).length ? '<ul class="zx-ar">' + x.recent.map(function (r) {
          return '<li><b>' + (r.kind === 'test' ? 'Test' + (r.section ? ' (' + esc(r.section) + ')' : '') : 'Practice') + '</b> <span class="zx-arid">' + esc(whenText(r.at)) + '</span><span class="zx-topfig">' +
            (r.kind === 'practice' ? esc(r.percent) + '% right over ' + esc(r.answers) + ' answer' + (r.answers === 1 ? '' : 's') :
              (r.percent === null ? 'Waiting for a mark' : esc(r.percent) + '%' + (r.score !== null && r.maxScore !== null ? ' (' + esc(r.score) + '/' + esc(r.maxScore) + ')' : ''))) + '</span></li>';
        }).join('') + '</ul>' : '<p>No attempts yet in this subject.</p>') + '</div>' +
        '<div class="zx-card"><h3>Weak topics</h3>' + (w.items.length ? '<ul class="zx-ar">' + w.items.map(function (r) {
          return '<li><b>' + esc(r.topic) + '</b><span class="zx-topfig">' + esc(r.percent) + '% right over ' + esc(r.answers) + ' answers</span></li>';
        }).join('') + '</ul>' : '<p>No topic has ' + esc(w.minAnswers) + '+ answers from this student yet.</p>') +
        (w.hidden > 0 ? '<p>' + esc(w.hidden) + ' topic' + (w.hidden === 1 ? ' has' : 's have') + ' too few answers to show.</p>' : '') + '</div>';
    }
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Student<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="stuback">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() + body + '</div></div>';
  }
  function openStudent(id) {
    st.stu = null; st.stuError = ''; st.stuId = String(id || ''); st.stuContact = null; st.stuContactError = ''; st.stuContactBusy = false;
    st.note = ''; st.view = 'student'; setError(''); draw();
    var want = st.subject, wantId = st.stuId;
    return call('GET', '/tutor/student?subject=' + encodeURIComponent(want) + '&id=' + encodeURIComponent(wantId)).then(function (r) {
      if (st.view !== 'student' || st.stuId !== wantId) return;
      st.stu = r.student; draw();
    }).catch(function (e) {
      if (st.stuId !== wantId) return;
      if (sessionProblem(e)) return;
      st.stuError = (e && e.message) || 'That student could not be opened.'; draw();
    });
  }
  function showContact() {
    if (st.stuContactBusy || st.stuContact || !st.stuId) return;
    var wantId = st.stuId;
    st.stuContactBusy = true; st.stuContactError = ''; draw();
    return call('GET', '/tutor/student/contact?subject=' + encodeURIComponent(st.subject) + '&id=' + encodeURIComponent(wantId)).then(function (r) {
      st.stuContactBusy = false;
      if (st.view !== 'student' || st.stuId !== wantId) return;
      st.stuContact = r.contact; draw();
    }).catch(function (e) {
      st.stuContactBusy = false;
      if (st.stuId !== wantId) return;
      if (sessionProblem(e)) return;
      st.stuContactError = (e && e.message) || 'The contact details could not be shown.'; draw();
    });
  }
  function leaveStudent() {
    st.view = 'dash'; st.stu = null; st.stuError = ''; st.stuId = ''; st.stuContact = null; st.stuContactError = ''; st.stuContactBusy = false;
    setError(''); draw(); loadAudit();
  }
  function auditCard() {
    var title = 'My views';
    if (st.auditError) return '<div class="zx-card"><h3>' + title + '</h3><p>' + esc(st.auditError) + '</p></div>';
    if (!st.audit) return '<div class="zx-card zx-soon"><h3>' + title + '</h3><p>Loading…</p></div>';
    var rows = st.audit.entries || [];
    var out = '<div class="zx-card"><h3>' + title + '</h3><p>Every time you open a student\'s page or show their contact details, the academy keeps a record for ' + esc(Math.round((st.audit.keptDays || 365) / 365 * 12)) + ' months. Only you and the academy can see yours.</p>';
    if (!rows.length) return out + '<p class="zx-ok">You have not opened a student yet.</p></div>';
    out += '<p>Your last ' + esc(Math.min(rows.length, AUDIT_SHOWN)) + (rows.length > AUDIT_SHOWN ? ' of ' + esc(rows.length) : '') + ':</p><ul class="zx-ar">' + rows.slice(0, AUDIT_SHOWN).map(function (r) {
      return '<li><b>' + esc(r.studentName || r.studentId) + '</b> <span class="zx-arid">' + esc(r.studentId) + ' · ' + esc(r.subject) + '</span><span class="zx-topfig">' +
        (r.kind === 'contact-view' ? 'Showed contact' : 'Opened page') + ' · ' + esc(whenText(r.at)) + '</span></li>';
    }).join('') + '</ul>';
    return out + '</div>';
  }
  function loadAudit() {
    st.audit = null; st.auditError = '';
    return call('GET', '/tutor/audit').then(function (r) {
      st.audit = r; draw();
    }).catch(function (e) {
      if (sessionProblem(e)) return;
      st.auditError = (e && e.message) || 'Your views could not be loaded.'; draw();
    });
  }

  /* ------------------------------------------------------------ Slice 6.2: questions
     A tutor types or imports questions for their own subject. Everything goes in as Awaiting
     approval; the admin approves or returns it. A live question can be withdrawn and put back. */
  var SECTION_NAMES = { objective: 'Objective', theory: 'Theory', jamb: 'JAMB-oriented', practice: 'Practice-only' };
  var STATUS_TEXT = { pending: 'Awaiting approval', live: 'Live', returned: 'Returned' };
  var CSV_HEAD = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation';

  function badgeFor(q) {
    var stt = q.status || 'live', cls = 'zx-b-' + stt, txt = STATUS_TEXT[stt] || stt;
    if (stt === 'live' && q.active === false) { cls = 'zx-b-off'; txt = 'Live, withdrawn'; }
    return '<span class="zx-badge ' + cls + '">' + esc(txt) + '</span>';
  }

  function questionsCard() {
    if (st.qError) return '<div class="zx-card"><h3>Your questions</h3><p>' + esc(st.qError) + '</p></div>';
    if (!st.qs) return '<div class="zx-card zx-soon"><h3>Your questions</h3><p>Loading…</p></div>';
    var c = st.qs.counts || {};
    function s2(label, n) { return '<div class="zx-stat"><b>' + esc(n || 0) + '</b>' + esc(label) + '</div>'; }
    return '<div class="zx-card"><h3>Your questions in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid">' + s2('Awaiting approval', c.pending) + s2('Live', c.live) + s2('Returned', c.returned) + '</div>' +
      '<p style="margin-top:10px">New and changed questions wait for the admin before students see them.</p>' +
      '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="qopen">Manage questions</button>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qnew">Add a question</button></div></div>';
  }

  function questionsHTML() {
    var list = (st.qs && st.qs.questions) || [], f = st.qFilter;
    var shown = list.filter(function (q) { return f === 'all' || (q.status || 'live') === f; });
    var chips = ['all', 'pending', 'live', 'returned'].map(function (k) {
      return '<button type="button" class="zx-chip" data-act="qfilter" data-filter="' + k + '" aria-pressed="' + (k === f ? 'true' : 'false') + '">' + (k === 'all' ? 'All' : STATUS_TEXT[k]) + '</button>';
    }).join('');
    var rows = shown.map(function (q) {
      var live = (q.status || 'live') === 'live';
      var acts = '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qedit" data-id="' + esc(q.id) + '">Edit</button>';
      if (live) acts += '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="' + (q.active === false ? 'qrepublish' : 'qwithdraw') + '" data-id="' + esc(q.id) + '">' + (q.active === false ? 'Put back live' : 'Withdraw') + '</button>';
      if (!live || q.active === false) acts += '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qdelete" data-id="' + esc(q.id) + '">Delete</button>';
      return '<div class="zx-card">' + badgeFor(q) + '<span class="zx-badge zx-b-off">' + esc(SECTION_NAMES[q.section] || q.section) + '</span>' +
        '<p class="zx-qtext">' + esc(String(q.text || '').slice(0, 220)) + '</p>' +
        (q.topic ? '<p>' + esc(q.topic) + '</p>' : '') +
        (q.status === 'returned' && q.returnReason ? '<p class="zx-why"><b>Returned:</b> ' + esc(q.returnReason) + '<br>Edit the question to send it back for approval.</p>' : '') +
        '<div class="zx-acts">' + acts + '</div></div>';
    }).join('');
    var empty = st.qError ? esc(st.qError) : (!st.qs ? 'Loading…' : (list.length ? 'Nothing with that status.' : 'You have not added any questions yet. Add one, or import a file.'));
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Questions<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qback">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() +
      '<div class="zx-acts" style="margin:0 0 14px"><button type="button" class="zx-btn zx-sm" data-act="qnew">Add a question</button>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qimport">Import a file</button></div>' +
      '<div class="zx-chips" role="group" aria-label="Status">' + chips + '</div>' +
      (rows || '<div class="zx-card"><p>' + empty + '</p></div>') + '</div></div>';
  }

  function blankForm() {
    return { id: null, section: 'objective', topic: '', text: '', options: ['', '', '', '', ''], answer: '0', expected: '', maxMark: '5', difficulty: 'medium', explanation: '', year: '' };
  }
  function formFrom(q) {
    var o = (q.options || []).slice(0, 5); while (o.length < 5) o.push('');
    return { id: q.id, section: q.section || 'objective', topic: q.topic || '', text: q.text || '', options: o, answer: String(q.answer == null ? 0 : q.answer),
      expected: q.expected || '', maxMark: String(q.maxMark || 5), difficulty: q.difficulty || 'medium', explanation: q.explanation || '', year: q.year ? String(q.year) : '' };
  }
  function fld(id, label, input) { return '<div class="zx-f"><label for="' + id + '">' + label + '</label>' + input + '</div>'; }
  function formHTML() {
    var f = st.form || blankForm(), theory = f.section === 'theory', i, optsHTML = '', ansOpts = '';
    for (i = 0; i < 5; i++) {
      optsHTML += fld('zxO' + i, 'Option ' + 'ABCDE'.charAt(i), '<input id="zxO' + i + '" type="text" value="' + esc(f.options[i]) + '">');
      ansOpts += '<option value="' + i + '"' + (String(f.answer) === String(i) ? ' selected' : '') + '>' + 'ABCDE'.charAt(i) + '</option>';
    }
    var secOpts = Object.keys(SECTION_NAMES).map(function (k) { return '<option value="' + k + '"' + (f.section === k ? ' selected' : '') + '>' + SECTION_NAMES[k] + '</option>'; }).join('');
    var dif = ['easy', 'medium', 'hard'].map(function (k) { return '<option value="' + k + '"' + (f.difficulty === k ? ' selected' : '') + '>' + k.charAt(0).toUpperCase() + k.slice(1) + '</option>'; }).join('');
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">' + (f.id ? 'Change a question' : 'New question') + '<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qcancel">Cancel</button></div>' +
      '<div class="zx-body">' + errHTML() +
      '<p class="zx-p">' + (f.id ? 'Saving sends this question back to the admin for approval.' : 'Students will see this question once the admin approves it.') + '</p>' +
      fld('zxSec', 'Section', '<select id="zxSec" data-act="qsection">' + secOpts + '</select>') +
      fld('zxTopic', 'Topic', '<input id="zxTopic" type="text" value="' + esc(f.topic) + '">') +
      fld('zxText', 'Question', '<textarea id="zxText">' + esc(f.text) + '</textarea>') +
      (theory ? fld('zxExp', 'Expected answer (what the marker compares against)', '<textarea id="zxExp">' + esc(f.expected) + '</textarea>') +
                fld('zxMax', 'Maximum mark', '<input id="zxMax" type="number" min="1" max="100" value="' + esc(f.maxMark) + '">')
              : optsHTML + fld('zxAns', 'Correct option', '<select id="zxAns">' + ansOpts + '</select>')) +
      fld('zxDif', 'Difficulty', '<select id="zxDif">' + dif + '</select>') +
      (f.section === 'practice' ? fld('zxYear', 'Exam year (optional)', '<input id="zxYear" type="number" value="' + esc(f.year) + '">') : '') +
      fld('zxEx', 'Explanation (optional)', '<textarea id="zxEx">' + esc(f.explanation) + '</textarea>') +
      '<button type="button" class="zx-btn" data-act="qsave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : (f.id ? 'Save and send for approval' : 'Send for approval')) + '</button>' +
      '</div></div>';
  }
  function readForm() {
    var f = st.form || blankForm(), i, o = [];
    f.section = val('zxSec') || f.section;
    f.topic = val('zxTopic'); f.text = val('zxText'); f.difficulty = val('zxDif') || 'medium'; f.explanation = val('zxEx');
    if (f.section === 'theory') { f.expected = val('zxExp'); f.maxMark = val('zxMax'); }
    else { for (i = 0; i < 5; i++) o.push(val('zxO' + i)); f.options = o; f.answer = val('zxAns') || '0'; }
    if (f.section === 'practice') f.year = val('zxYear');
    st.form = f; return f;
  }
  function formBody(f) {
    var b = { subject: st.subject, section: f.section, topic: f.topic, text: f.text, difficulty: f.difficulty, explanation: f.explanation };
    if (f.section === 'theory') { b.expected = f.expected; b.maxMark = Number(f.maxMark); }
    else { b.options = f.options; b.answer = Number(f.answer); }
    if (f.section === 'practice' && f.year) b.year = Number(f.year);
    return b;
  }

  function importHTML() {
    var m = st.imp || {}, secOpts = '<option value="">Use the section column in my file</option>' + Object.keys(SECTION_NAMES).map(function (k) { return '<option value="' + k + '"' + (m.section === k ? ' selected' : '') + '>Put every row in ' + SECTION_NAMES[k] + '</option>'; }).join('');
    var res = '';
    if (m.result) {
      res = '<div class="zx-note" role="status">' + esc(m.result.added) + ' question' + (m.result.added === 1 ? '' : 's') + ' sent for approval' + (m.result.skipped ? ', ' + esc(m.result.skipped) + ' skipped' : '') + '.</div>';
      if (m.result.errors && m.result.errors.length) res += '<div class="zx-card"><h3>Skipped rows</h3><ul class="zx-rank">' + m.result.errors.slice(0, 8).map(function (e) { return '<li>' + esc(typeof e === 'string' ? e : (e.line ? 'Line ' + e.line + ': ' : '') + (e.error || e.message || '')) + '</li>'; }).join('') + '</ul></div>';
    }
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Import questions<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="qcancel">Back</button></div>' +
      '<div class="zx-body">' + errHTML() + res +
      kitCardHTML() +
      '<p class="zx-p">Open a CSV file or paste it below. Every row must be for ' + esc(st.subject) + '. Columns: ' + esc(CSV_HEAD) + '. Imported questions wait for the admin like any other.</p>' +
      fld('zxFile', 'CSV file', '<input id="zxFile" type="file" accept=".csv,text/csv,text/plain" data-act="qfile">') +
      fld('zxCsv', 'Or paste the rows here', '<textarea id="zxCsv" style="min-height:160px">' + esc(m.csv || '') + '</textarea>') +
      fld('zxImpSec', 'Section', '<select id="zxImpSec">' + secOpts + '</select>') +
      '<button type="button" class="zx-btn" data-act="qimportgo"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : 'Import for approval') + '</button>' +
      '</div></div>';
  }

  /* 4.D: the question-writing kit card on the Import screen. The brief and the
     template come from GOC.core (the same columns the importer reads), so they
     cannot drift from what the import box accepts. */
  function kitCardHTML() {
    var topics = (st.imp && st.imp.topics) || '';
    return '<div class="zx-card"><h3>Write questions with your own AI</h3>' +
      '<p class="zx-p">Paste a ready-made brief into Claude, ChatGPT or similar with your material (notes, a past paper, photos). It returns CSV in exactly the format below, which you paste into the box here. The admin still approves every question.</p>' +
      fld('zxKitTopics', 'Topics to set questions from (comma-separated)', '<input id="zxKitTopics" value="' + esc(topics) + '" placeholder="e.g. Acids and bases, Stoichiometry">') +
      '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="kitcopy">Copy instructions for an AI</button>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="kittpl">Download template</button></div>' +
      '<ol class="zx-rank"><li>Tap <b>Copy instructions for an AI</b>.</li>' +
      '<li>Open your AI. Paste the instructions, then attach your PDF, Word file or photo, or paste your notes.</li>' +
      '<li>Check every question and answer. Fix anything wrong.</li>' +
      '<li>Paste the CSV it gives you into the box below and tap <b>Import for approval</b>.</li></ol></div>';
  }
  function kitCore() { return (typeof window !== 'undefined' && window.GOC && window.GOC.core) || null; }
  function kitFallbackCopy(text) {
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {}
  }
  function copyKit() {
    var topics = (document.getElementById('zxKitTopics') || {}).value || '';
    st.imp = st.imp || {}; st.imp.topics = topics;
    var core = kitCore();
    if (!core || !core.tutorKitInstructions) { setError('The kit needs the main app loaded. Reload and try again.'); draw(); return; }
    var text = core.tutorKitInstructions({ subject: st.subject, topics: topics });
    var done = function () { st.note = 'Instructions copied — paste them into your AI with your material.'; draw(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { kitFallbackCopy(text); done(); });
    } else { kitFallbackCopy(text); done(); }
  }
  function downloadKitTemplate() {
    var core = kitCore(); if (!core || !core.tutorKitTemplate) { setError('The kit needs the main app loaded.'); draw(); return; }
    try {
      var blob = new Blob([core.tutorKitTemplate()], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'goc-question-template.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { setError('Could not build the template file.'); draw(); }
  }

  function goQuestions() { st.view = 'questions'; st.form = null; st.imp = null; setError(''); draw(); }
  function qById(id) { var l = (st.qs && st.qs.questions) || [], i; for (i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function afterChange(msg) { st.busy = false; st.note = msg; st.view = 'questions'; st.form = null; st.imp = null; setError(''); draw(); loadQuestions(); }
  function failed(e) { st.busy = false; if (!sessionProblem(e)) { setError((e && e.message) || 'That did not work.'); draw(); } }

  function saveQuestion() {
    var f = readForm();
    st.busy = true; setError(''); draw();
    var p = f.id ? call('PUT', '/tutor/questions/' + encodeURIComponent(f.id), formBody(f)) : call('POST', '/tutor/questions', formBody(f));
    p.then(function () { afterChange('Sent for approval. Students will see it once the admin approves it.'); }).catch(failed);
  }
  function runImport() {
    var csv = val('zxCsv'), sec = val('zxImpSec');
    st.imp = { csv: csv, section: sec };
    if (!csv.trim()) { setError('Choose a file or paste some rows first.'); draw(); return; }
    st.busy = true; setError(''); draw();
    call('POST', '/tutor/questions/import', { csv: csv, subject: st.subject, section: sec, stampSection: !!sec }).then(function (r) {
      st.busy = false; st.imp = { csv: '', section: sec, result: r }; setError(''); draw(); loadQuestions();
    }).catch(failed);
  }
  function simple(method, path, body, msg) {
    return call(method, path, body).then(function () { afterChange(msg); }).catch(failed);
  }

  /* Slice 6.5: the tutor's own notes. A note goes live as soon as it is saved (no approval); the
     tutor can hold it back, put it back, change it, or delete one that is held back. */
  function notesCard() {
    if (st.nError) return '<div class="zx-card"><h3>Your notes</h3><p>' + esc(st.nError) + '</p></div>';
    if (!st.ns) return '<div class="zx-card zx-soon"><h3>Your notes</h3><p>Loading…</p></div>';
    var c = st.ns.counts || {};
    function s2(label, n) { return '<div class="zx-stat"><b>' + esc(n || 0) + '</b>' + esc(label) + '</div>'; }
    return '<div class="zx-card"><h3>Your notes in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid">' + s2('Live', c.live) + s2('Held back', c.held) + '</div>' +
      '<p style="margin-top:10px">A note you save is readable by students straight away.</p>' +
      '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="nopen">Manage notes</button>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="nnew">Write a note</button></div></div>';
  }
  function notesHTML() {
    var list = (st.ns && st.ns.notes) || [];
    var rows = list.map(function (n) {
      var live = n.active !== false, id = esc(n.id);
      var acts = '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="nedit" data-id="' + id + '">Edit</button>' +
        '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="' + (live ? 'nhold' : 'nlive') + '" data-id="' + id + '">' + (live ? 'Hold back' : 'Put back live') + '</button>' +
        (live ? '' : '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="ndelete" data-id="' + id + '">Delete</button>');
      return '<div class="zx-card"><span class="zx-badge ' + (live ? 'zx-b-live' : 'zx-b-off') + '">' + (live ? 'Live' : 'Held back') + '</span>' +
        (n.topic ? '<span class="zx-badge zx-b-off">' + esc(n.topic) + '</span>' : '') +
        '<p class="zx-qtext">' + esc(n.title) + '</p>' +
        '<p>' + esc(String(n.body || '').slice(0, 160)) + (String(n.body || '').length > 160 ? '…' : '') + '</p>' +
        '<div class="zx-acts">' + acts + '</div></div>';
    }).join('');
    var empty = st.nError ? esc(st.nError) : (!st.ns ? 'Loading…' : 'You have not written any notes yet.');
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Notes<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="nback">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() +
      '<div class="zx-acts" style="margin:0 0 14px"><button type="button" class="zx-btn zx-sm" data-act="nnew">Write a note</button></div>' +
      (rows || '<div class="zx-card"><p>' + empty + '</p></div>') + '</div></div>';
  }
  function blankNote() { return { id: null, topic: '', title: '', body: '' }; }
  function noteFormHTML() {
    var f = st.nForm || blankNote();
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">' + (f.id ? 'Change a note' : 'New note') + '<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="ncancel">Cancel</button></div>' +
      '<div class="zx-body">' + errHTML() +
      '<p class="zx-p">Students will be able to read this as soon as you save it. Write a formula between dollar signs, like $x^2 + 1$.</p>' +
      fld('zxNTopic', 'Topic (what students pick)', '<input id="zxNTopic" type="text" value="' + esc(f.topic) + '">') +
      fld('zxNTitle', 'Title', '<input id="zxNTitle" type="text" value="' + esc(f.title) + '">') +
      fld('zxNBody', 'The note', '<textarea id="zxNBody" style="min-height:220px">' + esc(f.body) + '</textarea>') +
      '<button type="button" class="zx-btn" data-act="nsave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : (f.id ? 'Save changes' : 'Save and publish')) + '</button>' +
      '</div></div>';
  }
  function readNoteForm() {
    var f = st.nForm || blankNote();
    f.topic = val('zxNTopic'); f.title = val('zxNTitle'); f.body = val('zxNBody');
    st.nForm = f; return f;
  }
  function nById(id) { var l = (st.ns && st.ns.notes) || [], i; for (i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function goNotes() { st.view = 'notes'; st.nForm = null; setError(''); draw(); }
  function afterNote(msg) { st.busy = false; st.note = msg; st.view = 'notes'; st.nForm = null; setError(''); draw(); loadNotes(); loadSubjectDepth(); }
  function saveNote() {
    var f = readNoteForm(), b = { subject: st.subject, topic: f.topic, title: f.title, body: f.body };
    st.busy = true; setError(''); draw();
    var p = f.id ? call('PUT', '/tutor/notes/' + encodeURIComponent(f.id), b) : call('POST', '/tutor/notes', b);
    p.then(function () { afterNote(f.id ? 'Saved.' : 'Saved. Students can read it now.'); }).catch(failed);
  }
  function noteSimple(method, path, body, msg) {
    return call(method, path, body).then(function () { afterNote(msg); }).catch(failed);
  }
  function loadNotes() {
    var want = st.subject;
    st.ns = null; st.nError = '';
    return call('GET', '/tutor/notes?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.ns = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.nError = (e && e.message) || 'Your notes could not be loaded.'; draw();
    });
  }
  /* Slice 7: class notices. A notice is read by GOC students taking this subject, straight away, and it stays
     until the tutor removes it. The admin is told when a notice is NEW; changing one tells nobody. */
  function noticesCard() {
    if (st.ntError) return '<div class="zx-card"><h3>Class notices</h3><p>' + esc(st.ntError) + '</p></div>';
    if (!st.nt) return '<div class="zx-card zx-soon"><h3>Class notices</h3><p>Loading…</p></div>';
    return '<div class="zx-card"><h3>Class notices in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid"><div class="zx-stat"><b>' + esc(st.nt.count || 0) + '</b>Showing now</div></div>' +
      '<p style="margin-top:10px">GOC students taking ' + esc(st.subject) + ' see a notice as soon as you post it. It stays until you remove it.</p>' +
      '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="topen">Manage notices</button>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="tnew">Post a notice</button></div></div>';
  }
  function noticesHTML() {
    var list = (st.nt && st.nt.notices) || [];
    var rows = list.map(function (n) {
      var id = esc(n.id);
      return '<div class="zx-card"><span class="zx-badge zx-b-live">Showing</span>' +
        '<span class="zx-badge zx-b-off">' + esc(whenText(Date.parse(n.addedAt))) + (n.editedAt ? ' · edited' : '') + '</span>' +
        '<p class="zx-qtext">' + esc(n.title) + '</p>' +
        '<p>' + esc(String(n.body || '').slice(0, 200)) + (String(n.body || '').length > 200 ? '…' : '') + '</p>' +
        '<div class="zx-acts"><button type="button" class="zx-btn zx-ghost zx-sm" data-act="tedit" data-id="' + id + '">Edit</button>' +
        '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="tremove" data-id="' + id + '">Remove</button></div></div>';
    }).join('');
    var empty = st.ntError ? esc(st.ntError) : (!st.nt ? 'Loading…' : 'You have no notices showing.');
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Class notices<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="tback">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() +
      '<div class="zx-acts" style="margin:0 0 14px"><button type="button" class="zx-btn zx-sm" data-act="tnew">Post a notice</button></div>' +
      (rows || '<div class="zx-card"><p>' + empty + '</p></div>') + '</div></div>';
  }
  function blankNotice() { return { id: null, title: '', body: '' }; }
  function noticeFormHTML() {
    var f = st.ntForm || blankNotice();
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">' + (f.id ? 'Change a notice' : 'New notice') + '<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="tcancel">Cancel</button></div>' +
      '<div class="zx-body">' + errHTML() +
      '<p class="zx-p">' + (f.id
        ? 'Students see the change straight away. Nobody is told about a change.'
        : 'GOC students taking ' + esc(st.subject) + ' will see this as soon as you post it, and it stays until you remove it. The academy is told that you posted it.') + '</p>' +
      fld('zxTTitle', 'Title (up to 80 characters)', '<input id="zxTTitle" type="text" maxlength="80" value="' + esc(f.title) + '">') +
      fld('zxTBody', 'The notice (up to 1000 characters)', '<textarea id="zxTBody" maxlength="1000" style="min-height:160px">' + esc(f.body) + '</textarea>') +
      '<button type="button" class="zx-btn" data-act="tsave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Please wait…' : (f.id ? 'Save changes' : 'Post notice')) + '</button>' +
      '</div></div>';
  }
  function readNoticeForm() {
    var f = st.ntForm || blankNotice();
    f.title = val('zxTTitle'); f.body = val('zxTBody');
    st.ntForm = f; return f;
  }
  function ntById(id) { var l = (st.nt && st.nt.notices) || [], i; for (i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function goNotices() { st.view = 'notices'; st.ntForm = null; setError(''); draw(); }
  function afterNotice(msg) { st.busy = false; st.note = msg; st.view = 'notices'; st.ntForm = null; setError(''); draw(); loadNotices(); }
  function saveNotice() {
    var f = readNoticeForm(), b = { subject: st.subject, title: f.title, body: f.body };
    st.busy = true; setError(''); draw();
    var p = f.id ? call('PUT', '/tutor/notices/' + encodeURIComponent(f.id), b) : call('POST', '/tutor/notices', b);
    p.then(function () { afterNotice(f.id ? 'Saved.' : 'Posted. Students can see it now.'); }).catch(failed);
  }
  /* Phase 4.A slice 6: questions students flagged in this subject (Ask a tutor). The tutor replies or
     closes; the subject scope is enforced on the server. A reply shows on the student's Home as from
     "<Subject> tutor"; the student's name and Scholar ID are shown here, as on the at-risk list. */
  function flagsCard() {
    if (st.fgError) return '<div class="zx-card"><h3>Questions from students</h3><p>' + esc(st.fgError) + '</p></div>';
    if (!st.fg) return '<div class="zx-card zx-soon"><h3>Questions from students</h3><p>Loading…</p></div>';
    var all = (st.fg.flags) || [];
    var open = all.filter(function (f) { return f.status === 'open'; });
    var answered = all.filter(function (f) { return f.status === 'answered'; });
    var rows = open.concat(answered).map(function (f) {
      var acts = f.status === 'closed' ? '' :
        '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="fgreply" data-id="' + esc(f.id) + '">Reply</button>' +
        '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="fgclose" data-id="' + esc(f.id) + '">Close</button></div>';
      var reply = f.reply ? '<p class="zx-p"><b>Your reply:</b> ' + esc(f.reply.text) + '</p>' : '';
      return '<div class="zx-card"><span class="zx-badge ' + (f.status === 'answered' ? 'zx-b-live' : 'zx-b-pending') + '">' + esc(f.status === 'answered' ? 'Answered' : 'Waiting') + '</span>' +
        '<p class="zx-p" style="font-size:.8rem;color:#777">' + esc(f.reasonLabel || '') + ' · ' + esc(f.studentName || '') + ' (' + esc(f.studentId || '') + ')</p>' +
        '<p class="zx-p">' + esc(f.questionText || '') + '</p>' +
        (f.note ? '<p class="zx-p">“' + esc(f.note) + '”</p>' : '') + reply + acts + '</div>';
    }).join('');
    return '<div class="zx-card"><h3>Questions from students in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid"><div class="zx-stat"><b>' + open.length + '</b>Waiting</div><div class="zx-stat"><b>' + answered.length + '</b>Answered</div></div>' +
      (rows || '<p class="zx-p">No questions from students here yet.</p>') + '</div>';
  }
  function loadFlags() {
    var want = st.subject;
    st.fg = null; st.fgError = '';
    return call('GET', '/tutor/flags?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.fg = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.fgError = (e && e.message) || 'The questions could not be loaded.'; draw();
    });
  }
  function replyFlag(id) {
    var text = window.prompt('Your reply (the student sees it as from the subject tutor):');
    if (text == null) return;
    call('POST', '/tutor/flags/' + encodeURIComponent(id) + '/reply', { text: text })
      .then(function () { st.note = 'Reply sent.'; loadFlags(); })
      .catch(function (e) { if (!sessionProblem(e)) { setError((e && e.message) || 'Could not send that reply.'); draw(); } });
  }
  function closeFlag(id) {
    if (!window.confirm('Close this question? The student can ask again if they still need help.')) return;
    call('POST', '/tutor/flags/' + encodeURIComponent(id) + '/close', {})
      .then(function () { st.note = 'Closed.'; loadFlags(); })
      .catch(function (e) { if (!sessionProblem(e)) { setError((e && e.message) || 'Could not close it.'); draw(); } });
  }
  function loadNotices() {
    var want = st.subject;
    st.nt = null; st.ntError = '';
    return call('GET', '/tutor/notices?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.nt = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.ntError = (e && e.message) || 'Your notices could not be loaded.'; draw();
    });
  }
  /* Slice 6.6: theory scripts. The tutor marks any theory script in their own subject, marked or not. A mark
     counts as soon as it is saved (no approval); the admin gets an alert once a script is fully marked. The
     subject comes from the script on the server, so a script from another subject is simply refused. */
  function whenText(ms) { var d = new Date(Number(ms)); return isFinite(d.getTime()) ? d.toISOString().slice(0, 16).replace('T', ' ') : ''; }
  function scriptsCard() {
    if (st.scError) return '<div class="zx-card"><h3>Theory scripts</h3><p>' + esc(st.scError) + '</p></div>';
    if (!st.sc) return '<div class="zx-card zx-soon"><h3>Theory scripts</h3><p>Loading…</p></div>';
    var c = st.sc.counts || {};
    function s3(label, n) { return '<div class="zx-stat"><b>' + esc(n || 0) + '</b>' + esc(label) + '</div>'; }
    return '<div class="zx-card"><h3>Theory scripts in ' + esc(st.subject) + '</h3>' +
      '<div class="zx-grid">' + s3('Waiting for a mark', c.waiting) + s3('Marked', c.marked) + '</div>' +
      '<p style="margin-top:10px">A mark you save counts straight away. The admin is told when a script is fully marked.</p>' +
      '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="sopen">Mark scripts</button></div></div>';
  }
  function scriptsHTML() {
    var all = (st.sc && st.sc.scripts) || [], c = (st.sc && st.sc.counts) || {};
    var list = all.filter(function (x) { return !st.scFilter || (st.scFilter === 'marked' ? x.status === 'marked' : x.status !== 'marked'); });
    function chip(f, label) { return '<button type="button" class="zx-chip" data-act="sfilter" data-filter="' + f + '" aria-pressed="' + (st.scFilter === f ? 'true' : 'false') + '">' + label + '</button>'; }
    var rows = list.map(function (x) {
      var done = x.status === 'marked';
      return '<div class="zx-card"><span class="zx-badge ' + (done ? 'zx-b-live' : 'zx-b-pending') + '">' + (done ? 'Marked' : 'Waiting for a mark') + '</span>' +
        '<p class="zx-qtext">Script ' + esc(x.id) + ' · ' + esc(x.scholarId) + '</p>' +
        '<p>' + esc(whenText(x.submittedAt)) + ' · ' + esc(x.marked) + ' of ' + esc(x.written) + ' written answers marked' + (done && x.percent !== null && x.percent !== undefined ? ' · ' + esc(x.score) + '/' + esc(x.maxScore) + ' (' + esc(x.percent) + '%)' : '') + '</p>' +
        '<div class="zx-acts"><button type="button" class="zx-btn zx-sm" data-act="sview" data-id="' + esc(x.id) + '">' + (done ? 'Open or change marks' : 'Mark') + '</button></div></div>';
    }).join('');
    var empty = st.scError ? esc(st.scError) : (!st.sc ? 'Loading…' : (st.scFilter === 'marked' ? 'No script has been marked yet.' : (st.scFilter === 'awaiting-marking' ? 'Nothing is waiting for a mark.' : 'No student has sat a theory paper in this subject yet.')));
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Theory scripts<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="sback">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() +
      '<div class="zx-chips" role="group" aria-label="Show">' + chip('awaiting-marking', 'Waiting (' + esc(c.waiting || 0) + ')') + chip('marked', 'Marked (' + esc(c.marked || 0) + ')') + chip('', 'All') + '</div>' +
      (rows || '<div class="zx-card"><p>' + empty + '</p></div>') + '</div></div>';
  }
  function scriptHTML() {
    var x = st.script;
    var body;
    if (!x) {
      body = '<div class="zx-card"><p>' + esc(st.scriptError || 'Loading…') + '</p></div>';
    } else {
      body = '<div class="zx-card"><span class="zx-badge ' + (x.status === 'marked' ? 'zx-b-live' : 'zx-b-pending') + '">' + (x.status === 'marked' ? 'Marked' : 'Waiting for a mark') + '</span>' +
        '<p>' + esc(x.scholarId) + ' · ' + esc(whenText(x.submittedAt)) + (x.status === 'marked' ? ' · ' + esc(x.score) + '/' + esc(x.maxScore) + ' (' + esc(x.percent) + '%)' : '') + '</p>' +
        '<p class="zx-warn">A mark you save counts at once. Leave a box empty to mark it later; the script is fully marked only when every answer has a mark.</p></div>' +
        (x.answers || []).map(function (r, i) {
          return '<div class="zx-card"><p class="zx-qtext"><b>' + (i + 1) + '.</b> ' + esc(r.text) + '</p>' +
            '<p><b>Reference answer</b></p><p class="zx-qtext">' + esc(r.expected || 'None given.') + '</p>' +
            '<p><b>Student\'s answer</b></p><p class="zx-qtext" style="white-space:pre-wrap">' + esc(r.given || '(left blank)') + '</p>' +
            '<div class="zx-f"><label for="zxM' + esc(r.questionId) + '">Mark out of ' + esc(r.maxMark) + '</label>' +
            '<input id="zxM' + esc(r.questionId) + '" type="number" inputmode="decimal" min="0" max="' + esc(r.maxMark) + '" step="0.5" data-qid="' + esc(r.questionId) + '" value="' + (r.markAwarded === null || r.markAwarded === undefined ? '' : esc(r.markAwarded)) + '"></div></div>';
        }).join('') +
        '<div class="zx-acts"><button type="button" class="zx-btn" data-act="ssave"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Saving…' : 'Save marks') + '</button></div>';
    }
    return '<div class="zx-full"><div class="zx-top"><div class="zx-who">Mark script<b>' + esc(st.subject) + '</b></div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="sclose">Back</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() + body + '</div></div>';
  }
  function goScripts() { st.view = 'scripts'; st.script = null; st.scriptError = ''; setError(''); draw(); loadScripts(); }
  function loadScripts() {
    var want = st.subject;
    st.scError = '';
    return call('GET', '/tutor/scripts?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.sc = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.scError = (e && e.message) || 'Your scripts could not be loaded.'; draw();
    });
  }
  function openScript(id, msg) {
    st.script = null; st.scriptError = ''; st.note = msg || ''; st.view = 'script'; setError(''); draw();
    return call('GET', '/tutor/scripts/' + encodeURIComponent(id)).then(function (r) {
      st.script = r; draw();
    }).catch(function (e) {
      if (sessionProblem(e)) return;
      st.scriptError = (e && e.message) || 'That script could not be opened.'; draw();
    });
  }
  function saveMarks() {
    if (st.busy || !st.script) return;
    var marks = {}, bad = '', inputs = root ? root.querySelectorAll('input[data-qid]') : [], i, el, v;
    for (i = 0; i < inputs.length; i++) {
      el = inputs[i]; v = String(el.value == null ? '' : el.value).trim();
      if (v === '') continue;
      if (isNaN(Number(v)) || Number(v) < 0) { bad = 'Every mark must be a number, zero or more.'; break; }
      marks[el.getAttribute('data-qid')] = Number(v);
    }
    if (bad) { setError(bad); draw(); return; }
    var id = st.script.id;
    st.busy = true; setError(''); draw();
    return call('POST', '/tutor/scripts/' + encodeURIComponent(id) + '/mark', { marks: marks }).then(function (r) {
      st.busy = false;
      var msg = r.status === 'marked'
        ? 'Saved. The script is fully marked: ' + r.score + '/' + r.maxScore + ' (' + r.percent + '%). The admin has been told.'
        : 'Saved. ' + r.marked + ' of ' + r.written + ' answers marked. The admin is told once every answer has a mark.';
      loadScripts();
      return openScript(id, msg);
    }).catch(function (e) { st.busy = false; if (!sessionProblem(e)) { setError((e && e.message) || 'That did not work.'); draw(); } });
  }

  /* Refresh just the paper-depth card after a note is added or removed. */
  function loadSubjectDepth() {
    var want = st.subject;
    return call('GET', '/tutor/subject?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject === want) { st.info = r; draw(); }
    }).catch(function () {});
  }


  function dashHTML() {
    var u = st.user || {}, subs = u.subjects || [], chips = '';
    if (subs.length > 1) {
      chips = '<div class="zx-chips" role="group" aria-label="Subject">' + subs.map(function (sj) {
        return '<button type="button" class="zx-chip" data-act="subject" data-subject="' + esc(sj) + '" aria-pressed="' + (sj === st.subject ? 'true' : 'false') + '">' + esc(sj) + '</button>';
      }).join('') + '</div>';
    }
    return '<div class="zx-full">' +
      '<div class="zx-top"><div class="zx-who">Signed in<b>' + esc(u.name) + '</b>' + esc(u.id) + '</div>' +
      '<button type="button" class="zx-btn zx-ghost zx-sm" data-act="signout">Sign out</button></div>' +
      '<div class="zx-body">' + noteHTML() + errHTML() +
      '<h2 class="zx-h">' + esc(st.subject || 'Dashboard') + '</h2>' +
      '<p class="zx-p">' + (subs.length > 1 ? 'Pick a subject. Each one has its own dashboard.' : 'Your subject dashboard.') + '</p>' +
      chips + depthCard() +
      questionsCard() +
      notesCard() +
      noticesCard() +
      flagsCard() +
      scriptsCard() +
      snapshotCard() +
      activityCard() +
      atRiskCard() +
      topCard() +
      weakCard() + hardCard() +
      auditCard() +
      '</div></div>';
  }

  function draw() {
    if (!root) return;
    root.className = 'zx-wrap' + (st.view !== 'signin' || st.shown ? ' zx-in' : '');
    root.innerHTML = st.view === 'signin' ? signinHTML() : (st.view === 'password' ? passwordHTML() :
      (st.view === 'questions' ? questionsHTML() : (st.view === 'qform' ? formHTML() : (st.view === 'qimport' ? importHTML() : (st.view === 'notes' ? notesHTML() : (st.view === 'nform' ? noteFormHTML() : (st.view === 'notices' ? noticesHTML() : (st.view === 'ntform' ? noticeFormHTML() : (st.view === 'scripts' ? scriptsHTML() : (st.view === 'script' ? scriptHTML() : (st.view === 'student' ? studentHTML() : dashHTML())))))))))));
    if (st.view === 'signin') {
      /* the sheet slides in once; later redraws (an error message) keep it in place */
      if (!st.shown) setTimeout(function () { st.shown = true; if (root) root.className = 'zx-wrap zx-in'; }, 20);
      var f = root.querySelector(st.idDraft ? '#zxPw' : '#zxId'); if (f && f.focus) f.focus();
    }
  }

  function val(id) { var e = root && root.querySelector('#' + id); return e ? e.value : ''; }
  function setError(m) { st.error = m || ''; }

  /* --------------------------------------------------------------- behaviour */
  /* Slice 5.2: the numbers for the open subject. A late answer for a subject the tutor has
     since left is thrown away, and a failure here shows on the snapshot card only. */
  function loadStats() {
    var want = st.subject;
    st.stats = null; st.statsError = '';
    return call('GET', '/tutor/analytics?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.stats = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.statsError = (e && e.message) || 'The numbers could not be loaded.'; draw();
    });
  }

  /* Slice 6.2: the tutor's own questions for the open subject, with their approval status. */
  function loadQuestions() {
    var want = st.subject;
    st.qs = null; st.qError = '';
    return call('GET', '/tutor/questions?subject=' + encodeURIComponent(want)).then(function (r) {
      if (st.subject !== want) return;
      st.qs = r; draw();
    }).catch(function (e) {
      if (st.subject !== want) return;
      if (sessionProblem(e)) return;
      st.qError = (e && e.message) || 'Your questions could not be loaded.'; draw();
    });
  }

  function loadSubject(back, keepError) {
    st.info = null;
    draw();
    return call('GET', '/tutor/subject?subject=' + encodeURIComponent(st.subject)).then(function (r) {
      st.info = r; if (!keepError) setError(''); draw();
      loadStats();
      loadAtRisk();
      loadTop();
      loadAudit();
      loadQuestions();
      loadNotes();
      loadNotices();
      loadScripts();
      loadFlags();
    }).catch(function (e) {
      if (sessionProblem(e)) return;
      /* a refusal for one subject is not the end of the session: say so and stay where we were */
      if (back) st.subject = back;
      setError(e && e.message);
      if (back) loadSubject(null, true); else draw();
    });
  }

  /* An ended session, a switched-off account or a still-pending password change cannot carry on:
     they go back to sign-in (or the password screen) with the server's reason. Returns true when
     it handled the error. */
  function sessionProblem(e) {
    var m = (e && e.message) || '';
    if (e && e.status === 403 && /new password/i.test(m)) { st.view = 'password'; st.busy = false; setError(m); draw(); return true; }
    if (e && (e.status === 401 || (e.status === 403 && /switched off|no longer available|accounts only/i.test(m)))) {
      st.token = null; st.user = null; st.info = null; st.stats = null; st.statsError = ''; st.qs = null; st.qError = ''; st.form = null; st.imp = null; st.ns = null; st.nError = ''; st.nForm = null; st.nt = null; st.ntError = ''; st.ntForm = null; st.sc = null; st.scError = ''; st.script = null; st.scriptError = ''; st.ar = null; st.arError = ''; st.arSort = 'inactive'; st.arAll = false; st.top = null; st.topError = ''; st.topTab = 'tests'; st.topAll = false; st.stu = null; st.stuError = ''; st.stuId = ''; st.stuContact = null; st.stuContactError = ''; st.stuContactBusy = false; st.audit = null; st.auditError = ''; st.view = 'signin'; st.busy = false;
      setError(m); draw(); return true;
    }
    return false;
  }

  function enter(user) {
    st.user = user;
    st.subject = (user.subjects && user.subjects[0]) || '';
    if (user.mustChangePassword) { st.view = 'password'; setError(''); draw(); return; }
    st.view = 'dash'; setError(''); draw();
    loadSubject();
  }

  function signin() {
    var id = val('zxId').trim(), pw = val('zxPw');
    st.idDraft = id;
    if (!id || !pw) { setError('Enter your ID and password.'); draw(); return; }
    st.busy = true; setError(''); draw();
    call('POST', '/tutor/login', { id: id, password: pw }).then(function (r) {
      st.busy = false; st.token = r.token; st.idDraft = ''; enter(r.user);
    }).catch(function (e) { st.busy = false; setError(e.message); draw(); });
  }

  function setpw() {
    var cur = val('zxCur'), n1 = val('zxNew'), n2 = val('zxNew2');
    if (!cur || !n1) { setError('Fill in all three boxes.'); draw(); return; }
    if (n1.length < PW_MIN) { setError('Choose a password of at least ' + PW_MIN + ' characters.'); draw(); return; }
    if (n1 !== n2) { setError('The two new passwords do not match.'); draw(); return; }
    st.busy = true; setError(''); draw();
    call('POST', '/tutor/password', { currentPassword: cur, newPassword: n1 }).then(function () {
      st.busy = false;
      st.user.mustChangePassword = false;
      st.note = 'Password saved.';
      st.view = 'dash'; draw(); loadSubject();
    }).catch(function (e) { st.busy = false; if (!sessionProblem(e)) { setError(e.message); draw(); } });
  }

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; st.shown = false; st.idDraft = '';
    var f = document.getElementById('loginId'); if (f && f.focus) f.focus();
  }

  function signout() {
    var t = st.token;
    st.token = null; st.user = null; st.info = null; st.stats = null; st.statsError = ''; st.note = ''; st.qs = null; st.qError = ''; st.form = null; st.imp = null; st.ns = null; st.nError = ''; st.nForm = null; st.sc = null; st.scError = ''; st.script = null; st.scriptError = ''; st.ar = null; st.arError = ''; st.arSort = 'inactive'; st.arAll = false; st.top = null; st.topError = ''; st.topTab = 'tests'; st.topAll = false; st.stu = null; st.stuError = ''; st.stuId = ''; st.stuContact = null; st.stuContactError = ''; st.stuContactBusy = false; st.audit = null; st.auditError = '';
    if (t) { try { fetch('api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t } }); } catch (e) { /* best effort; the session also expires */ } }
    close();
  }

  function onClick(ev) {
    var t = ev.target, act = null;
    while (t && t !== root) { if (t.getAttribute && t.getAttribute('data-act')) { act = t; break; } t = t.parentNode; }
    if (!act) return;
    var a = act.getAttribute('data-act');
    if (a === 'close') close();
    else if (a === 'signin') signin();
    else if (a === 'setpw') setpw();
    else if (a === 'signout') signout();
    else if (a === 'arsort') { var so = act.getAttribute('data-sort') === 'score' ? 'score' : 'inactive'; if (so !== st.arSort || !st.ar) { st.arSort = so; loadAtRisk(); draw(); } }
    else if (a === 'arall') { st.arAll = !st.arAll; draw(); }
    else if (a === 'toptab') { var tb = act.getAttribute('data-tab') === 'practice' ? 'practice' : 'tests'; if (tb !== st.topTab) { st.topTab = tb; st.topAll = false; draw(); } }
    else if (a === 'topall') { st.topAll = !st.topAll; draw(); }
    else if (a === 'stuopen') openStudent(act.getAttribute('data-id'));
    else if (a === 'stuback') leaveStudent();
    else if (a === 'stucontact') showContact();
    else if (a === 'qopen') { st.qFilter = 'all'; st.note = ''; goQuestions(); }
    else if (a === 'qback') { st.view = 'dash'; setError(''); draw(); }
    else if (a === 'qcancel') goQuestions();
    else if (a === 'qfilter') { st.qFilter = act.getAttribute('data-filter'); draw(); }
    else if (a === 'qnew') { st.form = blankForm(); st.note = ''; st.view = 'qform'; setError(''); draw(); }
    else if (a === 'qedit') { var q = qById(act.getAttribute('data-id')); if (q) { st.form = formFrom(q); st.note = ''; st.view = 'qform'; setError(''); draw(); } }
    else if (a === 'qsave') saveQuestion();
    else if (a === 'qimport') { st.imp = { csv: '', section: '' }; st.note = ''; st.view = 'qimport'; setError(''); draw(); }
    else if (a === 'qimportgo') runImport();
    else if (a === 'kitcopy') copyKit();
    else if (a === 'kittpl') downloadKitTemplate();
    else if (a === 'qwithdraw') simple('PUT', '/tutor/questions/' + encodeURIComponent(act.getAttribute('data-id')) + '/active', { active: false }, 'Withdrawn. Students no longer see it.');
    else if (a === 'qrepublish') simple('PUT', '/tutor/questions/' + encodeURIComponent(act.getAttribute('data-id')) + '/active', { active: true }, 'Back live.');
    else if (a === 'qdelete') { if (window.confirm('Delete this question? This cannot be undone.')) simple('DELETE', '/tutor/questions/' + encodeURIComponent(act.getAttribute('data-id')), undefined, 'Deleted.'); }
    else if (a === 'nopen') { st.note = ''; goNotes(); }
    else if (a === 'nback') { st.view = 'dash'; setError(''); draw(); }
    else if (a === 'ncancel') goNotes();
    else if (a === 'nnew') { st.nForm = blankNote(); st.note = ''; st.view = 'nform'; setError(''); draw(); }
    else if (a === 'nedit') { var nn = nById(act.getAttribute('data-id')); if (nn) { st.nForm = { id: nn.id, topic: nn.topic || '', title: nn.title || '', body: nn.body || '' }; st.note = ''; st.view = 'nform'; setError(''); draw(); } }
    else if (a === 'nsave') saveNote();
    else if (a === 'nhold') noteSimple('PUT', '/tutor/notes/' + encodeURIComponent(act.getAttribute('data-id')) + '/active', { active: false }, 'Held back. Students no longer see it.');
    else if (a === 'nlive') noteSimple('PUT', '/tutor/notes/' + encodeURIComponent(act.getAttribute('data-id')) + '/active', { active: true }, 'Back live.');
    else if (a === 'ndelete') { if (window.confirm('Delete this note? This cannot be undone.')) noteSimple('DELETE', '/tutor/notes/' + encodeURIComponent(act.getAttribute('data-id')), undefined, 'Deleted.'); }
    else if (a === 'topen') { st.note = ''; goNotices(); }
    else if (a === 'tback') { st.view = 'dash'; setError(''); draw(); }
    else if (a === 'tcancel') goNotices();
    else if (a === 'tnew') { st.ntForm = blankNotice(); st.note = ''; st.view = 'ntform'; setError(''); draw(); }
    else if (a === 'tedit') { var tn = ntById(act.getAttribute('data-id')); if (tn) { st.ntForm = { id: tn.id, title: tn.title || '', body: tn.body || '' }; st.note = ''; st.view = 'ntform'; setError(''); draw(); } }
    else if (a === 'tsave') saveNotice();
    else if (a === 'tremove') { if (window.confirm('Remove this notice? Students will stop seeing it, and this cannot be undone.')) call('DELETE', '/tutor/notices/' + encodeURIComponent(act.getAttribute('data-id'))).then(function () { afterNotice('Removed.'); }).catch(failed); }
    else if (a === 'sopen') { st.scFilter = 'awaiting-marking'; st.note = ''; goScripts(); }
    else if (a === 'sback') { st.view = 'dash'; setError(''); draw(); }
    else if (a === 'sfilter') { st.scFilter = act.getAttribute('data-filter'); draw(); }
    else if (a === 'sview') openScript(act.getAttribute('data-id'));
    else if (a === 'ssave') saveMarks();
    else if (a === 'sclose') goScripts();
    else if (a === 'fgreply') replyFlag(act.getAttribute('data-id'));
    else if (a === 'fgclose') closeFlag(act.getAttribute('data-id'));
    else if (a === 'subject') { var prev = st.subject; st.note = ''; st.subject = act.getAttribute('data-subject'); if (st.subject !== prev) loadSubject(prev); }
    else if (a === 'show') {
      var inp = root.querySelector('#' + act.getAttribute('data-for'));
      if (inp) { var on = inp.type === 'password'; inp.type = on ? 'text' : 'password'; act.textContent = on ? 'Hide' : 'Show'; }
    }
  }
  function onChange(ev) {
    var t = ev.target, a = t && t.getAttribute && t.getAttribute('data-act');
    if (a === 'qsection' && st.view === 'qform') { readForm(); draw(); }
    else if (a === 'qfile' && t.files && t.files[0] && window.FileReader) {
      var rd = new FileReader();
      rd.onload = function () { var box = root && root.querySelector('#zxCsv'); if (box) box.value = String(rd.result || ''); };
      rd.readAsText(t.files[0]);
    }
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && st.view === 'signin') close();
    else if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') {
      if (st.view === 'signin') signin(); else if (st.view === 'password') setpw();
    }
  }

  function open() {
    if (root) return;
    if (!document.getElementById('zxCss')) {
      var s = document.createElement('style'); s.id = 'zxCss'; s.textContent = CSS; document.head.appendChild(s);
    }
    root = document.createElement('div');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    document.body.appendChild(root);
    draw();
  }

  /* Opening again (a second knock) resumes where the tutor was, or starts at sign-in. */
  window.__zxOpen = function () {
    if (!st.token) { st.view = 'signin'; st.shown = false; setError(''); }
    open();
  };
  window.__zxOpen();
})();
