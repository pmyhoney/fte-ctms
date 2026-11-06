/* ---------------- 팀원 색 배지 · 재택 일지 미작성 알림 ----------------
   - 팀원 색: state.members[].color (app_state에 함께 저장, 팀원 관리 탭에서 관리자가 지정)
   - 달력 배지: 회원(profiles.member_id)에 연결된 팀원의 색. 연결이 없으면 같은 이름의 팀원을 찾는다.
   - 알림: 재택일 오후 6시(한국 시간)까지 일지가 없으면 본인에게, 팀장·관리자에게는 전체 팀원 것을 띄운다.
     서버 발송이 아니라 앱 안의 팝업이다 — 앱을 열어 둔 사람은 6시에, 아니면 다음 접속 때 본다.
     팝업 화면은 다른 입력 누락과 함께 notice.js에서 그린다. */

const MEMBER_COLORS = ["#E53935", "#FB8C00", "#F9A825", "#7CB342", "#2E7D32", "#00897B", "#00ACC1", "#1E88E5", "#3949AB", "#8E24AA", "#D81B60", "#6D4C41"];
const WFH_DEADLINE_HOUR = 18;
const WFH_ALERT_FROM = "2026-11-06"; // 기능을 시작한 날 — 이전 재택일은 달력 표시만 하고 팝업은 띄우지 않는다
const WFH_ALERT_REFETCH_MS = 10 * 60 * 1000;

function memberColorOf(m){ return m && /^#[0-9a-fA-F]{6}$/.test(m.color || "") ? m.color : null; }
// 배경색이 밝으면 어두운 글자, 어두우면 흰 글자
function colorBadgeStyle(color){
  if(!color) return "background:#E2E8F0;color:#475569;";
  const n = parseInt(color.slice(1), 16), yiq = ((n >> 16) * 299 + ((n >> 8 & 255) * 587) + ((n & 255) * 114)) / 1000;
  return "background:" + color + ";color:" + (yiq >= 170 ? "#17232E" : "#fff") + ";";
}

/* --- 팀원 관리: 색 고르기 --- */
function memberColorChipHtml(m){
  const c = memberColorOf(m);
  return '<button class="mc-chip' + (c ? '' : ' none') + '" title="배지 색 고르기" aria-label="' + esc(m.name) + ' 배지 색 고르기" style="' + (c ? 'background:' + c + ';' : '') + '" onclick="memberColorOpen(\'' + m.id + '\')"></button>';
}
function memberColorOpen(id){
  const m = state.members.find(x => x.id === id);
  if(!m || !isSysAdmin()) return;
  const cur = memberColorOf(m);
  const usedBy = (c) => state.members.filter(x => x.id !== id && memberColorOf(x) === c).map(x => x.name).join(", ");
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">' + esc(m.name) + ' 배지 색</div>' +
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:12px;">재택 달력에서 이 색으로 표시돼요. 이름이 적힌 색은 다른 팀원이 쓰고 있어요.</div>' +
    '<div class="mc-grid">' + MEMBER_COLORS.map(c => {
      const who = usedBy(c);
      return '<button class="mc-swatch' + (c === cur ? ' on' : '') + '" style="' + colorBadgeStyle(c) + '" title="' + esc(who) + '" onclick="setMemberColor(\'' + id + '\',\'' + c + '\')">' +
        (c === cur ? '✓' : esc(who)) + '</button>';
    }).join("") + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;">' +
      (cur ? '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;" onclick="setMemberColor(\'' + id + '\',\'\')">색 없애기</button>' : '') +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
    '</div>'
  );
}
function setMemberColor(id, color){
  const m = state.members.find(x => x.id === id);
  if(!m || !isSysAdmin()) return;
  if(color && MEMBER_COLORS.indexOf(color) < 0) return;
  if(color) m.color = color; else delete m.color;
  logActivity('팀원 배지 색 ' + (color ? '지정' : '해제') + ': ' + m.name);
  scheduleSave();
  closeModal();
  renderTabContent();
}

/* --- 재택 달력: 사람별 색 배지 --- */
// 관리자·팀장: 회원 이름·팀원 연결을 한 번 불러온다 (updateProfile에서 연결이 바뀌면 다시 불러옴)
async function wfhLoadProfiles(){
  if(wfh.names) return;
  const res = await sb.from("profiles").select("id,name,login_id,member_id,role");
  const names = {}, profs = {};
  (res.data || []).forEach(p => { names[p.id] = p.name || p.login_id; profs[p.id] = p; });
  wfh.names = names; wfh.profs = profs;
}
function wfhColorOfUser(userId){
  const p = wfh.profs && wfh.profs[userId];
  if(!p) return null;
  let m = p.member_id && state.members.find(x => x.id === p.member_id);
  if(!m){
    const same = state.members.filter(x => lkNorm(x.name) === lkNorm(p.name));
    if(same.length === 1) m = same[0];
  }
  return memberColorOf(m);
}
function wfhKst(){
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}
function wfhHasJournal(j){ return !!(j && String(j).trim()); }
function wfhDeadlinePassed(day){
  const k = wfhKst();
  return day < k.day || (day === k.day && k.hour >= WFH_DEADLINE_HOUR);
}
function wfhOverdue(day, journal){ return !wfhHasJournal(journal) && wfhDeadlinePassed(day); }
// 삭제된 회원·뷰어는 일지를 쓸 수 없으니 미작성으로 치지 않는다
function wfhCanOwe(userId){ return !!userId && !(wfh.profs && wfh.profs[userId] && wfh.profs[userId].role === "viewer"); }
function wfhOtherOverdue(day, o){ return wfhCanOwe(o.userId) && wfhOverdue(day, o.journal); }
// 달력 칸의 이름 배지. 앞의 표시는 말줄임에 잘리지 않게 이름보다 먼저 쓴다.
function wfhOtherBadgeHtml(key, o, i){
  const miss = wfhOtherOverdue(key, o), done = wfhHasJournal(o.journal);
  const label = o.name + ' · ' + WFH_KIND[o.kind] + (miss ? ' · 일지 미작성' : done ? ' · 일지 작성' : '');
  return '<div class="wfh-name click wfh-badge' + (miss ? ' miss' : '') + '" style="' + colorBadgeStyle(wfhColorOfUser(o.userId)) + '" title="' + esc(label) + '" onclick="event.stopPropagation();wfhOtherOpen(\'' + key + '\',' + i + ')">' +
    (miss ? '! ' : done ? '✓ ' : '') + esc(o.name) + '<span class="wfh-badge-kind"> · ' + WFH_KIND[o.kind] + '</span></div>';
}
// 이번 달 재택이 있는 사람별 색·일수 안내
function wfhLegendHtml(){
  const people = {};
  Object.keys(wfh.others).forEach(day => wfh.others[day].forEach(o => {
    const k = o.userId || "name:" + o.name;
    const p = people[k] = people[k] || { name: o.name, color: wfhColorOfUser(o.userId), days: 0, miss: 0 };
    p.days++;
    if(wfhOtherOverdue(day, o)) p.miss++;
  }));
  const list = Object.keys(people).map(k => people[k]).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if(list.length === 0) return "";
  return '<div class="wfh-legend">' + list.map(p =>
    '<span class="wfh-legend-item"><span class="wfh-legend-name" style="' + colorBadgeStyle(p.color) + '">' + esc(p.name) + '</span>' + p.days + '일' +
    (p.miss ? ' <b style="color:#DC2626;">미작성 ' + p.miss + '</b>' : '') + '</span>'
  ).join("") + '</div>';
}

/* --- 일지 미작성 알림 --- */
const wfhAlert = { items: [], timer: null, fetched: 0, marker: "", seq: 0, onVisible: null };

// 미작성 목록을 새로 계산한다. 다른 화면을 건드리지 않도록 팝업은 wfhAlertTick에서만 띄운다.
async function wfhAlertRefresh(){
  if(!currentProfile || !canWrite()) return;
  const me = currentProfile.id, k = wfhKst(), seq = ++wfhAlert.seq;
  wfhAlert.fetched = Date.now();
  wfhAlert.marker = k.day + (k.hour >= WFH_DEADLINE_HOUR ? "PM" : "AM");
  let q = sb.from("wfh_days").select("id,user_id,day,kind,journal").gte("day", WFH_ALERT_FROM).lte("day", k.day).not("user_id", "is", null);
  if(!isAdmin()) q = q.eq("user_id", me);
  const { data, error } = await q;
  if(isAdmin() && !error) await wfhLoadProfiles();
  if(error || seq !== wfhAlert.seq || !currentProfile || currentProfile.id !== me) return; // 실패하면 이전 목록 유지, 늦게 온 응답은 버림
  const items = (data || []).filter(r => wfhOverdue(r.day, r.journal))
    .filter(r => r.user_id === me || wfhCanOwe(r.user_id))
    .map(r => ({
      id: r.id, userId: r.user_id, day: r.day, kind: WFH_KIND[r.kind] ? r.kind : "full", mine: r.user_id === me,
      name: r.user_id === me ? (currentProfile.name || currentProfile.login_id) : wfhName(r, wfh.names),
    }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name, "ko"));
  const changed = items.map(x => x.id).join() !== wfhAlert.items.map(x => x.id).join();
  wfhAlert.items = items;
  if(!changed) return;
  if(document.getElementById("tabbar")) renderTabBar();
  if(state.tab === "dashboard" || state.tab === "wfh") renderTabContent();
}
async function wfhAlertTick(){
  if(!currentProfile || !canWrite() || document.hidden) return;
  const k = wfhKst(), marker = k.day + (k.hour >= WFH_DEADLINE_HOUR ? "PM" : "AM");
  if(marker !== wfhAlert.marker || Date.now() - wfhAlert.fetched >= WFH_ALERT_REFETCH_MS) await Promise.all([wfhAlertRefresh(), noticeTxRefresh()]);
  noticePopupIfNew(); // notice.js
}
// 알림에서 해당 달의 달력으로 옮겨 간 뒤 일지를 연다
async function wfhAlertGoMonth(day){
  wfh.ym = day.slice(0, 7); wfh.days = null; wfh.loadedYm = null;
  await wfhLoad();
  if(wfh.loadedYm !== day.slice(0, 7)) return false; // 불러오기 실패는 wfhLoad가 안내
  setTab("wfh");
  return true;
}
async function wfhAlertWrite(day){
  closeModal();
  if(!await wfhAlertGoMonth(day)) return;
  if(wfh.days[day]) wfhJournalOpen(day); else showToast("이미 삭제된 재택 일정이에요", { error: true });
}
async function wfhAlertView(day, id){
  closeModal();
  if(!await wfhAlertGoMonth(day)) return;
  const i = (wfh.others[day] || []).findIndex(o => o.id === id);
  if(i >= 0) wfhOtherOpen(day, i); else showToast("이미 삭제된 재택 일정이에요", { error: true });
}
function wfhAlertCount(){ return wfhAlert.items.length; }
// 데이터를 다 불러온 뒤(renderApp) 시작 — 1분마다 확인하고, 잠자기·다른 탭에서 돌아오면 바로 확인한다
function wfhAlertStart(){
  if(wfhAlert.timer || !currentProfile || !canWrite()) return;
  wfhAlert.timer = setInterval(wfhAlertTick, 60 * 1000);
  wfhAlert.onVisible = () => { if(!document.hidden) wfhAlertTick(); };
  document.addEventListener("visibilitychange", wfhAlert.onVisible);
  wfhAlertTick();
}
function wfhAlertReset(){
  if(wfhAlert.timer) clearInterval(wfhAlert.timer);
  if(wfhAlert.onVisible) document.removeEventListener("visibilitychange", wfhAlert.onVisible);
  noticeReset(); // notice.js
  Object.assign(wfhAlert, { items: [], timer: null, fetched: 0, marker: "", seq: wfhAlert.seq + 1, onVisible: null });
}
