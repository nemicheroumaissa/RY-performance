const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ============================================
// SOCKET.IO
// ============================================
const io = socketIo(server, {
    cors: {
        // Permet aussi l'origine "null" (cas `file://...` en dev)
        origin: (origin, callback) => callback(null, true),
        methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
        credentials: true
    }
});

global.io = io;

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors({
    // En dev: on accepte `null` (ex: ouverture en `file://`), et on reflète l'origine
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// ============================================
// CRÉER DOSSIER UPLOADS
// ============================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('📁 Dossier uploads/ créé');
}

// ============================================
// ROUTES
// ============================================
const reservationRoutes = require('./routes/reservationRoutes');
const authRoutes        = require('./routes/auth');
const chatRoutes        = require('./routes/chatRoutes');
const clientRoutes      = require('./routes/clientRoutes');

// ============================================
// ROUTES API
// ============================================
app.get('/', (req, res) => {
    res.json({
        message: '🚗 RY Performance API',
        version: '2.0.0',
        status: 'Online'
    });
});

app.use('/api/reservations', reservationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/client', clientRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// ============================================
// SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('✅ Client connecté:', socket.id);

    socket.on('register', (userId, userType) => {
        socket.join(`user-${userId}`);
        console.log(`${userType} ${userId} enregistré`);
    });

    socket.on('join_conversation', (conversationId) => {
        socket.join(`conv-${conversationId}`);
        console.log(`Rejoint conversation ${conversationId}`);
    });

    socket.on('send_message', (data) => {
        const convId = data.conversationId || data.conversation_id;
        io.to(`conv-${convId}`).emit('receive_message', data);
    });

    socket.on('delete_message', (data) => {
        io.to(`conv-${data.conversationId}`).emit('message_deleted', data);
    });

    socket.on('disconnect', () => {
        console.log('❌ Déconnecté:', socket.id);
    });
});

// ============================================
// ERREURS
// ============================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route non trouvée: ' + req.path
    });
});

app.use((err, req, res, next) => {
    console.error('❌ Erreur:', err.stack);
    res.status(500).json({
        success: false,
        message: 'Erreur serveur',
        error: err.message
    });
});

// ============================================
// DÉMARRER SERVEUR
// ============================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚗 RY Performance Backend');
    console.log('=================================');
    console.log(`✅ Écoute sur 0.0.0.0:${PORT} (localhost + réseau local)`);
    console.log(`💬 Socket.io: ACTIVÉ`);
    console.log(`📁 Uploads: ${uploadsDir}`);
    console.log('=================================');
});

module.exports = app;