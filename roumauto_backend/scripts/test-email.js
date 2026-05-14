/**
 * Test SMTP depuis le même chargement .env que server.js.
 * Usage :  npm run test:email
 * Optionnel : TEST_TO=autre@mail.com  pour forcer le destinataire
 */
const path = require('path');
const fs = require('fs');

const envLocal = path.join(__dirname, '..', '.env');
const envRoot = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envLocal)) {
    require('dotenv').config({ path: envLocal });
} else if (fs.existsSync(envRoot)) {
    require('dotenv').config({ path: envRoot });
} else {
    require('dotenv').config();
}

const mailer = require('../utils/mailer');

async function main() {
    const to = String(process.env.TEST_TO || process.env.ADMIN_EMAIL || process.env.EMAIL_USER || '').trim();
    if (!to) {
        console.error('❌ Définissez TEST_TO=... ou ADMIN_EMAIL ou EMAIL_USER dans .env');
        process.exit(1);
    }
    if (!mailer.isMailConfigured()) {
        console.error('❌ EMAIL_USER / EMAIL_PASSWORD manquants dans .env');
        process.exit(1);
    }

    console.log('→ Vérification SMTP (verify)...');
    try {
        await mailer.getTransporter().verify();
        console.log('✅ verify() OK');
    } catch (e) {
        console.error('❌ verify() :', e.message || e);
        process.exit(1);
    }

    console.log('→ Envoi message test à :', to);
    try {
        const info = await mailer.sendMail({
            to,
            subject: 'RY Performance — test SMTP',
            text: 'Si vous lisez ce message, SMTP fonctionne correctement.'
        });
        console.log('✅ Envoyé. messageId=', info.messageId);
        console.log('   Vérifiez aussi le dossier Spam / Courrier indésirable.');
    } catch (e) {
        console.error('❌ sendMail :', e.message || e);
        process.exit(1);
    }
}

main();
