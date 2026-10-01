-- =============================================================================
-- PHASE 4H-4 — INDICES DE RAPPROCHEMENT DES PROSPECTS, POUR L'ADMINISTRATION
--
-- `affiliate_prospects.review_hint` dit si un prospect déclaré est déjà connu
-- de MORA Shawiri ou déjà déclaré par un autre affilié. L'affilié ne doit
-- jamais le lire — lui apprendre qu'une personne est cliente serait une
-- fuite — et la colonne n'est donc accordée à aucune session. Un privilège de
-- colonne ne distinguant pas un administrateur d'un affilié, la lecture
-- passe par cette fonction, sous `affiliates.view`.
-- =============================================================================

create or replace function public.affiliate_prospect_hints(p_affiliate_id uuid)
returns table (prospect_id uuid, hint text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.can_view_affiliation() then
    raise exception 'Permission affiliates.view requise.' using errcode = '42501';
  end if;
  return query
    select p.id, p.review_hint
      from public.affiliate_prospects p
     where (p_affiliate_id is null or p.affiliate_id = p_affiliate_id)
       and p.review_hint is not null;
end;
$fn$;

comment on function public.affiliate_prospect_hints(uuid) is
  'Rapprochements des prospects déclarés (déjà connu, déjà déclaré), pour l''administration seulement.';

revoke execute on function public.affiliate_prospect_hints(uuid) from public, anon;
grant  execute on function public.affiliate_prospect_hints(uuid) to authenticated, service_role;
