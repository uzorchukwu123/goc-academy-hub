/* active-student.js — shared by the HTTP tests that need a student who can use the app straight away.
   Returns { id, token, student, signup, approve, login }; token is null if any step failed.

   Stage B note: self-registration is now application-first (registration code ->
   application -> administrative approval -> password-setup link -> access), and
   that flow is exercised end-to-end by test-registrations-route.js and
   test-registrations-appwrite.js. This helper's contract is narrower — "give me
   an active, signed-in student" — so the HTTP walk enrols through the console
   route staff use in person (POST /api/admin/students, unchanged by Stage B) and
   signs in with the temporary password it issues. The demo walk below does use
   the real registration flow, because the demo driver can hand the suite the
   setup token (test-only hook) the way the applicant's email would.

   Setup rules, added after the audit:
   · Registration now requires an explicit privacy-policy acceptance. The helper
     injects one (accepted: true) unless the caller supplied its own — a test
     that wants to exercise the refusal posts to /api/registrations directly.
   · A failed founder SIGN-IN or console UNLOCK throws a descriptive error: those
     are infrastructure failures (the test server is misconfigured), and walking
     past them only produced a cascade of confusing assertion failures downstream. */
'use strict';
var founders = new WeakMap();
/* If the test has no founder session handy, sign one in (the test servers set GOC_FOUNDER_PW and GOC_PASSCODE). */
async function founderFor(call, given) {
  if (given) return given;
  if (!founders.has(call)) {
    var l = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var t = l.body && l.body.token;
    if (!t) throw new Error('active-student setup: founder login failed (' + l.status + ' ' + (l.raw || '') + ')');
    var u = await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
    if (u.status !== 200) throw new Error('active-student setup: console unlock failed (' + u.status + ' ' + (u.raw || '') + ')');
    founders.set(call, t);
  }
  return founders.get(call);
}
function withConsent(body) {
  if (body && body.privacyConsent) return body;
  return Object.assign({}, body, { privacyConsent: { accepted: true } });
}
module.exports = async function activeStudent(call, body, founderToken) {
  founderToken = await founderFor(call, founderToken);
  var signup = await call('POST', '/api/admin/students', {
    name: body.name, email: body.email, phone: body.phone,
    goal: body.goal, subjects: body.subjects
  }, founderToken);
  var id = signup.body && signup.body.student && signup.body.student.id;
  if (!id) return { id: null, token: null, student: null, signup: signup, approve: null, login: null };
  var login = await call('POST', '/api/auth/login', { id: id, password: signup.body.temporaryPassword });
  return {
    id: id,
    token: (login.body && login.body.token) || null,
    student: (login.body && login.body.student) || signup.body.student,
    /* The console-issued temporary password, so a suite can sign the student
       back in later (logouts, deactivation checks). */
    tempPassword: signup.body.temporaryPassword || null,
    signup: signup, approve: null, login: login
  };
};

/* Same walk, but the answer looks like the old sign-up reply ({status, raw, body:{token, session, student}}),
   so a test that read r.body.token / r.body.session keeps working unchanged. */
module.exports.signedUp = async function signedUp(call, body, founderToken) {
  var a = await module.exports(call, body, founderToken);
  if (!a.token) return a.signup;
  var l = a.login;
  /* login names the signed-in person "user"; sign-up used to call the same thing "session" */
  var b = Object.assign({}, l.body, { session: l.body && l.body.user, student: { id: a.id, name: l.body && l.body.user && l.body.user.name, subjects: l.body && l.body.user && l.body.user.subjects, exam: l.body && l.body.user && l.body.user.exam } });
  return { status: l.status, raw: l.raw, signupRaw: a.signup.raw, headers: l.headers, tempPassword: a.tempPassword, body: b };
};

/* Demo (browser-side) driver version of the same walk, through the real
   Stage B flow: the founder makes a registration code -> the applicant
   submits -> the founder approves -> the applicant sets their password via
   the setup token (read through the test-only hook, as the emailed link
   would carry it) -> the new student logs in with the password they chose.
   `api` is the driver (mock). Returns a sign-up-shaped reply, and leaves
   the new student signed in, as sign-up used to. */
module.exports.demo = async function demo(api, body) {
  async function step(promise, what) {
    var r;
    try { r = await promise; } catch (e) { throw new Error('active-student demo setup: ' + what + ' failed (' + (e && e.message || e) + ')'); }
    if (!r || r.error) throw new Error('active-student demo setup: ' + what + ' failed (' + JSON.stringify(r) + ')');
    return r;
  }
  /* Older callers pass no contact details; an application needs them, so the
     walk supplies harmless stand-ins derived from the name. */
  if (!body.email) body = Object.assign({}, body, { email: String(body.name || 'student').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') + '@example.com' });
  if (!body.phone) body = Object.assign({}, body, { phone: '08000000000' });
  await step(api.login('GOC-A-001', 'founder2027'), 'founder login');
  await step(api.unlockConsole('2027'), 'console unlock');
  var codeRes = await step(api.createRegistrationCode({ label: 'active-student helper', maxUses: 100 }), 'code creation');
  var sub = await step(api.submitRegistration(withConsent(Object.assign({}, body, { code: codeRes.code }))), 'application submission');
  var apps = await api.listRegistrationApplications();
  var mine = (apps.applications || []).filter(function (a) { return a.email === String(body.email || '').toLowerCase(); }).pop();
  if (!mine) throw new Error('active-student demo setup: application not found for ' + body.email);
  var approved = await step(api.approveRegistrationApplication(mine.id), 'approval of ' + mine.id);
  var scholarId = approved.application.scholarId;
  var roster = await api.listStudents();
  var full = (Array.isArray(roster) ? roster : []).filter(function (s) { return s.id === scholarId; })[0] || null;
  /* The setup token: read through the demo driver's test-only hook, the way
     the emailed link would carry it. Some suites pass a GOC.api facade (or a
     proxy to it) rather than the driver itself, so fall back to the driver
     behind the facade. */
  var token = null;
  if (api._setupTokenFor) { try { token = await api._setupTokenFor(mine.id); } catch (e) { token = null; } }
  if (!token && api._drivers && api._drivers.mock && api._drivers.mock._setupTokenFor) {
    token = api._drivers.mock._setupTokenFor(mine.id);
  }
  await api.logout();
  if (!token) throw new Error('active-student demo setup: no setup token for ' + mine.id);
  await step(api.completePasswordSetup({ token: token, password: body.password }), 'password setup');
  await step(api.login(scholarId, body.password), 'student login');
  return { received: true, student: Object.assign({ id: scholarId, name: body.name }, full || {}) };
};
