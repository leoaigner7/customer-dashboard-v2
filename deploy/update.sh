#!/usr/bin/env bash
set -euo pipefail

# ===============================================
#   KONFIGURATION – PRO KUNDEN ANPASSBAR
# ===============================================
# GitHub-Repo, aus dem die Versionsinfos kommen
REPO_OWNER="leoaigner7"
REPO_NAME="customer-dashboard-v2"

# Aktuell: GitHub Releases-API
# Für Kunden später z.B. eigene URL:
# UPDATE_API_URL="https://updates.meinefirma.de/customer-dashboard/latest"
UPDATE_API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"

# Welche Dateien lokal verwendet werden
ENV_FILE=".env"                # enthält APP_VERSION
VERSION_KEY="APP_VERSION"      # Name der Variable in .env
COMPOSE_FILE="docker-compose.yml"
LOG_FILE="updater.log"
# ===============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

log "=== Customer Dashboard Updater (Linux) ==="

# Grundchecks
if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: $ENV_FILE nicht gefunden (erwarte es neben diesem Skript)."
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERROR: $COMPOSE_FILE nicht gefunden."
  exit 1
fi

# Aktuelle Version aus .env lesen
CURRENT_VERSION=$(grep -E "^${VERSION_KEY}=" "$ENV_FILE" | head -n1 | cut -d'=' -f2- | tr -d '\r')

if [[ -z "${CURRENT_VERSION:-}" ]]; then
  log "WARN: Konnte aktuelle Version nicht aus $ENV_FILE lesen – setze 'unknown'."
  CURRENT_VERSION="unknown"
fi

log "Aktuelle Version: $CURRENT_VERSION"

# Neueste Version vom Update-Server holen (hier: GitHub Releases)
log "Frage Update-Server: $UPDATE_API_URL"
LATEST_JSON=$(curl -fsSL "$UPDATE_API_URL") || {
  log "ERROR: Konnte Update-Infos nicht abrufen."
  exit 1
}

# tag_name aus JSON extrahieren
LATEST_TAG=$(printf '%s\n' "$LATEST_JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"\s*:\s*"([^"]+)".*/\1/')
LATEST_VERSION="${LATEST_TAG#v}"  # führendes 'v' entfernen, falls vorhanden

if [[ -z "${LATEST_VERSION:-}" ]]; then
  log "ERROR: Konnte neueste Version aus JSON nicht bestimmen."
  exit 1
fi

log "Neueste Version laut Server: $LATEST_VERSION (Tag: $LATEST_TAG)"

# Vergleich (einfach: ungleich → Update)
if [[ "$LATEST_VERSION" == "$CURRENT_VERSION" ]]; then
  log "Kein Update notwendig."
  exit 0
fi

log "Update verfügbar: $CURRENT_VERSION → $LATEST_VERSION"
log "Aktualisiere $ENV_FILE …"

TMP_ENV="${ENV_FILE}.tmp"
# APP_VERSION-Zeile ersetzen (oder anhängen, falls nicht vorhanden)
if grep -qE "^${VERSION_KEY}=" "$ENV_FILE"; then
  sed -E "s/^(${VERSION_KEY}=).*/\1${LATEST_VERSION}/" "$ENV_FILE" > "$TMP_ENV"
else
  cat "$ENV_FILE" > "$TMP_ENV"
  echo "${VERSION_KEY}=${LATEST_VERSION}" >> "$TMP_ENV"
fi

mv "$TMP_ENV" "$ENV_FILE"
log "ENV aktualisiert: ${VERSION_KEY}=${LATEST_VERSION}"

# Docker Deploy
log "Pull neues Image über docker compose …"
if ! docker compose -f "$COMPOSE_FILE" pull; then
  log "ERROR: docker compose pull fehlgeschlagen."
  exit 1
fi

log "Starte/aktualisiere Container …"
if ! docker compose -f "$COMPOSE_FILE" up -d; then
  log "ERROR: docker compose up fehlgeschlagen."
  exit 1
fi

log "Update auf Version $LATEST_VERSION erfolgreich abgeschlossen."
