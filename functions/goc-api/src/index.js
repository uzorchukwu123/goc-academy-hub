/* index.js — goc-api Function entry point.
   ---------------------------------------------------------------------------
   Keeps the OneBit HTTP contract: same paths, same methods, same JSON envelope
   ({...} on success, {"error": "..."} on failure), same 404/405 wording.

   Everything Appwrite-specific is confined to the thin adapter at the bottom,
   so `createHandler` can be unit-tested with plain objects and no live project.

   Security posture:
     • CORS is an explicit allow-list; no wildcard default.
     • Body size is capped before parsing.
     • Sessions come only from the durable store, never from client claims.
     • Authorisation runs before the not-yet-migrated check, so unported
       protected routes cannot be enumerated by an anonymous caller.
     • Errors pass through one mapper that never echoes internals. */
'use strict';
const config = require('./config');
const inventory = require('../route-inventory.json');
const { createRouter, key } = require('./router');
const { ClientError, ConfigurationError, toResponse } = require('./middleware/errors');
const { createAppwriteService } = require('./services/appwrite');
const { createAppwriteSessionStore, IDENTITY_SYSTEMS } = require('./services/sessions');
const { createHealthRoute } = require('./routes/health');

/* Which identity systems may satisfy each tier. A Free Tutorial token can never
   satisfy a staff tier, and a staff token can never satisfy the free tier. */
const TIER_IDENTITIES = {
  free: ['free2027'],
  student: ['appwrite-auth'],
  tutor: ['local-tutor'],
  'tutor-setup': ['local-tutor'],
  staff: ['local-staff'],
  console: ['local-staff'],
  founder: ['local-staff'],
  'staff-or-student': ['local-staff', 'appwrite-auth']
};

function bearer(headers) {
  const h = headers || {};
  const raw = h.authorization || h.Authorization || '';
  const v = String(raw);
  return v.indexOf('Bearer ') === 0 ? v.slice(7).trim() : null;
}

function createHandler(deps) {
  const cfg = deps.cfg;
  const core = deps.core;

  const handlers = {};
  handlers[key('GET', '^\\/api\\/health$')] = createHealthRoute({
    readState: deps.readState,
    freeRules: core,
    cfg
  });
  if (deps.extraHandlers) Object.assign(handlers, deps.extraHandlers);

  const router = createRouter(inventory, handlers, {
    core,
    resolveSession: async function (ctx, route) {
      const token = bearer(ctx.headers);
      if (!token) return null;
      if (!deps.sessions) {
        throw new ConfigurationError('No durable session store is configured for this Function.');
      }
      const session = await deps.sessions.get(token);
      if (!session) return null;
      const allowed = TIER_IDENTITIES[route.authTier] || [];
      if (allowed.indexOf(session.identitySystem) < 0) return null;
      return session;
    }
  });

  function corsHeaders(origin) {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (origin && cfg.allowedOrigins.indexOf(String(origin).replace(/\/+$/, '')) > -1) {
      headers['access-control-allow-origin'] = origin;
      headers['vary'] = 'Origin';
      headers['access-control-allow-headers'] = 'Authorization, Content-Type, Accept';
      headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    }
    return headers;
  }

  return {
    router,
    async handle(req) {
      const method = String(req.method || 'GET').toUpperCase();
      const origin = (req.headers || {}).origin || (req.headers || {}).Origin || '';
      const headers = corsHeaders(origin);

      if (method === 'OPTIONS') return { status: 204, body: null, headers };

      /* A cross-origin browser call from an unapproved origin is refused rather
         than answered without CORS headers (which would be a confusing failure
         in the browser and no protection at all against non-browser callers). */
      if (origin && cfg.allowedOrigins.length &&
          cfg.allowedOrigins.indexOf(String(origin).replace(/\/+$/, '')) < 0) {
        return { status: 403, body: { error: 'This origin is not allowed to call this API.' }, headers };
      }

      /* Maintenance mode (GOC_MAINTENANCE_MODE): decided here, before the body
         is parsed and before any session is resolved, so no route below can
         see the request. Health stays available so a monitor can tell the
         Function is up, but it names nothing beyond the service and the fact
         of maintenance. Matches server/lib/maintenance.js. */
      const reqPath = String(req.path || '/').split('?')[0];
      if (cfg.maintenanceMode) {
        if (method === 'GET' && reqPath === '/api/health') {
          return {
            status: 200,
            body: { service: 'goc-academy-hub', version: 1, maintenance: true },
            headers
          };
        }
        return {
          status: 503,
          body: {
            error: 'G.O.C Academy Hub is temporarily unavailable while improvements are completed. Please check back later.',
            maintenance: true
          },
          headers: Object.assign({}, headers, { 'retry-after': '3600' })
        };
      }

      try {
        const raw = req.bodyRaw !== undefined && req.bodyRaw !== null
          ? String(req.bodyRaw)
          : (req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || ''));
        if (Buffer.byteLength(raw, 'utf8') > cfg.maxBodyBytes) {
          throw new ClientError(413, 'Request too large.');
        }
        let body = null;
        if (raw) {
          try { body = JSON.parse(raw); }
          catch (e) { throw new ClientError(400, 'That request was not valid JSON.'); }
        }

        const ctx = {
          method,
          path: String(req.path || '/').split('?')[0],
          headers: req.headers || {},
          query: req.query || {},
          body
        };
        const out = await router.dispatch(ctx);
        return { status: 200, body: out, headers };
      } catch (err) {
        const r = toResponse(err, deps.log);
        return { status: r.status, body: r.body, headers };
      }
    }
  };
}

/* ---------------------------------------------------------------- Appwrite glue
   Appwrite's Node runtime invokes the default export with { req, res, log }.
   `res.json(payload, status, headers)` is the documented response helper.
   Verify the runtime ID against your project before deploying — see
   APPWRITE-FUNCTIONS-DEPLOYMENT.md. */
module.exports = async function (context) {
  const req = context.req;
  const res = context.res;
  const log = context.log || function () {};
  const cfg = config.load(process.env);

  let core = null;
  let sessions = null;
  let readState;
  try {
    /* js/goc-core.js is the shared browser/server rules module. It is copied
       into the Function bundle by the deploy step so marking, roles and mode
       rules are never reimplementable here. */
    core = require('../shared/goc-core.js');
  } catch (e) {
    core = require('../../../js/goc-core.js');
  }

  if (cfg.configured && !cfg.appwriteOff) {
    const aw = createAppwriteService(cfg);
    sessions = createAppwriteSessionStore({
      databases: aw.databases,
      databaseId: cfg.databaseId,
      collectionId: cfg.sessionsCollection
    });
  }

  const app = createHandler({ cfg, core, sessions, readState, log });
  const out = await app.handle({
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
    bodyRaw: req.bodyRaw
  });
  if (out.body === null) return res.empty();
  return res.json(out.body, out.status, out.headers);
};

module.exports.createHandler = createHandler;
module.exports.TIER_IDENTITIES = TIER_IDENTITIES;
module.exports.IDENTITY_SYSTEMS = IDENTITY_SYSTEMS;
