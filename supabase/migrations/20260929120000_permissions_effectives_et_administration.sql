-- =============================================================================
-- MORA SHAWIRI — Migration 0004
-- Permissions EFFECTIVES par compte, invitations d'administrateurs, et les
-- trois correctifs techniques que le rapport de phase 4B (§ 12.2) avait
-- explicitement renvoyés « à la prochaine migration, qui viendra naturellement
-- avec la phase 4C ».
--
-- Références :
--   07_ARCHITECTURE_TECHNIQUE/02_ROLES_ET_PERMISSIONS.md § 6, § 21, § 66,
--                                                        § 96-97, § 106, § 141-142
--   05_FONCTIONNALITES/05_TABLEAU_DE_BORD_ADMINISTRATEUR.md § 10, § 113-114, § 194
--   04 - Analyse et plan de développement.md               § 9.4, phase 4C
--   06 - Rapport Phase 4B                                  § 12.2
--
-- -----------------------------------------------------------------------------
-- DÉCISION D-18 — pourquoi cette migration existe
-- -----------------------------------------------------------------------------
--
-- La phase 4A n'attachait les permissions qu'aux RÔLES. Attribuer le rôle
-- `ADMIN` accordait donc d'un bloc ses 40 permissions, sans qu'aucune ne puisse
-- être retirée individuellement. Le cadrage de la phase 4C demande l'inverse :
--
--   « Ne donne pas automatiquement toutes les permissions à un futur ADMIN.
--     Les permissions doivent pouvoir être attribuées et retirées
--     individuellement. »
--
-- Le propriétaire a tranché en faveur de permissions individuelles par compte.
-- Le modèle devient donc :
--
--   permissions effectives = permissions des rôles portés
--                          ∪ octrois individuels
--                          ∖ retraits individuels
--
-- Le rôle ne disparaît pas : il reste ce qui distingue un compte administratif
-- d'un compte client, et `SUPER_ADMIN` conserve `admin.full_access`. Mais le
-- rôle `ADMIN` cesse d'être un paquet de droits pour redevenir ce que le § 141
-- décrit — une qualité, pas une autorisation. Ses 40 permissions deviennent un
-- MODÈLE proposé à la création d'un administrateur, que le super-administrateur
-- coche et décoche ligne à ligne. Le modèle vit dans le code applicatif
-- (`src/lib/rbac/catalogue.ts`), pas dans la base : un modèle n'est pas un
-- droit.
--
-- Rien n'est détruit : aucun compte ne portait le rôle `ADMIN` au moment de
-- cette migration, et `SUPER_ADMIN` n'est pas touché.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. OCTROIS ET RETRAITS INDIVIDUELS
--
-- Une ligne par couple (compte, permission). `effect` dit dans quel sens :
--
--   OCTROI  le compte détient la permission, même si aucun de ses rôles
--           ne l'accorde ;
--   RETRAIT le compte ne la détient pas, même si un de ses rôles l'accorde.
--
-- Le retrait existe pour une raison précise : sans lui, la seule façon de
-- reprendre un droit accordé par un rôle serait de retirer le rôle entier,
-- donc l'accès à l'administration. Le § 10 du tableau de bord
-- (moindre privilège) demande de pouvoir faire exactement le contraire.
-- -----------------------------------------------------------------------------

create table if not exists public.user_permissions (
  user_id       uuid not null references auth.users (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  effect        text not null default 'OCTROI' check (effect in ('OCTROI', 'RETRAIT')),
  -- Auteur de la décision. Conservé même si le compte auteur disparaît : la
  -- trace d'audit n'est pas la seule, mais elle doit rester lisible.
  granted_by    uuid references auth.users (id) on delete set null,
  note          text check (note is null or length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, permission_id)
);

comment on table public.user_permissions is
  'Octrois et retraits de permissions au niveau du compte. Se superposent aux permissions des rôles (décision D-18, phase 4C).';
comment on column public.user_permissions.effect is
  'OCTROI : accorde la permission au compte. RETRAIT : la lui refuse, même si un rôle l''accorde.';

create index if not exists user_permissions_user_idx
  on public.user_permissions (user_id);
create index if not exists user_permissions_permission_idx
  on public.user_permissions (permission_id);

drop trigger if exists user_permissions_set_updated_at on public.user_permissions;
create trigger user_permissions_set_updated_at
  before update on public.user_permissions
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. LE MOTEUR DE PERMISSIONS EFFECTIVES
--
-- Une seule fonction calcule le résultat ; toutes les autres en découlent.
-- C'est volontaire : le § 141 interdit deux sources de vérité, et le socle
-- abandonné avait justement perdu une règle métier dupliquée à deux endroits.
--
-- Lecture hors RLS (`security definer`) parce que ces fonctions sont
-- précisément ce que les politiques RLS appellent. Une fonction d'autorisation
-- soumise aux politiques qu'elle sert tournerait en rond.
-- -----------------------------------------------------------------------------

create or replace function public.effective_permissions(p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with granted_by_role as (
    select p.code
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id
  ),
  granted_directly as (
    select p.code
    from public.user_permissions up
    join public.permissions p on p.id = up.permission_id
    where up.user_id = p_user_id and up.effect = 'OCTROI'
  ),
  revoked_directly as (
    select p.code
    from public.user_permissions up
    join public.permissions p on p.id = up.permission_id
    where up.user_id = p_user_id and up.effect = 'RETRAIT'
  )
  select distinct code
  from (
    select code from granted_by_role
    union
    select code from granted_directly
  ) as accorde
  where code not in (select code from revoked_directly);
$$;

-- Ce que les seuls rôles accordent, avant tout ajustement.
--
-- L'interface en a besoin pour expliquer d'où vient chaque droit : une case
-- cochée sans origine lisible n'est pas de la traçabilité (§ 127). La lire par
-- une fonction plutôt que par une jointure imbriquée depuis l'application
-- évite en prime de dépendre de la forme exacte des relations PostgREST.
create or replace function public.role_permissions_of(p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct p.code
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = p_user_id;
$$;

comment on function public.role_permissions_of(uuid) is
  'Permissions qu''un compte tient de ses seuls rôles, avant octrois et retraits individuels.';

-- Fonction de calcul, pas de lecture : elle ne filtre rien et dirait donc les
-- droits de n'importe qui. L'exécution reste au serveur ; l'interface passe par
-- `public.account_permissions()`, qui vérifie qui demande.
revoke all on function public.role_permissions_of(uuid) from public, anon, authenticated;
grant execute on function public.role_permissions_of(uuid) to service_role;

comment on function public.effective_permissions(uuid) is
  'Permissions effectives d''un compte : celles de ses rôles, plus ses octrois individuels, moins ses retraits individuels. Ne vérifie pas le statut du compte.';

-- Même calcul, mais pour le compte connecté et **sous condition de statut** :
-- un compte suspendu, désactivé ou supprimé n'a aucune permission (§ 33-35 de
-- l'authentification). C'est ce que consomme l'application.
create or replace function public.current_permissions()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- L'alias est nécessaire : une fonction renvoyant `setof text` nomme sa
  -- colonne d'après elle-même, pas d'après ce qu'elle contient.
  select code
  from public.effective_permissions(auth.uid()) as code
  where exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and pr.status = 'ACTIF'
      and pr.deleted_at is null
  );
$$;

comment on function public.current_permissions() is
  'Permissions effectives du compte connecté, rôles et ajustements individuels compris. Vide si le compte est suspendu, désactivé ou supprimé.';

-- Refus par défaut (§ 106). `admin.full_access` couvre tout (§ 45) — et se
-- retire comme n'importe quelle autre permission, ce qui permet de rétrograder
-- un super-administrateur sans toucher à son rôle.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.current_permissions() as code
    where code in (p_permission, 'admin.full_access')
  );
$$;

comment on function public.has_permission(text) is
  'Vrai si le compte connecté détient la permission demandée, ou la permission globale admin.full_access. Tient compte des octrois et retraits individuels.';

-- Lecture hors RLS réservée aux garde-fous : ils doivent raisonner sur l'état
-- réel de la base, pas sur la vue partielle qu'une politique accorde.
create or replace function public.user_holds_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.effective_permissions(p_user_id) as code
    where code = p_permission
  );
$$;

comment on function public.user_holds_permission(uuid, text) is
  'Vrai si le compte désigné détient la permission indiquée, indépendamment de son statut. Lecture hors RLS, réservée aux garde-fous.';

-- Nombre de comptes ACTIFS détenant une permission. C'est ce compte qui protège
-- le dernier administrateur (§ 21). Il doit voir les octrois individuels, sans
-- quoi un super-administrateur promu par octroi ne compterait pas, et le
-- garde-fou bloquerait une opération pourtant sûre.
create or replace function public.count_active_holders(p_permission text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.profiles pr
  where pr.status = 'ACTIF'
    and pr.deleted_at is null
    and public.user_holds_permission(pr.id, p_permission);
$$;

comment on function public.count_active_holders(text) is
  'Nombre de comptes actifs détenant la permission indiquée, ajustements individuels compris.';


-- Même raison : `effective_permissions` répond pour n'importe quel compte.
-- Les fonctions d'autorisation l'appellent en `security definer`, donc sans
-- avoir besoin que l'appelant détienne le droit d'exécution.
revoke all on function public.effective_permissions(uuid) from public, anon, authenticated;
grant execute on function public.effective_permissions(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- La lecture, elle, est filtrée : son propre détail, ou `users.view`.
-- Une seule ligne par permission du catalogue, avec son origine — c'est
-- exactement ce que la fiche d'un administrateur affiche.
-- -----------------------------------------------------------------------------

-- Vrai si le compte désigné porte un rôle d'administration. Lecture hors RLS :
-- sert à décider qui peut voir quoi, donc ne peut pas dépendre de ce qu'on voit.
create or replace function public.account_is_admin(p_user_id uuid)
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
    where ur.user_id = p_user_id and r.is_admin_role
  );
$$;

comment on function public.account_is_admin(uuid) is
  'Vrai si le compte désigné porte un rôle d''administration, quel que soit son statut.';

-- Qui a le droit de consulter la fiche d'un compte.
--
-- `users.view` ouvre l'ensemble des comptes — c'est le droit du module Clients.
-- `admins.view` n'ouvre que les comptes administratifs : le module
-- Administrateurs doit pouvoir lister ses pairs sans recevoir au passage
-- l'accès au fichier client, ce que le § 10 (moindre privilège) demande et que
-- le § 57 (protection des données) rend nécessaire.
create or replace function public.can_view_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id = auth.uid()
      or public.has_permission('users.view')
      or (public.has_permission('admins.view') and public.account_is_admin(p_user_id));
$$;

comment on function public.can_view_account(uuid) is
  'Vrai si le compte connecté peut consulter la fiche du compte désigné : lui-même, users.view, ou admins.view sur un compte administratif.';

grant execute on function public.account_is_admin(uuid) to authenticated, service_role;
grant execute on function public.can_view_account(uuid) to authenticated, service_role;

create or replace function public.account_permissions(p_user_id uuid)
returns table (code text, from_role boolean, effect text, effective boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.code,
    exists (select 1 from public.role_permissions_of(p_user_id) rc where rc = p.code) as from_role,
    up.effect,
    exists (select 1 from public.effective_permissions(p_user_id) ec where ec = p.code) as effective
  from public.permissions p
  left join public.user_permissions up
    on up.permission_id = p.id and up.user_id = p_user_id
  where public.can_view_account(p_user_id)
  order by p.domain, p.action;
$$;

comment on function public.account_permissions(uuid) is
  'Catalogue des permissions vu depuis un compte : origine (rôle, octroi, retrait) et détention effective. Filtré : son propre détail, ou users.view.';

grant execute on function public.account_permissions(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. GARDE-FOUS SUR LES AJUSTEMENTS INDIVIDUELS
--
-- Trois interdits, dans cet ordre :
--   1. personne ne modifie ses propres permissions — § 96-97, aucune exception,
--      pas même pour `admin.full_access` ;
--   2. le dernier détenteur actif d'une permission critique ne peut pas la
--      perdre — § 21 ;
--   3. seule `admins.permissions` autorise l'opération — porté par RLS (§ 5).
-- -----------------------------------------------------------------------------

create or replace function public.tg_user_permissions_guard()
returns trigger
language plpgsql
as $$
declare
  v_row        public.user_permissions;
  v_code       text;
  v_critical   boolean;
  v_perd_droit boolean;
begin
  if public.is_privileged_db_role() then
    return coalesce(new, old);
  end if;

  v_row := coalesce(new, old);

  -- 1. Auto-élévation : interdite quelle que soit la permission détenue.
  -- Un super-administrateur ne peut pas davantage se retirer un droit
  -- lui-même ; passer par un autre compte rend l'action traçable.
  if v_row.user_id = auth.uid() then
    raise exception 'Un compte ne peut pas modifier ses propres permissions'
      using errcode = '42501';
  end if;

  select p.code, p.is_critical
    into v_code, v_critical
    from public.permissions p
   where p.id = v_row.permission_id;

  -- 2. Le compte cible perd-il la permission du fait de cette opération ?
  --    Trois façons de la perdre : retirer un octroi, poser un retrait,
  --    transformer un octroi en retrait.
  v_perd_droit := case
    when tg_op = 'DELETE'  then old.effect = 'OCTROI'
    when tg_op = 'INSERT'  then new.effect = 'RETRAIT'
    when tg_op = 'UPDATE'  then old.effect = 'OCTROI' and new.effect = 'RETRAIT'
    else false
  end;

  if v_perd_droit
     and coalesce(v_critical, false)
     and public.user_holds_permission(v_row.user_id, v_code)
     and public.count_active_holders(v_code) <= 1
  then
    raise exception 'Retrait impossible : ce compte est le dernier à détenir la permission critique %', v_code
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.tg_user_permissions_guard() is
  'Interdit qu''un compte modifie ses propres permissions et protège le dernier détenteur d''une permission critique.';

drop trigger if exists user_permissions_guard on public.user_permissions;
create trigger user_permissions_guard
  before insert or update or delete on public.user_permissions
  for each row execute function public.tg_user_permissions_guard();


-- Le garde-fou des rôles protégeait `admin.full_access` seul. Il doit
-- désormais protéger toute permission critique que le rôle retiré serait le
-- dernier à porter pour ce compte — sinon un retrait de rôle contournerait le
-- garde-fou posé ci-dessus.
create or replace function public.tg_user_roles_guard()
returns trigger
language plpgsql
as $$
declare
  v_code text;
begin
  if public.is_privileged_db_role() then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.user_id = auth.uid() then
      raise exception 'Un compte ne peut pas s''attribuer un rôle à lui-même'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('DELETE', 'UPDATE') then
    -- Chaque permission critique que ce rôle accorde et que le compte
    -- détiendrait pour la dernière fois sur la plateforme.
    for v_code in
      select p.code
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = old.role_id
        and p.is_critical
    loop
      if public.user_holds_permission(old.user_id, v_code)
         and public.count_active_holders(v_code) <= 1
      then
        raise exception 'Retrait impossible : ce compte est le dernier à détenir la permission critique %', v_code
          using errcode = '42501';
      end if;
    end loop;
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.tg_user_roles_guard() is
  'Interdit l''auto-attribution de rôle et protège le dernier détenteur de chaque permission critique.';

drop trigger if exists user_roles_guard on public.user_roles;
create trigger user_roles_guard
  before insert or update or delete on public.user_roles
  for each row execute function public.tg_user_roles_guard();


-- -----------------------------------------------------------------------------
-- 4. LE NIVEAU D'ASSURANCE ENTRE DANS RLS — correctif 4B § 12.2
--
-- Le rapport 4B signalait que les politiques ignoraient le niveau d'assurance.
-- Les tables sensibles créées par cette migration l'exigent : permission ET
-- second facteur vérifié. Le niveau applicatif l'imposait déjà à chaque
-- requête ; la base le redit pour son propre compte, ce qui referme le
-- scénario d'une requête atteignant PostgREST sans passer par une page.
-- -----------------------------------------------------------------------------

create or replace function public.session_is_aal2()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    'aal1'
  ) = 'aal2';
$$;

comment on function public.session_is_aal2() is
  'Vrai si la session présente un second facteur vérifié. Toute valeur inattendue vaut aal1 : en autorisation, l''inconnu vaut le moins-disant.';

grant execute on function public.session_is_aal2() to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. RLS SUR LES AJUSTEMENTS INDIVIDUELS
--
-- Lecture : son propre détail, ou `users.view` — un administrateur qui consulte
-- une fiche doit voir pourquoi le compte a tel droit.
-- Écriture : `admins.permissions` et rien d'autre. C'est la permission critique
-- qui gouverne déjà l'attribution des rôles administratifs (§ 115, § 141).
-- -----------------------------------------------------------------------------

alter table public.user_permissions enable row level security;

drop policy if exists user_permissions_select_self_or_authorised on public.user_permissions;
create policy user_permissions_select_self_or_authorised
  on public.user_permissions for select to authenticated
  using (public.can_view_account(user_id));

drop policy if exists user_permissions_insert_critical on public.user_permissions;
create policy user_permissions_insert_critical
  on public.user_permissions for insert to authenticated
  with check (public.has_permission('admins.permissions') and public.session_is_aal2());

drop policy if exists user_permissions_update_critical on public.user_permissions;
create policy user_permissions_update_critical
  on public.user_permissions for update to authenticated
  using (public.has_permission('admins.permissions') and public.session_is_aal2())
  with check (public.has_permission('admins.permissions') and public.session_is_aal2());

drop policy if exists user_permissions_delete_critical on public.user_permissions;
create policy user_permissions_delete_critical
  on public.user_permissions for delete to authenticated
  using (public.has_permission('admins.permissions') and public.session_is_aal2());

revoke all on public.user_permissions from anon;
grant select, insert, update, delete on public.user_permissions to authenticated;



-- -----------------------------------------------------------------------------
-- 6. LE RÔLE `ADMIN` CESSE D'ÊTRE UN PAQUET DE DROITS
--
-- Application directe de D-18. Le rôle subsiste — il porte `is_admin_role` et
-- décide donc de l'accès à l'espace d'administration — mais il n'accorde plus
-- aucune permission par lui-même. Les droits se donnent compte par compte.
--
-- `SUPER_ADMIN` n'est pas touché : il conserve `admin.full_access`, sans quoi
-- la plateforme deviendrait inadministrable à l'instant même de la migration.
--
-- Cette suppression est rejouable et ne détruit aucune donnée de compte :
-- `role_permissions` décrit un modèle, pas une attribution.
-- -----------------------------------------------------------------------------

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.code = 'ADMIN';


-- -----------------------------------------------------------------------------
-- 7. INVITATIONS D'ADMINISTRATEURS
--
-- Décision D-19 : l'invitation part par le SMTP du site (celui qui fonctionne),
-- pas par le service d'e-mail intégré de Supabase, dont le rapport 4B § 10.1
-- établit qu'il ne livre qu'à l'organisation et plafonne à deux messages par
-- heure.
--
-- Le jeton n'est jamais stocké en clair : seule son empreinte l'est. Une fuite
-- de la table ne permettrait donc d'accepter aucune invitation — c'est la même
-- règle que pour les jetons de réinitialisation (§ 9.1 du plan).
-- -----------------------------------------------------------------------------

create table if not exists public.admin_invitations (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  email          text not null,
  full_name      text,
  role_id        uuid not null references public.roles (id) on delete restrict,
  -- Permissions proposées à l'acceptation. Codes du catalogue, vérifiés par
  -- l'application avant écriture ; la base garantit seulement la forme.
  permissions    text[] not null default '{}',
  token_hash     text not null unique,
  expires_at     timestamptz not null,
  accepted_at    timestamptz,
  revoked_at     timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint admin_invitations_username_format
    check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  constraint admin_invitations_email_format
    check (position('@' in email) > 1),
  -- Une invitation acceptée ne peut pas avoir été révoquée, et inversement.
  constraint admin_invitations_etat_coherent
    check (accepted_at is null or revoked_at is null)
);

comment on table public.admin_invitations is
  'Invitations d''administrateurs en attente. Le jeton n''est stocké que sous forme d''empreinte (décision D-19, phase 4C).';
comment on column public.admin_invitations.token_hash is
  'Empreinte SHA-256 du jeton envoyé par e-mail. La valeur en clair n''existe que dans le message.';

create index if not exists admin_invitations_email_idx
  on public.admin_invitations (lower(email));
create index if not exists admin_invitations_pending_idx
  on public.admin_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

drop trigger if exists admin_invitations_set_updated_at on public.admin_invitations;
create trigger admin_invitations_set_updated_at
  before update on public.admin_invitations
  for each row execute function public.set_updated_at();

alter table public.admin_invitations enable row level security;

-- Aucune politique pour `anon` : accepter une invitation se fait sans session,
-- donc par le serveur applicatif et sa clé à privilèges. Ouvrir cette table en
-- lecture anonyme reviendrait à publier la liste des administrateurs à venir.
drop policy if exists admin_invitations_select_authorised on public.admin_invitations;
create policy admin_invitations_select_authorised
  on public.admin_invitations for select to authenticated
  using (public.has_permission('admins.view'));

drop policy if exists admin_invitations_insert_authorised on public.admin_invitations;
create policy admin_invitations_insert_authorised
  on public.admin_invitations for insert to authenticated
  with check (public.has_permission('admins.create') and public.session_is_aal2());

drop policy if exists admin_invitations_update_authorised on public.admin_invitations;
create policy admin_invitations_update_authorised
  on public.admin_invitations for update to authenticated
  using (public.has_permission('admins.create') and public.session_is_aal2())
  with check (public.has_permission('admins.create') and public.session_is_aal2());

-- Aucune politique DELETE : une invitation se révoque, elle ne s'efface pas.
-- Le § 127 du tableau de bord demande la traçabilité ; une invitation disparue
-- ne prouve rien.

revoke all on public.admin_invitations from anon;
grant select, insert, update on public.admin_invitations to authenticated;


-- -----------------------------------------------------------------------------
-- 8. CORRECTIF 4B § 12.2 — L'IDENTIFIANT NE SE REVENDIQUE PLUS À L'INSCRIPTION
--
-- Le déclencheur lisait `username` dans `raw_user_meta_data`, que le client
-- contrôle : une requête forgée contre l'API d'authentification pouvait donc
-- revendiquer un identifiant libre — `amina`, `nizaati`. Aucune élévation
-- n'était possible (un tel compte n'obtient aucun rôle), mais l'identifiant
-- métier est la clé de connexion des administrateurs : le laisser prendre par
-- un inconnu est un incident en soi.
--
-- `raw_app_meta_data` ne s'écrit que par l'API d'administration, donc par la
-- clé secrète, donc côté serveur. L'identifiant vient désormais de là, et de
-- là uniquement. `scripts/provision-admins.mjs` et l'acceptation d'invitation
-- ont été alignés en conséquence.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_fullname text;
begin
  -- Métadonnées applicatives : inaccessibles au navigateur.
  v_username := nullif(lower(trim(new.raw_app_meta_data ->> 'username')), '');

  -- Le nom complet, lui, reste une donnée que la personne fournit elle-même.
  v_fullname := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_app_meta_data ->> 'full_name'), '')
  );

  insert into public.profiles (id, username, full_name)
  values (new.id, v_username, v_fullname)
  on conflict (id) do nothing;

  return new;
exception
  when unique_violation then
    insert into public.profiles (id, full_name)
    values (new.id, v_fullname)
    on conflict (id) do nothing;
    return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Crée le profil applicatif associé à un nouveau compte. L''identifiant métier ne peut venir que des métadonnées applicatives, jamais du navigateur.';


-- -----------------------------------------------------------------------------
-- 9. CORRECTIF 4B § 12.2 — INCRÉMENT ATOMIQUE DU COMPTEUR DE FRÉQUENCE
--
-- Lire puis écrire en deux temps laissait deux requêtes simultanées n'en
-- compter qu'une. La sous-évaluation restait faible, mais elle était réelle.
-- Une seule instruction `insert … on conflict do update` supprime la fenêtre.
-- -----------------------------------------------------------------------------

create or replace function public.bump_rate_limit(
  p_bucket        text,
  p_subject_hash  text,
  p_window_start  timestamptz,
  p_blocked_until timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  insert into public.rate_limit_counters (bucket, subject_hash, window_start, attempts, blocked_until)
  values (p_bucket, p_subject_hash, p_window_start, 1, p_blocked_until)
  on conflict (bucket, subject_hash, window_start) do update
    set attempts      = public.rate_limit_counters.attempts + 1,
        blocked_until = greatest(
          coalesce(public.rate_limit_counters.blocked_until, '-infinity'::timestamptz),
          coalesce(excluded.blocked_until, '-infinity'::timestamptz)
        ),
        updated_at    = now()
  returning attempts into v_attempts;

  return v_attempts;
end;
$$;

comment on function public.bump_rate_limit(text, text, timestamptz, timestamptz) is
  'Incrémente un compteur de limitation de fréquence en une seule instruction et renvoie le nouveau total.';

-- Exécution réservée au serveur : la table n'a aucune politique RLS, et un
-- compteur qu'un client pourrait incrémenter — ou contourner — ne limite rien.
revoke all on function public.bump_rate_limit(text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, text, timestamptz, timestamptz) to service_role;


-- -----------------------------------------------------------------------------
-- 10. LE MODULE ADMINISTRATEURS DOIT POUVOIR LIRE SES PAIRS
--
-- Les politiques de la phase 4A n'ouvraient `profiles` et `user_roles` qu'à
-- `users.view`. Un compte porteur de `admins.view` — et de lui seul — aurait
-- donc vu une liste d'administrateurs vide, ce qui aurait poussé à lui accorder
-- `users.view`, donc l'accès au fichier client tout entier : l'inverse du
-- moindre privilège que le § 10 demande.
--
-- Les deux politiques sont donc élargies, et **uniquement** aux comptes
-- administratifs : `admins.view` ne donne toujours accès à aucune fiche client.
-- Le reste de leur définition est inchangé.
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select_self_or_authorised on public.profiles;
create policy profiles_select_self_or_authorised
  on public.profiles for select to authenticated
  using (public.can_view_account(id));

drop policy if exists user_roles_select_self_or_authorised on public.user_roles;
create policy user_roles_select_self_or_authorised
  on public.user_roles for select to authenticated
  using (public.can_view_account(user_id));
