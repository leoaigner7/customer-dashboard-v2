# =========================================================
# Customer Dashboard Installer (AUTO-DEPENDENCY Windows)
# =========================================================

param (
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ===" -ForegroundColor Cyan

# 0. ADMIN CHECK
$principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Bitte Rechtsklick -> 'Als Administrator ausführen'."
    exit 1
}

# -------------------------------------------------------------
# 1. AUTO-INSTALLATION DEPENDENCIES (WINGET)
# -------------------------------------------------------------

# Funktion prüft Befehl
function Test-Command ($cmd) {
    return (Get-Command $cmd -ErrorAction SilentlyContinue)
}

# NODE.JS INSTALLIEREN
if (-not (Test-Command "node")) {
    Write-Host ">> Node.js fehlt. Installiere via Winget..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    
    Write-Host "!! WICHTIG !!" -ForegroundColor Red
    Write-Host "Node.js wurde installiert. Windows erfordert einen Neustart des Terminals/PCs, damit der Befehl 'node' gefunden wird."
    Write-Host "Bitte starte dieses Skript nach einem Neustart erneut."
    exit
} else {
    Write-Host "✔ Node.js ist installiert." -ForegroundColor Green
}

# DOCKER INSTALLIEREN
if (-not (Test-Command "docker")) {
    Write-Host ">> Docker Desktop fehlt. Installiere via Winget..." -ForegroundColor Yellow
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    
    Write-Host "!! WICHTIG !!" -ForegroundColor Red
    Write-Host "Docker Desktop wurde installiert. Du musst dich ab- und anmelden (oder Neustart), damit Docker läuft."
    exit
} else {
    # Checken ob Docker wirklich läuft
    docker info > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNUNG: Docker ist installiert, läuft aber nicht. Bitte starte 'Docker Desktop' manuell." -ForegroundColor Yellow
        # Versuch Docker zu starten
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 10
    } else {
        Write-Host "✔ Docker läuft." -ForegroundColor Green
    }
}

# -------------------------------------------------------------
# 2. STANDARD SETUP
# -------------------------------------------------------------
$InstallDir   = "C:\CustomerDashboard"
$DeployDir    = "$InstallDir\deploy"
$DaemonDir    = "$InstallDir\system-daemon"
$LogDir       = "$InstallDir\logs"

# HIER KORREKTUR: Pfad dynamisch finden statt hardcoded!
$NodeExe = (Get-Command node).Source 
$DaemonJs = "$DaemonDir\daemon.js"

Write-Host "Installiere nach: $InstallDir"

# Verzeichnisse
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DaemonDir  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir     | Out-Null

# Dateien kopieren (Relativ vom Skript-Ort)
$ScriptRoot = Split-Path $MyInvocation.MyCommand.Path
$PackageRoot = Split-Path $ScriptRoot -Parent

Write-Host "Kopiere Dateien..."
Copy-Item -Recurse -Force "$ScriptRoot\*"        $DeployDir
Copy-Item -Recurse -Force "$PackageRoot\system-daemon\*" $DaemonDir

# Public Key
$TrustDir = "$DaemonDir\trust"
$SourcePublicKey = "$PackageRoot\system-daemon\trust\updater-public.pem"
if (Test-Path $SourcePublicKey) {
    New-Item -ItemType Directory -Force -Path $TrustDir | Out-Null
    Copy-Item -Force $SourcePublicKey "$TrustDir\updater-public.pem"
    Write-Host "✔ Public Key kopiert."
}

# -------------------------------------------------------------
# 3. DOCKER START
# -------------------------------------------------------------
Write-Host "Starte Dashboard Container..."
Set-Location $DeployDir
docker compose up -d --pull always

# -------------------------------------------------------------
# 4. NODE DAEMON START
# -------------------------------------------------------------
Write-Host "Installiere Node Module für Daemon..."
Set-Location $DaemonDir
# npm install --production, aber unter Windows oft ohne sudo
cmd /c "npm install --omit=dev --silent"

Write-Host "Starte Auto-Update-Daemon..."
# Stoppe alten Prozess falls vorhanden
Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $NodeExe} | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Process -FilePath $NodeExe -ArgumentList $DaemonJs -WorkingDirectory $DaemonDir -WindowStyle Hidden

# Healthcheck
Start-Sleep -Seconds 5
Write-Host "INSTALLATION FERTIG." -ForegroundColor Green
Write-Host "Dashboard: http://localhost:8080/"