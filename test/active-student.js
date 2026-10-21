/* active-student.js — shared by the HTTP tests that need a student who can use the app straight away.
   Sign-up now leaves the account waiting for approval (no session), so this walks the real flow:
   sign up -> the founder approves -> the student logs in.
   Usage: var a = await activeStudent(call, signupBody, founderToken);
   Returns { id, token, student, signup, approve, login }; token is null if any step failed. */
'use strict';
var founders = new WeakMap();
/* If the test has no founder session handy, sign one in (the test servers set GOC_FOUNDER_PW and GOC_PASSCODE). */
async function founderFor(call, given) {
  if (given) return given;
  if (!founders.has(call)) {
    var l = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var t = l.body && l.body.token;
    if (t) await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
    founders.set(call, t || null);
  }
  return founders.get(call);
}
module.exports = async function activeStudent(call, body, founderToken) {
  founderToken = await founderFor(call, founderToken);
  var signup = await call('POST', '/api/students', body);
  var id = signup.body && signup.body.student && signup.body.student.id;
  if (!id) return { id: null, token: null, student: null, signup: signup, approve: null, login: null };
  var approve = await call('POST', '/api/students/' + id + '/approve', null, founderToken);
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
  var r = await api.createStudent(body);
  var id = r && r.student && r.student.id;
  if (!id) return r;
  await api.login('GOC-A-001', 'founder2027');
  await api.unlockConsole('2027');
  var approved = await api.approveStudent(id);
  await api.logout();
  await api.login(id, body.password);
  /* the approve reply is the full public record (tier and the rest); sign-up only gave id and name */
  var full = approved && (approved.student || approved);
  return full && full.id === id ? Object.assign({}, r, { student: Object.assign({}, r.student, full) }) : r;
};
