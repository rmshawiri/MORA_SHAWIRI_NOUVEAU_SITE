-- =============================================================================
-- PHASE 4H-1 — CORRECTIF : NUMÉRO DE VERSION D'UNE PREMIÈRE RÈGLE
--
-- `publish_affiliate_rule` (migration 20261001140000) lisait la version en
-- cours, appelait `perform set_config(…)`, puis testait `found`. Or `perform`
-- remet `found` à vrai : sans version précédente, la fonction croyait en
-- avoir trouvé une, et calculait un numéro de version nul — refusé par la
-- contrainte `not null`. Aucune règle n'a donc pu être écrite avec un mauvais
-- numéro ; le défaut a été révélé par `scripts/verify-affiliation.mjs` avant
-- toute utilisation réelle.
--
-- La fonction est recopiée À L'IDENTIQUE, à une variable près. La migration
-- d'origine, déjà appliquée, n'est pas modifiée.
-- =============================================================================

create or replace function public.publish_affiliate_rule(
  p_owner_type        text,
  p_owner_id          uuid,
  p_target_type       text,
  p_target_id         uuid,
  p_kind              text,
  p_rate              numeric,
  p_fixed_amount      numeric,
  p_tiers             jsonb,
  p_min_commission    numeric,
  p_max_commission    numeric,
  p_min_base          numeric,
  p_effective_at      timestamptz,
  p_label             text,
  p_reason            text,
  p_derogation        boolean default false,
  p_derogation_reason text default null
)
returns public.affiliate_rules
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_at       timestamptz := coalesce(p_effective_at, now());
  v_current  public.affiliate_rules%rowtype;
  v_new      public.affiliate_rules%rowtype;
  v_version  integer := 1;
  v_lock     text;
  v_has_current boolean;
begin
  if not public.has_permission('affiliate_rules.manage') then
    raise exception 'Permission affiliate_rules.manage requise.' using errcode = '42501';
  end if;
  if coalesce(p_derogation, false) and not public.has_permission('affiliate_rules.derogate') then
    raise exception 'Permission affiliate_rules.derogate requise pour une dérogation contractuelle.'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un motif est requis pour toute modification de règle.' using errcode = 'check_violation';
  end if;
  -- Une date d'effet passée réécrirait la règle d'affaires déjà conclues.
  if v_at < now() - interval '1 minute' then
    raise exception 'La date d''effet ne peut pas être dans le passé.' using errcode = 'check_violation';
  end if;
  if v_at < now() then
    v_at := now();
  end if;
  -- `numeric(5, 2)` arrondirait en silence un taux à trois décimales : on
  -- refuse plutôt que d'enregistrer autre chose que ce qui a été saisi.
  if (p_rate is not null and p_rate <> round(p_rate, 2))
     or (p_fixed_amount is not null and p_fixed_amount <> round(p_fixed_amount, 2))
     or (p_min_commission is not null and p_min_commission <> round(p_min_commission, 2))
     or (p_max_commission is not null and p_max_commission <> round(p_max_commission, 2))
     or (p_min_base is not null and p_min_base <> round(p_min_base, 2)) then
    raise exception 'Deux décimales au plus pour un taux ou un montant.' using errcode = 'check_violation';
  end if;
  if coalesce(p_derogation, false)
     and (p_derogation_reason is null or btrim(p_derogation_reason) = '') then
    raise exception 'Le motif de la dérogation contractuelle est obligatoire.' using errcode = 'check_violation';
  end if;

  if p_owner_type = 'CATEGORY' then
    perform 1 from public.affiliate_categories where id = p_owner_id;
  elsif p_owner_type = 'AFFILIATE' then
    perform 1 from public.affiliates where id = p_owner_id and status <> 'TERMINE';
  else
    raise exception 'Propriétaire de règle invalide.' using errcode = 'check_violation';
  end if;
  if not found then
    raise exception 'Catégorie ou affilié introuvable (ou clos).' using errcode = 'no_data_found';
  end if;

  if p_target_type = 'SERVICE' then
    perform 1 from public.services where id = p_target_id;
    if not found then raise exception 'Service introuvable.' using errcode = 'no_data_found'; end if;
  elsif p_target_type = 'PRODUCT' then
    perform 1 from public.products where id = p_target_id;
    if not found then raise exception 'Produit introuvable.' using errcode = 'no_data_found'; end if;
  elsif p_target_type <> 'ALL' then
    raise exception 'Cible de règle invalide.' using errcode = 'check_violation';
  end if;

  -- Sérialise les publications concurrentes d'une même règle.
  v_lock := concat_ws(':', 'affiliate_rule', p_owner_type, p_owner_id, p_target_type, coalesce(p_target_id::text, '-'));
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  if exists (
    select 1 from public.affiliate_rules r
     where r.owner_type = p_owner_type
       and r.owner_key = p_owner_id
       and r.target_type = p_target_type
       and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and r.valid_from > now()
  ) then
    raise exception 'Une version future est déjà programmée pour cette règle : retirez-la d''abord.'
      using errcode = 'check_violation';
  end if;

  select * into v_current
    from public.affiliate_rules r
   where r.owner_type = p_owner_type
     and r.owner_key = p_owner_id
     and r.target_type = p_target_type
     and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and (r.valid_to is null or r.valid_to > v_at)
   order by r.valid_from desc
   limit 1
   for update;
  -- Lu immédiatement : tout `perform` qui suit remettrait `found` à vrai.
  v_has_current := found;

  perform set_config('mora.reason', left(btrim(p_reason), 1000), true);

  if v_has_current then
    v_version := v_current.version + 1;
    update public.affiliate_rules
       set valid_to  = v_at,
           closed_at = now(),
           closed_by = auth.uid()
     where id = v_current.id;
  else
    select coalesce(max(r.version), 0) + 1 into v_version
      from public.affiliate_rules r
     where r.owner_type = p_owner_type
       and r.owner_key = p_owner_id
       and r.target_type = p_target_type
       and r.target_key = coalesce(p_target_id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  insert into public.affiliate_rules (
    version, supersedes_id, owner_type, category_id, affiliate_id,
    target_type, service_id, product_id,
    kind, rate, fixed_amount, tiers, min_commission, max_commission, min_base,
    valid_from, label,
    contractual_derogation, derogation_reason, derogation_granted_by, derogation_granted_at,
    created_by
  ) values (
    v_version, v_current.id, p_owner_type,
    case when p_owner_type = 'CATEGORY' then p_owner_id end,
    case when p_owner_type = 'AFFILIATE' then p_owner_id end,
    p_target_type,
    case when p_target_type = 'SERVICE' then p_target_id end,
    case when p_target_type = 'PRODUCT' then p_target_id end,
    p_kind, p_rate, p_fixed_amount, p_tiers, p_min_commission, p_max_commission, p_min_base,
    v_at, nullif(left(btrim(coalesce(p_label, '')), 120), ''),
    coalesce(p_derogation, false),
    case when coalesce(p_derogation, false) then left(btrim(coalesce(p_derogation_reason, '')), 1000) end,
    case when coalesce(p_derogation, false) then auth.uid() end,
    case when coalesce(p_derogation, false) then now() end,
    auth.uid()
  )
  returning * into v_new;

  return v_new;
end;
$fn$;

comment on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) is
  'Publie une nouvelle version d''une règle : clôt la version en cours à la date d''effet et ouvre la suivante, d''un bloc. Motif obligatoire ; dérogation sous affiliate_rules.derogate.';

revoke execute on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) from public, anon;
grant  execute on function public.publish_affiliate_rule(text, uuid, text, uuid, text, numeric, numeric, jsonb, numeric, numeric, numeric, timestamptz, text, text, boolean, text) to authenticated, service_role;
