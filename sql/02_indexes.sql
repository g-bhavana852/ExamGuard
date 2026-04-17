-- ============================================================
--   PERFORMANCE INDEXES
--   Covers all high-frequency query patterns:
--     • Student looking up their attempts
--     • Proctor filtering flagged / high-suspicion attempts
--     • Instructor viewing exam stats
--     • System checking active exam windows
-- ============================================================

USE ExamProctor;

-- ──────────────────────────────────────────────
-- Users
-- ──────────────────────────────────────────────
-- Filter by role (fetch all students, all proctors)
CREATE INDEX idx_users_role       ON Users(role);
-- Fast lookup of active users
CREATE INDEX idx_users_active     ON Users(is_active, role);

-- ──────────────────────────────────────────────
-- Courses
-- ──────────────────────────────────────────────
-- All courses taught by an instructor
CREATE INDEX idx_courses_instructor ON Courses(instructor_id);
CREATE INDEX idx_courses_active     ON Courses(is_active);

-- ──────────────────────────────────────────────
-- Enrollments
-- ──────────────────────────────────────────────
-- All courses a student is enrolled in
CREATE INDEX idx_enrollments_student ON Enrollments(student_id, status);
-- All students in a specific course
CREATE INDEX idx_enrollments_course  ON Enrollments(course_id,  status);

-- ──────────────────────────────────────────────
-- Exams
-- ──────────────────────────────────────────────
-- Exams belonging to a course
CREATE INDEX idx_exams_course    ON Exams(course_id);
-- Find exams currently in their window (used heavily by start-exam flow)
CREATE INDEX idx_exams_window    ON Exams(window_start, window_end);
-- Filter published exams only
CREATE INDEX idx_exams_published ON Exams(is_published, window_end);

-- ──────────────────────────────────────────────
-- Questions
-- ──────────────────────────────────────────────
-- Retrieve all questions for an exam, in order
CREATE INDEX idx_questions_exam       ON Questions(exam_id, order_index);
-- Difficulty breakdown per exam (question stats queries)
CREATE INDEX idx_questions_difficulty ON Questions(exam_id, difficulty_level);

-- ──────────────────────────────────────────────
-- ExamAttempts  ← most performance-critical table
-- ──────────────────────────────────────────────
-- Find a specific student's attempts for an exam
CREATE INDEX idx_attempts_exam_student ON ExamAttempts(exam_id, student_id);
-- All attempts by a student (student dashboard)
CREATE INDEX idx_attempts_student      ON ExamAttempts(student_id, status);
-- Proctor dashboard: filter by status
CREATE INDEX idx_attempts_status       ON ExamAttempts(exam_id, status);
-- Sort by suspicion score descending (highest risk first)
CREATE INDEX idx_attempts_suspicion    ON ExamAttempts(suspicion_score DESC, exam_id);
-- In-progress attempts (for timeout checks)
CREATE INDEX idx_attempts_inprogress   ON ExamAttempts(status, started_at);
-- NOTE: MySQL does not support partial/filtered indexes (WHERE clause) — that is PostgreSQL syntax.

-- ──────────────────────────────────────────────
-- StudentAnswers
-- ──────────────────────────────────────────────
-- Get all answers for an attempt (score calculation)
CREATE INDEX idx_answers_attempt  ON StudentAnswers(attempt_id);
-- Aggregate correct-rate per question (question analysis)
CREATE INDEX idx_answers_question ON StudentAnswers(question_id, is_correct);

-- ──────────────────────────────────────────────
-- ProctorLogs
-- ──────────────────────────────────────────────
-- Timeline for a specific attempt
CREATE INDEX idx_proctor_attempt  ON ProctorLogs(attempt_id, logged_at);
-- Filter by event type across all attempts (system-wide reports)
CREATE INDEX idx_proctor_event    ON ProctorLogs(event_type, logged_at);
-- Unreviewed high-severity events (proctor queue)
CREATE INDEX idx_proctor_severity ON ProctorLogs(severity, is_reviewed, logged_at);

-- ──────────────────────────────────────────────
-- SuspicionFlags
-- ──────────────────────────────────────────────
-- All flags for an attempt
CREATE INDEX idx_flags_attempt  ON SuspicionFlags(attempt_id);
-- Unresolved flags queue
CREATE INDEX idx_flags_unresolved ON SuspicionFlags(is_resolved, detected_at);
-- Flags assigned to a resolver
CREATE INDEX idx_flags_resolver   ON SuspicionFlags(resolved_by);

-- ──────────────────────────────────────────────
-- LoginSessions
-- ──────────────────────────────────────────────
-- Active sessions per user (multi-login detection)
CREATE INDEX idx_sessions_user_active ON LoginSessions(user_id, is_active);
-- IP-based lookups (detect same IP, different users)
CREATE INDEX idx_sessions_ip          ON LoginSessions(ip_address, is_active);
