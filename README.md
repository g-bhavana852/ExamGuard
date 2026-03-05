# Online Exam Proctoring System — DBMS Project

> **Stack:** MySQL 8.x · InnoDB · 3NF/BCNF · Triggers · Stored Procedures · Transactions

---

## Project Structure

```
DBMS/
├── sql/
│   ├── 01_schema.sql        ← Tables, PKs, FKs, CHECKs
│   ├── 02_indexes.sql       ← Performance indexes
│   ├── 03_triggers.sql      ← 7 triggers (auto-submit, grading, flagging)
│   ├── 04_procedures.sql    ← 8 stored procedures
│   ├── 05_transactions.sql  ← Transaction + concurrency examples
│   ├── 06_sample_data.sql   ← Seed data (15 users, 3 exams, 20 questions)
│   └── 07_queries.sql       ← 12 analytical queries
├── ui/
│   └── index.html           ← Full-featured dashboard UI
└── README.md
```

### Setup (run in order)

```sql
SOURCE sql/01_schema.sql;
SOURCE sql/02_indexes.sql;
SOURCE sql/03_triggers.sql;
SOURCE sql/04_procedures.sql;
SOURCE sql/06_sample_data.sql;
```

---

## ER Diagram

```
┌──────────┐        ┌─────────────┐        ┌────────────┐
│  Users   │──────<│  Enrollments│>───────│  Courses   │
│──────────│  M:M   └─────────────┘        │────────────│
│ user_id  │                               │ course_id  │
│ email    │        ┌───────────────────────│ course_code│
│ role     │        │                       │instructor_id
└──────────┘        ▼                       └──────┬─────┘
     │         ┌─────────┐                         │
     │ 1:M     │  Exams  │<────────────────────────┘
     │         │─────────│  1:M
     │         │ exam_id │
     │         │ course_id│
     │         │ duration │
     │         └────┬────┘
     │              │ 1:M
     │              ▼
     │    ┌──────────────────┐         ┌──────────────────┐
     └───>│  ExamAttempts    │<───────│   Questions      │
          │  (WEAK ENTITY)   │  M:M   │──────────────────│
          │──────────────────│ via    │ question_id      │
          │ attempt_id (PK)  │ Student│ exam_id          │
          │ exam_id   (FK)   │Answers │ question_text    │
          │ student_id(FK)   │        │ correct_answer   │
          │ suspicion_score  │        └──────────────────┘
          │ status           │
          └───────┬──────────┘
                  │
       ┌──────────┼─────────────┐
       ▼          ▼             ▼
┌───────────┐ ┌───────────┐ ┌──────────────┐
│ProctorLogs│ │Suspicion  │ │StudentAnswers│
│(WEAK ENT.)│ │  Flags    │ │──────────────│
│───────────│ │───────────│ │ answer_id    │
│ log_id    │ │ flag_id   │ │ is_correct   │
│ attempt_id│ │ attempt_id│ │marks_obtained│
│ event_type│ │ flag_type │ └──────────────┘
│ severity  │ │is_resolved│
└───────────┘ └───────────┘

                    ┌───────────────┐
                    │ LoginSessions │  ← Multi-login detection
                    │───────────────│
                    │ session_id    │
                    │ user_id (FK)  │
                    │ ip_address    │
                    └───────────────┘
```

---

## Entities & Relationships

| Relationship | Type | Constraint |
|---|---|---|
| User → Course (as instructor) | 1:M | A course has one instructor |
| Student ↔ Course | M:M | via `Enrollments` (student can drop/complete) |
| Course → Exam | 1:M | An exam belongs to exactly one course |
| Exam → Question | 1:M | Questions are deleted if exam is deleted |
| Student + Exam → ExamAttempt | Weak Entity | Identified by `(exam_id, student_id, attempt_number)` |
| ExamAttempt → StudentAnswer | 1:M | Each answer tied to one attempt |
| ExamAttempt → ProctorLog | 1:M | Weak entity — no meaning without parent |
| ExamAttempt → SuspicionFlag | 1:M | Flags resolved by proctors/admins |
| User → LoginSession | 1:M | For multi-login detection |

---

## Normalization Justification

### 1NF ✓
- All attributes are atomic (no multi-valued or composite attributes)
- MCQ options stored as separate columns (`option_a`…`option_d`) — exactly 4, no repeating group

### 2NF ✓
- All tables use single-column surrogate PKs → partial dependency is impossible

### 3NF ✓
- No transitive dependencies. Example: `ExamAttempts.percentage` depends only on `score` and `total_marks` (both directly related to the attempt) — stored as a justified denormalization for performance
- `Courses` separates instructor data → avoids instructor_name/email repeating in every Exam row

### BCNF ✓
- In `Enrollments`: the composite candidate key `(student_id, course_id)` determines all other attributes
- In `ExamAttempts`: `(exam_id, student_id, attempt_number)` is the natural composite key — no non-trivial determinant is a non-superkey

---

## Trigger Summary

| # | Name | Event | What it does |
|---|---|---|---|
| T1 | `trg_validate_exam_start` | BEFORE INSERT ExamAttempts | Blocks start if window closed / max attempts reached |
| T2 | `trg_check_time_on_answer` | BEFORE INSERT StudentAnswers | Auto-submits if time limit exceeded |
| T3 | `trg_auto_grade_answer` | BEFORE INSERT StudentAnswers | Instantly grades MCQ/TRUE_FALSE |
| T4 | `trg_update_suspicion_score` | AFTER INSERT ProctorLogs | Increments suspicion score by severity weight |
| T5 | `trg_auto_flag_suspicious` | AFTER UPDATE ExamAttempts | Creates SuspicionFlag at threshold (70+) |
| T6 | `trg_log_exam_submission` | AFTER UPDATE ExamAttempts | Writes immutable audit log on submission |
| T7 | `trg_detect_multiple_logins` | AFTER INSERT LoginSessions | Detects concurrent sessions from different IPs |

---

## Stored Procedures Summary

| # | Name | Called by | Purpose |
|---|---|---|---|
| SP1 | `sp_start_exam` | Student UI | Validates enrollment, creates attempt, logs start |
| SP2 | `sp_submit_answer` | Student UI | Upsert-safe answer save |
| SP3 | `sp_submit_exam` | Student UI | Locks row, calculates score, finalises attempt |
| SP4 | `sp_log_proctor_event` | Frontend JS | Logs a proctoring event |
| SP5 | `sp_get_exam_results` | Student UI | Returns summary + Q-by-Q breakdown |
| SP6 | `sp_get_flagged_attempts` | Proctor UI | Dashboard of suspicious attempts |
| SP7 | `sp_resolve_flag` | Proctor UI | Closes a suspicion flag with notes |
| SP8 | `sp_exam_analytics` | Instructor UI | Score distribution + question stats |

---

## Proctoring Logic (DBMS-Level)

No AI or camera required. Pure database-driven proctoring:

| Signal | Detection Method | Suspicion Weight |
|---|---|---|
| Tab switch | Frontend → `sp_log_proctor_event('TAB_SWITCH')` | +7 per event |
| Copy-paste | `keydown` event listener → log | +15 per event |
| Fullscreen exit | `fullscreenchange` event → log | +7 per event |
| Face not detected | Periodic camera check → log | +7 per event |
| Multiple logins | Trigger T7 on `LoginSessions` | +25 (CRITICAL) |
| Rapid answering | Q07 analytical query detects < 15s avg | Flag raised |
| Auto-submit | Trigger T2 fires on time expiry | Status → timed_out |
| DevTools opened | `devtools` detection → log | +15 per event |

**Scoring:** Each `ProctorLog` insertion fires T4, which increments `ExamAttempts.suspicion_score`. When it crosses **70**, T5 auto-raises a `SuspicionFlag` and changes status to `flagged`.

---

## Sample Data Scenarios

| Student | Attempt | Scenario |
|---|---|---|
| Arjun Kumar | 1001 | Clean: 90%, zero suspicious events |
| Priya Menon | 1002 | Good: 80%, 1 minor tab switch |
| Ravi Shankar | 1003 | **Flagged**: 8 tab switches, 4 copy-pastes, rapid answering (avg 7s/Q), suspicion=72 |
| Isha Trivedi | 1004 | **Timed out**: face not detected 3× → auto-submitted at 60-min mark |
| Nikhil Desai | 1005 | **Critical**: dual logins, DevTools, IP change, 2 faces detected, suspicion=88 |

---

## Key Design Decisions (Viva Ready)

**Q: Why store `percentage` in ExamAttempts if it's derived?**
> Justified denormalization. Leaderboards and reports ORDER BY percentage millions of times. Computing it on-the-fly would require a JOIN to Exams every query. The trigger system keeps it consistent.

**Q: Why is ExamAttempt a weak entity?**
> An attempt has no meaning independent of its (exam, student) pair. It is partially identified by `(exam_id, student_id, attempt_number)`. If the exam is deleted, all attempts lose their context.

**Q: How does the system prevent double-submission?**
> `sp_submit_exam` uses `SELECT … FOR UPDATE` to lock the row, then checks `status = 'in_progress'` before updating. If `ROW_COUNT() = 0` after the UPDATE, it means a concurrent session already submitted → ROLLBACK.

**Q: How is concurrency handled for answers?**
> `INSERT … ON DUPLICATE KEY UPDATE` is atomic at the storage engine level (InnoDB). No explicit lock needed for single-row upserts.

**Q: Why SERIALIZABLE for exam publishing?**
> Publishing is a one-way state change. SERIALIZABLE prevents two simultaneous "Publish" clicks from both seeing `is_published = FALSE` and both succeeding, which could lead to inconsistent state.
