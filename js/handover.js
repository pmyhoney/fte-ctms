/* ---------------- 과제 인수인계 ----------------
   과제 배정에서 담당자를 추가할 때(공동 배정) 인수인계 필요 여부를 표시하고,
   인계자·인수인계 완료일·과제 Training(교육 일자·내용)을 배정 기록(assignment.handover)에 남긴다.
   Training을 진행했으면 교육 탭의 교육 이력(trainings)에 '과제' 유형 사내 교육으로 자동 등록하고,
   여기서 고치거나 Training 진행을 해제하면 연결된 교육 이력도 함께 고치거나 지운다.
   assignment.handover = { needed, from, doneDate, training: { done, date, contents, trainingId } } */

const hoMemberName = (id) => { const m = state.members.find(x => x.id === id); return m ? m.name : ""; };

// 인계자 후보: 같은 과제의 다른 담당자. 기본값은 지금 담당 중인 사람, 없으면 가장 최근에 끝난 사람
function hoFromCandidates(a, excludeId){
  return assignmentGroupMembers(a).filter(x => x.memberId !== excludeId && !isLeaderMember(x.memberId));
}
function hoDefaultFrom(list){
  const now = currentPeriod();
  const active = list.filter(x => isActive(x, now));
  const pick = (active.length ? active : list.slice().sort((x, y) => String(y.endPeriod || "9999").localeCompare(String(x.endPeriod || "9999"))))[0];
  return pick ? pick.memberId : "";
}

// 입력 칸 (p: id 앞부분, ho: 기존 값, fromList: 인계자 후보)
function hoFieldsHtml(p, ho, fromList){
  const tr = (ho && ho.training) || {};
  const from = ho && ho.from !== undefined ? ho.from : hoDefaultFrom(fromList);
  const names = [...new Set(fromList.map(x => x.memberId))];
  const toggle = (id, box) => 'onchange="document.getElementById(\'' + box + '\').style.display=this.checked?\'\':\'none\'"';
  return '<div id="' + p + '-ho-box" style="' + (ho && ho.needed ? '' : 'display:none;') + 'padding:10px;border:1px solid var(--border);border-radius:8px;background:#F8FAFC;margin-bottom:10px;">' +
    '<div class="row">' +
      '<div class="field"><div class="field-label">인계자</div><select class="input" id="' + p + '-ho-from"><option value="">선택 안 함</option>' +
        names.map(id => '<option value="' + id + '"' + (id === from ? ' selected' : '') + '>' + esc(hoMemberName(id) || "삭제된 팀원") + '</option>').join("") + '</select></div>' +
      '<div class="field"><div class="field-label">인수인계 완료일</div><input class="input" id="' + p + '-ho-done" type="date" value="' + esc(ho && ho.doneDate || "") + '"/></div>' +
    '</div>' +
    '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer;margin:2px 0 8px;">' +
      '<input type="checkbox" id="' + p + '-ho-tr"' + (tr.done ? ' checked' : '') + ' ' + toggle(p + "-ho-tr", p + "-ho-tr-box") + '/> 과제 Training 진행</label>' +
    '<div id="' + p + '-ho-tr-box" style="' + (tr.done ? '' : 'display:none;') + '">' +
      '<div class="field"><div class="field-label">교육 일자 *</div><input class="input" id="' + p + '-ho-tr-date" type="date" value="' + esc(tr.date || "") + '"/></div>' +
      '<div class="field"><div class="field-label">교육 contents *</div><textarea class="input" id="' + p + '-ho-tr-contents" rows="3" style="resize:vertical;" placeholder="예: 프로토콜·CRF 개요, 진행 현황, 기관별 이슈, 문서 위치">' + esc(tr.contents || "") + '</textarea></div>' +
      '<div style="font-size:11.5px;color:#94A3B8;line-height:1.5;">저장하면 교육 탭의 교육 이력에 \'과제\' 유형 사내 교육으로 함께 등록돼요.</div>' +
    '</div>' +
  '</div>';
}
function hoCheckboxHtml(p, on){
  return '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer;margin:4px 0 8px;">' +
    '<input type="checkbox" id="' + p + '-ho"' + (on ? ' checked' : '') + ' onchange="document.getElementById(\'' + p + '-ho-box\').style.display=this.checked?\'\':\'none\'"/> 인수인계 필요</label>';
}

// 입력값 읽기: 인수인계 불필요면 null, 빠진 값이 있으면 { error }
function hoCollect(p, prev){
  if(!document.getElementById(p + "-ho").checked) return null;
  const v = (k) => document.getElementById(p + "-ho-" + k).value.trim();
  const trOn = document.getElementById(p + "-ho-tr").checked;
  const ho = {
    needed: true, from: v("from"), doneDate: v("done"),
    training: { done: trOn, date: trOn ? v("tr-date") : "", contents: trOn ? v("tr-contents") : "",
      trainingId: prev && prev.training ? prev.training.trainingId || null : null },
  };
  if(trOn){
    const miss = [];
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ho.training.date)) miss.push("교육 일자");
    if(!ho.training.contents) miss.push("교육 contents");
    if(miss.length) return { error: miss.join(", ") + "을(를) 입력해 주세요" };
  }
  return ho;
}

// 교육 이력(trainings)에 반영: Training 진행이면 추가·수정, 아니면 연결된 기록 삭제
async function hoSyncTraining(a, prevTrainingId){
  const ho = a.handover, tr = ho && ho.training;
  const id = (tr && tr.trainingId) || prevTrainingId || null;
  try{
    if(tr && tr.done){
      const rec = {
        member: hoMemberName(a.memberId), member_id: a.memberId || null, edu_date: tr.date, title: "[인수인계] " + a.taskName,
        org: ho.from ? "인계자 " + hoMemberName(ho.from) : "", hours: null, scope: "사내", edu_type: "과제",
        note: tr.contents + "\n(과제 배정 인수인계에서 등록)",
        tx_need: false, tx_status: null, tx_plan_date: null, tx_done_date: null, updated_at: new Date().toISOString(),
      };
      let saved = null;
      if(id){
        const { data, error } = await sb.from("trainings").update(rec).eq("id", id).select("id");
        if(error) throw error;
        if(data.length) saved = id;
        else{
          // 교육 탭에서 지운 기록이면 새로 만들고, 남아 있는데 못 고친 것이면 권한 문제
          const { data: still } = await sb.from("trainings").select("id").eq("id", id);
          if(still && still.length) throw new Error("이 교육 이력을 수정할 권한이 없어요 (등록한 사람이나 관리자만 수정 가능)");
        }
      }
      if(!saved){
        const { data, error } = await sb.from("trainings").insert(rec).select("id");
        if(error) throw error;
        saved = data[0].id;
      }
      tr.trainingId = saved;
    }else if(id){
      const { error } = await sb.from("trainings").delete().eq("id", id);
      if(error) throw error;
      if(tr) tr.trainingId = null;
    }
  }catch(e){
    showToast("교육 이력에 반영하지 못했어요: " + e.message, { error: true });
  }
  training.rows = null; // worklog.js — 교육 탭은 다음에 열 때 새로 불러온다
  scheduleSave();
  renderTabContent();
}

// 담당자 행에 붙는 인수인계 표시 (누르면 수정)
function hoChipHtml(a){
  const ho = a.handover;
  const chip = (text, bg, color, title) => '<span title="' + esc(title || "") + '" style="font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;background:' + bg + ';color:' + color + ';white-space:nowrap;">' + text + '</span>';
  if(!ho || !ho.needed) return '';
  const tr = ho.training || {};
  return '<span onclick="hoEditOpen(\'' + a.id + '\')" style="display:inline-flex;gap:4px;cursor:pointer;">' +
    (ho.doneDate ? chip("인수인계 완료 " + ho.doneDate.slice(5).replace("-", "/"), "#E7F6EC", "#1E7A4F", "인계자: " + (hoMemberName(ho.from) || "–") + " · 완료일 " + ho.doneDate)
      : chip("인수인계 진행중", "#FEF3E2", "#B45309", "인계자: " + (hoMemberName(ho.from) || "–"))) +
    (tr.done ? chip("Training " + tr.date.slice(5).replace("-", "/"), "#E6EFF7", "#1F5C8C", tr.contents) : '') +
  '</span>';
}
// 같은 과제에 담당자가 둘 이상일 때만 인수인계를 기록할 수 있다
function hoEditBtnHtml(a){
  if(a.handover) return ''; // 이미 기록했거나 '필요 없음'으로 저장한 담당자
  if(!a.groupId || a.id === a.groupId) return ''; // 처음 배정된 담당자(보통 인계자)에게는 표시하지 않는다
  if(hoFromCandidates(a, a.memberId).length === 0) return '';
  return '<button class="icon-btn" title="인수인계 기록" style="font-size:11px;font-weight:700;color:#64748B;width:auto;padding:0 6px;" onclick="hoEditOpen(\'' + a.id + '\')">인계</button>';
}
// '필요 없음'으로 저장한 뒤 생각이 바뀌었을 때 되돌리는 길 (배정 기간 수정 패널 안)
function hoReopenHtml(a){
  if(!a.handover || a.handover.needed || !isAdmin()) return '';
  return '<div style="font-size:11px;color:#94A3B8;margin-bottom:8px;">인수인계 필요 없음으로 저장됨 · ' +
    '<a href="#" style="color:#1F5C8C;font-weight:700;" onclick="event.preventDefault();hoEditOpen(\'' + a.id + '\')">변경</a></div>';
}

function hoEditOpen(id){
  const a = state.assignments.find(x => x.id === id);
  if(!a || !isAdmin()) return;
  const ho = a.handover || null;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:4px;">인수인계</div>' +
    '<div style="font-size:12.5px;color:#94A3B8;margin-bottom:12px;">' + esc(a.taskName) + ' · 인수자 ' + esc(hoMemberName(a.memberId) || "삭제된 팀원") + '</div>' +
    hoCheckboxHtml("hoe", !ho || ho.needed) +
    hoFieldsHtml("hoe", ho ? ho : { needed: true }, hoFromCandidates(a, a.memberId)) +
    (ho && ho.training && ho.training.trainingId ? '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px;">\'인수인계 필요\'나 \'과제 Training 진행\'을 해제하면 교육 탭에 등록된 교육 이력도 함께 지워져요.</div>' : '') +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;" onclick="hoEditSave(\'' + id + '\')">저장</button>' +
    '</div>', "md"
  );
}
function hoEditSave(id){
  const a = state.assignments.find(x => x.id === id);
  if(!a) return;
  const prevId = a.handover && a.handover.training ? a.handover.training.trainingId : null;
  const ho = hoCollect("hoe", a.handover);
  if(ho && ho.error){ showToast(ho.error, { error: true }); return; }
  a.handover = ho || { needed: false }; // null(아직 안 정함)과 구분해 '필요 없음'을 저장한다
  logActivity('인수인계 ' + (ho ? '기록' : '필요 없음') + ': "' + a.taskName + '" → ' + hoMemberName(a.memberId));
  closeModal();
  hoSyncTraining(a, prevId);
  if(ho) hoEndSuggest(a); // links.js — 인수인계를 마쳤으면 인계자 종료월 확인
}
