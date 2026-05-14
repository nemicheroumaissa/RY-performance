const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mailer = require('../utils/mailer');

function getAdminPanelUrl(req) {
    const fromAdminPanel = String(process.env.ADMIN_PANEL_URL || '').trim();
    if (fromAdminPanel) return fromAdminPanel;
    const fromFrontend = String(process.env.FRONTEND_URL || '').trim();
    if (fromFrontend) return fromFrontend.replace(/\/+$/, '') + '/admin.html';
    const originHeader = String(req?.headers?.origin || '').trim();
    if (originHeader) return originHeader.replace(/\/+$/, '') + '/admin.html';
    const host = String(req?.headers?.host || '').trim();
    if (host) return `http://${host.replace(/\/+$/, '')}/admin.html`;
    return 'http://127.0.0.1:5500/admin.html';
}

// ============================================
// FONCTION POUR CRÉER UN ADMIN PAR DÉFAUT
// ============================================
async function createDefaultAdmin() {
    try {
        const [admins] = await db.query(
            'SELECT id FROM users WHERE username = ?', ['admin']
        );
        if (admins.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.query(
                `INSERT INTO users (nom_complet, email, username, password, role, statut, date_approbation) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                ['Administrateur', process.env.ADMIN_EMAIL, 'admin', hashedPassword, 'admin_principal', 'approuve']
            );
            console.log('✅ Admin par défaut créé');
        } else {
            console.log('ℹ️  Compte admin déjà existant');
        }
    } catch (error) {
        console.error('❌ Erreur création admin:', error);
    }
}

createDefaultAdmin();

// ============================================
// INSCRIPTION (SIGN UP)
// ============================================
exports.signup = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { nom_complet, email, telephone, username, password, message_demande } = req.body;

        if (!nom_complet || !email || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Tous les champs obligatoires doivent être remplis'
            });
        }

        const [existingUsers] = await connection.query(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cet email ou nom d\'utilisateur existe déjà'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await connection.query(
            `INSERT INTO users 
             (nom_complet, email, telephone, username, password, role, statut, message_demande) 
             VALUES (?, ?, ?, ?, ?, 'admin_secondaire', 'en_attente', ?)`,
            [nom_complet, email, telephone || null, username, hashedPassword, message_demande || null]
        );

        await connection.commit();

        try {
            const adminUrl = getAdminPanelUrl(req);
            const adminTo = mailer.getAdminNotificationEmail();
            if (!adminTo) {
                console.warn('⚠️  Demande d’accès enregistrée mais aucun destinataire admin (ADMIN_EMAIL / EMAIL_USER).');
            } else {
            await mailer.sendMail({
                to: adminTo,
                subject: '🔔 Nouvelle demande d\'inscription - RY Performance Admin',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #9b59b6;">Nouvelle demande d'inscription</h2>
                        <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0;">
                            <p><strong>Nom complet:</strong> ${nom_complet}</p>
                            <p><strong>Email:</strong> ${email}</p>
                            <p><strong>Téléphone:</strong> ${telephone || 'Non fourni'}</p>
                            <p><strong>Nom d'utilisateur:</strong> ${username}</p>
                            ${message_demande ? `<p><strong>Message:</strong> ${message_demande}</p>` : ''}
                        </div>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${adminUrl}" 
                               style="background: #9b59b6; color: white; padding: 15px 30px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block; 
                                      font-weight: bold; font-size: 16px;">
                                📋 Gérer les demandes
                            </a>
                        </div>
                        <p style="color: #888; font-size: 12px;">RY Performance — Système d'administration</p>
                    </div>
                `
            });
            console.log('✅ Email envoyé à l\'admin');
            }
        } catch (emailError) {
            console.error('❌ Erreur envoi email (demande d\'accès):', emailError.message || emailError);
        }

        res.status(201).json({
            success: true,
            message: 'Demande d\'inscription envoyée ! Vous recevrez une réponse par email une fois votre compte approuvé.'
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur inscription:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'inscription',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// ============================================
// CONNEXION (LOGIN)
// ============================================
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('🔐 Tentative de connexion:', username);

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Nom d\'utilisateur et mot de passe requis'
            });
        }

        const [users] = await db.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        console.log('👤 Utilisateurs trouvés:', users.length);

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Nom d\'utilisateur ou mot de passe incorrect'
            });
        }

        const user = users[0];
        console.log('📝 User ID:', user.id);
        console.log('📝 User statut:', user.statut);
        console.log('📝 User role:', user.role);

        if (user.statut === 'en_attente') {
            return res.status(403).json({
                success: false,
                message: 'Votre compte est en attente d\'approbation par l\'administrateur'
            });
        }

        if (user.statut === 'refuse') {
            return res.status(403).json({
                success: false,
                message: `Votre demande d'inscription a été refusée${user.raison_refus ? ' : ' + user.raison_refus : ''}`
            });
        }

        if (user.statut === 'suspendu') {
            return res.status(403).json({
                success: false,
                message: 'Votre compte a été suspendu. Contactez l\'administrateur.'
            });
        }

        console.log('🔑 Vérification du mot de passe...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log('✅ Mot de passe valide:', isPasswordValid);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Nom d\'utilisateur ou mot de passe incorrect'
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log('✅ Connexion réussie pour:', user.username);

        res.status(200).json({
            success: true,
            message: 'Connexion réussie',
            token,
            user: {
                id: user.id,
                nom_complet: user.nom_complet,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error('❌ Erreur connexion:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la connexion',
            error: error.message
        });
    }
};

// ============================================
// RÉCUPÉRER LES DEMANDES EN ATTENTE (ADMIN)
// ============================================
exports.getPendingRequests = async (req, res) => {
    try {
        const [requests] = await db.query(
            `SELECT 
                id, nom_complet, email, telephone, username,
                message_demande, statut,
                DATE_FORMAT(date_inscription, '%Y-%m-%dT%H:%i:%s') AS date_inscription,
                date_traitement, raison_refus
             FROM users 
             WHERE statut = 'en_attente' AND role = 'admin_secondaire'
             ORDER BY date_inscription DESC`
        );

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        console.error('❌ Erreur récupération demandes:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des demandes',
            error: error.message
        });
    }
};

// ============================================
// APPROUVER UN UTILISATEUR (ADMIN)
// ============================================
exports.approveUser = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { userId } = req.params;

        await connection.query(
            `UPDATE users 
             SET statut = 'approuve', 
                 date_approbation = NOW(), 
                 date_traitement = NOW()
             WHERE id = ?`,
            [userId]
        );

        const [users] = await connection.query(
            'SELECT nom_complet, email FROM users WHERE id = ?', [userId]
        );

        await connection.commit();

        if (users.length > 0) {
            try {
                const adminUrl = getAdminPanelUrl(req);
                await mailer.sendMail({
                    to: users[0].email,
                    subject: '✅ Votre compte RY Performance a été approuvé !',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #2ecc71;">Félicitations ${users[0].nom_complet} !</h2>
                            <p>Votre compte RY Performance Admin a été approuvé par l'administrateur.</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${adminUrl}" 
                                   style="background: #2ecc71; color: white; padding: 15px 30px; 
                                          text-decoration: none; border-radius: 5px; display: inline-block; 
                                          font-weight: bold; font-size: 16px;">
                                    🚀 Se connecter au panel admin
                                </a>
                            </div>
                            <p style="color: #888; font-size: 12px;">RY Performance — Système d'administration</p>
                        </div>
                    `
                });
                console.log('✅ Email d\'approbation envoyé');
            } catch (emailError) {
                console.error('❌ Erreur envoi email (approbation):', emailError.message || emailError);
            }
        }

        res.status(200).json({ success: true, message: 'Utilisateur approuvé avec succès' });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur approbation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'approbation',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// ============================================
// REFUSER UN UTILISATEUR (ADMIN)
// ============================================
exports.rejectUser = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const { userId } = req.params;
        const { raison } = req.body;

        await connection.query(
            `UPDATE users 
             SET statut = 'refuse',
                 date_traitement = NOW(),
                 raison_refus = ?
             WHERE id = ?`,
            [raison || null, userId]
        );

        const [users] = await connection.query(
            'SELECT nom_complet, email FROM users WHERE id = ?', [userId]
        );

        await connection.commit();

        if (users.length > 0) {
            try {
                await mailer.sendMail({
                    to: users[0].email,
                    subject: '❌ Votre demande d\'inscription a été refusée',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #e74c3c;">Demande refusée</h2>
                            <p>Bonjour ${users[0].nom_complet},</p>
                            <p>Malheureusement, votre demande d'accès au panel a été refusée.</p>
                            ${raison ? `<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
                                <strong>Raison:</strong> ${raison}
                            </div>` : ''}
                            <p>Pour plus d'informations, contactez l'administrateur à ${process.env.ADMIN_EMAIL}.</p>
                            <p style="color: #888; font-size: 12px;">RY Performance — Système d'administration</p>
                        </div>
                    `
                });
                console.log('✅ Email de refus envoyé');
            } catch (emailError) {
                console.error('❌ Erreur envoi email (refus):', emailError.message || emailError);
            }
        }

        res.status(200).json({ success: true, message: 'Utilisateur refusé' });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Erreur refus:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du refus',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// ============================================
// VÉRIFIER LE TOKEN
// ============================================
exports.verifyToken = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'Token manquant' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await db.query(
            'SELECT id, nom_complet, username, email, role, statut FROM users WHERE id = ?',
            [decoded.id]
        );

        if (users.length === 0 || users[0].statut !== 'approuve') {
            return res.status(401).json({ success: false, message: 'Token invalide' });
        }

        res.status(200).json({ success: true, user: users[0] });

    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Token invalide',
            error: error.message
        });
    }
};