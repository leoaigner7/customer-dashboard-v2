@echo off
echo ----------------------------------------
echo     Customer Dashboard Update (WIN)
echo ----------------------------------------

REM Prüfen ob .env vorhanden ist
IF NOT EXIST ".env" (
    echo ❌ Fehler: .env nicht gefunden!
    pause
    exit /b 1
)

REM Version & Port aus .env lesen
for /f "tokens=1,2 delims==" %%a in (.env) do (
    if "%%a"=="APP_VERSION" set APP_VERSION=%%b
    if "%%a"=="APP_PORT" set APP_PORT=%%b
)

echo 📄 Konfiguration geladen:
echo    APP_VERSION = %APP_VERSION%
echo    APP_PORT    = %APP_PORT%
echo.

REM Docker vorhanden?
docker --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ❌ Docker ist nicht installiert!
    pause
    exit /b 1
)

REM Docker Compose vorhanden?
docker compose version >nul 2>&1
IF ERRORLEVEL 1 (
    echo ❌ Docker Compose ist nicht installiert!
    pause
    exit /b 1
)

echo 🐳 Lade Image: ghcr.io/leoaigner7/customer-dashboard-v2:%APP_VERSION%
docker compose pull

echo 🔁 Starte Container neu ...
docker compose up -d

echo ⏳ Warte 5 Sekunden ...
timeout /t 5 >nul

echo 🌐 Pruefe Erreichbarkeit: http://localhost:%APP_PORT%/
curl -f http://localhost:%APP_PORT%/ >nul 2>&1
IF ERRORLEVEL 1 (
    echo ❌ Anwendung NICHT erreichbar!
    echo 🔍 Logs:
    docker compose logs --tail=50
    pause
    exit /b 1
)

echo 🎉 Update erfolgreich! Version %APP_VERSION% läuft.
echo ----------------------------------------
pause
