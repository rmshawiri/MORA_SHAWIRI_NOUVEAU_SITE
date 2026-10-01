-- =============================================================================
-- PHASE 4H-6 — AFFILIATION : VERSEMENTS
--
-- Les tables `affiliate_payouts` et `affiliate_payout_items` existent depuis
-- 4H-5. Cette migration leur donne leurs règles et leurs actes :
--
--   1. les gardes : un versement confirmé ne se supprime ni ne se réécrit ;
--      ses lignes ne bougent que tant qu'il est en préparation ;
--   2. la préparation : une ou plusieurs commissions acquises, et les
--      ajustements à imputer (G, H), regroupés dans un brouillon unique par
--      affilié ;
--   3. la confirmation : moyen réellement utilisé figé, référence de
--      transaction, et émission du RVAF par le moteur de documents commun,
--      avec son instantané immuable — le PDF (4H-7) se rendra de lui seul ;
--   4. le justificatif privé, rattaché une seule fois ;
--   5. l'échéance selon la fréquence (L) et le seuil éventuel (K) ;
--   6. la qualification exacte d'une annulation après versement.
--
-- ## Prévention du double paiement
--
--   * une commission ou un ajustement ne figure que dans UNE ligne de
--     versement (unicité posée en 4H-5) ;
--   * une commission entre dans un versement en passant à « à verser », et
--     n'en sort qu'en revenant à « acquise » : jamais deux brouillons pour la
--     même ;
--   * un seul brouillon par affilié (index partiel de 4H-5) ;
--   * la confirmation verrouille le versement et ses commissions, et revérifie
--     que chacune lui appartient encore, avant de rien écrire.
--
-- ## Ce que cette migration ne fait pas
--
-- Aucun virement, aucun appel à un opérateur : MORA Shawiri paie hors du
-- site, puis le constate ici. Aucun seuil global (K) : seul le seuil d'une
-- catégorie ou d'un affilié, s'il existe, s'applique.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LES GARDES
-- -----------------------------------------------------------------------------

create or replace function public.tg_affiliate_payouts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un versement ne se supprime pas : un brouillon s''annule, un versement confirmé reste.' using errcode = 'check_violation';
  end if;
  if new.affiliate_id is distinct from old.affiliate_id or new.created_at is distinct from old.created_at
     or new.prepared_at is distinct from old.prepared_at then
    raise exception 'L''identité d''un versement ne change pas.' using errcode = 'check_violation';
  end if;
  if old.status = 'BROUILLON' then
    if new.status not in ('BROUILLON', 'CONFIRME', 'ANNULE') then
      raise exception 'Transition de versement interdite.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- Confirmé ou annulé : figé. Seul le justificatif d'un versement confirmé
  -- peut encore être rattaché, une seule fois.
  if old.status = 'CONFIRME'
     and old.proof_path is null and new.proof_path is not null
     and (to_jsonb(new) - 'proof_path' - 'updated_at') = (to_jsonb(old) - 'proof_path' - 'updated_at') then
    return new;
  end if;
  raise exception 'Un versement % ne se modifie plus.', lower(old.status) using errcode = 'check_violation';
end;
$$;

drop trigger if exists affiliate_payouts_guard on public.affiliate_payouts;
create trigger affiliate_payouts_guard
  before update or delete on public.affiliate_payouts
  for each row execute function public.tg_affiliate_payouts_guard();

drop trigger if exists affiliate_payouts_set_updated_at on public.affiliate_payouts;
create trigger affiliate_payouts_set_updated_at
  before update on public.affiliate_payouts
  for each row execute function public.set_updated_at();

create or replace function public.tg_affiliate_payout_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Une ligne de versement ne se modifie pas.' using errcode = 'check_violation';
  end if;
  select status into v_status from public.affiliate_payouts where id = coalesce(new.payout_id, old.payout_id);
  if v_status is distinct from 'BROUILLON' then
    raise exception 'Les lignes d''un versement % ne bougent plus.', lower(coalesce(v_status, 'inconnu')) using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists affiliate_payout_items_guard on public.affiliate_payout_items;
create trigger affiliate_payout_items_guard
  before insert or update or delete on public.affiliate_payout_items
  for each row execute function public.tg_affiliate_payout_items_guard();


-- -----------------------------------------------------------------------------
-- 2. OUTILS
-- -----------------------------------------------------------------------------

-- Coordonnées masquées pour un instantané : le nom du titulaire, la banque et
-- l'ordre restent lisibles ; un numéro, un compte ou une adresse ne gardent
-- que leurs quatre derniers caractères.
create or replace function public.affiliate_mask_details(p_details jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(
           key,
           case when key in ('titulaire', 'banque', 'ordre') then value
                else to_jsonb('•••• ' || right(value #>> '{}', 4)) end
         ), '{}'::jsonb)
    from jsonb_each(coalesce(p_details, '{}'::jsonb));
$$;

-- Prochaine échéance de versement selon la fréquence de l'affilié (L).
create or replace function public.affiliate_next_payout_date(p_frequency text, p_from date)
returns date
language sql
immutable
as $$
  select case p_frequency
           when 'HEBDOMADAIRE' then p_from + ((7 - extract(isodow from p_from)::int + 5) % 7)  -- vendredi
           when 'FIN_DE_MOIS'  then (date_trunc('month', p_from) + interval '1 month - 1 day')::date
           when 'TRIMESTRIEL'  then (date_trunc('quarter', p_from) + interval '3 months - 1 day')::date
           else null
         end;
$$;

-- Ajustements imputables à un versement : ceux de l'affilié, encore à
-- imputer, qui ne dépendent pas d'une commission restée hors du versement.
-- Un ajustement sur une commission déjà versée (H) ou sans commission
-- s'impute ; un ajustement sur une commission comprise dans ce versement
-- aussi (G : le versement paie le montant conservé).
create or replace function public.affiliate_payout_sync(p_payout_id uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payout public.affiliate_payouts%rowtype;
  v_adj    record;
  v_total  numeric;
begin
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if v_payout.status <> 'BROUILLON' then
    return v_payout.total_amount;
  end if;
  for v_adj in
    select a.*, c.reference as commission_reference
      from public.affiliate_commission_adjustments a
      left join public.affiliate_commissions c on c.id = a.commission_id
     where a.affiliate_id = v_payout.affiliate_id
       and a.status = 'A_IMPUTER'
       and (a.commission_id is null or c.status = 'VERSEE' or c.payout_id = p_payout_id)
       and not exists (select 1 from public.affiliate_payout_items i where i.adjustment_id = a.id)
     order by a.created_at
     for update of a
  loop
    insert into public.affiliate_payout_items (payout_id, adjustment_id, amount, snapshot)
    values (p_payout_id, v_adj.id, v_adj.amount, jsonb_build_object(
      'type', 'AJUSTEMENT', 'kind', v_adj.kind, 'reason', v_adj.reason,
      'commission', v_adj.commission_reference, 'date', v_adj.created_at, 'amount', v_adj.amount));
  end loop;
  select coalesce(sum(amount), 0) into v_total from public.affiliate_payout_items where payout_id = p_payout_id;
  update public.affiliate_payouts set total_amount = greatest(v_total, 0) where id = p_payout_id;
  return v_total;
end;
$fn$;

revoke execute on function public.affiliate_payout_sync(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_payout_sync(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 3. PRÉPARER
-- -----------------------------------------------------------------------------

create or replace function public.prepare_affiliate_payout(
  p_affiliate_id   uuid,
  p_commission_ids uuid[] default null,
  p_period_label   text default null
)
returns public.affiliate_payouts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff     public.affiliates%rowtype;
  v_payout  public.affiliate_payouts%rowtype;
  v_c       public.affiliate_commissions%rowtype;
  v_count   integer := 0;
  v_total   numeric;
  v_min     numeric;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas préparer votre propre versement.' using errcode = '42501';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  if v_aff.status = 'PREPARATION' then
    raise exception 'Un affilié en préparation n''a rien à percevoir.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.affiliate_payouts where affiliate_id = p_affiliate_id and status = 'BROUILLON') then
    raise exception 'Un versement est déjà en préparation pour cet affilié : complétez-le ou annulez-le.' using errcode = 'check_violation';
  end if;
  if p_period_label is not null and length(btrim(p_period_label)) > 80 then
    raise exception 'Période trop longue.' using errcode = 'check_violation';
  end if;

  insert into public.affiliate_payouts (affiliate_id, period_label, prepared_by)
  values (p_affiliate_id, nullif(btrim(coalesce(p_period_label, '')), ''), auth.uid())
  returning * into v_payout;

  for v_c in
    select * from public.affiliate_commissions
     where affiliate_id = p_affiliate_id
       and status = 'ACQUISE'
       and (p_commission_ids is null or id = any (p_commission_ids))
     order by acquired_at, created_at
     for update
  loop
    update public.affiliate_commissions set status = 'A_VERSER', payout_id = v_payout.id where id = v_c.id;
    insert into public.affiliate_payout_items (payout_id, commission_id, amount, snapshot)
    values (v_payout.id, v_c.id, v_c.amount, jsonb_build_object(
      'type', 'COMMISSION', 'reference', v_c.reference, 'order', v_c.order_reference,
      'orderDate', v_c.order_date, 'acquiredAt', v_c.acquired_at, 'base', v_c.base_amount, 'amount', v_c.amount));
    v_count := v_count + 1;
  end loop;

  if p_commission_ids is not null and v_count <> coalesce(array_length(p_commission_ids, 1), 0) then
    raise exception 'Une commission choisie n''est pas acquise, appartient à un autre affilié ou est déjà dans un versement.'
      using errcode = 'check_violation';
  end if;

  v_total := public.affiliate_payout_sync(v_payout.id);
  if v_count = 0 and v_total <= 0 then
    raise exception 'Rien à verser : aucune commission acquise.' using errcode = 'check_violation';
  end if;
  if v_total <= 0 then
    raise exception 'Le solde est nul ou négatif (%) : les ajustements dépassent les commissions. Il sera repris au prochain versement.', v_total
      using errcode = 'check_violation';
  end if;
  -- K : aucun seuil global ; celui de l'affilié ou de sa catégorie, s'il existe.
  select t.payout_min_amount into v_min from public.affiliate_effective_terms(p_affiliate_id) t;
  if v_min is not null and v_total < v_min then
    raise exception 'Montant de % KMF inférieur au seuil de versement de cet affilié (% KMF).', v_total, v_min
      using errcode = 'check_violation';
  end if;

  select * into v_payout from public.affiliate_payouts where id = v_payout.id;
  perform public.affiliation_log(p_affiliate_id, null, 'VERSEMENT_PREPARE',
    format('Versement préparé : %s KMF, %s commission(s)', v_payout.total_amount, v_count), null,
    jsonb_build_object('versement', v_payout.id, 'montant', v_payout.total_amount));
  return v_payout;
end;
$fn$;

revoke execute on function public.prepare_affiliate_payout(uuid, uuid[], text) from public, anon;
grant  execute on function public.prepare_affiliate_payout(uuid, uuid[], text) to authenticated, service_role;


-- Retirer une ligne d'un brouillon : la commission redevient acquise,
-- l'ajustement redevient simplement à imputer.
create or replace function public.remove_payout_item(p_item_id uuid)
returns public.affiliate_payouts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_item   public.affiliate_payout_items%rowtype;
  v_payout public.affiliate_payouts%rowtype;
  v_total  numeric;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  select * into v_item from public.affiliate_payout_items where id = p_item_id;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'no_data_found';
  end if;
  select * into v_payout from public.affiliate_payouts where id = v_item.payout_id for update;
  if public.affiliate_is_caller(v_payout.affiliate_id) then
    raise exception 'Vous ne pouvez pas modifier votre propre versement.' using errcode = '42501';
  end if;
  if v_payout.status <> 'BROUILLON' then
    raise exception 'Seul un versement en préparation se modifie.' using errcode = 'check_violation';
  end if;
  delete from public.affiliate_payout_items where id = p_item_id;
  if v_item.commission_id is not null then
    -- Ses ajustements sortent avec elle : ils suivront la commission.
    delete from public.affiliate_payout_items i
     using public.affiliate_commission_adjustments a
     where i.payout_id = v_payout.id and i.adjustment_id = a.id and a.commission_id = v_item.commission_id;
    update public.affiliate_commissions set status = 'ACQUISE', payout_id = null where id = v_item.commission_id;
  end if;
  select coalesce(sum(amount), 0) into v_total from public.affiliate_payout_items where payout_id = v_payout.id;
  update public.affiliate_payouts set total_amount = greatest(v_total, 0) where id = v_payout.id returning * into v_payout;
  return v_payout;
end;
$fn$;

revoke execute on function public.remove_payout_item(uuid) from public, anon;
grant  execute on function public.remove_payout_item(uuid) to authenticated, service_role;


-- Annuler un brouillon : tout revient à son état d'avant, le brouillon reste
-- dans l'historique, annulé et motivé.
create or replace function public.cancel_affiliate_payout(p_payout_id uuid, p_reason text)
returns public.affiliate_payouts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payout public.affiliate_payouts%rowtype;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Une annulation se motive.' using errcode = 'check_violation';
  end if;
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Versement introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_payout.affiliate_id) then
    raise exception 'Vous ne pouvez pas agir sur votre propre versement.' using errcode = '42501';
  end if;
  if v_payout.status <> 'BROUILLON' then
    raise exception 'Un versement confirmé ne s''annule pas : une erreur se corrige par un ajustement.' using errcode = 'check_violation';
  end if;
  update public.affiliate_commissions set status = 'ACQUISE', payout_id = null
   where payout_id = p_payout_id and status = 'A_VERSER';
  delete from public.affiliate_payout_items where payout_id = p_payout_id;
  update public.affiliate_payouts
     set status = 'ANNULE', total_amount = 0, cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(btrim(p_reason), 1000)
   where id = p_payout_id returning * into v_payout;
  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  perform public.affiliation_log(v_payout.affiliate_id, null, 'VERSEMENT_ANNULE',
    'Versement en préparation annulé', null, jsonb_build_object('versement', p_payout_id));
  return v_payout;
end;
$fn$;

revoke execute on function public.cancel_affiliate_payout(uuid, text) from public, anon;
grant  execute on function public.cancel_affiliate_payout(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. CONFIRMER — et émettre le RVAF
-- -----------------------------------------------------------------------------

create or replace function public.confirm_affiliate_payout(
  p_payout_id             uuid,
  p_method_code           text,
  p_transaction_reference text,
  p_paid_on               date,
  p_note                  text default null
)
returns public.affiliate_payouts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payout   public.affiliate_payouts%rowtype;
  v_aff      public.affiliates%rowtype;
  v_method   public.payment_methods%rowtype;
  v_account  public.affiliate_payout_accounts%rowtype;
  v_total    numeric;
  v_bad      integer;
  v_items    jsonb;
  v_snapshot jsonb;
  v_document public.documents%rowtype;
  v_content  jsonb;
  v_paid_at  timestamptz;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Versement introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_payout.affiliate_id) then
    raise exception 'Vous ne pouvez pas confirmer votre propre versement.' using errcode = '42501';
  end if;
  if v_payout.status <> 'BROUILLON' then
    raise exception 'Ce versement est déjà %.', lower(v_payout.status) using errcode = 'check_violation';
  end if;
  select * into v_aff from public.affiliates where id = v_payout.affiliate_id;

  select * into v_method from public.payment_methods where code = p_method_code;
  if not found or not v_method.payout_enabled then
    raise exception 'Moyen de versement inconnu ou non autorisé pour les versements.' using errcode = 'check_violation';
  end if;
  if v_method.kind <> 'CASH' and btrim(coalesce(p_transaction_reference, '')) = '' then
    raise exception 'La référence de la transaction est obligatoire pour ce moyen.' using errcode = 'check_violation';
  end if;
  if p_transaction_reference is not null and length(btrim(p_transaction_reference)) > 120 then
    raise exception 'Référence de transaction trop longue.' using errcode = 'check_violation';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Indian/Comoro')::date then
    raise exception 'La date du versement est obligatoire et ne peut pas être future.' using errcode = 'check_violation';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'Note trop longue.' using errcode = 'check_violation';
  end if;

  -- Double paiement : chaque commission doit encore appartenir à CE versement.
  perform 1 from public.affiliate_commissions c
    join public.affiliate_payout_items i on i.commission_id = c.id
   where i.payout_id = p_payout_id
   for update of c;
  select count(*) into v_bad
    from public.affiliate_payout_items i
    join public.affiliate_commissions c on c.id = i.commission_id
   where i.payout_id = p_payout_id
     and (c.status <> 'A_VERSER' or c.payout_id is distinct from p_payout_id);
  if v_bad > 0 then
    raise exception 'Une commission de ce versement a changé d''état : retirez-la avant de confirmer.' using errcode = 'check_violation';
  end if;

  -- Les ajustements arrivés depuis la préparation (un remboursement, par
  -- exemple) entrent avant la confirmation : le versement paie le dû réel.
  v_total := public.affiliate_payout_sync(p_payout_id);
  if v_total <= 0 then
    raise exception 'Le solde du versement est nul ou négatif (%) : rien à verser.', v_total using errcode = 'check_violation';
  end if;

  -- Le moyen réellement utilisé. Les coordonnées validées s'y rattachent si
  -- elles portent sur ce moyen ; sinon (espèces remises en main propre, par
  -- exemple), la note explique le choix.
  select * into v_account from public.affiliate_payout_accounts
   where affiliate_id = v_payout.affiliate_id and status = 'ACTIF' and method_code = p_method_code
   order by reviewed_at desc nulls last limit 1;
  if v_account.id is null and v_method.kind <> 'CASH' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Ce moyen ne correspond pas aux coordonnées validées de l''affilié : précisez-le dans la note.' using errcode = 'check_violation';
  end if;
  v_snapshot := jsonb_build_object(
    'code', v_method.code, 'label', v_method.label, 'kind', v_method.kind,
    'account', case when v_account.id is not null then v_account.id end,
    'details', case when v_account.id is not null then public.affiliate_mask_details(v_account.details) end);

  select jsonb_agg(i.snapshot order by (i.snapshot ->> 'type') desc, i.created_at) into v_items
    from public.affiliate_payout_items i where i.payout_id = p_payout_id;

  v_paid_at := (p_paid_on::timestamp + interval '12 hours') at time zone 'Indian/Comoro';

  -- Le moteur de documents de 4D, et lui seul : RVAF s'émet sous
  -- payouts.manage (document_types), dans cette transaction.
  v_document := public.issue_document(
    'RVAF', 'affiliate_payout', p_payout_id, v_aff.user_id, v_aff.display_name,
    jsonb_build_object('affilie', v_aff.reference, 'montant', v_total, 'devise', v_payout.currency));

  v_content := jsonb_build_object(
    'schema',    1,
    'type',      'RVAF',
    'reference', v_document.reference,
    'issued_at', v_document.issued_at,
    'issuer',    public.document_issuer_identity(),
    'affiliate', jsonb_build_object(
                   'reference', v_aff.reference, 'name', v_aff.display_name,
                   'legalName', v_aff.legal_name, 'partyType', v_aff.party_type),
    'payout',    jsonb_build_object(
                   'period', v_payout.period_label, 'paidOn', p_paid_on,
                   'method', v_snapshot, 'transaction', nullif(btrim(coalesce(p_transaction_reference, '')), '')),
    'currency',  v_payout.currency,
    'lines',     coalesce(v_items, '[]'::jsonb),
    'total',     v_total
  );
  insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
  values (v_document.id, 'RVAF', 1, v_content, repeat('0', 64));

  update public.affiliate_payouts
     set status = 'CONFIRME', reference = v_document.reference, document_id = v_document.id,
         total_amount = v_total, method_code = v_method.code, payout_account_id = v_account.id,
         method_snapshot = v_snapshot,
         transaction_reference = nullif(btrim(coalesce(p_transaction_reference, '')), ''),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         confirmed_by = auth.uid(), confirmed_at = v_paid_at
   where id = p_payout_id
  returning * into v_payout;

  update public.affiliate_commissions
     set status = 'VERSEE', paid_at = v_paid_at
   where payout_id = p_payout_id and status = 'A_VERSER';
  update public.affiliate_commission_adjustments a
     set status = 'IMPUTE', payout_id = p_payout_id, imputed_at = now()
    from public.affiliate_payout_items i
   where i.payout_id = p_payout_id and i.adjustment_id = a.id;

  perform public.affiliation_log(v_payout.affiliate_id, null, 'VERSEMENT_CONFIRME',
    format('Versement %s confirmé : %s KMF par %s', v_payout.reference, v_total, v_method.label), null,
    jsonb_build_object('versement', v_payout.reference, 'montant', v_total, 'moyen', v_method.code));
  perform public.affiliation_notify(v_payout.affiliate_id, 'affiliation.versement.confirme', 'affiliate_payout', v_payout.id,
    jsonb_build_object('reference', v_payout.reference, 'montant', v_total));
  return v_payout;
end;
$fn$;

revoke execute on function public.confirm_affiliate_payout(uuid, text, text, date, text) from public, anon;
grant  execute on function public.confirm_affiliate_payout(uuid, text, text, date, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. LE JUSTIFICATIF PRIVÉ
--
-- Le fichier est déposé par le serveur, avec la clé à privilèges, dans un
-- bucket privé sans aucune politique de lecture : seule l'administration le
-- consulte, par une URL signée produite côté serveur sous payouts.view.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('affiliation-justificatifs', 'affiliation-justificatifs', false, 5242880,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.attach_payout_proof(p_payout_id uuid, p_path text)
returns public.affiliate_payouts
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payout public.affiliate_payouts%rowtype;
begin
  if not public.has_permission('payouts.manage') then
    raise exception 'Permission payouts.manage requise.' using errcode = '42501';
  end if;
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Versement introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_payout.affiliate_id) then
    raise exception 'Vous ne pouvez pas agir sur votre propre versement.' using errcode = '42501';
  end if;
  if v_payout.status <> 'CONFIRME' then
    raise exception 'Un justificatif se rattache à un versement confirmé.' using errcode = 'check_violation';
  end if;
  if v_payout.proof_path is not null then
    raise exception 'Ce versement a déjà son justificatif : il ne se remplace pas.' using errcode = 'check_violation';
  end if;
  if p_path is null or p_path not like 'RVAF/' || p_payout_id::text || '/%' then
    raise exception 'Chemin de justificatif invalide.' using errcode = 'check_violation';
  end if;
  update public.affiliate_payouts set proof_path = p_path where id = p_payout_id returning * into v_payout;
  perform public.affiliation_log(v_payout.affiliate_id, null, 'JUSTIFICATIF_RATTACHE',
    format('Justificatif rattaché au versement %s', v_payout.reference), null, jsonb_build_object('versement', v_payout.reference));
  return v_payout;
end;
$fn$;

revoke execute on function public.attach_payout_proof(uuid, text) from public, anon;
grant  execute on function public.attach_payout_proof(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. CE QUI EST À VERSER
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_payable_overview()
returns table (
  affiliate_id        uuid,
  display_name        text,
  reference           text,
  status              text,
  commissions         integer,
  acquired            numeric,
  adjustments         numeric,
  payable             numeric,
  min_amount          numeric,
  frequency           text,
  next_date           date,
  draft_id            uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.has_permission('payouts.view') then
    raise exception 'Permission payouts.view requise.' using errcode = '42501';
  end if;
  return query
    with acq as (
      select c.affiliate_id, count(*)::int as n, sum(public.affiliate_commission_net(c.id)) as amount
        from public.affiliate_commissions c where c.status = 'ACQUISE' group by c.affiliate_id
    ), adj as (
      select a.affiliate_id, sum(a.amount) as amount
        from public.affiliate_commission_adjustments a
        left join public.affiliate_commissions c on c.id = a.commission_id
       where a.status = 'A_IMPUTER' and (a.commission_id is null or c.status = 'VERSEE')
       group by a.affiliate_id
    )
    select f.id, f.display_name, f.reference, f.status,
           coalesce(acq.n, 0), coalesce(acq.amount, 0), coalesce(adj.amount, 0),
           coalesce(acq.amount, 0) + coalesce(adj.amount, 0),
           t.payout_min_amount, t.payout_frequency,
           public.affiliate_next_payout_date(t.payout_frequency, (now() at time zone 'Indian/Comoro')::date),
           (select p.id from public.affiliate_payouts p where p.affiliate_id = f.id and p.status = 'BROUILLON')
      from public.affiliates f
      left join acq on acq.affiliate_id = f.id
      left join adj on adj.affiliate_id = f.id
      cross join lateral public.affiliate_effective_terms(f.id) t
     where acq.n is not null or adj.amount is not null
        or exists (select 1 from public.affiliate_payouts p where p.affiliate_id = f.id and p.status = 'BROUILLON')
     order by f.display_name;
end;
$fn$;

revoke execute on function public.affiliate_payable_overview() from public, anon;
grant  execute on function public.affiliate_payable_overview() to authenticated, service_role;


-- Totaux d'un affilié : « versé » se lit désormais dans les versements
-- confirmés — commissions et ajustements imputés compris.
create or replace function public.affiliate_commission_totals(p_affiliate_id uuid)
returns table (
  forecast     numeric,
  acquired     numeric,
  to_pay       numeric,
  paid         numeric,
  cancelled    numeric,
  adjustments_pending numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.affiliate_is_caller(p_affiliate_id) or public.has_permission('commissions.view')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    select
      coalesce((select sum(c.amount) from public.affiliate_commissions c
                 where c.affiliate_id = p_affiliate_id and c.status = 'PREVISIONNELLE'), 0),
      coalesce((select sum(public.affiliate_commission_net(c.id)) from public.affiliate_commissions c
                 where c.affiliate_id = p_affiliate_id and c.status = 'ACQUISE'), 0),
      coalesce((select sum(p.total_amount) from public.affiliate_payouts p
                 where p.affiliate_id = p_affiliate_id and p.status = 'BROUILLON'), 0),
      coalesce((select sum(p.total_amount) from public.affiliate_payouts p
                 where p.affiliate_id = p_affiliate_id and p.status = 'CONFIRME'), 0),
      coalesce((select sum(c.amount) from public.affiliate_commissions c
                 where c.affiliate_id = p_affiliate_id and c.status = 'ANNULEE'), 0),
      coalesce((select sum(a.amount) from public.affiliate_commission_adjustments a
                  left join public.affiliate_commissions c on c.id = a.commission_id
                 where a.affiliate_id = p_affiliate_id and a.status = 'A_IMPUTER'
                   and (a.commission_id is null or c.status = 'VERSEE')), 0);
end;
$fn$;


-- -----------------------------------------------------------------------------
-- 7. ANNULATION APRÈS VERSEMENT — qualification exacte
--
-- En 4H-5, `cancel_commission` qualifiait de « correction » l'ajustement
-- négatif d'une commission déjà versée. Le montant était juste ; la nature
-- ne l'était pas. Elle devient « annulation après versement ». La sortie
-- d'une commission « à verser » recalcule aussi le total de son brouillon.
-- -----------------------------------------------------------------------------

create or replace function public.cancel_commission(p_commission_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c public.affiliate_commissions%rowtype;
begin
  if not public.has_permission('commissions.manage') then
    raise exception 'Permission commissions.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Une annulation se motive.' using errcode = 'check_violation';
  end if;
  select * into v_c from public.affiliate_commissions where id = p_commission_id;
  if not found then
    raise exception 'Commission introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_c.affiliate_id) then
    raise exception 'Vous ne pouvez pas agir sur votre propre commission.' using errcode = '42501';
  end if;
  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  perform public.affiliate_commission_withdraw(p_commission_id, btrim(p_reason),
    case when v_c.status = 'VERSEE' then 'ANNULATION_APRES_VERSEMENT' else 'CORRECTION' end);
end;
$fn$;

create or replace function public.affiliate_commission_withdraw(p_commission_id uuid, p_reason text, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c     public.affiliate_commissions%rowtype;
  v_net   numeric;
  v_total numeric;
begin
  select * into v_c from public.affiliate_commissions where id = p_commission_id for update;
  if not found or v_c.status = 'ANNULEE' then
    return;
  end if;
  if v_c.status = 'A_VERSER' then
    -- Sortie du versement en préparation (avec ses ajustements), puis annulation.
    delete from public.affiliate_payout_items i
     using public.affiliate_commission_adjustments a
     where i.payout_id = v_c.payout_id and i.adjustment_id = a.id and a.commission_id = v_c.id;
    delete from public.affiliate_payout_items where commission_id = v_c.id;
    select coalesce(sum(amount), 0) into v_total from public.affiliate_payout_items where payout_id = v_c.payout_id;
    update public.affiliate_payouts set total_amount = greatest(v_total, 0) where id = v_c.payout_id;
    update public.affiliate_commissions set status = 'ACQUISE', payout_id = null where id = v_c.id;
    v_c.status := 'ACQUISE';
  end if;
  if v_c.status in ('PREVISIONNELLE', 'ACQUISE') then
    update public.affiliate_commissions
       set status = 'ANNULEE', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(p_reason, 1000)
     where id = v_c.id;
    perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_ANNULEE',
      format('Commission %s annulée : %s', v_c.reference, p_reason), null, jsonb_build_object('commission', v_c.reference));
    return;
  end if;
  -- VERSÉE : le versement passé reste intact ; on corrige pour la suite (H).
  v_net := public.affiliate_commission_net(v_c.id);
  if v_net > 0 then
    insert into public.affiliate_commission_adjustments (affiliate_id, commission_id, kind, amount, reason, created_by, created_by_label)
    values (v_c.affiliate_id, v_c.id, p_kind, -v_net, left(p_reason, 1000), auth.uid(), public.relation_actor_label());
    perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_ANNULEE_APRES_VERSEMENT',
      format('Commission versée %s annulée : %s KMF imputés sur les versements suivants', v_c.reference, -v_net), null,
      jsonb_build_object('commission', v_c.reference, 'ajustement', -v_net, 'nature', p_kind));
  end if;
end;
$fn$;

revoke execute on function public.affiliate_commission_withdraw(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.affiliate_commission_withdraw(uuid, text, text) to service_role;

-- Le remboursement d'une commande dont la commission est déjà versée
-- (décision H) produit, lui, un ajustement « remboursement » : inchangé.


-- -----------------------------------------------------------------------------
-- 8. PRIVILÈGES
-- -----------------------------------------------------------------------------

-- L'affilié ne voit que ses versements confirmés (politique de 4H-5) ; il n'en
-- voit ni le justificatif ni la note interne.
revoke select on public.affiliate_payouts from authenticated;
grant select (id, affiliate_id, status, reference, document_id, period_label, total_amount, currency,
              method_code, method_snapshot, transaction_reference, prepared_at, confirmed_at,
              cancelled_at, created_at, updated_at)
  on public.affiliate_payouts to authenticated;

-- L'administration lit tout sous payouts.view, par une fonction dédiée.
create or replace function public.affiliate_payout_internal(p_payout_id uuid)
returns table (note text, proof_path text, prepared_by uuid, confirmed_by uuid, cancelled_by uuid, cancel_reason text, payout_account_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.has_permission('payouts.view') then
    raise exception 'Permission payouts.view requise.' using errcode = '42501';
  end if;
  return query select p.note, p.proof_path, p.prepared_by, p.confirmed_by, p.cancelled_by, p.cancel_reason, p.payout_account_id
                 from public.affiliate_payouts p where p.id = p_payout_id;
end;
$fn$;

revoke execute on function public.affiliate_payout_internal(uuid) from public, anon;
grant  execute on function public.affiliate_payout_internal(uuid) to authenticated, service_role;
