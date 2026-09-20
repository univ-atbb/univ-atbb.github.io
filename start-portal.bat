@echo off
setlocal
cd /d "%~dp0"
set PORT=3000

rem If the server is already running, just open the browser
netstat -ano | findstr /r ":%PORT% " | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%
  exit /b 0
)

rem Start the server hidden (no CMD window), log goes to serve.log
wscript //b "%~dp0serve-hidden.vbs"

rem Wait for the server to be ready (max ~30 seconds)
set /a t=0
:wait
timeout /t 1 /nobreak >nul
netstat -ano | findstr /r ":%PORT% " | findstr "LISTENING" >nul
if %errorlevel%==0 goto open
set /a t+=1
if %t% lss 30 goto wait
start "" mshta vbscript:MsgBox("Tender Portal: the server could not start. Check the file serve.log and your internet connection.",48,"Tender Portal")&close()
exit /b 1

:open
start "" http://localhost:%PORT%
exit /b 0
