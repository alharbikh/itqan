
create index if not exists evaluation_score_details_framework_job_criterion_idx on public.evaluation_score_details(framework_id,job_title_id,criterion_id);
create index if not exists performance_reviews_job_title_idx on public.performance_reviews(job_title_id);
create index if not exists performance_reviews_period_idx on public.performance_reviews(period_id);
create index if not exists self_evaluations_job_title_idx on public.self_evaluations(job_title_id);
create index if not exists self_evaluations_period_idx on public.self_evaluations(period_id);
