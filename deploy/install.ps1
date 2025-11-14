Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer ===`n" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# --- 1. Checks ---------------------------------------------------------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker ist nicht installiert oder nicht im PATH." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".\${ComposeFile}")) {
    Write-Host "ERROR: ${ComposeFile} nicht im Ordner $scriptDir gefunden." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".\.env")) {
    Write-Host "ERROR: .env nicht gefunden. Bitte .env aus .env.example erzeugen." -ForegroundColor Red
    exit 1
}

$envLines   = Get-Content .\.env
$version    = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
if (-not $version) { $version = "<unbekannt>" }

$portLine   = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port       = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"

# --- 2. Alte Container stoppen/entfernen -------------------------------
Write-Host "Stoppe alte Dashboard-Container (falls vorhanden)..." -ForegroundColor Yellow
try {
    docker compose -f $ComposeFile down -ErrorAction Stoppe
}catch {
    Write-Host "keine bestehenden Container gefunden"
}
# --- 3. Neues Image ziehen & starten ----------------------------------

Write-Host "`nPull aktuelles Image aus Registry..." -ForegroundColor Yellow
docker compose -f $ComposeFile pull

Write-Host "Starte Container..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose up -d ist fehlgeschlagen." -ForegroundColor Red
    exit 1
}

# --- 4. HTTP-Check -----------------------------------------------------

Write-Host "`nWarte auf Service..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

$uri = "http://localhost:$port/"

Write-Host "Prüfe HTTP-Status unter $uri ..." -ForegroundColor Yellow
try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
    if ($resp.StatusCode -eq 200) {
        Write-Host "`n✅ Deployment erfolgreich!" -ForegroundColor Green
        Write-Host "Customer Dashboard läuft unter: $uri`n" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n⚠ Deployment gestartet, aber HTTP-Status ist $($resp.StatusCode)." -ForegroundColor Yellow
        exit 0
    }
}
catch {
    Write-Host "`n⚠ Container läuft, aber HTTP-Check ist fehlgeschlagen: $_" -ForegroundColor Yellow
    Write-Host "Bitte Logs mit 'docker compose logs' prüfen." -ForegroundColor Yellow
    exit 0
}
