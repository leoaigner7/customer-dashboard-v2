#!/usr/bin/env bash
set -e

# =========================================================
# Customer Dashboard Installer (FINAL PRODUCTION VERSION)
# =========================================================

# 1. AUTO-ESCALATE TO ROOT (Der Trick für deine Arbeit!)
# Wenn das Skript nicht als Root läuft, startet es sich selbst mit sudo neu.
if [ "$EUID" -ne 0 ]; then
  echo ">> Fordere Administrator-Rechte an (für Docker-Installation)..."
  exec sudo "$0" "$@"
  exit
fi

echo "=== Customer Dashboard Installer (Linux) ==="
echo "Prüfe Systemvoraussetzungen..."

# -------------------------------------------------------------
# 0. FUNKTIONEN FÜR AUTO-INSTALLATION
# -------------------------------------------------------------

install_docker() {
    echo ">> Docker fehlt. Installiere via get.docker.com..."
    # Wir brauchen curl
    if ! command -v curl >/dev/null; then
        apt-get update && apt-get install -y curl
    fi
    
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    
    # Docker sofort starten
    systemctl enable docker
    systemctl start docker || true
    echo ">> Docker installiert."
}

install_node() {
    echo ">> Node.js fehlt. Installiere Node.js LTS..."
    if ! command -v curl >/dev/null; then
        apt-get update && apt-get install -y curl
    fi
    
    # NodeSource Setup
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    echo ">> Node.js installiert: $(node -v)"
}

# -------------------------------------------------------------
# 1. DEPENDENCY CHECK
# -------------------------------------------------------------

# Check Docker
if ! command -v docker >/dev/null; then
    install_docker
else
    echo "✔ Docker ist bereit."
fi

# Check Node.js
if ! command -v node >/dev/null; then
    install_node
else
    echo "✔ Node.js ist bereit."
fi

echo
echo "System ist bereit. Beginne Installation..."
echo

# -------------------------------------------------------------
# 2. SETUP & COPY
# -------------------------------------------------------------

INSTALL_DIR="/opt/customer-dashboard"
DEPLOY_DIR="$INSTALL_DIR/deploy"
DAEMON_DIR="$INSTALL_DIR/system-daemon"
LOG_DIR="$INSTALL_DIR/logs"

# Pfade ermitteln
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)" 

# Verzeichnisse anlegen
mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

echo "Kopiere Dateien nach $INSTALL_DIR..."
cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"

if [ -d "$PACKAGE_ROOT/system-daemon" ]; then
    cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"
else
    echo "WARNUNG: system-daemon Ordner nicht im Paket gefunden!"
fi

# Public Key installieren
TRUST_DIR="$DAEMON_DIR/trust"
SRC_KEY="$PACKAGE_ROOT/system-daemon/trust/updater-public.pem"
DST_KEY="$TRUST_DIR/updater-public.pem"

mkdir -p "$TRUST_DIR"
if [ -f "$SRC_KEY" ]; then
  cp "$SRC_KEY" "$DST_KEY"
  echo "✔ Security Key installiert."
fi

# -------------------------------------------------------------
# 3. START APPS
# -------------------------------------------------------------

PORT=8080
# Versuche Port aus .env zu lesen
if [ -f "$DEPLOY_DIR/.env" ]; then
    P=$(grep ^APP_PORT= "$DEPLOY_DIR/.env" | cut -d '=' -f2)
    if [ ! -z "$P" ]; then PORT=$P; fi
fi

echo "Starte Dashboard Container..."
cd "$DEPLOY_DIR"

# Docker Compose Command finden
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    DOCKER_COMPOSE_CMD="docker-compose"
fi

# Hier tritt der Fehler nicht mehr auf, da wir ROOT sind!
$DOCKER_COMPOSE_CMD up -d --pull always --remove-orphans

echo "Installiere Daemon-Abhängigkeiten..."
if [ -f "$DAEMON_DIR/package.json" ]; then
  cd "$DAEMON_DIR"
  npm install --omit=dev --silent --no-audit
fi

echo "Starte Update-Daemon..."
pkill -f "$DAEMON_DIR/daemon.js" || true

# Daemon im Hintergrund starten (als root)
nohup node "$DAEMON_DIR/daemon.js" >> "$LOG_DIR/daemon.log" 2>&1 &

echo "Warte auf Healthcheck..."
sleep 5

# Testen ob Server antwortet
if curl -s "http://localhost:${PORT}/api/health" >/dev/null; then
    echo
    echo "✅ INSTALLATION ERFOLGREICH!"
    echo "   Dashboard läuft auf: http://localhost:${PORT}/"
    echo "   Logs liegen in:      $LOG_DIR"
else
    echo
    echo "⚠️  Installation fertig, aber Healthcheck antwortet noch nicht."
    echo "   Container bootet noch. Prüfe gleich: http://localhost:${PORT}/"
fi