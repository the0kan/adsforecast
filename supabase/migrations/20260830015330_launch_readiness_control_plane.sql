begin;

create table if not exists public.user_profiles (
  user_id text primary key references public.app_users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  company_name text not null default '' check (char_length(company_name) <= 120),
  role_title text not null default '' check (char_length(role_title) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  locale text not null default 'en-US' check (char_length(locale) between 2 and 20),
  avatar_url text,
  onboarding_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_settings (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  timezone text not null default 'Europe/Warsaw' check (char_length(timezone) between 3 and 80),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  default_period text not null default '30d' check (default_period in ('today', '7d', '30d', '90d')),
  compact_mode boolean not null default false,
  profit_model jsonb not null default '{"cogs":55,"fulfillment":7,"fees":3}'::jsonb,
  notifications jsonb not null default '{"analysisReady":true,"performanceRisk":true,"weeklyDigest":true,"productUpdates":false,"supportReplies":true,"billingEvents":true}'::jsonb,
  data_retention_days integer not null default 395 check (data_retention_days between 30 and 1825),
  updated_by text references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_catalog (
  id text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  tagline text not null check (char_length(tagline) between 10 and 180),
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents integer not null check (annual_price_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb,
  stripe_product_id text,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  recommended boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_subscriptions (
  workspace_id text primary key references public.workspaces (id) on delete cascade,
  plan_id text references public.plan_catalog (id) on delete set null,
  draft_plan_id text references public.plan_catalog (id) on delete set null,
  provider text not null default 'stripe' check (provider = 'stripe'),
  status text not null default 'inactive' check (status in ('inactive', 'draft', 'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  cadence text check (cadence in ('monthly', 'annual')),
  draft_cadence text check (draft_cadence in ('monthly', 'annual')),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_product_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  checkout_selected_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_subscriptions_customer_uidx
  on public.workspace_subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists workspace_subscriptions_subscription_uidx
  on public.workspace_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;
create index if not exists workspace_subscriptions_status_idx
  on public.workspace_subscriptions (status, updated_at desc);

create table if not exists public.billing_events (
  id text primary key default ('bev_' || encode(extensions.gen_random_bytes(10), 'hex')),
  provider_event_id text not null unique,
  workspace_id text references public.workspaces (id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  safe_summary jsonb not null default '{}'::jsonb,
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists billing_events_workspace_received_idx
  on public.billing_events (workspace_id, received_at desc);

create table if not exists public.support_tickets (
  id text primary key default ('tkt_' || encode(extensions.gen_random_bytes(10), 'hex')),
  workspace_id text not null references public.workspaces (id) on delete cascade,
  created_by text not null references public.app_users (id) on delete restrict,
  subject text not null check (char_length(subject) between 5 and 160),
  category text not null default 'product' check (category in ('product', 'meta', 'billing', 'account', 'bug', 'feedback', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'waiting_customer', 'in_progress', 'resolved', 'closed')),
  assigned_admin_id text references public.app_users (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_workspace_activity_idx
  on public.support_tickets (workspace_id, last_activity_at desc);
create index if not exists support_tickets_status_priority_idx
  on public.support_tickets (status, priority, last_activity_at desc);

create table if not exists public.support_ticket_messages (
  id text primary key default ('tkm_' || encode(extensions.gen_random_bytes(10), 'hex')),
  ticket_id text not null references public.support_tickets (id) on delete cascade,
  author_user_id text references public.app_users (id) on delete set null,
  author_kind text not null check (author_kind in ('customer', 'admin', 'system')),
  body text not null check (char_length(body) between 2 and 5000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at asc);

create table if not exists public.platform_admins (
  user_id text primary key references public.app_users (id) on delete cascade,
  role text not null default 'operator' check (role in ('super_admin', 'billing_admin', 'support_admin', 'operator', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by text references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id text primary key default ('aal_' || encode(extensions.gen_random_bytes(10), 'hex')),
  admin_user_id text not null references public.app_users (id) on delete restrict,
  action text not null check (char_length(action) between 3 and 120),
  target_type text not null check (char_length(target_type) between 2 and 60),
  target_id text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_admin_created_idx
  on public.admin_audit_logs (admin_user_id, created_at desc);

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z0-9_.-]{2,80}$'),
  value jsonb not null default '{}'::jsonb,
  description text not null default '' check (char_length(description) <= 300),
  updated_by text references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.ai_analysis_runs
  add column if not exists analysis_payload jsonb not null default '{}'::jsonb;

insert into public.plan_catalog (
  id, name, tagline, monthly_price_cents, annual_price_cents, currency, limits, features, recommended, sort_order
) values
  (
    'starter', 'Starter', 'For solo operators building a reliable paid-media profit habit.', 2900, 29000, 'USD',
    '{"metaAccounts":1,"teamSeats":1,"aiRunsMonthly":12,"historyMonths":3,"dataExports":"csv"}'::jsonb,
    '["Campaign performance workspace","Profitability and break-even model","Core AI decision brief","Daily, weekly and monthly reporting","CSV campaign export","Standard email support"]'::jsonb,
    false, 10
  ),
  (
    'growth', 'Growth', 'For growing teams making budget decisions every day.', 7900, 79000, 'USD',
    '{"metaAccounts":3,"teamSeats":5,"aiRunsMonthly":60,"historyMonths":13,"dataExports":"advanced"}'::jsonb,
    '["Everything in Starter","Five-layer AI Analyst","Custom reporting periods","Advanced decision filters","Downloadable decision briefs","Priority support"]'::jsonb,
    true, 20
  ),
  (
    'scale', 'Scale', 'For agencies and multi-account commerce operations.', 17900, 179000, 'USD',
    '{"metaAccounts":10,"teamSeats":15,"aiRunsMonthly":250,"historyMonths":24,"dataExports":"advanced"}'::jsonb,
    '["Everything in Growth","Multi-account operating limits","Team and client-ready workflows","Extended analysis history","Advanced export capacity","Priority escalation support"]'::jsonb,
    false, 30
  )
on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents,
  currency = excluded.currency,
  limits = excluded.limits,
  features = excluded.features,
  recommended = excluded.recommended,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.user_profiles (user_id, display_name)
select id, coalesce(nullif(name, ''), split_part(email, '@', 1))
from public.app_users
on conflict (user_id) do nothing;

insert into public.workspace_settings (workspace_id, updated_by)
select m.workspace_id, m.user_id
from public.workspace_members m
where m.role = 'owner'
on conflict (workspace_id) do nothing;

-- The current pre-launch project has one verified launch owner. Global admin
-- access is explicit and must never be inferred from workspace ownership.
insert into public.platform_admins (user_id, role, created_by)
select id, 'super_admin', id
from public.app_users
where id = 'usr_cdfa705ccf4d4862a2328ccecb1eb2e8'
on conflict (user_id) do nothing;

insert into public.platform_settings (key, value, description)
values
  ('billing.mode', '{"provider":"stripe","enabled":false}'::jsonb, 'Stripe remains disabled until server secrets and plan price IDs are configured.'),
  ('support.sla', '{"normalHours":24,"highHours":8,"urgentHours":2}'::jsonb, 'Target first-response windows shown in the operator console.'),
  ('launch.state', '{"customerAccess":"private_beta"}'::jsonb, 'Customer access stage used by the admin readiness view.')
on conflict (key) do nothing;

alter table public.user_profiles enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.plan_catalog enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.platform_admins enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.platform_settings enable row level security;

revoke all on public.user_profiles from anon, authenticated;
revoke all on public.workspace_settings from anon, authenticated;
revoke all on public.plan_catalog from anon, authenticated;
revoke all on public.workspace_subscriptions from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_ticket_messages from anon, authenticated;
revoke all on public.platform_admins from anon, authenticated;
revoke all on public.admin_audit_logs from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;

grant all on public.user_profiles to service_role;
grant all on public.workspace_settings to service_role;
grant all on public.plan_catalog to service_role;
grant all on public.workspace_subscriptions to service_role;
grant all on public.billing_events to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_ticket_messages to service_role;
grant all on public.platform_admins to service_role;
grant all on public.admin_audit_logs to service_role;
grant all on public.platform_settings to service_role;

commit;
