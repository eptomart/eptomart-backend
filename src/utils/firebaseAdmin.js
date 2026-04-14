// ============================================
// FIREBASE ADMIN — Server-side SDK
// Used to verify Firebase Phone Auth tokens
// ============================================
const admin = require('firebase-admin');

let initialized = false;

const getFirebaseAdmin = () => {
  if (!initialized) {
    try {
      // Service account from environment variable (JSON string)
      const serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}'
      );

      if (!serviceAccount.project_id) {
        console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON not set — phone auth disabled');
        return null;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      initialized = true;
      console.log('[Firebase] Admin SDK initialized ✓');
    } catch (err) {
      console.error('[Firebase] Failed to initialize Admin SDK:', err.message);
      return null;
    }
  }
  return admin;
};

module.exports = getFirebaseAdmin;
