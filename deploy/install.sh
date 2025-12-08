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
sudo mkdir -p "$INSTALL_DIR" "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

# -------------------------------------------------------------
# 2. Dateien kopieren
# -------------------------------------------------------------
echo "Kopiere deploy-Dateien..."
sudo cp -r "$SCRIPT_DIR/"* "$DEPLOY_DIR/"

echo "Kopiere system-daemon..."
if [ ! -d "$PACKAGE_ROOT/system-daemon" ]; then
  echo "FEHLER: system-daemon wurde nicht gefunden (erwartet unter $PACKAGE_ROOT/system-daemon)" >&2
  exit 1
fi
sudo cp -r "$PACKAGE_ROOT/system-daemon/"* "$DAEMON_DIR/"

# .env aus .env.example erzeugen, falls nicht vorhanden
if [ ! -f "$DEPLOY_DIR/.env" ] && [ -f "$DEPLOY_DIR/.env.example" ]; then
  sudo cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
fi

# -------------------------------------------------------------
# 3. Checks
# -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "FEHLER: Docker ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/$COMPOSE_FILE" ]; then
  echo "FEHLER: $COMPOSE_FILE fehlt im deploy-Verzeichnis." >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "FEHLER: .env fehlt im deploy-Verzeichnis." >&2
  exit 1
fi

# APP_PORT aus .env lesen
set +o allexport
# shellcheck source=/dev/null
source "$DEPLOY_DIR/.env"
PORT="${APP_PORT:-8080}"

echo "Verwendete Version aus .env: ${APP_VERSION:-unbekannt}"
echo "Port:                        ${PORT}"
echo

# -------------------------------------------------------------
# 4. Docker Container neu starten
# -------------------------------------------------------------
cd "$DEPLOY_DIR"

echo "Stoppe bestehende Container (falls vorhanden)..."
docker compose -f "$COMPOSE_FILE" down || true

echo "Ziehe aktuelles Image..."
docker compose -f "$COMPOSE_FILE" pull

echo "Starte Dashboard..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Warte 10 Sekunden auf Start..."
sleep 10

# -------------------------------------------------------------
# 5. Health-Check
# -------------------------------------------------------------
URL="http://localhost:${PORT}/"

echo "Prüfe Dashboard unter $URL ..."
if curl -fsS "$URL" >/dev/null 2>&1; then
  echo "Dashboard erfolgreich gestartet."
else
  echo "WARNUNG: Dashboard läuft evtl. nicht korrekt. HTTP-Check fehlgeschlagen." >&2
fi

# -------------------------------------------------------------
# 6. systemd-Service für Auto-Update-Daemon
# -------------------------------------------------------------
if [ -f "$DAEMON_DIR/customer-dashboard-updater.service" ]; then
  echo "Installiere systemd-Service für Auto-Update-Daemon..."

  sudo cp "$DAEMON_DIR/customer-dashboard-updater.service" "$SERVICE_FILE"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  echo "Auto-Update-Daemon wurde als systemd-Service installiert und gestartet."
else
  echo "Hinweis: customer-dashboard-updater.service wurde nicht gefunden, Auto-Update-Dienst wurde NICHT eingerichtet."
fi

# -------------------------------------------------------------
# 7. Fertig
# -------------------------------------------------------------
echo
echo "INSTALLATION ABGESCHLOSSEN."
echo "Dashboard:     $URL"
echo "Logs:          $LOG_DIR"
echo "Daemon-Service: $SERVICE_NAME (systemd)"
