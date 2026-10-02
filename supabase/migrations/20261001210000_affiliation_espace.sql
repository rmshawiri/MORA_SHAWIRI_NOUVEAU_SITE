-- =============================================================================
-- PHASE 4H-8 — ESPACE AFFILIÉ : PROFIL
--
-- L'affilié ne peut rien écrire sur sa fiche : la politique de mise à jour
-- de `affiliates` est réservée à `affiliates.update`. L'espace affilié lui
-- ouvre une seule porte, étroite : ses coordonnées de contact (téléphone,
-- ville, pays).
--
-- Jamais par cette porte : nom, raison sociale, e-mail de connexion,
-- catégorie, statut, règles, conditions, attribution, coordonnées de
-- versement (qui ont leur propre circuit de validation), historique.
-- =============================================================================

create or replace function public.update_my_affiliate_contact(
  p_phone   text,
  p_city    text,
  p_country text
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_before public.affiliates%rowtype;
  v_after  public.affiliates%rowtype;
  v_phone  text := nullif(btrim(coalesce(p_phone, '')), '');
  v_city   text := nullif(btrim(coalesce(p_city, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;
  select * into v_before from public.affiliates where user_id = auth.uid() for update;
  if not found then
    raise exception 'Aucune affiliation n''est rattachée à ce compte.' using errcode = '42501';
  end if;
  if v_before.status = 'TERMINE' then
    raise exception 'Votre affiliation a pris fin : vos coordonnées ne se modifient plus ici.' using errcode = 'check_violation';
  end if;
  if v_phone is not null and (length(v_phone) > 40 or v_phone !~ '^[+0-9 ().-]{6,40}$') then
    raise exception 'Numéro de téléphone invalide.' using errcode = 'check_violation';
  end if;
  if (v_city is not null and length(v_city) > 80) or (v_country is not null and length(v_country) > 80) then
    raise exception 'Ville ou pays trop long.' using errcode = 'check_violation';
  end if;

  update public.affiliates
     set contact_phone = v_phone, city = v_city, country = v_country
   where id = v_before.id
  returning * into v_after;

  if (v_before.contact_phone, v_before.city, v_before.country) is distinct from (v_after.contact_phone, v_after.city, v_after.country) then
    perform public.affiliation_log(v_after.id, null, 'COORDONNEES_CONTACT',
      'L''affilié a mis à jour ses coordonnées de contact',
      jsonb_build_object('telephone', v_before.contact_phone, 'ville', v_before.city, 'pays', v_before.country),
      jsonb_build_object('telephone', v_after.contact_phone, 'ville', v_after.city, 'pays', v_after.country));
  end if;
  return v_after;
end;
$fn$;

comment on function public.update_my_affiliate_contact(text, text, text) is
  'Seule écriture de l''affilié sur sa fiche : téléphone, ville, pays. Journalisée avec l''avant et l''après.';

revoke execute on function public.update_my_affiliate_contact(text, text, text) from public, anon;
grant  execute on function public.update_my_affiliate_contact(text, text, text) to authenticated, service_role;
