-- =============================================================================
-- PHASE 4E-2 — GESTION DES CONTENUS  (`09_ADMINISTRATION/07_GESTION_CONTENUS.md`)
--
-- Le § 142 fixe la cible : « faire évoluer son site rapidement sans dépendre
-- d'une modification du code pour chaque changement éditorial, tout en
-- protégeant la structure, le design, le SEO, les performances et la cohérence
-- globale du site. »
--
-- Les deux moitiés de cette phrase tirent en sens contraire, et c'est tout le
-- problème de cette phase. La migration choisit donc un parti unique, dont
-- découle chaque table ci-dessous :
--
--   **le texte publié aujourd'hui reste en code et sert de valeur par défaut ;
--   la base ne fait que le surcharger.**
--
-- Conséquences, qui sont autant de garanties vérifiables :
--
--   * une table vide rend exactement le site d'aujourd'hui — le repli n'est
--     pas un chemin de secours exceptionnel, c'est le cas de base ;
--   * une panne Supabase rend exactement le site d'aujourd'hui ;
--   * la non-régression devient démontrable au lieu d'être promise : il suffit
--     de comparer le HTML servi base vide / base semée / base injoignable ;
--   * aucun contenu ne peut « manquer ». Il n'existe pas d'état où une page
--     s'affiche sans son titre parce qu'une ligne a été supprimée.
--
-- ## Décisions du propriétaire appliquées ici
--
--   * **D-20 = A** — « contenus nommés ». Les textes visibles (hero, en-têtes
--     de section, bandeaux d'appel à l'action) et les petites listes de
--     l'accueil deviennent administrables *un par un*, sous une clé stable. La
--     **structure des pages reste en code** : l'administration ne peut ni
--     ajouter, ni retirer, ni déplacer une section. C'est ce qui rend le § 126
--     (« la modification d'un contenu ne doit pas casser le design ») vrai par
--     construction plutôt que par vigilance.
--   * **D-21 = A** — les pages légales **restent en code**. Aucune table ici ne
--     les concerne. Trois raisons, toutes vérifiables : le module
--     `07_GESTION_CONTENUS` ne les mentionne nulle part (zéro occurrence de
--     « mentions », « légal », « CGV », « confidentialité », « cookies ») ;
--     la décision D-17 (forme juridique, immatriculation, hébergeur) est
--     encore ouverte, donc l'administration ne pourrait pas trancher ce qui
--     n'est pas fourni ; et `legalLinks` est lu par le `Footer`, présent dans
--     le layout racine — le rendre asynchrone imposerait une lecture en base
--     sur *toutes* les pages et la modification d'un composant gelé.
--   * **D-22 = A** — les 28 images existantes **restent servies localement** et
--     sont seulement inventoriées. Les déplacer vers Storage changerait chaque
--     `src` du HTML sur presque toutes les routes. Les nouveaux visuels, eux,
--     vont dans Storage et sont référençables sans déploiement — ce qui
--     satisfait le critère du plan (« le remplacement d'une image ne demande
--     aucune modification de code ») sans sacrifier la non-régression.
--
-- ## Ce que cette migration ne fait pas
--
--   * elle ne crée **aucune permission** : `content.view/create/update/delete/
--     publish` et `media.view/upload/update/delete` existent depuis 4A
--     (`20260917120200_seed_roles_et_permissions.sql` § 90-100). Le § 122
--     (non-duplication) et le point 13 du cadrage l'exigent ;
--   * elle ne crée **aucun second journal d'audit** : `record_audit_event` de
--     4A/4C est réutilisée telle quelle ;
--   * elle n'insère **aucun contenu**. La reprise est faite par
--     `scripts/seed-contenus.mjs`, qui *importe* les fichiers que le site lit
--     déjà, pour la même raison qu'en 4E-1 : recopier à la main introduirait
--     une apostrophe typographique ou un espace insécable différent, et la
--     comparaison de non-régression ne prouverait alors plus rien — elle
--     comparerait deux saisies. Le § 134 (non-invention) et le point 8 du
--     cadrage l'interdisent également ;
--   * elle ne touche **à aucune migration historique**, ni au catalogue 4E-1.
--
-- ## Le défaut de 4E-1 qu'il ne faut pas réintroduire
--
-- En 4E-1, un garde de publication déclaré `SECURITY DEFINER` n'a jamais rien
-- refusé : dans une telle fonction, `current_user` vaut le propriétaire
-- (`postgres`) quelle que soit la session appelante, si bien que
-- `is_privileged_db_role()` répondait « requête privilégiée » à tout le monde.
-- **Tout déclencheur de ce fichier qui interroge `is_privileged_db_role()` est
-- donc `SECURITY INVOKER`**, et un test unitaire interdit désormais la
-- combinaison inverse. Les fonctions d'audit, elles, restent `DEFINER` : elles
-- écrivent dans une table que la session n'a pas le droit d'atteindre, et ne
-- consultent pas `current_user`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. GARDE-FOU DE LECTURE ADMINISTRATIVE
--
-- La même question revient dans chaque politique : « cette session peut-elle
-- voir les contenus en entier, brouillons compris ? ». L'écrire une fois évite
-- qu'une politique dérive des autres au fil des phases — c'est le motif retenu
-- en 4E-1 avec `can_view_catalogue()`.
--
-- `stable` et non `immutable` : la réponse dépend de la session.
-- -----------------------------------------------------------------------------

create or replace function public.can_view_contenus()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('content.view');
$$;

comment on function public.can_view_contenus() is
  'Vrai si la session peut consulter les contenus complets, brouillons et archives compris.';

revoke execute on function public.can_view_contenus() from public, anon;
grant  execute on function public.can_view_contenus() to authenticated, service_role;


create or replace function public.can_view_medias()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('media.view')
      or public.has_permission('content.view');
$$;

comment on function public.can_view_medias() is
  'Vrai si la session peut consulter la médiathèque. content.view suffit : un rédacteur doit voir les visuels qu''il référence.';

revoke execute on function public.can_view_medias() from public, anon;
grant  execute on function public.can_view_medias() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. BLOCS ÉDITORIAUX NOMMÉS  (D-20 = A)
--
-- Une ligne = un bloc de texte visible, sous une clé stable (`accueil.hero`,
-- `faq.section.principale`, …). Le code porte la valeur d'aujourd'hui et la
-- liste des clés ; la base ne porte que les **surcharges**.
--
-- ## Pourquoi deux colonnes de valeurs et pas une colonne `status`
--
-- Le § 61 fait de la publication « une action explicite », et le catalogue des
-- permissions lui réserve `content.publish`. Trois états sont nécessaires :
-- « le code fait foi », « une surcharge est en ligne », « une modification
-- attend d'être publiée ». On pourrait les exprimer par une colonne `status`
-- à côté d'une seule valeur — mais alors le statut pourrait **contredire** la
-- donnée : une ligne `PUBLIE` sans valeur, ou `BROUILLON` avec une valeur déjà
-- servie au public. Ce genre d'incohérence ne se répare pas, il se constate
-- trop tard.
--
-- Deux colonnes rendent la contradiction impossible :
--
--   * `published_fields IS NULL`  → le public lit la valeur du code ;
--   * `published_fields NOT NULL` → le public lit la surcharge ;
--   * `draft_fields NOT NULL`     → une modification attend publication.
--
-- Le statut affiché en administration est donc **déduit**, jamais stocké.
--
-- Et la conséquence qui compte pour le point 14 du cadrage : écrire
-- `draft_fields` ne rend rien public. Un administrateur doté de
-- `content.update` seul ne peut pas mettre son texte en ligne, quelle que soit
-- la route empruntée — le § 5 le vérifie en base, pas dans l'interface.
--
-- ## Pourquoi `jsonb` et non une colonne par champ
--
-- Un hero porte `eyebrow/title/lead/proof`, un en-tête de section
-- `eyebrow/title/lead`, un bandeau `title/text/primaryLabel/whatsappMessage`,
-- une liste un tableau d'objets. Une colonne par champ donnerait une table
-- large et majoritairement vide, dont la moitié des contraintes ne
-- s'appliquerait qu'à un `kind`. Le `jsonb` garde la table lisible ; la forme,
-- elle, est validée **par clé** côté application, contre le registre du code
-- qui connaît déjà la forme attendue de chaque bloc.
--
-- `kind` reste stocké pour que la base refuse au moins les incohérences
-- grossières (un tableau là où un objet est attendu) sans dépendre de
-- l'application.
-- -----------------------------------------------------------------------------

create table if not exists public.content_blocks (
  id               uuid primary key default gen_random_uuid(),
  key              text not null,
  kind             text not null,
  page_slug        text not null,
  published_fields jsonb,
  draft_fields     jsonb,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint content_blocks_key_unique  unique (key),

  -- La clé est une adresse, pas un libellé : elle apparaît dans le code, dans
  -- l'administration et dans les journaux d'audit. La contraindre évite qu'un
  -- espace ou une majuscule rende deux clés visuellement identiques.
  constraint content_blocks_key_format
    check (key ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),

  constraint content_blocks_page_format
    check (page_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  constraint content_blocks_kind_valid
    check (kind in ('HERO', 'PAGE_HERO', 'SECTION', 'CTA', 'LIST')),

  -- Un bloc de texte porte un objet, une liste porte un tableau. C'est le seul
  -- contrôle de forme que la base peut faire seule, et il suffit à écarter une
  -- écriture manifestement fausse.
  constraint content_blocks_published_shape
    check (
      published_fields is null
      or (kind = 'LIST' and jsonb_typeof(published_fields) = 'array')
      or (kind <> 'LIST' and jsonb_typeof(published_fields) = 'object')
    ),

  constraint content_blocks_draft_shape
    check (
      draft_fields is null
      or (kind = 'LIST' and jsonb_typeof(draft_fields) = 'array')
      or (kind <> 'LIST' and jsonb_typeof(draft_fields) = 'object')
    ),

  -- Une ligne sans surcharge ni brouillon n'apporte rien : elle décrit
  -- exactement l'état « le code fait foi », qui est déjà l'absence de ligne.
  -- L'interdire évite une table qui grossit de lignes vides à chaque
  -- ouverture de formulaire.
  constraint content_blocks_not_empty
    check (published_fields is not null or draft_fields is not null),

  -- Un horodatage de publication sans publication serait un mensonge dans le
  -- journal comme dans l'interface.
  constraint content_blocks_published_at_coherent
    check (published_fields is not null or published_at is null)
);

comment on table public.content_blocks is
  'Surcharges des textes visibles du site (07_GESTION_CONTENUS § 10-14, § 80). Une ligne absente signifie « la valeur du code fait foi » : c''est l''état normal, pas une panne.';
comment on column public.content_blocks.key is
  'Adresse stable du bloc, déclarée au registre src/content/blocks.ts. Une clé inconnue du registre est ignorée par le rendu public.';
comment on column public.content_blocks.published_fields is
  'Surcharge réellement servie au public. NULL = la valeur du code est rendue.';
comment on column public.content_blocks.draft_fields is
  'Modification en attente. Écrire ici ne rend rien public : la mise en ligne exige content.publish (§ 61).';

create index if not exists content_blocks_page_idx
  on public.content_blocks (page_slug, key);

-- Le rendu public ne lit que les surcharges publiées : l'index partiel évite
-- de parcourir les brouillons à chaque régénération de page.
create index if not exists content_blocks_published_idx
  on public.content_blocks (key)
  where published_fields is not null;

drop trigger if exists content_blocks_set_updated_at on public.content_blocks;
create trigger content_blocks_set_updated_at
  before update on public.content_blocks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. FAQ — CATÉGORIES
--
-- Le § 46 demande une FAQ administrable, le § 47 une FAQ **par page**. Le site
-- en sert aujourd'hui trois jeux distincts, et non un jeu unique découpé :
-- les neuf catégories de `/faq/`, les quatre questions de l'accueil, les cinq
-- de `/services/`. `surface` les sépare sans dupliquer la table — sans quoi
-- « FAQ par page » obligerait soit à trois tables, soit à recopier des
-- questions d'une page à l'autre, ce que le § 122 interdit.
-- -----------------------------------------------------------------------------

create table if not exists public.faq_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  title      text not null,
  surface    text not null default 'FAQ',
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Deux surfaces peuvent légitimement porter une catégorie « Général » : le
  -- slug est donc unique **par surface**, pas globalement.
  constraint faq_categories_slug_unique  unique (surface, slug),
  constraint faq_categories_slug_format  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint faq_categories_title_present check (btrim(title) <> ''),
  constraint faq_categories_surface_valid check (surface in ('FAQ', 'ACCUEIL', 'SERVICES'))
);

comment on table public.faq_categories is
  'Regroupements de la FAQ (07_GESTION_CONTENUS § 46-47). `surface` distingue la page FAQ, la FAQ de l''accueil et celle des services.';
comment on column public.faq_categories.is_active is
  'Une catégorie désactivée retire ses questions de l''affichage public sans les supprimer (§ 45).';

create index if not exists faq_categories_surface_idx
  on public.faq_categories (surface, sort_order, slug);

drop trigger if exists faq_categories_set_updated_at on public.faq_categories;
create trigger faq_categories_set_updated_at
  before update on public.faq_categories
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. FAQ — QUESTIONS
--
-- Les quatre statuts sont ceux du § 60 et ceux déjà retenus par le catalogue
-- 4E-1 : une seule échelle de statuts pour tout le site, conformément au § 124
-- (règle de cohérence).
--
-- `question` et `answer` sont du **texte brut**, délibérément. Les 45 réponses
-- reprises n'en contiennent aucun balisage, et le composant `Faq` les rend
-- dans un `<details>`/`<summary>` sans interprétation. Introduire un format
-- riche ici créerait une surface XSS pour un besoin qui n'existe pas (§ 98).
-- -----------------------------------------------------------------------------

create table if not exists public.faq_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.faq_categories (id) on delete restrict,
  question     text not null,
  answer       text not null,
  sort_order   integer not null default 0,
  status       text not null default 'BROUILLON',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint faq_items_question_present check (btrim(question) <> ''),
  constraint faq_items_status_valid
    check (status in ('BROUILLON', 'PUBLIE', 'NON_PUBLIE', 'ARCHIVE')),

  -- Le compilateur garantissait jusqu'ici qu'une question affichée avait une
  -- réponse. En rendant la FAQ modifiable en ligne on retire cette garantie :
  -- il faut la remplacer, sans quoi la phase rendrait le site plus fragile
  -- qu'avant. C'est le même raisonnement que `services_publiable` en 4E-1.
  constraint faq_items_publiable
    check (status <> 'PUBLIE' or btrim(answer) <> '')
);

comment on table public.faq_items is
  'Questions fréquentes (07_GESTION_CONTENUS § 46). Une ligne PUBLIE dans une catégorie active est lisible publiquement ; tout autre statut ne l''est pas.';
comment on column public.faq_items.answer is
  'Texte brut, sans balisage. Le rendu ne l''interprète pas : aucune surface XSS (§ 98).';

create index if not exists faq_items_public_idx
  on public.faq_items (category_id, sort_order)
  where status = 'PUBLIE';

create index if not exists faq_items_category_idx
  on public.faq_items (category_id, sort_order);

drop trigger if exists faq_items_set_updated_at on public.faq_items;
create trigger faq_items_set_updated_at
  before update on public.faq_items
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. BLOG — ARTICLES
--
-- Le module `07_GESTION_CONTENUS` ne mentionne **jamais** le blog : zéro
-- occurrence dans ses 2 894 lignes. Il est traité ici sur l'autorité du plan
-- de développement (« reprise des données de `src/content/*.ts` vers la
-- base ») et du point 9 du cadrage, non sur celle du module — et le périmètre
-- est donc exactement celui que le point 9 énumère : articles, statut,
-- publication, slug, auteur, dates, contenu, SEO, médias.
--
-- ## `body jsonb` : pourquoi ce n'est pas un choix de commodité
--
-- Le corps des quatre articles existants est **déjà** une suite de blocs
-- typés (`src/content/article-bodies.ts` : `h2`/`h3`/`p`/`ul`/`note`, avec des
-- segments `{b}`/`{i}`), rendue par `ArticleBody.tsx` sans jamais appeler
-- `dangerouslySetInnerHTML`. Ce format satisfait mot pour mot le § 13
-- (« paragraphes, gras, italique, listes, liens, citations… l'éditeur ne doit
-- pas permettre d'insérer du code dangereux ») et le § 100 (JavaScript
-- interdit par défaut).
--
-- Le stocker tel quel en `jsonb` conserve donc trois propriétés à la fois :
-- la fidélité (aucune conversion, donc aucune perte), la sécurité (**aucune
-- balise n'est jamais interprétée : la surface XSS est nulle par construction,
-- pas par filtrage**) et le SEO (la hiérarchie `h2`/`h3` reste produite par le
-- code). Passer par du HTML ou du Markdown aurait imposé un assainisseur —
-- c'est-à-dire une liste de choses interdites, qu'il faut maintenir et qui
-- finit toujours par oublier un cas.
--
-- `author` existe parce que le point 9 le demande. Il porte aujourd'hui la
-- même valeur pour les quatre articles ; aucune signature n'a été inventée.
-- -----------------------------------------------------------------------------

create table if not exists public.content_posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  category        text not null,
  title           text not null,
  lead            text not null,
  excerpt         text not null,
  author          text,
  published_on    date,
  date_label      text,
  reading_time    text,
  cover_path      text,
  cover_width     integer,
  cover_height    integer,
  cta_title       text,
  cta_text        text,
  cta_label       text,
  cta_href        text,
  related         text[] not null default '{}',
  body            jsonb  not null default '[]'::jsonb,
  seo_title       text,
  seo_description text,
  sort_order      integer not null default 0,
  status          text not null default 'BROUILLON',
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint content_posts_slug_unique unique (slug),
  constraint content_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint content_posts_status_valid
    check (status in ('BROUILLON', 'PUBLIE', 'NON_PUBLIE', 'ARCHIVE')),
  constraint content_posts_body_is_array
    check (jsonb_typeof(body) = 'array'),

  -- Remplacement de la garantie du compilateur, comme pour la FAQ. Un article
  -- publié sans titre, sans accroche, sans résumé ou sans corps produirait une
  -- page vide et une fiche de partage vide — et le § 70 exige un SEO préservé.
  -- Le visuel est exigé lui aussi : la carte du fil le rend systématiquement.
  constraint content_posts_publiable
    check (
      status <> 'PUBLIE'
      or (
        btrim(title) <> ''
        and btrim(lead) <> ''
        and btrim(excerpt) <> ''
        and jsonb_array_length(body) > 0
        and cover_path is not null
        and published_on is not null
      )
    ),

  -- Un article ne peut pas se suggérer lui-même (`related` alimente « à lire
  -- ensuite »). Une boucle sur soi produirait un lien vers la page courante.
  constraint content_posts_related_excludes_self
    check (not (slug = any (related)))
);

comment on table public.content_posts is
  'Articles du blog. Corps stocké en blocs typés (jsonb) et non en HTML : aucune balise n''est interprétée au rendu, donc aucune surface XSS (§ 98, § 100).';
comment on column public.content_posts.body is
  'Suite de blocs typés, au format de src/content/article-bodies.ts. Validé à la lecture : un bloc de type inconnu est écarté plutôt que rendu.';
comment on column public.content_posts.related is
  'Slugs des articles suggérés. Un slug obsolète est simplement ignoré au rendu (aucune clé étrangère : la suggestion est éditoriale, pas structurelle).';

create index if not exists content_posts_public_idx
  on public.content_posts (published_on desc, sort_order)
  where status = 'PUBLIE';

drop trigger if exists content_posts_set_updated_at on public.content_posts;
create trigger content_posts_set_updated_at
  before update on public.content_posts
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. MÉDIATHÈQUE  (D-22 = A)
--
-- Le § 32 demande une médiathèque, le § 37 de savoir si un média est utilisé,
-- le § 24 de pouvoir identifier une image, les § 25-27 son texte alternatif et
-- son caractère décoratif.
--
-- `kind` porte la décision D-22 :
--
--   * `LOCAL`   — les 28 fichiers de `public/images`, servis par Next.js comme
--     aujourd'hui. Inventoriés pour être **nommés, décrits et référencés**,
--     mais pas déplacés : changer leur adresse modifierait le `src` de presque
--     toutes les routes du site, donc le HTML servi.
--   * `STORAGE` — les visuels téléversés depuis l'administration, dans le
--     bucket `contenus-medias`. C'est ce qui rend vrai le critère du plan
--     « le remplacement d'une image ne demande aucune modification de code ».
--
-- Les deux vivent dans la même table parce que l'administration doit présenter
-- **une** médiathèque (§ 32) : deux tables obligeraient chaque écran à réunir
-- deux sources et à traiter deux fois la recherche du § 33.
-- -----------------------------------------------------------------------------

create table if not exists public.media_assets (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  bucket        text,
  path          text not null,
  title         text not null,
  alt_text      text,
  description   text,
  category      text,
  mime_type     text,
  byte_size     bigint,
  width         integer,
  height        integer,
  is_decorative boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint media_assets_path_unique unique (kind, path),
  constraint media_assets_kind_valid  check (kind in ('LOCAL', 'STORAGE')),
  constraint media_assets_title_present check (btrim(title) <> ''),

  -- Un média Storage sans bucket serait introuvable ; un média local avec
  -- bucket serait ambigu. Les deux formes sont donc closes.
  constraint media_assets_bucket_coherent
    check ((kind = 'STORAGE' and bucket is not null) or (kind = 'LOCAL' and bucket is null)),

  -- Le § 29 exige de se protéger du path traversal, et le § 30 de normaliser.
  -- Un chemin local est une adresse publique sous `/images/` ; un chemin
  -- Storage est relatif. Aucun des deux ne peut contenir « .. », de barre
  -- double, ni de caractère hors du jeu autorisé.
  constraint media_assets_local_path_format
    check (kind <> 'LOCAL' or path ~ '^/images/[A-Za-z0-9._-]+$'),

  constraint media_assets_storage_path_format
    check (
      kind <> 'STORAGE'
      or (path ~ '^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]+$' and path !~ '\.\.' and path !~ '//')
    ),

  -- Le § 37 du document Stockage interdit les extensions exécutables, le § 40
  -- traite le SVG comme du contenu actif, le § 41 le HTML, le § 42 le
  -- JavaScript. La liste est donc **fermée** : ce qui n'y figure pas est
  -- refusé, plutôt que de tenir à jour une liste d'interdits. Le SVG n'y est
  -- volontairement pas — il peut porter du script, et aucun besoin du site ne
  -- l'exige aujourd'hui.
  constraint media_assets_mime_allowed
    check (
      mime_type is null
      or mime_type in (
        'image/webp',
        'image/avif',
        'image/png',
        'image/jpeg',
        'application/pdf'
      )
    ),

  -- Le § 33 demande une limite adaptée par type. 10 Mio couvre largement un
  -- visuel de page et reste refusable côté Storage aussi (voir § 8 ci-dessous),
  -- de sorte que la limite existe des deux côtés.
  constraint media_assets_size_sane
    check (byte_size is null or (byte_size > 0 and byte_size <= 10485760)),

  constraint media_assets_dimensions_sane
    check (
      (width is null or width between 1 and 20000)
      and (height is null or height between 1 and 20000)
    ),

  -- Le § 26 impose un texte alternatif, le § 27 admet l'image purement
  -- décorative. Les deux ensemble se contredisent : une image décorative doit
  -- porter un `alt` **vide**, pas un `alt` descriptif, sans quoi un lecteur
  -- d'écran annonce un ornement. La contrainte rend l'incohérence impossible.
  constraint media_assets_decorative_has_no_alt
    check (not is_decorative or alt_text is null)
);

comment on table public.media_assets is
  'Médiathèque (07_GESTION_CONTENUS § 32-37). LOCAL inventorie les fichiers servis par Next.js sans les déplacer ; STORAGE porte les visuels téléversés depuis l''administration (D-22 = A).';
comment on column public.media_assets.is_decorative is
  'Image purement décorative (§ 27) : rendue avec un texte alternatif vide, jamais avec une description.';
comment on column public.media_assets.mime_type is
  'Type autorisé, liste fermée. Le SVG est exclu : il peut porter du script (Stockage § 40).';

create index if not exists media_assets_kind_idx     on public.media_assets (kind, created_at desc);
create index if not exists media_assets_category_idx on public.media_assets (category, title);

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 7. PUBLIER N'EST PAS MODIFIER
--
-- Le point 13 du cadrage : « Un ADMIN qui peut modifier un brouillon ne doit
-- pas automatiquement pouvoir le publier ». Une politique RLS ne sait pas
-- l'exprimer : elle juge **une ligne**, pas **une transition**. Le contrôle est
-- donc posé en déclencheur, où l'ancienne et la nouvelle valeur coexistent.
--
-- ** SECURITY INVOKER — c'est le défaut corrigé en 4E-1. ** En DEFINER,
-- `current_user` vaudrait `postgres` pour toute session, `is_privileged_db_role()`
-- répondrait « privilégié » à tout le monde, et ce garde n'aurait jamais rien
-- refusé. En INVOKER il voit le rôle réel : `authenticated` pour une session,
-- `service_role` pour un script, `postgres` pour une migration.
-- -----------------------------------------------------------------------------

create or replace function public.tg_contenus_publication_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_becomes_public boolean;
  v_leaves_public  boolean;
begin
  if tg_table_name = 'content_blocks' then
    -- Pour un bloc, « devenir public » couvre aussi bien la première
    -- surcharge que la modification d'une surcharge déjà en ligne : les deux
    -- changent ce que le visiteur lit.
    if tg_op = 'INSERT' then
      v_becomes_public := new.published_fields is not null;
      v_leaves_public  := false;
    else
      v_becomes_public := new.published_fields is not null
                          and new.published_fields is distinct from old.published_fields;
      v_leaves_public  := old.published_fields is not null
                          and new.published_fields is null;
    end if;

    if v_becomes_public then
      new.published_at := coalesce(new.published_at, now());
    elsif v_leaves_public then
      -- Retour à la valeur du code : l'horodatage de publication n'a plus
      -- d'objet et le laisser laisserait croire qu'une surcharge est en ligne.
      new.published_at := null;
    end if;

  else
    -- FAQ et articles : la transition se lit sur `status`, comme en 4E-1.
    if tg_op = 'INSERT' then
      v_becomes_public := new.status = 'PUBLIE';
      v_leaves_public  := false;
    else
      v_becomes_public := new.status = 'PUBLIE' and old.status <> 'PUBLIE';
      v_leaves_public  := old.status = 'PUBLIE' and new.status <> 'PUBLIE';
    end if;

    if v_becomes_public then
      new.published_at := coalesce(new.published_at, now());
    end if;
  end if;

  -- Une migration ou un script serveur ne représente pas un utilisateur : lui
  -- imposer une permission de session n'aurait aucun sens.
  if (v_becomes_public or v_leaves_public) and not public.is_privileged_db_role() then
    if not public.has_permission('content.publish') then
      raise exception 'Publication refusée : permission content.publish requise.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_contenus_publication_guard() is
  'Exige content.publish pour toute mise en ligne ou retrait d''un contenu, et horodate la publication. SECURITY INVOKER : en DEFINER, is_privileged_db_role() ne refuserait jamais rien (défaut corrigé en 4E-1).';

drop trigger if exists content_blocks_publication_guard on public.content_blocks;
create trigger content_blocks_publication_guard
  before insert or update on public.content_blocks
  for each row execute function public.tg_contenus_publication_guard();

drop trigger if exists faq_items_publication_guard on public.faq_items;
create trigger faq_items_publication_guard
  before insert or update on public.faq_items
  for each row execute function public.tg_contenus_publication_guard();

drop trigger if exists content_posts_publication_guard on public.content_posts;
create trigger content_posts_publication_guard
  before insert or update on public.content_posts
  for each row execute function public.tg_contenus_publication_guard();


-- -----------------------------------------------------------------------------
-- 7 bis. RETIRER UNE SURCHARGE EST UN RETRAIT PUBLIC
--
-- Revenir à la valeur du code change ce que lit le visiteur, exactement comme
-- une dépublication. Ce retour s'opère en **supprimant la ligne** — et non en
-- vidant ses deux colonnes, que la contrainte `content_blocks_not_empty`
-- refuse, puisqu'une ligne sans surcharge ni brouillon décrit précisément
-- l'état « le code fait foi », c'est-à-dire l'absence de ligne.
--
-- Or le garde du § 7 ne voit pas les DELETE : sans ce second garde, un compte
-- doté de `content.delete` mais **non** de `content.publish` pourrait retirer
-- un texte du site en supprimant sa ligne. C'est le contournement que le point
-- 13 du cadrage interdit, et il ne se voit pas dans une politique RLS, qui juge
-- une ligne et non l'effet public de sa disparition.
--
-- La règle posée ici est donc :
--
--   * supprimer une ligne **en ligne** (`published_fields` non nul) exige
--     `content.publish` — c'est un retrait de contenu public ;
--   * supprimer une ligne **de brouillon seul** n'exige rien de plus que la
--     politique RLS : abandonner une modification non publiée est une
--     modification, pas une publication.
--
-- `SECURITY INVOKER`, pour la raison rappelée en tête de fichier.
-- -----------------------------------------------------------------------------

create or replace function public.tg_content_blocks_delete_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.published_fields is not null and not public.is_privileged_db_role() then
    if not public.has_permission('content.publish') then
      raise exception
        'Retrait refusé : remettre ce contenu à sa valeur d''origine exige la permission content.publish.'
        using errcode = '42501';
    end if;
  end if;

  return old;
end;
$$;

comment on function public.tg_content_blocks_delete_guard() is
  'Exige content.publish pour supprimer une surcharge en ligne — la suppression étant le chemin du retour à la valeur du code, donc un retrait public.';

drop trigger if exists content_blocks_delete_guard on public.content_blocks;
create trigger content_blocks_delete_guard
  before delete on public.content_blocks
  for each row execute function public.tg_content_blocks_delete_guard();


-- -----------------------------------------------------------------------------
-- 8. SUPPRESSION — CE QUI A ÉTÉ PUBLIÉ S'ARCHIVE
--
-- Le § 69 et le § 131 traitent la suppression comme une opération à part, et
-- le § 112 lui oppose la dépublication. Un article déjà publié a pu être
-- partagé, indexé, cité : l'effacer casse une URL et laisse une 404 là où le
-- § 74 demande une redirection. Il s'archive donc, exactement comme une offre
-- du catalogue en 4E-1 (§ 78).
--
-- Un brouillon jamais publié, lui, se supprime : il n'a jamais eu d'adresse
-- publique. `published_at` est le témoin fiable de cette distinction — le
-- statut courant ne l'est pas, puisqu'un article dépublié repasse en
-- `NON_PUBLIE`.
-- -----------------------------------------------------------------------------

create or replace function public.tg_contenus_no_delete_when_published()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.published_at is not null and not public.is_privileged_db_role() then
    raise exception
      'Suppression refusée : ce contenu a déjà été publié. Dépubliez-le ou archivez-le (§ 69, § 112).'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function public.tg_contenus_no_delete_when_published() is
  'Interdit la suppression d''un contenu ayant déjà été publié : il s''archive (§ 69, § 78, § 112). Un brouillon jamais publié reste supprimable.';

drop trigger if exists content_posts_no_delete_when_published on public.content_posts;
create trigger content_posts_no_delete_when_published
  before delete on public.content_posts
  for each row execute function public.tg_contenus_no_delete_when_published();

drop trigger if exists faq_items_no_delete_when_published on public.faq_items;
create trigger faq_items_no_delete_when_published
  before delete on public.faq_items
  for each row execute function public.tg_contenus_no_delete_when_published();


-- -----------------------------------------------------------------------------
-- 9. DÉSACTIVER UNE CATÉGORIE QUI PORTE ENCORE DES QUESTIONS PUBLIÉES
--
-- Même motif qu'en 4E-1 pour les catégories du catalogue : la désactivation
-- retirerait les questions du site sans que personne l'ait demandé
-- explicitement. Le § 45 veut une activation consciente, pas un effet de bord.
-- -----------------------------------------------------------------------------

create or replace function public.tg_faq_categories_deactivation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_published integer;
begin
  if old.is_active = true and new.is_active = false then
    select count(*) into v_published
      from public.faq_items
     where category_id = new.id
       and status = 'PUBLIE';

    if v_published > 0 then
      raise exception
        'Désactivation refusée : % question(s) publiée(s) dans cette catégorie. Dépubliez-les d''abord (§ 45).',
        v_published
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_faq_categories_deactivation_guard() is
  'Refuse la désactivation d''une catégorie portant encore des questions publiées, pour qu''un retrait du site reste une décision explicite.';

drop trigger if exists faq_categories_deactivation_guard on public.faq_categories;
create trigger faq_categories_deactivation_guard
  before update on public.faq_categories
  for each row execute function public.tg_faq_categories_deactivation_guard();


-- -----------------------------------------------------------------------------
-- 10. AUDIT — LE JOURNAL DE 4A/4C, RÉUTILISÉ TEL QUEL
--
-- Le § 115 et le § 133 exigent une traçabilité ; le point 16 du cadrage
-- interdit un second journal. `record_audit_event` est donc appelée sans
-- adaptation.
--
-- La trace est prise **par déclencheur**, non par l'action serveur : une action
-- peut oublier de journaliser, une phase suivante peut ajouter un second
-- chemin d'écriture. Le déclencheur voit passer toute écriture, d'où qu'elle
-- vienne — formulaire, action, script de reprise, requête directe.
--
-- `DEFINER` est correct ici, contrairement aux gardes ci-dessus : cette
-- fonction doit écrire dans `audit_logs`, que la session n'a pas le droit
-- d'atteindre, et elle ne consulte jamais `current_user`.
--
-- Les métadonnées restent maigres — clé ou slug, et l'état de publication.
-- Recopier la ligne entière ferait du journal une seconde base, et y
-- déverserait le texte éditorial à chaque virgule corrigée.
-- -----------------------------------------------------------------------------

create or replace function public.tg_contenus_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      record;
  v_action   text;
  v_metadata jsonb;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  v_action := 'contenus.' || tg_table_name || '.' || lower(tg_op);

  if tg_table_name = 'content_blocks' then
    v_metadata := jsonb_build_object(
      'cle',       v_row.key,
      'page',      v_row.page_slug,
      'en_ligne',  v_row.published_fields is not null,
      'brouillon', v_row.draft_fields is not null
    );

    if tg_op = 'UPDATE'
       and (old.published_fields is not null) is distinct from (new.published_fields is not null) then
      v_metadata := v_metadata
        || jsonb_build_object('en_ligne_precedent', old.published_fields is not null);
    end if;

  elsif tg_table_name = 'faq_categories' then
    v_metadata := jsonb_build_object(
      'slug',   v_row.slug,
      'surface', v_row.surface,
      'active', v_row.is_active
    );

  elsif tg_table_name = 'faq_items' then
    v_metadata := jsonb_build_object(
      'question', left(v_row.question, 120),
      'statut',   v_row.status
    );

    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_metadata := v_metadata || jsonb_build_object('statut_precedent', old.status);
    end if;

  elsif tg_table_name = 'media_assets' then
    v_metadata := jsonb_build_object(
      'origine', v_row.kind,
      'chemin',  v_row.path,
      'type',    v_row.mime_type
    );

  else
    v_metadata := jsonb_build_object('slug', v_row.slug, 'statut', v_row.status);

    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_metadata := v_metadata || jsonb_build_object('statut_precedent', old.status);
    end if;
  end if;

  perform public.record_audit_event(
    v_action,
    tg_table_name,
    v_row.id::text,
    'SUCCES',
    v_metadata
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.tg_contenus_audit() is
  'Journalise toute écriture de contenu dans audit_logs (4A/4C). Posée en déclencheur : aucune écriture ne peut y échapper, quelle que soit sa provenance.';

drop trigger if exists content_blocks_audit on public.content_blocks;
create trigger content_blocks_audit
  after insert or update or delete on public.content_blocks
  for each row execute function public.tg_contenus_audit();

drop trigger if exists faq_categories_audit on public.faq_categories;
create trigger faq_categories_audit
  after insert or update or delete on public.faq_categories
  for each row execute function public.tg_contenus_audit();

drop trigger if exists faq_items_audit on public.faq_items;
create trigger faq_items_audit
  after insert or update or delete on public.faq_items
  for each row execute function public.tg_contenus_audit();

drop trigger if exists content_posts_audit on public.content_posts;
create trigger content_posts_audit
  after insert or update or delete on public.content_posts
  for each row execute function public.tg_contenus_audit();

drop trigger if exists media_assets_audit on public.media_assets;
create trigger media_assets_audit
  after insert or update or delete on public.media_assets
  for each row execute function public.tg_contenus_audit();




-- -----------------------------------------------------------------------------
-- 11. RLS — QUI VOIT QUOI
--
-- Trois publics, trois traitements, comme en 4E-1 :
--
--   * **anonyme et client** — ce qui est publié, et rien d'autre. Le point 14
--     du cadrage l'exige : « Un contenu non publié ne doit jamais devenir
--     public simplement parce que son slug ou son identifiant est connu. » Ce
--     n'est pas le masquage d'un bouton : la ligne **n'existe pas** pour cette
--     session, donc connaître son slug ne donne rien.
--   * **administrateur habilité** — tout, brouillons et archives compris.
--   * **écriture** — réservée aux permissions correspondantes. Les actions
--     serveur écrivent avec le client de session (motif de 4C) : RLS
--     s'applique donc réellement, et un appel direct par un compte sans droit
--     se heurte à la base, pas seulement au garde applicatif.
--
-- `content_blocks` mérite une remarque : le public ne reçoit **que** les lignes
-- dont `published_fields` n'est pas nul. Un brouillon n'est donc pas
-- « filtré à l'affichage », il est invisible — et comme l'absence de ligne
-- signifie « le code fait foi », la page reste complète en toutes
-- circonstances.
-- -----------------------------------------------------------------------------

alter table public.content_blocks  enable row level security;
alter table public.faq_categories  enable row level security;
alter table public.faq_items       enable row level security;
alter table public.content_posts   enable row level security;
alter table public.media_assets    enable row level security;

/* ----------------------------- blocs de contenu ---------------------------- */

drop policy if exists content_blocks_select_public on public.content_blocks;
create policy content_blocks_select_public
  on public.content_blocks for select to anon, authenticated
  using (published_fields is not null);

drop policy if exists content_blocks_select_admin on public.content_blocks;
create policy content_blocks_select_admin
  on public.content_blocks for select to authenticated
  using (public.can_view_contenus());

drop policy if exists content_blocks_insert_admin on public.content_blocks;
create policy content_blocks_insert_admin
  on public.content_blocks for insert to authenticated
  with check (public.has_permission('content.update'));

drop policy if exists content_blocks_update_admin on public.content_blocks;
create policy content_blocks_update_admin
  on public.content_blocks for update to authenticated
  using (public.has_permission('content.update'))
  with check (public.has_permission('content.update'));

-- La suppression d'une ligne sert à deux choses bien différentes : abandonner
-- un brouillon, ou remettre un texte en ligne à sa valeur d'origine. La
-- politique ouvre donc la porte aux trois permissions concernées, et c'est le
-- déclencheur `content_blocks_delete_guard` (§ 7 bis) qui tranche selon
-- l'effet réel — lui seul voit si la ligne était publiée. Une politique RLS ne
-- saurait pas faire cette distinction : elle juge une ligne, pas ce que sa
-- disparition change pour le visiteur.
drop policy if exists content_blocks_delete_admin on public.content_blocks;
create policy content_blocks_delete_admin
  on public.content_blocks for delete to authenticated
  using (
    public.has_permission('content.update')
    or public.has_permission('content.publish')
    or public.has_permission('content.delete')
  );

/* -------------------------------- FAQ ------------------------------------- */

drop policy if exists faq_categories_select_public on public.faq_categories;
create policy faq_categories_select_public
  on public.faq_categories for select to anon, authenticated
  using (is_active = true);

drop policy if exists faq_categories_select_admin on public.faq_categories;
create policy faq_categories_select_admin
  on public.faq_categories for select to authenticated
  using (public.can_view_contenus());

drop policy if exists faq_categories_insert_admin on public.faq_categories;
create policy faq_categories_insert_admin
  on public.faq_categories for insert to authenticated
  with check (public.has_permission('content.create'));

drop policy if exists faq_categories_update_admin on public.faq_categories;
create policy faq_categories_update_admin
  on public.faq_categories for update to authenticated
  using (public.has_permission('content.update'))
  with check (public.has_permission('content.update'));

drop policy if exists faq_categories_delete_admin on public.faq_categories;
create policy faq_categories_delete_admin
  on public.faq_categories for delete to authenticated
  using (public.has_permission('content.delete'));

drop policy if exists faq_items_select_public on public.faq_items;
create policy faq_items_select_public
  on public.faq_items for select to anon, authenticated
  using (
    status = 'PUBLIE'
    and exists (
      select 1 from public.faq_categories c
      where c.id = faq_items.category_id and c.is_active = true
    )
  );

drop policy if exists faq_items_select_admin on public.faq_items;
create policy faq_items_select_admin
  on public.faq_items for select to authenticated
  using (public.can_view_contenus());

drop policy if exists faq_items_insert_admin on public.faq_items;
create policy faq_items_insert_admin
  on public.faq_items for insert to authenticated
  with check (public.has_permission('content.create'));

drop policy if exists faq_items_update_admin on public.faq_items;
create policy faq_items_update_admin
  on public.faq_items for update to authenticated
  using (public.has_permission('content.update'))
  with check (public.has_permission('content.update'));

drop policy if exists faq_items_delete_admin on public.faq_items;
create policy faq_items_delete_admin
  on public.faq_items for delete to authenticated
  using (public.has_permission('content.delete'));

/* -------------------------------- articles -------------------------------- */

drop policy if exists content_posts_select_public on public.content_posts;
create policy content_posts_select_public
  on public.content_posts for select to anon, authenticated
  using (status = 'PUBLIE');

drop policy if exists content_posts_select_admin on public.content_posts;
create policy content_posts_select_admin
  on public.content_posts for select to authenticated
  using (public.can_view_contenus());

drop policy if exists content_posts_insert_admin on public.content_posts;
create policy content_posts_insert_admin
  on public.content_posts for insert to authenticated
  with check (public.has_permission('content.create'));

drop policy if exists content_posts_update_admin on public.content_posts;
create policy content_posts_update_admin
  on public.content_posts for update to authenticated
  using (public.has_permission('content.update'))
  with check (public.has_permission('content.update'));

drop policy if exists content_posts_delete_admin on public.content_posts;
create policy content_posts_delete_admin
  on public.content_posts for delete to authenticated
  using (public.has_permission('content.delete'));

/* ------------------------------ médiathèque ------------------------------- */
--
-- Aucune lecture publique. Les visuels sont servis par Next.js (LOCAL) ou par
-- Storage (STORAGE) : le site n'a pas besoin de lire cette table pour les
-- afficher, et l'ouvrir au visiteur exposerait un inventaire — noms internes,
-- tailles, classement — qui ne lui sert à rien. Le § 23 du document Stockage
-- est net : « pas de confiance dans l'URL », donc aucune raison d'en publier
-- la liste.

drop policy if exists media_assets_select_admin on public.media_assets;
create policy media_assets_select_admin
  on public.media_assets for select to authenticated
  using (public.can_view_medias());

drop policy if exists media_assets_insert_admin on public.media_assets;
create policy media_assets_insert_admin
  on public.media_assets for insert to authenticated
  with check (public.has_permission('media.upload'));

drop policy if exists media_assets_update_admin on public.media_assets;
create policy media_assets_update_admin
  on public.media_assets for update to authenticated
  using (public.has_permission('media.update'))
  with check (public.has_permission('media.update'));

drop policy if exists media_assets_delete_admin on public.media_assets;
create policy media_assets_delete_admin
  on public.media_assets for delete to authenticated
  using (public.has_permission('media.delete'));


-- -----------------------------------------------------------------------------
-- 12. PRIVILÈGES DE TABLE
--
-- RLS filtre les lignes ; les privilèges décident si la table est seulement
-- adressable. Les deux sont nécessaires : une politique permissive sur une
-- table sans privilège ne donne rien, et l'inverse non plus.
--
-- Le rôle anonyme reçoit la **lecture seule** des quatre tables publiques —
-- c'est ce qui permet aux pages d'être rendues sans session. Il ne reçoit
-- rien du tout sur `media_assets`.
-- -----------------------------------------------------------------------------

revoke all on public.content_blocks from anon, authenticated;
revoke all on public.faq_categories from anon, authenticated;
revoke all on public.faq_items      from anon, authenticated;
revoke all on public.content_posts  from anon, authenticated;
revoke all on public.media_assets   from anon, authenticated;

grant select                  on public.content_blocks to anon, authenticated;
grant insert, update, delete  on public.content_blocks to authenticated;

grant select                  on public.faq_categories to anon, authenticated;
grant insert, update, delete  on public.faq_categories to authenticated;

grant select                  on public.faq_items      to anon, authenticated;
grant insert, update, delete  on public.faq_items      to authenticated;

grant select                  on public.content_posts  to anon, authenticated;
grant insert, update, delete  on public.content_posts  to authenticated;

grant select, insert, update, delete on public.media_assets to authenticated;


-- -----------------------------------------------------------------------------
-- 13. STORAGE — LE BUCKET DES VISUELS TÉLÉVERSÉS  (D-22 = A)
--
-- Le § 11 du document Stockage autorise un emplacement public pour « images
-- publiques, visuels de services, images de produits, illustrations, contenus
-- marketing ». Ce bucket ne contient que cela : un visuel de page, destiné à
-- être affiché à tout le monde. Rien de privé n'y a sa place — le § 12 réserve
-- les fichiers privés à un bucket non public, et le point 12 du cadrage
-- interdit de rendre public un fichier qui doit être privé « simplement pour
-- simplifier son affichage ».
--
-- ## Les contrôles sont posés sur le bucket, pas seulement dans l'interface
--
-- Le § 35 du cadrage l'exige : « Les contrôles doivent exister côté
-- serveur/Storage, pas uniquement dans l'interface. » `allowed_mime_types` et
-- `file_size_limit` sont donc portés par le bucket lui-même : un téléversement
-- qui contournerait le formulaire — appel direct à l'API Storage avec un jeton
-- de session valide — se heurte quand même au refus.
--
-- Le SVG est **absent** de la liste, volontairement (§ 40 : contenu actif
-- possible). Aucun besoin du site ne l'exige : les 28 visuels existants sont
-- en WebP.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contenus-medias',
  'contenus-medias',
  true,
  10485760,
  array['image/webp', 'image/avif', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lecture : ouverte, puisque le bucket est public et que ces visuels sont
-- affichés sur le site.
drop policy if exists contenus_medias_read on storage.objects;
create policy contenus_medias_read
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'contenus-medias');

-- Écriture : réservée aux permissions de la médiathèque. Le § 35 du document
-- Stockage veut un refus **côté serveur** pour qui n'a pas le droit de
-- téléverser ; c'est ici qu'il est prononcé.
drop policy if exists contenus_medias_insert on storage.objects;
create policy contenus_medias_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'contenus-medias' and public.has_permission('media.upload'));

drop policy if exists contenus_medias_update on storage.objects;
create policy contenus_medias_update
  on storage.objects for update to authenticated
  using (bucket_id = 'contenus-medias' and public.has_permission('media.update'))
  with check (bucket_id = 'contenus-medias' and public.has_permission('media.update'));

drop policy if exists contenus_medias_delete on storage.objects;
create policy contenus_medias_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'contenus-medias' and public.has_permission('media.delete'));
