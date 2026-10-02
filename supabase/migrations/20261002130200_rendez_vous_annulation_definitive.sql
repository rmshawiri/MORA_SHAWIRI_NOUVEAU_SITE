-- =============================================================================
-- PHASE 4I-3 — CORRECTIF : UNE ANNULATION NE SE RÉÉCRIT PAS
--
-- Défaut de 4F mis au jour par le contrôle de concurrence de 4I-3 : quand le
-- client annule son rendez-vous et que l'administration l'annule au même
-- moment, la seconde mise à jour arrive sur un rendez-vous déjà ANNULÉ. Le
-- statut ne change pas, donc la garde de transition laisse passer — et le
-- motif du client était remplacé, sans trace, par le motif administratif.
-- Le même écrasement survenait hors concurrence si l'action administrative
-- visait un rendez-vous déjà annulé.
--
-- Règle : une fois le rendez-vous annulé, son motif et l'auteur de
-- l'annulation sont définitifs, pour tout le monde. La seconde annulation
-- échoue au lieu de réécrire la première. Rien d'autre ne change.
-- =============================================================================

create or replace function public.tg_appointments_cancellation_final()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'ANNULE'
     and (new.cancel_reason is distinct from old.cancel_reason
          or new.cancelled_by is distinct from old.cancelled_by
          or new.cancelled_at is distinct from old.cancelled_at) then
    raise exception 'Ce rendez-vous est déjà annulé : son annulation ne se modifie plus.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.tg_appointments_cancellation_final() is
  'Rend définitifs le motif, l''auteur et la date d''une annulation de rendez-vous (4I-3) : une seconde annulation ne réécrit pas la première.';

drop trigger if exists appointments_cancellation_final on public.appointments;
create trigger appointments_cancellation_final
  before update on public.appointments
  for each row execute function public.tg_appointments_cancellation_final();
