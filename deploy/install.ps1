Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer ===`n" -ForegroundColor Cyan

# — Arbeitsverzeichnis setzen —
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# — Docker Checks —
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker ist nicht installiert oder nicht im PATH." -ForegroundColor Red
    exit 1
}

try { docker info | Out-Null }
catch {
    Write-Host "ERROR: Docker läuft nicht. Bitte Docker Desktop starten." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".\$ComposeFile")) {
    Write-Host "ERROR: $ComposeFile nicht im Ordner $scriptDir gefunden." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".\.env")) {
    Write-Host "ERROR: .env nicht gefunden. Bitte .env aus .env.example erzeugen." -ForegroundColor Red
    exit 1
}

# Werte aus .env laden
$envLines = Get-Content ".\.env" -Encoding UTF8
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$version  = $version.TrimStart("v")
$port     = (($envLines | Where-Object { $_ -match '^APP_PORT=' }) -replace 'APP_PORT=','')
if (-not $port) { $port = "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"

# — Alte Container beenden —
Write-Host "Stoppe alte Dashboard-Container (falls vorhanden)..." -ForegroundColor Yellow
try { docker compose -f $ComposeFile down | Out-Null }
catch { Write-Host "Keine bestehenden Container gefunden." }

# — Neueste Version von GitHub holen —
Write-Host "Hole neueste Version aus GitHub Releases..." -ForegroundColor Yellow

$repoOwner = "leoaigner7"
$repoName  = "customer-dashboard-v2"
$apiUrl    = "https://api.github.com/repos/$repoOwner/$repoName/releases/latest"

try {
    $headers = @{ "User-Agent" = "CustomerDashboard-Installer" }
    $json = (Invoke-WebRequest -Uri $apiUrl -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json
    $latestVersion = $json.tag_name.TrimStart("v")
    Write-Host "Neueste verfügbare Version: $latestVersion" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: Konnte GitHub-Latest-Version nicht abrufen." -ForegroundColor Red
    exit 1
}

# — APP_VERSION in .env aktualisieren —
Write-Host "Schreibe neue Version in .env ..." -ForegroundColor Yellow
(Get-Content ".\.env") `
    -replace "^APP_VERSION=.*", "APP_VERSION=$latestVersion" |
    Set-Content ".\.env"

# — Nur das Dashboard-Image pullen (NICHT den Updater!) —
Write-Host "`nPull aktuelles Dashboard-Image..." -ForegroundColor Yellow
docker compose -f $ComposeFile pull dashboard

# — Dashboard starten —
Write-Host "Starte Container..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d --force-recreate 

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose up -d ist fehlgeschlagen." -ForegroundColor Red
    exit 1
}

# — HTTP-Check —
Write-Host "`nWarte auf Service..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

$uri = "http://localhost:$port/"

Write-Host "Prüfe HTTP-Status unter $uri ..." -ForegroundColor Yellow

try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 10
    if ($resp.StatusCode -eq 200) {
        Write-Host "`n✅ Deployment erfolgreich!" -ForegroundColor Green
        Write-Host "Customer Dashboard läuft unter: $uri`n" -ForegroundColor Green
    } else {
        Write-Host "`n⚠ Deployment gestartet, aber HTTP-Status ist $($resp.StatusCode)." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "`n⚠ Container läuft, aber HTTP-Check ist fehlgeschlagen: $_" -ForegroundColor Yellow
    Write-Host "Bitte Logs prüfen: docker compose logs" -ForegroundColor Yellow
}
exit 0
