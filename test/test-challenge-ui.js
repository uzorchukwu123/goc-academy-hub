/* test-challenge-ui.js — Phase 4.C team challenges, slices 6-7: the screen wiring.
   Behaviour is covered by test-challenge.js (rules) and test-challenge-route.js (routes).
   node test/test-challenge-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), html = read('index.html'), api = read('js/api.js');
var fails = 0;
function ok(name, cond, extra) { if (cond) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('slice 6 — the student Team challenge card');
ok('the Study hub has a team-challenge card', html.indexOf('id="chalCard"') > -1 && html.indexOf('id="chalBar"') > -1);
ok('paintChallenge fills it from GET /api/me/challenge', /function paintChallenge\(r\)/.test(app) && /function refreshChallenge\(\)[\s\S]*GOC\.api\.getChallenge\(/.test(app));
ok('the hub refreshes the challenge on open', /id === 'study' && typeof refreshChallenge === 'function'\) refreshChallenge\(\)/.test(app));

head('slice 7 — the console Team challenges panel');
ok('a "challenges" section exists in the console selector', /<option value="challenges">Team challenges<\/option>/.test(html));
ok('admOpen renders and loads the challenges panel', app.indexOf('challenges: function()') > -1 && /if\(section === 'challenges'\)/.test(app));
ok('the console creates, lists and closes challenges', /GOC\.api\.createChallenge\(/.test(app) && /GOC\.api\.listChallenges\(/.test(app) && /GOC\.api\.setChallengeActive\(/.test(app));

head('the drivers expose the calls on GOC.api');
['getChallenge', 'createChallenge', 'listChallenges', 'setChallengeActive'].forEach(function (m) {
  ok('GOC.api.' + m + ' is on the facade', new RegExp('\\n\\s*' + m + ': function').test(api));
});

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
