-- =============================================================================
-- CORRECTIONS POST-4I (REMARQUES 01) — DOCUMENTS COMMERCIAUX
--
-- Ce que cette migration ajoute, et dans cet ordre :
--
--   1. l'adresse officielle de MORA Shawiri dans l'identité de l'émetteur ;
--   2. les lignes d'un devis (`quote_items`) et ses observations ;
--   3. le gel du contenu d'un devis émis ;
--   4. l'instantané du devis (DVCL) : constructeur, aperçu, émission ;
--   5. la reprise des devis déjà émis sans instantané ;
--   6. le document de commande (CMCL) : constructeur et émission explicite ;
--   7. la commande issue d'un devis reprend ses lignes ;
--   8. « Terminée » : la demande suit son devis et sa commande ;
--   9. un devis rattaché après coup rejoint les documents du client ;
--  10. le journal des e-mails s'ouvre aux devis.
--
-- ## Ce que cette migration ne fait pas
--
-- Aucun nouveau type documentaire : DVCL (devis) et CMCL (commande) existent
-- depuis 4D. Aucun nouveau numéro n'est consommé par le document de
-- commande : la pièce CMCL est allouée à la création de la commande depuis 4G,
-- on lui donne seulement son contenu figé. Aucune taxe, aucune mention légale
-- (D-17 ouverte), aucune condition de paiement inventée.
--
-- `issue_document()`, `issue_order_invoice()` et `respond_to_my_quote()` ne
-- sont pas touchées. `send_quote()` et `place_order_from_quote()` sont reprises
-- **à l'identique**, avec seulement ce que chaque section dit ajouter.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. L'ADRESSE OFFICIELLE
--
-- Décision du propriétaire (2026-10-03) : « Moroni Oasis, route les puffins ».
-- Les pièces déjà émises gardent l'adresse de leur instantané : c'est le sens
-- même d'un instantané.
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
    'address', 'Moroni Oasis, route les puffins',
    'phone',   '+269 430 63 06',
    'email',   'contact@morashawiri.com'
  );
$fn$;

comment on function public.document_issuer_identity() is
  'Identité publique de l''émetteur, recopiée dans chaque instantané documentaire. Miroir de src/lib/site.ts, comparé par test.';


-- -----------------------------------------------------------------------------
-- 2. LES LIGNES ET LES OBSERVATIONS D'UN DEVIS
--
-- Un devis commercial se lit en lignes : désignation, quantité, prix
-- unitaire, remise, montant. Mêmes colonnes et mêmes contraintes que
-- `order_items` (4G), pour qu'une ligne de devis devienne une ligne de
-- commande sans traduction.
--
-- `line_total` est calculé par la base, jamais reçu. `quotes.amount` reste le
-- total du devis — il n'est pas dupliqué : `save_quote_draft` le recalcule à
-- partir des lignes, et `send_quote` refuse d'émettre un devis dont le total
-- ne correspond plus à ses lignes.
-- -----------------------------------------------------------------------------

alter table public.quotes
  add column if not exists notes text,
  add column if not exists replaces_quote_id uuid references public.quotes (id) on delete restrict;

alter table public.quotes drop constraint if exists quotes_notes_length;
alter table public.quotes add constraint quotes_notes_length
  check (notes is null or (btrim(notes) <> '' and length(notes) <= 2000));

alter table public.quotes drop constraint if exists quotes_replaces_other;
alter table public.quotes add constraint quotes_replaces_other
  check (replaces_quote_id is null or replaces_quote_id <> id);

comment on column public.quotes.notes is
  'Observations et conditions propres à ce devis, imprimées sur la pièce. Facultatives.';
comment on column public.quotes.replaces_quote_id is
  'Devis précédent que celui-ci remplace. À l''émission, l''ancien devis envoyé est annulé et sa pièce passe à REMPLACE.';

create table if not exists public.quote_items (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid not null references public.quotes (id) on delete cascade,
  position        integer not null default 0,

  designation     text not null,
  description     text,

  quantity        numeric(12, 3) not null default 1,
  unit_price      numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  line_total      numeric(12, 2) generated always as (round(quantity * unit_price, 2) - discount_amount) stored,

  created_at      timestamptz not null default now(),

  constraint quote_items_designation_present
    check (btrim(designation) <> '' and length(designation) <= 300),
  constraint quote_items_description_length
    check (description is null or (btrim(description) <> '' and length(description) <= 600)),
  constraint quote_items_quantity_positive check (quantity > 0 and quantity <= 1000000),
  constraint quote_items_unit_price_positive check (unit_price >= 0 and unit_price <= 10000000000),
  constraint quote_items_discount_positive check (discount_amount >= 0),
  constraint quote_items_discount_bounded
    check (discount_amount <= round(unit_price * quantity, 2)),
  constraint quote_items_position_positive check (position >= 0)
);

comment on table public.quote_items is
  'Lignes d''un devis. Modifiables tant que le devis est en brouillon, figées ensuite. Écrites par save_quote_draft seulement.';

create index if not exists quote_items_quote_idx on public.quote_items (quote_id, position);

-- Une ligne ne bouge plus dès que son devis a quitté le brouillon. Pendant
-- une suppression en cascade, le devis n'existe déjà plus : rien à garder.
create or replace function public.tg_quote_items_draft_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  select q.status into v_status from public.quotes q where q.id = coalesce(new.quote_id, old.quote_id);
  if not found then
    return coalesce(new, old);
  end if;

  if v_status <> 'BROUILLON' then
    raise exception 'Les lignes d''un devis émis sont figées : établissez une nouvelle version.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists quote_items_draft_only on public.quote_items;
create trigger quote_items_draft_only
  before insert or update or delete on public.quote_items
  for each row execute function public.tg_quote_items_draft_only();

revoke all on public.quote_items from anon, authenticated;
grant select on public.quote_items to authenticated;

alter table public.quote_items enable row level security;

drop policy if exists quote_items_select_admin on public.quote_items;
create policy quote_items_select_admin
  on public.quote_items for select to authenticated
  using (public.can_view_demandes());

-- Le client lit les lignes du devis qu'il lit déjà : jamais un brouillon,
-- jamais le devis d'un autre, jamais avec un compte suspendu ou bloqué.
drop policy if exists quote_items_select_own on public.quote_items;
create policy quote_items_select_own
  on public.quote_items for select to authenticated
  using (
    (select public.client_owner_access_ok())
    and exists (
      select 1
        from public.quotes q
        join public.quote_requests qr on qr.id = q.quote_request_id
       where q.id = quote_items.quote_id
         and q.status <> 'BROUILLON'
         and qr.user_id is not null
         and qr.user_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- 3. UN DEVIS ÉMIS NE SE RÉÉCRIT PAS
--
-- Jusqu'ici, rien n'empêchait de changer le montant ou le texte d'un devis
-- déjà envoyé : la pièce DVCL ne l'aurait pas suivi, et le client aurait lu
-- à l'écran autre chose que ce qui lui avait été émis. Hors brouillon, le
-- contenu est donc gelé ; seul le cycle de vie avance (statut, réponse).
-- Une correction = une nouvelle version (`replaces_quote_id`).
-- -----------------------------------------------------------------------------

create or replace function public.tg_quotes_content_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.status = 'BROUILLON' then
    return new;
  end if;

  if new.amount            is distinct from old.amount
     or new.currency          is distinct from old.currency
     or new.summary           is distinct from old.summary
     or new.notes             is distinct from old.notes
     or new.valid_until       is distinct from old.valid_until
     or new.quote_request_id  is distinct from old.quote_request_id
     or new.replaces_quote_id is distinct from old.replaces_quote_id
     -- `on delete set null` d'une offre supprimée reste permis.
     or (new.service_id is distinct from old.service_id and new.service_id is not null) then
    raise exception 'Un devis émis est figé : établissez une nouvelle version.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_quotes_content_frozen() is
  'Gèle le contenu d''un devis sorti du brouillon : montant, objet, observations, validité. Seul le cycle de vie avance.';

drop trigger if exists quotes_content_frozen on public.quotes;
create trigger quotes_content_frozen
  before update on public.quotes
  for each row execute function public.tg_quotes_content_frozen();


-- -----------------------------------------------------------------------------
-- 4. L'INSTANTANÉ DU DEVIS
--
-- Même principe que la facture : tout ce que la pièce affiche est figé dans
-- la transaction qui alloue le numéro. Le PDF se reproduit de cet instantané
-- et de lui seul.
--
-- Ce qui n'y entre pas : aucun identifiant interne, aucune note interne,
-- aucun motif administratif, aucune information d'affiliation.
-- -----------------------------------------------------------------------------

create or replace function public.quote_document_content(
  p_quote_id   uuid,
  p_reference  text,
  p_issued_at  timestamptz,
  p_preview    boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_quote    public.quotes%rowtype;
  v_request  public.quote_requests%rowtype;
  v_lead     public.leads%rowtype;
  v_service  text;
  v_replaced text;
  v_lines    jsonb;
  v_subtotal numeric(14, 2);
  v_discount numeric(14, 2);
begin
  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  select * into v_lead    from public.leads          where id = v_request.lead_id;
  select s.title into v_service from public.services s where s.id = v_quote.service_id;
  select q.reference into v_replaced from public.quotes q where q.id = v_quote.replaces_quote_id;

  select jsonb_agg(
           jsonb_build_object(
             'designation', i.designation,
             'description', i.description,
             'quantity',    i.quantity,
             'unit_price',  i.unit_price,
             'discount',    i.discount_amount,
             'total',       i.line_total
           )
           order by i.position, i.created_at, i.id
         ),
         sum(round(i.quantity * i.unit_price, 2)),
         sum(i.discount_amount)
    into v_lines, v_subtotal, v_discount
    from public.quote_items i
   where i.quote_id = p_quote_id;

  -- Devis antérieur aux lignes : une seule ligne, celle qu'il portait.
  if v_lines is null then
    v_lines := jsonb_build_array(jsonb_build_object(
      'designation', coalesce(v_service, left(v_quote.summary, 300)),
      'description', case when v_service is not null then left(v_quote.summary, 600) end,
      'quantity',    1,
      'unit_price',  v_quote.amount,
      'discount',    0,
      'total',       v_quote.amount
    ));
    v_subtotal := v_quote.amount;
    v_discount := 0;
  end if;

  return jsonb_build_object(
    'schema',      1,
    'type',        'DVCL',
    'preview',     coalesce(p_preview, false),
    'reference',   p_reference,
    'issued_at',   p_issued_at,
    'issuer',      public.document_issuer_identity(),
    'customer',    jsonb_build_object(
                     'name',         coalesce(v_lead.full_name, 'Client'),
                     'organisation', v_request.organisation,
                     'email',        v_lead.email,
                     'phone',        v_lead.phone
                   ),
    'references',  jsonb_build_object(
                     'request',  v_request.reference,
                     'replaces', v_replaced
                   ),
    'subject',     v_quote.summary,
    'service',     v_service,
    'currency',    v_quote.currency,
    'lines',       v_lines,
    'totals',      jsonb_build_object(
                     'subtotal', v_subtotal,
                     'discount', v_discount,
                     'total',    v_quote.amount
                   ),
    'valid_until', v_quote.valid_until,
    'notes',       v_quote.notes
  );
end;
$fn$;

comment on function public.quote_document_content(uuid, text, timestamptz, boolean) is
  'Compose le contenu affiché par un devis DVCL (ou son aperçu). Interne : appelée par send_quote et quote_preview.';

revoke execute on function public.quote_document_content(uuid, text, timestamptz, boolean) from public, anon, authenticated;
grant  execute on function public.quote_document_content(uuid, text, timestamptz, boolean) to service_role;


-- Préparer ou corriger un brouillon de devis, lignes comprises.
--
-- Le seul chemin d'écriture des lignes. Tout est revalidé ici — le navigateur
-- ne décide d'aucun total — et `quotes.amount` est recalculé à partir des
-- lignes, dans la même transaction.
create or replace function public.save_quote_draft(
  p_request_reference text,
  p_quote_id          uuid,
  p_summary           text,
  p_notes             text,
  p_valid_until       date,
  p_lines             jsonb,
  p_replaces          uuid default null
)
returns public.quotes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_request  public.quote_requests%rowtype;
  v_quote    public.quotes%rowtype;
  v_replaced public.quotes%rowtype;
  v_summary  text := btrim(coalesce(p_summary, ''));
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_line     jsonb;
  v_index    integer := 0;
  v_qty      numeric;
  v_price    numeric;
  v_discount numeric;
  v_label    text;
  v_desc     text;
  v_total    numeric(14, 2);
begin
  if auth.uid() is not null then
    if p_quote_id is null and not public.has_permission('quotes.create') then
      raise exception 'Création refusée : permission quotes.create requise.' using errcode = '42501';
    end if;
    if p_quote_id is not null
       and not (public.has_permission('quotes.create') or public.has_permission('quotes.update')) then
      raise exception 'Modification refusée : permission quotes.update requise.' using errcode = '42501';
    end if;
  end if;

  if length(v_summary) < 3 or length(v_summary) > 2000 then
    raise exception 'Indiquez l''objet du devis (3 à 2 000 caractères).' using errcode = 'check_violation';
  end if;
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception 'Les observations ne dépassent pas 2 000 caractères.' using errcode = 'check_violation';
  end if;
  if p_valid_until is not null and p_valid_until < (now() at time zone 'Indian/Comoro')::date then
    raise exception 'La date de validité ne peut pas être passée.' using errcode = 'check_violation';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'Un devis compte de 1 à 50 lignes.' using errcode = 'check_violation';
  end if;

  if p_quote_id is null then
    select * into v_request from public.quote_requests
     where reference = upper(btrim(coalesce(p_request_reference, '')))
       for update;
    if not found then
      raise exception 'Demande introuvable.' using errcode = 'no_data_found';
    end if;
    if v_request.status = 'ANNULEE' then
      raise exception 'Une demande annulée ne reçoit plus de devis.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.quotes q where q.quote_request_id = v_request.id and q.status = 'BROUILLON') then
      raise exception 'Un brouillon de devis existe déjà pour cette demande : complétez-le.' using errcode = 'check_violation';
    end if;
  else
    select * into v_quote from public.quotes where id = p_quote_id for update;
    if not found then
      raise exception 'Devis introuvable.' using errcode = 'no_data_found';
    end if;
    if v_quote.status <> 'BROUILLON' then
      raise exception 'Un devis émis est figé : établissez une nouvelle version.' using errcode = 'check_violation';
    end if;
    select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  end if;

  if p_replaces is not null then
    select * into v_replaced from public.quotes where id = p_replaces;
    if not found or v_replaced.quote_request_id <> v_request.id
       or v_replaced.status not in ('ENVOYE', 'REFUSE', 'EXPIRE') then
      raise exception 'Seul un devis émis de la même demande, sans réponse positive, peut être remplacé.'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_quote_id is null then
    insert into public.quotes
      (quote_request_id, service_id, amount, currency, summary, notes, valid_until, status, replaces_quote_id)
    values
      (v_request.id, v_request.service_id, 1, 'KMF', v_summary, v_notes, p_valid_until, 'BROUILLON', p_replaces)
    returning * into v_quote;
  else
    delete from public.quote_items where quote_id = v_quote.id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_label := btrim(coalesce(v_line ->> 'designation', ''));
    v_desc  := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
    begin
      v_qty      := (v_line ->> 'quantity')::numeric;
      v_price    := (v_line ->> 'unit_price')::numeric;
      v_discount := coalesce(nullif(v_line ->> 'discount', '')::numeric, 0);
    exception when others then
      raise exception 'Ligne %, valeur numérique illisible.', v_index + 1 using errcode = 'check_violation';
    end;

    if v_label = '' or length(v_label) > 300 then
      raise exception 'Ligne % : la désignation est obligatoire (300 caractères au plus).', v_index + 1
        using errcode = 'check_violation';
    end if;
    if v_desc is not null and length(v_desc) > 600 then
      raise exception 'Ligne % : la description ne dépasse pas 600 caractères.', v_index + 1
        using errcode = 'check_violation';
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'Ligne % : quantité invalide.', v_index + 1 using errcode = 'check_violation';
    end if;
    if v_price is null or v_price < 0 or v_price > 10000000000 or v_price <> round(v_price, 2) then
      raise exception 'Ligne % : prix unitaire invalide.', v_index + 1 using errcode = 'check_violation';
    end if;
    if v_discount < 0 or v_discount <> round(v_discount, 2) or v_discount > round(v_qty * v_price, 2) then
      raise exception 'Ligne % : la remise ne peut dépasser le montant de la ligne.', v_index + 1
        using errcode = 'check_violation';
    end if;

    insert into public.quote_items
      (quote_id, position, designation, description, quantity, unit_price, discount_amount)
    values
      (v_quote.id, v_index, v_label, v_desc, v_qty, v_price, v_discount);

    v_index := v_index + 1;
  end loop;

  select coalesce(sum(line_total), 0) into v_total from public.quote_items where quote_id = v_quote.id;
  if v_total <= 0 then
    raise exception 'Le total du devis doit être supérieur à zéro.' using errcode = 'check_violation';
  end if;

  update public.quotes
     set amount            = v_total,
         summary           = v_summary,
         notes             = v_notes,
         valid_until       = p_valid_until,
         replaces_quote_id = p_replaces
   where id = v_quote.id
  returning * into v_quote;

  return v_quote;
end;
$fn$;

comment on function public.save_quote_draft(text, uuid, text, text, date, jsonb, uuid) is
  'Crée ou corrige un brouillon de devis avec ses lignes ; le total est recalculé par la base. quotes.create (création) ou quotes.update (correction).';

revoke execute on function public.save_quote_draft(text, uuid, text, text, date, jsonb, uuid) from public, anon;
grant  execute on function public.save_quote_draft(text, uuid, text, text, date, jsonb, uuid) to authenticated, service_role;


-- Aperçu d'un brouillon : le contenu tel que la pièce l'afficherait, sans
-- numéro, sans archive, sans instantané. Lecture seule.
create or replace function public.quote_preview(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  if not public.can_view_demandes() then
    raise exception 'Permission quotes.view requise.' using errcode = '42501';
  end if;

  select status into v_status from public.quotes where id = p_quote_id;
  if not found or v_status <> 'BROUILLON' then
    raise exception 'Seul un brouillon a un aperçu.' using errcode = 'no_data_found';
  end if;

  return public.quote_document_content(p_quote_id, null, now(), true);
end;
$fn$;

comment on function public.quote_preview(uuid) is
  'Aperçu d''un brouillon de devis : sans numéro, jamais archivé, marqué APERÇU au rendu. quotes.view.';

revoke execute on function public.quote_preview(uuid) from public, anon;
grant  execute on function public.quote_preview(uuid) to authenticated, service_role;


-- L'émission du devis — reprise exacte de 4F, plus :
--   * le contrôle « total = lignes » avant d'allouer ;
--   * le remplacement d'une version précédente (pièce REMPLACE, devis annulé) ;
--   * l'instantané, dans la transaction du numéro ;
--   * la trace d'audit métier de l'émission.
create or replace function public.send_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote    public.quotes%rowtype;
  v_request  public.quote_requests%rowtype;
  v_lead     public.leads%rowtype;
  v_document public.documents%rowtype;
  v_result   public.quotes%rowtype;
  v_replaced public.quotes%rowtype;
  v_old_doc  uuid;
  v_lines    numeric(14, 2);
begin
  -- Voir l'en-tête du § 18 (4F) : le garde de transition ne refusera rien
  -- depuis l'intérieur d'une fonction DEFINER. `quotes.manage` se vérifie ici.
  if auth.uid() is not null and not public.has_permission('quotes.manage') then
    raise exception 'Émission refusée : permission quotes.manage requise.'
      using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  if v_quote.status <> 'BROUILLON' then
    raise exception 'Ce devis a déjà été émis (%).', v_quote.status
      using errcode = 'check_violation';
  end if;

  -- Le total émis est celui des lignes, à l'unité près.
  select sum(line_total) into v_lines from public.quote_items where quote_id = p_quote_id;
  if v_lines is not null and v_lines <> v_quote.amount then
    raise exception 'Le total du devis ne correspond plus à ses lignes : enregistrez de nouveau le brouillon.'
      using errcode = 'check_violation';
  end if;

  select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  select * into v_lead    from public.leads          where id = v_request.lead_id;

  if v_quote.replaces_quote_id is not null then
    select * into v_replaced from public.quotes where id = v_quote.replaces_quote_id for update;
    if not found or v_replaced.status not in ('ENVOYE', 'REFUSE', 'EXPIRE') then
      raise exception 'Le devis remplacé a changé d''état : retirez le remplacement ou recommencez.'
        using errcode = 'check_violation';
    end if;
    select d.id into v_old_doc from public.documents d
     where d.id = v_replaced.document_id and d.status = 'EMIS';
  end if;

  -- Le Moteur de Documents de 4D : un seul allocateur, une seule suite.
  -- `p_replaces` fait passer l'ancienne pièce à REMPLACE (4D, § 152).
  v_document := public.issue_document(
    'DVCL',
    'quote',
    v_quote.id,
    v_request.user_id,
    v_lead.full_name,
    jsonb_build_object(
      'demande', v_request.reference,
      'montant', v_quote.amount,
      'devise',  v_quote.currency
    ),
    v_old_doc
  );

  update public.quotes
     set reference   = v_document.reference,
         document_id = v_document.id,
         sent_at     = now(),
         status      = 'ENVOYE'
   where id = p_quote_id
  returning * into v_result;

  -- L'ancienne version, encore en attente de réponse, n'est plus proposée.
  if v_replaced.id is not null and v_replaced.status = 'ENVOYE' then
    update public.quotes set status = 'ANNULE' where id = v_replaced.id;
  end if;

  insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
  values (
    v_document.id, 'DVCL', 1,
    public.quote_document_content(p_quote_id, v_document.reference, v_document.issued_at, false),
    repeat('0', 64)
  );

  -- La demande suit, si son état le permet. Le garde de transition valide.
  if v_request.status = 'EN_ETUDE' then
    update public.quote_requests
       set status = 'DEVIS_ENVOYE'
     where id = v_request.id;
  end if;

  perform public.record_audit_event(
    'relation.devis.emission', 'quote', v_document.reference, 'SUCCES',
    jsonb_build_object(
      'demande',  v_request.reference,
      'montant',  v_quote.amount,
      'devise',   v_quote.currency,
      'remplace', v_replaced.reference
    )
  );

  return v_result;
end;
$$;

comment on function public.send_quote(uuid) is
  'Émet un devis via le Moteur de Documents 4D (pièce DVCL + instantané figé), remplace le cas échéant la version précédente, puis la demande passe à « Devis envoyé ».';

revoke execute on function public.send_quote(uuid) from public, anon;
grant  execute on function public.send_quote(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. LES DEVIS DÉJÀ ÉMIS
--
-- Trois DVCL existent sans instantané (émis avant ce lot, rendus en fiche
-- technique). Leur contenu est figé maintenant, depuis le devis lui-même —
-- montant et texte n'ont pas pu changer depuis, la section 3 l'interdisant
-- désormais. La date d'émission reste celle de la pièce. `reprise` le dit.
-- -----------------------------------------------------------------------------

insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
select d.id, 'DVCL', 1,
       public.quote_document_content(q.id, d.reference, d.issued_at, false) || jsonb_build_object('reprise', true),
       repeat('0', 64)
  from public.documents d
  join public.quotes q on q.document_id = d.id
 where d.doc_type = 'DVCL'
   and not exists (select 1 from public.document_snapshots s where s.document_id = d.id);


-- -----------------------------------------------------------------------------
-- 6. LE DOCUMENT DE COMMANDE (CMCL)
--
-- La pièce CMCL existe depuis la création de la commande (4G) : c'est elle
-- qui porte la référence MORA-CMCL. Ce qui lui manquait, c'est un contenu.
-- Il est figé ici par un acte explicite, comme la facture : une commande
-- confirmée (ou plus avancée), avec des lignes. Aucun numéro n'est consommé.
-- -----------------------------------------------------------------------------

create or replace function public.order_document_content(p_order_id uuid, p_issued_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order   public.orders%rowtype;
  v_lines   jsonb;
  v_quote   text;
  v_request text;
  v_paid    numeric(12, 2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
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

  select q.reference into v_quote from public.quotes q where q.id = v_order.quote_id;
  select r.reference into v_request from public.quote_requests r where r.id = v_order.quote_request_id;

  v_paid := greatest(v_order.paid_amount - v_order.refunded_amount, 0);

  return jsonb_build_object(
    'schema',     1,
    'type',       'CMCL',
    'reference',  v_order.reference,
    'issued_at',  p_issued_at,
    'ordered_at', v_order.created_at,
    'issuer',     public.document_issuer_identity(),
    'customer',   jsonb_build_object(
                    'name',  v_order.customer_name,
                    'email', v_order.customer_email,
                    'phone', v_order.customer_phone
                  ),
    'references', jsonb_build_object('quote', v_quote, 'request', v_request),
    'status',     v_order.status,
    'currency',   v_order.currency,
    'lines',      coalesce(v_lines, '[]'::jsonb),
    'totals',     jsonb_build_object(
                    'subtotal', v_order.subtotal_amount,
                    'discount', v_order.discount_amount,
                    'fees',     v_order.fees_amount,
                    'total',    v_order.total_amount,
                    'paid',     v_paid,
                    'due',      greatest(v_order.total_amount - v_paid, 0)
                  )
  );
end;
$fn$;

comment on function public.order_document_content(uuid, timestamptz) is
  'Compose le contenu affiché par la pièce CMCL d''une commande. Interne : appelée par issue_order_document.';

revoke execute on function public.order_document_content(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.order_document_content(uuid, timestamptz) to service_role;


create or replace function public.issue_order_document(p_order_id uuid)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order    public.orders%rowtype;
  v_document public.documents%rowtype;
begin
  -- La permission d'émission du type CMCL, lue comme `issue_document` la lit.
  if auth.uid() is not null and not public.has_permission(
       (select t.issue_permission from public.document_types t where t.code = 'CMCL')) then
    raise exception 'Émission refusée : permission orders.update requise.'
      using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  select * into v_document from public.documents where id = v_order.document_id;
  if not found then
    raise exception 'Cette commande n''a pas de pièce CMCL.' using errcode = 'no_data_found';
  end if;

  -- Idempotence : un second acte rend la pièce déjà établie.
  if exists (select 1 from public.document_snapshots s where s.document_id = v_document.id) then
    return v_document;
  end if;

  if v_document.status <> 'EMIS' then
    raise exception 'La pièce % n''est plus valide.', v_document.reference using errcode = 'check_violation';
  end if;
  if v_order.status in ('NOUVELLE', 'ANNULEE') then
    raise exception 'Le document de commande s''établit pour une commande confirmée (celle-ci est %).', v_order.status
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.order_items oi where oi.order_id = p_order_id) then
    raise exception 'Une commande sans ligne n''a pas de document de commande.' using errcode = 'check_violation';
  end if;

  insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
  values (v_document.id, 'CMCL', 1, public.order_document_content(p_order_id, now()), repeat('0', 64));

  insert into public.order_events
    (order_id, event_type, summary, amount, actor_id, actor_label)
  values
    (v_order.id, 'DOCUMENT_EMIS',
     format('Document de commande %s établi', v_document.reference),
     v_order.total_amount, auth.uid(), public.relation_actor_label());

  perform public.record_audit_event(
    'commerce.commande.document', 'document', v_document.reference, 'SUCCES',
    jsonb_build_object('montant', v_order.total_amount, 'devise', v_order.currency, 'statut', v_order.status)
  );

  return v_document;
end;
$fn$;

comment on function public.issue_order_document(uuid) is
  'Établit le document officiel d''une commande confirmée : fige le contenu de sa pièce CMCL existante. Aucun numéro consommé ; rejouée, renvoie la pièce.';

revoke execute on function public.issue_order_document(uuid) from public, anon;
grant  execute on function public.issue_order_document(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. LA COMMANDE REPREND LES LIGNES DU DEVIS
--
-- Reprise exacte de 4G, sauf la création des lignes : une ligne de commande
-- par ligne de devis (le montant négocié fait foi). Un devis antérieur aux
-- lignes garde la ligne unique d'origine.
-- -----------------------------------------------------------------------------

create or replace function public.place_order_from_quote(p_quote_id uuid)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_quote    public.quotes%rowtype;
  v_request  public.quote_requests%rowtype;
  v_lead     public.leads%rowtype;
  v_existing public.orders%rowtype;
  v_document public.documents%rowtype;
  v_order    public.orders%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('orders.update') then
    raise exception 'Création refusée : permission orders.update requise.'
      using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  -- Idempotence, avant toute allocation : rejouer ne consomme pas de CMCL.
  select * into v_existing from public.orders where quote_id = p_quote_id;
  if found then
    return v_existing;
  end if;

  if v_quote.status <> 'ACCEPTE' then
    raise exception
      'Seul un devis accepté devient une commande (celui-ci est %).', v_quote.status
      using errcode = 'check_violation';
  end if;

  select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  select * into v_lead    from public.leads          where id = v_request.lead_id;

  if v_request.user_id is null then
    raise exception
      'La demande % n''est rattachée à aucun compte : la commande ne peut pas être créée.',
      v_request.reference
      using errcode = 'check_violation';
  end if;

  v_document := public.issue_document(
    'CMCL',
    'order',
    null,
    v_request.user_id,
    v_lead.full_name,
    jsonb_build_object(
      'devis',   v_quote.reference,
      'demande', v_request.reference,
      'montant', v_quote.amount,
      'devise',  v_quote.currency
    )
  );

  insert into public.orders (
    reference, document_id, user_id, lead_id, quote_id, quote_request_id,
    customer_name, customer_email, customer_phone,
    fees_amount, currency, is_manual
  )
  values (
    v_document.reference, v_document.id, v_request.user_id, v_lead.id,
    v_quote.id, v_request.id,
    v_lead.full_name, v_lead.email, v_lead.phone,
    0, v_quote.currency, false
  )
  returning * into v_order;

  update public.documents set entity_id = v_order.id where id = v_document.id;

  if exists (select 1 from public.quote_items i where i.quote_id = v_quote.id) then
    insert into public.order_items
      (order_id, service_id, quote_id, designation, item_reference,
       quantity, unit_price, discount_amount, position)
    select v_order.id, v_quote.service_id, v_quote.id,
           left(i.designation || coalesce(' — ' || i.description, ''), 300),
           v_quote.reference, i.quantity, i.unit_price, i.discount_amount, i.position
      from public.quote_items i
     where i.quote_id = v_quote.id
     order by i.position, i.created_at, i.id;
  else
    insert into public.order_items
      (order_id, service_id, quote_id, designation, item_reference,
       quantity, unit_price, position)
    values
      (v_order.id, v_quote.service_id, v_quote.id,
       left(v_quote.summary, 300), v_quote.reference,
       1, v_quote.amount, 0);
  end if;

  insert into public.order_events
    (order_id, event_type, summary, amount, actor_id, actor_label)
  values
    (v_order.id, 'DOCUMENT_EMIS',
     format('Commande client %s émise depuis le devis %s',
            v_document.reference, v_quote.reference),
     v_quote.amount, auth.uid(), public.relation_actor_label());

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$fn$;

comment on function public.place_order_from_quote(uuid) is
  'Transforme un devis accepté en commande, une seule fois, avec ses lignes. Rejouée, elle renvoie la commande existante sans consommer de numéro (§ 29).';

revoke execute on function public.place_order_from_quote(uuid) from public, anon;
grant  execute on function public.place_order_from_quote(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. « TERMINÉE » : LA DEMANDE SUIT SON DEVIS ET SA COMMANDE
--
-- L'état « Terminée » existe depuis 4F pour la demande (Acceptée → Terminée)
-- et depuis 4G pour la commande. Ce qui manquait, c'est le lien :
--
--   * un devis accepté (par le client ou l'administration) fait passer sa
--     demande de « Devis envoyé » à « Acceptée » ;
--   * une commande terminée — la prestation livrée — termine la demande dont
--     elle est issue ;
--   * une demande ne se dit pas terminée tant que sa commande est en cours.
--
-- L'objet métier de la livraison est donc la COMMANDE ; la demande suit.
-- Chaque passage est consigné dans l'historique de la demande (déclencheur
-- 4F) et dans le journal d'activité (audit 4F).
-- -----------------------------------------------------------------------------

create or replace function public.tg_quotes_request_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'ACCEPTE' and old.status is distinct from 'ACCEPTE' then
    update public.quote_requests
       set status = 'ACCEPTEE'
     where id = new.quote_request_id
       and status = 'DEVIS_ENVOYE';
  end if;
  return new;
end;
$fn$;

comment on function public.tg_quotes_request_follows() is
  'Un devis accepté fait passer sa demande de « Devis envoyé » à « Acceptée ».';

drop trigger if exists quotes_request_follows on public.quotes;
create trigger quotes_request_follows
  after update on public.quotes
  for each row execute function public.tg_quotes_request_follows();


create or replace function public.tg_orders_request_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  if new.status <> 'TERMINEE' or old.status = 'TERMINEE' or new.quote_request_id is null then
    return new;
  end if;

  select status into v_status from public.quote_requests where id = new.quote_request_id for update;

  -- Une commande n'existe que pour un devis accepté : une demande restée à
  -- « Devis envoyé » passe d'abord par « Acceptée », comme le graphe l'exige.
  if v_status = 'DEVIS_ENVOYE' and exists (
       select 1 from public.quotes q where q.id = new.quote_id and q.status = 'ACCEPTE') then
    update public.quote_requests set status = 'ACCEPTEE' where id = new.quote_request_id;
    v_status := 'ACCEPTEE';
  end if;

  if v_status = 'ACCEPTEE' then
    update public.quote_requests set status = 'TERMINEE' where id = new.quote_request_id;
  end if;

  return new;
end;
$fn$;

comment on function public.tg_orders_request_follows() is
  'Une commande terminée (prestation livrée) termine la demande dont elle est issue.';

drop trigger if exists orders_request_follows on public.orders;
create trigger orders_request_follows
  after update on public.orders
  for each row execute function public.tg_orders_request_follows();


create or replace function public.tg_quote_requests_termination_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'TERMINEE' and old.status is distinct from 'TERMINEE' and exists (
       select 1 from public.orders o
        where o.quote_request_id = new.id
          and o.status not in ('TERMINEE', 'ANNULEE')) then
    raise exception 'La commande issue de cette demande est en cours : terminez la commande, la demande suivra.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

comment on function public.tg_quote_requests_termination_guard() is
  'Refuse « Terminée » pour une demande dont la commande est encore en cours.';

drop trigger if exists quote_requests_termination_guard on public.quote_requests;
create trigger quote_requests_termination_guard
  before update on public.quote_requests
  for each row execute function public.tg_quote_requests_termination_guard();


-- -----------------------------------------------------------------------------
-- 9. UN DEVIS RATTACHÉ APRÈS COUP REJOINT LES DOCUMENTS DU CLIENT
--
-- Une demande déposée sans compte peut être rattachée plus tard (4I-3). Ses
-- devis déjà émis n'avaient alors pas de titulaire : ils le reçoivent au
-- rattachement, et seulement à ce moment-là.
-- -----------------------------------------------------------------------------

create or replace function public.tg_quote_requests_documents_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if old.user_id is null and new.user_id is not null then
    update public.documents d
       set owner_id = new.user_id
     where d.doc_type = 'DVCL'
       and d.owner_id is null
       and d.id in (select q.document_id from public.quotes q
                     where q.quote_request_id = new.id and q.document_id is not null);
  end if;
  return new;
end;
$fn$;

comment on function public.tg_quote_requests_documents_follow() is
  'Au rattachement d''une demande à un compte, ses devis émis sans titulaire le reçoivent.';

drop trigger if exists quote_requests_documents_follow on public.quote_requests;
create trigger quote_requests_documents_follow
  after update on public.quote_requests
  for each row execute function public.tg_quote_requests_documents_follow();


-- -----------------------------------------------------------------------------
-- 10. LE JOURNAL DES E-MAILS S'OUVRE AUX DEVIS
--
-- L'e-mail « votre devis est disponible » est journalisé sous l'entité
-- `quote`. Qui consulte les demandes et devis le voit, et seulement lui.
-- -----------------------------------------------------------------------------

create or replace function public.can_view_email(p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('notifications.view')
      or (p_entity_type = 'affiliate_application' and public.has_permission('affiliate_applications.view'))
      or (p_entity_type = 'affiliate' and public.has_permission('affiliates.view'))
      or (p_entity_type = 'quote' and public.has_permission('quotes.view'));
$$;

revoke execute on function public.can_view_email(text) from public, anon;
grant  execute on function public.can_view_email(text) to authenticated, service_role;
