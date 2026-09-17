-- =============================================================================
-- MORA SHAWIRI — Migration 0001
-- Domaine IDENTITÉ : profils, rôles, permissions, affectations (RBAC).
--
-- Références :
--   07_ARCHITECTURE_TECHNIQUE/01_ARCHITECTURE_BASE_DE_DONNEES.md § 23-32, § 231
--   07_ARCHITECTURE_TECHNIQUE/02_ROLES_ET_PERMISSIONS.md         § 28-45, § 96-98, § 134
--   07_ARCHITECTURE_TECHNIQUE/04_AUTHENTIFICATION.md             § 10-13, § 60, § 70
--   10_DEPLOIEMENT/00_SUPABASE.md                                § 26-41, § 129
--
-- Principes appliqués :
--   * aucun mot de passe dans une table applicative — l'authentification et le
--     hachage restent intégralement gérés par Supabase Auth (`auth.users`) ;
--   * RLS activée sur CHAQUE table, avec des politiques explicites ;
--   * refus par défaut : aucune politique permissive n'est écrite « au cas où » ;
--   * les fonctions d'autorisation sont `SECURITY DEFINER` avec `search_path`
--     figé, afin que les politiques n'entrent pas en récursion et que la clé
--     `service_role` n'ait jamais à contourner RLS pour lire un rôle.
--
-- Migration idempotente : elle peut être rejouée sans erreur.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Outillage commun
-- -----------------------------------------------------------------------------

-- Horodatage de modification, posé sur toute entité importante (§ 21).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger générique : met à jour `updated_at` à chaque modification de ligne.';

-- Rôles de base de données considérés comme privilégiés : migrations exécutées
-- par `postgres`, opérations serveur signées par la clé `service_role`. Les
-- garde-fous anti-élévation ne s'appliquent pas à eux, car ils ne représentent
-- jamais une action d'utilisateur final.
create or replace function public.is_privileged_db_role()
returns boolean
language sql
stable
as $$
  select current_user in (
    'postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role'
  );
$$;

comment on function public.is_privileged_db_role() is
  'Vrai lorsque la requête courante provient des migrations ou de la clé service_role.';


-- -----------------------------------------------------------------------------
-- 2. PROFILS — prolongement applicatif de `auth.users`
--
-- `auth.users` porte l'identité d'authentification (e-mail, hash du mot de
-- passe, facteurs MFA). `public.profiles` porte l'identité applicative
-- (§ 24-26 de l'architecture base de données). Les deux restent séparés.
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,

  -- Identifiant de connexion lisible (`rachade`, `amina`, …). Unique sur toute
  -- la plateforme, normalisé en minuscules pour éviter les doublons de casse.
  username               text unique,

  full_name              text,
  phone                  text,

  -- Statut du compte (02_ROLES_ET_PERMISSIONS.md § 91).
  status                 text not null default 'ACTIF'
                           check (status in ('ACTIF', 'SUSPENDU', 'DESACTIVE')),

  -- Vrai tant que le compte n'a pas remplacé son mot de passe d'amorçage.
  -- Sert au parcours « changer mon mot de passe » de la phase suivante.
  must_change_password   boolean not null default false,
  password_changed_at    timestamptz,

  last_login_at          timestamptz,

  -- Suppression logique (§ 19) : l'historique commercial reste exploitable.
  deleted_at             timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint profiles_username_format check (
    username is null
    or (username = lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
  )
);

comment on table public.profiles is
  'Profil applicatif d''un compte. Ne contient JAMAIS de mot de passe : Supabase Auth en a la charge exclusive.';
comment on column public.profiles.username is
  'Identifiant de connexion lisible, unique, en minuscules. Peut être nul pour un compte identifié uniquement par e-mail.';
comment on column public.profiles.must_change_password is
  'Vrai tant que le mot de passe d''amorçage n''a pas été remplacé par le titulaire du compte.';

create index if not exists profiles_status_idx
  on public.profiles (status) where deleted_at is null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. RÔLES
--
-- Un rôle regroupe des permissions (§ 104). Le nombre de rôles n'est pas figé :
-- l'administration pourra en créer d'autres sans modification du code (§ 100).
-- -----------------------------------------------------------------------------

create table if not exists public.roles (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code = upper(code) and code ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  label          text not null,
  description    text,

  -- Rôle donnant accès à l'espace d'administration. Son attribution relève
  -- d'une permission critique (§ 115).
  is_admin_role  boolean not null default false,

  -- Rôle livré avec la plateforme : il ne peut pas être supprimé.
  is_system      boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.roles is
  'Rôles de la plateforme. Les rôles système sont protégés contre la suppression ; d''autres rôles peuvent être créés depuis l''administration.';

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. PERMISSIONS
--
-- Nomenclature `domaine.action` (§ 30-45). La liste est une donnée, pas du
-- code : ajouter une permission est une migration, pas une refonte.
-- -----------------------------------------------------------------------------

create table if not exists public.permissions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  domain       text not null,
  action       text not null,
  label        text not null,

  -- Permission critique au sens du § 142 : gestion des administrateurs,
  -- modification des permissions, paramètres de sécurité, opérations
  -- financières, suppression définitive.
  is_critical  boolean not null default false,

  created_at   timestamptz not null default now()
);

comment on table public.permissions is
  'Catalogue des permissions `domaine.action`. Source de vérité du contrôle d''accès applicatif.';


-- -----------------------------------------------------------------------------
-- 5. RÔLE ↔ PERMISSIONS
-- -----------------------------------------------------------------------------

create table if not exists public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_id  uuid not null references public.permissions (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (role_id, permission_id)
);

comment on table public.role_permissions is
  'Permissions accordées à un rôle.';

create index if not exists role_permissions_permission_idx
  on public.role_permissions (permission_id);


-- -----------------------------------------------------------------------------
-- 6. UTILISATEUR ↔ RÔLES
--
-- Multi-rôles obligatoire (§ 27, § 138) : une même personne peut être cliente
-- et affiliée sans second compte.
-- -----------------------------------------------------------------------------

create table if not exists public.user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete restrict,
  granted_by  uuid references auth.users (id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

comment on table public.user_roles is
  'Rôles attribués à un compte. Un compte peut en cumuler plusieurs.';

create index if not exists user_roles_role_idx on public.user_roles (role_id);


-- -----------------------------------------------------------------------------
-- 7. FONCTIONS D'AUTORISATION
--
-- Ces fonctions sont le socle commun des politiques RLS et du contrôle
-- applicatif. Elles sont `SECURITY DEFINER` pour deux raisons :
--   * elles doivent lire `user_roles` depuis une politique posée sur
--     `user_roles` elle-même — sans cela, récursion infinie ;
--   * elles évitent d'avoir à contourner RLS avec la clé `service_role`, ce
--     que le rapport de phase 4 identifie comme un risque élevé.
-- `search_path` est figé : une fonction `SECURITY DEFINER` dont le chemin de
-- recherche est modifiable est une porte d'entrée d'élévation de privilèges.
-- -----------------------------------------------------------------------------

-- Ensemble des permissions effectives du compte connecté.
-- Un compte non `ACTIF` ou supprimé logiquement n'a aucune permission.
create or replace function public.current_permissions()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct p.code
  from public.user_roles ur
  join public.profiles pr on pr.id = ur.user_id
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid()
    and pr.status = 'ACTIF'
    and pr.deleted_at is null;
$$;

comment on function public.current_permissions() is
  'Permissions effectives du compte connecté. Vide si le compte est suspendu, désactivé ou supprimé.';

-- Refus par défaut (§ 106) : la fonction ne renvoie vrai que si la permission
-- demandée est explicitement accordée, ou si le compte détient la permission
-- globale `admin.full_access` (§ 45).
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles pr on pr.id = ur.user_id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and pr.status = 'ACTIF'
      and pr.deleted_at is null
      and p.code in (p_permission, 'admin.full_access')
  );
$$;

comment on function public.has_permission(text) is
  'Vrai si le compte connecté détient la permission demandée, ou la permission globale admin.full_access.';

create or replace function public.has_role(p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and r.code = upper(p_role_code)
      and pr.status = 'ACTIF'
      and pr.deleted_at is null
  );
$$;

comment on function public.has_role(text) is
  'Vrai si le compte connecté porte le rôle demandé et que son profil est actif.';

-- Détient au moins un rôle d'administration. Ne remplace JAMAIS une
-- vérification de permission : sert uniquement aux lectures de catalogue.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and r.is_admin_role
      and pr.status = 'ACTIF'
      and pr.deleted_at is null
  );
$$;

comment on function public.is_admin() is
  'Vrai si le compte connecté porte un rôle d''administration actif. Ne dispense jamais du contrôle de permission.';

create or replace function public.role_is_admin(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select r.is_admin_role from public.roles r where r.id = p_role_id), true);
$$;

comment on function public.role_is_admin(uuid) is
  'Vrai si le rôle désigné donne accès à l''administration. Un rôle inconnu est traité comme administratif, par prudence.';

-- Lecture hors RLS d'une association rôle → permission. Utilisée par les
-- garde-fous, qui doivent raisonner sur l'état réel de la base et non sur la
-- vue partielle que RLS accorde à l'appelant.
create or replace function public.role_grants_permission(p_role_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = p_role_id and p.code = p_permission
  );
$$;

comment on function public.role_grants_permission(uuid, text) is
  'Vrai si le rôle désigné accorde la permission indiquée. Lecture hors RLS, réservée aux garde-fous d''intégrité.';

-- Nombre de comptes actifs détenant une permission critique donnée. Sert à
-- empêcher la perte du dernier compte capable d'administrer la plateforme
-- (§ 21 et § 70 de l'authentification).
create or replace function public.count_active_holders(p_permission text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct ur.user_id)::integer
  from public.user_roles ur
  join public.profiles pr on pr.id = ur.user_id
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.code = p_permission
    and pr.status = 'ACTIF'
    and pr.deleted_at is null;
$$;

comment on function public.count_active_holders(text) is
  'Nombre de comptes actifs détenant la permission indiquée.';

create or replace function public.user_holds_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id and p.code = p_permission
  );
$$;

comment on function public.user_holds_permission(uuid, text) is
  'Vrai si le compte désigné détient la permission indiquée, indépendamment de son statut. Lecture hors RLS, réservée aux garde-fous.';

-- Exécution ouverte aux rôles applicatifs : les politiques RLS évaluent ces
-- fonctions avec les droits de l'appelant.
grant execute on function public.current_permissions()          to anon, authenticated, service_role;
grant execute on function public.has_permission(text)           to anon, authenticated, service_role;
grant execute on function public.has_role(text)                 to anon, authenticated, service_role;
grant execute on function public.is_admin()                     to anon, authenticated, service_role;
grant execute on function public.role_is_admin(uuid)            to anon, authenticated, service_role;
grant execute on function public.role_grants_permission(uuid, text) to anon, authenticated, service_role;
grant execute on function public.count_active_holders(text)     to anon, authenticated, service_role;
grant execute on function public.user_holds_permission(uuid, text) to anon, authenticated, service_role;
grant execute on function public.is_privileged_db_role()        to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. CRÉATION AUTOMATIQUE DU PROFIL
--
-- Tout compte `auth.users` obtient un profil. Sans cela, un compte créé par
-- Supabase Auth échapperait au contrôle de statut.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
begin
  v_username := nullif(lower(trim(new.raw_user_meta_data ->> 'username')), '');

  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    v_username,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;

  return new;
exception
  when unique_violation then
    -- Nom d'utilisateur déjà pris : le profil est créé sans identifiant lisible
    -- plutôt que de faire échouer la création du compte. L'administration
    -- pourra corriger. Aucune donnée n'est journalisée ici.
    insert into public.profiles (id, full_name)
    values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
    on conflict (id) do nothing;
    return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Crée le profil applicatif associé à un nouveau compte Supabase Auth.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- -----------------------------------------------------------------------------
-- 9. GARDE-FOUS D'INTÉGRITÉ
-- -----------------------------------------------------------------------------

-- 9.1 — Colonnes sensibles d'un profil.
-- Un utilisateur peut corriger son nom ou son téléphone ; il ne peut jamais
-- modifier son statut, son identifiant de connexion ou sa suppression logique.
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_db_role() then
    return new;
  end if;

  if (new.status is distinct from old.status
      or new.username is distinct from old.username
      or new.deleted_at is distinct from old.deleted_at
      or new.must_change_password is distinct from old.must_change_password)
     and not public.has_permission('users.update')
  then
    raise exception 'Modification non autorisée d''un champ protégé du profil'
      using errcode = '42501';
  end if;

  -- Le dernier compte actif capable d'administrer la plateforme ne peut être
  -- ni suspendu, ni désactivé, ni supprimé logiquement (§ 21, § 70).
  if (new.status <> 'ACTIF' or new.deleted_at is not null)
     and old.status = 'ACTIF'
     and old.deleted_at is null
     and public.user_holds_permission(old.id, 'admin.full_access')
     and public.count_active_holders('admin.full_access') <= 1
  then
    raise exception 'Désactivation impossible : ce compte est le dernier à détenir admin.full_access'
      using errcode = '42501';
  end if;

  -- Champs tenus par le serveur, jamais par le client.
  new.last_login_at       := old.last_login_at;
  new.password_changed_at := old.password_changed_at;
  new.id                  := old.id;

  return new;
end;
$$;

comment on function public.tg_profiles_guard() is
  'Empêche un compte de modifier lui-même son statut, son identifiant ou sa suppression logique.';

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.tg_profiles_guard();


-- 9.2 — Attribution des rôles.
-- Interdit l'auto-élévation (§ 96-97) et la perte du dernier compte détenteur
-- de `admin.full_access` (§ 21).
create or replace function public.tg_user_roles_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_db_role() then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    -- Auto-attribution interdite, quelle que soit la permission détenue.
    if new.user_id = auth.uid() then
      raise exception 'Un compte ne peut pas s''attribuer un rôle à lui-même'
        using errcode = '42501';
    end if;
  end if;

  -- Le dernier détenteur actif de `admin.full_access` est protégé : retirer ce
  -- rôle rendrait la plateforme inadministrable.
  if tg_op in ('DELETE', 'UPDATE')
     and public.role_grants_permission(old.role_id, 'admin.full_access')
     and public.count_active_holders('admin.full_access') <= 1
  then
    raise exception 'Retrait impossible : ce compte est le dernier à détenir admin.full_access'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.tg_user_roles_guard() is
  'Interdit l''auto-attribution de rôle et protège le dernier détenteur de admin.full_access.';

drop trigger if exists user_roles_guard on public.user_roles;
create trigger user_roles_guard
  before insert or update or delete on public.user_roles
  for each row execute function public.tg_user_roles_guard();


-- 9.3 — Les rôles système ne se suppriment pas.
create or replace function public.tg_roles_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'Un rôle système ne peut pas être supprimé' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.is_system
     and (new.code is distinct from old.code or new.is_system is distinct from old.is_system)
  then
    raise exception 'Le code d''un rôle système ne peut pas être modifié' using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists roles_guard on public.roles;
create trigger roles_guard
  before update or delete on public.roles
  for each row execute function public.tg_roles_guard();


-- 9.4 — Changement de mot de passe effectué par le titulaire du compte.
-- Le mot de passe lui-même reste géré par Supabase Auth ; cette fonction ne
-- fait que lever l'obligation de changement. Elle n'accepte aucun secret et
-- n'écrit rien d'autre que deux horodatages.
create or replace function public.mark_password_changed()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  update public.profiles
     set must_change_password = false,
         password_changed_at  = now()
   where id = auth.uid();
end;
$$;

comment on function public.mark_password_changed() is
  'Lève l''obligation de changement de mot de passe pour le compte connecté. Ne manipule aucun secret.';

revoke execute on function public.mark_password_changed() from public, anon;
grant  execute on function public.mark_password_changed() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10. PRIVILÈGES DE TABLE — moindre privilège avant même RLS
--
-- RLS filtre les lignes ; les privilèges filtrent les verbes. Les deux sont
-- posés : une politique oubliée ne suffit alors pas à ouvrir une table.
-- -----------------------------------------------------------------------------

revoke all on public.profiles         from anon, authenticated;
revoke all on public.roles            from anon, authenticated;
revoke all on public.permissions      from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;
revoke all on public.user_roles       from anon, authenticated;

grant select, update            on public.profiles         to authenticated;
grant select, insert, update    on public.roles            to authenticated;
grant delete                    on public.roles            to authenticated;
grant select                    on public.permissions      to authenticated;
grant select, insert, delete    on public.role_permissions to authenticated;
grant select, insert, update, delete on public.user_roles  to authenticated;

-- `anon` ne reçoit aucun droit sur le domaine identité : un visiteur anonyme
-- n'a rien à y lire.


-- -----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
--
-- Activée sur les cinq tables, sans exception.
--
-- `FORCE ROW LEVEL SECURITY` n'est volontairement PAS utilisé : les fonctions
-- d'autorisation de la section 7 s'exécutent avec les droits du propriétaire
-- des tables, et c'est précisément cette exemption qui leur permet de lire
-- `user_roles` depuis une politique posée sur `user_roles`. Forcer RLS
-- provoquerait une récursion et ferait échouer tout contrôle d'accès.
--
-- La clé `service_role` est exemptée de RLS par construction (`BYPASSRLS`) :
-- son usage reste strictement limité au provisionnement et aux tâches serveur
-- identifiées, jamais à un contournement de commodité.
-- -----------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;


-- 11.1 — PROFILS
drop policy if exists profiles_select_self_or_authorised on public.profiles;
create policy profiles_select_self_or_authorised
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('users.view'));

drop policy if exists profiles_update_self_or_authorised on public.profiles;
create policy profiles_update_self_or_authorised
  on public.profiles for update to authenticated
  using (
    (id = auth.uid() and status = 'ACTIF' and deleted_at is null)
    or public.has_permission('users.update')
  )
  with check (id = auth.uid() or public.has_permission('users.update'));

drop policy if exists profiles_insert_authorised on public.profiles;
create policy profiles_insert_authorised
  on public.profiles for insert to authenticated
  with check (public.has_permission('users.create'));

-- Aucune politique DELETE : la suppression physique d'un profil passe
-- exclusivement par le serveur. La suppression courante est logique
-- (`deleted_at`), conformément au § 19 de l'architecture base de données.


-- 11.2 — RÔLES
drop policy if exists roles_select_admin on public.roles;
create policy roles_select_admin
  on public.roles for select to authenticated
  using (public.is_admin());

-- Un compte doit pouvoir lire le libellé des rôles qu'il porte, sans pour
-- autant découvrir le catalogue complet. Sans cette politique, un client ne
-- pourrait pas même savoir qu'il est client.
drop policy if exists roles_select_own on public.roles;
create policy roles_select_own
  on public.roles for select to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.role_id = roles.id and ur.user_id = auth.uid()
    )
  );

drop policy if exists roles_write_critical on public.roles;
create policy roles_write_critical
  on public.roles for insert to authenticated
  with check (public.has_permission('admins.permissions'));

drop policy if exists roles_update_critical on public.roles;
create policy roles_update_critical
  on public.roles for update to authenticated
  using (public.has_permission('admins.permissions'))
  with check (public.has_permission('admins.permissions'));

drop policy if exists roles_delete_critical on public.roles;
create policy roles_delete_critical
  on public.roles for delete to authenticated
  using (public.has_permission('admins.permissions') and not is_system);


-- 11.3 — PERMISSIONS (catalogue en lecture seule côté application)
drop policy if exists permissions_select_admin on public.permissions;
create policy permissions_select_admin
  on public.permissions for select to authenticated
  using (public.is_admin());

-- Aucune politique d'écriture : le catalogue des permissions évolue par
-- migration, jamais depuis l'interface (§ 232 de l'architecture base de données).


-- 11.4 — RÔLE ↔ PERMISSIONS
drop policy if exists role_permissions_select_admin on public.role_permissions;
create policy role_permissions_select_admin
  on public.role_permissions for select to authenticated
  using (public.is_admin());

drop policy if exists role_permissions_insert_critical on public.role_permissions;
create policy role_permissions_insert_critical
  on public.role_permissions for insert to authenticated
  with check (public.has_permission('admins.permissions'));

drop policy if exists role_permissions_delete_critical on public.role_permissions;
create policy role_permissions_delete_critical
  on public.role_permissions for delete to authenticated
  using (public.has_permission('admins.permissions'));


-- 11.5 — UTILISATEUR ↔ RÔLES
drop policy if exists user_roles_select_self_or_authorised on public.user_roles;
create policy user_roles_select_self_or_authorised
  on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users.view'));

-- Attribuer un rôle d'administration est une permission critique distincte de
-- l'attribution d'un rôle client ou affilié (§ 115, § 141).
drop policy if exists user_roles_insert_authorised on public.user_roles;
create policy user_roles_insert_authorised
  on public.user_roles for insert to authenticated
  with check (
    case
      when public.role_is_admin(role_id) then public.has_permission('admins.permissions')
      else public.has_permission('users.update')
    end
  );

drop policy if exists user_roles_update_authorised on public.user_roles;
create policy user_roles_update_authorised
  on public.user_roles for update to authenticated
  using (
    case
      when public.role_is_admin(role_id) then public.has_permission('admins.permissions')
      else public.has_permission('users.update')
    end
  )
  with check (
    case
      when public.role_is_admin(role_id) then public.has_permission('admins.permissions')
      else public.has_permission('users.update')
    end
  );

drop policy if exists user_roles_delete_authorised on public.user_roles;
create policy user_roles_delete_authorised
  on public.user_roles for delete to authenticated
  using (
    case
      when public.role_is_admin(role_id) then public.has_permission('admins.permissions')
      else public.has_permission('users.update')
    end
  );
