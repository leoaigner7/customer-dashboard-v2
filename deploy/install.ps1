# =========================================================
# Customer Dashboard Installer (VERSION 4.2 – CLEAN FIXED)
# =========================================================

param (
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ==="

# -------------------------------------------------------------
# 0. ADMIN CHECK
# -------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal `
    ([Security.Principal.WindowsIdentity]::GetCurrent())

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Bitte PowerShell als Administrator starten."
    exit 1
}

# -------------------------------------------------------------
# 1. PATHS
# -------------------------------------------------------------
$InstallDir   = "C:\CustomerDashboard"
$DeployDir    = "$InstallDir\deploy"
$DaemonDir    = "$InstallDir\system-daemon"
$LogDir       = "$InstallDir\logs"

$NodeExe   = "C:\Program Files\nodejs\node.exe"
$DaemonJs = "$DaemonDir\daemon.js"

Write-Host "Installationsverzeichnis: $InstallDir"

# -------------------------------------------------------------
# 2. DIRECTORIES
# -------------------------------------------------------------
Write-Host "Erstelle Verzeichnisse..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DaemonDir  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir     | Out-Null

# -------------------------------------------------------------
# 3. COPY FILES (identisch zu FINAL CLEAN)
# -------------------------------------------------------------
Write-Host "Kopiere Dateien..."
Copy-Item -Recurse -Force "..\deploy\*"        $DeployDir
Copy-Item -Recurse -Force "..\system-daemon\*" $DaemonDir
# -------------------------------------------------------------
# 3.1 INSTALL TRUSTED PUBLIC KEY (SIGNATURE VERIFICATION)
# -------------------------------------------------------------
Write-Host "Installiere Update-Signatur (Public Key)..."

$TrustDir = "$DaemonDir\trust"
$SourcePublicKey = "..\system-daemon\trust\updater-public.pem"
$TargetPublicKey = "$TrustDir\updater-public.pem"

New-Item -ItemType Directory -Force -Path $TrustDir | Out-Null

if (-not (Test-Path $SourcePublicKey)) {
    Write-Error "Public Key fehlt im Paket: $SourcePublicKey"
    exit 1
}

Copy-Item -Force $SourcePublicKey $TargetPublicKey

if (-not (Test-Path $TargetPublicKey)) {
    Write-Error "Public Key konnte nicht installiert werden."
    exit 1
}

Write-Host "Public Key erfolgreich installiert."

# -------------------------------------------------------------
# 4. DOCKER
# -------------------------------------------------------------
Write-Host "Starte Dashboard..."
Set-Location $DeployDir

docker compose down | Out-Null
docker compose pull
docker compose up -d

# -------------------------------------------------------------
# 5. HEALTHCHECK
# -------------------------------------------------------------
Write-Host "Prüfe Dashboard Healthcheck..."

$healthUrl = "http://localhost:8080/api/health"
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
    Write-Host "Dashboard erfolgreich gestartet." -ForegroundColor Green
} else {
    Write-Host "WARNUNG: Dashboard antwortet nicht, fahre fort." -ForegroundColor Yellow
}

# -------------------------------------------------------------
# 6. START NODE DAEMON (EXAKT WIE MANUELL)
# -------------------------------------------------------------
Write-Host "Starte Auto-Update-Daemon (identisch zu manuell)..."

Start-Process `
    -FilePath $NodeExe `
    -ArgumentList $DaemonJs `
    -WorkingDirectory $DaemonDir `
    -WindowStyle Hidden

Start-Sleep 2

if (-not (Get-Process node -ErrorAction SilentlyContinue)) {
    Write-Error "Node-Daemon konnte nicht gestartet werden."
    exit 1
}

Write-Host "Node läuft erfolgreich." -ForegroundColor Green

# -------------------------------------------------------------
# 7. DONE
# -------------------------------------------------------------
Write-Host ""
Write-Host "INSTALLATION ERFOLGREICH"
Write-Host "Dashboard: http://localhost:8080/"
Write-Host "Logs: $LogDir"
