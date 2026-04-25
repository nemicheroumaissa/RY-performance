const db = require('./config/database');
const bcrypt = require('bcryptjs');

async function forceCreateAdmin() {
    console.log('=================================');
    console.log('🔧 CRÉATION FORCÉE ADMIN');
    console.log('=================================\n');
    
    try {
        // Supprimer tous les comptes admin existants
        console.log('🗑️  Suppression des anciens comptes admin...');
        await db.query('DELETE FROM users WHERE username = "admin" OR username = "Administrateur"');
        console.log('✅ Anciens comptes supprimés\n');
        
        // Créer un nouveau hash pour "admin123"
        console.log('🔐 Génération du hash pour "admin123"...');
        const hash = await bcrypt.hash('admin123', 10);
        console.log('✅ Hash généré:', hash.substring(0, 30) + '...\n');
        
        // Insérer le nouveau compte admin
        console.log('➕ Création du nouveau compte admin...');
        const [result] = await db.query(
            `INSERT INTO users (
                nom_complet, 
                email, 
                telephone,
                username, 
                password, 
                role, 
                statut, 
                date_approbation,
                date_inscription
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                'Administrateur',
                'nemicheroumaissa0@gmail.com',
                null,
                'admin',
                hash,
                'admin',
                'approuve'
            ]
        );
        
        console.log('✅ Compte admin créé avec succès !\n');
        console.log('=================================');
        console.log('📋 INFORMATIONS DE CONNEXION');
        console.log('=================================');
        console.log('ID créé:', result.insertId);
        console.log('Username: admin');
        console.log('Password: admin123');
        console.log('Role: admin');
        console.log('Statut: approuve');
        console.log('=================================\n');
        
        // Vérifier que le compte existe bien
        console.log('🔍 Vérification...');
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', ['admin']);
        
        if (users.length > 0) {
            const user = users[0];
            console.log('✅ Compte trouvé dans la base !');
            console.log('   ID:', user.id);
            console.log('   Nom:', user.nom_complet);
            console.log('   Email:', user.email);
            console.log('   Role:', user.role);
            console.log('   Statut:', user.statut);
            console.log('   Password (30 car):', user.password.substring(0, 30) + '...');
            
            // Test du mot de passe
            console.log('\n🔐 Test du mot de passe...');
            const isValid = await bcrypt.compare('admin123', user.password);
            
            if (isValid) {
                console.log('✅ Mot de passe VALIDE !');
                console.log('\n🎉 TOUT EST OK ! Vous pouvez maintenant vous connecter avec:');
                console.log('   Username: admin');
                console.log('   Password: admin123');
            } else {
                console.log('❌ Erreur : Le mot de passe ne correspond pas au hash !');
            }
        } else {
            console.log('❌ Erreur : Le compte n\'a pas été trouvé après insertion !');
        }
        
        console.log('\n=================================\n');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ ERREUR:', error.message);
        console.error('\nStack:', error.stack);
        process.exit(1);
    }
}

// Exécuter
forceCreateAdmin();