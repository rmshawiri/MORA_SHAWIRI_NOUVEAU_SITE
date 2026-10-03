-- =============================================================================
-- PHASE 4J-2 — BRANCHEMENT DES ÉVÉNEMENTS MÉTIER
--
-- Rapport 21. Socle 4J-1 (`20261003200000_notifications_socle.sql`) inchangé :
-- cette migration n'en modifie ni les tables, ni les fonctions, ni la RLS.
--
-- Principe : la base écrit déjà, par déclencheurs, un journal métier pour
-- chaque changement d'état — quel que soit le chemin (administration, espace
-- client, fonction SQL). Les notifications naissent donc de ces journaux,
-- par un déclencheur `AFTER INSERT` sur chacun, et non d'une action serveur
-- qui oublierait un chemin. Aucune fonction métier existante n'est réécrite.
--
--   journal                         → domaine
--   quote_request_events            → demandes et devis
--   appointment_events              → rendez-vous
--   order_status_history            → statuts de commande (création comprise)
--   order_events                    → paiements, remboursements, factures
--   affiliate_events                → prospects, commissions, coordonnées, fiche
--   affiliate_application_events    → candidatures
--   notification_events (file 4H)   → commission acquise / validée / ajustée,
--                                      versement confirmé
--   clients (insertion)             → nouveau client
--
-- Garanties :
--   * une panne du moteur de notifications n'annule JAMAIS l'acte métier :
--     chaque branchement est enveloppé dans un bloc d'exception qui consigne
--     l'échec dans `notification_failures` (observable, rejouable) ;
--   * idempotence : l'index unique du socle (destinataire, espace, type,
--     événement source) ; les clés sémantiques (`payments` / `<id>:a_verifier`)
--     regroupent les chemins multiples d'une même transition ;
--   * l'auteur de l'acte n'est jamais notifié (socle) ; un administrateur
--     suspendu n'est jamais destinataire (socle) ;
--   * aucune rétroactivité : seuls les événements écrits APRÈS cette
--     migration produisent une notification ; aucun historique n'est relu ;
--   * aucun e-mail, aucun Realtime, aucune tâche planifiée.
--
-- Exception minimale au gel 4H (arbitrage N18) : un déclencheur ajouté sur
-- `notification_events`, `affiliate_events` et `affiliate_application_events`,
-- et sur les tables d'affiliation pour la suppression (§ 6). Aucune fonction,
-- aucun calcul, aucune règle de 4H n'est modifié.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. OUTILS
-- -----------------------------------------------------------------------------

-- Une référence MORA-… n'entre dans une notification que si elle a la forme
-- attendue par le socle ; sinon la notification part sans référence.
create or replace function public.notif_params(p_reference text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_reference ~ '^MORA-[A-Z]{3,6}-[A-Z]{1,2}[0-9]{4}$'
             then jsonb_build_object('reference', p_reference)
           else '{}'::jsonb
         end;
$$;

comment on function public.notif_params(text) is
  'Données d''une notification réduites à une référence MORA-… valide, ou rien (N13).';

-- Panne contrôlée, pour les contrôles seulement : un réglage local à UNE
-- transaction (`set local mora.notifications_panne = 'on'`), posé par une
-- session SQL d'outillage. Aucun appelant applicatif ne le pose ; sans lui,
-- cette fonction ne fait rien.
create or replace function public.notifications_fault_check()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('mora.notifications_panne', true), '') = 'on' then
    raise exception 'Panne simulée du moteur de notifications (contrôle).' using errcode = 'P0001';
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. LES ÉCHECS : OBSERVABLES ET REJOUABLES
-- -----------------------------------------------------------------------------

create table if not exists public.notification_failures (
  id               bigint generated always as identity primary key,
  source_table     text not null,
  source_id        text not null,
  error_code       text,
  error_message    text,
  attempts         integer not null default 1,
  created_at       timestamptz not null default now(),
  last_attempt_at  timestamptz not null default now(),
  resolved_at      timestamptz,
  constraint notification_failures_source unique (source_table, source_id),
  constraint notification_failures_table check (source_table ~ '^[a-z][a-z0-9_]{2,62}$'),
  constraint notification_failures_message check (error_message is null or length(error_message) <= 300),
  constraint notification_failures_attempts check (attempts >= 1)
);

comment on table public.notification_failures is
  'Événements métier dont la notification a échoué (4J-2). L''acte métier, lui, a été conservé. Rejouables par notifications_retry_failures().';

create index if not exists notification_failures_open_idx
  on public.notification_failures (created_at) where resolved_at is null;

revoke all on public.notification_failures from anon, authenticated;
grant select on public.notification_failures to authenticated;
grant all on public.notification_failures to service_role;
alter table public.notification_failures enable row level security;

drop policy if exists notification_failures_select on public.notification_failures;
create policy notification_failures_select
  on public.notification_failures for select to authenticated
  using (public.has_permission('notifications.manage'));

-- Ne lève jamais : consigner un échec ne doit pas en créer un second.
create or replace function public.notifications_record_failure(
  p_source_table text,
  p_source_id    text,
  p_code         text,
  p_message      text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.notification_failures (source_table, source_id, error_code, error_message)
    values (p_source_table, p_source_id, left(p_code, 10), left(p_message, 300))
    on conflict (source_table, source_id) do update
      set attempts        = notification_failures.attempts + 1,
          error_code      = excluded.error_code,
          error_message   = excluded.error_message,
          last_attempt_at = now(),
          resolved_at     = null;
  exception when others then
    raise warning 'Notification non consignée (% / %) : %', p_source_table, p_source_id, sqlerrm;
  end;
  raise warning 'Notification en échec (% / %) : %', p_source_table, p_source_id, left(p_message, 300);
end;
$$;

revoke execute on function public.notifications_record_failure(text, text, text, text) from public, anon, authenticated;
grant  execute on function public.notifications_record_failure(text, text, text, text) to service_role;


-- -----------------------------------------------------------------------------
-- 3. LES ROUTEURS — un par journal
--
-- Internes (propriétaire de la base), jamais ouverts aux sessions. Chacun
-- lit l'événement, choisit le type, désigne le destinataire depuis la
-- ressource elle-même (jamais depuis une saisie) et crée ou résout.
-- -----------------------------------------------------------------------------

-- 3.1 Demandes et devis ---------------------------------------------------------
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
      -- Mis à la disposition du client : seulement s'il a un compte.
      if v_req.user_id is not null then
        perform public.notifications_create('client.devis.disponible', v_req.user_id, 'quote', v_quote.id,
          public.notif_params(v_quote.reference), 'quotes', v_quote.id::text || ':ENVOYE', e.actor_id);
      end if;
    else
      -- Accepté, refusé, annulé (nouvelle version) ou expiré : le client n'a
      -- plus rien à faire sur CE devis.
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

-- 3.2 Rendez-vous ---------------------------------------------------------------
-- Aucun rappel temporel (N19 : différé en attente de règle métier).
create or replace function public.notifications_route_appointment_event(e public.appointment_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ap   public.appointments%rowtype;
  v_pars jsonb;
begin
  perform public.notifications_fault_check();
  select * into v_ap from public.appointments where id = e.appointment_id;
  if not found then
    return;
  end if;
  v_pars := public.notif_params(v_ap.reference);
  if v_ap.scheduled_at is not null then
    v_pars := v_pars || jsonb_build_object('date', to_char(v_ap.scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;

  if e.kind = 'CREATION' then
    perform public.notifications_create_for_admins('admin.rendez_vous.nouveau', 'appointment', v_ap.id,
      public.notif_params(v_ap.reference), 'appointments', v_ap.id::text || ':nouveau', e.actor_id);

  elsif e.kind = 'STATUT' then
    if e.from_status = 'EN_ATTENTE' then
      perform public.notifications_resolve(array['admin.rendez_vous.nouveau'], 'appointment', v_ap.id);
    end if;
    if e.to_status = 'CONFIRME' and v_ap.user_id is not null then
      perform public.notifications_create('client.rendez_vous.confirme', v_ap.user_id, 'appointment', v_ap.id,
        v_pars, 'appointment_events', e.id::text, e.actor_id);
    elsif e.to_status = 'ANNULE' then
      if v_ap.user_id is not null and e.actor_id = v_ap.user_id then
        -- Le client a annulé lui-même : c'est l'administration qui doit le savoir.
        perform public.notifications_create_for_admins('admin.rendez_vous.annule_client', 'appointment', v_ap.id,
          public.notif_params(v_ap.reference), 'appointment_events', e.id::text, e.actor_id);
      elsif v_ap.user_id is not null then
        perform public.notifications_create('client.rendez_vous.annule', v_ap.user_id, 'appointment', v_ap.id,
          public.notif_params(v_ap.reference), 'appointment_events', e.id::text, e.actor_id);
      end if;
    end if;

  elsif e.kind = 'REPROGRAMMATION' and v_ap.user_id is not null then
    perform public.notifications_create('client.rendez_vous.reprogramme', v_ap.user_id, 'appointment', v_ap.id,
      v_pars, 'appointment_events', e.id::text, e.actor_id);
  end if;
end;
$$;

-- 3.3 Statuts de commande --------------------------------------------------------
-- EN_TRAITEMENT n'a pas de type au catalogue validé : il ne notifie pas.
create or replace function public.notifications_route_order_status(e public.order_status_history)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_type  text;
begin
  perform public.notifications_fault_check();
  select * into v_order from public.orders where id = e.order_id;
  if not found then
    return;
  end if;

  if e.from_status is null then
    if v_order.user_id is not null then
      perform public.notifications_create('client.commande.enregistree', v_order.user_id, 'order', v_order.id,
        public.notif_params(v_order.reference), 'order_status_history', e.id::text, e.actor_id);
    end if;
    -- La commande née d'un devis accepté clôt l'action « commande à créer ».
    if v_order.quote_request_id is not null then
      perform public.notifications_resolve(array['admin.devis.accepte'], 'quote_request', v_order.quote_request_id);
    end if;
    return;
  end if;

  if e.from_status = 'EN_ATTENTE_INFO' then
    perform public.notifications_resolve(array['client.commande.attente_information'], 'order', v_order.id);
  end if;

  v_type := case e.to_status
              when 'CONFIRMEE'       then 'client.commande.confirmee'
              when 'EN_ATTENTE_INFO' then 'client.commande.attente_information'
              when 'PRETE'           then 'client.commande.prete'
              when 'TERMINEE'        then 'client.commande.terminee'
              when 'ANNULEE'         then 'client.commande.annulee'
            end;
  if v_type is not null and v_order.user_id is not null then
    perform public.notifications_create(v_type, v_order.user_id, 'order', v_order.id,
      public.notif_params(v_order.reference), 'order_status_history', e.id::text, e.actor_id);
  end if;
end;
$$;

-- 3.4 Paiements, remboursements, factures ---------------------------------------
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

-- 3.5 Affiliation : journal ------------------------------------------------------
-- Commission acquise, validée, ajustée et versement confirmé viennent de la
-- file 4H (§ 3.6) : ils sont ignorés ici pour ne jamais notifier deux fois
-- la même transition.
create or replace function public.notifications_route_affiliate_event(e public.affiliate_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_aff  public.affiliates%rowtype;
  v_pid  uuid;
  v_cid  uuid;
  v_cref text;
begin
  perform public.notifications_fault_check();
  if e.affiliate_id is null then
    return;
  end if;
  select * into v_aff from public.affiliates where id = e.affiliate_id;
  if not found then
    return;
  end if;

  if e.event_type = 'PROSPECT_DECLARE' then
    v_pid := nullif(e.new_value ->> 'prospect', '')::uuid;
    if v_pid is not null then
      perform public.notifications_create_for_admins('admin.prospect.a_examiner', 'affiliate_prospect', v_pid,
        '{}'::jsonb, 'affiliate_prospects', v_pid::text || ':a_examiner', e.actor_id);
    end if;

  elsif e.event_type in ('PROSPECT_RECONNU', 'PROSPECT_REFUSE') then
    v_pid := nullif(e.new_value ->> 'prospect', '')::uuid;
    if v_pid is not null then
      perform public.notifications_resolve(array['admin.prospect.a_examiner'], 'affiliate_prospect', v_pid);
      if v_aff.user_id is not null then
        -- Aucune donnée du prospect : ni nom, ni téléphone, ni adresse.
        perform public.notifications_create(
          case e.event_type when 'PROSPECT_RECONNU' then 'affilie.prospect.valide' else 'affilie.prospect.refuse' end,
          v_aff.user_id, 'affiliate_prospect', v_pid, '{}'::jsonb, 'affiliate_events', e.id::text, e.actor_id);
      end if;
    end if;

  elsif e.event_type = 'PROSPECT_ANNULE' then
    -- Le journal 4H ne porte pas l'identifiant : le prospect annulé l'a été
    -- dans cette même transaction.
    for v_pid in
      select p.id from public.affiliate_prospects p
       where p.affiliate_id = e.affiliate_id and p.status = 'ANNULE' and p.updated_at = now()
    loop
      perform public.notifications_resolve(array['admin.prospect.a_examiner'], 'affiliate_prospect', v_pid);
    end loop;

  elsif e.event_type in ('COMMISSION_PREVISIONNELLE', 'COMMISSION_ANNULEE', 'COMMISSION_ANNULEE_APRES_VERSEMENT') then
    v_cref := e.new_value ->> 'commission';
    select id into v_cid from public.affiliate_commissions where reference = v_cref and affiliate_id = e.affiliate_id;
    if v_cid is not null and v_aff.user_id is not null then
      if e.event_type = 'COMMISSION_PREVISIONNELLE' then
        perform public.notifications_create('affilie.commission.enregistree', v_aff.user_id, 'affiliate_commission', v_cid,
          public.notif_params(v_cref), 'affiliate_commissions', v_cid::text || ':enregistree', e.actor_id);
      else
        -- Les deux formes d'annulation de 4H sont une seule transition.
        perform public.notifications_create('affilie.commission.annulee', v_aff.user_id, 'affiliate_commission', v_cid,
          public.notif_params(v_cref), 'affiliate_commissions', v_cid::text || ':annulee', e.actor_id);
      end if;
    end if;

  elsif e.event_type in ('COORDONNEES_DEMANDEES', 'COORDONNEES_SAISIES') then
    -- Une nouvelle demande remplace la précédente (4H la retire) : l'ancienne
    -- action est close, la nouvelle s'ouvre.
    perform public.notifications_resolve(array['admin.coordonnees.a_examiner'], 'affiliate', v_aff.id);
    perform public.notifications_resolve(array['affilie.coordonnees.refusees'], 'affiliate', v_aff.id);
    perform public.notifications_create_for_admins('admin.coordonnees.a_examiner', 'affiliate', v_aff.id,
      public.notif_params(v_aff.reference), 'affiliate_events', e.id::text, e.actor_id);

  elsif e.event_type in ('COORDONNEES_VALIDEES', 'COORDONNEES_REFUSEES') then
    perform public.notifications_resolve(array['admin.coordonnees.a_examiner'], 'affiliate', v_aff.id);
    if e.event_type = 'COORDONNEES_VALIDEES' then
      perform public.notifications_resolve(array['affilie.coordonnees.refusees'], 'affiliate', v_aff.id);
    end if;
    if v_aff.user_id is not null then
      perform public.notifications_create(
        case e.event_type when 'COORDONNEES_VALIDEES' then 'affilie.coordonnees.validees' else 'affilie.coordonnees.refusees' end,
        v_aff.user_id, 'affiliate', v_aff.id, '{}'::jsonb, 'affiliate_events', e.id::text, e.actor_id);
    end if;

  elsif e.event_type = 'FICHE_EMISE' and v_aff.user_id is not null then
    perform public.notifications_create('affilie.fiche.mise_a_jour', v_aff.user_id, 'affiliate', v_aff.id,
      public.notif_params(e.new_value ->> 'document'), 'affiliate_events', e.id::text, e.actor_id);
  end if;
end;
$$;

-- 3.6 Affiliation : la file 4H ---------------------------------------------------
create or replace function public.notifications_route_queue_event(e public.notification_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_type   text;
  v_entity text;
begin
  perform public.notifications_fault_check();
  if e.status <> 'EN_ATTENTE' then
    return;
  end if;

  if e.event_type = 'affiliation.commission.acquise' then
    v_entity := 'affiliate_commission';
    -- 4H met en file « acquise » aussi lors d'une validation manuelle, qu'il
    -- consigne juste avant au journal : c'est alors « validée », une seule
    -- notification pour une seule transition.
    if exists (
      select 1
        from public.affiliate_events ae
        join public.affiliate_commissions c on c.reference = ae.new_value ->> 'commission'
       where c.id = e.entity_id and ae.event_type = 'COMMISSION_VALIDEE' and ae.created_at = now()
    ) then
      v_type := 'affilie.commission.validee';
    else
      v_type := 'affilie.commission.acquise';
    end if;
  elsif e.event_type = 'affiliation.commission.ajustee' then
    v_type := 'affilie.commission.ajustee';
    v_entity := 'affiliate_commission';
  elsif e.event_type = 'affiliation.versement.confirme' then
    v_type := 'affilie.versement.confirme';
    v_entity := 'affiliate_payout';
  end if;

  if v_type is null or e.recipient_id is null or e.entity_type is distinct from v_entity then
    update public.notification_events set status = 'IGNORE', processed_at = now() where id = e.id and status = 'EN_ATTENTE';
    return;
  end if;

  perform public.notifications_create(v_type, e.recipient_id, v_entity, e.entity_id,
    public.notif_params(e.payload ->> 'reference'), 'notification_events', e.id::text, auth.uid());
  update public.notification_events set status = 'TRAITE', processed_at = now() where id = e.id and status = 'EN_ATTENTE';
end;
$$;

-- 3.7 Candidatures d'affiliation -------------------------------------------------
create or replace function public.notifications_route_application_event(e public.affiliate_application_events)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.notifications_fault_check();
  if e.event_type = 'CANDIDATURE_RECUE' then
    perform public.notifications_create_for_admins('admin.candidature.nouvelle', 'affiliate_application', e.application_id,
      '{}'::jsonb, 'affiliate_applications', e.application_id::text || ':nouvelle', e.actor_id);
  elsif e.new_status is not null and e.new_status <> 'NOUVELLE' then
    perform public.notifications_resolve(array['admin.candidature.nouvelle'], 'affiliate_application', e.application_id);
  end if;
end;
$$;

-- 3.8 Nouveau client ---------------------------------------------------------------
create or replace function public.notifications_route_client(c public.clients)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.notifications_fault_check();
  perform public.notifications_create_for_admins('admin.client.nouveau', 'client', c.user_id,
    public.notif_params(c.reference), 'clients', c.user_id::text, auth.uid());
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'notifications_route_quote_request_event(public.quote_request_events)',
    'notifications_route_appointment_event(public.appointment_events)',
    'notifications_route_order_status(public.order_status_history)',
    'notifications_route_order_event(public.order_events)',
    'notifications_route_affiliate_event(public.affiliate_events)',
    'notifications_route_queue_event(public.notification_events)',
    'notifications_route_application_event(public.affiliate_application_events)',
    'notifications_route_client(public.clients)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. LES DÉCLENCHEURS — l'acte métier d'abord, toujours
--
-- Chaque déclencheur appelle son routeur dans un bloc d'exception : si la
-- notification échoue, l'échec est consigné et l'acte métier se poursuit.
-- -----------------------------------------------------------------------------

create or replace function public.tg_notify_quote_request_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_quote_request_event(new);
  exception when others then
    perform public.notifications_record_failure('quote_request_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_appointment_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_appointment_event(new);
  exception when others then
    perform public.notifications_record_failure('appointment_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_order_status_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_order_status(new);
  exception when others then
    perform public.notifications_record_failure('order_status_history', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_order_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_order_event(new);
  exception when others then
    perform public.notifications_record_failure('order_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_affiliate_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_affiliate_event(new);
  exception when others then
    perform public.notifications_record_failure('affiliate_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_notification_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_queue_event(new);
  exception when others then
    -- L'événement reste EN_ATTENTE dans la file : la reprise le consommera.
    perform public.notifications_record_failure('notification_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_application_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_application_event(new);
  exception when others then
    perform public.notifications_record_failure('affiliate_application_events', new.id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

create or replace function public.tg_notify_clients()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.notifications_route_client(new);
  exception when others then
    perform public.notifications_record_failure('clients', new.user_id::text, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists notify_quote_request_events on public.quote_request_events;
create trigger notify_quote_request_events
  after insert on public.quote_request_events
  for each row execute function public.tg_notify_quote_request_events();

drop trigger if exists notify_appointment_events on public.appointment_events;
create trigger notify_appointment_events
  after insert on public.appointment_events
  for each row execute function public.tg_notify_appointment_events();

drop trigger if exists notify_order_status_history on public.order_status_history;
create trigger notify_order_status_history
  after insert on public.order_status_history
  for each row execute function public.tg_notify_order_status_history();

drop trigger if exists notify_order_events on public.order_events;
create trigger notify_order_events
  after insert on public.order_events
  for each row execute function public.tg_notify_order_events();

drop trigger if exists notify_affiliate_events on public.affiliate_events;
create trigger notify_affiliate_events
  after insert on public.affiliate_events
  for each row execute function public.tg_notify_affiliate_events();

drop trigger if exists notify_notification_events on public.notification_events;
create trigger notify_notification_events
  after insert on public.notification_events
  for each row execute function public.tg_notify_notification_events();

drop trigger if exists notify_application_events on public.affiliate_application_events;
create trigger notify_application_events
  after insert on public.affiliate_application_events
  for each row execute function public.tg_notify_application_events();

drop trigger if exists notify_clients on public.clients;
create trigger notify_clients
  after insert on public.clients
  for each row execute function public.tg_notify_clients();


-- -----------------------------------------------------------------------------
-- 5. LA REPRISE
--
-- Rejoue les événements consignés en échec. L'index unique du socle rend la
-- reprise sans risque : rejouer un événement déjà notifié ne crée rien.
-- -----------------------------------------------------------------------------

create or replace function public.notifications_retry_failures(p_limit integer default 100)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f      public.notification_failures%rowtype;
  v_ok   integer := 0;
  r_qr   public.quote_request_events%rowtype;
  r_ap   public.appointment_events%rowtype;
  r_osh  public.order_status_history%rowtype;
  r_oe   public.order_events%rowtype;
  r_ae   public.affiliate_events%rowtype;
  r_ne   public.notification_events%rowtype;
  r_app  public.affiliate_application_events%rowtype;
  r_cl   public.clients%rowtype;
begin
  for f in
    select * from public.notification_failures where resolved_at is null order by id limit greatest(1, p_limit)
  loop
    begin
      case f.source_table
        when 'quote_request_events' then
          select * into r_qr from public.quote_request_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_quote_request_event(r_qr); end if;
        when 'appointment_events' then
          select * into r_ap from public.appointment_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_appointment_event(r_ap); end if;
        when 'order_status_history' then
          select * into r_osh from public.order_status_history where id = f.source_id::bigint;
          if found then perform public.notifications_route_order_status(r_osh); end if;
        when 'order_events' then
          select * into r_oe from public.order_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_order_event(r_oe); end if;
        when 'affiliate_events' then
          select * into r_ae from public.affiliate_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_affiliate_event(r_ae); end if;
        when 'notification_events' then
          select * into r_ne from public.notification_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_queue_event(r_ne); end if;
        when 'affiliate_application_events' then
          select * into r_app from public.affiliate_application_events where id = f.source_id::bigint;
          if found then perform public.notifications_route_application_event(r_app); end if;
        when 'clients' then
          select * into r_cl from public.clients where user_id = f.source_id::uuid;
          if found then perform public.notifications_route_client(r_cl); end if;
        else
          null;
      end case;
      update public.notification_failures
         set resolved_at = now(), attempts = attempts + 1, last_attempt_at = now()
       where id = f.id;
      v_ok := v_ok + 1;
    exception when others then
      update public.notification_failures
         set attempts = attempts + 1, last_attempt_at = now(),
             error_code = left(sqlstate, 10), error_message = left(sqlerrm, 300)
       where id = f.id;
    end;
  end loop;
  return v_ok;
end;
$$;

comment on function public.notifications_retry_failures(integer) is
  'Rejoue les notifications en échec (4J-2). Sans doublon : l''unicité du socle absorbe un événement déjà notifié. Serveur seul.';

revoke execute on function public.notifications_retry_failures(integer) from public, anon, authenticated;
grant  execute on function public.notifications_retry_failures(integer) to service_role;


-- -----------------------------------------------------------------------------
-- 6. UNE NOTIFICATION NE SURVIT PAS À SA RESSOURCE
--
-- `07_NOTIFICATIONS` § 112 : aucune notification ne pointe vers une ressource
-- inexistante. Les données réelles ne sont jamais supprimées (gardes de 4D à
-- 4I) ; ce nettoyage ne joue donc que lorsqu'une ressource disparaît
-- réellement — en pratique, au démontage des contrôles, qui ne laissent ainsi
-- aucune notification chez les vrais administrateurs.
-- -----------------------------------------------------------------------------

create or replace function public.tg_notifications_entity_gone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notifications
   where entity_type = tg_argv[0]
     and entity_id = (to_jsonb(old) ->> tg_argv[1])::uuid;
  return null;
end;
$$;

drop trigger if exists notifications_gone_quote_requests on public.quote_requests;
create trigger notifications_gone_quote_requests after delete on public.quote_requests
  for each row execute function public.tg_notifications_entity_gone('quote_request', 'id');
drop trigger if exists notifications_gone_quotes on public.quotes;
create trigger notifications_gone_quotes after delete on public.quotes
  for each row execute function public.tg_notifications_entity_gone('quote', 'id');
drop trigger if exists notifications_gone_appointments on public.appointments;
create trigger notifications_gone_appointments after delete on public.appointments
  for each row execute function public.tg_notifications_entity_gone('appointment', 'id');
drop trigger if exists notifications_gone_orders on public.orders;
create trigger notifications_gone_orders after delete on public.orders
  for each row execute function public.tg_notifications_entity_gone('order', 'id');
drop trigger if exists notifications_gone_payments on public.payments;
create trigger notifications_gone_payments after delete on public.payments
  for each row execute function public.tg_notifications_entity_gone('payment', 'id');
drop trigger if exists notifications_gone_refunds on public.refunds;
create trigger notifications_gone_refunds after delete on public.refunds
  for each row execute function public.tg_notifications_entity_gone('refund', 'id');
drop trigger if exists notifications_gone_clients on public.clients;
create trigger notifications_gone_clients after delete on public.clients
  for each row execute function public.tg_notifications_entity_gone('client', 'user_id');
drop trigger if exists notifications_gone_affiliates on public.affiliates;
create trigger notifications_gone_affiliates after delete on public.affiliates
  for each row execute function public.tg_notifications_entity_gone('affiliate', 'id');
drop trigger if exists notifications_gone_applications on public.affiliate_applications;
create trigger notifications_gone_applications after delete on public.affiliate_applications
  for each row execute function public.tg_notifications_entity_gone('affiliate_application', 'id');
drop trigger if exists notifications_gone_prospects on public.affiliate_prospects;
create trigger notifications_gone_prospects after delete on public.affiliate_prospects
  for each row execute function public.tg_notifications_entity_gone('affiliate_prospect', 'id');
drop trigger if exists notifications_gone_commissions on public.affiliate_commissions;
create trigger notifications_gone_commissions after delete on public.affiliate_commissions
  for each row execute function public.tg_notifications_entity_gone('affiliate_commission', 'id');
drop trigger if exists notifications_gone_payouts on public.affiliate_payouts;
create trigger notifications_gone_payouts after delete on public.affiliate_payouts
  for each row execute function public.tg_notifications_entity_gone('affiliate_payout', 'id');
