-- AdsForecast v2: data-preserving migration from the legacy Prisma-shaped schema.
--
-- IMPORTANT: legacy tables are renamed, never dropped. Rows that can be mapped
-- safely are copied into the v2 tables. Legacy Meta tokens stay in the archived
-- connection table because their binary encryption format is not compatible with
-- the v2 Edge Function format; users reconnect Meta once after this migration.

begin;

create extension if not exists pgcrypto;

-- Archive the v1 tables. Keeping them makes rollback/data recovery possible.
alter table if exists public.sync_jobs rename to sync_jobs_v1_archive;
alter table if exists public.meta_sync_logs rename to meta_sync_logs_v1_archive;
alter table if exists public.connections rename to connections_v1_archive;
alter table if exists public.workspace_members rename to workspace_members_v1_archive;
alter table if exists public.workspaces rename to workspaces_v1_archive;
alter table if exists public.users rename to users_v1_archive;

-- Free the old index names before creating the canonical v2 indexes.
alter index if exists public.workspace_members_user_id_idx
  rename to workspace_members_user_id_v1_archive_idx;
alter index if exists public.connections_workspace_id_idx
  rename to connections_workspace_id_v1_archive_idx;
alter index if exists public.meta_sync_logs_workspace_id_idx
  rename to meta_sync_logs_workspace_id_v1_archive_idx;
alter index if exists public.meta_sync_logs_connection_id_idx
  rename to meta_sync_logs_connection_id_v1_archive_idx;
alter index if exists public.sync_jobs_workspace_id_idx
  rename to sync_jobs_workspace_id_v1_archive_idx;
alter index if exists public.sync_jobs_connection_id_idx
  rename to sync_jobs_connection_id_v1_archive_idx;

create table if not exists public.app_users (
  id text primary key default ('usr_' || encode(extensions.gen_random_bytes(10), 'hex')),
  auth_user_id uuid unique not null references auth.users (id) on delete cascade,
  email text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id text primary key default ('ws_' || encode(extensions.gen_random_bytes(10), 'hex')),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id text primary key default ('wsm_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  user_id text not null references public.app_users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id);

create table if not exists public.meta_connections (
  id text primary key default ('mc_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  access_token_encrypted text not null,
  token_type text,
  token_expires_at timestamptz,
  account_id text,
  account_name text,
  currency text,
  timezone_name text,
  status text not null default 'connected',
  connected_at timestamptz default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create index if not exists meta_connections_workspace_id_idx
  on public.meta_connections (workspace_id);

create table if not exists public.meta_sync_logs (
  id text primary key default ('msl_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  status text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists meta_sync_logs_workspace_id_idx
  on public.meta_sync_logs (workspace_id);

-- Preserve all compatible user/workspace/membership data from v1.
insert into public.app_users (
  id, auth_user_id, email, name, created_at, updated_at
)
select id, auth_user_id, email, name, created_at, updated_at
from public.users_v1_archive
where auth_user_id is not null
on conflict (id) do nothing;

insert into public.workspaces (id, name, created_at, updated_at)
select id, name, created_at, updated_at
from public.workspaces_v1_archive
on conflict (id) do nothing;

insert into public.workspace_members (
  id, workspace_id, user_id, role, created_at
)
select
  m.id,
  m.workspace_id,
  m.user_id,
  lower(m.role::text),
  m.created_at
from public.workspace_members_v1_archive m
join public.app_users u on u.id = m.user_id
join public.workspaces w on w.id = m.workspace_id
on conflict (workspace_id, user_id) do nothing;

alter table public.app_users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.meta_connections enable row level security;
alter table public.meta_sync_logs enable row level security;

-- Browser clients do not access these tables directly. Edge Functions use the
-- service role and therefore bypass RLS.
revoke all on public.app_users from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.meta_connections from anon, authenticated;
revoke all on public.meta_sync_logs from anon, authenticated;

commit;
