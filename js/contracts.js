/* ---------------- CTMS 계약관리 ----------------
   state.ctmsContracts[gid] = [ {
     id, type:'cro'|'site'|'advisory'|'etc', party(계약 상대), title(계약명), signedDate, expireDate, amount(원), memo,
     amendments:  [ {id, no(변경 차수), date(변경 계약 체결일), detail(변경 내역)} ],
     plan:        [ {id, label(지급 조건), dueDate(지급 예정일), amount(원)} ],
     planHistory: [ {id, time, amendNo, reason, before:[...plan], after:[...plan]} ]   // 지급 계획을 바꿀 때마다 남김
     payments:    [ {id, date(결제 상신일자), amount(지급 비용, 원), planId, memo, reported(지출보고 시스템 입력 여부)} ]
   } ]
   과제 담당자(ctmsCanEdit)와 관리자만 입력하고, 나머지는 조회만 한다. 담당자 저장은 save_ctms(p_contracts)로 간다. */

const CT_TYPES = [
  { key: "cro", label: "CRO 계약", c: "#1F5C8C", s: "#E6EFF7" },
  { key: "site", label: "실시기관(연구자) 계약", c: "#1E7A4F", s: "#E7F6EC" },
  { key: "advisory", label: "자문 계약", c: "#7B4FAE", s: "#F3ECFC" },
  { key: "etc", label: "기타 계약", c: "#475569", s: "#EEF2F6" },
];
const ctTypeOf = (k) => CT_TYPES.find(t => t.key === k) || CT_TYPES[3];
const ctList = (gid) => state.ctmsContracts[gid] || [];
const ctFind = (gid, id) => ctList(gid).find(c => c.id === id);
const ctSum = (arr) => (arr || []).reduce((n, x) => n + (Number(x.amount) || 0), 0);
const ctWon = (n) => fmtK(n) + "원";
// 지출보고 시스템 입력이 필요한 입금: 실시기관 계약의 입금 중 아직 체크하지 않은 것
const ctNeedsReport = (c, p) => c.type === "site" && !p.reported;

function ctToggle(gid){ state.ctmsUi.ctOpen[gid] = !state.ctmsUi.ctOpen[gid]; renderTabContent(); }
function ctToggleSection(key){ state.ctmsUi.ctOpen[key] = !state.ctmsUi.ctOpen[key]; renderTabContent(); }

function renderCtmsContracts(){
  const ui = state.ctmsUi;
  const groups = ctmsFilteredGroups();
  const all = groups.flatMap(g => ctList(g.gid));
  const total = ctSum(all), paid = all.reduce((n, c) => n + ctSum(c.payments), 0);
  const unreported = all.reduce((n, c) => n + (c.payments || []).filter(p => ctNeedsReport(c, p)).length, 0);
  const viewSel = '<select class="input view-ok" onchange="ctmsSetFilter(\'ctView\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
    '<option value="all"' + (ui.ctView === "all" ? " selected" : "") + '>계약: 전체</option>' +
    '<option value="entered"' + (ui.ctView === "entered" ? " selected" : "") + '>계약 입력된 과제</option>' +
    '<option value="unreported"' + (ui.ctView === "unreported" ? " selected" : "") + '>지출보고 미입력 있음</option></select>';
  let html = '<div class="stack"><div class="card">' +
    '<div class="subtotal-grid" style="margin-bottom:14px;">' +
      '<div class="subtotal-item" style="background:#E6EFF7;"><div class="subtotal-label" style="color:#1F5C8C;">계약</div><div class="subtotal-value">' + all.length + '<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#F3ECFC;"><div class="subtotal-label" style="color:#7B4FAE;">총 계약금액(원)</div><div class="subtotal-value">' + fmtK(total) + '</div></div>' +
      '<div class="subtotal-item" style="background:#E4F4F8;"><div class="subtotal-label" style="color:#0E8CA6;">지급(원)</div><div class="subtotal-value">' + fmtK(paid) + '</div></div>' +
      '<div class="subtotal-item" style="background:' + (unreported ? '#FEF3E2' : '#EEF2F6') + ';"><div class="subtotal-label" style="color:' + (unreported ? '#B45309' : '#475569') + ';">지출보고 미입력</div><div class="subtotal-value">' + unreported + '<span class="subtotal-unit">건</span></div></div>' +
    '</div>' + ctmsFilterRow(viewSel) + '</div>';
  let shown = groups;
  if(ui.ctView === "entered") shown = groups.filter(g => ctList(g.gid).length > 0);
  if(ui.ctView === "unreported") shown = groups.filter(g => ctList(g.gid).some(c => (c.payments || []).some(p => ctNeedsReport(c, p))));
  if(shown.length === 0) html += '<div class="card"><div class="empty">조건에 맞는 과제가 없어요.</div></div>';
  shown.forEach(g => { html += ctGroupCardHtml(g); });
  html += '<div style="font-size:11.5px;color:#94A3B8;padding:0 4px;">금액 단위는 원이에요. 과제 담당자와 관리자만 입력·수정할 수 있어요. 지급 계획을 바꾸면 변경 사유와 바뀌기 전·후 내용이 이력으로 남아요.</div></div>';
  return html;
}

function ctGroupCardHtml(g){
  const list = ctList(g.gid), canEdit = ctmsCanEdit(g.gid), open = !!state.ctmsUi.ctOpen[g.gid];
  const total = ctSum(list), paid = list.reduce((n, c) => n + ctSum(c.payments), 0);
  const unrep = list.reduce((n, c) => n + (c.payments || []).filter(p => ctNeedsReport(c, p)).length, 0);
  const types = CT_TYPES.map(t => { const n = list.filter(c => c.type === t.key).length; return n ? t.label.replace(" 계약", "") + " " + n : ""; }).filter(Boolean).join(" · ");
  return '<div class="card" style="padding:14px;margin-bottom:0;">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
      '<div style="min-width:0;flex:1;cursor:pointer;" onclick="ctToggle(\'' + g.gid + '\')">' + ctmsGroupHead(g) + '</div>' +
      (canEdit ? '<button class="add-btn" style="flex:0 0 auto;padding:6px 11px;font-size:12px;" onclick="ctEditOpen(\'' + g.gid + '\', null)">' + icon("plus", 12) + ' 계약 추가</button>' : '') +
    '</div>' +
    '<div style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:#64748B;margin-top:10px;" onclick="ctToggle(\'' + g.gid + '\')">' +
      '<span>' + (list.length ? '계약 <b>' + list.length + '건</b>' + (types ? ' (' + esc(types) + ')' : '') + ' · 계약금액 <b>' + ctWon(total) + '</b> · 지급 <b>' + ctWon(paid) + '</b>' +
        (unrep ? ' · <span style="color:#B45309;font-weight:700;">⚠ 지출보고 미입력 ' + unrep + '건</span>' : '') : '입력된 계약이 없어요') + '</span>' +
      '<span>' + (open ? "▾" : "▸") + '</span></div>' +
    (open ? '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);display:flex;flex-direction:column;gap:10px;">' +
      (list.length ? list.map(c => ctContractHtml(g.gid, c, canEdit)).join("") : '<div style="font-size:12px;color:#94A3B8;">' + (canEdit ? "'계약 추가'로 CRO·실시기관·자문·기타 계약을 입력해 주세요." : "입력된 계약이 없어요.") + '</div>') +
    '</div>' : '') +
  '</div>';
}

function ctContractHtml(gid, c, canEdit){
  const t = ctTypeOf(c.type), key = gid + "|" + c.id;
  const btn = (js, label) => '<button class="add-btn" style="padding:4px 9px;font-size:11.5px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="' + js + '">' + icon("plus", 11) + ' ' + label + '</button>';
  const iconBtns = (editJs, delJs) => canEdit ? '<span style="display:inline-flex;gap:2px;flex:0 0 auto;">' +
    '<button class="icon-btn" title="수정" style="color:#64748B;" onclick="' + editJs + '">' + icon("edit", 13) + '</button>' +
    '<button class="icon-btn" title="삭제" onclick="' + delJs + '">' + icon("trash", 13) + '</button></span>' : '';
  const sec = (title, right, body) => '<div style="margin-top:10px;"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
    '<div style="font-size:11.5px;font-weight:800;color:#64748B;">' + title + '</div>' + (right || '') + '</div>' + body + '</div>';
  const row = (inner) => '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border:1px solid #EEF2F6;border-radius:6px;margin-bottom:4px;font-size:12px;">' + inner + '</div>';
  const none = (msg) => '<div style="font-size:11.5px;color:#94A3B8;">' + msg + '</div>';
  const a = esc(gid) + "','" + esc(c.id);

  const amends = (c.amendments || []).slice().sort((x, y) => (Number(x.no) || 0) - (Number(y.no) || 0));
  const amendHtml = amends.length ? amends.map(m => row(
    '<b style="flex:0 0 auto;">' + esc(m.no) + '차</b><span style="color:#64748B;flex:0 0 auto;">' + esc(m.date || "") + '</span>' +
    '<span style="flex:1;min-width:0;white-space:pre-wrap;">' + esc(m.detail || "") + '</span>' +
    iconBtns("ctAmendOpen('" + a + "','" + m.id + "')", "ctAmendDelete('" + a + "','" + m.id + "')"))).join("") : none("변경 계약이 없어요.");

  const plan = c.plan || [], hist = c.planHistory || [];
  const paidOf = (pid) => ctSum((c.payments || []).filter(p => p.planId === pid));
  const planHtml = plan.length ? plan.map(p => row(
    '<span style="flex:1;min-width:0;font-weight:600;">' + esc(p.label || "-") + '</span>' +
    '<span style="color:#64748B;flex:0 0 auto;">' + esc(p.dueDate || "일정 미정") + '</span>' +
    '<b style="flex:0 0 auto;font-variant-numeric:tabular-nums;">' + ctWon(p.amount) + '</b>' +
    '<span style="flex:0 0 auto;font-size:11px;color:' + (paidOf(p.id) >= (Number(p.amount) || 0) && paidOf(p.id) > 0 ? '#16A34A' : '#94A3B8') + ';">지급 ' + fmtK(paidOf(p.id)) + '</span>')).join("") +
    '<div style="text-align:right;font-size:11.5px;color:#64748B;">계획 합계 <b>' + ctWon(ctSum(plan)) + '</b>' + (c.amount && ctSum(plan) !== Number(c.amount) ? ' <span style="color:#B45309;">(계약금액 ' + ctWon(c.amount) + '과 달라요)</span>' : '') + '</div>'
    : none("지급 계획이 없어요.");
  const histOpen = !!state.ctmsUi.ctOpen[key + "|hist"];
  const histHtml = hist.length ? '<div style="margin-top:6px;"><button class="view-ok" style="border:none;background:none;padding:0;font-size:11.5px;color:var(--accent);font-weight:700;cursor:pointer;" onclick="ctToggleSection(\'' + key + '|hist\')">' +
      (histOpen ? "▾" : "▸") + ' 지급 계획 변경 이력 ' + hist.length + '건</button>' +
      (histOpen ? hist.slice().reverse().map(h => '<div style="margin-top:6px;padding:8px 10px;background:#FFFBEB;border:1px solid #FDE7B0;border-radius:6px;font-size:11.5px;color:#475569;">' +
        '<div><b>' + esc(String(h.time || "").slice(0, 10)) + '</b>' + (h.amendNo ? ' · <b>' + esc(h.amendNo) + '차 변경</b>' : '') + (h.by ? ' · ' + esc(h.by) : '') + ' · 합계 ' + ctWon(ctSum(h.before)) + ' → <b>' + ctWon(ctSum(h.after)) + '</b></div>' +
        (h.reason ? '<div style="margin-top:2px;">사유: ' + esc(h.reason) + '</div>' : '') +
        ctPlanDiffHtml(h.before, h.after) + '</div>').join("") : '') + '</div>' : '';

  const pays = (c.payments || []).slice().sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
  const payHtml = pays.length ? pays.map(p => {
    const pl = plan.find(x => x.id === p.planId), warn = ctNeedsReport(c, p);
    return row(
      (warn ? '<span title="지출보고 시스템에 입력해 주세요" style="flex:0 0 auto;color:#B45309;">' + icon("alert", 14) + '</span>' : '') +
      '<span style="color:#64748B;flex:0 0 auto;">' + esc(p.date || "") + '</span>' +
      '<span style="flex:1;min-width:0;">' + esc(pl ? pl.label : "") + (p.memo ? (pl ? " · " : "") + esc(p.memo) : "") + '</span>' +
      '<b style="flex:0 0 auto;font-variant-numeric:tabular-nums;">' + ctWon(p.amount) + '</b>' +
      (c.type === "site" ? '<label style="flex:0 0 auto;display:flex;align-items:center;gap:4px;font-size:11px;color:' + (p.reported ? '#16A34A' : '#B45309') + ';' + (canEdit ? 'cursor:pointer;' : '') + '" title="지출보고 시스템 입력 여부">' +
        '<input type="checkbox"' + (p.reported ? ' checked' : '') + (canEdit ? ' onchange="ctReportToggle(\'' + a + '\',\'' + p.id + '\', this.checked)"' : ' disabled') + '/>지출보고 입력</label>' : '') +
      iconBtns("ctPayOpen('" + a + "','" + p.id + "')", "ctPayDelete('" + a + "','" + p.id + "')"));
  }).join("") +
    '<div style="text-align:right;font-size:11.5px;color:#64748B;">지급 합계 <b>' + ctWon(ctSum(pays)) + '</b>' + (ctSum(plan) ? ' / 계획 ' + ctWon(ctSum(plan)) : '') + '</div>'
    : none("입금 내역이 없어요.");

  return '<div style="border:1px solid var(--border);border-left:4px solid ' + t.c + ';border-radius:8px;padding:10px 12px;background:#FBFCFD;">' +
    '<div style="display:flex;align-items:flex-start;gap:8px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span class="tr-chip" style="color:' + t.c + ';background:' + t.s + ';">' + t.label + '</span>' +
          '<b style="font-size:13.5px;">' + esc(c.party || "(계약 상대 미입력)") + '</b>' + (c.title ? '<span style="font-size:12px;color:#64748B;">' + esc(c.title) + '</span>' : '') + '</div>' +
        '<div style="font-size:11.5px;color:#64748B;margin-top:4px;">체결 ' + esc(c.signedDate || "–") + ' · 만료 ' + esc(c.expireDate || "–") +
          (c.amount ? ' · 계약금액 <b>' + ctWon(c.amount) + '</b>' : '') + (amends.length ? ' · 변경 ' + amends.length + '회' : '') + '</div>' +
        (c.memo ? '<div style="font-size:11.5px;color:#94A3B8;margin-top:2px;white-space:pre-wrap;">' + esc(c.memo) + '</div>' : '') +
      '</div>' +
      iconBtns("ctEditOpen('" + a + "')", "ctDeleteConfirm('" + a + "')") +
    '</div>' +
    sec("계약 변경 이력", canEdit ? btn("ctAmendOpen('" + a + "', null)", "변경 추가") : "", amendHtml) +
    sec("비용 지급 계획", canEdit ? btn("ctPlanOpen('" + a + "')", plan.length ? "계획 변경" : "계획 입력") : "", planHtml + histHtml) +
    sec("입금 내역", canEdit ? btn("ctPayOpen('" + a + "', null)", "입금 등록") : "", payHtml) +
  '</div>';
}

// 지급 계획 변경 전·후 비교: 항목(id) 기준으로 추가·삭제·변경을 한 줄씩
function ctPlanDiffHtml(before, after){
  const b = new Map((before || []).map(x => [x.id, x])), a = new Map((after || []).map(x => [x.id, x]));
  const desc = (x) => (x.label || "-") + " · " + (x.dueDate || "일정 미정") + " · " + ctWon(x.amount);
  const lines = [];
  a.forEach((x, id) => {
    const o = b.get(id);
    if(!o) lines.push('<span style="color:#16A34A;">+ 추가</span> ' + esc(desc(x)));
    else if(o.label !== x.label || o.dueDate !== x.dueDate || Number(o.amount) !== Number(x.amount)) lines.push('<span style="color:#B45309;">~ 변경</span> ' + esc(desc(o)) + ' → <b>' + esc(desc(x)) + '</b>');
  });
  b.forEach((x, id) => { if(!a.has(id)) lines.push('<span style="color:#B91C1C;">− 삭제</span> ' + esc(desc(x))); });
  return lines.length ? '<div style="margin-top:4px;line-height:1.6;">' + lines.join("<br/>") + '</div>' : '';
}

/* ---------- 계약 추가·수정·삭제 ---------- */
function ctEditOpen(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const c = id ? ctFind(gid, id) : null;
  if(id && !c) return;
  const v = (k) => esc(c && c[k] != null ? c[k] : "");
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + (c ? '계약 수정' : '계약 추가') + '</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(gid)) + '</div>' +
    ctmsSheetField("계약 구분", '<select id="ct-type" class="input" style="font-size:13px;">' + CT_TYPES.map(t => '<option value="' + t.key + '"' + ((c ? c.type : "cro") === t.key ? " selected" : "") + '>' + t.label + '</option>').join("") + '</select>') +
    ctmsSheetField("계약 상대 (CRO·기관·연구자·자문위원 등)", '<input id="ct-party" class="input" style="font-size:13px;" placeholder="예: OO대학교병원 / 홍길동 교수" value="' + v("party") + '"/>') +
    ctmsSheetField("계약명 (선택)", '<input id="ct-title" class="input" style="font-size:13px;" placeholder="예: 임상시험 실시 계약" value="' + v("title") + '"/>') +
    '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
      ctmsSheetField("계약 체결일", '<input id="ct-signed" type="date" class="input" style="font-size:13px;" value="' + v("signedDate") + '"/>') +
      ctmsSheetField("계약 만료일", '<input id="ct-expire" type="date" class="input" style="font-size:13px;" value="' + v("expireDate") + '"/>') +
    '</div>' +
    ctmsSheetField("계약금액 (원)", '<input id="ct-amount" type="number" min="0" step="1" class="input" style="font-size:13px;" value="' + v("amount") + '"/>') +
    ctmsSheetField("메모", '<textarea id="ct-memo" class="input" rows="2" style="font-size:13px;">' + v("memo") + '</textarea>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null), "md");
  document.getElementById("ctms-sheet-save").onclick = () => ctSave(gid, id);
}
function ctSave(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const val = (k) => document.getElementById("ct-" + k).value.trim();
  const rec = { type: val("type"), party: val("party"), title: val("title"), signedDate: val("signed"), expireDate: val("expire"),
    amount: val("amount") === "" ? null : Number(val("amount")), memo: val("memo") };
  if(!rec.party){ ctmsSheetError("계약 상대를 입력해 주세요."); return; }
  if(rec.signedDate && rec.expireDate && rec.expireDate < rec.signedDate){ ctmsSheetError("만료일이 체결일보다 빨라요."); return; }
  if(id){
    const c = ctFind(gid, id); if(!c) return;
    Object.assign(c, rec);
    logActivity('CTMS 계약 수정: "' + ctmsGroupName(gid) + '" - ' + rec.party);
  }else{
    if(!state.ctmsContracts[gid]) state.ctmsContracts[gid] = [];
    state.ctmsContracts[gid].push(Object.assign({ id: uid("ct"), amendments: [], plan: [], planHistory: [], payments: [], createdAt: new Date().toISOString() }, rec));
    state.ctmsUi.ctOpen[gid] = true;
    logActivity('CTMS 계약 추가: "' + ctmsGroupName(gid) + '" - ' + ctTypeOf(rec.type).label + ' ' + rec.party);
  }
  closeModal();
  ctmsPersist(gid); renderTabContent();
}
function ctDeleteConfirm(gid, id){
  const c = ctFind(gid, id);
  if(!c || !ctmsCanEdit(gid)) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">계약 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">' + esc(ctTypeOf(c.type).label) + ' · <b>' + esc(c.party) + '</b> 계약을 삭제할까요?<br/>변경 이력·지급 계획·입금 내역도 함께 삭제돼요. (바로 아래 알림에서 되돌릴 수 있어요)</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#B91C1C;" onclick="ctDelete(\'' + gid + '\',\'' + id + '\')">삭제</button>' +
    '</div>');
}
function ctDelete(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const list = ctList(gid), idx = list.findIndex(c => c.id === id);
  if(idx < 0) return;
  const removed = list.splice(idx, 1)[0];
  if(list.length === 0) delete state.ctmsContracts[gid];
  logActivity('CTMS 계약 삭제: "' + ctmsGroupName(gid) + '" - ' + removed.party);
  state.lastAction = {
    gid,
    restore: () => { if(!state.ctmsContracts[gid]) state.ctmsContracts[gid] = []; state.ctmsContracts[gid].splice(Math.min(idx, state.ctmsContracts[gid].length), 0, removed); },
    undoMsg: 'CTMS 계약 삭제 취소: "' + ctmsGroupName(gid) + '"',
  };
  closeModal();
  showUndoToast("계약을 삭제했어요");
  ctmsPersist(gid); renderTabContent();
}

/* ---------- 계약 변경 이력 (변경 차수·변경 계약 체결일·변경 내역) ---------- */
function ctAmendOpen(gid, id, mid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const m = mid ? (c.amendments || []).find(x => x.id === mid) : null;
  const nextNo = (c.amendments || []).reduce((n, x) => Math.max(n, Number(x.no) || 0), 0) + 1;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + (m ? '변경 계약 수정' : '변경 계약 추가') + '</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(c.party) + '</div>' +
    '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
      ctmsSheetField("변경 차수", '<input id="ca-no" type="number" min="1" step="1" class="input" style="font-size:13px;" value="' + esc(m ? m.no : nextNo) + '"/>') +
      ctmsSheetField("변경 계약 체결일", '<input id="ca-date" type="date" class="input" style="font-size:13px;" value="' + esc(m ? m.date : ctmsToday()) + '"/>') +
    '</div>' +
    ctmsSheetField("변경 내역", '<textarea id="ca-detail" class="input" rows="3" style="font-size:13px;" placeholder="예: 대상자 수 증가(30→40명)에 따른 연구비 증액, 계약기간 6개월 연장">' + esc(m ? m.detail : "") + '</textarea>') +
    (m ? '' : '<div style="font-size:11.5px;color:#64748B;margin-bottom:6px;">변경 내용 중 만료일·계약금액이 바뀌었다면 계약 정보에서도 고쳐 주세요. 지급 계획이 바뀌면 \'계획 변경\'에서 이 변경 차수를 골라 남길 수 있어요.</div>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null), "md");
  document.getElementById("ctms-sheet-save").onclick = () => ctAmendSave(gid, id, mid);
}
function ctAmendSave(gid, id, mid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const rec = { no: Number(document.getElementById("ca-no").value) || null, date: document.getElementById("ca-date").value, detail: document.getElementById("ca-detail").value.trim() };
  if(!rec.no){ ctmsSheetError("변경 차수를 입력해 주세요."); return; }
  if(!rec.detail){ ctmsSheetError("변경 내역을 입력해 주세요."); return; }
  if(!c.amendments) c.amendments = [];
  if((c.amendments).some(x => x.id !== mid && Number(x.no) === rec.no)){ ctmsSheetError(rec.no + "차 변경이 이미 있어요."); return; }
  if(mid){ const m = c.amendments.find(x => x.id === mid); if(m) Object.assign(m, rec); }
  else c.amendments.push(Object.assign({ id: uid("ca") }, rec));
  logActivity('CTMS 계약 변경 ' + (mid ? '수정' : '추가') + ': "' + ctmsGroupName(gid) + '" - ' + c.party + ' ' + rec.no + '차');
  closeModal();
  ctmsPersist(gid); renderTabContent();
}
function ctAmendDelete(gid, id, mid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const idx = (c.amendments || []).findIndex(x => x.id === mid);
  if(idx < 0) return;
  const removed = c.amendments.splice(idx, 1)[0];
  logActivity('CTMS 계약 변경 삭제: "' + ctmsGroupName(gid) + '" - ' + c.party + ' ' + removed.no + '차');
  state.lastAction = { gid, restore: () => { c.amendments.splice(Math.min(idx, c.amendments.length), 0, removed); }, undoMsg: '계약 변경 삭제 취소' };
  showUndoToast(removed.no + "차 변경을 삭제했어요");
  ctmsPersist(gid); renderTabContent();
}

/* ---------- 비용 지급 계획 (바꿀 때마다 변경 전·후를 planHistory에 남김) ---------- */
let ctPlanDraft = null;
function ctPlanOpen(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  ctPlanDraft = { gid, id, rows: (c.plan || []).map(p => Object.assign({}, p)) };
  if(ctPlanDraft.rows.length === 0) ctPlanDraft.rows.push({ id: uid("cp"), label: "", dueDate: "", amount: "" });
  ctPlanRender();
}
function ctPlanCollect(){
  ctPlanDraft.rows.forEach((r, i) => {
    r.label = document.getElementById("cp-" + i + "-label").value.trim();
    r.dueDate = document.getElementById("cp-" + i + "-due").value;
    const a = document.getElementById("cp-" + i + "-amount").value;
    r.amount = a === "" ? "" : Number(a);
  });
  const reason = document.getElementById("cp-reason"), amend = document.getElementById("cp-amend");
  if(reason) ctPlanDraft.reason = reason.value;
  if(amend) ctPlanDraft.amendNo = amend.value;
}
function ctPlanRender(){
  const d = ctPlanDraft, c = ctFind(d.gid, d.id);
  const isChange = (c.plan || []).length > 0;
  const amends = (c.amendments || []).slice().sort((x, y) => (Number(y.no) || 0) - (Number(x.no) || 0));
  const total = d.rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + (isChange ? '비용 지급 계획 변경' : '비용 지급 계획 입력') + '</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(c.party) + (c.amount ? ' · 계약금액 ' + ctWon(c.amount) : '') + ' · 금액 단위: 원</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:3px;font-size:10.5px;color:#94A3B8;font-weight:700;"><div style="flex:1.4;">지급 조건 (예: 계약금, 1차 중도금)</div><div style="flex:1;">지급 예정일</div><div style="flex:1;">금액(원)</div><div style="width:28px;"></div></div>' +
    d.rows.map((r, i) => '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">' +
      '<input id="cp-' + i + '-label" class="input" style="flex:1.4;min-width:0;font-size:13px;padding:6px 8px;" value="' + esc(r.label) + '"/>' +
      '<input id="cp-' + i + '-due" type="date" class="input" style="flex:1;min-width:0;font-size:13px;padding:6px 6px;" value="' + esc(r.dueDate) + '"/>' +
      '<input id="cp-' + i + '-amount" type="number" min="0" step="1" class="input" style="flex:1;min-width:0;font-size:13px;padding:6px 6px;" value="' + esc(r.amount) + '"/>' +
      '<button class="icon-btn" title="행 삭제" onclick="ctPlanRemoveRow(' + i + ')">' + icon("trash", 13) + '</button></div>').join("") +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
      '<button class="add-btn" style="padding:5px 10px;font-size:12px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="ctPlanAddRow()">' + icon("plus", 12) + ' 행 추가</button>' +
      '<span style="font-size:12px;color:#64748B;">합계 <b>' + ctWon(total) + '</b></span></div>' +
    (isChange ?
      ctmsSheetField("관련 계약 변경 (선택)", '<select id="cp-amend" class="input" style="font-size:13px;"><option value="">변경 계약과 관계없음</option>' +
        amends.map(m => '<option value="' + esc(m.no) + '"' + (String(d.amendNo || "") === String(m.no) ? " selected" : "") + '>' + esc(m.no) + '차 변경 (' + esc(m.date || "") + ')</option>').join("") + '</select>') +
      ctmsSheetField("변경 사유 (필수)", '<textarea id="cp-reason" class="input" rows="2" style="font-size:13px;" placeholder="예: 2차 변경 계약으로 중도금 증액">' + esc(d.reason || "") + '</textarea>') : '') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null), "md");
  document.getElementById("ctms-sheet-save").onclick = ctPlanSave;
}
function ctPlanAddRow(){ ctPlanCollect(); ctPlanDraft.rows.push({ id: uid("cp"), label: "", dueDate: "", amount: "" }); ctPlanRender(); }
function ctPlanRemoveRow(i){ ctPlanCollect(); ctPlanDraft.rows.splice(i, 1); ctPlanRender(); }
function ctPlanSave(){
  const d = ctPlanDraft;
  if(!d || !ctmsCanEdit(d.gid)) return;
  ctPlanCollect();
  const c = ctFind(d.gid, d.id); if(!c) return;
  const rows = d.rows.filter(r => r.label || r.dueDate || r.amount !== "").map(r => ({ id: r.id, label: r.label, dueDate: r.dueDate, amount: Number(r.amount) || 0 }));
  if(rows.some(r => !r.label)){ ctmsSheetError("지급 조건을 입력해 주세요."); return; }
  const before = c.plan || [];
  const same = JSON.stringify(before.map(x => [x.id, x.label, x.dueDate, Number(x.amount)])) === JSON.stringify(rows.map(x => [x.id, x.label, x.dueDate, x.amount]));
  if(same){ closeModal(); return; }
  if(before.length > 0){
    const reason = (d.reason || "").trim();
    if(!reason){ ctmsSheetError("변경 사유를 입력해 주세요."); return; }
    if(!c.planHistory) c.planHistory = [];
    c.planHistory.push({ id: uid("ch"), time: new Date().toISOString(), by: currentProfile ? currentProfile.name : "", amendNo: d.amendNo || "", reason, before, after: rows });
  }
  // 지워진 계획 항목에 연결돼 있던 입금은 연결만 끊는다 (입금 기록은 남김)
  (c.payments || []).forEach(p => { if(p.planId && !rows.some(r => r.id === p.planId)) p.planId = ""; });
  c.plan = rows;
  logActivity('CTMS 지급 계획 ' + (before.length ? '변경' : '입력') + ': "' + ctmsGroupName(d.gid) + '" - ' + c.party + ' ' + ctWon(ctSum(before)) + ' → ' + ctWon(ctSum(rows)));
  ctPlanDraft = null;
  closeModal();
  ctmsPersist(d.gid); renderTabContent();
}

/* ---------- 입금 내역 (결제 상신일자·지급 비용) ---------- */
function ctPayOpen(gid, id, pid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const p = pid ? (c.payments || []).find(x => x.id === pid) : null;
  const plan = c.plan || [];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + (p ? '입금 내역 수정' : '입금 등록') + '</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctTypeOf(c.type).label) + ' · ' + esc(c.party) + '</div>' +
    '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
      ctmsSheetField("결제 상신일자", '<input id="cpay-date" type="date" class="input" style="font-size:13px;" value="' + esc(p ? p.date : ctmsToday()) + '"/>') +
      ctmsSheetField("지급 비용 (원)", '<input id="cpay-amount" type="number" min="0" step="1" class="input" style="font-size:13px;" value="' + esc(p ? p.amount : "") + '"/>') +
    '</div>' +
    ctmsSheetField("지급 계획 항목", '<select id="cpay-plan" class="input" style="font-size:13px;"><option value="">선택 안 함</option>' +
      plan.map(x => '<option value="' + esc(x.id) + '"' + (p && p.planId === x.id ? " selected" : "") + '>' + esc(x.label) + ' (' + ctWon(x.amount) + ')</option>').join("") + '</select>') +
    ctmsSheetField("메모", '<input id="cpay-memo" class="input" style="font-size:13px;" value="' + esc(p ? p.memo : "") + '"/>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null), "md");
  document.getElementById("ctms-sheet-save").onclick = () => ctPaySave(gid, id, pid);
}
function ctPaySave(gid, id, pid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const rec = { date: document.getElementById("cpay-date").value, amount: Number(document.getElementById("cpay-amount").value) || 0,
    planId: document.getElementById("cpay-plan").value, memo: document.getElementById("cpay-memo").value.trim() };
  if(!rec.date){ ctmsSheetError("결제 상신일자를 입력해 주세요."); return; }
  if(!rec.amount){ ctmsSheetError("지급 비용을 입력해 주세요."); return; }
  if(!c.payments) c.payments = [];
  if(pid){ const p = c.payments.find(x => x.id === pid); if(p) Object.assign(p, rec); }
  else c.payments.push(Object.assign({ id: uid("cpay"), reported: false }, rec));
  logActivity('CTMS 입금 ' + (pid ? '수정' : '등록') + ': "' + ctmsGroupName(gid) + '" - ' + c.party + ' ' + ctWon(rec.amount));
  closeModal();
  ctmsPersist(gid); renderTabContent();
  if(!pid && c.type === "site") ctReportNotice(); // 실시기관 입금을 새로 등록했을 때 한 번 안내
}
function ctReportNotice(){
  showModal(
    '<div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:15px;margin-bottom:10px;color:#B45309;">' + icon("alert", 18) + ' 지출보고 입력 안내</div>' +
    '<div style="font-size:13.5px;color:#334155;line-height:1.6;margin-bottom:18px;"><b>지출보고 시스템에 입력해주세요.</b><br/>' +
      '<span style="font-size:12px;color:#64748B;">입력을 마치면 입금 내역의 \'지출보고 입력\'에 체크해 주세요. 체크하기 전까지 주의 아이콘이 표시돼요.</span></div>' +
    '<button class="primary-btn" onclick="closeModal()">창 닫기</button>');
}
function ctReportToggle(gid, id, pid, on){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const p = (c.payments || []).find(x => x.id === pid); if(!p) return;
  p.reported = !!on;
  logActivity('CTMS 지출보고 ' + (on ? '입력 완료' : '입력 취소') + ': "' + ctmsGroupName(gid) + '" - ' + c.party + ' ' + (p.date || "") + ' ' + ctWon(p.amount));
  ctmsPersist(gid); renderTabContent();
}
function ctPayDelete(gid, id, pid){
  if(!ctmsCanEdit(gid)) return;
  const c = ctFind(gid, id); if(!c) return;
  const idx = (c.payments || []).findIndex(x => x.id === pid);
  if(idx < 0) return;
  const removed = c.payments.splice(idx, 1)[0];
  logActivity('CTMS 입금 삭제: "' + ctmsGroupName(gid) + '" - ' + c.party + ' ' + (removed.date || "") + ' ' + ctWon(removed.amount));
  state.lastAction = { gid, restore: () => { c.payments.splice(Math.min(idx, c.payments.length), 0, removed); }, undoMsg: '입금 내역 삭제 취소' };
  showUndoToast("입금 내역을 삭제했어요");
  ctmsPersist(gid); renderTabContent();
}
