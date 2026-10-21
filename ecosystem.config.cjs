// PM2 process file:  pm2 start ecosystem.config.cjs && pm2 save
// Secrets (GOC_FOUNDER_PW etc.) go in .env or the host environment, not here.
module.exports = {
  apps: [{
    name: 'goc-academy-hub',
    script: 'server/server.js',
    instances: 1,            // single instance: data.json is a single-writer file
    autorestart: true,
    max_memory_restart: '500M',
<<<<<<< HEAD
    env: {
      NODE_ENV: 'production',
      GOC_TRUST_PROXY: '1',
      GOC_NO_DEMO_SEED: '1',
      // ── PERSISTENT DATA DIR ────────────────────────────────────────────────
      // IMPORTANT: Set GOC_DATA_DIR to a directory that EXISTS and is writable
      // on your specific host, and that survives redeployment (i.e. is NOT
      // inside the application directory).
      //
      // Examples by hosting type:
      //   VPS / bare-metal (Onebit, etc.): '/home/<youruser>/goc-data'
      //   Linux system path:               '/var/lib/goc-academy-hub/data'
      //   Windows (dev/test only):         'C:\\goc-data'
      //
      // The path MUST be created manually before the first deploy:
      //   mkdir -p /home/<youruser>/goc-data
      //
      // If the directory does not exist and cannot be created, the server
      // falls back to server/data.json inside the app folder — which WILL be
      // wiped by a redeployment.  Always verify the path exists before deploying.
      //
      // DO NOT leave this as '/var/goc-data' unless you have confirmed that
      // path exists and is writable on your host.  Change it to match your
      // actual persistent mount.
      GOC_DATA_DIR: '/home/ubuntu/goc-data'
    }
=======
    env: { NODE_ENV: 'production', GOC_TRUST_PROXY: '1', GOC_NO_DEMO_SEED: '1' }
>>>>>>> origin/main
  }]
};
