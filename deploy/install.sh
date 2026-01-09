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
echo "Node:                     $NODE_BIN"

echo
# -------------------------------------------------------------
# 1. Checks
# -------------------------------------------------------------
if ! command -v docker >/dev/null; then
  echo "FEHLER: Docker nicht installiert" >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "FEHLER: Node.js nicht installiert" >&2
  exit 1
fi



# -------------------------------------------------------------
# 2. Verzeichnisse
# -------------------------------------------------------------
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"

# -------------------------------------------------------------
# 3. Dateien kopieren
# -------------------------------------------------------------
echo "Kopiere Dateien..."
sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"
sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"

# -------------------------------------------------------------
# 3a. Persistenz-Ordner für Docker-Volumes anlegen
# -------------------------------------------------------------
echo "Erzeuge Persistenz-Ordner (data, logs) im Deploy-Verzeichnis..."
sudo mkdir -p "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"

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
# LEAST PRIVILEGE: Service-User + Rechte + Docker-Gruppe
# -------------------------------------------------------------
echo "Richte Service-User ein (customer-dashboard)..."
sudo useradd -r -m -d /var/lib/customer-dashboard -s /usr/sbin/nologin customer-dashboard 2>/dev/null || true
sudo usermod -aG docker customer-dashboard || true


sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"
sudo mkdir -p "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"

# Daemon + Logs
sudo chown -R customer-dashboard:customer-dashboard "$DAEMON_DIR" "$LOG_DIR"

# Deploy MUSS schreibbar sein, wenn der Daemon deploy ersetzt
sudo chown -R customer-dashboard:customer-dashboard "$DEPLOY_DIR"





# -------------------------------------------------------------
# 4. .env lesen
# -------------------------------------------------------------
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "FEHLER: .env fehlt in $DEPLOY_DIR/.env" >&2
  exit 1
fi

set +o allexport
# shellcheck disable=SC1090
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
sudo docker compose down || true

echo "Ziehe Image..."
sudo docker compose pull

echo "Starte Dashboard..."
sudo docker compose up -d

# -------------------------------------------------------------
# 6. Healthcheck
# -------------------------------------------------------------
echo "Prüfe Dashboard..."
URL="http://localhost:${PORT}/api/health"
ok="false"
for i in {1..20}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
  ok="true"
    echo "Dashboard läuft."
    break
  fi
  sleep 2
done

# -------------------------------------------------------------
# 7. Node-Abhängigkeiten
# -------------------------------------------------------------
if [ -f "$DAEMON_DIR/package.json" ]; then
  echo "Installiere Node-Abhängigkeiten (prod)..."
  cd "$DAEMON_DIR"  
  sudo -u customer-dashboard env HOME="/var/lib/customer-dashboard" npm ci --omit=dev
fi
# -------------------------------------------------------------
# 8. NODE DAEMON START (GENAU WIE WINDOWS)
# -------------------------------------------------------------
echo "Erstelle/aktualisiere systemd Service..."

SERVICE_NAME="customer-dashboard-daemon"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Customer Dashboard Auto Update Daemon
After=network-online.target docker.service
Wants=network-online.target


[Service]
Type=simple
User=customer-dashboard
Group=docker
WorkingDirectory=$DAEMON_DIR
ExecStart=/usr/bin/env node /opt/customer-dashboard/system-daemon/daemon.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Hardening (empfohlen)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 2
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

# -------------------------------------------------------------
# 9. DONE
# -------------------------------------------------------------
echo
echo "INSTALLATION ERFOLGREICH"
echo "Dashboard: http://localhost:${PORT}/"
echo "Logs:      $LOG_DIR"
echo "Service:   systemctl status $SERVICE_NAME"
echo "Journal:   journalctl -u $SERVICE_NAME -f"
