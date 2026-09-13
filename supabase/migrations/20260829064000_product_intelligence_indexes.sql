begin;

create index if not exists meta_sync_logs_workspace_created_idx
  on public.meta_sync_logs (workspace_id, created_at desc);

commit;
