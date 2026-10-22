-- 회원 구분: 팀장(leader) · 팀원(member) · 뷰어(viewer) (+ 관리자 admin)
-- 팀장은 팀원과 같은 입력 권한(재택·주간보고·교육)을 갖고, 과제 배정 대상에서만 빠진다.
-- FTE 화면에서 팀장을 숨기는 기준은 앱 데이터(app_state)의 팀원 기록(members[].leader)이다 —
-- 일반 회원은 다른 사람의 profiles를 볼 수 없으므로, 관리자가 회원을 팀장으로 바꾸면 연결된 팀원에도 함께 표시한다.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'leader', 'member', 'viewer'));

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved and role in ('admin', 'leader', 'member'));
$$;
