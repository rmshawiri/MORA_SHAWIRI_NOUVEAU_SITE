-- ============================================================
--  MORA Shawiri — Migration initiale (0001_init)
--  Base de données Supabase / PostgreSQL
--  Principe : source de vérité = code + migrations, moindre privilège,
--  RLS sur toute donnée sensible, données publiques en lecture contrôlée.
-- ============================================================

-- Extensions utiles
create extension if not exists "pgcrypto";        -- gen_random_uuid()
create extension if not exists "citext";          -- emails insensibles à la casse

-- ------------------------------------------------------------
-- 1) PROFILS & ROLES
-- ------------------------------------------------------------
-- Profil applicatif (complémentaire à auth.users, géré via trigger).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   citext unique,
  email      citext unique,
  first_name text,
  last_name  text,
  phone      text,
  avatar_url text,
  status     text not null default 'active' check (status in ('active','suspended','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rôles & permissions (RBAC extensible, multi-rôles)
create table if not exists public.roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,             -- ADMIN, CLIENT, AFFILIE, SUPER_ADMIN, ...
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.permissions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,             -- services.view, orders.update, ...
  description text
);
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (user_id, role_id)
);
create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ------------------------------------------------------------
-- 2) CATALOGUE
-- ------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  type       text not null check (type in ('service','product','content')),
  description text,
  image_url  text,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  category_id    uuid references public.categories(id),
  summary        text,
  description    text,
  image_url      text,
  price          numeric,                      -- NULL si sur devis
  price_type     text not null default 'quote' check (price_type in ('fixed','quote','unit')),
  price_unit     text,                          -- 'image', 'visuel', 'pack', ...
  cta_primary    text,
  cta_secondary  text,
  direct_purchase boolean not null default false,
  appointment_available boolean not null default false,
  affiliate_eligible boolean not null default false,
  status         text not null default 'active' check (status in ('active','draft','suspended','archived')),
  sort_order     int not null default 0,
  meta_title     text,
  meta_description text,
  is_featured    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  category_id    uuid references public.categories(id),
  summary        text,
  description    text,
  image_url      text,
  price          numeric,
  compare_at_price numeric,
  type           text not null default 'digital' check (type in ('digital','physical','service','pack')),
  status         text not null default 'draft' check (status in ('draft','published','available','unavailable','out_of_stock','archived')),
  stock_quantity integer,
  is_affiliate_eligible boolean not null default false,
  meta_title     text,
  meta_description text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create table if not exists public.product_files (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  file_key    text not null,                   -- clé de stockage Supabase (privé)
  file_name   text,
  mime_type   text,
  size_bytes  bigint,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3) COMMERCE
-- ------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references auth.users(id),   -- NULL si prospect invité
  customer_email text,
  customer_name  text,
  order_number   text not null unique,             -- CMD-...
  status         text not null default 'pending' check (status in ('new','pending','awaiting_payment','paid','confirmed','processing','completed','cancelled','refunded','partially_refunded')),
  currency       text not null default 'KMF',
  subtotal       numeric not null default 0,
  discount       numeric not null default 0,
  total          numeric not null default 0,
  payment_method text,                             -- mvola | holo | wakati | virement | paiement-en-ligne
  payment_status text not null default 'pending' check (payment_status in ('pending','initiated','in_review','paid','failed','cancelled','refunded','partially_refunded')),
  affiliate_code text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  ref_type      text not null check (ref_type in ('service','product')),
  ref_id        uuid not null,
  name          text not null,                 -- snapshot
  unit_price    numeric not null,              -- snapshot
  quantity      integer not null default 1,
  line_total    numeric not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  method          text not null,
  amount          numeric not null,
  currency        text not null default 'KMF',
  status          text not null default 'pending' check (status in ('pending','initiated','in_review','paid','failed','cancelled','refunded','partially_refunded')),
  provider_ref    text,
  proof_url       text,                          -- preuve fournie par le client (déclaration)
  verified_by     uuid references auth.users(id),
  verified_at     timestamptz,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.refunds (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid references public.payments(id),
  order_id    uuid references public.orders(id),
  amount      numeric not null,
  currency    text not null default 'KMF',
  status      text not null default 'pending' check (status in ('pending','approved','rejected','processed')),
  reason      text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4) RELATION CLIENT — DEVIS & RENDEZ-VOUS
-- ------------------------------------------------------------
create table if not exists public.quote_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id),  -- NULL si prospect
  service_id    uuid references public.services(id),
  contact_name  text not null,
  contact_phone text,
  contact_email text,
  status        text not null default 'new' check (status in ('new','analyzing','info_requested','appointment_to_plan','appointment_scheduled','proposal_sent','quote_sent','awaiting_validation','accepted','refused','completed','archived')),
  payload       jsonb,                            -- réponses structurées du formulaire conversationnel
  free_message  text,                             -- champ libre obligatoire
  reference     text,                             -- MORA-[TYPE]-[SÉRIE][NUMÉRO] (moteur de documents)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.appointment_availabilities (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  is_booked  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id),      -- NULL si prospect
  service_id uuid references public.services(id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  timezone   text not null default 'Indian/Comoro',
  status     text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5) AFFILIATION
-- ------------------------------------------------------------
create table if not exists public.affiliates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category      text not null check (category in ('particulier','influenceur','equipe')),
  code          text not null unique,             -- code / lien affilié
  status        text not null default 'pending' check (status in ('pending','active','suspended','disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.commission_rules (
  id           uuid primary key default gen_random_uuid(),
  category     text not null unique check (category in ('particulier','influenceur','equipe')),
  rate         numeric not null,                  -- 0.10 / 0.15 / 0.20
  description  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.commissions (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliates(id) on delete cascade,
  order_id      uuid not null references public.orders(id) on delete cascade,
  rate_applied  numeric not null,                 -- snapshot
  base_amount   numeric not null,                 -- snapshot (montant réellement encaissé)
  amount        numeric not null,                 -- snapshot
  status        text not null default 'pending' check (status in ('pending','validated','payable','paid','cancelled','adjusted','blocked','refused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (affiliate_id, order_id)
);

create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.affiliates(id) on delete cascade,
  amount        numeric not null,
  status        text not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6) CONTENU & MÉDIAS
-- ------------------------------------------------------------
create table if not exists public.pages (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  slug           text not null unique,
  content        text,
  status         text not null default 'draft' check (status in ('draft','published','unpublished')),
  meta_title     text,
  meta_description text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.faqs (
  id        uuid primary key default gen_random_uuid(),
  question  text not null,
  answer    text not null,
  category  text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  storage_key text not null,
  mime_type   text,
  size_bytes  bigint,
  width       int,
  height      int,
  alt_text    text,
  owner_id    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7) SYSTÈME — NOTIFICATIONS, AUDIT, PARAMÈTRES
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  title      text not null,
  content    text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users(id),
  action     text not null,
  resource   text,
  resource_id text,
  result     text,
  context    jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id         text primary key,                    -- clé logique (ex: site_name, site_url, home_hero_image)
  value      jsonb not null,
  is_public  boolean not null default false,      -- PUBLIC = exposable ; secrets jamais ici
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8) INDEX (colonnes fréquemment filtrées / recherchées)
-- ------------------------------------------------------------
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_commissions_affiliate on public.commissions(affiliate_id);
create index if not exists idx_commissions_order on public.commissions(order_id);
create index if not exists idx_appointments_starts on public.appointments(starts_at);
create index if not exists idx_quote_requests_service on public.quote_requests(service_id);
create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_services_slug on public.services(slug);

-- ------------------------------------------------------------
-- 9) ROW LEVEL SECURITY (moindre privilège)
--    Politiques par évaluation explicite : les données privées ne sont
--    jamais exposées publiquement ; un utilisateur ne voit que les siennes.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.product_files enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.quote_requests enable row level security;
alter table public.appointment_availabilities enable row level security;
alter table public.appointments enable row level security;
alter table public.affiliates enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commissions enable row level security;
alter table public.payouts enable row level security;
alter table public.pages enable row level security;
alter table public.faqs enable row level security;
alter table public.media enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;

-- Rendre la migration relançable : suppression des politiques existantes.
drop policy if exists "services public read" on public.services;
drop policy if exists "products public read" on public.products;
drop policy if exists "categories public read" on public.categories;
drop policy if exists "pages public read" on public.pages;
drop policy if exists "faqs public read" on public.faqs;
drop policy if exists "settings public read" on public.settings;
drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "profiles own insert" on public.profiles;
drop policy if exists "orders own select" on public.orders;
drop policy if exists "order_items own select" on public.order_items;
drop policy if exists "payments own select" on public.payments;
drop policy if exists "quote_requests own select" on public.quote_requests;
drop policy if exists "appointments own select" on public.appointments;
drop policy if exists "affiliates own select" on public.affiliates;
drop policy if exists "commissions own select" on public.commissions;
drop policy if exists "notifications own select" on public.notifications;
drop policy if exists "notifications own update" on public.notifications;

-- Données PUBLIQUES : lecture libre pour les entités publiées.
create policy "services public read" on public.services
  for select using (status = 'active');
create policy "products public read" on public.products
  for select using (status in ('published','available'));
create policy "categories public read" on public.categories
  for select using (is_active = true);
create policy "pages public read" on public.pages
  for select using (status = 'published');
create policy "faqs public read" on public.faqs
  for select using (is_active = true);
create policy "settings public read" on public.settings
  for select using (is_public = true);

-- PROFIL : lecture/écriture par l'utilisateur (et admin via service_role).
create policy "profiles own select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles own update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles own insert" on public.profiles
  for insert with check (auth.uid() = id);

-- COMMANDES : un client ne voit que les siennes ; les admins ont un accès dédié.
create policy "orders own select" on public.orders
  for select using (auth.uid() = customer_id);
create policy "order_items own select" on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
  );
create policy "payments own select" on public.payments
  for select using (
    exists (select 1 from public.orders o where o.id = payments.order_id and o.customer_id = auth.uid())
  );

-- DEVIS : le client ne voit que les siens.
create policy "quote_requests own select" on public.quote_requests
  for select using (auth.uid() = user_id);

-- RENDEZ-VOUS : le client ne voit que les siens.
create policy "appointments own select" on public.appointments
  for select using (auth.uid() = user_id);

-- AFFILIÉ : il ne consulte que ses propres données d'affiliation.
create policy "affiliates own select" on public.affiliates
  for select using (auth.uid() = user_id);
create policy "commissions own select" on public.commissions
  for select using (
    exists (select 1 from public.affiliates a where a.id = commissions.affiliate_id and a.user_id = auth.uid())
  );

-- NOTIFICATIONS : un utilisateur ne voit que les siennes.
create policy "notifications own select" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notifications own update" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 10) DONNÉES INITIALES (seed) — valeurs réelles documentées
--     (les mots de passe/admin sont injectés par un mécanisme sécurisé, jamais ici)
-- ------------------------------------------------------------
insert into public.roles (name, description, is_default) values
  ('CLIENT', 'Client utilisant les services de la plateforme', true),
  ('AFFILIE', 'Participant au programme d''affiliation', false),
  ('ADMIN', 'Administrateur', false),
  ('SUPER_ADMIN', 'Administrateur principal (permissions critiques)', false)
on conflict (name) do nothing;

insert into public.commission_rules (category, rate, description) values
  ('particulier', 0.10, 'Commission particuliers : 10 %'),
  ('influenceur', 0.15, 'Commission influenceurs : 15 %'),
  ('equipe',     0.20, 'Commission membres de l''équipe MORA Shawiri : 20 %')
on conflict (category) do nothing;

insert into public.settings (id, value, is_public) values
  ('site_name', '"MORA Shawiri"', true),
  ('site_slogan', '"Le Choix Optimal pour votre performance"', true),
  ('site_url', (format('"%s"', coalesce(current_setting('app.site_url', true), 'http://localhost:3000')))::jsonb, true),
  ('site_email', '"contact@morashawiri.com"', true),
  ('site_phone', '"+269 430 63 06"', true),
  ('site_whatsapp', '"https://wa.me/2694306306"', true),
  ('site_address', '"Moroni, Magoudjou, en face de MAG Market"', true),
  ('home_hero_image', 'null', true),
  ('services_hero_image', 'null', true),
  ('boutique_hero_image', 'null', true),
  ('contact_image', 'null', true)
on conflict (id) do nothing;
