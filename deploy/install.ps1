# Customer Dashboard Installer for Windows
# VERSION 4.2 – FIXED HEALTHCHECK + SAFE START ORDER

Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===`n" -ForegroundColor Cyan

# -------------------------------------------------------------
# 0. ADMIN CHECK
# -------------------------------------------------------------
If (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole] "Administrator"))
{
    Write-Host "Dieses Skript muss als ADMINISTRATOR ausgeführt werden!" -ForegroundColor Red
    Write-Host "Rechtsklick auf PowerShell → 'Als Administrator ausführen'" -ForegroundColor Yellow
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


# SYSTEM-Rechte setzen (kritisch für Daemon!)
cmd /c "icacls `"$InstallDir`" /grant SYSTEM:(OI)(CI)F /T" | Out-Null

# -------------------------------------------------------------
# 3. Robuster Kopiervorgang
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
    Write-Host "ERROR: .env ist nicht sichtbar in C:\CustomerDashboard\deploy!"
    exit 1
}

$envLines = Get-Content $envPath
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"

# -------------------------------------------------------------
# 5. Compose-Datei prüfen
# -------------------------------------------------------------
$composeFilePath = Join-Path $TargetDeploy $ComposeFile
if (-not (Test-Path $composeFilePath)) {
    Write-Host "docker-compose.yml fehlt!" -ForegroundColor Red
    exit 1
}

# -------------------------------------------------------------
# 6. Container stoppen
# -------------------------------------------------------------
Write-Host "Stoppe alte Dashboard-Container..."
docker compose -f "$composeFilePath" down | Out-Null

# -------------------------------------------------------------
# 7. Neues Image laden + Container starten
# -------------------------------------------------------------
Write-Host "⬇ Lade aktuelles Image..."
docker compose -f "$composeFilePath" pull

Write-Host "Starte Dashboard..."
docker compose -f "$composeFilePath" up -d

# -------------------------------------------------------------
# 8. ROBUSTER HEALTHCHECK (statt 10 Sekunden warten)
# -------------------------------------------------------------
Write-Host "Pruefe Dashboard Healthcheck..."

$healthUrl = "http://localhost:$port/api/health"
$ok = $false

for ($i = 1; $i -le 20; $i++) {
    try {
        $res = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
        if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 400) {
            $ok = $true
            break
        }
    } catch { }

    Start-Sleep -Seconds 2
}

if ($ok) {
    Write-Host "Dashboard erfolgreich gestartet!" -ForegroundColor Green
} else {
    Write-Host "WARNUNG: Dashboard antwortet nicht sauber, fahre trotzdem fort." -ForegroundColor Yellow
}



Write-Host "[5/7] Installiere Auto-Update-Daemon (manueller Start automatisiert)..."

$TaskName = "CustomerDashboardAutoUpdater"
$CmdFile  = "$TargetDaemon\run-daemon.cmd"

# -------------------------------------------------------------
# CMD-Wrapper erzeugen (EXAKT wie manueller Start)
# -------------------------------------------------------------
@"
@echo off
cd /d C:\CustomerDashboard\system-daemon
"C:\Program Files\nodejs\node.exe" "daemon.js"
"@ | Set-Content -Encoding ASCII $CmdFile

# -------------------------------------------------------------
# Alten Task entfernen
# -------------------------------------------------------------
schtasks /delete /tn $TaskName /f 2>$null | Out-Null

# -------------------------------------------------------------
# Scheduled Task = identisch zu manuellem Start
# -------------------------------------------------------------
schtasks /create `
 /tn $TaskName `
 /tr "`"$CmdFile`"" `
 /sc onstart `
 /ru "$env:USERNAME" `
 /rl HIGHEST `
 /f

# -------------------------------------------------------------
# Sofort starten
# -------------------------------------------------------------
schtasks /run /tn $TaskName
Start-Sleep -Seconds 3

# -------------------------------------------------------------
# Verifikation
# -------------------------------------------------------------
if (-not (Get-Process node -ErrorAction SilentlyContinue)) {
    Write-Host "FEHLER: Node läuft nicht!" -ForegroundColor Red
    exit 1
}

Write-Host "Auto-Update-Daemon läuft dauerhaft." -ForegroundColor Green



# -------------------------------------------------------------
# 10. Fertig
# -------------------------------------------------------------
Write-Host "`nINSTALLATION ABGESCHLOSSEN!" -ForegroundColor Green
Write-Host "Dashboard: http://localhost:$port/"
Write-Host "Auto-Update: $TaskName"
Write-Host "Logs: $LogDir"
