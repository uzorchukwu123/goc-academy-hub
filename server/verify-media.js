/* verify-media.js — run this once Appwrite is configured and your resources and
   videos are uploaded:

       node server/verify-media.js

   It reads the same APPWRITE_* settings the server uses (.env or the
   environment) and checks, for every resource and video record, that the file
   the record points at really exists in the Storage bucket and is not empty.
   It changes nothing. Exit code 0 = everything is in place; 1 = something is
   missing (each problem is listed). */
'use strict';
const path = require('path');
const { createAppwriteClient } = require('./lib/appwrite');

const DATABASE_ID = 'goc_academy';
const INLINE = { pdf: 1, jpg: 1, jpeg: 1, png: 1, gif: 1, mp4: 1 };

async function main() {
  const bundle = createAppwriteClient();
  if (!bundle) {
    console.error('Appwrite is not configured: set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY (see DEPLOYMENT.md).');
    process.exit(1);
  }
  const { storage, databases, config } = bundle;
  const { Query } = require('node-appwrite');
  console.log('Bucket: ' + config.bucketId + '   Database: ' + DATABASE_ID + '\n');

  let problems = 0, checked = 0;
  async function check(kind, doc, idKey) {
    const label = kind + ' "' + (doc.title || doc[idKey] || doc.$id) + '"';
    if (!doc.storageFileId) {
      if (kind === 'video' && doc.externalUrl) { console.log('  ok    ' + label + ' — plays from its link'); return; }
      problems++; console.log('  MISSING ' + label + ' — the record has no stored file'); return;
    }
    checked++;
    try {
      const f = await storage.getFile(config.bucketId, doc.storageFileId);
      if (!(Number(f.sizeOriginal) > 0)) { problems++; console.log('  EMPTY   ' + label + ' — the stored file is 0 bytes'); return; }
      const ext = String(doc.fileType || (kind === 'video' ? 'mp4' : '')).toLowerCase();
      const how = INLINE[ext] ? 'opens inside the app' : 'downloads (no in-app viewer for .' + (ext || '?') + ')';
      console.log('  ok    ' + label + ' — ' + Math.round(f.sizeOriginal / 1024) + ' KB, ' + how + (doc.published ? '' : ' [not published yet]'));
    } catch (err) {
      problems++; console.log('  MISSING ' + label + ' — file ' + doc.storageFileId + ' is not in the bucket (' + err.message + ')');
    }
  }

  const res = await databases.listDocuments(DATABASE_ID, 'resources', [Query.limit(5000)]);
  console.log('Resources (' + res.documents.length + ')');
  for (const d of res.documents) await check('resource', d, 'resourceId');
  const vid = await databases.listDocuments(DATABASE_ID, 'videos', [Query.limit(5000)]);
  console.log('\nVideos (' + vid.documents.length + ')');
  for (const d of vid.documents) await check('video', d, 'videoId');

  console.log('\n' + checked + ' stored file(s) checked, ' + problems + ' problem(s).');
  process.exit(problems ? 1 : 0);
}
main().catch(err => { console.error('Could not complete the check: ' + err.message); process.exit(1); });
