create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  grade text default '高校3年',
  class_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null default 'app_state',
  settings jsonb not null default '{}'::jsonb,
  app_state jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, key)
);

create table if not exists notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  short_name text,
  color text,
  progress jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  title text not null,
  description text,
  subject text,
  due_date date,
  kind text,
  importance text,
  completed boolean default false,
  countdown_enabled boolean default false,
  repeat_rule text default 'none',
  remind_3_days_before boolean default false,
  remind_1_day_before boolean default true,
  remind_on_day boolean default true,
  show_on_calendar boolean default true,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, client_id)
);

create table if not exists homeworks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  title text not null,
  subject text,
  description text,
  due_date date,
  planned_date date,
  week_start_date date,
  completed boolean default false,
  completed_at timestamptz,
  completed_late boolean default false,
  penalty_status text default 'none',
  penalty_count int default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, client_id)
);

create table if not exists weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null,
  type text not null default 'event',
  source_id uuid,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  title text not null,
  description text,
  event_type text not null default 'event',
  start_date date,
  end_date date,
  start_datetime timestamptz,
  end_datetime timestamptz,
  is_all_day boolean default true,
  countdown_enabled boolean default false,
  source text,
  needs_review boolean default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, client_id)
);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  name text not null,
  timetable jsonb not null default '[]'::jsonb,
  effective_from date,
  effective_until date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, client_id)
);

create table if not exists important_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_event_id uuid references calendar_events(id) on delete cascade,
  title text not null,
  target_date date,
  event_type text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  plan_type text not null check (plan_type in ('ideal', 'actual')),
  blocks jsonb not null default '[]'::jsonb,
  overall_achievement_percent int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date, plan_type)
);

create table if not exists study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz default now(),
  subject text,
  category text,
  minutes int,
  memo text,
  source text,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists subject_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  progress_percent int default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, subject)
);

create table if not exists understanding_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text,
  topic text,
  score int,
  measured_at timestamptz default now(),
  source text,
  raw jsonb not null default '{}'::jsonb
);

create table if not exists study_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  subject text not null,
  minutes int default 0,
  understanding int default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date, subject)
);

create table if not exists uploaded_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null default 'study-files',
  file_path text not null,
  file_url text,
  file_name text,
  file_type text,
  file_size bigint,
  related_subject text,
  related_date date,
  related_period int,
  created_at timestamptz default now()
);

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null,
  subject text,
  input_type text,
  input_text text,
  file_path text,
  file_url text,
  prompt text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz,
  worker_processed_at timestamptz,
  error_message text,
  ocr_text text,
  ocr_layout jsonb not null default '{}'::jsonb,
  result_id uuid,
  model_name text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references ai_jobs(id) on delete cascade,
  subject text,
  source_text text,
  ocr_text text,
  ocr_layout jsonb not null default '{}'::jsonb,
  summary text,
  questions jsonb not null default '[]'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  important_terms jsonb not null default '[]'::jsonb,
  understanding_data jsonb not null default '{}'::jsonb,
  model_name text,
  created_at timestamptz default now(),
  error_message text
);

alter table if exists ai_jobs add column if not exists worker_processed_at timestamptz;
alter table if exists ai_jobs add column if not exists ocr_layout jsonb not null default '{}'::jsonb;
alter table if exists ai_jobs add column if not exists result_id uuid;
alter table if exists ai_jobs add column if not exists model_name text;
alter table if exists ai_jobs add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists ai_results add column if not exists ocr_layout jsonb not null default '{}'::jsonb;
alter table if exists ai_results add column if not exists answers jsonb not null default '[]'::jsonb;
alter table if exists ai_results add column if not exists important_terms jsonb not null default '[]'::jsonb;
alter table if exists ai_results add column if not exists understanding_data jsonb not null default '{}'::jsonb;
alter table if exists ai_results add column if not exists model_name text;

create index if not exists ai_jobs_status_idx on ai_jobs(status, created_at);
create index if not exists ai_jobs_user_status_idx on ai_jobs(user_id, status, created_at desc);
create index if not exists ai_results_job_idx on ai_results(job_id);

alter table profiles enable row level security;
alter table app_settings enable row level security;
alter table notification_settings enable row level security;
alter table subjects enable row level security;
alter table todos enable row level security;
alter table homeworks enable row level security;
alter table weekly_plans enable row level security;
alter table calendar_events enable row level security;
alter table schedules enable row level security;
alter table important_events enable row level security;
alter table daily_plans enable row level security;
alter table study_logs enable row level security;
alter table subject_progress enable row level security;
alter table understanding_scores enable row level security;
alter table study_metrics enable row level security;
alter table uploaded_files enable row level security;
alter table ai_jobs enable row level security;
alter table ai_results enable row level security;

create policy "profiles owner access" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "app_settings owner access" on app_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notification_settings owner access" on notification_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subjects owner access" on subjects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "todos owner access" on todos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "homeworks owner access" on homeworks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weekly_plans owner access" on weekly_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "calendar_events owner access" on calendar_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "schedules owner access" on schedules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "important_events owner access" on important_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_plans owner access" on daily_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_logs owner access" on study_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subject_progress owner access" on subject_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "understanding_scores owner access" on understanding_scores for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_metrics owner access" on study_metrics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "uploaded_files owner access" on uploaded_files for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_jobs owner access" on ai_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_results owner access" on ai_results for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('study-files', 'study-files', false)
on conflict (id) do nothing;

create policy "study-files authenticated upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "study-files owner read" on storage.objects
for select to authenticated
using (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "study-files owner update" on storage.objects
for update to authenticated
using (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);
