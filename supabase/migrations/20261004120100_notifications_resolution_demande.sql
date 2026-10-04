-- =============================================================================
-- PHASE 4J-2 — CORRECTIF : RÉSOLUTION DE « NOUVELLE DEMANDE »
--
-- Constat du contrôle 4J-2 : `send_quote` ne fait avancer la demande que si
-- elle est « en étude » ; une demande encore « nouvelle » le reste après
-- l'émission d'un devis. L'action attendue de l'administration — répondre à
-- la demande — est pourtant accomplie dès qu'un devis est émis.
--
-- Seul le routeur des demandes change : l'émission d'un devis résout aussi
-- « Nouvelle demande de devis ». Aucune règle métier de 4F ne change.
-- =============================================================================

create or replace function public.notifications_route_quote_request_event(e public.quote_request_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_req   public.quote_requests%rowtype;
  v_quote public.quotes%rowtype;
begin
  perform public.notifications_fault_check();
  select * into v_req from public.quote_requests where id = e.quote_request_id;
  if not found then
    return;
  end if;

  if e.kind = 'CREATION' then
    perform public.notifications_create_for_admins('admin.demande.nouvelle', 'quote_request', v_req.id,
      public.notif_params(v_req.reference), 'quote_requests', v_req.id::text || ':nouvelle', e.actor_id);

  elsif e.kind = 'STATUT' then
    if e.from_status = 'NOUVELLE' then
      perform public.notifications_resolve(array['admin.demande.nouvelle'], 'quote_request', v_req.id);
    end if;
    if e.to_status in ('ANNULEE', 'TERMINEE', 'REFUSEE') then
      perform public.notifications_resolve(array['admin.demande.nouvelle', 'admin.devis.accepte'], 'quote_request', v_req.id);
    end if;

  elsif e.kind = 'DEVIS_STATUT' and e.quote_reference is not null then
    select * into v_quote from public.quotes
     where reference = e.quote_reference and quote_request_id = v_req.id;
    if not found then
      return;
    end if;

    if e.to_status = 'ENVOYE' then
      -- Un devis émis répond à la demande : son « à traiter » est clos.
      perform public.notifications_resolve(array['admin.demande.nouvelle'], 'quote_request', v_req.id);
      if v_req.user_id is not null then
        perform public.notifications_create('client.devis.disponible', v_req.user_id, 'quote', v_quote.id,
          public.notif_params(v_quote.reference), 'quotes', v_quote.id::text || ':ENVOYE', e.actor_id);
      end if;
    else
      perform public.notifications_resolve(array['client.devis.disponible'], 'quote', v_quote.id);
      if e.to_status = 'ACCEPTE' then
        perform public.notifications_create_for_admins('admin.devis.accepte', 'quote_request', v_req.id,
          public.notif_params(v_req.reference), 'quotes', v_quote.id::text || ':ACCEPTE', e.actor_id);
      elsif e.to_status = 'REFUSE' then
        perform public.notifications_create_for_admins('admin.devis.refuse', 'quote_request', v_req.id,
          public.notif_params(v_req.reference), 'quotes', v_quote.id::text || ':REFUSE', e.actor_id);
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.notifications_route_quote_request_event(public.quote_request_events) from public, anon, authenticated;
grant  execute on function public.notifications_route_quote_request_event(public.quote_request_events) to service_role;
