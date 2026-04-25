const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const chatController = require('../controllers/chatController');

// ============================================
// CONFIGURATION MULTER POUR UPLOAD FICHIERS
// ============================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// ============================================
// ROUTES CHAT
// ============================================

// Créer ou récupérer une conversation
router.post('/conversations', chatController.getOrCreateConversation);

// Récupérer toutes les conversations (Admin)
router.get('/conversations', chatController.getAllConversations);

// Mettre à jour les statuts (delivered / read) pour une conversation
router.post('/conversations/:id/mark-delivered', chatController.markDelivered);
router.post('/conversations/:id/mark-read', chatController.markRead);

// Supprimer toute la conversation (POST : compatibilité si DELETE bloqué par l'hébergeur)
router.post('/conversations/:id/delete', chatController.deleteConversation);
// Supprimer toute la conversation (messages + conversation)
router.delete('/conversations/:id', chatController.deleteConversation);

// Envoyer un message (avec fichier optionnel)
router.post('/messages', upload.single('file'), chatController.sendMessage);

// Récupérer les messages d'une conversation
router.get('/messages/:id', chatController.getMessages);

// Supprimer un message
router.delete('/messages/:id', chatController.deleteMessage);

module.exports = router;