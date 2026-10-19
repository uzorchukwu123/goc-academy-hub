# Quick deploy checklist (details in DEPLOYMENT.md)

1. `npm install` then `npm test` (set GOC_FOUNDER_PW, GOC_ACADDIR_PW, GOC_PASSCODE first).
2. `npm run deploy` -> writes `deploy/` (minified app in `deploy/public/`, no tests/data/secrets).
3. Upload `deploy/` to the host; run `npm install --omit=dev` there.
4. Copy `.env.example` to `.env` (or set host env vars); fill in every secret.
   Set `GOC_PUBLIC_DIR=public`, `GOC_DATA_DIR=<persistent folder>`.
5. Start: `pm2 start ecosystem.config.cjs` (or `node server/server.js`), behind HTTPS.
6. Verify `https://YOUR-DOMAIN/api/health`.
7. Before each release bump `CACHE` in `sw.js` (currently goc-v176).
