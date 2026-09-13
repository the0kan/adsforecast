begin;

-- Archived v1 tables are retained only for disaster recovery and are never
-- queried by customer-facing code. Remove legacy authenticated policies so
-- archive scans cannot affect runtime performance or expand the API surface.
drop policy if exists users_self_select on public.users_v1_archive;
drop policy if exists workspace_members_select_own on public.workspace_members_v1_archive;

revoke all on public.users_v1_archive from anon, authenticated;
revoke all on public.workspace_members_v1_archive from anon, authenticated;

commit;
