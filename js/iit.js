/* ---------------- IIT 관리 탭 ----------------
   'FTE 관리 > 과제 배정'에서 과제 유형이 IIT[SC]·IIT[PC]인 과제(공동 배정·인수인계는 한 과제)는 자동으로 목록에 보이고,
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
const IIT_EMPTY_F = () => ({ q: "", line: "", product: "", status: "", pub: "", hidden: false });
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

// 과제 유형 이름이 IIT[SC]·IIT[PC]인 것만 (띄어쓰기·괄호 차이는 무시: "IIT SC"도 같은 유형)
const IIT_TYPE_KEYS = ["IITSC", "IITPC"];
function isIitTaskType(t){ return !!t && IIT_TYPE_KEYS.includes(String(t.name || "").toUpperCase().replace(/[^A-Z]/g, "")); }
// 과제 구분: IIT[SC] → SC, IIT[PC] → PC
const iitLineOf = (t) => isIitTaskType(t) ? String(t.name).toUpperCase().replace(/[^A-Z]/g, "").slice(3) : "";
// 품목명 위에 SC·PC 구분 뱃지를 얹어 보여준다 (품목명은 일반 글씨)
function iitProductHtml(r, size){
  const line = r.line === "SC" || r.line === "PC" ? lineTagHtml(r.line) : ""; // app.js
  return (line ? '<div style="line-height:1;margin-bottom:3px;">' + line + '</div>' : '') +
    (r.product ? '<div style="font-size:' + (size || 13) + 'px;">' + esc(r.product) + '</div>' : (line ? '' : '<span style="color:#94A3B8;">–</span>'));
}

// 배정 과제 → 목록 항목 (공동 배정·인수인계 레코드는 groupId로 묶어 한 과제로), IIT 유형 과제만
function iitAssignedProjects(){
  const tmap = taskTypeById(), pmap = productById(), out = {};
  fteAssignments().forEach(a => {
    const gid = a.groupId || a.id;
    (out[gid] = out[gid] || []).push(a);
  });
  return Object.keys(out).filter(gid => out[gid].some(a => isIitTaskType(tmap[a.taskTypeId]))).map(gid => {
    const list = out[gid].sort((x, y) => (x.startPeriod || "").localeCompare(y.startPeriod || ""));
    const last = list[list.length - 1], p = pmap[last.productId], t = tmap[last.taskTypeId];
    const iitType = tmap[(list.slice().reverse().find(a => isIitTaskType(tmap[a.taskTypeId])) || last).taskTypeId];
    // 담당자는 이번 달에 실제로 수행 중인 사람만 (종료된 전 담당자 제외, 수행 중인 사람이 없으면 전체)
    const now = currentPeriod(), activeNow = list.filter(a => isActive(a, now));
    const names = [...new Set((activeNow.length ? activeNow : list).map(a => { const m = state.members.find(x => x.id === a.memberId); return m ? m.name : ""; }).filter(Boolean))];
    const ends = list.map(a => a.endPeriod);
    return {
      gid, product: p ? p.name : "", taskName: last.taskName || "", manager: names.join(", "),
      type: t ? t.name : "", line: iitLineOf(iitType), status: last.status || "",
      period: (list[0].startPeriod || "") + " ~ " + (ends.some(e => !e) ? "진행중" : ends.sort().pop()),
    };
  });
}

// 화면에 보일 전체 목록: IIT 유형 배정 과제(+IIT 입력값) / 직접 추가한 과제 / 배정이 지워진 과제(저장해 둔 값으로)
// 배정에 남아 있지만 IIT 유형이 아닌 과제(유형을 바꾼 경우 등)의 입력값은 목록에 보이지 않는다
function iitAllRows(){
  const stored = iit.rows || [], byGid = {};
  stored.forEach(r => { if(r.group_id) byGid[r.group_id] = r; });
  const assigned = iitAssignedProjects();
  const live = new Set(state.assignments.map(a => a.groupId || a.id));
  const rows = assigned.map(a => {
    const r = byGid[a.gid], d = r ? r.data : {};
    return Object.assign({}, d, {
      key: "g:" + a.gid, id: r ? r.id : null, gid: a.gid, linked: true, hidden: !!(r && r.hidden),
      product: a.product, taskName: a.taskName, manager: a.manager, type: a.type, line: a.line, period: a.period,
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
// 논문 목록: pub.papers[] (예전 형식 — pub에 저널·제목을 바로 저장한 1편 — 도 읽는다)
function iitPapers(pub){
  pub = pub || {};
  if(Array.isArray(pub.papers)) return pub.papers;
  return pub.journal || pub.vol || pub.title || pub.url ? [{ journal: pub.journal || "", vol: pub.vol || "", title: pub.title || "", url: pub.url || "" }] : [];
}

function iitFiltered(all){
  const f = iit.f, q = f.q.trim().toLowerCase();
  return all.filter(r => !!r.hidden === f.hidden &&
    (!f.line || r.line === f.line) &&
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
        sel("line", [["", "SC·PC 전체"], ["SC", "SC"], ["PC", "PC"]]) +
        sel("product", [["", "품목 전체"]].concat(products.map(p => [p, p]))) +
        sel("status", [["", "진행 현황 전체"]].concat(IIT_STATUS.map(s => [s, s]))) +
        sel("pub", [["", "Publication 전체"]].concat(IIT_PUB.map(s => [s, s]))) +
        (hiddenCount > 0 || f.hidden ? '<label class="view-ok" style="display:flex;align-items:center;gap:4px;font-size:12.5px;color:#64748B;"><input type="checkbox" class="view-ok"' + (f.hidden ? ' checked' : '') + ' onchange="iitFilter(\'hidden\', this.checked)"/> 목록에서 뺀 과제 (' + hiddenCount + ')</label>' : '') +
      '</div>' +
      iitListHtml(list, all.length) +
      '<div style="font-size:11.5px;color:#94A3B8;margin-top:10px;line-height:1.6;">' +
        '과제 배정 탭에서 과제 유형이 IIT[SC]·IIT[PC]인 과제는 자동으로 목록에 추가되고, 품목명·과제명·담당자는 배정 정보를 그대로 보여줘요 (바꾸려면 과제 배정 탭에서 수정). ' +
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
  const st = iitPubStatus(r), papers = st === "완료" ? iitPapers(r.pub) : [];
  let html = '<span style="font-weight:700;color:' + IIT_PUB_COLOR[st] + ';">' + st + '</span>' + (papers.length > 1 ? ' <span style="font-size:11px;color:#94A3B8;">' + papers.length + '편</span>' : '');
  papers.forEach((p, i) => {
    const url = iitSafeUrl(p.url);
    const title = p.title ? (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" class="view-ok" onclick="event.stopPropagation()" style="color:var(--accent);text-decoration:underline;">' + esc(p.title) + '</a>' : esc(p.title)) : '';
    html += '<div style="font-size:11.5px;color:#475569;margin-top:4px;line-height:1.45;' + (i > 0 ? 'padding-top:4px;border-top:1px dashed var(--border);' : '') + '">' +
      (papers.length > 1 ? '<b style="color:#94A3B8;">' + (i + 1) + '.</b> ' : '') +
      [p.journal ? '<i>' + esc(p.journal) + '</i>' : '', p.vol ? 'Vol. ' + esc(p.vol) : ''].filter(Boolean).join(", ") +
      (title ? '<div>' + title + '</div>' : '') + '</div>';
  });
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
    list.map(r => '<tr class="iit-row" title="눌러서 상세 정보 보기" onclick="iitDetailOpen(\'' + r.key + '\')">' +
      td(iitProductHtml(r), "white-space:nowrap;") +
      td(dash(r.code), "white-space:nowrap;") +
      td('<div style="font-weight:700;">' + dash(r.taskName) + iitContractBadgeHtml(r) + '</div>' +
        (r.linked ? '<div style="font-size:11px;color:#94A3B8;">' + esc([r.type, r.period].filter(Boolean).join(" · ")) + '</div>' :
          r.orphan ? '<div style="font-size:11px;color:#B45309;">배정에서 삭제된 과제</div>' : '<div style="font-size:11px;color:#94A3B8;">직접 추가</div>'), "min-width:180px;") +
      td(dash(r.site), "min-width:110px;") +
      td(dash(r.investigator), "white-space:nowrap;") +
      td(dash(r.manager), "white-space:nowrap;") +
      td(iitSupportHtml(r.support), "min-width:90px;font-size:12px;") +
      '<td>' + iitStatusHtml(r) + '</td>' +
      td(iitPubHtml(r), "min-width:140px;") +
      (edit ? '<td style="white-space:nowrap;" onclick="event.stopPropagation()">' +
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
    '<div class="modal-scroll">' +
      (r && r.linked ?
        '<div style="font-size:11.5px;color:#94A3B8;margin-bottom:8px;">과제 구분·품목명·과제명·담당자는 과제 배정에서 가져온 값이에요. 바꾸려면 과제 배정 탭에서 수정해 주세요.</div>' +
        '<div class="wk-form" style="grid-template-columns:110px 1fr 2fr;">' + field("과제 구분", fixed(r.line)) + field("품목명", fixed(r.product)) + field("과제명", fixed(r.taskName)) + '</div>' +
        field("담당자", fixed(r.manager))
      :
        '<div class="wk-form" style="grid-template-columns:110px 1fr 2fr;">' +
          field("과제 구분", '<select id="iit-line" class="input"><option value="">선택 안 함</option>' + ["SC", "PC"].map(x => '<option' + (r && r.line === x ? ' selected' : '') + '>' + x + '</option>').join("") + '</select>') +
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
      '<div id="iit-pubwrap" style="margin-bottom:12px;">' +
        '<div id="iit-papers"></div>' +
        '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:var(--accent);border:1px dashed var(--accent);" onclick="iitPaperAdd()">' + icon('plus', 13) + ' 논문 추가</button>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="iit-save" style="flex:1;justify-content:center;" onclick="iitSave(' + (r ? '\'' + r.key + '\'' : 'null') + ')">저장</button>' +
    '</div>', "wide"
  );
  iit.formPapers = iitPapers(p).map(x => Object.assign({}, x));
  if(iit.formPapers.length === 0) iit.formPapers.push({ journal: "", vol: "", title: "", url: "" });
  iitPapersRender();
  iitFormSync();
}

// 논문 입력 칸: 추가·삭제할 때마다 입력값을 먼저 iit.formPapers에 옮겨 담고 다시 그린다
const IIT_PAPER_KEYS = ["journal", "vol", "title", "url"];
function iitPapersCollect(){
  iit.formPapers.forEach((p, i) => IIT_PAPER_KEYS.forEach(k => {
    const el = document.getElementById("iit-p" + i + "-" + k);
    if(el) p[k] = el.value.trim();
  }));
}
function iitPapersRender(){
  const box = document.getElementById("iit-papers");
  if(!box) return;
  const n = iit.formPapers.length;
  const field = (label, inner) => '<div class="field"><div class="field-label">' + label + '</div>' + inner + '</div>';
  const input = (i, k, ph) => '<input id="iit-p' + i + '-' + k + '" class="input" type="text" placeholder="' + ph + '" value="' + esc(iit.formPapers[i][k] || "") + '"/>';
  box.innerHTML = iit.formPapers.map((p, i) =>
    '<div style="padding:10px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
        '<span style="font-size:12.5px;font-weight:800;color:#475569;">논문 ' + (i + 1) + '</span>' +
        (n > 1 ? '<button class="icon-btn" title="이 논문 삭제" onclick="iitPaperRemove(' + i + ')">' + icon('trash', 13) + '</button>' : '') +
      '</div>' +
      '<div class="wk-form" style="grid-template-columns:2fr 1fr;">' +
        field("투고 저널명", input(i, "journal", "예: Journal of Hypertension")) +
        field("Vol.", input(i, "vol", "예: 44(3)")) +
      '</div>' +
      field("논문 제목", input(i, "title", "논문 제목")) +
      field("웹 링크 <span style=\"font-weight:500;color:#94A3B8;\">(있으면 논문 제목을 누르면 열려요)</span>", input(i, "url", "예: https://doi.org/10.xxxx/xxxx")) +
    '</div>').join("");
}
function iitPaperAdd(){ iitPapersCollect(); iit.formPapers.push({ journal: "", vol: "", title: "", url: "" }); iitPapersRender(); }
function iitPaperRemove(i){ iitPapersCollect(); iit.formPapers.splice(i, 1); iitPapersRender(); }

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
    pub: { status: pubStatus },
  };
  // 논문 정보는 '완료'일 때만 저장하고, 칸이 모두 빈 논문은 버린다
  if(pubStatus === "완료"){ iitPapersCollect(); data.pub.papers = iit.formPapers.filter(p => IIT_PAPER_KEYS.some(k => p[k])); }
  // 배정 과제는 배정에서 지워졌을 때도 알아볼 수 있게 그때의 품목·과제명·담당자를 함께 저장해 둔다
  if(r && r.linked) Object.assign(data, { line: r.line, product: r.product, taskName: r.taskName, manager: r.manager });
  else Object.assign(data, { line: val("line"), product: val("product"), taskName: val("taskName"), manager: val("manager") });
  if(!data.taskName){ showToast("과제명을 입력해 주세요", { error: true }); return; }
  const badUrl = data.pub.papers ? iit.formPapers.findIndex(p => p.url && !iitSafeUrl(p.url)) : -1; // 화면의 논문 번호 그대로 알려준다
  if(badUrl >= 0){ showToast("논문 " + (badUrl + 1) + "의 웹 링크는 http:// 또는 https:// 주소로 입력해 주세요", { error: true }); return; }
  // 상세 팝업에서 입력한 값(detail)은 그대로 둔다
  const rec = { data: Object.assign({}, iitStoredData(r), data), updated_at: new Date().toISOString(), updated_by: currentProfile.id };
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
    const s = r.support || {}, papers = iitPubStatus(r) === "완료" ? iitPapers(r.pub) : [];
    const col = (k) => papers.map(p => p[k] || "").join("\n"); // 논문이 여러 편이면 셀 안에서 줄을 바꿔 순서대로
    const v = iitDetailView(r), f = v.fund, res = v.result, n = (x) => x === null ? "" : x;
    return {
      "구분": r.line || "", "품목명": r.product || "", "과제코드": r.code || "", "과제명": r.taskName || "", "기관명": r.site || "", "연구자명": r.investigator || "",
      "담당자": r.manager || "", "과제 유형": r.type || "", "기간": r.period || "",
      "지원범위-IP": s.ip ? "O" : "", "지원범위-연구비": s.fund ? "O" : "", "지원범위-기타": s.etc ? (s.etcText || "O") : "",
      "진행 현황": r.status || r.assignStatus || "", "Publication": iitPubStatus(r),
      "논문 수": papers.length || "", "투고 저널명": col("journal"), "Vol.": col("vol"), "논문 제목": col("title"), "웹 링크": col("url"),
      "RRC 승인일": v.rrc.date || v.rrc.month, "계약체결일": v.contract.date || v.contract.month, "계약만료일": v.contractEnd, "계약 확인": iitContractState(v.contractEnd) || "",
      "목표 대상자수": n(v.subjTarget), "등록 대상자수": n(v.subjEnrolled), "완료 대상자수": n(v.subjCompleted),
      "연구비 총액(원)": f.na ? "해당 없음" : n(f.total ?? null),
      "연구비 차수": f.na ? "" : f.rounds.map((x, i) => (i + 1) + "차 " + Number(x.amount || 0).toLocaleString("ko-KR") + "원" + (x.date ? " " + x.date : "") + (x.paid ? " 지급완료" : "")).join("\n"),
      "연구비 지급 완료(원)": f.na || !f.rounds.length ? "" : f.rounds.filter(x => x.paid).reduce((s, x) => s + (Number(x.amount) || 0), 0),
      "IP 제공 현황": [v.ip.status, v.ip.memo].filter(Boolean).join(" · "),
      "결과 수령": [res.csr ? "CSR" + (res.csrDate ? " " + res.csrDate : "") : "", res.ms ? "Manuscript" + (res.msDate ? " " + res.msDate : "") : ""].filter(Boolean).join(", "),
      "등록 경로": r.linked ? "과제 배정" : r.orphan ? "배정에서 삭제됨" : "직접 추가",
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

/* ---------------- 과제 상세 팝업 (목록에서 행을 누르면 열림) ----------------
   - RRC 승인일·계약체결일: 배정 과제는 CTMS 마일스톤(RRC 승인·계약 체결)의 실적월과 연동한다.
     날짜는 IIT 탭에 저장하고, 그 달(YYYY-MM)을 CTMS 실적월로 함께 바꾼다.
   - 목표·등록·완료 대상자수: 배정 과제는 CTMS 기록(subjTarget·subjEnrolled·subjCompleted)을 그대로 읽고 쓴다.
     CTMS 쪽 값은 CTMS 탭과 같은 기준(관리자·팀장, 그 과제 담당자)으로만 고칠 수 있다.
   - 계약만료일·연구비·IP 제공·결과 수령은 CTMS에 없는 정보라 IIT 탭(iit_projects.data.detail)에만 저장한다. */
const IIT_IP_STATUS = ["해당 없음", "제공 예정", "제공 중", "제공 완료"];

function iitStoredData(r){ return r && r.id ? ((iit.rows || []).find(x => x.id === r.id) || {}).data || {} : {}; }
function iitAddMonthsYmd(s, n){
  const [y, m, d] = String(s).split("-").map(Number);
  return ymd(new Date(y, m - 1 + n, d)); // worklog.js
}
// 계약만료일 3개월 전부터 '확인', 지나면 '만료'
function iitContractState(end){
  if(!end) return null;
  const today = todayYmd();
  if(end < today) return "만료";
  return end <= iitAddMonthsYmd(today, 3) ? "확인" : null;
}
function iitContractBadgeHtml(r){
  const st = iitContractState((r.detail || {}).contractEnd);
  if(!st) return "";
  return ' <span class="tr-chip" title="계약만료일 ' + esc(r.detail.contractEnd) + '" style="margin-left:4px;' + (st === "만료" ? 'color:#B91C1C;background:#FDECEC;' : 'color:#B45309;background:#FEF3E2;') + '">' + st + '</span>';
}
function iitCtmsCanEdit(r){
  if(!r || !r.linked || !canWrite()) return false;
  if(!state.ctmsAuth) state.ctmsAuth = ctmsAutoAuth(); // app.js — CTMS 탭을 열지 않았어도 같은 권한 기준
  return ctmsCanEdit(r.gid);
}
// 화면에 보여줄 값: CTMS 연동 값과 IIT 탭 값을 합친다
function iitDetailView(r){
  const d = r.detail || {}, rec = r.linked ? state.ctms[r.gid] || null : null;
  const ms = (k) => rec && rec.milestones && rec.milestones[k] ? rec.milestones[k].actual || "" : "";
  // CTMS 실적월이 IIT 날짜와 다르면(CTMS 탭에서 바꾼 경우) 날짜는 비우고 CTMS 실적월을 보여준다
  const date = (k, dk) => {
    const m = r.linked ? ms(k) : "", v = d[dk] || "";
    return { date: v && (!m || v.startsWith(m)) ? v : "", month: m };
  };
  const num = (k) => { const v = r.linked ? (rec ? rec[k] : null) : d[k]; return v === null || v === undefined || v === "" ? null : Number(v); };
  return {
    rrc: date("rrc", "rrcDate"), contract: date("contract", "contractDate"),
    contractEnd: d.contractEnd || "", endHistory: Array.isArray(d.endHistory) ? d.endHistory : [],
    subjTarget: num("subjTarget"), subjEnrolled: num("subjEnrolled"), subjCompleted: num("subjCompleted"),
    fund: Object.assign({ na: false, total: null, rounds: [] }, d.fund || {}),
    ip: Object.assign({ status: "", memo: "" }, d.ip || {}),
    result: Object.assign({ csr: false, csrDate: "", ms: false, msDate: "", memo: "" }, d.result || {}),
  };
}
const iitWon = (n) => n === null || n === undefined || n === "" ? "–" : Number(n).toLocaleString("ko-KR") + "원";

function iitDetailOpen(key){
  const r = iitFind(key);
  if(!r) return;
  const edit = canWrite(), ctmsEdit = iitCtmsCanEdit(r), v = iitDetailView(r);
  iit.detail = { key, rounds: v.fund.rounds.map(x => Object.assign({}, x)), edit };
  const dis = (on) => on ? '' : ' disabled';
  const sec = (title, inner, note, full) => '<div class="iitd-sec' + (full ? ' full' : '') + '">' +
    '<div style="font-weight:800;font-size:13px;margin-bottom:8px;color:#1F2937;">' + title + (note ? ' <span style="font-weight:500;font-size:11px;color:#94A3B8;">' + note + '</span>' : '') + '</div>' + inner + '</div>';
  const field = (label, inner) => '<div class="field" style="margin-bottom:8px;"><div class="field-label">' + label + '</div>' + inner + '</div>';
  const info = (label, val) => '<div><div style="font-size:11px;color:#94A3B8;">' + label + '</div><div style="font-size:13px;font-weight:600;">' + val + '</div></div>';
  const dash = (x) => x ? esc(x) : '<span style="color:#94A3B8;">–</span>';
  const dateInput = (id, val, on) => '<input id="iitd-' + id + '" class="input" type="date" value="' + esc(val) + '"' + dis(on) + '/>';
  const ctmsHint = (m) => r.linked ? '<div style="font-size:11px;color:#94A3B8;margin-top:3px;">CTMS 실적월: ' + (m ? esc(m) : '없음') + ' · 날짜를 바꾸면 CTMS에도 반영돼요</div>' : '';
  const numInput = (k) => '<input id="iitd-' + k + '" class="input" type="number" min="0" step="1" value="' + (v[k] === null ? '' : v[k]) + '"' + dis(r.linked ? ctmsEdit : edit) + '/>';
  const cst = iitContractState(v.contractEnd);
  const endBlock = v.contractEnd
    ? '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:14px;font-weight:700;">' + esc(v.contractEnd) + '</span>' + iitContractBadgeHtml(r) +
        (edit ? '<button class="add-btn" style="padding:5px 10px;font-size:12px;background:#fff;color:var(--accent);border:1px solid var(--accent);" onclick="iitEndEditToggle()">계약 연장·만료일 변경</button>' : '') + '</div>' +
      (cst ? '<div style="font-size:11.5px;color:' + (cst === "만료" ? '#B91C1C' : '#B45309') + ';margin-top:4px;">' + (cst === "만료" ? '계약이 만료됐어요. 연장했다면 만료일을 변경해 주세요.' : '계약 만료 3개월 전이에요. 연장 여부를 확인해 주세요.') + '</div>' : '') +
      '<div id="iitd-endwrap" style="display:none;margin-top:8px;padding:8px;border:1px dashed var(--border);border-radius:8px;background:#F8FAFC;">' +
        '<div class="wk-form" style="grid-template-columns:1fr 2fr;">' + field("새 만료일", dateInput("contractEnd", "", true)) +
          field("변경 사유", '<input id="iitd-endMemo" class="input" type="text" placeholder="예: 1년 연장 계약 체결"/>') + '</div></div>'
    : dateInput("contractEnd", "", edit);
  const hist = v.endHistory.length ? '<div style="font-size:11.5px;color:#64748B;margin-top:6px;line-height:1.6;">' + v.endHistory.map(h =>
    '· ' + esc(h.date) + ' ' + esc(h.by || "") + ': ' + esc(h.from) + ' → ' + esc(h.to) + (h.memo ? ' (' + esc(h.memo) + ')' : '')).join('<br/>') + '</div>' : '';
  const cost = r.linked ? (state.ctmsCost[r.gid] || []).filter(e => e.category === "연구비") : [];
  const costSum = (kind) => cost.filter(e => e.kind === kind).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const res = v.result;
  const resRow = (k, label) => '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
    '<label style="display:flex;align-items:center;gap:6px;font-size:13px;min-width:130px;"><input type="checkbox" id="iitd-res-' + k + '"' + (res[k] ? ' checked' : '') + dis(edit) + '/> ' + label + ' 수령</label>' +
    '<input id="iitd-res-' + k + 'Date" class="input" type="date" style="flex:0 1 170px;" value="' + esc(res[k + "Date"] || "") + '"' + dis(edit) + ' title="수령일"/></div>';
  showModal(
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
      '<div style="min-width:0;"><div style="font-weight:800;font-size:15px;">' + esc(r.taskName) + '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">' + (r.line === "SC" || r.line === "PC" ? lineTagHtml(r.line) : '') + (r.product ? '<span style="font-size:13px;color:#475569;">' + esc(r.product) + '</span>' : '') + iitStatusHtml(r) + '</div></div>' +
      (edit && !r.hidden ? '<button class="btn-export" style="flex:0 0 auto;" onclick="iitEditOpen(\'' + key + '\')">' + icon('edit', 13) + ' 기본 정보 수정</button>' : '') +
    '</div>' +
    '<div class="modal-scroll iitd-grid">' +
      sec("기본 정보", '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;">' +
        info("과제코드", dash(r.code)) + info("기관명", dash(r.site)) + info("연구자명", dash(r.investigator)) + info("담당자", dash(r.manager)) +
        info("지원범위", iitSupportHtml(r.support)) + (r.linked ? info("과제 유형 · 기간", dash([r.type, r.period].filter(Boolean).join(" · "))) : '') + '</div>', '', true) +
      sec("일정 · 계약",
        '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
          field("RRC 승인일", dateInput("rrcDate", v.rrc.date, r.linked ? ctmsEdit : edit) + ctmsHint(v.rrc.month)) +
          field("계약체결일", dateInput("contractDate", v.contract.date, r.linked ? ctmsEdit : edit) + ctmsHint(v.contract.month)) +
        '</div>' +
        field("계약만료일", endBlock + hist),
        r.linked && !ctmsEdit && edit ? 'RRC 승인일·계약체결일은 CTMS와 연동돼 담당자·관리자·팀장만 고칠 수 있어요' : '') +
      sec("대상자 수", '<div class="wk-form" style="grid-template-columns:1fr 1fr 1fr;">' +
        field("목표 대상자수", numInput("subjTarget")) + field("등록 대상자수", numInput("subjEnrolled")) + field("완료 대상자수", numInput("subjCompleted")) + '</div>',
        r.linked ? 'CTMS 탭과 같은 값' + (ctmsEdit || !edit ? '' : ' · 담당자·관리자·팀장만 수정') : '') +
      sec("연구비 제공 현황",
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:8px;"><input type="checkbox" id="iitd-fund-na"' + (v.fund.na ? ' checked' : '') + dis(edit) + ' onchange="iitFundSync()"/> 연구비 해당 없음</label>' +
        '<div id="iitd-fundwrap">' +
          field("연구비 총액 (원)", '<input id="iitd-fund-total" class="input" type="number" min="0" step="1" value="' + (v.fund.total === null || v.fund.total === undefined ? '' : v.fund.total) + '"' + dis(edit) + ' oninput="iitRoundsSum()"/>') +
          '<div id="iitd-rounds"></div>' +
          (edit ? '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:var(--accent);border:1px dashed var(--accent);margin-bottom:6px;" onclick="iitRoundAdd()">' + icon('plus', 13) + ' 차수 추가</button>' : '') +
          '<div id="iitd-roundsum" style="font-size:12px;font-weight:700;"></div>' +
          (cost.length ? '<div style="font-size:11px;color:#94A3B8;margin-top:6px;">CTMS 비용 기록(연구비): 계획 ' + costSum("plan").toLocaleString("ko-KR") + '천원 · 집행 ' + costSum("actual").toLocaleString("ko-KR") + '천원</div>' : '') +
        '</div>', '', true) +
      sec("IP 제공 현황", '<div class="wk-form" style="grid-template-columns:1fr 2fr;">' +
        field("상태", '<select id="iitd-ip-status" class="input"' + dis(edit) + '><option value="">선택 안 함</option>' + IIT_IP_STATUS.map(x => '<option' + (v.ip.status === x ? ' selected' : '') + '>' + x + '</option>').join("") + '</select>') +
        field("내용", '<input id="iitd-ip-memo" class="input" type="text" placeholder="예: 로제텔정 300T, 2026-03 1차 제공" value="' + esc(v.ip.memo) + '"' + dis(edit) + '/>') + '</div>') +
      sec("결과 수령", resRow("csr", "CSR") + resRow("ms", "Manuscript") +
        '<input id="iitd-res-memo" class="input" type="text" placeholder="메모 (예: 최종본 수령, 보관 위치)" value="' + esc(res.memo) + '"' + dis(edit) + '/>') +
      sec("Publication", iitPubHtml(r), edit ? '수정은 \'기본 정보 수정\'에서' : '', true) +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button class="add-btn view-ok" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">닫기</button>' +
      (edit ? '<button class="add-btn" id="iitd-save" style="flex:1;justify-content:center;" onclick="iitDetailSave(\'' + key + '\')">저장</button>' : '') +
    '</div>', "wide"
  );
  iitRoundsRender();
  iitFundSync();
}
function iitEndEditToggle(){
  const w = document.getElementById("iitd-endwrap");
  if(w) w.style.display = w.style.display === "none" ? "" : "none";
}
function iitFundSync(){
  const na = document.getElementById("iitd-fund-na"), wrap = document.getElementById("iitd-fundwrap");
  if(na && wrap) wrap.style.display = na.checked ? "none" : "";
}

// 연구비 차수: 추가·삭제할 때 입력값을 먼저 옮겨 담고 다시 그린다 (논문 칸과 같은 방식)
const IIT_ROUND_KEYS = ["amount", "date", "memo"];
function iitRoundsCollect(){
  iit.detail.rounds.forEach((x, i) => {
    IIT_ROUND_KEYS.forEach(k => { const el = document.getElementById("iitd-r" + i + "-" + k); if(el) x[k] = el.value.trim(); });
    const paid = document.getElementById("iitd-r" + i + "-paid");
    if(paid) x.paid = paid.checked;
  });
}
function iitRoundsRender(){
  const box = document.getElementById("iitd-rounds");
  if(!box) return;
  const dis = iit.detail.edit ? '' : ' disabled';
  box.innerHTML = iit.detail.rounds.map((x, i) =>
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px;background:#F8FAFC;border-radius:8px;margin-bottom:6px;">' +
      '<b style="font-size:12.5px;min-width:30px;">' + (i + 1) + '차</b>' +
      '<input id="iitd-r' + i + '-amount" class="input" type="number" min="0" step="1" placeholder="금액(원)" style="flex:1 1 120px;" value="' + esc(x.amount ?? "") + '" oninput="iitRoundsSum()"' + dis + '/>' +
      '<input id="iitd-r' + i + '-date" class="input" type="date" title="지급일" style="flex:0 1 150px;" value="' + esc(x.date || "") + '"' + dis + '/>' +
      '<label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;"><input type="checkbox" id="iitd-r' + i + '-paid"' + (x.paid ? ' checked' : '') + dis + ' onchange="iitRoundsSum()"/> 지급 완료</label>' +
      '<input id="iitd-r' + i + '-memo" class="input" type="text" placeholder="메모" style="flex:1 1 120px;" value="' + esc(x.memo || "") + '"' + dis + '/>' +
      (iit.detail.edit ? '<button class="icon-btn" title="이 차수 삭제" onclick="iitRoundRemove(' + i + ')">' + icon('trash', 13) + '</button>' : '') +
    '</div>').join("");
  iitRoundsSum();
}
function iitRoundAdd(){ iitRoundsCollect(); iit.detail.rounds.push({ amount: "", date: "", paid: false, memo: "" }); iitRoundsRender(); }
function iitRoundRemove(i){ iitRoundsCollect(); iit.detail.rounds.splice(i, 1); iitRoundsRender(); }
const iitInt = (s) => s === "" || s === null || s === undefined ? null : Math.floor(Number(s));
// 차수 합계와 총액 비교 (입력할 때마다 갱신)
function iitRoundsSum(){
  const el = document.getElementById("iitd-roundsum");
  if(!el) return;
  iitRoundsCollect();
  const rounds = iit.detail.rounds;
  if(rounds.length === 0){ el.innerHTML = '<span style="color:#94A3B8;font-weight:500;">차수를 추가하면 지급 계획을 나눠 적을 수 있어요.</span>'; return; }
  const sum = rounds.reduce((s, x) => s + (iitInt(x.amount) || 0), 0), paid = rounds.filter(x => x.paid).reduce((s, x) => s + (iitInt(x.amount) || 0), 0);
  const total = iitInt(document.getElementById("iitd-fund-total").value);
  const ok = total !== null && sum === total;
  el.innerHTML = '<span style="color:' + (ok ? '#1E7A4F' : '#B91C1C') + ';">차수 합계 ' + sum.toLocaleString("ko-KR") + '원 / 총액 ' + iitWon(total) +
    (ok ? ' ✓ 일치' : total === null ? ' — 총액을 입력해 주세요' : ' — ' + Math.abs(total - sum).toLocaleString("ko-KR") + '원 ' + (sum > total ? '초과' : '부족')) + '</span>' +
    '<span style="color:#64748B;font-weight:500;"> · 지급 완료 ' + paid.toLocaleString("ko-KR") + '원</span>';
}

async function iitDetailSave(key){
  const r = iitFind(key);
  if(!r || !canWrite()){ closeModal(); return; }
  const old = iitDetailView(r), ctmsEdit = iitCtmsCanEdit(r);
  const val = (id) => { const el = document.getElementById("iitd-" + id); return el ? el.value.trim() : ""; };
  const on = (id) => { const el = document.getElementById("iitd-" + id); return !!(el && el.checked); };
  iitRoundsCollect();
  const fundNa = on("fund-na"), total = iitInt(val("fund-total"));
  const rounds = iit.detail.rounds.filter(x => x.amount !== "" || x.date || x.memo || x.paid).map(x => ({ amount: iitInt(x.amount), date: x.date || "", paid: !!x.paid, memo: x.memo || "" }));
  if(!fundNa){
    if(total !== null && (isNaN(total) || total < 0)){ showToast("연구비 총액을 올바르게 입력해 주세요", { error: true }); return; }
    const bad = rounds.findIndex(x => x.amount === null || isNaN(x.amount) || x.amount < 0);
    if(bad >= 0){ showToast((bad + 1) + "차 금액을 입력해 주세요", { error: true }); return; }
    const sum = rounds.reduce((s, x) => s + x.amount, 0);
    if(rounds.length && total === null){ showToast("연구비 총액을 입력해 주세요", { error: true }); return; }
    if(rounds.length && sum !== total){ showToast("차수 금액 합계(" + sum.toLocaleString("ko-KR") + "원)가 연구비 총액(" + total.toLocaleString("ko-KR") + "원)과 일치해야 해요", { error: true }); return; }
  }
  // 계약만료일: 처음 입력하거나, '계약 연장·만료일 변경'으로 새 날짜를 넣으면 변경 이력을 남긴다
  let contractEnd = old.contractEnd;
  const endHistory = old.endHistory.slice(), newEnd = val("contractEnd");
  if(newEnd && newEnd !== old.contractEnd){
    if(old.contractEnd) endHistory.push({ from: old.contractEnd, to: newEnd, date: todayYmd(), by: currentProfile.name || currentProfile.login_id, memo: val("endMemo") });
    contractEnd = newEnd;
  }
  const canDates = !r.linked || ctmsEdit; // CTMS 연동 값은 고칠 수 있을 때만 바꾼다 (못 고치면 입력칸이 잠겨 있음)
  const rrcDate = canDates ? val("rrcDate") : old.rrc.date, contractDate = canDates ? val("contractDate") : old.contract.date;
  if(contractDate && contractEnd && contractEnd < contractDate){ showToast("계약만료일이 계약체결일보다 빨라요", { error: true }); return; }
  const subj = {};
  ["subjTarget", "subjEnrolled", "subjCompleted"].forEach(k => { const n = iitInt(val(k)); subj[k] = n === null || isNaN(n) || n < 0 ? null : n; });

  const detail = Object.assign({}, iitStoredData(r).detail || {}, {
    contractEnd, endHistory,
    fund: { na: fundNa, total: fundNa ? null : total, rounds: fundNa ? [] : rounds },
    ip: { status: val("ip-status"), memo: val("ip-memo") },
    result: { csr: on("res-csr"), csrDate: val("res-csrDate"), ms: on("res-ms"), msDate: val("res-msDate"), memo: val("res-memo") },
  });
  if(canDates){ detail.rrcDate = rrcDate; detail.contractDate = contractDate; }
  if(!r.linked) Object.assign(detail, subj);

  const data = Object.assign({}, iitStoredData(r), { detail });
  if(r.linked && !r.id) Object.assign(data, { product: r.product, taskName: r.taskName, manager: r.manager });
  const rec = { data, updated_at: new Date().toISOString(), updated_by: currentProfile.id };
  const btn = document.getElementById("iitd-save");
  if(btn) btn.disabled = true;
  const { data: res, error } = r.id
    ? await sb.from("iit_projects").update(rec).eq("id", r.id).select("id")
    : await sb.from("iit_projects").insert(Object.assign(rec, { group_id: r.gid })).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!res || res.length === 0){ showToast("IIT 과제를 편집할 권한이 없어요", { error: true }); return; }
  if(r.linked && ctmsEdit) iitCtmsApply(r, old, { rrc: rrcDate, contract: contractDate }, subj);
  closeModal();
  showToast("상세 정보를 저장했어요");
  iitReload();
}

// CTMS 기록에 RRC 승인·계약 체결 실적월과 대상자 수를 반영한다 (바뀐 값이 있을 때만)
function iitCtmsApply(r, old, dates, subj){
  const gid = r.gid;
  const changes = ["rrc", "contract"].filter(k => dates[k] !== old[k].date);
  const subjChanged = ["subjTarget", "subjEnrolled", "subjCompleted"].filter(k => subj[k] !== old[k]);
  if(changes.length === 0 && subjChanged.length === 0) return;
  let rec = state.ctms[gid];
  if(!rec){
    rec = state.ctms[gid] = { protocolNo: "", siteTarget: null, siteActive: null, subjTarget: null, subjEnrolled: null, subjCompleted: null, milestones: {}, note: "", stages: ctmsDefaultStagesFor(gid) };
    logActivity('CTMS 추적 시작: "' + r.taskName + '" (IIT 관리)');
  }
  if(!rec.milestones) rec.milestones = {};
  const labels = { rrc: "RRC 승인", contract: "계약 체결" };
  changes.forEach(k => {
    // 이 과제의 마일스톤 목록에 단계가 없으면 추가해 CTMS 탭에서도 보이게 한다
    const stages = ctmsEnsureStages(rec);
    if(!stages.some(s => s.key === k)){
      const at = k === "contract" ? stages.findIndex(s => s.key === "rrc") + 1 : 0;
      stages.splice(Math.max(at, 0), 0, { key: k, label: labels[k] });
    }
    const m = rec.milestones[k] || (rec.milestones[k] = {});
    m.actual = dates[k] ? dates[k].slice(0, 7) : "";
  });
  subjChanged.forEach(k => { rec[k] = subj[k]; });
  logActivity('IIT 상세에서 CTMS 수정: "' + r.taskName + '" - ' + changes.map(k => labels[k]).concat(subjChanged.length ? ["대상자 수"] : []).join(", "));
  ctmsPersist(gid); // app.js — 관리자·팀장은 자동저장, 담당자는 save_ctms
}
