/* mailstatus.js — safe classification of the SMTP / Brevo verification-email
   configuration. Used by server/server.js for the Founder's diagnostic.

   SECURITY: every function here reports ONLY whether a variable is set, never
   its value. No host names, user names, keys or secrets are ever returned,
   logged or rendered. */
'use strict';

/* The exact environment variables the backend reads, in one place:
     GOC_SMTP_HOST   — SMTP host (Brevo: smtp-relay.brevo.com)
     GOC_SMTP_PORT   — SMTP port (Brevo: 587, STARTTLS)
     GOC_SMTP_SECURE — '1'/'true' for implicit TLS (port 465); leave unset for 587
     GOC_SMTP_USER   — SMTP login (Brevo: the SMTP username, not the account email)
     GOC_SMTP_PASS   — SMTP key (Brevo: the generated SMTP key)
     GOC_SMTP_FROM   — sender address; must be an authorized sender in Brevo
     GOC_FREE_2027_OTP_SECRET — >=32-char secret for OTP hashing (edition) */
var REQUIRED = ['GOC_SMTP_HOST', 'GOC_SMTP_USER', 'GOC_SMTP_PASS', 'GOC_FREE_2027_OTP_SECRET'];
var OPTIONAL = ['GOC_SMTP_PORT', 'GOC_SMTP_SECURE', 'GOC_SMTP_FROM'];

var BREVO_HINT =
  'Brevo SMTP: GOC_SMTP_HOST=smtp-relay.brevo.com, GOC_SMTP_PORT=587, ' +
  'GOC_SMTP_SECURE unset (STARTTLS on 587), GOC_SMTP_USER=<Brevo SMTP login>, ' +
  'GOC_SMTP_PASS=<Brevo SMTP key>, GOC_SMTP_FROM=<an authorized Brevo sender>, ' +
  'GOC_FREE_2027_OTP_SECRET=<at least 32 random characters>.';

/* Classify an env object into one of:
     'missing'      — none of the required variables are set
     'incomplete'   — some required variables are set but not all (or the
                      user/pass pair is broken, or the OTP secret is too short)
     'configured'   — every required variable is present and well-formed
   `missing` lists variable NAMES only. Values never leave this module. */
function classifySmtpEnv(env) {
  env = env || {};
  function val(n) { return String(env[n] == null ? '' : env[n]); }
  var host = val('GOC_SMTP_HOST').trim();
  var user = val('GOC_SMTP_USER').trim();
  var pass = val('GOC_SMTP_PASS');
  var secret = val('GOC_FREE_2027_OTP_SECRET');
  var missing = [];
  if (!host) missing.push('GOC_SMTP_HOST');
  /* A local dummy capture (Mailpit/MailHog) legitimately runs with NO auth, so
     an empty user/pass pair is fine; a HALF-set pair is a misconfiguration. */
  if (!user !== !pass) missing.push(user ? 'GOC_SMTP_PASS' : 'GOC_SMTP_USER');
  if (secret.length < 32) missing.push('GOC_FREE_2027_OTP_SECRET');

  var anySet = REQUIRED.concat(OPTIONAL).some(function (n) { return val(n).trim() !== ''; });
  var status = missing.length === 0 ? 'configured' : (anySet ? 'incomplete' : 'missing');
  return {
    status: status,
    missing: missing,                                   /* names only */
    auth: !user && !pass ? 'none (local capture)' : 'smtp',
    set: {                                             /* booleans only */
      GOC_SMTP_HOST: !!host,
      GOC_SMTP_PORT: val('GOC_SMTP_PORT').trim() !== '',
      GOC_SMTP_SECURE: val('GOC_SMTP_SECURE').trim() !== '',
      GOC_SMTP_USER: !!user,
      GOC_SMTP_PASS: !!pass,
      GOC_SMTP_FROM: val('GOC_SMTP_FROM').trim() !== '',
      GOC_FREE_2027_OTP_SECRET: secret.length >= 32
    },
    brevoHint: BREVO_HINT
  };
}

/* Turn a live transport check into a final status:
     'configured' + verify ok  -> 'ready'
     'configured' + verify fail -> 'unreachable'
   `detail` is a fixed, non-sensitive explanation. */
function withLiveCheck(classified, verifyOk) {
  var out = {
    status: classified.status,
    missing: classified.missing,
    set: classified.set,
    brevoHint: classified.brevoHint,
    liveChecked: true
  };
  if (classified.status === 'configured') {
    out.status = verifyOk ? 'ready' : 'unreachable';
    if (!verifyOk) out.detail = 'SMTP connection failed. Check host, port, TLS mode and that the credentials are valid; the values themselves are never shown.';
  } else {
    out.detail = 'Configuration is ' + classified.status + '. Set the missing variables listed above before testing delivery.';
  }
  return out;
}

module.exports = { classifySmtpEnv: classifySmtpEnv, withLiveCheck: withLiveCheck, BREVO_HINT: BREVO_HINT, REQUIRED: REQUIRED };
