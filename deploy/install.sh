#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.yml}"

echo "=== Customer Dashboard Installer (Linux) ==="
echo

# -------------------------------------------------------------
# 0. Pfade
# -------------------------------------------------------------
INSTALL_DIR="/opt/customer-dashboard"
DEPLOY_DIR="$INSTALL_DIR/deploy"
DAEMON_DIR="$INSTALL_DIR/system-daemon"
LOG_DIR="$INSTALL_DIR/logs"

NODE_BIN="$(command -v node)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installationsverzeichnis: $INSTALL_DIR"
echo "Paketwurzelverzeichnis:   $PACKAGE_ROOT"
echo

# -------------------------------------------------------------
# 1. Verzeichnisse
# -------------------------------------------------------------
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

# -------------------------------------------------------------
# 2. Dateien kopieren
# -------------------------------------------------------------
echo "Kopiere Dateien..."
sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"
sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"

#---------------------------------
# Public Key installieren

#---------------------------------
echo "Installiere Update-Signatur (Public Key)..."

TRUST_DIR="$DAEMON_DIR/trust"
SRC_KEY="$PACKAGE_ROOT/system-daemon/trust/updater-public.pem"
DST_KEY="$TRUST_DIR/updater-public.pem"

sudo mkdir -p "$TRUST_DIR"

if [ ! -f "$SRC_KEY" ]; then
  echo "FEHLER: Public Key fehlt im Paket" >&2
  exit 1
fi

sudo cp "$SRC_KEY" "$DST_KEY"

if [ ! -f "$DST_KEY" ]; then
  echo "FEHLER: Public Key konnte nicht installiert werden" >&2
  exit 1
fi

echo "Public Key erfolgreich installiert."

# -------------------------------------------------------------
# 3. Checks
# -------------------------------------------------------------
if ! command -v docker >/dev/null; then
  echo "FEHLER: Docker nicht installiert" >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "FEHLER: Node.js nicht installiert" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "FEHLER: .env fehlt" >&2
  exit 1
fi

# -------------------------------------------------------------
# 4. .env lesen
# -------------------------------------------------------------
set +o allexport
source "$DEPLOY_DIR/.env"

PORT="${APP_PORT:-8080}"
VERSION="${APP_VERSION:-unbekannt}"

echo "Version: $VERSION"
echo "Port:    $PORT"
echo

# -------------------------------------------------------------
# 5. Docker starten
# -------------------------------------------------------------
cd "$DEPLOY_DIR"

echo "Stoppe Container..."
docker compose down || true

echo "Ziehe Image..."
docker compose pull

echo "Starte Dashboard..."
docker compose up -d

# -------------------------------------------------------------
# 6. Healthcheck
# -------------------------------------------------------------
echo "Prüfe Dashboard..."
URL="http://localhost:${PORT}/api/health"

for i in {1..20}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "Dashboard läuft."
    break
  fi
  sleep 2
done

# -------------------------------------------------------------
# 7. Node-Abhängigkeiten
# -------------------------------------------------------------
if [ -f "$DAEMON_DIR/package.json" ]; then
  echo "Installiere Node-Abhängigkeiten..."
  cd "$DAEMON_DIR"
  sudo npm install --omit=dev
fi

# -------------------------------------------------------------
# 8. NODE DAEMON START (GENAU WIE WINDOWS)
# -------------------------------------------------------------
echo "Starte Auto-Update-Daemon (manuell)..."

sudo -u root nohup \
  "$NODE_BIN" "$DAEMON_DIR/daemon.js" \
  >> "$LOG_DIR/daemon.log" \
  2>&1 &


sleep 2

if ! pgrep -f "$DAEMON_DIR/daemon.js" >/dev/null; then
  echo "FEHLER: Node-Daemon läuft nicht" >&2
  exit 1
fi

echo "Node-Daemon läuft."

# -------------------------------------------------------------
# 9. DONE
# -------------------------------------------------------------
echo
echo "INSTALLATION ERFOLGREICH"
echo "Dashboard: http://localhost:${PORT}/"
echo "Logs:      $LOG_DIR"
