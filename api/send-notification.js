const admin = require('firebase-admin');

// Fonction pour initialiser Firebase Admin SDK en toute sécurité
function initializeFirebaseAdmin() {
    try {
        if (admin.apps.length) {
            return admin.app();
        }
        const serviceAccountJSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (!serviceAccountJSON) {
            throw new Error('Variable d\'environnement GOOGLE_SERVICE_ACCOUNT_JSON non définie.');
        }
        const serviceAccount = JSON.parse(serviceAccountJSON);
        return admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error('CRITIQUE: Échec de l\'initialisation du SDK Firebase Admin:', e);
        return null;
    }
}

const adminApp = initializeFirebaseAdmin();

// La fonction serverless principale
module.exports = async (req, res) => {
    // Log d'entrée - C'est le log le plus important à vérifier
    console.log(`Requête reçue: ${req.method}`);

    // Définir manuellement les en-têtes CORS pour chaque requête
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Gérer la requête preflight OPTIONS
    if (req.method === 'OPTIONS') {
        console.log('Réponse à la requête preflight OPTIONS.');
        return res.status(204).send('');
    }

    // Vérifier si Firebase est initialisé
    if (!adminApp) {
        console.error('Le SDK Firebase Admin n\'est pas initialisé.');
        return res.status(500).json({ success: false, message: 'Erreur de configuration du serveur.' });
    }

    // N'autoriser que les requêtes POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Méthode non autorisée' });
    }

    // Parser le corps de la requête manuellement
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
        try {
            console.log('Corps de la requête reçu:', body);
            const { appName, title, body: notificationBody, recipient } = JSON.parse(body);

            if (!title || !notificationBody || !recipient) {
                return res.status(400).json({ success: false, message: 'Paramètres manquants.' });
            }

            const db = adminApp.firestore();
            let deviceTokens = [];

            if (recipient === 'Tout le monde') {
                const usersSnapshot = await db.collection('users').get();
                usersSnapshot.forEach(doc => {
                    const userData = doc.data();
                    if (userData.deviceToken) deviceTokens.push(userData.deviceToken);
                });
            } else {
                const snapshot = await db.collection('users').where('email', '==', recipient).limit(1).get();
                if (!snapshot.empty) {
                    const userData = snapshot.docs[0].data();
                    if (userData.deviceToken) deviceTokens.push(userData.deviceToken);
                }
            }

            if (deviceTokens.length === 0) {
                return res.status(404).json({ success: false, message: 'Aucun deviceToken trouvé.' });
            }

            const message = {
                notification: { title: `${appName} - ${title}`, body: notificationBody },
                tokens: deviceTokens,
            };

            await admin.messaging().sendEachForMulticast(message);
            return res.status(200).json({ success: true, message: 'Notification envoyée avec succès.' });

        } catch (error) {
            console.error('Erreur lors du traitement de la requête:', error);
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }
    });
};