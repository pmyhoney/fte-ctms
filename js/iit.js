/* ---------------- IIT 관리 탭 ----------------
   'FTE 관리 > 과제 배정'의 과제(공동 배정·인수인계는 한 과제)는 자동으로 목록에 보이고,
   품목·과제명·담당자·과제 유형·기간은 배정에서 그대로 끌어온다 (수정은 과제 배정 탭에서).
   과제코드·기관명·연구자명·지원범위·진행 현황·Publication은 이 탭에서 입력해 Supabase(iit_projects)에 저장하고,
   배정에 없는 과제는 이 탭에서 직접 추가할 수 있다 — supabase/migrations/20261102000000_iit_projects.sql */

const IIT_STATUS = ["제안", "준비중", "진행중", "종료"];
const IIT_STATUS_META = {
  "제안": { c: "#7C3AED", s: "#F1EBFD" }, "준비중": { c: "#B45309", s: "#FEF3E2" },
  "진행중": { c: "#1F5C8C", s: "#E6EFF7" }, "종료": { c: "#1E7A4F", s: "#E7F6EC" },
};
const IIT_PUB = ["미진행", "진행", "완료"];
const IIT_PUB_COLOR = { "미진행": "#94A3B8", "진행": "#B45309", "완료": "#1E7A4F" };
const IIT_EMPTY_F = () => ({ q: "", product: "", status: "", pub: "", hidden: false });
const iit = { rows: null, f: IIT_EMPTY_F() };

async function iitLoad(){
  try{
    iit.rows = await sbFetchAll(() => sb.from("iit_projects").select("id,group_id,data,hidden").order("created_at")); // worklog.js
  }catch(e){
    showToast("IIT 과제를 불러오지 못했어요: " + e.message, { error: true });
    iit.rows = iit.rows || [];
  }
  if(state.tab === "iit") renderTabContent();
}
function iitReload(){ iit.rows = null; renderTabContent(); }
function iitReset(){ iit.rows = null; iit.f = IIT_EMPTY_F(); }

// 배정 과제 → 목록 항목 (공동 배정·인수인계 레코드는 groupId로 묶어 한 과제로)
function iitAssignedProjects(){
  const tmap = taskTypeById(), pmap = productById(), out = {};
  fteAssignments().forEach(a => {
    const gid = a.groupId || a.id;
    (out[gid] = out[gid] || []).push(a);
  });
  return Object.keys(out).map(gid => {
    const list = out[gid].sort((x, y) => (x.startPeriod || "").localeCompare(y.startPeriod || ""));
    const last = list[list.length - 1], p = pmap[last.productId], t = tmap[last.taskTypeId];
    const names = [...new Set(list.map(a => { const m = state.members.find(x => x.id === a.memberId); return m ? m.name : ""; }).filter(Boolean))];
    const ends = list.map(a => a.endPeriod);
    return {
      gid, product: p ? p.name : "", taskName: last.taskName || "", manager: names.join(", "),
      type: t ? t.name : "", status: last.status || "",
      period: (list[0].startPeriod || "") + " ~ " + (ends.some(e => !e) ? "진행중" : ends.sort().pop()),
    };
  });
}

// 화면에 보일 전체 목록: 배정 과제(+IIT 입력값) / 직접 추가한 과제 / 배정이 지워진 과제(저장해 둔 값으로)
function iitAllRows(){
  const stored = iit.rows || [], byGid = {};
  stored.forEach(r => { if(r.group_id) byGid[r.group_id] = r; });
  const assigned = iitAssignedProjects();
  const live = new Set(assigned.map(a => a.gid));
  const rows = assigned.map(a => {
    const r = byGid[a.gid], d = r ? r.data : {};
    return Object.assign({}, d, {
      key: "g:" + a.gid, id: r ? r.id : null, gid: a.gid, linked: true, hidden: !!(r && r.hidden),
      product: a.product, taskName: a.taskName, manager: a.manager, type: a.type, period: a.period,
      status: d.status || (IIT_STATUS.includes(a.status) ? a.status : ""), ownStatus: d.status || "", assignStatus: a.status,
    });
  });
  stored.forEach(r => {
    if(r.group_id && live.has(r.group_id)) return;
    rows.push(Object.assign({}, r.data, { key: "r:" + r.id, id: r.id, gid: r.group_id, linked: false, orphan: !!r.group_id, hidden: r.hidden }));
  });
  return rows.sort((a, b) => (a.product || "힣").localeCompare(b.product || "힣", "ko") || (a.taskName || "").localeCompare(b.taskName || "", "ko"));
}
const iitPubStatus = (r) => (r.pub && r.pub.status) || "미진행";

function iitFiltered(all){
  const f = iit.f, q = f.q.trim().toLowerCase();
  return all.filter(r => !!r.hidden === f.hidden &&
    (!f.product || (r.product || "") === f.product) &&
    (!f.status || (r.status || r.assignStatus || "") === f.status) &&
    (!f.pub || iitPubStatus(r) === f.pub) &&
    (!q || [r.taskName, r.code, r.site, r.investigator, r.manager, r.product].some(v => (v || "").toLowerCase().includes(q))));
}
function iitFilter(key, value){ iit.f[key] = value; renderTabContentPreserveFocus(); }

function renderIitTab(){
  if(!iit.rows){
    if(!iit.loading){ iit.loading = true; iitLoad().finally(() => { iit.loading = false; }); }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  const all = iitAllRows(), shown = all.filter(r => !r.hidden), f = iit.f, list = iitFiltered(all);
  const hiddenCount = all.length - shown.length;
  const stat = (k, v) => '<div class="tr-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  const cnt = (pred) => shown.filter(pred).length;
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  const sel = (key, list) => '<select class="input view-ok" style="width:auto;" onchange="iitFilter(\'' + key + '\', this.value)">' + list.map(o => opt(o[0], o[1], f[key])).join("") + '</select>';
  const products = [...new Set(all.map(r => r.product).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  return '<div class="stack">' +
    '<div class="tr-stats">' +
      stat("전체 과제", shown.length + "건") +
      stat("제안 / 준비중", cnt(r => r.status === "제안") + " / " + cnt(r => r.status === "준비중")) +
      stat("진행중", cnt(r => r.status === "진행중") + "건") +
      stat("종료", cnt(r => r.status === "종료") + "건") +
      stat("Publication 진행 / 완료", cnt(r => iitPubStatus(r) === "진행") + " / " + cnt(r => iitPubStatus(r) === "완료")) +
    '</div>' +
    '<div class="card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:14px;">IIT 과제 목록 <span style="font-size:12px;color:#94A3B8;font-weight:600;">' + list.length + '건</span></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button class="btn-export view-ok" onclick="iitExport()">' + icon('download', 14) + ' 엑셀 다운로드</button>' +
          (canWrite() ? '<button class="add-btn view-ok" onclick="iitEditOpen(null)">' + icon('plus', 13) + ' 과제 추가</button>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<input id="iit-q" class="input view-ok" style="flex:1 1 200px;" placeholder="과제명·과제코드·기관·연구자·담당자 검색" value="' + esc(f.q) + '" oninput="iitFilter(\'q\', this.value)"/>' +
        sel("product", [["", "품목 전체"]].concat(products.map(p => [p, p]))) +
        sel("status", [["", "진행 현황 전체"]].concat(IIT_STATUS.map(s => [s, s]))) +
        sel("pub", [["", "Publication 전체"]].concat(IIT_PUB.map(s => [s, s]))) +
        (hiddenCount > 0 || f.hidden ? '<label class="view-ok" style="display:flex;align-items:center;gap:4px;font-size:12.5px;color:#64748B;"><input type="checkbox" class="view-ok"' + (f.hidden ? ' checked' : '') + ' onchange="iitFilter(\'hidden\', this.checked)"/> 목록에서 뺀 과제 (' + hiddenCount + ')</label>' : '') +
      '</div>' +
      iitListHtml(list, all.length) +
      '<div style="font-size:11.5px;color:#94A3B8;margin-top:10px;line-height:1.6;">' +
        '과제 배정 탭에 배정한 과제는 자동으로 목록에 추가되고, 품목명·과제명·담당자는 배정 정보를 그대로 보여줘요 (바꾸려면 과제 배정 탭에서 수정). ' +
        '진행 현황을 따로 고르지 않으면 배정의 과제 상태를 보여줘요.' +
      '</div>' +
    '</div>' +
  '</div>';
}

function iitStatusHtml(r){
  if(r.status){ const m = IIT_STATUS_META[r.status]; return '<span class="tr-chip" style="color:' + m.c + ';background:' + m.s + ';">' + esc(r.status) + '</span>'; }
  return r.assignStatus ? '<span class="tr-chip" style="color:#64748B;background:#EEF2F6;">' + esc(r.assignStatus) + '</span>' : '<span style="color:#94A3B8;">–</span>';
}
function iitSupportHtml(s){
  s = s || {};
  const items = [s.ip ? "IP" : "", s.fund ? "연구비" : "", s.etc ? "기타" + (s.etcText ? "(" + s.etcText + ")" : "") : ""].filter(Boolean);
  return items.length ? esc(items.join(", ")) : '<span style="color:#94A3B8;">–</span>';
}
// 웹 링크는 http(s)만 연결한다 (주소만 적었으면 https://를 붙임)
function iitSafeUrl(u){
  u = (u || "").trim();
  if(!u) return "";
  if(!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  return /^https?:\/\//i.test(u) ? u : "";
}
function iitPubHtml(r){
  const p = r.pub || {}, st = iitPubStatus(r);
  let html = '<span style="font-weight:700;color:' + IIT_PUB_COLOR[st] + ';">' + st + '</span>';
  if(st === "완료" && (p.journal || p.vol || p.title)){
    const url = iitSafeUrl(p.url);
    const title = p.title ? (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" class="view-ok" style="color:var(--accent);text-decoration:underline;">' + esc(p.title) + '</a>' : esc(p.title)) : '';
    html += '<div style="font-size:11.5px;color:#475569;margin-top:2px;line-height:1.45;">' +
      [p.journal ? '<i>' + esc(p.journal) + '</i>' : '', p.vol ? 'Vol. ' + esc(p.vol) : ''].filter(Boolean).join(", ") +
      (title ? '<div>' + title + '</div>' : '') + '</div>';
  }
  return html;
}

function iitListHtml(list, total){
  if(total === 0) return '<div class="empty">아직 과제가 없어요. 과제 배정 탭에서 배정하거나 \'과제 추가\'를 눌러 추가해 주세요.</div>';
  if(list.length === 0) return '<div class="empty">조건에 맞는 과제가 없어요.</div>';
  const edit = canWrite();
  const td = (v, style) => '<td style="white-space:normal;text-align:left;' + (style || '') + '">' + v + '</td>';
  const dash = (v) => v ? esc(v) : '<span style="color:#94A3B8;">–</span>';
  return '<div style="overflow-x:auto;"><table>' +
    '<thead><tr><th>품목명</th><th>과제코드</th><th>과제명</th><th>기관명</th><th>연구자명</th><th>담당자</th><th>지원범위</th><th>진행 현황</th><th>Publication</th>' + (edit ? '<th></th>' : '') + '</tr></thead><tbody>' +
    list.map(r => '<tr>' +
      td(r.product ? '<span class="product-tag">' + esc(r.product) + '</span>' : dash(""), "white-space:nowrap;") +
      td(dash(r.code), "white-space:nowrap;") +
      td('<div style="font-weight:700;">' + dash(r.taskName) + '</div>' +
        (r.linked ? '<div style="font-size:11px;color:#94A3B8;">' + esc([r.type, r.period].filter(Boolean).join(" · ")) + '</div>' :
          r.orphan ? '<div style="font-size:11px;color:#B45309;">배정에서 삭제된 과제</div>' : '<div style="font-size:11px;color:#94A3B8;">직접 추가</div>'), "min-width:180px;") +
      td(dash(r.site), "min-width:110px;") +
      td(dash(r.investigator), "white-space:nowrap;") +
      td(dash(r.manager), "white-space:nowrap;") +
      td(iitSupportHtml(r.support), "min-width:90px;font-size:12px;") +
      '<td>' + iitStatusHtml(r) + '</td>' +
      td(iitPubHtml(r), "min-width:140px;") +
      (edit ? '<td style="white-space:nowrap;">' +
        (r.hidden ? '<button class="add-btn view-ok" style="padding:5px 9px;font-size:12px;" onclick="iitUnhide(\'' + r.key + '\')">다시 표시</button>' :
          '<button class="icon-btn view-ok" title="수정" style="color:#64748B;" onclick="iitEditOpen(\'' + r.key + '\')">' + icon('edit', 14) + '</button>' +
          '<button class="icon-btn view-ok" title="' + (r.linked ? '목록에서 빼기' : '삭제') + '" onclick="iitDeleteConfirm(\'' + r.key + '\')">' + icon('trash', 14) + '</button>') +
      '</td>' : '') +
    '</tr>').join("") +
    '</tbody></table></div>';
}

const iitFind = (key) => iitAllRows().find(r => r.key === key);

function iitEditOpen(key){
  if(!canWrite()) return;
  const r = key ? iitFind(key) : null;
  if(key && !r) return;
  const v = (k) => esc(r && r[k] != null ? r[k] : "");
  const s = (r && r.support) || {}, p = (r && r.pub) || {};
  const field = (label, inner) => '<div class="field"><div class="field-label">' + label + '</div>' + inner + '</div>';
  const input = (k, ph, val) => '<input id="iit-' + k + '" class="input" type="text" placeholder="' + ph + '" value="' + (val != null ? esc(val) : v(k)) + '"/>';
  const fixed = (val) => '<div class="input" style="background:#F8FAFC;color:#475569;min-height:38px;">' + (val ? esc(val) : '<span style="color:#94A3B8;">–</span>') + '</div>';
  const check = (k, label, on) => '<label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="iit-sup-' + k + '"' + (on ? ' checked' : '') + (k === "etc" ? ' onchange="iitFormSync()"' : '') + '/> ' + label + '</label>';
  const radios = (name, list, cur, onchange) => '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + list.map(x =>
    '<label style="display:flex;align-items:center;gap:5px;font-size:13px;"><input type="radio" name="' + name + '" value="' + x + '"' + (x === cur ? ' checked' : '') + (onchange ? ' onchange="' + onchange + '"' : '') + '/> ' + x + '</label>').join("") + '</div>';
  const products = [...new Set(state.products.map(x => x.name).concat(iitAllRows().map(x => x.product)).filter(Boolean))];
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">' + (r ? 'IIT 과제 수정' : 'IIT 과제 추가') + '</div>' +
    '<div style="max-height:66vh;overflow-y:auto;">' +
      (r && r.linked ?
        '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:8px;">품목명·과제명·담당자는 과제 배정에서 가져온 값이에요. 바꾸려면 과제 배정 탭에서 수정해 주세요.</div>' +
        '<div class="wk-form" style="grid-template-columns:1fr 2fr;">' + field("품목명", fixed(r.product)) + field("과제명", fixed(r.taskName)) + '</div>' +
        field("담당자", fixed(r.manager))
      :
        '<div class="wk-form" style="grid-template-columns:1fr 2fr;">' +
          field("품목명", input("product", "예: 로제텔정").replace('/>', ' list="iit-product-list"/>') + '<datalist id="iit-product-list">' + products.map(x => '<option value="' + esc(x) + '">').join("") + '</datalist>') +
          field("과제명 *", input("taskName", "예: 로제텔정 시판 후 효과 연구")) +
        '</div>' +
        field("담당자", input("manager", "예: 홍길동"))) +
      '<div class="wk-form" style="grid-template-columns:1fr 1fr 1fr;">' +
        field("과제코드", input("code", "예: IIT-2026-01")) +
        field("기관명", input("site", "예: 서울대학교병원")) +
        field("연구자명", input("investigator", "예: 김연구")) +
      '</div>' +
      field("지원범위", '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">' + check("ip", "IP", s.ip) + check("fund", "연구비", s.fund) + check("etc", "기타", s.etc) +
        '<input id="iit-sup-etcText" class="input" type="text" style="flex:1 1 160px;" placeholder="기타 지원 내용" value="' + esc(s.etcText || "") + '"/></div>') +
      // 배정 과제에서 진행 현황을 고르지 않으면 배정의 과제 상태를 계속 따라간다
      field("진행 현황" + (r && r.linked && !r.ownStatus ? ' <span style="font-weight:500;color:#94A3B8;">(고르지 않으면 배정의 과제 상태를 따라가요 — 지금 ' + esc(r.assignStatus || "–") + ')</span>' : ''),
        radios("iit-status", IIT_STATUS, r ? (r.linked ? r.ownStatus : r.status) : "제안")) +
      field("Publication", radios("iit-pub", IIT_PUB, p.status || "미진행", "iitFormSync()")) +
      '<div id="iit-pubwrap" style="padding:10px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;margin-bottom:12px;">' +
        '<div class="wk-form" style="grid-template-columns:2fr 1fr;">' +
          field("투고 저널명", input("journal", "예: Journal of Hypertension", p.journal || "")) +
          field("Vol.", input("vol", "예: 44(3)", p.vol || "")) +
        '</div>' +
        field("논문 제목", input("title", "논문 제목", p.title || "")) +
        field("웹 링크 <span style=\"font-weight:500;color:#94A3B8;\">(있으면 논문 제목을 누르면 열려요)</span>", input("url", "예: https://doi.org/10.xxxx/xxxx", p.url || "")) +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="iit-save" style="flex:1;justify-content:center;" onclick="iitSave(' + (r ? '\'' + r.key + '\'' : 'null') + ')">저장</button>' +
    '</div>'
  );
  iitFormSync();
}
// 기타 지원 내용·논문 정보 칸은 해당 항목을 골랐을 때만 보여준다
function iitFormSync(){
  const etc = document.getElementById("iit-sup-etc"), etcText = document.getElementById("iit-sup-etcText");
  if(etc && etcText) etcText.style.display = etc.checked ? "" : "none";
  const pub = document.querySelector('input[name="iit-pub"]:checked'), wrap = document.getElementById("iit-pubwrap");
  if(wrap) wrap.style.display = pub && pub.value === "완료" ? "" : "none";
}

async function iitSave(key){
  const r = key ? iitFind(key) : null;
  if(key && !r){ closeModal(); return; }
  const val = (k) => { const el = document.getElementById("iit-" + k); return el ? el.value.trim() : ""; };
  const on = (k) => document.getElementById("iit-sup-" + k).checked;
  const radio = (name) => { const el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ""; };
  const pubStatus = radio("iit-pub") || "미진행";
  const data = {
    code: val("code"), site: val("site"), investigator: val("investigator"),
    support: { ip: on("ip"), fund: on("fund"), etc: on("etc"), etcText: on("etc") ? val("sup-etcText") : "" },
    status: radio("iit-status"),
    pub: pubStatus === "완료" ? { status: pubStatus, journal: val("journal"), vol: val("vol"), title: val("title"), url: val("url") } : { status: pubStatus },
  };
  // 배정 과제는 배정에서 지워졌을 때도 알아볼 수 있게 그때의 품목·과제명·담당자를 함께 저장해 둔다
  if(r && r.linked) Object.assign(data, { product: r.product, taskName: r.taskName, manager: r.manager });
  else Object.assign(data, { product: val("product"), taskName: val("taskName"), manager: val("manager") });
  if(!data.taskName){ showToast("과제명을 입력해 주세요", { error: true }); return; }
  if(data.pub.url && !iitSafeUrl(data.pub.url)){ showToast("웹 링크는 http:// 또는 https:// 주소로 입력해 주세요", { error: true }); return; }
  const rec = { data, updated_at: new Date().toISOString(), updated_by: currentProfile.id };
  const btn = document.getElementById("iit-save");
  if(btn) btn.disabled = true;
  // 권한이 없으면 오류 없이 0건이 바뀌므로, 바뀐 행을 돌려받아 확인한다
  const { data: res, error } = r && r.id
    ? await sb.from("iit_projects").update(rec).eq("id", r.id).select("id")
    : await sb.from("iit_projects").insert(Object.assign(rec, { group_id: r ? r.gid : null })).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!res || res.length === 0){ showToast("IIT 과제를 편집할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast(r ? "과제 정보를 수정했어요" : "과제를 추가했어요");
  iitReload();
}

function iitDeleteConfirm(key){
  const r = iitFind(key);
  if(!r) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">' + (r.linked ? 'IIT 목록에서 빼기' : 'IIT 과제 삭제') + '</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;"><b>' + esc(r.taskName) + '</b>' +
      (r.linked ? '을(를) IIT 목록에서 뺄까요?<br/>과제 배정은 그대로 남고, 입력한 IIT 정보도 보관돼요. \'목록에서 뺀 과제\'에서 다시 표시할 수 있어요.'
        : '을(를) 삭제할까요? 입력한 IIT 정보가 모두 지워지고 되돌릴 수 없어요.') + '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="iitDelete(\'' + key + '\')">' + (r.linked ? '목록에서 빼기' : '삭제') + '</button>' +
    '</div>'
  );
}
async function iitDelete(key){
  const r = iitFind(key);
  if(!r){ closeModal(); return; }
  let q;
  if(!r.linked) q = sb.from("iit_projects").delete().eq("id", r.id).select("id");
  else if(r.id) q = sb.from("iit_projects").update({ hidden: true, updated_at: new Date().toISOString(), updated_by: currentProfile.id }).eq("id", r.id).select("id");
  else q = sb.from("iit_projects").insert({ group_id: r.gid, hidden: true, data: { product: r.product, taskName: r.taskName, manager: r.manager } }).select("id");
  const { data, error } = await q;
  closeModal();
  if(error){ showToast("처리하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("IIT 과제를 편집할 권한이 없어요", { error: true }); return; }
  showToast(r.linked ? "IIT 목록에서 뺐어요" : "삭제했어요");
  iitReload();
}
async function iitUnhide(key){
  const r = iitFind(key);
  if(!r || !r.id) return;
  const { data, error } = await sb.from("iit_projects").update({ hidden: false, updated_at: new Date().toISOString(), updated_by: currentProfile.id }).eq("id", r.id).select("id");
  if(error || !data || data.length === 0){ showToast("처리하지 못했어요" + (error ? ": " + error.message : " (권한이 없어요)"), { error: true }); return; }
  showToast("IIT 목록에 다시 표시했어요");
  iitReload();
}

/* 엑셀: 탭의 '엑셀 다운로드'와 상단 '엑셀 내보내기'(IIT 관리) 모두 같은 시트 */
function iitExportRows(list){
  return list.map(r => {
    const s = r.support || {}, p = r.pub || {};
    return {
      "품목명": r.product || "", "과제코드": r.code || "", "과제명": r.taskName || "", "기관명": r.site || "", "연구자명": r.investigator || "",
      "담당자": r.manager || "", "과제 유형": r.type || "", "기간": r.period || "",
      "지원범위-IP": s.ip ? "O" : "", "지원범위-연구비": s.fund ? "O" : "", "지원범위-기타": s.etc ? (s.etcText || "O") : "",
      "진행 현황": r.status || r.assignStatus || "", "Publication": iitPubStatus(r),
      "투고 저널명": p.journal || "", "Vol.": p.vol || "", "논문 제목": p.title || "", "웹 링크": p.url || "",
      "구분": r.linked ? "과제 배정" : r.orphan ? "배정에서 삭제됨" : "직접 추가",
    };
  });
}
async function iitExportSheets(wb){
  if(!iit.rows) await iitLoad();
  appendSheetOrEmpty(wb, iitExportRows(iitAllRows().filter(r => !r.hidden)), "IIT 관리"); // app.js
}
async function iitExport(){ // 지금 화면의 필터 결과 그대로
  const wb = XLSX.utils.book_new();
  appendSheetOrEmpty(wb, iitExportRows(iitFiltered(iitAllRows())), "IIT 관리");
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("IIT관리_" + todayYmd() + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
