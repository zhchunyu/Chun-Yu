@echo off
cd /d "%~dp0"

rem Regression gate for AI-assisted development: 37 assertions, exit code is
rem the verdict. No browser, no screenshots, no eyeballing required.
rem
rem NOTE: keep this file ASCII-only (see the demo launcher .bat for why).

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the verification suite.
  pause
  exit /b 1
)

node web\verify.js
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo ALL PASSED) else (echo FAILURES - see above)
pause
exit /b %RC%
