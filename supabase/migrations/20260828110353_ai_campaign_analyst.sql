begin;

create table public.ai_analysis_runs (
  id text primary key default ('air_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  requested_by text not null references public.app_users (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  provider text not null default 'rules'
    check (provider in ('openai', 'rules')),
  model text,
  period_start date not null,
  period_end date not null,
  campaign_count integer not null default 0 check (campaign_count >= 0),
  executive_summary text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (period_start <= period_end)
);

create index ai_analysis_runs_workspace_created_idx
  on public.ai_analysis_runs (workspace_id, created_at desc);
create index ai_analysis_runs_requested_by_idx
  on public.ai_analysis_runs (requested_by);

create table public.ai_recommendations (
  id text primary key default ('airc_' || encode(extensions.gen_random_bytes(10), 'hex')),
  run_id text not null references public.ai_analysis_runs (id) on delete cascade,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  campaign_id text,
  campaign_name text,
  action text not null check (action in ('scale', 'hold', 'review', 'pause')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  title text not null,
  rationale text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_recommendations_run_idx
  on public.ai_recommendations (run_id);
create index ai_recommendations_workspace_created_idx
  on public.ai_recommendations (workspace_id, created_at desc);

alter table public.ai_analysis_runs enable row level security;
alter table public.ai_recommendations enable row level security;

-- These records are available only through authenticated Edge Functions,
-- which verify workspace membership before using the service role.
revoke all on public.ai_analysis_runs from anon, authenticated;
revoke all on public.ai_recommendations from anon, authenticated;

commit;
