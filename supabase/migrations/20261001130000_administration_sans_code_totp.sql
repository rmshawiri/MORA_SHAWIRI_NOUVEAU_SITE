-- =============================================================================
-- ADMINISTRATION SANS CODE TOTP (décision propriétaire du 1er octobre 2026)
--
-- Décision, qui révise D-12 :
--
--   « L'administration utilise une authentification par identifiant/e-mail +
--     mot de passe. Le TOTP n'est pas obligatoire pour l'utilisation normale de
--     l'administration ni pour les opérations administratives autorisées. Les
--     actions sensibles utilisent des confirmations explicites dans
--     l'interface, tandis que leur sécurité réelle repose sur les permissions
--     serveur, RLS, contrôles critiques et journalisation. »
--
-- Une confirmation dans l'interface n'est PAS une seconde authentification.
--
-- ## Inventaire des exigences AAL2 avant cette migration
--
--   Application, gouvernée par le réglage D-12 :
--     A. entrée dans l'administration, et code demandé après le mot de passe.
--   Base, exigence inconditionnelle `session_is_aal2()` :
--     C. `issue_document()` — toute pièce émise : DVCL, CMCL, FACL ;
--     D. `confirm_appointment()` — confirmation d'un rendez-vous (RVCL) ;
--     E. `user_permissions` — octroi et retrait de permissions (3 politiques) ;
--     F. `admin_invitations` — invitation et révocation (2 politiques).
--   Application, hors de cette migration :
--     B. gérer ses propres facteurs TOTP quand on en a un. Supabase exige
--        lui-même l'AAL2 pour retirer un facteur vérifié : l'exigence reste,
--        cantonnée à la page « Double authentification », qui n'est sur aucun
--        parcours de travail.
--
-- ## Ce que fait cette migration
--
--   * `session_assurance_satisfied()` : vrai si la session est AAL2, OU si le
--     réglage D-12 n'exige pas de second facteur. Défaut prudent : exigé si le
--     réglage manque ;
--   * C, D, E, F l'emploient à la place de `session_is_aal2()`. Les corps de C
--     et D sont recopiés de leur dernière définition (migration 0008, 4F) ;
--     seule la condition change — un test le vérifie. Les politiques E et F
--     gardent leur permission (`admins.permissions`, `admins.create`) ;
--   * le réglage D-12 passe à `false`.
--
-- Ce qui ne change PAS : les permissions (refus par défaut, octroi nominatif,
-- permissions critiques dont `invoices.issue`), RLS, la propriété, le refus
-- de l'auto-élévation et la protection du dernier détenteur d'une permission
-- critique (déclencheurs de 4C), la journalisation, la limitation des
-- tentatives. Les facteurs déjà enrôlés sont conservés ; repasser le réglage à
-- `true` réimpose le code partout, sans modification de code.
--
-- Aucune migration antérieure n'est modifiée.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. LE NIVEAU D'ASSURANCE EXIGÉ, SELON LE RÉGLAGE D-12
-- -----------------------------------------------------------------------------

create or replace function public.session_assurance_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.session_is_aal2()
      or not coalesce(
           (select s.value = 'true'::jsonb
              from public.settings s
             where s.key = 'auth.admin_mfa_required'),
           true
         );
$fn$;

comment on function public.session_assurance_satisfied() is
  'Vrai si la session est AAL2, ou si le réglage auth.admin_mfa_required (D-12) n''exige pas de second facteur. Défaut prudent : exigé si le réglage manque. Ne remplace aucune permission : il s''ajoute à elles.';

revoke execute on function public.session_assurance_satisfied() from public;
grant  execute on function public.session_assurance_satisfied() to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. ÉMISSION DES PIÈCES — corps de la migration 0008, une condition changée
-- -----------------------------------------------------------------------------

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

    if not public.session_assurance_satisfied() then
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
  'Émet un document officiel : alloue l''identifiant et enregistre la pièce dans la même transaction. Seul chemin d''écriture dans public.documents. Refuse les codes de numérotation métier (4F). Niveau d''assurance : session_assurance_satisfied() (réglage D-12).';


-- -----------------------------------------------------------------------------
-- 3. CONFIRMATION D'UN RENDEZ-VOUS — corps de la migration 0008, une condition
--    changée
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

    if not public.session_assurance_satisfied() then
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
  'Confirme un rendez-vous : alloue sa référence (§ 43) et fixe le créneau ferme. La contrainte d''exclusion refuse tout chevauchement (§ 31). Niveau d''assurance : session_assurance_satisfied() (réglage D-12).';


-- -----------------------------------------------------------------------------
-- 4. GOUVERNANCE — mêmes politiques qu'en 4C, permission inchangée, niveau
--    d'assurance selon le réglage D-12
--
-- La permission reste la barrière : `admins.permissions` pour les droits,
-- `admins.create` pour les invitations. Les déclencheurs de 4C — aucun compte
-- ne modifie ses propres droits, le dernier détenteur d'une permission
-- critique ne la perd pas — ne dépendent d'aucun niveau d'assurance et
-- restent actifs.
-- -----------------------------------------------------------------------------

drop policy if exists user_permissions_insert_critical on public.user_permissions;
create policy user_permissions_insert_critical
  on public.user_permissions for insert to authenticated
  with check (public.has_permission('admins.permissions') and public.session_assurance_satisfied());

drop policy if exists user_permissions_update_critical on public.user_permissions;
create policy user_permissions_update_critical
  on public.user_permissions for update to authenticated
  using (public.has_permission('admins.permissions') and public.session_assurance_satisfied())
  with check (public.has_permission('admins.permissions') and public.session_assurance_satisfied());

drop policy if exists user_permissions_delete_critical on public.user_permissions;
create policy user_permissions_delete_critical
  on public.user_permissions for delete to authenticated
  using (public.has_permission('admins.permissions') and public.session_assurance_satisfied());

drop policy if exists admin_invitations_insert_authorised on public.admin_invitations;
create policy admin_invitations_insert_authorised
  on public.admin_invitations for insert to authenticated
  with check (public.has_permission('admins.create') and public.session_assurance_satisfied());

drop policy if exists admin_invitations_update_authorised on public.admin_invitations;
create policy admin_invitations_update_authorised
  on public.admin_invitations for update to authenticated
  using (public.has_permission('admins.create') and public.session_assurance_satisfied())
  with check (public.has_permission('admins.create') and public.session_assurance_satisfied());


-- -----------------------------------------------------------------------------
-- 5. LE RÉGLAGE D-12
--
-- `value` seule : libellé et description disent désormais ce que le réglage
-- gouverne réellement.
-- -----------------------------------------------------------------------------

update public.settings
   set value       = 'false'::jsonb,
       label       = 'Code TOTP exigé dans l''administration',
       description = 'Décision du 1er octobre 2026 : non. Connexion par identifiant ou e-mail et mot de passe ; aucune opération administrative autorisée n''exige de code. Les permissions, RLS et la journalisation restent la sécurité réelle. Repasser à true réimpose le code à la connexion et pour les opérations sensibles.',
       updated_at  = now()
 where key = 'auth.admin_mfa_required';
