@echo off
REM Wait! A computer can do that?  - double-click to start the demos, then keep this window open.
cd /d "%~dp0"
set PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe
if not exist "%PY%" set PY=python
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8800/"
"%PY%" -m http.server 8800 --bind 127.0.0.1
