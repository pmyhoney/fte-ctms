-- 관리자의 회원 삭제: 계정은 지우되 주간보고·교육 이력·전달교육 기록은 남긴다 (작성자 비움 → 이후 관리자만 수정·삭제)
-- 재택(wfh_days)은 개인 기록이라 계정과 함께 지워진다.
alter table public.weekly_reports alter column user_id drop not null;
alter table public.weekly_reports drop constraint weekly_reports_user_id_fkey,
  add constraint weekly_reports_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
alter table public.trainings alter column user_id drop not null;
alter table public.trainings drop constraint trainings_user_id_fkey,
  add constraint trainings_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
alter table public.tx_sessions alter column user_id drop not null;
alter table public.tx_sessions drop constraint tx_sessions_user_id_fkey,
  add constraint tx_sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

create function public.admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 회원을 삭제할 수 있어요';
  end if;
  if p_id = auth.uid() then
    raise exception '본인 계정은 삭제할 수 없어요';
  end if;
  if exists (select 1 from profiles where id = p_id and role = 'admin') then
    raise exception '관리자 계정은 삭제할 수 없어요';
  end if;
  delete from auth.users where id = p_id; -- profiles·재택은 함께 삭제, 나머지 기록은 작성자만 비워진다
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
