/**
 * Vide les tables clients, reservations et les donnees liees (messages, conversations,
 * images, reservation_services). Les compteurs AUTO_INCREMENT repartent a 1.
 *
 * Usage (depuis le dossier du backend, ex. ry-performance-backend) :
 *   node scripts/resetClientsAndReservations.js
 *
 * Requiert .env avec DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    multipleStatements: true,
  });

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  // Ordre: enfants d'abord si pas de TRUNCATE avec FK
  await conn.query('TRUNCATE TABLE messages');
  await conn.query('TRUNCATE TABLE conversations');
  await conn.query('TRUNCATE TABLE images');
  await conn.query('TRUNCATE TABLE reservation_services');
  await conn.query('TRUNCATE TABLE reservations');
  await conn.query('TRUNCATE TABLE clients');
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  await conn.end();
  console.log('OK: clients + reservations (et tables liees) vides, IDs repartent a 1.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
