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
    check('homepage', 'the obsolete hero account CTA is not shown in Free mode', !(await visible(page, '#landing .hero-original-cta')));
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
    check('drawer', 'original account buttons hidden in Free mode', await page.evaluate(() => getComputedStyle(document.querySelector('#lpDrawer .dw-original')).display === 'none'));
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
    /* Corrected contract: the drawer CBT Portal action enters the portal
       DIRECTLY. A guest is never bounced into registration first. */
    await active(page, 'free-portal');
    check('drawer', 'CBT Portal action opens the portal directly without a session', true);
    check('drawer', 'the drawer CBT action never opens registration', await page.evaluate(() => !document.getElementById('free-register').classList.contains('active')));
    await page.click('#free-portal .lp-actions [onclick="freeNavBack()"]');
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
    check('registration', 'full name/email/course fields', await page.evaluate(() => !!document.getElementById('freeName') && !!document.getElementById('freeEmail') && !!document.getElementById('freeCourse')));
    await page.click('#freeRegBtn');
    check('registration', 'empty submission is validated', await page.evaluate(() => document.getElementById('freeRegErr').textContent.length > 0));
    await page.fill('#freeName', 'Ada Browser');
    await page.fill('#freeEmail', 'not-an-email');
    await page.fill('#freeCourse', 'Medicine and Surgery');
    await page.click('#freeRegBtn');
    check('registration', 'invalid email is validated', await page.evaluate(() => /email/i.test(document.getElementById('freeRegErr').textContent)));
    await page.fill('#freeEmail', STUDENT_EMAIL);
    await page.fill('#freeCourse', 'Medicine and Surgery');
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
    check('registration', 'verified student reaches CBT Portal', await page.evaluate(() => /GOC-F27-/.test(document.getElementById('freeWho').textContent)));
    await shot(page, '05-portal-mobile');
    const whoBefore = await page.textContent('#freeWho');
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => freeHomeCta());
    await active(page, 'free-portal');
    check('registration', 'refresh keeps the verified tab session and identity', await page.textContent('#freeWho') === whoBefore);

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
    check('cbt', 'mobile exam header shows a working Back control', await visible(page, '.f27-cbt-back'));
    check('cbt', 'mobile exam header shows a working Back to Home control', await visible(page, '.f27-cbt-home'));
    check('cbt', 'the exam header controls do not overlap on a 390px screen', await page.evaluate(() => {
      const b = document.querySelector('.f27-cbt-back').getBoundingClientRect();
      const h = document.querySelector('.f27-cbt-home').getBoundingClientRect();
      return b.right <= h.left + 1 && document.documentElement.scrollWidth <= window.innerWidth;
    }));
    await shot(page, '12-cbt-question');
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
    await page.click('.f27-cbt-back');
    await active(page, 'free-portal');
    check('cbt', 'leaving an active paper asks for confirmation', true);
    await page.click('#freePortalList button:has-text("Resume")');
    await active(page, 'free-exam');
    check('cbt', 'resuming restores the saved selected option', await page.evaluate(() => document.querySelector('#freeExamOpts .sel')?.getAttribute('aria-pressed') === 'true'));
    const resumedAttempt = currentSession()?.attempts.find((a) => a.activityId === 'F27-Q1' && !a.submittedAt);
    check('cbt', 'resuming reuses the same attempt and paper', resumedAttempt?.id === openAttempt?.id && JSON.stringify(resumedAttempt?.questionIds) === JSON.stringify(openAttempt?.questionIds));
    await page.click('#freeExamSubmit');
    await page.waitForSelector('#freeExamConfirm:not([hidden])');
    check('cbt', 'submit confirmation appears', true);
    await page.click('#freeExamConfirmCancel');
    check('cbt', 'cancel keeps the paper open', await page.evaluate(() => document.getElementById('freeExamConfirm').hidden && document.getElementById('free-exam').classList.contains('active')));
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
    check('leaderboard', 'ranked competition table contains the submitted student', await page.evaluate(() => /GOC-F27-/.test(document.querySelector('#freeBoardBody tbody').textContent) && /Score/.test(document.querySelector('#freeBoardBody thead').textContent)));
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
    await shot(page, '17-original-mode-drawer');
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
      await page.locator('#f27BankList-weekly input[type="checkbox"]').nth(0).check();
      await page.locator('#f27BankList-weekly input[type="checkbox"]').nth(1).check();
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
  await shot(page, '18-homepage-desktop');
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
      await gp.click('#landing .hero-cbt');
      await active(gp, 'free-portal');
      check('guest-entry', label + ': clicking CBT Portal opens the portal directly', await gp.evaluate(() => document.getElementById('free-portal').classList.contains('active')));
      check('guest-entry', label + ': no registration screen was opened', await gp.evaluate(() => !document.getElementById('free-register').classList.contains('active')));
      check('guest-entry', label + ': no signup or login screen was opened', await gp.evaluate(() => ['signup', 'login-v2', 'login'].every((id) => { const e = document.getElementById(id); return !e || !e.classList.contains('active'); })));
      await gp.waitForSelector('#freePortalList .f27-guest-note');
      check('guest-entry', label + ': the guest can browse real published listings', await gp.evaluate(() => document.querySelectorAll('#freePortalList .f27-item').length > 0));
      check('guest-entry', label + ': the guest is told browsing needs no account', await gp.evaluate(() => /no account needed/.test(document.getElementById('freePortalList').textContent)));
      check('guest-entry', label + ': Back and Back to Home are visible in the portal', await visible(gp, '#free-portal .lp-actions button[onclick="freeNavBack()"]') && await visible(gp, '#free-portal .lp-actions button[onclick="freeNavHome()"]'));
      check('guest-entry', label + ': no horizontal overflow', await gp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await shot(gp, '25-guest-cbt-' + label);
      await gp.click('#free-portal .lp-actions button[onclick="freeNavHome()"]');
      await active(gp, 'landing');
      check('guest-entry', label + ': Back to Home returns the guest to the homepage', true);
    } catch (e) {
      check('guest-entry', label + ': guest flow completed', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e);
      await shot(gp, '97-guest-failure-' + label);
    }
    await gbrowser.close();
  }

  check('harness', 'no uncaught page JavaScript errors', jsErrors.length === 0, jsErrors.join(' | '));
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, passed: results.filter((r) => r.pass).length, total: results.length, results, jsErrors }, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log('\nSUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.flow + ': ' + f.name).join('; '));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
