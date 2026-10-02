-- =============================================================================
-- PHASE 4I-5 — EXCEPTION MINIMALE AU GEL DE 4H : ACCÈS PROPRIÉTAIRE AFFILIÉ
--
-- Autorisée par le propriétaire le 2 octobre 2026, strictement limitée à la
-- sécurité : un compte dont le **profil** est réellement suspendu (désactivé
-- ou supprimé) ne lit plus ses données privées d'affilié, même avec un jeton
-- encore valide. Aucune règle métier de 4H ne change — ni commissions, ni
-- règles, catégories, liens, codes, prospects, conversions, versements,
-- FIAF / RVAF, ni le design.
--
-- Deux principes :
--   * c'est le statut du **profil** qui compte, jamais le blocage de la
--     qualité CLIENT (4I-4) : un client bloqué garde son espace affilié ;
--   * aucune déduction nouvelle sur les statuts affiliés : les états 4H
--     (PREPARATION, ACTIF, SUSPENDU, TERMINE) et leurs gardes restent tels
--     quels.
--
-- `affiliate_is_caller` n'est PAS modifiée : 4H l'emploie aussi dans ses
-- gardes anti-auto-décision (un affilié ne décide jamais pour lui-même), qui
-- doivent continuer à reconnaître l'affilié quel que soit son statut. Les
-- lectures passent par un prédicat distinct.
--
-- Les politiques administratives ne changent pas.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PRÉDICATS
-- -----------------------------------------------------------------------------

create or replace function public.profile_owner_access_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIF' and p.deleted_at is null);
$$;

comment on function public.profile_owner_access_ok() is
  'Profil du compte connecté actif (ni suspendu, ni désactivé, ni supprimé). Accès propriétaire affilié (4I-5) ; ignore le blocage CLIENT.';

revoke execute on function public.profile_owner_access_ok() from public, anon;
grant  execute on function public.profile_owner_access_ok() to authenticated, service_role;

create or replace function public.affiliate_owner_access_ok(p_affiliate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.affiliate_is_caller(p_affiliate_id) and public.profile_owner_access_ok();
$$;

comment on function public.affiliate_owner_access_ok(uuid) is
  'L''affilié est le compte connecté ET son profil est actif. Pour les lectures propriétaire de 4H (4I-5) ; les gardes anti-auto-décision gardent affiliate_is_caller.';

revoke execute on function public.affiliate_owner_access_ok(uuid) from public, anon;
grant  execute on function public.affiliate_owner_access_ok(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. POLITIQUES DE LECTURE PROPRIÉTAIRE
--
-- Reprises à l'identique de 4H ; seule la branche propriétaire exige un
-- profil actif. Les branches administratives sont inchangées.
-- -----------------------------------------------------------------------------

drop policy if exists affiliates_select_own on public.affiliates;
create policy affiliates_select_own
  on public.affiliates for select to authenticated
  using (user_id = auth.uid() and (select public.profile_owner_access_ok()));

drop policy if exists affiliate_rules_select_own on public.affiliate_rules;
create policy affiliate_rules_select_own
  on public.affiliate_rules for select to authenticated
  using (
    (select public.profile_owner_access_ok())
    and exists (
      select 1 from public.affiliates a
       where a.user_id = auth.uid()
         and a.status <> 'PREPARATION'
         and (a.id = affiliate_rules.affiliate_id or a.category_id = affiliate_rules.category_id)
    )
  );

drop policy if exists affiliate_payout_accounts_select on public.affiliate_payout_accounts;
create policy affiliate_payout_accounts_select
  on public.affiliate_payout_accounts for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.has_permission('payouts.view'));

drop policy if exists affiliate_campaigns_select on public.affiliate_campaigns;
create policy affiliate_campaigns_select
  on public.affiliate_campaigns for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.can_view_affiliation());

drop policy if exists affiliate_codes_select on public.affiliate_codes;
create policy affiliate_codes_select
  on public.affiliate_codes for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.can_view_affiliation());

drop policy if exists affiliate_prospects_select on public.affiliate_prospects;
create policy affiliate_prospects_select
  on public.affiliate_prospects for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.can_view_affiliation());

drop policy if exists affiliate_commissions_select on public.affiliate_commissions;
create policy affiliate_commissions_select
  on public.affiliate_commissions for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.has_permission('commissions.view'));

drop policy if exists affiliate_adjustments_select on public.affiliate_commission_adjustments;
create policy affiliate_adjustments_select
  on public.affiliate_commission_adjustments for select to authenticated
  using (public.affiliate_owner_access_ok(affiliate_id) or public.has_permission('commissions.view'));

drop policy if exists affiliate_payouts_select on public.affiliate_payouts;
create policy affiliate_payouts_select
  on public.affiliate_payouts for select to authenticated
  using ((public.affiliate_owner_access_ok(affiliate_id) and status = 'CONFIRME') or public.has_permission('payouts.view'));

drop policy if exists affiliate_payout_items_select on public.affiliate_payout_items;
create policy affiliate_payout_items_select
  on public.affiliate_payout_items for select to authenticated
  using (exists (select 1 from public.affiliate_payouts p
                  where p.id = affiliate_payout_items.payout_id
                    and ((public.affiliate_owner_access_ok(p.affiliate_id) and p.status = 'CONFIRME')
                         or public.has_permission('payouts.view'))));


-- -----------------------------------------------------------------------------
-- 3. ÉCRITURES PROPRIÉTAIRE D'UN PROFIL SUSPENDU
--
-- Campagnes, prospects, demandes de coordonnées de versement et coordonnées
-- de contact : un profil suspendu ne les écrit plus, même avec un jeton
-- valide. Déclencheur seul, aucune fonction 4H réécrite. Le chemin
-- administratif n'est pas concerné (l'auteur n'y est pas l'affilié).
-- -----------------------------------------------------------------------------

create or replace function public.tg_affiliate_owner_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affiliate uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_affiliate := case when tg_table_name = 'affiliates' then new.id else new.affiliate_id end;
  if v_affiliate is not null and public.affiliate_is_caller(v_affiliate) and not public.profile_owner_access_ok() then
    raise exception 'Ce compte est suspendu : il ne peut plus agir sur son affiliation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliates_owner_write_guard on public.affiliates;
create trigger affiliates_owner_write_guard
  before update on public.affiliates
  for each row execute function public.tg_affiliate_owner_write_guard();

drop trigger if exists affiliate_campaigns_owner_write_guard on public.affiliate_campaigns;
create trigger affiliate_campaigns_owner_write_guard
  before insert or update on public.affiliate_campaigns
  for each row execute function public.tg_affiliate_owner_write_guard();

drop trigger if exists affiliate_prospects_owner_write_guard on public.affiliate_prospects;
create trigger affiliate_prospects_owner_write_guard
  before insert or update on public.affiliate_prospects
  for each row execute function public.tg_affiliate_owner_write_guard();

drop trigger if exists affiliate_payout_accounts_owner_write_guard on public.affiliate_payout_accounts;
create trigger affiliate_payout_accounts_owner_write_guard
  before insert or update on public.affiliate_payout_accounts
  for each row execute function public.tg_affiliate_owner_write_guard();


-- -----------------------------------------------------------------------------
-- 4. FONCTIONS DE LECTURE DE L'ESPACE AFFILIÉ
--
-- Reprises exactes des dernières définitions ; seule la condition d'accès
-- propriétaire change (profil actif exigé).
-- -----------------------------------------------------------------------------

-- affiliate_stats — reprise exacte de 20261001170000_affiliation_attribution.sql, accès propriétaire par affiliate_owner_access_ok.
create or replace function public.affiliate_stats(p_affiliate_id uuid)
returns table (
  clicks            bigint,
  prospects         bigint,
  prospects_recognized bigint,
  requests          bigint,
  conversions       bigint,
  attributed_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.affiliate_owner_access_ok(p_affiliate_id) or public.can_view_affiliation()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from public.affiliate_clicks c where c.affiliate_id = p_affiliate_id),
      (select count(*) from public.affiliate_prospects p where p.affiliate_id = p_affiliate_id and p.status <> 'ANNULE'),
      (select count(*) from public.affiliate_prospects p where p.affiliate_id = p_affiliate_id and p.status in ('RECONNU', 'CONVERTI')),
      (select count(*) from public.affiliate_attributions at
        where at.affiliate_id = p_affiliate_id and at.quote_request_id is not null and at.status in ('ACTIVE', 'VALIDEE')),
      (select count(*) from public.affiliate_attributions at join public.orders o on o.id = at.order_id
        where at.affiliate_id = p_affiliate_id and at.status in ('ACTIVE', 'VALIDEE') and o.status <> 'ANNULEE'),
      (select coalesce(sum(o.total_amount), 0) from public.affiliate_attributions at join public.orders o on o.id = at.order_id
        where at.affiliate_id = p_affiliate_id and at.status in ('ACTIVE', 'VALIDEE') and o.status <> 'ANNULEE');
end;
$fn$;

-- affiliate_click_stats — reprise exacte de 20261001170000_affiliation_attribution.sql, accès propriétaire par affiliate_owner_access_ok.
create or replace function public.affiliate_click_stats(p_affiliate_id uuid)
returns table (campaign_id uuid, clicks bigint, requests bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.affiliate_owner_access_ok(p_affiliate_id) or public.can_view_affiliation()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    select c.campaign_id, count(*),
           (select count(*) from public.affiliate_attributions at
             where at.affiliate_id = p_affiliate_id and at.source = 'LIEN' and at.quote_request_id is not null
               and at.campaign_id is not distinct from c.campaign_id)
      from public.affiliate_clicks c
     where c.affiliate_id = p_affiliate_id
     group by c.campaign_id;
end;
$fn$;

-- affiliate_commission_totals — reprise exacte de 20261001190000_affiliation_versements.sql, accès propriétaire par affiliate_owner_access_ok.
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
  if not (public.affiliate_owner_access_ok(p_affiliate_id) or public.has_permission('commissions.view')) then
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

-- affiliate_sheet_preview — reprise exacte de 20261001200000_affiliation_documents.sql, accès propriétaire par affiliate_owner_access_ok.
create or replace function public.affiliate_sheet_preview(p_affiliate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_content jsonb;
begin
  if not (public.affiliate_owner_access_ok(p_affiliate_id) or public.has_permission('affiliates.view')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  v_content := public.affiliate_sheet_content(p_affiliate_id);
  if v_content is null then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('schema', 1, 'type', 'FIAF', 'preview', true, 'reference', null,
                            'issued_at', now(), 'issuer', public.document_issuer_identity()) || v_content;
end;
$fn$;

-- payout_account_details — reprise exacte de 20261001160000_affiliation_affilies.sql, accès propriétaire par affiliate_owner_access_ok.
create or replace function public.payout_account_details(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_payout_accounts%rowtype;
begin
  select * into v_row from public.affiliate_payout_accounts where id = p_account_id;
  if not found then
    return null;
  end if;
  if not (public.affiliate_owner_access_ok(v_row.affiliate_id) or public.has_permission('payouts.view')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return v_row.details;
end;
$fn$;

-- my_affiliate_conversions — reprise exacte de 20261001170000_affiliation_attribution.sql, profil actif exigé.
create or replace function public.my_affiliate_conversions()
returns table (
  order_reference text,
  ordered_at      timestamptz,
  offer           text,
  amount          numeric,
  order_status    text,
  settlement      text,
  source          text,
  attribution     text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.reference, o.created_at,
         (select oi.designation from public.order_items oi where oi.order_id = o.id order by oi.position, oi.id limit 1),
         o.total_amount, o.status, o.settlement_status, at.source, at.status
    from public.affiliate_attributions at
    join public.affiliates a on a.id = at.affiliate_id and a.user_id = auth.uid() and public.profile_owner_access_ok()
    join public.orders o on o.id = at.order_id
   where at.status in ('ACTIVE', 'VALIDEE')
   order by o.created_at desc;
$$;
