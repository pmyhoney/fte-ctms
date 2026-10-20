/* window.storage 어댑터 — app.js는 원래 아티팩트용 window.storage.get/set(key, value, shared)로 저장했다.
   같은 모양을 유지해서 app.js를 거의 그대로 쓴다.
   - shared = true  → Supabase app_state 테이블 (팀 전체가 보는 데이터)
   - shared = false → 이 브라우저의 localStorage (마지막 백업 시각 같은 개인 메모) */
window.storage = {
  async get(key, shared){
    if(!shared){
      let v = null;
      try{ v = localStorage.getItem("fte:" + key); }catch(e){ throw new Error("storage unavailable"); }
      if(v === null) throw new Error("not found");
      return { key, value: v, shared: false };
    }
    const { data, error } = await sb.from("app_state").select("value").eq("key", key).maybeSingle();
    if(error) throw error;
    if(!data) throw new Error("not found");
    return { key, value: JSON.stringify(data.value), shared: true };
  },
  async set(key, value, shared){
    const v = String(value);
    if(!shared){
      try{ localStorage.setItem("fte:" + key, v); }catch(e){ throw new Error("storage unavailable"); }
      return { key, value: v, shared: false };
    }
    const { error } = await sb.from("app_state").upsert({ key, value: JSON.parse(v), updated_at: new Date().toISOString() });
    if(error) throw error;
    return { key, value: v, shared: true };
  },
};
