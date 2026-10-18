/* test-console-menu.js — roles slice (d): the console menu shows only the sections a role may use.
   node test/test-console-menu.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}

console.log('\nthe rule');
var menuKeys = [];
html.replace(/<option value="([a-z]+)">/g, function (m, k) { menuKeys.push(k); return m; });
var selStart = html.indexOf('id="admSelect"');
var selEnd = html.indexOf('</select>', selStart);
menuKeys = [];
html.slice(selStart, selEnd).replace(/<option value="([a-z]+)">/g, function (m, k) { menuKeys.push(k); return m; });
ok('the page offers 25 sections', menuKeys.length === 25, menuKeys.length);
ok('every section on the page is in the rule', menuKeys.every(function (k) { return core.allConsoleSections().indexOf(k) > -1; }));
ok('every section in the rule is on the page', core.allConsoleSections().every(function (k) { return menuKeys.indexOf(k) > -1; }));
ok('the Founder sees every section', core.consoleSectionsFor('GOC-A-009', 'founder').length === 25);
ok('GOC-A-001 sees every section', core.consoleSectionsFor('GOC-A-001', 'founder').length === 25);
ok('GOC-A-002 keeps full access', core.consoleSectionsFor('GOC-A-002', 'academic-director').length === 25);
var fin = core.consoleSectionsFor('GOC-A-003', 'finance');
ok('Finance sees Overview and Students only', fin.join() === 'overview,students', fin.join());
var pub = core.consoleSectionsFor('GOC-A-004', 'publicity');
ok('Publicity sees homepage and broadcast but not questions', pub.indexOf('homepage') > -1 && pub.indexOf('broadcast') > -1 && pub.indexOf('questions') < 0, pub.join());
var ad = core.consoleSectionsFor('GOC-A-005', 'academic-director');
ok('a later Academic Director sees questions, not tutors or managers', ad.indexOf('questions') > -1 && ad.indexOf('tutors') < 0 && ad.indexOf('managers') < 0 && ad.indexOf('access') < 0, ad.join());
var sa = core.consoleSectionsFor('GOC-A-006', 'student-affairs');
ok('Student Affairs sees cohorts and results, not questions', sa.indexOf('cohorts') > -1 && sa.indexOf('results') > -1 && sa.indexOf('questions') < 0, sa.join());
ok('only the Founder sees Managers, Tutors and Access', ['academic-director', 'finance', 'publicity', 'student-affairs'].every(function (r) {
  var l = core.consoleSectionsFor('GOC-A-010', r);
  return l.indexOf('managers') < 0 && l.indexOf('tutors') < 0 && l.indexOf('access') < 0;
}));
ok('a missing role sees nothing', core.consoleSectionsFor('GOC-A-011', null).length === 0);
ok('a mistyped role sees nothing', core.consoleSectionsFor('GOC-A-011', 'boss').length === 0);
ok('an unknown section is refused, even for the Founder', core.consoleSectionAllowed('secret', 'GOC-A-001', 'founder') === false);
ok('an unknown section is refused for a seeded account', core.consoleSectionAllowed('secret', 'GOC-A-002', 'academic-director') === false);
ok('every section in the rule names real capabilities', (function () {
  var all = core.allCapabilities ? core.allCapabilities() : null;
  var src = fs.readFileSync(path.join(APP, 'js', 'goc-core.js'), 'utf8');
  var m = src.match(/var CONSOLE_SECTIONS = \{([\s\S]*?)\n  \};/)[1];
  var caps = m.match(/'[a-z]+\.[a-z]+'/g).map(function (c) { return c.slice(1, -1); });
  var known = core.capabilitiesOf('founder');
  return caps.length > 0 && caps.every(function (c) { return known.indexOf(c) > -1; });
})());

console.log('\nthe page');
var els = { admSelect: { value: 'overview', innerHTML: html.slice(html.indexOf('>', selStart) + 1, selEnd) }, admPanel: { innerHTML: '' } };
var toasts = [];
var sandbox = {
  GOC: { core: core }, state: { limit: 0 }, toasts: toasts,
  document: { getElementById: function (id) { return els[id] || null; } },
  toast: function (m) { toasts.push(m); }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext("var admMe = { id: '', roleKey: null }; var admMenuHTML = null;\n" + grab('admMenuApply'), sandbox);
function menuNow() { var out = []; els.admSelect.innerHTML.replace(/<option value="([a-z]+)">/g, function (m, k) { out.push(k); return m; }); return out; }
sandbox.admMe.id = 'GOC-A-003'; sandbox.admMe.roleKey = 'finance';
vm.runInContext('admMenuApply()', sandbox);
ok('Finance’s drop-down holds two entries', menuNow().join() === 'overview,students', menuNow().join());
ok('the option text survives', /<option value="students">Students<\/option>/.test(els.admSelect.innerHTML));
sandbox.admMe.id = 'GOC-A-001'; sandbox.admMe.roleKey = 'founder';
vm.runInContext('admMenuApply()', sandbox);
ok('the next sign-in as the Founder gets the full list back', menuNow().length === 25, menuNow().length);
sandbox.admMe.id = ''; sandbox.admMe.roleKey = null;
vm.runInContext('admMenuApply()', sandbox);
ok('with nobody recorded the full list shows (the server still guards every route)', menuNow().length === 25, menuNow().length);
sandbox.admMe.id = 'GOC-A-004'; sandbox.admMe.roleKey = 'publicity';
vm.runInContext('admMenuApply()', sandbox);
ok('then a Publicity manager gets theirs', menuNow().indexOf('broadcast') > -1 && menuNow().indexOf('questions') < 0, menuNow().join());

console.log('\nthe wiring');
var open = grab('admOpen');
ok('admOpen refuses a section outside the role and falls back to Overview', /admMe\.id && !GOC\.core\.consoleSectionAllowed\(section, admMe\.id, admMe\.roleKey\)/.test(open) && /section = 'overview'/.test(open));
ok('it says so when a section was refused', /That section is not part of your role/.test(open));
ok('the menu is filtered each time the console opens', /if\(id === 'admin' && typeof admMenuApply === 'function'\) admMenuApply\(\);\n  if\(id === 'admin'\)\{ admOpen\('overview'\);/.test(app));
ok('applyIdentity records the signed-in manager’s ID and role key', /admMe = isStaff \? \{ id: String\(user\.id\)\.toUpperCase\(\), roleKey: user\.roleKey \|\| null \}/.test(app));

if (fails) { console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\npassed');
