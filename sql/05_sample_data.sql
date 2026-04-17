-- ExamGuard — Seed Data  (run AFTER 01_schema.sql)
-- 1 Admin · 2 Teachers · 1 DemoTeacher (demoprof) · 10 Students · 1 DemoStudent
-- Courses: CS301 DBMS · CS201 DSA · CS401 AI (demo)
-- Exams  : E1/E2 past · E3/E6 live · E4/E7 upcoming · E5 past-demo
-- Re-run 03_triggers.sql AFTER this file to restore live triggers.

USE ExamProctor;
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE SuspicionFlags; TRUNCATE TABLE ProctorLogs;
TRUNCATE TABLE StudentAnswers; TRUNCATE TABLE ExamAttempts;
TRUNCATE TABLE LoginSessions;  TRUNCATE TABLE UserRoles;
TRUNCATE TABLE Questions;      TRUNCATE TABLE Exams;
TRUNCATE TABLE Enrollments;    TRUNCATE TABLE Courses; TRUNCATE TABLE Users;

-- Drop triggers — required for historical back-dated inserts
DROP TRIGGER IF EXISTS trg_validate_exam_start;
DROP TRIGGER IF EXISTS trg_check_time_on_answer;
DROP TRIGGER IF EXISTS trg_auto_grade_answer;
DROP TRIGGER IF EXISTS trg_update_suspicion_score;
DROP TRIGGER IF EXISTS trg_auto_flag_suspicious;
DROP TRIGGER IF EXISTS trg_log_exam_submission;
DROP TRIGGER IF EXISTS trg_detect_multiple_logins;

-- ── USERS ──────────────────────────────────────────────────────
-- username     password        role
-- admin        Admin@2025      admin
-- profsharma   Sharma#Prof1    teacher
-- profnair     Nair#Prof2      teacher
-- demoprof     Demo#Prof1      teacher  ← demo: instructor + proctor
-- arjunk       Arjun@123       student
-- priyam       Priya@456       student
-- ravis        Ravi@789        student
-- ishat        Isha@321        student
-- nikhild      Nikhil@654      student
-- ananyab      Ananya@987      student
-- rohanp       Rohan@111       student
-- snehar       Sneha@222       student
-- adityaj      Aditya@333      student
-- kavyan       Kavya@444       student
-- demostudent  Demo@Stu1       student  ← demo: flagged/submitted/timed_out/live
INSERT INTO Users (user_id,email,password_hash,full_name,role,phone_number,username) VALUES
(1, 'admin@examguard.edu',       'sha256:fcf7bb6d546cfb82d2e55486984ae7a1862a666acb441e0cf8b4ed34a4fcf9d7','System Admin',       'admin',  '9000000001','admin'),
(2, 'prof.sharma@examguard.edu', 'sha256:5a5fda16b3cc1ed1ca6202c077e56c139b7558a7fff8e92b436c940f7098ba19','Prof. Anil Sharma',  'teacher','9000000002','profsharma'),
(3, 'prof.nair@examguard.edu',   'sha256:3bb9bded22d4c7276a61a9ac2c6cb5b11747e7fc22041a004d36716858abd621','Prof. Meera Nair',   'teacher','9000000003','profnair'),
(6, 'arjun.k@student.edu',       'sha256:255ea3b51c4ca0814a74e3c1a2392fcf20edeeabcd1b1e6bbc705dde02686ebb','Arjun Kumar',        'student','9111111101','arjunk'),
(7, 'priya.m@student.edu',       'sha256:f060b432989eb45d741857dd316f4253dd08ae018fa0f5501e465bca056d576b','Priya Menon',        'student','9111111102','priyam'),
(8, 'ravi.s@student.edu',        'sha256:9b112f399f26c2520d36ee19a21a721ccad9e9bb2ef5705832b3cd99604f7d64','Ravi Shankar',       'student','9111111103','ravis'),
(9, 'isha.t@student.edu',        'sha256:cec7808ac6242f66945b859b3abe4c8f361e2e9c37e25c4bb14d2956cbf34245','Isha Trivedi',       'student','9111111104','ishat'),
(10,'nikhil.d@student.edu',      'sha256:915de23da05f396d601fbfcb26273414871f5d3d9c5c0d0dc8de5dac80ddb262','Nikhil Desai',       'student','9111111105','nikhild'),
(11,'ananya.b@student.edu',      'sha256:9ab5a9255bd28d604fd00884535ef8ea537e2ca5944454a613a315dfd0077ca3','Ananya Bose',        'student','9111111106','ananyab'),
(12,'rohan.p@student.edu',       'sha256:9e38e6ff4249c37dc883c43f3c457109c83f43752856df02235628199c81acf0','Rohan Patel',        'student','9111111107','rohanp'),
(13,'sneha.r@student.edu',       'sha256:40052b96694b02a89aad77fd4ac85a65c3c48b58ad9f2e189a1ef6752b8ff4b7','Sneha Reddy',        'student','9111111108','snehar'),
(14,'aditya.j@student.edu',      'sha256:b4dbd140c0c1baa60cd4fa75fc6f458e4feb6aea795175c69a0fac91c1bfae97','Aditya Joshi',       'student','9111111109','adityaj'),
(15,'kavya.n@student.edu',       'sha256:0eae0481abd972d7062db93cd1e217d83613a0e2d8922665a9deeb764099cbe7','Kavya Nair',         'student','9111111110','kavyan'),
(20,'demo.prof@examguard.edu',   'sha256:1e123d4ab3c2396c747ce32b8ffeacf55e78dcdbfb4a1a386a056a8a151f1a81','Dr. Demo Professor', 'teacher','9000000020','demoprof'),
(21,'demo.student@student.edu',  'sha256:76b1892b25a22a01964959e7f698131b0a4e0b0f97a51e869dbaa0d295be3d6a','Demo Student',       'student','9111111120','demostudent');


-- ── COURSES ────────────────────────────────────────────────────
INSERT INTO Courses (course_id,course_code,course_name,description,instructor_id) VALUES
(1,'CS301','Database Management Systems','Covers relational model, SQL, transactions, normalization, and NoSQL.',2),
(2,'CS201','Data Structures & Algorithms','Arrays, linked lists, trees, graphs, sorting and searching algorithms.',3),
(3,'CS401','Artificial Intelligence','Search algorithms, ML basics, neural networks, NLP, and Bayesian reasoning.',20);


-- ── ENROLLMENTS ────────────────────────────────────────────────
INSERT INTO Enrollments (student_id,course_id,status) VALUES
(6,1,'active'),(7,1,'active'),(8,1,'active'),(9,1,'active'),(10,1,'active'),
(11,1,'active'),(12,1,'active'),(13,1,'active'),(14,1,'active'),(15,1,'active'),
(6,2,'active'),(7,2,'active'),(8,2,'active'),(9,2,'active'),(10,2,'active'),
(11,2,'active'),(12,2,'active'),(13,2,'active'),(14,2,'active'),(15,2,'active'),
(21,1,'active'),(21,3,'active'),
(6,3,'active'),(7,3,'active'),(8,3,'active'),(9,3,'active'),(10,3,'active');


-- ── EXAMS ──────────────────────────────────────────────────────
-- E1/E2: past (closed) · E3: live DBMS · E4: upcoming DSA
-- E5: past AI (demo)  · E6: live AI  · E7: upcoming AI
INSERT INTO Exams (exam_id,course_id,title,total_marks,passing_marks,duration_minutes,
    window_start,window_end,created_by,is_published,max_attempts,shuffle_questions,show_results_immediately,join_code) VALUES
(1,1,'DBMS Mid-Term Examination',       50.00,25.00, 60,'2025-11-10 09:00:00','2025-11-10 12:00:00',2,TRUE,1,TRUE, FALSE,NULL),
(2,2,'DSA Weekly Quiz - Trees & Graphs',20.00,10.00, 30,'2025-11-15 14:00:00','2025-11-15 16:00:00',3,TRUE,1,FALSE,TRUE, NULL),
(3,1,'DBMS End-Term Examination',      100.00,50.00,120,'2026-03-13 08:00:00','2026-05-31 23:59:59',2,TRUE,1,TRUE, FALSE,'DB2026'),
(4,2,'DSA Unit Test - Sorting Algorithms',30.00,15.00,45,'2027-01-10 10:00:00','2027-01-10 12:00:00',3,TRUE,1,FALSE,FALSE,NULL),
(5,3,'AI Mid-Term Examination',         50.00,25.00, 60,'2025-12-10 09:00:00','2025-12-10 12:00:00',20,TRUE,2,TRUE, FALSE,NULL),
(6,3,'AI End-Term Examination',        100.00,50.00,120,'2026-03-01 08:00:00','2026-05-31 23:59:59',20,TRUE,1,TRUE, FALSE,'AI2026'),
(7,3,'AI Unit Test - Neural Networks',  30.00,15.00, 45,'2027-06-01 10:00:00','2027-06-01 12:00:00',20,TRUE,1,FALSE,FALSE,NULL);


-- ── QUESTIONS — Exam 1: DBMS Mid-Term (10 MCQ × 5 marks) ──────
INSERT INTO Questions (question_id,exam_id,question_text,question_type,marks,
    option_a,option_b,option_c,option_d,correct_answer,difficulty_level,order_index) VALUES
(1, 1,'Which normal form eliminates partial dependencies?',
 'MCQ',5.00,'First Normal Form','Second Normal Form','Third Normal Form','BCNF','B','easy',1),
(2, 1,'A foreign key constraint ensures ___.',
 'MCQ',5.00,'Uniqueness of values','Referential integrity','Atomicity of transactions','Index creation','B','easy',2),
(3, 1,'Which SQL clause is used to filter groups?',
 'MCQ',5.00,'WHERE','ORDER BY','HAVING','GROUP BY','C','easy',3),
(4, 1,'A relation is in BCNF if for every FD X→Y, X is a ___.',
 'MCQ',5.00,'Primary key','Candidate key','Super key','Foreign key','C','medium',4),
(5, 1,'What isolation level prevents dirty reads but allows non-repeatable reads?',
 'MCQ',5.00,'READ UNCOMMITTED','READ COMMITTED','REPEATABLE READ','SERIALIZABLE','B','medium',5),
(6, 1,'Which join returns all rows from the left table and matched rows from the right?',
 'MCQ',5.00,'INNER JOIN','RIGHT JOIN','FULL OUTER JOIN','LEFT JOIN','D','easy',6),
(7, 1,'Two-phase locking guarantees ___.',
 'MCQ',5.00,'Atomicity','Durability','Serializability','Consistency','C','hard',7),
(8, 1,'The ACID property that ensures transactions survive crashes is ___.',
 'MCQ',5.00,'Atomicity','Consistency','Isolation','Durability','D','easy',8),
(9, 1,'A deadlock can be prevented using ___.',
 'MCQ',5.00,'Consistent lock ordering','Random lock ordering','Disabling transactions','Using READ UNCOMMITTED','A','hard',9),
(10,1,'Which command permanently removes a transaction''s changes?',
 'MCQ',5.00,'COMMIT','ROLLBACK','SAVEPOINT','RELEASE','B','easy',10);

-- ── QUESTIONS — Exam 2: DSA Quiz (10 MCQ × 2 marks) ──────────
INSERT INTO Questions (question_id,exam_id,question_text,question_type,marks,
    option_a,option_b,option_c,option_d,correct_answer,difficulty_level,order_index) VALUES
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

-- ── QUESTIONS — Exam 3: DBMS End-Term (10 MCQ × 10 marks) ─────
INSERT INTO Questions (question_id,exam_id,question_text,question_type,marks,
    option_a,option_b,option_c,option_d,correct_answer,difficulty_level,order_index) VALUES
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

-- ── QUESTIONS — Exam 5: AI Mid-Term (5 MCQ × 10 marks) ────────
INSERT INTO Questions (question_id,exam_id,question_text,question_type,marks,
    option_a,option_b,option_c,option_d,correct_answer,difficulty_level,order_index) VALUES
(31,5,'Which search algorithm is guaranteed to find the shortest path in an unweighted graph?',
 'MCQ',10.00,'Depth-First Search','Breadth-First Search','A* Search','Greedy Best-First','B','easy',1),
(32,5,'For A* to guarantee an optimal solution, the heuristic h(n) must be ___.',
 'MCQ',10.00,'Admissible only','Consistent only','Both admissible and consistent','Neither','C','hard',2),
(33,5,'Which of the following is a propositional logic connective?',
 'MCQ',10.00,'For all (∀)','There exists (∃)','Implies (→)','None of the above','C','medium',3),
(34,5,'The Minimax algorithm is primarily used in ___.',
 'MCQ',10.00,'Single-agent path finding','Adversarial game trees','Constraint satisfaction','Bayesian networks','B','medium',4),
(35,5,'A Bayesian network encodes ___ relationships among random variables.',
 'MCQ',10.00,'Linear correlation','Conditional independence','Temporal causation','Mutual exclusion','B','hard',5);

-- ── QUESTIONS — Exam 6: AI End-Term (5 MCQ × 20 marks) ────────
INSERT INTO Questions (question_id,exam_id,question_text,question_type,marks,
    option_a,option_b,option_c,option_d,correct_answer,difficulty_level,order_index) VALUES
(36,6,'In supervised learning, the model is trained on ___.',
 'MCQ',20.00,'Unlabelled data','Labelled input-output pairs','Reward signals','Cluster centroids','B','easy',1),
(37,6,'Which activation function is most commonly used in hidden layers of deep networks today?',
 'MCQ',20.00,'Sigmoid','Tanh','ReLU','Softmax','C','medium',2),
(38,6,'Backpropagation computes gradients using the ___ rule from calculus.',
 'MCQ',20.00,'Product rule','Chain rule','Quotient rule','Power rule','B','medium',3),
(39,6,'Which technique helps reduce overfitting in neural networks?',
 'MCQ',20.00,'Increasing model complexity','Removing all regularization','Dropout and L2 regularization','Maximising learning rate','C','hard',4),
(40,6,'In a Transformer model, ___ is used to weigh the relevance of each token.',
 'MCQ',20.00,'Convolution','Recurrence','Self-attention','Max-pooling','C','hard',5);


-- ── EXAM ATTEMPTS ──────────────────────────────────────────────
INSERT INTO ExamAttempts (attempt_id,exam_id,student_id,attempt_number,started_at,submitted_at,
    auto_submitted,score,percentage,status,suspicion_score,tab_switches,copy_paste_attempts,
    fullscreen_exits,ip_address,browser_info) VALUES
-- Exam 1 (completed)
(1001,1,6, 1,'2025-11-10 09:05:00','2025-11-10 09:52:00',FALSE,45.00,90.00,'submitted', 0, 0,0,0,'192.168.1.101','Chrome/120 Windows 11'),
(1002,1,7, 1,'2025-11-10 09:10:00','2025-11-10 09:58:00',FALSE,40.00,80.00,'submitted', 8, 1,0,1,'192.168.1.102','Firefox/121 Windows 11'),
(1003,1,8, 1,'2025-11-10 09:08:00','2025-11-10 10:02:00',FALSE,50.00,100.00,'flagged', 78,10,5,3,'192.168.1.103','Chrome/120 Windows 10'),
(1004,1,9, 1,'2025-11-10 09:15:00','2025-11-10 10:15:00',TRUE, 20.00,40.00,'timed_out', 3, 1,0,0,'192.168.1.104','Safari/17 macOS'),
(1005,1,10,1,'2025-11-10 09:20:00','2025-11-10 10:01:00',FALSE,50.00,100.00,'flagged', 55,13,6,5,'10.0.0.50','Chrome/120 Linux'),
(1006,1,11,1,'2025-11-10 09:12:00','2025-11-10 10:00:00',FALSE,35.00,70.00,'submitted', 0, 0,0,0,'192.168.1.106','Chrome/120 Windows 11'),
(1007,1,12,1,'2025-11-10 09:18:00','2025-11-10 10:05:00',FALSE,30.00,60.00,'submitted', 5, 0,1,0,'192.168.1.107','Edge/120 Windows 11'),
(1008,1,13,1,'2025-11-10 09:07:00','2025-11-10 09:55:00',FALSE,40.00,80.00,'submitted', 0, 0,0,0,'192.168.1.108','Firefox/121 Windows 11'),
(1009,1,14,1,'2025-11-10 09:22:00','2025-11-10 10:18:00',FALSE,25.00,50.00,'submitted',10, 2,0,1,'192.168.1.109','Chrome/120 Windows 10'),
(1010,1,15,1,'2025-11-10 09:30:00','2025-11-10 10:15:00',FALSE,15.00,30.00,'submitted', 0, 0,0,0,'192.168.1.110','Chrome/120 macOS'),
-- Exam 2 (completed)
(1011,2,6, 1,'2025-11-15 14:05:00','2025-11-15 14:27:00',FALSE,18.00,90.00,'submitted', 0,0,0,0,'192.168.1.101','Chrome/120 Windows 11'),
(1012,2,7, 1,'2025-11-15 14:08:00','2025-11-15 14:30:00',FALSE,16.00,80.00,'submitted', 3,0,0,0,'192.168.1.102','Firefox/121 Windows 11'),
(1013,2,8, 1,'2025-11-15 14:10:00','2025-11-15 14:35:00',FALSE,14.00,70.00,'submitted',20,3,1,1,'192.168.1.103','Chrome/120 Windows 10'),
(1014,2,9, 1,'2025-11-15 14:12:00','2025-11-15 14:42:00',FALSE,10.00,50.00,'submitted', 5,0,0,0,'192.168.1.104','Safari/17 macOS'),
(1015,2,10,1,'2025-11-15 14:06:00','2025-11-15 14:28:00',FALSE,12.00,60.00,'submitted', 0,0,0,0,'10.0.0.50','Chrome/120 Linux'),
(1016,2,11,1,'2025-11-15 14:03:00','2025-11-15 14:22:00',FALSE,20.00,100.00,'submitted',0,0,0,0,'192.168.1.106','Chrome/120 Windows 11'),
(1017,2,12,1,'2025-11-15 14:15:00','2025-11-15 14:45:00',FALSE, 8.00,40.00,'submitted', 7,1,0,0,'192.168.1.107','Edge/120 Windows 11'),
(1018,2,13,1,'2025-11-15 14:07:00','2025-11-15 14:32:00',FALSE,14.00,70.00,'submitted', 0,0,0,0,'192.168.1.108','Firefox/121 Windows 11'),
(1019,2,14,1,'2025-11-15 14:09:00','2025-11-15 14:31:00',FALSE,16.00,80.00,'submitted', 0,0,0,0,'192.168.1.109','Chrome/120 Windows 10'),
(1020,2,15,1,'2025-11-15 14:11:00','2025-11-15 14:26:00',FALSE,18.00,90.00,'submitted', 2,0,0,0,'192.168.1.110','Chrome/120 macOS'),
-- Exam 3 — timed-out (started March 13; auto-swept after 120-min window)
(2001,3,6, 1,'2026-03-13 09:15:00','2026-03-13 11:15:00',TRUE, 40.00,40.00,'timed_out',  0, 0,0,0,'192.168.1.101','Chrome/121 Windows 11'),
(2002,3,7, 1,'2026-03-13 09:10:00','2026-03-13 11:10:00',TRUE, 20.00,20.00,'timed_out', 18, 2,0,1,'192.168.1.102','Firefox/122 Windows 11'),
(2003,3,8, 1,'2026-03-13 09:05:00','2026-03-13 11:05:00',TRUE, 80.00,80.00,'flagged',   82,10,5,3,'192.168.1.103','Chrome/121 Windows 10'),
(2004,3,9, 1,'2026-03-13 09:08:00','2026-03-13 11:08:00',TRUE, 20.00,20.00,'timed_out',  5, 0,0,0,'192.168.1.104','Safari/17 macOS'),
(2005,3,10,1,'2026-03-13 09:12:00','2026-03-13 11:12:00',TRUE, 60.00,60.00,'flagged',   72,14,7,5,'10.0.0.51','Chrome/121 Linux'),
(2006,3,11,1,'2026-03-13 09:20:00','2026-03-13 11:20:00',TRUE, 60.00,60.00,'timed_out',  0, 0,0,0,'192.168.1.106','Chrome/121 Windows 11'),
(2007,3,12,1,'2026-03-13 09:18:00','2026-03-13 11:18:00',TRUE, 10.00,10.00,'timed_out', 10, 1,0,0,'192.168.1.107','Edge/121 Windows 11'),
-- Exam 3 — arjun completed attempt (submitted)
(2010,3,6, 2,'2026-04-02 10:00:00','2026-04-02 11:52:00',FALSE,80.00,80.00,'submitted', 4, 1,0,0,'192.168.1.101','Chrome/123 Windows 11'),
-- Exam 5 — AI Mid-Term (completed)
(3001,5,21,1,'2025-12-10 09:08:00','2025-12-10 09:42:00',FALSE,50.00,100.00,'flagged',  85, 9,4,3,'192.168.5.21','Chrome/121 Windows 11'),
(3002,5,21,2,'2025-12-10 10:30:00','2025-12-10 11:15:00',FALSE,30.00,60.00,'submitted',  5, 0,0,1,'192.168.5.21','Chrome/121 Windows 11'),
(3003,5,6, 1,'2025-12-10 09:05:00','2025-12-10 09:55:00',FALSE,45.00,90.00,'submitted',  0, 0,0,0,'192.168.1.101','Chrome/121 Windows 11'),
(3004,5,7, 1,'2025-12-10 09:10:00','2025-12-10 09:58:00',FALSE,40.00,80.00,'submitted',  6, 1,0,0,'192.168.1.102','Firefox/122 Windows 11'),
(3005,5,8, 1,'2025-12-10 09:08:00','2025-12-10 10:08:00',TRUE, 20.00,40.00,'timed_out',  2, 0,0,0,'192.168.1.103','Chrome/121 Windows 10'),
(3006,5,9, 1,'2025-12-10 09:15:00','2025-12-10 10:05:00',FALSE,30.00,60.00,'submitted',  4, 1,0,1,'192.168.1.104','Safari/17 macOS'),
(3007,5,10,1,'2025-12-10 09:20:00','2025-12-10 10:10:00',FALSE,50.00,100.00,'flagged',  72, 8,3,2,'10.0.0.50','Chrome/121 Linux'),
-- Exam 6 — AI End-Term (live, demostudent in_progress)
(3010,6,21,1,'2026-04-14 10:00:00',NULL,FALSE,NULL,NULL,'in_progress', 0, 0,0,0,'192.168.5.21','Chrome/124 Windows 11'),
-- Exam 3 — demostudent timed out
(3015,3,21,1,'2026-04-10 09:00:00','2026-04-10 11:00:00',TRUE,20.00,20.00,'timed_out',  3, 1,0,0,'192.168.5.21','Chrome/124 Windows 11');


-- ── STUDENT ANSWERS ────────────────────────────────────────────
-- Exam 1
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1001,1,'B',TRUE,5.00,30),(1001,2,'B',TRUE,5.00,25),(1001,3,'C',TRUE,5.00,20),
(1001,4,'C',TRUE,5.00,45),(1001,5,'B',TRUE,5.00,60),(1001,6,'D',TRUE,5.00,20),
(1001,7,'C',TRUE,5.00,90),(1001,8,'D',TRUE,5.00,20),(1001,9,'A',TRUE,5.00,80),(1001,10,'A',FALSE,0.00,15),
(1002,1,'B',TRUE,5.00,35),(1002,2,'B',TRUE,5.00,40),(1002,3,'C',TRUE,5.00,30),
(1002,4,'A',FALSE,0.00,55),(1002,5,'B',TRUE,5.00,50),(1002,6,'D',TRUE,5.00,25),
(1002,7,'C',TRUE,5.00,85),(1002,8,'D',TRUE,5.00,30),(1002,9,'B',FALSE,0.00,45),(1002,10,'B',TRUE,5.00,20),
(1003,1,'B',TRUE,5.00,6),(1003,2,'B',TRUE,5.00,5),(1003,3,'C',TRUE,5.00,4),
(1003,4,'C',TRUE,5.00,7),(1003,5,'B',TRUE,5.00,6),(1003,6,'D',TRUE,5.00,5),
(1003,7,'C',TRUE,5.00,8),(1003,8,'D',TRUE,5.00,4),(1003,9,'A',TRUE,5.00,6),(1003,10,'B',TRUE,5.00,5),
(1004,1,'B',TRUE,5.00,120),(1004,2,'A',FALSE,0.00,300),(1004,3,'C',TRUE,5.00,450),(1004,4,'B',FALSE,0.00,600),
(1005,1,'B',TRUE,5.00,12),(1005,2,'B',TRUE,5.00,10),(1005,3,'C',TRUE,5.00,9),
(1005,4,'C',TRUE,5.00,11),(1005,5,'B',TRUE,5.00,8),(1005,6,'D',TRUE,5.00,10),
(1005,7,'C',TRUE,5.00,13),(1005,8,'D',TRUE,5.00,9),(1005,9,'A',TRUE,5.00,11),(1005,10,'B',TRUE,5.00,7),
(1006,1,'B',TRUE,5.00,40),(1006,2,'B',TRUE,5.00,35),(1006,3,'C',TRUE,5.00,30),
(1006,4,'A',FALSE,0.00,60),(1006,5,'B',TRUE,5.00,55),(1006,6,'D',TRUE,5.00,28),
(1006,7,'A',FALSE,0.00,90),(1006,8,'D',TRUE,5.00,25),(1006,9,'B',FALSE,0.00,50),(1006,10,'B',TRUE,5.00,22),
(1007,1,'A',FALSE,0.00,50),(1007,2,'B',TRUE,5.00,45),(1007,3,'C',TRUE,5.00,40),
(1007,4,'C',TRUE,5.00,65),(1007,5,'A',FALSE,0.00,70),(1007,6,'D',TRUE,5.00,30),
(1007,7,'A',FALSE,0.00,100),(1007,8,'D',TRUE,5.00,35),(1007,9,'C',FALSE,0.00,60),(1007,10,'B',TRUE,5.00,30),
(1008,1,'B',TRUE,5.00,32),(1008,2,'B',TRUE,5.00,28),(1008,3,'C',TRUE,5.00,25),
(1008,4,'C',TRUE,5.00,50),(1008,5,'B',TRUE,5.00,55),(1008,6,'D',TRUE,5.00,22),
(1008,7,'C',TRUE,5.00,80),(1008,8,'B',FALSE,0.00,20),(1008,9,'A',TRUE,5.00,70),(1008,10,'A',FALSE,0.00,18),
(1009,1,'B',TRUE,5.00,45),(1009,2,'A',FALSE,0.00,60),(1009,3,'C',TRUE,5.00,38),
(1009,4,'A',FALSE,0.00,80),(1009,5,'C',FALSE,0.00,90),(1009,6,'D',TRUE,5.00,35),
(1009,7,'B',FALSE,0.00,110),(1009,8,'D',TRUE,5.00,30),(1009,9,'A',TRUE,5.00,85),(1009,10,'A',FALSE,0.00,25),
(1010,1,'A',FALSE,0.00,60),(1010,2,'C',FALSE,0.00,75),(1010,3,'C',TRUE,5.00,50),
(1010,4,'A',FALSE,0.00,90),(1010,5,'A',FALSE,0.00,100),(1010,6,'B',FALSE,0.00,40),
(1010,7,'A',FALSE,0.00,120),(1010,8,'D',TRUE,5.00,35),(1010,9,'B',FALSE,0.00,95),(1010,10,'B',TRUE,5.00,30);

-- Exam 2
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(1011,11,'C',TRUE,2.00,40),(1011,12,'C',TRUE,2.00,30),(1011,13,'C',TRUE,2.00,45),
(1011,14,'B',TRUE,2.00,25),(1011,15,'B',TRUE,2.00,20),(1011,16,'B',TRUE,2.00,35),
(1011,17,'C',TRUE,2.00,55),(1011,18,'C',TRUE,2.00,18),(1011,19,'C',TRUE,2.00,60),(1011,20,'A',FALSE,0.00,22),
(1012,11,'C',TRUE,2.00,38),(1012,12,'C',TRUE,2.00,32),(1012,13,'B',FALSE,0.00,50),
(1012,14,'B',TRUE,2.00,28),(1012,15,'B',TRUE,2.00,22),(1012,16,'B',TRUE,2.00,40),
(1012,17,'C',TRUE,2.00,60),(1012,18,'C',TRUE,2.00,20),(1012,19,'C',TRUE,2.00,65),(1012,20,'B',TRUE,2.00,25),
(1013,11,'C',TRUE,2.00,20),(1013,12,'C',TRUE,2.00,15),(1013,13,'C',TRUE,2.00,22),
(1013,14,'B',TRUE,2.00,18),(1013,15,'B',TRUE,2.00,12),(1013,16,'A',FALSE,0.00,16),
(1013,17,'C',TRUE,2.00,25),(1013,18,'A',FALSE,0.00,14),(1013,19,'C',TRUE,2.00,20),(1013,20,'C',FALSE,0.00,10),
(1014,11,'C',TRUE,2.00,55),(1014,12,'C',TRUE,2.00,48),(1014,13,'A',FALSE,0.00,70),
(1014,14,'B',TRUE,2.00,40),(1014,15,'A',FALSE,0.00,55),(1014,16,'B',TRUE,2.00,60),
(1014,17,'A',FALSE,0.00,80),(1014,18,'C',TRUE,2.00,35),(1014,19,'B',FALSE,0.00,75),(1014,20,'C',FALSE,0.00,45),
(1015,11,'C',TRUE,2.00,30),(1015,12,'C',TRUE,2.00,25),(1015,13,'C',TRUE,2.00,35),
(1015,14,'A',FALSE,0.00,28),(1015,15,'B',TRUE,2.00,20),(1015,16,'B',TRUE,2.00,32),
(1015,17,'B',FALSE,0.00,45),(1015,18,'C',TRUE,2.00,22),(1015,19,'B',FALSE,0.00,40),(1015,20,'A',FALSE,0.00,18),
(1016,11,'C',TRUE,2.00,35),(1016,12,'C',TRUE,2.00,28),(1016,13,'C',TRUE,2.00,42),
(1016,14,'B',TRUE,2.00,22),(1016,15,'B',TRUE,2.00,18),(1016,16,'B',TRUE,2.00,30),
(1016,17,'C',TRUE,2.00,50),(1016,18,'C',TRUE,2.00,15),(1016,19,'C',TRUE,2.00,55),(1016,20,'B',TRUE,2.00,20),
(1017,11,'A',FALSE,0.00,60),(1017,12,'C',TRUE,2.00,55),(1017,13,'B',FALSE,0.00,80),
(1017,14,'B',TRUE,2.00,45),(1017,15,'A',FALSE,0.00,65),(1017,16,'A',FALSE,0.00,70),
(1017,17,'C',TRUE,2.00,90),(1017,18,'C',TRUE,2.00,40),(1017,19,'B',FALSE,0.00,85),(1017,20,'A',FALSE,0.00,50),
(1018,11,'C',TRUE,2.00,38),(1018,12,'C',TRUE,2.00,30),(1018,13,'C',TRUE,2.00,44),
(1018,14,'B',TRUE,2.00,25),(1018,15,'A',FALSE,0.00,22),(1018,16,'B',TRUE,2.00,35),
(1018,17,'C',TRUE,2.00,52),(1018,18,'A',FALSE,0.00,18),(1018,19,'C',TRUE,2.00,58),(1018,20,'A',FALSE,0.00,20),
(1019,11,'C',TRUE,2.00,36),(1019,12,'C',TRUE,2.00,29),(1019,13,'C',TRUE,2.00,43),
(1019,14,'B',TRUE,2.00,24),(1019,15,'B',TRUE,2.00,19),(1019,16,'B',TRUE,2.00,33),
(1019,17,'C',TRUE,2.00,51),(1019,18,'C',TRUE,2.00,16),(1019,19,'B',FALSE,0.00,56),(1019,20,'A',FALSE,0.00,21),
(1020,11,'C',TRUE,2.00,34),(1020,12,'C',TRUE,2.00,27),(1020,13,'C',TRUE,2.00,41),
(1020,14,'B',TRUE,2.00,23),(1020,15,'B',TRUE,2.00,17),(1020,16,'B',TRUE,2.00,31),
(1020,17,'C',TRUE,2.00,49),(1020,18,'C',TRUE,2.00,14),(1020,19,'C',TRUE,2.00,53),(1020,20,'A',FALSE,0.00,19);

-- Exam 3 — partial (in_progress + submitted)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(2001,21,'B',FALSE,0.00,85),(2001,22,'B',TRUE,10.00,72),(2001,23,'D',TRUE,10.00,90),
(2001,24,'B',TRUE,10.00,78),(2001,25,'C',TRUE,10.00,65),
(2002,21,'B',FALSE,0.00,95),(2002,22,'B',TRUE,10.00,88),(2002,23,'C',FALSE,0.00,110),(2002,24,'B',TRUE,10.00,82),
(2003,21,'B',FALSE,0.00,7),(2003,22,'B',TRUE,10.00,5),(2003,23,'D',TRUE,10.00,8),
(2003,24,'B',TRUE,10.00,6),(2003,25,'C',TRUE,10.00,5),(2003,26,'B',TRUE,10.00,9),(2003,27,'A',TRUE,10.00,6),(2003,28,'C',TRUE,10.00,7),
(2004,21,'A',FALSE,0.00,120),(2004,22,'B',TRUE,10.00,180),(2004,23,'D',TRUE,10.00,240),
(2005,21,'B',FALSE,0.00,9),(2005,22,'B',TRUE,10.00,8),(2005,23,'D',TRUE,10.00,11),
(2005,24,'B',TRUE,10.00,7),(2005,25,'C',TRUE,10.00,9),(2005,26,'B',TRUE,10.00,6),
(2006,21,'B',FALSE,0.00,88),(2006,22,'B',TRUE,10.00,75),(2006,23,'D',TRUE,10.00,92),
(2006,24,'B',TRUE,10.00,80),(2006,25,'C',TRUE,10.00,68),(2006,26,'B',TRUE,10.00,85),(2006,27,'A',TRUE,10.00,70),
(2007,21,'A',FALSE,0.00,150),(2007,22,'B',TRUE,10.00,200),
(2010,21,'B',FALSE,0.00,88),(2010,22,'B',TRUE,10.00,75),(2010,23,'D',TRUE,10.00,92),
(2010,24,'B',TRUE,10.00,80),(2010,25,'C',TRUE,10.00,68),(2010,26,'B',TRUE,10.00,85),
(2010,27,'A',TRUE,10.00,70),(2010,28,'C',TRUE,10.00,95),(2010,29,'B',TRUE,10.00,110),(2010,30,'A',FALSE,0.00,88);

-- Exam 5 — AI Mid-Term (demo)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(3001,31,'B',TRUE,10.00,6),(3001,32,'C',TRUE,10.00,7),(3001,33,'C',TRUE,10.00,5),(3001,34,'B',TRUE,10.00,8),(3001,35,'B',TRUE,10.00,6),
(3002,31,'B',TRUE,10.00,85),(3002,32,'A',FALSE,0.00,120),(3002,33,'C',TRUE,10.00,95),(3002,34,'B',TRUE,10.00,88),(3002,35,'A',FALSE,0.00,130),
(3003,31,'B',TRUE,10.00,70),(3003,32,'C',TRUE,10.00,110),(3003,33,'C',TRUE,10.00,65),(3003,34,'B',TRUE,10.00,80),(3003,35,'A',FALSE,0.00,95),
(3004,31,'B',TRUE,10.00,75),(3004,32,'C',TRUE,10.00,115),(3004,33,'C',TRUE,10.00,70),(3004,34,'A',FALSE,0.00,90),(3004,35,'B',TRUE,10.00,100),
(3005,31,'B',TRUE,10.00,200),(3005,32,'A',FALSE,0.00,350),
(3006,31,'B',TRUE,10.00,90),(3006,32,'A',FALSE,0.00,140),(3006,33,'C',TRUE,10.00,100),(3006,34,'B',TRUE,10.00,85),(3006,35,'A',FALSE,0.00,120),
(3007,31,'B',TRUE,10.00,12),(3007,32,'C',TRUE,10.00,11),(3007,33,'C',TRUE,10.00,10),(3007,34,'B',TRUE,10.00,13),(3007,35,'B',TRUE,10.00,9);

-- Exam 6 — live (demostudent answered 2)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(3010,36,'B',TRUE,20.00,75),(3010,37,'C',TRUE,20.00,90);

-- Exam 3 — demostudent timed out (2 answered)
INSERT INTO StudentAnswers (attempt_id,question_id,selected_option,is_correct,marks_obtained,time_taken_seconds) VALUES
(3015,21,'B',FALSE,0.00,200),(3015,22,'B',TRUE,10.00,300);


-- ── PROCTOR LOGS ───────────────────────────────────────────────
-- Exam 1
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
(1005,'DEVTOOLS_OPENED','HIGH','Browser DevTools opened.','2025-11-10 09:28:00','10.0.0.50'),
(1005,'TAB_SWITCH','MEDIUM','Tab switch detected.','2025-11-10 09:32:00','10.0.0.50'),
(1005,'EXAM_SUBMITTED','INFO','Exam submitted. Score: 50/50.','2025-11-10 10:01:00','10.0.0.50'),
(1004,'EXAM_STARTED','INFO','Exam started.','2025-11-10 09:15:00','192.168.1.104'),
(1004,'IDLE_WARNING','LOW','No interaction for 5 minutes.','2025-11-10 10:05:00','192.168.1.104'),
(1004,'AUTO_SUBMITTED','INFO','Auto-submitted: time limit reached.','2025-11-10 10:15:00','192.168.1.104');

-- Exam 3 — live
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
(2004,'IDLE_WARNING','LOW','No interaction for 3 minutes.','2026-03-13 09:28:00','192.168.1.104'),
(2005,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:12:00','10.0.0.51'),
(2005,'DEVTOOLS_OPENED','HIGH','Browser DevTools opened within 2 minutes of start.','2026-03-13 09:14:00','10.0.0.51'),
(2005,'TAB_SWITCH','MEDIUM','Tab switch #1.','2026-03-13 09:19:00','10.0.0.51'),
(2005,'RIGHT_CLICK_ATTEMPT','LOW','Right-click attempted on question text.','2026-03-13 09:20:00','10.0.0.51'),
(2005,'RAPID_ANSWERING','HIGH','6 answers in under 60 seconds (avg 9s/Q).','2026-03-13 09:23:00','10.0.0.51'),
(2006,'EXAM_STARTED','INFO','Exam started normally.','2026-03-13 09:20:00','192.168.1.106'),
(2007,'EXAM_STARTED','INFO','Exam started.','2026-03-13 09:18:00','192.168.1.107'),
(2007,'TAB_SWITCH','LOW','Tab switch #1 detected.','2026-03-13 09:26:00','192.168.1.107'),
(2010,'EXAM_STARTED','INFO','Exam started. Browser: Chrome/123 Windows 11','2026-04-02 10:00:00','192.168.1.101'),
(2010,'TAB_SWITCH','MEDIUM','Tab switch #1 detected.','2026-04-02 10:35:00','192.168.1.101'),
(2010,'EXAM_SUBMITTED','INFO','Student submitted. Score: 80/100.','2026-04-02 11:52:00','192.168.1.101');

-- Exam 5 — AI Mid-Term (demo, full event trail for demostudent)
INSERT INTO ProctorLogs (attempt_id,event_type,severity,event_details,logged_at,ip_address) VALUES
(3001,'EXAM_STARTED',        'INFO',    'Exam started. Browser: Chrome/121 Windows 11.',      '2025-12-10 09:08:00','192.168.5.21'),
(3001,'TAB_SWITCH',          'MEDIUM',  'Tab switch #1 detected.',                            '2025-12-10 09:10:00','192.168.5.21'),
(3001,'COPY_PASTE_DETECTED', 'HIGH',    'Ctrl+V paste detected on Question 1.',               '2025-12-10 09:11:00','192.168.5.21'),
(3001,'TAB_SWITCH',          'MEDIUM',  'Tab switch #2 detected.',                            '2025-12-10 09:12:00','192.168.5.21'),
(3001,'FULLSCREEN_EXIT',     'MEDIUM',  'Student exited fullscreen mode.',                    '2025-12-10 09:13:00','192.168.5.21'),
(3001,'COPY_PASTE_DETECTED', 'HIGH',    'Paste detected on Question 2.',                      '2025-12-10 09:14:00','192.168.5.21'),
(3001,'RAPID_ANSWERING',     'HIGH',    '5 questions answered in ~32 seconds (avg 6.4 s/Q).','2025-12-10 09:15:00','192.168.5.21'),
(3001,'TAB_SWITCH',          'MEDIUM',  'Tab switch #3.',                                     '2025-12-10 09:20:00','192.168.5.21'),
(3001,'DEVTOOLS_OPENED',     'HIGH',    'Browser DevTools panel opened.',                     '2025-12-10 09:22:00','192.168.5.21'),
(3001,'TAB_SWITCH',          'HIGH',    'Tab switch #4 — suspicious pattern identified.',     '2025-12-10 09:25:00','192.168.5.21'),
(3001,'COPY_PASTE_DETECTED', 'HIGH',    'Paste on Question 4.',                               '2025-12-10 09:28:00','192.168.5.21'),
(3001,'FULLSCREEN_EXIT',     'MEDIUM',  'Exited fullscreen a second time.',                   '2025-12-10 09:30:00','192.168.5.21'),
(3001,'TAB_SWITCH',          'HIGH',    'Tab switch #5 — auto-flag triggered.',               '2025-12-10 09:33:00','192.168.5.21'),
(3001,'COPY_PASTE_DETECTED', 'CRITICAL','Paste on Question 5 — 4th copy-paste event.',        '2025-12-10 09:35:00','192.168.5.21'),
(3001,'RIGHT_CLICK_ATTEMPT', 'LOW',     'Right-click attempted on question text (blocked).',  '2025-12-10 09:37:00','192.168.5.21'),
(3001,'BROWSER_BACK_PRESSED','MEDIUM',  'Browser back button pressed during exam.',           '2025-12-10 09:39:00','192.168.5.21'),
(3001,'EXAM_SUBMITTED',      'INFO',    'Exam submitted. Score: 50/50. Status: flagged.',     '2025-12-10 09:42:00','192.168.5.21'),
(3002,'EXAM_STARTED',        'INFO',    'Exam started (attempt 2).',                          '2025-12-10 10:30:00','192.168.5.21'),
(3002,'FULLSCREEN_EXIT',     'MEDIUM',  'Briefly exited fullscreen.',                         '2025-12-10 10:55:00','192.168.5.21'),
(3002,'EXAM_SUBMITTED',      'INFO',    'Exam submitted. Score: 30/50.',                      '2025-12-10 11:15:00','192.168.5.21'),
(3003,'EXAM_STARTED',        'INFO',    'Exam started normally.',                             '2025-12-10 09:05:00','192.168.1.101'),
(3003,'EXAM_SUBMITTED',      'INFO',    'Exam submitted. Score: 45/50.',                      '2025-12-10 09:55:00','192.168.1.101'),
(3005,'EXAM_STARTED',        'INFO',    'Exam started.',                                      '2025-12-10 09:08:00','192.168.1.103'),
(3005,'IDLE_WARNING',        'LOW',     'No interaction detected for 5 minutes.',             '2025-12-10 09:55:00','192.168.1.103'),
(3005,'AUTO_SUBMITTED',      'INFO',    'Auto-submitted: time limit reached.',                '2025-12-10 10:08:00','192.168.1.103'),
(3007,'EXAM_STARTED',        'INFO',    'Exam started.',                                      '2025-12-10 09:20:00','10.0.0.50'),
(3007,'DEVTOOLS_OPENED',     'HIGH',    'DevTools opened within 1 minute of start.',          '2025-12-10 09:21:00','10.0.0.50'),
(3007,'RAPID_ANSWERING',     'HIGH',    'All 5 questions answered in ~55 seconds.',           '2025-12-10 09:22:00','10.0.0.50'),
(3007,'TAB_SWITCH',          'MEDIUM',  'Tab switch #1.',                                     '2025-12-10 09:25:00','10.0.0.50'),
(3007,'COPY_PASTE_DETECTED', 'HIGH',    'Paste on Q3.',                                       '2025-12-10 09:30:00','10.0.0.50'),
(3007,'EXAM_SUBMITTED',      'INFO',    'Exam submitted. Score: 50/50. Flagged.',             '2025-12-10 10:10:00','10.0.0.50'),
(3010,'EXAM_STARTED',        'INFO',    'Exam started. Browser: Chrome/124 Windows 11.',      '2026-04-14 10:00:00','192.168.5.21'),
(3015,'EXAM_STARTED',        'INFO',    'Exam started.',                                      '2026-04-10 09:00:00','192.168.5.21'),
(3015,'TAB_SWITCH',          'LOW',     'Tab switch #1 detected.',                            '2026-04-10 09:30:00','192.168.5.21'),
(3015,'IDLE_WARNING',        'LOW',     'No interaction for 5 minutes.',                      '2026-04-10 10:50:00','192.168.5.21'),
(3015,'AUTO_SUBMITTED',      'INFO',    'Auto-submitted: 2-hour time limit reached.',         '2026-04-10 11:00:00','192.168.5.21');


-- ── SUSPICION FLAGS ────────────────────────────────────────────
INSERT INTO SuspicionFlags (attempt_id,flag_type,description,detected_at,is_resolved,resolved_by,resolved_at,resolution_notes) VALUES
-- Exam 1 flags (open)
(1003,'EXCESSIVE_TAB_SWITCHES','10 tab switches (limit 5). Combined with rapid answering.','2025-11-10 09:38:00',FALSE,NULL,NULL,NULL),
(1003,'COPY_PASTE_ABUSE','Copy-paste detected 5 times during exam.','2025-11-10 09:45:00',FALSE,NULL,NULL,NULL),
(1003,'RAPID_ANSWERING','All 10 questions answered in ~70 seconds (avg 7s/Q).','2025-11-10 09:24:00',FALSE,NULL,NULL,NULL),
(1005,'HIGH_SUSPICION_SCORE','Suspicion score 55/100 — DevTools, tab switches, copy-paste.','2025-11-10 09:40:00',FALSE,NULL,NULL,NULL),
-- Exam 3 live flags (open)
(2003,'EXCESSIVE_TAB_SWITCHES','10 tab switches. Threshold exceeded at switch 6.','2026-03-13 09:17:00',FALSE,NULL,NULL,NULL),
(2003,'COPY_PASTE_ABUSE','5 paste events in first 15 minutes.','2026-03-13 09:13:00',FALSE,NULL,NULL,NULL),
(2003,'RAPID_ANSWERING','8 answers in ~65 seconds (avg 8s/Q).','2026-03-13 09:11:00',FALSE,NULL,NULL,NULL),
(2005,'HIGH_SUSPICION_SCORE','Suspicion score 72/100 — DevTools, rapid answering, tab switches.','2026-03-13 09:23:00',FALSE,NULL,NULL,NULL),
-- Exam 5 demo flags: 2 resolved by demoprof, 2 open
(3001,'EXCESSIVE_TAB_SWITCHES','9 tab switches during 34-minute exam. Threshold is 5.','2025-12-10 09:33:00',
 TRUE,20,'2025-12-11 10:00:00','Confirmed suspicious — combined with copy-paste. Escalated to academic committee.'),
(3001,'RAPID_ANSWERING','All 5 questions in ~32 seconds (avg 6.4 s/Q). Min expected 30 s/Q.','2025-12-10 09:15:00',
 TRUE,20,'2025-12-11 10:05:00','Student claims prior prep. Pattern anomalous given difficulty. Left for committee.'),
(3001,'COPY_PASTE_ABUSE','4 paste events — likely copying from external source.','2025-12-10 09:35:00',FALSE,NULL,NULL,NULL),
(3001,'HIGH_SUSPICION_SCORE','Score 85/100 — DevTools, 9 tab switches, rapid, 4 pastes, back-pressed.','2025-12-10 09:42:00',FALSE,NULL,NULL,NULL),
(3007,'RAPID_ANSWERING','5 questions in 55 seconds (avg 11 s/Q). DevTools at exam start.','2025-12-10 09:22:00',FALSE,NULL,NULL,NULL),
(3007,'HIGH_SUSPICION_SCORE','Score 72/100 — DevTools, rapid answering, 8 tab switches, 3 pastes.','2025-12-10 10:10:00',FALSE,NULL,NULL,NULL);


-- ── LOGIN SESSIONS ─────────────────────────────────────────────
INSERT INTO LoginSessions (session_id,user_id,login_time,logout_time,ip_address,device_fingerprint,session_token,is_active) VALUES
(1, 6, '2025-11-10 09:00:00','2025-11-10 10:10:00','192.168.1.101','FP-ARJUN-WIN11','tok_arjun_exam1',FALSE),
(2, 8, '2025-11-10 09:05:00','2025-11-10 10:10:00','192.168.1.103','FP-RAVI-WIN10', 'tok_ravi_exam1', FALSE),
(3, 10,'2025-11-10 09:15:00',NULL,                 '10.0.0.50',   'FP-NIKHIL-LIN', 'tok_nikhil_exam1',TRUE),
(4, 10,'2025-11-10 09:24:00','2025-11-10 09:26:00','10.0.0.99',   'FP-NIKHIL-PHONE','tok_nikhil_2nd',FALSE),
(5, 6, '2026-03-13 09:10:00',NULL,'192.168.1.101','FP-ARJUN-WIN11',  'tok_arjun_live',  TRUE),
(6, 7, '2026-03-13 09:05:00',NULL,'192.168.1.102','FP-PRIYA-WIN11',  'tok_priya_live',  TRUE),
(7, 8, '2026-03-13 09:00:00',NULL,'192.168.1.103','FP-RAVI-WIN10',   'tok_ravi_live',   TRUE),
(8, 9, '2026-03-13 09:03:00',NULL,'192.168.1.104','FP-ISHA-MAC',     'tok_isha_live',   TRUE),
(9, 10,'2026-03-13 09:07:00',NULL,'10.0.0.51',   'FP-NIKHIL-LIN',   'tok_nikhil_live', TRUE),
(10,10,'2026-03-13 09:16:00',NULL,'10.0.0.200',  'FP-NIKHIL-PHONE', 'tok_nikhil_2nd2', TRUE),
(11,11,'2026-03-13 09:15:00',NULL,'192.168.1.106','FP-ANANYA-WIN11', 'tok_ananya_live', TRUE),
(12,12,'2026-03-13 09:13:00',NULL,'192.168.1.107','FP-ROHAN-WIN11',  'tok_rohan_live',  TRUE);


SET FOREIGN_KEY_CHECKS = 1;

-- !! Run sql/03_triggers.sql after this file to restore all triggers !!
