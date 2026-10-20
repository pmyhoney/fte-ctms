-- 재택(wfh_days) + 주간보고(weekly_reports)
-- 앱 데이터(app_state)와 따로 둔다: 회원 각자가 자기 기록을 직접 쓰므로 행 단위 보안 정책(RLS)으로 보호한다.

-- 1) 재택: 행이 있으면 그날 '재택 예정', journal은 그날의 업무 일지 ---------------
create table public.wfh_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  journal text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.wfh_days enable row level security;

create policy "본인 또는 관리자 조회" on public.wfh_days
  for select to authenticated using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
create policy "본인만 추가" on public.wfh_days
  for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
create policy "본인만 수정" on public.wfh_days
  for update to authenticated using (user_id = auth.uid()) with check (public.is_approved() and user_id = auth.uid());
create policy "본인만 삭제" on public.wfh_days
  for delete to authenticated using (public.is_approved() and user_id = auth.uid());

-- 2) 주간보고: 승인 회원 모두 조회, 작성자 본인(또는 관리자)만 삭제 ------------------
create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  visit_date date not null,
  task_name text not null default '',
  visit_place text not null default '',
  region text not null default '',
  pi_name text not null default '',
  reason text not null default '',
  visitor text not null default '',
  created_at timestamptz not null default now()
);

alter table public.weekly_reports enable row level security;

create policy "승인 회원 조회" on public.weekly_reports
  for select to authenticated using (public.is_approved());
create policy "본인만 추가" on public.weekly_reports
  for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
create policy "본인 또는 관리자 삭제" on public.weekly_reports
  for delete to authenticated using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

revoke all on public.wfh_days, public.weekly_reports from anon;
grant select, insert, update, delete on public.wfh_days to authenticated;
grant select, insert, delete on public.weekly_reports to authenticated;
