-- =============================================================================
-- PHASE 4J-1 — SOCLE DES NOTIFICATIONS
--
-- Plan : rapport 19 ; arbitrages du propriétaire N1 à N21 (3 octobre 2026).
--
-- Ce que pose cette migration :
--   1. le catalogue des types de notification (source de vérité : espace,
--      niveau, ressource, permission exigée) ;
--   2. la table des notifications, une ligne par destinataire et par espace ;
--   3. la lecture sous RLS, avec la permission ADMINISTRATION revérifiée à
--      chaque lecture (N8) ;
--   4. les seules écritures ouvertes aux sessions : « marquer comme lue » et
--      « tout marquer comme lu » ;
--   5. les fonctions internes de création et de résolution, réservées au
--      serveur et aux déclencheurs futurs (4J-2).
--
-- Ce qu'elle ne fait PAS (4J-1 est un socle) :
--   * aucun branchement sur un journal métier, aucune lecture de
--     `notification_events` (4H, consommée en 4J-2) ;
--   * aucune notification créée : les boîtes restent vides (N16, aucune
--     rétroactivité) ;
--   * aucune préférence utilisateur (N14 — `notification_preferences` est
--     reportée à 4K, voir rapport 20) ;
--   * aucune publication Realtime (N11).
--
-- Principes :
--   * une notification ne stocke ni URL, ni montant, ni coordonnée, ni texte
--     libre (N13) : un type, une ressource (type + identifiant), et au plus
--     une référence MORA-…, un code d'état et une date ;
--   * une notification n'accorde jamais d'accès : la route cible refait ses
--     propres contrôles ;
--   * « lue » (read_at, piloté par le destinataire) et « traitée »
--     (resolved_at, piloté par le seul moteur métier) sont indépendants (N6) ;
--   * l'unicité (destinataire, espace, type, événement source) est garantie
--     par la base, pas par un « select puis insert ».
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LE CATALOGUE DES TYPES
--
-- Une ligne par type. Le texte affiché vit dans le code
-- (`src/lib/notifications/catalogue.ts`) ; un test compare les deux. Les
-- types ne sont pas éditables depuis l'administration : ils changent par
-- migration.
-- -----------------------------------------------------------------------------

create table if not exists public.notification_types (
  code                 text primary key,
  audience             text not null,
  level                text not null,
  entity_type          text not null,
  required_permission  text references public.permissions (code) on update cascade on delete restrict,
  label                text not null,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),

  constraint notification_types_code check (code ~ '^(admin|client|affilie)\.[a-z_]{3,40}\.[a-z_]{3,40}$'),
  constraint notification_types_audience check (audience in ('ADMINISTRATION', 'CLIENT', 'AFFILIE')),
  constraint notification_types_level check (level in ('A_TRAITER', 'INFORMATION', 'ATTENTION')),
  constraint notification_types_entity check (entity_type in (
    'quote_request', 'quote', 'appointment', 'order', 'payment', 'refund', 'client',
    'affiliate', 'affiliate_application', 'affiliate_prospect', 'affiliate_commission', 'affiliate_payout'
  )),
  -- Une notification d'administration exige toujours une permission ; une
  -- notification de client ou d'affilié n'en exige jamais (c'est la propriété
  -- qui compte).
  constraint notification_types_permission check ((audience = 'ADMINISTRATION') = (required_permission is not null)),
  constraint notification_types_prefix check (
    split_part(code, '.', 1) = case audience when 'ADMINISTRATION' then 'admin' when 'CLIENT' then 'client' else 'affilie' end
  ),
  constraint notification_types_label check (btrim(label) <> '' and length(label) <= 120)
);

comment on table public.notification_types is
  'Catalogue des types de notification (4J) : espace, niveau, ressource visée, permission exigée en administration. Modifié par migration seulement.';

-- Arbitrages N2 (client), N3 (affilié), N4 (administration : la permission
-- qui permet réellement d'agir). Rejouer la migration réaligne le catalogue.
insert into public.notification_types (code, audience, level, entity_type, required_permission, label) values
  ('client.devis.disponible',               'CLIENT',         'A_TRAITER',   'quote',                 null,                             'Devis disponible'),
  ('client.rendez_vous.confirme',           'CLIENT',         'INFORMATION', 'appointment',           null,                             'Rendez-vous confirmé'),
  ('client.rendez_vous.reprogramme',        'CLIENT',         'INFORMATION', 'appointment',           null,                             'Rendez-vous reprogrammé'),
  ('client.rendez_vous.annule',             'CLIENT',         'ATTENTION',   'appointment',           null,                             'Rendez-vous annulé'),
  ('client.commande.enregistree',           'CLIENT',         'INFORMATION', 'order',                 null,                             'Commande enregistrée'),
  ('client.commande.confirmee',             'CLIENT',         'INFORMATION', 'order',                 null,                             'Commande confirmée'),
  ('client.commande.attente_information',   'CLIENT',         'A_TRAITER',   'order',                 null,                             'Commande en attente d''information'),
  ('client.commande.prete',                 'CLIENT',         'INFORMATION', 'order',                 null,                             'Commande prête'),
  ('client.commande.terminee',              'CLIENT',         'INFORMATION', 'order',                 null,                             'Commande terminée'),
  ('client.commande.annulee',               'CLIENT',         'ATTENTION',   'order',                 null,                             'Commande annulée'),
  ('client.paiement.confirme',              'CLIENT',         'INFORMATION', 'payment',               null,                             'Paiement confirmé'),
  ('client.paiement.rejete',                'CLIENT',         'ATTENTION',   'payment',               null,                             'Paiement rejeté'),
  ('client.paiement.annule',                'CLIENT',         'INFORMATION', 'payment',               null,                             'Paiement annulé'),
  ('client.remboursement.effectue',         'CLIENT',         'INFORMATION', 'refund',                null,                             'Remboursement effectué'),
  ('client.facture.disponible',             'CLIENT',         'INFORMATION', 'order',                 null,                             'Facture disponible'),
  ('admin.demande.nouvelle',                'ADMINISTRATION', 'A_TRAITER',   'quote_request',         'quotes.manage',                  'Nouvelle demande de devis'),
  ('admin.rendez_vous.nouveau',             'ADMINISTRATION', 'A_TRAITER',   'appointment',           'appointments.update',            'Nouvelle demande de rendez-vous'),
  ('admin.rendez_vous.annule_client',       'ADMINISTRATION', 'INFORMATION', 'appointment',           'appointments.update',            'Rendez-vous annulé par le client'),
  ('admin.devis.accepte',                   'ADMINISTRATION', 'A_TRAITER',   'quote_request',         'orders.update',                  'Devis accepté : commande à créer'),
  ('admin.devis.refuse',                    'ADMINISTRATION', 'INFORMATION', 'quote_request',         'quotes.manage',                  'Devis refusé'),
  ('admin.paiement.a_verifier',             'ADMINISTRATION', 'A_TRAITER',   'payment',               'payments.verify',                'Paiement à vérifier'),
  ('admin.remboursement.a_executer',        'ADMINISTRATION', 'A_TRAITER',   'refund',                'payments.refund',                'Remboursement à exécuter'),
  ('admin.candidature.nouvelle',            'ADMINISTRATION', 'A_TRAITER',   'affiliate_application', 'affiliate_applications.manage',  'Candidature d''affiliation à examiner'),
  ('admin.prospect.a_examiner',             'ADMINISTRATION', 'A_TRAITER',   'affiliate_prospect',    'affiliate_attributions.manage',  'Prospect déclaré à examiner'),
  ('admin.coordonnees.a_examiner',          'ADMINISTRATION', 'A_TRAITER',   'affiliate',             'payouts.manage',                 'Coordonnées de versement à examiner'),
  ('admin.client.nouveau',                  'ADMINISTRATION', 'INFORMATION', 'client',                'users.view',                     'Nouveau client'),
  ('affilie.prospect.valide',               'AFFILIE',        'INFORMATION', 'affiliate_prospect',    null,                             'Prospect validé'),
  ('affilie.prospect.refuse',               'AFFILIE',        'ATTENTION',   'affiliate_prospect',    null,                             'Prospect refusé'),
  ('affilie.commission.enregistree',        'AFFILIE',        'INFORMATION', 'affiliate_commission',  null,                             'Commission enregistrée'),
  ('affilie.commission.acquise',            'AFFILIE',        'INFORMATION', 'affiliate_commission',  null,                             'Commission acquise'),
  ('affilie.commission.validee',            'AFFILIE',        'INFORMATION', 'affiliate_commission',  null,                             'Commission validée'),
  ('affilie.commission.ajustee',            'AFFILIE',        'ATTENTION',   'affiliate_commission',  null,                             'Commission ajustée'),
  ('affilie.commission.annulee',            'AFFILIE',        'ATTENTION',   'affiliate_commission',  null,                             'Commission annulée'),
  ('affilie.versement.confirme',            'AFFILIE',        'INFORMATION', 'affiliate_payout',      null,                             'Versement confirmé'),
  ('affilie.fiche.mise_a_jour',             'AFFILIE',        'INFORMATION', 'affiliate',             null,                             'Fiche affilié mise à jour'),
  ('affilie.coordonnees.validees',          'AFFILIE',        'INFORMATION', 'affiliate',             null,                             'Coordonnées de versement validées'),
  ('affilie.coordonnees.refusees',          'AFFILIE',        'A_TRAITER',   'affiliate',             null,                             'Coordonnées de versement refusées')
on conflict (code) do update
  set audience = excluded.audience,
      level = excluded.level,
      entity_type = excluded.entity_type,
      required_permission = excluded.required_permission,
      label = excluded.label;


-- -----------------------------------------------------------------------------
-- 2. LES DONNÉES MINIMALES D'UNE NOTIFICATION
--
-- Trois clés au plus, toutes contrôlées : une référence MORA-… (jamais un
-- nom, une adresse ou un montant), un code d'état en majuscules, une date.
-- Toute autre clé est refusée par la base.
-- -----------------------------------------------------------------------------

create or replace function public.notification_params_ok(p_params jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_params is not null
     and jsonb_typeof(p_params) = 'object'
     and length(p_params::text) <= 300
     and not exists (
       select 1 from jsonb_object_keys(p_params) as k(key) where k.key not in ('reference', 'statut', 'date')
     )
     and (not (p_params ? 'reference')
          or (jsonb_typeof(p_params -> 'reference') = 'string'
              and (p_params ->> 'reference') ~ '^MORA-[A-Z]{3,6}-[A-Z]{1,2}[0-9]{4}$'))
     and (not (p_params ? 'statut')
          or (jsonb_typeof(p_params -> 'statut') = 'string'
              and (p_params ->> 'statut') ~ '^[A-Z][A-Z_]{1,39}$'))
     and (not (p_params ? 'date')
          or (jsonb_typeof(p_params -> 'date') = 'string'
              and (p_params ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$'));
$$;

comment on function public.notification_params_ok(jsonb) is
  'Données d''une notification : au plus reference (MORA-…), statut (CODE) et date (ISO). Jamais de montant, de coordonnée ni de texte libre (N13).';


-- -----------------------------------------------------------------------------
-- 3. LA TABLE DES NOTIFICATIONS
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  recipient_id         uuid not null references auth.users (id) on delete cascade,
  -- Copiés du catalogue à la création (déclencheur ci-dessous), immuables :
  -- la RLS et le compteur les lisent sans jointure.
  audience             text not null,
  type_code            text not null references public.notification_types (code) on delete restrict,
  level                text not null,
  required_permission  text,
  -- La ressource visée : un type et un identifiant, jamais une URL.
  entity_type          text not null,
  entity_id            uuid not null,
  params               jsonb not null default '{}'::jsonb,
  -- L'événement d'origine (« pourquoi cette notification ? ») — par exemple
  -- `order_events` / `1234`, ou `notification_events` / `56` pour la file 4H.
  source_table         text not null,
  source_id            text not null,
  created_at           timestamptz not null default now(),
  read_at              timestamptz,
  resolved_at          timestamptz,

  constraint notifications_audience check (audience in ('ADMINISTRATION', 'CLIENT', 'AFFILIE')),
  constraint notifications_level check (level in ('A_TRAITER', 'INFORMATION', 'ATTENTION')),
  constraint notifications_permission check ((audience = 'ADMINISTRATION') = (required_permission is not null)),
  constraint notifications_params check (public.notification_params_ok(params)),
  constraint notifications_source_table check (source_table ~ '^[a-z][a-z0-9_]{2,62}$'),
  constraint notifications_source_id check (source_id ~ '^[A-Za-z0-9:_.-]{1,120}$'),
  constraint notifications_read_after check (read_at is null or read_at >= created_at),
  -- « Traitée » n'a de sens que pour ce qui était « à traiter ».
  constraint notifications_resolved_level check (resolved_at is null or level = 'A_TRAITER'),
  constraint notifications_resolved_after check (resolved_at is null or resolved_at >= created_at)
);

comment on table public.notifications is
  'Notifications internes (4J) : une ligne par destinataire et par espace. Ni URL, ni montant, ni coordonnée. Lue (read_at) et traitée (resolved_at) sont indépendantes.';
comment on column public.notifications.read_at is
  'Lecture par le destinataire : seul état qu''une session peut changer, par mark_notification_read / mark_all_notifications_read.';
comment on column public.notifications.resolved_at is
  'L''action métier attendue a été réalisée : posée par le moteur seul (notifications_resolve), jamais par le destinataire.';

-- Idempotence : un même événement ne produit qu'une notification par
-- destinataire, espace et type — garanti par la base, même en concurrence.
create unique index if not exists notifications_dedup_key
  on public.notifications (recipient_id, audience, type_code, source_table, source_id);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, audience, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, audience) where read_at is null;
create index if not exists notifications_entity_idx
  on public.notifications (entity_type, entity_id);
create index if not exists notifications_type_idx
  on public.notifications (type_code);


-- -----------------------------------------------------------------------------
-- 4. INTÉGRITÉ : COPIE DU CATALOGUE, IMMUABILITÉ
-- -----------------------------------------------------------------------------

-- À l'insertion, l'espace, le niveau et la permission sont ceux du catalogue,
-- quoi que l'appelant ait fourni ; la ressource doit être du type attendu.
create or replace function public.tg_notifications_from_catalogue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.notification_types%rowtype;
begin
  select * into v_type from public.notification_types where code = new.type_code;
  if not found then
    raise exception 'Type de notification inconnu : %', new.type_code using errcode = '22023';
  end if;
  if new.entity_type is distinct from v_type.entity_type then
    raise exception 'Ressource % incompatible avec le type % (attendu : %).', new.entity_type, new.type_code, v_type.entity_type
      using errcode = '22023';
  end if;
  new.audience := v_type.audience;
  new.level := v_type.level;
  new.required_permission := v_type.required_permission;
  new.read_at := null;
  new.resolved_at := null;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists notifications_from_catalogue on public.notifications;
create trigger notifications_from_catalogue
  before insert on public.notifications
  for each row execute function public.tg_notifications_from_catalogue();

-- Une notification ne change jamais de destinataire, de type, de ressource ni
-- d'origine. Seuls read_at et resolved_at évoluent, et seulement de « vide »
-- à « posé » : on ne « dé-lit » pas, on ne « dé-traite » pas.
create or replace function public.tg_notifications_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.id, new.recipient_id, new.audience, new.type_code, new.level, new.required_permission,
      new.entity_type, new.entity_id, new.params, new.source_table, new.source_id, new.created_at)
     is distinct from
     (old.id, old.recipient_id, old.audience, old.type_code, old.level, old.required_permission,
      old.entity_type, old.entity_id, old.params, old.source_table, old.source_id, old.created_at) then
    raise exception 'Une notification est immuable : seuls la lecture et le traitement peuvent être enregistrés.'
      using errcode = '42501';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'La lecture d''une notification ne s''annule pas.' using errcode = '42501';
  end if;
  if old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then
    raise exception 'Le traitement d''une notification ne s''annule pas.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_immutable on public.notifications;
create trigger notifications_immutable
  before update on public.notifications
  for each row execute function public.tg_notifications_immutable();


-- -----------------------------------------------------------------------------
-- 5. QUI PEUT LIRE QUOI
--
-- Une notification est visible par son seul destinataire, dans son seul
-- espace, tant que cet espace lui est réellement ouvert :
--   * ADMINISTRATION : compte administrateur actif ET permission exigée
--     détenue AUJOURD'HUI (retrait de droit → notification masquée, N8) ;
--   * CLIENT : rôle CLIENT, profil actif, fiche client non bloquée — le
--     prédicat propriétaire de 4I-4 ;
--   * AFFILIE : profil actif et affiliation rattachée au compte — le
--     prédicat propriétaire de 4I-5.
-- Une notification CLIENT n'apparaît donc jamais dans la boîte AFFILIE du
-- même compte, ni l'inverse : l'espace fait partie de la clé de lecture.
-- -----------------------------------------------------------------------------

create or replace function public.notification_visible(p_recipient uuid, p_audience text, p_required_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_recipient = auth.uid()
     and case p_audience
           when 'ADMINISTRATION' then
             p_required_permission is not null
             and public.is_admin()
             and public.has_permission(p_required_permission)
           when 'CLIENT' then
             public.client_owner_access_ok()
             and exists (
               select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                where ur.user_id = auth.uid() and r.code = 'CLIENT'
             )
           when 'AFFILIE' then
             public.profile_owner_access_ok()
             and exists (select 1 from public.affiliates a where a.user_id = auth.uid())
           else false
         end;
$$;

comment on function public.notification_visible(uuid, text, text) is
  'Vrai si la notification (destinataire, espace, permission) est lisible par la session : destinataire, espace réellement ouvert, permission actuelle en administration.';

revoke execute on function public.notification_visible(uuid, text, text) from public, anon;
grant  execute on function public.notification_visible(uuid, text, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. PRIVILÈGES ET POLITIQUES
--
-- Les sessions lisent, et ne font rien d'autre directement : ni insertion,
-- ni modification, ni suppression. Le marquage passe par les fonctions du
-- § 8, qui ne touchent que read_at.
-- -----------------------------------------------------------------------------

revoke all on public.notifications      from anon, authenticated;
revoke all on public.notification_types from anon, authenticated;
grant select on public.notifications      to authenticated;
grant select on public.notification_types to authenticated;
grant all    on public.notifications      to service_role;
grant all    on public.notification_types to service_role;

alter table public.notifications      enable row level security;
alter table public.notification_types enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select to authenticated
  using (
    recipient_id = (select auth.uid())
    and public.notification_visible(recipient_id, audience, required_permission)
  );

-- Le catalogue ne contient aucune donnée personnelle ; il n'est utile qu'à
-- l'administration (filtres du futur centre).
drop policy if exists notification_types_select on public.notification_types;
create policy notification_types_select
  on public.notification_types for select to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 7. CRÉATION ET RÉSOLUTION — INTERNES
--
-- Réservées au serveur (clé de service) et aux déclencheurs de 4J-2, qui
-- tournent comme propriétaire de la base. Aucune session ne peut s'envoyer
-- une notification.
--
-- Contrat pour 4J-2 (une panne de notification ne fait jamais échouer l'acte
-- métier) :
--   * les cas normaux de non-création renvoient NULL sans erreur : auteur de
--     l'acte, destinataire non éligible, type désactivé, doublon ;
--   * seules les violations de contrat lèvent (type inconnu, ressource
--     incompatible, données refusées) — le répartiteur de 4J-2 enveloppera
--     chaque appel dans un bloc `begin … exception when others` qui consigne
--     l'erreur sans annuler la transaction métier.
-- -----------------------------------------------------------------------------

-- Permission effective d'un compte désigné, `admin.full_access` compris,
-- compte actif seulement. Lecture des droits d'autrui : serveur seul.
create or replace function public.user_has_effective_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.profiles p
            where p.id = p_user_id and p.status = 'ACTIF' and p.deleted_at is null
         )
     and exists (
           select 1 from public.effective_permissions(p_user_id) as code
            where code in (p_permission, 'admin.full_access')
         );
$$;

comment on function public.user_has_effective_permission(uuid, text) is
  'Vrai si le compte désigné, actif, détient la permission (ou admin.full_access). Sert à choisir les destinataires administratifs. Serveur seul.';

revoke execute on function public.user_has_effective_permission(uuid, text) from public, anon, authenticated;
grant  execute on function public.user_has_effective_permission(uuid, text) to service_role;

create or replace function public.notifications_create(
  p_type         text,
  p_recipient    uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_params       jsonb,
  p_source_table text,
  p_source_id    text,
  p_actor        uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.notification_types%rowtype;
  v_id   uuid;
begin
  select * into v_type from public.notification_types where code = p_type;
  if not found then
    raise exception 'Type de notification inconnu : %', p_type using errcode = '22023';
  end if;
  if p_entity_type is distinct from v_type.entity_type then
    raise exception 'Ressource % incompatible avec le type % (attendu : %).', p_entity_type, p_type, v_type.entity_type
      using errcode = '22023';
  end if;
  if p_recipient is null or p_entity_id is null or p_source_table is null or p_source_id is null then
    raise exception 'Notification incomplète : destinataire, ressource et événement source sont obligatoires.'
      using errcode = '22023';
  end if;
  if not public.notification_params_ok(coalesce(p_params, '{}'::jsonb)) then
    raise exception 'Données de notification refusées : seules reference, statut et date sont admises.'
      using errcode = '22023';
  end if;

  if not v_type.active then
    return null;
  end if;
  -- L'auteur d'un acte n'est jamais notifié de sa propre action (N5).
  if p_actor is not null and p_actor = p_recipient then
    return null;
  end if;

  -- Éligibilité du destinataire dans l'espace du type.
  if v_type.audience = 'ADMINISTRATION' then
    if not exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = p_recipient and r.is_admin_role
       )
       or not public.user_has_effective_permission(p_recipient, v_type.required_permission) then
      return null;
    end if;
  elsif v_type.audience = 'CLIENT' then
    if not exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = p_recipient and r.code = 'CLIENT'
       ) then
      return null;
    end if;
  else
    if not exists (select 1 from public.affiliates a where a.user_id = p_recipient) then
      return null;
    end if;
  end if;

  insert into public.notifications (recipient_id, type_code, entity_type, entity_id, params, source_table, source_id)
  values (p_recipient, p_type, p_entity_type, p_entity_id, coalesce(p_params, '{}'::jsonb), p_source_table, p_source_id)
  on conflict (recipient_id, audience, type_code, source_table, source_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.notifications_create(text, uuid, text, uuid, jsonb, text, text, uuid) is
  'Crée une notification pour un destinataire (4J). Interne : serveur et déclencheurs. Renvoie NULL pour un auteur, un destinataire non éligible, un type inactif ou un doublon.';

revoke execute on function public.notifications_create(text, uuid, text, uuid, jsonb, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.notifications_create(text, uuid, text, uuid, jsonb, text, text, uuid) to service_role;

-- Diffusion administrative : chaque administrateur actif qui détient la
-- permission du type, sauf l'auteur. Renvoie le nombre de notifications
-- réellement créées.
create or replace function public.notifications_create_for_admins(
  p_type         text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_params       jsonb,
  p_source_table text,
  p_source_id    text,
  p_actor        uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_audience text;
  v_user     uuid;
  v_count    integer := 0;
begin
  select audience into v_audience from public.notification_types where code = p_type;
  if v_audience is null then
    raise exception 'Type de notification inconnu : %', p_type using errcode = '22023';
  end if;
  if v_audience <> 'ADMINISTRATION' then
    raise exception 'Le type % ne s''adresse pas à l''administration.', p_type using errcode = '22023';
  end if;

  for v_user in
    select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where r.is_admin_role
     order by ur.user_id
  loop
    if public.notifications_create(p_type, v_user, p_entity_type, p_entity_id, p_params, p_source_table, p_source_id, p_actor) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.notifications_create_for_admins(text, text, uuid, jsonb, text, text, uuid) is
  'Diffuse une notification d''administration à chaque administrateur actif détenant la permission du type, sauf l''auteur (N4, N5). Interne.';

revoke execute on function public.notifications_create_for_admins(text, text, uuid, jsonb, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.notifications_create_for_admins(text, text, uuid, jsonb, text, text, uuid) to service_role;

-- Résolution (N6) : l'action métier attendue a été réalisée. Ne touche ni à
-- la lecture, ni aux notifications qui n'étaient pas « à traiter ».
create or replace function public.notifications_resolve(p_types text[], p_entity_type text, p_entity_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.notifications
     set resolved_at = now()
   where type_code = any (p_types)
     and entity_type = p_entity_type
     and entity_id = p_entity_id
     and level = 'A_TRAITER'
     and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notifications_resolve(text[], text, uuid) is
  'Marque comme traitées les notifications « à traiter » d''une ressource, quand l''action métier a eu lieu (N6). Interne : jamais le destinataire.';

revoke execute on function public.notifications_resolve(text[], text, uuid) from public, anon, authenticated;
grant  execute on function public.notifications_resolve(text[], text, uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 8. CE QU'UNE SESSION PEUT FAIRE
-- -----------------------------------------------------------------------------

-- Compteurs d'un espace, sous RLS (security invoker) : non lues, et « à
-- traiter » encore ouvertes. Un administrateur sans la permission d'un type
-- ne compte rien de ce type.
create or replace function public.my_notification_counts(p_audience text)
returns table (unread integer, pending integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (count(*) filter (where n.read_at is null))::integer,
         (count(*) filter (where n.level = 'A_TRAITER' and n.resolved_at is null))::integer
    from public.notifications n
   where n.recipient_id = auth.uid()
     and n.audience = p_audience;
$$;

comment on function public.my_notification_counts(text) is
  'Non lues et « à traiter » ouvertes de la session, pour un espace. Sous RLS : aucune notification invisible n''est comptée.';

revoke execute on function public.my_notification_counts(text) from public, anon;
grant  execute on function public.my_notification_counts(text) to authenticated, service_role;

-- Marquer une notification comme lue. Renvoie vrai si elle vient de l'être ;
-- faux si elle n'existe pas, n'est pas visible par la session, ou était déjà
-- lue — sans distinguer, pour ne rien révéler d'une notification d'autrui.
create or replace function public.mark_notification_read(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.notifications n
     set read_at = now()
   where n.id = p_id
     and n.recipient_id = auth.uid()
     and n.read_at is null
     and public.notification_visible(n.recipient_id, n.audience, n.required_permission)
  returning n.id into v_id;
  return v_id is not null;
end;
$$;

comment on function public.mark_notification_read(uuid) is
  'Marque comme lue une notification visible par la session. Ne touche que read_at ; jamais « traitée ».';

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant  execute on function public.mark_notification_read(uuid) to authenticated;

-- Tout marquer comme lu, dans un seul espace. Renvoie le nombre de
-- notifications marquées.
create or replace function public.mark_all_notifications_read(p_audience text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_audience is null or p_audience not in ('ADMINISTRATION', 'CLIENT', 'AFFILIE') then
    raise exception 'Espace inconnu.' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return 0;
  end if;
  update public.notifications n
     set read_at = now()
   where n.recipient_id = auth.uid()
     and n.audience = p_audience
     and n.read_at is null
     and public.notification_visible(n.recipient_id, n.audience, n.required_permission);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_all_notifications_read(text) is
  'Marque comme lues toutes les notifications visibles de la session dans un espace. Les autres espaces du même compte ne sont pas touchés.';

revoke execute on function public.mark_all_notifications_read(text) from public, anon;
grant  execute on function public.mark_all_notifications_read(text) to authenticated;
