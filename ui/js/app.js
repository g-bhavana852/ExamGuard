// ─────────────────────────────────────────────────────────────
//  APP.JS  —  Navigation, page assembly, clock.
//  All content is fetched from the Express API (server/server.js).
//  Render functions live in components.js.
// ─────────────────────────────────────────────────────────────

// ── Static UI structure (not stored in the DB) ────────────────
const PAGE_TITLES = {
  dashboard:      'Dashboard',
  monitor:        'Live Monitor',
  exams:          'Exams',
  questions:      'Question Bank',
  'student-view': 'Student View',
  flagged:        'Flagged Attempts',
  logs:           'Proctor Logs',
  analytics:      'Analytics',
  schema:         'DB Schema',
  results:        'Exam Results',
};

const NAV_SECTIONS = [
  { section: 'Overview', items: [
    { id: 'dashboard',    icon: '📊', label: 'Dashboard'        },
    { id: 'monitor',      icon: '👁️', label: 'Live Monitor'     },
  ]},
  { section: 'Exam', items: [
    { id: 'exams',        icon: '📝', label: 'Exams'            },
    { id: 'questions',    icon: '❓', label: 'Questions'        },
    { id: 'student-view', icon: '🎓', label: 'Student View'     },
  ]},
  { section: 'Proctoring', items: [
    { id: 'flagged',      icon: '🚩', label: 'Flagged Attempts' },
    { id: 'logs',         icon: '📋', label: 'Proctor Logs'     },
    { id: 'analytics',    icon: '📈', label: 'Analytics'        },
  ]},
  { section: 'System', items: [
    { id: 'schema',       icon: '🗄️', label: 'DB Schema'        },
    { id: 'results',      icon: '🏆', label: 'Exam Results'      },
  ]},
];

// ── Navigation ────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    if ((n.getAttribute('onclick') || '').includes("'" + id + "'"))
      n.classList.add('active');
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
}

// ── API helpers ───────────────────────────────────────────────
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
        <p style="color:var(--red);font-weight:600">⚠ Failed to load ${endpoint}</p>
        <p style="color:var(--text3);font-size:13px;margin-top:8px">${esc(msg)}</p>
        <p style="color:var(--text3);font-size:12px;margin-top:12px">
          Make sure the server is running:<br>
          <code style="background:var(--bg3);padding:4px 8px;border-radius:4px">cd server &amp;&amp; npm install &amp;&amp; node server.js</code>
        </p>
      </div>
    </div>`;
}

// ── Page builders (each fetches its own API endpoint) ─────────
async function buildDashboard() {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/dashboard');
    el.innerHTML = `
      ${renderStatCards(d.stats)}
      <div class="two-col">
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">🚨 Active Alerts</span>
              <span class="topbar-status">Real-time</span>
            </div>
            <div class="card-body" style="padding:16px">
              ${renderAlerts(d.alerts)}
            </div>
          </div>
        </div>
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">📊 Exam Funnel — DBMS Mid-Term</span>
            </div>
            <div class="card-body">
              <div style="display:flex;flex-direction:column;gap:14px">
                ${renderFunnel(d.funnel)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📊 Score Distribution — DBMS Mid-Term</span>
          <span class="topbar-status">Q03 Analytical Query</span>
        </div>
        <div class="card-body">${renderScoreChart(d.scoreChart)}</div>
      </div>`;
    animateProgressBars();
  } catch (err) {
    el.innerHTML = errorHtml('dashboard', err.message);
  }
}

async function buildMonitor() {
  const el = document.getElementById('page-monitor');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/monitor');
    el.innerHTML = `
      <div style="margin-bottom:20px">
        <div class="alert alert-yellow"><span>⚡</span><span>${d.examAlert}</span></div>
      </div>
      <div class="monitor-grid">${renderMonitorCards(d.students)}</div>`;
    animateProgressBars();
  } catch (err) {
    el.innerHTML = errorHtml('monitor', err.message);
  }
}

async function buildFlagged() {
  const el = document.getElementById('page-flagged');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/flagged');
    const flagged   = d.attempts.filter(a => a.statusText.includes('Flagged')).length;
    const timedOut  = d.attempts.filter(a => a.statusText.includes('Timed')).length;
    const unresolved = d.flags.filter(f => !f.resolved).length;
    el.innerHTML = `
      <div style="margin-bottom:20px">
        <p style="color:var(--text3);font-size:13px">Sorted by composite risk score (Q02 analytical query). Suspicion score threshold: 40+.</p>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">🚩 Flagged Attempts — DBMS Mid-Term (Exam 1)</span>
          <div style="display:flex;gap:8px">
            <span class="badge badge-red">${flagged} Flagged</span>
            <span class="badge badge-yellow">${timedOut} Timed Out</span>
          </div>
        </div>
        ${renderFlaggedTable(d.attempts)}
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">🏷️ Open Suspicion Flags</span>
          <span class="badge badge-red">${unresolved} unresolved</span>
        </div>
        ${renderFlagsTable(d.flags)}
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('flagged attempts', err.message);
  }
}

async function buildLogs() {
  const el = document.getElementById('page-logs');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/logs');
    el.innerHTML = `
      <div style="margin-bottom:20px;display:flex;gap:12px;align-items:center">
        <span class="topbar-status">Showing:</span>
        <span class="badge badge-red">${esc(d.badge)}</span>
      </div>
      <div class="two-col">
        <div class="card" style="margin-bottom:0">
          <div class="card-header">
            <span class="card-title">📋 Proctor Event Timeline</span>
            <span class="topbar-status">${d.risk.totalEvents} events · ${esc(d.risk.duration)}</span>
          </div>
          ${renderTimeline(d.timeline)}
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="card-title">🎯 Risk Summary</span></div>
            <div class="card-body" style="text-align:center">
              ${renderRiskSummary(d.risk)}
            </div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('proctor logs', err.message);
  }
}

async function buildStudentView() {
  const el = document.getElementById('page-student-view');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/student-view');
    el.innerHTML = `
      <div style="margin-bottom:4px;font-size:13px;color:var(--text3)">
        Logged in as: ${esc(d.label)}
      </div>
      <div class="exam-grid" style="margin-bottom:24px">
        ${renderExamCards(d.exams)}
      </div>`;
    animateProgressBars();
  } catch (err) {
    el.innerHTML = errorHtml('student view', err.message);
  }
}

async function buildAnalytics() {
  const el = document.getElementById('page-analytics');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/analytics');
    el.innerHTML = `
      ${renderStatCards(d.stats)}
      <div class="two-col">
        <div class="card">
          <div class="card-header"><span class="card-title">🧪 Question Difficulty (Q04)</span></div>
          ${renderDifficultyTable(d.difficulty)}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">🏆 Class Ranking (Q10)</span></div>
          ${renderRankingTable(d.ranking)}
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('analytics', err.message);
  }
}

async function buildSchema() {
  const el = document.getElementById('page-schema');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/schema');
    el.innerHTML = `
      <div style="margin-bottom:20px">
        <p style="color:var(--text3);font-size:13px">
          Database: <strong>ExamProctor</strong> · Engine: InnoDB ·
          ${d.tables.length} Tables · Normalization: 3NF / BCNF ·
          <em>Live metadata from INFORMATION_SCHEMA</em>
        </p>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">🗄️ Tables &amp; Row Counts</span></div>
        ${renderSchemaTable(d.tables)}
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header"><span class="card-title">⚡ Triggers (${d.triggers.length})</span></div>
          <div class="card-body" style="padding:0">${renderTriggersTable(d.triggers)}</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">🔄 Stored Procedures (${d.procedures.length})</span></div>
          <div class="card-body" style="padding:0">${renderProceduresTable(d.procedures)}</div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('DB schema', err.message);
  }
}

async function buildResults() {
  const el = document.getElementById('page-results');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/results');
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">📊 Exam Results — ${esc(d.student)}</span>
        </div>
        <div class="card-body">${renderResults(d)}</div>
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('results', err.message);
  }
}

async function buildExams() {
  const el = document.getElementById('page-exams');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/exams');
    const total     = d.exams.length;
    const upcoming  = d.exams.filter(e => e.statusText.includes('Upcoming')).length;
    const active    = d.exams.filter(e => e.statusText.includes('Active')).length;
    const completed = d.exams.filter(e => e.statusText.includes('Completed')).length;
    el.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <span class="badge badge-gray">${total} Total</span>
        <span class="badge badge-green">${active} Active</span>
        <span class="badge badge-purple">${upcoming} Upcoming</span>
        <span class="badge badge-gray">${completed} Completed</span>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📝 All Exams</span>
          <span class="topbar-status">Live from DB · Exams table</span>
        </div>
        ${renderExamsTable(d.exams)}
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml('exams', err.message);
  }
}

async function buildQuestions() {
  const el = document.getElementById('page-questions');
  el.innerHTML = loadingHtml();
  try {
    const d = await api('/api/questions');
    const total = d.groups.reduce((sum, g) => sum + g.questions.length, 0);
    el.innerHTML = `
      <div style="margin-bottom:16px;font-size:13px;color:var(--text3)">
        ${total} questions across ${d.groups.length} exams · Correct answer shown in
        <strong style="color:var(--green)">green</strong> (admin view)
      </div>
      ${renderQuestionsGroups(d.groups)}`;
  } catch (err) {
    el.innerHTML = errorHtml('questions', err.message);
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
        <button type="submit" class="btn btn-primary" id="exam-submit-btn">Create Exam</button>
      </div>
    </form>`);
}

async function submitCreateExam(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById('exam-submit-btn');
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
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await apiErrMsg(res));
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
    const res = await fetch(`/api/exams/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await apiErrMsg(res));
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
    correct_answer:   form.correct_answer.value.trim().toUpperCase(),
    difficulty_level: form.difficulty_level.value,
    order_index:      parseInt(form.order_index.value) || 0,
  };

  try {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await apiErrMsg(res));
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
    const res = await fetch(`/api/questions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await apiErrMsg(res));
    buildQuestions();
    buildExams();
  } catch (err) {
    alert('Failed to delete question: ' + err.message);
  }
}

// ── Resolve Flag ──────────────────────────────────────────────
async function resolveFlag(flagId) {
  const notes = prompt('Resolution notes (press Cancel to abort):', 'Reviewed by admin. No action required.');
  if (notes === null) return;
  try {
    const res = await fetch(`/api/flags/${flagId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    if (!res.ok) throw new Error(await apiErrMsg(res));
    buildFlagged();
    buildDashboard();
  } catch (err) {
    alert('Failed to resolve flag: ' + err.message);
  }
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
  if (el) el.textContent = `🟢 DB Connected · ExamProctor · ${timeStr}`;
}

// ── Bootstrap: build sidebar nav, kick off all API fetches ────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.nav').innerHTML = renderNav(NAV_SECTIONS);
  showPage('dashboard');

  // Close modal when clicking the dark backdrop
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Fetch all pages in parallel — each updates its own container
  buildDashboard();
  buildMonitor();
  buildExams();
  buildQuestions();
  buildFlagged();
  buildLogs();
  buildStudentView();
  buildAnalytics();
  buildSchema();
  buildResults();

  setInterval(updateClock, 1000);
  updateClock();
});
