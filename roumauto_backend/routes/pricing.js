const express = require('express');
const router = express.Router();
const pricingController = require('../controllers/pricingController');

// Route pour calculer le prix dynamique complet (modèle + année + km + services)
router.post('/calculate-dynamic', pricingController.calculateDynamicPrice);

// Route pour détecter la catégorie du véhicule
router.get('/detect/:model', pricingController.detectVehicleCategory);

// Route pour obtenir toutes les catégories
router.get('/categories', pricingController.getCategories);

module.exports = router;