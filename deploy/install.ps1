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
# 3.1 DEPLOY-PERSISTENZORDNER (Docker Volumes)
# -------------------------------------------------------------
$DeployDataDir = Join-Path $DeployDir "data"
$DeployLogsDir = Join-Path $DeployDir "logs"

Write-Host "Erzeuge Deploy-Persistenzordner (data, logs)..."
New-Item -ItemType Directory -Force -Path $DeployDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployLogsDir | Out-Null

# -------------------------------------------------------------
# 3.2 INSTALL TRUSTED PUBLIC KEY (SIGNATURE VERIFICATION)
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
# 3.3 LEAST PRIVILEGE: Service-User anlegen + Rechte + docker-users
# -------------------------------------------------------------
$SvcUser = "CustomerDashboardSvc"
$SvcUserFull = "$env:COMPUTERNAME\$SvcUser"

# zufälliges Passwort (nur für Task/RunAs benötigt)
Add-Type -AssemblyName System.Web
$SvcPassPlain = [System.Web.Security.Membership]::GeneratePassword(32, 6)
$SvcPass = ConvertTo-SecureString $SvcPassPlain -AsPlainText -Force

# User anlegen, falls nicht vorhanden
if (Get-LocalUser -Name $SvcUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $SvcUser -Password $SvcPass
} else {
    New-LocalUser `
        -Name $SvcUser `
        -Password $SvcPass `
        -FullName "Customer Dashboard Service User" `
        -Description "Least-privilege user for Customer Dashboard" `
        -PasswordNeverExpires `
        -AccountNeverExpires | Out-Null
}

# Ordnerrechte (Modify reicht i.d.R.)
# Ordnerrechte (Modify reicht i.d.R.)
icacls $InstallDir /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $LogDir     /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $DeployDir  /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $DaemonDir  /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null


# Docker Desktop: Zugriff auf Docker Engine via Gruppe docker-users
try {
    Add-LocalGroupMember -Group "docker-users" -Member $SvcUser -ErrorAction Stop
} catch {
    Write-Warning "Konnte '$SvcUser' nicht zur Gruppe 'docker-users' hinzufügen. Prüfe Docker Desktop / Gruppenname."
}
# -------------------------------------------------------------
# 3.4 AUTOSTART: Scheduled Task (At Startup) unter Service-User
# -------------------------------------------------------------
$TaskName = "CustomerDashboardDaemon"

if (Get-LocalUser -Name $SvcUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $SvcUser -Password $SvcPass
}

# Vorhandenen Task ggf. ersetzen
try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch { }
# Task Action: node.exe daemon.js
$Action  = New-ScheduledTaskAction `
  -Execute $NodeExe `
  -Argument "`"$DaemonJs`""
  -WorkingDirectory $DaemonDir

# Trigger: beim Systemstart (läuft auch ohne Login)
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: robust, restart on failure
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

# Principal: Least Privilege, KEIN Highest
$Principal = New-ScheduledTaskPrincipal `
  -UserId $SvcUserFull `
  -LogonType Password `
  -RunLevel Limited

# Vorhandenen Task ggf. ersetzen
try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch { }

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Password $SvcPassPlain `
  -Force | Out-Null

Write-Host "Scheduled Task '$TaskName' erstellt (AtStartup) unter $SvcUserFull." -ForegroundColor Green

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
# 6. START DAEMON via Scheduled Task
# -------------------------------------------------------------
Write-Host "Starte Auto-Update-Daemon via Scheduled Task..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep 3

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Task State: $($info.State), LastResult: $($info.LastTaskResult)"


# Prüfen, ob node läuft (optional)
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
