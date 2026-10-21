/* run.js — runs every suite in this folder and reports once.
   node test/run.js   (no dependencies, no build step) */
'use strict';
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var suites = ['test-rules.js', 'test-p1.js', 'test-p2.js', 'test-p6.js', 'test-p3.js', 'test-p4.js', 'test-p78.js',
              'test-p9.js', 'test-p10.js', 'test-study.js', 'test-study-window.js', 'test-math.js', 'test-launch.js',
              'test-server.js', 'test-persist.js', 'test-security.js', 'test-signup-limits.js', 'test-driver-parity.js', 'test-contact.js',
              'test-landing-motion.js', 'test-landing-motion-3.js', 'test-migrate-appwrite.js', 'test-media-stub.js',
              'test-practice.js', 'test-bookmarks.js', 'test-mistakes.js', 'test-mistakes-route.js', 'test-streak-freeze.js', 'test-streak-freeze-route.js', 'test-streak-freeze-buy.js', 'test-streak-freeze-demo.js', 'test-streak-freeze-ui.js', 'test-daily-quest.js', 'test-quest-route.js', 'test-quest-demo.js', 'test-quest-ui.js', 'test-quest-reward.js', 'test-quest-reward-demo.js', 'test-quest-result.js',
              'test-weekly-quest.js', 'test-quest-weekly-route.js', 'test-quest-weekly-reward.js', 'test-quest-weekly-demo.js', 'test-quest-weekly-ui.js',
              'test-spaced.js', 'test-spaced-route.js', 'test-spaced-demo.js', 'test-spaced-ui.js',
              'test-reminders.js', 'test-reminders-route.js', 'test-reminders-demo.js', 'test-reminders-ui.js',
              'test-jamb-ready.js', 'test-jamb-ready-route.js', 'test-jamb-ready-demo.js', 'test-jamb-ready-ui.js',
              'test-sit-rules.js', 'test-sit-rules-route.js', 'test-sit-rules-ui.js', 'test-sit-rules-demo.js', 'test-jamb-fresh.js', 'test-jamb-score.js', 'test-past-years.js', 'test-passages.js', 'test-passages-driver.js', 'test-passage-run.js', 'test-passage-ui.js', 'test-passages-ui.js', 'test-passage-picker.js', 'test-passage-review.js', 'test-question-images.js', 'test-question-images-route.js', 'test-question-images-driver.js', 'test-question-images-ui.js', 'test-image-review.js', 'test-image-form.js', 'test-crawler-shield.js', 'test-crawler-refusal.js', 'test-build.js', 'test-deploy.js', 'test-tiers.js', 'test-tiers-route.js', 'test-tiers-appwrite.js', 'test-tiers-today.js', 'test-tiers-bookmarks.js', 'test-tiers-notes.js', 'test-tiers-past.js', 'test-tiers-history.js', 'test-tiers-reviews.js', 'test-tiers-open.js', 'test-tiers-webtest.js', 'test-tiers-webtest-ui.js', 'test-tiers-profile-ui.js', 'test-resource-download.js', 'test-tiers-videos.js', 'test-tiers-classes.js', 'test-tiers-demo.js', 'test-tiers-switch.js', 'test-tiers-switch-ui.js', 'test-tiers-switch-appwrite.js', 'test-tiers-signup.js', 'test-tiers-cohort.js', 'test-tiers-filter-ui.js', 'test-tutors.js', 'test-tutors-route.js', 'test-tutors-ui.js', 'test-tutors-door.js', 'test-tutors-shell.js', 'test-tutors-snapshot.js', 'test-tutors-stats.js', 'test-tutors-activity.js', 'test-tutors-atrisk.js', 'test-tutors-atrisk-route.js', 'test-tutors-atrisk-ui.js', 'test-tutors-top.js', 'test-tutors-top-route.js', 'test-tutors-student.js', 'test-tutors-student-route.js', 'test-tutors-student-ui.js', 'test-tutors-audit-screen.js', 'test-results-export.js', 'test-auth-scroll.js', 'test-tutors-analytics.js', 'test-tutor-approval.js', 'test-tutor-questions.js', 'test-tutor-questions-ui.js', 'test-approvals-edit.js', 'test-approvals-ui.js', 'test-tutor-notes-rules.js', 'test-tutor-notes.js', 'test-tutor-notes-ui.js', 'test-tutor-marking-rules.js', 'test-tutor-marking.js', 'test-tutor-marking-ui.js', 'test-alerts-ui.js', 'test-notices-rules.js', 'test-notices.js', 'test-notices-tutor-ui.js', 'test-notices-ui.js', 'test-broadcast-rules.js', 'test-broadcast-route.js', 'test-broadcast-driver.js', 'test-broadcast-ui.js', 'test-broadcast-card.js', 'test-broadcast-mail.js', 'test-broadcast-mail-route.js', 'test-import-answers.js', 'test-import-preview.js', 'test-import-replace.js', 'test-import-check.js', 'test-flags.js', 'test-approval.js', 'test-resit-rounds.js', 'test-flags-route.js', 'test-flags-ui.js', 'test-challenge.js', 'test-challenge-route.js', 'test-challenge-ui.js', 'test-challenge-result.js', 'test-tutor-kit.js', 'test-note-reader.js', 'test-roles.js', 'test-roles-session.js', 'test-roles-cap.js', 'test-managers-rules.js', 'test-managers-route.js', 'test-manager-signin.js', 'test-manager-password.js', 'test-manager-admin.js', 'test-alert-owners.js', 'test-manager-log.js', 'test-managers-ui.js', 'test-managers-log-ui.js', 'test-manager-change-ui.js', 'test-console-menu.js', 'test-overview-scope.js', 'test-assignments.js', 'test-scholarship.js', 'test-scholarship-route.js'];
var failed = [];

suites.forEach(function (s) {
  console.log('\n════ ' + s + ' ' + new Array(Math.max(2, 60 - s.length)).join('═'));
  var r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
});

console.log('\n════ summary ' + new Array(48).join('═'));
suites.forEach(function (s) {
  console.log((failed.indexOf(s) > -1 ? '  FAILED  ' : '  passed  ') + s);
});
process.exit(failed.length ? 1 : 0);
