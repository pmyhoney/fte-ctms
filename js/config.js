/* Supabase 연결 설정.
   이 키는 공개용(publishable) 키라 GitHub에 올라가도 괜찮다 — 데이터는 DB의 보안 정책(RLS)으로 보호된다.
   로그인 상태는 sessionStorage에 두어, 탭을 닫으면 로그아웃되고 새 창에서는 다시 로그인하게 한다. */
const SUPABASE_URL = "https://fnfphrbffdecvfemwvif.supabase.co";
const SUPABASE_KEY = "sb_publishable_NdBrtvfJQtN9PELfD-kMpg_tTxbFQ4F";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: window.sessionStorage },
});
