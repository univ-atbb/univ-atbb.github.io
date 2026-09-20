@echo off
set PORT=3000
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":%PORT% " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
  set FOUND=1
)
if %FOUND%==1 (
  echo Server stopped.
) else (
  echo Server is not running.
)
timeout /t 2 >nul
