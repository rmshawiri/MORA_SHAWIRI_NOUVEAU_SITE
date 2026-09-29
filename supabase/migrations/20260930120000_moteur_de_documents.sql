-- =============================================================================
-- MORA SHAWIRI — Migration 0005
-- Moteur de Documents : la source unique de numérotation officielle.
--
-- Références :
--   00_PROMPT_MAITRE/PROMPT_MAITRE_CLAUDE_CODE.md § 35-43, § 74-77
--   07_ARCHITECTURE_TECHNIQUE/05_STOCKAGE.md      § 128-131, § 152, § 184-185
--   07_ARCHITECTURE_TECHNIQUE/01_ARCHITECTURE_BASE_DE_DONNEES.md § 231
--   04 - Analyse et plan de développement.md      § 4.8, § 8 (domaine SYSTÈME), phase 4D
--
-- -----------------------------------------------------------------------------
-- DÉCISION D-2 — pourquoi cette migration ressemble à ceci
-- -----------------------------------------------------------------------------
--
-- Trois conventions de numérotation coexistaient dans les documents de
-- référence. Une seule est normative — MORA-[TYPE]-[SÉRIE][NUMÉRO], posée par
-- le § 37 du prompt maître, qui s'interdit lui-même d'être remplacé « sans
-- décision explicite ». Les deux autres se qualifient elles-mêmes d'exemples :
-- 05_FONCTIONNALITES/00 § 41 écrit « exemple de format possible » et « le
-- format exact peut être défini techniquement » ; 09_ADMINISTRATION/02 § 5 et
-- /05 § 7-8 écrivent « exemple ».
--
-- Le propriétaire a tranché le 30 septembre 2026, avant la première ligne de
-- code de cette phase :
--
--   * le format officiel s'applique à TOUT, y compris la référence visible
--     d'une commande et d'une commission — il n'existe donc qu'un seul
--     allocateur, celui-ci ;
--   * la référence ne porte PAS l'année : le millésime vit dans issued_at,
--     qui est indexable et filtrable ;
--   * un compteur par type, JAMAIS réinitialisé — la série alphabétique du
--     § 38 gère déjà le débordement (A9999 -> B0001 -> … -> Z9999 -> AA0001) ;
--   * chaque pièce porte son propre numéro : une commande, son acompte, sa
--     facture et son avoir éventuel reçoivent quatre identifiants distincts,
--     reliés en base. Aucun numéro dérivé, aucun suffixe.
--
-- L'identifiant interne exigé par 09_ADMINISTRATION/02 § 6 — « ne doit pas
-- dépendre uniquement de la référence commerciale » — reste l'UUID de la ligne.
--
-- -----------------------------------------------------------------------------
-- LA RÈGLE ABSOLUE, TRADUITE EN PRIVILÈGES
-- -----------------------------------------------------------------------------
--
-- Le § 36 dit : « Aucun module ne doit générer directement son propre numéro de
-- document. » Une règle écrite dans un document ne s'applique pas toute seule ;
-- celle-ci est donc traduite en privilèges Postgres :
--
--   * public.documents n'accorde AUCUN droit d'écriture au rôle authenticated.
--     Pas d'INSERT, pas d'UPDATE, pas de DELETE, et aucune politique RLS ne les
--     autoriserait de toute façon.
--   * public.document_sequences n'accorde rien du tout, à personne : ni
--     lecture, ni écriture, et RLS activée sans politique. Le compteur n'est
--     touché que par la fonction d'allocation.
--   * public.allocate_document_number() n'est exécutable que par service_role.
--     Un compte connecté ne peut donc pas brûler des numéros.
--
-- Le seul chemin ouvert est public.issue_document(), qui alloue et enregistre
-- dans la même transaction. Un module qui voudrait inventer sa numérotation se
-- heurterait à un refus de la base, pas à une relecture.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LES TYPES DOCUMENTAIRES
--
-- Le § 75 est formel : « Les codes documentaires supplémentaires doivent être
-- définis dans la nomenclature officielle avant leur implémentation. » Une
-- table plutôt qu'une contrainte d'énumération, pour deux raisons : ajouter un
-- type devient un acte explicite et daté, et chaque type peut déclarer la
-- permission qui gouverne sa lecture et son émission.
--
-- Ces permissions sont prises dans le catalogue des 64 figé en phase 4A. Aucune
-- permission documents.* n'est inventée : le Moteur de Documents est un service
-- transverse, pas un module d'administration, et un document se lit avec le
-- droit du domaine métier auquel il appartient. Une facture se consulte avec
-- orders.view, un relevé de commission avec commissions.view. C'est exactement
-- l'enchaînement du § 185 du stockage : administrateur -> authentification ->
-- permission -> accès.
-- -----------------------------------------------------------------------------

create table if not exists public.document_types (
  code              text primary key,
  label             text not null,
  -- Domaine métier auquel le document se rattache. Sert à choisir la
  -- permission et à relier le document à son entité.
  entity_type       text not null,
  -- Permission d'administration donnant accès en lecture à TOUS les documents
  -- de ce type. Le propriétaire du document, lui, n'en a pas besoin (§ 184).
  view_permission   text not null references public.permissions (code) on update cascade,
  -- Permission exigée d'une session applicative pour émettre ce type.
  issue_permission  text not null references public.permissions (code) on update cascade,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint document_types_code_format check (code ~ '^[A-Z]{4,6}$')
);

comment on table public.document_types is
  'Codes documentaires officiels (prompt maître § 75). Ajouter un type est un acte explicite : aucun module ne peut en inventer un.';
comment on column public.document_types.view_permission is
  'Permission d''administration ouvrant la lecture de tous les documents de ce type. Le propriétaire lit les siens sans permission (§ 184).';

drop trigger if exists document_types_set_updated_at on public.document_types;
create trigger document_types_set_updated_at
  before update on public.document_types
  for each row execute function public.set_updated_at();

-- Les sept types nommés par le prompt maître § 75, et eux seuls.
insert into public.document_types (code, label, entity_type, view_permission, issue_permission, sort_order)
values
  ('DVCL',  'Devis client',                 'quote',      'quotes.view',      'quotes.create',       10),
  ('CMCL',  'Commande client',              'order',      'orders.view',      'orders.update',       20),
  ('ACCL',  'Acompte client',               'payment',    'payments.view',    'payments.verify',     30),
  ('BLCL',  'Bon de livraison client',      'order',      'orders.view',      'orders.update',       40),
  ('FACL',  'Facture client',               'order',      'orders.view',      'orders.update',       50),
  ('AVCL',  'Avoir client',                 'order',      'orders.view',      'orders.refund',       60),
  ('COMAF', 'Relevé de commission affilié', 'commission', 'commissions.view', 'commissions.manage',  70)
on conflict (code) do update
  set label            = excluded.label,
      entity_type      = excluded.entity_type,
      view_permission  = excluded.view_permission,
      issue_permission = excluded.issue_permission,
      sort_order       = excluded.sort_order,
      updated_at       = now();


-- -----------------------------------------------------------------------------
-- 2. LE COMPTEUR TRANSACTIONNEL
--
-- Une ligne par type. series et last_number décrivent le dernier identifiant
-- réellement attribué — pas le prochain : ce que la base a écrit est un fait,
-- ce qu'elle écrira est une intention, et confondre les deux est la manière
-- habituelle de produire un doublon après un incident.
--
-- Le plan § 8 l'exige en toutes lettres : « L'allocation doit passer par une
-- fonction Postgres avec verrou, jamais par un calcul applicatif. »
-- -----------------------------------------------------------------------------

create table if not exists public.document_sequences (
  doc_type        text primary key references public.document_types (code) on delete restrict,
  series          text not null default 'A',
  last_number     integer not null default 0,
  -- Total historique, séries confondues. Sert au contrôle : il doit toujours
  -- égaler le nombre de documents du type.
  allocated_count bigint not null default 0,
  updated_at      timestamptz not null default now(),
  constraint document_sequences_series_format check (series ~ '^[A-Z]+$'),
  constraint document_sequences_number_range check (last_number between 0 and 9999)
);

comment on table public.document_sequences is
  'Compteur transactionnel par type documentaire. Décrit le DERNIER identifiant attribué. Aucun rôle applicatif n''y accède : seule la fonction d''allocation l''écrit.';

alter table public.document_sequences enable row level security;
-- Aucune politique, volontairement : RLS activée sans politique vaut refus
-- total, ce qui est exactement l'intention. Le compteur n'est ni lisible ni
-- modifiable depuis une session.


-- -----------------------------------------------------------------------------
-- 3. LES DOCUMENTS ÉMIS
--
-- Un enregistrement par document officiel. reference est l'identifiant stable
-- du § 39 ; il ne bouge jamais, quoi qu'il arrive au nom du client.
--
-- subject_name est un instantané du nom au moment de l'émission. Le § 39 le
-- cantonne à la lisibilité du fichier, et le § 77 interdit qu'il serve de clé.
-- Il est conservé pour qu'une facture de 2026 garde le nom porté en 2026, même
-- si le client se fait appeler autrement ensuite — mais il n'entre dans aucune
-- contrainte d'unicité, et le changer n'altère rien.
-- -----------------------------------------------------------------------------

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  doc_type     text not null references public.document_types (code) on delete restrict,
  series       text not null,
  number       integer not null,
  -- Entité métier associée (§ 35 : « association à une entité métier »).
  -- Nullable tant que les tables commerciales n'existent pas : elles arrivent
  -- en phases 4F à 4H. Aucune clé étrangère ne peut donc encore être posée,
  -- et en poser une vers une table absente ferait échouer cette migration.
  entity_type  text not null,
  entity_id    uuid,
  -- Destinataire du document : c'est lui qui le lit sans permission (§ 184).
  owner_id     uuid references auth.users (id) on delete set null,
  subject_name text,
  status       text not null default 'EMIS'
               check (status in ('EMIS', 'ANNULE', 'REMPLACE')),
  version      integer not null default 1 check (version >= 1),
  -- Versionnage du § 152 : un document qui en remplace un autre le désigne.
  replaces_id  uuid references public.documents (id) on delete set null,
  -- Chemin d'archivage. Nul tant que le document est rendu à la demande ;
  -- l'archivage sur Storage relève de la phase 4E, qui ouvre les buckets.
  storage_path text,
  metadata     jsonb not null default '{}'::jsonb,
  issued_at    timestamptz not null default now(),
  issued_by    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint documents_series_format check (series ~ '^[A-Z]+$'),
  constraint documents_number_range check (number between 1 and 9999),
  constraint documents_reference_format check (reference ~ '^MORA-[A-Z]{4,6}-[A-Z]+[0-9]{4}$'),
  constraint documents_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint documents_subject_length check (subject_name is null or length(subject_name) <= 200),
  -- La vraie garantie du § 38 : deux documents du même type ne peuvent pas
  -- porter le même couple série/numéro, quelle que soit la façon dont la ligne
  -- est arrivée là. L'unicité ne repose pas sur la bonne conduite du code.
  constraint documents_type_series_number_unique unique (doc_type, series, number)
);

comment on table public.documents is
  'Documents officiels émis par le Moteur de Documents. La référence est stable et immuable (prompt maître § 39-40).';
comment on column public.documents.reference is
  'Identifiant officiel MORA-[TYPE]-[SÉRIE][NUMÉRO] (décision D-2). Immuable après émission.';
comment on column public.documents.subject_name is
  'Instantané du nom du client ou de l''affilié à l''émission. Sert au nom de fichier, jamais de clé (§ 77).';

create index if not exists documents_owner_idx on public.documents (owner_id);
create index if not exists documents_entity_idx on public.documents (entity_type, entity_id);
create index if not exists documents_type_issued_idx on public.documents (doc_type, issued_at desc);
-- Le millésime ne figure pas dans la référence (D-2) : c'est cet index qui rend
-- « les factures de 2026 » aussi rapide qu'un préfixe d'année l'aurait été,
-- sans dupliquer l'information.
create index if not exists documents_issued_at_idx on public.documents (issued_at desc);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. LA SÉRIE
--
-- Progression du § 38 : A -> B -> … -> Z -> AA -> AB -> … -> AZ -> BA -> … ->
-- ZZ -> AAA. C'est l'incrément des colonnes d'un tableur, et c'est exactement
-- ce que les exemples du prompt maître décrivent.
-- -----------------------------------------------------------------------------

create or replace function public.document_next_series(p_series text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_chars text := upper(coalesce(nullif(trim(p_series), ''), 'A'));
  v_index integer;
  v_code  integer;
  v_carry boolean := true;
begin
  if v_chars !~ '^[A-Z]+$' then
    raise exception 'Série invalide : %', p_series using errcode = 'check_violation';
  end if;

  v_index := length(v_chars);

  while v_carry and v_index >= 1 loop
    v_code := ascii(substr(v_chars, v_index, 1));

    if v_code < ascii('Z') then
      v_chars := overlay(v_chars placing chr(v_code + 1) from v_index for 1);
      v_carry := false;
    else
      -- Z devient A et la retenue passe au caractère de gauche.
      v_chars := overlay(v_chars placing 'A' from v_index for 1);
      v_index := v_index - 1;
    end if;
  end loop;

  -- Retenue sortie par la gauche : la série gagne un caractère (Z -> AA).
  if v_carry then
    v_chars := 'A' || v_chars;
  end if;

  return v_chars;
end;
$$;

comment on function public.document_next_series(text) is
  'Série suivante selon le prompt maître § 38 : A->B->…->Z->AA->AB->…->ZZ->AAA.';

revoke execute on function public.document_next_series(text) from public, anon;
grant  execute on function public.document_next_series(text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. L'ALLOCATION
--
-- Le cœur du § 38 : « Deux documents du même type ne doivent jamais recevoir le
-- même identifiant. »
--
-- insert … on conflict do update … returning fait le travail en UNE seule
-- instruction. Postgres pose un verrou de ligne sur la séquence du type le
-- temps de la mise à jour : deux allocations simultanées du même type
-- s'attendent, et la seconde lit la valeur écrite par la première. Il n'existe
-- aucun intervalle entre la lecture et l'écriture où un doublon pourrait se
-- glisser — c'est précisément ce qu'un select max(...) + 1 applicatif ne peut
-- pas garantir.
--
-- Le case porte sur la valeur ANCIENNE de la ligne (ds.… dans un
-- on conflict do update désigne toujours l'existant), et returning rend la
-- valeur NOUVELLE : celle qui vient d'être attribuée.
-- -----------------------------------------------------------------------------

create or replace function public.allocate_document_number(p_type text)
returns table (reference text, series text, number integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_series text;
  v_number integer;
begin
  if not exists (
    select 1 from public.document_types dt
    where dt.code = p_type and dt.is_active
  ) then
    raise exception 'Type de document inconnu ou inactif : %', coalesce(p_type, '(nul)')
      using errcode = 'check_violation';
  end if;

  insert into public.document_sequences as ds (doc_type, series, last_number, allocated_count)
  values (p_type, 'A', 1, 1)
  on conflict (doc_type) do update
    set last_number = case
          when ds.last_number >= 9999 then 1
          else ds.last_number + 1
        end,
        series = case
          when ds.last_number >= 9999 then public.document_next_series(ds.series)
          else ds.series
        end,
        allocated_count = ds.allocated_count + 1,
        updated_at = now()
  returning ds.series, ds.last_number
  into v_series, v_number;

  return query
    select
      'MORA-' || p_type || '-' || v_series || lpad(v_number::text, 4, '0'),
      v_series,
      v_number;
end;
$$;

comment on function public.allocate_document_number(text) is
  'Alloue le prochain identifiant officiel d''un type, sous verrou de ligne. Seul chemin d''attribution d''un numéro (prompt maître § 36).';

-- Réservée au serveur. Un compte connecté qui pourrait l'appeler consommerait
-- des numéros sans émettre de document — des trous dans une suite comptable.
revoke execute on function public.allocate_document_number(text) from public, anon, authenticated;
grant  execute on function public.allocate_document_number(text) to service_role;


-- -----------------------------------------------------------------------------
-- 6. L'ÉMISSION
--
-- Le seul chemin ouvert vers public.documents. Alloue et enregistre dans la
-- même transaction : si l'enregistrement échoue, le numéro n'est pas consommé.
--
-- Deux façons d'y arriver, et une seule règle pour chacune :
--
--   * depuis une session applicative (auth.uid() non nul) — il faut la
--     permission d'émission du type ET un second facteur vérifié, comme pour
--     toute écriture sensible depuis la phase 4C ;
--   * depuis le serveur avec la clé à privilèges (auth.uid() nul) — c'est le
--     cas d'un document émis par un flux métier automatique, par exemple une
--     facture produite à la validation d'un paiement. Le contrôle a déjà eu
--     lieu en amont, dans l'action qui a déclenché le flux.
-- -----------------------------------------------------------------------------

create or replace function public.issue_document(
  p_type         text,
  p_entity_type  text default null,
  p_entity_id    uuid default null,
  p_owner_id     uuid default null,
  p_subject_name text default null,
  p_metadata     jsonb default '{}'::jsonb,
  p_replaces     uuid default null
)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_type      public.document_types%rowtype;
  v_reference text;
  v_series    text;
  v_number    integer;
  v_caller    uuid := auth.uid();
  v_document  public.documents%rowtype;
begin
  select * into v_type from public.document_types where code = p_type;

  if not found or not v_type.is_active then
    raise exception 'Type de document inconnu ou inactif : %', coalesce(p_type, '(nul)')
      using errcode = 'check_violation';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Les métadonnées documentaires doivent être un objet JSON.'
      using errcode = 'check_violation';
  end if;

  if v_caller is not null then
    if not public.has_permission(v_type.issue_permission) then
      raise exception 'Permission % requise pour émettre un document %.',
        v_type.issue_permission, p_type
        using errcode = 'insufficient_privilege';
    end if;

    if not public.session_is_aal2() then
      raise exception 'Second facteur requis pour émettre un document.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select a.reference, a.series, a.number
    into v_reference, v_series, v_number
    from public.allocate_document_number(p_type) a;

  insert into public.documents (
    reference, doc_type, series, number,
    entity_type, entity_id, owner_id, subject_name,
    version, replaces_id, metadata, issued_by
  )
  values (
    v_reference, v_type.code, v_series, v_number,
    coalesce(p_entity_type, v_type.entity_type), p_entity_id, p_owner_id, p_subject_name,
    case when p_replaces is null then 1
         else coalesce((select d.version + 1 from public.documents d where d.id = p_replaces), 1)
    end,
    p_replaces,
    coalesce(p_metadata, '{}'::jsonb),
    v_caller
  )
  returning * into v_document;

  -- Le document remplacé change d'état, il ne disparaît pas (§ 152).
  if p_replaces is not null then
    update public.documents
       set status = 'REMPLACE'
     where id = p_replaces and status = 'EMIS';
  end if;

  perform public.record_audit_event(
    'documents.emission',
    'document',
    v_document.reference,
    'SUCCES',
    jsonb_build_object('type', v_type.code, 'serie', v_series, 'numero', v_number)
  );

  return v_document;
end;
$$;

comment on function public.issue_document(text, text, uuid, uuid, text, jsonb, uuid) is
  'Émet un document officiel : alloue l''identifiant et enregistre la pièce dans la même transaction. Seul chemin d''écriture dans public.documents.';

revoke execute on function public.issue_document(text, text, uuid, uuid, text, jsonb, uuid) from public, anon;
grant  execute on function public.issue_document(text, text, uuid, uuid, text, jsonb, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. L'IDENTIFIANT EST IMMUABLE
--
-- Le § 39 : « L'identifiant officiel doit rester stable. » Le § 40 : « Le
-- changement du nom du client ne doit jamais modifier l'identifiant officiel. »
--
-- Ce déclencheur dit les deux d'un coup, en laissant explicitement passer ce
-- qui doit pouvoir changer : le nom du sujet, le destinataire, le statut, le
-- chemin d'archivage et les métadonnées.
-- -----------------------------------------------------------------------------

create or replace function public.tg_documents_immutable_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reference is distinct from old.reference
     or new.doc_type is distinct from old.doc_type
     or new.series is distinct from old.series
     or new.number is distinct from old.number
     or new.issued_at is distinct from old.issued_at then
    raise exception
      'L''identifiant officiel d''un document est immuable (prompt maître § 39-40).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_immutable_identity on public.documents;
create trigger documents_immutable_identity
  before update on public.documents
  for each row execute function public.tg_documents_immutable_identity();


-- Un document émis s'annule, il ne s'efface pas. Effacer une pièce ferait un
-- trou dans une suite comptable, et le § 152 demande de conserver l'historique.
create or replace function public.tg_documents_no_delete_when_issued()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'EMIS' then
    raise exception
      'Un document émis ne se supprime pas : passez son statut à ANNULE (%).', old.reference
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists documents_no_delete_when_issued on public.documents;
create trigger documents_no_delete_when_issued
  before delete on public.documents
  for each row execute function public.tg_documents_no_delete_when_issued();


-- -----------------------------------------------------------------------------
-- 8. QUI LIT QUOI
--
-- Les deux règles du stockage, § 184 et § 185, telles quelles :
--
--   document client        -> authentification -> propriété  -> téléchargement
--   document administratif -> authentification -> permission -> accès
--
-- Aucune politique d'écriture n'existe, et aucun privilège d'écriture n'est
-- accordé. C'est le § 36 rendu opposable.
-- -----------------------------------------------------------------------------

create or replace function public.can_read_document_type(p_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.document_types dt
    where dt.code = p_type
      and public.has_permission(dt.view_permission)
  );
$$;

comment on function public.can_read_document_type(text) is
  'Vrai si la session détient la permission d''administration gouvernant ce type de document (§ 185 du stockage).';

revoke execute on function public.can_read_document_type(text) from public, anon;
grant  execute on function public.can_read_document_type(text) to authenticated, service_role;

alter table public.document_types enable row level security;

drop policy if exists document_types_select_authenticated on public.document_types;
create policy document_types_select_authenticated
  on public.document_types for select to authenticated
  using (true);

alter table public.documents enable row level security;

drop policy if exists documents_select_owner_or_authorised on public.documents;
create policy documents_select_owner_or_authorised
  on public.documents for select to authenticated
  using (
    (owner_id is not null and owner_id = auth.uid())
    or public.can_read_document_type(doc_type)
  );


-- -----------------------------------------------------------------------------
-- 9. PRIVILÈGES DE TABLE
--
-- Le rôle anonyme ne reçoit rien : un document officiel n'est jamais public.
-- Le rôle connecté ne reçoit que la lecture — l'écriture passe par
-- issue_document(), et par elle seule.
-- -----------------------------------------------------------------------------

revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;

revoke all on public.document_types from anon, authenticated;
grant select on public.document_types to authenticated;

revoke all on public.document_sequences from anon, authenticated;
