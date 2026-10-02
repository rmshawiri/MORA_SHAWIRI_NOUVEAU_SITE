-- =============================================================================
-- PHASE 4I-4 — CORRECTIF DU CORRECTIF : UNE SEULE GARDE POUR DEUX TABLES
--
-- La version précédente lisait `old.author_id` : en PL/pgSQL, ce champ est
-- résolu même quand la condition sur la table est fausse, et la garde levait
-- « record old has no field author_id » sur `client_status_events`. La
-- suppression d'un compte auteur d'un blocage échouait donc encore.
--
-- Les colonnes sont désormais lues dans la représentation JSON de la ligne :
-- même règle (seul l'auteur remis à nul passe), sans dépendre du schéma.
-- =============================================================================

create or replace function public.tg_client_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_col text := case tg_table_name when 'client_notes' then 'author_id' else 'actor_id' end;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old) ->> v_col) is not null
       and (to_jsonb(new) ->> v_col) is null
       and (to_jsonb(new) - v_col) = (to_jsonb(old) - v_col) then
      return new;
    end if;
    raise exception 'Cet historique est en ajout seul.' using errcode = '42501';
  end if;
  if exists (select 1 from public.clients c where c.user_id = old.client_user_id) then
    raise exception 'Cet historique est en ajout seul.' using errcode = '42501';
  end if;
  return old;
end;
$$;

comment on function public.tg_client_append_only() is
  'Notes et historique de blocage en ajout seul (4I-4) ; seule exception : l''auteur remis à nul quand son compte disparaît.';
