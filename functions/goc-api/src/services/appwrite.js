/* appwrite.js — the privileged client, server-side only.
   ---------------------------------------------------------------------------
   This module is NEVER reachable from the Site build: build/build.js only
   emits js/, css/, icons/, the manifest and sw.js. Nothing under functions/ is
   copied into dist/.

   The client is constructed lazily so that a Function invocation which does not
   need Appwrite (health, CORS preflight, a 404) never opens a client at all, and
   so a missing credential surfaces as a named ConfigurationError rather than a
   crash at module load.

   Reuses the existing project/database/bucket identifiers. It never creates,
   deletes or reconfigures a project resource. */
'use strict';
const { ConfigurationError } = require('../middleware/errors');

function createAppwriteService(cfg) {
  let bundle = null;

  function requireConfigured() {
    if (cfg.appwriteOff) {
      throw new ConfigurationError('GOC_APPWRITE_OFF is set; this Function will not contact Appwrite.');
    }
    if (!cfg.configured) {
      throw new ConfigurationError('Missing required Appwrite configuration: ' + cfg.missingRequired.join(', ') + '.');
    }
  }

  function client() {
    requireConfigured();
    if (bundle) return bundle;
    /* Required lazily so unit tests can run without the SDK installed. */
    const sdk = require('node-appwrite');
    const c = new sdk.Client()
      .setEndpoint(cfg.appwrite.endpoint)
      .setProject(cfg.appwrite.projectId)
      .setKey(cfg.appwrite.apiKey);
    bundle = {
      sdk,
      client: c,
      databases: new sdk.Databases(c),
      storage: new sdk.Storage(c),
      users: new sdk.Users(c)
    };
    return bundle;
  }

  return {
    get databases() { return client().databases; },
    get storage() { return client().storage; },
    get users() { return client().users; },
    get sdk() { return client().sdk; },
    requireConfigured
  };
}

module.exports = { createAppwriteService };
