#!/usr/bin/env bash
set -e

# =========================================================
# BACHELOR THESIS INSTALLER (FULL SOURCE BUILD)
# =========================================================

# 1. AUTO-ROOT: Wenn nicht root, frag nach Passwort und starte neu
if [ "$EUID" -ne 0 ]; then
  echo ">> Benötige Root-Rechte für Installation..."
  exec sudo "$0" "$@"
  exit
fi

echo "=== Customer Dashboard Installer (Linux Source Build) ==="

# -------------------------------------------------------------
# 1. ABHÄNGIGKEITEN PRÜFEN & INSTALLIEREN
# -------------------------------------------------------------

install_docker() {
    echo ">> Installiere Docker..."
    if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl; fi
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker || true
}

install_node() {
    echo ">> Installiere Node.js..."
    if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl; fi
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
}

if ! command -v docker >/dev/null; then install_docker; else echo "✔ Docker gefunden."; fi
if ! command -v node >/dev/null; then install_node; else echo "✔ Node.js gefunden."; fi

# -------------------------------------------------------------
# 2. DATEIEN KOPIEREN (DER WICHTIGE TEIL)
# -------------------------------------------------------------

INSTALL_DIR="/opt/customer-dashboard"
# Wir ermitteln, wo das Skript gerade liegt (im deploy Ordner)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Das Root des entpackten Downloads (eins über deploy) ist der Quellcode
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ">> Bereite Installationsverzeichnis vor ($INSTALL_DIR)..."
# Alte Installation stoppen
if [ -d "$INSTALL_DIR/deploy" ]; then
    cd "$INSTALL_DIR/deploy"
    docker compose down 2>/dev/null || true
fi

# Alles löschen und neu anlegen
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo ">> Kopiere gesamten Quellcode..."
# WICHTIG: Wir kopieren ALLES, damit Docker das Dockerfile findet!
cp -a "$SOURCE_ROOT/." "$INSTALL_DIR/"

# Pfade im Zielsystem definieren
TARGET_DEPLOY="$INSTALL_DIR/deploy"
TARGET_DAEMON="$INSTALL_DIR/system-daemon"
TARGET_FRONTEND="$INSTALL_DIR/app/frontend"
TARGET_LOGS="$INSTALL_DIR/logs"

mkdir -p "$TARGET_LOGS"

# -------------------------------------------------------------
# 3. FRONTEND BAUEN (Behebt weiße Seite)
# -------------------------------------------------------------
echo
echo ">> Baue Frontend (React)..."
if [ -d "$TARGET_FRONTEND" ]; then
    cd "$TARGET_FRONTEND"
    # Alte Node Modules löschen um Konflikte zu vermeiden
    rm -rf node_modules package-lock.json dist
    
    # Installieren und Bauen
    npm install --silent
    npm run build
    echo "✔ Frontend gebaut."
else
    echo "❌ FEHLER: Frontend Ordner fehlt!"
    exit 1
fi

# -------------------------------------------------------------
# 4. DAEMON INSTALLIEREN (Behebt Abstürze)
# -------------------------------------------------------------
echo
echo ">> Installiere Update-Daemon..."
cd "$TARGET_DAEMON"
rm -rf node_modules package-lock.json
npm install --omit=dev --silent

# Key prüfen
mkdir -p trust
if [ ! -f "trust/updater-public.pem" ]; then
    # Versuchen den Key aus dem Source Root zu holen falls er verschoben wurde
    cp "$INSTALL_DIR/system-daemon/trust/updater-public.pem" trust/ 2>/dev/null || true
fi

# -------------------------------------------------------------
# 5. DOCKER STARTEN
# -------------------------------------------------------------
echo
echo ">> Starte Docker Container..."
cd "$TARGET_DEPLOY"

# Docker Compose Befehl finden
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

# Container neu bauen (--build zwingt Docker das Dockerfile zu nutzen)
$DC up -d --build --remove-orphans

# -------------------------------------------------------------
# 6. DAEMON STARTEN
# -------------------------------------------------------------
echo ">> Starte Update-Dienst..."
pkill -f "system-daemon/daemon.js" || true
nohup node "$TARGET_DAEMON/daemon.js" >> "$TARGET_LOGS/daemon.log" 2>&1 &

echo
echo "Warte auf Systemstart..."
sleep 10

# Prüfen
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health)

if [ "$STATUS" -eq 200 ]; then
    echo "INSTALLATION ERFOLGREICH!"
    echo "   Dashboard erreichbar unter: http://localhost:8080/"
else
    echo "Container läuft, API braucht noch kurz zum Starten."
    echo "   Dashboard: http://localhost:8080/"
fi