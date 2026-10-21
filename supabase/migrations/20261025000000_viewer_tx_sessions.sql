-- 1) 뷰어 권한: 승인은 됐지만 조회만 가능 (재택·주간보고·교육 입력 불가) ----------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'member', 'viewer'));

create function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved and role in ('admin', 'member'));
$$;

alter policy "본인만 추가" on public.wfh_days with check (public.can_write() and user_id = auth.uid());
alter policy "본인만 수정" on public.wfh_days using (user_id = auth.uid()) with check (public.can_write() and user_id = auth.uid());
alter policy "본인만 삭제" on public.wfh_days using (public.can_write() and user_id = auth.uid());

alter policy "본인만 추가" on public.weekly_reports with check (public.can_write() and user_id = auth.uid());
alter policy "본인 또는 관리자 수정" on public.weekly_reports
  using (public.can_write() and (user_id = auth.uid() or public.is_admin()))
  with check (public.can_write() and (user_id = auth.uid() or public.is_admin()));
alter policy "본인 또는 관리자 삭제" on public.weekly_reports using (public.can_write() and (user_id = auth.uid() or public.is_admin()));

alter policy "본인만 추가" on public.trainings with check (public.can_write() and user_id = auth.uid());
alter policy "본인 또는 관리자 수정" on public.trainings
  using (public.can_write() and (user_id = auth.uid() or public.is_admin()))
  with check (public.can_write() and (user_id = auth.uid() or public.is_admin()));
alter policy "본인 또는 관리자 삭제" on public.trainings using (public.can_write() and (user_id = auth.uid() or public.is_admin()));

-- 2) 팀내 전달교육 현황 -------------------------------------------------------------
-- training_id가 있으면 교육 이력(사외·전달교육 완료)에서 자동으로 만들어진 기록
create table public.tx_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  training_id uuid unique references public.trainings(id) on delete cascade,
  session_date date not null,
  title text not null,
  educator text not null default '',
  attendees text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tx_sessions enable row level security;

create policy "승인 회원 조회" on public.tx_sessions
  for select to authenticated using (public.is_approved());
create policy "본인만 추가" on public.tx_sessions
  for insert to authenticated with check (public.can_write() and user_id = auth.uid());
create policy "본인 또는 관리자 수정" on public.tx_sessions
  for update to authenticated
  using (public.can_write() and (user_id = auth.uid() or public.is_admin()))
  with check (public.can_write() and (user_id = auth.uid() or public.is_admin()));
create policy "본인 또는 관리자 삭제" on public.tx_sessions
  for delete to authenticated using (public.can_write() and (user_id = auth.uid() or public.is_admin()));

revoke all on public.tx_sessions from anon;
grant select, insert, update, delete on public.tx_sessions to authenticated;

-- 3) 교육 이력의 전달교육이 '완료'가 되면 현황에 시행일자·제목·교육자를 넣고 맞춰 준다
create function public.sync_tx_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_done boolean := new.scope = '사외' and new.tx_need and new.tx_status = 'done' and new.tx_done_date is not null;
begin
  if not is_done then
    delete from tx_sessions where training_id = new.id;
    return new;
  end if;
  -- 전달교육 관련 내용이 그대로면, 현황에서 직접 고친 내용을 덮어쓰지 않는다
  if tg_op = 'UPDATE' and old.scope = '사외' and old.tx_need and old.tx_status = 'done'
     and old.tx_done_date is not distinct from new.tx_done_date and old.title = new.title and old.member = new.member then
    return new;
  end if;
  insert into tx_sessions (training_id, user_id, session_date, title, educator)
  values (new.id, new.user_id, new.tx_done_date, new.title, new.member)
  on conflict (training_id) do update
    set session_date = excluded.session_date, title = excluded.title, educator = excluded.educator, updated_at = now();
  return new;
end;
$$;

create trigger trainings_sync_tx_session
  after insert or update on public.trainings
  for each row execute function public.sync_tx_session();
