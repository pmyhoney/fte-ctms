-- 팀장(leader)도 관리 탭(팀원 관리·과제 유형·품목 관리·변경 이력)을 쓸 수 있게 한다.
--   변경 이력: 조회(audit_log·app_state_versions)와 앱 데이터 스냅샷 복원 허용
--              (팀장은 원래 앱 데이터 전체를 저장할 수 있으므로 같은 범위)
--   변경 하나 되돌리기(audit_revert)는 다른 사람의 주간보고·교육 기록을 바꾸므로 계속 관리자만.
--   회원 승인·삭제도 계속 관리자만.
alter policy "관리자 조회" on public.audit_log using (public.is_manager());
alter policy "관리자 조회" on public.app_state_versions using (public.is_manager());

create or replace function public.app_state_restore(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v app_state_versions;
begin
  if not public.is_manager() then raise exception '관리자·팀장만 복원할 수 있어요.'; end if;
  select * into v from app_state_versions where id = p_id;
  if not found then raise exception '스냅샷을 찾을 수 없어요.'; end if;
  perform set_config('app.snapshot_note', '복원: ' || to_char(v.saved_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' 버전', true);
  update app_state set value = v.value || jsonb_build_object('savedAt', now()), updated_at = now() where key = v.key;
  perform set_config('app.snapshot_note', '', true);
end;
$$;
