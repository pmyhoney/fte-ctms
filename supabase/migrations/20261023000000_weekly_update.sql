-- 주간보고 수정: 작성자 본인 또는 관리자 (삭제와 같은 기준)
create policy "본인 또는 관리자 수정" on public.weekly_reports
  for update to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.is_admin()))
  with check (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

grant update on public.weekly_reports to authenticated;
