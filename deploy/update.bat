@echo off
echo Starte Deployment (Version 2)...

for /f "tokens=1,2 delims==" %%a in (.env) do (
  if "%%a"=="APP_VERSION" set VERSION=%%b
)

docker compose pull
docker compose up -d

echo Deployment V2 Version %VERSION% abgeschlossen!
pause
