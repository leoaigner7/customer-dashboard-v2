#!/usr/bin/env bash
set -e

echo "Starte Deployment..."
source .env

docker compose pull
docker compose up -d

echo "Deployment Version $APP_VERSION abgeschlossen!"
