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
const crypto  = require('crypto');

// sha256:hex — used for all new passwords; demo seed data also uses this format
function hashPw(pw)       { return 'sha256:' + crypto.createHash('sha256').update(pw).digest('hex'); }
function checkPw(pw, hash){ return hash === hashPw(pw); }

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

// ── DB Helpers ────────────────────────────────────────────────
// Returns the exam_id with the most completed attempts (used for analytics/dashboard/flagged).
async function refExamId() {
  const [[row]] = await pool.query(
    `SELECT exam_id FROM ExamAttempts
     WHERE status IN ('submitted','graded','flagged','timed_out')
     GROUP BY exam_id ORDER BY COUNT(*) DESC LIMIT 1`
  );
  return row?.exam_id ?? 1;
}

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

// Resolve the user_id for the session token sent in x-session-token header.
// Returns null if the token is missing or expired.
async function getUserFromToken(req) {
  const token = req.headers['x-session-token'] || '';
  if (!token) return null;
  const rows = await q(
    `SELECT user_id FROM LoginSessions WHERE session_token = ? AND is_active = TRUE LIMIT 1`,
    [token]
  );
  return rows.length ? rows[0].user_id : null;
}

// Resolve user_id + role(s) in one call.
// Returns { userId, role, roles[] } — all null/empty if unauthenticated.
// `role` is the primary role from Users; `roles` includes extras from UserRoles.
async function getUserWithRole(req) {
  const userId = await getUserFromToken(req);
  if (!userId) return { userId: null, role: null, roles: [] };
  const rows = await q(`SELECT role FROM Users WHERE user_id = ?`, [userId]);
  const primaryRole = rows[0]?.role || null;
  const extraRows   = await q(`SELECT role FROM UserRoles WHERE user_id = ?`, [userId]);
  const roles = [primaryRole, ...extraRows.map(r => r.role)]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  return { userId, role: primaryRole, roles };
}

// True if the user's roles array includes ANY of the allowed roles.
function hasAnyRole(roles, ...allowed) {
  return allowed.some(r => roles.includes(r));
}

// Route wrapper — removes repeated try/catch + error logging from every handler
const route = (method, path, fn) => app[method](path, async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(`${path} error:`, e.message); res.status(500).json({ error: e.message }); }
});

// ── GET /api/dashboard ────────────────────────────────────────
route('get', '/api/dashboard', async (req, res) => {
    const { userId } = await getUserWithRole(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
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
           AND flag_type = 'HIGH_SUSPICION_SCORE') AS high_flags,
        (SELECT COUNT(*) FROM ExamAttempts WHERE status = 'flagged')                    AS flagged_count
    `);

    const flaggedNames = await q(
      `SELECT u.full_name FROM ExamAttempts ea
       JOIN Users u ON ea.student_id = u.user_id
       WHERE ea.status = 'flagged' ORDER BY ea.suspicion_score DESC LIMIT 3`
    );

    const mediumFlags = Math.max(0, counts.open_flags - counts.high_flags);

    const stats = [
      { color: 'purple', label: 'Total Exams',
        value: counts.total_exams,
        sub:   `${counts.completed_exams} completed · ${counts.upcoming_exams} upcoming`,
        page:  'exams' },
      { color: 'green',  label: 'Attempts Today',
        value: counts.total_attempts,
        sub:   `${counts.submitted_attempts} submitted · ${counts.active_attempts} in progress`,
        page:  'monitor' },
      { color: 'yellow', label: 'Open Flags',
        value: counts.open_flags,
        sub:   `${counts.high_flags} high · ${mediumFlags} medium severity`,
        page:  'flagged' },
      { color: 'red',    label: 'Flagged Attempts',
        value: counts.flagged_count,
        sub:   flaggedNames.map(r => r.full_name).join(' · ') || 'None',
        page:  'flagged' },
    ];

    // ─ Alerts ─
    const alertRows = await q(`
      SELECT u.full_name, ea.suspicion_score, ea.tab_switches, ea.copy_paste_attempts,
             ea.status, ea.score, ex.total_marks, ea.attempt_id
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ea.suspicion_score > 0 OR ea.status IN ('flagged','timed_out')
      ORDER BY ea.suspicion_score DESC LIMIT 5`
    );

    const alerts = alertRows.map(r => {
      const sc   = r.suspicion_score;
      const type = sc >= 70 ? 'red' : sc >= 10 ? 'yellow' : 'green';
      let msg;
      if (r.status === 'flagged') {
        const parts = [];
        if (r.tab_switches > 0)          parts.push(`${r.tab_switches} tab switches`);
        if (r.copy_paste_attempts > 0)   parts.push(`${r.copy_paste_attempts} copy-paste events`);
        if (sc >= 70)                    parts.push(`suspicion score ${sc}/100`);
        msg = parts.join('. ') + `. Score ${r.score ?? '—'}/${r.total_marks}.`;
      } else if (r.status === 'timed_out') {
        msg = `Exam auto-submitted at time limit. Score: ${r.score ?? '—'}/${r.total_marks}.`;
      } else {
        const pct = r.score != null ? Math.round((r.score / r.total_marks) * 100) : 0;
        msg = `Exam completed cleanly. Score ${r.score ?? '—'}/${r.total_marks} (${pct}%). No suspicious events.`;
      }
      return {
        type, name: r.full_name, msg,
        action: r.status === 'flagged' ? { label: 'View Logs', page: 'logs' }
               : sc >= 40             ? { label: 'Review',    page: 'flagged' }
               : null,
      };
    });

    // ─ Funnel (based on Q08) ─
    const refId = await refExamId();
    const [fRows] = await pool.query(`
      SELECT
        COUNT(DISTINCT enr.student_id)                                                AS enrolled,
        COUNT(DISTINCT CASE WHEN ea.attempt_id IS NOT NULL THEN ea.student_id END)    AS started,
        COUNT(DISTINCT CASE WHEN ea.status IN ('submitted','graded','flagged') THEN ea.student_id END) AS submitted,
        COUNT(DISTINCT CASE WHEN ea.status = 'timed_out'  THEN ea.student_id END)    AS timed_out,
        COUNT(DISTINCT CASE WHEN ea.status = 'flagged'    THEN ea.student_id END)    AS flagged,
        COUNT(DISTINCT CASE WHEN ea.score >= ex.passing_marks THEN ea.student_id END) AS passed,
        ex.passing_marks, ex.title AS exam_title
      FROM Exams ex
      JOIN Enrollments enr ON ex.course_id = enr.course_id AND enr.status = 'active'
      LEFT JOIN ExamAttempts ea ON ex.exam_id = ea.exam_id
      WHERE ex.exam_id = ?
      GROUP BY ex.exam_id, ex.passing_marks, ex.title`, [refId]
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
      WHERE ea.exam_id = ? AND ea.status IN ('submitted','graded','flagged')
      GROUP BY ex.total_marks`, [refId]
    );
    const dist = distRows[0] || { a_plus:0, a:0, b:0, c:0, f_grade:0, avg_pct:0, passed_count:0, total:0, total_marks:50 };

    const [topRow]    = await pool.query(`SELECT u.full_name, ea.score, ea.status FROM ExamAttempts ea JOIN Users u ON ea.student_id=u.user_id WHERE ea.exam_id=? AND ea.status IN ('submitted','graded','flagged') ORDER BY ea.percentage DESC LIMIT 1`, [refId]);
    const [bottomRow] = await pool.query(`SELECT u.full_name, ea.score, ea.status FROM ExamAttempts ea JOIN Users u ON ea.student_id=u.user_id WHERE ea.exam_id=? AND ea.status IN ('submitted','graded','flagged') ORDER BY ea.percentage ASC  LIMIT 1`, [refId]);
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

    res.json({ stats, alerts, funnel, scoreChart, examTitle: f.exam_title || 'Overview' });
});

// ── GET /api/monitor/stream  (Server-Sent Events) ─────────────
// Pushes live monitor data every 4 seconds to the proctor dashboard.
app.get('/api/monitor/stream', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = async () => {
    try {
      const [[exam]] = await pool.query(
        `SELECT exam_id, title, window_start, window_end FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW()
         ORDER BY exam_id DESC LIMIT 1`
      );
      if (!exam) {
        res.write(`data: ${JSON.stringify({ students: [], examAlert: 'No exam is currently active.' })}\n\n`);
        return;
      }

      const rows = await q(`
        SELECT ea.attempt_id, u.full_name, ea.status, ea.suspicion_score,
               ea.tab_switches, ea.copy_paste_attempts,
               ea.fullscreen_exits, ea.started_at, ea.ip_address,
               (SELECT COUNT(*) FROM StudentAnswers sa WHERE sa.attempt_id = ea.attempt_id) AS answered,
               (SELECT COUNT(*) FROM Questions qu WHERE qu.exam_id = ea.exam_id)            AS total_q,
               ex.duration_minutes,
               (SELECT pl.event_type FROM ProctorLogs pl
                WHERE pl.attempt_id = ea.attempt_id
                ORDER BY pl.logged_at DESC LIMIT 1) AS last_event,
               (SELECT pl.logged_at FROM ProctorLogs pl
                WHERE pl.attempt_id = ea.attempt_id
                ORDER BY pl.logged_at DESC LIMIT 1) AS last_event_time
        FROM ExamAttempts ea
        JOIN Users u  ON ea.student_id = u.user_id
        JOIN Exams ex ON ea.exam_id    = ex.exam_id
        WHERE ea.exam_id = ? AND ea.status IN ('in_progress','flagged')
        ORDER BY ea.suspicion_score DESC, ea.attempt_id`, [exam.exam_id]
      );

      const students = rows.map(r => {
        const elapsed   = Math.floor((Date.now() - new Date(r.started_at)) / 60000);
        const remaining = Math.max(0, r.duration_minutes - elapsed);
        const sc        = r.suspicion_score;

        const indicators = [];
        if (r.tab_switches > 0)        indicators.push({ cls: 'ind-tab',   text: `Tab Switch ×${r.tab_switches}` });
        if (r.copy_paste_attempts > 0) indicators.push({ cls: 'ind-paste', text: `Paste ×${r.copy_paste_attempts}` });
        if (r.fullscreen_exits > 0)    indicators.push({ cls: '', text: `Fullscreen Exit ×${r.fullscreen_exits}`, style: 'background:rgba(100,116,139,0.15);color:var(--text3)' });
        if (indicators.length === 0)   indicators.push({ cls: 'ind-clean', text: 'Clean' });

        return {
          attempt_id: r.attempt_id,
          name:       r.full_name,
          status:     r.status === 'flagged' ? 'flagged' : sc >= 10 ? 'warning' : 'clean',
          rawStatus:  r.status,
          answered:   `${r.answered}/${r.total_q}`,
          progress:   r.total_q > 0 ? Math.round((r.answered / r.total_q) * 100) : 0,
          elapsed,
          timeLeft:   `${remaining} min left`,
          timerPct:   Math.min(99, Math.round((elapsed / r.duration_minutes) * 100)),
          timerFill:  remaining <= 10 ? 'fill-red' : remaining <= 30 ? 'fill-yellow' : 'fill-green',
          suspicion:  sc,
          suspColor:  suspColor(sc),
          ip:         r.ip_address,
          lastEvent:  r.last_event || null,
          lastEventTime: r.last_event_time || null,
          indicators,
          note:       r.status === 'flagged' && sc >= 70 ? '— FLAGGED' :
                      remaining <= 5 ? '· Will auto-submit soon' : '',
        };
      });

      res.write(`data: ${JSON.stringify({
        examAlert: `<strong>${exam.title}</strong> — window ${fmtDate(exam.window_start)} – ${fmtDate(exam.window_end)}`,
        students,
        activeCount: students.length,
        flaggedCount: students.filter(s => s.status === 'flagged').length,
        ts: Date.now(),
      })}\n\n`);
    } catch (e) {
      console.error('/api/monitor/stream error:', e.message);
    }
  };

  await send();
  const interval = setInterval(send, 4000);
  req.on('close', () => clearInterval(interval));
});

// ── GET /api/monitor/exam/:id — snapshot for classroom live list ─
route('get', '/api/monitor/exam/:id', async (req, res) => {
  const examId = parseInt(req.params.id);
  const rows = await q(
    `SELECT u.full_name AS name, ea.status, ea.suspicion_score AS suspicion,
            ea.tab_switches AS tabs, ea.copy_paste_attempts AS paste,
            ea.fullscreen_exits AS fullscreen, ea.ip_address
     FROM   ExamAttempts ea
     JOIN   Users u ON ea.student_id = u.user_id
     WHERE  ea.exam_id = ?
     ORDER  BY ea.suspicion_score DESC, ea.attempt_id`, [examId]
  );
  res.json({ students: rows });
});

// ── GET /api/flagged ──────────────────────────────────────────
route('get', '/api/flagged', async (req, res) => {
    const { userId, roles } = await getUserWithRole(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasAnyRole(roles, 'admin', 'teacher'))
      return res.status(403).json({ error: 'Teacher or admin access required' });
    const isTeacher     = hasAnyRole(roles, 'teacher') && !hasAnyRole(roles, 'admin');
    const instrFilter   = isTeacher ? 'AND ex.created_by = ?' : '';
    const instrParam    = isTeacher ? [userId] : [];
    // Teacher can choose sort order via ?sort= query param
    const SORT_MAP = {
      suspicion:  'ea.suspicion_score DESC',
      tabs:       'ea.tab_switches DESC',
      paste:      'ea.copy_paste_attempts DESC',
      fullscreen: 'ea.fullscreen_exits DESC',
      rapid:      'rapid_avg_secs ASC',
      composite:  'composite_risk DESC',
    };
    const sortKey     = req.query.sort || 'suspicion';
    const orderClause = SORT_MAP[sortKey] || SORT_MAP.suspicion;

    const rows = await q(`
      SELECT ea.attempt_id, u.full_name, u.email, ea.status, ea.suspicion_score,
             ea.tab_switches, ea.copy_paste_attempts, ea.fullscreen_exits,
             ea.ip_address,
             ea.score, ex.total_marks, ex.passing_marks, ex.title AS exam_title,
             (SELECT COUNT(*) FROM SuspicionFlags sf
              WHERE sf.attempt_id = ea.attempt_id AND sf.is_resolved = FALSE) AS open_flags,
             -- Rapid answering: avg seconds per question for this attempt
             (SELECT ROUND(AVG(sa.time_taken_seconds), 1)
              FROM StudentAnswers sa WHERE sa.attempt_id = ea.attempt_id) AS rapid_avg_secs,
             -- Multiple login: how many concurrent IPs were seen during this attempt
             (SELECT COUNT(DISTINCT ls.ip_address)
              FROM LoginSessions ls
              WHERE ls.user_id = ea.student_id
                AND ls.login_time <= COALESCE(ea.submitted_at, NOW())
                AND (ls.logout_time IS NULL OR ls.logout_time >= ea.started_at)) AS login_ip_count,
             -- Composite risk score (mirrors Q02)
             (ea.suspicion_score * 1.0 + ea.tab_switches * 3 + ea.copy_paste_attempts * 5) AS composite_risk
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE (ea.status IN ('flagged','timed_out') OR ea.suspicion_score >= 5)
        ${instrFilter}
      ORDER BY ${orderClause}`,
      [...instrParam]
    );

    const attempts = rows.map(r => {
      const sc     = r.suspicion_score;
      const passed = r.score != null && r.score >= r.passing_marks;

      const tabColor      = r.tab_switches >= 8         ? 'var(--red)'    : r.tab_switches >= 3       ? 'var(--yellow)' : 'var(--text3)';
      const pasteColor    = r.copy_paste_attempts >= 3   ? 'var(--red)'    : r.copy_paste_attempts > 0 ? 'var(--yellow)' : 'var(--text3)';
      const fullscreenColor = r.fullscreen_exits >= 3    ? 'var(--orange)' : r.fullscreen_exits > 0    ? 'var(--yellow)' : 'var(--text3)';
      const rapidColor    = r.rapid_avg_secs !== null && r.rapid_avg_secs < 15 ? 'var(--red)' : r.rapid_avg_secs < 30 ? 'var(--yellow)' : 'var(--text3)';
      const multiLoginColor = r.login_ip_count > 1      ? 'var(--red)'    : 'var(--text3)';

      const statusBadge = r.status === 'flagged' ? 'badge-red' : r.status === 'timed_out' ? 'badge-yellow' : 'badge-green';
      const statusText  = r.status === 'flagged' ? 'Flagged'   : r.status === 'timed_out' ? 'Timed Out'   : 'Submitted';
      const scoreText   = r.status === 'flagged' ? 'Under Review' : passed ? 'Pass' : 'Fail';
      const scoreBadge  = r.status === 'flagged' ? 'badge-yellow' : passed ? 'badge-green' : 'badge-red';

      return {
        name: r.full_name, email: r.email,
        examTitle: r.exam_title,
        attemptId: r.attempt_id,
        isLive: r.status === 'in_progress',
        statusBadge, statusText,
        suspicion: sc, suspColor: suspColor(sc),
        tabs:        r.tab_switches,        tabColor,
        paste:       r.copy_paste_attempts, pasteColor,
        fullscreen:  r.fullscreen_exits,    fullscreenColor,
        rapidAvg:    r.rapid_avg_secs !== null ? `${r.rapid_avg_secs}s` : '—', rapidColor,
        multiLogin:  r.login_ip_count > 1 ? `${r.login_ip_count} IPs` : '—', multiLoginColor,
        ipAddress:   r.ip_address,
        score: `${r.score ?? '—'}/${r.total_marks}`, scoreBadge, scoreText,
        openFlags: `${r.open_flags ?? 0} open`,
        flagBadge: (r.open_flags ?? 0) > 0 ? 'badge-red' : 'badge-gray',
      };
    });

    // Flags table — all exams
    const flagRows = await q(`
      SELECT sf.flag_id, sf.flag_type, sf.description, sf.detected_at,
             sf.is_resolved, ru.full_name AS resolved_by,
             u.full_name AS student_name, ex.title AS exam_title
      FROM SuspicionFlags sf
      JOIN ExamAttempts ea ON sf.attempt_id = ea.attempt_id
      JOIN Exams ex ON ea.exam_id = ex.exam_id
      JOIN Users u ON ea.student_id = u.user_id
      LEFT JOIN Users ru ON sf.resolved_by = ru.user_id
      WHERE 1=1 ${instrFilter}
      ORDER BY sf.is_resolved ASC, sf.detected_at DESC`,
      [...instrParam]
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
      examTitle:  f.exam_title,
      time:       new Date(f.detected_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      resolved:   !!f.is_resolved,
      resolvedBy: f.resolved_by || null,
    }));

    res.json({ attempts, flags });
});

// ── GET /api/logs ─────────────────────────────────────────────
route('get', '/api/logs', async (req, res) => {
    const { userId, roles } = await getUserWithRole(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasAnyRole(roles, 'admin', 'teacher'))
      return res.status(403).json({ error: 'Teacher or admin access required' });
    const logsIsTeacher  = hasAnyRole(roles, 'teacher') && !hasAnyRole(roles, 'admin');
    const logsFilter     = logsIsTeacher ? 'AND ex.created_by = ?' : '';
    const logsParam      = logsIsTeacher ? [userId] : [];
    // All attempts list for the selector (sorted by suspicion desc)
    const allAttempts = await q(`
      SELECT ea.attempt_id, u.full_name, ex.title AS exam_title,
             ea.suspicion_score, ea.status
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE 1=1 ${logsFilter}
      ORDER BY ea.suspicion_score DESC, ea.attempt_id`,
      [...logsParam]
    );

    // Pick the attempt to show: ?attempt_id=N or fallback to highest suspicion (teacher-scoped)
    const requestedId = parseInt(req.query.attempt_id) || null;
    const [attemptRows] = await pool.query(`
      SELECT ea.attempt_id, u.full_name, ea.suspicion_score,
             ea.tab_switches, ea.copy_paste_attempts,
             ea.score, ex.total_marks,
             TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_min
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      ${requestedId
        ? 'WHERE ea.attempt_id = ?'
        : `WHERE 1=1 ${logsFilter} ORDER BY ea.suspicion_score DESC LIMIT 1`}`,
      requestedId ? [requestedId] : [...logsParam]
    );
    const attempt = attemptRows[0];

    if (!attempt) {
      return res.json({
        badge: 'No attempt data',
        attemptId: null,
        allAttempts: allAttempts.map(a => ({
          attempt_id: a.attempt_id,
          label:      `${a.full_name} — ${a.exam_title} (suspicion: ${a.suspicion_score})`,
          suspicion:  a.suspicion_score,
          status:     a.status,
        })),
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
      EXAM_STARTED: '>', TAB_SWITCH: '<>', COPY_PASTE_DETECTED: 'CP',
      FULLSCREEN_EXIT: 'FS', DEVTOOLS_OPENED: 'DT', RAPID_ANSWERING: 'RQ',
      RIGHT_CLICK_ATTEMPT: 'RC', EXAM_SUBMITTED: 'OK', AUTO_SUBMITTED: 'TO',
      IDLE_WARNING: 'W!', PROCTOR_KICK: 'KK',
    };

    // Number repeated event types (e.g. TAB_SWITCH #1, #2 …)
    const typeCount = {};
    const timeline = events.map(e => {
      typeCount[e.event_type] = (typeCount[e.event_type] || 0) + 1;
      const n     = typeCount[e.event_type];
      const multi = ['TAB_SWITCH', 'COPY_PASTE_DETECTED'].includes(e.event_type);
      return {
        type:   e.event_type,
        dot:    dotMap[e.severity] || 'info',
        icon:   iconMap[e.event_type] || '•',
        title:  multi ? `${e.event_type} #${n}` : e.event_type,
        detail: e.event_details,
        time:   new Date(e.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      };
    });

    res.json({
      badge:       `${attempt.full_name} — Attempt #${attempt.attempt_id}`,
      attemptId:   attempt.attempt_id,
      allAttempts: allAttempts.map(a => ({
        attempt_id:    a.attempt_id,
        label:         `${a.full_name} — ${a.exam_title} (suspicion: ${a.suspicion_score})`,
        suspicion:     a.suspicion_score,
        status:        a.status,
      })),
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
});

// ── GET /api/student-view ─────────────────────────────────────
// Students always see their own view via session token.
// Admins/proctors/instructors may pass ?student_id=N.
route('get', '/api/student-view', async (req, res) => {
    const { userId: tokenUserId, role: tokenRole } = await getUserWithRole(req);

    let targetId;
    if (tokenRole === 'student') {
      targetId = tokenUserId;
    } else if (req.query.student_id) {
      targetId = parseInt(req.query.student_id);
    } else {
      const [[first]] = await pool.query(`SELECT user_id FROM Users WHERE role = 'student' ORDER BY user_id LIMIT 1`);
      targetId = first?.user_id;
    }

    const [[student]] = await pool.query(
      `SELECT user_id, full_name, email FROM Users WHERE user_id = ? AND role = 'student'`,
      [targetId]
    );
    if (!student) return res.json({ label: 'No student found', exams: [] });

    const exams = await q(`
      SELECT e.exam_id, e.title, c.course_code, c.course_name,
             e.total_marks, e.duration_minutes, e.window_start, e.window_end,
             e.passing_marks, e.max_attempts, e.is_published,
             ea.status, ea.score, ea.percentage, ea.attempt_id,
             (SELECT COUNT(*) FROM Questions q WHERE q.exam_id = e.exam_id) AS question_count
      FROM Enrollments enr
      JOIN Courses c ON enr.course_id = c.course_id
      JOIN Exams   e ON c.course_id   = e.course_id AND e.is_published = TRUE
      LEFT JOIN ExamAttempts ea ON e.exam_id = ea.exam_id AND ea.student_id = ?
      WHERE enr.student_id = ? AND enr.status = 'active'
      ORDER BY e.window_start DESC`,
      [student.user_id, student.user_id]
    );

    const now = new Date();
    const examCards = exams.map(e => {
      const isSubmitted = e.status && e.status !== 'abandoned';
      const isActive    = !isSubmitted && new Date(e.window_start) <= now && new Date(e.window_end) >= now;
      const isUpcoming  = !isSubmitted && new Date(e.window_start) > now;
      const passed      = e.score >= e.passing_marks;
      const pct         = e.percentage || 0;

      let statusBadge, statusText, action;
      if (isSubmitted) {
        statusBadge = 'badge-green'; statusText = 'Submitted';
        action = { label: 'View Results', cls: 'btn-outline', viewResult: true, attemptId: e.attempt_id };
      } else if (isActive) {
        statusBadge = 'badge-green'; statusText = 'Active — Open Now';
        action = { label: 'Start Exam', cls: 'btn-primary', startExam: true, examId: e.exam_id };
      } else if (isUpcoming) {
        statusBadge = 'badge-purple'; statusText = 'Upcoming';
        action = { label: 'Not Open Yet', cls: 'btn-outline' };
      } else {
        statusBadge = 'badge-gray'; statusText = 'Closed';
        action = { label: 'Window Closed', cls: 'btn-outline' };
      }

      const base = {
        title: e.title, course: `${e.course_code} · ${e.course_name}`,
        statusBadge, statusText,
        marks: e.total_marks, duration: `${e.duration_minutes} min`,
        questions: `${e.question_count} Q · ${e.max_attempts} attempt${e.max_attempts > 1 ? 's' : ''}`,
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
});

// ── GET /api/analytics ────────────────────────────────────────
route('get', '/api/analytics', async (req, res) => {
    const { userId, role } = await getUserWithRole(req);
    if (role === 'student')
      return res.status(403).json({ error: 'Students do not have access to analytics' });
    const isTeacher = role === 'teacher';
    const instrSql    = isTeacher ? 'AND e.created_by = ?' : '';
    const instrParams = isTeacher ? [userId] : [];

    // All published exams for the dropdown (instructor-scoped)
    const allExams = await q(
      `SELECT exam_id, title FROM Exams e WHERE is_published = TRUE ${instrSql} ORDER BY exam_id`,
      instrParams
    );

    const examIdParam = parseInt(req.query.exam_id) || null;
    const overall     = !examIdParam;

    // Summary stats — instructor-scoped if applicable
    let s, ev;
    if (overall) {
      const sWhere = (role === 'teacher') ? 'AND ex.created_by = ?' : '';
      [[s]] = await pool.query(`
        SELECT COUNT(*) AS total,
               SUM(ea.score >= ex.passing_marks)  AS passed,
               ROUND(AVG(ea.percentage), 1)        AS avg_pct,
               ROUND(AVG(ea.suspicion_score), 1)   AS avg_susp,
               'All Exams'                          AS exam_title
        FROM ExamAttempts ea
        JOIN Exams ex ON ea.exam_id = ex.exam_id
        WHERE ea.status IN ('submitted','graded','flagged') ${sWhere}`,
        instrParams);
      [[ev]] = await pool.query(
        `SELECT COUNT(*) AS total_events FROM ProctorLogs pl
         JOIN ExamAttempts ea ON pl.attempt_id = ea.attempt_id
         JOIN Exams ex ON ea.exam_id = ex.exam_id WHERE 1=1 ${sWhere}`,
        instrParams);
    } else {
      [[s]] = await pool.query(`
        SELECT COUNT(*) AS total,
               SUM(ea.score >= ex.passing_marks)  AS passed,
               ROUND(AVG(ea.percentage), 1)        AS avg_pct,
               ROUND(AVG(ea.suspicion_score), 1)   AS avg_susp,
               ex.title                            AS exam_title
        FROM ExamAttempts ea
        JOIN Exams ex ON ea.exam_id = ex.exam_id
        WHERE ea.exam_id = ? AND ea.status IN ('submitted','graded','flagged')
        GROUP BY ex.title`, [examIdParam]);
      [[ev]] = await pool.query(`
        SELECT COUNT(*) AS total_events FROM ProctorLogs pl
        JOIN ExamAttempts ea ON pl.attempt_id = ea.attempt_id
        WHERE ea.exam_id = ?`, [examIdParam]);
    }

    const passRate  = s?.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const examLabel = s?.exam_title || 'Exam';
    const stats = [
      { color: 'green',  label: 'Pass Rate',    value: `${passRate}%`, valueColor: 'var(--green)',  sub: `${s?.passed ?? 0} of ${s?.total ?? 0} submitted · ${examLabel}` },
      { color: 'purple', label: 'Avg Score',    value: s?.avg_pct ?? 0,                              sub: `Class average · ${examLabel}` },
      { color: 'yellow', label: 'Avg Suspicion', value: s?.avg_susp ?? 0, valueColor: 'var(--yellow)', sub: `per attempt · ${examLabel}` },
      { color: 'red',    label: 'Total Events', value: ev?.total_events ?? 0,                        sub: 'Proctoring events logged' },
    ];

    // Question difficulty (Q04) — all questions for specific exam, top 10 hardest overall
    const dInstrSql = (role === 'teacher') ? 'JOIN Exams e ON q.exam_id = e.exam_id AND e.created_by = ?' : '';
    const dRows = overall
      ? await q(`
          SELECT q.question_id, LEFT(q.question_text, 50) AS topic,
                 ROUND(AVG(sa.time_taken_seconds), 0)                                  AS avg_time,
                 ROUND(100.0 * SUM(sa.is_correct) / NULLIF(COUNT(sa.answer_id), 0), 0) AS correct_pct
          FROM Questions q
          ${dInstrSql}
          LEFT JOIN StudentAnswers sa ON q.question_id = sa.question_id
          GROUP BY q.question_id, q.question_text
          ORDER BY correct_pct ASC LIMIT 10`, instrParams)
      : await q(`
          SELECT q.question_id, LEFT(q.question_text, 50) AS topic,
                 ROUND(AVG(sa.time_taken_seconds), 0)                                  AS avg_time,
                 ROUND(100.0 * SUM(sa.is_correct) / NULLIF(COUNT(sa.answer_id), 0), 0) AS correct_pct
          FROM Questions q
          LEFT JOIN StudentAnswers sa ON q.question_id = sa.question_id
          WHERE q.exam_id = ?
          GROUP BY q.question_id, q.question_text
          ORDER BY correct_pct ASC`, [examIdParam]);

    const difficulty = dRows.map(r => {
      const p      = r.correct_pct ?? 0;
      const rating = p >= 80 ? 'Too Easy' : p >= 40 ? 'Good' : 'Hard';
      const badge  = p >= 80 ? 'badge-green' : p >= 40 ? 'badge-yellow' : 'badge-red';
      const color  = p >= 80 ? 'var(--green)' : p >= 40 ? 'var(--yellow)' : 'var(--red)';
      return { q: `Q${r.question_id}`, topic: r.topic, pct: `${p}%`, pctColor: color, time: `${r.avg_time ?? '?'}s`, badge, rating };
    });

    // Class ranking (Q10) — scoped to selected exam or overall, instructor-filtered
    const rWhere = overall
      ? `WHERE ea.status IN ('submitted','graded','flagged')${isTeacher ? ' AND ex.created_by = ?' : ''}`
      : `WHERE ea.exam_id = ? AND ea.status IN ('submitted','graded','flagged')`;
    const rParams = overall ? instrParams : [examIdParam];
    const rRows = await q(`
          SELECT u.full_name, ROUND(AVG(ea.percentage), 1)          AS avg_pct,
                 SUM(ea.score >= ex.passing_marks)                   AS passed,
                 ROUND(AVG(ea.suspicion_score), 1)                   AS avg_susp,
                 SUM(ea.status = 'flagged')                          AS flagged,
                 RANK() OVER (ORDER BY AVG(ea.percentage) DESC)      AS class_rank
          FROM ExamAttempts ea
          JOIN Users u  ON ea.student_id = u.user_id
          JOIN Exams ex ON ea.exam_id    = ex.exam_id
          ${rWhere}
          GROUP BY u.user_id, u.full_name
          ORDER BY avg_pct DESC`, rParams);

    const ranking = rRows.map(r => {
      const p  = r.avg_pct ?? 0;
      const sc = r.avg_susp ?? 0;
      const pctColor = p >= 75 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : 'var(--red)';
      return {
        rank:       r.class_rank,          // numeric; component prepends '#'
        name:       r.full_name,
        avgPct:     `${p}%`,
        avgScore:   `${p}%`,               // same value — component shows this as secondary
        examsPassed: r.passed > 0 ? `${r.passed} passed` : r.flagged > 0 ? 'Flagged' : 'Fail',
        pctColor,
        flag:       r.flagged > 0,
        passBadge:  r.passed > 0 ? 'badge-green' : r.flagged > 0 ? 'badge-yellow' : 'badge-red',
        passText:   r.passed > 0 ? 'Pass' : r.flagged > 0 ? '?' : 'Fail',
        susp: sc, suspColor: suspColor(sc),
      };
    });

    res.json({ exams: allExams, selectedExam: examIdParam, stats, difficulty, ranking });
});

// ── GET /api/schema ───────────────────────────────────────────
// Reads live metadata from INFORMATION_SCHEMA — truly DBMS-driven!
route('get', '/api/schema', async (req, res) => {
    const { userId } = await getUserWithRole(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
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
});

// ── GET /api/results ──────────────────────────────────────────
// Returns student results grouped by exam. Instructors see their exams only;
// students see only their own attempts. Admin sees all.
route('get', '/api/results', async (req, res) => {
    const { userId, role } = await getUserWithRole(req);

    let whereExtra = '';
    const whereParams = [];
    if (role === 'teacher') {
      whereExtra = 'AND ex.created_by = ?';
      whereParams.push(userId);
    } else if (role === 'student') {
      whereExtra = 'AND ea.student_id = ?';
      whereParams.push(userId);
    }
    if (req.query.exam_id) {
      whereExtra += ' AND ex.exam_id = ?';
      whereParams.push(parseInt(req.query.exam_id));
    }

    const rows = await q(`
      SELECT ea.attempt_id, u.full_name, ex.exam_id, ex.title AS exam_title,
             ea.score, ea.percentage, ex.total_marks, ex.passing_marks, ea.status,
             TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_min
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      WHERE ea.status IN ('submitted','graded','flagged','timed_out') ${whereExtra}
      ORDER BY ex.exam_id ASC, ea.percentage IS NULL ASC, ea.percentage DESC`,
      whereParams
    );

    // Group by exam
    const examMap = {};
    for (const r of rows) {
      if (!examMap[r.exam_id]) examMap[r.exam_id] = { exam_id: r.exam_id, title: r.exam_title, students: [] };
      const passed = r.score != null && r.score >= r.passing_marks;
      examMap[r.exam_id].students.push({
        name:       r.full_name,
        score:      r.score != null ? `${r.score}/${r.total_marks}` : `—/${r.total_marks}`,
        percentage: r.percentage != null ? `${r.percentage}%` : '—',
        result:     r.status === 'flagged' ? 'Under Review'
                  : r.status === 'timed_out' ? 'Timed Out'
                  : passed ? 'PASS' : 'FAIL',
        resultColor: r.status === 'flagged' ? 'var(--yellow)'
                   : r.status === 'timed_out' ? 'var(--orange)'
                   : passed ? 'var(--green)' : 'var(--red)',
        duration:   r.duration_min != null ? `${r.duration_min} min` : '—',
        attempt_id: r.attempt_id,
      });
    }

    // Overall class ranking — instructor-scoped if applicable
    let rankWhere = `WHERE ea.status IN ('submitted','graded','flagged')`;
    const rankParams = [];
    if (role === 'teacher') {
      rankWhere += ' AND ex.created_by = ?';
      rankParams.push(userId);
    }
    const rankRows = await q(`
      SELECT u.full_name,
             ROUND(AVG(ea.percentage), 1)                           AS avg_pct,
             ROUND(AVG(ea.score), 1)                                AS avg_score,
             SUM(ea.score >= ex.passing_marks)                      AS exams_passed,
             COUNT(ea.attempt_id)                                   AS exams_taken,
             RANK() OVER (ORDER BY AVG(ea.percentage) DESC)         AS class_rank
      FROM ExamAttempts ea
      JOIN Users u  ON ea.student_id = u.user_id
      JOIN Exams ex ON ea.exam_id    = ex.exam_id
      ${rankWhere}
      GROUP BY u.user_id, u.full_name
      ORDER BY avg_pct DESC`,
      rankParams
    );

    const ranking = rankRows.map(r => ({
      rank:        r.class_rank,
      name:        r.full_name,
      avgScore:    r.avg_score != null ? String(r.avg_score) : '—',
      avgPct:      r.avg_pct  != null ? `${r.avg_pct}%` : '—',
      pctColor:    r.avg_pct >= 75 ? 'var(--green)' : r.avg_pct >= 50 ? 'var(--yellow)' : 'var(--red)',
      examsPassed: `${r.exams_passed} / ${r.exams_taken}`,
    }));

    res.json({ exams: Object.values(examMap), ranking });
});

// ── GET /api/results/:attempt_id ──────────────────────────────
// Per-student detail: every question, what they answered, correct answer, marks.
route('get', '/api/results/:attempt_id', async (req, res) => {
  const attempt_id = parseInt(req.params.attempt_id);

  const [[attempt]] = await pool.execute(`
    SELECT u.full_name, ex.title AS exam_title, ex.total_marks, ex.passing_marks,
           ea.score, ea.percentage, ea.status,
           TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_min
    FROM ExamAttempts ea
    JOIN Users u  ON ea.student_id = u.user_id
    JOIN Exams ex ON ea.exam_id    = ex.exam_id
    WHERE ea.attempt_id = ?`, [attempt_id]);

  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

  const questions = await q(`
    SELECT q.question_id, q.question_text, q.marks,
           sa.selected_option, sa.is_correct, sa.marks_obtained,
           ROUND(sa.time_taken_seconds, 0) AS time_taken_seconds,
           q.correct_answer
    FROM Questions q
    LEFT JOIN StudentAnswers sa ON sa.question_id = q.question_id AND sa.attempt_id = ?
    JOIN ExamAttempts ea ON ea.attempt_id = ?
    WHERE q.exam_id = ea.exam_id
    ORDER BY q.question_id`, [attempt_id, attempt_id]);

  const passed = attempt.score != null && attempt.score >= attempt.passing_marks;

  res.json({
    student:    attempt.full_name,
    exam:       attempt.exam_title,
    score:      attempt.score != null ? `${attempt.score}/${attempt.total_marks}` : `—/${attempt.total_marks}`,
    percentage: attempt.percentage != null ? `${attempt.percentage}%` : '—',
    result:     attempt.status === 'flagged' ? 'Under Review'
              : attempt.status === 'timed_out' ? 'Timed Out'
              : passed ? 'PASS' : 'FAIL',
    resultColor: attempt.status === 'flagged' ? 'var(--yellow)'
               : attempt.status === 'timed_out' ? 'var(--orange)'
               : passed ? 'var(--green)' : 'var(--red)',
    duration:   attempt.duration_min != null ? `${attempt.duration_min} min` : '—',
    questions:  questions.map((q, i) => ({
      num:       i + 1,
      text:      q.question_text,
      marks:     q.marks,
      answered:  q.selected_option ?? '—',
      correct:   q.correct_answer,
      isCorrect: q.is_correct,
      earned:    q.marks_obtained ?? 0,
      timeSec:   q.time_taken_seconds ?? null,
    })),
  });
});

// ── GET /api/exams ────────────────────────────────────────────
route('get', '/api/exams', async (req, res) => {
    const { userId, roles } = await getUserWithRole(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    const isTeacher   = hasAnyRole(roles, 'teacher') && !hasAnyRole(roles, 'admin');
    const ownerSql    = isTeacher ? 'WHERE e.created_by = ?' : '';
    const ownerParams = isTeacher ? [userId] : [];

    const rows = await q(`
      SELECT
        e.exam_id,
        e.title,
        e.description,
        e.join_code,
        e.is_published,
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
        (SELECT COUNT(*) FROM Questions q WHERE q.exam_id = e.exam_id)       AS question_count,
        (SELECT COALESCE(SUM(q.marks),0) FROM Questions q WHERE q.exam_id = e.exam_id) AS questions_marks_total,
        (SELECT COUNT(*) FROM ExamAttempts ea2 WHERE ea2.exam_id=e.exam_id AND ea2.status='in_progress') AS live_count,
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
      ${ownerSql}
      GROUP BY e.exam_id, e.title, e.description, e.join_code, e.is_published, c.course_code, c.course_name,
               u.full_name, e.total_marks, e.passing_marks, e.duration_minutes,
               e.window_start, e.window_end, e.max_attempts,
               e.shuffle_questions, e.show_results_immediately
      ORDER BY e.window_start DESC`,
      ownerParams
    );

    const now = new Date();
    const exams = rows.map(r => {
      const start      = new Date(r.window_start);
      const end        = new Date(r.window_end);
      const published  = !!r.is_published;
      const draft      = !published;
      const upcoming   = published && now < start;
      const active     = published && now >= start && now <= end;
      const ended      = published && !upcoming && !active;
      const statusText  = draft ? 'Draft' : active ? 'Live' : ended ? 'Ended' : 'Upcoming';
      const statusBadge = draft ? 'badge-gray' : active ? 'badge-green' : ended ? 'badge-red' : 'badge-purple';
      const passRate = r.completed > 0
        ? Math.round((r.passed / r.completed) * 100) + '%'
        : '—';
      return {
        id:                r.exam_id,
        title:             r.title,
        joinCode:          r.join_code || null,
        course:            `${r.course_code} · ${r.course_name}`,
        courseCode:        r.course_code,
        instructor:        r.instructor,
        totalMarks:        parseFloat(r.total_marks),
        passingMarks:      r.passing_marks,
        marks:             `${r.passing_marks}/${r.total_marks}`,
        duration:          r.duration_minutes,
        durationFmt:       `${r.duration_minutes} min`,
        questions:         r.question_count,
        questionsTotalMarks: parseFloat(r.questions_marks_total) || 0,
        marksMismatch:     Math.abs(parseFloat(r.questions_marks_total) - parseFloat(r.total_marks)) > 0.01,
        window:            `${fmtDate(r.window_start)} → ${fmtDate(r.window_end)}`,
        statusText,
        statusBadge,
        isDraft:           draft,
        isActive:          active,
        isUpcoming:        upcoming,
        isEnded:           ended,
        liveCount:         r.live_count || 0,
        attempts:          r.total_attempts,
        completed:         r.completed || 0,
        flagged:           r.flagged   || 0,
        avgScore:          r.avg_pct   || '—',
        passRate,
        shuffle:           r.shuffle_questions  ? 'Yes' : '—',
        showResults:       r.show_results_immediately ? 'Yes' : '—',
        passingMarksRaw:   r.passing_marks,
        durationRaw:       r.duration_minutes,
        descriptionRaw:    r.description || '',
      };
    });

    res.json({ exams });
});

// ── GET /api/questions ────────────────────────────────────────
route('get', '/api/questions', async (req, res) => {
    const { userId, role } = await getUserWithRole(req);
    const ownerSql    = (role === 'teacher') ? 'AND e.created_by = ?' : '';
    const ownerParams = (role === 'teacher') ? [userId] : [];

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
        q.option_e, q.option_f, q.option_g, q.option_h, q.option_i, q.option_j,
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
      WHERE 1=1 ${ownerSql}
      GROUP BY q.question_id, q.exam_id, e.title, c.course_code,
               q.order_index, q.question_text, q.question_type,
               q.marks, q.difficulty_level,
               q.option_a, q.option_b, q.option_c, q.option_d,
               q.option_e, q.option_f, q.option_g, q.option_h, q.option_i, q.option_j,
               q.correct_answer
      ORDER BY q.exam_id ASC, q.order_index ASC`,
      ownerParams
    );

    const diffBadge = d => d === 'easy' ? 'badge-green' : d === 'medium' ? 'badge-yellow' : 'badge-red';
    const OPT_LABELS = ['A','B','C','D','E','F','G','H','I','J'];

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
        options: OPT_LABELS
          .map(l => ({ letter: l, text: r[`option_${l.toLowerCase()}`] }))
          .filter(o => o.text),
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
});

// ── PUT /api/questions/:id ────────────────────────────────────
// Teacher/admin edits a question even after the exam has started.
// If correct_answer or marks changed, re-grades existing StudentAnswers
// and recalculates score/percentage on all submitted/flagged attempts.
route('put', '/api/questions/:id', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers can edit questions' });

  const qId = parseInt(req.params.id);
  const {
    question_text, question_type, marks, difficulty_level, order_index,
    correct_answer,
    option_a, option_b, option_c, option_d, option_e,
    option_f, option_g, option_h, option_i, option_j,
  } = req.body;

  // Fetch current question to detect changes
  const [[old]] = await pool.execute(
    `SELECT q.*, e.created_by FROM Questions q JOIN Exams e ON q.exam_id=e.exam_id WHERE q.question_id=?`,
    [qId]
  );
  if (!old) return res.status(404).json({ error: 'Question not found' });
  if (!hasAnyRole(roles, 'admin') && old.created_by !== userId)
    return res.status(403).json({ error: 'You do not own this exam' });

  await pool.execute(
    `UPDATE Questions SET
       question_text   = COALESCE(?, question_text),
       question_type   = COALESCE(?, question_type),
       marks           = COALESCE(?, marks),
       difficulty_level= COALESCE(?, difficulty_level),
       order_index     = COALESCE(?, order_index),
       correct_answer  = ?,
       option_a=COALESCE(?,option_a), option_b=COALESCE(?,option_b),
       option_c=COALESCE(?,option_c), option_d=COALESCE(?,option_d),
       option_e=COALESCE(?,option_e), option_f=COALESCE(?,option_f),
       option_g=COALESCE(?,option_g), option_h=COALESCE(?,option_h),
       option_i=COALESCE(?,option_i), option_j=COALESCE(?,option_j)
     WHERE question_id=?`,
    [
      question_text ?? null, question_type ?? null, marks ?? null,
      difficulty_level ?? null, order_index ?? null,
      correct_answer !== undefined ? correct_answer : old.correct_answer,
      option_a ?? null, option_b ?? null, option_c ?? null, option_d ?? null,
      option_e ?? null, option_f ?? null, option_g ?? null, option_h ?? null,
      option_i ?? null, option_j ?? null,
      qId,
    ]
  );

  // Re-grade if correct_answer or marks changed
  const newCorrect = correct_answer !== undefined ? correct_answer : old.correct_answer;
  const newMarks   = marks !== undefined ? parseFloat(marks) : parseFloat(old.marks);
  const answerChanged = newCorrect !== old.correct_answer;
  const marksChanged  = Math.abs(newMarks - parseFloat(old.marks)) > 0.001;

  if ((answerChanged || marksChanged) && old.question_type !== 'SHORT_ANSWER') {
    // Re-grade StudentAnswers for this question
    await pool.execute(
      `UPDATE StudentAnswers
       SET is_correct     = (selected_option = ?),
           marks_obtained = IF(selected_option = ?, ?, 0)
       WHERE question_id = ?`,
      [newCorrect, newCorrect, newMarks, qId]
    );

    // Recalculate score + percentage for every affected attempt
    const [affected] = await pool.execute(
      `SELECT DISTINCT sa.attempt_id FROM StudentAnswers sa WHERE sa.question_id=?`, [qId]
    );
    for (const row of affected) {
      const [[sums]] = await pool.execute(
        `SELECT COALESCE(SUM(sa.marks_obtained),0) AS score, e.total_marks
         FROM StudentAnswers sa
         JOIN ExamAttempts ea ON sa.attempt_id=ea.attempt_id
         JOIN Exams e ON ea.exam_id=e.exam_id
         WHERE sa.attempt_id=?`, [row.attempt_id]
      );
      const pct = sums.total_marks > 0
        ? Math.round((sums.score / sums.total_marks) * 10000) / 100
        : 0;
      await pool.execute(
        `UPDATE ExamAttempts SET score=?, percentage=?
         WHERE attempt_id=? AND status IN ('submitted','graded','flagged','timed_out')`,
        [sums.score, pct, row.attempt_id]
      );
    }
  }

  res.json({ success: true, reGraded: answerChanged || marksChanged });
});

// ── GET /api/export ───────────────────────────────────────────
// Generates and streams a CSV report of all exam attempts.
// Admin only.
route('get', '/api/export', async (req, res) => {
  const { role } = await getUserWithRole(req);
  if (role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
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
      'Suspicion Score', 'Tab Switches', 'Copy-Paste', 'Fullscreen Exits',
      'IP Address', 'Started', 'Submitted', 'Duration (min)',
    ]));
    for (const a of attempts) {
      lines.push(row([
        a.student_name, a.email, a.exam_title, a.course_code,
        a.attempt_id, a.score, a.total_marks, a.percentage, a.result, a.status,
        a.suspicion_score, a.tab_switches, a.copy_paste_attempts, a.fullscreen_exits,
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
});

// ── GET /api/courses ──────────────────────────────────────────
route('get', '/api/courses', async (req, res) => {
  const { userId, role } = await getUserWithRole(req);
  const ownerSql    = (role === 'teacher') ? 'AND c.instructor_id = ?' : '';
  const ownerParams = (role === 'teacher') ? [userId] : [];
  const rows = await q(
    `SELECT c.course_id, c.course_code, c.course_name, c.description, c.instructor_id, u.full_name AS instructor
     FROM Courses c JOIN Users u ON c.instructor_id = u.user_id
     WHERE c.is_active = TRUE ${ownerSql} ORDER BY c.course_name`,
    ownerParams
  );
  res.json({ courses: rows, userId });
});

// ── POST /api/exams ───────────────────────────────────────────
route('post', '/api/exams', async (req, res) => {
  const {
    course_id, title, description, total_marks, passing_marks,
    duration_minutes, window_start, window_end, max_attempts,
    shuffle_questions, show_results_immediately, is_published,
  } = req.body;

  const { userId: created_by, roles: creatorRoles } = await getUserWithRole(req);
  if (!created_by) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(creatorRoles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can create exams' });

  // Server-side validation (mirrors DB CHECK constraints)
  const tm = parseFloat(total_marks);
  const pm = parseFloat(passing_marks);
  const dur = parseInt(duration_minutes);
  const ws = new Date(window_start);
  const we = new Date(window_end);

  if (!course_id || !title || !total_marks || !passing_marks || !duration_minutes || !window_start || !window_end)
    return res.status(400).json({ error: 'Missing required fields: course, title, marks, duration, window' });
  if (isNaN(tm) || tm <= 0)
    return res.status(400).json({ error: 'total_marks must be > 0' });
  if (isNaN(pm) || pm < 0 || pm > tm)
    return res.status(400).json({ error: 'passing_marks must be between 0 and total_marks' });
  if (isNaN(dur) || dur <= 0)
    return res.status(400).json({ error: 'duration_minutes must be > 0' });
  if (isNaN(ws.getTime()) || isNaN(we.getTime()) || we <= ws)
    return res.status(400).json({ error: 'window_end must be after window_start' });

  const [result] = await pool.execute(
    `INSERT INTO Exams
       (course_id, title, description, total_marks, passing_marks,
        duration_minutes, window_start, window_end, max_attempts,
        shuffle_questions, show_results_immediately, is_published, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      course_id, title, description || null, tm, pm,
      dur, window_start, window_end, max_attempts || 1,
      shuffle_questions ? 1 : 0, show_results_immediately ? 1 : 0, is_published ? 1 : 0,
      created_by,
    ]
  );
  res.json({ success: true, exam_id: result.insertId });
});

// ── DELETE /api/exams/:id ─────────────────────────────────────
// Cascade order (FK constraints are RESTRICT by default):
//   ExamAttempts → cascades to StudentAnswers, ProctorLogs, SuspicionFlags
//   then Exams   → cascades to Questions
route('delete', '/api/exams/:id', async (req, res) => {
  const { userId: delUserId, roles: delRoles } = await getUserWithRole(req);
  if (!delUserId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(delRoles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can delete exams' });
  const [[examRow]] = await pool.execute(`SELECT exam_id FROM Exams WHERE exam_id=?`, [req.params.id]);
  if (!examRow) return res.status(404).json({ error: 'Exam not found' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM ExamAttempts WHERE exam_id = ?`, [req.params.id]);
    await conn.execute(`DELETE FROM Exams WHERE exam_id = ?`, [req.params.id]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── PATCH /api/exams/:id/open ─────────────────────────────────
// Opens an exam immediately. Body: { duration_hours }
route('patch', '/api/exams/:id/open', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can open exams' });
  const examId      = parseInt(req.params.id);
  const durationHrs = parseFloat(req.body.duration_hours) || 2;

  // Ownership check
  if (role === 'teacher') {
    const rows = await q(`SELECT created_by FROM Exams WHERE exam_id = ?`, [examId]);
    if (!rows.length || rows[0].created_by !== userId)
      return res.status(403).json({ error: 'You can only open your own exams.' });
  }

  // ── Hard block 1: exam must have at least 1 question ─────────
  const [[qCount]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM Questions WHERE exam_id = ?`, [examId]
  );
  if (qCount.cnt === 0)
    return res.status(400).json({ error: 'Cannot open an exam with no questions. Add at least one question first.' });

  // ── Hard block 2: question marks total must equal declared total_marks ──
  const [[examRow]] = await pool.execute(
    `SELECT e.total_marks,
            COALESCE(SUM(q.marks), 0) AS questions_total
     FROM Exams e
     LEFT JOIN Questions q ON q.exam_id = e.exam_id
     WHERE e.exam_id = ?
     GROUP BY e.exam_id`, [examId]
  );
  if (Math.abs(parseFloat(examRow.questions_total) - parseFloat(examRow.total_marks)) > 0.01)
    return res.status(400).json({
      error: `Marks mismatch: questions sum to ${examRow.questions_total} but exam declares ${examRow.total_marks}. Adjust question marks or the exam total before opening.`
    });

  // Generate join_code if exam doesn't have one yet
  const [[codeRow]] = await pool.execute(
    `SELECT join_code FROM Exams WHERE exam_id = ?`, [examId]
  );
  let join_code = codeRow?.join_code;
  if (!join_code) {
    let tries = 0;
    do {
      join_code = makeJoinCode();
      const [[exists]] = await pool.execute(`SELECT exam_id FROM Exams WHERE join_code=?`, [join_code]);
      if (!exists) break;
    } while (++tries < 10);
    await pool.execute(`UPDATE Exams SET join_code=? WHERE exam_id=?`, [join_code, examId]);
  }

  await pool.execute(
    `UPDATE Exams
     SET is_published = TRUE,
         window_start = NOW(),
         window_end   = DATE_ADD(NOW(), INTERVAL ? HOUR)
     WHERE exam_id = ?`,
    [durationHrs, examId]
  );

  res.json({ success: true, join_code });
});

// ── PATCH /api/exams/:id/close ────────────────────────────────
// Closes an exam immediately by setting window_end to NOW. Instructor must own the exam.
route('patch', '/api/exams/:id/close', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can close exams' });
  const examId = parseInt(req.params.id);

  if (role === 'teacher' || role === 'proctor') {
    const rows = await q(`SELECT created_by FROM Exams WHERE exam_id = ?`, [examId]);
    if (!rows.length || rows[0].created_by !== userId)
      return res.status(403).json({ error: 'You can only close your own exams.' });
  }

  await pool.execute(
    `UPDATE Exams SET window_end = NOW() WHERE exam_id = ?`,
    [examId]
  );
  res.json({ success: true });
});

// ── POST /api/questions ───────────────────────────────────────
route('post', '/api/questions', async (req, res) => {
  const { userId: qUserId, roles: qRoles } = await getUserWithRole(req);
  if (!qUserId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(qRoles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can add questions' });

  const {
    exam_id, question_text, question_type, marks,
    option_a, option_b, option_c, option_d,
    option_e, option_f, option_g, option_h, option_i, option_j,
    correct_answer, difficulty_level, order_index,
  } = req.body;

  const qtype = question_type || 'MCQ';
  const m = parseFloat(marks);

  if (!exam_id || !question_text)
    return res.status(400).json({ error: 'Missing required fields: exam_id, question_text' });
  if (isNaN(m) || m <= 0)
    return res.status(400).json({ error: 'marks must be > 0' });

  // Block adding questions to finished exams; update total_marks for live exams
  const [[examRow]] = await pool.execute(
    `SELECT window_start, window_end, total_marks FROM Exams WHERE exam_id = ?`, [exam_id]
  );
  if (!examRow) return res.status(404).json({ error: 'Exam not found' });
  const now = new Date();
  const isFinished = examRow.window_end && new Date(examRow.window_end) < now;
  if (isFinished)
    return res.status(400).json({ error: 'Cannot add questions to a finished exam.' });
  const isLive = examRow.window_start && new Date(examRow.window_start) <= now &&
                 examRow.window_end && new Date(examRow.window_end) >= now;

  if (qtype === 'MCQ') {
    const opts = { A: option_a, B: option_b, C: option_c, D: option_d,
                   E: option_e, F: option_f, G: option_g, H: option_h,
                   I: option_i, J: option_j };
    const provided = Object.entries(opts).filter(([, v]) => v && v.trim());
    if (provided.length < 2)
      return res.status(400).json({ error: 'MCQ questions require at least 2 options' });
    if (correct_answer) {
      const validKeys = provided.map(([k]) => k);
      const ans = correct_answer.toUpperCase();
      if (!validKeys.includes(ans))
        return res.status(400).json({ error: `MCQ correct_answer must be one of: ${validKeys.join(', ')}` });
    }
  }
  if (qtype === 'TRUE_FALSE' && correct_answer &&
      !['TRUE','FALSE'].includes(correct_answer.toUpperCase()))
    return res.status(400).json({ error: 'TRUE_FALSE correct_answer must be TRUE or FALSE' });

  const [result] = await pool.execute(
    `INSERT INTO Questions
       (exam_id, question_text, question_type, marks,
        option_a, option_b, option_c, option_d,
        option_e, option_f, option_g, option_h, option_i, option_j,
        correct_answer, difficulty_level, order_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      exam_id, question_text, qtype, m,
      option_a||null, option_b||null, option_c||null, option_d||null,
      option_e||null, option_f||null, option_g||null, option_h||null,
      option_i||null, option_j||null,
      correct_answer || null, difficulty_level || 'medium', order_index || 0,
    ]
  );
  // If live, sync total_marks to actual sum of question marks
  if (isLive) {
    await pool.execute(
      `UPDATE Exams SET total_marks = (SELECT COALESCE(SUM(marks),0) FROM Questions WHERE exam_id = ?) WHERE exam_id = ?`,
      [exam_id, exam_id]
    );
  }
  res.json({ success: true, question_id: result.insertId, liveUpdate: isLive });
});

// ── DELETE /api/questions/:id ─────────────────────────────────
// StudentAnswers.fk_answers_question is ON DELETE RESTRICT — delete answers first.
route('delete', '/api/questions/:id', async (req, res) => {
  await pool.execute(`DELETE FROM StudentAnswers WHERE question_id = ?`, [req.params.id]);
  await pool.execute(`DELETE FROM Questions WHERE question_id = ?`, [req.params.id]);
  res.json({ success: true });
});

// ── POST /api/flags/:id/resolve ───────────────────────────────
route('post', '/api/flags/:id/resolve', async (req, res) => {
  const notes = req.body.notes || 'Reviewed and resolved by admin.';
  const resolvedBy = await getUserFromToken(req);
  await pool.execute(
    `UPDATE SuspicionFlags
     SET is_resolved = TRUE, resolved_by = ?, resolved_at = NOW(), resolution_notes = ?
     WHERE flag_id = ?`,
    [resolvedBy, notes, req.params.id]
  );
  res.json({ success: true });
});

// ── POST /api/proctor-event ───────────────────────────────────
// T4 fires after INSERT to update suspicion_score; T5 auto-flags if threshold crossed.
route('post', '/api/proctor-event', async (req, res) => {
  const { userId } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { attempt_id, event_type, severity, details } = req.body;
  if (!attempt_id || !event_type)
    return res.status(400).json({ error: 'attempt_id and event_type are required' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();

  // Ensure the caller owns this attempt (prevent forged events for other students)
  const ownerRows = await q(`SELECT student_id FROM ExamAttempts WHERE attempt_id = ?`, [attempt_id]);
  if (!ownerRows.length || ownerRows[0].student_id !== userId)
    return res.status(403).json({ error: 'Not authorised to log events for this attempt' });
  await pool.execute(
    `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [attempt_id, event_type, severity || 'MEDIUM', details || null, ip]
  );
  res.json({ success: true });
});

// ── POST /api/signup ──────────────────────────────────────────
// Creates a new user. `roles` array from signup form;
// primary role is first; extras go into UserRoles.
route('post', '/api/signup', async (req, res) => {
  const { full_name, username, password, roles } = req.body;
  if (!full_name || !username || !password || !roles || !roles.length)
    return res.status(400).json({ error: 'full_name, username, password and roles are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  // Validate username: 3–30 chars, letters/numbers/underscore/dot/@ allowed
  if (!/^[\w.@]{3,30}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, _ . @)' });

  const ALLOWED_ROLES = ['student', 'teacher'];
  const badRole = roles.find(r => !ALLOWED_ROLES.includes(r));
  if (badRole)
    return res.status(400).json({ error: `Invalid role '${badRole}'. Allowed: student, teacher` });

  // Determine primary role (student < teacher, admin only via DB)
  const RANK = { student: 1, teacher: 2 };
  const primaryRole = roles.reduce((best, r) => (RANK[r] || 0) > (RANK[best] || 0) ? r : best, roles[0]);
  const extraRoles  = roles.filter(r => r !== primaryRole);

  const hash  = hashPw(password);
  const email = `${username.replace(/@/g, '.')}@examguard.local`;   // synthetic email; @ in username → dot to keep email valid

  let result;
  try {
    [result] = await pool.execute(
      `INSERT INTO Users (email, password_hash, full_name, role, username) VALUES (?,?,?,?,?)`,
      [email, hash, full_name.trim(), primaryRole, username.toLowerCase()]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already taken. Please choose another.' });
    throw e;
  }
  const user_id = result.insertId;

  for (const role of extraRoles)
    await pool.execute(`INSERT INTO UserRoles (user_id, role) VALUES (?,?)`, [user_id, role]);

  res.json({ success: true, user_id });
});

// ── POST /api/login ───────────────────────────────────────────
// Accepts username OR email as `identifier`.
route('post', '/api/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password)
    return res.status(400).json({ error: 'Username and password are required' });

  const rows = await q(
    `SELECT user_id, full_name, email, username, role, password_hash
     FROM Users WHERE (username = ? OR email = ?) AND is_active = TRUE`,
    [identifier, identifier]
  );
  if (!rows.length || !checkPw(password, rows[0].password_hash))
    return res.status(400).json({ error: 'Invalid username or password' });

  const user  = rows[0];

  // Gather all roles (primary + any extras from UserRoles)
  const extraRows = await q(`SELECT role FROM UserRoles WHERE user_id = ?`, [user.user_id]);
  const roles = [user.role, ...extraRows.map(r => r.role)].filter((v, i, a) => a.indexOf(v) === i);

  const token  = crypto.randomBytes(32).toString('hex');
  const ip     = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
  const device = (req.headers['user-agent'] || 'unknown').substring(0, 255);

  // Record LoginSession — T7 fires here to detect concurrent logins
  await pool.execute(
    `INSERT INTO LoginSessions (user_id, ip_address, device_fingerprint, session_token) VALUES (?,?,?,?)`,
    [user.user_id, ip, device, token]
  );
  await pool.execute(`UPDATE Users SET last_login = NOW() WHERE user_id = ?`, [user.user_id]);

  res.json({ user_id: user.user_id, full_name: user.full_name, email: user.email,
             username: user.username, role: user.role, roles, token });
});

// ── POST /api/logout ──────────────────────────────────────────
route('post', '/api/logout', async (req, res) => {
  const { token } = req.body;
  if (token)
    await pool.execute(
      `UPDATE LoginSessions SET is_active = FALSE, logout_time = NOW() WHERE session_token = ?`,
      [token]
    );
  res.json({ success: true });
});

// ── GET /api/users/instructors ────────────────────────────────
route('get', '/api/users/instructors', async (_req, res) => {
  const rows = await q(
    `SELECT user_id, full_name, email FROM Users
     WHERE role IN ('instructor','teacher','admin') AND is_active = TRUE ORDER BY full_name`
  );
  res.json({ instructors: rows });
});

// ── GET /api/courses/all ──────────────────────────────────────
route('get', '/api/courses/all', async (_req, res) => {
  const rows = await q(`
    SELECT c.course_id, c.course_code, c.course_name, c.description,
           u.full_name AS instructor, u.user_id AS instructor_id,
           COUNT(DISTINCT e.exam_id)      AS exam_count,
           COUNT(DISTINCT enr.enrollment_id) AS student_count
    FROM   Courses c
    JOIN   Users        u   ON c.instructor_id  = u.user_id
    LEFT   JOIN Exams   e   ON c.course_id       = e.course_id
    LEFT   JOIN Enrollments enr ON c.course_id   = enr.course_id AND enr.status = 'active'
    WHERE  c.is_active = TRUE
    GROUP  BY c.course_id, c.course_code, c.course_name, c.description, u.full_name, u.user_id
    ORDER  BY c.course_name`
  );
  res.json({ courses: rows });
});

// ── POST /api/courses ─────────────────────────────────────────
route('post', '/api/courses', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers and admins can create courses' });

  const { course_code, course_name, description, instructor_id } = req.body;
  if (!course_code || !course_name || !instructor_id)
    return res.status(400).json({ error: 'course_code, course_name and instructor_id are required' });

  // Instructors/teachers can only create courses for themselves
  const isTeacherRole = role === 'teacher';
  const effectiveInstructorId = isTeacherRole ? userId : parseInt(instructor_id);
  if (isTeacherRole && parseInt(instructor_id) !== userId)
    return res.status(403).json({ error: 'Instructors can only create courses for themselves.' });

  const [result] = await pool.execute(
    `INSERT INTO Courses (course_code, course_name, description, instructor_id) VALUES (?,?,?,?)`,
    [course_code, course_name, description || null, effectiveInstructorId]
  );
  res.json({ success: true, course_id: result.insertId });
});

// ── PATCH /api/courses/:id ────────────────────────────────────
route('patch', '/api/courses/:id', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin')) return res.status(403).json({ error: 'Forbidden' });
  const { course_name, description } = req.body;
  if (!course_name || !course_name.trim())
    return res.status(400).json({ error: 'course_name is required' });
  const [[c]] = await pool.execute(`SELECT instructor_id FROM Courses WHERE course_id = ?`, [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  if (role === 'teacher' && c.instructor_id !== userId)
    return res.status(403).json({ error: 'You can only edit your own courses' });
  await pool.execute(
    `UPDATE Courses SET course_name = ?, description = ? WHERE course_id = ?`,
    [course_name.trim(), description || null, req.params.id]
  );
  res.json({ success: true });
});

// ── DELETE /api/courses/:id (soft-delete) ─────────────────────
route('delete', '/api/courses/:id', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin')) return res.status(403).json({ error: 'Forbidden' });
  const [[c]] = await pool.execute(`SELECT instructor_id FROM Courses WHERE course_id = ?`, [req.params.id]);
  if (c && role === 'teacher' && c.instructor_id !== userId)
    return res.status(403).json({ error: 'You can only deactivate your own courses' });
  await pool.execute(`UPDATE Courses SET is_active = FALSE WHERE course_id = ?`, [req.params.id]);
  res.json({ success: true });
});

// ── PATCH /api/exams/:id ──────────────────────────────────────
route('patch', '/api/exams/:id', async (req, res) => {
  const { userId, role, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin')) return res.status(403).json({ error: 'Forbidden' });
  const [[ex]] = await pool.execute(`SELECT created_by FROM Exams WHERE exam_id = ?`, [req.params.id]);
  if (!ex) return res.status(404).json({ error: 'Exam not found' });
  if (role === 'teacher' && ex.created_by !== userId)
    return res.status(403).json({ error: 'You can only edit your own exams' });
  const { title, description, passing_marks, duration_minutes, total_marks } = req.body;
  const fields = [];
  const vals = [];
  if (title)            { fields.push('title = ?');            vals.push(title.trim()); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description || null); }
  if (passing_marks)    { fields.push('passing_marks = ?');    vals.push(parseFloat(passing_marks)); }
  if (duration_minutes) { fields.push('duration_minutes = ?'); vals.push(parseInt(duration_minutes)); }
  if (total_marks)      { fields.push('total_marks = ?');      vals.push(parseFloat(total_marks)); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  await pool.execute(`UPDATE Exams SET ${fields.join(', ')} WHERE exam_id = ?`, vals);
  res.json({ success: true });
});

// ── CLASSROOM ENDPOINTS ───────────────────────────────────────
// One active classroom at a time: proctor creates it (gets a code),
// students enter the code to auto-enroll + start their attempt.

// Generate a random 6-char join code (uppercase, no O/0/I/1/L)
function makeJoinCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// GET /api/classroom/active — returns live/scheduled exams owned by this teacher
route('get', '/api/classroom/active', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const isAdmin   = hasAnyRole(roles, 'admin');
  const ownerSql  = isAdmin ? '' : 'AND e.created_by = ?';
  const ownerParam = isAdmin ? [] : [userId];

  const rows = await q(
    `SELECT e.exam_id, e.title, e.join_code, e.duration_minutes,
            e.total_marks, e.passing_marks, e.window_start, e.window_end,
            c.course_name,
            CASE WHEN NOW() BETWEEN e.window_start AND e.window_end THEN 'live'
                 WHEN NOW() < e.window_start THEN 'scheduled'
                 ELSE 'ended' END                                                AS classroom_status,
            (SELECT COUNT(*) FROM ExamAttempts ea WHERE ea.exam_id=e.exam_id AND ea.status='in_progress') AS live_count,
            (SELECT COUNT(*) FROM ExamAttempts ea WHERE ea.exam_id=e.exam_id) AS total_joined
     FROM   Exams e JOIN Courses c ON e.course_id=c.course_id
     WHERE  e.is_published=TRUE AND e.window_end>=NOW() AND e.join_code IS NOT NULL ${ownerSql}
     ORDER  BY e.window_start ASC`,
    ownerParam
  );
  // Return both: `classrooms` array (live + scheduled) and legacy `classroom` (first live) for backward compat
  const live = rows.find(r => r.classroom_status === 'live') || null;
  res.json({ classroom: live, classrooms: rows });
});

// POST /api/classroom/create — teacher/admin creates a new live classroom
route('post', '/api/classroom/create', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'teacher', 'admin'))
    return res.status(403).json({ error: 'Only teachers can create classrooms' });

  const { title, duration_minutes = 60, total_marks = 100, passing_marks = 40 } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  // Create a dedicated course for each session (named after the exam title)
  const [[defaultCourse]] = await pool.execute(
    `SELECT course_id FROM Courses WHERE instructor_id=? AND course_code NOT LIKE 'ROOM%' LIMIT 1`, [userId]
  );
  let course_id;
  if (defaultCourse) {
    course_id = defaultCourse.course_id;
  } else {
    const [cr] = await pool.execute(
      `INSERT INTO Courses (course_code, course_name, description, instructor_id)
       VALUES (?,?,?,?)`,
      [`ROOM${Date.now()}`.substring(0, 20), title, 'Auto-created classroom', userId]
    );
    course_id = cr.insertId;
  }

  // Generate a unique join code
  let join_code, tries = 0;
  do {
    join_code = makeJoinCode();
    const [[exists]] = await pool.execute(`SELECT exam_id FROM Exams WHERE join_code=?`, [join_code]);
    if (!exists) break;
  } while (++tries < 10);

  const [result] = await pool.execute(
    `INSERT INTO Exams
       (course_id, title, total_marks, passing_marks, duration_minutes,
        window_start, window_end, created_by, is_published, max_attempts,
        shuffle_questions, show_results_immediately, join_code)
     VALUES (?,?,?,?,?,NOW(),DATE_ADD(NOW(), INTERVAL 8 HOUR),?,TRUE,99,FALSE,FALSE,?)`,
    [course_id, title, total_marks, passing_marks, duration_minutes, userId, join_code]
  );

  res.json({ success: true, exam_id: result.insertId, join_code });
});

// POST /api/classroom/join — student enters join code to auto-enroll + start attempt
route('post', '/api/classroom/join', async (req, res) => {
  const student_id = await getUserFromToken(req);
  if (!student_id) return res.status(401).json({ error: 'Not authenticated' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });

  const [[exam]] = await pool.execute(
    `SELECT e.exam_id, e.course_id, e.title, e.duration_minutes,
            e.total_marks, e.passing_marks, e.window_start, e.window_end
     FROM   Exams e
     WHERE  e.join_code = ? AND e.is_published=TRUE
       AND  e.window_start<=NOW() AND e.window_end>=NOW()`,
    [code.toUpperCase().trim()]
  );
  if (!exam) return res.status(404).json({ error: 'No active classroom with that code. Check the code and try again.' });

  const ip      = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
  const browser = (req.headers['user-agent'] || 'unknown').substring(0, 255);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Auto-enroll student in the course (ignore if already enrolled)
    await conn.execute(
      `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
      [student_id, exam.course_id]
    );

    // Check if already has an in-progress attempt
    const [[existing]] = await conn.execute(
      `SELECT attempt_id FROM ExamAttempts WHERE exam_id=? AND student_id=? AND status='in_progress'`,
      [exam.exam_id, student_id]
    );
    if (existing) {
      // Resume existing attempt
      await conn.commit();
      const [questions] = await conn.execute(
        `SELECT question_id, question_text, question_type, marks,
                option_a, option_b, option_c, option_d, option_e, option_f,
                option_g, option_h, option_i, option_j, order_index, difficulty_level
         FROM   Questions WHERE exam_id=? ORDER BY order_index ASC, question_id ASC`,
        [exam.exam_id]
      );
      const [[resumedAttempt]] = await conn.execute(
        `SELECT started_at FROM ExamAttempts WHERE attempt_id=?`, [existing.attempt_id]
      );
      return res.json({ attempt_id: existing.attempt_id, exam, questions, resumed: true,
                        started_at: resumedAttempt?.started_at || null });
    }

    // T1 fires: validates window + attempt limit
    const [result] = await conn.execute(
      `INSERT INTO ExamAttempts (exam_id, student_id, ip_address, browser_info) VALUES (?,?,?,?)`,
      [exam.exam_id, student_id, ip, browser]
    );
    const attempt_id = result.insertId;

    await conn.execute(
      `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
       VALUES (?,?,?,?,?)`,
      [attempt_id, 'EXAM_STARTED', 'INFO', `Joined via code ${code.toUpperCase()}. Browser: ${browser}`, ip]
    );

    await conn.commit();

    const [questions] = await conn.execute(
      `SELECT question_id, question_text, question_type, marks,
              option_a, option_b, option_c, option_d,
              option_e, option_f, option_g, option_h, option_i, option_j,
              order_index, difficulty_level
       FROM   Questions WHERE exam_id=? ORDER BY order_index ASC, question_id ASC`,
      [exam.exam_id]
    );

    const [[newAttempt]] = await conn.execute(
      `SELECT started_at FROM ExamAttempts WHERE attempt_id=?`, [attempt_id]
    );
    res.json({ attempt_id, exam, questions, resumed: false,
               started_at: newAttempt?.started_at || null });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── POST /api/exams/:id/start ─────────────────────────────────
// Creates ExamAttempt (T1 validates window/attempts), logs EXAM_STARTED.
// Returns attempt_id + questions (no correct_answer) + exam meta.
route('post', '/api/exams/:id/start', async (req, res) => {
  const student_id = await getUserFromToken(req);
  if (!student_id) return res.status(401).json({ error: 'Not authenticated' });
  const exam_id = parseInt(req.params.id);
  const ip      = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].trim();
  const browser = (req.headers['user-agent'] || 'unknown').substring(0, 255);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check enrollment
    const [[enr]] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM Enrollments e
       JOIN Exams ex ON e.course_id = ex.course_id
       WHERE e.student_id = ? AND ex.exam_id = ? AND e.status = 'active'`,
      [student_id, exam_id]
    );
    if (!enr.cnt) throw new Error('You are not enrolled in this exam\'s course.');

    // Insert attempt — T1 fires (window, published, attempt-limit checks)
    const [result] = await conn.execute(
      `INSERT INTO ExamAttempts (exam_id, student_id, ip_address, browser_info) VALUES (?,?,?,?)`,
      [exam_id, student_id, ip, browser]
    );
    const attempt_id = result.insertId;

    // Log exam start event
    await conn.execute(
      `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
       VALUES (?,?,?,?,?)`,
      [attempt_id, 'EXAM_STARTED', 'INFO', `Exam started. Browser: ${browser}`, ip]
    );

    await conn.commit();

    // Return questions WITHOUT correct_answer
    const [questions] = await conn.execute(
      `SELECT question_id, question_text, question_type, marks,
              option_a, option_b, option_c, option_d, option_e, option_f,
              option_g, option_h, option_i, option_j,
              order_index, difficulty_level
       FROM Questions WHERE exam_id = ? ORDER BY order_index ASC, question_id ASC`,
      [exam_id]
    );

    const [[exam]] = await conn.execute(
      `SELECT title, duration_minutes, total_marks, passing_marks FROM Exams WHERE exam_id = ?`,
      [exam_id]
    );

    const [[startedAtRow]] = await conn.execute(
      `SELECT started_at FROM ExamAttempts WHERE attempt_id = ?`, [attempt_id]
    );

    res.json({ attempt_id, exam, questions, started_at: startedAtRow?.started_at || null });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── POST /api/attempts/:id/answer ─────────────────────────────
// Upserts one StudentAnswer; grades MCQ/T_F automatically.
route('post', '/api/attempts/:id/answer', async (req, res) => {
  const { question_id, selected_option, time_taken_seconds } = req.body;
  const attempt_id = parseInt(req.params.id);

  const [[qrow]] = await pool.execute(
    `SELECT correct_answer, question_type, marks FROM Questions WHERE question_id = ?`,
    [question_id]
  );
  if (!qrow) return res.status(404).json({ error: 'Question not found' });

  let is_correct = null;
  let marks_obtained = 0;
  if (qrow.question_type !== 'SHORT_ANSWER') {
    is_correct     = selected_option === qrow.correct_answer ? 1 : 0;
    marks_obtained = is_correct ? qrow.marks : 0;
  }

  await pool.execute(
    `INSERT INTO StudentAnswers
       (attempt_id, question_id, selected_option, time_taken_seconds, is_correct, marks_obtained)
     VALUES (?,?,?,?,?,?) AS new_row
     ON DUPLICATE KEY UPDATE
       selected_option    = new_row.selected_option,
       time_taken_seconds = new_row.time_taken_seconds,
       is_correct         = new_row.is_correct,
       marks_obtained     = new_row.marks_obtained,
       answered_at        = NOW()`,
    [attempt_id, question_id, selected_option, time_taken_seconds || null, is_correct, marks_obtained]
  );

  res.json({ success: true, is_correct: is_correct === 1, marks_obtained });
});

// ── POST /api/attempts/:id/submit ─────────────────────────────
// Locks attempt row, sums marks, updates status → 'submitted'.
// T6 fires after UPDATE to write EXAM_SUBMITTED to ProctorLogs.
route('post', '/api/attempts/:id/submit', async (req, res) => {
  const attempt_id = parseInt(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[attempt]] = await conn.execute(
      `SELECT ea.status, e.total_marks, e.passing_marks, e.title
       FROM ExamAttempts ea JOIN Exams e ON ea.exam_id = e.exam_id
       WHERE ea.attempt_id = ? FOR UPDATE`,
      [attempt_id]
    );
    if (!attempt) throw new Error('Attempt not found');
    if (attempt.status !== 'in_progress')
      throw new Error(`Cannot submit — status is "${attempt.status}"`);

    const [[sr]] = await conn.execute(
      `SELECT COALESCE(SUM(marks_obtained), 0) AS total FROM StudentAnswers WHERE attempt_id = ?`,
      [attempt_id]
    );
    const score      = parseFloat(sr.total);
    const percentage = Math.round((score / attempt.total_marks) * 10000) / 100;

    await conn.execute(
      `UPDATE ExamAttempts
       SET score = ?, percentage = ?, status = 'submitted', submitted_at = NOW()
       WHERE attempt_id = ?`,
      [score, percentage, attempt_id]
    );

    await conn.commit();
    res.json({
      success:       true,
      score,
      percentage,
      passed:        score >= attempt.passing_marks,
      total_marks:   attempt.total_marks,
      passing_marks: attempt.passing_marks,
      title:         attempt.title,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ── GET /api/attempts/:id/warnings ───────────────────────────
// Student polls this during exam to receive proctor warnings.
// Returns IDLE_WARNING logs newer than ?since=<ISO timestamp>.
route('get', '/api/attempts/:id/warnings', async (req, res) => {
  const attempt_id = parseInt(req.params.id);
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const rows = await q(
    `SELECT event_details AS message, severity, logged_at
     FROM ProctorLogs
     WHERE attempt_id = ? AND event_type = 'IDLE_WARNING' AND logged_at > ?
     ORDER BY logged_at ASC`,
    [attempt_id, since]
  );
  // Also check if the attempt has been kicked (abandoned)
  const [[attempt]] = await pool.execute(
    `SELECT status FROM ExamAttempts WHERE attempt_id = ?`, [attempt_id]
  );
  res.json({ warnings: rows, kicked: attempt?.status === 'abandoned' });
});

// ── POST /api/proctor/warn ────────────────────────────────────
// Proctor sends a warning to a student's active attempt.
// severity must be LOW | MEDIUM | HIGH | CRITICAL.
route('post', '/api/proctor/warn', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'admin', 'teacher'))
    return res.status(403).json({ error: 'Teacher access required' });
  const { attempt_id, severity, message } = req.body;
  if (!attempt_id) return res.status(400).json({ error: 'attempt_id required' });
  const [[attempt]] = await pool.execute(
    `SELECT status FROM ExamAttempts WHERE attempt_id = ?`, [attempt_id]
  );
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (!['in_progress', 'flagged'].includes(attempt.status))
    return res.status(409).json({ error: `Cannot warn — attempt is already ${attempt.status}` });
  const sev = ['LOW','MEDIUM','HIGH','CRITICAL'].includes(severity) ? severity : 'MEDIUM';
  await pool.execute(
    `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
     VALUES (?, 'IDLE_WARNING', ?, ?)`,
    [attempt_id, sev, message || 'Warning issued by proctor']
  );
  res.json({ success: true });
});

// ── POST /api/proctor/kick/:attempt_id ────────────────────────
// Proctor forcibly ends a student's attempt (status → abandoned).
route('post', '/api/proctor/kick/:attempt_id', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!hasAnyRole(roles, 'admin', 'teacher'))
    return res.status(403).json({ error: 'Teacher access required' });
  const attempt_id = parseInt(req.params.attempt_id);
  const { reason } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      `SELECT status FROM ExamAttempts WHERE attempt_id = ? FOR UPDATE`, [attempt_id]
    );
    if (!row) throw new Error('Attempt not found');
    if (!['in_progress', 'flagged'].includes(row.status))
      return res.status(409).json({ error: `Cannot kick — attempt is already ${row.status}` });

    await conn.execute(
      `UPDATE ExamAttempts SET status = 'abandoned', submitted_at = NOW() WHERE attempt_id = ?`,
      [attempt_id]
    );
    await conn.execute(
      `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
       VALUES (?, 'PROCTOR_KICK', 'CRITICAL', ?)`,
      [attempt_id, reason ? `Removed by proctor: ${reason}` : 'Removed from exam by proctor']
    );
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback(); throw err;
  } finally { conn.release(); }
});

// ── GET /api/proctor-actions ──────────────────────────────────
route('get', '/api/proctor-actions', async (req, res) => {
  const { userId, roles } = await getUserWithRole(req);
  const isTeacher = hasAnyRole(roles, 'teacher') && !hasAnyRole(roles, 'admin');
  const filter    = isTeacher ? 'AND ex.created_by = ?' : '';
  const params    = isTeacher ? [userId] : [];
  const rows = await q(`
    SELECT pl.attempt_id, pl.event_type, pl.severity, pl.event_details,
           pl.logged_at, u.full_name AS student_name, ex.title AS exam_title
    FROM ProctorLogs pl
    JOIN ExamAttempts ea ON pl.attempt_id = ea.attempt_id
    JOIN Users u         ON ea.student_id = u.user_id
    JOIN Exams ex        ON ea.exam_id    = ex.exam_id
    WHERE pl.event_type IN ('IDLE_WARNING', 'PROCTOR_KICK') ${filter}
    ORDER BY pl.logged_at DESC`,
    params
  );
  const actions = rows.map(r => ({
    type:     r.event_type === 'PROCTOR_KICK' ? 'kick' : 'warn',
    label:    r.event_type === 'PROCTOR_KICK' ? 'Removed' : 'Warned',
    color:    r.event_type === 'PROCTOR_KICK' ? 'var(--red)' : 'var(--yellow)',
    student:  r.student_name,
    exam:     r.exam_title,
    message:  r.event_details,
    severity: r.severity,
    time:     new Date(r.logged_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false }),
    attempt_id: r.attempt_id,
  }));
  res.json({ actions });
});

// ── Start ─────────────────────────────────────────────────────
// Only listen when run directly (node server.js / npm start).
// When required by tests, app is exported without listening.
if (require.main === module) {
  // ── Startup migrations ────────────────────────────────────────
  (async () => {
    // 1. Role ENUM: expand → migrate data → shrink
    await pool.execute(`ALTER TABLE Users     MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin') NOT NULL DEFAULT 'student'`).catch(() => {});
    await pool.execute(`ALTER TABLE UserRoles MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin') NOT NULL`).catch(() => {});
    await pool.execute(`UPDATE Users     SET role='teacher' WHERE role IN ('proctor','instructor')`).catch(() => {});
    await pool.execute(`UPDATE UserRoles SET role='teacher' WHERE role IN ('proctor','instructor')`).catch(() => {});
    await pool.execute(`ALTER TABLE Users     MODIFY COLUMN role ENUM('student','teacher','admin') NOT NULL DEFAULT 'student'`).catch(() => {});
    await pool.execute(`ALTER TABLE UserRoles MODIFY COLUMN role ENUM('student','teacher','admin') NOT NULL`).catch(() => {});

    // 2. Questions: add option_e through option_j if not present
    for (const col of ['option_e','option_f','option_g','option_h','option_i','option_j']) {
      const [[ex]] = await pool.execute(
        `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Questions' AND COLUMN_NAME=?`, [col]
      ).catch(() => [[{ c: 1 }]]);
      if (!ex.c) await pool.execute(`ALTER TABLE Questions ADD COLUMN ${col} VARCHAR(500) NULL`).catch(() => {});
    }

    // 3. correct_answer: make nullable so teachers can add questions without specifying the answer
    await pool.execute(
      `ALTER TABLE Questions MODIFY COLUMN correct_answer VARCHAR(500) NULL`
    ).catch(() => {});

    console.log('DB migrations applied.');
  })();

  app.listen(PORT, () => {
    console.log(`\nExamProctor server running at http://localhost:${PORT}`);
    console.log(`UI dashboard → http://localhost:${PORT}/index.html\n`);
  });

  // ── Auto-submit expired in_progress attempts every 60 s ───────
  // If a student's browser closed without submitting, the server
  // marks their attempt as 'timed_out' once duration_minutes elapses.
  setInterval(async () => {
    try {
      const expired = await q(`
        SELECT ea.attempt_id, e.total_marks
        FROM ExamAttempts ea
        JOIN Exams e ON ea.exam_id = e.exam_id
        WHERE ea.status = 'in_progress'
          AND DATE_ADD(ea.started_at, INTERVAL e.duration_minutes MINUTE) < NOW()`
      );
      for (const a of expired) {
        const [[sr]] = await pool.query(
          `SELECT COALESCE(SUM(marks_obtained), 0) AS total FROM StudentAnswers WHERE attempt_id = ?`,
          [a.attempt_id]
        );
        const score = parseFloat(sr.total);
        const pct   = Math.round((score / a.total_marks) * 10000) / 100;
        await pool.execute(
          `UPDATE ExamAttempts
           SET score=?, percentage=?, status='timed_out', submitted_at=NOW(), auto_submitted=TRUE
           WHERE attempt_id=? AND status='in_progress'`,
          [score, pct, a.attempt_id]
        );
        await pool.execute(
          `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
           VALUES (?, 'AUTO_SUBMITTED', 'INFO', 'Auto-submitted: time limit expired.')`,
          [a.attempt_id]
        );
        console.log(`[auto-submit] attempt ${a.attempt_id} timed out → score ${score}/${a.total_marks}`);
      }
    } catch (e) {
      console.error('[auto-submit] error:', e.message);
    }
  }, 60 * 1000);
}

module.exports = app;
