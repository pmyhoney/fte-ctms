/* ---------------- 재택 · 주간보고 탭 ----------------
   두 탭의 데이터는 app_state(전체 JSON)와 따로 Supabase 테이블(wfh_days, weekly_reports)에 저장한다.
   회원이 자기 기록을 직접 쓰고, 권한은 DB 보안 정책(RLS)이 확인한다 — supabase/migrations/20261021000000_wfh_weekly.sql
   보기 전용 회원도 입력할 수 있도록 버튼·입력칸에는 view-ok 클래스를 붙인다. */

function ymd(d){
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function todayYmd(){ return ymd(new Date()); }
// 뷰어는 조회만 가능 (DB의 can_write 정책과 같은 기준)
function canWrite(){ return !!currentProfile && currentProfile.role !== "viewer"; }

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
  let query = sb.from("wfh_days").select("user_id,user_name,day,kind,journal").gte("day", first).lte("day", last);
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
    else if(isAdmin()) (wfh.others[r.day] = wfh.others[r.day] || []).push({ name: wfhName(r, wfh.names), kind, journal: r.journal || "" });
  });
  Object.keys(wfh.others).forEach(k => wfh.others[k].sort((a, b) => a.name.localeCompare(b.name, "ko")));
  wfh.loadedYm = ym;
  if(state.tab === "wfh") renderTabContent();
}

// 삭제된 회원의 남은 재택 이력은 작성자(user_id)가 비고 이름만 user_name에 남아 있다
function wfhName(r, names){
  if(!r.user_id) return (r.user_name || "이름 없음") + " (삭제된 회원)";
  return (names && names[r.user_id]) || "이름 없음";
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
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wfhSheet(rows), "재택 " + wfh.ym);
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("재택_" + wfh.ym + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
// rows: [{ day, name, kind, journal }] — 재택 탭 엑셀과 전체 엑셀 내보내기가 같은 모양을 쓴다
function wfhSheet(rows){
  const data = rows.map(r => ({ "날짜": r.day, "이름": r.name, "구분": WFH_KIND[r.kind] || WFH_KIND.full, "업무 일지": r.journal || "" }));
  const ws = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ "안내": "기록이 없어요" }]);
  if(data.length > 0) ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 80 }];
  return ws;
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
  const canEdit = (r) => isAdmin() || (canWrite() && r.user_id === currentProfile.id); // 수정·삭제 권한 (DB 정책과 같은 기준)
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
          '<td>' + (canEdit(r) ?
            '<div style="display:flex;gap:6px;justify-content:center;">' +
              '<button class="icon-btn view-ok" title="수정" style="color:#64748B;" onclick="event.stopPropagation();weeklyEditOpen(\'' + r.id + '\')">' + icon('edit', 14) + '</button>' +
              '<button class="icon-btn view-ok" title="삭제" onclick="event.stopPropagation();weeklyDeleteConfirm(\'' + r.id + '\')">' + icon('trash', 14) + '</button>' +
            '</div>' : '') + '</td>' +
        '</tr>';
      }).join("") +
    '</tbody></table></div>';

  return '<div class="stack">' + (canWrite() ? form : '') +
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

function weeklyEditOpen(id){
  const r = weekly.rows.find(x => x.id === id);
  if(!r) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">방문 기록 수정</div>' +
    '<div style="max-height:60vh;overflow-y:auto;">' +
      WEEKLY_COLS.map(c =>
        '<div class="field"><div class="field-label">' + c.label + '</div>' +
        '<input id="wke-' + c.key + '" class="input" type="' + (c.key === "visit_date" ? "date" : "text") + '" value="' + esc(r[c.key]) + '"/></div>'
      ).join("") +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="wke-save" style="flex:1;justify-content:center;" onclick="weeklyEditSave(\'' + id + '\')">저장</button>' +
    '</div>'
  );
}
async function weeklyEditSave(id){
  const rec = {};
  WEEKLY_COLS.forEach(c => rec[c.key] = document.getElementById("wke-" + c.key).value.trim());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rec.visit_date)){ showToast("날짜를 YYYY-MM-DD 형식으로 입력해 주세요", { error: true }); return; }
  if(!rec.task_name && !rec.visit_place){ showToast("과제명이나 방문처를 입력해 주세요", { error: true }); return; }
  const btn = document.getElementById("wke-save");
  if(btn) btn.disabled = true;
  // 권한이 없으면 오류 없이 0건이 바뀌므로, 바뀐 행을 돌려받아 확인한다
  const { data, error } = await sb.from("weekly_reports").update(rec).eq("id", id).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("수정하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("이 기록을 수정할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast("방문 기록을 수정했어요");
  weekly.rows = null; // 날짜가 바뀌면 순서도 바뀌므로 다시 불러온다
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
  const data = picked.map(weeklyExportRow);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "주간보고");
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("주간보고_" + todayYmd() + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
function weeklyExportRow(r){
  const row = {};
  WEEKLY_COLS.forEach(c => row[c.label] = r[c.key]);
  return row;
}

/* ---------------- 교육 이력 ---------------- */
const TX_LABEL = { none: "–", na: "전달 불필요", todo: "미계획", plan: "계획", done: "완료" };
const TX_COLOR = { none: "#94A3B8", na: "#94A3B8", todo: "#B45309", plan: "#1F5C8C", done: "#1E7A4F" };
const training = { rows: null, f: { member: "", scope: "", type: "", tx: "", q: "" }, view: "list", sessions: null };

function trTx(r){ // 팀내 전달교육 상태 (사외 교육만 해당)
  if(r.scope !== "사외") return "none";
  if(!r.tx_need) return "na";
  return r.tx_status || "todo";
}
const trCanEdit = (r) => isAdmin() || (canWrite() && r.user_id === currentProfile.id); // DB 정책과 같은 기준

async function trainingLoad(){
  const [tr, tx] = await Promise.all([
    sb.from("trainings").select("*").order("edu_date", { ascending: false }).order("created_at", { ascending: false }),
    sb.from("tx_sessions").select("*").order("session_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const error = tr.error || tx.error;
  if(error){ showToast("교육 이력을 불러오지 못했어요: " + error.message, { error: true }); return; }
  training.rows = tr.data;
  training.sessions = tx.data;
  if(state.tab === "training") renderTabContent();
}

function trainingFiltered(){
  const f = training.f, q = f.q.trim().toLowerCase();
  return training.rows.filter(r =>
    (!f.member || r.member === f.member) && (!f.scope || r.scope === f.scope) && (!f.type || r.edu_type === f.type) &&
    (!f.tx || trTx(r) === f.tx) &&
    (!q || [r.title, r.org, r.note].some(v => (v || "").toLowerCase().includes(q))));
}

function renderTrainingTab(){
  if(!training.rows){
    if(!training.loading){ training.loading = true; trainingLoad().finally(() => { training.loading = false; }); }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  const rows = training.rows, out = rows.filter(r => r.scope === "사외"), f = training.f;
  const stat = (k, v, warn) => '<div class="tr-stat"><div class="k">' + k + '</div><div class="v"' + (warn ? ' style="color:#B45309;"' : '') + '>' + v + '</div></div>';
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  const sel = (key, list) => '<select class="input view-ok" style="width:auto;" onchange="trainingFilter(\'' + key + '\', this.value)">' + list.map(o => opt(o[0], o[1], f[key])).join("") + '</select>';
  const members = [...new Set(rows.map(r => r.member).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  return '<div class="stack">' +
    '<div class="tr-stats">' +
      stat("전체 교육 이력", rows.length + "건") +
      stat("사내 / 사외", (rows.length - out.length) + " / " + out.length) +
      stat("전달교육 미계획 (사외)", out.filter(r => trTx(r) === "todo").length + "건", true) +
      stat("전달교육 계획 · 완료", out.filter(r => trTx(r) === "plan").length + " · " + out.filter(r => trTx(r) === "done").length) +
      '<div class="tr-stat click' + (training.view === "tx" ? ' on' : '') + '" onclick="trainingView(\'' + (training.view === "tx" ? 'list' : 'tx') + '\')">' +
        '<div class="k">팀내 전달교육 현황 ›</div><div class="v">' + training.sessions.length + '건</div></div>' +
    '</div>' +
    (training.view === "tx" ? txSessionsHtml() :
    '<div class="card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:14px;">교육 이력 <span id="tr-count" style="font-size:12px;color:#94A3B8;font-weight:600;">' + trainingFiltered().length + '건 표시</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn-export view-ok" onclick="trainingExport()">' + icon('download', 14) + ' 엑셀 다운로드</button>' +
          (canWrite() ? '<button class="add-btn view-ok" onclick="trainingEditOpen(null)">' + icon('plus', 13) + ' 교육 이력 등록</button>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
        sel("member", [["", "전체 팀원"]].concat(members.map(n => [n, n]))) +
        sel("scope", [["", "사내·사외 전체"], ["사내", "사내"], ["사외", "사외"]]) +
        sel("type", [["", "유형 전체"], ["과제", "과제"], ["SOP", "SOP"], ["General", "General"]]) +
        sel("tx", [["", "전달교육 전체"], ["todo", "미계획"], ["plan", "계획"], ["done", "완료"], ["na", "전달 불필요"]]) +
        '<input class="input view-ok" style="flex:1 1 180px;width:auto;" type="search" placeholder="교육명·주관·비고 검색" value="' + esc(f.q) + '" oninput="training.f.q=this.value;trainingRenderList()"/>' +
      '</div>' +
      '<div id="tr-list">' + trainingListHtml() + '</div>' +
    '</div>') +
  '</div>';
}
function trainingView(v){ training.view = v; renderTabContent(); }

/* 팀내 전달교육 현황: 교육 이력(사외·전달 완료)에서 자동으로 생기거나 직접 등록 */
function txSessionsHtml(){
  const list = training.sessions;
  const table = list.length === 0 ? '<div class="empty">아직 기록이 없어요. 교육 이력에서 사외 교육의 전달교육을 \'완료\'로 저장하면 자동으로 추가돼요.</div>' :
    '<div style="overflow-x:auto;"><table>' +
      '<thead><tr><th>시행일자</th><th>제목</th><th>교육자</th><th>참석자</th><th></th></tr></thead><tbody>' +
      list.map(s => '<tr>' +
        '<td>' + esc(s.session_date) + '</td>' +
        '<td style="white-space:normal;min-width:180px;text-align:left;"><div style="font-weight:700;">' + esc(s.title) + '</div>' +
          (s.training_id ? '<div style="font-size:11px;color:#94A3B8;">교육 이력 연동</div>' : '') + '</td>' +
        '<td>' + esc(s.educator) + '</td>' +
        '<td style="white-space:normal;min-width:160px;text-align:left;font-size:12.5px;">' + esc(s.attendees) + '</td>' +
        '<td>' + (trCanEdit(s) ?
          '<div style="display:flex;gap:6px;justify-content:center;">' +
            '<button class="icon-btn view-ok" title="수정" style="color:#64748B;" onclick="txEditOpen(\'' + s.id + '\')">' + icon('edit', 14) + '</button>' +
            '<button class="icon-btn view-ok" title="삭제" onclick="txDeleteConfirm(\'' + s.id + '\')">' + icon('trash', 14) + '</button>' +
          '</div>' : '') + '</td>' +
      '</tr>').join("") +
    '</tbody></table></div>';
  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<div style="font-weight:800;font-size:14px;">팀내 전달교육 현황 <span style="font-size:12px;color:#94A3B8;font-weight:600;">' + list.length + '건</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn-export view-ok" onclick="trainingView(\'list\')">' + icon('chevronLeft', 14) + ' 교육 이력으로</button>' +
        (canWrite() ? '<button class="add-btn view-ok" onclick="txEditOpen(null)">' + icon('plus', 13) + ' 전달교육 등록</button>' : '') +
      '</div>' +
    '</div>' +
    table +
  '</div>';
}

function txEditOpen(id){
  const s = id ? training.sessions.find(x => x.id === id) : null;
  if(id && !s) return;
  const v = (k, d) => esc(s ? s[k] : (d || ""));
  const field = (label, inner) => '<div class="field"><div class="field-label">' + label + '</div>' + inner + '</div>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">' + (s ? '전달교육 수정' : '전달교육 등록') + '</div>' +
    (s && s.training_id ? '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;line-height:1.5;">교육 이력과 연동된 기록이에요. 교육 이력에서 실시일·교육명·팀원을 바꾸면 여기도 함께 바뀌어요.</div>' : '') +
    field("시행일자 *", '<input id="txe-session_date" class="input" type="date" value="' + v("session_date", todayYmd()) + '"/>') +
    field("제목 *", '<input id="txe-title" class="input" type="text" placeholder="예: ICH E6(R3) GCP 개정 내용 공유" value="' + v("title") + '"/>') +
    field("교육자", '<input id="txe-educator" class="input" type="text" value="' + v("educator", currentProfile ? currentProfile.name : "") + '"/>') +
    field("참석자", '<textarea id="txe-attendees" class="input" rows="2" placeholder="예: 이정선, 유미, 김나형">' + v("attendees") + '</textarea>') +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="txe-save" style="flex:1;justify-content:center;" onclick="txSave(' + (s ? '\'' + s.id + '\'' : 'null') + ')">저장</button>' +
    '</div>'
  );
}
async function txSave(id){
  const val = (k) => document.getElementById("txe-" + k).value.trim();
  const rec = { session_date: val("session_date"), title: val("title"), educator: val("educator"), attendees: val("attendees"), updated_at: new Date().toISOString() };
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rec.session_date)){ showToast("시행일자를 입력해 주세요", { error: true }); return; }
  if(!rec.title){ showToast("제목을 입력해 주세요", { error: true }); return; }
  const btn = document.getElementById("txe-save");
  if(btn) btn.disabled = true;
  // 권한이 없으면 오류 없이 0건이 바뀌므로, 바뀐 행을 돌려받아 확인한다
  const { data, error } = id
    ? await sb.from("tx_sessions").update(rec).eq("id", id).select("id")
    : await sb.from("tx_sessions").insert(rec).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("이 기록을 수정할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast(id ? "전달교육 기록을 수정했어요" : "전달교육 기록을 등록했어요");
  training.rows = null; // 시행일자 순서대로 다시 불러온다
  renderTabContent();
}
function txDeleteConfirm(id){
  const s = training.sessions.find(x => x.id === id);
  if(!s) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">전달교육 기록 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">' + esc(s.session_date) + ' · ' + esc(s.title) + ' 기록을 삭제할까요? 되돌릴 수 없어요.' +
      (s.training_id ? '<br/>교육 이력은 그대로 남아요.' : '') + '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="txDelete(\'' + id + '\')">삭제</button>' +
    '</div>'
  );
}
async function txDelete(id){
  const { data, error } = await sb.from("tx_sessions").delete().eq("id", id).select("id");
  closeModal();
  if(error){ showToast("삭제하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("이 기록을 삭제할 권한이 없어요", { error: true }); return; }
  training.sessions = training.sessions.filter(s => s.id !== id);
  showToast("삭제했어요");
  renderTabContent();
}

function trainingListHtml(){
  if(training.rows.length === 0) return '<div class="empty">아직 등록된 교육 이력이 없어요. \'교육 이력 등록\'을 눌러 추가해 주세요.</div>';
  const list = trainingFiltered();
  if(list.length === 0) return '<div class="empty">조건에 맞는 이력이 없어요. 필터를 바꿔 보세요.</div>';
  const txCell = (r) => {
    const s = trTx(r);
    const sub = s === "plan" ? esc(r.tx_plan_date) + " 예정" : s === "done" ? esc(r.tx_done_date) + " 실시" : s === "todo" ? "계획일 입력 필요" : "";
    return '<span style="font-weight:700;color:' + TX_COLOR[s] + ';">' + TX_LABEL[s] + '</span>' + (sub ? '<div style="font-size:11px;color:#94A3B8;">' + sub + '</div>' : '');
  };
  return '<div style="overflow-x:auto;"><table>' +
    '<thead><tr><th>팀원</th><th>이수일</th><th>교육명 / 주관</th><th>시간</th><th>구분</th><th>유형</th><th>팀내 전달교육</th><th>비고</th><th></th></tr></thead><tbody>' +
    list.map(r => '<tr>' +
      '<td style="font-weight:700;">' + esc(r.member) + '</td>' +
      '<td>' + esc(r.edu_date) + '</td>' +
      '<td style="white-space:normal;min-width:180px;text-align:left;"><div style="font-weight:700;">' + esc(r.title) + '</div>' + (r.org ? '<div style="font-size:11.5px;color:#94A3B8;">' + esc(r.org) + '</div>' : '') + '</td>' +
      '<td>' + (r.hours != null ? esc(r.hours) + 'h' : '') + '</td>' +
      '<td><span class="tr-chip ' + (r.scope === "사외" ? 'out' : 'in') + '">' + esc(r.scope) + '</span></td>' +
      '<td>' + esc(r.edu_type) + '</td>' +
      '<td>' + txCell(r) + '</td>' +
      '<td style="white-space:normal;min-width:120px;text-align:left;font-size:12px;">' + esc(r.note) + '</td>' +
      '<td>' + (trCanEdit(r) ?
        '<div style="display:flex;gap:6px;justify-content:center;">' +
          '<button class="icon-btn view-ok" title="수정" style="color:#64748B;" onclick="trainingEditOpen(\'' + r.id + '\')">' + icon('edit', 14) + '</button>' +
          '<button class="icon-btn view-ok" title="삭제" onclick="trainingDeleteConfirm(\'' + r.id + '\')">' + icon('trash', 14) + '</button>' +
        '</div>' : '') + '</td>' +
    '</tr>').join("") +
  '</tbody></table></div>';
}
// 검색어를 칠 때마다 탭 전체를 다시 그리면 입력칸 커서가 사라지므로, 목록만 바꾼다
function trainingRenderList(){
  const el = document.getElementById("tr-list");
  if(el) el.innerHTML = trainingListHtml();
  const c = document.getElementById("tr-count");
  if(c) c.textContent = trainingFiltered().length + "건 표시";
}
function trainingFilter(key, v){ training.f[key] = v; renderTabContent(); }

function trainingEditOpen(id){
  const r = id ? training.rows.find(x => x.id === id) : null;
  if(id && !r) return;
  const v = (k, d) => esc(r ? (r[k] == null ? "" : r[k]) : (d || ""));
  const field = (label, inner) => '<div class="field"><div class="field-label">' + label + '</div>' + inner + '</div>';
  const input = (k, type, ph, d) => '<input id="tre-' + k + '" class="input" type="' + type + '" placeholder="' + ph + '" value="' + v(k, d) + '"' + (type === "number" ? ' min="0" step="0.5"' : '') + '/>';
  const select = (k, list, d) => '<select id="tre-' + k + '" class="input" onchange="trainingSync()">' +
    list.map(o => '<option value="' + o[0] + '"' + ((r ? r[k] : d) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join("") + '</select>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">' + (r ? '교육 이력 수정' : '교육 이력 등록') + '</div>' +
    '<div style="max-height:62vh;overflow-y:auto;">' +
      '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
        field("팀원 *", input("member", "text", "이름", currentProfile ? currentProfile.name : "")) +
        field("이수일 *", input("edu_date", "date", "", "")) +
      '</div>' +
      field("교육명 *", input("title", "text", "예: ICH E6(R3) GCP 개정 교육", "")) +
      '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
        field("주관 (부서·기관)", input("org", "text", "예: QA팀 / KoNECT", "")) +
        field("교육 시간 (h)", input("hours", "number", "", "")) +
        field("구분 *", select("scope", [["사내", "사내"], ["사외", "사외"]], "사내")) +
        field("교육 유형 *", select("edu_type", [["", "선택"], ["과제", "과제"], ["SOP", "SOP"], ["General", "General"]], "")) +
      '</div>' +
      '<div id="tre-txbox" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:12px;background:#F8FAFC;">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">팀내 전달교육 <span style="font-size:11.5px;color:#94A3B8;font-weight:600;">사외 교육만 해당</span></div>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:8px;"><input type="checkbox" id="tre-tx_need" onchange="trainingSync()"' + (r ? (r.tx_need ? ' checked' : '') : ' checked') + '/> 전달교육 대상 (팀내 공유 필요)</label>' +
        '<div id="tre-txdetail">' +
          field("진행 상태", select("tx_status", [["todo", "미계획"], ["plan", "계획"], ["done", "완료"]], "todo")) +
          '<div id="tre-planwrap">' + field("전달교육 계획일 *", input("tx_plan_date", "date", "", "")) + '</div>' +
          '<div id="tre-donewrap">' + field("전달교육 실시일 *", input("tx_done_date", "date", "", "")) + '</div>' +
        '</div>' +
      '</div>' +
      field("비고", '<textarea id="tre-note" class="input" rows="2" placeholder="수료증 보관 위치, 전달교육 대상자 등">' + v("note") + '</textarea>') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="tre-save" style="flex:1;justify-content:center;" onclick="trainingSave(' + (r ? '\'' + r.id + '\'' : 'null') + ')">저장</button>' +
    '</div>'
  );
  if(r && r.tx_status) document.getElementById("tre-tx_status").value = r.tx_status;
  trainingSync();
}
// 구분·전달교육 선택에 따라 필요한 칸만 보여준다
function trainingSync(){
  const out = document.getElementById("tre-scope").value === "사외";
  const need = document.getElementById("tre-tx_need").checked;
  const st = document.getElementById("tre-tx_status").value;
  document.getElementById("tre-txbox").style.display = out ? "" : "none";
  document.getElementById("tre-txdetail").style.display = need ? "" : "none";
  document.getElementById("tre-planwrap").style.display = (st === "plan" || st === "done") ? "" : "none";
  document.getElementById("tre-donewrap").style.display = st === "done" ? "" : "none";
}

async function trainingSave(id){
  const val = (k) => document.getElementById("tre-" + k).value.trim();
  const hours = val("hours");
  const rec = {
    member: val("member"), edu_date: val("edu_date"), title: val("title"), org: val("org"),
    hours: hours === "" ? null : Number(hours), scope: val("scope"), edu_type: val("edu_type"), note: val("note"),
    tx_need: false, tx_status: null, tx_plan_date: null, tx_done_date: null, updated_at: new Date().toISOString(),
  };
  const miss = [];
  if(!rec.member) miss.push("팀원");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rec.edu_date)) miss.push("이수일");
  if(!rec.title) miss.push("교육명");
  if(!rec.edu_type) miss.push("교육 유형");
  if(rec.scope === "사외" && document.getElementById("tre-tx_need").checked){
    rec.tx_need = true;
    rec.tx_status = val("tx_status");
    if(rec.tx_status === "plan" || rec.tx_status === "done") rec.tx_plan_date = val("tx_plan_date") || null;
    if(rec.tx_status === "done") rec.tx_done_date = val("tx_done_date") || null;
    if(rec.tx_status === "plan" && !rec.tx_plan_date) miss.push("전달교육 계획일");
    if(rec.tx_status === "done" && !rec.tx_done_date) miss.push("전달교육 실시일");
  }
  if(miss.length){ showToast(miss.join(", ") + "을(를) 입력해 주세요", { error: true }); return; }
  const btn = document.getElementById("tre-save");
  if(btn) btn.disabled = true;
  // 권한이 없으면 오류 없이 0건이 바뀌므로, 바뀐 행을 돌려받아 확인한다
  const { data, error } = id
    ? await sb.from("trainings").update(rec).eq("id", id).select("id")
    : await sb.from("trainings").insert(rec).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("이 기록을 수정할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast(id ? "교육 이력을 수정했어요" : "교육 이력을 등록했어요");
  training.rows = null; // 이수일 순서대로 다시 불러온다
  renderTabContent();
}

function trainingDeleteConfirm(id){
  const r = training.rows.find(x => x.id === id);
  if(!r) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">교육 이력 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">' + esc(r.edu_date) + ' · ' + esc(r.member) + ' · ' + esc(r.title) + ' 기록을 삭제할까요? 되돌릴 수 없어요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="trainingDelete(\'' + id + '\')">삭제</button>' +
    '</div>'
  );
}
async function trainingDelete(id){
  const { data, error } = await sb.from("trainings").delete().eq("id", id).select("id");
  closeModal();
  if(error){ showToast("삭제하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("이 기록을 삭제할 권한이 없어요", { error: true }); return; }
  training.rows = training.rows.filter(r => r.id !== id);
  training.sessions = training.sessions.filter(s => s.training_id !== id); // DB에서도 연동 기록이 함께 지워진다
  showToast("삭제했어요");
  renderTabContent();
}

// 지금 필터로 보이는 목록을 엑셀로 내려받는다
async function trainingExport(){
  const data = trainingFiltered().map(trainingExportRow);
  if(data.length === 0){ showToast("내려받을 이력이 없어요", { error: true }); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "교육이력");
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("교육이력_" + todayYmd() + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
function trainingExportRow(r){
  return {
    "팀원": r.member, "이수일": r.edu_date, "교육명": r.title, "주관": r.org, "시간(h)": r.hours,
    "구분": r.scope, "유형": r.edu_type, "전달교육": r.scope === "사외" ? TX_LABEL[trTx(r)] : "해당없음",
    "전달 계획일": r.tx_plan_date || "", "전달 실시일": r.tx_done_date || "", "비고": r.note,
  };
}

/* ---------------- 헤더 '엑셀 내보내기' (app.js exportExcel)에서 재택·주간보고·교육 시트 만들기 ----------------
   탭 화면은 보고 있는 달·필터만 담지만, 여기서는 볼 수 있는 기록 전체를 DB에서 새로 불러온다
   (관리자는 전체 팀원, 회원은 DB 정책상 볼 수 있는 것만). */
// Supabase는 한 번에 최대 1,000행만 돌려주므로 나눠서 끝까지 불러온다
async function sbFetchAll(makeQuery){
  const PAGE = 1000, out = [];
  for(let from = 0; ; from += PAGE){
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if(error) throw new Error(error.message);
    out.push(...data);
    if(data.length < PAGE) return out;
  }
}

async function worklogExportSheets(wb, keys){
  if(keys.includes("wfh")){
    const me = currentProfile.id;
    const myName = currentProfile.name || currentProfile.login_id;
    const data = await sbFetchAll(() => {
      const q = sb.from("wfh_days").select("user_id,user_name,day,kind,journal").order("day").order("user_id");
      return isAdmin() ? q : q.eq("user_id", me);
    });
    let names = {};
    if(isAdmin()){
      const res = await sb.from("profiles").select("id,name,login_id");
      (res.data || []).forEach(p => names[p.id] = p.name || p.login_id);
    }
    const rows = data.map(r => ({ day: r.day, name: r.user_id === me ? myName : wfhName(r, names), kind: r.kind, journal: r.journal }));
    rows.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "ko"));
    XLSX.utils.book_append_sheet(wb, wfhSheet(rows), "재택·일지");
  }
  if(keys.includes("weekly")){
    const data = await sbFetchAll(() => sb.from("weekly_reports").select("*")
      .order("visit_date", { ascending: false }).order("created_at", { ascending: false }));
    appendSheetOrEmpty(wb, data.map(weeklyExportRow), "주간보고");
  }
  if(keys.includes("training")){
    const [tr, tx] = await Promise.all([
      sbFetchAll(() => sb.from("trainings").select("*").order("edu_date", { ascending: false }).order("created_at", { ascending: false })),
      sbFetchAll(() => sb.from("tx_sessions").select("*").order("session_date", { ascending: false }).order("created_at", { ascending: false })),
    ]);
    appendSheetOrEmpty(wb, tr.map(trainingExportRow), "교육이력");
    appendSheetOrEmpty(wb, tx.map(s => ({
      "시행일자": s.session_date, "제목": s.title, "교육자": s.educator || "", "참석자": s.attendees || "",
      "교육 이력 연동": s.training_id ? "Y" : "",
    })), "팀내 전달교육");
  }
}

// 로그아웃할 때 다른 사람이 이어서 로그인해도 이전 계정의 기록이 보이지 않게 비운다.
function worklogReset(){
  wfh.ym = null; wfh.days = null; wfh.others = {}; wfh.loadedYm = null; wfh.names = null;
  weekly.rows = null; weekly.selected = {};
  training.rows = null; training.f = { member: "", scope: "", type: "", tx: "", q: "" }; training.view = "list"; training.sessions = null;
}
