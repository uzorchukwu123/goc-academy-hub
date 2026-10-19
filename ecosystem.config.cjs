// PM2 process file:  pm2 start ecosystem.config.cjs && pm2 save
// Secrets (GOC_FOUNDER_PW etc.) go in .env or the host environment, not here.
module.exports = {
  apps: [{
    name: 'goc-academy-hub',
    script: 'server/server.js',
    instances: 1,            // single instance: data.json is a single-writer file
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', GOC_TRUST_PROXY: '1', GOC_NO_DEMO_SEED: '1' }
  }]
};
