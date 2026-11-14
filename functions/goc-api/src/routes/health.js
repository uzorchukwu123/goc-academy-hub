/* health.js — GET /api/health
   ---------------------------------------------------------------------------
   Contract source: server/server.js:3237-3259. The frontend depends on:
     • js/api.js  -> d.service === 'goc-academy-hub' to select the http driver
     • js/free2027-ui.js -> d.free2027.on === true to enter Free Tutorial mode

   So `service`, `version`, `passcodeLength` and `free2027.{on,mode}` must keep
   their existing meaning. The storage fields are informational (no frontend
   module reads them), so they report the FUNCTION's real storage model rather
   than pretending a local data.json exists.

   `readState` is injected. Until the persistence adapter is signed off against
   the live project, the gateway supplies a reader that refuses, and this route
   returns a configuration error instead of inventing a mode. */
'use strict';
const { ConfigurationError } = require('../middleware/errors');

function createHealthRoute(deps) {
  return async function health(ctx) {
    if (typeof deps.readState !== 'function') {
      throw new ConfigurationError(
        'No application-state reader is configured for the Function. ' +
        'See APPWRITE-FUNCTIONS-DEPLOYMENT.md (persistence adapter).'
      );
    }
    const state = await deps.readState();
    const settings = state.settings || {};
    const fed = state.free2027 || {};
    const rules = deps.freeRules;
    const mode = rules && typeof rules.activeMode === 'function'
      ? rules.activeMode(fed, fed.enabled === true)
      : (fed.enabled === true ? (fed.mode || 'original') : 'original');

    return {
      service: 'goc-academy-hub',
      version: 1,
      passcodeLength: Number(settings.consolePasscodeLength) || 4,
      free2027: {
        on: fed.enabled === true,
        mode,
        /* The storage MODEL only. No bucket/file identifier or filesystem
           path is reported: this endpoint is public, and where records
           physically live is deployment detail. */
        storage: 'appwrite-storage'
      }
    };
  };
}

module.exports = { createHealthRoute };
