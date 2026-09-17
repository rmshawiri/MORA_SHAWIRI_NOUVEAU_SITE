-- =============================================================================
-- MORA SHAWIRI — Migration 0002
-- Domaine SYSTÈME : paramètres administrables, journal d'audit, compteurs de
-- limitation de fréquence.
--
-- Références :
--   07_ARCHITECTURE_TECHNIQUE/01_ARCHITECTURE_BASE_DE_DONNEES.md § 88-93, § 231
--   07_ARCHITECTURE_TECHNIQUE/03_SECURITE.md                     § 30, § 114-116
--   09_ADMINISTRATION/10_PARAMETRES.md                           § 32-34
--   10_DEPLOIEMENT/00_SUPABASE.md                                § 71-72, § 87-89
--
-- Règle tenue sans exception : aucun secret dans la base. Les clés et jetons
-- restent dans les variables d'environnement (§ 93 et § 89).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PARAMÈTRES ADMINISTRABLES
--
-- Un paramètre est une donnée, pas du code (§ 91). Deux portées :
--   * `PUBLIC` — lisible par un visiteur anonyme (devise, fuseau horaire) ;
--   * `PRIVE`  — réservé aux comptes disposant de `settings.view`.
-- -----------------------------------------------------------------------------

create table if not exists public.settings (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  value        jsonb not null,
  scope        text not null default 'PRIVE' check (scope in ('PUBLIC', 'PRIVE')),
  label        text not null,
  description  text,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.settings is
  'Paramètres administrables de la plateforme. Ne contient jamais de secret : clés et jetons restent en variables d''environnement.';
comment on column public.settings.scope is
  'PUBLIC : lisible sans authentification. PRIVE : nécessite la permission settings.view.';

create index if not exists settings_scope_idx on public.settings (scope);

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- Garde-fou : une valeur de paramètre ne doit jamais ressembler à un secret.
-- Le contrôle est volontairement grossier — il attrape l'erreur d'inattention,
-- pas un adversaire déterminé — mais il documente et fait respecter la règle.
create or replace function public.tg_settings_reject_secrets()
returns trigger
language plpgsql
as $$
begin
  if new.key ~ '(secret|password|token|api_key|private_key|passphrase)' then
    raise exception 'Un secret ne se stocke pas dans `settings` : utiliser les variables d''environnement'
      using errcode = '22023';
  end if;

  if jsonb_typeof(new.value) = 'string'
     and (new.value #>> '{}') ~ '^(sb_secret_|sbp_|eyJ[A-Za-z0-9_-]{10,}\.|ghp_|vercel_)'
  then
    raise exception 'La valeur ressemble à un jeton ou à une clé : stockage refusé'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists settings_reject_secrets on public.settings;
create trigger settings_reject_secrets
  before insert or update on public.settings
  for each row execute function public.tg_settings_reject_secrets();


-- -----------------------------------------------------------------------------
-- 2. JOURNAL D'AUDIT
--
-- Append-only. Aucune politique `update` ni `delete` n'est écrite : un journal
-- d'audit modifiable ne prouve rien. L'écriture passe exclusivement par la
-- fonction `public.record_audit_event()` ou par la clé `service_role`.
-- -----------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id             bigint generated always as identity primary key,

  actor_id       uuid references auth.users (id) on delete set null,
  -- Instantané de l'identifiant de l'auteur : l'historique reste lisible même
  -- après suppression du compte (§ 72 des rôles et permissions).
  actor_label    text,

  action         text not null,
  resource_type  text,
  resource_id    text,

  result         text not null default 'SUCCES'
                   check (result in ('SUCCES', 'REFUS', 'ECHEC')),

  -- Contexte technique strictement nécessaire. Ne doit contenir ni mot de
  -- passe, ni jeton, ni secret (§ 116 de la sécurité).
  metadata       jsonb not null default '{}'::jsonb,

  ip_address     inet,
  user_agent     text,

  created_at     timestamptz not null default now()
);

comment on table public.audit_logs is
  'Journal d''audit en ajout seul des actions sensibles. Ne contient jamais de mot de passe, de jeton ni de secret.';

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx      on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_resource_idx   on public.audit_logs (resource_type, resource_id);

-- Même filet que pour les paramètres : refuser un enregistrement dont les
-- métadonnées transportent visiblement un secret.
create or replace function public.tg_audit_logs_reject_secrets()
returns trigger
language plpgsql
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(new.metadata) loop
    if v_key ~* '(password|mot_de_passe|secret|token|jeton|api_key|authorization)' then
      raise exception 'Métadonnée interdite dans le journal d''audit : %', v_key
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists audit_logs_reject_secrets on public.audit_logs;
create trigger audit_logs_reject_secrets
  before insert on public.audit_logs
  for each row execute function public.tg_audit_logs_reject_secrets();

-- Écriture contrôlée : l'auteur est toujours le compte connecté, jamais une
-- valeur fournie par l'appelant. Empêche l'attribution d'une action à autrui.
create or replace function public.record_audit_event(
  p_action        text,
  p_resource_type text default null,
  p_resource_id   text default null,
  p_result        text default 'SUCCES',
  p_metadata      jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    bigint;
  v_label text;
begin
  select coalesce(pr.username, pr.full_name)
    into v_label
    from public.profiles pr
   where pr.id = auth.uid();

  insert into public.audit_logs (actor_id, actor_label, action, resource_type, resource_id, result, metadata)
  values (auth.uid(), v_label, p_action, p_resource_type, p_resource_id, p_result, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_audit_event(text, text, text, text, jsonb) is
  'Enregistre une action dans le journal d''audit en attribuant systématiquement l''action au compte connecté.';

revoke execute on function public.record_audit_event(text, text, text, text, jsonb) from public, anon;
grant  execute on function public.record_audit_event(text, text, text, text, jsonb) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. LIMITATION DE FRÉQUENCE PARTAGÉE
--
-- `src/lib/rate-limit.ts` compte en mémoire : sur Vercel, chaque instance a son
-- propre compteur, ce qui rend la limite contournable. Le rapport de phase 4
-- (§ 15) prévoit le passage à un compteur en base dès la présente phase.
-- La table est posée ici ; son branchement sur la connexion et la
-- réinitialisation de mot de passe relève de la phase 4B.
-- -----------------------------------------------------------------------------

create table if not exists public.rate_limit_counters (
  -- Empreinte de l'identifiant limité (adresse IP, identifiant de connexion).
  -- L'empreinte est calculée côté serveur : la valeur brute n'est jamais
  -- stockée, ce qui évite de constituer un fichier d'adresses IP en clair.
  bucket        text not null,
  subject_hash  text not null,
  window_start  timestamptz not null,
  attempts      integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (bucket, subject_hash, window_start)
);

comment on table public.rate_limit_counters is
  'Compteurs de limitation de fréquence partagés entre instances. Ne stocke que des empreintes, jamais l''identifiant brut.';

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);


-- -----------------------------------------------------------------------------
-- 4. PRIVILÈGES DE TABLE
-- -----------------------------------------------------------------------------

revoke all on public.settings             from anon, authenticated;
revoke all on public.audit_logs           from anon, authenticated;
revoke all on public.rate_limit_counters  from anon, authenticated;

grant select          on public.settings   to anon, authenticated;
grant insert, update  on public.settings   to authenticated;
grant select          on public.audit_logs to authenticated;

-- `rate_limit_counters` reste entièrement hors de portée des rôles applicatifs :
-- seul le serveur, via la clé `service_role`, y écrit. Un compteur qu'un client
-- peut remettre à zéro ne limite rien.


-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

alter table public.settings            enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.rate_limit_counters enable row level security;

-- 5.1 — PARAMÈTRES
drop policy if exists settings_select_public on public.settings;
create policy settings_select_public
  on public.settings for select to anon, authenticated
  using (scope = 'PUBLIC');

drop policy if exists settings_select_private on public.settings;
create policy settings_select_private
  on public.settings for select to authenticated
  using (public.has_permission('settings.view'));

drop policy if exists settings_insert_authorised on public.settings;
create policy settings_insert_authorised
  on public.settings for insert to authenticated
  with check (public.has_permission('settings.update'));

drop policy if exists settings_update_authorised on public.settings;
create policy settings_update_authorised
  on public.settings for update to authenticated
  using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

-- Aucune politique DELETE : un paramètre se corrige, il ne se supprime pas
-- depuis l'interface.


-- 5.2 — JOURNAL D'AUDIT
drop policy if exists audit_logs_select_authorised on public.audit_logs;
create policy audit_logs_select_authorised
  on public.audit_logs for select to authenticated
  using (public.has_permission('audit.view'));

-- Aucune politique INSERT, UPDATE ou DELETE. L'écriture passe par
-- `public.record_audit_event()` (SECURITY DEFINER) ou par la clé `service_role`.
-- Le journal est donc inaltérable depuis l'application.


-- 5.3 — COMPTEURS DE LIMITATION
-- Aucune politique : RLS activée sans politique équivaut à un refus total pour
-- `anon` et `authenticated`. Seule la clé `service_role` accède à la table.


-- -----------------------------------------------------------------------------
-- 6. PARAMÈTRES INITIAUX
--
-- Uniquement ce que les documents établissent, ou ce qui enregistre une
-- décision encore ouverte dans sa position la plus sûre. Aucune valeur
-- commerciale n'est figée ici.
-- -----------------------------------------------------------------------------

insert into public.settings (key, value, scope, label, description) values
  ('site.timezone', '"Indian/Comoro"'::jsonb, 'PUBLIC',
   'Fuseau horaire',
   'Fuseau horaire de référence de la plateforme (09_ADMINISTRATION/10_PARAMETRES.md § 32).'),

  ('site.currency', '"KMF"'::jsonb, 'PUBLIC',
   'Devise principale',
   'Devise principale (09_ADMINISTRATION/10_PARAMETRES.md § 33).'),

  ('auth.public_registration_enabled', 'false'::jsonb, 'PRIVE',
   'Inscription publique des clients',
   'Décision D-9 non tranchée : fermée par défaut, conformément au refus par défaut.'),

  ('auth.admin_mfa_required', 'false'::jsonb, 'PRIVE',
   'MFA obligatoire pour les administrateurs',
   'Décision D-12 non tranchée. Le paramètre existe pour être activé sans modification de code.'),

  ('affiliation.program_enabled', 'false'::jsonb, 'PRIVE',
   'Programme d''affiliation actif',
   'Décision D-1 non tranchée : le moteur d''affiliation reste inactif tant que les taux ne sont pas arbitrés.')
on conflict (key) do update
  set scope       = excluded.scope,
      label       = excluded.label,
      description = excluded.description;
-- `value` n'est volontairement pas réécrite : rejouer la migration ne doit
-- jamais écraser un réglage décidé depuis l'administration.
