/* test-flags-ui.js — Phase 4.A "Ask a tutor", slices 5-7: the screen wiring.
   The behaviour is covered by test-flags.js (rules) and test-flags-route.js
   (student, tutor and console routes + offline driver). This checks that the
   student buttons, the "My questions" entry, the console Question flags panel
   and the tutor dashboard card are wired into the shipped files.
   node test/test-flags-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html'), tutor = read('server/tutor/tutor-app.js'), core = read('js/goc-core.js');
var fails = 0;
function ok(name, cond, extra) { if (cond) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('slice 5 — the student screens');
ok('askTutorButton only renders with a question id', /function askTutorButton\(item\)\{[\s\S]*item\.id == null\) return ''/.test(app) || /askTutorButton\(item\)\s*\{[\s\S]*item\.id == null/.test(app));
ok('the Ask a tutor button is placed on practice feedback', /askTutorButton\(\{ id: d\.id \}\)/.test(app));
ok('the Ask a tutor button is on the practice review rows', /askTutorButton\(\{ id: r\.id \}\)/.test(app));
ok('the Ask a tutor button is on the Mistakes rows', /askTutorButton\(\{ id: m\.id \}\)/.test(app));
ok('atOpen builds a reason select and a note box', /function atOpen\(id\)/.test(app) && app.indexOf('id="atReason"') > -1 && app.indexOf('id="atNote"') > -1);
ok('atSend posts through GOC.api.askTutor', /function atSend\(id\)[\s\S]*GOC\.api\.askTutor\(/.test(app));
ok('My questions lists GOC.api.listMyFlags', /function atMyOpen\(\)[\s\S]*GOC\.api\.listMyFlags\(/.test(app));
ok('the reasons come from core.FLAG_REASONS', /atReasons = \(GOC\.core\.FLAG_REASONS/.test(app));
ok('the Study hub has a My questions tile', /onclick="atMyOpen\(\)"/.test(html) && /My questions/.test(html));

head('slice 7 — the console Question flags panel');
ok('a "flags" section exists in the console selector', /<option value="flags">Question flags<\/option>/.test(html));
ok('admOpen renders and loads the flags panel', app.indexOf("flags: function()") > -1 && /if\(section === 'flags'\) admFlagsLoad\(\)/.test(app));
ok('admFlagsLoad reads GOC.api.listFlags', /function admFlagsLoad\(\)[\s\S]*GOC\.api\.listFlags\(/.test(app));
ok('the console can reply and close', /GOC\.api\.replyFlag\(/.test(app) && /GOC\.api\.closeFlag\(/.test(app));

head('slice 6 — the tutor dashboard card');
ok('a flags card is in the tutor dashboard', /function flagsCard\(\)/.test(tutor) && /flagsCard\(\) \+/.test(tutor));
ok('the tutor loads flags per subject', /function loadFlags\(\)[\s\S]*\/tutor\/flags\?subject=/.test(tutor));
ok('the tutor can reply and close in-scope', /\/tutor\/flags\/'[\s\S]*\/reply/.test(tutor) && /\/tutor\/flags\/'[\s\S]*\/close/.test(tutor));
ok('reply and close are wired to data-act handlers', /a === 'fgreply'/.test(tutor) && /a === 'fgclose'/.test(tutor));

head('the drivers expose the calls on GOC.api');
['askTutor', 'listMyFlags', 'listFlags', 'replyFlag', 'closeFlag'].forEach(function (m) {
  ok('GOC.api.' + m + ' is on the facade', new RegExp('\\n\\s*' + m + ': function').test(read('js/api.js')));
});

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
