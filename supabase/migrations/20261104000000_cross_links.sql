-- 탭 사이 연동: 주간보고 방문 기록 ↔ 배정 과제, 교육 이력 ↔ 팀원
-- 자유 입력 글자 대신 ID로 연결해 이름이 조금씩 다르게 입력되는 오류를 막는다.
-- 글자 칸(task_name, member)은 그대로 두어 이전 기록·엑셀과 호환된다 (연결이 없으면 글자를 보여 준다).

alter table public.weekly_reports add column if not exists group_id text;  -- 배정 과제(groupId 또는 id)
alter table public.trainings add column if not exists member_id text;      -- 팀원(members[].id)
create index if not exists weekly_reports_group_idx on public.weekly_reports (group_id);
create index if not exists trainings_member_idx on public.trainings (member_id);

-- 기존 기록 연결: 띄어쓰기를 뺀 이름이 정확히 하나와 일치할 때만 연결한다 (애매하면 그대로 둔다)
with m as (
  select x ->> 'id' as id, regexp_replace(x ->> 'name', '\s', '', 'g') as nm
  from public.app_state s, jsonb_array_elements(coalesce(s.value -> 'members', '[]'::jsonb)) x
  where s.key = 'fte-tracker-v3'
), u as (
  select nm, min(id) as id from m where nm <> '' group by nm having count(distinct id) = 1
)
update public.trainings t set member_id = u.id
from u where t.member_id is null and regexp_replace(t.member, '\s', '', 'g') = u.nm;

with a as (
  select distinct coalesce(x ->> 'groupId', x ->> 'id') as gid, regexp_replace(coalesce(x ->> 'taskName', ''), '\s', '', 'g') as nm
  from public.app_state s, jsonb_array_elements(coalesce(s.value -> 'assignments', '[]'::jsonb)) x
  where s.key = 'fte-tracker-v3'
), u as (
  select nm, min(gid) as gid from a where nm <> '' group by nm having count(distinct gid) = 1
)
update public.weekly_reports w set group_id = u.gid
from u where w.group_id is null and regexp_replace(w.task_name, '\s', '', 'g') = u.nm;
