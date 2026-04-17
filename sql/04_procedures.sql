-- ============================================================
--   STORED PROCEDURES  (8 total)
-- ============================================================
--   SP1  sp_start_exam              Student starts an exam
--   SP2  sp_submit_answer           Save / update one answer
--   SP3  sp_submit_exam             Finalise + score the attempt
--   SP4  sp_log_proctor_event       Front-end calls this to log events
--   SP5  sp_get_exam_results        Student views their results
--   SP6  sp_get_flagged_attempts    Proctor dashboard
--   SP7  sp_resolve_flag            Proctor closes a suspicion flag
--   SP8  sp_exam_analytics          Instructor summary report
-- ============================================================

USE ExamProctor;

DELIMITER //

-- ============================================================
-- SP1 : sp_start_exam
-- ─────────────────────────────────────────────────────────────
-- Called when a student clicks "Start Exam".
-- Validates enrollment, delegates window/attempt checks to T1,
-- creates ExamAttempt row, and logs the start event.
-- Returns attempt_id to the front-end via OUT param.
-- ============================================================
CREATE PROCEDURE sp_start_exam(
    IN  p_student_id  INT,
    IN  p_exam_id     INT,
    IN  p_ip_address  VARCHAR(45),
    IN  p_browser     VARCHAR(255),
    OUT p_attempt_id  INT,
    OUT p_message     VARCHAR(255)
)
sp_start_exam: BEGIN
    DECLARE v_enrolled INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 p_message = MESSAGE_TEXT;
        ROLLBACK;
        SET p_attempt_id = NULL;
    END;

    START TRANSACTION;

        -- 1. Verify the student is enrolled in the exam's course
        SELECT COUNT(*)
        INTO   v_enrolled
        FROM   Enrollments  e
        JOIN   Exams        ex ON e.course_id = ex.course_id
        WHERE  e.student_id = p_student_id
          AND  ex.exam_id   = p_exam_id
          AND  e.status     = 'active';

        IF v_enrolled = 0 THEN
            SET p_message = 'ERROR: Student is not enrolled in this exam course.';
            ROLLBACK;
            LEAVE sp_start_exam;   -- exit SP (requires labeled BEGIN block)
        END IF;

        -- 2. Create attempt (T1 fires here for all validations)
        INSERT INTO ExamAttempts (exam_id, student_id, ip_address, browser_info)
        VALUES (p_exam_id, p_student_id, p_ip_address, p_browser);

        SET p_attempt_id = LAST_INSERT_ID();

        -- 3. Log the start event (T6 won't fire yet; this is manual)
        INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
        VALUES (
            p_attempt_id,
            'EXAM_STARTED',
            'INFO',
            CONCAT('Exam started. Browser: ', COALESCE(p_browser, 'unknown')),
            p_ip_address
        );

    COMMIT;
    SET p_message = 'SUCCESS: Exam started.';
END //


-- ============================================================
-- SP2 : sp_submit_answer
-- ─────────────────────────────────────────────────────────────
-- Upsert pattern: first submission inserts; re-visit updates.
-- T2 (time check) and T3 (auto-grade) fire on every INSERT.
-- On UPDATE, we must re-grade manually since T3 is INSERT-only.
-- ============================================================
CREATE PROCEDURE sp_submit_answer(
    IN  p_attempt_id   INT,
    IN  p_question_id  INT,
    IN  p_selected     VARCHAR(500),
    IN  p_time_taken   INT,
    OUT p_message      VARCHAR(255)
)
BEGIN
    DECLARE v_correct   VARCHAR(500);
    DECLARE v_type      VARCHAR(20);
    DECLARE v_marks     DECIMAL(5,2);
    DECLARE v_is_correct BOOLEAN;
    DECLARE v_marks_obtained DECIMAL(5,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 p_message = MESSAGE_TEXT;
        ROLLBACK;
    END;

    -- Pre-compute grading for UPDATE branch
    SELECT correct_answer, question_type, marks
    INTO   v_correct, v_type, v_marks
    FROM   Questions WHERE question_id = p_question_id;

    IF v_type IN ('MCQ', 'TRUE_FALSE') THEN
        IF p_selected = v_correct THEN
            SET v_is_correct = TRUE;
            SET v_marks_obtained = v_marks;
        ELSE
            SET v_is_correct = FALSE;
            SET v_marks_obtained = 0.00;
        END IF;
    ELSE
        SET v_is_correct = NULL;
        SET v_marks_obtained = 0.00;
    END IF;

    START TRANSACTION;

        INSERT INTO StudentAnswers
            (attempt_id, question_id, selected_option, time_taken_seconds,
             is_correct, marks_obtained)
        VALUES
            (p_attempt_id, p_question_id, p_selected, p_time_taken,
             v_is_correct, v_marks_obtained)
        ON DUPLICATE KEY UPDATE
            selected_option    = p_selected,
            time_taken_seconds = p_time_taken,
            is_correct         = v_is_correct,
            marks_obtained     = v_marks_obtained,
            answered_at        = NOW();

    COMMIT;
    SET p_message = 'SUCCESS: Answer saved.';
END //


-- ============================================================
-- SP3 : sp_submit_exam
-- ─────────────────────────────────────────────────────────────
-- Finalises an in-progress attempt:
--   1. Locks the row (SELECT … FOR UPDATE) → concurrency safe
--   2. Sums marks_obtained from StudentAnswers
--   3. Updates ExamAttempts with score, percentage, status
-- T6 fires on the UPDATE and writes submission to ProctorLogs.
-- ============================================================
CREATE PROCEDURE sp_submit_exam(
    IN  p_attempt_id   INT,
    OUT p_score        DECIMAL(6,2),
    OUT p_percentage   DECIMAL(5,2),
    OUT p_passed       BOOLEAN,
    OUT p_message      VARCHAR(255)
)
BEGIN
    DECLARE v_total_marks   DECIMAL(6,2);
    DECLARE v_passing_marks DECIMAL(6,2);
    DECLARE v_status        VARCHAR(20);
    DECLARE v_calc_score    DECIMAL(6,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 p_message = MESSAGE_TEXT;
        ROLLBACK;
        SET p_score = NULL; SET p_percentage = NULL; SET p_passed = FALSE;
    END;

    START TRANSACTION;

        -- Lock the attempt row to prevent concurrent double-submissions
        SELECT ea.status, e.total_marks, e.passing_marks
        INTO   v_status, v_total_marks, v_passing_marks
        FROM   ExamAttempts ea
        JOIN   Exams e ON ea.exam_id = e.exam_id
        WHERE  ea.attempt_id = p_attempt_id
        FOR UPDATE;

        IF v_status <> 'in_progress' THEN
            ROLLBACK;
            SET p_message = CONCAT('ERROR: Cannot submit — current status is "', v_status, '".');
            SET p_score = NULL; SET p_percentage = NULL; SET p_passed = FALSE;
        ELSE
            -- Sum marks from all answered questions
            SELECT COALESCE(SUM(marks_obtained), 0.00)
            INTO   v_calc_score
            FROM   StudentAnswers
            WHERE  attempt_id = p_attempt_id;

            -- Finalise
            UPDATE ExamAttempts
            SET    score        = v_calc_score,
                   percentage   = ROUND((v_calc_score / v_total_marks) * 100, 2),
                   status       = 'submitted',
                   submitted_at = NOW()
            WHERE  attempt_id   = p_attempt_id;

            COMMIT;

            SET p_score      = v_calc_score;
            SET p_percentage = ROUND((v_calc_score / v_total_marks) * 100, 2);
            SET p_passed     = (v_calc_score >= v_passing_marks);
            SET p_message    = 'SUCCESS: Exam submitted successfully.';
        END IF;
END //


-- ============================================================
-- SP4 : sp_log_proctor_event
-- ─────────────────────────────────────────────────────────────
-- Lightweight wrapper called by the front-end whenever a
-- proctoring event is detected (tab switch, paste, etc.).
-- T4 fires after insert and updates suspicion_score.
-- T5 fires if suspicion_score update crosses threshold.
-- ============================================================
CREATE PROCEDURE sp_log_proctor_event(
    IN p_attempt_id   INT,
    IN p_event_type   VARCHAR(50),
    IN p_severity     VARCHAR(10),
    IN p_details      TEXT,
    IN p_ip           VARCHAR(45)
)
BEGIN
    INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
    VALUES (p_attempt_id, p_event_type, p_severity, p_details, p_ip);
    -- Triggers handle score update and auto-flagging
END //


-- ============================================================
-- SP5 : sp_get_exam_results
-- ─────────────────────────────────────────────────────────────
-- Returns two result sets:
--   RS1 : Attempt summary (score, pass/fail, timing)
--   RS2 : Per-question breakdown (correct_answer shown only if
--         show_results_immediately = TRUE on the exam)
-- ============================================================
CREATE PROCEDURE sp_get_exam_results(
    IN p_attempt_id INT,
    IN p_student_id INT
)
BEGIN
    -- Result Set 1: Overall summary
    SELECT
        ea.attempt_id,
        e.title                                          AS exam_title,
        c.course_name,
        ea.started_at,
        ea.submitted_at,
        TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_taken_mins,
        ea.score,
        ea.percentage,
        e.passing_marks,
        e.total_marks,
        CASE WHEN ea.score >= e.passing_marks THEN 'PASS' ELSE 'FAIL' END AS result,
        ea.status,
        ea.suspicion_score
    FROM  ExamAttempts ea
    JOIN  Exams   e ON ea.exam_id   = e.exam_id
    JOIN  Courses c ON e.course_id  = c.course_id
    WHERE ea.attempt_id = p_attempt_id
      AND ea.student_id = p_student_id;

    -- Result Set 2: Question-level breakdown
    SELECT
        q.order_index,
        q.question_text,
        q.question_type,
        sa.selected_option                                       AS your_answer,
        CASE WHEN e.show_results_immediately THEN q.correct_answer
             ELSE '[ Hidden ]' END                              AS correct_answer,
        sa.is_correct,
        sa.marks_obtained,
        q.marks                                                 AS max_marks,
        sa.time_taken_seconds,
        q.difficulty_level
    FROM  StudentAnswers sa
    JOIN  Questions      q  ON sa.question_id  = q.question_id
    JOIN  ExamAttempts   ea ON sa.attempt_id   = ea.attempt_id
    JOIN  Exams          e  ON ea.exam_id      = e.exam_id
    WHERE sa.attempt_id  = p_attempt_id
      AND ea.student_id  = p_student_id
    ORDER BY q.order_index;
END //


-- ============================================================
-- SP6 : sp_get_flagged_attempts
-- ─────────────────────────────────────────────────────────────
-- Proctor dashboard: sorted by suspicion_score DESC.
-- Includes per-exam breakdown of every cheating indicator.
-- ============================================================
CREATE PROCEDURE sp_get_flagged_attempts(
    IN p_exam_id INT
)
BEGIN
    SELECT
        ea.attempt_id,
        u.full_name                                       AS student_name,
        u.email,
        ea.status,
        ea.suspicion_score,
        ea.tab_switches,
        ea.copy_paste_attempts,
        ea.fullscreen_exits,
        ea.score,
        ea.percentage,
        ea.ip_address,
        COUNT(sf.flag_id)                                 AS total_flags,
        SUM(CASE WHEN sf.is_resolved = FALSE THEN 1 ELSE 0 END)
                                                          AS open_flags,
        COUNT(pl.log_id)                                  AS proctor_events,
        SUM(CASE WHEN pl.severity IN ('HIGH','CRITICAL') THEN 1 ELSE 0 END)
                                                          AS critical_events
    FROM   ExamAttempts  ea
    JOIN   Users         u  ON ea.student_id  = u.user_id
    LEFT   JOIN SuspicionFlags sf ON ea.attempt_id = sf.attempt_id
    LEFT   JOIN ProctorLogs    pl ON ea.attempt_id = pl.attempt_id
    WHERE  ea.exam_id   = p_exam_id
      AND  (ea.status = 'flagged' OR ea.suspicion_score >= 40)
    GROUP  BY ea.attempt_id, u.full_name, u.email, ea.status,
              ea.suspicion_score, ea.tab_switches,
              ea.copy_paste_attempts, ea.fullscreen_exits,
              ea.score, ea.percentage, ea.ip_address
    ORDER  BY ea.suspicion_score DESC;
END //


-- ============================================================
-- SP7 : sp_resolve_flag
-- ─────────────────────────────────────────────────────────────
-- Proctor resolves a specific SuspicionFlag with notes.
-- ============================================================
CREATE PROCEDURE sp_resolve_flag(
    IN  p_flag_id        INT,
    IN  p_resolved_by    INT,
    IN  p_resolution     TEXT,
    OUT p_message        VARCHAR(255)
)
BEGIN
    DECLARE v_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO v_exists
    FROM   SuspicionFlags
    WHERE  flag_id = p_flag_id AND is_resolved = FALSE;

    IF v_exists = 0 THEN
        SET p_message = 'ERROR: Flag not found or already resolved.';
    ELSE
        UPDATE SuspicionFlags
        SET    is_resolved      = TRUE,
               resolved_by      = p_resolved_by,
               resolved_at      = NOW(),
               resolution_notes = p_resolution
        WHERE  flag_id          = p_flag_id;

        SET p_message = 'SUCCESS: Flag resolved.';
    END IF;
END //


-- ============================================================
-- SP8 : sp_exam_analytics
-- ─────────────────────────────────────────────────────────────
-- Instructor-facing analytics for a given exam.
-- Returns: score distribution, pass rate, question stats,
--          top suspicious students.
-- ============================================================
CREATE PROCEDURE sp_exam_analytics(
    IN p_exam_id INT
)
BEGIN
    -- RS1: Overall exam statistics
    SELECT
        COUNT(*)                                  AS total_attempts,
        SUM(CASE WHEN status = 'submitted'  THEN 1 ELSE 0 END)  AS submitted,
        SUM(CASE WHEN status = 'timed_out'  THEN 1 ELSE 0 END)  AS timed_out,
        SUM(CASE WHEN status = 'flagged'    THEN 1 ELSE 0 END)  AS flagged,
        SUM(CASE WHEN status = 'abandoned'  THEN 1 ELSE 0 END)  AS abandoned,
        ROUND(AVG(score), 2)                      AS avg_score,
        MAX(score)                                AS highest_score,
        MIN(score)                                AS lowest_score,
        ROUND(AVG(percentage), 2)                 AS avg_percentage,
        SUM(CASE WHEN score >= (SELECT passing_marks FROM Exams WHERE exam_id = p_exam_id)
                 THEN 1 ELSE 0 END)               AS pass_count,
        ROUND(
            100.0 * SUM(CASE WHEN score >= (SELECT passing_marks FROM Exams WHERE exam_id = p_exam_id)
                             THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 1
        )                                         AS pass_rate_pct
    FROM  ExamAttempts
    WHERE exam_id = p_exam_id
      AND status IN ('submitted', 'graded', 'flagged');

    -- RS2: Question difficulty (% correct per question)
    SELECT
        q.question_id,
        LEFT(q.question_text, 60)                AS question_preview,
        q.difficulty_level,
        q.marks,
        COUNT(sa.answer_id)                      AS times_answered,
        SUM(CASE WHEN sa.is_correct = TRUE THEN 1 ELSE 0 END) AS correct_count,
        ROUND(
            100.0 * SUM(CASE WHEN sa.is_correct = TRUE THEN 1 ELSE 0 END)
            / NULLIF(COUNT(sa.answer_id), 0), 1
        )                                        AS correct_pct
    FROM  Questions      q
    LEFT  JOIN StudentAnswers sa ON q.question_id = sa.question_id
    WHERE q.exam_id = p_exam_id
    GROUP BY q.question_id, q.question_text, q.difficulty_level, q.marks
    ORDER BY correct_pct ASC;   -- hardest questions first

    -- RS3: Top 10 most suspicious students
    SELECT
        u.full_name,
        ea.suspicion_score,
        ea.tab_switches,
        ea.copy_paste_attempts,
        ea.status,
        ea.score
    FROM  ExamAttempts ea
    JOIN  Users u ON ea.student_id = u.user_id
    WHERE ea.exam_id = p_exam_id
    ORDER BY ea.suspicion_score DESC
    LIMIT 10;
END //

DELIMITER ;
