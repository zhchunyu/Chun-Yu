@echo off
cd /d "%~dp0"

rem Rebuild data\graph.json from data\campus\*.json, then self-check.
rem Run this after editing the campus data, then refresh the browser.
rem
rem NOTE: keep this file ASCII-only (see the demo launcher .bat for why).

set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

echo === 1/2 rebuild graph ===
%PY% scripts\build_graph.py --out data\graph.json --check south_gate,E1
if errorlevel 1 goto fail

echo.
echo === 2/2 verify ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found - skipping automated verification
) else (
  node web\verify.js
)

echo.
echo Done. Refresh the browser to see the new data.
pause
exit /b 0

:fail
echo.
echo Rebuild FAILED - see the error above.
pause
exit /b 1
