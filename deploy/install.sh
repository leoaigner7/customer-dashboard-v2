#!/usr/bin/env bash
set -e

# =========================================================
# BACHELOR THESIS INSTALLER (ROBUST & DEBUG MODE)
# =========================================================

# 1. AUTO-ROOT
if [ "$EUID" -ne 0 ]; then
  echo ">> Benötige Root-Rechte für Installation..."
  exec sudo "$0" "$@"
  exit
fi

echo "=== Customer Dashboard Installer (Linux) ==="

# -------------------------------------------------------------
# 1. ABHÄNGIGKEITEN
# -------------------------------------------------------------
if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl; fi

if ! command -v docker >/dev/null; then 
    echo ">> Installiere Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

if ! command -v node >/dev/null; then
    echo ">> Installiere Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# -------------------------------------------------------------
# 2. DATEIEN KOPIEREN (ROBUST)
# -------------------------------------------------------------
INSTALL_DIR="/opt/customer-dashboard"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ">> Bereite Installationsverzeichnis vor ($INSTALL_DIR)..."
# Alte Container stoppen
if [ -f "$INSTALL_DIR/deploy/docker-compose.yml" ]; then
    (cd "$INSTALL_DIR/deploy" && docker compose down 2>/dev/null || true)
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo ">> Quellverzeichnis ist: $SOURCE_ROOT"
echo ">> Kopiere Dateien (dieser Schritt wurde verbessert)..."

# ROBUSTER KOPIER-BEFEHL: Kopiert alles, auch versteckte Dateien
cp -R "$SOURCE_ROOT/"* "$INSTALL_DIR/" 2>/dev/null || true
cp -R "$SOURCE_ROOT/." "$INSTALL_DIR/" 2>/dev/null || true

# Check, ob 'app' Ordner da ist
if [ ! -d "$INSTALL_DIR/app" ]; then
    echo "❌ FEHLER: Der Ordner 'app' wurde nicht kopiert."
    echo "   Inhalt von $INSTALL_DIR ist:"
    ls -F "$INSTALL_DIR"
    exit 1
fi

# Pfade setzen
TARGET_DEPLOY="$INSTALL_DIR/deploy"
TARGET_DAEMON="$INSTALL_DIR/system-daemon"
TARGET_FRONTEND="$INSTALL_DIR/app/frontend"
TARGET_LOGS="$INSTALL_DIR/logs"

mkdir -p "$TARGET_LOGS"

# -------------------------------------------------------------
# 3. FRONTEND BAUEN
# -------------------------------------------------------------
echo
echo ">> Baue Frontend (React)..."
if [ -d "$TARGET_FRONTEND" ]; then
    cd "$TARGET_FRONTEND"
    rm -rf node_modules package-lock.json dist
    
    echo "   Installiere npm Pakete..."
    npm install --silent
    
    echo "   Erstelle Build..."
    npm run build
    
    if [ -d "dist" ]; then
        echo "✔ Frontend erfolgreich gebaut."
    else
        echo "❌ FEHLER: 'dist' Ordner wurde nicht erstellt."
        exit 1
    fi
else
    echo "❌ FEHLER: Frontend Ordner fehlt unter: $TARGET_FRONTEND"
    echo "   Verfügbare Ordner in /app:"
    ls -F "$INSTALL_DIR/app"
    exit 1
fi

# -------------------------------------------------------------
# 4. DAEMON INSTALLIEREN
# -------------------------------------------------------------
echo
echo ">> Installiere Daemon..."
cd "$TARGET_DAEMON"
rm -rf node_modules package-lock.json
npm install --omit=dev --silent

mkdir -p trust
if [ ! -f "trust/updater-public.pem" ]; then
    # Versuche Key zu finden (manchmal in system-daemon root oder trust folder)
    if [ -f "../updater-public.pem" ]; then cp "../updater-public.pem" trust/; fi
    if [ -f "$SOURCE_ROOT/system-daemon/trust/updater-public.pem" ]; then cp "$SOURCE_ROOT/system-daemon/trust/updater-public.pem" trust/; fi
fi

# -------------------------------------------------------------
# 5. DOCKER STARTEN
# -------------------------------------------------------------
echo
echo ">> Starte Docker Container..."
cd "$TARGET_DEPLOY"

# Docker command resolution
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

$DC down --volumes --remove-orphans 2>/dev/null || true
$DC up -d --build --remove-orphans

# -------------------------------------------------------------
# 6. DAEMON STARTEN
# -------------------------------------------------------------
echo ">> Starte Update-Dienst..."
pkill -f "system-daemon/daemon.js" || true
nohup node "$TARGET_DAEMON/daemon.js" >> "$TARGET_LOGS/daemon.log" 2>&1 &

echo
echo "Warte auf Systemstart (max 30 sek)..."
for i in {1..30}; do
    if curl -s "http://localhost:8080/api/health" >/dev/null; then
        echo "✅ INSTALLATION ERFOLGREICH!"
        echo "   Dashboard: http://localhost:8080/"
        exit 0
    fi
    sleep 1
done

echo "⚠️  Zeitüberschreitung beim Healthcheck. Container läuft wahrscheinlich trotzdem."
echo "   Prüfe: http://localhost:8080/"