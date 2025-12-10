const admin = require('firebase-admin');
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_KEY_BASE64, 'base64').toString('utf8')
);

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin SDK initialized.');
} catch (error) {
    if (!/already exists/u.test(error.message)) {
        console.error('Firebase admin initialization error:', error.stack);
    }
}

module.exports = admin;