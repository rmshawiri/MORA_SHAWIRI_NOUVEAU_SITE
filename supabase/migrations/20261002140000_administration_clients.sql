-- =============================================================================
-- PHASE 4I-4 — ADMINISTRATION CLIENTS
--
--   1. le blocage d'un client (et son déblocage), motivé, journalisé, sans
--      rien supprimer ;
--   2. les notes internes client, en ajout seul ;
--   3. le durcissement transversal : un compte suspendu, ou un client bloqué,
--      ne lit plus ses données privées en tant que propriétaire — même avec
--      une session encore valide ; c'est la base qui refuse ;
--   4. les lectures administratives de la liste et de la fiche ;
--   5. le rattachement historique depuis la fiche, sur le mécanisme existant
--      (`attach_historical_request`), chaque type sous sa permission 4F.
--
-- Aucune donnée réelle n'est modifiée : ni MORA-CLI-A0001 / A0002, ni la
-- demande MORA-DMCL-A0001, ni le rendez-vous réel.
--
-- ## Bloquer un client sans retirer ses autres rôles (décision 11)
--
-- Le blocage est porté par la fiche client (`clients.blocked_at`) : c'est lui
-- que les accès « propriétaire » vérifient. Le profil n'est passé à SUSPENDU
-- (connexion refusée) que si le compte n'a pas d'autre rôle que CLIENT. Un
-- compte CLIENT + ADMIN (ou + AFFILIE) bloqué perd son espace client et ses
-- accès propriétaire ; ses autres rôles et permissions restent intacts.
-- Le déblocage ne rend son statut au profil que si c'est le blocage qui
-- l'avait suspendu.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. BLOCAGE : COLONNES ET HISTORIQUE
-- -----------------------------------------------------------------------------

alter table public.clients
  add column if not exists blocked_at                 timestamptz,
  add column if not exists blocked_by                 uuid references public.profiles (id) on delete set null,
  add column if not exists block_reason               text,
  add column if not exists profile_suspended_by_block boolean not null default false;

alter table public.clients drop constraint if exists clients_block_coherent;
alter table public.clients add constraint clients_block_coherent check (
  (blocked_at is null and block_reason is null and not profile_suspended_by_block)
  or (blocked_at is not null and block_reason is not null and length(btrim(block_reason)) between 3 and 500)
);

comment on column public.clients.blocked_at is
  'Blocage du client (4I-4) : son espace et ses accès propriétaire sont fermés. Rien n''est supprimé.';
comment on column public.clients.profile_suspended_by_block is
  'Vrai quand le blocage a aussi suspendu le profil (compte sans autre rôle que CLIENT) : le déblocage le réactive.';

create table if not exists public.client_status_events (
  id                bigint generated always as identity primary key,
  client_user_id    uuid not null references public.clients (user_id) on delete cascade,
  kind              text not null check (kind in ('BLOCAGE', 'DEBLOCAGE')),
  reason            text,
  profile_suspended boolean not null default false,
  actor_id          uuid references auth.users (id) on delete set null,
  actor_label       text,
  created_at        timestamptz not null default now(),
  constraint client_status_events_reason check (reason is null or length(reason) between 3 and 500),
  constraint client_status_events_block_reason check (kind <> 'BLOCAGE' or reason is not null)
);

comment on table public.client_status_events is
  'Historique en ajout seul des blocages et déblocages d''un client (4I-4) : qui, quand, pourquoi.';

create index if not exists client_status_events_client_idx on public.client_status_events (client_user_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 2. NOTES INTERNES CLIENT
--
-- Ajout seul : une note ne se modifie pas et ne se supprime pas. Une
-- correction est une nouvelle note qui désigne celle qu'elle corrige.
-- Jamais lisibles par le client : aucune politique ne les lui ouvre.
-- -----------------------------------------------------------------------------

create table if not exists public.client_notes (
  id               uuid primary key default gen_random_uuid(),
  client_user_id   uuid not null references public.clients (user_id) on delete cascade,
  body             text not null,
  corrects_note_id uuid references public.client_notes (id) on delete restrict,
  author_id        uuid references auth.users (id) on delete set null,
  author_label     text,
  created_at       timestamptz not null default now(),
  constraint client_notes_body check (btrim(body) <> '' and length(body) <= 4000)
);

comment on table public.client_notes is
  'Notes internes sur un client (4I-4), en ajout seul. Une correction est une nouvelle note liée à la précédente.';

create index if not exists client_notes_client_idx on public.client_notes (client_user_id, created_at desc);

-- Ajout seul, pour tout le monde ; seule la disparition du compte (cascade)
-- emporte ces lignes — même règle que la fiche client.
create or replace function public.tg_client_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Cet historique est en ajout seul.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clients c where c.user_id = old.client_user_id) then
    raise exception 'Cet historique est en ajout seul.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists client_notes_append_only on public.client_notes;
create trigger client_notes_append_only
  before update or delete on public.client_notes
  for each row execute function public.tg_client_append_only();

drop trigger if exists client_status_events_append_only on public.client_status_events;
create trigger client_status_events_append_only
  before update or delete on public.client_status_events
  for each row execute function public.tg_client_append_only();

alter table public.client_notes enable row level security;
alter table public.client_status_events enable row level security;
revoke all on public.client_notes from anon, authenticated;
revoke all on public.client_status_events from anon, authenticated;
grant select on public.client_notes to authenticated;
grant select on public.client_status_events to authenticated;

drop policy if exists client_notes_select_admin on public.client_notes;
create policy client_notes_select_admin
  on public.client_notes for select to authenticated
  using (public.has_permission('users.view'));

drop policy if exists client_status_events_select_admin on public.client_status_events;
create policy client_status_events_select_admin
  on public.client_status_events for select to authenticated
  using (public.has_permission('users.view'));


-- -----------------------------------------------------------------------------
-- 3. LE PRÉDICAT D'ACCÈS PROPRIÉTAIRE
--
-- Vrai seulement pour un compte actif (ni suspendu, ni désactivé, ni supprimé)
-- dont la fiche client n'est pas bloquée. Évalué une fois par requête dans les
-- politiques (`(select …)`).
-- -----------------------------------------------------------------------------

create or replace function public.client_owner_access_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIF' and p.deleted_at is null)
     and not exists (select 1 from public.clients c where c.user_id = auth.uid() and c.blocked_at is not null);
$$;

comment on function public.client_owner_access_ok() is
  'Accès propriétaire autorisé : compte actif et fiche client non bloquée (4I-4). Utilisé par les politiques *_select_own.';

revoke execute on function public.client_owner_access_ok() from public, anon;
grant  execute on function public.client_owner_access_ok() to authenticated, service_role;

-- Pièces : un profil suspendu ne lit plus ses pièces ; un client bloqué ne
-- lit plus ses pièces client. Les pièces d'affiliation (FIAF, RVAF) suivent le
-- seul statut du profil : bloquer l'espace client ne ferme pas l'espace affilié.
create or replace function public.document_owner_access_ok(p_doc_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIF' and p.deleted_at is null)
     and (p_doc_type in ('FIAF', 'RVAF')
          or not exists (select 1 from public.clients c where c.user_id = auth.uid() and c.blocked_at is not null));
$$;

revoke execute on function public.document_owner_access_ok(text) from public, anon;
grant  execute on function public.document_owner_access_ok(text) to authenticated, service_role;

-- Les fonctions client de 4I-3 (décision, annulation, chronologies,
-- rattachement) passent par ce contrôle : il refuse désormais aussi un client
-- bloqué.
create or replace function public.client_session_is_active(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_uid and p.status = 'ACTIF' and p.deleted_at is null
  )
  and not exists (
    select 1 from public.clients c where c.user_id = p_uid and c.blocked_at is not null
  );
$$;

revoke execute on function public.client_session_is_active(uuid) from public, anon, authenticated;

-- État de l'espace client du compte connecté, sans rien révéler d'autre : il
-- permet à l'écran de dire « espace suspendu » au lieu d'une page vide.
create or replace function public.my_client_space_state()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when c.user_id is null then 'AUCUN'
           when c.blocked_at is not null then 'BLOQUE'
           else 'ACTIF'
         end
    from (select auth.uid() as uid) me
    left join public.clients c on c.user_id = me.uid;
$$;

revoke execute on function public.my_client_space_state() from public, anon;
grant  execute on function public.my_client_space_state() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. DURCISSEMENT DES POLITIQUES « PROPRIÉTAIRE »
--
-- Chaque politique propriétaire de 4D, 4F, 4G et 4I gagne le prédicat. Les
-- politiques administratives ne changent pas : un compte CLIENT + ADMIN
-- bloqué comme client garde ses lectures d'administration.
-- -----------------------------------------------------------------------------

-- 4F
drop policy if exists quote_requests_select_own on public.quote_requests;
create policy quote_requests_select_own
  on public.quote_requests for select to authenticated
  using (user_id is not null and user_id = auth.uid() and (select public.client_owner_access_ok()));

drop policy if exists quotes_select_own on public.quotes;
create policy quotes_select_own
  on public.quotes for select to authenticated
  using (
    status <> 'BROUILLON'
    and (select public.client_owner_access_ok())
    and exists (
      select 1 from public.quote_requests qr
       where qr.id = quotes.quote_request_id
         and qr.user_id is not null
         and qr.user_id = auth.uid()
    )
  );

drop policy if exists appointments_select_own on public.appointments;
create policy appointments_select_own
  on public.appointments for select to authenticated
  using (user_id is not null and user_id = auth.uid() and (select public.client_owner_access_ok()));

-- 4G
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own
  on public.orders for select to authenticated
  using (user_id = auth.uid() and (select public.client_owner_access_ok()));

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own
  on public.order_items for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (select 1 from public.orders o where o.id = order_items.order_id and o.user_id = auth.uid())
  );

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = auth.uid())
  );

drop policy if exists payment_proofs_select_own on public.payment_proofs;
create policy payment_proofs_select_own
  on public.payment_proofs for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (
      select 1
        from public.payments p
        join public.orders o on o.id = p.order_id
       where p.id = payment_proofs.payment_id
         and o.user_id = auth.uid()
    )
  );

drop policy if exists refunds_select_own on public.refunds;
create policy refunds_select_own
  on public.refunds for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
  );

drop policy if exists osh_select_own on public.order_status_history;
create policy osh_select_own
  on public.order_status_history for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (select 1 from public.orders o where o.id = order_status_history.order_id and o.user_id = auth.uid())
  );

drop policy if exists order_events_select_own on public.order_events;
create policy order_events_select_own
  on public.order_events for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (select 1 from public.orders o where o.id = order_events.order_id and o.user_id = auth.uid())
  );

-- 4G — justificatifs (bucket privé)
drop policy if exists justificatifs_read on storage.objects;
create policy justificatifs_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'paiements-justificatifs'
    and (
      public.can_view_paiements()
      or (
        (select public.client_owner_access_ok())
        and exists (
          select 1 from public.orders o
           where o.id::text = (storage.foldername(name))[1]
             and o.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists justificatifs_insert on storage.objects;
create policy justificatifs_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'paiements-justificatifs'
    and (
      public.has_permission('payments.verify')
      or (
        (select public.client_owner_access_ok())
        and exists (
          select 1 from public.orders o
           where o.id::text = (storage.foldername(name))[1]
             and o.user_id = auth.uid()
             and o.status <> 'ANNULEE'
        )
      )
    )
  );

-- 4D / 4G — pièces, instantanés, archives
drop policy if exists documents_select_owner_or_authorised on public.documents;
create policy documents_select_owner_or_authorised
  on public.documents for select to authenticated
  using (
    (owner_id is not null and owner_id = auth.uid() and public.document_owner_access_ok(doc_type))
    or public.can_read_document_type(doc_type)
  );

drop policy if exists document_snapshots_select on public.document_snapshots;
create policy document_snapshots_select
  on public.document_snapshots for select to authenticated
  using (
    exists (
      select 1
        from public.documents d
       where d.id = document_snapshots.document_id
         and (
           (d.owner_id is not null and d.owner_id = auth.uid() and public.document_owner_access_ok(d.doc_type))
           or public.can_read_document_type(d.doc_type)
         )
    )
  );

drop policy if exists documents_officiels_read on storage.objects;
create policy documents_officiels_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents-officiels'
    and exists (
      select 1
        from public.documents d
       where d.id::text = split_part(storage.filename(name), '.', 1)
         and d.doc_type = (storage.foldername(name))[1]
         and (
           (d.owner_id is not null and d.owner_id = auth.uid() and public.document_owner_access_ok(d.doc_type))
           or public.can_read_document_type(d.doc_type)
         )
    )
  );

-- 4I
drop policy if exists clients_select_own_or_authorised on public.clients;
create policy clients_select_own_or_authorised
  on public.clients for select to authenticated
  using ((user_id = auth.uid() and (select public.client_owner_access_ok())) or public.has_permission('users.view'));


-- -----------------------------------------------------------------------------
-- 5. ÉCRITURES DU PROPRIÉTAIRE BLOQUÉ
--
-- `declare_payment` et `attach_payment_proof` (4G) acceptent le titulaire de
-- la commande : un compte suspendu ou un client bloqué ne doit plus rien y
-- déposer. Plutôt que de réécrire ces fonctions validées, un déclencheur
-- refuse l'insertion quand elle vient du titulaire sans accès propriétaire.
-- Le chemin administratif (payments.verify) reste ouvert.
-- -----------------------------------------------------------------------------

create or replace function public.tg_commerce_owner_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  if auth.uid() is null or public.has_permission('payments.verify') then
    return new;
  end if;
  if tg_table_name = 'payments' then
    v_order := new.order_id;
  else
    select p.order_id into v_order from public.payments p where p.id = new.payment_id;
  end if;
  if exists (select 1 from public.orders o where o.id = v_order and o.user_id = auth.uid())
     and not public.client_owner_access_ok() then
    raise exception 'Ce compte ne peut plus agir sur ses commandes.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_owner_write_guard on public.payments;
create trigger payments_owner_write_guard
  before insert on public.payments
  for each row execute function public.tg_commerce_owner_write_guard();

drop trigger if exists payment_proofs_owner_write_guard on public.payment_proofs;
create trigger payment_proofs_owner_write_guard
  before insert on public.payment_proofs
  for each row execute function public.tg_commerce_owner_write_guard();


-- -----------------------------------------------------------------------------
-- 6. LE PROFIL ÉCRIT PAR LE CLIENT : AUSSI REFUSÉ AU CLIENT BLOQUÉ
--
-- Reprise exacte de `update_my_client_profile` (20261002120000), une
-- condition en plus.
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
  if v_before.blocked_at is not null then
    raise exception 'Votre espace client est suspendu.' using errcode = '42501';
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


-- -----------------------------------------------------------------------------
-- 7. BLOCAGE ET DÉBLOCAGE
-- -----------------------------------------------------------------------------

create or replace function public.block_client(p_user_id uuid, p_reason text)
returns public.clients
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_client  public.clients%rowtype;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_profile public.profiles%rowtype;
  v_only    boolean;
begin
  if not public.has_permission('users.disable') then
    raise exception 'Permission users.disable requise.' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Motif obligatoire (3 à 500 caractères).' using errcode = 'check_violation';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas bloquer votre propre compte.' using errcode = 'check_violation';
  end if;

  select * into v_client from public.clients where user_id = p_user_id for update;
  if not found then
    raise exception 'Client introuvable.' using errcode = 'no_data_found';
  end if;
  if v_client.blocked_at is not null then
    raise exception 'Ce client est déjà bloqué.' using errcode = 'check_violation';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  -- Le profil n'est suspendu que si le compte n'a pas d'autre rôle que CLIENT.
  v_only := not exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = p_user_id and r.code <> 'CLIENT'
  );

  update public.clients
     set blocked_at = now(), blocked_by = auth.uid(), block_reason = v_reason,
         profile_suspended_by_block = (v_only and v_profile.status = 'ACTIF')
   where user_id = p_user_id
  returning * into v_client;

  if v_client.profile_suspended_by_block then
    update public.profiles set status = 'SUSPENDU' where id = p_user_id;
  end if;

  insert into public.client_status_events (client_user_id, kind, reason, profile_suspended, actor_id, actor_label)
  values (p_user_id, 'BLOCAGE', v_reason, v_client.profile_suspended_by_block, auth.uid(), public.relation_actor_label());

  perform public.record_audit_event(
    'clients.blocage', 'client', v_client.reference, 'SUCCES',
    jsonb_build_object('motif', v_reason, 'profil_suspendu', v_client.profile_suspended_by_block)
  );
  return v_client;
end;
$fn$;

comment on function public.block_client(uuid, text) is
  'Bloque un client (users.disable, motif obligatoire). Ferme son espace et ses accès propriétaire ; suspend le profil seulement s''il n''a pas d''autre rôle. Ne supprime rien. Journalisé.';

revoke execute on function public.block_client(uuid, text) from public, anon;
grant  execute on function public.block_client(uuid, text) to authenticated, service_role;


create or replace function public.unblock_client(p_user_id uuid, p_reason text)
returns public.clients
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_client  public.clients%rowtype;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_revived boolean;
begin
  if not public.has_permission('users.disable') then
    raise exception 'Permission users.disable requise.' using errcode = '42501';
  end if;
  if v_reason is not null and (length(v_reason) < 3 or length(v_reason) > 500) then
    raise exception 'Le motif compte 3 à 500 caractères.' using errcode = 'check_violation';
  end if;

  select * into v_client from public.clients where user_id = p_user_id for update;
  if not found then
    raise exception 'Client introuvable.' using errcode = 'no_data_found';
  end if;
  if v_client.blocked_at is null then
    raise exception 'Ce client n''est pas bloqué.' using errcode = 'check_violation';
  end if;

  v_revived := v_client.profile_suspended_by_block;
  if v_revived then
    update public.profiles set status = 'ACTIF' where id = p_user_id and status = 'SUSPENDU';
  end if;

  update public.clients
     set blocked_at = null, blocked_by = null, block_reason = null, profile_suspended_by_block = false
   where user_id = p_user_id
  returning * into v_client;

  insert into public.client_status_events (client_user_id, kind, reason, profile_suspended, actor_id, actor_label)
  values (p_user_id, 'DEBLOCAGE', v_reason, v_revived, auth.uid(), public.relation_actor_label());

  perform public.record_audit_event(
    'clients.deblocage', 'client', v_client.reference, 'SUCCES',
    jsonb_build_object('motif', v_reason, 'profil_reactive', v_revived)
  );
  return v_client;
end;
$fn$;

comment on function public.unblock_client(uuid, text) is
  'Débloque un client (users.disable). Réactive le profil seulement si le blocage l''avait suspendu. Journalisé.';

revoke execute on function public.unblock_client(uuid, text) from public, anon;
grant  execute on function public.unblock_client(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. NOTES INTERNES : AJOUT
-- -----------------------------------------------------------------------------

create or replace function public.add_client_note(p_user_id uuid, p_body text, p_corrects uuid default null)
returns public.client_notes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_note public.client_notes%rowtype;
  v_ref  text;
begin
  if not public.has_permission('users.update') then
    raise exception 'Permission users.update requise.' using errcode = '42501';
  end if;
  if v_body is null or length(v_body) > 4000 then
    raise exception 'La note est vide ou dépasse 4 000 caractères.' using errcode = 'check_violation';
  end if;
  select reference into v_ref from public.clients where user_id = p_user_id;
  if v_ref is null then
    raise exception 'Client introuvable.' using errcode = 'no_data_found';
  end if;
  if p_corrects is not null and not exists (
    select 1 from public.client_notes where id = p_corrects and client_user_id = p_user_id
  ) then
    raise exception 'La note corrigée n''appartient pas à ce client.' using errcode = 'check_violation';
  end if;

  insert into public.client_notes (client_user_id, body, corrects_note_id, author_id, author_label)
  values (p_user_id, v_body, p_corrects, auth.uid(), public.relation_actor_label())
  returning * into v_note;

  perform public.record_audit_event(
    'clients.note', 'client', v_ref, 'SUCCES',
    jsonb_build_object('note', v_note.id, 'correction_de', p_corrects)
  );
  return v_note;
end;
$fn$;

revoke execute on function public.add_client_note(uuid, text, uuid) from public, anon;
grant  execute on function public.add_client_note(uuid, text, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 9. LECTURES ADMINISTRATIVES
--
-- L'adresse e-mail vit dans `auth.users`, hors de portée de PostgREST : la
-- liste et la fiche passent par deux fonctions sous users.view. La liste est
-- paginée côté serveur.
-- -----------------------------------------------------------------------------

create or replace function public.admin_list_clients(
  p_search     text default null,
  p_state      text default null,
  p_preference text default null,
  p_sort       text default 'recent',
  p_limit      integer default 25,
  p_offset     integer default 0
)
returns table (
  user_id uuid, reference text, full_name text, email text, phone text, whatsapp text,
  contact_preference text, profile_status text, blocked boolean, created_at timestamptz,
  last_login_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
begin
  if not public.has_permission('users.view') then
    raise exception 'Permission users.view requise.' using errcode = '42501';
  end if;

  return query
    with base as (
      select c.user_id, c.reference, p.full_name, lower(u.email) as email, p.phone, c.whatsapp,
             c.contact_preference, p.status as profile_status, (c.blocked_at is not null) as blocked,
             c.created_at, p.last_login_at
        from public.clients c
        join public.profiles p on p.id = c.user_id
        join auth.users u on u.id = c.user_id
       where (v_search is null
              or c.reference ilike '%' || v_search || '%'
              or p.full_name ilike '%' || v_search || '%'
              or u.email ilike '%' || v_search || '%'
              or (length(v_digits) >= 4 and (regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'
                                            or regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
              or exists (select 1 from public.orders o where o.user_id = c.user_id and o.reference ilike '%' || v_search || '%'))
         and (p_state is null or p_state = ''
              or (p_state = 'ACTIF' and c.blocked_at is null and p.status = 'ACTIF')
              or (p_state = 'BLOQUE' and c.blocked_at is not null)
              or (p_state = 'SUSPENDU' and p.status <> 'ACTIF'))
         and (p_preference is null or p_preference = '' or c.contact_preference = p_preference)
    )
    select b.*, count(*) over () as total_count
      from base b
     order by
       case when p_sort = 'nom' then lower(coalesce(b.full_name, b.email)) end asc nulls last,
       case when p_sort = 'reference' then b.reference end asc,
       case when p_sort = 'ancien' then b.created_at end asc,
       b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.admin_list_clients(text, text, text, text, integer, integer) is
  'Liste paginée des comptes CLIENT (users.view) : recherche par référence, nom, e-mail, téléphone / WhatsApp, référence de commande ; filtres d''état et de préférence.';

revoke execute on function public.admin_list_clients(text, text, text, text, integer, integer) from public, anon;
grant  execute on function public.admin_list_clients(text, text, text, text, integer, integer) to authenticated, service_role;


create or replace function public.admin_client_identity(p_user_id uuid)
returns table (email text, email_confirmed boolean, roles text[], last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('users.view') then
    raise exception 'Permission users.view requise.' using errcode = '42501';
  end if;
  return query
    select lower(u.email), u.email_confirmed_at is not null,
           coalesce((select array_agg(r.code order by r.code) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = u.id), '{}'),
           u.last_sign_in_at
      from auth.users u
     where u.id = p_user_id
       and exists (select 1 from public.clients c where c.user_id = u.id);
end;
$$;

revoke execute on function public.admin_client_identity(uuid) from public, anon;
grant  execute on function public.admin_client_identity(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10. RATTACHEMENT HISTORIQUE : CHAQUE TYPE SOUS SA PERMISSION 4F
--
-- Reprises exactes de 20261002130000 ; seule la vérification des permissions
-- change : une demande relève de quotes.view / quotes.manage, un rendez-vous
-- de appointments.view / appointments.update. Aucun second moteur.
-- -----------------------------------------------------------------------------

create or replace function public.historical_claimable_requests()
returns table (item_kind text, item_id uuid, reference text, subject text, created_at timestamptz,
               client_user_id uuid, client_reference text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- 4I-4 : chaque type d'élément sous sa propre permission 4F — les demandes
  -- sous quotes.view, les rendez-vous sous appointments.view.
  if not public.has_permission('users.view')
     or not (public.has_permission('quotes.view') or public.has_permission('appointments.view')) then
    raise exception 'Permissions requises : users.view, et quotes.view ou appointments.view.' using errcode = '42501';
  end if;

  return query
    with accounts as (
      select u.id as uid, lower(btrim(u.email)) as email
        from auth.users u
       where u.email is not null and u.email_confirmed_at is not null
         and public.client_confirmed_email(u.id) is not null
    )
    select 'DEMANDE'::text, qr.id, qr.reference, coalesce(qr.offer_title, qr.subject), qr.created_at, a.uid, c.reference
      from public.quote_requests qr
      join public.leads l on l.id = qr.lead_id
      join accounts a on a.email = l.email
      left join public.clients c on c.user_id = a.uid
     where qr.user_id is null and (l.user_id is null or l.user_id = a.uid)
       and qr.created_at < public.relation_claim_since()
       and public.has_permission('quotes.view')
    union all
    select 'RENDEZ_VOUS'::text, ap.id, ap.reference, ap.subject, ap.created_at, a.uid, c.reference
      from public.appointments ap
      join public.leads l on l.id = ap.lead_id
      join accounts a on a.email = l.email
      left join public.clients c on c.user_id = a.uid
     where ap.user_id is null and (l.user_id is null or l.user_id = a.uid)
       and ap.created_at < public.relation_claim_since()
       and public.has_permission('appointments.view')
     order by 5;
end;
$$;

create or replace function public.attach_historical_request(p_kind text, p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lead    public.leads%rowtype;
  v_lead_id uuid;
  v_ref     text;
  v_uid     uuid;
begin
  -- 4I-4 : la permission métier suit le type d'élément (4F) — quotes.manage
  -- pour une demande, appointments.update pour un rendez-vous.
  if not public.has_permission('users.update')
     or (p_kind = 'DEMANDE' and not public.has_permission('quotes.manage'))
     or (p_kind = 'RENDEZ_VOUS' and not public.has_permission('appointments.update')) then
    raise exception 'Permissions requises : users.update, et quotes.manage (demande) ou appointments.update (rendez-vous).'
      using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Motif obligatoire (500 caractères au plus).' using errcode = 'check_violation';
  end if;

  if p_kind = 'DEMANDE' then
    select lead_id, reference into v_lead_id, v_ref from public.quote_requests where id = p_item_id and user_id is null for update;
  elsif p_kind = 'RENDEZ_VOUS' then
    select lead_id, coalesce(reference, id::text) into v_lead_id, v_ref from public.appointments where id = p_item_id and user_id is null for update;
  else
    raise exception 'Type inconnu.' using errcode = 'check_violation';
  end if;
  if v_lead_id is null then
    raise exception 'Élément introuvable ou déjà rattaché.' using errcode = 'no_data_found';
  end if;

  select * into v_lead from public.leads where id = v_lead_id for update;
  select u.id into v_uid from auth.users u
   where lower(btrim(u.email)) = v_lead.email and public.client_confirmed_email(u.id) is not null;
  if v_uid is null then
    raise exception 'Aucun compte client actif à adresse confirmée ne correspond exactement.' using errcode = 'check_violation';
  end if;
  if v_lead.user_id is not null and v_lead.user_id <> v_uid then
    raise exception 'Conflit : le prospect est déjà rattaché à un autre compte.' using errcode = 'check_violation';
  end if;

  if p_kind = 'DEMANDE' then
    update public.quote_requests set user_id = v_uid where id = p_item_id;
  else
    update public.appointments set user_id = v_uid where id = p_item_id;
  end if;
  if v_lead.user_id is null then
    update public.leads set user_id = v_uid where id = v_lead.id;
  end if;

  perform public.record_audit_event(
    'relation.rattachement_historique', 'client', coalesce((select reference from public.clients where user_id = v_uid), v_uid::text), 'SUCCES',
    jsonb_build_object('element', v_ref, 'type', p_kind, 'motif', v_reason, 'regle', 'adresse_confirmee')
  );
  return jsonb_build_object('element', v_ref, 'compte', v_uid);
end;
$$;
