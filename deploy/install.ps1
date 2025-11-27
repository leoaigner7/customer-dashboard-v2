Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===`n" -ForegroundColor Cyan

# -------------------------------------------------------------
# 1. Bestimme Verzeichnisse
# -------------------------------------------------------------

# Ordner, in dem das Skript liegt -> ...\deploy
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Root des Pakets -> ...\customer-dashboard-v2-X.X.X
$packageRoot = Split-Path -Parent $deployDir

# Zielpfade beim Kunden
$InstallDir = "C:\CustomerDashboard"
$TargetDeploy = "$InstallDir\deploy"
$TargetDaemon = "$InstallDir\system-daemon"
$LogDir = "$InstallDir\logs"
$TaskName = "CustomerDashboardAutoUpdater"

Write-Host "Installer liegt in:      $deployDir"
Write-Host "Paketwurzelverzeichnis: $packageRoot`n"


# -------------------------------------------------------------
# 2. Zielverzeichnis erstellen
# -------------------------------------------------------------
Write-Host "📁 Erstelle Installationsverzeichnis..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDeploy | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDaemon | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null


# -------------------------------------------------------------
# 3. Dateien kopieren (aus deploy/ und system-daemon/)
# -------------------------------------------------------------
Write-Host "📦 Kopiere Dateien..."

# kopiere deploy/
Copy-Item -Recurse -Force "$deployDir\*" $TargetDeploy

# kopiere system-daemon/
if (-not (Test-Path "$packageRoot\system-daemon")) {
    Write-Host "❌ FEHLER: system-daemon wurde im Paket nicht gefunden!" -ForegroundColor Red
    exit 1
}
Copy-Item -Recurse -Force "$packageRoot\system-daemon\*" $TargetDaemon


# -------------------------------------------------------------
# 4. Arbeitsverzeichnis setzen
# -------------------------------------------------------------
Set-Location $TargetDeploy


# -------------------------------------------------------------
# 5. .env prüfen
# -------------------------------------------------------------
if (-not (Test-Path ".\.env")) {
    Write-Host "❌ .env fehlt im deploy Ordner!" -ForegroundColor Red
    exit 1
}

$envLines = Get-Content ".\.env"
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8088" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"


# -------------------------------------------------------------
# 6. Docker: alten Container stoppen
# -------------------------------------------------------------
Write-Host "🛑 Stoppe alte Dashboard-Container..."
docker compose down | Out-Null


# -------------------------------------------------------------
# 7. Neues Image pullen + starten
# -------------------------------------------------------------
Write-Host "📥 Lade aktuelles Image..."
docker compose pull

Write-Host "🚀 Starte Dashboard..."
docker compose up -d

Start-Sleep 10


# -------------------------------------------------------------
# 8. HTTP Check
# -------------------------------------------------------------
Write-Host "🌐 Prüfe Dashboard..."

$uri = "http://localhost:$port/"

try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Dashboard erfolgreich gestartet!" -ForegroundColor Green
} catch {
    Write-Host "⚠ Dashboard läuft, aber HTTP Test fehlgeschlagen." -ForegroundColor Yellow
}


# -------------------------------------------------------------
# 9. AUTO-UPDATE DAEMON INSTALLIEREN
# -------------------------------------------------------------
Write-Host "🛠 Installiere Auto-Update Daemon..."

# wenn Task existiert -> löschen
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute "node.exe" `
    -Argument "$TargetDaemon\daemon.js"

$trigger = New-ScheduledTaskTrigger -AtStartup

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "🔧 Auto-Update Daemon installiert und aktiviert."


# -------------------------------------------------------------
# 10. FERTIG
# -------------------------------------------------------------
Write-Host "`n🎉 INSTALLATION ABGESCHLOSSEN!" -ForegroundColor Green
Write-Host "➡ Dashboard: http://localhost:$port/"
Write-Host "➡ Auto-Update über Task Scheduler: $TaskName"
Write-Host "➡ Logs: $LogDir"
