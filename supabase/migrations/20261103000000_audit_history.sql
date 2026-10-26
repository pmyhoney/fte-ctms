-- 변경 이력과 자동 스냅샷 (관리자만 조회·되돌리기)
-- 1) audit_log: 재택·주간보고·교육·전달교육·KOL·IIT·회원 정보의 추가/수정/삭제를 DB 트리거가 직접 기록한다.
--    화면 코드를 거치지 않고 DB에서 기록하므로, 누가 어떤 경로로 바꿔도 빠짐없이 남는다. 1년 지난 기록은 정리.
-- 2) app_state_versions: FTE·CTMS 데이터(app_state)가 저장될 때마다 저장된 내용을 통째로 보관한다.
--    같은 사람이 10분 안에 이어서 저장한 것은 한 버전으로 합치고, 180일 지난 버전은 정리(최근 30개는 항상 보관).

-- 1) 데이터 변경 이력 ---------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text not null default '',
  table_name text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_key text not null default '',
  old_row jsonb,
  new_row jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_at_idx on public.audit_log (table_name, at desc);

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; k text; nm text;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  -- 내용은 그대로이고 수정 시각만 바뀐 저장은 기록하지 않는다
  if tg_op = 'UPDATE' and (o - 'updated_at' - 'updated_by') = (n - 'updated_at' - 'updated_by') then return null; end if;
  k := coalesce(coalesce(n, o) ->> 'id', concat_ws('|', coalesce(n, o) ->> 'user_id', coalesce(n, o) ->> 'day'));
  select name into nm from profiles where id = auth.uid();
  insert into audit_log (actor, actor_name, table_name, op, row_key, old_row, new_row)
  values (auth.uid(), coalesce(nm, case when auth.uid() is null then '시스템' else '' end), tg_table_name, tg_op, k, o, n);
  if random() < 0.01 then delete from audit_log where at < now() - interval '1 year'; end if;
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'wfh_days', 'weekly_reports', 'trainings', 'tx_sessions', 'kols', 'kol_categories', 'iit_projects'] loop
    execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- 기록 하나를 되돌린다: 추가 → 삭제, 수정 → 이전 내용으로, 삭제 → 다시 추가 (회원 정보는 제외)
create function public.audit_revert(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r audit_log; tbl regclass; pk text[]; cols text; src jsonb; cond text; cnt int;
begin
  if not public.is_admin() then raise exception '관리자만 되돌릴 수 있어요.'; end if;
  select * into r from audit_log where id = p_id;
  if not found then raise exception '변경 기록을 찾을 수 없어요.'; end if;
  if r.table_name not in ('wfh_days', 'weekly_reports', 'trainings', 'tx_sessions', 'kols', 'kol_categories', 'iit_projects') then
    raise exception '회원 정보 변경은 되돌릴 수 없어요. 팀원 관리에서 직접 고쳐 주세요.';
  end if;
  tbl := format('public.%I', r.table_name)::regclass;
  select array_agg(a.attname::text order by a.attnum) into pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = tbl and i.indisprimary;
  select string_agg(format('%I', attname), ', ' order by attnum) into cols
    from pg_attribute where attrelid = tbl and attnum > 0 and not attisdropped;
  src := coalesce(r.old_row, r.new_row);
  select string_agg(format('%I::text = %L', c, src ->> c), ' and ') into cond from unnest(pk) c;
  begin
    if r.op = 'INSERT' then
      execute format('delete from %s where %s', tbl, cond);
      get diagnostics cnt = row_count;
      if cnt = 0 then raise exception '이미 삭제된 항목이에요.'; end if;
    elsif r.op = 'UPDATE' then
      execute format('update %s set (%s) = (select %s from jsonb_populate_record(null::%s, $1)) where %s', tbl, cols, cols, tbl, cond) using r.old_row;
      get diagnostics cnt = row_count;
      if cnt = 0 then raise exception '그 사이 항목이 삭제돼서 되돌릴 수 없어요.'; end if;
    else
      execute format('insert into %s select * from jsonb_populate_record(null::%s, $1)', tbl, tbl) using r.old_row;
    end if;
  exception
    when unique_violation then raise exception '같은 항목이 이미 있어서 되돌릴 수 없어요.';
    when foreign_key_violation then raise exception '연결된 회원이나 교육이 삭제돼서 되돌릴 수 없어요.';
  end;
end;
$$;

-- 2) FTE·CTMS 자동 스냅샷 ------------------------------------------------------
create table public.app_state_versions (
  id bigserial primary key,
  key text not null,
  value jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  saved_at timestamptz not null default now(),
  saved_by uuid,
  saved_by_name text not null default '',
  note text not null default ''
);
create index app_state_versions_key_idx on public.app_state_versions (key, saved_at desc);

create function public.app_state_summary(v jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'members', case when jsonb_typeof(v -> 'members') = 'array' then jsonb_array_length(v -> 'members') else 0 end,
    'assignments', case when jsonb_typeof(v -> 'assignments') = 'array' then jsonb_array_length(v -> 'assignments') else 0 end,
    'products', case when jsonb_typeof(v -> 'products') = 'array' then jsonb_array_length(v -> 'products') else 0 end,
    'taskTypes', case when jsonb_typeof(v -> 'taskTypes') = 'array' then jsonb_array_length(v -> 'taskTypes') else 0 end,
    'ctms', case when jsonb_typeof(v -> 'ctms') = 'object' then (select count(*) from jsonb_object_keys(v -> 'ctms')) else 0 end,
    'bytes', octet_length(v::text));
$$;

create function public.app_state_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare last app_state_versions; nm text; v_note text := coalesce(current_setting('app.snapshot_note', true), '');
begin
  if tg_op = 'UPDATE' and (new.value - 'savedAt') = (old.value - 'savedAt') then return null; end if;
  select name into nm from profiles where id = auth.uid();
  select * into last from app_state_versions where key = new.key order by id desc limit 1;
  if v_note = '' and found and last.note = '' and last.saved_by is not distinct from auth.uid() and last.started_at > now() - interval '10 minutes' then
    update app_state_versions set value = new.value, summary = public.app_state_summary(new.value), saved_at = now() where id = last.id;
  else
    insert into app_state_versions (key, value, summary, saved_by, saved_by_name, note)
    values (new.key, new.value, public.app_state_summary(new.value), auth.uid(), coalesce(nm, ''), v_note);
  end if;
  delete from app_state_versions where key = new.key and saved_at < now() - interval '180 days'
    and id not in (select id from app_state_versions where key = new.key order by id desc limit 30);
  return null;
end;
$$;

create trigger app_state_snapshot after insert or update on public.app_state
  for each row execute function public.app_state_snapshot();

-- 지금 상태를 첫 버전으로 남긴다
insert into public.app_state_versions (key, value, summary, saved_by_name, note)
select key, value, public.app_state_summary(value), '', '기능 추가 시점' from public.app_state;

-- 스냅샷으로 되돌린다 (되돌리기 자체도 새 버전으로 남아서 다시 되돌릴 수 있다)
create function public.app_state_restore(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v app_state_versions;
begin
  if not public.is_admin() then raise exception '관리자만 복원할 수 있어요.'; end if;
  select * into v from app_state_versions where id = p_id;
  if not found then raise exception '스냅샷을 찾을 수 없어요.'; end if;
  perform set_config('app.snapshot_note', '복원: ' || to_char(v.saved_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ' 버전', true);
  update app_state set value = v.value || jsonb_build_object('savedAt', now()), updated_at = now() where key = v.key;
  perform set_config('app.snapshot_note', '', true);
end;
$$;

-- 3) 권한: 관리자만 조회, 쓰기는 트리거·함수만 ------------------------------------
alter table public.audit_log enable row level security;
alter table public.app_state_versions enable row level security;
create policy "관리자 조회" on public.audit_log for select to authenticated using (public.is_admin());
create policy "관리자 조회" on public.app_state_versions for select to authenticated using (public.is_admin());
revoke all on public.audit_log, public.app_state_versions from anon, authenticated;
grant select on public.audit_log, public.app_state_versions to authenticated;
revoke all on function public.audit_row(), public.app_state_snapshot() from public, anon, authenticated;
revoke all on function public.audit_revert(bigint), public.app_state_restore(bigint) from public, anon;
grant execute on function public.audit_revert(bigint), public.app_state_restore(bigint) to authenticated;
