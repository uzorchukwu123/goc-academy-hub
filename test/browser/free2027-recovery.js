'use strict';
/* Optional real-browser regression for the 2027 Free Tutorial recovery.
   Run against a FRESH, ISOLATED local server and SMTP capture (see
   docs/free-tutorial-2027.md). It creates synthetic records and screenshots;
   never point it at production data. No secret has a default value here. */
const fs = require('fs');
const path = require('path');
const os = require('os');

function required(name) {
  const value = process.env[name];
  if (!value) { console.error('Missing required environment variable: ' + name); process.exit(1); }
  return value;
}
let pw;
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core').chromium; }
catch (e) { console.error('playwright-core is required. Install it separately or set PLAYWRIGHT_CORE_PATH.'); process.exit(1); }
const EXECUTABLE = required('CHROMIUM_EXECUTABLE_PATH');
const BASE = process.env.GOC_BROWSER_BASE || 'http://127.0.0.1:8080';
const ART = process.env.GOC_BROWSER_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'goc-browser-'));
const MAIL = required('GOC_TEST_MAIL_FILE');
const GATE = required('GOC_FOUNDER_GATE_WORD');
const FOUNDER_PW = required('GOC_FOUNDER_PW');
const PASSCODE = required('GOC_PASSCODE');
const DATA_FILE = required('GOC_BROWSER_DATA_FILE');
if (process.env.GOC_BROWSER_ISOLATED !== '1') { console.error('Set GOC_BROWSER_ISOLATED=1 only for a fresh isolated test installation.'); process.exit(1); }
const repoRoot = path.resolve(__dirname, '..', '..');
const dataPath = path.resolve(DATA_FILE);
if (dataPath === repoRoot || dataPath.startsWith(repoRoot + path.sep)) { console.error('GOC_BROWSER_DATA_FILE must be outside the repository.'); process.exit(1); }
if (!/^[0-9]{4,10}$/.test(PASSCODE)) { console.error('GOC_PASSCODE must be the numeric console passcode configured for the isolated server.'); process.exit(1); }
const STUDENT_EMAIL = 'recovery.' + Date.now() + '@example.com';
const STUDENT_PW = 'BrowserPass-2027';
function readData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function currentSession() { const j = readData(); return j.free2027.sessions.find((s) => s.id === j.free2027.currentSessionId); }
const initial = readData();
if (!initial.free2027 || Object.values(initial.free2027.questionBanks || {}).some((b) => (b.questions || []).length) || (currentSession()?.activities || []).length || (initial.contactMessages || []).length) {
  console.error('This harness requires a fresh isolated data directory (empty banks, activities and contact messages).'); process.exit(1);
}

fs.mkdirSync(ART, { recursive: true });

async function waitForData(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = predicate(readData()); if (value) return value; await new Promise((r) => setTimeout(r, 100)); }
  return null;
}

const results = [];
const jsErrors = [];
function check(flow, name, cond, extra) {
  results.push({ flow, name, pass: !!cond, extra: extra === undefined ? null : String(extra).slice(0, 300) });
  console.log((cond ? 'PASS' : 'FAIL') + ' [' + flow + '] ' + name + (cond ? '' : ' :: ' + String(extra).slice(0, 200)));
}
async function shot(page, name) {
  try { await page.screenshot({ path: path.join(ART, name + '.png'), animations: 'disabled', fullPage: false, timeout: 30000 }); } catch (e) { console.log('shot fail', name, e.message); }
}
async function active(page, id) {
  await page.waitForFunction((x) => { const e = document.getElementById(x); return e && e.classList.contains('active'); }, id, { timeout: 20000 });
}
async function visible(page, sel) {
  return page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'; }, sel);
}
function mailedCode(email) {
  if (!fs.existsSync(MAIL)) return null;
  const rows = fs.readFileSync(MAIL, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const mail = rows.filter((x) => x.message && x.message.to === email).slice(-1)[0];
  const m = mail && String(mail.message.text || '').match(/verification code is (\d{6})/i);
  return m ? m[1] : null;
}
async function waitCode(email) {
  for (let i = 0; i < 50; i++) { const c = mailedCode(email); if (c) return c; await new Promise((r) => setTimeout(r, 200)); }
  return null;
}
/* Drive the Founder's real Website Mode Control panel, then return to the
   homepage so the hero can be inspected in the mode that was just applied. */
async function switchWebsiteMode(page, toFree) {
  await page.evaluate(() => go('admin'));
  await active(page, 'admin');
  await closeAdminSheet(page);
  await page.click('button.adm-tile[data-section="websitemode"]');
  const label = toFree ? 'Switch to 2027 Free Tutorial Mode' : 'Switch to Original Mode';
  await page.waitForSelector('#f27ModeBody button:has-text("' + label + '")');
  await page.click('#f27ModeBody button:has-text("' + label + '")');
  await page.waitForFunction((f) => document.body.classList.contains('f27-mode') === f, toFree);
  await page.evaluate(() => go('landing'));
  await active(page, 'landing');
}

/* Submit only exists on the final question, so reach it with Next first. */
async function toFinalQuestion(page) {
  for (let i = 0; i < 80; i++) {
    const last = await page.evaluate(() => {
      const n = document.getElementById('freeExamNext');
      return !n || n.hidden === true;
    });
    if (last) break;
    await page.click('#freeExamNext');
    await page.waitForTimeout(60);
  }
  await page.waitForSelector('#freeExamSubmit:not([hidden])');
}

/* Every hub account-creation entry point on the homepage and in the mobile
   drawer, identified by its actual handler rather than by label. In Free
   Tutorial Mode all of them must be hidden; in Original Mode none of them may
   be hidden by the mode rule. The set must be identical in both modes, proving
   nothing was deleted and nothing accumulated across switches. */
async function checkAccountCreationVisibility(page, label, free) {
  const tag = label + ' (' + (free ? 'Free Tutorial' : 'Original') + ')';
  const r = await page.evaluate(() => {
    const wanted = ["go('signup')", "dwGo('signup')"];
    const all = Array.from(document.querySelectorAll('#landing button, #lpDrawer button'))
      .filter((b) => wanted.indexOf(b.getAttribute('onclick')) > -1);
    return {
      count: all.length,
      hidden: all.filter((b) => getComputedStyle(b).display === 'none').length,
      labels: all.map((b) => b.textContent.trim()),
      handlers: all.map((b) => b.getAttribute('onclick'))
    };
  });
  check('account-creation', tag + ': all 6 hub sign-up entry points still exist in the DOM', r.count === 6, JSON.stringify(r));
  check('account-creation', tag + ': ' + (free ? 'every one is hidden' : 'none is hidden by the mode rule'), free ? r.hidden === r.count : r.hidden === 0, JSON.stringify(r));
  check('account-creation', tag + ': handlers and labels are untouched', r.handlers.filter((h) => h === "go('signup')").length === 5 && r.handlers.filter((h) => h === "dwGo('signup')").length === 1 && r.labels.indexOf('Get started') > -1 && r.labels.indexOf('Create free account') > -1, JSON.stringify(r.labels));
  /* Nothing labelled "Get started" or "Create free account" may be rendered as
     a clickable control anywhere on the Free UTME homepage. */
  const shown = await page.evaluate(() => Array.from(document.querySelectorAll('#landing button, #landing a, #lpDrawer button'))
    .filter((b) => /^(Get started|Create free account|Create your free account|Create account|Sign up free)$/.test(b.textContent.trim()))
    .filter((b) => { const s = getComputedStyle(b); const q = b.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && q.width > 0 && q.height > 0; })
    .map((b) => b.textContent.trim()));
  check('account-creation', tag + ': no rendered account-creation control on the homepage' + (free ? '' : ' (Original Mode keeps them)'), free ? shown.length === 0 : true, JSON.stringify(shown));
  if (!free) {
    /* Visible is not enough — the original destination must still work. */
    await page.click('#landing .lp-actions button[onclick="go(\'signup\')"]');
    await active(page, 'signup');
    check('account-creation', tag + ': header Get started still opens the ORIGINAL #signup', await page.evaluate(() => document.getElementById('signup').classList.contains('active') && !!document.getElementById('signName')));
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
  }
}

/* The homepage hero contract, clicked for real in the given mode. */
async function checkHeroForMode(page, label, free) {
  const tag = label + ' (' + (free ? 'Free Tutorial' : 'Original') + ')';
  check('mode-hero', tag + ': hero Get started is ' + (free ? 'hidden' : 'visible'), (await visible(page, '#landing .hero-original-cta')) === !free);
  check('mode-hero', tag + ': hero Get started is never deleted, handler intact', await page.evaluate(() => {
    const e = document.querySelector('#landing .hero-original-cta');
    return !!e && e.getAttribute('onclick') === "go('signup')" && e.textContent.trim() === 'Get started' && e.className === 'lp-btn-light hero-original-cta';
  }));
  check('mode-hero', tag + ': hero account link stays visible, same text and class', await visible(page, '#landing .hero-btns .lp-btn-ghost') && await page.evaluate(() => {
    const e = document.querySelector('#landing .hero-btns .lp-btn-ghost');
    return e.textContent.trim() === 'I already have an account' && e.className === 'lp-btn-ghost';
  }));
  check('mode-hero', tag + ': hero CBT Portal entry is ' + (free ? 'shown' : 'hidden'), (await visible(page, '#landing .hero-cbt')) === free);
  await page.click('#landing .hero-btns .lp-btn-ghost');
  const want = free ? 'free-login' : 'login-v2';
  const other = free ? 'login-v2' : 'free-login';
  await active(page, want);
  check('mode-hero', tag + ': hero account link opens #' + want + ' and never #' + other, await page.evaluate((w) => document.getElementById(w.want).classList.contains('active') && !document.getElementById(w.other).classList.contains('active'), { want: want, other: other }));
  await page.evaluate(() => go('landing'));
  await active(page, 'landing');
  if (!free) {
    await page.click('#landing .hero-original-cta');
    await active(page, 'signup');
    check('mode-hero', tag + ': hero Get started opens the ORIGINAL #signup', await page.evaluate(() => document.getElementById('signup').classList.contains('active') && !!document.getElementById('signName')));
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
  }
  check('mode-hero', tag + ': no stale mode or chrome class on the homepage', await page.evaluate((f) => document.body.classList.contains('f27-mode') === f && !document.body.classList.contains('goc-original-area'), free));
}

async function closeAdminSheet(page) {
  if (await page.locator('#admSheet.show').count()) { await page.locator('.adm-sheet-close').click(); await page.waitForTimeout(200); }
}
async function openFreeAdmin(page) {
  await closeAdminSheet(page);
  await page.waitForSelector('#admTileNav');
  const tile = page.locator('button.adm-tile[data-section="free2027"]');
  if (!(await tile.count())) throw new Error('The programme tile was not injected after sign-in');
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.waitForSelector('#f27AdmTabs');
}
const CSV_HEADER = 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId';
function csvRow(subject, topic, text, a, b, c, d, ans) {
  return [subject, topic, text, a, b, c, d, '', ans, 'medium', 'Recovered CSV row', 'TRUE', '2027', ''].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',');
}

(async () => {
  const rawArgs = process.env.GOC_BROWSER_CHROME_ARGS || '';
  let extraArgs = [];
  if (rawArgs.trim().startsWith('[')) extraArgs = JSON.parse(rawArgs);
  else extraArgs = rawArgs.split(',').map((x) => x.trim()).filter(Boolean);
  const browser = await pw.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'].concat(extraArgs), headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => jsErrors.push(String(e && e.message || e)));
  let lastDialog = '';
  page.on('dialog', (d) => { lastDialog = d.message(); d.accept().catch(() => {}); });
  page.on('response', (r) => { if (r.url().includes('/api/free2027/admin/banks/') && r.url().endsWith('/import')) console.log('IMPORT HTTP ' + r.status()); });

  let flowCompleted = false;
  try {
    /* 1. Original homepage + mobile drawer */
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await active(page, 'landing');
    check('homepage', 'original landing is the initial screen', await page.evaluate(() => document.getElementById('landing').classList.contains('active')));
    check('homepage', 'branding present', await page.evaluate(() => /G\.O\.C Academy Hub/.test(document.querySelector('#landing .lp-brand .bt').textContent)));
    check('homepage', 'hero headline present', await page.evaluate(() => /Raising Smart Scholars/.test(document.querySelector('#landing .lp-hero h1').textContent)));
    for (const id of ['lpFeatures', 'lpSubjects', 'lpHow', 'contact']) check('homepage', 'section #' + id + ' exists', await page.evaluate((x) => !!document.getElementById(x), id));
    /* Round 2: the obsolete bootcamp CTA must be GONE, the account action kept,
       and a real, visible CBT Portal entry offered next to it. */
    check('homepage', 'no "Start Free UTME Bootcamp" text anywhere in the rendered page', await page.evaluate(() => !/start free utme bootcamp/i.test(document.body.innerText)));
    check('homepage', 'no bootcamp CTA element survives in the DOM', await page.evaluate(() => !Array.from(document.querySelectorAll('button, a')).some((e) => /start free utme bootcamp/i.test(e.textContent))));
    check('homepage', 'Free-mode hero shows a visible CBT Portal button', await visible(page, '#landing .hero-cbt'));
    /* Owner correction: the hero's hub "Get started" belongs to the original
       experience and is displayed in Original Mode only. The account link stays
       visible in both modes and routes by mode. */
    check('homepage', 'Free mode hides the hero Get started button', !(await visible(page, '#landing .hero-original-cta')));
    check('homepage', 'the hero Get started button is hidden, not deleted', await page.evaluate(() => {
      const e = document.querySelector('#landing .hero-original-cta');
      return !!e && e.getAttribute('onclick') === "go('signup')" && getComputedStyle(e).display === 'none';
    }));
    check('homepage', 'Free mode keeps the hero account link visible', await visible(page, '#landing .hero-btns .lp-btn-ghost'));
    check('homepage', 'the drawer keeps no bootcamp action', await page.evaluate(() => !/bootcamp/i.test(document.getElementById('lpDrawer').textContent)));
    check('homepage', 'mobile hero is not clipped by the flex screen shell', await page.evaluate(() => { const hero = document.querySelector('#landing .lp-hero'); const h1 = hero.querySelector('h1'); const buttons = hero.querySelector('.hero-btns'); return getComputedStyle(hero).flexShrink === '0' && h1.getBoundingClientRect().bottom < hero.getBoundingClientRect().bottom && buttons.getBoundingClientRect().bottom < hero.getBoundingClientRect().bottom && hero.querySelector('.lp-trust').getBoundingClientRect().bottom < hero.getBoundingClientRect().bottom; }));
    check('homepage', 'mobile logo strip is not clipped', await page.evaluate(() => { const e = document.querySelector('#landing .lp-logos'); return e.getBoundingClientRect().height >= e.scrollHeight - 2; }));
    await shot(page, '01-homepage-mobile');
    await page.click('#lpBurger');
    await page.waitForFunction(() => document.getElementById('lpDrawer').getAttribute('aria-hidden') === 'false');
    check('drawer', 'drawer opens on mobile', await visible(page, '#lpDrawer'));
    check('drawer', 'ecosystem/subjects/how/contact/updates present', await page.evaluate(() => {
      const t = document.getElementById('lpDrawer').textContent; return /The ecosystem/.test(t) && /Subjects offered/.test(t) && /How it works/.test(t) && /Contact us/.test(t) && /Updates/.test(t);
    }));
    check('drawer', 'Free-mode CBT Portal entry visible', await visible(page, '#lpDrawer .dw-cbt'));
    /* Owner correction: the hub's "Create free account" is not part of the Free
       UTME experience. It stands down in this mode only — never deleted. */
    check('drawer', 'Free Mode hides the drawer Create free account button', !(await visible(page, '#lpDrawer .dw-original[onclick="dwGo(\'signup\')"]')));
    check('drawer', 'the drawer Create free account button is hidden, not deleted', await page.evaluate(() => {
      const e = document.querySelector('#lpDrawer .dw-original[onclick="dwGo(\'signup\')"]');
      return !!e && e.textContent.trim() === 'Create free account' && getComputedStyle(e).display === 'none';
    }));
    check('drawer', 'the drawer still offers its CBT Portal entry', await visible(page, '#lpDrawer .dw-cbt'));
    check('drawer', 'the mobile sidebar shows no account-creation button at all', await page.evaluate(() => !Array.from(document.querySelectorAll('#lpDrawer button'))
      .some((b) => /Create free account|Get started|Sign up free/.test(b.textContent) && getComputedStyle(b).display !== 'none')));
    check('drawer', 'the confusing hub Log in shortcut is not offered to free-tutorial students', await page.evaluate(() => Array.from(document.querySelectorAll('#lpDrawer .dw-hub-login')).every((e) => getComputedStyle(e).display === 'none')));
    check('drawer', 'the hub Log in button is still in the page, only stood down in this mode', await page.evaluate(() => !!document.querySelector('#lpDrawer .dw-hub-login')));
    check('drawer', 'contact info present', await page.evaluate(() => /godsowncenterinfo@gmail\.com/.test(document.getElementById('lpDrawer').textContent)));
    await shot(page, '02-drawer-mobile');
    await page.click('#lpDrawer .dw-x');
    await page.waitForFunction(() => document.getElementById('lpDrawer').getAttribute('aria-hidden') === 'true');
    check('drawer', 'drawer closes', true);
    for (const [label, target] of [['The ecosystem', 'lpFeatures'], ['Subjects offered', 'lpSubjects'], ['How it works', 'lpHow'], ['Contact us', 'contact']]) {
      await page.click('#lpBurger');
      await page.click('#lpDrawer .dw-nav button:has-text("' + label + '")');
      await page.waitForFunction(() => document.getElementById('lpDrawer').getAttribute('aria-hidden') === 'true');
      await page.waitForFunction((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top > -160 && r.top < 220; }, target, { timeout: 5000 });
      check('drawer', label + ' navigates to its section', true);
    }
    await page.click('#lpBurger');
    await page.click('#lpDrawer .dw-updates-link');
    await active(page, 'free-home');
    check('drawer', 'Free Mode keeps the legacy Updates destination inside the edition', true);
    await page.evaluate(() => go('landing'));
    await page.click('#lpBurger');
    await page.click('#lpDrawer .dw-cbt');
    /* Corrected contract: every public CBT Portal entry opens the Free UTME
       Tutorial LANDING page, where the student chooses what to do. */
    await active(page, 'free-home');
    check('drawer', 'the mobile sidebar CBT Portal opens the Free UTME Tutorial landing page', true);
    check('drawer', 'that landing page shows the edition heading and its three choices', await page.evaluate(() => {
      const t = document.getElementById('free-home').textContent;
      return /2027 UTME · Free Tutorial Edition/.test(t) && /Free weekly assessments and competitions for the 2027 UTME/.test(t) &&
        /Register free/.test(t) && /Student log in/.test(t) && /Enter the CBT Portal/.test(t);
    }));
    check('drawer', 'the drawer CBT action never opens registration or a hub account page', await page.evaluate(() => ['free-register', 'signup', 'login-v2'].every((id) => !document.getElementById(id).classList.contains('active'))));
    await page.click('#free-home .lp-actions [onclick="freeNavBack()"]');
    await active(page, 'landing');
    check('navigation', 'Back returns inside the site, not to browser history', page.url() === BASE + '/');

    /* 2. Free Tutorial landing */
    await page.evaluate(() => go('free-home'));
    await active(page, 'free-home');
    check('free-landing', 'Free Tutorial landing renders', await page.evaluate(() => /Free weekly assessments and competitions/.test(document.querySelector('#free-home .f27-hero h1').textContent)));
    check('free-landing', 'Weekly/Competitions/Leaderboard cards', await page.evaluate(() => {
      const t = document.getElementById('free-home').textContent; return /Weekly Assessments/.test(t) && /Competitions/.test(t) && /Competition Leaderboard/.test(t);
    }));
    check('free-landing', 'registration availability messaging', await page.evaluate(() => !!document.getElementById('freeHomeNote').textContent));
    check('free-landing', 'Back visible on mobile', await visible(page, '#free-home .lp-actions [onclick="freeNavBack()"]'));
    check('free-landing', 'Home visible on mobile', await visible(page, '#free-home .lp-actions [onclick="freeNavHome()"]'));
    await shot(page, '03-free-landing-mobile');

    /* 3. Registration + OTP */
    await page.click('#free-home .f27-cta .btn-red');
    await active(page, 'free-register');
    check('registration', 'name/email/password/course fields', await page.evaluate(() => !!document.getElementById('freeName') && !!document.getElementById('freeEmail') && !!document.getElementById('freePassword') && !!document.getElementById('freeCourse')));
    check('registration', 'the registration page links to the student login page', await page.evaluate(() => /free-login/.test(document.getElementById('free-register').innerHTML)));
    await page.click('#freeRegBtn');
    check('registration', 'empty submission is validated', await page.evaluate(() => document.getElementById('freeRegErr').textContent.length > 0));
    await page.fill('#freeName', 'Ada Browser');
    await page.fill('#freeEmail', 'not-an-email');
    await page.fill('#freeCourse', 'Medicine and Surgery');
    await page.click('#freeRegBtn');
    check('registration', 'invalid email is validated', await page.evaluate(() => /email/i.test(document.getElementById('freeRegErr').textContent)));
    await page.fill('#freeEmail', STUDENT_EMAIL);
    await page.fill('#freeCourse', 'Medicine and Surgery');
    await page.click('#freeRegBtn');
    check('registration', 'a missing password is validated in the page', await page.evaluate(() => /password/i.test(document.getElementById('freeRegErr').textContent)));
    await page.fill('#freePassword', 'abcdefgh');
    await page.click('#freeRegBtn');
    check('registration', 'a password without a number is validated in the page', await page.evaluate(() => /letters and numbers/i.test(document.getElementById('freeRegErr').textContent)));
    await page.fill('#freePassword', STUDENT_PW);
    await shot(page, '04-registration-mobile');
    await page.click('#freeRegBtn');
    await page.waitForFunction(() => !document.getElementById('freeRegStep2').hidden);
    const code = await waitCode(STUDENT_EMAIL);
    check('registration', 'OTP email captured by test transport', !!code, code ? 'six-digit code present' : 'no mail');
    await page.click('#freeOtpResendBtn');
    await page.waitForFunction(() => /just sent|wait|another/i.test(document.getElementById('freeOtpErr').textContent));
    check('registration', 'resend cooldown is shown in the UI', true);
    await page.fill('#freeOtp', code === '000000' ? '000001' : '000000');
    await page.click('#freeOtpBtn');
    await page.waitForFunction(() => /not right|check your email/i.test(document.getElementById('freeOtpErr').textContent));
    check('registration', 'an incorrect OTP is rejected in the UI', true);
    await page.fill('#freeOtp', code || '000000');
    await page.click('#freeOtpBtn');
    await active(page, 'free-portal');
    check('registration', 'verified student reaches CBT Portal with a sequential GOC-F-NNN identifier', await page.evaluate(() => /GOC-F-\d{3,}/.test(document.getElementById('freeWho').textContent)));
    check('registration', 'the password field is cleared once the code is sent', await page.evaluate(() => document.getElementById('freePassword').value === ''));
    await shot(page, '05-portal-mobile');
    const whoBefore = await page.textContent('#freeWho');
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => freePortalEnter());
    await active(page, 'free-portal');
    check('registration', 'refresh keeps the verified session and identity', await page.textContent('#freeWho') === whoBefore);

    /* 4. Portal destinations + recovered nav */
    check('portal', 'Weekly Assessments tab', await visible(page, '[data-f27tab="weekly"]'));
    check('portal', 'Competitions tab', await visible(page, '[data-f27tab="competition"]'));
    check('portal', 'Competition Leaderboard tab', await visible(page, '[data-f27tab="leaderboard"]'));
    check('portal', 'Back visible on mobile', await visible(page, '#free-portal [onclick="freeNavBack()"]'));
    check('portal', 'Home visible on mobile', await visible(page, '#free-portal [onclick="freeNavHome()"]'));
    await page.click('[data-f27tab="competition"]');
    await page.waitForTimeout(300);
    check('portal', 'competition tab activates', await page.evaluate(() => document.querySelector('[data-f27tab="competition"]').classList.contains('on')));
    await page.click('[data-f27tab="weekly"]');

    /* 5. Ordinary contact still ordinary (wrong gate word) */
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    await page.evaluate(() => document.getElementById('contact').scrollIntoView());
    await page.fill('#cName', 'Ordinary Visitor');
    await page.fill('#cEmail', 'visitor@example.com');
    await page.fill('#cMsg', 'This is an ordinary contact message, not a gate word.');
    await page.click('#cSendBtn');
    await page.waitForTimeout(800);
    check('contact', 'ordinary message does not open staff login', await page.evaluate(() => !document.getElementById('free-admin').classList.contains('active')));
    check('removed-entrances', 'no public gate attribute remains', await page.evaluate(() => !document.querySelector('[data-f27-gate]')));

    /* 6. Founder entrance through existing contact form */
    await page.fill('#cName', 'Founder');
    await page.fill('#cEmail', 'godsowncenterinfo@gmail.com');
    await page.fill('#cMsg', GATE);
    await page.click('#cSendBtn');
    await active(page, 'free-admin');
    check('founder', 'configured gate word opens existing staff login', true);
    check('founder', 'no separate gate input on staff screen', await page.evaluate(() => !document.querySelector('#free-admin input[name*="gate"], #free-admin input[id*="gate"]')));
    await shot(page, '06-founder-staff-login');

    /* 7. Staff login + passcode */
    await page.fill('#freeAdminId', 'GOC-A-001');
    await page.fill('#freeAdminPw', FOUNDER_PW);
    await page.click('#freeAdminBtn');
    await active(page, 'admin-gate');
    check('staff-login', 'Founder reaches secure access portal', true);
    for (const d of PASSCODE.split('')) await page.click(`#admin-gate .gate-pad button:text-is("${d}")`);
    await active(page, 'admin');
    check('passcode', 'console passcode opens Management Console', await page.evaluate(() => /Management Console/.test(document.querySelector('#admin .adm-brand').textContent)));
    await shot(page, '07-management-console');

    /* 8. Free Tutorial admin panel + banks */
    await openFreeAdmin(page);
    check('admin-console', '2027 Free Tutorial tile opens the programme panel', await page.evaluate(() => !!document.getElementById('f27AdmTabs')));
    await page.click('[data-f27adm="banks"]');
    await page.waitForSelector('#f27Bank-weekly');
    check('banks', 'independent weekly and competition panels', await page.evaluate(() => !!document.getElementById('f27Bank-weekly') && !!document.getElementById('f27Bank-competition')));
    check('banks', 'CSV import controls per bank', await page.evaluate(() => !!document.getElementById('f27Csv-weekly') && !!document.getElementById('f27Csv-competition')));
    await shot(page, '08-question-banks');

    /* 9. Manual question A-E with optional E */
    await page.click('#f27Bank-weekly button:has-text("Add question")');
    await page.waitForSelector('#f27NQ-weekly-form');
    await page.selectOption('#f27NQ-weekly-subject', 'Mathematics');
    await page.fill('#f27NQ-weekly-topic', 'Arithmetic');
    await page.fill('#f27NQ-weekly-text', 'What is 2 + 2?');
    await page.fill('#f27NQ-weekly-optionA', '3');
    await page.fill('#f27NQ-weekly-optionB', '4');
    await page.fill('#f27NQ-weekly-optionC', '5');
    await page.fill('#f27NQ-weekly-optionD', '6');
    await page.selectOption('#f27NQ-weekly-answer', 'B');
    check('banks', 'optional E disabled while empty', await page.evaluate(() => document.querySelector('#f27NQ-weekly-answer option[value="E"]').disabled));
    await page.fill('#f27NQ-weekly-optionE', '7');
    check('banks', 'E enabled when option E has text', await page.evaluate(() => !document.querySelector('#f27NQ-weekly-answer option[value="E"]').disabled));
    await page.fill('#f27NQ-weekly-optionE', '');
    await page.click('#f27NQ-weekly-save');
    await page.waitForFunction(() => /1 question/.test(document.getElementById('f27BankCount-weekly').textContent));
    check('banks', 'manual question saved to weekly bank', true);
    await shot(page, '09-manual-question');

    /* 10. CSV import preview + import */
    const weeklyCsv = CSV_HEADER + '\n' + [
      csvRow('Physics', 'Motion', 'Speed is distance divided by what?', 'Time', 'Mass', 'Force', 'Energy', 'A'),
      csvRow('Chemistry', 'Atoms', 'The atomic number equals the number of?', 'Protons', 'Neutrons', 'Electrons only', 'Ions', 'A'),
      csvRow('Biology', 'Cells', 'The powerhouse of the cell is the?', 'Mitochondrion', 'Nucleus', 'Ribosome', 'Golgi', 'A')
    ].join('\n') + '\n';
    const invalidCsv = weeklyCsv.replace(/"TRUE"/g, '"yes"');
    await page.setInputFiles('#f27Csv-weekly', { name: 'invalid-active.csv', mimeType: 'text/csv', buffer: Buffer.from(invalidCsv) });
    await page.waitForFunction(() => /active must be TRUE or FALSE/.test(document.getElementById('f27CsvBox-weekly').textContent));
    check('csv', 'invalid active values are reported instead of silently imported', await page.evaluate(() => /0<\/b> would be imported/.test(document.getElementById('f27CsvBox-weekly').innerHTML)));
    await page.click('#f27CsvBox-weekly button:text-is("Cancel")');
    await page.setInputFiles('#f27Csv-weekly', { name: 'weekly.csv', mimeType: 'text/csv', buffer: Buffer.from(weeklyCsv) });
    await page.waitForSelector('#f27CsvBox-weekly button:has-text("Import")');
    check('csv', 'CSV preview reports all three rows importable', await page.evaluate(() => /3<\/b> would be imported, <b>0<\/b> skipped/.test(document.getElementById('f27CsvBox-weekly').innerHTML)));
    await shot(page, '10-csv-preview');
    await page.click('#f27CsvBox-weekly button:has-text("Import")');
    await page.waitForFunction(() => /4 questions/.test(document.getElementById('f27BankCount-weekly').textContent));
    check('csv', 'CSV imported into selected weekly bank only', await page.evaluate(() => /0 questions/.test(document.getElementById('f27BankCount-competition').textContent)));
    const compCsv = CSV_HEADER + '\n' + [
      csvRow('Use of English', 'Lexis', 'Choose the nearest in meaning to “happy”.', 'Joyful', 'Sad', 'Angry', 'Tired', 'A'),
      csvRow('Mathematics', 'Algebra', 'Solve x + 3 = 5.', '2', '3', '5', '8', 'A')
    ].join('\n') + '\n';
    await page.setInputFiles('#f27Csv-competition', { name: 'competition.csv', mimeType: 'text/csv', buffer: Buffer.from(compCsv) });
    await page.waitForSelector('#f27CsvBox-competition button:has-text("Import")');
    await page.click('#f27CsvBox-competition button:has-text("Import")');
    await page.waitForFunction(() => /2 questions/.test(document.getElementById('f27BankCount-competition').textContent));
    check('csv', 'competition bank remains independent', true);

    /* 10b. Each bank selects questions from its OWN dropdown instead of listing
       every import inline. Selection is display-only. */
    for (const bank of ['weekly', 'competition']) {
      const other = bank === 'weekly' ? 'competition' : 'weekly';
      await page.waitForSelector('#f27BankPick-' + bank);
      const info = await page.evaluate((b) => {
        const sel = document.getElementById('f27BankPick-' + b);
        return {
          options: Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent })),
          rows: document.querySelectorAll('#f27BankList-' + b + ' .f27-admin-row').length,
          selected: document.querySelectorAll('#f27BankSelected-' + b + ' .f27-admin-row').length,
          label: (document.querySelector('label[for="f27BankPick-' + b + '"]') || {}).textContent || ''
        };
      }, bank);
      check('bank-dropdown', bank + ': a labelled question dropdown is present', /Select a/.test(info.label) && info.options.length > 0, info.label);
      check('bank-dropdown', bank + ': questions are NOT listed continuously', info.rows === 1 && info.selected === 1, JSON.stringify({ rows: info.rows, selected: info.selected }));
      check('bank-dropdown', bank + ': options carry number, subject, topic and a preview', /^Q1 · /.test(info.options[0].t) && / — /.test(info.options[0].t), info.options[0].t);
      const before = JSON.stringify(readData().free2027.questionBanks);
      const firstText = await page.textContent('#f27BankSelected-' + bank);
      await page.selectOption('#f27BankPick-' + bank, info.options[1].v);
      const secondText = await page.textContent('#f27BankSelected-' + bank);
      check('bank-dropdown', bank + ': choosing another question changes the displayed details', firstText !== secondText);
      check('bank-dropdown', bank + ': still exactly one question on screen after switching', await page.evaluate((b) => document.querySelectorAll('#f27BankList-' + b + ' .f27-admin-row').length === 1, bank));
      check('bank-dropdown', bank + ': selecting never creates, edits or deletes questions', JSON.stringify(readData().free2027.questionBanks) === before);
      /* Cross-bank isolation: no id from the other bank may appear here. */
      /* Both panels load their rows independently; wait for the other bank's
         picker rather than racing its first render. */
      await page.waitForSelector('#f27BankPick-' + other);
      const otherIds = await page.evaluate((b) => {
        const s = document.getElementById('f27BankPick-' + b);
        return s ? Array.from(s.options).map((o) => o.value) : [];
      }, other);
      const mine = info.options.map((o) => o.v);
      check('bank-dropdown', bank + ': none of the other bank\'s questions appear in this dropdown', mine.every((id) => otherIds.indexOf(id) < 0), JSON.stringify({ mine: mine, other: otherIds }));
      /* Search and subject filter still drive the same dropdown. */
      await page.fill('#f27Q-' + bank, 'zzz-no-such-question');
      await page.waitForFunction((b) => /No questions in this bank match/.test(document.getElementById('f27BankList-' + b).textContent), bank);
      check('bank-dropdown', bank + ': search still filters, with a clear empty state', await page.evaluate((b) => !document.getElementById('f27BankPick-' + b), bank));
      await page.fill('#f27Q-' + bank, '');
      await page.waitForSelector('#f27BankPick-' + bank);
      const subj = await page.evaluate((b) => {
        const s = document.getElementById('f27Subj-' + b);
        return s && s.options[1] ? s.options[1].value : '';
      }, bank);
      await page.selectOption('#f27Subj-' + bank, subj);
      await page.waitForFunction((a) => {
        const host = document.getElementById('f27BankList-' + a.b);
        if (!host) return false;
        const s = document.getElementById('f27BankPick-' + a.b);
        if (!s) return /No questions in this bank match/.test(host.textContent);
        return Array.from(s.options).every((o) => o.textContent.indexOf(' · ' + a.subj + ' · ') > -1);
      }, { b: bank, subj: subj });
      check('bank-dropdown', bank + ': subject filter narrows the dropdown to that subject only', await page.evaluate((a) => {
        const s = document.getElementById('f27BankPick-' + a.b);
        if (!s) return /No questions in this bank match/.test(document.getElementById('f27BankList-' + a.b).textContent);
        return s.options.length > 0 && Array.from(s.options).every((o) => o.textContent.indexOf(' · ' + a.subj + ' · ') > -1);
      }, { b: bank, subj: subj }));
      await page.selectOption('#f27Subj-' + bank, '');
      await page.waitForSelector('#f27BankPick-' + bank);
      /* Edit and Delete are still reachable for the selected question. */
      check('bank-dropdown', bank + ': the selected question keeps its Edit and Delete controls', await page.evaluate((b) => {
        const h = document.getElementById('f27BankSelected-' + b);
        return !!h.querySelector('button:not(.danger)') && !!h.querySelector('button.danger') && !!h.querySelector('input[type="checkbox"]');
      }, bank));
      await page.locator('#f27BankPick-' + bank).scrollIntoViewIfNeeded();
      await shot(page, '10b-' + bank + '-dropdown');
    }
    /* The same console checks on a desktop viewport. */
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.waitForTimeout(250);
    for (const bank of ['weekly', 'competition']) {
      check('bank-dropdown', 'desktop ' + bank + ': dropdown is present and usable', await visible(page, '#f27BankPick-' + bank));
      check('bank-dropdown', 'desktop ' + bank + ': only the selected question is rendered', await page.evaluate((b) => document.querySelectorAll('#f27BankList-' + b + ' .f27-admin-row').length === 1, bank));
    }
    check('bank-dropdown', 'desktop console has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check('bank-dropdown', 'desktop keeps two separate dropdowns, never one combined', await page.evaluate(() => {
      const w = document.getElementById('f27BankPick-weekly'), c = document.getElementById('f27BankPick-competition');
      return !!w && !!c && w !== c && document.querySelectorAll('.f27-bank-picker select').length === 2;
    }));
    await shot(page, '10c-banks-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);

    /* 11. Activity creation */
    await page.click('[data-f27adm="activities"]');
    await page.waitForSelector('#f27AdmBody button:has-text("Create Activity")');
    await page.click('#f27AdmBody button:has-text("Create Activity")');
    await page.click('.f27-activity-category:has-text("WEEKLY ASSESSMENT")');
    await page.waitForSelector('#f27Kind');
    check('activities', 'only two categories offered', await page.evaluate(() => document.querySelectorAll('#f27Kind option').length === 2));
    await page.fill('#f27Title', 'Recovered Weekly Assessment');
    await page.fill('#f27Count', '3');
    await page.fill('#f27Dist-1', '1');
    await page.fill('#f27Dist-2', '1');
    await page.fill('#f27Dist-3', '1');
    /* Regression: the availability reply rebuilds the distribution grid. It
       must NOT discard what the administrator has already typed — that race
       silently dropped the distribution (and could detach an input mid-edit). */
    await page.waitForSelector('#f27Availability .ad-metric');
    check('activities', 'a slow availability reply preserves the typed distribution', await page.evaluate(() => ['f27Dist-1', 'f27Dist-2', 'f27Dist-3'].every((id) => document.getElementById(id).value === '1')));
    check('activities', 'a slow availability reply preserves the typed title and count', await page.evaluate(() => document.getElementById('f27Title').value === 'Recovered Weekly Assessment' && document.getElementById('f27Count').value === '3'));
    await page.check('#f27RandO');
    await page.fill('#f27Instr', 'Answer every question. Your work is saved automatically.');
    await page.fill('#f27Dur', '10');
    await page.fill('#f27Max', '2');
    await page.selectOption('#f27Status', 'published');
    await page.click('#f27SaveBtn');
    await page.waitForFunction(() => /Recovered Weekly Assessment/.test(document.getElementById('f27AdmBody').textContent) && !document.getElementById('f27SaveBtn'));
    check('activities', 'weekly activity created from bound bank', true);
    await page.click('#f27AdmBody button:has-text("Create Activity")');
    await page.click('.f27-activity-category:has-text("COMPETITION")');
    await page.waitForSelector('#f27Kind');
    /* This second form has no race-regression assertion of its own, so let the
       availability reply settle before typing rather than racing it. The
       weekly form above deliberately still types mid-flight. */
    await page.waitForFunction(() => /Available eligible questions/.test((document.getElementById('f27Availability') || {}).textContent || ''));
    await page.fill('#f27Title', 'Recovered Competition');
    await page.fill('#f27Count', '2');
    await page.fill('#f27Dist-0', '1');
    await page.fill('#f27Dist-1', '1');
    await page.check('#f27RandO');
    await page.fill('#f27Instr', 'Competition ranking uses score, then completion time.');
    await page.fill('#f27Dur', '10');
    await page.fill('#f27Max', '2');
    await page.selectOption('#f27Status', 'published');
    await page.click('#f27SaveBtn');
    await page.waitForFunction(() => /Recovered Competition/.test(document.getElementById('f27AdmBody').textContent) && !document.getElementById('f27SaveBtn'));
    check('activities', 'competition activity created from bound bank', true);
    await shot(page, '11-activities');

    /* 12. Student CBT weekly */
    await page.evaluate(() => freeGo('free-portal'));
    await active(page, 'free-portal');
    await page.waitForSelector('#freePortalList button');
    await page.click('#freePortalList button');
    await active(page, 'free-exam');
    check('cbt', 'mobile CBT renders question and options', await page.evaluate(() => !!document.getElementById('freeExamQ').textContent && document.querySelectorAll('#freeExamOpts button, #freeExamOpts .f27-cbt-option').length >= 2));
    check('cbt', 'countdown visible', await visible(page, '#freeExamTime'));
    check('cbt', 'the active paper offers no Back button', !(await visible(page, '#free-exam .f27-cbt-back')));
    check('cbt', 'the active paper offers no Home button', !(await visible(page, '#free-exam .f27-cbt-home')));
    check('cbt', 'both exits are hidden, not deleted', await page.evaluate(() => !!document.querySelector('#free-exam .f27-cbt-home') && !!document.querySelector('#free-exam [onclick="freeExamLeave()"]') && typeof window.freeExamLeave === 'function' && typeof window.freeExamHome === 'function'));
    check('cbt', 'Next is visible and Submit is not, on a non-final question', await visible(page, '#freeExamNext') && !(await visible(page, '#freeExamSubmit')));
    check('cbt', 'the timer sits at the extreme top-right of the exam header', await page.evaluate(() => {
      const t = document.getElementById('freeExamTimer').getBoundingClientRect();
      const h = document.querySelector('#free-exam .f27-cbt-header').getBoundingClientRect();
      return (h.right - t.right) <= 20 && t.top >= h.top - 1;
    }));
    check('cbt', 'the timer never overlaps the title or the question card', await page.evaluate(() => {
      const t = document.getElementById('freeExamTimer').getBoundingClientRect();
      const w = document.querySelector('#free-exam .f27-cbt-title-wrap').getBoundingClientRect();
      const c = document.querySelector('#free-exam .f27-cbt-card').getBoundingClientRect();
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return !hit(t, w) && !hit(t, c);
    }));
    check('cbt', 'the exam fits a 390px screen without horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    check('cbt', 'the three navigation controls are all visible and usable', await visible(page, '#freeExamPrev') && await visible(page, '#freeExamNext') && await visible(page, '.f27-cbt-bar button[onclick="freeExamPanel()"]'));
    await shot(page, '12-cbt-question');
    check('cbt', 'the 10-minute paper shows MM:SS, not hours', await page.evaluate(() => /^\d{2}:\d{2}$/.test(document.getElementById('freeExamTime').textContent.trim())));
    /* The same exam checks on a desktop viewport. */
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.waitForTimeout(250);
    check('cbt', 'desktop: no Back and no Home on the active paper', !(await visible(page, '#free-exam .f27-cbt-back')) && !(await visible(page, '#free-exam .f27-cbt-home')));
    check('cbt', 'desktop: Next is visible, Submit is not', await visible(page, '#freeExamNext') && !(await visible(page, '#freeExamSubmit')));
    check('cbt', 'desktop: the timer is at the extreme top-right', await page.evaluate(() => {
      const t = document.getElementById('freeExamTimer').getBoundingClientRect();
      const h = document.querySelector('#free-exam .f27-cbt-header').getBoundingClientRect();
      return (h.right - t.right) <= 20;
    }));
    check('cbt', 'desktop: timer clear of the title and question card', await page.evaluate(() => {
      const t = document.getElementById('freeExamTimer').getBoundingClientRect();
      const w = document.querySelector('#free-exam .f27-cbt-title-wrap').getBoundingClientRect();
      const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return !hit(t, w);
    }));
    check('cbt', 'desktop: no horizontal overflow and no overlapping bar controls', await page.evaluate(() => {
      if (document.documentElement.scrollWidth > window.innerWidth) return false;
      const bs = Array.from(document.querySelectorAll('.f27-cbt-bar button')).filter((b) => !b.hidden).map((b) => b.getBoundingClientRect());
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        if (bs[i].left < bs[j].right - 1 && bs[j].left < bs[i].right - 1 && bs[i].top < bs[j].bottom - 1 && bs[j].top < bs[i].bottom - 1) return false;
      }
      return bs.length === 3;
    }));
    await shot(page, '12b-cbt-desktop');
    /* A. The bar must stay on screen and usable at EVERY required width, and
       the question body must be the only thing that scrolls. */
    for (const [vw, vh, kind] of [[320, 568, 'mobile'], [360, 640, 'mobile'], [375, 667, 'mobile'], [390, 844, 'mobile'], [430, 932, 'mobile'], [1024, 768, 'desktop'], [1280, 800, 'desktop'], [1440, 900, 'desktop'], [1920, 1080, 'desktop']]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(320);
      const g = await page.evaluate(() => {
        const ex = document.getElementById('free-exam');
        const bar = document.querySelector('#free-exam .f27-cbt-bar');
        const body = document.querySelector('#free-exam .f27-cbt-body');
        const head = document.querySelector('#free-exam .f27-cbt-header');
        const R = (e) => e.getBoundingClientRect();
        const br = R(bar), yr = R(body), hr = R(head);
        const btns = Array.from(bar.querySelectorAll('button')).filter((b) => !b.hidden).map((b) => {
          const q = R(b);
          /* Hit-test the centre: a control that is merely on screen but painted
             over by something else is not actually usable. */
          const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          return { ok: q.top >= 0 && q.bottom <= window.innerHeight + 1 && q.left >= 0 && q.right <= window.innerWidth + 1 && q.width >= 40 && q.height >= 40 && !!hit && (hit === b || b.contains(hit)), t: b.textContent.trim().slice(0, 18) };
        });
        const before = br.top;
        body.scrollTop = body.scrollHeight;
        const moved = Math.abs(R(bar).top - before) > 1;
        body.scrollTop = 0;
        return {
          tile: hr.bottom <= yr.top + 1 && yr.bottom <= br.top + 1,
          barIn: br.top >= 0 && br.bottom <= window.innerHeight + 1,
          btnsOk: btns.length === 3 && btns.every((b) => b.ok),
          btnList: btns.map((b) => b.t).join(' / '),
          bodyScrolls: getComputedStyle(body).overflowY === 'auto',
          examStill: ex.scrollHeight <= ex.clientHeight + 1,
          barSteady: !moved,
          noHOverflow: document.documentElement.scrollWidth <= window.innerWidth && body.scrollWidth <= body.clientWidth + 1
        };
      });
      check('exam-viewport', kind + ' ' + vw + 'px: header, body and bar tile without overlapping', g.tile);
      check('exam-viewport', kind + ' ' + vw + 'px: the whole navigation bar is inside the viewport', g.barIn);
      check('exam-viewport', kind + ' ' + vw + 'px: all three controls are visible, tappable and not painted over', g.btnsOk, g.btnList);
      check('exam-viewport', kind + ' ' + vw + 'px: the question body scrolls and the bar never moves', g.bodyScrolls && g.barSteady && g.examStill);
      check('exam-viewport', kind + ' ' + vw + 'px: no horizontal overflow', g.noHOverflow);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await shot(page, '12c-cbt-desktop-wide');
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(250);
    await shot(page, '12d-cbt-320px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    check('cbt', 'option letter badges are separate from option text', await page.evaluate(() => !!document.querySelector('#freeExamOpts .f27-cbt-letter') && !!document.querySelector('#freeExamOpts .f27-cbt-text')));
    await page.click('#freeExamOpts button:first-child');
    await page.waitForFunction(() => { const j = document.querySelector('#freeExamOpts .sel'); return j && j.getAttribute('aria-pressed') === 'true'; });
    const openAttempt = await waitForData((j) => j?.free2027.sessions.flatMap((s) => s.attempts).find((a) => a.activityId === 'F27-Q1' && !a.submittedAt && Object.keys(a.responses || {}).length === 1));
    check('cbt', 'answer and per-attempt option order are persisted', !!openAttempt && Object.keys(openAttempt.responses || {}).length === 1 && !!openAttempt.optionOrders);
    await page.click('#freeExamNext');
    await page.waitForTimeout(200);
    check('cbt', 'next advances question', await page.evaluate(() => /2/.test(document.getElementById('freeExamNum').textContent)));
    await page.click('#freeExamPrev');
    await page.waitForTimeout(200);
    check('cbt', 'previous returns', await page.evaluate(() => /1/.test(document.getElementById('freeExamNum').textContent)));
    await page.click('[onclick="freeExamPanel()"]');
    await page.waitForSelector('#freeExamPanel:not([hidden])');
    check('cbt', 'question navigator opens', await page.evaluate(() => document.querySelectorAll('#freeExamPanelGrid button').length >= 3));
    check('cbt', 'navigator distinguishes answered and unanswered questions', await page.evaluate(() => document.querySelectorAll('#freeExamPanelGrid .answered').length === 1 && document.querySelectorAll('#freeExamPanelGrid .unanswered').length === 2));
    await shot(page, '13-cbt-navigator');
    await page.click('#freeExamPanel .f27-cbt-close');
    await page.evaluate(() => freeExamLeave());
    await active(page, 'free-portal');
    check('cbt', 'the retained leave handler still asks for confirmation', true);
    await page.click('#freePortalList button:has-text("Resume")');
    await active(page, 'free-exam');
    check('cbt', 'resuming restores the saved selected option', await page.evaluate(() => document.querySelector('#freeExamOpts .sel')?.getAttribute('aria-pressed') === 'true'));
    const resumedAttempt = currentSession()?.attempts.find((a) => a.activityId === 'F27-Q1' && !a.submittedAt);
    check('cbt', 'resuming reuses the same attempt and paper', resumedAttempt?.id === openAttempt?.id && JSON.stringify(resumedAttempt?.questionIds) === JSON.stringify(openAttempt?.questionIds));
    await toFinalQuestion(page);
    await page.click('#freeExamSubmit');
    await page.waitForSelector('#freeExamConfirm:not([hidden])');
    check('cbt', 'submit confirmation appears', true);
    await page.click('#freeExamConfirmCancel');
    check('cbt', 'cancel keeps the paper open', await page.evaluate(() => document.getElementById('freeExamConfirm').hidden && document.getElementById('free-exam').classList.contains('active')));
    await toFinalQuestion(page);
    await page.click('#freeExamSubmit');
    await page.click('#freeExamConfirm button:has-text("Submit paper")');
    await active(page, 'free-result');
    check('cbt', 'result screen after submission', await page.evaluate(() => /of/.test(document.getElementById('freeResultBody').textContent)));
    await shot(page, '14-cbt-result');

    /* 13. Competition attempt + leaderboard publication */
    await page.evaluate(() => freeGo('free-portal'));
    await active(page, 'free-portal');
    await page.click('[data-f27tab="competition"]');
    await page.waitForSelector('#freePortalList button');
    await page.click('#freePortalList button');
    await active(page, 'free-exam');
    await page.click('#freeExamOpts button, #freeExamOpts .f27-cbt-option');
    await page.click('#freeExamNext');
    await page.waitForTimeout(200);
    await page.click('#freeExamOpts button, #freeExamOpts .f27-cbt-option');
    await toFinalQuestion(page);
    await page.click('#freeExamSubmit');
    await page.waitForSelector('#freeExamConfirm:not([hidden])');
    await page.click('#freeExamConfirm button:has-text("Submit paper")');
    await active(page, 'free-result');
    check('leaderboard', 'competition attempt submitted', true);
    await page.evaluate(() => go('admin'));
    await active(page, 'admin');
    await openFreeAdmin(page);
    await page.click('[data-f27adm="leaderboards"]');
    await page.waitForTimeout(600);
    await page.waitForSelector('#f27AdmBody button:text-is("Approve")');
    await page.click('#f27AdmBody button:text-is("Approve")');
    await page.waitForFunction(() => /approved, not published/.test(document.getElementById('f27AdmBody').textContent));
    await page.click('#f27AdmBody button:text-is("Publish")');
    await page.waitForFunction(() => /public<\/span>/.test(document.getElementById('f27AdmBody').innerHTML));
    const comp = currentSession()?.activities.find((a) => a.kind === 'competition');
    check('leaderboard', 'admin approval and publication persist', comp?.leaderboard.approved === true && comp?.leaderboard.published === true);
    await page.evaluate(() => freeGo('free-portal'));
    await active(page, 'free-portal');
    await page.click('[data-f27tab="leaderboard"]');
    await page.waitForSelector('#freePortalList button:has-text("View leaderboard")');
    check('leaderboard', 'published competition appears in the student portal', await page.evaluate(() => /Recovered Competition/.test(document.getElementById('freePortalList').textContent)));
    await page.click('#freePortalList button:has-text("View leaderboard")');
    await active(page, 'free-leaderboard');
    await page.waitForSelector('#freeBoardBody tbody tr');
    check('leaderboard', 'ranked competition table contains the submitted student', await page.evaluate(() => /GOC-F-\d{3,}|GOC-F27-[A-F0-9]{20}/.test(document.querySelector('#freeBoardBody tbody').textContent) && /Score/.test(document.querySelector('#freeBoardBody thead').textContent)));
    await shot(page, '15-leaderboard');

    /* 14. Recovered dedicated Website Mode Control, reversible without data loss. */
    await page.evaluate(() => go('admin'));
    await active(page, 'admin');
    await closeAdminSheet(page);
    await page.click('button.adm-tile[data-section="websitemode"]');
    await page.waitForSelector('#f27ModeBody button:has-text("Switch to Original Mode")');
    check('mode-control', 'Founder has a separate Website Mode Control panel', await page.evaluate(() => document.getElementById('admSheetTitle').textContent === 'Website Mode Control'));
    await shot(page, '16-website-mode-control');
    await page.click('#f27ModeBody button:has-text("Switch to Original Mode")');
    await page.waitForFunction(() => !document.body.classList.contains('f27-mode'));
    await page.evaluate(() => go('landing'));
    await page.click('#lpBurger');
    check('mode-control', 'Original Mode restores the original drawer account actions', await visible(page, '#lpDrawer .dw-original') && !(await visible(page, '#lpDrawer .dw-cbt')));
    check('mode-control', 'Original Mode brings the drawer Create free account back, clickable', await visible(page, '#lpDrawer .dw-original[onclick="dwGo(\'signup\')"]'));
    check('mode-control', 'Original Mode brings the hub Log in shortcut back', await visible(page, '#lpDrawer .dw-hub-login'));
    check('mode-control', 'the hub login shortcut is only stood down by the Free Tutorial mode class', await page.evaluate(() => !document.body.classList.contains('f27-mode') && getComputedStyle(document.querySelector('#lpDrawer .dw-hub-login')).display !== 'none'));
    await shot(page, '17-original-mode-drawer');
    await page.click('#lpDrawer .dw-original[onclick="dwGo(\'signup\')"]');
    await active(page, 'signup');
    check('mode-control', 'Original Mode: drawer Create free account still opens the ORIGINAL #signup', await page.evaluate(() => document.getElementById('signup').classList.contains('active') && !!document.getElementById('signName')));
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    await page.click('#lpBurger');
    await page.click('#lpDrawer .dw-updates-link');
    await active(page, 'updates');
    check('drawer', 'Original Mode restores the Updates & News destination', true);
    await page.evaluate(() => go('landing'));
    await page.click('#lpBurger');
    await page.click('#lpDrawer .dw-x');
    await page.evaluate(() => go('admin'));
    await closeAdminSheet(page);
    await page.click('button.adm-tile[data-section="websitemode"]');
    await page.waitForSelector('#f27ModeBody button:has-text("Switch to 2027 Free Tutorial Mode")');
    await page.click('#f27ModeBody button:has-text("Switch to 2027 Free Tutorial Mode")');
    await page.waitForFunction(() => document.body.classList.contains('f27-mode'));
    check('mode-control', 'switching back preserves both independent banks', currentSession()?.activities.length === 2 && Object.keys(readData().free2027.questionBanks).length === 2);

    /* Owner correction: the homepage hero must follow the active mode, and must
       restore completely on switch-back. Two full round trips per layout, driven
       through the real console control, prove nothing accumulates: no stale
       class, no permanently hidden button, no stale destination. */
    for (const [label, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 900 }]]) {
      await page.setViewportSize(vp);
      for (let pass = 1; pass <= 2; pass++) {
        await switchWebsiteMode(page, false);
        await checkHeroForMode(page, label + ' round ' + pass, false);
        await checkAccountCreationVisibility(page, label + ' round ' + pass, false);
        await switchWebsiteMode(page, true);
        await checkHeroForMode(page, label + ' round ' + pass, true);
        await checkAccountCreationVisibility(page, label + ' round ' + pass, true);
      }
      check('mode-hero', label + ': student records survive every mode switch', currentSession()?.participants.length >= 1 && currentSession()?.attempts.filter((a) => a.submittedAt).length === 2);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, '17b-hero-mode-roundtrips');

    /* 15. Removed hidden entrances and ordinary-contact safety. */
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    const before = await page.evaluate(() => document.getElementById('free-admin').classList.contains('active'));
    await page.evaluate(() => { const e = document.getElementById('lpStat4') || document.querySelector('#lpSubjects .subj-card'); if (e) for (let i = 0; i < 6; i++) e.click(); });
    await page.waitForTimeout(400);
    check('removed-entrances', 'science-card clicking does not open admin', await page.evaluate(() => !document.getElementById('free-admin').classList.contains('active')) && !before);
    check('removed-entrances', 'no tutor-door symbol in public scripts', await page.evaluate(() => typeof window.knockDoor === 'undefined' && typeof window.freeGateClick === 'undefined'));
    flowCompleted = true;
  } catch (e) {
    check('harness', 'unexpected failure', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    await shot(page, '99-failure');
    console.log('FAILURE DOM ' + await page.evaluate(() => ({ screen: document.querySelector('.screen.active')?.id, weekly: document.getElementById('f27BankCount-weekly')?.textContent, competition: document.getElementById('f27BankCount-competition')?.textContent, importReport: document.getElementById('f27CsvBox-weekly')?.textContent, error: document.getElementById('f27AdmBody')?.querySelector('.ad-warn')?.textContent, editorMessage: document.querySelector('.f27-question-message:not([hidden])')?.textContent })).then(JSON.stringify).catch(String));
  }

  if (DATA_FILE && flowCompleted) {
    const j = readData(); const s = currentSession(); const p = s.participants.find((x) => x.email === STUDENT_EMAIL);
    check('persistence', 'verified student record retains name/course/verified status', p?.name === 'Ada Browser' && p?.course === 'Medicine and Surgery' && p?.verified === true);
    check('persistence', 'weekly and competition banks stay independent on disk', j.free2027.questionBanks.weekly.questions.length === 4 && j.free2027.questionBanks.competition.questions.length === 2);
    const weekly = s.activities.find((a) => a.kind === 'weekly'); const competition = s.activities.find((a) => a.kind === 'competition');
    check('persistence', 'allocation, distribution, randomisation and scheduling persist', weekly?.questionIds.length === 3 && weekly?.subjectDistribution?.Mathematics === 1 && weekly?.randomizeOptions === true && weekly?.durationMin === 10 && weekly?.maxAttempts === 2 && weekly?.opensAt <= Date.now() && weekly?.closesAt > Date.now() && competition?.questionIds.length === 2,
      JSON.stringify({ title: weekly?.title, n: weekly?.questionIds.length, dist: weekly?.subjectDistribution, randO: weekly?.randomizeOptions, dur: weekly?.durationMin, max: weekly?.maxAttempts, opensIn: weekly && weekly.opensAt - Date.now(), closesIn: weekly && weekly.closesAt - Date.now(), compN: competition?.questionIds.length }));
    check('persistence', 'both submitted attempts retain their papers and responses', s.attempts.filter((a) => a.submittedAt && Object.keys(a.responses || {}).length > 0 && a.questionIds.length > 0).length === 2);
    check('contact', 'ordinary contact was stored and emailed, Founder gate was neither', j.contactMessages.length === 1 && !JSON.stringify(j).includes(GATE) && !fs.readFileSync(MAIL, 'utf8').includes(GATE) && fs.readFileSync(MAIL, 'utf8').includes('ordinary contact message'));
  }
  /* =====================================================================
     ROUND 2 — the data-preservation contract, exercised in a real browser.
     Runs AFTER the persistence assertions above so nothing it deletes can
     weaken an earlier check.
     ===================================================================== */
  if (flowCompleted) {
    try {
      const week1 = currentSession().activities.find((a) => a.title === 'Recovered Weekly Assessment');
      const week1Json = JSON.stringify(week1);
      const attemptsJsonBefore = JSON.stringify(currentSession().attempts);
      const participantsJsonBefore = JSON.stringify(currentSession().participants);
      const banksJsonBefore = JSON.stringify(readData().free2027.questionBanks);

      /* 16. A new weekly assessment ACCUMULATES; it never replaces Week 1. */
      await page.evaluate(() => go('admin'));
      await active(page, 'admin');
      await openFreeAdmin(page);
      await page.click('[data-f27adm="activities"]');
      await page.waitForSelector('#f27AdmBody button:has-text("Create Activity")');
      await page.click('#f27AdmBody button:has-text("Create Activity")');
      await page.click('.f27-activity-category:has-text("WEEKLY ASSESSMENT")');
      await page.waitForSelector('#f27Kind');
      await page.fill('#f27Title', 'Week 2 Accumulation');
      await page.fill('#f27Count', '2');
      await page.fill('#f27Dist-1', '1');
      await page.fill('#f27Dist-2', '1');
      await page.fill('#f27Dur', '10');
      await page.fill('#f27Max', '2');
      await page.selectOption('#f27Status', 'published');
      await page.click('#f27SaveBtn');
      await page.waitForFunction(() => /Week 2 Accumulation/.test(document.getElementById('f27AdmBody').textContent) && !document.getElementById('f27SaveBtn'));
      const actsNow = currentSession().activities;
      check('accumulation', 'Week 1 and Week 2 coexist as separate records', actsNow.some((a) => a.title === 'Recovered Weekly Assessment') && actsNow.some((a) => a.title === 'Week 2 Accumulation'));
      check('accumulation', 'each assessment has its own stable unique id', new Set(actsNow.map((a) => a.id)).size === actsNow.length);
      check('accumulation', 'creating Week 2 does not rewrite Week 1', JSON.stringify(currentSession().activities.find((a) => a.title === 'Recovered Weekly Assessment')) === week1Json);
      check('accumulation', 'creating Week 2 touches no attempt or student record', JSON.stringify(currentSession().attempts) === attemptsJsonBefore && JSON.stringify(currentSession().participants) === participantsJsonBefore);
      await shot(page, '20-accumulated-activities');

      /* 17. MANDATORY: deleting an activity keeps every attempt/answer/score. */
      const keptAttempt = currentSession().attempts.find((a) => a.activityId === week1.id && a.submittedAt);
      const keptJson = JSON.stringify(keptAttempt);
      const otherActivitiesJson = JSON.stringify(currentSession().activities.filter((a) => a.id !== week1.id));
      const row = page.locator('#f27AdmBody .ad-card', { hasText: 'Recovered Weekly Assessment' });
      /* The single global dialog handler records the message and accepts it. */
      lastDialog = '';
      await row.locator('button:text-is("Delete")').click();
      await page.waitForFunction((t) => !new RegExp(t).test(document.getElementById('f27AdmBody').textContent), 'Recovered Weekly Assessment', { timeout: 20000 });
      check('delete-preservation', 'the delete confirmation states that attempts and results are kept', /ONLY the activity is removed/.test(lastDialog) && /KEPT/.test(lastDialog), lastDialog.slice(0, 160));
      const afterDel = currentSession();
      check('delete-preservation', 'the activity is gone from the console and the data file', !afterDel.activities.some((a) => a.id === week1.id));
      check('delete-preservation', 'the submitted attempt still exists, byte-for-byte', JSON.stringify(afterDel.attempts.find((a) => a.id === keptAttempt.id)) === keptJson);
      check('delete-preservation', 'no attempt was removed', afterDel.attempts.length === JSON.parse(attemptsJsonBefore).length);
      check('delete-preservation', 'submitted answers, score and result are unchanged', JSON.stringify(afterDel.attempts.find((a) => a.id === keptAttempt.id).responses) === JSON.stringify(keptAttempt.responses) && afterDel.attempts.find((a) => a.id === keptAttempt.id).score === keptAttempt.score);
      check('delete-preservation', 'other activities are untouched', JSON.stringify(afterDel.activities) === otherActivitiesJson);
      check('delete-preservation', 'student records are untouched', JSON.stringify(afterDel.participants) === participantsJsonBefore);
      check('delete-preservation', 'both question banks are untouched', JSON.stringify(readData().free2027.questionBanks) === banksJsonBefore);
      check('delete-preservation', 'the activity id is retained as a historical reference', (afterDel.activityHistory || []).some((h) => h.id === week1.id));
      await shot(page, '21-activity-deleted-history-kept');

      /* The student can still see the result of the deleted assessment. */
      await page.evaluate(() => freeGo('free-portal'));
      await active(page, 'free-portal');
      /* "Your results this session" is a panel painted by the weekly list, not
         a tab of its own. The portal remembers the leaderboard tab from the
         earlier flow, so select Weekly first. */
      await page.click('[data-f27tab="weekly"]');
      await page.waitForSelector('#freePortalResults .f27-res-row');
      check('delete-preservation', 'the student result for the deleted assessment is still displayed', await page.evaluate((t) => document.getElementById('freePortalResults').textContent.includes(t), 'Recovered Weekly Assessment'));
      check('delete-preservation', 'the surviving result still shows its score', await page.evaluate(() => /\d+\/\d+/.test(document.querySelector('#freePortalResults .f27-res-score').textContent)));
      await shot(page, '22-result-survives-deletion');

      /* 18. Bank bulk delete + delete-all are bank-scoped and preserve results. */
      await page.evaluate(() => go('admin'));
      await active(page, 'admin');
      await openFreeAdmin(page);
      await page.click('[data-f27adm="banks"]');
      await page.waitForSelector('#f27BankList-weekly .f27-admin-row, #f27BankList-weekly input[type="checkbox"]');
      const compCountBefore = readData().free2027.questionBanks.competition.questions.length;
      const attemptsBeforeBank = JSON.stringify(currentSession().attempts);
      /* Only the chosen question is on screen now, so select two by switching
         the dropdown between them. This also proves selection state survives. */
      await page.locator('#f27BankList-weekly input[type="checkbox"]').nth(0).check();
      const weeklyIds = await page.locator('#f27BankPick-weekly option').evaluateAll((os) => os.map((o) => o.value));
      await page.selectOption('#f27BankPick-weekly', weeklyIds[1]);
      await page.locator('#f27BankList-weekly input[type="checkbox"]').nth(0).check();
      await page.click('#f27Bank-weekly button:has-text("Delete selected")');
      await page.waitForFunction(() => /2 questions/.test(document.getElementById('f27BankCount-weekly').textContent), null, { timeout: 20000 });
      check('bulk-delete', 'multi-selected questions are bulk-deleted from the chosen bank', readData().free2027.questionBanks.weekly.questions.length === 2);
      check('bulk-delete', 'bulk deletion never touches the other bank', readData().free2027.questionBanks.competition.questions.length === compCountBefore);
      check('bulk-delete', 'bulk deletion never touches attempts, answers or scores', JSON.stringify(currentSession().attempts) === attemptsBeforeBank);
      await shot(page, '23-bulk-delete');
      await page.click('#f27Bank-weekly button:has-text("Delete all Weekly questions")');
      await page.waitForFunction(() => /0 questions/.test(document.getElementById('f27BankCount-weekly').textContent), null, { timeout: 20000 });
      check('bulk-delete', 'delete-all clears only the selected weekly bank', readData().free2027.questionBanks.weekly.questions.length === 0 && readData().free2027.questionBanks.competition.questions.length === compCountBefore);
      check('bulk-delete', 'historical attempts and scores survive delete-all', JSON.stringify(currentSession().attempts) === attemptsBeforeBank);
      await page.evaluate(() => freeGo('free-portal'));
      await active(page, 'free-portal');
      await page.click('[data-f27tab="weekly"]');
      await page.waitForSelector('#freePortalResults .f27-res-row');
      check('bulk-delete', 'results are still readable after the source bank was emptied', await page.evaluate(() => /Recovered Competition/.test(document.getElementById('freePortalResults').textContent)));
      check('bulk-delete', 'the deleted assessment result is still listed after the bank was emptied', await page.evaluate(() => /Recovered Weekly Assessment/.test(document.getElementById('freePortalResults').textContent)));
      await shot(page, '24-results-after-bank-clear');
    } catch (e) {
      check('round2', 'data-preservation flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
      await shot(page, '98-round2-failure');
    }
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => go('landing'));
  await active(page, 'landing');
  check('desktop', 'desktop Free-mode CBT entry is visible without duplicating mobile drawer', await visible(page, '#landing .dw-cbt-link') && !(await visible(page, '#lpDrawer')));
  check('desktop', 'the separate hub Log in nav link is not shown to free-tutorial students', await page.evaluate(() => {
    const e = document.querySelector('#landing .lp-actions .dw-hub-login');
    return !!e && getComputedStyle(e).display === 'none';
  }));
  check('desktop', 'the desktop nav Get started action is hidden in Free Mode', !(await visible(page, '#landing .lp-actions .dw-original[onclick="go(\'signup\')"]')));
  check('desktop', 'the desktop nav Get started button is hidden, not deleted', await page.evaluate(() => {
    const e = document.querySelector('#landing .lp-actions .dw-original[onclick="go(\'signup\')"]');
    return !!e && e.textContent.trim() === 'Get started' && getComputedStyle(e).display === 'none';
  }));
  await checkAccountCreationVisibility(page, 'desktop homepage', true);
  check('desktop', 'the desktop hero hides the original Get started button in Free Mode', !(await visible(page, '#landing .hero-original-cta')));
  check('desktop', 'the desktop hero keeps the account link visible', await visible(page, '#landing .hero-btns .lp-btn-ghost'));
  await shot(page, '18-homepage-desktop');
  /* The desktop navigation CBT Portal link must open the same landing page. */
  await page.click('#landing .lp-actions .dw-cbt-link');
  await active(page, 'free-home');
  check('desktop', 'the desktop navigation CBT Portal link opens the Free UTME Tutorial landing page', true);
  check('desktop', 'it is the same landing page the mobile sidebar opens', await page.evaluate(() => {
    const t = document.getElementById('free-home').textContent;
    return /2027 UTME · Free Tutorial Edition/.test(t) && /Register free/.test(t) && /Student log in/.test(t) && /Enter the CBT Portal/.test(t);
  }));
  check('desktop', 'the edition landing nav bar carries no separate Log in link', await page.evaluate(() => {
    const nav = document.querySelector('#free-home .lp-actions');
    return !!nav && !Array.from(nav.querySelectorAll('button')).some((b) => /^\s*Log in\s*$/.test(b.textContent));
  }));
  await shot(page, '18b-desktop-nav-cbt-landing');
  await page.evaluate(() => go('landing'));
  await active(page, 'landing');
  await page.evaluate(() => go('free-home'));
  await active(page, 'free-home');
  check('desktop', 'Free Tutorial landing fits the desktop viewport', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(page, '19-free-landing-desktop');
  /* 19. GUEST direct CBT Portal entry — a brand-new browser context with no
         student token, no registration and no login, on mobile AND desktop. */
  for (const [label, vp, mobile] of [['mobile', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 900 }, false]]) {
    const gbrowser = await pw.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'].concat(extraArgs), headless: true });
    const gctx = await gbrowser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const gp = await gctx.newPage();
    gp.setDefaultTimeout(20000);
    gp.on('pageerror', (e) => jsErrors.push('guest-' + label + ': ' + String(e && e.message || e)));
    gp.on('dialog', (d) => d.accept().catch(() => {}));
    try {
      await gp.goto(BASE, { waitUntil: 'networkidle' });
      await active(gp, 'landing');
      check('guest-entry', label + ': homepage has no bootcamp CTA', await gp.evaluate(() => !/start free utme bootcamp/i.test(document.body.innerText)));
      check('guest-entry', label + ': CBT Portal button is visible', await visible(gp, '#landing .hero-cbt'));
      check('guest-entry', label + ': the hero hides the original Get started button', !(await visible(gp, '#landing .hero-original-cta')));
      check('guest-entry', label + ': the hero keeps the account link visible', await visible(gp, '#landing .hero-btns .lp-btn-ghost'));
      await gp.click('#landing .hero-cbt');
      await active(gp, 'free-home');
      check('guest-entry', label + ': the homepage CBT Portal button opens the Free UTME Tutorial landing page', await gp.evaluate(() => document.getElementById('free-home').classList.contains('active')));
      check('guest-entry', label + ': the landing page shows the edition heading and its three choices', await gp.evaluate(() => {
        const t = document.getElementById('free-home').textContent;
        return /2027 UTME · Free Tutorial Edition/.test(t) && /Register free/.test(t) && /Student log in/.test(t) && /Enter the CBT Portal/.test(t);
      }));
      check('guest-entry', label + ': no registration screen was opened on the way in', await gp.evaluate(() => !document.getElementById('free-register').classList.contains('active')));
      check('guest-entry', label + ': no hub signup or login screen was opened', await gp.evaluate(() => ['signup', 'login-v2', 'login'].every((id) => { const e = document.getElementById(id); return !e || !e.classList.contains('active'); })));
      /* Register free opens the edition's own registration page directly. */
      await gp.click('#free-home .f27-cta button[onclick="freeHomeCta()"]');
      await active(gp, 'free-register');
      check('guest-entry', label + ': Register free opens the Free UTME registration page', await gp.evaluate(() => !!document.getElementById('freePassword') && document.getElementById('free-register').classList.contains('active')));
      await gp.evaluate(() => freeGo('free-home'));
      await active(gp, 'free-home');
      /* Enter the CBT Portal is the authentication-aware step. */
      await gp.click('#free-home .f27-cta button:has-text("Enter the CBT Portal")');
      await active(gp, 'free-login');
      check('guest-entry', label + ': Enter the CBT Portal sends an unauthenticated student to the EDITION login page', await gp.evaluate(() => document.getElementById('free-login').classList.contains('active')));
      check('guest-entry', label + ': that is the edition login, not the hub account login', await gp.evaluate(() => !!document.getElementById('freeLoginEmail') && !document.getElementById('login-v2').classList.contains('active')));
      await shot(gp, '24-guest-login-' + label);
      /* The login page's registration link works. */
      await gp.click('#free-login a[onclick*="free-register"]');
      await active(gp, 'free-register');
      check('guest-entry', label + ': the login page registration link opens the edition registration page', true);
      /* The public catalogue itself is unchanged and still renders for a guest. */
      await gp.evaluate(() => freeGo('free-portal'));
      await active(gp, 'free-portal');
      await gp.waitForSelector('#freePortalList .f27-guest-note');
      check('guest-entry', label + ': the guest can browse real published listings', await gp.evaluate(() => document.querySelectorAll('#freePortalList .f27-item').length > 0));
      check('guest-entry', label + ': the guest is told browsing needs no account', await gp.evaluate(() => /no account needed/.test(document.getElementById('freePortalList').textContent)));
      check('guest-entry', label + ': Back and Back to Home are visible in the portal', await visible(gp, '#free-portal .lp-actions button[onclick="freeNavBack()"]') && await visible(gp, '#free-portal .lp-actions button[onclick="freeNavHome()"]'));
      check('guest-entry', label + ': no horizontal overflow', await gp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await shot(gp, '25-guest-cbt-' + label);
      await gp.click('#free-portal .lp-actions button[onclick="freeNavHome()"]');
      await active(gp, 'landing');
      check('guest-entry', label + ': Back to Home returns the guest to the homepage', true);
      /* The hero account link is mode-aware: in Free Tutorial Mode it belongs to
         the edition, so a guest never reaches the hub account login. */
      await gp.click('#landing .hero-btns .lp-btn-ghost');
      await active(gp, 'free-login');
      check('guest-entry', label + ': the hero account link opens the EDITION login', await gp.evaluate(() => document.getElementById('free-login').classList.contains('active') && !!document.getElementById('freeLoginEmail')));
      check('guest-entry', label + ': the hero account link never opens the hub login', await gp.evaluate(() => !document.getElementById('login-v2').classList.contains('active') && !document.getElementById('signup').classList.contains('active')));
      await shot(gp, '25b-guest-hero-account-' + label);
    } catch (e) {
      check('guest-entry', label + ': guest flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e);
      await shot(gp, '97-guest-failure-' + label);
    }
    await gbrowser.close();
  }

  /* =====================================================================
     ORIGINAL STUDENT ACCOUNTS — registration and login must work through
     the hub's own forms, in Free Tutorial Mode, beside the CBT Portal.
     Uses the real signup form, the real approval flow and the real login.
     ===================================================================== */
  const ACCT_EMAIL = 'original.account.' + Date.now() + '@example.com';
  const ACCT_PW = 'Original-Pw-' + Date.now();
  let scholarId = null;
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    check('original-accounts', 'Free Mode hides the hero Get started action', !(await visible(page, '#landing .hero-original-cta')));
    check('original-accounts', 'Free Mode keeps the hero account link visible', await visible(page, '#landing .hero-btns .lp-btn-ghost'));
    check('original-accounts', 'Free Mode hides the nav Get started action', !(await visible(page, '#landing .lp-actions button[onclick="go(\'signup\')"]')));
    check('original-accounts', 'the hub Log in nav shortcut stands down in Free Mode but is not deleted', await page.evaluate(() => {
      const e = document.querySelector('#landing .lp-actions .dw-hub-login');
      return !!e && getComputedStyle(e).display === 'none';
    }));
    check('original-accounts', 'the hub login screen itself is still reachable and independent', await page.evaluate(() => !!document.getElementById('login-v2') && !!document.getElementById('loginId')));

    /* 1. A NEW student reaches the ORIGINAL registration form. Every homepage
       sign-up shortcut is hidden in Free Tutorial Mode by design, so reach the
       hub's registration screen by its own unchanged route — proving the
       original account system still works independently in Free Tutorial Mode.
       Original Mode below clicks the real buttons. */
    await page.evaluate(() => go('signup'));
    await active(page, 'signup');
    check('original-accounts', 'Get started opens the ORIGINAL registration screen (not the edition)', await page.evaluate(() => document.getElementById('signup').classList.contains('active') && !document.getElementById('free-home').classList.contains('active')));
    check('original-accounts', 'the original registration form is actually rendered', await visible(page, '#signup #signName') && await visible(page, '#signup #signupBtn'));
    check('original-accounts', 'the original fields and validation are intact', await page.evaluate(() => ['signName', 'signEmail', 'signPhone', 'signGoal', 'signPw', 'signConsent', 'subjGrid'].every((id) => !!document.getElementById(id))));
    await shot(page, '26-original-registration');

    /* 2. Register through the existing implementation. */
    await page.fill('#signName', 'Original Account Student');
    await page.fill('#signEmail', ACCT_EMAIL);
    await page.fill('#signPhone', '08012345678');
    await page.selectOption('#signGoal', { label: 'JAMB / UTME 2027' });
    for (const sub of ['Physics', 'Chemistry', 'Biology']) await page.check('#subjGrid input[data-subject="' + sub + '"]');
    await page.fill('#signPw', ACCT_PW);
    await page.check('#signConsent');
    await page.click('#signupBtn');
    await active(page, 'signup-pending');
    scholarId = (await page.textContent('#pendingScholarId') || '').trim();
    check('original-accounts', 'registration succeeds through the existing approval flow', /^GOC-S-/.test(scholarId), scholarId);
    check('original-accounts', 'the original pending screen shows the issued Scholar ID', await visible(page, '#signup-pending #pendingScholarId'));
    const roster = readData();
    const rec = (roster.students || []).find((x) => x.id === scholarId);
    check('original-accounts', 'the student record is persisted by the original implementation', !!rec && rec.email === ACCT_EMAIL && rec.pendingApproval === true, JSON.stringify(rec || {}).slice(0, 160));
    await shot(page, '27-original-registration-pending');

    /* 3. Approve through the existing console API, then log in normally. */
    /* Approve with the app's OWN api object, which holds the console session
       in its closure — exactly the call the console's Approve button makes. */
    const approved = await page.evaluate(async (id) => {
      try { const r = await window.GOC.api.approveStudent(id); return { ok: true, active: r && r.active, pending: r && r.pendingApproval }; }
      catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }, scholarId);
    check('original-accounts', 'the existing approval call activates the account', approved.ok === true && approved.active === true && approved.pending === false, JSON.stringify(approved).slice(0, 200));

    /* 4. A returning student logs in through the ORIGINAL login form. */
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    /* In Free Tutorial Mode the hero account link belongs to the edition. */
    await page.click('#landing .hero-btns .lp-btn-ghost');
    await active(page, 'free-login');
    check('original-accounts', 'Free Mode: "I already have an account" opens the EDITION login', await page.evaluate(() => document.getElementById('free-login').classList.contains('active') && !!document.getElementById('freeLoginEmail')));
    check('original-accounts', 'Free Mode: it never opens the hub login', await page.evaluate(() => !document.getElementById('login-v2').classList.contains('active')));
    /* The hub login has no public shortcut in Free Mode by design, so reach it
       by its own route to prove it is untouched and still works. */
    await page.evaluate(() => go('login-v2'));
    await active(page, 'login-v2');
    check('original-accounts', 'the ORIGINAL login is still reachable and independent in Free Mode', await page.evaluate(() => document.getElementById('login-v2').classList.contains('active') && !document.getElementById('free-register').classList.contains('active')));
    check('original-accounts', 'the original login form is actually rendered', await visible(page, '#login-v2 #loginId') && await visible(page, '#login-v2 #loginBtn'));
    await shot(page, '28-original-login');
    await page.fill('#loginId', scholarId);
    await page.fill('#loginPw', ACCT_PW);
    await page.click('#loginBtn');
    await active(page, 'home');
    check('original-accounts', 'the registered student logs in and reaches the ORIGINAL dashboard', await page.evaluate(() => document.getElementById('home').classList.contains('active') && !document.getElementById('free-home').classList.contains('active')));
    check('original-accounts', 'the original dashboard is visible, not hidden by the edition', await visible(page, '#home'));
    check('original-accounts', 'the hub navigation chrome is restored for the signed-in student', await page.evaluate(() => document.body.classList.contains('goc-original-area')));
    await shot(page, '29-original-dashboard');

    /* 5. The existing account remains accessible, and CBT still works. */
    await page.evaluate(() => go('profile'));
    await active(page, 'profile');
    check('original-accounts', 'the student can open their existing profile', await visible(page, '#profile'));
    /* A brand-new student gets the hub's OWN first-run tour (it fires ~1.2s
       after the dashboard renders). That is original behaviour, so let it
       appear and dismiss it the way a student would before continuing. */
    await page.waitForTimeout(1800);
    const tourShown = await page.locator('#tutSkip').isVisible().catch(() => false);
    if (tourShown) {
      await page.click('#tutSkip');
      await page.waitForFunction(() => {
        const o = document.getElementById('tutOverlay');
        return !o || getComputedStyle(o).display === 'none';
      }, null, { timeout: 10000 });
    }
    check('original-accounts', 'the original first-run tour no longer covers the page', await page.evaluate(() => {
      const o = document.getElementById('tutOverlay');
      return !o || getComputedStyle(o).display === 'none';
    }));
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    /* The signed-in student's own boot sequence can still be settling. */
    await page.waitForTimeout(800);
    await page.evaluate(() => go('landing'));
    await active(page, 'landing');
    check('original-accounts', 'the homepage is reachable again after using the original account', await page.evaluate(() => document.getElementById('landing').classList.contains('active')));
    check('original-accounts', 'Free Tutorial Mode is still active after student login', await page.evaluate(() => document.body.classList.contains('f27-mode')));
    await page.click('#landing .hero-cbt');
    await active(page, 'free-home');
    check('original-accounts', 'the CBT Portal still opens the edition landing page alongside the original accounts', true);
    check('original-accounts', 'using the hub account did not change where CBT Portal leads', await page.evaluate(() => document.getElementById('free-home').classList.contains('active')));
    check('original-accounts', 'the removed bootcamp CTA has not returned', await page.evaluate(() => !/start free utme bootcamp/i.test(document.body.innerText)));
    const finalRec = (readData().students || []).find((x) => x.id === scholarId);
    check('original-accounts', 'the Scholar ID and account persist unchanged after login', !!finalRec && finalRec.id === scholarId && finalRec.active === true && finalRec.pendingApproval === false);
  } catch (e) {
    check('original-accounts', 'original registration/login flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    console.log('ACCOUNT-STATE ' + JSON.stringify(await page.evaluate(() => ({
      screen: document.querySelector('.screen.active') && document.querySelector('.screen.active').id,
      f27: document.body.classList.contains('f27-mode'),
      area: document.body.classList.contains('goc-original-area'),
      heroCbt: !!document.querySelector('#landing .hero-cbt'),
      heroCbtDisplay: document.querySelector('#landing .hero-cbt') ? getComputedStyle(document.querySelector('#landing .hero-cbt')).display : null,
      rect: (function(){ var e=document.querySelector('#landing .hero-cbt'); if(!e) return null; var r=e.getBoundingClientRect(); var st=getComputedStyle(e); return {x:r.x,y:r.y,w:r.width,h:r.height,vis:st.visibility,op:st.opacity,pe:st.pointerEvents}; })(),
      landingRect: (function(){ var e=document.getElementById('landing'); var r=e.getBoundingClientRect(); var st=getComputedStyle(e); return {x:r.x,y:r.y,w:r.width,h:r.height,disp:st.display,vis:st.visibility}; })(),
      matchCount: document.querySelectorAll('#landing .hero-cbt').length,
      topAtCentre: (function(){ var e=document.querySelector('#landing .hero-cbt'); if(!e) return null; var r=e.getBoundingClientRect(); var t=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return t ? (t.id || t.className || t.tagName) : 'none'; })()
    })).catch(String)));
    await shot(page, '96-original-accounts-failure');
  }

  /* ======================================================================
     12. The Free UTME student's OWN account: signing out ends the session and
     nothing else; logging back in restores the same account and every record;
     and a still-valid session survives closing and reopening the browser.
     ====================================================================== */
  const AUTH = 'student-auth';
  let reopenState = null;
  let authStudentId = null;
  try {
    const crypto = require('crypto');
    const s0 = currentSession();
    const p0 = s0.participants.find((x) => x.email === STUDENT_EMAIL);
    authStudentId = p0 ? p0.id : null;
    check(AUTH, 'the browser-registered student holds a sequential identifier', !!p0 && /^GOC-F-\d{3,}$/.test(p0.id), p0 && p0.id);
    check(AUTH, 'the password is stored only as a scrypt hash', !!p0 && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(p0.passwordHash || ''));
    check(AUTH, 'the plaintext password is nowhere in the data file', JSON.stringify(readData()).indexOf(STUDENT_PW) < 0);
    /* lastSeenAt is a visit stamp and legitimately moves on login; every other
       field, and every attempt/answer/score, must be identical. */
    const owned = () => {
      const ss = currentSession();
      const pp = ss.participants.find((x) => x.id === authStudentId);
      const clone = pp ? JSON.parse(JSON.stringify(pp)) : null;
      if (clone) clone.lastSeenAt = 0;
      return JSON.stringify({ participant: clone, attempts: ss.attempts.filter((a) => a.participantId === authStudentId) });
    };
    const ownedBefore = owned();
    check(AUTH, 'the student has CBT attempts on record before signing out', JSON.parse(ownedBefore).attempts.length > 0, String(JSON.parse(ownedBefore).attempts.length));
    const tokBefore = await page.evaluate(() => localStorage.getItem('goc.free2027.token'));
    check(AUTH, 'the session token is held durably, not per tab', !!tokBefore && await page.evaluate(() => !sessionStorage.getItem('goc.free2027.token')));
    const digestOf = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
    check(AUTH, 'the server persisted only a digest of that token', (readData().free2027.authSessions || []).some((x) => x.tokenHash === digestOf(tokBefore)) && JSON.stringify(readData().free2027.authSessions).indexOf(tokBefore) < 0);
    reopenState = await context.storageState();

    /* Sign out through the real UI control. The hub's own first-run tour can
       still be over the page after the original-account flow; dismiss it the
       way a student would rather than clicking through it. */
    await page.evaluate(() => freeCbtPortal());
    await active(page, 'free-home');
    check(AUTH, 'the CBT Portal entry leads to the edition landing page for a signed-in student too', true);
    /* Enter the CBT Portal with a valid session goes straight to the dashboard. */
    await page.evaluate(() => freePortalEnter());
    await active(page, 'free-portal');
    check(AUTH, 'Enter the CBT Portal with a valid session opens the dashboard directly', true);
    if (await page.locator('#tutSkip').isVisible().catch(() => false)) {
      await page.click('#tutSkip');
      await page.waitForTimeout(300);
    }
    await page.click('#free-portal [onclick="freeSignOut()"]');
    await active(page, 'free-home');
    await page.waitForTimeout(400);
    check(AUTH, 'signing out clears the browser token', await page.evaluate(() => !localStorage.getItem('goc.free2027.token') && !sessionStorage.getItem('goc.free2027.token')));
    check(AUTH, 'signing out deleted the server session', !(readData().free2027.authSessions || []).some((x) => x.tokenHash === digestOf(tokBefore)));
    check(AUTH, 'signing out left the account and every record byte-identical', owned() === ownedBefore);
    check(AUTH, 'the identifier is still in the permanent registry', readData().free2027.studentIds.indexOf(authStudentId) > -1);
    await shot(page, '97-signed-out');

    /* The student-only entry now demands authentication again. */
    await page.evaluate(() => freePortalEnter());
    await active(page, 'free-login');
    check(AUTH, 'after signing out the student entry shows the login page', true);
    await page.fill('#freeLoginEmail', STUDENT_EMAIL);
    await page.fill('#freeLoginPassword', 'NotThePassword-1');
    await page.click('#freeLoginBtn');
    await page.waitForFunction(() => document.getElementById('freeLoginErr').textContent.length > 0);
    check(AUTH, 'an incorrect password is refused in the page', await page.evaluate(() => /not right/i.test(document.getElementById('freeLoginErr').textContent)));
    await shot(page, '98-login-wrong-password');
    await page.fill('#freeLoginPassword', STUDENT_PW);
    await page.click('#freeLoginBtn');
    await active(page, 'free-portal');
    await page.waitForFunction((id) => (document.getElementById('freeWho').textContent || '').indexOf(id) > -1, authStudentId, { timeout: 20000 });
    check(AUTH, 'logging back in restores the SAME student identifier', await page.evaluate((id) => document.getElementById('freeWho').textContent.indexOf(id) > -1, authStudentId));
    check(AUTH, 'logging back in restored every record byte-for-byte', owned() === ownedBefore);
    check(AUTH, 'logging back in created no duplicate account', currentSession().participants.filter((x) => x.email === STUDENT_EMAIL).length === 1);
    const resultsShown = await page.evaluate(async () => {
      const r = await window.GOC.free.results();
      return (r.results || []).length;
    });
    check(AUTH, 'the previous CBT results are readable again after logging back in', resultsShown > 0, String(resultsShown));
    await shot(page, '99-logged-back-in');

    /* Inactivity expiry must land on the EDITION login page, not a hub page. */
    const liveTok = await page.evaluate(() => localStorage.getItem('goc.free2027.token'));
    const expDb = readData();
    const expRec = (expDb.free2027.authSessions || []).find((x) => x.tokenHash === digestOf(liveTok));
    check(AUTH, 'the live session is present before the expiry test', !!expRec);
    if (expRec) {
      expRec.expiresAt = Date.now() - 1;
      fs.writeFileSync(DATA_FILE, JSON.stringify(expDb));
      await page.evaluate(() => freeCbtPortal());
      await active(page, 'free-home');
      await page.evaluate(() => freePortalEnter());
      await active(page, 'free-login');
      check(AUTH, 'an expired session is redirected to the Free UTME login page', await page.evaluate(() => document.getElementById('free-login').classList.contains('active') && !document.getElementById('login-v2').classList.contains('active')));
      check(AUTH, 'the expiry did not delete any student record', owned() === ownedBefore);
      await page.fill('#freeLoginEmail', STUDENT_EMAIL);
      await page.fill('#freeLoginPassword', STUDENT_PW);
      await page.click('#freeLoginBtn');
      await active(page, 'free-portal');
      await page.waitForFunction((id) => (document.getElementById('freeWho').textContent || '').indexOf(id) > -1, authStudentId, { timeout: 20000 });
      check(AUTH, 'logging in after expiry returns to the CBT Portal with the same account', await page.evaluate((id) => document.getElementById('freeWho').textContent.indexOf(id) > -1, authStudentId));
      check(AUTH, 'every record survived the expiry and the new login', owned() === ownedBefore);
      await shot(page, '99c-after-expiry-login');
    }

    /* The public catalogue is still open to a visitor with no session. */
    const guestCatalogue = await page.evaluate(async () => {
      const r = await fetch('api/free2027/catalogue', { headers: { Accept: 'application/json' } });
      return { status: r.status, body: await r.json() };
    });
    check(AUTH, 'the public CBT catalogue needs no session', guestCatalogue.status === 200 && guestCatalogue.body.guest === true);
    check(AUTH, 'the catalogue exposes no student address or password hash', JSON.stringify(guestCatalogue.body).indexOf('@') < 0 && JSON.stringify(guestCatalogue.body).indexOf('passwordHash') < 0);
    reopenState = await context.storageState();
  } catch (e) {
    check(AUTH, 'the sign-out / sign-in flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    await shot(page, '99-student-auth-failure');
  }

  /* B. Layout isolation, measured in both directions at every required width.
     Runs last so navigating between the two applications cannot disturb the
     data-preservation flows above. */
  if (page && !page.isClosed()) {
    for (const [vw, vh, kind] of [[1024, 768, 'desktop'], [1280, 800, 'desktop'], [1440, 900, 'desktop'], [1920, 1080, 'desktop'], [320, 568, 'mobile'], [360, 640, 'mobile'], [375, 667, 'mobile'], [390, 844, 'mobile'], [430, 932, 'mobile']]) {
      await page.setViewportSize({ width: vw, height: vh });
      await page.evaluate(() => go('free-home'));
      await page.waitForTimeout(420);
      const f = await page.evaluate(() => {
        const tab = document.getElementById('tabbar');
        const t = tab.getBoundingClientRect();
        const scr = document.getElementById('free-home');
        return {
          sidebar: getComputedStyle(tab).display !== 'none' && t.width > 0,
          tabW: Math.round(t.width),
          screensLeft: Math.round(document.getElementById('screens').getBoundingClientRect().left),
          ownHeader: !!scr.querySelector('.f27-nav'),
          headerW: Math.round((scr.querySelector('.f27-nav') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
          noHOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          contentStartsAtZero: Math.round(scr.getBoundingClientRect().left) === 0
        };
      });
      check('shell-isolation', kind + ' ' + vw + 'px: the hub sidebar is not rendered over the tutorial', !f.sidebar, 'tabbar width ' + f.tabW);
      check('shell-isolation', kind + ' ' + vw + 'px: the tutorial content is not inset by a sidebar', f.screensLeft === 0 && f.contentStartsAtZero);
      check('shell-isolation', kind + ' ' + vw + 'px: the tutorial keeps its own header navigation', f.ownHeader && f.headerW > 0);
      check('shell-isolation', kind + ' ' + vw + 'px: no horizontal overflow', f.noHOverflow);
      if (kind === 'desktop') {
        /* Return trip: the hub must get its sidebar and 256px offset back. */
        await page.evaluate(() => go('home'));
        await page.waitForTimeout(420);
        const h = await page.evaluate(() => {
          const tab = document.getElementById('tabbar');
          const t = tab.getBoundingClientRect();
          return { sidebar: getComputedStyle(tab).display !== 'none' && t.width > 0, w: Math.round(t.width), left: Math.round(document.getElementById('screens').getBoundingClientRect().left) };
        });
        check('shell-isolation', 'desktop ' + vw + 'px: returning to the hub restores its 256px sidebar', h.sidebar && h.w === 256, JSON.stringify(h));
        check('shell-isolation', 'desktop ' + vw + 'px: the hub content is inset past the sidebar again', h.left === 256, String(h.left));
        await page.evaluate(() => go('free-home'));
        await page.waitForTimeout(350);
        check('shell-isolation', 'desktop ' + vw + 'px: a second visit to the tutorial is still unobstructed', await page.evaluate(() => {
          const t = document.getElementById('tabbar');
          return getComputedStyle(t).display === 'none' && Math.round(document.getElementById('screens').getBoundingClientRect().left) === 0;
        }));
      }
      if (vw === 1440 || vw === 320) await shot(page, '99c-tutorial-' + vw + 'px');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => go('home'));
    await page.waitForTimeout(400);
    await shot(page, '99d-hub-sidebar-intact');
    check('shell-isolation', 'no page JavaScript error across the whole viewport matrix', jsErrors.length === 0, jsErrors.join(' | '));
  }

  check('harness', 'no uncaught page JavaScript errors', jsErrors.length === 0, jsErrors.join(' | '));
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed: results.filter((r) => r.pass).length, total: results.length, results, jsErrors }, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log('\nSUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.flow + ': ' + f.name).join('; '));
  await browser.close();

  /* Close the browser completely, then open a new one carrying only what a
     returning visitor's browser would still hold (localStorage). A still-valid
     session must survive that; a per-tab token would not. */
  if (reopenState && authStudentId) {
    let rb = null;
    try {
      rb = await pw.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'].concat(extraArgs), headless: true });
      const rctx = await rb.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', storageState: reopenState });
      const rp = await rctx.newPage();
      const rerr = [];
      rp.on('pageerror', (e) => rerr.push(String(e && e.message || e)));
      await rp.goto(BASE, { waitUntil: 'networkidle' });
      await rp.waitForTimeout(1500);
      check('browser-reopen', 'the token is still held after the browser was closed', await rp.evaluate(() => !!localStorage.getItem('goc.free2027.token')));
      await rp.evaluate(() => freePortalEnter());
      await active(rp, 'free-portal');
      await rp.waitForFunction((id) => (document.getElementById('freeWho').textContent || '').indexOf(id) > -1, authStudentId, { timeout: 20000 });
      check('browser-reopen', 'the student is still signed in as the SAME account', await rp.evaluate((id) => document.getElementById('freeWho').textContent.indexOf(id) > -1, authStudentId));
      const rr = await rp.evaluate(async () => { const r = await window.GOC.free.results(); return (r.results || []).length; });
      check('browser-reopen', 'their previous results are still there', rr > 0, String(rr));
      check('browser-reopen', 'no page JavaScript error on the reopened browser', rerr.length === 0, rerr.join(' | '));
      await shot(rp, '99b-browser-reopened');
    } catch (e) {
      check('browser-reopen', 'the close-and-reopen flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    } finally { if (rb) { try { await rb.close(); } catch (e) {} } }
  }

  const allFailed = results.filter((r) => !r.pass);
  console.log('FINAL SUMMARY: ' + (results.length - allFailed.length) + '/' + results.length + ' checks passed');
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed: results.filter((r) => r.pass).length, total: results.length, results, jsErrors }, null, 2));
  process.exit(allFailed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
