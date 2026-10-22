/* ---------------- 회원가입 / 로그인 (Supabase Auth) ----------------
   화면에서는 ID로 가입·로그인하고, Supabase에는 "ID@fte-ctms.local" 형식의 이메일로 저장한다.
   가입하면 profiles에 '승인 대기'로 만들어지고, 관리자가 '팀원 관리' 탭에서 승인해야 데이터가 보인다. */
const LOGIN_EMAIL_DOMAIN = "fte-ctms.local";
let currentProfile = null; // { id, login_id, name, role, approved, member_id }

function idToEmail(id){ return String(id).trim().toLowerCase() + "@" + LOGIN_EMAIL_DOMAIN; }

function renderAuthScreen(mode, notice){
  const isSignup = mode === "signup";
  const enter = isSignup ? "doSignup()" : "doLogin()";
  const field = (label, id, type, ph) =>
    '<div class="field"><div class="field-label">'+label+'</div>' +
    '<input class="input" id="'+id+'" type="'+type+'" placeholder="'+ph+'" autocomplete="off" onkeydown="if(event.key===\'Enter\')'+enter+'"/></div>';
  document.getElementById("app").innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">' +
      '<div class="card" style="max-width:360px;width:100%;">' +
        '<div class="eyebrow">MEDICAL AFFAIRS</div>' +
        '<h1 style="margin:4px 0 16px;">임상의학팀 업무 관리</h1>' +
        (notice ? '<div style="font-size:12px;color:#B45309;background:#FEF3E2;padding:8px 10px;border-radius:7px;margin-bottom:16px;">'+esc(notice)+'</div>' : '') +
        '<div class="tabbar" style="margin:0 0 16px;">' +
          '<button class="tab-btn '+(isSignup?'':'active')+'" style="flex:1;justify-content:center;" onclick="renderAuthScreen(\'login\')">로그인</button>' +
          '<button class="tab-btn '+(isSignup?'active':'')+'" style="flex:1;justify-content:center;" onclick="renderAuthScreen(\'signup\')">회원가입</button>' +
        '</div>' +
        field("ID", "auth-id", "text", isSignup ? "영문·숫자 3자 이상" : "ID") +
        (isSignup ? field("이름", "auth-name", "text", "예: 홍길동") : '') +
        field("비밀번호", "auth-pw", "password", isSignup ? "6자 이상" : "비밀번호") +
        (isSignup ? field("비밀번호 확인", "auth-pw2", "password", "비밀번호 다시 입력") : '') +
        '<div id="auth-error" style="display:none;font-size:12px;color:var(--danger);margin-bottom:10px;"></div>' +
        '<button class="primary-btn" id="auth-submit" onclick="'+enter+'">'+(isSignup ? '가입 신청' : '로그인')+'</button>' +
        (isSignup ? '<div style="font-size:12px;color:#94A3B8;margin-top:12px;line-height:1.5;">가입 후 관리자 승인이 끝나면 사용할 수 있어요.</div>' : '') +
      '</div>' +
    '</div>';
  setTimeout(() => { const el = document.getElementById("auth-id"); if(el) el.focus(); }, 50);
}
function authError(msg){
  const el = document.getElementById("auth-error");
  if(el){ el.textContent = msg; el.style.display = "block"; }
  const btn = document.getElementById("auth-submit");
  if(btn) btn.disabled = false;
}
function authBusy(){
  const btn = document.getElementById("auth-submit");
  if(btn) btn.disabled = true;
}

async function doLogin(){
  const id = document.getElementById("auth-id").value.trim();
  const pw = document.getElementById("auth-pw").value;
  if(!id || !pw){ authError("ID와 비밀번호를 입력해 주세요."); return; }
  authBusy();
  const { error } = await sb.auth.signInWithPassword({ email: idToEmail(id), password: pw });
  if(error){ authError("ID 또는 비밀번호가 올바르지 않아요."); return; }
  afterLogin();
}

async function doSignup(){
  const id = document.getElementById("auth-id").value.trim();
  const name = document.getElementById("auth-name").value.trim();
  const pw = document.getElementById("auth-pw").value;
  const pw2 = document.getElementById("auth-pw2").value;
  if(!/^[A-Za-z0-9._-]{3,30}$/.test(id)){ authError("ID는 영문·숫자(._- 포함) 3~30자로 입력해 주세요."); return; }
  if(!name){ authError("이름을 입력해 주세요."); return; }
  if(pw.length < 6){ authError("비밀번호는 6자 이상으로 입력해 주세요."); return; }
  if(pw !== pw2){ authError("비밀번호 확인이 일치하지 않아요."); return; }
  authBusy();
  const { error } = await sb.auth.signUp({
    email: idToEmail(id), password: pw,
    options: { data: { login_id: id.toLowerCase(), name } },
  });
  if(error){
    authError(error.code === "user_already_exists" || /already/i.test(error.message) ? "이미 사용 중인 ID예요." : "가입하지 못했어요: " + error.message);
    return;
  }
  afterLogin();
}

// 로그인된 계정의 프로필을 읽고, 승인 여부·역할에 따라 앱으로 들어간다.
async function afterLogin(){
  document.getElementById("app").innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  const { data: { user } } = await sb.auth.getUser();
  if(!user){ renderAuthScreen("login"); return; }
  const { data, error } = await sb.from("profiles").select("id,login_id,name,role,approved,member_id").eq("id", user.id).maybeSingle();
  if(error || !data){
    await sb.auth.signOut();
    renderAuthScreen("login", "회원 정보를 불러오지 못했어요. 다시 로그인해 주세요.");
    return;
  }
  currentProfile = data;
  if(!data.approved){ renderPending(); return; }
  // 팀장도 FTE 관리·CTMS·재택은 관리자와 같은 편집 화면으로 들어간다 (관리자 전용 탭 등은 isSysAdmin으로 구분)
  if(data.role === "admin" || data.role === "leader") enterAsAdmin(); else enterAsViewer();
}

function renderPending(){
  document.getElementById("app").innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">' +
      '<div class="card" style="max-width:360px;width:100%;">' +
        '<div class="eyebrow">MEDICAL AFFAIRS</div>' +
        '<h1 style="margin:4px 0 16px;">승인 대기 중</h1>' +
        '<div style="font-size:13px;color:#475569;margin-bottom:20px;line-height:1.6;"><b>'+esc(currentProfile.name)+'</b>('+esc(currentProfile.login_id)+')님, 가입이 완료됐어요.<br/>관리자가 승인하면 사용할 수 있어요.</div>' +
        '<button class="primary-btn" style="margin-bottom:10px;" onclick="afterLogin()">승인 여부 다시 확인</button>' +
        '<button class="add-btn" style="width:100%;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="logout()">로그아웃</button>' +
      '</div>' +
    '</div>';
}

// 저장 대기분을 먼저 저장한 뒤 로그아웃하고, 화면의 데이터도 비운다.
async function logout(reason){
  if(isAdmin() && state.dirty){
    try{ await saveNow(); }catch(e){ /* best-effort flush before logging out */ }
  }
  if(!isAdmin() && Object.keys(state.ctmsTouched).length > 0){
    try{ await ctmsOwnerSaveNow(); }catch(e){ /* best-effort flush before logging out */ }
  }
  try{ await sb.auth.signOut(); }catch(e){ /* session may already be gone */ }
  currentProfile = null;
  profilesCache = null;
  worklogReset(); // worklog.js
  Object.assign(state, {
    role: null, loaded: false, dirty: false, saveError: false, saveBlocked: false,
    taskTypes: [], members: [], products: [], assignments: [], activityLog: [],
    ctms: {}, ctmsIssues: {}, ctmsCost: {}, ctmsExcluded: {}, ctmsTouched: {}, ctmsAuth: null,
  });
  document.body.classList.remove("role-viewer", "ctms-edit", "save-blocked");
  renderAuthScreen("login", typeof reason === "string" ? reason : "");
}

function showChangePasswordModal(){
  showModal(
    '<div style="font-weight:800;font-size:14px;margin-bottom:10px;">비밀번호 변경</div>' +
    '<div class="field"><div class="field-label">새 비밀번호</div><input type="password" id="pw-new" class="input" placeholder="6자 이상"/></div>' +
    '<div class="field" style="margin-bottom:6px;"><div class="field-label">새 비밀번호 확인</div><input type="password" id="pw-confirm" class="input"/></div>' +
    '<div id="pw-error" style="display:none;font-size:12px;color:var(--danger);margin-bottom:8px;"></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px;">' +
      '<button class="add-btn" style="flex:1;justify-content:center;background:#fff;color:#475569;border:1px solid var(--border);" onclick="closeModal()">취소</button>' +
      '<button class="add-btn" style="flex:1;justify-content:center;" onclick="confirmChangePassword()">변경</button>' +
    '</div>'
  );
}
async function confirmChangePassword(){
  const next = document.getElementById("pw-new").value;
  const confirm = document.getElementById("pw-confirm").value;
  const errEl = document.getElementById("pw-error");
  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = "block"; };
  if(next.length < 6){ showErr("새 비밀번호는 6자 이상으로 입력해 주세요."); return; }
  if(next !== confirm){ showErr("새 비밀번호 확인이 일치하지 않아요."); return; }
  const { error } = await sb.auth.updateUser({ password: next });
  if(error){ showErr(error.code === "same_password" ? "지금 비밀번호와 다른 비밀번호를 입력해 주세요." : "변경하지 못했어요: " + error.message); return; }
  closeModal();
  showToast("비밀번호를 변경했어요");
}

async function initAuth(){
  const { data: { session } } = await sb.auth.getSession();
  if(session) afterLogin(); else renderAuthScreen("login");
}
