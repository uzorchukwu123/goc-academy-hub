/* Server-only configuration for the Founder contact entrance.
   --------------------------------------------------------------------------
   The configured phrase is never sent to the browser, written to a public
   configuration endpoint, or included in a log/error message. This module is
   required only by server/server.js; it is not a browser script and holds no
   authentication state. A matching phrase is only an identity REQUEST: the
   existing staff login and Admin Console Gate still decide access.

   GOC_FOUNDER_GATE_WORD must be 12–200 characters, have no leading/trailing
   whitespace and contain no control characters. Matching is exact (case,
   spaces and punctuation all matter). GOC_FOUNDER_EMAIL must be an explicitly
   configured, syntactically valid address. There is deliberately no derived
   address and no fallback to a staff-record email: an unset/invalid value
   closes the Founder entrance safely while ordinary contact still works. */
'use strict';

const crypto = require('crypto');

const GATE_WORD_MIN = 12;
const GATE_WORD_MAX = 200;
const EMAIL_MAX = 160;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function configuredGateWord(env) {
  const value = (env || process.env).GOC_FOUNDER_GATE_WORD;
  if (typeof value !== 'string') return null;
  if (value.length < GATE_WORD_MIN || value.length > GATE_WORD_MAX) return null;
  if (value.trim() !== value || !/\S/.test(value) || CONTROL_RE.test(value)) return null;
  return value;
}

function configuredEmail(env) {
  const value = (env || process.env).GOC_FOUNDER_EMAIL;
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/* Hash first so timingSafeEqual always receives equal-length buffers and the
   comparison does not reveal the configured phrase's length. The value itself
   is never returned in a response or an error. */
function matchesGateWord(message, gateWord) {
  if (typeof message !== 'string' || typeof gateWord !== 'string' || !gateWord) return false;
  const a = crypto.createHash('sha256').update(message, 'utf8').digest();
  const b = crypto.createHash('sha256').update(gateWord, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/* A value-free status for startup diagnostics only. It names the variable that
   needs attention, never the configured phrase or address. */
function configurationStatus(env) {
  if (!configuredGateWord(env)) return 'closed: set a valid GOC_FOUNDER_GATE_WORD';
  if (!configuredEmail(env)) return 'closed: set a valid GOC_FOUNDER_EMAIL';
  return 'configured';
}

module.exports = {
  GATE_WORD_MIN,
  GATE_WORD_MAX,
  configuredGateWord,
  configuredEmail,
  matchesGateWord,
  configurationStatus
};
