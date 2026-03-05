-- ============================================================
--   SAMPLE DATA
--   Realistic seed data for demo / viva
-- ============================================================
--   1 Admin, 2 Instructors, 2 Proctors, 10 Students
--   2 Courses, 3 Exams, 20 Questions
--   Mixed attempts: clean, suspicious, timed-out, flagged
-- ============================================================

USE ExamProctor;

-- Disable foreign key checks for bulk insert order
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- USERS
-- password_hash is bcrypt of 'Password@123' (for demo only)
-- ============================================================
INSERT INTO Users (user_id, email, password_hash, full_name, role, phone_number) VALUES
-- Admin
(1,  'admin@examproctor.edu',      '$2b$12$adminHashXXXXXXXXXXXXXXXXXXXXXXX', 'System Admin',          'admin',      '9000000001'),
-- Instructors
(2,  'prof.sharma@examproctor.edu', '$2b$12$instrHashXXXXXXXXXXXXXXXXXXXXXX', 'Prof. Anil Sharma',     'instructor', '9000000002'),
(3,  'prof.nair@examproctor.edu',   '$2b$12$instrHashXXXXXXXXXXXXXXXXXXXXXX', 'Prof. Meera Nair',      'instructor', '9000000003'),
-- Proctors
(4,  'proctor1@examproctor.edu',    '$2b$12$proctHashXXXXXXXXXXXXXXXXXXXXXX', 'Rahul Verma',           'proctor',    '9000000004'),
(5,  'proctor2@examproctor.edu',    '$2b$12$proctHashXXXXXXXXXXXXXXXXXXXXXX', 'Sunita Rao',            'proctor',    '9000000005'),
-- Students
(6,  'arjun.k@student.edu',         '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Arjun Kumar',           'student',    '9111111101'),
(7,  'priya.m@student.edu',         '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Priya Menon',           'student',    '9111111102'),
(8,  'ravi.s@student.edu',          '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Ravi Shankar',          'student',    '9111111103'),
(9,  'isha.t@student.edu',          '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Isha Trivedi',          'student',    '9111111104'),
(10, 'nikhil.d@student.edu',        '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Nikhil Desai',          'student',    '9111111105'),
(11, 'ananya.b@student.edu',        '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Ananya Bose',           'student',    '9111111106'),
(12, 'rohan.p@student.edu',         '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Rohan Patel',           'student',    '9111111107'),
(13, 'sneha.r@student.edu',         '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Sneha Reddy',           'student',    '9111111108'),
(14, 'aditya.j@student.edu',        '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Aditya Joshi',          'student',    '9111111109'),
(15, 'kavya.n@student.edu',         '$2b$12$stuHashXXXXXXXXXXXXXXXXXXXXXXXX', 'Kavya Nair',            'student',    '9111111110');


-- ============================================================
-- COURSES
-- ============================================================
INSERT INTO Courses (course_id, course_code, course_name, description, instructor_id) VALUES
(1, 'CS301', 'Database Management Systems',
   'Covers relational model, SQL, transactions, normalization, and NoSQL.', 2),
(2, 'CS201', 'Data Structures & Algorithms',
   'Arrays, linked lists, trees, graphs, sorting and searching algorithms.', 3);


-- ============================================================
-- ENROLLMENTS (all 10 students in both courses)
-- ============================================================
INSERT INTO Enrollments (student_id, course_id, status) VALUES
(6,  1, 'active'), (7,  1, 'active'), (8,  1, 'active'), (9,  1, 'active'), (10, 1, 'active'),
(11, 1, 'active'), (12, 1, 'active'), (13, 1, 'active'), (14, 1, 'active'), (15, 1, 'active'),
(6,  2, 'active'), (7,  2, 'active'), (8,  2, 'active'), (9,  2, 'active'), (10, 2, 'active'),
(11, 2, 'active'), (12, 2, 'active'), (13, 2, 'active'), (14, 2, 'active'), (15, 2, 'active');


-- ============================================================
-- EXAMS
-- ============================================================
INSERT INTO Exams
    (exam_id, course_id, title, total_marks, passing_marks, duration_minutes,
     window_start, window_end, created_by, is_published,
     max_attempts, shuffle_questions, show_results_immediately)
VALUES
-- Exam 1: DBMS Mid-Term (past, completed)
(1, 1, 'DBMS Mid-Term Examination', 50.00, 25.00, 60,
 '2025-11-10 09:00:00', '2025-11-10 12:00:00', 2, TRUE, 1, TRUE, FALSE),

-- Exam 2: DSA Quiz (past, completed)
(2, 2, 'DSA Weekly Quiz - Trees & Graphs', 20.00, 10.00, 30,
 '2025-11-15 14:00:00', '2025-11-15 16:00:00', 3, TRUE, 1, FALSE, TRUE),

-- Exam 3: DBMS End-Term (upcoming / active window)
(3, 1, 'DBMS End-Term Examination', 100.00, 50.00, 120,
 '2026-04-01 09:00:00', '2026-04-01 14:00:00', 2, TRUE, 1, TRUE, FALSE);


-- ============================================================
-- QUESTIONS – Exam 1 (DBMS Mid-Term, 10 MCQ × 5 marks each)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(1,  1, 'Which normal form eliminates partial dependencies?',
 'MCQ', 5.00, 'First Normal Form', 'Second Normal Form', 'Third Normal Form', 'BCNF',
 'B', 'easy', 1),
(2,  1, 'A foreign key constraint ensures ___.',
 'MCQ', 5.00,
 'Uniqueness of values', 'Referential integrity', 'Atomicity of transactions', 'Index creation',
 'B', 'easy', 2),
(3,  1, 'Which SQL clause is used to filter groups?',
 'MCQ', 5.00, 'WHERE', 'ORDER BY', 'HAVING', 'GROUP BY',
 'C', 'easy', 3),
(4,  1, 'A relation is in BCNF if for every functional dependency X→Y, X is a ___.',
 'MCQ', 5.00, 'Primary key', 'Candidate key', 'Super key', 'Foreign key',
 'C', 'medium', 4),
(5,  1, 'What isolation level prevents dirty reads but allows non-repeatable reads?',
 'MCQ', 5.00,
 'READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE',
 'B', 'medium', 5),
(6,  1, 'Which join returns all rows from the left table and matched rows from the right?',
 'MCQ', 5.00, 'INNER JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'LEFT JOIN',
 'D', 'easy', 6),
(7,  1, 'Two-phase locking guarantees ___.',
 'MCQ', 5.00, 'Atomicity', 'Durability', 'Serializability', 'Consistency',
 'C', 'hard', 7),
(8,  1, 'The ACID property that ensures transactions survive crashes is ___.',
 'MCQ', 5.00, 'Atomicity', 'Consistency', 'Isolation', 'Durability',
 'D', 'easy', 8),
(9,  1, 'A deadlock can be prevented using ___.',
 'MCQ', 5.00,
 'Consistent lock ordering', 'Random lock ordering', 'Disabling transactions', 'Using READ UNCOMMITTED',
 'A', 'hard', 9),
(10, 1, 'Which command permanently removes a transaction''s changes?',
 'MCQ', 5.00, 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
 'B', 'easy', 10);


-- ============================================================
-- QUESTIONS – Exam 2 (DSA Quiz, 10 MCQ × 2 marks each)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(11, 2, 'What is the time complexity of BFS on a graph with V vertices and E edges?',
 'MCQ', 2.00, 'O(V)', 'O(E)', 'O(V+E)', 'O(V*E)', 'C', 'medium', 1),
(12, 2, 'In a Binary Search Tree, inorder traversal gives nodes in ___ order.',
 'MCQ', 2.00, 'Random', 'Reverse sorted', 'Sorted ascending', 'Level order',
 'C', 'easy', 2),
(13, 2, 'Dijkstra''s algorithm fails when graph has ___.',
 'MCQ', 2.00, 'Cycles', 'Directed edges', 'Negative weights', 'Self loops',
 'C', 'medium', 3),
(14, 2, 'Height of a complete binary tree with n nodes is ___.',
 'MCQ', 2.00, 'O(n)', 'O(log n)', 'O(n log n)', 'O(sqrt n)', 'B', 'easy', 4),
(15, 2, 'Which data structure is used in BFS?',
 'MCQ', 2.00, 'Stack', 'Queue', 'Priority Queue', 'Deque', 'B', 'easy', 5),
(16, 2, 'AVL tree maintains balance factor between ___.',
 'MCQ', 2.00, '-2 and 2', '-1 and 1', '0 and 2', '-3 and 3', 'B', 'medium', 6),
(17, 2, 'Which traversal is used in topological sort?',
 'MCQ', 2.00, 'BFS', 'Inorder DFS', 'DFS with stack', 'Level order', 'C', 'hard', 7),
(18, 2, 'A min-heap guarantees the ___ element at root.',
 'MCQ', 2.00, 'Maximum', 'Median', 'Minimum', 'Random', 'C', 'easy', 8),
(19, 2, 'Kruskal''s algorithm uses which data structure for cycle detection?',
 'MCQ', 2.00, 'Stack', 'Queue', 'Union-Find (Disjoint Set)', 'Hash Map', 'C', 'hard', 9),
(20, 2, 'Red-Black tree guarantees O(log n) for all operations due to ___.',
 'MCQ', 2.00,
 'Random structure', 'Color-based balancing rules', 'Sorted insertion', 'Fixed height',
 'B', 'hard', 10);


-- ============================================================
-- DROP TRIGGERS TEMPORARILY
-- ExamAttempts triggers (T1, T5, T6) would block or corrupt
-- historical seed data because exam windows are in the past
-- and final statuses / explicit scores are already set.
-- StudentAnswers triggers (T2, T3) block inserts into non-
-- in_progress attempts and overwrite our explicit grading.
-- ProctorLogs trigger (T4) would double-count suspicion
-- scores and counters that are already set on the attempts.
-- LoginSessions trigger (T7) would look for in_progress
-- attempts that don't exist yet at insert time.
-- All 7 triggers are recreated by running 03_triggers.sql
-- again after this file finishes (setup.bat does this).
-- ============================================================
DROP TRIGGER IF EXISTS trg_validate_exam_start;
DROP TRIGGER IF EXISTS trg_check_time_on_answer;
DROP TRIGGER IF EXISTS trg_auto_grade_answer;
DROP TRIGGER IF EXISTS trg_update_suspicion_score;
DROP TRIGGER IF EXISTS trg_auto_flag_suspicious;
DROP TRIGGER IF EXISTS trg_log_exam_submission;
DROP TRIGGER IF EXISTS trg_detect_multiple_logins;

-- ============================================================
-- EXAM ATTEMPTS
-- ============================================================
-- Attempt IDs and scenarios:
--  1001 – Arjun:  Clean submission (DBMS)
--  1002 – Priya:  Good score (DBMS)
--  1003 – Ravi:   Suspicious (many tab switches) (DBMS)
--  1004 – Isha:   Timed out (DBMS)
--  1005 – Nikhil: Flagged (high suspicion) (DBMS)
--  1006 – Arjun:  Clean submission (DSA)
--  1007 – Priya:  Clean submission (DSA)

INSERT INTO ExamAttempts
    (attempt_id, exam_id, student_id, attempt_number, started_at, submitted_at,
     auto_submitted, score, percentage, status,
     suspicion_score, tab_switches, face_not_detected, copy_paste_attempts, fullscreen_exits,
     ip_address, browser_info)
VALUES
-- 1001: Arjun – clean, high scorer
(1001, 1, 6, 1, '2025-11-10 09:05:00', '2025-11-10 09:52:00',
 FALSE, 45.00, 90.00, 'submitted', 0, 0, 0, 0, 0,
 '192.168.1.101', 'Chrome/120 Windows 11'),

-- 1002: Priya – good score
(1002, 1, 7, 1, '2025-11-10 09:10:00', '2025-11-10 09:58:00',
 FALSE, 40.00, 80.00, 'submitted', 5, 1, 0, 0, 1,
 '192.168.1.102', 'Firefox/121 Windows 11'),

-- 1003: Ravi – suspicious (tab switches, copy-paste)
(1003, 1, 8, 1, '2025-11-10 09:08:00', '2025-11-10 10:02:00',
 FALSE, 48.00, 96.00, 'flagged', 72, 8, 2, 4, 3,
 '192.168.1.103', 'Chrome/120 Windows 10'),

-- 1004: Isha – timed out
(1004, 1, 9, 1, '2025-11-10 09:15:00', '2025-11-10 10:15:00',
 TRUE, 20.00, 40.00, 'timed_out', 10, 1, 5, 0, 0,
 '192.168.1.104', 'Safari/17 macOS'),

-- 1005: Nikhil – flagged (critical suspicion)
(1005, 1, 10, 1, '2025-11-10 09:20:00', '2025-11-10 10:01:00',
 FALSE, 50.00, 100.00, 'flagged', 88, 12, 0, 6, 5,
 '10.0.0.50',      'Chrome/120 Linux'),

-- 1006: Arjun – DSA clean
(1006, 2, 6, 1, '2025-11-15 14:05:00', '2025-11-15 14:27:00',
 FALSE, 18.00, 90.00, 'submitted', 0, 0, 0, 0, 0,
 '192.168.1.101', 'Chrome/120 Windows 11'),

-- 1007: Priya – DSA clean
(1007, 2, 7, 1, '2025-11-15 14:08:00', '2025-11-15 14:30:00',
 FALSE, 16.00, 80.00, 'submitted', 3, 0, 0, 0, 0,
 '192.168.1.102', 'Firefox/121 Windows 11');


-- ============================================================
-- STUDENT ANSWERS – Attempt 1001 (Arjun, DBMS, 9/10 correct)
-- ============================================================
INSERT INTO StudentAnswers
    (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds)
VALUES
(1001, 1,  'B', TRUE,  5.00, 30), (1001, 2,  'B', TRUE,  5.00, 25),
(1001, 3,  'C', TRUE,  5.00, 20), (1001, 4,  'C', TRUE,  5.00, 45),
(1001, 5,  'B', TRUE,  5.00, 60), (1001, 6,  'D', TRUE,  5.00, 20),
(1001, 7,  'C', TRUE,  5.00, 90), (1001, 8,  'D', TRUE,  5.00, 20),
(1001, 9,  'A', TRUE,  5.00, 80), (1001, 10, 'A', FALSE, 0.00, 15); -- wrong answer


-- ============================================================
-- STUDENT ANSWERS – Attempt 1003 (Ravi, suspicious, 10/10 "correct")
-- ============================================================
INSERT INTO StudentAnswers
    (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds)
VALUES
(1003, 1,  'B', TRUE, 5.00,  8),  -- suspiciously fast (< 10s)
(1003, 2,  'B', TRUE, 5.00,  6),
(1003, 3,  'C', TRUE, 5.00,  5),
(1003, 4,  'C', TRUE, 5.00,  7),
(1003, 5,  'B', TRUE, 5.00,  9),
(1003, 6,  'D', TRUE, 5.00,  6),
(1003, 7,  'C', TRUE, 5.00,  8),
(1003, 8,  'D', TRUE, 5.00,  5),
(1003, 9,  'A', TRUE, 5.00,  7),
(1003, 10, 'B', TRUE, 5.00,  6);


-- ============================================================
-- STUDENT ANSWERS – Attempt 1004 (Isha, timed out, 4 answered)
-- ============================================================
INSERT INTO StudentAnswers
    (attempt_id, question_id, selected_option, is_correct, marks_obtained, time_taken_seconds)
VALUES
(1004, 1, 'B', TRUE,  5.00, 120),
(1004, 2, 'A', FALSE, 0.00, 300),  -- wrong
(1004, 3, 'C', TRUE,  5.00, 450),
(1004, 4, 'B', FALSE, 0.00, 600);  -- wrong


-- ============================================================
-- PROCTORING LOGS
-- ============================================================
-- Ravi (1003): many suspicious events
INSERT INTO ProctorLogs
    (attempt_id, event_type, severity, event_details, logged_at, ip_address)
VALUES
(1001, 'EXAM_STARTED',        'INFO',   'Exam started normally.',                        '2025-11-10 09:05:00', '192.168.1.101'),
(1001, 'EXAM_SUBMITTED',      'INFO',   'Student submitted exam. Score: 45/50.',          '2025-11-10 09:52:00', '192.168.1.101'),

(1003, 'EXAM_STARTED',        'INFO',   'Exam started.',                                 '2025-11-10 09:08:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #1 detected.',                       '2025-11-10 09:10:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #2 detected.',                       '2025-11-10 09:12:00', '192.168.1.103'),
(1003, 'COPY_PASTE_DETECTED', 'HIGH',   'Ctrl+V detected in answer field.',              '2025-11-10 09:14:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #3 detected.',                       '2025-11-10 09:16:00', '192.168.1.103'),
(1003, 'FULLSCREEN_EXIT',     'MEDIUM', 'Student exited fullscreen mode.',               '2025-11-10 09:18:00', '192.168.1.103'),
(1003, 'COPY_PASTE_DETECTED', 'HIGH',   'Paste attempt on Q5.',                          '2025-11-10 09:22:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #4.',                                '2025-11-10 09:25:00', '192.168.1.103'),
(1003, 'RAPID_ANSWERING',     'HIGH',   'All 10 answers submitted in under 90 seconds.', '2025-11-10 09:30:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #5.',                                '2025-11-10 09:35:00', '192.168.1.103'),
(1003, 'COPY_PASTE_DETECTED', 'HIGH',   'Paste attempt on Q8.',                          '2025-11-10 09:40:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #6 — threshold exceeded.',           '2025-11-10 09:42:00', '192.168.1.103'),
(1003, 'COPY_PASTE_DETECTED', 'HIGH',   'Paste attempt on Q9.',                          '2025-11-10 09:45:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #7.',                                '2025-11-10 09:50:00', '192.168.1.103'),
(1003, 'TAB_SWITCH',          'MEDIUM', 'Tab switch #8.',                                '2025-11-10 09:55:00', '192.168.1.103'),
(1003, 'EXAM_SUBMITTED',      'INFO',   'Exam submitted. Score: 48/50.',                 '2025-11-10 10:02:00', '192.168.1.103'),

-- Nikhil (1005): critical events
(1005, 'EXAM_STARTED',            'INFO',     'Exam started.',                          '2025-11-10 09:20:00', '10.0.0.50'),
(1005, 'FACE_NOT_DETECTED',       'MEDIUM',   'Face not visible for 30 seconds.',       '2025-11-10 09:22:00', '10.0.0.50'),
(1005, 'MULTIPLE_LOGIN_DETECTED', 'CRITICAL', 'Second session from IP 10.0.0.99.',      '2025-11-10 09:25:00', '10.0.0.99'),
(1005, 'DEVTOOLS_OPENED',         'HIGH',     'Browser DevTools opened.',               '2025-11-10 09:28:00', '10.0.0.50'),
(1005, 'MULTIPLE_FACES_DETECTED', 'HIGH',     '2 faces visible in camera frame.',       '2025-11-10 09:30:00', '10.0.0.50'),
(1005, 'TAB_SWITCH',              'MEDIUM',   'Tab switch.',                            '2025-11-10 09:32:00', '10.0.0.50'),
(1005, 'IP_ADDRESS_CHANGED',      'CRITICAL', 'IP changed from 10.0.0.50 to 10.0.1.5.','2025-11-10 09:40:00', '10.0.1.5'),
(1005, 'EXAM_SUBMITTED',          'INFO',     'Exam submitted. Score: 50/50.',          '2025-11-10 10:01:00', '10.0.1.5'),

-- Isha (1004): face issues
(1004, 'EXAM_STARTED',      'INFO',   'Exam started.',                                  '2025-11-10 09:15:00', '192.168.1.104'),
(1004, 'FACE_NOT_DETECTED', 'MEDIUM', 'Face not detected for 60 seconds.',              '2025-11-10 09:30:00', '192.168.1.104'),
(1004, 'FACE_NOT_DETECTED', 'MEDIUM', 'Face not detected — student may have left.',    '2025-11-10 09:55:00', '192.168.1.104'),
(1004, 'IDLE_WARNING',      'LOW',    'No interaction for 5 minutes.',                  '2025-11-10 10:05:00', '192.168.1.104'),
(1004, 'FACE_NOT_DETECTED', 'MEDIUM', 'Face not detected for 90 seconds.',              '2025-11-10 10:10:00', '192.168.1.104'),
(1004, 'AUTO_SUBMITTED',    'INFO',   'Auto-submitted: time limit reached.',            '2025-11-10 10:15:00', '192.168.1.104');


-- ============================================================
-- SUSPICION FLAGS (auto + manual)
-- ============================================================
INSERT INTO SuspicionFlags
    (attempt_id, flag_type, description, detected_at, is_resolved, resolved_by, resolved_at, resolution_notes)
VALUES
-- Ravi: auto-generated by T5
(1003, 'EXCESSIVE_TAB_SWITCHES', 'Student switched tabs 8 times. Policy limit is 5.',
 '2025-11-10 09:42:00', FALSE, NULL, NULL, NULL),
(1003, 'COPY_PASTE_ABUSE', 'Copy-paste detected 4 times during exam.',
 '2025-11-10 09:45:00', FALSE, NULL, NULL, NULL),
(1003, 'RAPID_ANSWERING', 'All questions answered in under 90 seconds. Average 9s/question.',
 '2025-11-10 09:30:00', FALSE, NULL, NULL, NULL),

-- Nikhil: auto-generated
(1005, 'MULTIPLE_LOGINS', 'Two active sessions detected from different IPs during exam.',
 '2025-11-10 09:25:00', TRUE, 4, '2025-11-10 14:00:00', 'Verified with student. Second device belonged to family member. Flagged for grade review.'),
(1005, 'HIGH_SUSPICION_SCORE', 'Suspicion score 88/100. Multiple critical events.',
 '2025-11-10 09:40:00', FALSE, NULL, NULL, NULL),
(1005, 'IP_CHANGE_DURING_EXAM', 'IP changed mid-exam (10.0.0.50 → 10.0.1.5). Network switch possible.',
 '2025-11-10 09:40:00', FALSE, NULL, NULL, NULL);


-- ============================================================
-- LOGIN SESSIONS
-- ============================================================
INSERT INTO LoginSessions
    (session_id, user_id, login_time, logout_time, ip_address, device_fingerprint, session_token, is_active)
VALUES
(1, 6,  '2025-11-10 09:00:00', '2025-11-10 10:10:00', '192.168.1.101', 'FP-ARJUN-WIN11',
 'tok_arjun_1a2b3c', FALSE),
(2, 8,  '2025-11-10 09:05:00', '2025-11-10 10:10:00', '192.168.1.103', 'FP-RAVI-WIN10',
 'tok_ravi_4d5e6f', FALSE),
(3, 10, '2025-11-10 09:15:00', NULL,                  '10.0.0.50',     'FP-NIKHIL-LIN',
 'tok_nikhil_7g8h9i', TRUE),
-- Nikhil's suspicious second session (different IP)
(4, 10, '2025-11-10 09:24:00', '2025-11-10 09:26:00', '10.0.0.99',     'FP-NIKHIL-PHONE',
 'tok_nikhil_2nd_jklm', FALSE);


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- RESTORE TRIGGERS
-- setup.bat re-runs 03_triggers.sql automatically after this.
-- If running manually: mysql -u root -p ExamProctor < sql/03_triggers.sql
-- ============================================================

-- ============================================================
-- Quick sanity check
-- ============================================================
SELECT  'Users'         AS entity, COUNT(*) AS rows FROM Users
UNION ALL
SELECT  'Courses',        COUNT(*)                  FROM Courses
UNION ALL
SELECT  'Exams',          COUNT(*)                  FROM Exams
UNION ALL
SELECT  'Questions',      COUNT(*)                  FROM Questions
UNION ALL
SELECT  'ExamAttempts',   COUNT(*)                  FROM ExamAttempts
UNION ALL
SELECT  'StudentAnswers', COUNT(*)                  FROM StudentAnswers
UNION ALL
SELECT  'ProctorLogs',    COUNT(*)                  FROM ProctorLogs
UNION ALL
SELECT  'SuspicionFlags', COUNT(*)                  FROM SuspicionFlags
UNION ALL
SELECT  'LoginSessions',  COUNT(*)                  FROM LoginSessions;
