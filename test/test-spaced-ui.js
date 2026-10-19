/* test-spaced-ui.js — Phase 2, spaced repetition slice 4: the Review due card on the
   Study hub and the review session screen. Checks the markup, then runs the real
   rv* functions from js/app.js against a stub page and a stub GOC.api.
   node test/test-spaced-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\nMarkup');
var studyAt = html.indexOf('id="study"'), setAt = html.indexOf('id="studySet"');
['rvCard', 'rvCardText', 'rvCardNote', 'rvCardBtn'].forEach(function (id) {
  var at = html.indexOf('id="' + id + '"');
  ok(id + ' sits inside the Study screen', at > studyAt && at < setAt);
});
ok('the card starts hidden', /id="rvCard"[^>]*display:none/.test(html));
ok('the button opens the review screen', /id="rvCardBtn"[^>]*onclick="go\('review'\)"/.test(html));
ok('a review screen with a host and a subtitle exists', /<section class="screen pad" id="review">/.test(html) && html.indexOf('id="rvHost"') > html.indexOf('id="review"') && html.indexOf('id="rvSub"') > html.indexOf('id="review"'));
ok('opening Study refreshes the card', /id === 'study' && typeof refreshReview === 'function'\) refreshReview\(\)/.test(app));
ok('opening the review screen starts a session', /id === 'review' && typeof rvOpen === 'function'\) rvOpen\(\)/.test(app));

var from = app.indexOf('function rvWhen('), endMark = 'function rvAdvance(){ rvIndex++; rvRender(); }';
var to = app.indexOf(endMark) + endMark.length;
ok('the review code is present', from > -1 && to > from);

function el() { return { style: { display: 'none' }, textContent: '', innerHTML: '' }; }
var els = { rvCard: el(), rvCardText: el(), rvCardNote: el(), rvCardBtn: el(), rvHost: el(), rvSub: el(), rvOpts: el(), rvFeed: el() };
var toasts = [], listImpl, answerImpl, calls = [];
var sandbox = {
  studentId: 'GOC-1',
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
  mth: function (s) { return String(s == null ? '' : s); },
  reviewPassageHTML: function () { return ''; },   /* the passage box is covered in test-passage-review.js */
  reviewImageHTML: function () { return ''; },     /* the picture box is covered in test-image-review.js */
  paintQImage: function () {},
  toast: function (m) { toasts.push(m); },
  GOC: { api: {
    listReview: function () { return listImpl(); },
    answerReview: function (k, g) { calls.push([k, g]); return answerImpl(k, g); }
  } },
  Promise: Promise, Math: Math, Number: Number, Date: Date
};
var ctx = vm.createContext(sandbox);
vm.runInContext(app.slice(from, to), ctx);
var DAY = 86400000;
function row(i) { return { key: 'k' + i, subject: 'Physics', topic: 'Waves', text: 'Question ' + i, options: ['a', 'b', 'c', 'd'], answer: 2, box: 0 }; }
function settle() { return new Promise(function (r) { setTimeout(r, 0); }); }

console.log('\nWhen words');
var now = 1000 * DAY;
ok('past or now is "now"', sandbox.rvWhen(now - 5, now) === 'now' && sandbox.rvWhen(now, now) === 'now' && sandbox.rvWhen(null, now) === 'now');
ok('under a day', sandbox.rvWhen(now + 3600000, now) === 'within a day');
ok('one day is tomorrow', sandbox.rvWhen(now + DAY, now) === 'tomorrow');
ok('several days', sandbox.rvWhen(now + 7 * DAY, now) === 'in 7 days');

console.log('\nCard');
sandbox.paintReviewCard({ review: { dueCount: 1, upcoming: 0, due: [row(1)] } });
ok('one due: singular wording, button shown, card shown', els.rvCardText.textContent === '1 question is due for review' && els.rvCardBtn.style.display === '' && els.rvCard.style.display === '');
sandbox.paintReviewCard({ review: { dueCount: 12, upcoming: 3 } });
ok('many due: plural wording with the full count', els.rvCardText.textContent === '12 questions are due for review');
sandbox.paintReviewCard({ review: { dueCount: 0, upcoming: 2, nextDue: Date.now() + 3 * DAY } });
ok('none due but some waiting: says when, no button', /Nothing due right now/.test(els.rvCardText.textContent) && /in 3 days/.test(els.rvCardNote.textContent) && els.rvCardBtn.style.display === 'none' && els.rvCard.style.display === '');
sandbox.paintReviewCard({ review: { dueCount: 0, upcoming: 0, nextDue: null } });
ok('no mistakes at all hides the card', els.rvCard.style.display === 'none');
sandbox.paintReviewCard(null);
ok('null hides it too', els.rvCard.style.display === 'none');
listImpl = function () { return Promise.resolve({ review: { dueCount: 4, upcoming: 0 } }); };
var p = sandbox.refreshReview();

p.then(function () {
  ok('refreshReview paints what the server returned', els.rvCard.style.display === '' && /4 questions/.test(els.rvCardText.textContent));
  listImpl = function () { return Promise.reject(new Error('offline')); };
  return sandbox.refreshReview();
}).then(function () {
  ok('offline: the card is left as it was', /4 questions/.test(els.rvCardText.textContent));
  sandbox.studentId = null;
  return sandbox.refreshReview();
}).then(function () {
  ok('signed out: the card is hidden', els.rvCard.style.display === 'none');
  sandbox.studentId = 'GOC-1';

  console.log('\nSession');
  listImpl = function () { return Promise.resolve({ review: { dueCount: 12, upcoming: 0, nextDue: null, due: [row(1), row(2)] } }); };
  return sandbox.rvOpen();
}).then(function () {
  ok('the first question is shown with its options', /Question 1/.test(els.rvHost.innerHTML) && (els.rvHost.innerHTML.match(/rvPick\(/g) || []).length === 4 && els.rvSub.textContent === 'Question 1 of 2', els.rvHost.innerHTML.slice(0, 200));
  ok('the right answer is not shown before answering', !/Correct answer|right answer/i.test(els.rvHost.innerHTML));
  answerImpl = function () { return Promise.resolve({ ok: true, correct: true, answer: 2, explanation: 'Because.', box: 1, mastered: false, nextDue: Date.now() + 3 * DAY, dueCount: 11 }); };
  sandbox.rvPick(2);
  sandbox.rvPick(1);   /* a second tap while the first is in flight must be ignored */
  return settle();
}).then(function () {
  ok('only one answer was sent, with the key and the picked option', calls.length === 1 && calls[0][0] === 'k1' && calls[0][1] === 2, JSON.stringify(calls));
  ok('feedback says correct, when it returns, and shows the explanation', /Correct/.test(els.rvFeed.innerHTML) && /in 3 days/.test(els.rvFeed.innerHTML) && /Because\./.test(els.rvFeed.innerHTML));
  ok('the options are cleared and a Next button appears', els.rvOpts.innerHTML === '' && /Next question/.test(els.rvFeed.innerHTML));
  sandbox.rvAdvance();
  ok('Next shows question 2', /Question 2/.test(els.rvHost.innerHTML) && els.rvSub.textContent === 'Question 2 of 2');
  answerImpl = function () { return Promise.resolve({ ok: true, correct: false, answer: 2, explanation: '', box: 0, mastered: false, nextDue: Date.now() + DAY, dueCount: 10 }); };
  sandbox.rvPick(0);
  return settle();
}).then(function () {
  ok('a wrong answer names the right option and says it returns tomorrow', /Not quite/.test(els.rvFeed.innerHTML) && /The right answer is c/.test(els.rvFeed.innerHTML) && /tomorrow/.test(els.rvFeed.innerHTML), els.rvFeed.innerHTML);
  ok('the last question offers Finish', /Finish/.test(els.rvFeed.innerHTML));
  sandbox.rvAdvance();
  ok('summary shows the score', /1 of 2 right/.test(els.rvHost.innerHTML));
  ok('summary offers to keep going when more are due (12 due, 2 shown)', /10 more due/.test(els.rvHost.innerHTML));

  answerImpl = function () { return Promise.reject(new Error('A glitch.')); };
  listImpl = function () { return Promise.resolve({ review: { dueCount: 1, upcoming: 0, due: [row(9)] } }); };
  return sandbox.rvOpen();
}).then(function () {
  sandbox.rvPick(1);
  return settle();
}).then(function () {
  ok('a failed save shows the message and leaves the question answerable', toasts[0] === 'A glitch.' && /rvPick\(/.test(els.rvHost.innerHTML));
  answerImpl = function () { return Promise.resolve({ ok: true, correct: true, answer: 2, explanation: '', box: 4, mastered: true, nextDue: null, dueCount: 0 }); };
  sandbox.rvPick(2);
  return settle();
}).then(function () {
  ok('a mastered question says it will not come back', /mastered/.test(els.rvFeed.innerHTML));
  sandbox.rvAdvance();
  ok('no "more due" button when everything was shown', !/more due/.test(els.rvHost.innerHTML) && /Back to Study/.test(els.rvHost.innerHTML));

  listImpl = function () { return Promise.resolve({ review: { dueCount: 0, upcoming: 1, due: [], nextDue: Date.now() + 2 * DAY } }); };
  return sandbox.rvOpen();
}).then(function () {
  ok('an empty queue says nothing is due and when the next one is', /Nothing is due/.test(els.rvHost.innerHTML) && /in 2 days/.test(els.rvHost.innerHTML));
  listImpl = function () { return Promise.reject(new Error('offline')); };
  return sandbox.rvOpen();
}).then(function () {
  ok('offline: a plain message, no crash', /Could not load/.test(els.rvHost.innerHTML));
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log('THREW: ' + e.stack); process.exit(1); });
