@echo off
:: ============================================================
::   ExamProctor — Windows Database Setup Script
::   Run this ONCE from the project root to create the schema,
::   load all indexes/triggers/procedures, and seed sample data.
::
::   Usage:
::     setup.bat
::   Then enter your MySQL root password when prompted.
:: ============================================================

:: Change to the directory where this script lives (project root)
cd /d "%~dp0"

:: ── MySQL executable ────────────────────────────────────────
:: Adjust this path if MySQL is installed elsewhere.
set MYSQL="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

if not exist %MYSQL% (
    echo ERROR: MySQL client not found at %MYSQL%
    echo Edit setup.bat and update the MYSQL variable to the correct path.
    pause
    exit /b 1
)

:: ── Credentials ─────────────────────────────────────────────
set /p DB_USER=MySQL username (default: root):
if "%DB_USER%"=="" set DB_USER=root

set /p DB_PASS=MySQL password for %DB_USER%:

echo.
echo ============================================================
echo  ExamProctor Database Setup
echo ============================================================

:: ── Step 1 : Schema (tables) ────────────────────────────────
echo [1/6] Creating schema (tables)...
%MYSQL% -u %DB_USER% -p%DB_PASS% < sql\01_schema.sql
if errorlevel 1 ( echo FAILED: Check your credentials and try again. & pause & exit /b 1 )
echo       OK

:: ── Step 2 : Indexes ────────────────────────────────────────
echo [2/6] Creating indexes...
%MYSQL% -u %DB_USER% -p%DB_PASS% < sql\02_indexes.sql
if errorlevel 1 ( echo FAILED & pause & exit /b 1 )
echo       OK

:: ── Step 3 : Triggers ───────────────────────────────────────
echo [3/6] Creating triggers...
%MYSQL% -u %DB_USER% -p%DB_PASS% < sql\03_triggers.sql
if errorlevel 1 ( echo FAILED & pause & exit /b 1 )
echo       OK

:: ── Step 4 : Stored Procedures ──────────────────────────────
:: IMPORTANT: DELIMITER // does not work when piped on Windows.
:: Using "echo source | mysql" so the mysql client's SOURCE
:: command reads the file — this correctly handles DELIMITER.
echo [4/6] Loading stored procedures (via SOURCE)...
echo source sql/04_procedures.sql | %MYSQL% -u %DB_USER% -p%DB_PASS% ExamProctor
if errorlevel 1 ( echo FAILED & pause & exit /b 1 )
echo       OK

:: ── Step 5 : Sample data ────────────────────────────────────
:: 05_sample_data.sql drops triggers first (to bypass window/
:: time validation on historical data), then re-adds them.
echo [5/6] Loading sample data...
%MYSQL% -u %DB_USER% -p%DB_PASS% < sql\05_sample_data.sql
if errorlevel 1 ( echo FAILED & pause & exit /b 1 )
echo       OK

:: ── Step 6 : Re-create triggers (dropped by sample data) ────
echo [6/6] Restoring triggers...
echo source sql/03_triggers.sql | %MYSQL% -u %DB_USER% -p%DB_PASS% ExamProctor
if errorlevel 1 ( echo FAILED & pause & exit /b 1 )
echo       OK

echo.
echo ============================================================
echo  Setup complete!
echo  Next steps:
echo    1. Copy server\.env.example to server\.env  (if needed)
echo    2. Edit server\.env  -- set DB_PASS to your password
echo    3. cd server ^&^& npm install ^&^& node server.js
echo    4. Open http://localhost:3000 in your browser
echo ============================================================
pause
