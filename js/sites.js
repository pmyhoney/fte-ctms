/* ---------------- CTMS 참여 기관 (Site) ----------------
   과제 카드의 '기관 관리'에서 기관명·PI명을 입력하고 기관별 상태(준비·진행·종료·Drop)를 체크한다.
   rec.sites = [{ id, name, pi, status, kolId }]  (state.ctms[gid] 안에 함께 저장 — 회원은 save_ctms로 저장)
   기관 목록이 있으면 기관 수는 목록에서 계산한다: 전체 = Drop을 뺀 기관 수, 개시 = '진행'·'종료' 기관 수 (개시했다가 끝난 기관도 개시 기관으로 센다).
   (rec.siteTarget·siteActive에 계산 값을 넣어 두므로 요약·엑셀·360° 보기 등 기존 화면은 그대로 쓴다)
   PI는 KOL 명단과 맞춰(kolId) KOL 상세에 'CTMS 참여 기관'으로 보여 준다 (links.js). */

const CTMS_SITE_STATUS = ["준비", "진행", "종료", "Drop"];
const CTMS_SITE_META = {
  "준비": { c: "#B45309", s: "#FEF3E2" }, "진행": { c: "#1F5C8C", s: "#E6EFF7" },
  "종료": { c: "#1E7A4F", s: "#E7F6EC" }, "Drop": { c: "#64748B", s: "#EEF2F6" },
};
const ctmsSitesOf = (rec) => Array.isArray(rec && rec.sites) ? rec.sites : [];
function ctmsSiteCounts(sites){
  return { total: sites.filter(s => s.status !== "Drop").length, active: sites.filter(s => s.status === "진행" || s.status === "종료").length };
}
function ctmsSiteStatusHtml(st){
  const m = CTMS_SITE_META[st];
  return m ? '<span class="tr-chip" style="color:' + m.c + ';background:' + m.s + ';">' + esc(st) + '</span>' : '<span style="color:#94A3B8;">–</span>';
}
// 카드의 기관 개시 옆 버튼
function ctmsSiteBtnHtml(gid, rec){
  const n = ctmsSitesOf(rec).length;
  // 채운 색 버튼 (테두리만 있으면 눈에 잘 안 띈다)
  return '<button class="p360-btn site-btn view-ok" style="margin-left:6px;" title="참여 기관·PI 입력과 기관별 상태" onclick="event.stopPropagation();ctmsSitesOpen(\'' + gid + '\')">' +
    icon('list', 11) + (n ? ' 기관 관리 (' + n + ')' : ' 기관 입력') + '</button>';
}
// 펼친 카드의 기관 수 칸 옆 큰 버튼
function ctmsSiteBigBtnHtml(gid, rec){
  const n = ctmsSitesOf(rec).length;
  return '<div style="flex:0 0 auto;display:flex;align-items:flex-end;"><button class="add-btn view-ok" style="padding:6px 12px;font-size:12px;white-space:nowrap;" title="참여 기관·PI 입력과 기관별 상태" onclick="event.stopPropagation();ctmsSitesOpen(\'' + gid + '\')">' +
    icon('list', 13) + (n ? ' 기관 관리 (' + n + ')' : ' 기관·PI 입력') + '</button></div>';
}
// 펼친 카드의 기관 수 칸: 기관 목록이 있으면 계산 값만 보여 준다
function ctmsSiteNumHtml(gid, rec, field){
  if(!ctmsSitesOf(rec).length) return ctmsNumInput(gid, field, rec[field], "0");
  return '<div class="input" title="기관 관리 목록에서 계산돼요" style="font-size:12px;padding:6px 8px;background:#F8FAFC;color:#475569;cursor:pointer;" onclick="ctmsSitesOpen(\'' + gid + '\')">' +
    (rec[field] || 0) + ' <span style="font-size:10.5px;color:#94A3B8;">(목록 기준)</span></div>';
}

/* --- 팝업 --- */
let ctmsSiteDraft = null; // { gid, edit, rows }
const ctmsSiteBlank = () => ({ id: uid("site"), name: "", pi: "", status: "준비", kolId: null });
function ctmsSitesOpen(gid){
  const rec = ctmsRecOf(gid);
  if(!rec) return;
  const edit = ctmsCanEdit(gid);
  ctmsSiteDraft = { gid, edit, rows: ctmsSitesOf(rec).map(s => Object.assign({}, s)) };
  if(edit && !ctmsSiteDraft.rows.length) ctmsSiteDraft.rows.push(ctmsSiteBlank());
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">참여 기관 (Site)</div>' +
    '<div style="font-size:12.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(gid)) + '</div>' +
    '<div id="cs-sum" style="font-size:12.5px;color:#475569;margin-bottom:10px;"></div>' +
    '<div class="modal-scroll"><div id="cs-rows"></div>' +
      (edit ? '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:var(--accent);border:1px dashed var(--accent);margin-top:4px;" onclick="ctmsSiteAdd()">' + icon('plus', 13) + ' 기관 추가</button>' : '') +
      '<div style="font-size:11.5px;color:#94A3B8;margin-top:8px;line-height:1.6;">전체 기관 수는 Drop을 뺀 기관 수, 개시 기관 수는 \'진행\'·\'종료\' 기관 수(개시했다가 끝난 기관 포함)로 카드에 반영돼요.' +
        'PI명은 KOL 명단에서 찾아 연결하고, 연결된 KOL의 상세 정보에 이 과제가 표시돼요.</div>' +
    '</div>' + lkListsHtml() + // links.js — 기관·PI 자동 완성
    '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="ctmsSiteDraft=null;closeModal()">' + (edit ? '취소' : '닫기') + '</button>' +
      (edit ? '<button class="add-btn" id="cs-save" style="flex:1;justify-content:center;" onclick="ctmsSitesSave()">저장</button>' : '') +
    '</div>', "wide"
  );
  ctmsSitesRender();
  lkNeed("kol").then(() => { if(ctmsSiteDraft && ctmsSiteDraft.gid === gid && document.getElementById("cs-rows")){ ctmsSitesCollect(); ctmsSitesRender(); } });
}
function ctmsSitesCollect(){
  if(!ctmsSiteDraft || !ctmsSiteDraft.edit) return;
  ctmsSiteDraft.rows.forEach((r, i) => ["name", "pi"].forEach(k => {
    const el = document.getElementById("cs-" + i + "-" + k);
    if(el) r[k] = el.value.trim();
  }));
}
function ctmsSitesRender(){
  const box = document.getElementById("cs-rows"), d = ctmsSiteDraft;
  if(!box || !d) return;
  const dis = d.edit ? '' : ' disabled';
  const c = ctmsSiteCounts(d.rows.filter(r => r.name || r.pi));
  const sum = document.getElementById("cs-sum");
  const cnt = (st) => d.rows.filter(r => (r.name || r.pi) && r.status === st).length;
  if(sum) sum.innerHTML = '전체 기관 <b>' + c.total + '</b> · 개시 <b style="color:#1F5C8C;">' + c.active + '</b>' +
    (c.active ? ' <span style="color:#94A3B8;">(진행 ' + cnt("진행") + ' · 종료 ' + cnt("종료") + ')</span>' : '') +
    ["준비", "Drop"].map(st => cnt(st) ? ' · ' + st + ' ' + cnt(st) : '').join("");
  if(!d.rows.length){ box.innerHTML = '<div class="empty" style="padding:18px;">입력된 기관이 없어요.</div>'; return; }
  box.innerHTML = d.rows.map((r, i) => {
    const k = lkKolMatch(r.pi, r.name, r.kolId); // links.js
    return '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:' + (r.status === "Drop" ? '#F8FAFC' : '#fff') + ';">' +
      '<div style="flex:0 0 22px;font-size:12px;font-weight:800;color:#94A3B8;padding-bottom:9px;">' + (i + 1) + '</div>' +
      '<div style="flex:1 1 200px;min-width:0;"><div class="field-label">기관명 *</div><input id="cs-' + i + '-name" class="input" list="lk-place-list" placeholder="예: 서울대학교병원" value="' + esc(r.name) + '"' + dis + '/></div>' +
      '<div style="flex:1 1 160px;min-width:0;"><div class="field-label">PI명' + (k ? ' <span style="font-size:10px;font-weight:700;padding:0 5px;border-radius:999px;background:#E6EFF7;color:#1F5C8C;" title="' + esc([lkKolCatName(k), k.hospital].filter(Boolean).join(" · ")) + '">KOL</span>' : '') + '</div>' +
        '<input id="cs-' + i + '-pi" class="input" list="lk-person-list" placeholder="예: 홍길동" value="' + esc(r.pi) + '" onchange="ctmsSitePi(' + i + ')"' + dis + '/></div>' +
      '<div style="flex:0 0 auto;display:flex;gap:10px;align-items:center;padding-bottom:9px;">' +
        CTMS_SITE_STATUS.map(s => '<label style="display:flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:' + CTMS_SITE_META[s].c + ';cursor:pointer;">' +
          '<input type="checkbox"' + (r.status === s ? ' checked' : '') + ' onchange="ctmsSiteStatus(' + i + ',\'' + s + '\',this.checked)"' + dis + '/> ' + s + '</label>').join("") +
      '</div>' +
      (d.edit ? '<button class="icon-btn" title="이 기관 삭제" style="padding-bottom:9px;" onclick="ctmsSiteRemove(' + i + ')">' + icon('trash', 14) + '</button>' : '') +
    '</div>';
  }).join("");
}
function ctmsSiteAdd(){ ctmsSitesCollect(); ctmsSiteDraft.rows.push(ctmsSiteBlank()); ctmsSitesRender(); const el = document.getElementById("cs-" + (ctmsSiteDraft.rows.length - 1) + "-name"); if(el && el.focus) el.focus(); }
function ctmsSiteRemove(i){ ctmsSitesCollect(); ctmsSiteDraft.rows.splice(i, 1); ctmsSitesRender(); }
// 상태는 한 기관에 하나만 (다른 칸을 체크하면 이전 체크는 풀린다)
function ctmsSiteStatus(i, st, on){
  ctmsSitesCollect();
  const r = ctmsSiteDraft.rows[i]; if(!r) return;
  r.status = on ? st : "";
  ctmsSitesRender();
}
// PI를 입력하면 KOL 명단에서 찾아 기관명 빈칸을 채운다
function ctmsSitePi(i){
  ctmsSitesCollect();
  const r = ctmsSiteDraft.rows[i]; if(!r) return;
  r.kolId = null;
  const k = lkKolMatch(r.pi, r.name);
  if(k && !r.name && k.hospital) r.name = lkHospShort(k.hospital);
  ctmsSitesRender();
}
function ctmsSitesSave(){
  const d = ctmsSiteDraft;
  if(!d || !ctmsCanEdit(d.gid)) return;
  const rec = ctmsRecOf(d.gid);
  if(!rec){ closeModal(); return; }
  ctmsSitesCollect();
  const rows = d.rows.filter(r => r.name || r.pi);
  const bad = rows.findIndex(r => !r.name);
  if(bad >= 0){ showToast((d.rows.indexOf(rows[bad]) + 1) + "번째 기관의 기관명을 입력해 주세요", { error: true }); return; }
  rows.forEach(r => {
    if(!CTMS_SITE_STATUS.includes(r.status)) r.status = "";
    if(kol.rows){ const k = lkKolMatch(r.pi, r.name, r.kolId); r.kolId = k ? k.id : null; } // 명단을 못 불러왔으면 이전 값 유지
  });
  const before = ctmsSitesOf(rec).length;
  rec.sites = rows;
  const c = ctmsSiteCounts(rows);
  rec.siteTarget = rows.length ? c.total : null;
  rec.siteActive = rows.length ? c.active : null;
  if(!rows.length) delete rec.sites;
  logActivity('CTMS 기관 수정: "' + ctmsGroupName(d.gid) + '" 기관 ' + before + '→' + rows.length + '곳 (개시 ' + c.active + ')');
  ctmsPersist(d.gid);
  ctmsSiteDraft = null;
  closeModal();
  showToast("기관 정보를 저장했어요");
  renderTabContent();
}

/* --- KOL 쪽: 이 KOL이 PI인 CTMS 기관 --- */
function lkKolCtmsRows(p){
  const out = [];
  Object.keys(state.ctms || {}).forEach(gid => {
    const rec = ctmsRecOf(gid);
    ctmsSitesOf(rec).forEach(s => {
      const hit = s.kolId ? s.kolId === p.id : ((lkKolMatch(s.pi, s.name) || {}).id === p.id);
      if(hit) out.push({ gid, taskName: ctmsGroupName(gid) || lkGroupName(gid), site: s.name, status: s.status });
    });
  });
  return out;
}
function lkKolCtmsHtml(p){
  const list = lkKolCtmsRows(p);
  if(!list.length) return '';
  return '<div class="kol-detail-row"><div class="field-label">CTMS 참여 기관</div><div>' + list.map(r =>
    '<a class="view-ok" style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation();p360Open(\'' + r.gid + '\')">' + esc(r.taskName) + '</a> ' +
    '<span style="color:#94A3B8;">' + esc(r.site) + '</span> ' + ctmsSiteStatusHtml(r.status)).join('<br/>') + '</div></div>';
}
// 엑셀 'CTMS 기관' 시트
function ctmsSiteExportRows(groups){
  const rows = [];
  groups.forEach(g => ctmsSitesOf(ctmsRecOf(g.gid)).forEach((s, i) => {
    const k = kol.rows ? lkKolMatch(s.pi, s.name, s.kolId) : null;
    rows.push({ "과제명": g.primary.taskName, "No.": i + 1, "기관명": s.name, "PI명": s.pi || "", "상태": s.status || "", "KOL 등록": s.kolId || k ? "Y" : "" });
  }));
  return rows;
}
// 360° 보기의 기관 표
function ctmsSiteTableHtml(rec){
  const sites = ctmsSitesOf(rec);
  if(!sites.length) return '';
  return '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin:10px 0 4px;">참여 기관</div><div style="overflow-x:auto;"><table style="font-size:12px;"><thead><tr><th>기관명</th><th>PI</th><th>상태</th></tr></thead><tbody>' +
    sites.map(s => '<tr><td style="text-align:left;">' + esc(s.name) + '</td><td style="text-align:left;">' + (s.pi ? esc(s.pi) : '–') +
      (kol.rows ? lkKolBadgeHtml(lkKolMatch(s.pi, s.name, s.kolId)) : '') + '</td><td>' + ctmsSiteStatusHtml(s.status) + '</td></tr>').join("") + '</tbody></table></div>';
}
