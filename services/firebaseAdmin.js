const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function resolveServiceAccountPath(inputPath) {
  if (!inputPath) return null;
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

function readServiceAccountFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  };
}

function readServiceAccountFromFile() {
  const serviceAccountPath = resolveServiceAccountPath(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  );

  if (!serviceAccountPath) {
    return null;
  }

  if (!fs.existsSync(serviceAccountPath)) {
    console.warn(
      `Firebase Admin service account file was not found at ${serviceAccountPath}`
    );
    return null;
  }

  const rawFile = fs.readFileSync(serviceAccountPath, 'utf8');
  return JSON.parse(rawFile);
}

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  try {
    const serviceAccount = readServiceAccountFromEnv() || readServiceAccountFromFile();

    if (!serviceAccount) {
      console.warn(
        'Firebase Admin is disabled: provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT_PATH'
      );
      return null;
    }

    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  } catch (error) {
    console.warn(`Firebase Admin failed to initialize: ${error.message}`);
    return null;
  }
}

function getMessaging() {
  const app = initializeFirebaseAdmin();
  return app ? admin.messaging(app) : null;
}

function getAuth() {
  const app = initializeFirebaseAdmin();
  return app ? admin.auth(app) : null;
}

module.exports = {
  initializeFirebaseAdmin,
  getAuth,
  getMessaging,
};
