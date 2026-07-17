# Foyer

PWA collaborative pour un foyer : liste de courses, recettes, calendrier, bac à sable de notes, synchronisés en temps réel entre les membres.

## Stack

- Frontend : HTML/CSS/JS vanilla (ES modules, aucun build tool)
- Backend : [Supabase](https://supabase.com) (Postgres + Auth + Realtime + RLS)

## Setup

1. **Configurer Supabase**
   - Créer un projet Supabase
   - Exécuter le script SQL fourni (tables + RLS + realtime) dans SQL Editor
   - Récupérer l'URL du projet et la clé `anon public` dans Settings → API

2. **Configurer le projet**
   - Ouvrir `js/supabase-client.js`
   - Remplacer `SUPABASE_ANON_KEY` par votre clé anon

3. **Icônes**
   - Ajouter `icons/icon-192.png` et `icons/icon-512.png` (logo de l'app)

## Déploiement (GitHub Pages)

1. Push ce dossier sur un repo GitHub
2. Repo → Settings → Pages → Source : branche `main`, dossier `/ (root)`
3. L'app est accessible à `https://<user>.github.io/<repo>/`
4. Sur Android : ouvrir l'URL dans Chrome → menu → "Ajouter à l'écran d'accueil"

## État du MVP

Fonctionnel :
- Auth (email/mot de passe)
- Création / rejoindre un foyer via code d'invitation
- Courses : ajout, coche, suppression, catégories, sync temps réel, historique
- Recettes : fiches texte libre (titre, ingrédients, préparation, notes)
- Calendrier : événements simples + anniversaires
- Notes : mur de post-its, archivage
- Préférences : notifications on/off, plage silencieuse
- Badges de nouveauté sur les onglets non consultés
- File d'attente offline (IndexedDB) pour les écritures sans connexion

Pas encore implémenté (V2) :
- "Souvent ajouté" basé sur `shopping_history`
- Vraies notifications Web Push envoyées depuis le serveur (nécessite une Edge Function planifiée + clés VAPID) — pour l'instant, `notifications.js` ne gère que les notifications locales pendant que l'app est ouverte
- Thème (clair/sombre)
- Rôles/permissions par membre
