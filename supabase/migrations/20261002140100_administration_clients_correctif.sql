-- =============================================================================
-- PHASE 4I-4 — CORRECTIF : L'AJOUT SEUL ET LA DISPARITION D'UN AUTEUR
--
-- Les notes et l'historique de blocage gardent leur auteur par une clé
-- `on delete set null` : quand le compte d'un administrateur disparaît, la
-- base remet ce champ à nul. La garde « ajout seul » refusait toute mise à
-- jour, y compris celle-là — et bloquait donc la suppression du compte.
--
-- Seul ce cas passe désormais : l'auteur remis à nul, et rien d'autre. Le
-- libellé de l'auteur (`author_label`, `actor_label`) reste, comme dans les
-- historiques de 4F : la ligne demeure lisible.
-- =============================================================================

create or replace function public.tg_client_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'client_notes'
       and old.author_id is not null and new.author_id is null
       and (to_jsonb(new) - 'author_id') = (to_jsonb(old) - 'author_id') then
      return new;
    end if;
    if tg_table_name = 'client_status_events'
       and old.actor_id is not null and new.actor_id is null
       and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
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
