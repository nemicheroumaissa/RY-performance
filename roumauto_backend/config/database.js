const mysql = require('mysql2');
require('dotenv').config();

// Créer le pool de connexions
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Utiliser les promesses au lieu des callbacks
const promisePool = pool.promise();

// Test de connexion
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Erreur de connexion MySQL:', err.message);
        return;
    }
    console.log('✅ Connexion MySQL établie avec succès!');
    connection.release();
});

module.exports = promisePool;