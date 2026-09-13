-- AdsForecast baseline schema on Supabase Postgres
-- Mirrors the existing Prisma models and keeps API contracts stable.

create extension if not exists pgcrypto;

create type public.workspace_role as enum ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
create type public.connection_provider as enum ('META_ADS', 'WOOCOMMERCE', 'SHOPIFY');
create type public.connection_status as enum ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'SYNCING');
create type public.sync_job_type as enum ('FULL', 'INCREMENTAL', 'WEBHOOK');
create type public.sync_job_status as enum ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

create table if not exists public.users (
  id text primary key default ('usr_' || encode(extensions.gen_random_bytes(10), 'hex')),
  auth_user_id uuid unique,
  email text not null unique,
  password_hash text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id text primary key default ('ws_' || encode(extensions.gen_random_bytes(10), 'hex')),
  name text not null,
  slug text not null unique,
  default_currency text not null default 'USD',
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id text primary key default ('wsm_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  role public.workspace_role not null default 'MEMBER',
  created_at timestamptz not null default now(),
  unique(workspace_id, user_id)
);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);

create table if not exists public.connections (
  id text primary key default ('con_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider public.connection_provider not null,
  status public.connection_status not null default 'DISCONNECTED',
  display_label text,
  external_ref text,
  secret_encrypted bytea,
  token_type text,
  token_expires_at timestamptz,
  currency text,
  timezone_name text,
  connected_at timestamptz,
  last_success_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider)
);
create index if not exists connections_workspace_id_idx on public.connections(workspace_id);

create table if not exists public.meta_sync_logs (
  id text primary key default ('msl_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  meta_connection_id text not null references public.connections(id) on delete cascade,
  type text not null default 'CAMPAIGN_INSIGHTS',
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists meta_sync_logs_workspace_id_idx on public.meta_sync_logs(workspace_id);
create index if not exists meta_sync_logs_connection_id_idx on public.meta_sync_logs(meta_connection_id);

create table if not exists public.sync_jobs (
  id text primary key default ('syn_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  connection_id text references public.connections(id) on delete set null,
  job_type public.sync_job_type not null,
  status public.sync_job_status not null default 'PENDING',
  cursor_before text,
  cursor_after text,
  error_payload jsonb,
  row_counts jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sync_jobs_workspace_id_idx on public.sync_jobs(workspace_id);
create index if not exists sync_jobs_connection_id_idx on public.sync_jobs(connection_id);

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.connections enable row level security;
alter table public.meta_sync_logs enable row level security;
alter table public.sync_jobs enable row level security;

-- Keep RLS strict for client access; edge functions use service role key.
drop policy if exists "users_self_select" on public.users;
create policy "users_self_select"
on public.users for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "workspace_members_select_own" on public.workspace_members;
create policy "workspace_members_select_own"
on public.workspace_members for select
to authenticated
using (
  user_id in (
    select u.id from public.users u where u.auth_user_id = auth.uid()
  )
);
