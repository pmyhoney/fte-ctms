-- CTMS 계약관리: 계약·지급 계획·입금 내역은 앱 데이터의 ctmsContracts[gid]에 저장한다.
-- 담당자(회원)는 save_ctms로 본인 담당 과제의 기록만 저장할 수 있으므로, 계약 기록(p_contracts)도 받도록 넓힌다.
-- p_contracts를 보내지 않는 예전 화면에서 저장해도 계약 기록은 건드리지 않는다.
drop function public.save_ctms(text[], jsonb, jsonb, jsonb, jsonb);

create function public.save_ctms(p_gids text[], p_ctms jsonb, p_issues jsonb, p_cost jsonb, p_log jsonb, p_contracts jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member text;
  v_state jsonb;
  v_log jsonb;
  g text;
  k text;
  src jsonb;
  v_keys text[] := array['ctms', 'ctmsIssues', 'ctmsCost'];
begin
  select member_id into v_member from profiles where id = auth.uid() and approved;
  if v_member is null then
    raise exception '팀원과 연결된 승인 회원만 CTMS를 저장할 수 있어요';
  end if;

  select value into v_state from app_state where key = 'fte-tracker-v3' for update;
  if v_state is null then
    raise exception '저장된 데이터가 없어요';
  end if;

  if p_contracts is not null then
    v_keys := array_append(v_keys, 'ctmsContracts');
  end if;

  foreach g in array p_gids loop
    if not exists (
      select 1 from jsonb_array_elements(v_state->'assignments') a
      where coalesce(a->>'groupId', a->>'id') = g and a->>'memberId' = v_member
    ) then
      raise exception '본인 담당 과제가 아니에요: %', g;
    end if;

    foreach k in array v_keys loop
      src := case k when 'ctms' then p_ctms when 'ctmsIssues' then p_issues when 'ctmsCost' then p_cost else p_contracts end;
      if jsonb_typeof(v_state->k) is distinct from 'object' then
        v_state := jsonb_set(v_state, array[k], '{}'::jsonb);
      end if;
      if src ? g then
        v_state := jsonb_set(v_state, array[k, g], src->g);
      else
        v_state := jsonb_set(v_state, array[k], (v_state->k) - g);
      end if;
    end loop;
  end loop;

  -- 변경 이력: 합치고 중복 제거 후 최신 50건
  select coalesce(jsonb_agg(e order by e->>'ts' desc), '[]'::jsonb) into v_log
  from (
    select e from (
      select distinct on (e->>'ts', e->>'msg') e
      from jsonb_array_elements(
        (case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end) ||
        (case when jsonb_typeof(v_state->'activityLog') = 'array' then v_state->'activityLog' else '[]'::jsonb end)
      ) e
    ) d
    order by e->>'ts' desc
    limit 50
  ) s;
  v_state := jsonb_set(v_state, '{activityLog}', v_log);
  v_state := jsonb_set(v_state, '{savedAt}', to_jsonb(now()));

  update app_state set value = v_state, updated_at = now() where key = 'fte-tracker-v3';
end;
$$;

revoke all on function public.save_ctms(text[], jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_ctms(text[], jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
