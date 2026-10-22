-- 관리자의 회원 삭제 시 재택 기록 처리:
--   삭제한 날 이후(내일부터)의 재택 계획은 지우고, 오늘까지의 재택 이력·업무 일지는 남긴다.
--   남은 기록은 작성자가 비워지므로(user_id = null) 이름을 user_name에 보관하고, 관리자만 볼 수 있다(조회 정책 그대로).

-- 1) 작성자가 비워져도 행이 남을 수 있게: 기본키를 id로 바꾸고, (user_id, day)는 중복 방지용으로만 둔다
alter table public.wfh_days add column id uuid not null default gen_random_uuid();
alter table public.wfh_days drop constraint wfh_days_pkey;
alter table public.wfh_days add primary key (id);
alter table public.wfh_days add constraint wfh_days_user_day_key unique (user_id, day);
alter table public.wfh_days add column user_name text not null default '';

alter table public.wfh_days alter column user_id drop not null;
alter table public.wfh_days drop constraint wfh_days_user_id_fkey,
  add constraint wfh_days_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- 2) 회원 삭제: 내일 이후 재택 계획 삭제 → 남는 기록에 이름 보관 → 계정 삭제
create or replace function public.admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin() then
    raise exception '관리자만 회원을 삭제할 수 있어요';
  end if;
  if p_id = auth.uid() then
    raise exception '본인 계정은 삭제할 수 없어요';
  end if;
  if exists (select 1 from profiles where id = p_id and role = 'admin') then
    raise exception '관리자 계정은 삭제할 수 없어요';
  end if;
  delete from wfh_days where user_id = p_id and day > v_today;
  update wfh_days w set user_name = coalesce(nullif(p.name, ''), p.login_id)
    from profiles p where p.id = p_id and w.user_id = p_id;
  delete from auth.users where id = p_id; -- profiles는 함께 삭제, 재택 이력·주간보고·교육 기록은 작성자만 비워진다
end;
$$;
