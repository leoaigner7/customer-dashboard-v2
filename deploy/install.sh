#!/usr/bin/env bash
set -e

# =========================================================
# Customer Dashboard Installer (AUTO-DEPENDENCY MODE)
# =========================================================

echo "=== Customer Dashboard Installer (Linux) ==="
echo "Prüfe Systemvoraussetzungen..."

# -------------------------------------------------------------
# 0. FUNKTIONEN FÜR AUTO-INSTALLATION
# -------------------------------------------------------------

install_docker() {
    echo ">> Docker wurde nicht gefunden. Starte automatische Installation..."
    echo "   (Dies nutzt das offizielle Skript von get.docker.com)"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    echo ">> Docker installiert."
    
    # User zur Docker-Gruppe hinzufügen (vermeidet 'sudo' zwang bei docker commands)
    sudo usermod -aG docker "$USER" || true
    echo ">> HINWEIS: Damit Docker ohne sudo läuft, ist oft ein Neustart nötig."
}

install_node() {
    echo ">> Node.js wurde nicht gefunden. Installiere Node.js 18.x LTS..."
    # Nutzt NodeSource für aktuelle Versionen (die Standard-Repos sind oft zu alt)
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo ">> Node.js installiert: $(node -v)"
}

# -------------------------------------------------------------
# 1. DEPENDENCY CHECK & INSTALL
# -------------------------------------------------------------

# Check curl (wird für Installationen gebraucht)
if ! command -v curl >/dev/null; then
    sudo apt-get update && sudo apt-get install -y curl
fi

# Check Docker
if ! command -v docker >/dev/null; then
    install_docker
else
    echo "✔ Docker ist bereits installiert."
fi

# Check Node.js
if ! command -v node >/dev/null; then
    install_node
else
    echo "✔ Node.js ist bereits installiert."
fi

echo
echo "Alle Abhängigkeiten sind vorhanden. Beginne Deployment..."
echo

# -------------------------------------------------------------
# AB HIER DEIN ORIGINALER INSTALLATIONSPROZESS
# -------------------------------------------------------------

INSTALL_DIR="/opt/customer-dashboard"
DEPLOY_DIR="$INSTALL_DIR/deploy"
DAEMON_DIR="$INSTALL_DIR/system-daemon"
LOG_DIR="$INSTALL_DIR/logs"

NODE_BIN="$(command -v node)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Annahme: install.sh liegt in /deploy, also ist Root eins drüber
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)" 

# Verzeichnisse
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

# Dateien kopieren (angepasst auf deine Struktur)
# Wir kopieren ALLES aus dem aktuellen Ordner (deploy) und dem Daemon Ordner
echo "Kopiere Dateien nach $INSTALL_DIR..."
sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"

# Prüfen ob der system-daemon Ordner im Paket existiert
if [ -d "$PACKAGE_ROOT/system-daemon" ]; then
    sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"
else
    echo "WARNUNG: Quellordner system-daemon nicht gefunden in $PACKAGE_ROOT"
fi

# Public Key installieren
TRUST_DIR="$DAEMON_DIR/trust"
SRC_KEY="$PACKAGE_ROOT/system-daemon/trust/updater-public.pem"
DST_KEY="$TRUST_DIR/updater-public.pem"

sudo mkdir -p "$TRUST_DIR"
if [ -f "$SRC_KEY" ]; then
  sudo cp "$SRC_KEY" "$DST_KEY"
  echo "✔ Public Key installiert."
fi

# .env laden
if [ -f "$DEPLOY_DIR/.env" ]; then
    set +o allexport
    source "$DEPLOY_DIR/.env"
    PORT="${APP_PORT:-8080}"
else
    echo "WARNUNG: Keine .env Datei gefunden. Nutze Defaults."
    PORT=8080
fi

# Docker starten
echo "Starte Dashboard Container..."
cd "$DEPLOY_DIR"
# Falls docker-compose plugin nicht direkt geht, fallback probieren (optional)
docker compose up -d --pull always --remove-orphans

# Node Dependencies für Daemon installieren
if [ -f "$DAEMON_DIR/package.json" ]; then
  echo "Installiere Daemon-Abhängigkeiten..."
  cd "$DAEMON_DIR"
  sudo npm install --omit=dev --silent
fi

# Daemon starten (via Systemd ist besser, aber hier dein nohup Ansatz)
echo "Starte Update-Daemon..."
# Vorherigen Prozess killen falls vorhanden
sudo pkill -f "$DAEMON_DIR/daemon.js" || true

sudo -u root nohup "$NODE_BIN" "$DAEMON_DIR/daemon.js" >> "$LOG_DIR/daemon.log" 2>&1 &

echo "Warte auf Start..."
sleep 5

# Healthcheck
if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "INSTALLATION ERFOLGREICH ABGESCHLOSSEN!"
    echo "   Dashboard erreichbar unter: http://localhost:${PORT}/"
else
    echo "Dashboard scheint noch zu starten oder Port ist blockiert."
    echo "   Bitte Logs prüfen: $LOG_DIR"
fi