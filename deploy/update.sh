#!/bin/bash
echo "Starte Deployment Version 2..."

source .env

docker compose pull
docker compose up -d

echo "Deployment V2 Version $APP_VERSION abgeschlossen!"
