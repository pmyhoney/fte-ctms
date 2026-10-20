-- 재택 반일/종일 구분 (기존 신청은 종일로 본다)
alter table public.wfh_days
  add column kind text not null default 'full' check (kind in ('full', 'half'));
