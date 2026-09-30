-- =============================================================================
-- MORA SHAWIRI — Migration 0006
-- Catalogue administrable : le catalogue commercial quitte le code source.
--
-- Références :
--   09_ADMINISTRATION/00_GESTION_SERVICES.md  § 4-5, § 7-12, § 20-40, § 52-66,
--                                             § 77-83, § 94, § 99, § 106-107
--   09_ADMINISTRATION/01_GESTION_PRODUITS.md  (univers « Produits »)
--   07_ARCHITECTURE_TECHNIQUE/01_ARCHITECTURE_BASE_DE_DONNEES.md § 231
--   07_ARCHITECTURE_TECHNIQUE/02_ROLES_ET_PERMISSIONS.md § 30-45, § 106
--   04 - Analyse et plan de développement.md  § 8 (domaine CATALOGUE), phase 4E
--
-- -----------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE SE REFUSE À FAIRE
-- -----------------------------------------------------------------------------
--
-- Elle crée les quatre tables du domaine CATALOGUE — categories, services,
-- products, product_files — et rien d'autre. Elle n'insère aucune donnée
-- d'offre : la reprise des quatorze prestations est faite par
-- `scripts/seed-catalogue.mjs`, qui lit `src/content/offers.ts` et recopie les
-- valeurs déjà validées. Écrire ces valeurs ici, à la main, aurait été le plus
-- sûr moyen d'introduire une différence d'une virgule entre ce que le visiteur
-- lit aujourd'hui et ce qu'il lira demain.
--
-- Le § 113 du document des services fixe l'objectif : « faire évoluer son
-- catalogue commercial de manière autonome, sans dépendre d'une modification
-- du code ». La contrepartie est qu'une donnée autrefois protégée par le
-- compilateur devient modifiable en ligne. Ce que TypeScript garantissait, la
-- base doit désormais le garantir à sa place — d'où le nombre de contraintes
-- ci-dessous. Elles ne sont pas de la prudence décorative : elles remplacent
-- une garantie qui existait et qu'on retire.
--
-- -----------------------------------------------------------------------------
-- LA RÈGLE DE PUBLICATION, TRADUITE EN CONTRAINTE
-- -----------------------------------------------------------------------------
--
-- Le § 29 est explicite : « Un brouillon n'est pas visible publiquement. » Le
-- § 94 ajoute qu'avant publication les champs obligatoires doivent être
-- vérifiés. Les deux sont posés en base, pas seulement dans le formulaire :
--
--   * `services_publiable` — une ligne au statut PUBLIE doit porter tous les
--     champs que la page publique affiche. Un formulaire incomplet est refusé
--     par la base, et un appel direct à l'action serveur l'est tout autant.
--   * RLS — le rôle anonyme ne voit que les lignes PUBLIE dont la catégorie
--     est active. Connaître le slug d'un brouillon ne suffit donc pas à le
--     lire : il n'existe pas, pour cette session.
--
-- -----------------------------------------------------------------------------
-- AFFILIATION — CE QUI EST PRÉPARÉ, ET CE QUI NE L'EST PAS
-- -----------------------------------------------------------------------------
--
-- Le plan § 8 signale la correction la plus importante du modèle : sans
-- `affiliate_max_rate`, « la règle de protection de la marge ne peut pas
-- exister ». Les deux colonnes sont donc créées ici, avec la contrainte qui
-- leur donne son sens : une offre déclarée éligible sans plafond est refusée.
--
-- Rien de plus. Aucune table d'affiliation, aucun calcul de commission, aucun
-- taux : la phase 4H s'en charge. `affiliate_max_rate` reste NULL sur les
-- quatorze offres reprises, ce qui vaut « affiliation indisponible » selon
-- 05_FONCTIONNALITES/01 § 11 — l'état réel, la décision D-11 n'étant pas
-- tranchée. Aucune valeur n'est supposée.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. GARDE-FOU DE LECTURE ADMINISTRATIVE
--
-- Une même question revient dans chaque politique : « cette session a-t-elle le
-- droit de voir le catalogue en entier, brouillons compris ? ». L'écrire une
-- fois évite qu'une politique diverge des autres au fil des phases.
-- -----------------------------------------------------------------------------

create or replace function public.can_view_catalogue()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('services.view')
      or public.has_permission('products.view');
$$;

comment on function public.can_view_catalogue() is
  'Vrai si la session peut consulter le catalogue complet, brouillons et archives compris.';

revoke execute on function public.can_view_catalogue() from public, anon;
grant  execute on function public.can_view_catalogue() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. CATÉGORIES
--
-- Le § 11 énumère six catégories initiales et précise que « la structure peut
-- évoluer ». Aucune n'est insérée ici pour la même raison que les offres : les
-- regroupements réellement affichés aujourd'hui par la Boutique sont ceux de
-- `offers.ts`, et c'est l'état existant qui fait foi, pas une liste théorique.
--
-- `kind` sépare les deux univers du § 2 : le catalogue des Services et celui
-- des Produits. Une catégorie appartient à l'un ou à l'autre, jamais aux deux —
-- sans quoi le § 106 (« la présence dans la Boutique doit être contrôlée
-- explicitement ») deviendrait inapplicable.
-- -----------------------------------------------------------------------------

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  name        text not null,
  kind        text not null,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint categories_slug_unique  unique (slug),
  constraint categories_slug_format  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_name_present check (btrim(name) <> ''),
  constraint categories_kind_valid   check (kind in ('SERVICE', 'PRODUIT'))
);

comment on table public.categories is
  'Catégories du catalogue (09_ADMINISTRATION/00 § 11-12). Une catégorie appartient à l''univers Services ou à l''univers Produits.';
comment on column public.categories.is_active is
  'Une catégorie désactivée retire ses offres de l''affichage public sans les supprimer (§ 12).';

create index if not exists categories_kind_order_idx
  on public.categories (kind, sort_order, name);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. SERVICES
--
-- Les colonnes reprennent une à une les informations que la Boutique affiche
-- déjà (`src/content/offers.ts`) et les champs que le § 7 exige. Les noms
-- restent proches du document de référence pour qu'une relecture croisée soit
-- possible sans table de correspondance.
--
-- Trois points méritent d'être dits :
--
--   * `price_label` et `price_amount` coexistent volontairement. Le § 20 admet
--     cinq modes tarifaires, dont « sur devis » et « prix non affiché » : un
--     montant numérique seul ne sait pas les exprimer. `price_label` est ce que
--     le visiteur lit ; `price_amount` est ce que les données structurées et,
--     demain, le commerce utilisent. Six offres sur quatorze ont un montant.
--   * `sort_order` et `featured_order` sont distincts : le § 52 demande un
--     ordre d'affichage, le § 53 une mise en avant. Les confondre obligerait à
--     réordonner tout le catalogue pour changer la vitrine de l'accueil.
--   * `show_in_services` et `show_in_shop` appliquent les § 34-35. Le § 106
--     interdit qu'un service existe automatiquement dans la Boutique ; deux
--     drapeaux séparés sont la seule façon de le garantir.
-- -----------------------------------------------------------------------------

create table if not exists public.services (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null,
  category_id        uuid not null references public.categories (id) on delete restrict,

  -- Présentation
  title              text not null,
  tag                text not null,
  featured_tag       text,
  short_description  text not null,
  description        text not null,
  benefits           text[] not null default '{}'::text[],

  -- Tarification (§ 20-23)
  price_label        text not null,
  price_note         text not null default '',
  price_amount       numeric(12, 2),
  currency           text not null default 'KMF',

  -- Visuel (§ 16-19)
  image_path         text not null,
  image_alt          text,

  -- Action commerciale (§ 36-43)
  cta_label          text not null,
  request_subject    text not null,
  internal_href      text,
  commercial_mode    text not null default 'quote',

  -- Cycle de vie (§ 28-35, § 52-55)
  status             text not null default 'BROUILLON',
  show_in_services   boolean not null default false,
  show_in_shop       boolean not null default true,
  is_featured        boolean not null default false,
  featured_order     integer,
  sort_order         integer not null default 0,

  -- Affiliation (plan § 8) — préparation seulement, la phase 4H exploitera.
  affiliate_eligible boolean not null default false,
  affiliate_max_rate numeric(5, 2),

  -- Historique (§ 65)
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,

  constraint services_slug_unique   unique (slug),
  constraint services_slug_format   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint services_status_valid  check (status in ('BROUILLON', 'PUBLIE', 'NON_PUBLIE', 'ARCHIVE')),
  constraint services_mode_valid    check (commercial_mode in ('purchase', 'quote', 'appointment', 'whatsapp')),
  constraint services_currency_valid check (currency ~ '^[A-Z]{3}$'),

  -- Un montant négatif n'a pas de sens ; un montant nul non plus pour une
  -- offre commerciale. « Gratuit » se dit dans `price_label`, pas par un zéro.
  constraint services_price_positive check (price_amount is null or price_amount > 0),

  -- § 53 : une offre mise en avant doit savoir à quelle place.
  constraint services_featured_ordered
    check (is_featured = false or featured_order is not null),

  -- Plan § 8 : sans plafond, l'affiliation n'existe pas pour cette offre.
  constraint services_affiliate_capped
    check (affiliate_eligible = false or affiliate_max_rate is not null),
  constraint services_affiliate_cap_range
    check (affiliate_max_rate is null or (affiliate_max_rate > 0 and affiliate_max_rate <= 100)),

  -- § 94 : les champs obligatoires sont vérifiés avant publication. Une ligne
  -- publiée sans titre, sans description ou sans visuel ne peut pas exister —
  -- ni par le formulaire, ni par un appel direct, ni par une requête SQL.
  constraint services_publiable check (
    status <> 'PUBLIE'
    or (
      btrim(title) <> ''
      and btrim(short_description) <> ''
      and btrim(description) <> ''
      and btrim(price_label) <> ''
      and btrim(image_path) <> ''
      and btrim(cta_label) <> ''
      and btrim(request_subject) <> ''
    )
  )
);

comment on table public.services is
  'Catalogue des prestations (09_ADMINISTRATION/00). Une ligne PUBLIE est lisible publiquement ; tout autre statut ne l''est pas.';
comment on column public.services.price_label is
  'Ce que le visiteur lit : « Sur devis », « 15 000 KMF »… Les cinq modes tarifaires du § 20 passent par ce champ.';
comment on column public.services.price_amount is
  'Montant exploitable (données structurées, commerce à venir). NULL lorsque l''offre est sur devis — aucun prix n''est inventé.';
comment on column public.services.affiliate_max_rate is
  'Plafond de commission de l''offre. NULL = affiliation indisponible (05_FONCTIONNALITES/01 § 11). Décision D-11 non tranchée.';
comment on column public.services.show_in_shop is
  '§ 106 : la présence dans la Boutique est explicite. Un service du catalogue n''y figure pas automatiquement.';

create index if not exists services_public_idx
  on public.services (status, show_in_shop, sort_order)
  where status = 'PUBLIE';
create index if not exists services_category_idx on public.services (category_id, sort_order);
create index if not exists services_featured_idx
  on public.services (featured_order)
  where is_featured = true;

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. PRODUITS
--
-- `02_CONTENUS/03_PRODUITS.md` et la Boutique actuelle disent la même chose :
-- aucun produit n'existe au lancement. La table est créée vide, et le restera
-- tant que MORA Shawiri n'en aura pas saisi un. Le rapport d'audit § 1000
-- l'avait relevé comme un défaut du socle abandonné — des produits fictifs y
-- avaient été semés « pour que la page ne soit pas vide ». Rien de tel ici.
--
-- La structure est celle des services, moins ce qui ne s'applique pas
-- (`request_subject`, propre au formulaire de devis) et plus ce qui leur est
-- propre : stock et fichiers livrables.
-- -----------------------------------------------------------------------------

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null,
  category_id        uuid not null references public.categories (id) on delete restrict,

  title              text not null,
  tag                text not null,
  short_description  text not null,
  description        text not null,
  benefits           text[] not null default '{}'::text[],

  price_label        text not null,
  price_note         text not null default '',
  price_amount       numeric(12, 2),
  currency           text not null default 'KMF',

  image_path         text not null,
  image_alt          text,

  cta_label          text not null,
  commercial_mode    text not null default 'purchase',

  -- Un produit numérique n'a pas de stock ; un produit physique en a un.
  -- NULL signifie « non géré », pas « zéro » : la nuance évite d'afficher un
  -- produit en rupture alors qu'il est simplement dématérialisé.
  stock_quantity     integer,

  status             text not null default 'BROUILLON',
  show_in_shop       boolean not null default true,
  is_featured        boolean not null default false,
  featured_order     integer,
  sort_order         integer not null default 0,

  affiliate_eligible boolean not null default false,
  affiliate_max_rate numeric(5, 2),

  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_by         uuid references public.profiles (id) on delete set null,

  constraint products_slug_unique    unique (slug),
  constraint products_slug_format    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_status_valid   check (status in ('BROUILLON', 'PUBLIE', 'NON_PUBLIE', 'ARCHIVE')),
  constraint products_mode_valid     check (commercial_mode in ('purchase', 'quote', 'appointment', 'whatsapp')),
  constraint products_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint products_price_positive check (price_amount is null or price_amount > 0),
  constraint products_stock_positive check (stock_quantity is null or stock_quantity >= 0),
  constraint products_featured_ordered
    check (is_featured = false or featured_order is not null),
  constraint products_affiliate_capped
    check (affiliate_eligible = false or affiliate_max_rate is not null),
  constraint products_affiliate_cap_range
    check (affiliate_max_rate is null or (affiliate_max_rate > 0 and affiliate_max_rate <= 100)),
  constraint products_publiable check (
    status <> 'PUBLIE'
    or (
      btrim(title) <> ''
      and btrim(short_description) <> ''
      and btrim(description) <> ''
      and btrim(price_label) <> ''
      and btrim(image_path) <> ''
      and btrim(cta_label) <> ''
    )
  )
);

comment on table public.products is
  'Univers « Produits » de la Boutique (09_ADMINISTRATION/01). Vide au lancement : aucun produit fictif n''est semé.';

create index if not exists products_public_idx
  on public.products (status, show_in_shop, sort_order)
  where status = 'PUBLIE';
create index if not exists products_category_idx on public.products (category_id, sort_order);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. FICHIERS DE PRODUIT
--
-- Livrables d'un produit numérique. La table est posée maintenant parce que le
-- plan § 8 la range dans le domaine CATALOGUE, mais elle reste vide : la
-- livraison effective relève du commerce (phase 4G) et le stockage des
-- fichiers de la médiathèque, qui n'est pas de cette passe.
--
-- `storage_path` désigne un objet du Storage Supabase. Aucun bucket n'est créé
-- ici : en créer un que rien n'alimente reviendrait à ouvrir une porte sans
-- pièce derrière.
-- -----------------------------------------------------------------------------

create table if not exists public.product_files (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  label        text not null,
  storage_path text not null,
  content_type text,
  size_bytes   bigint,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint product_files_label_present check (btrim(label) <> ''),
  constraint product_files_size_positive check (size_bytes is null or size_bytes >= 0),
  constraint product_files_path_unique    unique (product_id, storage_path)
);

comment on table public.product_files is
  'Livrables numériques rattachés à un produit. Vide tant que la médiathèque et le commerce ne sont pas livrés.';

create index if not exists product_files_product_idx on public.product_files (product_id, sort_order);

drop trigger if exists product_files_set_updated_at on public.product_files;
create trigger product_files_set_updated_at
  before update on public.product_files
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. PUBLICATION — UNE PERMISSION DISTINCTE DE LA MODIFICATION
--
-- Le catalogue des permissions sépare `services.update` de `services.publish`
-- (§ 30-45 des rôles). Une politique RLS ne sait pas exprimer « cette colonne-ci
-- a changé » : elle juge la ligne, pas la transition. Le contrôle est donc posé
-- en déclencheur, où l'ancienne et la nouvelle valeur sont toutes deux
-- disponibles.
--
-- Conséquence concrète : un administrateur qui détient `services.update` mais
-- pas `services.publish` peut corriger un prix, et ne peut pas mettre l'offre
-- en ligne ni la retirer. C'est exactement la séparation que le § 99 demande.
--
-- Le déclencheur tient aussi `published_at` à jour. Le faire ici plutôt que
-- dans l'application garantit que la date existe quel que soit le chemin
-- d'écriture — formulaire, action serveur, script de reprise.
-- -----------------------------------------------------------------------------

-- SECURITY INVOKER, et c'est le point délicat de toute cette migration.
--
-- Une fonction SECURITY DEFINER s'exécute sous l'identité de son
-- propriétaire : `current_user` y vaut `postgres`, quelle que soit la session
-- qui a déclenché l'écriture. Or `is_privileged_db_role()` interroge
-- précisément `current_user` pour reconnaître une migration ou la clé de
-- service. Écrit en DEFINER, ce garde-fou aurait donc répondu « requête
-- privilégiée » à *tout le monde*, et n'aurait jamais rien refusé.
--
-- Le contrôle automatique l'a démontré avant la mise en ligne : un compte
-- doté de `services.update` seul parvenait à publier. En INVOKER, la fonction
-- voit le rôle réel — `authenticated` pour une session, `service_role` pour un
-- script, `postgres` pour une migration — et les trois cas se distinguent.
--
-- Rien n'est perdu au passage : `has_permission()` reste DEFINER de son côté,
-- et c'est elle qui a besoin de lire les tables de droits hors RLS.
create or replace function public.tg_catalogue_publication_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_permission text;
  v_becomes_public boolean;
  v_leaves_public  boolean;
begin
  v_permission := case tg_table_name
                    when 'services' then 'services.publish'
                    else 'products.publish'
                  end;

  if tg_op = 'INSERT' then
    v_becomes_public := new.status = 'PUBLIE';
    v_leaves_public  := false;
  else
    v_becomes_public := new.status = 'PUBLIE' and old.status <> 'PUBLIE';
    v_leaves_public  := old.status = 'PUBLIE' and new.status <> 'PUBLIE';
  end if;

  -- Les migrations et les scripts serveur ne représentent pas un utilisateur :
  -- leur imposer une permission de session n'aurait aucun sens.
  if (v_becomes_public or v_leaves_public) and not public.is_privileged_db_role() then
    if not public.has_permission(v_permission) then
      raise exception 'Publication refusée : permission % requise.', v_permission
        using errcode = '42501';
    end if;
  end if;

  if v_becomes_public then
    new.published_at := coalesce(new.published_at, now());
  end if;

  return new;
end;
$$;

comment on function public.tg_catalogue_publication_guard() is
  'Exige services.publish / products.publish pour toute entrée ou sortie du statut PUBLIE, et horodate la première publication.';

drop trigger if exists services_publication_guard on public.services;
create trigger services_publication_guard
  before insert or update on public.services
  for each row execute function public.tg_catalogue_publication_guard();

drop trigger if exists products_publication_guard on public.products;
create trigger products_publication_guard
  before insert or update on public.products
  for each row execute function public.tg_catalogue_publication_guard();


-- -----------------------------------------------------------------------------
-- 7. SUPPRESSION — CE QUI A ÉTÉ PUBLIÉ NE S'EFFACE PAS
--
-- Le § 78 est net : « La suppression d'un service ne doit pas détruire les
-- informations historiques des commandes associées. » Les commandes n'existent
-- pas encore (phase 4G), mais la règle, elle, existe déjà — et l'appliquer
-- seulement le jour où la table `order_items` apparaîtra supposerait que
-- personne n'aura rien supprimé entre-temps.
--
-- La règle retenue : une offre qui a été publiée un jour ne peut plus être
-- supprimée, seulement archivée (§ 32, § 63). Une offre restée brouillon —
-- une saisie abandonnée, un doublon — se supprime normalement.
-- -----------------------------------------------------------------------------

create or replace function public.tg_catalogue_no_delete_when_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.published_at is not null then
    raise exception
      'Suppression refusée : cette offre a été publiée. Archivez-la pour conserver l''historique (§ 78).'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

comment on function public.tg_catalogue_no_delete_when_published() is
  'Interdit la suppression d''une offre déjà publiée. L''archivage est le chemin prévu (09_ADMINISTRATION/00 § 63, § 78).';

drop trigger if exists services_no_delete_when_published on public.services;
create trigger services_no_delete_when_published
  before delete on public.services
  for each row execute function public.tg_catalogue_no_delete_when_published();

drop trigger if exists products_no_delete_when_published on public.products;
create trigger products_no_delete_when_published
  before delete on public.products
  for each row execute function public.tg_catalogue_no_delete_when_published();


-- -----------------------------------------------------------------------------
-- 8. COHÉRENCE CATÉGORIE / UNIVERS
--
-- Un service rangé dans une catégorie de produits, ou l'inverse, ne serait
-- visible nulle part : les deux univers du § 2 se lisent séparément. La clé
-- étrangère seule ne l'empêche pas ; ce déclencheur si.
-- -----------------------------------------------------------------------------

create or replace function public.tg_catalogue_category_kind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected text := case tg_table_name when 'services' then 'SERVICE' else 'PRODUIT' end;
  v_actual   text;
begin
  select kind into v_actual from public.categories where id = new.category_id;

  if v_actual is distinct from v_expected then
    raise exception 'Catégorie incompatible : univers % attendu, % reçu.', v_expected, coalesce(v_actual, 'inconnu')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.tg_catalogue_category_kind() is
  'Empêche de ranger un service dans une catégorie de produits, et réciproquement (09_ADMINISTRATION/00 § 2).';

drop trigger if exists services_category_kind on public.services;
create trigger services_category_kind
  before insert or update of category_id on public.services
  for each row execute function public.tg_catalogue_category_kind();

drop trigger if exists products_category_kind on public.products;
create trigger products_category_kind
  before insert or update of category_id on public.products
  for each row execute function public.tg_catalogue_category_kind();


-- -----------------------------------------------------------------------------
-- 9. CATÉGORIE UTILISÉE — PAS DE DÉSACTIVATION SILENCIEUSE
--
-- Le § 12 demande qu'« une catégorie utilisée par des services ne soit pas
-- supprimée brutalement sans gestion des services concernés ». `on delete
-- restrict` couvre la suppression. Reste la désactivation, qui retirerait du
-- site public des offres pourtant publiées, sans que personne l'ait demandé
-- pour elles. Elle est donc refusée tant que des offres publiées s'y rattachent.
-- -----------------------------------------------------------------------------

create or replace function public.tg_categories_deactivation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if old.is_active and not new.is_active then
    if new.kind = 'SERVICE' then
      select count(*) into v_count
        from public.services
       where category_id = new.id and status = 'PUBLIE';
    else
      select count(*) into v_count
        from public.products
       where category_id = new.id and status = 'PUBLIE';
    end if;

    if v_count > 0 then
      raise exception
        'Désactivation refusée : % offre(s) publiée(s) utilisent cette catégorie. Dépubliez-les d''abord (§ 12).', v_count
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tg_categories_deactivation_guard() is
  'Refuse de désactiver une catégorie encore utilisée par des offres publiées (09_ADMINISTRATION/00 § 12).';

drop trigger if exists categories_deactivation_guard on public.categories;
create trigger categories_deactivation_guard
  before update on public.categories
  for each row execute function public.tg_categories_deactivation_guard();


-- -----------------------------------------------------------------------------
-- 10. AUDIT — LA TRACE EST PRISE PAR LA BASE, PAS PAR LE FORMULAIRE
--
-- Le cadrage de la phase est explicite : réutiliser le journal de 4A/4C, ne pas
-- en créer un second. `record_audit_event()` est donc appelée telle quelle.
--
-- Le choix du déclencheur plutôt que de l'action serveur est délibéré. Une
-- action peut oublier de journaliser ; une phase suivante peut ajouter un
-- second chemin d'écriture. Le déclencheur, lui, voit passer toute écriture,
-- d'où qu'elle vienne. Le § 196 demande que les actions sensibles laissent une
-- trace — « sensible » qualifie l'effet, pas l'intention de l'appelant.
--
-- Les métadonnées restent volontairement maigres : identifiant, slug, statut.
-- Recopier la ligne entière ferait du journal une seconde base, et
-- `tg_audit_logs_reject_secrets` n'aurait plus grand-chose à protéger.
-- -----------------------------------------------------------------------------

create or replace function public.tg_catalogue_audit()
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

  v_action := 'catalogue.' || tg_table_name || '.' || lower(tg_op);

  v_metadata := jsonb_build_object('slug', v_row.slug, 'statut', v_row.status);

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_metadata := v_metadata || jsonb_build_object('statut_precedent', old.status);
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

comment on function public.tg_catalogue_audit() is
  'Journalise toute écriture du catalogue dans audit_logs (4A/4C). Posée en déclencheur : aucune écriture ne peut y échapper.';

drop trigger if exists services_audit on public.services;
create trigger services_audit
  after insert or update or delete on public.services
  for each row execute function public.tg_catalogue_audit();

drop trigger if exists products_audit on public.products;
create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.tg_catalogue_audit();


-- -----------------------------------------------------------------------------
-- 11. RLS — QUI VOIT QUOI
--
-- Trois publics, trois traitements :
--
--   * **anonyme et client** — les offres PUBLIE dont la catégorie est active,
--     et elles seules. Un brouillon dont on connaît le slug reste invisible :
--     la politique ne le renvoie pas, donc il n'existe pas pour cette session.
--   * **administrateur habilité** — tout, brouillons et archives compris.
--   * **écriture** — réservée aux permissions correspondantes. Les actions
--     serveur écrivent avec le client de session (patron de la phase 4C) :
--     RLS s'applique donc réellement, et un appel direct à une action par un
--     compte sans droit se heurte à la base, pas seulement au garde applicatif.
--
-- `product_files` n'accorde aucune lecture publique : un livrable se télécharge
-- après achat, ce qui relève de la phase 4G.
-- -----------------------------------------------------------------------------

alter table public.categories    enable row level security;
alter table public.services      enable row level security;
alter table public.products      enable row level security;
alter table public.product_files enable row level security;

/* ------------------------------- catégories ------------------------------- */

drop policy if exists categories_select_public on public.categories;
create policy categories_select_public
  on public.categories for select to anon, authenticated
  using (is_active = true);

drop policy if exists categories_select_admin on public.categories;
create policy categories_select_admin
  on public.categories for select to authenticated
  using (public.can_view_catalogue());

drop policy if exists categories_insert_admin on public.categories;
create policy categories_insert_admin
  on public.categories for insert to authenticated
  with check (
    (kind = 'SERVICE' and public.has_permission('services.create'))
    or (kind = 'PRODUIT' and public.has_permission('products.create'))
  );

drop policy if exists categories_update_admin on public.categories;
create policy categories_update_admin
  on public.categories for update to authenticated
  using (
    (kind = 'SERVICE' and public.has_permission('services.update'))
    or (kind = 'PRODUIT' and public.has_permission('products.update'))
  )
  with check (
    (kind = 'SERVICE' and public.has_permission('services.update'))
    or (kind = 'PRODUIT' and public.has_permission('products.update'))
  );

drop policy if exists categories_delete_admin on public.categories;
create policy categories_delete_admin
  on public.categories for delete to authenticated
  using (
    (kind = 'SERVICE' and public.has_permission('services.delete'))
    or (kind = 'PRODUIT' and public.has_permission('products.delete'))
  );

/* -------------------------------- services -------------------------------- */

drop policy if exists services_select_public on public.services;
create policy services_select_public
  on public.services for select to anon, authenticated
  using (
    status = 'PUBLIE'
    and exists (
      select 1 from public.categories c
      where c.id = services.category_id and c.is_active = true
    )
  );

drop policy if exists services_select_admin on public.services;
create policy services_select_admin
  on public.services for select to authenticated
  using (public.has_permission('services.view'));

drop policy if exists services_insert_admin on public.services;
create policy services_insert_admin
  on public.services for insert to authenticated
  with check (public.has_permission('services.create'));

drop policy if exists services_update_admin on public.services;
create policy services_update_admin
  on public.services for update to authenticated
  using (public.has_permission('services.update'))
  with check (public.has_permission('services.update'));

drop policy if exists services_delete_admin on public.services;
create policy services_delete_admin
  on public.services for delete to authenticated
  using (public.has_permission('services.delete'));

/* -------------------------------- produits -------------------------------- */

drop policy if exists products_select_public on public.products;
create policy products_select_public
  on public.products for select to anon, authenticated
  using (
    status = 'PUBLIE'
    and exists (
      select 1 from public.categories c
      where c.id = products.category_id and c.is_active = true
    )
  );

drop policy if exists products_select_admin on public.products;
create policy products_select_admin
  on public.products for select to authenticated
  using (public.has_permission('products.view'));

drop policy if exists products_insert_admin on public.products;
create policy products_insert_admin
  on public.products for insert to authenticated
  with check (public.has_permission('products.create'));

drop policy if exists products_update_admin on public.products;
create policy products_update_admin
  on public.products for update to authenticated
  using (public.has_permission('products.update'))
  with check (public.has_permission('products.update'));

drop policy if exists products_delete_admin on public.products;
create policy products_delete_admin
  on public.products for delete to authenticated
  using (public.has_permission('products.delete'));

/* ----------------------------- fichiers produit ---------------------------- */

drop policy if exists product_files_select_admin on public.product_files;
create policy product_files_select_admin
  on public.product_files for select to authenticated
  using (public.has_permission('products.view'));

drop policy if exists product_files_write_admin on public.product_files;
create policy product_files_write_admin
  on public.product_files for all to authenticated
  using (public.has_permission('products.update'))
  with check (public.has_permission('products.update'));


-- -----------------------------------------------------------------------------
-- 12. PRIVILÈGES DE TABLE
--
-- RLS filtre les lignes ; les privilèges décident si la table est seulement
-- adressable. Les deux sont nécessaires : une politique permissive sur une
-- table sans privilège ne donne rien, et un privilège sans politique non plus.
--
-- Le rôle anonyme reçoit la lecture des trois tables publiques — c'est ce qui
-- permet à la Boutique d'être rendue sans session. Il ne reçoit rien sur
-- `product_files`.
-- -----------------------------------------------------------------------------

revoke all on public.categories    from anon, authenticated;
revoke all on public.services      from anon, authenticated;
revoke all on public.products      from anon, authenticated;
revoke all on public.product_files from anon, authenticated;

grant select                         on public.categories to anon, authenticated;
grant insert, update, delete         on public.categories to authenticated;

grant select                         on public.services   to anon, authenticated;
grant insert, update, delete         on public.services   to authenticated;

grant select                         on public.products   to anon, authenticated;
grant insert, update, delete         on public.products   to authenticated;

grant select, insert, update, delete on public.product_files to authenticated;
