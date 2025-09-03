'''
const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Note : Les informations de serviceAccountKey seront stockées dans les variables d'environnement de Vercel
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

app.post('/api/send-notification', async (req, res) => {
    const { appName, title, body, recipient } = req.body;

    if (!title || !body || !recipient) {
        return res.status(400).send('Missing parameters: title, body, or recipient are required.');
    }

    try {
        let deviceTokens = [];

        if (recipient === 'Tout le monde') {
            // Envoyer à tous les utilisateurs
            const usersSnapshot = await db.collection('users').get();
            usersSnapshot.forEach(doc => {
                const userData = doc.data();
                if (userData.deviceToken) {
                    deviceTokens.push(userData.deviceToken);
                }
            });
        } else {
            // Envoyer à une institution spécifique par email
            const usersRef = db.collection('users');
            const snapshot = await usersRef.where('email', '==', recipient).limit(1).get();
            if (snapshot.empty) {
                return res.status(404).send('Recipient not found.');
            }
            snapshot.forEach(doc => {
                const userData = doc.data();
                if (userData.deviceToken) {
                    deviceTokens.push(userData.deviceToken);
                }
            });
        }

        if (deviceTokens.length === 0) {
            return res.status(404).send('No device tokens found for the specified recipient(s).');
        }

        const message = {
            notification: {
                title: `${appName} - ${title}`,
                body: body,
            },
            tokens: deviceTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log('Successfully sent message:', response);
        
        // Nettoyer les tokens invalides
        await cleanupInvalidTokens(response.responses, deviceTokens);

        res.status(200).send({ success: true, message: 'Notifications sent successfully!', response });

    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).send('Error sending notification.');
    }
});

async function cleanupInvalidTokens(responses, tokens) {
    const invalidTokens = [];
    responses.forEach((response, index) => {
        if (!response.success) {
            const errorCode = response.error.code;
            if (errorCode === 'messaging/invalid-registration-token' ||
                errorCode === 'messaging/registration-token-not-registered') {
                invalidTokens.push(tokens[index]);
            }
        }
    });

    if (invalidTokens.length > 0) {
        console.log('List of invalid tokens to remove: ', invalidTokens);
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('deviceToken', 'in', invalidTokens).get();
        
        const batch = db.batch();
        snapshot.forEach(doc => {
            console.log(`Removing token from user ${doc.id}`);
            batch.update(doc.ref, { deviceToken: admin.firestore.FieldValue.delete() });
        });
        await batch.commit();
    }
}


// Exporter l'application pour Vercel
module.exports = app;
''