/* authorization.js — server-side guards, ported verbatim in behaviour.
   ---------------------------------------------------------------------------
   Source of truth: server/server.js:9606-9660. Every status code and every
   message below is copied from the OneBit server so the existing frontend
   reacts identically (it matches on some of these strings).

   The capability map is NOT reimplemented here. It is read from the same
   js/goc-core.js the browser and the OneBit server already share, via
   core.adminMayUse, so role permissions cannot drift between deployments.

   Nothing in this module trusts a client-supplied role: `session` comes only
   from the durable session store after a token digest match. */
'use strict';
const { ClientError } = require('./errors');

function deny(status, message) { throw new ClientError(status, message); }

/* `core` is injected (js/goc-core.js) so this stays unit-testable. */
function authorize(route, session, core, urlPath) {
  const tier = route.authTier;

  if (tier === 'public') return;

  /* Free Tutorial participants are a SEPARATE identity system. A free token
     must never satisfy an original-hub tier, and vice versa. */
  if (tier === 'free') {
    if (!session) deny(401, 'Verify your email to continue.');
    if (session.identitySystem !== 'free2027') deny(401, 'Verify your email to continue.');
    if (session.active === false) deny(403, 'This email address has been switched off for this programme.');
    return;
  }

  if (tier === 'student') {
    if (!session) deny(401, 'Your session has ended. Please log in again.');
    if (session.role !== 'student') deny(403, 'Student accounts only.');
    if (session.active === false) deny(403, 'This account has been deactivated by your academy.');
    return;
  }

  if (tier === 'tutor' || tier === 'tutor-setup') {
    if (!session) deny(401, 'Please log in again.');
    if (session.role !== 'tutor') deny(403, 'Tutor accounts only.');
    if (session.active === false) deny(403, 'This account has been deactivated by your academy.');
    return;
  }

  if (tier === 'staff-or-student') {
    if (!session) deny(401, 'Please log in again.');
    if (['admin', 'student'].indexOf(session.role) < 0) deny(403, 'Management or student accounts only.');
    return;
  }

  if (tier === 'staff' || tier === 'console' || tier === 'founder') {
    if (!session) deny(401, 'Please log in again.');
    if (session.role !== 'admin') deny(403, 'Management accounts only.');
    if (tier !== 'staff' && !session.unlocked) deny(403, 'Enter the access passcode first.');
    if (tier !== 'staff' && session.mustChangePassword) deny(403, 'Change your starting password first.');

    if (tier === 'console' && /^\/api\/free2027\/admin\//.test(urlPath) &&
        ['founder', 'academic-director'].indexOf(session.roleKey) < 0) {
      deny(403, 'The Free Tutorial Console is for the Founder and Academic Director.');
    }
    if (tier === 'console' && !core.adminMayUse(session.id, session.roleKey, route.capability)) {
      deny(403, 'Your role does not include this.');
    }
    if (tier === 'console' && session.roleKey === 'academic-director' &&
        /^\/api\/free2027\/admin\//.test(urlPath) &&
        (/^\/api\/free2027\/admin\/(mode|edition)$/.test(urlPath) || route.capability === 'system.migrate')) {
      deny(403, 'Only the Founder can change Free Tutorial system settings or archive programme data.');
    }
    if (tier === 'founder' && session.title !== 'Founder') {
      deny(403, 'Only the Founder can change management credentials.');
    }
    return;
  }

  /* An unrecognised tier is refused, never allowed. */
  deny(403, 'Your role does not include this.');
}

module.exports = { authorize };
