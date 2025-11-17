#!/bin/bash

echo "----------------------------------------"
echo "      Customer Dashboard Update (Linux)"
echo "----------------------------------------"

set -e  # Stoppt bei Fehlern

# Prüfen, ob .env existiert
#-f prüft, ob es eine reguläre Datei ist.
# .env muss vorhanden sein , sonst weiß das script nicht, welche Version es holen soll und welchen port es prüfen soll.
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

# prüft, ob die shell docker kennt -> nein = fehler

if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Docker ist nicht installiert!"
    exit 1
fi

# docker compose installiert? Wird getestet, ob docker compose funktioniert || Wenn nicht, der Kunde muss docker aktualisieren oder installieren

if ! docker compose version >/dev/null 2>&1; then
    echo "❌ Docker Compose ist nicht installiert!"
    exit 1
fi
# hier wird der vovlle name des Images erzeugt
# damit weis docker compose, welfche Version gestartet werden soll.
IMAGE="ghcr.io/leoaigner7/customer-dashboard-v2:$APP_VERSION"


echo "🐳 Lade Image: $IMAGE"
# lädt images, die im Compose file definiert sind
#basierend auf .env wird die rtichtige Version gezogen
docker compose pull

#Falls Container existieren → sie werden aktualisiert.
#Falls noch kein Container existiert → er wird neu erstellt.
#-d bedeutet „detach“ (im Hintergrund ausführen).
echo "🔁 Starte Container neu ..."
docker compose up -d

echo "⏳ Warte 5 Sekunden ..."
sleep 5

echo "🌐 Prüfe Erreichbarkeit: http://localhost:$APP_PORT/"

#curl ruft die Startseite auf.
#-f → Fehlercode erzeugen, wenn nicht HTTP 200-299 kommt
#-s → silent
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
