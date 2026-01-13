#!/usr/bin/env bash
set -euo pipefail

# === Customer Dashboard Installer (Linux) ===
# Version 2.2 - Fix Node Modules Copy

# -------------------------------------------------------------
# 0. Pfade und Variablen
# -------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INSTALL_DIR="/opt/customer-dashboard"
DEPLOY_DIR="$INSTALL_DIR/deploy"
DAEMON_DIR="$INSTALL_DIR/system-daemon"
LOG_DIR="$INSTALL_DIR/logs"
ENV_FILE="$DEPLOY_DIR/.env"

NODE_BIN="$(command -v node)"

echo "=== Installation gestartet ==="
echo "Installationsverzeichnis: $INSTALL_DIR"

# -------------------------------------------------------------
# 1. Checks
# -------------------------------------------------------------
if ! command -v docker >/dev/null; then
  echo "FEHLER: Docker ist nicht installiert." >&2
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "FEHLER: Node.js ist nicht installiert." >&2
  exit 1
fi

# -------------------------------------------------------------
# 2. Verzeichnisse & User
# -------------------------------------------------------------
echo "Richte Service-User ein..."
if ! id "customer-dashboard" &>/dev/null; then
    sudo useradd -r -m -d /var/lib/customer-dashboard -s /usr/sbin/nologin customer-dashboard
fi
sudo usermod -aG docker customer-dashboard

echo "Erstelle Verzeichnisse..."
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"
sudo mkdir -p "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"

# -------------------------------------------------------------
# 3. Dateien kopieren (MIT WICHTIGEM EXCLUDE)
# -------------------------------------------------------------
echo "Kopiere Dateien..."
if command -v rsync >/dev/null; then
    # WICHTIG: node_modules ausschließen, damit keine Windows-Dateien kopiert werden!
    sudo rsync -a --delete --exclude 'node_modules' "$SCRIPT_DIR/" "$DEPLOY_DIR/"
    sudo rsync -a --delete --exclude 'node_modules' "$PACKAGE_ROOT/system-daemon/" "$DAEMON_DIR/"
else
    # Fallback für cp (weniger elegant, aber okay)
    sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"
    sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"
    # Sicherstellen, dass wir keine alten node_modules kopiert haben
    sudo rm -rf "$DAEMON_DIR/node_modules"
fi

# Public Key
TRUST_DIR="$DAEMON_DIR/trust"
SRC_KEY="$PACKAGE_ROOT/system-daemon/trust/updater-public.pem"
sudo mkdir -p "$TRUST_DIR"
if [ -f "$SRC_KEY" ]; then
    sudo cp "$SRC_KEY" "$TRUST_DIR/updater-public.pem"
    echo "Update-Signatur installiert."
else
    echo "WARNUNG: Public Key nicht gefunden."
fi

# -------------------------------------------------------------
# 4. Konfiguration (.env)
# -------------------------------------------------------------
echo "Konfiguriere Umgebung..."
ensure_final_newline() {
    local file="$1"
    if [ -s "$file" ] && [ "$(tail -c 1 "$file" | wc -l)" -eq 0 ]; then
        echo "" | sudo tee -a "$file" > /dev/null
    fi
}

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$DEPLOY_DIR/.env.example" ]; then
        sudo cp "$DEPLOY_DIR/.env.example" "$ENV_FILE"
    else
        sudo touch "$ENV_FILE"
    fi
fi

# Autokorrektur
if [ -f "$ENV_FILE" ]; then
    sudo sed -i 's/APP_VERSION=/\nAPP_VERSION=/g' "$ENV_FILE"
    sudo sed -i '/^$/N;/^\n$/D' "$ENV_FILE"
fi
ensure_final_newline "$ENV_FILE"

# Version setzen
if [ -f "$PACKAGE_ROOT/VERSION.txt" ]; then
    NEW_VERSION=$(cat "$PACKAGE_ROOT/VERSION.txt" | tr -d '[:space:]')
else
    NEW_VERSION="latest"
fi
if grep -q "^APP_VERSION=" "$ENV_FILE"; then
    sudo sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW_VERSION/" "$ENV_FILE"
else
    echo "APP_VERSION=$NEW_VERSION" | sudo tee -a "$ENV_FILE" > /dev/null
fi

# Secret setzen
CURRENT_SECRET=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d '=' -f2)
if [ -z "$CURRENT_SECRET" ]; then
    NEW_SECRET=$(openssl rand -hex 32)
    if grep -q "^JWT_SECRET=" "$ENV_FILE"; then
        sudo sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" "$ENV_FILE"
    else
        ensure_final_newline "$ENV_FILE"
        echo "JWT_SECRET=$NEW_SECRET" | sudo tee -a "$ENV_FILE" > /dev/null
    fi
fi

set +o allexport
source "$ENV_FILE"
PORT="${APP_PORT:-8080}"

# -------------------------------------------------------------
# 5. Berechtigungen & Start
# -------------------------------------------------------------
echo "Setze Berechtigungen..."
sudo chown -R customer-dashboard:customer-dashboard "$INSTALL_DIR"
sudo chmod +x "$DEPLOY_DIR/install.sh"

cd "$DEPLOY_DIR"
echo "Starte Dashboard (Port $PORT)..."
sudo docker compose down --remove-orphans >/dev/null 2>&1 || true
sudo docker compose pull -q
sudo docker compose up -d

# -------------------------------------------------------------
# 7. Healthcheck
# -------------------------------------------------------------
echo "Warte auf Dashboard-Start..."
URL="http://localhost:${PORT}/api/health"
RETRIES=15
for ((i=1; i<=RETRIES; i++)); do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "✅ Dashboard ist online!"
    break
  fi
  sleep 2
done

# -------------------------------------------------------------
# 8. Service Installation (Daemon) - DER WICHTIGE FIX
# -------------------------------------------------------------
echo "Installiere Update-Daemon..."

if [ -d "$DAEMON_DIR" ]; then
    cd "$DAEMON_DIR"
    
    # ALLES LÖSCHEN, was Probleme machen könnte
    echo "Bereinige alte Module..."
    sudo rm -rf node_modules package-lock.json
    
    # SAUBER NEU INSTALLIEREN
    echo "Lade Abhängigkeiten neu..."
    # Pfad explizit setzen, um sudo-Probleme zu vermeiden
    sudo env PATH="$PATH" npm install --omit=dev --silent --no-audit --no-fund
    
    # Rechte an Service-User zurückgeben
    sudo chown -R customer-dashboard:customer-dashboard "$DAEMON_DIR"
fi

SERVICE_NAME="customer-dashboard-daemon"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Customer Dashboard Auto Update Daemon
After=network-online.target docker.service

[Service]
Type=simple
User=customer-dashboard
Group=docker
WorkingDirectory=$DAEMON_DIR
ExecStart=/usr/bin/env node $DAEMON_DIR/daemon.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
sudo systemctl restart "$SERVICE_NAME"

echo
echo "==========================================="
echo "   INSTALLATION ERFOLGREICH"
echo "==========================================="
echo "URL:      http://localhost:${PORT}/"
echo "Login:    admin@example.com / admin123"