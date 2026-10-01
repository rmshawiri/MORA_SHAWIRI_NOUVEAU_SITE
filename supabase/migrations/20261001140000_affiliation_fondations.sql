-- =============================================================================
-- PHASE 4H-1 — AFFILIATION : FONDATIONS
--
-- Ce que cette migration pose, et dans cet ordre :
--
--   1. l'extension `btree_gist`, pour qu'une règle n'ait jamais deux versions
--      en vigueur au même instant ;
--   2. les permissions de l'affiliation (8 existaient depuis 4A, 8 s'ajoutent) ;
--   3. la nomenclature décidée (N2) : AFIL, FIAF, RVAF, et COMAF devenu
--      code de référence ;
--   4. les catégories d'affiliés, administrables, sans aucun taux semé ;
--   5. les affiliés ;
--   6. les règles de commission, versionnées et immuables, avec la
--      dérogation contractuelle (N1) ;
--   7. le calcul en base, identique au moteur `src/lib/domain/affiliation.ts` ;
--   8. la publication d'une règle (clôture + nouvelle version, atomiques) ;
--   9. l'historique et le journal d'audit ;
--  10. les privilèges et la RLS.
--
-- ## Décisions du propriétaire appliquées ici (1er octobre 2026)
--
--   * Les taux 10/12/15 de la page publique sont des exemples de
--     démonstration : ils ne sont repris nulle part.
--   * Héritage : offre spécifique (affilié, puis catégorie) > règle
--     individuelle > règle de catégorie.
--   * N1 = B : le plafond de l'offre (`affiliate_max_rate`) s'applique, sauf
--     règle individuelle marquée DÉROGATION CONTRACTUELLE — motif, auteur,
--     date et permission dédiée obligatoires. L'éligibilité de l'offre n'est
--     JAMAIS contournée par une dérogation.
--   * A : fenêtre d'attribution de 90 jours par défaut, surchargeable.
--   * D+E : auto-affiliation interdite par défaut, levée seulement par
--     affilié — jamais par catégorie.
--   * F : protection d'un prospect de 6 mois par défaut, ou « pendant le
--     partenariat » avec survie paramétrable après la fin.
--   * K : aucun seuil de versement global ; paramétrable.
--   * L : fin de mois et paiement intégral par défaut ; paramétrables.
--
-- ## Ce que cette migration ne fait pas
--
-- Aucun taux de commission n'est semé : une catégorie naît sans règle, et un
-- affilié ne pourra pas être activé sans configuration financière complète
-- (lot 4H-3). Aucune candidature, aucune attribution, aucune commission ni
-- aucun versement : chacun arrive avec son lot. Aucune migration antérieure
-- n'est modifiée, et aucune fonction validée n'est réécrite.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. EXTENSION
--
-- `btree_gist` permet une contrainte d'exclusion qui combine une égalité
-- (même propriétaire, même cible) et un recouvrement de périodes. C'est la
-- seule façon de garantir, quelle que soit la concurrence, qu'une règle n'a
-- pas deux versions en vigueur au même instant : un déclencheur qui
-- vérifierait avant d'insérer laisserait passer deux insertions simultanées.
-- -----------------------------------------------------------------------------

create extension if not exists btree_gist with schema extensions;


-- -----------------------------------------------------------------------------
-- 2. PERMISSIONS
--
-- Convention du projet : `ressource.action`. Les 8 permissions de 4A gardent
-- leur code ; leur libellé est précisé, parce que « Modifier un affilié, dont
-- son taux » n'est plus vrai : le taux relève désormais des règles.
--
-- Aucune ligne `role_permissions` : depuis D-18, le rôle ADMIN ne porte plus
-- de droits, et SUPER_ADMIN couvre tout par `admin.full_access`.
-- -----------------------------------------------------------------------------

insert into public.permissions (code, domain, action, label, is_critical) values
  ('affiliate_applications.view',   'affiliate_applications', 'view',     'Consulter les candidatures d''affiliation', false),
  ('affiliate_applications.manage', 'affiliate_applications', 'manage',   'Traiter les candidatures d''affiliation', false),
  ('affiliate_rules.manage',        'affiliate_rules',        'manage',   'Gérer les catégories et les règles de commission', true),
  ('affiliate_rules.derogate',      'affiliate_rules',        'derogate', 'Accorder une dérogation contractuelle au plafond d''une offre', true),
  ('affiliate_codes.manage',        'affiliate_codes',        'manage',   'Gérer les codes de réduction des affiliés', true),
  ('affiliate_attributions.manage', 'affiliate_attributions', 'manage',   'Attribuer une affaire et reconnaître un prospect', true),
  ('affiliate_documents.issue',     'affiliate_documents',    'issue',    'Émettre une fiche officielle d''affilié', true),
  ('payouts.view',                  'payouts',                'view',     'Consulter les versements et coordonnées de paiement des affiliés', false)
on conflict (code) do update
  set domain      = excluded.domain,
      action      = excluded.action,
      label       = excluded.label,
      is_critical = excluded.is_critical;

update public.permissions set label = 'Consulter les affiliés'
 where code = 'affiliates.view';
update public.permissions set label = 'Créer et activer un affilié'
 where code = 'affiliates.create';
update public.permissions set label = 'Modifier l''identité, la catégorie et les liens d''un affilié'
 where code = 'affiliates.update';
update public.permissions set label = 'Suspendre, réactiver ou clore un affilié'
 where code = 'affiliates.disable';
update public.permissions set label = 'Ajuster ou annuler une commission'
 where code = 'commissions.manage';
update public.permissions set label = 'Valider manuellement une commission'
 where code = 'commissions.validate';
update public.permissions set label = 'Préparer et confirmer un versement, valider des coordonnées de paiement'
 where code = 'payouts.manage';


-- -----------------------------------------------------------------------------
-- 3. NOMENCLATURE (N2)
--
--   * AFIL  — référence de l'affilié : numérotation d'entité, pas une pièce ;
--   * FIAF  — fiche officielle d'affilié : une pièce, avec PDF archivé ;
--   * RVAF  — relevé de versement de commissions : une pièce ;
--   * COMAF — référence d'une commission (D-2). Déclarée en 4D comme type
--     documentaire, elle n'a jamais émis de pièce (aucune ligne `documents`) :
--     elle devient un code de référence, ce qui interdit d'émettre un faux
--     document « commission » par `issue_document`.
--
-- Le format reste celui du moteur 4D : `MORA-[TYPE]-[SÉRIE][NUMÉRO]`, un
-- compteur par type, alloué sous verrou par `allocate_document_number`.
-- -----------------------------------------------------------------------------

insert into public.document_types
  (code, label, entity_type, view_permission, issue_permission, sort_order, is_reference_only)
values
  ('AFIL', 'Affilié',                           'affiliate', 'affiliates.view', 'affiliates.create',         65, true),
  ('FIAF', 'Fiche officielle affilié',          'affiliate', 'affiliates.view', 'affiliate_documents.issue', 66, false),
  ('RVAF', 'Relevé de versement de commissions', 'payout',   'payouts.view',    'payouts.manage',            75, false)
on conflict (code) do update
  set label             = excluded.label,
      entity_type       = excluded.entity_type,
      view_permission   = excluded.view_permission,
      issue_permission  = excluded.issue_permission,
      sort_order        = excluded.sort_order,
      is_reference_only = excluded.is_reference_only,
      updated_at        = now();

update public.document_types
   set label             = 'Commission affilié',
       is_reference_only = true,
       updated_at        = now()
 where code = 'COMAF'
   and not exists (select 1 from public.documents d where d.doc_type = 'COMAF');


-- -----------------------------------------------------------------------------
-- 4. AIDES DE LECTURE
-- -----------------------------------------------------------------------------

create or replace function public.can_view_affiliation()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('affiliates.view');
$$;

comment on function public.can_view_affiliation() is
  'Vrai si la session peut consulter le module Affiliation (affiliates.view, ou accès total).';

revoke execute on function public.can_view_affiliation() from public, anon;
grant  execute on function public.can_view_affiliation() to authenticated, service_role;


-- Libellé d'auteur et motif de l'acte courant. Le motif est posé par les
-- fonctions d'administration (`set_config('mora.reason', …, true)`) et lu par
-- les déclencheurs d'historique : il ne survit pas à la transaction.
create or replace function public.affiliation_current_reason()
returns text
language sql
stable
as $$
  select nullif(btrim(coalesce(current_setting('mora.reason', true), '')), '');
$$;

comment on function public.affiliation_current_reason() is
  'Motif de l''acte en cours, posé localement par la fonction d''administration qui l''exécute.';


-- -----------------------------------------------------------------------------
-- 5. CATÉGORIES
--
-- Un modèle de départ, pas un carcan : la catégorie porte des paramètres par
-- défaut, qu'un affilié peut surcharger sans toucher aux autres membres.
--
-- Les paramètres de versement et d'attribution vivent ici ; les taux vivent
-- dans `affiliate_rules`, versionnés. L'auto-affiliation n'y figure pas : le
-- propriétaire l'a voulue individuelle, « jamais globale ».
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_categories (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique,
  label                      text not null,
  description                text,
  is_active                  boolean not null default true,
  -- Catégorie qu'un administrateur seul attribue (équipe, recrutés…). Elle
  -- n'est jamais proposée ni déduite d'une candidature publique.
  is_internal                boolean not null default false,
  sort_order                 integer not null default 0,

  -- A : fenêtre d'attribution après un clic.
  attribution_window_days    integer not null default 90,
  -- F : protection d'un prospect reconnu.
  prospect_protection_mode   text not null default 'DUREE',
  prospect_protection_months integer default 6,
  post_end_survival_months   integer,
  -- L et K : versement.
  payout_frequency           text not null default 'FIN_DE_MOIS',
  payout_min_amount          numeric(12, 2),
  acquisition_trigger        text not null default 'PAIEMENT_INTEGRAL',

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references public.profiles (id) on delete set null,
  updated_by                 uuid references public.profiles (id) on delete set null,

  constraint affiliate_categories_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint affiliate_categories_label_present check (btrim(label) <> '' and length(label) <= 80),
  constraint affiliate_categories_description_length check (description is null or length(description) <= 2000),
  constraint affiliate_categories_window_range check (attribution_window_days between 1 and 3650),
  constraint affiliate_categories_protection_mode check (prospect_protection_mode in ('DUREE', 'PARTENARIAT')),
  constraint affiliate_categories_protection_months check (
    prospect_protection_months is null or prospect_protection_months between 1 and 120
  ),
  constraint affiliate_categories_protection_coherent check (
    prospect_protection_mode = 'PARTENARIAT' or prospect_protection_months is not null
  ),
  constraint affiliate_categories_survival_range check (
    post_end_survival_months is null or post_end_survival_months between 0 and 120
  ),
  constraint affiliate_categories_frequency check (
    payout_frequency in ('HEBDOMADAIRE', 'FIN_DE_MOIS', 'TRIMESTRIEL', 'A_LA_DEMANDE')
  ),
  constraint affiliate_categories_payout_min check (payout_min_amount is null or payout_min_amount > 0),
  constraint affiliate_categories_trigger check (
    acquisition_trigger in ('PAIEMENT_INTEGRAL', 'PREMIER_PAIEMENT', 'VALIDATION_MANUELLE')
  )
);

comment on table public.affiliate_categories is
  'Catégories d''affiliés administrables. Paramètres par défaut, surchargeables par affilié. Aucun taux ici : voir affiliate_rules.';
comment on column public.affiliate_categories.acquisition_trigger is
  'Quand une commission devient acquise : paiement intégral de l''affaire (défaut décidé), premier paiement, ou validation manuelle.';

drop trigger if exists affiliate_categories_set_updated_at on public.affiliate_categories;
create trigger affiliate_categories_set_updated_at
  before update on public.affiliate_categories
  for each row execute function public.set_updated_at();

-- Les sept catégories demandées. Aucun paramètre financier n'y est inventé :
-- les défauts sont les décisions A, F, K et L, et aucune règle de taux n'est
-- créée. `on conflict do nothing` : rejouer la migration ne réécrit pas ce
-- que l'administration aura modifié.
insert into public.affiliate_categories (code, label, description, is_internal, sort_order) values
  ('STANDARD',    'Standard',                   'Particulier qui recommande MORA Shawiri à son entourage.', false, 10),
  ('INFLUENCEUR', 'Influenceur / Créateur',     'Créateur de contenu qui promeut MORA Shawiri auprès de son audience.', false, 20),
  ('COMMUNAUTE',  'Communauté / Association',   'Association, réseau ou communauté qui oriente ses membres.', false, 30),
  ('APPORTEUR',   'Apporteur d''affaires',      'Personne ou structure qui identifie et transmet des opportunités commerciales.', false, 40),
  ('RECRUTE',     'Recruté MORA Shawiri',       'Personne recrutée par MORA Shawiri pour la prospection. Attribuée par l''administration uniquement.', true, 50),
  ('EQUIPE',      'Équipe MORA Shawiri',        'Membre de l''équipe MORA Shawiri. Attribuée par l''administration uniquement.', true, 60),
  ('PARTENAIRE',  'Partenaire professionnel',   'Entreprise partenaire, le cas échéant sous convention particulière.', false, 70)
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- 6. AFFILIÉS
--
-- Un affilié naît en PRÉPARATION, sans référence. Il reçoit sa référence
-- AFIL à l'activation (lot 4H-3), qui exige un compte, une catégorie active
-- et une configuration financière complète.
--
-- Les colonnes de paramètres sont NULLABLES : nul signifie « hérite de la
-- catégorie ». C'est ce qui permet de modifier un seul affilié sans toucher
-- aux autres, et de modifier une catégorie sans écraser les exceptions.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliates (
  id                         uuid primary key default gen_random_uuid(),
  reference                  text unique,
  -- Lien principal `/?ref=<slug>` : stable, propre, sans donnée personnelle
  -- sensible. Il ne change jamais, même si le nom change.
  slug                       text not null unique,
  user_id                    uuid unique references auth.users (id) on delete restrict,
  category_id                uuid not null references public.affiliate_categories (id) on delete restrict,
  status                     text not null default 'PREPARATION',

  party_type                 text not null default 'PERSONNE',
  display_name               text not null,
  legal_name                 text,
  contact_email              text not null,
  contact_phone              text,
  country                    text,
  city                       text,

  -- Convention ou contrat particulier : référence libre, jamais un taux.
  contract_reference         text,
  contract_signed_on         date,
  started_on                 date,
  ended_on                   date,
  end_reason                 text,

  -- Surcharges individuelles. NULL = hérite de la catégorie.
  attribution_window_days    integer,
  prospect_protection_mode   text,
  prospect_protection_months integer,
  post_end_survival_months   integer,
  payout_frequency           text,
  payout_min_amount          numeric(12, 2),
  acquisition_trigger        text,

  -- D+E : levée individuelle de l'interdiction d'auto-affiliation.
  self_referral_allowed      boolean not null default false,
  self_referral_reason       text,

  activated_at               timestamptz,
  activated_by               uuid references public.profiles (id) on delete set null,
  suspended_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references public.profiles (id) on delete set null,
  updated_by                 uuid references public.profiles (id) on delete set null,

  constraint affiliates_reference_format check (reference is null or reference ~ '^MORA-AFIL-[A-Z]+[0-9]{4}$'),
  constraint affiliates_slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 48
  ),
  constraint affiliates_status_valid check (status in ('PREPARATION', 'ACTIF', 'SUSPENDU', 'TERMINE')),
  -- Un affilié sorti de préparation a une référence et un compte.
  constraint affiliates_reference_when_live check (status = 'PREPARATION' or reference is not null),
  constraint affiliates_account_when_live check (status = 'PREPARATION' or user_id is not null),
  constraint affiliates_party_type check (party_type in ('PERSONNE', 'ORGANISATION')),
  constraint affiliates_display_name_present check (btrim(display_name) <> '' and length(display_name) <= 120),
  constraint affiliates_legal_name_length check (legal_name is null or length(legal_name) <= 160),
  constraint affiliates_email_shape check (
    contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254
  ),
  constraint affiliates_phone_length check (contact_phone is null or length(contact_phone) <= 40),
  constraint affiliates_country_length check (country is null or length(country) <= 80),
  constraint affiliates_city_length check (city is null or length(city) <= 80),
  constraint affiliates_contract_length check (contract_reference is null or length(contract_reference) <= 120),
  constraint affiliates_end_reason_length check (end_reason is null or length(end_reason) <= 1000),
  constraint affiliates_dates_order check (ended_on is null or started_on is null or ended_on >= started_on),
  constraint affiliates_ended_when_terminated check (status <> 'TERMINE' or ended_on is not null),

  constraint affiliates_window_range check (attribution_window_days is null or attribution_window_days between 1 and 3650),
  constraint affiliates_protection_mode check (
    prospect_protection_mode is null or prospect_protection_mode in ('DUREE', 'PARTENARIAT')
  ),
  constraint affiliates_protection_months check (
    prospect_protection_months is null or prospect_protection_months between 1 and 120
  ),
  constraint affiliates_survival_range check (
    post_end_survival_months is null or post_end_survival_months between 0 and 120
  ),
  constraint affiliates_frequency check (
    payout_frequency is null
    or payout_frequency in ('HEBDOMADAIRE', 'FIN_DE_MOIS', 'TRIMESTRIEL', 'A_LA_DEMANDE')
  ),
  constraint affiliates_payout_min check (payout_min_amount is null or payout_min_amount > 0),
  constraint affiliates_trigger check (
    acquisition_trigger is null
    or acquisition_trigger in ('PAIEMENT_INTEGRAL', 'PREMIER_PAIEMENT', 'VALIDATION_MANUELLE')
  ),
  -- Une levée d'interdiction se justifie, toujours.
  constraint affiliates_self_referral_justified check (
    self_referral_allowed = false
    or (self_referral_reason is not null and btrim(self_referral_reason) <> '')
  ),
  constraint affiliates_self_referral_reason_length check (
    self_referral_reason is null or length(self_referral_reason) <= 1000
  )
);

comment on table public.affiliates is
  'Affiliés et apporteurs d''affaires. Paramètres individuels nullables : NULL hérite de la catégorie. Taux dans affiliate_rules.';
comment on column public.affiliates.slug is
  'Identifiant du lien principal /?ref=<slug>. Stable : ne change jamais après création.';

create index if not exists affiliates_category_idx on public.affiliates (category_id);
create index if not exists affiliates_status_idx on public.affiliates (status, created_at desc);

drop trigger if exists affiliates_set_updated_at on public.affiliates;
create trigger affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function public.set_updated_at();


-- Notes internes : jamais visibles de l'affilié, qui lit sa propre ligne
-- `affiliates`. D'où une table à part plutôt qu'une colonne.
create table if not exists public.affiliate_notes (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete cascade,
  body         text not null,
  author_id    uuid references public.profiles (id) on delete set null,
  author_label text,
  created_at   timestamptz not null default now(),
  constraint affiliate_notes_body_present check (btrim(body) <> '' and length(body) <= 4000)
);

create index if not exists affiliate_notes_affiliate_idx on public.affiliate_notes (affiliate_id, created_at desc);


-- Paramètres effectifs : la surcharge individuelle, sinon la catégorie. Une
-- seule définition de l'héritage, lue par l'administration, l'espace affilié
-- et les fonctions de calcul.
create or replace function public.affiliate_effective_terms(p_affiliate_id uuid)
returns table (
  attribution_window_days    integer,
  prospect_protection_mode   text,
  prospect_protection_months integer,
  post_end_survival_months   integer,
  payout_frequency           text,
  payout_min_amount          numeric,
  acquisition_trigger        text,
  self_referral_allowed      boolean
)
language sql
stable
-- Invocateur, volontairement : la RLS des deux tables décide qui lit quoi
-- (l'affilié sa ligne, l'administration sous affiliates.view). Une fonction
-- SECURITY DEFINER qui testerait le rôle de base y verrait `postgres` et ne
-- refuserait rien.
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(a.attribution_window_days, c.attribution_window_days),
         coalesce(a.prospect_protection_mode, c.prospect_protection_mode),
         case when a.prospect_protection_mode is not null
              then a.prospect_protection_months
              else coalesce(a.prospect_protection_months, c.prospect_protection_months) end,
         coalesce(a.post_end_survival_months, c.post_end_survival_months),
         coalesce(a.payout_frequency, c.payout_frequency),
         coalesce(a.payout_min_amount, c.payout_min_amount),
         coalesce(a.acquisition_trigger, c.acquisition_trigger),
         a.self_referral_allowed
    from public.affiliates a
    join public.affiliate_categories c on c.id = a.category_id
   where a.id = p_affiliate_id;
$$;

comment on function public.affiliate_effective_terms(uuid) is
  'Paramètres effectifs d''un affilié : surcharge individuelle, sinon défaut de sa catégorie. Lisible par l''affilié lui-même et par l''administration.';

revoke execute on function public.affiliate_effective_terms(uuid) from public, anon;
grant  execute on function public.affiliate_effective_terms(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. RÈGLES DE COMMISSION
--
-- Une ligne = une version. Ses paramètres ne changent jamais après
-- insertion ; seule sa fin de validité peut être posée, une fois, et jamais
-- dans le passé. Changer un taux, c'est clore la version en cours et en
-- ouvrir une nouvelle — `publish_affiliate_rule` fait les deux d'un bloc.
--
-- Les paliers sont un tableau JSON, aux mêmes clés que le moteur TypeScript :
-- `from`, `to`, `rate`, `fixedAmount`, `minCommission`, `maxCommission`,
-- `label`. Leur forme est vérifiée par contrainte : une grille qui laisserait
-- une assiette hors palier, ou dans deux paliers, ne peut pas exister.
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_tiers_valid(p_tiers jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_tier     jsonb;
  v_index    integer := 0;
  v_count    integer;
  v_expected numeric := 0;
  v_from     numeric;
  v_to       numeric;
  v_rate     numeric;
  v_has_rate boolean;
  v_has_fix  boolean;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' then
    return false;
  end if;
  v_count := jsonb_array_length(p_tiers);
  if v_count = 0 or v_count > 20 then
    return false;
  end if;

  for v_tier in select value from jsonb_array_elements(p_tiers) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_tier) <> 'object' or jsonb_typeof(v_tier -> 'from') <> 'number' then
      return false;
    end if;
    v_from := (v_tier ->> 'from')::numeric;
    if v_from <> v_expected or v_from <> round(v_from, 2) then
      return false;
    end if;

    if v_tier -> 'to' is null or jsonb_typeof(v_tier -> 'to') = 'null' then
      -- Seul le dernier palier est ouvert.
      if v_index <> v_count then
        return false;
      end if;
    else
      if jsonb_typeof(v_tier -> 'to') <> 'number' or v_index = v_count then
        return false;
      end if;
      v_to := (v_tier ->> 'to')::numeric;
      if v_to <= v_from or v_to <> round(v_to, 2) then
        return false;
      end if;
      v_expected := v_to;
    end if;

    v_has_rate := jsonb_typeof(v_tier -> 'rate') = 'number';
    v_has_fix  := jsonb_typeof(v_tier -> 'fixedAmount') = 'number';
    if v_has_rate = v_has_fix then
      return false;
    end if;
    if v_has_rate then
      v_rate := (v_tier ->> 'rate')::numeric;
      if v_rate <= 0 or v_rate > 100 or v_rate <> round(v_rate, 2) then
        return false;
      end if;
    end if;
    if v_has_fix and ((v_tier ->> 'fixedAmount')::numeric < 0
                      or (v_tier ->> 'fixedAmount')::numeric <> round((v_tier ->> 'fixedAmount')::numeric, 2)) then
      return false;
    end if;
    if jsonb_typeof(v_tier -> 'minCommission') = 'number' and (v_tier ->> 'minCommission')::numeric < 0 then
      return false;
    end if;
    if jsonb_typeof(v_tier -> 'maxCommission') = 'number' and (v_tier ->> 'maxCommission')::numeric < 0 then
      return false;
    end if;
    if jsonb_typeof(v_tier -> 'minCommission') = 'number'
       and jsonb_typeof(v_tier -> 'maxCommission') = 'number'
       and (v_tier ->> 'minCommission')::numeric > (v_tier ->> 'maxCommission')::numeric then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function public.affiliate_tiers_valid(jsonb) is
  'Vrai si la grille couvre [0, +∞) sans trou ni recouvrement, chaque palier portant un taux OU un montant fixe. Miroir de validateTiers().';


create table if not exists public.affiliate_rules (
  id                      uuid primary key default gen_random_uuid(),
  version                 integer not null default 1,
  -- Version précédente de la même règle (même propriétaire, même cible).
  supersedes_id           uuid references public.affiliate_rules (id) on delete restrict,

  owner_type              text not null,
  category_id             uuid references public.affiliate_categories (id) on delete restrict,
  affiliate_id            uuid references public.affiliates (id) on delete restrict,

  target_type             text not null default 'ALL',
  service_id              uuid references public.services (id) on delete restrict,
  product_id              uuid references public.products (id) on delete restrict,

  kind                    text not null,
  rate                    numeric(5, 2),
  fixed_amount            numeric(12, 2),
  tiers                   jsonb,
  min_commission          numeric(12, 2),
  max_commission          numeric(12, 2),
  min_base                numeric(12, 2),

  valid_from              timestamptz not null default now(),
  valid_to                timestamptz,

  label                   text,

  -- N1 : le plafond de l'offre ne s'applique pas à cette règle. Réservé aux
  -- règles d'un affilié, motivé, daté, et accordé sous permission dédiée.
  contractual_derogation  boolean not null default false,
  derogation_reason       text,
  derogation_granted_by   uuid references public.profiles (id) on delete set null,
  derogation_granted_at   timestamptz,

  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles (id) on delete set null,
  closed_at               timestamptz,
  closed_by               uuid references public.profiles (id) on delete set null,

  -- Clés techniques de la contrainte d'exclusion.
  owner_key               uuid generated always as (coalesce(category_id, affiliate_id)) stored,
  target_key              uuid generated always as (
                            coalesce(service_id, product_id, '00000000-0000-0000-0000-000000000000'::uuid)
                          ) stored,

  constraint affiliate_rules_owner_type check (owner_type in ('CATEGORY', 'AFFILIATE')),
  constraint affiliate_rules_owner_coherent check (
    (owner_type = 'CATEGORY'  and category_id is not null and affiliate_id is null)
    or (owner_type = 'AFFILIATE' and affiliate_id is not null and category_id is null)
  ),
  constraint affiliate_rules_target_type check (target_type in ('ALL', 'SERVICE', 'PRODUCT')),
  constraint affiliate_rules_target_coherent check (
    (target_type = 'ALL'     and service_id is null and product_id is null)
    or (target_type = 'SERVICE' and service_id is not null and product_id is null)
    or (target_type = 'PRODUCT' and product_id is not null and service_id is null)
  ),
  constraint affiliate_rules_kind check (kind in ('PERCENT', 'FIXED', 'TIERED', 'EXCLUDED')),
  constraint affiliate_rules_params_coherent check (
    (kind = 'PERCENT'  and rate is not null and fixed_amount is null and tiers is null)
    or (kind = 'FIXED'    and fixed_amount is not null and rate is null and tiers is null)
    or (kind = 'TIERED'   and tiers is not null and rate is null and fixed_amount is null)
    or (kind = 'EXCLUDED' and rate is null and fixed_amount is null and tiers is null
                          and min_commission is null and max_commission is null)
  ),
  constraint affiliate_rules_rate_range check (rate is null or (rate > 0 and rate <= 100)),
  constraint affiliate_rules_fixed_positive check (fixed_amount is null or fixed_amount > 0),
  constraint affiliate_rules_tiers_valid check (tiers is null or public.affiliate_tiers_valid(tiers)),
  constraint affiliate_rules_min_positive check (min_commission is null or min_commission >= 0),
  constraint affiliate_rules_max_positive check (max_commission is null or max_commission > 0),
  constraint affiliate_rules_min_le_max check (
    min_commission is null or max_commission is null or min_commission <= max_commission
  ),
  constraint affiliate_rules_min_base check (min_base is null or min_base >= 0),
  constraint affiliate_rules_period check (valid_to is null or valid_to > valid_from),
  constraint affiliate_rules_version_positive check (version >= 1),
  constraint affiliate_rules_label_length check (label is null or length(label) <= 120),
  constraint affiliate_rules_derogation_individual check (
    contractual_derogation = false or owner_type = 'AFFILIATE'
  ),
  constraint affiliate_rules_derogation_justified check (
    contractual_derogation = false
    or (derogation_reason is not null and btrim(derogation_reason) <> ''
        and derogation_granted_at is not null)
  ),
  constraint affiliate_rules_derogation_reason_length check (
    derogation_reason is null or length(derogation_reason) <= 1000
  ),

  -- Jamais deux versions en vigueur au même instant pour la même règle.
  constraint affiliate_rules_no_overlap exclude using gist (
    owner_type with =,
    owner_key  with =,
    target_type with =,
    target_key with =,
    tstzrange(valid_from, valid_to, '[)') with &&
  )
);

comment on table public.affiliate_rules is
  'Règles de commission versionnées. Paramètres immuables ; une modification clôt la version et en ouvre une autre. Héritage : offre affilié > offre catégorie > individuelle > catégorie.';
comment on column public.affiliate_rules.contractual_derogation is
  'N1 : la règle peut dépasser le plafond de l''offre. Individuelle, motivée, sous affiliate_rules.derogate. Ne lève jamais l''éligibilité.';

create index if not exists affiliate_rules_category_idx on public.affiliate_rules (category_id, valid_from desc);
create index if not exists affiliate_rules_affiliate_idx on public.affiliate_rules (affiliate_id, valid_from desc);


-- Immutabilité : seuls `valid_to`, `closed_at` et `closed_by` peuvent être
-- posés, une seule fois, et la fin ne peut pas précéder l'instant présent —
-- sans quoi une affaire passée non encore commissionnée changerait de règle.
-- Ce garde ne regarde pas le rôle : il vaut pour tous, fonctions comprises.
create or replace function public.tg_affiliate_rules_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Une version jamais entrée en vigueur peut être retirée ; une version
    -- qui a pu s'appliquer à une affaire, jamais.
    if old.valid_from <= now() then
      raise exception 'Une règle entrée en vigueur ne se supprime pas : elle se clôt.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if (new.version, new.supersedes_id, new.owner_type, new.category_id, new.affiliate_id,
      new.target_type, new.service_id, new.product_id, new.kind, new.rate, new.fixed_amount,
      new.tiers, new.min_commission, new.max_commission, new.min_base, new.valid_from,
      new.label, new.contractual_derogation, new.derogation_reason, new.derogation_granted_by,
      new.derogation_granted_at, new.created_at, new.created_by)
     is distinct from
     (old.version, old.supersedes_id, old.owner_type, old.category_id, old.affiliate_id,
      old.target_type, old.service_id, old.product_id, old.kind, old.rate, old.fixed_amount,
      old.tiers, old.min_commission, old.max_commission, old.min_base, old.valid_from,
      old.label, old.contractual_derogation, old.derogation_reason, old.derogation_granted_by,
      old.derogation_granted_at, old.created_at, old.created_by) then
    raise exception 'Une règle de commission ne se modifie pas : publiez une nouvelle version.'
      using errcode = 'check_violation';
  end if;

  -- Une fin déjà survenue est un fait : elle ne bouge plus. Une fin encore
  -- future peut être levée ou déplacée (retrait d'une version programmée).
  if old.valid_to is not null and old.valid_to <= now()
     and new.valid_to is distinct from old.valid_to then
    raise exception 'La fin de cette règle est déjà survenue.' using errcode = 'check_violation';
  end if;

  if new.valid_to is not null and new.valid_to is distinct from old.valid_to
     and new.valid_to < now() - interval '1 minute' then
    raise exception 'Une règle ne se clôt pas dans le passé.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.tg_affiliate_rules_immutable() is
  'Interdit toute modification des paramètres d''une règle ; seule sa fin peut être posée, une fois, et pas dans le passé.';

drop trigger if exists affiliate_rules_immutable on public.affiliate_rules;
create trigger affiliate_rules_immutable
  before update or delete on public.affiliate_rules
  for each row execute function public.tg_affiliate_rules_immutable();


-- -----------------------------------------------------------------------------
-- 8. LE CALCUL EN BASE
--
-- Même ordre d'opérations que `computeCommission()` :
--   exclusion → assiette nulle → seuil → palier → bornes du palier →
--   bornes de la règle → plafond de l'offre (N1, sauf dérogation).
-- Arrondi : `round(…, 2)` de PostgreSQL arrondit le demi à l'opposé de zéro,
-- donc au demi supérieur pour une assiette positive — comme le moteur
-- TypeScript. `scripts/verify-affiliation.mjs` compare les deux sur les cas
-- de la convention.
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_compute(
  p_kind      text,
  p_rate      numeric,
  p_fixed     numeric,
  p_tiers     jsonb,
  p_min       numeric,
  p_max       numeric,
  p_min_base  numeric,
  p_base      numeric,
  p_cap_rate  numeric default null
)
returns table (
  eligible     boolean,
  reason       text,
  applied_rate numeric,
  tier_index   integer,
  raw_amount   numeric,
  amount       numeric,
  min_applied  boolean,
  max_applied  boolean,
  cap_applied  boolean
)
language plpgsql
immutable
as $$
declare
  v_base   numeric := round(coalesce(p_base, 0), 2);
  v_rate   numeric;
  v_raw    numeric;
  v_value  numeric;
  v_tier   jsonb;
  v_idx    integer;
  v_min_t  boolean := false;
  v_max_t  boolean := false;
  v_min_r  boolean := false;
  v_max_r  boolean := false;
  v_cap    boolean := false;
  v_before numeric;
  v_cap_amount numeric;
begin
  if v_base < 0 then
    raise exception 'L''assiette ne peut pas être négative.' using errcode = 'check_violation';
  end if;

  if p_kind = 'EXCLUDED' then
    return query select false, 'EXCLUE', null::numeric, null::integer, 0::numeric, 0::numeric, false, false, false;
    return;
  end if;
  if v_base = 0 then
    return query select false, 'ASSIETTE_NULLE', null::numeric, null::integer, 0::numeric, 0::numeric, false, false, false;
    return;
  end if;
  if p_min_base is not null and v_base < p_min_base then
    return query select false, 'SOUS_SEUIL', null::numeric, null::integer, 0::numeric, 0::numeric, false, false, false;
    return;
  end if;

  if p_kind = 'PERCENT' then
    v_rate := p_rate;
    v_raw := round(v_base * p_rate / 100, 2);
    v_value := v_raw;
  elsif p_kind = 'FIXED' then
    v_raw := p_fixed;
    v_value := v_raw;
  elsif p_kind = 'TIERED' then
    select t.value, (t.ordinality - 1)::integer
      into v_tier, v_idx
      from jsonb_array_elements(p_tiers) with ordinality as t(value, ordinality)
     where v_base >= (t.value ->> 'from')::numeric
       and (jsonb_typeof(t.value -> 'to') is distinct from 'number'
            or v_base < (t.value ->> 'to')::numeric)
     order by t.ordinality
     limit 1;
    if v_tier is null then
      raise exception 'Grille de paliers incomplète.' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_tier -> 'rate') = 'number' then
      v_rate := (v_tier ->> 'rate')::numeric;
      v_raw := round(v_base * v_rate / 100, 2);
    else
      v_raw := (v_tier ->> 'fixedAmount')::numeric;
    end if;
    v_value := v_raw;
    if jsonb_typeof(v_tier -> 'minCommission') = 'number' and v_value < (v_tier ->> 'minCommission')::numeric then
      v_value := (v_tier ->> 'minCommission')::numeric;
      v_min_t := true;
    end if;
    if jsonb_typeof(v_tier -> 'maxCommission') = 'number' and v_value > (v_tier ->> 'maxCommission')::numeric then
      v_value := (v_tier ->> 'maxCommission')::numeric;
      v_max_t := true;
      v_min_t := false;
    end if;
  else
    raise exception 'Type de règle inconnu : %', p_kind using errcode = 'check_violation';
  end if;

  v_before := v_value;
  if p_min is not null and v_value < p_min then
    v_value := p_min;
    v_min_r := true;
  end if;
  if p_max is not null and v_value > p_max then
    v_value := p_max;
    v_max_r := true;
    v_min_r := false;
  end if;

  if v_value <> v_before then
    v_min_t := v_min_r;
    v_max_t := v_max_r;
  end if;

  -- N1 : le plafond de l'offre protège la marge, plancher compris.
  if p_cap_rate is not null then
    v_cap_amount := round(v_base * p_cap_rate / 100, 2);
    if v_value > v_cap_amount then
      v_value := v_cap_amount;
      v_cap := true;
    end if;
  end if;

  return query select true, 'OK', v_rate, v_idx, v_raw, v_value, v_min_t, v_max_t, v_cap;
end;
$$;

comment on function public.affiliate_compute(text, numeric, numeric, jsonb, numeric, numeric, numeric, numeric, numeric) is
  'Calcul pur d''une commission. Miroir exact de computeCommission() (src/lib/domain/affiliation.ts). Le plafond d''offre est passé NULL pour une dérogation contractuelle.';


-- Quelle règle s'applique ? Même ordre que `resolveRule()`. Deux règles au
-- même niveau ne peuvent pas exister (contrainte d'exclusion) : `limit 1`
-- n'arbitre donc rien.
create or replace function public.affiliate_resolve_rule(
  p_affiliate_id uuid,
  p_service_id   uuid,
  p_product_id   uuid,
  p_at           timestamptz
)
returns table (rule_id uuid, origin text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with a as (
    select id, category_id from public.affiliates where id = p_affiliate_id
  ),
  candidates as (
    select r.id,
           case
             when r.owner_type = 'AFFILIATE' and r.target_type <> 'ALL' then 1
             when r.owner_type = 'CATEGORY'  and r.target_type <> 'ALL' then 2
             when r.owner_type = 'AFFILIATE' then 3
             else 4
           end as level
      from public.affiliate_rules r, a
     where r.valid_from <= p_at
       and (r.valid_to is null or r.valid_to > p_at)
       and (
         (r.owner_type = 'AFFILIATE' and r.affiliate_id = a.id)
         or (r.owner_type = 'CATEGORY' and r.category_id = a.category_id)
       )
       and (
         r.target_type = 'ALL'
         or (r.target_type = 'SERVICE' and p_service_id is not null and r.service_id = p_service_id)
         or (r.target_type = 'PRODUCT' and p_product_id is not null and r.product_id = p_product_id)
       )
  )
  select c.id,
         case c.level
           when 1 then 'OFFRE_AFFILIE'
           when 2 then 'OFFRE_CATEGORIE'
           when 3 then 'INDIVIDUELLE'
           else 'CATEGORIE'
         end
    from candidates c
   order by c.level
   limit 1;
$$;

comment on function public.affiliate_resolve_rule(uuid, uuid, uuid, timestamptz) is
  'Règle applicable à un affilié, une offre et une date, et son origine. Miroir de resolveRule().';

revoke execute on function public.affiliate_resolve_rule(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.affiliate_resolve_rule(uuid, uuid, uuid, timestamptz) to service_role;


-- Instantané d'une règle, aux clés du moteur TypeScript (`ruleSnapshot`).
-- C'est ce que les commissions (lot 4H-5) conserveront.
create or replace function public.affiliate_rule_snapshot(p_rule_id uuid, p_origin text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'schema',        'affiliation-regle-1',
           'ruleId',        r.id,
           'version',       r.version,
           'origin',        p_origin,
           'owner',         jsonb_build_object('type', r.owner_type, 'id', coalesce(r.category_id, r.affiliate_id)),
           'target',        case r.target_type
                              when 'ALL' then jsonb_build_object('type', 'ALL')
                              else jsonb_build_object('type', r.target_type, 'id', coalesce(r.service_id, r.product_id))
                            end,
           'kind',          r.kind,
           'rate',          r.rate,
           'fixedAmount',   r.fixed_amount,
           'tiers',         coalesce(r.tiers, '[]'::jsonb),
           'minCommission', r.min_commission,
           'maxCommission', r.max_commission,
           'minBase',       r.min_base,
           'validFrom',     r.valid_from,
           'validTo',       r.valid_to,
           'label',         r.label,
           'contractualDerogation', r.contractual_derogation
         )
    from public.affiliate_rules r
   where r.id = p_rule_id;
$$;

revoke execute on function public.affiliate_rule_snapshot(uuid, text) from public, anon, authenticated;
grant  execute on function public.affiliate_rule_snapshot(uuid, text) to service_role;


-- -----------------------------------------------------------------------------
-- 9. HISTORIQUE ET AUDIT
--
-- `affiliate_events` est la chronologie lisible de la fiche affilié :
-- ancienne valeur, nouvelle valeur, motif, auteur. `audit_logs` garde la
-- trace transverse. Les deux sont en ajout seul.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_events (
  id           bigint generated always as identity primary key,
  affiliate_id uuid references public.affiliates (id) on delete cascade,
  category_id  uuid references public.affiliate_categories (id) on delete cascade,
  event_type   text not null,
  summary      text not null,
  old_value    jsonb,
  new_value    jsonb,
  reason       text,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_label  text,
  created_at   timestamptz not null default now(),
  constraint affiliate_events_subject check (affiliate_id is not null or category_id is not null),
  constraint affiliate_events_type_format check (event_type ~ '^[A-Z][A-Z_]{2,48}$'),
  constraint affiliate_events_summary_length check (length(summary) <= 300),
  constraint affiliate_events_reason_length check (reason is null or length(reason) <= 1000)
);

create index if not exists affiliate_events_affiliate_idx on public.affiliate_events (affiliate_id, created_at desc);
create index if not exists affiliate_events_category_idx on public.affiliate_events (category_id, created_at desc);

create or replace function public.tg_affiliate_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'L''historique de l''affiliation ne se modifie pas.' using errcode = 'check_violation';
end;
$$;

drop trigger if exists affiliate_events_append_only on public.affiliate_events;
create trigger affiliate_events_append_only
  before update or delete on public.affiliate_events
  for each row execute function public.tg_affiliate_events_append_only();


-- Écrit un événement et sa trace d'audit. Interne : appelé par les
-- déclencheurs et les fonctions d'administration, jamais par une session.
create or replace function public.affiliation_log(
  p_affiliate_id uuid,
  p_category_id  uuid,
  p_event_type   text,
  p_summary      text,
  p_old          jsonb default null,
  p_new          jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := public.affiliation_current_reason();
  v_label  text := public.relation_actor_label();
begin
  insert into public.affiliate_events
    (affiliate_id, category_id, event_type, summary, old_value, new_value, reason, actor_id, actor_label)
  values
    (p_affiliate_id, p_category_id, p_event_type, left(p_summary, 300), p_old, p_new,
     left(v_reason, 1000), auth.uid(), v_label);

  insert into public.audit_logs (actor_id, actor_label, action, resource_type, resource_id, metadata)
  values (
    auth.uid(), v_label,
    'affiliation.' || lower(p_event_type),
    case when p_affiliate_id is not null then 'affiliate' else 'affiliate_category' end,
    coalesce(p_affiliate_id, p_category_id)::text,
    jsonb_strip_nulls(jsonb_build_object('avant', p_old, 'apres', p_new, 'motif', v_reason))
  );
end;
$$;

comment on function public.affiliation_log(uuid, uuid, text, text, jsonb, jsonb) is
  'Écrit un événement d''affiliation et sa trace d''audit, avec auteur et motif de la session. Interne.';

revoke execute on function public.affiliation_log(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.affiliation_log(uuid, uuid, text, text, jsonb, jsonb) to service_role;


-- Différence lisible entre deux états d'une ligne : seules les colonnes qui
-- changent, sans les horodatages techniques.
create or replace function public.affiliation_row_diff(p_old jsonb, p_new jsonb)
returns table (old_value jsonb, new_value jsonb)
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(k, p_old -> k), '{}'::jsonb),
         coalesce(jsonb_object_agg(k, p_new -> k), '{}'::jsonb)
    from jsonb_object_keys(p_new) as k
   where k not in ('updated_at', 'updated_by', 'created_at', 'created_by')
     and (p_old -> k) is distinct from (p_new -> k);
$$;


create or replace function public.tg_affiliates_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_type text;
begin
  if tg_op = 'INSERT' then
    perform public.affiliation_log(new.id, null, 'AFFILIE_CREE',
      format('Affilié créé : %s', new.display_name), null,
      jsonb_build_object('categorie', new.category_id, 'statut', new.status, 'slug', new.slug));
    return new;
  end if;

  select d.old_value, d.new_value into v_old, v_new
    from public.affiliation_row_diff(to_jsonb(old), to_jsonb(new)) d;
  if v_new = '{}'::jsonb then
    return new;
  end if;

  v_type := case
    when new.status is distinct from old.status then 'STATUT_' || new.status
    when new.category_id is distinct from old.category_id then 'CATEGORIE_CHANGEE'
    when new.self_referral_allowed is distinct from old.self_referral_allowed then 'AUTO_AFFILIATION'
    when (new.attribution_window_days, new.prospect_protection_mode, new.prospect_protection_months,
          new.post_end_survival_months, new.payout_frequency, new.payout_min_amount, new.acquisition_trigger)
         is distinct from
         (old.attribution_window_days, old.prospect_protection_mode, old.prospect_protection_months,
          old.post_end_survival_months, old.payout_frequency, old.payout_min_amount, old.acquisition_trigger)
      then 'PARAMETRES_MODIFIES'
    else 'IDENTITE_MODIFIEE'
  end;

  perform public.affiliation_log(new.id, null, v_type,
    format('%s — %s', new.display_name, replace(lower(v_type), '_', ' ')), v_old, v_new);
  return new;
end;
$$;

drop trigger if exists affiliates_history on public.affiliates;
create trigger affiliates_history
  after insert or update on public.affiliates
  for each row execute function public.tg_affiliates_history();


create or replace function public.tg_affiliate_categories_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.affiliation_log(null, new.id, 'CATEGORIE_CREEE',
      format('Catégorie créée : %s', new.label), null, to_jsonb(new) - 'created_at' - 'updated_at');
    return new;
  end if;
  select d.old_value, d.new_value into v_old, v_new
    from public.affiliation_row_diff(to_jsonb(old), to_jsonb(new)) d;
  if v_new <> '{}'::jsonb then
    perform public.affiliation_log(null, new.id, 'CATEGORIE_MODIFIEE',
      format('Catégorie modifiée : %s', new.label), v_old, v_new);
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_categories_history on public.affiliate_categories;
create trigger affiliate_categories_history
  after insert or update on public.affiliate_categories
  for each row execute function public.tg_affiliate_categories_history();


create or replace function public.tg_affiliate_rules_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    v_snapshot := to_jsonb(new) - 'owner_key' - 'target_key' - 'created_at';
    perform public.affiliation_log(new.affiliate_id, new.category_id,
      case when new.contractual_derogation then 'DEROGATION_ACCORDEE' else 'REGLE_PUBLIEE' end,
      format('Règle %s publiée (version %s, effet %s)', lower(new.kind), new.version,
             to_char(new.valid_from at time zone 'Indian/Comoro', 'DD/MM/YYYY HH24:MI')),
      null, v_snapshot);
  elsif tg_op = 'UPDATE' and new.valid_to is null and old.valid_to is not null then
    perform public.affiliation_log(new.affiliate_id, new.category_id, 'REGLE_ROUVERTE',
      format('Règle %s rouverte après retrait de la version programmée (version %s)', lower(new.kind), new.version),
      jsonb_build_object('valid_to', old.valid_to), jsonb_build_object('valid_to', null));
  elsif tg_op = 'UPDATE' and new.valid_to is distinct from old.valid_to then
    perform public.affiliation_log(new.affiliate_id, new.category_id, 'REGLE_CLOSE',
      format('Règle %s close (version %s, fin %s)', lower(new.kind), new.version,
             to_char(new.valid_to at time zone 'Indian/Comoro', 'DD/MM/YYYY HH24:MI')),
      jsonb_build_object('valid_to', old.valid_to), jsonb_build_object('valid_to', new.valid_to));
  elsif tg_op = 'DELETE' then
    perform public.affiliation_log(old.affiliate_id, old.category_id, 'REGLE_RETIREE',
      format('Version programmée retirée avant son entrée en vigueur (version %s)', old.version),
      to_jsonb(old) - 'owner_key' - 'target_key', null);
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_rules_history on public.affiliate_rules;
create trigger affiliate_rules_history
  after insert or update or delete on public.affiliate_rules
  for each row execute function public.tg_affiliate_rules_history();


-- -----------------------------------------------------------------------------
-- 10. PUBLIER, CLORE, RETIRER UNE RÈGLE
--
-- Aucune écriture directe sur `affiliate_rules` n'est accordée à une
-- session : ces trois fonctions sont la seule porte. Elles vérifient
-- elles-mêmes les permissions avec `has_permission()`, qui lit le jeton de la
-- session — un garde qui interrogerait le rôle de base verrait `postgres` à
-- l'intérieur d'une fonction SECURITY DEFINER et ne refuserait rien (4F).
-- -----------------------------------------------------------------------------

create or replace function public.publish_affiliate_rule(
  p_owner_type        text,
  p_owner_id          uuid,
  p_target_type       text,
  p_target_id         uuid,
  p_kind              text,
  p_rate              numeric,
  p_fixed_amount      numeric,
  p_tiers             jsonb,
  p_min_commission    numeric,
  p_max_commission    numeric,
  p_min_base          numeric,
  p_effective_at      timestamptz,
  p_label             text,
  p_reason            text,
  p_derogation        boolean default false,
  p_derogation_reason text default null
)
returns public.affiliate_rules
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_at       timestamptz := coalesce(p_effective_at, now());
  v_current  public.affiliate_rules%rowtype;
  v_new      public.affiliate_rules%rowtype;
  v_version  integer := 1;
  v_lock     text;
begin
  if not public.has_permission('affiliate_rules.manage') then
    raise exception 'Permission affiliate_rules.manage requise.' using errcode = '42501';
  end if;
  if coalesce(p_derogation, false) and not public.has_permission('affiliate_rules.derogate') then
    raise exception 'Permission affiliate_rules.derogate requise pour une dérogation contractuelle.'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un motif est requis pour toute modification de règle.' using errcode = 'check_violation';
  end if;
  -- Une date d'effet passée réécrirait la règle d'affaires déjà conclues.
  if v_at < now() - interval '1 minute' then
    raise exception 'La date d''effet ne peut pas être dans le passé.' using errcode = 'check_violation';
  end if;
  if v_at < now() then
    v_at := now();
  end if;
  -- `numeric(5, 2)` arrondirait en silence un taux à trois décimales : on
  -- refuse plutôt que d'enregistrer autre chose que ce qui a été saisi.
  if (p_rate is not null and p_rate <> round(p_rate, 2))
     or (p_fixed_amount is not null and p_fixed_amount <> round(p_fixed_amount, 2))
     or (p_min_commission is not null and p_min_commission <> round(p_min_commission, 2))
     or (p_max_commission is not null and p_max_commission <> round(p_max_commission, 2))
     or (p_min_base is not null and p_min_base <> round(p_min_base, 2)) then
    raise exception 'Deux décimales au plus pour un taux ou un montant.' using errcode = 'check_violation';
  end if;
  if coalesce(p_derogation, false)
     and (p_derogation_reason is null or btrim(p_derogation_reason) = '') then
    raise exception 'Le motif de la dérogation contractuelle est obligatoire.' using errcode = 'check_violation';
  end if;

  if p_owner_type = 'CATEGORY' then
    perform 1 from public.affiliate_categories where id = p_owner_id;
  elsif p_owner_type = 'AFFILIATE' then
    perform 1 from public.affiliates where id = p_owner_id and status <> 'TERMINE';
  else
    raise exception 'Propriétaire de règle invalide.' using errcode = 'check_violation';
  end if;
  if not found then
    raise exception 'Catégorie ou affilié introuvable (ou clos).' using errcode = 'no_data_found';
  end if;

  if p_target_type = 'SERVICE' then
    perform 1 from public.services where id = p_target_id;
    if not found then raise exception 'Service introuvable.' using errcode = 'no_data_found'; end if;
  elsif p_target_type = 'PRODUCT' then
    perform 1 from public.products where id = p_target_id;
    if not found then raise exception 'Produit introuvable.' using errcode = 'no_data_found'; end if;
  elsif p_target_type <> 'ALL' then
    raise exception 'Cible de règle invalide.' using errcode = 'check_violation';
  end if;

  -- Sérialise les publications concurrentes d'une même règle.
  v_lock := concat_ws(':', 'affiliate_rule', p_owner_type, p_owner_id, p_target_type, coalesce(p_target_id::text, '-'));
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  if exists (
    select 1 from public.affiliate_rules r
     where r.owner_type = p_owner_type
       and r.owner_key = p_owner_id
       and r.target_type = p_target_type
       and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and r.valid_from > now()
  ) then
    raise exception 'Une version future est déjà programmée pour cette règle : retirez-la d''abord.'
      using errcode = 'check_violation';
  end if;

  select * into v_current
    from public.affiliate_rules r
   where r.owner_type = p_owner_type
     and r.owner_key = p_owner_id
     and r.target_type = p_target_type
     and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and (r.valid_to is null or r.valid_to > v_at)
   order by r.valid_from desc
   limit 1
   for update;

  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);

  if found then
    v_version := v_current.version + 1;
    update public.affiliate_rules
       set valid_to  = v_at,
           closed_at = now(),
           closed_by = auth.uid()
     where id = v_current.id;
  else
    select coalesce(max(r.version), 0) + 1 into v_version
      from public.affiliate_rules r
     where r.owner_type = p_owner_type
       and r.owner_key = p_owner_id
       and r.target_type = p_target_type
       and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  insert into public.affiliate_rules (
    version, supersedes_id, owner_type, category_id, affiliate_id,
    target_type, service_id, product_id,
    kind, rate, fixed_amount, tiers, min_commission, max_commission, min_base,
    valid_from, label,
    contractual_derogation, derogation_reason, derogation_granted_by, derogation_granted_at,
    created_by
  ) values (
    v_version, v_current.id, p_owner_type,
    case when p_owner_type = 'CATEGORY' then p_owner_id end,
    case when p_owner_type = 'AFFILIATE' then p_owner_id end,
    p_target_type,
    case when p_target_type = 'SERVICE' then p_target_id end,
    case when p_target_type = 'PRODUCT' then p_target_id end,
    p_kind, p_rate, p_fixed_amount, p_tiers, p_min_commission, p_max_commission, p_min_base,
    v_at, nullif(left(btrim(coalesce(p_label, '')), 120), ''),
    coalesce(p_derogation, false),
    case when coalesce(p_derogation, false) then left(btrim(coalesce(p_derogation_reason, '')), 1000) end,
    case when coalesce(p_derogation, false) then auth.uid() end,
    case when coalesce(p_derogation, false) then now() end,
    auth.uid()
  )
  returning * into v_new;

  return v_new;
end;
$fn$;

comment on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) is
  'Publie une nouvelle version d''une règle : clôt la version en cours à la date d''effet et ouvre la suivante, d''un bloc. Motif obligatoire ; dérogation sous affiliate_rules.derogate.';

revoke execute on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) from public, anon;
grant  execute on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) to authenticated, service_role;


-- Clore une règle sans la remplacer : le niveau d'héritage suivant reprend la
-- main à la date de fin.
create or replace function public.end_affiliate_rule(
  p_rule_id uuid,
  p_end_at  timestamptz,
  p_reason  text
)
returns public.affiliate_rules
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rule public.affiliate_rules%rowtype;
  v_at   timestamptz := greatest(coalesce(p_end_at, now()), now());
begin
  if not public.has_permission('affiliate_rules.manage') then
    raise exception 'Permission affiliate_rules.manage requise.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un motif est requis.' using errcode = 'check_violation';
  end if;

  select * into v_rule from public.affiliate_rules where id = p_rule_id for update;
  if not found then
    raise exception 'Règle introuvable.' using errcode = 'no_data_found';
  end if;
  if v_rule.valid_to is not null then
    raise exception 'Cette règle a déjà une date de fin.' using errcode = 'check_violation';
  end if;
  if v_rule.contractual_derogation and not public.has_permission('affiliate_rules.derogate') then
    raise exception 'Permission affiliate_rules.derogate requise pour clore une dérogation.' using errcode = '42501';
  end if;
  if v_at <= v_rule.valid_from then
    raise exception 'Cette version n''est pas encore en vigueur : retirez-la plutôt.' using errcode = 'check_violation';
  end if;

  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  update public.affiliate_rules
     set valid_to = v_at, closed_at = now(), closed_by = auth.uid()
   where id = p_rule_id
  returning * into v_rule;
  return v_rule;
end;
$fn$;

revoke execute on function public.end_affiliate_rule(uuid, timestamptz, text) from public, anon;
grant  execute on function public.end_affiliate_rule(uuid, timestamptz, text) to authenticated, service_role;


-- Retirer une version programmée qui n'est jamais entrée en vigueur.
create or replace function public.withdraw_affiliate_rule(p_rule_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rule public.affiliate_rules%rowtype;
begin
  if not public.has_permission('affiliate_rules.manage') then
    raise exception 'Permission affiliate_rules.manage requise.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un motif est requis.' using errcode = 'check_violation';
  end if;
  select * into v_rule from public.affiliate_rules where id = p_rule_id for update;
  if not found then
    raise exception 'Règle introuvable.' using errcode = 'no_data_found';
  end if;
  if v_rule.contractual_derogation and not public.has_permission('affiliate_rules.derogate') then
    raise exception 'Permission affiliate_rules.derogate requise.' using errcode = '42501';
  end if;
  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  -- Le déclencheur d'immutabilité refuse si la version a pris effet.
  delete from public.affiliate_rules where id = p_rule_id;
  -- La version précédente avait reçu pour fin la date d'effet de celle-ci,
  -- qui n'a jamais commencé : elle redevient ouverte, sans trou.
  if v_rule.supersedes_id is not null then
    update public.affiliate_rules
       set valid_to = null, closed_at = null, closed_by = null
     where id = v_rule.supersedes_id
       and valid_to = v_rule.valid_from
       and valid_to > now();
  end if;
end;
$fn$;

revoke execute on function public.withdraw_affiliate_rule(uuid, text) from public, anon;
grant  execute on function public.withdraw_affiliate_rule(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 11. PRIVILÈGES ET RLS
--
--   * Aucune table n'est lisible par le rôle anonyme.
--   * L'affilié lit SA ligne, SA catégorie, et les règles qui le concernent
--     (les siennes et celles de sa catégorie) : « règles actuelles visibles ».
--     Il ne lit ni les notes internes, ni l'historique, ni un autre affilié.
--   * L'administration lit sous `affiliates.view`.
--   * Écritures : catégories sous `affiliate_rules.manage` ; identité de
--     l'affilié sous `affiliates.update`, et seulement sur les colonnes
--     d'identité. Statut, référence, compte, catégorie et paramètres
--     financiers passent par des fonctions (lots suivants). Règles : aucune
--     écriture directe.
-- -----------------------------------------------------------------------------

revoke all on public.affiliate_categories from anon, authenticated;
revoke all on public.affiliates           from anon, authenticated;
revoke all on public.affiliate_notes      from anon, authenticated;
revoke all on public.affiliate_rules      from anon, authenticated;
revoke all on public.affiliate_events     from anon, authenticated;

grant select on public.affiliate_categories to authenticated;
grant insert (code, label, description, is_active, is_internal, sort_order,
              attribution_window_days, prospect_protection_mode, prospect_protection_months,
              post_end_survival_months, payout_frequency, payout_min_amount, acquisition_trigger)
  on public.affiliate_categories to authenticated;
grant update (label, description, is_active, is_internal, sort_order,
              attribution_window_days, prospect_protection_mode, prospect_protection_months,
              post_end_survival_months, payout_frequency, payout_min_amount, acquisition_trigger)
  on public.affiliate_categories to authenticated;

grant select on public.affiliates to authenticated;
grant update (display_name, legal_name, party_type, contact_email, contact_phone, country, city,
              contract_reference, contract_signed_on, started_on)
  on public.affiliates to authenticated;

grant select, insert on public.affiliate_notes to authenticated;
grant select on public.affiliate_rules  to authenticated;
grant select on public.affiliate_events to authenticated;

grant all on public.affiliate_categories, public.affiliates, public.affiliate_notes,
             public.affiliate_rules, public.affiliate_events to service_role;


alter table public.affiliate_categories enable row level security;
alter table public.affiliates           enable row level security;
alter table public.affiliate_notes      enable row level security;
alter table public.affiliate_rules      enable row level security;
alter table public.affiliate_events     enable row level security;


drop policy if exists affiliate_categories_select on public.affiliate_categories;
create policy affiliate_categories_select
  on public.affiliate_categories for select to authenticated
  using (
    public.can_view_affiliation()
    or exists (select 1 from public.affiliates a
                where a.category_id = affiliate_categories.id and a.user_id = auth.uid())
  );

drop policy if exists affiliate_categories_insert on public.affiliate_categories;
create policy affiliate_categories_insert
  on public.affiliate_categories for insert to authenticated
  with check (public.has_permission('affiliate_rules.manage'));

drop policy if exists affiliate_categories_update on public.affiliate_categories;
create policy affiliate_categories_update
  on public.affiliate_categories for update to authenticated
  using (public.has_permission('affiliate_rules.manage'))
  with check (public.has_permission('affiliate_rules.manage'));


drop policy if exists affiliates_select_own on public.affiliates;
create policy affiliates_select_own
  on public.affiliates for select to authenticated
  using (user_id = auth.uid());

drop policy if exists affiliates_select_admin on public.affiliates;
create policy affiliates_select_admin
  on public.affiliates for select to authenticated
  using (public.can_view_affiliation());

drop policy if exists affiliates_update_admin on public.affiliates;
create policy affiliates_update_admin
  on public.affiliates for update to authenticated
  using (public.has_permission('affiliates.update'))
  with check (public.has_permission('affiliates.update'));


drop policy if exists affiliate_notes_select on public.affiliate_notes;
create policy affiliate_notes_select
  on public.affiliate_notes for select to authenticated
  using (public.can_view_affiliation());

drop policy if exists affiliate_notes_insert on public.affiliate_notes;
create policy affiliate_notes_insert
  on public.affiliate_notes for insert to authenticated
  with check (public.has_permission('affiliates.update') and author_id = auth.uid());


drop policy if exists affiliate_rules_select_admin on public.affiliate_rules;
create policy affiliate_rules_select_admin
  on public.affiliate_rules for select to authenticated
  using (public.can_view_affiliation());

drop policy if exists affiliate_rules_select_own on public.affiliate_rules;
create policy affiliate_rules_select_own
  on public.affiliate_rules for select to authenticated
  using (
    exists (
      select 1 from public.affiliates a
       where a.user_id = auth.uid()
         and a.status <> 'PREPARATION'
         and (a.id = affiliate_rules.affiliate_id or a.category_id = affiliate_rules.category_id)
    )
  );


drop policy if exists affiliate_events_select on public.affiliate_events;
create policy affiliate_events_select
  on public.affiliate_events for select to authenticated
  using (public.can_view_affiliation());


-- Auteur des notes : toujours la session, jamais une valeur reçue.
create or replace function public.tg_affiliate_notes_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.author_label := public.relation_actor_label();
  return new;
end;
$$;

drop trigger if exists affiliate_notes_author on public.affiliate_notes;
create trigger affiliate_notes_author
  before insert on public.affiliate_notes
  for each row execute function public.tg_affiliate_notes_author();

-- Auteur des modifications de catégorie et d'affilié.
create or replace function public.tg_affiliation_stamp_author()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_categories_stamp_author on public.affiliate_categories;
create trigger affiliate_categories_stamp_author
  before insert or update on public.affiliate_categories
  for each row execute function public.tg_affiliation_stamp_author();

drop trigger if exists affiliates_stamp_author on public.affiliates;
create trigger affiliates_stamp_author
  before insert or update on public.affiliates
  for each row execute function public.tg_affiliation_stamp_author();


-- -----------------------------------------------------------------------------
-- 12. CE QUI RESTE AUX LOTS SUIVANTS
--
--   * 4H-2 — candidatures, page d'inscription, e-mails.
--   * 4H-3 — création et activation d'un affilié (référence AFIL), liens,
--     campagnes, codes de réduction, coordonnées de paiement.
--   * 4H-4 — clics, cookie d'attribution, prospects, attributions.
--   * 4H-5 — commissions (référence COMAF, instantané de règle), ajustements.
--   * 4H-6 — versements.
--   * 4H-7 — fiche FIAF et relevé RVAF.
-- -----------------------------------------------------------------------------
