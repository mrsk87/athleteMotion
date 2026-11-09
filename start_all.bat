@echo off
cd /d "%~dp0"
echo ========================================================
echo   A iniciar Athlete Motion: Backend + Frontend Web
echo ========================================================

echo 1. A arrancar Backend (FastAPI / WebSocket)...
if exist "backend\.venv\Scripts\python.exe" (
    start "AthleteMotion - Backend API" cmd /k "cd /d "%~dp0backend" && "..\backend\.venv\Scripts\python.exe" -m athletemotion.api"
) else (
    start "AthleteMotion - Backend API" cmd /k "cd /d "%~dp0backend" && python -m athletemotion.api"
)

if exist "%APPDATA%\AthleteMotion\api_token" (
    for /f "usebackq delims=" %%t in ("%APPDATA%\AthleteMotion\api_token") do (
        echo VUE_APP_API_TOKEN=%%t> "frontend\web\.env.local"
        echo VUE_APP_API_URL=http://localhost:8000>> "frontend\web\.env.local"
        echo VUE_APP_WS_URL=ws://localhost:8000>> "frontend\web\.env.local"
    )
)

echo 2. A arrancar Frontend (Vue 3)...
start "AthleteMotion - Frontend Web" cmd /k "cd /d "%~dp0frontend\web" && npm run serve"

echo.
echo Ambos os servicos foram iniciados em janelas dedicadas:
echo - Backend API:  http://127.0.0.1:8000/docs
echo - Frontend Web: http://localhost:8080
echo ========================================================
pause
