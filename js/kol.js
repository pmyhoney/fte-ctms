/* ---------------- KOL 탭 (KOL 통합 디렉토리) ----------------
   고혈압·심혈관 학회 임원과 로제텔 임상연구 참여 PI 명단. 승인된 회원 누구나 조회만 한다.
   협조도 평가 등 내부 정보가 있어 명단은 공개 저장소가 아닌 Supabase kols 테이블에만 있다
   (supabase/migrations/20261030000000_kols.sql). */

const KOL_TRIAL_LABEL = {
  "로제텔정OS(PCI)": "OS · PCI",
  "로제텔정OS(Multi)": "OS · Multi",
  "로제텔정OS(High risk)": "OS · High risk",
  "로제텔정PMS": "로제텔정 PMS",
  "로제텔핀정PMS": "로제텔핀정 PMS",
};
const KOL_TIERS = ["회장단", "상임이사", "임상PI"];
const kol = { rows: null, f: { q: "", society: "", trial: "", tier: "", sort: "name" }, open: {}, evalOpen: null };

async function kolLoad(){
  try{
    const data = await sbFetchAll(() => sb.from("kols").select("id,data").order("id")); // worklog.js
    kol.rows = data.map(r => Object.assign({}, r.data, { id: r.id }));
  }catch(e){
    showToast("KOL 명단을 불러오지 못했어요: " + e.message, { error: true });
    kol.rows = [];
  }
  if(state.tab === "kol") renderTabContent();
}

function kolFiltered(){
  const f = kol.f, q = f.q.trim().toLowerCase();
  const list = kol.rows.filter(p =>
    (!f.society || p.society === f.society) &&
    (!f.trial || (p.trials || []).includes(f.trial)) &&
    (!f.tier || (p.tier || "").includes(f.tier)) &&
    (!q || [p.name, p.hospital, p.role, p.society].some(v => (v || "").toLowerCase().includes(q))));
  const by = (k) => (a, b) => (a[k] || "").localeCompare(b[k] || "", "ko");
  return list.sort(by(f.sort === "tier" ? "tier" : f.sort === "hospital" ? "hospital" : "name"));
}

function renderKolTab(){
  if(!kol.rows){
    if(!kol.loading){ kol.loading = true; kolLoad().finally(() => { kol.loading = false; }); }
    return '<div class="card"><div class="empty">불러오는 중…</div></div>';
  }
  if(kol.rows.length === 0) return '<div class="card"><div class="empty">아직 등록된 KOL 명단이 없어요.</div></div>';
  const rows = kol.rows, f = kol.f;
  const stat = (k, v) => '<div class="tr-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  const chips = (key, list) => '<div class="kol-chips">' + list.map(([v, label, n]) =>
    '<button class="kol-chip view-ok' + (f[key] === v ? ' on' : '') + '" onclick="kolFilter(\'' + key + '\', \'' + esc(v) + '\')">' + esc(label) + '<span>' + n + '</span></button>').join("") + '</div>';
  const societies = [...new Set(rows.map(p => p.society).filter(Boolean))];
  const count = (pred) => rows.filter(pred).length;
  return '<div class="stack">' +
    '<div class="tr-stats kol-stats">' +
      stat("전체 인원", rows.length + "명") +
      stat("회장단급", count(p => (p.tier || "").includes("회장단")) + "명") +
      stat("상임이사급", count(p => (p.tier || "").includes("상임이사")) + "명") +
      stat("임상 참여", count(p => (p.trials || []).length > 0) + "명") +
    '</div>' +
    '<div class="card">' +
      '<div style="font-weight:800;font-size:14px;margin-bottom:2px;">KOL 통합 디렉토리</div>' +
      '<div style="font-size:12px;color:#94A3B8;margin-bottom:12px;">대한고혈압학회·대한심장학회·대한심부전학회 임원 및 로제텔 임상연구 참여 PI 통합 명단 · 내부 참고용</div>' +
      '<input class="input view-ok" type="search" placeholder="이름·병원·직위로 검색 (예: 서울대병원)" value="' + esc(f.q) + '" oninput="kol.f.q=this.value;kolRenderList()" style="margin-bottom:12px;"/>' +
      '<div class="field-label">학회</div>' +
      chips("society", [["", "전체", rows.length]].concat(societies.map(s => [s, s.replace(/대한/g, ""), count(p => p.society === s)]))) +
      '<div class="field-label">참여 임상연구</div>' +
      chips("trial", [["", "전체", rows.length]].concat(Object.keys(KOL_TRIAL_LABEL).map(t => [t, KOL_TRIAL_LABEL[t], count(p => (p.trials || []).includes(t))]))) +
      '<div class="field-label">구분</div>' +
      chips("tier", [["", "전체", rows.length]].concat(KOL_TIERS.map(t => [t, t, count(p => (p.tier || "").includes(t))]))) +
      '<div style="font-size:12px;color:#64748B;margin-top:4px;line-height:1.7;">' +
        '<span class="kol-trial-tag">임상 참여</span> 당사 로제텔 임상연구(OS/PMS)에 참여한 PI · ' +
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
        '</div>' +
      '</div>' +
      '<div id="kol-list">' + kolListHtml() + '</div>' +
    '</div>' +
  '</div>';
}

function kolTierClass(tier){
  if((tier || "").includes("회장단")) return " chair";
  if((tier || "").includes("상임이사")) return " standing";
  return "";
}

function kolListHtml(){
  const list = kolFiltered();
  if(list.length === 0) return '<div class="empty">검색 결과가 없어요. 다른 검색어나 필터를 골라 보세요.</div>';
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
              '<span class="kol-eval-tip"><b>' + (p.evaluation === 1 ? '추천 사유' : '비추천 사유') + '</b>' + (p.evalTags || []).map(t => '· ' + esc(t)).join('<br/>') + '</span></span>' : '') +
            ((p.trials || []).length ? '<span class="kol-trial-tag">임상 참여</span>' : '') +
          '</div>' +
          (roleText ? '<div style="font-size:12px;color:var(--accent);font-weight:600;">' + esc(roleText) + '</div>' : '') +
          '<div style="font-size:12.5px;color:#64748B;">' + esc(p.hospital || '소속 미상') + '</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">' +
            '<span class="kol-pill' + kolTierClass(p.tier) + '">' + esc(p.tier) + '</span>' +
            (p.trials || []).map(t => '<span class="kol-pill">' + esc(KOL_TRIAL_LABEL[t] || t) + '</span>').join("") +
          '</div>' +
        '</div>' +
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
  if(c) c.textContent = kolFiltered().length + "명 표시 (전체 " + kol.rows.length + "명)";
}
function kolFilter(key, v){ kol.f[key] = kol.f[key] === v && key !== "sort" ? "" : v; renderTabContent(); }
function kolToggle(id){ if(kol.open[id]) delete kol.open[id]; else kol.open[id] = true; kolRenderList(); }
function kolEval(id){ kol.evalOpen = kol.evalOpen === id ? null : id; kolRenderList(); }

// 지금 필터로 보이는 명단을 엑셀로 (협조도 평가는 화면에서만 보여주고 파일에는 넣지 않는다 — 원본 디렉토리와 같은 기준)
async function kolExport(){
  const list = kolFiltered();
  if(list.length === 0){ showToast("내려받을 명단이 없어요. 필터를 확인해 주세요.", { error: true }); return; }
  const data = list.map(p => ({
    "성명": p.name, "구분": p.tier, "학회": p.society || "-", "직위/역할": p.role || "-", "소속병원": p.hospital || "-",
    "참여 임상연구": p.trialDetail || "-", "학력": p.education || "-", "주요 경력": p.career || "-",
    "연구/논문 실적": p.papers || "-", "비고": p.note || "-",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 40 }, { wch: 40 }, { wch: 26 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "KOL 목록");
  const f = kol.f, parts = [];
  if(f.society) parts.push(f.society.replace(/대한/g, ""));
  if(f.trial) parts.push(f.trial.replace(/[()]/g, ""));
  if(f.tier) parts.push(f.tier);
  if(f.q.trim()) parts.push(f.q.trim());
  const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  await saveFileToViewer("KOL명단_" + (parts.length ? parts.join("_") : "전체") + ".xlsx", xlsxData, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function kolReset(){ kol.rows = null; kol.f = { q: "", society: "", trial: "", tier: "", sort: "name" }; kol.open = {}; kol.evalOpen = null; }
