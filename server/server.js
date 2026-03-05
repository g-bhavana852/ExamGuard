// ============================================================
//  ExamProctor — Express + MySQL API Server
//  Reads all data from the ExamProctor MySQL database and
//  returns it in the shape expected by the frontend components.
//
//  Setup:
//    1. Load all SQL files into MySQL (01–06)
//    2. Set DB credentials below (or via environment variables)
//    3. cd server && npm install && node server.js
//    4. Open http://localhost:3000
// ============================================================

require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Serve the UI as static files ──────────────────────────────
app.use(express.static(path.join(__dirname, '../ui')));
app.use(express.json());

// ── MySQL connection pool ─────────────────────────────────────
const pool = mysql.createPool({
  host:            process.env.DB_HOST || 'localhost',
  user:            process.env.DB_USER || 'root',
  password:        process.env.DB_PASS || '',
  database:        process.env.DB_NAME || 'ExamProctor',
  connectionLimit: 10,
});

// ── Helpers ───────────────────────────────────────────────────
// Return CSS color variable for a suspicion score
function suspColor(score) {
  if (score >= 70) return 'var(--red)';
  if (score >= 40) return 'var(--orange)';
  if (score >= 10) return 'var(--yellow)';
  return 'var(--green)';
}

// Format a Date object as "Apr 1, 2026 · 09:00"
function fmtDate(d) {
  return new Date(d).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// Shorthand query that unwraps the rows array
async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ── GET /api/dashboard ────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    // ─ Summary counts ─
    const [[counts]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM Exams WHERE is_published = TRUE)                           AS total_exams,
        (SELECT COUNT(*) FROM Exams WHERE is_published = TRUE AND window_end  < NOW())   AS completed_exams,
        (SELECT COUNT(*) FROM Exams WHERE is_published = TRUE AND window_start > NOW())  AS upcoming_exams,
        (SELECT COUNT(*) FROM ExamAttempts)                                              AS total_attempts,
        (SELECT COUNT(*) FROM ExamAttempts WHERE status IN ('submitted','graded','flagged')) AS submitted_attempts,
        (SELECT COUNT(*) FROM ExamAttempts WHERE status = 'in_progress')                AS active_attempts,
        (SELECT COUNT(*) FROM SuspicionFlags WHERE is_resolved = FALSE)                 AS open_flags,
        (SELECT COUNT(*) FROM SuspicionFlags WHERE is_resolved = FALSE
           AND flag_type IN ('HIGH_SUSPICION_SCORE','MULTIPLE_LOGINS','IP_CHANGE_DURING_EXAM')) AS high_flags,
        (SELECT COUNT(*) FROM ExamAttempts WHERE status = 'flagged')                    AS flagged_count
    `);

    const flaggedNames = await q(
      `SELECT u.full_name FROM ExamAttempts ea
       JOIN Users u ON ea.student_id = u.user_id
       WHERE ea.status = 'flagged' ORDER BY ea.suspicion_score DESC LIMIT 3`
    );

    const mediumFlags = Math.max(0, counts.open_flags - counts.high_flags);

    const stats = [
      { color: 'purple', icon: '📝', label: 'Total Exams',
        value: counts.total_exams,
        sub:   `${counts.completed_exams} completed · ${counts.upcoming_exams} upcoming`,
        page:  'exams' },
      { color: 'green',  icon: '✅', label: 'Attempts Today',
        value: counts.total_attempts,
        sub:   `${counts.submitted_attempts} submitted · ${counts.active_attempts} in progress`,
        page:  'monitor' },
      { color: 'yellow', icon: '⚠️', label: 'Open Flags',
        value: counts.open_flags,
        sub:   `${counts.high_flags} high · ${mediumFlags} medium severity`,
        page:  'flagged' },
      { color: 'red',    icon: '🚨', label: 'Flagged Attempts',
        value: counts.flagged_count,
        sub:   flaggedNames.map(r => r.full_name).join(' · ') || 'None',
        page:  'flagged' },
    ];

    // ─ Alerts ─
    const alertRows = await q(`
      SELECT u.full_name, ea.suspicion_score, ea.tab_switches, ea.copy_paste_attempts,
             ea.face_not_detected, ea.status, ea.score, ex.total_marks, ea.attempt_id
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ea.suspicion_score > 0 OR ea.status IN ('flagged','timed_out')
      ORDER BY ea.suspicion_score DESC LIMIT 5`
    );

    const alerts = alertRows.map(r => {
      const sc   = r.suspicion_score;
      const type = sc >= 70 ? 'red' : sc >= 10 ? 'yellow' : 'green';
      const icon = sc >= 70 ? '🔴' : sc >= 10 ? '🟡' : '🟢';
      let msg;
      if (r.status === 'flagged') {
        const parts = [];
        if (r.tab_switches > 0)          parts.push(`${r.tab_switches} tab switches`);
        if (r.copy_paste_attempts > 0)   parts.push(`${r.copy_paste_attempts} copy-paste events`);
        if (r.face_not_detected > 0)     parts.push(`face not detected ${r.face_not_detected}×`);
        if (sc >= 70)                    parts.push(`suspicion score ${sc}/100`);
        msg = parts.join('. ') + `. Score ${r.score}/${r.total_marks}.`;
      } else if (r.status === 'timed_out') {
        msg = `Face not detected ${r.face_not_detected} times. Exam auto-submitted at time limit.`;
      } else {
        const pct = Math.round((r.score / r.total_marks) * 100);
        msg = `Exam completed cleanly. Score ${r.score}/${r.total_marks} (${pct}%). No suspicious events.`;
      }
      return {
        type, icon, name: r.full_name, msg,
        action: r.status === 'flagged' ? { label: 'View Logs', page: 'logs' }
               : sc >= 40             ? { label: 'Review',    page: 'flagged' }
               : null,
      };
    });

    // ─ Funnel (based on Q08) ─
    const [fRows] = await pool.query(`
      SELECT
        COUNT(DISTINCT enr.student_id)                            AS enrolled,
        COUNT(DISTINCT ea.student_id)                             AS started,
        SUM(ea.status IN ('submitted','graded','flagged'))         AS submitted,
        SUM(ea.status = 'timed_out')                              AS timed_out,
        SUM(ea.status = 'flagged')                                AS flagged,
        SUM(ea.score >= ex.passing_marks)                         AS passed,
        ex.passing_marks
      FROM Exams ex
      JOIN Enrollments enr ON ex.course_id = enr.course_id AND enr.status = 'active'
      LEFT JOIN ExamAttempts ea ON ex.exam_id = ea.exam_id
      WHERE ex.exam_id = 1
      GROUP BY ex.exam_id, ex.passing_marks`
    );
    const f = fRows[0] || { enrolled: 0, started: 0, submitted: 0, timed_out: 0, flagged: 0, passed: 0, passing_marks: 0 };

    const enr = f.enrolled || 1;
    const sub = f.submitted || 1;
    const pct = (n, d) => Math.round(((n || 0) / d) * 100);

    const funnel = [
      { label: 'Enrolled',               value: String(enr),                                         pct: 100,              fill: 'fill-purple' },
      { label: 'Started Exam',           value: `${f.started} (${pct(f.started, enr)}%)`,            pct: pct(f.started, enr),   fill: 'fill-purple' },
      { label: 'Submitted',              value: `${sub} (${pct(sub, enr)}%)`,                         pct: pct(sub, enr),         fill: 'fill-green'  },
      { label: 'Timed Out',              value: `${f.timed_out} (${pct(f.timed_out, enr)}%)`,         pct: pct(f.timed_out, enr), fill: 'fill-yellow' },
      { label: 'Flagged',                value: `${f.flagged} (${pct(f.flagged, enr)}%)`,             pct: pct(f.flagged, enr),   fill: 'fill-red'    },
      { label: `Passed (≥${f.passing_marks} marks)`,
        value: `${f.passed} (${pct(f.passed, sub)}% of submitted)`,
        pct: pct(f.passed, sub), fill: 'fill-green' },
    ];

    // ─ Score distribution (Q03) ─
    const [distRows] = await pool.query(`
      SELECT
        SUM(ea.percentage >= 90)              AS a_plus,
        SUM(ea.percentage BETWEEN 75 AND 89)  AS a,
        SUM(ea.percentage BETWEEN 60 AND 74)  AS b,
        SUM(ea.percentage BETWEEN 50 AND 59)  AS c,
        SUM(ea.percentage < 50)               AS f_grade,
        ROUND(AVG(ea.percentage), 1)          AS avg_pct,
        SUM(ea.score >= ex.passing_marks)     AS passed_count,
        COUNT(*)                              AS total,
        ex.total_marks
      FROM ExamAttempts ea
      JOIN Exams ex ON ea.exam_id = ex.exam_id
      WHERE ea.exam_id = 1 AND ea.status IN ('submitted','graded','flagged')
      GROUP BY ex.total_marks`
    );
    const dist = distRows[0] || { a_plus:0, a:0, b:0, c:0, f_grade:0, avg_pct:0, passed_count:0, total:0, total_marks:50 };

    const [topRow]    = await pool.query(`SELECT u.full_name, ea.score, ea.status FROM ExamAttempts ea JOIN Users u ON ea.student_id=u.user_id WHERE ea.exam_id=1 AND ea.status IN ('submitted','graded','flagged') ORDER BY ea.percentage DESC LIMIT 1`);
    const [bottomRow] = await pool.query(`SELECT u.full_name, ea.score, ea.status FROM ExamAttempts ea JOIN Users u ON ea.student_id=u.user_id WHERE ea.exam_id=1 AND ea.status IN ('submitted','graded','flagged') ORDER BY ea.percentage ASC  LIMIT 1`);
    const top    = topRow[0];
    const bottom = bottomRow[0];

    const vals   = [dist.a_plus, dist.a, dist.b, dist.c, dist.f_grade].map(Number);
    const maxVal = Math.max(...vals, 1);
    const barPct = v => Math.max(5, Math.round((v / maxVal) * 100));

    const scoreChart = {
      bars: [
        { val: dist.a_plus,  pct: barPct(dist.a_plus),  color: 'var(--accent)',  label: 'A+ ≥90%'  },
        { val: dist.a,       pct: barPct(dist.a),        color: 'var(--green)',   label: 'A 75-89%' },
        { val: dist.b,       pct: barPct(dist.b),        color: 'var(--yellow)',  label: 'B 60-74%' },
        { val: dist.c,       pct: barPct(dist.c),        color: 'var(--orange)',  label: 'C 50-59%' },
        { val: dist.f_grade, pct: barPct(dist.f_grade),  color: 'var(--red)',     label: 'F <50%'   },
      ],
      summary: [
        { label: 'Avg score', value: `${dist.avg_pct} / ${dist.total_marks}`, color: 'var(--text)' },
        { label: 'Pass rate', value: `${Math.round((dist.passed_count / dist.total) * 100)}%`, color: 'var(--green)' },
        { label: 'Highest',   value: top    ? `${top.score}/${dist.total_marks} (${top.full_name}${top.status === 'flagged' ? ' — flagged' : ''})` : '—', color: 'var(--text)' },
        { label: 'Lowest',    value: bottom ? `${bottom.score}/${dist.total_marks} (${bottom.full_name}${bottom.status === 'timed_out' ? ' — timed out' : ''})` : '—', color: 'var(--text)' },
      ],
    };

    res.json({ stats, alerts, funnel, scoreChart });
  } catch (err) {
    console.error('/api/dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/monitor ──────────────────────────────────────────
app.get('/api/monitor', async (req, res) => {
  try {
    const [[exam]] = await pool.query(
      `SELECT title, window_start, window_end FROM Exams
       WHERE is_published = TRUE ORDER BY exam_id DESC LIMIT 1`
    );

    const rows = await q(`
      SELECT ea.attempt_id, u.full_name, ea.status, ea.suspicion_score,
             ea.tab_switches, ea.copy_paste_attempts, ea.face_not_detected,
             ea.fullscreen_exits, ea.started_at, ea.submitted_at,
             (SELECT COUNT(*) FROM StudentAnswers sa WHERE sa.attempt_id = ea.attempt_id) AS answered,
             (SELECT COUNT(*) FROM Questions    qu WHERE qu.exam_id     = ea.exam_id)     AS total_q,
             ex.duration_minutes
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ea.exam_id = (SELECT MAX(exam_id) FROM Exams WHERE is_published = TRUE)
      ORDER BY ea.suspicion_score DESC, ea.attempt_id`
    );

    const students = rows.map(r => {
      const endTime  = r.submitted_at ? new Date(r.submitted_at) : new Date();
      const elapsed  = Math.floor((endTime - new Date(r.started_at)) / 60000);
      const remaining = Math.max(0, r.duration_minutes - elapsed);
      const timerPct  = Math.min(99, Math.round((elapsed / r.duration_minutes) * 100));
      const sc        = r.suspicion_score;

      const indicators = [];
      if (r.tab_switches > 0)        indicators.push({ cls: 'ind-tab',   text: `⇄ ${r.tab_switches} Tab Switch${r.tab_switches > 1 ? 'es' : ''}` });
      if (r.copy_paste_attempts > 0) indicators.push({ cls: 'ind-paste', text: `📋 ${r.copy_paste_attempts} Copy-Paste` });
      if (r.face_not_detected > 0)   indicators.push({ cls: 'ind-face',  text: `😶 Face Not Detected ${r.face_not_detected}×` });
      if (r.fullscreen_exits > 0)    indicators.push({ cls: '', text: `🖥️ Fullscreen Exit ${r.fullscreen_exits}×`, style: 'background:rgba(100,116,139,0.15);color:var(--text3)' });
      if (indicators.length === 0)   indicators.push({ cls: 'ind-clean', text: '✅ Clean' });

      const cardStatus = r.status === 'flagged' ? 'flagged' : sc >= 10 ? 'warning' : 'clean';
      const note       = r.status === 'flagged' && sc >= 70 ? '— FLAGGED'
                       : remaining <= 5 && r.status === 'in_progress' ? '· Will auto-submit soon'
                       : '';

      return {
        status: cardStatus, name: r.full_name,
        answered:   `${r.answered}/${r.total_q}`,
        elapsed,    timeLeft: `${remaining} min left`,
        timerPct,   timerFill: remaining <= 10 ? 'fill-red' : remaining <= 30 ? 'fill-yellow' : 'fill-green',
        suspicion: sc, suspColor: suspColor(sc),
        indicators, note,
      };
    });

    res.json({
      examAlert: `Live monitoring is active for <strong>${exam.title}</strong>. Exam window: ${fmtDate(exam.window_start)} – ${fmtDate(exam.window_end)}.`,
      students,
    });
  } catch (err) {
    console.error('/api/monitor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/flagged ──────────────────────────────────────────
app.get('/api/flagged', async (req, res) => {
  try {
    // Attempts table (based on Q02)
    const rows = await q(`
      SELECT ea.attempt_id, u.full_name, u.email, ea.status, ea.suspicion_score,
             ea.tab_switches, ea.copy_paste_attempts, ea.face_not_detected,
             ea.score, ex.total_marks, ex.passing_marks,
             COUNT(sf.flag_id) AS open_flags
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      LEFT JOIN SuspicionFlags sf ON ea.attempt_id = sf.attempt_id AND sf.is_resolved = FALSE
      WHERE ea.exam_id = 1
      GROUP BY ea.attempt_id, u.full_name, u.email, ea.status, ea.suspicion_score,
               ea.tab_switches, ea.copy_paste_attempts, ea.face_not_detected,
               ea.score, ex.total_marks, ex.passing_marks
      HAVING ea.status IN ('flagged','timed_out') OR ea.suspicion_score >= 5
      ORDER BY ea.suspicion_score DESC`
    );

    const attempts = rows.map(r => {
      const sc       = r.suspicion_score;
      const passed   = r.score >= r.passing_marks;
      const scColor  = suspColor(sc);

      const tabColor   = r.tab_switches >= 8       ? 'var(--red)' : r.tab_switches >= 3   ? 'var(--yellow)' : 'var(--text3)';
      const pasteColor = r.copy_paste_attempts >= 3 ? 'var(--red)' : r.copy_paste_attempts > 0 ? 'var(--yellow)' : 'var(--text3)';
      const faceColor  = r.face_not_detected >= 3   ? 'var(--orange)' : r.face_not_detected > 0 ? 'var(--yellow)' : 'var(--text3)';

      const statusBadge = r.status === 'flagged' ? 'badge-red' : r.status === 'timed_out' ? 'badge-yellow' : 'badge-green';
      const statusText  = r.status === 'flagged' ? '🚩 Flagged' : r.status === 'timed_out' ? '⏱ Timed Out' : '✓ Submitted';
      const scoreText   = r.status === 'flagged' ? 'Under Review' : passed ? 'Pass' : 'Fail';
      const scoreBadge  = r.status === 'flagged' ? 'badge-yellow' : passed ? 'badge-green' : 'badge-red';

      return {
        name: r.full_name, email: r.email,
        statusBadge, statusText,
        suspicion: sc, suspColor: scColor,
        tabs: r.tab_switches, tabColor,
        paste: r.copy_paste_attempts, pasteColor,
        face: r.face_not_detected, faceColor,
        score: `${r.score}/${r.total_marks}`, scoreBadge, scoreText,
        openFlags: `${r.open_flags} open`,
        flagBadge: r.open_flags > 0 ? 'badge-red' : 'badge-gray',
        logPage:   r.status !== 'submitted' ? 'logs' : null,
      };
    });

    // Flags table
    const flagRows = await q(`
      SELECT sf.flag_id, sf.flag_type, sf.description, sf.detected_at,
             sf.is_resolved, ru.full_name AS resolved_by,
             u.full_name AS student_name
      FROM SuspicionFlags sf
      JOIN ExamAttempts ea ON sf.attempt_id = ea.attempt_id
      JOIN Users u ON ea.student_id = u.user_id
      LEFT JOIN Users ru ON sf.resolved_by = ru.user_id
      WHERE ea.exam_id = 1
      ORDER BY sf.is_resolved ASC, sf.detected_at DESC`
    );

    const badgeMap = {
      HIGH_SUSPICION_SCORE: 'badge-red',    MULTIPLE_LOGINS:        'badge-yellow',
      IP_CHANGE_DURING_EXAM:'badge-orange',  EXCESSIVE_TAB_SWITCHES: 'badge-red',
      COPY_PASTE_ABUSE:     'badge-orange',  RAPID_ANSWERING:        'badge-yellow',
    };

    const flags = flagRows.map(f => ({
      numId:      f.flag_id,
      id:         `#${f.flag_id}`,
      student:    f.student_name,
      type:       f.flag_type,
      badge:      badgeMap[f.flag_type] || 'badge-gray',
      desc:       f.description,
      time:       new Date(f.detected_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      resolved:   !!f.is_resolved,
      resolvedBy: f.resolved_by || null,
    }));

    res.json({ attempts, flags });
  } catch (err) {
    console.error('/api/flagged error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/logs ─────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  try {
    // Pick the highest-suspicion attempt for the log viewer
    const [attemptRows] = await pool.query(`
      SELECT ea.attempt_id, u.full_name, ea.suspicion_score,
             ea.tab_switches, ea.copy_paste_attempts,
             ea.score, ex.total_marks,
             TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_min
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      ORDER BY ea.suspicion_score DESC LIMIT 1`
    );
    const attempt = attemptRows[0];

    if (!attempt) {
      return res.json({
        badge: 'No attempt data — load sample data first',
        timeline: [],
        risk: { score: 0, totalEvents: 0, duration: '—', metrics: [] },
      });
    }

    const events = await q(
      `SELECT event_type, severity, event_details, logged_at
       FROM ProctorLogs WHERE attempt_id = ? ORDER BY logged_at ASC`,
      [attempt.attempt_id]
    );

    const [[avgTime]] = await pool.query(
      `SELECT ROUND(AVG(time_taken_seconds), 0) AS avg_t FROM StudentAnswers WHERE attempt_id = ?`,
      [attempt.attempt_id]
    );

    const dotMap  = { CRITICAL: 'high', HIGH: 'high', MEDIUM: 'medium', LOW: 'info', INFO: 'info' };
    const iconMap = {
      EXAM_STARTED: '▶', TAB_SWITCH: '⇄', COPY_PASTE_DETECTED: '📋',
      FULLSCREEN_EXIT: '🖥', FACE_NOT_DETECTED: '😶', DEVTOOLS_OPENED: '🔧',
      IP_ADDRESS_CHANGED: '🌐', RAPID_ANSWERING: '⚡', EXAM_SUBMITTED: '✅',
      MULTIPLE_LOGIN_DETECTED: '🔴', AUTO_SUBMITTED: '⏱',
    };

    // Number repeated event types (e.g. TAB_SWITCH #1, #2 …)
    const typeCount = {};
    const timeline = events.map(e => {
      typeCount[e.event_type] = (typeCount[e.event_type] || 0) + 1;
      const n     = typeCount[e.event_type];
      const multi = ['TAB_SWITCH', 'COPY_PASTE_DETECTED', 'FACE_NOT_DETECTED'].includes(e.event_type);
      return {
        dot:    dotMap[e.severity] || 'info',
        icon:   iconMap[e.event_type] || '•',
        title:  multi ? `${e.event_type} #${n}` : e.event_type,
        detail: e.event_details,
        time:   new Date(e.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      };
    });

    res.json({
      badge:    `${attempt.full_name} — Attempt #${attempt.attempt_id} (Q09 Query)`,
      timeline,
      risk: {
        score:       attempt.suspicion_score,
        totalEvents: events.length,
        duration:    `${attempt.duration_min ?? '?'} min`,
        metrics: [
          { label: 'Tab Switches', value: attempt.tab_switches,         color: 'var(--yellow)' },
          { label: 'Copy-Paste',   value: attempt.copy_paste_attempts,  color: 'var(--red)'    },
          { label: 'Avg Time/Q',   value: `${avgTime?.avg_t ?? '?'}s`,  color: 'var(--orange)' },
          { label: 'Score',        value: `${attempt.score}/${attempt.total_marks}`, color: 'var(--red)' },
        ],
      },
    });
  } catch (err) {
    console.error('/api/logs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/student-view ─────────────────────────────────────
app.get('/api/student-view', async (req, res) => {
  try {
    // Show the student with the best clean score
    const [[student]] = await pool.query(
      `SELECT u.user_id, u.full_name, u.email
       FROM Users u WHERE u.role = 'student' ORDER BY u.user_id LIMIT 1`
    );

    const exams = await q(`
      SELECT e.exam_id, e.title, c.course_code, c.course_name,
             e.total_marks, e.duration_minutes, e.window_start, e.window_end,
             e.passing_marks, e.max_attempts,
             ea.status, ea.score, ea.percentage, ea.attempt_id
      FROM Enrollments enr
      JOIN Courses c ON enr.course_id = c.course_id
      JOIN Exams   e ON c.course_id   = e.course_id AND e.is_published = TRUE
      LEFT JOIN ExamAttempts ea ON e.exam_id = ea.exam_id AND ea.student_id = ?
      WHERE enr.student_id = ? AND enr.status = 'active'
      ORDER BY e.window_start DESC`,
      [student.user_id, student.user_id]
    );

    const now      = new Date();
    const examCards = exams.map(e => {
      const isSubmitted = e.status && e.status !== 'abandoned';
      const isUpcoming  = !e.status && new Date(e.window_start) > now;
      const passed      = e.score >= e.passing_marks;
      const pct         = e.percentage || 0;

      let statusBadge, statusText, action;
      if (isSubmitted) {
        statusBadge = 'badge-green'; statusText = '✓ Submitted';
        action = { label: 'View Results', cls: 'btn-outline', page: 'results' };
      } else if (isUpcoming) {
        statusBadge = 'badge-purple'; statusText = '📅 Upcoming';
        action = { label: 'Start Exam', cls: 'btn-primary', page: null };
      } else {
        statusBadge = 'badge-gray'; statusText = '🔒 Closed';
        action = { label: 'View Details', cls: 'btn-outline', page: null };
      }

      const base = {
        title: e.title, course: `${e.course_code} · ${e.course_name}`,
        statusBadge, statusText,
        marks: e.total_marks, duration: `${e.duration_minutes} min`,
        questions: `${e.max_attempts} Attempt${e.max_attempts > 1 ? 's' : ''}`,
        action,
      };

      if (isSubmitted) {
        return { ...base,
          scoreLine:  `${e.score}/${e.total_marks} (${pct}%) · ${passed ? 'PASS' : 'FAIL'}`,
          scoreColor: passed ? 'var(--green)' : 'var(--red)',
          pct, fill: passed ? 'fill-green' : 'fill-red',
        };
      }
      return { ...base, note: `Window: ${fmtDate(e.window_start)} – ${fmtDate(e.window_end)}` };
    });

    res.json({ label: `${student.full_name} · ${student.email}`, exams: examCards });
  } catch (err) {
    console.error('/api/student-view error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics ────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
  try {
    // Summary (Q03/Q08 combined)
    const [[s]] = await pool.query(`
      SELECT COUNT(*) AS total,
             SUM(ea.score >= ex.passing_marks)   AS passed,
             ROUND(AVG(ea.percentage), 1)        AS avg_pct,
             ROUND(AVG(ea.suspicion_score), 1)   AS avg_susp
      FROM ExamAttempts ea
      JOIN Exams ex ON ea.exam_id = ex.exam_id
      WHERE ea.exam_id = 1 AND ea.status IN ('submitted','graded','flagged')`
    );

    const [[ev]] = await pool.query(`
      SELECT COUNT(*) AS total_events FROM ProctorLogs pl
      JOIN ExamAttempts ea ON pl.attempt_id = ea.attempt_id WHERE ea.exam_id = 1`
    );

    const passRate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const stats = [
      { color: 'green',  label: 'Pass Rate',    value: `${passRate}%`, valueColor: 'var(--green)',  sub: `${s.passed} of ${s.total} submitted · DBMS Mid-Term` },
      { color: 'purple', label: 'Avg Score',    value: s.avg_pct,                                   sub: 'out of 50 · Class average' },
      { color: 'yellow', label: 'Avg Suspicion',value: s.avg_susp,     valueColor: 'var(--yellow)', sub: 'per attempt · Exam 1' },
      { color: 'red',    label: 'Total Events', value: ev.total_events,                              sub: 'Proctoring events logged' },
    ];

    // Question difficulty (Q04)
    const dRows = await q(`
      SELECT q.question_id, LEFT(q.question_text, 50) AS topic,
             ROUND(AVG(sa.time_taken_seconds), 0)                                       AS avg_time,
             ROUND(100.0 * SUM(sa.is_correct) / NULLIF(COUNT(sa.answer_id), 0), 0)     AS correct_pct
      FROM Questions q
      LEFT JOIN StudentAnswers sa ON q.question_id = sa.question_id
      WHERE q.exam_id = 1
      GROUP BY q.question_id, q.question_text
      ORDER BY correct_pct ASC LIMIT 5`
    );

    const difficulty = dRows.map(r => {
      const p      = r.correct_pct ?? 0;
      const rating = p >= 80 ? 'Too Easy' : p >= 40 ? 'Good' : 'Hard';
      const badge  = p >= 80 ? 'badge-green' : p >= 40 ? 'badge-yellow' : 'badge-red';
      const color  = p >= 80 ? 'var(--green)' : p >= 40 ? 'var(--yellow)' : 'var(--red)';
      return { q: `Q${r.question_id}`, topic: r.topic, pct: `${p}%`, pctColor: color, time: `${r.avg_time ?? '?'}s`, badge, rating };
    });

    // Class ranking (Q10)
    const rRows = await q(`
      SELECT u.full_name, ROUND(AVG(ea.percentage), 1) AS avg_pct,
             SUM(ea.score >= ex.passing_marks)         AS passed,
             ROUND(AVG(ea.suspicion_score), 1)         AS avg_susp,
             SUM(ea.status = 'flagged')                AS flagged,
             RANK() OVER (ORDER BY AVG(ea.percentage) DESC) AS class_rank
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ex.course_id = 1 AND ea.status IN ('submitted','graded','flagged')
      GROUP BY u.user_id, u.full_name
      ORDER BY avg_pct DESC`
    );

    const ranking = rRows.map(r => {
      const p  = r.avg_pct;
      const sc = r.avg_susp;
      return {
        rank: `#${r.class_rank}`, name: r.full_name, flag: r.flagged > 0,
        pct: `${p}%`, pctColor: p >= 75 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : 'var(--red)',
        passBadge: r.passed > 0 ? 'badge-green' : r.flagged > 0 ? 'badge-yellow' : 'badge-red',
        passText:  r.passed > 0 ? '✓' : r.flagged > 0 ? '?' : '✗',
        susp: sc, suspColor: suspColor(sc),
      };
    });

    res.json({ stats, difficulty, ranking });
  } catch (err) {
    console.error('/api/analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/schema ───────────────────────────────────────────
// Reads live metadata from INFORMATION_SCHEMA — truly DBMS-driven!
app.get('/api/schema', async (req, res) => {
  try {
    // Table list with real row counts
    const tableOrder = ['Users','Courses','Enrollments','Exams','Questions',
                        'ExamAttempts','StudentAnswers','ProctorLogs','SuspicionFlags','LoginSessions'];

    const rawTables = await q(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'ExamProctor'
       ORDER BY FIELD(TABLE_NAME, ${tableOrder.map(() => '?').join(',')})`,
      tableOrder
    );

    const countRows = await Promise.all(
      rawTables.map(async t => {
        const [[rc]] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${t.TABLE_NAME}\``);
        return { name: t.TABLE_NAME, rows: rc.cnt };
      })
    );

    const entityMap      = { Users:'Strong', Courses:'Strong', Enrollments:'Junction', Exams:'Strong', Questions:'Strong', ExamAttempts:'Weak', StudentAnswers:'Strong', ProctorLogs:'Weak', SuspicionFlags:'Strong', LoginSessions:'Strong' };
    const badgeMap       = { Strong:'badge-purple', Junction:'badge-green', Weak:'badge-yellow' };
    const constraintsMap = {
      Users:          'PK, UNIQUE(email), CHECK(email REGEXP)',
      Courses:        'PK, UNIQUE(course_code), FK→Users',
      Enrollments:    'PK, UNIQUE(student_id, course_id), FK×2',
      Exams:          'PK, FK→Courses, FK→Users, CHECK constraints',
      Questions:      'PK, FK→Exams (CASCADE DELETE)',
      ExamAttempts:   'PK, UNIQUE(exam_id, student_id, attempt#), FK×2',
      StudentAnswers: 'PK, UNIQUE(attempt_id, question_id), FK×2',
      ProctorLogs:    'PK, FK→ExamAttempts (CASCADE DELETE)',
      SuspicionFlags: 'PK, FK→ExamAttempts, FK→Users (SET NULL)',
      LoginSessions:  'PK, UNIQUE(session_token), FK→Users',
    };

    const tables = countRows.map((t, i) => ({
      num:         i + 1,
      name:        t.name,
      rows:        t.rows,
      entity:      entityMap[t.name]      || 'Strong',
      entityBadge: badgeMap[entityMap[t.name]] || 'badge-purple',
      constraints: constraintsMap[t.name] || 'PK',
    }));

    // Triggers from INFORMATION_SCHEMA
    const trigRows = await q(`
      SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING
      FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = 'ExamProctor'
      ORDER BY ACTION_TIMING DESC, EVENT_MANIPULATION`
    );

    const purposeMap = {
      trg_validate_exam_start:    'Window + attempt limit check',
      trg_check_time_on_answer:   'Auto-submit on time expiry',
      trg_auto_grade_answer:      'Instant MCQ grading',
      trg_update_suspicion_score: 'Severity-weighted score update',
      trg_auto_flag_suspicious:   'Auto-raise flags at threshold 70',
      trg_log_exam_submission:    'Immutable audit trail',
      trg_detect_multiple_logins: 'Concurrent session detection',
    };
    const timingShort = { BEFORE: 'B', AFTER: 'A' };
    const eventShort  = { INSERT: 'I', UPDATE: 'U', DELETE: 'D' };

    const triggers = trigRows.map(t => ({
      name:    t.TRIGGER_NAME,
      event:   `${timingShort[t.ACTION_TIMING] || t.ACTION_TIMING}${eventShort[t.EVENT_MANIPULATION] || t.EVENT_MANIPULATION} ${t.EVENT_OBJECT_TABLE}`,
      purpose: purposeMap[t.TRIGGER_NAME] || t.TRIGGER_NAME,
    }));

    // Stored procedures from INFORMATION_SCHEMA
    const procRows = await q(`
      SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = 'ExamProctor' AND ROUTINE_TYPE = 'PROCEDURE'
      ORDER BY ROUTINE_NAME`
    );

    const calledByMap = {
      sp_start_exam:           'Student — starts attempt',
      sp_submit_answer:        'Student — saves answer',
      sp_submit_exam:          'Student — finalises exam',
      sp_log_proctor_event:    'Frontend — logs JS event',
      sp_get_exam_results:     'Student — view results',
      sp_get_flagged_attempts: 'Proctor — dashboard',
      sp_resolve_flag:         'Proctor — close flag',
      sp_exam_analytics:       'Instructor — statistics',
    };

    const procedures = procRows.map(p => ({
      name:     p.ROUTINE_NAME,
      calledBy: calledByMap[p.ROUTINE_NAME] || 'Internal',
    }));

    res.json({ tables, triggers, procedures });
  } catch (err) {
    console.error('/api/schema error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/results ──────────────────────────────────────────
app.get('/api/results', async (req, res) => {
  try {
    const [resultRows] = await pool.query(`
      SELECT u.full_name, ea.score, ea.percentage, ex.total_marks, ex.passing_marks,
             TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_min
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ea.status IN ('submitted','graded') AND ea.score >= ex.passing_marks
      ORDER BY ea.percentage DESC LIMIT 1`
    );
    const row = resultRows[0];

    if (!row) {
      return res.json({
        student: 'No data — load sample data first',
        metrics: [{ label: 'Status', value: 'No results yet', color: 'var(--text3)' }],
        note: 'Run setup.bat to load sample data, then restart the server.',
      });
    }

    res.json({
      student: row.full_name,
      metrics: [
        { label: 'Score',      value: `${row.score}/${row.total_marks}`, color: 'var(--green)' },
        { label: 'Percentage', value: `${row.percentage}%`,              color: 'var(--green)' },
        { label: 'Result',     value: 'PASS',                            color: 'var(--green)' },
        { label: 'Duration',   value: `${row.duration_min} min`,         color: null           },
      ],
      note: 'Detailed per-question results returned by sp_get_exam_results (stored procedure).',
    });
  } catch (err) {
    console.error('/api/results error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/exams ────────────────────────────────────────────
app.get('/api/exams', async (req, res) => {
  try {
    const rows = await q(`
      SELECT
        e.exam_id,
        e.title,
        c.course_code,
        c.course_name,
        u.full_name                                                    AS instructor,
        e.total_marks,
        e.passing_marks,
        e.duration_minutes,
        e.window_start,
        e.window_end,
        e.max_attempts,
        e.shuffle_questions,
        e.show_results_immediately,
        (SELECT COUNT(*) FROM Questions q WHERE q.exam_id = e.exam_id) AS question_count,
        COUNT(DISTINCT ea.attempt_id)                                  AS total_attempts,
        SUM(ea.status IN ('submitted','graded','flagged'))             AS completed,
        SUM(ea.status = 'flagged')                                     AS flagged,
        ROUND(AVG(CASE WHEN ea.status IN ('submitted','graded','flagged')
                       THEN ea.percentage END), 1)                    AS avg_pct,
        SUM(ea.score >= e.passing_marks)                              AS passed
      FROM Exams e
      JOIN Courses c ON e.course_id  = c.course_id
      JOIN Users   u ON e.created_by = u.user_id
      LEFT JOIN ExamAttempts ea ON e.exam_id = ea.exam_id
      GROUP BY e.exam_id, e.title, c.course_code, c.course_name,
               u.full_name, e.total_marks, e.passing_marks, e.duration_minutes,
               e.window_start, e.window_end, e.max_attempts,
               e.shuffle_questions, e.show_results_immediately
      ORDER BY e.window_start DESC`
    );

    const now = new Date();
    const exams = rows.map(r => {
      const start    = new Date(r.window_start);
      const end      = new Date(r.window_end);
      const upcoming = now < start;
      const active   = now >= start && now <= end;
      const statusText  = upcoming ? '📅 Upcoming' : active ? '🟢 Active' : '✅ Completed';
      const statusBadge = upcoming ? 'badge-purple' : active ? 'badge-green' : 'badge-gray';
      const passRate = r.completed > 0
        ? Math.round((r.passed / r.completed) * 100) + '%'
        : '—';
      return {
        id:           r.exam_id,
        title:        r.title,
        course:       `${r.course_code} · ${r.course_name}`,
        instructor:   r.instructor,
        marks:        `${r.passing_marks}/${r.total_marks}`,
        duration:     `${r.duration_minutes} min`,
        questions:    r.question_count,
        window:       `${fmtDate(r.window_start)} → ${fmtDate(r.window_end)}`,
        statusText,
        statusBadge,
        attempts:     r.total_attempts,
        completed:    r.completed || 0,
        flagged:      r.flagged   || 0,
        avgScore:     r.avg_pct   || '—',
        passRate,
        shuffle:      r.shuffle_questions  ? '✓' : '—',
        showResults:  r.show_results_immediately ? '✓' : '—',
      };
    });

    res.json({ exams });
  } catch (err) {
    console.error('/api/exams error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/questions ────────────────────────────────────────
app.get('/api/questions', async (req, res) => {
  try {
    const rows = await q(`
      SELECT
        q.question_id,
        q.exam_id,
        e.title                                                         AS exam_title,
        c.course_code,
        q.order_index,
        q.question_text,
        q.question_type,
        q.marks,
        q.difficulty_level,
        q.option_a, q.option_b, q.option_c, q.option_d,
        q.correct_answer,
        COUNT(sa.answer_id)                                             AS times_answered,
        SUM(sa.is_correct = TRUE)                                       AS correct_count,
        ROUND(
          100.0 * SUM(sa.is_correct = TRUE) / NULLIF(COUNT(sa.answer_id), 0)
        , 0)                                                            AS correct_pct,
        ROUND(AVG(sa.time_taken_seconds), 0)                           AS avg_time_sec
      FROM Questions q
      JOIN Exams   e ON q.exam_id    = e.exam_id
      JOIN Courses c ON e.course_id  = c.course_id
      LEFT JOIN StudentAnswers sa ON q.question_id = sa.question_id
      GROUP BY q.question_id, q.exam_id, e.title, c.course_code,
               q.order_index, q.question_text, q.question_type,
               q.marks, q.difficulty_level,
               q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer
      ORDER BY q.exam_id ASC, q.order_index ASC`
    );

    const diffBadge = d => d === 'easy' ? 'badge-green' : d === 'medium' ? 'badge-yellow' : 'badge-red';

    const questions = rows.map(r => {
      const pct = r.correct_pct ?? null;
      return {
        id:          r.question_id,
        examId:      r.exam_id,
        examTitle:   r.exam_title,
        course:      r.course_code,
        num:         r.order_index,
        text:        r.question_text,
        type:        r.question_type,
        marks:       r.marks,
        difficulty:  r.difficulty_level,
        diffBadge:   diffBadge(r.difficulty_level),
        options: [
          { letter: 'A', text: r.option_a },
          { letter: 'B', text: r.option_b },
          { letter: 'C', text: r.option_c },
          { letter: 'D', text: r.option_d },
        ].filter(o => o.text),
        answer:      r.correct_answer,
        answered:    r.times_answered || 0,
        correctPct:  pct !== null ? `${pct}%` : '—',
        pctColor:    pct === null ? 'var(--text3)' : pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)',
        avgTime:     r.avg_time_sec ? `${r.avg_time_sec}s` : '—',
      };
    });

    // Group by exam
    const grouped = [];
    let lastId = null;
    for (const q of questions) {
      if (q.examId !== lastId) {
        grouped.push({ examId: q.examId, examTitle: q.examTitle, course: q.course, questions: [] });
        lastId = q.examId;
      }
      grouped[grouped.length - 1].questions.push(q);
    }

    res.json({ groups: grouped });
  } catch (err) {
    console.error('/api/questions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/export ───────────────────────────────────────────
// Generates and streams a CSV report of all exam attempts.
// The browser receives it as a file download.
app.get('/api/export', async (req, res) => {
  try {
    // ── Section 1: Per-attempt results ────────────────────────
    const attempts = await q(`
      SELECT
        u.full_name                                                   AS student_name,
        u.email,
        ex.title                                                      AS exam_title,
        c.course_code,
        ea.attempt_id,
        ea.score,
        ex.total_marks,
        ea.percentage,
        CASE WHEN ea.score >= ex.passing_marks THEN 'PASS' ELSE 'FAIL' END AS result,
        ea.status,
        ea.suspicion_score,
        ea.tab_switches,
        ea.copy_paste_attempts,
        ea.face_not_detected,
        ea.fullscreen_exits,
        ea.ip_address,
        DATE_FORMAT(ea.started_at,   '%Y-%m-%d %H:%i')               AS started_at,
        DATE_FORMAT(ea.submitted_at, '%Y-%m-%d %H:%i')               AS submitted_at,
        TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at)        AS duration_min
      FROM ExamAttempts ea
      JOIN Users   u  ON ea.student_id = u.user_id
      JOIN Exams   ex ON ea.exam_id    = ex.exam_id
      JOIN Courses c  ON ex.course_id  = c.course_id
      ORDER BY ex.exam_id ASC, ea.suspicion_score DESC`
    );

    // ── Section 2: Suspicion flags ────────────────────────────
    const flags = await q(`
      SELECT
        u.full_name                                                   AS student_name,
        sf.flag_type,
        sf.description,
        DATE_FORMAT(sf.detected_at, '%Y-%m-%d %H:%i')                AS detected_at,
        CASE WHEN sf.is_resolved THEN 'Resolved' ELSE 'Open' END     AS status,
        ru.full_name                                                  AS resolved_by,
        sf.resolution_notes
      FROM SuspicionFlags sf
      JOIN ExamAttempts ea ON sf.attempt_id = ea.attempt_id
      JOIN Users u         ON ea.student_id  = u.user_id
      LEFT JOIN Users ru   ON sf.resolved_by = ru.user_id
      ORDER BY sf.is_resolved ASC, sf.detected_at DESC`
    );

    // ── Section 3: Summary stats ──────────────────────────────
    const [[summary]] = await pool.query(`
      SELECT
        COUNT(*)                                                       AS total_attempts,
        SUM(ea.score >= ex.passing_marks)                             AS passed,
        SUM(ea.status = 'flagged')                                    AS flagged,
        SUM(ea.status = 'timed_out')                                  AS timed_out,
        ROUND(AVG(ea.percentage), 1)                                  AS avg_pct,
        ROUND(AVG(ea.suspicion_score), 1)                             AS avg_suspicion,
        MAX(ea.suspicion_score)                                       AS max_suspicion
      FROM ExamAttempts ea
      JOIN Exams ex ON ea.exam_id = ex.exam_id`
    );

    // ── Build CSV ─────────────────────────────────────────────
    const esc = v => (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g, '""')}"`;
    const row = cols => cols.map(esc).join(',');

    const lines = [];
    const ts = new Date().toLocaleString('en-IN', { hour12: false });

    // Header block
    lines.push(row(['ExamProctor — Exam Report']), row([`Generated: ${ts}`]), '');

    // Summary block
    lines.push(row(['SUMMARY']));
    lines.push(row(['Total Attempts', 'Passed', 'Flagged', 'Timed Out', 'Avg Score %', 'Avg Suspicion', 'Max Suspicion']));
    lines.push(row([
      summary?.total_attempts ?? 0,
      summary?.passed         ?? 0,
      summary?.flagged        ?? 0,
      summary?.timed_out      ?? 0,
      summary?.avg_pct        ?? 0,
      summary?.avg_suspicion  ?? 0,
      summary?.max_suspicion  ?? 0,
    ]));
    lines.push('');

    // Attempt results block
    lines.push(row(['EXAM RESULTS']));
    lines.push(row([
      'Student Name', 'Email', 'Exam', 'Course',
      'Attempt ID', 'Score', 'Total Marks', 'Percentage', 'Result', 'Status',
      'Suspicion Score', 'Tab Switches', 'Copy-Paste', 'Face Issues', 'Fullscreen Exits',
      'IP Address', 'Started', 'Submitted', 'Duration (min)',
    ]));
    for (const a of attempts) {
      lines.push(row([
        a.student_name, a.email, a.exam_title, a.course_code,
        a.attempt_id, a.score, a.total_marks, a.percentage, a.result, a.status,
        a.suspicion_score, a.tab_switches, a.copy_paste_attempts,
        a.face_not_detected, a.fullscreen_exits,
        a.ip_address, a.started_at, a.submitted_at, a.duration_min,
      ]));
    }
    lines.push('');

    // Flags block
    lines.push(row(['SUSPICION FLAGS']));
    lines.push(row(['Student Name', 'Flag Type', 'Description', 'Detected At', 'Status', 'Resolved By', 'Resolution Notes']));
    for (const f of flags) {
      lines.push(row([f.student_name, f.flag_type, f.description, f.detected_at, f.status, f.resolved_by, f.resolution_notes]));
    }

    const csv = lines.join('\r\n');
    const filename = `ExamProctor_Report_${new Date().toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM prefix so Excel opens UTF-8 correctly
  } catch (err) {
    console.error('/api/export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/courses ──────────────────────────────────────────
app.get('/api/courses', async (req, res) => {
  try {
    const rows = await q(
      `SELECT c.course_id, c.course_code, c.course_name, u.full_name AS instructor
       FROM Courses c JOIN Users u ON c.instructor_id = u.user_id
       WHERE c.is_active = TRUE ORDER BY c.course_name`
    );
    res.json({ courses: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/exams ───────────────────────────────────────────
app.post('/api/exams', async (req, res) => {
  try {
    const {
      course_id, title, description, total_marks, passing_marks,
      duration_minutes, window_start, window_end, max_attempts,
      shuffle_questions, show_results_immediately, is_published,
    } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO Exams
         (course_id, title, description, total_marks, passing_marks,
          duration_minutes, window_start, window_end, max_attempts,
          shuffle_questions, show_results_immediately, is_published, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        course_id, title, description || null, total_marks, passing_marks,
        duration_minutes, window_start, window_end, max_attempts || 1,
        shuffle_questions ? 1 : 0, show_results_immediately ? 1 : 0, is_published ? 1 : 0,
      ]
    );
    res.json({ success: true, exam_id: result.insertId });
  } catch (err) {
    console.error('/api/exams POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/exams/:id ─────────────────────────────────────
// Cascade order (FK constraints are RESTRICT by default):
//   ExamAttempts → cascades to StudentAnswers, ProctorLogs, SuspicionFlags
//   then Exams   → cascades to Questions
app.delete('/api/exams/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM ExamAttempts WHERE exam_id = ?`, [req.params.id]);
    await conn.execute(`DELETE FROM Exams WHERE exam_id = ?`, [req.params.id]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('/api/exams DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /api/questions ───────────────────────────────────────
app.post('/api/questions', async (req, res) => {
  try {
    const {
      exam_id, question_text, question_type, marks,
      option_a, option_b, option_c, option_d,
      correct_answer, difficulty_level, order_index,
    } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO Questions
         (exam_id, question_text, question_type, marks,
          option_a, option_b, option_c, option_d,
          correct_answer, difficulty_level, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exam_id, question_text, question_type || 'MCQ', marks,
        option_a || null, option_b || null, option_c || null, option_d || null,
        correct_answer, difficulty_level || 'medium', order_index || 0,
      ]
    );
    res.json({ success: true, question_id: result.insertId });
  } catch (err) {
    console.error('/api/questions POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/questions/:id ─────────────────────────────────
// StudentAnswers.fk_answers_question is ON DELETE RESTRICT, so
// manually remove answers first before deleting the question.
app.delete('/api/questions/:id', async (req, res) => {
  try {
    await pool.execute(`DELETE FROM StudentAnswers WHERE question_id = ?`, [req.params.id]);
    await pool.execute(`DELETE FROM Questions WHERE question_id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('/api/questions DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/flags/:id/resolve ───────────────────────────────
app.post('/api/flags/:id/resolve', async (req, res) => {
  try {
    const notes = req.body.notes || 'Reviewed and resolved by admin.';
    await pool.execute(
      `UPDATE SuspicionFlags
       SET is_resolved = TRUE, resolved_by = 1, resolved_at = NOW(), resolution_notes = ?
       WHERE flag_id = ?`,
      [notes, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('/api/flags resolve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nExamProctor server running at http://localhost:${PORT}`);
  console.log(`UI dashboard → http://localhost:${PORT}/index.html\n`);
});
