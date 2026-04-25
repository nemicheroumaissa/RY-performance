const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// ============================================
// CONFIGURATION EMAIL
// ============================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// ============================================
// FONCTION POUR CRÉER UN ADMIN PAR DÉFAUT
// ============================================
async function createDefaultAdmin() {
    try {
        const [admins] = await db.query(
            'SELECT id FROM users WHERE username = ?',
            ['admin']
        );

        if (admins.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.query(
                `INSERT INTO users (nom_complet, email, username, password, role, statut, date_approbation) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                ['Administrateur', process.env.ADMIN_EMAIL, 'admin', hashedPassword, 'admin', 'approuve']
            );
            console.log('✅ Admin par défaut créé:');
            console.log('   Username: admin');
            console.log('   Password: admin123');
        } else {
            console.log('ℹ️  Compte admin déjà existant');
        }
    } catch (error) {
        console.error('❌ Erreur création admin:', error);
    }
}

// Créer l'admin au démarrage
createDefaultAdmin();

// ============================================
// INSCRIPTION (SIGN UP)
// ============================================
exports.signup = async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { nom_complet, email, telephone, username, password, message_demande } = req.body;

        // Validation
        if (!nom_complet || !email || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Tous les champs obligatoires doivent être remplis'
            });
        }

        // Vérifier si l'utilisateur existe déjà
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

        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        // Créer l'utilisateur
        const [userResult] = await connection.query(
            `INSERT INTO users (nom_complet, email, telephone, username, password, role, statut) 
             VALUES (?, ?, ?, ?, ?, 'employee', 'en_attente')`,
            [nom_complet, email, telephone || null, username, hashedPassword]
        );

        const userId = userResult.insertId;

        // Créer la demande d'inscription
        await connection.query(
            'INSERT INTO demandes_inscription (user_id, message_demande) VALUES (?, ?)',
            [userId, message_demande || null]
        );

        await connection.commit();

        // Envoyer un email à l'admin
        try {
            const adminUrl = 'http://127.0.0.1:5500/admin.html';
            
            const mailOptions = {
                from: process.env.EMAIL_FROM,
                to: process.env.ADMIN_EMAIL,
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
                        <p style="color: #888; font-size: 12px; margin-top: 20px;">
                            RY Performance — Système d'administration
                        </p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log('✅ Email envoyé à l\'admin');
        } catch (emailError) {
            console.error('❌ Erreur envoi email:', emailError);
        }

        res.status(201).json({
            success: true,
            message: 'Demande d\'inscription envoyée ! Vous recevrez une réponse par email une fois votre compte approuvé par l\'administrateur.'
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

        // Récupérer l'utilisateur
        const [users] = await db.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        console.log('👤 Utilisateurs trouvés:', users.length);

        if (users.length === 0) {
            console.log('❌ Aucun utilisateur trouvé');
            return res.status(401).json({
                success: false,
                message: 'Nom d\'utilisateur ou mot de passe incorrect'
            });
        }

        const user = users[0];
        console.log('📝 User ID:', user.id);
        console.log('📝 User statut:', user.statut);
        console.log('📝 User role:', user.role);

        // Vérifier le statut
        if (user.statut === 'en_attente') {
            console.log('⏳ Compte en attente');
            return res.status(403).json({
                success: false,
                message: 'Votre compte est en attente d\'approbation par l\'administrateur'
            });
        }

        if (user.statut === 'refuse') {
            console.log('❌ Compte refusé');
            return res.status(403).json({
                success: false,
                message: 'Votre demande d\'inscription a été refusée'
            });
        }

        if (user.statut === 'suspendu') {
            console.log('🚫 Compte suspendu');
            return res.status(403).json({
                success: false,
                message: 'Votre compte a été suspendu. Contactez l\'administrateur.'
            });
        }

        // Vérifier le mot de passe
        console.log('🔑 Vérification du mot de passe...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log('✅ Mot de passe valide:', isPasswordValid);

        if (!isPasswordValid) {
            try {
                await db.query(
                    'INSERT INTO logs_connexion (user_id, action, ip_address) VALUES (?, ?, ?)',
                    [user.id, 'tentative_echec', req.ip]
                );
            } catch (logError) {
                console.error('Erreur log:', logError);
            }

            console.log('❌ Mot de passe incorrect');
            return res.status(401).json({
                success: false,
                message: 'Nom d\'utilisateur ou mot de passe incorrect'
            });
        }

        // Générer le token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Mettre à jour la dernière connexion
        await db.query(
            'UPDATE users SET derniere_connexion = NOW() WHERE id = ?',
            [user.id]
        );

        // Logger la connexion
        try {
            await db.query(
                'INSERT INTO logs_connexion (user_id, action, ip_address) VALUES (?, ?, ?)',
                [user.id, 'connexion', req.ip]
            );
        } catch (logError) {
            console.error('Erreur log:', logError);
        }

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
        const [requests] = await db.query('SELECT * FROM vue_demandes_attente');

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
        const adminId = req.user.id;

        // Mettre à jour l'utilisateur
        await connection.query(
            `UPDATE users 
             SET statut = 'approuve', date_approbation = NOW(), approuve_par = ? 
             WHERE id = ?`,
            [adminId, userId]
        );

        // Mettre à jour la demande
        await connection.query(
            `UPDATE demandes_inscription 
             SET statut = 'approuve', date_traitement = NOW(), traite_par = ? 
             WHERE user_id = ? AND statut = 'en_attente'`,
            [adminId, userId]
        );

        // Récupérer les infos de l'utilisateur
        const [users] = await connection.query(
            'SELECT nom_complet, email FROM users WHERE id = ?',
            [userId]
        );

        await connection.commit();

        // Envoyer un email à l'utilisateur
        if (users.length > 0) {
            try {
                const adminUrl = 'http://127.0.0.1:5500/admin.html';
                
                const mailOptions = {
                    from: process.env.EMAIL_FROM,
                    to: users[0].email,
                    subject: '✅ Votre compte RY Performance a été approuvé !',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #2ecc71;">Félicitations ${users[0].nom_complet} !</h2>
                            <p>Votre compte RY Performance Admin a été approuvé par l'administrateur.</p>
                            <p>Vous pouvez maintenant vous connecter et accéder au panel d'administration.</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${adminUrl}" 
                                   style="background: #2ecc71; color: white; padding: 15px 30px; 
                                          text-decoration: none; border-radius: 5px; display: inline-block; 
                                          font-weight: bold; font-size: 16px;">
                                    🚀 Se connecter au panel admin
                                </a>
                            </div>
                            <p style="color: #888; font-size: 12px; margin-top: 20px;">
                                RY Performance — Système d'administration
                            </p>
                        </div>
                    `
                };

                await transporter.sendMail(mailOptions);
                console.log('✅ Email d\'approbation envoyé');
            } catch (emailError) {
                console.error('❌ Erreur envoi email:', emailError);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Utilisateur approuvé avec succès'
        });

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
        const adminId = req.user.id;

        // Mettre à jour l'utilisateur
        await connection.query(
            'UPDATE users SET statut = \'refuse\' WHERE id = ?',
            [userId]
        );

        // Mettre à jour la demande
        await connection.query(
            `UPDATE demandes_inscription 
             SET statut = 'refuse', date_traitement = NOW(), traite_par = ?, raison_refus = ? 
             WHERE user_id = ? AND statut = 'en_attente'`,
            [adminId, raison || null, userId]
        );

        // Récupérer les infos de l'utilisateur
        const [users] = await connection.query(
            'SELECT nom_complet, email FROM users WHERE id = ?',
            [userId]
        );

        await connection.commit();

        // Envoyer un email à l'utilisateur
        if (users.length > 0) {
            try {
                const mailOptions = {
                    from: process.env.EMAIL_FROM,
                    to: users[0].email,
                    subject: '❌ Votre demande d\'inscription a été refusée',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #e74c3c;">Demande refusée</h2>
                            <p>Bonjour ${users[0].nom_complet},</p>
                            <p>Malheureusement, votre demande d'accès au panel d'administration RY Performance a été refusée.</p>
                            ${raison ? `<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
                                <strong>Raison:</strong> ${raison}
                            </div>` : ''}
                            <p>Pour plus d'informations, contactez l'administrateur à ${process.env.ADMIN_EMAIL}.</p>
                            <p style="color: #888; font-size: 12px; margin-top: 20px;">
                                RY Performance — Système d'administration
                            </p>
                        </div>
                    `
                };

                await transporter.sendMail(mailOptions);
                console.log('✅ Email de refus envoyé');
            } catch (emailError) {
                console.error('❌ Erreur envoi email:', emailError);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Utilisateur refusé'
        });

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
            return res.status(401).json({
                success: false,
                message: 'Token manquant'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await db.query(
            'SELECT id, nom_complet, username, email, role, statut FROM users WHERE id = ?',
            [decoded.id]
        );

        if (users.length === 0 || users[0].statut !== 'approuve') {
            return res.status(401).json({
                success: false,
                message: 'Token invalide'
            });
        }

        res.status(200).json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Token invalide',
            error: error.message
        });
    }
};