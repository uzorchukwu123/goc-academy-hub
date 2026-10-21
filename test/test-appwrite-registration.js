require('dotenv').config();

const { Client, Databases, Query } = require('node-appwrite');

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new Databases(client);

const DATABASE_ID = 'goc_academy';
const COLLECTION_ID = 'students';

(async () => {
  console.log('\n🧪 Testing Appwrite student registration...\n');

  // Check that we start clean.
  let result = await db.listDocuments(
    DATABASE_ID,
    COLLECTION_ID,
    [Query.limit(100)]
  );

  console.log('Starting Appwrite students:', result.documents.length);

  if (result.documents.length !== 0) {
    throw new Error(
      'Safety stop: Appwrite students collection is not empty.'
    );
  }

  console.log('✅ Starting database is clean.');

  console.log('\nNow register one temporary student through the app.');
  console.log('This test will be completed in the next step.');
})();
