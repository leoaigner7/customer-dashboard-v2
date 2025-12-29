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

SERVICE_NAME="customer-dashboard-updater"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installationsverzeichnis:    $INSTALL_DIR"
echo "Paketwurzelverzeichnis:      $PACKAGE_ROOT"
echo

# -------------------------------------------------------------
# 1. Verzeichnisse anlegen
# -------------------------------------------------------------
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

# -------------------------------------------------------------
# 2. Dateien KORREKT kopieren (inkl. .env!)
# -------------------------------------------------------------
echo "Kopiere deploy-Dateien..."
sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"

echo "Kopiere system-daemon..."
if [ ! -d "$PACKAGE_ROOT/system-daemon" ]; then
  echo "FEHLER: system-daemon nicht gefunden!" >&2
  exit 1
fi
sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"

# -------------------------------------------------------------
# 3. Checks
# -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "FEHLER: Docker ist nicht installiert." >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/$COMPOSE_FILE" ]; then
  echo "FEHLER: docker-compose.yml fehlt." >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "FEHLER: .env fehlt im deploy-Verzeichnis." >&2
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
# 5. Docker sauber neu starten
# -------------------------------------------------------------
cd "$DEPLOY_DIR"

echo "Stoppe bestehende Container..."
docker compose -f "$COMPOSE_FILE" down || true

echo "Ziehe aktuelles Image..."
docker compose -f "$COMPOSE_FILE" pull

echo "Starte Dashboard..."
docker compose -f "$COMPOSE_FILE" up -d

# -------------------------------------------------------------
# 6. Healthcheck
# -------------------------------------------------------------
echo "Warte auf Dashboard..."
URL="http://localhost:${PORT}/"

for i in {1..20}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "Dashboard erfolgreich gestartet."
    break
  fi
  sleep 2
done

# -------------------------------------------------------------
# 7. Node-Abhängigkeiten installieren (wichtig!)
# -------------------------------------------------------------
if [ -f "$DAEMON_DIR/package.json" ]; then
  echo "Installiere Node-Abhängigkeiten..."
  cd "$DAEMON_DIR"
  sudo npm ci --omit=dev
fi

# -------------------------------------------------------------
# 8. systemd-Service installieren (ERSATZ für Task Scheduler)
# -------------------------------------------------------------
if [ -f "$DAEMON_DIR/customer-dashboard-updater.service" ]; then
  echo "Installiere systemd-Service für Auto-Updater..."

  sudo cp "$DAEMON_DIR/customer-dashboard-updater.service" "$SERVICE_FILE"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  echo "Auto-Update-Daemon läuft jetzt als systemd-Service."
else
  echo "WARNUNG: customer-dashboard-updater.service fehlt – kein Auto-Update!"
fi

# -------------------------------------------------------------
# 9. Abschluss
# -------------------------------------------------------------
echo
echo "INSTALLATION ABGESCHLOSSEN"
echo "Dashboard: $URL"
echo "Logs:      $LOG_DIR"
echo "Service:   $SERVICE_NAME (systemd)"
