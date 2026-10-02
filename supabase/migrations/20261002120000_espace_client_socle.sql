-- =============================================================================
-- PHASE 4I-1 — ESPACE CLIENT : SOCLE
--
-- Trois choses, et rien d'autre :
--
--   1. la référence client officielle `MORA-CLI-A0001`, allouée par le moteur
--      de numérotation de la phase 4D (aucun second compteur) ;
--   2. la fiche client `public.clients` : référence, WhatsApp distinct,
--      préférence de contact (décision 5 du 2026-10-02) ;
--   3. la seule porte d'écriture du client sur ses coordonnées :
--      `update_my_client_profile`, identifiée par `auth.uid()`, journalisée.
--
-- Ce que cette migration ne fait pas : aucune politique existante n'est
-- modifiée, aucune table de 4F, 4G ou 4H n'est touchée, aucun e-mail.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LE CODE DE RÉFÉRENCE « CLI »
--
-- Le moteur 4D n'admettait que des codes de 4 à 6 lettres. La décision du
-- propriétaire fixe `MORA-CLI-…` (trois lettres). Le format D-2 —
-- `MORA-[TYPE]-[SÉRIE][NUMÉRO]` — n'impose aucune longueur ; la limite était
-- un choix d'implémentation.
--
-- L'élargissement est le plus étroit possible : un code de trois lettres
-- n'est admis que pour un type « référence seule », c'est-à-dire un type qui
-- numérote une entité et n'émet jamais de pièce (`issue_document` le refuse).
-- La contrainte des pièces réelles (`documents_reference_format`, 4 à 6
-- lettres) reste inchangée : aucun document officiel ne peut porter un code
-- de trois lettres.
-- -----------------------------------------------------------------------------

alter table public.document_types drop constraint if exists document_types_code_format;
alter table public.document_types add constraint document_types_code_format
  check (code ~ '^[A-Z]{4,6}$' or (code ~ '^[A-Z]{3}$' and is_reference_only));

insert into public.document_types
  (code, label, entity_type, view_permission, issue_permission, sort_order, is_reference_only)
values
  ('CLI', 'Client', 'client', 'users.view', 'users.create', 5, true)
on conflict (code) do update
  set label             = excluded.label,
      entity_type       = excluded.entity_type,
      view_permission   = excluded.view_permission,
      issue_permission  = excluded.issue_permission,
      sort_order        = excluded.sort_order,
      is_reference_only = excluded.is_reference_only,
      updated_at        = now();


-- -----------------------------------------------------------------------------
-- 2. LA FICHE CLIENT
--
-- Une ligne par compte qui porte le rôle CLIENT **et** dont l'adresse est
-- confirmée. Les leads sans compte n'y figurent pas (décision 6) : ils
-- restent dans `leads`.
--
-- Nom et téléphone restent sur `profiles`, leur place depuis la phase 4A ;
-- l'adresse e-mail reste celle d'authentification, seule source de vérité
-- (décision 5 : non modifiable en 4I).
-- -----------------------------------------------------------------------------

create table if not exists public.clients (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  reference           text not null,
  whatsapp            text,
  contact_preference  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint clients_reference_unique     unique (reference),
  constraint clients_reference_format     check (reference ~ '^MORA-CLI-[A-Z]+[0-9]{4}$'),
  constraint clients_whatsapp_format      check (whatsapp is null or whatsapp ~ '^[+0-9 ().-]{6,40}$'),
  constraint clients_contact_preference   check (contact_preference is null
                                                 or contact_preference in ('WHATSAPP', 'TELEPHONE', 'EMAIL'))
);

comment on table public.clients is
  'Fiche client (phase 4I) : référence officielle MORA-CLI, WhatsApp distinct, préférence de contact. Une ligne par compte CLIENT à adresse confirmée.';
comment on column public.clients.reference is
  'Référence officielle allouée par allocate_document_number(''CLI''). Stable, unique, jamais modifiée ni réattribuée.';
comment on column public.clients.contact_preference is
  'Canal préféré déclaré par le client : WHATSAPP, TELEPHONE ou EMAIL. Affiché à l''administration, n''envoie rien.';

create index if not exists clients_created_idx on public.clients (created_at desc);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();


-- La référence et le compte sont immuables, pour tout le monde — clé de
-- service comprise. Une suppression directe est refusée tant que le profil
-- existe : seule la disparition du compte lui-même (cascade) emporte la fiche.
create or replace function public.tg_clients_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.reference is distinct from old.reference then
      raise exception 'La référence client est définitive.' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'Une fiche client ne change pas de compte.' using errcode = '42501';
    end if;
    return new;
  end if;

  if exists (select 1 from public.profiles p where p.id = old.user_id) then
    raise exception 'Une fiche client ne se supprime pas : elle disparaît seulement avec le compte.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists clients_guard on public.clients;
create trigger clients_guard
  before update or delete on public.clients
  for each row execute function public.tg_clients_guard();


-- RLS : le client lit sa fiche, l'administration autorisée lit toutes les
-- fiches. Aucune écriture directe : tout passe par les fonctions ci-dessous.
alter table public.clients enable row level security;

revoke all on public.clients from anon, authenticated;
grant select on public.clients to authenticated;

drop policy if exists clients_select_own_or_authorised on public.clients;
create policy clients_select_own_or_authorised
  on public.clients for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.view'));


-- -----------------------------------------------------------------------------
-- 3. L'ATTRIBUTION DE LA RÉFÉRENCE
--
-- Règle unique et déterministe : un compte reçoit sa référence au moment où
-- il réunit **les deux** conditions — rôle CLIENT et adresse confirmée.
-- Une inscription jamais confirmée ne consomme donc aucun numéro.
--
-- Deux déclencheurs y conduisent, selon la condition remplie en dernier :
--   * l'attribution du rôle CLIENT (`user_roles`) ;
--   * la confirmation de l'adresse (`auth.users.email_confirmed_at`).
--
-- Idempotente : un verrou consultatif par compte sérialise deux appels
-- simultanés, et le second trouve la fiche déjà créée. Aucun numéro n'est
-- alloué pour rien.
-- -----------------------------------------------------------------------------

create or replace function public.ensure_client_reference(p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reference text;
begin
  if p_user is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('mora.client_reference'), hashtext(p_user::text));

  select c.reference into v_reference from public.clients c where c.user_id = p_user;
  if found then
    return v_reference;
  end if;

  if not exists (
       select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = p_user and r.code = 'CLIENT'
     )
     or not exists (
       select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null
     )
     or not exists (select 1 from public.profiles p where p.id = p_user)
  then
    return null;
  end if;

  select a.reference into v_reference from public.allocate_document_number('CLI') a;

  insert into public.clients (user_id, reference) values (p_user, v_reference);

  return v_reference;
end;
$$;

comment on function public.ensure_client_reference(uuid) is
  'Crée la fiche client et alloue MORA-CLI une seule fois, quand le compte a le rôle CLIENT et une adresse confirmée. Idempotente.';

revoke execute on function public.ensure_client_reference(uuid) from public, anon, authenticated;
grant  execute on function public.ensure_client_reference(uuid) to service_role;


-- Réparation à la demande du titulaire lui-même : si un déclencheur a échoué
-- (voir plus bas), la première visite de l'espace client crée la fiche. Même
-- règle, même fonction ; l'identité vient de la session, jamais d'un
-- paramètre.
create or replace function public.ensure_my_client_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;
  return public.ensure_client_reference(auth.uid());
end;
$$;

comment on function public.ensure_my_client_reference() is
  'Rend la référence client du compte connecté, en la créant si les conditions sont réunies. Aucun paramètre : l''identité vient de auth.uid().';

revoke execute on function public.ensure_my_client_reference() from public, anon;
grant  execute on function public.ensure_my_client_reference() to authenticated, service_role;


-- Les déclencheurs ne doivent jamais faire échouer l'opération qui les porte :
-- une confirmation d'adresse ou une attribution de rôle qui échouerait pour
-- une question de numérotation serait bien pire qu'une fiche créée plus tard
-- (par `ensure_my_client_reference`). L'échec est signalé, pas propagé.
create or replace function public.tg_user_roles_client_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.roles r where r.id = new.role_id and r.code = 'CLIENT') then
    begin
      perform public.ensure_client_reference(new.user_id);
    exception when others then
      raise warning 'Référence client non attribuée pour % : %', new.user_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists user_roles_client_reference on public.user_roles;
create trigger user_roles_client_reference
  after insert on public.user_roles
  for each row execute function public.tg_user_roles_client_reference();


create or replace function public.tg_auth_users_client_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.ensure_client_reference(new.id);
  exception when others then
    raise warning 'Référence client non attribuée pour % : %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists on_auth_user_confirmed_client_reference on auth.users;
create trigger on_auth_user_confirmed_client_reference
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.tg_auth_users_client_reference();


-- -----------------------------------------------------------------------------
-- 4. LES CLIENTS EXISTANTS
--
-- Attribution unique, dans l'ordre de création des comptes (puis de leur
-- identifiant, pour départager deux créations simultanées) : déterministe,
-- sans trou, sans collision — l'allocateur pose son verrou à chaque appel.
-- Rejouée, elle ne fait rien : les comptes déjà pourvus sont écartés.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select u.id
      from auth.users u
     where u.email_confirmed_at is not null
       and exists (
         select 1 from public.user_roles ur
           join public.roles ro on ro.id = ur.role_id
          where ur.user_id = u.id and ro.code = 'CLIENT'
       )
       and exists (select 1 from public.profiles p where p.id = u.id)
       and not exists (select 1 from public.clients c where c.user_id = u.id)
     order by u.created_at, u.id
  loop
    perform public.ensure_client_reference(r.id);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. LE PROFIL, ÉCRIT PAR LE CLIENT
--
-- Seule porte d'écriture du client sur ses coordonnées : nom, téléphone,
-- WhatsApp, préférence de contact. Jamais par elle : e-mail, statut,
-- identifiant, rôles, référence.
--
-- Identité : `auth.uid()`. Un compte suspendu, désactivé ou supprimé est
-- refusé ici, en base — pas seulement par l'écran.
--
-- Cohérence : on ne préfère pas un canal qu'on n'a pas renseigné.
-- Journal : l'avant et l'après des seuls champs modifiés.
-- -----------------------------------------------------------------------------

create or replace function public.update_my_client_profile(
  p_full_name          text,
  p_phone              text,
  p_whatsapp           text,
  p_contact_preference text
)
returns public.clients
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles%rowtype;
  v_before     public.clients%rowtype;
  v_after      public.clients%rowtype;
  v_name       text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone      text := nullif(btrim(coalesce(p_phone, '')), '');
  v_whatsapp   text := nullif(btrim(coalesce(p_whatsapp, '')), '');
  v_preference text := nullif(btrim(coalesce(p_contact_preference, '')), '');
  v_avant      jsonb := '{}'::jsonb;
  v_apres      jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or v_profile.status <> 'ACTIF' or v_profile.deleted_at is not null then
    raise exception 'Ce compte ne peut pas être modifié.' using errcode = '42501';
  end if;

  select * into v_before from public.clients where user_id = v_uid for update;
  if not found then
    raise exception 'Aucun espace client n''est rattaché à ce compte.' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Indiquez votre nom (2 à 120 caractères).' using errcode = 'check_violation';
  end if;
  if v_phone is not null and v_phone !~ '^[+0-9 ().-]{6,40}$' then
    raise exception 'Numéro de téléphone invalide.' using errcode = 'check_violation';
  end if;
  if v_whatsapp is not null and v_whatsapp !~ '^[+0-9 ().-]{6,40}$' then
    raise exception 'Numéro WhatsApp invalide.' using errcode = 'check_violation';
  end if;
  if v_preference is not null and v_preference not in ('WHATSAPP', 'TELEPHONE', 'EMAIL') then
    raise exception 'Préférence de contact inconnue.' using errcode = 'check_violation';
  end if;
  if v_preference = 'WHATSAPP' and v_whatsapp is null then
    raise exception 'Indiquez votre numéro WhatsApp pour être contacté par WhatsApp.' using errcode = 'check_violation';
  end if;
  if v_preference = 'TELEPHONE' and v_phone is null then
    raise exception 'Indiquez votre numéro de téléphone pour être contacté par téléphone.' using errcode = 'check_violation';
  end if;

  if v_profile.full_name is distinct from v_name then
    v_avant := v_avant || jsonb_build_object('nom', v_profile.full_name);
    v_apres := v_apres || jsonb_build_object('nom', v_name);
  end if;
  if v_profile.phone is distinct from v_phone then
    v_avant := v_avant || jsonb_build_object('telephone', v_profile.phone);
    v_apres := v_apres || jsonb_build_object('telephone', v_phone);
  end if;
  if v_before.whatsapp is distinct from v_whatsapp then
    v_avant := v_avant || jsonb_build_object('whatsapp', v_before.whatsapp);
    v_apres := v_apres || jsonb_build_object('whatsapp', v_whatsapp);
  end if;
  if v_before.contact_preference is distinct from v_preference then
    v_avant := v_avant || jsonb_build_object('preference_contact', v_before.contact_preference);
    v_apres := v_apres || jsonb_build_object('preference_contact', v_preference);
  end if;

  update public.profiles
     set full_name = v_name, phone = v_phone
   where id = v_uid;

  update public.clients
     set whatsapp = v_whatsapp, contact_preference = v_preference
   where user_id = v_uid
  returning * into v_after;

  if v_apres <> '{}'::jsonb then
    perform public.record_audit_event(
      'clients.profil.modification', 'client', v_after.reference, 'SUCCES',
      jsonb_build_object('origine', 'espace_client', 'avant', v_avant, 'apres', v_apres)
    );
  end if;

  return v_after;
end;
$fn$;

comment on function public.update_my_client_profile(text, text, text, text) is
  'Seule écriture du client sur ses coordonnées : nom, téléphone, WhatsApp, préférence de contact. Identité par auth.uid(), compte actif exigé, journalisée.';

revoke execute on function public.update_my_client_profile(text, text, text, text) from public, anon;
grant  execute on function public.update_my_client_profile(text, text, text, text) to authenticated, service_role;
