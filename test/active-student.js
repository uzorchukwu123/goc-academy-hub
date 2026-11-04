/* active-student.js — shared by the HTTP tests that need a student who can use the app straight away.
   Sign-up now leaves the account waiting for approval (no session), so this walks the real flow:
   sign up -> the founder approves -> the student logs in.
   Usage: var a = await activeStudent(call, signupBody, founderToken);
   Returns { id, token, student, signup, approve, login }; token is null if any step failed.

   Setup rules, added after the audit:
   · Registration now requires an explicit privacy-policy acceptance. The helper
     injects one (accepted: true) unless the caller supplied its own — a test
     that wants to exercise the refusal posts to /api/students directly.
   · A failed founder SIGN-IN or console UNLOCK throws a descriptive error: those
     are infrastructure failures (the test server is misconfigured), and walking
     past them only produced a cascade of confusing assertion failures downstream.
   · A failed APPROVAL is deliberately NOT thrown. Two suites depend on it:
     test-results-export.js passes a founder token whose console is still locked
     (it asserts the lock itself, then unlocks by hand) and test-tiers-route.js
     restarts the server so the cached founder session goes stale — both read
     data.json directly rather than needing an approved student. Throwing here
     broke those intentional designs, so the walk continues and returns whatever
     token the student login produced (null if approval/login failed).
   · A failed SIGN-UP still returns the signup reply unchanged, because several
     suites deliberately assert on refusals. */
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
  var signup = await call('POST', '/api/students', withConsent(body));
  var id = signup.body && signup.body.student && signup.body.student.id;
  if (!id) return { id: null, token: null, student: null, signup: signup, approve: null, login: null };
  var approve = await call('POST', '/api/students/' + id + '/approve', null, founderToken);
  /* Approval may legitimately fail here (locked console / stale founder session in
     test-results-export.js and test-tiers-route.js); those suites read data.json
     directly, so continue and let the student login decide the token. */
  var login = await call('POST', '/api/auth/login', { id: id, password: body.password });
  return {
    id: id,
    token: (login.body && login.body.token) || null,
    student: (login.body && login.body.student) || signup.body.student,
    signup: signup, approve: approve, login: login
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
  return { status: l.status, raw: l.raw, signupRaw: a.signup.raw, headers: l.headers, body: b };
};

/* Demo (browser-side) driver version of the same walk. Sign-up leaves the account pending, so:
   sign up -> the founder logs in, unlocks the console and approves -> signs out -> the new student logs in.
   `api` is the driver (mock) or any object with createStudent/login/unlockConsole/approveStudent/logout.
   Returns the sign-up reply, and leaves the new student signed in, as sign-up used to. */
module.exports.demo = async function demo(api, body) {
  var r = await api.createStudent(withConsent(body));
  var id = r && r.student && r.student.id;
  if (!id) return r;
  var fl = await api.login('GOC-A-001', 'founder2027');
  if (!fl || fl.error) throw new Error('active-student demo setup: founder login failed (' + JSON.stringify(fl) + ')');
  var un = await api.unlockConsole('2027');
  if (!un || un.error) throw new Error('active-student demo setup: console unlock failed (' + JSON.stringify(un) + ')');
  var approved = await api.approveStudent(id);
  if (!approved || approved.error) throw new Error('active-student demo setup: approval of ' + id + ' failed (' + JSON.stringify(approved) + ')');
  await api.logout();
  var sl = await api.login(id, body.password);
  if (!sl || sl.error) throw new Error('active-student demo setup: student login failed (' + JSON.stringify(sl) + ')');
  /* the approve reply is the full public record (tier and the rest); sign-up only gave id and name */
  var full = approved && (approved.student || approved);
  return full && full.id === id ? Object.assign({}, r, { student: Object.assign({}, r.student, full) }) : r;
};