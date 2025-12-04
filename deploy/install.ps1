param(
    [string]$InstallRoot = "C:\CustomerDashboard",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

Write-Host "=== Customer Dashboard Installer ==="

# -----------------------------------------
# INSTALLATIONSPFAL ANLEGEN
# -----------------------------------------
if (!(Test-Path $InstallRoot)) {
    Write-Host "Erstelle Installationsverzeichnis: $InstallRoot"
    New-Item -ItemType Directory -Path $InstallRoot | Out-Null
}

# -----------------------------------------
# RELEASE-PAKET ERKENNEN
# -----------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zip = Join-Path $scriptDir "customer-dashboard.zip"

if (!(Test-Path $zip)) {
    Write-Host "[FEHLER] Release ZIP nicht gefunden: $zip"
    exit 1
}

Write-Host "Entpacke Release-Paket..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $InstallRoot, $true)

# -----------------------------------------
# VERSION.txt AUS PAKET LESEN
# -----------------------------------------
$versionFile = Join-Path $InstallRoot "VERSION.txt"

if (!(Test-Path $versionFile)) {
    Write-Host "[FEHLER] VERSION.txt fehlt im Paket!"
    exit 1
}

$version = (Get-Content $versionFile).Trim()
Write-Host "Installierte Version: $version"

# -----------------------------------------
# .ENV GENERIEREN
# -----------------------------------------
$envPath = Join-Path $InstallRoot "deploy\.env"
Write-Host "Erstelle .env..."

Set-Content -Path $envPath -Value "APP_VERSION=$version"
Add-Content -Path $envPath "APP_PORT=8080"
Add-Content -Path $envPath "NODE_ENV=production"

Write-Host ".env erstellt."

# -----------------------------------------
# LOG-ORDNER
# -----------------------------------------
$logDir = Join-Path $InstallRoot "logs"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

Write-Host "Log-Ordner vorbereitet."

# -----------------------------------------
# SYSTEM-DAEMON PRÜFEN
# -----------------------------------------
$daemonDir = Join-Path $InstallRoot "system-daemon"

if (!(Test-Path $daemonDir)) {
    Write-Host "[FEHLER] system-daemon Ordner fehlt!"
    exit 1
}

$daemonScript = Join-Path $daemonDir "daemon.js"
Write-Host "Auto-Update-Daemon gefunden."

# -----------------------------------------
# NODE PRÜFEN
# -----------------------------------------
if (!(Test-Path $NodePath)) {
    Write-Host "[FEHLER] Node.js wurde nicht gefunden unter:"
    Write-Host "   $NodePath"
    Write-Host "Bitte Node LTS installieren!"
    exit 1
}

Write-Host "Node gefunden."

# -----------------------------------------
# NSSM INSTALLIEREN
# -----------------------------------------
$nssm = Join-Path $InstallRoot "nssm.exe"

if (!(Test-Path $nssm)) {
    Write-Host "Lade NSSM..."
    Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$InstallRoot\nssm.zip"
    [System.IO.Compression.ZipFile]::ExtractToDirectory("$InstallRoot\nssm.zip", $InstallRoot, $true)

    Copy-Item "$InstallRoot\nssm-2.24\win64\nssm.exe" -Destination $nssm
    Remove-Item "$InstallRoot\nssm-2.24" -Recurse -Force
    Remove-Item "$InstallRoot\nssm.zip"
}

Write-Host "NSSM bereit."

# -----------------------------------------
# WINDOWS SERVICE INSTALLIEREN
# -----------------------------------------
Write-Host "Installiere Windows Service 'CustomerDashboardDaemon'..."

& $nssm install "CustomerDashboardDaemon" $NodePath $daemonScript
& $nssm set "CustomerDashboardDaemon" AppDirectory $daemonDir
& $nssm set "CustomerDashboardDaemon" DisplayName "Customer Dashboard Updater"
& $nssm set "CustomerDashboardDaemon" Description "Automatischer Update-Daemon für das Customer Dashboard"
& $nssm set "CustomerDashboardDaemon" Start SERVICE_AUTO_START

& $nssm start "CustomerDashboardDaemon"

Write-Host ""
Write-Host "Auto-Update-Daemon als Service installiert und gestartet."

# -----------------------------------------
# FERTIG
# -----------------------------------------
Write-Host ""
Write-Host "------------------------------------------"
Write-Host " INSTALLATION ABGESCHLOSSEN!"
Write-Host " Dashboard aktualisiert sich automatisch."
Write-Host " Logs liegen unter: $InstallRoot\logs\daemon.log"
Write-Host "------------------------------------------"
