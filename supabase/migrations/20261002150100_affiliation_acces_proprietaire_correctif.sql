-- =============================================================================
-- PHASE 4I-5 — CORRECTIF : GARDE D'ÉCRITURE PROPRIÉTAIRE AFFILIÉ
--
-- La garde de 20261002150000 lisait `new.affiliate_id` : en PL/pgSQL, ce
-- champ est résolu même quand la branche `affiliates` est prise, et la table
-- des affiliés n'a pas cette colonne — toute mise à jour d'un affilié
-- (activation comprise) échouait. Lecture désormais dans la représentation
-- JSON de la ligne. Même règle, rien d'autre.
-- =============================================================================

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
  v_affiliate := (to_jsonb(new) ->> case when tg_table_name = 'affiliates' then 'id' else 'affiliate_id' end)::uuid;
  if v_affiliate is not null and public.affiliate_is_caller(v_affiliate) and not public.profile_owner_access_ok() then
    raise exception 'Ce compte est suspendu : il ne peut plus agir sur son affiliation.' using errcode = '42501';
  end if;
  return new;
end;
$$;
