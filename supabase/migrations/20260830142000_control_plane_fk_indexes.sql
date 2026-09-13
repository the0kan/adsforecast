-- Cover foreign keys used by launch-readiness control-plane joins and deletes.
-- Archive-only tables intentionally retain their existing indexes for recovery.

create index if not exists workspace_settings_updated_by_idx
  on public.workspace_settings (updated_by);

create index if not exists workspace_subscriptions_plan_id_idx
  on public.workspace_subscriptions (plan_id);

create index if not exists workspace_subscriptions_draft_plan_id_idx
  on public.workspace_subscriptions (draft_plan_id);

create index if not exists support_tickets_created_by_idx
  on public.support_tickets (created_by);

create index if not exists support_tickets_assigned_admin_idx
  on public.support_tickets (assigned_admin_id);

create index if not exists support_ticket_messages_author_idx
  on public.support_ticket_messages (author_user_id);

create index if not exists platform_admins_created_by_idx
  on public.platform_admins (created_by);

create index if not exists platform_settings_updated_by_idx
  on public.platform_settings (updated_by);
