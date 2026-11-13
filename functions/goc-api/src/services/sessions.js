/* sessions.js — durable sessions for Appwrite Functions.
   ---------------------------------------------------------------------------
   WHY: the OneBit server keeps `const sessions = new Map()`
   (server/server.js:1561) and sweeps it with setInterval. Appwrite Functions
   execute on independent, short-lived instances, so process memory cannot hold
   a session. This module persists the same session shape instead.

   IDENTITY BOUNDARIES ARE PRESERVED. Every session records which identity
   system issued it, and lookups are scoped by it, so a Free Tutorial token can
   never resolve to a staff or original-student session:

       appwrite-auth  original G.O.C students (Appwrite Auth)
       local-staff    Founder / Academic Director / managers  (scrypt)
       local-tutor    tutors                                  (scrypt)
       free2027       Free Tutorial 2027 participants          (scrypt)

   The collection is NEVER created here. If it is absent the store throws a
   ConfigurationError naming it, because silently falling back to memory would
   produce sessions that vanish between executions. Schema is defined in
   functions/goc-api/schema/sessions.json and applied manually by an operator. */
'use strict';
const tokens = require('../lib/tokens');
const { ConfigurationError } = require('../middleware/errors');

const IDENTITY_SYSTEMS = ['appwrite-auth', 'local-staff', 'local-tutor', 'free2027'];

function isNotFound(e) {
  const code = Number(e && (e.code != null ? e.code : e.status)) || 0;
  return code === 404;
}

function serialize(session) {
  return {
    tokenHash: session.tokenHash,
    identitySystem: session.identitySystem,
    accountId: String(session.accountId),
    name: session.name || '',
    role: session.role,
    roleKey: session.roleKey || '',
    title: session.title || '',
    /* Appwrite string attributes keep this portable without requiring an array
       attribute; the value is opaque to the database. */
    subjectsJson: JSON.stringify(session.subjects || []),
    mustChangePassword: !!session.mustChangePassword,
    unlocked: !!session.unlocked,
    sessionMinutes: Number(session.sessionMinutes) || 0,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt || ''
  };
}

function deserialize(doc, now) {
  if (!doc) return null;
  if (doc.revokedAt) return null;
  if (!doc.expiresAt || new Date(doc.expiresAt).getTime() <= now) return null;
  let subjects = [];
  try { subjects = JSON.parse(doc.subjectsJson || '[]'); } catch (e) { subjects = []; }
  if (!Array.isArray(subjects)) subjects = [];
  return {
    id: doc.accountId,
    name: doc.name || '',
    role: doc.role,
    roleKey: doc.roleKey || null,
    title: doc.title || null,
    identitySystem: doc.identitySystem,
    subjects,
    mustChangePassword: !!doc.mustChangePassword,
    unlocked: !!doc.unlocked,
    sessionMinutes: Number(doc.sessionMinutes) || 0,
    expires: new Date(doc.expiresAt).getTime()
  };
}

/* Appwrite-backed store. `databases` is an injected node-appwrite Databases
   instance so this module is testable without a live project. */
function createAppwriteSessionStore(opts) {
  const databases = opts.databases;
  const databaseId = opts.databaseId;
  const collectionId = opts.collectionId;
  const now = opts.now || (() => Date.now());

  if (!databases) throw new ConfigurationError('No Appwrite Databases client was provided to the session store.');

  function missing(e) {
    return new ConfigurationError(
      'The durable session collection "' + collectionId + '" in database "' + databaseId +
      '" is not reachable (' + (Number(e && (e.code || e.status)) || 'unknown') + '). ' +
      'Apply functions/goc-api/schema/sessions.json before enabling authenticated routes.'
    );
  }

  return {
    kind: 'appwrite',

    async create(input) {
      if (IDENTITY_SYSTEMS.indexOf(input.identitySystem) < 0) {
        throw new ConfigurationError('Unknown identity system: ' + input.identitySystem);
      }
      const token = tokens.generate();
      const ts = now();
      const minutes = Number(input.sessionMinutes) > 0 ? Number(input.sessionMinutes) : 60;
      const session = Object.assign({}, input, {
        tokenHash: tokens.digest(token),
        createdAt: new Date(ts).toISOString(),
        expiresAt: new Date(ts + minutes * 60000).toISOString(),
        sessionMinutes: minutes,
        revokedAt: ''
      });
      try {
        await databases.createDocument(databaseId, collectionId, tokens.documentId(token), serialize(session));
      } catch (e) {
        if (isNotFound(e)) throw missing(e);
        throw e;
      }
      return { token, expiresAt: session.expiresAt };
    },

    async get(token) {
      if (!token) return null;
      let doc;
      try {
        doc = await databases.getDocument(databaseId, collectionId, tokens.documentId(token));
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
      /* The truncated digest is only a document ID; the full digest is the
         actual credential check. */
      if (!tokens.digestsEqual(doc.tokenHash, tokens.digest(token))) return null;
      if (opts.identitySystem && doc.identitySystem !== opts.identitySystem) return null;
      return deserialize(doc, now());
    },

    async setUnlocked(token, unlocked) {
      try {
        await databases.updateDocument(databaseId, collectionId, tokens.documentId(token), { unlocked: !!unlocked });
      } catch (e) {
        if (isNotFound(e)) return false;
        throw e;
      }
      return true;
    },

    async revoke(token) {
      if (!token) return false;
      try {
        await databases.updateDocument(databaseId, collectionId, tokens.documentId(token), {
          revokedAt: new Date(now()).toISOString()
        });
      } catch (e) {
        if (isNotFound(e)) return false;
        throw e;
      }
      return true;
    },

    /* Used by password change and account deactivation. Requires the
       accountId index declared in schema/sessions.json. */
    async revokeAccount(accountId, identitySystem, listQuery) {
      const revoked = [];
      const rows = await listQuery({ accountId: String(accountId), identitySystem });
      for (const row of rows) {
        if (row.revokedAt) continue;
        await databases.updateDocument(databaseId, collectionId, row.$id, {
          revokedAt: new Date(now()).toISOString()
        });
        revoked.push(row.$id);
      }
      return revoked;
    },

    async purgeExpired(limit) {
      /* Bounded: a scheduled Function must never run unbounded work. */
      return { purged: 0, note: 'Implemented by goc-maintenance with a bounded query; see APPWRITE-FUNCTIONS-DEPLOYMENT.md.' };
    }
  };
}

/* TEST-ONLY store. Never used in production: createAppwriteSessionStore is the
   only store the gateway constructs. Exported so unit tests can exercise
   expiry/revocation semantics without a live project. */
function createMemorySessionStore(opts) {
  const now = (opts && opts.now) || (() => Date.now());
  const rows = new Map();
  return {
    kind: 'memory-test-only',
    async create(input) {
      if (IDENTITY_SYSTEMS.indexOf(input.identitySystem) < 0) throw new Error('bad identity system');
      const token = tokens.generate();
      const ts = now();
      const minutes = Number(input.sessionMinutes) > 0 ? Number(input.sessionMinutes) : 60;
      const doc = serialize(Object.assign({}, input, {
        tokenHash: tokens.digest(token),
        createdAt: new Date(ts).toISOString(),
        expiresAt: new Date(ts + minutes * 60000).toISOString(),
        sessionMinutes: minutes,
        revokedAt: ''
      }));
      doc.$id = tokens.documentId(token);
      rows.set(doc.$id, doc);
      return { token, expiresAt: doc.expiresAt };
    },
    async get(token) {
      const doc = rows.get(tokens.documentId(token));
      if (!doc) return null;
      if (!tokens.digestsEqual(doc.tokenHash, tokens.digest(token))) return null;
      if (opts && opts.identitySystem && doc.identitySystem !== opts.identitySystem) return null;
      return deserialize(doc, now());
    },
    async setUnlocked(token, unlocked) {
      const doc = rows.get(tokens.documentId(token));
      if (!doc) return false;
      doc.unlocked = !!unlocked;
      return true;
    },
    async revoke(token) {
      const doc = rows.get(tokens.documentId(token));
      if (!doc) return false;
      doc.revokedAt = new Date(now()).toISOString();
      return true;
    },
    async revokeAccount(accountId, identitySystem) {
      const out = [];
      rows.forEach(function (doc, id) {
        if (doc.accountId === String(accountId) && doc.identitySystem === identitySystem && !doc.revokedAt) {
          doc.revokedAt = new Date(now()).toISOString();
          out.push(id);
        }
      });
      return out;
    },
    async purgeExpired() {
      const ts = now();
      let purged = 0;
      rows.forEach(function (doc, id) {
        if (new Date(doc.expiresAt).getTime() <= ts) { rows.delete(id); purged++; }
      });
      return { purged };
    }
  };
}

module.exports = {
  IDENTITY_SYSTEMS,
  createAppwriteSessionStore,
  createMemorySessionStore,
  _serialize: serialize,
  _deserialize: deserialize
};
