/* test-stage-c-homepage.js — Stage C homepage boundaries.

   Locks the four approved Stage C decisions without re-testing the rest of the
   platform:
     A. the existing mobile drawer is the single navigation surface, is
        reorganised (not replaced), and every link resolves on a phone;
     B. the public Programmes section and its navigation are retired;
     C. Scholarship and Stage keep their existing disabled/ready positions;
     D. Try GOC sits before Get in touch/Contact, with its anonymous preview
        and links unchanged.

   The drawer's real JavaScript is executed here against a tiny DOM double, so
   this suite catches a broken handler as well as a missing label.
   Run:  node test/test-stage-c-homepage.js  */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');
var freeUi = fs.readFileSync(path.join(APP, 'js', 'free2027-ui.js'), 'utf8');
var passed = 0;

function ok(name, condition, detail) {
  if (condition) { passed++; console.log('  pass  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '   (' + String(detail).slice(0, 240) + ')' : '')); process.exitCode = 1; }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}
function at(needle) { var i = index.indexOf(needle); assert(i >= 0, 'missing ' + needle); return i; }
function section(open, close) {
  var a = index.indexOf(open);
  if (a < 0) return '';
  var b = index.indexOf(close, a + open.length);
  return b < 0 ? '' : index.slice(a, b + close.length);
}
function labelsOf(markup) {
  return Array.from(markup.matchAll(/<button\b[^>]*onclick="[^"]+"[^>]*>([\s\S]*?)<\/button>/g), function (m) {
    return m[1].replace(/<[^>]+>/g, '').replace(/[◇🔔]/g, '').replace(/&amp;/g, '&').replace(/New$/, '').trim();
  });
}

console.log('\nC-B: the public Programmes section is retired');
ok('the landing no longer presents a Programmes section',
  !/id="lpTiers"/.test(index) && !/<div class="lp-eyebrow">Programmes<\/div>/.test(index));
ok('the GOC student card and full-access list are gone from the homepage',
  !/<b>GOC student<\/b>/.test(index) && !/tc-card goc/.test(index) && !/no limited accounts/.test(index));
ok('no desktop Programmes navigation link remains',
  !/dwGoTo\('lpTiers'\)/.test(index) && !/>Programmes<\/button>/.test(index));
ok('no obsolete anchor or empty section is left behind',
  !/id="lpTiers"/.test(index) && !/landing-tiers|tier-compare/.test(index + css));

console.log('\nC-C: Scholarship and Stage stay put');
var iHow = at('id="lpHow"');
var iScholarship = at('id="lpScholarship"');
var iStage = at('id="lpStage"');
var iParents = at('id="lpParents"');
var iTry = at('id="lpTry"');
var iContact = at('id="contact"');
var iNews = at('id="lpNewsIntro"');
ok('How it works → Scholarship → Stage → Parents (unchanged order)',
  iHow < iScholarship && iScholarship < iStage && iStage < iParents);
ok('the Scholarship banner is still the hidden, BOULDER-disabled block',
  /id="lpScholarship" hidden/.test(index)
  && /BOULDER — SCHOLARSHIP HOMEPAGE BANNER/.test(index)
  && /END BOULDER — SCHOLARSHIP HOMEPAGE BANNER/.test(index));
ok('the Stage quote and its three moving parts survive',
  /id="lpStage"[\s\S]*?lq-mark[\s\S]*?class="qw"[\s\S]*?class="who"/.test(index));
ok('Scholarship and Stage were not exposed in the mobile drawer',
  !/dwGoTo\('lpScholarship'\)/.test(index) && !/dwGoTo\('lpStage'\)/.test(index));

console.log('\nC-D: Try GOC is before Get in touch/Contact');
ok('Try GOC now sits between Parents and Contact', iParents < iTry && iTry < iContact);
ok('Get in touch is the last content section, after Updates & News', iNews < iContact);
ok('the Try GOC block itself is unchanged',
  /id="lpTry"[\s\S]*?<div class="lp-eyebrow">Try G\.O\.C<\/div>[\s\S]*?<h2>Free JAMB Practice Preview<\/h2>[\s\S]*?no account, no name, no email needed[\s\S]*?onclick="demoOpen\(\)"[\s\S]*?Try a free practice session[\s\S]*?not official JAMB questions/.test(index));
ok('Get in touch is still the contact section', /id="contact"[\s\S]{0,160}<div class="lp-eyebrow">Get in touch<\/div>/.test(index));
ok('the practice button is centred by the layout, not by a left offset',
  /\.lp-try\{[^}]*text-align:center/.test(css)
  && /\.lp-try-btn\{[^}]*display:inline-flex/.test(css)
  && /\.lp-try-btn\{[^}]*margin:14px auto 0/.test(css)
  && !/\.lp-try-btn\{[^}]*margin-left:/.test(css));
ok('the centred button keeps its existing preview handler',
  /class="lp-cta lp-try-btn"[^>]*onclick="demoOpen\(\)"/.test(index));

console.log('\nC-A: the existing mobile drawer is reorganised, not replaced');
var drawer = section('<aside class="lp-drawer" id="lpDrawer"', '</aside>');
var nav = section('<nav class="dw-nav">', '</nav>');
var buttons = section('<div class="dw-btns">', '</div>');
ok('the drawer keeps its identity, scrim and close control',
  /id="lpDrawer"/.test(index) && /class="lp-scrim" id="lpScrim"/.test(index) && /class="dw-x"[^>]*aria-label="Close menu"/.test(index));
ok('the drawer is a labelled modal dialog for assistive technology',
  /<aside class="lp-drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-label="Site menu"/.test(index)
  && /<button class="lp-burger"[^>]*aria-controls="lpDrawer"[^>]*aria-expanded="false"[^>]*id="lpBurger"/.test(index)
  && /class="lp-scrim" id="lpScrim" aria-hidden="true"/.test(index));
ok('drawer controls have comfortable touch targets and cannot be clipped',
  /\.lp-drawer\{[^}]*overscroll-behavior:contain/.test(css)
  && /\.dw-nav button\{[^}]*min-height:50px/.test(css)
  && /\.dw-x\{[^}]*width:40px[^}]*height:40px/.test(css)
  && /@media \(max-width:360px\)\{[\s\S]*?\.lp-drawer\{/.test(css));
ok('drawer markup still exposes the existing navigation and account groups',
  nav.length > 0 && buttons.length > 0 && /id="lpDrawer"/.test(drawer));
ok('the drawer links mirror the landing order (About, Subjects, How, Try, Contact, Updates)',
  JSON.stringify(labelsOf(nav)) === JSON.stringify(['About G.O.C', 'Subjects offered', 'How it works', 'Try GOC — free practice', 'Contact us', 'Updates & News']),
  labelsOf(nav).join(' | '));

var drawerTargets = [];
var m;
var reTarget = /dwGoTo\('([^']+)'\)/g;
while ((m = reTarget.exec(nav))) drawerTargets.push(m[1]);
ok('every drawer section link has a real destination',
  drawerTargets.length === 5 && drawerTargets.every(function (id) { return new RegExp('id="' + id + '"').test(index); }),
  drawerTargets.join(', '));
ok('Try GOC in the drawer points at the relocated #lpTry', /dwGoTo\('lpTry'\)/.test(nav) && iTry < iContact);

var screenTargets = [];
var reScreen = /dwGo\('([^']+)'\)/g;
while ((m = reScreen.exec(drawer))) screenTargets.push(m[1]);
ok('every drawer screen link has a real screen',
  JSON.stringify(screenTargets) === JSON.stringify(['updates', 'signup', 'login-v2'])
  && screenTargets.every(function (id) { return new RegExp('id="' + id + '"').test(index); }),
  screenTargets.join(', '));
ok('the CBT Portal action and its Free-mode-safe markup remain',
  /class="btn btn-red btn-block dw-cbt" onclick="dwFreePortal\(\)">CBT Portal<\/button>/.test(buttons)
  && /F\.dwFreePortal = function/.test(freeUi)
  && /Access your weekly assessments and competitions\./.test(buttons));
ok('the original account buttons are byte-intact',
  /<button class="btn btn-red btn-block dw-original" onclick="dwGo\('signup'\)">Create free account<\/button>/.test(buttons)
  && /<button class="btn btn-outline btn-block dw-original dw-hub-login" onclick="dwGo\('login-v2'\)"[^>]*>Log in<\/button>/.test(buttons));
ok('the account actions are in the existing .dw-btns group, not a second menu',
  (drawer.match(/class="dw-nav"/g) || []).length === 1 && (drawer.match(/class="dw-btns"/g) || []).length === 1);

console.log('\nC-A: the existing open/close/navigate/edge-drag behaviour is intact');
['drawerEls', 'openDrawer', 'closeDrawer', 'dwGo', 'dwGoTo'].forEach(function (fn) {
  ok('js/app.js still defines ' + fn + '()', new RegExp('function ' + fn + '\\(').test(app));
});
ok('the burger and scrim call the existing handlers',
  /onclick="openDrawer\(\)"/.test((index.match(/<button\b[^>]*id="lpBurger"[^>]*>/) || [''])[0])
  && /onclick="closeDrawer\(\)"/.test((index.match(/<div\b[^>]*id="lpScrim"[^>]*>/) || [''])[0]));
ok('edge-drag still uses the same pointer/touch gestures',
  /document\.addEventListener\('touchstart'/.test(app)
  && /startX <= 26/.test(app)
  && /width \* 0\.35/.test(app)
  && /wasOpen\)\{ if\(dx < -60\) closeDrawer\(\); else openDrawer\(\); \}/.test(app));
ok('the drawer is still hidden at desktop width',
  /@media\(min-width:900px\)\{[^}]*\.lp-drawer,\.lp-scrim\{display:none\}/.test(css.replace(/\s+/g, ''))
  || /\.lp-drawer,\.lp-scrim\{display:none\}/.test(css.replace(/\s+/g, '')));

/* Execute the real drawer functions against a minimal DOM double. */
var goCalls = [], scrollCalls = [];
function el(id) {
  return {
    id: id, style: {}, attrs: {}, classes: {},
    classList: {
      add: function (c) { this.owner.classes[c] = true; },
      remove: function (c) { delete this.owner.classes[c]; },
      contains: function (c) { return !!this.owner.classes[c]; }
    },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    scrollIntoView: function (opts) { scrollCalls.push({ id: id, opts: opts }); },
    offsetWidth: 300
  };
}
var els = {};
['lpDrawer', 'lpScrim', 'lpBurger'].concat(drawerTargets).forEach(function (id) {
  if (!els[id]) { els[id] = el(id); els[id].classList.owner = els[id]; }
});
var ctx = {
  document: { getElementById: function (id) { return els[id] || null; } },
  setTimeout: function (fn) { fn(); },
  go: function (id) { goCalls.push(id); }
};
vm.runInNewContext('var drawerReturnFocus = null;\n' + [grab('drawerEls'), grab('drawerFocusables'), grab('drawerScrollLock'), grab('openDrawer'), grab('closeDrawer'), grab('dwGo'), grab('dwGoTo')].join('\n'), ctx);

ctx.openDrawer();
ok('openDrawer adds .on, un-hides the drawer and expands the burger',
  els.lpDrawer.classes.on === true && els.lpScrim.classes.on === true
  && els.lpDrawer.attrs['aria-hidden'] === 'false' && els.lpBurger.attrs['aria-expanded'] === 'true'
  && els.lpBurger.attrs['aria-label'] === 'Close menu');
ctx.closeDrawer();
ok('closeDrawer reverses the same state',
  !els.lpDrawer.classes.on && !els.lpScrim.classes.on
  && els.lpDrawer.attrs['aria-hidden'] === 'true' && els.lpBurger.attrs['aria-expanded'] === 'false'
  && els.lpBurger.attrs['aria-label'] === 'Open menu');
ok('Escape and Tab are handled while the menu is open',
  /addEventListener\('keydown'/.test(app) && /ev\.key === 'Escape'/.test(app)
  && /ev\.key !== 'Tab'/.test(app) && /drawerFocusables\(\)/.test(app));

drawerTargets.forEach(function (id) {
  scrollCalls.length = 0;
  els.lpDrawer.classes.on = true;
  ctx.dwGoTo(id);
  ok('drawer → ' + id + ' closes the drawer and scrolls to that section',
    !els.lpDrawer.classes.on && scrollCalls.length === 1 && scrollCalls[0].id === id
    && scrollCalls[0].opts && scrollCalls[0].opts.behavior === 'smooth');
});
screenTargets.forEach(function (id) {
  goCalls.length = 0;
  els.lpDrawer.classes.on = true;
  ctx.dwGo(id);
  ok('drawer → ' + id + ' closes the drawer and opens the right screen',
    !els.lpDrawer.classes.on && goCalls.length === 1 && goCalls[0] === id);
});

console.log('\nStage A/B boundaries relied on by this page are still present');
ok('no Open Student tier was reintroduced', !/Open Student|open-student|tier-open/i.test(index));
ok('the unified GOC student architecture is untouched even though its homepage advert is gone',
  !/id="lpTiers"/.test(index) && /no Open Student|open-student|tier-open/i.test(index) === false
  && /id="signup"/.test(index) && /Submit application/.test(index));
ok('the application-first registration screen is still on the page', /id="signup"[\s\S]*?Submit application/.test(index));
ok('the maintenance controls are not touched by this page', !/GOC_MAINTENANCE_MODE|maintenance\.json/.test(index));

console.log('\n' + passed + ' passed, ' + (process.exitCode ? 'FAILURES' : '0 failed'));
