create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  short_name text,
  color text,
  created_at timestamptz default now()
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  event_type text not null,
  start_datetime timestamptz,
  end_datetime timestamptz,
  is_all_day boolean default false,
  countdown_enabled boolean default false,
  source text,
  needs_review boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  subject_id uuid references subjects(id),
  due_date date,
  completed boolean default false,
  countdown_enabled boolean default false,
  repeat_rule text default 'none',
  repeat_weekday int,
  remind_3_days_before boolean default false,
  remind_1_day_before boolean default true,
  remind_on_day boolean default true,
  show_on_calendar boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists timetable_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  effective_from date not null,
  effective_until date,
  source_file_url text,
  created_at timestamptz default now()
);

create table if not exists timetable_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  timetable_version_id uuid references timetable_versions(id),
  subject_id uuid references subjects(id),
  weekday int not null,
  period int not null,
  room text,
  teacher text,
  raw_subject text,
  raw_teacher text,
  needs_review boolean default false,
  effective_from date,
  effective_until date,
  override_date date,
  start_time time,
  end_time time,
  created_at timestamptz default now()
);

create table if not exists lunch_menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  breakfast_text text,
  lunch_text text,
  dinner_text text,
  kcal int,
  event_note text,
  raw_text text,
  needs_review boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists daily_schedule_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  plan_type text not null check (plan_type in ('ideal', 'actual')),
  title text,
  overall_achievement_percent int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date, plan_type)
);

create table if not exists daily_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references daily_schedule_plans(id) on delete cascade,
  category text not null,
  label text not null,
  start_time time not null,
  end_time time not null,
  duration_minutes int not null,
  achievement_percent int,
  memo text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  job_type text not null,
  source_type text not null,
  file_url text,
  input_text text,
  related_subject_id uuid references subjects(id),
  related_calendar_event_id uuid references calendar_events(id),
  status text not null default 'pending',
  result_json jsonb,
  error_message text,
  created_at timestamptz default now(),
  processed_at timestamptz
);
