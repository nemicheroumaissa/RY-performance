const db = require('../config/database');

// ============================================
// UTILITAIRE SOCKET
// ============================================
function emitMessageStatusUpdate(conversationId, status, messageIds) {
    if (!global.io || !Array.isArray(messageIds) || messageIds.length === 0) return;
    global.io.to(`conv-${conversationId}`).emit('messages_status_updated', {
        conversationId: Number(conversationId),
        status,
        messageIds
    });
}

// ============================================
// CRÉER OU RÉCUPÉRER UNE CONVERSATION
// ============================================
exports.getOrCreateConversation = async (req, res) => {
    try {
        const { clientId } = req.body;
        const normalizedClientId = Number(clientId);

        if (!Number.isInteger(normalizedClientId) || normalizedClientId <= 0) {
            return res.status(400).json({ success: false, message: 'clientId invalide' });
        }

        const [clientRows] = await db.query(
            'SELECT id FROM clients WHERE id = ? LIMIT 1',
            [normalizedClientId]
        );
        if (!clientRows.length) {
            return res.status(404).json({ success: false, message: 'Client introuvable' });
        }

        const [existing] = await db.query(
            'SELECT * FROM conversations WHERE client_id = ? ORDER BY id DESC LIMIT 1',
            [normalizedClientId]
        );
        if (existing.length > 0) {
            return res.json({ success: true, conversation: existing[0] });
        }

        const [result] = await db.query(
            'INSERT INTO conversations (client_id) VALUES (?)',
            [normalizedClientId]
        );
        res.json({ success: true, conversation: { id: result.insertId, client_id: normalizedClientId } });
    } catch (error) {
        console.error('Erreur getOrCreateConversation:', error);
        res.status(500).json({ success: false, message: 'Erreur conversation' });
    }
};

// ============================================
// ENVOYER UN MESSAGE
// ============================================
exports.sendMessage = async (req, res) => {
    try {
        const { conversationId, senderType, text } = req.body;
        let messageType = 'text';
        let filePath = null;

        if (req.file) {
            filePath = req.file.path.replace(/\\/g, '/');
            if (req.file.mimetype.startsWith('image'))      messageType = 'image';
            else if (req.file.mimetype.startsWith('audio')) messageType = 'audio';
            else if (req.file.mimetype.startsWith('video')) messageType = 'video';
        }

        const [result] = await db.query(
            `INSERT INTO messages (conversation_id, sender_type, message_text,
                message_type, file_path, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'sent', NOW())`,
            [conversationId, senderType, text || '', messageType, filePath]
        );

        await db.query(
            'UPDATE conversations SET last_message_at = NOW() WHERE id = ?',
            [conversationId]
        );

        const newMessage = {
            id: result.insertId,
            conversation_id: Number(conversationId),
            sender_type: senderType,
            message_text: text,
            message_type: messageType,
            file_path: filePath,
            status: 'sent',
            delivered_at: null,
            read_at: null,
            created_at: new Date()
        };

        res.status(201).json({ success: true, message: newMessage });

        // ============================================================
        // FIX DÉFINITIF : auto-delivered dès l'envoi si l'autre
        // côté est déjà dans la room socket.
        //
        // Exemple : client envoie → si l'admin est connecté dans
        // conv-X → on marque delivered immédiatement → socket émet
        // messages_status_updated → le span côté client passe à "Reçu"
        // SANS attendre que l'admin ouvre/ferme la conversation.
        // ============================================================
        setImmediate(async () => {
            try {
                const room = global.io?.sockets?.adapter?.rooms?.get(`conv-${conversationId}`);
                // room.size >= 2 = au moins 2 sockets dans la room (client + admin)
                if (!room || room.size < 2) return;

                await db.query(
                    `UPDATE messages SET status = 'delivered',
                         delivered_at = IF(delivered_at IS NULL, NOW(), delivered_at)
                     WHERE id = ? AND status = 'sent'`,
                    [result.insertId]
                );

                emitMessageStatusUpdate(conversationId, 'delivered', [result.insertId]);
            } catch (err) {
                console.error('Erreur auto-delivered:', err);
            }
        });

    } catch (error) {
        console.error('Erreur sendMessage:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// RÉCUPÉRER LES MESSAGES D'UNE CONVERSATION
// ============================================
exports.getMessages = async (req, res) => {
    try {
        const conversationId = req.params.id;
        const [messages] = await db.query(
            'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [conversationId]
        );
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Erreur getMessages:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// RÉCUPÉRER TOUTES LES CONVERSATIONS (ADMIN)
// ============================================
exports.getAllConversations = async (req, res) => {
    try {
        const [conversations] = await db.query(`
            SELECT c.id, c.last_message_at, cl.nom AS client_name, cl.telephone,
                (
                    SELECT CASE
                        WHEN msg.message_text IS NOT NULL AND msg.message_text <> '' THEN msg.message_text
                        WHEN msg.message_type = 'image' THEN '[Photo]'
                        WHEN msg.message_type = 'audio' THEN '[Vocal]'
                        WHEN msg.message_type = 'video' THEN '[Video]'
                        ELSE '[Message]'
                    END
                    FROM messages AS msg WHERE msg.conversation_id = c.id
                    ORDER BY msg.created_at DESC LIMIT 1
                ) AS last_message,
                SUM(
                    CASE WHEN m.sender_type = 'client' AND (m.status IS NULL OR m.status <> 'read')
                    THEN 1 ELSE 0 END
                ) AS unread_from_client
            FROM conversations c
            JOIN clients cl ON c.client_id = cl.id
            LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id, c.last_message_at, cl.nom, cl.telephone
            ORDER BY c.last_message_at DESC
        `);
        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Erreur getAllConversations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// MARQUER LES MESSAGES COMME "DELIVERED"
// ============================================
//
//  viewerType='admin'  → admin ouvre la conv → marque msgs CLIENT delivered
//                      → socket notifie le client → span passe à "Reçu" ✅
//
//  viewerType='client' → script.js NE L'APPELLE PLUS (supprimé)
//
exports.markDelivered = async (req, res) => {
    try {
        const conversationId = req.params.id;
        const { viewerType } = req.body;

        if (!conversationId || !viewerType) {
            return res.status(400).json({ success: false, message: 'conversationId et viewerType requis' });
        }

        // Messages de l'autre côté encore en 'sent'
        const [toDeliver] = await db.query(
            `SELECT id FROM messages
             WHERE conversation_id = ? AND sender_type <> ?
               AND (status IS NULL OR status = 'sent')`,
            [conversationId, viewerType]
        );

        if (toDeliver.length > 0) {
            await db.query(
                `UPDATE messages SET status = 'delivered',
                     delivered_at = IF(delivered_at IS NULL, NOW(), delivered_at)
                 WHERE conversation_id = ? AND sender_type <> ?
                   AND (status IS NULL OR status = 'sent')`,
                [conversationId, viewerType]
            );
            const ids = toDeliver.map((m) => Number(m.id));
            // Émet vers toute la room → le client reçoit et met à jour ses spans
            emitMessageStatusUpdate(conversationId, 'delivered', ids);
        }

        // Retourner TOUS les IDs déjà delivered/read pour sync DOM au rechargement
        const [allDelivered] = await db.query(
            `SELECT id FROM messages
             WHERE conversation_id = ? AND sender_type <> ?
               AND status IN ('delivered', 'read')`,
            [conversationId, viewerType]
        );

        res.json({
            success: true,
            updated: toDeliver.length,
            status: 'delivered',
            messageIds: allDelivered.map((m) => Number(m.id))
        });
    } catch (error) {
        console.error('Erreur markDelivered:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// MARQUER LES MESSAGES COMME "READ"
// ============================================
//
//  viewerType='admin'  → admin lit → marque msgs CLIENT read
//                      → socket → client voit "Vu" ✅
//
//  viewerType='client' → client ouvre widget → marque msgs ADMIN read
//                      → socket → admin voit "Vu" sur ses propres msgs ✅
//
exports.markRead = async (req, res) => {
    try {
        const conversationId = req.params.id;
        const { viewerType } = req.body;

        if (!conversationId || !viewerType) {
            return res.status(400).json({ success: false, message: 'conversationId et viewerType requis' });
        }

        const [toRead] = await db.query(
            `SELECT id FROM messages
             WHERE conversation_id = ? AND sender_type <> ?
               AND (status IS NULL OR status <> 'read')`,
            [conversationId, viewerType]
        );

        if (toRead.length > 0) {
            await db.query(
                `UPDATE messages SET status = 'read',
                     read_at = IF(read_at IS NULL, NOW(), read_at)
                 WHERE conversation_id = ? AND sender_type <> ?
                   AND (status IS NULL OR status <> 'read')`,
                [conversationId, viewerType]
            );
            const ids = toRead.map((m) => Number(m.id));
            emitMessageStatusUpdate(conversationId, 'read', ids);
        }

        // Retourner TOUS les IDs read pour sync DOM complète
        const [allRead] = await db.query(
            `SELECT id FROM messages
             WHERE conversation_id = ? AND sender_type <> ?
               AND status = 'read'`,
            [conversationId, viewerType]
        );

        res.json({
            success: true,
            updated: toRead.length,
            status: 'read',
            messageIds: allRead.map((m) => Number(m.id))
        });
    } catch (error) {
        console.error('Erreur markRead:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// SUPPRIMER UN MESSAGE
// ============================================
exports.deleteMessage = async (req, res) => {
    try {
        const messageId = req.params.id;
        const [existing] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);

        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Message non trouvé' });
        }

        await db.query('DELETE FROM messages WHERE id = ?', [messageId]);

        if (global.io) {
            global.io.to(`conv-${existing[0].conversation_id}`).emit('message_deleted', {
                messageId: Number(messageId),
                conversationId: existing[0].conversation_id
            });
        }

        res.json({ success: true, message: 'Message supprimé' });
    } catch (error) {
        console.error('Erreur deleteMessage:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// SUPPRIMER UNE CONVERSATION (ADMIN)
// ============================================
exports.deleteConversation = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const conversationId = req.params.id;

        const [exists] = await connection.query(
            'SELECT id FROM conversations WHERE id = ? LIMIT 1',
            [conversationId]
        );
        if (!exists.length) {
            return res.status(404).json({ success: false, message: 'Conversation introuvable' });
        }

        await connection.query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
        await connection.query('DELETE FROM conversations WHERE id = ?', [conversationId]);
        await connection.commit();

        res.json({ success: true, message: 'Conversation supprimée' });
    } catch (error) {
        await connection.rollback();
        console.error('Erreur deleteConversation:', error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};