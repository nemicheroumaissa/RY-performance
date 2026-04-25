const db = require('../config/database');

// ============================================
// CALCULER LE PRIX DYNAMIQUE COMPLET
// ============================================
exports.calculateDynamicPrice = async (req, res) => {
    try {
        const { model, year, kilometers, services } = req.body;

        console.log('💰 Calcul prix dynamique:', { model, year, kilometers, services });

        if (!model || !services || services.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Modèle et services requis'
            });
        }

        // ============================================
        // 1. DÉTECTER LA CATÉGORIE DU VÉHICULE
        // ============================================
        let categorie = 'Moyenne';
        let multiplicateur = 1.20;

        const cleanModel = model.trim().toLowerCase();

        // Chercher dans la base de données
        const [exactMatch] = await db.query(`
            SELECT cv.nom AS categorie, cv.multiplicateur
            FROM modeles_vehicules mv
            INNER JOIN categories_vehicules cv ON mv.categorie_id = cv.id
            WHERE LOWER(CONCAT(mv.marque, ' ', mv.modele)) LIKE ?
               OR LOWER(mv.modele) LIKE ?
               OR LOWER(mv.marque) LIKE ?
            LIMIT 1
        `, [`%${cleanModel}%`, `%${cleanModel}%`, `%${cleanModel}%`]);

        if (exactMatch.length > 0) {
            categorie = exactMatch[0].categorie;
            multiplicateur = parseFloat(exactMatch[0].multiplicateur);
        } else {
            // Détection par mots-clés
            if (cleanModel.includes('suv') || cleanModel.includes('4x4') || 
                cleanModel.includes('duster') || cleanModel.includes('tucson') || 
                cleanModel.includes('qashqai')) {
                categorie = 'SUV';
                multiplicateur = 1.50;
            } else if (cleanModel.includes('mercedes') || cleanModel.includes('bmw') || 
                       cleanModel.includes('audi') || cleanModel.includes('porsche')) {
                categorie = 'Luxe';
                multiplicateur = 1.80;
            } else if (cleanModel.includes('508') || cleanModel.includes('classe e') || 
                       cleanModel.includes('série 5')) {
                categorie = 'Grande';
                multiplicateur = 1.40;
            } else if (cleanModel.includes('208') || cleanModel.includes('clio') || 
                       cleanModel.includes('polo') || cleanModel.includes('picanto') ||
                       cleanModel.includes('yaris') || cleanModel.includes('i10')) {
                categorie = 'Petite';
                multiplicateur = 1.00;
            }
        }

        console.log(`📊 Catégorie: ${categorie} (x${multiplicateur})`);

        // ============================================
        // 2. AJUSTEMENT SELON L'ANNÉE
        // ============================================
        let ajustementAnnee = 0;
        const currentYear = new Date().getFullYear();
        const vehicleAge = year ? currentYear - parseInt(year) : 0;

        if (vehicleAge > 15) {
            ajustementAnnee = -0.15; // -15% pour voitures très anciennes
        } else if (vehicleAge > 10) {
            ajustementAnnee = -0.10; // -10% pour voitures anciennes
        } else if (vehicleAge > 5) {
            ajustementAnnee = -0.05; // -5% pour voitures d'âge moyen
        } else {
            ajustementAnnee = 0; // Prix normal pour voitures récentes
        }

        console.log(`📅 Âge: ${vehicleAge} ans → Ajustement: ${ajustementAnnee * 100}%`);

        // ============================================
        // 3. AJUSTEMENT SELON LE KILOMÉTRAGE
        // ============================================
        let ajustementKm = 0;
        const km = kilometers ? parseInt(kilometers) : 0;

        if (km > 300000) {
            ajustementKm = -0.20; // -20% pour très haut kilométrage
        } else if (km > 200000) {
            ajustementKm = -0.15; // -15% pour haut kilométrage
        } else if (km > 150000) {
            ajustementKm = -0.10; // -10% pour kilométrage élevé
        } else if (km > 100000) {
            ajustementKm = -0.05; // -5% pour kilométrage moyen
        } else {
            ajustementKm = 0; // Prix normal pour faible kilométrage
        }

        console.log(`🛣️ Kilométrage: ${km.toLocaleString()} km → Ajustement: ${ajustementKm * 100}%`);

        // ============================================
        // 4. CALCULER LE PRIX POUR CHAQUE SERVICE
        // ============================================
        const servicesDetails = [];
        let totalBasePrice = 0;

        for (const serviceCode of services) {
            const [serviceData] = await db.query(
                'SELECT code_service, nom_service, prix_base FROM services WHERE code_service = ?',
                [serviceCode]
            );

            if (serviceData.length > 0) {
                const prixBase = parseFloat(serviceData[0].prix_base);
                
                // Appliquer les ajustements
                const prixAvecCategorie = prixBase * multiplicateur;
                const ajustementTotal = 1 + ajustementAnnee + ajustementKm;
                const prixFinal = Math.round(prixAvecCategorie * ajustementTotal);

                servicesDetails.push({
                    code: serviceData[0].code_service,
                    nom: serviceData[0].nom_service,
                    prixBase: prixBase,
                    prixFinal: prixFinal
                });

                totalBasePrice += prixBase;
            }
        }

        // ============================================
        // 5. CALCULER LE TOTAL
        // ============================================
        const totalAvecCategorie = totalBasePrice * multiplicateur;
        const ajustementTotal = 1 + ajustementAnnee + ajustementKm;
        const prixFinalTotal = Math.round(totalAvecCategorie * ajustementTotal);

        console.log(`💵 Prix total: ${prixFinalTotal.toLocaleString()} DZD`);

        // ============================================
        // 6. RETOURNER LES RÉSULTATS
        // ============================================
        res.status(200).json({
            success: true,
            vehicule: {
                modele: model,
                annee: year,
                age: vehicleAge,
                kilometres: km,
                categorie: categorie
            },
            ajustements: {
                multiplicateurCategorie: multiplicateur,
                ajustementAnnee: ajustementAnnee,
                ajustementKilometrage: ajustementKm,
                ajustementTotal: ajustementTotal
            },
            services: servicesDetails,
            prix: {
                base: totalBasePrice,
                avecCategorie: Math.round(totalAvecCategorie),
                final: prixFinalTotal
            }
        });

    } catch (error) {
        console.error('❌ Erreur calcul prix dynamique:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du calcul',
            error: error.message
        });
    }
};

// ============================================
// DÉTECTER LA CATÉGORIE DU VÉHICULE
// ============================================
exports.detectVehicleCategory = async (req, res) => {
    try {
        const { model } = req.params;
        
        if (!model) {
            return res.status(400).json({
                success: false,
                message: 'Modèle de véhicule requis'
            });
        }

        console.log('🔍 Détection catégorie pour:', model);

        const cleanModel = model.trim().toLowerCase();

        // Chercher le modèle exact dans la base
        const [exactMatch] = await db.query(`
            SELECT mv.marque, mv.modele, cv.nom AS categorie, cv.multiplicateur
            FROM modeles_vehicules mv
            INNER JOIN categories_vehicules cv ON mv.categorie_id = cv.id
            WHERE LOWER(CONCAT(mv.marque, ' ', mv.modele)) LIKE ?
               OR LOWER(mv.modele) LIKE ?
               OR LOWER(mv.marque) LIKE ?
            LIMIT 1
        `, [`%${cleanModel}%`, `%${cleanModel}%`, `%${cleanModel}%`]);

        if (exactMatch.length > 0) {
            console.log('✅ Modèle trouvé:', exactMatch[0]);
            return res.status(200).json({
                success: true,
                categorie: exactMatch[0].categorie,
                multiplicateur: parseFloat(exactMatch[0].multiplicateur),
                modeleDetecte: `${exactMatch[0].marque} ${exactMatch[0].modele}`
            });
        }

        // Si pas trouvé, détecter par mots-clés
        let categorie = 'Moyenne';
        let multiplicateur = 1.20;

        const modelLower = cleanModel;

        if (modelLower.includes('suv') || modelLower.includes('4x4') || 
            modelLower.includes('duster') || modelLower.includes('tucson') || 
            modelLower.includes('qashqai') || modelLower.includes('sportage')) {
            categorie = 'SUV';
            multiplicateur = 1.50;
        } else if (modelLower.includes('mercedes') || modelLower.includes('bmw') || 
                   modelLower.includes('audi') || modelLower.includes('porsche') ||
                   modelLower.includes('tesla') || modelLower.includes('range rover')) {
            categorie = 'Luxe';
            multiplicateur = 1.80;
        } else if (modelLower.includes('classe s') || modelLower.includes('série 7') || 
                   modelLower.includes('a8') || modelLower.includes('508')) {
            categorie = 'Grande';
            multiplicateur = 1.40;
        } else if (modelLower.includes('208') || modelLower.includes('clio') || 
                   modelLower.includes('polo') || modelLower.includes('yaris') ||
                   modelLower.includes('i10') || modelLower.includes('picanto')) {
            categorie = 'Petite';
            multiplicateur = 1.00;
        }

        console.log(`📊 Catégorie détectée: ${categorie} (x${multiplicateur})`);

        res.status(200).json({
            success: true,
            categorie,
            multiplicateur,
            modeleDetecte: model
        });

    } catch (error) {
        console.error('❌ Erreur détection catégorie:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la détection',
            error: error.message
        });
    }
};

// ============================================
// OBTENIR TOUTES LES CATÉGORIES
// ============================================
exports.getCategories = async (req, res) => {
    try {
        const [categories] = await db.query('SELECT * FROM categories_vehicules ORDER BY multiplicateur');
        
        res.status(200).json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération',
            error: error.message
        });
    }
};