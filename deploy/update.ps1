Param(
    [string]$ComposeFile = "docker-compose.yml",
    [string]$EnvFile     = ".env"
)

# ===============================================
#   KONFIGURATION – PRO KUNDEN ANPASSBAR
# ===============================================
$RepoOwner   = "leoaigner7"
$RepoName    = "customer-dashboard-v2"

# Aktuell: GitHub Releases
# Später für Kunden z.B.: "https://updates.meinefirma.de/customer-dashboard/latest"
$UpdateApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"

$VersionKey  = "APP_VERSION"
$LogFile     = "updater.log"
# ===============================================

# Skriptverzeichnis als Working Directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Write-Log "=== Customer Dashboard Updater (Windows) ==="

if (-not (Test-Path $EnvFile)) {
    Write-Log "ERROR: $EnvFile nicht gefunden."
    exit 1
}

if (-not (Test-Path $ComposeFile)) {
    Write-Log "ERROR: $ComposeFile nicht gefunden."
    exit 1
}

# Aktuelle Version aus .env lesen
$envLines    = Get-Content -Path $EnvFile -Encoding UTF8
$currentLine = $envLines | Where-Object { $_ -match "^\s*$VersionKey\s*=" }

if (-not $currentLine) {
    Write-Log "WARN: Keine Zeile mit $VersionKey= gefunden – setze 'unknown'."
    $currentVersion = "unknown"
} else {
    $currentVersion = $currentLine -replace "^\s*$VersionKey\s*=", ""
    $currentVersion = $currentVersion.Trim()
}

Write-Log "Aktuelle Version: $currentVersion"

# Neueste Version vom Update-Server (GitHub Releases)
try {
    $headers  = @{ "User-Agent" = "CustomerDashboard-Updater" }
    $response = Invoke-WebRequest -Uri $UpdateApiUrl -Headers $headers -UseBasicParsing
    $json     = $response.Content | ConvertFrom-Json
} catch {
    Write-Log "ERROR: Fehler beim Abrufen der Release-Infos: $($_.Exception.Message)"
    exit 1
}

$latestTag = $json.tag_name
if (-not $latestTag) {
    Write-Log "ERROR: tag_name in JSON nicht gefunden."
    exit 1
}

$latestVersion = $latestTag.TrimStart("v")
Write-Log "Neueste Version laut Server: $latestVersion (Tag: $latestTag)"

# Optional: echte Version-Objekte zum Vergleichen verwenden
$shouldUpdate = $true
if ($currentVersion -ne "unknown") {
    try {
        $currV   = [Version]$currentVersion
        $latestV = [Version]$latestVersion

        if ($latestV -le $currV) {
            Write-Log "Keine neuere Version verfügbar ($currentVersion ≥ $latestVersion)."
            $shouldUpdate = $false
        }
    } catch {
        Write-Log "WARN: Konnte Versionen nicht als [Version] parsen, fallback auf einfachen String-Vergleich."
        if ($latestVersion -eq $currentVersion) {
            $shouldUpdate = $false
        }
    }
} else {
    # unknown -> sicherheitshalber updaten
    $shouldUpdate = $true
}

if (-not $shouldUpdate) {
    Write-Log "Kein Update notwendig."
    exit 0
}

Write-Log "Update verfügbar: $currentVersion -> $latestVersion"
Write-Log "Aktualisiere $EnvFile …"

# Zeile in .env anpassen oder hinzufügen
$newEnvLines = @()
$replaced = $false
foreach ($line in $envLines) {
    if ($line -match "^\s*$VersionKey\s*=") {
        $newEnvLines += "$VersionKey=$latestVersion"
        $replaced = $true
    } else {
        $newEnvLines += $line
    }
}
if (-not $replaced) {
    $newEnvLines += "$VersionKey=$latestVersion"
}

$newEnvLines | Set-Content -Path $EnvFile -Encoding UTF8
Write-Log "ENV aktualisiert: $VersionKey=$latestVersion"

# Docker Deploy
Write-Log "Pull neues Image über docker compose …"
docker compose -f $ComposeFile pull
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose pull fehlgeschlagen (ExitCode $LASTEXITCODE)."
    exit 1
}

Write-Log "Starte/aktualisiere Container …"
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose up fehlgeschlagen (ExitCode $LASTEXITCODE)."
    exit 1
}

Write-Log "Update auf Version $latestVersion erfolgreich abgeschlossen."
exit 0
