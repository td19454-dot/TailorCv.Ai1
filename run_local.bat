@echo off
setlocal
cd /d "%~dp0"

set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "GIT_HTTP_PROXY="
set "GIT_HTTPS_PROXY="
set "PYTHONUTF8=1"
set "ENABLE_RELOAD=false"

set "VENV_PYTHON=C:\Users\TRISHA\Desktop\cv\.venv\Scripts\python.exe"

if not exist "%VENV_PYTHON%" (
  echo Python virtual environment not found at %VENV_PYTHON%
  exit /b 1
)

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
  echo Stopping process on port 8000: %%p
  taskkill /PID %%p /F >nul 2>&1
)

echo.
echo Starting TailorCV local server...
echo App URL: http://127.0.0.1:8000/
echo Solutions: http://127.0.0.1:8000/solutions
echo.

"%VENV_PYTHON%" main.py
