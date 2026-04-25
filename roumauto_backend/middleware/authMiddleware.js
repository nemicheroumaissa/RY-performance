const jwt = require('jsonwebtoken');
const db = require('../config/database');

// ============================================
// MIDDLEWARE : Vérifier l'authentification
// ============================================
exports.authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Accès refusé. Token manquant.'
            });
        }

        // Vérifier le token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Vérifier si l'utilisateur existe toujours et est approuvé
        const [users] = await db.query(
            'SELECT id, username, role, statut FROM users WHERE id = ?',
            [decoded.id]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        const user = users[0];

        if (user.statut !== 'approuve') {
            return res.status(403).json({
                success: false,
                message: 'Compte non approuvé ou suspendu'
            });
        }

        // Ajouter les infos de l'utilisateur à la requête
        req.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expiré. Veuillez vous reconnecter.'
            });
        }

        return res.status(403).json({
            success: false,
            message: 'Token invalide',
            error: error.message
        });
    }
};

// ============================================
// MIDDLEWARE : Vérifier si l'utilisateur est admin
// ============================================
exports.isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Accès refusé. Privilèges administrateur requis.'
        });
    }
    next();
};

// ============================================
// MIDDLEWARE : Vérifier si l'utilisateur est admin OU employé
// ============================================
exports.isAdminOrEmployee = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'employee') {
        return res.status(403).json({
            success: false,
            message: 'Accès refusé.'
        });
    }
    next();
};