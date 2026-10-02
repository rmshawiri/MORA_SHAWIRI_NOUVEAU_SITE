-- =============================================================================
-- PHASE 4I-3 — ESPACE CLIENT : DEMANDES, DEVIS, RENDEZ-VOUS
--
-- Décisions du propriétaire (2 octobre 2026) :
--   1. le client accepte ou refuse son devis (motif de refus facultatif) ;
--      accepter ne crée jamais de commande ;
--   2. le client annule son rendez-vous tant qu'il n'a pas commencé, motif
--      obligatoire, aucun délai minimal ; aucune reprogrammation ;
--   3. une demande faite hors connexion se rattache au compte dont l'adresse
--      **confirmée** est exactement la sienne — par un mécanisme explicite,
--      idempotent et journalisé ; les demandes antérieures à ce mécanisme ne
--      se rattachent que par un acte administratif explicite (MORA-DMCL-A0001
--      n'est pas touchée ici).
--
-- Et une correction de séparation : les historiques métier mêlent des
-- événements internes (affectation, devis en brouillon, identité des
-- acteurs) aux événements destinés au client. Le client ne lit plus ces
-- tables directement ; il lit sa chronologie par deux fonctions qui ne
-- rendent que ce qui le concerne.
--
-- Toutes les fonctions client exigent : session, compte actif (ni suspendu,
-- ni désactivé, ni supprimé), propriété par `auth.uid()`. Elles revérifient
-- elles-mêmes l'état et la transition : à l'intérieur d'une fonction
-- SECURITY DEFINER, les gardes déclenchées voient un rôle privilégié et ne
-- refusent plus aucune permission (piège consigné en 4F).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. COLONNES
--
-- Aucune n'est accordée en écriture aux sessions : seules les fonctions
-- ci-dessous les remplissent. Un administrateur ne peut donc pas faire passer
-- une décision pour celle du client.
-- -----------------------------------------------------------------------------

alter table public.quotes
  add column if not exists responded_by uuid references public.profiles (id) on delete set null,
  add column if not exists client_response_reason text;

alter table public.quotes drop constraint if exists quotes_client_response_reason_length;
alter table public.quotes add constraint quotes_client_response_reason_length
  check (client_response_reason is null or length(client_response_reason) between 1 and 1000);

comment on column public.quotes.responded_by is
  'Compte qui a répondu au devis depuis l''espace client (4I-3). Nul quand la réponse a été saisie par l''administration.';
comment on column public.quotes.client_response_reason is
  'Motif donné par le client en refusant le devis (facultatif). Visible de l''administration et de la chronologie.';

alter table public.appointments
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null;

comment on column public.appointments.cancelled_by is
  'Compte qui a annulé le rendez-vous depuis l''espace client (4I-3). Nul pour une annulation administrative.';


-- -----------------------------------------------------------------------------
-- 2. LE MOTIF DU CLIENT DANS L'HISTORIQUE DU DEVIS
--
-- Reprise exacte de `tg_quotes_history` (4F), plus une seule chose : quand la
-- décision vient du client, son motif rejoint la note de l'événement.
-- -----------------------------------------------------------------------------

create or replace function public.tg_quotes_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.quote_request_events
      (quote_request_id, kind, to_status, quote_reference, actor_id, actor_label)
    values
      (new.quote_request_id, 'DEVIS_CREE', new.status, new.reference,
       auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.quote_request_events
      (quote_request_id, kind, from_status, to_status, quote_reference, note, actor_id, actor_label)
    values
      (new.quote_request_id, 'DEVIS_STATUT', old.status, new.status, new.reference,
       case when new.responded_by is not null and new.status in ('ACCEPTE', 'REFUSE')
            then new.client_response_reason end,
       auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$$;

comment on function public.tg_quotes_history() is
  'Consigne le cycle du devis dans l''historique de sa demande ; le motif d''une décision du client y figure (4I-3).';


-- -----------------------------------------------------------------------------
-- 3. LE CLIENT NE LIT PLUS LES HISTORIQUES BRUTS
--
-- Les politiques « propriétaire » de 4F ouvraient au client toutes les lignes
-- de l'historique de sa demande ou de son rendez-vous : affectations internes,
-- création d'un devis encore en brouillon, nom de l'agent. La RLS juge une
-- ligne, pas une colonne : on ne peut pas y cacher `actor_label`. Le client lit
-- désormais sa chronologie par `my_request_timeline` et
-- `my_appointment_timeline`. L'administration garde ses politiques.
-- -----------------------------------------------------------------------------

drop policy if exists qr_events_select_own on public.quote_request_events;
drop policy if exists ap_events_select_own on public.appointment_events;


-- -----------------------------------------------------------------------------
-- 4. IDENTITÉ D'UN CLIENT ACTIF
-- -----------------------------------------------------------------------------

create or replace function public.client_session_is_active(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_uid and p.status = 'ACTIF' and p.deleted_at is null
  );
$$;

revoke execute on function public.client_session_is_active(uuid) from public, anon, authenticated;

-- Adresse confirmée et normalisée d'un compte CLIENT actif — ou nul. C'est la
-- seule clé du rattachement : ni nom, ni téléphone, ni WhatsApp.
create or replace function public.client_confirmed_email(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(btrim(u.email))
    from auth.users u
   where u.id = p_uid
     and u.email is not null
     and u.email_confirmed_at is not null
     and public.client_session_is_active(p_uid)
     and exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = p_uid and r.code = 'CLIENT'
     );
$$;

revoke execute on function public.client_confirmed_email(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. DATE DE MISE EN SERVICE DU RATTACHEMENT
--
-- Les demandes déposées hors connexion **à partir de maintenant** pourront
-- être récupérées par leur titulaire. Les plus anciennes (dont
-- MORA-DMCL-A0001) ne se rattachent que par un acte administratif explicite :
-- ni cette migration, ni un déploiement, ni un contrôle ne les modifie.
-- -----------------------------------------------------------------------------

insert into public.settings (key, value, scope, label, description)
values (
  'relation.rattachement_depuis',
  to_jsonb(now()),
  'PRIVE',
  'Rattachement des demandes hors connexion — mise en service',
  'Seules les demandes et rendez-vous créés depuis cette date se rattachent par le client lui-même. Les plus anciens exigent un acte administratif.'
)
on conflict (key) do nothing;

create or replace function public.relation_claim_since()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (value #>> '{}')::timestamptz from public.settings where key = 'relation.rattachement_depuis'), 'infinity'::timestamptz);
$$;

revoke execute on function public.relation_claim_since() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6. RATTACHEMENT PAR LE CLIENT
--
-- `my_claimable_requests` : ce qui peut être rattaché (affiché au client, qui
-- confirme). `claim_my_requests` : le rattachement lui-même.
--
-- Conditions, toutes vérifiées en base : session ; compte CLIENT actif ;
-- adresse confirmée ; égalité exacte avec l'adresse normalisée de la demande
-- (`leads.email`, déjà normalisée en 4F) ; demande sans titulaire ; prospect
-- sans titulaire ou déjà rattaché à ce même compte (sinon : conflit, rien
-- n'est rattaché) ; création postérieure à la mise en service.
--
-- Pourquoi une confirmation du client plutôt qu'un rattachement à son insu :
-- n'importe qui peut déposer une demande au nom d'une adresse. Le client voit
-- ce qui a été envoyé avec son adresse et décide de le reprendre.
--
-- Idempotent : la ligne du prospect est verrouillée ; un second appel, même
-- simultané, ne trouve plus rien à rattacher.
-- -----------------------------------------------------------------------------

create or replace function public.my_claimable_requests()
returns table (item_kind text, item_id uuid, reference text, subject text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return;
  end if;
  v_email := public.client_confirmed_email(v_uid);
  if v_email is null then
    return;
  end if;

  return query
    select 'DEMANDE'::text, qr.id, qr.reference, coalesce(qr.offer_title, qr.subject), qr.created_at
      from public.quote_requests qr
      join public.leads l on l.id = qr.lead_id
     where l.email = v_email
       and qr.user_id is null
       and (l.user_id is null or l.user_id = v_uid)
       and qr.created_at >= public.relation_claim_since()
    union all
    select 'RENDEZ_VOUS'::text, ap.id, ap.reference, ap.subject, ap.created_at
      from public.appointments ap
      join public.leads l on l.id = ap.lead_id
     where l.email = v_email
       and ap.user_id is null
       and (l.user_id is null or l.user_id = v_uid)
       and ap.created_at >= public.relation_claim_since()
     order by 5;
end;
$$;

comment on function public.my_claimable_requests() is
  'Demandes et rendez-vous déposés hors connexion avec l''adresse confirmée du compte CLIENT connecté, depuis la mise en service (4I-3).';

revoke execute on function public.my_claimable_requests() from public, anon;
grant  execute on function public.my_claimable_requests() to authenticated, service_role;


create or replace function public.claim_my_requests()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_email      text;
  v_since      timestamptz := public.relation_claim_since();
  v_lead       public.leads%rowtype;
  v_requests   text[] := '{}';
  v_new        text[];
  v_appts      int := 0;
  v_conflicts  int := 0;
  v_count      int;
begin
  if v_uid is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;
  v_email := public.client_confirmed_email(v_uid);
  if v_email is null then
    raise exception 'Rattachement impossible : il faut un compte client actif dont l''adresse est confirmée.'
      using errcode = '42501';
  end if;

  for v_lead in
    select * from public.leads where email = v_email for update
  loop
    if v_lead.user_id is not null and v_lead.user_id <> v_uid then
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    with attached as (
      update public.quote_requests
         set user_id = v_uid
       where lead_id = v_lead.id and user_id is null and created_at >= v_since
      returning reference
    )
    select coalesce(array_agg(reference), '{}'::text[]) into v_new from attached;
    v_requests := array_cat(v_requests, v_new);

    update public.appointments
       set user_id = v_uid
     where lead_id = v_lead.id and user_id is null and created_at >= v_since;
    get diagnostics v_count = row_count;
    v_appts := v_appts + v_count;

    if v_lead.user_id is null and (cardinality(v_new) > 0 or v_count > 0) then
      update public.leads set user_id = v_uid where id = v_lead.id;
    end if;
  end loop;

  if cardinality(v_requests) > 0 or v_appts > 0 then
    perform public.record_audit_event(
      'relation.rattachement', 'client', coalesce((select reference from public.clients where user_id = v_uid), v_uid::text), 'SUCCES',
      jsonb_build_object('demandes', to_jsonb(v_requests), 'rendez_vous', v_appts, 'regle', 'adresse_confirmee')
    );
  end if;

  return jsonb_build_object('demandes', cardinality(v_requests), 'references', to_jsonb(v_requests),
                            'rendez_vous', v_appts, 'conflits', v_conflicts);
end;
$$;

comment on function public.claim_my_requests() is
  'Rattache au compte CLIENT connecté (adresse confirmée, égalité exacte) ses demandes et rendez-vous déposés hors connexion depuis la mise en service. Idempotent, journalisé.';

revoke execute on function public.claim_my_requests() from public, anon;
grant  execute on function public.claim_my_requests() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. DEMANDES ANTÉRIEURES : DÉTECTION ET ACTE ADMINISTRATIF EXPLICITE
--
-- Détection : `historical_claimable_requests` (users.view + quotes.view).
-- Rattachement : `attach_historical_request` (users.update + quotes.manage),
-- un élément à la fois, motif obligatoire, journalisé. Mêmes conditions que
-- ci-dessus, la date en moins. Aucun appel n'en est fait par cette migration.
-- -----------------------------------------------------------------------------

create or replace function public.historical_claimable_requests()
returns table (item_kind text, item_id uuid, reference text, subject text, created_at timestamptz,
               client_user_id uuid, client_reference text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('users.view') and public.has_permission('quotes.view')) then
    raise exception 'Permissions users.view et quotes.view requises.' using errcode = '42501';
  end if;

  return query
    with accounts as (
      select u.id as uid, lower(btrim(u.email)) as email
        from auth.users u
       where u.email is not null and u.email_confirmed_at is not null
         and public.client_confirmed_email(u.id) is not null
    )
    select 'DEMANDE'::text, qr.id, qr.reference, coalesce(qr.offer_title, qr.subject), qr.created_at, a.uid, c.reference
      from public.quote_requests qr
      join public.leads l on l.id = qr.lead_id
      join accounts a on a.email = l.email
      left join public.clients c on c.user_id = a.uid
     where qr.user_id is null and (l.user_id is null or l.user_id = a.uid)
       and qr.created_at < public.relation_claim_since()
    union all
    select 'RENDEZ_VOUS'::text, ap.id, ap.reference, ap.subject, ap.created_at, a.uid, c.reference
      from public.appointments ap
      join public.leads l on l.id = ap.lead_id
      join accounts a on a.email = l.email
      left join public.clients c on c.user_id = a.uid
     where ap.user_id is null and (l.user_id is null or l.user_id = a.uid)
       and ap.created_at < public.relation_claim_since()
     order by 5;
end;
$$;

revoke execute on function public.historical_claimable_requests() from public, anon;
grant  execute on function public.historical_claimable_requests() to authenticated, service_role;


create or replace function public.attach_historical_request(p_kind text, p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lead    public.leads%rowtype;
  v_lead_id uuid;
  v_ref     text;
  v_uid     uuid;
begin
  if not (public.has_permission('users.update') and public.has_permission('quotes.manage')) then
    raise exception 'Permissions users.update et quotes.manage requises.' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Motif obligatoire (500 caractères au plus).' using errcode = 'check_violation';
  end if;

  if p_kind = 'DEMANDE' then
    select lead_id, reference into v_lead_id, v_ref from public.quote_requests where id = p_item_id and user_id is null for update;
  elsif p_kind = 'RENDEZ_VOUS' then
    select lead_id, coalesce(reference, id::text) into v_lead_id, v_ref from public.appointments where id = p_item_id and user_id is null for update;
  else
    raise exception 'Type inconnu.' using errcode = 'check_violation';
  end if;
  if v_lead_id is null then
    raise exception 'Élément introuvable ou déjà rattaché.' using errcode = 'no_data_found';
  end if;

  select * into v_lead from public.leads where id = v_lead_id for update;
  select u.id into v_uid from auth.users u
   where lower(btrim(u.email)) = v_lead.email and public.client_confirmed_email(u.id) is not null;
  if v_uid is null then
    raise exception 'Aucun compte client actif à adresse confirmée ne correspond exactement.' using errcode = 'check_violation';
  end if;
  if v_lead.user_id is not null and v_lead.user_id <> v_uid then
    raise exception 'Conflit : le prospect est déjà rattaché à un autre compte.' using errcode = 'check_violation';
  end if;

  if p_kind = 'DEMANDE' then
    update public.quote_requests set user_id = v_uid where id = p_item_id;
  else
    update public.appointments set user_id = v_uid where id = p_item_id;
  end if;
  if v_lead.user_id is null then
    update public.leads set user_id = v_uid where id = v_lead.id;
  end if;

  perform public.record_audit_event(
    'relation.rattachement_historique', 'client', coalesce((select reference from public.clients where user_id = v_uid), v_uid::text), 'SUCCES',
    jsonb_build_object('element', v_ref, 'type', p_kind, 'motif', v_reason, 'regle', 'adresse_confirmee')
  );
  return jsonb_build_object('element', v_ref, 'compte', v_uid);
end;
$$;

comment on function public.attach_historical_request(text, uuid, text) is
  'Acte administratif explicite : rattache une demande ou un rendez-vous antérieur à la mise en service au compte CLIENT dont l''adresse confirmée correspond exactement. Motif obligatoire, journalisé.';

revoke execute on function public.attach_historical_request(text, uuid, text) from public, anon;
grant  execute on function public.attach_historical_request(text, uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. DÉCISION DU CLIENT SUR SON DEVIS
-- -----------------------------------------------------------------------------

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

  -- Propriété et verrou en une lecture : le devis d'autrui, comme un
  -- brouillon, est introuvable. Le verrou sérialise le client et
  -- l'administration ; le second relit l'état laissé par le premier.
  select q.* into v_quote
    from public.quotes q
    join public.quote_requests qr on qr.id = q.quote_request_id
   where q.id = p_quote_id and qr.user_id = v_uid and q.status <> 'BROUILLON'
     for update of q;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  -- Double clic : la même décision, déjà enregistrée par ce compte.
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
  'Le client accepte ou refuse son devis envoyé (motif de refus facultatif). Ne crée aucune commande. Propriété, compte actif, état et validité vérifiés sous verrou.';

revoke execute on function public.respond_to_my_quote(uuid, text, text) from public, anon;
grant  execute on function public.respond_to_my_quote(uuid, text, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 9. ANNULATION D'UN RENDEZ-VOUS PAR LE CLIENT
-- -----------------------------------------------------------------------------

create or replace function public.cancel_my_appointment(p_appointment_id uuid, p_reason text)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_appt   public.appointments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_prev   text;
begin
  if v_uid is null or not public.client_session_is_active(v_uid) then
    raise exception 'Session active requise.' using errcode = '42501';
  end if;

  select * into v_appt from public.appointments
   where id = p_appointment_id and user_id = v_uid
     for update;
  if not found then
    raise exception 'Rendez-vous introuvable.' using errcode = 'no_data_found';
  end if;

  if v_appt.status = 'ANNULE' and v_appt.cancelled_by = v_uid then
    return v_appt;
  end if;

  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Indiquez le motif de l''annulation (3 à 500 caractères).' using errcode = 'check_violation';
  end if;
  if v_appt.status not in ('EN_ATTENTE', 'CONFIRME') then
    raise exception 'Ce rendez-vous ne peut plus être annulé.' using errcode = 'check_violation';
  end if;
  -- Aucun délai minimal (décision du propriétaire) : seulement « pas encore commencé ».
  if v_appt.scheduled_at is not null and now() >= v_appt.scheduled_at then
    raise exception 'Ce rendez-vous a déjà commencé : il ne peut plus être annulé ici.' using errcode = 'check_violation';
  end if;

  v_prev := v_appt.status;
  update public.appointments
     set status = 'ANNULE', cancel_reason = v_reason, cancelled_by = v_uid
   where id = v_appt.id
  returning * into v_appt;

  perform public.record_audit_event(
    'relation.rendez_vous.annulation_client', 'appointment', coalesce(v_appt.reference, v_appt.id::text), 'SUCCES',
    jsonb_build_object('statut_precedent', v_prev)
  );

  return v_appt;
end;
$fn$;

comment on function public.cancel_my_appointment(uuid, text) is
  'Le client annule son rendez-vous tant qu''il n''a pas commencé, motif obligatoire, sans délai minimal. Propriété, compte actif et état vérifiés sous verrou.';

revoke execute on function public.cancel_my_appointment(uuid, text) from public, anon;
grant  execute on function public.cancel_my_appointment(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10. CHRONOLOGIES CLIENT
--
-- Seuls les événements destinés au client : création, changements de statut,
-- devis envoyé puis sa réponse (jamais un brouillon ni son abandon),
-- reprogrammation. Jamais : affectation, note interne, nom de l'agent.
-- La note n'est rendue que lorsqu'elle vient du client lui-même (son motif).
-- -----------------------------------------------------------------------------

create or replace function public.my_request_timeline(p_request_id uuid)
returns table (occurred_at timestamptz, kind text, from_status text, to_status text,
               quote_reference text, by_me boolean, note text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.client_session_is_active(v_uid) then
    return;
  end if;
  if not exists (select 1 from public.quote_requests where id = p_request_id and user_id = v_uid) then
    return;
  end if;

  return query
    select e.created_at, e.kind, e.from_status, e.to_status, e.quote_reference,
           coalesce(e.actor_id = v_uid, false),
           case when e.actor_id = v_uid then e.note end
      from public.quote_request_events e
     where e.quote_request_id = p_request_id
       and (e.kind in ('CREATION', 'STATUT')
            or (e.kind = 'DEVIS_STATUT' and not (e.from_status = 'BROUILLON' and e.to_status <> 'ENVOYE')))
     order by e.created_at, e.id;
end;
$$;

revoke execute on function public.my_request_timeline(uuid) from public, anon;
grant  execute on function public.my_request_timeline(uuid) to authenticated, service_role;


create or replace function public.my_appointment_timeline(p_appointment_id uuid)
returns table (occurred_at timestamptz, kind text, from_status text, to_status text,
               scheduled_at_before timestamptz, scheduled_at_after timestamptz, by_me boolean, note text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.client_session_is_active(v_uid) then
    return;
  end if;
  if not exists (select 1 from public.appointments where id = p_appointment_id and user_id = v_uid) then
    return;
  end if;

  return query
    select e.created_at, e.kind, e.from_status, e.to_status, e.scheduled_at_before, e.scheduled_at_after,
           coalesce(e.actor_id = v_uid, false),
           case when e.actor_id = v_uid then e.note end
      from public.appointment_events e
     where e.appointment_id = p_appointment_id
       and e.kind in ('CREATION', 'STATUT', 'REPROGRAMMATION')
     order by e.created_at, e.id;
end;
$$;

revoke execute on function public.my_appointment_timeline(uuid) from public, anon;
grant  execute on function public.my_appointment_timeline(uuid) to authenticated, service_role;
