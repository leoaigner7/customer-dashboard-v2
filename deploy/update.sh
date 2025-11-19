#!/bin/bash

echo "----------------------------------------"
echo "      Customer Dashboard Update (Linux)"
echo "----------------------------------------"

set -e
LOGFILE="logs/update.log"
mkdir -p logs

# .env prüfen
if [ ! -f ".env" ]; then
  echo "❌ Fehler: .env nicht gefunden!" | tee -a "$LOGFILE"
  exit 1
fi

source .env

# VERSION.txt prüfen (für Offline-Updates)
if [ -f "VERSION.txt" ]; then
  TARGET_VERSION=$(cat VERSION.txt)
  echo "📦 Zielversion laut VERSION.txt: $TARGET_VERSION"
  if [ "$APP_VERSION" != "$TARGET_VERSION" ]; then
    echo "🔄 Update erforderlich: $APP_VERSION → $TARGET_VERSION" | tee -a "$LOGFILE"
    sed -i "s/^APP_VERSION=.*/APP_VERSION=$TARGET_VERSION/" .env
    source .env
  else
    echo "✅ Keine Aktualisierung nötig." | tee -a "$LOGFILE"
    exit 0
  fi
fi

# Docker prüfen
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker nicht installiert." | tee -a "$LOGFILE"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose nicht installiert." | tee -a "$LOGFILE"
  exit 1
fi

IMAGE="${APP_REGISTRY}/leoaigner7/customer-dashboard-v2:${APP_VERSION}"
echo "🐳 Lade Image: $IMAGE" | tee -a "$LOGFILE"
docker compose pull

echo "🔁 Starte Container neu ..." | tee -a "$LOGFILE"
docker compose up -d

echo "⏳ Warte 5 Sekunden ..."
sleep 5

echo "🌐 Prüfe: http://localhost:$APP_PORT/"
if curl -f -s "http://localhost:$APP_PORT/" >/dev/null; then
  echo "✅ Update erfolgreich. Version $APP_VERSION läuft." | tee -a "$LOGFILE"
else
  echo "❌ Anwendung NICHT erreichbar!" | tee -a "$LOGFILE"
  docker compose logs --tail=50 | tee -a "$LOGFILE"
  exit 1
fi

echo "----------------------------------------"
echo "🎉 Fertig!" | tee -a "$LOGFILE"
echo "----------------------------------------"
