-- KOL 통합 디렉토리 (KOL 탭)
-- 협조도 평가 등 내부 정보가 있어 공개 저장소(GitHub)에는 데이터를 올리지 않는다 —
-- 명단은 이 테이블에만 넣고(관리 도구로 직접 입력), 승인된 회원만 로그인해서 볼 수 있다.
-- data: { name, tier, society, role, hospital, education, career, papers, note, trials[], trialDetail, evaluation(1 추천·2 비추천), evalTags[] }
create table public.kols (
  id integer primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kols enable row level security;

create policy "승인 회원 조회" on public.kols
  for select to authenticated using (public.is_approved());

revoke all on public.kols from anon;
grant select on public.kols to authenticated;
