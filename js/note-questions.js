/* G.O.C Academy Hub — Practise This Note question generation (Stage 4).
 *
 * Extractive only. Every question in this module is built from a sentence
 * that is actually present in the student's own note: the correct answer is
 * either a phrase lifted from that sentence or the sentence's own defined
 * term, and every question carries the sentence (and its page, where the
 * format has pages) so the student can check it against their note.
 *
 * Nothing here invents facts, calls a network service, or knows anything
 * about the official question banks. The output is a private practice pool
 * for the one note it was built from — it is never labelled official JAMB
 * material and is never written into any shared bank.
 *
 * The module is deliberately dependency-free and side-effect-free so it
 * can be unit-tested in Node (module.exports) and in the browser
 * (window.GOCNoteQuestions) from the same file. */
(function (root) {
  'use strict';

  var STOP = {};
  ('a an the and or but if then else when while of at by for with about into through after over ' +
   'between out against during without before under around among is are was were be been being ' +
   'have has had having do does did doing would should could ought i you he she it we they them ' +
   'his her its our their this that these those am an as so than too very can will just should now ' +
   'from in on to not no yes also more most other some any only own same such because until per via ' +
   'one two three first second used using use example etc within along across however therefore thus ' +
   'often usually generally may might must shall').split(' ').forEach(function (w) { STOP[w] = true; });

  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/-\s*\n\s*/g, '')          /* rejoin words hyphenated over a line break */
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitSentences(text) {
    var t = cleanText(text);
    if (!t) return [];
    /* Split on sentence punctuation followed by a capital/digit/opening quote.
       Abbreviation-heavy prose is not perfectly segmented, which is safe here:
       a merged sentence is simply a longer candidate, never an invented one. */
    var parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/);
    return parts.map(cleanText).filter(function (s) { return s.length > 0; });
  }

  function wordsOf(s) {
    return cleanText(s).toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  function hashOf(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }

  /* Small deterministic PRNG so a given note always builds the same paper —
     re-generating a practice set should not reshuffle a student mid-review,
     and tests can rely on stable output. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function titleCase(s) {
    s = String(s || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function trimOption(s, max) {
    s = cleanText(s).replace(/[.;\s]+$/, '');
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[,;\s]+$/, '') + '…';
  }

  /* Candidate key terms for cloze questions, in the order they are worth
     asking about: capitalised phrases and acronyms first (they are usually
     the named concepts), then the note's most repeated content words. */
  function keyTerms(sentences) {
    var seen = {}, freq = {}, out = [];
    function add(term, strong) {
      var k = String(term || '').toLowerCase();
      if (!k || seen[k]) return;
      if (k.length < 3 || STOP[k]) return;
      seen[k] = true;
      out.push({ term: String(term), strong: !!strong, freq: freq[k] || 0 });
    }
    sentences.forEach(function (s) {
      var m = s.match(/[A-Z][A-Za-z0-9]+(?:\s+(?:of|the|and|for)\s+[A-Z][A-Za-z0-9]+|\s+[A-Z][A-Za-z0-9]+){0,3}/g) || [];
      m.forEach(function (t) { add(t.replace(/^(The|A|An)\s+/, ''), true); });
      (s.match(/\b[A-Z]{2,}\b/g) || []).forEach(function (t) { add(t, true); });
      (s.match(/["“]([^"”]{3,40})["”]/g) || []).forEach(function (t) { add(t.replace(/["“”]/g, ''), true); });
    });
    sentences.forEach(function (s) {
      wordsOf(s).forEach(function (w) { if (!STOP[w] && w.length >= 5) freq[w] = (freq[w] || 0) + 1; });
    });
    Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; })
      .forEach(function (w) { if (freq[w] >= 2) add(w, false); });
    return out;
  }

  function sentenceUsable(s) {
    if (s.length < 45 || s.length > 280) return false;
    if (wordsOf(s).length < 8) return false;
    if (/https?:|www\.|@/.test(s)) return false;
    if (/^(figure|fig\.|table|chapter|page|contents|exercise|question)\b/i.test(s)) return false;
    return true;
  }

  var DEF_RE = /^(.{2,60}?)\s+(is defined as|is known as|is called|refers to|means|is|are)\s+(.+)$/i;

  function definitionOf(s) {
    var m = s.match(DEF_RE);
    if (!m) return null;
    var term = cleanText(m[1]).replace(/^(the|a|an)\s+/i, '');
    var body = cleanText(m[3]);
    if (term.length < 2 || term.length > 60) return null;
    if (body.length < 12 || body.length > 190) return null;
    if (wordsOf(term).length > 7) return null;
    return { term: titleCase(term), body: trimOption(body, 190) };
  }

  function findTerm(sentence, terms) {
    var lower = sentence.toLowerCase();
    var best = null;
    terms.forEach(function (t) {
      var idx = lower.indexOf(t.term.toLowerCase());
      if (idx < 8) return;                    /* not the sentence's opening word */
      if (!best || t.term.length > best.term.length) best = { term: t.term, idx: idx, strong: t.strong };
    });
    return best;
  }

  function sourceLabel(opts, page) {
    var where = opts.noteTitle ? ('“' + opts.noteTitle + '”') : 'your note';
    return 'your note ' + where + (page ? ', page ' + page : '');
  }

  function explanationFor(sentence, opts, page) {
    return 'From ' + sourceLabel(opts, page) + ': “' + trimOption(sentence, 300) + '”';
  }

  /* generateFromPages(pages, opts)
     pages: [{ page: <number|null>, text: <string> }] — page null for formats
            without pages (txt/md). Plain strings are also accepted.
     opts:  { count, difficulty: 'easy'|'standard'|'challenge',
              noteId, noteTitle, subject, topic }
     Returns { questions, stats } where stats explains honestly when a note
     cannot support practice (no readable text, too little usable text). */
  function generateFromPages(pages, opts) {
    opts = opts || {};
    var count = Math.max(1, Math.min(20, Math.floor(Number(opts.count) || 5)));
    var difficulty = ['easy', 'standard', 'challenge'].indexOf(opts.difficulty) >= 0 ? opts.difficulty : 'standard';

    var normPages = (Array.isArray(pages) ? pages : []).map(function (p, i) {
      if (typeof p === 'string') return { page: null, text: p };
      return { page: (p && p.page != null) ? p.page : (p && p.pageNumber != null ? p.pageNumber : null), text: cleanText(p && p.text) };
    });
    var totalChars = normPages.reduce(function (n, p) { return n + p.text.length; }, 0);
    var pagesWithText = normPages.filter(function (p) { return p.text.length >= 20; }).length;

    var stats = {
      pages: normPages.length,
      pagesWithText: pagesWithText,
      characters: totalChars,
      sentences: 0,
      reason: null
    };

    if (totalChars < 40) {
      stats.reason = 'no-readable-text';
      return { questions: [], stats: stats };
    }

    /* Collect usable sentences once, keeping the page each came from, and
       dropping exact duplicates (headers/footers repeat on every page). */
    var seenSentence = {}, sentences = [];
    normPages.forEach(function (p) {
      splitSentences(p.text).forEach(function (s) {
        if (!sentenceUsable(s)) return;
        var key = s.toLowerCase();
        if (seenSentence[key]) return;
        seenSentence[key] = true;
        sentences.push({ text: s, page: p.page });
      });
    });
    stats.sentences = sentences.length;
    if (sentences.length < 3) {
      stats.reason = 'too-little-usable-text';
      return { questions: [], stats: stats };
    }

    var terms = keyTerms(sentences.map(function (s) { return s.text; }));
    var rand = rng(hashOf(String(opts.noteId || '') + '|' + String(opts.noteTitle || '') + '|' + sentences.map(function (s) { return s.text; }).join(' ')));

    var definitions = [], clozes = [];
    sentences.forEach(function (s, i) {
      var def = definitionOf(s.text);
      if (def) definitions.push({ s: s, def: def, i: i });
      var hit = findTerm(s.text, terms);
      if (hit) clozes.push({ s: s, term: hit.term, idx: hit.idx, strong: hit.strong, i: i });
    });

    function byDifficulty(list, kind) {
      return list.slice().sort(function (a, b) {
        var la = a.s.text.length, lb = b.s.text.length;
        if (difficulty === 'easy') return (kind === 'def' ? 0 : 1) - (kind === 'def' ? 0 : 1) || la - lb;
        if (difficulty === 'challenge') return lb - la;
        return (a.i % 2) - (b.i % 2) || la - lb;
      });
    }

    var questions = [], usedStem = {}, usedAnswer = {};

    function pushQuestion(stem, correct, distractors, sentence, page) {
      var stemKey = stem.toLowerCase(), ansKey = String(correct).toLowerCase();
      if (usedStem[stemKey] || usedAnswer[ansKey]) return false;
      var pool = [];
      distractors.forEach(function (d) {
        var v = trimOption(d, 190);
        if (v && v.toLowerCase() !== ansKey && pool.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase()) < 0) pool.push(v);
      });
      if (pool.length < 3) return false;
      var options = shuffle([trimOption(correct, 190)].concat(shuffle(pool, rand).slice(0, 3)), rand);
      usedStem[stemKey] = true; usedAnswer[ansKey] = true;
      questions.push({
        /* No numeric id: these questions belong to no bank, and a null id
           keeps bookmarking keyed by the question text itself while the
           tutor-flag route (which needs a real bank id) stays out of it. */
        id: null,
        source: 'my-note',
        noteId: opts.noteId || null,
        text: stem,
        options: options,
        answer: options.indexOf(trimOption(correct, 190)),
        explanation: explanationFor(sentence, opts, page),
        topic: opts.topic || 'From your note',
        subject: opts.subject || '',
        page: page,
        sourceText: sentence
      });
      return true;
    }

    var defBodies = definitions.map(function (d) { return d.def.body; });
    var termNames = terms.map(function (t) { return t.term; });
    var strongTermNames = terms.filter(function (t) { return t.strong; }).map(function (t) { return t.term; });
    var plainTermNames = terms.filter(function (t) { return !t.strong; }).map(function (t) { return t.term; });

    var defOrdered = byDifficulty(definitions, 'def');
    var clozeOrdered = byDifficulty(clozes, 'cloze');
    if (difficulty === 'easy') clozeOrdered = clozeOrdered.filter(function (c) { return c.s.text.length <= 170; });

    /* Interleave the two shapes so a paper is not five identical stems;
       easy leans on definitions, challenge leans on cloze, standard mixes. */
    var queues = difficulty === 'challenge' ? [clozeOrdered, defOrdered] : [defOrdered, clozeOrdered];
    var qi = [0, 0], turn = 0, guard = 0;
    while (questions.length < count && guard++ < 500) {
      var q = queues[turn % 2], k = qi[turn % 2]++;
      turn++;
      if (k >= q.length) { if (qi[0] >= queues[0].length && qi[1] >= queues[1].length) break; continue; }
      var item = q[k];
      if (q === defOrdered) {
        pushQuestion(
          'According to ' + sourceLabel(opts, item.s.page) + ', what is ' + item.def.term + '?',
          item.def.body,
          defBodies.filter(function (b) { return b !== item.def.body; }),
          item.s.text, item.s.page
        );
      } else {
        var stem = item.s.text.slice(0, item.idx) + '________' + item.s.text.slice(item.idx + item.term.length);
        pushQuestion(
          'Complete this sentence from ' + sourceLabel(opts, item.s.page) + ': “' + trimOption(stem, 260) + '”',
          item.term,
          (item.strong && strongTermNames.length >= 4 ? strongTermNames
            : (!item.strong && plainTermNames.length >= 4 ? plainTermNames : termNames))
            .filter(function (t) { return t.toLowerCase() !== item.term.toLowerCase(); }),
          item.s.text, item.s.page
        );
      }
    }

    if (questions.length < 3) {
      stats.reason = questions.length ? 'too-little-usable-text' : 'no-usable-questions';
      return { questions: [], stats: stats };
    }
    stats.reason = null;
    return { questions: questions, stats: stats };
  }

  var api = {
    generateFromPages: generateFromPages,
    splitSentences: splitSentences,
    cleanText: cleanText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GOCNoteQuestions = api;
})(typeof window !== 'undefined' ? window : globalThis);
