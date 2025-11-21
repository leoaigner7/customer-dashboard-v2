# Docker CLI + Node
FROM docker:24-cli

# Node installieren
RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY updater.js package*.json ./

RUN npm install

CMD ["node", "updater.js"]
