FROM docker:26-cli

# Install docker compose + Node
RUN apk add --no-cache nodejs npm curl bash \
    && curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 \
       -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Make "docker compose" available
RUN ln -s /usr/local/bin/docker-compose /usr/local/bin/compose || true

WORKDIR /app

COPY updater.js .
COPY config.json .

# WICHTIG: ENTRYPOINT vom docker-Image überschreiben,
# damit NICHT "docker node" ausgeführt wird.
ENTRYPOINT ["node", "updater.js"]
