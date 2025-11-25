FROM docker:26-cli

# Install node, npm, curl, bash, docker-compose
RUN apk add --no-cache nodejs npm curl bash \
    && curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 \
       -o /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

RUN ln -s /usr/local/bin/docker-compose /usr/local/bin/compose || true

WORKDIR /app

# --- INSTALL axios ---
COPY updater.js .
COPY config.json .

RUN npm init -y
RUN npm install axios

# Wichtig: Docker ENTRYPOINT überschreibt docker:26-cli entrypoint
ENTRYPOINT ["node", "updater.js"]
