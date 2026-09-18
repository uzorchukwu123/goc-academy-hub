'use strict';

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

function loadEnv() {
  if (fs.existsSync(ENV_PATH)) {
    require('dotenv').config({ path: ENV_PATH });
  }

  return {
    endpoint: (process.env.APPWRITE_ENDPOINT || '').trim(),
    projectId: (process.env.APPWRITE_PROJECT_ID || '').trim(),
    apiKey: (process.env.APPWRITE_API_KEY || '').trim(),
    bucketId: (process.env.APPWRITE_BUCKET_ID || 'goc-data').trim(),
    fileId: (process.env.APPWRITE_FILE_ID || 'academy-data-json').trim(),
  };
}

function hasAppwriteConfig() {
  const config = loadEnv();
  return Boolean(config.endpoint && config.projectId && config.apiKey);
}

async function verifyAppwritePassword(email, password) {
  const config = loadEnv();

  if (!config.endpoint || !config.projectId) {
    throw new Error('Appwrite endpoint/project is not configured.');
  }

  const { Client, Account } = require('node-appwrite');

  // Deliberately no API key here.
  // Password verification uses Appwrite's client-side Account API.
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId);

  const account = new Account(client);

  return account.createEmailPasswordSession(
    String(email),
    String(password)
  );
}

function createAppwriteClient() {
  const config = loadEnv();
  if (!config.endpoint || !config.projectId || !config.apiKey) {
    return null;
  }

  const { Client, Storage, Databases, Users } = require('node-appwrite');
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);

  return {
    client,
    storage: new Storage(client),
    databases: new Databases(client),
    users: new Users(client),
    config,
  };
}

module.exports = {
  ENV_PATH,
  loadEnv,
  hasAppwriteConfig,
  verifyAppwritePassword,
  createAppwriteClient,
};
