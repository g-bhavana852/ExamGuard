// ─────────────────────────────────────────────────────────────
//  APP.JS  —  Navigation, page assembly, clock.
//  All content is fetched from the Express API (server/server.js).
//  Render functions live in components.js.
// ─────────────────────────────────────────────────────────────

// ── Current user state ────────────────────────────────────────
let currentUser  = null;   // { user_id, full_name, email, username, role, roles[] }
let sessionToken = null;   // LoginSessions.session_token

// ── Page metadata ─────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:      'Dashboard',
  monitor:        'Live Monitor',
  courses:        'Courses',
  exams:          'Exams',
  questions:      'Question Bank',
  'student-view': 'My Exams',
  flagged:        'Flagged Attempts',
  logs:           'Proctor Logs',
  analytics:      'Analytics',
  schema:         'DB Schema',
  results:        'Exam Results',
};

// Which roles can see each page. Admin always sees everything.
const PAGE_ROLES = {
  dashboard:      ['admin'],
  monitor:        ['admin', 'proctor'],
  courses:        ['admin', 'instructor'],
  exams:          ['admin', 'instructor'],
  questions:      ['admin', 'instructor'],
  'student-view': ['student'],
  flagged:        ['admin', 'proctor'],
  logs:           ['admin', 'proctor'],
  analytics:      ['admin', 'instructor'],
  schema:         ['admin'],
  results:        ['admin', 'instructor', 'student'],
};

// All possible nav items — filtered per-role at login time
const ALL_NAV = [
  { section: 'Overview',   id: 'dashboard',    icon: '◈', label: 'Dashboard'        },
  { section: 'Overview',   id: 'monitor',      icon: '◉', label: 'Live Monitor'     },
  { section: 'Manage',     id: 'courses',      icon: '◧', label: 'Courses'          },
  { section: 'Manage',     id: 'exams',        icon: '▤', label: 'Exams'            },
  { section: 'Manage',     id: 'questions',    icon: '?', label: 'Questions'        },
  { section: 'Manage',     id: 'student-view', icon: '⊙', label: 'My Exams'        },
  { section: 'Proctoring', id: 'flagged',      icon: '⚑', label: 'Flagged Attempts' },
  { section: 'Proctoring', id: 'logs',         icon: '≡', label: 'Proctor Logs'     },
  { section: 'Proctoring', id: 'analytics',    icon: '≈', label: 'Analytics'        },
  { section: 'System',     id: 'schema',       icon: '⊞', label: 'DB Schema'        },
  { section: 'System',     id: 'results',      icon: '★', label: 'Exam Results'     },
];

// ── Role helpers ──────────────────────────────────────────────
function hasRole(r)        { return !!currentUser?.roles?.includes(r); }
function canAccess(pageId) { return !!(currentUser?.roles?.some(r => PAGE_ROLES[pageId]?.includes(r))); }

// First accessible page for the logged-in user (used for logo click / default route)
function defaultPage() {
  if (!currentUser) return 'dashboard';
  const order = ['student-view','dashboard','monitor','courses','exams','results'];
  return order.find(p => canAccess(p)) || 'dashboard';
}

// Build NAV_SECTIONS filtered to what the current user can see
function buildNavSections() {
  const visible = ALL_NAV.filter(item => canAccess(item.id));
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

async function api(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await apiErrMsg(res));
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await apiErrMsg(res));
  return res.json();
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

// Show "Also a Proctor" checkbox only when Teacher is selected
function onRoleChange(radio) {
  document.getElementById('also-proctor-wrap')
    .classList.toggle('hidden', radio.value !== 'instructor');
}

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
  if (primaryRole === 'instructor' && form.also_proctor && form.also_proctor.checked)
    roles.push('proctor');

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
    onLoginSuccess();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

async function doLogout() {
  if (sessionToken) {
    fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken }),
    }).catch(() => {});
  }
  currentUser      = null;
  sessionToken     = null;
  currentAttemptId = null;
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
  if (hasRole('instructor') || hasRole('admin')) {
    btns += `<button type="button" class="btn btn-primary" onclick="showCreateExamModal()">+ New Exam</button>`;
    btns += `<button type="button" class="btn btn-outline" onclick="showCreateCourseModal()">+ Course</button>`;
  }
  if (hasRole('admin'))
    btns += `<button type="button" class="btn btn-outline" onclick="window.location='/api/export'">Export</button>`;
  document.getElementById('topbar-actions').innerHTML =
    `<span class="topbar-status" id="topbar-status">● ExamGuard</span>${btns}`;
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
        <div class="card-header"><span class="card-title">Exam Funnel — DBMS Mid-Term</span></div>
        <div class="card-body">
          <div style="display:flex;flex-direction:column;gap:14px">${renderFunnel(d.funnel)}</div>
        </div>
      </div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Score Distribution — DBMS Mid-Term</span>
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

function buildFlagged() {
  return buildPage('flagged', '/api/flagged', d => {
    const flagged    = d.attempts.filter(a => a.statusText.includes('Flagged')).length;
    const timedOut   = d.attempts.filter(a => a.statusText.includes('Timed')).length;
    const unresolved = d.flags.filter(f => !f.resolved).length;
    const live       = d.attempts.filter(a => a.isLive).length;
    return `
      <div style="margin-bottom:20px">
        <p style="color:var(--text3);font-size:13px">All exams · sorted by suspicion score (Q02). ${live > 0 ? `<span style="color:var(--red)">${live} currently in-progress.</span>` : ''}</p>
      </div>
      <div class="card">
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
  });
}

function buildLogs() {
  return buildPage('logs', '/api/logs', d => `
    <div style="margin-bottom:20px;display:flex;gap:12px;align-items:center">
      <span class="topbar-status">Showing:</span>
      <span class="badge badge-red">${esc(d.badge)}</span>
    </div>
    <div class="two-col">
      <div class="card" style="margin-bottom:0">
        <div class="card-header">
          <span class="card-title">Proctor Event Timeline</span>
          <span class="topbar-status">${d.risk.totalEvents} events · ${esc(d.risk.duration)}</span>
        </div>
        ${renderTimeline(d.timeline)}
      </div>
      <div><div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">Risk Summary</span></div>
        <div class="card-body" style="text-align:center">${renderRiskSummary(d.risk)}</div>
      </div></div>
    </div>`);
}

function buildStudentView() {
  const studentId = currentUser && currentUser.role === 'student' ? currentUser.user_id : null;
  const endpoint  = studentId ? `/api/student-view?student_id=${studentId}` : '/api/student-view';
  return buildPage('student-view', endpoint, d => `
    <div style="margin-bottom:4px;font-size:13px;color:var(--text3)">Logged in as: ${esc(d.label)}</div>
    <div class="exam-grid" style="margin-bottom:24px">${renderExamCards(d.exams)}</div>`, true);
}

function buildAnalytics() {
  return buildPage('analytics', '/api/analytics', d => `
    ${renderStatCards(d.stats)}
    <div class="two-col">
      <div class="card">
        <div class="card-header"><span class="card-title">Question Difficulty (Q04)</span></div>
        ${renderDifficultyTable(d.difficulty)}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Class Ranking (Q10)</span></div>
        ${renderRankingTable(d.ranking)}
      </div>
    </div>`, true);
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

function buildResults() {
  return buildPage('results', '/api/results', d => `
    <div class="card">
      <div class="card-header"><span class="card-title">Exam Results — ${esc(d.student)}</span></div>
      <div class="card-body">${renderResults(d)}</div>
    </div>`);
}

function buildExams() {
  return buildPage('exams', '/api/exams', d => {
    const total     = d.exams.length;
    const upcoming  = d.exams.filter(e => e.statusText.includes('Upcoming')).length;
    const active    = d.exams.filter(e => e.statusText.includes('Active')).length;
    const completed = d.exams.filter(e => e.statusText.includes('Completed')).length;
    return `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <span class="badge badge-gray">${total} Total</span>
        <span class="badge badge-green">${active} Active</span>
        <span class="badge badge-purple">${upcoming} Upcoming</span>
        <span class="badge badge-gray">${completed} Completed</span>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">All Exams</span>
          <span class="topbar-status">Live from DB · Exams table</span>
        </div>
        ${renderExamsTable(d.exams)}
      </div>`;
  });
}

function buildQuestions() {
  return buildPage('questions', '/api/questions', d => {
    const total = d.groups.reduce((sum, g) => sum + g.questions.length, 0);
    return `
      <div style="margin-bottom:16px;font-size:13px;color:var(--text3)">
        ${total} questions across ${d.groups.length} exams · Correct answer shown in
        <strong style="color:var(--green)">green</strong> (admin view)
      </div>
      ${renderQuestionsGroups(d.groups)}`;
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
  const opts = instructors.map(i =>
    `<option value="${i.user_id}">${esc(i.full_name)} &lt;${esc(i.email)}&gt;</option>`
  ).join('');

  showModal('Create New Course', `
    <form id="course-form" onsubmit="submitCreateCourse(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Course Code</label>
          <input type="text" name="course_code" required placeholder="e.g. CS401" maxlength="20" />
        </div>
        <div class="form-group">
          <label>Instructor</label>
          <select name="instructor_id" required>${opts}</select>
        </div>
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

  const opts = courses.map(c =>
    `<option value="${c.course_id}">${esc(c.course_code)} — ${esc(c.course_name)}</option>`
  ).join('');

  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const fmt  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tomorrow = new Date(now.getTime() + 24*60*60*1000);
  const nextWeek  = new Date(now.getTime() + 8*24*60*60*1000);

  showModal('Create New Exam', `
    <form id="exam-form" onsubmit="submitCreateExam(event)">
      <div class="form-group">
        <label>Course</label>
        <select name="course_id" required>${opts}</select>
      </div>
      <div class="form-group">
        <label>Exam Title</label>
        <input type="text" name="title" required placeholder="e.g. DBMS Mid-Term Exam" />
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
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
          <label>Window Start</label>
          <input type="datetime-local" name="window_start" required value="${fmt(tomorrow)}" />
        </div>
        <div class="form-group">
          <label>Window End</label>
          <input type="datetime-local" name="window_end" required value="${fmt(nextWeek)}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Max Attempts</label>
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
        <label class="form-check">
          <input type="checkbox" name="is_published" checked /> Publish Now
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
    window_start:             toDatetime(form.window_start.value),
    window_end:               toDatetime(form.window_end.value),
    max_attempts:             parseInt(form.max_attempts.value),
    shuffle_questions:        form.shuffle_questions.checked,
    show_results_immediately: form.show_results_immediately.checked,
    is_published:             form.is_published.checked,
  };

  try {
    await apiPost('/api/exams', data);
    closeModal();
    showPage('exams');
    buildExams();
    buildDashboard();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Create Exam';
    alert('Failed to create exam: ' + err.message);
  }
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
function showAddQuestionModal(examId, examTitle) {
  showModal(`Add Question — ${examTitle}`, `
    <form id="question-form" onsubmit="submitAddQuestion(event)">
      <input type="hidden" name="exam_id" value="${examId}" />
      <div class="form-group">
        <label>Question Text</label>
        <textarea name="question_text" required rows="3" placeholder="Enter the question…"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Type</label>
          <select name="question_type" onchange="toggleMcqOptions(this.value)">
            <option value="MCQ">MCQ</option>
            <option value="TRUE_FALSE">True / False</option>
            <option value="SHORT_ANSWER">Short Answer</option>
          </select>
        </div>
        <div class="form-group">
          <label>Marks</label>
          <input type="number" name="marks" required min="0.5" step="0.5" value="5" />
        </div>
        <div class="form-group">
          <label>Difficulty</label>
          <select name="difficulty_level">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div class="form-group">
          <label>Order #</label>
          <input type="number" name="order_index" value="0" min="0" />
        </div>
      </div>
      <div id="mcq-options-block">
        <div class="form-row">
          <div class="form-group">
            <label>Option A</label>
            <input type="text" name="option_a" placeholder="Option A" />
          </div>
          <div class="form-group">
            <label>Option B</label>
            <input type="text" name="option_b" placeholder="Option B" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Option C</label>
            <input type="text" name="option_c" placeholder="Option C" />
          </div>
          <div class="form-group">
            <label>Option D</label>
            <input type="text" name="option_d" placeholder="Option D" />
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Correct Answer</label>
        <input type="text" name="correct_answer" required
          placeholder="MCQ: A / B / C / D   |   True/False: TRUE / FALSE" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="question-submit-btn">Add Question</button>
      </div>
    </form>`);
}

function toggleMcqOptions(type) {
  const el = document.getElementById('mcq-options-block');
  if (el) el.style.display = type === 'MCQ' ? '' : 'none';
}

async function submitAddQuestion(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById('question-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  const type = form.question_type.value;
  const data = {
    exam_id:          parseInt(form.exam_id.value),
    question_text:    form.question_text.value.trim(),
    question_type:    type,
    marks:            parseFloat(form.marks.value),
    option_a:         type === 'MCQ' ? (form.option_a.value.trim() || null) : null,
    option_b:         type === 'MCQ' ? (form.option_b.value.trim() || null) : null,
    option_c:         type === 'MCQ' ? (form.option_c.value.trim() || null) : null,
    option_d:         type === 'MCQ' ? (form.option_d.value.trim() || null) : null,
    correct_answer:   type === 'SHORT_ANSWER'
                        ? form.correct_answer.value.trim()
                        : form.correct_answer.value.trim().toUpperCase(),
    difficulty_level: form.difficulty_level.value,
    order_index:      parseInt(form.order_index.value) || 0,
  };

  try {
    await apiPost('/api/questions', data);
    closeModal();
    buildQuestions();
    buildExams();
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
    const data = await apiPost(`/api/exams/${examId}/start`, { student_id: currentUser.user_id });
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
  showPage('dashboard');
  buildDashboard();
  buildStudentView();
  buildAnalytics();
}

// ── Live proctoring event detection ───────────────────────────
// Set this to an active attempt_id when a student starts an exam.
// Events are silently logged to the DB via /api/proctor-event.
let currentAttemptId = null;

async function logProctoringEvent(eventType, severity, details) {
  if (!currentAttemptId) return;
  try {
    await fetch('/api/proctor-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt_id: currentAttemptId, event_type: eventType, severity, details }),
    });
  } catch { /* fail silently — don't disrupt the exam */ }
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

  // Show login overlay — pages are fetched after successful login
  document.getElementById('login-overlay').classList.add('active');

  setInterval(updateClock, 1000);
  updateClock();
});

// Called after successful login to fetch all page data
function bootstrapPages() {
  buildDashboard();
  // Monitor is SSE-driven — built on demand by showPage('monitor')
  buildCourses();
  buildExams();
  buildQuestions();
  buildFlagged();
  buildLogs();
  buildStudentView();
  buildAnalytics();
  buildSchema();
  buildResults();
}
