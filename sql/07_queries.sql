-- ExamGuard — Analytical Queries (12)
-- Q01  Student dashboard: all exams + results
-- Q02  Proctor queue: flagged / high-risk attempts
-- Q03  Score distribution (grade bands) per exam
-- Q04  Question difficulty: correct-rate per question
-- Q05  Suspicion leaderboard: ranked by risk indicators
-- Q06  Rapid-answering detection (< 15 s average)
-- Q07  Multi-login report
-- Q08  Exam completion funnel
-- Q09  Per-student proctoring event timeline
-- Q10  Instructor: cross-exam student performance
-- Q11  Admin: system-wide cheat-pattern summary
-- Q12  Course pass/fail comparison

USE ExamProctor;

-- ── Q01 : Student Dashboard ──────────────────────────────────
SELECT
    e.exam_id, e.title AS exam_title, c.course_name,
    e.duration_minutes, e.total_marks, e.passing_marks,
    e.window_start, e.window_end,
    ea.status AS attempt_status, ea.score, ea.percentage,
    CASE WHEN ea.score >= e.passing_marks THEN 'PASS'
         WHEN ea.score IS NULL            THEN '—'
         ELSE 'FAIL' END AS result,
    ea.submitted_at,
    CASE
        WHEN ea.attempt_id IS NULL AND NOW() BETWEEN e.window_start AND e.window_end THEN 'CAN START'
        WHEN ea.attempt_id IS NULL AND NOW() < e.window_start                        THEN 'UPCOMING'
        WHEN ea.attempt_id IS NULL                                                   THEN 'WINDOW CLOSED'
        ELSE 'ATTEMPTED'
    END AS availability
FROM   Enrollments enr
JOIN   Courses     c  ON enr.course_id = c.course_id
JOIN   Exams       e  ON c.course_id   = e.course_id AND e.is_published = TRUE
LEFT   JOIN ExamAttempts ea ON e.exam_id = ea.exam_id AND ea.student_id = enr.student_id
WHERE  enr.student_id = 6 AND enr.status = 'active'
ORDER  BY e.window_start DESC;


-- ── Q02 : Proctor Queue — Flagged and High-Risk Attempts ─────
SELECT
    ea.attempt_id, u.full_name AS student_name, u.email,
    ex.title AS exam_title, ea.status, ea.suspicion_score,
    ea.tab_switches, ea.copy_paste_attempts, ea.fullscreen_exits,
    COUNT(pl.log_id) AS total_events,
    SUM(pl.severity = 'CRITICAL') AS critical_events,
    SUM(pl.severity = 'HIGH')     AS high_events,
    COUNT(sf.flag_id)             AS open_flags,
    ea.score, ea.percentage,
    (ea.suspicion_score * 1.0
     + ea.tab_switches  * 3
     + ea.copy_paste_attempts * 5
     + COALESCE(SUM(pl.severity = 'CRITICAL'), 0) * 10) AS composite_risk_score
FROM   ExamAttempts  ea
JOIN   Users         u  ON ea.student_id = u.user_id
JOIN   Exams         ex ON ea.exam_id    = ex.exam_id
LEFT   JOIN ProctorLogs    pl ON ea.attempt_id = pl.attempt_id
LEFT   JOIN SuspicionFlags sf ON ea.attempt_id = sf.attempt_id AND sf.is_resolved = FALSE
WHERE  ea.exam_id = 1
GROUP  BY ea.attempt_id, u.full_name, u.email, ex.title,
          ea.status, ea.suspicion_score, ea.tab_switches,
          ea.copy_paste_attempts, ea.fullscreen_exits, ea.score, ea.percentage
HAVING ea.status IN ('flagged', 'submitted') OR ea.suspicion_score >= 30
ORDER  BY composite_risk_score DESC;


-- ── Q03 : Score Distribution — Grade Bands ───────────────────
SELECT
    ex.title                             AS exam_title,
    SUM(ea.percentage >= 90)             AS `A+ (≥90%)`,
    SUM(ea.percentage BETWEEN 75 AND 89) AS `A  (75-89%)`,
    SUM(ea.percentage BETWEEN 60 AND 74) AS `B  (60-74%)`,
    SUM(ea.percentage BETWEEN 50 AND 59) AS `C  (50-59%)`,
    SUM(ea.percentage < 50)              AS `F  (<50%)`,
    COUNT(ea.attempt_id)                 AS total_attempts,
    ROUND(AVG(ea.percentage), 1)         AS avg_percentage
FROM   ExamAttempts ea JOIN Exams ex ON ea.exam_id = ex.exam_id
WHERE  ea.status IN ('submitted', 'graded', 'flagged') AND ea.exam_id = 1
GROUP  BY ex.exam_id, ex.title;


-- ── Q04 : Question Difficulty Analysis ───────────────────────
SELECT
    q.question_id, LEFT(q.question_text, 70) AS question_preview,
    q.difficulty_level, q.marks,
    COUNT(sa.answer_id)                        AS attempts,
    SUM(sa.is_correct = TRUE)                  AS correct,
    SUM(sa.is_correct = FALSE)                 AS incorrect,
    ROUND(AVG(sa.time_taken_seconds), 1)       AS avg_time_secs,
    ROUND(100.0 * SUM(sa.is_correct = TRUE) / NULLIF(COUNT(sa.answer_id), 0), 1) AS correct_pct,
    CASE
        WHEN ROUND(100.0 * SUM(sa.is_correct = TRUE) / NULLIF(COUNT(sa.answer_id), 0), 1) >= 80 THEN 'Too Easy'
        WHEN ROUND(100.0 * SUM(sa.is_correct = TRUE) / NULLIF(COUNT(sa.answer_id), 0), 1) BETWEEN 40 AND 79 THEN 'Good'
        ELSE 'Very Hard'
    END AS question_rating
FROM   Questions q LEFT JOIN StudentAnswers sa ON q.question_id = sa.question_id
WHERE  q.exam_id = 1
GROUP  BY q.question_id, q.question_text, q.difficulty_level, q.marks
ORDER  BY correct_pct ASC;


-- ── Q05 : Suspicion Leaderboard ──────────────────────────────
SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(ea.suspicion_score) DESC) AS `rank`,
    u.full_name, u.email,
    COUNT(ea.attempt_id)         AS exams_attempted,
    SUM(ea.suspicion_score)      AS total_suspicion,
    SUM(ea.tab_switches)         AS total_tab_switches,
    SUM(ea.copy_paste_attempts)  AS total_copy_pastes,
    SUM(ea.fullscreen_exits)     AS total_fullscreen_exits,
    SUM(ea.status = 'flagged')   AS flagged_attempts,
    ROUND(AVG(ea.percentage), 1) AS avg_score_pct
FROM   ExamAttempts ea JOIN Users u ON ea.student_id = u.user_id
GROUP  BY u.user_id, u.full_name, u.email
ORDER  BY total_suspicion DESC LIMIT 10;


-- ── Q06 : Rapid Answering Detection (avg < 15 s/question) ────
SELECT
    u.full_name, ea.attempt_id, ex.title AS exam_title,
    COUNT(sa.answer_id)                      AS questions_answered,
    ROUND(AVG(sa.time_taken_seconds), 1)     AS avg_seconds_per_question,
    MIN(sa.time_taken_seconds)               AS fastest_answer_secs,
    SUM(sa.is_correct = TRUE)               AS correct_answers,
    ea.score, ea.suspicion_score
FROM   StudentAnswers sa
JOIN   ExamAttempts ea ON sa.attempt_id = ea.attempt_id
JOIN   Users        u  ON ea.student_id = u.user_id
JOIN   Exams        ex ON ea.exam_id    = ex.exam_id
GROUP  BY u.full_name, ea.attempt_id, ex.title, ea.score, ea.suspicion_score
HAVING avg_seconds_per_question < 15
ORDER  BY avg_seconds_per_question ASC;


-- ── Q07 : Multiple Login Report ──────────────────────────────
SELECT
    u.full_name, u.email,
    ls1.ip_address AS session_1_ip, ls2.ip_address AS session_2_ip,
    ls1.login_time AS session_1_start, ls2.login_time AS session_2_start,
    ls1.device_fingerprint AS device_1, ls2.device_fingerprint AS device_2,
    ea.attempt_id, ea.status AS exam_status
FROM   LoginSessions ls1
JOIN   LoginSessions ls2
       ON  ls1.user_id    = ls2.user_id
       AND ls1.session_id < ls2.session_id
       AND ls1.ip_address <> ls2.ip_address
       AND ls2.login_time BETWEEN ls1.login_time AND COALESCE(ls1.logout_time, NOW())
JOIN   Users u ON ls1.user_id = u.user_id
LEFT   JOIN ExamAttempts ea
       ON  ea.student_id = u.user_id
       AND ea.started_at BETWEEN ls1.login_time AND COALESCE(ls1.logout_time, NOW())
ORDER  BY ls2.login_time DESC;


-- ── Q08 : Exam Completion Funnel ─────────────────────────────
SELECT
    ex.exam_id, ex.title,
    COUNT(DISTINCT enr.student_id)                   AS enrolled_students,
    COUNT(DISTINCT ea.student_id)                    AS started_exam,
    SUM(ea.status IN ('submitted','graded','flagged')) AS submitted,
    SUM(ea.status = 'timed_out')                     AS timed_out,
    SUM(ea.status = 'abandoned')                     AS abandoned,
    SUM(ea.score >= ex.passing_marks)                AS passed,
    ROUND(100.0 * COUNT(DISTINCT ea.student_id)
          / NULLIF(COUNT(DISTINCT enr.student_id), 0), 1) AS start_rate_pct,
    ROUND(100.0 * SUM(ea.score >= ex.passing_marks)
          / NULLIF(COUNT(DISTINCT ea.student_id), 0), 1)  AS pass_rate_pct
FROM   Exams ex
JOIN   Enrollments enr ON ex.course_id = enr.course_id AND enr.status = 'active'
LEFT   JOIN ExamAttempts ea ON ex.exam_id = ea.exam_id
GROUP  BY ex.exam_id, ex.title, ex.passing_marks
ORDER  BY ex.window_start DESC;


-- ── Q09 : Proctoring Event Timeline for Attempt 1003 ─────────
SELECT
    pl.log_id, pl.logged_at, pl.event_type, pl.severity,
    CASE pl.severity
        WHEN 'CRITICAL' THEN '🔴 CRITICAL'
        WHEN 'HIGH'     THEN '🟠 HIGH'
        WHEN 'MEDIUM'   THEN '🟡 MEDIUM'
        WHEN 'LOW'      THEN '🟢 LOW'
        ELSE                 '⚪ INFO'
    END AS severity_label,
    pl.event_details, pl.ip_address,
    TIMESTAMPDIFF(SECOND,
        (SELECT MIN(logged_at) FROM ProctorLogs WHERE attempt_id = 1003),
        pl.logged_at) AS seconds_since_start
FROM   ProctorLogs pl
WHERE  pl.attempt_id = 1003
ORDER  BY pl.logged_at;


-- ── Q10 : Student Cross-Exam Performance (Instructor View) ───
SELECT
    u.full_name, u.email,
    COUNT(ea.attempt_id)                           AS exams_taken,
    ROUND(AVG(ea.percentage), 1)                   AS avg_percentage,
    SUM(ea.score >= ex.passing_marks)              AS total_passed,
    SUM(ea.score  < ex.passing_marks)              AS total_failed,
    MAX(ea.percentage)                             AS best_score_pct,
    MIN(ea.percentage)                             AS worst_score_pct,
    ROUND(AVG(ea.suspicion_score), 1)              AS avg_suspicion,
    SUM(ea.status = 'flagged')                     AS flagged_count,
    RANK() OVER (ORDER BY AVG(ea.percentage) DESC) AS class_rank
FROM   ExamAttempts ea
JOIN   Users u  ON ea.student_id = u.user_id
JOIN   Exams ex ON ea.exam_id    = ex.exam_id
WHERE  ex.course_id = 1 AND ea.status IN ('submitted', 'graded', 'flagged')
GROUP  BY u.user_id, u.full_name, u.email
ORDER  BY avg_percentage DESC;


-- ── Q11 : Admin — Cheat-Pattern Summary (System-Wide) ────────
SELECT
    pl.event_type, pl.severity,
    COUNT(*)                                            AS occurrences,
    COUNT(DISTINCT pl.attempt_id)                       AS unique_attempts_affected,
    COUNT(DISTINCT ea.student_id)                       AS unique_students,
    COUNT(DISTINCT ea.exam_id)                          AS exams_affected,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_all_events
FROM   ProctorLogs pl JOIN ExamAttempts ea ON pl.attempt_id = ea.attempt_id
WHERE  pl.severity <> 'INFO'
GROUP  BY pl.event_type, pl.severity
ORDER  BY occurrences DESC;


-- ── Q12 : Course-Level Pass/Fail Comparison ──────────────────
SELECT
    c.course_code, c.course_name, u.full_name AS instructor,
    COUNT(DISTINCT ex.exam_id)    AS total_exams,
    COUNT(DISTINCT ea.attempt_id) AS total_attempts,
    SUM(ea.score >= ex.passing_marks) AS passed,
    SUM(ea.score  < ex.passing_marks) AS failed,
    ROUND(100.0 * SUM(ea.score >= ex.passing_marks)
          / NULLIF(COUNT(ea.attempt_id), 0), 1) AS pass_rate_pct,
    ROUND(AVG(ea.percentage), 1)     AS avg_percentage,
    ROUND(AVG(ea.suspicion_score), 1) AS avg_suspicion
FROM   Courses c
JOIN   Exams   ex ON c.course_id    = ex.course_id
JOIN   Users   u  ON c.instructor_id = u.user_id
LEFT   JOIN ExamAttempts ea ON ex.exam_id = ea.exam_id
           AND ea.status IN ('submitted', 'graded', 'flagged')
GROUP  BY c.course_id, c.course_code, c.course_name, u.full_name
ORDER  BY pass_rate_pct DESC;
