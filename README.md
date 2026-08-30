# MORA Shawiri — Nouveau site

> **Le Choix Optimal pour votre performance.**

Site officiel et plateforme digitale de **MORA Shawiri** (Moroni, Union des Comores).

## Stack technique

- **Next.js** (App Router) · **TypeScript** · **Tailwind CSS** (v4)
- **Supabase** (PostgreSQL, Auth, Storage, Row Level Security)
- Déploiement cible : **Vercel** (+ GitHub, Supabase)

## Structure du projet

```
app/(site)          → pages publiques (accueil, services, boutique, contact, …)
app/(site)/services → catalogue des 14 services (liste + fiches SSG)
components/         → composants UI & layout (design system MORA)
lib/config.ts       → configuration publique centralisée (marque, contacts, domaine)
lib/data/services.ts→ données réelles des 14 services (seed local)
lib/utils.ts        → utilitaires (cn, slugify, normalizeFileName)
lib/supabase/       → couche d'accès à Supabase (à venir)
supabase/migrations/→ migrations versionnées (à venir)
public/             → assets publics (logo, images services)
```

## Installation

```bash
npm install
cp .env.example .env.local   # renseigner les variables (jamais commité)
npm run dev                  # http://localhost:3000
```

## Variables d'environnement

Voir `.env.example`. Toute variable exposée au navigateur (`NEXT_PUBLIC_*`) est
**publique** ; les secrets (Service Role, SMTP, paiement…) restent **côté serveur**.
Le domaine (`NEXT_PUBLIC_SITE_URL`) n'est **jamais codé en dur** dans le code.

## Commandes

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production (typecheck inclus) |
| `npm start` | Serveur de production |
| `npm run lint` | Vérification ESLint |

## Règles clés du projet

- **Non-invention** : aucune donnée métier (prix, témoignage, chiffre) inventée. Seules les données documentées sont affichées.
- **Sécurité** : validation + authentification + autorisation côté serveur ; RLS ; jamais de secret dans le code/Git.
- **Paiement V1** : une déclaration de paiement client ≠ paiement confirmé (vérification admin).
- **Affiliation** : commission 10 % / 15 % / 20 % calculée côté serveur, `min(taux profil, plafond service)`.
- **Anti-reload** : aucun rechargement automatique sur `visibilitychange`/`focus`/`pageshow` ; contrôle utilisateur.
- **Design System** : palette officielle (Bleu #003366, Or #FFD700, Vert #00A859, Noir, Blanc, Gris #F2F2F2) ; logo non modifiable, cercle blanc conservé.

## Récapitulatif

- Version de référence : `1.0.0`
- Projet : `MORA_SHAWIRI_NOUVEAU_SITE`

*MORA Shawiri — Le Choix Optimal pour votre performance.*
