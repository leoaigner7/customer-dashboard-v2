# =========================================================
# BACHELOR THESIS INSTALLER (WINDOWS SOURCE BUILD)
# =========================================================

param (
    [string]$ComposeFile = "docker-compose.yml"
)

# 1. ADMIN RECHTE PRÜFEN
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Bitte Rechtsklick -> 'Als Administrator ausführen'."
    exit 1
}

Write-Host "=== Customer Dashboard Installer (Windows) ===" -ForegroundColor Cyan

# -------------------------------------------------------------
# 2. SYSTEM-CHECK (Node & Docker)
# -------------------------------------------------------------
function Test-Command ($cmd) { return (Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Test-Command "node")) {
    Write-Host ">> Node.js fehlt. Installiere via Winget..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Write-Host "!! WICHTIG !! Node.js wurde installiert." -ForegroundColor Red
    Write-Host "Bitte starte den Computer neu und führe dieses Skript danach noch einmal aus." -ForegroundColor Red
    exit
}

if (-not (Test-Command "docker")) {
    Write-Host ">> Docker Desktop fehlt. Installiere via Winget..." -ForegroundColor Yellow
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    Write-Host "!! WICHTIG !! Docker wurde installiert." -ForegroundColor Red
    Write-Host "Bitte starte den Computer neu und führe dieses Skript danach noch einmal aus." -ForegroundColor Red
    exit
}

# Prüfen ob Docker läuft
if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Write-Host ">> Starte Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
    Write-Host "   Warte auf Docker Engine..."
    $retries = 0
    while ($true) {
        docker info > $null 2>&1
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 2
        Write-Host -NoNewline "."
        $retries++
        if ($retries -gt 30) { Write-Error "Docker startet nicht. Bitte manuell prüfen."; exit 1 }
    }
    Write-Host " Bereit."
}

# -------------------------------------------------------------
# 3. DATEIEN KOPIEREN
# -------------------------------------------------------------
$InstallDir   = "C:\CustomerDashboard"
$DeployDir    = "$InstallDir\deploy"
$DaemonDir    = "$InstallDir\system-daemon"
$FrontendDir  = "$InstallDir\app\frontend"
$LogDir       = "$InstallDir\logs"

# Wo sind wir?
$ScriptRoot = Split-Path $MyInvocation.MyCommand.Path
$SourceRoot = Split-Path $ScriptRoot -Parent

Write-Host ">> Installiere nach: $InstallDir"

# Ordner bereinigen für sauberen Build
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Kopieren
Copy-Item -Recurse -Force "$SourceRoot\*" $InstallDir

# -------------------------------------------------------------
# 4. FRONTEND BAUEN
# -------------------------------------------------------------
Write-Host ">> Baue Frontend (React)..." -ForegroundColor Cyan
Set-Location $FrontendDir

# Abhängigkeiten installieren & Bauen
cmd /c "npm install --silent"
cmd /c "npm run build"

if (-not (Test-Path "dist\index.html")) {
    Write-Error "Frontend Build fehlgeschlagen! 'dist/index.html' wurde nicht erstellt."
    exit 1
}
Write-Host "✔ Frontend gebaut." -ForegroundColor Green

# -------------------------------------------------------------
# 5. DAEMON VORBEREITEN
# -------------------------------------------------------------
Write-Host ">> Bereite Daemon vor..." -ForegroundColor Cyan
Set-Location $DaemonDir
# Windows-spezifische Dependencies installieren
cmd /c "npm install --omit=dev --silent"

# Key sicherstellen
$TrustDir = "$DaemonDir\trust"
if (-not (Test-Path "$TrustDir\updater-public.pem")) {
    New-Item -ItemType Directory -Force -Path $TrustDir | Out-Null
    Copy-Item -Force "$InstallDir\system-daemon\trust\updater-public.pem" "$TrustDir\"
}

# -------------------------------------------------------------
# 6. DOCKER STARTEN
# -------------------------------------------------------------
Write-Host ">> Starte Docker Container..." -ForegroundColor Cyan
Set-Location $DeployDir
docker compose down --volumes --remove-orphans 2>$null
docker compose up -d --build --remove-orphans

# -------------------------------------------------------------
# 7. DAEMON STARTEN
# -------------------------------------------------------------
Write-Host ">> Starte Update-Daemon..."
$NodeExe = (Get-Command node).Source
$DaemonJs = "$DaemonDir\daemon.js"

# Alten Daemon killen
Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $NodeExe} | Stop-Process -Force -ErrorAction SilentlyContinue

# Daemon unsichtbar starten
Start-Process -FilePath $NodeExe -ArgumentList $DaemonJs -WorkingDirectory $DaemonDir -WindowStyle Hidden

Write-Host "Warte auf Healthcheck..."
Start-Sleep -Seconds 10

# Finaler Check
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
        Write-Host "INSTALLATION ERFOLGREICH!" -ForegroundColor Green
        Write-Host "   Dashboard: http://localhost:8080/"
    }
} catch {
    Write-Host "Container startet noch (Boot dauert etwas). Prüfe gleich: http://localhost:8080/" -ForegroundColor Yellow
}