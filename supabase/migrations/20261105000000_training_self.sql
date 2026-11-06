-- 교육 이력: 사내 교육의 하위 구분 'self training'
-- scope는 그대로 '사내'로 두어 사내/사외 집계와 필터가 달라지지 않게 하고, 하위 구분만 따로 표시한다.
alter table public.trainings add column self_training boolean not null default false;
