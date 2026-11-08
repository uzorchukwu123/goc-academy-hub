/* router.js — the API gateway's dispatch table.
   ---------------------------------------------------------------------------
   Routes come from route-inventory.json, generated from the OneBit server by
   tools/extract-routes.js. Each entry keeps the ORIGINAL RegExp source and
   flags, so path matching and positional capture groups (params[0], params[1])
   behave exactly as they do in server/server.js.

   Three outcomes are deliberately distinguishable:

     404 {"error":"No such endpoint."}              path matches nothing
     405 {"error":"Wrong method for that endpoint."} path exists, method does not
     501 {"error":"...not yet migrated..."}          route is inventoried but its
                                                    handler is not ported yet

   The 501 is important: an unported route must never look like a route that
   does not exist, and must never fall through to a handler that would write to
   the wrong store. It makes the migration gap explicit and testable. */
'use strict';
const { ClientError } = require('./middleware/errors');
const { authorize } = require('./middleware/authorization');

function key(method, source) { return method + ' ' + source; }

function createRouter(inventory, handlers, deps) {
  const compiled = inventory.routes.map(function (r) {
    return { route: r, re: new RegExp(r.regex.source, r.regex.flags) };
  });
  const table = new Map();
  Object.keys(handlers).forEach(function (k) { table.set(k, handlers[k]); });

  function find(method, urlPath) {
    let pathExists = false;
    for (const entry of compiled) {
      const m = entry.re.exec(urlPath);
      if (!m) continue;
      pathExists = true;
      if (entry.route.method === method) {
        return { route: entry.route, params: m.slice(1), pathExists: true };
      }
    }
    return { route: null, params: [], pathExists };
  }

  return {
    /* Exposed for tests and for the coverage report. */
    total: compiled.length,
    implemented: function () {
      return compiled.filter(e => table.has(key(e.route.method, e.route.regex.source))).length;
    },
    coverage: function () {
      return compiled.map(function (e) {
        return {
          method: e.route.method,
          path: e.route.displayPath,
          family: e.route.family,
          authTier: e.route.authTier,
          capability: e.route.capability,
          status: table.has(key(e.route.method, e.route.regex.source)) ? 'implemented' : 'not-started'
        };
      });
    },

    async dispatch(ctx) {
      const hit = find(ctx.method, ctx.path);
      if (!hit.route) {
        if (hit.pathExists) throw new ClientError(405, 'Wrong method for that endpoint.');
        throw new ClientError(404, 'No such endpoint.');
      }

      const handler = table.get(key(hit.route.method, hit.route.regex.source));

      /* Authorisation runs BEFORE the migration-gap check, so an unported
         protected route cannot be probed for existence by an unauthenticated
         caller. */
      let session = null;
      if (hit.route.authTier !== 'public') {
        session = await deps.resolveSession(ctx, hit.route);
        authorize(hit.route, session, deps.core, ctx.path);
      }

      if (!handler) {
        throw new ClientError(501,
          'This endpoint is not yet migrated to Appwrite Functions (' +
          hit.route.method + ' ' + hit.route.displayPath + ').');
      }

      return handler(ctx, { route: hit.route, params: hit.params, session });
    }
  };
}

module.exports = { createRouter, key };
