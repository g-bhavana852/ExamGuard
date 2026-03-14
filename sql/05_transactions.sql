-- ============================================================
--   TRANSACTIONS & CONCURRENCY CONTROL
-- ============================================================
--   Demonstrates:
--     TXN-1  Atomic exam submission with rollback on failure
--     TXN-2  Safe concurrent answer save (REPEATABLE READ)
--     TXN-3  Score recalculation with optimistic locking
--     TXN-4  Bulk flag resolution (all-or-nothing)
--     TXN-5  Exam publishing guard (SERIALIZABLE)
-- ============================================================

USE ExamProctor;

-- ============================================================
-- TXN-1 : Atomic Exam Submission
-- ─────────────────────────────────────────────────────────────
-- Problem: Student submits exam. We must:
--   (a) Lock the attempt row so no concurrent double-submit
--   (b) Calculate score
--   (c) Update ExamAttempts
--   (d) If anything fails → ROLLBACK, attempt stays in_progress
-- All three writes succeed together or not at all.
-- ============================================================
START TRANSACTION;

    -- Step 1: Lock the attempt row (prevents concurrent submission)
    SELECT attempt_id, status, exam_id
    FROM   ExamAttempts
    WHERE  attempt_id = 1001          -- substitute with actual attempt_id
      AND  status = 'in_progress'
    FOR UPDATE;

    -- Step 2: Calculate score (sum of auto-graded answers)
    SET @calculated_score = (
        SELECT COALESCE(SUM(marks_obtained), 0)
        FROM   StudentAnswers
        WHERE  attempt_id = 1001
    );

    SET @total_marks = (
        SELECT e.total_marks
        FROM   Exams e
        JOIN   ExamAttempts ea ON e.exam_id = ea.exam_id
        WHERE  ea.attempt_id = 1001
    );

    -- Step 3: Update attempt record
    UPDATE ExamAttempts
    SET    score        = @calculated_score,
           percentage   = ROUND((@calculated_score / @total_marks) * 100, 2),
           status       = 'submitted',
           submitted_at = NOW()
    WHERE  attempt_id   = 1001
      AND  status       = 'in_progress';

    -- Step 4: Verify exactly one row was updated
    --   ROW_COUNT() = 0 means another session already submitted
    IF ROW_COUNT() = 0 THEN
        ROLLBACK;
        SELECT 'ROLLBACK: Attempt already submitted by concurrent session.' AS result;
    ELSE
        COMMIT;
        SELECT CONCAT('COMMIT: Score = ', @calculated_score,
                      ' | Percentage = ',
                      ROUND((@calculated_score / @total_marks) * 100, 2), '%') AS result;
    END IF;


-- ============================================================
-- TXN-2 : Concurrency-Safe Answer Save
-- ─────────────────────────────────────────────────────────────
-- Problem: Student navigates back and changes an answer.
-- Two browser tabs could race to save the same question.
-- Solution: REPEATABLE READ + INSERT … ON DUPLICATE KEY UPDATE
--           ensures only one version wins.
-- ============================================================
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;

    -- Upsert: insert if first answer, update if changing mind
    -- Note: VALUES() is deprecated in MySQL 8.0.20+; use row alias instead
    INSERT INTO StudentAnswers
        (attempt_id, question_id, selected_option, time_taken_seconds)
    VALUES
        (1001, 42, 'B', 45) AS new_ans
    ON DUPLICATE KEY UPDATE
        selected_option    = new_ans.selected_option,
        time_taken_seconds = new_ans.time_taken_seconds,
        answered_at        = NOW();

COMMIT;


-- ============================================================
-- TXN-3 : Optimistic Locking for Score Recalculation
-- ─────────────────────────────────────────────────────────────
-- Problem: Instructor manually adjusts a SHORT_ANSWER mark.
-- We want to avoid overwriting a concurrent update.
-- Pattern: read updated_at, write only if it hasn't changed.
-- ============================================================
START TRANSACTION;

    -- Read current state with a version timestamp
    SET @old_updated = (
        SELECT updated_at FROM Exams WHERE exam_id = 5
    );

    -- ... instructor makes grading decision ...

    -- Update only if nobody else changed the exam since we read it
    UPDATE Exams
    SET    total_marks = 100,
           updated_at  = NOW()
    WHERE  exam_id    = 5
      AND  updated_at = @old_updated;   -- optimistic check

    IF ROW_COUNT() = 0 THEN
        ROLLBACK;
        SELECT 'ROLLBACK: Concurrent modification detected. Please retry.' AS result;
    ELSE
        COMMIT;
        SELECT 'COMMIT: Exam updated successfully.' AS result;
    END IF;


-- ============================================================
-- TXN-4 : Bulk Flag Resolution (All-or-Nothing)
-- ─────────────────────────────────────────────────────────────
-- Problem: Proctor resolves all open flags for an exam at once
-- (e.g. "all flags were false positives — exam was open-book").
-- Either all resolve successfully or none do.
-- ============================================================
START TRANSACTION;

    UPDATE SuspicionFlags sf
    JOIN   ExamAttempts   ea ON sf.attempt_id = ea.attempt_id
    SET    sf.is_resolved      = TRUE,
           sf.resolved_by      = 7,          -- proctor's user_id
           sf.resolved_at      = NOW(),
           sf.resolution_notes = 'Exam was open-book. All flags cleared by admin.'
    WHERE  ea.exam_id          = 3
      AND  sf.is_resolved      = FALSE;

    SET @flags_resolved = ROW_COUNT();

    IF @flags_resolved = 0 THEN
        ROLLBACK;
        SELECT 'ROLLBACK: No open flags found for this exam.' AS result;
    ELSE
        COMMIT;
        SELECT CONCAT('COMMIT: ', @flags_resolved, ' flags resolved.') AS result;
    END IF;


-- ============================================================
-- TXN-5 : Exam Publishing Guard (SERIALIZABLE)
-- ─────────────────────────────────────────────────────────────
-- Problem: Two instructors click "Publish" simultaneously.
-- SERIALIZABLE isolation prevents phantom reads — ensures
-- the exam can only be published once.
-- ============================================================
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;

    SET @is_published = (
        SELECT is_published FROM Exams WHERE exam_id = 5
    );

    IF @is_published = TRUE THEN
        ROLLBACK;
        SELECT 'ROLLBACK: Exam is already published.' AS result;
    ELSE
        -- Validate questions exist before publishing
        SET @q_count = (SELECT COUNT(*) FROM Questions WHERE exam_id = 5);

        IF @q_count = 0 THEN
            ROLLBACK;
            SELECT 'ROLLBACK: Cannot publish exam with no questions.' AS result;
        ELSE
            UPDATE Exams
            SET    is_published = TRUE,
                   updated_at   = NOW()
            WHERE  exam_id      = 5;

            COMMIT;
            SELECT CONCAT('COMMIT: Exam published with ', @q_count, ' questions.') AS result;
        END IF;
    END IF;


-- ============================================================
-- TXN-6 : Concurrent Double-Submission (SERIALIZABLE guard)
-- ─────────────────────────────────────────────────────────────
-- Scenario: Two browser tabs (network glitch / double-click)
--   race to submit the same attempt simultaneously.
-- Expected: First session commits; second detects status ≠
--   'in_progress' and rolls back, returning an informative error.
-- This is the concurrency scenario that SERIALIZABLE prevents.
-- ============================================================

-- ── Session A (first to acquire the lock) ─────────────────────
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;

    SELECT attempt_id, status
    FROM   ExamAttempts
    WHERE  attempt_id = 1001
    FOR UPDATE;                  -- acquires exclusive row lock

    -- At this point Session B's SELECT … FOR UPDATE will BLOCK
    -- until Session A either commits or rolls back.

    UPDATE ExamAttempts
    SET    status       = 'submitted',
           submitted_at = NOW(),
           score        = 38.00,
           percentage   = 76.00
    WHERE  attempt_id   = 1001
      AND  status       = 'in_progress';

COMMIT;                          -- lock released here
SELECT 'Session A: COMMIT — submission accepted.' AS result;

-- ── Session B (arrives after Session A commits) ───────────────
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;

    SELECT attempt_id, status
    FROM   ExamAttempts
    WHERE  attempt_id = 1001
    FOR UPDATE;                  -- lock available now; reads updated row

    -- SERIALIZABLE ensures Session B reads status = 'submitted'
    -- (not the stale 'in_progress' it might have seen earlier)
    SET @current_status = (SELECT status FROM ExamAttempts WHERE attempt_id = 1001);

    IF @current_status <> 'in_progress' THEN
        ROLLBACK;
        SELECT CONCAT('Session B: ROLLBACK — attempt already ', @current_status, '.') AS result;
    ELSE
        -- Would only reach here if status were still in_progress
        UPDATE ExamAttempts SET status = 'submitted' WHERE attempt_id = 1001;
        COMMIT;
        SELECT 'Session B: COMMIT (unexpected — lock ordering prevented this).' AS result;
    END IF;


-- ============================================================
-- CONCURRENCY NOTE — Deadlock Prevention
-- ─────────────────────────────────────────────────────────────
-- All transactions that touch both ExamAttempts AND StudentAnswers
-- always acquire locks in the SAME ORDER:
--   1. ExamAttempts  (parent)
--   2. StudentAnswers (child)
-- This consistent lock ordering prevents circular waits (deadlocks).
--
-- InnoDB's innodb_lock_wait_timeout (default 50 s) handles the
-- rare case where a lock wait exceeds the threshold.
-- ============================================================
