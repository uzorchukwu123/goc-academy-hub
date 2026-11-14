/* maintenance.js — the temporary full-platform maintenance switch (Workstream A).
   ---------------------------------------------------------------------------
   One module owns everything maintenance-mode: the switch, the announcement
   page, the API refusal and the service-worker kill switch. Nothing else in
   the application knows maintenance exists, so turning it off restores the
   app exactly as it was — no page, route, record or Appwrite collection is
   touched while it is on.

   SWITCH
     GOC_MAINTENANCE_MODE=1        (accepted truthy values: 1, true, on, yes)
     unset / 0 / anything else     normal operation

   HOW IT IS USED
     · server/server.js calls enabled(process.env) once at boot and, when on,
       calls intercept() before ANY other dispatching — before the tutor
       shell, the setup link, static files, sessions and every API route.
     · This branch serves through the Node process only, so this module is
       the single gate. There is no separate static-build or Function gate.

   WHAT STAYS OPEN IN MAINTENANCE
     GET/HEAD /api/health   a minimal 200 so hosting health checks still pass.
                            It reveals only the service name and that
                            maintenance is on — no passcode length, no
                            programme state, no version detail.
     GET/HEAD /robots.txt   disallow everything.
     GET/HEAD /sw.js        a self-destroying service worker that clears the
                            app's caches and unregisters itself, so a
                            previously cached copy of the app cannot be
                            navigated back into while the platform is down.

   Everything else — homepage, sign-up, login, dashboards, console, tutor
   shell, password-setup links, Free UTME 2027, practice, Web Test, CBT,
   resources, videos, classes, every /api/ route, any deep link — gets the
   announcement page as HTTP 200 (or a 503 JSON refusal for /api/). The page
   is 200 on purpose: OneBit substitutes its own wake screen for origin 503s,
   which would otherwise hide the announcement.

   The page is deliberately self-contained: inline CSS and inline SVG, no
   scripts, no fonts or images from the network, no navigation, no login or
   registration action, and no reopening date. It leaks nothing about the
   application behind it.
   ========================================================================== */
'use strict';

const HEADLINE = "We're Making Things Better!";
const OPENING = 'We are working behind the scenes to improve G.O.C Academy Hub and make your learning experience even better.';
const UNDERWAY = 'Several improvements are currently underway. We are preparing an enhanced platform and look forward to welcoming you back when everything is ready.';
const THANKS = 'Thank you for your patience and understanding.';
const CLOSING = 'Please check back later.';
const API_MESSAGE = 'G.O.C Academy Hub is temporarily unavailable while improvements are completed. Please check back later.';

/* Truthy switch, in the same shape as the project's other on/off env flags
   (GOC_APPWRITE_OFF, GOC_FREE_2027, GOC_NO_DEMO_SEED). */
function enabled(env) {
  const v = String((env || {}).GOC_MAINTENANCE_MODE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/* One small gear, drawn as a path so it scales cleanly. */
function gear(cx, cy, r, teeth, fill, cls) {
  const toothH = r * 0.34;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = (Math.PI * 2 * i) / teeth;
    const next = (Math.PI * 2 * (i + 1)) / teeth;
    const mid = (a + next) / 2;
    const w = r * 0.13;
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
    const a1 = p(a + w / r, r), a2 = p(next - w / r, r);
    const b1 = p(mid - w / r, r + toothH), b2 = p(mid + w / r, r + toothH);
    if (i === 0) d += `M${a1[0].toFixed(2)} ${a1[1].toFixed(2)}`;
    d += `A${r} ${r} 0 0 1 ${a2[0].toFixed(2)} ${a2[1].toFixed(2)}`;
    d += `L${b1[0].toFixed(2)} ${b1[1].toFixed(2)}A${r} ${r} 0 0 0 ${b2[0].toFixed(2)} ${b2[1].toFixed(2)}`;
  }
  d += 'Z';
  return `<path d="${d}" fill="${fill}"${cls ? ` class="${cls}"` : ''}/>`;
}

function illustration() {
  return `
      <svg class="art-svg" viewBox="0 0 340 210" role="img" aria-label="An open book with gears and a rising progress chart">
        <defs>
          <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FEECEC"/><stop offset="100%" stop-color="#FDF6F4"/>
          </linearGradient>
          <linearGradient id="bookL" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#DC2626"/><stop offset="100%" stop-color="#991B1B"/>
          </linearGradient>
          <linearGradient id="bookR" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#B91C1C"/><stop offset="100%" stop-color="#7F1D1D"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="340" height="210" rx="18" fill="url(#glow)"/>
        <circle cx="62" cy="46" r="3" fill="#F0A500" opacity=".9"/>
        <circle cx="292" cy="62" r="2.4" fill="#DC2626" opacity=".55"/>
        <circle cx="266" cy="30" r="1.8" fill="#B91C1C" opacity=".45"/>
        <path d="M26 158h288" stroke="#F3C9C9" stroke-width="1.4" stroke-dasharray="5 6" stroke-linecap="round"/>

        <!-- progress bars -->
        <g opacity=".55">
          <rect x="42" y="118" width="14" height="40" rx="5" fill="#F4B4B4"/>
          <rect x="64" y="104" width="14" height="54" rx="5" fill="#E88A8A"/>
          <rect x="86" y="88" width="14" height="70" rx="5" fill="#DC2626"/>
        </g>
        <g fill="none" stroke="#B91C1C" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75">
          <path d="M44 112l22-16 22 12 20-26 18 8"/>
          <path d="M121 86l6-1 1 6"/>
        </g>

        <!-- big gear -->
        <g class="gear-a">${gear(196, 88, 34, 10, '#B91C1C')}<circle cx="196" cy="88" r="16" fill="url(#glow)"/><circle cx="196" cy="88" r="7" fill="#B91C1C"/></g>
        <!-- small gear -->
        <g class="gear-b">${gear(242, 118, 20, 8, '#F0A500')}<circle cx="242" cy="118" r="9" fill="url(#glow)"/><circle cx="242" cy="118" r="4" fill="#F0A500"/></g>
        <!-- sparkle -->
        <path class="spark" d="M276 86l3.4 8.6L288 98l-8.6 3.4L276 110l-3.4-8.6L264 98l8.6-3.4z" fill="#DC2626" opacity=".85"/>

        <!-- open book -->
        <path d="M100 150c26-12 48-12 70 0v40c-22-12-44-12-70 0z" fill="url(#bookL)"/>
        <path d="M240 150c-26-12-48-12-70 0v40c22-12 44-12 70 0z" fill="url(#bookR)"/>
        <path d="M170 150v40" stroke="#FEF8F8" stroke-width="3" stroke-linecap="round"/>
        <path d="M116 163c14-5 28-5 42 1M116 173c14-5 28-5 42 1M224 163c-14-5-28-5-42 1M224 173c-14-5-28-5-42 1" stroke="#FEE2E2" stroke-width="2" stroke-linecap="round" opacity=".7"/>
        <path d="M170 138l3.6 9.2 9.2 3.6-9.2 3.6-3.6 9.2-3.6-9.2-9.2-3.6 9.2-3.6z" fill="#F0A500"/>
      </svg>`;
}

function page() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#B91C1C">
<meta name="description" content="G.O.C Academy Hub is temporarily under maintenance while several improvements are completed.">
<title>Under improvements · G.O.C Academy Hub</title>
<style>
  :root{
    --red:#DC2626; --red-deep:#B91C1C; --red-dk:#7F1D1D; --maroon:#5E1212;
    --ink:#20242C; --slate:#334155; --mute:#616D7E;
    --line:#EAE4DA; --card:#FFFDFA; --bg:#FAF7F2; --gold:#F0A500;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{min-height:100%}
  body{
    font-family:var(--font); color:var(--ink);
    background:#0e0f12;
    background-image:
      radial-gradient(900px 520px at 18% -8%, rgba(220,38,38,.42) 0%, rgba(14,15,18,0) 62%),
      radial-gradient(760px 520px at 92% 6%, rgba(240,165,0,.16) 0%, rgba(14,15,18,0) 60%),
      radial-gradient(1100px 700px at 50% 112%, #241012 0%, #0e0f12 64%);
    display:flex; align-items:center; justify-content:center;
    padding:clamp(18px,4vw,48px) clamp(14px,4vw,32px);
    min-height:100vh; min-height:100dvh;
    -webkit-font-smoothing:antialiased;
  }
  .shell{width:100%; max-width:720px; display:flex; flex-direction:column; align-items:center; gap:18px}
  .card{
    position:relative; width:100%; background:var(--card);
    border:1px solid rgba(234,228,218,.9); border-radius:26px;
    box-shadow:0 30px 80px rgba(0,0,0,.34), 0 2px 0 rgba(255,255,255,.6) inset;
    padding:clamp(24px,4.4vw,44px); overflow:hidden;
    animation:rise .55s cubic-bezier(.22,.61,.36,1) both;
  }
  .card::before{
    content:""; position:absolute; inset:0 0 auto 0; height:5px;
    background:linear-gradient(90deg,var(--red-dk),var(--red) 46%,var(--gold));
  }
  .art{
    border-radius:18px; overflow:hidden; margin-bottom:clamp(20px,3.4vw,28px);
    border:1px solid #F6DEDE; background:#FFF6F5;
  }
  .art-svg{display:block; width:100%; height:auto}
  .badge{
    display:inline-flex; align-items:center; gap:8px;
    font-size:11.5px; font-weight:800; letter-spacing:.7px; text-transform:uppercase;
    color:var(--red-dk); background:#FEECEC; border:1px solid #F8D4D4;
    padding:7px 13px; border-radius:999px; margin-bottom:16px;
  }
  .badge .dot{
    width:7px; height:7px; border-radius:50%; background:var(--red);
    box-shadow:0 0 0 0 rgba(220,38,38,.55); animation:pulse 2.2s ease-out infinite;
  }
  h1{
    font-size:clamp(25px,4.9vw,38px); line-height:1.16; letter-spacing:-.022em;
    font-weight:900; color:var(--ink); max-width:22ch;
  }
  .copy{margin-top:16px; display:flex; flex-direction:column; gap:12px}
  .copy p{font-size:clamp(14.5px,2.3vw,16.5px); line-height:1.68; color:var(--slate); max-width:62ch}
  .copy p.thanks{color:var(--mute); font-weight:600}
  .rule{height:1px; background:linear-gradient(90deg,var(--line),rgba(234,228,218,0)); margin:22px 0 18px}
  .closing{
    display:flex; align-items:center; gap:11px;
    font-size:clamp(17px,2.6vw,19px); font-weight:900; color:var(--red-dk); letter-spacing:-.01em;
  }
  .closing::before{content:""; width:5px; height:26px; border-radius:3px; background:linear-gradient(180deg,var(--red),var(--red-dk)); flex:none}
  footer{
    display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap;
    text-align:center; color:rgba(255,255,255,.62); font-size:12px; line-height:1.5;
    padding:2px 6px 4px;
  }
  footer .mark{
    display:inline-flex; align-items:center; justify-content:center;
    width:30px; height:30px; border-radius:9px; background:var(--red);
    color:#fff; font-size:9.5px; font-weight:900; letter-spacing:.2px;
    box-shadow:0 6px 16px rgba(220,38,38,.34);
  }
  footer .motto{font-weight:700; color:rgba(255,255,255,.78)}
  @keyframes rise{from{opacity:0; transform:translateY(14px)}to{opacity:1; transform:none}}
  @keyframes pulse{
    0%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}
    70%{box-shadow:0 0 0 8px rgba(220,38,38,0)}
    100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}
  }
  .gear-a{transform-box:view-box; transform-origin:196px 88px; animation:spin 26s linear infinite}
  .gear-b{transform-box:view-box; transform-origin:242px 118px; animation:spinback 19s linear infinite}
  .spark{transform-box:view-box; transform-origin:276px 98px; animation:twinkle 3.6s ease-in-out infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes spinback{to{transform:rotate(-360deg)}}
  @keyframes twinkle{0%,100%{opacity:.45; transform:scale(.9)}50%{opacity:.95; transform:scale(1.06)}}
  @media (max-width:560px){
    body{padding:0 0 18px; align-items:flex-start}
    .card{border-radius:0 0 24px 24px; border-top:0; padding:22px 20px 28px; box-shadow:0 18px 46px rgba(0,0,0,.3)}
    .art{border-radius:14px}
    footer{padding:0 18px; flex-direction:column; gap:8px}
    h1{max-width:none}
  }
  @media (prefers-reduced-motion:reduce){
    .card,.badge .dot,.gear-a,.gear-b,.spark{animation:none !important}
  }
</style>
</head>
<body>
<main class="shell" role="main">
  <section class="card" aria-labelledby="maintenanceTitle">
    <div class="art">${illustration()}
    </div>
    <span class="badge"><span class="dot" aria-hidden="true"></span>Temporary maintenance</span>
    <h1 id="maintenanceTitle">${HEADLINE}</h1>
    <div class="copy">
      <p>${OPENING}</p>
      <p>${UNDERWAY}</p>
      <p class="thanks">${THANKS}</p>
    </div>
    <div class="rule" aria-hidden="true"></div>
    <p class="closing">${CLOSING}</p>
  </section>
  <footer>
    <span class="mark" aria-hidden="true">G.O.C</span>
    <span class="motto">Raising Smart Scholars for Academic Excellence</span>
    <span>© ${new Date().getFullYear()} G.O.C Academy Hub</span>
  </footer>
</main>
</body>
</html>`;
}

/* The service worker served at /sw.js while maintenance is on. It is the only
   code that runs in the browser, and its whole job is to undo the app's own
   offline cache: install immediately, delete every cache this origin holds,
   unregister itself, and claim open clients so the next navigation goes to
   the network (and therefore to the gate). It reloads nothing itself, so it
   cannot loop. */
function serviceWorker() {
  return `/* G.O.C Academy Hub — temporary maintenance service worker.
   Deployed only while GOC_MAINTENANCE_MODE is on. It clears the app's cached
   shell and unregisters itself so an offline copy of the app cannot be opened
   while the platform is under maintenance. Replaced by sw.js from the next
   normal build. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.claim(); })
      .catch(function () {})
  );
});
self.addEventListener('fetch', function (event) {
  /* Never serve anything from a cache while the platform is down. */
  event.respondWith(fetch(event.request).catch(function () {
    return new Response('', { status: 503, statusText: 'Maintenance' });
  }));
});
`;
}

function htmlHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(page()),
    'Cache-Control': 'no-store, max-age=0',
    'Retry-After': '3600',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
  };
}

function json(res, status, payload, extra) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {}));
  res.end(body);
}

/* The single gate. Returns true when it answered the request, so the caller
   stops immediately. It deliberately runs before the request body is read,
   before a session is looked up and before any route handler: a signed-in
   browser, an old token or a replayed request gets the same answer. */
function intercept(req, res, urlPath) {
  const method = String(req.method || 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';

  /* Health checks stay available so a host can still tell the process is up,
     but this answer names nothing beyond the service and the fact of
     maintenance — no passcode length, no Free Tutorial state, no version. */
  if (urlPath === '/api/health') {
    if (!readOnly) {
      json(res, 405, { error: 'Wrong method for that endpoint.' }, { Allow: 'GET, HEAD' });
      return true;
    }
    const body = JSON.stringify({ service: 'goc-academy-hub', version: 1, maintenance: true });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    });
    if (method !== 'HEAD') res.end(body);
    else res.end();
    return true;
  }

  if (urlPath === '/robots.txt') {
    if (!readOnly) { res.writeHead(405); res.end(); return true; }
    const body = 'User-agent: *\nDisallow: /\n';
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, max-age=0'
    });
    if (method !== 'HEAD') res.end(body); else res.end();
    return true;
  }

  if (urlPath === '/sw.js') {
    if (!readOnly) { res.writeHead(405); res.end(); return true; }
    const body = serviceWorker();
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store, max-age=0',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff'
    });
    if (method !== 'HEAD') res.end(body); else res.end();
    return true;
  }

  /* API calls get a JSON refusal. APOST/PUT/DELETE to a page URL is refused
     the same way rather than being handed the HTML page. */
  if (urlPath.indexOf('/api/') === 0 || !readOnly) {
    if (req && typeof req.resume === 'function') req.resume();   // drain, never parse
    json(res, 503, { error: API_MESSAGE, maintenance: true }, { 'Retry-After': '3600' });
    return true;
  }

  /* Every user-facing page: /, /index.html, /tutor, /setup/<token>, a
     /free2027 deep link, a static asset, or anything else typed in.
     HTTP 200 is deliberate: OneBit's edge replaces origin 503s with its own
     wake page, so a 503 announcement would never reach the visitor. */
  const headers = htmlHeaders();
  res.writeHead(200, headers);
  if (method === 'HEAD') res.end();
  else res.end(page());
  return true;
}

module.exports = {
  enabled,
  page,
  serviceWorker,
  intercept,
  HEADLINE,
  OPENING,
  UNDERWAY,
  THANKS,
  CLOSING,
  API_MESSAGE
};
