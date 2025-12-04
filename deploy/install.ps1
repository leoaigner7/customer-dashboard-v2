param(
    [string]$InstallRoot = "C:\CustomerDashboard",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$GithubApi = "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest",
    [string]$OfflineZip = "C:\CustomerDashboard\updates\customer-dashboard.zip"
)

Write-Host "=== Customer Dashboard Autoinstaller ==="

# -----------------------------------------
# FUNKTION: RELEASE-QUELLE ERMITTELN
# -----------------------------------------
function Find-ReleaseZip {

    Write-Host "Prüfe mögliche Quellen..."

    # ============================================
    # 1) OFFLINE ZIP
    # ============================================
    if (Test-Path $OfflineZip) {
        Write-Host "Offline-Paket gefunden: $OfflineZip"
        return $OfflineZip
    }

    # ============================================
    # 2) GITHUB RELEASE
    # ============================================
    try {
        Write-Host "Hole Release-Infos von GitHub..."

        $res = Invoke-WebRequest -Uri $GithubApi -UseBasicParsing
        $json = $res.Content | ConvertFrom-Json

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
        Write-Host "[WARN] GitHub Release nicht erreichbar."
    }

    return $null
}

# -----------------------------------------
# QUELLE LADEN / WÄHLEN
# -----------------------------------------
$zip = Find-ReleaseZip

if (-not $zip) {
    Write-Host "[FEHLER] Konnte kein Installationspaket finden."
    Write-Host "Bitte stellen Sie sicher, dass:"
    Write-Host " - Internet funktioniert (GitHub) oder"
    Write-Host " - Offline-Paket liegt unter: $OfflineZip"
    exit 1
}

Write-Host "Nutze Release-Paket: $zip"

# -----------------------------------------
# INSTALLATIONSVERZEICHNIS
# -----------------------------------------
if (!(Test-Path $InstallRoot)) {
    Write-Host "Erstelle Installationsverzeichnis: $InstallRoot"
    New-Item -ItemType Directory -Path $InstallRoot | Out-Null
}

# -----------------------------------------
# RELEASE EXTRAHIEREN
# -----------------------------------------
Write-Host "Entpacke Release..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $InstallRoot, $true)

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
# .env erstellen
# -----------------------------------------
$envPath = Join-Path $InstallRoot "deploy\.env"
Write-Host "Erstelle .env..."

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
# DAEMON PRÜFEN
# -----------------------------------------
$daemonDir = Join-Path $InstallRoot "system-daemon"
$daemonScript = Join-Path $daemonDir "daemon.js"

if (!(Test-Path $daemonDir)) {
    Write-Host "[FEHLER] system-daemon fehlt!"
    exit 1
}

Write-Host "Auto-Update-Daemon gefunden."

# -----------------------------------------
# NODE Prüfen
# -----------------------------------------
if (!(Test-Path $NodePath)) {
    Write-Host "[FEHLER] Node.js fehlt!"
    Write-Host "Installieren Sie Node.js LTS."
    exit 1
}

Write-Host "Node gefunden."

# -----------------------------------------
# NSSM INSTALLIEREN
# -----------------------------------------
$nssm = Join-Path $InstallRoot "nssm.exe"

if (!(Test-Path $nssm)) {
    Write-Host "Lade NSSM herunter..."
    Invoke-WebRequest "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$InstallRoot\nssm.zip"
    [System.IO.Compression.ZipFile]::ExtractToDirectory("$InstallRoot\nssm.zip", $InstallRoot, $true)
    Copy-Item "$InstallRoot\nssm-2.24\win64\nssm.exe" $nssm
    Remove-Item "$InstallRoot\nssm-2.24" -Recurse -Force
    Remove-Item "$InstallRoot\nssm.zip"
}

Write-Host "NSSM bereit."

# -----------------------------------------
# SERVICE INSTALLIEREN
# -----------------------------------------
Write-Host "Installiere Windows Service..."

& $nssm install "CustomerDashboardDaemon" $NodePath $daemonScript
& $nssm set "CustomerDashboardDaemon" AppDirectory $daemonDir
& $nssm set "CustomerDashboardDaemon" Start SERVICE_AUTO_START

& $nssm start "CustomerDashboardDaemon"

Write-Host ""
Write-Host "==========================================="
Write-Host " INSTALLATION ERFOLGREICH!"
Write-Host " Auto-Update-Daemon läuft jetzt automatisch."
Write-Host "==========================================="
