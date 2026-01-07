#!/usr/bin/env bash
set -e

# =========================================================
# BACHELOR THESIS INSTALLER (BULLETPROOF VERSION)
# =========================================================

# 1. AUTO-ROOT: Sicherstellen, dass wir Root sind
if [ "$EUID" -ne 0 ]; then
  echo ">> Das Skript benötigt Root-Rechte. Starte neu mit sudo..."
  exec sudo "$0" "$@"
  exit
fi

echo "=== Customer Dashboard Installer (Linux Robust) ==="

# -------------------------------------------------------------
# 1. PFADE ERMITTELN & PRÜFEN
# -------------------------------------------------------------
# Wo liegt dieses Skript gerade?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Der Projekt-Root ist einen Ordner drüber
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_DIR="/opt/customer-dashboard"

echo ">> Quellverzeichnis:  $SOURCE_ROOT"
echo ">> Zielverzeichnis:   $INSTALL_DIR"

# Prüfen, ob wir im richtigen Ordner sind
if [ ! -d "$SOURCE_ROOT/app" ]; then
    echo "❌ KRITISCHER FEHLER: Kann den Ordner 'app' in $SOURCE_ROOT nicht finden."
    echo "   Bitte stelle sicher, dass du das Skript aus dem 'deploy'-Ordner startest."
    echo "   Aktueller Inhalt von $SOURCE_ROOT:"
    ls -F "$SOURCE_ROOT"
    exit 1
fi

# -------------------------------------------------------------
# 2. ABHÄNGIGKEITEN
# -------------------------------------------------------------
echo
echo ">> [1/6] Prüfe Software..."
if ! command -v curl >/dev/null; then apt-get update && apt-get install -y curl; fi

if ! command -v docker >/dev/null; then 
    echo "   Installiere Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "   ✔ Docker ist da."
fi

if ! command -v node >/dev/null; then
    echo "   Installiere Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
else
    echo "   ✔ Node.js ist da."
fi

# -------------------------------------------------------------
# 3. DATEIEN KOPIEREN (Einzeln & Gezielt)
# -------------------------------------------------------------
echo
echo ">> [2/6] Bereite Installation vor..."

# Alte Container stoppen, falls sie laufen
if [ -f "$INSTALL_DIR/deploy/docker-compose.yml" ]; then
    echo "   Stoppe alte Container..."
    (cd "$INSTALL_DIR/deploy" && docker compose down 2>/dev/null || true)
fi

# Zielordner frisch machen
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

echo ">> [3/6] Kopiere Dateien..."

# 1. App Ordner (Frontend & Backend)
echo "   Kopiere 'app'..."
cp -r "$SOURCE_ROOT/app" "$INSTALL_DIR/"

# 2. System Daemon
echo "   Kopiere 'system-daemon'..."
cp -r "$SOURCE_ROOT/system-daemon" "$INSTALL_DIR/"

# 3. Deploy Ordner
echo "   Kopiere 'deploy'..."
cp -r "$SOURCE_ROOT/deploy" "$INSTALL_DIR/"

# 4. Einzeldateien (Wichtig für Docker Build!)
echo "   Kopiere Root-Dateien..."
cp "$SOURCE_ROOT/Dockerfile" "$INSTALL_DIR/" 2>/dev/null || echo "   ⚠️ Dockerfile nicht im Root (OK, wenn es im Build Context ist)"
cp "$SOURCE_ROOT/package.json" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SOURCE_ROOT/.dockerignore" "$INSTALL_DIR/" 2>/dev/null || true

# Check ob Frontend angekommen ist
if [ ! -d "$INSTALL_DIR/app/frontend" ]; then
    echo "❌ FEHLER: Kopieren fehlgeschlagen. '$INSTALL_DIR/app/frontend' fehlt."
    exit 1
fi
echo "✔ Dateien erfolgreich kopiert."

# Pfade im Zielsystem definieren
TARGET_DEPLOY="$INSTALL_DIR/deploy"
TARGET_DAEMON="$INSTALL_DIR/system-daemon"
TARGET_FRONTEND="$INSTALL_DIR/app/frontend"
TARGET_LOGS="$INSTALL_DIR/logs"
mkdir -p "$TARGET_LOGS"

# -------------------------------------------------------------
# 4. FRONTEND BAUEN
# -------------------------------------------------------------
echo
echo ">> [4/6] Baue Frontend (React)..."
cd "$TARGET_FRONTEND"

# Aufräumen (Windows Reste entfernen)
rm -rf node_modules package-lock.json dist

echo "   Installiere npm Pakete (kann dauern)..."
npm install --silent

echo "   Erstelle Production Build..."
npm run build

if [ -f "dist/index.html" ]; then
    echo "✔ Frontend Build erfolgreich."
else
    echo "❌ FEHLER: Build fehlgeschlagen. 'dist/index.html' nicht gefunden."
    exit 1
fi

# -------------------------------------------------------------
# 5. DAEMON EINRICHTEN
# -------------------------------------------------------------
echo
echo ">> [5/6] Richte Update-Daemon ein..."
cd "$TARGET_DAEMON"
rm -rf node_modules package-lock.json
npm install --omit=dev --silent

# Key Handling
mkdir -p trust
if [ ! -f "trust/updater-public.pem" ]; then
    # Suche Key im Source
    if [ -f "$SOURCE_ROOT/system-daemon/trust/updater-public.pem" ]; then 
        cp "$SOURCE_ROOT/system-daemon/trust/updater-public.pem" trust/
        echo "✔ Key kopiert."
    else
        echo "⚠️  WARNUNG: Kein Public Key gefunden. Updates werden eventuell nicht funktionieren."
    fi
fi

# -------------------------------------------------------------
# 6. STARTEN
# -------------------------------------------------------------
echo
echo ">> [6/6] Starte Dienste..."

# A) Docker
cd "$TARGET_DEPLOY"
echo "   Fahre Docker hoch..."
# Wähle richtigen Befehl
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

$DC up -d --build --remove-orphans

# B) Daemon
echo "   Starte Hintergrund-Daemon..."
pkill -f "system-daemon/daemon.js" || true
nohup node "$TARGET_DAEMON/daemon.js" >> "$TARGET_LOGS/daemon.log" 2>&1 &

echo
echo "---------------------------------------------------"
echo "   INSTALLATION ABGESCHLOSSEN!"
echo "---------------------------------------------------"
echo "1. Dashboard:  http://localhost:8080/"
echo "2. Logs:       $TARGET_LOGS/daemon.log"
echo "3. API-Check:  curl http://localhost:8080/api/health"
echo "---------------------------------------------------"