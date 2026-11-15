/* test-dashboard-command.js — dashboard cleanup contract.

   Part Two removed the retired study features from the student dashboard:
   Next Up, Your subjects, the JAMB/UTME card, Study CBT, My Notes, Daily
   Quest, Weekly Quest, Review Due and Read / Learn. This suite pins the new
   contract: the removed panels never come back, and the legitimate features
   that must stay (Review & Saves, My Question, Recent Practice, Practice,
   Web Test, Results, Resources) are still present and wired.

   Run:  node test/test-dashboard-command.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

head('retired dashboard panels are gone');
ok('Next Up is not in the dashboard HTML', !/id="dashUp"/.test(index) && !/>Next Up</.test(index));
ok('Your subjects is not in the dashboard HTML', !/id="dashSubjects"/.test(index) && !/>Your subjects</.test(index));
ok('the JAMB / UTME dashboard card is gone', !/id="dashJamb"/.test(index) && !/>JAMB \/ UTME</.test(index));
ok('the dashboard jump grid no longer offers Study CBT or My Notes',
  !/onclick="openCBT\(\)"/.test(index) && !/onclick="openMyNotes\(\)"/.test(index)
  && !/<b>Study CBT<\/b>/.test(index) && !/<b>My Notes<\/b>/.test(index));
ok('no dashboard code paints the removed panels',
  !/dashPaintUp\(\);/.test(app) && !/dashPaintSubjects\(\);/.test(app) && !/dashPaintJamb\(rows\);/.test(app));

head('the Study hub no longer offers the retired tools');
ok('Daily quest card is gone', !/id="questCard"/.test(index) && !/>Daily quest</.test(index));
ok('Weekly quest card is gone', !/id="weekCard"/.test(index) && !/>Weekly quest/.test(index));
ok('Review Due card is gone', !/id="rvCard"/.test(index) && !/<div class="eyebrow">Review due<\/div>/.test(index));
ok('Read / Learn, JAMB CBT and My Notes tiles are gone',
  !/id="sg-reading"/.test(index) && !/id="sg-jamb"/.test(index) && !/id="sg-mynotes"/.test(index));
ok('the Study hub no longer fetches the retired quest/review cards',
  !/refreshQuest\(\);/.test(app) && !/refreshWeekly\(\);/.test(app) && !/refreshReview\(\);/.test(app));

head('the legitimate student features are preserved');
ok('Review & saves is still on the Study hub', /Review &amp; saves/.test(index)
  && /id="sg-bookmarks"/.test(index) && /id="sg-mistakes"/.test(index) && /id="sg-review"/.test(index)
  && /onclick="atMyOpen\(\)"/.test(index));
ok('Recent practice is still on the Study hub', />Recent practice</.test(index) && /id="pracHist"/.test(index));
ok('Practice, Web Test, Results and Resources remain', /id="sg-practice"/.test(index)
  && /id="sg-webtest"/.test(index) && /id="sg-results"/.test(index) && /id="sg-resources"/.test(index));
ok('the live dashboard cards remain', /id="dashNext"/.test(index) && /id="dashStand"/.test(index) && /id="dashLast"/.test(index));
ok('renderDash paints the surviving cards only',
  /dashPaintNext\(\);\s*\n\s*dashPaintStanding\(\);\s*\n\s*dashPaintLast\(\);\s*\n\s*dashPaintBroadcasts\(\);\s*\n\s*dashPaintNotices\(\);/.test(app));
ok('the formal CBT engine and screens are untouched', /function cbtOpenStudy\(/.test(app) && /id="cbt"/.test(index)
  && /function submitCBT\(/.test(app));

head('Classes no longer offers recorded live classes');
ok('the recorded-live section is gone from the Classes screen', !/Recorded live classes/.test(index)
  && !/id="liveList"/.test(index) && !/id="liveEmpty"/.test(index));
ok('lesson videos still render', /id="lessonList"/.test(index) && /function loadPublishedVideos\(/.test(app)
  && /function renderClasses\(/.test(app));

head('the tutorial no longer points at removed elements');
var onboarding = fs.readFileSync(path.join(APP, 'js', 'onboarding.js'), 'utf8');
var studentBlock = onboarding.slice(onboarding.indexOf('var STUDENT_STEPS = ['), onboarding.indexOf('/* ---- Management Console tour'));
ok('no student step targets a removed element',
  !/dashUp|dashJamb|dashSubjects|sg-reading|sg-jamb|sg-mynotes|rvCard|questCard|weekCard|dashJamb/.test(studentBlock));
ok('no student step opens Study CBT or My Notes',
  !/openCBT|openMyNotes/.test(studentBlock));
ok('every student step target exists in index.html', (function () {
  var m = studentBlock.match(/target: '([^']+)'/g) || [];
  var missing = m.map(function (s) { return s.replace(/^target: '|'$/g, ''); })
    .filter(function (id) { return index.indexOf('id="' + id + '"') < 0; });
  return missing.length === 0;
})());

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'dashboard command: all checks passed'));
process.exit(fails ? 1 : 0);
