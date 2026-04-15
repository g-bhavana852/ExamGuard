-- ExamGuard — Transactions & Concurrency Control
-- TXN-1  Atomic exam submission with rollback on failure
-- TXN-2  Safe concurrent answer save (REPEATABLE READ)
-- TXN-3  Score recalculation with optimistic locking
-- TXN-4  Bulk flag resolution (all-or-nothing)
-- TXN-5  Exam publishing guard (SERIALIZABLE)
-- TXN-6  Concurrent double-submission guard
--
-- Run once to CREATE procedures, then demo with CALL txn_demo_N(...).

USE ExamProctor;
DELIMITER //

-- ── TXN-1 : Atomic Exam Submission ───────────────────────────
-- Locks attempt row → sums score → updates status.
-- Any failure rolls back; attempt stays in_progress.
DROP PROCEDURE IF EXISTS txn_demo_1 //
CREATE PROCEDURE txn_demo_1(IN p_attempt_id INT)
BEGIN
    DECLARE v_status     VARCHAR(20);
    DECLARE v_calc_score DECIMAL(6,2);
    DECLARE v_total      DECIMAL(6,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SELECT 'ROLLBACK: Unexpected error during submission.' AS result;
    END;

    START TRANSACTION;

        SELECT ea.status, e.total_marks
        INTO   v_status, v_total
        FROM   ExamAttempts ea JOIN Exams e ON ea.exam_id = e.exam_id
        WHERE  ea.attempt_id = p_attempt_id AND ea.status = 'in_progress'
        FOR UPDATE;

        IF v_status IS NULL THEN
            ROLLBACK;
            SELECT 'ROLLBACK: Attempt already submitted or not found.' AS result;
        ELSE
            SELECT COALESCE(SUM(marks_obtained), 0) INTO v_calc_score
            FROM   StudentAnswers WHERE attempt_id = p_attempt_id;

            UPDATE ExamAttempts
            SET    score = v_calc_score,
                   percentage = ROUND((v_calc_score / v_total) * 100, 2),
                   status = 'submitted', submitted_at = NOW()
            WHERE  attempt_id = p_attempt_id;

            COMMIT;
            SELECT CONCAT('COMMIT: Score = ', v_calc_score,
                          ' | Percentage = ', ROUND((v_calc_score / v_total) * 100, 2), '%') AS result;
        END IF;
END //


-- ── TXN-2 : Concurrency-Safe Answer Save ─────────────────────
-- Two browser tabs race to save the same question.
-- REPEATABLE READ + INSERT … ON DUPLICATE KEY UPDATE → one version wins atomically.
DROP PROCEDURE IF EXISTS txn_demo_2 //
CREATE PROCEDURE txn_demo_2(
    IN p_attempt_id INT, IN p_question_id INT,
    IN p_selected   VARCHAR(500), IN p_time_taken INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Concurrent write conflict.' AS result; END;

    SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
    START TRANSACTION;
        INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, time_taken_seconds)
        VALUES (p_attempt_id, p_question_id, p_selected, p_time_taken) AS new_ans
        ON DUPLICATE KEY UPDATE
            selected_option    = new_ans.selected_option,
            time_taken_seconds = new_ans.time_taken_seconds,
            answered_at        = NOW();
    COMMIT;
    SELECT 'COMMIT: Answer saved (upsert).' AS result;
END //


-- ── TXN-3 : Optimistic Locking for Score Recalculation ───────
-- Instructor adjusts a mark. Writes only if updated_at unchanged
-- since last read — detects concurrent modification.
DROP PROCEDURE IF EXISTS txn_demo_3 //
CREATE PROCEDURE txn_demo_3(IN p_exam_id INT, IN p_new_total DECIMAL(6,2))
BEGIN
    DECLARE v_old_ts DATETIME;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during optimistic update.' AS result; END;

    SELECT updated_at INTO v_old_ts FROM Exams WHERE exam_id = p_exam_id;

    START TRANSACTION;
        UPDATE Exams
        SET    total_marks = p_new_total, updated_at = NOW()
        WHERE  exam_id = p_exam_id AND updated_at = v_old_ts;

        IF ROW_COUNT() = 0 THEN
            ROLLBACK;
            SELECT 'ROLLBACK: Concurrent modification detected. Please retry.' AS result;
        ELSE
            COMMIT;
            SELECT 'COMMIT: Exam updated successfully.' AS result;
        END IF;
END //


-- ── TXN-4 : Bulk Flag Resolution (All-or-Nothing) ────────────
-- Proctor clears all open flags for an exam at once.
-- All resolve or none do.
DROP PROCEDURE IF EXISTS txn_demo_4 //
CREATE PROCEDURE txn_demo_4(IN p_exam_id INT, IN p_proctor_id INT, IN p_notes TEXT)
BEGIN
    DECLARE v_count INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during bulk flag resolution.' AS result; END;

    START TRANSACTION;
        UPDATE SuspicionFlags sf
        JOIN   ExamAttempts   ea ON sf.attempt_id = ea.attempt_id
        SET    sf.is_resolved = TRUE, sf.resolved_by = p_proctor_id,
               sf.resolved_at = NOW(), sf.resolution_notes = p_notes
        WHERE  ea.exam_id = p_exam_id AND sf.is_resolved = FALSE;

        SET v_count = ROW_COUNT();

        IF v_count = 0 THEN
            ROLLBACK;
            SELECT 'ROLLBACK: No open flags found for this exam.' AS result;
        ELSE
            COMMIT;
            SELECT CONCAT('COMMIT: ', v_count, ' flags resolved.') AS result;
        END IF;
END //


-- ── TXN-5 : Exam Publishing Guard (SERIALIZABLE) ─────────────
-- Two instructors click "Publish" simultaneously.
-- SERIALIZABLE prevents phantom reads → exam published exactly once.
DROP PROCEDURE IF EXISTS txn_demo_5 //
CREATE PROCEDURE txn_demo_5(IN p_exam_id INT)
BEGIN
    DECLARE v_is_published BOOLEAN;
    DECLARE v_q_count      INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Error during publish.' AS result; END;

    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    START TRANSACTION;

        SELECT is_published INTO v_is_published FROM Exams WHERE exam_id = p_exam_id FOR UPDATE;

        IF v_is_published = TRUE THEN
            ROLLBACK; SELECT 'ROLLBACK: Exam is already published.' AS result;
        ELSE
            SELECT COUNT(*) INTO v_q_count FROM Questions WHERE exam_id = p_exam_id;

            IF v_q_count = 0 THEN
                ROLLBACK; SELECT 'ROLLBACK: Cannot publish exam with no questions.' AS result;
            ELSE
                UPDATE Exams SET is_published = TRUE, updated_at = NOW() WHERE exam_id = p_exam_id;
                COMMIT;
                SELECT CONCAT('COMMIT: Exam #', p_exam_id, ' published with ', v_q_count, ' questions.') AS result;
            END IF;
        END IF;
END //


-- ── TXN-6 : Concurrent Double-Submission Guard (SERIALIZABLE) ─
-- Session B tries to submit after Session A already committed.
-- FOR UPDATE lock → detects status ≠ 'in_progress' → ROLLBACK.
DROP PROCEDURE IF EXISTS txn_demo_6_session_b //
CREATE PROCEDURE txn_demo_6_session_b(IN p_attempt_id INT)
BEGIN
    DECLARE v_status VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN ROLLBACK; SELECT 'ROLLBACK: Lock wait or error.' AS result; END;

    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    START TRANSACTION;

        SELECT status INTO v_status FROM ExamAttempts WHERE attempt_id = p_attempt_id FOR UPDATE;

        IF v_status <> 'in_progress' THEN
            ROLLBACK;
            SELECT CONCAT('Session B: ROLLBACK — attempt already ', v_status, '.') AS result;
        ELSE
            UPDATE ExamAttempts SET status = 'submitted', submitted_at = NOW()
            WHERE  attempt_id = p_attempt_id AND status = 'in_progress';
            COMMIT;
            SELECT 'Session B: COMMIT (Session A had not yet submitted).' AS result;
        END IF;
END //


-- ── Deadlock Prevention Note ──────────────────────────────────
-- All transactions touching ExamAttempts + StudentAnswers acquire
-- locks in the same order: ExamAttempts first, StudentAnswers second.
-- Consistent ordering prevents circular waits.

DELIMITER ;

-- Demo calls:
-- CALL txn_demo_1(3);
-- CALL txn_demo_2(3, 5, 'B', 42);
-- CALL txn_demo_3(1, 55.00);
-- CALL txn_demo_4(1, 1, 'Open-book exam, flags cleared.');
-- CALL txn_demo_5(4);
-- CALL txn_demo_6_session_b(3);
