#  Plateforme de Personnalisation Automobile

##  Description
Projet web de personnalisation et réservation de véhicules développé avec Node.js, Express.js, MySQL et Socket.IO.

La plateforme permet aux utilisateurs :
- de consulter un catalogue de véhicules,
- personnaliser les modèles,
- réserver ou acheter un véhicule,
- communiquer avec les administrateurs via une messagerie instantanée.

Le système contient également un espace administrateur complet pour la gestion des véhicules, réservations et accès administrateurs.

---

#  Technologies Utilisées

## Front-end
- HTML5
- CSS3
- JavaScript

## Back-end
- Node.js
- Express.js

## Base de données
- MySQL
- phpMyAdmin
- XAMPP

## Bibliothèques et outils
- Socket.IO
- Multer
- dotenv
- CORS

---

#  Fonctionnalités Principales

##  Catalogue de véhicules
- Affichage des véhicules disponibles
- Consultation des fiches techniques
- Interface utilisateur responsive
- Recherche et navigation dans les catégories

##  Personnalisation des véhicules
- Choix de la couleur
- Sélection des jantes
- Packs sportifs
- Équipements technologiques
- Calcul du prix en temps réel
- Sauvegarde de configuration

##  Messagerie instantanée
- Communication client/admin
- Assistance rapide
- Questions sur les réservations et personnalisations

##  Réservations
- Demande de réservation
- Gestion des commandes
- Génération automatique des factures

##  Système d’administration
### Administrateur principal
- Gestion complète du système
- Validation des nouveaux administrateurs
- Gestion des statistiques
- Attribution des droits

### Administrateur secondaire
- Gestion des réservations
- Suivi des clients
- Accès limité

---

#  Sécurité

- Protection contre SQL Injection
- Validation côté serveur
- Gestion des sessions
- Middleware CORS
- Variables sensibles sécurisées avec `.env`
- Préparation HTTPS pour la production

---


```bash
git clone https://github.com/TON-USERNAME/TON-REPO.git
cd TON-REPO
npm install
