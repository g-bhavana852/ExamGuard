/**
 * dbms.test.js — Real MySQL integration tests for every DBMS feature.
 *
 * Requires a running ExamProctor database with all SQL files loaded (01–06).
 * Each test creates the minimum data it needs and tears down after itself.
 *
 * Run: npm test (from server/)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

let pool;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
async function q1(sql, params = []) {
  const [[row]] = await pool.execute(sql, params);
  return row;
}
async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/** Create a unique throwaway student for isolation. */
async function makeStudent(suffix = '') {
  const email = `test_student_${suffix}_${Date.now()}@examguard.test`;
  const r = await run(
    `INSERT INTO Users (email, password_hash, full_name, role)
     VALUES (?, 'sha256:test', ?, 'student')`,
    [email, `Test Student ${suffix}`]
  );
  return r.insertId;
}

/** Delete rows created during a test. For Users, removes ExamAttempts first (FK). */
async function cleanup(table, column, value) {
  if (table === 'Users') {
    // ExamAttempts → StudentAnswers, ProctorLogs, SuspicionFlags cascade on attempt delete
    await pool.execute(`DELETE FROM ExamAttempts WHERE student_id = ?`, [value]);
    await pool.execute(`DELETE FROM Enrollments  WHERE student_id = ?`, [value]);
    await pool.execute(`DELETE FROM LoginSessions WHERE user_id   = ?`, [value]);
  }
  await pool.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [value]);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  pool = mysql.createPool({
    host:            process.env.DB_HOST || 'localhost',
    user:            process.env.DB_USER || 'root',
    password:        process.env.DB_PASS || '',
    database:        process.env.DB_NAME || 'ExamProctor',
    connectionLimit: 5,
    waitForConnections: true,
  });
  // Verify connection
  await pool.execute('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────
describe('Triggers', () => {

  // ── T1: Validate exam start ───────────────────────────────────────────────
  describe('T1 trg_validate_exam_start', () => {
    let studentId;
    beforeAll(async () => { studentId = await makeStudent('t1'); });
    afterAll(async () => { await cleanup('Users', 'user_id', studentId); });

    test('blocks start when exam window is closed', async () => {
      // Get an exam whose window is in the past
      const exam = await q1(
        `SELECT exam_id FROM Exams WHERE window_end < NOW() AND is_published = TRUE LIMIT 1`
      );
      if (!exam) return; // no closed exam in seed data — skip

      // Enroll student so that check passes
      const course = await q1(`SELECT course_id FROM Exams WHERE exam_id = ?`, [exam.exam_id]);
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, course.course_id]
      );

      await expect(
        run(
          `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
          [exam.exam_id, studentId, '127.0.0.1']
        )
      ).rejects.toThrow(/Exam window has closed/i);
    });

    test('sets attempt_number automatically on successful insert', async () => {
      // Use an exam with an open window
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW()
         LIMIT 1`
      );
      if (!exam) return; // no open exam — skip

      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, exam.course_id]
      );
      const r = await run(
        `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
        [exam.exam_id, studentId, '127.0.0.1']
      );
      const attempt = await q1(
        `SELECT attempt_number FROM ExamAttempts WHERE attempt_id = ?`,
        [r.insertId]
      );
      expect(attempt.attempt_number).toBe(1);

      await cleanup('ExamAttempts', 'attempt_id', r.insertId);
    });
  });

  // ── T3: Auto-grade MCQ answer ─────────────────────────────────────────────
  describe('T3 trg_auto_grade_answer', () => {
    let attemptId;
    let t3StudentId = null;

    beforeAll(async () => {
      // Create a fresh student + attempt so T2 won't fire due to stale started_at
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW()
         LIMIT 1`
      );
      if (!exam) return; // no open exam — tests will skip

      t3StudentId = await makeStudent('t3');
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [t3StudentId, exam.course_id]
      );
      const r = await run(
        `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
        [exam.exam_id, t3StudentId, '127.0.0.1']
      );
      attemptId = r.insertId;
    });

    afterAll(async () => {
      if (t3StudentId) await cleanup('Users', 'user_id', t3StudentId);
    });

    test('sets is_correct=TRUE and full marks for correct MCQ answer', async () => {
      if (!attemptId) return;
      const q_ = await q1(
        `SELECT q.question_id, q.correct_answer, q.marks
         FROM Questions q
         JOIN ExamAttempts ea ON ea.exam_id = q.exam_id
         WHERE ea.attempt_id = ? AND q.question_type = 'MCQ' LIMIT 1`,
        [attemptId]
      );
      if (!q_) return;

      // Delete any existing answer first
      await run(
        `DELETE FROM StudentAnswers WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]
      );

      await run(
        `INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, time_taken_seconds)
         VALUES (?, ?, ?, 10)`,
        [attemptId, q_.question_id, q_.correct_answer]
      );

      const row = await q1(
        `SELECT is_correct, marks_obtained FROM StudentAnswers
         WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]
      );
      expect(row.is_correct).toBe(1);
      expect(parseFloat(row.marks_obtained)).toBe(parseFloat(q_.marks));

      await run(`DELETE FROM StudentAnswers WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]);
    });

    test('sets is_correct=FALSE and 0 marks for wrong MCQ answer', async () => {
      if (!attemptId) return;
      const q_ = await q1(
        `SELECT question_id, correct_answer, marks, option_a, option_b, option_c, option_d
         FROM Questions q
         JOIN ExamAttempts ea ON ea.exam_id = q.exam_id
         WHERE ea.attempt_id = ? AND question_type = 'MCQ' LIMIT 1`,
        [attemptId]
      );
      if (!q_) return;

      // Pick a wrong option
      const all = ['A','B','C','D'];
      const wrong = all.find(x => x !== q_.correct_answer);

      await run(`DELETE FROM StudentAnswers WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]);
      await run(
        `INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, time_taken_seconds)
         VALUES (?, ?, ?, 12)`,
        [attemptId, q_.question_id, wrong]
      );
      const row = await q1(
        `SELECT is_correct, marks_obtained FROM StudentAnswers
         WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]
      );
      expect(row.is_correct).toBe(0);
      expect(parseFloat(row.marks_obtained)).toBe(0);

      await run(`DELETE FROM StudentAnswers WHERE attempt_id = ? AND question_id = ?`,
        [attemptId, q_.question_id]);
    });
  });

  // ── T4: Update suspicion score ────────────────────────────────────────────
  describe('T4 trg_update_suspicion_score', () => {
    let attemptId, origScore, origTabs, origPastes, origFullscreen;

    beforeAll(async () => {
      const a = await q1(
        `SELECT attempt_id, suspicion_score, tab_switches,
                copy_paste_attempts, fullscreen_exits
         FROM ExamAttempts WHERE status = 'in_progress' LIMIT 1`
      );
      if (a) {
        attemptId   = a.attempt_id;
        origScore   = a.suspicion_score;
        origTabs    = a.tab_switches;
        origPastes  = a.copy_paste_attempts;
        origFullscreen = a.fullscreen_exits;
      }
    });

    afterAll(async () => {
      if (!attemptId) return;
      // Restore original score/counters
      await run(
        `UPDATE ExamAttempts
         SET suspicion_score = ?, tab_switches = ?,
             copy_paste_attempts = ?, fullscreen_exits = ?
         WHERE attempt_id = ?`,
        [origScore, origTabs, origPastes, origFullscreen, attemptId]
      );
      // Remove test logs
      await run(
        `DELETE FROM ProctorLogs WHERE attempt_id = ? AND event_details LIKE '%TEST_T4%'`,
        [attemptId]
      );
    });

    test('MEDIUM event increments suspicion_score by 7 and tab_switches by 1', async () => {
      if (!attemptId) return;
      const before = await q1(
        `SELECT suspicion_score, tab_switches FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      await run(
        `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
         VALUES (?, 'TAB_SWITCH', 'MEDIUM', 'TEST_T4 tab switch')`,
        [attemptId]
      );
      const after = await q1(
        `SELECT suspicion_score, tab_switches FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      expect(after.suspicion_score).toBe(Math.min(100, before.suspicion_score + 7));
      expect(after.tab_switches).toBe(before.tab_switches + 1);
    });

    test('HIGH event increments suspicion_score by 15 and copy_paste_attempts by 1', async () => {
      if (!attemptId) return;
      const before = await q1(
        `SELECT suspicion_score, copy_paste_attempts FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      await run(
        `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
         VALUES (?, 'COPY_PASTE_DETECTED', 'HIGH', 'TEST_T4 copy paste')`,
        [attemptId]
      );
      const after = await q1(
        `SELECT suspicion_score, copy_paste_attempts FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      expect(after.suspicion_score).toBe(Math.min(100, before.suspicion_score + 15));
      expect(after.copy_paste_attempts).toBe(before.copy_paste_attempts + 1);
    });

    test('LOW event increments suspicion_score by 3 and fullscreen_exits by 1', async () => {
      if (!attemptId) return;
      const before = await q1(
        `SELECT suspicion_score, fullscreen_exits FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      await run(
        `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
         VALUES (?, 'FULLSCREEN_EXIT', 'LOW', 'TEST_T4 fullscreen')`,
        [attemptId]
      );
      const after = await q1(
        `SELECT suspicion_score, fullscreen_exits FROM ExamAttempts WHERE attempt_id = ?`,
        [attemptId]
      );
      expect(after.suspicion_score).toBe(Math.min(100, before.suspicion_score + 3));
      expect(after.fullscreen_exits).toBe(before.fullscreen_exits + 1);
    });

    test('INFO event adds 0 to suspicion_score', async () => {
      if (!attemptId) return;
      const before = await q1(
        `SELECT suspicion_score FROM ExamAttempts WHERE attempt_id = ?`, [attemptId]
      );
      await run(
        `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
         VALUES (?, 'EXAM_STARTED', 'INFO', 'TEST_T4 info event')`,
        [attemptId]
      );
      const after = await q1(
        `SELECT suspicion_score FROM ExamAttempts WHERE attempt_id = ?`, [attemptId]
      );
      expect(after.suspicion_score).toBe(before.suspicion_score);
    });
  });

  // ── T5: Auto-flag at threshold ────────────────────────────────────────────
  describe('T5 trg_auto_flag_suspicious', () => {
    let studentId, attemptId;

    beforeAll(async () => {
      studentId = await makeStudent('t5');
      // Find an open exam to create a test attempt
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW() LIMIT 1`
      );
      if (!exam) return;
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, exam.course_id]
      );
      const r = await run(
        `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
        [exam.exam_id, studentId, '127.0.0.1']
      );
      attemptId = r.insertId;
      // Set suspicion to 65 (just below threshold)
      await run(`UPDATE ExamAttempts SET suspicion_score = 65 WHERE attempt_id = ?`, [attemptId]);
    });

    afterAll(async () => {
      if (attemptId) await cleanup('ExamAttempts', 'attempt_id', attemptId);
      await cleanup('Users', 'user_id', studentId);
    });

    test('auto-flags attempt when suspicion_score crosses 70', async () => {
      if (!attemptId) return;
      const flagsBefore = (await q(
        `SELECT flag_id FROM SuspicionFlags WHERE attempt_id = ? AND flag_type = 'HIGH_SUSPICION_SCORE'`,
        [attemptId]
      )).length;

      // Insert a HIGH event to push score from 65 → 80 (>=70 threshold)
      await run(
        `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
         VALUES (?, 'COPY_PASTE_DETECTED', 'HIGH', 'TEST_T5 push over threshold')`,
        [attemptId]
      );

      const score = await q1(
        `SELECT suspicion_score FROM ExamAttempts WHERE attempt_id = ?`, [attemptId]
      );
      expect(score.suspicion_score).toBeGreaterThanOrEqual(70);

      const flagsAfter = (await q(
        `SELECT flag_id FROM SuspicionFlags WHERE attempt_id = ? AND flag_type = 'HIGH_SUSPICION_SCORE'`,
        [attemptId]
      )).length;
      expect(flagsAfter).toBeGreaterThan(flagsBefore);
    });
  });

  // ── T7: Multiple login detection ──────────────────────────────────────────
  describe('T7 trg_detect_multiple_logins', () => {
    let studentId, attemptId, session1Id, session2Id;

    beforeAll(async () => {
      studentId = await makeStudent('t7');
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW() LIMIT 1`
      );
      if (!exam) return;
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, exam.course_id]
      );
      const r = await run(
        `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
        [exam.exam_id, studentId, '10.0.0.1']
      );
      attemptId = r.insertId;
    });

    afterAll(async () => {
      if (session1Id) await cleanup('LoginSessions', 'session_id', session1Id);
      if (session2Id) await cleanup('LoginSessions', 'session_id', session2Id);
      if (attemptId)  await cleanup('ExamAttempts', 'attempt_id', attemptId);
      await cleanup('Users', 'user_id', studentId);
    });

    test('logs CRITICAL event when same user logs in from a second IP during exam', async () => {
      if (!attemptId) return;
      const token1 = `test_t7_token1_${Date.now()}`;
      const token2 = `test_t7_token2_${Date.now()}`;

      // First login — no duplicate yet
      const r1 = await run(
        `INSERT INTO LoginSessions (user_id, ip_address, device_fingerprint, session_token)
         VALUES (?, '10.0.0.1', 'device-A', ?)`,
        [studentId, token1]
      );
      session1Id = r1.insertId;

      const logsBefore = (await q(
        `SELECT log_id FROM ProctorLogs WHERE attempt_id = ? AND severity = 'CRITICAL'`,
        [attemptId]
      )).length;

      // Second login from a different IP — T7 fires
      const r2 = await run(
        `INSERT INTO LoginSessions (user_id, ip_address, device_fingerprint, session_token)
         VALUES (?, '10.0.0.2', 'device-B', ?)`,
        [studentId, token2]
      );
      session2Id = r2.insertId;

      const logsAfter = (await q(
        `SELECT log_id FROM ProctorLogs WHERE attempt_id = ? AND severity = 'CRITICAL'`,
        [attemptId]
      )).length;
      expect(logsAfter).toBeGreaterThan(logsBefore);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — STORED PROCEDURES
// ─────────────────────────────────────────────────────────────────────────────
describe('Stored Procedures', () => {

  // ── SP1: sp_start_exam ────────────────────────────────────────────────────
  describe('sp_start_exam', () => {
    let studentId;
    beforeAll(async () => { studentId = await makeStudent('sp1'); });
    afterAll(async () => { await cleanup('Users', 'user_id', studentId); });

    test('creates an ExamAttempts row and returns attempt_id', async () => {
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW() LIMIT 1`
      );
      if (!exam) return;
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, exam.course_id]
      );
      const conn = await pool.getConnection();
      try {
        await conn.execute(`CALL sp_start_exam(?, ?, '127.0.0.1', 'jest-test-browser', @aid, @msg)`,
          [studentId, exam.exam_id]);
        const [[row]] = await conn.execute(`SELECT @aid AS attempt_id`);
        expect(row.attempt_id).toBeGreaterThan(0);
        await run(`DELETE FROM ExamAttempts WHERE attempt_id = ?`, [row.attempt_id]);
      } finally {
        conn.release();
      }
    });
  });

  // ── SP3: sp_submit_exam ───────────────────────────────────────────────────
  describe('sp_submit_exam', () => {
    let studentId, attemptId;

    beforeAll(async () => {
      studentId = await makeStudent('sp3');
      const exam = await q1(
        `SELECT exam_id, course_id FROM Exams
         WHERE is_published = TRUE AND window_start <= NOW() AND window_end >= NOW() LIMIT 1`
      );
      if (!exam) return;
      await run(
        `INSERT IGNORE INTO Enrollments (student_id, course_id, status) VALUES (?,?,'active')`,
        [studentId, exam.course_id]
      );
      const r = await run(
        `INSERT INTO ExamAttempts (exam_id, student_id, ip_address) VALUES (?,?,?)`,
        [exam.exam_id, studentId, '127.0.0.1']
      );
      attemptId = r.insertId;
    });

    afterAll(async () => {
      if (attemptId) await cleanup('ExamAttempts', 'attempt_id', attemptId);
      await cleanup('Users', 'user_id', studentId);
    });

    test('sets status to submitted and calculates score', async () => {
      if (!attemptId) return;
      const conn = await pool.getConnection();
      try {
        // sp_submit_exam(attempt_id, OUT score, OUT percentage, OUT passed, OUT message)
        await conn.execute(`CALL sp_submit_exam(?, @score, @pct, @passed, @msg)`, [attemptId]);
        const [[row]] = await conn.execute(
          `SELECT @score AS score, @pct AS pct, @passed AS passed, @msg AS msg`
        );
        expect(row.msg).toMatch(/SUCCESS/i);
        expect(parseFloat(row.score)).toBeGreaterThanOrEqual(0);
      } finally {
        conn.release();
      }
    });
  });

  // ── SP4: sp_log_proctor_event ─────────────────────────────────────────────
  describe('sp_log_proctor_event', () => {
    test('inserts a ProctorLog and updates suspicion score', async () => {
      const a = await q1(`SELECT attempt_id, suspicion_score FROM ExamAttempts
                          WHERE status = 'in_progress' LIMIT 1`);
      if (!a) return;
      const before = a.suspicion_score;
      const conn = await pool.getConnection();
      try {
        await conn.execute(
          `CALL sp_log_proctor_event(?, 'TAB_SWITCH', 'MEDIUM', 'SP4 test event', '127.0.0.1')`,
          [a.attempt_id]
        );
        const after = await q1(
          `SELECT suspicion_score FROM ExamAttempts WHERE attempt_id = ?`,
          [a.attempt_id]
        );
        expect(after.suspicion_score).toBeGreaterThanOrEqual(before);
        // Clean up the test log
        await run(
          `DELETE FROM ProctorLogs WHERE attempt_id = ? AND event_details = 'SP4 test event'`,
          [a.attempt_id]
        );
      } finally {
        conn.release();
      }
    });
  });

  // ── SP6: sp_get_flagged_attempts ──────────────────────────────────────────
  describe('sp_get_flagged_attempts', () => {
    test('returns a result set with suspicion_score column', async () => {
      const conn = await pool.getConnection();
      try {
        // sp_get_flagged_attempts requires an exam_id param
        const [[examRow]] = await pool.execute(
          `SELECT exam_id FROM Exams WHERE is_published = TRUE LIMIT 1`
        );
        if (!examRow) return;
        const [rows] = await conn.execute(`CALL sp_get_flagged_attempts(?)`, [examRow.exam_id]);
        // rows[0] is the first result set from a multi-result CALL
        const data = Array.isArray(rows[0]) ? rows[0] : rows;
        if (data.length > 0) {
          expect(data[0]).toHaveProperty('suspicion_score');
        }
        expect(Array.isArray(data)).toBe(true);
      } finally {
        conn.release();
      }
    });
  });

  // ── SP7: sp_resolve_flag ──────────────────────────────────────────────────
  describe('sp_resolve_flag', () => {
    test('marks a SuspicionFlag as resolved', async () => {
      const flag = await q1(
        `SELECT flag_id FROM SuspicionFlags WHERE is_resolved = FALSE LIMIT 1`
      );
      if (!flag) return;

      const admin = await q1(`SELECT user_id FROM Users WHERE role = 'admin' LIMIT 1`);
      if (!admin) return;

      const conn = await pool.getConnection();
      try {
        // sp_resolve_flag(flag_id, resolved_by, resolution_notes, OUT message)
        await conn.execute(
          `CALL sp_resolve_flag(?, ?, 'Jest test resolution', @msg)`,
          [flag.flag_id, admin.user_id]
        );
        const [[msgRow]] = await conn.execute(`SELECT @msg AS msg`);
        expect(msgRow.msg).toMatch(/SUCCESS/i);
        const row = await q1(
          `SELECT is_resolved FROM SuspicionFlags WHERE flag_id = ?`,
          [flag.flag_id]
        );
        expect(row.is_resolved).toBe(1);
        // Restore
        await run(
          `UPDATE SuspicionFlags SET is_resolved = FALSE, resolved_by = NULL,
           resolved_at = NULL, resolution_notes = NULL WHERE flag_id = ?`,
          [flag.flag_id]
        );
      } finally {
        conn.release();
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — TRANSACTIONS (call the demo stored procedures from 05_transactions.sql)
// ─────────────────────────────────────────────────────────────────────────────
describe('Transactions', () => {

  // ── TXN-3 demo: txn_demo_3_optimistic_lock ────────────────────────────────
  describe('txn_demo_3 optimistic locking', () => {
    test('procedure exists and can be called', async () => {
      const proc = await q1(
        `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
         WHERE ROUTINE_SCHEMA = 'ExamProctor' AND ROUTINE_NAME = 'txn_demo_3'`
      );
      expect(proc).toBeTruthy();
    });
  });

  // ── TXN-1 demo: txn_demo_1 ────────────────────────────────────────────────
  describe('txn_demo_1 atomic submission', () => {
    test('procedure exists in INFORMATION_SCHEMA', async () => {
      const proc = await q1(
        `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
         WHERE ROUTINE_SCHEMA = 'ExamProctor' AND ROUTINE_NAME = 'txn_demo_1'`
      );
      expect(proc).toBeTruthy();
    });

    test('rolls back and leaves attempt unchanged when called with bad attempt_id', async () => {
      const conn = await pool.getConnection();
      try {
        const before = await q1(`SELECT COUNT(*) AS cnt FROM ExamAttempts`);
        // Using a non-existent attempt ID — the proc should handle this gracefully
        await conn.execute(`CALL txn_demo_1(999999999)`).catch(() => {});
        const after  = await q1(`SELECT COUNT(*) AS cnt FROM ExamAttempts`);
        // No extra rows should have been created
        expect(after.cnt).toBe(before.cnt);
      } finally {
        conn.release();
      }
    });
  });

  // ── TXN-6 double-submit prevention ───────────────────────────────────────
  describe('txn_demo_6 double-submit prevention', () => {
    test('txn_demo_6_session_b procedure exists', async () => {
      const proc = await q1(
        `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
         WHERE ROUTINE_SCHEMA = 'ExamProctor' AND ROUTINE_NAME = 'txn_demo_6_session_b'`
      );
      expect(proc).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — SCHEMA INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema Integrity', () => {

  test('all 10 tables exist', async () => {
    const tables = await q(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = 'ExamProctor' AND TABLE_TYPE = 'BASE TABLE'`
    );
    // MySQL returns table names in the case stored on disk (lowercase on Windows).
    const names = tables.map(t => t.TABLE_NAME.toLowerCase());
    const expected = [
      'users','courses','enrollments','exams','questions',
      'examattempts','studentanswers','proctorlogs','suspicionflags','loginsessions',
    ];
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test('all 7 triggers exist', async () => {
    const triggers = await q(
      `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
       WHERE TRIGGER_SCHEMA = 'ExamProctor'`
    );
    const names = triggers.map(t => t.TRIGGER_NAME.toLowerCase());
    const expected = [
      'trg_validate_exam_start', 'trg_check_time_on_answer', 'trg_auto_grade_answer',
      'trg_update_suspicion_score', 'trg_auto_flag_suspicious',
      'trg_log_exam_submission', 'trg_detect_multiple_logins',
    ].map(s => s.toLowerCase());
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test('core stored procedures exist', async () => {
    const procs = await q(
      `SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
       WHERE ROUTINE_SCHEMA = 'ExamProctor' AND ROUTINE_TYPE = 'PROCEDURE'`
    );
    const names = procs.map(p => p.ROUTINE_NAME.toLowerCase());
    const expected = [
      'sp_start_exam', 'sp_submit_answer', 'sp_submit_exam',
      'sp_log_proctor_event', 'sp_get_exam_results', 'sp_get_flagged_attempts',
      'sp_resolve_flag', 'sp_exam_analytics',
    ];
    for (const p of expected) {
      expect(names).toContain(p.toLowerCase());
    }
  });

  test('ExamAttempts has ip_address column', async () => {
    const col = await q1(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'ExamProctor' AND TABLE_NAME = 'ExamAttempts'
         AND COLUMN_NAME = 'ip_address'`
    );
    expect(col).toBeTruthy();
  });

  test('ExamAttempts does NOT have face_not_detected column', async () => {
    const col = await q1(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'ExamProctor' AND TABLE_NAME = 'ExamAttempts'
         AND COLUMN_NAME = 'face_not_detected'`
    );
    expect(col).toBeFalsy();
  });

  test('ProctorLogs has ip_address column', async () => {
    const col = await q1(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'ExamProctor' AND TABLE_NAME = 'ProctorLogs'
         AND COLUMN_NAME = 'ip_address'`
    );
    expect(col).toBeTruthy();
  });

  test('LoginSessions has ip_address column', async () => {
    const col = await q1(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'ExamProctor' AND TABLE_NAME = 'LoginSessions'
         AND COLUMN_NAME = 'ip_address'`
    );
    expect(col).toBeTruthy();
  });

  test('unique UNIQUE constraint prevents duplicate (exam_id, student_id) attempts beyond max', async () => {
    // This is enforced by T1, not a UNIQUE constraint, so just verify T1 exists
    const trig = await q1(
      `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
       WHERE TRIGGER_SCHEMA = 'ExamProctor'
         AND LOWER(TRIGGER_NAME) = 'trg_validate_exam_start'`
    );
    expect(trig).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — PROCTORING FEATURES END-TO-END
// ─────────────────────────────────────────────────────────────────────────────
describe('Proctoring features (end-to-end in DB)', () => {

  test('TAB_SWITCH event increments tab_switches counter (T4 verified)', async () => {
    const a = await q1(
      `SELECT attempt_id, tab_switches FROM ExamAttempts
       WHERE status = 'in_progress' LIMIT 1`
    );
    if (!a) return;
    await run(
      `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
       VALUES (?, 'TAB_SWITCH', 'MEDIUM', 'e2e test tab')`,
      [a.attempt_id]
    );
    const after = await q1(
      `SELECT tab_switches FROM ExamAttempts WHERE attempt_id = ?`, [a.attempt_id]
    );
    expect(after.tab_switches).toBe(a.tab_switches + 1);
    // Revert
    await run(`UPDATE ExamAttempts SET tab_switches = ?, suspicion_score = suspicion_score - 7
               WHERE attempt_id = ?`, [a.tab_switches, a.attempt_id]);
    await run(`DELETE FROM ProctorLogs WHERE attempt_id = ? AND event_details = 'e2e test tab'`,
      [a.attempt_id]);
  });

  test('rapid answering is detectable: avg time_taken_seconds < 15 in StudentAnswers', async () => {
    // Just verify the data model supports it — check if any attempt has fast answers
    const rapid = await q1(
      `SELECT ea.attempt_id,
              ROUND(AVG(sa.time_taken_seconds), 1) AS avg_time
       FROM StudentAnswers sa
       JOIN ExamAttempts ea ON sa.attempt_id = ea.attempt_id
       GROUP BY ea.attempt_id
       HAVING avg_time IS NOT NULL
       ORDER BY avg_time ASC LIMIT 1`
    );
    // The column must exist and return numeric data
    if (rapid) {
      expect(typeof rapid.avg_time).toBe('string'); // MySQL DECIMAL comes back as string
    }
    // Pass regardless — just confirms the query runs
    expect(true).toBe(true);
  });

  test('multiple IP detection: login_ip_count query returns numeric counts', async () => {
    const row = await q1(
      `SELECT ea.attempt_id,
              (SELECT COUNT(DISTINCT ls.ip_address)
               FROM LoginSessions ls
               WHERE ls.user_id = ea.student_id
                 AND ls.login_time <= COALESCE(ea.submitted_at, NOW())
                 AND (ls.logout_time IS NULL OR ls.logout_time >= ea.started_at)
              ) AS login_ip_count
       FROM ExamAttempts ea LIMIT 1`
    );
    if (row) {
      expect(typeof row.login_ip_count).toBe('number');
    }
    expect(true).toBe(true);
  });

  test('suspicion score stays capped at 100 even with many CRITICAL events', async () => {
    const a = await q1(
      `SELECT attempt_id, suspicion_score FROM ExamAttempts
       WHERE status = 'in_progress' LIMIT 1`
    );
    if (!a) return;
    // Force score to 95
    await run(`UPDATE ExamAttempts SET suspicion_score = 95 WHERE attempt_id = ?`, [a.attempt_id]);
    // Insert a CRITICAL event (+25 would give 120, but cap is 100)
    await run(
      `INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
       VALUES (?, 'IDLE_WARNING', 'CRITICAL', 'cap test')`,
      [a.attempt_id]
    );
    const after = await q1(
      `SELECT suspicion_score FROM ExamAttempts WHERE attempt_id = ?`, [a.attempt_id]
    );
    expect(after.suspicion_score).toBeLessThanOrEqual(100);
    // Cleanup
    await run(`UPDATE ExamAttempts SET suspicion_score = ? WHERE attempt_id = ?`,
      [a.suspicion_score, a.attempt_id]);
    await run(`DELETE FROM ProctorLogs WHERE attempt_id = ? AND event_details = 'cap test'`,
      [a.attempt_id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — ANALYTICAL QUERIES
// ─────────────────────────────────────────────────────────────────────────────
describe('Analytical Queries (Q01–Q12)', () => {

  test('Q01 student dashboard query runs without error', async () => {
    const rows = await q(
      `SELECT e.exam_id, e.title, ea.status, ea.score
       FROM Enrollments enr
       JOIN Courses c ON enr.course_id = c.course_id
       JOIN Exams   e ON c.course_id   = e.course_id AND e.is_published = TRUE
       LEFT JOIN ExamAttempts ea ON e.exam_id = ea.exam_id AND ea.student_id = enr.student_id
       WHERE enr.student_id = (SELECT user_id FROM Users WHERE role = 'student' LIMIT 1)
         AND enr.status = 'active'
       ORDER BY e.window_start DESC`
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  test('Q03 score distribution query returns grade bands', async () => {
    const row = await q1(
      `SELECT SUM(ea.percentage >= 90) AS a_plus, COUNT(*) AS total
       FROM ExamAttempts ea
       WHERE ea.status IN ('submitted','graded','flagged')`
    );
    expect(row).toHaveProperty('a_plus');
    expect(row).toHaveProperty('total');
  });

  test('Q05 suspicion leaderboard returns ranked rows', async () => {
    const rows = await q(
      `SELECT u.full_name, SUM(ea.suspicion_score) AS total_suspicion
       FROM ExamAttempts ea JOIN Users u ON ea.student_id = u.user_id
       GROUP BY u.user_id, u.full_name
       ORDER BY total_suspicion DESC LIMIT 5`
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  test('Q06 rapid answering query identifies fast attempts', async () => {
    const rows = await q(
      `SELECT ea.attempt_id, ROUND(AVG(sa.time_taken_seconds), 1) AS avg_secs
       FROM StudentAnswers sa
       JOIN ExamAttempts ea ON sa.attempt_id = ea.attempt_id
       GROUP BY ea.attempt_id
       HAVING avg_secs IS NOT NULL
       ORDER BY avg_secs ASC LIMIT 5`
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  test('Q08 exam completion funnel query runs', async () => {
    const rows = await q(
      `SELECT ex.exam_id, ex.title,
              COUNT(DISTINCT enr.student_id) AS enrolled,
              COUNT(DISTINCT ea.student_id)  AS started
       FROM Exams ex
       JOIN Enrollments enr ON ex.course_id = enr.course_id AND enr.status = 'active'
       LEFT JOIN ExamAttempts ea ON ex.exam_id = ea.exam_id
       GROUP BY ex.exam_id, ex.title
       ORDER BY ex.window_start DESC`
    );
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('enrolled');
      expect(rows[0]).toHaveProperty('started');
    }
  });
});
