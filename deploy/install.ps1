param(
    [string]$InstallRoot = "C:\CustomerDashboard",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$GithubApi = "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest",
    [string]$OfflineZip = "C:\CustomerDashboard\updates\customer-dashboard.zip"
)

Write-Host "=== Customer Dashboard Autoinstaller ==="

# ---------------------------------------------------------
# Robustes Entpacken
# ---------------------------------------------------------
function Unzip-Release {
    param(
        [string]$zipPath,
        [string]$destination
    )

    Write-Host "Entpacke Release..."

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $destination)
        Write-Host "Standard-Entpackung erfolgreich."
        return
    }
    catch {
        Write-Host "Standard-Entpackung fehlgeschlagen, manueller Fallback..."
    }

    try {
        $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

        foreach ($entry in $zipArchive.Entries) {
            $dest = Join-Path $destination $entry.FullName

            $dir = Split-Path $dest
            if ($dir -and !(Test-Path $dir)) {
                New-Item -ItemType Directory -Path $dir | Out-Null
            }

            if (-not $entry.Name) { continue }

            $entryStream = $entry.Open()
            $fileStream = [System.IO.File]::Open($dest, 'Create')

            $entryStream.CopyTo($fileStream)

            $fileStream.Close()
            $entryStream.Close()
        }

        $zipArchive.Dispose()
        Write-Host "Manuelle Entpackung abgeschlossen."
    }
    catch {
        Write-Host "[FEHLER] Entpacken des Release-Pakets fehlgeschlagen: $($_.Exception.Message)"
        exit 1
    }
}

# ---------------------------------------------------------
# Release-Quelle bestimmen (Offline / GitHub)
# ---------------------------------------------------------
function Find-ReleaseZip {
    Write-Host "Prüfe mögliche Quellen..."

    # Offline-Datei (kein Ordner!)
    if (Test-Path $OfflineZip -PathType Leaf) {
        Write-Host "Offline-Paket gefunden: $OfflineZip"
        return $OfflineZip
    }

    if (Test-Path $OfflineZip -PathType Container) {
        Write-Host "[WARN] Offline-Paket ist ein ORDNER, kein ZIP. Ignoriere Offline."
    }

    # GitHub
    try {
        Write-Host "Hole Release-Infos von GitHub..."
        $response = Invoke-WebRequest -Uri $GithubApi -UseBasicParsing
        $json = $response.Content | ConvertFrom-Json

        $asset = $json.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1

        if ($asset -and $asset.browser_download_url) {
            $tmp = Join-Path $env:TEMP "customer-dashboard.zip"
            Write-Host "Lade GitHub Release herunter..."
            Invoke-WebRequest $asset.browser_download_url -OutFile $tmp
            Write-Host "GitHub Download erfolgreich."
            return $tmp
        }
        else {
            Write-Host "[WARN] Kein ZIP-Asset im GitHub Release gefunden."
        }
    }
    catch {
        Write-Host "[WARN] GitHub-Release konnte nicht abgerufen werden: $($_.Exception.Message)"
    }

    return $null
}

# ---------------------------------------------------------
# ZIP bestimmen
# ---------------------------------------------------------
$zip = Find-ReleaseZip

if (-not $zip) {
    Write-Host "[FEHLER] Keine Installationsquelle gefunden."
    Write-Host "Entweder Offline-ZIP unter $OfflineZip oder GitHub-Zugriff nötig."
    exit 1
}

Write-Host "Nutze Release-Paket: $zip"

# ---------------------------------------------------------
# Installationsverzeichnis anlegen
# ---------------------------------------------------------
if (!(Test-Path $InstallRoot)) {
    Write-Host "Erstelle Installationsverzeichnis: $InstallRoot"
    New-Item -ItemType Directory -Path $InstallRoot | Out-Null
}

# ---------------------------------------------------------
# Release entpacken
# ---------------------------------------------------------
Unzip-Release -zipPath $zip -destination $InstallRoot

# ---------------------------------------------------------
# VERSION.txt lesen
# ---------------------------------------------------------
$versionFile = Join-Path $InstallRoot "VERSION.txt"

if (!(Test-Path $versionFile)) {
    Write-Host "[FEHLER] VERSION.txt fehlt im Release!"
    exit 1
}

$version = (Get-Content $versionFile).Trim()
Write-Host "Installierte Version: $version"

# ---------------------------------------------------------
# .env erzeugen
# ---------------------------------------------------------
$envPath = Join-Path $InstallRoot "deploy\.env"

Set-Content $envPath "APP_VERSION=$version"
Add-Content $envPath "APP_PORT=8080"
Add-Content $envPath "NODE_ENV=production"

Write-Host ".env erstellt."

# ---------------------------------------------------------
# Log-Verzeichnis
# ---------------------------------------------------------
$logDir = Join-Path $InstallRoot "logs"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory $logDir | Out-Null
}
Write-Host "Log-Verzeichnis vorbereitet."

# ---------------------------------------------------------
# system-daemon prüfen
# ---------------------------------------------------------
$daemonDir = Join-Path $InstallRoot "system-daemon"
$daemonScript = Join-Path $daemonDir "daemon.js"

if (!(Test-Path $daemonScript)) {
    Write-Host "[FEHLER] daemon.js im system-daemon fehlt!"
    exit 1
}

Write-Host "Auto-Update-Daemon gefunden."

# ---------------------------------------------------------
# Node prüfen
# ---------------------------------------------------------
if (!(Test-Path $NodePath)) {
    Write-Host "[FEHLER] Node.js nicht gefunden: $NodePath"
    exit 1
}

Write-Host "Node gefunden."

# ---------------------------------------------------------
# NSSM für Windows-Service einrichten
# ---------------------------------------------------------
Write-Host "Installiere Windows Service 'CustomerDashboardDaemon'..."

$serviceName = "CustomerDashboardDaemon"
$serviceDisplay = "Customer Dashboard Updater"
$serviceDescription = "Automatischer Update-Daemon für das Customer Dashboard"

$nssmExe = Join-Path $InstallRoot "nssm.exe"
$nssmZip = Join-Path $InstallRoot "nssm.zip"

# alten Dienst löschen, falls vorhanden
if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    Write-Host "Dienst existiert bereits. Stoppe und entferne alten Dienst..."
    sc.exe stop $serviceName | Out-Null
    sc.exe delete $serviceName | Out-Null
    Start-Sleep -Seconds 2
}

if (!(Test-Path $nssmExe)) {
    Write-Host "Lade NSSM..."
    Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($nssmZip, $InstallRoot)

    $nssmSource = Join-Path $InstallRoot "nssm-2.24\win64\nssm.exe"
    if (!(Test-Path $nssmSource)) {
        Write-Host "[FEHLER] nssm.exe wurde im ZIP nicht gefunden."
        exit 1
    }

    Copy-Item $nssmSource $nssmExe -Force

    Remove-Item (Join-Path $InstallRoot "nssm-2.24") -Recurse -Force
    Remove-Item $nssmZip -Force
}

Write-Host "NSSM installiert."

# Dienst installieren
& $nssmExe install $serviceName $NodePath $daemonScript
& $nssmExe set $serviceName AppDirectory $daemonDir
& $nssmExe set $serviceName DisplayName $serviceDisplay
& $nssmExe set $serviceName Description $serviceDescription
& $nssmExe set $serviceName Start SERVICE_AUTO_START

# Dienst starten
try {
    Start-Service $serviceName
    Write-Host "Windows-Service wurde gestartet."
} catch {
    Write-Host "[WARNUNG] Dienst konnte nicht gestartet werden: $($_.Exception.Message)"
}

# ---------------------------------------------------------
# Dashboard über Docker Compose starten
# ---------------------------------------------------------
$composeFile = Join-Path $InstallRoot "deploy\docker-compose.yml"

if (Test-Path $composeFile) {
    Write-Host "Starte Dashboard über docker compose..."
    docker compose -f $composeFile up -d
} else {
    Write-Host "[WARNUNG] docker-compose.yml wurde nicht gefunden: $composeFile"
}

Write-Host ""
Write-Host "==========================================="
Write-Host " INSTALLATION ABGESCHLOSSEN"
Write-Host " Dashboard und Auto-Update-Daemon sind eingerichtet."
Write-Host "==========================================="
