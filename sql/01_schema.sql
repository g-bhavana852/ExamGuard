-- ExamGuard — Schema  |  3NF/BCNF  |  InnoDB  |  utf8mb4

DROP DATABASE IF EXISTS ExamProctor;
CREATE DATABASE ExamProctor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ExamProctor;

-- ── TABLE 1 : Users ──────────────────────────────────────────
CREATE TABLE Users (
    user_id       INT            NOT NULL AUTO_INCREMENT,
    email         VARCHAR(100)   NOT NULL,
    password_hash VARCHAR(255)   NOT NULL,
    full_name     VARCHAR(100)   NOT NULL,
    role          ENUM('student','teacher','admin') NOT NULL DEFAULT 'student',
    phone_number  VARCHAR(20),
    created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active     BOOLEAN        NOT NULL DEFAULT TRUE,
    last_login    DATETIME,
    username      VARCHAR(50)    NULL,

    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email    (email),
    UNIQUE KEY uq_users_username (username),

    CONSTRAINT chk_users_email  CHECK (email REGEXP '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'),
    CONSTRAINT chk_users_phone  CHECK (phone_number IS NULL OR LENGTH(phone_number) >= 10)
) ENGINE=InnoDB;


-- ── TABLE 2 : Courses ────────────────────────────────────────
CREATE TABLE Courses (
    course_id     INT          NOT NULL AUTO_INCREMENT,
    course_code   VARCHAR(20)  NOT NULL,
    course_name   VARCHAR(150) NOT NULL,
    description   TEXT,
    instructor_id INT          NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,

    PRIMARY KEY (course_id),
    UNIQUE KEY uq_courses_code (course_code),

    CONSTRAINT fk_courses_instructor
        FOREIGN KEY (instructor_id) REFERENCES Users(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ── TABLE 3 : Enrollments  (M:N  Students ↔ Courses) ────────
CREATE TABLE Enrollments (
    enrollment_id INT      NOT NULL AUTO_INCREMENT,
    student_id    INT      NOT NULL,
    course_id     INT      NOT NULL,
    enrolled_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('active', 'completed', 'dropped') NOT NULL DEFAULT 'active',

    PRIMARY KEY (enrollment_id),
    UNIQUE KEY uq_enrollment (student_id, course_id),

    CONSTRAINT fk_enrollment_student
        FOREIGN KEY (student_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_enrollment_course
        FOREIGN KEY (course_id) REFERENCES Courses(course_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ── TABLE 4 : Exams ──────────────────────────────────────────
CREATE TABLE Exams (
    exam_id                  INT           NOT NULL AUTO_INCREMENT,
    course_id                INT           NOT NULL,
    title                    VARCHAR(200)  NOT NULL,
    description              TEXT,
    total_marks              DECIMAL(6,2)  NOT NULL,
    passing_marks            DECIMAL(6,2)  NOT NULL,
    duration_minutes         INT           NOT NULL,
    window_start             DATETIME      NOT NULL,
    window_end               DATETIME      NOT NULL,
    created_by               INT           NOT NULL,
    created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_published             BOOLEAN       NOT NULL DEFAULT FALSE,
    join_code                CHAR(6)       NULL UNIQUE,
    max_attempts             INT           NOT NULL DEFAULT 1,
    shuffle_questions        BOOLEAN       NOT NULL DEFAULT TRUE,
    show_results_immediately BOOLEAN       NOT NULL DEFAULT FALSE,

    PRIMARY KEY (exam_id),

    CONSTRAINT fk_exams_course   FOREIGN KEY (course_id)  REFERENCES Courses(course_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_exams_creator  FOREIGN KEY (created_by) REFERENCES Users(user_id)     ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_exams_marks    CHECK (passing_marks <= total_marks AND total_marks > 0),
    CONSTRAINT chk_exams_duration CHECK (duration_minutes > 0),
    CONSTRAINT chk_exams_window   CHECK (window_end > window_start),
    CONSTRAINT chk_exams_attempts CHECK (max_attempts >= 1)
) ENGINE=InnoDB;


-- ── TABLE 5 : Questions ──────────────────────────────────────
-- option_a–j support MCQ; NULL for TRUE_FALSE / SHORT_ANSWER
CREATE TABLE Questions (
    question_id      INT           NOT NULL AUTO_INCREMENT,
    exam_id          INT           NOT NULL,
    question_text    TEXT          NOT NULL,
    question_type    ENUM('MCQ', 'TRUE_FALSE', 'SHORT_ANSWER') NOT NULL DEFAULT 'MCQ',
    marks            DECIMAL(5,2)  NOT NULL,
    option_a         VARCHAR(500),
    option_b         VARCHAR(500),
    option_c         VARCHAR(500),
    option_d         VARCHAR(500),
    option_e         VARCHAR(500),
    option_f         VARCHAR(500),
    option_g         VARCHAR(500),
    option_h         VARCHAR(500),
    option_i         VARCHAR(500),
    option_j         VARCHAR(500),
    correct_answer   VARCHAR(500)  NULL,   -- 'A'–'J' for MCQ, 'TRUE'/'FALSE', or key; NULL = not set
    difficulty_level ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
    order_index      INT           NOT NULL DEFAULT 0,

    PRIMARY KEY (question_id),

    CONSTRAINT fk_questions_exam  FOREIGN KEY (exam_id) REFERENCES Exams(exam_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_questions_marks CHECK (marks > 0)
) ENGINE=InnoDB;


-- ── TABLE 6 : ExamAttempts  (WEAK — identity: exam_id + student_id + attempt_number) ──
-- suspicion_score, tab_switches etc. are denormalised counters kept
-- current by triggers to avoid expensive COUNT() joins on the dashboard.
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
    status               ENUM('in_progress','submitted','graded','flagged','timed_out','abandoned')
                                       NOT NULL DEFAULT 'in_progress',
    suspicion_score      INT           NOT NULL DEFAULT 0,
    tab_switches         INT           NOT NULL DEFAULT 0,
    copy_paste_attempts  INT           NOT NULL DEFAULT 0,
    fullscreen_exits     INT           NOT NULL DEFAULT 0,
    ip_address           VARCHAR(45)   NOT NULL,
    browser_info         VARCHAR(255),

    PRIMARY KEY (attempt_id),
    UNIQUE KEY uq_attempt (exam_id, student_id, attempt_number),

    CONSTRAINT fk_attempts_exam     FOREIGN KEY (exam_id)    REFERENCES Exams(exam_id)  ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_attempts_student  FOREIGN KEY (student_id) REFERENCES Users(user_id)  ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_attempts_suspicion CHECK (suspicion_score BETWEEN 0 AND 100),
    CONSTRAINT chk_attempts_counters  CHECK (tab_switches >= 0 AND copy_paste_attempts >= 0 AND fullscreen_exits >= 0)
) ENGINE=InnoDB;


-- ── TABLE 7 : StudentAnswers ─────────────────────────────────
-- is_correct / marks_obtained set by trigger (auto-grade).
-- time_taken_seconds helps detect rapid answering.
CREATE TABLE StudentAnswers (
    answer_id          INT           NOT NULL AUTO_INCREMENT,
    attempt_id         INT           NOT NULL,
    question_id        INT           NOT NULL,
    selected_option    VARCHAR(500),
    is_correct         BOOLEAN,
    marks_obtained     DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    time_taken_seconds INT,
    answered_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (answer_id),
    UNIQUE KEY uq_answer (attempt_id, question_id),

    CONSTRAINT fk_answers_attempt  FOREIGN KEY (attempt_id)  REFERENCES ExamAttempts(attempt_id) ON DELETE CASCADE  ON UPDATE CASCADE,
    CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES Questions(question_id)    ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_answers_marks   CHECK (marks_obtained >= 0)
) ENGINE=InnoDB;


-- ── TABLE 8 : ProctorLogs  (WEAK — parent: ExamAttempts) ────
CREATE TABLE ProctorLogs (
    log_id        INT      NOT NULL AUTO_INCREMENT,
    attempt_id    INT      NOT NULL,
    event_type    ENUM(
                    'EXAM_STARTED','EXAM_SUBMITTED','AUTO_SUBMITTED',
                    'TAB_SWITCH','FULLSCREEN_EXIT','COPY_PASTE_DETECTED',
                    'IDLE_WARNING','SUSPICIOUS_TYPING','BROWSER_BACK_PRESSED',
                    'RIGHT_CLICK_ATTEMPT','DEVTOOLS_OPENED','RAPID_ANSWERING','PROCTOR_KICK'
                  ) NOT NULL,
    severity      ENUM('INFO','LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'INFO',
    event_details TEXT,
    logged_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address    VARCHAR(45),
    is_reviewed   BOOLEAN  NOT NULL DEFAULT FALSE,

    PRIMARY KEY (log_id),

    CONSTRAINT fk_proctorlog_attempt
        FOREIGN KEY (attempt_id) REFERENCES ExamAttempts(attempt_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ── TABLE 9 : SuspicionFlags ─────────────────────────────────
CREATE TABLE SuspicionFlags (
    flag_id          INT      NOT NULL AUTO_INCREMENT,
    attempt_id       INT      NOT NULL,
    flag_type        ENUM(
                       'EXCESSIVE_TAB_SWITCHES','HIGH_SUSPICION_SCORE',
                       'COPY_PASTE_ABUSE','TIME_ANOMALY','RAPID_ANSWERING'
                     ) NOT NULL,
    description      TEXT     NOT NULL,
    detected_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_resolved      BOOLEAN  NOT NULL DEFAULT FALSE,
    resolved_by      INT,
    resolved_at      DATETIME,
    resolution_notes TEXT,

    PRIMARY KEY (flag_id),

    CONSTRAINT fk_flags_attempt  FOREIGN KEY (attempt_id)  REFERENCES ExamAttempts(attempt_id) ON DELETE CASCADE  ON UPDATE CASCADE,
    CONSTRAINT fk_flags_resolver FOREIGN KEY (resolved_by) REFERENCES Users(user_id)           ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ── TABLE 10 : LoginSessions ─────────────────────────────────
-- Trigger T7 uses this to detect simultaneous sessions from different IPs.
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
    UNIQUE KEY uq_session_token (session_token),

    CONSTRAINT fk_session_user
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ── TABLE 11 : UserRoles  (multi-role junction — BCNF) ───────
-- Users.role = primary display role; UserRoles = additional roles.
CREATE TABLE UserRoles (
    user_id  INT  NOT NULL,
    role     ENUM('student','teacher','admin') NOT NULL,

    PRIMARY KEY (user_id, role),

    CONSTRAINT fk_userroles_user
        FOREIGN KEY (user_id) REFERENCES Users(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
