const db = require('../config/database');
const mailer = require('../utils/mailer');
const { buildQuotePdfBuffer } = require('../utils/quotePdf');

function formatDzdValue(value) {
    const n = Math.round(Number(value) || 0);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DZD';
}

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

let clientReservationCounterEnsured = false;

async function ensureClientReservationCounter() {
    if (clientReservationCounterEnsured) return;
    try {
        await db.query('ALTER TABLE clients ADD COLUMN reservation_count INT NOT NULL DEFAULT 0');
    } catch (e) {
        if (e.errno !== 1060) console.warn('ensureClientReservationCounter:', e.message);
    }
    clientReservationCounterEnsured = true;
}

// Règle fidélité (nombre d’autres réservations du client, hors « Annulé ») :
//   0 autre résa  → 0%   (1ère réservation)
//   1 autre résa  → 5%   (2e réservation)
//   2 autres résas → 10% (3e réservation)
//   3+ autres résas → 20% (4e et suivantes)
function computeDiscountPercentFromCount(priorNonCancelledCount) {
    const count = Math.max(0, Number(priorNonCancelledCount) || 0);
    if (count === 0) return 0;
    if (count === 1) return 5;
    if (count === 2) return 10;
    return 20;
}

function buildPhoneLookupVariants(raw) {
    const t = String(raw || '').trim();
    if (!t) return [];
    const variants = new Set([t, t.replace(/\s+/g, '')]);
    const digits = t.replace(/\D/g, '');
    if (digits.length >= 8) {
        variants.add(digits);
        const last9 = digits.slice(-9);
        variants.add(last9);
        variants.add('0' + last9);
        variants.add('213' + last9);
        variants.add('+213' + last9);
        if (digits.startsWith('213') && digits.length > 3) {
            variants.add('0' + digits.slice(3));
            variants.add(digits.slice(3));
        }
    }
    return [...variants].filter(Boolean);
}

/** Résout client_id même si le téléphone diffère légèrement (espaces, +213, etc.) */
async function resolveClientIdByPhone(dbConn, phoneParam) {
    let raw = String(phoneParam ?? '').trim();
    try {
        raw = decodeURIComponent(raw);
    } catch {
        /* garde raw */
    }
    raw = raw.trim();
    const variants = buildPhoneLookupVariants(raw);
    if (variants.length === 0) return null;
    const [rows] = await dbConn.query('SELECT id FROM clients WHERE telephone IN (?) LIMIT 1', [variants]);
    if (rows?.length) return rows[0].id;
    const want = raw.replace(/\D/g, '');
    const tail = want.length >= 9 ? want.slice(-9) : want;
    if (tail.length < 8) return null;
    const [all] = await dbConn.query('SELECT id, telephone FROM clients WHERE telephone IS NOT NULL AND telephone != \'\'');
    for (const row of all || []) {
        const d = String(row.telephone || '').replace(/\D/g, '');
        if (!d) continue;
        if (d === want || d.slice(-9) === tail || want.endsWith(d.slice(-9))) return row.id;
    }
    return null;
}

async function countPriorNonCancelledReservations(dbConn, clientId, excludeReservationId) {
    if (!clientId) return 0;
    const ex = Number(excludeReservationId);
    const useEx = Number.isFinite(ex) && ex > 0;
    const [cntRows] = await dbConn.query(
        `SELECT COUNT(*) AS c FROM reservations r
         WHERE r.client_id = ?
           AND r.statut <> 'Annulé'
           AND (? = 0 OR r.id <> ?)`,
        [clientId, useEx ? 1 : 0, useEx ? ex : 0]
    );
    return Number(cntRows?.[0]?.c) || 0;
}

// ============================================
// CRÉER UNE NOUVELLE RÉSERVATION
// ============================================
exports.createReservation = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await ensureClientReservationCounter();
        const { name, phone, email, model, year, message, services, basePrice, discount, finalPrice } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Nom et téléphone sont obligatoires' });
        }

        let servicesList = [];
        if (services) servicesList = typeof services === 'string' ? JSON.parse(services) : services;

        let clientId = await resolveClientIdByPhone(connection, phone);
        if (clientId) {
            await connection.query('UPDATE clients SET nom = ?, email = ? WHERE id = ?', [name, email || null, clientId]);
        } else {
            const [clientResult] = await connection.query(
                'INSERT INTO clients (nom, telephone, email) VALUES (?, ?, ?)',
                [name, phone, email || null]
            );
            clientId = clientResult.insertId;
        }

        // Remise fidélité : autres réservations du client (hors « Annulé »), avant celle-ci
        let priorCount = 0;
        try {
            priorCount = await countPriorNonCancelledReservations(connection, clientId, null);
        } catch (e) {
            priorCount = 0;
        }
        const autoDiscountPercent = computeDiscountPercentFromCount(priorCount);

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
            data: { reservationId, orderId: String(reservationId), autoDiscountPercent }
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
            statut_fidelite: (phoneCounts[String(r.client_telephone || '').trim()] || 0) >= 2 ? 'fidele' : 'standard'
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
        let services_detail = [];
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

        try {
            const [detailRows] = await db.query(
                `
                SELECT
                    COALESCE(NULLIF(TRIM(s.nom_service),''), NULLIF(TRIM(s.nom),''), s.code, 'Service') AS service_nom,
                    COALESCE(rs.prix_applique, 0) AS prix_applique
                FROM reservation_services rs
                LEFT JOIN services s ON s.id = rs.service_id
                WHERE rs.reservation_id = ?
                ORDER BY rs.id ASC
                `,
                [id]
            );
            services_detail = (detailRows || []).map((row) => ({
                name: String(row.service_nom || 'Service').trim(),
                price: Math.max(0, Number(row.prix_applique) || 0)
            }));
        } catch (e) {
            services_detail = [];
        }

        res.status(200).json({
            success: true,
            data: { ...reservations[0], delai_remise, services_noms, services_detail, images: [] }
        });
    } catch (error) {
        console.error('❌ Erreur getReservationById:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// VÉRIFIER CLIENT FIDÈLE
// Compte les autres réservations non annulées (option excludeReservationId = ligne courante admin)
// ============================================
exports.checkReturningCustomer = async (req, res) => {
    try {
        await ensureClientReservationCounter();
        const { phone } = req.params;
        const excludeReservationId = req.query.excludeReservationId ?? req.query.excludeReservation;

        const clientId = await resolveClientIdByPhone(db, phone);

        const priorCount = await countPriorNonCancelledReservations(db, clientId, excludeReservationId);

        const discountPercent = computeDiscountPercentFromCount(priorCount);
        const isEligible = discountPercent > 0;

        res.status(200).json({
            success:             true,
            clientId,
            reservationCount:    priorCount,
            discountPercent,
            isFidele:            isEligible,
            isReturningCustomer: isEligible
        });
    } catch (error) {
        console.error('❌ Erreur checkReturningCustomer:', error);
        res.status(500).json({ success: false, message: error.message, reservationCount: 0, discountPercent: 0 });
    }
};

// ============================================
// FIDÉLITÉ À PARTIR DU N° DE RÉSERVATION (admin / devis)
// Même règle que check-customer, mais client_id lu depuis la ligne réservation (pas le téléphone).
// ============================================
exports.getLoyaltyDiscountByReservationId = async (req, res) => {
    try {
        await ensureClientReservationCounter();
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'ID de réservation invalide' });
        }
        const [rows] = await db.query(
            `SELECT r.client_id, c.telephone AS client_telephone
             FROM reservations r
             INNER JOIN clients c ON c.id = r.client_id
             WHERE r.id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows?.length) {
            return res.status(404).json({ success: false, message: 'Réservation non trouvée' });
        }
        const clientId = Number(rows[0].client_id) || null;
        const clientPhone = String(rows[0].client_telephone || '').trim();
        if (!clientId) {
            return res.status(200).json({
                success:             true,
                reservationId:     id,
                clientId:            null,
                clientPhone:         clientPhone || null,
                reservationCount:    0,
                discountPercent:     0,
                isFidele:            false,
                isReturningCustomer: false
            });
        }
        const priorCount = await countPriorNonCancelledReservations(db, clientId, id);
        const discountPercent = computeDiscountPercentFromCount(priorCount);
        const isEligible = discountPercent > 0;
        res.status(200).json({
            success:             true,
            reservationId:     id,
            clientId,
            clientPhone:         clientPhone || null,
            reservationCount:    priorCount,
            discountPercent,
            isFidele:            isEligible,
            isReturningCustomer: isEligible
        });
    } catch (error) {
        console.error('❌ Erreur getLoyaltyDiscountByReservationId:', error);
        res.status(500).json({ success: false, message: error.message, reservationCount: 0, discountPercent: 0 });
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
        const [rowsPrev] = await db.query(
            'SELECT statut AS prev_statut, client_id FROM reservations WHERE id = ? LIMIT 1',
            [id]
        );
        const prev = rowsPrev[0];
        if (!prev) {
            return res.status(404).json({ success: false, message: 'Réservation non trouvée' });
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
// ✅ CORRECTION : récupère date_emission depuis req.body et la passe au PDF
// ============================================
exports.updatePrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { prix_base, remise, prix_final, delai_remise, date_emission, services_pricing } = req.body;

        await ensureDelaiRemiseColumn();
        const pb = Math.max(0, Math.round(Number(prix_base) || 0));
        let pf = Math.max(0, Math.round(Number(prix_final) || 0));
        if (pf > pb) pf = pb;
        const remiseMontant = Math.max(0, pb - pf);

        await db.query(
            'UPDATE reservations SET prix_base = ?, remise = ?, prix_final = ?, delai_remise = ? WHERE id = ?',
            [pb, remiseMontant, pf, delai_remise || null, id]
        );

        if (Array.isArray(services_pricing) && services_pricing.length > 0) {
            const [rsRows] = await db.query(
                'SELECT id FROM reservation_services WHERE reservation_id = ? ORDER BY id ASC',
                [id]
            );
            for (let i = 0; i < rsRows.length; i += 1) {
                const price = Math.max(0, Number(services_pricing[i]?.price) || 0);
                await db.query(
                    'UPDATE reservation_services SET prix_applique = ? WHERE id = ?',
                    [price, rsRows[i].id]
                );
            }
        }

        let quoteEmailSent = false;
        let quoteEmailSkipped = null;

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
                    SELECT
                        COALESCE(NULLIF(TRIM(s.nom_service),''), NULLIF(TRIM(s.nom),''), s.code, 'Service') AS service_nom,
                        COALESCE(rs.prix_applique, 0) AS prix_applique
                    FROM reservation_services rs
                    LEFT JOIN services s ON s.id = rs.service_id
                    WHERE rs.reservation_id = ?
                    ORDER BY rs.id ASC
                `, [id]);

                const servicesLines = (svcRows || []).map((svc) => {
                    const name = String(svc.service_nom || 'Service').trim();
                    const price = Number(svc.prix_applique) || 0;
                    return price > 0 ? `${name} - ${formatDzdValue(price)}` : name;
                });

                const emailTo = String(row.client_email_q || '').trim();

                if (!emailTo) {
                    quoteEmailSkipped = 'client_sans_email';
                    console.warn(`⚠️  Devis PDF non envoyé (réservation ${id}) : le client n'a pas d'email.`);
                } else if (!mailer.isMailConfigured()) {
                    quoteEmailSkipped = 'smtp_non_configure';
                    console.warn(`⚠️  Devis PDF non envoyé (réservation ${id}) : SMTP non configuré.`);
                } else {
                    // ✅ Utilise date_emission transmise par le frontend (moment de l'envoi du devis)
                    // Sinon fallback sur maintenant
                    const dateEmission = date_emission ? new Date(date_emission) : new Date();

                    const pdfBuf = await buildQuotePdfBuffer({
                        reservationId:   id,
                        clientNom:       row.client_nom_q,
                        clientTelephone: row.client_telephone_q,
                        clientEmail:     row.client_email_q,
                        modele:          row.modele_vehicule,
                        annee:           row.annee_vehicule,
                        servicesLines,
                        prixBase:        Number(row.prix_base)  || 0,
                        remise:          Number(row.remise)     || 0,
                        prixFinal:       Number(row.prix_final) || 0,
                        delaiRemise:     row.delai_remise       || '',
                        dateEmission:    dateEmission.toISOString()  // ✅ date correcte
                    });

                    const emissionFr = dateEmission.toLocaleString('fr-FR', {
                        dateStyle: 'long',
                        timeStyle: 'short',
                        timeZone: 'Africa/Algiers'
                    });

                    await mailer.sendMail({
                        to: emailTo,
                        subject: `RY Performance — Votre devis (réservation ${id})`,
                        text: `Bonjour ${row.client_nom_q || ''},\n\nVotre devis est en pièce jointe.\nDate d'émission : ${emissionFr}\nPrix final : ${formatDzdValue(Number(row.prix_final) || 0)}.\n\nCordialement,\nRY Performance`,
                        attachments: [{ filename: `devis-RY-Performance-${id}.pdf`, content: pdfBuf }]
                    });
                    quoteEmailSent = true;
                    console.log(`✅ Devis PDF envoyé à ${emailTo} (réservation ${id})`);
                }
            }
        } catch (mailErr) {
            quoteEmailSkipped = mailErr.code || 'erreur_envoi';
            console.error('❌ Erreur envoi email devis:', mailErr.message || mailErr);
        }

        res.status(200).json({
            success: true,
            message: 'Prix mis à jour',
            quoteEmailSent,
            quoteEmailSkipped: quoteEmailSkipped || null
        });
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
                non_traitees:       nonTraitees,
                chiffre_affaires:   revenu,
                panier_moyen:       moyenne
            }
        });
    } catch (error) {
        console.error('❌ Erreur getStatistics:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};