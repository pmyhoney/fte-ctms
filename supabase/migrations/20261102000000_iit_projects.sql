-- IIT 관리 탭
--   과제 배정(app_state)의 과제는 앱에서 자동으로 목록에 보이고, 이 테이블에는 IIT 탭에서 입력한 정보만 저장한다.
--   group_id: 연결된 배정 과제(groupId 또는 id). null이면 IIT 탭에서 직접 추가한 과제.
--   hidden: 배정 과제를 IIT 목록에서 뺀 경우 (배정은 그대로 둔다)
--   data: { product, taskName, manager, code, site, investigator,
--           support: { ip, fund, etc, etcText }, status(제안·준비중·진행중·종료),
--           pub: { status(미진행·진행·완료), journal, vol, title, url } }
-- 조회는 승인 회원 누구나, 추가·수정·삭제는 뷰어를 뺀 회원(can_write).
create table public.iit_projects (
  id uuid primary key default gen_random_uuid(),
  group_id text unique,
  data jsonb not null default '{}'::jsonb,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);

alter table public.iit_projects enable row level security;
create policy "승인 회원 조회" on public.iit_projects for select to authenticated using (public.is_approved());
create policy "회원 추가" on public.iit_projects for insert to authenticated with check (public.can_write());
create policy "회원 수정" on public.iit_projects for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "회원 삭제" on public.iit_projects for delete to authenticated using (public.can_write());
revoke all on public.iit_projects from anon;
grant select, insert, update, delete on public.iit_projects to authenticated;
