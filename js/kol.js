/* ---------------- KOL 탭 (KOL 통합 디렉토리) ----------------
   분야별 하위 탭(순환기·내분비·이식/면역·항암 …)마다 KOL 명단을 둔다. 승인된 회원 누구나 조회하고,
   관리자와 관리자가 지정한 회원(profiles.kol_editor)만 명단과 하위 탭을 추가·수정·삭제한다.
   협조도 평가 등 내부 정보가 있어 명단은 공개 저장소가 아닌 Supabase에만 있다
   (supabase/migrations/20261030000000_kols.sql, 20261031000000_kol_categories.sql). */

const KOL_TRIAL_LABEL = {
  "로제텔정OS(PCI)": "OS · PCI",
  "로제텔정OS(Multi)": "OS · Multi",
  "로제텔정OS(High risk)": "OS · High risk",
  "로제텔정PMS": "로제텔정 PMS",
  "로제텔핀정PMS": "로제텔핀정 PMS",
};
const KOL_TIER_ORDER = ["회장단", "상임이사", "임상PI"];
const KOL_EMPTY_F = () => ({ q: "", society: "", trial: "", tier: "", sort: "name" });
const kol = { rows: null, cats: null, cat: null, f: KOL_EMPTY_F(), open: {}, evalOpen: null };

// DB 정책(can_edit_kol)과 같은 기준
function canEditKol(){ return isSysAdmin() || !!(currentProfile && currentProfile.approved && currentProfile.kol_editor); }

async function kolLoad(){
  try{
    const [cats, rows] = await Promise.all([
      sbFetchAll(() => sb.from("kol_categories").select("*").order("sort").order("created_at")), // worklog.js
      sbFetchAll(() => sb.from("kols").select("id,category_id,data").order("id")),
    ]);
    kol.cats = cats;
    kol.rows = rows.map(r => Object.assign({}, r.data, { id: r.id, category_id: r.category_id }));
    if(!kol.cats.some(c => c.id === kol.cat)) kol.cat = kol.cats.length ? kol.cats[0].id : null;
  }catch(e){
    showToast("KOL 명단을 불러오지 못했어요: " + e.message, { error: true });
    kol.cats = kol.cats || []; kol.rows = kol.rows || [];
  }
  if(state.tab === "kol") renderTabContent();
}
function kolReload(){ kol.rows = null; renderTabContent(); }

const kolCatRows = () => kol.rows.filter(p => p.category_id === kol.cat);
const kolTiersOf = (p) => (p.tier || "").split("+").map(s => s.trim()).filter(Boolean);
const kolList = (v) => Array.isArray(v) ? v : [];

function kolFiltered(){
  const f = kol.f, q = f.q.trim().toLowerCase();
  const list = kolCatRows().filter(p =>
    (!f.society || p.society === f.society) &&
    (!f.trial || kolList(p.trials).includes(f.trial)) &&
    (!f.tier || kolTiersOf(p).includes(f.tier)) &&
    (!q || [p.name, p.hospital, p.role, p.society].some(v => (v || "").toLowerCase().includes(q))));
  const by = (k) => (a, b) => (a[k] || "").localeCompare(b[k] || "", "ko");
  return list.sort(by(f.sort === "tier" ? "tier" : f.sort === "hospital" ? "hospital" : "name"));
}

function kolSubTabBar(){
  const edit = canEditKol();
  const btn = (c) => '<button class="view-ok" onclick="kolSetCat(\'' + c.id + '\')" style="flex:1 1 0;min-width:84px;padding:9px 6px;border-radius:8px;border:1px solid ' +
    (kol.cat === c.id ? "var(--accent)" : "var(--border)") + ';background:' + (kol.cat === c.id ? "var(--accent)" : "#fff") + ';color:' + (kol.cat === c.id ? "#fff" : "#475569") + ';font-size:13px;font-weight:700;">' +
    esc(c.name) + ' <span style="font-size:11px;opacity:.75;">' + kol.rows.filter(p => p.category_id === c.id).length + '</span></button>';
  return '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">' + kol.cats.map(btn).join("") +
    (edit ? '<button class="view-ok" title="하위 탭 추가" onclick="kolCatEditOpen(null)" style="flex:0 0 auto;padding:9px 12px;border-radius:8px;border:1px dashed var(--accent);background:#fff;color:var(--accent);font-size:13px;font-weight:700;">' + icon('plus', 13) + '</button>' : '') +
  '</div>';
}
function kolSetCat(id){ kol.cat = id; kol.f = KOL_EMPTY_F(); kol.open = {}; kol.evalOpen = null; renderTabContent(); }

function renderKolTab(){
  if(!kol.rows || !kol.cats){
    if(!kol.loading){ kol.loading = true; kolLoad().finally(() => { kol.loading = false; }); }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  const edit = canEditKol();
  if(kol.cats.length === 0){
    return '<div class="card"><div class="empty">아직 하위 탭이 없어요.' + (edit ? '<br/><br/><button class="add-btn view-ok" onclick="kolCatEditOpen(null)">' + icon('plus', 13) + ' 하위 탭 추가</button>' : '') + '</div></div>';
  }
  const cat = kol.cats.find(c => c.id === kol.cat), rows = kolCatRows(), f = kol.f;
  const stat = (k, v) => '<div class="tr-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  const count = (pred) => rows.filter(pred).length;
  // 필터 칩은 이 탭 명단에 실제로 있는 값으로 만든다 (값이 하나도 없으면 줄을 숨김)
  const chips = (key, label, list) => list.length === 0 ? '' : '<div class="field-label">' + label + '</div><div class="kol-chips">' +
    [["", "전체", rows.length]].concat(list).map(([v, text, n]) =>
      '<button class="kol-chip view-ok' + (f[key] === v ? ' on' : '') + '" onclick="kolFilter(\'' + key + '\', ' + esc(JSON.stringify(v)) + ')">' + esc(text) + '<span>' + n + '</span></button>').join("") + '</div>';
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const societies = uniq(rows.map(p => p.society));
  const trials = uniq(rows.flatMap(p => kolList(p.trials))).sort((a, b) => {
    const ka = Object.keys(KOL_TRIAL_LABEL), ia = ka.indexOf(a), ib = ka.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "ko");
  });
  const tiers = uniq(rows.flatMap(kolTiersOf)).sort((a, b) => {
    const ia = KOL_TIER_ORDER.indexOf(a), ib = KOL_TIER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "ko");
  });
  return kolSubTabBar() + '<div class="stack">' +
    '<div class="tr-stats kol-stats">' +
      stat("전체 인원", rows.length + "명") +
      stat("회장단급", count(p => kolTiersOf(p).includes("회장단")) + "명") +
      stat("상임이사급", count(p => kolTiersOf(p).includes("상임이사")) + "명") +
      stat("임상 참여", count(p => kolList(p.trials).length > 0) + "명") +
    '</div>' +
    '<div class="card">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;">' +
        '<div><div style="font-weight:800;font-size:14px;margin-bottom:2px;">' + esc(cat.name) + ' KOL 디렉토리</div>' +
          '<div style="font-size:12px;color:#94A3B8;">' + (cat.description ? esc(cat.description) + ' · ' : '') + '내부 참고용</div></div>' +
        (edit ? '<button class="btn-export view-ok" style="flex:0 0 auto;" onclick="kolCatEditOpen(\'' + cat.id + '\')">' + icon('edit', 13) + ' 하위 탭 수정</button>' : '') +
      '</div>' +
      '<input class="input view-ok" type="search" placeholder="이름·병원·직위로 검색 (예: 서울대병원)" value="' + esc(f.q) + '" oninput="kol.f.q=this.value;kolRenderList()" style="margin-bottom:12px;"/>' +
      chips("society", "학회", societies.map(s => [s, s.replace(/대한/g, ""), count(p => p.society === s)])) +
      chips("trial", "참여 임상연구", trials.map(t => [t, KOL_TRIAL_LABEL[t] || t, count(p => kolList(p.trials).includes(t))])) +
      chips("tier", "구분", tiers.map(t => [t, t, count(p => kolTiersOf(p).includes(t))])) +
      '<div style="font-size:12px;color:#64748B;margin-top:4px;line-height:1.7;">' +
        '<span class="kol-trial-tag">임상 참여</span> 당사 임상연구에 참여한 PI · ' +
        '👍 추천 👎 비추천 — 협조도 평가 결과 (아이콘을 누르면 사유 확인)' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:14px;">명단 <span id="kol-count" style="font-size:12px;color:#94A3B8;font-weight:600;">' + kolFiltered().length + '명 표시 (전체 ' + rows.length + '명)</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<select class="input view-ok" style="width:auto;" onchange="kolFilter(\'sort\', this.value)">' +
            [["name", "이름순"], ["tier", "구분순"], ["hospital", "병원순"]].map(o => '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join("") +
          '</select>' +
          '<button class="btn-export view-ok" onclick="kolExport()">' + icon('download', 14) + ' 엑셀 다운로드</button>' +
          (edit ? '<button class="add-btn view-ok" onclick="kolEditOpen(null)">' + icon('plus', 13) + ' KOL 추가</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="kol-list">' + kolListHtml() + '</div>' +
    '</div>' +
  '</div>';
}

function kolTierClass(p){
  const t = kolTiersOf(p);
  if(t.includes("회장단")) return " chair";
  if(t.includes("상임이사")) return " standing";
  return "";
}

function kolListHtml(){
  if(kolCatRows().length === 0) return '<div class="empty">이 탭에는 아직 등록된 KOL이 없어요.' + (canEditKol() ? ' \'KOL 추가\'를 눌러 등록해 주세요.' : '') + '</div>';
  const list = kolFiltered();
  if(list.length === 0) return '<div class="empty">검색 결과가 없어요. 다른 검색어나 필터를 골라 보세요.</div>';
  const edit = canEditKol();
  const row = (label, v, note) => v && String(v).trim() && v !== "-" ?
    '<div class="kol-detail-row"><div class="field-label">' + label + '</div><div' + (note ? ' style="color:#64748B;"' : '') + '>' + esc(v) + '</div></div>' : '';
  return list.map(p => {
    const open = !!kol.open[p.id];
    const ev = p.evaluation === 1 || p.evaluation === 2;
    const roleText = [p.society ? p.society.replace(/대한/g, "") : "", p.role].filter(Boolean).join(" · ");
    return '<div class="kol-card' + (open ? ' open' : '') + '">' +
      '<div class="kol-head" onclick="kolToggle(' + p.id + ')">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span style="font-weight:800;font-size:14.5px;">' + esc(p.name) + '</span>' +
            (ev ? '<span class="kol-eval' + (kol.evalOpen === p.id ? ' show' : '') + '" onclick="event.stopPropagation();kolEval(' + p.id + ')">' + (p.evaluation === 1 ? '👍' : '👎') +
              '<span class="kol-eval-tip"><b>' + (p.evaluation === 1 ? '추천 사유' : '비추천 사유') + '</b>' + kolList(p.evalTags).map(t => '· ' + esc(t)).join('<br/>') + '</span></span>' : '') +
            (kolList(p.trials).length ? '<span class="kol-trial-tag">임상 참여</span>' : '') +
          '</div>' +
          (roleText ? '<div style="font-size:12px;color:var(--accent);font-weight:600;">' + esc(roleText) + '</div>' : '') +
          '<div style="font-size:12.5px;color:#64748B;">' + esc(p.hospital || '소속 미상') + '</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">' +
            (p.tier ? '<span class="kol-pill' + kolTierClass(p) + '">' + esc(p.tier) + '</span>' : '') +
            kolList(p.trials).map(t => '<span class="kol-pill">' + esc(KOL_TRIAL_LABEL[t] || t) + '</span>').join("") +
          '</div>' +
        '</div>' +
        (edit ? '<div style="display:flex;gap:6px;" onclick="event.stopPropagation();">' +
          '<button class="icon-btn view-ok" title="수정" style="color:#64748B;" onclick="kolEditOpen(' + p.id + ')">' + icon('edit', 14) + '</button>' +
          '<button class="icon-btn view-ok" title="삭제" onclick="kolDeleteConfirm(' + p.id + ')">' + icon('trash', 14) + '</button>' +
        '</div>' : '') +
        '<span class="kol-chev">' + icon('chevronRight', 16) + '</span>' +
      '</div>' +
      (open ? '<div class="kol-detail">' +
        row("학력", p.education) + row("주요 경력", p.career) + row("연구·논문 실적", p.papers) +
        row("참여 임상 상세", p.trialDetail) + row("비고", p.note, true) +
      '</div>' : '') +
    '</div>';
  }).join("");
}

// 검색어를 칠 때마다 탭 전체를 다시 그리면 입력칸 커서가 사라지므로, 목록만 바꾼다
function kolRenderList(){
  const el = document.getElementById("kol-list");
  if(el) el.innerHTML = kolListHtml();
  const c = document.getElementById("kol-count");
  if(c) c.textContent = kolFiltered().length + "명 표시 (전체 " + kolCatRows().length + "명)";
}
function kolFilter(key, v){ kol.f[key] = kol.f[key] === v && key !== "sort" ? "" : v; renderTabContent(); }
function kolToggle(id){ if(kol.open[id]) delete kol.open[id]; else kol.open[id] = true; kolRenderList(); }
function kolEval(id){ kol.evalOpen = kol.evalOpen === id ? null : id; kolRenderList(); }

/* ---------------- KOL 추가·수정·삭제 (편집 권한자) ---------------- */
// 여러 값을 받는 칸(참여 임상연구·평가 사유)은 쉼표나 줄바꿈으로 나눠 입력한다
const kolSplit = (s) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);

function kolEditOpen(id){
  if(!canEditKol()) return;
  const p = id ? kol.rows.find(x => x.id === id) : null;
  if(id && !p) return;
  const v = (k) => esc(p && p[k] != null ? p[k] : "");
  const field = (label, inner) => '<div class="field"><div class="field-label">' + label + '</div>' + inner + '</div>';
  const input = (k, ph, list) => '<input id="kole-' + k + '" class="input" type="text" placeholder="' + ph + '" value="' + v(k) + '"' + (list ? ' list="kole-' + k + '-list"' : '') + '/>';
  const area = (k, ph, val) => '<textarea id="kole-' + k + '" class="input" rows="2" style="resize:vertical;" placeholder="' + ph + '">' + (val != null ? esc(val) : v(k)) + '</textarea>';
  const datalist = (k, values) => '<datalist id="kole-' + k + '-list">' + [...new Set(values.filter(Boolean))].map(x => '<option value="' + esc(x) + '">').join("") + '</datalist>';
  const ev = p ? p.evaluation : null;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">' + (p ? 'KOL 수정' : 'KOL 추가') + '</div>' +
    '<div style="max-height:64vh;overflow-y:auto;">' +
      '<div class="wk-form" style="grid-template-columns:1fr 1fr;">' +
        field("성명 *", input("name", "예: 홍길동")) +
        field("하위 탭", '<select id="kole-cat" class="input">' + kol.cats.map(c => '<option value="' + c.id + '"' + ((p ? p.category_id : kol.cat) === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join("") + '</select>') +
        field("구분", input("tier", "예: 상임이사 + 임상PI", true)) +
        field("학회", input("society", "예: 대한고혈압학회", true)) +
      '</div>' +
      datalist("tier", kol.rows.map(r => r.tier)) + datalist("society", kol.rows.map(r => r.society)) +
      field("직위·역할", input("role", "예: 고혈압학회 학술이사")) +
      field("소속 병원", input("hospital", "예: 서울대학교병원 순환기내과 교수")) +
      field("학력", area("education", "")) +
      field("주요 경력", area("career", "")) +
      field("연구·논문 실적", area("papers", "")) +
      field("참여 임상연구 <span style=\"font-weight:500;color:#94A3B8;\">(필터용, 쉼표로 구분)</span>", '<input id="kole-trials" class="input" type="text" placeholder="예: 로제텔정PMS, 로제텔정OS(PCI)" value="' + esc(kolList(p && p.trials).join(", ")) + '"/>') +
      field("참여 임상 상세", area("trialDetail", "")) +
      '<div class="wk-form" style="grid-template-columns:1fr 2fr;">' +
        field("협조도 평가", '<select id="kole-evaluation" class="input"><option value="">없음</option><option value="1"' + (ev === 1 ? ' selected' : '') + '>👍 추천</option><option value="2"' + (ev === 2 ? ' selected' : '') + '>👎 비추천</option></select>') +
        field("평가 사유 <span style=\"font-weight:500;color:#94A3B8;\">(쉼표로 구분)</span>", '<input id="kole-evalTags" class="input" type="text" placeholder="예: 등록 실적 우수" value="' + esc(kolList(p && p.evalTags).join(", ")) + '"/>') +
      '</div>' +
      field("비고", area("note", "")) +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="kole-save" style="flex:1;justify-content:center;" onclick="kolSave(' + (p ? p.id : 'null') + ')">저장</button>' +
    '</div>'
  );
}

async function kolSave(id){
  const val = (k) => document.getElementById("kole-" + k).value.trim();
  const data = {
    name: val("name"), tier: val("tier"), society: val("society"), role: val("role"), hospital: val("hospital"),
    education: val("education"), career: val("career"), papers: val("papers"), note: val("note"),
    trials: kolSplit(val("trials")), trialDetail: val("trialDetail"),
    evaluation: val("evaluation") ? Number(val("evaluation")) : null, evalTags: kolSplit(val("evalTags")),
  };
  if(!data.name){ showToast("성명을 입력해 주세요", { error: true }); return; }
  if(!data.evaluation) data.evalTags = [];
  const rec = { category_id: val("cat"), data, updated_at: new Date().toISOString() };
  const btn = document.getElementById("kole-save");
  if(btn) btn.disabled = true;
  // 권한이 없으면 오류 없이 0건이 바뀌므로, 바뀐 행을 돌려받아 확인한다
  const { data: res, error } = id
    ? await sb.from("kols").update(rec).eq("id", id).select("id")
    : await sb.from("kols").insert(rec).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!res || res.length === 0){ showToast("KOL 명단을 편집할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast(id ? data.name + " 정보를 수정했어요" : data.name + "을(를) 추가했어요");
  kolReload();
}

function kolDeleteConfirm(id){
  const p = kol.rows.find(x => x.id === id);
  if(!p) return;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;">KOL 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:16px;"><b>' + esc(p.name) + '</b>' + (p.hospital ? ' (' + esc(p.hospital) + ')' : '') + '을(를) 명단에서 삭제할까요? 되돌릴 수 없어요.</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="kolDelete(' + id + ')">삭제</button>' +
    '</div>'
  );
}
async function kolDelete(id){
  const { data, error } = await sb.from("kols").delete().eq("id", id).select("id");
  closeModal();
  if(error){ showToast("삭제하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("KOL 명단을 편집할 권한이 없어요", { error: true }); return; }
  kol.rows = kol.rows.filter(p => p.id !== id);
  showToast("삭제했어요");
  renderTabContent();
}

/* ---------------- 하위 탭 추가·수정·삭제 (편집 권한자) ---------------- */
function kolCatEditOpen(id){
  if(!canEditKol()) return;
  const c = id ? kol.cats.find(x => x.id === id) : null;
  const n = c ? kol.rows.filter(p => p.category_id === c.id).length : 0;
  const idx = c ? kol.cats.indexOf(c) : -1;
  const moveBtn = (d, label, off) => '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);' + (off ? 'opacity:.4;pointer-events:none;' : '') + '" onclick="kolCatMove(\'' + id + '\',' + d + ')">' + label + '</button>';
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:12px;">' + (c ? '하위 탭 수정' : '하위 탭 추가') + '</div>' +
    '<div class="field"><div class="field-label">탭 이름 *</div><input id="kolc-name" class="input" type="text" placeholder="예: 호흡기" value="' + esc(c ? c.name : "") + '"/></div>' +
    '<div class="field"><div class="field-label">설명</div><textarea id="kolc-desc" class="input" rows="2" style="resize:vertical;" placeholder="예: OO학회 임원 및 OO 임상연구 참여 PI 명단">' + esc(c ? c.description : "") + '</textarea></div>' +
    (c ? '<div style="display:flex;gap:8px;margin-bottom:10px;">' + moveBtn(-1, '← 앞으로', idx === 0) + moveBtn(1, '뒤로 →', idx === kol.cats.length - 1) + '</div>' : '') +
    '<div style="display:flex;gap:8px;">' +
      (c ? '<button class="add-btn" style="justify-content:center;background:#fff;color:#B91C1C;border:1px solid #F3B8B8;" onclick="kolCatDeleteConfirm(\'' + id + '\')">' + icon('trash', 13) + ' 삭제</button>' : '') +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" id="kolc-save" style="flex:1;justify-content:center;" onclick="kolCatSave(' + (c ? '\'' + id + '\'' : 'null') + ')">저장</button>' +
    '</div>' +
    (c ? '<div style="font-size:11.5px;color:#94A3B8;margin-top:10px;">이 탭의 KOL ' + n + '명</div>' : '')
  );
  setTimeout(() => { const el = document.getElementById("kolc-name"); if(el) el.focus(); }, 50);
}
async function kolCatSave(id){
  const name = document.getElementById("kolc-name").value.trim();
  const description = document.getElementById("kolc-desc").value.trim();
  if(!name){ showToast("탭 이름을 입력해 주세요", { error: true }); return; }
  if(kol.cats.some(c => c.name === name && c.id !== id)){ showToast("같은 이름의 탭이 이미 있어요", { error: true }); return; }
  const btn = document.getElementById("kolc-save");
  if(btn) btn.disabled = true;
  const sort = kol.cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
  const { data, error } = id
    ? await sb.from("kol_categories").update({ name, description }).eq("id", id).select("id")
    : await sb.from("kol_categories").insert({ name, description, sort }).select("id");
  if(btn) btn.disabled = false;
  if(error){ showToast("저장하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("하위 탭을 편집할 권한이 없어요", { error: true }); return; }
  closeModal();
  showToast(id ? "하위 탭을 수정했어요" : "'" + name + "' 탭을 추가했어요");
  if(!id) kolSetCat(data[0].id);
  kolReload();
}
// 순서 바꾸기: 옆 탭과 sort 값을 맞바꾼 뒤 1부터 다시 매긴다
async function kolCatMove(id, d){
  const list = kol.cats.slice(), i = list.findIndex(c => c.id === id), j = i + d;
  if(i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const results = await Promise.all(list.map((c, k) => sb.from("kol_categories").update({ sort: k + 1 }).eq("id", c.id)));
  const err = results.find(r => r.error);
  if(err){ showToast("순서를 바꾸지 못했어요: " + err.error.message, { error: true }); return; }
  closeModal();
  kolReload();
}
function kolCatDeleteConfirm(id){
  const c = kol.cats.find(x => x.id === id);
  if(!c) return;
  const n = kol.rows.filter(p => p.category_id === id).length;
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:8px;color:var(--danger);">하위 탭 삭제</div>' +
    '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-bottom:12px;">\'' + esc(c.name) + '\' 탭을 삭제할까요? 되돌릴 수 없어요.' +
      (n > 0 ? '<br/><b style="color:var(--danger);">이 탭의 KOL ' + n + '명도 함께 삭제돼요.</b> 남기려면 먼저 각 KOL을 다른 탭으로 옮겨 주세요.<br/>삭제하려면 탭 이름을 그대로 입력해 주세요.' : '') + '</div>' +
    (n > 0 ? '<input id="kolc-confirm" class="input" type="text" placeholder="' + esc(c.name) + '" style="margin-bottom:12px;"/>' : '') +
    '<div style="display:flex;gap:8px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="kolCatEditOpen(\'' + id + '\')">돌아가기</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:var(--danger);" onclick="kolCatDelete(\'' + id + '\')">삭제</button>' +
    '</div>'
  );
}
async function kolCatDelete(id){
  const c = kol.cats.find(x => x.id === id);
  const confirmEl = document.getElementById("kolc-confirm");
  if(confirmEl && confirmEl.value.trim() !== c.name){ showToast("탭 이름이 맞지 않아요", { error: true }); return; }
  const { data, error } = await sb.from("kol_categories").delete().eq("id", id).select("id");
  closeModal();
  if(error){ showToast("삭제하지 못했어요: " + error.message, { error: true }); return; }
  if(!data || data.length === 0){ showToast("하위 탭을 편집할 권한이 없어요", { error: true }); return; }
  showToast("'" + c.name + "' 탭을 삭제했어요");
  kol.cat = null;
  kolReload();
}

// 지금 필터로 보이는 명단을 엑셀로 (협조도 평가는 화면에서만 보여주고 파일에는 넣지 않는다 — 원본 디렉토리와 같은 기준)
async function kolExport(){
  const list = kolFiltered();
  if(list.length === 0){ showToast("내려받을 명단이 없어요. 필터를 확인해 주세요.", { error: true }); return; }
  const data = list.map(p => ({
    "성명": p.name, "구분": p.tier || "-", "학회": p.society || "-", "직위/역할": p.role || "-", "소속병원": p.hospital || "-",
    "참여 임상연구": p.trialDetail || "-", "학력": p.education || "-", "주요 경력": p.career || "-",
    "연구/논문 실적": p.papers || "-", "비고": p.note || "-",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 40 }, { wch: 40 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "KOL 목록");
  const cat = kol.cats.find(c => c.id === kol.cat), f = kol.f, parts = [cat ? cat.name.replace(/[\\/:*?"<>|]/g, "_") : ""];
  if(f.society) parts.push(f.society.replace(/대한/g, ""));
  if(f.trial) parts.push(f.trial.replace(/[()]/g, ""));
  if(f.tier) parts.push(f.tier);
  if(f.q.trim()) parts.push(f.q.trim());
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("KOL명단_" + parts.filter(Boolean).join("_") + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function kolReset(){ kol.rows = null; kol.cats = null; kol.cat = null; kol.f = KOL_EMPTY_F(); kol.open = {}; kol.evalOpen = null; }
