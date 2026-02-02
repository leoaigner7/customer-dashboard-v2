# Installer Windows
param (
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ==="

# ADMIN CHECK -> viele Schritte brauchen admin rechte
$principal = New-Object Security.Principal.WindowsPrincipal `
    ([Security.Principal.WindowsIdentity]::GetCurrent())

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Bitte PowerShell als Administrator starten."
    exit 1
}

# PATHS
# Basispfade wo alles installiert wird
$InstallDir   = "C:\CustomerDashboard"
$DeployDir    = "$InstallDir\deploy"
$DaemonDir    = "$InstallDir\system-daemon"
$LogDir       = "$InstallDir\logs"

# Pfade zur node.exe und zum Daemon-entry-point
$NodeExe   = "C:\Program Files\nodejs\node.exe"
$DaemonJs = "$DaemonDir\daemon.js"

Write-Host "Installationsverzeichnis: $InstallDir"

#  Verzeichnisse anlegen
Write-Host "Erstelle Verzeichnisse..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DaemonDir  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir     | Out-Null

#  Kopiert das Deployment und den Daemon auf das Zielsystem
Write-Host "Kopiere Dateien..."
Copy-Item -Recurse -Force "..\deploy\*"        $DeployDir
Copy-Item -Recurse -Force "..\system-daemon\*" $DaemonDir

#Ordner für Persistente Daten
$DeployDataDir = Join-Path $DeployDir "data"
$DeployLogsDir = Join-Path $DeployDir "logs"

Write-Host "Erzeuge Deploy-Persistenzordner (data, logs)..."
New-Item -ItemType Directory -Force -Path $DeployDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $DeployLogsDir | Out-Null


# Public Key wird benötigt, damit der Daemon Artefakte kryptografisch verifizieren kann 
Write-Host "Installiere Update-Signatur (Public Key)..."

$TrustDir = "$DaemonDir\trust"
$SourcePublicKey = "..\system-daemon\trust\updater-public.pem"
$TargetPublicKey = "$TrustDir\updater-public.pem"

New-Item -ItemType Directory -Force -Path $TrustDir | Out-Null

# wenn key fehlt, Update verifizierung nicht möglich - > abbruch der Installation
if (-not (Test-Path $SourcePublicKey)) {
    Write-Error "Public Key fehlt im Paket: $SourcePublicKey"
    exit 1
}
# Public Key ins Installations zecihnis kopiern
Copy-Item -Force $SourcePublicKey $TargetPublicKey

#schaun ob key wirklich angekommen ist
if (-not (Test-Path $TargetPublicKey)) {
    Write-Error "Public Key konnte nicht installiert werden."
    exit 1
}

Write-Host "Public Key erfolgreich installiert."

# Daemon soll NICHT als ADMIN laufen -> unter eingeschränkten LOKALEN USER
$SvcUser = "CustomerDashboardSvc"
$SvcUserFull = "$env:COMPUTERNAME\$SvcUser"

# zufälliges Passwort (nur für Task/RunAs benötigt)
Add-Type -AssemblyName System.Web
$SvcPassPlain = [System.Web.Security.Membership]::GeneratePassword(32, 6)
$SvcPass = ConvertTo-SecureString $SvcPassPlain -AsPlainText -Force

# User anlegen oder PW aktualisieren
if (Get-LocalUser -Name $SvcUser -ErrorAction SilentlyContinue) {

    Set-LocalUser -Name $SvcUser -Password $SvcPass
} else {
    # User neu anlegen
    New-LocalUser `
        -Name $SvcUser `
        -Password $SvcPass `
        -FullName "Customer Dashboard Service User" `
        -Description "Least-privilege user for Customer Dashboard" `
        -PasswordNeverExpires `
        -AccountNeverExpires | Out-Null
}

# Ordnerrechte setzten (modify (M) reicht in der regel)
icacls $InstallDir /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $LogDir     /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $DeployDir  /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null
icacls $DaemonDir  /grant "${SvcUserFull}:(OI)(CI)M" /T | Out-Null

# DOcker Engine wird typischerweise über Gruppe "Docker Users" gesteuert -> ohne gruppe -> docker compose evtl. nicht ausführbar
try {
    Add-LocalGroupMember -Group "docker-users" -Member $SvcUser -ErrorAction Stop
} catch {
    Write-Warning "Konnte '$SvcUser' nicht zur Gruppe 'docker-users' hinzufügen. Prüfe Docker Desktop / Gruppenname."
}

# Scheduled task der beim Booten startet -> lässt Daemon laufen ohne das ein user eingeloggt ist
$TaskName = "CustomerDashboardDaemon"

if (Get-LocalUser -Name $SvcUser -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $SvcUser -Password $SvcPass
}

# vorhandenen task entf.
try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
} catch { }


# Task Action: node.exe daemon.js ausführen
$Action  = New-ScheduledTaskAction `
  -Execute $NodeExe `
  -Argument "`"$DaemonJs`""
  -WorkingDirectory $DaemonDir

# Trigger: beim Systemstart (läuft auch ohne Login)
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: robust, fehler neustarten
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

# Principal: läuft unter service User, kein "Highest"
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


#dashboard starten
Write-Host "Starte Dashboard..."
Set-Location $DeployDir

docker compose down | Out-Null
docker compose pull
docker compose up -d


#Prüfen ob das Dashboard wirklich erreichbar ist
Write-Host "Prüfe Dashboard Healthcheck..."

$healthUrl = "http://localhost:8080/api/health"
$ok = $false

#max 20 versuche jeweils 2 sek pause 
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


#Daemon sofort starten -> damit Updates/status direkt laufen
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



Write-Host ""
Write-Host "INSTALLATION ERFOLGREICH"
Write-Host "Dashboard: http://localhost:8080/"
Write-Host "Logs: $LogDir"
