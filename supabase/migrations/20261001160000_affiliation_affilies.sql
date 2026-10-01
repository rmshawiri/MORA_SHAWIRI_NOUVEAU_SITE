-- =============================================================================
-- PHASE 4H-3 — AFFILIATION : AFFILIÉS, ACTIVATION, LIENS, CODES, VERSEMENTS
--
-- Ce que cette migration pose :
--
--   1. l'interdiction de toute auto-décision : un administrateur qui est
--      lui-même affilié n'agit jamais sur sa propre affiliation ;
--   2. les coordonnées de versement : demande, validation, historique
--      (décision J) ;
--   3. l'activation : compte rattaché, configuration financière complète,
--      référence AFIL allouée une seule fois ;
--   4. les changements de statut, de catégorie et de paramètres ;
--   5. les campagnes (liens secondaires) ;
--   6. les codes de réduction (décisions I et N4) ;
--   7. les privilèges et la RLS.
--
-- ## Le compte d'un affilié
--
-- Il est retrouvé par son adresse : un candidat déjà client garde son compte
-- et reçoit en plus le rôle AFFILIE ; un nouveau compte n'est créé que s'il
-- n'en existe aucun. La base vérifie que le compte rattaché porte bien
-- l'adresse de l'affilié : un administrateur ne peut pas rattacher une
-- affiliation au compte d'un tiers.
--
-- ## Ce qui ne bouge jamais
--
-- Une coordonnée de versement validée puis remplacée reste en base, au
-- statut REMPLACE. Les versements (lot 4H-6) figeront celle qu'ils ont
-- réellement utilisée : changer de moyen en novembre ne réécrit pas octobre.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PAS D'AUTO-DÉCISION
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_is_caller(p_affiliate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.affiliates a
     where a.id = p_affiliate_id and a.user_id is not null and a.user_id = auth.uid()
  );
$$;

comment on function public.affiliate_is_caller(uuid) is
  'Vrai si l''affiliation désignée appartient au compte de la session. Sert à interdire toute auto-décision.';

revoke execute on function public.affiliate_is_caller(uuid) from public, anon;
grant  execute on function public.affiliate_is_caller(uuid) to authenticated, service_role;

-- Une règle ne se publie pas pour soi-même. `auth.uid()` traverse la
-- frontière SECURITY DEFINER : ce garde tient même quand la règle est écrite
-- par `publish_affiliate_rule`.
create or replace function public.tg_affiliate_rules_not_self()
returns trigger
language plpgsql
as $$
begin
  if new.affiliate_id is not null and public.affiliate_is_caller(new.affiliate_id) then
    raise exception 'Vous ne pouvez pas fixer les règles de votre propre affiliation.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_rules_not_self on public.affiliate_rules;
create trigger affiliate_rules_not_self
  before insert on public.affiliate_rules
  for each row execute function public.tg_affiliate_rules_not_self();


-- -----------------------------------------------------------------------------
-- 2. LE COMPTE D'UN AFFILIÉ
-- -----------------------------------------------------------------------------

-- Lecture d'`auth.users` par adresse : réservée au serveur.
create or replace function public.find_auth_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;

revoke execute on function public.find_auth_user_by_email(text) from public, anon, authenticated;
grant  execute on function public.find_auth_user_by_email(text) to service_role;


-- -----------------------------------------------------------------------------
-- 3. COORDONNÉES DE VERSEMENT
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_payout_accounts (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliates (id) on delete restrict,
  method_code   text not null references public.payment_methods (code) on delete restrict,
  details       jsonb not null default '{}'::jsonb,
  status        text not null default 'DEMANDE',
  source        text not null,
  requested_by  uuid references public.profiles (id) on delete set null,
  requested_at  timestamptz not null default now(),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  replaced_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint affiliate_payout_accounts_status check (status in ('DEMANDE', 'ACTIF', 'REFUSE', 'REMPLACE', 'RETIRE')),
  constraint affiliate_payout_accounts_source check (source in ('CANDIDATURE', 'AFFILIE', 'ADMINISTRATION')),
  constraint affiliate_payout_accounts_details check (jsonb_typeof(details) = 'object'),
  constraint affiliate_payout_accounts_note check (review_note is null or length(review_note) <= 1000),
  constraint affiliate_payout_accounts_reviewed check (
    status not in ('ACTIF', 'REFUSE') or (reviewed_at is not null)
  )
);

comment on table public.affiliate_payout_accounts is
  'Coordonnées de versement d''un affilié : demande, validation, remplacement. Jamais réécrites ; un versement fige celle qu''il a utilisée.';
comment on column public.affiliate_payout_accounts.details is
  'Accordée à aucune session : lisible par payout_account_details() — l''affilié pour les siennes, l''administration sous payouts.view.';

-- Une seule coordonnée active, une seule demande en attente, par affilié.
create unique index if not exists affiliate_payout_accounts_one_active
  on public.affiliate_payout_accounts (affiliate_id) where status = 'ACTIF';
create unique index if not exists affiliate_payout_accounts_one_pending
  on public.affiliate_payout_accounts (affiliate_id) where status = 'DEMANDE';

drop trigger if exists affiliate_payout_accounts_set_updated_at on public.affiliate_payout_accounts;
create trigger affiliate_payout_accounts_set_updated_at
  before update on public.affiliate_payout_accounts
  for each row execute function public.set_updated_at();

-- Le contenu d'une coordonnée ne se réécrit pas : on en dépose une nouvelle.
create or replace function public.tg_affiliate_payout_accounts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une coordonnée de versement ne se supprime pas : elle se remplace ou se retire.'
      using errcode = 'check_violation';
  end if;
  if (new.affiliate_id, new.method_code, new.details, new.source, new.requested_by, new.requested_at)
     is distinct from
     (old.affiliate_id, old.method_code, old.details, old.source, old.requested_by, old.requested_at) then
    raise exception 'Une coordonnée de versement ne se modifie pas : déposez-en une nouvelle.'
      using errcode = 'check_violation';
  end if;
  if not (
       (old.status = new.status)
    or (old.status = 'DEMANDE' and new.status in ('ACTIF', 'REFUSE', 'RETIRE'))
    or (old.status = 'ACTIF'   and new.status in ('REMPLACE', 'RETIRE'))
  ) then
    raise exception 'Transition de coordonnée interdite : % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_payout_accounts_guard on public.affiliate_payout_accounts;
create trigger affiliate_payout_accounts_guard
  before update or delete on public.affiliate_payout_accounts
  for each row execute function public.tg_affiliate_payout_accounts_guard();


-- Le moyen souhaité à la candidature devient une demande, à l'acceptation.
create or replace function public.tg_affiliate_applications_seed_payout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'ACCEPTEE' and old.status is distinct from 'ACCEPTEE' and new.affiliate_id is not null then
    insert into public.affiliate_payout_accounts
      (affiliate_id, method_code, details, status, source, requested_at)
    values
      (new.affiliate_id, new.payout_method_code, new.payout_details, 'DEMANDE', 'CANDIDATURE', new.consent_given_at)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_applications_seed_payout on public.affiliate_applications;
create trigger affiliate_applications_seed_payout
  after update on public.affiliate_applications
  for each row execute function public.tg_affiliate_applications_seed_payout();


-- Demande de l'affilié lui-même (décision J) : elle remplace une demande en
-- attente, jamais la coordonnée active.
create or replace function public.request_payout_account(p_method text, p_details jsonb)
returns public.affiliate_payout_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff   public.affiliates%rowtype;
  v_kind  text;
  v_row   public.affiliate_payout_accounts%rowtype;
begin
  select * into v_aff from public.affiliates where user_id = auth.uid() for update;
  if not found or v_aff.status not in ('ACTIF', 'SUSPENDU') then
    raise exception 'Aucune affiliation active pour ce compte.' using errcode = '42501';
  end if;

  select kind into v_kind from public.payment_methods where code = p_method and payout_enabled;
  if not found then
    raise exception 'Moyen de versement indisponible.' using errcode = 'check_violation';
  end if;
  if not public.affiliate_payout_details_valid(v_kind, coalesce(p_details, '{}'::jsonb)) then
    raise exception 'Coordonnées de versement incomplètes.' using errcode = 'check_violation';
  end if;

  update public.affiliate_payout_accounts
     set status = 'RETIRE'
   where affiliate_id = v_aff.id and status = 'DEMANDE';

  insert into public.affiliate_payout_accounts (affiliate_id, method_code, details, status, source, requested_by)
  values (v_aff.id, p_method, jsonb_strip_nulls(p_details), 'DEMANDE', 'AFFILIE', auth.uid())
  returning * into v_row;

  perform public.affiliation_log(v_aff.id, null, 'COORDONNEES_DEMANDEES',
    'Nouvelles coordonnées de versement demandées par l''affilié', null,
    jsonb_build_object('moyen', p_method));
  return v_row;
end;
$fn$;

revoke execute on function public.request_payout_account(text, jsonb) from public, anon;
grant  execute on function public.request_payout_account(text, jsonb) to authenticated, service_role;


-- Saisie administrative : une convention peut fixer le moyen de versement.
-- La coordonnée naît en DEMANDE ; elle se valide ensuite comme toute autre.
create or replace function public.propose_payout_account(p_affiliate_id uuid, p_method text, p_details jsonb)
returns public.affiliate_payout_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_kind text;
  v_row  public.affiliate_payout_accounts%rowtype;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas saisir les coordonnées de votre propre affiliation.' using errcode = '42501';
  end if;
  perform 1 from public.affiliates where id = p_affiliate_id and status <> 'TERMINE' for update;
  if not found then
    raise exception 'Affilié introuvable ou clos.' using errcode = 'no_data_found';
  end if;
  select kind into v_kind from public.payment_methods where code = p_method and payout_enabled;
  if not found then
    raise exception 'Moyen de versement indisponible.' using errcode = 'check_violation';
  end if;
  if not public.affiliate_payout_details_valid(v_kind, coalesce(p_details, '{}'::jsonb)) then
    raise exception 'Coordonnées de versement incomplètes.' using errcode = 'check_violation';
  end if;

  update public.affiliate_payout_accounts set status = 'RETIRE'
   where affiliate_id = p_affiliate_id and status = 'DEMANDE';
  insert into public.affiliate_payout_accounts (affiliate_id, method_code, details, status, source, requested_by)
  values (p_affiliate_id, p_method, jsonb_strip_nulls(p_details), 'DEMANDE', 'ADMINISTRATION', auth.uid())
  returning * into v_row;

  perform public.affiliation_log(p_affiliate_id, null, 'COORDONNEES_SAISIES',
    'Coordonnées de versement saisies par l''administration', null, jsonb_build_object('moyen', p_method));
  return v_row;
end;
$fn$;

revoke execute on function public.propose_payout_account(uuid, text, jsonb) from public, anon;
grant  execute on function public.propose_payout_account(uuid, text, jsonb) to authenticated, service_role;


-- Validation ou refus d'une demande. Valider remplace l'éventuelle
-- coordonnée active, qui reste en base au statut REMPLACE.
create or replace function public.review_payout_account(p_account_id uuid, p_approve boolean, p_note text default null)
returns public.affiliate_payout_accounts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_payout_accounts%rowtype;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  select * into v_row from public.affiliate_payout_accounts where id = p_account_id for update;
  if not found then
    raise exception 'Coordonnée introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_row.affiliate_id) then
    raise exception 'Vous ne pouvez pas valider les coordonnées de votre propre affiliation.' using errcode = '42501';
  end if;
  if v_row.status <> 'DEMANDE' then
    raise exception 'Cette demande a déjà été traitée.' using errcode = 'check_violation';
  end if;
  if not p_approve and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Un refus se motive.' using errcode = 'check_violation';
  end if;

  if p_approve then
    update public.affiliate_payout_accounts
       set status = 'REMPLACE', replaced_at = now()
     where affiliate_id = v_row.affiliate_id and status = 'ACTIF';
  end if;

  update public.affiliate_payout_accounts
     set status = case when p_approve then 'ACTIF' else 'REFUSE' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
   where id = p_account_id
  returning * into v_row;

  perform public.affiliation_log(v_row.affiliate_id, null,
    case when p_approve then 'COORDONNEES_VALIDEES' else 'COORDONNEES_REFUSEES' end,
    case when p_approve then 'Coordonnées de versement validées' else 'Coordonnées de versement refusées' end,
    null, jsonb_build_object('moyen', v_row.method_code, 'note', v_row.review_note));
  return v_row;
end;
$fn$;

revoke execute on function public.review_payout_account(uuid, boolean, text) from public, anon;
grant  execute on function public.review_payout_account(uuid, boolean, text) to authenticated, service_role;


-- Lecture des coordonnées : l'affilié pour les siennes, l'administration
-- sous payouts.view.
create or replace function public.payout_account_details(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_payout_accounts%rowtype;
begin
  select * into v_row from public.affiliate_payout_accounts where id = p_account_id;
  if not found then
    return null;
  end if;
  if not (public.affiliate_is_caller(v_row.affiliate_id) or public.has_permission('payouts.view')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return v_row.details;
end;
$fn$;

revoke execute on function public.payout_account_details(uuid) from public, anon;
grant  execute on function public.payout_account_details(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. L'ACTIVATION
-- -----------------------------------------------------------------------------

-- Ce qui empêche encore l'activation. Une liste vide : prêt.
create or replace function public.affiliate_activation_blockers(p_affiliate_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff      public.affiliates%rowtype;
  v_blockers text[] := array[]::text[];
begin
  if not public.can_view_affiliation() then
    raise exception 'Permission affiliates.view requise.' using errcode = '42501';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id;
  if not found then
    return array['Affilié introuvable.'];
  end if;
  if v_aff.status <> 'PREPARATION' then
    v_blockers := v_blockers || 'L''affilié n''est pas en préparation.';
  end if;
  if not exists (select 1 from public.affiliate_categories c where c.id = v_aff.category_id and c.is_active) then
    v_blockers := v_blockers || 'La catégorie de l''affilié est inactive.';
  end if;
  -- Configuration financière complète : une règle générale en vigueur, sur
  -- l'affilié ou sur sa catégorie. Sans elle, aucune affaire ne serait
  -- commissionnable.
  if not exists (
    select 1 from public.affiliate_rules r
     where r.target_type = 'ALL'
       and r.kind <> 'EXCLUDED'
       and r.valid_from <= now() and (r.valid_to is null or r.valid_to > now())
       and (r.affiliate_id = v_aff.id or r.category_id = v_aff.category_id)
  ) then
    v_blockers := v_blockers || 'Aucune règle de commission générale en vigueur (affilié ou catégorie).';
  end if;
  if not exists (
    select 1 from public.affiliate_payout_accounts p where p.affiliate_id = v_aff.id and p.status = 'ACTIF'
  ) then
    v_blockers := v_blockers || 'Aucun moyen de versement validé.';
  end if;
  return v_blockers;
end;
$fn$;

revoke execute on function public.affiliate_activation_blockers(uuid) from public, anon;
grant  execute on function public.affiliate_activation_blockers(uuid) to authenticated, service_role;


-- Activer : rattacher le compte, allouer la référence AFIL, accorder le rôle
-- AFFILIE. Idempotente : rejouée, elle rend l'affilié déjà actif sans
-- consommer de second numéro.
create or replace function public.activate_affiliate(
  p_affiliate_id uuid,
  p_user_id      uuid,
  p_started_on   date default null
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_aff       public.affiliates%rowtype;
  v_blockers  text[];
  v_email     text;
  v_reference text;
  v_role      uuid;
begin
  if not public.has_permission('affiliates.create') then
    raise exception 'Permission affiliates.create requise.' using errcode = '42501';
  end if;

  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  if v_aff.status = 'ACTIF' and v_aff.user_id = p_user_id then
    return v_aff;
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas activer une affiliation sur votre propre compte.' using errcode = '42501';
  end if;

  v_blockers := public.affiliate_activation_blockers(p_affiliate_id);
  if array_length(v_blockers, 1) > 0 then
    raise exception 'Activation impossible : %', array_to_string(v_blockers, ' ') using errcode = 'check_violation';
  end if;

  -- Le compte doit porter l'adresse de l'affilié : pas de rattachement à un tiers.
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email <> lower(v_aff.contact_email) then
    raise exception 'Le compte ne correspond pas à l''adresse de l''affilié.' using errcode = '42501';
  end if;
  if exists (select 1 from public.affiliates a where a.user_id = p_user_id and a.id <> p_affiliate_id) then
    raise exception 'Ce compte est déjà rattaché à une autre affiliation.' using errcode = 'check_violation';
  end if;

  select a.reference into v_reference from public.allocate_document_number('AFIL') a;

  update public.affiliates
     set status       = 'ACTIF',
         reference    = v_reference,
         user_id      = p_user_id,
         started_on   = coalesce(p_started_on, started_on, (now() at time zone 'Indian/Comoro')::date),
         activated_at = now(),
         activated_by = auth.uid()
   where id = p_affiliate_id
  returning * into v_aff;

  select id into v_role from public.roles where code = 'AFFILIE';
  insert into public.user_roles (user_id, role_id) values (p_user_id, v_role) on conflict do nothing;

  return v_aff;
end;
$fn$;

comment on function public.activate_affiliate(uuid, uuid, date) is
  'Active un affilié : contrôles de configuration, compte à la bonne adresse, référence AFIL allouée une fois, rôle AFFILIE accordé.';

revoke execute on function public.activate_affiliate(uuid, uuid, date) from public, anon;
grant  execute on function public.activate_affiliate(uuid, uuid, date) to authenticated, service_role;


-- Suspendre, réactiver, clore.
create or replace function public.change_affiliate_status(
  p_affiliate_id uuid,
  p_status       text,
  p_reason       text,
  p_ended_on     date default null
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff public.affiliates%rowtype;
begin
  if not public.has_permission('affiliates.disable') then
    raise exception 'Permission affiliates.disable requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Un motif est requis.' using errcode = 'check_violation';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas changer le statut de votre propre affiliation.' using errcode = '42501';
  end if;
  if not (
       (v_aff.status = 'ACTIF'    and p_status in ('SUSPENDU', 'TERMINE'))
    or (v_aff.status = 'SUSPENDU' and p_status in ('ACTIF', 'TERMINE'))
    or (v_aff.status = 'PREPARATION' and p_status = 'TERMINE')
  ) then
    raise exception 'Changement de statut impossible depuis l''état actuel.' using errcode = 'check_violation';
  end if;

  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  update public.affiliates
     set status       = p_status,
         suspended_at = case when p_status = 'SUSPENDU' then now() when p_status = 'ACTIF' then null else suspended_at end,
         ended_on     = case when p_status = 'TERMINE'
                             then coalesce(p_ended_on, (now() at time zone 'Indian/Comoro')::date) else ended_on end,
         end_reason   = case when p_status = 'TERMINE' then left(btrim(p_reason), 1000) else end_reason end
   where id = p_affiliate_id
  returning * into v_aff;
  return v_aff;
end;
$fn$;

revoke execute on function public.change_affiliate_status(uuid, text, text, date) from public, anon;
grant  execute on function public.change_affiliate_status(uuid, text, text, date) to authenticated, service_role;


-- Le graphe des statuts vaut pour tous les chemins.
create or replace function public.tg_affiliates_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'PREPARATION' and new.status in ('ACTIF', 'TERMINE'))
    or (old.status = 'ACTIF'       and new.status in ('SUSPENDU', 'TERMINE'))
    or (old.status = 'SUSPENDU'    and new.status in ('ACTIF', 'TERMINE'))
  ) then
    raise exception 'Transition d''affilié interdite : % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.reference is not null and new.reference is distinct from old.reference then
    raise exception 'La référence d''un affilié est définitive.' using errcode = 'check_violation';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'Le lien principal d''un affilié est stable.' using errcode = 'check_violation';
  end if;
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'Le compte d''un affilié ne change pas.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliates_status_guard on public.affiliates;
create trigger affiliates_status_guard
  before update on public.affiliates
  for each row execute function public.tg_affiliates_status_guard();


-- Catégorie et paramètres individuels : sous `affiliate_rules.manage`, avec
-- motif. NULL rend la main à la catégorie.
create or replace function public.update_affiliate_terms(
  p_affiliate_id               uuid,
  p_category_id                uuid,
  p_attribution_window_days    integer,
  p_prospect_protection_mode   text,
  p_prospect_protection_months integer,
  p_post_end_survival_months   integer,
  p_payout_frequency           text,
  p_payout_min_amount          numeric,
  p_acquisition_trigger        text,
  p_self_referral_allowed      boolean,
  p_self_referral_reason       text,
  p_reason                     text
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff public.affiliates%rowtype;
begin
  if not public.has_permission('affiliate_rules.manage') then
    raise exception 'Permission affiliate_rules.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Un motif est requis.' using errcode = 'check_violation';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas modifier les paramètres de votre propre affiliation.' using errcode = '42501';
  end if;
  perform 1 from public.affiliate_categories where id = p_category_id;
  if not found then
    raise exception 'Catégorie introuvable.' using errcode = 'no_data_found';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found or v_aff.status = 'TERMINE' then
    raise exception 'Affilié introuvable ou clos.' using errcode = 'no_data_found';
  end if;

  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  update public.affiliates
     set category_id                = p_category_id,
         attribution_window_days    = p_attribution_window_days,
         prospect_protection_mode   = p_prospect_protection_mode,
         prospect_protection_months = p_prospect_protection_months,
         post_end_survival_months   = p_post_end_survival_months,
         payout_frequency           = p_payout_frequency,
         payout_min_amount          = p_payout_min_amount,
         acquisition_trigger        = p_acquisition_trigger,
         self_referral_allowed      = coalesce(p_self_referral_allowed, false),
         self_referral_reason       = case when coalesce(p_self_referral_allowed, false)
                                           then nullif(left(btrim(coalesce(p_self_referral_reason, '')), 1000), '') end
   where id = p_affiliate_id
  returning * into v_aff;
  return v_aff;
end;
$fn$;

revoke execute on function public.update_affiliate_terms(uuid, uuid, integer, text, integer, integer, text, numeric, text, boolean, text, text) from public, anon;
grant  execute on function public.update_affiliate_terms(uuid, uuid, integer, text, integer, integer, text, numeric, text, boolean, text, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. CAMPAGNES — liens secondaires
--
-- Le lien principal est `/?ref=<slug>`. Une campagne ajoute `&c=<code>` :
-- elle mesure, elle ne rémunère pas différemment. Aucune donnée personnelle
-- dans l'URL : le code est un mot choisi, jamais une adresse ni un numéro.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_campaigns (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (id) on delete restrict,
  code         text not null,
  label        text not null,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint affiliate_campaigns_code check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(code) between 2 and 32),
  constraint affiliate_campaigns_label check (btrim(label) <> '' and length(label) <= 80),
  constraint affiliate_campaigns_unique unique (affiliate_id, code)
);

create index if not exists affiliate_campaigns_affiliate_idx on public.affiliate_campaigns (affiliate_id);

drop trigger if exists affiliate_campaigns_set_updated_at on public.affiliate_campaigns;
create trigger affiliate_campaigns_set_updated_at
  before update on public.affiliate_campaigns
  for each row execute function public.set_updated_at();

create or replace function public.tg_affiliate_campaigns_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une campagne ne se supprime pas : elle se désactive.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.code is distinct from old.code or new.affiliate_id is distinct from old.affiliate_id) then
    raise exception 'Le code d''une campagne est stable.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_campaigns_guard on public.affiliate_campaigns;
create trigger affiliate_campaigns_guard
  before update or delete on public.affiliate_campaigns
  for each row execute function public.tg_affiliate_campaigns_guard();

-- Créer une campagne : l'administration (affiliates.update) pour tout
-- affilié actif, l'affilié pour lui-même. Elle ne touche à aucune règle.
create or replace function public.create_affiliate_campaign(p_affiliate_id uuid, p_code text, p_label text)
returns public.affiliate_campaigns
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_campaigns%rowtype;
begin
  if not (public.affiliate_is_caller(p_affiliate_id) or public.has_permission('affiliates.update')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  perform 1 from public.affiliates where id = p_affiliate_id and status in ('ACTIF', 'SUSPENDU', 'PREPARATION');
  if not found then
    raise exception 'Affilié introuvable ou clos.' using errcode = 'no_data_found';
  end if;
  if (select count(*) from public.affiliate_campaigns where affiliate_id = p_affiliate_id) >= 50 then
    raise exception 'Cinquante campagnes au plus par affilié.' using errcode = 'check_violation';
  end if;
  insert into public.affiliate_campaigns (affiliate_id, code, label, created_by)
  values (p_affiliate_id, lower(btrim(p_code)), left(btrim(p_label), 80), auth.uid())
  returning * into v_row;
  perform public.affiliation_log(p_affiliate_id, null, 'CAMPAGNE_CREEE',
    format('Campagne créée : %s', v_row.label), null, jsonb_build_object('code', v_row.code));
  return v_row;
end;
$fn$;

revoke execute on function public.create_affiliate_campaign(uuid, text, text) from public, anon;
grant  execute on function public.create_affiliate_campaign(uuid, text, text) to authenticated, service_role;

create or replace function public.set_affiliate_campaign_active(p_campaign_id uuid, p_active boolean)
returns public.affiliate_campaigns
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_campaigns%rowtype;
begin
  select * into v_row from public.affiliate_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'Campagne introuvable.' using errcode = 'no_data_found';
  end if;
  if not (public.affiliate_is_caller(v_row.affiliate_id) or public.has_permission('affiliates.update')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.affiliate_campaigns set is_active = p_active where id = p_campaign_id returning * into v_row;
  perform public.affiliation_log(v_row.affiliate_id, null,
    case when p_active then 'CAMPAGNE_ACTIVEE' else 'CAMPAGNE_DESACTIVEE' end,
    format('Campagne %s : %s', case when p_active then 'activée' else 'désactivée' end, v_row.label), null, null);
  return v_row;
end;
$fn$;

revoke execute on function public.set_affiliate_campaign_active(uuid, boolean) from public, anon;
grant  execute on function public.set_affiliate_campaign_active(uuid, boolean) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. CODES DE RÉDUCTION
--
-- Réduction client ≠ commission affilié : rien ici ne touche un taux. Un
-- code appartient à un affilié et le désigne ; sa saisie sur une affaire
-- relève de l'administration (N4) et d'un seul code par affaire (I) — lot
-- 4H-4. Le champ public restera possible plus tard sans rien changer ici.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_codes (
  id                     uuid primary key default gen_random_uuid(),
  affiliate_id           uuid not null references public.affiliates (id) on delete restrict,
  code                   text not null,
  label                  text,
  is_active              boolean not null default true,
  discount_kind          text not null,
  discount_value         numeric(12, 2) not null,
  valid_from             timestamptz not null default now(),
  valid_to               timestamptz,
  min_order_amount       numeric(12, 2),
  max_discount_amount    numeric(12, 2),
  max_uses               integer,
  max_uses_per_customer  integer,
  service_ids            uuid[] not null default '{}',
  product_ids            uuid[] not null default '{}',
  excluded_service_ids   uuid[] not null default '{}',
  excluded_product_ids   uuid[] not null default '{}',
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  updated_at             timestamptz not null default now(),

  constraint affiliate_codes_format check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) between 3 and 24),
  constraint affiliate_codes_kind check (discount_kind in ('PERCENT', 'FIXED')),
  constraint affiliate_codes_value check (
    discount_value > 0 and (discount_kind <> 'PERCENT' or discount_value <= 100)
  ),
  constraint affiliate_codes_period check (valid_to is null or valid_to > valid_from),
  constraint affiliate_codes_min_order check (min_order_amount is null or min_order_amount > 0),
  constraint affiliate_codes_max_discount check (max_discount_amount is null or max_discount_amount > 0),
  constraint affiliate_codes_max_uses check (max_uses is null or max_uses > 0),
  constraint affiliate_codes_max_uses_customer check (max_uses_per_customer is null or max_uses_per_customer > 0),
  constraint affiliate_codes_label check (label is null or length(label) <= 120)
);

comment on table public.affiliate_codes is
  'Codes de réduction des affiliés. Une réduction client n''est jamais une commission : aucun taux de commission ici.';

-- Unicité sans tenir compte de la casse, quel que soit l'affilié.
create unique index if not exists affiliate_codes_unique_code on public.affiliate_codes (upper(code));
create index if not exists affiliate_codes_affiliate_idx on public.affiliate_codes (affiliate_id);

drop trigger if exists affiliate_codes_set_updated_at on public.affiliate_codes;
create trigger affiliate_codes_set_updated_at
  before update on public.affiliate_codes
  for each row execute function public.set_updated_at();

drop trigger if exists affiliate_codes_stamp_author on public.affiliate_codes;
create trigger affiliate_codes_stamp_author
  before insert or update on public.affiliate_codes
  for each row execute function public.tg_affiliation_stamp_author();

create or replace function public.tg_affiliate_codes_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un code ne se supprime pas : il se désactive.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.code is distinct from old.code or new.affiliate_id is distinct from old.affiliate_id) then
    raise exception 'Un code et son propriétaire sont stables : créez un autre code.' using errcode = 'check_violation';
  end if;
  if new.affiliate_id is not null and public.affiliate_is_caller(new.affiliate_id) then
    raise exception 'Vous ne pouvez pas gérer les codes de votre propre affiliation.' using errcode = '42501';
  end if;
  new.code := upper(new.code);
  return new;
end;
$$;

drop trigger if exists affiliate_codes_guard on public.affiliate_codes;
create trigger affiliate_codes_guard
  before insert or update or delete on public.affiliate_codes
  for each row execute function public.tg_affiliate_codes_guard();

create or replace function public.tg_affiliate_codes_history()
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
    perform public.affiliation_log(new.affiliate_id, null, 'CODE_CREE', format('Code de réduction créé : %s', new.code),
      null, to_jsonb(new) - 'created_at' - 'updated_at' - 'created_by' - 'updated_by');
    return new;
  end if;
  select d.old_value, d.new_value into v_old, v_new from public.affiliation_row_diff(to_jsonb(old), to_jsonb(new)) d;
  if v_new <> '{}'::jsonb then
    perform public.affiliation_log(new.affiliate_id, null,
      case when new.is_active is distinct from old.is_active
           then case when new.is_active then 'CODE_ACTIVE' else 'CODE_DESACTIVE' end
           else 'CODE_MODIFIE' end,
      format('Code de réduction %s modifié', new.code), v_old, v_new);
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_codes_history on public.affiliate_codes;
create trigger affiliate_codes_history
  after insert or update on public.affiliate_codes
  for each row execute function public.tg_affiliate_codes_history();


-- -----------------------------------------------------------------------------
-- 7. PRIVILÈGES ET RLS
-- -----------------------------------------------------------------------------

revoke all on public.affiliate_payout_accounts from anon, authenticated;
revoke all on public.affiliate_campaigns       from anon, authenticated;
revoke all on public.affiliate_codes           from anon, authenticated;

-- Toutes les colonnes, sauf les coordonnées.
grant select (id, affiliate_id, method_code, status, source, requested_by, requested_at,
              reviewed_by, reviewed_at, review_note, replaced_at, created_at, updated_at)
  on public.affiliate_payout_accounts to authenticated;
grant select on public.affiliate_campaigns to authenticated;
grant select on public.affiliate_codes to authenticated;
grant insert (affiliate_id, code, label, is_active, discount_kind, discount_value, valid_from, valid_to,
              min_order_amount, max_discount_amount, max_uses, max_uses_per_customer,
              service_ids, product_ids, excluded_service_ids, excluded_product_ids)
  on public.affiliate_codes to authenticated;
grant update (label, is_active, discount_kind, discount_value, valid_from, valid_to,
              min_order_amount, max_discount_amount, max_uses, max_uses_per_customer,
              service_ids, product_ids, excluded_service_ids, excluded_product_ids)
  on public.affiliate_codes to authenticated;

grant all on public.affiliate_payout_accounts, public.affiliate_campaigns, public.affiliate_codes to service_role;

alter table public.affiliate_payout_accounts enable row level security;
alter table public.affiliate_campaigns       enable row level security;
alter table public.affiliate_codes           enable row level security;

drop policy if exists affiliate_payout_accounts_select on public.affiliate_payout_accounts;
create policy affiliate_payout_accounts_select
  on public.affiliate_payout_accounts for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.has_permission('payouts.view'));

drop policy if exists affiliate_campaigns_select on public.affiliate_campaigns;
create policy affiliate_campaigns_select
  on public.affiliate_campaigns for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.can_view_affiliation());

drop policy if exists affiliate_codes_select on public.affiliate_codes;
create policy affiliate_codes_select
  on public.affiliate_codes for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.can_view_affiliation());

drop policy if exists affiliate_codes_insert on public.affiliate_codes;
create policy affiliate_codes_insert
  on public.affiliate_codes for insert to authenticated
  with check (public.has_permission('affiliate_codes.manage'));

drop policy if exists affiliate_codes_update on public.affiliate_codes;
create policy affiliate_codes_update
  on public.affiliate_codes for update to authenticated
  using (public.has_permission('affiliate_codes.manage'))
  with check (public.has_permission('affiliate_codes.manage'));
