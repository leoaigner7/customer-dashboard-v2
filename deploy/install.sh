#!/usr/bin/env bash
set -euo pipefail

# === Customer Dashboard Installer (Linux) ===
# Version 2.0 - Stabilisiert & Robust

# -------------------------------------------------------------
# 0. Pfade und Variablen
# -------------------------------------------------------------
# Wir nutzen absolute Pfade basierend auf dem Skript-Ort
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
echo "Paketquelle:              $PACKAGE_ROOT"
echo "Node.js Pfad:             $NODE_BIN"
echo

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
echo "Richte Service-User ein (customer-dashboard)..."
if ! id "customer-dashboard" &>/dev/null; then
    sudo useradd -r -m -d /var/lib/customer-dashboard -s /usr/sbin/nologin customer-dashboard
fi
# Sicherstellen, dass der User Docker nutzen darf
sudo usermod -aG docker customer-dashboard

echo "Erstelle Verzeichnisse..."
sudo mkdir -p "$DEPLOY_DIR" "$DAEMON_DIR" "$LOG_DIR"
sudo mkdir -p "$DEPLOY_DIR/data" "$DEPLOY_DIR/logs"

# -------------------------------------------------------------
# 3. Dateien kopieren
# -------------------------------------------------------------
echo "Kopiere Dateien..."
# Wir nutzen rsync falls vorhanden, sonst cp (sauberer overwrite)
if command -v rsync >/dev/null; then
    sudo rsync -a --delete "$SCRIPT_DIR/" "$DEPLOY_DIR/"
    sudo rsync -a --delete "$PACKAGE_ROOT/system-daemon/" "$DAEMON_DIR/"
else
    sudo cp -a "$SCRIPT_DIR/." "$DEPLOY_DIR/"
    sudo cp -a "$PACKAGE_ROOT/system-daemon/." "$DAEMON_DIR/"
fi

# Public Key kopieren
TRUST_DIR="$DAEMON_DIR/trust"
SRC_KEY="$PACKAGE_ROOT/system-daemon/trust/updater-public.pem"
sudo mkdir -p "$TRUST_DIR"
if [ -f "$SRC_KEY" ]; then
    sudo cp "$SRC_KEY" "$TRUST_DIR/updater-public.pem"
    echo "Update-Signatur installiert."
else
    echo "WARNUNG: Public Key nicht gefunden ($SRC_KEY)."
fi

# -------------------------------------------------------------
# 4. Konfiguration (.env) sicher erstellen
# -------------------------------------------------------------
echo "Konfiguriere Umgebung..."

# Hilfsfunktion: Fügt Zeilenumbruch ein, falls am Ende der Datei keiner ist
ensure_final_newline() {
    local file="$1"
    if [ -s "$file" ] && [ "$(tail -c 1 "$file" | wc -l)" -eq 0 ]; then
        echo "" | sudo tee -a "$file" > /dev/null
    fi
}

# .env aus Vorlage erstellen, falls nicht existent
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$DEPLOY_DIR/.env.example" ]; then
        sudo cp "$DEPLOY_DIR/.env.example" "$ENV_FILE"
    else
        sudo touch "$ENV_FILE"
    fi
fi  # <--- WICHTIG: Das 'fi' muss HIER stehen!

# --- AUTOKORREKTUR START ---
# Repariert den spezifischen Fehler, falls "APP_VERSION" an das Passwort geklebt wurde
# (Dies muss AUCH laufen, wenn die Datei schon existiert!)
if [ -f "$ENV_FILE" ]; then
    # Ersetzt "irgendwasAPP_VERSION=" durch "irgendwas" + Zeilenumbruch + "APP_VERSION="
    sudo sed -i 's/APP_VERSION=/\nAPP_VERSION=/g' "$ENV_FILE"
    
    # Entfernt doppelte Leerzeilen, die dadurch entstanden sein könnten
    sudo sed -i '/^$/N;/^\n$/D' "$ENV_FILE"
fi
# --- AUTOKORREKTUR ENDE ---


# Sicherstellen, dass .env sauber endet, bevor wir schreiben
ensure_final_newline "$ENV_FILE"

# --- VERSION SETZEN ---
if [ -f "$PACKAGE_ROOT/VERSION.txt" ]; then
    NEW_VERSION=$(cat "$PACKAGE_ROOT/VERSION.txt" | tr -d '[:space:]')
else
    NEW_VERSION="latest"
fi

# Prüfen, ob APP_VERSION schon in der Datei steht
if grep -q "^APP_VERSION=" "$ENV_FILE"; then
    # Ersetzen
    sudo sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW_VERSION/" "$ENV_FILE"
else
    # Anhängen
    echo "APP_VERSION=$NEW_VERSION" | sudo tee -a "$ENV_FILE" > /dev/null
fi

# --- JWT SECRET SETZEN ---
# Prüfen, ob Secret gesetzt ist (und nicht leer ist)
CURRENT_SECRET=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d '=' -f2)

if [ -z "$CURRENT_SECRET" ]; then
    echo "Generiere neues Sicherheits-Token..."
    NEW_SECRET=$(openssl rand -hex 32)
    
    if grep -q "^JWT_SECRET=" "$ENV_FILE"; then
        sudo sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" "$ENV_FILE"
    else
        ensure_final_newline "$ENV_FILE"
        echo "JWT_SECRET=$NEW_SECRET" | sudo tee -a "$ENV_FILE" > /dev/null
    fi
fi

# .env laden für das Skript
set +o allexport
source "$ENV_FILE"
PORT="${APP_PORT:-8080}"

# -------------------------------------------------------------
# 5. Berechtigungen reparieren (VOR Docker Start!)
# -------------------------------------------------------------
echo "Setze Berechtigungen..."
# Alles gehört dem Service-User
sudo chown -R customer-dashboard:customer-dashboard "$INSTALL_DIR"
# Das Skript selbst muss ausführbar bleiben
sudo chmod +x "$DEPLOY_DIR/install.sh"

# -------------------------------------------------------------
# 6. Docker Container starten
# -------------------------------------------------------------
cd "$DEPLOY_DIR"

echo "Starte Dashboard (Port $PORT)..."
# Alte Container stoppen (falls vorhanden)
sudo docker compose down --remove-orphans >/dev/null 2>&1 || true

# Neu starten
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
  if [ $i -eq $RETRIES ]; then
    echo "⚠️  Warnung: Dashboard antwortet noch nicht. Bitte Logs prüfen: sudo docker logs deploy-dashboard-1"
  else
    sleep 2
  fi
done

# -------------------------------------------------------------
# 8. Service Installation (Daemon)
# -------------------------------------------------------------
echo "Installiere Update-Daemon..."

# NPM Install im Daemon-Ordner
if [ -f "$DAEMON_DIR/package.json" ]; then
    cd "$DAEMON_DIR"
    # Als Service-User ausführen, damit node_modules die richtigen Rechte hat
    sudo -u customer-dashboard env HOME="/var/lib/customer-dashboard" npm ci --omit=dev --silent
fi

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
ExecStart=/usr/bin/env node $DAEMON_DIR/daemon.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
# Sicherheit:
NoNewPrivileges=true
ProtectSystem=full
# Erlaube Schreiben nur im Installationsverzeichnis
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
sudo systemctl restart "$SERVICE_NAME"

echo
echo "==========================================="
echo "   INSTALLATION ERFOLGREICH ABGESCHLOSSEN"
echo "==========================================="
echo "URL:      http://localhost:${PORT}/"
echo "Login:    admin@example.com / admin123"
echo "Logs:     $LOG_DIR"
echo "Service:  systemctl status $SERVICE_NAME"
echo "==========================================="