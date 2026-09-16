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

## 7. Déploiement

Le projet Vercel est relié au dépôt GitHub : tout `push` sur `main` déclenche un
déploiement de production. Les variables d'environnement de production sont
configurées dans Vercel, jamais dans le dépôt.
