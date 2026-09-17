# Supabase — MORA Shawiri

Infrastructure de données de la plateforme. Ce dossier contient les migrations
versionnées ; les scripts qui les appliquent vivent dans `../scripts/`.

Règle fondatrice (`10_DEPLOIEMENT/00_SUPABASE.md` § 130) :

> Le code définit l'architecture, les migrations définissent l'évolution de la
> base, Supabase fournit l'infrastructure et les règles de sécurité garantissent
> l'accès aux données.

Rien ne se modifie durablement depuis l'interface graphique de Supabase sans
être répercuté dans une migration.

---

## Deux projets, jamais un seul

| Projet | Usage | Variables d'outillage |
|---|---|---|
| `mora-shawiri-dev` | développement, migrations, tests, données fictives | `SUPABASE_DEV_*` |
| `mora-shawiri-prod` | production, données réelles | `SUPABASE_PROD_*` |

La base de production ne sert jamais d'environnement de test (§ 48, § 114-115).

Deux mécanismes le garantissent :

1. **Côté application** — `src/lib/supabase/environment.ts` compare le contexte
   d'exécution (`VERCEL_ENV`) au projet déclaré (`NEXT_PUBLIC_SUPABASE_ENV`) et
   lève si les deux ne concordent pas. Un déploiement de prévisualisation ne
   peut donc pas atteindre la base de production.
2. **Côté outillage** — les scripts exigent `--env dev` ou `--env prod`, sans
   valeur par défaut, et refusent la production sans
   `--i-know-this-is-production`.

### Répartition des variables Vercel

| Cible Vercel | `NEXT_PUBLIC_SUPABASE_ENV` | Projet visé |
|---|---|---|
| Production | `prod` | `mora-shawiri-prod` |
| Preview | `dev` | `mora-shawiri-dev` |
| Development | `dev` | `mora-shawiri-dev` |

---

## Migrations

Nommage : `AAAAMMJJHHMMSS_description.sql`. L'ordre alphabétique est l'ordre
d'application.

```bash
# Ce qui serait appliqué, sans rien écrire
npm run db:migrate -- --env dev --dry-run

# Application réelle
npm run db:migrate -- --env dev

# Production, avec confirmation explicite
npm run db:migrate -- --env prod --i-know-this-is-production
```

Chaque migration est enregistrée dans `public.schema_migrations` avec
l'empreinte SHA-256 de son fichier. Modifier une migration déjà appliquée est
signalé comme **dérive** et n'est pas rejoué : il faut créer une nouvelle
migration.

Toutes les migrations sont rejouables — `create table if not exists`,
`drop policy if exists` avant chaque `create policy`, insertions idempotentes.
`tests/unit/migrations.test.ts` le vérifie automatiquement.

### État du schéma

| Migration | Contenu |
|---|---|
| `20260917120000_identite_et_rbac` | `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, fonctions d'autorisation, garde-fous, RLS |
| `20260917120100_systeme_parametres_et_audit` | `settings`, `audit_logs`, `rate_limit_counters`, RLS, paramètres initiaux |
| `20260917120200_seed_roles_et_permissions` | catalogue des 64 permissions, 4 rôles système, affectations |

---

## Provisionnement des administrateurs

Aucun compte n'est codé en dur, et le nombre d'administrateurs n'est pas
limité. La liste vient de `.env.local`, qui n'est jamais versionné :

```
ADMIN_SEED_USERNAMES=rachade
ADMIN_SEED_EMAIL_DOMAIN=morashawiri.com
ADMIN_SEED_RACHADE_PASSWORD=…
ADMIN_SEED_RACHADE_ROLE=SUPER_ADMIN
```

```bash
npm run db:provision -- --env dev --dry-run
npm run db:provision -- --env dev
```

Ce que le script garantit :

- le hachage est assuré par Supabase Auth — aucune table applicative ne stocke
  de mot de passe ;
- aucun mot de passe n'est affiché ni journalisé, même tronqué ;
- un compte déjà présent n'a jamais son mot de passe réécrit ;
- un mot de passe faible est **refusé**, sauf `--allow-weak-password` ;
- tout compte provisionné est marqué `must_change_password`.

Ajouter un administrateur plus tard ne demande aucune modification de code :
il suffit d'étendre `ADMIN_SEED_USERNAMES` et de fournir le mot de passe
correspondant — ou, à partir de la phase 4C, de le créer depuis
l'administration.

---

## Vérification de sécurité

```bash
npm run db:verify -- --env dev
npm run db:verify -- --env dev --admin rachade
```

Le script interroge la base comme le ferait un attaquant :

1. **Accès anonyme** — aucune table privée ne livre de ligne ; seuls les
   paramètres `PUBLIC` sont lisibles ; aucune écriture n'aboutit.
2. **Accès horizontal** — un compte client temporaire est créé, puis on vérifie
   qu'il ne voit ni le profil d'autrui, ni le catalogue des permissions, ni le
   journal d'audit. Le compte est supprimé à la fin.
3. **Accès vertical** — ce même compte ne peut ni s'attribuer `SUPER_ADMIN`, ni
   modifier son propre statut, ni écrire dans le journal d'audit.
4. **Compte administrateur** — permissions effectives, accès au journal,
   protection du dernier détenteur de `admin.full_access`.

Sur la production, seuls les contrôles anonymes en lecture sont exécutés :
aucun compte de test n'y est jamais créé.

---

## Architecture du contrôle d'accès

Trois barrières superposées, conformément au § 359 du rapport de phase 4 :

| Barrière | Fichier | Nature |
|---|---|---|
| Session | `src/lib/supabase/middleware.ts` | Confort de navigation — **jamais** une protection |
| Serveur | `src/lib/rbac/` | Contrôle réel : permission + propriété de la ressource |
| Base | politiques RLS | Dernier filet : une requête mal écrite n'expose rien |

Les fonctions d'autorisation (`public.has_permission`, `public.is_admin`,
`public.current_permissions`) sont `SECURITY DEFINER` avec `search_path` figé.
Ce choix remplace le contournement de RLS par la clé `service_role` que
pratiquait le socle précédent, identifié comme risque élevé par l'analyse de
phase 4.

La clé `service_role` reste réservée à trois usages : provisionnement,
compteurs de limitation de fréquence, tâches serveur sans utilisateur.

---

## Ce que la base ne contient jamais

- aucun mot de passe, même haché, dans une table applicative ;
- aucun secret dans `settings` — un déclencheur refuse les clés et valeurs qui
  y ressemblent ;
- aucun mot de passe, jeton ou secret dans `audit_logs` — même contrôle ;
- aucun taux commercial figé : les décisions D-1 à D-11 restent ouvertes.
