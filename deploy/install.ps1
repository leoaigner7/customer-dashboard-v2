# Das man das script mit .\starten kann oder mit -> .\install.ps1 -ComposeFile custom-compose.yml

Param(
    [string]$ComposeFile = "docker-compose.yml"
)

# Gibt farbigen Text im Terminal aus
Write-Host "=== Customer Dashboard Installer ===`n" -ForegroundColor Cyan

#  Arbeitsverzeichnis auf den Ordner des Skripts setzen.
# Wichtig, weil beim Start per Doppelklick oder aus einem anderen Pfad
# der aktuelle Working Directory oft nicht dem Skriptpfad entspricht.
# MyInvocation liefert den Pfad zur ausgeführten .ps1-Datei.
# Dadurch funktionieren relative Pfade (z.B. docker-compose.yml, .env) zuverlässig.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# --- 1. Checks ---------------------------------------------------------

# Get-Command docker -> prüft, ob der befehl docker existiert -> wenn docker fehlt -> sofort abbrechen
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Docker ist nicht installiert oder nicht im PATH." -ForegroundColor Red
    exit 1
}

try {
    docker info | Out-Null
} catch {
    Write-Host "ERROR: Docker läuft nicht. Bitte Docker Desktop starten." -ForegroundColor Red
    exit 1
}
# prüft ob eine Datei mit dem namen $Composefile existiert
# Standard: docker-compose.yml -> sonst abbruch
if (-not (Test-Path ".\${ComposeFile}")) {
    Write-Host "ERROR: ${ComposeFile} nicht im Ordner $scriptDir gefunden." -ForegroundColor Red
    exit 1
}

# existiert .env -> erforderlich,da Port benötigt wird, APP_VERSION benötigt wird
if (-not (Test-Path ".\.env")) {
    Write-Host "ERROR: .env nicht gefunden. Bitte .env aus .env.example erzeugen." -ForegroundColor Red
    exit 1
}
# Get-content lädt jede Zeiler der .env als String in ein Array
$envLines   = Get-Content .\.env
# APP_VERSION aus den geladenen .env-Zeilen extrahieren. Erwartet eine Zeile wie:  APP_VERSION=v1.2.3 || Findet die Zeile mit APP_VERSION= || Entfernt den Präfix "APP_VERSION=" || Ergebnis ist z.B. "v1.2.3" || Falls kein Eintrag gefunden wird, wird "<unbekannt>" verwendet ||(nur für Anzeige beim Kunden, nicht kritisch).

$version    = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$version = $version.TrimStart("v")     # <--- Entfernt führendes v automatisch

if (-not $version) { $version = "<unbekannt>" }

#sucht: APP_PORT=xxxx || entfernt APP_PORT=   || -> wenn nicht gefunden -> default 8080 || Wichtig, damit der HTTP-Check später weiß, wo er prüfen soll.
$portLine   = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port       = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port`n"

# --- 2. Alte Container stoppen/entfernen -------------------------------
Write-Host "Stoppe alte Dashboard-Container (falls vorhanden)..." -ForegroundColor Yellow

# führt aus: docker compose -f docker-compose.yml down
try {
    docker compose -f $ComposeFile down -ErrorAction Stop
}catch {
    Write-Host "keine bestehenden Container gefunden"
}
# --- 3. Neues Image ziehen & starten ----------------------------------

# holt das Image bspw: ghcr.io/leoaigner7/customer-dashboard-v2:<APP_VERSION> lädt es frisch herunter 

Write-Host "`nPull aktuelles Image aus Registry..." -ForegroundColor Yellow
docker compose -f $ComposeFile pull

# up -d startet den Container im Hintergrund.
#Docker Compose liest dann: docker-compose.yml || .env  && startet alles neu
Write-Host "Starte Container..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d

# wenn ein fehler passiert
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose up -d ist fehlgeschlagen." -ForegroundColor Red
    exit 1
}

# --- 4. HTTP-Check -----------------------------------------------------
# Warte 10 Sekunden, damit der COntainer booten kann.
#Ziel Url wird gebaut
Write-Host "`nWarte auf Service..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

$uri = "http://localhost:$port/"

Write-Host "Prüfe HTTP-Status unter $uri ..." -ForegroundColor Yellow
try {
    #Sendet HTTP-Request an http://localhost:PORT/
    #Der Webserver antwortet korrekt → alles gut
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
# Container läuft zwar aber HTTP-Request schlägt fehl (Server nicht erreichbar, Fehler 500, etc.)
# Kunde soll Logs anschauen
catch {
    Write-Host "`n⚠ Container läuft, aber HTTP-Check ist fehlgeschlagen: $_" -ForegroundColor Yellow
    Write-Host "Bitte Logs mit 'docker compose logs' prüfen." -ForegroundColor Yellow
    exit 0
}
