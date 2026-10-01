-- =============================================================================
-- PHASE 4H-5 — AFFILIATION : COMMISSIONS, INSTANTANÉS, AJUSTEMENTS
--
-- Ce que cette migration pose :
--
--   1. le calcul d'une commande, ligne par ligne : règle applicable à la date
--      de l'affaire, éligibilité de l'offre, plafond de l'offre sauf
--      dérogation contractuelle (N1) — l'instantané complet de chaque règle
--      est conservé ;
--   2. les commissions : PRÉVISIONNELLE → ACQUISE → À VERSER → VERSÉE, ou
--      ANNULÉE, avec leur référence officielle MORA-COMAF (D-2, N2) ;
--   3. les ajustements, qui corrigent sans jamais réécrire (G, H) ;
--   4. les déclencheurs qui font vivre la commission avec la commande et son
--      attribution ;
--   5. les actes de l'administration : validation manuelle, annulation,
--      ajustement motivé ;
--   6. une file d'événements de notification, préparée pour la phase 4J.
--
-- ## Les décisions appliquées
--
--   * L : une commission devient ACQUISE quand l'affaire est intégralement
--     payée (défaut) — ou au premier paiement, ou sur validation manuelle,
--     selon les paramètres de l'affilié, figés dans la commission.
--   * G : un remboursement avant versement recalcule la commission sur le
--     montant réellement conservé, par un AJUSTEMENT ; la commission initiale
--     n'est jamais réécrite.
--   * H : un remboursement après versement crée un ajustement négatif, imputé
--     sur les versements suivants ; le versement passé reste intact.
--   * M : une commission acquise n'expire pas.
--   * Aucun recalcul rétroactif : la règle d'une commission est celle en
--     vigueur à la date de l'affaire, et son instantané ne bouge plus.
--     Tant qu'elle est PRÉVISIONNELLE, son montant suit la commande (une
--     remise appliquée, une ligne corrigée) ; ACQUISE, elle est figée.
--
-- ## Ce qui n'est pas commissionnable
--
-- Une ligne sans offre du catalogue : l'éligibilité de l'offre (N1) ne
-- pourrait pas être vérifiée. Une ligne d'offre non éligible, ou exclue par
-- la règle. Une commande sans aucune ligne commissionnable ne crée pas de
-- commission : l'historique de l'affilié le consigne.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LE CALCUL D'UNE COMMANDE
-- -----------------------------------------------------------------------------

-- Lignes d'une commande, calculées pour un affilié. Rend le détail complet,
-- prêt à être figé dans la commission.
create or replace function public.affiliate_order_lines(p_affiliate_id uuid, p_order_id uuid, p_ratio numeric default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order   public.orders%rowtype;
  v_item    record;
  v_rule    public.affiliate_rules%rowtype;
  v_res     record;
  v_offer   record;
  v_calc    record;
  v_cap     numeric;
  v_rate    numeric;
  v_tier    integer;
  v_raw     numeric;
  v_amt     numeric;
  v_minap   boolean;
  v_maxap   boolean;
  v_capap   boolean;
  v_lines   jsonb := '[]'::jsonb;
  v_base    numeric;
  v_reason  text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return v_lines;
  end if;

  for v_item in
    select oi.id, oi.designation, oi.service_id, oi.product_id, oi.line_total
      from public.order_items oi
     where oi.order_id = p_order_id
     order by oi.position, oi.id
  loop
    v_base := round(greatest(v_item.line_total, 0) * p_ratio, 2);
    v_reason := null;
    v_cap := null;
    v_rate := null; v_tier := null; v_raw := 0; v_amt := 0;
    v_minap := false; v_maxap := false; v_capap := false;

    if v_item.service_id is null and v_item.product_id is null then
      v_reason := 'OFFRE_ABSENTE';
    else
      if v_item.service_id is not null then
        select affiliate_eligible as eligible, affiliate_max_rate as max_rate into v_offer from public.services where id = v_item.service_id;
      else
        select affiliate_eligible as eligible, affiliate_max_rate as max_rate into v_offer from public.products where id = v_item.product_id;
      end if;
      if not coalesce(v_offer.eligible, false) or v_offer.max_rate is null then
        v_reason := 'OFFRE_NON_ELIGIBLE';
      end if;
    end if;

    select r.rule_id, r.origin into v_res
      from public.affiliate_resolve_rule(p_affiliate_id, v_item.service_id, v_item.product_id, v_order.created_at) r;
    if v_res.rule_id is null and v_reason is null then
      v_reason := 'AUCUNE_REGLE';
    end if;

    if v_reason is null then
      select * into v_rule from public.affiliate_rules where id = v_res.rule_id;
      -- N1 : plafond de l'offre, sauf dérogation contractuelle individuelle.
      v_cap := case when v_rule.contractual_derogation and v_rule.owner_type = 'AFFILIATE' then null else v_offer.max_rate end;
      select * into v_calc from public.affiliate_compute(
        v_rule.kind, v_rule.rate, v_rule.fixed_amount, v_rule.tiers, v_rule.min_commission,
        v_rule.max_commission, v_rule.min_base, v_base, v_cap);
      v_rate := v_calc.applied_rate; v_tier := v_calc.tier_index; v_raw := coalesce(v_calc.raw_amount, 0);
      v_minap := coalesce(v_calc.min_applied, false); v_maxap := coalesce(v_calc.max_applied, false);
      v_capap := coalesce(v_calc.cap_applied, false);
      if v_calc.eligible then
        v_amt := v_calc.amount;
      else
        v_reason := v_calc.reason;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'item', v_item.id,
      'designation', v_item.designation,
      'offerType', case when v_item.service_id is not null then 'SERVICE' when v_item.product_id is not null then 'PRODUCT' end,
      'offerId', coalesce(v_item.service_id, v_item.product_id),
      'base', v_base,
      'eligible', v_reason is null,
      'reason', coalesce(v_reason, 'OK'),
      'capRate', v_cap,
      'rate', v_rate,
      'tierIndex', v_tier,
      'raw', v_raw,
      'amount', case when v_reason is null then v_amt else 0 end,
      'minApplied', v_minap,
      'maxApplied', v_maxap,
      'capApplied', v_capap,
      'rule', case when v_res.rule_id is not null then public.affiliate_rule_snapshot(v_res.rule_id, v_res.origin) end
    ));
  end loop;
  return v_lines;
end;
$fn$;

comment on function public.affiliate_order_lines(uuid, uuid, numeric) is
  'Calcul ligne par ligne d''une commande pour un affilié : règle à la date de l''affaire, éligibilité et plafond de l''offre, instantané complet. p_ratio réduit l''assiette (montant conservé après remboursement).';

revoke execute on function public.affiliate_order_lines(uuid, uuid, numeric) from public, anon, authenticated;
grant  execute on function public.affiliate_order_lines(uuid, uuid, numeric) to service_role;

-- Total d'un détail de lignes.
create or replace function public.affiliate_lines_total(p_lines jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(sum((l ->> 'amount')::numeric), 0) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
$$;

create or replace function public.affiliate_lines_base(p_lines jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(sum((l ->> 'base')::numeric), 0) from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
   where (l ->> 'eligible')::boolean;
$$;


-- -----------------------------------------------------------------------------
-- 2. LES COMMISSIONS
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_commissions (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  affiliate_id        uuid not null references public.affiliates (id) on delete restrict,
  attribution_id      uuid not null references public.affiliate_attributions (id) on delete restrict,
  order_id            uuid not null references public.orders (id) on delete restrict,
  -- Instantanés : la commande, telle qu'elle était, sans donnée de client.
  order_reference     text not null,
  order_date          timestamptz not null,
  status              text not null default 'PREVISIONNELLE',
  base_amount         numeric(12, 2) not null,
  amount              numeric(12, 2) not null,
  currency            text not null default 'KMF',
  lines               jsonb not null,
  acquisition_trigger text not null,
  computed_at         timestamptz not null default now(),
  acquired_at         timestamptz,
  acquired_by         uuid references public.profiles (id) on delete set null,
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id) on delete set null,
  cancel_reason       text,
  payout_id           uuid,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint affiliate_commissions_reference check (reference ~ '^MORA-COMAF-[A-Z]+[0-9]{4}$'),
  constraint affiliate_commissions_status check (status in ('PREVISIONNELLE', 'ACQUISE', 'A_VERSER', 'VERSEE', 'ANNULEE')),
  constraint affiliate_commissions_amounts check (base_amount >= 0 and amount >= 0),
  constraint affiliate_commissions_lines check (jsonb_typeof(lines) = 'array'),
  constraint affiliate_commissions_trigger check (acquisition_trigger in ('PAIEMENT_INTEGRAL', 'PREMIER_PAIEMENT', 'VALIDATION_MANUELLE')),
  constraint affiliate_commissions_acquired check (status not in ('ACQUISE', 'A_VERSER', 'VERSEE') or acquired_at is not null),
  constraint affiliate_commissions_cancelled check (status <> 'ANNULEE' or (cancelled_at is not null and cancel_reason is not null)),
  constraint affiliate_commissions_paid check (status <> 'VERSEE' or (paid_at is not null and payout_id is not null))
);

comment on table public.affiliate_commissions is
  'Commissions d''affiliation. Instantané complet des règles appliquées ; montant figé à l''acquisition ; jamais supprimées ni réécrites — corrigées par ajustement.';

-- Une seule commission vivante par commande : une même affaire ne se paie pas deux fois.
create unique index if not exists affiliate_commissions_one_per_order
  on public.affiliate_commissions (order_id) where status <> 'ANNULEE';
create index if not exists affiliate_commissions_affiliate_idx on public.affiliate_commissions (affiliate_id, status, created_at desc);

drop trigger if exists affiliate_commissions_set_updated_at on public.affiliate_commissions;
create trigger affiliate_commissions_set_updated_at
  before update on public.affiliate_commissions
  for each row execute function public.set_updated_at();

create or replace function public.affiliate_commission_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('PREVISIONNELLE', 'ACQUISE'),
    ('PREVISIONNELLE', 'ANNULEE'),
    ('ACQUISE',        'A_VERSER'),
    ('ACQUISE',        'ANNULEE'),
    ('A_VERSER',       'ACQUISE'),
    ('A_VERSER',       'VERSEE')
  );
$$;

-- Le garde : graphe des statuts, montant figé dès l'acquisition, rien de ce
-- qui identifie la commission ne bouge. Il vaut pour tous les rôles.
create or replace function public.tg_affiliate_commissions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une commission ne se supprime pas : elle s''annule ou s''ajuste.' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not public.affiliate_commission_transition_ok(old.status, new.status) then
    raise exception 'Transition de commission interdite : % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  if (new.reference, new.affiliate_id, new.attribution_id, new.order_id, new.order_reference, new.order_date,
      new.acquisition_trigger, new.created_at)
     is distinct from
     (old.reference, old.affiliate_id, old.attribution_id, old.order_id, old.order_reference, old.order_date,
      old.acquisition_trigger, old.created_at) then
    raise exception 'L''identité d''une commission ne change pas.' using errcode = 'check_violation';
  end if;
  -- Montant et instantané ne suivent la commande que tant qu'elle est prévisionnelle.
  if old.status <> 'PREVISIONNELLE'
     and (new.base_amount, new.amount, new.lines) is distinct from (old.base_amount, old.amount, old.lines) then
    raise exception 'Une commission acquise est figée : corrigez-la par un ajustement.' using errcode = 'check_violation';
  end if;
  if old.status = 'VERSEE' then
    raise exception 'Une commission versée ne se modifie plus.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_commissions_guard on public.affiliate_commissions;
create trigger affiliate_commissions_guard
  before update or delete on public.affiliate_commissions
  for each row execute function public.tg_affiliate_commissions_guard();


-- -----------------------------------------------------------------------------
-- 3. LES AJUSTEMENTS
--
-- Une correction ne réécrit rien : elle s'ajoute. Elle porte sur une
-- commission, ou sur l'affilié seul (correction de versement). Elle est
-- « à imputer » jusqu'au versement qui l'intègre (lot 4H-6), puis « imputée ».
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_commission_adjustments (
  id             uuid primary key default gen_random_uuid(),
  affiliate_id   uuid not null references public.affiliates (id) on delete restrict,
  commission_id  uuid references public.affiliate_commissions (id) on delete restrict,
  kind           text not null,
  amount         numeric(12, 2) not null,
  reason         text not null,
  status         text not null default 'A_IMPUTER',
  payout_id      uuid,
  created_by     uuid references public.profiles (id) on delete set null,
  created_by_label text,
  created_at     timestamptz not null default now(),
  imputed_at     timestamptz,
  constraint affiliate_adjustments_kind check (kind in ('REMBOURSEMENT', 'ANNULATION_APRES_VERSEMENT', 'CORRECTION', 'REATTRIBUTION')),
  constraint affiliate_adjustments_amount check (amount <> 0),
  constraint affiliate_adjustments_reason check (btrim(reason) <> '' and length(reason) <= 1000),
  constraint affiliate_adjustments_status check (status in ('A_IMPUTER', 'IMPUTE')),
  constraint affiliate_adjustments_imputed check (status <> 'IMPUTE' or (payout_id is not null and imputed_at is not null))
);

comment on table public.affiliate_commission_adjustments is
  'Ajustements de commissions : positifs ou négatifs, motivés, jamais supprimés. Imputés sur un versement (4H-6).';

create index if not exists affiliate_adjustments_affiliate_idx on public.affiliate_commission_adjustments (affiliate_id, status, created_at desc);
create index if not exists affiliate_adjustments_commission_idx on public.affiliate_commission_adjustments (commission_id);

create or replace function public.tg_affiliate_adjustments_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un ajustement ne se supprime pas : compensez-le par un autre.' using errcode = 'check_violation';
  end if;
  if (new.affiliate_id, new.commission_id, new.kind, new.amount, new.reason, new.created_at)
     is distinct from (old.affiliate_id, old.commission_id, old.kind, old.amount, old.reason, old.created_at)
     or (old.status = 'IMPUTE' and new.status is distinct from old.status) then
    raise exception 'Un ajustement est figé.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_adjustments_guard on public.affiliate_commission_adjustments;
create trigger affiliate_adjustments_guard
  before update or delete on public.affiliate_commission_adjustments
  for each row execute function public.tg_affiliate_adjustments_guard();

-- Montant net d'une commission : initial + ajustements.
create or replace function public.affiliate_commission_net(p_commission_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.amount + coalesce((select sum(a.amount) from public.affiliate_commission_adjustments a where a.commission_id = c.id), 0)
    from public.affiliate_commissions c where c.id = p_commission_id;
$$;

revoke execute on function public.affiliate_commission_net(uuid) from public, anon;
grant  execute on function public.affiliate_commission_net(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. FILE D'ÉVÉNEMENTS DE NOTIFICATION — préparée pour la phase 4J
--
-- Les commissions changent d'état au fil des paiements, c'est-à-dire dans
-- des transactions de la base. L'envoi d'un e-mail, lui, est l'affaire du
-- serveur. Cette file relie les deux sans rien envoyer : la phase 4J la
-- traitera (regroupement, préférences, anti-spam). En 4H, seuls les e-mails
-- de versement partent directement, depuis l'acte qui les motive.
-- -----------------------------------------------------------------------------

create table if not exists public.notification_events (
  id            bigint generated always as identity primary key,
  event_type    text not null,
  recipient_id  uuid references auth.users (id) on delete cascade,
  entity_type   text not null,
  entity_id     uuid not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'EN_ATTENTE',
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  constraint notification_events_type check (event_type ~ '^[a-z][a-z0-9_.]{2,80}$'),
  constraint notification_events_status check (status in ('EN_ATTENTE', 'TRAITE', 'IGNORE')),
  constraint notification_events_payload check (jsonb_typeof(payload) = 'object')
);

comment on table public.notification_events is
  'Événements à notifier, préparés pour la phase 4J. Écrits par la base, traités par le serveur. Aucun envoi automatique en 4H.';

create index if not exists notification_events_pending_idx on public.notification_events (status, created_at);

create or replace function public.affiliation_notify(p_affiliate_id uuid, p_event text, p_entity_type text, p_entity_id uuid, p_payload jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.affiliates where id = p_affiliate_id;
  if v_user is null then
    return;
  end if;
  insert into public.notification_events (event_type, recipient_id, entity_type, entity_id, payload)
  values (p_event, v_user, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb));
end;
$$;

revoke execute on function public.affiliation_notify(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.affiliation_notify(uuid, text, text, uuid, jsonb) to service_role;


-- -----------------------------------------------------------------------------
-- 5. LA VIE D'UNE COMMISSION
-- -----------------------------------------------------------------------------

-- Crée la commission d'une attribution de commande, si l'affaire est
-- commissionnable. Idempotent : une commande n'a qu'une commission vivante.
create or replace function public.affiliate_create_commission(p_attribution_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_at      public.affiliate_attributions%rowtype;
  v_order   public.orders%rowtype;
  v_lines   jsonb;
  v_amount  numeric;
  v_trigger text;
  v_ref     text;
  v_id      uuid;
begin
  select * into v_at from public.affiliate_attributions where id = p_attribution_id;
  if not found or v_at.order_id is null or v_at.status not in ('ACTIVE', 'VALIDEE') then
    return null;
  end if;
  select * into v_order from public.orders where id = v_at.order_id;
  if v_order.status = 'ANNULEE' then
    return null;
  end if;
  select id into v_id from public.affiliate_commissions where order_id = v_at.order_id and status <> 'ANNULEE';
  if v_id is not null then
    return v_id;
  end if;

  v_lines := public.affiliate_order_lines(v_at.affiliate_id, v_at.order_id);
  v_amount := public.affiliate_lines_total(v_lines);
  -- Rien de commissionnable (encore) : les lignes d'une commande arrivent
  -- après elle ; le déclencheur des lignes rappellera cette fonction.
  if v_amount <= 0 then
    return null;
  end if;

  select t.acquisition_trigger into v_trigger from public.affiliate_effective_terms(v_at.affiliate_id) t;
  select a.reference into v_ref from public.allocate_document_number('COMAF') a;

  insert into public.affiliate_commissions
    (reference, affiliate_id, attribution_id, order_id, order_reference, order_date,
     base_amount, amount, lines, acquisition_trigger)
  values
    (v_ref, v_at.affiliate_id, v_at.id, v_at.order_id, v_order.reference, v_order.created_at,
     public.affiliate_lines_base(v_lines), v_amount, v_lines, coalesce(v_trigger, 'PAIEMENT_INTEGRAL'))
  returning id into v_id;

  perform public.affiliation_log(v_at.affiliate_id, null, 'COMMISSION_PREVISIONNELLE',
    format('Commission %s prévisionnelle sur la commande %s : %s KMF', v_ref, v_order.reference, v_amount),
    null, jsonb_build_object('commission', v_ref, 'montant', v_amount));

  -- La commande peut déjà remplir la condition (attribution posée après paiement).
  perform public.affiliate_commission_check_acquisition(v_id);
  return v_id;
end;
$fn$;

revoke execute on function public.affiliate_create_commission(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_create_commission(uuid) to service_role;


-- Acquisition : la condition figée dans la commission est-elle remplie ?
create or replace function public.affiliate_commission_check_acquisition(p_commission_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c     public.affiliate_commissions%rowtype;
  v_order public.orders%rowtype;
  v_lines jsonb;
  v_ok    boolean;
begin
  select * into v_c from public.affiliate_commissions where id = p_commission_id for update;
  if not found or v_c.status <> 'PREVISIONNELLE' then
    return;
  end if;
  select * into v_order from public.orders where id = v_c.order_id;
  v_ok := case v_c.acquisition_trigger
            when 'PAIEMENT_INTEGRAL' then v_order.total_amount > 0 and v_order.paid_amount >= v_order.total_amount
                                          and v_order.refunded_amount = 0
            when 'PREMIER_PAIEMENT'  then v_order.paid_amount > 0 and v_order.refunded_amount = 0
            else false
          end;
  if not v_ok then
    return;
  end if;

  -- Dernier calcul sur la commande définitive, puis la commission se fige.
  v_lines := public.affiliate_order_lines(v_c.affiliate_id, v_c.order_id);
  update public.affiliate_commissions
     set lines = v_lines, base_amount = public.affiliate_lines_base(v_lines),
         amount = public.affiliate_lines_total(v_lines), computed_at = now()
   where id = p_commission_id;
  if public.affiliate_lines_total(v_lines) <= 0 then
    update public.affiliate_commissions
       set status = 'ANNULEE', cancelled_at = now(), cancel_reason = 'Aucune ligne commissionnable dans la commande définitive'
     where id = p_commission_id;
    return;
  end if;
  update public.affiliate_commissions
     set status = 'ACQUISE', acquired_at = now()
   where id = p_commission_id
  returning * into v_c;

  perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_ACQUISE',
    format('Commission %s acquise : %s KMF', v_c.reference, v_c.amount), null,
    jsonb_build_object('commission', v_c.reference, 'montant', v_c.amount));
  perform public.affiliation_notify(v_c.affiliate_id, 'affiliation.commission.acquise', 'affiliate_commission', v_c.id,
    jsonb_build_object('reference', v_c.reference, 'montant', v_c.amount));
end;
$fn$;

revoke execute on function public.affiliate_commission_check_acquisition(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_commission_check_acquisition(uuid) to service_role;


-- Retirer une commission : annulée si rien n'est versé ; sinon, ajustement
-- négatif imputé sur les versements suivants (H). Jamais de réécriture.
create or replace function public.affiliate_commission_withdraw(p_commission_id uuid, p_reason text, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c   public.affiliate_commissions%rowtype;
  v_net numeric;
begin
  select * into v_c from public.affiliate_commissions where id = p_commission_id for update;
  if not found or v_c.status = 'ANNULEE' then
    return;
  end if;
  if v_c.status = 'A_VERSER' then
    -- Sortie du versement en préparation, puis annulation.
    delete from public.affiliate_payout_items where commission_id = v_c.id;
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
  -- VERSÉE : l'argent est parti, on corrige pour la suite.
  v_net := public.affiliate_commission_net(v_c.id);
  if v_net > 0 then
    insert into public.affiliate_commission_adjustments (affiliate_id, commission_id, kind, amount, reason, created_by, created_by_label)
    values (v_c.affiliate_id, v_c.id, p_kind, -v_net, left(p_reason, 1000), auth.uid(), public.relation_actor_label());
  end if;
end;
$fn$;

revoke execute on function public.affiliate_commission_withdraw(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.affiliate_commission_withdraw(uuid, text, text) to service_role;


-- Une attribution de commande naît : sa commission aussi.
create or replace function public.tg_affiliate_attributions_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.order_id is not null and new.status in ('ACTIVE', 'VALIDEE') then
      perform public.affiliate_create_commission(new.id);
    end if;
  elsif new.status in ('REMPLACEE', 'REVOQUEE') and old.status in ('ACTIVE', 'VALIDEE') and new.order_id is not null then
    for v_id in select id from public.affiliate_commissions where attribution_id = new.id and status <> 'ANNULEE' loop
      perform public.affiliate_commission_withdraw(v_id,
        coalesce(new.end_reason, 'Attribution retirée'),
        'REATTRIBUTION');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_attributions_commission on public.affiliate_attributions;
create trigger affiliate_attributions_commission
  after insert or update on public.affiliate_attributions
  for each row execute function public.tg_affiliate_attributions_commission();


-- La commande change : prévision, acquisition, annulation, remboursement.
create or replace function public.tg_orders_affiliate_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c       public.affiliate_commissions%rowtype;
  v_lines   jsonb;
  v_ratio   numeric;
  v_target  numeric;
  v_net     numeric;
begin
  for v_c in select * from public.affiliate_commissions where order_id = new.id and status <> 'ANNULEE' loop
    -- Annulation de la commande.
    if new.status = 'ANNULEE' and old.status is distinct from 'ANNULEE' then
      perform public.affiliate_commission_withdraw(v_c.id, coalesce(new.cancel_reason, 'Commande annulée'), 'ANNULATION_APRES_VERSEMENT');
      continue;
    end if;

    -- Remboursement (G, H) : recalcul sur le montant réellement conservé.
    if new.refunded_amount > old.refunded_amount and v_c.status <> 'PREVISIONNELLE' then
      v_ratio := case when new.paid_amount > 0
                      then greatest(new.paid_amount - new.refunded_amount, 0) / new.paid_amount else 0 end;
      v_target := public.affiliate_lines_total(public.affiliate_commission_scaled_lines(v_c.lines, v_ratio));
      v_net := public.affiliate_commission_net(v_c.id);
      if v_target - v_net <> 0 then
        insert into public.affiliate_commission_adjustments (affiliate_id, commission_id, kind, amount, reason)
        values (v_c.affiliate_id, v_c.id, 'REMBOURSEMENT', v_target - v_net,
                format('Remboursement de %s KMF sur la commande %s : commission recalculée sur %s KMF conservés',
                       new.refunded_amount - old.refunded_amount, new.reference, greatest(new.paid_amount - new.refunded_amount, 0)));
        perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_AJUSTEE',
          format('Commission %s ajustée après remboursement : %s KMF', v_c.reference, v_target - v_net), null,
          jsonb_build_object('commission', v_c.reference, 'ajustement', v_target - v_net));
        perform public.affiliation_notify(v_c.affiliate_id, 'affiliation.commission.ajustee', 'affiliate_commission', v_c.id,
          jsonb_build_object('reference', v_c.reference, 'ajustement', v_target - v_net));
      end if;
      continue;
    end if;

    -- Tant qu'elle est prévisionnelle, la commission suit la commande.
    if v_c.status = 'PREVISIONNELLE'
       and (new.total_amount, new.subtotal_amount, new.discount_amount, new.refunded_amount)
           is distinct from (old.total_amount, old.subtotal_amount, old.discount_amount, old.refunded_amount) then
      perform public.affiliate_refresh_order_commission(new.id);
    end if;

    if (new.paid_amount, new.settlement_status) is distinct from (old.paid_amount, old.settlement_status) then
      perform public.affiliate_commission_check_acquisition(v_c.id);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists orders_affiliate_commission on public.orders;
create trigger orders_affiliate_commission
  after update on public.orders
  for each row execute function public.tg_orders_affiliate_commission();


-- Les lignes de la commande changent : la commission naît (si l'attribution
-- précède les lignes) ou suit, tant qu'elle est prévisionnelle.
create or replace function public.affiliate_refresh_order_commission(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c     public.affiliate_commissions%rowtype;
  v_at    uuid;
  v_order public.orders%rowtype;
  v_lines jsonb;
begin
  select * into v_c from public.affiliate_commissions where order_id = p_order_id and status <> 'ANNULEE';
  if not found then
    select id into v_at from public.affiliate_attributions
     where order_id = p_order_id and status in ('ACTIVE', 'VALIDEE');
    if v_at is not null then
      perform public.affiliate_create_commission(v_at);
    end if;
    return;
  end if;
  if v_c.status <> 'PREVISIONNELLE' then
    return;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  v_lines := public.affiliate_order_lines(v_c.affiliate_id, p_order_id,
    case when v_order.paid_amount > 0 and v_order.refunded_amount > 0
         then greatest(v_order.paid_amount - v_order.refunded_amount, 0) / v_order.paid_amount else 1 end);
  update public.affiliate_commissions
     set lines = v_lines, base_amount = public.affiliate_lines_base(v_lines),
         amount = public.affiliate_lines_total(v_lines), computed_at = now()
   where id = v_c.id;
end;
$fn$;

revoke execute on function public.affiliate_refresh_order_commission(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_refresh_order_commission(uuid) to service_role;

create or replace function public.tg_order_items_affiliate_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.affiliate_refresh_order_commission(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;

drop trigger if exists order_items_affiliate_commission on public.order_items;
create trigger order_items_affiliate_commission
  after insert or update or delete on public.order_items
  for each row execute function public.tg_order_items_affiliate_commission();


-- Recalcule les lignes figées d'une commission sur une assiette réduite, avec
-- leurs propres instantanés de règle — jamais avec la règle actuelle.
create or replace function public.affiliate_commission_scaled_lines(p_lines jsonb, p_ratio numeric)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_line  jsonb;
  v_rule  jsonb;
  v_base  numeric;
  v_calc  record;
  v_out   jsonb := '[]'::jsonb;
begin
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if not (v_line ->> 'eligible')::boolean then
      v_out := v_out || jsonb_build_array(v_line);
      continue;
    end if;
    v_rule := v_line -> 'rule';
    v_base := round((v_line ->> 'base')::numeric * p_ratio, 2);
    select * into v_calc from public.affiliate_compute(
      v_rule ->> 'kind', (v_rule ->> 'rate')::numeric, (v_rule ->> 'fixedAmount')::numeric,
      case when jsonb_array_length(coalesce(v_rule -> 'tiers', '[]'::jsonb)) > 0 then v_rule -> 'tiers' end,
      (v_rule ->> 'minCommission')::numeric, (v_rule ->> 'maxCommission')::numeric,
      (v_rule ->> 'minBase')::numeric, v_base, (v_line ->> 'capRate')::numeric);
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object('base', v_base,
      'amount', case when v_calc.eligible then v_calc.amount else 0 end));
  end loop;
  return v_out;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- 6. LES ACTES DE L'ADMINISTRATION
-- -----------------------------------------------------------------------------

-- Validation manuelle : pour une commission sous condition VALIDATION_MANUELLE,
-- ou exceptionnellement, avec motif.
create or replace function public.validate_commission(p_commission_id uuid, p_reason text)
returns public.affiliate_commissions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c public.affiliate_commissions%rowtype;
begin
  if not public.has_permission('commissions.validate') then
    raise exception 'Permission commissions.validate requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Une validation manuelle se motive.' using errcode = 'check_violation';
  end if;
  select * into v_c from public.affiliate_commissions where id = p_commission_id for update;
  if not found then
    raise exception 'Commission introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_c.affiliate_id) then
    raise exception 'Vous ne pouvez pas valider votre propre commission.' using errcode = '42501';
  end if;
  if v_c.status <> 'PREVISIONNELLE' then
    raise exception 'Seule une commission prévisionnelle se valide.' using errcode = 'check_violation';
  end if;
  update public.affiliate_commissions
     set status = 'ACQUISE', acquired_at = now(), acquired_by = auth.uid()
   where id = p_commission_id returning * into v_c;
  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_VALIDEE',
    format('Commission %s validée manuellement : %s KMF', v_c.reference, v_c.amount), null,
    jsonb_build_object('commission', v_c.reference));
  perform public.affiliation_notify(v_c.affiliate_id, 'affiliation.commission.acquise', 'affiliate_commission', v_c.id,
    jsonb_build_object('reference', v_c.reference, 'montant', v_c.amount));
  return v_c;
end;
$fn$;

revoke execute on function public.validate_commission(uuid, text) from public, anon;
grant  execute on function public.validate_commission(uuid, text) to authenticated, service_role;

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
  perform public.affiliate_commission_withdraw(p_commission_id, btrim(p_reason), 'CORRECTION');
end;
$fn$;

revoke execute on function public.cancel_commission(uuid, text) from public, anon;
grant  execute on function public.cancel_commission(uuid, text) to authenticated, service_role;

-- Ajustement manuel, positif ou négatif, toujours motivé.
create or replace function public.adjust_commission(
  p_affiliate_id  uuid,
  p_commission_id uuid,
  p_amount        numeric,
  p_reason        text
)
returns public.affiliate_commission_adjustments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_commission_adjustments%rowtype;
  v_c   public.affiliate_commissions%rowtype;
begin
  if not public.has_permission('commissions.manage') then
    raise exception 'Permission commissions.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Un ajustement se motive.' using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Montant d''ajustement invalide.' using errcode = 'check_violation';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas ajuster vos propres commissions.' using errcode = '42501';
  end if;
  if p_commission_id is not null then
    select * into v_c from public.affiliate_commissions where id = p_commission_id and affiliate_id = p_affiliate_id;
    if not found then
      raise exception 'Commission introuvable pour cet affilié.' using errcode = 'no_data_found';
    end if;
    if v_c.status = 'ANNULEE' then
      raise exception 'Une commission annulée ne s''ajuste pas.' using errcode = 'check_violation';
    end if;
    if public.affiliate_commission_net(p_commission_id) + p_amount < 0 then
      raise exception 'L''ajustement rendrait la commission négative.' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.affiliate_commission_adjustments (affiliate_id, commission_id, kind, amount, reason, created_by, created_by_label)
  values (p_affiliate_id, p_commission_id, 'CORRECTION', p_amount, left(btrim(p_reason), 1000), auth.uid(), public.relation_actor_label())
  returning * into v_row;
  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);
  perform public.affiliation_log(p_affiliate_id, null, 'AJUSTEMENT',
    format('Ajustement de %s KMF', p_amount), null, jsonb_build_object('ajustement', v_row.id, 'commission', v_c.reference));
  return v_row;
end;
$fn$;

revoke execute on function public.adjust_commission(uuid, uuid, numeric, text) from public, anon;
grant  execute on function public.adjust_commission(uuid, uuid, numeric, text) to authenticated, service_role;


-- Totaux d'un affilié, par état : l'affilié pour lui-même, l'administration
-- sous commissions.view. « Ajustements à imputer » est signé.
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
      coalesce(sum(c.amount) filter (where c.status = 'PREVISIONNELLE'), 0),
      coalesce(sum(public.affiliate_commission_net(c.id)) filter (where c.status = 'ACQUISE'), 0),
      coalesce(sum(public.affiliate_commission_net(c.id)) filter (where c.status = 'A_VERSER'), 0),
      coalesce(sum(c.amount) filter (where c.status = 'VERSEE'), 0),
      coalesce(sum(c.amount) filter (where c.status = 'ANNULEE'), 0),
      (select coalesce(sum(a.amount), 0) from public.affiliate_commission_adjustments a
        join public.affiliate_commissions c2 on c2.id = a.commission_id
        where a.affiliate_id = p_affiliate_id and a.status = 'A_IMPUTER' and c2.status = 'VERSEE')
      + (select coalesce(sum(a.amount), 0) from public.affiliate_commission_adjustments a
        where a.affiliate_id = p_affiliate_id and a.status = 'A_IMPUTER' and a.commission_id is null)
    from public.affiliate_commissions c
   where c.affiliate_id = p_affiliate_id;
end;
$fn$;

revoke execute on function public.affiliate_commission_totals(uuid) from public, anon;
grant  execute on function public.affiliate_commission_totals(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. LES VERSEMENTS — tables posées ici, actes au lot 4H-6
--
-- Les lignes de versement existent dès maintenant : une commission « à
-- verser » doit pouvoir sortir d'un versement en préparation si sa commande
-- est annulée. Un même élément ne figure que dans un seul versement.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_payouts (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates (id) on delete restrict,
  status           text not null default 'BROUILLON',
  reference        text unique,
  document_id      uuid references public.documents (id) on delete restrict,
  period_label     text,
  total_amount     numeric(12, 2) not null default 0,
  currency         text not null default 'KMF',
  method_code      text references public.payment_methods (code) on delete restrict,
  payout_account_id uuid references public.affiliate_payout_accounts (id) on delete restrict,
  method_snapshot  jsonb,
  transaction_reference text,
  proof_path       text,
  note             text,
  prepared_by      uuid references public.profiles (id) on delete set null,
  prepared_at      timestamptz not null default now(),
  confirmed_by     uuid references public.profiles (id) on delete set null,
  confirmed_at     timestamptz,
  cancelled_by     uuid references public.profiles (id) on delete set null,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint affiliate_payouts_status check (status in ('BROUILLON', 'CONFIRME', 'ANNULE')),
  constraint affiliate_payouts_reference check (reference is null or reference ~ '^MORA-RVAF-[A-Z]+[0-9]{4}$'),
  constraint affiliate_payouts_confirmed check (
    status <> 'CONFIRME' or (reference is not null and confirmed_at is not null and method_code is not null
                             and method_snapshot is not null and total_amount > 0)
  ),
  constraint affiliate_payouts_cancelled check (status <> 'ANNULE' or (cancelled_at is not null and cancel_reason is not null)),
  constraint affiliate_payouts_texts check (
    (period_label is null or length(period_label) <= 80)
    and (transaction_reference is null or length(transaction_reference) <= 120)
    and (note is null or length(note) <= 1000)
    and (cancel_reason is null or length(cancel_reason) <= 1000)
  ),
  constraint affiliate_payouts_proof_path check (
    proof_path is null or proof_path ~ '^RVAF/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|webp)$'
  )
);

-- Un seul versement en préparation par affilié : deux brouillons
-- concurrents se disputeraient les mêmes commissions.
create unique index if not exists affiliate_payouts_one_draft
  on public.affiliate_payouts (affiliate_id) where status = 'BROUILLON';
create index if not exists affiliate_payouts_affiliate_idx on public.affiliate_payouts (affiliate_id, created_at desc);

create table if not exists public.affiliate_payout_items (
  id             uuid primary key default gen_random_uuid(),
  payout_id      uuid not null references public.affiliate_payouts (id) on delete restrict,
  commission_id  uuid unique references public.affiliate_commissions (id) on delete restrict,
  adjustment_id  uuid unique references public.affiliate_commission_adjustments (id) on delete restrict,
  amount         numeric(12, 2) not null,
  snapshot       jsonb not null,
  created_at     timestamptz not null default now(),
  constraint affiliate_payout_items_one_target check (num_nonnulls(commission_id, adjustment_id) = 1),
  constraint affiliate_payout_items_snapshot check (jsonb_typeof(snapshot) = 'object')
);

comment on table public.affiliate_payout_items is
  'Éléments d''un versement : commissions et ajustements. Unicité par commission et par ajustement : un élément ne se verse jamais deux fois.';

create index if not exists affiliate_payout_items_payout_idx on public.affiliate_payout_items (payout_id);

alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_payout_fk;
alter table public.affiliate_commissions
  add constraint affiliate_commissions_payout_fk foreign key (payout_id) references public.affiliate_payouts (id) on delete restrict;
alter table public.affiliate_commission_adjustments
  drop constraint if exists affiliate_adjustments_payout_fk;
alter table public.affiliate_commission_adjustments
  add constraint affiliate_adjustments_payout_fk foreign key (payout_id) references public.affiliate_payouts (id) on delete restrict;


-- -----------------------------------------------------------------------------
-- 8. PRIVILÈGES ET RLS
-- -----------------------------------------------------------------------------

revoke all on public.affiliate_commissions            from anon, authenticated;
revoke all on public.affiliate_commission_adjustments from anon, authenticated;
revoke all on public.notification_events              from anon, authenticated;
revoke all on public.affiliate_payouts                from anon, authenticated;
revoke all on public.affiliate_payout_items           from anon, authenticated;

grant select on public.affiliate_commissions to authenticated;
grant select on public.affiliate_commission_adjustments to authenticated;
grant select on public.affiliate_payouts to authenticated;
grant select on public.affiliate_payout_items to authenticated;

grant all on public.affiliate_commissions, public.affiliate_commission_adjustments, public.notification_events,
             public.affiliate_payouts, public.affiliate_payout_items to service_role;

alter table public.affiliate_commissions            enable row level security;
alter table public.affiliate_commission_adjustments enable row level security;
alter table public.notification_events              enable row level security;
alter table public.affiliate_payouts                enable row level security;
alter table public.affiliate_payout_items           enable row level security;

-- La commission ne porte aucune donnée de client : l'affilié lit les siennes.
drop policy if exists affiliate_commissions_select on public.affiliate_commissions;
create policy affiliate_commissions_select
  on public.affiliate_commissions for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.has_permission('commissions.view'));

drop policy if exists affiliate_adjustments_select on public.affiliate_commission_adjustments;
create policy affiliate_adjustments_select
  on public.affiliate_commission_adjustments for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.has_permission('commissions.view'));

drop policy if exists notification_events_select on public.notification_events;
create policy notification_events_select
  on public.notification_events for select to authenticated
  using (public.has_permission('notifications.view'));

drop policy if exists affiliate_payouts_select on public.affiliate_payouts;
create policy affiliate_payouts_select
  on public.affiliate_payouts for select to authenticated
  using ((public.affiliate_is_caller(affiliate_id) and status = 'CONFIRME') or public.has_permission('payouts.view'));

drop policy if exists affiliate_payout_items_select on public.affiliate_payout_items;
create policy affiliate_payout_items_select
  on public.affiliate_payout_items for select to authenticated
  using (exists (select 1 from public.affiliate_payouts p
                  where p.id = affiliate_payout_items.payout_id
                    and ((public.affiliate_is_caller(p.affiliate_id) and p.status = 'CONFIRME')
                         or public.has_permission('payouts.view'))));
