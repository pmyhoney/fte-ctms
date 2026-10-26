/* ---------------- 변경 이력 탭 (관리자) ----------------
   - 데이터 변경 이력: 재택·주간보고·교육·전달교육·KOL·IIT·회원 정보의 추가/수정/삭제를 DB 트리거가 audit_log에 남긴다.
     항목을 누르면 바뀐 내용을 보고, 그 변경 하나를 되돌릴 수 있다 (audit_revert).
   - FTE·CTMS 스냅샷: app_state가 저장될 때마다 app_state_versions에 통째로 보관된다 (같은 사람이 10분 안에 이어서 저장하면 한 버전).
     버전별 바뀐 내용 보기·JSON 내려받기·그 버전으로 복원(app_state_restore)을 할 수 있다.
   — supabase/migrations/20261103000000_audit_history.sql */

const HIST_TABLES = {
  wfh_days: "재택", weekly_reports: "주간보고", trainings: "교육 이력", tx_sessions: "전달교육",
  kols: "KOL", kol_categories: "KOL 분류", iit_projects: "IIT 관리", profiles: "회원 정보",
};
const HIST_OPS = {
  INSERT: { label: "추가", c: "#1E7A4F", s: "#E7F6EC" },
  UPDATE: { label: "수정", c: "#1F5C8C", s: "#E6EFF7" },
  DELETE: { label: "삭제", c: "#B91C1C", s: "#FDECEC" },
};
// 화면에 보여줄 필드 이름 (없는 키는 그대로 표시)
const HIST_FIELD = {
  day: "날짜", journal: "업무 일지", kind: "구분", visit_date: "방문일", task_name: "과제명", visit_place: "방문처", region: "지역",
  pi_name: "PI명", reason: "방문사유", visitor: "방문자", member: "팀원", edu_date: "이수일", title: "제목", org: "주관",
  hours: "시간", scope: "사내/사외", edu_type: "교육 유형", tx_need: "전달교육 대상", tx_status: "전달교육 상태",
  tx_plan_date: "전달교육 계획일", tx_done_date: "전달교육 완료일", note: "비고", session_date: "교육일", educator: "교육자",
  attendees: "참석자", name: "이름", description: "설명", login_id: "아이디", role: "권한", approved: "승인",
  member_id: "연결 팀원", kol_editor: "KOL 편집", hidden: "목록에서 뺌", group_id: "배정 과제",
  "data.taskName": "과제명", "data.product": "품목명", "data.code": "과제코드", "data.site": "기관명",
  "data.investigator": "연구자명", "data.manager": "담당자", "data.support": "지원범위", "data.status": "진행 현황",
  "data.pub": "Publication", "data.detail": "상세 정보", "data.line": "과제 구분",
  "data.name": "성명", "data.tier": "구분", "data.society": "학회", "data.role": "직위/역할", "data.hospital": "소속병원",
  "data.category": "분류", "data.evaluation": "협조도 평가", "data.note": "비고",
};
const HIST_SKIP = ["id", "user_id", "created_at", "updated_at", "updated_by", "training_id"];
const HIST_EMPTY_F = () => ({ table: "", op: "", q: "" });
const hist = { view: "log", log: null, versions: null, f: HIST_EMPTY_F(), limit: 200, loading: false };

function histReset(){ hist.log = null; hist.versions = null; hist.f = HIST_EMPTY_F(); hist.view = "log"; hist.limit = 200; }
function histReload(){ hist.log = null; hist.versions = null; renderTabContent(); }
function histSetView(v){ hist.view = v; renderTabContent(); }
function histFilter(key, value){
  hist.f[key] = value;
  if(key !== "q") hist.log = null; // 표·작업 필터는 서버에서 다시 불러온다
  renderTabContentPreserveFocus();
}
function histMore(){ hist.limit += 200; hist.log = null; renderTabContent(); }

const histDt = (iso) => {
  if(!iso) return "";
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
};
const histUserName = (uid) => { const p = (profilesCache || []).find(x => x.id === uid); return p ? p.name : ""; }; // app.js

async function histLoad(){
  hist.loading = true;
  try{
    if(hist.view === "log"){
      let q = sb.from("audit_log").select("id,at,actor_name,table_name,op,row_key,old_row,new_row").order("id", { ascending: false }).limit(hist.limit);
      if(hist.f.table) q = q.eq("table_name", hist.f.table);
      if(hist.f.op) q = q.eq("op", hist.f.op);
      const { data, error } = await q;
      if(error) throw error;
      hist.log = data;
      if(profilesCache === null) loadProfiles(); // 재택 기록의 주인 이름 표시용
    }else{
      const { data, error } = await sb.from("app_state_versions").select("id,key,summary,started_at,saved_at,saved_by_name,note").order("id", { ascending: false }).limit(100);
      if(error) throw error;
      hist.versions = data;
    }
  }catch(e){
    showToast("변경 이력을 불러오지 못했어요: " + e.message, { error: true });
    if(hist.view === "log") hist.log = hist.log || []; else hist.versions = hist.versions || [];
  }
  hist.loading = false;
  if(state.tab === "history") renderTabContent();
}

// 목록 한 줄 요약: 어떤 항목이 바뀌었는지
function histTitle(e){
  const r = e.new_row || e.old_row || {}, d = r.data || {};
  const j = (...a) => a.filter(Boolean).join(" · ");
  switch(e.table_name){
    case "wfh_days": return j(histUserName(r.user_id), r.day);
    case "weekly_reports": return j(r.visit_date, r.task_name, r.visit_place);
    case "trainings": return j(r.member, r.edu_date, r.title);
    case "tx_sessions": return j(r.session_date, r.title);
    case "kols": return j(d.name, d.hospital);
    case "kol_categories": return r.name || "";
    case "iit_projects": return j(d.taskName, d.product);
    case "profiles": return j(r.name, r.login_id);
  }
  return e.row_key || "";
}

// 바뀐 필드 목록 [이름, 이전, 이후] — data(jsonb) 안은 한 단계 펼쳐서 비교
function histFlat(row){
  const out = {};
  Object.keys(row || {}).forEach(k => {
    if(HIST_SKIP.includes(k)) return;
    const v = row[k];
    if(k === "data" && v && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach(k2 => { out["data." + k2] = v[k2]; });
    else out[k] = v;
  });
  return out;
}
function histVal(v){
  if(v === null || v === undefined || v === "") return '<span style="color:#CBD5E1;">–</span>';
  if(typeof v === "boolean") return v ? "예" : "아니오";
  if(typeof v === "object") return '<code style="font-size:11px;white-space:pre-wrap;word-break:break-all;">' + esc(JSON.stringify(v, null, 1)) + '</code>';
  return '<span style="white-space:pre-wrap;word-break:break-word;">' + esc(String(v)) + '</span>';
}
function histChanges(e){
  const o = histFlat(e.old_row), n = histFlat(e.new_row);
  const keys = [...new Set(Object.keys(o).concat(Object.keys(n)))];
  return keys.filter(k => e.op !== "UPDATE" || JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .filter(k => e.op === "UPDATE" || (e.op === "INSERT" ? n[k] : o[k]) !== "" && (e.op === "INSERT" ? n[k] : o[k]) !== null)
    .map(k => [HIST_FIELD[k] || k.replace(/^data\./, ""), o[k], n[k]]);
}

function histOpBadge(op){
  const m = HIST_OPS[op] || { label: op, c: "#475569", s: "#F1F5F9" };
  return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;color:' + m.c + ';background:' + m.s + ';">' + m.label + '</span>';
}

function renderHistoryTab(){
  const tabBtn = (v, label) => '<button class="view-ok" onclick="histSetView(\'' + v + '\')" style="flex:1;padding:9px 6px;border-radius:8px;border:1px solid ' +
    (hist.view === v ? "var(--accent)" : "var(--border)") + ';background:' + (hist.view === v ? "var(--accent)" : "#fff") + ';color:' + (hist.view === v ? "#fff" : "#475569") + ';font-size:13px;font-weight:700;">' + label + '</button>';
  const head = '<div style="display:flex;gap:6px;margin-bottom:14px;">' + tabBtn("log", "데이터 변경 이력") + tabBtn("versions", "FTE·CTMS 스냅샷") + '</div>';
  const data = hist.view === "log" ? hist.log : hist.versions;
  if(!data){
    if(!hist.loading) histLoad();
    return head + '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  return head + (hist.view === "log" ? histLogHtml() : histVersionsHtml());
}

function histLogHtml(){
  const f = hist.f, q = f.q.trim().toLowerCase();
  const list = hist.log.filter(e => !q || (e.actor_name + " " + histTitle(e)).toLowerCase().includes(q));
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  const sel = (key, opts) => '<select class="input view-ok" style="width:auto;" onchange="histFilter(\'' + key + '\', this.value)">' + opts.map(o => opt(o[0], o[1], f[key])).join("") + '</select>';
  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div style="font-weight:800;font-size:14px;">데이터 변경 이력 <span style="font-size:12px;color:#94A3B8;font-weight:600;">최근 ' + hist.log.length + '건</span></div>' +
      '<button class="btn-export view-ok" onclick="histReload()">' + icon('refresh', 14) + ' 새로고침</button>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<input id="hist-q" class="input view-ok" style="flex:1;min-width:180px;" placeholder="사용자·항목 검색" value="' + esc(f.q) + '" oninput="histFilter(\'q\', this.value)"/>' +
      sel("table", [["", "전체 메뉴"]].concat(Object.keys(HIST_TABLES).map(k => [k, HIST_TABLES[k]]))) +
      sel("op", [["", "전체 작업"], ["INSERT", "추가"], ["UPDATE", "수정"], ["DELETE", "삭제"]]) +
    '</div>' +
    (list.length === 0 ? '<div class="empty">' + (hist.log.length ? '조건에 맞는 기록이 없어요.' : '아직 변경 기록이 없어요. 이 기능을 추가한 뒤의 변경부터 기록돼요.') + '</div>' :
      '<div style="overflow-x:auto;"><table><thead><tr><th>시각</th><th>사용자</th><th>메뉴</th><th>작업</th><th>항목</th></tr></thead><tbody>' +
      list.map(e => '<tr class="iit-row" title="눌러서 바뀐 내용 보기" onclick="histDetailOpen(' + e.id + ')">' +
        '<td>' + histDt(e.at) + '</td>' +
        '<td>' + esc(e.actor_name || "–") + '</td>' +
        '<td>' + esc(HIST_TABLES[e.table_name] || e.table_name) + '</td>' +
        '<td>' + histOpBadge(e.op) + '</td>' +
        '<td style="text-align:left;white-space:normal;min-width:200px;">' + esc(histTitle(e) || "–") + '</td>' +
      '</tr>').join("") + '</tbody></table></div>') +
    (hist.log.length >= hist.limit ? '<div style="text-align:center;margin-top:12px;"><button class="btn-export view-ok" style="display:inline-flex;" onclick="histMore()">더 보기</button></div>' : '') +
    '<div style="font-size:11.5px;color:#94A3B8;margin-top:12px;line-height:1.6;">재택·주간보고·교육·전달교육·KOL·IIT 관리·회원 정보의 변경이 자동으로 기록되고, 1년이 지난 기록은 정리돼요. FTE 관리·CTMS 변경은 \'FTE·CTMS 스냅샷\'에서 확인해요.</div>' +
  '</div>';
}

function histDetailOpen(id){
  const e = (hist.log || []).find(x => x.id === id);
  if(!e) return;
  const rows = histChanges(e);
  const canRevert = e.table_name !== "profiles";
  const revertLabel = { INSERT: "추가 취소 (삭제)", UPDATE: "이전 내용으로 되돌리기", DELETE: "삭제 취소 (다시 추가)" }[e.op];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      esc(HIST_TABLES[e.table_name] || e.table_name) + ' ' + histOpBadge(e.op) + '</div>' +
    '<div style="font-size:12px;color:#64748B;margin-bottom:12px;">' + histDt(e.at) + ' · ' + esc(e.actor_name || "–") + (histTitle(e) ? ' · ' + esc(histTitle(e)) : '') + '</div>' +
    '<div class="modal-scroll">' +
      (rows.length === 0 ? '<div class="empty">표시할 변경 내용이 없어요.</div>' :
        '<table style="min-width:0;"><thead><tr><th style="text-align:left;">항목</th>' + (e.op === "UPDATE" ? '<th style="text-align:left;">이전</th><th style="text-align:left;">이후</th>' : '<th style="text-align:left;">내용</th>') + '</tr></thead><tbody>' +
        rows.map(([k, o, n]) => '<tr><td style="text-align:left;vertical-align:top;font-weight:700;color:#475569;">' + esc(k) + '</td>' +
          (e.op === "UPDATE" ? '<td style="text-align:left;vertical-align:top;white-space:normal;color:#B91C1C;">' + histVal(o) + '</td><td style="text-align:left;vertical-align:top;white-space:normal;color:#1E7A4F;">' + histVal(n) + '</td>'
            : '<td style="text-align:left;vertical-align:top;white-space:normal;">' + histVal(e.op === "INSERT" ? n : o) + '</td>') + '</tr>').join("") +
        '</tbody></table>') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
      (canRevert ? '<button class="add-btn view-ok" style="flex:1;justify-content:center;" onclick="histRevertConfirm(' + e.id + ')">' + revertLabel + '</button>' : '') +
    '</div>', "md"
  );
}
function histRevertConfirm(id){
  const e = (hist.log || []).find(x => x.id === id);
  if(!e) return;
  const what = { INSERT: "추가된 항목을 삭제", UPDATE: "항목을 이 변경 전 내용으로 되돌리", DELETE: "삭제된 항목을 다시 추가" }[e.op];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">변경 되돌리기</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;"><b>' + esc(histTitle(e) || HIST_TABLES[e.table_name]) + '</b><br/>' + what + '할까요?' +
      (e.op === "UPDATE" ? '<br/>이 변경 뒤에 같은 항목을 또 고쳤다면 그 내용도 함께 이전으로 돌아가요.' : '') +
      '<br/>되돌린 것도 기록에 남아서 다시 되돌릴 수 있어요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="histDetailOpen(' + id + ')">취소</button>' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;" onclick="histRevert(' + id + ')">되돌리기</button>' +
    '</div>'
  );
}
async function histRevert(id){
  const { error } = await sb.rpc("audit_revert", { p_id: id });
  if(error){ showToast(error.message, { error: true }); return; }
  closeModal();
  showToast("되돌렸어요");
  // 해당 탭은 다음에 열 때 새로 불러온다 (필터는 그대로)
  wfh.days = null; wfh.others = {}; wfh.loadedYm = null; weekly.rows = null; training.rows = null; training.sessions = null; // worklog.js
  kol.rows = null; kol.cats = null; iit.rows = null; // kol.js, iit.js
  histReload();
}

/* ---- FTE·CTMS 스냅샷 ---- */
const HIST_SUM = [["members", "팀원"], ["assignments", "배정"], ["products", "품목"], ["taskTypes", "과제 유형"], ["ctms", "CTMS"]];
function histVersionsHtml(){
  const vs = hist.versions;
  const sumHtml = (v, prev) => HIST_SUM.map(([k, label]) => {
    const n = (v.summary || {})[k] || 0, d = prev ? n - ((prev.summary || {})[k] || 0) : 0;
    return '<span style="white-space:nowrap;">' + label + ' ' + n + (d ? ' <b style="color:' + (d > 0 ? '#1E7A4F' : '#B91C1C') + ';">' + (d > 0 ? '+' : '') + d + '</b>' : '') + '</span>';
  }).join('<span style="color:#CBD5E1;"> · </span>');
  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div style="font-weight:800;font-size:14px;">FTE·CTMS 스냅샷 <span style="font-size:12px;color:#94A3B8;font-weight:600;">최근 ' + vs.length + '개</span></div>' +
      '<button class="btn-export view-ok" onclick="histReload()">' + icon('refresh', 14) + ' 새로고침</button>' +
    '</div>' +
    (vs.length === 0 ? '<div class="empty">아직 스냅샷이 없어요.</div>' :
      '<div style="overflow-x:auto;"><table><thead><tr><th>저장 시각</th><th>저장한 사람</th><th>데이터 (직전 대비)</th><th class="iit-act"></th></tr></thead><tbody>' +
      vs.map((v, i) => '<tr>' +
        '<td>' + histDt(v.saved_at) + (histDt(v.started_at) !== histDt(v.saved_at) ? '<div style="font-size:11px;color:#94A3B8;">' + histDt(v.started_at).slice(11) + '부터</div>' : '') + '</td>' +
        '<td>' + esc(v.saved_by_name || "–") + (i === 0 ? ' <span style="font-size:11px;font-weight:700;color:var(--accent);">현재</span>' : '') +
          (v.note ? '<div style="font-size:11px;color:#B45309;">' + esc(v.note) + '</div>' : '') + '</td>' +
        '<td style="white-space:normal;font-size:12px;color:#475569;min-width:220px;">' + sumHtml(v, vs[i + 1]) + '</td>' +
        '<td class="iit-act"><div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;">' +
          (vs[i + 1] ? '<button class="btn-export view-ok" style="padding:5px 9px;font-size:12px;white-space:nowrap;" onclick="histVersionDiff(' + v.id + ',' + vs[i + 1].id + ')">바뀐 내용</button>' : '') +
          '<button class="icon-btn view-ok" title="JSON 내려받기" style="color:#64748B;" onclick="histVersionDownload(' + v.id + ')">' + icon('download', 14) + '</button>' +
          (i > 0 ? '<button class="add-btn view-ok" style="padding:5px 9px;font-size:12px;white-space:nowrap;" onclick="histRestoreConfirm(' + v.id + ')">이 버전으로 복원</button>' : '') +
        '</div></td>' +
      '</tr>').join("") + '</tbody></table></div>') +
    '<div style="font-size:11.5px;color:#94A3B8;margin-top:12px;line-height:1.6;">FTE 관리·CTMS 데이터가 저장될 때마다 자동으로 보관돼요. 같은 사람이 10분 안에 이어서 저장한 내용은 한 버전으로 묶여요. 180일이 지난 버전은 정리되지만 최근 30개는 항상 남아요.</div>' +
  '</div>';
}

async function histVersionValues(ids){
  const { data, error } = await sb.from("app_state_versions").select("id,value,saved_at").in("id", ids);
  if(error){ showToast("스냅샷을 불러오지 못했어요: " + error.message, { error: true }); return null; }
  return ids.map(id => data.find(d => d.id === id));
}
async function histVersionDownload(id){
  const r = await histVersionValues([id]);
  if(!r || !r[0]) return;
  const blob = new Blob([JSON.stringify(r[0].value, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "FTE_CTMS_스냅샷_" + histDt(r[0].saved_at).replace(/[: ]/g, "-") + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 두 버전 사이에 무엇이 바뀌었는지 (id가 있는 목록은 추가·삭제·수정, CTMS는 과제별 수정 여부)
function histStateDiff(oldV, newV){
  const sections = [];
  const memberName = (v, id) => { const m = (v.members || []).find(x => x.id === id); return m ? m.name : ""; };
  const byId = (arr) => new Map((Array.isArray(arr) ? arr : []).map(x => [x.id, x]));
  const listDiff = (key, label, nameOf) => {
    const o = byId(oldV[key]), n = byId(newV[key]), out = [];
    n.forEach((x, id) => { if(!o.has(id)) out.push(["추가", nameOf(x, newV)]); else if(JSON.stringify(o.get(id)) !== JSON.stringify(x)) out.push(["수정", nameOf(x, newV)]); });
    o.forEach((x, id) => { if(!n.has(id)) out.push(["삭제", nameOf(x, oldV)]); });
    if(out.length) sections.push([label, out]);
  };
  listDiff("members", "팀원", (x) => x.name);
  listDiff("products", "품목", (x) => x.name);
  listDiff("taskTypes", "과제 유형", (x) => x.name);
  listDiff("assignments", "과제 배정", (x, v) => [x.taskName, memberName(v, x.memberId)].filter(Boolean).join(" · "));
  const taskOf = (gid) => { const a = (newV.assignments || []).concat(oldV.assignments || []).find(x => (x.groupId || x.id) === gid); return a ? a.taskName : gid; };
  [["ctms", "CTMS 진행"], ["ctmsCost", "CTMS 비용"], ["ctmsIssues", "CTMS 이슈"]].forEach(([key, label]) => {
    const o = oldV[key] || {}, n = newV[key] || {}, out = [];
    [...new Set(Object.keys(o).concat(Object.keys(n)))].forEach(gid => {
      if(!(gid in o)) out.push(["추가", taskOf(gid)]);
      else if(!(gid in n)) out.push(["삭제", taskOf(gid)]);
      else if(JSON.stringify(o[gid]) !== JSON.stringify(n[gid])) out.push(["수정", taskOf(gid)]);
    });
    if(out.length) sections.push([label, out]);
  });
  return sections;
}
async function histVersionDiff(id, prevId){
  const r = await histVersionValues([prevId, id]);
  if(!r || !r[0] || !r[1]) return;
  const sections = histStateDiff(r[0].value, r[1].value);
  const opColor = { "추가": "INSERT", "수정": "UPDATE", "삭제": "DELETE" };
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">바뀐 내용</div>' +
    '<div style="font-size:12px;color:#64748B;margin-bottom:12px;">' + histDt(r[0].saved_at) + ' 버전 → ' + histDt(r[1].saved_at) + ' 버전</div>' +
    '<div class="modal-scroll">' +
      (sections.length === 0 ? '<div class="empty">팀원·품목·과제 유형·배정·CTMS에는 바뀐 내용이 없어요.</div>' :
        sections.map(([label, items]) => '<div style="margin-bottom:12px;"><div style="font-weight:700;font-size:13px;margin-bottom:6px;">' + label + ' <span style="color:#94A3B8;font-weight:600;">' + items.length + '건</span></div>' +
          items.map(([op, name]) => '<div style="display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;">' + histOpBadge(opColor[op]) + '<span>' + esc(name || "(이름 없음)") + '</span></div>').join("") +
        '</div>').join("")) +
    '</div>' +
    '<button class="add-btn view-ok" style="width:100%;justify-content:center;margin-top:14px;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>', "md"
  );
}

function histRestoreConfirm(id){
  const v = (hist.versions || []).find(x => x.id === id);
  if(!v) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">스냅샷으로 복원</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;"><b>' + histDt(v.saved_at) + '</b> 버전으로 FTE 관리·CTMS 데이터를 되돌릴까요?<br/>' +
      '지금 상태도 스냅샷에 남아 있어서 다시 복원할 수 있어요.<br/><b style="color:var(--danger);">복원 후 다른 관리자·팀장은 화면을 새로고침해야 해요.</b> 새로고침 전에 저장하면 예전 화면 내용으로 다시 덮어쓸 수 있어요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:var(--danger);" onclick="histRestore(' + id + ')">복원</button>' +
    '</div>'
  );
}
async function histRestore(id){
  if(saveTimer) await saveNow(); // 저장 대기 중인 변경을 먼저 저장해 두어 그것도 스냅샷에 남긴다 (app.js)
  const { error } = await sb.rpc("app_state_restore", { p_id: id });
  if(error){ showToast(error.message, { error: true }); return; }
  closeModal();
  showToast("복원했어요. 화면을 새로 불러올게요");
  setTimeout(() => location.reload(), 900);
}
