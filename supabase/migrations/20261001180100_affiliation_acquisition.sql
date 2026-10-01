-- =============================================================================
-- PHASE 4H-5 — CORRECTIF : CONDITION D'ACQUISITION
--
-- La première version exigeait « aucun remboursement » pour acquérir. Une
-- commande intégralement payée puis partiellement remboursée avant
-- l'acquisition serait restée prévisionnelle pour toujours. La décision G
-- dit autre chose : la commission se calcule sur le montant réellement
-- conservé. L'acquisition se fait donc dès que la condition de paiement est
-- remplie, sur l'assiette réduite au montant conservé — et un remboursement
-- total n'acquiert rien.
-- =============================================================================

create or replace function public.affiliate_commission_check_acquisition(p_commission_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_c     public.affiliate_commissions%rowtype;
  v_order public.orders%rowtype;
  v_ok    boolean;
begin
  select * into v_c from public.affiliate_commissions where id = p_commission_id for update;
  if not found or v_c.status <> 'PREVISIONNELLE' then
    return;
  end if;
  select * into v_order from public.orders where id = v_c.order_id;
  v_ok := v_order.paid_amount > v_order.refunded_amount
          and case v_c.acquisition_trigger
                when 'PAIEMENT_INTEGRAL' then v_order.total_amount > 0 and v_order.paid_amount >= v_order.total_amount
                when 'PREMIER_PAIEMENT'  then v_order.paid_amount > 0
                else false
              end;
  if not v_ok then
    return;
  end if;

  -- Dernier calcul sur la commande définitive et le montant conservé, puis
  -- la commission se fige.
  perform public.affiliate_refresh_order_commission(v_c.order_id);
  select * into v_c from public.affiliate_commissions where id = p_commission_id;
  if v_c.amount <= 0 then
    update public.affiliate_commissions
       set status = 'ANNULEE', cancelled_at = now(), cancel_reason = 'Aucune ligne commissionnable dans la commande définitive'
     where id = p_commission_id;
    return;
  end if;
  update public.affiliate_commissions
     set status = 'ACQUISE', acquired_at = now()
   where id = p_commission_id
  returning * into v_c;

  perform public.affiliation_log(v_c.affiliate_id, null, 'COMMISSION_ACQUISE',
    format('Commission %s acquise : %s KMF', v_c.reference, v_c.amount), null,
    jsonb_build_object('commission', v_c.reference, 'montant', v_c.amount));
  perform public.affiliation_notify(v_c.affiliate_id, 'affiliation.commission.acquise', 'affiliate_commission', v_c.id,
    jsonb_build_object('reference', v_c.reference, 'montant', v_c.amount));
end;
$fn$;

revoke execute on function public.affiliate_commission_check_acquisition(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_commission_check_acquisition(uuid) to service_role;
