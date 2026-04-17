-- Triggers (7): T1 validate_start · T2 check_time · T3 auto_grade
--               T4 suspicion_score · T5 auto_flag · T6 log_submit · T7 multi_login
USE ExamProctor;
DELIMITER //

CREATE TRIGGER trg_validate_exam_start BEFORE INSERT ON ExamAttempts FOR EACH ROW
BEGIN
    DECLARE vs DATETIME; DECLARE ve DATETIME; DECLARE vp BOOLEAN;
    DECLARE vm INT;      DECLARE vc INT;
    SELECT window_start,window_end,is_published,max_attempts INTO vs,ve,vp,vm FROM Exams WHERE exam_id=NEW.exam_id;
    IF NOT vp      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Exam is not published yet.'; END IF;
    IF NOW()<vs    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Exam window has not opened yet.'; END IF;
    IF NOW()>ve    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Exam window has closed. No new attempts allowed.'; END IF;
    SELECT COUNT(*) INTO vc FROM ExamAttempts WHERE exam_id=NEW.exam_id AND student_id=NEW.student_id;
    IF vc>=vm      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Maximum allowed attempts reached for this exam.'; END IF;
    SET NEW.attempt_number=vc+1;
END //

CREATE TRIGGER trg_check_time_on_answer BEFORE INSERT ON StudentAnswers FOR EACH ROW
BEGIN
    DECLARE vst DATETIME; DECLARE vd INT; DECLARE vas VARCHAR(20); DECLARE ve INT;
    SELECT ea.started_at,e.duration_minutes,ea.status INTO vst,vd,vas
    FROM ExamAttempts ea JOIN Exams e ON ea.exam_id=e.exam_id WHERE ea.attempt_id=NEW.attempt_id;
    IF vas<>'in_progress' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Exam is no longer in progress.'; END IF;
    SET ve=TIMESTAMPDIFF(MINUTE,vst,NOW());
    IF ve>=vd THEN
        UPDATE ExamAttempts SET status='timed_out',submitted_at=NOW(),auto_submitted=TRUE WHERE attempt_id=NEW.attempt_id;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ERROR: Time limit exceeded. Exam auto-submitted.';
    END IF;
END //

CREATE TRIGGER trg_auto_grade_answer BEFORE INSERT ON StudentAnswers FOR EACH ROW
BEGIN
    DECLARE vc VARCHAR(500); DECLARE vt VARCHAR(20); DECLARE vm DECIMAL(5,2);
    SELECT correct_answer,question_type,marks INTO vc,vt,vm FROM Questions WHERE question_id=NEW.question_id;
    IF vt IN ('MCQ','TRUE_FALSE') THEN
        IF NEW.selected_option=vc THEN SET NEW.is_correct=TRUE; SET NEW.marks_obtained=vm;
        ELSE SET NEW.is_correct=FALSE; SET NEW.marks_obtained=0.00; END IF;
    ELSEIF vt='SHORT_ANSWER' THEN
        IF TRIM(LOWER(NEW.selected_option))=TRIM(LOWER(COALESCE(vc,''))) AND vc IS NOT NULL AND vc!='' THEN
            SET NEW.is_correct=TRUE; SET NEW.marks_obtained=vm;
        ELSE SET NEW.is_correct=FALSE; SET NEW.marks_obtained=0.00; END IF;
    ELSE SET NEW.is_correct=NULL; SET NEW.marks_obtained=0.00; END IF;
END //

-- Severity weights: LOW=+3, MEDIUM=+7, HIGH=+15, CRITICAL=+25, INFO=0. Cap at 100.
CREATE TRIGGER trg_update_suspicion_score AFTER INSERT ON ProctorLogs FOR EACH ROW
BEGIN
    DECLARE vi INT DEFAULT 0;
    CASE NEW.severity WHEN 'LOW' THEN SET vi=3; WHEN 'MEDIUM' THEN SET vi=7;
        WHEN 'HIGH' THEN SET vi=15; WHEN 'CRITICAL' THEN SET vi=25; ELSE SET vi=0; END CASE;
    IF vi>0 THEN UPDATE ExamAttempts SET suspicion_score=LEAST(100,suspicion_score+vi) WHERE attempt_id=NEW.attempt_id; END IF;
    CASE NEW.event_type
        WHEN 'TAB_SWITCH'          THEN UPDATE ExamAttempts SET tab_switches=tab_switches+1 WHERE attempt_id=NEW.attempt_id;
        WHEN 'COPY_PASTE_DETECTED' THEN UPDATE ExamAttempts SET copy_paste_attempts=copy_paste_attempts+1 WHERE attempt_id=NEW.attempt_id;
        WHEN 'FULLSCREEN_EXIT'     THEN UPDATE ExamAttempts SET fullscreen_exits=fullscreen_exits+1 WHERE attempt_id=NEW.attempt_id;
        ELSE BEGIN END; END CASE;
END //

-- Auto-flags: suspicion≥70, tab_switches≥5, copy_paste≥3
CREATE TRIGGER trg_auto_flag_suspicious BEFORE UPDATE ON ExamAttempts FOR EACH ROW
BEGIN
    IF NEW.suspicion_score>=70 AND OLD.suspicion_score<70 THEN
        INSERT INTO SuspicionFlags(attempt_id,flag_type,description) VALUES(NEW.attempt_id,'HIGH_SUSPICION_SCORE',
            CONCAT('Suspicion score reached ',NEW.suspicion_score,' (threshold:70). Tabs:',NEW.tab_switches,', CP:',NEW.copy_paste_attempts,'. Auto-flagged.'));
        IF NEW.status='in_progress' THEN SET NEW.status='flagged'; END IF;
    END IF;
    IF NEW.tab_switches>=5 AND OLD.tab_switches<5 THEN
        INSERT INTO SuspicionFlags(attempt_id,flag_type,description) VALUES(NEW.attempt_id,'EXCESSIVE_TAB_SWITCHES',
            CONCAT('Student switched tabs ',NEW.tab_switches,' times. Limit 5. Auto-flagged.')); END IF;
    IF NEW.copy_paste_attempts>=3 AND OLD.copy_paste_attempts<3 THEN
        INSERT INTO SuspicionFlags(attempt_id,flag_type,description) VALUES(NEW.attempt_id,'COPY_PASTE_ABUSE',
            CONCAT('Copy-paste detected ',NEW.copy_paste_attempts,' times. Limit 3. Auto-flagged.')); END IF;
END //

-- Logs submission audit; excludes 'flagged' to avoid T4 re-trigger loop.
CREATE TRIGGER trg_log_exam_submission AFTER UPDATE ON ExamAttempts FOR EACH ROW
BEGIN
    IF OLD.status='in_progress' AND NEW.status IN ('submitted','timed_out') THEN
        INSERT INTO ProctorLogs(attempt_id,event_type,severity,event_details) VALUES(
            NEW.attempt_id,
            CASE WHEN NEW.auto_submitted OR NEW.status='timed_out' THEN 'AUTO_SUBMITTED' ELSE 'EXAM_SUBMITTED' END,
            'INFO',
            CONCAT('Status: ',NEW.status,'. Duration:',TIMESTAMPDIFF(MINUTE,NEW.started_at,NOW()),'min. Score:',COALESCE(NEW.score,'Pending'),'. Suspicion:',NEW.suspicion_score,'/100.'));
    END IF;
END //

-- Detects concurrent logins from different IPs; bumps suspicion +25 on active attempt.
CREATE TRIGGER trg_detect_multiple_logins AFTER INSERT ON LoginSessions FOR EACH ROW
BEGIN
    DECLARE vc INT; DECLARE va INT DEFAULT NULL;
    SELECT COUNT(*) INTO vc FROM LoginSessions
    WHERE user_id=NEW.user_id AND is_active=TRUE AND session_id<>NEW.session_id AND ip_address<>NEW.ip_address;
    IF vc>0 THEN
        SELECT attempt_id INTO va FROM ExamAttempts
        WHERE student_id=NEW.user_id AND status='in_progress' ORDER BY started_at DESC LIMIT 1;
        IF va IS NOT NULL THEN
            INSERT INTO ProctorLogs(attempt_id,event_type,severity,event_details,ip_address) VALUES(
                va,'MULTIPLE_LOGIN_DETECTED','CRITICAL',
                CONCAT('Multiple login: new session from ',NEW.ip_address,' while attempt #',va,' active from different IP.'),
                NEW.ip_address);
        END IF;
    END IF;
END //

DELIMITER ;
