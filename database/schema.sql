-- Création de la base
CREATE DATABASE IF NOT EXISTS roumauto_db;
USE roumauto_db;

-- ================= USERS =================
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom_complet VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  telephone VARCHAR(20),
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','employee') DEFAULT 'employee',
  statut ENUM('en_attente','approuve','refuse','suspendu') DEFAULT 'en_attente',
  date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_approbation TIMESTAMP NULL,
  approuve_par INT,
  derniere_connexion TIMESTAMP NULL,
  token_reset VARCHAR(255),
  token_reset_expire TIMESTAMP NULL,
  FOREIGN KEY (approuve_par) REFERENCES users(id) ON DELETE SET NULL
);

-- ================= CLIENTS =================
CREATE TABLE clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  telephone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(100),
  date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  est_client_fidele BOOLEAN DEFAULT FALSE,
  password VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================= SERVICES =================
CREATE TABLE services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom_service VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  prix DECIMAL(10,2) NOT NULL,
  description TEXT,
  actif BOOLEAN DEFAULT TRUE
);

-- ================= RESERVATIONS =================
CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL UNIQUE,
  client_id INT NOT NULL,
  modele_vehicule VARCHAR(100) NOT NULL,
  annee_vehicule INT NOT NULL,
  kilometrage INT,
  message_client TEXT,
  prix_base DECIMAL(10,2),
  remise DECIMAL(5,2) DEFAULT 0.00,
  prix_final DECIMAL(10,2),
  statut ENUM('Nouveau','En cours','Terminé','Annulé') DEFAULT 'Nouveau',
  date_reservation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_modification TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- ================= RESERVATION SERVICES =================
CREATE TABLE reservation_services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  service_id INT NOT NULL,
  prix_applique DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

-- ================= CONVERSATIONS =================
CREATE TABLE conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  subject VARCHAR(255),
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- ================= MESSAGES =================
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_type ENUM('client','admin') NOT NULL,
  message_text TEXT,
  message_type ENUM('text','image','audio','video') DEFAULT 'text',
  file_path VARCHAR(255),
  status ENUM('sent','delivered','read') DEFAULT 'sent',
  delivered_at DATETIME,
  read_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- ================= IMAGES =================
CREATE TABLE images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  nom_fichier VARCHAR(255) NOT NULL,
  chemin_fichier VARCHAR(500) NOT NULL,
  date_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);

-- ================= LOGS =================
CREATE TABLE logs_connexion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  action ENUM('connexion','deconnexion','tentative_echec') NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  date_action TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================= DEMANDES INSCRIPTION =================
CREATE TABLE demandes_inscription (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message_demande TEXT,
  statut ENUM('en_attente','approuve','refuse') DEFAULT 'en_attente',
  date_demande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_traitement TIMESTAMP NULL,
  traite_par INT,
  raison_refus TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (traite_par) REFERENCES users(id) ON DELETE SET NULL
);