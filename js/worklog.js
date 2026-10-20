/* ---------------- 재택 · 주간보고 탭 ----------------
   두 탭의 데이터는 app_state(전체 JSON)와 따로 Supabase 테이블(wfh_days, weekly_reports)에 저장한다.
   회원이 자기 기록을 직접 쓰고, 권한은 DB 보안 정책(RLS)이 확인한다 — supabase/migrations/20261021000000_wfh_weekly.sql
   보기 전용 회원도 입력할 수 있도록 버튼·입력칸에는 view-ok 클래스를 붙인다. */

function ymd(d){
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function todayYmd(){ return ymd(new Date()); }

/* ---------------- 재택 (월간 달력) ---------------- */
// ym은 처음 열 때 이번 달로 정한다(currentPeriod는 app.js에 있음)
// days: 내 기록 "YYYY-MM-DD" -> { kind, journal } / others: 관리자에게만 — 다른 사람 기록 "YYYY-MM-DD" -> [{ name, kind, journal }]
const wfh = { ym: null, days: null, others: {}, loadedYm: null, names: null };
const WFH_KIND = { full: "종일", half: "반일" };

async function wfhLoad(){
  const ym = wfh.ym;
  const [y, m] = ym.split("-").map(Number);
  const first = ym + "-01";
  const last = ymd(new Date(y, m, 0));
  const me = currentProfile.id;
  let query = sb.from("wfh_days").select("user_id,day,kind,journal").gte("day", first).lte("day", last);
  if(!isAdmin()) query = query.eq("user_id", me);
  const { data, error } = await query;
  if(error){ showToast("재택 일정을 불러오지 못했어요: " + error.message, { error: true }); return; }
  if(isAdmin() && !wfh.names){ // 관리자: 달력에 이름을 보여주려고 회원 이름을 한 번 불러온다
    const res = await sb.from("profiles").select("id,name,login_id");
    wfh.names = {};
    (res.data || []).forEach(p => wfh.names[p.id] = p.name || p.login_id);
  }
  if(ym !== wfh.ym) return; // 불러오는 사이 다른 달로 넘어갔다
  wfh.days = {}; wfh.others = {};
  data.forEach(r => {
    const kind = WFH_KIND[r.kind] ? r.kind : "full";
    if(r.user_id === me) wfh.days[r.day] = { kind, journal: r.journal || "" };
    else if(isAdmin()) (wfh.others[r.day] = wfh.others[r.day] || []).push({ name: (wfh.names && wfh.names[r.user_id]) || "이름 없음", kind, journal: r.journal || "" });
  });
  Object.keys(wfh.others).forEach(k => wfh.others[k].sort((a, b) => a.name.localeCompare(b.name, "ko")));
  wfh.loadedYm = ym;
  if(state.tab === "wfh") renderTabContent();
}

function wfhMove(delta){
  wfh.ym = periodPlus(wfh.ym, delta);
  wfh.days = null;
  renderTabContent();
}

function renderWfhTab(){
  if(!wfh.ym) wfh.ym = currentPeriod();
  if(wfh.loadedYm !== wfh.ym || !wfh.days){
    if(wfh.loadingYm !== wfh.ym){
      const ym = wfh.loadingYm = wfh.ym;
      wfhLoad().finally(() => { if(wfh.loadingYm === ym) wfh.loadingYm = null; });
    }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  const [y, m] = wfh.ym.split("-").map(Number);
  const startDow = new Date(y, m-1, 1).getDay();
  const lastDay = new Date(y, m, 0).getDate();
  const today = todayYmd();
  const dows = ["일", "월", "화", "수", "목", "금", "토"];
  let cells = "";
  for(let i = 0; i < startDow; i++) cells += '<div></div>';
  for(let d = 1; d <= lastDay; d++){
    const key = wfh.ym + "-" + String(d).padStart(2,"0");
    const rec = wfh.days[key];
    const others = wfh.others[key] || [];
    const dow = (startDow + d - 1) % 7;
    const isToday = key === today;
    cells +=
      '<div class="wfh-cell' + (rec ? ' on' : '') + (isToday ? ' today' : '') + (key < today ? ' past' : '') + '" onclick="wfhClick(\'' + key + '\')">' +
        '<div class="wfh-num" style="' + (dow === 0 ? 'color:#D64550;' : dow === 6 ? 'color:#3E6FB0;' : '') + '">' + d + '</div>' +
        (rec ? '<div class="wfh-tag">재택 ' + WFH_KIND[rec.kind] + '</div>' : '') +
        (rec && rec.journal ? '<div class="wfh-tag journal">일지 ✓</div>' : '') +
        others.slice(0, 3).map((o, i) => '<div class="wfh-name click" onclick="event.stopPropagation();wfhOtherOpen(\'' + key + '\',' + i + ')">' + esc(o.name) + ' · ' + WFH_KIND[o.kind] + '</div>').join("") +
        (others.length > 3 ? '<div class="wfh-name click" onclick="event.stopPropagation();wfhDayListOpen(\'' + key + '\')">외 ' + (others.length - 3) + '명</div>' : '') +
      '</div>';
  }
  const count = Object.keys(wfh.days).length;
  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
      '<button class="icon-round view-ok" onclick="wfhMove(-1)">' + icon('chevronLeft', 15) + '</button>' +
      '<div style="font-weight:800;font-size:15px;">' + periodLabel(wfh.ym) + ' <span style="font-size:12px;color:#94A3B8;font-weight:600;">내 재택 ' + count + '일</span></div>' +
      '<button class="icon-round view-ok" onclick="wfhMove(1)">' + icon('chevronRight', 15) + '</button>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">' +
      '<button class="btn-export view-ok" onclick="wfhExport()">' + icon('download', 14) + ' ' + periodLabel(wfh.ym) + ' 재택·일지 엑셀</button>' +
    '</div>' +
    '<div class="wfh-grid">' +
      dows.map((w, i) => '<div class="wfh-dow" style="' + (i === 0 ? 'color:#D64550;' : i === 6 ? 'color:#3E6FB0;' : '') + '">' + w + '</div>').join("") +
      cells +
    '</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-top:12px;line-height:1.6;">' +
      '날짜를 누르면 반일·종일을 골라 재택을 신청하거나 취소할 수 있어요. 재택 당일(또는 지난 재택일)을 누르면 업무 일지를 쓸 수 있어요.' +
      (isAdmin() ? '<br/>관리자 화면이라 다른 팀원의 재택 신청도 이름으로 함께 보여요. 이름을 누르면 그 사람의 업무 일지를 볼 수 있어요.' : '') +
    '</div>' +
  '</div>';
}

// 관리자: 다른 팀원의 업무 일지 보기 (읽기 전용)
function wfhOtherOpen(key, i){
  const o = wfh.others[key][i];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + esc(o.name) + ' 업무 일지</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;">' + key + ' 재택근무 (' + WFH_KIND[o.kind] + ')</div>' +
    '<div style="max-height:320px;overflow-y:auto;white-space:pre-wrap;font-size:13px;line-height:1.6;color:#334155;background:#F8FAFC;border-radius:8px;padding:10px 12px;">' +
      (o.journal ? esc(o.journal) : '<span style="color:#94A3B8;">아직 작성한 일지가 없어요.</span>') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      (wfh.others[key].length > 1 ? '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="wfhDayListOpen(\'' + key + '\')">이날 재택 전체</button>' : '') +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
    '</div>'
  );
}
function wfhDayListOpen(key){
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + key + ' 재택 인원</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;">이름을 누르면 업무 일지를 볼 수 있어요.</div>' +
    '<div style="max-height:320px;overflow-y:auto;">' +
      wfh.others[key].map((o, i) =>
        '<div class="list-row" style="cursor:pointer;" onclick="wfhOtherOpen(\'' + key + '\',' + i + ')">' +
          '<span style="font-size:13px;font-weight:700;">' + esc(o.name) + ' <span style="font-weight:600;color:#64748B;">· ' + WFH_KIND[o.kind] + '</span></span>' +
          '<span style="font-size:12px;color:' + (o.journal ? 'var(--accent)' : '#94A3B8') + ';">' + (o.journal ? '일지 ✓' : '일지 없음') + '</span>' +
        '</div>'
      ).join("") +
    '</div>' +
    '<button class="add-btn" style="width:100%;justify-content:center;margin-top:12px;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>'
  );
}

// 보고 있는 달의 재택 이력·일지를 엑셀로 (관리자는 전체 팀원, 회원은 본인 것만)
async function wfhExport(){
  const myName = currentProfile.name || currentProfile.login_id;
  const rows = [];
  Object.keys(wfh.days).forEach(day => rows.push({ day, name: myName, kind: wfh.days[day].kind, journal: wfh.days[day].journal }));
  Object.keys(wfh.others).forEach(day => wfh.others[day].forEach(o => rows.push({ day, name: o.name, kind: o.kind, journal: o.journal })));
  if(rows.length === 0){ showToast(periodLabel(wfh.ym) + "에는 재택 기록이 없어요"); return; }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "ko"));
  const data = rows.map(r => ({ "날짜": r.day, "이름": r.name, "구분": WFH_KIND[r.kind], "업무 일지": r.journal }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "재택 " + wfh.ym);
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("재택_" + wfh.ym + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function wfhClick(key){
  const today = todayYmd();
  const rec = wfh.days[key];
  if(key <= today && rec){ wfhJournalOpen(key); return; }
  if(key < today){ showToast("지난 날짜는 재택으로 신청할 수 없어요"); return; }
  wfhPlanOpen(key);
}

// 재택 신청/변경 팝업: 반일·종일 선택, 이미 신청했다면 취소
function wfhPlanOpen(key){
  const rec = wfh.days[key];
  const btn = (kind) => '<button class="add-btn" style="flex:1;justify-content:center;padding:14px 0;font-size:14px;' +
    (rec && rec.kind === kind ? '' : 'background:#fff;color:var(--accent);border:1px solid var(--accent);') +
    '" onclick="wfhPlanSave(\'' + key + '\',\'' + kind + '\')">' + WFH_KIND[kind] + '</button>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + (rec ? '재택 변경' : '재택 신청') + '</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:14px;">' + key + (rec ? ' · 지금 ' + WFH_KIND[rec.kind] + ' 신청됨' : '') + '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' + btn("half") + btn("full") + '</div>' +
    '<div style="display:flex;gap:8px;">' +
      (rec ? '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;" onclick="wfhCancel(\'' + key + '\')">재택 취소</button>' : '') +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
    '</div>'
  );
}

async function wfhPlanSave(key, kind){
  const rec = wfh.days[key];
  const { error } = rec
    ? await sb.from("wfh_days").update({ kind, updated_at: new Date().toISOString() }).eq("user_id", currentProfile.id).eq("day", key)
    : await sb.from("wfh_days").insert({ day: key, kind });
  if(error){ showToast("신청하지 못했어요: " + error.message, { error: true }); return; }
  wfh.days[key] = { kind, journal: rec ? rec.journal : "" };
  closeModal();
  showToast(key + " 재택(" + WFH_KIND[kind] + ")으로 신청했어요");
  renderTabContent();
  if(key === todayYmd()) wfhJournalOpen(key); // 당일에 신청하면 바로 일지 작성
}

function wfhJournalOpen(key){
  const rec = wfh.days[key];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">업무 일지</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;">' + key + ' 재택근무 (' + WFH_KIND[rec.kind] + ')</div>' +
    '<textarea id="wfh-journal" class="input" rows="10" style="resize:vertical;line-height:1.5;" placeholder="오늘 한 업무를 적어 주세요">' + esc(rec.journal) + '</textarea>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      (key === todayYmd() ? '<button class="add-btn" style="background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="wfhPlanOpen(\'' + key + '\')">변경·취소</button>' : '') +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;" onclick="wfhJournalSave(\'' + key + '\')">저장</button>' +
    '</div>'
  );
  setTimeout(() => { const el = document.getElementById("wfh-journal"); if(el) el.focus(); }, 50);
}

async function wfhJournalSave(key){
  const journal = document.getElementById("wfh-journal").value;
  const { error } = await sb.from("wfh_days").update({ journal, updated_at: new Date().toISOString() })
    .eq("user_id", currentProfile.id).eq("day", key);
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  wfh.days[key].journal = journal;
  closeModal();
  showToast("업무 일지를 저장했어요");
  renderTabContent();
}

async function wfhCancel(key, confirmed){
  if(wfh.days[key].journal && !confirmed){
    showModal(
      '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">재택 취소</div>' +
      '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">작성한 업무 일지도 함께 지워져요. 재택을 취소할까요?</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="wfhJournalOpen(\'' + key + '\')">돌아가기</button>' +
        '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="wfhCancel(\'' + key + '\', true)">재택 취소</button>' +
      '</div>'
    );
    return;
  }
  const { error } = await sb.from("wfh_days").delete().eq("user_id", currentProfile.id).eq("day", key);
  if(error){ showToast("취소하지 못했어요: " + error.message, { error: true }); return; }
  delete wfh.days[key];
  closeModal();
  showToast(key + " 재택을 취소했어요");
  renderTabContent();
}

/* ---------------- 주간보고 (방문 로그) ---------------- */
const WEEKLY_COLS = [
  { key: "visit_date", label: "날짜" },
  { key: "task_name", label: "과제명" },
  { key: "visit_place", label: "방문처" },
  { key: "region", label: "지역" },
  { key: "pi_name", label: "PI명" },
  { key: "reason", label: "방문사유" },
  { key: "visitor", label: "방문자" },
];
const weekly = { rows: null, selected: {} }; // selected: id -> true

async function weeklyLoad(){
  const { data, error } = await sb.from("weekly_reports").select("*")
    .order("visit_date", { ascending: false }).order("created_at", { ascending: false });
  if(error){ showToast("주간보고를 불러오지 못했어요: " + error.message, { error: true }); return; }
  weekly.rows = data;
  if(state.tab === "weekly") renderTabContent();
}

function renderWeeklyTab(){
  if(!weekly.rows){
    if(!weekly.loading){ weekly.loading = true; weeklyLoad().finally(() => { weekly.loading = false; }); }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  const inp = (key, label, type, ph, val) =>
    '<div><div class="field-label">' + label + '</div>' +
    '<input id="wk-' + key + '" class="input view-ok" type="' + type + '" placeholder="' + ph + '" value="' + esc(val || "") + '"/></div>';
  const form = '<div class="card">' +
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">방문 기록 추가</div>' +
    '<div class="wk-form">' +
      inp("visit_date", "날짜", "date", "", todayYmd()) +
      inp("task_name", "과제명", "text", "예: OO 시판후조사", "") +
      inp("visit_place", "방문처", "text", "예: OO대학교병원", "") +
      inp("region", "지역", "text", "예: 서울", "") +
      inp("pi_name", "PI명", "text", "예: 홍길동 교수", "") +
      inp("reason", "방문사유", "text", "예: SIV", "") +
      inp("visitor", "방문자", "text", "", currentProfile ? currentProfile.name : "") +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
      '<button class="add-btn view-ok" id="wk-add" onclick="weeklyAdd()">' + icon('plus', 13) + ' 추가</button>' +
    '</div>' +
  '</div>';

  const rows = weekly.rows;
  const selCount = rows.filter(r => weekly.selected[r.id]).length;
  const allOn = rows.length > 0 && selCount === rows.length;
  const canDelete = (r) => isAdmin() || (currentProfile && r.user_id === currentProfile.id);
  const table = rows.length === 0 ? '<div class="empty">아직 기록이 없어요. 위에서 방문 기록을 추가해 주세요.</div>' :
    '<div style="overflow-x:auto;"><table>' +
      '<thead><tr>' +
        '<th style="width:32px;"><input type="checkbox" class="view-ok" ' + (allOn ? 'checked' : '') + ' onclick="weeklySelectAll(this.checked)"/></th>' +
        WEEKLY_COLS.map(c => '<th>' + c.label + '</th>').join("") + '<th></th>' +
      '</tr></thead><tbody>' +
      rows.map(r => {
        const on = !!weekly.selected[r.id];
        return '<tr style="cursor:pointer;' + (on ? 'background:#E5F1F1;' : '') + '" onclick="weeklyToggle(\'' + r.id + '\')">' +
          '<td><input type="checkbox" class="view-ok" ' + (on ? 'checked' : '') + ' style="pointer-events:none;"/></td>' +
          WEEKLY_COLS.map(c => '<td' + (c.key === "reason" ? ' style="white-space:normal;min-width:140px;text-align:left;"' : '') + '>' + esc(r[c.key]) + '</td>').join("") +
          '<td>' + (canDelete(r) ? '<button class="icon-btn view-ok" title="삭제" onclick="event.stopPropagation();weeklyDeleteConfirm(\'' + r.id + '\')">' + icon('trash', 14) + '</button>' : '') + '</td>' +
        '</tr>';
      }).join("") +
    '</tbody></table></div>';

  return '<div class="stack">' + form +
    '<div class="card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:14px;">방문 로그 <span style="font-size:12px;color:#94A3B8;font-weight:600;">' + rows.length + '건 · 행을 눌러 선택</span></div>' +
        '<button class="btn-export view-ok" onclick="weeklyExport()"' + (selCount === 0 ? ' disabled style="opacity:0.4;"' : '') + '>' + icon('download', 14) + ' 선택 ' + selCount + '건 엑셀 다운로드</button>' +
      '</div>' +
      table +
    '</div>' +
  '</div>';
}

async function weeklyAdd(){
  const rec = {};
  WEEKLY_COLS.forEach(c => rec[c.key] = document.getElementById("wk-" + c.key).value.trim());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rec.visit_date)){ showToast("날짜를 YYYY-MM-DD 형식으로 입력해 주세요", { error: true }); return; }
  if(!rec.task_name && !rec.visit_place){ showToast("과제명이나 방문처를 입력해 주세요", { error: true }); return; }
  const btn = document.getElementById("wk-add");
  if(btn) btn.disabled = true;
  const { error } = await sb.from("weekly_reports").insert(rec);
  if(btn) btn.disabled = false;
  if(error){ showToast("추가하지 못했어요: " + error.message, { error: true }); return; }
  showToast("방문 기록을 추가했어요");
  weekly.rows = null; // 다시 불러와서 정렬 순서대로 보여준다
  renderTabContent();
}

function weeklyToggle(id){
  if(weekly.selected[id]) delete weekly.selected[id]; else weekly.selected[id] = true;
  renderTabContent();
}
function weeklySelectAll(on){
  weekly.selected = {};
  if(on) weekly.rows.forEach(r => weekly.selected[r.id] = true);
  renderTabContent();
}

function weeklyDeleteConfirm(id){
  const r = weekly.rows.find(x => x.id === id);
  if(!r) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">방문 기록 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">' + esc(r.visit_date) + ' · ' + esc(r.task_name || r.visit_place) + ' 기록을 삭제할까요? 되돌릴 수 없어요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="weeklyDelete(\'' + id + '\')">삭제</button>' +
    '</div>'
  );
}
async function weeklyDelete(id){
  const { error } = await sb.from("weekly_reports").delete().eq("id", id);
  closeModal();
  if(error){ showToast("삭제하지 못했어요: " + error.message, { error: true }); return; }
  weekly.rows = weekly.rows.filter(r => r.id !== id);
  delete weekly.selected[id];
  showToast("삭제했어요");
  renderTabContent();
}

async function weeklyExport(){
  const picked = weekly.rows.filter(r => weekly.selected[r.id]);
  if(picked.length === 0) return;
  const data = picked.map(r => {
    const row = {};
    WEEKLY_COLS.forEach(c => row[c.label] = r[c.key]);
    return row;
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "주간보고");
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("주간보고_" + todayYmd() + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// 로그아웃할 때 다른 사람이 이어서 로그인해도 이전 계정의 기록이 보이지 않게 비운다.
function worklogReset(){
  wfh.ym = null; wfh.days = null; wfh.others = {}; wfh.loadedYm = null; wfh.names = null;
  weekly.rows = null; weekly.selected = {};
}
