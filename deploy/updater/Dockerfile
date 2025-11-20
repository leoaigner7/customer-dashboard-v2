FROM node:20-alpine

# Docker + Compose + Tools installieren
RUN apk update && apk add --no-cache \
    docker-cli \
    docker-cli-compose \
    curl \
    bash \
    jq

# Arbeitsverzeichnis
WORKDIR /app

# Dateien in Container kopieren
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "updater.js"]
