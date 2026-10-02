-- =============================================================================
-- PHASE 4H-7 — AFFILIATION : PIÈCES OFFICIELLES FIAF ET RVAF
--
-- Le RVAF est émis depuis 4H-6, à la confirmation d'un versement, avec son
-- instantané. Il ne manquait que son rendu, qui est l'affaire du serveur.
--
-- Cette migration ajoute la fiche officielle de l'affilié (FIAF) :
--
--   1. un constructeur unique de son contenu — identité, catégorie,
--      conditions effectives, règles en vigueur, codes actifs, moyen de
--      versement validé (masqué) ;
--   2. l'APERÇU actuel : ce contenu, lu à l'instant, sans numéro ni valeur
--      officielle — pour l'affilié lui-même ou sous affiliates.view ;
--   3. l'ÉMISSION officielle : le moteur de documents de 4D alloue le numéro
--      FIAF sous affiliate_documents.issue, l'instantané est figé dans la
--      même transaction, et la fiche précédente passe à « remplacée ».
--
-- Une fiche émise n'est jamais régénérée différemment : elle se rend de son
-- instantané, et son archive est servie après contrôle de l'empreinte.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LE CONTENU D'UNE FICHE
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_sheet_content(p_affiliate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff     public.affiliates%rowtype;
  v_cat     public.affiliate_categories%rowtype;
  v_terms   record;
  v_rules   jsonb;
  v_codes   jsonb;
  v_account record;
begin
  select * into v_aff from public.affiliates where id = p_affiliate_id;
  if not found then
    return null;
  end if;
  select * into v_cat from public.affiliate_categories where id = v_aff.category_id;
  select * into v_terms from public.affiliate_effective_terms(p_affiliate_id);

  -- Règles en vigueur aujourd'hui : individuelles d'abord, puis catégorie.
  select coalesce(jsonb_agg(jsonb_build_object(
           'owner',        r.owner_type,
           'target',       case r.target_type when 'ALL' then 'Toutes les offres éligibles'
                             else coalesce(s.title, p.title, 'Offre') end,
           'kind',         r.kind,
           'rate',         r.rate,
           'fixedAmount',  r.fixed_amount,
           'tiers',        coalesce(r.tiers, '[]'::jsonb),
           'minCommission', r.min_commission,
           'maxCommission', r.max_commission,
           'minBase',      r.min_base,
           'validFrom',    r.valid_from,
           'validTo',      r.valid_to,
           'label',        r.label,
           'version',      r.version,
           'derogation',   r.contractual_derogation
         ) order by (r.owner_type = 'AFFILIATE') desc, (r.target_type = 'ALL'), coalesce(s.title, p.title), r.valid_from), '[]'::jsonb)
    into v_rules
    from public.affiliate_rules r
    left join public.services s on s.id = r.service_id
    left join public.products p on p.id = r.product_id
   where (r.affiliate_id = p_affiliate_id or r.category_id = v_aff.category_id)
     and r.valid_from <= now() and (r.valid_to is null or r.valid_to > now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',          c.code,
           'label',         c.label,
           'discountKind',  c.discount_kind,
           'discountValue', c.discount_value,
           'maxDiscount',   c.max_discount_amount,
           'minOrder',      c.min_order_amount,
           'validFrom',     c.valid_from,
           'validTo',       c.valid_to
         ) order by c.code), '[]'::jsonb)
    into v_codes
    from public.affiliate_codes c
   where c.affiliate_id = p_affiliate_id and c.is_active
     and (c.valid_from is null or c.valid_from <= now())
     and (c.valid_to is null or c.valid_to > now());

  select a.method_code, m.label, a.details into v_account
    from public.affiliate_payout_accounts a
    join public.payment_methods m on m.code = a.method_code
   where a.affiliate_id = p_affiliate_id and a.status = 'ACTIF'
   order by a.reviewed_at desc nulls last limit 1;

  return jsonb_build_object(
    'affiliate', jsonb_build_object(
      'reference', v_aff.reference, 'name', v_aff.display_name, 'legalName', v_aff.legal_name,
      'partyType', v_aff.party_type, 'email', v_aff.contact_email, 'phone', v_aff.contact_phone,
      'city', v_aff.city, 'country', v_aff.country, 'status', v_aff.status,
      'startedOn', v_aff.started_on, 'endedOn', v_aff.ended_on,
      'contract', v_aff.contract_reference, 'contractSignedOn', v_aff.contract_signed_on,
      'slug', v_aff.slug),
    'category', jsonb_build_object('code', v_cat.code, 'label', v_cat.label),
    'terms', jsonb_build_object(
      'attributionWindowDays', v_terms.attribution_window_days,
      'protectionMode', v_terms.prospect_protection_mode,
      'protectionMonths', v_terms.prospect_protection_months,
      'survivalMonths', v_terms.post_end_survival_months,
      'payoutFrequency', v_terms.payout_frequency,
      'payoutMinAmount', v_terms.payout_min_amount,
      'acquisitionTrigger', v_terms.acquisition_trigger),
    'rules', v_rules,
    'codes', v_codes,
    'payout', case when v_account.method_code is null then null else jsonb_build_object(
      'code', v_account.method_code, 'label', v_account.label,
      'details', public.affiliate_mask_details(v_account.details)) end
  );
end;
$fn$;

revoke execute on function public.affiliate_sheet_content(uuid) from public, anon, authenticated;
grant  execute on function public.affiliate_sheet_content(uuid) to service_role;


-- -----------------------------------------------------------------------------
-- 2. L'APERÇU ACTUEL — sans numéro, sans valeur officielle
-- -----------------------------------------------------------------------------

create or replace function public.affiliate_sheet_preview(p_affiliate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_content jsonb;
begin
  if not (public.affiliate_is_caller(p_affiliate_id) or public.has_permission('affiliates.view')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  v_content := public.affiliate_sheet_content(p_affiliate_id);
  if v_content is null then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object('schema', 1, 'type', 'FIAF', 'preview', true, 'reference', null,
                            'issued_at', now(), 'issuer', public.document_issuer_identity()) || v_content;
end;
$fn$;

revoke execute on function public.affiliate_sheet_preview(uuid) from public, anon;
grant  execute on function public.affiliate_sheet_preview(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. L'ÉMISSION OFFICIELLE
-- -----------------------------------------------------------------------------

create or replace function public.issue_affiliate_sheet(p_affiliate_id uuid)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_aff      public.affiliates%rowtype;
  v_previous uuid;
  v_document public.documents%rowtype;
  v_content  jsonb;
begin
  if auth.uid() is not null and not public.has_permission('affiliate_documents.issue') then
    raise exception 'Émission refusée : permission affiliate_documents.issue requise.' using errcode = '42501';
  end if;
  select * into v_aff from public.affiliates where id = p_affiliate_id for update;
  if not found then
    raise exception 'Affilié introuvable.' using errcode = 'no_data_found';
  end if;
  if public.affiliate_is_caller(p_affiliate_id) then
    raise exception 'Vous ne pouvez pas émettre votre propre fiche.' using errcode = '42501';
  end if;
  if v_aff.reference is null or v_aff.status = 'PREPARATION' then
    raise exception 'Une fiche officielle s''émet pour un affilié activé.' using errcode = 'check_violation';
  end if;

  select id into v_previous from public.documents
   where doc_type = 'FIAF' and entity_type = 'affiliate' and entity_id = p_affiliate_id and status = 'EMIS'
   order by issued_at desc limit 1;

  -- Le moteur de 4D, et lui seul. La fiche précédente devient « remplacée ».
  v_document := public.issue_document(
    'FIAF', 'affiliate', p_affiliate_id, v_aff.user_id, v_aff.display_name,
    jsonb_build_object('affilie', v_aff.reference), v_previous);

  v_content := jsonb_build_object('schema', 1, 'type', 'FIAF', 'preview', false,
                                  'reference', v_document.reference, 'issued_at', v_document.issued_at,
                                  'version', v_document.version, 'issuer', public.document_issuer_identity())
               || public.affiliate_sheet_content(p_affiliate_id);
  insert into public.document_snapshots (document_id, doc_type, schema_version, content, content_sha256)
  values (v_document.id, 'FIAF', 1, v_content, repeat('0', 64));

  perform public.affiliation_log(p_affiliate_id, null, 'FICHE_EMISE',
    format('Fiche officielle %s émise (version %s)', v_document.reference, v_document.version), null,
    jsonb_build_object('document', v_document.reference));
  return v_document;
end;
$fn$;

revoke execute on function public.issue_affiliate_sheet(uuid) from public, anon;
grant  execute on function public.issue_affiliate_sheet(uuid) to authenticated, service_role;
