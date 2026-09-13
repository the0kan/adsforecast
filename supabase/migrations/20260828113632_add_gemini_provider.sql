begin;

alter table public.ai_analysis_runs
  drop constraint ai_analysis_runs_provider_check;

alter table public.ai_analysis_runs
  add constraint ai_analysis_runs_provider_check
  check (provider in ('gemini', 'openai', 'rules'));

commit;
