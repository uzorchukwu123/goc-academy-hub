/* test-scholarship.js — B#2 slice 1: pure scholarship rules in js/goc-core.js.
   No server, no storage.  Run:  node test/test-scholarship.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---- helpers ---- */
var VALID_SUBJECTS = ['Use of English', 'Physics', 'Chemistry', 'Biology'];

function good(overrides) {
  return Object.assign({
    name:        'Adaeze Okonkwo',
    email:       'adaeze@example.com',
    phone:       '08012345678',
    state:       'Lagos',
    city:        'Ikeja',
    examStatus:  'Preparing for JAMB 2027',
    subjects:    VALID_SUBJECTS.slice(),
    parentName:  'Mrs Okonkwo',
    parentEmail: 'parent@example.com',
    parentPhone: '08098765432',
    pledge:      true
  }, overrides || {});
}

/* ---- constants ---- */
head('Constants are published correctly');
ok('SCHOLARSHIP_PLACES is 30',               core.SCHOLARSHIP_PLACES === 30);
ok('SCHOLARSHIP_INACTIVITY_DAYS is 14',      core.SCHOLARSHIP_INACTIVITY_DAYS === 14);
ok('SCHOLARSHIP_STATUSES is an array',       Array.isArray(core.SCHOLARSHIP_STATUSES));
ok('pending is a valid status',              core.SCHOLARSHIP_STATUSES.indexOf('pending') !== -1);
ok('accepted is a valid status',             core.SCHOLARSHIP_STATUSES.indexOf('accepted') !== -1);
ok('rejected is a valid status',             core.SCHOLARSHIP_STATUSES.indexOf('rejected') !== -1);
ok('approved is a valid status',             core.SCHOLARSHIP_STATUSES.indexOf('approved') !== -1);
ok('SCHOLARSHIP_EXAM_STATUSES is an array',  Array.isArray(core.SCHOLARSHIP_EXAM_STATUSES));
ok('exam status list has at least 4 items',  core.SCHOLARSHIP_EXAM_STATUSES.length >= 4);
ok('NIGERIA_STATES is an array',             Array.isArray(core.NIGERIA_STATES));
ok('Lagos is in NIGERIA_STATES',             core.NIGERIA_STATES.indexOf('Lagos') !== -1);
ok('FCT is in NIGERIA_STATES',               core.NIGERIA_STATES.indexOf('FCT') !== -1);

/* ---- scholarshipOpen ---- */
head('scholarshipOpen');
ok('no settings, 0 approved → open',
   core.scholarshipOpen({}, 0) === 'open');
ok('29 approved → open',
   core.scholarshipOpen({}, 29) === 'open');
ok('30 approved → closed (no waitlist)',
   core.scholarshipOpen({}, 30) === 'closed');
ok('31 approved → closed (no waitlist)',
   core.scholarshipOpen({}, 31) === 'closed');
ok('30 approved, waitlistOpen true → waitlist',
   core.scholarshipOpen({ waitlistOpen: true }, 30) === 'waitlist');
ok('Founder force-closed, 0 approved → closed',
   core.scholarshipOpen({ scholarshipOpen: false }, 0) === 'closed');
ok('Founder force-closed + waitlist open → waitlist',
   core.scholarshipOpen({ scholarshipOpen: false, waitlistOpen: true }, 0) === 'waitlist');
ok('null settings, 0 approved → open',
   core.scholarshipOpen(null, 0) === 'open');

/* ---- waitlistOpen ---- */
head('waitlistOpen');
ok('returns false when scholarship is open',
   core.waitlistOpen({}, 0) === false);
ok('returns true when mode is waitlist',
   core.waitlistOpen({ waitlistOpen: true }, 30) === true);
ok('returns false when closed and no waitlist',
   core.waitlistOpen({}, 30) === false);

/* ---- canApply ---- */
head('canApply — fresh applicant');
ok('empty list → allowed',
   core.canApply([], 'new@example.com').allowed === true);
ok('null list → allowed',
   core.canApply(null, 'new@example.com').allowed === true);
ok('no email → not allowed',
   core.canApply([], '').allowed === false);

head('canApply — existing applications');
var apps = [
  { email: 'pending@example.com',  status: 'pending'  },
  { email: 'accepted@example.com', status: 'accepted' },
  { email: 'approved@example.com', status: 'approved' },
  { email: 'rejected@example.com', status: 'rejected' }
];
ok('pending → not allowed',
   core.canApply(apps, 'pending@example.com').allowed === false);
ok('accepted → not allowed',
   core.canApply(apps, 'accepted@example.com').allowed === false);
ok('approved → not allowed',
   core.canApply(apps, 'approved@example.com').allowed === false);
ok('rejected → allowed (may reapply)',
   core.canApply(apps, 'rejected@example.com').allowed === true);
ok('unknown email → allowed',
   core.canApply(apps, 'unknown@example.com').allowed === true);
ok('email comparison is case-insensitive',
   core.canApply(apps, 'PENDING@EXAMPLE.COM').allowed === false);

/* ---- validateScholarApplication ---- */
head('validateScholarApplication — valid submission');
var res = core.validateScholarApplication(good());
ok('valid form returns rec',       !res.error && !!res.rec);
ok('rec has name',                 res.rec && res.rec.name === 'Adaeze Okonkwo');
ok('rec has email lowercased',     res.rec && res.rec.email === 'adaeze@example.com');
ok('rec has phone',                res.rec && res.rec.phone === '08012345678');
ok('rec has state',                res.rec && res.rec.state === 'Lagos');
ok('rec has city',                 res.rec && res.rec.city === 'Ikeja');
ok('rec has examStatus',           res.rec && res.rec.examStatus === 'Preparing for JAMB 2027');
ok('rec has 4 subjects',           res.rec && res.rec.subjects.length === 4);
ok('rec subjects include English', res.rec && res.rec.subjects.indexOf('Use of English') !== -1);
ok('rec has parentName',           res.rec && res.rec.parentName === 'Mrs Okonkwo');
ok('rec has parentEmail',          res.rec && res.rec.parentEmail === 'parent@example.com');
ok('rec has parentPhone',          res.rec && res.rec.parentPhone === '08098765432');
ok('pledge is true',               res.rec && res.rec.pledge === true);

head('validateScholarApplication — name');
ok('missing name → error',         !!core.validateScholarApplication(good({ name: '' })).error);
ok('one-char name → error',        !!core.validateScholarApplication(good({ name: 'A' })).error);
ok('101-char name → error',        !!core.validateScholarApplication(good({ name: 'A'.repeat(101) })).error);
ok('whitespace-only name → error', !!core.validateScholarApplication(good({ name: '   ' })).error);

head('validateScholarApplication — email');
ok('missing email → error',        !!core.validateScholarApplication(good({ email: '' })).error);
ok('invalid email → error',        !!core.validateScholarApplication(good({ email: 'notanemail' })).error);
ok('email is stored lowercase',    (function(){ var r=core.validateScholarApplication(good({email:'Upper@Example.COM'})); return r.rec && r.rec.email==='upper@example.com'; })());

head('validateScholarApplication — phone');
ok('missing phone → error',        !!core.validateScholarApplication(good({ phone: '' })).error);
ok('too-short phone → error',      !!core.validateScholarApplication(good({ phone: '123' })).error);
ok('letters in phone → error',     !!core.validateScholarApplication(good({ phone: 'abcdefghij' })).error);

head('validateScholarApplication — location');
ok('missing state → error',        !!core.validateScholarApplication(good({ state: '' })).error);
ok('invalid state → error',        !!core.validateScholarApplication(good({ state: 'Narnia' })).error);
ok('missing city → error',         !!core.validateScholarApplication(good({ city: '' })).error);
ok('one-char city → error',        !!core.validateScholarApplication(good({ city: 'X' })).error);
ok('81-char city → error',         !!core.validateScholarApplication(good({ city: 'A'.repeat(81) })).error);

head('validateScholarApplication — exam status');
ok('missing examStatus → error',   !!core.validateScholarApplication(good({ examStatus: '' })).error);
ok('invalid examStatus → error',   !!core.validateScholarApplication(good({ examStatus: 'Guessing' })).error);

head('validateScholarApplication — subjects');
ok('3 subjects → error',           !!core.validateScholarApplication(good({ subjects: ['Use of English','Physics','Chemistry'] })).error);
ok('5 subjects → error',           !!core.validateScholarApplication(good({ subjects: ['Use of English','Physics','Chemistry','Biology','Mathematics'] })).error);
ok('4 subjects without English → error',
   !!core.validateScholarApplication(good({ subjects: ['Physics','Chemistry','Biology','Mathematics'] })).error);
ok('4 valid subjects → no error',  !core.validateScholarApplication(good({ subjects: ['Use of English','Physics','Chemistry','Biology'] })).error);

head('validateScholarApplication — parent / guardian');
ok('missing parentName → error',   !!core.validateScholarApplication(good({ parentName: '' })).error);
ok('no parentEmail and no parentPhone → error',
   !!core.validateScholarApplication(good({ parentEmail: '', parentPhone: '' })).error);
ok('parentEmail only (no phone) → ok',
   !core.validateScholarApplication(good({ parentPhone: '' })).error);
ok('parentPhone only (no email) → ok',
   !core.validateScholarApplication(good({ parentEmail: '' })).error);
ok('invalid parentEmail → error',
   !!core.validateScholarApplication(good({ parentEmail: 'notvalid' })).error);
ok('invalid parentPhone → error',
   !!core.validateScholarApplication(good({ parentPhone: '123', parentEmail: '' })).error);
ok('parentEmail stored blank when absent',
   (function(){ var r=core.validateScholarApplication(good({parentEmail:''})); return r.rec && r.rec.parentEmail===''; })());

head('validateScholarApplication — pledge');
ok('pledge false → error',         !!core.validateScholarApplication(good({ pledge: false })).error);
ok('pledge undefined → error',     !!core.validateScholarApplication(good({ pledge: undefined })).error);
ok('pledge truthy → ok',           !core.validateScholarApplication(good({ pledge: true })).error);

/* ---- makeApplication ---- */
head('makeApplication');
var validRec = core.validateScholarApplication(good()).rec;
var app1 = core.makeApplication(validRec, 1, 0);
ok('id is SCH-1',                app1.id === 'SCH-1');
ok('status is pending',          app1.status === 'pending');
ok('submittedAt is set',         typeof app1.submittedAt === 'string' && app1.submittedAt.length > 0);
ok('name is preserved',          app1.name === validRec.name);
ok('email is preserved',         app1.email === validRec.email);
var app5 = core.makeApplication(validRec, 5, 0);
ok('seq 5 → SCH-5',              app5.id === 'SCH-5');

/* ---- makeWaitlistEntry ---- */
head('makeWaitlistEntry');
var wl1 = core.makeWaitlistEntry({ name: 'Chisom Eze', email: 'chisom@example.com', phone: '08011111111' }, 1, 0);
ok('valid entry → entry object',  !wl1.error && !!wl1.entry);
ok('id is WL-1',                  wl1.entry && wl1.entry.id === 'WL-1');
ok('status is waiting',           wl1.entry && wl1.entry.status === 'waiting');
ok('name is preserved',           wl1.entry && wl1.entry.name === 'Chisom Eze');
ok('email is lowercased',         wl1.entry && wl1.entry.email === 'chisom@example.com');
ok('missing name → error',        !!core.makeWaitlistEntry({ name: '', email: 'x@x.com' }, 2, 0).error);
ok('invalid email → error',       !!core.makeWaitlistEntry({ name: 'Valid Name', email: 'bad' }, 2, 0).error);

/* ---- scholarshipStatus ---- */
head('scholarshipStatus');
var st1 = core.scholarshipStatus({}, []);
ok('mode is open with no apps',   st1.mode === 'open');
ok('places is 30',                st1.places === 30);
var accepted30 = [];
for (var i = 0; i < 30; i++) accepted30.push({ status: 'accepted' });
var st2 = core.scholarshipStatus({}, accepted30);
ok('30 accepted → closed',        st2.mode === 'closed');
var st3 = core.scholarshipStatus({ waitlistOpen: true }, accepted30);
ok('30 accepted + waitlistOpen → waitlist', st3.mode === 'waitlist');
var mixed = [
  { status: 'pending'  },
  { status: 'rejected' },
  { status: 'accepted' },
  { status: 'approved' }
];
ok('only accepted+approved count toward places',
   core.scholarshipStatus({}, mixed).mode === 'open');

/* ---- publicApplication ---- */
head('publicApplication');
var full = Object.assign({}, app1, { someInternalField: 'secret' });
var pub  = core.publicApplication(full);
ok('has id',           pub.id === app1.id);
ok('has status',       pub.status === 'pending');
ok('has name',         pub.name === app1.name);
ok('has email',        pub.email === app1.email);
ok('has submittedAt',  typeof pub.submittedAt === 'string');
ok('decidedAt is null when absent', pub.decidedAt === null);
ok('null input → null', core.publicApplication(null) === null);

/* ---- scholarshipCsv ---- */
head('scholarshipCsv');
var csv = core.scholarshipCsv([app1]);
ok('returns a string',            typeof csv === 'string');
ok('contains the application id', csv.indexOf('SCH-1') !== -1);
ok('contains the applicant name', csv.indexOf('Adaeze Okonkwo') !== -1);
ok('contains header row',         csv.indexOf('Status') !== -1 && csv.indexOf('Name') !== -1);
ok('empty list → header only',    core.scholarshipCsv([]).split('\r\n').length === 1);
ok('formula-injection cell prefixed with apostrophe',
   (function(){
     var danger = core.makeApplication(core.validateScholarApplication(good({ name: '=DANGEROUS()' })).rec, 99, 0);
     var c = core.scholarshipCsv([danger]);
     /* The cell should be "'=DANGEROUS()" — apostrophe prefix, never a bare = at cell start */
     return c.indexOf("\"'=DANGEROUS") !== -1 && c.indexOf('\",\"=DANGEROUS') === -1;
   })());

/* ---- summary ---- */
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
