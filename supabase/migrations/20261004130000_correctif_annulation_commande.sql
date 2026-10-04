-- =============================================================================
-- MICRO-CORRECTIF 4G — ANNULATION D'UNE COMMANDE ET PAIEMENTS
--
-- Rapport 22. Décision du propriétaire (4 octobre 2026) : option D + C, une
-- seule notification client quand la déclaration est annulée par
-- l'annulation de la commande.
--
-- Deux défauts corrigés, une seule règle portée par la base :
--
--   1. Une commande portant une déclaration de paiement en attente ne
--      pouvait pas être annulée : `cancel_order` passait la commande à
--      ANNULEE, puis la garde des paiements refusait toute écriture sur une
--      commande annulée — y compris la clôture de la déclaration.
--
--   2. Le contrôle « encaissé non remboursé » ne vivait que dans
--      `cancel_order`. Une session détenant `orders.cancel` pouvait passer
--      elle-même le statut à ANNULEE (RLS `orders_update_admin`) : une
--      commande PAYÉE s'annulait sans remboursement, et une déclaration en
--      attente restait coincée pour toujours.
--
-- La règle finale, quel que soit le chemin (application, RPC, mise à jour
-- directe, rôle privilégié) :
--   * encaissé > remboursé → la commande ne peut pas devenir ANNULEE ;
--   * une commande qui devient ANNULEE clôt ses déclarations encore en
--     attente (EN_ATTENTE, INITIE, EN_VERIFICATION → ANNULE), jamais PAYE ni
--     REMBOURSE ni PARTIELLEMENT_REMBOURSE ; rien n'est supprimé ;
--   * une commande annulée ne reçoit plus d'argent ; seules les clôtures
--     (ANNULE, ECHEC) et les sorties d'argent restent possibles.
--
-- Aucune permission, aucun statut, aucun calcul de remboursement, aucune
-- facture ni aucun document n'est modifié. Aucune garde n'est désactivée.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LA GARDE DES COMMANDES — la règle financière pour tous les chemins
--
-- Reprise à l'identique de 4G ; un seul ajout : le refus d'ANNULEE tant que
-- l'encaissé dépasse le remboursé. Il est placé HORS du bloc des
-- permissions : il vaut aussi pour un rôle privilégié et pour la clé de
-- service. Le message reprend celui de `cancel_order`, que l'application
-- traduit déjà en message métier.
-- -----------------------------------------------------------------------------

create or replace function public.tg_orders_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_allowed text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_privileged_db_role() then
    if new.status = 'ANNULEE' then
      if not public.has_permission('orders.cancel') then
        raise exception 'Annulation refusée : permission orders.cancel requise.'
          using errcode = '42501';
      end if;
    elsif not public.has_permission('orders.update') then
      raise exception 'Changement de statut refusé : permission orders.update requise.'
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'NOUVELLE'        then array['CONFIRMEE', 'ANNULEE']
    when 'CONFIRMEE'       then array['EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE', 'ANNULEE']
    when 'EN_TRAITEMENT'   then array['EN_ATTENTE_INFO', 'PRETE', 'TERMINEE', 'ANNULEE']
    when 'EN_ATTENTE_INFO' then array['EN_TRAITEMENT', 'PRETE', 'ANNULEE']
    when 'PRETE'           then array['TERMINEE', 'ANNULEE']
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : une commande % ne peut pas devenir %.',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Correctif 4G : une commande encaissée ne s'annule qu'une fois remboursée,
  -- par quelque chemin que ce soit. Les montants sont ceux que la base a
  -- calculés (paiements PAYE, remboursements EFFECTUE), jamais une saisie.
  if new.status = 'ANNULEE' and old.paid_amount > old.refunded_amount then
    raise exception
      'Cette commande a encaissé % et n''en a remboursé que % : traitez le remboursement avant d''annuler.',
      old.paid_amount, old.refunded_amount
      using errcode = 'check_violation';
  end if;

  if new.status = 'ANNULEE' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  if new.status = 'TERMINEE' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if new.status <> 'NOUVELLE' and new.status <> 'ANNULEE' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  return new;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- 2. LA GARDE DES PAIEMENTS — plus d'argent entrant, mais les clôtures
--
-- Reprise de 4G. Sur une commande annulée :
--   * une insertion reste refusée (aucun nouveau paiement) ;
--   * un changement de statut n'est admis que vers une clôture (ANNULE,
--     ECHEC) ou une sortie d'argent (REMBOURSE, PARTIELLEMENT_REMBOURSE) ;
--     EN_ATTENTE, INITIE, EN_VERIFICATION et PAYE restent refusés ;
--   * une mise à jour sans changement de statut reste possible (les champs
--     critiques d'un paiement sont protégés par leurs propres gardes).
-- -----------------------------------------------------------------------------

create or replace function public.tg_payments_amount_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order     public.orders%rowtype;
  v_confirmed numeric(12, 2);
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  if new.currency <> v_order.currency then
    raise exception 'La devise du paiement (%) diffère de celle de la commande (%).',
      new.currency, v_order.currency
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'ANNULEE' then
    if tg_op = 'INSERT'
       or (new.status is distinct from old.status
           and new.status not in ('ANNULE', 'ECHEC', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE')) then
      raise exception 'Une commande annulée ne reçoit pas de paiement (§ 97).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Seuls les montants déjà confirmés bornent le nouveau : une déclaration en
  -- attente n'immobilise rien, sans quoi un client pourrait bloquer sa propre
  -- commande en déclarant un paiement fantaisiste.
  select coalesce(sum(p.amount), 0)
    into v_confirmed
    from public.payments p
   where p.order_id = new.order_id
     and p.id <> new.id
     and p.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE');

  if new.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE')
     and v_confirmed + new.amount > v_order.total_amount then
    raise exception
      'Montant incohérent : % confirmé(s) plus % dépasseraient le total de la commande (%).',
      v_confirmed, new.amount, v_order.total_amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_payments_amount_guard() is
  'Refuse une devise étrangère à la commande, tout argent entrant sur une commande annulée (les clôtures restent possibles), et un cumul confirmé supérieur au total dû.';


-- -----------------------------------------------------------------------------
-- 3. LA CLÔTURE DES DÉCLARATIONS EN ATTENTE
--
-- Après le passage d'une commande à ANNULEE — par `cancel_order` ou par tout
-- autre chemin — ses déclarations encore en attente sont annulées dans la
-- même transaction. Le paiement garde son déclarant, sa date, sa référence ;
-- seul son statut change, et l'historique le dit.
--
-- Le contexte « annulée avec la commande » est transmis à l'historique du
-- paiement par un réglage local à cette transaction, posé ici et retiré
-- aussitôt : l'événement métier enregistré le porte, et c'est lui — non une
-- déduction — qui distingue cette clôture d'une annulation indépendante.
-- -----------------------------------------------------------------------------

create or replace function public.tg_orders_close_pending_payments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'ANNULEE' and old.status is distinct from 'ANNULEE' then
    perform set_config('mora.paiement_cloture_commande', new.id::text, true);
    update public.payments
       set status = 'ANNULE'
     where order_id = new.id
       and status in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION');
    perform set_config('mora.paiement_cloture_commande', '', true);
  end if;
  return null;
end;
$fn$;

comment on function public.tg_orders_close_pending_payments() is
  'Correctif 4G : une commande annulée clôt ses déclarations encore en attente (ANNULE), jamais un paiement confirmé ou remboursé.';

revoke execute on function public.tg_orders_close_pending_payments() from public, anon, authenticated;

drop trigger if exists orders_close_pending_payments on public.orders;
create trigger orders_close_pending_payments
  after update of status on public.orders
  for each row execute function public.tg_orders_close_pending_payments();


-- -----------------------------------------------------------------------------
-- 4. L'HISTORIQUE DU PAIEMENT — « annulée avec la commande »
--
-- Reprise à l'identique de 4G ; seul le résumé d'une annulation change quand
-- elle découle de l'annulation de la commande.
-- -----------------------------------------------------------------------------

create or replace function public.tg_payments_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_method text;
begin
  select pm.label into v_method
    from public.payment_methods pm
   where pm.code = new.method_code;

  if tg_op = 'INSERT' then
    insert into public.order_events
      (order_id, payment_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.id, 'PAIEMENT_DECLARE',
       format('Paiement déclaré — %s', coalesce(v_method, new.method_code)),
       new.amount, auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_events
      (order_id, payment_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.id,
       case new.status
         when 'PAYE'   then 'PAIEMENT_CONFIRME'
         when 'ECHEC'  then 'PAIEMENT_REJETE'
         when 'ANNULE' then 'PAIEMENT_ANNULE'
         else 'PAIEMENT_DECLARE'
       end,
       -- Le motif d'un rejet est une information de gestion, pas une donnée
       -- personnelle : il a sa place ici. Le reçu, lui, n'y entre jamais.
       case new.status
         when 'PAYE'   then format('Paiement confirmé — %s', coalesce(v_method, new.method_code))
         when 'ECHEC'  then format('Déclaration rejetée — %s', left(coalesce(new.rejection_reason, 'sans motif'), 200))
         when 'ANNULE' then
           case when coalesce(current_setting('mora.paiement_cloture_commande', true), '') = new.order_id::text
                then 'Déclaration annulée avec la commande'
                else 'Déclaration annulée' end
         else format('Paiement : %s → %s', old.status, new.status)
       end,
       new.amount, auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- 5. NOTIFICATIONS — une seule pour le client
--
-- Routeur 4J-2 repris à l'identique ; une seule différence : une déclaration
-- « annulée avec la commande » (événement enregistré, § 4) résout « Paiement à
-- vérifier » sans notifier le client, qui reçoit déjà « Commande annulée ».
-- Une annulation de paiement indépendante notifie toujours le client.
-- -----------------------------------------------------------------------------

create or replace function public.notifications_route_order_event(e public.order_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order  public.orders%rowtype;
  v_status text;
  v_ref    text;
  v_doc    uuid;
  v_type   text;
begin
  perform public.notifications_fault_check();
  select * into v_order from public.orders where id = e.order_id;
  if not found then
    return;
  end if;

  if e.event_type = 'PAIEMENT_DECLARE' and e.payment_id is not null then
    -- Le journal écrit aussi PAIEMENT_DECLARE pour des transitions annexes :
    -- seul un paiement réellement en attente de vérification ouvre l'action,
    -- et une seule fois par paiement (clé sémantique).
    select status into v_status from public.payments where id = e.payment_id;
    if v_status in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION') then
      perform public.notifications_create_for_admins('admin.paiement.a_verifier', 'payment', e.payment_id,
        public.notif_params(v_order.reference), 'payments', e.payment_id::text || ':a_verifier', e.actor_id);
    end if;

  elsif e.event_type in ('PAIEMENT_CONFIRME', 'PAIEMENT_REJETE', 'PAIEMENT_ANNULE') and e.payment_id is not null then
    perform public.notifications_resolve(array['admin.paiement.a_verifier'], 'payment', e.payment_id);
    -- Correctif 4G : la déclaration close par l'annulation de sa commande
    -- n'est pas un second événement pour le client.
    if e.event_type = 'PAIEMENT_ANNULE' and e.summary = 'Déclaration annulée avec la commande' then
      return;
    end if;
    v_type := case e.event_type
                when 'PAIEMENT_CONFIRME' then 'client.paiement.confirme'
                when 'PAIEMENT_REJETE'   then 'client.paiement.rejete'
                else 'client.paiement.annule'
              end;
    if v_order.user_id is not null then
      perform public.notifications_create(v_type, v_order.user_id, 'payment', e.payment_id,
        public.notif_params(v_order.reference), 'payments', e.payment_id::text || ':' || e.event_type, e.actor_id);
    end if;

  elsif e.event_type = 'REMBOURSEMENT_ENREGISTRE' and e.refund_id is not null then
    perform public.notifications_create_for_admins('admin.remboursement.a_executer', 'refund', e.refund_id,
      public.notif_params(v_order.reference), 'refunds', e.refund_id::text || ':a_executer', e.actor_id);

  elsif e.event_type = 'REMBOURSEMENT_EFFECTUE' and e.refund_id is not null then
    perform public.notifications_resolve(array['admin.remboursement.a_executer'], 'refund', e.refund_id);
    if v_order.user_id is not null then
      perform public.notifications_create('client.remboursement.effectue', v_order.user_id, 'refund', e.refund_id,
        public.notif_params(v_order.reference), 'refunds', e.refund_id::text || ':EFFECTUE', e.actor_id);
    end if;

  elsif e.event_type = 'DOCUMENT_EMIS' then
    -- Seule l'émission d'une facture FACL est un événement pour le client ;
    -- le bon de commande accompagne la commande, déjà notifiée.
    v_ref := substring(e.summary from '^Facture (MORA-FACL-[A-Z]{1,2}[0-9]{4}) émise$');
    if v_ref is not null and v_order.user_id is not null then
      select id into v_doc from public.documents
       where reference = v_ref and doc_type = 'FACL' and entity_id = v_order.id and status = 'EMIS';
      if v_doc is not null then
        perform public.notifications_create('client.facture.disponible', v_order.user_id, 'order', v_order.id,
          public.notif_params(v_order.reference), 'documents', v_doc::text, e.actor_id);
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.notifications_route_order_event(public.order_events) from public, anon, authenticated;
grant  execute on function public.notifications_route_order_event(public.order_events) to service_role;
