-- ============================================================
--   TRIGGERS  (7 total)
-- ============================================================
--   T1  trg_validate_exam_start      BEFORE INSERT ExamAttempts
--   T2  trg_check_time_on_answer     BEFORE INSERT StudentAnswers
--   T3  trg_auto_grade_answer        BEFORE INSERT StudentAnswers
--   T4  trg_update_suspicion_score   AFTER  INSERT ProctorLogs
--   T5  trg_auto_flag_suspicious     AFTER  UPDATE ExamAttempts
--   T6  trg_log_exam_submission      AFTER  UPDATE ExamAttempts
--   T7  trg_detect_multiple_logins   AFTER  INSERT LoginSessions
-- ============================================================

USE ExamProctor;

DELIMITER //

-- ============================================================
-- TRIGGER T1 : trg_validate_exam_start
-- Fires  : BEFORE INSERT on ExamAttempts
-- Purpose: Gate-keep exam starts.
--   • Exam must be published
--   • Current time must be inside the exam window
--   • Student must not exceed max_attempts
--   • Auto-sets attempt_number
-- ============================================================
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
    FROM   Exams
    WHERE  exam_id = NEW.exam_id;

    -- 1. Must be published
    IF NOT v_is_published THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Exam is not published yet.';
    END IF;

    -- 2. Window not yet open
    IF NOW() < v_window_start THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Exam window has not opened yet.';
    END IF;

    -- 3. Window already closed
    IF NOW() > v_window_end THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Exam window has closed. No new attempts allowed.';
    END IF;

    -- 4. Attempt limit
    SELECT COUNT(*)
    INTO   v_attempt_count
    FROM   ExamAttempts
    WHERE  exam_id = NEW.exam_id AND student_id = NEW.student_id;

    IF v_attempt_count >= v_max_attempts THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Maximum allowed attempts reached for this exam.';
    END IF;

    -- 5. Set attempt_number automatically
    SET NEW.attempt_number = v_attempt_count + 1;
END //


-- ============================================================
-- TRIGGER T2 : trg_check_time_on_answer
-- Fires  : BEFORE INSERT on StudentAnswers
-- Purpose: Prevent answer submission after time expiry.
--   If time has elapsed, mark attempt as timed_out first,
--   then block the INSERT with an informative error.
-- ============================================================
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

    -- Block if already closed
    IF v_attempt_status <> 'in_progress' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Exam is no longer in progress.';
    END IF;

    -- Calculate elapsed time
    SET v_elapsed_mins = TIMESTAMPDIFF(MINUTE, v_started_at, NOW());

    IF v_elapsed_mins > v_duration_mins THEN
        -- Auto-submit the attempt
        UPDATE ExamAttempts
        SET    status        = 'timed_out',
               submitted_at  = NOW(),
               auto_submitted = TRUE
        WHERE  attempt_id   = NEW.attempt_id;

        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'ERROR: Time limit exceeded. Exam auto-submitted.';
    END IF;
END //


-- ============================================================
-- TRIGGER T3 : trg_auto_grade_answer
-- Fires  : BEFORE INSERT on StudentAnswers
-- Purpose: Instantly grade MCQ and TRUE_FALSE answers.
--   SHORT_ANSWER left for manual review (is_correct = NULL).
-- ============================================================
CREATE TRIGGER trg_auto_grade_answer
BEFORE INSERT ON StudentAnswers
FOR EACH ROW
BEGIN
    DECLARE v_correct  VARCHAR(500);
    DECLARE v_type     VARCHAR(20);
    DECLARE v_marks    DECIMAL(5,2);

    SELECT correct_answer, question_type, marks
    INTO   v_correct, v_type, v_marks
    FROM   Questions
    WHERE  question_id = NEW.question_id;

    IF v_type IN ('MCQ', 'TRUE_FALSE') THEN
        IF NEW.selected_option = v_correct THEN
            SET NEW.is_correct     = TRUE;
            SET NEW.marks_obtained = v_marks;
        ELSE
            SET NEW.is_correct     = FALSE;
            SET NEW.marks_obtained = 0.00;
        END IF;
    ELSE
        -- SHORT_ANSWER: defer to instructor
        SET NEW.is_correct     = NULL;
        SET NEW.marks_obtained = 0.00;
    END IF;
END //


-- ============================================================
-- TRIGGER T4 : trg_update_suspicion_score
-- Fires  : AFTER INSERT on ProctorLogs
-- Purpose:
--   • Increment suspicion_score based on event severity
--   • Update per-event type counters on ExamAttempts
--   Keeps the ExamAttempts row always current for fast dashboards.
--
-- SUSPICION SCORE FORMULA
-- ─────────────────────────────────────────────────────────────
--   Each ProctorLog event adds a severity-weighted increment:
--
--     Severity   │ Increment
--     ───────────┼──────────
--     INFO       │  +0  (exam start/submit — normal lifecycle)
--     LOW        │  +3  (right-click, fullscreen exit)
--     MEDIUM     │  +7  (tab switch, idle warning)
--     HIGH       │ +15  (copy-paste, suspicious typing)
--     CRITICAL   │ +25  (multiple logins, IP change mid-exam)
--
--   Score is capped at 100 via LEAST(100, score + increment).
--   Trigger T5 fires when score crosses 70 → auto-flag attempt.
-- ============================================================
CREATE TRIGGER trg_update_suspicion_score
AFTER INSERT ON ProctorLogs
FOR EACH ROW
BEGIN
    DECLARE v_increment INT DEFAULT 0;

    -- Severity → score weight
    CASE NEW.severity
        WHEN 'LOW'      THEN SET v_increment = 3;
        WHEN 'MEDIUM'   THEN SET v_increment = 7;
        WHEN 'HIGH'     THEN SET v_increment = 15;
        WHEN 'CRITICAL' THEN SET v_increment = 25;
        ELSE                 SET v_increment = 0;   -- INFO events = no score change
    END CASE;

    -- Update suspicion score (hard cap at 100)
    UPDATE ExamAttempts
    SET    suspicion_score = LEAST(100, suspicion_score + v_increment)
    WHERE  attempt_id = NEW.attempt_id;

    -- Update specific counters
    CASE NEW.event_type
        WHEN 'TAB_SWITCH' THEN
            UPDATE ExamAttempts
            SET tab_switches = tab_switches + 1
            WHERE attempt_id = NEW.attempt_id;

        WHEN 'FACE_NOT_DETECTED' THEN
            UPDATE ExamAttempts
            SET face_not_detected = face_not_detected + 1
            WHERE attempt_id = NEW.attempt_id;

        WHEN 'COPY_PASTE_DETECTED' THEN
            UPDATE ExamAttempts
            SET copy_paste_attempts = copy_paste_attempts + 1
            WHERE attempt_id = NEW.attempt_id;

        WHEN 'FULLSCREEN_EXIT' THEN
            UPDATE ExamAttempts
            SET fullscreen_exits = fullscreen_exits + 1
            WHERE attempt_id = NEW.attempt_id;

        ELSE BEGIN END;
    END CASE;
END //


-- ============================================================
-- TRIGGER T5 : trg_auto_flag_suspicious
-- Fires  : AFTER UPDATE on ExamAttempts
-- Purpose:
--   • Auto-raise a SuspicionFlag when score crosses 70
--   • Auto-raise a flag for excessive tab switches (> 5)
--   Prevents proctor from having to manually scan every attempt.
-- ============================================================
CREATE TRIGGER trg_auto_flag_suspicious
AFTER UPDATE ON ExamAttempts
FOR EACH ROW
BEGIN
    -- ── Flag: High suspicion score threshold ──────────────────
    IF NEW.suspicion_score >= 70 AND OLD.suspicion_score < 70 THEN

        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'HIGH_SUSPICION_SCORE',
            CONCAT(
                'Suspicion score reached ',  NEW.suspicion_score,
                ' (threshold: 70). Tab switches: ', NEW.tab_switches,
                ', Copy-paste: ', NEW.copy_paste_attempts,
                ', Face not detected: ', NEW.face_not_detected,
                '. Auto-flagged for proctor review.'
            )
        );

        -- If still in progress, change status to flagged
        IF NEW.status = 'in_progress' THEN
            UPDATE ExamAttempts
            SET    status = 'flagged'
            WHERE  attempt_id = NEW.attempt_id;
        END IF;
    END IF;

    -- ── Flag: Excessive tab switches ──────────────────────────
    IF NEW.tab_switches > 5 AND OLD.tab_switches <= 5 THEN
        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'EXCESSIVE_TAB_SWITCHES',
            CONCAT(
                'Student switched tabs ', NEW.tab_switches,
                ' times. Policy limit is 5. Auto-flagged.'
            )
        );
    END IF;

    -- ── Flag: Excessive copy-paste attempts ───────────────────
    IF NEW.copy_paste_attempts > 3 AND OLD.copy_paste_attempts <= 3 THEN
        INSERT INTO SuspicionFlags (attempt_id, flag_type, description)
        VALUES (
            NEW.attempt_id,
            'COPY_PASTE_ABUSE',
            CONCAT(
                'Copy-paste detected ', NEW.copy_paste_attempts,
                ' times during exam. Policy limit is 3. Auto-flagged.'
            )
        );
    END IF;
END //


-- ============================================================
-- TRIGGER T6 : trg_log_exam_submission
-- Fires  : AFTER UPDATE on ExamAttempts
-- Purpose: Write a ProctorLog entry whenever an exam transitions
--   from in_progress → submitted or timed_out.
--   Creates an immutable audit trail of all submissions.
-- ============================================================
CREATE TRIGGER trg_log_exam_submission
AFTER UPDATE ON ExamAttempts
FOR EACH ROW
BEGIN
    IF OLD.status = 'in_progress'
       AND NEW.status IN ('submitted', 'timed_out', 'flagged')
    THEN
        INSERT INTO ProctorLogs (
            attempt_id, event_type, severity, event_details
        ) VALUES (
            NEW.attempt_id,
            CASE
                WHEN NEW.auto_submitted    THEN 'AUTO_SUBMITTED'
                WHEN NEW.status = 'timed_out' THEN 'AUTO_SUBMITTED'
                ELSE 'EXAM_SUBMITTED'
            END,
            'INFO',
            CONCAT(
                'Status → ', NEW.status, '. ',
                'Duration: ', TIMESTAMPDIFF(MINUTE, NEW.started_at, NOW()), ' min. ',
                'Score: ',    COALESCE(NEW.score, 'Pending'), '. ',
                'Suspicion: ', NEW.suspicion_score, '/100.'
            )
        );
    END IF;
END //


-- ============================================================
-- TRIGGER T7 : trg_detect_multiple_logins
-- Fires  : AFTER INSERT on LoginSessions
-- Purpose: If the same user opens a second active session from
--   a DIFFERENT IP while an exam is in progress, log a
--   CRITICAL ProctorLog event → feeds T5 to auto-flag.
-- ============================================================
CREATE TRIGGER trg_detect_multiple_logins
AFTER INSERT ON LoginSessions
FOR EACH ROW
BEGIN
    DECLARE v_concurrent_sessions INT;
    DECLARE v_attempt_id          INT DEFAULT NULL;

    -- Count other active sessions from a different IP
    SELECT COUNT(*)
    INTO   v_concurrent_sessions
    FROM   LoginSessions
    WHERE  user_id    = NEW.user_id
      AND  is_active  = TRUE
      AND  session_id <> NEW.session_id
      AND  ip_address <> NEW.ip_address;

    IF v_concurrent_sessions > 0 THEN
        -- Find an in-progress exam attempt for this user
        SELECT attempt_id
        INTO   v_attempt_id
        FROM   ExamAttempts
        WHERE  student_id = NEW.user_id
          AND  status     = 'in_progress'
        ORDER  BY started_at DESC
        LIMIT  1;

        IF v_attempt_id IS NOT NULL THEN
            INSERT INTO ProctorLogs (
                attempt_id, event_type, severity, event_details, ip_address
            ) VALUES (
                v_attempt_id,
                'MULTIPLE_LOGIN_DETECTED',
                'CRITICAL',
                CONCAT(
                    'New session from IP ', NEW.ip_address,
                    ' while exam attempt #', v_attempt_id,
                    ' is active from a different IP.'
                ),
                NEW.ip_address
            );
        END IF;
    END IF;
END //

DELIMITER ;

-- ============================================================
-- Quick verification: list all triggers
-- ============================================================
-- SHOW TRIGGERS FROM ExamProctor;
