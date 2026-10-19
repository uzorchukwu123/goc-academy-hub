/* test-roles.js — administrative roles, slice B#1(a): the pure role -> capability map.
   Nothing in the app uses it yet; this pins the owner's decisions of 10-11 Oct 2026.
   node test/test-roles.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var F = 'founder', AD = 'academic-director', FIN = 'finance', PUB = 'publicity', SA = 'student-affairs';
var MANAGERS = [AD, FIN, PUB, SA];
/* who holds a capability, Founder always included */
function holders(cap) { return core.rolesWithCapability(cap).slice().sort().join(','); }
function only(cap, roles) { return holders(cap) === [F].concat(roles).sort().join(','); }

console.log('\nthe five roles');
ok('there are exactly five roles', core.ADMIN_ROLES.length === 5);
ok('titles match the plan', core.adminRoleTitle(F) === 'Founder & Executive Director' && core.adminRoleTitle(AD) === 'Academic Director' && core.adminRoleTitle(FIN) === 'Finance & Administration Manager' && core.adminRoleTitle(PUB) === 'Publicity & Communications Manager' && core.adminRoleTitle(SA) === 'Student Affairs & Operations Coordinator');
ok('the existing account title "Founder" still maps to the Founder', core.adminRoleKey('Founder') === F);
ok('a full title maps to its key, any case', core.adminRoleKey('academic director') === AD && core.adminRoleKey('FINANCE & ADMINISTRATION MANAGER') === FIN);
ok('an unknown or empty role maps to nothing', core.adminRoleKey('Tutor') === null && core.adminRoleKey('') === null && core.adminRoleKey(null) === null && core.adminRoleKey(undefined) === null);
ok('the Managers panel offers the four non-Founder roles', core.managerRoles().map(function (r) { return r.key; }).join(',') === MANAGERS.join(','));

console.log('\nthe Founder');
var all = core.allCapabilities();
ok('the Founder holds every capability', all.every(function (c) { return core.roleCan(F, c); }) && core.capabilitiesOf(F).length === all.length);
ok('the Founder holds everything every manager holds', MANAGERS.every(function (m) { return core.capabilitiesOf(m).every(function (c) { return core.roleCan(F, c); }); }));
ok('the Founder alias "Founder" holds everything too', core.capabilitiesOf('Founder').length === all.length);
var founderOnly = ['cohort.create', 'tutors.accounts', 'tutors.assign', 'tutors.audit', 'managers.accounts', 'managers.passcode', 'firewall.manage', 'scholarship.approve', 'termreport.signoff', 'overview.all'];
ok('each Founder-only capability belongs to the Founder alone', founderOnly.every(function (c) { return holders(c) === F; }));
ok('no manager holds any Founder-only capability', MANAGERS.every(function (m) { return founderOnly.every(function (c) { return !core.roleCan(m, c); }); }));

console.log('\nthe Academic Director loses all-sections access');
ok('the Academic Director has fewer capabilities than the Founder', core.capabilitiesOf(AD).length < all.length);
ok('cannot create cohorts, tutors or managers, or touch the firewall', !core.roleCan(AD, 'cohort.create') && !core.roleCan(AD, 'tutors.accounts') && !core.roleCan(AD, 'managers.accounts') && !core.roleCan(AD, 'firewall.manage'));
ok('loses the sign-up limits', !core.roleCan(AD, 'signup.limits'));
ok('cannot approve students, switch tiers or deactivate accounts (Finance does)', !core.roleCan(AD, 'students.approve') && !core.roleCan(AD, 'students.tier') && !core.roleCan(AD, 'students.deactivate'));
ok('cannot see payment records', !core.roleCan(AD, 'payments.view'));

console.log('\nfinance and student accounts');
ok('approve, add, switch tier, deactivate: Finance and the Founder only', ['students.approve', 'students.add', 'students.tier', 'students.deactivate'].every(function (c) { return only(c, [FIN]); }));
ok('payment records: Finance and the Founder only', only('payments.view', [FIN]));
ok('Student Affairs no longer approves, adds or switches', !core.roleCan(SA, 'students.approve') && !core.roleCan(SA, 'students.add') && !core.roleCan(SA, 'students.tier'));
ok('Student Affairs still resets passwords', core.roleCan(SA, 'students.passwords') && !core.roleCan(FIN, 'students.passwords'));

console.log('\nteaching and content (Academic Director)');
ok('live classes and Zoom links: Academic Director only', only('classes.schedule', [AD]));
ok('Resources and Videos: Academic Director only', only('resources.publish', [AD]));
ok('objective and JAMB sittings and the study window: Academic Director and Founder', only('sittings.configure', [AD]));
ok('removing an assignment after submissions: Academic Director and Founder', only('assignments.remove', [AD]));
ok('question bank, approvals, courses, theory marking, mastery: Academic Director', ['questions.manage', 'approvals.review', 'courses.manage', 'theory.mark', 'mastery.view', 'assignments.oversee'].every(function (c) { return only(c, [AD]); }));

console.log('\nresults and reports');
ok('seeing results and marks: Academic Director and Student Affairs', only('results.view', [AD, SA]));
ok('exporting results: Student Affairs and the Academic Director', only('results.export', [AD, SA]));
ok('class summaries and weak topics: Academic Director and Student Affairs', only('classsummary.view', [AD, SA]));
ok('report cards: Student Affairs, no longer the Academic Director', only('reportcards.generate', [SA]) && !core.roleCan(AD, 'reportcards.generate'));
ok('term report pack: Student Affairs produces, only the Founder signs off', only('termreport.produce', [SA]) && holders('termreport.signoff') === F && !core.roleCan(FIN, 'termreport.produce'));
ok('leaderboard: Academic Director and Student Affairs', only('leaderboard.manage', [AD, SA]));
ok('study-pair moderation, student activeness, needs-attention: Student Affairs', ['studypairs.moderate', 'activeness.view', 'attention.view'].every(function (c) { return only(c, [SA]); }));

console.log('\nmessages and public content');
ok('broadcasts: Publicity and Student Affairs', only('broadcast.send', [PUB, SA]));
ok('contact form messages: Publicity and Student Affairs', only('contact.handle', [PUB, SA]));
ok('class notices: Academic Director and Publicity', only('notices.manage', [AD, PUB]));
ok('homepage updates and daily affirmations: Publicity and Academic Director', only('homepage.edit', [PUB, AD]));
ok('website analytics: Publicity only (and the Founder)', only('analytics.site', [PUB]));
ok('Student Affairs cannot see website analytics; Publicity cannot see named student activity', !core.roleCan(SA, 'analytics.site') && !core.roleCan(PUB, 'activeness.view'));
ok('AI tip, WhatsApp links, landing text: Publicity', ['aitip.edit', 'whatsapp.links', 'landing.text'].every(function (c) { return only(c, [PUB]); }));

console.log('\ncohorts, sign-up limits, scholarship');
ok('creating a cohort is Founder only; managing one is Student Affairs', holders('cohort.create') === F && only('cohort.manage', [SA]) && only('cohort.limits', [SA]));
ok('sign-up limits: Founder and Student Affairs', only('signup.limits', [SA]));
ok('extra daily study time for a GOC student: granted by Student Affairs (and the Founder), not Finance, Publicity or the Academic Director', only('studytime.grant', [SA]) && !core.roleCan(FIN, 'studytime.grant') && !core.roleCan(PUB, 'studytime.grant') && !core.roleCan(AD, 'studytime.grant'));
ok('opening scholarship applications: Student Affairs, Academic Director, Founder; not Finance or Publicity', only('scholarship.view', [AD, SA]) && !core.roleCan(FIN, 'scholarship.view') && !core.roleCan(PUB, 'scholarship.view'));
ok('accept/reject, CSV export and deletion: Student Affairs; approving acceptances: Founder only', ['scholarship.decide', 'scholarship.export', 'scholarship.delete'].every(function (c) { return only(c, [SA]); }) && holders('scholarship.approve') === F);
ok('manager-action log: Founder and Academic Director', only('managerlog.view', [AD]));
ok('the tutor-view audit log is Founder only', holders('tutors.audit') === F);

console.log('\noverview');
ok('every role sees its own overview', core.ADMIN_ROLES.every(function (r) { return core.roleCan(r.key, 'overview.own'); }));
ok('only the Founder sees the whole academy', holders('overview.all') === F);

console.log('\nsafe by default');
ok('an unknown role is refused everything', !core.roleCan('Tutor', 'results.view') && !core.roleCan('', 'results.view') && !core.roleCan(null, 'results.view') && core.capabilitiesOf('Tutor').length === 0);
ok('an unknown capability is refused, even for the Founder', !core.roleCan(F, 'made.up') && !core.roleCan(F, '') && !core.roleCan(F, undefined));
ok('a prototype name is not a capability', !core.roleCan(F, 'constructor') && !core.roleCan(F, 'toString') && !core.roleCan(F, '__proto__'));
ok('roleCanAny works and refuses a non-list', core.roleCanAny(FIN, ['results.view', 'students.tier']) && !core.roleCanAny(FIN, ['results.view']) && !core.roleCanAny(FIN, 'students.tier') && !core.roleCanAny(FIN, []));
ok('the lists handed out are fresh copies', (function () { var a = core.allCapabilities(), m = core.managerRoles(), c = core.capabilitiesOf(F); a.push('x'); m.push({}); c.push('y'); return core.allCapabilities().indexOf('x') === -1 && core.managerRoles().length === 4 && core.capabilitiesOf(F).indexOf('y') === -1; })());
ok('every capability name is lower-case dotted', all.every(function (c) { return /^[a-z]+\.[a-z]+$/.test(c); }));
ok('every non-Founder role holds at least one capability', MANAGERS.every(function (m) { return core.capabilitiesOf(m).length > 1; }));

console.log('\nissuing manager IDs');
ok('the first manager is GOC-A-003', core.nextAdminId(['GOC-A-001', 'GOC-A-002']) === 'GOC-A-003');
ok('the next follows the highest', core.nextAdminId(['GOC-A-001', 'GOC-A-002', 'GOC-A-003', 'GOC-A-004']) === 'GOC-A-005');
ok('a gap is not refilled', core.nextAdminId(['GOC-A-001', 'GOC-A-002', 'GOC-A-006']) === 'GOC-A-007');
ok('nothing, junk and tutor IDs are ignored', core.nextAdminId() === 'GOC-A-003' && core.nextAdminId([null, 'x', 'GOC-T-009', 'GOC-A-abc']) === 'GOC-A-003');
ok('past 999 it keeps counting', core.nextAdminId(['GOC-A-999']) === 'GOC-A-1000');

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
