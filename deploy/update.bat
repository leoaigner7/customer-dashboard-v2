@echo off
echo Starte Deployment...

for /f "tokens=1,2 delims==" %%a in (.env) do (
  if "%%a"=="APP_VERSION" set VERSION=%%b
)

docker compose pull
docker compose up -d

echo Deployment Version %VERSION% abgeschlossen!
pause
