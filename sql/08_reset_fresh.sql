-- ============================================================
--  08_reset_fresh.sql
--  Wipe ALL data, apply schema migrations, seed minimal accounts.
--
--  Accounts after this file:
--    admin    / Admin@2025   (role: admin)
--    proctor1 / Proctor@01   (role: teacher)
--    teacher1 / Teach@123    (role: teacher)
--    student1 / Student@123  (role: student)
--    student2 / Student@123  (role: student)
--    student3 / Student@123  (role: student)
--    student4 / Student@123  (role: student)
--    student5 / Student@123  (role: student)
--
--  Run:
--    mysql -u root -p ExamProctor < sql/08_reset_fresh.sql
-- ============================================================

USE ExamProctor;

-- ── 1. Role ENUM migration (expand → data update → shrink) ───
ALTER TABLE Users     MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin') NOT NULL DEFAULT 'student';
ALTER TABLE UserRoles MODIFY COLUMN role ENUM('student','instructor','proctor','teacher','admin') NOT NULL;

-- ── 2. Wipe all data ─────────────────────────────────────────
SET FOREIGN_KEY_CHECKS = 0;
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
SET FOREIGN_KEY_CHECKS = 1;

-- ── 3. Shrink role ENUM to final 3 values ────────────────────
ALTER TABLE Users     MODIFY COLUMN role ENUM('student','teacher','admin') NOT NULL DEFAULT 'student';
ALTER TABLE UserRoles MODIFY COLUMN role ENUM('student','teacher','admin') NOT NULL;

-- ── 4. Add join_code column if missing ───────────────────────
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Exams' AND COLUMN_NAME='join_code');
SET @sql := IF(@col=0,
  'ALTER TABLE Exams ADD COLUMN join_code CHAR(6) NULL UNIQUE',
  'SELECT "join_code already exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 5. Add MCQ option_e … option_j columns if missing ────────
SET @ce := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_e');
SET @sql := IF(@ce=0, 'ALTER TABLE Questions ADD COLUMN option_e VARCHAR(500) NULL', 'SELECT "option_e exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @cf := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_f');
SET @sql := IF(@cf=0, 'ALTER TABLE Questions ADD COLUMN option_f VARCHAR(500) NULL', 'SELECT "option_f exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @cg := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_g');
SET @sql := IF(@cg=0, 'ALTER TABLE Questions ADD COLUMN option_g VARCHAR(500) NULL', 'SELECT "option_g exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @ch := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_h');
SET @sql := IF(@ch=0, 'ALTER TABLE Questions ADD COLUMN option_h VARCHAR(500) NULL', 'SELECT "option_h exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @ci := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_i');
SET @sql := IF(@ci=0, 'ALTER TABLE Questions ADD COLUMN option_i VARCHAR(500) NULL', 'SELECT "option_i exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @cj := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ExamProctor' AND TABLE_NAME='Questions' AND COLUMN_NAME='option_j');
SET @sql := IF(@cj=0, 'ALTER TABLE Questions ADD COLUMN option_j VARCHAR(500) NULL', 'SELECT "option_j exists" AS info');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 6. Seed minimal accounts ──────────────────────────────────
-- Password hashes (sha256: prefix, same as server.js hashPw()):
--   Admin@2025  → sha256:fcf7bb6d546cfb82d2e55486984ae7a1862a666acb441e0cf8b4ed34a4fcf9d7
--   Proctor@01  → sha256:10440b8ccda985adc54d08d9a740d07738728dc1732c46840ca64d468c22c25c
--   Teach@123   → sha256:472f42a06a6d3fbd4d82365cc682d739228d76d6d0aa008d6bf5992353d0beb9
--   Student@123 → sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54
INSERT INTO Users (user_id, email, password_hash, full_name, role, username) VALUES
(1, 'admin@exam.local',    'sha256:fcf7bb6d546cfb82d2e55486984ae7a1862a666acb441e0cf8b4ed34a4fcf9d7', 'Admin',         'admin',   'admin'),
(2, 'proctor1@exam.local', 'sha256:10440b8ccda985adc54d08d9a740d07738728dc1732c46840ca64d468c22c25c', 'Teacher One',   'teacher', 'proctor1'),
(3, 'teacher1@exam.local', 'sha256:472f42a06a6d3fbd4d82365cc682d739228d76d6d0aa008d6bf5992353d0beb9', 'Teacher Two',   'teacher', 'teacher1'),
(4, 'student1@exam.local', 'sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54', 'Student One',   'student', 'student1'),
(5, 'student2@exam.local', 'sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54', 'Student Two',   'student', 'student2'),
(6, 'student3@exam.local', 'sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54', 'Student Three', 'student', 'student3'),
(7, 'student4@exam.local', 'sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54', 'Student Four',  'student', 'student4'),
(8, 'student5@exam.local', 'sha256:b2a1f4fd0a460606b34c8913e2981dac8d2e283d778aba586c416ee2629bfa54', 'Student Five',  'student', 'student5');

SELECT 'Fresh seed applied.' AS status,
       (SELECT COUNT(*) FROM Users) AS user_count;
