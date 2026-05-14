const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../config/database');
const reservationController = require('../controllers/reservationController');

// ============================================
// CONFIGURATION MULTER
// ============================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'car-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Format non supporte. Utilisez JPG, PNG ou GIF.'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});

// ============================================
// ROUTE DEBUG — affiche les tables et colonnes
// Ouvre : http://localhost:5000/api/reservations/debug
// ============================================
router.get('/debug', async (req, res) => {
    try {
        const [tables] = await db.query('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);

        const result = { tables: tableNames, columns: {} };

        for (const table of tableNames) {
            try {
                const [cols] = await db.query(`DESCRIBE \`${table}\``);
                result.columns[table] = cols.map(c => c.Field);
            } catch (e) {
                result.columns[table] = `ERREUR: ${e.message}`;
            }
        }

        // Test la requête principale
        try {
            const [test] = await db.query(`
                SELECT r.id, r.statut, c.nom AS client_nom
                FROM reservations r
                JOIN clients c ON c.id = r.client_id
                LIMIT 1
            `);
            result.test_query = test.length > 0 ? '✅ OK' : '✅ OK (0 lignes)';
        } catch (e) {
            result.test_query = `❌ ERREUR: ${e.message}`;
        }

        res.json(result);
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ============================================
// ROUTES — ordre important (spécifique avant :id)
// ============================================
router.post('/', upload.array('images', 5), reservationController.createReservation);

router.get('/stats/dashboard', reservationController.getStatistics);
router.get('/check-customer/:phone', reservationController.checkReturningCustomer);

router.get('/', reservationController.getAllReservations);
router.get('/:id/loyalty-discount', reservationController.getLoyaltyDiscountByReservationId);
router.get('/:id', reservationController.getReservationById);
router.put('/:id', reservationController.updateReservation);
router.put('/:id/status', reservationController.updateReservationStatus);
router.put('/:id/price', reservationController.updatePrice);
router.delete('/:id', reservationController.deleteReservation);

module.exports = router;