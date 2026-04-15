-- ============================================================
--   DEMO ACCOUNTS  — append-only (does NOT wipe existing data)
-- ============================================================
--   demoprof     Demo#Prof1   teacher   ← instructor + proctor
--   demostudent  Demo@Stu1    student   ← full lifecycle: flagged,
--                                          submitted, timed_out,
--                                          in_progress
--
--   New Course : CS401 — Artificial Intelligence  (demoprof owns it)
--   Exams      : Exam 5 (past/completed) · Exam 6 (live) · Exam 7 (upcoming)
--   Attempts   : 6 students on Exam 5, demostudent on Exam 6 + Exam 3
--
--   Run AFTER 01–06.  Re-run 03_triggers.sql afterwards.
-- ============================================================

USE ExamProctor;

-- ── Temporarily disable triggers (for historical data inserts) ─
DROP TRIGGER IF EXISTS trg_validate_exam_start;
DROP TRIGGER IF EXISTS trg_check_time_on_answer;
DROP TRIGGER IF EXISTS trg_auto_grade_answer;
DROP TRIGGER IF EXISTS trg_update_suspicion_score;
DROP TRIGGER IF EXISTS trg_auto_flag_suspicious;
DROP TRIGGER IF EXISTS trg_log_exam_submission;
DROP TRIGGER IF EXISTS trg_detect_multiple_logins;


-- ============================================================
-- USERS
-- ─────────────────────────────────────────────────────────────
-- username      password      role
-- demoprof      Demo#Prof1    teacher   (instructor + proctor)
-- demostudent   Demo@Stu1     student
-- ============================================================
INSERT INTO Users (user_id, email, password_hash, full_name, role, phone_number, username) VALUES
(20, 'demo.prof@examguard.edu',    'sha256:1e123d4ab3c2396c747ce32b8ffeacf55e78dcdbfb4a1a386a056a8a151f1a81', 'Dr. Demo Professor', 'teacher', '9000000020', 'demoprof'),
(21, 'demo.student@student.edu',   'sha256:76b1892b25a22a01964959e7f698131b0a4e0b0f97a51e869dbaa0d295be3d6a', 'Demo Student',       'student', '9111111120', 'demostudent');


-- ============================================================
-- COURSE  (owned by demoprof)
-- ============================================================
INSERT INTO Courses (course_id, course_code, course_name, description, instructor_id) VALUES
(3, 'CS401', 'Artificial Intelligence',
   'Search algorithms, ML basics, neural networks, NLP, and Bayesian reasoning.', 20);


-- ============================================================
-- ENROLLMENTS
--   • demostudent enrolled in CS401 (demoprof's course)
--   • demostudent enrolled in CS301 (for Exam 3 — the live DBMS exam)
--   • 5 existing students also in CS401 (fills teacher's analytics)
-- ============================================================
INSERT INTO Enrollments (student_id, course_id, status) VALUES
-- demostudent
(21,  3, 'active'),
(21,  1, 'active'),
-- existing students in CS401
(6,   3, 'active'),
(7,   3, 'active'),
(8,   3, 'active'),
(9,   3, 'active'),
(10,  3, 'active');


-- ============================================================
-- EXAMS  (all created by demoprof)
--   Exam 5 : AI Mid-Term      — past, completed   (window closed)
--   Exam 6 : AI End-Term      — live, in_progress  (window open till 2030)
--   Exam 7 : AI Neural Nets   — upcoming           (window starts 2027)
-- ============================================================
INSERT INTO Exams
    (exam_id, course_id, title, description, total_marks, passing_marks, duration_minutes,
     window_start, window_end, created_by, is_published,
     max_attempts, shuffle_questions, show_results_immediately)
VALUES
(5, 3, 'AI Mid-Term Examination',
   'Covers search algorithms, adversarial games, and knowledge representation.',
   50.00, 25.00, 60,
   '2025-12-10 09:00:00', '2025-12-10 12:00:00', 20, TRUE, 2, TRUE, FALSE),

(6, 3, 'AI End-Term Examination',
   'Full syllabus — ML, neural networks, backpropagation, and NLP.',
   100.00, 50.00, 120,
   '2026-03-01 08:00:00', '2030-12-31 23:59:59', 20, TRUE, 1, TRUE, FALSE),

(7, 3, 'AI Unit Test — Neural Networks',
   'Covers perceptrons, CNNs, RNNs, and backpropagation in depth.',
   30.00, 15.00, 45,
   '2027-06-01 10:00:00', '2027-06-01 12:00:00', 20, TRUE, 1, FALSE, FALSE);


-- ============================================================
-- QUESTIONS — Exam 5  (5 MCQ × 10 marks)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(31, 5, 'Which search algorithm is guaranteed to find the shortest path in an unweighted graph?',
 'MCQ', 10.00, 'Depth-First Search', 'Breadth-First Search', 'A* Search', 'Greedy Best-First', 'B', 'easy', 1),

(32, 5, 'For A* to guarantee an optimal solution, the heuristic h(n) must be ___.',
 'MCQ', 10.00, 'Admissible only', 'Consistent only', 'Both admissible and consistent', 'Neither', 'C', 'hard', 2),

(33, 5, 'Which of the following is a propositional logic connective?',
 'MCQ', 10.00, 'For all (∀)', 'There exists (∃)', 'Implies (→)', 'None of the above', 'C', 'medium', 3),

(34, 5, 'The Minimax algorithm is primarily used in ___.',
 'MCQ', 10.00, 'Single-agent path finding', 'Adversarial game trees', 'Constraint satisfaction', 'Bayesian networks', 'B', 'medium', 4),

(35, 5, 'A Bayesian network encodes ___ relationships among random variables.',
 'MCQ', 10.00, 'Linear correlation', 'Conditional independence', 'Temporal causation', 'Mutual exclusion', 'B', 'hard', 5);


-- ============================================================
-- QUESTIONS — Exam 6  (5 MCQ × 20 marks)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(36, 6, 'In supervised learning, the model is trained on ___.',
 'MCQ', 20.00, 'Unlabelled data', 'Labelled input-output pairs', 'Reward signals', 'Cluster centroids', 'B', 'easy', 1),

(37, 6, 'Which activation function is most commonly used in hidden layers of deep networks today?',
 'MCQ', 20.00, 'Sigmoid', 'Tanh', 'ReLU', 'Softmax', 'C', 'medium', 2),

(38, 6, 'Backpropagation computes gradients using the ___ rule from calculus.',
 'MCQ', 20.00, 'Product rule', 'Chain rule', 'Quotient rule', 'Power rule', 'B', 'medium', 3),

(39, 6, 'Which technique helps reduce overfitting in neural networks?',
 'MCQ', 20.00, 'Increasing model complexity', 'Removing all regularization', 'Dropout and L2 regularization', 'Maximising learning rate', 'C', 'hard', 4),

(40, 6, 'In a Transformer model, ___ is used to weigh the relevance of each token.',
 'MCQ', 20.00, 'Convolution', 'Recurrence', 'Self-attention', 'Max-pooling', 'C', 'hard', 5);


-- ============================================================
-- EXAM ATTEMPTS
-- ─────────────────────────────────────────────────────────────
-- Exam 5 (AI Mid-Term — completed):
--   3001  demostudent  attempt 1  FLAGGED   50/50  (rapid + copy-paste + tab switches)
--   3002  demostudent  attempt 2  submitted 30/50  (clean re-sit)
--   3003  arjunk       attempt 1  submitted 45/50
--   3004  priyam       attempt 1  submitted 40/50
--   3005  ravis        attempt 1  timed_out 20/50
--   3006  ishat        attempt 1  submitted 30/50
--   3007  nikhild      attempt 1  flagged   50/50  (rapid answering)
--
-- Exam 6 (AI End-Term — LIVE):
--   3010  demostudent  attempt 1  in_progress (2 answers so far)
--
-- Exam 3 (DBMS End-Term — LIVE, demostudent enrolled in CS301):
--   3015  demostudent  attempt 1  timed_out  20/100
-- ============================================================
INSERT INTO ExamAttempts
    (attempt_id, exam_id, student_id, attempt_number, started_at, submitted_at,
     auto_submitted, score, percentage, status,
     suspicion_score, tab_switches, copy_paste_attempts, fullscreen_exits,
     ip_address, browser_info)
VALUES
-- ── Exam 5 attempts ──────────────────────────────────────────
-- demostudent attempt 1 — flagged (suspiciously perfect + rapid + copy-paste)
(3001, 5, 21, 1, '2025-12-10 09:08:00', '2025-12-10 09:42:00', FALSE, 50.00, 100.00, 'flagged',
  85, 9, 4, 3, '192.168.5.21', 'Chrome/121 Windows 11'),

-- demostudent attempt 2 — clean re-sit (3/5 correct)
(3002, 5, 21, 2, '2025-12-10 10:30:00', '2025-12-10 11:15:00', FALSE, 30.00, 60.00, 'submitted',
   5, 0, 0, 1, '192.168.5.21', 'Chrome/121 Windows 11'),

-- arjunk — clean high scorer (4.5/5)
(3003, 5, 6,  1, '2025-12-10 09:05:00', '2025-12-10 09:55:00', FALSE, 45.00, 90.00, 'submitted',
   0, 0, 0, 0, '192.168.1.101', 'Chrome/121 Windows 11'),

-- priyam — good score (4/5)
(3004, 5, 7,  1, '2025-12-10 09:10:00', '2025-12-10 09:58:00', FALSE, 40.00, 80.00, 'submitted',
   6, 1, 0, 0, '192.168.1.102', 'Firefox/122 Windows 11'),

-- ravis — timed out (only answered 2)
(3005, 5, 8,  1, '2025-12-10 09:08:00', '2025-12-10 10:08:00', TRUE,  20.00, 40.00, 'timed_out',
   2, 0, 0, 0, '192.168.1.103', 'Chrome/121 Windows 10'),

-- ishat — passed (3/5)
(3006, 5, 9,  1, '2025-12-10 09:15:00', '2025-12-10 10:05:00', FALSE, 30.00, 60.00, 'submitted',
   4, 1, 0, 1, '192.168.1.104', 'Safari/17 macOS'),

-- nikhild — flagged, rapid answering (5/5 in 55 seconds)
(3007, 5, 10, 1, '2025-12-10 09:20:00', '2025-12-10 10:10:00', FALSE, 50.00, 100.00, 'flagged',
  72, 8, 3, 2, '10.0.0.50', 'Chrome/121 Linux'),

-- ── Exam 6 attempt — live ─────────────────────────────────────
-- demostudent in_progress on AI End-Term (answered Q1 + Q2)
(3010, 6, 21, 1, '2026-04-14 10:00:00', NULL, FALSE, NULL, NULL, 'in_progress',
   0, 0, 0, 0, '192.168.5.21', 'Chrome/124 Windows 11'),

-- ── Exam 3 attempt — demostudent timed out ────────────────────
(3015, 3, 21, 1, '2026-04-10 09:00:00', '2026-04-10 11:00:00', TRUE, 20.00, 20.00, 'timed_out',
   3, 1, 0, 0, '192.168.5.21', 'Chrome/124 Windows 11');


-- ============================================================
-- STUDENT ANSWERS
-- ============================================================

-- ── Attempt 3001: demostudent (flagged) — all correct, avg 6s/Q ──
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3001, 31, 'B', TRUE,  10.00, 6),
(3001, 32, 'C', TRUE,  10.00, 7),
(3001, 33, 'C', TRUE,  10.00, 5),
(3001, 34, 'B', TRUE,  10.00, 8),
(3001, 35, 'B', TRUE,  10.00, 6);

-- ── Attempt 3002: demostudent (clean re-sit) — 3/5 correct ──────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3002, 31, 'B', TRUE,   10.00, 85),
(3002, 32, 'A', FALSE,   0.00, 120),
(3002, 33, 'C', TRUE,   10.00, 95),
(3002, 34, 'B', TRUE,   10.00, 88),
(3002, 35, 'A', FALSE,   0.00, 130);

-- ── Attempt 3003: arjunk — 4/5 correct ──────────────────────────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3003, 31, 'B', TRUE,  10.00, 70),
(3003, 32, 'C', TRUE,  10.00, 110),
(3003, 33, 'C', TRUE,  10.00, 65),
(3003, 34, 'B', TRUE,  10.00, 80),
(3003, 35, 'A', FALSE,  0.00, 95);

-- ── Attempt 3004: priyam — 4/5 correct ──────────────────────────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3004, 31, 'B', TRUE,  10.00, 75),
(3004, 32, 'C', TRUE,  10.00, 115),
(3004, 33, 'C', TRUE,  10.00, 70),
(3004, 34, 'A', FALSE,  0.00, 90),
(3004, 35, 'B', TRUE,  10.00, 100);

-- ── Attempt 3005: ravis — timed out, only 2 answered ────────────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3005, 31, 'B', TRUE,  10.00, 200),
(3005, 32, 'A', FALSE,  0.00, 350);

-- ── Attempt 3006: ishat — 3/5 correct ───────────────────────────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3006, 31, 'B', TRUE,  10.00, 90),
(3006, 32, 'A', FALSE,  0.00, 140),
(3006, 33, 'C', TRUE,  10.00, 100),
(3006, 34, 'B', TRUE,  10.00, 85),
(3006, 35, 'A', FALSE,  0.00, 120);

-- ── Attempt 3007: nikhild (flagged, rapid) — 5/5 correct, avg 11s/Q
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3007, 31, 'B', TRUE,  10.00, 12),
(3007, 32, 'C', TRUE,  10.00, 11),
(3007, 33, 'C', TRUE,  10.00, 10),
(3007, 34, 'B', TRUE,  10.00, 13),
(3007, 35, 'B', TRUE,  10.00, 9);

-- ── Attempt 3010: demostudent on Exam 6 — 2 answered so far ─────
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3010, 36, 'B', TRUE,  20.00, 75),
(3010, 37, 'C', TRUE,  20.00, 90);

-- ── Attempt 3015: demostudent on Exam 3 — timed out, 2 answered ─
INSERT INTO StudentAnswers (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds) VALUES
(3015, 21, 'B', FALSE,  0.00, 200),
(3015, 22, 'B', TRUE,  10.00, 300);


-- ============================================================
-- PROCTOR LOGS
-- ============================================================

-- ── Attempt 3001: demostudent — flagged (full event trail) ──────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3001, 'EXAM_STARTED',        'INFO',     'Exam started. Browser: Chrome/121 Windows 11.',          '2025-12-10 09:08:00', '192.168.5.21'),
(3001, 'TAB_SWITCH',          'MEDIUM',   'Tab switch #1 detected.',                                '2025-12-10 09:10:00', '192.168.5.21'),
(3001, 'COPY_PASTE_DETECTED', 'HIGH',     'Ctrl+V paste detected on Question 1.',                   '2025-12-10 09:11:00', '192.168.5.21'),
(3001, 'TAB_SWITCH',          'MEDIUM',   'Tab switch #2 detected.',                                '2025-12-10 09:12:00', '192.168.5.21'),
(3001, 'FULLSCREEN_EXIT',     'MEDIUM',   'Student exited fullscreen mode.',                        '2025-12-10 09:13:00', '192.168.5.21'),
(3001, 'COPY_PASTE_DETECTED', 'HIGH',     'Paste detected on Question 2.',                          '2025-12-10 09:14:00', '192.168.5.21'),
(3001, 'RAPID_ANSWERING',     'HIGH',     '5 questions answered in ~32 seconds (avg 6.4 s/Q).',     '2025-12-10 09:15:00', '192.168.5.21'),
(3001, 'TAB_SWITCH',          'MEDIUM',   'Tab switch #3.',                                         '2025-12-10 09:20:00', '192.168.5.21'),
(3001, 'DEVTOOLS_OPENED',     'HIGH',     'Browser DevTools panel opened.',                         '2025-12-10 09:22:00', '192.168.5.21'),
(3001, 'TAB_SWITCH',          'HIGH',     'Tab switch #4 — suspicious pattern identified.',         '2025-12-10 09:25:00', '192.168.5.21'),
(3001, 'COPY_PASTE_DETECTED', 'HIGH',     'Paste on Question 4.',                                   '2025-12-10 09:28:00', '192.168.5.21'),
(3001, 'FULLSCREEN_EXIT',     'MEDIUM',   'Exited fullscreen a second time.',                       '2025-12-10 09:30:00', '192.168.5.21'),
(3001, 'TAB_SWITCH',          'HIGH',     'Tab switch #5 — auto-flag triggered.',                   '2025-12-10 09:33:00', '192.168.5.21'),
(3001, 'COPY_PASTE_DETECTED', 'CRITICAL', 'Paste on Question 5 — 4th copy-paste event.',            '2025-12-10 09:35:00', '192.168.5.21'),
(3001, 'RIGHT_CLICK_ATTEMPT', 'LOW',      'Right-click attempted on question text (blocked).',      '2025-12-10 09:37:00', '192.168.5.21'),
(3001, 'BROWSER_BACK_PRESSED','MEDIUM',   'Browser back button pressed during exam.',               '2025-12-10 09:39:00', '192.168.5.21'),
(3001, 'EXAM_SUBMITTED',      'INFO',     'Exam submitted. Score: 50/50. Status: flagged.',         '2025-12-10 09:42:00', '192.168.5.21');

-- ── Attempt 3002: demostudent — clean re-sit ────────────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3002, 'EXAM_STARTED',    'INFO',   'Exam started (attempt 2).',             '2025-12-10 10:30:00', '192.168.5.21'),
(3002, 'FULLSCREEN_EXIT', 'MEDIUM', 'Briefly exited fullscreen.',            '2025-12-10 10:55:00', '192.168.5.21'),
(3002, 'EXAM_SUBMITTED',  'INFO',   'Exam submitted. Score: 30/50.',         '2025-12-10 11:15:00', '192.168.5.21');

-- ── Attempt 3003: arjunk — clean ────────────────────────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3003, 'EXAM_STARTED',   'INFO', 'Exam started normally.',                   '2025-12-10 09:05:00', '192.168.1.101'),
(3003, 'EXAM_SUBMITTED', 'INFO', 'Exam submitted. Score: 45/50.',            '2025-12-10 09:55:00', '192.168.1.101');

-- ── Attempt 3005: ravis — timed out ─────────────────────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3005, 'EXAM_STARTED',   'INFO', 'Exam started.',                            '2025-12-10 09:08:00', '192.168.1.103'),
(3005, 'IDLE_WARNING',   'LOW',  'No interaction detected for 5 minutes.',   '2025-12-10 09:55:00', '192.168.1.103'),
(3005, 'AUTO_SUBMITTED', 'INFO', 'Auto-submitted: time limit reached.',      '2025-12-10 10:08:00', '192.168.1.103');

-- ── Attempt 3007: nikhild — flagged (rapid) ─────────────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3007, 'EXAM_STARTED',       'INFO',   'Exam started.',                              '2025-12-10 09:20:00', '10.0.0.50'),
(3007, 'DEVTOOLS_OPENED',    'HIGH',   'DevTools opened within 1 minute of start.',  '2025-12-10 09:21:00', '10.0.0.50'),
(3007, 'RAPID_ANSWERING',    'HIGH',   'All 5 questions answered in ~55 seconds.',   '2025-12-10 09:22:00', '10.0.0.50'),
(3007, 'TAB_SWITCH',         'MEDIUM', 'Tab switch #1.',                             '2025-12-10 09:25:00', '10.0.0.50'),
(3007, 'COPY_PASTE_DETECTED','HIGH',   'Paste on Q3.',                               '2025-12-10 09:30:00', '10.0.0.50'),
(3007, 'EXAM_SUBMITTED',     'INFO',   'Exam submitted. Score: 50/50. Flagged.',     '2025-12-10 10:10:00', '10.0.0.50');

-- ── Attempt 3010: demostudent — live exam (Exam 6) ──────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3010, 'EXAM_STARTED', 'INFO', 'Exam started. Browser: Chrome/124 Windows 11.', '2026-04-14 10:00:00', '192.168.5.21');

-- ── Attempt 3015: demostudent — Exam 3 timed out ────────────────
INSERT INTO ProctorLogs (attempt_id, event_type, severity, event_details, logged_at, ip_address) VALUES
(3015, 'EXAM_STARTED',   'INFO', 'Exam started.',                            '2026-04-10 09:00:00', '192.168.5.21'),
(3015, 'TAB_SWITCH',     'LOW',  'Tab switch #1 detected.',                  '2026-04-10 09:30:00', '192.168.5.21'),
(3015, 'IDLE_WARNING',   'LOW',  'No interaction for 5 minutes.',            '2026-04-10 10:50:00', '192.168.5.21'),
(3015, 'AUTO_SUBMITTED', 'INFO', 'Auto-submitted: 2-hour time limit reached.','2026-04-10 11:00:00', '192.168.5.21');


-- ============================================================
-- SUSPICION FLAGS
-- ─────────────────────────────────────────────────────────────
-- demostudent attempt 3001:  2 resolved (demoprof reviewed) + 2 open
-- nikhild    attempt 3007:  1 open flag
-- ============================================================
INSERT INTO SuspicionFlags
    (attempt_id, flag_type, description, detected_at, is_resolved, resolved_by, resolved_at, resolution_notes)
VALUES
-- ── Flagged: demostudent 3001 — 2 RESOLVED by demoprof ──────────
(3001, 'EXCESSIVE_TAB_SWITCHES',
 '9 tab switches during 34-minute exam. Threshold is 5.',
 '2025-12-10 09:33:00', TRUE, 20, '2025-12-11 10:00:00',
 'Confirmed suspicious pattern. Combined with copy-paste events — case escalated to academic committee.'),

(3001, 'RAPID_ANSWERING',
 'All 5 questions answered in ~32 seconds total (avg 6.4 s/Q). Minimum expected: 30 s/Q.',
 '2025-12-10 09:15:00', TRUE, 20, '2025-12-11 10:05:00',
 'Student claims prior preparation. Pattern remains anomalous given question difficulty. Left for committee decision.'),

-- ── Flagged: demostudent 3001 — 2 OPEN (awaiting review) ────────
(3001, 'COPY_PASTE_ABUSE',
 '4 paste events detected — likely copying answers from an external source.',
 '2025-12-10 09:35:00', FALSE, NULL, NULL, NULL),

(3001, 'HIGH_SUSPICION_SCORE',
 'Suspicion score 85/100 — DevTools opened, 9 tab switches, rapid answering, 4 copy-paste events, browser-back pressed.',
 '2025-12-10 09:42:00', FALSE, NULL, NULL, NULL),

-- ── Flagged: nikhild 3007 — rapid answering, open ───────────────
(3007, 'RAPID_ANSWERING',
 'All 5 questions answered in 55 seconds (avg 11 s/Q). DevTools opened at exam start.',
 '2025-12-10 09:22:00', FALSE, NULL, NULL, NULL),

(3007, 'HIGH_SUSPICION_SCORE',
 'Suspicion score 72/100 — DevTools opened, rapid answering, 8 tab switches, 3 copy-paste events.',
 '2025-12-10 10:10:00', FALSE, NULL, NULL, NULL);


-- ============================================================
-- NOTE: Re-run sql/03_triggers.sql after this file to restore
--       all triggers for the live exam session.
-- ============================================================
