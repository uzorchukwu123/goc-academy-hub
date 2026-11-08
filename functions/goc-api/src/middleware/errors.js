/* errors.js — one place where an exception becomes a response.
   ---------------------------------------------------------------------------
   Mirrors the OneBit contract exactly (server/server.js:1724-1725):

       success -> 200 with the payload as-is
       failure -> <status> with { "error": "<message>" }

   ClientError carries a message the application deliberately wrote for the
   person using it, so it is safe to echo. Anything else is internal: it is
   logged server-side and replaced with a fixed generic string, so a stack
   trace, credential or document ID can never reach the browser. */
'use strict';

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
  }
}

/* Configuration problems are operator-facing, not user-facing. The response
   names the missing variable/collection but never a value. */
class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
    this.status = 503;
  }
}

const GENERIC = 'The server could not complete that request.';

function toResponse(err, log) {
  if (err instanceof ClientError) {
    return { status: err.status, body: { error: err.message } };
  }
  if (err instanceof ConfigurationError) {
    if (log) log('configuration error: ' + err.message);
    return { status: 503, body: { error: 'This service is not configured yet. Contact the academy.' } };
  }
  if (log) log('internal error: ' + (err && err.message ? err.message : String(err)));
  return { status: 500, body: { error: GENERIC } };
}

module.exports = { ClientError, ConfigurationError, toResponse, GENERIC };
