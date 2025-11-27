Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===`n" -ForegroundColor Cyan

# -------------------------------------------------------------
# 1. Verzeichnisse bestimmen
# -------------------------------------------------------------

$deployDir   = Split-Path -Parent $MyInvocation.MyCommand.Path          # ...\deploy
$packageRoot = Split-Path -Parent $deployDir                            # ...\customer-dashboard-x.x.x

$InstallDir    = "C:\CustomerDashboard"
$TargetDeploy  = "$InstallDir\deploy"
$TargetDaemon  = "$InstallDir\system-daemon"
$LogDir        = "$InstallDir\logs"
$TaskName      = "CustomerDashboardAutoUpdater"

Write-Host "Installer liegt in:      $deployDir"
Write-Host "Paketwurzelverzeichnis: $packageRoot`n"


# -------------------------------------------------------------
# 2. Zielverzeichnis erstellen
# -------------------------------------------------------------
Write-Host "Erstelle Installationsverzeichnisse..."

New-Item -ItemType Directory -Force -Path $InstallDir      | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDeploy    | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDaemon    | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir          | Out-Null


# -------------------------------------------------------------
# 3. Dateien kopieren (stabil, mit Retry)
# -------------------------------------------------------------
function Copy-WithRetry($source, $target) {
    $success = $false

    for ($i = 1; $i -le 5; $i++) {
        try {
            Copy-Item -Recurse -Force $source $target
            $success = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $success) {
        Write-Host "FEHLER: Kopieren von $source nach $target fehlgeschlagen!" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Kopiere Dateien..."

# deploy/
Copy-WithRetry "$deployDir\*" $TargetDeploy

# system-daemon/
$daemonSource = "$packageRoot\system-daemon"
if (-not (Test-Path $daemonSource)) {
    Write-Host "FEHLER: system-daemon wurde im Paket nicht gefunden!" -ForegroundColor Red
    exit 1
}
Copy-WithRetry "$daemonSource\*" $TargetDaemon


# -------------------------------------------------------------
# 4. Arbeitsverzeichnis
# -------------------------------------------------------------
Set-Location $TargetDeploy


# -------------------------------------------------------------
# 5. .env prüfen
# -------------------------------------------------------------
if (-not (Test-Path ".\.env")) {
    Write-Host ".env fehlt im deploy Ordner!" -ForegroundColor Red
    exit 1
}

$envLines = Get-Content ".\.env"
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"


# -------------------------------------------------------------
# 6. Docker: alten Container stoppen
# -------------------------------------------------------------
Write-Host "Stoppe alte Dashboard-Container..."
docker compose down | Out-Null


# -------------------------------------------------------------
# 7. Neues Image + Start
# -------------------------------------------------------------
Write-Host "Lade aktuelles Image..."
docker compose pull

Write-Host "Starte Dashboard..."
docker compose up -d

Start-Sleep 10


# -------------------------------------------------------------
# 8. HTTP Check
# -------------------------------------------------------------
Write-Host "Prüfe Dashboard..."

$uri = "http://localhost:$port/"

try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
    Write-Host "Dashboard erfolgreich gestartet!" -ForegroundColor Green
} catch {
    Write-Host "Dashboard läuft, aber HTTP Test fehlgeschlagen." -ForegroundColor Yellow
}


# -------------------------------------------------------------
# 9. Auto-Update installieren
# -------------------------------------------------------------
Write-Host "Installiere Auto-Update Daemon..."

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

Write-Host "Auto-Update Daemon installiert."


# -------------------------------------------------------------
# 10. Fertig
# -------------------------------------------------------------
Write-Host "`n INSTALLATION ABGESCHLOSSEN!" -ForegroundColor Green
Write-Host "Dashboard: http://localhost:$port/"
Write-Host "Auto-Update: $TaskName"
Write-Host "Logs: $LogDir"
