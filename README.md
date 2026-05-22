# Plateforme de Personnalisation Automobile

## Description
Projet web de personnalisation et réservation de véhicules développé avec Node.js, Express.js, MySQL et Socket.IO.

La plateforme permet aux utilisateurs :
- de consulter un catalogue de véhicules,
- personnaliser les modèles,
- communiquer avec les administrateurs via une messagerie instantanée.

Le système contient également un espace administrateur complet pour la gestion des véhicules, réservations et accès administrateurs.

---

# Technologies Utilisées

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

# Fonctionnalités Principales

##  Catalogue de véhicules
- Consultation des fiches techniques
- Interface utilisateur responsive
- Recherche et navigation dans les catégories

## Personnalisation des véhicules
- Choix de la couleur
- Sélection des jantes
- Packs sportifs
- Équipements technologiques
- Calcul du prix en temps réel
- Sauvegarde de configuration

## Messagerie instantanée
- Communication client/admin
- Assistance rapide
- Questions sur les réservations et personnalisations

## Réservations
- Demande de réservation
- Gestion des commandes
- Génération automatique des factures

## Système d’administration
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

# Sécurité

- Protection contre SQL Injection
- Validation côté serveur
- Gestion des sessions
- Middleware CORS
- Variables sensibles sécurisées avec `.env`
- Préparation HTTPS pour la production

---

# Notifications Automatiques

Le système envoie automatiquement :
- une facture électronique après validation d’une réservation,
- une notification au super administrateur lors d’une demande d’inscription administrateur.

---

# Installation

git clone https://github.com/nemicheroumaissa/RY-performance.git
cd RY-performance
npm install 

# Implémentation des Fonctionnalités Clés 

2.1 Catalogue de Véhicules et Interface Utilisateur 
La première étape d'implémentation a porté sur la gestion du catalogue de véhicules et la création de l'interface utilisateur dédiée aux clients. Cette interface permet de parcourir les modèles disponibles (berlines, SUV, sportives, utilitaires), d'accéder aux fiches techniques, de lancer le configurateur de personnalisation, d'effectuer une réservation, ainsi que de gérer son espace personnel. 
La conception suit une architecture client-serveur claire : le front-end en HTML5/CSS3/JavaScript communique avec le back-end Express.js via la Fetch API pour récupérer les données du catalogue depuis la base MySQL gérée sous XAMPP. Le configurateur utilise Socket.IO pour la mise à jour en temps réel du prix lors de la sélection des options, ainsi que Multer pour la gestion des images associées aux options de personnalisation.
Le module de personnalisation a été intégré sous forme d'un système d'options cumulatives (couleur carrosserie, sellerie, jantes, équipements technologiques, packs sportifs, etc.), permettant à l'utilisateur de visualiser le prix final en temps réel, de sauvegarder sa configuration et d'effectuer une demande de réservation ou d'achat. Un module de messagerie instantanée a également été intégré afin d'améliorer la communication entre les clients et les administrateurs. 

2 Espace d'Administration et Gestion des Réservations 

La deuxième phase d'implémentation s'est concentrée sur le back-office administrateur. Cette interface permet la gestion des véhicules, des options de personnalisation, des réservations clients, ainsi que des demandes d'accès des administrateurs. Le système repose sur deux niveaux d'administration : 
Administrateur principal : dispose d'un accès complet à toutes les fonctionnalités du système. Il peut gérer les réservations, consulter les statistiques, valider ou refuser les demandes d'inscription des nouveaux administrateurs, et attribuer les droits d'accès. 
Administrateur secondaire : possède un accès limité aux fonctionnalités standards comme la gestion des réservations et le suivi des clients, mais n'a pas accès à la page de gestion des demandes d'accès ni aux privilèges réservés à l'administrateur principal. 
Un système d'authentification sécurisé a été mis en place avec gestion des sessions et protection des routes API via des middlewares Express.js. Lorsqu'un nouvel administrateur s'inscrit sur la plateforme, son compte reste inactif jusqu'à validation manuelle par l'administrateur principal. Le tableau de bord affiche de manière synthétique les réservations en cours, les statistiques générales, les configurations les plus demandées ainsi que l'état du stock. 

3. Gestion et Sécurisation des Transactions et Communications
 
La sécurisation des transactions constitue un élément essentiel pour un site de personnalisation automobile. Les opérations de réservation et de commande garantissent la confidentialité et l'intégrité des données échangées. 
Le serveur Express.js effectue des validations côté serveur afin de prévenir les erreurs et les attaques de type SQL Injection. Le middleware CORS est configuré pour limiter les origines autorisées à communiquer avec l'API. Les données sensibles des utilisateurs (coordonnées, préférences de personnalisation, informations de réservation) sont stockées dans la base MySQL avec des accès contrôlés via phpMyAdmin. Les variables sensibles (identifiants, ports, clés secrètes) sont sécurisées dans le fichier .env grâce à dotenv et exclues du contrôle de version. 
Le système intègre également une gestion automatisée des courriers électroniques et des notifications selon deux cas principaux : 
Après validation d'une réservation ou d'un achat, une facture électronique est automatiquement envoyée au client par courrier électronique. 
Lorsqu'un nouvel administrateur effectue une demande d'inscription, une notification est envoyée à l'administrateur principal afin qu'il puisse accepter ou refuser la demande d'accès. 

Enfin, le protocole HTTPS sera activé en environnement de production afin de garantir le chiffrement complet de toutes les communications et d'assurer une sécurité optimale des échanges sur la plateforme. 

4. Illustrations Visuelles de l'Interface Utilisateur 

Les visuels ci-dessous présentent les principales interfaces destinées aux clients. Ils illustrent la page d'accueil, la consultation des services de personnalisation automobile, l'espace de réservation ainsi que le module de messagerie permettant la communication directe avec l'administration.
![Accueil](images/ch3f_image16.png)
4.1 Page d'Accueil 
ch3f_image16.png
