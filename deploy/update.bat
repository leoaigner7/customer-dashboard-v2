# ----------------------------------------
# Customer Dashboard Update Script (Windows)
# ----------------------------------------

Write-Host "----------------------------------------"
Write-Host "  Customer Dashboard Update (Windows)"
Write-Host "----------------------------------------"

$ErrorActionPreference = "Stop"
$logPath = "logs/update.log"
New-Item -ItemType Directory -Path "logs" -Force | Out-Null

# .env prüfen
if (-Not (Test-Path ".env")) {
    Write-Host "❌ Fehler: .env nicht gefunden!"
    exit 1
}

# .env laden
Get-Content .env | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
        Set-Variable -Name $matches[1] -Value $matches[2]
    }
}

# VERSION.txt vergleichen (offline)
if (Test-Path "VERSION.txt") {
    $targetVersion = Get-Content VERSION.txt
    if ($APP_VERSION -ne $targetVersion) {
        Write-Host "🔄 Update erforderlich: $APP_VERSION → $targetVersion"
        (Get-Content .env) -replace "^APP_VERSION=.*", "APP_VERSION=$targetVersion" | Set-Content .env
        $APP_VERSION = $targetVersion
    } else {
        Write-Host "✅ Keine Aktualisierung nötig."
        exit 0
    }
}

# Docker prüfen
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker ist nicht installiert!"
    exit 1
}
if (-not (docker compose version)) {
    Write-Host "❌ Docker Compose ist nicht installiert!"
    exit 1
}

$image = "$APP_REGISTRY/leoaigner7/customer-dashboard-v2:$APP_VERSION"
Write-Host "🐳 Lade Image: $image"
docker compose pull

Write-Host "🔁 Starte Container neu ..."
docker compose up -d

Start-Sleep -Seconds 5

Write-Host "🌐 Prüfe Erreichbarkeit: http://localhost:$APP_PORT/"
try {
    $result = Invoke-WebRequest -Uri "http://localhost:$APP_PORT/" -UseBasicParsing -TimeoutSec 5
    if ($result.StatusCode -ge 200 -and $result.StatusCode -lt 300) {
        Write-Host "✅ Update erfolgreich! Version $APP_VERSION läuft."
    } else {
        throw "HTTP Statuscode: $($result.StatusCode)"
    }
} catch {
    Write-Host "❌ Anwendung NICHT erreichbar!"
    docker compose logs --tail=50
    exit 1
}

Write-Host "----------------------------------------"
Write-Host "🎉 Fertig!"
Write-Host "----------------------------------------"
