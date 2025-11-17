#!/bin/bash

echo "----------------------------------------"
echo "      Customer Dashboard Update (Linux)"
echo "----------------------------------------"

set -e  # Stoppt bei Fehlern

# Prüfen, ob .env existiert
if [ ! -f ".env" ]; then
    echo "❌ Fehler: .env nicht gefunden!"
    exit 1
fi

# Variablen laden
source .env

echo "📄 Konfiguration geladen:"
echo "   APP_VERSION = $APP_VERSION"
echo "   APP_PORT    = $APP_PORT"
echo ""

# Docker vorhanden?
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Docker ist nicht installiert!"
    exit 1
fi

# Compose vorhanden?
if ! docker compose version >/dev/null 2>&1; then
    echo "❌ Docker Compose ist nicht installiert!"
    exit 1
fi

IMAGE="ghcr.io/leoaigner7/customer-dashboard-v2:$APP_VERSION"

echo "🐳 Lade Image: $IMAGE"
docker compose pull

echo "🔁 Starte Container neu ..."
docker compose up -d

echo "⏳ Warte 5 Sekunden ..."
sleep 5

echo "🌐 Prüfe Erreichbarkeit: http://localhost:$APP_PORT/"
if curl -f -s "http://localhost:$APP_PORT/" >/dev/null; then
    echo "✅ Update erfolgreich! Version $APP_VERSION läuft."
else
    echo "❌ Anwendung NICHT erreichbar!"
    echo "   🔍 Logs:"
    docker compose logs --tail=50
    exit 1
fi

echo "----------------------------------------"
echo "🎉 Fertig!"
echo "----------------------------------------"
