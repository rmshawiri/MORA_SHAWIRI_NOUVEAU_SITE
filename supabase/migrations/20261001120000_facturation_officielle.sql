-- =============================================================================
-- FINALISATION 4G — FACTURATION OFFICIELLE
--
-- Ce que cette migration ajoute, et dans cet ordre :
--
--   1. la permission critique `invoices.issue` ;
--   2. FACL émise sous `invoices.issue`, et non plus sous `orders.update` ;
--   3. l'identité de l'émetteur, versionnée en base ;
--   4. l'instantané documentaire immuable (`document_snapshots`) ;
--   5. une seule facture active par commande, garantie par index ;
--   6. `issue_order_invoice()` réécrite : permission, verrou, instantané ;
--   7. l'enregistrement de l'archive PDF, réservé au serveur ;
--   8. le bucket privé `documents-officiels` et sa politique de lecture.
--
-- ## Décision propriétaire du 1er octobre 2026
--
-- Le rapport 4G (§ 8 et § 16) laissait ouverte la question : l'émission d'une
-- facture devait-elle continuer de relever d'`orders.update` ? Tranché :
-- **non**. `invoices.issue` est une permission distincte et CRITIQUE.
--
--   * orders.update   = gérer une commande selon les règles existantes ;
--   * payments.verify = vérifier officiellement un paiement ;
--   * invoices.issue  = émettre officiellement une facture.
--
-- SUPER_ADMIN la détient par `admin.full_access`. Un ADMIN ne la détient que
-- si elle lui est accordée nominativement (décision D-18 de 4C) ; elle n'entre
-- pas dans le modèle proposé à la création d'un administrateur.
--
-- ## Pourquoi un instantané, et pas seulement les lignes de commande
--
-- Les lignes d'une commande sont des instantanés du catalogue (4G § 7.3),
-- mais elles restent modifiables tant que la commande n'est ni terminée ni
-- annulée (`tg_order_items_closed_order`). Une facture rendue à la demande à
-- partir de ces lignes pourrait donc changer après son émission. C'est
-- interdit : une facture émise est une pièce historique.
--
-- `document_snapshots` fige, dans la transaction même qui alloue le numéro,
-- tout ce que la pièce affiche : émetteur, client, références, lignes,
-- totaux, règlement constaté à la date d'émission. Le PDF se reproduit à
-- partir de cet instantané et de lui seul — jamais du catalogue, jamais de la
-- commande telle qu'elle est devenue.
--
-- Le PDF rendu est en outre archivé dans un bucket privé, avec son empreinte :
-- la pièce téléchargée dans cinq ans est l'octet près celle de l'émission,
-- même si le moteur de rendu a évolué entre-temps.
--
-- ## Ce que cette migration ne fait pas
--
-- Aucune taxe, aucune TVA, aucune mention légale : aucune n'est définie par le
-- projet (D-17 ouverte). Aucune règle comptable nouvelle : les conditions
-- d'émission sont celles de 4G (commande réelle, non annulée, montant
-- positif), complétées d'une seule évidence — une commande sans ligne ne se
-- facture pas. Aucune migration antérieure n'est modifiée ; `issue_document()`
-- n'est pas réécrite.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LA PERMISSION `invoices.issue`
-- -----------------------------------------------------------------------------

insert into public.permissions (code, domain, action, label, is_critical) values
  ('invoices.issue', 'invoices', 'issue', 'Émettre une facture officielle', true)
on conflict (code) do update
  set domain      = excluded.domain,
      action      = excluded.action,
      label       = excluded.label,
      is_critical = excluded.is_critical;

-- Aucune ligne `role_permissions` : depuis la migration 0004, le rôle ADMIN ne
-- porte plus de droits, et SUPER_ADMIN couvre tout par `admin.full_access`.


-- -----------------------------------------------------------------------------
-- 2. FACL S'ÉMET SOUS `invoices.issue`
--
-- `issue_document()` lit la permission d'émission dans `document_types`. En
-- la changeant ici, la règle vaut pour TOUT chemin qui émettrait une FACL
-- depuis une session — pas seulement pour `issue_order_invoice()`. La lecture
-- reste gouvernée par `orders.view` : consulter une facture n'est pas l'émettre.
-- -----------------------------------------------------------------------------

update public.document_types
   set issue_permission = 'invoices.issue',
       updated_at       = now()
 where code = 'FACL';


-- -----------------------------------------------------------------------------
-- 3. L'IDENTITÉ DE L'ÉMETTEUR
--
-- Ce qu'une pièce dit de MORA Shawiri doit être figé avec elle : si le
-- téléphone change en 2027, une facture de 2026 garde celui de 2026. La valeur
-- est donc recopiée dans l'instantané à l'émission, et sa source vit ici —
-- versionnée par migration, comparée à `src/lib/site.ts` par un test.
--
-- Uniquement des informations publiques déjà publiées sur le site. Aucune
-- mention juridique (forme, immatriculation, numéro fiscal) : D-17 ouverte.
-- -----------------------------------------------------------------------------

create or replace function public.document_issuer_identity()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'name',    'MORA Shawiri',
    'slogan',  'Le Choix Optimal pour votre performance',
    'address', 'Moroni — Union des Comores',
    'phone',   '+269 430 63 06',
    'email',   'contact@morashawiri.com'
  );
$fn$;

comment on function public.document_issuer_identity() is
  'Identité publique de l''émetteur, recopiée dans chaque instantané documentaire. Miroir de src/lib/site.ts, comparé par test.';

revoke execute on function public.document_issuer_identity() from public, anon;
grant  execute on function public.document_issuer_identity() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. L'INSTANTANÉ DOCUMENTAIRE
--
-- Une ligne par pièce dont le contenu doit être reproduit. Générique : FACL
-- l'utilise aujourd'hui ; DVCL, BLCL, AVCL, COMAF pourront s'y loger avec leur
-- propre `schema_version` sans nouvelle table.
--
--   content        ce que la pièce affiche, figé à l'émission ;
--   content_sha256 empreinte calculée par la base, jamais reçue ;
--   pdf_*          archive du fichier rendu, posée une fois, puis gelée.
-- -----------------------------------------------------------------------------

create table if not exists public.document_snapshots (
  document_id      uuid primary key references public.documents (id) on delete cascade,
  doc_type         text not null references public.document_types (code) on delete restrict,
  schema_version   integer not null,
  content          jsonb not null,
  content_sha256   text not null,

  pdf_path         text,
  pdf_sha256       text,
  pdf_size         integer,
  renderer_version text,
  archived_at      timestamptz,

  created_at       timestamptz not null default now(),

  constraint document_snapshots_schema_positive check (schema_version >= 1),
  constraint document_snapshots_content_object check (jsonb_typeof(content) = 'object'),
  constraint document_snapshots_content_hash check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- L'archive est entière ou absente : jamais un chemin sans empreinte.
  constraint document_snapshots_archive_whole check (
    (pdf_path is null and pdf_sha256 is null and pdf_size is null
       and renderer_version is null and archived_at is null)
    or
    (pdf_path is not null and pdf_sha256 is not null and pdf_size is not null
       and renderer_version is not null and archived_at is not null)
  ),
  -- `<TYPE>/<uuid du document>.pdf`, construit par le serveur. Aucun nom de
  -- client, aucune référence devinable, aucun `../`.
  constraint document_snapshots_pdf_path_shape check (
    pdf_path is null
    or pdf_path ~ '^[A-Z]{4,6}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  ),
  constraint document_snapshots_pdf_hash check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  constraint document_snapshots_pdf_size check (pdf_size is null or (pdf_size > 0 and pdf_size <= 10485760)),
  constraint document_snapshots_renderer_length check (renderer_version is null or length(renderer_version) <= 40)
);

comment on table public.document_snapshots is
  'Contenu figé d''une pièce officielle à son émission, et archive du PDF rendu. Une pièce se reproduit à partir de cet instantané, jamais des données courantes.';
comment on column public.document_snapshots.content is
  'Ce que la pièce affiche : émetteur, client, références, lignes, totaux. Immuable.';
comment on column public.document_snapshots.pdf_path is
  'Chemin de l''archive dans le bucket privé documents-officiels. Posé une fois par le serveur, puis gelé.';


-- L'empreinte est calculée, pas reçue.
create or replace function public.tg_document_snapshots_hash()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.content_sha256 := encode(sha256(convert_to(new.content::text, 'UTF8')), 'hex');
  return new;
end;
$fn$;

drop trigger if exists document_snapshots_hash on public.document_snapshots;
create trigger document_snapshots_hash
  before insert on public.document_snapshots
  for each row execute function public.tg_document_snapshots_hash();


-- Le contenu est immuable ; l'archive se pose une fois.
create or replace function public.tg_document_snapshots_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.document_id    is distinct from old.document_id
     or new.doc_type       is distinct from old.doc_type
     or new.schema_version is distinct from old.schema_version
     or new.content        is distinct from old.content
     or new.content_sha256 is distinct from old.content_sha256
     or new.created_at     is distinct from old.created_at then
    raise exception 'Le contenu d''une pièce émise est immuable.'
      using errcode = 'check_violation';
  end if;

  if old.pdf_path is not null
     and (new.pdf_path         is distinct from old.pdf_path
       or new.pdf_sha256       is distinct from old.pdf_sha256
       or new.pdf_size         is distinct from old.pdf_size
       or new.renderer_version is distinct from old.renderer_version
       or new.archived_at      is distinct from old.archived_at) then
    raise exception 'L''archive d''une pièce émise ne se remplace pas.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists document_snapshots_immutable on public.document_snapshots;
create trigger document_snapshots_immutable
  before update on public.document_snapshots
  for each row execute function public.tg_document_snapshots_immutable();


-- Un instantané ne s'efface pas tant que sa pièce est émise. Le démontage d'un
-- contrôle annule d'abord la pièce (règle de 4D) : la suppression en cascade
-- passe alors, parce que la pièce n'est plus EMIS.
create or replace function public.tg_document_snapshots_no_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if exists (
    select 1 from public.documents d
     where d.id = old.document_id and d.status = 'EMIS'
  ) then
    raise exception 'L''instantané d''une pièce émise ne se supprime pas.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$fn$;

drop trigger if exists document_snapshots_no_delete on public.document_snapshots;
create trigger document_snapshots_no_delete
  before delete on public.document_snapshots
  for each row execute function public.tg_document_snapshots_no_delete();


-- -----------------------------------------------------------------------------
-- 5. UNE SEULE FACTURE ACTIVE PAR COMMANDE
--
-- `issue_order_invoice()` regarde avant d'allouer et verrouille la commande.
-- L'index rend la règle vraie pour tout autre chemin : une seconde FACL émise
-- pour la même commande échouerait à l'insertion, donc annulerait sa
-- transaction — et avec elle l'allocation de son numéro.
-- -----------------------------------------------------------------------------

create unique index if not exists documents_one_active_invoice_per_order
  on public.documents (entity_id)
  where doc_type = 'FACL' and status = 'EMIS' and entity_type = 'order';


-- -----------------------------------------------------------------------------
-- 6. L'ÉMISSION DE LA FACTURE
--
-- Même signature, même type de retour qu'en 4G : les appelants existants ne
-- changent pas. Ce qui change :
--
--   * la permission : `invoices.issue`, et non plus `orders.update` ;
--   * le verrou : `for update` sur la commande, AVANT de regarder si une
--     facture existe. Deux émissions simultanées pour la même commande
--     s'attendent ; la seconde trouve la facture de la première et la rend,
--     sans allouer ;
--   * l'instantané, écrit dans la même transaction que le numéro ;
--   * la trace d'audit métier, qui relie la facture à sa commande.
--
-- Les conditions d'émission restent celles de 4G — commande réelle, non
-- annulée, montant positif — plus une évidence : une commande sans ligne ne
-- se facture pas. Aucune exigence de règlement n'est ajoutée : le propriétaire
-- a décidé en 4G qu'émettre n'est pas encaisser, et inversement.
-- -----------------------------------------------------------------------------

create or replace function public.issue_order_invoice(p_order_id uuid)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order    public.orders%rowtype;
  v_existing public.documents%rowtype;
  v_document public.documents%rowtype;
  v_lines    jsonb;
  v_quote    text;
  v_request  text;
  v_paid     numeric(12, 2);
  v_content  jsonb;
begin
  -- Le refus n'est pas journalisé ici : l'exception annulerait l'écriture avec
  -- la transaction. C'est l'action serveur (`assertPermission`) qui le trace.
  if auth.uid() is not null and not public.has_permission('invoices.issue') then
    raise exception 'Émission refusée : permission invoices.issue requise.'
      using errcode = '42501';
  end if;

  -- Verrou d'abord : c'est lui qui rend l'idempotence vraie sous concurrence.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  -- Idempotence, regardée avant toute allocation.
  select * into v_existing
    from public.documents
   where doc_type = 'FACL'
     and entity_type = 'order'
     and entity_id = p_order_id
     and status = 'EMIS'
   limit 1;

  if found then
    return v_existing;
  end if;

  if v_order.status = 'ANNULEE' then
    raise exception 'Une commande annulée ne se facture pas.'
      using errcode = 'check_violation';
  end if;

  if v_order.total_amount <= 0 then
    raise exception 'Une commande sans montant ne se facture pas.'
      using errcode = 'check_violation';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'designation', oi.designation,
             'reference',   oi.item_reference,
             'unit',        oi.unit_label,
             'quantity',    oi.quantity,
             'unit_price',  oi.unit_price,
             'discount',    oi.discount_amount,
             'total',       oi.line_total
           )
           order by oi.position, oi.created_at, oi.id
         )
    into v_lines
    from public.order_items oi
   where oi.order_id = p_order_id;

  if v_lines is null then
    raise exception 'Une commande sans ligne ne se facture pas.'
      using errcode = 'check_violation';
  end if;

  select q.reference into v_quote from public.quotes q where q.id = v_order.quote_id;
  select r.reference into v_request from public.quote_requests r where r.id = v_order.quote_request_id;

  -- Ce qui a été réellement encaissé et vérifié, net des remboursements, à la
  -- date d'émission. Jamais une déclaration du client (D-10).
  v_paid := greatest(v_order.paid_amount - v_order.refunded_amount, 0);

  -- Le Moteur de Documents de 4D, et lui seul. `issue_document` exige à son
  -- tour la permission d'émission du type — désormais `invoices.issue` — et
  -- une session AAL2.
  v_document := public.issue_document(
    'FACL', 'order', v_order.id, v_order.user_id, v_order.customer_name,
    jsonb_build_object(
      'commande', v_order.reference,
      'montant',  v_order.total_amount,
      'devise',   v_order.currency
    )
  );

  v_content := jsonb_build_object(
    'schema',     1,
    'type',       'FACL',
    'reference',  v_document.reference,
    'issued_at',  v_document.issued_at,
    'issuer',     public.document_issuer_identity(),
    'customer',   jsonb_build_object(
                    'name',  v_order.customer_name,
                    'email', v_order.customer_email,
                    'phone', v_order.customer_phone
                  ),
    'references', jsonb_build_object(
                    'order',   v_order.reference,
                    'quote',   v_quote,
                    'request', v_request
                  ),
    'currency',   v_order.currency,
    'lines',      v_lines,
    'totals',     jsonb_build_object(
                    'subtotal', v_order.subtotal_amount,
                    'discount', v_order.discount_amount,
                    'fees',     v_order.fees_amount,
                    'total',    v_order.total_amount,
                    'paid',     v_paid,
                    'due',      greatest(v_order.total_amount - v_paid, 0)
                  )
  );

  insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
  values (v_document.id, 'FACL', 1, v_content, repeat('0', 64));

  insert into public.order_events
    (order_id, event_type, summary, amount, actor_id, actor_label)
  values
    (v_order.id, 'DOCUMENT_EMIS',
     format('Facture %s émise', v_document.reference),
     v_order.total_amount, auth.uid(), public.relation_actor_label());

  -- Qui, quelle facture, quelle commande, quand (horodatage du journal),
  -- résultat. Aucune donnée personnelle, aucun montant de règlement.
  perform public.record_audit_event(
    'commerce.facture.emission', 'document', v_document.reference, 'SUCCES',
    jsonb_build_object(
      'commande', v_order.reference,
      'montant',  v_order.total_amount,
      'devise',   v_order.currency
    )
  );

  return v_document;
end;
$fn$;

comment on function public.issue_order_invoice(uuid) is
  'Émet la facture FACL d''une commande sous invoices.issue, avec son instantané immuable. Verrouille la commande ; rejouée, elle renvoie la facture existante sans consommer de numéro.';

revoke execute on function public.issue_order_invoice(uuid) from public, anon;
grant  execute on function public.issue_order_invoice(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. L'ARCHIVE DU PDF
--
-- Le fichier est rendu et déposé par le serveur ; cette fonction enregistre
-- son emplacement et son empreinte. Réservée à `service_role` : aucune session
-- ne peut prétendre qu'un fichier quelconque est l'archive d'une facture.
--
-- Idempotente : la même empreinte enregistrée deux fois ne change rien ; une
-- empreinte différente est refusée — l'archive ne se remplace pas.
-- -----------------------------------------------------------------------------

create or replace function public.record_document_archive(
  p_document_id uuid,
  p_path        text,
  p_sha256      text,
  p_size        integer,
  p_renderer    text
)
returns public.document_snapshots
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_snapshot public.document_snapshots%rowtype;
begin
  select * into v_snapshot from public.document_snapshots where document_id = p_document_id for update;
  if not found then
    raise exception 'Instantané introuvable.' using errcode = 'no_data_found';
  end if;

  if v_snapshot.pdf_path is not null then
    if v_snapshot.pdf_sha256 = lower(p_sha256) and v_snapshot.pdf_path = p_path then
      return v_snapshot;
    end if;
    raise exception 'L''archive de cette pièce existe déjà.' using errcode = 'check_violation';
  end if;

  update public.document_snapshots
     set pdf_path         = p_path,
         pdf_sha256       = lower(p_sha256),
         pdf_size         = p_size,
         renderer_version = p_renderer,
         archived_at      = now()
   where document_id = p_document_id
  returning * into v_snapshot;

  return v_snapshot;
end;
$fn$;

comment on function public.record_document_archive(uuid, text, text, integer, text) is
  'Enregistre une fois l''archive PDF d''une pièce. Réservée au serveur (service_role).';

revoke execute on function public.record_document_archive(uuid, text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.record_document_archive(uuid, text, text, integer, text) to service_role;


-- -----------------------------------------------------------------------------
-- 8. LE BUCKET PRIVÉ DES PIÈCES OFFICIELLES
--
-- Distinct des visuels publics (`contenus-medias`) et des justificatifs. Aucune
-- URL publique. Le nom d'objet est l'UUID du document : connaître une
-- référence officielle ne permet pas de deviner un chemin, et connaître un
-- chemin ne donne rien sans le droit de lire la pièce.
--
-- Lecture : exactement les règles de `public.documents` — le destinataire, ou
-- qui détient la permission de lecture du type. Écriture : aucune politique.
-- Seul le serveur dépose, avec la clé à privilèges, un fichier qu'il a rendu
-- lui-même à partir de l'instantané.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents-officiels', 'documents-officiels', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

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
           (d.owner_id is not null and d.owner_id = auth.uid())
           or public.can_read_document_type(d.doc_type)
         )
    )
  );


-- -----------------------------------------------------------------------------
-- 9. PRIVILÈGES ET RLS DE L'INSTANTANÉ
--
-- Lecture seule, et seulement pour qui lit la pièce elle-même. Aucune
-- écriture depuis une session : l'instantané naît dans `issue_order_invoice`,
-- l'archive s'enregistre par `record_document_archive`.
-- -----------------------------------------------------------------------------

revoke all on public.document_snapshots from anon, authenticated;
grant select on public.document_snapshots to authenticated;

alter table public.document_snapshots enable row level security;

drop policy if exists document_snapshots_select on public.document_snapshots;
create policy document_snapshots_select
  on public.document_snapshots for select to authenticated
  using (
    exists (
      select 1
        from public.documents d
       where d.id = document_snapshots.document_id
         and (
           (d.owner_id is not null and d.owner_id = auth.uid())
           or public.can_read_document_type(d.doc_type)
         )
    )
  );
