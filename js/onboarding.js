/* G.O.C Academy Hub — interactive onboarding engine (Stage 6).
 *
 * A real walkthrough, not tooltips: every step first navigates to the
 * screen where its feature lives (go(), a named opener, or — from
 * Stage 7 — a Management Console section), waits for the target element
 * to actually be visible, scrolls it into view and spotlights it. A
 * target that never appears is skipped and logged; the card never floats
 * over the wrong screen pointing at nothing.
 *
 * State is per tour + per user in localStorage:
 *   goc.tour.v2.<tour>.<userId> -> { status: 'in-progress'|'skipped'|'done', step }
 * so a shared phone never inherits another student's finished tour, an
 * interrupted tour can resume where it stopped, a completed tour never
 * auto-repeats, and every tour can be restarted from Help. The legacy
 * student key goc_tut_done_v1 is honoured as 'done' so returning
 * students are not re-toured uninvited.
 *
 * The engine never starts an exam, submits anything or calls a start
 * route: tours end at set-up and catalogue screens. It is dependency
 * free and the factory (create) takes its environment, so complete
 * journeys are unit-testable in Node with a fake DOM. */
(function (root) {
  'use strict';

  var KEY_PREFIX = 'goc.tour.v2.';
  var LEGACY_STUDENT_KEY = 'goc_tut_done_v1';

  function create(env) {
    env = env || {};
    var doc = env.document || (typeof document !== 'undefined' ? document : null);
    var storage = env.storage || (function () {
      try { return root.localStorage || null; } catch (e) { return null; }
    })();
    var tours = {};
    var active = null;   /* { name, userId, index, skipped: [] } */
    var els = null;
    var keyHandler = null;

    function storageGet(k) { try { return storage ? storage.getItem(k) : null; } catch (e) { return null; } }
    function storageSet(k, v) { try { if (storage) storage.setItem(k, v); } catch (e) {} }

    function key(name, userId) { return KEY_PREFIX + name + '.' + String(userId || 'anon'); }
    function loadState(name, userId) {
      var raw = storageGet(key(name, userId));
      if (raw) { try { var s = JSON.parse(raw); if (s && s.status) return s; } catch (e) {} }
      if (name === 'student' && storageGet(LEGACY_STUDENT_KEY)) return { status: 'done', step: 0, legacy: true };
      return null;
    }
    function saveState(name, userId, status, step) {
      storageSet(key(name, userId), JSON.stringify({ status: status, step: step, at: Date.now() }));
    }

    function getEl(id) {
      if (env.getElementById) return env.getElementById(id);
      return doc ? doc.getElementById(id) : null;
    }
    function isVisible(el) {
      if (!el) return false;
      if (env.isVisible) return env.isVisible(el);
      if (!el.getBoundingClientRect) return true;
      var r = el.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return false;
      if (typeof getComputedStyle === 'function') {
        var cs = getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      }
      return true;
    }
    function navigate(step) {
      if (step.go && env.go) env.go(step.go);
      else if (step.go && typeof root.go === 'function') root.go(step.go);
      if (step.call) {
        if (env.call) env.call(step.call, step.callArg);
        else if (typeof root[step.call] === 'function') root[step.call](step.callArg);
      }
      if (step.adm) {
        if (env.call) { env.call('admOpen', step.adm); }
        else if (typeof root.admOpen === 'function') root.admOpen(step.adm);
      }
    }
    function delay(ms) {
      return new Promise(function (res) { (env.setTimeout || setTimeout)(res, ms); });
    }
    function waitForTarget(id, timeoutMs) {
      var waited = 0;
      function poll() {
        var el = getEl(id);
        if (isVisible(el)) return Promise.resolve(el);
        if (waited >= timeoutMs) return Promise.resolve(null);
        waited += 50;
        return delay(50).then(poll);
      }
      return poll();
    }

    /* ---- overlay DOM (built once, reused by every tour) ---- */
    function build() {
      if (els || !doc) return els;
      var overlay = doc.createElement('div');
      overlay.id = 'gocTourOverlay';
      overlay.className = 'goc-tour-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Guided tour');
      var ring = doc.createElement('div');
      ring.className = 'goc-tour-ring';
      var card = doc.createElement('div');
      card.className = 'goc-tour-card';
      var pips = doc.createElement('div'); pips.className = 'goc-tour-pips';
      var count = doc.createElement('div'); count.className = 'goc-tour-count';
      var title = doc.createElement('div'); title.className = 'goc-tour-title';
      var body = doc.createElement('div'); body.className = 'goc-tour-body';
      body.setAttribute('aria-live', 'polite');
      var actions = doc.createElement('div'); actions.className = 'goc-tour-actions';
      var back = doc.createElement('button'); back.type = 'button'; back.className = 'goc-tour-back'; back.textContent = '← Back';
      var skip = doc.createElement('button'); skip.type = 'button'; skip.className = 'goc-tour-skip'; skip.textContent = 'Skip tour';
      var next = doc.createElement('button'); next.type = 'button'; next.className = 'goc-tour-next'; next.textContent = 'Next →';
      back.addEventListener('click', function () { api.back(); });
      skip.addEventListener('click', function () { api.skip(); });
      next.addEventListener('click', function () { api.next(); });
      actions.appendChild(back); actions.appendChild(skip); actions.appendChild(next);
      card.appendChild(pips); card.appendChild(count); card.appendChild(title); card.appendChild(body); card.appendChild(actions);
      overlay.appendChild(ring); overlay.appendChild(card);
      doc.body.appendChild(overlay);
      els = { overlay: overlay, ring: ring, card: card, pips: pips, count: count, title: title, body: body, back: back, skip: skip, next: next };
      return els;
    }
    function teardown() {
      if (els && els.overlay && els.overlay.parentNode) els.overlay.parentNode.removeChild(els.overlay);
      els = null;
      if (keyHandler && doc && doc.removeEventListener) doc.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    function paint(step, index, total, el) {
      build();
      els.overlay.style.display = 'block';
      els.pips.innerHTML = '';
      for (var p = 0; p < total; p++) {
        var pip = doc.createElement('span');
        pip.className = 'goc-tour-pip' + (p === index ? ' on' : '');
        els.pips.appendChild(pip);
      }
      els.count.textContent = 'Step ' + (index + 1) + ' of ' + total;
      els.title.textContent = step.title;
      els.body.textContent = step.body;
      els.back.disabled = index === 0;
      els.next.textContent = index === total - 1 ? 'Finish ✓' : 'Next →';
      els.skip.style.visibility = 'visible';
      /* Spotlight + card placement from the element's real on-screen box. */
      var vw = env.viewportWidth ? env.viewportWidth() : (root.innerWidth || 360);
      var vh = env.viewportHeight ? env.viewportHeight() : (root.innerHeight || 640);
      var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r) {
        els.ring.style.display = 'block';
        els.ring.style.left = Math.max(0, r.left - 8) + 'px';
        els.ring.style.top = Math.max(0, r.top - 8) + 'px';
        els.ring.style.width = (r.width + 16) + 'px';
        els.ring.style.height = (r.height + 16) + 'px';
        if (el.scrollIntoView && !env.isVisible) { /* real browser: already scrolled by showStep */ }
        var cardW = Math.min(420, vw - 24);
        var left = Math.max(12, Math.min(r.left, vw - cardW - 12));
        els.card.style.left = left + 'px';
        els.card.style.width = cardW + 'px';
        if (vh - r.bottom > 250) els.card.style.top = (r.bottom + 14) + 'px';
        else els.card.style.top = Math.max(12, r.top - 264) + 'px';
      } else {
        els.ring.style.display = 'none';
        els.card.style.left = Math.max(12, (vw - Math.min(420, vw - 24)) / 2) + 'px';
        els.card.style.top = Math.max(12, vh / 2 - 130) + 'px';
      }
      if (els.next.focus) { try { els.next.focus(); } catch (e) {} }
    }
    function paintCompletion(name) {
      build();
      els.overlay.style.display = 'block';
      els.ring.style.display = 'none';
      els.pips.innerHTML = '';
      els.count.textContent = 'All done';
      els.title.textContent = 'You\u2019re set \uD83C\uDF93';
      els.body.textContent = 'That\u2019s the whole tour. You can watch it again any time from Help & tutorial in your Profile — and nothing here started an exam or changed your record.';
      els.back.disabled = true;
      els.skip.style.visibility = 'hidden';
      els.next.textContent = 'Finish ✓';
      var vw = env.viewportWidth ? env.viewportWidth() : (root.innerWidth || 360);
      var vh = env.viewportHeight ? env.viewportHeight() : (root.innerHeight || 640);
      els.card.style.left = Math.max(12, (vw - Math.min(420, vw - 24)) / 2) + 'px';
      els.card.style.width = Math.min(420, vw - 24) + 'px';
      els.card.style.top = Math.max(12, vh / 2 - 130) + 'px';
      if (els.next.focus) { try { els.next.focus(); } catch (e) {} }
    }

    function showStep(index) {
      var def = tours[active.name];
      if (index >= def.steps.length) {
        saveState(active.name, active.userId, 'in-progress', def.steps.length);
        paintCompletion(active.name);
        active.index = def.steps.length;
        return Promise.resolve(true);
      }
      if (index < 0) index = 0;
      active.index = index;
      var step = def.steps[index];
      saveState(active.name, active.userId, 'in-progress', index);
      navigate(step);
      return waitForTarget(step.target, 1500).then(function (el) {
        if (!active) return false;
        if (!el) {
          /* Never point at an invisible feature: log it and move on. */
          active.skipped.push(step.target);
          if (index + 1 > def.steps.length) return showStep(index + 1);
          return showStep(index + 1);
        }
        if (el.scrollIntoView && !env.getElementById) { try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {} }
        return delay(80).then(function () {
          if (!active) return false;
          paint(step, index, def.steps.length, getEl(step.target) || el);
          return true;
        });
      });
    }

    function close(status) {
      if (!active) return;
      if (status) saveState(active.name, active.userId, status, Math.min(active.index, (tours[active.name].steps.length - 1)));
      var wasActive = active;
      active = null;
      teardown();
      return wasActive;
    }

    var api = {
      register: function (name, steps) { tours[name] = { steps: steps || [] }; return api; },
      hasTour: function (name) { return !!tours[name]; },
      steps: function (name) { return tours[name] ? tours[name].steps.slice() : []; },
      state: function (name, userId) { return loadState(name, userId); },
      current: function () {
        if (!active) return null;
        return { tour: active.name, index: active.index, skipped: active.skipped.slice(),
                 step: tours[active.name].steps[active.index] || null };
      },
      start: function (name, opts) {
        opts = opts || {};
        if (!tours[name]) return Promise.resolve(false);
        var userId = opts.userId || 'anon';
        var saved = loadState(name, userId);
        if (saved && saved.status === 'done' && !opts.force) return Promise.resolve(false);
        var index = opts.force ? 0 : (saved && (saved.status === 'in-progress' || saved.status === 'skipped') ? (saved.step || 0) : 0);
        active = { name: name, userId: userId, index: index, skipped: [] };
        build();
        if (doc && doc.addEventListener) {
          keyHandler = function (e) {
            if (!active) return;
            if (e.key === 'Escape') api.exit();
            else if (e.key === 'ArrowRight') api.next();
            else if (e.key === 'ArrowLeft') api.back();
          };
          doc.addEventListener('keydown', keyHandler);
        }
        return showStep(index);
      },
      restart: function (name, userId) { return api.start(name, { userId: userId, force: true }); },
      maybeAutoStart: function (name, userId) {
        if (active) return Promise.resolve(false);
        var saved = loadState(name, userId);
        if (saved) return Promise.resolve(false);   /* done, skipped or interrupted: never auto-repeat */
        return api.start(name, { userId: userId });
      },
      next: function () {
        if (!active) return Promise.resolve(false);
        var def = tours[active.name];
        if (active.index >= def.steps.length) { close('done'); return Promise.resolve(true); }
        return showStep(active.index + 1);
      },
      back: function () {
        if (!active || active.index === 0) return Promise.resolve(false);
        if (active.index >= tours[active.name].steps.length) return showStep(tours[active.name].steps.length - 1);
        return showStep(active.index - 1);
      },
      skip: function () { close('skipped'); return Promise.resolve(true); },
      exit: function () { close('in-progress'); return Promise.resolve(true); },
      helpLabel: function (name, userId) {
        var s = loadState(name, userId);
        if (!s) return 'Take the guided tour';
        if (s.status === 'done') return 'Watch the tour again';
        return 'Resume the tour · step ' + ((s.step || 0) + 1) + ' of ' + (tours[name] ? tours[name].steps.length : 0);
      },
      /* exposed for tests */
      _tours: tours
    };
    return api;
  }

  /* ---- Student tour: only features a student actually has, ending each
     exam-related step at its set-up/catalogue — never inside a run. ---- */
  var STUDENT_STEPS = [
    { go: 'home', target: 'dashUp', title: 'Welcome to your dashboard',
      body: 'This is home. At the top you\u2019ll always see what matters most: your level, XP and streak — and Next Up (right here) tells you the single best thing to do next, worked out from your own record.' },
    { go: 'home', target: 'dashJamb', title: 'Your JAMB / UTME sitting',
      body: 'This card shows your JAMB-oriented sitting when its question bank is ready in all your subjects. If it isn\u2019t ready yet, the card says so honestly — the Objective sitting is always there meanwhile.' },
    { go: 'home', target: 'jnPath', title: 'Your learning journey',
      body: 'Your level path. Every practice answer earns XP and moves you along; tap Goc the owl any time for a hint about what to do next.' },
    { go: 'home', target: 'tut-jump', title: 'Quick shortcuts',
      body: 'One-tap jumps to Practice, your private My Notes, timed Study CBT, the academy Resources library and your Profile. Everything in the app is at most two taps from here.' },
    { go: 'study', target: 'sg-practice', title: 'The Study hub',
      body: 'This is your workshop. Practice is untimed and marks each answer as you go; Web Test is the assessed sitting; JAMB CBT rehearses the real exam format. Let\u2019s look at each.' },
    { call: 'openPractice', target: 'suStart', title: 'Setting up practice',
      body: 'Practise any of your subjects, on the topics you choose, for as many questions as you like. Nothing here is timed or assessed — it\u2019s how you learn. We\u2019ll stop at set-up; starting is always your tap.' },
    { call: 'openCBT', target: 'suStart', title: 'Formal CBT set-up',
      body: 'Timed practice, marked only at the end — the closest rehearsal for exam day before the real sittings. Same set-up screen, but with a clock. Again, we won\u2019t start anything.' },
    { go: 'study', target: 'sg-jamb', title: 'JAMB CBT',
      body: 'The JAMB tile opens the UTME-format sitting for your whole subject combination. The tour never starts it for you — when you\u2019re ready, the tile explains the rules before anything begins.' },
    { go: 'study', target: 'sg-reading', title: 'Read / Learn',
      body: 'Lessons and reading notes for your papers live here, written by the academy for your combination. Read first, then practise — that rhythm is what the league leaders use.' },
    { go: 'study', target: 'sg-resources', title: 'Academy Resources',
      body: 'The shared library: past questions, notes and materials the academy publishes for everyone. Separate from your own private notes, which are next.' },
    { call: 'openMyNotes', target: 'myNoteUploadBtn', title: 'My Notes — your private library',
      body: 'Upload your own notes (PDF, text, Word, images) with a subject and topic. Only you can ever see them — they never appear in the academy library.' },
    { go: 'mynotes', target: 'myNotesList', title: 'Practise This Note',
      body: 'Every note you upload gets a “Practise this note” button: the app builds questions only from that note\u2019s own words, shows you the sentence each answer came from, and keeps them out of every official bank. Scanned PDFs without text get an honest explanation instead.' },
    { go: 'study', target: 'sg-mistakes', title: 'Mistakes & review',
      body: 'Questions you get wrong wait under Mistakes, and anything due for spaced review finds you here and on Next Up. Re-answering them just before you\u2019d forget is how they stick.' },
    { go: 'study', target: 'sg-bookmarks', title: 'Saved questions',
      body: 'Tap “Save question” on any practice question and it waits here for a second look. Handy for the ones you want to ask a tutor about.' },
    { go: 'results', target: 'results', title: 'Your results',
      body: 'Every assessed result and its full review — your answers, the correct ones, and why. What\u2019s marked here is what counts on your record.' },
    { go: 'league', target: 'league', title: 'The Scholar League',
      body: 'Where you stand against other scholars, ranked on assessed performance first. Practice XP separates equals — results lead.' },
    { go: 'classes', target: 'classes', title: 'Classes & timetable',
      body: 'Live classes, recordings and your weekly timetable (on the Home tab bar) keep the academy\u2019s schedule in one place.' },
    { go: 'profile', target: 'tourHelpRow', title: 'Profile, settings & this tour',
      body: 'Your Scholar ID, preferences and account live in Profile. This row — Help & tutorial — brings this tour back whenever you want it: after you finish, it will say “Watch the tour again”.' }
  ];

  var api = null;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    api = create({
      document: document,
      go: function (id) { if (typeof window.go === 'function') window.go(id); },
      call: function (name, arg) { if (typeof window[name] === 'function') window[name](arg); }
    });
    api.register('student', STUDENT_STEPS);
    window.GOCOnboarding = api;
    window.GOCTours = { student: STUDENT_STEPS };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { create: create, STUDENT_STEPS: STUDENT_STEPS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
