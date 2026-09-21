@echo off
cd /d "%~dp0"

rem Start the local static server and open the browser.
rem
rem Why a plain .bat instead of a packaged .exe:
rem   an .exe is a binary black box that AI tools cannot read or diff.
rem   Here the whole launcher is one command; the real source is
rem   scripts\start_server.py (plain Python, editable by humans and AI).
rem
rem NOTE: keep this file ASCII-only. cmd.exe parses UTF-8 .bat files by byte
rem offset and mangles non-ASCII lines (it can even eat the next command).

set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

echo Interpreter: %PY%
%PY% scripts\start_server.py
pause
