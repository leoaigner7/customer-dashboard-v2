param(
    [string]$InstallRoot = "C:\CustomerDashboard",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$GithubApi = "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest",
    [string]$OfflineZip = "C:\CustomerDashboard\updates\customer-dashboard.zip"
)

Write-Host "=== Customer Dashboard Autoinstaller ==="

# -----------------------------------------
# FUNKTION: Release-Quelle ermitteln
# -----------------------------------------
function Find-ReleaseZip {
    Write-Host "Prüfe mögliche Quellen..."

    # 1) OFFLINE ZIP prüfen (ECHTE Datei)
    if (Test-Path $OfflineZip -PathType Leaf) {
        Write-Host "Offline-Paket gefunden: $OfflineZip"
        return $OfflineZip
    }

    # Falls ein Ordner existiert → Warnen & ignorieren
    if (Test-Path $OfflineZip -PathType Container) {
        Write-Host "[WARN] Offline-Paket ist ein ORDNER, kein ZIP. Ignoriere Offline-Quelle."
    }

    # 2) GitHub Release
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
    }
    catch {
        Write-Host "[WARN] GitHub nicht erreichbar."
    }

    return $null
}

# -----------------------------------------
# RELEASE ZIP LADEN
# -----------------------------------------
$zip = Find-ReleaseZip

if (-not $zip) {
    Write-Host "[FEHLER] Keine Installationsquelle gefunden!"
    Write-Host "Offline erwartet: $OfflineZip"
    Write-Host "oder funktionierende Internetverbindung (GitHub)."
    exit 1
}

Write-Host "Nutze Release-Paket: $zip"

# -----------------------------------------
# INSTALLATIONSVERZEICHNIS ANLEGEN
# -----------------------------------------
if (!(Test-Path $InstallRoot)) {
    Write-Host "Erstelle Installationsverzeichnis: $InstallRoot"
    New-Item -ItemType Directory -Path $InstallRoot | Out-Null
}

# -----------------------------------------
# FUNKTION: Robustes und Fehlerfreies Zip-Entpacken
# -----------------------------------------
function Expand-ReleaseZip($zipPath, $destination) {

    Write-Host "Entpacke Release..."

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $destination)
        Write-Host "Standard-Entpackung erfolgreich."
        return
    }
    catch {
        Write-Host "Standard-Entpackung fehlgeschlagen, starte manuelle Entpackung..."
    }

    $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $zipArchive.Entries) {
            $dest = Join-Path $destination $entry.FullName

            $dir = Split-Path $dest
            if (!(Test-Path $dir)) {
                New-Item -ItemType Directory -Path $dir | Out-Null
            }

            if (-not $entry.Name) { continue }

            $entryStream = $entry.Open()
            $fileStream = [System.IO.File]::Open($dest, 'Create')
            $entryStream.CopyTo($fileStream)
            $fileStream.Close()
            $entryStream.Close()
        }
    }
    finally {
        $zipArchive.Dispose()
    }

    Write-Host "Manuelle Entpackung abgeschlossen."
}

# -----------------------------------------
# RELEASE ENTZIPEN
# -----------------------------------------
Expand-ReleaseZip -zipPath $zip -destination $InstallRoot

# -----------------------------------------
# VERSION.txt lesen
# -----------------------------------------
$versionFile = Join-Path $InstallRoot "VERSION.txt"

if (!(Test-Path $versionFile)) {
    Write-Host "[FEHLER] VERSION.txt fehlt im Release!"
    exit 1
}

$version = (Get-Content $versionFile).Trim()
Write-Host "Installierte Version: $version"

# -----------------------------------------
# .env generieren
# -----------------------------------------
$envPath = Join-Path $InstallRoot "deploy\.env"

Set-Content $envPath "APP_VERSION=$version"
Add-Content $envPath "APP_PORT=8080"
Add-Content $envPath "NODE_ENV=production"

Write-Host ".env erstellt."

# -----------------------------------------
# LOG ORDNER
# -----------------------------------------
$logDir = Join-Path $InstallRoot "logs"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory $logDir | Out-Null
}

Write-Host "Log-Ordner vorbereitet."

# -----------------------------------------
# system-daemon prüfen
# -----------------------------------------
$daemonDir = Join-Path $InstallRoot "system-daemon"
$daemonScript = Join-Path $daemonDir "daemon.js"

if (!(Test-Path $daemonScript)) {
    Write-Host "[FEHLER] daemon.js fehlt!"
    exit 1
}

Write-Host "Auto-Update-Daemon gefunden."

# -----------------------------------------
# Node.js prüfen
# -----------------------------------------
if (!(Test-Path $NodePath)) {
    Write-Host "[FEHLER] Node.js nicht gefunden: $NodePath"
    exit 1
}

Write-Host "Node gefunden."
# -----------------------------------------
# Windows Service EINRICHTEN (OHNE NSSM)
# -----------------------------------------
Write-Host "Installiere Windows Service 'CustomerDashboardDaemon'..."

$serviceName = "CustomerDashboardDaemon"
$serviceDisplayName = "Customer Dashboard Updater"
$serviceDescription = "Automatischer Update-Daemon für das Customer Dashboard"
$binPath = "`"$NodePath`" `"$daemonScript`""

# Falls Dienst existiert → erst löschen
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Dienst existiert bereits. Entferne alten Dienst..."
    sc.exe stop $serviceName | Out-Null
    sc.exe delete $serviceName | Out-Null
    Start-Sleep -Seconds 2
}

# Dienst neu erstellen
New-Service `
    -Name $serviceName `
    -BinaryPathName $binPath `
    -DisplayName $serviceDisplayName `
    -Description $serviceDescription `
    -StartupType Automatic

# Dienst starten
Start-Service $serviceName

Write-Host "Windows Service erfolgreich erstellt und gestartet."


Write-Host ""
Write-Host "==========================================="
Write-Host " INSTALLATION ERFOLGREICH!"
Write-Host " Auto-Update-Daemon läuft jetzt automatisch."
Write-Host "==========================================="
