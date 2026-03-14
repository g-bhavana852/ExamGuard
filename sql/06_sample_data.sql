-- ============================================================
--   SAMPLE DATA  v2
--   Rich seed for demo / viva
-- ============================================================
--   1 Admin, 2 Instructors, 2 Proctors, 10 Students
--   2 Courses, 3 Exams (Exam 3 window = open from 2026-03-13 onwards, always live)
--   30 Questions  |  All students have marks on Exams 1 & 2
--   7 in-progress attempts on Exam 3 (mix of clean & suspicious)
-- ============================================================

USE ExamProctor;

SET FOREIGN_KEY_CHECKS = 0;

-- ── Wipe all tables in FK-safe order ─────────────────────────
TRUNCATE TABLE SuspicionFlags;
TRUNCATE TABLE ProctorLogs;
TRUNCATE TABLE StudentAnswers;
TRUNCATE TABLE ExamAttempts;
TRUNCATE TABLE LoginSessions;
TRUNCATE TABLE UserRoles;
TRUNCATE TABLE Questions;
TRUNCATE TABLE Exams;
TRUNCATE TABLE Enrollments;
TRUNCATE TABLE Courses;
TRUNCATE TABLE Users;

-- ============================================================
-- USERS  (each account has its own password)
-- ─────────────────────────────────────────────────────────────
-- username    password
-- admin       Admin@2025
-- profsharma  Sharma#Prof1
-- profnair    Nair#Prof2
-- rahulv      Proctor@01
-- sunitarao   Sunita@Pro2
-- arjunk      Arjun@123
-- priyam      Priya@456
-- ravis       Ravi@789
-- ishat       Isha@321
-- nikhild     Nikhil@654
-- ananyab     Ananya@987
-- rohanp      Rohan@111
-- snehar      Sneha@222
-- adityaj     Aditya@333
-- kavyan      Kavya@444
-- ============================================================
INSERT INTO Users (user_id, email, password_hash, full_name, role, phone_number, username) VALUES
(1,  'admin@examguard.edu',        'sha256:fcf7bb6d546cfb82d2e55486984ae7a1862a666acb441e0cf8b4ed34a4fcf9d7', 'System Admin',       'admin',      '9000000001', 'admin'),
(2,  'prof.sharma@examguard.edu',  'sha256:5a5fda16b3cc1ed1ca6202c077e56c139b7558a7fff8e92b436c940f7098ba19', 'Prof. Anil Sharma',  'instructor', '9000000002', 'profsharma'),
(3,  'prof.nair@examguard.edu',    'sha256:3bb9bded22d4c7276a61a9ac2c6cb5b11747e7fc22041a004d36716858abd621', 'Prof. Meera Nair',   'instructor', '9000000003', 'profnair'),
(4,  'proctor1@examguard.edu',     'sha256:10440b8ccda985adc54d08d9a740d07738728dc1732c46840ca64d468c22c25c', 'Rahul Verma',        'proctor',    '9000000004', 'rahulv'),
(5,  'proctor2@examguard.edu',     'sha256:4e451660503af7c309c2a0a7cb99d283619a0f8f387e90d25902c10cc1538ca0', 'Sunita Rao',         'proctor',    '9000000005', 'sunitarao'),
-- Students
(6,  'arjun.k@student.edu',        'sha256:255ea3b51c4ca0814a74e3c1a2392fcf20edeeabcd1b1e6bbc705dde02686ebb', 'Arjun Kumar',        'student',    '9111111101', 'arjunk'),
(7,  'priya.m@student.edu',        'sha256:f060b432989eb45d741857dd316f4253dd08ae018fa0f5501e465bca056d576b', 'Priya Menon',        'student',    '9111111102', 'priyam'),
(8,  'ravi.s@student.edu',         'sha256:9b112f399f26c2520d36ee19a21a721ccad9e9bb2ef5705832b3cd99604f7d64', 'Ravi Shankar',       'student',    '9111111103', 'ravis'),
(9,  'isha.t@student.edu',         'sha256:cec7808ac6242f66945b859b3abe4c8f361e2e9c37e25c4bb14d2956cbf34245', 'Isha Trivedi',       'student',    '9111111104', 'ishat'),
(10, 'nikhil.d@student.edu',       'sha256:915de23da05f396d601fbfcb26273414871f5d3d9c5c0d0dc8de5dac80ddb262', 'Nikhil Desai',       'student',    '9111111105', 'nikhild'),
(11, 'ananya.b@student.edu',       'sha256:9ab5a9255bd28d604fd00884535ef8ea537e2ca5944454a613a315dfd0077ca3', 'Ananya Bose',        'student',    '9111111106', 'ananyab'),
(12, 'rohan.p@student.edu',        'sha256:9e38e6ff4249c37dc883c43f3c457109c83f43752856df02235628199c81acf0', 'Rohan Patel',        'student',    '9111111107', 'rohanp'),
(13, 'sneha.r@student.edu',        'sha256:40052b96694b02a89aad77fd4ac85a65c3c48b58ad9f2e189a1ef6752b8ff4b7', 'Sneha Reddy',        'student',    '9111111108', 'snehar'),
(14, 'aditya.j@student.edu',       'sha256:b4dbd140c0c1baa60cd4fa75fc6f458e4feb6aea795175c69a0fac91c1bfae97', 'Aditya Joshi',       'student',    '9111111109', 'adityaj'),
(15, 'kavya.n@student.edu',        'sha256:0eae0481abd972d7062db93cd1e217d83613a0e2d8922665a9deeb764099cbe7', 'Kavya Nair',         'student',    '9111111110', 'kavyan');

-- Prof. Sharma also proctors
INSERT INTO UserRoles (user_id, role) VALUES (2, 'proctor');


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
(6,1,'active'),(7,1,'active'),(8,1,'active'),(9,1,'active'),(10,1,'active'),
(11,1,'active'),(12,1,'active'),(13,1,'active'),(14,1,'active'),(15,1,'active'),
(6,2,'active'),(7,2,'active'),(8,2,'active'),(9,2,'active'),(10,2,'active'),
(11,2,'active'),(12,2,'active'),(13,2,'active'),(14,2,'active'),(15,2,'active');


-- ============================================================
-- EXAMS
--   Exam 3 window: 2026-03-13 → 2030-12-31 (always live for demo)
-- ============================================================
INSERT INTO Exams
    (exam_id, course_id, title, total_marks, passing_marks, duration_minutes,
     window_start, window_end, created_by, is_published,
     max_attempts, shuffle_questions, show_results_immediately)
VALUES
(1, 1, 'DBMS Mid-Term Examination',        50.00,  25.00,  60,
 '2025-11-10 09:00:00','2025-11-10 12:00:00', 2, TRUE, 1, TRUE,  FALSE),
(2, 2, 'DSA Weekly Quiz - Trees and Graphs', 20.00,  10.00,  30,
 '2025-11-15 14:00:00','2025-11-15 16:00:00', 3, TRUE, 1, FALSE, TRUE),
(3, 1, 'DBMS End-Term Examination',       100.00,  50.00, 120,
 '2026-03-13 08:00:00','2030-12-31 23:59:59', 2, TRUE, 1, TRUE,  FALSE);


-- ============================================================
-- QUESTIONS – Exam 1 (DBMS Mid-Term, 10 MCQ × 5 marks)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(1,  1,'Which normal form eliminates partial dependencies?',
 'MCQ',5.00,'First Normal Form','Second Normal Form','Third Normal Form','BCNF','B','easy',1),
(2,  1,'A foreign key constraint ensures ___.',
 'MCQ',5.00,'Uniqueness of values','Referential integrity','Atomicity of transactions','Index creation','B','easy',2),
(3,  1,'Which SQL clause is used to filter groups?',
 'MCQ',5.00,'WHERE','ORDER BY','HAVING','GROUP BY','C','easy',3),
(4,  1,'A relation is in BCNF if for every FD X→Y, X is a ___.',
 'MCQ',5.00,'Primary key','Candidate key','Super key','Foreign key','C','medium',4),
(5,  1,'What isolation level prevents dirty reads but allows non-repeatable reads?',
 'MCQ',5.00,'READ UNCOMMITTED','READ COMMITTED','REPEATABLE READ','SERIALIZABLE','B','medium',5),
(6,  1,'Which join returns all rows from the left table and matched rows from the right?',
 'MCQ',5.00,'INNER JOIN','RIGHT JOIN','FULL OUTER JOIN','LEFT JOIN','D','easy',6),
(7,  1,'Two-phase locking guarantees ___.',
 'MCQ',5.00,'Atomicity','Durability','Serializability','Consistency','C','hard',7),
(8,  1,'The ACID property that ensures transactions survive crashes is ___.',
 'MCQ',5.00,'Atomicity','Consistency','Isolation','Durability','D','easy',8),
(9,  1,'A deadlock can be prevented using ___.',
 'MCQ',5.00,'Consistent lock ordering','Random lock ordering','Disabling transactions','Using READ UNCOMMITTED','A','hard',9),
(10, 1,'Which command permanently removes a transaction''s changes?',
 'MCQ',5.00,'COMMIT','ROLLBACK','SAVEPOINT','RELEASE','B','easy',10);


-- ============================================================
-- QUESTIONS – Exam 2 (DSA Quiz, 10 MCQ × 2 marks)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(11,2,'Time complexity of BFS on graph with V vertices and E edges?',
 'MCQ',2.00,'O(V)','O(E)','O(V+E)','O(V*E)','C','medium',1),
(12,2,'BST inorder traversal gives nodes in ___ order.',
 'MCQ',2.00,'Random','Reverse sorted','Sorted ascending','Level order','C','easy',2),
(13,2,'Dijkstra''s algorithm fails when graph has ___.',
 'MCQ',2.00,'Cycles','Directed edges','Negative weights','Self loops','C','medium',3),
(14,2,'Height of a complete binary tree with n nodes is ___.',
 'MCQ',2.00,'O(n)','O(log n)','O(n log n)','O(sqrt n)','B','easy',4),
(15,2,'Which data structure is used in BFS?',
 'MCQ',2.00,'Stack','Queue','Priority Queue','Deque','B','easy',5),
(16,2,'AVL tree maintains balance factor between ___.',
 'MCQ',2.00,'-2 and 2','-1 and 1','0 and 2','-3 and 3','B','medium',6),
(17,2,'Which traversal is used in topological sort?',
 'MCQ',2.00,'BFS','Inorder DFS','DFS with stack','Level order','C','hard',7),
(18,2,'A min-heap guarantees the ___ element at root.',
 'MCQ',2.00,'Maximum','Median','Minimum','Random','C','easy',8),
(19,2,'Kruskal''s algorithm uses which DS for cycle detection?',
 'MCQ',2.00,'Stack','Queue','Union-Find (Disjoint Set)','Hash Map','C','hard',9),
(20,2,'Red-Black tree guarantees O(log n) due to ___.',
 'MCQ',2.00,'Random structure','Color-based balancing rules','Sorted insertion','Fixed height','B','hard',10);


-- ============================================================
-- QUESTIONS – Exam 3 (DBMS End-Term, 10 MCQ × 10 marks)
-- ============================================================
INSERT INTO Questions
    (question_id, exam_id, question_text, question_type, marks,
     option_a, option_b, option_c, option_d, correct_answer, difficulty_level, order_index)
VALUES
(21,3,'Which of the following is NOT a property of a relational table?',
 'MCQ',10.00,'Each column has a unique name','Order of rows is significant','Each row is unique','Values are atomic','B','medium',1),
(22,3,'In SQL, the ROLLBACK statement is used to ___.',
 'MCQ',10.00,'Save changes permanently','Undo uncommitted changes','Create a savepoint','Drop a transaction','B','easy',2),
(23,3,'Which normal form deals with multi-valued dependencies?',
 'MCQ',10.00,'2NF','3NF','BCNF','4NF','D','hard',3),
(24,3,'A transaction that reads the same row twice and gets different values has a ___ problem.',
 'MCQ',10.00,'Dirty read','Non-repeatable read','Phantom read','Lost update','B','medium',4),
(25,3,'Which SQL statement is used to create a virtual table based on a query?',
 'MCQ',10.00,'PROCEDURE','FUNCTION','VIEW','INDEX','C','easy',5),
(26,3,'What does the EXISTS operator check in a subquery?',
 'MCQ',10.00,'Count of rows returned','Whether any rows are returned','The maximum value','Whether all rows match','B','medium',6),
(27,3,'ACID stands for ___.',
 'MCQ',10.00,'Atomicity, Consistency, Isolation, Durability','Atomicity, Concurrency, Integration, Durability',
 'Availability, Consistency, Isolation, Durability','Atomicity, Consistency, Integrity, Distribution','A','easy',7),
(28,3,'Which index type is most efficient for equality searches?',
 'MCQ',10.00,'B+ Tree','Bitmap','Hash','Full-text','C','hard',8),
(29,3,'Deadlock detection algorithms use which graph?',
 'MCQ',10.00,'Dependency graph','Wait-for graph','Call graph','Bipartite graph','B','hard',9),
(30,3,'The CAP theorem states a distributed system can guarantee at most ___ of three properties.',
 'MCQ',10.00,'One','Two','All three','None','B','hard',10);


-- ============================================================
-- DROP TRIGGERS temporarily (triggers block historical inserts)
-- ============================================================
DROP TRIGGER IF EXISTS trg_validate_exam_start;
DROP TRIGGER IF EXISTS trg_check_time_on_answer;
DROP TRIGGER IF EXISTS trg_auto_grade_answer;
DROP TRIGGER IF EXISTS trg_update_suspicion_score;
DROP TRIGGER IF EXISTS trg_auto_flag_suspicious;
DROP TRIGGER IF EXISTS trg_log_exam_submission;
DROP TRIGGER IF EXISTS trg_detect_multiple_logins;


-- ============================================================
-- EXAM ATTEMPTS — Exam 1 (all 10 students, completed)
-- ============================================================
INSERT INTO ExamAttempts
    (attempt_id, exam_id, student_id, attempt_number, started_at, submitted_at,
     auto_submitted, score, percentage, status,
     suspicion_score, tab_switches, face_not_detected, copy_paste_attempts, fullscreen_exits,
     ip_address, browser_info)
VALUES
-- Arjun: clean high scorer
(1001,1,6, 1,'2025-11-10 09:05:00','2025-11-10 09:52:00',FALSE,45.00,90.00,'submitted',
  0, 0,0,0,0,'192.168.1.101','Chrome/120 Windows 11'),
-- Priya: good, minor issues
(1002,1,7, 1,'2025-11-10 09:10:00','2025-11-10 09:58:00',FALSE,40.00,80.00,'submitted',
  8, 1,0,0,1,'192.168.1.102','Firefox/121 Windows 11'),
-- Ravi: flagged — rapid answering + copy-paste + tab switches
(1003,1,8, 1,'2025-11-10 09:08:00','2025-11-10 10:02:00',FALSE,50.00,100.00,'flagged',
 78,10,0,5,3,'192.168.1.103','Chrome/120 Windows 10'),
-- Isha: timed out — only answered 4
(1004,1,9, 1,'2025-11-10 09:15:00','2025-11-10 10:15:00',TRUE, 20.00,40.00,'timed_out',
 12, 1,5,0,0,'192.168.1.104','Safari/17 macOS'),
-- Nikhil: critical — multiple logins + IP change + devtools
(1005,1,10,1,'2025-11-10 09:20:00','2025-11-10 10:01:00',FALSE,50.00,100.00,'flagged',
 91,13,0,6,5,'10.0.0.50','Chrome/120 Linux'),
-- Ananya: clean pass
(1006,1,11,1,'2025-11-10 09:12:00','2025-11-10 10:00:00',FALSE,35.00,70.00,'submitted',
  0, 0,0,0,0,'192.168.1.106','Chrome/120 Windows 11'),
-- Rohan: clean but average
(1007,1,12,1,'2025-11-10 09:18:00','2025-11-10 10:05:00',FALSE,30.00,60.00,'submitted',
  5, 0,0,1,0,'192.168.1.107','Edge/120 Windows 11'),
-- Sneha: good clean score
(1008,1,13,1,'2025-11-10 09:07:00','2025-11-10 09:55:00',FALSE,40.00,80.00,'submitted',
  0, 0,0,0,0,'192.168.1.108','Firefox/121 Windows 11'),
-- Aditya: barely passed
(1009,1,14,1,'2025-11-10 09:22:00','2025-11-10 10:18:00',FALSE,25.00,50.00,'submitted',
 15, 2,1,0,1,'192.168.1.109','Chrome/120 Windows 10'),
-- Kavya: failed
(1010,1,15,1,'2025-11-10 09:30:00','2025-11-10 10:15:00',FALSE,15.00,30.00,'submitted',
  3, 0,2,0,0,'192.168.1.110','Chrome/120 macOS');


-- ============================================================
-- EXAM ATTEMPTS — Exam 2 (all 10 students, completed)
-- ============================================================
INSERT INTO ExamAttempts
    (attempt_id, exam_id, student_id, attempt_number, started_at, submitted_at,
     auto_submitted, score, percentage, status,
     suspicion_score, tab_switches, face_not_detected, copy_paste_attempts, fullscreen_exits,
     ip_address, browser_info)
VALUES
(1011,2,6, 1,'2025-11-15 14:05:00','2025-11-15 14:27:00',FALSE,18.00,90.00,'submitted',0,0,0,0,0,'192.168.1.101','Chrome/120 Windows 11'),
(1012,2,7, 1,'2025-11-15 14:08:00','2025-11-15 14:30:00',FALSE,16.00,80.00,'submitted',3,0,0,0,0,'192.168.1.102','Firefox/121 Windows 11'),
(1013,2,8, 1,'2025-11-15 14:10:00','2025-11-15 14:35:00',FALSE,14.00,70.00,'submitted',20,3,0,1,1,'192.168.1.103','Chrome/120 Windows 10'),
(1014,2,9, 1,'2025-11-15 14:12:00','2025-11-15 14:42:00',FALSE,10.00,50.00,'submitted',5,0,1,0,0,'192.168.1.104','Safari/17 macOS'),
(1015,2,10,1,'2025-11-15 14:06:00','2025-11-15 14:28:00',FALSE,12.00,60.00,'submitted',0,0,0,0,0,'10.0.0.50','Chrome/120 Linux'),
(1016,2,11,1,'2025-11-15 14:03:00','2025-11-15 14:22:00',FALSE,20.00,100.00,'submitted',0,0,0,0,0,'192.168.1.106','Chrome/120 Windows 11'),
(1017,2,12,1,'2025-11-15 14:15:00','2025-11-15 14:45:00',FALSE, 8.00,40.00,'submitted',7,1,0,0,0,'192.168.1.107','Edge/120 Windows 11'),
(1018,2,13,1,'2025-11-15 14:07:00','2025-11-15 14:32:00',FALSE,14.00,70.00,'submitted',0,0,0,0,0,'192.168.1.108','Firefox/121 Windows 11'),
(1019,2,14,1,'2025-11-15 14:09:00','2025-11-15 14:31:00',FALSE,16.00,80.00,'submitted',0,0,0,0,0,'192.168.1.109','Chrome/120 Windows 10'),
(1020,2,15,1,'2025-11-15 14:11:00','2025-11-15 14:26:00',FALSE,18.00,90.00,'submitted',2,0,0,0,0,'192.168.1.110','Chrome/120 macOS');


-- ============================================================
-- EXAM ATTEMPTS — Exam 3 (in_progress RIGHT NOW — live exam)
-- ============================================================
INSERT INTO ExamAttempts
    (attempt_id, exam_id, student_id, attempt_number, started_at, submitted_at,
     auto_submitted, score, percentage, status,
     suspicion_score, tab_switches, face_not_detected, copy_paste_attempts, fullscreen_exits,
     ip_address, browser_info)
VALUES
-- Arjun: clean, on track
(2001,3,6, 1,'2026-03-13 09:15:00',NULL,FALSE,NULL,NULL,'in_progress',
  0, 0,0,0,0,'192.168.1.101','Chrome/121 Windows 11'),
-- Priya: 2 tab switches, minor suspicion
(2002,3,7, 1,'2026-03-13 09:10:00',NULL,FALSE,NULL,NULL,'in_progress',
 18, 2,0,0,1,'192.168.1.102','Firefox/122 Windows 11'),
-- Ravi: FLAGGED — rapid answers, copy-paste, 8 tab switches
(2003,3,8, 1,'2026-03-13 09:05:00',NULL,FALSE,NULL,NULL,'flagged',
 82,10,0,5,3,'192.168.1.103','Chrome/121 Windows 10'),
-- Isha: face not detected repeatedly
(2004,3,9, 1,'2026-03-13 09:08:00',NULL,FALSE,NULL,NULL,'in_progress',
 42, 0,6,0,0,'192.168.1.104','Safari/17 macOS'),
-- Nikhil: FLAGGED — multiple logins + IP change + devtools
(2005,3,10,1,'2026-03-13 09:12:00',NULL,FALSE,NULL,NULL,'flagged',
 90,14,0,7,5,'10.0.0.51','Chrome/121 Linux'),
-- Ananya: clean, good progress
(2006,3,11,1,'2026-03-13 09:20:00',NULL,FALSE,NULL,NULL,'in_progress',
  0, 0,0,0,0,'192.168.1.106','Chrome/121 Windows 11'),
-- Rohan: one tab switch, low suspicion
(2007,3,12,1,'2026-03-13 09:18:00',NULL,FALSE,NULL,NULL,'in_progress',
 10, 1,0,0,0,'192.168.1.107','Edge/121 Windows 11');


-- ============================================================
-- STUDENT ANSWERS — Exam 1
-- ============================================================

-- Attempt 1001: Arjun (9/10 correct = 45)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1001,1,'B',TRUE,5.00,30),(1001,2,'B',TRUE,5.00,25),(1001,3,'C',TRUE,5.00,20),
(1001,4,'C',TRUE,5.00,45),(1001,5,'B',TRUE,5.00,60),(1001,6,'D',TRUE,5.00,20),
(1001,7,'C',TRUE,5.00,90),(1001,8,'D',TRUE,5.00,20),(1001,9,'A',TRUE,5.00,80),
(1001,10,'A',FALSE,0.00,15);   -- wrong

-- Attempt 1002: Priya (8/10 = 40)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1002,1,'B',TRUE,5.00,35),(1002,2,'B',TRUE,5.00,40),(1002,3,'C',TRUE,5.00,30),
(1002,4,'A',FALSE,0.00,55),(1002,5,'B',TRUE,5.00,50),(1002,6,'D',TRUE,5.00,25),
(1002,7,'C',TRUE,5.00,85),(1002,8,'D',TRUE,5.00,30),(1002,9,'B',FALSE,0.00,45),
(1002,10,'B',TRUE,5.00,20);

-- Attempt 1003: Ravi (10/10 = 50 — suspiciously fast)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1003,1,'B',TRUE,5.00,6),(1003,2,'B',TRUE,5.00,5),(1003,3,'C',TRUE,5.00,4),
(1003,4,'C',TRUE,5.00,7),(1003,5,'B',TRUE,5.00,6),(1003,6,'D',TRUE,5.00,5),
(1003,7,'C',TRUE,5.00,8),(1003,8,'D',TRUE,5.00,4),(1003,9,'A',TRUE,5.00,6),
(1003,10,'B',TRUE,5.00,5);

-- Attempt 1004: Isha (4 answered, timed out = 20)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1004,1,'B',TRUE,5.00,120),(1004,2,'A',FALSE,0.00,300),
(1004,3,'C',TRUE,5.00,450),(1004,4,'B',FALSE,0.00,600);

-- Attempt 1005: Nikhil (10/10 = 50 — flagged)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1005,1,'B',TRUE,5.00,12),(1005,2,'B',TRUE,5.00,10),(1005,3,'C',TRUE,5.00,9),
(1005,4,'C',TRUE,5.00,11),(1005,5,'B',TRUE,5.00,8),(1005,6,'D',TRUE,5.00,10),
(1005,7,'C',TRUE,5.00,13),(1005,8,'D',TRUE,5.00,9),(1005,9,'A',TRUE,5.00,11),
(1005,10,'B',TRUE,5.00,7);

-- Attempt 1006: Ananya (7/10 = 35)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1006,1,'B',TRUE,5.00,40),(1006,2,'B',TRUE,5.00,35),(1006,3,'C',TRUE,5.00,30),
(1006,4,'A',FALSE,0.00,60),(1006,5,'B',TRUE,5.00,55),(1006,6,'D',TRUE,5.00,28),
(1006,7,'A',FALSE,0.00,90),(1006,8,'D',TRUE,5.00,25),(1006,9,'B',FALSE,0.00,50),
(1006,10,'B',TRUE,5.00,22);

-- Attempt 1007: Rohan (6/10 = 30)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1007,1,'A',FALSE,0.00,50),(1007,2,'B',TRUE,5.00,45),(1007,3,'C',TRUE,5.00,40),
(1007,4,'C',TRUE,5.00,65),(1007,5,'A',FALSE,0.00,70),(1007,6,'D',TRUE,5.00,30),
(1007,7,'A',FALSE,0.00,100),(1007,8,'D',TRUE,5.00,35),(1007,9,'C',FALSE,0.00,60),
(1007,10,'B',TRUE,5.00,30);

-- Attempt 1008: Sneha (8/10 = 40)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1008,1,'B',TRUE,5.00,32),(1008,2,'B',TRUE,5.00,28),(1008,3,'C',TRUE,5.00,25),
(1008,4,'C',TRUE,5.00,50),(1008,5,'B',TRUE,5.00,55),(1008,6,'D',TRUE,5.00,22),
(1008,7,'C',TRUE,5.00,80),(1008,8,'B',FALSE,0.00,20),(1008,9,'A',TRUE,5.00,70),
(1008,10,'A',FALSE,0.00,18);

-- Attempt 1009: Aditya (5/10 = 25)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1009,1,'B',TRUE,5.00,45),(1009,2,'A',FALSE,0.00,60),(1009,3,'C',TRUE,5.00,38),
(1009,4,'A',FALSE,0.00,80),(1009,5,'C',FALSE,0.00,90),(1009,6,'D',TRUE,5.00,35),
(1009,7,'B',FALSE,0.00,110),(1009,8,'D',TRUE,5.00,30),(1009,9,'A',TRUE,5.00,85),
(1009,10,'A',FALSE,0.00,25);

-- Attempt 1010: Kavya (3/10 = 15)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1010,1,'A',FALSE,0.00,60),(1010,2,'C',FALSE,0.00,75),(1010,3,'C',TRUE,5.00,50),
(1010,4,'A',FALSE,0.00,90),(1010,5,'A',FALSE,0.00,100),(1010,6,'B',FALSE,0.00,40),
(1010,7,'A',FALSE,0.00,120),(1010,8,'D',TRUE,5.00,35),(1010,9,'B',FALSE,0.00,95),
(1010,10,'B',TRUE,5.00,30);


-- ============================================================
-- STUDENT ANSWERS — Exam 2
-- ============================================================
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
-- 1011 Arjun 9/10=18
(1011,11,'C',TRUE,2.00,40),(1011,12,'C',TRUE,2.00,30),(1011,13,'C',TRUE,2.00,45),
(1011,14,'B',TRUE,2.00,25),(1011,15,'B',TRUE,2.00,20),(1011,16,'B',TRUE,2.00,35),
(1011,17,'C',TRUE,2.00,55),(1011,18,'C',TRUE,2.00,18),(1011,19,'C',TRUE,2.00,60),
(1011,20,'A',FALSE,0.00,22),
-- 1012 Priya 8/10=16
(1012,11,'C',TRUE,2.00,38),(1012,12,'C',TRUE,2.00,32),(1012,13,'B',FALSE,0.00,50),
(1012,14,'B',TRUE,2.00,28),(1012,15,'B',TRUE,2.00,22),(1012,16,'B',TRUE,2.00,40),
(1012,17,'C',TRUE,2.00,60),(1012,18,'C',TRUE,2.00,20),(1012,19,'C',TRUE,2.00,65),
(1012,20,'B',TRUE,2.00,25),
-- 1013 Ravi 7/10=14
(1013,11,'C',TRUE,2.00,20),(1013,12,'C',TRUE,2.00,15),(1013,13,'C',TRUE,2.00,22),
(1013,14,'B',TRUE,2.00,18),(1013,15,'B',TRUE,2.00,12),(1013,16,'A',FALSE,0.00,16),
(1013,17,'C',TRUE,2.00,25),(1013,18,'A',FALSE,0.00,14),(1013,19,'C',TRUE,2.00,20),
(1013,20,'C',FALSE,0.00,10),
-- 1014 Isha 5/10=10
(1014,11,'C',TRUE,2.00,55),(1014,12,'C',TRUE,2.00,48),(1014,13,'A',FALSE,0.00,70),
(1014,14,'B',TRUE,2.00,40),(1014,15,'A',FALSE,0.00,55),(1014,16,'B',TRUE,2.00,60),
(1014,17,'A',FALSE,0.00,80),(1014,18,'C',TRUE,2.00,35),(1014,19,'B',FALSE,0.00,75),
(1014,20,'C',FALSE,0.00,45),
-- 1015 Nikhil 6/10=12
(1015,11,'C',TRUE,2.00,30),(1015,12,'C',TRUE,2.00,25),(1015,13,'C',TRUE,2.00,35),
(1015,14,'A',FALSE,0.00,28),(1015,15,'B',TRUE,2.00,20),(1015,16,'B',TRUE,2.00,32),
(1015,17,'B',FALSE,0.00,45),(1015,18,'C',TRUE,2.00,22),(1015,19,'B',FALSE,0.00,40),
(1015,20,'A',FALSE,0.00,18),
-- 1016 Ananya 10/10=20 (perfect)
(1016,11,'C',TRUE,2.00,35),(1016,12,'C',TRUE,2.00,28),(1016,13,'C',TRUE,2.00,42),
(1016,14,'B',TRUE,2.00,22),(1016,15,'B',TRUE,2.00,18),(1016,16,'B',TRUE,2.00,30),
(1016,17,'C',TRUE,2.00,50),(1016,18,'C',TRUE,2.00,15),(1016,19,'C',TRUE,2.00,55),
(1016,20,'B',TRUE,2.00,20),
-- 1017 Rohan 4/10=8 (failed)
(1017,11,'A',FALSE,0.00,60),(1017,12,'C',TRUE,2.00,55),(1017,13,'B',FALSE,0.00,80),
(1017,14,'B',TRUE,2.00,45),(1017,15,'A',FALSE,0.00,65),(1017,16,'A',FALSE,0.00,70),
(1017,17,'C',TRUE,2.00,90),(1017,18,'C',TRUE,2.00,40),(1017,19,'B',FALSE,0.00,85),
(1017,20,'A',FALSE,0.00,50),
-- 1018 Sneha 7/10=14
(1018,11,'C',TRUE,2.00,38),(1018,12,'C',TRUE,2.00,30),(1018,13,'C',TRUE,2.00,44),
(1018,14,'B',TRUE,2.00,25),(1018,15,'A',FALSE,0.00,22),(1018,16,'B',TRUE,2.00,35),
(1018,17,'C',TRUE,2.00,52),(1018,18,'A',FALSE,0.00,18),(1018,19,'C',TRUE,2.00,58),
(1018,20,'A',FALSE,0.00,20),
-- 1019 Aditya 8/10=16
(1019,11,'C',TRUE,2.00,36),(1019,12,'C',TRUE,2.00,29),(1019,13,'C',TRUE,2.00,43),
(1019,14,'B',TRUE,2.00,24),(1019,15,'B',TRUE,2.00,19),(1019,16,'B',TRUE,2.00,33),
(1019,17,'C',TRUE,2.00,51),(1019,18,'C',TRUE,2.00,16),(1019,19,'B',FALSE,0.00,56),
(1019,20,'A',FALSE,0.00,21),
-- 1020 Kavya 9/10=18
(1020,11,'C',TRUE,2.00,34),(1020,12,'C',TRUE,2.00,27),(1020,13,'C',TRUE,2.00,41),
(1020,14,'B',TRUE,2.00,23),(1020,15,'B',TRUE,2.00,17),(1020,16,'B',TRUE,2.00,31),
(1020,17,'C',TRUE,2.00,49),(1020,18,'C',TRUE,2.00,14),(1020,19,'C',TRUE,2.00,53),
(1020,20,'A',FALSE,0.00,19);


-- ============================================================
-- STUDENT ANSWERS — Exam 3 (partial, in-progress)
-- ============================================================
-- 2001 Arjun answered 5 (clean, normal pace ~80s each)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2001,21,'B',FALSE,0.00,85),(2001,22,'B',TRUE,10.00,72),(2001,23,'D',TRUE,10.00,90),
(2001,24,'B',TRUE,10.00,78),(2001,25,'C',TRUE,10.00,65);

-- 2002 Priya answered 4
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2002,21,'B',FALSE,0.00,95),(2002,22,'B',TRUE,10.00,88),(2002,23,'C',FALSE,0.00,110),
(2002,24,'B',TRUE,10.00,82);

-- 2003 Ravi answered 8 (suspiciously fast, 5–9 seconds each)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2003,21,'B',FALSE,0.00,7),(2003,22,'B',TRUE,10.00,5),(2003,23,'D',TRUE,10.00,8),
(2003,24,'B',TRUE,10.00,6),(2003,25,'C',TRUE,10.00,5),(2003,26,'B',TRUE,10.00,9),
(2003,27,'A',TRUE,10.00,6),(2003,28,'C',TRUE,10.00,7);

-- 2004 Isha answered 3
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2004,21,'A',FALSE,0.00,120),(2004,22,'B',TRUE,10.00,180),(2004,23,'D',TRUE,10.00,240);

-- 2005 Nikhil answered 6
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2005,21,'B',FALSE,0.00,9),(2005,22,'B',TRUE,10.00,8),(2005,23,'D',TRUE,10.00,11),
(2005,24,'B',TRUE,10.00,7),(2005,25,'C',TRUE,10.00,9),(2005,26,'B',TRUE,10.00,6);

-- 2006 Ananya answered 7
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2006,21,'B',FALSE,0.00,88),(2006,22,'B',TRUE,10.00,75),(2006,23,'D',TRUE,10.00,92),
(2006,24,'B',TRUE,10.00,80),(2006,25,'C',TRUE,10.00,68),(2006,26,'B',TRUE,10.00,85),
(2006,27,'A',TRUE,10.00,70);

-- 2007 Rohan answered 2
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2007,21,'A',FALSE,0.00,150),(2007,22,'B',TRUE,10.00,200);


-- ============================================================
-- PROCTOR LOGS
-- ============================================================

-- ── Exam 1 logs ──────────────────────────────────────────────
INSERT INTO ProctorLogs (attempt_id,event_type,severity,event_details,logged_at,ip_address) VALUES
(1001,'EXAM_STARTED','INFO','Exam started normally.','2025-11-10 09:05:00','192.168.1.101'),
(1001,'EXAM_SUBMITTED','INFO','Student submitted. Score: 45/50.','2025-11-10 09:52:00','192.168.1.101'),

(1003,'EXAM_STARTED','INFO','Exam started.','2025-11-10 09:08:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #1 detected.','2025-11-10 09:09:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #2 detected.','2025-11-10 09:11:00','192.168.1.103'),
(1003,'COPY_PASTE_DETECTED','HIGH','Ctrl+V in answer field.','2025-11-10 09:13:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #3 detected.','2025-11-10 09:15:00','192.168.1.103'),
(1003,'FULLSCREEN_EXIT','MEDIUM','Student exited fullscreen.','2025-11-10 09:17:00','192.168.1.103'),
(1003,'COPY_PASTE_DETECTED','HIGH','Paste on Q5.','2025-11-10 09:20:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #4.','2025-11-10 09:22:00','192.168.1.103'),
(1003,'RAPID_ANSWERING','HIGH','All 10 answers in under 70 seconds (avg 7s/Q).','2025-11-10 09:24:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #5.','2025-11-10 09:30:00','192.168.1.103'),
(1003,'COPY_PASTE_DETECTED','HIGH','Paste on Q8.','2025-11-10 09:35:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #6 — exceeded 5-switch limit.','2025-11-10 09:38:00','192.168.1.103'),
(1003,'COPY_PASTE_DETECTED','HIGH','Paste on Q9.','2025-11-10 09:40:00','192.168.1.103'),
(1003,'COPY_PASTE_DETECTED','HIGH','Paste on Q10.','2025-11-10 09:42:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #7.','2025-11-10 09:45:00','192.168.1.103'),
(1003,'TAB_SWITCH','MEDIUM','Tab switch #8.','2025-11-10 09:50:00','192.168.1.103'),
(1003,'EXAM_SUBMITTED','INFO','Exam submitted. Score: 50/50.','2025-11-10 10:02:00','192.168.1.103'),

(1005,'EXAM_STARTED','INFO','Exam started.','2025-11-10 09:20:00','10.0.0.50'),
(1005,'FACE_NOT_DETECTED','MEDIUM','Face not visible for 30 seconds.','2025-11-10 09:22:00','10.0.0.50'),
(1005,'MULTIPLE_LOGIN_DETECTED','CRITICAL','Second session from IP 10.0.0.99.','2025-11-10 09:25:00','10.0.0.99'),
(1005,'DEVTOOLS_OPENED','HIGH','Browser DevTools opened.','2025-11-10 09:28:00','10.0.0.50'),
(1005,'MULTIPLE_FACES_DETECTED','HIGH','2 faces visible in camera frame.','2025-11-10 09:30:00','10.0.0.50'),
(1005,'TAB_SWITCH','MEDIUM','Tab switch detected.','2025-11-10 09:32:00','10.0.0.50'),
(1005,'IP_ADDRESS_CHANGED','CRITICAL','IP changed: 10.0.0.50 → 10.0.1.5.','2025-11-10 09:40:00','10.0.1.5'),
(1005,'EXAM_SUBMITTED','INFO','Exam submitted. Score: 50/50.','2025-11-10 10:01:00','10.0.1.5'),

(1004,'EXAM_STARTED','INFO','Exam started.','2025-11-10 09:15:00','192.168.1.104'),
(1004,'FACE_NOT_DETECTED','MEDIUM','Face not detected for 60 seconds.','2025-11-10 09:30:00','192.168.1.104'),
(1004,'FACE_NOT_DETECTED','MEDIUM','Student may have stepped away.','2025-11-10 09:55:00','192.168.1.104'),
(1004,'IDLE_WARNING','LOW','No interaction for 5 minutes.','2025-11-10 10:05:00','192.168.1.104'),
(1004,'AUTO_SUBMITTED','INFO','Auto-submitted: time limit reached.','2025-11-10 10:15:00','192.168.1.104');


-- ── Exam 3 LIVE logs ──────────────────────────────────────────
INSERT INTO ProctorLogs (attempt_id,event_type,severity,event_details,logged_at,ip_address) VALUES
(2001,'EXAM_STARTED','INFO','Exam started normally.','2026-03-13 09:15:00','192.168.1.101'),

(2002,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:10:00','192.168.1.102'),
(2002,'FULLSCREEN_EXIT','MEDIUM','Exited fullscreen mode.','2026-03-13 09:18:00','192.168.1.102'),
(2002,'TAB_SWITCH','MEDIUM','Tab switch #1 detected.','2026-03-13 09:22:00','192.168.1.102'),
(2002,'TAB_SWITCH','MEDIUM','Tab switch #2 detected.','2026-03-13 09:30:00','192.168.1.102'),

(2003,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:05:00','192.168.1.103'),
(2003,'TAB_SWITCH','MEDIUM','Tab switch #1.','2026-03-13 09:06:00','192.168.1.103'),
(2003,'COPY_PASTE_DETECTED','HIGH','Paste detected on Q1.','2026-03-13 09:07:00','192.168.1.103'),
(2003,'TAB_SWITCH','MEDIUM','Tab switch #2.','2026-03-13 09:08:00','192.168.1.103'),
(2003,'COPY_PASTE_DETECTED','HIGH','Paste detected on Q3.','2026-03-13 09:09:00','192.168.1.103'),
(2003,'TAB_SWITCH','MEDIUM','Tab switch #3.','2026-03-13 09:10:00','192.168.1.103'),
(2003,'RAPID_ANSWERING','HIGH','8 questions answered in under 65 seconds.','2026-03-13 09:11:00','192.168.1.103'),
(2003,'TAB_SWITCH','MEDIUM','Tab switch #4.','2026-03-13 09:12:00','192.168.1.103'),
(2003,'COPY_PASTE_DETECTED','HIGH','Paste on Q5.','2026-03-13 09:13:00','192.168.1.103'),
(2003,'TAB_SWITCH','MEDIUM','Tab switch #5 — threshold exceeded.','2026-03-13 09:14:00','192.168.1.103'),
(2003,'FULLSCREEN_EXIT','MEDIUM','Exited fullscreen.','2026-03-13 09:15:00','192.168.1.103'),
(2003,'COPY_PASTE_DETECTED','HIGH','Paste on Q7.','2026-03-13 09:16:00','192.168.1.103'),
(2003,'TAB_SWITCH','HIGH','Tab switch #6 — auto-flagged.','2026-03-13 09:17:00','192.168.1.103'),

(2004,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:08:00','192.168.1.104'),
(2004,'FACE_NOT_DETECTED','MEDIUM','Face not detected for 45 seconds.','2026-03-13 09:15:00','192.168.1.104'),
(2004,'FACE_NOT_DETECTED','MEDIUM','Face absent again — 60 seconds.','2026-03-13 09:25:00','192.168.1.104'),
(2004,'IDLE_WARNING','LOW','No interaction for 3 minutes.','2026-03-13 09:28:00','192.168.1.104'),
(2004,'FACE_NOT_DETECTED','HIGH','Face not detected third time — proctor alert raised.','2026-03-13 09:35:00','192.168.1.104'),

(2005,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:12:00','10.0.0.51'),
(2005,'DEVTOOLS_OPENED','HIGH','Browser DevTools opened within 2 minutes of start.','2026-03-13 09:14:00','10.0.0.51'),
(2005,'MULTIPLE_LOGIN_DETECTED','CRITICAL','Second active session from IP 10.0.0.200.','2026-03-13 09:16:00','10.0.0.200'),
(2005,'MULTIPLE_FACES_DETECTED','HIGH','2 faces detected in camera — possible accomplice.','2026-03-13 09:18:00','10.0.0.51'),
(2005,'TAB_SWITCH','MEDIUM','Tab switch #1.','2026-03-13 09:19:00','10.0.0.51'),
(2005,'RIGHT_CLICK_ATTEMPT','LOW','Right-click attempted on question text.','2026-03-13 09:20:00','10.0.0.51'),
(2005,'IP_ADDRESS_CHANGED','CRITICAL','IP changed: 10.0.0.51 → 10.0.1.10.','2026-03-13 09:22:00','10.0.1.10'),
(2005,'RAPID_ANSWERING','HIGH','6 answers in under 60 seconds (avg 9s/Q).','2026-03-13 09:23:00','10.0.1.10'),

(2006,'EXAM_STARTED','INFO','Exam started normally.','2026-03-13 09:20:00','192.168.1.106'),

(2007,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:18:00','192.168.1.107'),
(2007,'TAB_SWITCH','LOW','Tab switch #1 detected.','2026-03-13 09:26:00','192.168.1.107');


-- ============================================================
-- SUSPICION FLAGS
-- ============================================================
INSERT INTO SuspicionFlags (attempt_id,flag_type,description,detected_at,is_resolved,resolved_by,resolved_at,resolution_notes)
VALUES
-- Exam 1 flags
(1003,'EXCESSIVE_TAB_SWITCHES','Student switched tabs 10 times (limit 5). Combined with rapid answering.','2025-11-10 09:38:00',FALSE,NULL,NULL,NULL),
(1003,'COPY_PASTE_ABUSE','Copy-paste detected 5 times during 50-minute exam.','2025-11-10 09:45:00',FALSE,NULL,NULL,NULL),
(1003,'RAPID_ANSWERING','All 10 questions answered in ~70 seconds. Average 7s/Q.','2025-11-10 09:24:00',FALSE,NULL,NULL,NULL),

(1005,'MULTIPLE_LOGINS','Two active sessions from different IPs (10.0.0.50 and 10.0.0.99).','2025-11-10 09:25:00',TRUE,4,'2025-11-10 14:00:00','Verified with student. Second device belonged to family member. Grade under review.'),
(1005,'HIGH_SUSPICION_SCORE','Suspicion score 91/100 — multiple critical events.','2025-11-10 09:40:00',FALSE,NULL,NULL,NULL),
(1005,'IP_CHANGE_DURING_EXAM','IP changed mid-exam: 10.0.0.50 → 10.0.1.5. Possible mobile hotspot switch.','2025-11-10 09:40:00',FALSE,NULL,NULL,NULL),

-- Exam 3 LIVE flags (unresolved)
(2003,'EXCESSIVE_TAB_SWITCHES','10 tab switches during live exam. Threshold exceeded at switch 6.','2026-03-13 09:17:00',FALSE,NULL,NULL,NULL),
(2003,'COPY_PASTE_ABUSE','5 paste events in first 15 minutes.','2026-03-13 09:13:00',FALSE,NULL,NULL,NULL),
(2003,'RAPID_ANSWERING','8 answers in ~65 seconds — avg 8s/Q.','2026-03-13 09:11:00',FALSE,NULL,NULL,NULL),

(2005,'MULTIPLE_LOGINS','Second session from 10.0.0.200 while exam in progress.','2026-03-13 09:16:00',FALSE,NULL,NULL,NULL),
(2005,'HIGH_SUSPICION_SCORE','Score 90/100 — DevTools, multiple logins, IP change, rapid answers.','2026-03-13 09:23:00',FALSE,NULL,NULL,NULL),
(2005,'IP_CHANGE_DURING_EXAM','IP changed from 10.0.0.51 to 10.0.1.10 during live exam.','2026-03-13 09:22:00',FALSE,NULL,NULL,NULL);


-- ============================================================
-- LOGIN SESSIONS
-- ============================================================
INSERT INTO LoginSessions (session_id,user_id,login_time,logout_time,ip_address,device_fingerprint,session_token,is_active)
VALUES
-- Historical sessions
(1,  6, '2025-11-10 09:00:00','2025-11-10 10:10:00','192.168.1.101','FP-ARJUN-WIN11','tok_arjun_exam1',FALSE),
(2,  8, '2025-11-10 09:05:00','2025-11-10 10:10:00','192.168.1.103','FP-RAVI-WIN10', 'tok_ravi_exam1', FALSE),
(3,  10,'2025-11-10 09:15:00',NULL,                 '10.0.0.50',   'FP-NIKHIL-LIN', 'tok_nikhil_exam1',TRUE),
(4,  10,'2025-11-10 09:24:00','2025-11-10 09:26:00','10.0.0.99',   'FP-NIKHIL-PHONE','tok_nikhil_2nd',FALSE),
-- Live exam sessions (today)
(5,  6, '2026-03-13 09:10:00',NULL,'192.168.1.101','FP-ARJUN-WIN11',  'tok_arjun_live',  TRUE),
(6,  7, '2026-03-13 09:05:00',NULL,'192.168.1.102','FP-PRIYA-WIN11',  'tok_priya_live',  TRUE),
(7,  8, '2026-03-13 09:00:00',NULL,'192.168.1.103','FP-RAVI-WIN10',   'tok_ravi_live',   TRUE),
(8,  9, '2026-03-13 09:03:00',NULL,'192.168.1.104','FP-ISHA-MAC',     'tok_isha_live',   TRUE),
(9,  10,'2026-03-13 09:07:00',NULL,'10.0.0.51',   'FP-NIKHIL-LIN',   'tok_nikhil_live', TRUE),
(10, 10,'2026-03-13 09:16:00',NULL,'10.0.0.200',  'FP-NIKHIL-PHONE', 'tok_nikhil_2nd2', TRUE),  -- suspicious!
(11, 11,'2026-03-13 09:15:00',NULL,'192.168.1.106','FP-ANANYA-WIN11', 'tok_ananya_live', TRUE),
(12, 12,'2026-03-13 09:13:00',NULL,'192.168.1.107','FP-ROHAN-WIN11',  'tok_rohan_live',  TRUE),
(13, 4, '2026-03-13 09:00:00',NULL,'192.168.10.1', 'FP-PROCTOR-PC',   'tok_proctor_live',TRUE);


SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- Quick sanity check
-- ============================================================
SELECT 'Users'         AS entity, COUNT(*) AS row_count FROM Users         UNION ALL
SELECT 'Courses',        COUNT(*) FROM Courses                         UNION ALL
SELECT 'Exams',          COUNT(*) FROM Exams                           UNION ALL
SELECT 'Questions',      COUNT(*) FROM Questions                       UNION ALL
SELECT 'ExamAttempts',   COUNT(*) FROM ExamAttempts                    UNION ALL
SELECT 'StudentAnswers', COUNT(*) FROM StudentAnswers                  UNION ALL
SELECT 'ProctorLogs',    COUNT(*) FROM ProctorLogs                     UNION ALL
SELECT 'SuspicionFlags', COUNT(*) FROM SuspicionFlags                  UNION ALL
SELECT 'LoginSessions',  COUNT(*) FROM LoginSessions;
