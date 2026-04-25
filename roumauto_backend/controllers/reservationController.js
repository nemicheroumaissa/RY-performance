const db = require('../config/database');
const nodemailer = require('nodemailer');
const { buildQuotePdfBuffer } = require('../utils/quotePdf');

let delaiRemiseColumnEnsured = false;

async function ensureDelaiRemiseColumn() {
    if (delaiRemiseColumnEnsured) return;
    try {
        await db.query('ALTER TABLE reservations ADD COLUMN delai_remise VARCHAR(255) NULL DEFAULT NULL');
    } catch (e) {
        if (e.errno !== 1060) console.warn('ensureDelaiRemiseColumn:', e.message);
    }
    delaiRemiseColumnEnsured = true;
}

// ============================================
// CRÉER UNE NOUVELLE RÉSERVATION
// ============================================
exports.createReservation = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { name, phone, email, model, year, message, services, basePrice, discount, finalPrice } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Nom et téléphone sont obligatoires' });
        }

        let servicesList = [];
        if (services) servicesList = typeof services === 'string' ? JSON.parse(services) : services;

        const [existingClients] = await connection.query('SELECT id FROM clients WHERE telephone = ?', [phone]);
        let clientId;
        if (existingClients.length > 0) {
            clientId = existingClients[0].id;
            await connection.query('UPDATE clients SET nom = ?, email = ? WHERE id = ?', [name, email || null, clientId]);
        } else {
            const [clientResult] = await connection.query(
                'INSERT INTO clients (nom, telephone, email) VALUES (?, ?, ?)',
                [name, phone, email || null]
            );
            clientId = clientResult.insertId;
        }

        const [reservationResult] = await connection.query(
            `INSERT INTO reservations (order_id, client_id, modele_vehicule, annee_vehicule, message_client, prix_base, remise, prix_final, statut)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Nouveau')`,
            ['TMP', clientId, model || '', year || '', message || null, basePrice || 0, discount || 0, finalPrice || basePrice || 0]
        );
        const reservationId = reservationResult.insertId;
        await connection.query('UPDATE reservations SET order_id = ? WHERE id = ?', [String(reservationId), reservationId]);

        for (const service of servicesList) {
            const serviceCode = service.value || service.code || '';
            const servicePrice = service.price || 0;
            const [serviceRows] = await connection.query('SELECT id FROM services WHERE code = ?', [serviceCode]);
            if (serviceRows.length > 0) {
                await connection.query(
                    'INSERT INTO reservation_services (reservation_id, service_id, prix_applique) VALUES (?, ?, ?)',
                    [reservationId, serviceRows[0].id, servicePrice]
                );
            } else {
                const [serviceByName] = await connection.query(
                    'SELECT id FROM services WHERE nom = ? OR nom_service = ?', [service.name, service.name]
                );
                if (serviceByName.length > 0) {
                    await connection.query(
                        'INSERT INTO reservation_services (reservation_id, service_id, prix_applique) VALUES (?, ?, ?)',
                        [reservationId, serviceByName[0].id, servicePrice]
                    );
                }
            }
        }

        await connection.commit();
        if (global.io) global.io.emit('new_reservation', { id: reservationId });
        res.status(201).json({
            success: true,
            message: 'Réservation enregistrée !',
            data: { reservationId, orderId: String(reservationId) }
        });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur création réservation:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};

// ============================================
// RÉCUPÉRER TOUTES LES RÉSERVATIONS
// ============================================
exports.getAllReservations = async (req, res) => {
    try {
        const [reservations] = await db.query(`
            SELECT
                r.id,
                r.order_id,
                r.statut,
                r.prix_base,
                r.remise,
                r.prix_final,
                r.message_client,
                r.modele_vehicule,
                r.annee_vehicule,
                r.date_reservation,
                c.id          AS client_id,
                c.nom         AS client_nom,
                c.telephone   AS client_telephone,
                c.email       AS client_email
            FROM reservations r
            INNER JOIN clients c ON c.id = r.client_id
            ORDER BY
                CASE r.statut
                    WHEN 'Nouveau'  THEN 1
                    WHEN 'En cours' THEN 2
                    WHEN 'Terminé'  THEN 3
                    ELSE 4
                END,
                r.date_reservation DESC
        `);

        // delai_remise (colonne optionnelle)
        let delaiMap = {};
        try {
            const [delaiRows] = await db.query('SELECT id, delai_remise FROM reservations');
            delaiRows.forEach(r => { delaiMap[r.id] = r.delai_remise || ''; });
        } catch (e) { /* colonne pas encore créée */ }

        // services groupés
        let servicesMap = {};
        try {
            const [servicesRows] = await db.query(`
                SELECT rs.reservation_id,
                    GROUP_CONCAT(
                        COALESCE(NULLIF(TRIM(s.nom_service),''), NULLIF(TRIM(s.nom),''), s.code, 'Service')
                        ORDER BY s.id SEPARATOR ', '
                    ) AS services_liste
                FROM reservation_services rs
                LEFT JOIN services s ON s.id = rs.service_id
                GROUP BY rs.reservation_id
            `);
            servicesRows.forEach(r => { servicesMap[r.reservation_id] = r.services_liste || ''; });
        } catch (e) { console.warn('⚠️ Erreur services:', e.message); }

        // fidélité calculée par téléphone
        const phoneCounts = {};
        reservations.forEach(r => {
            const p = String(r.client_telephone || '').trim();
            if (p) phoneCounts[p] = (phoneCounts[p] || 0) + 1;
        });

        const data = reservations.map(r => ({
            ...r,
            delai_remise:       delaiMap[r.id] || '',
            services_liste_agg: servicesMap[r.id] || '',
            nombre_images:      0,
            est_client_fidele:  (phoneCounts[String(r.client_telephone || '').trim()] || 0) >= 2 ? 1 : 0
        }));

        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('❌ Erreur getAllReservations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// RÉCUPÉRER UNE RÉSERVATION PAR ID
// ============================================
exports.getReservationById = async (req, res) => {
    try {
        const { id } = req.params;
        const [reservations] = await db.query(`
            SELECT
                r.id, r.order_id, r.statut, r.prix_base, r.remise, r.prix_final,
                r.message_client, r.modele_vehicule, r.annee_vehicule, r.date_reservation,
                c.id AS client_id, c.nom AS client_nom,
                c.telephone AS client_telephone, c.email AS client_email
            FROM reservations r
            INNER JOIN clients c ON c.id = r.client_id
            WHERE r.id = ?
        `, [id]);

        if (reservations.length === 0) {
            return res.status(404).json({ success: false, message: 'Réservation non trouvée' });
        }

        let delai_remise = '';
        try {
            const [dr] = await db.query('SELECT delai_remise FROM reservations WHERE id = ?', [id]);
            delai_remise = dr[0]?.delai_remise || '';
        } catch (e) {}

        let services_noms = '';
        try {
            const [svc] = await db.query(`
                SELECT GROUP_CONCAT(
                    COALESCE(NULLIF(TRIM(s.nom_service),''), NULLIF(TRIM(s.nom),''), s.code, 'Service')
                    ORDER BY s.id SEPARATOR ', '
                ) AS noms
                FROM reservation_services rs
                LEFT JOIN services s ON s.id = rs.service_id
                WHERE rs.reservation_id = ?
            `, [id]);
            services_noms = svc[0]?.noms || '';
        } catch (e) {}

        res.status(200).json({
            success: true,
            data: { ...reservations[0], delai_remise, services_noms, images: [] }
        });
    } catch (error) {
        console.error('❌ Erreur getReservationById:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// VÉRIFIER CLIENT FIDÈLE
// ============================================
exports.checkReturningCustomer = async (req, res) => {
    try {
        const { phone } = req.params;
        const [clients] = await db.query('SELECT id FROM clients WHERE telephone = ?', [phone]);
        let reservationCount = 0;
        if (clients.length > 0) {
            const [countRows] = await db.query('SELECT COUNT(*) AS total FROM reservations WHERE client_id = ?', [clients[0].id]);
            reservationCount = countRows[0]?.total || 0;
        }
        const isEligible = reservationCount >= 1;
        res.status(200).json({
            success: true,
            isFidele: isEligible,
            isReturningCustomer: isEligible,
            visitCount: reservationCount,
            discount: isEligible ? 20 : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// METTRE À JOUR LE STATUT
// ============================================
exports.updateReservationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { statut } = req.body;
        const validStatuses = ['Nouveau', 'En cours', 'Terminé', 'Annulé'];
        if (!validStatuses.includes(statut)) {
            return res.status(400).json({ success: false, message: 'Statut invalide' });
        }
        await db.query('UPDATE reservations SET statut = ? WHERE id = ?', [statut, id]);
        if (global.io) global.io.emit('reservation_updated', { id, statut });
        res.status(200).json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// METTRE À JOUR LE PRIX (ADMIN)
// ============================================
exports.updatePrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { prix_base, remise, prix_final, delai_remise } = req.body;

        await ensureDelaiRemiseColumn();
        await db.query(
            'UPDATE reservations SET prix_base = ?, remise = ?, prix_final = ?, delai_remise = ? WHERE id = ?',
            [prix_base, remise || 0, prix_final, delai_remise || null, id]
        );

        try {
            const [rows] = await db.query(`
                SELECT r.prix_base, r.remise, r.prix_final, r.delai_remise,
                       r.modele_vehicule, r.annee_vehicule,
                       c.nom AS client_nom_q, c.telephone AS client_telephone_q, c.email AS client_email_q
                FROM reservations r
                JOIN clients c ON c.id = r.client_id
                WHERE r.id = ?
            `, [id]);

            if (rows.length) {
                const row = rows[0];
                const [svcRows] = await db.query(`
                    SELECT GROUP_CONCAT(
                        COALESCE(NULLIF(TRIM(s.nom_service),''), NULLIF(TRIM(s.nom),''), s.code, 'Service')
                        SEPARATOR '||'
                    ) AS sc
                    FROM reservation_services rs
                    LEFT JOIN services s ON s.id = rs.service_id
                    WHERE rs.reservation_id = ?
                `, [id]);
                const servicesLines = (svcRows[0]?.sc || '').split('||').map(s => s.trim()).filter(Boolean);
                const emailTo = String(row.client_email_q || '').trim();

                if (emailTo && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
                    });
                    const pdfBuf = await buildQuotePdfBuffer({
                        reservationId: id, clientNom: row.client_nom_q,
                        clientTelephone: row.client_telephone_q, clientEmail: row.client_email_q,
                        modele: row.modele_vehicule, annee: row.annee_vehicule, servicesLines,
                        prixBase: Number(row.prix_base) || 0, remise: Number(row.remise) || 0,
                        prixFinal: Number(row.prix_final) || 0, delaiRemise: row.delai_remise || ''
                    });
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM || `RY Performance <${process.env.EMAIL_USER}>`,
                        to: emailTo,
                        subject: `RY Performance — Votre devis (réservation ${id})`,
                        text: `Bonjour ${row.client_nom_q || ''},\n\nVotre devis est en pièce jointe.\nPrix final : ${Number(row.prix_final) || 0} DZD.\n\nCordialement,\nRY Performance`,
                        attachments: [{ filename: `devis-RY-Performance-${id}.pdf`, content: pdfBuf }]
                    });
                }
            }
        } catch (mailErr) {
            console.error('Email devis:', mailErr.message);
        }

        res.status(200).json({ success: true, message: 'Prix mis à jour' });
    } catch (error) {
        console.error('❌ Erreur updatePrice:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// MODIFIER UNE RÉSERVATION (ADMIN)
// ============================================
exports.updateReservation = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const { name, phone, email, model, year, message, services } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Nom et téléphone sont obligatoires' });
        }

        const [reservations] = await connection.query('SELECT client_id FROM reservations WHERE id = ?', [id]);
        if (!reservations || reservations.length === 0) {
            return res.status(404).json({ success: false, message: 'Réservation non trouvée' });
        }

        await connection.query(
            'UPDATE clients SET nom = ?, telephone = ?, email = ? WHERE id = ?',
            [name, phone, email || null, reservations[0].client_id]
        );
        await connection.query(
            'UPDATE reservations SET modele_vehicule = ?, annee_vehicule = ?, message_client = ? WHERE id = ?',
            [model || '', year || '', message || null, id]
        );

        if (services) {
            const servicesList = typeof services === 'string' ? JSON.parse(services) : services;
            await connection.query('DELETE FROM reservation_services WHERE reservation_id = ?', [id]);
            for (const service of servicesList) {
                const serviceCode = service.value || service.code || '';
                const servicePrice = service.price || 0;
                const [serviceRows] = await connection.query('SELECT id FROM services WHERE code = ?', [serviceCode]);
                if (serviceRows.length > 0) {
                    await connection.query(
                        'INSERT INTO reservation_services (reservation_id, service_id, prix_applique) VALUES (?, ?, ?)',
                        [id, serviceRows[0].id, servicePrice]
                    );
                } else {
                    const serviceName = service.name || service.nom_service || service.nom || '';
                    const [serviceByName] = await connection.query(
                        'SELECT id FROM services WHERE nom = ? OR nom_service = ?', [serviceName, serviceName]
                    );
                    if (serviceByName.length > 0) {
                        await connection.query(
                            'INSERT INTO reservation_services (reservation_id, service_id, prix_applique) VALUES (?, ?, ?)',
                            [id, serviceByName[0].id, servicePrice]
                        );
                    }
                }
            }
        }

        await connection.commit();
        res.status(200).json({ success: true, message: 'Réservation mise à jour' });
    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur updateReservation:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};

// ============================================
// SUPPRIMER UNE RÉSERVATION
// ============================================
exports.deleteReservation = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM reservations WHERE id = ?', [id]);
        res.status(200).json({ success: true, message: 'Réservation supprimée' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// STATISTIQUES
// ============================================
exports.getStatistics = async (req, res) => {
    try {
        const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM reservations');
        const [[{ nonTraitees }]] = await db.query(`SELECT COUNT(*) AS nonTraitees FROM reservations WHERE statut IN ('Nouveau','En cours')`);
        const [[{ revenu }]] = await db.query('SELECT COALESCE(SUM(prix_final),0) AS revenu FROM reservations');
        const moyenne = total > 0 ? Math.round(revenu / total) : 0;

        res.status(200).json({
            success: true,
            data: {
                total_reservations: total,
                non_traitees: nonTraitees,
                chiffre_affaires: revenu,
                panier_moyen: moyenne
            }
        });
    } catch (error) {
        console.error('❌ Erreur getStatistics:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};