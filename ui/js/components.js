// ─────────────────────────────────────────────────────────────
//  COMPONENTS.JS  —  Pure render functions. Data in → HTML out.
// ─────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Wrap header + row HTML into a <table>
const mkTable = (thHtml, trHtml) =>
  `<table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table>`;

// Render a badge span
const bdg = (cls, text) => `<span class="badge ${cls}">${esc(String(text))}</span>`;

// ── Sidebar Navigation ────────────────────────────────────────
function renderNav(sections) {
  return sections.map(sec => `
    <div class="nav-section">${esc(sec.section)}</div>
    ${sec.items.map(item => `
      <div class="nav-item" onclick="showPage('${item.id}')">
        <span class="icon">${item.icon}</span> ${esc(item.label)}
      </div>`).join('')}
  `).join('');
}

// ── Stat Cards Grid ───────────────────────────────────────────
// Handles both dashboard cards (with icon) and analytics cards (no icon, optional valueColor).
function renderStatCards(stats) {
  const cards = stats.map(s => `
    <div class="stat-card ${s.color}"${s.page ? ` onclick="showPage('${s.page}')" style="cursor:pointer" title="Go to ${s.page}"` : ''}>
      ${s.icon ? `<div class="stat-icon">${s.icon}</div>` : ''}
      <div class="stat-label">${esc(s.label)}</div>
      <div class="stat-value"${s.valueColor ? ` style="color:${s.valueColor}"` : ''}>${esc(String(s.value))}</div>
      <div class="stat-sub">${esc(s.sub)}</div>
    </div>`).join('');
  return `<div class="stats-grid">${cards}</div>`;
}

// ── Active Alerts ─────────────────────────────────────────────
function renderAlerts(alerts) {
  return alerts.map(a => `
    <div class="alert alert-${a.type}">
      <div>
        <strong>${esc(a.name)}</strong> — ${esc(a.msg)}
        ${a.action ? `
          <div style="margin-top:4px">
            <button class="btn btn-outline" style="font-size:11px;padding:4px 10px"
              onclick="showPage('${a.action.page}')">${esc(a.action.label)}</button>
          </div>` : ''}
      </div>
    </div>`).join('');
}

// ── Exam Completion Funnel ────────────────────────────────────
function renderFunnel(rows) {
  return rows.map(r => `
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px">
        <span>${esc(r.label)}</span><strong>${esc(r.value)}</strong>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${r.fill}" style="width:${r.pct}%"></div>
      </div>
    </div>`).join('');
}

// ── Score Distribution Bar Chart ──────────────────────────────
function renderScoreChart({ bars, summary }) {
  const barsHtml = bars.map(b => `
    <div class="bar-col">
      <div class="bar-val">${b.val}</div>
      <div class="bar" style="height:${b.pct}%;background:${b.color}"></div>
      <div class="bar-lbl">${esc(b.label)}</div>
    </div>`).join('');
  const summaryHtml = summary.map(s =>
    `<span>${esc(s.label)}: <strong${s.color ? ` style="color:${s.color}"` : ''}>${esc(s.value)}</strong></span>`
  ).join('');
  return `
    <div class="bar-chart" style="height:150px">${barsHtml}</div>
    <div style="display:flex;gap:24px;margin-top:12px;font-size:12px;color:var(--text3)">${summaryHtml}</div>`;
}

// ── Live Monitor Cards ────────────────────────────────────────
function renderMonitorCards(students) {
  return students.map(s => {
    const dotClass  = s.status === 'flagged' ? 'flagged' : '';
    const suspIcon  = s.suspicion === 0 ? '' : ((s.note || '').startsWith('—') ? '[!!] ' : '[!] ');
    const indicators = s.indicators.map(i =>
      `<span class="indicator ${i.cls}"${i.style ? ` style="${i.style}"` : ''}>${i.text}</span>`
    ).join('\n          ');
    const cardPage = s.status === 'flagged' ? 'logs' : s.status === 'warning' ? 'flagged' : 'student-view';
    return `
      <div class="monitor-card ${s.status}" onclick="showPage('${cardPage}')" style="cursor:pointer" title="Click to view details">
        <div class="live-dot ${dotClass}"></div>
        <div class="student-name">${esc(s.name)}</div>
        <div class="answered">Answered ${s.answered} · ${s.elapsed} min elapsed</div>
        <div class="timer-bar">
          <div class="timer-label"><span>Time</span><span>${esc(s.timeLeft)}</span></div>
          <div class="progress-bar">
            <div class="progress-fill ${s.timerFill}" style="width:${s.timerPct}%"></div>
          </div>
        </div>
        <div class="monitor-indicators" style="margin-top:10px">
          ${indicators}
        </div>
        <div style="margin-top:10px;font-size:12px;color:${s.suspColor}">
          ${suspIcon}Suspicion Score: <strong>${s.suspicion}</strong>${s.note ? ' ' + esc(s.note) : ''}
        </div>
        <div style="margin-top:10px;display:flex;gap:6px" onclick="event.stopPropagation()">
          <button type="button" class="btn btn-outline" style="flex:1;font-size:11px;padding:5px 8px"
            onclick="warnStudent(${s.attempt_id},'${esc(s.name)}')">Warn</button>
          <button type="button" class="btn btn-danger" style="flex:1;font-size:11px;padding:5px 8px"
            onclick="kickStudent(${s.attempt_id},'${esc(s.name)}')">Kick</button>
        </div>
      </div>`;
  }).join('');
}

// ── Flagged Attempts Table ────────────────────────────────────
function suspFillClass(color) {
  if (color === 'var(--green)')  return 'fill-green';
  if (color === 'var(--yellow)') return 'fill-yellow';
  return 'fill-red';
}

function renderFlaggedTable(attempts) {
  return mkTable(
    `<th>Student</th><th>Exam</th><th>Status</th>
     <th>Suspicion</th><th>Tab Sw.</th><th>Copy-Paste</th>
     <th>Fullscreen</th><th>Rapid Ans.</th><th>Multi-Login</th>
     <th>Score</th><th>Actions</th>`,
    attempts.map(a => `<tr>
      <td>
        <div style="font-weight:600">${esc(a.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(a.email)}</div>
        ${a.ipAddress ? `<div style="font-size:10px;color:var(--text3);font-family:monospace">${esc(a.ipAddress)}</div>` : ''}
      </td>
      <td style="font-size:12px;color:var(--text3);max-width:120px">${esc(a.examTitle || '—')}</td>
      <td>${bdg(a.statusBadge, a.statusText)}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:${a.suspColor}">${a.suspicion}</div>
        <div class="progress-bar" style="width:60px"><div class="progress-fill ${suspFillClass(a.suspColor)}" style="width:${a.suspicion}%"></div></div>
      </div></td>
      <td style="text-align:center;color:${a.tabColor};font-weight:${a.tabs >= 3 ? '700' : '400'}">${a.tabs}</td>
      <td style="text-align:center;color:${a.pasteColor};font-weight:${a.paste >= 3 ? '700' : '400'}">${a.paste}</td>
      <td style="text-align:center;color:${a.fullscreenColor}">${a.fullscreen}</td>
      <td style="text-align:center;color:${a.rapidColor}" title="Avg seconds per question — under 15s is suspicious">${esc(a.rapidAvg)}</td>
      <td style="text-align:center;color:${a.multiLoginColor};font-weight:${a.multiLogin !== '—' ? '700' : '400'}">${esc(a.multiLogin)}</td>
      <td>${esc(a.score)} <span class="badge ${a.scoreBadge}" style="font-size:10px">${esc(a.scoreText)}</span></td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button type="button" class="btn btn-outline" style="font-size:11px;padding:5px 8px" onclick="showPage('logs')">Logs</button>
        ${a.openFlags !== '0 open' ? `<span class="badge badge-red" style="font-size:10px;align-self:center">${esc(a.openFlags)}</span>` : ''}
        ${a.isLive ? `<button type="button" class="btn btn-outline" style="font-size:11px;padding:5px 8px;color:var(--yellow)" onclick="warnStudent(${a.attemptId},'${esc(a.name)}')">Warn</button>` : ''}
        ${a.isLive ? `<button type="button" class="btn btn-danger" style="font-size:11px;padding:5px 8px" onclick="kickStudent(${a.attemptId},'${esc(a.name)}')">Kick</button>` : ''}
      </td>
    </tr>`).join('')
  );
}

// ── Suspicion Flags Table ─────────────────────────────────────
function renderFlagsTable(flags) {
  return mkTable(
    '<th>Flag ID</th><th>Student</th><th>Exam</th><th>Flag Type</th><th>Description</th><th>Detected</th><th>Status</th><th>Action</th>',
    flags.map(f => `<tr>
      <td style="color:var(--text3)">${esc(f.id)}</td>
      <td>${esc(f.student)}</td>
      <td style="font-size:11px;color:var(--text3)">${esc(f.examTitle || '—')}</td>
      <td>${bdg(f.badge, f.type)}</td>
      <td style="font-size:12px;color:var(--text3);max-width:200px">${esc(f.desc)}</td>
      <td style="font-size:12px;color:var(--text3)">${esc(f.time)}</td>
      <td>${f.resolved ? bdg('badge-green', 'Resolved') : bdg('badge-red', 'Open')}</td>
      <td>${f.resolved
        ? `<span style="font-size:12px;color:var(--text3)">By ${esc(f.resolvedBy)}</span>`
        : `<button type="button" class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="resolveFlag(${f.numId})">Resolve</button>`}</td>
    </tr>`).join('')
  );
}

// ── Proctor Event Timeline ────────────────────────────────────
function renderTimeline(events) {
  const items = events.map(e => `
    <div class="tl-item">
      <div class="tl-dot ${e.dot}">${e.icon}</div>
      <div class="tl-content">
        <div class="tl-title">${esc(e.title)}</div>
        <div class="tl-detail">${esc(e.detail)}</div>
      </div>
      <div class="tl-time">${esc(e.time)}</div>
    </div>`).join('');
  return `<div class="timeline">${items}</div>`;
}

// ── Risk Summary — SVG ring + metrics grid ────────────────────
function renderRiskSummary(risk) {
  const circ   = 2 * Math.PI * 56;
  const offset = circ * (1 - risk.score / 100);
  const metrics = risk.metrics.map(m => `
    <div style="background:var(--bg3);padding:10px;border-radius:8px">
      <div style="font-size:11px;color:var(--text3)">${esc(m.label)}</div>
      <div style="font-size:20px;font-weight:700;color:${m.color}">${esc(String(m.value))}</div>
    </div>`).join('');
  return `
    <svg width="140" height="140" viewBox="0 0 140 140" style="display:block;margin:0 auto 16px">
      <circle cx="70" cy="70" r="56" fill="none" stroke="var(--bg3)" stroke-width="10"/>
      <circle cx="70" cy="70" r="56" fill="none" stroke="var(--red)" stroke-width="10"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        stroke-linecap="round" transform="rotate(-90 70 70)"/>
      <text x="70" y="65" text-anchor="middle" fill="var(--red)" font-size="28" font-weight="700">${risk.score}</text>
      <text x="70" y="83" text-anchor="middle" fill="var(--text3)" font-size="11">/100</text>
      <text x="70" y="100" text-anchor="middle" fill="var(--text3)" font-size="10">Suspicion Score</text>
    </svg>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left">
      ${metrics}
    </div>`;
}

// ── Course Cards (Courses page) ───────────────────────────────
function renderCourseCards(courses, currentUserId) {
  if (!courses.length) return `
    <div class="card" style="grid-column:1/-1">
      <div class="card-body" style="padding:32px;text-align:center;color:var(--text3)">
        No courses yet. Click <strong>+ New Course</strong> to add one.
      </div>
    </div>`;
  return courses.map(c => {
    const isOwner = !currentUserId || c.instructor_id === currentUserId;
    return `
    <div class="course-card">
      <div class="course-card-code">${esc(c.course_code)}</div>
      <div class="course-card-name">${esc(c.course_name)}</div>
      <div class="course-card-desc">${esc(c.description || 'No description provided.')}</div>
      <div class="course-card-meta">
        <span>Instructor: <strong>${esc(c.instructor)}</strong></span>
        ${c.exam_count != null ? `<span>Exams: <strong>${c.exam_count}</strong></span>` : ''}
        ${c.student_count != null ? `<span>Students: <strong>${c.student_count}</strong></span>` : ''}
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-outline" style="font-size:11px;padding:5px 10px;flex:1"
          onclick="showPage('exams')">View Exams</button>
        ${isOwner ? `
        <button type="button" class="btn btn-outline" style="font-size:11px;padding:5px 10px"
          onclick="showEditCourseModal(${c.course_id}, '${esc(c.course_name)}', '${esc(c.description || '')}')">Edit</button>
        <button type="button" class="btn btn-danger" style="font-size:11px;padding:5px 10px"
          data-cid="${c.course_id}" data-cname="${esc(c.course_name)}"
          onclick="deleteCourse(this.dataset.cid, this.dataset.cname)">Deactivate</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Exam Questions (Exam Taking overlay) ──────────────────────
function renderExamQuestions(questions) {
  if (!questions.length) return `<p style="color:var(--text3);text-align:center;padding:40px">No questions found for this exam.</p>`;
  return questions.map((q, i) => {
    const options = buildOptions(q);
    return `
      <div class="exam-question-card" data-qid="${q.question_id}">
        <div class="exam-q-header">
          <div class="exam-q-num">${i + 1}</div>
          <div>
            <div class="exam-q-text">${esc(q.question_text)}</div>
            <div class="exam-q-marks">${q.marks} mark${q.marks !== 1 ? 's' : ''} · ${esc(q.difficulty_level)}</div>
          </div>
        </div>
        <div class="exam-options">${options}</div>
      </div>`;
  }).join('');
}

function buildOptions(q) {
  if (q.question_type === 'MCQ') {
    return ['A','B','C','D','E','F','G','H','I','J']
      .map(l => ({ letter: l, text: q[`option_${l.toLowerCase()}`] }))
      .filter(o => o.text)
      .map(o => `
      <label class="exam-option" onclick="saveAnswer(${q.question_id}, '${o.letter}')">
        <input type="radio" name="q${q.question_id}" value="${o.letter}" style="pointer-events:none" />
        <strong>${o.letter}.</strong> ${esc(o.text)}
      </label>`).join('');
  }
  if (q.question_type === 'TRUE_FALSE') {
    return ['TRUE', 'FALSE'].map(v => `
      <label class="exam-option" onclick="saveAnswer(${q.question_id}, '${v}')">
        <input type="radio" name="q${q.question_id}" value="${v}" style="pointer-events:none" />
        ${v === 'TRUE' ? 'True' : 'False'}
      </label>`).join('');
  }
  // SHORT_ANSWER
  return `
    <input type="text" placeholder="Type your answer…"
      style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;
             padding:10px 14px;color:var(--text);font-size:13px"
      onchange="saveAnswer(${q.question_id}, this.value)" />`;
}

// ── Student Exam Cards ────────────────────────────────────────
function renderExamCards(exams) {
  return exams.map(e => {
    let actionHtml;
    if (e.action.startExam) {
      actionHtml = `<button type="button" class="btn ${e.action.cls}" style="flex:1;font-size:12px"
        data-eid="${e.action.examId}" data-etitle="${esc(e.title)}"
        onclick="startExam(this.dataset.eid, this.dataset.etitle)">${esc(e.action.label)}</button>`;
    } else if (e.action.viewResult) {
      actionHtml = `<button type="button" class="btn ${e.action.cls}" style="flex:1;font-size:12px"
        onclick="showStudentOwnResult(${e.action.attemptId})">${esc(e.action.label)}</button>`;
    } else if (e.action.page) {
      actionHtml = `<button type="button" class="btn ${e.action.cls}" style="flex:1;font-size:12px"
        onclick="showPage('${e.action.page}')">${esc(e.action.label)}</button>`;
    } else {
      actionHtml = `<button type="button" class="btn ${e.action.cls}" style="flex:1;font-size:12px"
        disabled>${esc(e.action.label)}</button>`;
    }
    return `
    <div class="exam-card">
      <div class="exam-card-top">
        <div>
          <h3>${esc(e.title)}</h3>
          <div class="course">${esc(e.course)}</div>
        </div>
        <span class="badge ${e.statusBadge}">${e.statusText}</span>
      </div>
      <div class="exam-meta">
        <div class="exam-meta-item"><strong>${e.marks}</strong> Total Marks</div>
        <div class="exam-meta-item"><strong>${esc(e.duration)}</strong> Duration</div>
        <div class="exam-meta-item"><strong>${esc(e.questions)}</strong></div>
      </div>
      ${e.scoreLine ? `
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span style="color:var(--text3)">Your Score</span>
            <strong style="color:${e.scoreColor}">${esc(e.scoreLine)}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${e.fill}" style="width:${e.pct}%"></div>
          </div>
        </div>` : `
        <div style="margin-top:8px;font-size:12px;color:var(--text3)">${esc(e.note)}</div>`}
      <div class="exam-actions">${actionHtml}</div>
    </div>`;
  }).join('');
}

// ── Question Difficulty Table ─────────────────────────────────
function renderDifficultyTable(rows) {
  return mkTable(
    '<th>#</th><th>Question</th><th>Correct%</th><th>Avg Time</th><th>Rating</th>',
    rows.map(r => `<tr>
      <td>${esc(r.q)}</td><td style="font-size:12px">${esc(r.topic)}</td>
      <td style="color:${r.pctColor}">${esc(r.pct)}</td>
      <td>${esc(r.time)}</td><td>${bdg(r.badge, r.rating)}</td>
    </tr>`).join('')
  );
}

// ── Class Ranking Table ───────────────────────────────────────
function renderRankingTable(rows) {
  return mkTable(
    '<th>Rank</th><th>Student</th><th>Avg%</th><th>Pass</th><th>Suspicion</th>',
    rows.map(r => `<tr onclick="showPage('${r.flag ? 'flagged' : 'logs'}')" style="cursor:pointer">
      <td><strong>${esc(r.rank)}</strong></td>
      <td>${esc(r.name)}${r.flag ? ` <span class="badge badge-red" style="font-size:10px">Flagged</span>` : ''}</td>
      <td style="color:${r.pctColor}">${esc(r.pct)}</td>
      <td>${bdg(r.passBadge, r.passText)}</td>
      <td style="color:${r.suspColor}">${r.susp}</td>
    </tr>`).join('')
  );
}

// ── DB Schema — Tables overview ───────────────────────────────
function renderSchemaTable(tables) {
  return mkTable(
    '<th>#</th><th>Table</th><th>Rows (sample)</th><th>Entity Type</th><th>Key Constraints</th>',
    tables.map(t => `<tr>
      <td>${t.num}</td><td><strong>${esc(t.name)}</strong></td>
      <td>${t.rows}</td><td>${bdg(t.entityBadge, t.entity)}</td>
      <td>${esc(t.constraints)}</td>
    </tr>`).join('')
  );
}

// ── Triggers Table ────────────────────────────────────────────
function renderTriggersTable(triggers) {
  return mkTable(
    '<th>Trigger</th><th>Event</th><th>Purpose</th>',
    triggers.map(t => `<tr>
      <td style="font-size:11px;color:var(--accent2)">${esc(t.name)}</td>
      <td>${esc(t.event)}</td><td style="font-size:12px">${esc(t.purpose)}</td>
    </tr>`).join('')
  );
}

// ── Stored Procedures Table ───────────────────────────────────
function renderProceduresTable(procedures) {
  return mkTable(
    '<th>Procedure</th><th>Called By</th>',
    procedures.map(p => `<tr>
      <td style="font-size:11px;color:var(--green)">${esc(p.name)}</td>
      <td style="font-size:12px">${esc(p.calledBy)}</td>
    </tr>`).join('')
  );
}

// ── Exams Page ────────────────────────────────────────────────
function renderExamsTable(exams) {
  const rows = exams.map(e => `
    <tr>
      <td>
        <div style="font-weight:600">${esc(e.title)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(e.course)}</div>
      </td>
      <td style="font-size:12px;color:var(--text3)">${esc(e.instructor)}</td>
      <td><span class="badge ${e.statusBadge}">${e.statusText}</span></td>
      <td style="font-size:12px">${esc(e.window)}</td>
      <td style="text-align:center">${e.questions}</td>
      <td style="text-align:center">${esc(String(e.marks))} <span style="color:var(--text3);font-size:11px">pass</span></td>
      <td style="text-align:center">${esc(e.duration)}</td>
      <td style="text-align:center">${e.attempts}</td>
      <td style="text-align:center;color:var(--text3)">${e.flagged > 0 ? `<span style="color:var(--red)">${e.flagged}</span>` : '0'}</td>
      <td style="text-align:center">${e.avgScore !== '—' ? `${e.avgScore}%` : '—'}</td>
      <td style="text-align:center">${esc(e.passRate)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${(e.isDraft || e.isUpcoming) ? `<button class="btn btn-primary" style="font-size:11px;padding:4px 8px"
            data-exam-id="${e.id}" data-exam-title="${esc(e.title)}" data-exam-dur="${e.duration}"
            onclick="openExam(this.dataset.examId,this.dataset.examTitle,this.dataset.examDur)">Open</button>` : ''}
          ${e.isActive ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 8px"
            data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
            onclick="closeExam(this.dataset.examId,this.dataset.examTitle)">End Exam</button>` : ''}
          <button class="btn btn-outline" style="font-size:11px;padding:4px 8px"
            onclick="showPage('analytics')">Analytics</button>
          <button class="btn btn-outline" style="font-size:11px;padding:4px 8px"
            onclick="showPage('flagged')">Attempts</button>
          <button class="btn btn-outline" style="font-size:11px;padding:4px 8px"
            data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
            onclick="showAddQuestionModal(this.dataset.examId, this.dataset.examTitle)">+ Question</button>
          <button class="btn btn-danger" style="font-size:11px;padding:4px 8px"
            data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
            onclick="deleteExam(this.dataset.examId, this.dataset.examTitle)">Delete</button>
        </div>
      </td>
    </tr>`).join('');
  return `
    <table>
      <thead><tr>
        <th>Exam</th><th>Instructor</th><th>Status</th><th>Window</th>
        <th style="text-align:center">Qs</th><th style="text-align:center">Pass Marks</th>
        <th style="text-align:center">Duration</th><th style="text-align:center">Attempts</th>
        <th style="text-align:center">Flagged</th><th style="text-align:center">Avg%</th>
        <th style="text-align:center">Pass Rate</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── My Exams — Teacher card grid ─────────────────────────────
// Called by buildExams() in app.js
function renderMyExamCards(exams, isTeacher) {
  return `<div class="exam-grid">${exams.map(e => {

    // ── Draft notice — no questions or marks mismatch ─────────
    const noQuestions = e.questions === 0;
    let draftNotice = '';
    if (isTeacher && e.isDraft) {
      if (noQuestions) {
        draftNotice = `<div style="background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.4);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--orange);margin-bottom:10px">
          ⚠ No questions yet — add at least one question before opening.
          <button class="btn" style="margin-left:8px;padding:2px 10px;font-size:11px;background:var(--orange);color:#fff"
            data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
            onclick="showAddQuestionModal(this.dataset.examId, this.dataset.examTitle)">+ Add Question</button>
        </div>`;
      } else if (e.marksMismatch) {
        draftNotice = `<div style="background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.4);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--orange);margin-bottom:10px">
          ⚠ Marks mismatch — questions total <strong>${e.questionsTotalMarks}</strong> but exam declares <strong>${e.totalMarks}</strong>. Fix before opening.
        </div>`;
      }
    } else if (isTeacher && !e.isDraft && e.marksMismatch && e.questions > 0) {
      draftNotice = `<div style="background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.35);border-radius:6px;padding:6px 10px;font-size:11px;color:var(--orange);margin-bottom:10px">
        ⚠ Declared ${e.totalMarks} marks — questions sum to ${e.questionsTotalMarks}.
      </div>`;
    }

    // ── Join code block ───────────────────────────────────────
    const hasCode = e.joinCode && (e.isActive || e.isUpcoming);
    const codeBlock = hasCode
      ? `<div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:10px 14px;margin-bottom:10px;text-align:center">
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:6px">
            ${e.isActive ? 'Exam Code — Share with students' : 'Exam Code — Scheduled, opens ' + e.window.split('→')[0].trim()}
          </div>
          <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:var(--accent2);font-family:monospace;cursor:pointer;line-height:1.1"
            onclick="copyCode('${esc(e.joinCode)}')" title="Click to copy">${esc(e.joinCode)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">
            ${e.isActive
              ? `Click to copy · <span style="color:var(--green)">${e.liveCount} student${e.liveCount !== 1 ? 's' : ''} live now</span>`
              : 'Click to copy · Share in advance'}
          </div>
        </div>`
      : '';

    // ── Stats row ─────────────────────────────────────────────
    const qColor = e.questions === 0 ? 'var(--orange)' : 'inherit';
    const mColor = e.marksMismatch ? 'var(--orange)' : 'inherit';
    const statsHtml = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;font-size:11px;text-align:center">
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Questions</div>
          <div style="font-weight:700;font-size:14px;color:${qColor}">${e.questions}</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Duration</div>
          <div style="font-weight:700;font-size:14px">${e.duration}m</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Marks (Q/Total)</div>
          <div style="font-weight:700;font-size:13px;color:${mColor}">${e.questionsTotalMarks}/${e.totalMarks}</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Attempts</div>
          <div style="font-weight:700;font-size:14px">${e.attempts}</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Avg Score</div>
          <div style="font-weight:700;font-size:14px">${e.avgScore !== '—' ? e.avgScore + '%' : '—'}</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:6px 4px">
          <div style="color:var(--text3)">Pass Rate</div>
          <div style="font-weight:700;font-size:14px;color:${e.passRate !== '—' ? 'var(--green)' : 'var(--text3)'}">${esc(e.passRate)}</div>
        </div>
      </div>`;

    // ── Action buttons ────────────────────────────────────────
    const actionButtons = isTeacher
      ? e.isEnded
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
            <button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
              data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
              onclick="showExamQuestions(this.dataset.examId, this.dataset.examTitle)">Questions</button>
            <button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
              data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
              onclick="showExamResults(this.dataset.examId, this.dataset.examTitle)">Results</button>
          </div>`
        : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
            ${e.isDraft ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 10px"
                data-exam-id="${e.id}" data-exam-title="${esc(e.title)}" data-exam-dur="${e.duration}"
                onclick="openExam(this.dataset.examId,this.dataset.examTitle,this.dataset.examDur)">Open &amp; Get Code</button>` : ''}
            ${e.isActive ? `<button class="btn btn-danger" style="font-size:12px;padding:6px 10px"
                data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
                onclick="closeExam(this.dataset.examId,this.dataset.examTitle)">End Exam</button>` : ''}
            ${!e.isEnded ? `<button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
                data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
                onclick="showAddQuestionModal(this.dataset.examId, this.dataset.examTitle)">+ Question</button>` : ''}
            <button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
              data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
              onclick="showExamQuestions(this.dataset.examId, this.dataset.examTitle)">Questions</button>
            <button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
              data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
              onclick="showExamResults(this.dataset.examId, this.dataset.examTitle)">Results</button>
            <button class="btn btn-outline" style="font-size:12px;padding:6px 10px"
              onclick="showEditExamModal(${e.id}, '${esc(e.title)}', '${esc(e.descriptionRaw||'')}', ${e.passingMarksRaw||0}, ${e.durationRaw||0})">Edit</button>
            <button class="btn btn-danger" style="font-size:12px;padding:6px 10px;margin-left:auto"
              data-exam-id="${e.id}" data-exam-title="${esc(e.title)}"
              onclick="deleteExam(this.dataset.examId, this.dataset.examTitle)">Delete</button>
          </div>`
      : '';

    return `
      <div class="exam-card" style="display:flex;flex-direction:column;gap:0">
        <div class="exam-card-top" style="margin-bottom:10px">
          <div>
            <h3 style="margin:0 0 4px">${esc(e.title)}</h3>
            <div class="course" style="font-size:12px;color:var(--text3)">${esc(e.course)}</div>
          </div>
          <span class="badge ${e.statusBadge}">${e.statusText}${e.isActive ? ' ●' : ''}</span>
        </div>
        ${draftNotice}
        ${codeBlock}
        ${statsHtml}
        ${actionButtons}
      </div>`;
  }).join('')}</div>`;
}

// ── Brilliant Question Bank ────────────────────────────────────
// Called by buildQuestions() in app.js
// groups: [{ examId, examTitle, course, questions: [...] }]
// examMeta: { [examId]: { totalMarks, questionsTotalMarks, marksMismatch, duration, passRate, ... } }
function renderBrilliantQuestionBank(groups, examMeta) {
  return groups.map(g => {
    const meta = examMeta[g.examId];
    const totalMarks      = meta?.totalMarks ?? '?';
    const questionSum     = meta?.questionsTotalMarks ?? g.questions.reduce((s, q) => s + Number(q.marks), 0);
    const mismatch        = meta?.marksMismatch ?? (Math.abs(questionSum - totalMarks) > 0.01);
    const easyQs   = g.questions.filter(q => q.difficulty === 'easy');
    const medQs    = g.questions.filter(q => q.difficulty === 'medium');
    const hardQs   = g.questions.filter(q => q.difficulty === 'hard');
    const easyMks  = easyQs.reduce((s, q) => s + Number(q.marks), 0);
    const medMks   = medQs.reduce((s, q) => s + Number(q.marks), 0);
    const hardMks  = hardQs.reduce((s, q) => s + Number(q.marks), 0);

    const schemeBar = `
      <div style="background:var(--bg3);border-radius:8px;padding:12px 16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <div style="font-size:13px;font-weight:600">Marking Scheme</div>
          ${mismatch
            ? `<span style="font-size:11px;color:var(--orange);font-weight:600">
                ⚠ Declared ${totalMarks} marks · Questions sum to ${questionSum} — mismatch!
               </span>`
            : `<span style="font-size:11px;color:var(--green)">✓ ${questionSum} / ${totalMarks} marks accounted</span>`}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);border-radius:6px;padding:5px 10px;font-size:12px">
            <span style="color:var(--text3)">Easy</span> &nbsp;
            <strong>${easyQs.length}q · ${easyMks}m</strong>
          </div>
          <div style="background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);border-radius:6px;padding:5px 10px;font-size:12px">
            <span style="color:var(--text3)">Medium</span> &nbsp;
            <strong>${medQs.length}q · ${medMks}m</strong>
          </div>
          <div style="background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.25);border-radius:6px;padding:5px 10px;font-size:12px">
            <span style="color:var(--text3)">Hard</span> &nbsp;
            <strong>${hardQs.length}q · ${hardMks}m</strong>
          </div>
          <div style="background:var(--bg2);border-radius:6px;padding:5px 10px;font-size:12px;margin-left:auto">
            Total: <strong>${g.questions.length} questions · ${questionSum} marks</strong>
          </div>
        </div>
      </div>`;

    const questionCards = g.questions.map((q, idx) => {
      // Options display
      const optsHtml = q.type === 'MCQ'
        ? q.options.map(o => `
            <span style="display:inline-block;margin:2px 10px 2px 0;font-size:12px;
              ${o.letter === q.answer ? 'color:var(--green);font-weight:700' : 'color:var(--text3)'}">
              ${esc(o.letter)}. ${esc(o.text)}${o.letter === q.answer ? ' ✓' : ''}
            </span>`).join('')
        : q.type === 'TRUE_FALSE'
          ? `<span style="font-size:12px;color:var(--green)">Answer: ${esc(q.answer)}</span>`
          : `<span style="font-size:12px;color:var(--text3)">Short answer: <em>${esc(q.answer)}</em></span>`;

      const typeBadge = q.type === 'MCQ' ? 'badge-purple' : q.type === 'TRUE_FALSE' ? 'badge-blue' : 'badge-gray';
      const typeLabel = q.type === 'MCQ' ? 'MCQ' : q.type === 'TRUE_FALSE' ? 'T/F' : 'Short';

      return `
        <div style="background:var(--bg3);border-radius:8px;padding:12px 14px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
            <div style="display:flex;gap:8px;align-items:flex-start;flex:1;min-width:0">
              <div style="background:var(--bg2);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--text3);flex-shrink:0;margin-top:1px">${idx + 1}</div>
              <div style="font-size:13px;line-height:1.5;flex:1">${esc(q.text)}</div>
            </div>
            <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
              <span class="badge ${typeBadge}" style="font-size:10px">${typeLabel}</span>
              <span class="badge ${q.diffBadge}" style="font-size:10px">${esc(q.difficulty)}</span>
              <span class="badge badge-gray" style="font-size:11px;font-weight:700">${q.marks}m</span>
            </div>
          </div>
          <div style="margin-bottom:8px;padding-left:32px">${optsHtml}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-left:32px">
            <div style="display:flex;gap:14px;font-size:11px;color:var(--text3)">
              <span>Correct: <strong style="color:${q.pctColor}">${esc(q.correctPct)}</strong></span>
              <span>Avg time: <strong>${esc(q.avgTime)}</strong></span>
              <span>Answered: <strong>${q.answered}</strong></span>
            </div>
            <button class="btn btn-outline" style="font-size:11px;padding:3px 8px;margin-right:4px"
              onclick="showEditQuestionModal(${q.id})">Edit</button>
            <button class="btn btn-danger" style="font-size:11px;padding:3px 8px"
              onclick="deleteQuestion(${q.id})">Delete</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div>
            <span class="card-title">${esc(g.examTitle)}</span>
            <span style="margin-left:10px;font-size:12px;color:var(--text3)">${esc(g.course)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-gray">${g.questions.length} questions</span>
            <button class="btn btn-primary" style="font-size:12px;padding:6px 14px"
              data-exam-id="${g.examId}" data-exam-title="${esc(g.examTitle)}"
              onclick="showAddQuestionModal(this.dataset.examId, this.dataset.examTitle)">+ Add Question</button>
          </div>
        </div>
        <div class="card-body">
          ${schemeBar}
          ${questionCards}
        </div>
      </div>`;
  }).join('');
}

// ── Questions Page ────────────────────────────────────────────
function renderQuestionsGroups(groups) {
  if (!groups.length) {
    return `
      <div class="card">
        <div class="card-body" style="padding:32px;text-align:center">
          <p style="color:var(--text3);font-size:14px;margin-bottom:8px">No questions in the database yet.</p>
          <p style="color:var(--text3);font-size:12px">
            Go to <a href="#" onclick="showPage('exams');return false"
              style="color:var(--accent2);text-decoration:none">Exams</a>
            and click <strong>+ Question</strong> on any exam row to add questions.
          </p>
        </div>
      </div>`;
  }
  return groups.map(g => {
    const rows = g.questions.map(q => {
      const opts = q.options.map(o => `
        <span style="margin-right:12px${o.letter === q.answer ? ';color:var(--green);font-weight:700' : ';color:var(--text3)'}">
          ${esc(o.letter)}. ${esc(o.text)}${o.letter === q.answer ? ' [correct]' : ''}
        </span>`).join('');
      return `
        <tr>
          <td style="text-align:center;color:var(--text3)">Q${q.num}</td>
          <td>
            <div style="font-size:13px;margin-bottom:6px">${esc(q.text)}</div>
            <div style="font-size:11px;line-height:1.8">${opts}</div>
          </td>
          <td style="text-align:center"><span class="badge ${q.diffBadge}">${esc(q.difficulty)}</span></td>
          <td style="text-align:center">${q.marks}</td>
          <td style="text-align:center;color:${q.pctColor};font-weight:600">${esc(q.correctPct)}</td>
          <td style="text-align:center;color:var(--text3)">${esc(q.avgTime)}</td>
          <td style="text-align:center">
            <button class="btn btn-danger" style="font-size:11px;padding:4px 8px"
              onclick="deleteQuestion(${q.id})">Delete</button>
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${esc(g.examTitle)}</span>
          <div style="display:flex;align-items:center;gap:12px">
            <span class="topbar-status">${esc(g.course)} · ${g.questions.length} questions</span>
            <button class="btn btn-primary" style="font-size:12px;padding:6px 14px"
              data-exam-id="${g.examId}" data-exam-title="${esc(g.examTitle)}"
              onclick="showAddQuestionModal(this.dataset.examId, this.dataset.examTitle)">+ Add Question</button>
          </div>
        </div>
        <table>
          <thead><tr>
            <th style="text-align:center;width:40px">#</th>
            <th>Question &amp; Options</th>
            <th style="text-align:center">Difficulty</th>
            <th style="text-align:center">Marks</th>
            <th style="text-align:center">Correct%</th>
            <th style="text-align:center">Avg Time</th>
            <th style="text-align:center">Action</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

// ── Results Table (per-exam, all students) ─────────────────────
function renderResultsTable(students) {
  if (!students.length) return `<div class="card-body" style="color:var(--text3)">No results yet.</div>`;
  const rows = students.map(s => `
    <tr>
      <td>${esc(s.name)}</td>
      <td style="text-align:center">${esc(s.score)}</td>
      <td style="text-align:center">${esc(s.percentage)}</td>
      <td style="text-align:center">
        <span style="font-weight:700;color:${s.resultColor}">${esc(s.result)}</span>
      </td>
      <td style="text-align:center;color:var(--text3)">${esc(s.duration)}</td>
      <td style="text-align:center">
        <button type="button" class="btn btn-outline" style="font-size:11px;padding:4px 10px"
          onclick="showStudentDetail(${s.attempt_id}, this)">View</button>
      </td>
    </tr>
    <tr id="detail-row-${s.attempt_id}" style="display:none">
      <td colspan="6" style="padding:0">
        <div id="detail-${s.attempt_id}" style="padding:16px;background:var(--bg2)"></div>
      </td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>Student</th>
          <th style="text-align:center">Score</th>
          <th style="text-align:center">Percentage</th>
          <th style="text-align:center">Result</th>
          <th style="text-align:center">Duration</th>
          <th style="text-align:center">Detail</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Per-student question breakdown (used inline by showStudentDetail) ──
function renderStudentDetail(d) {
  const qRows = d.questions.map(q => `
    <tr>
      <td style="text-align:center;color:var(--text3)">Q${q.num}</td>
      <td style="max-width:320px;font-size:12px">${esc(q.text)}</td>
      <td style="text-align:center">${esc(String(q.answered))}</td>
      <td style="text-align:center;color:var(--green);font-weight:600">${esc(q.correct)}</td>
      <td style="text-align:center">
        ${q.answered === '—'
          ? `<span style="color:var(--text3)">Not answered</span>`
          : q.isCorrect
            ? `<span style="color:var(--green);font-weight:700">+${q.earned}</span>`
            : `<span style="color:var(--red)">0 / ${q.marks}</span>`}
      </td>
      <td style="text-align:center;color:var(--text3);font-size:12px">${q.timeSec != null ? `${q.timeSec}s` : '—'}</td>
    </tr>`).join('');
  return `
    <div style="display:flex;gap:24px;margin-bottom:12px;flex-wrap:wrap;font-size:13px">
      <span>Score: <strong>${esc(d.score)}</strong></span>
      <span>Percentage: <strong>${esc(d.percentage)}</strong></span>
      <span>Result: <strong style="color:${d.resultColor}">${esc(d.result)}</strong></span>
      <span>Duration: <strong>${esc(d.duration)}</strong></span>
    </div>
    <table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="text-align:center">#</th>
        <th>Question</th>
        <th style="text-align:center">Answered</th>
        <th style="text-align:center">Correct</th>
        <th style="text-align:center">Marks</th>
        <th style="text-align:center">Time</th>
      </tr></thead>
      <tbody>${qRows}</tbody>
    </table>`;
}

// ── Overall Class Ranking (Results tab) ───────────────────────
function renderClassRanking(ranking) {
  if (!ranking || !ranking.length)
    return `<div class="card-body" style="color:var(--text3);padding:16px">No ranking data yet.</div>`;
  const rows = ranking.map(r => `
    <tr>
      <td style="text-align:center;font-size:18px;font-weight:700;color:${r.pctColor}">#${r.rank}</td>
      <td>${esc(r.name)}</td>
      <td style="text-align:center;font-weight:700;color:${r.pctColor}">${esc(r.avgPct)}</td>
      <td style="text-align:center;color:var(--text3)">${esc(r.avgScore)}</td>
      <td style="text-align:center">${esc(r.examsPassed)}</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th style="text-align:center">Rank</th>
          <th>Student</th>
          <th style="text-align:center">Avg %</th>
          <th style="text-align:center">Avg Score</th>
          <th style="text-align:center">Exams Passed</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Proctor Actions (warns + kicks) ───────────────────────────
function renderProctorActions(actions) {
  if (!actions.length)
    return `<div class="card-body" style="color:var(--text3)">No proctor actions recorded yet.</div>`;
  const rows = actions.map(a => `
    <tr>
      <td><span style="font-weight:700;color:${a.color}">${esc(a.label)}</span></td>
      <td>${esc(a.student)}</td>
      <td style="color:var(--text3);font-size:12px">${esc(a.exam)}</td>
      <td>${esc(a.message)}</td>
      <td style="text-align:center"><span class="badge badge-gray" style="font-size:10px">${esc(a.severity)}</span></td>
      <td style="text-align:right;color:var(--text3);font-size:12px;white-space:nowrap">${esc(a.time)}</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>Action</th><th>Student</th><th>Exam</th>
          <th>Message / Reason</th><th style="text-align:center">Severity</th><th style="text-align:right">Time</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
