FROM docker:27.0.0-cli

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY updater.js .
COPY config.json .

CMD ["node", "updater.js"]
