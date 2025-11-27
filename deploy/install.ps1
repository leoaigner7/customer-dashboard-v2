# Customer Dashboard Installer for Windows
# VERSION 4.1.3 FINAL CLEAN

Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===`n" -ForegroundColor Cyan

# -------------------------------------------------------------
# 0. ADMIN CHECK
# -------------------------------------------------------------
If (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(`
    [Security.Principal.WindowsBuiltInRole] "Administrator"))
{
    Write-Host "Dieses Skript muss als ADMINISTRATOR ausgefuehrt werden!" -ForegroundColor Red
    Write-Host "Rechtsklick auf PowerShell 'Als Administrator ausführen'" -ForegroundColor Yellow
    exit 1
}

# -------------------------------------------------------------
# 1. Verzeichnisse bestimmen
# -------------------------------------------------------------

$deployDir   = $PSScriptRoot
$packageRoot = Split-Path -Parent $PSScriptRoot


$InstallDir   = "C:\CustomerDashboard"
$TargetDeploy = "$InstallDir\deploy"
$TargetDaemon = "$InstallDir\system-daemon"
$LogDir       = "$InstallDir\logs"
$TaskName     = "CustomerDashboardAutoUpdater"

Write-Host "Installer liegt in:      $deployDir"
Write-Host "Paketwurzelverzeichnis: $packageRoot`n"


# -------------------------------------------------------------
# 2. Installationsverzeichnisse
# -------------------------------------------------------------
Write-Host "Erstelle Installationsverzeichnisse..."
New-Item -ItemType Directory -Force -Path $InstallDir    | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDeploy  | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDaemon  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir        | Out-Null


# -------------------------------------------------------------
# 3. Robuster Kopiervorgang (mit Retry)
# -------------------------------------------------------------
function Copy-WithRetry($source, $target) {
    $success = $false

    for ($i=1; $i -le 5; $i++) {
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
Copy-WithRetry "$deployDir\*" $TargetDeploy

if (Test-Path "$deployDir\.env") {
    Copy-WithRetry "$deployDir\.env" $TargetDeploy
}

$daemonSource = "$packageRoot\system-daemon"
if (-not (Test-Path $daemonSource)) {
    Write-Host "system-daemon wurde nicht gefunden!" -ForegroundColor Red
    exit 1
}
Copy-WithRetry "$daemonSource\*" $TargetDaemon


# -------------------------------------------------------------
# 4. .env prüfen
# -------------------------------------------------------------
$envPath = "$TargetDeploy\.env"

$maxWait = 20
$envFound = $false

for ($i = 1; $i -le $maxWait; $i++) {
    if (Test-Path $envPath) {
        $envFound = $true
        break
    }
    Start-Sleep -Milliseconds 200
}

if (-not $envFound) {
    Write-Host "ERROR: .env is not visible in C:\CustomerDashboard\deploy."
    Write-Host "Files are copied correctly, but filesystem has not released the handle."
    Write-Host "Stopping installation for safety."
    exit 1
}


$envLines = Get-Content $envPath
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"


# -------------------------------------------------------------
# 5. Docker Compose Pfad
# -------------------------------------------------------------
$composeFilePath = Join-Path $TargetDeploy $ComposeFile

if (-not (Test-Path $composeFilePath)) {
    Write-Host "docker-compose.yml fehlt!" -ForegroundColor Red
    exit 1
}

# -------------------------------------------------------------
# 6. Docker stoppen
# -------------------------------------------------------------
Write-Host "Stoppe alte Dashboard-Container..."
docker compose -f "$composeFilePath" down | Out-Null


# -------------------------------------------------------------
# 7. Docker starten
# -------------------------------------------------------------
Write-Host "⬇Lade aktuelles Image..."
docker compose -f "$composeFilePath" pull

Write-Host "Starte Dashboard..."
docker compose -f "$composeFilePath" up -d

Start-Sleep 10


# -------------------------------------------------------------
# 8. HTTP-Test
# -------------------------------------------------------------
Write-Host "pruefe Dashboard..."

$uri = "http://localhost:$port/"

try {
    Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Host "Dashboard erfolgreich gestartet!" -ForegroundColor Green
} catch {
    Write-Host "Dashboard läuft, aber HTTP-Test fehlgeschlagen." -ForegroundColor Yellow
}


# -------------------------------------------------------------
# 9. Auto-Update Task
# -------------------------------------------------------------
Write-Host "Installiere Auto-Update Daemon..."

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "$TargetDaemon\daemon.js"
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
Write-Host "`nINSTALLATION ABGESCHLOSSEN!" -ForegroundColor Green
Write-Host "Dashboard: http://localhost:$port/"
Write-Host "Auto-Update: $TaskName"
Write-Host "Logs: $LogDir"
