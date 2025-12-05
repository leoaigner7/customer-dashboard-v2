Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===`n" -ForegroundColor Cyan

# -------------------------------
# 0. Installationspfade
# -------------------------------
$InstallDir = "C:\CustomerDashboard"
$DaemonDir  = "$InstallDir\system-daemon"
$DeployDir  = "$InstallDir\deploy"
$LogDir     = "$InstallDir\logs"
$TaskName   = "CustomerDashboardAutoUpdater"

# -------------------------------
# 1. Vorbereitung
# -------------------------------

Write-Host "📁 Erstelle Installationsverzeichnis..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DaemonDir  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir     | Out-Null

Write-Host "📦 Kopiere Dateien in Zielverzeichnis..."
Copy-Item -Recurse -Force ".\deploy\*"       $DeployDir
Copy-Item -Recurse -Force ".\system-daemon\*" $DaemonDir

Set-Location $DeployDir

# -------------------------------
# 2. Checks
# -------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ ERROR: Docker nicht gefunden!" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$DeployDir\$ComposeFile")) {
    Write-Host "❌ ERROR: $ComposeFile fehlt im deploy-Verzeichnis!" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "$DeployDir\.env")) {
    Write-Host "❌ ERROR: .env fehlt! Bitte kopiere .env.example → .env" -ForegroundColor Red
    exit 1
}

# Version aus .env lesen
$envLines = Get-Content "$DeployDir\.env"
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "ℹ Version: $version"
Write-Host "ℹ Port:    $port`n"

# -------------------------------
# 3. Dashboard stoppen
# -------------------------------

Write-Host "🛑 Stoppe bestehende Container..."
docker compose -f $ComposeFile down | Out-Null

# -------------------------------
# 4. Neues Image ziehen + starten
# -------------------------------

Write-Host "📥 Pull neues Image..."
docker compose -f $ComposeFile pull

Write-Host "🚀 Starte Dashboard..."
docker compose -f $ComposeFile up -d

Start-Sleep 10

# -------------------------------
# 5. HTTP-Check
# -------------------------------
$uri = "http://localhost:$port/"

Write-Host "🌐 Prüfe Dashboard unter $uri ..."
try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Dashboard erfolgreich installiert!" -ForegroundColor Green
} catch {
    Write-Host "⚠ Dashboard gestartet, aber HTTP-Check fehlgeschlagen." -ForegroundColor Yellow
}

# -------------------------------
# 6. Auto-Updater als Windows Task einrichten
# -------------------------------

Write-Host "`n🛠 Richte Auto-Update Daemon ein (Task Scheduler)..."

# Falls schon vorhanden → löschen
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute "node.exe" `
    -Argument "$DaemonDir\daemon.js"

$trigger = New-ScheduledTaskTrigger -AtStartup

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "🔧 Auto-Updater wurde eingerichtet und startet beim nächsten Systemstart."

# -------------------------------
# 7. Fertig
# -------------------------------

Write-Host "`n🎉 Installation vollständig abgeschlossen!" -ForegroundColor Green
Write-Host "➡ Dashboard erreichbar unter: $uri"
Write-Host "➡ Auto-Update läuft über Task Scheduler: $TaskName"
Write-Host "➡ Logs: $LogDir"
