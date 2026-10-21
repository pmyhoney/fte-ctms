-- 교육 이력(trainings): 승인 회원 모두 조회, 본인만 추가, 작성자 본인 또는 관리자만 수정·삭제
create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member text not null default '',
  edu_date date not null,
  title text not null,
  org text not null default '',
  hours numeric,
  scope text not null check (scope in ('사내','사외')),
  edu_type text not null check (edu_type in ('과제','SOP','General')),
  tx_need boolean not null default false,          -- 사외 교육의 팀내 전달교육 대상 여부
  tx_status text check (tx_status in ('todo','plan','done')),
  tx_plan_date date,
  tx_done_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trainings enable row level security;

create policy "승인 회원 조회" on public.trainings
  for select to authenticated using (public.is_approved());
create policy "본인만 추가" on public.trainings
  for insert to authenticated with check (public.is_approved() and user_id = auth.uid());
create policy "본인 또는 관리자 수정" on public.trainings
  for update to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
create policy "본인 또는 관리자 삭제" on public.trainings
  for delete to authenticated using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

revoke all on public.trainings from anon;
grant select, insert, update, delete on public.trainings to authenticated;
