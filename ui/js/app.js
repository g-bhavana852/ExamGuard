// ─────────────────────────────────────────────────────────────
//  APP.JS  —  Navigation, page assembly, clock.
//  All content is fetched from the Express API (server/server.js).
//  Render functions live in components.js.
// ─────────────────────────────────────────────────────────────

// ── Current user state ────────────────────────────────────────
let currentUser  = null;   // { user_id, full_name, email, username, role, roles[] }
let sessionToken = null;   // LoginSessions.session_token

// Persist session across page reloads
function saveSession()  {
  localStorage.setItem('eg_token', sessionToken || '');
  localStorage.setItem('eg_user',  currentUser ? JSON.stringify(currentUser) : '');
}
function clearSession() {
  localStorage.removeItem('eg_token');
  localStorage.removeItem('eg_user');
}
function restoreSession() {
  const tok = localStorage.getItem('eg_token');
  const usr = localStorage.getItem('eg_user');
  if (tok && usr) {
    try {
      sessionToken = tok;
      currentUser  = JSON.parse(usr);
      return true;
    } catch { /* corrupt storage — ignore */ }
  }
  return false;
}

// ── Page metadata ─────────────────────────────────────────────
const PAGE_TITLES = {
  classroom:      'Exam Session',
  dashboard:      'Dashboard',
  monitor:        'Live Monitor',
  courses:        'Courses',
  exams:          'My Exams',
  questions:      'Question Bank',
  'student-view': 'My Results',
  flagged:        'Flagged Attempts',
  logs:           'Proctor Logs',
  analytics:      'Analytics',
  schema:         'DB Schema',
  results:        'Exam Results',
};

// Which roles can see each page. Admin always sees everything.
const PAGE_ROLES = {
  classroom:      ['admin', 'proctor', 'instructor', 'teacher', 'student'],
  dashboard:      ['admin', 'proctor', 'instructor', 'teacher'],
  monitor:        ['admin', 'proctor', 'instructor', 'teacher'],
  courses:        ['admin', 'instructor', 'teacher'],
  exams:          ['admin', 'instructor', 'teacher'],
  questions:      ['admin', 'instructor', 'teacher'],
  'student-view': ['student'],
  flagged:        ['admin', 'proctor', 'instructor', 'teacher'],
  logs:           ['admin', 'proctor', 'instructor', 'teacher'],
  analytics:      ['admin', 'instructor', 'teacher'],
  schema:         ['admin'],
  results:        ['admin', 'instructor', 'teacher', 'student'],
};

// Nav items — teacher gets a focused set; student gets a minimal set; admin gets everything
const ALL_NAV = [
  // Teacher / Admin core flow
  { section: 'Exams',    id: 'classroom',    icon: '▣', label: 'Exam Session',    roles: ['teacher','instructor','proctor','admin'] },
  { section: 'Exams',    id: 'exams',        icon: '▤', label: 'My Exams',        roles: ['teacher','instructor','admin'] },
  { section: 'Exams',    id: 'questions',    icon: '?', label: 'Question Bank',   roles: ['teacher','instructor','admin'] },
  { section: 'Exams',    id: 'results',      icon: '★', label: 'Results',         roles: ['teacher','instructor','admin'] },
  // Student flow
  { section: 'Exams',    id: 'classroom',    icon: '▣', label: 'Exam Session',    roles: ['student'] },
  { section: 'My',       id: 'student-view', icon: '★', label: 'My Results',      roles: ['student'] },
  // Admin extras
  { section: 'Review',   id: 'flagged',      icon: '⚑', label: 'Flagged',         roles: ['admin','teacher','instructor','proctor'] },
  { section: 'Review',   id: 'logs',         icon: '≡', label: 'Proctor Logs',    roles: ['admin','teacher','instructor','proctor'] },
  { section: 'Review',   id: 'analytics',    icon: '≈', label: 'Analytics',       roles: ['admin','teacher','instructor'] },
  { section: 'System',   id: 'dashboard',    icon: '◈', label: 'Dashboard',       roles: ['admin'] },
  { section: 'System',   id: 'monitor',      icon: '◉', label: 'Live Monitor',    roles: ['admin'] },
  { section: 'System',   id: 'courses',      icon: '◧', label: 'Courses',         roles: ['admin'] },
  { section: 'System',   id: 'schema',       icon: '⊞', label: 'DB Schema',       roles: ['admin'] },
];

// ── Role helpers ──────────────────────────────────────────────
function hasRole(r)        { return !!currentUser?.roles?.includes(r); }
function canAccess(pageId) { return !!(currentUser?.roles?.some(r => PAGE_ROLES[pageId]?.includes(r))); }

// First accessible page for the logged-in user (used for logo click / default route)
function defaultPage() {
  if (!currentUser) return 'classroom';
  const r = currentUser.role;
  if (r === 'student') return 'classroom';
  if (r === 'teacher' || r === 'instructor') return 'exams';
  return 'exams'; // admin/proctor → exams
}

// Build NAV_SECTIONS filtered to what the current user can see.
// Nav items with a `roles` field are only shown if the user has that role.
// Deduplicates page IDs so the same page isn't listed twice.
function buildNavSections() {
  const seen = new Set();
  const visible = ALL_NAV.filter(item => {
    if (seen.has(item.id)) return false;
    const allowed = item.roles
      ? (currentUser?.roles || []).some(r => item.roles.includes(r))
      : canAccess(item.id);
    if (allowed) seen.add(item.id);
    return allowed;
  });
  const sections = [];
  for (const item of visible) {
    let sec = sections.find(s => s.section === item.section);
    if (!sec) { sec = { section: item.section, items: [] }; sections.push(sec); }
    sec.items.push(item);
  }
  return sections;
}

// ── Navigation ────────────────────────────────────────────────
let _currentPage = null;

function showPage(id) {
  // Close SSE when leaving the monitor page
  if (id !== 'monitor' && _monitorSSE) { _monitorSSE.close(); _monitorSSE = null; }

  _currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    if ((n.getAttribute('onclick') || '').includes("'" + id + "'"))
      n.classList.add('active');
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;

  // Re-open SSE when navigating TO monitor
  if (id === 'monitor') buildMonitor();
}

// Refresh the current page (re-fetches data from the server)
function refreshPage() {
  if (!_currentPage || _currentPage === 'monitor') return; // monitor auto-refreshes via SSE
  const builders = {
    classroom: buildClassroom,
    dashboard: buildDashboard, courses: buildCourses, exams: buildExams,
    questions: buildQuestions, flagged: buildFlagged, logs: buildLogs,
    'student-view': buildStudentView, analytics: buildAnalytics,
    schema: buildSchema, results: buildResults,
  };
  builders[_currentPage]?.();
}

// ── API helpers ───────────────────────────────────────────────
function authHeaders(extra = {}) {
  const h = { ...extra };
  if (sessionToken) h['x-session-token'] = sessionToken;
  return h;
}

// If any authenticated request gets 401, the stored token is stale (DB reset,
// session expired, etc.). Clear it and return to the login screen immediately.
function handle401() {
  clearSession();
  currentUser      = null;
  sessionToken     = null;
  currentAttemptId = null;
  if (examState?.timerInterval) clearInterval(examState.timerInterval);
  examState = null;
  stopWarningPolling();
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
  document.getElementById('login-error').textContent = '';
  switchAuthTab('login');
  document.getElementById('login-overlay').classList.add('active');
}

async function api(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (res.status === 401) { handle401(); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (res.status === 401) { handle401(); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error(await apiErrMsg(res));
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) { handle401(); throw new Error('Session expired — please sign in again'); }
  if (!res.ok) throw new Error(await apiErrMsg(res));
  return res.json();
}

// ── Password show/hide toggle ─────────────────────────────────
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`
    : `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
       </svg>`;
}

// ── Auth tab toggle ───────────────────────────────────────────
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('signup-form').classList.toggle('hidden', isLogin);
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);
  document.getElementById('login-error').textContent  = '';
  document.getElementById('signup-error').textContent = '';
}

// onRoleChange kept for backward compat but no longer needed
function onRoleChange(_radio) {}

// ── Login / Logout ────────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  const form  = e.target;
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';

  try {
    const data = await apiPost('/api/login', {
      identifier: form.identifier.value.trim(),
      password:   form.password.value,
    });
    currentUser  = {
      user_id:   data.user_id,
      full_name: data.full_name,
      email:     data.email,
      username:  data.username,
      role:      data.role,
      roles:     data.roles,   // array — may include extra roles
    };
    sessionToken = data.token;
    saveSession();
    onLoginSuccess();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

async function doSignup(e) {
  e.preventDefault();
  const form  = e.target;
  const btn   = document.getElementById('signup-btn');
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Creating…';

  const primaryRole = form.role.value;
  const roles = [primaryRole];

  try {
    await apiPost('/api/signup', {
      full_name: form.full_name.value.trim(),
      username:  form.username.value.trim(),
      password:  form.password.value,
      roles,
    });
    // Auto-login after signup
    const data = await apiPost('/api/login', {
      identifier: form.username.value.trim(),
      password:   form.password.value,
    });
    currentUser  = {
      user_id:   data.user_id,
      full_name: data.full_name,
      email:     data.email,
      username:  data.username,
      role:      data.role,
      roles:     data.roles,
    };
    sessionToken = data.token;
    saveSession();
    onLoginSuccess();
  } catch (err) {
    // handle401() may have cleared the UI — only show error if still on signup screen
    if (document.getElementById('signup-error')) {
      errEl.textContent = err.message;
    }
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

async function doLogout() {
  if (sessionToken) {
    apiPost('/api/logout', { token: sessionToken }).catch(() => {});
  }
  // Clear any in-progress exam state so the next user doesn't see stale data
  if (examState?.timerInterval) clearInterval(examState.timerInterval);
  examState        = null;
  currentUser      = null;
  sessionToken     = null;
  currentAttemptId = null;
  clearSession();
  stopWarningPolling();

  // Reset login form — clear fields, re-enable button, switch to Sign In tab
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.reset();
  const signupForm = document.getElementById('signup-form');
  if (signupForm) signupForm.reset();
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
  const signupBtn = document.getElementById('signup-btn');
  if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = 'Create Account'; }
  document.getElementById('login-error').textContent  = '';
  document.getElementById('signup-error').textContent = '';
  switchAuthTab('login');

  document.getElementById('login-overlay').classList.add('active');
}

// Called after both login and signup succeed
function onLoginSuccess() {
  document.getElementById('login-overlay').classList.remove('active');
  document.querySelector('.nav').innerHTML = renderNav(buildNavSections());
  updateUserCard();
  updateTopbar();
  bootstrapPages();
  showPage(defaultPage());
}

function updateUserCard() {
  if (!currentUser) return;
  const initials   = currentUser.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const badgeHtml  = (currentUser.roles || [currentUser.role]).map(r =>
    `<span class="role-badge role-badge-${r}">${r}</span>`
  ).join('');
  document.querySelector('.sidebar-footer').innerHTML = `
    <div class="user-card">
      <div class="avatar">${initials}</div>
      <div class="user-info">
        <div class="name">${esc(currentUser.full_name)}</div>
        <div class="role-badges">${badgeHtml}</div>
      </div>
    </div>
    <button type="button" class="btn btn-outline btn-full" onclick="doLogout()">Sign Out</button>
  `;
}

// Topbar buttons vary by role
function updateTopbar() {
  if (!currentUser) return;
  let btns = '';
  if (hasRole('instructor') || hasRole('teacher') || hasRole('admin')) {
    btns += `<button type="button" class="btn btn-primary" onclick="showCreateExamModal()">+ New Exam</button>`;
  }
  if (hasRole('admin')) {
    btns += `<button type="button" class="btn btn-outline" onclick="showCreateCourseModal()">+ Course</button>`;
    btns += `<button type="button" class="btn btn-outline" onclick="window.location='/api/export'">Export</button>`;
  }
  document.getElementById('topbar-actions').innerHTML =
    `<button type="button" id="topbar-refresh-btn" class="btn btn-outline btn-refresh" onclick="refreshPage()" title="Refresh">Refresh</button>
     <span class="topbar-status" id="topbar-status">● ExamGuard</span>${btns}`;
}

// Parse error body safely — server may occasionally return HTML (e.g. Express
// default error page) instead of JSON, so never call res.json() blindly.
async function apiErrMsg(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.error || json.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function loadingHtml() {
  return `<div class="card"><div class="card-body" style="padding:32px;text-align:center;color:var(--text3)">⏳ Loading from database…</div></div>`;
}

function errorHtml(endpoint, msg) {
  return `
    <div class="card">
      <div class="card-body" style="padding:24px">
        <p style="color:var(--red);font-weight:600">Failed to load ${endpoint}</p>
        <p style="color:var(--text3);font-size:13px;margin-top:8px">${esc(msg)}</p>
        <p style="color:var(--text3);font-size:12px;margin-top:12px">
          Make sure the server is running:<br>
          <code style="background:var(--bg3);padding:4px 8px;border-radius:4px">cd server &amp;&amp; npm install &amp;&amp; node server.js</code>
        </p>
      </div>
    </div>`;
}

// ── Generic page builder — removes boilerplate from every build fn ──
async function buildPage(id, endpoint, render, animate = false) {
  const el = document.getElementById('page-' + id);
  el.innerHTML = loadingHtml();
  try {
    el.innerHTML = render(await api(endpoint));
    if (animate) animateProgressBars();
  } catch (err) {
    el.innerHTML = errorHtml(endpoint.replace('/api/', ''), err.message);
  }
}

// ── Page builders ──────────────────────────────────────────────
function buildDashboard() {
  return buildPage('dashboard', '/api/dashboard', d => `
    ${renderStatCards(d.stats)}
    <div class="two-col">
      <div><div class="card">
        <div class="card-header">
          <span class="card-title">Active Alerts</span>
          <span class="topbar-status">Real-time</span>
        </div>
        <div class="card-body" style="padding:16px">${renderAlerts(d.alerts)}</div>
      </div></div>
      <div><div class="card">
        <div class="card-header"><span class="card-title">Exam Funnel — ${esc(d.examTitle)}</span></div>
        <div class="card-body">
          <div style="display:flex;flex-direction:column;gap:14px">${renderFunnel(d.funnel)}</div>
        </div>
      </div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Score Distribution — ${esc(d.examTitle)}</span>
        <span class="topbar-status">Q03 Analytical Query</span>
      </div>
      <div class="card-body">${renderScoreChart(d.scoreChart)}</div>
    </div>`, true);
}

// ── Live Monitor (SSE-powered) ────────────────────────────────
let _monitorSSE = null;

function buildMonitor() {
  const el = document.getElementById('page-monitor');
  el.innerHTML = `
    <div id="monitor-alert-bar" style="margin-bottom:16px">
      <div class="alert alert-yellow"><span>◉</span><span>Connecting to live feed…</span></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span id="monitor-live-badge" style="display:inline-flex;align-items:center;gap:6px;
        background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);
        border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600">
        <span class="live-dot" style="width:8px;height:8px;border-radius:50%;background:#22c55e;
          animation:pulse 1.5s infinite"></span> LIVE
      </span>
      <span id="monitor-counts" style="font-size:13px;color:var(--text3)">—</span>
      <span id="monitor-lastupdate" style="font-size:11px;color:var(--text3);margin-left:auto"></span>
    </div>
    <div id="monitor-cards-grid" class="monitor-grid"></div>
    <div style="margin-top:24px">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Live Event Feed</span>
          <span style="font-size:12px;color:var(--text3)">Last 10 events across all active students</span>
        </div>
        <div id="monitor-event-feed" style="font-size:13px;font-family:monospace;padding:0 16px 12px"></div>
      </div>
    </div>`;

  // close any existing SSE before opening a new one
  if (_monitorSSE) { _monitorSSE.close(); _monitorSSE = null; }

  _monitorSSE = new EventSource('/api/monitor/stream');
  const feedLines = [];

  _monitorSSE.onmessage = e => {
    const d = JSON.parse(e.data);

    // update alert bar
    document.getElementById('monitor-alert-bar').innerHTML =
      `<div class="alert alert-yellow"><span>◉</span><span>${d.examAlert}</span></div>`;

    // update counts
    document.getElementById('monitor-counts').textContent =
      `${d.activeCount} active · ${d.flaggedCount} flagged`;

    // update timestamp
    document.getElementById('monitor-lastupdate').textContent =
      'Updated ' + new Date(d.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // re-render cards
    document.getElementById('monitor-cards-grid').innerHTML = renderMonitorCards(d.students);

    // append new suspicious events to feed
    d.students.forEach(s => {
      if (s.lastEvent && s.lastEvent !== 'EXAM_STARTED' && s.lastEvent !== 'EXAM_SUBMITTED') {
        const evTime = s.lastEventTime
          ? new Date(s.lastEventTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const severityColor = ['COPY_PASTE_DETECTED','IP_ADDRESS_CHANGED','MULTIPLE_LOGIN_DETECTED','DEVTOOLS_OPENED'].includes(s.lastEvent)
          ? '#f87171' : ['RAPID_ANSWERING','MULTIPLE_FACES_DETECTED'].includes(s.lastEvent)
          ? '#fb923c' : '#facc15';
        const key = `${s.attempt_id}_${s.lastEvent}_${s.lastEventTime}`;
        if (!feedLines.find(l => l.key === key)) {
          feedLines.unshift({ key,
            html: `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
              <span style="color:var(--text3)">${evTime}</span>
              <span style="color:${severityColor};margin:0 8px">${s.lastEvent.replace(/_/g,' ')}</span>
              <span style="color:var(--text2)">${esc(s.name)}</span>
              <span style="color:var(--text3);font-size:11px;float:right">Suspicion: ${s.suspicion}/100</span>
            </div>` });
          if (feedLines.length > 10) feedLines.pop();
          document.getElementById('monitor-event-feed').innerHTML =
            feedLines.length ? feedLines.map(l => l.html).join('') :
            '<div style="color:var(--text3);padding:12px 0">No suspicious events yet.</div>';
        }
      }
    });
  };

  _monitorSSE.onerror = () => {
    document.getElementById('monitor-live-badge').innerHTML =
      '<span style="width:8px;height:8px;border-radius:50%;background:#f87171"></span> DISCONNECTED';
    document.getElementById('monitor-live-badge').style.color = '#f87171';
  };
}

async function buildFlagged(sort = 'suspicion') {
  const container = document.getElementById('page-flagged');
  container.innerHTML = loadingHtml();
  try {
    const d = await api(`/api/flagged?sort=${sort}`);
    const flagged    = d.attempts.filter(a => a.statusBadge === 'badge-red').length;
    const timedOut   = d.attempts.filter(a => a.statusText  === 'Timed Out').length;
    const live       = d.attempts.filter(a => a.isLive).length;
    const unresolved = d.flags.filter(f => !f.resolved).length;

    const SORT_LABELS = {
      suspicion:  'Suspicion Score',
      tabs:       'Tab Switches',
      paste:      'Copy-Paste',
      fullscreen: 'Fullscreen Exits',
      rapid:      'Rapid Answering',
      composite:  'Composite Risk',
    };
    const sortOptions = Object.entries(SORT_LABELS).map(([v, l]) =>
      `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`
    ).join('');

    container.innerHTML = `
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--text3)">Sort by:</label>
        <select style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px"
          onchange="buildFlagged(this.value)">
          ${sortOptions}
        </select>
        <span style="font-size:12px;color:var(--text3)">${d.attempts.length} students · ${live > 0 ? `<span style="color:var(--red)">${live} live now</span>` : '0 live'}</span>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <span class="card-title">Suspicious &amp; Flagged Attempts</span>
          <div style="display:flex;gap:8px">
            <span class="badge badge-red">${flagged} Flagged</span>
            <span class="badge badge-yellow">${timedOut} Timed Out</span>
            ${live > 0 ? `<span class="badge badge-orange">${live} Live</span>` : ''}
          </div>
        </div>
        ${renderFlaggedTable(d.attempts)}
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Open Suspicion Flags</span>
          <span class="badge badge-red">${unresolved} unresolved</span>
        </div>
        ${renderFlagsTable(d.flags)}
      </div>`;
  } catch (err) {
    container.innerHTML = errorHtml('flagged attempts', err.message);
  }
}

async function buildLogs(attemptId = null) {
  const container = document.getElementById('page-logs');
  container.innerHTML = loadingHtml();
  try {
    const url = attemptId ? `/api/logs?attempt_id=${attemptId}` : '/api/logs';
    const [logsData, actionsData] = await Promise.all([
      api(url),
      api('/api/proctor-actions'),
    ]);
    const d = logsData;
    const a = actionsData;

    const selectorOptions = (d.allAttempts || []).map(at =>
      `<option value="${at.attempt_id}" ${at.attempt_id === d.attemptId ? 'selected' : ''}>${esc(at.label)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <span class="card-title">Proctor Actions</span>
          <span class="badge badge-gray">${a.actions.length} total</span>
        </div>
        ${renderProctorActions(a.actions)}
      </div>
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--text3)">Student attempt:</label>
        <select id="logs-attempt-select" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;min-width:280px"
          onchange="buildLogs(parseInt(this.value))">
          ${selectorOptions}
        </select>
      </div>
      <div class="two-col">
        <div class="card" style="margin-bottom:0">
          <div class="card-header">
            <span class="card-title">Event Timeline — ${esc(d.badge)}</span>
            <span class="topbar-status">${d.risk.totalEvents} events · ${esc(d.risk.duration)}</span>
          </div>
          ${renderTimeline(d.timeline)}
        </div>
        <div><div class="card" style="margin-bottom:16px">
          <div class="card-header"><span class="card-title">Risk Summary</span></div>
          <div class="card-body" style="text-align:center">${renderRiskSummary(d.risk)}</div>
        </div></div>
      </div>`;
  } catch (err) {
    container.innerHTML = errorHtml('logs', err.message);
  }
}

function buildStudentView() {
  const studentId = currentUser && currentUser.role === 'student' ? currentUser.user_id : null;
  const endpoint  = studentId ? `/api/student-view?student_id=${studentId}` : '/api/student-view';
  const container = document.getElementById('page-student-view');
  container.innerHTML = loadingHtml();
  api(endpoint).then(d => {
    if (!d.exams || d.exams.length === 0) {
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
    container.innerHTML = `
      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">${esc(d.label)}</div>
      <div class="exam-grid">${renderExamCards(d.exams)}</div>`;
    animateProgressBars();
  }).catch(err => { container.innerHTML = errorHtml('my-results', err.message); });
}

// ── Classroom / Exam Session page ────────────────────────────
// Teacher: shows active live exams with join codes and student lists
// Student: enter join code to start exam
async function buildClassroom() {
  const container = document.getElementById('page-classroom');
  container.innerHTML = loadingHtml();
  try {
    const role = currentUser?.role;
    const isTeacher = role === 'proctor' || role === 'admin' || role === 'instructor' || role === 'teacher';

    if (isTeacher) {
      const d = await api('/api/classroom/active');
      const sessions = d.classrooms || (d.classroom ? [d.classroom] : []);
      if (sessions.length > 0) {
        const sessionCards = sessions.map(c => `
          <div style="display:grid;grid-template-columns:340px 1fr;gap:20px;align-items:start;margin-bottom:28px">
            <div class="card">
              <div class="card-header">
                <span class="card-title" style="font-size:14px">${esc(c.title)}</span>
                <span class="badge badge-green" style="animation:pulse 2s infinite">● LIVE</span>
              </div>
              <div class="card-body" style="text-align:center;padding:24px 20px">
                <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Student Exam Code</div>
                <div id="code-display-${c.exam_id}" style="font-size:56px;font-weight:900;letter-spacing:12px;color:var(--accent2);font-family:monospace;line-height:1;margin-bottom:14px;cursor:pointer;user-select:all"
                  title="Click to copy" onclick="copyCode('${esc(c.join_code)}')">${esc(c.join_code)}</div>
                <div id="copy-hint-${c.exam_id}" style="font-size:11px;color:var(--text3);margin-bottom:16px">Click code to copy</div>
                <div style="display:flex;justify-content:center;gap:20px;font-size:12px;color:var(--text3);margin-bottom:18px;flex-wrap:wrap">
                  <span>⏱ ${c.duration_minutes} min</span>
                  <span>📋 ${Math.round(c.total_marks)} marks</span>
                  <span style="color:var(--green);font-weight:600">● ${c.live_count || 0} live</span>
                  <span style="color:var(--text3)">${c.total_joined || 0} joined</span>
                </div>
                <div style="display:flex;gap:8px;justify-content:center">
                  <button class="btn btn-outline" style="flex:1;font-size:12px" onclick="buildClassroom()">Refresh</button>
                  <button class="btn" style="flex:1;font-size:12px;background:var(--red)" onclick="endClassroom(${c.exam_id})">End Session</button>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header">
                <span class="card-title">Students in Session</span>
                <span class="badge badge-gray">${c.total_joined || 0} joined</span>
              </div>
              <div id="classroom-live-list-${c.exam_id}" class="card-body" style="padding:16px">Loading…</div>
            </div>
          </div>`).join('');

        container.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div>
              <div style="font-size:15px;font-weight:600">${sessions.length} active session${sessions.length > 1 ? 's' : ''}</div>
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
              Open an exam from <strong>My Exams</strong> to generate a unique code.<br>
              Share the code with your students — they enter it to start.
            </div>
            <button class="btn btn-primary" style="font-size:15px;padding:12px 32px" onclick="showPage('exams')">
              Go to My Exams
            </button>
          </div>`;
      }
    } else {
      // Student — enter join code
      container.innerHTML = `
        <div style="max-width:420px;margin:60px auto 0">
          <div class="card">
            <div class="card-body" style="text-align:center;padding:44px 36px">
              <div style="font-size:40px;margin-bottom:12px">▣</div>
              <div style="font-size:24px;font-weight:700;margin-bottom:6px">Enter Exam Code</div>
              <div style="font-size:13px;color:var(--text3);margin-bottom:28px;line-height:1.6">
                Get the 6-character code from your teacher to begin your exam
              </div>
              <form onsubmit="joinClassroom(event)">
                <input id="join-code-input" class="form-input"
                  placeholder="ABC123"
                  maxlength="6"
                  style="font-size:32px;text-align:center;letter-spacing:10px;text-transform:uppercase;font-family:monospace;padding:16px;font-weight:700"
                  oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')"
                  autocomplete="off" required>
                <div id="join-error" style="color:var(--red);font-size:13px;margin-top:10px;min-height:20px"></div>
                <button type="submit" id="join-btn" class="btn btn-primary btn-full" style="margin-top:14px;font-size:16px;padding:14px">
                  Start Exam
                </button>
              </form>
            </div>
          </div>
          <div style="margin-top:16px;text-align:center;font-size:12px;color:var(--text3)">
            Already took an exam? <a href="#" onclick="showPage('student-view');return false" style="color:var(--accent2)">View My Results →</a>
          </div>
        </div>`;
    }
  } catch (err) {
    container.innerHTML = errorHtml('classroom', err.message);
  }
}

// Copy exam code to clipboard with feedback
function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    // Show "Copied!" feedback on all code displays
    document.querySelectorAll('[id^="copy-hint-"]').forEach(el => {
      el.textContent = '✓ Copied to clipboard!';
      el.style.color = 'var(--green)';
      setTimeout(() => { el.textContent = 'Click code to copy'; el.style.color = 'var(--text3)'; }, 2000);
    });
  }).catch(() => {});
}

// Kept as legacy shim (classroom start form no longer used — teachers open exams from My Exams)
function buildClassroomStartForm() { buildClassroom(); }

async function loadClassroomLiveList(examId) {
  try {
    const rows = await api(`/api/monitor/exam/${examId}`);
    const el = document.getElementById(`classroom-live-list-${examId}`);
    if (!el) return;
    if (!rows.students || rows.students.length === 0) {
      el.innerHTML = '<p style="color:var(--text3);font-size:13px">No students have joined yet.</p>';
      return;
    }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)">
        <th style="padding:6px 8px;text-align:left">Student</th>
        <th style="padding:6px 8px;text-align:center">Status</th>
        <th style="padding:6px 8px;text-align:center">Suspicion</th>
        <th style="padding:6px 8px;text-align:center">Tabs</th>
      </tr></thead>
      <tbody>${rows.students.map(s => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px">${esc(s.name)}</td>
          <td style="padding:8px;text-align:center"><span class="badge ${s.status==='in_progress'?'badge-green':'badge-gray'}">${s.status}</span></td>
          <td style="padding:8px;text-align:center;color:${s.suspicion>=70?'var(--red)':s.suspicion>=40?'var(--orange)':s.suspicion>=10?'var(--yellow)':'var(--green)'}">${s.suspicion}</td>
          <td style="padding:8px;text-align:center">${s.tabs}</td>
        </tr>`).join('')}
      </tbody></table>`;
  } catch { /* ignore */ }
}

async function createClassroom(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Starting...';
  try {
    await apiPost('/api/classroom/create', {
      title:            document.getElementById('cr-title').value.trim(),
      duration_minutes: parseInt(document.getElementById('cr-duration')?.value || '60'),
      total_marks:      parseInt(document.getElementById('cr-total')?.value    || '100'),
      passing_marks:    parseInt(document.getElementById('cr-pass')?.value     || '40'),
    });
    buildClassroom();
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Start & Get Code';
    alert('Failed to start classroom: ' + err.message);
  }
}

async function endClassroom(examId) {
  if (!confirm('End this exam session? Students will no longer be able to join.')) return;
  try {
    await apiPost('/api/classroom/end', { exam_id: examId });
    buildClassroom();
  } catch (err) {
    alert('Failed to end classroom: ' + err.message);
  }
}

async function joinClassroom(e) {
  e.preventDefault();
  const btn   = document.getElementById('join-btn');
  const errEl = document.getElementById('join-error');
  const code  = document.getElementById('join-code-input').value.trim().toUpperCase();
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Joining...';
  try {
    const d = await apiPost('/api/classroom/join', { code });
    // Start the exam UI with the returned data
    startExamFromClassroom(d);
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Enter Classroom';
  }
}

function startExamFromClassroom(d) {
  examState = {
    attempt_id: d.attempt_id,
    exam:       d.exam,
    questions:  d.questions,
    answers:    {},
    timerInterval: null,
  };
  currentAttemptId = d.attempt_id;
  renderExamOverlay();
  startExamTimer();
  startWarningPolling();
  document.documentElement.requestFullscreen().catch(() => {});
}

async function buildAnalytics(examId = null) {
  const container = document.getElementById('page-analytics');
  container.innerHTML = loadingHtml();
  try {
  const url = examId ? `/api/analytics?exam_id=${examId}` : '/api/analytics';
  const d = await api(url);

  const selectorOptions = [
    `<option value="" ${!examId ? 'selected' : ''}>Overall (All Exams)</option>`,
    ...(d.exams || []).map(e =>
      `<option value="${e.exam_id}" ${e.exam_id === d.selectedExam ? 'selected' : ''}>${esc(e.title)}</option>`)
  ].join('');

  const diffTitle = examId ? 'Question Difficulty' : 'Question Difficulty (Top 10 Hardest)';

  container.innerHTML = `
    <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <label style="font-size:13px;color:var(--text3)">Exam:</label>
      <select style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;min-width:260px"
        onchange="buildAnalytics(this.value ? parseInt(this.value) : null)">
        ${selectorOptions}
      </select>
    </div>
    ${renderStatCards(d.stats)}
    <div class="two-col">
      <div class="card">
        <div class="card-header"><span class="card-title">${esc(diffTitle)}</span></div>
        ${renderDifficultyTable(d.difficulty)}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Class Ranking</span></div>
        ${renderRankingTable(d.ranking)}
      </div>
    </div>`;
  animateProgressBars();
  } catch (err) {
    container.innerHTML = errorHtml('analytics', err.message);
  }
}

function buildSchema() {
  return buildPage('schema', '/api/schema', d => `
    <div style="margin-bottom:20px">
      <p style="color:var(--text3);font-size:13px">
        Database: <strong>ExamProctor</strong> · Engine: InnoDB ·
        ${d.tables.length} Tables · Normalization: 3NF / BCNF ·
        <em>Live metadata from INFORMATION_SCHEMA</em>
      </p>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Tables &amp; Row Counts</span></div>
      ${renderSchemaTable(d.tables)}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><span class="card-title">Triggers (${d.triggers.length})</span></div>
        <div class="card-body" style="padding:0">${renderTriggersTable(d.triggers)}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Stored Procedures (${d.procedures.length})</span></div>
        <div class="card-body" style="padding:0">${renderProceduresTable(d.procedures)}</div>
      </div>
    </div>`);
}

// Toggle per-student detail row inline in the results table
async function showStudentDetail(attemptId, btn) {
  const detailRow = document.getElementById(`detail-row-${attemptId}`);
  const detailDiv = document.getElementById(`detail-${attemptId}`);
  if (!detailRow || !detailDiv) return;

  // Toggle off if already open
  if (detailRow.style.display !== 'none') {
    detailRow.style.display = 'none';
    btn.textContent = 'View';
    return;
  }

  btn.textContent = '...';
  btn.disabled = true;
  const d = await api(`/api/results/${attemptId}`);
  btn.disabled = false;

  if (d.error) {
    detailDiv.innerHTML = `<p style="color:var(--red)">Failed to load detail.</p>`;
  } else {
    detailDiv.innerHTML = renderStudentDetail(d);
  }
  detailRow.style.display = '';
  btn.textContent = 'Hide';
}

function buildResults() {
  return buildPage('results', '/api/results', d => {
    if (!d.exams || d.exams.length === 0)
      return `<p style="color:var(--text3)">No submitted results yet.</p>`;

    const examCards = d.exams.map(ex => `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <span class="card-title">${esc(ex.title)}</span>
          <span class="badge badge-gray">${ex.students.length} students</span>
        </div>
        ${renderResultsTable(ex.students)}
      </div>`).join('');

    const rankingCard = d.ranking && d.ranking.length ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <span class="card-title">Overall Class Ranking</span>
          <span class="badge badge-purple">${d.ranking.length} students</span>
        </div>
        ${renderClassRanking(d.ranking)}
      </div>` : '';

    return rankingCard + examCards;
  });
}

function buildExams() {
  const container = document.getElementById('page-exams');
  container.innerHTML = loadingHtml();
  api('/api/exams').then(d => {
    const total     = d.exams.length;
    const active    = d.exams.filter(e => e.isActive).length;
    const upcoming  = d.exams.filter(e => e.isUpcoming).length;
    const drafts    = d.exams.filter(e => e.isDraft).length;
    const completed = d.exams.filter(e => !e.isActive && !e.isUpcoming && !e.isDraft).length;
    const isTeacher = currentUser && ['teacher','instructor','admin'].includes(currentUser.role);

    if (total === 0) {
      container.innerHTML = `
        <div style="max-width:520px;margin:80px auto 0;text-align:center">
          <div style="font-size:40px;margin-bottom:16px">▤</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">No Exams Yet</div>
          <div style="font-size:14px;color:var(--text3);margin-bottom:28px;line-height:1.7">
            Create your first exam, add questions with marks,<br>then open it to get a code for your students.
          </div>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-outline" onclick="showCreateCourseModal()">+ Create Course First</button>
            <button class="btn btn-primary" onclick="showCreateExamModal()">+ New Exam</button>
          </div>
        </div>`;
      return;
    }

    const statRow = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <span class="badge badge-gray">${total} exam${total !== 1 ? 's' : ''}</span>
        ${drafts    > 0 ? `<span class="badge badge-gray">${drafts} draft${drafts !== 1 ? 's' : ''}</span>` : ''}
        ${active    > 0 ? `<span class="badge badge-green">● ${active} live now</span>` : ''}
        ${upcoming  > 0 ? `<span class="badge badge-purple">${upcoming} upcoming</span>` : ''}
        ${completed > 0 ? `<span class="badge badge-gray">${completed} completed</span>` : ''}
        <button class="btn btn-primary" style="margin-left:auto;font-size:13px" onclick="showCreateExamModal()">+ New Exam</button>
      </div>`;

    container.innerHTML = statRow + renderMyExamCards(d.exams, isTeacher);
  }).catch(err => {
    container.innerHTML = errorHtml('exams', err.message);
  });
}

function buildQuestions() {
  const container = document.getElementById('page-questions');
  container.innerHTML = loadingHtml();
  // Load both questions and exams together to show marking scheme summary
  Promise.all([api('/api/questions'), api('/api/exams')]).then(([qd, ed]) => {
    const total = qd.groups.reduce((sum, g) => sum + g.questions.length, 0);
    // Build a map of exam metadata (declared marks, duration)
    const examMeta = {};
    (ed.exams || []).forEach(e => { examMeta[e.id] = e; });

    if (qd.groups.length === 0) {
      container.innerHTML = `
        <div style="max-width:500px;margin:80px auto 0;text-align:center">
          <div style="font-size:40px;margin-bottom:16px">?</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">Question Bank is Empty</div>
          <div style="font-size:14px;color:var(--text3);margin-bottom:24px;line-height:1.7">
            Go to <strong>My Exams</strong>, open an exam, and click <strong>+ Question</strong><br>
            to start building your question bank with marks.
          </div>
          <button class="btn btn-primary" onclick="showPage('exams')">Go to My Exams</button>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <span style="font-size:15px;font-weight:600">${total} question${total !== 1 ? 's' : ''}</span>
          <span style="font-size:13px;color:var(--text3);margin-left:8px">across ${qd.groups.length} exam${qd.groups.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="font-size:12px;color:var(--text3)">Click <strong>+ Question</strong> on any exam below to add more</div>
      </div>
      ${renderBrilliantQuestionBank(qd.groups, examMeta)}`;
  }).catch(err => {
    container.innerHTML = errorHtml('questions', err.message);
  });
}

function buildCourses() {
  return buildPage('courses', '/api/courses/all', d => {
    const total = d.courses.length;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div style="font-size:13px;color:var(--text3)">${total} active course${total !== 1 ? 's' : ''} · Instructors and exam counts pulled from DB</div>
        <button type="button" class="btn btn-primary" onclick="showCreateCourseModal()">+ New Course</button>
      </div>
      <div class="courses-grid">${renderCourseCards(d.courses)}</div>`;
  });
}

async function showCreateCourseModal() {
  let instructors;
  try {
    const d = await api('/api/users/instructors');
    instructors = d.instructors;
  } catch (err) {
    alert('Could not load instructors: ' + err.message);
    return;
  }
  // Instructors see their own name auto-filled; admins get a dropdown
  const isAdmin = currentUser?.roles?.includes('admin');
  const isTeacher = currentUser?.roles?.some(r => ['instructor','teacher'].includes(r));
  const instructorField = isAdmin
    ? `<div class="form-group">
        <label>Instructor</label>
        <select name="instructor_id" required>
          ${instructors.map(i => `<option value="${i.user_id}">${esc(i.full_name)} &lt;${esc(i.email)}&gt;</option>`).join('')}
        </select>
      </div>`
    : `<div class="form-group">
        <label>Instructor</label>
        <input type="text" value="${esc(currentUser.full_name)}" disabled style="opacity:.7" />
        <input type="hidden" name="instructor_id" value="${currentUser.user_id}" />
      </div>`;

  showModal('Create New Course', `
    <form id="course-form" onsubmit="submitCreateCourse(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Course Code</label>
          <input type="text" name="course_code" required placeholder="e.g. CS401" maxlength="20" />
        </div>
        ${instructorField}
      </div>
      <div class="form-group">
        <label>Course Name</label>
        <input type="text" name="course_name" required placeholder="e.g. Operating Systems" />
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <textarea name="description" placeholder="Brief overview of this course…"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="course-submit-btn">Create Course</button>
      </div>
    </form>`);

  // For admins: default the dropdown to the logged-in user if they're an instructor
  if (isAdmin && currentUser?.user_id) {
    const sel = document.querySelector('#modal-body select[name="instructor_id"]');
    if (sel) sel.value = currentUser.user_id;
  }
}

async function submitCreateCourse(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById('course-submit-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    await apiPost('/api/courses', {
      course_code:   form.course_code.value.trim().toUpperCase(),
      course_name:   form.course_name.value.trim(),
      description:   form.description.value.trim() || null,
      instructor_id: parseInt(form.instructor_id.value),
    });
    closeModal();
    buildCourses();
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Create Course';
    alert('Failed to create course: ' + err.message);
  }
}

async function deleteCourse(id, name) {
  if (!confirm(`Deactivate course "${name}"?\n\nThis hides the course but preserves all exam data.`)) return;
  try {
    await apiDelete(`/api/courses/${id}`);
    buildCourses();
  } catch (err) {
    alert('Failed to deactivate course: ' + err.message);
  }
}

// ── Modal helpers ─────────────────────────────────────────────
function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// ── Create Exam ───────────────────────────────────────────────
async function showCreateExamModal() {
  let courses;
  try {
    const d = await api('/api/courses');
    courses = d.courses;
  } catch (err) {
    alert('Could not load courses: ' + err.message);
    return;
  }

  // Hide auto-generated classroom courses (ROOM... prefix) from the dropdown
  const visibleCourses = courses.filter(c => !c.course_code.startsWith('ROOM'));
  const opts = visibleCourses.length
    ? visibleCourses.map(c =>
        `<option value="${c.course_id}">${esc(c.course_code)} — ${esc(c.course_name)}</option>`
      ).join('')
    : `<option value="" disabled>No courses yet — create one first</option>`;

  showModal('Create New Exam', `
    <form id="exam-form" onsubmit="submitCreateExam(event)">
      <div class="form-group">
        <label>Course</label>
        <select name="course_id" required ${!visibleCourses.length ? 'disabled' : ''}>${opts}</select>
        ${!visibleCourses.length ? `<div style="margin-top:6px"><button type="button" class="btn btn-outline" style="font-size:12px" onclick="closeModal();showCreateCourseModal()">+ Create a Course first</button></div>` : ''}
      </div>
      <div class="form-group">
        <label>Exam Title</label>
        <input type="text" name="title" required placeholder="e.g. DBMS Mid-Term Exam" />
      </div>
      <div class="form-group">
        <label>Description <span style="color:var(--text3);font-weight:400">(optional)</span></label>
        <textarea name="description" placeholder="Brief description of the exam…"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Total Marks</label>
          <input type="number" name="total_marks" required min="1" value="50" />
        </div>
        <div class="form-group">
          <label>Passing Marks</label>
          <input type="number" name="passing_marks" required min="1" value="25" />
        </div>
        <div class="form-group">
          <label>Duration (min)</label>
          <input type="number" name="duration_minutes" required min="1" value="60" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Max Attempts per student</label>
          <input type="number" name="max_attempts" required min="1" value="1" />
        </div>
      </div>
      <div class="form-checkrow">
        <label class="form-check">
          <input type="checkbox" name="shuffle_questions" checked /> Shuffle Questions
        </label>
        <label class="form-check">
          <input type="checkbox" name="show_results_immediately" /> Show Results Immediately
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="create-exam-btn">Create Exam</button>
      </div>
    </form>`);
}

async function submitCreateExam(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById('create-exam-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const toDatetime = v => v ? v.replace('T', ' ') + ':00' : null;

  const data = {
    course_id:                parseInt(form.course_id.value),
    title:                    form.title.value.trim(),
    description:              form.description.value.trim() || null,
    total_marks:              parseFloat(form.total_marks.value),
    passing_marks:            parseFloat(form.passing_marks.value),
    duration_minutes:         parseInt(form.duration_minutes.value),
    // Window is managed via Open/Close on the Exams page, not at creation time.
    // Set far-future placeholders so the DB constraint is satisfied and the exam
    // never accidentally becomes "Active" while the teacher is building it.
    window_start:             toDatetime(new Date(Date.now() + 365*24*60*60*1000).toISOString().slice(0,16)),
    window_end:               toDatetime(new Date(Date.now() + 366*24*60*60*1000).toISOString().slice(0,16)),
    max_attempts:             parseInt(form.max_attempts.value),
    shuffle_questions:        form.shuffle_questions.checked,
    show_results_immediately: form.show_results_immediately.checked,
    is_published:             false,   // always unpublished until proctor explicitly opens it
  };

  try {
    const result = await apiPost('/api/exams', data);
    closeModal();
    showPage('exams');
    buildExams();
    buildDashboard();
    // Immediately prompt to add the first question
    if (result.exam_id) {
      setTimeout(() => showAddQuestionModal(result.exam_id, data.title, data.total_marks), 200);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Exam';
    alert('Failed to create exam: ' + err.message);
  }
}

function openExam(id, title, durationMin) {
  _openExamId    = parseInt(id);
  _openExamTitle = title;
  const defaultHrs = Math.max(1, Math.ceil((durationMin || 60) / 60 + 0.5));
  // Min schedule time = now + 10 min, rounded to next 5-min slot
  const minDate = new Date(Date.now() + 10 * 60 * 1000);
  minDate.setSeconds(0, 0);
  const minDateStr = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  // Default suggested schedule = now + 15 min
  const suggestDate = new Date(Date.now() + 15 * 60 * 1000);
  suggestDate.setSeconds(0, 0);
  const suggestStr = new Date(suggestDate.getTime() - suggestDate.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  showModal(`Open Exam — ${title}`, `
    <div style="padding:8px 0 4px">
      <div style="font-size:13px;color:var(--text3);margin-bottom:20px;line-height:1.6;text-align:center">
        Publishing will generate a <strong>join code</strong> for students.<br>
        Share the code verbally — students enter it to start.
      </div>

      <div style="margin-bottom:18px">
        <label style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:8px">
          Window duration (hours)
        </label>
        <input id="open-hrs-input" type="number" min="0.5" max="72" step="0.5"
          value="${defaultHrs}"
          style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:15px">
      </div>

      <div style="margin-bottom:18px">
        <label style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:8px">
          When to start
        </label>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <label class="open-when-opt" id="opt-now" style="flex:1;display:flex;align-items:center;gap:8px;background:var(--bg3);border:2px solid var(--accent);border-radius:8px;padding:10px 14px;cursor:pointer">
            <input type="radio" name="open_when" value="now" checked onchange="toggleSchedulePicker(false)"
                   style="accent-color:var(--accent)"> Open Now
          </label>
          <label class="open-when-opt" id="opt-later" style="flex:1;display:flex;align-items:center;gap:8px;background:var(--bg3);border:2px solid var(--border);border-radius:8px;padding:10px 14px;cursor:pointer">
            <input type="radio" name="open_when" value="later" onchange="toggleSchedulePicker(true)"
                   style="accent-color:var(--accent)"> Schedule
          </label>
        </div>
        <div id="schedule-picker" style="display:none">
          <input id="scheduled-at-input" type="datetime-local" min="${minDateStr}" value="${suggestStr}"
            style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:14px">
          <div style="font-size:11px;color:var(--text3);margin-top:5px">
            Must be at least <strong>10 minutes</strong> from now. Join code is generated immediately but exam only opens at the scheduled time.
          </div>
        </div>
      </div>

      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="open-exam-btn" onclick="confirmOpenExam()">
          Open &amp; Get Code
        </button>
      </div>
    </div>`);
}

function toggleSchedulePicker(show) {
  const picker = document.getElementById('schedule-picker');
  if (picker) picker.style.display = show ? '' : 'none';
  document.getElementById('opt-now').style.borderColor  = show ? 'var(--border)' : 'var(--accent)';
  document.getElementById('opt-later').style.borderColor = show ? 'var(--accent)' : 'var(--border)';
}

async function confirmOpenExam() {
  const id    = _openExamId;
  const title = _openExamTitle;
  const btn = document.getElementById('open-exam-btn');
  const hrs = parseFloat(document.getElementById('open-hrs-input')?.value || '2');
  if (!hrs || hrs <= 0) return alert('Enter a valid number of hours.');

  const when = document.querySelector('input[name=open_when]:checked')?.value;
  let scheduled_at = null;
  if (when === 'later') {
    const val = document.getElementById('scheduled-at-input')?.value;
    if (!val) return alert('Please pick a scheduled start time.');
    const sched = new Date(val);
    if (sched < new Date(Date.now() + 9.5 * 60 * 1000))
      return alert('Scheduled time must be at least 10 minutes from now.');
    scheduled_at = sched.toISOString();
  }

  btn.disabled = true; btn.textContent = when === 'later' ? 'Scheduling…' : 'Opening…';
  try {
    const body = { duration_hours: hrs };
    if (scheduled_at) body.scheduled_at = scheduled_at;

    const res = await fetch(`/api/exams/${id}/open`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    closeModal();
    if (data.join_code) {
      showCodeBanner(data.join_code, title, data.scheduled);
    }
    buildExams();
    buildClassroom();
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Open & Get Code';
    alert('Failed to open exam: ' + err.message);
  }
}

function showCodeBanner(code, title, isScheduled) {
  const heading = isScheduled ? 'Exam Scheduled — Share This Code' : 'Exam Open — Share This Code';
  const subtitle = isScheduled
    ? `Exam <strong>${esc(title)}</strong> is scheduled.<br>Share the code now — students enter it when the exam opens.`
    : `Exam <strong>${esc(title)}</strong> is now live.<br>Tell your students this code — they enter it on the Exam Session page.`;
  showModal(heading, `
    <div style="text-align:center;padding:16px 8px 8px">
      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">${subtitle}</div>
      <div style="font-size:64px;font-weight:900;letter-spacing:14px;color:var(--accent2);font-family:monospace;line-height:1;margin-bottom:10px;cursor:pointer"
        onclick="copyCode('${esc(code)}')" title="Click to copy">${esc(code)}</div>
      <div id="code-banner-hint" style="font-size:12px;color:var(--text3);margin-bottom:20px">Click code to copy</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button class="btn btn-outline" onclick="copyCode('${esc(code)}');document.getElementById('code-banner-hint').textContent='Copied!'">
          Copy Code
        </button>
        <button class="btn btn-primary" onclick="closeModal();showPage('classroom')">
          ${isScheduled ? 'View Exams' : 'View Live Session'}
        </button>
      </div>
    </div>`);
}

async function closeExam(id, title) {
  if (!confirm(`End exam "${title}" now?\n\nNo new attempts will be allowed.`)) return;
  try {
    const res = await fetch(`/api/exams/${id}/close`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buildExams();
    buildStudentView();
  } catch (err) { alert('Failed to close exam: ' + err.message); }
}

async function deleteExam(id, title) {
  if (!confirm(`Delete exam "${title}"?\n\nThis will also delete all questions, attempts, and logs.`)) return;
  try {
    await apiDelete(`/api/exams/${id}`);
    buildExams();
    buildDashboard();
    buildQuestions();
  } catch (err) {
    alert('Failed to delete exam: ' + err.message);
  }
}

// ── Add / Delete Question ─────────────────────────────────────
const MCQ_LABELS = ['A','B','C','D','E','F','G','H','I','J'];

// currentExamTotalMarks is set when opening the modal so submitAddQuestion can show live tally
let _addQExamTotalMarks = null;
let _addQExamId = null;

// Stored by openExam() so confirmOpenExam() doesn't need to pass title through an onclick string
let _openExamId    = null;
let _openExamTitle = null;

function showAddQuestionModal(examId, examTitle, examTotalMarks) {
  _addQExamId = examId;
  // Try to get total marks from passed param, or look it up from the page data
  _addQExamTotalMarks = examTotalMarks ?? null;

  showModal(`Add Question — ${examTitle}`, `
    <div id="question-form">
      <input type="hidden" id="q-exam-id" value="${examId}" />
      <div class="form-group">
        <label>Question Text</label>
        <textarea id="q-text" name="question_text" rows="3" placeholder="Enter the question…"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Type</label>
          <select id="q-type" name="question_type" onchange="toggleMcqOptions(this.value)">
            <option value="MCQ">MCQ</option>
            <option value="TRUE_FALSE">True / False</option>
            <option value="SHORT_ANSWER">Short Answer</option>
          </select>
        </div>
        <div class="form-group">
          <label>Marks</label>
          <input id="q-marks" type="number" name="marks" min="0.5" step="0.5" value="5" />
        </div>
        <div class="form-group">
          <label>Difficulty</label>
          <select id="q-difficulty" name="difficulty_level">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div class="form-group">
          <label>Order #</label>
          <input id="q-order" type="number" name="order_index" value="0" min="0" />
        </div>
      </div>

      <!-- MCQ dynamic options -->
      <div id="mcq-options-block">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <label style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px">
            Options <span style="font-weight:400;text-transform:none">(select correct answer)</span>
          </label>
          <button type="button" class="btn btn-outline" style="padding:4px 12px;font-size:12px"
                  onclick="addMcqOption()" id="add-option-btn">+ Add Option</button>
        </div>
        <div id="mcq-options-list"></div>
      </div>

      <!-- True/False correct answer -->
      <div id="tf-block" style="display:none" class="form-group">
        <label>Correct Answer</label>
        <select id="q-tf-answer" name="tf_answer">
          <option value="TRUE">True</option>
          <option value="FALSE">False</option>
        </select>
      </div>

      <!-- Short answer key -->
      <div id="sa-block" style="display:none" class="form-group">
        <label>Answer Key</label>
        <input id="q-sa-answer" type="text" name="sa_answer" placeholder="Expected answer (shown to teacher)" />
      </div>

      <!-- Live marks tally — updated after each successful add -->
      <div id="q-add-status"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="question-submit-btn" onclick="submitAddQuestion()">Add Question</button>
      </div>
    </div>`);

  // Render initial 2 MCQ options and ensure block visibility is correct
  renderMcqOptions(2);
  toggleMcqOptions('MCQ');
}

function renderMcqOptions(count) {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const label = MCQ_LABELS[i];
    const row = document.createElement('div');
    row.className = 'mcq-option-row';
    row.dataset.idx = i;
    row.innerHTML = `
      <label class="mcq-radio-label" title="Mark as correct">
        <input type="radio" name="mcq_correct" value="${label}" />
      </label>
      <span class="mcq-option-letter">${label}</span>
      <input type="text" class="mcq-option-input" name="option_${label.toLowerCase()}"
             placeholder="Option ${label}" />
      ${i >= 2 ? `<button type="button" class="mcq-remove-btn" onclick="removeMcqOption(${i})" title="Remove">✕</button>` : '<span style="width:24px"></span>'}
    `;
    list.appendChild(row);
  }
  const addBtn = document.getElementById('add-option-btn');
  if (addBtn) addBtn.style.display = count >= 10 ? 'none' : '';
}

function addMcqOption() {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  const rows = list.querySelectorAll('.mcq-option-row');
  const current = rows.length;
  if (current >= 10) return;
  // Save existing typed values and which radio was checked
  const vals = Array.from(rows).map(r => r.querySelector('input[type=text]').value);
  const wasCorrect = list.querySelector('input[type=radio]:checked')?.value;
  // Re-render with one extra slot
  renderMcqOptions(current + 1);
  // Restore saved values + correct selection
  const newRows = list.querySelectorAll('.mcq-option-row');
  newRows.forEach((r, i) => {
    if (i < vals.length) r.querySelector('input[type=text]').value = vals[i];
    const radio = r.querySelector('input[type=radio]');
    if (radio && radio.value === wasCorrect) radio.checked = true;
  });
}

function removeMcqOption(idx) {
  const list = document.getElementById('mcq-options-list');
  if (!list) return;
  const rows = list.querySelectorAll('.mcq-option-row');
  if (rows.length <= 2) return;
  // Collect values before re-render
  const vals = [];
  rows.forEach(r => vals.push(r.querySelector('input[type=text]').value));
  const wasCorrect = list.querySelector('input[type=radio]:checked')?.value;
  vals.splice(idx, 1);
  const newCount = vals.length;
  renderMcqOptions(newCount);
  // Restore values
  const newRows = list.querySelectorAll('.mcq-option-row');
  newRows.forEach((r, i) => {
    r.querySelector('input[type=text]').value = vals[i] || '';
    const radio = r.querySelector('input[type=radio]');
    if (radio.value === wasCorrect) radio.checked = true;
  });
}

function toggleMcqOptions(type) {
  document.getElementById('mcq-options-block').style.display = type === 'MCQ' ? '' : 'none';
  document.getElementById('tf-block').style.display          = type === 'TRUE_FALSE' ? '' : 'none';
  document.getElementById('sa-block').style.display          = type === 'SHORT_ANSWER' ? '' : 'none';
}

async function submitAddQuestion() {
  const btn = document.getElementById('question-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  const examId      = parseInt(document.getElementById('q-exam-id').value);
  const questionText = document.getElementById('q-text').value.trim();
  const type        = document.getElementById('q-type').value;
  const marks       = parseFloat(document.getElementById('q-marks').value);
  const difficulty  = document.getElementById('q-difficulty').value;
  const orderIndex  = parseInt(document.getElementById('q-order').value) || 0;

  if (!questionText) {
    btn.disabled = false; btn.textContent = 'Add Question';
    return alert('Please enter the question text.');
  }
  if (!marks || marks <= 0) {
    btn.disabled = false; btn.textContent = 'Add Question';
    return alert('Please enter a valid mark value (> 0).');
  }

  // Guard: don't let questions total exceed declared exam total marks
  try {
    const examData = await api('/api/exams');
    const thisExam = examData.exams.find(ex => ex.id === examId);
    if (thisExam) {
      const declared = parseFloat(thisExam.totalMarks) || 0;
      const soFar    = parseFloat(thisExam.questionsTotalMarks) || 0;
      if (declared > 0 && soFar + marks > declared + 0.001) {
        btn.disabled = false; btn.textContent = 'Add Question';
        return alert(`Adding ${marks} mark(s) would exceed the exam total.\nAlready used: ${soFar} / ${declared} marks.\nRemaining: ${+(declared - soFar).toFixed(2)} marks.`);
      }
    }
  } catch (_) { /* non-fatal — let the server catch it */ }

  const data = { exam_id: examId, question_text: questionText, question_type: type, marks, difficulty_level: difficulty, order_index: orderIndex };

  let correct_answer = '';
  if (type === 'MCQ') {
    const correctRadio = document.querySelector('#mcq-options-list input[name=mcq_correct]:checked');
    if (!correctRadio) {
      btn.disabled = false; btn.textContent = 'Add Question';
      return alert('Please select the correct answer option.');
    }
    correct_answer = correctRadio.value;
    MCQ_LABELS.forEach(lbl => {
      const inp = document.querySelector(`#mcq-options-list input[name=option_${lbl.toLowerCase()}]`);
      data[`option_${lbl.toLowerCase()}`] = inp?.value.trim() || null;
    });
  } else if (type === 'TRUE_FALSE') {
    correct_answer = document.getElementById('q-tf-answer').value;
  } else {
    correct_answer = document.getElementById('q-sa-answer')?.value.trim() || '';
  }
  data.correct_answer = correct_answer || null;

  try {
    await apiPost('/api/questions', data);
    buildQuestions();
    buildExams();

    const examData = await api('/api/exams');
    const thisExam = examData.exams.find(ex => ex.id === examId);
    const qTotal   = thisExam?.questionsTotalMarks ?? '?';
    const declared = thisExam?.totalMarks ?? _addQExamTotalMarks ?? '?';
    const qCount   = thisExam?.questions ?? '?';
    const match    = typeof qTotal === 'number' && typeof declared === 'number' && Math.abs(qTotal - declared) <= 0.01;

    // Reset fields manually (no form.reset() — just clear the inputs)
    document.getElementById('q-text').value = '';
    document.getElementById('q-type').value = 'MCQ';
    document.getElementById('q-marks').value = '5';
    document.getElementById('q-order').value = '0';
    renderMcqOptions(2);
    toggleMcqOptions('MCQ');

    const statusColor = match ? 'var(--green)' : 'var(--orange)';
    const statusMsg   = match
      ? `✓ ${qCount} question${qCount !== 1 ? 's' : ''} · ${qTotal}/${declared} marks — marks match! You can open the exam now.`
      : `${qCount} question${qCount !== 1 ? 's' : ''} · ${qTotal}/${declared} marks — keep adding until total matches.`;

    const statusBar = document.getElementById('q-add-status');
    if (statusBar) {
      statusBar.innerHTML = `<div style="background:var(--bg3);border:1px solid ${statusColor};border-radius:6px;padding:8px 12px;font-size:12px;color:${statusColor};margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <span>${statusMsg}</span>
        <button type="button" class="btn ${match ? 'btn-primary' : 'btn-outline'}" style="font-size:11px;padding:4px 12px;white-space:nowrap" onclick="closeModal()">
          ${match ? 'Done — Open Exam' : 'Done for now'}
        </button>
      </div>`;
    }

    btn.disabled = false;
    btn.textContent = 'Add Question';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Add Question';
    alert('Failed to add question: ' + err.message);
  }
}

async function deleteQuestion(id) {
  if (!confirm('Delete this question? All student answers for it will also be removed.')) return;
  try {
    await apiDelete(`/api/questions/${id}`);
    buildQuestions();
    buildExams();
  } catch (err) {
    alert('Failed to delete question: ' + err.message);
  }
}

// ── Proctor: Warn Student ─────────────────────────────────────
async function warnStudent(attemptId, studentName) {
  const severity = prompt(`Severity for warning to ${studentName}:\nLOW / MEDIUM / HIGH / CRITICAL`, 'HIGH');
  if (!severity) return;
  const sev = severity.trim().toUpperCase();
  if (!['LOW','MEDIUM','HIGH','CRITICAL'].includes(sev)) { alert('Invalid severity.'); return; }
  const message = prompt(`Warning message to ${studentName}:`, 'Suspicious behaviour detected. Please focus on your exam only.');
  if (!message) return;
  try {
    await apiPost('/api/proctor/warn', { attempt_id: attemptId, severity: sev, message });
    alert(`Warning sent to ${studentName}.`);
  } catch (err) {
    alert('Failed to send warning: ' + err.message);
  }
}

// ── Proctor: Kick Student ─────────────────────────────────────
async function kickStudent(attemptId, studentName) {
  if (!confirm(`Remove ${studentName} from the exam?\nThis will end their attempt immediately.`)) return;
  const reason = prompt('Reason for removal (shown in logs):', 'Removed by proctor due to critical violations.');
  if (reason === null) return;
  try {
    await apiPost(`/api/proctor/kick/${attemptId}`, { reason });
    alert(`${studentName} has been removed from the exam.`);
    buildFlagged();
    buildDashboard();
  } catch (err) {
    alert('Failed to remove student: ' + err.message);
  }
}

// ── Resolve Flag ──────────────────────────────────────────────
async function resolveFlag(flagId) {
  const notes = prompt('Resolution notes (press Cancel to abort):', 'Reviewed by admin. No action required.');
  if (notes === null) return;
  try {
    await apiPost(`/api/flags/${flagId}/resolve`, { notes });
    buildFlagged();
    buildDashboard();
  } catch (err) {
    alert('Failed to resolve flag: ' + err.message);
  }
}

// ── Exam Taking ───────────────────────────────────────────────
let examState = null;  // { attempt_id, exam, questions, answers:{}, timerInterval }

async function startExam(examId, examTitle) {
  if (!currentUser) { alert('Please log in first.'); return; }
  if (!confirm(`Start "${examTitle}"?\n\nThe timer begins immediately. Make sure you are ready.`)) return;

  try {
    const data = await apiPost(`/api/exams/${examId}/start`, {});
    examState = {
      attempt_id: data.attempt_id,
      exam:       data.exam,
      questions:  data.questions,
      answers:    {},
    };
    currentAttemptId = data.attempt_id;
    renderExamOverlay();
    startExamTimer();
    startWarningPolling();
    document.documentElement.requestFullscreen().catch(() => {});
  } catch (err) {
    alert('Could not start exam: ' + err.message);
  }
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
  let remaining  = totalSec;

  const timerEl   = document.getElementById('exam-timer');
  const progressEl = document.getElementById('exam-progress-fill');

  function tick() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const pct = Math.round(((totalSec - remaining) / totalSec) * 100);
    progressEl.style.width = pct + '%';

    timerEl.classList.remove('warning', 'danger');
    if (remaining <= 60)       timerEl.classList.add('danger');
    else if (remaining <= 300) timerEl.classList.add('warning');

    if (remaining <= 0) {
      clearInterval(examState.timerInterval);
      submitExam(true);
    } else {
      remaining--;
    }
  }
  tick();
  examState.timerInterval = setInterval(tick, 1000);
}

async function saveAnswer(questionId, selectedOption) {
  if (!examState) return;
  const startTs = examState.answers[questionId]?.ts || Date.now();
  const timeTaken = Math.round((Date.now() - startTs) / 1000);

  examState.answers[questionId] = { selected: selectedOption, ts: Date.now() };
  updateAnsweredBadge();

  // Highlight card as answered
  const card = document.querySelector(`.exam-question-card[data-qid="${questionId}"]`);
  if (card) card.classList.add('answered');
  const numEl = card && card.querySelector('.exam-q-num');
  if (numEl) numEl.textContent = 'ok';

  try {
    await apiPost(`/api/attempts/${examState.attempt_id}/answer`, {
      question_id:       questionId,
      selected_option:   selectedOption,
      time_taken_seconds: timeTaken,
    });
  } catch { /* fail silently — answer stored locally */ }
}

function updateAnsweredBadge() {
  if (!examState) return;
  const total    = examState.questions.length;
  const answered = Object.keys(examState.answers).length;
  document.getElementById('exam-answered-badge').textContent =
    `${answered} / ${total} answered`;
}

async function submitExam(autoSubmit = false) {
  if (!examState) return;
  if (!autoSubmit) {
    const answered = Object.keys(examState.answers).length;
    const total    = examState.questions.length;
    const unanswered = total - answered;
    if (unanswered > 0 && !confirm(`You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`)) return;
  }

  const btn = document.getElementById('exam-submit-btn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  if (examState.timerInterval) clearInterval(examState.timerInterval);

  try {
    const result = await apiPost(`/api/attempts/${examState.attempt_id}/submit`, {});
    currentAttemptId = null;
    examState = null;
    stopWarningPolling();
    document.getElementById('exam-overlay').classList.remove('active');
    document.getElementById('exam-warning-banner').classList.remove('visible');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    showExamResult(result);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Submit Exam';
    alert('Submission failed: ' + err.message);
    startExamTimer();
  }
}

function showExamResult(result) {
  const passed = result.passed;
  const color  = passed ? 'var(--green)' : 'var(--red)';
  document.getElementById('result-box').innerHTML = `
    <div class="result-icon" style="color:${color}">${passed ? 'PASS' : 'FAIL'}</div>
    <div class="result-score" style="color:${color}">${result.score} / ${result.total_marks}</div>
    <div class="result-pct">${result.percentage}% · ${passed ? 'PASS' : 'FAIL'}</div>
    <div class="result-grid">
      <div class="result-item">
        <div class="result-item-label">Your Score</div>
        <div class="result-item-value" style="color:${color}">${result.score}</div>
      </div>
      <div class="result-item">
        <div class="result-item-label">Pass Mark</div>
        <div class="result-item-value">${result.passing_marks}</div>
      </div>
      <div class="result-item">
        <div class="result-item-label">Total Marks</div>
        <div class="result-item-value">${result.total_marks}</div>
      </div>
      <div class="result-item">
        <div class="result-item-label">Percentage</div>
        <div class="result-item-value">${result.percentage}%</div>
      </div>
    </div>
    <button type="button" class="btn btn-primary" style="width:100%"
      onclick="closeExamResult()">Back to Dashboard</button>`;
  document.getElementById('result-overlay').classList.add('active');
}

function closeExamResult() {
  document.getElementById('result-overlay').classList.remove('active');
  const dest = defaultPage();
  showPage(dest);
  if (canAccess('dashboard'))    buildDashboard();
  if (canAccess('student-view')) buildStudentView();
  if (canAccess('results'))      buildResults();
}

// ── Live proctoring event detection ───────────────────────────
// Set this to an active attempt_id when a student starts an exam.
// Events are silently logged to the DB via /api/proctor-event.
let currentAttemptId = null;

async function logProctoringEvent(eventType, severity, details) {
  if (!currentAttemptId) return;
  // Must use apiPost (not raw fetch) so x-session-token header is included.
  // Without auth the server returns 401 and the event is silently dropped.
  try {
    await apiPost('/api/proctor-event', {
      attempt_id: currentAttemptId, event_type: eventType, severity, details,
    });
  } catch { /* fail silently — never disrupt the exam */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) logProctoringEvent('TAB_SWITCH', 'MEDIUM', 'Tab hidden or window switched');
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement)
    logProctoringEvent('FULLSCREEN_EXIT', 'LOW', 'Exited fullscreen mode during exam');
});

document.addEventListener('paste', () => {
  logProctoringEvent('COPY_PASTE_DETECTED', 'HIGH', 'Paste event detected in exam window');
});

document.addEventListener('contextmenu', e => {
  if (currentAttemptId) {
    e.preventDefault();
    logProctoringEvent('RIGHT_CLICK_ATTEMPT', 'LOW', 'Right-click blocked during exam');
  }
});

// ── DevTools detection ────────────────────────────────────────
(function detectDevTools() {
  let devtoolsOpen = false;
  setInterval(() => {
    const threshold = 160;
    const open = window.outerWidth - window.innerWidth > threshold ||
                 window.outerHeight - window.innerHeight > threshold;
    if (open && !devtoolsOpen) {
      devtoolsOpen = true;
      logProctoringEvent('DEVTOOLS_OPENED', 'HIGH', 'Browser DevTools detected open during exam');
    } else if (!open) {
      devtoolsOpen = false;
    }
  }, 1500);
})();

// ── Proctor warning + kick polling ───────────────────────────
let _warningSince = new Date().toISOString();
let _warningInterval = null;

function startWarningPolling() {
  _warningSince = new Date().toISOString();
  _warningInterval = setInterval(async () => {
    if (!currentAttemptId) { stopWarningPolling(); return; }
    try {
      const data = await (await fetch(`/api/attempts/${currentAttemptId}/warnings?since=${encodeURIComponent(_warningSince)}`)).json();

      if (data.kicked) {
        stopWarningPolling();
        if (examState?.timerInterval) clearInterval(examState.timerInterval);
        examState = null;
        currentAttemptId = null;
        document.getElementById('exam-overlay').classList.remove('active');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        alert('You have been removed from this exam by a proctor.');
        showPage(defaultPage());
        return;
      }

      if (data.warnings?.length) {
        const latest = data.warnings[data.warnings.length - 1];
        const severityLabel = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'HIGH', CRITICAL: 'CRITICAL' }[latest.severity] || latest.severity;
        document.getElementById('exam-warning-text').textContent =
          `[${severityLabel}] ${latest.message}`;
        document.getElementById('exam-warning-banner').classList.add('visible');
        _warningSince = new Date(latest.logged_at).toISOString();
      }
    } catch { /* poll failures are silent */ }
  }, 8000);
}

function stopWarningPolling() {
  if (_warningInterval) { clearInterval(_warningInterval); _warningInterval = null; }
}

// ── Progress bar entrance animation ──────────────────────────
function animateProgressBars() {
  document.querySelectorAll('.progress-fill').forEach(bar => {
    const w = bar.style.width;
    bar.style.width = '0';
    setTimeout(() => { bar.style.width = w; }, 50);
  });
}

// ── Live clock ────────────────────────────────────────────────
function updateClock() {
  const timeStr = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const el = document.querySelector('.topbar-actions span');
  if (el) el.textContent = `● DB Connected · ExamProctor · ${timeStr}`;
}

// ── Bootstrap: build sidebar nav, kick off all API fetches ────
document.addEventListener('DOMContentLoaded', () => {
  showPage('dashboard');

  // Close modal when clicking the dark backdrop
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Try to restore session from localStorage so reload doesn't force re-login
  if (restoreSession()) {
    onLoginSuccess();
  } else {
    // Show login overlay — pages are fetched after successful login
    document.getElementById('login-overlay').classList.add('active');
  }

  setInterval(updateClock, 1000);
  updateClock();
});

// Called after successful login to fetch all page data
function bootstrapPages() {
  buildClassroom(); // always build first — it's the landing page for every role
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
