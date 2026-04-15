-- ExamGuard — Performance Indexes  (run AFTER 01_schema.sql)
USE ExamProctor;

-- Users
CREATE INDEX idx_users_role        ON Users(role);
CREATE INDEX idx_users_active      ON Users(is_active, role);

-- Courses
CREATE INDEX idx_courses_instructor ON Courses(instructor_id);
CREATE INDEX idx_courses_active     ON Courses(is_active);

-- Enrollments
CREATE INDEX idx_enrollments_student ON Enrollments(student_id, status);
CREATE INDEX idx_enrollments_course  ON Enrollments(course_id,  status);

-- Exams
CREATE INDEX idx_exams_course    ON Exams(course_id);
CREATE INDEX idx_exams_window    ON Exams(window_start, window_end);
CREATE INDEX idx_exams_published ON Exams(is_published, window_end);

-- Questions
CREATE INDEX idx_questions_exam       ON Questions(exam_id, order_index);
CREATE INDEX idx_questions_difficulty ON Questions(exam_id, difficulty_level);

-- ExamAttempts  (most performance-critical)
CREATE INDEX idx_attempts_exam_student ON ExamAttempts(exam_id, student_id);
CREATE INDEX idx_attempts_student      ON ExamAttempts(student_id, status);
CREATE INDEX idx_attempts_status       ON ExamAttempts(exam_id, status);
CREATE INDEX idx_attempts_suspicion    ON ExamAttempts(suspicion_score DESC, exam_id);
CREATE INDEX idx_attempts_inprogress   ON ExamAttempts(status, started_at);

-- StudentAnswers
CREATE INDEX idx_answers_attempt  ON StudentAnswers(attempt_id);
CREATE INDEX idx_answers_question ON StudentAnswers(question_id, is_correct);

-- ProctorLogs
CREATE INDEX idx_proctor_attempt  ON ProctorLogs(attempt_id, logged_at);
CREATE INDEX idx_proctor_event    ON ProctorLogs(event_type, logged_at);
CREATE INDEX idx_proctor_severity ON ProctorLogs(severity, is_reviewed, logged_at);

-- SuspicionFlags
CREATE INDEX idx_flags_attempt    ON SuspicionFlags(attempt_id);
CREATE INDEX idx_flags_unresolved ON SuspicionFlags(is_resolved, detected_at);
CREATE INDEX idx_flags_resolver   ON SuspicionFlags(resolved_by);

-- LoginSessions
CREATE INDEX idx_sessions_user_active ON LoginSessions(user_id, is_active);
CREATE INDEX idx_sessions_ip          ON LoginSessions(ip_address, is_active);
