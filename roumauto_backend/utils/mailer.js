'use strict';

const dns = require('dns');
const nodemailer = require('nodemailer');

/** Connexion IPv4 uniquement (souvent nécessaire si IPv6 est mal routé — l’envoi « ne part pas » sans erreur claire). */
function lookupIpv4(hostname, options, callback) {
    dns.lookup(hostname, { family: 4, all: false }, callback);
}

/**
 * Mot de passe d'application Gmail souvent copié avec des espaces : "abcd efgh ..."
 */
function normalizeSmtpPassword(pass) {
    if (pass == null) return '';
    return String(pass).replace(/\s+/g, '').trim();
}

function getAuth() {
    const user = String(process.env.EMAIL_USER || '').trim();
    const pass = normalizeSmtpPassword(process.env.EMAIL_PASSWORD);
    if (!user || !pass) return null;
    return { user, pass };
}

/** Options communes : timeouts, pool, debug, IPv4 */
function baseTransportExtras() {
    const debug = String(process.env.SMTP_DEBUG || '').trim() === '1';
    return {
        connectionTimeout: 60_000,
        greetingTimeout: 30_000,
        socketTimeout: 90_000,
        pool: true,
        maxConnections: 1,
        maxMessages: 50,
        lookup: lookupIpv4,
        debug,
        logger: debug ? console : undefined
    };
}

function buildCustomSmtpOptions() {
    const host = String(process.env.EMAIL_HOST || '').trim();
    if (!host) return null;
    const auth = getAuth();
    if (!auth) return null;
    const port = Number(process.env.EMAIL_PORT) || 587;
    const secure =
        String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;
    return {
        ...baseTransportExtras(),
        host,
        port,
        secure,
        auth,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    };
}

/** Gmail — STARTTLS (prioritaire : beaucoup de FAI / antivirus bloquent 465) */
function buildGmail587Options() {
    const auth = getAuth();
    if (!auth) return null;
    return {
        ...baseTransportExtras(),
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: 'smtp.gmail.com' }
    };
}

/** Gmail — SSL sur 465 (second choix) */
function buildGmail465Options() {
    const auth = getAuth();
    if (!auth) return null;
    return {
        ...baseTransportExtras(),
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: 'smtp.gmail.com' }
    };
}

function buildPrimaryTransportOptions() {
    const custom = buildCustomSmtpOptions();
    if (custom) return custom;
    return buildGmail587Options();
}

let transporter = null;
let transporterBuilt = false;

function setTransporterFromOptions(opts) {
    transporter = opts ? nodemailer.createTransport(opts) : null;
    transporterBuilt = true;
}

function getTransporter() {
    if (!transporterBuilt) {
        const opts = buildPrimaryTransportOptions();
        setTransporterFromOptions(opts);
    }
    return transporter;
}

function isMailConfigured() {
    return !!getTransporter();
}

function getMailFrom() {
    const from = String(process.env.EMAIL_FROM || '').trim();
    if (from) return from;
    const user = String(process.env.EMAIL_USER || '').trim();
    return user ? `RY Performance <${user}>` : '';
}

/** Destinataire des alertes admin (demande d'accès, etc.) */
function getAdminNotificationEmail() {
    const admin = String(process.env.ADMIN_EMAIL || '').trim();
    const user = String(process.env.EMAIL_USER || '').trim();
    return admin || user || '';
}

/**
 * @param {import('nodemailer').SendMailOptions} options
 */
async function sendMail(options) {
    const t = getTransporter();
    if (!t) {
        const err = new Error(
            'Email non configuré : définissez EMAIL_USER et EMAIL_PASSWORD (voir roumauto_backend/.env.example).'
        );
        err.code = 'MAIL_NOT_CONFIGURED';
        throw err;
    }
    const from =
        options.from && String(options.from).trim() ? options.from : getMailFrom();
    if (!from) {
        const err = new Error('EMAIL_FROM ou EMAIL_USER requis pour l’en-tête From.');
        err.code = 'MAIL_FROM_MISSING';
        throw err;
    }
    const info = await t.sendMail({ ...options, from });
    console.log('   [SMTP] messageId=', info.messageId, info.response ? String(info.response).slice(0, 120) : '');
    return info;
}

function logStartupMailHint() {
    if (!isMailConfigured()) {
        console.warn(
            '⚠️  Email : EMAIL_USER / EMAIL_PASSWORD absents — aucun envoi (demande d’accès, devis PDF).'
        );
        console.warn(
            '   → Créez roumauto_backend/.env (voir .env.example). Redémarrez le serveur après modification.'
        );
        return;
    }
    const host = String(process.env.EMAIL_HOST || '').trim() || 'smtp.gmail.com';
    console.log(`📧 Email : variables SMTP présentes (${host}) — test connexion en cours...`);
}

/**
 * Au démarrage : vérifie login SMTP. Par défaut Gmail passe en 587 ; si échec, essai 465.
 */
async function verifySmtpOnStartup() {
    if (!getAuth()) return;

    const hasCustomHost = !!String(process.env.EMAIL_HOST || '').trim();
    const t0 = getTransporter();

    try {
        await t0.verify();
        console.log('✅ Email / SMTP : connexion au serveur réussie (login accepté).');
        return;
    } catch (e1) {
        console.error('❌ Email / SMTP (1er essai) :', e1.message || e1);
    }

    if (hasCustomHost) {
        console.error('   Corrigez EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASSWORD dans .env');
        console.error('   Test : npm run test:email');
        return;
    }

    console.warn('   Nouvel essai Gmail : smtp.gmail.com port 465 (SSL)...');
    try {
        const opts465 = buildGmail465Options();
        if (!opts465) return;
        setTransporterFromOptions(opts465);
        await getTransporter().verify();
        console.log('✅ Email / SMTP : OK avec smtp.gmail.com:465 — les envois utiliseront ce port.');
    } catch (e2) {
        console.error('❌ Email / SMTP (2e essai, port 465) :', e2.message || e2);
        console.error('   Gmail : validation en 2 étapes + « mot de passe d’application » (16 caractères)');
        console.error('   https://support.google.com/accounts/answer/185833');
        console.error('   Diagnostic : dans roumauto_backend → npm run test:email');
    }
}

module.exports = {
    getTransporter,
    isMailConfigured,
    getMailFrom,
    getAdminNotificationEmail,
    sendMail,
    logStartupMailHint,
    verifySmtpOnStartup
};
