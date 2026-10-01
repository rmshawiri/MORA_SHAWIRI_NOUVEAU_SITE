-- =============================================================================
-- PHASE 4H-4 — AFFILIATION : CLICS, ATTRIBUTION, PROSPECTS, CODES APPLIQUÉS
--
-- Ce que cette migration pose :
--
--   1. les clics, enregistrés par le serveur seul ;
--   2. les attributions — lien, code, prospect, administration — avec une
--      seule attribution courante par demande et par commande ;
--   3. le report automatique de l'attribution de la demande vers la
--      commande, et la reconnaissance d'un prospect protégé ;
--   4. l'application d'un code de réduction à une commande (N4, I) ;
--   5. les prospects déclarés par les affiliés (F) ;
--   6. les conversions et statistiques vues par l'affilié, sans donnée
--      personnelle de client.
--
-- ## Règle d'attribution du propriétaire (B + C)
--
--   attribution VALIDÉE par l'administration (verrouillée)
--   > code partenaire valide
--   > dernier clic valide dans la fenêtre d'attribution.
--
-- Une attribution validée n'est jamais déplacée automatiquement. Un code
-- remplace une attribution par lien ou par prospect qui n'a pas été validée.
-- Chaque changement est historisé, avec son auteur et son motif.
--
-- ## Auto-affiliation (D + E)
--
-- Interdite par défaut : ni lien, ni code, ni prospect ne peuvent rattacher
-- à un affilié une affaire de son propre compte ou de sa propre adresse,
-- sauf levée individuelle (`affiliates.self_referral_allowed`, 4H-1).
--
-- ## Ce que cette migration ne fait pas
--
-- Aucune commission : elles naissent au lot 4H-5, à partir des attributions
-- posées ici. Aucune fonction de 4F ou de 4G n'est réécrite : le report vers
-- la commande passe par un déclencheur ajouté sur `orders`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. AIDES
-- -----------------------------------------------------------------------------

-- Téléphone comparable : chiffres seuls, sans l'indicatif des Comores.
create or replace function public.affiliation_phone_key(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(
    case
      when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) > 7
       and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') like '269%'
      then substr(regexp_replace(p_phone, '\D', '', 'g'), 4)
      else regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    end, '');
$$;

-- Une affaire du propre compte, ou de la propre adresse, de l'affilié ?
create or replace function public.affiliate_is_self_referral(p_affiliate_id uuid, p_user_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.affiliates a
     where a.id = p_affiliate_id
       and not a.self_referral_allowed
       and ((p_user_id is not null and a.user_id = p_user_id)
            or (p_email is not null and lower(a.contact_email) = lower(btrim(p_email))))
  );
$$;

revoke execute on function public.affiliate_is_self_referral(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.affiliate_is_self_referral(uuid, uuid, text) to service_role;


-- -----------------------------------------------------------------------------
-- 2. CLICS
--
-- Aucune adresse IP, aucun agent utilisateur en clair : le serveur ne
-- transmet qu'une empreinte HMAC journalière, impossible à inverser, qui sert
-- seulement à ne pas compter deux fois le même visiteur. Le jeton remis au
-- navigateur est un identifiant aléatoire, sans rien de personnel.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_clicks (
  id             uuid primary key default gen_random_uuid(),
  token          uuid not null unique default gen_random_uuid(),
  affiliate_id   uuid not null references public.affiliates (id) on delete cascade,
  campaign_id    uuid references public.affiliate_campaigns (id) on delete set null,
  landing_path   text,
  visitor_hash   text,
  window_days    integer not null,
  created_at     timestamptz not null default now(),
  constraint affiliate_clicks_landing check (landing_path is null or (landing_path ~ '^/' and length(landing_path) <= 200)),
  constraint affiliate_clicks_hash check (visitor_hash is null or visitor_hash ~ '^[0-9a-f]{64}$'),
  constraint affiliate_clicks_window check (window_days between 1 and 3650)
);

comment on table public.affiliate_clicks is
  'Clics sur les liens d''affiliation. Aucune donnée personnelle : une empreinte journalière non réversible, un jeton aléatoire, la page d''arrivée.';

create index if not exists affiliate_clicks_affiliate_idx on public.affiliate_clicks (affiliate_id, created_at desc);
create index if not exists affiliate_clicks_dedupe_idx on public.affiliate_clicks (affiliate_id, visitor_hash, created_at desc);

-- Enregistre un clic et rend le jeton à poser dans le cookie. Un même
-- visiteur sur le même lien dans la demi-heure n'est compté qu'une fois : le
-- jeton existant est rendu. Rien n'est rendu pour un affilié non actif ou
-- une campagne désactivée : le lien ne pose alors aucun cookie.
create or replace function public.record_affiliate_click(
  p_slug         text,
  p_campaign     text,
  p_landing      text,
  p_visitor_hash text
)
returns table (token uuid, window_days integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff      public.affiliates%rowtype;
  v_campaign uuid;
  v_window   integer;
  v_token    uuid;
begin
  select * into v_aff from public.affiliates where slug = lower(btrim(coalesce(p_slug, '')));
  if not found or v_aff.status <> 'ACTIF' then
    return;
  end if;
  if p_campaign is not null and btrim(p_campaign) <> '' then
    select id into v_campaign from public.affiliate_campaigns
     where affiliate_id = v_aff.id and code = lower(btrim(p_campaign)) and is_active;
    if v_campaign is null then
      return;
    end if;
  end if;

  select t.attribution_window_days into v_window from public.affiliate_effective_terms(v_aff.id) t;

  if p_visitor_hash is not null then
    select c.token into v_token from public.affiliate_clicks c
     where c.affiliate_id = v_aff.id
       and c.visitor_hash = p_visitor_hash
       and c.campaign_id is not distinct from v_campaign
       and c.created_at > now() - interval '30 minutes'
     order by c.created_at desc
     limit 1;
    if v_token is not null then
      return query select v_token, v_window;
      return;
    end if;
  end if;

  insert into public.affiliate_clicks (affiliate_id, campaign_id, landing_path, visitor_hash, window_days)
  values (
    v_aff.id, v_campaign,
    case when p_landing ~ '^/' then left(split_part(p_landing, '?', 1), 200) end,
    case when p_visitor_hash ~ '^[0-9a-f]{64}$' then p_visitor_hash end,
    v_window
  )
  returning affiliate_clicks.token into v_token;

  return query select v_token, v_window;
end;
$fn$;

revoke execute on function public.record_affiliate_click(text, text, text, text) from public, anon, authenticated;
grant  execute on function public.record_affiliate_click(text, text, text, text) to service_role;


-- -----------------------------------------------------------------------------
-- 3. PROSPECTS DÉCLARÉS
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_prospects (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates (id) on delete restrict,
  status           text not null default 'DECLARE',
  full_name        text not null,
  company          text,
  phone            text not null,
  email            text,
  need             text not null,
  comment          text,
  consent_confirmed boolean not null,
  phone_key        text generated always as (public.affiliation_phone_key(phone)) stored,
  lead_id          uuid references public.leads (id) on delete set null,
  -- Réservé à l'administration : jamais accordé à l'affilié.
  review_hint      text,
  review_reason    text,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  recognized_at    timestamptz,
  protected_until  timestamptz,
  converted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint affiliate_prospects_status check (
    status in ('DECLARE', 'A_VERIFIER', 'RECONNU', 'CONVERTI', 'REFUSE', 'ANNULE')
  ),
  constraint affiliate_prospects_name check (btrim(full_name) <> '' and length(full_name) <= 120),
  constraint affiliate_prospects_company check (company is null or length(company) <= 160),
  constraint affiliate_prospects_phone check (length(regexp_replace(phone, '\D', '', 'g')) >= 6 and length(phone) <= 40),
  constraint affiliate_prospects_email check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and length(email) <= 160)),
  constraint affiliate_prospects_need check (btrim(need) <> '' and length(need) <= 1000),
  constraint affiliate_prospects_comment check (comment is null or length(comment) <= 1000),
  -- La convention (article 2) : l'apporteur obtient l'accord du prospect avant de transmettre.
  constraint affiliate_prospects_consent check (consent_confirmed),
  constraint affiliate_prospects_reason check (status <> 'REFUSE' or (review_reason is not null and btrim(review_reason) <> '')),
  constraint affiliate_prospects_recognized check (status not in ('RECONNU', 'CONVERTI') or (lead_id is not null and recognized_at is not null))
);

comment on table public.affiliate_prospects is
  'Prospects déclarés par les affiliés. L''origine est reconnue par MORA Shawiri, jamais par l''affilié. review_hint n''est jamais accordé à l''affilié.';

create index if not exists affiliate_prospects_affiliate_idx on public.affiliate_prospects (affiliate_id, created_at desc);
create index if not exists affiliate_prospects_lead_idx on public.affiliate_prospects (lead_id) where lead_id is not null;
create index if not exists affiliate_prospects_phone_idx on public.affiliate_prospects (phone_key);
-- Un même prospect n'est reconnu qu'une fois, pour un seul affilié.
create unique index if not exists affiliate_prospects_one_recognized
  on public.affiliate_prospects (lead_id) where status in ('RECONNU', 'CONVERTI');

drop trigger if exists affiliate_prospects_set_updated_at on public.affiliate_prospects;
create trigger affiliate_prospects_set_updated_at
  before update on public.affiliate_prospects
  for each row execute function public.set_updated_at();

create or replace function public.affiliate_prospect_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('DECLARE',    'A_VERIFIER'),
    ('DECLARE',    'RECONNU'),
    ('DECLARE',    'REFUSE'),
    ('DECLARE',    'ANNULE'),
    ('A_VERIFIER', 'RECONNU'),
    ('A_VERIFIER', 'REFUSE'),
    ('A_VERIFIER', 'ANNULE'),
    ('RECONNU',    'CONVERTI')
  );
$$;

create or replace function public.tg_affiliate_prospects_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un prospect déclaré ne se supprime pas : il s''annule ou se refuse.' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not public.affiliate_prospect_transition_ok(old.status, new.status) then
    raise exception 'Transition de prospect interdite : % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  if (new.affiliate_id, new.full_name, new.company, new.phone, new.email, new.need, new.comment, new.created_at)
     is distinct from
     (old.affiliate_id, old.full_name, old.company, old.phone, old.email, old.need, old.comment, old.created_at) then
    raise exception 'Une déclaration de prospect ne se réécrit pas.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_prospects_guard on public.affiliate_prospects;
create trigger affiliate_prospects_guard
  before update or delete on public.affiliate_prospects
  for each row execute function public.tg_affiliate_prospects_guard();


-- Déclaration par l'affilié lui-même. Les rapprochements sont calculés pour
-- l'administration, jamais montrés à l'affilié : lui apprendre qu'une
-- personne est déjà cliente serait une fuite.
create or replace function public.declare_affiliate_prospect(
  p_full_name text,
  p_company   text,
  p_phone     text,
  p_email     text,
  p_need      text,
  p_comment   text,
  p_consent   boolean
)
returns public.affiliate_prospects
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff   public.affiliates%rowtype;
  v_row   public.affiliate_prospects%rowtype;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_key   text := public.affiliation_phone_key(p_phone);
  v_hints text[] := array[]::text[];
begin
  select * into v_aff from public.affiliates where user_id = auth.uid();
  if not found or v_aff.status <> 'ACTIF' then
    raise exception 'Seul un affilié actif déclare un prospect.' using errcode = '42501';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'L''accord du prospect est requis.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.affiliate_prospects where affiliate_id = v_aff.id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Trop de déclarations aujourd''hui.' using errcode = '54000';
  end if;

  -- Son propre doublon ouvert : refusé, on ne déclare pas deux fois.
  if exists (
    select 1 from public.affiliate_prospects p
     where p.affiliate_id = v_aff.id and p.status in ('DECLARE', 'A_VERIFIER', 'RECONNU')
       and (p.phone_key = v_key or (v_email is not null and lower(p.email) = v_email))
  ) then
    raise exception 'Vous avez déjà déclaré ce prospect.' using errcode = 'check_violation';
  end if;

  -- Auto-affiliation : on ne se déclare pas soi-même.
  if (v_email is not null and lower(v_aff.contact_email) = v_email
      or v_key = public.affiliation_phone_key(v_aff.contact_phone))
     and not v_aff.self_referral_allowed then
    raise exception 'Vous ne pouvez pas vous déclarer comme prospect.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.affiliate_prospects p
              where p.affiliate_id <> v_aff.id and p.status in ('DECLARE', 'A_VERIFIER', 'RECONNU', 'CONVERTI')
                and (p.phone_key = v_key or (v_email is not null and lower(p.email) = v_email))) then
    v_hints := array_append(v_hints, 'Déjà déclaré par un autre affilié.'::text);
  end if;
  if v_email is not null and exists (select 1 from public.leads l where l.email = v_email) then
    v_hints := array_append(v_hints, 'Adresse déjà connue de MORA Shawiri (fiche prospect existante).'::text);
  end if;
  if v_key is not null and exists (select 1 from public.leads l where public.affiliation_phone_key(l.phone) = v_key) then
    v_hints := array_append(v_hints, 'Téléphone déjà connu de MORA Shawiri.'::text);
  end if;

  insert into public.affiliate_prospects
    (affiliate_id, full_name, company, phone, email, need, comment, consent_confirmed, review_hint)
  values
    (v_aff.id, left(btrim(p_full_name), 120), nullif(left(btrim(coalesce(p_company, '')), 160), ''),
     left(btrim(p_phone), 40), v_email, left(btrim(p_need), 1000),
     nullif(left(btrim(coalesce(p_comment, '')), 1000), ''), true,
     nullif(array_to_string(v_hints, ' '), ''))
  returning * into v_row;

  perform public.affiliation_log(v_aff.id, null, 'PROSPECT_DECLARE',
    format('Prospect déclaré : %s', v_row.full_name), null, jsonb_build_object('prospect', v_row.id));
  return v_row;
end;
$fn$;

revoke execute on function public.declare_affiliate_prospect(text, text, text, text, text, text, boolean) from public, anon;
grant  execute on function public.declare_affiliate_prospect(text, text, text, text, text, text, boolean) to authenticated, service_role;

create or replace function public.cancel_affiliate_prospect(p_prospect_id uuid)
returns public.affiliate_prospects
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_prospects%rowtype;
begin
  select p.* into v_row from public.affiliate_prospects p
    join public.affiliates a on a.id = p.affiliate_id
   where p.id = p_prospect_id and a.user_id = auth.uid()
   for update of p;
  if not found then
    raise exception 'Prospect introuvable.' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('DECLARE', 'A_VERIFIER') then
    raise exception 'Ce prospect ne peut plus être annulé.' using errcode = 'check_violation';
  end if;
  update public.affiliate_prospects set status = 'ANNULE' where id = p_prospect_id returning * into v_row;
  perform public.affiliation_log(v_row.affiliate_id, null, 'PROSPECT_ANNULE',
    format('Déclaration annulée par l''affilié : %s', v_row.full_name), null, null);
  return v_row;
end;
$fn$;

revoke execute on function public.cancel_affiliate_prospect(uuid) from public, anon;
grant  execute on function public.cancel_affiliate_prospect(uuid) to authenticated, service_role;


-- Décision de MORA Shawiri : à vérifier, reconnu, refusé.
-- Reconnaître rattache le prospect à une fiche `leads` (retrouvée ou créée
-- par l'adresse) et ouvre sa protection selon les paramètres de l'affilié.
create or replace function public.review_affiliate_prospect(
  p_prospect_id uuid,
  p_status      text,
  p_reason      text default null,
  p_lead_email  text default null
)
returns public.affiliate_prospects
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row    public.affiliate_prospects%rowtype;
  v_terms  record;
  v_email  text;
  v_lead   uuid;
begin
  if not public.has_permission('affiliate_attributions.manage') then
    raise exception 'Permission affiliate_attributions.manage requise.' using errcode = '42501';
  end if;
  select * into v_row from public.affiliate_prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'Prospect introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_row.affiliate_id) then
    raise exception 'Vous ne pouvez pas reconnaître vos propres prospects.' using errcode = '42501';
  end if;
  if p_status not in ('A_VERIFIER', 'RECONNU', 'REFUSE') then
    raise exception 'Décision inconnue.' using errcode = 'check_violation';
  end if;
  if p_status = 'REFUSE' and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Un refus se motive (par exemple : prospect déjà connu et activement traité).' using errcode = 'check_violation';
  end if;

  if p_status = 'RECONNU' then
    v_email := nullif(lower(btrim(coalesce(p_lead_email, v_row.email, ''))), '');
    if v_email is null then
      raise exception 'Indiquez l''adresse e-mail du prospect pour le rattacher à sa fiche.' using errcode = 'check_violation';
    end if;
    insert into public.leads (email, full_name, phone)
    values (v_email, v_row.full_name, v_row.phone)
    on conflict (email) do update set updated_at = now()
    returning id into v_lead;

    select * into v_terms from public.affiliate_effective_terms(v_row.affiliate_id);
    update public.affiliate_prospects
       set status = 'RECONNU', lead_id = v_lead, recognized_at = now(),
           protected_until = case when v_terms.prospect_protection_mode = 'DUREE'
                                  then now() + make_interval(months => coalesce(v_terms.prospect_protection_months, 6))
                                  else null end,
           review_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_prospect_id
    returning * into v_row;
  else
    update public.affiliate_prospects
       set status = p_status,
           review_reason = nullif(left(btrim(coalesce(p_reason, '')), 1000), ''),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_prospect_id
    returning * into v_row;
  end if;

  perform set_config('mora.reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Décision sur un prospect déclaré'), true);
  perform public.affiliation_log(v_row.affiliate_id, null, 'PROSPECT_' || p_status,
    format('Prospect %s : %s', lower(replace(p_status, '_', ' ')), v_row.full_name), null,
    jsonb_build_object('prospect', v_row.id, 'protection_jusqu_au', v_row.protected_until));
  return v_row;
end;
$fn$;

revoke execute on function public.review_affiliate_prospect(uuid, text, text, text) from public, anon;
grant  execute on function public.review_affiliate_prospect(uuid, text, text, text) to authenticated, service_role;


-- Un prospect reconnu protège-t-il encore l'affilié, à cette date ?
--   * DUREE : jusqu'à `protected_until` ;
--   * PARTENARIAT : tant que l'affilié est actif ;
--   * après la fin du partenariat : pendant la survie paramétrée
--     (`post_end_survival_months`), si le prospect a été reconnu avant la fin.
create or replace function public.affiliate_prospect_protects(p_prospect_id uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_p     public.affiliate_prospects%rowtype;
  v_a     public.affiliates%rowtype;
  v_terms record;
  v_end   timestamptz;
begin
  select * into v_p from public.affiliate_prospects where id = p_prospect_id;
  if not found or v_p.status <> 'RECONNU' then
    return false;
  end if;
  select * into v_a from public.affiliates where id = v_p.affiliate_id;
  select * into v_terms from public.affiliate_effective_terms(v_a.id);

  if v_a.status = 'SUSPENDU' or v_a.status = 'PREPARATION' then
    return false;
  end if;
  if v_a.status = 'TERMINE' then
    v_end := (v_a.ended_on::timestamp at time zone 'Indian/Comoro');
    if v_terms.post_end_survival_months is null or v_p.recognized_at > v_end then
      return false;
    end if;
    if p_at > v_end + make_interval(months => v_terms.post_end_survival_months) then
      return false;
    end if;
  end if;
  if v_terms.prospect_protection_mode = 'DUREE' and v_p.protected_until is not null and p_at > v_p.protected_until then
    return false;
  end if;
  return true;
end;
$fn$;

revoke execute on function public.affiliate_prospect_protects(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.affiliate_prospect_protects(uuid, timestamptz) to service_role;


-- -----------------------------------------------------------------------------
-- 4. ATTRIBUTIONS
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_attributions (
  id               uuid primary key default gen_random_uuid(),
  affiliate_id     uuid not null references public.affiliates (id) on delete restrict,
  source           text not null,
  status           text not null default 'ACTIVE',
  quote_request_id uuid references public.quote_requests (id) on delete restrict,
  order_id         uuid references public.orders (id) on delete restrict,
  lead_id          uuid references public.leads (id) on delete set null,
  click_id         uuid references public.affiliate_clicks (id) on delete set null,
  campaign_id      uuid references public.affiliate_campaigns (id) on delete set null,
  code_id          uuid references public.affiliate_codes (id) on delete restrict,
  prospect_id      uuid references public.affiliate_prospects (id) on delete restrict,
  derived_from_id  uuid references public.affiliate_attributions (id) on delete set null,
  reason           text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  validated_by     uuid references public.profiles (id) on delete set null,
  validated_at     timestamptz,
  ended_by         uuid references public.profiles (id) on delete set null,
  ended_at         timestamptz,
  end_reason       text,

  constraint affiliate_attributions_source check (source in ('LIEN', 'CODE', 'PROSPECT', 'ADMINISTRATION')),
  constraint affiliate_attributions_status check (status in ('ACTIVE', 'VALIDEE', 'REMPLACEE', 'REVOQUEE')),
  constraint affiliate_attributions_target check (num_nonnulls(quote_request_id, order_id) = 1),
  constraint affiliate_attributions_validated check (status <> 'VALIDEE' or validated_at is not null),
  constraint affiliate_attributions_ended check (status not in ('REMPLACEE', 'REVOQUEE') or ended_at is not null),
  constraint affiliate_attributions_admin_reason check (source <> 'ADMINISTRATION' or (reason is not null and btrim(reason) <> '')),
  constraint affiliate_attributions_texts check (
    (reason is null or length(reason) <= 1000) and (end_reason is null or length(end_reason) <= 1000)
  )
);

comment on table public.affiliate_attributions is
  'Qui a apporté une affaire. Une seule attribution courante (ACTIVE ou VALIDEE) par demande et par commande. VALIDEE = verrouillée par l''administration.';

create unique index if not exists affiliate_attributions_one_per_request
  on public.affiliate_attributions (quote_request_id) where status in ('ACTIVE', 'VALIDEE') and quote_request_id is not null;
create unique index if not exists affiliate_attributions_one_per_order
  on public.affiliate_attributions (order_id) where status in ('ACTIVE', 'VALIDEE') and order_id is not null;
create index if not exists affiliate_attributions_affiliate_idx on public.affiliate_attributions (affiliate_id, created_at desc);

-- Une attribution ne se supprime pas et ne change pas de cible ni d'affilié :
-- on la remplace ou on la révoque.
create or replace function public.tg_affiliate_attributions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une attribution ne se supprime pas : elle se révoque.' using errcode = 'check_violation';
  end if;
  if (new.affiliate_id, new.source, new.quote_request_id, new.order_id, new.click_id, new.code_id, new.prospect_id, new.created_at)
     is distinct from
     (old.affiliate_id, old.source, old.quote_request_id, old.order_id, old.click_id, old.code_id, old.prospect_id, old.created_at) then
    raise exception 'Une attribution ne change ni d''affilié ni d''affaire : remplacez-la.' using errcode = 'check_violation';
  end if;
  if not ((old.status = new.status)
       or (old.status = 'ACTIVE' and new.status in ('VALIDEE', 'REMPLACEE', 'REVOQUEE'))
       or (old.status = 'VALIDEE' and new.status = 'REVOQUEE')) then
    raise exception 'Transition d''attribution interdite : % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_attributions_guard on public.affiliate_attributions;
create trigger affiliate_attributions_guard
  before update or delete on public.affiliate_attributions
  for each row execute function public.tg_affiliate_attributions_guard();

create or replace function public.tg_affiliate_attributions_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target text;
begin
  v_target := coalesce(
    (select 'commande ' || reference from public.orders where id = coalesce(new.order_id, old.order_id)),
    (select 'demande ' || reference from public.quote_requests where id = coalesce(new.quote_request_id, old.quote_request_id)),
    'affaire');
  if tg_op = 'INSERT' then
    perform public.affiliation_log(new.affiliate_id, null, 'ATTRIBUTION_' || new.source,
      format('Attribution (%s) : %s', lower(new.source), v_target), null,
      jsonb_build_object('attribution', new.id, 'statut', new.status));
  elsif new.status is distinct from old.status then
    perform public.affiliation_log(new.affiliate_id, null, 'ATTRIBUTION_' || new.status,
      format('Attribution %s : %s', lower(new.status), v_target),
      jsonb_build_object('statut', old.status), jsonb_build_object('statut', new.status, 'motif', new.end_reason));
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_attributions_history on public.affiliate_attributions;
create trigger affiliate_attributions_history
  after insert or update on public.affiliate_attributions
  for each row execute function public.tg_affiliate_attributions_history();


-- Le dernier clic d'une demande : appelé par le serveur juste après
-- l'enregistrement d'une demande, avec le jeton lu dans le cookie.
create or replace function public.attach_click_to_request(p_reference text, p_click_token uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_request public.quote_requests%rowtype;
  v_lead    public.leads%rowtype;
  v_click   public.affiliate_clicks%rowtype;
  v_id      uuid;
begin
  select * into v_request from public.quote_requests where reference = p_reference;
  if not found then
    return null;
  end if;
  select * into v_click from public.affiliate_clicks where token = p_click_token;
  if not found or v_click.created_at + make_interval(days => v_click.window_days) < v_request.created_at then
    return null;
  end if;
  if not exists (select 1 from public.affiliates where id = v_click.affiliate_id and status = 'ACTIF') then
    return null;
  end if;
  select * into v_lead from public.leads where id = v_request.lead_id;
  if public.affiliate_is_self_referral(v_click.affiliate_id, v_request.user_id, v_lead.email) then
    return null;
  end if;

  insert into public.affiliate_attributions
    (affiliate_id, source, quote_request_id, lead_id, click_id, campaign_id)
  values
    (v_click.affiliate_id, 'LIEN', v_request.id, v_request.lead_id, v_click.id, v_click.campaign_id)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke execute on function public.attach_click_to_request(text, uuid) from public, anon, authenticated;
grant  execute on function public.attach_click_to_request(text, uuid) to service_role;


-- À la naissance d'une commande : l'attribution de sa demande la suit ; à
-- défaut, un prospect reconnu et encore protégé l'attribue à son affilié.
create or replace function public.tg_orders_affiliate_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from   public.affiliate_attributions%rowtype;
  v_p      public.affiliate_prospects%rowtype;
  v_email  text;
begin
  if new.quote_request_id is not null then
    select * into v_from from public.affiliate_attributions
     where quote_request_id = new.quote_request_id and status in ('ACTIVE', 'VALIDEE')
     limit 1;
    if found then
      insert into public.affiliate_attributions
        (affiliate_id, source, status, order_id, lead_id, click_id, campaign_id, code_id, prospect_id,
         derived_from_id, reason, created_by, validated_by, validated_at)
      values
        (v_from.affiliate_id, v_from.source, v_from.status, new.id, coalesce(new.lead_id, v_from.lead_id),
         v_from.click_id, v_from.campaign_id, v_from.code_id, v_from.prospect_id, v_from.id, v_from.reason,
         v_from.created_by, v_from.validated_by, v_from.validated_at)
      on conflict do nothing;
      return new;
    end if;
  end if;

  if new.lead_id is not null then
    select p.* into v_p from public.affiliate_prospects p
     where p.lead_id = new.lead_id and p.status = 'RECONNU'
     limit 1;
    if found and public.affiliate_prospect_protects(v_p.id, new.created_at) then
      select email into v_email from public.leads where id = new.lead_id;
      if not public.affiliate_is_self_referral(v_p.affiliate_id, new.user_id, v_email) then
        insert into public.affiliate_attributions (affiliate_id, source, order_id, lead_id, prospect_id)
        values (v_p.affiliate_id, 'PROSPECT', new.id, new.lead_id, v_p.id)
        on conflict do nothing;
        update public.affiliate_prospects set status = 'CONVERTI', converted_at = now() where id = v_p.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_affiliate_attribution on public.orders;
create trigger orders_affiliate_attribution
  after insert on public.orders
  for each row execute function public.tg_orders_affiliate_attribution();


-- Attribution administrative : sur preuve, motivée, aussitôt validée. Elle
-- remplace une attribution automatique ; une attribution validée doit être
-- révoquée d'abord.
create or replace function public.attribute_affair(
  p_target_type  text,
  p_target_id    uuid,
  p_affiliate_id uuid,
  p_reason       text
)
returns public.affiliate_attributions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_current public.affiliate_attributions%rowtype;
  v_new     public.affiliate_attributions%rowtype;
  v_user    uuid;
  v_lead    uuid;
  v_email   text;
begin
  if not public.has_permission('affiliate_attributions.manage') then
    raise exception 'Permission affiliate_attributions.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Une attribution manuelle se justifie.' using errcode = 'check_violation';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas vous attribuer une affaire.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.affiliates where id = p_affiliate_id and status = 'ACTIF') then
    raise exception 'Seul un affilié actif reçoit une attribution.' using errcode = 'check_violation';
  end if;

  if p_target_type = 'ORDER' then
    select o.user_id, o.lead_id, o.customer_email into v_user, v_lead, v_email from public.orders o where o.id = p_target_id;
  elsif p_target_type = 'REQUEST' then
    select r.user_id, r.lead_id, l.email into v_user, v_lead, v_email
      from public.quote_requests r join public.leads l on l.id = r.lead_id where r.id = p_target_id;
  else
    raise exception 'Cible inconnue.' using errcode = 'check_violation';
  end if;
  if v_lead is null and v_email is null and v_user is null then
    raise exception 'Affaire introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_self_referral(p_affiliate_id, v_user, v_email) then
    raise exception 'Auto-affiliation interdite pour cet affilié.' using errcode = 'check_violation';
  end if;

  select * into v_current from public.affiliate_attributions
   where (case when p_target_type = 'ORDER' then order_id else quote_request_id end) = p_target_id
     and status in ('ACTIVE', 'VALIDEE')
   for update;
  if found and v_current.status = 'VALIDEE' then
    raise exception 'Une attribution validée existe : révoquez-la d''abord.' using errcode = 'check_violation';
  end if;
  if found then
    update public.affiliate_attributions
       set status = 'REMPLACEE', ended_at = now(), ended_by = auth.uid(), end_reason = left(btrim(p_reason), 1000)
     where id = v_current.id;
  end if;

  insert into public.affiliate_attributions
    (affiliate_id, source, status, quote_request_id, order_id, lead_id, reason, created_by, validated_by, validated_at)
  values
    (p_affiliate_id, 'ADMINISTRATION', 'VALIDEE',
     case when p_target_type = 'REQUEST' then p_target_id end,
     case when p_target_type = 'ORDER' then p_target_id end,
     v_lead, left(btrim(p_reason), 1000), auth.uid(), auth.uid(), now())
  returning * into v_new;
  return v_new;
end;
$fn$;

revoke execute on function public.attribute_affair(text, uuid, uuid, text) from public, anon;
grant  execute on function public.attribute_affair(text, uuid, uuid, text) to authenticated, service_role;


create or replace function public.validate_attribution(p_attribution_id uuid)
returns public.affiliate_attributions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_attributions%rowtype;
begin
  if not public.has_permission('affiliate_attributions.manage') then
    raise exception 'Permission affiliate_attributions.manage requise.' using errcode = '42501';
  end if;
  select * into v_row from public.affiliate_attributions where id = p_attribution_id for update;
  if not found then
    raise exception 'Attribution introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(v_row.affiliate_id) then
    raise exception 'Vous ne pouvez pas valider votre propre attribution.' using errcode = '42501';
  end if;
  if v_row.status = 'VALIDEE' then
    return v_row;
  end if;
  update public.affiliate_attributions set status = 'VALIDEE', validated_at = now(), validated_by = auth.uid()
   where id = p_attribution_id returning * into v_row;
  return v_row;
end;
$fn$;

revoke execute on function public.validate_attribution(uuid) from public, anon;
grant  execute on function public.validate_attribution(uuid) to authenticated, service_role;


create or replace function public.revoke_attribution(p_attribution_id uuid, p_reason text)
returns public.affiliate_attributions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.affiliate_attributions%rowtype;
begin
  if not public.has_permission('affiliate_attributions.manage') then
    raise exception 'Permission affiliate_attributions.manage requise.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Une révocation se justifie.' using errcode = 'check_violation';
  end if;
  select * into v_row from public.affiliate_attributions where id = p_attribution_id for update;
  if not found then
    raise exception 'Attribution introuvable.' using errcode = 'no_data_found';
  end if;
  if v_row.status not in ('ACTIVE', 'VALIDEE') then
    raise exception 'Cette attribution n''est plus en vigueur.' using errcode = 'check_violation';
  end if;
  if v_row.source = 'CODE' and exists (
    select 1 from public.affiliate_code_uses u where u.attribution_id = v_row.id and u.status = 'ACTIVE'
  ) then
    raise exception 'Retirez d''abord le code appliqué à cette commande.' using errcode = 'check_violation';
  end if;
  update public.affiliate_attributions
     set status = 'REVOQUEE', ended_at = now(), ended_by = auth.uid(), end_reason = left(btrim(p_reason), 1000)
   where id = p_attribution_id returning * into v_row;
  return v_row;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- 5. CODES APPLIQUÉS À UNE COMMANDE (N4 : par l'administration ; I : un seul)
--
-- La réduction est répartie sur les lignes éligibles de la commande — la
-- remise de la commande de 4G est la somme des remises de ses lignes — et son
-- effet exact est figé ici, pour pouvoir le retirer sans approximation.
-- Refusé dès qu'un paiement existe ou qu'une facture est émise : le montant
-- d'une affaire payée ou facturée ne se réécrit pas.
-- -----------------------------------------------------------------------------

create table if not exists public.affiliate_code_uses (
  id              uuid primary key default gen_random_uuid(),
  code_id         uuid not null references public.affiliate_codes (id) on delete restrict,
  affiliate_id    uuid not null references public.affiliates (id) on delete restrict,
  order_id        uuid not null references public.orders (id) on delete restrict,
  attribution_id  uuid references public.affiliate_attributions (id) on delete set null,
  status          text not null default 'ACTIVE',
  discount_total  numeric(12, 2) not null,
  lines           jsonb not null,
  code_snapshot   jsonb not null,
  applied_by      uuid references public.profiles (id) on delete set null,
  applied_at      timestamptz not null default now(),
  removed_by      uuid references public.profiles (id) on delete set null,
  removed_at      timestamptz,
  remove_reason   text,
  constraint affiliate_code_uses_status check (status in ('ACTIVE', 'RETIREE')),
  constraint affiliate_code_uses_discount check (discount_total > 0),
  constraint affiliate_code_uses_lines check (jsonb_typeof(lines) = 'array'),
  constraint affiliate_code_uses_removed check (status <> 'RETIREE' or (removed_at is not null and remove_reason is not null))
);

-- Décision I : un seul code par commande.
create unique index if not exists affiliate_code_uses_one_per_order
  on public.affiliate_code_uses (order_id) where status = 'ACTIVE';
create index if not exists affiliate_code_uses_code_idx on public.affiliate_code_uses (code_id) where status = 'ACTIVE';

create or replace function public.tg_affiliate_code_uses_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une utilisation de code ne se supprime pas : elle se retire.' using errcode = 'check_violation';
  end if;
  if (new.code_id, new.order_id, new.discount_total, new.lines, new.code_snapshot, new.applied_at)
     is distinct from (old.code_id, old.order_id, old.discount_total, old.lines, old.code_snapshot, old.applied_at)
     or (old.status = 'RETIREE' and new.status is distinct from old.status) then
    raise exception 'Une utilisation de code est figée.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists affiliate_code_uses_guard on public.affiliate_code_uses;
create trigger affiliate_code_uses_guard
  before update or delete on public.affiliate_code_uses
  for each row execute function public.tg_affiliate_code_uses_guard();


create or replace function public.apply_affiliate_code(p_order_id uuid, p_code text, p_reason text default null)
returns public.affiliate_code_uses
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order     public.orders%rowtype;
  v_code      public.affiliate_codes%rowtype;
  v_aff       public.affiliates%rowtype;
  v_current   public.affiliate_attributions%rowtype;
  v_attr      uuid;
  v_use       public.affiliate_code_uses%rowtype;
  v_item      record;
  v_eligible  numeric(12, 2) := 0;
  v_discount  numeric(12, 2);
  v_left      numeric(12, 2);
  v_share     numeric(12, 2);
  v_lines     jsonb := '[]'::jsonb;
  v_count     integer;
  v_n         integer := 0;
  v_total_n   integer;
begin
  if not (public.has_permission('affiliate_codes.manage') and public.has_permission('orders.update')) then
    raise exception 'Permissions affiliate_codes.manage et orders.update requises.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;
  if v_order.status in ('TERMINEE', 'ANNULEE') or v_order.paid_amount > 0 then
    raise exception 'Un code ne s''applique qu''à une commande ouverte et encore impayée.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.documents d
              where d.entity_id = p_order_id and d.doc_type = 'FACL' and d.status = 'EMIS') then
    raise exception 'Une facture est émise pour cette commande : son montant ne change plus.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.affiliate_code_uses where order_id = p_order_id and status = 'ACTIVE') then
    raise exception 'Un code est déjà appliqué à cette commande : un seul code par affaire.' using errcode = 'check_violation';
  end if;

  select * into v_code from public.affiliate_codes where upper(code) = upper(btrim(p_code)) for update;
  if not found or not v_code.is_active or v_code.valid_from > now() or (v_code.valid_to is not null and v_code.valid_to <= now()) then
    raise exception 'Code inconnu, inactif ou hors de sa période de validité.' using errcode = 'check_violation';
  end if;
  select * into v_aff from public.affiliates where id = v_code.affiliate_id;
  if v_aff.status <> 'ACTIF' then
    raise exception 'Ce code appartient à un affilié qui n''est pas actif.' using errcode = 'check_violation';
  end if;
  if public.affiliate_is_caller(v_aff.id) then
    raise exception 'Vous ne pouvez pas appliquer votre propre code.' using errcode = '42501';
  end if;
  if public.affiliate_is_self_referral(v_aff.id, v_order.user_id, v_order.customer_email) then
    raise exception 'Auto-affiliation interdite pour cet affilié.' using errcode = 'check_violation';
  end if;
  if v_code.min_order_amount is not null and v_order.subtotal_amount < v_code.min_order_amount then
    raise exception 'Montant minimum de l''affaire non atteint pour ce code.' using errcode = 'check_violation';
  end if;
  if v_code.max_uses is not null then
    select count(*) into v_count from public.affiliate_code_uses where code_id = v_code.id and status = 'ACTIVE';
    if v_count >= v_code.max_uses then
      raise exception 'Ce code a atteint son nombre maximum d''utilisations.' using errcode = 'check_violation';
    end if;
  end if;
  if v_code.max_uses_per_customer is not null then
    select count(*) into v_count from public.affiliate_code_uses u join public.orders o on o.id = u.order_id
     where u.code_id = v_code.id and u.status = 'ACTIVE' and o.user_id = v_order.user_id;
    if v_count >= v_code.max_uses_per_customer then
      raise exception 'Ce client a déjà utilisé ce code autant que permis.' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_current from public.affiliate_attributions
   where order_id = p_order_id and status in ('ACTIVE', 'VALIDEE') for update;
  if found and v_current.status = 'VALIDEE' and v_current.affiliate_id <> v_aff.id then
    raise exception 'Une attribution validée à un autre affilié existe : révoquez-la d''abord.' using errcode = 'check_violation';
  end if;

  -- Lignes éligibles.
  for v_item in
    select oi.id, round(oi.unit_price * oi.quantity, 2) - oi.discount_amount as net
      from public.order_items oi
     where oi.order_id = p_order_id
       and (cardinality(v_code.service_ids) + cardinality(v_code.product_ids) = 0
            or oi.service_id = any (v_code.service_ids) or oi.product_id = any (v_code.product_ids))
       and not (oi.service_id is not null and oi.service_id = any (v_code.excluded_service_ids))
       and not (oi.product_id is not null and oi.product_id = any (v_code.excluded_product_ids))
       and round(oi.unit_price * oi.quantity, 2) - oi.discount_amount > 0
     order by oi.position, oi.id
  loop
    v_eligible := v_eligible + v_item.net;
  end loop;
  if v_eligible <= 0 then
    raise exception 'Aucune ligne de cette commande n''est éligible à ce code.' using errcode = 'check_violation';
  end if;

  v_discount := case when v_code.discount_kind = 'PERCENT'
                     then round(v_eligible * v_code.discount_value / 100, 2)
                     else least(v_code.discount_value, v_eligible) end;
  if v_code.max_discount_amount is not null then
    v_discount := least(v_discount, v_code.max_discount_amount);
  end if;
  v_discount := least(v_discount, v_eligible);

  -- Répartition au prorata, le reste sur la dernière ligne : la somme est exacte.
  v_left := v_discount;
  select count(*) into v_total_n
    from public.order_items oi
   where oi.order_id = p_order_id
     and (cardinality(v_code.service_ids) + cardinality(v_code.product_ids) = 0
          or oi.service_id = any (v_code.service_ids) or oi.product_id = any (v_code.product_ids))
     and not (oi.service_id is not null and oi.service_id = any (v_code.excluded_service_ids))
     and not (oi.product_id is not null and oi.product_id = any (v_code.excluded_product_ids))
     and round(oi.unit_price * oi.quantity, 2) - oi.discount_amount > 0;
  for v_item in
    select oi.id, round(oi.unit_price * oi.quantity, 2) - oi.discount_amount as net
      from public.order_items oi
     where oi.order_id = p_order_id
       and (cardinality(v_code.service_ids) + cardinality(v_code.product_ids) = 0
            or oi.service_id = any (v_code.service_ids) or oi.product_id = any (v_code.product_ids))
       and not (oi.service_id is not null and oi.service_id = any (v_code.excluded_service_ids))
       and not (oi.product_id is not null and oi.product_id = any (v_code.excluded_product_ids))
       and round(oi.unit_price * oi.quantity, 2) - oi.discount_amount > 0
     order by oi.position, oi.id
  loop
    v_n := v_n + 1;
    v_share := case when v_n = v_total_n then v_left else least(v_left, round(v_discount * v_item.net / v_eligible, 2)) end;
    if v_share > 0 then
      update public.order_items set discount_amount = discount_amount + v_share where id = v_item.id;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('item', v_item.id, 'montant', v_share));
      v_left := v_left - v_share;
    end if;
  end loop;

  -- Décision B : le code l'emporte sur un lien ou un prospect non validés.
  if v_current.id is not null and v_current.affiliate_id = v_aff.id and v_current.status = 'VALIDEE' then
    v_attr := v_current.id;
  else
    if v_current.id is not null then
      update public.affiliate_attributions
         set status = 'REMPLACEE', ended_at = now(), ended_by = auth.uid(),
             end_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Remplacée par un code partenaire')
       where id = v_current.id;
    end if;
    insert into public.affiliate_attributions (affiliate_id, source, order_id, lead_id, code_id, reason, created_by)
    values (v_aff.id, 'CODE', p_order_id, v_order.lead_id, v_code.id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
    returning id into v_attr;
  end if;

  insert into public.affiliate_code_uses
    (code_id, affiliate_id, order_id, attribution_id, discount_total, lines, code_snapshot, applied_by)
  values
    (v_code.id, v_aff.id, p_order_id, v_attr, v_discount, v_lines,
     to_jsonb(v_code) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at', auth.uid())
  returning * into v_use;

  perform public.affiliation_log(v_aff.id, null, 'CODE_APPLIQUE',
    format('Code %s appliqué à la commande %s', v_code.code, v_order.reference), null,
    jsonb_build_object('remise', v_discount, 'commande', v_order.reference));
  return v_use;
end;
$fn$;

revoke execute on function public.apply_affiliate_code(uuid, text, text) from public, anon;
grant  execute on function public.apply_affiliate_code(uuid, text, text) to authenticated, service_role;


create or replace function public.remove_affiliate_code(p_order_id uuid, p_reason text)
returns public.affiliate_code_uses
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order public.orders%rowtype;
  v_use   public.affiliate_code_uses%rowtype;
  v_line  jsonb;
begin
  if not (public.has_permission('affiliate_codes.manage') and public.has_permission('orders.update')) then
    raise exception 'Permissions affiliate_codes.manage et orders.update requises.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Un motif est requis.' using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;
  if v_order.status in ('TERMINEE', 'ANNULEE') or v_order.paid_amount > 0 then
    raise exception 'Le code d''une commande payée ou close ne se retire plus.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.documents d
              where d.entity_id = p_order_id and d.doc_type = 'FACL' and d.status = 'EMIS') then
    raise exception 'Une facture est émise pour cette commande : son montant ne change plus.' using errcode = 'check_violation';
  end if;
  select * into v_use from public.affiliate_code_uses where order_id = p_order_id and status = 'ACTIVE' for update;
  if not found then
    raise exception 'Aucun code appliqué à cette commande.' using errcode = 'no_data_found';
  end if;

  for v_line in select value from jsonb_array_elements(v_use.lines) loop
    update public.order_items
       set discount_amount = greatest(discount_amount - (v_line ->> 'montant')::numeric, 0)
     where id = (v_line ->> 'item')::uuid;
  end loop;

  update public.affiliate_code_uses
     set status = 'RETIREE', removed_at = now(), removed_by = auth.uid(), remove_reason = left(btrim(p_reason), 1000)
   where id = v_use.id returning * into v_use;
  update public.affiliate_attributions
     set status = 'REVOQUEE', ended_at = now(), ended_by = auth.uid(), end_reason = left(btrim(p_reason), 1000)
   where id = v_use.attribution_id and status = 'ACTIVE' and source = 'CODE';

  perform public.affiliation_log(v_use.affiliate_id, null, 'CODE_RETIRE',
    format('Code retiré de la commande %s', v_order.reference), null, jsonb_build_object('motif', p_reason));
  return v_use;
end;
$fn$;

revoke execute on function public.remove_affiliate_code(uuid, text) from public, anon;
grant  execute on function public.remove_affiliate_code(uuid, text) to authenticated, service_role;

revoke execute on function public.revoke_attribution(uuid, text) from public, anon;
grant  execute on function public.revoke_attribution(uuid, text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. CE QUE VOIT L'AFFILIÉ : CONVERSIONS ET CHIFFRES, SANS DONNÉE CLIENT
-- -----------------------------------------------------------------------------

create or replace function public.my_affiliate_conversions()
returns table (
  order_reference text,
  ordered_at      timestamptz,
  offer           text,
  amount          numeric,
  order_status    text,
  settlement      text,
  source          text,
  attribution     text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.reference, o.created_at,
         (select oi.designation from public.order_items oi where oi.order_id = o.id order by oi.position, oi.id limit 1),
         o.total_amount, o.status, o.settlement_status, at.source, at.status
    from public.affiliate_attributions at
    join public.affiliates a on a.id = at.affiliate_id and a.user_id = auth.uid()
    join public.orders o on o.id = at.order_id
   where at.status in ('ACTIVE', 'VALIDEE')
   order by o.created_at desc;
$$;

comment on function public.my_affiliate_conversions() is
  'Affaires attribuées à l''affilié connecté : référence, offre, montant, statuts. Jamais le nom, l''adresse ni les coordonnées du client.';

revoke execute on function public.my_affiliate_conversions() from public, anon;
grant  execute on function public.my_affiliate_conversions() to authenticated, service_role;


-- Chiffres d'un affilié : l'affilié pour lui-même, l'administration sous
-- affiliates.view. Tous calculés sur les lignes réelles, aucun n'est stocké.
create or replace function public.affiliate_stats(p_affiliate_id uuid)
returns table (
  clicks            bigint,
  prospects         bigint,
  prospects_recognized bigint,
  requests          bigint,
  conversions       bigint,
  attributed_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.affiliate_is_caller(p_affiliate_id) or public.can_view_affiliation()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    select
      (select count(*) from public.affiliate_clicks c where c.affiliate_id = p_affiliate_id),
      (select count(*) from public.affiliate_prospects p where p.affiliate_id = p_affiliate_id and p.status <> 'ANNULE'),
      (select count(*) from public.affiliate_prospects p where p.affiliate_id = p_affiliate_id and p.status in ('RECONNU', 'CONVERTI')),
      (select count(*) from public.affiliate_attributions at
        where at.affiliate_id = p_affiliate_id and at.quote_request_id is not null and at.status in ('ACTIVE', 'VALIDEE')),
      (select count(*) from public.affiliate_attributions at join public.orders o on o.id = at.order_id
        where at.affiliate_id = p_affiliate_id and at.status in ('ACTIVE', 'VALIDEE') and o.status <> 'ANNULEE'),
      (select coalesce(sum(o.total_amount), 0) from public.affiliate_attributions at join public.orders o on o.id = at.order_id
        where at.affiliate_id = p_affiliate_id and at.status in ('ACTIVE', 'VALIDEE') and o.status <> 'ANNULEE');
end;
$fn$;

revoke execute on function public.affiliate_stats(uuid) from public, anon;
grant  execute on function public.affiliate_stats(uuid) to authenticated, service_role;

-- Clics par lien : l'affilié pour lui-même, l'administration sous affiliates.view.
create or replace function public.affiliate_click_stats(p_affiliate_id uuid)
returns table (campaign_id uuid, clicks bigint, requests bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.affiliate_is_caller(p_affiliate_id) or public.can_view_affiliation()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
    select c.campaign_id, count(*),
           (select count(*) from public.affiliate_attributions at
             where at.affiliate_id = p_affiliate_id and at.source = 'LIEN' and at.quote_request_id is not null
               and at.campaign_id is not distinct from c.campaign_id)
      from public.affiliate_clicks c
     where c.affiliate_id = p_affiliate_id
     group by c.campaign_id;
end;
$fn$;

revoke execute on function public.affiliate_click_stats(uuid) from public, anon;
grant  execute on function public.affiliate_click_stats(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. PRIVILÈGES ET RLS
-- -----------------------------------------------------------------------------

revoke all on public.affiliate_clicks       from anon, authenticated;
revoke all on public.affiliate_prospects    from anon, authenticated;
revoke all on public.affiliate_attributions from anon, authenticated;
revoke all on public.affiliate_code_uses    from anon, authenticated;

-- Les clics : l'administration en lit la date, le lien et la page d'arrivée ;
-- l'empreinte du visiteur et le jeton ne sont accordés à aucune session.
grant select (id, affiliate_id, campaign_id, landing_path, window_days, created_at)
  on public.affiliate_clicks to authenticated;
grant select (id, affiliate_id, status, full_name, company, phone, email, need, comment,
              consent_confirmed, lead_id, review_reason, reviewed_at, recognized_at,
              protected_until, converted_at, created_at, updated_at)
  on public.affiliate_prospects to authenticated;
grant select on public.affiliate_attributions to authenticated;
grant select on public.affiliate_code_uses to authenticated;

grant all on public.affiliate_clicks, public.affiliate_prospects, public.affiliate_attributions,
             public.affiliate_code_uses to service_role;

alter table public.affiliate_clicks       enable row level security;
alter table public.affiliate_prospects    enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_code_uses    enable row level security;

drop policy if exists affiliate_clicks_select on public.affiliate_clicks;
create policy affiliate_clicks_select
  on public.affiliate_clicks for select to authenticated
  using (public.can_view_affiliation());

drop policy if exists affiliate_prospects_select on public.affiliate_prospects;
create policy affiliate_prospects_select
  on public.affiliate_prospects for select to authenticated
  using (public.affiliate_is_caller(affiliate_id) or public.can_view_affiliation());

-- L'affilié ne lit pas ses attributions brutes (elles désignent la demande
-- et le prospect du client) : il passe par my_affiliate_conversions().
drop policy if exists affiliate_attributions_select on public.affiliate_attributions;
create policy affiliate_attributions_select
  on public.affiliate_attributions for select to authenticated
  using (public.can_view_affiliation());

drop policy if exists affiliate_code_uses_select on public.affiliate_code_uses;
create policy affiliate_code_uses_select
  on public.affiliate_code_uses for select to authenticated
  using (public.can_view_affiliation());
