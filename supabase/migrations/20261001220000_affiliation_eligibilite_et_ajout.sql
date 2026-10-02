-- =============================================================================
-- PHASE 4H — CORRECTIF DE CLÔTURE : ÉLIGIBILITÉ ADMINISTRABLE DES OFFRES
--                                   ET AJOUT MANUEL D'UN AFFILIÉ
--
-- Deux constats du contrôle avant clôture (rapport 15, § 9) :
--
--   A. l'éligibilité d'une offre (`affiliate_eligible`) et son plafond
--      (`affiliate_max_rate`) existaient et le moteur les respectait, mais
--      aucun écran ne permettait de les décider ;
--   B. un affilié ne pouvait naître que d'une candidature publique.
--
-- ## A — Éligibilité et plafond
--
-- Publication et affiliation restent deux notions indépendantes : rien ici
-- ne lit `status`.
--
--   1. Garde en base : modifier l'éligibilité ou le plafond d'une offre exige
--      `affiliate_rules.manage`, en plus de la permission d'édition de l'offre
--      que la RLS exige déjà. Sur tous les chemins — formulaire, appel direct.
--   2. Historique, en ajout seul, écrit par déclencheur à chaque changement :
--      le moteur lit l'éligibilité et le plafond **à la date de l'affaire**,
--      comme il lit déjà les règles. Une vente faite quand l'offre était
--      affiliable garde sa commission ; une vente postérieure à la
--      désactivation n'en produit pas. Une commission acquise, elle, est de
--      toute façon figée.
--   3. L'état actuel des offres est repris tel quel comme point de départ de
--      l'historique : **aucune offre n'est rendue affiliable** par cette
--      migration.
--   4. `set_offer_affiliation` : l'acte de l'administration, sous les deux
--      permissions, pour un service comme pour un produit.
--
-- ## B — Ajout manuel d'un affilié
--
-- Aucun second moteur : `create_affiliate` crée seulement la fiche « en
-- préparation », comme le fait l'acceptation d'une candidature ; tout le
-- reste (règles, dérogation, coordonnées, campagnes, codes, activation —
-- qui retrouve un compte existant par son adresse ou en crée un —, référence
-- AFIL, rôle, espace) est le parcours existant. Seule l'origine diffère, et
-- elle est enregistrée : `origin = 'ADMINISTRATION'`, `created_by`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A1. HISTORIQUE DE L'ÉLIGIBILITÉ DES OFFRES
-- -----------------------------------------------------------------------------

create table if not exists public.offer_affiliation_history (
  id          bigint generated always as identity primary key,
  offer_type  text not null,
  offer_id    uuid not null,
  eligible    boolean not null,
  max_rate    numeric(5, 2),
  valid_from  timestamptz not null default now(),
  changed_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint offer_affiliation_history_type check (offer_type in ('SERVICE', 'PRODUCT')),
  constraint offer_affiliation_history_capped check (eligible = false or max_rate is not null)
);

comment on table public.offer_affiliation_history is
  'Éligibilité à l''affiliation et plafond de chaque offre, dans le temps. Ajout seul. Le moteur de commission la lit à la date de l''affaire.';

create index if not exists offer_affiliation_history_lookup
  on public.offer_affiliation_history (offer_type, offer_id, valid_from desc, id desc);

-- Seule exception : l'historique d'une offre supprimée part avec elle. Une
-- offre ne se supprime que si elle n'a jamais été publiée (migration 0006) —
-- aucune vente ne peut donc s'y rapporter.
create or replace function public.tg_offer_affiliation_history_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.services where id = old.offer_id
    union all
    select 1 from public.products where id = old.offer_id
  ) then
    return old;
  end if;
  raise exception 'L''historique d''éligibilité des offres ne se modifie pas.' using errcode = 'check_violation';
end;
$$;

drop trigger if exists offer_affiliation_history_append_only on public.offer_affiliation_history;
create trigger offer_affiliation_history_append_only
  before update or delete on public.offer_affiliation_history
  for each row execute function public.tg_offer_affiliation_history_append_only();

-- Point de départ : l'état actuel, valable depuis toujours. Aucune offre
-- n'est rendue affiliable ici.
insert into public.offer_affiliation_history (offer_type, offer_id, eligible, max_rate, valid_from)
select 'SERVICE', s.id, s.affiliate_eligible, s.affiliate_max_rate, '-infinity'::timestamptz
  from public.services s
 where not exists (select 1 from public.offer_affiliation_history h where h.offer_type = 'SERVICE' and h.offer_id = s.id);
insert into public.offer_affiliation_history (offer_type, offer_id, eligible, max_rate, valid_from)
select 'PRODUCT', p.id, p.affiliate_eligible, p.affiliate_max_rate, '-infinity'::timestamptz
  from public.products p
 where not exists (select 1 from public.offer_affiliation_history h where h.offer_type = 'PRODUCT' and h.offer_id = p.id);

revoke all on public.offer_affiliation_history from anon, authenticated;
grant select on public.offer_affiliation_history to authenticated;
grant all on public.offer_affiliation_history to service_role;
alter table public.offer_affiliation_history enable row level security;
drop policy if exists offer_affiliation_history_select on public.offer_affiliation_history;
create policy offer_affiliation_history_select
  on public.offer_affiliation_history for select to authenticated
  using (public.can_view_affiliation());


-- -----------------------------------------------------------------------------
-- A2. GARDE ET ENREGISTREMENT, SUR LES SERVICES ET LES PRODUITS
-- -----------------------------------------------------------------------------

-- Avant écriture : l'éligibilité et le plafond sont un levier financier.
-- `affiliate_rules.manage` est exigé en plus de la permission d'édition de
-- l'offre (que la RLS exige déjà pour toute écriture de session). Le serveur
-- (clé de service, `auth.uid()` nul) n'est pas concerné.
create or replace function public.tg_offer_affiliation_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_touched boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_touched := new.affiliate_eligible or new.affiliate_max_rate is not null;
  else
    v_touched := (new.affiliate_eligible, new.affiliate_max_rate) is distinct from (old.affiliate_eligible, old.affiliate_max_rate);
  end if;
  if v_touched and not public.has_permission('affiliate_rules.manage') then
    raise exception 'L''éligibilité à l''affiliation et le plafond de commission exigent la permission affiliate_rules.manage.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Après écriture : chaque changement rejoint l'historique, quel qu'en soit le
-- chemin.
create or replace function public.tg_offer_affiliation_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     or (new.affiliate_eligible, new.affiliate_max_rate) is distinct from (old.affiliate_eligible, old.affiliate_max_rate) then
    insert into public.offer_affiliation_history (offer_type, offer_id, eligible, max_rate, changed_by)
    values (case tg_table_name when 'services' then 'SERVICE' else 'PRODUCT' end,
            new.id, new.affiliate_eligible, new.affiliate_max_rate, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists services_affiliation_guard on public.services;
create trigger services_affiliation_guard
  before insert or update of affiliate_eligible, affiliate_max_rate on public.services
  for each row execute function public.tg_offer_affiliation_guard();
drop trigger if exists products_affiliation_guard on public.products;
create trigger products_affiliation_guard
  before insert or update of affiliate_eligible, affiliate_max_rate on public.products
  for each row execute function public.tg_offer_affiliation_guard();

drop trigger if exists services_affiliation_history on public.services;
create trigger services_affiliation_history
  after insert or update of affiliate_eligible, affiliate_max_rate on public.services
  for each row execute function public.tg_offer_affiliation_history();
drop trigger if exists products_affiliation_history on public.products;
create trigger products_affiliation_history
  after insert or update of affiliate_eligible, affiliate_max_rate on public.products
  for each row execute function public.tg_offer_affiliation_history();


-- Une offre supprimée emporte son historique (voir l'exception ci-dessus).
create or replace function public.tg_offer_affiliation_history_purge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.offer_affiliation_history
   where offer_type = case tg_table_name when 'services' then 'SERVICE' else 'PRODUCT' end
     and offer_id = old.id;
  return null;
end;
$$;

drop trigger if exists services_affiliation_history_purge on public.services;
create trigger services_affiliation_history_purge
  after delete on public.services
  for each row execute function public.tg_offer_affiliation_history_purge();
drop trigger if exists products_affiliation_history_purge on public.products;
create trigger products_affiliation_history_purge
  after delete on public.products
  for each row execute function public.tg_offer_affiliation_history_purge();


-- Éligibilité et plafond d'une offre à une date. Sans historique : non éligible.
create or replace function public.offer_affiliation_at(p_service_id uuid, p_product_id uuid, p_at timestamptz)
returns table (eligible boolean, max_rate numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(h.eligible, false), h.max_rate
    from (select 1) one
    left join lateral (
      select x.eligible, x.max_rate
        from public.offer_affiliation_history x
       where x.offer_type = case when p_service_id is not null then 'SERVICE' else 'PRODUCT' end
         and x.offer_id = coalesce(p_service_id, p_product_id)
         and x.valid_from <= p_at
       order by x.valid_from desc, x.id desc
       limit 1
    ) h on true;
$$;

revoke execute on function public.offer_affiliation_at(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.offer_affiliation_at(uuid, uuid, timestamptz) to service_role;


-- L'acte de l'administration.
create or replace function public.set_offer_affiliation(
  p_offer_type text,
  p_offer_id   uuid,
  p_eligible   boolean,
  p_max_rate   numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_edit text := case p_offer_type when 'SERVICE' then 'services.update' when 'PRODUCT' then 'products.update' end;
  v_rate numeric;
  v_row  record;
begin
  if v_edit is null then
    raise exception 'Type d''offre inconnu.' using errcode = 'check_violation';
  end if;
  if not (public.has_permission(v_edit) and public.has_permission('affiliate_rules.manage')) then
    raise exception 'Permissions % et affiliate_rules.manage requises.', v_edit using errcode = '42501';
  end if;
  if p_max_rate is not null and (p_max_rate <= 0 or p_max_rate > 100 or p_max_rate <> round(p_max_rate, 2)) then
    raise exception 'Plafond invalide : un pourcentage entre 0 et 100, deux décimales au plus.' using errcode = 'check_violation';
  end if;

  if p_offer_type = 'SERVICE' then
    select affiliate_max_rate into v_rate from public.services where id = p_offer_id for update;
    if not found then raise exception 'Offre introuvable.' using errcode = 'no_data_found'; end if;
    v_rate := coalesce(p_max_rate, v_rate);
    if p_eligible and v_rate is null then
      raise exception 'Une offre éligible à l''affiliation doit porter un plafond de commission.' using errcode = 'check_violation';
    end if;
    update public.services set affiliate_eligible = p_eligible, affiliate_max_rate = v_rate where id = p_offer_id
    returning id, title, status, affiliate_eligible, affiliate_max_rate into v_row;
  else
    select affiliate_max_rate into v_rate from public.products where id = p_offer_id for update;
    if not found then raise exception 'Offre introuvable.' using errcode = 'no_data_found'; end if;
    v_rate := coalesce(p_max_rate, v_rate);
    if p_eligible and v_rate is null then
      raise exception 'Une offre éligible à l''affiliation doit porter un plafond de commission.' using errcode = 'check_violation';
    end if;
    update public.products set affiliate_eligible = p_eligible, affiliate_max_rate = v_rate where id = p_offer_id
    returning id, title, status, affiliate_eligible, affiliate_max_rate into v_row;
  end if;

  return jsonb_build_object('id', v_row.id, 'title', v_row.title, 'status', v_row.status,
                            'eligible', v_row.affiliate_eligible, 'maxRate', v_row.affiliate_max_rate);
end;
$fn$;

comment on function public.set_offer_affiliation(text, uuid, boolean, numeric) is
  'Rend une offre affiliable ou non et fixe son plafond. Exige la permission d''édition de l''offre ET affiliate_rules.manage. Ne lit pas la publication.';

revoke execute on function public.set_offer_affiliation(text, uuid, boolean, numeric) from public, anon;
grant  execute on function public.set_offer_affiliation(text, uuid, boolean, numeric) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- A3. LE MOTEUR LIT L'ÉLIGIBILITÉ À LA DATE DE L'AFFAIRE
--
-- Seul changement par rapport à 4H-5 : l'éligibilité et le plafond viennent de
-- `offer_affiliation_at(…, date de la commande)` au lieu de l'état courant de
-- l'offre. Le reste — résolution des règles, dérogation N1, calcul — est
-- inchangé.
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_order_lines(p_affiliate_id uuid, p_order_id uuid, p_ratio numeric default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order   public.orders%rowtype;
  v_item    record;
  v_rule    public.affiliate_rules%rowtype;
  v_res     record;
  v_offer   record;
  v_calc    record;
  v_cap     numeric;
  v_rate    numeric;
  v_tier    integer;
  v_raw     numeric;
  v_amt     numeric;
  v_minap   boolean;
  v_maxap   boolean;
  v_capap   boolean;
  v_lines   jsonb := '[]'::jsonb;
  v_base    numeric;
  v_reason  text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return v_lines;
  end if;

  for v_item in
    select oi.id, oi.designation, oi.service_id, oi.product_id, oi.line_total
      from public.order_items oi
     where oi.order_id = p_order_id
     order by oi.position, oi.id
  loop
    v_base := round(greatest(v_item.line_total, 0) * p_ratio, 2);
    v_reason := null;
    v_cap := null;
    v_rate := null; v_tier := null; v_raw := 0; v_amt := 0;
    v_minap := false; v_maxap := false; v_capap := false;

    if v_item.service_id is null and v_item.product_id is null then
      v_reason := 'OFFRE_ABSENTE';
    else
      -- Éligibilité et plafond tels qu'ils étaient à la date de l'affaire.
      select o.eligible, o.max_rate into v_offer
        from public.offer_affiliation_at(v_item.service_id, v_item.product_id, v_order.created_at) o;
      if not coalesce(v_offer.eligible, false) or v_offer.max_rate is null then
        v_reason := 'OFFRE_NON_ELIGIBLE';
      end if;
    end if;

    select r.rule_id, r.origin into v_res
      from public.affiliate_resolve_rule(p_affiliate_id, v_item.service_id, v_item.product_id, v_order.created_at) r;
    if v_res.rule_id is null and v_reason is null then
      v_reason := 'AUCUNE_REGLE';
    end if;

    if v_reason is null then
      select * into v_rule from public.affiliate_rules where id = v_res.rule_id;
      -- N1 : plafond de l'offre, sauf dérogation contractuelle individuelle —
      -- qui ne rend jamais éligible une offre qui ne l'est pas (filtre ci-dessus).
      v_cap := case when v_rule.contractual_derogation and v_rule.owner_type = 'AFFILIATE' then null else v_offer.max_rate end;
      select * into v_calc from public.affiliate_compute(
        v_rule.kind, v_rule.rate, v_rule.fixed_amount, v_rule.tiers, v_rule.min_commission,
        v_rule.max_commission, v_rule.min_base, v_base, v_cap);
      v_rate := v_calc.applied_rate; v_tier := v_calc.tier_index; v_raw := coalesce(v_calc.raw_amount, 0);
      v_minap := coalesce(v_calc.min_applied, false); v_maxap := coalesce(v_calc.max_applied, false);
      v_capap := coalesce(v_calc.cap_applied, false);
      if v_calc.eligible then
        v_amt := v_calc.amount;
      else
        v_reason := v_calc.reason;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'item', v_item.id,
      'designation', v_item.designation,
      'offerType', case when v_item.service_id is not null then 'SERVICE' when v_item.product_id is not null then 'PRODUCT' end,
      'offerId', coalesce(v_item.service_id, v_item.product_id),
      'base', v_base,
      'eligible', v_reason is null,
      'reason', coalesce(v_reason, 'OK'),
      'capRate', v_cap,
      'rate', v_rate,
      'tierIndex', v_tier,
      'raw', v_raw,
      'amount', case when v_reason is null then v_amt else 0 end,
      'minApplied', v_minap,
      'maxApplied', v_maxap,
      'capApplied', v_capap,
      'rule', case when v_res.rule_id is not null then public.affiliate_rule_snapshot(v_res.rule_id, v_res.origin) end
    ));
  end loop;
  return v_lines;
end;
$fn$;

revoke execute on function public.affiliate_order_lines(uuid, uuid, numeric) from public, anon, authenticated;
grant  execute on function public.affiliate_order_lines(uuid, uuid, numeric) to service_role;


-- -----------------------------------------------------------------------------
-- B1. ORIGINE D'UN AFFILIÉ, ET UNE FICHE PAR ADRESSE
-- -----------------------------------------------------------------------------

alter table public.affiliates add column if not exists origin text not null default 'CANDIDATURE';
alter table public.affiliates add column if not exists created_by uuid references public.profiles (id) on delete set null;
alter table public.affiliates drop constraint if exists affiliates_origin;
alter table public.affiliates add constraint affiliates_origin check (origin in ('CANDIDATURE', 'ADMINISTRATION'));

comment on column public.affiliates.origin is
  'Entrée dans le programme : candidature publique acceptée, ou ajout direct par l''administration. Seule différence entre les deux : après activation, le moteur est le même.';

-- Une seule fiche par adresse, quel que soit son chemin : la base, et non le
-- navigateur, protège d'un doublon ou d'un double clic.
create unique index if not exists affiliates_contact_email_unique on public.affiliates (lower(contact_email));


-- -----------------------------------------------------------------------------
-- B2. AVANT DE CRÉER : CE QUI EXISTE DÉJÀ POUR CETTE ADRESSE
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_creation_check(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_user    uuid;
  v_aff     record;
  v_app     record;
  v_client  boolean := false;
begin
  if not public.has_permission('affiliates.create') then
    raise exception 'Permission affiliates.create requise.' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    raise exception 'Adresse e-mail invalide.' using errcode = 'check_violation';
  end if;
  select id into v_user from auth.users where lower(email) = v_email limit 1;
  select a.id, a.status, a.reference, a.display_name into v_aff
    from public.affiliates a
   where lower(a.contact_email) = v_email or (v_user is not null and a.user_id = v_user)
   limit 1;
  select p.id, p.status into v_app
    from public.affiliate_applications p
   where lower(p.email) = v_email and p.status in ('NOUVELLE', 'EN_ETUDE', 'INFOS_REQUISES')
   limit 1;
  if v_user is not null then
    v_client := exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                         where ur.user_id = v_user and r.code = 'CLIENT')
                or exists (select 1 from public.orders o where o.user_id = v_user);
  end if;
  return jsonb_build_object(
    'email', v_email,
    'account', v_user is not null,
    'client', v_client,
    'affiliate', case when v_aff.id is null then null else jsonb_build_object('id', v_aff.id, 'status', v_aff.status, 'reference', v_aff.reference, 'name', v_aff.display_name) end,
    'application', case when v_app.id is null then null else jsonb_build_object('id', v_app.id, 'status', v_app.status) end
  );
end;
$fn$;

revoke execute on function public.affiliate_creation_check(text) from public, anon;
grant  execute on function public.affiliate_creation_check(text) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- B3. CRÉER LA FICHE « EN PRÉPARATION »
-- -----------------------------------------------------------------------------

create or replace function public.create_affiliate(
  p_display_name       text,
  p_party_type         text,
  p_legal_name         text,
  p_email              text,
  p_phone              text,
  p_country            text,
  p_city               text,
  p_category_id        uuid,
  p_contract_reference text default null,
  p_contract_signed_on date default null,
  p_reason             text default null
)
returns public.affiliates
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_name   text := btrim(coalesce(p_display_name, ''));
  v_check  jsonb;
  v_base   text;
  v_slug   text;
  v_suffix integer := 1;
  v_aff    public.affiliates%rowtype;
begin
  if not public.has_permission('affiliates.create') then
    raise exception 'Permission affiliates.create requise.' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Le nom de l''affilié est requis (120 caractères au plus).' using errcode = 'check_violation';
  end if;
  if p_party_type not in ('PERSONNE', 'ORGANISATION') then
    raise exception 'Nature inconnue : personne ou organisation.' using errcode = 'check_violation';
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^[+0-9 ().-]{6,40}$' then
    raise exception 'Numéro de téléphone invalide.' using errcode = 'check_violation';
  end if;
  perform 1 from public.affiliate_categories where id = p_category_id and is_active;
  if not found then
    raise exception 'Catégorie introuvable ou inactive.' using errcode = 'check_violation';
  end if;

  -- Doublons : une fiche existe, ou une candidature est en cours.
  v_check := public.affiliate_creation_check(v_email);
  if v_check -> 'affiliate' <> 'null'::jsonb then
    raise exception 'Une fiche affilié existe déjà pour cette personne (%).',
      coalesce(v_check -> 'affiliate' ->> 'reference', 'en préparation') using errcode = 'check_violation';
  end if;
  if v_check -> 'application' <> 'null'::jsonb then
    raise exception 'Une candidature est en cours pour cette adresse : traitez-la plutôt que de créer une seconde fiche.'
      using errcode = 'check_violation';
  end if;

  v_base := coalesce(public.affiliate_slugify(v_name), 'partenaire');
  if length(v_base) < 3 then
    v_base := v_base || '-mora';
  end if;
  v_slug := left(v_base, 40);
  while exists (select 1 from public.affiliates where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := left(v_base, 40) || '-' || v_suffix;
  end loop;

  -- Le journal de l'affilié (déclencheur `affiliates_history`, 4H-1) consigne
  -- la création, son auteur et sa date ; il y joint ce motif, qui en dit
  -- l'origine.
  perform set_config('mora.reason', left(format('Ajout direct par l''administration (%s)%s',
    case when (v_check ->> 'account')::boolean then 'compte existant, retrouvé à l''activation' else 'aucun compte : il sera créé à l''activation' end,
    coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), '')), 1000), true);

  insert into public.affiliates (
    slug, category_id, status, party_type, display_name, legal_name,
    contact_email, contact_phone, country, city, contract_reference, contract_signed_on,
    origin, created_by
  ) values (
    v_slug, p_category_id, 'PREPARATION', p_party_type, v_name,
    nullif(left(btrim(coalesce(p_legal_name, '')), 160), ''),
    v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(left(btrim(coalesce(p_country, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(left(btrim(coalesce(p_contract_reference, '')), 80), ''), p_contract_signed_on,
    'ADMINISTRATION', auth.uid()
  )
  returning * into v_aff;

  return v_aff;
end;
$fn$;

comment on function public.create_affiliate(text, text, text, text, text, text, text, uuid, text, date, text) is
  'Ajout direct d''un affilié par l''administration (affiliates.create) : fiche EN PRÉPARATION, origine ADMINISTRATION, doublons refusés. La suite est le parcours existant jusqu''à l''activation.';

revoke execute on function public.create_affiliate(text, text, text, text, text, text, text, uuid, text, date, text) from public, anon;
grant  execute on function public.create_affiliate(text, text, text, text, text, text, text, uuid, text, date, text) to authenticated, service_role;
