# MORA Shawiri — Site vitrine

Site officiel de **MORA Shawiri**, agence digitale basée à Moroni (Union des Comores).
*Le Choix Optimal pour votre Performance.*

Production : <https://mora-shawiri-nouveau-site.vercel.app>

---

## 1. Stack

| Élément | Choix |
|---|---|
| Framework | Next.js 16 (App Router) |
| Langage | TypeScript, mode `strict` |
| Rendu | Statique (SSG) pour toutes les pages publiques |
| Styles | Feuille unique `src/styles/globals.css` — design system à variables CSS |
| Polices | `next/font` (Poppins, Inter) auto-hébergées |
| Images | `next/image` sur des sources WebP locales |
| E-mail | Nodemailer via une route serveur (`/api/contact`) |
| Hébergement | Vercel |

Aucune dépendance d'interface externe : les icônes sont des SVG inline et les
animations sont en CSS. Les seules dépendances de production sont `next`, `react`,
`react-dom` et `nodemailer`.

## 2. Démarrer

```bash
npm install
cp .env.example .env.local   # puis renseigner les valeurs
npm run dev                  # http://localhost:3000
```

Scripts disponibles :

```bash
npm run dev        # serveur de développement
npm run build      # build de production
npm run start      # sert le build de production
npm run lint       # ESLint (presets Next.js)
npm run typecheck  # TypeScript sans émission
```

## 3. Structure

```
src/
├─ app/                        Routes (App Router)
│  ├─ layout.tsx               En-tête, pied de page, polices, données structurées
│  ├─ page.tsx                 Accueil
│  ├─ qui-sommes-nous/         Présentation, mission, valeurs, méthode
│  ├─ services/                Six pôles d'expertise + formules
│  ├─ boutique/                Douze offres
│  ├─ affiliation/             Programme + simulateur de commissions
│  ├─ formation-prospection-relation-client/
│  ├─ blog/                    Index et articles (`blog/[slug]`)
│  ├─ contact/                 Formulaire de devis
│  ├─ rendez-vous/             Questionnaire de prise de rendez-vous
│  ├─ api/contact/route.ts     Réception serveur du formulaire (SMTP)
│  ├─ sitemap.ts · robots.ts · manifest.ts · not-found.tsx
├─ components/
│  ├─ layout/                  Header, Footer, Dock, modales légales
│  ├─ sections/                Blocs de page réutilisables
│  ├─ interactive/             Composants clients (formulaire, simulateur, RDV)
│  ├─ seo/                     Injection des données structurées
│  └─ ui/                      Jeu d'icônes, révélations au défilement
├─ content/                    Contenus éditoriaux typés (offres, articles, FAQ…)
├─ lib/                        Configuration publique, variables d'env., SEO
└─ styles/globals.css          Design system complet
```

Le contenu éditorial est séparé de la présentation : modifier un texte, une offre
ou un article se fait dans `src/content/` sans toucher aux composants.

## 4. Design system

Les jetons sont définis en haut de `src/styles/globals.css` :

| Rôle | Valeur |
|---|---|
| Bleu MORA | `#003366` |
| Or Shawiri | `#FFD700` |
| Vert croissance | `#00A859` |
| Titres | Poppins |
| Texte | Inter |
| Largeur de conteneur | 1320 px |
| Échelle d'espacement | multiples de 4 px |

## 5. Variables d'environnement

Voir `.env.example` pour la liste complète et commentée.

- `NEXT_PUBLIC_SITE_URL` — URL canonique du site (métadonnées, sitemap, robots).
- `SMTP_*` et `CONTACT_EMAIL` — envoi des demandes de devis, **côté serveur uniquement**.
- `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SECRET_KEY` — réservés aux phases ultérieures.

Règles appliquées :

- aucun secret dans le code source ni dans le bundle navigateur ;
- `.env`, `.env.local` et variantes ne sont jamais versionnés (voir `.gitignore`) ;
- `.env.example` ne contient que des placeholders ;
- une configuration SMTP absente n'empêche pas le site de fonctionner.

## 6. Accessibilité et performance

- Lien d'évitement, navigation clavier complète, focus visibles (contour or 3 px).
- Un seul `h1` par page, hiérarchie de titres sans saut de niveau.
- `prefers-reduced-motion` désactive animations et révélations.
- Images WebP dimensionnées, `priority` sur les visuels au-dessus de la ligne de flottaison.
- Polices auto-hébergées avec police de repli métriquement ajustée (pas de décalage).

## 7. Espaces privés — règle de densité

Trois univers visuels, trois feuilles, aucune dépendance croisée :

| Univers | Routes | Feuilles chargées | Portée des jetons |
|---|---|---|---|
| Public | `src/app/(site)/` | `globals.css` | `:root` |
| Administration | `src/app/(pilotage)/` | `globals.css` + `admin.css` | `.admin` |
| Comptes (authentification, Espace Client, futur Espace Affilié) | `src/app/(site)/(compte)/` | `globals.css` + `espace.css` + `auth.css` | `.espace` |

La densité d'un espace privé est **portée par les jetons**, jamais par une page :
`espace.css` redéfinit dans la portée `.espace` l'échelle typographique, les
espacements, les rayons, la hauteur des champs et des boutons. Les valeurs sont
alignées sur l'administration validée (corps 15 px, titre de carte 18 px), avec
deux différences assumées pour un public surtout mobile : champs et boutons à
44 px, texte saisi à 16 px (en deçà, Safari iOS agrandit la page au focus).

Règles pour tout nouvel écran privé (Affilié en 4H, modules Client en 4I) :

1. le placer dans `(compte)`, ou importer `espace.css` et poser `className="espace"` ;
2. composer avec `auth-card`, `auth-meta`, `auth-badge`, `espace-table`,
   `espace-timeline`, et les `.field` / `.btn` du design system ;
3. ne jamais utiliser une classe `admin-*` : `admin.css` n'est pas chargée hors
   de l'administration ;
4. ne fixer aucune taille dans une page — ajouter le jeton ou le composant
   manquant dans `espace.css`.

`tests/unit/espace-prive.test.ts` vérifie ces règles, et que les valeurs
partagées avec l'administration restent égales.

## 8. E-mails automatiques

Tout e-mail passe par le gabarit commun `src/lib/emails/layout.ts` :
`renderEmail()` reçoit des **blocs de contenu** (salutation, paragraphe,
récapitulatif, bouton d'action, lien de secours, mention de sécurité) et produit
la version HTML et la version texte. Identité MORA Shawiri, signature, rendu
mobile et échappement de toute saisie y sont décidés une fois pour toutes.

| E-mail | Source du contenu | Moteur d'envoi |
|---|---|---|
| Accusé de réception (devis, rendez-vous) | `src/lib/emails/templates.ts` | SMTP du site (Nodemailer) |
| Notification à l'équipe | `src/lib/emails/templates.ts` | SMTP du site |
| Invitation d'un administrateur | `src/lib/emails/invitation.ts` | SMTP du site |
| Confirmation d'inscription, réinitialisation du mot de passe | `src/lib/emails/auth.ts` | **Supabase Auth** |

Les deux modèles Supabase ne sont pas envoyés par le site : ils doivent être
déposés dans la configuration du projet avec `npm run auth:emails`, qui les
relit ensuite pour vérifier. Voir `supabase/README.md` — sur le plan Free,
Supabase refuse ce dépôt tant qu'aucun SMTP personnalisé n'est configuré.

Règles pour les phases suivantes, Affiliation (4H) et Espace Client (4I) :

- un nouvel e-mail = un module de contenu dans `src/lib/emails/`, rendu par
  `renderEmail()` ; aucun HTML d'e-mail dans une route ou une action ;
- français, objet suffixé « — MORA Shawiri » pour un destinataire externe ;
- un bouton d'action seulement si l'action existe, vers une route réelle,
  doublé du lien de secours ;
- aucun délai, taux ou montant qui ne soit une donnée réelle ;
- ajouter un envoi à un événement métier est une règle métier : décision du
  propriétaire, pas un détail d'implémentation.

## 9. Déploiement

Le projet Vercel est relié au dépôt GitHub : tout `push` sur `main` déclenche un
déploiement de production. Les variables d'environnement de production sont
configurées dans Vercel, jamais dans le dépôt.
