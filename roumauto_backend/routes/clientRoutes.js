const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

// ============================================
// ROUTES AUTHENTIFICATION CLIENT
// ============================================

// Inscription
router.post('/register', clientController.register);

// Connexion
router.post('/login', clientController.login);

module.exports = router;