-- =============================================================================
-- PHASE 4I-3 — CORRECTIF : UN BROUILLON ABANDONNÉ RESTE INVISIBLE
--
-- Un devis abandonné à l'état de brouillon passe à ANNULE **sans référence**
-- (contrainte `quotes_issued_coherent`). La politique 4F « le client voit son
-- devis sauf brouillon » le laisse donc passer, alors qu'il n'a jamais été
-- envoyé. L'espace client filtre sur la référence ; la décision du client
-- l'exige aussi : un devis sans référence est introuvable, comme un brouillon.
--
-- Reprise exacte de `respond_to_my_quote` (20261002130000), une condition en
-- plus dans la lecture verrouillée.
-- =============================================================================

create or replace function public.respond_to_my_quote(p_quote_id uuid, p_decision text, p_reason text default null)
returns public.quotes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_quote  public.quotes%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not public.client_session_is_active(v_uid) then
    raise exception 'Session active requise.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('ACCEPTE', 'REFUSE') then
    raise exception 'Décision inconnue.' using errcode = 'check_violation';
  end if;
  if p_decision = 'ACCEPTE' then
    v_reason := null;
  elsif v_reason is not null and length(v_reason) > 1000 then
    raise exception 'Le motif ne dépasse pas 1 000 caractères.' using errcode = 'check_violation';
  end if;

  select q.* into v_quote
    from public.quotes q
    join public.quote_requests qr on qr.id = q.quote_request_id
   where q.id = p_quote_id and qr.user_id = v_uid
     and q.status <> 'BROUILLON' and q.reference is not null
     for update of q;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  if v_quote.status = p_decision and v_quote.responded_by = v_uid then
    return v_quote;
  end if;

  if v_quote.status <> 'ENVOYE' then
    raise exception 'Ce devis n''attend plus de réponse.' using errcode = 'check_violation';
  end if;
  if v_quote.valid_until is not null and (now() at time zone 'Indian/Comoro')::date > v_quote.valid_until then
    raise exception 'Ce devis a expiré : contactez MORA Shawiri.' using errcode = 'check_violation';
  end if;

  update public.quotes
     set status = p_decision,
         responded_at = now(),
         responded_by = v_uid,
         client_response_reason = v_reason
   where id = v_quote.id
  returning * into v_quote;

  perform public.record_audit_event(
    'relation.devis.decision_client', 'quote', v_quote.reference, 'SUCCES',
    jsonb_build_object('decision', p_decision, 'motif_fourni', v_reason is not null)
  );

  return v_quote;
end;
$fn$;

comment on function public.respond_to_my_quote(uuid, text, text) is
  'Le client accepte ou refuse son devis envoyé (motif de refus facultatif). Ne crée aucune commande. Propriété, compte actif, état, référence et validité vérifiés sous verrou.';
