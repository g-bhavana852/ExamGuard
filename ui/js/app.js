// APP.JS — nav, page builders, all API calls. Render helpers in components.js.

let currentUser  = null;  // { user_id, full_name, email, username, role, roles[] }
let sessionToken = null;

function saveSession()    { localStorage.setItem('eg_token', sessionToken || ''); localStorage.setItem('eg_user', currentUser ? JSON.stringify(currentUser) : ''); }
function clearSession()   { localStorage.removeItem('eg_token'); localStorage.removeItem('eg_user'); }
function restoreSession() {
  const tok = localStorage.getItem('eg_token'), usr = localStorage.getItem('eg_user');
  if (tok && usr) { try { sessionToken = tok; currentUser = JSON.parse(usr); return true; } catch {} }
  return false;
}

const PAGE_TITLES = {
  classroom: 'Exam Session', dashboard: 'Dashboard', monitor: 'Live Monitor',
  courses: 'Courses', exams: 'My Exams', questions: 'Question Bank',
  'student-view': 'My Results', flagged: 'Flagged Attempts',
  logs: 'Proctor Logs', analytics: 'Analytics', schema: 'DB Schema', results: 'Exam Results',
};

// Pages visible per role. Admin bypasses this entirely.
const PAGE_ROLES = {
  classroom:      ['admin','proctor','instructor','teacher','student'],
  dashboard:      ['admin','proctor','instructor','teacher'],
  monitor:        ['admin','proctor','instructor','teacher'],
  courses:        ['admin','instructor','teacher'],
  exams:          ['admin','instructor','teacher'],
  questions:      ['admin','instructor','teacher'],
  'student-view': ['student'],
  flagged:        ['admin','proctor','instructor','teacher'],
  logs:           ['admin','proctor','instructor','teacher'],
  analytics:      ['admin','instructor','teacher'],
  schema:         ['admin'],
  results:        ['admin','instructor','teacher','student'],
};

const ALL_NAV = [
  { section:'Exams',  id:'classroom',    icon:'▣', label:'Exam Session',  roles:['teacher','instructor','proctor','admin'] },
  { section:'Exams',  id:'exams',        icon:'▤', label:'My Exams',      roles:['teacher','instructor','admin'] },
  { section:'Exams',  id:'questions',    icon:'?', label:'Question Bank', roles:['teacher','instructor','admin'] },
  { section:'Exams',  id:'results',      icon:'★', label:'Results',       roles:['teacher','instructor','admin'] },
  { section:'Exams',  id:'classroom',    icon:'▣', label:'Exam Session',  roles:['student'] },
  { section:'My',     id:'student-view', icon:'★', label:'My Results',    roles:['student'] },
  { section:'Review', id:'flagged',      icon:'⚑', label:'Flagged',       roles:['admin','teacher','instructor','proctor'] },
  { section:'Review', id:'logs',         icon:'≡', label:'Proctor Logs',  roles:['admin','teacher','instructor','proctor'] },
  { section:'Review', id:'analytics',    icon:'≈', label:'Analytics',     roles:['admin','teacher','instructor'] },
  { section:'System', id:'dashboard',    icon:'◈', label:'Dashboard',     roles:['admin'] },
  { section:'System', id:'monitor',      icon:'◉', label:'Live Monitor',  roles:['admin'] },
  { section:'System', id:'courses',      icon:'◧', label:'Courses',       roles:['admin','teacher','instructor'] },
  { section:'System', id:'schema',       icon:'⊞', label:'DB Schema',     roles:['admin'] },
];

function hasRole(r)        { return !!currentUser?.roles?.includes(r); }
function canAccess(pageId) { return !!(currentUser?.roles?.some(r => PAGE_ROLES[pageId]?.includes(r))); }
function defaultPage()     { const r = currentUser?.role; return r === 'student' ? 'classroom' : 'exams'; }

function buildNavSections() {
  const seen = new Set();
  const visible = ALL_NAV.filter(item => {
    if (seen.has(item.id)) return false;
    const ok = item.roles ? (currentUser?.roles||[]).some(r => item.roles.includes(r)) : canAccess(item.id);
    if (ok) seen.add(item.id);
    return ok;
  });
  const sections = [];
  for (const item of visible) {
    let sec = sections.find(s => s.section === item.section);
    if (!sec) { sec = { section: item.section, items: [] }; sections.push(sec); }
    sec.items.push(item);
  }
  return sections;
}

let _currentPage = null;

function showPage(id) {
  if (id !== 'monitor' && _monitorSSE) { _monitorSSE.close(); _monitorSSE = null; }
  _currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if ((n.getAttribute('onclick')||'').includes("'"+id+"'")) n.classList.add('active');
  });
  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
  if (id === 'monitor') buildMonitor();
}

function refreshPage() {
  if (!_currentPage || _currentPage === 'monitor') return;
  const builders = {
    classroom: buildClassroom, dashboard: buildDashboard, courses: buildCourses,
    exams: buildExams, questions: buildQuestions, flagged: buildFlagged, logs: buildLogs,
    'student-view': buildStudentView, analytics: buildAnalytics, schema: buildSchema, results: buildResults,
  };
  builders[_currentPage]?.();
}

// Single shared fetch wrapper — all verb helpers delegate here
function authHeaders(extra = {}) { return sessionToken ? { 'x-session-token': sessionToken, ...extra } : extra; }

async function apiErrMsg(res) {
  const text = await res.text();
  try { const j = JSON.parse(text); return j.error || j.message || `HTTP ${res.status}`; }
  catch { return `HTTP ${res.status}`; }
}

async function apiFetch(path, opts = {}) {
  const headers = opts.body
    ? authHeaders({ 'Content-Type': 'application/json', ...(opts.headers||{}) })
    : authHeaders(opts.headers||{});
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { handle401(); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error(await apiErrMsg(res));
  return res.json();
}

const api       = path         => apiFetch(path);
const apiPost   = (path, data) => apiFetch(path, { method:'POST',   body: JSON.stringify(data) });
const apiPut    = (path, data) => apiFetch(path, { method:'PUT',    body: JSON.stringify(data) });
const apiPatch  = (path, data) => apiFetch(path, { method:'PATCH',  body: JSON.stringify(data) });
const apiDelete = path         => apiFetch(path, { method:'DELETE' });

function handle401() {
  clearSession();
  currentUser = sessionToken = currentAttemptId = null;
  if (examState?.timerInterval) clearInterval(examState.timerInterval);
  examState = null;
  stopWarningPolling();
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
  document.getElementById('login-error').textContent = '';
  switchAuthTab('login');
  document.getElementById('login-overlay').classList.add('active');
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId), show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('signup-form').classList.toggle('hidden', isLogin);
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);
  document.getElementById('login-error').textContent = document.getElementById('signup-error').textContent = '';
}

function onRoleChange(_radio) {}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn'), errEl = document.getElementById('login-error');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await apiPost('/api/login', { identifier: e.target.identifier.value.trim(), password: e.target.password.value });
    currentUser  = { user_id: data.user_id, full_name: data.full_name, email: data.email, username: data.username, role: data.role, roles: data.roles };
    sessionToken = data.token;
    saveSession(); onLoginSuccess();
  } catch (err) { errEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Sign In'; }
}

async function doSignup(e) {
  e.preventDefault();
  const btn = document.getElementById('signup-btn'), errEl = document.getElementById('signup-error');
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await apiPost('/api/signup', { full_name: e.target.full_name.value.trim(), username: e.target.username.value.trim(), password: e.target.password.value, roles: [e.target.role.value] });
    const data = await apiPost('/api/login', { identifier: e.target.username.value.trim(), password: e.target.password.value });
    currentUser  = { user_id: data.user_id, full_name: data.full_name, email: data.email, username: data.username, role: data.role, roles: data.roles };
    sessionToken = data.token;
    saveSession(); onLoginSuccess();
  } catch (err) {
    if (document.getElementById('signup-error')) errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

async function doLogout() {
  if (sessionToken) apiPost('/api/logout', { token: sessionToken }).catch(() => {});
  if (examState?.timerInterval) clearInterval(examState.timerInterval);
  examState = currentUser = sessionToken = currentAttemptId = null;
  clearSession(); stopWarningPolling();
  ['login-form','signup-form'].forEach(id => document.getElementById(id)?.reset());
  const lb = document.getElementById('login-btn'), sb = document.getElementById('signup-btn');
  if (lb) { lb.disabled = false; lb.textContent = 'Sign In'; }
  if (sb) { sb.disabled = false; sb.textContent = 'Create Account'; }
  document.getElementById('login-error').textContent = document.getElementById('signup-error').textContent = '';
  switchAuthTab('login');
  document.getElementById('login-overlay').classList.add('active');
}

function onLoginSuccess() {
  document.getElementById('login-overlay').classList.remove('active');
  document.querySelector('.nav').innerHTML = renderNav(buildNavSections());
  updateUserCard(); updateTopbar(); bootstrapPages(); showPage(defaultPage());
}

function updateUserCard() {
  if (!currentUser) return;
  const initials = currentUser.full_name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const badges   = (currentUser.roles||[currentUser.role]).map(r => `<span class="role-badge role-badge-${r}">${r}</span>`).join('');
  document.querySelector('.sidebar-footer').innerHTML = `
    <div class="user-card">
      <div class="avatar">${initials}</div>
      <div class="user-info"><div class="name">${esc(currentUser.full_name)}</div><div class="role-badges">${badges}</div></div>
    </div>
    <button type="button" class="btn btn-outline btn-full" onclick="doLogout()">Sign Out</button>`;
}

function updateTopbar() {
  if (!currentUser) return;
  let btns = '';
  if (hasRole('instructor')||hasRole('teacher')||hasRole('admin'))
    btns += `<button type="button" class="btn btn-primary" onclick="showCreateExamModal()">+ New Exam</button>`;
  if (hasRole('admin')||hasRole('teacher')||hasRole('instructor'))
    btns += `<button type="button" class="btn btn-outline" onclick="showCreateCourseModal()">+ Course</button>
             <button type="button" class="btn btn-outline" onclick="window.location='/api/export'">Export</button>`;
  document.getElementById('topbar-actions').innerHTML =
    `<button type="button" id="topbar-refresh-btn" class="btn btn-outline btn-refresh" onclick="refreshPage()">Refresh</button>
     <span class="topbar-status" id="topbar-status">● ExamGuard</span>${btns}`;
}

function loadingHtml() {
  return `<div class="card"><div class="card-body" style="padding:32px;text-align:center;color:var(--text3)">Loading…</div></div>`;
}

function errorHtml(endpoint, msg) {
  return `<div class="card"><div class="card-body" style="padding:24px">
    <p style="color:var(--red);font-weight:600">Failed to load ${endpoint}</p>
    <p style="color:var(--text3);font-size:13px;margin-top:8px">${esc(msg)}</p>
    <p style="color:var(--text3);font-size:12px;margin-top:12px">Make sure the server is running:<br>
    <code style="background:var(--bg3);padding:4px 8px;border-radius:4px">cd server &amp;&amp; npm install &amp;&amp; node server.js</code></p>
  </div></div>`;
}

async function buildPage(id, endpoint, render, animate = false) {
  const el = document.getElementById('page-' + id);
  el.innerHTML = loadingHtml();
  try { el.innerHTML = render(await api(endpoint)); if (animate) animateProgressBars(); }
  catch (err) { el.innerHTML = errorHtml(endpoint.replace('/api/',''), err.message); }
}

function buildDashboard() {
  return buildPage('dashboard', '/api/dashboard', d => `
    ${renderStatCards(d.stats)}
    <div class="two-col">
      <div><div class="card">
        <div class="card-header"><span class="card-title">Active Alerts</span><span class="topbar-status">Real-time</span></div>
        <div class="card-body" style="padding:16px">${renderAlerts(d.alerts)}</div>
      </div></div>
      <div><div class="card">
        <div class="card-header"><span class="card-title">Exam Funnel — ${esc(d.examTitle)}</span></div>
        <div class="card-body"><div style="display:flex;flex-direction:column;gap:14px">${renderFunnel(d.funnel)}</div></div>
      </div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Score Distribution — ${esc(d.examTitle)}</span><span class="topbar-status">Q03 Analytical Query</span></div>
      <div class="card-body">${renderScoreChart(d.scoreChart)}</div>
    </div>`, true);
}

let _monitorSSE = null;

function buildMonitor() {
  const el = document.getElementById('page-monitor');
  el.innerHTML = `
    <div id="monitor-alert-bar" style="margin-bottom:16px">
      <div class="alert alert-yellow"><span>◉</span><span>Connecting to live feed…</span></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span id="monitor-live-badge" style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
        <span class="live-dot" style="width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 1.5s infinite"></span> LIVE
      </span>
      <span id="monitor-counts" style="font-size:13px;color:var(--text3)">—</span>
      <span id="monitor-lastupdate" style="font-size:11px;color:var(--text3);margin-left:auto"></span>
    </div>
    <div id="monitor-cards-grid" class="monitor-grid"></div>
    <div style="margin-top:24px"><div class="card">
      <div class="card-header">
        <span class="card-title">Live Event Feed</span>
        <span style="font-size:12px;color:var(--text3)">Last 10 events across all active students</span>
      </div>
      <div id="monitor-event-feed" style="font-size:13px;font-family:monospace;padding:0 16px 12px"></div>
    </div></div>`;

  if (_monitorSSE) { _monitorSSE.close(); _monitorSSE = null; }
  _monitorSSE = new EventSource('/api/monitor/stream');
  const feedLines = [];

  _monitorSSE.onmessage = e => {
    const d = JSON.parse(e.data);
    document.getElementById('monitor-alert-bar').innerHTML =
      `<div class="alert alert-yellow"><span>◉</span><span>${d.examAlert}</span></div>`;
    document.getElementById('monitor-counts').textContent = `${d.activeCount} active · ${d.flaggedCount} flagged`;
    document.getElementById('monitor-lastupdate').textContent =
      'Updated ' + new Date(d.ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    document.getElementById('monitor-cards-grid').innerHTML = renderMonitorCards(d.students);

    d.students.forEach(s => {
      if (s.lastEvent && s.lastEvent !== 'EXAM_STARTED' && s.lastEvent !== 'EXAM_SUBMITTED') {
        const evTime = s.lastEventTime
          ? new Date(s.lastEventTime).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
          : new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
        const col = ['COPY_PASTE_DETECTED','MULTIPLE_LOGIN_DETECTED','DEVTOOLS_OPENED'].includes(s.lastEvent)
          ? '#f87171' : ['RAPID_ANSWERING'].includes(s.lastEvent) ? '#fb923c' : '#facc15';
        const key = `${s.attempt_id}_${s.lastEvent}_${s.lastEventTime}`;
        if (!feedLines.find(l => l.key === key)) {
          feedLines.unshift({ key, html: `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="color:var(--text3)">${evTime}</span>
            <span style="color:${col};margin:0 8px">${s.lastEvent.replace(/_/g,' ')}</span>
            <span style="color:var(--text2)">${esc(s.name)}</span>
            <span style="color:var(--text3);font-size:11px;float:right">Suspicion: ${s.suspicion}/100</span>
          </div>` });
          if (feedLines.length > 10) feedLines.pop();
          document.getElementById('monitor-event-feed').innerHTML =
            feedLines.length ? feedLines.map(l => l.html).join('') : '<div style="color:var(--text3);padding:12px 0">No suspicious events yet.</div>';
        }
      }
    });
  };

  _monitorSSE.onerror = () => {
    const el = document.getElementById('monitor-live-badge');
    el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#f87171"></span> DISCONNECTED';
    el.style.color = '#f87171';
  };
}

async function buildFlagged(sort = 'suspicion') {
  const container = document.getElementById('page-flagged');
  container.innerHTML = loadingHtml();
  try {
    const d = await api(`/api/flagged?sort=${sort}`);
    const flagged = d.attempts.filter(a => a.statusBadge==='badge-red').length;
    const timedOut = d.attempts.filter(a => a.statusText==='Timed Out').length;
    const live = d.attempts.filter(a => a.isLive).length;
    const unresolved = d.flags.filter(f => !f.resolved).length;
    const SORTS = { suspicion:'Suspicion Score', tabs:'Tab Switches', paste:'Copy-Paste', fullscreen:'Fullscreen Exits', rapid:'Rapid Answering', composite:'Composite Risk' };
    const sortOptions = Object.entries(SORTS).map(([v,l]) => `<option value="${v}" ${v===sort?'selected':''}>${l}</option>`).join('');
    container.innerHTML = `
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--text3)">Sort by:</label>
        <select style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px" onchange="buildFlagged(this.value)">${sortOptions}</select>
        <span style="font-size:12px;color:var(--text3)">${d.attempts.length} students · ${live>0?`<span style="color:var(--red)">${live} live now</span>`:'0 live'}</span>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <span class="card-title">Suspicious &amp; Flagged Attempts</span>
          <div style="display:flex;gap:8px">
            <span class="badge badge-red">${flagged} Flagged</span>
            <span class="badge badge-yellow">${timedOut} Timed Out</span>
            ${live>0?`<span class="badge badge-orange">${live} Live</span>`:''}
          </div>
        </div>
        ${renderFlaggedTable(d.attempts)}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Open Suspicion Flags</span><span class="badge badge-red">${unresolved} unresolved</span></div>
        ${renderFlagsTable(d.flags)}
      </div>`;
  } catch (err) { container.innerHTML = errorHtml('flagged attempts', err.message); }
}

async function buildLogs(attemptId = null) {
  const container = document.getElementById('page-logs');
  container.innerHTML = loadingHtml();
  try {
    const [d, a] = await Promise.all([api(attemptId ? `/api/logs?attempt_id=${attemptId}` : '/api/logs'), api('/api/proctor-actions')]);
    const selectorOptions = (d.allAttempts||[]).map(at =>
      `<option value="${at.attempt_id}" ${at.attempt_id===d.attemptId?'selected':''}>${esc(at.label)}</option>`
    ).join('');
    container.innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><span class="card-title">Proctor Actions</span><span class="badge badge-gray">${a.actions.length} total</span></div>
        ${renderProctorActions(a.actions)}
      </div>
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--text3)">Student attempt:</label>
        <select id="logs-attempt-select" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;min-width:280px"
          onchange="buildLogs(parseInt(this.value))">${selectorOptions}</select>
      </div>
      <div class="two-col">
        <div class="card" style="margin-bottom:0">
          <div class="card-header"><span class="card-title">Event Timeline — ${esc(d.badge)}</span><span class="topbar-status">${d.risk.totalEvents} events · ${esc(d.risk.duration)}</span></div>
          ${renderTimeline(d.timeline)}
        </div>
        <div><div class="card" style="margin-bottom:16px">
          <div class="card-header"><span class="card-title">Risk Summary</span></div>
          <div class="card-body" style="text-align:center">${renderRiskSummary(d.risk)}</div>
        </div></div>
      </div>`;
  } catch (err) { container.innerHTML = errorHtml('logs', err.message); }
}

function buildStudentView() {
  const studentId = currentUser?.role === 'student' ? currentUser.user_id : null;
  const endpoint  = studentId ? `/api/student-view?student_id=${studentId}` : '/api/student-view';
  const container = document.getElementById('page-student-view');
  container.innerHTML = loadingHtml();
  api(endpoint).then(d => {
    if (!d.exams?.length) {
      container.innerHTML = `
        <div style="max-width:460px;margin:80px auto 0;text-align:center">
          <div style="font-size:40px;margin-bottom:16px">★</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">No Exams Yet</div>
          <div style="font-size:14px;color:var(--text3);margin-bottom:24px;line-height:1.7">
            You haven't taken any exams yet.<br>
            Get a code from your teacher and <a href="#" onclick="showPage('classroom');return false" style="color:var(--accent2)">enter it here →</a>
          </div>
        </div>`;
      return;
    }
    container.innerHTML = `<div style="font-size:13px;color:var(--text3);margin-bottom:16px">${esc(d.label)}</div><div class="exam-grid">${renderExamCards(d.exams)}</div>`;
    animateProgressBars();
  }).catch(err => { container.innerHTML = errorHtml('my-results', err.message); });
}

async function buildClassroom() {
  const container = document.getElementById('page-classroom');
  container.innerHTML = loadingHtml();
  try {
    const role = currentUser?.role;
    const isTeacher = ['proctor','admin','instructor','teacher'].includes(role);
    if (isTeacher) {
      const d = await api('/api/classroom/active');
      const sessions = d.classrooms || (d.classroom ? [d.classroom] : []);
      if (sessions.length > 0) {
        const sessionCards = sessions.map(c => `
          <div style="display:grid;grid-template-columns:340px 1fr;gap:20px;align-items:start;margin-bottom:28px">
            <div class="card">
              <div class="card-header"><span class="card-title" style="font-size:14px">${esc(c.title)}</span><span class="badge badge-green" style="animation:pulse 2s infinite">● LIVE</span></div>
              <div class="card-body" style="text-align:center;padding:24px 20px">
                <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Student Exam Code</div>
                <div id="code-display-${c.exam_id}" style="font-size:56px;font-weight:900;letter-spacing:12px;color:var(--accent2);font-family:monospace;line-height:1;margin-bottom:14px;cursor:pointer;user-select:all"
                  title="Click to copy" onclick="copyCode('${c.join_code?esc(c.join_code):''}')">${c.join_code?esc(c.join_code):'Loading...'}</div>
                <div id="copy-hint-${c.exam_id}" style="font-size:11px;color:var(--text3);margin-bottom:16px">${c.join_code?'Click code to copy':'Refreshing...'}</div>
                <div style="display:flex;justify-content:center;gap:20px;font-size:12px;color:var(--text3);margin-bottom:18px;flex-wrap:wrap">
                  <span>${c.duration_minutes} min</span><span>${Math.round(c.total_marks)} marks</span>
                  <span style="color:var(--green);font-weight:600">● ${c.live_count||0} live</span>
                  <span style="color:var(--text3)">${c.total_joined||0} joined</span>
                </div>
                <div style="display:flex;gap:8px;justify-content:center">
                  <button class="btn btn-outline" style="font-size:12px;padding:6px 20px" onclick="buildClassroom()">Refresh</button>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><span class="card-title">Students in Session</span><span class="badge badge-gray">${c.total_joined||0} joined</span></div>
              <div id="classroom-live-list-${c.exam_id}" class="card-body" style="padding:16px">Loading…</div>
            </div>
          </div>`).join('');
        container.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div>
              <div style="font-size:15px;font-weight:600">${sessions.length} active session${sessions.length>1?'s':''}</div>
              <div style="font-size:12px;color:var(--text3);margin-top:2px">Share the code with your students verbally or on the board</div>
            </div>
            <button class="btn btn-primary" style="font-size:13px" onclick="showPage('exams')">+ Open Another Exam</button>
          </div>` + sessionCards;
        sessions.forEach(c => loadClassroomLiveList(c.exam_id));
      } else {
        container.innerHTML = `
          <div style="max-width:480px;margin:80px auto 0;text-align:center">
            <div style="font-size:48px;margin-bottom:16px">▣</div>
            <div style="font-size:22px;font-weight:700;margin-bottom:8px">No Active Exam Sessions</div>
            <div style="font-size:14px;color:var(--text3);margin-bottom:28px;line-height:1.7">
              Open an exam from <strong>My Exams</strong> to generate a unique code.<br>Share the code with your students — they enter it to start.
            </div>
            <button class="btn btn-primary" style="font-size:15px;padding:12px 32px" onclick="showPage('exams')">Go to My Exams</button>
          </div>`;
      }
    } else {
      // Student: enter the join code
      container.innerHTML = `
        <div style="max-width:420px;margin:60px auto 0">
          <div class="card">
            <div class="card-body" style="text-align:center;padding:44px 36px">
              <div style="font-size:40px;margin-bottom:12px">▣</div>
              <div style="font-size:24px;font-weight:700;margin-bottom:6px">Enter Exam Code</div>
              <div style="font-size:13px;color:var(--text3);margin-bottom:28px;line-height:1.6">Get the 6-character code from your teacher to begin your exam</div>
              <form onsubmit="joinClassroom(event)">
                <input id="join-code-input" class="form-input" placeholder="ABC123" maxlength="6"
                  style="font-size:32px;text-align:center;letter-spacing:4px;text-transform:uppercase;font-family:monospace;padding:16px;font-weight:700;width:100%;box-sizing:border-box"
                  oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" autocomplete="off" required>
                <div id="join-error" style="color:var(--red);font-size:13px;margin-top:10px;min-height:20px"></div>
                <button type="submit" id="join-btn" class="btn btn-primary btn-full" style="margin-top:14px;font-size:16px;padding:14px">Start Exam</button>
              </form>
            </div>
          </div>
          <div style="margin-top:16px;text-align:center;font-size:12px;color:var(--text3)">
            Already took an exam? <a href="#" onclick="showPage('student-view');return false" style="color:var(--accent2)">View My Results →</a>
          </div>
        </div>`;
    }
  } catch (err) { container.innerHTML = errorHtml('classroom', err.message); }
}

function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    document.querySelectorAll('[id^="copy-hint-"]').forEach(el => {
      el.textContent = '✓ Copied!'; el.style.color = 'var(--green)';
      setTimeout(() => { el.textContent = 'Click code to copy'; el.style.color = 'var(--text3)'; }, 2000);
    });
  }).catch(() => {});
}

function buildClassroomStartForm() { buildClassroom(); }

async function loadClassroomLiveList(examId) {
  try {
    const rows = await api(`/api/monitor/exam/${examId}`);
    const el = document.getElementById(`classroom-live-list-${examId}`);
    if (!el) return;
    if (!rows.students?.length) { el.innerHTML = '<p style="color:var(--text3);font-size:13px">No students have joined yet.</p>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px;text-align:left">Student</th><th style="padding:6px 8px;text-align:center">Status</th>
        <th style="padding:6px 8px;text-align:center">Suspicion</th><th style="padding:6px 8px;text-align:center">Tabs</th>
      </tr></thead>
      <tbody>${rows.students.map(s => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px">${esc(s.name)}</td>
        <td style="padding:8px;text-align:center"><span class="badge ${s.status==='in_progress'?'badge-green':'badge-gray'}">${s.status}</span></td>
        <td style="padding:8px;text-align:center;color:${s.suspicion>=70?'var(--red)':s.suspicion>=40?'var(--orange)':s.suspicion>=10?'var(--yellow)':'var(--green)'}">${s.suspicion}</td>
        <td style="padding:8px;text-align:center">${s.tabs}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch { /* ignore */ }
}


async function joinClassroom(e) {
  e.preventDefault();
  const btn = document.getElementById('join-btn'), errEl = document.getElementById('join-error');
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  errEl.textContent = ''; btn.disabled = true; btn.textContent = 'Joining...';
  try { startExamFromClassroom(await apiPost('/api/classroom/join', { code })); }
  catch (err) { errEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Start Exam'; }
}

function startExamFromClassroom(d) {
  examState = { attempt_id: d.attempt_id, exam: d.exam, questions: d.questions, answers: {}, timerInterval: null, started_at: d.started_at||null };
  currentAttemptId = d.attempt_id;
  renderExamOverlay(); startExamTimer(); startWarningPolling();
  document.documentElement.requestFullscreen().catch(() => {});
}

async function buildAnalytics(examId = null) {
  const container = document.getElementById('page-analytics');
  container.innerHTML = loadingHtml();
  try {
    const d = await api(examId ? `/api/analytics?exam_id=${examId}` : '/api/analytics');
    const opts = [`<option value="" ${!examId?'selected':''}>Overall (All Exams)</option>`,
      ...(d.exams||[]).map(e => `<option value="${e.exam_id}" ${e.exam_id===d.selectedExam?'selected':''}>${esc(e.title)}</option>`)].join('');
    container.innerHTML = `
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--text3)">Exam:</label>
        <select style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;min-width:260px"
          onchange="buildAnalytics(this.value?parseInt(this.value):null)">${opts}</select>
      </div>
      ${renderStatCards(d.stats)}
      <div class="two-col">
        <div class="card"><div class="card-header"><span class="card-title">${esc(examId?'Question Difficulty':'Question Difficulty (Top 10 Hardest)')}</span></div>${renderDifficultyTable(d.difficulty)}</div>
        <div class="card"><div class="card-header"><span class="card-title">Class Ranking</span></div>${renderRankingTable(d.ranking)}</div>
      </div>`;
    animateProgressBars();
  } catch (err) { container.innerHTML = errorHtml('analytics', err.message); }
}

function buildSchema() {
  return buildPage('schema', '/api/schema', d => `
    <div style="margin-bottom:20px">
      <p style="color:var(--text3);font-size:13px">Database: <strong>ExamProctor</strong> · Engine: InnoDB · ${d.tables.length} Tables · 3NF / BCNF · <em>Live metadata from INFORMATION_SCHEMA</em></p>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Tables &amp; Row Counts</span></div>${renderSchemaTable(d.tables)}</div>
    <div class="two-col">
      <div class="card"><div class="card-header"><span class="card-title">Triggers (${d.triggers.length})</span></div><div class="card-body" style="padding:0">${renderTriggersTable(d.triggers)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">Stored Procedures (${d.procedures.length})</span></div><div class="card-body" style="padding:0">${renderProceduresTable(d.procedures)}</div></div>
    </div>`);
}

async function showStudentDetail(attemptId, btn) {
  const detailRow = document.getElementById(`detail-row-${attemptId}`);
  const detailDiv = document.getElementById(`detail-${attemptId}`);
  if (!detailRow || !detailDiv) return;
  if (detailRow.style.display !== 'none') { detailRow.style.display = 'none'; btn.textContent = 'View'; return; }
  btn.textContent = '...'; btn.disabled = true;
  const d = await api(`/api/results/${attemptId}`);
  btn.disabled = false;
  detailDiv.innerHTML = d.error ? `<p style="color:var(--red)">Failed to load detail.</p>` : renderStudentDetail(d);
  detailRow.style.display = '';
  btn.textContent = 'Hide';
}

async function showStudentOwnResult(attemptId) {
  showModal('Your Result', `<div style="text-align:center;padding:20px;color:var(--text3)">Loading…</div>`);
  try {
    const d = await api(`/api/results/${attemptId}`);
    document.getElementById('modal-body').innerHTML = d.error
      ? `<p style="color:var(--red);padding:16px">Could not load result.</p>`
      : `<h3 style="margin:0 0 16px;font-size:15px">${esc(d.exam||'')}</h3>` + renderStudentDetail(d);
  } catch (err) { document.getElementById('modal-body').innerHTML = `<p style="color:var(--red);padding:16px">${esc(err.message)}</p>`; }
}

async function showExamResults(examId, title) {
  showModal(`Results — ${title}`, `<div style="padding:20px;text-align:center;color:var(--text3)">Loading…</div>`);
  try {
    const d = await api(`/api/results?exam_id=${examId}`);
    const exam = d.exams?.[0];
    document.getElementById('modal-body').innerHTML = exam?.students.length
      ? renderResultsTable(exam.students)
      : `<div style="padding:24px;text-align:center;color:var(--text3)">No results yet for this exam.</div>`;
  } catch (err) { document.getElementById('modal-body').innerHTML = `<p style="color:var(--red);padding:16px">${esc(err.message)}</p>`; }
}

async function showExamQuestions(examId, title) {
  showModal(`Questions — ${title}`, `<div style="padding:20px;text-align:center;color:var(--text3)">Loading…</div>`);
  try {
    const d = await api('/api/questions');
    const group = d.groups.find(g => String(g.examId) === String(examId));
    if (!group?.questions.length) {
      document.getElementById('modal-body').innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3)">No questions yet.</div>`;
      return;
    }
    const rows = group.questions.map((q, i) => {
      const opts = q.type==='MCQ'
        ? q.options.map(o => `<span style="margin-right:10px;font-size:12px;${o.letter===q.answer?'color:var(--green);font-weight:700':'color:var(--text3)'}">${esc(o.letter)}. ${esc(o.text)}${o.letter===q.answer?' ✓':''}</span>`).join('')
        : `<span style="font-size:12px;color:var(--green)">Answer: ${esc(q.answer)}</span>`;
      return `<div style="background:var(--bg3);border-radius:8px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:13px"><strong>${i+1}.</strong> ${esc(q.text)}</span>
          <span style="font-size:12px;color:var(--text3);white-space:nowrap;margin-left:12px">${q.marks}m · ${esc(q.difficulty)}</span>
        </div><div>${opts}</div></div>`;
    }).join('');
    document.getElementById('modal-body').innerHTML =
      `<div style="margin-bottom:12px;font-size:12px;color:var(--text3)">${group.questions.length} questions · ${group.questions.reduce((s,q)=>s+Number(q.marks),0)} marks total</div>` + rows;
  } catch (err) { document.getElementById('modal-body').innerHTML = `<p style="color:var(--red);padding:16px">${esc(err.message)}</p>`; }
}

function buildResults() {
  return buildPage('results', '/api/results', d => {
    if (!d.exams?.length) return `<p style="color:var(--text3)">No submitted results yet.</p>`;
    const examCards = d.exams.map(ex => `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><span class="card-title">${esc(ex.title)}</span><span class="badge badge-gray">${ex.students.length} students</span></div>
        ${renderResultsTable(ex.students)}
      </div>`).join('');
    const rankingCard = d.ranking?.length ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header"><span class="card-title">Overall Class Ranking</span><span class="badge badge-purple">${d.ranking.length} students</span></div>
        ${renderClassRanking(d.ranking)}
      </div>` : '';
    return rankingCard + examCards;
  });
}

function buildExams() {
  const container = document.getElementById('page-exams');
  container.innerHTML = loadingHtml();
  api('/api/exams').then(d => {
    const total    = d.exams.length;
    const active   = d.exams.filter(e => e.isActive).length;
    const upcoming = d.exams.filter(e => e.isUpcoming).length;
    const drafts   = d.exams.filter(e => e.isDraft).length;
    const completed = d.exams.filter(e => !e.isActive && !e.isUpcoming && !e.isDraft).length;
    const isTeacher = currentUser && ['teacher','instructor','admin'].includes(currentUser.role);
    if (total === 0) {
      container.innerHTML = `
        <div style="max-width:520px;margin:80px auto 0;text-align:center">
          <div style="font-size:40px;margin-bottom:16px">▤</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">No Exams Yet</div>
          <div style="font-size:14px;color:var(--text3);margin-bottom:28px;line-height:1.7">Create your first exam, add questions, then open it to get a code for your students.</div>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-outline" onclick="showCreateCourseModal()">+ Create Course First</button>
            <button class="btn btn-primary" onclick="showCreateExamModal()">+ New Exam</button>
          </div>
        </div>`;
      return;
    }
    const statRow = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <span class="badge badge-gray">${total} exam${total!==1?'s':''}</span>
        ${drafts>0?`<span class="badge badge-gray">${drafts} draft${drafts!==1?'s':''}</span>`:''}
        ${active>0?`<span class="badge badge-green">● ${active} live now</span>`:''}
        ${upcoming>0?`<span class="badge badge-purple">${upcoming} upcoming</span>`:''}
        ${completed>0?`<span class="badge badge-gray">${completed} completed</span>`:''}
        <button class="btn btn-primary" style="margin-left:auto;font-size:13px" onclick="showCreateExamModal()">+ New Exam</button>
      </div>`;
    container.innerHTML = statRow + renderMyExamCards(d.exams, isTeacher);
  }).catch(err => { container.innerHTML = errorHtml('exams', err.message); });
}

window._questionById = {};

function buildQuestions() {
  const container = document.getElementById('page-questions');
  container.innerHTML = loadingHtml();
  Promise.all([api('/api/questions'), api('/api/exams')]).then(([qd, ed]) => {
    const total = qd.groups.reduce((sum, g) => sum + g.questions.length, 0);
    const examMeta = {};
    (ed.exams||[]).forEach(e => { examMeta[e.id] = e; });
    window._questionById = {};
    qd.groups.forEach(g => g.questions.forEach(q => { window._questionById[q.id] = q; }));
    if (qd.groups.length === 0) {
      container.innerHTML = `
        <div style="max-width:500px;margin:80px auto 0;text-align:center">
          <div style="font-size:40px;margin-bottom:16px">?</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">Question Bank is Empty</div>
          <div style="font-size:14px;color:var(--text3);margin-bottom:24px;line-height:1.7">Go to <strong>My Exams</strong>, open an exam, and click <strong>+ Question</strong> to start building.</div>
          <button class="btn btn-primary" onclick="showPage('exams')">Go to My Exams</button>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><span style="font-size:15px;font-weight:600">${total} question${total!==1?'s':''}</span><span style="font-size:13px;color:var(--text3);margin-left:8px">across ${qd.groups.length} exam${qd.groups.length!==1?'s':''}</span></div>
        <div style="font-size:12px;color:var(--text3)">Click <strong>+ Question</strong> on any exam below to add more</div>
      </div>
      ${renderBrilliantQuestionBank(qd.groups, examMeta)}`;
  }).catch(err => { container.innerHTML = errorHtml('questions', err.message); });
}

function buildCourses() {
  return buildPage('courses', '/api/courses', d => `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div style="font-size:13px;color:var(--text3)">${d.courses.length} active course${d.courses.length!==1?'s':''}</div>
      <button type="button" class="btn btn-primary" onclick="showCreateCourseModal()">+ New Course</button>
    </div>
    <div class="courses-grid">${renderCourseCards(d.courses, d.userId)}</div>`);
}

async function showCreateCourseModal() {
  let instructors;
  try { const d = await api('/api/users/instructors'); instructors = d.instructors; }
  catch (err) { alert('Could not load instructors: ' + err.message); return; }
  const isAdmin = currentUser?.roles?.includes('admin');
  const instructorField = isAdmin
    ? `<div class="form-group"><label>Instructor</label><select name="instructor_id" required>${instructors.map(i => `<option value="${i.user_id}">${esc(i.full_name)} &lt;${esc(i.email)}&gt;</option>`).join('')}</select></div>`
    : `<div class="form-group"><label>Instructor</label><input type="text" value="${esc(currentUser.full_name)}" disabled style="opacity:.7"/><input type="hidden" name="instructor_id" value="${currentUser.user_id}"/></div>`;
  showModal('Create New Course', `
    <form id="course-form" onsubmit="submitCreateCourse(event)">
      <div class="form-row">
        <div class="form-group"><label>Course Code</label><input type="text" name="course_code" required placeholder="e.g. CS401" maxlength="20"/></div>
        ${instructorField}
      </div>
      <div class="form-group"><label>Course Name</label><input type="text" name="course_name" required placeholder="e.g. Operating Systems"/></div>
      <div class="form-group"><label>Description <span style="color:var(--text3);font-weight:400">(optional)</span></label><textarea name="description" placeholder="Brief overview…"></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="course-submit-btn">Create Course</button>
      </div>
    </form>`);
  if (isAdmin && currentUser?.user_id) {
    const sel = document.querySelector('#modal-body select[name="instructor_id"]');
    if (sel) sel.value = currentUser.user_id;
  }
}

async function submitCreateCourse(e) {
  e.preventDefault();
  const btn = document.getElementById('course-submit-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await apiPost('/api/courses', { course_code: e.target.course_code.value.trim().toUpperCase(), course_name: e.target.course_name.value.trim(), description: e.target.description.value.trim()||null, instructor_id: parseInt(e.target.instructor_id.value) });
    closeModal(); buildCourses();
  } catch (err) { btn.disabled = false; btn.textContent = 'Create Course'; alert('Failed to create course: ' + err.message); }
}

async function deleteCourse(id, name) {
  if (!confirm(`Deactivate course "${name}"?\n\nThis hides the course but keeps all exam data.`)) return;
  try { await apiDelete(`/api/courses/${id}`); buildCourses(); }
  catch (err) { alert('Failed to deactivate course: ' + err.message); }
}

function showEditCourseModal(id, name, description) {
  showModal('Edit Course', `
    <form onsubmit="submitEditCourse(event, ${id})">
      <div class="form-group" style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:var(--text2)">Course Name</label><input class="form-input" name="course_name" value="${esc(name)}" required style="margin-top:6px"></div>
      <div class="form-group" style="margin-bottom:18px"><label style="font-size:12px;font-weight:600;color:var(--text2)">Description</label><textarea class="form-input" name="description" rows="3" style="margin-top:6px;resize:vertical">${esc(description||'')}</textarea></div>
      <button type="submit" class="btn btn-primary btn-full">Save Changes</button>
    </form>`);
}

async function submitEditCourse(e, id) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';
  try { await apiPatch(`/api/courses/${id}`, { course_name: e.target.course_name.value.trim(), description: e.target.description.value.trim()||null }); closeModal(); buildCourses(); }
  catch (err) { btn.disabled = false; btn.textContent = 'Save Changes'; alert('Failed: ' + err.message); }
}

function showEditExamModal(id, title, description, passingMarks, duration) {
  showModal('Edit Exam', `
    <form onsubmit="submitEditExam(event, ${id})">
      <div class="form-group" style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:var(--text2)">Title</label><input class="form-input" name="title" value="${esc(title)}" required style="margin-top:6px"></div>
      <div class="form-group" style="margin-bottom:14px"><label style="font-size:12px;font-weight:600;color:var(--text2)">Description</label><textarea class="form-input" name="description" rows="2" style="margin-top:6px;resize:vertical">${esc(description||'')}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
        <div class="form-group"><label style="font-size:12px;font-weight:600;color:var(--text2)">Passing Marks</label><input class="form-input" name="passing_marks" type="number" step="0.5" min="0" value="${esc(String(passingMarks))}" required style="margin-top:6px"></div>
        <div class="form-group"><label style="font-size:12px;font-weight:600;color:var(--text2)">Duration (min)</label><input class="form-input" name="duration_minutes" type="number" min="1" value="${esc(String(duration))}" required style="margin-top:6px"></div>
      </div>
      <button type="submit" class="btn btn-primary btn-full">Save Changes</button>
    </form>`);
}

async function submitEditExam(e, id) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';
  try { await apiPatch(`/api/exams/${id}`, { title: e.target.title.value.trim(), description: e.target.description.value.trim()||null, passing_marks: e.target.passing_marks.value, duration_minutes: e.target.duration_minutes.value }); closeModal(); buildExams(); }
  catch (err) { btn.disabled = false; btn.textContent = 'Save Changes'; alert('Failed: ' + err.message); }
}

function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }

async function showCreateExamModal() {
  let courses;
  try { const d = await api('/api/courses'); courses = d.courses; }
  catch (err) { alert('Could not load courses: ' + err.message); return; }
  const visible = courses.filter(c => !c.course_code.startsWith('ROOM'));
  const opts = visible.length
    ? visible.map(c => `<option value="${c.course_id}">${esc(c.course_code)} — ${esc(c.course_name)}</option>`).join('')
    : `<option value="" disabled>No courses yet — create one first</option>`;
  showModal('Create New Exam', `
    <form id="exam-form" onsubmit="submitCreateExam(event)">
      <div class="form-group"><label>Course</label>
        <select name="course_id" required ${!visible.length?'disabled':''}>${opts}</select>
        ${!visible.length?`<div style="margin-top:6px"><button type="button" class="btn btn-outline" style="font-size:12px" onclick="closeModal();showCreateCourseModal()">+ Create a Course first</button></div>`:''}
      </div>
      <div class="form-group"><label>Exam Title</label><input type="text" name="title" required placeholder="e.g. DBMS Mid-Term Exam"/></div>
      <div class="form-group"><label>Description <span style="color:var(--text3);font-weight:400">(optional)</span></label><textarea name="description" placeholder="Brief description…"></textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Total Marks</label><input type="number" name="total_marks" required min="1" value="50"/></div>
        <div class="form-group"><label>Passing Marks</label><input type="number" name="passing_marks" required min="1" value="25"/></div>
        <div class="form-group"><label>Duration (min)</label><input type="number" name="duration_minutes" required min="1" value="60"/></div>
      </div>
      <div class="form-row"><div class="form-group"><label>Max Attempts per student</label><input type="number" name="max_attempts" required min="1" value="1"/></div></div>
      <div class="form-checkrow">
        <label class="form-check"><input type="checkbox" name="shuffle_questions" checked/> Shuffle Questions</label>
        <label class="form-check"><input type="checkbox" name="show_results_immediately"/> Show Results Immediately</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="create-exam-btn">Create Exam</button>
      </div>
    </form>`);
}

async function submitCreateExam(e) {
  e.preventDefault();
  const form = e.target, btn = document.getElementById('create-exam-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  const toDatetime = v => v ? v.replace('T',' ') + ':00' : null;
  const data = {
    course_id: parseInt(form.course_id.value), title: form.title.value.trim(),
    description: form.description.value.trim()||null,
    total_marks: parseFloat(form.total_marks.value), passing_marks: parseFloat(form.passing_marks.value),
    duration_minutes: parseInt(form.duration_minutes.value),
    // Placeholder window — real window is set when teacher opens the exam
    window_start: toDatetime(new Date(Date.now()+365*24*60*60*1000).toISOString().slice(0,16)),
    window_end:   toDatetime(new Date(Date.now()+366*24*60*60*1000).toISOString().slice(0,16)),
    max_attempts: parseInt(form.max_attempts.value),
    shuffle_questions: form.shuffle_questions.checked,
    show_results_immediately: form.show_results_immediately.checked,
    is_published: false,
  };
  try {
    const result = await apiPost('/api/exams', data);
    closeModal(); showPage('exams'); buildExams(); buildDashboard();
    if (result.exam_id) setTimeout(() => showAddQuestionModal(result.exam_id, data.title, data.total_marks), 200);
  } catch (err) { btn.disabled = false; btn.textContent = 'Create Exam'; alert('Failed to create exam: ' + err.message); }
}

let _openExamId = null, _openExamTitle = null;

function openExam(id, title, durationMin) {
  _openExamId = parseInt(id); _openExamTitle = title;
  const defaultHrs = Math.max(1, Math.ceil((durationMin||60)/60 + 0.5));
  showModal(`Open Exam — ${title}`, `
    <div style="padding:8px 0 4px">
      <div style="font-size:13px;color:var(--text3);margin-bottom:20px;line-height:1.6;text-align:center">
        Publishing generates a <strong>join code</strong> for students.<br>Share it verbally — students enter it to start.
      </div>
      <div style="margin-bottom:18px">
        <label style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:8px">Window duration (hours)</label>
        <input id="open-hrs-input" type="number" min="0.5" max="72" step="0.5" value="${defaultHrs}"
          style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:15px">
        <div style="font-size:11px;color:var(--text3);margin-top:5px">Exam opens immediately. Students can join until the window expires or you end the session.</div>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="open-exam-btn" onclick="confirmOpenExam()">Open &amp; Get Code</button>
      </div>
    </div>`);
}


async function confirmOpenExam() {
  const id = _openExamId, title = _openExamTitle;
  const btn = document.getElementById('open-exam-btn');
  const hrs = parseFloat(document.getElementById('open-hrs-input')?.value||'2');
  if (!hrs || hrs <= 0) return alert('Enter a valid number of hours.');
  btn.disabled = true; btn.textContent = 'Opening…';
  try {
    const res  = await fetch(`/api/exams/${id}/open`, { method:'PATCH', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ duration_hours: hrs }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    closeModal();
    if (data.join_code) showCodeBanner(data.join_code, title);
    buildExams(); buildClassroom();
  } catch (err) { btn.disabled = false; btn.textContent = 'Open & Get Code'; alert('Failed to open exam: ' + err.message); }
}

function showCodeBanner(code, title) {
  showModal('Exam Open — Share This Code', `
    <div style="text-align:center;padding:16px 8px 8px">
      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">Exam <strong>${esc(title)}</strong> is now live.<br>Tell your students this code — they enter it on the Exam Session page.</div>
      <div style="font-size:64px;font-weight:900;letter-spacing:14px;color:var(--accent2);font-family:monospace;line-height:1;margin-bottom:10px;cursor:pointer"
        onclick="copyCode('${esc(code)}')" title="Click to copy">${esc(code)}</div>
      <div id="code-banner-hint" style="font-size:12px;color:var(--text3);margin-bottom:20px">Click code to copy</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn btn-outline" onclick="copyCode('${esc(code)}');document.getElementById('code-banner-hint').textContent='Copied!'">Copy Code</button>
        <button class="btn btn-primary" onclick="closeModal();showPage('classroom')">View Live Session</button>
      </div>
    </div>`);
}

async function closeExam(id, title) {
  if (!confirm(`End exam "${title}" now?\n\nNo new attempts will be allowed.`)) return;
  try {
    const res = await fetch(`/api/exams/${id}/close`, { method:'PATCH', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({}) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buildExams(); buildStudentView();
  } catch (err) { alert('Failed to close exam: ' + err.message); }
}

async function deleteExam(id, title) {
  if (!confirm(`Delete exam "${title}"?\n\nThis removes all questions, attempts, and logs.`)) return;
  try { await apiDelete(`/api/exams/${id}`); buildExams(); buildDashboard(); buildQuestions(); }
  catch (err) { alert('Failed to delete exam: ' + err.message); }
}

const MCQ_LABELS = ['A','B','C','D','E','F','G','H','I','J'];
let _addQExamTotalMarks = null, _addQExamId = null;

function showAddQuestionModal(examId, examTitle, examTotalMarks) {
  _addQExamId = examId; _addQExamTotalMarks = examTotalMarks ?? null;
  showModal(`Add Question — ${examTitle}`, `
    <div id="question-form">
      <input type="hidden" id="q-exam-id" value="${examId}"/>
      <div class="form-group"><label>Question Text</label><textarea id="q-text" rows="3" placeholder="Enter the question…"></textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="q-type" onchange="toggleMcqOptions(this.value)"><option value="MCQ">MCQ</option><option value="TRUE_FALSE">True / False</option><option value="SHORT_ANSWER">Short Answer</option></select></div>
        <div class="form-group"><label>Marks</label><input id="q-marks" type="number" min="0.5" step="0.5" value="5"/></div>
        <div class="form-group"><label>Difficulty</label><select id="q-difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>
        <div class="form-group"><label>Order #</label><input id="q-order" type="number" value="0" min="0"/></div>
      </div>
      <div id="mcq-options-block">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px">Options <span style="font-weight:400;text-transform:none">(select correct answer)</span></label>
          <button type="button" class="btn btn-outline" style="padding:4px 12px;font-size:12px" onclick="addMcqOption()" id="add-option-btn">+ Add Option</button>
        </div>
        <div id="mcq-options-list"></div>
      </div>
      <div id="tf-block" style="display:none" class="form-group"><label>Correct Answer</label><select id="q-tf-answer"><option value="TRUE">True</option><option value="FALSE">False</option></select></div>
      <div id="sa-block" style="display:none" class="form-group"><label>Answer Key</label><input id="q-sa-answer" type="text" placeholder="Expected answer (shown to teacher)"/></div>
      <div id="q-add-status"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="question-submit-btn" onclick="submitAddQuestion()">Add Question</button>
      </div>
    </div>`);
  renderMcqOptions(2); toggleMcqOptions('MCQ');
}

function renderMcqOptions(count) {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const label = MCQ_LABELS[i], row = document.createElement('div');
    row.className = 'mcq-option-row'; row.dataset.idx = i;
    row.innerHTML = `
      <label class="mcq-radio-label" title="Mark as correct"><input type="radio" name="mcq_correct" value="${label}"/></label>
      <span class="mcq-option-letter">${label}</span>
      <input type="text" class="mcq-option-input" name="option_${label.toLowerCase()}" placeholder="Option ${label}"/>
      ${i>=2?`<button type="button" class="mcq-remove-btn" onclick="removeMcqOption(${i})" title="Remove">✕</button>`:'<span style="width:24px"></span>'}`;
    list.appendChild(row);
  }
  const addBtn = document.getElementById('add-option-btn');
  if (addBtn) addBtn.style.display = count >= 10 ? 'none' : '';
}

function addMcqOption() {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  const rows = list.querySelectorAll('.mcq-option-row');
  if (rows.length >= 10) return;
  const vals = Array.from(rows).map(r => r.querySelector('input[type=text]').value);
  const wasCorrect = list.querySelector('input[type=radio]:checked')?.value;
  renderMcqOptions(rows.length + 1);
  list.querySelectorAll('.mcq-option-row').forEach((r, i) => {
    if (i < vals.length) r.querySelector('input[type=text]').value = vals[i];
    const radio = r.querySelector('input[type=radio]');
    if (radio?.value === wasCorrect) radio.checked = true;
  });
}

function removeMcqOption(idx) {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  const rows = list.querySelectorAll('.mcq-option-row');
  if (rows.length <= 2) return;
  const vals = Array.from(rows).map(r => r.querySelector('input[type=text]').value);
  const wasCorrect = list.querySelector('input[type=radio]:checked')?.value;
  vals.splice(idx, 1);
  renderMcqOptions(vals.length);
  list.querySelectorAll('.mcq-option-row').forEach((r, i) => {
    r.querySelector('input[type=text]').value = vals[i] || '';
    const radio = r.querySelector('input[type=radio]');
    if (radio?.value === wasCorrect) radio.checked = true;
  });
}

function toggleMcqOptions(type) {
  document.getElementById('mcq-options-block').style.display = type==='MCQ' ? '' : 'none';
  document.getElementById('tf-block').style.display          = type==='TRUE_FALSE' ? '' : 'none';
  document.getElementById('sa-block').style.display          = type==='SHORT_ANSWER' ? '' : 'none';
}

async function submitAddQuestion() {
  const btn = document.getElementById('question-submit-btn');
  btn.disabled = true; btn.textContent = 'Adding…';
  const examId = parseInt(document.getElementById('q-exam-id').value);
  const questionText = document.getElementById('q-text').value.trim();
  const type = document.getElementById('q-type').value;
  const marks = parseFloat(document.getElementById('q-marks').value);
  const difficulty = document.getElementById('q-difficulty').value;
  const orderIndex = parseInt(document.getElementById('q-order').value)||0;
  if (!questionText) { btn.disabled=false; btn.textContent='Add Question'; return alert('Please enter the question text.'); }
  if (!marks||marks<=0) { btn.disabled=false; btn.textContent='Add Question'; return alert('Please enter a valid mark value (> 0).'); }

  // If adding this question exceeds declared total, offer to increase the total
  let shouldUpdateTotal = false, newTotal = null;
  try {
    const examData = await api('/api/exams');
    const thisExam = examData.exams.find(ex => ex.id === examId);
    if (thisExam) {
      const declared = parseFloat(thisExam.totalMarks)||0, soFar = parseFloat(thisExam.questionsTotalMarks)||0;
      if (declared > 0 && soFar + marks > declared + 0.001) {
        btn.disabled = false; btn.textContent = 'Add Question';
        newTotal = +(soFar + marks).toFixed(2);
        const ok = confirm(`Adding ${marks} mark(s) would bring questions to ${newTotal} but the exam total is ${declared}.\n\nIncrease exam total to ${newTotal}?`);
        if (!ok) return;
        shouldUpdateTotal = true;
        btn.disabled = true; btn.textContent = 'Adding…';
      }
    }
  } catch {} // non-fatal

  const data = { exam_id: examId, question_text: questionText, question_type: type, marks, difficulty_level: difficulty, order_index: orderIndex };
  let correct_answer = '';
  if (type==='MCQ') {
    const correctRadio = document.querySelector('#mcq-options-list input[name=mcq_correct]:checked');
    if (!correctRadio) { btn.disabled=false; btn.textContent='Add Question'; return alert('Please select the correct answer option.'); }
    correct_answer = correctRadio.value;
    MCQ_LABELS.forEach(lbl => { data[`option_${lbl.toLowerCase()}`] = document.querySelector(`#mcq-options-list input[name=option_${lbl.toLowerCase()}]`)?.value.trim()||null; });
  } else if (type==='TRUE_FALSE') {
    correct_answer = document.getElementById('q-tf-answer').value;
  } else {
    correct_answer = document.getElementById('q-sa-answer')?.value.trim()||'';
  }
  data.correct_answer = correct_answer || null;

  try {
    if (shouldUpdateTotal && newTotal) {
      await fetch(`/api/exams/${examId}`, { method:'PATCH', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ total_marks: newTotal }) });
    }
    await apiPost('/api/questions', data);
    buildQuestions(); buildExams();
    const examData = await api('/api/exams');
    const thisExam = examData.exams.find(ex => ex.id === examId);
    const qTotal = thisExam?.questionsTotalMarks ?? '?', declared = thisExam?.totalMarks ?? _addQExamTotalMarks ?? '?', qCount = thisExam?.questions ?? '?';
    const match = typeof qTotal==='number' && typeof declared==='number' && Math.abs(qTotal-declared)<=0.01;
    if (match) { closeModal(); return; }
    document.getElementById('q-text').value=''; document.getElementById('q-type').value='MCQ';
    document.getElementById('q-marks').value='5'; document.getElementById('q-order').value='0';
    renderMcqOptions(2); toggleMcqOptions('MCQ');
    const statusBar = document.getElementById('q-add-status');
    if (statusBar) statusBar.innerHTML = `<div style="background:var(--bg3);border:1px solid var(--orange);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--orange);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span>${qCount} question${qCount!==1?'s':''} · ${qTotal}/${declared} marks — keep adding until total matches.</span>
      <button type="button" class="btn btn-outline" style="font-size:11px;padding:4px 12px;white-space:nowrap" onclick="closeModal()">Done for now</button>
    </div>`;
    btn.disabled=false; btn.textContent='Add Question';
  } catch (err) { btn.disabled=false; btn.textContent='Add Question'; alert('Failed to add question: ' + err.message); }
}

async function deleteQuestion(id) {
  if (!confirm('Delete this question? All student answers for it will also be removed.')) return;
  try { await apiDelete(`/api/questions/${id}`); buildQuestions(); buildExams(); }
  catch (err) { alert('Failed to delete question: ' + err.message); }
}

async function warnStudent(attemptId, studentName) {
  const severity = prompt(`Severity for warning to ${studentName}:\nLOW / MEDIUM / HIGH / CRITICAL`, 'HIGH');
  if (!severity) return;
  const sev = severity.trim().toUpperCase();
  if (!['LOW','MEDIUM','HIGH','CRITICAL'].includes(sev)) { alert('Invalid severity.'); return; }
  const message = prompt(`Warning message to ${studentName}:`, 'Suspicious behaviour detected. Please focus on your exam only.');
  if (!message) return;
  try { await apiPost('/api/proctor/warn', { attempt_id: attemptId, severity: sev, message }); alert(`Warning sent to ${studentName}.`); }
  catch (err) { alert('Failed to send warning: ' + err.message); }
}

async function kickStudent(attemptId, studentName) {
  if (!confirm(`Remove ${studentName} from the exam?\nThis will end their attempt immediately.`)) return;
  const reason = prompt('Reason for removal (shown in logs):', 'Removed by proctor due to critical violations.');
  if (reason === null) return;
  try { await apiPost(`/api/proctor/kick/${attemptId}`, { reason }); alert(`${studentName} has been removed from the exam.`); buildFlagged(); buildDashboard(); }
  catch (err) { alert('Failed to remove student: ' + err.message); }
}

async function resolveFlag(flagId) {
  const notes = prompt('Resolution notes (press Cancel to abort):', 'Reviewed by admin. No action required.');
  if (notes === null) return;
  try { await apiPost(`/api/flags/${flagId}/resolve`, { notes }); buildFlagged(); buildDashboard(); }
  catch (err) { alert('Failed to resolve flag: ' + err.message); }
}

let examState = null;  // { attempt_id, exam, questions, answers, timerInterval, started_at }

async function startExam(examId, examTitle) {
  if (!currentUser) { alert('Please log in first.'); return; }
  if (!confirm(`Start "${examTitle}"?\n\nThe timer begins immediately.`)) return;
  try {
    const data = await apiPost(`/api/exams/${examId}/start`, {});
    examState = { attempt_id: data.attempt_id, exam: data.exam, questions: data.questions, answers: {}, timerInterval: null, started_at: data.started_at||null };
    currentAttemptId = data.attempt_id;
    renderExamOverlay(); startExamTimer(); startWarningPolling();
    document.documentElement.requestFullscreen().catch(() => {});
  } catch (err) { alert('Could not start exam: ' + err.message); }
}

function renderExamOverlay() {
  const { exam, questions } = examState;
  document.getElementById('exam-overlay-title').textContent = exam.title;
  document.getElementById('exam-body').innerHTML = renderExamQuestions(questions);
  document.getElementById('exam-overlay').classList.add('active');
  updateAnsweredBadge();
}

function startExamTimer() {
  const totalSec = examState.exam.duration_minutes * 60;
  const elapsedSec = examState.started_at ? Math.floor((Date.now()-new Date(examState.started_at).getTime())/1000) : 0;
  let remaining = Math.max(0, totalSec - elapsedSec);
  const timerEl = document.getElementById('exam-timer'), progressEl = document.getElementById('exam-progress-fill');
  function tick() {
    timerEl.textContent = `${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
    progressEl.style.width = Math.round(((totalSec-remaining)/totalSec)*100) + '%';
    timerEl.classList.remove('warning','danger');
    if (remaining<=60) timerEl.classList.add('danger');
    else if (remaining<=300) timerEl.classList.add('warning');
    if (remaining<=0) { clearInterval(examState.timerInterval); submitExam(true); }
    else remaining--;
  }
  tick();
  examState.timerInterval = setInterval(tick, 1000);
}

async function saveAnswer(questionId, selectedOption) {
  if (!examState) return;
  const startTs = examState.answers[questionId]?.ts || Date.now();
  examState.answers[questionId] = { selected: selectedOption, ts: Date.now() };
  updateAnsweredBadge();
  const card = document.querySelector(`.exam-question-card[data-qid="${questionId}"]`);
  if (card) { card.classList.add('answered'); const n = card.querySelector('.exam-q-num'); if (n) n.textContent = 'ok'; }
  try { await apiPost(`/api/attempts/${examState.attempt_id}/answer`, { question_id: questionId, selected_option: selectedOption, time_taken_seconds: Math.round((Date.now()-startTs)/1000) }); }
  catch {} // stored locally; let the server catch it on submit
  const total = examState.questions.length, answered = Object.keys(examState.answers).length;
  if (answered >= total && total > 0 && confirm('You have answered all questions. Submit now?')) submitExam(false);
}

function updateAnsweredBadge() {
  if (!examState) return;
  document.getElementById('exam-answered-badge').textContent = `${Object.keys(examState.answers).length} / ${examState.questions.length} answered`;
}

async function submitExam(autoSubmit = false) {
  if (!examState) return;
  if (!autoSubmit) {
    const unanswered = examState.questions.length - Object.keys(examState.answers).length;
    if (unanswered > 0 && !confirm(`You have ${unanswered} unanswered question${unanswered>1?'s':''}. Submit anyway?`)) return;
  }
  const btn = document.getElementById('exam-submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  if (examState.timerInterval) clearInterval(examState.timerInterval);
  try {
    const result = await apiPost(`/api/attempts/${examState.attempt_id}/submit`, {});
    currentAttemptId = null; examState = null;
    stopWarningPolling();
    document.getElementById('exam-overlay').classList.remove('active');
    document.getElementById('exam-warning-banner').classList.remove('visible');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showExamResult(result);
  } catch (err) { btn.disabled=false; btn.textContent='Submit Exam'; alert('Submission failed: ' + err.message); startExamTimer(); }
}

function showExamResult(result) {
  const passed = result.passed, color = passed ? 'var(--green)' : 'var(--red)';
  document.getElementById('result-box').innerHTML = `
    <div class="result-icon" style="color:${color}">${passed?'PASS':'FAIL'}</div>
    <div class="result-score" style="color:${color}">${result.score} / ${result.total_marks}</div>
    <div class="result-pct">${result.percentage}% · ${passed?'PASS':'FAIL'}</div>
    <div class="result-grid">
      <div class="result-item"><div class="result-item-label">Your Score</div><div class="result-item-value" style="color:${color}">${result.score}</div></div>
      <div class="result-item"><div class="result-item-label">Pass Mark</div><div class="result-item-value">${result.passing_marks}</div></div>
      <div class="result-item"><div class="result-item-label">Total Marks</div><div class="result-item-value">${result.total_marks}</div></div>
      <div class="result-item"><div class="result-item-label">Percentage</div><div class="result-item-value">${result.percentage}%</div></div>
    </div>
    <button type="button" class="btn btn-primary" style="width:100%" onclick="closeExamResult()">Back to Dashboard</button>`;
  document.getElementById('result-overlay').classList.add('active');
}

function closeExamResult() {
  document.getElementById('result-overlay').classList.remove('active');
  showPage(defaultPage());
  buildClassroom();
  if (canAccess('dashboard'))    buildDashboard();
  if (canAccess('student-view')) buildStudentView();
  if (canAccess('results'))      buildResults();
}

let currentAttemptId = null;

async function logProctoringEvent(eventType, severity, details) {
  if (!currentAttemptId) return;
  try { await apiPost('/api/proctor-event', { attempt_id: currentAttemptId, event_type: eventType, severity, details }); }
  catch {} // never disrupt the exam
}

document.addEventListener('visibilitychange', () => { if (document.hidden) logProctoringEvent('TAB_SWITCH', 'MEDIUM', 'Tab hidden or window switched'); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) logProctoringEvent('FULLSCREEN_EXIT', 'LOW', 'Exited fullscreen during exam'); });
document.addEventListener('paste', () => { logProctoringEvent('COPY_PASTE_DETECTED', 'HIGH', 'Paste event detected in exam window'); });
document.addEventListener('contextmenu', e => { if (currentAttemptId) { e.preventDefault(); logProctoringEvent('RIGHT_CLICK_ATTEMPT', 'LOW', 'Right-click blocked during exam'); } });

// DevTools detection via window size delta
(function detectDevTools() {
  let open = false;
  setInterval(() => {
    const isOpen = window.outerWidth-window.innerWidth > 160 || window.outerHeight-window.innerHeight > 160;
    if (isOpen && !open) { open = true; logProctoringEvent('DEVTOOLS_OPENED', 'HIGH', 'Browser DevTools detected open during exam'); }
    else if (!isOpen) open = false;
  }, 1500);
})();

let _warningSince = new Date().toISOString(), _warningInterval = null;

function startWarningPolling() {
  _warningSince = new Date().toISOString();
  _warningInterval = setInterval(async () => {
    if (!currentAttemptId) { stopWarningPolling(); return; }
    try {
      const data = await (await fetch(`/api/attempts/${currentAttemptId}/warnings?since=${encodeURIComponent(_warningSince)}`)).json();
      if (data.kicked) {
        stopWarningPolling();
        if (examState?.timerInterval) clearInterval(examState.timerInterval);
        examState = currentAttemptId = null;
        document.getElementById('exam-overlay').classList.remove('active');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        alert('You have been removed from this exam by a proctor.');
        showPage(defaultPage()); buildClassroom(); return;
      }
      if (data.warnings?.length) {
        const latest = data.warnings[data.warnings.length-1];
        const sev = { LOW:'Low', MEDIUM:'Medium', HIGH:'HIGH', CRITICAL:'CRITICAL' }[latest.severity] || latest.severity;
        document.getElementById('exam-warning-text').textContent = `[${sev}] ${latest.message}`;
        document.getElementById('exam-warning-banner').classList.add('visible');
        _warningSince = new Date(latest.logged_at).toISOString();
      }
    } catch {} // poll silently
  }, 8000);
}

function stopWarningPolling() { if (_warningInterval) { clearInterval(_warningInterval); _warningInterval = null; } }

function animateProgressBars() {
  document.querySelectorAll('.progress-fill').forEach(bar => { const w = bar.style.width; bar.style.width='0'; setTimeout(() => { bar.style.width=w; }, 50); });
}

function updateClock() {
  const el = document.querySelector('.topbar-actions span');
  if (el) el.textContent = `● DB Connected · ExamProctor · ${new Date().toLocaleTimeString('en-IN', { hour12:false })}`;
}

function showEditQuestionModal(qId) {
  const q = window._questionById?.[qId];
  if (!q) { alert('Question data not found. Please refresh the page.'); return; }
  const optMap = {};
  (q.options||[]).forEach(o => { optMap[o.letter.toUpperCase()] = o.text||''; });
  const optionFields = ['A','B','C','D','E','F','G','H','I','J'].map(l => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="width:16px;font-weight:600;color:var(--text3)">${l}</span>
      <input id="eq-opt-${l.toLowerCase()}" type="text" class="form-input" style="flex:1;font-size:13px" value="${esc(optMap[l]||'')}" placeholder="Option ${l} (leave blank to remove)">
    </div>`).join('');
  showModal('Edit Question', `
    <form onsubmit="event.preventDefault();submitEditQuestion(${qId})">
      <div class="form-group"><label class="form-label">Question Text</label><textarea id="eq-text" class="form-input" rows="3" style="resize:vertical">${esc(q.text||'')}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div class="form-group" style="margin:0"><label class="form-label">Type</label>
          <select id="eq-type" class="form-input">
            <option value="MCQ" ${q.type==='MCQ'?'selected':''}>MCQ</option>
            <option value="TRUE_FALSE" ${q.type==='TRUE_FALSE'?'selected':''}>True/False</option>
            <option value="SHORT_ANSWER" ${q.type==='SHORT_ANSWER'?'selected':''}>Short Answer</option>
          </select>
        </div>
        <div class="form-group" style="margin:0"><label class="form-label">Marks</label><input id="eq-marks" type="number" step="0.5" min="0.5" class="form-input" value="${q.marks}"></div>
      </div>
      <div class="form-group"><label class="form-label">Correct Answer <span style="color:var(--text3);font-size:11px">(A–J for MCQ, TRUE/FALSE)</span></label><input id="eq-answer" type="text" class="form-input" value="${esc(q.answer||'')}" placeholder="e.g. B or TRUE"></div>
      <div class="form-group"><label class="form-label">Options</label>${optionFields}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button type="submit" class="btn btn-primary" style="flex:1">Save Changes</button>
        <button type="button" class="btn btn-outline" style="flex:0 0 auto" onclick="closeModal()">Cancel</button>
      </div>
    </form>`);
}

async function submitEditQuestion(qId) {
  const body = { question_text: document.getElementById('eq-text').value.trim(), question_type: document.getElementById('eq-type').value, marks: parseFloat(document.getElementById('eq-marks').value), correct_answer: document.getElementById('eq-answer').value.trim().toUpperCase()||null };
  ['a','b','c','d','e','f','g','h','i','j'].forEach(l => { body[`option_${l}`] = document.getElementById(`eq-opt-${l}`)?.value.trim()||null; });
  try {
    const result = await apiPut(`/api/questions/${qId}`, body);
    closeModal();
    if (result.reGraded) alert('Question saved. Existing answers have been re-graded automatically.');
    buildQuestions();
  } catch (err) { alert('Failed to save question: ' + err.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  showPage('dashboard');
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target===e.currentTarget) closeModal(); });
  if (restoreSession()) { onLoginSuccess(); }
  else { document.getElementById('login-overlay').classList.add('active'); }
  setInterval(updateClock, 1000);
  updateClock();
});

function bootstrapPages() {
  buildClassroom();
  if (canAccess('dashboard'))    buildDashboard();
  if (canAccess('courses'))      buildCourses();
  if (canAccess('exams'))        buildExams();
  if (canAccess('questions'))    buildQuestions();
  if (canAccess('flagged'))      buildFlagged();
  if (canAccess('logs'))         buildLogs();
  if (canAccess('student-view')) buildStudentView();
  if (canAccess('analytics'))    buildAnalytics();
  if (canAccess('schema'))       buildSchema();
  if (canAccess('results'))      buildResults();
}
