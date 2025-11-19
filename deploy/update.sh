#!/bin/bash

echo "----------------------------------------"
echo " Customer Dashboard Update (Linux)"
echo "----------------------------------------"


LOGFILE="logs/update.log"
mkdir -p logs

# Prüfen, ob .env existiert
#-f prüft, ob es eine reguläre Datei ist.
# .env muss vorhanden sein , sonst weiß das script nicht, welche Version es holen soll und welchen port es prüfen soll.
if [ ! -f ".env" ]; then
   echo "❌ Fehler: .env nicht gefunden!" | tee -a "$LOGFILE"
   exit 1
fi


# Variablen laden
source .env


# VERSION.txt prüfen (für Offline-Update-Vergleich)
if [ -f "VERSION.txt" ]; then
TARGET_VERSION=$(cat VERSION.txt)
echo "📦 Zielversion laut VERSION.txt: $TARGET_VERSION"
if [ "$APP_VERSION" != "$TARGET_VERSION" ]; then
echo "🔄 Update erforderlich: $APP_VERSION → $TARGET_VERSION" | tee -a "$LOGFILE"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$TARGET_VERSION/" .env
source .env
echo "✅ APP_VERSION in .env aktualisiert auf $APP_VERSION" | tee -a "$LOGFILE"
else
echo "✅ Keine Aktualisierung nötig. Version ist bereits aktuell." | tee -a "$LOGFILE"
exit 0
fi
fi


# Docker prüfen
if ! command -v docker >/dev/null 2>&1; then
echo "❌ Docker ist nicht installiert!" | tee -a "$LOGFILE"
exit 1
fi


if ! docker compose version >/dev/null 2>&1; then
echo "❌ Docker Compose ist nicht installiert!" | tee -a "$LOGFILE"
exit 1
fi


IMAGE="${APP_REGISTRY}/leoaigner7/customer-dashboard-v2:${APP_VERSION}"
echo "🐳 Lade Image: $IMAGE" | tee -a "$LOGFILE"
docker compose pull || (echo "❌ Fehler beim Pull" | tee -a "$LOGFILE" && exit 1)


echo "🔁 Starte Container neu ..." | tee -a "$LOGFILE"
docker compose up -d || (echo "❌ Fehler beim Start" | tee -a "$LOGFILE" && exit 1)


echo "⏳ Warte 5 Sekunden ..."
sleep 5


echo "🌐 Prüfe Erreichbarkeit: http://localhost:$APP_PORT/"


if curl -f -s "http://localhost:$APP_PORT/" >/dev/null; then
echo "✅ Update erfolgreich! Version $APP_VERSION läuft." | tee -a "$LOGFILE"
else
echo "❌ Anwendung NICHT erreichbar!" | tee -a "$LOGFILE"
echo "🔍 Logs:" | tee -a "$LOGFILE"
docker compose logs --tail=50 | tee -a "$LOGFILE"
exit 1
fi


echo "----------------------------------------"
echo "🎉 Fertig!" | tee -a "$LOGFILE"
echo "----------------------------------------"