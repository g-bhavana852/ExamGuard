// ─────────────────────────────────────────────────────────────
//  DATA.JS  —  All application data. No logic here.
// ─────────────────────────────────────────────────────────────

const PAGE_TITLES = {
  dashboard:      'Dashboard',
  monitor:        'Live Monitor',
  exams:          'Exams',
  questions:      'Question Bank',
  'student-view': 'Student View',
  flagged:        'Flagged Attempts',
  logs:           'Proctor Logs — Attempt #1003',
  analytics:      'Analytics',
  schema:         'DB Schema',
  results:        'Exam Results',
};

const NAV_SECTIONS = [
  { section: 'Overview', items: [
    { id: 'dashboard',    icon: '◈', label: 'Dashboard'       },
    { id: 'monitor',      icon: '◉', label: 'Live Monitor'    },
  ]},
  { section: 'Exam', items: [
    { id: 'exams',        icon: '▤', label: 'Exams'           },
    { id: 'questions',    icon: '?', label: 'Questions'       },
    { id: 'student-view', icon: '⊙', label: 'Student View'    },
  ]},
  { section: 'Proctoring', items: [
    { id: 'flagged',      icon: '⚑', label: 'Flagged Attempts'},
    { id: 'logs',         icon: '≡', label: 'Proctor Logs'    },
    { id: 'analytics',    icon: '≈', label: 'Analytics'       },
  ]},
  { section: 'System', items: [
    { id: 'schema',       icon: '⊞', label: 'DB Schema'       },
  ]},
];

// ── Dashboard ─────────────────────────────────────────────────
const DASHBOARD = {
  stats: [
    { color: 'purple', icon: '▤', label: 'Total Exams',      value: 3, sub: '2 completed · 1 upcoming'     },
    { color: 'green',  icon: '✓', label: 'Attempts Today',   value: 7, sub: '5 submitted · 2 in progress'  },
    { color: 'yellow', icon: '!', label: 'Open Flags',       value: 5, sub: '3 high · 2 medium severity'   },
    { color: 'red',    icon: '⚑', label: 'Flagged Attempts', value: 2, sub: 'Ravi Shankar · Nikhil Desai'  },
  ],
  alerts: [
    { type: 'red',    name: 'Nikhil Desai', msg: 'Suspicion score 88/100. Multiple logins detected from 2 different IPs during DBMS Mid-Term.',       action: { label: 'Review',    page: 'flagged' } },
    { type: 'red',    name: 'Ravi Shankar', msg: '8 tab switches + 4 copy-paste events. Rapid answering (avg 7s/question). Score 48/50 suspicious.', action: { label: 'View Logs', page: 'logs'    } },
    { type: 'yellow', name: 'Isha Trivedi', msg: 'Exam auto-submitted at 60-minute mark.',                                                            action: null },
    { type: 'green',  name: 'Arjun Kumar',  msg: 'Exam completed cleanly. Score 45/50 (90%). No suspicious events.',                                 action: null },
  ],
  funnel: [
    { label: 'Enrolled',           value: '10',               pct: 100, fill: 'fill-purple' },
    { label: 'Started Exam',       value: '5 (50%)',          pct: 50,  fill: 'fill-purple' },
    { label: 'Submitted',          value: '3 (30%)',          pct: 30,  fill: 'fill-green'  },
    { label: 'Timed Out',          value: '1 (10%)',          pct: 10,  fill: 'fill-yellow' },
    { label: 'Flagged',            value: '2 (20%)',          pct: 20,  fill: 'fill-red'    },
    { label: 'Passed (≥25 marks)', value: '4 (80% submitted)',pct: 80,  fill: 'fill-green'  },
  ],
  scoreChart: {
    bars: [
      { val: 1, pct: 30, color: 'var(--accent)',  label: 'A+ ≥90%'  },
      { val: 1, pct: 30, color: 'var(--green)',   label: 'A 75-89%' },
      { val: 0, pct:  5, color: 'var(--yellow)',  label: 'B 60-74%' },
      { val: 1, pct: 30, color: 'var(--orange)',  label: 'C 50-59%' },
      { val: 2, pct: 60, color: 'var(--red)',     label: 'F <50%'   },
    ],
    summary: [
      { label: 'Avg score', value: '40.6 / 50',               color: 'var(--text)'  },
      { label: 'Pass rate', value: '60%',                      color: 'var(--green)' },
      { label: 'Highest',   value: '50/50 (Nikhil — flagged)', color: 'var(--text)'  },
      { label: 'Lowest',    value: '20/50 (Isha — timed out)', color: 'var(--text)'  },
    ],
  },
};

// ── Live Monitor ──────────────────────────────────────────────
const MONITOR = {
  examAlert: 'Live monitoring is active for <strong>DBMS End-Term Examination</strong>. Exam window: Apr 1, 2026 · 09:00 – 14:00.',
  students: [
    { status: 'clean',   name: 'Arjun Kumar', answered: '7/10',  elapsed: 32, timeLeft: '88 min left', timerPct: 27, timerFill: 'fill-green',
      suspicion: 0,  suspColor: 'var(--green)',
      indicators: [{ cls: 'ind-clean', text: 'Clean' }], note: '' },
    { status: 'flagged', name: 'Ravi Shankar', answered: '10/10', elapsed: 22, timeLeft: '98 min left', timerPct: 18, timerFill: 'fill-red',
      suspicion: 72, suspColor: 'var(--red)',
      indicators: [{ cls: 'ind-tab', text: '8 Tab Switches' }, { cls: 'ind-paste', text: '4 Copy-Paste' }], note: '' },
    { status: 'warning', name: 'Priya Menon',  answered: '5/10',  elapsed: 45, timeLeft: '75 min left', timerPct: 38, timerFill: 'fill-yellow',
      suspicion: 5,  suspColor: 'var(--yellow)',
      indicators: [{ cls: 'ind-tab', text: '1 Tab Switch' }, { cls: '', text: 'Fullscreen Exit 1x', style: 'background:rgba(100,116,139,0.15);color:var(--text3)' }], note: '' },
    { status: 'warning', name: 'Isha Trivedi', answered: '4/10',  elapsed: 58, timeLeft: '2 min left',  timerPct: 97, timerFill: 'fill-red',
      suspicion: 10, suspColor: 'var(--orange)',
      indicators: [{ cls: 'ind-tab', text: 'Timed Out Warning' }], note: '· Will auto-submit soon' },
    { status: 'flagged', name: 'Nikhil Desai', answered: '10/10', elapsed: 41, timeLeft: '79 min left', timerPct: 34, timerFill: 'fill-red',
      suspicion: 88, suspColor: 'var(--red)',
      indicators: [{ cls: 'ind-paste', text: 'Multi-Login' }, { cls: 'ind-paste', text: 'DevTools' }, { cls: 'ind-tab', text: 'IP Changed' }], note: '— FLAGGED' },
    { status: 'clean',   name: 'Ananya Bose',  answered: '6/10',  elapsed: 38, timeLeft: '82 min left', timerPct: 32, timerFill: 'fill-green',
      suspicion: 0,  suspColor: 'var(--green)',
      indicators: [{ cls: 'ind-clean', text: 'Clean' }], note: '' },
  ],
};

// ── Flagged Attempts ──────────────────────────────────────────
const FLAGGED = {
  attempts: [
    { name: 'Nikhil Desai', email: 'nikhil.d@student.edu', statusBadge: 'badge-red',    statusText: 'Flagged',    suspicion: 88, suspColor: 'var(--red)',    tabs: 12, tabColor: 'var(--yellow)', paste: 6, pasteColor: 'var(--red)',    score: '50/50', scoreBadge: 'badge-yellow', scoreText: 'Suspicious',   openFlags: '2 open', flagBadge: 'badge-red',  logPage: 'logs' },
    { name: 'Ravi Shankar', email: 'ravi.s@student.edu',   statusBadge: 'badge-red',    statusText: 'Flagged',    suspicion: 72, suspColor: 'var(--orange)', tabs:  8, tabColor: 'var(--red)',    paste: 4, pasteColor: 'var(--red)',    score: '48/50', scoreBadge: 'badge-yellow', scoreText: 'Under Review', openFlags: '3 open', flagBadge: 'badge-red',  logPage: 'logs' },
    { name: 'Isha Trivedi', email: 'isha.t@student.edu',   statusBadge: 'badge-yellow', statusText: 'Timed Out',  suspicion: 10, suspColor: 'var(--yellow)', tabs:  1, tabColor: 'var(--text3)', paste: 0, pasteColor: 'var(--text3)', score: '20/50', scoreBadge: 'badge-red',    scoreText: 'Fail',         openFlags: '0 open', flagBadge: 'badge-gray', logPage: 'logs' },
    { name: 'Priya Menon',  email: 'priya.m@student.edu',  statusBadge: 'badge-green',  statusText: 'Submitted',  suspicion:  5, suspColor: 'var(--yellow)', tabs:  1, tabColor: 'var(--text3)', paste: 0, pasteColor: 'var(--text3)', score: '40/50', scoreBadge: 'badge-green',  scoreText: 'Pass',         openFlags: '0 open', flagBadge: 'badge-gray', logPage: null  },
  ],
  flags: [
    { id: '#5', student: 'Nikhil Desai', type: 'HIGH_SUSPICION_SCORE',   badge: 'badge-red',    desc: 'Suspicion score 88/100. Multiple critical events.',    time: 'Nov 10, 09:40', resolved: false, resolvedBy: null       },
    { id: '#6', student: 'Nikhil Desai', type: 'IP_CHANGE_DURING_EXAM',  badge: 'badge-orange', desc: 'IP changed mid-exam (10.0.0.50 → 10.0.1.5).',          time: 'Nov 10, 09:40', resolved: false, resolvedBy: null       },
    { id: '#1', student: 'Ravi Shankar', type: 'EXCESSIVE_TAB_SWITCHES', badge: 'badge-red',    desc: '8 tab switches. Limit is 5.',                          time: 'Nov 10, 09:42', resolved: false, resolvedBy: null       },
    { id: '#2', student: 'Ravi Shankar', type: 'COPY_PASTE_ABUSE',       badge: 'badge-orange', desc: 'Copy-paste 4 times. Limit is 3.',                      time: 'Nov 10, 09:45', resolved: false, resolvedBy: null       },
    { id: '#3', student: 'Ravi Shankar', type: 'RAPID_ANSWERING',        badge: 'badge-yellow', desc: 'All 10 Qs answered in under 90s. Avg 7s/Q.',           time: 'Nov 10, 09:30', resolved: false, resolvedBy: null       },
    { id: '#4', student: 'Nikhil Desai', type: 'MULTIPLE_LOGINS',        badge: 'badge-yellow', desc: 'Two sessions from different IPs.',                     time: 'Nov 10, 09:25', resolved: true,  resolvedBy: 'Rahul V.' },
  ],
};

// ── Proctor Logs ──────────────────────────────────────────────
const LOGS = {
  badge: 'Ravi Shankar — Attempt #1003 (Q09 Query)',
  timeline: [
    { dot: 'info',   icon: '▶',  title: 'EXAM_STARTED',                        detail: 'Exam started from IP 192.168.1.103',                         time: '09:08' },
    { dot: 'medium', icon: '⇄',  title: 'TAB_SWITCH #1',                       detail: 'Student left exam tab',                                      time: '09:10' },
    { dot: 'medium', icon: '⇄',  title: 'TAB_SWITCH #2',                       detail: 'Student left exam tab',                                      time: '09:12' },
    { dot: 'high',   icon: 'CP', title: 'COPY_PASTE_DETECTED',                 detail: 'Ctrl+V detected in answer field — Q2',                       time: '09:14' },
    { dot: 'high',   icon: 'CP', title: 'COPY_PASTE_DETECTED',                 detail: 'Paste attempt on Q5',                                        time: '09:22' },
    { dot: 'high',   icon: 'RQ', title: 'RAPID_ANSWERING',                     detail: 'All 10 answers submitted in under 90 seconds (avg 7s/Q)',    time: '09:30' },
    { dot: 'medium', icon: '<>', title: 'TAB_SWITCH #6 — Threshold Exceeded',  detail: 'Auto-flag raised for EXCESSIVE_TAB_SWITCHES',               time: '09:42' },
    { dot: 'high',   icon: 'CP', title: 'COPY_PASTE_DETECTED #4 — Abuse Flag', detail: 'Auto-flag raised for COPY_PASTE_ABUSE',                      time: '09:45' },
    { dot: 'info',   icon: 'OK', title: 'EXAM_SUBMITTED',                      detail: 'Exam submitted. Score: 48/50. Suspicion: 72/100.',           time: '10:02' },
  ],
  risk: {
    score: 72, totalEvents: 17, duration: '54 min',
    metrics: [
      { label: 'Tab Switches', value: 8,      color: 'var(--yellow)' },
      { label: 'Copy-Paste',   value: 4,      color: 'var(--red)'    },
      { label: 'Avg Time/Q',   value: '7s',   color: 'var(--orange)' },
      { label: 'Score',        value: '48/50',color: 'var(--red)'    },
    ],
  },
};

// ── Student View ──────────────────────────────────────────────
const STUDENT_VIEW = {
  label: 'Arjun Kumar · arjun.k@student.edu',
  exams: [
    { title: 'DBMS Mid-Term Examination',      course: 'CS301 · Database Management Systems',   statusBadge: 'badge-green',  statusText: '✓ Submitted', marks: 50,  duration: '60 min',  questions: '10 Q',    scoreLine: '45/50 (90%) · PASS', scoreColor: 'var(--green)', pct: 90, fill: 'fill-green', action: { label: 'View Results', cls: 'btn-outline', page: 'results' } },
    { title: 'DSA Weekly Quiz — Trees & Graphs',course: 'CS201 · Data Structures & Algorithms', statusBadge: 'badge-green',  statusText: '✓ Submitted', marks: 20,  duration: '30 min',  questions: '10 Q',    scoreLine: '18/20 (90%) · PASS', scoreColor: 'var(--green)', pct: 90, fill: 'fill-green', action: { label: 'View Results', cls: 'btn-outline', page: null    } },
    { title: 'DBMS End-Term Examination',      course: 'CS301 · Database Management Systems',   statusBadge: 'badge-purple', statusText: 'Upcoming',   marks: 100, duration: '120 min', questions: '1 Attempt', note: 'Window: Apr 1, 2026 · 09:00 – 14:00',                                          action: { label: 'Start Exam',   cls: 'btn-primary', page: null    } },
  ],
};

// ── Analytics ─────────────────────────────────────────────────
const ANALYTICS = {
  stats: [
    { color: 'green',  label: 'Pass Rate',    value: '60%', valueColor: 'var(--green)',  sub: '3 of 5 submitted · DBMS Mid-Term' },
    { color: 'purple', label: 'Avg Score',    value: '40.6',                             sub: 'out of 50 · Class average'        },
    { color: 'yellow', label: 'Avg Suspicion',value: '29',  valueColor: 'var(--yellow)', sub: 'per attempt · Exam 1'             },
    { color: 'red',    label: 'Total Events', value: '34',                               sub: 'Proctoring events logged'         },
  ],
  difficulty: [
    { q: 'Q9', topic: 'Deadlock Prevention', pct: '40%',  pctColor: 'var(--red)',    time: '80s', badge: 'badge-red',    rating: 'Hard'     },
    { q: 'Q7', topic: '2-Phase Locking',     pct: '40%',  pctColor: 'var(--red)',    time: '90s', badge: 'badge-red',    rating: 'Hard'     },
    { q: 'Q5', topic: 'Isolation Levels',    pct: '60%',  pctColor: 'var(--yellow)', time: '60s', badge: 'badge-yellow', rating: 'Good'     },
    { q: 'Q1', topic: 'Normal Forms',        pct: '100%', pctColor: 'var(--green)',  time: '30s', badge: 'badge-green',  rating: 'Too Easy' },
    { q: 'Q8', topic: 'ACID Durability',     pct: '100%', pctColor: 'var(--green)',  time: '20s', badge: 'badge-green',  rating: 'Too Easy' },
  ],
  ranking: [
    { rank: '#1', name: 'Arjun Kumar',  flag: false, pct: '90%',  pctColor: 'var(--green)',  passBadge: 'badge-green',  passText: 'Pass', susp:  0, suspColor: 'var(--green)'  },
    { rank: '#2', name: 'Priya Menon',  flag: false, pct: '80%',  pctColor: 'var(--green)',  passBadge: 'badge-green',  passText: 'Pass', susp:  5, suspColor: 'var(--green)'  },
    { rank: '#3', name: 'Ravi Shankar', flag: true,  pct: '96%',  pctColor: 'var(--yellow)', passBadge: 'badge-yellow', passText: '?',    susp: 72, suspColor: 'var(--red)'    },
    { rank: '#4', name: 'Isha Trivedi', flag: false, pct: '40%',  pctColor: 'var(--red)',    passBadge: 'badge-red',    passText: 'Fail', susp: 10, suspColor: 'var(--yellow)' },
    { rank: '#5', name: 'Nikhil Desai', flag: true,  pct: '100%', pctColor: 'var(--yellow)', passBadge: 'badge-yellow', passText: '?',    susp: 88, suspColor: 'var(--red)'    },
  ],
};

// ── DB Schema ─────────────────────────────────────────────────
const SCHEMA = {
  tables: [
    { num:  1, name: 'Users',          rows: 15, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, UNIQUE(email), CHECK(email REGEXP)'             },
    { num:  2, name: 'Courses',        rows:  2, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, UNIQUE(course_code), FK→Users'                  },
    { num:  3, name: 'Enrollments',    rows: 20, entityBadge: 'badge-green',  entity: 'Junction', constraints: 'PK, UNIQUE(student_id, course_id), FK×2'            },
    { num:  4, name: 'Exams',          rows:  3, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, FK→Courses, FK→Users, CHECK constraints'        },
    { num:  5, name: 'Questions',      rows: 20, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, FK→Exams (CASCADE DELETE)'                      },
    { num:  6, name: 'ExamAttempts',   rows:  7, entityBadge: 'badge-yellow', entity: 'Weak',     constraints: 'PK, UNIQUE(exam_id, student_id, attempt#), FK×2'   },
    { num:  7, name: 'StudentAnswers', rows: 24, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, UNIQUE(attempt_id, question_id), FK×2'          },
    { num:  8, name: 'ProctorLogs',    rows: 34, entityBadge: 'badge-yellow', entity: 'Weak',     constraints: 'PK, FK→ExamAttempts (CASCADE DELETE)'               },
    { num:  9, name: 'SuspicionFlags', rows:  6, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, FK→ExamAttempts, FK→Users (SET NULL)'           },
    { num: 10, name: 'LoginSessions',  rows:  4, entityBadge: 'badge-purple', entity: 'Strong',   constraints: 'PK, UNIQUE(session_token), FK→Users'                },
  ],
  triggers: [
    { name: 'trg_validate_exam_start',    event: 'BI ExamAttempts',  purpose: 'Window + attempt limit check'      },
    { name: 'trg_check_time_on_answer',   event: 'BI StudentAnswers',purpose: 'Auto-submit on time expiry'        },
    { name: 'trg_auto_grade_answer',      event: 'BI StudentAnswers',purpose: 'Instant MCQ grading'               },
    { name: 'trg_update_suspicion_score', event: 'AI ProctorLogs',   purpose: 'Severity-weighted score update'    },
    { name: 'trg_auto_flag_suspicious',   event: 'AU ExamAttempts',  purpose: 'Auto-raise flags at threshold 70'  },
    { name: 'trg_log_exam_submission',    event: 'AU ExamAttempts',  purpose: 'Immutable audit trail'             },
    { name: 'trg_detect_multiple_logins', event: 'AI LoginSessions', purpose: 'Concurrent session detection'      },
  ],
  procedures: [
    { name: 'sp_start_exam',           calledBy: 'Student — starts attempt'  },
    { name: 'sp_submit_answer',        calledBy: 'Student — saves answer'    },
    { name: 'sp_submit_exam',          calledBy: 'Student — finalises exam'  },
    { name: 'sp_log_proctor_event',    calledBy: 'Frontend — logs JS event'  },
    { name: 'sp_get_exam_results',     calledBy: 'Student — view results'    },
    { name: 'sp_get_flagged_attempts', calledBy: 'Proctor — dashboard'       },
    { name: 'sp_resolve_flag',         calledBy: 'Proctor — close flag'      },
    { name: 'sp_exam_analytics',       calledBy: 'Instructor — statistics'   },
  ],
};

// ── Results ───────────────────────────────────────────────────
const RESULTS = {
  student: 'Arjun Kumar',
  metrics: [
    { label: 'Score',      value: '45/50',  color: 'var(--green)' },
    { label: 'Percentage', value: '90%',    color: 'var(--green)' },
    { label: 'Result',     value: 'PASS',   color: 'var(--green)' },
    { label: 'Duration',   value: '47 min', color: null           },
  ],
  note: 'Detailed per-question results returned by sp_get_exam_results (stored procedure).',
};
