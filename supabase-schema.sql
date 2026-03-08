-- ============================================
-- CANU Grow — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- Members (auto-created on first login)
create table members (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  is_admin boolean default false,
  total_shifts integer default 0,
  created_at timestamptz default now()
);

-- Jobs (reusable templates)
create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('maintenance', 'fertilize', 'harvest')),
  description text default '',
  default_capacity integer default 3,
  created_by uuid references members(id),
  created_at timestamptz default now()
);

-- Shifts (scheduled instances of jobs)
create table shifts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  title text not null,
  category text not null,
  description text default '',
  date date not null,
  start_time time not null,
  end_time time not null,
  capacity integer default 3,
  created_by uuid references members(id),
  created_at timestamptz default now()
);

-- Signups (members assigned to shifts)
create table signups (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references shifts(id) on delete cascade,
  member_id uuid references members(id),
  member_email text not null,
  member_name text,
  status text default 'active' check (status in ('active', 'cancelled')),
  assigned_by uuid references members(id),
  created_at timestamptz default now(),
  unique(shift_id, member_id, status)
);

-- Config (key-value settings)
create table config (
  key text primary key,
  value text
);

-- Seed config
insert into config (key, value) values
  ('org_name', 'CANU Grow'),
  ('join_code', 'CANUGROW'),
  ('university', 'University of Manitoba');

-- Indexes
create index idx_shifts_date on shifts(date);
create index idx_signups_shift on signups(shift_id) where status = 'active';
create index idx_signups_member on signups(member_id) where status = 'active';
create index idx_members_email on members(email);

-- ============================================
-- Row Level Security
-- ============================================

alter table members enable row level security;
alter table jobs enable row level security;
alter table shifts enable row level security;
alter table signups enable row level security;
alter table config enable row level security;

-- Everyone can read members (for display names)
create policy "Members are viewable by authenticated users"
  on members for select to authenticated using (true);

-- Members can update their own record
create policy "Members can update own record"
  on members for update to authenticated
  using (email = auth.jwt()->>'email');

-- Members can insert themselves (auto-register)
create policy "Users can register themselves"
  on members for insert to authenticated
  with check (email = auth.jwt()->>'email');

-- Admins can update any member
create policy "Admins can update any member"
  on members for update to authenticated
  using (exists (select 1 from members where email = auth.jwt()->>'email' and is_admin = true));

-- Jobs: everyone reads, admins write
create policy "Jobs are viewable by authenticated users"
  on jobs for select to authenticated using (true);

create policy "Admins can manage jobs"
  on jobs for all to authenticated
  using (exists (select 1 from members where email = auth.jwt()->>'email' and is_admin = true));

-- Shifts: everyone reads, admins write
create policy "Shifts are viewable by authenticated users"
  on shifts for select to authenticated using (true);

create policy "Admins can manage shifts"
  on shifts for all to authenticated
  using (exists (select 1 from members where email = auth.jwt()->>'email' and is_admin = true));

-- Signups: everyone reads, members can insert/update their own, admins can manage all
create policy "Signups are viewable by authenticated users"
  on signups for select to authenticated using (true);

create policy "Members can sign themselves up"
  on signups for insert to authenticated
  with check (member_id = (select id from members where email = auth.jwt()->>'email'));

create policy "Members can cancel own signup"
  on signups for update to authenticated
  using (member_id = (select id from members where email = auth.jwt()->>'email'));

create policy "Admins can manage all signups"
  on signups for all to authenticated
  using (exists (select 1 from members where email = auth.jwt()->>'email' and is_admin = true));

-- Config: everyone reads, admins write
create policy "Config is viewable by authenticated users"
  on config for select to authenticated using (true);

create policy "Admins can update config"
  on config for all to authenticated
  using (exists (select 1 from members where email = auth.jwt()->>'email' and is_admin = true));

-- ============================================
-- Helper function: get current member
-- ============================================

-- Increment/decrement shift counts
create or replace function increment_member_shifts(member_uuid uuid)
returns void as $$
  update members set total_shifts = total_shifts + 1 where id = member_uuid;
$$ language sql security definer;

create or replace function decrement_member_shifts(member_uuid uuid)
returns void as $$
  update members set total_shifts = greatest(0, total_shifts - 1) where id = member_uuid;
$$ language sql security definer;

create or replace function get_current_member_id()
returns uuid as $$
  select id from members where email = auth.jwt()->>'email' limit 1;
$$ language sql security definer;

-- ============================================
-- Function: get shifts with signup counts
-- ============================================

create or replace function get_shifts_for_week(week_start date)
returns json as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select
      s.*,
      coalesce(
        (select json_agg(json_build_object('email', sg.member_email, 'name', sg.member_name))
         from signups sg where sg.shift_id = s.id and sg.status = 'active'),
        '[]'::json
      ) as members,
      (select count(*) from signups sg where sg.shift_id = s.id and sg.status = 'active')::int as signup_count,
      s.capacity - (select count(*) from signups sg where sg.shift_id = s.id and sg.status = 'active')::int as spots_remaining
    from shifts s
    where s.date >= week_start and s.date < week_start + interval '7 days'
    order by s.date, s.start_time
  ) t;
$$ language sql security definer;

-- ============================================
-- Function: get open shifts (for job board)
-- ============================================

create or replace function get_open_shifts()
returns json as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select
      s.*,
      coalesce(
        (select json_agg(json_build_object('email', sg.member_email, 'name', sg.member_name))
         from signups sg where sg.shift_id = s.id and sg.status = 'active'),
        '[]'::json
      ) as members,
      (select count(*) from signups sg where sg.shift_id = s.id and sg.status = 'active')::int as signup_count,
      s.capacity - (select count(*) from signups sg where sg.shift_id = s.id and sg.status = 'active')::int as spots_remaining
    from shifts s
    where s.date >= current_date
      and s.capacity > (select count(*) from signups sg where sg.shift_id = s.id and sg.status = 'active')
    order by s.date, s.start_time
  ) t;
$$ language sql security definer;
