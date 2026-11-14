/* config.js — the Function's single configuration point.
   ---------------------------------------------------------------------------
   Reuses the EXISTING environment-variable names from the OneBit deployment so
   the same secret set can be pasted into Appwrite Function variables without
   renaming anything (see APPWRITE-ENVIRONMENT.md).

   Rules enforced here:
     • Privileged values are read from the Function environment only. Nothing in
       this module is ever imported by the browser build.
     • No value is ever logged. `describe()` reports NAMES and booleans only.
     • Defaults match the existing server's defaults (goc_academy / goc-data /
       academy-data-json) so an operator does not have to restate them.
     • Missing required configuration is reported by NAME, never by value. */
'use strict';

function str(env, name, fallback) {
  const v = env[name];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function bool(env, name) {
  return ['1', 'true', 'on', 'yes'].indexOf(String(env[name] || '').trim().toLowerCase()) > -1;
}

function int(env, name, fallback) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/* Comma-separated list of exact origins allowed to call this API from a
   browser. No wildcard default: an unset list means same-origin/non-browser
   callers only, which is the safe failure mode. */
function origins(env) {
  return str(env, 'GOC_ALLOWED_ORIGINS', '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function load(env) {
  env = env || {};
  const cfg = {
    appwrite: {
      endpoint: str(env, 'APPWRITE_ENDPOINT', ''),
      projectId: str(env, 'APPWRITE_PROJECT_ID', ''),
      apiKey: str(env, 'APPWRITE_API_KEY', '')
    },
    databaseId: str(env, 'GOC_DATABASE_ID', 'goc_academy'),
    bucketId: str(env, 'GOC_BUCKET_ID', str(env, 'APPWRITE_BUCKET_ID', 'goc-data')),
    backupFileId: str(env, 'GOC_BACKUP_FILE_ID', str(env, 'APPWRITE_FILE_ID', 'academy-data-json')),
    sessionsCollection: str(env, 'GOC_SESSIONS_COLLECTION', 'sessions'),
    allowedOrigins: origins(env),
    maxBodyBytes: int(env, 'GOC_MAX_BODY_BYTES', 1024 * 1024),
    /* Which hosting environment owns the scheduled jobs. Exactly one of
       'onebit' or 'appwrite' may own them, so running both deployments cannot
       double-send reminders. See APPWRITE-ROLLBACK.md. */
    jobOwner: str(env, 'GOC_JOB_OWNER', 'onebit'),
    /* Mirrors the OneBit switch. When true the Function must refuse privileged
       Appwrite work rather than silently contacting a project it was told to
       leave alone. */
    appwriteOff: bool(env, 'GOC_APPWRITE_OFF'),
    /* Same name and same truthy values as the Node server's maintenance
       switch. When on, every route except a minimal GET /api/health answers
       503, so a stale static Site shell can never reach student data or
       perform an action while the platform is under maintenance.
       See MAINTENANCE-MODE.md. */
    maintenanceMode: bool(env, 'GOC_MAINTENANCE_MODE'),
    staffSessionMinutes: int(env, 'GOC_STAFF_SESSION_MINUTES', 8 * 60),
    studentSessionMinutes: int(env, 'GOC_STUDENT_SESSION_MINUTES', 90)
  };

  const missing = [];
  if (!cfg.appwrite.endpoint) missing.push('APPWRITE_ENDPOINT');
  if (!cfg.appwrite.projectId) missing.push('APPWRITE_PROJECT_ID');
  if (!cfg.appwrite.apiKey) missing.push('APPWRITE_API_KEY');
  cfg.missingRequired = missing;
  cfg.configured = missing.length === 0;
  return cfg;
}

/* Safe for logs: names and booleans only, never a value. */
function describe(cfg) {
  return {
    appwriteConfigured: cfg.configured,
    missingRequired: cfg.missingRequired.slice(),
    databaseId: cfg.databaseId,
    bucketId: cfg.bucketId,
    sessionsCollection: cfg.sessionsCollection,
    allowedOriginCount: cfg.allowedOrigins.length,
    maxBodyBytes: cfg.maxBodyBytes,
    jobOwner: cfg.jobOwner,
    appwriteOff: cfg.appwriteOff
  };
}

module.exports = { load, describe };
