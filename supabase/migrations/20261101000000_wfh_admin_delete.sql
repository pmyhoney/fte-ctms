-- 관리자는 다른 팀원(삭제된 회원의 남은 이력 포함)의 재택 일정·업무 일지를 삭제할 수 있다.
--   재택 삭제: 행 삭제 (일지도 함께) / 일지만 삭제: journal을 비움
-- 팀장은 지금처럼 조회만 가능하다 (본인 것은 기존 '본인만' 정책으로 수정·삭제).
create policy "관리자 삭제" on public.wfh_days
  for delete to authenticated using (public.is_admin());
create policy "관리자 수정" on public.wfh_days
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
