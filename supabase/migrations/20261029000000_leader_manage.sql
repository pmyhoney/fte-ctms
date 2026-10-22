-- 팀장(leader)에게 FTE 관리·CTMS·재택 탭의 관리자 권한을 준다.
--   FTE·CTMS: 앱 데이터(app_state) 전체 저장 가능
--   재택: 팀원 전체(삭제된 회원의 남은 이력 포함) 조회 — 수정·삭제는 관리자와 같이 본인 것만
--   회원 이름: 재택 달력에 이름을 보여주려고 profiles 조회 허용 (수정은 계속 관리자만)
-- 주간보고·교육 이력의 다른 사람 기록 수정·삭제, 회원 승인·삭제는 계속 관리자(is_admin)만 가능하다.
create function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved and role in ('admin', 'leader'));
$$;

alter policy "관리자만 추가" on public.app_state with check (public.is_manager());
alter policy "관리자만 수정" on public.app_state using (public.is_manager()) with check (public.is_manager());

alter policy "본인 또는 관리자 조회" on public.wfh_days
  using (public.is_approved() and (user_id = auth.uid() or public.is_manager()));

alter policy "본인 또는 관리자 조회" on public.profiles
  using (id = auth.uid() or public.is_manager());
