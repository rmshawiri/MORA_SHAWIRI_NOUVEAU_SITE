-- =============================================================================
-- PHASE 4H-2 — AFFILIATION : CANDIDATURES ET JOURNAL DES E-MAILS
--
-- Ce que cette migration pose :
--
--   1. les moyens de paiement autorisés pour le versement des commissions —
--      un drapeau sur la table de 4G, pas une seconde liste ;
--   2. les candidatures, et leur historique ;
--   3. le journal des e-mails transactionnels (`email_outbox`), générique,
--      prêt pour la phase 4J ;
--   4. la porte publique de dépôt d'une candidature ;
--   5. le traitement administratif : étude, demande d'informations, refus,
--      acceptation (qui crée l'affilié en PRÉPARATION) ;
--   6. les privilèges et la RLS.
--
-- ## Les principes du propriétaire appliqués ici
--
--   * Une candidature n'est PAS un affilié. L'acceptation crée une fiche en
--     préparation ; l'activation (lot 4H-3) exige une configuration
--     financière complète et un compte.
--   * Le moyen de paiement saisi est un SOUHAIT, jamais un moyen validé.
--   * Les catégories internes (Équipe, Recruté) ne sont jamais proposées au
--     public : le profil déclaré est une indication, la catégorie réelle est
--     attribuée par l'administration.
--   * Base d'abord, e-mail ensuite : une panne SMTP n'annule rien, et chaque
--     envoi est journalisé avec son résultat.
--
-- ## Pas de numéro officiel pour une candidature
--
-- Une candidature arrive d'un formulaire public. Lui allouer un numéro du
-- Moteur de Documents laisserait n'importe qui consommer une suite par des
-- envois répétés, et D-2 interdit tout second format de numérotation. Elle
-- est donc désignée par sa date et son nom ; l'affilié reçoit sa référence
-- AFIL à l'activation.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. MOYENS DE VERSEMENT DES COMMISSIONS
--
-- La table `payment_methods` de 4G décrit ce que MORA Shawiri accepte d'un
-- client. Verser une commission est l'opération inverse : un moyen peut
-- servir à l'un et pas à l'autre. Un drapeau suffit — dupliquer la liste
-- ferait diverger libellés et activations.
--
-- Valeurs initiales : les moyens cités par le propriétaire, sauf Wakati, dont
-- 4G a consigné que le service n'est pas lancé (« préparé, jamais proposé »).
-- L'administration peut changer chaque drapeau.
-- -----------------------------------------------------------------------------

alter table public.payment_methods
  add column if not exists payout_enabled boolean not null default false;

comment on column public.payment_methods.payout_enabled is
  'Vrai si ce moyen peut servir au versement des commissions d''affiliation. Indépendant de is_active, qui gouverne les paiements des clients.';

update public.payment_methods
   set payout_enabled = true
 where code in ('MVOLA', 'HOLO', 'VIREMENT', 'CHEQUE', 'ESPECES', 'PAYPAL')
   and not exists (select 1 from public.payment_methods where payout_enabled);


-- Liste publique : ce que le formulaire de candidature propose. Code,
-- libellé et famille — jamais un numéro de compte de MORA Shawiri.
create or replace function public.affiliate_payout_methods()
returns table (code text, label text, kind text, sort_order integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pm.code, pm.label, pm.kind, pm.sort_order
    from public.payment_methods pm
   where pm.payout_enabled
   order by pm.sort_order, pm.code;
$$;

comment on function public.affiliate_payout_methods() is
  'Moyens proposés pour recevoir des commissions. Lecture publique limitée au code, au libellé et à la famille.';

revoke execute on function public.affiliate_payout_methods() from public;
grant  execute on function public.affiliate_payout_methods() to anon, authenticated, service_role;


-- Champs attendus pour chaque famille de moyen. Une seule définition, lue par
-- le dépôt public et, demain, par la demande de modification (décision J).
create or replace function public.affiliate_payout_details_valid(p_kind text, p_details jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_allowed  text[];
  v_required text[];
  v_key      text;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    return false;
  end if;

  case p_kind
    when 'MOBILE_MONEY'  then v_allowed := array['numero', 'titulaire'];          v_required := v_allowed;
    when 'BANK_TRANSFER' then v_allowed := array['banque', 'titulaire', 'compte']; v_required := v_allowed;
    when 'ONLINE'        then v_allowed := array['email'];                          v_required := v_allowed;
    when 'CHEQUE'        then v_allowed := array['ordre'];                          v_required := v_allowed;
    when 'CASH'          then v_allowed := array[]::text[];                         v_required := v_allowed;
    else return false;
  end case;

  for v_key in select jsonb_object_keys(p_details) loop
    if not v_key = any (v_allowed) then
      return false;
    end if;
    if jsonb_typeof(p_details -> v_key) <> 'string' or length(p_details ->> v_key) > 120 then
      return false;
    end if;
  end loop;

  foreach v_key in array v_required loop
    if btrim(coalesce(p_details ->> v_key, '')) = '' then
      return false;
    end if;
  end loop;

  if p_kind = 'ONLINE' and (p_details ->> 'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return false;
  end if;
  if p_kind = 'MOBILE_MONEY' and length(regexp_replace(p_details ->> 'numero', '\D', '', 'g')) < 6 then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.affiliate_payout_details_valid(text, jsonb) is
  'Vrai si les coordonnées portent exactement les champs utiles à la famille de moyen (numéro et titulaire pour le mobile money, etc.).';


-- -----------------------------------------------------------------------------
-- 2. LES CANDIDATURES
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_applications (
  id                   uuid primary key default gen_random_uuid(),
  status               text not null default 'NOUVELLE',

  -- Étape 1 — identité.
  first_name           text not null,
  last_name            text not null,
  email                text not null,
  phone                text not null,
  country              text not null,
  city                 text not null,

  -- Étape 2 — profil déclaré. Indication, jamais catégorie attribuée.
  requested_profile    text not null,
  -- Étape 3 — réponses conditionnelles au profil.
  profile_answers      jsonb not null default '{}'::jsonb,
  -- Étape 4 — motivation.
  motivation           text not null,
  collaboration_idea   text,

  -- Étape 5 — moyen SOUHAITÉ. Les coordonnées ne sont lisibles que sous
  -- `payouts.view` : la colonne n'est accordée à aucune session.
  payout_method_code   text not null references public.payment_methods (code) on delete restrict,
  payout_details       jsonb not null default '{}'::jsonb,

  -- Étape 6 — consentement.
  consent_given_at     timestamptz not null,
  consent_version      text not null,

  -- Compte connecté au moment du dépôt, s'il y en avait un. Jamais déduit
  -- de l'adresse saisie.
  user_id              uuid references auth.users (id) on delete set null,
  source               text,

  -- Traitement.
  info_request         text,
  decision_message     text,
  refusal_reason       text,
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  decided_by           uuid references public.profiles (id) on delete set null,
  decided_at           timestamptz,
  affiliate_id         uuid unique references public.affiliates (id) on delete set null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint affiliate_applications_status check (
    status in ('NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES', 'ACCEPTEE', 'REFUSEE')
  ),
  constraint affiliate_applications_profile check (
    requested_profile in ('PARTICULIER', 'INFLUENCEUR', 'COMMUNAUTE', 'APPORTEUR', 'PROFESSIONNEL', 'AUTRE')
  ),
  constraint affiliate_applications_names check (
    btrim(first_name) <> '' and length(first_name) <= 60
    and btrim(last_name) <> '' and length(last_name) <= 60
  ),
  constraint affiliate_applications_email check (
    email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and length(email) <= 160
  ),
  constraint affiliate_applications_phone check (
    length(regexp_replace(phone, '\D', '', 'g')) >= 6 and length(phone) <= 40
  ),
  constraint affiliate_applications_place check (
    btrim(country) <> '' and length(country) <= 80 and btrim(city) <> '' and length(city) <= 80
  ),
  constraint affiliate_applications_answers_shape check (jsonb_typeof(profile_answers) = 'object'),
  constraint affiliate_applications_motivation check (
    btrim(motivation) <> '' and length(motivation) <= 2000
  ),
  constraint affiliate_applications_idea_length check (
    collaboration_idea is null or length(collaboration_idea) <= 2000
  ),
  constraint affiliate_applications_details_shape check (jsonb_typeof(payout_details) = 'object'),
  constraint affiliate_applications_consent_version check (length(consent_version) <= 40),
  constraint affiliate_applications_texts check (
    (info_request is null or length(info_request) <= 2000)
    and (decision_message is null or length(decision_message) <= 2000)
    and (refusal_reason is null or length(refusal_reason) <= 1000)
  ),
  -- Une décision est datée et signée.
  constraint affiliate_applications_decided check (
    status not in ('ACCEPTEE', 'REFUSEE') or (decided_at is not null and decided_by is not null)
  ),
  constraint affiliate_applications_refusal_reason check (
    status <> 'REFUSEE' or (refusal_reason is not null and btrim(refusal_reason) <> '')
  ),
  constraint affiliate_applications_accepted_affiliate check (
    status <> 'ACCEPTEE' or affiliate_id is not null
  )
);

comment on table public.affiliate_applications is
  'Candidatures au programme d''affiliation. Une candidature n''est pas un affilié : l''acceptation crée une fiche en préparation.';
comment on column public.affiliate_applications.payout_details is
  'Coordonnées du moyen SOUHAITÉ. Accordées à aucune session : lisibles par application_payout_details() sous payouts.view.';

create index if not exists affiliate_applications_status_idx on public.affiliate_applications (status, created_at desc);
create index if not exists affiliate_applications_email_idx on public.affiliate_applications (lower(email));

-- Une seule candidature ouverte par adresse : le second dépôt est reconnu
-- comme un doublon, et ne déclenche pas un second accusé de réception.
create unique index if not exists affiliate_applications_one_open_per_email
  on public.affiliate_applications (lower(email))
  where status in ('NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES');

drop trigger if exists affiliate_applications_set_updated_at on public.affiliate_applications;
create trigger affiliate_applications_set_updated_at
  before update on public.affiliate_applications
  for each row execute function public.set_updated_at();


create table if not exists public.affiliate_application_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.affiliate_applications (id) on delete cascade,
  event_type     text not null,
  summary        text not null,
  old_status     text,
  new_status     text,
  message        text,
  actor_id       uuid references public.profiles (id) on delete set null,
  actor_label    text,
  created_at     timestamptz not null default now(),
  constraint affiliate_application_events_type check (event_type ~ '^[A-Z][A-Z_]{2,48}$'),
  constraint affiliate_application_events_summary check (length(summary) <= 300),
  constraint affiliate_application_events_message check (message is null or length(message) <= 4000)
);

create index if not exists affiliate_application_events_idx
  on public.affiliate_application_events (application_id, created_at desc);

drop trigger if exists affiliate_application_events_append_only on public.affiliate_application_events;
create trigger affiliate_application_events_append_only
  before update or delete on public.affiliate_application_events
  for each row execute function public.tg_affiliate_events_append_only();


-- Transitions : un graphe, et un seul. Le même graphe est écrit dans
-- `src/lib/affiliation/applications.ts`, et un test les compare.
create or replace function public.affiliate_application_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('NOUVELLE',       'EN_ETUDE'),
    ('NOUVELLE',       'INFOS_REQUISES'),
    ('NOUVELLE',       'ACCEPTEE'),
    ('NOUVELLE',       'REFUSEE'),
    ('EN_ETUDE',       'INFOS_REQUISES'),
    ('EN_ETUDE',       'ACCEPTEE'),
    ('EN_ETUDE',       'REFUSEE'),
    ('INFOS_REQUISES', 'EN_ETUDE'),
    ('INFOS_REQUISES', 'ACCEPTEE'),
    ('INFOS_REQUISES', 'REFUSEE')
  );
$$;

-- Le graphe vaut pour tous les chemins, fonctions comprises : ce garde ne
-- regarde pas le rôle, seulement l'ancien et le nouvel état.
create or replace function public.tg_affiliate_applications_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not public.affiliate_application_transition_ok(old.status, new.status) then
    raise exception 'Transition de candidature interdite : % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Ce que le candidat a transmis ne se réécrit pas.
  if (new.first_name, new.last_name, new.email, new.phone, new.country, new.city,
      new.requested_profile, new.profile_answers, new.motivation, new.collaboration_idea,
      new.payout_method_code, new.payout_details, new.consent_given_at, new.consent_version,
      new.user_id, new.source, new.created_at)
     is distinct from
     (old.first_name, old.last_name, old.email, old.phone, old.country, old.city,
      old.requested_profile, old.profile_answers, old.motivation, old.collaboration_idea,
      old.payout_method_code, old.payout_details, old.consent_given_at, old.consent_version,
      old.user_id, old.source, old.created_at) then
    raise exception 'Le contenu d''une candidature ne se modifie pas.' using errcode = 'check_violation';
  end if;

  if old.affiliate_id is not null and new.affiliate_id is distinct from old.affiliate_id then
    raise exception 'Le rattachement à un affilié est définitif.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_applications_guard on public.affiliate_applications;
create trigger affiliate_applications_guard
  before update on public.affiliate_applications
  for each row execute function public.tg_affiliate_applications_guard();


-- -----------------------------------------------------------------------------
-- 3. LE JOURNAL DES E-MAILS
--
-- Générique : chaque e-mail transactionnel y laisse une ligne — modèle,
-- destinataire, objet, résultat, erreur technique abrégée. Le contenu rendu
-- est conservé pour permettre une nouvelle tentative à l'identique.
--
-- Écrit par le serveur seul (clé de service), jamais par une session. Lu par
-- qui peut lire l'entité concernée. Ne contient jamais de secret : le mot de
-- passe SMTP ne quitte pas les variables d'environnement, et le serveur
-- abrège l'erreur avant de l'écrire.
-- -----------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  template        text not null,
  recipient       text not null,
  recipient_kind  text not null default 'EXTERNE',
  subject         text not null,
  html_body       text not null,
  text_body       text not null,
  entity_type     text,
  entity_id       uuid,
  status          text not null default 'EN_ATTENTE',
  attempts        integer not null default 0,
  last_error      text,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint email_outbox_template check (template ~ '^[a-z][a-z0-9_.]{2,80}$'),
  constraint email_outbox_recipient check (recipient ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(recipient) <= 254),
  constraint email_outbox_recipient_kind check (recipient_kind in ('EXTERNE', 'EQUIPE')),
  constraint email_outbox_subject check (btrim(subject) <> '' and length(subject) <= 200),
  constraint email_outbox_status check (status in ('EN_ATTENTE', 'ENVOYE', 'ECHEC')),
  constraint email_outbox_attempts check (attempts >= 0),
  constraint email_outbox_error_length check (last_error is null or length(last_error) <= 300),
  constraint email_outbox_sent_coherent check (status <> 'ENVOYE' or sent_at is not null),
  -- Garde-fou grossier, comme pour le journal d'audit : une erreur qui
  -- transporterait visiblement un secret est refusée.
  constraint email_outbox_error_no_secret check (
    last_error is null or last_error !~* '(password|mot de passe|pass=|secret|token)'
  )
);

comment on table public.email_outbox is
  'Journal des e-mails transactionnels : base d''abord, envoi ensuite, résultat consigné, nouvelle tentative possible. Générique, réutilisable par la phase 4J.';

create index if not exists email_outbox_entity_idx on public.email_outbox (entity_type, entity_id, created_at desc);
create index if not exists email_outbox_status_idx on public.email_outbox (status, created_at desc);

drop trigger if exists email_outbox_set_updated_at on public.email_outbox;
create trigger email_outbox_set_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

-- Qui peut lire un e-mail journalisé : qui peut lire son entité.
create or replace function public.can_view_email(p_entity_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('notifications.view')
      or (p_entity_type = 'affiliate_application' and public.has_permission('affiliate_applications.view'))
      or (p_entity_type = 'affiliate' and public.has_permission('affiliates.view'));
$$;

revoke execute on function public.can_view_email(text) from public, anon;
grant  execute on function public.can_view_email(text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. LA PORTE PUBLIQUE
--
-- Patron de 4F : les tables n'accordent aucune écriture aux sessions ; cette
-- fonction est le seul chemin. `user_id` vient de `auth.uid()`, jamais d'un
-- paramètre. Aucune catégorie n'est acceptée : seul un profil déclaré.
-- -----------------------------------------------------------------------------

create or replace function public.submit_affiliate_application(
  p_first_name     text,
  p_last_name      text,
  p_email          text,
  p_phone          text,
  p_country        text,
  p_city           text,
  p_profile        text,
  p_answers        jsonb,
  p_motivation     text,
  p_idea           text,
  p_payout_method  text,
  p_payout_details jsonb,
  p_consent        boolean,
  p_consent_version text,
  p_client_hash    text default null
)
returns table (application_id uuid, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_kind     text;
  v_existing uuid;
  v_answers  jsonb := coalesce(p_answers, '{}'::jsonb);
  v_key      text;
  v_id       uuid;
begin
  if not public.relation_rate_limit_ok('affiliation.candidature', p_client_hash, 3, 3600) then
    raise exception 'Trop de candidatures envoyées depuis cette connexion.' using errcode = '54000';
  end if;

  if coalesce(p_consent, false) is not true then
    raise exception 'Le consentement est requis.' using errcode = 'check_violation';
  end if;

  select pm.kind into v_kind
    from public.payment_methods pm
   where pm.code = p_payout_method and pm.payout_enabled;
  if not found then
    raise exception 'Moyen de versement indisponible.' using errcode = 'check_violation';
  end if;
  if not public.affiliate_payout_details_valid(v_kind, coalesce(p_payout_details, '{}'::jsonb)) then
    raise exception 'Coordonnées de versement incomplètes.' using errcode = 'check_violation';
  end if;

  -- Réponses du profil : un objet plat de chaînes courtes, rien d'autre.
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'Réponses invalides.' using errcode = 'check_violation';
  end if;
  if (select count(*) from jsonb_object_keys(v_answers)) > 12 then
    raise exception 'Réponses invalides.' using errcode = 'check_violation';
  end if;
  for v_key in select jsonb_object_keys(v_answers) loop
    if v_key !~ '^[a-z][a-z_]{1,30}$'
       or jsonb_typeof(v_answers -> v_key) <> 'string'
       or length(v_answers ->> v_key) > 500 then
      raise exception 'Réponses invalides.' using errcode = 'check_violation';
    end if;
  end loop;

  -- Une candidature ouverte pour cette adresse : c'est la même.
  select a.id into v_existing
    from public.affiliate_applications a
   where lower(a.email) = v_email
     and a.status in ('NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES');
  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  insert into public.affiliate_applications (
    first_name, last_name, email, phone, country, city,
    requested_profile, profile_answers, motivation, collaboration_idea,
    payout_method_code, payout_details, consent_given_at, consent_version,
    user_id, source
  ) values (
    left(btrim(coalesce(p_first_name, '')), 60),
    left(btrim(coalesce(p_last_name, '')), 60),
    v_email,
    left(btrim(coalesce(p_phone, '')), 40),
    left(btrim(coalesce(p_country, '')), 80),
    left(btrim(coalesce(p_city, '')), 80),
    p_profile,
    v_answers,
    left(btrim(coalesce(p_motivation, '')), 2000),
    nullif(left(btrim(coalesce(p_idea, '')), 2000), ''),
    p_payout_method,
    jsonb_strip_nulls(p_payout_details),
    now(),
    left(coalesce(p_consent_version, ''), 40),
    auth.uid(),
    'site'
  )
  returning id into v_id;

  insert into public.affiliate_application_events (application_id, event_type, summary, new_status)
  values (v_id, 'CANDIDATURE_RECUE', 'Candidature reçue depuis le site', 'NOUVELLE');

  return query select v_id, false;
exception
  when unique_violation then
    -- Deux dépôts simultanés de la même adresse : le second rejoint le premier.
    select a.id into v_existing
      from public.affiliate_applications a
     where lower(a.email) = v_email
       and a.status in ('NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES');
    return query select v_existing, true;
end;
$fn$;

comment on function public.submit_affiliate_application(text, text, text, text, text, text, text, jsonb, text, text, text, jsonb, boolean, text, text) is
  'Seule porte publique de dépôt d''une candidature. user_id vient de auth.uid(). Une candidature ouverte par adresse.';

revoke execute on function public.submit_affiliate_application(text, text, text, text, text, text, text, jsonb, text, text, text, jsonb, boolean, text, text) from public;
grant  execute on function public.submit_affiliate_application(text, text, text, text, text, text, text, jsonb, text, text, text, jsonb, boolean, text, text) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. LE TRAITEMENT
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_application_log(
  p_application_id uuid,
  p_event_type     text,
  p_summary        text,
  p_old_status     text,
  p_new_status     text,
  p_message        text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text := public.relation_actor_label();
begin
  insert into public.affiliate_application_events
    (application_id, event_type, summary, old_status, new_status, message, actor_id, actor_label)
  values
    (p_application_id, p_event_type, left(p_summary, 300), p_old_status, p_new_status,
     left(p_message, 4000), auth.uid(), v_label);

  insert into public.audit_logs (actor_id, actor_label, action, resource_type, resource_id, metadata)
  values (auth.uid(), v_label, 'affiliation.candidature.' || lower(p_event_type),
          'affiliate_application', p_application_id::text,
          jsonb_strip_nulls(jsonb_build_object('avant', p_old_status, 'apres', p_new_status)));
end;
$$;

revoke execute on function public.affiliate_application_log(uuid, text, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.affiliate_application_log(uuid, text, text, text, text, text) to service_role;


-- Étude, demande d'informations, refus. L'acceptation a sa propre fonction,
-- parce qu'elle crée un affilié.
create or replace function public.review_affiliate_application(
  p_application_id uuid,
  p_status         text,
  p_message        text default null,
  p_reason         text default null
)
returns public.affiliate_applications
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_app  public.affiliate_applications%rowtype;
  v_old  text;
begin
  if not public.has_permission('affiliate_applications.manage') then
    raise exception 'Permission affiliate_applications.manage requise.' using errcode = '42501';
  end if;
  if p_status not in ('EN_ETUDE', 'INFOS_REQUISES', 'REFUSEE') then
    raise exception 'Statut non traité par cette fonction.' using errcode = 'check_violation';
  end if;
  if p_status = 'INFOS_REQUISES' and btrim(coalesce(p_message, '')) = '' then
    raise exception 'Précisez les informations demandées.' using errcode = 'check_violation';
  end if;
  if p_status = 'REFUSEE' and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Le motif interne du refus est obligatoire.' using errcode = 'check_violation';
  end if;

  select * into v_app from public.affiliate_applications where id = p_application_id for update;
  if not found then
    raise exception 'Candidature introuvable.' using errcode = 'no_data_found';
  end if;
  v_old := v_app.status;

  update public.affiliate_applications
     set status           = p_status,
         info_request     = case when p_status = 'INFOS_REQUISES' then left(btrim(p_message), 2000) else info_request end,
         decision_message = case when p_status = 'REFUSEE' then nullif(left(btrim(coalesce(p_message, '')), 2000), '') else decision_message end,
         refusal_reason   = case when p_status = 'REFUSEE' then left(btrim(p_reason), 1000) else refusal_reason end,
         reviewed_by      = coalesce(reviewed_by, auth.uid()),
         reviewed_at      = coalesce(reviewed_at, now()),
         decided_by       = case when p_status = 'REFUSEE' then auth.uid() else decided_by end,
         decided_at       = case when p_status = 'REFUSEE' then now() else decided_at end
   where id = p_application_id
  returning * into v_app;

  perform public.affiliate_application_log(
    p_application_id,
    'STATUT_' || p_status,
    case p_status
      when 'EN_ETUDE' then 'Examen de la candidature'
      when 'INFOS_REQUISES' then 'Informations complémentaires demandées'
      else 'Candidature refusée'
    end,
    v_old, p_status,
    case when p_status = 'REFUSEE' then concat_ws(E'\n', 'Motif interne : ' || btrim(p_reason), nullif(btrim(coalesce(p_message, '')), ''))
         else nullif(btrim(coalesce(p_message, '')), '') end
  );

  return v_app;
end;
$fn$;

revoke execute on function public.review_affiliate_application(uuid, text, text, text) from public, anon;
grant  execute on function public.review_affiliate_application(uuid, text, text, text) to authenticated, service_role;


-- Lien principal : un identifiant propre, stable, sans donnée sensible.
-- Translittération des lettres accentuées du français, puis tirets.
create or replace function public.affiliate_slugify(p_text text)
returns text
language sql
immutable
as $$
  select nullif(
    left(
      trim(both '-' from regexp_replace(
        lower(translate(coalesce(p_text, ''),
          'ÀÂÄÁÃÅàâäáãåÇçÉÈÊËéèêëÎÏÍÌîïíìÔÖÓÒÕôöóòõÛÜÚÙûüúùŸÿÑñ',
          'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyNn')),
        '[^a-z0-9]+', '-', 'g')),
      40),
    '');
$$;


-- Accepter : la candidature devient une fiche d'affilié en PRÉPARATION,
-- dans la catégorie choisie par l'administration. Aucune référence AFIL,
-- aucun accès, aucune règle financière : tout cela relève de l'activation.
create or replace function public.accept_affiliate_application(
  p_application_id uuid,
  p_category_id    uuid,
  p_message        text default null
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_app      public.affiliate_applications%rowtype;
  v_aff      public.affiliates%rowtype;
  v_base     text;
  v_slug     text;
  v_suffix   integer := 1;
  v_old      text;
begin
  if not public.has_permission('affiliate_applications.manage')
     or not public.has_permission('affiliates.create') then
    raise exception 'Permissions affiliate_applications.manage et affiliates.create requises.'
      using errcode = '42501';
  end if;

  select * into v_app from public.affiliate_applications where id = p_application_id for update;
  if not found then
    raise exception 'Candidature introuvable.' using errcode = 'no_data_found';
  end if;
  -- Idempotence : rejouer l'acceptation rend la fiche déjà créée.
  if v_app.status = 'ACCEPTEE' and v_app.affiliate_id is not null then
    select * into v_aff from public.affiliates where id = v_app.affiliate_id;
    return v_aff;
  end if;
  if not public.affiliate_application_transition_ok(v_app.status, 'ACCEPTEE') then
    raise exception 'Cette candidature ne peut plus être acceptée.' using errcode = 'check_violation';
  end if;

  perform 1 from public.affiliate_categories where id = p_category_id and is_active;
  if not found then
    raise exception 'Catégorie introuvable ou inactive.' using errcode = 'check_violation';
  end if;

  v_base := coalesce(public.affiliate_slugify(v_app.first_name || ' ' || v_app.last_name), 'partenaire');
  if length(v_base) < 3 then
    v_base := v_base || '-mora';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.affiliates where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := left(v_base, 40) || '-' || v_suffix;
  end loop;

  insert into public.affiliates (
    slug, category_id, status, party_type, display_name, legal_name,
    contact_email, contact_phone, country, city
  ) values (
    v_slug, p_category_id, 'PREPARATION',
    case when v_app.requested_profile in ('PROFESSIONNEL', 'COMMUNAUTE') then 'ORGANISATION' else 'PERSONNE' end,
    left(v_app.first_name || ' ' || v_app.last_name, 120),
    nullif(left(coalesce(v_app.profile_answers ->> 'entreprise', v_app.profile_answers ->> 'nom_communaute', ''), 160), ''),
    v_app.email, v_app.phone, v_app.country, v_app.city
  )
  returning * into v_aff;

  v_old := v_app.status;
  update public.affiliate_applications
     set status           = 'ACCEPTEE',
         affiliate_id     = v_aff.id,
         decision_message = nullif(left(btrim(coalesce(p_message, '')), 2000), ''),
         reviewed_by      = coalesce(reviewed_by, auth.uid()),
         reviewed_at      = coalesce(reviewed_at, now()),
         decided_by       = auth.uid(),
         decided_at       = now()
   where id = p_application_id;

  perform public.affiliate_application_log(p_application_id, 'STATUT_ACCEPTEE',
    'Candidature acceptée — fiche affilié créée en préparation', v_old, 'ACCEPTEE',
    nullif(btrim(coalesce(p_message, '')), ''));

  return v_aff;
end;
$fn$;

revoke execute on function public.accept_affiliate_application(uuid, uuid, text) from public, anon;
grant  execute on function public.accept_affiliate_application(uuid, uuid, text) to authenticated, service_role;


create or replace function public.note_affiliate_application(p_application_id uuid, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.has_permission('affiliate_applications.manage') then
    raise exception 'Permission affiliate_applications.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'Une note vide n''apporte rien.' using errcode = 'check_violation';
  end if;
  perform 1 from public.affiliate_applications where id = p_application_id;
  if not found then
    raise exception 'Candidature introuvable.' using errcode = 'no_data_found';
  end if;
  insert into public.affiliate_application_events
    (application_id, event_type, summary, message, actor_id, actor_label)
  values
    (p_application_id, 'NOTE_INTERNE', 'Note interne', left(btrim(p_body), 4000),
     auth.uid(), public.relation_actor_label());
end;
$fn$;

revoke execute on function public.note_affiliate_application(uuid, text) from public, anon;
grant  execute on function public.note_affiliate_application(uuid, text) to authenticated, service_role;


-- Coordonnées de versement souhaitées : sous `payouts.view` seulement.
create or replace function public.application_payout_details(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_details jsonb;
begin
  if not public.has_permission('payouts.view') then
    raise exception 'Permission payouts.view requise.' using errcode = '42501';
  end if;
  select payout_details into v_details from public.affiliate_applications where id = p_application_id;
  return v_details;
end;
$fn$;

revoke execute on function public.application_payout_details(uuid) from public, anon;
grant  execute on function public.application_payout_details(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. PRIVILÈGES ET RLS
-- -----------------------------------------------------------------------------

revoke all on public.affiliate_applications       from anon, authenticated;
revoke all on public.affiliate_application_events from anon, authenticated;
revoke all on public.email_outbox                 from anon, authenticated;

-- Toutes les colonnes, sauf les coordonnées de versement.
grant select (id, status, first_name, last_name, email, phone, country, city,
              requested_profile, profile_answers, motivation, collaboration_idea,
              payout_method_code, consent_given_at, consent_version, user_id, source,
              info_request, decision_message, refusal_reason, reviewed_by, reviewed_at,
              decided_by, decided_at, affiliate_id, created_at, updated_at)
  on public.affiliate_applications to authenticated;
grant select on public.affiliate_application_events to authenticated;
grant select on public.email_outbox to authenticated;

grant all on public.affiliate_applications, public.affiliate_application_events, public.email_outbox
  to service_role;

alter table public.affiliate_applications       enable row level security;
alter table public.affiliate_application_events enable row level security;
alter table public.email_outbox                 enable row level security;

drop policy if exists affiliate_applications_select on public.affiliate_applications;
create policy affiliate_applications_select
  on public.affiliate_applications for select to authenticated
  using (public.has_permission('affiliate_applications.view'));

drop policy if exists affiliate_application_events_select on public.affiliate_application_events;
create policy affiliate_application_events_select
  on public.affiliate_application_events for select to authenticated
  using (public.has_permission('affiliate_applications.view'));

drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select
  on public.email_outbox for select to authenticated
  using (public.can_view_email(entity_type));
