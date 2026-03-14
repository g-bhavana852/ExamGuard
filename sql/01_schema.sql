-- ============================================================
--   ONLINE EXAM PROCTORING SYSTEM
--   Schema Design  |  Version 1.0
-- ============================================================
--   Normalization  : 3NF / BCNF
--   Engine         : InnoDB  (full FK + Transaction support)
--   Charset        : utf8mb4 (full Unicode)
--
--   Entity Hierarchy:
--     Users  ──►  Courses  ──►  Exams  ──►  Questions
--                     │                         │
--                 Enrollments          ExamAttempts (WEAK)
--                                          │
--                               ┌──────────┼──────────┐
--                          StudentAnswers  │     SuspicionFlags
--                                     ProctorLogs (WEAK)
--                     LoginSessions (for multi-login detection)
-- ============================================================

DROP DATABASE IF EXISTS ExamProctor;
CREATE DATABASE ExamProctor
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE ExamProctor;

-- ============================================================
-- TABLE 1 : Users
-- ─────────────────────────────────────────────────────────────
-- Stores ALL system users under one table (Role-based design).
-- 3NF: every non-key column depends solely on user_id.
-- Separating roles into sub-tables would cause unnecessary joins
-- for common operations; ENUM + role column is the standard
-- pattern for systems with 4 or fewer roles.
-- ============================================================
CREATE TABLE Users (
    user_id       INT            NOT NULL AUTO_INCREMENT,
    email         VARCHAR(100)   NOT NULL,
    password_hash VARCHAR(255)   NOT NULL,         -- bcrypt / argon2 hash
    full_name     VARCHAR(100)   NOT NULL,
    role          ENUM(
                    'student',
                    'instructor',
                    'proctor',
                    'admin'
                  )              NOT NULL DEFAULT 'student',
    phone_number  VARCHAR(20),
    created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,
    is_active     BOOLEAN        NOT NULL DEFAULT TRUE,
    last_login    DATETIME,

    username      VARCHAR(50)    NULL,                       -- chosen at signup, unique

    PRIMARY KEY (user_id),
    UNIQUE  KEY uq_users_email    (email),
    UNIQUE  KEY uq_users_username (username),

    CONSTRAINT chk_users_email
        CHECK (email REGEXP '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'),
    CONSTRAINT chk_users_phone
        CHECK (phone_number IS NULL OR LENGTH(phone_number) >= 10)
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 2 : Courses
-- ─────────────────────────────────────────────────────────────
-- An exam always belongs to a course (real institutional model).
-- Avoids repeating instructor info in every Exam row → 3NF.
-- ============================================================
CREATE TABLE Courses (
    course_id     INT          NOT NULL AUTO_INCREMENT,
    course_code   VARCHAR(20)  NOT NULL,   -- e.g. CS101, MATH301
    course_name   VARCHAR(150) NOT NULL,
    description   TEXT,
    instructor_id INT          NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,

    PRIMARY KEY (course_id),
    UNIQUE  KEY uq_courses_code (course_code),

    CONSTRAINT fk_courses_instructor
        FOREIGN KEY (instructor_id) REFERENCES Users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 3 : Enrollments
-- ─────────────────────────────────────────────────────────────
-- Resolves the Many-to-Many between Students and Courses.
-- Enforces a student can only enroll in a course once (UNIQUE).
-- ============================================================
CREATE TABLE Enrollments (
    enrollment_id INT      NOT NULL AUTO_INCREMENT,
    student_id    INT      NOT NULL,
    course_id     INT      NOT NULL,
    enrolled_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('active', 'completed', 'dropped')
                           NOT NULL DEFAULT 'active',

    PRIMARY KEY (enrollment_id),
    UNIQUE  KEY uq_enrollment (student_id, course_id),   -- prevents duplicate enrollment

    CONSTRAINT fk_enrollment_student
        FOREIGN KEY (student_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_enrollment_course
        FOREIGN KEY (course_id) REFERENCES Courses(course_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 4 : Exams
-- ─────────────────────────────────────────────────────────────
-- Each exam has a time window [window_start, window_end].
-- Students can only start within this window.
-- duration_minutes defines per-student time once started.
-- ============================================================
CREATE TABLE Exams (
    exam_id                  INT           NOT NULL AUTO_INCREMENT,
    course_id                INT           NOT NULL,
    title                    VARCHAR(200)  NOT NULL,
    description              TEXT,
    total_marks              DECIMAL(6,2)  NOT NULL,
    passing_marks            DECIMAL(6,2)  NOT NULL,
    duration_minutes         INT           NOT NULL,  -- per-student timer
    window_start             DATETIME      NOT NULL,  -- earliest anyone can begin
    window_end               DATETIME      NOT NULL,  -- latest anyone can begin
    created_by               INT           NOT NULL,
    created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                     ON UPDATE CURRENT_TIMESTAMP,
    is_published             BOOLEAN       NOT NULL DEFAULT FALSE,
    max_attempts             INT           NOT NULL DEFAULT 1,
    shuffle_questions        BOOLEAN       NOT NULL DEFAULT TRUE,
    show_results_immediately BOOLEAN       NOT NULL DEFAULT FALSE,

    PRIMARY KEY (exam_id),

    CONSTRAINT fk_exams_course
        FOREIGN KEY (course_id)  REFERENCES Courses(course_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_exams_creator
        FOREIGN KEY (created_by) REFERENCES Users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_exams_marks
        CHECK (passing_marks <= total_marks AND total_marks > 0),
    CONSTRAINT chk_exams_duration
        CHECK (duration_minutes > 0),
    CONSTRAINT chk_exams_window
        CHECK (window_end > window_start),
    CONSTRAINT chk_exams_attempts
        CHECK (max_attempts >= 1)
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 5 : Questions
-- ─────────────────────────────────────────────────────────────
-- One exam → many questions.
-- option_a/b/c/d NULL for TRUE_FALSE or SHORT_ANSWER.
-- Storing each option as a column (not a separate QuestionOptions
-- table) is acceptable here because MCQ is always exactly 4
-- options — no repeating-group violation.
-- ============================================================
CREATE TABLE Questions (
    question_id      INT           NOT NULL AUTO_INCREMENT,
    exam_id          INT           NOT NULL,
    question_text    TEXT          NOT NULL,
    question_type    ENUM('MCQ', 'TRUE_FALSE', 'SHORT_ANSWER')
                                   NOT NULL DEFAULT 'MCQ',
    marks            DECIMAL(5,2)  NOT NULL,
    option_a         VARCHAR(500),
    option_b         VARCHAR(500),
    option_c         VARCHAR(500),
    option_d         VARCHAR(500),
    correct_answer   VARCHAR(500)  NOT NULL,   -- 'A'/'B'/'C'/'D' or 'TRUE'/'FALSE'
    difficulty_level ENUM('easy', 'medium', 'hard')
                                   NOT NULL DEFAULT 'medium',
    order_index      INT           NOT NULL DEFAULT 0,

    PRIMARY KEY (question_id),

    CONSTRAINT fk_questions_exam
        FOREIGN KEY (exam_id) REFERENCES Exams(exam_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_questions_marks
        CHECK (marks > 0)
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 6 : ExamAttempts   ← WEAK ENTITY
-- ─────────────────────────────────────────────────────────────
-- WHY WEAK: An ExamAttempt has no independent existence without
-- a specific (Exam, Student) pair. Its logical identity is
-- (exam_id, student_id, attempt_number).
--
-- Denormalization notes (justified):
--   • tab_switches, face_not_detected, etc. are counters
--     maintained by triggers to avoid expensive COUNT() JOINs
--     on the proctor dashboard.
--   • percentage is derived but cached for fast leaderboards.
-- ============================================================
CREATE TABLE ExamAttempts (
    attempt_id           INT           NOT NULL AUTO_INCREMENT,
    exam_id              INT           NOT NULL,
    student_id           INT           NOT NULL,
    attempt_number       INT           NOT NULL DEFAULT 1,
    started_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at         DATETIME,
    auto_submitted       BOOLEAN       NOT NULL DEFAULT FALSE,
    score                DECIMAL(6,2),
    percentage           DECIMAL(5,2),
    status               ENUM(
                           'in_progress',
                           'submitted',
                           'graded',
                           'flagged',
                           'timed_out',
                           'abandoned'
                         )             NOT NULL DEFAULT 'in_progress',
    -- Proctoring counters (updated by triggers)
    suspicion_score      INT           NOT NULL DEFAULT 0,
    tab_switches         INT           NOT NULL DEFAULT 0,
    face_not_detected    INT           NOT NULL DEFAULT 0,
    copy_paste_attempts  INT           NOT NULL DEFAULT 0,
    fullscreen_exits     INT           NOT NULL DEFAULT 0,
    -- Network / Device fingerprint
    ip_address           VARCHAR(45)   NOT NULL,
    browser_info         VARCHAR(255),

    PRIMARY KEY (attempt_id),
    UNIQUE  KEY uq_attempt (exam_id, student_id, attempt_number),

    CONSTRAINT fk_attempts_exam
        FOREIGN KEY (exam_id)    REFERENCES Exams(exam_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_attempts_student
        FOREIGN KEY (student_id) REFERENCES Users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_attempts_suspicion
        CHECK (suspicion_score BETWEEN 0 AND 100),
    CONSTRAINT chk_attempts_counters
        CHECK (tab_switches >= 0 AND face_not_detected >= 0
               AND copy_paste_attempts >= 0 AND fullscreen_exits >= 0)
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 7 : StudentAnswers
-- ─────────────────────────────────────────────────────────────
-- One row per (attempt, question) — enforced by UNIQUE KEY.
-- is_correct and marks_obtained are set by trigger (auto-grade).
-- time_taken_seconds helps detect rapid answering (cheating signal).
-- ============================================================
CREATE TABLE StudentAnswers (
    answer_id          INT           NOT NULL AUTO_INCREMENT,
    attempt_id         INT           NOT NULL,
    question_id        INT           NOT NULL,
    selected_option    VARCHAR(500),            -- NULL = unanswered
    is_correct         BOOLEAN,                 -- NULL for SHORT_ANSWER
    marks_obtained     DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    time_taken_seconds INT,                     -- seconds spent on this Q
    answered_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (answer_id),
    UNIQUE  KEY uq_answer (attempt_id, question_id),

    CONSTRAINT fk_answers_attempt
        FOREIGN KEY (attempt_id)  REFERENCES ExamAttempts(attempt_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_answers_question
        FOREIGN KEY (question_id) REFERENCES Questions(question_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_answers_marks
        CHECK (marks_obtained >= 0)
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 8 : ProctorLogs   ← WEAK ENTITY
-- ─────────────────────────────────────────────────────────────
-- WHY WEAK: A ProctorLog event is meaningless without its
-- parent ExamAttempt. It is identified by (attempt_id, log_id).
--
-- Comprehensive event vocabulary covers DBMS-level proctoring
-- without requiring AI/video infrastructure.
-- ============================================================
CREATE TABLE ProctorLogs (
    log_id        INT      NOT NULL AUTO_INCREMENT,
    attempt_id    INT      NOT NULL,
    event_type    ENUM(
                    'EXAM_STARTED',
                    'EXAM_SUBMITTED',
                    'AUTO_SUBMITTED',
                    'TAB_SWITCH',
                    'FULLSCREEN_EXIT',
                    'COPY_PASTE_DETECTED',
                    'FACE_NOT_DETECTED',
                    'MULTIPLE_FACES_DETECTED',
                    'IDLE_WARNING',
                    'SUSPICIOUS_TYPING',
                    'MULTIPLE_LOGIN_DETECTED',
                    'BROWSER_BACK_PRESSED',
                    'RIGHT_CLICK_ATTEMPT',
                    'DEVTOOLS_OPENED',
                    'IP_ADDRESS_CHANGED',
                    'RAPID_ANSWERING'
                  )        NOT NULL,
    severity      ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
                           NOT NULL DEFAULT 'INFO',
    event_details TEXT,                          -- free-form JSON or text
    logged_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address    VARCHAR(45),
    is_reviewed   BOOLEAN  NOT NULL DEFAULT FALSE,

    PRIMARY KEY (log_id),

    CONSTRAINT fk_proctorlog_attempt
        FOREIGN KEY (attempt_id) REFERENCES ExamAttempts(attempt_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 9 : SuspicionFlags
-- ─────────────────────────────────────────────────────────────
-- Raised automatically by triggers or manually by proctors.
-- Resolution workflow: proctor reviews → resolves with notes.
-- ============================================================
CREATE TABLE SuspicionFlags (
    flag_id          INT      NOT NULL AUTO_INCREMENT,
    attempt_id       INT      NOT NULL,
    flag_type        ENUM(
                       'EXCESSIVE_TAB_SWITCHES',
                       'FACE_NOT_DETECTED_LONG',
                       'MULTIPLE_LOGINS',
                       'HIGH_SUSPICION_SCORE',
                       'COPY_PASTE_ABUSE',
                       'TIME_ANOMALY',
                       'IP_CHANGE_DURING_EXAM',
                       'RAPID_ANSWERING'
                     )        NOT NULL,
    description      TEXT     NOT NULL,
    detected_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_resolved      BOOLEAN  NOT NULL DEFAULT FALSE,
    resolved_by      INT,                         -- FK to proctor/admin
    resolved_at      DATETIME,
    resolution_notes TEXT,

    PRIMARY KEY (flag_id),

    CONSTRAINT fk_flags_attempt
        FOREIGN KEY (attempt_id)  REFERENCES ExamAttempts(attempt_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_flags_resolver
        FOREIGN KEY (resolved_by) REFERENCES Users(user_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 10 : LoginSessions
-- ─────────────────────────────────────────────────────────────
-- Tracks every login. Used by trigger to detect simultaneous
-- sessions from different IPs (a strong cheating signal).
-- ============================================================
CREATE TABLE LoginSessions (
    session_id         INT          NOT NULL AUTO_INCREMENT,
    user_id            INT          NOT NULL,
    login_time         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_time        DATETIME,
    ip_address         VARCHAR(45)  NOT NULL,
    device_fingerprint VARCHAR(255),
    session_token      VARCHAR(255) NOT NULL,
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,

    PRIMARY KEY (session_id),
    UNIQUE  KEY uq_session_token (session_token),

    CONSTRAINT fk_session_user
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
-- TABLE 11 : UserRoles  (multi-role junction — BCNF)
-- ─────────────────────────────────────────────────────────────
-- A user can hold more than one role (e.g. instructor AND proctor).
-- Users.role stores the PRIMARY display role; UserRoles stores
-- ADDITIONAL roles.  Composite PK (user_id, role) is in BCNF:
-- every non-key attribute is determined solely by the whole PK.
-- ============================================================
CREATE TABLE UserRoles (
    user_id  INT  NOT NULL,
    role     ENUM('student','instructor','proctor','admin') NOT NULL,

    PRIMARY KEY (user_id, role),

    CONSTRAINT fk_userroles_user
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
