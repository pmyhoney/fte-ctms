/* ---------------- 입력 누락 알림 팝업 ----------------
   계획된 일정이 지났는데 실행 기록이 없는 항목을 로그인 때 팝업으로 모아 보여 주고, 항목별로 입력 화면으로 바로 보낸다.
   - 재택 일지: 재택일 오후 6시까지 일지 없음 (wfhalert.js)
   - CTMS 마일스톤: 계획월이 지났는데 실적월 없음 (화면의 '지연'과 같은 기준)
   - CTMS 이슈 F/U: 미해결 이슈의 가장 최근 F/U 목표일이 지남
   - 과제 인수인계: 인수자 배정이 시작됐는데 완료일 없음 (관리자·팀장만 입력할 수 있어 그 사람들에게만)
   - 교육: 팀내 전달교육 계획일이 지났는데 '완료'가 아님
   '오늘 하루 창 닫기'는 이 브라우저의 localStorage에 남겨 로그아웃·재로그인해도 그날은 자동으로 띄우지 않는다. */

const notice = { tx: [], uid: "", seen: null, hideMem: "" };
const NOTICE_SECTIONS = [["wfh", "재택 일지"], ["ctms", "CTMS"], ["ho", "과제 인수인계"], ["tx", "교육 (팀내 전달교육)"]];

function noticeWfhItems(){
  return wfhAlert.items.map(x => ({
    id: "wfh:" + x.id, sec: "wfh", wfh: x, go: () => x.mine ? wfhAlertWrite(x.day) : wfhAlertView(x.day, x.id),
  }));
}
function noticeCtmsItems(){
  const today = wfhKst().day, owner = currentProfile.member_id || "";
  if(!isAdmin() && !owner) return [];
  const mine = (g) => isAdmin() || g.members.some(m => m.memberId === owner && m.status !== "종료" && m.status !== "중단");
  const items = [];
  ctmsGroups().filter(ctmsIsOpen).filter(mine).forEach(g => {
    if(g.rec) ctmsSummary(g.rec).overdue.forEach(st => {
      const m = (g.rec.milestones || {})[st.key] || {};
      items.push({
        id: "ctms:" + g.gid + ":" + st.key, sec: "ctms", title: g.primary.taskName,
        sub: st.label + ' · 계획 ' + m.plan + ', 실적 미입력', go: () => noticeGoMilestone(g.gid, st.key),
      });
    });
    (state.ctmsIssues[g.gid] || []).forEach(e => {
      if(ctmsEntryType(e) !== "issue" || e.status === "resolved" || !e.needsFollowUp) return;
      const last = (e.followUps || []).slice().sort((a, b) => String(b.time).localeCompare(String(a.time)))[0];
      if(!last || !last.targetDate || last.targetDate >= today) return;
      items.push({
        id: "fu:" + g.gid + ":" + e.id + ":" + last.id, sec: "ctms", title: g.primary.taskName,
        sub: 'F/U 목표 ' + last.targetDate + ' 지남 · ' + e.title, go: () => noticeGoFollowUp(g.gid, e.id),
      });
    });
  });
  return items;
}
function noticeHandoverItems(){
  if(!isAdmin()) return [];
  const now = currentPeriod();
  return fteAssignments().filter(a => a.status !== "종료" && a.status !== "중단" && a.handover && a.handover.needed && !a.handover.doneDate && (!a.startPeriod || a.startPeriod <= now))
    .map(a => ({
      id: "ho:" + a.id, sec: "ho", title: a.taskName,
      sub: '인수자 ' + (lkMemberName(a.memberId) || "삭제된 팀원") + (a.handover.from ? ' · 인계자 ' + lkMemberName(a.handover.from) : '') + ' · 완료일 미입력',
      go: () => { closeModal(); setTab("assign"); hoEditOpen(a.id); },
    }));
}
function noticeTxItems(){
  return notice.tx.map(r => ({
    id: "tx:" + r.id, sec: "tx", title: r.title,
    sub: trMemberName(r) + ' · 전달교육 계획일 ' + r.tx_plan_date + ' 지남', go: () => noticeGoTraining(r.id),
  }));
}
function noticeItems(){
  if(!currentProfile || !canWrite()) return [];
  return noticeWfhItems().concat(noticeCtmsItems(), noticeHandoverItems(), noticeTxItems());
}

// 전달교육은 교육 탭을 열지 않아도 알 수 있도록 지난 계획만 따로 불러온다
async function noticeTxRefresh(){
  if(!currentProfile || !canWrite()) return;
  const me = currentProfile.id, mid = currentProfile.member_id;
  const { data, error } = await sb.from("trainings").select("id,user_id,member,member_id,title,tx_plan_date")
    .eq("scope", "사외").eq("tx_need", true).eq("tx_status", "plan").lt("tx_plan_date", wfhKst().day);
  if(error || !currentProfile || currentProfile.id !== me) return; // 실패하면 이전 목록 유지
  const rows = (data || []).filter(r => isAdmin() || r.user_id === me || (mid && r.member_id === mid))
    .sort((a, b) => a.tx_plan_date.localeCompare(b.tx_plan_date));
  const changed = rows.map(r => r.id).join() !== notice.tx.map(r => r.id).join();
  notice.tx = rows;
  if(changed && state.tab === "dashboard") renderTabContent();
}

/* --- 오늘 하루 창 닫기 --- */
function noticeHideKey(){ return "notice-hide:" + currentProfile.id; }
function noticeHiddenToday(){
  const today = wfhKst().day;
  if(notice.hideMem === currentProfile.id + ":" + today) return true;
  try{ return localStorage.getItem(noticeHideKey()) === today; }catch(e){ return false; }
}
function noticeHideToday(){
  notice.hideMem = currentProfile.id + ":" + wfhKst().day;
  try{ localStorage.setItem(noticeHideKey(), wfhKst().day); }catch(e){ /* 저장 못 하면 이번 접속 동안만 */ }
  closeModal();
  showToast("오늘은 알림 창을 띄우지 않을게요. 배정 현황의 '확인이 필요해요'에서 다시 볼 수 있어요.");
}

/* --- 이번 접속에서 이미 보여 준 항목 (로그아웃하거나 탭을 닫으면 잊는다) --- */
function noticeSeenKey(uid){ return "notice-seen:" + uid; }
function noticeSeen(){
  if(notice.seen) return notice.seen;
  notice.uid = currentProfile.id;
  let saved = [];
  try{ saved = JSON.parse(sessionStorage.getItem(noticeSeenKey(notice.uid)) || "[]"); }catch(e){ /* 없으면 처음부터 */ }
  return notice.seen = new Set(saved);
}
function noticeMarkSeen(items){
  const seen = noticeSeen();
  items.forEach(x => seen.add(x.id));
  try{ sessionStorage.setItem(noticeSeenKey(notice.uid), JSON.stringify(Array.from(seen))); }catch(e){ /* 이번 화면에서만 기억 */ }
}
function noticeReset(){
  try{ if(notice.uid) sessionStorage.removeItem(noticeSeenKey(notice.uid)); }catch(e){ /* 무시 */ }
  Object.assign(notice, { tx: [], uid: "", seen: null, hideMem: "" }); // '오늘 하루 닫기'의 localStorage 기록은 재로그인에도 유지
}

/* --- 팝업 --- */
// 새 항목이 있을 때만 띄운다. 입력 중인 팝업이나 칸을 가리지 않도록 다음 확인으로 미룬다.
function noticePopupIfNew(){
  if(!currentProfile) return;
  const items = noticeItems();
  if(!items.length || noticeHiddenToday()) return;
  const seen = noticeSeen();
  if(items.every(x => seen.has(x.id))) return;
  if(document.getElementById("modal-overlay")) return;
  const a = document.activeElement, tag = a && a.tagName;
  if(tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") return;
  noticeShow();
}
function noticeRowHtml(x){
  const btn = '<button class="add-btn notice-go" data-nid="' + esc(x.id) + '" onclick="noticeGo(this.dataset.nid)">바로 가기</button>';
  if(x.wfh){
    const w = x.wfh, dows = ["일", "월", "화", "수", "목", "금", "토"];
    return '<div class="list-row notice-row"><div class="notice-text"><div class="notice-title">' +
      (w.mine ? '내 일지' : '<span class="wfh-legend-name" style="' + colorBadgeStyle(wfhColorOfUser(w.userId)) + '">' + esc(w.name) + '</span>') + '</div>' +
      '<div class="notice-sub">' + w.day + ' (' + dows[new Date(w.day + "T00:00:00").getDay()] + ') · ' + WFH_KIND[w.kind] + ' · 일지 미작성</div></div>' + btn + '</div>';
  }
  return '<div class="list-row notice-row"><div class="notice-text"><div class="notice-title">' + esc(x.title) + '</div>' +
    '<div class="notice-sub">' + esc(x.sub) + '</div></div>' + btn + '</div>';
}
// only: 특정 구분만 보기 (재택 탭의 버튼)
function noticeShow(only){
  const all = noticeItems(), items = only ? all.filter(x => x.sec === only) : all;
  if(!items.length){ showToast("입력이 필요한 항목이 없어요"); return; }
  noticeMarkSeen(items);
  const sections = NOTICE_SECTIONS.map(([sec, label]) => {
    const list = items.filter(x => x.sec === sec);
    return list.length ? '<div class="notice-sec">' + label + ' <b>' + list.length + '</b></div>' + list.map(noticeRowHtml).join("") : '';
  }).join("");
  showModal(
    '<div style="display:flex;align-items:center;gap:7px;color:var(--danger);margin-bottom:6px;">' + icon('alert', 16) +
      '<span style="font-weight:800;font-size:14px;">입력이 필요한 항목 ' + items.length + '건</span></div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;">계획된 일정이 지났는데 실행 기록이 없어요. \'바로 가기\'를 누르면 입력 화면으로 이동해요.</div>' +
    '<div class="notice-list">' + sections + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:12px;">' +
      (noticeHiddenToday() ? '' : '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#64748B;border:1px solid var(--border);" onclick="noticeHideToday()">오늘 하루 창 닫기</button>') +
      '<button class="add-btn" style="flex:1;justify-content:center;" onclick="closeModal()">확인</button>' +
    '</div>', "md"
  );
}
function noticeGo(id){
  const x = noticeItems().find(i => i.id === id);
  closeModal();
  if(x) x.go(); else showToast("이미 처리된 항목이에요");
}
// 필터에 가려 카드가 안 보이는 일이 없도록 CTMS 목록 조건을 푼다
function noticeCtmsShowAll(sub){
  Object.assign(state.ctmsUi, { sub, view: "all", member: "전체", scope: "all", issueView: "all" });
}
function noticeGoMilestone(gid, key){
  noticeCtmsShowAll("tracker");
  state.ctmsUi.open[gid] = true;
  setTab("ctms");
  const row = document.getElementById("ms-row-" + gid + "-" + key);
  if(!row) return;
  row.scrollIntoView({ block: "center" });
  row.classList.add("notice-flash");
}
function noticeGoFollowUp(gid, entryId){
  noticeCtmsShowAll("issues");
  setTab("ctms");
  ctmsOpenFollowUp(gid, entryId);
}
async function noticeGoTraining(id){
  training.view = "list";
  training.f = { member: "", scope: "", type: "", tx: "", q: "" };
  if(!training.rows) await trainingLoad();
  setTab("training");
  const r = (training.rows || []).find(x => x.id === id);
  if(!r){ if(training.rows) showToast("이미 삭제된 교육 이력이에요", { error: true }); return; }
  if(trCanEdit(r)){ trainingEditOpen(id); return; }
  training.f.q = r.title; // 수정 권한이 없으면(등록자·관리자만 수정) 그 기록만 보여 준다
  renderTabContent();
  showToast("이 기록은 등록한 사람이나 관리자만 수정할 수 있어요");
}
// 배정 현황 '확인이 필요해요'에 넣을 문장 — 팝업을 닫은 뒤 다시 여는 곳
function noticeLines(){
  const items = noticeItems();
  if(!items.length) return [];
  const parts = NOTICE_SECTIONS.map(([sec, label]) => {
    const n = items.filter(x => x.sec === sec).length;
    return n ? label + ' ' + n + '건' : '';
  }).filter(Boolean);
  return ['입력이 필요한 항목 <b style="color:var(--danger);">' + items.length + '건</b> — ' + parts.join(' · ') +
    ' <button class="p360-btn view-ok" onclick="noticeShow()">목록 보기</button>'];
}
