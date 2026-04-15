-- ============================================================
--  00_patch_apply_all.sql
--  Run this file to bring the live ExamProctor database
--  fully up to date with all edited SQL files.
--
--  What this does:
--    1. Removes face_not_detected column (was removed from schema)
--    2. Drops and recreates all 7 triggers (03_triggers.sql)
--    3. Drops and recreates all 8 stored procedures (04_procedures.sql)
--    4. Drops and recreates all 6 transaction demo procs (05_transactions.sql)
--
--  Safe to run multiple times (all DROP IF EXISTS first).
--  Run from MySQL Workbench or CLI:
--    mysql -u root -p ExamProctor < sql/00_patch_apply_all.sql
-- ============================================================

USE ExamProctor;

-- ============================================================
-- PART 1 — Remove face_not_detected column
-- ============================================================
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'ExamProctor'
    AND TABLE_NAME   = 'ExamAttempts'
    AND COLUMN_NAME  = 'face_not_detected'
);

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE ExamAttempts DROP COLUMN face_not_detected',
  'SELECT "face_not_detected column already removed" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- PART 1b — Add 'teacher' to role ENUMs (idempotent)
-- ============================================================
-- Users.role ENUM
ALTER TABLE Users
  MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin')
  NOT NULL DEFAULT 'student';

-- UserRoles.role ENUM
ALTER TABLE UserRoles
  MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin')
  NOT NULL;

-- ============================================================
-- PART 2 — Triggers (drop all, recreate all)
-- ============================================================
DROP TRIGGER IF EXISTS trg_validate_exam_start;
DROP TRIGGER IF EXISTS trg_check_time_on_answer;
DROP TRIGGER IF EXISTS trg_auto_grade_answer;
DROP TRIGGER IF EXISTS trg_update_suspicion_score;
DROP TRIGGER IF EXISTS trg_auto_flag_suspicious;
DROP TRIGGER IF EXISTS trg_log_exam_submission;
DROP TRIGGER IF EXISTS trg_detect_multiple_logins;

DELIMITER //

-- T1 : Gate-keep exam starts
CREATE TRIGGER trg_validate_exam_start
BEFORE INSERT ON ExamAttempts
FOR EACH ROW
BEGIN
    DECLARE v_window_start  DATETIME;
    DECLARE v_window_end    DATETIME;
    DECLARE v_is_published  BOOLEAN;
    DECLARE v_max_attempts  INT;
    DECLARE v_attempt_count INT;

    SELECT window_start, window_end, is_published, max_attempts
    INTO   v_window_start, v_window_end, v_is_published, v_max_attempts
    FROM   Exams WHERE exam_id = NEW.exam_id;

    IF NOT v_is_published THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Exam is not published yet.';
    END IF;

    IF NOW() < v_window_start THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Exam window has not opened yet.';
    END IF;

    IF NOW() > v_window_end THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Exam window has closed. No new attempts allowed.';
    END IF;

    SELECT COUNT(*) INTO v_attempt_count
    FROM   ExamAttempts
    WHERE  exam_id = NEW.exam_id AND student_id = NEW.student_id;

    IF v_attempt_count >= v_max_attempts THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Maximum allowed attempts reached for this exam.';
    END IF;

    SET NEW.attempt_number = v_attempt_count + 1;
END //


-- T2 : Block answer submission after time expiry
CREATE TRIGGER trg_check_time_on_answer
BEFORE INSERT ON StudentAnswers
FOR EACH ROW
BEGIN
    DECLARE v_started_at     DATETIME;
    DECLARE v_duration_mins  INT;
    DECLARE v_attempt_status VARCHAR(20);
    DECLARE v_elapsed_mins   INT;

    SELECT ea.started_at, e.duration_minutes, ea.status
    INTO   v_started_at, v_duration_mins, v_attempt_status
    FROM   ExamAttempts ea
    JOIN   Exams e ON ea.exam_id = e.exam_id
    WHERE  ea.attempt_id = NEW.attempt_id;

    IF v_attempt_status <> 'in_progress' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Exam is no longer in progress.';
    END IF;

    SET v_elapsed_mins = TIMESTAMPDIFF(MINUTE, v_started_at, NOW());

    IF v_elapsed_mins >= v_duration_mins THEN
        UPDATE ExamAttempts
        SET    status = 'timed_out', submitted_at = NOW(), auto_submitted = TRUE
        WHERE  attempt_id = NEW.attempt_id;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERROR: Time limit exceeded. Exam auto-submitted.';
    END IF;
END //


-- T3 : Auto-grade MCQ and TRUE_FALSE answers
CREATE TRIGGER trg_auto_grade_answer
BEFORE INSERT ON StudentAnswers
FOR EACH ROW
BEGIN
    DECLARE v_correct  VARCHAR(500);
    DECLARE v_type     VARCHAR(20);
    DECLARE v_marks    DECIMAL(5,2);

    SELECT correct_answer, question_type, marks
    INTO   v_correct, v_type, v_marks
    FROM   Questions WHERE question_id = NEW.question_id;

    IF v_type IN ('MCQ', 'TRUE_FALSE') THEN
        IF NEW.selected_option = v_correct THEN
            SET NEW.is_correct     = TRUE;
            SET NEW.marks_obtained = v_marks;
        ELSE
            SET NEW.is_correct     = FALSE;
            SET NEW.marks_obtained = 0.00;
        END IF;
    ELSE
        SET NEW.is_correct     = NULL;
        SET NEW.marks_obtained = 0.00;
    END IF;
END //


-- T4 : Update suspicion score + counters on every ProctorLog insert
CREATE TRIGGER trg_update_suspicion_score
AFTER INSERT ON ProctorLogs
FOR EACH ROW
BEGIN
    DECLARE v_increment INT DEFAULT 0;

    CASE NEW.severity
        WHEN 'LOW'      THEN SET v_increment = 3;
        WHEN 'MEDIUM'   THEN SET v_increment = 7;
        WHEN 'HIGH'     THEN SET v_increment = 15;
        WHEN 'CRITICAL' THEN SET v_increment = 25;
        ELSE                 SET v_increment = 0;
    END CASE;

    IF v_increment > 0 THEN
        UPDATE ExamAttempts
        SET    suspicion_score = LEAST(100, suspicion_score + v_increment)
        WHERE  attempt_id = NEW.attempt_id;
    END IF;

    CASE NEW.event_type
        WHEN 'TAB_SWITCH' THEN
            UPDATE ExamAttempts SET tab_switches = tab_switches + 1 WHERE attempt_id = NEW.attempt_id;
        WHEN 'COPY_PASTE_DETECTED' THEN
            UPDATE ExamAttempts SET copy_paste_attempts = copy_paste_attempts + 1 WHERE attempt_id = NEW.attempt_id;
        WHEN 'FULLSCREEN_EXIT' THEN
            UPDATE ExamAttempts SET fullscreen_exits = fullscreen_exits + 1 WHERE attempt_id = NEW.attempt_id;
        ELSE BEGIN END;
    END CASE;
END //


-- T5 : Auto-flag when thresholds are crossed
CREATE TRIGGER trg_auto_flag_suspicious
BEFORE UPDATE ON ExamAttempts
FOR EACH ROW
BEGIN
    IF NEW.suspicion_score >= 70 AND OLD.suspicion_score < 70 THEN
        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'HIGH_SUSPICION_SCORE',
            CONCAT('Suspicion score reached ', NEW.suspicion_score,
                   ' (threshold: 70). Tab switches: ', NEW.tab_switches,
                   ', Copy-paste: ', NEW.copy_paste_attempts,
                   '. Auto-flagged for proctor review.')
        );
        -- Use SET NEW instead of UPDATE to avoid "table already in use" error
        IF NEW.status = 'in_progress' THEN
            SET NEW.status = 'flagged';
        END IF;
    END IF;

    IF NEW.tab_switches >= 5 AND OLD.tab_switches < 5 THEN
        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'EXCESSIVE_TAB_SWITCHES',
            CONCAT('Student switched tabs ', NEW.tab_switches, ' times. Policy limit is 5. Auto-flagged.')
        );
    END IF;

    IF NEW.copy_paste_attempts >= 3 AND OLD.copy_paste_attempts < 3 THEN
        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'COPY_PASTE_ABUSE',
            CONCAT('Copy-paste detected ', NEW.copy_paste_attempts,
                   ' times during exam. Policy limit is 3. Auto-flagged.')
        );
    END IF;
END //


-- T6 : Immutable audit trail on exam submission
CREATE TRIGGER trg_log_exam_submission
AFTER UPDATE ON ExamAttempts
FOR EACH ROW
BEGIN
    -- Exclude 'flagged': that transition is driven by T4→T5 (from within a ProctorLogs trigger)
    -- and T6 inserting back into ProctorLogs would re-trigger T4, causing a MySQL cascade error.
    IF OLD.status = 'in_progress'
       AND NEW.status IN ('submitted', 'timed_out')
    THEN
        INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details)
        VALUES (
            NEW.attempt_id,
            CASE
                WHEN NEW.auto_submitted       THEN 'AUTO_SUBMITTED'
                WHEN NEW.status = 'timed_out' THEN 'AUTO_SUBMITTED'
                ELSE 'EXAM_SUBMITTED'
            END,
            'INFO',
            CONCAT('Status → ', NEW.status, '. ',
                   'Duration: ', TIMESTAMPDIFF(MINUTE, NEW.started_at, NOW()), ' min. ',
                   'Score: ', COALESCE(NEW.score, 'Pending'), '. ',
                   'Suspicion: ', NEW.suspicion_score, '/100.')
        );
    END IF;
END //


-- T7 : Detect concurrent logins from different IPs
CREATE TRIGGER trg_detect_multiple_logins
AFTER INSERT ON LoginSessions
FOR EACH ROW
BEGIN
    DECLARE v_concurrent_sessions INT;
    DECLARE v_attempt_id          INT DEFAULT NULL;

    SELECT COUNT(*)
    INTO   v_concurrent_sessions
    FROM   LoginSessions
    WHERE  user_id    = NEW.user_id
      AND  is_active  = TRUE
      AND  session_id <> NEW.session_id
      AND  ip_address <> NEW.ip_address;

    IF v_concurrent_sessions > 0 THEN
        SELECT attempt_id INTO v_attempt_id
        FROM   ExamAttempts
        WHERE  student_id = NEW.user_id AND status = 'in_progress'
        ORDER  BY started_at DESC LIMIT 1;

        IF v_attempt_id IS NOT NULL THEN
            INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
            VALUES (
                v_attempt_id,
                'IDLE_WARNING',
                'CRITICAL',
                CONCAT('Multiple login detected: new session from IP ', NEW.ip_address,
                       ' while exam attempt #', v_attempt_id,
                       ' is already active from a different IP.'),
                NEW.ip_address
            );
        END IF;
    END IF;
END //

DELIMITER ;

-- ============================================================
-- PART 3 — Stored Procedures
-- ============================================================
DROP PROCEDURE IF EXISTS sp_start_exam;
DROP PROCEDURE IF EXISTS sp_submit_answer;
DROP PROCEDURE IF EXISTS sp_submit_exam;
DROP PROCEDURE IF EXISTS sp_log_proctor_event;
DROP PROCEDURE IF EXISTS sp_get_exam_results;
DROP PROCEDURE IF EXISTS sp_get_flagged_attempts;
DROP PROCEDURE IF EXISTS sp_resolve_flag;
DROP PROCEDURE IF EXISTS sp_exam_analytics;

DELIMITER //

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
        SELECT COUNT(*) INTO v_enrolled
        FROM   Enrollments e JOIN Exams ex ON e.course_id = ex.course_id
        WHERE  e.student_id = p_student_id AND ex.exam_id = p_exam_id AND e.status = 'active';

        IF v_enrolled = 0 THEN
            SET p_message = 'ERROR: Student is not enrolled in this exam course.';
            ROLLBACK;
            LEAVE sp_start_exam;
        END IF;

        INSERT INTO ExamAttempts (exam_id, student_id, ip_address, browser_info)
        VALUES (p_exam_id, p_student_id, p_ip_address, p_browser);
        SET p_attempt_id = LAST_INSERT_ID();

        INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
        VALUES (p_attempt_id, 'EXAM_STARTED', 'INFO',
                CONCAT('Exam started. Browser: ', COALESCE(p_browser, 'unknown')), p_ip_address);
    COMMIT;
    SET p_message = 'SUCCESS: Exam started.';
END //


CREATE PROCEDURE sp_submit_answer(
    IN  p_attempt_id   INT,
    IN  p_question_id  INT,
    IN  p_selected     VARCHAR(500),
    IN  p_time_taken   INT,
    OUT p_message      VARCHAR(255)
)
BEGIN
    DECLARE v_correct        VARCHAR(500);
    DECLARE v_type           VARCHAR(20);
    DECLARE v_marks          DECIMAL(5,2);
    DECLARE v_is_correct     BOOLEAN;
    DECLARE v_marks_obtained DECIMAL(5,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 p_message = MESSAGE_TEXT;
        ROLLBACK;
    END;

    SELECT correct_answer, question_type, marks
    INTO   v_correct, v_type, v_marks
    FROM   Questions WHERE question_id = p_question_id;

    IF v_type IN ('MCQ', 'TRUE_FALSE') THEN
        IF p_selected = v_correct THEN
            SET v_is_correct = TRUE;  SET v_marks_obtained = v_marks;
        ELSE
            SET v_is_correct = FALSE; SET v_marks_obtained = 0.00;
        END IF;
    ELSE
        SET v_is_correct = NULL; SET v_marks_obtained = 0.00;
    END IF;

    START TRANSACTION;
        INSERT INTO StudentAnswers
            (attempt_id, question_id, selected_option, time_taken_seconds, is_correct, marks_obtained)
        VALUES
            (p_attempt_id, p_question_id, p_selected, p_time_taken, v_is_correct, v_marks_obtained)
        ON DUPLICATE KEY UPDATE
            selected_option = p_selected, time_taken_seconds = p_time_taken,
            is_correct = v_is_correct, marks_obtained = v_marks_obtained, answered_at = NOW();
    COMMIT;
    SET p_message = 'SUCCESS: Answer saved.';
END //


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
        SELECT ea.status, e.total_marks, e.passing_marks
        INTO   v_status, v_total_marks, v_passing_marks
        FROM   ExamAttempts ea JOIN Exams e ON ea.exam_id = e.exam_id
        WHERE  ea.attempt_id = p_attempt_id FOR UPDATE;

        IF v_status <> 'in_progress' THEN
            ROLLBACK;
            SET p_message    = CONCAT('ERROR: Cannot submit — current status is "', v_status, '".');
            SET p_score      = NULL; SET p_percentage = NULL; SET p_passed = FALSE;
        ELSE
            SELECT COALESCE(SUM(marks_obtained), 0.00) INTO v_calc_score
            FROM   StudentAnswers WHERE attempt_id = p_attempt_id;

            UPDATE ExamAttempts
            SET    score = v_calc_score,
                   percentage = ROUND((v_calc_score / v_total_marks) * 100, 2),
                   status = 'submitted', submitted_at = NOW()
            WHERE  attempt_id = p_attempt_id;
            COMMIT;

            SET p_score      = v_calc_score;
            SET p_percentage = ROUND((v_calc_score / v_total_marks) * 100, 2);
            SET p_passed     = (v_calc_score >= v_passing_marks);
            SET p_message    = 'SUCCESS: Exam submitted successfully.';
        END IF;
END //


CREATE PROCEDURE sp_log_proctor_event(
    IN p_attempt_id  INT,
    IN p_event_type  VARCHAR(50),
    IN p_severity    VARCHAR(10),
    IN p_details     TEXT,
    IN p_ip          VARCHAR(45)
)
BEGIN
    INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, ip_address)
    VALUES (p_attempt_id, p_event_type, p_severity, p_details, p_ip);
END //


CREATE PROCEDURE sp_get_exam_results(IN p_attempt_id INT, IN p_student_id INT)
BEGIN
    SELECT ea.attempt_id, e.title AS exam_title, c.course_name,
           ea.started_at, ea.submitted_at,
           TIMESTAMPDIFF(MINUTE, ea.started_at, ea.submitted_at) AS duration_taken_mins,
           ea.score, ea.percentage, e.passing_marks, e.total_marks,
           CASE WHEN ea.score >= e.passing_marks THEN 'PASS' ELSE 'FAIL' END AS result,
           ea.status, ea.suspicion_score
    FROM  ExamAttempts ea
    JOIN  Exams   e ON ea.exam_id  = e.exam_id
    JOIN  Courses c ON e.course_id = c.course_id
    WHERE ea.attempt_id = p_attempt_id AND ea.student_id = p_student_id;

    SELECT q.order_index, q.question_text, q.question_type,
           sa.selected_option AS your_answer,
           CASE WHEN e.show_results_immediately THEN q.correct_answer ELSE '[ Hidden ]' END AS correct_answer,
           sa.is_correct, sa.marks_obtained, q.marks AS max_marks,
           sa.time_taken_seconds, q.difficulty_level
    FROM  StudentAnswers sa
    JOIN  Questions    q  ON sa.question_id = q.question_id
    JOIN  ExamAttempts ea ON sa.attempt_id  = ea.attempt_id
    JOIN  Exams        e  ON ea.exam_id     = e.exam_id
    WHERE sa.attempt_id = p_attempt_id AND ea.student_id = p_student_id
    ORDER BY q.order_index;
END //


CREATE PROCEDURE sp_get_flagged_attempts(IN p_exam_id INT)
BEGIN
    SELECT ea.attempt_id, u.full_name AS student_name, u.email, ea.status,
           ea.suspicion_score, ea.tab_switches, ea.copy_paste_attempts,
           ea.fullscreen_exits, ea.score, ea.percentage, ea.ip_address,
           COUNT(sf.flag_id) AS total_flags,
           SUM(CASE WHEN sf.is_resolved = FALSE THEN 1 ELSE 0 END) AS open_flags,
           COUNT(pl.log_id) AS proctor_events,
           SUM(CASE WHEN pl.severity IN ('HIGH','CRITICAL') THEN 1 ELSE 0 END) AS critical_events
    FROM   ExamAttempts ea
    JOIN   Users u ON ea.student_id = u.user_id
    LEFT   JOIN SuspicionFlags sf ON ea.attempt_id = sf.attempt_id
    LEFT   JOIN ProctorLogs    pl ON ea.attempt_id = pl.attempt_id
    WHERE  ea.exam_id = p_exam_id
      AND  (ea.status = 'flagged' OR ea.suspicion_score >= 40)
    GROUP  BY ea.attempt_id, u.full_name, u.email, ea.status,
              ea.suspicion_score, ea.tab_switches, ea.copy_paste_attempts,
              ea.fullscreen_exits, ea.score, ea.percentage, ea.ip_address
    ORDER  BY ea.suspicion_score DESC;
END //


CREATE PROCEDURE sp_resolve_flag(
    IN  p_flag_id     INT,
    IN  p_resolved_by INT,
    IN  p_resolution  TEXT,
    OUT p_message     VARCHAR(255)
)
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    SELECT COUNT(*) INTO v_exists FROM SuspicionFlags WHERE flag_id = p_flag_id AND is_resolved = FALSE;

    IF v_exists = 0 THEN
        SET p_message = 'ERROR: Flag not found or already resolved.';
    ELSE
        UPDATE SuspicionFlags
        SET    is_resolved = TRUE, resolved_by = p_resolved_by,
               resolved_at = NOW(), resolution_notes = p_resolution
        WHERE  flag_id = p_flag_id;
        SET p_message = 'SUCCESS: Flag resolved.';
    END IF;
END //


CREATE PROCEDURE sp_exam_analytics(IN p_exam_id INT)
BEGIN
    SELECT COUNT(*) AS total_attempts,
           SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
           SUM(CASE WHEN status='timed_out' THEN 1 ELSE 0 END) AS timed_out,
           SUM(CASE WHEN status='flagged'   THEN 1 ELSE 0 END) AS flagged,
           ROUND(AVG(score),2) AS avg_score, MAX(score) AS highest_score,
           MIN(score) AS lowest_score, ROUND(AVG(percentage),2) AS avg_percentage,
           SUM(CASE WHEN score >= (SELECT passing_marks FROM Exams WHERE exam_id=p_exam_id) THEN 1 ELSE 0 END) AS pass_count,
           ROUND(100.0*SUM(CASE WHEN score>=(SELECT passing_marks FROM Exams WHERE exam_id=p_exam_id) THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) AS pass_rate_pct
    FROM  ExamAttempts WHERE exam_id=p_exam_id AND status IN ('submitted','graded','flagged');

    SELECT q.question_id, LEFT(q.question_text,60) AS question_preview,
           q.difficulty_level, q.marks, COUNT(sa.answer_id) AS times_answered,
           SUM(CASE WHEN sa.is_correct=TRUE THEN 1 ELSE 0 END) AS correct_count,
           ROUND(100.0*SUM(CASE WHEN sa.is_correct=TRUE THEN 1 ELSE 0 END)/NULLIF(COUNT(sa.answer_id),0),1) AS correct_pct
    FROM  Questions q
    LEFT  JOIN StudentAnswers sa ON q.question_id=sa.question_id
    WHERE q.exam_id=p_exam_id
    GROUP BY q.question_id,q.question_text,q.difficulty_level,q.marks
    ORDER BY correct_pct ASC;

    SELECT u.full_name, ea.suspicion_score, ea.tab_switches, ea.copy_paste_attempts, ea.status, ea.score
    FROM  ExamAttempts ea JOIN Users u ON ea.student_id=u.user_id
    WHERE ea.exam_id=p_exam_id ORDER BY ea.suspicion_score DESC LIMIT 10;
END //

DELIMITER ;

-- ============================================================
-- PART 4 — Transaction demo procedures
-- ============================================================
DROP PROCEDURE IF EXISTS txn_demo_1;
DROP PROCEDURE IF EXISTS txn_demo_2;
DROP PROCEDURE IF EXISTS txn_demo_3;
DROP PROCEDURE IF EXISTS txn_demo_4;
DROP PROCEDURE IF EXISTS txn_demo_5;
DROP PROCEDURE IF EXISTS txn_demo_6_session_b;

DELIMITER //

CREATE PROCEDURE txn_demo_1(IN p_attempt_id INT)
BEGIN
    DECLARE v_status     VARCHAR(20);
    DECLARE v_calc_score DECIMAL(6,2);
    DECLARE v_total      DECIMAL(6,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Unexpected error during submission.' AS result; END;

    START TRANSACTION;
        SELECT ea.status, e.total_marks INTO v_status, v_total
        FROM   ExamAttempts ea JOIN Exams e ON ea.exam_id=e.exam_id
        WHERE  ea.attempt_id=p_attempt_id AND ea.status='in_progress' FOR UPDATE;

        IF v_status IS NULL THEN
            ROLLBACK;
            SELECT 'ROLLBACK: Attempt already submitted or not found.' AS result;
        ELSE
            SELECT COALESCE(SUM(marks_obtained),0) INTO v_calc_score
            FROM   StudentAnswers WHERE attempt_id=p_attempt_id;
            UPDATE ExamAttempts
            SET    score=v_calc_score, percentage=ROUND((v_calc_score/v_total)*100,2),
                   status='submitted', submitted_at=NOW()
            WHERE  attempt_id=p_attempt_id;
            COMMIT;
            SELECT CONCAT('COMMIT: Score=',v_calc_score,' | Pct=',ROUND((v_calc_score/v_total)*100,2),'%') AS result;
        END IF;
END //


CREATE PROCEDURE txn_demo_2(IN p_attempt_id INT, IN p_question_id INT, IN p_selected VARCHAR(500), IN p_time_taken INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SELECT 'ROLLBACK: Concurrent write conflict.' AS result; END;
    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
    START TRANSACTION;
        INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,time_taken_seconds)
        VALUES (p_attempt_id,p_question_id,p_selected,p_time_taken) AS new_ans
        ON DUPLICATE KEY UPDATE
            selected_option=new_ans.selected_option, time_taken_seconds=new_ans.time_taken_seconds, answered_at=NOW();
    COMMIT;
    SELECT 'COMMIT: Answer saved (upsert).' AS result;
END //


CREATE PROCEDURE txn_demo_3(IN p_exam_id INT, IN p_new_total DECIMAL(6,2))
BEGIN
    DECLARE v_old_ts DATETIME;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during optimistic update.' AS result; END;
    SELECT updated_at INTO v_old_ts FROM Exams WHERE exam_id=p_exam_id;
    START TRANSACTION;
        UPDATE Exams SET total_marks=p_new_total, updated_at=NOW()
        WHERE  exam_id=p_exam_id AND updated_at=v_old_ts;
        IF ROW_COUNT()=0 THEN
            ROLLBACK; SELECT 'ROLLBACK: Concurrent modification detected. Please retry.' AS result;
        ELSE
            COMMIT; SELECT 'COMMIT: Exam updated successfully.' AS result;
        END IF;
END //


CREATE PROCEDURE txn_demo_4(IN p_exam_id INT, IN p_proctor_id INT, IN p_notes TEXT)
BEGIN
    DECLARE v_count INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during bulk flag resolution.' AS result; END;
    START TRANSACTION;
        UPDATE SuspicionFlags sf JOIN ExamAttempts ea ON sf.attempt_id=ea.attempt_id
        SET    sf.is_resolved=TRUE, sf.resolved_by=p_proctor_id, sf.resolved_at=NOW(), sf.resolution_notes=p_notes
        WHERE  ea.exam_id=p_exam_id AND sf.is_resolved=FALSE;
        SET v_count=ROW_COUNT();
        IF v_count=0 THEN ROLLBACK; SELECT 'ROLLBACK: No open flags found for this exam.' AS result;
        ELSE COMMIT; SELECT CONCAT('COMMIT: ',v_count,' flags resolved.') AS result;
        END IF;
END //


CREATE PROCEDURE txn_demo_5(IN p_exam_id INT)
BEGIN
    DECLARE v_is_published BOOLEAN;
    DECLARE v_q_count      INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during publish.' AS result; END;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    START TRANSACTION;
        SELECT is_published INTO v_is_published FROM Exams WHERE exam_id=p_exam_id FOR UPDATE;
        IF v_is_published=TRUE THEN ROLLBACK; SELECT 'ROLLBACK: Exam is already published.' AS result;
        ELSE
            SELECT COUNT(*) INTO v_q_count FROM Questions WHERE exam_id=p_exam_id;
            IF v_q_count=0 THEN ROLLBACK; SELECT 'ROLLBACK: Cannot publish exam with no questions.' AS result;
            ELSE
                UPDATE Exams SET is_published=TRUE, updated_at=NOW() WHERE exam_id=p_exam_id;
                COMMIT; SELECT CONCAT('COMMIT: Exam #',p_exam_id,' published with ',v_q_count,' questions.') AS result;
            END IF;
        END IF;
END //


CREATE PROCEDURE txn_demo_6_session_b(IN p_attempt_id INT)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SELECT 'ROLLBACK: Lock wait or error.' AS result; END;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    START TRANSACTION;
        SELECT status INTO v_status FROM ExamAttempts WHERE attempt_id=p_attempt_id FOR UPDATE;
        IF v_status <> 'in_progress' THEN
            ROLLBACK; SELECT CONCAT('Session B: ROLLBACK — attempt already ',v_status,'.') AS result;
        ELSE
            UPDATE ExamAttempts SET status='submitted', submitted_at=NOW()
            WHERE  attempt_id=p_attempt_id AND status='in_progress';
            COMMIT; SELECT 'Session B: COMMIT (Session A had not yet submitted).' AS result;
        END IF;
END //

DELIMITER ;

-- ============================================================
-- Verification
-- ============================================================
SELECT 'Triggers installed:' AS check_type, COUNT(*) AS count
FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA='ExamProctor'
UNION ALL
SELECT 'Procedures installed:', COUNT(*)
FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA='ExamProctor' AND ROUTINE_TYPE='PROCEDURE'
UNION ALL
SELECT 'face_not_detected column exists:', COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='ExamAttempts' AND COLUMN_NAME='face_not_detected';
