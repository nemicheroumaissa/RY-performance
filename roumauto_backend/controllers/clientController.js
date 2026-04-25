const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ============================================
// INSCRIPTION CLIENT
// ============================================
exports.register = async (req, res) => {
    try {
        const { nom, telephone, password } = req.body;

        console.log('📝 Inscription client:', nom, telephone);

        if (!nom || !telephone || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nom, téléphone et mot de passe requis' 
            });
        }

        const [existing] = await db.query(
            'SELECT id FROM clients WHERE telephone = ?', 
            [telephone]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Ce numéro est déjà inscrit.' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query(
            'INSERT INTO clients (nom, telephone, password) VALUES (?, ?, ?)',
            [nom, telephone, hashedPassword]
        );

        console.log('✅ Client inscrit:', telephone);

        res.status(201).json({ 
            success: true, 
            message: 'Inscription réussie ! Vous pouvez vous connecter.' 
        });

    } catch (error) {
        console.error('❌ Erreur inscription client:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};

// ============================================
// CONNEXION CLIENT - ✅ CORRECTION
// ============================================
exports.login = async (req, res) => {
    try {
        const { telephone, password } = req.body;

        console.log('🔐 Tentative connexion:', telephone);

        if (!telephone || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Téléphone et mot de passe requis' 
            });
        }

        const [clients] = await db.query(
            'SELECT * FROM clients WHERE telephone = ?', 
            [telephone]
        );

        if (clients.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Téléphone ou mot de passe incorrect' 
            });
        }

        const client = clients[0];

        // ✅ UTILISER bcrypt.compare
        const isMatch = await bcrypt.compare(password, client.password);

        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Téléphone ou mot de passe incorrect' 
            });
        }

        const token = jwt.sign(
            { id: client.id, role: 'client' },
            process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise_2025',
            { expiresIn: '30d' }
        );

        console.log('✅ Connexion réussie:', telephone);

        res.status(200).json({
            success: true,
            message: 'Connexion réussie',
            token,
            user: {
                id: client.id,
                nom: client.nom,
                telephone: client.telephone
            }
        });

    } catch (error) {
        console.error('❌ Erreur login:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
};