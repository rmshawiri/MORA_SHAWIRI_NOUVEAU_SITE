-- =============================================================================
-- PHASE 4F — RELATION CLIENT : DEMANDES ET RENDEZ-VOUS PERSISTÉS
--
-- Ce que cette migration change, en une phrase : une demande envoyée depuis le
-- site cesse d'être un e-mail pour devenir une ligne de base, sans que le
-- visiteur voie la moindre différence.
--
-- ## Ce qui existait déjà, et n'est pas refait
--
-- Les permissions `quotes.*` et `appointments.*` ont été semées en phase 4A
-- (§ 36-37 des rôles), y compris `appointments.manage` — « Gérer les
-- disponibilités ». Aucune permission n'est créée ici : les cinq de chaque
-- famille suffisent, et en inventer une nouvelle romprait la grille de droits
-- que le SUPER_ADMIN attribue compte par compte depuis la phase 4C (D-18).
--
-- L'allocateur de références de la phase 4D est réutilisé tel quel. Le journal
-- d'audit de la phase 4A l'est aussi : il n'y a pas de second système d'audit.
--
-- ## Les quatre décisions du propriétaire, prises au démarrage de 4F
--
-- **A3 — disponibilités.** `02_PRISE_DE_RENDEZ_VOUS.md` interdit trois fois
-- d'inventer les valeurs du calendrier : § 25 « ne pas inventer de durée »,
-- § 27 « les valeurs définitives doivent être configurables », § 86 « ne pas
-- inventer automatiquement les jours non disponibles » — et § 23 interdit un
-- faux calendrier. Les horaires réels de MORA Shawiri ne sont pas tranchés.
-- `appointment_availabilities` est donc créée **vide**, administrable, et le
-- formulaire public reste celui qui existe : le visiteur exprime une date
-- souhaitée et une préférence de demi-journée, pas un créneau. Le refus de
-- double réservation s'applique là où un créneau est réellement pris — à la
-- confirmation administrative — et il s'applique par contrainte, pas par
-- politesse du code : voir § 7.
--
-- **B2 — références.** Deux nouveaux codes de type, `DMCL` et `RVCL`, alloués
-- par `allocate_document_number` au format D-2 `MORA-[TYPE]-[SÉRIE][NUMÉRO]`.
-- Un seul allocateur, celui de 4D, déjà éprouvé en concurrence. Mais une
-- demande n'est pas une pièce comptable : aucune ligne `public.documents` n'est
-- émise pour elle, et `issue_document` refuse désormais explicitement ces deux
-- types (§ 2). La référence d'un rendez-vous n'est attribuée qu'à sa
-- confirmation, comme le § 43 le demande.
--
-- **C1 — statuts.** Les documents donnent deux listes, toutes deux qualifiées
-- d'« exemples » et mutuellement incompatibles. Chacune est affectée à
-- l'entité qui lui correspond, sans en inventer une troisième :
--   * la demande suit `03_ESPACE_CLIENT.md` § 26 ;
--   * le devis émis suit `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 39, seul
--     porteur légitime de « Expiré ».
--
-- **Texte public.** Hors SQL, mais lié : les phrases « le site fonctionne sans
-- base de données » deviennent fausses et sont corrigées au minimum.
--
-- ## Une seule porte publique
--
-- Les tables de cette migration ne portent **aucune** politique pour `anon`.
-- Ni lecture — elles contiennent des noms, des adresses et des messages
-- (point 17 du cadrage) — ni écriture. Le visiteur n'écrit jamais dans une
-- table : il appelle `submit_quote_request` ou `submit_appointment_request`,
-- deux fonctions `SECURITY DEFINER` qui valident, dédoublonnent, allouent la
-- référence et enregistrent en une transaction. C'est aussi ce qui rend
-- l'usurpation impossible par construction : le rattachement à un compte est
-- lu dans `auth.uid()` à l'intérieur de la fonction, jamais reçu en paramètre.
--
-- ## SECURITY DEFINER ou INVOKER — la leçon de 4E-1
--
-- La phase 4E-1 a livré un garde de publication en `DEFINER` : `current_user`
-- y valait `postgres` pour toute session, `is_privileged_db_role()` répondait
-- « privilégié » à tout le monde, et le garde n'a jamais rien refusé. La règle
-- retenue depuis, appliquée ici sans exception :
--
--   * un **garde** qui interroge `current_user` ou une permission de session
--     est `SECURITY INVOKER` ;
--   * une fonction qui doit **écrire** là où la session n'a pas le droit
--     d'aller — journal d'audit, allocateur, historique — est `DEFINER`, et ne
--     consulte jamais `current_user`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. GARDE-FOUS DE LECTURE
--
-- La même question revient dans chaque politique. L'écrire une fois évite
-- qu'une politique divergée des autres au fil des phases — c'est la méthode
-- retenue en 4E-1 avec `can_view_catalogue()`.
-- -----------------------------------------------------------------------------

create or replace function public.can_view_demandes()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('quotes.view');
$$;

comment on function public.can_view_demandes() is
  'Vrai si la session peut consulter toutes les demandes et tous les devis, quel qu''en soit le demandeur.';

revoke execute on function public.can_view_demandes() from public, anon;
grant  execute on function public.can_view_demandes() to authenticated, service_role;


create or replace function public.can_view_rendez_vous()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('appointments.view');
$$;

comment on function public.can_view_rendez_vous() is
  'Vrai si la session peut consulter tous les rendez-vous et les disponibilités.';

revoke execute on function public.can_view_rendez_vous() from public, anon;
grant  execute on function public.can_view_rendez_vous() to authenticated, service_role;


-- Un prospect est visible dès que l'un des deux domaines est ouvert : la même
-- personne porte ses demandes et ses rendez-vous.
create or replace function public.can_view_prospects()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('quotes.view')
      or public.has_permission('appointments.view');
$$;

comment on function public.can_view_prospects() is
  'Vrai si la session peut consulter le fichier des prospects. Ni AFFILIE ni CLIENT ne l''obtiennent.';

revoke execute on function public.can_view_prospects() from public, anon;
grant  execute on function public.can_view_prospects() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. DEUX CODES DE RÉFÉRENCE, ET LA GARANTIE QU'ILS N'ÉMETTENT RIEN
--
-- Décision B2. `document_types` gagne une colonne : certains codes servent à
-- numéroter une entité métier, pas à émettre une pièce. Sans elle, un appel à
-- `issue_document('DMCL', …)` créerait une ligne `documents` pour une simple
-- demande — un faux document dans une suite comptable, exactement ce que le
-- prompt maître § 36 interdit.
--
-- Les sept types documentaires existants ne sont pas touchés : la colonne est
-- fausse par défaut, et leur comportement est inchangé.
-- -----------------------------------------------------------------------------

alter table public.document_types
  add column if not exists is_reference_only boolean not null default false;

comment on column public.document_types.is_reference_only is
  'Vrai pour un code qui numérote une entité métier (demande, rendez-vous) sans jamais émettre de document. issue_document le refuse.';

insert into public.document_types
  (code, label, entity_type, view_permission, issue_permission, sort_order, is_reference_only)
values
  ('DMCL', 'Demande client',    'quote_request', 'quotes.view',       'quotes.create',       5,  true),
  ('RVCL', 'Rendez-vous client', 'appointment',  'appointments.view', 'appointments.create', 15, true)
on conflict (code) do update
  set label             = excluded.label,
      entity_type       = excluded.entity_type,
      view_permission   = excluded.view_permission,
      issue_permission  = excluded.issue_permission,
      sort_order        = excluded.sort_order,
      is_reference_only = excluded.is_reference_only,
      updated_at        = now();


-- L'émission refuse un code de numérotation. Seule cette garde est ajoutée ;
-- tout le reste de la fonction de 4D est reproduit **à l'identique**, `create
-- or replace` ne permettant pas de modifier un corps par fragment.
--
-- Le « à l'identique » n'est pas une formule de style. Une première rédaction
-- de ce fichier avait, sans le vouloir, perdu trois choses en recopiant :
-- la validation du type des métadonnées, le calcul de version d'un document
-- de remplacement, et l'enregistrement de l'émission au journal d'audit.
-- `scripts/verify-documents.mjs` l'a signalé. C'est le risque propre à cette
-- forme de modification, et la raison pour laquelle elle reste exceptionnelle.
create or replace function public.issue_document(
  p_type         text,
  p_entity_type  text default null,
  p_entity_id    uuid default null,
  p_owner_id     uuid default null,
  p_subject_name text default null,
  p_metadata     jsonb default '{}'::jsonb,
  p_replaces     uuid default null
)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_type      public.document_types%rowtype;
  v_reference text;
  v_series    text;
  v_number    integer;
  v_caller    uuid := auth.uid();
  v_document  public.documents%rowtype;
begin
  select * into v_type from public.document_types where code = p_type;

  if not found or not v_type.is_active then
    raise exception 'Type de document inconnu ou inactif : %', coalesce(p_type, '(nul)')
      using errcode = 'check_violation';
  end if;

  -- ** Seul ajout de la phase 4F : un code de numérotation métier n'émet pas
  -- de pièce. ** Tout ce qui suit vient de la migration 0005, inchangé.
  if v_type.is_reference_only then
    raise exception 'Le type % numérote une entité métier et n''émet aucun document.', p_type
      using errcode = 'check_violation';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Les métadonnées documentaires doivent être un objet JSON.'
      using errcode = 'check_violation';
  end if;

  if v_caller is not null then
    if not public.has_permission(v_type.issue_permission) then
      raise exception 'Permission % requise pour émettre un document %.',
        v_type.issue_permission, p_type
        using errcode = 'insufficient_privilege';
    end if;

    if not public.session_is_aal2() then
      raise exception 'Second facteur requis pour émettre un document.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select a.reference, a.series, a.number
    into v_reference, v_series, v_number
    from public.allocate_document_number(p_type) a;

  insert into public.documents (
    reference, doc_type, series, number,
    entity_type, entity_id, owner_id, subject_name,
    version, replaces_id, metadata, issued_by
  )
  values (
    v_reference, v_type.code, v_series, v_number,
    coalesce(p_entity_type, v_type.entity_type), p_entity_id, p_owner_id, p_subject_name,
    case when p_replaces is null then 1
         else coalesce((select d.version + 1 from public.documents d where d.id = p_replaces), 1)
    end,
    p_replaces,
    coalesce(p_metadata, '{}'::jsonb),
    v_caller
  )
  returning * into v_document;

  -- Le document remplacé change d'état, il ne disparaît pas (§ 152).
  if p_replaces is not null then
    update public.documents
       set status = 'REMPLACE'
     where id = p_replaces and status = 'EMIS';
  end if;

  perform public.record_audit_event(
    'documents.emission',
    'document',
    v_document.reference,
    'SUCCES',
    jsonb_build_object('type', v_type.code, 'serie', v_series, 'numero', v_number)
  );

  return v_document;
end;
$$;

comment on function public.issue_document(text, text, uuid, uuid, text, jsonb, uuid) is
  'Émet un document officiel : alloue l''identifiant et enregistre la pièce dans la même transaction. Seul chemin d''écriture dans public.documents. Refuse les codes de numérotation métier (4F).';


-- -----------------------------------------------------------------------------
-- 3. LE PROSPECT
--
-- § 57-59 de l'architecture base de données : « Une personne peut demander un
-- devis sans posséder encore de compte », et « le système doit éviter de créer
-- plusieurs profils représentant la même personne ». `leads` est ce profil
-- léger, dédoublonné sur l'adresse e-mail normalisée.
--
-- ## Pourquoi `user_id` n'est jamais déduit de l'adresse
--
-- La tentation est de rattacher automatiquement une demande au compte qui
-- porte la même adresse. Ce serait une fuite : il suffirait de saisir
-- l'adresse d'un tiers pour que sa demande — nom, téléphone, message —
-- apparaisse dans l'espace de ce tiers, ou l'inverse.
--
-- `leads.user_id` n'est donc renseigné que lorsque **la session prouve**
-- l'appartenance du compte, c'est-à-dire par `auth.uid()` à l'intérieur des
-- fonctions de soumission. Le dédoublonnage regroupe les envois d'une même
-- adresse ; il ne confère aucun droit de lecture.
--
-- Corollaire assumé : une demande envoyée anonymement avant la création du
-- compte reste anonyme. Elle n'apparaîtra pas dans l'espace client. C'est le
-- prix de l'absence de fuite, et il est bien moins élevé que l'inverse.
-- -----------------------------------------------------------------------------

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),

  -- Clé de dédoublonnage (§ 29 : « normalisée avant comparaison »).
  email         text not null,
  full_name     text not null,
  -- § 30 : format cohérent, contexte comorien. Conservé tel que saisi, la
  -- normalisation d'un indicatif international ne pouvant se faire sans risque
  -- de déformer un numéro valide.
  phone         text,

  -- Rattachement prouvé par une session. Jamais déduit de l'adresse.
  user_id       uuid unique references auth.users (id) on delete set null,

  request_count integer not null default 0 check (request_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint leads_email_unique     unique (email),
  constraint leads_email_normalised check (email = lower(btrim(email))),
  constraint leads_email_format     check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint leads_email_length     check (length(email) between 6 and 160),
  constraint leads_name_present     check (btrim(full_name) <> '' and length(full_name) <= 120),
  constraint leads_phone_length     check (phone is null or length(phone) <= 40)
);

comment on table public.leads is
  'Prospect identifié par son adresse e-mail (§ 58-59). Dédoublonné sur l''adresse normalisée ; jamais rattaché à un compte sans preuve de session.';
comment on column public.leads.user_id is
  'Compte du titulaire, écrit uniquement depuis auth.uid(). Une correspondance d''adresse ne suffit pas : elle ouvrirait la lecture des demandes d''un tiers.';

create index if not exists leads_last_seen_idx on public.leads (last_seen_at desc);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. LA DEMANDE
--
-- § 55 : « identifiant, utilisateur ou prospect, service concerné,
-- informations nécessaires, message libre, statut, date, historique ».
--
-- Le message libre est conservé **intégralement** — c'est un test explicite du
-- plan. Aucune troncature, aucun résumé.
--
-- `details` est en JSONB, et c'est justifié : ce sont les réponses
-- complémentaires d'un questionnaire dont les étapes sont administrables côté
-- code. Les données réellement interrogées — statut, service, dates — ont
-- chacune leur colonne. Le point 10 du cadrage interdit la table fourre-tout,
-- pas le JSONB à sa place.
-- -----------------------------------------------------------------------------

create table if not exists public.quote_requests (
  id             uuid primary key default gen_random_uuid(),

  -- Référence B2, allouée à la création. Immuable (voir § 8).
  reference      text not null unique,

  lead_id        uuid not null references public.leads (id) on delete restrict,
  -- Rattachement au compte, dérivé de la session uniquement.
  user_id        uuid references auth.users (id) on delete set null,

  -- Relation propre au catalogue 4E-1 : la prestation n'est pas dupliquée.
  service_id     uuid references public.services (id) on delete set null,
  -- Instantané du titre affiché au moment de la demande (§ 18 : historique
  -- commercial). Le catalogue peut renommer une offre ; ce que le demandeur a
  -- lu ne change pas pour autant.
  offer_title    text,

  subject        text not null,
  budget_label   text,
  message        text not null,
  organisation   text,
  details        jsonb not null default '[]'::jsonb,

  status         text not null default 'NOUVELLE',
  -- § 117 : origine de la demande. Utile aux statistiques réelles de 4L.
  source         text,

  assigned_to    uuid references public.profiles (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,

  -- Décision C1 — `03_ESPACE_CLIENT.md` § 26.
  constraint quote_requests_status_valid check (
    status in ('NOUVELLE', 'EN_ETUDE', 'DEVIS_ENVOYE', 'ACCEPTEE', 'REFUSEE', 'TERMINEE', 'ANNULEE')
  ),
  constraint quote_requests_reference_format
    check (reference ~ '^MORA-DMCL-[A-Z]+[0-9]{4}$'),
  constraint quote_requests_subject_present
    check (btrim(subject) <> '' and length(subject) <= 160),
  constraint quote_requests_message_present
    check (btrim(message) <> '' and length(message) <= 4000),
  constraint quote_requests_budget_length
    check (budget_label is null or length(budget_label) <= 80),
  constraint quote_requests_offer_length
    check (offer_title is null or length(offer_title) <= 200),
  constraint quote_requests_organisation_length
    check (organisation is null or length(organisation) <= 160),
  constraint quote_requests_source_length
    check (source is null or length(source) <= 60),
  constraint quote_requests_details_is_array
    check (jsonb_typeof(details) = 'array'),
  -- Un état final porte sa date de clôture, et un état ouvert n'en porte pas.
  constraint quote_requests_closed_coherent check (
    (status in ('ACCEPTEE', 'REFUSEE', 'TERMINEE', 'ANNULEE') and closed_at is not null)
    or (status in ('NOUVELLE', 'EN_ETUDE', 'DEVIS_ENVOYE') and closed_at is null)
  )
);

comment on table public.quote_requests is
  'Demande reçue depuis /contact/ (§ 55). Le message libre est conservé intégralement. Statuts : 03_ESPACE_CLIENT § 26 (décision C1).';
comment on column public.quote_requests.details is
  'Réponses complémentaires du questionnaire, variables par nature. Les données interrogées ont leur colonne.';
comment on column public.quote_requests.offer_title is
  'Titre de l''offre tel qu''il était affiché à la demande. Instantané, pas une clé : la relation passe par service_id.';

create index if not exists quote_requests_status_idx  on public.quote_requests (status, created_at desc);
create index if not exists quote_requests_lead_idx    on public.quote_requests (lead_id, created_at desc);
create index if not exists quote_requests_user_idx    on public.quote_requests (user_id, created_at desc)
  where user_id is not null;
create index if not exists quote_requests_service_idx on public.quote_requests (service_id)
  where service_id is not null;
create index if not exists quote_requests_assigned_idx on public.quote_requests (assigned_to)
  where assigned_to is not null;

drop trigger if exists quote_requests_set_updated_at on public.quote_requests;
create trigger quote_requests_set_updated_at
  before update on public.quote_requests
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. LE DEVIS ÉMIS
--
-- Une demande de devis n'est pas un devis — `05_FONCTIONNALITES/00` § 89 :
-- « Offre → Demande de devis → Échange → Devis → Acceptation → Commande
-- éventuelle », et « une demande de devis ne doit pas automatiquement devenir
-- une commande ». Rien n'est donc créé ici automatiquement : un devis naît
-- d'un acte administratif explicite.
--
-- `valid_until` reste nul par défaut. Le § 134 est formel : « si le système
-- prévoit une durée de validité des devis, celle-ci doit être configurée
-- officiellement. Ne pas inventer de délai. » Aucune durée n'est décidée : la
-- colonne existe, vide, et l'administrateur peut saisir une date au cas par
-- cas. Le statut EXPIRE reste donc une décision humaine, jamais automatique.
-- -----------------------------------------------------------------------------

create table if not exists public.quotes (
  id               uuid primary key default gen_random_uuid(),

  quote_request_id uuid not null references public.quote_requests (id) on delete restrict,

  -- Référence documentaire officielle, et le document lui-même. Nuls tant que
  -- le devis est en brouillon : un brouillon ne consomme pas de numéro.
  reference        text unique,
  document_id      uuid references public.documents (id) on delete set null,

  service_id       uuid references public.services (id) on delete set null,

  -- § 46 : le montant est figé au devis. `numeric`, jamais un flottant.
  amount           numeric(12, 2) not null check (amount > 0),
  currency         text not null default 'KMF',
  summary          text not null,

  status           text not null default 'BROUILLON',
  valid_until      date,

  sent_at          timestamptz,
  responded_at     timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,

  -- Décision C1 — `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 39.
  constraint quotes_status_valid check (
    status in ('BROUILLON', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'EXPIRE', 'ANNULE')
  ),
  constraint quotes_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint quotes_summary_present
    check (btrim(summary) <> '' and length(summary) <= 2000),
  constraint quotes_reference_format
    check (reference is null or reference ~ '^MORA-DVCL-[A-Z]+[0-9]{4}$'),
  -- Un devis sorti du brouillon a forcément été numéroté et daté : c'est ce
  -- qui le rend opposable. L'inverse — une référence sur un brouillon —
  -- consommerait un numéro pour rien.
  --
  -- ANNULE échappe aux deux règles, et c'est voulu : un brouillon abandonné
  -- s'annule sans avoir jamais été numéroté, tandis qu'un devis envoyé puis
  -- annulé garde le numéro qu'il a consommé.
  constraint quotes_issued_coherent check (
    (status = 'BROUILLON' and reference is null and sent_at is null)
    or (status = 'ANNULE'
        and ((reference is null and sent_at is null)
             or (reference is not null and sent_at is not null)))
    or (status in ('ENVOYE', 'ACCEPTE', 'REFUSE', 'EXPIRE')
        and reference is not null and sent_at is not null)
  ),
  constraint quotes_responded_coherent check (
    (status in ('ACCEPTE', 'REFUSE') and responded_at is not null)
    or (status not in ('ACCEPTE', 'REFUSE') and responded_at is null)
  )
);

comment on table public.quotes is
  'Devis officiellement émis à partir d''une demande (TB administrateur § 40-42). Créé par un acte administratif explicite, jamais automatiquement.';
comment on column public.quotes.valid_until is
  'Date de validité, laissée nulle : le § 134 interdit d''inventer un délai. Aucune expiration automatique n''existe donc.';
comment on column public.quotes.reference is
  'MORA-DVCL-[SÉRIE][NUMÉRO], allouée à l''envoi. Un brouillon ne consomme aucun numéro.';

create index if not exists quotes_request_idx on public.quotes (quote_request_id, created_at desc);
create index if not exists quotes_status_idx  on public.quotes (status, created_at desc);

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. LES DISPONIBILITÉS
--
-- § 85 : l'administrateur doit pouvoir définir jours, horaires, pauses,
-- exceptions et périodes bloquées. § 86-88 : jours fériés, fermetures,
-- horaires exceptionnels — tous issus d'« une configuration réelle ».
--
-- La table est donc **créée vide**, et le restera jusqu'à ce que MORA Shawiri
-- saisisse ses horaires réels. C'est la même discipline que `products` en
-- 4E-1 : le socle abandonné y avait semé des produits fictifs « pour que la
-- page ne soit pas vide ». Rien de tel ici.
--
-- Trois natures, et une seule table : ce sont trois expressions de la même
-- chose — un intervalle où l'on est joignable, ou pas.
--
--   * OUVERTURE — récurrente, sur un jour de la semaine ;
--   * EXCEPTION — ouverture ponctuelle à une date (le samedi du § 88) ;
--   * BLOCAGE   — indisponibilité à une date, totale ou partielle (§ 29, § 87).
-- -----------------------------------------------------------------------------

create table if not exists public.appointment_availabilities (
  id         uuid primary key default gen_random_uuid(),

  kind       text not null,
  -- 0 = dimanche … 6 = samedi, la convention de `extract(dow)`.
  weekday    smallint,
  on_date    date,
  starts_at  time,
  ends_at    time,

  label      text,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,

  constraint availabilities_kind_valid check (kind in ('OUVERTURE', 'EXCEPTION', 'BLOCAGE')),
  constraint availabilities_weekday_range check (weekday is null or weekday between 0 and 6),
  constraint availabilities_label_length check (label is null or length(label) <= 120),

  -- Une récurrence porte un jour de semaine et des heures, pas une date.
  constraint availabilities_ouverture_shape check (
    kind <> 'OUVERTURE'
    or (weekday is not null and on_date is null and starts_at is not null and ends_at is not null)
  ),
  -- Une exception porte une date et des heures.
  constraint availabilities_exception_shape check (
    kind <> 'EXCEPTION'
    or (on_date is not null and weekday is null and starts_at is not null and ends_at is not null)
  ),
  -- Un blocage porte une date ; ses heures sont facultatives — absentes, il
  -- couvre la journée entière (§ 87).
  constraint availabilities_blocage_shape check (
    kind <> 'BLOCAGE'
    or (on_date is not null and weekday is null
        and ((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null)))
  ),
  constraint availabilities_order check (
    starts_at is null or ends_at is null or starts_at < ends_at
  )
);

comment on table public.appointment_availabilities is
  'Disponibilités administrées (§ 85-88). Créée vide : le § 86 interdit d''inventer des jours, et les horaires réels ne sont pas tranchés.';
comment on column public.appointment_availabilities.kind is
  'OUVERTURE = récurrence hebdomadaire · EXCEPTION = ouverture ponctuelle · BLOCAGE = indisponibilité, totale si les heures sont absentes.';

create index if not exists availabilities_weekday_idx on public.appointment_availabilities (weekday)
  where kind = 'OUVERTURE' and is_active = true;
create index if not exists availabilities_date_idx on public.appointment_availabilities (on_date)
  where on_date is not null and is_active = true;

drop trigger if exists availabilities_set_updated_at on public.appointment_availabilities;
create trigger availabilities_set_updated_at
  before update on public.appointment_availabilities
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 7. LE RENDEZ-VOUS
--
-- § 60 : « utilisateur ou prospect, service, date, heure, fuseau, statut,
-- notes nécessaires, date de création ».
--
-- ## Souhait et créneau ferme sont deux choses distinctes
--
-- Le formulaire public recueille un **souhait** : une date et une préférence
-- de demi-journée, avec l'indice « nous vous proposerons l'alternative la plus
-- proche si le créneau est pris ». C'est exactement le § 60 des statuts : « En
-- attente doit être utilisé uniquement lorsque le rendez-vous nécessite
-- réellement une validation ». Ces deux valeurs restent donc dans
-- `requested_date` et `requested_slot` : ce ne sont pas des réservations.
--
-- Le créneau **ferme** est `[scheduled_at, scheduled_end)`, écrit à la
-- confirmation par l'administrateur. C'est là, et là seulement, qu'un créneau
-- est réellement pris — donc là que la double réservation doit être impossible.
--
-- ## Pourquoi une contrainte d'exclusion, et pas un déclencheur
--
-- Le § 31 exige que « le système empêche deux réservations incompatibles sur
-- le même créneau », et le § 32 qu'on revérifie au moment de la confirmation.
-- Un déclencheur qui lit puis décide laisse une fenêtre entre la lecture et
-- l'écriture : deux confirmations simultanées peuvent y passer toutes les deux.
-- C'est le même défaut que le `select max(…) + 1` que la phase 4D a refusé
-- pour les numéros de document.
--
-- `exclude using gist` ne laisse pas cette fenêtre : c'est l'index lui-même
-- qui refuse le chevauchement, quelle que soit la façon dont la ligne arrive —
-- formulaire, action serveur, script ou requête SQL directe. La clause
-- `where (status = 'CONFIRME')` fait que les demandes en attente, annulées et
-- terminées ne bloquent rien, ce qui est précisément le § 64 : « le créneau
-- doit pouvoir redevenir disponible » après une annulation.
-- -----------------------------------------------------------------------------

create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),

  -- § 43 : « chaque rendez-vous **confirmé** doit disposer d'une référence ».
  -- Nulle tant qu'il n'est qu'une demande — un souhait ne consomme pas de
  -- numéro. Décision B2 pour le format.
  reference        text unique,

  lead_id          uuid not null references public.leads (id) on delete restrict,
  user_id          uuid references auth.users (id) on delete set null,

  -- § 80 et § 122 : un rendez-vous peut être rattaché à une demande de devis.
  quote_request_id uuid references public.quote_requests (id) on delete set null,
  service_id       uuid references public.services (id) on delete set null,

  subject          text not null,
  -- § 35-39 : présentiel, téléphone, visioconférence, WhatsApp. Le code est
  -- normalisé côté serveur ; le libellé exact choisi par le visiteur est
  -- conservé à côté, pour que l'administration lise ce qu'il a lu.
  channel          text not null,
  channel_label    text,

  -- Le souhait du visiteur.
  requested_date   date,
  requested_slot   text,

  -- Le créneau ferme, écrit à la confirmation.
  scheduled_at     timestamptz,
  scheduled_end    timestamptz,
  -- § 25 : « ne pas inventer de durée si elle n'est pas définie ». Nulle tant
  -- qu'aucune durée n'est configurée ; l'administrateur donne alors une fin.
  timezone         text not null default 'Indian/Comoro',

  budget_label     text,
  message          text,
  details          jsonb not null default '[]'::jsonb,

  status           text not null default 'EN_ATTENTE',
  cancel_reason    text,
  source           text,

  assigned_to      uuid references public.profiles (id) on delete set null,

  confirmed_at     timestamptz,
  cancelled_at     timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- § 59 : « En attente, Confirmé, Annulé, Terminé », au minimum. Aucune
  -- valeur supplémentaire n'est inventée.
  constraint appointments_status_valid check (
    status in ('EN_ATTENTE', 'CONFIRME', 'ANNULE', 'TERMINE')
  ),
  constraint appointments_channel_valid check (
    channel in ('SUR_PLACE', 'TELEPHONE', 'VISIOCONFERENCE', 'WHATSAPP', 'AUTRE')
  ),
  constraint appointments_reference_format
    check (reference is null or reference ~ '^MORA-RVCL-[A-Z]+[0-9]{4}$'),
  constraint appointments_subject_present
    check (btrim(subject) <> '' and length(subject) <= 160),
  constraint appointments_message_length
    check (message is null or length(message) <= 4000),
  constraint appointments_slot_length
    check (requested_slot is null or length(requested_slot) <= 80),
  constraint appointments_channel_label_length
    check (channel_label is null or length(channel_label) <= 80),
  constraint appointments_budget_length
    check (budget_label is null or length(budget_label) <= 80),
  constraint appointments_source_length
    check (source is null or length(source) <= 60),
  constraint appointments_cancel_reason_length
    check (cancel_reason is null or length(cancel_reason) <= 500),
  constraint appointments_details_is_array
    check (jsonb_typeof(details) = 'array'),
  constraint appointments_timezone_present
    check (btrim(timezone) <> '' and length(timezone) <= 60),

  -- Un créneau ferme est un intervalle, ou n'est pas.
  constraint appointments_schedule_shape check (
    (scheduled_at is null and scheduled_end is null)
    or (scheduled_at is not null and scheduled_end is not null and scheduled_end > scheduled_at)
  ),
  -- § 61 : « un rendez-vous confirmé correspond à un créneau réellement
  -- enregistré ». Donc : pas de confirmation sans créneau, ni sans référence.
  constraint appointments_confirmed_shape check (
    status <> 'CONFIRME'
    or (scheduled_at is not null and reference is not null and confirmed_at is not null)
  ),
  -- Un rendez-vous terminé a bien eu lieu : il a donc été confirmé avant.
  constraint appointments_completed_shape check (
    status <> 'TERMINE'
    or (scheduled_at is not null and reference is not null and completed_at is not null)
  ),
  constraint appointments_cancelled_shape check (
    (status = 'ANNULE' and cancelled_at is not null)
    or (status <> 'ANNULE' and cancelled_at is null)
  ),

  -- Le § 31, garanti par l'index et non par le code appelant.
  constraint appointments_no_double_booking
    exclude using gist (tstzrange(scheduled_at, scheduled_end, '[)') with &&)
    where (status = 'CONFIRME')
);

comment on table public.appointments is
  'Rendez-vous (§ 60). requested_* porte le souhait du visiteur, scheduled_* le créneau ferme fixé à la confirmation. Statuts : § 59.';
comment on column public.appointments.requested_date is
  'Date souhaitée par le visiteur, pas une réservation. Le formulaire public annonce explicitement qu''une alternative peut être proposée.';
comment on column public.appointments.scheduled_at is
  'Début du créneau ferme. Écrit à la confirmation administrative — le seul moment où un créneau est réellement pris.';
comment on constraint appointments_no_double_booking on public.appointments is
  '§ 31 : deux rendez-vous CONFIRME ne peuvent pas se chevaucher. Garanti par l''index, donc sans fenêtre de concurrence.';

create index if not exists appointments_status_idx    on public.appointments (status, requested_date);
create index if not exists appointments_schedule_idx  on public.appointments (scheduled_at)
  where scheduled_at is not null;
create index if not exists appointments_lead_idx      on public.appointments (lead_id, created_at desc);
create index if not exists appointments_user_idx      on public.appointments (user_id, created_at desc)
  where user_id is not null;
create index if not exists appointments_request_idx   on public.appointments (quote_request_id)
  where quote_request_id is not null;
create index if not exists appointments_assigned_idx  on public.appointments (assigned_to)
  where assigned_to is not null;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. L'HISTORIQUE MÉTIER — QUI N'EST PAS LE JOURNAL D'AUDIT
--
-- Le point 12 du cadrage est explicite, et il a raison : les deux ont des
-- fonctions différentes. L'audit trace un fait technique et sécuritaire, il
-- est en ajout seul et illisible pour un non-technicien. L'historique métier
-- raconte la vie d'une demande, et c'est lui que le § 57 exige pour une
-- reprogrammation et le § 114 pour un rendez-vous.
--
-- Les deux sont écrits. Aucun ne remplace l'autre, et aucun second système
-- d'audit n'est créé : le journal d'audit reste celui de la phase 4A.
--
-- ## Un devis n'a pas son propre historique
--
-- Le cycle d'un devis est un épisode de la vie de sa demande — c'est
-- exactement ce que le § 26 de l'espace client donne à lire au client :
-- « Devis envoyé », puis « Acceptée » ou « Refusée ». Ses changements de
-- statut sont donc consignés dans l'historique de la demande, avec la
-- référence du devis en contexte. Une troisième table ne dirait rien de plus.
-- -----------------------------------------------------------------------------

create table if not exists public.quote_request_events (
  id               bigint generated always as identity primary key,
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,

  -- Ce que l'événement dit. Une transition de statut, ou un acte daté.
  kind             text not null,
  from_status      text,
  to_status        text,
  -- Référence du devis concerné, quand l'événement en vient un.
  quote_reference  text,
  note             text,

  actor_id         uuid references auth.users (id) on delete set null,
  -- Instantané de l'auteur : l'historique reste lisible après suppression du
  -- compte, comme pour le journal d'audit (§ 72 des rôles).
  actor_label      text,
  created_at       timestamptz not null default now(),

  constraint qr_events_kind_valid check (
    kind in ('CREATION', 'STATUT', 'DEVIS_CREE', 'DEVIS_STATUT', 'AFFECTATION', 'NOTE')
  ),
  constraint qr_events_note_length  check (note is null or length(note) <= 1000),
  constraint qr_events_label_length check (actor_label is null or length(actor_label) <= 120)
);

comment on table public.quote_request_events is
  'Historique métier d''une demande (§ 55 « historique »). Distinct du journal d''audit, qui reste celui de la phase 4A.';

create index if not exists qr_events_request_idx on public.quote_request_events (quote_request_id, created_at);


create table if not exists public.appointment_events (
  id                   bigint generated always as identity primary key,
  appointment_id       uuid not null references public.appointments (id) on delete cascade,

  kind                 text not null,
  from_status          text,
  to_status            text,
  -- § 57 : l'historique de reprogrammation. Les deux créneaux y figurent.
  scheduled_at_before  timestamptz,
  scheduled_at_after   timestamptz,
  note                 text,

  actor_id             uuid references auth.users (id) on delete set null,
  actor_label          text,
  created_at           timestamptz not null default now(),

  constraint ap_events_kind_valid check (
    kind in ('CREATION', 'STATUT', 'REPROGRAMMATION', 'AFFECTATION', 'NOTE')
  ),
  constraint ap_events_note_length  check (note is null or length(note) <= 1000),
  constraint ap_events_label_length check (actor_label is null or length(actor_label) <= 120)
);

comment on table public.appointment_events is
  'Historique métier d''un rendez-vous, reprogrammations comprises (§ 57, § 114).';

create index if not exists ap_events_appointment_idx on public.appointment_events (appointment_id, created_at);


-- -----------------------------------------------------------------------------
-- 9. LES NOTES INTERNES
--
-- § 60 des rendez-vous parle de « notes nécessaires », et § 75 de préparation
-- du rendez-vous. Une note interne n'est pas destinée au demandeur.
--
-- Elle ne peut donc pas être une colonne de `quote_requests` : RLS juge une
-- **ligne**, pas une colonne. Un CLIENT autorisé à lire sa demande lirait du
-- même coup la note qu'on aurait écrite à son sujet. Une table séparée, dont
-- aucune politique n'ouvre la lecture au demandeur, est la seule façon de
-- tenir la promesse.
--
-- Deux clés étrangères et une contrainte d'exclusivité, plutôt qu'un couple
-- (type, identifiant) : l'intégrité référentielle reste vraie, ce qu'une clé
-- polymorphe en texte abandonne.
-- -----------------------------------------------------------------------------

create table if not exists public.relation_notes (
  id               uuid primary key default gen_random_uuid(),

  quote_request_id uuid references public.quote_requests (id) on delete cascade,
  appointment_id   uuid references public.appointments (id) on delete cascade,

  body             text not null,

  -- Jamais reçu du navigateur : imposé par déclencheur depuis auth.uid().
  author_id        uuid references auth.users (id) on delete set null,
  author_label     text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint relation_notes_one_target
    check (num_nonnulls(quote_request_id, appointment_id) = 1),
  constraint relation_notes_body_present
    check (btrim(body) <> '' and length(body) <= 4000),
  constraint relation_notes_label_length
    check (author_label is null or length(author_label) <= 120)
);

comment on table public.relation_notes is
  'Notes internes sur une demande ou un rendez-vous. Aucune politique ne les ouvre au demandeur : elles ne lui sont pas destinées.';
comment on column public.relation_notes.author_id is
  'Auteur, imposé par déclencheur depuis auth.uid(). Le point 9 du cadrage interdit de le recevoir du navigateur.';

create index if not exists relation_notes_request_idx on public.relation_notes (quote_request_id, created_at desc)
  where quote_request_id is not null;
create index if not exists relation_notes_appointment_idx on public.relation_notes (appointment_id, created_at desc)
  where appointment_id is not null;

drop trigger if exists relation_notes_set_updated_at on public.relation_notes;
create trigger relation_notes_set_updated_at
  before update on public.relation_notes
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 10. L'AUTEUR D'UN ACTE
--
-- Le point 9 du cadrage : l'auteur d'une note ne doit jamais venir du
-- navigateur. Cette fonction le lit dans la session, et rien d'autre.
--
-- `DEFINER` parce qu'elle lit `profiles`, que la session ne peut pas toujours
-- atteindre pour son propre compte ; elle ne consulte jamais `current_user`.
-- -----------------------------------------------------------------------------

create or replace function public.relation_actor_label()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.username, p.full_name, left(auth.uid()::text, 8))
    from public.profiles p
   where p.id = auth.uid();
$$;

comment on function public.relation_actor_label() is
  'Instantané lisible de l''auteur de l''acte courant, lu dans la session. Jamais reçu du navigateur.';

revoke execute on function public.relation_actor_label() from public, anon;
grant  execute on function public.relation_actor_label() to authenticated, service_role;


create or replace function public.tg_relation_notes_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Écrasement inconditionnel : ce que le navigateur aurait envoyé est ignoré.
  new.author_id    := auth.uid();
  new.author_label := public.relation_actor_label();
  return new;
end;
$$;

comment on function public.tg_relation_notes_author() is
  'Impose l''auteur d''une note depuis auth.uid(). Une valeur reçue du navigateur est écrasée, jamais lue.';

drop trigger if exists relation_notes_author on public.relation_notes;
create trigger relation_notes_author
  before insert or update on public.relation_notes
  for each row execute function public.tg_relation_notes_author();


-- -----------------------------------------------------------------------------
-- 11. LES TRANSITIONS DE LA DEMANDE
--
-- Le point 11 du cadrage : « Si certaines transitions ont des conséquences
-- métier, protège la TRANSITION, pas uniquement la ligne. » Une politique RLS
-- juge une ligne : elle ne sait pas qu'une demande vient de passer de
-- « Nouvelle » à « Acceptée ». Le déclencheur, lui, voit les deux valeurs.
--
-- Deux règles, et pas une de plus :
--
--   1. changer un statut exige `quotes.manage` — « Gérer le cycle de vie des
--      devis », la permission semée en 4A pour exactement cela. Corriger un
--      libellé ou affecter la demande n'exige que `quotes.update` : modifier
--      n'est pas décider, comme publier n'était pas modifier en 4E ;
--   2. le graphe des transitions est fermé. Un statut final le reste.
--
-- Et une conséquence métier : « Devis envoyé » n'est pas une opinion. La
-- demande ne peut y entrer que si un devis a réellement été émis pour elle.
--
-- `SECURITY INVOKER` — la leçon de 4E-1, rappelée en tête de fichier.
-- -----------------------------------------------------------------------------

create or replace function public.tg_quote_requests_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
begin
  if new.status is not distinct from old.status then
    -- Pas de transition : la politique RLS a déjà tranché sur la modification.
    return new;
  end if;

  if not public.is_privileged_db_role() then
    if not public.has_permission('quotes.manage') then
      raise exception 'Changement de statut refusé : permission quotes.manage requise.'
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'NOUVELLE'     then array['EN_ETUDE', 'ANNULEE']
    when 'EN_ETUDE'     then array['DEVIS_ENVOYE', 'REFUSEE', 'TERMINEE', 'ANNULEE']
    when 'DEVIS_ENVOYE' then array['ACCEPTEE', 'REFUSEE', 'ANNULEE']
    when 'ACCEPTEE'     then array['TERMINEE', 'ANNULEE']
    -- REFUSEE, TERMINEE, ANNULEE : états finaux.
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : % ne peut pas devenir %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- « Devis envoyé » suppose un devis réellement émis, pas une intention.
  if new.status = 'DEVIS_ENVOYE' and not exists (
    select 1 from public.quotes q
     where q.quote_request_id = new.id
       and q.status <> 'BROUILLON'
  ) then
    raise exception 'Statut refusé : aucun devis n''a été émis pour cette demande.'
      using errcode = 'check_violation';
  end if;

  -- La date de clôture suit le statut, sans que l'appelant ait à y penser :
  -- la contrainte `quote_requests_closed_coherent` l'exigerait sinon de lui.
  if new.status in ('ACCEPTEE', 'REFUSEE', 'TERMINEE', 'ANNULEE') then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;

  return new;
end;
$$;

comment on function public.tg_quote_requests_transition_guard() is
  'Exige quotes.manage pour tout changement de statut d''une demande, ferme le graphe des transitions et refuse « Devis envoyé » sans devis émis. SECURITY INVOKER.';

drop trigger if exists quote_requests_transition_guard on public.quote_requests;
create trigger quote_requests_transition_guard
  before update on public.quote_requests
  for each row execute function public.tg_quote_requests_transition_guard();


-- La référence est immuable, comme celle d'un document (§ 39-40 du prompt
-- maître). Le privilège de colonne l'interdit déjà à une session ; ce garde
-- couvre aussi un script à clé de service qui l'oublierait.
create or replace function public.tg_relation_reference_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.reference is not null and new.reference is distinct from old.reference then
    raise exception 'La référence % est immuable.', old.reference
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.tg_relation_reference_immutable() is
  'Une référence attribuée ne change plus. Même règle que pour un document émis (prompt maître § 39-40).';

drop trigger if exists quote_requests_reference_immutable on public.quote_requests;
create trigger quote_requests_reference_immutable
  before update on public.quote_requests
  for each row execute function public.tg_relation_reference_immutable();

drop trigger if exists quotes_reference_immutable on public.quotes;
create trigger quotes_reference_immutable
  before update on public.quotes
  for each row execute function public.tg_relation_reference_immutable();

drop trigger if exists appointments_reference_immutable on public.appointments;
create trigger appointments_reference_immutable
  before update on public.appointments
  for each row execute function public.tg_relation_reference_immutable();


-- -----------------------------------------------------------------------------
-- 12. LES TRANSITIONS DU DEVIS ET DU RENDEZ-VOUS
-- -----------------------------------------------------------------------------

create or replace function public.tg_quotes_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_privileged_db_role() then
    if not public.has_permission('quotes.manage') then
      raise exception 'Changement de statut refusé : permission quotes.manage requise.'
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'BROUILLON' then array['ENVOYE', 'ANNULE']
    when 'ENVOYE'    then array['ACCEPTE', 'REFUSE', 'EXPIRE', 'ANNULE']
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : un devis % ne peut pas devenir %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('ACCEPTE', 'REFUSE') then
    new.responded_at := coalesce(new.responded_at, now());
  end if;

  return new;
end;
$$;

comment on function public.tg_quotes_transition_guard() is
  'Exige quotes.manage pour tout changement de statut d''un devis et ferme le graphe. Le passage hors brouillon exige en outre une référence, que seule send_quote peut attribuer.';

drop trigger if exists quotes_transition_guard on public.quotes;
create trigger quotes_transition_guard
  before update on public.quotes
  for each row execute function public.tg_quotes_transition_guard();


create or replace function public.tg_appointments_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
  v_needed  text;
begin
  if new.status is not distinct from old.status then
    -- Pas de transition. Mais déplacer un créneau ferme en est une autre
    -- forme : le § 56 en fait un acte à part entière, et le § 57 veut qu'il
    -- laisse une trace. Il exige donc au moins appointments.update.
    if new.scheduled_at is distinct from old.scheduled_at
       or new.scheduled_end is distinct from old.scheduled_end then
      if not public.is_privileged_db_role()
         and not public.has_permission('appointments.update') then
        raise exception 'Reprogrammation refusée : permission appointments.update requise.'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- § 51-53 : annuler est un acte distinct, et la phase 4A lui a réservé sa
  -- propre permission. Un compte qui peut modifier un rendez-vous ne peut donc
  -- pas l'annuler pour autant.
  v_needed := case when new.status = 'ANNULE' then 'appointments.cancel'
                   else 'appointments.update' end;

  if not public.is_privileged_db_role() then
    if not public.has_permission(v_needed) then
      raise exception 'Changement de statut refusé : permission % requise.', v_needed
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'EN_ATTENTE' then array['CONFIRME', 'ANNULE']
    when 'CONFIRME'   then array['TERMINE', 'ANNULE']
    -- ANNULE, TERMINE : états finaux (§ 62, § 63).
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : un rendez-vous % ne peut pas devenir %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'CONFIRME' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  elsif new.status = 'ANNULE' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  elsif new.status = 'TERMINE' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.tg_appointments_transition_guard() is
  'Ferme le graphe des statuts d''un rendez-vous et distingue appointments.cancel de appointments.update (§ 51-53). SECURITY INVOKER.';

drop trigger if exists appointments_transition_guard on public.appointments;
create trigger appointments_transition_guard
  before update on public.appointments
  for each row execute function public.tg_appointments_transition_guard();


-- -----------------------------------------------------------------------------
-- 13. L'HISTORIQUE MÉTIER, ÉCRIT PAR LA BASE
--
-- Confier l'historique au code appelant, c'est accepter qu'il manque dès qu'un
-- chemin l'oublie — un script de reprise, une correction en SQL. Les
-- déclencheurs l'écrivent donc quelle que soit la provenance de l'écriture.
--
-- `DEFINER` : ces fonctions écrivent dans des tables où la session n'a aucun
-- droit d'insertion, et ne consultent jamais `current_user`.
-- -----------------------------------------------------------------------------

create or replace function public.tg_quote_requests_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.quote_request_events
      (quote_request_id, kind, to_status, actor_id, actor_label)
    values
      (new.id, 'CREATION', new.status, auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.quote_request_events
      (quote_request_id, kind, from_status, to_status, actor_id, actor_label)
    values
      (new.id, 'STATUT', old.status, new.status, auth.uid(), public.relation_actor_label());
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.quote_request_events
      (quote_request_id, kind, actor_id, actor_label)
    values
      (new.id, 'AFFECTATION', auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$$;

comment on function public.tg_quote_requests_history() is
  'Écrit l''historique métier d''une demande à chaque changement de statut ou d''affectation, quelle que soit l''origine de l''écriture.';

drop trigger if exists quote_requests_history on public.quote_requests;
create trigger quote_requests_history
  after insert or update on public.quote_requests
  for each row execute function public.tg_quote_requests_history();


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
      (quote_request_id, kind, from_status, to_status, quote_reference, actor_id, actor_label)
    values
      (new.quote_request_id, 'DEVIS_STATUT', old.status, new.status, new.reference,
       auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$$;

comment on function public.tg_quotes_history() is
  'Consigne le cycle du devis dans l''historique de sa demande : c''est ce que le § 26 de l''espace client donne à lire au client.';

drop trigger if exists quotes_history on public.quotes;
create trigger quotes_history
  after insert or update on public.quotes
  for each row execute function public.tg_quotes_history();


create or replace function public.tg_appointments_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events
      (appointment_id, kind, to_status, scheduled_at_after, actor_id, actor_label)
    values
      (new.id, 'CREATION', new.status, new.scheduled_at,
       auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.appointment_events
      (appointment_id, kind, from_status, to_status,
       scheduled_at_before, scheduled_at_after, note, actor_id, actor_label)
    values
      (new.id, 'STATUT', old.status, new.status,
       old.scheduled_at, new.scheduled_at, new.cancel_reason,
       auth.uid(), public.relation_actor_label());

  elsif new.scheduled_at is distinct from old.scheduled_at
     or new.scheduled_end is distinct from old.scheduled_end then
    -- § 57 : l'historique de reprogrammation conserve les deux créneaux.
    insert into public.appointment_events
      (appointment_id, kind, scheduled_at_before, scheduled_at_after, actor_id, actor_label)
    values
      (new.id, 'REPROGRAMMATION', old.scheduled_at, new.scheduled_at,
       auth.uid(), public.relation_actor_label());
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.appointment_events
      (appointment_id, kind, actor_id, actor_label)
    values
      (new.id, 'AFFECTATION', auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$$;

comment on function public.tg_appointments_history() is
  'Écrit l''historique métier d''un rendez-vous : statuts, reprogrammations (§ 57) et affectations.';

drop trigger if exists appointments_history on public.appointments;
create trigger appointments_history
  after insert or update on public.appointments
  for each row execute function public.tg_appointments_history();


-- -----------------------------------------------------------------------------
-- 14. L'AUDIT — MAIGRE PAR CONSTRUCTION
--
-- Le point 17 du cadrage : « Le journal d'audit doit éviter de recopier
-- inutilement les messages complets ou autres données personnelles. » Une
-- demande contient un nom, une adresse, un téléphone et un message libre. Rien
-- de tout cela n'entre ici.
--
-- Ce que le journal retient : quelle ressource, quel statut, et le statut
-- précédent quand il change. La référence suffit à retrouver la ligne — c'est
-- exactement son rôle.
--
-- `DEFINER` est correct : cette fonction écrit dans `audit_logs`, que la
-- session n'atteint pas, et ne consulte jamais `current_user`.
-- -----------------------------------------------------------------------------

create or replace function public.tg_relation_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      record;
  v_metadata jsonb;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_table_name = 'leads' then
    -- Ni nom, ni adresse, ni téléphone : le nombre de demandes suffit à
    -- constater qu'un prospect a été créé ou revu.
    v_metadata := jsonb_build_object('demandes', v_row.request_count);

  elsif tg_table_name = 'relation_notes' then
    -- Le corps de la note reste dans la note. Sa longueur dit qu'elle existe.
    v_metadata := jsonb_build_object(
      'sur',       case when v_row.quote_request_id is not null then 'demande' else 'rendez_vous' end,
      'longueur',  length(v_row.body)
    );

  elsif tg_table_name = 'appointment_availabilities' then
    v_metadata := jsonb_build_object(
      'nature', v_row.kind,
      'jour',   v_row.weekday,
      'date',   v_row.on_date,
      'active', v_row.is_active
    );

  else
    -- Demandes, devis, rendez-vous : la référence et le statut.
    v_metadata := jsonb_build_object(
      'reference', v_row.reference,
      'statut',    v_row.status
    );

    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_metadata := v_metadata || jsonb_build_object('statut_precedent', old.status);
    end if;
  end if;

  perform public.record_audit_event(
    'relation.' || tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_row.id::text,
    'SUCCES',
    v_metadata
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.tg_relation_audit() is
  'Trace les écritures de la relation client dans le journal d''audit de la phase 4A. Ne recopie ni message, ni nom, ni adresse (point 17 du cadrage).';

drop trigger if exists leads_audit on public.leads;
create trigger leads_audit
  after insert or update or delete on public.leads
  for each row execute function public.tg_relation_audit();

drop trigger if exists quote_requests_audit on public.quote_requests;
create trigger quote_requests_audit
  after insert or update or delete on public.quote_requests
  for each row execute function public.tg_relation_audit();

drop trigger if exists quotes_audit on public.quotes;
create trigger quotes_audit
  after insert or update or delete on public.quotes
  for each row execute function public.tg_relation_audit();

drop trigger if exists appointments_audit on public.appointments;
create trigger appointments_audit
  after insert or update or delete on public.appointments
  for each row execute function public.tg_relation_audit();

drop trigger if exists relation_notes_audit on public.relation_notes;
create trigger relation_notes_audit
  after insert or update or delete on public.relation_notes
  for each row execute function public.tg_relation_audit();

drop trigger if exists availabilities_audit on public.appointment_availabilities;
create trigger availabilities_audit
  after insert or update or delete on public.appointment_availabilities
  for each row execute function public.tg_relation_audit();


-- -----------------------------------------------------------------------------
-- 15. L'AUTEUR D'UN DEVIS
--
-- Point 9 du cadrage : le propriétaire d'une ligne ne se reçoit pas du
-- navigateur. `created_by` et `updated_by` sont donc imposés, pas lus.
-- -----------------------------------------------------------------------------

create or replace function public.tg_relation_stamp_author()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;

  new.updated_by := auth.uid();
  return new;
end;
$$;

comment on function public.tg_relation_stamp_author() is
  'Impose created_by et updated_by depuis auth.uid(). Une valeur reçue du navigateur est écrasée.';

drop trigger if exists quotes_stamp_author on public.quotes;
create trigger quotes_stamp_author
  before insert or update on public.quotes
  for each row execute function public.tg_relation_stamp_author();

drop trigger if exists availabilities_stamp_author on public.appointment_availabilities;
create trigger availabilities_stamp_author
  before insert or update on public.appointment_availabilities
  for each row execute function public.tg_relation_stamp_author();


-- -----------------------------------------------------------------------------
-- 16. UN CRÉNEAU EST-IL OUVERT ?
--
-- § 22 : « Le système ne doit jamais afficher un créneau comme disponible s'il
-- ne l'est pas réellement. » Le corollaire, moins souvent écrit : il ne doit
-- pas non plus refuser un créneau au nom d'une règle que personne n'a posée.
--
-- La table des disponibilités est vide au départ, et le § 86 interdit de la
-- remplir d'office. Cette fonction répond donc :
--
--   * aucune ouverture déclarée → **vrai**. Rien n'a été dit, rien n'est
--     refusé : MORA Shawiri confirme ses rendez-vous comme aujourd'hui ;
--   * des ouvertures déclarées → le créneau doit tenir dans l'une d'elles, et
--     ne croiser aucun blocage.
--
-- La comparaison se fait dans le fuseau du site (`site.timezone`, posé en
-- phase 4A à `Indian/Comoro`), parce qu'une plage horaire administrée est
-- locale : « 08H-12H » ne veut rien dire en UTC.
-- -----------------------------------------------------------------------------

create or replace function public.appointment_slot_is_open(
  p_start timestamptz,
  p_end   timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone     text;
  v_start    timestamp;
  v_end      timestamp;
  v_day      date;
  v_declared boolean;
begin
  if p_start is null or p_end is null then
    return true;
  end if;

  select coalesce(value #>> '{}', 'Indian/Comoro')
    into v_zone
    from public.settings
   where key = 'site.timezone';

  v_zone  := coalesce(v_zone, 'Indian/Comoro');
  v_start := p_start at time zone v_zone;
  v_end   := p_end   at time zone v_zone;
  v_day   := v_start::date;

  -- Un créneau à cheval sur deux jours ne peut pas être décrit par une plage
  -- horaire quotidienne. Plutôt qu'inventer une règle de découpage, on ne
  -- prétend pas savoir : l'appelant en porte la responsabilité.
  if v_end::date <> v_day then
    return true;
  end if;

  select exists (
    select 1 from public.appointment_availabilities a
     where a.is_active = true
       and a.kind in ('OUVERTURE', 'EXCEPTION')
  ) into v_declared;

  if not v_declared then
    return true;
  end if;

  -- Une ouverture doit contenir le créneau entier.
  if not exists (
    select 1 from public.appointment_availabilities a
     where a.is_active = true
       and (
         (a.kind = 'OUVERTURE' and a.weekday = extract(dow from v_day)::smallint)
         or (a.kind = 'EXCEPTION' and a.on_date = v_day)
       )
       and a.starts_at <= v_start::time
       and a.ends_at   >= v_end::time
  ) then
    return false;
  end if;

  -- Et aucun blocage ne doit le croiser (§ 29, § 87).
  if exists (
    select 1 from public.appointment_availabilities a
     where a.is_active = true
       and a.kind = 'BLOCAGE'
       and a.on_date = v_day
       and (
         a.starts_at is null
         or (a.starts_at < v_end::time and a.ends_at > v_start::time)
       )
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.appointment_slot_is_open(timestamptz, timestamptz) is
  'Vrai si le créneau tient dans une ouverture déclarée et ne croise aucun blocage. Vrai aussi lorsque rien n''est déclaré : le § 86 interdit d''inventer un calendrier.';

revoke execute on function public.appointment_slot_is_open(timestamptz, timestamptz) from public, anon;
grant  execute on function public.appointment_slot_is_open(timestamptz, timestamptz) to authenticated, service_role;


-- Le garde qui l'applique. Séparé du garde de transition pour que chacun dise
-- une seule chose : celui-ci ne parle que du calendrier.
create or replace function public.tg_appointments_calendar_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.scheduled_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.scheduled_end is not distinct from old.scheduled_end then
    return new;
  end if;

  if not public.appointment_slot_is_open(new.scheduled_at, new.scheduled_end) then
    raise exception 'Créneau refusé : il sort des disponibilités déclarées.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.tg_appointments_calendar_guard() is
  'Refuse un créneau ferme hors des disponibilités déclarées. Ne refuse rien tant qu''aucune disponibilité n''est saisie.';

drop trigger if exists appointments_calendar_guard on public.appointments;
create trigger appointments_calendar_guard
  before insert or update on public.appointments
  for each row execute function public.tg_appointments_calendar_guard();


-- -----------------------------------------------------------------------------
-- 17. LA SEULE PORTE PUBLIQUE — LES DEUX SOUMISSIONS
--
-- Ces deux fonctions sont le seul moyen, pour un visiteur ou un client, de
-- créer une ligne. Les tables n'ont aucune politique d'écriture pour `anon` ni
-- pour `authenticated` : il n'y a rien à contourner en modifiant une requête.
--
-- ## Ce qui ne peut pas être usurpé
--
-- `user_id` est lu dans `auth.uid()`, à l'intérieur de la fonction. Aucun
-- paramètre ne permet de le proposer. Un CLIENT qui réécrirait la requête HTTP
-- n'aurait aucun champ à falsifier — c'est le point 9 du cadrage, obtenu par
-- construction plutôt que par validation.
--
-- `leads.user_id` va plus loin : il n'est écrit que si l'adresse soumise est
-- **celle du compte connecté**. Sans cette précaution, un client connecté qui
-- saisirait l'adresse d'un tiers s'approprierait la fiche de ce tiers, et en
-- lirait le nom et le téléphone. Le dédoublonnage du § 59 regroupe les envois
-- d'une même adresse ; il ne donne aucun droit.
--
-- ## Double soumission
--
-- Le § 99 l'exige, et le point E du cadrage aussi. La route Next.js tient déjà
-- une empreinte en mémoire, mais elle est propre à une instance. Ici, la
-- fenêtre est en base : deux envois identiques à moins de dix minutes ne
-- créent qu'une demande, et la seconde reçoit la référence de la première.
-- Le visiteur voit une confirmation dans les deux cas — ce qui est vrai.
--
-- ## Limitation de fréquence
--
-- Également en base, donc partagée entre instances : c'est ce qui manquait à
-- la protection en mémoire. Elle ne la remplace pas, elle s'y ajoute — le
-- point 18 du cadrage interdit d'affaiblir une protection existante.
-- Seule une empreinte est stockée, jamais l'adresse IP.
-- -----------------------------------------------------------------------------

create or replace function public.relation_rate_limit_ok(
  p_bucket       text,
  p_client_hash  text,
  p_limit        integer,
  p_window_secs  integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_client_hash is null or btrim(p_client_hash) = '' then
    -- Sans empreinte, rien à compter. La route Next.js reste la première
    -- barrière ; on ne bloque pas un envoi légitime faute d'en-tête.
    return true;
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  insert into public.rate_limit_counters (bucket, subject_hash, window_start, attempts)
  values (p_bucket, p_client_hash, v_window, 1)
  on conflict (bucket, subject_hash, window_start) do update
    set attempts   = public.rate_limit_counters.attempts + 1,
        updated_at = now()
  returning attempts into v_count;

  return v_count <= p_limit;
end;
$$;

comment on function public.relation_rate_limit_ok(text, text, integer, integer) is
  'Incrémente et évalue un compteur partagé entre instances, sur empreinte. Complète la limitation en mémoire de la route, sans la remplacer.';

revoke execute on function public.relation_rate_limit_ok(text, text, integer, integer) from public, anon, authenticated;
grant  execute on function public.relation_rate_limit_ok(text, text, integer, integer) to service_role;


-- Fiche prospect : retrouvée ou créée, jamais dupliquée (§ 59).
create or replace function public.relation_upsert_lead(
  p_email     text,
  p_full_name text,
  p_phone     text
)
returns public.leads
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_caller  uuid := auth.uid();
  v_own     boolean := false;
  v_lead    public.leads%rowtype;
begin
  if v_email = '' then
    raise exception 'Adresse e-mail requise.' using errcode = 'check_violation';
  end if;

  -- Le compte connecté ne s'approprie la fiche que si l'adresse est la sienne.
  if v_caller is not null then
    select true into v_own
      from auth.users u
     where u.id = v_caller
       and lower(u.email) = v_email;
  end if;

  insert into public.leads as l (email, full_name, phone, user_id, request_count, last_seen_at)
  values (
    v_email,
    left(btrim(coalesce(p_full_name, '')), 120),
    nullif(left(btrim(coalesce(p_phone, '')), 40), ''),
    case when coalesce(v_own, false) then v_caller else null end,
    1,
    now()
  )
  on conflict (email) do update
    set full_name     = case
                          when btrim(coalesce(excluded.full_name, '')) <> '' then excluded.full_name
                          else l.full_name
                        end,
        phone         = coalesce(excluded.phone, l.phone),
        -- Un rattachement acquis ne se perd pas, et ne se vole pas : la
        -- condition `l.user_id is null` empêche un second compte de le reprendre.
        user_id       = case
                          when l.user_id is null then excluded.user_id
                          else l.user_id
                        end,
        request_count = l.request_count + 1,
        last_seen_at  = now(),
        updated_at    = now()
  returning * into v_lead;

  return v_lead;
end;
$$;

comment on function public.relation_upsert_lead(text, text, text) is
  'Retrouve ou crée la fiche prospect d''une adresse normalisée (§ 59). Ne rattache un compte que si l''adresse soumise est celle de la session.';

revoke execute on function public.relation_upsert_lead(text, text, text) from public, anon, authenticated;
grant  execute on function public.relation_upsert_lead(text, text, text) to service_role;


create or replace function public.submit_quote_request(
  p_full_name    text,
  p_email        text,
  p_phone        text default null,
  p_organisation text default null,
  p_subject      text default null,
  p_budget       text default null,
  p_message      text default null,
  p_service_slug text default null,
  p_offer_title  text default null,
  p_details      jsonb default '[]'::jsonb,
  p_source       text default null,
  p_client_hash  text default null
)
returns table (reference text, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead       public.leads%rowtype;
  v_service    uuid;
  v_reference  text;
  v_series     text;
  v_number     integer;
  v_existing   text;
  v_message    text := btrim(coalesce(p_message, ''));
  v_subject    text := btrim(coalesce(p_subject, ''));
begin
  if not public.relation_rate_limit_ok('relation.demande', p_client_hash, 5, 600) then
    raise exception 'Trop de demandes envoyées depuis cette connexion.'
      using errcode = '54000';
  end if;

  if v_subject = '' or v_message = '' then
    raise exception 'Sujet et message sont requis.' using errcode = 'check_violation';
  end if;

  v_lead := public.relation_upsert_lead(p_email, p_full_name, p_phone);

  -- § 99 : la même demande, deux fois, n'en fait qu'une.
  select qr.reference into v_existing
    from public.quote_requests qr
   where qr.lead_id = v_lead.id
     and qr.subject = left(v_subject, 160)
     and qr.message = left(v_message, 4000)
     and qr.created_at > now() - interval '10 minutes'
   order by qr.created_at desc
   limit 1;

  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  -- Relation au catalogue 4E-1. Le slug vient du navigateur : il est donc
  -- revérifié contre une offre réellement publiée, et ignoré sinon. Aucune
  -- prestation n'est dupliquée dans cette table.
  if p_service_slug is not null and btrim(p_service_slug) <> '' then
    select s.id into v_service
      from public.services s
     where s.slug = btrim(p_service_slug)
       and s.status = 'PUBLIE';
  end if;

  select a.reference, a.series, a.number
    into v_reference, v_series, v_number
    from public.allocate_document_number('DMCL') a;

  insert into public.quote_requests (
    reference, lead_id, user_id, service_id, offer_title,
    subject, budget_label, message, organisation, details, source
  )
  values (
    v_reference, v_lead.id, auth.uid(), v_service,
    nullif(left(btrim(coalesce(p_offer_title, '')), 200), ''),
    left(v_subject, 160),
    nullif(left(btrim(coalesce(p_budget, '')), 80), ''),
    left(v_message, 4000),
    nullif(left(btrim(coalesce(p_organisation, '')), 160), ''),
    case when jsonb_typeof(coalesce(p_details, '[]'::jsonb)) = 'array'
         then p_details else '[]'::jsonb end,
    nullif(left(btrim(coalesce(p_source, '')), 60), '')
  );

  return query select v_reference, false;
end;
$$;

comment on function public.submit_quote_request(text, text, text, text, text, text, text, text, text, jsonb, text, text) is
  'Seule porte publique de création d''une demande. user_id vient de auth.uid(), jamais d''un paramètre. Dédoublonne sur dix minutes (§ 99).';

revoke execute on function public.submit_quote_request(text, text, text, text, text, text, text, text, text, jsonb, text, text)
  from public;
grant  execute on function public.submit_quote_request(text, text, text, text, text, text, text, text, text, jsonb, text, text)
  to anon, authenticated, service_role;


create or replace function public.submit_appointment_request(
  p_full_name      text,
  p_email          text,
  p_phone          text default null,
  p_organisation   text default null,
  p_subject        text default null,
  p_channel_label  text default null,
  p_requested_date date default null,
  p_requested_slot text default null,
  p_budget         text default null,
  p_message        text default null,
  p_service_slug   text default null,
  p_details        jsonb default '[]'::jsonb,
  p_source         text default null,
  p_client_hash    text default null
)
returns table (created boolean, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead     public.leads%rowtype;
  v_service  uuid;
  v_channel  text;
  v_label    text := btrim(coalesce(p_channel_label, ''));
  v_subject  text := btrim(coalesce(p_subject, ''));
  v_existing uuid;
begin
  if not public.relation_rate_limit_ok('relation.rendez_vous', p_client_hash, 5, 600) then
    raise exception 'Trop de demandes envoyées depuis cette connexion.'
      using errcode = '54000';
  end if;

  if v_subject = '' then
    raise exception 'Sujet requis.' using errcode = 'check_violation';
  end if;

  -- § 35-39. Le libellé exact du formulaire est conservé à côté du code : si
  -- une option est reformulée demain, l'enregistrement ne casse pas — il
  -- tombe en AUTRE, ce qui se voit, plutôt que d'échouer.
  v_channel := case
    when v_label ilike '%place%'                                 then 'SUR_PLACE'
    when v_label ilike '%phon%' or v_label ilike '%appel%'        then 'TELEPHONE'
    when v_label ilike '%visio%'                                 then 'VISIOCONFERENCE'
    when v_label ilike '%whatsapp%'                              then 'WHATSAPP'
    else 'AUTRE'
  end;

  v_lead := public.relation_upsert_lead(p_email, p_full_name, p_phone);

  select ap.id into v_existing
    from public.appointments ap
   where ap.lead_id = v_lead.id
     and ap.subject = left(v_subject, 160)
     and ap.requested_date is not distinct from p_requested_date
     and ap.created_at > now() - interval '10 minutes'
   order by ap.created_at desc
   limit 1;

  if v_existing is not null then
    return query select false, true;
    return;
  end if;

  if p_service_slug is not null and btrim(p_service_slug) <> '' then
    select s.id into v_service
      from public.services s
     where s.slug = btrim(p_service_slug)
       and s.status = 'PUBLIE';
  end if;

  -- Aucune référence : § 43 la réserve au rendez-vous **confirmé**. Un souhait
  -- ne consomme pas de numéro.
  insert into public.appointments (
    lead_id, user_id, service_id, subject, channel, channel_label,
    requested_date, requested_slot, budget_label, message, details, source
  )
  values (
    v_lead.id, auth.uid(), v_service,
    left(v_subject, 160), v_channel, nullif(left(v_label, 80), ''),
    p_requested_date,
    nullif(left(btrim(coalesce(p_requested_slot, '')), 80), ''),
    nullif(left(btrim(coalesce(p_budget, '')), 80), ''),
    nullif(left(btrim(coalesce(p_message, '')), 4000), ''),
    case when jsonb_typeof(coalesce(p_details, '[]'::jsonb)) = 'array'
         then p_details else '[]'::jsonb end,
    nullif(left(btrim(coalesce(p_source, '')), 60), '')
  );

  return query select true, false;
end;
$$;

comment on function public.submit_appointment_request(text, text, text, text, text, text, date, text, text, text, text, jsonb, text, text) is
  'Seule porte publique de création d''un rendez-vous. Enregistre un souhait au statut EN_ATTENTE, sans référence : le § 43 la réserve à la confirmation.';

revoke execute on function public.submit_appointment_request(text, text, text, text, text, text, date, text, text, text, text, jsonb, text, text)
  from public;
grant  execute on function public.submit_appointment_request(text, text, text, text, text, text, date, text, text, text, text, jsonb, text, text)
  to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 18. LES DEUX ACTES QUI CONSOMMENT UN NUMÉRO
--
-- Confirmer un rendez-vous et émettre un devis ont ceci de commun qu'ils
-- attribuent une référence. Or une référence ne se fabrique pas : elle
-- s'alloue, sous verrou, par l'allocateur de la phase 4D.
--
-- Ces deux actes passent donc par une fonction, et **ne peuvent pas** passer
-- ailleurs : le privilège de colonne retire `reference` aux sessions, et les
-- contraintes `appointments_confirmed_shape` et `quotes_issued_coherent`
-- exigent cette référence. Une session qui tenterait la mise à jour directe se
-- heurte à la contrainte, pas à la bonne volonté du code applicatif.
--
-- ## Pourquoi la permission est revérifiée ici, et non déléguée au garde
--
-- Ces deux fonctions sont `SECURITY DEFINER` : à l'intérieur, `current_user`
-- vaut leur propriétaire. Les gardes de transition qu'elles déclenchent
-- interrogent `is_privileged_db_role()`, qui répond donc « privilégié » — et
-- laisse passer. C'est, au détail près, le défaut corrigé en 4E-1 : un garde
-- qui a l'air de contrôler et ne contrôle rien.
--
-- La permission est donc vérifiée **ici**, avec `has_permission()`, qui lit
-- `auth.uid()` et non `current_user` : le jeton de la session traverse la
-- frontière `DEFINER` intact, contrairement au rôle de base de données.
-- -----------------------------------------------------------------------------

create or replace function public.confirm_appointment(
  p_appointment_id uuid,
  p_scheduled_at   timestamptz,
  p_scheduled_end  timestamptz
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_current   public.appointments%rowtype;
  v_reference text;
  v_result    public.appointments%rowtype;
begin
  if p_scheduled_at is null or p_scheduled_end is null then
    raise exception 'Un rendez-vous confirmé exige un créneau complet.'
      using errcode = 'check_violation';
  end if;

  -- Session applicative : la permission et le second facteur, ici et pas
  -- ailleurs (voir l'en-tête du § 18). Un appel serveur à clé de service a
  -- `auth.uid()` nul : le contrôle a eu lieu en amont, dans l'action.
  if auth.uid() is not null then
    if not public.has_permission('appointments.update') then
      raise exception 'Confirmation refusée : permission appointments.update requise.'
        using errcode = '42501';
    end if;

    if not public.session_is_aal2() then
      raise exception 'Confirmation refusée : second facteur non vérifié.'
        using errcode = '42501';
    end if;
  end if;

  select * into v_current from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Rendez-vous introuvable.' using errcode = 'no_data_found';
  end if;

  if v_current.reference is null then
    select a.reference into v_reference
      from public.allocate_document_number('RVCL') a;
  else
    v_reference := v_current.reference;
  end if;

  update public.appointments
     set reference     = v_reference,
         scheduled_at  = p_scheduled_at,
         scheduled_end = p_scheduled_end,
         status        = 'CONFIRME'
   where id = p_appointment_id
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.confirm_appointment(uuid, timestamptz, timestamptz) is
  'Confirme un rendez-vous : alloue sa référence (§ 43) et fixe le créneau ferme. La contrainte d''exclusion refuse tout chevauchement (§ 31).';

revoke execute on function public.confirm_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.confirm_appointment(uuid, timestamptz, timestamptz) to authenticated, service_role;


create or replace function public.send_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote    public.quotes%rowtype;
  v_request  public.quote_requests%rowtype;
  v_lead     public.leads%rowtype;
  v_document public.documents%rowtype;
  v_result   public.quotes%rowtype;
begin
  -- Voir l'en-tête du § 18 : le garde de transition ne refusera rien depuis
  -- l'intérieur d'une fonction DEFINER. `quotes.manage` se vérifie donc ici.
  -- `issue_document` exigera en outre `quotes.create` et le second facteur.
  if auth.uid() is not null and not public.has_permission('quotes.manage') then
    raise exception 'Émission refusée : permission quotes.manage requise.'
      using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  if v_quote.status <> 'BROUILLON' then
    raise exception 'Ce devis a déjà été émis (%).', v_quote.status
      using errcode = 'check_violation';
  end if;

  select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  select * into v_lead    from public.leads          where id = v_request.lead_id;

  -- Le plan de la phase 4F : « émission d'un devis via le Moteur de Documents ».
  -- C'est bien lui qui alloue le numéro et crée la pièce — un seul allocateur,
  -- une seule suite. `issue_document` exige au passage `quotes.create` et un
  -- second facteur vérifié, comme toute émission depuis la phase 4D.
  --
  -- Les métadonnées restent maigres : ni adresse, ni téléphone, ni message.
  v_document := public.issue_document(
    'DVCL',
    'quote',
    v_quote.id,
    v_request.user_id,
    v_lead.full_name,
    jsonb_build_object(
      'demande', v_request.reference,
      'montant', v_quote.amount,
      'devise',  v_quote.currency
    )
  );

  update public.quotes
     set reference   = v_document.reference,
         document_id = v_document.id,
         sent_at     = now(),
         status      = 'ENVOYE'
   where id = p_quote_id
  returning * into v_result;

  -- La demande suit, si son état le permet. Le garde de transition valide.
  if v_request.status = 'EN_ETUDE' then
    update public.quote_requests
       set status = 'DEVIS_ENVOYE'
     where id = v_request.id;
  end if;

  return v_result;
end;
$$;

comment on function public.send_quote(uuid) is
  'Émet un devis via le Moteur de Documents 4D : une seule suite de numéros, une pièce DVCL, puis la demande passe à « Devis envoyé ».';

revoke execute on function public.send_quote(uuid) from public, anon;
grant  execute on function public.send_quote(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 19. PRIVILÈGES DE TABLE
--
-- Supabase accorde d'office aux rôles applicatifs tous les privilèges sur les
-- nouvelles tables de `public`. On les retire donc, puis on rend exactement ce
-- qui est nécessaire — et pas une colonne de plus.
--
-- Le privilège de **colonne** fait ici un travail que RLS ne sait pas faire :
-- retirer `reference` de la liste rend l'attribution d'un numéro impossible
-- autrement que par les fonctions du § 18. Combiné aux contraintes, c'est ce
-- qui ferme réellement la porte, plutôt que de compter sur l'application.
--
-- `anon` ne reçoit rien du tout. Pas de lecture — ces tables portent des noms,
-- des adresses et des messages (point 17). Pas d'écriture — les deux fonctions
-- du § 17 sont sa seule porte.
-- -----------------------------------------------------------------------------

revoke all on public.leads                      from anon, authenticated;
revoke all on public.quote_requests             from anon, authenticated;
revoke all on public.quotes                     from anon, authenticated;
revoke all on public.quote_request_events       from anon, authenticated;
revoke all on public.appointments               from anon, authenticated;
revoke all on public.appointment_events         from anon, authenticated;
revoke all on public.appointment_availabilities from anon, authenticated;
revoke all on public.relation_notes             from anon, authenticated;

grant select on public.leads                to authenticated;
grant select on public.quote_request_events to authenticated;
grant select on public.appointment_events   to authenticated;

-- La demande : tout est modifiable sauf ce qui l'identifie et ce qui la relie.
grant select on public.quote_requests to authenticated;
grant update (service_id, offer_title, subject, budget_label, organisation,
              details, status, source, assigned_to, closed_at)
  on public.quote_requests to authenticated;

-- Le devis : un brouillon se crée et se corrige ; `reference`, `document_id`
-- et `sent_at` restent hors de portée, donc l'émission passe par send_quote.
grant select on public.quotes to authenticated;
-- `status` figure à l'insertion, et la politique `quotes_insert_admin` le
-- contraint à `BROUILLON`. L'omettre ferait échouer toute création qui le
-- nomme explicitement — et le nommer est la façon honnête d'écrire un
-- formulaire qui crée toujours un brouillon.
grant insert (quote_request_id, service_id, amount, currency, summary, valid_until, status)
  on public.quotes to authenticated;
grant update (service_id, amount, currency, summary, valid_until, status, responded_at)
  on public.quotes to authenticated;

-- Le rendez-vous : `reference` exclue, donc la confirmation passe par
-- confirm_appointment. Annuler, reprogrammer et terminer restent de simples
-- mises à jour, que les gardes du § 12 et du § 16 encadrent.
grant select on public.appointments to authenticated;
grant update (quote_request_id, service_id, subject, channel, channel_label,
              requested_date, requested_slot, scheduled_at, scheduled_end,
              timezone, budget_label, message, details, status, cancel_reason,
              source, assigned_to, cancelled_at, completed_at)
  on public.appointments to authenticated;

grant select, insert, update, delete on public.appointment_availabilities to authenticated;
grant select, insert, update, delete on public.relation_notes             to authenticated;

-- `message` d'une demande n'est jamais modifiable : le plan exige qu'il soit
-- « conservé intégralement ». Il n'apparaît dans aucune liste ci-dessus.


-- -----------------------------------------------------------------------------
-- 20. ROW LEVEL SECURITY
--
-- Dernière barrière, et non première. Les politiques disent trois choses :
--
--   * `anon` n'a aucune politique. Une table sans politique applicable ne
--     renvoie rien : c'est l'absence de politique SELECT publique que le
--     point 17 du cadrage exige, pas une politique qui filtre ;
--   * un CLIENT ne voit que ce qui porte son `user_id`. C'est le test
--     « CLIENT A contre CLIENT B », et il ne repose sur aucun filtre
--     applicatif ;
--   * un AFFILIE n'a aucune permission de ces familles. Il ne voit donc rien,
--     non par une règle qui le nomme, mais parce qu'être affilié ne donne
--     accès à rien ici (point 15 du cadrage).
-- -----------------------------------------------------------------------------

alter table public.leads                      enable row level security;
alter table public.quote_requests             enable row level security;
alter table public.quotes                     enable row level security;
alter table public.quote_request_events       enable row level security;
alter table public.appointments               enable row level security;
alter table public.appointment_events         enable row level security;
alter table public.appointment_availabilities enable row level security;
alter table public.relation_notes             enable row level security;

/* --------------------------------- leads ---------------------------------- */

-- Le fichier des prospects est administratif, et seulement administratif. Un
-- CLIENT n'y lit même pas sa propre fiche : elle n'apporterait rien de plus
-- que son profil, et l'ouvrir créerait un chemin de lecture à surveiller.
drop policy if exists leads_select_admin on public.leads;
create policy leads_select_admin
  on public.leads for select to authenticated
  using (public.can_view_prospects());

/* ----------------------------- quote_requests ----------------------------- */

drop policy if exists quote_requests_select_own on public.quote_requests;
create policy quote_requests_select_own
  on public.quote_requests for select to authenticated
  using (user_id is not null and user_id = auth.uid());

drop policy if exists quote_requests_select_admin on public.quote_requests;
create policy quote_requests_select_admin
  on public.quote_requests for select to authenticated
  using (public.can_view_demandes());

drop policy if exists quote_requests_update_admin on public.quote_requests;
create policy quote_requests_update_admin
  on public.quote_requests for update to authenticated
  using (public.has_permission('quotes.update') or public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.update') or public.has_permission('quotes.manage'));

-- Aucune politique INSERT ni DELETE. La création passe par submit_quote_request ;
-- la suppression relève d'une règle de conservation, et la seule qui soit
-- publiée — « douze mois après le dernier échange » — n'a pas encore de
-- mécanisme. On ne l'improvise pas : `quotes.delete` reste sans effet sur cette
-- table, et le dire ici vaut mieux que d'ouvrir une porte à moitié.

/* --------------------------------- quotes --------------------------------- */

drop policy if exists quotes_select_own on public.quotes;
create policy quotes_select_own
  on public.quotes for select to authenticated
  using (
    -- § 27 de l'espace client : le client voit son devis lorsqu'il existe
    -- réellement. Un brouillon n'existe pas encore pour lui.
    status <> 'BROUILLON'
    and exists (
      select 1 from public.quote_requests qr
       where qr.id = quotes.quote_request_id
         and qr.user_id is not null
         and qr.user_id = auth.uid()
    )
  );

drop policy if exists quotes_select_admin on public.quotes;
create policy quotes_select_admin
  on public.quotes for select to authenticated
  using (public.can_view_demandes());

drop policy if exists quotes_insert_admin on public.quotes;
create policy quotes_insert_admin
  on public.quotes for insert to authenticated
  with check (public.has_permission('quotes.create') and status = 'BROUILLON');

drop policy if exists quotes_update_admin on public.quotes;
create policy quotes_update_admin
  on public.quotes for update to authenticated
  using (public.has_permission('quotes.update') or public.has_permission('quotes.manage'))
  with check (public.has_permission('quotes.update') or public.has_permission('quotes.manage'));

-- § 133 : « un devis refusé doit rester identifiable ». Il ne se supprime donc
-- pas, il s'annule. Aucune politique DELETE.

/* ------------------------------ appointments ------------------------------ */

drop policy if exists appointments_select_own on public.appointments;
create policy appointments_select_own
  on public.appointments for select to authenticated
  using (user_id is not null and user_id = auth.uid());

drop policy if exists appointments_select_admin on public.appointments;
create policy appointments_select_admin
  on public.appointments for select to authenticated
  using (public.can_view_rendez_vous());

drop policy if exists appointments_update_admin on public.appointments;
create policy appointments_update_admin
  on public.appointments for update to authenticated
  using (
    public.has_permission('appointments.update')
    or public.has_permission('appointments.cancel')
  )
  with check (
    public.has_permission('appointments.update')
    or public.has_permission('appointments.cancel')
  );

/* --------------------------------- events --------------------------------- */

-- En ajout seul, et écrits par les déclencheurs : aucune politique d'écriture,
-- aucun privilège d'insertion. C'est la même discipline que le journal d'audit.

drop policy if exists qr_events_select_own on public.quote_request_events;
create policy qr_events_select_own
  on public.quote_request_events for select to authenticated
  using (
    exists (
      select 1 from public.quote_requests qr
       where qr.id = quote_request_events.quote_request_id
         and qr.user_id is not null
         and qr.user_id = auth.uid()
    )
  );

drop policy if exists qr_events_select_admin on public.quote_request_events;
create policy qr_events_select_admin
  on public.quote_request_events for select to authenticated
  using (public.can_view_demandes());

drop policy if exists ap_events_select_own on public.appointment_events;
create policy ap_events_select_own
  on public.appointment_events for select to authenticated
  using (
    exists (
      select 1 from public.appointments ap
       where ap.id = appointment_events.appointment_id
         and ap.user_id is not null
         and ap.user_id = auth.uid()
    )
  );

drop policy if exists ap_events_select_admin on public.appointment_events;
create policy ap_events_select_admin
  on public.appointment_events for select to authenticated
  using (public.can_view_rendez_vous());

/* ----------------------------- disponibilités ----------------------------- */

-- Aucune politique publique : la décision A3 ne branche pas de sélecteur de
-- créneaux sur le site. Le jour où il le sera, une politique de lecture
-- anonyme sur les seules ouvertures actives suffira — elle ne contient aucune
-- donnée personnelle. Elle n'est pas écrite aujourd'hui, parce qu'une
-- politique sans usage est une surface sans surveillance.

drop policy if exists availabilities_select_admin on public.appointment_availabilities;
create policy availabilities_select_admin
  on public.appointment_availabilities for select to authenticated
  using (public.can_view_rendez_vous());

drop policy if exists availabilities_write_admin on public.appointment_availabilities;
create policy availabilities_write_admin
  on public.appointment_availabilities for insert to authenticated
  with check (public.has_permission('appointments.manage'));

drop policy if exists availabilities_update_admin on public.appointment_availabilities;
create policy availabilities_update_admin
  on public.appointment_availabilities for update to authenticated
  using (public.has_permission('appointments.manage'))
  with check (public.has_permission('appointments.manage'));

drop policy if exists availabilities_delete_admin on public.appointment_availabilities;
create policy availabilities_delete_admin
  on public.appointment_availabilities for delete to authenticated
  using (public.has_permission('appointments.manage'));

/* ------------------------------ notes internes ---------------------------- */

-- Jamais de politique pour le demandeur. Une note interne est interne.

drop policy if exists relation_notes_select_admin on public.relation_notes;
create policy relation_notes_select_admin
  on public.relation_notes for select to authenticated
  using (
    (quote_request_id is not null and public.can_view_demandes())
    or (appointment_id is not null and public.can_view_rendez_vous())
  );

drop policy if exists relation_notes_insert_admin on public.relation_notes;
create policy relation_notes_insert_admin
  on public.relation_notes for insert to authenticated
  with check (
    (quote_request_id is not null and public.has_permission('quotes.update'))
    or (appointment_id is not null and public.has_permission('appointments.update'))
  );

drop policy if exists relation_notes_update_admin on public.relation_notes;
create policy relation_notes_update_admin
  on public.relation_notes for update to authenticated
  using (
    author_id = auth.uid()
    and (
      (quote_request_id is not null and public.has_permission('quotes.update'))
      or (appointment_id is not null and public.has_permission('appointments.update'))
    )
  )
  with check (
    author_id = auth.uid()
    and (
      (quote_request_id is not null and public.has_permission('quotes.update'))
      or (appointment_id is not null and public.has_permission('appointments.update'))
    )
  );

drop policy if exists relation_notes_delete_admin on public.relation_notes;
create policy relation_notes_delete_admin
  on public.relation_notes for delete to authenticated
  using (
    -- Sa propre note, ou celle d'un autre si l'on porte la permission
    -- sensible du domaine. Un administrateur ne réécrit pas l'historique
    -- d'un collègue par simple droit de modification.
    (author_id = auth.uid() and (
       (quote_request_id is not null and public.has_permission('quotes.update'))
       or (appointment_id is not null and public.has_permission('appointments.update'))
    ))
    or (quote_request_id is not null and public.has_permission('quotes.delete'))
  );
