const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, isAdmin } = require('../middleware/authMiddleware');

// ============================================
// ROUTES PUBLIQUES
// ============================================

// POST - Inscription
router.post('/signup', authController.signup);

// POST - Connexion
router.post('/login', authController.login);

// GET - Vérifier le token
router.get('/verify', authController.verifyToken);

// ============================================
// ROUTES PROTÉGÉES (ADMIN UNIQUEMENT)
// ============================================

// GET - Récupérer les demandes en attente
router.get('/pending-requests', authenticateToken, isAdmin, authController.getPendingRequests);

// PUT - Approuver un utilisateur
router.put('/approve/:userId', authenticateToken, isAdmin, authController.approveUser);

// PUT - Refuser un utilisateur
router.put('/reject/:userId', authenticateToken, isAdmin, authController.rejectUser);

module.exports = router;