-- FTE · 과제관리: 회원(profiles) + 앱 데이터(app_state) + 보안 정책

-- 1) 회원 정보 -------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  approved boolean not null default false,
  member_id text,               -- 앱 데이터의 팀원 id (CTMS 본인 과제 판별용)
  created_at timestamptz not null default now()
);

-- 2) 앱 데이터: 기존 HTML과 같이 전체 데이터를 key 하나에 JSON으로 저장 -----------
create table public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3) 권한 확인 함수 ---------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and approved);
$$;

create function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved);
$$;

-- 4) 가입 시 profiles 자동 생성 (승인 대기 상태) ------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, login_id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'login_id', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) 보안 정책(RLS) ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_state enable row level security;

create policy "본인 또는 관리자 조회" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "관리자만 수정" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "승인 회원 조회" on public.app_state
  for select to authenticated using (public.is_approved());
create policy "관리자만 추가" on public.app_state
  for insert to authenticated with check (public.is_admin());
create policy "관리자만 수정" on public.app_state
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.profiles, public.app_state from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.app_state to authenticated;

-- 6) 일반 회원의 CTMS 저장: 본인 담당 과제(gid)의 기록만 합쳐서 저장 ------------
create function public.save_ctms(p_gids text[], p_ctms jsonb, p_issues jsonb, p_cost jsonb, p_log jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_member text;
  v_state jsonb;
  v_log jsonb;
  g text;
  k text;
  src jsonb;
begin
  select member_id into v_member from profiles where id = auth.uid() and approved;
  if v_member is null then
    raise exception '팀원과 연결된 승인 회원만 CTMS를 저장할 수 있어요';
  end if;

  select value into v_state from app_state where key = 'fte-tracker-v3' for update;
  if v_state is null then
    raise exception '저장된 데이터가 없어요';
  end if;

  foreach g in array p_gids loop
    if not exists (
      select 1 from jsonb_array_elements(v_state->'assignments') a
      where coalesce(a->>'groupId', a->>'id') = g and a->>'memberId' = v_member
    ) then
      raise exception '본인 담당 과제가 아니에요: %', g;
    end if;

    foreach k in array array['ctms', 'ctmsIssues', 'ctmsCost'] loop
      src := case k when 'ctms' then p_ctms when 'ctmsIssues' then p_issues else p_cost end;
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

revoke all on function public.save_ctms(text[], jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_ctms(text[], jsonb, jsonb, jsonb, jsonb) to authenticated;
