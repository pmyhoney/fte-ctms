// Offer a generated file to the viewer as a regular browser download.
async function saveFileToViewer(filename, data, mime){
  const blob = (typeof Blob !== "undefined" && data instanceof Blob) ? data : new Blob([data], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/* ---------------- constants & helpers ---------------- */
const STORAGE_KEY = "fte-tracker-v3";
const LAST_BACKUP_KEY = "fte-tracker-last-backup";
const LINE_META = {
  SC: { label: "SC (혈액제제·희귀질환)", color: "#7C5CBF" },
  PC: { label: "PC (심혈관·내분비·백신 등)", color: "#C87137" },
  MSL: { label: "MSL 활동", color: "#3E6FB0" },
  ETC: { label: "기타", color: "#6B7280" },
};
const LINE_ORDER = ["SC", "PC", "MSL", "ETC"];
const PRODUCT_LINE_ORDER = ["SC", "PC", "ETC"];
const STATUS_META = {
  "준비중": { color: "#B45309", soft: "#FEF3E2" },
  "진행중": { color: "#1F6F78", soft: "#E5F1F1" },
  "보류": { color: "#C2410C", soft: "#FDECE3" },
  "중단": { color: "#B91C1C", soft: "#FDECEC" },
  "종료": { color: "#64748B", soft: "#EEF2F6" },
};
const STATUS_ORDER = ["준비중", "진행중", "종료", "보류", "중단"];
const DEFAULT_TASK_TYPES = [
  { id: "tt-1", name: "시판 후 임상시험 (PMCT)", fte: 0.3, line: "SC" },
  { id: "tt-2", name: "시판 후 조사 (NIS)", fte: 0.2, line: "PC" },
  { id: "tt-3", name: "연구자주도임상시험 (IIT)", fte: 0.15, line: "SC" },
  { id: "tt-4", name: "생동성시험 (BE)", fte: 0.25, line: "PC" },
  { id: "tt-5", name: "MSL 활동", fte: 0.2, line: "MSL" },
];

function uid(prefix){ return prefix + "-" + Date.now() + "-" + Math.floor(Math.random()*10000); }
function fmt(n){ return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }
function isOverCapacity(total){
  // 1.00은 정상, 1.01부터 초과로 판정 (부동소수점 오차 방지를 위해 반올림 후 비교)
  return Math.round((total + Number.EPSILON) * 100) / 100 >= 1.01;
}
function currentPeriod(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
}
function periodLabel(p){
  if(!p) return "";
  const [y,m] = p.split("-");
  return y + "년 " + Number(m) + "월";
}
function periodPlus(period, delta){
  const [y,m] = period.split("-").map(Number);
  const d = new Date(y, m-1+delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
}
function isActive(a, period){
  if(!a.startPeriod) return true;
  if(a.startPeriod > period) return false;
  if(a.endPeriod && a.endPeriod < period) return false;
  return true;
}
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- modal (custom — native confirm/alert/prompt are unreliable inside sandboxed artifact iframes) ---------------- */
function showModal(bodyHtml){
  closeModal();
  const overlay = document.createElement("div");
  overlay.id = "modal-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-card">' + bodyHtml + '</div>';
  overlay.addEventListener("click", (e) => { if(e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
}
function closeModal(){
  const el = document.getElementById("modal-overlay");
  if(el) el.remove();
}

/* ---------------- role (admin = editable, viewer = read-only) — set from the Supabase profile in auth.js ---------------- */
async function enterAsAdmin(){
  state.role = "admin";
  state.ctmsAuth = null;
  document.body.classList.remove("role-viewer");
  markActivity();
  loadAppData();
}
async function enterAsViewer(){
  state.role = "viewer";
  state.ctmsAuth = null;
  document.body.classList.add("role-viewer");
  markActivity();
  loadAppData();
}

/* ---------------- icons ---------------- */
function icon(name, size){
  size = size || 14;
  const common = 'width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/>',
    alert: '<path d="M12 2 L2 20 H22 Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16.7" r="0.6" fill="currentColor"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="10" x2="21" y2="10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    upload: '<path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><path d="M5 21h14"/>',
    box: '<path d="M21 8.5L12 4 3 8.5l9 4.5 9-4.5z"/><path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-9 9c-2.52 0-4.93-1-6.74-2.74L3 16"/><path d="M3 12a9 9 0 0 1 9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="3 22 3 16 9 16"/><polyline points="21 2 21 8 15 8"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  };
  return '<svg '+common+'>'+(paths[name]||'')+'</svg>';
}

/* ---------------- state ---------------- */
let state = {
  tab: "dashboard",
  role: null, // "admin" | "viewer"
  taskTypes: [],
  members: [],
  products: [],
  assignments: [],
  loaded: false,
  saveError: false,
  dash: { basis: currentPeriod(), lineFilter: "전체", productFilter: "전체", typeSubtotalOpen: false, productSubtotalOpen: false },
  statusBasis: currentPeriod(),
  monthly: { year: new Date().getFullYear(), mode: "month" },
  lastSaved: null,
  dirty: false,
  expandedOverrides: {},
  expandedPeriodEdit: {},
  search: { products: "", types: "", assignSort: "recent", assignMemberFilter: "전체", assignProductFilter: "전체", assignTypeFilter: "전체" },
  ctms: {}, // gid(groupId||assignment id) -> CTMS 진행 기록
  ctmsAuth: null,      // CTMS 탭 로그인 상태(메모리에만 유지): {mode:'owner'|'admin'|'viewall', ownerId}
  ctmsTouched: {},     // 담당자 로그인으로 수정한 과제(gid) — 저장 대기
  ctmsExcluded: {},    // CTMS 목록에서 삭제(제외)한 과제 gid — 배정(FTE) 데이터는 그대로
  ctmsIssues: {}, // gid -> 진행상황/이슈 기록
  ctmsCost: {},   // gid -> 비용(계획/집행) 기록
  ctmsUi: { sub: "tracker", view: "all", member: "전체", scope: "all", open: {}, issueView: "all", issueOpen: {}, costView: "all", costOpen: {}, costYear: new Date().getFullYear() },
  activityLog: [],
  lastAction: null,
  lastBackupMeta: null,
  saveBlocked: false,
  saveBlockReason: null,
  forceNextSave: false, // when true, the next saveNow() skips the regressive-save pre-check once
};
let saveTimer = null;
function isAdmin(){ return state.role === "admin"; }

function taskTypeById(){
  const map = {};
  state.taskTypes.forEach(t => map[t.id] = t);
  return map;
}
function productById(){
  const map = {};
  state.products.forEach(p => map[p.id] = p);
  return map;
}
function overrideFte(raw){
  if(raw && typeof raw === "object") return raw.fte;
  return raw;
}
function overrideNote(raw){
  if(raw && typeof raw === "object") return raw.note || "";
  return "";
}
function fteForPeriod(a, period){
  if(a.overrides && Object.prototype.hasOwnProperty.call(a.overrides, period)){
    const v = overrideFte(a.overrides[period]);
    if(typeof v === "number" && v >= 0) return v;
  }
  return a.fte;
}
// 팀장(members[].leader)은 과제 배정 대상이 아니므로 FTE 화면(배정 현황·과제 배정·과제 진행 현황·월별/분기별)과 FTE 엑셀에서 뺀다
function isLeaderMember(id){ const m = state.members.find(x => x.id === id); return !!(m && m.leader); }
function fteMembers(){ return state.members.filter(m => !m.leader); }
function fteAssignments(){ return state.assignments.filter(a => !isLeaderMember(a.memberId)); }
function memberFteAt(memberId, period, lineFilter, productFilter){
  const map = taskTypeById();
  return state.assignments
    .filter(a => a.memberId === memberId && isActive(a, period))
    .filter(a => {
      if(!lineFilter || lineFilter === "전체") return true;
      const t = map[a.taskTypeId];
      return t && t.line === lineFilter;
    })
    .filter(a => {
      if(!productFilter || productFilter === "전체") return true;
      if(productFilter === "__none__") return !a.productId;
      return a.productId === productFilter;
    })
    .reduce((sum,a) => sum + fteForPeriod(a, period), 0);
}

/* ---------------- activity log & undo ---------------- */
function logActivity(msg){
  if(!state.activityLog) state.activityLog = [];
  state.activityLog.unshift({ ts: new Date().toISOString(), msg });
  if(state.activityLog.length > 50) state.activityLog.length = 50;
}
function activityTimeLabel(ts){
  const d = new Date(ts);
  return String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")+" "+
    String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
function showActivityLog(){
  const log = state.activityLog || [];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">최근 변경 이력</div>' +
    '<div style="max-height:360px;overflow-y:auto;">' +
    (log.length === 0 ? '<div style="font-size:12.5px;color:#94A3B8;">아직 기록된 변경 이력이 없어요.</div>' :
      log.map(e =>
        '<div style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:12.5px;display:flex;gap:8px;">' +
          '<span style="color:#94A3B8;white-space:nowrap;">'+activityTimeLabel(e.ts)+'</span>' +
          '<span style="color:#334155;">'+esc(e.msg)+'</span>' +
        '</div>'
      ).join("")
    ) +
    '</div>' +
    '<button class="add-btn" style="width:100%;justify-content:center;margin-top:14px;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>'
  );
}
function showToast(label, opts){
  opts = opts || {};
  removeUndoToast();
  const el = document.createElement("div");
  el.id = "undo-toast";
  el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:"+(opts.error?"#B91C1C":"#17232E")+";" +
    "color:#fff;padding:10px 16px;border-radius:10px;font-size:12.5px;display:flex;align-items:center;" +
    "gap:14px;box-shadow:0 12px 32px rgba(0,0,0,0.28);z-index:1100;max-width:90vw;";
  el.innerHTML = '<span>'+esc(label)+'</span>' +
    (opts.actionLabel ?
      '<button style="background:none;border:none;color:#7FD8DD;font-weight:700;font-size:12.5px;white-space:nowrap;" onclick="'+opts.actionOnclick+'">'+opts.actionLabel+'</button>' : '');
  document.body.appendChild(el);
  window.undoToastTimer = setTimeout(removeUndoToast, opts.duration || 4000);
}
function showUndoToast(label){
  showToast(label, { actionLabel: "실행 취소", actionOnclick: "undoLastAction()", duration: 8000 });
}
function removeUndoToast(){
  const el = document.getElementById("undo-toast");
  if(el) el.remove();
  if(window.undoToastTimer){ clearTimeout(window.undoToastTimer); window.undoToastTimer = null; }
}
function undoLastAction(){
  if(!state.lastAction) return;
  const undoGid = state.lastAction.gid;
  state.lastAction.restore();
  logActivity(state.lastAction.undoMsg || "변경 사항을 되돌렸어요");
  state.lastAction = null;
  removeUndoToast();
  if(isAdmin()) scheduleSave(); else if(undoGid) ctmsPersist(undoGid); // 담당자 로그인: 해당 과제의 CTMS 기록만 저장
  renderApp();
}

function scheduleSave(){
  if(!isAdmin()) return; // viewers never write shared data
  if(state.saveBlocked) return; // don't persist until the admin confirms there's no existing cloud data
  state.dirty = true;
  renderHeader();
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function describeStorageError(e){
  const code = e && e.code;
  if(code === "42501"){
    return "저장 권한이 없어요. 관리자 계정으로 로그인했는지 확인해 주세요.";
  }
  if(code === "P0001"){
    return e.message; // save_ctms가 돌려준 안내 문구 (예: 본인 담당 과제가 아니에요)
  }
  if(code === "PGRST301" || code === "PGRST303"){
    return "로그인이 만료됐어요. 새로고침한 뒤 다시 로그인해 주세요.";
  }
  return null;
}
async function saveNow(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if(!isAdmin()){ if(Object.keys(state.ctmsTouched).length > 0) await ctmsOwnerSaveNow(); return; } // 담당자 로그인: 저장 대기분만
  // If the admin just confirmed "이 상태로 저장 시작" after a regressive block, honor that
  // decision for this one save instead of immediately re-blocking on the same comparison
  // (the cloud copy hasn't changed yet, so the check would otherwise re-trigger forever).
  const skipRegressiveCheck = state.forceNextSave;
  state.forceNextSave = false;
  try{
    // Guard against overwriting the cloud copy with a locally stale/incomplete snapshot.
    // If what we're about to write looks meaningfully smaller than what's already saved
    // (fewer 품목 분류, fewer assignments/공동배정, fewer members) treat it as a sign our
    // local state didn't load correctly, and refuse to save instead of destroying real data.
    // Tolerance is +2 (not +1) so a normal multi-item cleanup (e.g. deleting 2 duplicate
    // assignments back-to-back before the 250ms debounce fires) doesn't get falsely flagged.
    try{
      if(!skipRegressiveCheck){
        const currentCloud = await window.storage.get(STORAGE_KEY, true);
        if(currentCloud && currentCloud.value){
          const cloudParsed = JSON.parse(currentCloud.value);
          const cloudClassified = Array.isArray(cloudParsed.products) ? cloudParsed.products.filter(p => p.line).length : 0;
          const localClassified = state.products.filter(p => p.line).length;
          const cloudAssignCount = Array.isArray(cloudParsed.assignments) ? cloudParsed.assignments.length : 0;
          const localAssignCount = state.assignments.length;
          const cloudMemberCount = Array.isArray(cloudParsed.members) ? cloudParsed.members.length : 0;
          const localMemberCount = state.members.length;
          const cloudCtmsCount = cloudParsed.ctms && typeof cloudParsed.ctms === "object" ? Object.keys(cloudParsed.ctms).length : 0;
          const localCtmsCount = Object.keys(state.ctms || {}).length;
          const countEntries = (o) => o && typeof o === "object" ? Object.keys(o).reduce((n, k) => n + (Array.isArray(o[k]) ? o[k].length : 0), 0) : 0;
          const cloudExtCount = countEntries(cloudParsed.ctmsIssues) + countEntries(cloudParsed.ctmsCost);
          const localExtCount = countEntries(state.ctmsIssues) + countEntries(state.ctmsCost);
          const looksRegressive =
            cloudExtCount > localExtCount + 5 ||
            cloudCtmsCount > localCtmsCount + 2 ||
            cloudClassified > localClassified + 2 ||
            cloudAssignCount > localAssignCount + 2 ||
            cloudMemberCount > localMemberCount + 2;
          if(looksRegressive){
            state.saveError = false;
            state.saveBlocked = true;
            state.saveBlockReason = "regressive";
            state.dirty = false;
            renderHeader();
            renderLoadWarning();
            return; // abort — surface the warning banner instead of overwriting
          }
        }
      }
    }catch(e){ /* pre-check failed (e.g. offline) — fall through and attempt the save anyway */ }

    const result = await window.storage.set(STORAGE_KEY, JSON.stringify({
      taskTypes: state.taskTypes, members: state.members, products: state.products, assignments: state.assignments,
      ctms: state.ctms, ctmsIssues: state.ctmsIssues, ctmsCost: state.ctmsCost, ctmsExcluded: state.ctmsExcluded,
      activityLog: state.activityLog,
      savedAt: new Date().toISOString()
    }), true); // shared: visible to everyone who opens this artifact
    state.saveError = !result;
    if(result){ state.lastSaved = new Date(); state.dirty = false; state.saveErrorReason = null; }
  }catch(e){
    state.saveError = true;
    state.saveErrorReason = describeStorageError(e);
  }
  renderHeader();
  if(state.saveError && !window.saveRetryTimer){
    window.saveRetryTimer = setTimeout(() => {
      window.saveRetryTimer = null;
      if(state.saveError) saveNow();
    }, 4000);
  }
}

// try to flush any pending save if the tab is closing or losing focus
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "hidden" && state.dirty) saveNow();
});
window.addEventListener("blur", () => {
  if(state.dirty) saveNow();
});
window.addEventListener("beforeunload", (e) => {
  if(state.dirty){
    saveNow();
    e.preventDefault();
    e.returnValue = "";
  }
});
// 10분 이상 조작이 없으면 관리자/회원 모두 로그아웃하고 로그인 화면으로 돌려보낸다.
// (로그인 상태는 sessionStorage에만 두므로 새 창/새 탭으로 열면 항상 로그인 화면부터 시작한다 — config.js)
const IDLE_LIMIT_MS = 10 * 60 * 1000;
let lastActivityTs = Date.now();
function markActivity(){ lastActivityTs = Date.now(); }
["mousedown","mousemove","keydown","touchstart","wheel"].forEach(evt => {
  window.addEventListener(evt, markActivity, { passive: true });
});
setInterval(async () => {
  if(!state.role) return;
  if(Date.now() - lastActivityTs < IDLE_LIMIT_MS) return;
  await logout("10분 이상 조작이 없어 자동으로 로그아웃됐어요."); // auth.js — 저장 대기분을 먼저 저장한다
}, 30 * 1000);
// Enter key commits the current input/select (fires 'change') instead of doing nothing,
// since these inputs live outside a <form> and Chrome won't fire change/blur on Enter by itself.
document.addEventListener("keydown", (e) => {
  if(e.key !== "Enter") return;
  const el = e.target;
  if(!el || !el.tagName) return;
  if(el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
  // Some inputs (search boxes, quick-add fields) already handle Enter themselves via their
  // own onkeydown, and that handler can re-render the tab synchronously — which removes this
  // very element from the DOM before we get here. Blurring an already-detached element tries
  // to shift focus with nowhere valid to land, which inside this artifact's sandboxed iframe
  // surfaces as a spurious console message. Skip it once the element is no longer attached.
  if(!document.body.contains(el)) return;
  el.blur();
});

function normalizeAssignments(){
  state.assignments.forEach(a => {
    if(!a.status || !STATUS_META[a.status]) a.status = "준비중";
    if(!a.overrides || typeof a.overrides !== "object") a.overrides = {};
  });
}

async function loadAppData(){
  let gotCloudData = false; // true only if the authoritative *shared* read actually returned data
  try{
    let sharedRes;
    try{
      sharedRes = await window.storage.get(STORAGE_KEY, true); // shared data, visible to all viewers/admins
    }catch(e){
      sharedRes = null; // key may not exist yet, or the read genuinely failed — can't tell apart here
    }
    let res = sharedRes;
    if((!res || !res.value) && isAdmin()){
      // If shared storage came back empty, check for older personal (pre-sharing) data so we
      // can show it instead of a blank/stale bundled snapshot — but do NOT write it back to
      // shared storage automatically. A transient read failure would otherwise silently
      // overwrite real, up-to-date shared data (e.g. 품목 SC/PC 분류) with an old personal
      // copy. Persisting is left to the saveBlocked confirmation flow below.
      try{
        const personalRes = await window.storage.get(STORAGE_KEY, false);
        if(personalRes && personalRes.value){
          res = personalRes;
        }
      }catch(e){ /* no personal data to show */ }
    }
    if(res && res.value){
      const parsed = JSON.parse(res.value);
      if(parsed.taskTypes) state.taskTypes = parsed.taskTypes;
      if(parsed.members) state.members = parsed.members;
      if(parsed.products) state.products = parsed.products;
      if(parsed.assignments) state.assignments = parsed.assignments;
      if(Array.isArray(parsed.activityLog)) state.activityLog = parsed.activityLog;
      if(parsed.ctms && typeof parsed.ctms === "object" && !Array.isArray(parsed.ctms)) state.ctms = parsed.ctms;
      if(parsed.ctmsIssues && typeof parsed.ctmsIssues === "object" && !Array.isArray(parsed.ctmsIssues)) state.ctmsIssues = parsed.ctmsIssues;
      if(parsed.ctmsCost && typeof parsed.ctmsCost === "object" && !Array.isArray(parsed.ctmsCost)) state.ctmsCost = parsed.ctmsCost;
      if(parsed.ctmsExcluded && typeof parsed.ctmsExcluded === "object" && !Array.isArray(parsed.ctmsExcluded)) state.ctmsExcluded = parsed.ctmsExcluded;
    }
    gotCloudData = !!(sharedRes && sharedRes.value); // only the real shared read counts as "confirmed"
  }catch(e){ /* handled via gotCloudData below */ }
  try{
    const backupRes = await window.storage.get(LAST_BACKUP_KEY, false); // personal, per-browser
    if(backupRes && backupRes.value) state.lastBackupMeta = JSON.parse(backupRes.value);
  }catch(e){ /* no backup record yet */ }
  normalizeAssignments();
  state.loaded = true;
  // Safety net: this file ships with a real data snapshot baked in as a starting point, so the
  // artifact isn't blank on first paint. If shared cloud storage came back empty, we genuinely
  // can't tell whether this is a brand-new artifact or a failed read of real existing data — so
  // block auto-save until the admin explicitly confirms, instead of silently overwriting the
  // cloud copy with this bundled snapshot (which, for example, would wipe out 품목 SC/PC 분류
  // set after this file was created).
  state.saveBlocked = !gotCloudData;
  state.saveBlockReason = gotCloudData ? null : "no-cloud-data";
  renderApp();
}
function retryLoadData(){
  state.loaded = false;
  state.saveBlocked = false;
  renderApp();
  loadAppData();
}
function confirmFreshStart(){
  state.saveBlocked = false;
  state.saveBlockReason = null;
  state.forceNextSave = true; // let the very next save through even if cloud still looks "larger"
  logActivity("클라우드에 기존 데이터가 없음을 확인하고 저장을 시작했어요");
  scheduleSave();
  renderApp();
}

/* ---------------- backup / restore (JSON file, independent of storage) ---------------- */
async function downloadBackup(){
  const payload = {
    taskTypes: state.taskTypes, members: state.members, products: state.products, assignments: state.assignments,
    ctms: state.ctms, ctmsIssues: state.ctmsIssues, ctmsCost: state.ctmsCost, ctmsExcluded: state.ctmsExcluded,
    exportedAt: new Date().toISOString()
  };
  const saved = await saveFileToViewer("FTE_백업_" + currentPeriod() + ".json", JSON.stringify(payload, null, 2), "application/json");
  if(!saved) return;
  state.lastBackupMeta = { ts: new Date().toISOString() };
  try{ await window.storage.set(LAST_BACKUP_KEY, JSON.stringify(state.lastBackupMeta), false); }catch(e){ /* best effort */ }
  renderHeader();
}

function triggerImport(){
  document.getElementById("backup-file-input").click();
}

let pendingImportData = null;
function handleImportFile(input){
  if(!isAdmin()) return;
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try{
      parsed = JSON.parse(reader.result);
    }catch(e){
      showModal(
        '<div style="font-weight:800;font-size:14px;margin-bottom:8px;color:var(--danger);">불러오기 실패</div>' +
        '<div style="font-size:13px;color:#475569;margin-bottom:18px;">백업 파일을 읽지 못했어요. 올바른 JSON 파일인지 확인해 주세요.</div>' +
        '<button class="primary-btn" onclick="closeModal()">확인</button>'
      );
      input.value = "";
      return;
    }
    const groupCount = (list) => {
      const groups = {};
      (list || []).forEach(a => { if(a.groupId) groups[a.groupId] = (groups[a.groupId]||0)+1; });
      return Object.keys(groups).filter(k => groups[k] > 1).length;
    };
    const counts = {
      taskTypes: Array.isArray(parsed.taskTypes) ? parsed.taskTypes.length : 0,
      members: Array.isArray(parsed.members) ? parsed.members.length : 0,
      products: Array.isArray(parsed.products) ? parsed.products.length : 0,
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments.length : 0,
      coAssignGroups: groupCount(parsed.assignments),
      ctms: parsed.ctms && typeof parsed.ctms === "object" ? Object.keys(parsed.ctms).length : null,
    };
    const currentCoAssignGroups = groupCount(state.assignments);
    const isRegressive = counts.assignments < state.assignments.length || counts.coAssignGroups < currentCoAssignGroups;
    pendingImportData = parsed;
    showModal(
      '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">백업 불러오기</div>' +
      '<div style="font-size:13px;color:#475569;margin-bottom:8px;">이 백업 파일을 불러오면 현재 화면의 데이터를 덮어씁니다.</div>' +
      '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;">과제유형 '+counts.taskTypes+'개 · 팀원 '+counts.members+'명 · 품목 '+counts.products+'개 · 배정 '+counts.assignments+'건 · 공동배정 '+counts.coAssignGroups+'건'+(counts.ctms === null ? ' · CTMS 정보 없음(현재 기록 유지)' : ' · CTMS '+counts.ctms+'건')+'</div>' +
      (isRegressive ?
        '<div style="font-size:12px;color:var(--danger);background:#FEF6F6;border:1px solid #F3B8B8;border-radius:8px;padding:8px 10px;margin-bottom:14px;line-height:1.5;">' +
          '⚠ 이 백업은 현재 화면(배정 '+state.assignments.length+'건 · 공동배정 '+currentCoAssignGroups+'건)보다 정보가 적어요. 오래된 백업이라면 최신 데이터가 사라질 수 있어요.' +
        '</div>' :
        '<div style="margin-bottom:14px;"></div>') +
      '<div style="display:flex;gap:8px;">' +
        '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="cancelImportBackup()">취소</button>' +
        '<button class="add-btn" style="flex:1;justify-content:center;'+(isRegressive?'background:var(--danger);':'')+'" onclick="confirmImportBackup()">덮어쓰기</button>' +
      '</div>'
    );
    input.value = "";
  };
  reader.readAsText(file);
}
function cancelImportBackup(){
  pendingImportData = null;
  closeModal();
}
function confirmImportBackup(){
  const parsed = pendingImportData;
  if(parsed){
    if(Array.isArray(parsed.taskTypes)) state.taskTypes = parsed.taskTypes;
    if(Array.isArray(parsed.members)) state.members = parsed.members;
    if(Array.isArray(parsed.products)) state.products = parsed.products;
    if(Array.isArray(parsed.assignments)) state.assignments = parsed.assignments;
    // CTMS 탭이 생기기 전 백업에는 ctms 항목이 없으므로, 그런 파일은 기존 CTMS 기록을 지우지 않는다.
    if(parsed.ctms && typeof parsed.ctms === "object" && !Array.isArray(parsed.ctms)) state.ctms = parsed.ctms;
    if(parsed.ctmsIssues && typeof parsed.ctmsIssues === "object" && !Array.isArray(parsed.ctmsIssues)) state.ctmsIssues = parsed.ctmsIssues;
    if(parsed.ctmsCost && typeof parsed.ctmsCost === "object" && !Array.isArray(parsed.ctmsCost)) state.ctmsCost = parsed.ctmsCost;
    if(parsed.ctmsExcluded && typeof parsed.ctmsExcluded === "object" && !Array.isArray(parsed.ctmsExcluded)) state.ctmsExcluded = parsed.ctmsExcluded;
    normalizeAssignments();
    logActivity('백업 파일에서 데이터를 불러와 덮어썼어요');
    scheduleSave();
    renderApp();
  }
  pendingImportData = null;
  closeModal();
}

/* ---------------- excel export ---------------- */
// 엑셀 내보내기: 어떤 탭의 정보를 담을지 고르는 팝업 → 고른 탭마다 시트를 만든다
const EXPORT_SECTIONS = [
  { key: "fte", label: "FTE 관리" },
  { key: "ctms", label: "CTMS" },
  { key: "wfh", label: "재택", writerOnly: true }, // 뷰어는 재택 기록이 없으므로 숨김 (탭과 같은 기준)
  { key: "weekly", label: "주간보고" },
  { key: "training", label: "교육" },
];
function exportSections(){ return EXPORT_SECTIONS.filter(s => !s.writerOnly || canWrite()); }

function exportExcelOpen(){
  const box = (key, label, bold) =>
    '<label style="display:flex;align-items:center;gap:8px;padding:9px 4px;font-size:13.5px;cursor:pointer;' + (bold ? 'font-weight:800;border-bottom:1px solid var(--border);margin-bottom:4px;' : '') + '">' +
      '<input type="checkbox" id="xp-' + key + '" checked onchange="exportExcelSync(\'' + key + '\')"/> ' + label + '</label>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">엑셀 내보내기</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:10px;line-height:1.5;">내보낼 정보를 골라 주세요. 고른 항목마다 시트가 만들어져요.</div>' +
    box("all", "전체", true) +
    exportSections().map(s => box(s.key, s.label)).join("") +
    '<div style="font-size:11.5px;color:#94A3B8;margin-top:8px;line-height:1.5;">재택·주간보고·교육은 기간 구분 없이 내가 볼 수 있는 기록 전체를 담아요.</div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="xp-go" style="flex:1;justify-content:center;" onclick="exportExcelRun()">' + icon('download', 13) + ' 내보내기</button>' +
    '</div>'
  );
}
// '전체'를 누르면 모두 켜고/끄고, 항목을 바꾸면 '전체' 표시를 맞춘다
function exportExcelSync(key){
  const keys = exportSections().map(s => s.key);
  if(key === "all"){
    const on = document.getElementById("xp-all").checked;
    keys.forEach(k => document.getElementById("xp-" + k).checked = on);
  }else{
    document.getElementById("xp-all").checked = keys.every(k => document.getElementById("xp-" + k).checked);
  }
}
async function exportExcelRun(){
  const picked = exportSections().filter(s => document.getElementById("xp-" + s.key).checked);
  if(picked.length === 0){ showToast("내보낼 항목을 하나 이상 골라 주세요", { error: true }); return; }
  const btn = document.getElementById("xp-go");
  if(btn){ btn.disabled = true; btn.textContent = "만드는 중…"; }
  try{
    await exportExcel(picked.map(s => s.key));
    closeModal();
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = "내보내기"; }
    showToast("엑셀을 만들지 못했어요: " + (e && e.message ? e.message : e), { error: true });
  }
}

async function exportExcel(keys){
  const wb = XLSX.utils.book_new();
  if(keys.includes("fte")) fteExportSheets(wb);
  if(keys.includes("ctms")) ctmsExportSheets(wb);
  await worklogExportSheets(wb, keys); // worklog.js — 재택·주간보고·교육 (Supabase에서 불러옴)
  const all = exportSections().every(s => keys.includes(s.key));
  const label = all ? "전체" : EXPORT_SECTIONS.filter(s => keys.includes(s.key)).map(s => s.label.replace(/\s/g, "")).join("_");
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("업무관리_" + label + "_" + todayYmd() + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// 고른 항목에 기록이 하나도 없어도 시트는 만들어, 빠진 게 아니라 비어 있다는 걸 알 수 있게 한다
function appendSheetOrEmpty(wb, rows, name){
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ "안내": "기록이 없어요" }]), name);
}

function ctmsExportSheets(wb){
  appendSheetOrEmpty(wb, ctmsExportRows(), "CTMS 진행");
  ctmsExtExportSheets(wb);
}

function fteExportSheets(wb){
  const map = taskTypeById();
  const pmap = productById();

  const rows1 = fteAssignments().map(a => {
    const t = map[a.taskTypeId];
    const p = pmap[a.productId];
    const m = state.members.find(x => x.id === a.memberId);
    const coNames = a.groupId
      ? fteAssignments().filter(x => x.groupId === a.groupId && x.id !== a.id)
          .map(x => { const cm = state.members.find(y => y.id === x.memberId); return cm ? cm.name : "삭제된 팀원"; })
      : [];
    return {
      "과제명": a.taskName,
      "품목": p ? p.name : "",
      "과제유형": t ? t.name : "삭제된 유형",
      "라인": t ? LINE_META[t.line].label : "",
      "담당자": m ? m.name : "삭제된 팀원",
      "공동 담당자": coNames.join(", "),
      "FTE": a.fte,
      "시작월": a.startPeriod || "",
      "종료월": a.endPeriod || "진행중",
      "과제상태": a.status || "준비중",
      "기간 변경 사유": a.periodNote || "",
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows1), "배정목록");

  const overrideRows = [];
  fteAssignments().forEach(a => {
    const t = map[a.taskTypeId];
    const m = state.members.find(x => x.id === a.memberId);
    Object.keys(a.overrides || {}).sort().forEach(period => {
      overrideRows.push({
        "과제명": a.taskName,
        "담당자": m ? m.name : "삭제된 팀원",
        "과제유형": t ? t.name : "삭제된 유형",
        "월": periodLabel(period),
        "조정 FTE": overrideFte(a.overrides[period]),
        "기본 FTE": a.fte,
        "사유": overrideNote(a.overrides[period]),
      });
    });
  });
  if(overrideRows.length > 0){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overrideRows), "월별 FTE 조정");
  }

  const basis = currentPeriod();
  const rows2 = fteMembers().map(m => {
    const sc = memberFteAt(m.id, basis, "SC");
    const pc = memberFteAt(m.id, basis, "PC");
    const msl = memberFteAt(m.id, basis, "MSL");
    const row = { "팀원": m.name };
    row["SC ("+basis+" 기준)"] = Number(fmt(sc));
    row["PC ("+basis+" 기준)"] = Number(fmt(pc));
    row["MSL ("+basis+" 기준)"] = Number(fmt(msl));
    row["합계"] = Number(fmt(sc+pc+msl));
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows2), "팀원별 라인 소계");

  const year = new Date().getFullYear();
  for(let offset = 0; offset < 3; offset++){
    const y = year + offset;
    const months = Array.from({length:12}, (_,i) => y+"-"+String(i+1).padStart(2,"0"));
    const rows = fteMembers().map(m => {
      const row = { "팀원": m.name };
      months.forEach(p => { row[periodLabel(p)] = Number(fmt(memberFteAt(m.id, p))); });
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), y+"년 월별 현황");
  }

  const rows4 = fteMembers().map(m => {
    const row = { "팀원": m.name };
    for(let offset = 0; offset < 3; offset++){
      const y = year + offset;
      const months = Array.from({length:12}, (_,i) => y+"-"+String(i+1).padStart(2,"0"));
      const avg = months.reduce((s,p) => s + memberFteAt(m.id, p), 0) / 12;
      row[y+"년 연평균"] = Number(fmt(avg));
    }
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows4), "3개년 연평균");
}

/* ---------------- render: shell ---------------- */
function renderApp(){
  const app = document.getElementById("app");
  if(!state.loaded){
    app.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    return;
  }
  document.body.classList.toggle("save-blocked", !!(state.saveBlocked && isAdmin()));
  app.innerHTML =
    '<div id="header"></div>' +
    '<div id="loadwarning"></div>' +
    '<div class="wrap">' +
      '<div id="tabbar"></div>' +
      '<div id="tabcontent"></div>' +
    '</div>';
  renderHeader();
  renderLoadWarning();
  renderTabBar();
  renderTabContent();
}
function renderLoadWarning(){
  const el = document.getElementById("loadwarning");
  document.body.classList.toggle("save-blocked", !!(state.saveBlocked && isAdmin()));
  if(!el) return;
  if(!state.saveBlocked || !isAdmin()){ el.innerHTML = ""; return; }
  const isRegressive = state.saveBlockReason === "regressive";
  el.innerHTML =
    '<div style="max-width:1100px;margin:0 auto;padding:0 20px;">' +
      '<div class="card" style="border-color:#F3B8B8;background:#FEF6F6;margin-top:14px;">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;color:var(--danger);">' +
          icon('alert',16) + '<span style="font-weight:800;font-size:13.5px;">' +
            (isRegressive ? '저장을 잠시 멈췄어요 — 클라우드에 더 많은 데이터가 있어요' : '클라우드에서 기존 데이터를 불러오지 못했어요') +
          '</span>' +
        '</div>' +
        '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:12px;">' +
          (isRegressive ?
            '지금 화면의 데이터(품목 분류, 팀원, 배정 건수 등)가 클라우드에 이미 저장된 것보다 적은 것 같아요. 이 화면이 오래된 상태를 보고 있을 수 있어서, 실수로 최신 데이터를 덮어쓰지 않도록 자동저장을 멈췄어요.<br/>' +
            '"다시 불러오기"로 최신 데이터를 가져오시거나, 정말 의도한 변경(대량 삭제 등)이라면 "이 상태로 저장 시작"을 눌러주세요.' :
            '지금 화면에 보이는 내용은 이 아티팩트에 담겨있던 예전 스냅샷일 수 있어요. 원래 저장돼 있던 최신 데이터(품목 분류 등 포함)를 덮어쓰지 않도록 자동저장을 잠시 멈춰뒀어요.<br/>' +
            '네트워크 문제였다면 "다시 불러오기"를 눌러주시고, 정말 처음 사용하는 경우라면 "이 상태로 저장 시작"을 눌러주세요.') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="add-btn" onclick="retryLoadData()">'+icon('download',13)+' 다시 불러오기</button>' +
          '<button class="add-btn" style="background:#fff;color:#475569;border:1px solid var(--border);" onclick="confirmFreshStart()">이 상태로 저장 시작</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function manualSave(){
  if(!isAdmin()) return;
  saveNow().then(() => {
    showToast(state.saveError ? (state.saveErrorReason || "저장 실패 — 다시 시도해 주세요") : "저장했어요", { error: state.saveError });
  });
}
function refreshPage(){
  location.reload();
}

function renderHeader(){
  const el = document.getElementById("header");
  if(!el) return;
  let statusHtml = "";
  if(state.saveError){
    statusHtml = '<div class="save-err" title="'+esc(state.saveErrorReason||'')+'">'+icon('alert',13)+' '+(state.saveErrorReason ? esc(state.saveErrorReason) : '저장 실패 — 백업 다운로드로 데이터를 보관해 주세요')+'</div>';
  }else if(state.dirty){
    statusHtml = '<div class="save-status">저장 중…</div>';
  }else if(state.lastSaved){
    const hh = String(state.lastSaved.getHours()).padStart(2,"0");
    const mm = String(state.lastSaved.getMinutes()).padStart(2,"0");
    statusHtml = '<div class="save-status">'+hh+':'+mm+' 자동 저장됨</div>';
  }
  let backupNoteHtml = "";
  if(state.lastBackupMeta && state.lastBackupMeta.ts){
    const d = new Date(state.lastBackupMeta.ts);
    const label = String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")+" "+
      String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    const changesSince = (state.activityLog||[]).filter(e => e.ts > state.lastBackupMeta.ts).length;
    backupNoteHtml = '<div class="save-status"'+(changesSince>0?' style="color:#B45309;"':'')+'>마지막 백업 '+label+
      (changesSince>0 ? ' · 이후 '+changesSince+'건 변경' : '') + '</div>';
  }else{
    backupNoteHtml = '<div class="save-status" style="color:#B45309;">백업 다운로드 기록 없음</div>';
  }
  const roleBadge = '<div style="display:flex;align-items:center;gap:6px;">' +
    '<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;' +
      (isAdmin() ? 'background:#E5F1F1;color:var(--accent);' : 'background:#F1F5F9;color:#64748B;') + '">' +
      (isAdmin() ? '관리자' : roleLabel(currentProfile && currentProfile.role)) +
    '</span>' +
    '<span style="font-size:12px;font-weight:700;color:#475569;">' + esc(currentProfile ? currentProfile.name || currentProfile.login_id : '') + '</span>' +
    '<button onclick="logout()" style="font-size:11px;color:#94A3B8;background:none;border:none;text-decoration:underline;">로그아웃</button>' +
    '<button onclick="showChangePasswordModal()" style="font-size:11px;color:#94A3B8;background:none;border:none;text-decoration:underline;">비밀번호 변경</button>' +
  '</div>';
  el.outerHTML =
    '<div class="header" id="header"><div class="header-inner">' +
      '<div><div class="eyebrow">MEDICAL AFFAIRS</div><h1>임상의학팀 업무 관리</h1></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        roleBadge +
        statusHtml +
        backupNoteHtml +
        (isAdmin() ? '<button class="btn-export" onclick="manualSave()">'+icon('save',14)+' 저장</button>' : '') +
        '<button class="btn-export" onclick="refreshPage()">'+icon('refresh',14)+' 새로고침</button>' +
        '<button class="btn-export" onclick="showActivityLog()">'+icon('list',14)+' 변경 이력</button>' +
        (isAdmin() ? '<button class="btn-export" onclick="triggerImport()">'+icon('upload',14)+' 백업 불러오기</button>' : '') +
        '<button class="btn-export" onclick="downloadBackup()">'+icon('download',14)+' 백업 다운로드</button>' +
        '<button class="btn-export" onclick="exportExcelOpen()">'+icon('download',14)+' 엑셀 내보내기</button>' +
        '<input type="file" id="backup-file-input" accept="application/json" style="display:none;" onchange="handleImportFile(this)"/>' +
      '</div>' +
    '</div></div>';
}

function renderTabBar(){
  const items = [
    { id: "fte", label: "FTE 관리", icon: "dashboard" },
    { id: "ctms", label: "CTMS", icon: "clipboard" },
    { id: "wfh", label: "재택", icon: "calendar", writerOnly: true }, // 뷰어는 본인 재택 기록이 없으므로 숨김
    { id: "weekly", label: "주간보고", icon: "edit" },
    { id: "training", label: "교육", icon: "book" },
    { id: "members", label: "팀원 관리", icon: "users", adminOnly: true },
    { id: "types", label: "과제 유형", icon: "list", adminOnly: true },
    { id: "products", label: "품목 관리", icon: "box", adminOnly: true },
  ].filter(it => (!it.adminOnly || isAdmin()) && (!it.writerOnly || canWrite()));
  document.getElementById("tabbar").innerHTML =
    '<div class="tabbar">' +
    items.map(it =>
      '<button class="tab-btn '+((it.id === "fte" ? FTE_SUB_TABS.some(s => s.id === state.tab) : state.tab===it.id)?'active':'')+'" onclick="setTab(\''+it.id+'\')">' +
        icon(it.icon,14) + it.label +
      '</button>'
    ).join("") +
    '</div>';
}

const ADMIN_ONLY_TABS = ["members", "types", "products"];
// 'FTE 관리' 탭 아래의 하위 탭 — state.tab에는 하위 탭 id가 그대로 들어간다
const FTE_SUB_TABS = [
  { id: "dashboard", label: "배정 현황" },
  { id: "assign", label: "과제 배정" },
  { id: "status", label: "과제 진행 현황" },
  { id: "monthly", label: "월별·분기별" },
];
let lastFteSubTab = "dashboard";
function fteSubTabBar(){
  const btn = (it) => '<button class="view-ok" onclick="setTab(\'' + it.id + '\')" style="flex:1;padding:9px 6px;border-radius:8px;border:1px solid ' +
    (state.tab === it.id ? "var(--accent)" : "var(--border)") + ';background:' + (state.tab === it.id ? "var(--accent)" : "#fff") + ';color:' + (state.tab === it.id ? "#fff" : "#475569") + ';font-size:13px;font-weight:700;">' + it.label + '</button>';
  return '<div style="display:flex;gap:6px;margin-bottom:14px;">' + FTE_SUB_TABS.map(btn).join("") + '</div>';
}
function setTab(id){
  if(id === "fte") id = lastFteSubTab;
  if(ADMIN_ONLY_TABS.indexOf(id) >= 0 && !isAdmin()) id = "dashboard";
  if(FTE_SUB_TABS.some(s => s.id === id)) lastFteSubTab = id;
  state.tab = id; renderTabBar(); renderTabContent();
}

// Search inputs trigger a full renderTabContent() on every keystroke/Enter, which rebuilds
// the DOM node the person is typing into. Without this, focus (and cursor position) would be
// lost after every search, forcing a re-click into the box each time.
function renderTabContentPreserveFocus(){
  const active = document.activeElement;
  const id = active && active.id;
  const hasSelection = active && typeof active.selectionStart === "number";
  const selStart = hasSelection ? active.selectionStart : null;
  const selEnd = hasSelection ? active.selectionEnd : null;
  renderTabContent();
  if(!id) return;
  const el = document.getElementById(id);
  if(!el) return;
  el.focus();
  if(selStart !== null && el.setSelectionRange){
    try{ el.setSelectionRange(selStart, selEnd); }catch(e){ /* not a text-selectable input */ }
  }
}

function renderTabContent(){
  // 뷰어(또는 역할 전환 직후)에는 관리 탭이 없으므로, 그 탭에 머물러 있었다면 첫 화면으로 돌린다.
  if(ADMIN_ONLY_TABS.indexOf(state.tab) >= 0 && !isAdmin()){ state.tab = "dashboard"; renderTabBar(); }
  ctmsSyncEditMode();
  const el = document.getElementById("tabcontent");
  if(state.tab === "dashboard") el.innerHTML = renderDashboard();
  else if(state.tab === "assign") el.innerHTML = renderAssignTab();
  else if(state.tab === "monthly") el.innerHTML = renderMonthlyTab();
  else if(state.tab === "members") el.innerHTML = renderMembersTab();
  else if(state.tab === "types") el.innerHTML = renderTypesTab();
  else if(state.tab === "products") el.innerHTML = renderProductsTab();
  else if(state.tab === "status") el.innerHTML = renderStatusTab();
  else if(state.tab === "ctms") el.innerHTML = renderCtmsTab();
  else if(state.tab === "wfh") el.innerHTML = renderWfhTab(); // worklog.js
  else if(state.tab === "weekly") el.innerHTML = renderWeeklyTab(); // worklog.js
  else if(state.tab === "training") el.innerHTML = renderTrainingTab(); // worklog.js
  if(FTE_SUB_TABS.some(s => s.id === state.tab)) el.insertAdjacentHTML("afterbegin", fteSubTabBar());
  if(state.tab === "assign") wireAssignTab();
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(){
  if(fteMembers().length === 0){
    return '<div class="card"><div class="empty">아직 등록된 팀원이 없어요. \'팀원 관리\' 탭에서 먼저 팀원을 추가해 주세요.</div></div>';
  }
  const basis = state.dash.basis;
  const isCurrentBasisMonth = basis === currentPeriod();
  const lineFilter = state.dash.lineFilter;
  const productFilter = state.dash.productFilter;
  const map = taskTypeById();
  const pmap = productById();

  const subtotals = LINE_ORDER.map(line => ({
    line, total: fteMembers().reduce((s,m) => s + memberFteAt(m.id, basis, line), 0)
  }));
  const grandTotal = fteMembers().reduce((s,m) => s + memberFteAt(m.id, basis, lineFilter, productFilter), 0);
  const relevantProducts = lineFilter === "전체" ? state.products : state.products.filter(p => p.line === lineFilter);
  const productSubtotals = relevantProducts.map(p => ({
    product: p, total: fteMembers().reduce((s,m) => s + memberFteAt(m.id, basis, lineFilter, p.id), 0)
  }));
  const unassignedProductTotal = fteMembers().reduce((s,m) => s + memberFteAt(m.id, basis, lineFilter, "__none__"), 0);
  const typeSubtotals = state.taskTypes.map(t => ({
    type: t, total: fteMembers().reduce((s,m) => s + fteAssignments()
      .filter(a => a.memberId === m.id && a.taskTypeId === t.id && isActive(a, basis))
      .reduce((s2,a) => s2 + fteForPeriod(a, basis), 0), 0)
  })).filter(x => x.total > 0);
  const idleList = fteMembers()
    .map(m => ({ m, total: memberFteAt(m.id, basis) }))
    .map(x => Object.assign(x, { remain: 1.0 - x.total }))
    .sort((a,b) => b.remain - a.remain);

  const todayPeriod = currentPeriod();
  const overCapacityMembers = fteMembers().filter(m => isOverCapacity(memberFteAt(m.id, todayPeriod)));
  const soonEndBound = periodPlus(todayPeriod, 2);
  const endingSoonRaw = fteAssignments()
    .filter(a => a.endPeriod && a.status !== "종료" && a.status !== "중단" && a.endPeriod >= todayPeriod && a.endPeriod <= soonEndBound);
  const endingSoonMap = new Map();
  endingSoonRaw.forEach(a => {
    const key = a.groupId || a.id; // 공동 배정된 과제는 그룹당 한 번만 집계
    const existing = endingSoonMap.get(key);
    if(!existing || a.endPeriod < existing.endPeriod) endingSoonMap.set(key, a);
  });
  const endingSoon = Array.from(endingSoonMap.values()).sort((a,b) => a.endPeriod.localeCompare(b.endPeriod));
  const ctmsDelayedList = ctmsDelayedTasks();
  const ctmsOpenIssues = ctmsOpenIssueCount();

  let html = '<div class="stack">';

  if(overCapacityMembers.length > 0 || endingSoon.length > 0 || ctmsDelayedList.length > 0 || ctmsOpenIssues > 0){
    html += '<div class="card" style="border-color:#F3B8B8;background:#FEF6F6;">' +
      '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;color:var(--danger);">' +
        icon('alert',16) + '<span style="font-weight:800;font-size:14px;">확인이 필요해요</span>' +
      '</div>' +
      (overCapacityMembers.length > 0 ?
        '<div style="font-size:13px;color:#475569;margin-bottom:'+((endingSoon.length>0||ctmsDelayedList.length>0||ctmsOpenIssues>0)?'8px':'0')+';line-height:1.5;">' +
          periodLabel(todayPeriod)+' 기준 <b style="color:var(--danger);">'+overCapacityMembers.length+'명</b>이 1.01 FTE 이상으로 초과했어요 — ' +
          overCapacityMembers.map(m => esc(m.name)+' ('+fmt(memberFteAt(m.id, todayPeriod))+')').join(', ') +
        '</div>' : '') +
      (endingSoon.length > 0 ?
        '<div style="font-size:13px;color:#475569;line-height:1.5;margin-bottom:'+((ctmsDelayedList.length>0||ctmsOpenIssues>0)?'8px':'0')+';">' +
          '<b style="color:var(--danger);">'+endingSoon.length+'건</b>의 과제가 2개월 이내 배정 종료 예정이에요 — ' +
          endingSoon.map(a => esc(a.taskName)+' ('+periodLabel(a.endPeriod)+')').join(', ') +
        '</div>' : '') +
      (ctmsDelayedList.length > 0 ?
        '<div style="font-size:13px;color:#475569;line-height:1.5;margin-bottom:'+(ctmsOpenIssues>0?'8px':'0')+';">' +
          'CTMS 마일스톤이 지연된 과제 <b style="color:var(--danger);">'+ctmsDelayedList.length+'건</b> — ' +
          ctmsDelayedList.map(x => esc(x.g.primary.taskName)+' ('+x.s.overdue.length+'단계)').join(', ') +
        '</div>' : '') +
      (ctmsOpenIssues > 0 ?
        '<div style="font-size:13px;color:#475569;line-height:1.5;">CTMS 미해결 이슈 <b style="color:var(--danger);">'+ctmsOpenIssues+'건</b>이 있어요 — CTMS 탭의 \'진행·이슈\'에서 확인해 주세요.</div>' : '') +
    '</div>';
  }

  html += '<div class="card">' +
    '<div class="row" style="align-items:flex-end;margin-bottom:16px;flex-wrap:wrap;">' +
      '<div style="flex:0 0 170px;"><div class="field-label">기준월</div>' +
        '<input type="month" class="input view-ok" value="'+basis+'" onchange="setDashBasis(this.value)"/></div>' +
      '<div style="flex:0 0 190px;"><div class="field-label">라인 필터</div>' +
        '<select class="input view-ok" onchange="setDashLineFilter(this.value)">' +
          '<option value="전체"'+(lineFilter==="전체"?" selected":"")+'>전체</option>' +
          LINE_ORDER.map(l => '<option value="'+l+'"'+(lineFilter===l?" selected":"")+'>'+LINE_META[l].label+'</option>').join("") +
        '</select></div>' +
      '<div style="flex:0 0 190px;"><div class="field-label">품목 필터</div>' +
        (state.products.length > 0 ?
          '<select class="input view-ok" onchange="setDashProductFilter(this.value)">' +
            '<option value="전체"'+(productFilter==="전체"?" selected":"")+'>전체</option>' +
            state.products.map(p => '<option value="'+p.id+'"'+(productFilter===p.id?" selected":"")+'>'+esc(p.name)+'</option>').join("") +
            '<option value="__none__"'+(productFilter==="__none__"?" selected":"")+'>미지정 (공통)</option>' +
          '</select>' :
          '<select class="input" disabled style="color:#94A3B8;background:#F8FAFC;"><option>등록된 품목 없음</option></select>' +
          '<div style="font-size:10.5px;color:#94A3B8;margin-top:4px;">\'품목 관리\' 탭에서 품목을 추가하면 사용할 수 있어요</div>'
        ) +
      '</div>' +
    '</div>' +
    '<div style="padding:14px 16px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#164F56);color:#fff;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
      '<div style="font-size:12.5px;font-weight:700;opacity:0.9;">'+periodLabel(basis)+' 팀 전체 FTE 총계'+((lineFilter!=="전체"||productFilter!=="전체")?' (필터 적용됨)':'')+'</div>' +
      '<div style="font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;">'+fmt(grandTotal)+' <span style="font-size:12px;font-weight:600;opacity:0.85;">FTE</span></div>' +
    '</div>' +
    '<div class="subtotal-grid">' +
      subtotals.map(s =>
        '<div class="subtotal-item" style="background:'+LINE_META[s.line].color+'19;">' +
          '<div class="subtotal-label" style="color:'+LINE_META[s.line].color+';">'+LINE_META[s.line].label+'</div>' +
          '<div class="subtotal-value">'+fmt(s.total)+' <span class="subtotal-unit">FTE (팀 전체)</span></div>' +
        '</div>'
      ).join("") +
    '</div>' +
    '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin:16px 0 8px;">개별 FTE 현황 ('+periodLabel(basis)+' 기준, 라인·품목 필터 무관 · 1.0 FTE 대비)</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      idleList.map(x => {
        const over = isOverCapacity(x.total);
        const color = over ? "var(--danger)" : (x.remain < 0.15 ? "#B45309" : "var(--accent)");
        return '<span style="font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:'+color+'19;color:'+color+';white-space:nowrap;">' +
          esc(x.m.name)+' '+(over?'초과 ':'여유 ')+fmt(Math.abs(x.remain))+
        '</span>';
      }).join("") +
    '</div>' +
    (typeSubtotals.length > 0 ?
      '<div style="display:flex;align-items:center;gap:5px;cursor:pointer;margin:16px 0 8px;user-select:none;" onclick="toggleDashSection(\'typeSubtotalOpen\')">' +
        '<span style="font-size:11.5px;font-weight:700;color:#64748B;">과제유형별 소계'+(lineFilter!=="전체"?" ("+lineFilter+" 라인 기준)":"")+'</span>' +
        '<span style="color:#94A3B8;transform:rotate('+(state.dash.typeSubtotalOpen?90:0)+'deg);transition:transform 0.15s;display:inline-flex;">'+icon('chevronRight',13)+'</span>' +
      '</div>' +
      (state.dash.typeSubtotalOpen ?
        '<div class="subtotal-grid">' +
          typeSubtotals
            .filter(s => lineFilter==="전체" || s.type.line===lineFilter)
            .map(s =>
              '<div class="subtotal-item" style="background:#F1F5F9;">' +
                '<div class="subtotal-label" style="color:#475569;">'+esc(s.type.name)+'</div>' +
                '<div class="subtotal-value">'+fmt(s.total)+' <span class="subtotal-unit">FTE (팀 전체)</span></div>' +
              '</div>'
            ).join("") +
        '</div>' : '') : '') +
    (state.products.length > 0 ?
      '<div style="display:flex;align-items:center;gap:5px;cursor:pointer;margin:16px 0 8px;user-select:none;" onclick="toggleDashSection(\'productSubtotalOpen\')">' +
        '<span style="font-size:11.5px;font-weight:700;color:#64748B;">품목별 소계'+(lineFilter!=="전체"?" ("+lineFilter+" 라인 기준)":"")+'</span>' +
        '<span style="color:#94A3B8;transform:rotate('+(state.dash.productSubtotalOpen?90:0)+'deg);transition:transform 0.15s;display:inline-flex;">'+icon('chevronRight',13)+'</span>' +
      '</div>' +
      (state.dash.productSubtotalOpen ?
        '<div class="subtotal-grid">' +
          productSubtotals.map(s =>
            '<div class="subtotal-item" style="background:#F1F5F9;">' +
              '<div class="subtotal-label" style="color:#475569;">'+esc(s.product.name)+'</div>' +
              '<div class="subtotal-value">'+fmt(s.total)+' <span class="subtotal-unit">FTE (팀 전체)</span></div>' +
            '</div>'
          ).join("") +
          '<div class="subtotal-item" style="background:#F1F5F9;">' +
            '<div class="subtotal-label" style="color:#475569;">미지정 (공통)</div>' +
            '<div class="subtotal-value">'+fmt(unassignedProductTotal)+' <span class="subtotal-unit">FTE (팀 전체)</span></div>' +
          '</div>' +
        '</div>' : '') : '') +
  '</div>';

  fteMembers().forEach(m => {
    const mine = fteAssignments()
      .filter(a => a.memberId === m.id && isActive(a, basis))
      .filter(a => { if(lineFilter==="전체") return true; const t=map[a.taskTypeId]; return t && t.line===lineFilter; })
      .filter(a => {
        if(productFilter==="전체") return true;
        if(productFilter==="__none__") return !a.productId;
        return a.productId===productFilter;
      });
    const total = mine.reduce((s,a) => s + fteForPeriod(a, basis), 0);
    const over = isOverCapacity(total);
    const cap = 1.2, markerPct = (1.0/cap)*100;
    let acc = 0;
    const segs = mine.map(a => {
      const t = map[a.taskTypeId];
      const color = t ? LINE_META[t.line].color : "#94A3B8";
      const effFte = fteForPeriod(a, basis);
      const widthPct = Math.min((effFte/cap)*100, 100);
      const leftPct = Math.min((acc/cap)*100, 100);
      acc += effFte;
      return '<div style="position:absolute;left:'+leftPct+'%;width:'+widthPct+'%;top:0;bottom:0;background:'+color+';opacity:'+(over?0.55:0.85)+';"></div>';
    }).join("");

    const filterNote = [lineFilter!=="전체"?lineFilter:null, productFilter!=="전체"?(productFilter==="__none__"?"미지정":(pmap[productFilter]?pmap[productFilter].name:"")):null].filter(Boolean).join(" · ");

    html += '<div class="card">' +
      '<div class="member-card-head">' +
        '<span style="font-weight:700;font-size:15px;">'+esc(m.name)+'</span>' +
        '<div style="font-size:15px;font-weight:800;color:'+(over?'var(--danger)':'var(--ink)')+';font-variant-numeric:tabular-nums;">' +
          fmt(total)+' FTE' + (over?' <span style="margin-left:6px;font-size:11px;font-weight:700;color:var(--danger);">초과</span>':'') +
        '</div>' +
      '</div>' +
      '<div class="cap-bar">'+segs+'<div class="cap-marker" style="left:'+markerPct+'%;"></div></div>' +
      (mine.length===0 ?
        '<div style="margin-top:10px;font-size:12.5px;color:#94A3B8;">'+periodLabel(basis)+' 기준 배정된 과제 없음'+(filterNote?" ("+filterNote+")":"")+'</div>' :
        '<div style="margin-top:12px;">' + mine.map(a => {
          const t = map[a.taskTypeId];
          const p = pmap[a.productId];
          return '<div style="margin-bottom:6px;"><div class="assign-row" style="margin-bottom:0;">' +
            '<div style="display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;">' +
              lineTagHtml(t ? t.line : null) +
              (p?'<span class="product-tag">'+esc(p.name)+'</span>':'') +
              coAssignTagHtml(a, basis) +
              '<span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(a.taskName)+'</span>' +
              '<span style="color:#94A3B8;font-size:11.5px;white-space:nowrap;">'+(t?esc(t.name):"유형 삭제됨")+'</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;">' +
              statusSelectHtml(a) +
              fteEditInputHtml(a) +
              '<span style="font-weight:800;color:#16A34A;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap;" title="'+periodLabel(basis)+' 적용 FTE (월별 조정 반영)">'+(isCurrentBasisMonth?'당월':periodLabel(basis))+' '+fmt(fteForPeriod(a, basis))+'</span>' +
              overrideToggleBtnHtml(a) +
              periodToggleBtnHtml(a) +
              coAssignBtnHtml(a) +
              '<button class="icon-btn" onclick="removeAssignment(\''+a.id+'\')">'+icon('trash',14)+'</button>' +
            '</div>' +
          '</div>' + overridePanelHtml(a) + periodPanelHtml(a) + '</div>';
        }).join("") + '</div>'
      ) +
    '</div>';
  });

  html += '</div>';
  return html;
}
function setAssignMemberFilter(v){ state.search.assignMemberFilter = v; renderTabContent(); }
function setAssignProductFilter(v){ state.search.assignProductFilter = v; renderTabContent(); }
function setAssignTypeFilter(v){ state.search.assignTypeFilter = v; renderTabContent(); }
function setAssignSort(v){ state.search.assignSort = v; renderTabContent(); }
function setDashBasis(v){ state.dash.basis = v; renderTabContent(); }
function setDashLineFilter(v){ state.dash.lineFilter = v; renderTabContent(); }
function setDashProductFilter(v){ state.dash.productFilter = v; renderTabContent(); }
function toggleDashSection(key){ state.dash[key] = !state.dash[key]; renderTabContent(); }
function removeAssignment(id){
  const idx = state.assignments.findIndex(a => a.id === id);
  if(idx === -1) return;
  const removed = state.assignments[idx];
  state.assignments.splice(idx, 1);
  logActivity('배정 삭제: "'+removed.taskName+'"');
  state.lastAction = {
    restore: () => { state.assignments.splice(idx, 0, removed); },
    undoMsg: '배정 삭제 취소: "'+removed.taskName+'"',
  };
  showUndoToast('"'+removed.taskName+'" 배정을 삭제했어요');
  scheduleSave();
  renderTabContent();
}

function lineTagHtml(line){
  if(!line || !LINE_META[line]) return '';
  const text = line === "ETC" ? "기타" : line;
  return '<span class="line-tag '+line+'">'+text+'</span>';
}

function statusSelectHtml(a){
  const st = a.status || "준비중";
  const meta = STATUS_META[st];
  return '<select onchange="updateAssignmentStatus(\''+a.id+'\', this.value)" ' +
    'style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:999px;border:none;' +
    'background:'+meta.soft+';color:'+meta.color+';cursor:pointer;">' +
    STATUS_ORDER.map(s => '<option value="'+s+'"'+(s===st?" selected":"")+'>'+s+'</option>').join("") +
    '</select>';
}
function updateAssignmentStatus(id, status){
  const a = state.assignments.find(x => x.id === id);
  if(!a) return;
  const prevStatus = a.status || "준비중";
  a.status = status;
  if(status !== prevStatus) logActivity('상태 변경: "'+a.taskName+'" '+prevStatus+' → '+status);
  scheduleSave();
  renderTabContent();

  if(status !== prevStatus){
    showModal(
      '<div style="font-weight:800;font-size:14px;margin-bottom:6px;">'+esc(a.taskName)+'</div>' +
      '<div style="font-size:12.5px;color:#475569;margin-bottom:14px;">상태를 \''+prevStatus+'\' → \''+status+'\'(으)로 변경했어요. '+periodLabel(currentPeriod())+' 기준 FTE도 함께 조정할까요?</div>' +
      '<input type="number" step="0.01" min="0" id="modal-fte-input" class="input" value="'+a.fte+'" style="margin-bottom:14px;"/>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">그대로 두기</button>' +
        '<button class="add-btn" style="flex:1;justify-content:center;" onclick="confirmStatusFteChange(\''+a.id+'\')">적용</button>' +
      '</div>'
    );
  }
}
function confirmStatusFteChange(id){
  const a = state.assignments.find(x => x.id === id);
  const input = document.getElementById("modal-fte-input");
  if(a && input){
    const num = Number(input.value);
    if(num > 0){ a.fte = num; scheduleSave(); renderTabContent(); }
  }
  closeModal();
}
function fteEditInputHtml(a){
  return '<input type="number" step="0.01" min="0" value="'+a.fte+'" ' +
    'onchange="updateAssignmentFte(\''+a.id+'\', this.value)" ' +
    'onclick="event.stopPropagation()" ' +
    'title="FTE를 수정하려면 값을 바꾸고 엔터 또는 다른 곳을 클릭하세요" ' +
    'style="width:58px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);' +
    'font-size:12.5px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;background:#fff;"/>';
}
function updateAssignmentFte(id, val){
  const a = state.assignments.find(x => x.id === id);
  const num = Number(val);
  if(a && num > 0){ a.fte = num; scheduleSave(); renderTabContent(); }
  else if(a){
    showToast("FTE는 0보다 큰 값이어야 해요. 이전 값("+fmt(a.fte)+")으로 되돌렸어요.", { error: true });
    renderTabContent(); // revert invalid input by re-rendering with stored value
  }
}
function updateAssignmentTaskName(id, name){
  const a = state.assignments.find(x => x.id === id);
  const clean = name.trim();
  if(a && clean){ a.taskName = clean; scheduleSave(); }
  else { renderTabContent(); } // revert to stored name if left blank
}
function updateGroupTaskName(gid, name){
  const clean = name.trim();
  if(!clean){ renderTabContent(); return; }
  const matches = state.assignments.filter(a => (a.groupId || a.id) === gid);
  if(matches.length === 0){ renderTabContent(); return; }
  matches.forEach(a => { a.taskName = clean; });
  scheduleSave();
  renderTabContent();
}
function updateGroupTaskType(gid, taskTypeId){
  if(!taskTypeId) { renderTabContent(); return; }
  const matches = state.assignments.filter(a => (a.groupId || a.id) === gid);
  if(matches.length === 0){ renderTabContent(); return; }
  const t = taskTypeById()[taskTypeId];
  matches.forEach(a => { a.taskTypeId = taskTypeId; });
  logActivity('과제 유형 변경: "'+matches[0].taskName+'" → '+(t?t.name:'')+(matches.length>1?' ('+matches.length+'명 전체 적용)':''));
  scheduleSave();
  renderTabContent();
}

/* ---------------- Monthly FTE overrides (과거/미래 월별 FTE 조정) ---------------- */
function overrideToggleBtnHtml(a){
  const count = a.overrides ? Object.keys(a.overrides).length : 0;
  const open = !!state.expandedOverrides[a.id];
  return '<button class="icon-btn view-ok" onclick="toggleOverridePanel(\''+a.id+'\')" ' +
    'style="display:flex;align-items:center;gap:3px;color:'+(count>0?"var(--accent)":"#CBD5E1")+';" ' +
    'title="월별 FTE 조정 보기">' +
    icon('calendar',14) +
    (count>0 ? '<span style="font-size:10.5px;font-weight:700;">'+count+'</span>' : '') +
  '</button>';
}
function toggleOverridePanel(id){
  state.expandedOverrides[id] = !state.expandedOverrides[id];
  renderTabContent();
}
function overridePanelHtml(a){
  if(!state.expandedOverrides[a.id]) return "";
  const overrides = a.overrides || {};
  const months = Object.keys(overrides).sort();
  return '<div style="margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;">' +
    '<div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:8px;">월별 FTE 조정 <span style="font-weight:500;color:#94A3B8;">(과거·미래 특정 월의 FTE를 기본값과 다르게 지정, 사유 메모 가능)</span></div>' +
    (months.length === 0 ? '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:8px;">지정된 월별 조정이 없어요. 기본 FTE('+fmt(a.fte)+')가 전 기간에 적용돼요.</div>' :
      '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;">' +
        months.map(m => {
          const note = overrideNote(overrides[m]);
          return '<div style="background:#fff;padding:6px 8px;border-radius:6px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">' +
              '<span>'+periodLabel(m)+'</span>' +
              '<span style="display:flex;align-items:center;gap:8px;">' +
                '<b style="font-variant-numeric:tabular-nums;">'+fmt(overrideFte(overrides[m]))+' FTE</b>' +
                '<button class="icon-btn" onclick="removeOverride(\''+a.id+'\', \''+m+'\')">'+icon('trash',12)+'</button>' +
              '</span>' +
            '</div>' +
            (note ? '<div style="font-size:11px;color:#94A3B8;margin-top:3px;">'+esc(note)+'</div>' : '') +
          '</div>';
        }).join("") +
      '</div>'
    ) +
    '<div class="row" style="gap:6px;margin-bottom:6px;">' +
      '<input type="month" id="ov-month-'+a.id+'" class="input" style="flex:1;font-size:12px;padding:6px 8px;"/>' +
      '<input type="number" step="0.01" min="0" id="ov-fte-'+a.id+'" class="input" placeholder="FTE" style="flex:0 0 80px;font-size:12px;padding:6px 8px;"/>' +
      '<button class="add-btn" style="flex:0 0 auto;padding:6px 10px;" onclick="addOverride(\''+a.id+'\')">'+icon('plus',13)+'</button>' +
    '</div>' +
    '<input id="ov-note-'+a.id+'" class="input" placeholder="사유 메모 (선택, 예: 휴직으로 업무 중단)" style="font-size:12px;padding:6px 8px;"/>' +
  '</div>';
}
function addOverride(id){
  const a = state.assignments.find(x => x.id === id);
  if(!a) return;
  const monthInput = document.getElementById("ov-month-"+id);
  const fteInput = document.getElementById("ov-fte-"+id);
  const noteInput = document.getElementById("ov-note-"+id);
  const month = monthInput.value;
  const fteRaw = fteInput.value;
  if(!month || fteRaw === "") return;
  const fte = Number(fteRaw);
  if(!(fte >= 0)) return;
  if(!a.overrides) a.overrides = {};
  a.overrides[month] = { fte: fte, note: (noteInput.value || "").trim() };
  scheduleSave();
  renderTabContent();
}
function removeOverride(id, month){
  const a = state.assignments.find(x => x.id === id);
  if(!a || !a.overrides) return;
  delete a.overrides[month];
  scheduleSave();
  renderTabContent();
}

/* ---------------- Assignment period edit (상태 변경 없이 배정 기간 수정) ---------------- */
function periodToggleBtnHtml(a){
  return '<button class="icon-btn view-ok" onclick="togglePeriodPanel(\''+a.id+'\')" ' +
    'style="display:flex;align-items:center;color:#94A3B8;" title="배정 기간 보기/수정">' +
    icon('edit',14) +
  '</button>';
}
function togglePeriodPanel(id){
  state.expandedPeriodEdit[id] = !state.expandedPeriodEdit[id];
  renderTabContent();
}
function periodPanelHtml(a){
  if(!state.expandedPeriodEdit[a.id]) return "";
  const ongoing = !a.endPeriod;
  return '<div style="margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;">' +
    '<div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:8px;">배정 기간 수정 <span style="font-weight:500;color:#94A3B8;">(상태는 그대로 유지돼요)</span></div>' +
    (a.periodNote ? '<div style="font-size:11px;color:#94A3B8;margin-bottom:8px;">최근 변경 사유: '+esc(a.periodNote)+'</div>' : '') +
    '<div class="row" style="gap:6px;margin-bottom:6px;">' +
      '<div style="flex:1;">' +
        '<div style="font-size:10.5px;color:#94A3B8;margin-bottom:3px;">시작월</div>' +
        '<input type="month" id="pd-start-'+a.id+'" class="input" value="'+a.startPeriod+'" style="font-size:12px;padding:6px 8px;"/>' +
      '</div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:10.5px;color:#94A3B8;margin-bottom:3px;">종료월</div>' +
        '<input type="month" id="pd-end-'+a.id+'" class="input" value="'+(a.endPeriod||"")+'" '+(ongoing?"disabled":"")+' style="font-size:12px;padding:6px 8px;'+(ongoing?"color:#CBD5E1;":"")+'"/>' +
      '</div>' +
    '</div>' +
    '<label class="checkbox-label" style="margin-bottom:8px;">' +
      '<input type="checkbox" id="pd-ongoing-'+a.id+'" '+(ongoing?"checked":"")+' ' +
      'onchange="document.getElementById(\'pd-end-'+a.id+'\').disabled = this.checked; document.getElementById(\'pd-end-'+a.id+'\').style.color = this.checked ? \'#CBD5E1\' : \'\';"/> ' +
      '종료월 미정 (진행중)' +
    '</label>' +
    '<input id="pd-note-'+a.id+'" class="input" placeholder="사유 메모 (선택, 예: 과제 일정 연장)" style="font-size:12px;padding:6px 8px;margin-bottom:8px;"/>' +
    '<button class="add-btn" style="width:100%;justify-content:center;" onclick="updateAssignmentPeriod(\''+a.id+'\')">'+icon('plus',13)+' 기간 저장</button>' +
  '</div>';
}
function updateAssignmentPeriod(id){
  const a = state.assignments.find(x => x.id === id);
  if(!a) return;
  const startInput = document.getElementById("pd-start-"+id);
  const ongoingChk = document.getElementById("pd-ongoing-"+id);
  const endInput = document.getElementById("pd-end-"+id);
  const noteInput = document.getElementById("pd-note-"+id);
  const start = startInput.value;
  const ongoing = ongoingChk.checked;
  const end = ongoing ? "" : endInput.value;
  if(!start) return;
  if(!ongoing && !end) return;
  if(!ongoing && end < start){
    showModal(
      '<div style="font-weight:800;font-size:14px;margin-bottom:8px;color:var(--danger);">기간 오류</div>' +
      '<div style="font-size:13px;color:#475569;margin-bottom:18px;">종료월이 시작월보다 빠를 수 없어요.</div>' +
      '<button class="primary-btn" onclick="closeModal()">확인</button>'
    );
    return;
  }
  const prevLabel = a.startPeriod+'~'+(a.endPeriod||"진행중");
  const nextLabel = start+'~'+(ongoing?"진행중":end);
  const note = (noteInput.value || "").trim();
  a.startPeriod = start;
  a.endPeriod = ongoing ? null : end;
  if(note) a.periodNote = note;
  delete state.expandedPeriodEdit[id];
  logActivity('배정 기간 수정: "'+a.taskName+'" '+prevLabel+' → '+nextLabel+(note?' (사유: '+note+')':''));
  scheduleSave();
  renderTabContent();
}

/* ---------------- Co-assignment (한 과제에 담당자 추가) ---------------- */
function assignmentGroupMembers(a, period){
  if(!a.groupId) return [a];
  const group = state.assignments.filter(x => x.groupId === a.groupId);
  if(!period) return group; // unfiltered: full historical group (used for exclusion checks)
  return group.filter(x => isActive(x, period));
}
function coAssignTagHtml(a, period){
  const group = assignmentGroupMembers(a, period).filter(x => !isLeaderMember(x.memberId));
  if(group.length <= 1) return '';
  const names = group.map(x => { const m = state.members.find(y => y.id === x.memberId); return m ? m.name : "삭제된 팀원"; }).join(', ');
  return '<span title="공동 배정: '+esc(names)+'" style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;' +
    'background:var(--msl-soft);color:var(--msl);white-space:nowrap;">공동 '+group.length+'명</span>';
}
function coAssignBtnHtml(a){
  return '<button onclick="openCoAssignModal(\''+a.id+'\')" title="담당자 추가" ' +
    'style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 auto;' +
    'border-radius:999px;border:1px solid var(--accent);background:#fff;color:var(--accent);cursor:pointer;">' +
    icon('users',13) +
  '</button>';
}
function memberSubRowHtml(a){
  const m = state.members.find(x => x.id === a.memberId);
  return '<div style="margin-bottom:6px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;background:#F8FAFC;border-radius:6px;flex-wrap:wrap;">' +
      '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
        '<span style="font-weight:600;font-size:12.5px;">'+(m?esc(m.name):"삭제된 팀원")+'</span>' +
        '<span style="color:#94A3B8;font-size:11px;white-space:nowrap;">'+a.startPeriod+'~'+(a.endPeriod||"진행중")+'</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">' +
        statusSelectHtml(a) +
        fteEditInputHtml(a) +
        overrideToggleBtnHtml(a) +
        periodToggleBtnHtml(a) +
        '<button class="icon-btn" onclick="removeAssignment(\''+a.id+'\')">'+icon('trash',14)+'</button>' +
      '</div>' +
    '</div>' + overridePanelHtml(a) + periodPanelHtml(a) +
  '</div>';
}
function openCoAssignModal(id){
  const a = state.assignments.find(x => x.id === id);
  if(!a) return;
  const group = assignmentGroupMembers(a); // full historical group, so a person can't be double-added
  const activeGroup = assignmentGroupMembers(a, currentPeriod()).filter(x => !isLeaderMember(x.memberId));
  const usedMemberIds = group.map(x => x.memberId);
  const available = fteMembers().filter(m => !usedMemberIds.includes(m.id));
  const t = taskTypeById()[a.taskTypeId];
  const defaultFte = t ? t.fte : a.fte;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">담당자 추가</div>' +
    '<div style="font-size:12.5px;color:#94A3B8;margin-bottom:14px;line-height:1.5;">"'+esc(a.taskName)+'"에 담당자를 함께 배정해요. ' +
    '같은 과제를 각자 별도 FTE와 기간으로 독립적으로 관리할 수 있어요.' +
    (activeGroup.length > 1 ? '<br/>현재 담당('+periodLabel(currentPeriod())+' 기준): '+activeGroup.map(x=>{const m=state.members.find(y=>y.id===x.memberId);return m?esc(m.name):"삭제된 팀원";}).join(', ') : '') +
    '</div>' +
    (available.length === 0 ?
      '<div style="font-size:12.5px;color:#94A3B8;margin-bottom:14px;">추가할 수 있는 팀원이 없어요 (팀장을 뺀 팀원이 모두 이미 배정됨).</div>' +
      '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' :
      '<div class="field"><div class="field-label">담당자</div>' +
        '<select class="input" id="ca-member"><option value="">선택하세요</option>' +
        available.map(m => '<option value="'+m.id+'">'+esc(m.name)+'</option>').join("") +
      '</select></div>' +
      '<div class="row">' +
        '<div class="field"><div class="field-label">FTE</div>' +
          '<input class="input" id="ca-fte" type="number" step="0.01" min="0" value="'+defaultFte+'"/></div>' +
        '<div class="field"><div class="field-label">시작월</div>' +
          '<input class="input" id="ca-start" type="month" value="'+a.startPeriod+'"/></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:6px;">' +
        '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
        '<button class="add-btn" style="flex:1;justify-content:center;" onclick="confirmCoAssign(\''+id+'\')">추가</button>' +
      '</div>'
    )
  );
}
function confirmCoAssign(id){
  const a = state.assignments.find(x => x.id === id);
  const memberSel = document.getElementById("ca-member");
  const fteInput = document.getElementById("ca-fte");
  const startInput = document.getElementById("ca-start");
  if(!a || !memberSel || !memberSel.value) return;
  const fte = Number(fteInput.value);
  if(!(fte > 0)) return;
  const start = startInput.value || a.startPeriod;
  if(!a.groupId) a.groupId = a.id;
  const newAssignment = {
    id: uid("as"), memberId: memberSel.value, taskTypeId: a.taskTypeId, productId: a.productId,
    taskName: a.taskName, fte, startPeriod: start, endPeriod: a.endPeriod, status: a.status,
    overrides: {}, groupId: a.groupId,
  };
  state.assignments.push(newAssignment);
  const m = state.members.find(x => x.id === memberSel.value);
  logActivity('담당자 추가: "'+a.taskName+'" → '+(m?m.name:'') );
  scheduleSave();
  closeModal();
  renderTabContent();
}

/* ---------------- Assign ---------------- */
function renderAssignTab(){
  const map = taskTypeById();
  const pmap = productById();
  const today = currentPeriod();

  let html = '<div class="stack">';
  html += '<div class="card">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#475569;">새 과제 배정</div>' +
    '<div class="field"><div class="field-label">과제명</div>' +
      '<input class="input" id="af-taskname" placeholder="예: 한타박스 시판후 효과 연구"/></div>' +
    '<div class="row">' +
      '<div class="field"><div class="field-label">과제 유형</div>' +
        '<select class="input" id="af-tasktype"><option value="">선택하세요</option>' +
        state.taskTypes.map(t => '<option value="'+t.id+'">['+t.line+'] '+esc(t.name)+' (기본 '+fmt(t.fte)+')</option>').join("") +
        '<option value="__new__">+ 새 과제 유형 직접 추가</option>' +
        '</select>' +
        '<div id="af-newtype-wrap" style="display:none;margin-top:8px;padding:10px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;">' +
          '<input class="input" id="af-newtype-name" placeholder="새 유형명 (예: 임상연구자 자문)" style="margin-bottom:8px;"/>' +
          '<select class="input" id="af-newtype-line">' +
            LINE_ORDER.map(l => '<option value="'+l+'">'+LINE_META[l].label+'</option>').join("") +
          '</select>' +
          '<div style="font-size:11px;color:#94A3B8;margin-top:6px;">아래 FTE 입력값이 이 유형의 기본 FTE로 저장돼요.</div>' +
        '</div>' +
      '</div>' +
      '<div class="field"><div class="field-label">품목</div>' +
        '<select class="input" id="af-product"><option value="">선택 안 함 (공통)</option>' +
        state.products.map(p => '<option value="'+p.id+'">'+esc(p.name)+'</option>').join("") +
        '<option value="__new__">+ 새 품목 직접 추가</option>' +
        '</select>' +
        '<div id="af-newproduct-wrap" style="display:none;margin-top:8px;">' +
          '<input class="input" id="af-newproduct-name" placeholder="새 품목명 (예: 한타박스주)"/>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="field"><div class="field-label">FTE (필요 시 조정)</div>' +
        '<input class="input" id="af-fte" type="number" step="0.01" min="0"/></div>' +
      '<div class="field"><div class="field-label">담당 팀원</div>' +
        '<select class="input" id="af-member"><option value="">선택하세요</option>' +
        fteMembers().map(m => '<option value="'+m.id+'">'+esc(m.name)+'</option>').join("") +
        '<option value="__new__">+ 새 팀원 직접 추가</option>' +
        '</select>' +
        '<div id="af-newmember-wrap" style="display:none;margin-top:8px;">' +
          '<input class="input" id="af-newmember-name" placeholder="새 팀원 이름"/>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="row">' +
      '<div class="field"><div class="field-label">시작월</div>' +
        '<input class="input" id="af-start" type="month" value="'+today+'"/></div>' +
      '<div class="field"><div class="field-label">종료월</div>' +
        '<div id="af-end-wrap"><div class="input" style="display:flex;align-items:center;color:#94A3B8;">진행중</div></div></div>' +
      '<div class="field"><div class="field-label">과제 상태</div>' +
        '<select class="input" id="af-status">' +
          STATUS_ORDER.map(s => '<option value="'+s+'"'+(s==="준비중"?" selected":"")+'>'+s+'</option>').join("") +
        '</select></div>' +
    '</div>' +
    '<label class="checkbox-label"><input type="checkbox" id="af-ongoing" checked/> 종료월 미정 (진행중인 과제)</label>' +
    '<div id="af-preview"></div>' +
    '<button class="primary-btn" id="af-submit" disabled onclick="addAssignment()">'+icon('plus',15)+' 배정 추가</button>' +
  '</div>';

  const memberFilter = state.search.assignMemberFilter || "전체";
  const productFilter = state.search.assignProductFilter || "전체";
  const typeFilter = state.search.assignTypeFilter || "전체";
  const filtersActive = memberFilter !== "전체" || productFilter !== "전체" || typeFilter !== "전체";
  let filteredAssignments = fteAssignments().filter(a => {
    if(memberFilter !== "전체" && a.memberId !== memberFilter) return false;
    if(productFilter !== "전체"){
      if(productFilter === "__none__"){ if(a.productId) return false; }
      else if(a.productId !== productFilter) return false;
    }
    if(typeFilter !== "전체" && a.taskTypeId !== typeFilter) return false;
    return true;
  });
  const assignSort = state.search.assignSort || "recent";
  if(assignSort === "member"){
    filteredAssignments.sort((a,b) => {
      const ma = state.members.find(x => x.id === a.memberId), mb = state.members.find(x => x.id === b.memberId);
      return (ma?ma.name:"").localeCompare(mb?mb.name:"", "ko");
    });
  }else if(assignSort === "fte_desc"){
    filteredAssignments.sort((a,b) => b.fte - a.fte);
  }else if(assignSort === "ending"){
    filteredAssignments.sort((a,b) => (a.endPeriod||"9999-99").localeCompare(b.endPeriod||"9999-99"));
  }else{
    filteredAssignments.reverse(); // "recent": most recently added first
  }

  // 공동배정/인수인계로 같은 groupId를 공유하는 레코드는 한 과제로 묶어서 한 번만 표시
  const seenGroups = new Set();
  const groupedList = [];
  filteredAssignments.forEach(a => {
    const gid = a.groupId || a.id;
    if(seenGroups.has(gid)) return;
    seenGroups.add(gid);
    const members = fteAssignments().filter(x => (x.groupId || x.id) === gid)
      .sort((x,y) => (x.startPeriod||"").localeCompare(y.startPeriod||""));
    groupedList.push({ primary: a, gid, members });
  });
  const totalGroupIds = new Set(fteAssignments().map(a => a.groupId || a.id));

  html += '<div class="card">' +
    '<div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:10px;">전체 배정 목록 ('+groupedList.length+(filtersActive?' / '+totalGroupIds.size:'')+')</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:12px;">' +
      '<select class="input view-ok" onchange="setAssignMemberFilter(this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="전체">담당자 전체</option>' +
        fteMembers().map(m => '<option value="'+m.id+'"'+(memberFilter===m.id?" selected":"")+'>'+esc(m.name)+'</option>').join("") +
      '</select>' +
      '<select class="input view-ok" onchange="setAssignTypeFilter(this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="전체">과제유형 전체</option>' +
        state.taskTypes.map(t => '<option value="'+t.id+'"'+(typeFilter===t.id?" selected":"")+'>'+esc(t.name)+'</option>').join("") +
      '</select>' +
      '<select class="input view-ok" onchange="setAssignProductFilter(this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="전체">품목 전체</option>' +
        state.products.map(p => '<option value="'+p.id+'"'+(productFilter===p.id?" selected":"")+'>'+esc(p.name)+'</option>').join("") +
        '<option value="__none__"'+(productFilter==="__none__"?" selected":"")+'>미지정 (공통)</option>' +
      '</select>' +
      '<select class="input view-ok" onchange="setAssignSort(this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="recent"'+(assignSort==="recent"?" selected":"")+'>최근 등록순</option>' +
        '<option value="member"'+(assignSort==="member"?" selected":"")+'>담당자순</option>' +
        '<option value="fte_desc"'+(assignSort==="fte_desc"?" selected":"")+'>FTE 높은순</option>' +
        '<option value="ending"'+(assignSort==="ending"?" selected":"")+'>종료 임박순</option>' +
      '</select>' +
    '</div>' +
  '</div>';
  if(fteAssignments().length === 0){
    html += '<div class="empty">아직 배정된 과제가 없어요.</div>';
  }else if(groupedList.length === 0){
    html += '<div class="empty">조건에 맞는 배정이 없어요.</div>';
  }else{
    html += groupedList.map(g => {
      const primary = g.primary;
      const t = map[primary.taskTypeId];
      const p = pmap[primary.productId];
      return '<div class="card" style="padding:14px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;">' +
            lineTagHtml(t ? t.line : null) +
            (p?' <span class="product-tag">'+esc(p.name)+'</span>':'') +
            '<input value="'+esc(primary.taskName)+'" onchange="updateGroupTaskName(\''+g.gid+'\', this.value)" ' +
            'style="display:inline-block;width:220px;max-width:100%;font-weight:700;font-size:13.5px;' +
            'border:1px solid transparent;border-radius:6px;background:transparent;padding:3px 6px;vertical-align:middle;" ' +
            'onfocus="this.style.borderColor=\'var(--border)\';this.style.background=\'#fff\';" ' +
            'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';"/>' +
            (g.members.length > 1 ? '<span style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--msl-soft);color:var(--msl);white-space:nowrap;">공동/인수인계 '+g.members.length+'명</span>' : '') +
            coAssignBtnHtml(primary) +
          '</div>' +
          '<select onchange="updateGroupTaskType(\''+g.gid+'\', this.value)" style="flex:0 0 auto;padding:5px 8px;border-radius:6px;border:1px solid var(--border);font-size:12px;max-width:100%;background:#F8FAFC;color:#475569;">' +
            (t ? '' : '<option value="">과제 유형 선택 (현재 삭제됨)</option>') +
            state.taskTypes.map(tt => '<option value="'+tt.id+'"'+(primary.taskTypeId===tt.id?" selected":"")+'>['+tt.line+'] '+esc(tt.name)+'</option>').join("") +
          '</select>' +
        '</div>' +
        g.members.map(memberSubRowHtml).join("") +
      '</div>';
    }).join("");
  }
  html += '</div></div>';
  return html;
}

function wireAssignTab(){
  const taskTypeSel = document.getElementById("af-tasktype");
  const fteInput = document.getElementById("af-fte");
  const memberSel = document.getElementById("af-member");
  const productSel = document.getElementById("af-product");
  const startInput = document.getElementById("af-start");
  const ongoingChk = document.getElementById("af-ongoing");
  const endWrap = document.getElementById("af-end-wrap");
  const newTypeWrap = document.getElementById("af-newtype-wrap");
  const newTypeName = document.getElementById("af-newtype-name");
  const newMemberWrap = document.getElementById("af-newmember-wrap");
  const newMemberName = document.getElementById("af-newmember-name");
  const newProductWrap = document.getElementById("af-newproduct-wrap");
  const newProductName = document.getElementById("af-newproduct-name");
  if(!taskTypeSel) return;

  taskTypeSel.addEventListener("change", () => {
    if(taskTypeSel.value === "__new__"){
      newTypeWrap.style.display = "block";
    }else{
      newTypeWrap.style.display = "none";
      const map = taskTypeById();
      const t = map[taskTypeSel.value];
      if(t) fteInput.value = t.fte;
    }
    updateAssignPreview();
  });
  memberSel.addEventListener("change", () => {
    newMemberWrap.style.display = memberSel.value === "__new__" ? "block" : "none";
    updateAssignPreview();
  });
  productSel.addEventListener("change", () => {
    newProductWrap.style.display = productSel.value === "__new__" ? "block" : "none";
    updateAssignPreview();
  });
  fteInput.addEventListener("input", updateAssignPreview);
  startInput.addEventListener("change", updateAssignPreview);
  newTypeName.addEventListener("input", updateAssignPreview);
  newMemberName.addEventListener("input", updateAssignPreview);
  newProductName.addEventListener("input", updateAssignPreview);
  ongoingChk.addEventListener("change", () => {
    if(ongoingChk.checked){
      endWrap.innerHTML = '<div class="input" style="display:flex;align-items:center;color:#94A3B8;">진행중</div>';
    }else{
      endWrap.innerHTML = '<input class="input" id="af-end" type="month" value="'+currentPeriod()+'"/>';
    }
    updateAssignPreview();
  });
  updateAssignPreview();
}

function updateAssignPreview(){
  const taskName = document.getElementById("af-taskname").value.trim();
  const taskTypeId = document.getElementById("af-tasktype").value;
  const newTypeName = document.getElementById("af-newtype-name").value.trim();
  const fte = Number(document.getElementById("af-fte").value);
  const memberId = document.getElementById("af-member").value;
  const newMemberName = document.getElementById("af-newmember-name").value.trim();
  const productId = document.getElementById("af-product").value;
  const newProductName = document.getElementById("af-newproduct-name").value.trim();
  const startPeriod = document.getElementById("af-start").value;
  const ongoing = document.getElementById("af-ongoing").checked;
  const endInput = document.getElementById("af-end");
  const endPeriod = endInput ? endInput.value : "";

  const previewEl = document.getElementById("af-preview");
  const submitBtn = document.getElementById("af-submit");

  const typeOk = taskTypeId && (taskTypeId !== "__new__" || newTypeName);
  const memberOk = memberId && (memberId !== "__new__" || newMemberName);
  const productOk = productId !== "__new__" || newProductName;

  if(memberOk && startPeriod){
    const curTotal = memberId === "__new__" ? 0 : memberFteAt(memberId, startPeriod);
    const projected = curTotal + (fte || 0);
    const willExceed = isOverCapacity(projected);
    previewEl.innerHTML = '<div class="preview-box" style="background:'+(willExceed?'#FDECEC':'#F1F9F8')+';color:'+(willExceed?'#B03A43':'var(--accent)')+';">' +
      (willExceed?icon('alert',13):'') +
      periodLabel(startPeriod)+' 기준 현재 '+fmt(curTotal)+' FTE → 배정 후 <b>'+fmt(projected)+' FTE</b>'+(willExceed?' (100% 초과)':'') +
    '</div>';
  }else{
    previewEl.innerHTML = "";
  }

  const canAdd = memberOk && typeOk && productOk && taskName && fte > 0 && startPeriod && (ongoing || endPeriod);
  submitBtn.disabled = !canAdd;
}

function addAssignment(){
  const taskName = document.getElementById("af-taskname").value.trim();
  let taskTypeId = document.getElementById("af-tasktype").value;
  const fte = Number(document.getElementById("af-fte").value);
  let memberId = document.getElementById("af-member").value;
  let productId = document.getElementById("af-product").value;
  const startPeriod = document.getElementById("af-start").value;
  const ongoing = document.getElementById("af-ongoing").checked;
  const endInput = document.getElementById("af-end");
  const endPeriod = endInput ? endInput.value : "";
  const status = document.getElementById("af-status").value;

  const newTypeNameEl = document.getElementById("af-newtype-name");
  const newTypeLineEl = document.getElementById("af-newtype-line");
  const newMemberNameEl = document.getElementById("af-newmember-name");
  const newProductNameEl = document.getElementById("af-newproduct-name");

  const typeOk = taskTypeId && (taskTypeId !== "__new__" || newTypeNameEl.value.trim());
  const memberOk = memberId && (memberId !== "__new__" || newMemberNameEl.value.trim());
  const productOk = productId !== "__new__" || newProductNameEl.value.trim();

  if(!(memberOk && typeOk && productOk && taskName && fte > 0 && startPeriod && (ongoing || endPeriod))) return;

  if(taskTypeId === "__new__"){
    const newType = { id: uid("tt"), name: newTypeNameEl.value.trim(), fte: fte, line: newTypeLineEl.value };
    state.taskTypes.push(newType);
    taskTypeId = newType.id;
  }
  if(memberId === "__new__"){
    const newMember = { id: uid("mem"), name: newMemberNameEl.value.trim() };
    state.members.push(newMember);
    memberId = newMember.id;
  }
  if(productId === "__new__"){
    const newProduct = { id: uid("prod"), name: newProductNameEl.value.trim() };
    state.products.push(newProduct);
    productId = newProduct.id;
  }

  state.assignments.push({
    id: uid("as"), memberId, taskTypeId, productId: productId || null, taskName, fte,
    startPeriod, endPeriod: ongoing ? null : endPeriod, status, overrides: {},
  });
  const memberForLog = state.members.find(x => x.id === memberId);
  logActivity('배정 추가: "'+taskName+'"'+(memberForLog?' → '+memberForLog.name:''));
  scheduleSave();
  renderTabContent();
}

/* ---------------- Members ---------------- */
function renderMembersTab(){
  let html = '<div class="stack">';
  html += '<div class="card">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#475569;">팀원 추가</div>' +
    '<div class="row" style="gap:8px;">' +
      '<input class="input" id="mem-name" placeholder="이름" onkeydown="if(event.key===\'Enter\')addMember()"/>' +
      '<button class="add-btn" style="flex:0 0 auto;" onclick="addMember()">'+icon('plus',14)+' 추가</button>' +
    '</div>' +
  '</div>';
  html += '<div class="card"><div style="font-size:13px;font-weight:700;margin-bottom:12px;color:#475569;">팀원 목록 ('+state.members.length+')</div>';
  if(state.members.length === 0){
    html += '<div class="empty">등록된 팀원이 없어요.</div>';
  }else{
    html += state.members.map(m =>
      '<div class="list-row">' +
        '<input class="input" value="'+esc(m.name)+'" onchange="updateMemberName(\''+m.id+'\', this.value)" ' +
        'style="flex:1;min-width:120px;font-size:13.5px;font-weight:600;border-color:transparent;background:transparent;padding:6px 8px;" ' +
        'onfocus="this.style.borderColor=\'var(--border)\';this.style.background=\'#fff\';" ' +
        'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';"/>' +
      '<label title="팀장은 과제 배정 대상에서 빠지고 FTE 화면에 보이지 않아요" style="display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;white-space:nowrap;color:'+(m.leader?'var(--accent)':'#94A3B8')+';cursor:pointer;">' +
        '<input type="checkbox"'+(m.leader?' checked':'')+' onchange="setMemberLeader(\''+m.id+'\', this.checked)"/> 팀장</label>' +
      '<button class="icon-btn" onclick="removeMember(\''+m.id+'\')">'+icon('trash',14)+'</button></div>'
    ).join("");
    html += '<div style="font-size:11.5px;color:#94A3B8;margin-top:10px;line-height:1.5;">팀장으로 표시하면 과제 배정 대상에서 빠지고, 배정 현황·과제 배정·과제 진행 현황·월별/분기별 화면에 보이지 않아요.</div>';
  }
  html += '</div>';
  html += profilesSectionHtml();
  html += '</div>';
  return html;
}

/* ---------------- 회원 승인 (관리자 전용, Supabase profiles) ---------------- */
let profilesCache = null; // null = 아직 안 불러옴
async function loadProfiles(){
  const { data, error } = await sb.from("profiles").select("id,login_id,name,role,approved,member_id,created_at").order("created_at");
  profilesCache = error ? [] : data;
  if(error) showToast("회원 목록을 불러오지 못했어요", { error: true });
  if(state.tab === "members") renderTabContent();
}
function profilesSectionHtml(){
  if(profilesCache === null){
    loadProfiles();
    return '<div class="card"><div class="empty">회원 목록을 불러오는 중…</div></div>';
  }
  const pending = profilesCache.filter(p => !p.approved).length;
  let html = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
    '<div style="font-size:13px;font-weight:700;color:#475569;">회원 승인 ('+profilesCache.length+'명'+(pending ? ' · <span style="color:#B45309;">대기 '+pending+'명</span>' : '')+')</div>' +
    '<button class="icon-round" title="새로고침" onclick="profilesCache=null;renderTabContent()">'+icon('refresh',13)+'</button></div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:12px;">승인해야 데이터가 보여요. 팀원을 연결하면 CTMS에서 본인 담당 과제를 입력할 수 있어요. 팀장은 과제 배정 대상에서 빠지고(FTE 화면에 안 보임), 뷰어는 팀원 연결 없이 조회만 할 수 있어요.</div>';
  html += profilesCache.map(p => {
    const isMe = currentProfile && p.id === currentProfile.id;
    const isViewer = p.role === "viewer";
    const tag = p.role === "admin"
      ? '<span class="line-tag" style="background:#E5F1F1;color:var(--accent);">관리자</span>'
      : !p.approved ? '<span class="line-tag" style="background:#FEF3E2;color:#B45309;">승인 대기</span>'
      : '<span class="line-tag" style="'+(isViewer ? 'background:#F1F5F9;color:#64748B;' : 'background:#E7F6EC;color:#16A34A;')+'">'+roleLabel(p.role)+'</span>';
    // 팀장 · 팀원 · 뷰어 전환 (승인된 관리자 외 회원만). 뷰어로 바꾸면 팀원 연결도 끊는다.
    const roleSel = (p.approved && p.role !== "admin" && !isMe)
      ? '<select class="input" style="width:100px;padding:6px 8px;font-size:12.5px;" onchange="setProfileRole(\''+p.id+'\', this.value)">' +
          ["leader", "member", "viewer"].map(r => '<option value="'+r+'"'+(p.role === r ? ' selected' : '')+'>'+roleLabel(r)+'</option>').join("") + '</select>'
      : '';
    return '<div class="list-row">' +
      '<div style="display:flex;align-items:center;gap:8px;min-width:150px;">' + tag +
        '<span style="font-size:13px;font-weight:700;">'+esc(p.name)+'</span>' +
        '<span style="font-size:12px;color:#94A3B8;">'+esc(p.login_id)+'</span></div>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        roleSel +
        (isViewer ? '' :
        '<select class="input" style="width:150px;padding:6px 8px;font-size:12.5px;" onchange="setProfileMember(\''+p.id+'\', this.value || null)">' +
          '<option value="">팀원 연결 안 함</option>' +
          state.members.map(m => '<option value="'+m.id+'"'+(p.member_id === m.id ? ' selected' : '')+'>'+esc(m.name)+'</option>').join("") +
        '</select>') +
        (isMe ? '' : '<button class="add-btn" style="padding:6px 12px;'+(p.approved ? 'background:#fff;color:#475569;border:1px solid var(--border);' : '')+'" onclick="updateProfile(\''+p.id+'\', { approved: '+(!p.approved)+' })">'+(p.approved ? '승인 취소' : '승인')+'</button>') +
        (!p.approved && !isMe ? '<button class="add-btn" style="padding:6px 12px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="updateProfile(\''+p.id+'\', { approved: true, role: \'viewer\', member_id: null })">뷰어로 승인</button>' : '') +
        (!isMe && p.role !== "admin" ? '<button class="icon-btn" title="회원 삭제" onclick="deleteProfileConfirm(\''+p.id+'\')">'+icon('trash',14)+'</button>' : '') +
      '</div></div>';
  }).join("");
  html += '</div>';
  return html;
}
function deleteProfileConfirm(id){
  const p = profilesCache.find(x => x.id === id);
  if(!p) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;color:var(--danger);">회원 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;"><b>'+esc(p.name)+'</b>('+esc(p.login_id)+') 계정을 삭제할까요? 되돌릴 수 없어요.<br/>' +
      '이 사람이 입력한 주간보고·교육 이력·전달교육 기록은 남고, 이후에는 관리자만 수정·삭제할 수 있어요.<br/>' +
      '재택은 내일 이후 계획만 삭제되고, 오늘까지의 재택 이력·업무 일지는 남아 관리자 화면과 엑셀에 \'(삭제된 회원)\'으로 표시돼요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="deleteProfile(\''+id+'\')">삭제</button>' +
    '</div>'
  );
}
async function deleteProfile(id){
  const { error } = await sb.rpc("admin_delete_user", { p_id: id });
  closeModal();
  if(error){ showToast("회원을 삭제하지 못했어요: " + error.message, { error: true }); return; }
  profilesCache = profilesCache.filter(p => p.id !== id);
  showToast("회원을 삭제했어요");
  renderTabContent();
}
async function updateProfile(id, patch){
  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if(error){ showToast("회원 정보를 저장하지 못했어요", { error: true }); return false; }
  const p = profilesCache.find(x => x.id === id);
  if(p) Object.assign(p, patch);
  if(currentProfile && currentProfile.id === id) Object.assign(currentProfile, patch);
  renderTabContent();
  return true;
}
const ROLE_LABEL = { admin: "관리자", leader: "팀장", member: "팀원", viewer: "뷰어" };
function roleLabel(role){ return ROLE_LABEL[role] || "팀원"; }
// 회원 구분 변경. 팀장 여부는 연결된 팀원 기록(members[].leader)에도 맞춰 둔다 —
// FTE 화면은 모든 회원이 앱 데이터만 보고 그리므로, 거기서 팀장을 가려낼 수 있어야 한다.
async function setProfileRole(id, role){
  const p = profilesCache.find(x => x.id === id);
  if(!p) return;
  const ok = await updateProfile(id, role === "viewer" ? { role, member_id: null } : { role });
  if(!ok) return;
  if(role !== "viewer" && p.member_id) setMemberLeader(p.member_id, role === "leader");
}
async function setProfileMember(id, memberId){
  const p = profilesCache.find(x => x.id === id);
  if(!p) return;
  const ok = await updateProfile(id, { member_id: memberId });
  if(ok && memberId && p.role === "leader") setMemberLeader(memberId, true);
}
function setMemberLeader(id, on){
  const m = state.members.find(x => x.id === id);
  if(!m || !!m.leader === on) { renderTabContent(); return; }
  if(on) m.leader = true; else delete m.leader;
  const count = state.assignments.filter(a => a.memberId === id).length;
  logActivity((on ? '팀장 지정: ' : '팀장 해제: ') + m.name);
  if(on && count > 0) showToast(m.name + '님의 기존 배정 ' + count + '건은 FTE 화면에서 숨겨져요 (삭제되지는 않아요)');
  scheduleSave();
  renderTabContent();
}
function addMember(){
  const input = document.getElementById("mem-name");
  const name = input.value.trim();
  if(!name) return;
  state.members.push({ id: uid("mem"), name });
  logActivity('팀원 추가: '+name);
  scheduleSave();
  renderTabContent();
}
function removeMember(id){
  const idx = state.members.findIndex(m => m.id === id);
  if(idx === -1) return;
  const removed = state.members[idx];
  const removedAssignments = state.assignments.filter(a => a.memberId === id);
  state.members.splice(idx, 1);
  state.assignments = state.assignments.filter(a => a.memberId !== id);
  logActivity('팀원 삭제: '+removed.name+(removedAssignments.length?' (배정 '+removedAssignments.length+'건 함께 삭제)':''));
  state.lastAction = {
    restore: () => {
      state.members.splice(idx, 0, removed);
      state.assignments = state.assignments.concat(removedAssignments);
    },
    undoMsg: '팀원 삭제 취소: '+removed.name,
  };
  showUndoToast('"'+removed.name+'" 팀원을 삭제했어요'+(removedAssignments.length?' (배정 '+removedAssignments.length+'건 포함)':''));
  scheduleSave();
  renderTabContent();
}
function updateMemberName(id, name){
  const m = state.members.find(x => x.id === id);
  const clean = name.trim();
  if(m && clean){ m.name = clean; scheduleSave(); }
  else { renderTabContent(); }
}

/* ---------------- Products (품목) ---------------- */
function renderProductsTab(){
  const lineCounts = { SC: 0, PC: 0, ETC: 0 };
  let noneCount = 0;
  state.products.forEach(p => {
    if(p.line && Object.prototype.hasOwnProperty.call(lineCounts, p.line)) lineCounts[p.line]++;
    else noneCount++;
  });
  let html = '<div class="stack">';
  html += '<div class="card" style="padding:14px 16px;">' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
      PRODUCT_LINE_ORDER.map(l =>
        '<span style="font-size:12.5px;font-weight:700;padding:5px 12px;border-radius:999px;background:'+LINE_META[l].color+'19;color:'+LINE_META[l].color+';white-space:nowrap;">' +
          esc(LINE_META[l].label)+' '+lineCounts[l]+'개' +
        '</span>'
      ).join("") +
      (noneCount > 0 ?
        '<span style="font-size:12.5px;font-weight:700;padding:5px 12px;border-radius:999px;background:#F1F5F9;color:#64748B;white-space:nowrap;">미지정 '+noneCount+'개</span>' : '') +
    '</div>' +
  '</div>';
  html += '<div class="card">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#475569;">품목 추가</div>' +
    '<div class="row" style="gap:8px;">' +
      '<input class="input" id="prod-name" placeholder="품목명 (예: 한타박스주)" style="flex:1;" onkeydown="if(event.key===\'Enter\')addProduct()"/>' +
      '<select class="input" id="prod-line" style="flex:0 0 130px;">' +
        PRODUCT_LINE_ORDER.map(l => '<option value="'+l+'">'+LINE_META[l].label+'</option>').join("") +
      '</select>' +
      '<button class="add-btn" style="flex:0 0 auto;" onclick="addProduct()">'+icon('plus',14)+' 추가</button>' +
    '</div>' +
  '</div>';
  const productSearch = (state.search.products || "").trim().toLowerCase();
  const filteredProducts = !productSearch ? state.products : state.products.filter(p => p.name.toLowerCase().includes(productSearch));

  html += '<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">' +
    '<div style="font-size:13px;font-weight:700;color:#475569;">품목 목록 ('+filteredProducts.length+(productSearch?' / '+state.products.length:'')+')</div>' +
    (state.products.length > 5 ?
      '<input class="input view-ok" placeholder="품목명 검색" value="'+esc(state.search.products)+'" ' +
      'onchange="setProductSearch(this.value)" onkeydown="if(event.key===\'Enter\')setProductSearch(this.value)" ' +
      'style="flex:0 1 200px;font-size:12.5px;padding:7px 10px;"/>' : '') +
  '</div>';
  if(state.products.length === 0){
    html += '<div class="empty">등록된 품목이 없어요.</div>';
  }else if(filteredProducts.length === 0){
    html += '<div class="empty">검색 결과가 없어요.</div>';
  }else{
    html += filteredProducts.map(p =>
      '<div class="list-row">' +
        '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">' +
          (p.line ? lineTagHtml(p.line) : '<span class="product-tag" style="color:#CBD5E1;">미지정</span>') +
          '<input class="input" value="'+esc(p.name)+'" onchange="updateProductName(\''+p.id+'\', this.value)" ' +
          'style="flex:1;min-width:100px;font-size:13.5px;font-weight:600;border-color:transparent;background:transparent;padding:6px 8px;" ' +
          'onfocus="this.style.borderColor=\'var(--border)\';this.style.background=\'#fff\';" ' +
          'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';"/>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<select onchange="updateProductLine(\''+p.id+'\', this.value)" style="padding:5px 7px;border-radius:6px;border:1px solid var(--border);font-size:12px;">' +
            '<option value=""'+(!p.line?" selected":"")+'>미지정</option>' +
            PRODUCT_LINE_ORDER.map(l => '<option value="'+l+'"'+(p.line===l?" selected":"")+'>'+l+'</option>').join("") +
          '</select>' +
          '<button class="icon-btn" onclick="removeProduct(\''+p.id+'\')">'+icon('trash',14)+'</button>' +
        '</div>' +
      '</div>'
    ).join("");
  }
  html += '</div></div>';
  return html;
}
function addProduct(){
  const input = document.getElementById("prod-name");
  const lineSel = document.getElementById("prod-line");
  const name = input.value.trim();
  if(!name) return;
  state.products.push({ id: uid("prod"), name, line: lineSel.value });
  logActivity('품목 추가: '+name);
  scheduleSave();
  renderTabContent();
}
function removeProduct(id){
  const idx = state.products.findIndex(p => p.id === id);
  if(idx === -1) return;
  const removed = state.products[idx];
  const affectedIds = state.assignments.filter(a => a.productId === id).map(a => a.id);
  state.products.splice(idx, 1);
  state.assignments.forEach(a => { if(a.productId === id) a.productId = null; });
  logActivity('품목 삭제: '+removed.name);
  state.lastAction = {
    restore: () => {
      state.products.splice(idx, 0, removed);
      state.assignments.forEach(a => { if(affectedIds.includes(a.id)) a.productId = id; });
    },
    undoMsg: '품목 삭제 취소: '+removed.name,
  };
  showUndoToast('"'+removed.name+'" 품목을 삭제했어요');
  scheduleSave();
  renderTabContent();
}
function updateProductName(id, name){
  const p = state.products.find(x => x.id === id);
  const clean = name.trim();
  if(p && clean){ p.name = clean; scheduleSave(); }
  else { renderTabContent(); }
}
function updateProductLine(id, val){
  const p = state.products.find(x => x.id === id);
  if(p){ p.line = val || null; scheduleSave(); renderTabContent(); }
}
function setProductSearch(v){ state.search.products = v; renderTabContentPreserveFocus(); }

/* ---------------- Task Types ---------------- */
function renderTypesTab(){
  let html = '<div class="stack">';
  html += '<div class="card">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:14px;color:#475569;">과제 유형 추가</div>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;">' +
      '<input class="input" id="tt-name" placeholder="유형명 (예: 임상연구자 자문)" style="flex:1 1 200px;"/>' +
      '<select class="input" id="tt-line" style="flex:0 0 190px;">' +
        LINE_ORDER.map(l => '<option value="'+l+'">'+LINE_META[l].label+'</option>').join("") +
      '</select>' +
      '<input class="input" id="tt-fte" type="number" step="0.01" min="0" placeholder="기본 FTE" style="flex:0 0 110px;"/>' +
      '<button class="add-btn" style="flex:0 0 auto;" onclick="addTaskType()">'+icon('plus',14)+' 추가</button>' +
    '</div>' +
  '</div>';
  const typeSearch = (state.search.types || "").trim().toLowerCase();
  const filteredTypes = !typeSearch ? state.taskTypes : state.taskTypes.filter(t => t.name.toLowerCase().includes(typeSearch));

  html += '<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">' +
    '<div style="font-size:13px;font-weight:700;color:#475569;">과제 유형 목록 ('+filteredTypes.length+(typeSearch?' / '+state.taskTypes.length:'')+')</div>' +
    (state.taskTypes.length > 5 ?
      '<input class="input view-ok" placeholder="유형명 검색" value="'+esc(state.search.types)+'" ' +
      'onchange="setTypeSearch(this.value)" onkeydown="if(event.key===\'Enter\')setTypeSearch(this.value)" ' +
      'style="flex:0 1 200px;font-size:12.5px;padding:7px 10px;"/>' : '') +
  '</div>';
  if(state.taskTypes.length === 0){
    html += '<div class="empty">등록된 과제 유형이 없어요.</div>';
  }else if(filteredTypes.length === 0){
    html += '<div class="empty">검색 결과가 없어요.</div>';
  }else{
    html += filteredTypes.map(t =>
      '<div class="list-row">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">' +
          lineTagHtml(t.line) +
          '<input class="input" value="'+esc(t.name)+'" onchange="updateTaskTypeName(\''+t.id+'\', this.value)" ' +
          'style="flex:1;min-width:120px;font-size:13.5px;font-weight:600;border-color:transparent;background:transparent;padding:6px 8px;" ' +
          'onfocus="this.style.borderColor=\'var(--border)\';this.style.background=\'#fff\';" ' +
          'onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';"/>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<select onchange="updateTaskTypeLine(\''+t.id+'\', this.value)" style="padding:5px 7px;border-radius:6px;border:1px solid var(--border);font-size:12px;">' +
            LINE_ORDER.map(l => '<option value="'+l+'"'+(t.line===l?" selected":"")+'>'+l+'</option>').join("") +
          '</select>' +
          '<span style="font-size:11.5px;color:#94A3B8;">기본 FTE</span>' +
          '<input type="number" step="0.01" min="0" value="'+t.fte+'" oninput="updateTaskTypeFte(\''+t.id+'\', this.value)" style="width:66px;padding:5px 7px;border-radius:6px;border:1px solid var(--border);font-size:12.5px;"/>' +
          '<button class="icon-btn" onclick="removeTaskType(\''+t.id+'\')">'+icon('trash',14)+'</button>' +
        '</div>' +
      '</div>'
    ).join("");
  }
  html += '</div></div>';
  return html;
}
function addTaskType(){
  const name = document.getElementById("tt-name").value.trim();
  const line = document.getElementById("tt-line").value;
  const fte = Number(document.getElementById("tt-fte").value);
  if(!name || !(fte > 0)) return;
  state.taskTypes.push({ id: uid("tt"), name, fte, line });
  logActivity('과제 유형 추가: '+name);
  scheduleSave();
  renderTabContent();
}
function updateTaskTypeLine(id, val){
  const t = state.taskTypes.find(x => x.id === id);
  if(t){ t.line = val; scheduleSave(); renderTabContent(); }
}
function setTypeSearch(v){ state.search.types = v; renderTabContentPreserveFocus(); }
function updateTaskTypeFte(id, val){
  const t = state.taskTypes.find(x => x.id === id);
  if(t){ t.fte = Number(val) || 0; scheduleSave(); }
}
function updateTaskTypeName(id, name){
  const t = state.taskTypes.find(x => x.id === id);
  const clean = name.trim();
  if(t && clean){ t.name = clean; scheduleSave(); }
  else { renderTabContent(); }
}
function removeTaskType(id){
  const idx = state.taskTypes.findIndex(t => t.id === id);
  if(idx === -1) return;
  const removed = state.taskTypes[idx];
  state.taskTypes.splice(idx, 1);
  logActivity('과제 유형 삭제: '+removed.name);
  state.lastAction = {
    restore: () => { state.taskTypes.splice(idx, 0, removed); },
    undoMsg: '과제 유형 삭제 취소: '+removed.name,
  };
  showUndoToast('"'+removed.name+'" 과제 유형을 삭제했어요');
  scheduleSave();
  renderTabContent();
}

/* ---------------- Monthly / Quarterly ---------------- */
function renderMonthlyTab(){
  if(fteMembers().length === 0){
    return '<div class="card"><div class="empty">아직 등록된 팀원이 없어요.</div></div>';
  }
  const year = state.monthly.year;
  const mode = state.monthly.mode; // "month" | "quarter" | "year3"
  const months = Array.from({length:12}, (_,i) => year+"-"+String(i+1).padStart(2,"0"));
  const quarters = [
    { label: "1분기", months: months.slice(0,3) },
    { label: "2분기", months: months.slice(3,6) },
    { label: "3분기", months: months.slice(6,9) },
    { label: "4분기", months: months.slice(9,12) },
  ];
  const year3 = [0,1,2].map(offset => {
    const y = year + offset;
    return { key: "y"+y, label: y+"년", months: Array.from({length:12}, (_,i) => y+"-"+String(i+1).padStart(2,"0")) };
  });

  const columns = mode === "month"
    ? months.map((p,i) => ({ key:p, label:(i+1)+"월" }))
    : mode === "quarter"
    ? quarters.map(q => ({ key:q.label, label:q.label, months:q.months }))
    : year3;

  function valueFor(memberId, col){
    if(mode === "month") return memberFteAt(memberId, col.key);
    const vals = col.months.map(p => memberFteAt(memberId, p));
    return vals.reduce((a,b)=>a+b,0) / vals.length;
  }

  const yearLabel = mode === "year3" ? (year+"년 ~ "+(year+2)+"년") : (year+"년");
  const modeBtn = (id, label) =>
    '<button class="view-ok" onclick="setMonthlyMode(\''+id+'\')" style="padding:7px 12px;border-radius:7px;border:1px solid '+
    (mode===id?"var(--accent)":"var(--border)")+';background:'+(mode===id?"var(--accent)":"#fff")+
    ';color:'+(mode===id?"#fff":"#475569")+';font-size:12.5px;font-weight:700;">'+label+'</button>';

  let footnote = "빨간색은 1.01 FTE 이상(초과)을 의미해요.";
  if(mode === "quarter") footnote = "분기 값은 해당 분기 3개월 FTE의 평균입니다. " + footnote;
  if(mode === "year3") footnote = "연도 값은 해당 연도 12개월 FTE의 평균입니다. 화살표로 연도 구간을 한 해씩 이동할 수 있어요. " + footnote;

  let html = '<div class="card" style="overflow-x:auto;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<button class="icon-round view-ok" onclick="shiftMonthlyYear(-1)">'+icon('chevronLeft',15)+'</button>' +
        '<span style="font-weight:800;font-size:15px;min-width:100px;text-align:center;">'+yearLabel+'</span>' +
        '<button class="icon-round view-ok" onclick="shiftMonthlyYear(1)">'+icon('chevronRight',15)+'</button>' +
      '</div>' +
      '<div style="display:flex;gap:4px;">' +
        modeBtn("month","월별") + modeBtn("quarter","분기별 (평균)") + modeBtn("year3","3개년 (연평균)") +
      '</div>' +
    '</div>' +
    '<table><thead><tr><th>팀원</th>' +
      columns.map(c => '<th>'+c.label+'</th>').join("") +
    '</tr></thead><tbody>';

  fteMembers().forEach(m => {
    html += '<tr><td class="name-cell">'+esc(m.name)+'</td>';
    columns.forEach(c => {
      const v = valueFor(m.id, c);
      const over = isOverCapacity(v);
      const color = over ? "var(--danger)" : (v===0 ? "#CBD5E1" : "var(--ink)");
      html += '<td style="color:'+color+';font-weight:'+(over?800:600)+';">'+(v===0?"–":fmt(v))+'</td>';
    });
    html += '</tr>';
  });

  html += '<tr style="background:#F1F5F9;">' +
    '<td class="name-cell" style="font-weight:800;background:#F1F5F9;">팀 합계</td>' +
    columns.map(c => {
      const total = fteMembers().reduce((sum,m) => sum + valueFor(m.id, c), 0);
      return '<td style="font-weight:800;color:var(--accent);">'+fmt(total)+'</td>';
    }).join("") +
  '</tr>';

  html += '</tbody></table>' +
    '<div style="margin-top:12px;font-size:11.5px;color:#94A3B8;">'+footnote+'</div>' +
  '</div>';
  return html;
}
function shiftMonthlyYear(delta){ state.monthly.year += delta; renderTabContent(); }
function setMonthlyMode(mode){ state.monthly.mode = mode; renderTabContent(); }

/* ---------------- Task Status (과제 진행 현황) ---------------- */
function renderStatusTab(){
  if(fteAssignments().length === 0){
    return '<div class="card"><div class="empty">아직 배정된 과제가 없어요. \'과제 배정\' 탭에서 먼저 과제를 배정해 주세요.</div></div>';
  }
  const map = taskTypeById();
  const pmap = productById();
  const basis = state.statusBasis || currentPeriod();

  const groups = {};
  STATUS_ORDER.forEach(s => groups[s] = []);
  // 공동배정/인수인계로 같은 과제에 여러 담당자 레코드가 있을 때, 기준월에 활성인 담당자가
  // 있다면 그 담당자만 대표로 보여주고 나머지(과거 종료 전 단계 등)는 중복 표시를 막는다.
  // 다만 그룹 전체에 기준월 기준 활성 레코드가 하나도 없는 과제(예: 다음 달 시작 예정,
  // 이미 기간이 지남)까지 통째로 숨기면 '과제 배정' 탭 건수와 어긋나므로, 그런 경우는
  // 그대로 표시한다.
  const groupHasActiveMember = {};
  fteAssignments().forEach(a => {
    if(isActive(a, basis)) groupHasActiveMember[a.groupId || a.id] = true;
  });
  fteAssignments().forEach(a => {
    const st = a.status || "준비중";
    const gid = a.groupId || a.id;
    if(st !== "종료" && st !== "중단" && !isActive(a, basis) && groupHasActiveMember[gid]) return;
    (groups[st] || groups["준비중"]).push(a);
  });

  let html = '<div class="stack">';

  html += '<div class="card">' +
    '<div class="row" style="align-items:flex-end;margin-bottom:14px;flex-wrap:wrap;">' +
      '<div style="flex:0 0 170px;"><div class="field-label">기준월</div>' +
        '<input type="month" class="input view-ok" value="'+basis+'" onchange="setStatusBasis(this.value)"/></div>' +
    '</div>' +
    '<div class="subtotal-grid">' +
    STATUS_ORDER.map(s => {
      const list = groups[s];
      const uniqueGroupCount = new Set(list.map(a => a.groupId || a.id)).size;
      const activeList = list.filter(a => isActive(a, basis));
      const totalFte = activeList.reduce((sum,a) => sum + fteForPeriod(a, basis), 0);
      const meta = STATUS_META[s];
      return '<div class="subtotal-item" style="background:'+meta.soft+';">' +
        '<div class="subtotal-label" style="color:'+meta.color+';">'+s+'</div>' +
        '<div class="subtotal-value">'+uniqueGroupCount+'건 <span class="subtotal-unit" style="font-size:15px;font-weight:800;color:'+meta.color+';">('+fmt(totalFte)+' FTE)</span></div>' +
      '</div>';
    }).join("") +
  '</div></div>';

  function renderStatusCard(s){
    const list = groups[s];
    const meta = STATUS_META[s];
    // 같은 상태 안에서 같은 과제(그룹)에 속한 레코드는 카드 하나로 합쳐서 보여준다.
    // (인수인계처럼 옛 담당자는 종료, 새 담당자는 진행중인 경우는 서로 다른 컬럼에 각각
    // 남아있는 게 맞으므로 상태가 다르면 합치지 않는다.)
    const seenGid = new Set();
    const cardGroups = [];
    list.forEach(a => {
      const gid = a.groupId || a.id;
      if(seenGid.has(gid)) return;
      seenGid.add(gid);
      const members = list.filter(x => (x.groupId || x.id) === gid);
      cardGroups.push({ primary: a, gid, members });
    });
    let out = '<div class="card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
        '<span style="font-weight:800;font-size:14px;color:'+meta.color+';">'+s+'</span>' +
        '<span style="font-size:11.5px;color:#94A3B8;">'+cardGroups.length+'건</span>' +
      '</div>';
    if(cardGroups.length === 0){
      out += '<div class="empty" style="padding:20px 8px;">해당 상태의 과제가 없어요.</div>';
    }else{
      out += cardGroups.map(g => {
        const primary = g.primary;
        const t = map[primary.taskTypeId];
        const p = pmap[primary.productId];
        return '<div style="padding:10px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px;">' +
            lineTagHtml(t ? t.line : null) +
            (p?'<span class="product-tag">'+esc(p.name)+'</span>':'') +
            (g.members.length > 1 ? '<span style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--msl-soft);color:var(--msl);white-space:nowrap;">공동배정 '+g.members.length+'명</span>' : '') +
            coAssignBtnHtml(primary) +
          '</div>' +
          '<div style="font-weight:700;font-size:13.5px;margin-bottom:3px;">'+esc(primary.taskName)+'</div>' +
          '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:8px;">'+(t?esc(t.name):"삭제된 유형")+'</div>' +
          g.members.map(a => {
            const m = state.members.find(x => x.id === a.memberId);
            const activeNow = isActive(a, basis);
            const adjFte = activeNow ? fteForPeriod(a, basis) : 0;
            const hasAdjustment = activeNow && adjFte !== a.fte;
            return '<div style="padding:8px;background:#fff;border-radius:7px;margin-bottom:6px;">' +
              '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px;">' +
                '<span style="font-weight:600;font-size:12.5px;">'+(m?esc(m.name):"삭제된 팀원")+'</span>' +
                '<span style="font-weight:800;color:#16A34A;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto;" ' +
                  'title="'+(activeNow?periodLabel(basis)+' 적용 FTE'+(hasAdjustment?' (월별 조정 반영, 기본 '+fmt(a.fte)+')':''):periodLabel(basis)+' 기준 배정 종료(비활성) — 기본 FTE는 '+fmt(a.fte)+'')+'">' +
                  periodLabel(basis)+' '+fmt(adjFte)+' FTE' +
                '</span>' +
              '</div>' +
              '<div style="font-size:11px;color:#94A3B8;margin-bottom:6px;">'+a.startPeriod+'~'+(a.endPeriod||"진행중")+'</div>' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                statusSelectHtml(a) +
                fteEditInputHtml(a) +
                overrideToggleBtnHtml(a) +
                periodToggleBtnHtml(a) +
              '</div>' +
              overridePanelHtml(a) +
              periodPanelHtml(a) +
            '</div>';
          }).join("") +
        '</div>';
      }).join("");
    }
    out += '</div>';
    return out;
  }

  html += '<div class="stack" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:14px;align-items:flex-start;">' +
    '<div style="flex:1 1 280px;min-width:260px;">'+renderStatusCard("준비중")+'</div>' +
    '<div style="flex:1 1 280px;min-width:260px;">'+renderStatusCard("진행중")+'</div>' +
    '<div style="flex:1 1 280px;min-width:260px;display:flex;flex-direction:column;gap:14px;">' +
      renderStatusCard("종료") + renderStatusCard("보류") + renderStatusCard("중단") +
    '</div>' +
  '</div>';

  html += '</div>';
  return html;
}
function setStatusBasis(v){ state.statusBasis = v; renderTabContent(); }

/* ---------------- CTMS (기존 배정 과제와 연동한 임상 진행 트래커) ---------------- */
// 기록은 state.ctms[gid]에 저장한다. gid = 공동배정 그룹이면 groupId, 아니면 배정 id.
// (첫 공동배정 시 groupId가 원래 배정 id로 정해지므로 gid는 바뀌지 않는다.)
const CTMS_STAGES = [
  { key: "protocol", label: "프로토콜 확정" },
  { key: "irb", label: "IRB·심의 승인" },
  { key: "contract", label: "계약 체결" },
  { key: "siv", label: "기관 개시(SIV)" },
  { key: "fpi", label: "첫 피험자 등록(FPI)" },
  { key: "lpi", label: "등록 완료(LPI)" },
  { key: "lplv", label: "마지막 방문(LPLV)" },
  { key: "dbl", label: "DB Lock" },
  { key: "csr", label: "최종보고서(CSR)" },
];
// 과제 유형에 따른 마일스톤 기본값. RMP의 연차 단계는 '품목 허가' 실적월을 기준으로
// 계획월을 자동 계산해서 채워준다(허가일+N개월). auto 값이 그 개월 수이고, 라벨에는
// 계산 방식을 굳이 표시하지 않는다 — 필요하면 계획월 입력칸에 마우스를 올려 확인할 수 있고,
// 다른 마일스톤처럼 자유롭게 고치거나 지울 수 있다.
const CTMS_STAGE_PRESETS = {
  MKT: [
    { key: "rrc", label: "RRC 승인" },
    { key: "irb1", label: "1st IRB 승인" },
    { key: "site1", label: "1st site 개시" },
    { key: "fpi", label: "FPI" },
    { key: "lpi", label: "LPI" },
    { key: "lpo", label: "LPO" },
    { key: "dbl", label: "DB Lock" },
    { key: "csr", label: "CSR" },
  ],
  RMP: [
    { key: "approval", label: "품목 허가" },
    { key: "rrc", label: "RRC 승인" },
    { key: "fpi", label: "FPI" },
    { key: "lpi", label: "LPI" },
    { key: "lpo", label: "LPO" },
    { key: "y1_1", label: "1-1년차", auto: 8 },
    { key: "y1_2", label: "1-2년차", auto: 14 },
    { key: "y2_1", label: "2-1년차", auto: 20 },
    { key: "y2_2", label: "2-2년차", auto: 26 },
    { key: "y3", label: "3년차", auto: 38 },
    { key: "y4", label: "4년차", auto: 50 },
    { key: "y5", label: "5년차", auto: 62 },
    { key: "resubmit", label: "재심사 제출", auto: 75 },
    { key: "resubmit_approval", label: "재심사 승인" },
  ],
  IIT: [
    { key: "proposal", label: "제안서 접수" },
    { key: "rrc", label: "RRC 승인" },
    { key: "contract", label: "계약 체결" },
    { key: "irb", label: "IRB 승인" },
    { key: "fpi", label: "FPI" },
    { key: "lpi", label: "LPI" },
    { key: "lpo", label: "LPO" },
    { key: "csr", label: "CSR" },
    { key: "publication", label: "Publication" },
  ],
  PKPDBE: [
    { key: "ib", label: "IB 개발" },
    { key: "ind", label: "IND 승인" },
    { key: "irb", label: "IRB 승인" },
    { key: "start", label: "개시" },
    { key: "fpi", label: "FPI" },
    { key: "period1", label: "1기 투약" },
    { key: "period2", label: "2기 투약" },
    { key: "lpo", label: "LPO" },
    { key: "csr", label: "CSR" },
  ],
};
function ctmsAddMonths(ym, n){
  const parts = String(ym || "").split("-");
  if(parts.length !== 2) return "";
  const y = Number(parts[0]), m = Number(parts[1]);
  if(!y || !m) return "";
  const total = y * 12 + (m - 1) + n;
  return Math.floor(total / 12) + "-" + String((total % 12) + 1).padStart(2, "0");
}
function ctmsPresetKeyForTaskType(t){
  const n = (t && t.name) || "";
  if(n.includes("IIT")) return "IIT";
  if(n.includes("비중재연구") && n.includes("MKT")) return "MKT";
  if(n.includes("비중재연구") && n.includes("RMP")) return "RMP";
  if(n.includes("PK") || n.includes("PD") || (n.includes("BE") && !n.includes("비중재"))) return "PKPDBE";
  return null;
}
function ctmsDefaultStagesFor(gid){
  const g = ctmsAllGroups().find(x => x.gid === gid);
  const t = g ? taskTypeById()[g.primary.taskTypeId] : null;
  const presetKey = ctmsPresetKeyForTaskType(t);
  const preset = presetKey ? CTMS_STAGE_PRESETS[presetKey] : CTMS_STAGES;
  return preset.map(x => Object.assign({ key: x.key, label: x.label }, typeof x.auto === "number" ? { auto: x.auto } : {}));
}
const CTMS_HEALTH = {
  "지연": { color: "#B91C1C", soft: "#FDECEC", rank: 0 },
  "정상": { color: "#1F6F78", soft: "#E5F1F1", rank: 1 },
  "미시작": { color: "#64748B", soft: "#EEF2F6", rank: 2 },
  "완료": { color: "#16A34A", soft: "#E7F6EC", rank: 3 },
};
const CTMS_NUM_FIELDS = ["siteTarget", "siteActive", "subjTarget", "subjEnrolled", "subjCompleted"];

/* ---------------- CTMS 접근 (로그인한 계정 기준) ----------------
   - 관리자: 전체 과제를 보고 편집
   - 팀원과 연결된 회원: 본인 담당 과제만 보이고, 그 과제의 진행 트래커·진행/이슈·비용을 입력
     (서버의 save_ctms 함수가 본인 담당 과제인지 다시 확인한다)
   - 팀원과 연결되지 않은 회원: 전체 조회(읽기 전용) */
function ctmsAutoAuth(){
  if(isAdmin()) return { mode: "admin", ownerId: null };
  const mid = currentProfile && currentProfile.member_id;
  if(mid && state.members.some(m => m.id === mid)) return { mode: "owner", ownerId: mid };
  return { mode: "viewall", ownerId: null };
}
function ctmsAuthOwnerId(){ return state.ctmsAuth && state.ctmsAuth.mode === "owner" ? state.ctmsAuth.ownerId : null; }
function ctmsCanEdit(gid){
  if(isAdmin()) return true;
  const o = ctmsAuthOwnerId();
  return !!o && state.assignments.some(a => ctmsGid(a) === gid && a.memberId === o);
}
function ctmsScopeGroups(){
  let groups = ctmsGroups();
  const o = ctmsAuthOwnerId();
  if(o){
    const openOnly = state.ctmsUi.scope !== "all";
    groups = groups.filter(g => g.members.some(m => m.memberId === o && (!openOnly || (m.status !== "종료" && m.status !== "중단"))));
  }
  return groups;
}
function ctmsMemberSelectHtml(){
  if(ctmsAuthOwnerId()) return "";
  const ui = state.ctmsUi;
  return '<select class="input view-ok" onchange="ctmsSetFilter(\'member\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
    '<option value="전체">담당자 전체</option>' +
    state.members.map(m => '<option value="' + m.id + '"' + (ui.member === m.id ? " selected" : "") + '>' + esc(m.name) + '</option>').join("") +
  '</select>';
}
function ctmsSyncEditMode(){
  if(state.tab === "ctms" && !state.ctmsAuth) state.ctmsAuth = ctmsAutoAuth();
  document.body.classList.toggle("ctms-edit", state.tab === "ctms" && !isAdmin() && !!ctmsAuthOwnerId());
}
function ctmsAuthBarHtml(){
  const a = state.ctmsAuth;
  let who;
  if(a.mode === "owner"){
    const m = state.members.find(x => x.id === a.ownerId);
    who = '<b>' + esc(m ? m.name : "삭제된 팀원") + '</b> 담당자 · 담당 과제만 표시 · 입력 가능';
  }else if(a.mode === "admin") who = '<b>관리자</b> · 전체 과제 · 입력 가능';
  else who = '<b>전체 조회</b> · 읽기 전용 (관리자가 계정에 팀원을 연결하면 본인 과제를 입력할 수 있어요)';
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:9px 12px;background:#E5F1F1;border-radius:9px;margin-bottom:12px;font-size:12.5px;color:#1F6F78;">' +
    '<span>' + who + '</span></div>';
}

/* 담당자(회원)가 수정한 내용의 저장: 화면에 불러와 둔 전체 데이터를 그대로 덮어쓰면 그사이 관리자가
   바꾼 배정·팀원 정보가 사라질 수 있으므로, 서버 함수 save_ctms가 최신본에 '내가 수정한 과제의
   CTMS 기록'만 합쳐서 저장한다. (관리자는 기존 자동저장을 그대로 사용) */
let ctmsOwnerTimer = null, ctmsOwnerSaving = false;
function ctmsPersist(gid){
  if(isAdmin()){ scheduleSave(); return; }
  if(!ctmsAuthOwnerId() || !gid) return;
  state.ctmsTouched[gid] = true;
  state.dirty = true;
  renderHeader();
  if(ctmsOwnerTimer) clearTimeout(ctmsOwnerTimer);
  ctmsOwnerTimer = setTimeout(ctmsOwnerSaveNow, 400);
}
async function ctmsOwnerSaveNow(){
  if(ctmsOwnerTimer){ clearTimeout(ctmsOwnerTimer); ctmsOwnerTimer = null; }
  const gids = Object.keys(state.ctmsTouched);
  if(gids.length === 0 || ctmsOwnerSaving) return;
  ctmsOwnerSaving = true;
  try{
    // 수정한 과제(gid)의 기록만 보낸다. 지워진 기록은 빠진 채로 보내면 서버에서도 지운다.
    const pick = (obj) => { const out = {}; gids.forEach(gid => { if(obj[gid] !== undefined) out[gid] = obj[gid]; }); return out; };
    const { error } = await sb.rpc("save_ctms", {
      p_gids: gids, p_ctms: pick(state.ctms), p_issues: pick(state.ctmsIssues), p_cost: pick(state.ctmsCost),
      p_log: state.activityLog || [],
    });
    if(error) throw error;
    gids.forEach(g => { delete state.ctmsTouched[g]; });
    state.saveError = false;
    state.saveErrorReason = null;
    state.lastSaved = new Date();
    state.dirty = Object.keys(state.ctmsTouched).length > 0;
  }catch(e){
    state.saveError = true;
    state.saveErrorReason = describeStorageError(e);
    showToast(state.saveErrorReason || "CTMS 저장에 실패했어요. 잠시 후 다시 시도해 주세요.", { error: true });
  }finally{
    ctmsOwnerSaving = false;
  }
  renderHeader();
  if(!state.saveError && Object.keys(state.ctmsTouched).length > 0) ctmsOwnerTimer = setTimeout(ctmsOwnerSaveNow, 400); // 저장 중에 생긴 변경 이어서 저장
}

function ctmsGid(a){ return a.groupId || a.id; }
function ctmsGroups(){ return ctmsAllGroups().filter(g => !state.ctmsExcluded[g.gid]); }
function ctmsAllGroups(){
  const seen = {};
  const out = [];
  state.assignments.forEach(a => {
    const gid = ctmsGid(a);
    if(seen[gid]) return;
    seen[gid] = true;
    const members = state.assignments.filter(x => ctmsGid(x) === gid);
    const now = currentPeriod();
    const live = members.filter(m => m.status !== "종료" && m.status !== "중단");
    const primary = live.find(m => isActive(m, now)) || live[0] || members[0];
    out.push({ gid, members, primary, status: primary.status || "준비중", rec: state.ctms[gid] || null });
  });
  return out;
}
function ctmsIsOpen(g){ return g.status !== "종료" && g.status !== "중단"; }
// 마일스톤 목록은 과제별로 다를 수 있다. rec.stages가 없으면 기본 9단계를 그대로 쓰고,
// 처음 추가/삭제/이름 수정할 때 기본 단계를 복사해서 그 과제만의 목록으로 바꾼다.
function ctmsStagesOf(rec){ return Array.isArray(rec.stages) ? rec.stages : CTMS_STAGES; }
function ctmsEnsureStages(rec){
  if(!Array.isArray(rec.stages)) rec.stages = CTMS_STAGES.map(x => ({ key: x.key, label: x.label }));
  return rec.stages;
}
function ctmsSummary(rec){
  const now = currentPeriod();
  let done = 0, hasPlan = false, next = null;
  const overdue = [];
  const stages = ctmsStagesOf(rec);
  stages.forEach(st => {
    const m = (rec.milestones || {})[st.key] || {};
    if(m.plan) hasPlan = true;
    if(m.actual){ done++; return; }
    if(m.plan && m.plan < now) overdue.push(st);
    if(!next) next = { stage: st, plan: m.plan || "" };
  });
  let health;
  if(stages.length === 0) health = "미시작";
  else if(done === stages.length) health = "완료";
  else if(overdue.length > 0) health = "지연";
  else if(done === 0 && !hasPlan) health = "미시작";
  else health = "정상";
  return { done, total: stages.length, overdue, next, health };
}
function ctmsDelayedTasks(){
  return ctmsGroups()
    .filter(g => g.rec && ctmsIsOpen(g))
    .map(g => ({ g, s: ctmsSummary(g.rec) }))
    .filter(x => x.s.health === "지연");
}
function ctmsPct(n, d){ return d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0; }
function ctmsBarHtml(pct, color){
  return '<div style="height:6px;background:#EEF2F6;border-radius:999px;overflow:hidden;">' +
    '<div style="height:100%;width:'+pct+'%;background:'+color+';"></div></div>';
}
function ctmsHealthBadge(h){
  const m = CTMS_HEALTH[h];
  return '<span style="font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;white-space:nowrap;background:'+m.soft+';color:'+m.color+';">'+h+'</span>';
}

/* --- edit actions (관리자 전용; 뷰어는 CSS로 입력이 막혀 있고, 여기서도 한 번 더 막는다) --- */
function ctmsStart(gid){
  if(!ctmsCanEdit(gid)) return;
  const g = ctmsAllGroups().find(x => x.gid === gid);
  if(!g || state.ctms[gid]) return;
  state.ctms[gid] = { protocolNo: "", siteTarget: null, siteActive: null, subjTarget: null, subjEnrolled: null, subjCompleted: null, milestones: {}, note: "", stages: ctmsDefaultStagesFor(gid) };
  state.ctmsUi.open[gid] = true;
  logActivity('CTMS 추적 시작: "'+g.primary.taskName+'"');
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsToggle(gid){
  state.ctmsUi.open[gid] = !state.ctmsUi.open[gid];
  renderTabContent();
}
function ctmsSetFilter(key, val){
  state.ctmsUi[key] = val;
  renderTabContent();
}
function ctmsSetField(gid, field, val){
  if(!ctmsCanEdit(gid)) return;
  const rec = state.ctms[gid];
  if(!rec) return;
  if(CTMS_NUM_FIELDS.indexOf(field) >= 0){
    const n = val === "" ? null : Math.floor(Number(val));
    rec[field] = (n === null || isNaN(n) || n < 0) ? null : n;
  }else{
    rec[field] = String(val || "").trim();
  }
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsSetMilestone(gid, key, kind, val){
  if(!ctmsCanEdit(gid)) return;
  const rec = state.ctms[gid];
  if(!rec) return;
  if(!rec.milestones) rec.milestones = {};
  const m = rec.milestones[key] || (rec.milestones[key] = {});
  const prev = m[kind];
  m[kind] = val || "";
  if(kind === "actual" && val && !prev){
    const g = ctmsAllGroups().find(x => x.gid === gid);
    const st = ctmsStagesOf(rec).find(x => x.key === key);
    logActivity('CTMS 마일스톤 완료: "'+(g ? g.primary.taskName : "")+'" - '+(st ? st.label : key)+' ('+val+')');
  }
  // RMP: '품목 허가' 실적월이 입력/변경되면, 허가일 기준으로 계획월이 자동 계산되는
  // 연차·재심사 단계들의 계획월을 다시 채운다(직접 입력한 값도 그대로 덮어써도 되도록
  // 허가일이 바뀔 때만 일어나는 일이라 자연스럽다).
  if(kind === "actual" && val && key === "approval"){
    ctmsStagesOf(rec).forEach(st => {
      if(typeof st.auto !== "number") return;
      const mm = rec.milestones[st.key] || (rec.milestones[st.key] = {});
      mm.plan = ctmsAddMonths(val, st.auto);
    });
  }
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsAddStage(gid){
  if(!ctmsCanEdit(gid)) return;
  const rec = state.ctms[gid];
  const input = document.getElementById("ctms-newms-" + gid);
  if(!rec || !input) return;
  const label = input.value.trim();
  if(!label) return;
  ctmsEnsureStages(rec).push({ key: uid("ms"), label });
  logActivity('CTMS 마일스톤 추가: "' + ctmsGroupName(gid) + '" - ' + label);
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsRenameStage(gid, key, val){
  if(!ctmsCanEdit(gid)) return;
  const rec = state.ctms[gid];
  if(!rec) return;
  const label = String(val || "").trim();
  const cur = ctmsStagesOf(rec).find(x => x.key === key);
  if(!cur || !label || label === cur.label){ renderTabContent(); return; } // 비우면 원래 이름 유지
  const st = ctmsEnsureStages(rec).find(x => x.key === key);
  logActivity('CTMS 마일스톤 이름 변경: "' + ctmsGroupName(gid) + '" - ' + st.label + ' → ' + label);
  st.label = label;
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsDeleteStage(gid, key){
  if(!ctmsCanEdit(gid)) return;
  const rec = state.ctms[gid];
  if(!rec) return;
  const stages = ctmsEnsureStages(rec);
  const idx = stages.findIndex(x => x.key === key);
  if(idx < 0) return;
  const removed = stages[idx];
  const removedData = rec.milestones && rec.milestones[key] ? rec.milestones[key] : null;
  stages.splice(idx, 1);
  if(rec.milestones) delete rec.milestones[key];
  logActivity('CTMS 마일스톤 삭제: "' + ctmsGroupName(gid) + '" - ' + removed.label);
  state.lastAction = {
    gid,
    restore: () => {
      const r = state.ctms[gid]; if(!r) return;
      const list = ctmsEnsureStages(r);
      list.splice(Math.min(idx, list.length), 0, removed);
      if(removedData){ if(!r.milestones) r.milestones = {}; r.milestones[key] = removedData; }
    },
    undoMsg: 'CTMS 마일스톤 삭제 취소: "' + ctmsGroupName(gid) + '" - ' + removed.label,
  };
  showUndoToast('"' + removed.label + '" 마일스톤을 삭제했어요');
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsExcludeConfirm(gid){
  if(!isAdmin()) return;
  const g = ctmsAllGroups().find(x => x.gid === gid);
  if(!g) return;
  const hasData = !!state.ctms[gid] || (state.ctmsIssues[gid] || []).length > 0 || (state.ctmsCost[gid] || []).length > 0;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">CTMS 목록에서 삭제</div>' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">' + esc(g.primary.taskName) + '</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;">CTMS에 해당하지 않는 과제라면 이 목록에서 삭제해요. <b>배정(FTE) 데이터는 그대로</b> 남고, CTMS의 트래커·진행/이슈·비용 화면에서만 사라져요.' +
      (hasData ? '<br/>이미 입력된 CTMS 기록은 지우지 않고 보관해 둬서, 나중에 복원하면 다시 보여요.' : '') + '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#B91C1C;" onclick="ctmsExclude(\'' + gid + '\')">삭제</button>' +
    '</div>');
}
function ctmsExclude(gid){
  if(!isAdmin()) return;
  const g = ctmsAllGroups().find(x => x.gid === gid);
  if(!g || state.ctmsExcluded[gid]) { closeModal(); return; }
  state.ctmsExcluded[gid] = true;
  logActivity('CTMS 목록에서 삭제: "' + g.primary.taskName + '"');
  state.lastAction = {
    gid,
    restore: () => { delete state.ctmsExcluded[gid]; },
    undoMsg: 'CTMS 목록 삭제 취소: "' + g.primary.taskName + '"',
  };
  showUndoToast('"' + g.primary.taskName + '"을(를) CTMS 목록에서 삭제했어요');
  closeModal();
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsRestore(gid){
  if(!isAdmin()) return;
  const g = ctmsAllGroups().find(x => x.gid === gid);
  if(!state.ctmsExcluded[gid]) return;
  delete state.ctmsExcluded[gid];
  logActivity('CTMS 목록에 복원: "' + (g ? g.primary.taskName : "") + '"');
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsToggleExcluded(){ state.ctmsUi.excludedOpen = !state.ctmsUi.excludedOpen; renderTabContent(); }
function ctmsExcludedListHtml(){
  if(!isAdmin()) return "";
  const list = ctmsAllGroups().filter(g => state.ctmsExcluded[g.gid]);
  if(list.length === 0) return "";
  const open = !!state.ctmsUi.excludedOpen;
  return '<div class="card" style="padding:14px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" onclick="ctmsToggleExcluded()">' +
      '<span style="font-size:13px;font-weight:700;color:#64748B;">CTMS에서 삭제한 과제 (' + list.length + ')</span>' +
      '<span style="color:#94A3B8;font-size:12px;">' + (open ? "▾" : "▸") + '</span></div>' +
    (open ? '<div style="margin-top:10px;">' + list.map(g =>
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;background:#F8FAFC;border-radius:7px;margin-bottom:5px;">' +
        '<div style="min-width:0;font-size:12.5px;"><b>' + esc(g.primary.taskName) + '</b><span style="color:#94A3B8;"> · ' + esc(ctmsNamesOf(g).join(", ")) + '</span></div>' +
        '<button class="add-btn" style="flex:0 0 auto;padding:5px 11px;font-size:12px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="ctmsRestore(\'' + g.gid + '\')">복원</button></div>').join("") + '</div>' : '') +
  '</div>';
}
function ctmsStop(gid){
  if(!ctmsCanEdit(gid)) return;
  const removed = state.ctms[gid];
  if(!removed) return;
  const g = ctmsAllGroups().find(x => x.gid === gid);
  const name = g ? g.primary.taskName : "";
  delete state.ctms[gid];
  logActivity('CTMS 추적 해제: "'+name+'"');
  state.lastAction = {
    gid,
    restore: () => { state.ctms[gid] = removed; },
    undoMsg: 'CTMS 추적 해제 취소: "'+name+'"',
  };
  showUndoToast('"'+name+'"의 CTMS 추적을 해제했어요');
  ctmsPersist(gid);
  renderTabContent();
}

/* --- rendering --- */
function ctmsNumInput(gid, field, val, ph){
  return '<input type="number" min="0" step="1" class="input" placeholder="'+ph+'" value="'+(val === null || val === undefined ? "" : val)+'" ' +
    'onchange="ctmsSetField(\''+gid+'\',\''+field+'\',this.value)" style="font-size:12px;padding:6px 8px;"/>';
}
function ctmsLabeled(label, inner, basis){
  return '<div style="flex:'+(basis || "1 1 90px")+';min-width:0;"><div style="font-size:10.5px;color:#94A3B8;margin-bottom:3px;">'+label+'</div>'+inner+'</div>';
}
function ctmsMilestoneRowsHtml(g){
  const gid = g.gid, rec = g.rec, now = currentPeriod();
  const stages = ctmsStagesOf(rec);
  const rows = stages.map(st => {
    const m = (rec.milestones || {})[st.key] || {};
    let badge;
    if(m.actual) badge = '<span style="font-size:10.5px;font-weight:800;color:#16A34A;">완료</span>';
    else if(m.plan && m.plan < now) badge = '<span style="font-size:10.5px;font-weight:800;color:#B91C1C;">지연</span>';
    else if(m.plan) badge = '<span style="font-size:10.5px;font-weight:700;color:#94A3B8;">예정</span>';
    else badge = '<span style="font-size:10.5px;color:#CBD5E1;">–</span>';
    return '<div style="display:flex;align-items:flex-end;gap:6px;flex-wrap:wrap;padding:6px 8px;background:#fff;border-radius:7px;margin-bottom:5px;">' +
      '<input class="input" value="'+esc(st.label)+'" onchange="ctmsRenameStage(\''+gid+'\',\''+st.key+'\',this.value)" title="이름 수정" style="flex:1 1 130px;min-width:0;align-self:center;font-size:13px;font-weight:600;padding:5px 6px;border-color:transparent;background:transparent;" onfocus="this.style.borderColor=\'var(--border)\';this.style.background=\'#fff\';" onblur="this.style.borderColor=\'transparent\';this.style.background=\'transparent\';"/>' +
      ctmsLabeled("계획", '<input type="month" class="input" value="'+(m.plan || "")+'" onchange="ctmsSetMilestone(\''+gid+'\',\''+st.key+'\',\'plan\',this.value)" '+(typeof st.auto === "number" ? 'title="\'품목 허가\' 실적월 기준 자동 계산됨(직접 수정 가능)"' : '')+' style="font-size:12px;padding:5px 6px;"/>', "1 1 110px") +
      ctmsLabeled("실적", '<input type="month" class="input" value="'+(m.actual || "")+'" onchange="ctmsSetMilestone(\''+gid+'\',\''+st.key+'\',\'actual\',this.value)" style="font-size:12px;padding:5px 6px;"/>', "1 1 110px") +
      '<div style="flex:0 0 34px;text-align:right;align-self:center;">'+badge+'</div>' +
      '<button class="icon-btn" title="마일스톤 삭제" onclick="ctmsDeleteStage(\''+gid+'\',\''+st.key+'\')" style="align-self:center;">'+icon('trash',14)+'</button>' +
    '</div>';
  }).join("");
  const addRow = '<div style="display:flex;gap:6px;margin-top:6px;">' +
    '<input id="ctms-newms-'+gid+'" class="input" placeholder="마일스톤 이름 (예: 연차보고, 중간분석)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();ctmsAddStage(\''+gid+'\');}" style="flex:1;font-size:13px;padding:7px 8px;"/>' +
    '<button class="add-btn" style="flex:0 0 auto;padding:7px 12px;font-size:12px;" onclick="ctmsAddStage(\''+gid+'\')">'+icon('plus',13)+' 추가</button></div>';
  return (stages.length ? rows : '<div style="font-size:12px;color:#94A3B8;padding:4px 2px;">등록된 마일스톤이 없어요. 아래에서 추가해 주세요.</div>') + addRow;
}
function ctmsCardHtml(g){
  const map = taskTypeById(), pmap = productById();
  const p = g.primary;
  const t = map[p.taskTypeId];
  const prod = pmap[p.productId];
  const now = currentPeriod();
  const names = ctmsNamesOf(g);
  const activeNow = g.members.filter(m => isActive(m, now));
  const starts = g.members.map(m => m.startPeriod).filter(Boolean).sort();
  const hasOpenEnd = g.members.some(m => !m.endPeriod);
  const ends = g.members.map(m => m.endPeriod).filter(Boolean).sort();
  const periodText = (starts[0] || "?") + "~" + (hasOpenEnd ? "진행중" : (ends[ends.length - 1] || "?"));
  const curFte = g.members.filter(m => isActive(m, now)).reduce((s, m) => s + fteForPeriod(m, now), 0);
  const stMeta = STATUS_META[g.status] || STATUS_META["준비중"];
  const nameLine = lineTagHtml(t ? t.line : null) +
    (prod ? '<span class="product-tag">'+esc(prod.name)+'</span>' : '') +
    '<span style="font-weight:700;font-size:13.5px;">'+esc(p.taskName)+'</span>' +
    (activeNow.length > 1 ? '<span style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--msl-soft);color:var(--msl);white-space:nowrap;">공동/인수인계 '+activeNow.length+'명</span>' : '');
  const metaLine = '<div style="font-size:11.5px;color:#94A3B8;margin-top:4px;line-height:1.5;">' +
    esc(names.join(", ")) + ' · ' + periodText + ' · 현재 투입 ' +
    '<b style="color:#16A34A;">'+fmt(curFte)+' FTE</b> · ' +
    '<span style="font-weight:700;color:'+stMeta.color+';">'+g.status+'</span>' +
  '</div>';

  if(!g.rec){
    return '<div class="card" style="padding:14px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
        '<div style="min-width:0;flex:1 1 220px;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'+nameLine+'</div>' + metaLine +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex:0 0 auto;">' +
          (isAdmin() ? '<button class="add-btn" style="padding:7px 10px;font-size:12px;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;" onclick="ctmsExcludeConfirm(\''+g.gid+'\')" title="CTMS에 해당하지 않는 과제를 이 목록에서 삭제">'+icon('trash',13)+' 삭제</button>' : '') +
          '<button class="add-btn" style="padding:7px 12px;font-size:12px;" onclick="ctmsStart(\''+g.gid+'\')">'+icon('plus',13)+' CTMS 추적 시작</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  const s = ctmsSummary(g.rec);
  const rec = g.rec;
  const open = !!state.ctmsUi.open[g.gid];
  const subjPct = ctmsPct(rec.subjEnrolled || 0, rec.subjTarget || 0);
  const sitePct = ctmsPct(rec.siteActive || 0, rec.siteTarget || 0);
  const msPct = ctmsPct(s.done, s.total);
  const nextText = s.total === 0 ? "마일스톤 없음 (펼쳐서 추가)" : (s.health === "완료" ? "모든 단계 완료" :
    ('다음: '+s.next.stage.label+(s.next.plan ? ' ('+s.next.plan+')' : ' (계획 미입력)')));
  const overdueText = s.overdue.length > 0 ? ' · <b style="color:#B91C1C;">지연 '+s.overdue.length+'단계</b>' : '';

  const summaryHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">' +
    '<div style="flex:1 1 150px;min-width:0;"><div style="font-size:11px;color:#64748B;margin-bottom:4px;">마일스톤 <b>'+s.done+'/'+s.total+'</b>'+overdueText+'</div>' +
      ctmsBarHtml(msPct, CTMS_HEALTH[s.health].color) + '<div style="font-size:11px;color:#94A3B8;margin-top:4px;">'+esc(nextText)+'</div></div>' +
    '<div style="flex:1 1 130px;min-width:0;"><div style="font-size:11px;color:#64748B;margin-bottom:4px;">피험자 <b>'+(rec.subjEnrolled || 0)+'/'+(rec.subjTarget || 0)+'</b>'+(rec.subjTarget ? ' ('+subjPct+'%)' : '')+'</div>' +
      ctmsBarHtml(subjPct, "#3E6FB0") + '</div>' +
    '<div style="flex:1 1 110px;min-width:0;"><div style="font-size:11px;color:#64748B;margin-bottom:4px;">기관 개시 <b>'+(rec.siteActive || 0)+'/'+(rec.siteTarget || 0)+'</b></div>' +
      ctmsBarHtml(sitePct, "#7C5CBF") + '</div>' +
  '</div>';

  let detail = '';
  if(open){
    detail = '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        ctmsLabeled("프로토콜·과제 번호", '<input class="input" value="'+esc(rec.protocolNo || "")+'" onchange="ctmsSetField(\''+g.gid+'\',\'protocolNo\',this.value)" placeholder="예: GC-XXXX-001" style="font-size:12px;padding:6px 8px;"/>', "1 1 200px") +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        ctmsLabeled("기관 수 (계획)", ctmsNumInput(g.gid, "siteTarget", rec.siteTarget, "0")) +
        ctmsLabeled("기관 수 (개시)", ctmsNumInput(g.gid, "siteActive", rec.siteActive, "0")) +
        ctmsLabeled("피험자 (목표)", ctmsNumInput(g.gid, "subjTarget", rec.subjTarget, "0")) +
        ctmsLabeled("피험자 (등록)", ctmsNumInput(g.gid, "subjEnrolled", rec.subjEnrolled, "0")) +
        ctmsLabeled("피험자 (완료)", ctmsNumInput(g.gid, "subjCompleted", rec.subjCompleted, "0")) +
      '</div>' +
      '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin:12px 0 6px;">마일스톤 (월 단위)</div>' +
      ctmsMilestoneRowsHtml(g) +
      '<div style="margin-top:8px;">' +
        ctmsLabeled("비고", '<input class="input" value="'+esc(rec.note || "")+'" onchange="ctmsSetField(\''+g.gid+'\',\'note\',this.value)" placeholder="지연 사유, 이슈 등" style="font-size:12px;padding:6px 8px;"/>', "1 1 100%") +
      '</div>' +
      '<div style="margin-top:10px;text-align:right;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">' +
        '<button class="add-btn" style="display:inline-flex;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;padding:6px 12px;font-size:12px;" onclick="ctmsStop(\''+g.gid+'\')">'+icon('trash',13)+' 추적 해제</button>' +
        (isAdmin() ? '<button class="add-btn" style="display:inline-flex;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;padding:6px 12px;font-size:12px;" onclick="ctmsExcludeConfirm(\''+g.gid+'\')" title="CTMS에 해당하지 않는 과제를 이 목록에서 삭제">'+icon('trash',13)+' CTMS 목록에서 삭제</button>' : '') +
      '</div>' +
    '</div>';
  }

  return '<div class="card" style="padding:14px;margin-bottom:8px;">' +
    '<div style="cursor:pointer;" onclick="ctmsToggle(\''+g.gid+'\')">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="min-width:0;flex:1;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'+nameLine+'</div>' + metaLine +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">'+ctmsHealthBadge(s.health)+
          '<span style="color:#94A3B8;font-size:12px;">'+(open ? "▾" : "▸")+'</span></div>' +
      '</div>' +
      summaryHtml +
    '</div>' +
    detail +
  '</div>';
}
function renderCtmsTab(){
  const bar = ctmsAuthBarHtml();
  if(state.assignments.length === 0){
    return bar + renderCtmsTrackerTab();
  }
  const sub = state.ctmsUi.sub;
  if(sub === "issues") return bar + ctmsSubTabBar() + renderCtmsIssues();
  if(sub === "cost") return bar + ctmsSubTabBar() + renderCtmsCost();
  return bar + ctmsSubTabBar() + renderCtmsTrackerTab();
}
function renderCtmsTrackerTab(){
  if(state.assignments.length === 0){
    return '<div class="card"><div class="empty">아직 배정된 과제가 없어요. \'과제 배정\' 탭에서 먼저 과제를 배정하면 여기서 CTMS 진행을 추적할 수 있어요.</div></div>';
  }
  const ui = state.ctmsUi;
  let groups = ctmsScopeGroups();
  if(ui.scope !== "all") groups = groups.filter(ctmsIsOpen);
  if(!ctmsAuthOwnerId() && ui.member !== "전체") groups = groups.filter(g => g.members.some(m => m.memberId === ui.member));

  const tracked = groups.filter(g => g.rec);
  const sums = tracked.map(g => ({ g, s: ctmsSummary(g.rec) }));
  const delayedCount = sums.filter(x => x.s.health === "지연").length;
  const doneCount = sums.filter(x => x.s.health === "완료").length;
  const subjTarget = tracked.reduce((n, g) => n + (g.rec.subjTarget || 0), 0);
  const subjEnrolled = tracked.reduce((n, g) => n + (g.rec.subjEnrolled || 0), 0);

  let shown = groups;
  if(ui.view === "tracking") shown = groups.filter(g => g.rec);
  else if(ui.view === "untracked") shown = groups.filter(g => !g.rec);
  else if(ui.view === "delayed") shown = groups.filter(g => g.rec && ctmsSummary(g.rec).health === "지연");
  shown = shown.map((g, i) => ({ g, i, rank: g.rec ? CTMS_HEALTH[ctmsSummary(g.rec).health].rank : 4 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i).map(x => x.g);

  const orphanCount = Object.keys(state.ctms).filter(k => !state.assignments.some(a => ctmsGid(a) === k)).length;

  let html = '<div class="stack">';
  html += '<div class="card">' +
    '<div class="subtotal-grid" style="margin-bottom:14px;">' +
      '<div class="subtotal-item" style="background:#E5F1F1;"><div class="subtotal-label" style="color:#1F6F78;">CTMS 추적 과제</div>' +
        '<div class="subtotal-value">'+tracked.length+'<span class="subtotal-unit"> / '+groups.length+'건</span></div></div>' +
      '<div class="subtotal-item" style="background:#FDECEC;"><div class="subtotal-label" style="color:#B91C1C;">지연</div>' +
        '<div class="subtotal-value">'+delayedCount+'<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#E7F6EC;"><div class="subtotal-label" style="color:#16A34A;">전 단계 완료</div>' +
        '<div class="subtotal-value">'+doneCount+'<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#EAF1FB;"><div class="subtotal-label" style="color:#3E6FB0;">피험자 등록</div>' +
        '<div class="subtotal-value">'+subjEnrolled+'<span class="subtotal-unit"> / '+subjTarget+'명'+(subjTarget ? ' ('+ctmsPct(subjEnrolled, subjTarget)+'%)' : '')+'</span></div></div>' +
    '</div>' +
    '<div style="display:flex;gap:6px;">' +
      ctmsMemberSelectHtml() +
      '<select class="input view-ok" onchange="ctmsSetFilter(\'scope\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="open"'+(ui.scope === "open" ? " selected" : "")+'>진행 과제 (종료·중단 제외)</option>' +
        '<option value="all"'+(ui.scope === "all" ? " selected" : "")+'>전체 과제</option>' +
      '</select>' +
      '<select class="input view-ok" onchange="ctmsSetFilter(\'view\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
        '<option value="all"'+(ui.view === "all" ? " selected" : "")+'>보기: 전체</option>' +
        '<option value="tracking"'+(ui.view === "tracking" ? " selected" : "")+'>추적 중</option>' +
        '<option value="untracked"'+(ui.view === "untracked" ? " selected" : "")+'>미등록</option>' +
        '<option value="delayed"'+(ui.view === "delayed" ? " selected" : "")+'>지연만</option>' +
      '</select>' +
    '</div>' +
  '</div>';
  if(shown.length === 0){
    html += '<div class="card"><div class="empty">조건에 맞는 과제가 없어요.</div></div>';
  }else{
    html += shown.map(ctmsCardHtml).join("");
  }
  html += '<div style="font-size:11.5px;color:#94A3B8;padding:0 4px;">지연은 계획월이 지났는데 실적월이 비어 있는 마일스톤이 있을 때 표시돼요.' +
    (orphanCount > 0 ? ' 연결된 배정이 삭제된 CTMS 기록 '+orphanCount+'건은 (배정 삭제를 되돌릴 수 있도록) 그대로 보관 중이에요.' : '') + '</div>';
  html += ctmsExcludedListHtml();
  html += '</div>';
  return html;
}
/* ---------------- CTMS 진행/이슈 · 비용 (기존 CTMS 앱의 입력 기능을 이 툴 화면에 맞춰 옮김) ---------------- */
// 진행/이슈: state.ctmsIssues[gid] = [ {id, entryType:'progress'|'issue', date, title, ...} ]
// 비용:      state.ctmsCost[gid]   = [ {id, kind:'plan'|'actual', ym:'YYYY-MM', amount(천원), category, memo, changeHistory[]} ]
// gid는 CTMS 추적 탭과 같은 값(공동배정 그룹이면 groupId, 아니면 배정 id)이라 배정 과제와 그대로 연결된다.
const CTMS_SEVERITY = [{ key: "low", label: "낮음" }, { key: "normal", label: "보통" }, { key: "high", label: "높음" }, { key: "urgent", label: "긴급" }];
const CTMS_ISSUE_STATUS = [{ key: "open", label: "미해결" }, { key: "progress", label: "진행중" }, { key: "resolved", label: "해결됨" }];
const CTMS_SEV_META = { low: { c: "#64748B", s: "#EEF2F6" }, normal: { c: "#1F6F78", s: "#E5F1F1" }, high: { c: "#C2410C", s: "#FDECE3" }, urgent: { c: "#B91C1C", s: "#FDECEC" } };
const CTMS_IST_META = { open: { c: "#B91C1C", s: "#FDECEC" }, progress: { c: "#B45309", s: "#FEF3E2" }, resolved: { c: "#16A34A", s: "#E7F6EC" } };
const CTMS_COST_CATS = ["연구비", "CRO비", "IP 포장/배송", "출장/경비", "기타"];

function ctmsToday(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function ctmsLabelOf(arr, key){ const x = arr.find(a => a.key === key); return x ? x.label : key; }
function ctmsEntryType(e){ return e.entryType === "progress" ? "progress" : "issue"; }
function ctmsGroupName(gid){ const g = ctmsAllGroups().find(x => x.gid === gid); return g ? g.primary.taskName : ""; }
function ctmsTimeLabel(ts){ const d = new Date(ts); return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function ctmsFilteredGroups(){
  const ui = state.ctmsUi;
  let groups = ctmsScopeGroups();
  if(ui.scope !== "all") groups = groups.filter(ctmsIsOpen);
  if(!ctmsAuthOwnerId() && ui.member !== "전체") groups = groups.filter(g => g.members.some(m => m.memberId === ui.member));
  return groups;
}
function ctmsOpenIssueCount(){
  let n = 0;
  ctmsGroups().filter(ctmsIsOpen).forEach(g => {
    (state.ctmsIssues[g.gid] || []).forEach(e => { if(ctmsEntryType(e) === "issue" && e.status !== "resolved") n++; });
  });
  return n;
}
function ctmsSubTabBar(){
  const sub = state.ctmsUi.sub;
  const btn = (id, label) => '<button class="view-ok" onclick="ctmsSetSub(\'' + id + '\')" style="flex:1;padding:9px 10px;border-radius:8px;border:1px solid ' +
    (sub === id ? "var(--accent)" : "var(--border)") + ';background:' + (sub === id ? "var(--accent)" : "#fff") + ';color:' + (sub === id ? "#fff" : "#475569") + ';font-size:13px;font-weight:700;">' + label + '</button>';
  return '<div style="display:flex;gap:6px;margin-bottom:14px;">' + btn("tracker", "진행 트래커") + btn("issues", "진행·이슈") + btn("cost", "비용") + '</div>';
}
function ctmsSetSub(id){ state.ctmsUi.sub = id; renderTabContent(); }
function ctmsFilterRow(extraSelectHtml){
  const ui = state.ctmsUi;
  return '<div style="display:flex;gap:6px;">' +
    ctmsMemberSelectHtml() +
    '<select class="input view-ok" onchange="ctmsSetFilter(\'scope\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
      '<option value="open"' + (ui.scope === "open" ? " selected" : "") + '>진행 과제 (종료·중단 제외)</option>' +
      '<option value="all"' + (ui.scope === "all" ? " selected" : "") + '>전체 과제</option>' +
    '</select>' + (extraSelectHtml || "") +
  '</div>';
}
// 현재 시점(이번 달)에 실제로 배정돼 있는 담당자. 지금 배정된 사람이 없으면(예: 시작 전/종료 후) 전체 이력을 보여준다.
function ctmsCurrentMembers(g){
  const now = currentPeriod();
  const cur = g.members.filter(m => isActive(m, now));
  return cur.length > 0 ? cur : g.members;
}
function ctmsNamesOf(g){
  const names = [];
  ctmsCurrentMembers(g).forEach(m => { const mm = state.members.find(x => x.id === m.memberId); const n = mm ? mm.name : "삭제된 팀원"; if(names.indexOf(n) < 0) names.push(n); });
  return names;
}
function ctmsGroupHead(g){
  const map = taskTypeById(), pmap = productById();
  const p = g.primary, t = map[p.taskTypeId], prod = pmap[p.productId];
  const names = ctmsNamesOf(g);
  return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' + lineTagHtml(t ? t.line : null) +
    (prod ? '<span class="product-tag">' + esc(prod.name) + '</span>' : '') +
    '<span style="font-weight:700;font-size:13.5px;">' + esc(p.taskName) + '</span></div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-top:3px;">' + esc(names.join(", ")) + ' · ' + g.status + '</div>';
}

/* ===================== 진행 · 이슈 ===================== */
function ctmsQuickAdd(gid){
  if(!ctmsCanEdit(gid)) return;
  const ta = document.getElementById("ctms-q-" + gid), cb = document.getElementById("ctms-qt-" + gid);
  const title = ta ? ta.value.trim() : "";
  if(!title) return;
  const isIssue = !!(cb && cb.checked);
  if(!state.ctmsIssues[gid]) state.ctmsIssues[gid] = [];
  state.ctmsIssues[gid].push(isIssue
    ? { id: uid("ci"), entryType: "issue", date: ctmsToday(), severity: "normal", title, status: "open", resolvedDate: "", owner: "", note: "", needsFollowUp: false, followUps: [] }
    : { id: uid("ci"), entryType: "progress", date: ctmsToday(), title, changeHistory: [] });
  logActivity((isIssue ? "CTMS 이슈 등록" : "CTMS 진행상황 등록") + ': "' + ctmsGroupName(gid) + '" - ' + title.slice(0, 30));
  ctmsPersist(gid);
  renderTabContent();
}
function ctmsToggleIssueGroup(gid){ state.ctmsUi.issueOpen[gid] = !state.ctmsUi.issueOpen[gid]; renderTabContent(); }
function ctmsIssueRowHtml(gid, e){
  const click = ctmsCanEdit(gid) ? ' onclick="ctmsEditEntry(\'' + gid + '\',\'' + e.id + '\')" style="cursor:pointer;' : ' style="';
  if(ctmsEntryType(e) === "progress"){
    const ch = (e.changeHistory || []).length;
    return '<div' + click + 'padding:8px 10px;background:#F8FAFC;border-radius:7px;margin-bottom:5px;border-left:3px solid #3E6FB0;">' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#94A3B8;"><span>' + (e.date || "미정") + '</span>' +
      '<span style="font-weight:700;color:#3E6FB0;background:#EAF1FB;padding:1px 7px;border-radius:999px;">진행상황</span>' +
      (ch ? '<span style="margin-left:auto;">수정 ' + ch + '회</span>' : '') + '</div>' +
      '<div style="font-size:13px;margin-top:4px;white-space:pre-wrap;">' + esc(e.title) + '</div></div>';
  }
  const sv = CTMS_SEV_META[e.severity] || CTMS_SEV_META.normal, st = CTMS_IST_META[e.status] || CTMS_IST_META.open;
  const fu = (e.followUps || []).length;
  return '<div' + click + 'padding:8px 10px;background:#F8FAFC;border-radius:7px;margin-bottom:5px;border-left:3px solid ' + st.c + ';">' +
    '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#94A3B8;flex-wrap:wrap;"><span>' + (e.date || "미정") + '</span>' +
    '<span style="font-weight:700;color:' + sv.c + ';background:' + sv.s + ';padding:1px 7px;border-radius:999px;">' + ctmsLabelOf(CTMS_SEVERITY, e.severity) + '</span>' +
    '<span style="font-weight:700;color:' + st.c + ';background:' + st.s + ';padding:1px 7px;border-radius:999px;">' + ctmsLabelOf(CTMS_ISSUE_STATUS, e.status) + '</span>' +
    (e.needsFollowUp ? '<span style="font-weight:700;color:#B45309;">F/U 필요</span>' : '') + '</div>' +
    '<div style="font-size:13px;font-weight:600;margin-top:4px;white-space:pre-wrap;">' + esc(e.title) + '</div>' +
    (e.note ? '<div style="font-size:12px;color:#64748B;margin-top:3px;white-space:pre-wrap;">' + esc(e.note) + '</div>' : '') +
    (e.owner || e.resolvedDate ? '<div style="font-size:11px;color:#94A3B8;margin-top:3px;">' + (e.owner ? '담당 · ' + esc(e.owner) : '') + (e.resolvedDate ? ' · 해결일 ' + e.resolvedDate : '') + '</div>' : '') +
    (fu ? '<div style="font-size:11px;color:#94A3B8;margin-top:2px;">F/U ' + fu + '건 누적</div>' : '') + '</div>';
}
function renderCtmsIssues(){
  const ui = state.ctmsUi;
  const groups = ctmsFilteredGroups();
  const all = groups.flatMap(g => state.ctmsIssues[g.gid] || []);
  const cnt = (f) => all.filter(f).length;
  const viewSel = '<select class="input view-ok" onchange="ctmsSetFilter(\'issueView\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
    '<option value="entered"' + (ui.issueView === "entered" ? " selected" : "") + '>기록 있는 과제</option>' +
    '<option value="open"' + (ui.issueView === "open" ? " selected" : "") + '>미해결 이슈 있는 과제</option>' +
    '<option value="all"' + (ui.issueView === "all" ? " selected" : "") + '>전체 과제</option></select>';
  let html = '<div class="stack">' + '<div class="card">' +
    '<div class="subtotal-grid" style="margin-bottom:14px;">' +
      '<div class="subtotal-item" style="background:#E5F1F1;"><div class="subtotal-label" style="color:#1F6F78;">전체 항목</div><div class="subtotal-value">' + all.length + '<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#EAF1FB;"><div class="subtotal-label" style="color:#3E6FB0;">진행상황</div><div class="subtotal-value">' + cnt(e => ctmsEntryType(e) === "progress") + '<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#FDECEC;"><div class="subtotal-label" style="color:#B91C1C;">미해결 이슈</div><div class="subtotal-value">' + cnt(e => ctmsEntryType(e) === "issue" && e.status !== "resolved") + '<span class="subtotal-unit">건</span></div></div>' +
      '<div class="subtotal-item" style="background:#E7F6EC;"><div class="subtotal-label" style="color:#16A34A;">해결됨</div><div class="subtotal-value">' + cnt(e => ctmsEntryType(e) === "issue" && e.status === "resolved") + '<span class="subtotal-unit">건</span></div></div>' +
    '</div>' + ctmsFilterRow(viewSel) + '</div>';
  let shown = groups;
  if(ui.issueView === "entered") shown = groups.filter(g => (state.ctmsIssues[g.gid] || []).length > 0);
  else if(ui.issueView === "open") shown = groups.filter(g => (state.ctmsIssues[g.gid] || []).some(e => ctmsEntryType(e) === "issue" && e.status !== "resolved"));
  if(shown.length === 0){
    html += '<div class="card"><div class="empty">' + (ui.issueView === "all" ? "표시할 과제가 없어요." : "조건에 맞는 과제가 없어요. 위에서 '전체 과제'로 바꾸면 기록이 없는 과제에도 바로 입력할 수 있어요.") + '</div></div>';
  }
  shown.forEach(g => {
    const entries = (state.ctmsIssues[g.gid] || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id)));
    const expanded = !!ui.issueOpen[g.gid];
    // 기본 노출: 최신 2건 + 미해결 이슈 전부. 나머지는 펼치기
    const always = new Set(entries.slice(0, 2).map(e => e.id));
    entries.forEach(e => { if(ctmsEntryType(e) === "issue" && e.status !== "resolved") always.add(e.id); });
    const visible = expanded ? entries : entries.filter(e => always.has(e.id));
    const hidden = entries.length - visible.length;
    html += '<div class="card" style="padding:14px;">' + ctmsGroupHead(g) +
      '<div style="display:flex;gap:6px;align-items:flex-start;margin-top:10px;">' +
        '<textarea id="ctms-q-' + g.gid + '" rows="1" class="input" placeholder="진행상황 또는 이슈 입력 후 추가" style="flex:1;font-size:13px;padding:7px 8px;resize:vertical;min-height:36px;"></textarea>' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#64748B;white-space:nowrap;padding-top:8px;"><input type="checkbox" id="ctms-qt-' + g.gid + '"/>이슈</label>' +
        '<button class="add-btn" style="flex:0 0 auto;padding:8px 12px;font-size:12px;" onclick="ctmsQuickAdd(\'' + g.gid + '\')">추가</button>' +
      '</div>' +
      '<div style="margin-top:10px;">' + (visible.length ? visible.map(e => ctmsIssueRowHtml(g.gid, e)).join("") : '<div style="font-size:12px;color:#94A3B8;">등록된 항목이 없어요.</div>') + '</div>' +
      ((expanded || hidden > 0) ? '<button class="view-ok" onclick="ctmsToggleIssueGroup(\'' + g.gid + '\')" style="width:100%;margin-top:4px;padding:7px 0;border:1px dashed var(--border);background:#fff;border-radius:7px;color:#64748B;font-size:12px;font-weight:600;">' + (expanded ? "접기" : "이전 기록 더보기 (" + hidden + "건)") + '</button>' : '') +
    '</div>';
  });
  html += '<div style="font-size:11.5px;color:#94A3B8;padding:0 4px;">항목을 누르면 수정·삭제할 수 있어요. 진행상황은 수정할 때마다 전·후 내용이 이력으로 남고, 이슈는 F/U(후속조치)를 누적 관리할 수 있어요.</div></div>';
  return html;
}
function ctmsFindEntry(gid, id){ return (state.ctmsIssues[gid] || []).find(e => String(e.id) === String(id)) || null; }
function ctmsSheetButtons(deleteJs){
  return '<div style="display:flex;gap:8px;margin-top:14px;">' +
    '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
    (deleteJs ? '<button class="add-btn" style="flex:0 0 auto;justify-content:center;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;" onclick="' + deleteJs + '">삭제</button>' : '') +
    '<button class="add-btn" style="flex:1;justify-content:center;" id="ctms-sheet-save">저장</button></div>';
}
function ctmsSheetField(label, inner){ return '<div style="margin-bottom:10px;"><div style="font-size:11.5px;color:#64748B;font-weight:600;margin-bottom:4px;">' + label + '</div>' + inner + '</div>'; }
function ctmsEditEntry(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id);
  if(!e) return;
  if(ctmsEntryType(e) === "progress"){
    const hist = (e.changeHistory || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time)));
    showModal(
      '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">진행상황 수정</div>' +
      '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(gid)) + ' · ' + (e.date || "") + '</div>' +
      (hist.length ? '<div style="max-height:110px;overflow-y:auto;margin-bottom:10px;font-size:11.5px;color:#64748B;">수정 이력 ' + hist.length + '건' +
        hist.map(h => '<div style="padding:5px 0;border-bottom:1px solid #F1F5F9;"><span style="color:#94A3B8;">' + ctmsTimeLabel(h.time) + '</span><br/>전: ' + esc(h.before) + '<br/>후: ' + esc(h.after) + '</div>').join("") + '</div>' : '') +
      ctmsSheetField("진행상황 내용", '<textarea id="ctms-e-title" class="input" rows="4" style="font-size:13px;">' + esc(e.title) + '</textarea>') +
      '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
      ctmsSheetButtons("ctmsDeleteEntry('" + gid + "','" + id + "')"));
    document.getElementById("ctms-sheet-save").onclick = () => ctmsSaveProgress(gid, id);
    return;
  }
  const opt = (arr, cur) => arr.map(o => '<option value="' + o.key + '"' + (o.key === cur ? " selected" : "") + '>' + o.label + '</option>').join("");
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">이슈 수정</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(gid)) + '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<div style="flex:1;">' + ctmsSheetField("발생일", '<input type="date" id="ctms-e-date" class="input" value="' + (e.date || "") + '" style="font-size:13px;padding:7px 8px;"/>') + '</div>' +
      '<div style="flex:1;">' + ctmsSheetField("심각도", '<select id="ctms-e-sev" class="input" style="font-size:13px;padding:7px 8px;">' + opt(CTMS_SEVERITY, e.severity) + '</select>') + '</div>' +
    '</div>' +
    ctmsSheetField("이슈 내용", '<textarea id="ctms-e-title" class="input" rows="2" style="font-size:13px;">' + esc(e.title) + '</textarea>') +
    '<div style="display:flex;gap:8px;">' +
      '<div style="flex:1;">' + ctmsSheetField("상태", '<select id="ctms-e-status" class="input" style="font-size:13px;padding:7px 8px;">' + opt(CTMS_ISSUE_STATUS, e.status) + '</select>') + '</div>' +
      '<div style="flex:1;">' + ctmsSheetField("해결일 (선택)", '<input type="date" id="ctms-e-resolved" class="input" value="' + (e.resolvedDate || "") + '" style="font-size:13px;padding:7px 8px;"/>') + '</div>' +
    '</div>' +
    ctmsSheetField("담당자 (선택)", '<input id="ctms-e-owner" class="input" value="' + esc(e.owner || "") + '" style="font-size:13px;padding:7px 8px;"/>') +
    ctmsSheetField("조치 내용 (선택)", '<textarea id="ctms-e-note" class="input" rows="2" placeholder="원인, 조치 경과 등" style="font-size:13px;">' + esc(e.note || "") + '</textarea>') +
    '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:#B45309;border:1px solid #F1D9B5;margin-bottom:4px;" onclick="ctmsOpenFollowUp(\'' + gid + '\',\'' + id + '\')">F/U(후속조치) 관리 · ' + (e.followUps || []).length + '건</button>' +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons("ctmsDeleteEntry('" + gid + "','" + id + "')"));
  document.getElementById("ctms-sheet-save").onclick = () => ctmsSaveIssue(gid, id);
}
function ctmsSheetError(msg){ const el = document.getElementById("ctms-sheet-err"); if(el){ el.textContent = msg; el.style.display = "block"; } }
function ctmsSaveIssue(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id); if(!e) return;
  const title = document.getElementById("ctms-e-title").value.trim();
  if(!title){ ctmsSheetError("이슈 내용을 입력해 주세요."); return; }
  const status = document.getElementById("ctms-e-status").value;
  let resolved = document.getElementById("ctms-e-resolved").value;
  if(status === "resolved" && !resolved) resolved = ctmsToday();
  e.date = document.getElementById("ctms-e-date").value; e.severity = document.getElementById("ctms-e-sev").value;
  e.title = title; e.status = status; e.resolvedDate = status === "resolved" ? resolved : "";
  e.owner = document.getElementById("ctms-e-owner").value.trim(); e.note = document.getElementById("ctms-e-note").value.trim();
  logActivity('CTMS 이슈 수정: "' + ctmsGroupName(gid) + '" - ' + title.slice(0, 30) + ' (' + ctmsLabelOf(CTMS_ISSUE_STATUS, status) + ')');
  ctmsPersist(gid); closeModal(); renderTabContent();
}
function ctmsSaveProgress(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id); if(!e) return;
  const content = document.getElementById("ctms-e-title").value.trim();
  if(!content){ ctmsSheetError("진행상황 내용을 입력해 주세요."); return; }
  if(e.title !== content){
    if(!e.changeHistory) e.changeHistory = [];
    e.changeHistory.push({ id: uid("ch"), time: new Date().toISOString(), before: e.title, after: content });
    e.title = content;
    logActivity('CTMS 진행상황 수정: "' + ctmsGroupName(gid) + '" - ' + content.slice(0, 30));
  }
  ctmsPersist(gid); closeModal(); renderTabContent();
}
function ctmsDeleteEntry(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const list = state.ctmsIssues[gid] || [];
  const idx = list.findIndex(e => String(e.id) === String(id));
  if(idx < 0) return;
  const removed = list[idx];
  list.splice(idx, 1);
  const label = ctmsEntryType(removed) === "progress" ? "진행상황" : "이슈";
  logActivity('CTMS ' + label + ' 삭제: "' + ctmsGroupName(gid) + '" - ' + removed.title.slice(0, 30));
  state.lastAction = {
    gid,
    restore: () => { if(!state.ctmsIssues[gid]) state.ctmsIssues[gid] = []; state.ctmsIssues[gid].splice(Math.min(idx, state.ctmsIssues[gid].length), 0, removed); },
    undoMsg: 'CTMS ' + label + ' 삭제 취소: "' + ctmsGroupName(gid) + '"',
  };
  showUndoToast(label + '을(를) 삭제했어요');
  ctmsPersist(gid); closeModal(); renderTabContent();
}
function ctmsOpenFollowUp(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id); if(!e) return;
  const fus = (e.followUps || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time)));
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:6px;">F/U 관리</div>' +
    '<div style="font-size:12.5px;font-weight:600;margin-bottom:10px;">' + esc(e.title) + '</div>' +
    '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:12px;"><input type="checkbox" id="ctms-fu-needed"' + (e.needsFollowUp ? " checked" : "") + ' onchange="ctmsFuNeeded(\'' + gid + '\',\'' + id + '\',this.checked)"/> F/U 필요</label>' +
    ctmsSheetField("F/U 목표 일정", '<input type="date" id="ctms-fu-target" class="input" style="font-size:13px;padding:7px 8px;"/>') +
    ctmsSheetField("F/U 사항", '<textarea id="ctms-fu-content" class="input" rows="2" placeholder="F/U 사항 입력" style="font-size:13px;"></textarea>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);margin-bottom:6px;"></div>' +
    '<button class="add-btn" style="width:100%;justify-content:center;" onclick="ctmsFuAdd(\'' + gid + '\',\'' + id + '\')">F/U 추가</button>' +
    '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin:14px 0 6px;">F/U 이력 (' + fus.length + '건)</div>' +
    '<div style="max-height:160px;overflow-y:auto;">' + (fus.length ? fus.map(f => '<div style="padding:6px 0;border-bottom:1px solid #F1F5F9;font-size:12px;"><span style="color:#94A3B8;">' + ctmsTimeLabel(f.time) + '</span>' +
      (f.targetDate ? ' · <b>목표 ' + f.targetDate + '</b>' : '') + '<div style="white-space:pre-wrap;margin-top:2px;">' + esc(f.content) + '</div></div>').join("") : '<div style="font-size:12px;color:#94A3B8;">등록된 F/U 이력이 없어요.</div>') + '</div>' +
    '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);margin-top:12px;" onclick="ctmsEditEntry(\'' + gid + '\',\'' + id + '\')">← 이슈로 돌아가기</button>');
}
function ctmsFuNeeded(gid, id, on){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id); if(!e) return;
  e.needsFollowUp = !!on; ctmsPersist(gid); renderTabContent();
}
function ctmsFuAdd(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const e = ctmsFindEntry(gid, id); if(!e) return;
  const content = document.getElementById("ctms-fu-content").value.trim();
  if(!content){ ctmsSheetError("F/U 사항을 입력해 주세요."); return; }
  if(!e.followUps) e.followUps = [];
  e.followUps.push({ id: uid("fu"), time: new Date().toISOString(), targetDate: document.getElementById("ctms-fu-target").value, content });
  e.needsFollowUp = true;
  logActivity('CTMS F/U 등록: "' + ctmsGroupName(gid) + '" - ' + e.title.slice(0, 30));
  ctmsPersist(gid); renderTabContent(); ctmsOpenFollowUp(gid, id);
}

/* ===================== 비용 ===================== */
function fmtK(n){ return new Intl.NumberFormat("ko-KR").format(Math.round(n || 0)); }
function ctmsKind(e){ return e.kind === "plan" ? "plan" : "actual"; }
function ctmsSum(list, kind){ return list.filter(e => ctmsKind(e) === kind).reduce((s, e) => s + (Number(e.amount) || 0), 0); }
function ctmsRate(a, p){ return p > 0 ? Math.round((a / p) * 100) : null; }
function ctmsFindCost(list, cat, kind, ym){ return list.find(e => e.category === cat && ctmsKind(e) === kind && e.ym === ym); }
function ctmsCostYearShift(d){ state.ctmsUi.costYear += d; renderTabContent(); }
function ctmsToggleCost(gid){ state.ctmsUi.costOpen[gid] = !state.ctmsUi.costOpen[gid]; renderTabContent(); }
function renderCtmsCost(){
  const ui = state.ctmsUi, yr = ui.costYear;
  const groups = ctmsFilteredGroups();
  const allEntries = groups.flatMap(g => state.ctmsCost[g.gid] || []);
  const curYm = ctmsToday().slice(0, 7);
  const plan = ctmsSum(allEntries, "plan"), actual = ctmsSum(allEntries, "actual");
  const rate = ctmsRate(actual, plan);
  const monthActual = ctmsSum(allEntries.filter(e => e.ym === curYm), "actual");
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const ym = yr + "-" + String(i + 1).padStart(2, "0");
    const es = allEntries.filter(e => e.ym === ym);
    return { p: ctmsSum(es, "plan"), a: ctmsSum(es, "actual") };
  });
  const maxV = Math.max(1, ...monthly.map(m => Math.max(m.p, m.a)));
  const viewSel = '<select class="input view-ok" onchange="ctmsSetFilter(\'costView\',this.value)" style="flex:1 1 0;min-width:0;font-size:12px;padding:7px 6px;">' +
    '<option value="entered"' + (ui.costView === "entered" ? " selected" : "") + '>비용 입력된 과제</option>' +
    '<option value="all"' + (ui.costView === "all" ? " selected" : "") + '>전체 과제</option></select>';
  let html = '<div class="stack"><div class="card">' +
    '<div class="subtotal-grid" style="margin-bottom:14px;">' +
      '<div class="subtotal-item" style="background:#F3ECFC;"><div class="subtotal-label" style="color:#7B4FAE;">전체 계획(천원)</div><div class="subtotal-value">' + fmtK(plan) + '</div></div>' +
      '<div class="subtotal-item" style="background:#E4F4F8;"><div class="subtotal-label" style="color:#0E8CA6;">전체 집행(천원)</div><div class="subtotal-value">' + fmtK(actual) + '</div></div>' +
      '<div class="subtotal-item" style="background:#E5F1F1;"><div class="subtotal-label" style="color:#1F6F78;">집행률</div><div class="subtotal-value">' + (rate === null ? "—" : rate + "%") + '</div></div>' +
      '<div class="subtotal-item" style="background:#EEF2F6;"><div class="subtotal-label" style="color:#475569;">이번달 집행(천원)</div><div class="subtotal-value">' + fmtK(monthActual) + '</div></div>' +
    '</div>' + ctmsFilterRow(viewSel) + '</div>';
  html += '<div class="card"><div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px;">' +
    '<button class="icon-round view-ok" onclick="ctmsCostYearShift(-1)">' + icon("chevronLeft", 15) + '</button><span style="font-weight:800;font-size:15px;min-width:60px;text-align:center;">' + yr + '년</span>' +
    '<button class="icon-round view-ok" onclick="ctmsCostYearShift(1)">' + icon("chevronRight", 15) + '</button></div>' +
    '<div style="display:flex;align-items:flex-end;gap:4px;height:110px;">' +
    monthly.map((m, i) => '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;"><div style="display:flex;align-items:flex-end;gap:2px;height:92px;">' +
      '<div title="계획 ' + fmtK(m.p) + '천원" style="width:7px;background:#7B4FAE;border-radius:2px 2px 0 0;height:' + (m.p > 0 ? Math.max(4, Math.round(m.p / maxV * 90)) : 2) + 'px;opacity:' + (m.p > 0 ? 1 : 0.25) + ';"></div>' +
      '<div title="집행 ' + fmtK(m.a) + '천원" style="width:7px;background:#0E8CA6;border-radius:2px 2px 0 0;height:' + (m.a > 0 ? Math.max(4, Math.round(m.a / maxV * 90)) : 2) + 'px;opacity:' + (m.a > 0 ? 1 : 0.25) + ';"></div></div>' +
      '<span style="font-size:10px;color:#94A3B8;">' + (i + 1) + '월</span></div>').join("") + '</div>' +
    '<div style="display:flex;gap:14px;justify-content:center;font-size:11px;color:#64748B;margin-top:8px;"><span><i style="display:inline-block;width:8px;height:8px;background:#7B4FAE;border-radius:2px;"></i> 계획</span><span><i style="display:inline-block;width:8px;height:8px;background:#0E8CA6;border-radius:2px;"></i> 집행</span></div></div>';
  let shown = groups;
  if(ui.costView === "entered") shown = groups.filter(g => (state.ctmsCost[g.gid] || []).length > 0);
  if(shown.length === 0){
    html += '<div class="card"><div class="empty">' + (ui.costView === "all" ? "표시할 과제가 없어요." : "비용이 입력된 과제가 없어요. 위에서 '전체 과제'로 바꾸면 과제별로 비용을 입력할 수 있어요.") + '</div></div>';
  }
  shown.forEach(g => {
    const list = state.ctmsCost[g.gid] || [];
    const pT = ctmsSum(list, "plan"), aT = ctmsSum(list, "actual"), r = ctmsRate(aT, pT);
    const yList = list.filter(e => String(e.ym).startsWith(String(yr)));
    const yP = ctmsSum(yList, "plan"), yA = ctmsSum(yList, "actual");
    const open = !!ui.costOpen[g.gid];
    let detail = "";
    if(open){
      const cells = Array.from({ length: 12 }, (_, i) => {
        const ym = yr + "-" + String(i + 1).padStart(2, "0");
        const es = list.filter(e => e.ym === ym);
        const p = ctmsSum(es, "plan"), a = ctmsSum(es, "actual");
        const canEdit = ctmsCanEdit(g.gid);
        return '<div ' + (canEdit ? 'onclick="ctmsCostCellSheet(\''+g.gid+'\',\''+ym+'\')" title="' + periodLabel(ym) + ' 비용 입력/수정" style="cursor:pointer;background:#F8FAFC;border-radius:6px;padding:5px 6px;font-size:11px;transition:background .1s;" onmouseover="this.style.background=\'#EEF2F6\'" onmouseout="this.style.background=\'#F8FAFC\'"' : 'style="background:#F8FAFC;border-radius:6px;padding:5px 6px;font-size:11px;"') + '><div style="color:#94A3B8;">' + (i + 1) + '월</div>' +
          '<div style="color:#7B4FAE;font-weight:700;">' + (p > 0 ? fmtK(p) : "—") + '</div><div style="color:#0E8CA6;font-weight:700;">' + (a > 0 ? fmtK(a) : "—") + '</div></div>';
      }).join("");
      const entries = list.slice().sort((a, b) => String(b.ym).localeCompare(String(a.ym)));
      detail = '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">' +
        '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin-bottom:6px;">' + yr + '년 월별 <span style="color:#7B4FAE;">계획</span> / <span style="color:#0E8CA6;">집행</span> (천원)</div>' +
        '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-bottom:12px;">' + cells + '</div>' +
        '<div style="font-size:11.5px;font-weight:700;color:#64748B;margin-bottom:6px;">전체 입력 내역</div>' +
        (entries.length ? entries.map(e => {
          const k = ctmsKind(e), ch = (e.changeHistory || []);
          const tip = ch.map(c => ctmsTimeLabel(c.time) + " " + (c.summary || "") + (c.reason ? " (" + c.reason + ")" : "")).join("\n");
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#F8FAFC;border-radius:6px;margin-bottom:4px;font-size:12px;">' +
            '<span style="font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:999px;background:' + (k === "plan" ? "#F3ECFC" : "#E4F4F8") + ';color:' + (k === "plan" ? "#7B4FAE" : "#0E8CA6") + ';">' + (k === "plan" ? "계획" : "집행") + '</span>' +
            '<span style="color:#64748B;">' + esc(e.ym) + '</span>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(tip) + '">' + esc(e.category) + (e.memo ? " · " + esc(e.memo) : "") + (ch.length ? " · 변경 " + ch.length + "회" : "") + '</span>' +
            '<b style="font-variant-numeric:tabular-nums;">' + fmtK(e.amount) + '</b>' +
            '<button class="icon-btn" onclick="ctmsCostDelete(\'' + g.gid + '\',\'' + e.id + '\')" title="삭제">' + icon("trash", 13) + '</button></div>';
        }).join("") : '<div style="font-size:12px;color:#94A3B8;">입력된 비용 내역이 없어요.</div>') + '</div>';
    }
    html += '<div class="card" style="padding:14px;margin-bottom:0;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="min-width:0;flex:1;cursor:pointer;" onclick="ctmsToggleCost(\'' + g.gid + '\')">' + ctmsGroupHead(g) + '</div>' +
        '<button class="add-btn" style="flex:0 0 auto;padding:6px 11px;font-size:12px;" onclick="ctmsCostSheet(\'' + g.gid + '\')">' + icon("plus", 12) + ' 비용 입력</button></div>' +
      '<div style="cursor:pointer;" onclick="ctmsToggleCost(\'' + g.gid + '\')">' +
        '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#64748B;margin:10px 0 4px;"><span>계획 대비 집행 <b>' + fmtK(aT) + ' / ' + fmtK(pT) + '천원</b>' + (r === null ? '' : ' (' + r + '%)') + '</span><span>' + (open ? "▾" : "▸") + '</span></div>' +
        ctmsBarHtml(r === null ? 0 : Math.min(100, r), "#0E8CA6") +
        '<div style="font-size:11px;color:#94A3B8;margin-top:5px;">' + yr + '년 계획 ' + fmtK(yP) + ' / 집행 ' + fmtK(yA) + '천원</div></div>' +
      detail + '</div>';
  });
  html += '<div style="font-size:11.5px;color:#94A3B8;padding:0 4px;">금액 단위는 천원이에요. "비용 입력"에서 항목·구분(계획/집행)을 고르면 12개월 금액을 한 번에 입력·수정할 수 있고, 계획을 바꿀 때는 변경 사유가 이력으로 남아요.</div></div>';
  return html;
}
let ctmsCostCellDraft = null;
function ctmsCostCellSheet(gid, ym){
  if(!ctmsCanEdit(gid)) return;
  ctmsCostCellDraft = { gid, ym };
  ctmsCostCellRender();
}
function ctmsCostCellRender(){
  const d = ctmsCostCellDraft;
  const list = state.ctmsCost[d.gid] || [];
  const rows = CTMS_COST_CATS.map(cat => {
    const p = ctmsFindCost(list, cat, "plan", d.ym);
    const a = ctmsFindCost(list, cat, "actual", d.ym);
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
      '<div style="flex:1.3;font-size:12.5px;font-weight:600;min-width:0;">' + cat + '</div>' +
      '<input type="number" min="0" step="1" id="ctms-cell-plan-' + cat + '" class="input" value="' + (p ? p.amount : "") + '" placeholder="계획" style="flex:1;min-width:0;font-size:13px;padding:6px 6px;color:#7B4FAE;"/>' +
      '<input type="number" min="0" step="1" id="ctms-cell-actual-' + cat + '" class="input" value="' + (a ? a.amount : "") + '" placeholder="집행" style="flex:1;min-width:0;font-size:13px;padding:6px 6px;color:#0E8CA6;"/>' +
    '</div>';
  }).join("");
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + periodLabel(d.ym) + ' 비용 입력</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(d.gid)) + ' · 금액 단위: 천원</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:2px;font-size:10.5px;color:#94A3B8;"><div style="flex:1.3;"></div><div style="flex:1;color:#7B4FAE;font-weight:700;">계획</div><div style="flex:1;color:#0E8CA6;font-weight:700;">집행</div></div>' +
    rows +
    ctmsSheetField("변경 사유 (입력·수정 시 필수)", '<textarea id="ctms-cell-reason" class="input" rows="2" placeholder="예: 대상자 추가 모집으로 조정" style="font-size:13px;"></textarea>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null));
  document.getElementById("ctms-sheet-save").onclick = ctmsCostCellSave;
}
function ctmsCostCellSave(){
  const d = ctmsCostCellDraft;
  if(!d || !ctmsCanEdit(d.gid)) return;
  const list = state.ctmsCost[d.gid] || []; // 실제로 바꿀 값이 있을 때만 아래에서 state에 붙인다
  const reason = document.getElementById("ctms-cell-reason").value.trim();
  const ops = [];
  let anyChange = false;
  CTMS_COST_CATS.forEach(cat => {
    ["plan", "actual"].forEach(kind => {
      const raw = document.getElementById("ctms-cell-" + kind + "-" + cat).value;
      const amount = raw === "" ? 0 : Math.max(0, Math.round(Number(raw) || 0));
      const ex = ctmsFindCost(list, cat, kind, d.ym);
      if((ex ? ex.amount : 0) !== amount) anyChange = true;
      ops.push({ cat, kind, amount, ex });
    });
  });
  if(!anyChange){ closeModal(); return; } // 바꾼 값이 없으면 조용히 닫는다 (빈 기록을 남기지 않음)
  if(!reason){ ctmsSheetError("입력 또는 수정한 금액이 있어요. 사유를 입력해 주세요."); return; }
  if(!state.ctmsCost[d.gid]) state.ctmsCost[d.gid] = list;
  let changed = 0;
  ops.forEach(op => {
    if(op.ex){
      if(op.amount <= 0){
        const k = list.indexOf(op.ex); if(k >= 0) list.splice(k, 1); changed++;
      }else if(op.ex.amount !== op.amount){
        if(!op.ex.changeHistory) op.ex.changeHistory = [];
        op.ex.changeHistory.push({ id: uid("cc"), time: new Date().toISOString(), reason: reason, summary: "금액 " + fmtK(op.ex.amount) + "→" + fmtK(op.amount) + "천원" });
        op.ex.amount = op.amount; changed++;
      }
    }else if(op.amount > 0){
      list.push({ id: uid("ce"), kind: op.kind, ym: d.ym, amount: op.amount, category: op.cat, memo: "",
        changeHistory: [{ id: uid("cc"), time: new Date().toISOString(), reason: reason, summary: "신규 입력 " + fmtK(op.amount) + "천원" }] });
      changed++;
    }
  });
  if(changed > 0) logActivity('CTMS 비용 수정: "' + ctmsGroupName(d.gid) + '" - ' + periodLabel(d.ym) + ' (' + changed + '건, 사유: ' + reason + ')');
  state.ctmsUi.costOpen[d.gid] = true;
  if(list.length === 0) delete state.ctmsCost[d.gid];
  ctmsPersist(d.gid);
  closeModal();
  renderTabContent();
}
function ctmsCostDelete(gid, id){
  if(!ctmsCanEdit(gid)) return;
  const list = state.ctmsCost[gid] || [];
  const idx = list.findIndex(e => String(e.id) === String(id));
  if(idx < 0) return;
  const removed = list[idx];
  list.splice(idx, 1);
  logActivity('CTMS 비용 삭제: "' + ctmsGroupName(gid) + '" - ' + removed.category + ' ' + removed.ym + ' ' + fmtK(removed.amount) + '천원');
  state.lastAction = {
    gid,
    restore: () => { if(!state.ctmsCost[gid]) state.ctmsCost[gid] = []; state.ctmsCost[gid].splice(Math.min(idx, state.ctmsCost[gid].length), 0, removed); },
    undoMsg: 'CTMS 비용 삭제 취소: "' + ctmsGroupName(gid) + '"',
  };
  showUndoToast("비용 내역을 삭제했어요");
  ctmsPersist(gid); renderTabContent();
}
let ctmsCostDraft = null;
function ctmsCostSheet(gid){
  if(!ctmsCanEdit(gid)) return;
  ctmsCostDraft = { gid, category: CTMS_COST_CATS[0], kind: "plan" };
  ctmsCostSheetRender();
}
function ctmsCostSheetChange(field, val){ ctmsCostDraft[field] = val; ctmsCostSheetRender(); }
function ctmsCostSheetRender(){
  const d = ctmsCostDraft, yr = state.ctmsUi.costYear, list = state.ctmsCost[d.gid] || [];
  const cells = Array.from({ length: 12 }, (_, i) => {
    const ym = yr + "-" + String(i + 1).padStart(2, "0");
    const ex = ctmsFindCost(list, d.category, d.kind, ym);
    return '<div><div style="font-size:10.5px;color:#94A3B8;margin-bottom:2px;">' + (i + 1) + '월</div>' +
      '<input type="number" min="0" step="1" id="ctms-amt-' + (i + 1) + '" class="input" value="' + (ex ? ex.amount : "") + '" placeholder="0" style="font-size:13px;padding:6px 5px;"/></div>';
  }).join("");
  const kindBtn = (k, label) => '<button onclick="ctmsCostSheetChange(\'kind\',\'' + k + '\')" style="flex:1;padding:7px 0;border-radius:7px;border:1px solid ' + (d.kind === k ? "var(--accent)" : "var(--border)") +
    ';background:' + (d.kind === k ? "var(--accent)" : "#fff") + ';color:' + (d.kind === k ? "#fff" : "#475569") + ';font-size:12.5px;font-weight:700;">' + label + '</button>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">비용 입력</div>' +
    '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">' + esc(ctmsGroupName(d.gid)) + ' · ' + yr + '년 (금액 단위: 천원)</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
      '<select class="input" onchange="ctmsCostSheetChange(\'category\',this.value)" style="flex:1.2;font-size:13px;padding:7px 8px;">' + CTMS_COST_CATS.map(c => '<option value="' + c + '"' + (c === d.category ? " selected" : "") + '>' + c + '</option>').join("") + '</select>' +
      '<div style="flex:1;display:flex;gap:4px;">' + kindBtn("plan", "계획") + kindBtn("actual", "집행") + '</div></div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;">' + cells + '</div>' +
    ctmsSheetField("변경 사유 (계획을 바꿀 때 필수)", '<textarea id="ctms-cost-reason" class="input" rows="2" placeholder="예: 하반기 대상자 추가 모집 반영" style="font-size:13px;"></textarea>') +
    '<div id="ctms-sheet-err" style="display:none;font-size:12px;color:var(--danger);"></div>' +
    ctmsSheetButtons(null));
  document.getElementById("ctms-sheet-save").onclick = ctmsCostSave;
}
function ctmsCostSave(){
  if(!ctmsCostDraft || !ctmsCanEdit(ctmsCostDraft.gid)) return;
  const d = ctmsCostDraft, yr = state.ctmsUi.costYear;
  if(!state.ctmsCost[d.gid]) state.ctmsCost[d.gid] = [];
  const list = state.ctmsCost[d.gid];
  const reason = document.getElementById("ctms-cost-reason").value.trim();
  const ops = [];
  let needReason = false;
  for(let i = 1; i <= 12; i++){
    const ym = yr + "-" + String(i).padStart(2, "0");
    const raw = document.getElementById("ctms-amt-" + i).value;
    const amount = Math.max(0, Math.round(Number(raw) || 0));
    const ex = ctmsFindCost(list, d.category, d.kind, ym);
    if(ex && ex.amount !== amount && d.kind === "plan") needReason = true;
    ops.push({ ym, amount, ex });
  }
  if(needReason && !reason){ ctmsSheetError("계획을 바꾸는 경우 변경 사유를 입력해 주세요."); return; }
  let changed = 0;
  ops.forEach(op => {
    if(op.ex){
      if(op.amount <= 0){
        const k = list.indexOf(op.ex); if(k >= 0) list.splice(k, 1); changed++;
      }else if(op.ex.amount !== op.amount){
        if(!op.ex.changeHistory) op.ex.changeHistory = [];
        op.ex.changeHistory.push({ id: uid("cc"), time: new Date().toISOString(), reason: reason || "(연간 입력 수정)", summary: "금액 " + fmtK(op.ex.amount) + "→" + fmtK(op.amount) + "천원" });
        op.ex.amount = op.amount; changed++;
      }
    }else if(op.amount > 0){
      list.push({ id: uid("ce"), kind: d.kind, ym: op.ym, amount: op.amount, category: d.category, memo: "", changeHistory: [] }); changed++;
    }
  });
  if(changed > 0) logActivity('CTMS 비용 ' + (d.kind === "plan" ? "계획" : "집행") + ' 입력: "' + ctmsGroupName(d.gid) + '" - ' + d.category + ' (' + changed + '건 변경)');
  state.ctmsUi.costOpen[d.gid] = true;
  if(list.length === 0) delete state.ctmsCost[d.gid];
  ctmsPersist(d.gid); closeModal(); renderTabContent();
}
function ctmsExtExportSheets(wb){
  const groups = ctmsGroups();
  const nameOf = (g) => g.primary.taskName;
  const issueRows = [], costRows = [];
  groups.forEach(g => {
    (state.ctmsIssues[g.gid] || []).forEach(e => {
      const isP = ctmsEntryType(e) === "progress";
      issueRows.push({ "과제명": nameOf(g), "구분": isP ? "진행상황" : "이슈", "일자": e.date || "", "심각도": isP ? "" : ctmsLabelOf(CTMS_SEVERITY, e.severity),
        "상태": isP ? "" : ctmsLabelOf(CTMS_ISSUE_STATUS, e.status), "내용": e.title, "조치 내용": e.note || "", "담당": e.owner || "", "해결일": e.resolvedDate || "",
        "F/U 필요": e.needsFollowUp ? "Y" : "", "F/U 건수": (e.followUps || []).length });
    });
    (state.ctmsCost[g.gid] || []).forEach(e => {
      costRows.push({ "과제명": nameOf(g), "구분": ctmsKind(e) === "plan" ? "계획" : "집행", "월": e.ym, "항목": e.category, "금액(천원)": e.amount, "메모": e.memo || "", "변경 횟수": (e.changeHistory || []).length });
    });
  });
  if(issueRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issueRows), "CTMS 진행·이슈");
  if(costRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(costRows), "CTMS 비용");
}

function ctmsExportRows(){
  const map = taskTypeById(), pmap = productById();
  return ctmsGroups().filter(g => g.rec).map(g => {
    const p = g.primary, rec = g.rec, s = ctmsSummary(rec);
    const t = map[p.taskTypeId], prod = pmap[p.productId];
    const names = [];
    g.members.forEach(m => { const mm = state.members.find(x => x.id === m.memberId); const n = mm ? mm.name : "삭제된 팀원"; if(names.indexOf(n) < 0) names.push(n); });
    const row = {
      "과제명": p.taskName,
      "품목": prod ? prod.name : "",
      "과제유형": t ? t.name : "삭제된 유형",
      "라인": t ? LINE_META[t.line].label : "",
      "담당자": names.join(", "),
      "과제상태": g.status,
      "프로토콜·과제 번호": rec.protocolNo || "",
      "CTMS 진행상태": s.health,
      "마일스톤 완료": s.done + "/" + s.total,
      "기관 수(계획)": rec.siteTarget === null || rec.siteTarget === undefined ? "" : rec.siteTarget,
      "기관 수(개시)": rec.siteActive === null || rec.siteActive === undefined ? "" : rec.siteActive,
      "피험자(목표)": rec.subjTarget === null || rec.subjTarget === undefined ? "" : rec.subjTarget,
      "피험자(등록)": rec.subjEnrolled === null || rec.subjEnrolled === undefined ? "" : rec.subjEnrolled,
      "피험자(완료)": rec.subjCompleted === null || rec.subjCompleted === undefined ? "" : rec.subjCompleted,
      "등록률(%)": rec.subjTarget ? ctmsPct(rec.subjEnrolled || 0, rec.subjTarget) : "",
    };
    ctmsStagesOf(rec).forEach(st => {
      const m = (rec.milestones || {})[st.key] || {};
      row[st.label+" 계획"] = m.plan || "";
      row[st.label+" 실적"] = m.actual || "";
    });
    row["비고"] = rec.note || "";
    return row;
  });
}

/* ---------------- init ---------------- */
document.getElementById("app").innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
initAuth(); // auth.js — 로그인 상태 확인 후 로그인 화면 또는 앱으로
