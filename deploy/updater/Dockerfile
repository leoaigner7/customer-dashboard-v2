FROM docker:24-cli

RUN apk add --no-cache nodejs npm curl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY updater.js ./

ENTRYPOINT []

CMD ["node", "updater.js"]
