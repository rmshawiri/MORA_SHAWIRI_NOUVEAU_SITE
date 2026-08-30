-- ============================================================
--  MORA Shawiri — Migration 0002 : Marketing & Popups
--  À appliquer dans Supabase Studio (SQL Editor) après 0001.
--  Idempotent (create table if not exists) + RLS.
-- ============================================================

-- Codes promotionnels
create table if not exists public.promo_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  discount_type text not null default 'percent' check (discount_type in ('percent','fixed')),
  value         numeric not null,               -- % (percent) ou montant KMF (fixed)
  valid_from    timestamptz,
  valid_until   timestamptz,
  min_amount    numeric,
  max_uses      integer,
  used_count    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Popups
create table if not exists public.popups (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text,
  type        text not null default 'banner' check (type in ('banner','modal','announcement')),
  is_active   boolean not null default false,
  priority    integer not null default 0,
  target_url  text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  frequency   text,                              -- ex: 'once', 'always', 'session'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_promo_codes_code on public.promo_codes(code);
create index if not exists idx_popups_active on public.popups(is_active);

alter table public.promo_codes enable row level security;
alter table public.popups enable row level security;

drop policy if exists "promo_codes admin all" on public.promo_codes;
create policy "promo_codes admin all" on public.promo_codes
  for all using (true) with check (true);

drop policy if exists "popups admin all" on public.popups;
create policy "popups admin all" on public.popups
  for all using (true) with check (true);
