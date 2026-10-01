-- =============================================================================
-- PHASE 4H-3 — CORRECTIF : LISTE DES BLOCAGES D'ACTIVATION
--
-- `affiliate_activation_blockers` (migration 20261001160000) écrivait
-- `v_blockers || 'texte'`. PostgreSQL lit alors le texte comme un littéral de
-- tableau et lève « malformed array literal » : la fonction échouait dès
-- qu'il y avait au moins un blocage à signaler — exactement quand on en a
-- besoin. `activate_affiliate` refusait donc bien, mais pour une mauvaise
-- raison, et l'écran ne pouvait pas afficher la liste.
--
-- Révélé par `scripts/verify-affiliation.mjs` avant tout usage réel. La
-- fonction est recopiée à l'identique ; seules les quatre concaténations
-- deviennent `array_append(…, …::text)`. La migration d'origine, appliquée,
-- n'est pas modifiée.
-- =============================================================================

create or replace function public.affiliate_activation_blockers(p_affiliate_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff      public.affiliates%rowtype;
  v_blockers text[] := array[]::text[];
begin
  if not public.can_view_affiliation() then
    raise exception 'Permission affiliates.view requise.' using errcode = '42501';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id;
  if not found then
    return array['Affilié introuvable.'];
  end if;
  if v_aff.status <> 'PREPARATION' then
    v_blockers := array_append(v_blockers, 'L''affilié n''est pas en préparation.'::text);
  end if;
  if not exists (select 1 from public.affiliate_categories c where c.id = v_aff.category_id and c.is_active) then
    v_blockers := array_append(v_blockers, 'La catégorie de l''affilié est inactive.'::text);
  end if;
  -- Configuration financière complète : une règle générale en vigueur, sur
  -- l'affilié ou sur sa catégorie. Sans elle, aucune affaire ne serait
  -- commissionnable.
  if not exists (
    select 1 from public.affiliate_rules r
     where r.target_type = 'ALL'
       and r.kind <> 'EXCLUDED'
       and r.valid_from <= now() and (r.valid_to is null or r.valid_to > now())
       and (r.affiliate_id = v_aff.id or r.category_id = v_aff.category_id)
  ) then
    v_blockers := array_append(v_blockers, 'Aucune règle de commission générale en vigueur (affilié ou catégorie).'::text);
  end if;
  if not exists (
    select 1 from public.affiliate_payout_accounts p where p.affiliate_id = v_aff.id and p.status = 'ACTIF'
  ) then
    v_blockers := array_append(v_blockers, 'Aucun moyen de versement validé.'::text);
  end if;
  return v_blockers;
end;
$fn$;

revoke execute on function public.affiliate_activation_blockers(uuid) from public, anon;
grant  execute on function public.affiliate_activation_blockers(uuid) to authenticated, service_role;
