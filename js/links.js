/* ---------------- 탭 사이 연동 ----------------
   자유 입력 글자 대신 ID로 이어서, 같은 정보를 여러 탭에서 다르게 입력하는 오류를 줄인다.
   - 주간보고 방문 기록 → 배정 과제 (weekly_reports.group_id), 방문처·PI는 KOL·IIT·이전 기록에서 자동 완성
   - 교육 이력 → 팀원 (trainings.member_id)
   - IIT 연구자 ↔ KOL 명단 (iit_projects.data.kolId, 이름·병원으로 찾기)
   - 과제 360° 보기: 한 과제의 배정·인수인계·CTMS·IIT·방문·교육·활동 기록을 한 화면에
   supabase/migrations/20261104000000_cross_links.sql */

const lkNorm = (s) => String(s || "").replace(/\s/g, "");
const lkMemberName = (id) => { const m = id && state.members.find(x => x.id === id); return m ? m.name : ""; };

// 다른 탭의 데이터를 조용히 불러온다 (이미 있으면 바로). 화면은 각 탭 loader가 자기 탭일 때만 다시 그린다.
const LK_SRC = {
  kol: { has: () => !!(kol.rows && kol.cats), load: () => kolLoad() },
  iit: { has: () => !!iit.rows, load: () => iitLoad() },
  weekly: { has: () => !!weekly.rows, load: () => weeklyLoad() },
  training: { has: () => !!training.rows, load: () => trainingLoad() },
};
const lkPending = {};
function lkNeed(key){
  const s = LK_SRC[key];
  if(s.has()) return Promise.resolve();
  if(!lkPending[key]) lkPending[key] = Promise.resolve().then(s.load).catch(() => {}).then(() => { delete lkPending[key]; });
  return lkPending[key];
}

/* --- 과제 (배정 그룹) --- */
function lkGroups(){
  const mid = currentProfile && currentProfile.member_id;
  return ctmsAllGroups().map(g => ({
    gid: g.gid, name: g.primary.taskName || "", open: ctmsIsOpen(g),
    mine: !!mid && g.members.some(a => a.memberId === mid),
  })).sort((a, b) => (b.open - a.open) || a.name.localeCompare(b.name, "ko"));
}
function lkGroupName(gid){
  const a = gid && state.assignments.find(x => (x.groupId || x.id) === gid);
  return a ? a.taskName || "" : "";
}
// 과제 선택칸: 내 과제 → 진행 중 과제 → 끝난 과제, 맨 끝에 '직접 입력'
function lkTaskSelectHtml(id, gid, text, onchange){
  const groups = lkGroups(), opt = (g) => '<option value="' + esc(g.gid) + '"' + (g.gid === gid ? ' selected' : '') + '>' + esc(g.name) + '</option>';
  const grp = (label, list) => list.length ? '<optgroup label="' + label + '">' + list.map(opt).join("") + '</optgroup>' : '';
  const known = gid && groups.some(g => g.gid === gid);
  const manual = !known && !!text;
  return '<select id="' + id + '" class="input" onchange="' + onchange + '">' +
    '<option value="">과제 선택</option>' +
    grp("내 과제", groups.filter(g => g.mine && g.open)) +
    grp("진행 중 과제", groups.filter(g => !g.mine && g.open)) +
    grp("끝난 과제", groups.filter(g => !g.open)) +
    '<option value="__text__"' + (manual ? ' selected' : '') + '>직접 입력 (배정에 없는 과제)</option>' +
  '</select>';
}

/* --- KOL --- */
// "서울대학교병원 순환기내과 교수" → "서울대학교병원"
function lkHospShort(h){
  const s = String(h || "").trim(), m = s.match(/^(.+?(병원|의료원|의원|센터))/);
  return m ? m[1].trim() : s.split(/\s+/)[0] || "";
}
// 이름이 같은 KOL 중 병원까지 맞는 사람 하나 (애매하면 null)
function lkKolMatch(name, site, kolId){
  if(!kol.rows || !lkNorm(name)) return null;
  const same = kol.rows.filter(p => lkNorm(p.name) === lkNorm(name));
  if(kolId){ const p = same.find(x => x.id === kolId); if(p) return p; }
  if(same.length === 1) return same[0];
  const s = lkNorm(site);
  if(!s) return null;
  const hit = same.filter(p => { const h = lkNorm(lkHospShort(p.hospital)); return h && (s.includes(h) || h.includes(s)); });
  return hit.length === 1 ? hit[0] : null;
}
function lkKolCatName(p){ const c = (kol.cats || []).find(x => x.id === p.category_id); return c ? c.name : ""; }
// KOL 탭으로 가서 그 사람을 펼쳐 보여 준다
function lkKolGo(id){
  closeModal();
  lkNeed("kol").then(() => {
    const p = (kol.rows || []).find(x => x.id === id);
    if(!p){ showToast("KOL 명단에서 찾지 못했어요", { error: true }); return; }
    kol.cat = p.category_id; kol.f = KOL_EMPTY_F(); kol.f.q = p.name; kol.open = {}; kol.open[id] = true; kol.evalOpen = null;
    setTab("kol");
  });
}
function lkKolBadgeHtml(p){
  return p ? '<span class="view-ok" onclick="event.stopPropagation();lkKolGo(' + p.id + ')" title="KOL 명단에서 보기: ' + esc([lkKolCatName(p), p.hospital].filter(Boolean).join(" · ")) + '" ' +
    'style="cursor:pointer;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;background:#E6EFF7;color:#1F5C8C;white-space:nowrap;margin-left:4px;">KOL</span>' : '';
}
// 이 KOL이 연구자로 있는 IIT 과제 (KOL 상세에 표시)
function lkKolIitRows(p){
  if(!iit.rows) return [];
  return iitAllRows().filter(r => {
    if(r.kolId) return r.kolId === p.id;
    const m = lkKolMatch(r.investigator, r.site);
    return !!m && m.id === p.id;
  });
}

/* --- 자동 완성 목록 (datalist) --- */
// 같은 값은 하나로 (동명이인처럼 설명이 다르면 설명을 이어 붙인다: "세브란스병원 · KOL / 삼성서울병원 · KOL")
function lkUniq(list){
  const seen = {}, out = [];
  list.forEach(x => {
    const v = String(x.v || "").trim(), k = lkNorm(v), l = x.l || "";
    if(!v) return;
    if(!seen[k]){ seen[k] = { v, l }; out.push(seen[k]); }
    else if(l && !seen[k].l.split(" / ").includes(l)) seen[k].l = seen[k].l ? seen[k].l + " / " + l : l;
  });
  return out;
}
const lkOptions = (list) => list.map(x => '<option value="' + esc(x.v) + '"' + (x.l ? ' label="' + esc(x.l) + '"' : '') + '></option>').join("");
function lkPlaceList(){
  return lkUniq([].concat(
    (weekly.rows || []).map(r => ({ v: r.visit_place })),
    iit.rows ? iitAllRows().map(r => ({ v: r.site })) : [],
    (kol.rows || []).map(p => ({ v: lkHospShort(p.hospital) }))
  )).sort((a, b) => a.v.localeCompare(b.v, "ko"));
}
function lkPersonList(){
  return lkUniq([].concat(
    (kol.rows || []).map(p => ({ v: p.name, l: [lkHospShort(p.hospital), lkKolCatName(p), "KOL"].filter(Boolean).join(" · ") })),
    iit.rows ? iitAllRows().map(r => ({ v: r.investigator, l: [r.site, "IIT 연구자"].filter(Boolean).join(" · ") })) : [],
    (weekly.rows || []).map(r => ({ v: r.pi_name, l: r.visit_place }))
  ));
}
function lkFillLists(){
  const set = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };
  set("lk-place-list", lkOptions(lkPlaceList()));
  set("lk-person-list", lkOptions(lkPersonList()));
}
// 탭 화면에 한 번 넣어 두면 그 탭의 입력칸·팝업에서 함께 쓴다
function lkListsHtml(){
  setTimeout(() => { lkFillLists(); ["kol", "iit"].forEach(k => lkNeed(k).then(lkFillLists)); }, 0);
  return '<datalist id="lk-place-list"></datalist><datalist id="lk-person-list"></datalist>';
}

/* --- 주간보고: 과제 선택·PI 입력 시 빈칸 채우기 --- */
function wkTaskName(r){ return (r.group_id && lkGroupName(r.group_id)) || r.task_name || ""; }
function wkTaskPick(p){
  const sel = document.getElementById(p + "-gid"), txt = document.getElementById(p + "-task_name");
  if(!sel || !txt) return;
  txt.style.display = sel.value === "__text__" ? "" : "none";
  if(sel.value === "__text__") txt.focus();
  if(!sel.value || sel.value === "__text__") return;
  // IIT 과제면 기관·연구자를 방문처·PI 빈칸에 채운다
  lkNeed("iit").then(() => {
    const r = iitAllRows().find(x => x.gid === sel.value);
    const fill = (k, v) => { const el = document.getElementById(p + "-" + k); if(el && !el.value.trim() && v) el.value = v; };
    if(r){ fill("visit_place", r.site); fill("pi_name", r.investigator); }
  });
}
function wkPiPick(p){
  const pi = document.getElementById(p + "-pi_name"), place = document.getElementById(p + "-visit_place");
  if(!pi || !place || place.value.trim()) return;
  const k = lkKolMatch(pi.value, "");
  if(k && k.hospital) place.value = lkHospShort(k.hospital);
}
// 저장할 값: { group_id, task_name } (과제를 고르면 그 과제명, 직접 입력이면 입력 글자)
function wkTaskCollect(p){
  const v = document.getElementById(p + "-gid").value;
  if(v && v !== "__text__") return { group_id: v, task_name: lkGroupName(v) };
  return { group_id: null, task_name: v === "__text__" ? document.getElementById(p + "-task_name").value.trim() : "" };
}

/* --- 교육: 팀원 --- */
function trMemberName(r){ return lkMemberName(r.member_id) || r.member || ""; }
function trDefaultMemberId(){
  if(!currentProfile) return "";
  if(currentProfile.member_id && lkMemberName(currentProfile.member_id)) return currentProfile.member_id;
  const m = state.members.find(x => lkNorm(x.name) === lkNorm(currentProfile.name));
  return m ? m.id : "";
}
function trMemberSelectHtml(r){
  const cur = r ? r.member_id || "" : trDefaultMemberId();
  const legacy = r && !lkMemberName(r.member_id) && r.member; // 팀원 목록에 없는 예전 입력
  const members = state.members.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return '<select id="tre-member_id" class="input">' +
    (legacy ? '<option value="" selected>' + esc(r.member) + ' (팀원 목록에 없음)</option>' : '<option value="">선택하세요</option>') +
    members.map(m => '<option value="' + esc(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' + esc(m.name) + '</option>').join("") +
  '</select>';
}

/* ---------------- 과제 360° 보기 ---------------- */
function p360Btn(gid, small){
  // 작은 버튼도 테두리 있는 알약 모양으로 (글자만 있으면 버튼인 줄 모른다)
  return '<button class="' + (small ? 'p360-btn' : 'btn-export') + ' view-ok" title="과제 정보 한눈에 보기 (배정·CTMS·IIT·방문·교육)" ' +
    'style="flex:0 0 auto;" onclick="event.stopPropagation();p360Open(\'' + gid + '\')">' + icon('list', small ? 12 : 13) + (small ? ' 360° 보기' : ' 과제 360°') + '</button>';
}
let p360Gid = null;
function p360Open(gid){
  if(!ctmsAllGroups().some(g => g.gid === gid)){ showToast("배정에서 찾지 못한 과제예요", { error: true }); return; }
  p360Gid = gid;
  showModal('<div id="p360-body">' + p360Html(gid) + '</div>', "wide");
  // 다른 탭 데이터가 오면 이 팝업만 다시 그린다
  Promise.all(["iit", "weekly", "training", "kol"].map(lkNeed)).then(() => {
    const el = document.getElementById("p360-body");
    if(el && p360Gid === gid) el.innerHTML = p360Html(gid);
  });
}
function p360Html(gid){
  const g = ctmsAllGroups().find(x => x.gid === gid);
  if(!g) return '<div class="empty">과제를 찾지 못했어요</div>';
  const t = taskTypeById()[g.primary.taskTypeId], prod = productById()[g.primary.productId], name = g.primary.taskName || "";
  const now = currentPeriod();
  const dash = (v) => v ? esc(v) : '<span style="color:#94A3B8;">–</span>';
  const loading = '<div style="font-size:12px;color:#94A3B8;">불러오는 중…</div>';
  const none = (msg) => '<div style="font-size:12px;color:#94A3B8;">' + msg + '</div>';
  const sec = (title, inner, extra) => '<div class="iitd-sec full"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
    '<div style="font-weight:800;font-size:13px;color:#1F2937;">' + title + '</div>' + (extra || '') + '</div>' + inner + '</div>';
  const info = (label, val) => '<div><div style="font-size:11px;color:#94A3B8;">' + label + '</div><div style="font-size:13px;font-weight:600;">' + val + '</div></div>';
  const grid = (items) => '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">' + items.join("") + '</div>';
  const table = (head, rows) => '<div style="overflow-x:auto;"><table style="font-size:12px;"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join("") + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td style="white-space:normal;text-align:left;">' + c + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>';
  const go = (label, js) => '<button class="add-btn view-ok" style="padding:4px 10px;font-size:11.5px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="' + js + '">' + label + ' ›</button>';

  // 1) 배정·담당자 이력 (인수인계 포함)
  const members = g.members.slice().sort((a, b) => (a.startPeriod || "").localeCompare(b.startPeriod || ""));
  const curFte = members.filter(a => isActive(a, now)).reduce((s, a) => s + fteForPeriod(a, now), 0);
  const starts = members.map(a => a.startPeriod).filter(Boolean).sort(), ends = members.map(a => a.endPeriod);
  const period = (starts[0] || "?") + " ~ " + (ends.some(e => !e) ? "진행중" : ends.filter(Boolean).sort().pop() || "?");
  const hoText = (a) => {
    const ho = a.handover;
    if(!ho || !ho.needed) return '';
    const tr = ho.training || {};
    return '인계자 ' + esc(lkMemberName(ho.from) || "–") + ' · ' + (ho.doneDate ? '완료 ' + esc(ho.doneDate) : '<b style="color:#B45309;">진행중</b>') +
      (tr.done ? '<br/>Training ' + esc(tr.date) : '');
  };
  const assignSec = sec("배정 · 담당자",
    grid([info("과제 유형", dash(t ? t.name : "")), info("품목", dash(prod ? prod.name : "")), info("기간", esc(period)),
      info("현재 투입", fmt(curFte) + " FTE"), info("상태", esc(g.status))]) +
    '<div style="margin-top:10px;">' + table(["담당자", "기간", "FTE", "상태", "인수인계"], members.map(a => [
      '<b>' + dash(lkMemberName(a.memberId) || "삭제된 팀원") + '</b>' + (isActive(a, now) ? '' : ' <span style="font-size:10.5px;color:#94A3B8;">(현재 아님)</span>'),
      esc(a.startPeriod || "?") + "~" + esc(a.endPeriod || "진행중"), fmt(a.fte), esc(a.status || ""), hoText(a) || '<span style="color:#94A3B8;">–</span>',
    ])) + '</div>',
    isAdmin() ? go("과제 배정", "closeModal();setTab('assign')") : '');

  // 2) CTMS
  const rec = ctmsRecOf(gid), stopped = ctmsStoppedRecOf(gid);
  const issues = state.ctmsIssues[gid] || [], cost = state.ctmsCost[gid] || [];
  const openIssues = issues.filter(e => ctmsEntryType(e) === "issue" && e.status !== "resolved").length;
  const costSum = (k) => cost.filter(e => ctmsKind(e) === k).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  let ctmsInner;
  if(rec){
    const s = ctmsSummary(rec);
    ctmsInner = grid([info("진행 상태", ctmsHealthBadge(s.health)), info("마일스톤", s.done + " / " + s.total + " 완료"),
      info("프로토콜·과제 번호", dash(rec.protocolNo)), info("CRO", dash(ctmsCroText(rec))),
      info("기관 (개시/목표)", (rec.siteActive || 0) + " / " + (rec.siteTarget || 0)),
      info("피험자 (등록/목표)", (rec.subjEnrolled || 0) + " / " + (rec.subjTarget || 0)),
      info("미해결 이슈", openIssues + "건"), info("비용 계획/집행 (천원)", costSum("plan").toLocaleString("ko-KR") + " / " + costSum("actual").toLocaleString("ko-KR"))]) +
      '<div style="margin-top:10px;">' + table(["단계", "계획", "실적", "계획 변경"], ctmsStagesOf(rec).map(st => {
        const m = (rec.milestones || {})[st.key] || {}, n = ctmsPlanChangeCount(m), late = !m.actual && m.plan && m.plan < now;
        return [esc(st.label), m.plan ? '<span style="' + (late ? 'color:#B91C1C;font-weight:700;' : '') + '">' + esc(m.plan) + (late ? ' (지연)' : '') + '</span>' : '–', dash(m.actual), n ? n + "회 (최초 " + esc(ctmsPlanBaseline(m) || "") + ")" : "–"];
      })) + '</div>';
  }else{
    ctmsInner = none(stopped ? "CTMS 추적이 해제된 과제예요 (이전 기록 보관 중: " + ctmsStoppedSummaryHtml(stopped) + ")" : "CTMS로 추적하지 않는 과제예요") +
      (issues.length || cost.length ? none("진행·이슈 " + issues.length + "건 · 비용 기록 " + cost.length + "건") : '');
  }
  const ctmsSec = sec("CTMS", ctmsInner, go("CTMS", "closeModal();setTab('ctms')"));

  // 3) IIT
  let iitInner, iitExtra = '';
  if(!iit.rows) iitInner = loading;
  else{
    const r = iitAllRows().find(x => x.gid === gid);
    if(!r) iitInner = none("IIT 과제가 아니에요 (과제 유형이 IIT[SC]·IIT[PC]인 과제만 IIT 관리에 보여요)");
    else{
      const k = lkKolMatch(r.investigator, r.site, r.kolId);
      iitInner = grid([info("과제코드", dash(r.code)), info("기관명", dash(r.site)), info("연구자명", dash(r.investigator) + lkKolBadgeHtml(k)),
        info("진행 현황", iitStatusHtml(r)), info("Publication", iitPubHtml(r, true))]);
      iitExtra = go("IIT 상세", "iitDetailOpen('" + r.key + "')");
    }
  }
  const iitSec = sec("IIT", iitInner, iitExtra);

  // 4) 방문 기록 (주간보고) — DB 정책상 볼 수 있는 기록만
  let visitInner;
  if(!weekly.rows) visitInner = loading;
  else{
    const v = weekly.rows.filter(r => r.group_id === gid);
    visitInner = v.length ? table(["날짜", "방문처", "PI", "방문사유", "방문자"], v.map(r => [esc(r.visit_date), dash(r.visit_place), dash(r.pi_name), dash(r.reason), dash(r.visitor)]))
      : none("이 과제로 연결된 방문 기록이 없어요 (주간보고에서 과제를 골라 기록하면 여기에 모여요)");
  }
  const visitSec = sec("방문 기록 (주간보고)", visitInner);

  // 5) 교육 (인수인계 Training 등)
  let eduInner;
  if(!training.rows) eduInner = loading;
  else{
    const ids = members.map(a => a.handover && a.handover.training && a.handover.training.trainingId).filter(Boolean);
    const tag = lkNorm("[인수인계] " + name);
    const e = training.rows.filter(r => ids.includes(r.id) || (r.edu_type === "과제" && lkNorm(r.title).includes(lkNorm(name)) && lkNorm(name)) || lkNorm(r.title) === tag);
    eduInner = e.length ? table(["이수일", "팀원", "교육명", "주관"], e.map(r => [esc(r.edu_date), dash(trMemberName(r)), esc(r.title), dash(r.org)]))
      : none("이 과제와 연결된 교육 이력이 없어요");
  }
  const eduSec = sec("교육 (과제 Training)", eduInner);

  // 6) 최근 활동 (이 과제명이 들어간 기록)
  const acts = (state.activityLog || []).filter(x => name && String(x.msg || "").includes(name)).slice(0, 10);
  const actSec = sec("최근 활동", acts.length ? '<div style="font-size:12px;color:#475569;line-height:1.7;">' +
    acts.map(x => '<span style="color:#94A3B8;">' + esc(activityTimeLabel(x.ts)) + '</span> ' + esc(x.msg)).join('<br/>') + '</div>' : none("최근 활동 기록이 없어요"));

  return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
      '<div style="min-width:0;"><div style="font-size:11px;font-weight:700;color:#94A3B8;">과제 360°</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px;">' + lineTagHtml(t ? t.line : null) + (prod ? '<span class="product-tag">' + esc(prod.name) + '</span>' : '') +
        '<span style="font-weight:800;font-size:15px;">' + esc(name) + '</span></div></div>' +
    '</div>' +
    '<div class="modal-scroll iitd-grid">' + assignSec + ctmsSec + iitSec + visitSec + eduSec + actSec + '</div>' +
    '<div style="display:flex;margin-top:10px;"><button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button></div>';
}

/* ---------------- 인수인계 완료 → 인계자 담당 종료월 맞추기 ---------------- */
// 인수인계를 끝냈는데 인계자 배정이 그 뒤로도 이어지면 FTE가 두 번 잡힌다 → 종료월을 바꿀지 묻는다
function hoFromAssignment(a){
  const ho = a.handover;
  if(!ho || !ho.needed || !ho.from || !a.groupId) return null;
  return state.assignments.find(x => x.groupId === a.groupId && x.id !== a.id && x.memberId === ho.from) || null;
}
function hoEndMismatch(a){
  const ho = a.handover, f = hoFromAssignment(a);
  if(!f || !ho.doneDate) return null;
  const month = ho.doneDate.slice(0, 7);
  if(f.startPeriod && f.startPeriod > month) return null;
  return !f.endPeriod || f.endPeriod > month ? { f, month } : null;
}
function hoEndSuggest(a){
  const x = hoEndMismatch(a);
  if(!x || !isAdmin()) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">인계자 담당 종료월</div>' +
    '<div style="font-size:12.5px;color:#94A3B8;margin-bottom:12px;">' + esc(a.taskName) + '</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:12px;">인수인계가 <b>' + esc(a.handover.doneDate) + '</b>에 끝났는데, 인계자 <b>' + esc(lkMemberName(x.f.memberId)) + '</b>의 배정은 ' +
      esc(x.f.startPeriod + "~" + (x.f.endPeriod || "진행중")) + '로 이어지고 있어요.<br/>종료월을 인수인계 완료 월로 바꿀까요? <span style="color:#94A3B8;">같이 계속 담당한다면 그대로 두세요.</span></div>' +
    '<div class="field"><div class="field-label">인계자 종료월</div><input id="hoend-month" class="input" type="month" value="' + esc(x.month) + '" min="' + esc(x.f.startPeriod || "") + '"/></div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">그대로 두기</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;" onclick="hoEndApply(\'' + a.id + '\')">종료월 변경</button>' +
    '</div>', "md"
  );
}
function hoEndApply(id){
  const a = state.assignments.find(x => x.id === id), f = a && hoFromAssignment(a);
  const month = (document.getElementById("hoend-month") || {}).value || "";
  if(!f){ closeModal(); return; }
  if(!/^\d{4}-\d{2}$/.test(month)){ showToast("종료월을 입력해 주세요", { error: true }); return; }
  if(f.startPeriod && month < f.startPeriod){ showToast("종료월이 시작월보다 빠를 수 없어요", { error: true }); return; }
  const prev = f.startPeriod + "~" + (f.endPeriod || "진행중");
  f.endPeriod = month;
  f.periodNote = "인수인계 완료 (" + a.handover.doneDate + ")";
  logActivity('배정 기간 수정: "' + f.taskName + '" ' + lkMemberName(f.memberId) + ' ' + prev + ' → ' + f.startPeriod + '~' + month + ' (인수인계 완료)');
  scheduleSave();
  closeModal();
  showToast("인계자 종료월을 " + month + "로 바꿨어요");
  renderTabContent();
}
// 배정 현황 '확인이 필요해요'에 넣을 문장들
function hoAlertItems(){
  const live = (a) => a.status !== "종료" && a.status !== "중단";
  const pending = fteAssignments().filter(a => live(a) && a.handover && a.handover.needed && !a.handover.doneDate);
  const overlap = fteAssignments().filter(a => live(a) && hoEndMismatch(a) && live(hoEndMismatch(a).f));
  const items = [];
  if(pending.length) items.push('인수인계가 끝나지 않은 과제 <b style="color:var(--danger);">' + pending.length + '건</b> — ' +
    pending.map(a => esc(a.taskName) + ' (' + esc(lkMemberName(a.memberId)) + ')').join(', '));
  if(overlap.length) items.push('인수인계를 마쳤지만 인계자 배정이 이어지는 과제 <b style="color:var(--danger);">' + overlap.length + '건</b> — ' +
    overlap.map(a => esc(a.taskName) + ' (' + esc(lkMemberName(hoEndMismatch(a).f.memberId)) + ', 과제 배정에서 \'인수인계\' 표시를 눌러 확인)').join(', '));
  return items;
}

/* --- 주간보고 표·수정 팝업 --- */
function wkTaskCellHtml(r){
  const linked = r.group_id && lkGroupName(r.group_id);
  return '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">' + esc(wkTaskName(r)) + (linked ? p360Btn(r.group_id, true) : '') + '</span>';
}
function wkEditInputHtml(c, r){
  if(c.key === "task_name"){
    const linked = !!(r.group_id && lkGroupName(r.group_id)), text = linked ? "" : r.task_name || "";
    return lkTaskSelectHtml("wke-gid", linked ? r.group_id : "", text, "wkTaskPick('wke')") +
      '<input id="wke-task_name" class="input" type="text" placeholder="과제명 직접 입력" value="' + esc(text) + '" style="' + (text ? '' : 'display:none;') + 'margin-top:6px;"/>';
  }
  const extra = c.key === "visit_place" ? ' list="lk-place-list"' : c.key === "pi_name" ? ' list="lk-person-list" onchange="wkPiPick(\'wke\')"' : '';
  return '<input id="wke-' + c.key + '" class="input" type="' + (c.key === "visit_date" ? "date" : "text") + '" value="' + esc(r[c.key]) + '"' + extra + '/>';
}

/* --- IIT: 품목은 품목 관리 목록에서, 연구자는 KOL 명단과 맞춰 보기 --- */
function iitProdName(d){ const p = d && d.productId && productById()[d.productId]; return p ? p.name : (d && d.product) || ""; }
function iitProductSelectHtml(r){
  let cur = r && r.productId && productById()[r.productId] ? r.productId : "";
  if(!cur && r && r.product){ const p = state.products.find(x => lkNorm(x.name) === lkNorm(r.product)); if(p) cur = p.id; }
  const manual = !cur && !!(r && r.product);
  return '<select id="iit-productId" class="input" onchange="iitProductPick()"><option value="">선택 안 함</option>' +
    state.products.map(p => '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>').join("") +
    '<option value="__text__"' + (manual ? ' selected' : '') + '>직접 입력 (품목 관리에 없음)</option></select>' +
    '<input id="iit-product" class="input" type="text" placeholder="품목명 직접 입력" value="' + esc(manual ? r.product : "") + '" style="' + (manual ? '' : 'display:none;') + 'margin-top:6px;"/>';
}
function iitProductPick(){
  const sel = document.getElementById("iit-productId"), txt = document.getElementById("iit-product"), line = document.getElementById("iit-line");
  if(!sel || !txt) return;
  txt.style.display = sel.value === "__text__" ? "" : "none";
  const p = productById()[sel.value];
  if(p && line && !line.value && (p.line === "SC" || p.line === "PC")) line.value = p.line; // 품목의 라인으로 과제 구분 채우기
}
// 저장할 품목 값
function iitProductCollect(){
  const v = (document.getElementById("iit-productId") || {}).value || "";
  if(v === "__text__") return { productId: null, product: (document.getElementById("iit-product").value || "").trim() };
  const p = productById()[v];
  return p ? { productId: p.id, product: p.name } : { productId: null, product: "" };
}
function iitKolHint(){
  const el = document.getElementById("iit-kol-hint"), nameEl = document.getElementById("iit-investigator"), siteEl = document.getElementById("iit-site");
  if(!el || !nameEl || !siteEl) return;
  const name = nameEl.value.trim();
  if(!kol.rows || !lkNorm(name)){ el.innerHTML = ""; return; }
  const same = kol.rows.filter(p => lkNorm(p.name) === lkNorm(name)), m = lkKolMatch(name, siteEl.value);
  if(m && !siteEl.value.trim() && m.hospital) siteEl.value = lkHospShort(m.hospital);
  el.innerHTML = m ? '<span style="color:#1F5C8C;">KOL 명단에 있는 연구자예요 · ' + esc([lkKolCatName(m), m.hospital].filter(Boolean).join(" · ")) + '</span>'
    : same.length > 1 ? '<span style="color:#B45309;">같은 이름의 KOL이 ' + same.length + '명 있어요 (' + esc(same.map(p => lkHospShort(p.hospital) || "소속 미상").join(", ")) + ') — 기관명을 입력하면 맞는 사람으로 연결돼요</span>'
    : '<span style="color:#94A3B8;">KOL 명단에 없는 연구자예요</span>';
}
// KOL 표시 (명단을 아직 안 불러왔으면 불러온 뒤 채운다)
let lkBadgeSeq = 0;
function lkKolBadgeLater(name, site, kolId){
  if(kol.rows) return lkKolBadgeHtml(lkKolMatch(name, site, kolId));
  const id = "lk-kb-" + (++lkBadgeSeq);
  lkNeed("kol").then(() => { const el = document.getElementById(id); if(el) el.innerHTML = lkKolBadgeHtml(lkKolMatch(name, site, kolId)); });
  return '<span id="' + id + '"></span>';
}
// KOL 상세에 보일 'IIT 과제'
function lkKolIitHtml(p){
  if(!iit.rows){ lkNeed("iit").then(() => { if(state.tab === "kol" && iit.rows) kolRenderList(); }); return ''; }
  const list = lkKolIitRows(p);
  if(!list.length) return '';
  return '<div class="kol-detail-row"><div class="field-label">IIT 과제</div><div>' + list.map(r =>
    '<a class="view-ok" style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation();iitDetailOpen(\'' + r.key + '\')">' + esc(r.taskName) + '</a> ' +
    '<span style="color:#94A3B8;">' + esc([r.status || r.assignStatus, r.site].filter(Boolean).join(" · ")) + '</span>').join('<br/>') + '</div></div>';
}
